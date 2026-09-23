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
    vec3 col = mix(uHorizon, uTop, pow(up, 0.55));

    // warm atmospheric glow around the sun (strongest near the horizon)
    float sd = max(dot(dir, uSunDir), 0.0);
    float horizonBand = pow(1.0 - up, 6.0);
    col += uSunColor * (pow(sd, 6.0) * 0.28 * horizonBand + pow(sd, 90.0) * 0.55) * uSunVis;

    // stars
    if (uStars > 0.001 && h > 0.0) {
      vec2 sp = dir.xz / (h + 0.35) * 190.0;
      vec2 cell = floor(sp);
      float r = hash(cell);
      vec2 c = fract(sp) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
      float star = step(0.975, r) * smoothstep(0.09, 0.0, length(c)) * (0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 40.0));
      col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.0, 0.25, h);
    }

    // clouds (projected onto a flat layer)
    float cloud = 0.0;
    if (h > 0.0) {
      vec2 uv = dir.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
      float n = fbm(uv);
      cloud = smoothstep(uCover, uCover + 0.28, n) * smoothstep(0.0, 0.22, h);
      float lit = clamp(0.5 + (n - uCover) * 2.2, 0.0, 1.0);
      vec3 cc = mix(uCloudShade, uCloudLit, lit);
      cc += uSunColor * pow(sd, 10.0) * 0.6 * uSunVis; // silver lining
      col = mix(col, cc, cloud * 0.9);
    }

    // sun disc
    float disc = smoothstep(0.99955, 0.99975, dot(dir, uSunDir));
    col += uSunColor * disc * 6.0 * uSunVis * (1.0 - cloud) * smoothstep(-0.01, 0.01, h);

    // moon (opposite side of the sun)
    float md = dot(dir, -uSunDir);
    float moon = smoothstep(0.99935, 0.9996, md);
    col += vec3(0.9, 0.93, 1.0) * moon * 1.6 * uMoon * (1.0 - cloud * 0.8);
    col += vec3(0.5, 0.6, 0.8) * pow(max(md, 0.0), 300.0) * 0.25 * uMoon;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Palette keyed by sun elevation (sine of the angle). Colours are sRGB hex.
const KEYS = [
  { e: -0.4, top: 0x060a1a, hor: 0x161d33, sun: 0x9fb4ff, si: 0.3, hs: 0x4a5a88, hg: 0x16181f, hi: 0.8, cl: 0x2b3450, cs: 0x10141f, stars: 1 },
  { e: -0.12, top: 0x0f1a3a, hor: 0x3e4468, sun: 0xa5b2ff, si: 0.25, hs: 0x505a85, hg: 0x14141c, hi: 0.6, cl: 0x4a4e6e, cs: 0x1c1f30, stars: 0.6 },
  { e: 0.0, top: 0x2a3f75, hor: 0xd9876a, sun: 0xff7a3a, si: 0.7, hs: 0x8a86a8, hg: 0x3a3030, hi: 0.7, cl: 0xe79a7a, cs: 0x4a3f5c, stars: 0 },
  { e: 0.08, top: 0x3d5f9e, hor: 0xf3b27f, sun: 0xffa865, si: 2.6, hs: 0xb9b4cc, hg: 0x6a5a48, hi: 1.25, cl: 0xffd2b0, cs: 0x7e7394, stars: 0 },
  { e: 0.25, top: 0x4b7fc4, hor: 0xe9d9c0, sun: 0xffe2bd, si: 3.0, hs: 0xc4d6ee, hg: 0x6f6a4c, hi: 1.3, cl: 0xffffff, cs: 0xa7b0c4, stars: 0 },
  { e: 0.7, top: 0x3a76c8, hor: 0xbfd7ea, sun: 0xfff6e8, si: 3.0, hs: 0xd2e4ff, hg: 0x76734f, hi: 1.35, cl: 0xffffff, cs: 0xb4bfd2, stars: 0 },
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
      uCover: { value: 0.56 },
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
    // sun path: rises in the east (+X), sets in the west, tilted toward the south
    const a = ((hours - 6) / 12) * Math.PI; // 0 at sunrise, π at sunset
    const elev = Math.sin(a) * 0.95; // radians-ish peak ~55°
    const e = Math.sin(elev);
    const az = a; // sweep
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

    // main light: sun by day, moon by night (cross-fade around the horizon)
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
      this.lightColor.setHex(0x9fb4ff);
      this.lightIntensity = 0.45 * smoothstep(-0.02, -0.15, this.sunDir.y);
    }
  }

  update(camera, time) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = time;
  }
}
