import * as THREE from 'three';
import { Simplex, smoothstep, clamp, lerp } from '../core/noise.js';

export const WATER_LEVEL = 0;
export const ROAD_HALF = 3.7; // half width of asphalt (two 3.5m lanes + a little)
export const SHOULDER = 1.8; // flat gravel shoulder beyond the asphalt
export const BLEND = 20; // minimum distance over which terrain eases back to nature
export const ROAD_INFLUENCE = ROAD_HALF + SHOULDER + BLEND + 64; // max reach of the road on terrain

/**
 * Blend natural terrain height toward the road.
 * render=true pushes the ground a little *under* the asphalt ribbon so it never pokes through.
 */
export function blendHeight(raw, d, hr, render, extra = 0) {
  if (d < ROAD_HALF + 0.3) return render ? hr - 0.35 : hr;
  const base = hr - 0.08;
  const core = ROAD_HALF + SHOULDER + extra;
  if (d < core) return base;
  const diff = Math.abs(raw - base);
  const blend = BLEND + Math.min(diff * 1.25, 62);
  const w = smoothstep(core, core + blend, d);
  return base + (raw - base) * w;
}

const _c = new THREE.Color();
const _c2 = new THREE.Color();

export class Terrain {
  constructor(seed, biome) {
    this.biome = biome;
    this.seed = seed;
    this.nBase = new Simplex(seed);
    this.nDetail = new Simplex(seed + 101);
    this.nMount = new Simplex(seed + 202);
    this.nMask = new Simplex(seed + 303);
    this.nColor = new Simplex(seed + 404);
    this.nWarp = new Simplex(seed + 505);
    const c = biome.colors;
    this.col = {
      sand: new THREE.Color(c.sand),
      low: new THREE.Color(c.low),
      high: new THREE.Color(c.high),
      rock: new THREE.Color(c.rock),
      snow: new THREE.Color(c.snow),
      shoulder: new THREE.Color(c.shoulder),
      grass: new THREE.Color(biome.grass),
    };
  }

  /** Natural terrain height, before the road has had its say. */
  rawHeight(x, z) {
    const b = this.biome;
    const nb = this.nBase;
    // gentle domain warp so hills don't look like noise blobs
    const wx = x + this.nWarp.noise2(x / 1400, z / 1400) * 220;
    const wz = z + this.nWarp.noise2(x / 1400 + 31.7, z / 1400 - 12.1) * 220;

    const s = 1 / b.hillScale;
    let h =
      nb.noise2(wx * s, wz * s) * 1.0 +
      nb.noise2(wx * s * 2.03, wz * s * 2.03) * 0.5 +
      nb.noise2(wx * s * 4.1, wz * s * 4.1) * 0.25 +
      nb.noise2(wx * s * 8.3, wz * s * 8.3) * 0.12;
    h *= b.hills;

    // distant mountain ranges, ridged
    const mask = smoothstep(-0.15, 0.55, this.nMask.noise2(x / 6500, z / 6500));
    if (mask > 0) {
      const nm = this.nMount;
      const ms = 1 / 2400;
      let r = 0;
      let amp = 1;
      let f = 1;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        const n = 1 - Math.abs(nm.noise2(wx * ms * f, wz * ms * f));
        r += n * n * amp;
        norm += amp;
        amp *= 0.5;
        f *= 2.1;
      }
      r /= norm;
      h += Math.pow(r, 2.2) * b.mountains * mask;
    }

    if (b.mesas) {
      // terraced sandstone mesas
      const m = nb.noise2(x / 700 + 50, z / 700 - 20);
      if (m > 0.25) {
        const t = smoothstep(0.25, 0.42, m);
        const step = 22;
        const raised = h + t * 70;
        const terr = Math.floor(raised / step) * step + smoothstep(0.75, 1, (raised / step) % 1) * step;
        h = lerp(h, terr, t);
      }
    }

    // small-scale detail
    const nd = this.nDetail;
    h += nd.noise2(x / 70, z / 70) * b.detail * 0.6 + nd.noise2(x / 24, z / 24) * b.detail * 0.18;

    return h + b.valleyOffset;
  }

  /** vertex color for a terrain point */
  colorAt(x, z, h, ny, roadDist, out) {
    const b = this.biome;
    const col = this.col;
    const n = this.nColor.noise2(x / 90, z / 90);
    const n2 = this.nColor.noise2(x / 17 + 9, z / 17 - 4);

    // base: lowland -> highland
    const altT = clamp(h / 120 + n * 0.25, 0, 1);
    out.copy(col.low).lerp(col.high, altT);
    // meadow patches
    _c.copy(col.grass);
    out.lerp(_c, smoothstep(0.1, 0.8, n2) * 0.35);

    // shore sand
    const sandT = 1 - smoothstep(WATER_LEVEL + 0.8, WATER_LEVEL + 3.2 + n * 1.2, h);
    if (b.water && sandT > 0) out.lerp(col.sand, sandT);

    // steep = rock
    const slope = 1 - ny;
    const rockT = smoothstep(b.rockSlope - 0.12 - n * 0.06, b.rockSlope + 0.1, slope * 2.2);
    out.lerp(col.rock, rockT);

    // snow cap
    if (h > b.snowLine - 60) {
      const snowT = smoothstep(b.snowLine - 40 + n * 30, b.snowLine + 20 + n * 30, h) * (1 - rockT * 0.6);
      out.lerp(col.snow, snowT);
    }

    // gravel shoulder along the road
    if (roadDist < ROAD_HALF + SHOULDER + 2.5) {
      const sh = 1 - smoothstep(ROAD_HALF + SHOULDER - 0.5, ROAD_HALF + SHOULDER + 2.5, roadDist);
      _c2.copy(col.shoulder);
      out.lerp(_c2, sh * 0.9);
    }

    // subtle speckle variety
    const v = 1 + n2 * 0.05;
    out.r *= v;
    out.g *= v;
    out.b *= v;
    return out;
  }
}
