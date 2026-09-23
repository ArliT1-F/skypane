import * as THREE from 'three';
import { CHUNK_SIZE, PROP_KEYS } from './world.js';

// LOD rings, measured in chunks (Chebyshev distance from the car's chunk).
const LODS = [
  { max: 1, segs: 64, props: true },
  { max: 2, segs: 32, props: true },
  { max: 4, segs: 16, props: false },
  { max: 7, segs: 8, props: false },
  { max: 11, segs: 4, props: false },
];

const indexCache = new Map();
function gridIndex(segs) {
  if (indexCache.has(segs)) return indexCache.get(segs);
  const V = segs + 1;
  const idx = [];
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // skirt strips: border ring k ↔ skirt vertex V*V+k
  const ring = [];
  for (let i = 0; i < segs; i++) ring.push(i);
  for (let j = 0; j < segs; j++) ring.push(j * V + segs);
  for (let i = segs; i > 0; i--) ring.push(segs * V + i);
  for (let j = segs; j > 0; j--) ring.push(j * V);
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const a = ring[k], b = ring[(k + 1) % n];
    const sa = V * V + k, sb = V * V + ((k + 1) % n);
    idx.push(a, b, sa, b, sb, sa);
  }
  const arr = new Uint32Array(idx);
  indexCache.set(segs, arr);
  return arr;
}

export class Terrain {
  constructor(scene, seed, materials, quality = 1) {
    this.scene = scene;
    this.materials = materials; // { ground, conifer:{geo,mat}, broad, rock }
    this.chunks = new Map(); // key -> { group, segs, cx, cz }
    this.pending = new Map(); // key -> segs requested
    this.gen = 0;
    this.nextId = 1;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);

    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this._onMessage(e.data);
      w.busy = 0;
      this.workers.push(w);
    }
    this.queue = [];
    this.reset(seed);
  }

  reset(seed) {
    this.seed = seed;
    this.gen++;
    for (const w of this.workers) {
      w.postMessage({ type: 'init', seed });
      w.busy = 0;
    }
    for (const c of this.chunks.values()) this._dispose(c);
    this.chunks.clear();
    this.pending.clear();
    this.queue.length = 0;
    this.lastCenter = null;
  }

  get lods() {
    // low quality (phones) skips the outermost ring: far fewer draw calls
    return this.quality > 0 ? LODS : LODS.slice(0, -1);
  }

  get maxRing() {
    const l = this.lods;
    return l[l.length - 1].max;
  }

  lodFor(dist) {
    const l = this.lods;
    for (let i = 0; i < l.length; i++) if (dist <= l[i].max) return l[i];
    return null;
  }

  /** Called every frame with the car position. */
  update(px, pz) {
    const ccx = Math.floor(px / CHUNK_SIZE), ccz = Math.floor(pz / CHUNK_SIZE);
    const centerKey = ccx + ',' + ccz;
    if (centerKey !== this.lastCenter) {
      this.lastCenter = centerKey;
      this._plan(ccx, ccz);
    }
    this._pump();
  }

  _plan(ccx, ccz) {
    const R = this.maxRing;
    const want = new Map();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        const lod = this.lodFor(d);
        if (!lod) continue;
        want.set(ccx + dx + ',' + (ccz + dz), { cx: ccx + dx, cz: ccz + dz, d, lod });
      }
    }
    // remove chunks we no longer want
    for (const [k, c] of this.chunks) {
      if (!want.has(k)) {
        this._dispose(c);
        this.chunks.delete(k);
      }
    }
    // queue builds, nearest first
    this.queue = [];
    for (const [k, w] of want) {
      const have = this.chunks.get(k);
      if (have && have.segs === w.lod.segs) continue;
      if (this.pending.get(k) === w.lod.segs) continue;
      this.queue.push({ key: k, ...w });
    }
    this.queue.sort((a, b) => a.d - b.d);
    this.wanted = want;
  }

  _pump() {
    for (const w of this.workers) {
      while (w.busy < 2 && this.queue.length) {
        const job = this.queue.shift();
        const id = this.nextId++;
        this.pending.set(job.key, job.lod.segs);
        w.busy++;
        w.postMessage({ type: 'build', id, gen: this.gen, cx: job.cx, cz: job.cz, segs: job.lod.segs, props: job.lod.props && this.quality > 0 });
        this._jobWorker = this._jobWorker || new Map();
        this._jobWorker.set(id, w);
      }
    }
  }

  get loading() {
    return this.queue.length + this.pending.size;
  }

  _onMessage(msg) {
    const w = this._jobWorker && this._jobWorker.get(msg.id);
    if (w) {
      w.busy = Math.max(0, w.busy - 1);
      this._jobWorker.delete(msg.id);
    }
    if (msg.gen !== this.gen) return;
    const r = msg.data;
    const key = r.cx + ',' + r.cz;
    if (this.pending.get(key) === r.segs) this.pending.delete(key);
    const want = this.wanted && this.wanted.get(key);
    if (!want || want.lod.segs !== r.segs) return; // stale

    const old = this.chunks.get(key);
    if (old) this._dispose(old);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(r.col, 3));
    // each geometry gets its own attribute (sharing the array) so disposing one
    // chunk never deletes a GPU buffer that another chunk still uses
    geo.setIndex(new THREE.BufferAttribute(gridIndex(r.segs), 1));
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, r.minH, 0), new THREE.Vector3(CHUNK_SIZE, r.maxH, CHUNK_SIZE));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());

    const group = new THREE.Group();
    group.position.set(r.cx * CHUNK_SIZE, 0, r.cz * CHUNK_SIZE);
    const mesh = new THREE.Mesh(geo, this.materials.ground);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);

    for (const kind of PROP_KEYS) {
      const p = r[kind];
      if (!p || !p.count) continue;
      const def = this.materials[kind];
      if (!def) continue;
      const im = new THREE.InstancedMesh(def.geo, def.mat, p.count);
      im.instanceMatrix = new THREE.InstancedBufferAttribute(p.mats, 16);
      im.instanceColor = new THREE.InstancedBufferAttribute(p.cols, 3);
      im.castShadow = want.d <= 1 && def.castShadow !== false;
      im.receiveShadow = false;
      im.computeBoundingSphere();
      group.add(im);
    }
    group.updateMatrixWorld(true);
    this.group.add(group);
    this.chunks.set(key, { group, segs: r.segs, cx: r.cx, cz: r.cz });
  }

  _dispose(c) {
    this.group.remove(c.group);
    c.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh) o.geometry.dispose();
    });
  }
}
