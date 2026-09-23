// Deterministic, seed-driven world: an endless winding road plus a terrain height field
// that is carved around it. This module is shared by the main thread (car physics, road
// meshes) and the terrain Web Worker (chunk meshes). Both sides generate the exact same
// road because generation is purely sequential and seeded.

import { makeNoise2D, fbm, ridged, smoothstep, lerp, clamp } from './noise.js';

export const CHUNK_SIZE = 256;
export const ROAD_STEP = 2; // metres between road samples
export const LANE_WIDTH = 3.6;
export const ROAD_HALF = LANE_WIDTH; // asphalt half-width (two lanes)
export const SHOULDER = 1.3;
export const FLAT_HALF = ROAD_HALF + SHOULDER + 0.8; // terrain is flattened inside this
export const WATER_LEVEL = -26;
export const SPAWN_INDEX = 600;

const NEAR = 80; // fine road-distance query radius
const FAR = 950; // coarse road-distance query radius (mountains fade in with distance)
const FINE_BUCKET = 32;
const COARSE_BUCKET = 256;
const COARSE_STRIDE = 16; // one coarse sample every 32 m
const FINE_STRIDE = 2; // terrain uses 4 m road segments

const bucketKey = (bx, bz) => (bx + 32768) * 65536 + (bz + 32768);

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.nBase = makeNoise2D(this.seed * 7 + 1);
    this.nHills = makeNoise2D(this.seed * 7 + 2);
    this.nMount = makeNoise2D(this.seed * 7 + 3);
    this.nRoad = makeNoise2D(this.seed * 7 + 4);
    this.nMisc = makeNoise2D(this.seed * 7 + 5);

    // Road samples (plain arrays grow cheaply; doubles keep both threads bit-identical)
    this.rx = [];
    this.rz = [];
    this.ry = [];
    this.rh = []; // heading (0 = +Z, positive turns toward +X)
    this.fine = new Map();
    this.coarse = new Map();

    this._fineList = [];
    this._coarseList = [];
    this._res = { h: 0, d: 0, ry: 0 };

    // First sample
    this._pushSample(0, 0, 0);
  }

  // ----------------------------------------------------------------- road shape
  headingAt(s) {
    const n = this.nRoad;
    const twist = 0.55 + 0.45 * n(s / 3200, 91.7);
    const raw =
      1.0 * n(s / 1700, 0.5) +
      twist * (0.5 * n(s / 430, 7.7) + 0.14 * n(s / 140, 3.3));
    return 1.2 * Math.tanh(raw); // stay within ~±69° of +Z so the road never loops back
  }

  /** Very smooth large-scale elevation that both road and terrain follow. */
  baseHeight(x, z) {
    return 58 * fbm(this.nBase, x / 2700, z / 2700, 3);
  }

  roadHeightRaw(x, z, s) {
    const raw = 58 * fbm(this.nBase, x / 2700, z / 2700, 2) + 4 * this.nRoad(s / 400, 11.1);
    // soft-max against the water level so the road becomes a causeway over lakes
    const floor = WATER_LEVEL + 4.5;
    const k = 0.3;
    const v = (raw - floor) * k;
    return floor + (v > 30 ? v : Math.log1p(Math.exp(v))) / k;
  }

  _pushSample(x, z, s) {
    const i = this.rx.length;
    this.rx.push(x);
    this.rz.push(z);
    // low-pass the elevation along the road and cap the grade (~7%) for a relaxed drive
    const raw = this.roadHeightRaw(x, z, s);
    const prev = i > 0 ? this.ry[i - 1] : raw;
    const step = clamp((raw - prev) * 0.12, -0.14, 0.14);
    this.ry.push(i > 0 ? prev + step : raw);
    this.rh.push(this.headingAt(s));

    const fk = bucketKey(Math.floor(x / FINE_BUCKET), Math.floor(z / FINE_BUCKET));
    let fb = this.fine.get(fk);
    if (!fb) this.fine.set(fk, (fb = []));
    fb.push(i);

    if (i % COARSE_STRIDE === 0) {
      const ck = bucketKey(Math.floor(x / COARSE_BUCKET), Math.floor(z / COARSE_BUCKET));
      let cb = this.coarse.get(ck);
      if (!cb) this.coarse.set(ck, (cb = []));
      cb.push(i);
    }
  }

  get length() {
    return this.rx.length;
  }

  /** Generate road samples until the road has progressed past world z = zTarget. */
  ensureRoadTo(zTarget) {
    let i = this.rx.length - 1;
    while (this.rz[i] < zTarget) {
      const h = this.rh[i];
      const x = this.rx[i] + Math.sin(h) * ROAD_STEP;
      const z = this.rz[i] + Math.cos(h) * ROAD_STEP;
      this._pushSample(x, z, (i + 1) * ROAD_STEP);
      i++;
    }
  }

  // --------------------------------------------------------------- distance queries
  _gatherFine(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const bx0 = Math.floor(minX / FINE_BUCKET), bx1 = Math.floor(maxX / FINE_BUCKET);
    const bz0 = Math.floor(minZ / FINE_BUCKET), bz1 = Math.floor(maxZ / FINE_BUCKET);
    const last = this.rx.length - FINE_STRIDE;
    const seen = new Set();
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const b = this.fine.get(bucketKey(bx, bz));
        if (!b) continue;
        for (let k = 0; k < b.length; k++) {
          let i = b[k];
          i -= i % FINE_STRIDE; // snap to stride so segments line up
          if (i > last || seen.has(i)) continue;
          seen.add(i);
          out.push(i);
          // also include the previous segment so a bucket boundary never loses coverage
          const p = i - FINE_STRIDE;
          if (p >= 0 && !seen.has(p)) {
            seen.add(p);
            out.push(p);
          }
        }
      }
    }
    return out;
  }

  _gatherCoarse(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const bx0 = Math.floor(minX / COARSE_BUCKET), bx1 = Math.floor(maxX / COARSE_BUCKET);
    const bz0 = Math.floor(minZ / COARSE_BUCKET), bz1 = Math.floor(maxZ / COARSE_BUCKET);
    const last = this.rx.length - COARSE_STRIDE;
    const seen = new Set();
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const b = this.coarse.get(bucketKey(bx, bz));
        if (!b) continue;
        for (let k = 0; k < b.length; k++) {
          const i = b[k];
          if (i <= last && !seen.has(i)) {
            seen.add(i);
            out.push(i);
          }
          const p = i - COARSE_STRIDE;
          if (p >= 0 && !seen.has(p)) {
            seen.add(p);
            out.push(p);
          }
        }
      }
    }
    return out;
  }

  /** Returns [fineList, coarseList] valid for any point inside the given box. */
  gatherForBox(minX, minZ, maxX, maxZ, fineOut = [], coarseOut = []) {
    this._gatherFine(minX - NEAR - 4, minZ - NEAR - 4, maxX + NEAR + 4, maxZ + NEAR + 4, fineOut);
    this._gatherCoarse(minX - FAR - 40, minZ - FAR - 40, maxX + FAR + 40, maxZ + FAR + 40, coarseOut);
    return [fineOut, coarseOut];
  }

  /**
   * Core terrain evaluation. Writes {h, d, ry} into `res`.
   * d  = distance to the road centreline (clamped to FAR)
   * ry = road elevation at the nearest road point (only meaningful when d < NEAR)
   */
  evalHeight(x, z, fineList, coarseList, res = this._res) {
    const rx = this.rx, rz = this.rz, ry = this.ry;

    // Coarse distance first
    let best = FAR * FAR;
    for (let k = 0; k < coarseList.length; k++) {
      const i = coarseList[k];
      const j = i + COARSE_STRIDE;
      const ax = rx[i], az = rz[i];
      const ex = rx[j] - ax, ez = rz[j] - az;
      const px = x - ax, pz = z - az;
      let t = (px * ex + pz * ez) / (ex * ex + ez * ez);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ex * t, dz = pz - ez * t;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    let d = Math.sqrt(best);
    let roadY = 0;

    if (d < NEAR) {
      let bestF = 1e12;
      for (let k = 0; k < fineList.length; k++) {
        const i = fineList[k];
        const j = i + FINE_STRIDE;
        const ax = rx[i], az = rz[i];
        const ex = rx[j] - ax, ez = rz[j] - az;
        const px = x - ax, pz = z - az;
        let t = (px * ex + pz * ez) / (ex * ex + ez * ez);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - ex * t, dz = pz - ez * t;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestF) {
          bestF = d2;
          roadY = ry[i] + (ry[j] - ry[i]) * t;
        }
      }
      if (bestF < 1e12) d = Math.sqrt(bestF);
    }

    res.d = d;
    res.ry = roadY;
    res.h = this.terrainFromDistance(x, z, d, roadY);
    return res;
  }

  terrainFromDistance(x, z, d, roadY) {
    const flat = roadY - 0.14;
    const wNear = smoothstep(FLAT_HALF, FLAT_HALF + 42, d);
    if (wNear <= 0) return flat;

    let nat = this.baseHeight(x, z);
    nat += 26 * fbm(this.nHills, x / 480, z / 480, 4) + 3.5 * this.nHills(x / 75 + 100, z / 75 - 40);

    // rolling foothills rising away from the road create a gentle valley feel
    const wFoot = smoothstep(40, 380, d);
    if (wFoot > 0) {
      nat += wFoot * 45 * (0.5 + 0.5 * fbm(this.nMisc, x / 900 + 30, z / 900, 2));
    }

    const wM = smoothstep(140, FAR, d);
    if (wM > 0) {
      const mask = smoothstep(-0.4, 0.35, this.nMount(x / 5200 + 50, z / 5200 - 20));
      const m = ridged(this.nMount, x / 1350, z / 1350, 5);
      nat += wM * m * m * 520 * (0.18 + 0.82 * mask);
    }

    return flat + (nat - flat) * wNear;
  }

  /** Height query at an arbitrary point (main-thread physics). */
  heightAt(x, z) {
    this.gatherForBox(x, z, x, z, this._fineList, this._coarseList);
    return this.evalHeight(x, z, this._fineList, this._coarseList, this._res);
  }

  // ------------------------------------------------------------------ road helpers
  /** Index of the road sample nearest (x,z), searching around `hint` first. */
  nearestIndex(x, z, hint = -1) {
    const n = this.rx.length;
    let bestI = -1, best = Infinity;
    if (hint >= 0) {
      const a = Math.max(0, hint - 80), b = Math.min(n - 1, hint + 80);
      for (let i = a; i <= b; i++) {
        const dx = this.rx[i] - x, dz = this.rz[i] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bestI = i; }
      }
      if (best < 30 * 30) return bestI;
    }
    // hash search in growing rings
    for (let r = 1; r <= 12; r++) {
      const bx = Math.floor(x / FINE_BUCKET), bz = Math.floor(z / FINE_BUCKET);
      for (let ix = bx - r; ix <= bx + r; ix++) {
        for (let iz = bz - r; iz <= bz + r; iz++) {
          const bucket = this.fine.get(bucketKey(ix, iz));
          if (!bucket) continue;
          for (const i of bucket) {
            const dx = this.rx[i] - x, dz = this.rz[i] - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < best) { best = d2; bestI = i; }
          }
        }
      }
      if (bestI >= 0) return bestI;
    }
    return bestI >= 0 ? bestI : clamp(hint, 0, n - 1);
  }

  /** Signed curvature (1/m) at sample i, positive = turning toward +X / left. */
  curvatureAt(i) {
    const a = clamp(i - 2, 0, this.rh.length - 1);
    const b = clamp(i + 2, 0, this.rh.length - 1);
    if (a === b) return 0;
    return (this.rh[b] - this.rh[a]) / ((b - a) * ROAD_STEP);
  }

  // --------------------------------------------------------------- terrain chunks
  /**
   * Build all vertex data for one terrain chunk. Positions are local to the chunk corner.
   * Returns typed arrays ready for transfer to the main thread.
   */
  buildChunk(cx, cz, segs, withProps) {
    const size = CHUNK_SIZE;
    const ox = cx * size, oz = cz * size;
    this.ensureRoadTo(oz + size + FAR + 200);

    const fineList = [], coarseList = [];
    const sp = size / segs;
    this.gatherForBox(ox - sp, oz - sp, ox + size + sp, oz + size + sp, fineList, coarseList);

    const G = segs + 3; // grid with one-vertex border for normals
    const hs = new Float32Array(G * G);
    const ds = new Float32Array(G * G);
    const res = { h: 0, d: 0, ry: 0 };
    for (let j = 0; j < G; j++) {
      const z = oz + (j - 1) * sp;
      for (let i = 0; i < G; i++) {
        const x = ox + (i - 1) * sp;
        this.evalHeight(x, z, fineList, coarseList, res);
        // Coarse grids interpolate linearly between vertices, so any vertex close to the
        // road is pinned to road level; otherwise triangles spanning the road could poke
        // through the asphalt.
        hs[j * G + i] = res.d < FLAT_HALF + sp * 1.1 ? res.ry - 0.14 : res.h;
        ds[j * G + i] = res.d;
      }
    }

    const V = segs + 1;
    const skirtCount = segs * 4;
    const total = V * V + skirtCount;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);

    const c = [0, 0, 0];
    let minH = Infinity, maxH = -Infinity;
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const g = (j + 1) * G + (i + 1);
        const h = hs[g];
        const hL = hs[g - 1], hR = hs[g + 1], hD = hs[g - G], hU = hs[g + G];
        let nx = hL - hR, ny = 2 * sp, nz = hD - hU;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx *= inv; ny *= inv; nz *= inv;

        const v = j * V + i;
        pos[v * 3] = i * sp;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = j * sp;
        nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
        this.terrainColor(ox + i * sp, oz + j * sp, h, ny, ds[g], c);
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }

    // Skirts: duplicate the border ring, pushed down, to hide LOD cracks.
    const drop = 4 + sp * 1.5;
    const border = [];
    for (let i = 0; i < segs; i++) border.push(i); // bottom edge (j=0), left→right
    for (let j = 0; j < segs; j++) border.push(j * V + segs); // right edge
    for (let i = segs; i > 0; i--) border.push(segs * V + i); // top edge
    for (let j = segs; j > 0; j--) border.push(j * V); // left edge
    for (let k = 0; k < border.length; k++) {
      const src = border[k];
      const dst = V * V + k;
      pos[dst * 3] = pos[src * 3];
      pos[dst * 3 + 1] = pos[src * 3 + 1] - drop;
      pos[dst * 3 + 2] = pos[src * 3 + 2];
      nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
      col[dst * 3] = col[src * 3]; col[dst * 3 + 1] = col[src * 3 + 1]; col[dst * 3 + 2] = col[src * 3 + 2];
    }

    const out = { cx, cz, segs, pos, nor, col, minH: minH - drop, maxH };
    if (withProps) Object.assign(out, this.buildProps(ox, oz, size, fineList, coarseList));
    return out;
  }

  terrainColor(x, z, h, ny, d, out) {
    const n1 = this.nMisc(x / 160, z / 160);
    const n2 = this.nMisc(x / 35 + 300, z / 35);
    // palette (sRGB 0..1)
    let r, g, b;
    // grass: blend lush green ↔ dry meadow
    const dry = smoothstep(-0.5, 0.7, n1 + 0.35 * n2 + (h - 20) / 160);
    r = lerp(0.29, 0.62, dry);
    g = lerp(0.47, 0.6, dry);
    b = lerp(0.2, 0.3, dry);
    // darker, cooler tones where forests grow (reads as woodland from far away)
    const forest = smoothstep(-0.05, 0.4, fbm(this.nMisc, x / 650 - 70, z / 650 + 20, 3)) * (1 - smoothstep(180, 250, h));
    r = lerp(r, 0.17, forest * 0.55); g = lerp(g, 0.3, forest * 0.55); b = lerp(b, 0.17, forest * 0.55);
    const shade = 1 + 0.07 * n2;
    r *= shade; g *= shade; b *= shade;

    // sand / shore
    const sand = 1 - smoothstep(WATER_LEVEL + 0.8, WATER_LEVEL + 3.5, h);
    r = lerp(r, 0.78, sand); g = lerp(g, 0.72, sand); b = lerp(b, 0.55, sand);

    // gravel verge near the road
    const verge = 1 - smoothstep(FLAT_HALF - 0.5, FLAT_HALF + 3, d);
    r = lerp(r, 0.52, verge * 0.7); g = lerp(g, 0.5, verge * 0.7); b = lerp(b, 0.42, verge * 0.7);

    // rock on steep slopes & high up
    const rock = Math.max(1 - smoothstep(0.62, 0.8, ny), smoothstep(150, 260, h + n2 * 20) * 0.85);
    const rk = 0.5 + 0.06 * n1;
    r = lerp(r, rk, rock); g = lerp(g, rk * 0.97, rock); b = lerp(b, rk * 0.95, rock);

    // snow caps
    const snow = smoothstep(250, 300, h + n1 * 35) * smoothstep(0.55, 0.75, ny);
    r = lerp(r, 0.95, snow); g = lerp(g, 0.96, snow); b = lerp(b, 0.99, snow);

    // sRGB → linear (vertex colours are interpreted as linear by three.js)
    out[0] = Math.pow(r, 2.2);
    out[1] = Math.pow(g, 2.2);
    out[2] = Math.pow(b, 2.2);
  }

  buildProps(ox, oz, size, fineList, coarseList) {
    const cell = 13;
    const n = Math.floor(size / cell);
    const trees = { conifer: [], broad: [], rock: [] };
    const res = { h: 0, d: 0, ry: 0 };
    const seed = this.seed;
    const hashf = (a, b, c) => {
      let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041) + seed * 97) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
    const baseI = Math.round(ox / cell), baseJ = Math.round(oz / cell);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const gi = baseI + i, gj = baseJ + j;
        const r0 = hashf(gi, gj, 1);
        const x = ox + (i + 0.15 + 0.7 * hashf(gi, gj, 2)) * cell;
        const z = oz + (j + 0.15 + 0.7 * hashf(gi, gj, 3)) * cell;
        const forest = fbm(this.nMisc, x / 650 - 70, z / 650 + 20, 3);
        const density = smoothstep(-0.05, 0.4, forest) * 0.9 + 0.035;
        const wantTree = r0 < density;
        const wantRock = !wantTree && r0 > 0.985;
        if (!wantTree && !wantRock) continue;

        this.evalHeight(x, z, fineList, coarseList, res);
        if (res.d < FLAT_HALF + 4) continue;
        const h = res.h;
        if (h < WATER_LEVEL + 1.8) continue;
        // slope estimate
        const e = 2.5;
        this.evalHeight(x + e, z, fineList, coarseList, res);
        const hx = res.h;
        this.evalHeight(x, z + e, fineList, coarseList, res);
        const hz = res.h;
        const slope = Math.hypot(hx - h, hz - h) / e;

        const lx = x - ox, lz = z - oz;
        const rot = hashf(gi, gj, 4) * Math.PI * 2;
        const r5 = hashf(gi, gj, 5);
        if (wantRock) {
          if (slope > 1.2) continue;
          const s = 0.6 + r5 * 2.2;
          trees.rock.push(lx, h - 0.3 * s, lz, rot, s, s * (0.6 + hashf(gi, gj, 6) * 0.5), 0.9 + r5 * 0.2);
          continue;
        }
        if (slope > 0.75 || h > 235 + 25 * this.nMisc(x / 90, z / 90)) continue;
        const conifer = h > 70 || hashf(gi, gj, 7) < 0.55 + 0.3 * forest;
        const s = conifer ? 0.75 + r5 * 0.85 : 0.7 + r5 * 0.7;
        const tint = hashf(gi, gj, 8);
        (conifer ? trees.conifer : trees.broad).push(lx, h - 0.4, lz, rot, s, s * (0.85 + tint * 0.35), tint);
      }
    }
    return {
      conifer: packInstances(trees.conifer, [0.16, 0.36, 0.2], [0.3, 0.46, 0.22]),
      broad: packInstances(trees.broad, [0.36, 0.52, 0.2], [0.62, 0.62, 0.24]),
      rock: packInstances(trees.rock, [0.52, 0.5, 0.48], [0.66, 0.64, 0.6]),
    };
  }
}

/** Convert [x,y,z,rot,sxz,sy,tint]* into instance matrices + colours. */
function packInstances(list, colA, colB) {
  const count = list.length / 7;
  const mats = new Float32Array(count * 16);
  const cols = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    const [x, y, z, rot, s, sy, tint] = list.slice(k * 7, k * 7 + 7);
    const c = Math.cos(rot), sn = Math.sin(rot);
    const m = k * 16;
    mats[m] = c * s; mats[m + 1] = 0; mats[m + 2] = -sn * s; mats[m + 3] = 0;
    mats[m + 4] = 0; mats[m + 5] = sy; mats[m + 6] = 0; mats[m + 7] = 0;
    mats[m + 8] = sn * s; mats[m + 9] = 0; mats[m + 10] = c * s; mats[m + 11] = 0;
    mats[m + 12] = x; mats[m + 13] = y; mats[m + 14] = z; mats[m + 15] = 1;
    for (let q = 0; q < 3; q++) cols[k * 3 + q] = Math.pow(lerp(colA[q], colB[q], tint), 2.2);
  }
  return { count, mats, cols };
}
