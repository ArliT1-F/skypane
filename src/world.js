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

export const PROP_KEYS = [
  'conifer',
  'broad',
  'dreamTree',
  'bush',
  'flower',
  'rock',
  'crystal',
  'pillar',
  'floatingDiamond',
  'floatingRing',
  'roadSign',
  'lantern',
  // biome set
  'cactus',
  'deadTree',
  'tumbleweed',
  'palm',
  'reed',
  'lilyPad',
  'snowPine',
  'snowman',
  'autumnTree',
  'sunflower',
  'mushroom',
  'log',
  'fence',
  'hayBale',
  'windmill',
  'windmillBlades',
  'balloon',
  'monolith',
  'arch',
  'standingStone',
];

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
    // climate fields: temperature / moisture drive biomes, a third mask marks farmland
    this.nTemp = makeNoise2D(this.seed * 7 + 6);
    this.nMoist = makeNoise2D(this.seed * 7 + 7);
    this.nFarm = makeNoise2D(this.seed * 7 + 8);

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

  // ------------------------------------------------------------------ biomes
  /**
   * Climate-driven biome weights at (x, z). All values 0..1 and smoothly blended,
   * so borders between biomes transition over hundreds of metres. `withFarm` can
   * skip the farmland mask where it is not needed (hot paths).
   */
  biomeWeights(x, z, withFarm = true, out = {}) {
    const t = this.nTemp(x / 4200, z / 4200);
    const m = this.nMoist(x / 3100 + 37, z / 3100 - 59);
    out.snow = smoothstep(-0.16, -0.44, t);
    out.desert = smoothstep(0.26, 0.54, t) * smoothstep(0.12, -0.2, m);
    out.blossom = smoothstep(0.16, 0.42, t) * smoothstep(0.18, 0.48, m) * (1 - out.desert);
    out.autumn = smoothstep(-0.04, 0.2, t) * smoothstep(0.08, -0.22, m) * (1 - out.desert) * (1 - out.snow);
    out.farm = withFarm
      ? smoothstep(0.12, 0.42, this.nFarm(x / 1600 + 83, z / 1600 - 21)) * (1 - out.snow) * (1 - out.desert) * (1 - out.blossom)
      : 0;
    return out;
  }

  /** Human-readable biome name, used for the HUD label and "entering …" toasts. */
  biomeName(x, z) {
    const w = this.biomeWeights(x, z);
    if (w.snow > 0.72) return 'snowfields';
    if (w.desert > 0.72) return 'desert dunes';
    if (w.blossom > 0.62) return 'blossom grove';
    if (w.autumn > 0.6) return 'autumn woods';
    if (w.farm > 0.55) return 'farmland';
    const f = fbm(this.nMisc, x / 650 - 70, z / 650 + 20, 3);
    if (f > 0.26) return 'deep forest';
    return 'open meadow';
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
    res.ri = -1;
    if (d < NEAR) {
      let bestF = 1e12;
      let bestI = -1;
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
          bestI = i;
          roadY = ry[i] + (ry[j] - ry[i]) * t;
        }
      }
      if (bestF < 1e12) {
        d = Math.sqrt(bestF);
        res.ri = bestI;
      }
    }

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

    // desert dunes: rolling sand waves that flatten out near the road corridor
    const desert = smoothstep(0.26, 0.54, this.nTemp(x / 4200, z / 4200)) * smoothstep(0.12, -0.2, this.nMoist(x / 3100 + 37, z / 3100 - 59));
    if (desert > 0.02) {
      const dune =
        Math.pow(1 - Math.abs(this.nMisc(x / 175 + 137, z / 175 - 61)), 1.5) * 10 +
        1.5 * this.nMisc(x / 42 - 5, z / 42 + 31);
      const away = 1 - smoothstep(FLAT_HALF + 24, FLAT_HALF + 150, d);
      nat = nat * (1 - 0.55 * desert) + desert * (7 + dune * away + 14 * fbm(this.nBase, x / 950 + 7, z / 950 - 3, 2));
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
    // grass: blend lush pastel green ↔ sunlit meadow
    const dry = smoothstep(-0.5, 0.7, n1 + 0.35 * n2 + (h - 20) / 160);
    r = lerp(0.32, 0.64, dry);
    g = lerp(0.52, 0.66, dry);
    b = lerp(0.24, 0.35, dry);
    // cooler, dreamy tones where forests grow
    const forest = smoothstep(-0.05, 0.4, fbm(this.nMisc, x / 650 - 70, z / 650 + 20, 3)) * (1 - smoothstep(180, 250, h));
    r = lerp(r, 0.19, forest * 0.52);
    g = lerp(g, 0.34, forest * 0.52);
    b = lerp(b, 0.22, forest * 0.52);
    const shade = 1 + 0.07 * n2;
    r *= shade; g *= shade; b *= shade;

    // biome tinting (climate fields mirror biomeWeights, inlined for speed)
    const t = this.nTemp(x / 4200, z / 4200);
    const m = this.nMoist(x / 3100 + 37, z / 3100 - 59);
    const wSnow = smoothstep(-0.16, -0.44, t);
    const wDesert = smoothstep(0.26, 0.54, t) * smoothstep(0.12, -0.2, m);
    const wBlossom = smoothstep(0.16, 0.42, t) * smoothstep(0.18, 0.48, m) * (1 - wDesert);
    const wAutumn = smoothstep(-0.04, 0.2, t) * smoothstep(0.08, -0.22, m) * (1 - wDesert) * (1 - wSnow);
    if (wDesert > 0.003) {
      // rippled sand with gentle tone variation
      const grain = 0.06 * n2 + 0.04 * n1;
      const k = wDesert * (1 - 0.55 * smoothstep(0.55, 0.8, ny));
      r = lerp(r, 0.85 + grain, k);
      g = lerp(g, 0.72 + grain, k);
      b = lerp(b, 0.5 + grain, k);
    }
    if (wAutumn > 0.003) {
      // patchy fallen-leaf litter
      const litter = wAutumn * smoothstep(-0.15, 0.35, this.nMisc(x / 90 - 40, z / 90 + 77));
      r = lerp(r, 0.63, litter * 0.6);
      g = lerp(g, 0.43, litter * 0.6);
      b = lerp(b, 0.2, litter * 0.6);
    }
    if (wBlossom > 0.003) {
      // lush spring green with occasional petal dusting
      const lush = wBlossom * 0.45;
      r = lerp(r, 0.33, lush);
      g = lerp(g, 0.58, lush);
      b = lerp(b, 0.29, lush);
      const petals = wBlossom * smoothstep(0.45, 0.75, n2) * 0.18;
      r = lerp(r, 0.85, petals);
      g = lerp(g, 0.72, petals);
      b = lerp(b, 0.78, petals);
    }
    if (wSnow > 0.003) {
      // snow settles on flat ground well below the normal mountain snowline
      const gs = wSnow * smoothstep(0.42, 0.7, ny) * (1 - 0.5 * smoothstep(120, 200, h));
      r = lerp(r, 0.93, gs);
      g = lerp(g, 0.95, gs);
      b = lerp(b, 1.0, gs);
    }

    // sand / shore
    const sand = 1 - smoothstep(WATER_LEVEL + 0.8, WATER_LEVEL + 3.5, h);
    r = lerp(r, 0.82, sand); g = lerp(g, 0.75, sand); b = lerp(b, 0.58, sand);

    // gravel verge near the road
    const verge = 1 - smoothstep(FLAT_HALF - 0.5, FLAT_HALF + 3, d);
    r = lerp(r, 0.54, verge * 0.65); g = lerp(g, 0.52, verge * 0.65); b = lerp(b, 0.44, verge * 0.65);

    // rock on steep slopes & high up
    const rock = Math.max(1 - smoothstep(0.62, 0.8, ny), smoothstep(150, 260, h + n2 * 20) * 0.85);
    const rk = 0.52 + 0.06 * n1;
    r = lerp(r, rk, rock); g = lerp(g, rk * 0.97, rock); b = lerp(b, rk * 0.96, rock);

    // snow caps with soft violet/blue tint (not in the deep desert)
    const snow = smoothstep(250, 300, h + n1 * 35) * smoothstep(0.55, 0.75, ny) * (1 - wDesert);
    r = lerp(r, 0.96, snow); g = lerp(g, 0.97, snow); b = lerp(b, 1.0, snow);

    // sRGB → linear (vertex colours are interpreted as linear by three.js)
    out[0] = Math.pow(r, 2.2);
    out[1] = Math.pow(g, 2.2);
    out[2] = Math.pow(b, 2.2);
  }

  buildProps(ox, oz, size, fineList, coarseList) {
    const cell = 9.2; // dense cell grid for a detailed, non-barren world
    const n = Math.floor(size / cell);
    const props = {};
    for (const k of PROP_KEYS) props[k] = [];
    const push = (k, x, y, z, rot, sx, sy, tint) => props[k].push(x, y, z, rot, sx, sy, tint);

    const res = { h: 0, d: 0, ry: 0, ri: -1 };
    const slopeRes = { h: 0, d: 0, ry: 0, ri: -1 };
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
        const r1 = hashf(gi, gj, 2);
        const r2 = hashf(gi, gj, 3);
        const r3 = hashf(gi, gj, 4);
        const r4 = hashf(gi, gj, 5);
        const r5 = hashf(gi, gj, 6);
        const r6 = hashf(gi, gj, 7);
        const r7 = hashf(gi, gj, 8);

        const x = ox + (i + 0.15 + 0.7 * r1) * cell;
        const z = oz + (j + 0.15 + 0.7 * r2) * cell;

        this.evalHeight(x, z, fineList, coarseList, res);
        const h = res.h;
        const d = res.d;
        const w = this.biomeWeights(x, z);
        const rot = r3 * Math.PI * 2;

        // ---------------------------------------------------------- water & shore
        if (h < WATER_LEVEL + 1.2) {
          // lily pads drift on shallow, sheltered water
          if (h > WATER_LEVEL - 1.8 && r0 < 0.055 && w.desert < 0.5 && w.snow < 0.5) {
            push('lilyPad', x - ox, WATER_LEVEL + 0.05, z - oz, rot, 0.7 + r4 * 0.8, 1, r7);
            if (r4 > 0.55) {
              push('lilyPad', x - ox + (r5 - 0.5) * 2.6, WATER_LEVEL + 0.05, z - oz + (r6 - 0.5) * 2.6, rot * 2, 0.45 + r5 * 0.5, 1, r7);
            }
          }
          continue;
        }

        // just above the waterline: reed beds everywhere, palms at desert oases
        if (h < WATER_LEVEL + 2.6 && d > FLAT_HALF + 2) {
          if (r0 < 0.3 && w.snow < 0.5) {
            push('reed', x - ox, h - 0.12, z - oz, rot, 0.8 + r4 * 0.7, 0.8 + r5 * 0.6, r7);
            continue;
          }
          if (r0 > 0.962 && w.desert > 0.45) {
            push('palm', x - ox, h - 0.3, z - oz, rot, 0.9 + r4 * 0.4, 0.9 + r4 * 0.4, r7);
            continue;
          }
          if (r0 < 0.55) continue;
        }

        // ------------------------------------------------------ roadside verge
        if (d >= FLAT_HALF + 0.4 && d < FLAT_HALF + 4.8) {
          // farmland fences chain along the road, aligned to the road heading
          if (w.farm > 0.5 && r0 > 0.3 && r0 < 0.62 && res.ri >= 0) {
            const fh = this.rh[res.ri];
            push('fence', x - ox, res.ry - 0.05, z - oz, fh - Math.PI / 2, 0.9 + r4 * 0.15, 0.9 + r4 * 0.15, r7);
            continue;
          }
          if (w.desert > 0.6) {
            // desert roadside: scattered pebbles instead of flowers
            if (r0 < 0.06) {
              push('rock', x - ox, res.ry - 0.1, z - oz, rot, 0.22 + r4 * 0.3, 0.18 + r4 * 0.25, 0.8 + r7 * 0.2);
            }
            continue;
          }
          // Wildflower verge clumps
          if (r0 < 0.32) {
            const s = 0.6 + r4 * 0.5;
            push('flower', x - ox, res.ry - 0.04, z - oz, rot, s, s, r7);
            continue;
          }
          // Roadside vintage lanterns
          if (r0 > 0.94) {
            const s = 0.85 + r4 * 0.2;
            push('lantern', x - ox, res.ry - 0.08, z - oz, rot, s, s, r7);
            continue;
          }
          // Roadside chevron sign on curves
          if (r0 > 0.88 && r0 <= 0.94) {
            const s = 0.9 + r4 * 0.2;
            push('roadSign', x - ox, res.ry - 0.05, z - oz, rot, s, s, r7);
            continue;
          }
          continue;
        }

        // Keep road and shoulder clear
        if (d < FLAT_HALF + 3.8) continue;

        const lx = x - ox, lz = z - oz;

        // --------------------------------------------- rare skyline dream features
        if (r0 > 0.98 && h > WATER_LEVEL + 4) {
          const isRing = r4 < 0.36;
          const floatAlt = isRing ? 12 + r5 * 22 : 8 + r5 * 18;
          const s = isRing ? 1.0 + r6 * 0.6 : 0.85 + r6 * 0.65;
          push(isRing ? 'floatingRing' : 'floatingDiamond', lx, h + floatAlt, lz, rot, s, s, r7);
          continue;
        }
        if (r0 > 0.9775 && r0 <= 0.98 && h > WATER_LEVEL + 4) {
          // hot-air balloon drifting high above the world
          const s = 0.8 + r5 * 0.5;
          push('balloon', lx, h + 16 + r6 * 26, lz, rot, s, s, r7);
          continue;
        }

        // slope calculation (needed for everything grounded from here on)
        const e = 2.5;
        this.evalHeight(x + e, z, fineList, coarseList, slopeRes);
        const hx = slopeRes.h;
        this.evalHeight(x, z + e, fineList, coarseList, slopeRes);
        const hz = slopeRes.h;
        const slope = Math.hypot(hx - h, hz - h) / e;

        // a leaning dark monolith, dreamcore mood piece
        if (r0 > 0.9765 && r0 <= 0.9775 && slope < 0.45) {
          const s = 0.8 + r5 * 0.5;
          push('monolith', lx, h - 0.35, lz, rot, s, s * (0.9 + r6 * 0.3), r7);
          continue;
        }

        // --------------------------------------------- dreamcore ground features
        if (r0 > 0.965 && r0 <= 0.9765 && slope < 0.55 && h < 220) {
          if (r4 < 0.5) {
            const s = 0.85 + r5 * 0.45;
            push('pillar', lx, h - 0.2, lz, rot, s, s * (0.9 + r6 * 0.3), r7);
          } else {
            const s = 0.8 + r5 * 0.6;
            push('crystal', lx, h - 0.15, lz, rot, s, s * (0.8 + r6 * 0.4), r7);
          }
          continue;
        }
        // ancient stone henge
        if (r0 > 0.9635 && r0 <= 0.965 && slope < 0.3 && w.desert < 0.4 && w.snow < 0.4) {
          const R = 4.5 + r4 * 2.5;
          const cnt = 7 + Math.floor(r5 * 3);
          for (let k = 0; k < cnt; k++) {
            const a = (k / cnt) * Math.PI * 2 + r6 * Math.PI;
            const sy = 0.95 + (((k * 37 + r6 * 100) % 60) / 100);
            push('standingStone', lx + Math.cos(a) * R, h - 0.95, lz + Math.sin(a) * R, a + r6, 0.8 + r7 * 0.4, sy, (k * 0.37 + r7) % 1);
          }
          continue;
        }
        // fairy ring of glowing mushrooms
        if (r0 > 0.962 && r0 <= 0.9635 && slope < 0.35 && h < 200 && w.desert < 0.4 && w.snow < 0.4) {
          const R = 1.6 + r4 * 1.2;
          const cnt = 6 + Math.floor(r5 * 3);
          for (let k = 0; k < cnt; k++) {
            const a = (k / cnt) * Math.PI * 2 + r6 * Math.PI;
            push('mushroom', lx + Math.cos(a) * R, h - 0.05, lz + Math.sin(a) * R, a * 2, 0.6 + r7 * 0.5, 0.6 + r7 * 0.5, r7);
          }
          continue;
        }

        // ---------------------------------------------------------- boulders
        if (r0 > 0.935 && r0 <= 0.962) {
          if (slope > 1.3) continue;
          const s = 0.7 + r4 * 2.2 + (w.desert > 0.5 ? 0.8 : 0);
          push('rock', lx, h - 0.3 * s, lz, rot, s, s * (0.6 + r5 * 0.5), 0.9 + r4 * 0.2);
          continue;
        }

        // ---------------------------------------------------------- desert
        if (w.desert > 0.5) {
          if (slope < 0.5 && r0 < 0.085) {
            const s = 0.8 + r4 * 0.7;
            push('cactus', lx, h - 0.15, lz, rot, s, s * (0.9 + r5 * 0.3), r7);
            continue;
          }
          if (slope < 0.6 && r0 >= 0.085 && r0 < 0.115) {
            const s = 0.8 + r4 * 0.6;
            push('deadTree', lx, h - 0.2, lz, rot, s, s, r7);
            continue;
          }
          if (slope < 0.6 && r0 >= 0.115 && r0 < 0.155) {
            const s = 0.55 + r4 * 0.5;
            push('tumbleweed', lx, h + 0.5 * s, lz, rot, s, s, r7);
            continue;
          }
          continue;
        }

        // ---------------------------------------------------------- farmland
        if (w.farm > 0.55 && slope < 0.35 && r0 > 0.9 && r0 <= 0.925) {
          push('hayBale', lx, h - 0.05, lz, rot, 0.85 + r4 * 0.4, 0.85 + r4 * 0.4, r7);
          continue;
        }
        if (w.farm > 0.6 && slope < 0.28 && r0 > 0.932 && r0 <= 0.935) {
          const s = 0.85 + r4 * 0.3;
          push('windmill', lx, h - 0.3, lz, rot, s, s, r7);
          // blades spin on a hub protruding from the tower front, same rot & scale
          push('windmillBlades', lx + Math.sin(rot) * 1.35 * s, h - 0.3 + 6.0 * s, lz + Math.cos(rot) * 1.35 * s, rot, s, s, r7);
          continue;
        }

        // ------------------------------------------------- ice & snow extras
        if (w.snow > 0.5 && r0 > 0.9 && r0 <= 0.935 && slope < 0.5) {
          const s = 0.7 + r4 * 0.7;
          push('crystal', lx, h - 0.15, lz, rot, s, s * (0.8 + r5 * 0.5), r7);
          continue;
        }
        if (w.snow > 0.55 && r0 > 0.155 && r0 <= 0.16 && slope < 0.3) {
          push('snowman', lx, h - 0.1, lz, rot, 0.85 + r4 * 0.35, 0.85 + r4 * 0.35, r7);
          continue;
        }

        // --------------------------------------------- meadow / forest floor
        if (slope < 0.65 && h < 210 && w.snow < 0.55 && w.desert < 0.45) {
          if (r0 > 0.82 && r0 <= 0.90) {
            // Flowering bush
            const s = 0.7 + r4 * 0.6;
            push('bush', lx, h - 0.2, lz, rot, s, s * 0.9, r7);
            continue;
          }
          if (r0 > 0.70 && r0 <= 0.82) {
            // Wildflower clump
            const s = 0.6 + r4 * 0.55;
            push('flower', lx, h - 0.1, lz, rot, s, s, r7);
            continue;
          }
          // sunflower patches grow in noise-clustered groupings
          if (r0 > 0.66 && r0 <= 0.70 && slope < 0.5 && h < 160 && w.snow < 0.3 && this.nMisc(x / 60 + 11, z / 60 - 7) > 0.22) {
            const s = 0.8 + r4 * 0.5;
            push('sunflower', lx, h - 0.1, lz, rot, s, s, r7);
            continue;
          }
        }
        const forest = fbm(this.nMisc, x / 650 - 70, z / 650 + 20, 3);
        if (forest > 0.02 && w.snow < 0.4 && w.desert < 0.45 && slope < 0.4 && h < 200) {
          if (r0 > 0.62 && r0 <= 0.66) {
            // glowing mushroom, common under the trees
            push('mushroom', lx, h - 0.05, lz, rot, 0.6 + r4 * 0.55, 0.6 + r4 * 0.55, r7);
            continue;
          }
          if (r0 > 0.60 && r0 <= 0.62) {
            // fallen log
            push('log', lx, h - 0.12, lz, rot, 0.8 + r4 * 0.6, 0.8 + r4 * 0.6, r7);
            continue;
          }
        }

        // ---------------------------------------------------------- trees
        let density = smoothstep(-0.08, 0.38, forest) * 0.88 + 0.035;
        density *= 1 - w.desert;
        density *= 1 - w.snow * 0.4;
        density *= 1 + w.blossom * 0.4;
        if (r0 < density && slope < 0.78 && h < 240 + 25 * this.nMisc(x / 90, z / 90)) {
          if (w.snow > 0.5) {
            const s = 0.75 + r4 * 0.85;
            push('snowPine', lx, h - 0.4, lz, rot, s, s * (0.85 + r7 * 0.35), r7);
            continue;
          }
          const conifer = h > 75 || r6 < 0.48 + 0.28 * forest;
          if (conifer) {
            const s = 0.75 + r4 * 0.85;
            push('conifer', lx, h - 0.4, lz, rot, s, s * (0.85 + r7 * 0.35), r7);
          } else {
            const s = 0.7 + r4 * 0.7;
            if (w.blossom > 0.45 || (w.blossom > 0.2 && r5 < 0.55)) {
              push('dreamTree', lx, h - 0.4, lz, rot, s, s * (0.85 + r7 * 0.35), r7);
            } else if (w.autumn > 0.45 || (w.autumn > 0.2 && r5 < 0.55)) {
              push('autumnTree', lx, h - 0.4, lz, rot, s, s * (0.85 + r7 * 0.35), r7);
            } else if (r5 < 0.42) {
              const ds = 0.85 + r4 * 0.65;
              push('dreamTree', lx, h - 0.4, lz, rot, ds, ds * (0.85 + r7 * 0.35), r7);
            } else {
              push('broad', lx, h - 0.4, lz, rot, s, s * (0.85 + r7 * 0.35), r7);
            }
          }
        }
      }
    }

    return {
      conifer: packInstances(props.conifer, [0.14, 0.35, 0.20], [0.28, 0.48, 0.24]),
      broad: packInstances(props.broad, [0.35, 0.54, 0.22], [0.58, 0.64, 0.26]),
      dreamTree: packInstances(props.dreamTree, [0.98, 0.65, 0.78], [0.95, 0.82, 0.52]),
      bush: packInstances(props.bush, [0.32, 0.52, 0.28], [0.65, 0.45, 0.65]),
      flower: packInstances(props.flower, [0.98, 0.45, 0.58], [0.45, 0.78, 0.98]),
      rock: packInstances(props.rock, [0.52, 0.50, 0.48], [0.68, 0.65, 0.62]),
      crystal: packInstances(props.crystal, [0.65, 0.85, 0.98], [0.92, 0.75, 0.98]),
      pillar: packInstances(props.pillar, [0.88, 0.88, 0.92], [0.95, 0.93, 0.88]),
      floatingDiamond: packInstances(props.floatingDiamond, [0.68, 0.92, 0.98], [0.98, 0.65, 0.92]),
      floatingRing: packInstances(props.floatingRing, [0.98, 0.82, 0.65], [0.72, 0.65, 0.98]),
      roadSign: packInstances(props.roadSign, [0.95, 0.80, 0.35], [0.95, 0.95, 0.92]),
      lantern: packInstances(props.lantern, [0.98, 0.88, 0.62], [0.98, 0.75, 0.45]),
      cactus: packInstances(props.cactus, [0.30, 0.52, 0.30], [0.42, 0.64, 0.34]),
      deadTree: packInstances(props.deadTree, [0.45, 0.38, 0.30], [0.58, 0.51, 0.43]),
      tumbleweed: packInstances(props.tumbleweed, [0.62, 0.52, 0.36], [0.73, 0.63, 0.46]),
      palm: packInstances(props.palm, [0.35, 0.60, 0.30], [0.46, 0.68, 0.32]),
      reed: packInstances(props.reed, [0.42, 0.55, 0.30], [0.55, 0.62, 0.35]),
      lilyPad: packInstances(props.lilyPad, [0.28, 0.54, 0.27], [0.40, 0.65, 0.33]),
      snowPine: packInstances(props.snowPine, [0.82, 0.88, 0.94], [0.99, 1.0, 1.0]),
      snowman: packInstances(props.snowman, [0.96, 0.97, 1.0], [1.0, 1.0, 1.0]),
      autumnTree: packInstances(props.autumnTree, [0.95, 0.55, 0.20], [0.88, 0.30, 0.16]),
      sunflower: packInstances(props.sunflower, [0.95, 0.85, 0.30], [0.98, 0.72, 0.25]),
      mushroom: packInstances(props.mushroom, [0.88, 0.45, 0.55], [0.55, 0.75, 0.95]),
      log: packInstances(props.log, [0.42, 0.33, 0.25], [0.52, 0.42, 0.32]),
      fence: packInstances(props.fence, [0.55, 0.45, 0.35], [0.66, 0.56, 0.46]),
      hayBale: packInstances(props.hayBale, [0.85, 0.68, 0.32], [0.92, 0.78, 0.42]),
      windmill: packInstances(props.windmill, [0.92, 0.90, 0.84], [0.98, 0.96, 0.90]),
      windmillBlades: packInstances(props.windmillBlades, [0.75, 0.65, 0.52], [0.85, 0.76, 0.62]),
      balloon: packInstances(props.balloon, [0.95, 0.45, 0.35], [0.38, 0.62, 0.88]),
      monolith: packInstances(props.monolith, [0.16, 0.15, 0.22], [0.28, 0.26, 0.40]),
      arch: packInstances(props.arch, [0.72, 0.68, 0.60], [0.80, 0.76, 0.68]),
      standingStone: packInstances(props.standingStone, [0.55, 0.55, 0.58], [0.68, 0.68, 0.72]),
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
