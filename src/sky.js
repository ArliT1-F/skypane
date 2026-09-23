import * as THREE from 'three';
import { clamp, smoothstep } from './noise.js';

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always on the far plane
  }
`;

const frag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uSunVis;
  uniform float uStars;
  uniform float uMoon;
  uniform float uTime;
  uniform float uCover;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    float up = max(h, 0.0);
    vec3 col = mix(uHorizon, uTop, pow(up, 0.52));

    // Warm atmospheric glow around the sun
    float sd = max(dot(dir, uSunDir), 0.0);
    float horizonBand = pow(1.0 - up, 5.0);
    col += uSunColor * (pow(sd, 5.0) * 0.32 * horizonBand + pow(sd, 70.0) * 0.55) * uSunVis;

    // Dreamy celestial sun halo
    float sunHalo = pow(sd, 14.0) * 0.4 * uSunVis;
    col += uSunColor * sunHalo;

    // Stars & soft cosmic dust at night
    if (uStars > 0.001 && h > 0.0) {
      vec2 sp = dir.xz / (h + 0.35) * 190.0;
      vec2 cell = floor(sp);
      float r = hash(cell);
      vec2 c = fract(sp) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
      float star = step(0.97, r) * smoothstep(0.1, 0.0, length(c)) * (0.55 + 0.45 * sin(uTime * (1.2 + r * 3.0) + r * 40.0));
      col += vec3(0.9, 0.94, 1.0) * star * uStars * smoothstep(0.0, 0.22, h);

      // Subtle celestial nebula shimmer
      float neb = vnoise(dir.xz * 4.0 + uTime * 0.01) * vnoise(dir.xz * 8.0);
      col += vec3(0.15, 0.08, 0.25) * neb * uStars * smoothstep(0.2, 0.8, h);
    }

    // Clouds (soft painterly dream puffs)
    float cloud = 0.0;
    if (h > 0.0) {
      vec2 uv = dir.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.0035, uTime * 0.0012);
      float n = fbm(uv);
      cloud = smoothstep(uCover, uCover + 0.26, n) * smoothstep(0.0, 0.22, h);
      float lit = clamp(0.5 + (n - uCover) * 2.2, 0.0, 1.0);
      vec3 cc = mix(uCloudShade, uCloudLit, lit);
      cc += uSunColor * pow(sd, 9.0) * 0.65 * uSunVis; // warm golden/pink edge
      col = mix(col, cc, cloud * 0.9);
    }

    // Sun disc
    float disc = smoothstep(0.99955, 0.99975, dot(dir, uSunDir));
    col += uSunColor * disc * 6.5 * uSunVis * (1.0 - cloud) * smoothstep(-0.01, 0.01, h);

    // Moon & ethereal lunar halo
    float md = dot(dir, -uSunDir);
    float moon = smoothstep(0.99935, 0.9996, md);
    col += vec3(0.92, 0.95, 1.0) * moon * 1.8 * uMoon * (1.0 - cloud * 0.75);
    float moonHalo = pow(max(md, 0.0), 30.0) * 0.35 * uMoon;
    col += vec3(0.65, 0.75, 1.0) * moonHalo;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Dreamy palette keyed by sun elevation
const KEYS = [
  // Deep night
  { e: -0.4, top: 0x080c24, hor: 0x192244, sun: 0xadc4ff, si: 0.35, hs: 0x4f5e8f, hg: 0x181a24, hi: 0.85, cl: 0x323a60, cs: 0x15182b, stars: 1 },
  // Twilight / pre-dawn
  { e: -0.12, top: 0x161c46, hor: 0x4e4a78, sun: 0xc2b8ff, si: 0.3, hs: 0x58608f, hg: 0x1b1c28, hi: 0.7, cl: 0x605680, cs: 0x24223d, stars: 0.55 },
  // Sunset / sunrise horizon (dreamcore violet to vibrant coral)
  { e: 0.0, top: 0x31245e, hor: 0xf97f6c, sun: 0xff8a4e, si: 0.85, hs: 0x988cb0, hg: 0x3d3238, hi: 0.85, cl: 0xffb59a, cs: 0x56385d, stars: 0 },
  // Golden hour
  { e: 0.08, top: 0x445f9d, hor: 0xfdc498, sun: 0xffb675, si: 2.8, hs: 0xc3bdd4, hg: 0x6e5e4e, hi: 1.3, cl: 0xffdfc4, cs: 0x83769c, stars: 0 },
  // Gentle afternoon
  { e: 0.25, top: 0x4888d2, hor: 0xebe3d8, sun: 0xfff0d8, si: 3.1, hs: 0xcde0f4, hg: 0x726c50, hi: 1.35, cl: 0xffffff, cs: 0xb8c5da, stars: 0 },
  // Noon
  { e: 0.7, top: 0x3c85d8, hor: 0xcde2f8, sun: 0xfff9ed, si: 3.2, hs: 0xd8e8ff, hg: 0x787552, hi: 1.4, cl: 0xffffff, cs: 0xbfcce0, stars: 0 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
function mixHex(a, b, t, out) {
  tmpA.setHex(a);
  tmpB.setHex(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

export const TIME_PRESETS = {
  dawn: 6.3,
  morning: 8.5,
  noon: 13,
  afternoon: 15.8,
  sunset: 17.4,
  night: 22.5,
};

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uSunVis: { value: 1 },
      uStars: { value: 0 },
      uMoon: { value: 0 },
      uTime: { value: 0 },
      uCover: { value: 0.54 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);

    this.sunDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.lightColor = new THREE.Color();
    this.lightIntensity = 1;
    this.hemiSky = new THREE.Color();
    this.hemiGround = new THREE.Color();
    this.hemiIntensity = 1;
    this.fogColor = new THREE.Color();
    this.night = 0;
  }

  /** hours: 0..24 */
  setTime(hours) {
    const a = ((hours - 6) / 12) * Math.PI;
    const elev = Math.sin(a) * 0.95;
    const az = a;
    this.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), -0.55 * Math.cos(elev) + 0.25).normalize();
    this.elevation = this.sunDir.y;

    const ev = clamp(this.sunDir.y, KEYS[0].e, KEYS[KEYS.length - 1].e);
    let k = 0;
    while (k < KEYS.length - 2 && ev > KEYS[k + 1].e) k++;
    const A = KEYS[k], B = KEYS[k + 1];
    const t = smoothstep(A.e, B.e, ev);

    const u = this.uniforms;
    mixHex(A.top, B.top, t, u.uTop.value);
    mixHex(A.hor, B.hor, t, u.uHorizon.value);
    mixHex(A.sun, B.sun, t, this.sunColor);
    mixHex(A.cl, B.cl, t, u.uCloudLit.value);
    mixHex(A.cs, B.cs, t, u.uCloudShade.value);
    mixHex(A.hs, B.hs, t, this.hemiSky);
    mixHex(A.hg, B.hg, t, this.hemiGround);
    this.hemiIntensity = A.hi + (B.hi - A.hi) * t;
    u.uStars.value = A.stars + (B.stars - A.stars) * t;
    u.uSunColor.value.copy(this.sunColor);
    u.uSunDir.value.copy(this.sunDir);
    u.uSunVis.value = smoothstep(-0.12, 0.02, this.sunDir.y);
    u.uMoon.value = smoothstep(0.0, -0.15, this.sunDir.y);
    this.fogColor.copy(u.uHorizon.value);
    this.night = smoothstep(0.02, -0.1, this.sunDir.y);

    const si = A.si + (B.si - A.si) * t;
    if (this.sunDir.y > -0.02) {
      this.lightDir.copy(this.sunDir);
      this.lightDir.y = Math.max(this.lightDir.y, 0.06);
      this.lightDir.normalize();
      this.lightColor.copy(this.sunColor);
      this.lightIntensity = si * smoothstep(-0.02, 0.06, this.sunDir.y);
    } else {
      this.lightDir.copy(this.sunDir).negate();
      this.lightDir.y = Math.max(this.lightDir.y, 0.25);
      this.lightDir.normalize();
      this.lightColor.setHex(0xaec4ff);
      this.lightIntensity = 0.5 * smoothstep(-0.02, -0.15, this.sunDir.y);
    }
  }

  update(camera, time) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = time;
  }
}
