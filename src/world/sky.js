// Sky dome, sun/moon, stars, clouds, and the time-of-day lighting rig.
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/noise.js';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uTime;
uniform float uCloud;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col;
  if (y > 0.0) {
    float t = pow(clamp(y, 0.0, 1.0), 0.45);
    col = mix(uHorizon, uTop, t);
  } else {
    col = mix(uHorizon, uGround, clamp(-y * 6.0, 0.0, 1.0));
  }

  // sun glow + disc
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 64.0) * 0.5) * (1.0 - uNight * 0.9);
  col += uSunColor * smoothstep(0.9993, 0.99965, sd) * 3.0 * (1.0 - uNight);

  // stars + moon
  if (uNight > 0.01 && y > 0.0) {
    vec3 sp = d * 280.0;
    vec3 cell = floor(sp);
    float h = hash3(cell);
    vec3 center = cell + 0.5 + (vec3(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 5.1)) - 0.5) * 0.6;
    float dist = length(sp - center);
    float star = step(0.985, h) * smoothstep(0.35, 0.0, dist) * (0.6 + 0.4 * sin(uTime * 2.0 + h * 100.0));
    col += vec3(star) * uNight * smoothstep(0.0, 0.25, y);
    float md = dot(d, uMoonDir);
    col += vec3(0.95, 0.95, 0.88) * smoothstep(0.9990, 0.99935, md) * uNight;
    col += vec3(0.5, 0.6, 0.8) * pow(max(md, 0.0), 40.0) * 0.12 * uNight;
  }

  // clouds on a virtual plane
  if (y > 0.015 && uCloud > 0.001) {
    vec2 uv = d.xz / (y + 0.08) * 1.1;
    uv += vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv * 1.2);
    float cov = mix(0.62, 0.36, uCloud);
    float c = smoothstep(cov, cov + 0.25, n);
    float fade = smoothstep(0.015, 0.22, y);
    float lit = clamp(0.55 + 0.45 * dot(normalize(vec3(d.x, 0.2, d.z)), uSunDir), 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit * (1.0 - smoothstep(0.55, 1.0, n) * 0.5));
    col = mix(col, cc, c * fade * 0.92);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// keyframes over sun elevation: [elev, top, horizon, sunColor, sunIntensity, hemiSky, hemiGround, hemiIntensity, cloudLit, cloudShade]
const KEYS = [
  { e: -0.35, top: 0x040811, hor: 0x0c1526, sun: 0x9fb4ff, si: 0.0, sky: 0x2a3a66, gnd: 0x0a0c12, hi: 0.35, cl: 0x2a3348, cs: 0x0e131e },
  { e: -0.1, top: 0x0d1630, hor: 0x2d3656, sun: 0x9fb4ff, si: 0.0, sky: 0x39497a, gnd: 0x141620, hi: 0.4, cl: 0x4a4f6e, cs: 0x1d2236 },
  { e: 0.0, top: 0x2b3f73, hor: 0xe98d5a, sun: 0xff8a4c, si: 0.5, sky: 0x7f86b0, gnd: 0x3a3030, hi: 0.5, cl: 0xffb27a, cs: 0x5a4a66 },
  { e: 0.1, top: 0x4a74b8, hor: 0xf3b98a, sun: 0xffc48a, si: 1.5, sky: 0xa9bde0, gnd: 0x5a5040, hi: 0.7, cl: 0xffe2c4, cs: 0x8a8aa0 },
  { e: 0.3, top: 0x3f7fd1, hor: 0xb9d6ee, sun: 0xfff1dc, si: 2.4, sky: 0xbfd8f2, gnd: 0x6a6450, hi: 0.95, cl: 0xffffff, cs: 0xaab4c4 },
  { e: 1.0, top: 0x2f6fca, hor: 0xa9cdef, sun: 0xffffff, si: 2.7, sky: 0xc7ddf5, gnd: 0x6f6a58, hi: 1.05, cl: 0xffffff, cs: 0xb4bfcd },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
function mixHex(a, b, t, out) {
  tmpA.setHex(a);
  tmpB.setHex(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

export const TIME_PRESETS = {
  dawn: 6.1,
  morning: 9,
  noon: 12.5,
  golden: 17.6,
  sunset: 18.6,
  night: 22.5,
};

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCloud: { value: 0.5 },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8f2, 0x6a6450, 1);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(0xb9d6ee, 200, 2400);
    scene.fog = this.fog;

    this.hour = 17.6;
    this.cloudiness = 0.45;
    this.fogBoost = 0;
    this.night = 0;
    this.sunDir = new THREE.Vector3();
    this.horizon = new THREE.Color();
  }

  setShadows(on, size = 2048) {
    this.sun.castShadow = on;
    if (on && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  /**
   * @param hour 0-24
   * @param viewDist far distance for fog
   * @param weather { overcast 0..1, fog 0..1 }
   */
  update(hour, focus, viewDist, time, weather) {
    this.hour = hour;
    const u = this.uniforms;
    // sun path: rises in the east (+x), sets in the west, slightly southern arc
    const ang = ((hour - 6) / 24) * Math.PI * 2; // 0 at 6am
    const elev = Math.sin(ang) * 1.05;
    const sd = this.sunDir.set(Math.cos(ang), elev, -0.35).normalize();
    u.uSunDir.value.copy(sd);
    u.uMoonDir.value.set(-sd.x, Math.max(-sd.y, 0.25), 0.3).normalize();

    // find keyframes
    const e = sd.y;
    let k0 = KEYS[0];
    let k1 = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (e >= KEYS[i].e && e <= KEYS[i + 1].e) {
        k0 = KEYS[i];
        k1 = KEYS[i + 1];
        break;
      }
    }
    if (e < KEYS[0].e) k1 = k0;
    const t = k1 === k0 ? 0 : clamp((e - k0.e) / (k1.e - k0.e), 0, 1);

    const overcast = weather.overcast;
    const grey = tmpB;
    mixHex(k0.top, k1.top, t, u.uTop.value);
    mixHex(k0.hor, k1.hor, t, u.uHorizon.value);
    // overcast desaturates toward a grey of similar brightness
    const desat = (c, amt) => {
      const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      grey.setRGB(l, l, l * 1.04);
      c.lerp(grey, amt);
    };
    desat(u.uTop.value, overcast * 0.75);
    desat(u.uHorizon.value, overcast * 0.6);
    u.uGround.value.copy(u.uHorizon.value).multiplyScalar(0.55);
    mixHex(k0.sun, k1.sun, t, u.uSunColor.value);
    mixHex(k0.cl, k1.cl, t, u.uCloudLit.value);
    mixHex(k0.cs, k1.cs, t, u.uCloudShade.value);
    desat(u.uCloudLit.value, overcast * 0.5);
    u.uCloudLit.value.multiplyScalar(1 - overcast * 0.25);
    this.night = 1 - smoothstep(-0.18, 0.02, e);
    u.uNight.value = this.night;
    u.uTime.value = time;
    u.uCloud.value = clamp(this.cloudiness + overcast * 0.9, 0, 1);

    const si = (k0.si + (k1.si - k0.si) * t) * (1 - overcast * 0.7);
    this.sun.intensity = si;
    this.sun.color.copy(u.uSunColor.value);
    const lightDir = e > 0.02 ? sd : u.uMoonDir.value;
    if (e <= 0.02) {
      // moonlight
      this.sun.intensity = 0.25 * this.night * (1 - overcast * 0.6);
      this.sun.color.setHex(0x9fb4ff);
    }
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();

    mixHex(k0.sky, k1.sky, t, this.hemi.color);
    mixHex(k0.gnd, k1.gnd, t, this.hemi.groundColor);
    this.hemi.intensity = (k0.hi + (k1.hi - k0.hi) * t) * (1 + overcast * 0.15);

    // fog matches horizon
    this.horizon.copy(u.uHorizon.value);
    this.fog.color.copy(this.horizon);
    const fogAmt = weather.fog;
    this.fog.far = viewDist * (1 - fogAmt * 0.85) + 50;
    this.fog.near = Math.min(this.fog.far * 0.25, 60 + viewDist * 0.12 * (1 - fogAmt));

    this.dome.position.copy(focus);
  }
}
