// An endless, procedurally generated road.
//
// The road always makes progress along -Z (its heading never strays more than ~70°
// from that axis), so it can never loop back over itself and any point of the
// world is only ever touched by one stretch of road. Heading changes smoothly
// via noise-driven curvature, with a gentle bias toward lower ground so the road
// naturally follows valleys and hugs lake shores. Elevation is smoothed with a
// double box filter and grade-limited so it glides across the landscape.

import { Simplex, clamp, smoothstep } from '../core/noise.js';
import { WATER_LEVEL } from './terrain.js';

export const STEP = 5; // meters between road samples
const CELL = 32; // spatial hash cell size
const K1 = 14; // smoothing half-windows (in samples)
const K2 = 14;
const MAX_CURV = 1 / 95; // tightest radius ~95m
const MAX_GRADE = 0.085;
const MAX_OFFSET = 1.15; // max heading deviation from -Z (radians)

export class Road {
  constructor(terrain, seed, startProgress = -1500) {
    this.terrain = terrain;
    this.noise = new Simplex((seed ^ 0x51ed) >>> 0);
    this.X = [];
    this.Z = [];
    this.A = []; // heading of segment arriving at point i
    this.C = []; // curvature at point i
    this.RH = []; // raw terrain height at point
    this.P1 = [0]; // prefix sums of adjusted RH
    this.M1 = [];
    this.P2 = [0];
    this.H = []; // final road elevation
    this.grid = new Map();
    this.a = 0;
    this.curv = 0;
    this.startProgress = startProgress;
    this._pushRaw(0, -startProgress, 0, 0);
  }

  get length() {
    return this.H.length;
  }

  /** progress (distance along -Z) of the last finalized point */
  get frontProgress() {
    const n = this.H.length;
    return n ? -this.Z[n - 1] : -Infinity;
  }

  _pushRaw(x, z, a, c) {
    this.X.push(x);
    this.Z.push(z);
    this.A.push(a);
    this.C.push(c);
    let rh = this.terrain.rawHeight(x, z);
    rh = Math.max(rh, WATER_LEVEL + 2.4); // causeways over lakes
    this.RH.push(rh);
    this.P1.push(this.P1[this.P1.length - 1] + rh);
  }

  _effH(x, z) {
    const h = this.terrain.rawHeight(x, z);
    // treat water as undesirable (but not forbidden) so the road prefers shorelines
    return h < WATER_LEVEL + 1.5 ? WATER_LEVEL + 1.5 + (WATER_LEVEL + 1.5 - h) * 0.6 : h;
  }

  _genRaw() {
    const i = this.X.length - 1;
    const s = i * STEP;
    const x = this.X[i];
    const z = this.Z[i];
    const n = this.noise;
    let a = this.a;

    // twistiness varies: long relaxed straights, then wandering sections
    const twist = 0.25 + 0.75 * smoothstep(-0.35, 0.45, n.noise2(s * 0.00042, 7.3));
    let target = (n.noise2(s * 0.0016, 0.5) * 0.7 + n.noise2(s * 0.0047, 3.1) * 0.3) * MAX_CURV * twist * 1.4;

    // valley seeking: compare terrain height to the left and right ahead
    const look = 75;
    const hl = this._effH(x + Math.sin(a - 0.4) * look, z - Math.cos(a - 0.4) * look);
    const hr = this._effH(x + Math.sin(a + 0.4) * look, z - Math.cos(a + 0.4) * look);
    target += clamp((hl - hr) / 28, -1, 1) * MAX_CURV * 0.75;

    // stay broadly heading "north" so the road never folds back
    const over = smoothstep(0.55, MAX_OFFSET, Math.abs(a));
    target -= Math.sign(a) * over * MAX_CURV * 1.6;

    this.curv += (target - this.curv) * 0.07;
    this.curv = clamp(this.curv, -MAX_CURV, MAX_CURV);
    a += this.curv * STEP;
    a = clamp(a, -MAX_OFFSET - 0.05, MAX_OFFSET + 0.05);
    this.a = a;

    this._pushRaw(x + Math.sin(a) * STEP, z - Math.cos(a) * STEP, a, this.curv);
  }

  _finalize() {
    const nRaw = this.RH.length;
    // stage 1 smoothing
    while (this.M1.length < nRaw - K1) {
      const i = this.M1.length;
      const lo = Math.max(0, i - K1);
      const hi = Math.min(nRaw - 1, i + K1);
      const m = (this.P1[hi + 1] - this.P1[lo]) / (hi - lo + 1);
      this.M1.push(m);
      this.P2.push(this.P2[this.P2.length - 1] + m);
    }
    // stage 2 smoothing + grade limiting
    const nM = this.M1.length;
    while (this.H.length < nM - K2) {
      const i = this.H.length;
      const lo = Math.max(0, i - K2);
      const hi = Math.min(nM - 1, i + K2);
      let h = (this.P2[hi + 1] - this.P2[lo]) / (hi - lo + 1);
      if (i > 0) {
        const prev = this.H[i - 1];
        const g = MAX_GRADE * STEP;
        h = clamp(h, prev - g, prev + g);
      }
      h = Math.max(h, WATER_LEVEL + 2.0);
      this.H.push(h);
      this._insert(i);
    }
  }

  _key(cx, cz) {
    return (cx + 1048576) * 2097152 + (cz + 1048576);
  }

  _insert(i) {
    const k = this._key(Math.floor(this.X[i] / CELL), Math.floor(this.Z[i] / CELL));
    let list = this.grid.get(k);
    if (!list) {
      list = [];
      this.grid.set(k, list);
    }
    list.push(i);
  }

  /** generate until the road reaches `progress` (meters along -Z). Returns true if work was done */
  ensure(progress, maxSteps = 100000) {
    let steps = 0;
    while (this.frontProgress < progress && steps < maxSteps) {
      this._genRaw();
      this._finalize();
      steps++;
    }
    return steps > 0;
  }

  /** Refine nearest sample i against its two adjacent segments. */
  _refine(x, z, i, out) {
    const n = this.H.length;
    const X = this.X;
    const Z = this.Z;
    let best = Infinity;
    for (let j = Math.max(0, i - 1); j <= i && j + 1 < n; j++) {
      const dx = X[j + 1] - X[j];
      const dz = Z[j + 1] - Z[j];
      const len2 = dx * dx + dz * dz;
      let t = ((x - X[j]) * dx + (z - Z[j]) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = X[j] + dx * t;
      const pz = Z[j] + dz * t;
      const ex = x - px;
      const ez = z - pz;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        const dirx = dx / len;
        const dirz = dz / len;
        out.index = j;
        out.t = t;
        out.dist = Math.sqrt(d2);
        out.lateral = ex * -dirz + ez * dirx; // + = right of travel direction
        out.h = this.H[j] + (this.H[j + 1] - this.H[j]) * t;
        out.s = (j + t) * STEP;
        out.dirx = dirx;
        out.dirz = dirz;
      }
    }
    if (best === Infinity) {
      // single point road (shouldn't happen after init)
      out.index = i;
      out.t = 0;
      out.dist = Math.hypot(x - X[i], z - Z[i]);
      out.lateral = 0;
      out.h = this.H[i];
      out.s = i * STEP;
      out.dirx = Math.sin(this.A[i]);
      out.dirz = -Math.cos(this.A[i]);
    }
    out.found = true;
    return out;
  }

  /** nearest point on road within maxD. out.found=false if none. */
  nearest(x, z, maxD, out) {
    const r = Math.ceil(maxD / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let bi = -1;
    let bd = maxD * maxD + CELL * CELL * 2;
    for (let gz = cz - r; gz <= cz + r; gz++) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        const list = this.grid.get(this._key(gx, gz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          const dx = this.X[i] - x;
          const dz = this.Z[i] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) {
            bd = d2;
            bi = i;
          }
        }
      }
    }
    if (bi < 0) {
      out.found = false;
      return out;
    }
    this._refine(x, z, bi, out);
    if (out.dist > maxD) out.found = false;
    return out;
  }

  /** All sample indices near an axis-aligned box (for fast per-chunk queries). */
  candidates(minX, minZ, maxX, maxZ, margin) {
    const res = [];
    const c0x = Math.floor((minX - margin) / CELL);
    const c1x = Math.floor((maxX + margin) / CELL);
    const c0z = Math.floor((minZ - margin) / CELL);
    const c1z = Math.floor((maxZ + margin) / CELL);
    for (let gz = c0z; gz <= c1z; gz++) {
      for (let gx = c0x; gx <= c1x; gx++) {
        const list = this.grid.get(this._key(gx, gz));
        if (list) for (let k = 0; k < list.length; k++) res.push(list[k]);
      }
    }
    res.sort((a, b) => a - b);
    return res;
  }

  nearestFrom(x, z, cands, maxD, out) {
    let bi = -1;
    let bd = Infinity;
    const X = this.X;
    const Z = this.Z;
    for (let k = 0; k < cands.length; k++) {
      const i = cands[k];
      const dx = X[i] - x;
      const dz = Z[i] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) {
        bd = d2;
        bi = i;
      }
    }
    if (bi < 0 || bd > (maxD + STEP) * (maxD + STEP)) {
      out.found = false;
      return out;
    }
    this._refine(x, z, bi, out);
    if (out.dist > maxD) out.found = false;
    return out;
  }

  /** Point on the centerline at arc length s. */
  pointAt(s, out) {
    const n = this.H.length;
    let f = s / STEP;
    if (f < 0) f = 0;
    if (f > n - 1.001) f = n - 1.001;
    const i = Math.floor(f);
    const t = f - i;
    out.x = this.X[i] + (this.X[i + 1] - this.X[i]) * t;
    out.z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t;
    out.h = this.H[i] + (this.H[i + 1] - this.H[i]) * t;
    const a = this.A[i + 1];
    out.a = a;
    out.dirx = Math.sin(a);
    out.dirz = -Math.cos(a);
    out.index = i;
    return out;
  }

  /** Max absolute curvature over an arc length window. */
  maxCurvature(s0, s1) {
    const n = this.H.length;
    const i0 = clamp(Math.floor(s0 / STEP), 0, n - 1);
    const i1 = clamp(Math.ceil(s1 / STEP), 0, n - 1);
    let m = 0;
    for (let i = i0; i <= i1; i++) {
      const c = Math.abs(this.C[i]);
      if (c > m) m = c;
    }
    return m;
  }

  /** index of the sample closest to progress 0 (the world origin) */
  get originIndex() {
    return Math.round(-this.startProgress / STEP);
  }
}
