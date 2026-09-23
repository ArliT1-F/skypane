// Streams the endless world around the player: terrain chunks with distance LODs,
// the road ribbon, roadside posts, instanced flora and water.
import * as THREE from 'three';
import { Terrain, blendHeight, ROAD_HALF, SHOULDER, ROAD_INFLUENCE, WATER_LEVEL } from './terrain.js';
import { Road, STEP } from './road.js';
import { FLORA_BUILDERS, FLORA_SCALE } from './flora.js';
import { hash2i, mulberry32, Simplex, smoothstep } from '../core/noise.js';
import { createWater } from './water.js';

export const CHUNK = 256;
const ROAD_CHUNK = 32; // samples per road mesh piece (160m)
const TEX_LEN = 24; // meters of road per texture repeat

const LOD_SEGMENTS = [64, 32, 16, 8];

function lodForRing(r) {
  if (r <= 1) return 0;
  if (r <= 3) return 1;
  if (r <= 6) return 2;
  return 3;
}

function makeRoadTexture(renderer, centerHex) {
  const W = 256;
  const H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#4a4a4c';
  g.fillRect(0, 0, W, H);
  // asphalt grain
  const img = g.getImageData(0, 0, W, H);
  const rnd = mulberry32(42);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n + 1;
  }
  g.putImageData(img, 0, 0);
  // worn wheel tracks (slightly lighter)
  const lane = (u) => (u / (ROAD_HALF * 2)) * W;
  g.globalAlpha = 0.07;
  g.fillStyle = '#ffffff';
  for (const u of [1.0, 2.6, 4.8, 6.4]) g.fillRect(lane(u) - 10, 0, 20, H);
  g.globalAlpha = 1;
  // edge lines
  g.fillStyle = '#e8e8e2';
  const edge = lane(0.25);
  g.fillRect(edge - 3, 0, 6, H);
  g.fillRect(W - edge - 3, 0, 6, H);
  // center dashes: 3m dash every 12m
  const c = new THREE.Color(centerHex);
  g.fillStyle = `#${c.getHexString()}`;
  const pxPerM = H / TEX_LEN;
  for (let m = 0; m < TEX_LEN; m += 12) g.fillRect(W / 2 - 3, m * pxPerM, 6, 3.5 * pxPerM);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makePostGeometry() {
  const post = new THREE.BoxGeometry(0.14, 1.05, 0.14).translate(0, 0.52, 0).toNonIndexed();
  const n = post.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = post.attributes.position.getY(i);
    const dark = y > 0.82 ? 0.08 : 0.92;
    col[i * 3] = dark;
    col[i * 3 + 1] = dark;
    col[i * 3 + 2] = dark;
  }
  post.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return post;
}

const _near = { found: false };
const _near2 = { found: false };
const _col = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class World {
  constructor({ scene, renderer, seed, biome, quality }) {
    this.scene = scene;
    this.renderer = renderer;
    this.seed = seed;
    this.biome = biome;
    this.setQuality(quality);

    this.terrain = new Terrain(seed, biome);
    this.road = new Road(this.terrain, seed);
    this.floraNoise = new Simplex(seed + 999);

    this.group = new THREE.Group();
    scene.add(this.group);

    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.roadTex = makeRoadTexture(renderer, biome.centerLine);
    this.roadMat = new THREE.MeshLambertMaterial({ map: this.roadTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.postGeo = makePostGeometry();
    this.postMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.reflectorGeo = new THREE.BoxGeometry(0.1, 0.12, 0.16).translate(0, 0.72, 0);
    this.reflectorMat = new THREE.MeshBasicMaterial({ color: 0xffa640 });

    this.floraGeos = {};
    this.floraMats = {};
    for (const f of biome.flora) {
      if (!this.floraGeos[f.type]) {
        this.floraGeos[f.type] = FLORA_BUILDERS[f.type]();
        this.floraMats[f.type] = new THREE.MeshLambertMaterial({ vertexColors: true });
      }
    }
    this.floraColorSets = biome.flora.map((f) => f.colors.map((h) => new THREE.Color(h)));
    this.floraCum = [];
    let acc = 0;
    for (const f of biome.flora) {
      acc += f.weight;
      this.floraCum.push(acc);
    }
    this.floraTotal = acc;

    this.chunks = new Map();
    this.roadChunks = new Map();
    this.water = null;
    if (biome.water) {
      this.water = createWater(biome);
      scene.add(this.water.mesh);
    }
    this.centerCX = null;
    this.centerCZ = null;
    this.queue = [];
    this.pending = 0;
  }

  setQuality(q) {
    this.quality = q;
    this.viewDist = q === 'low' ? 1500 : q === 'high' ? 3000 : 2300;
    this.floraDist = q === 'low' ? 450 : q === 'high' ? 1000 : 750;
    this.floraDensity = q === 'low' ? 0.6 : 1;
    this.shadows = q !== 'low';
    this.centerCX = null; // force re-evaluation
  }

  /* ---------------- height queries ---------------- */

  groundHeight(x, z) {
    const raw = this.terrain.rawHeight(x, z);
    this.road.nearest(x, z, ROAD_INFLUENCE, _near);
    if (!_near.found) return raw;
    return blendHeight(raw, _near.dist, _near.h, false);
  }

  /** ground + info about the nearest road */
  probe(x, z, out) {
    const raw = this.terrain.rawHeight(x, z);
    this.road.nearest(x, z, ROAD_INFLUENCE, _near);
    out.onRoad = false;
    out.roadDist = Infinity;
    if (_near.found) {
      out.h = blendHeight(raw, _near.dist, _near.h, false);
      out.roadDist = _near.dist;
      out.onRoad = _near.dist < ROAD_HALF + 0.3;
      out.lateral = _near.lateral;
      out.s = _near.s;
    } else {
      out.h = raw;
    }
    out.water = out.h < WATER_LEVEL - 0.2 && !!this.biome.water;
    return out;
  }

  /* ---------------- streaming ---------------- */

  update(px, pz, camera, budgetMs = 6) {
    const t0 = performance.now();
    // road must extend beyond anything that might be drawn
    this.road.ensure(-pz + this.viewDist + CHUNK + ROAD_INFLUENCE + 200);

    const cx = Math.floor(px / CHUNK);
    const cz = Math.floor(pz / CHUNK);
    if (cx !== this.centerCX || cz !== this.centerCZ) {
      this.centerCX = cx;
      this.centerCZ = cz;
      this._plan(px, pz);
    }

    // build queued work within budget (always at least one item)
    let did = 0;
    while (this.queue.length && (did === 0 || performance.now() - t0 < budgetMs)) {
      const job = this.queue.shift();
      job();
      did++;
    }
    this.pending = this.queue.length;

    this._updateRoadChunks(px, pz);

    if (this.water) this.water.update(camera);
  }

  /** synchronously build everything near (px,pz) — used at startup */
  prime(px, pz, onProgress) {
    this.road.ensure(-pz + this.viewDist + CHUNK + ROAD_INFLUENCE + 200);
    this.centerCX = Math.floor(px / CHUNK);
    this.centerCZ = Math.floor(pz / CHUNK);
    this._plan(px, pz);
    this._updateRoadChunks(px, pz);
    return this.queue.length;
  }

  step(budgetMs) {
    const t0 = performance.now();
    let did = 0;
    while (this.queue.length && (did === 0 || performance.now() - t0 < budgetMs)) {
      this.queue.shift()();
      did++;
    }
    this.pending = this.queue.length;
    return this.queue.length;
  }

  _plan(px, pz) {
    const cx = this.centerCX;
    const cz = this.centerCZ;
    const R = Math.ceil(this.viewDist / CHUNK) + 1;
    const wanted = new Set();
    const jobs = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const ccx = cx + dx;
        const ccz = cz + dz;
        const mx = (ccx + 0.5) * CHUNK;
        const mz = (ccz + 0.5) * CHUNK;
        const d = Math.hypot(mx - px, mz - pz);
        if (d > this.viewDist + CHUNK * 0.75) continue;
        const key = `${ccx},${ccz}`;
        wanted.add(key);
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        const lod = lodForRing(ring);
        const wantFlora = d < this.floraDist + CHUNK * 0.5;
        const ch = this.chunks.get(key);
        if (!ch || ch.lod !== lod) {
          jobs.push({ d: ch ? d + 400 : d, fn: () => this._buildTerrain(ccx, ccz, lod) });
        }
        if (wantFlora && !(ch && ch.flora)) {
          jobs.push({ d: d + 60, fn: () => this._buildFlora(ccx, ccz) });
        } else if (!wantFlora && ch && ch.flora) {
          this._disposeFlora(ch);
        }
      }
    }
    for (const [key, ch] of this.chunks) {
      if (!wanted.has(key)) {
        this._disposeChunk(ch);
        this.chunks.delete(key);
      }
    }
    jobs.sort((a, b) => a.d - b.d);
    this.queue = jobs.map((j) => j.fn);
  }

  _chunk(cx, cz) {
    const key = `${cx},${cz}`;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = { key, cx, cz, lod: -1, mesh: null, flora: null };
      this.chunks.set(key, ch);
    }
    return ch;
  }

  _buildTerrain(cx, cz, lod) {
    const ch = this._chunk(cx, cz);
    if (ch.lod === lod) return;
    const N = LOD_SEGMENTS[lod];
    const cs = CHUNK / N;
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const terrain = this.terrain;
    const road = this.road;
    const cands = road.candidates(x0, z0, x0 + CHUNK, z0 + CHUNK, ROAD_INFLUENCE + cs * 2);
    // distant chunks sink a bit more under the road so coarse triangles don't poke through
    const lodSink = [0, 0.4, 1.2, 2.5][lod];

    const G = N + 3; // with 1-vertex border
    const H = new Float32Array(G * G);
    const D = new Float32Array(G * G).fill(Infinity);
    for (let j = 0; j < G; j++) {
      const z = z0 + (j - 1) * cs;
      for (let i = 0; i < G; i++) {
        const x = x0 + (i - 1) * cs;
        let h = terrain.rawHeight(x, z);
        if (cands.length) {
          road.nearestFrom(x, z, cands, ROAD_INFLUENCE, _near);
          if (_near.found) {
            h = blendHeight(h, _near.dist, _near.h, true);
            if (lodSink && _near.dist < ROAD_HALF + SHOULDER + cs) h -= lodSink;
            D[j * G + i] = _near.dist;
          }
        }
        H[j * G + i] = h;
      }
    }

    const V = N + 1;
    const skirtCount = 4 * N;
    const vcount = V * V + skirtCount;
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const n = new THREE.Vector3();
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const gi = (j + 1) * G + (i + 1);
        const h = H[gi];
        const k = j * V + i;
        pos[k * 3] = i * cs;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = j * cs;
        const hl = H[gi - 1];
        const hr = H[gi + 1];
        const hd = H[gi - G];
        const hu = H[gi + G];
        n.set(hl - hr, 2 * cs, hd - hu).normalize();
        nor[k * 3] = n.x;
        nor[k * 3 + 1] = n.y;
        nor[k * 3 + 2] = n.z;
        terrain.colorAt(x0 + i * cs, z0 + j * cs, h, n.y, D[gi], _col);
        col[k * 3] = _col.r;
        col[k * 3 + 1] = _col.g;
        col[k * 3 + 2] = _col.b;
      }
    }

    const idx = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * V + i;
        const b = a + 1;
        const c = a + V;
        const d = c + 1;
        // alternate diagonal for less directional artifacts
        if ((i + j) & 1) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }

    // skirts hide cracks between neighbouring LODs
    const depth = cs * 0.9 + 3;
    let sk = V * V;
    const edge = [];
    for (let i = 0; i < N; i++) edge.push(i); // top row (j=0) left->right
    for (let j = 0; j < N; j++) edge.push(j * V + N); // right col
    for (let i = N; i > 0; i--) edge.push(N * V + i); // bottom row
    for (let j = N; j > 0; j--) edge.push(j * V); // left col
    const skirtIdx = [];
    for (const e of edge) {
      pos[sk * 3] = pos[e * 3];
      pos[sk * 3 + 1] = pos[e * 3 + 1] - depth;
      pos[sk * 3 + 2] = pos[e * 3 + 2];
      nor[sk * 3] = nor[e * 3];
      nor[sk * 3 + 1] = nor[e * 3 + 1];
      nor[sk * 3 + 2] = nor[e * 3 + 2];
      col[sk * 3] = col[e * 3];
      col[sk * 3 + 1] = col[e * 3 + 1];
      col[sk * 3 + 2] = col[e * 3 + 2];
      skirtIdx.push(sk);
      sk++;
    }
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k];
      const b = edge[(k + 1) % edge.length];
      const sa = skirtIdx[k];
      const sb = skirtIdx[(k + 1) % edge.length];
      idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb); // both windings
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.position.set(x0, 0, z0);
    mesh.receiveShadow = this.shadows && lod <= 1;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    if (ch.mesh) {
      this.group.remove(ch.mesh);
      ch.mesh.geometry.dispose();
    }
    ch.mesh = mesh;
    ch.lod = lod;
  }

  _buildFlora(cx, cz) {
    const ch = this._chunk(cx, cz);
    if (ch.flora) return;
    const biome = this.biome;
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const road = this.road;
    const terrain = this.terrain;
    const fn = this.floraNoise;
    const cands = road.candidates(x0, z0, x0 + CHUNK, z0 + CHUNK, ROAD_INFLUENCE + 8);
    const cell = 8;
    const N = CHUNK / cell;
    const perType = {};
    const rand = mulberry32(hash2i(cx, cz, this.seed));
    const density = biome.density * this.floraDensity;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = x0 + (i + rand()) * cell;
        const z = z0 + (j + rand()) * cell;
        const r0 = rand();
        const r1 = rand();
        const r2 = rand();
        const r3 = rand();
        // forest mask: clumps and clearings
        const f = fn.noise2(x / 420, z / 420) * 0.7 + fn.noise2(x / 90, z / 90) * 0.3;
        const p = density * smoothstep(-0.35, 0.45, f) * 1.6 + 0.03;
        if (r0 > p) continue;
        let h = terrain.rawHeight(x, z);
        let rd = Infinity;
        let rh = 0;
        if (cands.length) {
          road.nearestFrom(x, z, cands, ROAD_INFLUENCE, _near2);
          if (_near2.found) {
            rd = _near2.dist;
            rh = _near2.h;
          }
        }
        // pick type
        let t = r1 * this.floraTotal;
        let ti = 0;
        while (ti < this.floraCum.length - 1 && t > this.floraCum[ti]) ti++;
        const spec = biome.flora[ti];
        const small = spec.type === 'shrub' || spec.type === 'rock';
        const clear = small ? ROAD_HALF + SHOULDER + 2.5 : ROAD_HALF + SHOULDER + 6.5;
        if (rd < clear) continue;
        const hRaw = h;
        if (rd < ROAD_INFLUENCE) h = blendHeight(h, rd, rh, true);
        if (biome.water && h < WATER_LEVEL + 1.2) continue;
        if (h > biome.snowLine + 140 && spec.type !== 'rock') continue;
        // slope check
        // slope check (on the road-shaped ground where it matters)
        const gh = (xx, zz) => (rd < ROAD_INFLUENCE ? this.groundHeight(xx, zz) : terrain.rawHeight(xx, zz));
        const hx = gh(x + 2, z) - gh(x - 2, z);
        const hz = gh(x, z + 2) - gh(x, z - 2);
        const slope = Math.hypot(hx, hz) / 4;
        void hRaw;
        if (slope > (spec.type === 'rock' ? 1.2 : 0.75)) continue;

        let arr = perType[ti];
        if (!arr) arr = perType[ti] = [];
        const [s0, s1] = FLORA_SCALE[spec.type];
        const sc = s0 + (s1 - s0) * r2 * r2;
        arr.push(x - x0, h - 0.15, z - z0, sc, r3 * Math.PI * 2, rand(), rand());
      }
    }

    const meshes = [];
    for (const k in perType) {
      const ti = +k;
      const spec = biome.flora[ti];
      const arr = perType[k];
      const count = arr.length / 7;
      const im = new THREE.InstancedMesh(this.floraGeos[spec.type], this.floraMats[spec.type], count);
      const colors = this.floraColorSets[ti];
      for (let c = 0; c < count; c++) {
        const o = c * 7;
        const sc = arr[o + 3];
        const tilt = spec.type === 'rock' ? 0.3 : 0.06;
        _q.setFromAxisAngle(_up, arr[o + 4]);
        const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler((arr[o + 5] - 0.5) * tilt, 0, (arr[o + 6] - 0.5) * tilt));
        _q.multiply(tq);
        const sy = spec.type === 'rock' ? sc * (0.6 + arr[o + 6] * 0.6) : sc * (0.85 + arr[o + 5] * 0.3);
        _m.compose(_v.set(arr[o], arr[o + 1], arr[o + 2]), _q, _s.set(sc, sy, sc));
        im.setMatrixAt(c, _m);
        _col.copy(colors[Math.floor(arr[o + 5] * colors.length) % colors.length]);
        const v = 0.85 + arr[o + 6] * 0.3;
        _col.multiplyScalar(v);
        im.setColorAt(c, _col);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.position.set(x0, 0, z0);
      im.updateMatrix();
      im.matrixAutoUpdate = false;
      im.computeBoundingSphere();
      im.castShadow = this.shadows;
      im.receiveShadow = false;
      this.group.add(im);
      meshes.push(im);
    }
    ch.flora = meshes;
  }

  _disposeFlora(ch) {
    if (!ch.flora) return;
    for (const m of ch.flora) {
      this.group.remove(m);
      m.dispose();
    }
    ch.flora = null;
  }

  _disposeChunk(ch) {
    if (ch.mesh) {
      this.group.remove(ch.mesh);
      ch.mesh.geometry.dispose();
      ch.mesh = null;
    }
    this._disposeFlora(ch);
  }

  /* ---------------- road meshes ---------------- */

  _updateRoadChunks(px, pz) {
    const road = this.road;
    const maxChunk = Math.floor((road.length - 2) / ROAD_CHUNK) - 1;
    // find chunk range near player via nearest sample
    road.nearest(px, pz, 400, _near);
    let centerIdx;
    if (_near.found) centerIdx = _near.index;
    else {
      // off in the wilds — estimate from progress
      centerIdx = Math.round((-pz - road.startProgress) / STEP);
    }
    const span = Math.ceil(this.viewDist / (ROAD_CHUNK * STEP)) + 1;
    const c0 = Math.max(0, Math.floor(centerIdx / ROAD_CHUNK) - span);
    const c1 = Math.min(maxChunk, Math.floor(centerIdx / ROAD_CHUNK) + span);
    for (let c = c0; c <= c1; c++) {
      if (!this.roadChunks.has(c)) this._buildRoadChunk(c);
    }
    for (const [c, obj] of this.roadChunks) {
      if (c < c0 - 1 || c > c1 + 1) {
        this.group.remove(obj.group);
        obj.dispose();
        this.roadChunks.delete(c);
      }
    }
  }

  _buildRoadChunk(c) {
    const road = this.road;
    const i0 = c * ROAD_CHUNK;
    const i1 = i0 + ROAD_CHUNK;
    const X = road.X;
    const Z = road.Z;
    const Hh = road.H;
    const ox = X[i0];
    const oz = Z[i0];
    const oh = Hh[i0];
    const cols = [
      [-ROAD_HALF - 0.35, -0.45, 0],
      [-ROAD_HALF, 0, 0],
      [ROAD_HALF, 0, 1],
      [ROAD_HALF + 0.35, -0.45, 1],
    ];
    const rows = i1 - i0 + 1;
    const pos = new Float32Array(rows * cols.length * 3);
    const uv = new Float32Array(rows * cols.length * 2);
    const nor = new Float32Array(rows * cols.length * 3);
    for (let r = 0; r < rows; r++) {
      const i = i0 + r;
      const ia = Math.max(0, i - 1);
      const ib = Math.min(road.length - 1, i + 1);
      let dx = X[ib] - X[ia];
      let dz = Z[ib] - Z[ia];
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
      // right vector
      const rx = -dz;
      const rz = dx;
      const grade = (Hh[ib] - Hh[ia]) / (STEP * (ib - ia));
      for (let k = 0; k < cols.length; k++) {
        const [u, dy, tu] = cols[k];
        const o = (r * cols.length + k) * 3;
        pos[o] = X[i] + rx * u - ox;
        pos[o + 1] = Hh[i] + dy - oh;
        pos[o + 2] = Z[i] + rz * u - oz;
        const ny = 1 / Math.sqrt(1 + grade * grade);
        nor[o] = -dx * grade * ny;
        nor[o + 1] = ny;
        nor[o + 2] = -dz * grade * ny;
        const uo = (r * cols.length + k) * 2;
        uv[uo] = tu;
        uv[uo + 1] = (i * STEP) / TEX_LEN;
      }
    }
    const idx = [];
    const C = cols.length;
    for (let r = 0; r < rows - 1; r++) {
      for (let k = 0; k < C - 1; k++) {
        const a = r * C + k;
        const b = a + 1;
        const cc = a + C;
        const d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.roadMat);
    mesh.receiveShadow = this.shadows;

    const group = new THREE.Group();
    group.position.set(ox, oh, oz);
    group.add(mesh);

    // reflector posts every 50m on both sides
    const posts = [];
    const spacing = 10; // samples
    for (let i = i0; i < i1; i++) {
      if (i % spacing !== 0) continue;
      const ib = Math.min(road.length - 1, i + 1);
      let dx = X[ib] - X[i];
      let dz = Z[ib] - Z[i];
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
      for (const side of [-1, 1]) {
        const u = side * (ROAD_HALF + SHOULDER * 0.7);
        const x = X[i] - dz * u;
        const z = Z[i] + dx * u;
        const h = this.groundHeight(x, z);
        if (this.biome.water && h < WATER_LEVEL + 0.2) continue;
        posts.push(x - ox, h - oh, z - oz, Math.atan2(dx, dz), side);
      }
    }
    let postMesh = null;
    let refMesh = null;
    if (posts.length) {
      const n = posts.length / 5;
      postMesh = new THREE.InstancedMesh(this.postGeo, this.postMat, n);
      refMesh = new THREE.InstancedMesh(this.reflectorGeo, this.reflectorMat, n);
      for (let k = 0; k < n; k++) {
        const o = k * 5;
        _q.setFromAxisAngle(_up, posts[o + 3]);
        _m.compose(_v.set(posts[o], posts[o + 1], posts[o + 2]), _q, _s.set(1, 1, 1));
        postMesh.setMatrixAt(k, _m);
        refMesh.setMatrixAt(k, _m);
      }
      postMesh.computeBoundingSphere();
      refMesh.computeBoundingSphere();
      postMesh.castShadow = this.shadows;
      group.add(postMesh, refMesh);
    }
    group.updateMatrixWorld(true);
    this.group.add(group);
    this.roadChunks.set(c, {
      group,
      dispose: () => {
        geo.dispose();
        if (postMesh) postMesh.dispose();
        if (refMesh) refMesh.dispose();
      },
    });
  }

  dispose() {
    for (const ch of this.chunks.values()) this._disposeChunk(ch);
    this.chunks.clear();
    for (const obj of this.roadChunks.values()) obj.dispose();
    this.roadChunks.clear();
    this.scene.remove(this.group);
    if (this.water) {
      this.scene.remove(this.water.mesh);
      this.water.dispose();
    }
    this.terrainMat.dispose();
    this.roadMat.dispose();
    this.roadTex.dispose();
    this.postGeo.dispose();
    this.postMat.dispose();
    this.reflectorGeo.dispose();
    this.reflectorMat.dispose();
    for (const k in this.floraGeos) {
      this.floraGeos[k].dispose();
      this.floraMats[k].dispose();
    }
    this.queue = [];
  }
}
