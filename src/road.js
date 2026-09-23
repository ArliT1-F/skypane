import * as THREE from 'three';
import { ROAD_HALF, SHOULDER, ROAD_STEP } from './world.js';

const SEG = 128; // road samples per mesh segment (256 m)
const AHEAD = 12; // segments kept ahead of the car
const BEHIND = 2;
const TEX_REPEAT = 12; // metres of road per texture tile
const POST_EVERY = 25; // samples between reflector posts (50 m)

function makeRoadTexture(maxAniso) {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const total = (ROAD_HALF + SHOULDER) * 2;
  const px = (m) => (m / total) * W;

  // gravel shoulders
  g.fillStyle = '#6f6a60';
  g.fillRect(0, 0, W, H);
  // asphalt
  const a0 = px(SHOULDER), a1 = px(SHOULDER + ROAD_HALF * 2);
  g.fillStyle = '#3b3c40';
  g.fillRect(a0, 0, a1 - a0, H);

  // grain
  const img = g.getImageData(0, 0, W, H);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const x = (i / 4) % W;
    const onRoad = x >= a0 && x < a1;
    const n = (rnd() - 0.5) * (onRoad ? 18 : 34);
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // subtle tyre-worn lanes
  g.fillStyle = 'rgba(20,20,24,0.18)';
  for (const off of [-2.6, -1.0, 1.0, 2.6]) {
    const x = px(SHOULDER + ROAD_HALF + off);
    g.fillRect(x - px(0.35), 0, px(0.7), H);
  }

  // edge lines (solid white)
  g.fillStyle = '#e8e6dc';
  const lw = px(0.15);
  g.fillRect(a0 + px(0.25), 0, lw, H);
  g.fillRect(a1 - px(0.25) - lw, 0, lw, H);

  // centre line: dashed (4 m on / 8 m off over a 12 m tile)
  g.fillStyle = '#e9c46a';
  const cx = px(SHOULDER + ROAD_HALF);
  g.fillRect(cx - lw / 2, 0, lw, (4 / TEX_REPEAT) * H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export class Road {
  constructor(scene, world, renderer) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.segments = new Map();

    this.material = new THREE.MeshStandardMaterial({
      map: makeRoadTexture(renderer.capabilities.getMaxAnisotropy()),
      roughness: 0.92,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });

    // reflector posts
    const postGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
    postGeo.translate(0, 0.5, 0);
    this.postGeo = postGeo;
    this.postMat = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.6 });
    const refGeo = new THREE.BoxGeometry(0.13, 0.14, 0.13);
    refGeo.translate(0, 0.85, 0);
    this.refGeo = refGeo;
    this.refMat = new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff7a1a, emissiveIntensity: 0.15, roughness: 0.3 });
  }

  setNight(n) {
    this.refMat.emissiveIntensity = 0.15 + n * 2.2;
  }

  reset(world) {
    this.world = world;
    for (const s of this.segments.values()) this._dispose(s);
    this.segments.clear();
  }

  update(roadIndex) {
    const cur = Math.floor(roadIndex / SEG);
    const lo = Math.max(0, cur - BEHIND), hi = cur + AHEAD;
    this.world.ensureRoadTo(this.world.rz[Math.min(this.world.length - 1, roadIndex)] + (AHEAD + 4) * SEG * ROAD_STEP);
    for (const [k, s] of this.segments) {
      if (k < lo || k > hi) {
        this._dispose(s);
        this.segments.delete(k);
      }
    }
    // build at most two new segments per frame to avoid hitches
    let built = 0;
    for (let k = lo; k <= hi && built < 2; k++) {
      if (!this.segments.has(k)) {
        this.segments.set(k, this._build(k));
        built++;
      }
    }
  }

  _build(k) {
    const w = this.world;
    const i0 = k * SEG, i1 = i0 + SEG;
    w.ensureRoadTo(w.rz[w.length - 1] + 10);
    while (w.length <= i1 + 1) w.ensureRoadTo(w.rz[w.length - 1] + 50);

    const ox = w.rx[i0], oz = w.rz[i0];
    const n = SEG + 1;
    const edges = [-(ROAD_HALF + SHOULDER), -ROAD_HALF, ROAD_HALF, ROAD_HALF + SHOULDER];
    const total = (ROAD_HALF + SHOULDER) * 2;
    const drops = [0.12, 0, 0, 0.12]; // shoulders slope down very slightly
    const pos = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const nor = new Float32Array(n * 4 * 3);
    for (let s = 0; s < n; s++) {
      const i = i0 + s;
      const h = w.rh[i];
      const lx = Math.cos(h), lz = -Math.sin(h); // lateral (+ = left)
      const y = w.ry[i];
      const v = (i * ROAD_STEP) / TEX_REPEAT;
      // approximate normal from slope along the road
      const j = Math.min(i + 1, w.length - 1), p = Math.max(i - 1, 0);
      const dy = (w.ry[j] - w.ry[p]) / ((j - p) * ROAD_STEP);
      const fx = Math.sin(h), fz = Math.cos(h);
      let nx = -fx * dy, ny = 1, nz = -fz * dy;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      for (let e = 0; e < 4; e++) {
        const o = (s * 4 + e);
        pos[o * 3] = w.rx[i] - ox + lx * edges[e];
        pos[o * 3 + 1] = y - drops[e];
        pos[o * 3 + 2] = w.rz[i] - oz + lz * edges[e];
        uv[o * 2] = (edges[e] + total / 2) / total;
        uv[o * 2 + 1] = v;
        nor[o * 3] = nx; nor[o * 3 + 1] = ny; nor[o * 3 + 2] = nz;
      }
    }
    const idx = [];
    for (let s = 0; s < SEG; s++) {
      for (let e = 0; e < 3; e++) {
        const a = s * 4 + e, b = a + 1, c = a + 4, d = c + 1;
        idx.push(a, c, b, b, c, d); // counter-clockwise seen from above
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const group = new THREE.Group();
    group.position.set(ox, 0, oz);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    group.add(mesh);

    // posts on both sides
    const posts = [];
    for (let i = i0 - (i0 % POST_EVERY) + POST_EVERY; i < i1; i += POST_EVERY) posts.push(i);
    if (posts.length) {
      const count = posts.length * 2;
      const pm = new THREE.InstancedMesh(this.postGeo, this.postMat, count);
      const rm = new THREE.InstancedMesh(this.refGeo, this.refMat, count);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      const p = new THREE.Vector3();
      let c = 0;
      for (const i of posts) {
        const h = w.rh[i];
        const lx = Math.cos(h), lz = -Math.sin(h);
        q.setFromAxisAngle(up, h);
        for (const side of [-1, 1]) {
          const off = side * (ROAD_HALF + SHOULDER - 0.2);
          p.set(w.rx[i] - ox + lx * off, w.ry[i] - 0.15, w.rz[i] - oz + lz * off);
          m.compose(p, q, one);
          pm.setMatrixAt(c, m);
          rm.setMatrixAt(c, m);
          c++;
        }
      }
      pm.computeBoundingSphere();
      rm.computeBoundingSphere();
      pm.castShadow = true;
      group.add(pm, rm);
    }
    this.group.add(group);
    return group;
  }

  _dispose(group) {
    this.group.remove(group);
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh) o.geometry.dispose();
    });
  }
}
