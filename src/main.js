import * as THREE from 'three';
import './style.css';
import { World, SPAWN_INDEX, WATER_LEVEL, CHUNK_SIZE } from './world.js';
import { Terrain } from './terrain.js';
import { Road } from './road.js';
import { Sky, TIME_PRESETS } from './sky.js';
import { Car, VEHICLES, COLORS } from './car.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { makePropMaterials, setPropNight, floatingTimeUniform } from './props.js';
import { clamp, lerp } from './noise.js';

// ------------------------------------------------------------------ settings
const STORE_KEY = 'zen-drive:v1';
const defaults = {
  seed: Math.floor(Math.random() * 1e6),
  vehicle: 'coupe',
  color: COLORS[0],
  time: 'sunset',
  cycle: false,
  quality: 'auto',
  units: 'kmh',
  hud: true,
  volumes: { master: 0.8, engine: 0.6, music: 0.5, ambience: 0.6 },
};
let settings = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved) settings = { ...defaults, ...saved, volumes: { ...defaults.volumes, ...(saved.volumes || {}) } };
} catch { /* private mode etc. */ }
const urlSeed = new URLSearchParams(location.search).get('seed');
if (urlSeed && /^\d+$/.test(urlSeed)) settings.seed = parseInt(urlSeed, 10) % 1e6;
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.getElementById('nowebgl').hidden = false;
  document.getElementById('menu').hidden = true;
  throw err;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const isMobile = matchMedia('(pointer: coarse)').matches;
function qualityLevel() {
  if (settings.quality === 'auto') return isMobile ? 0 : 1;
  return settings.quality === 'low' ? 0 : settings.quality === 'high' ? 2 : 1;
}
function applyQuality() {
  const q = qualityLevel();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, [1, 1.5, 2][q]));
  renderer.shadowMap.enabled = q > 0;
  sun.castShadow = q > 0;
  sun.shadow.mapSize.set(q === 2 ? 2048 : 1024, q === 2 ? 2048 : 1024);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  if (typeof terrain !== 'undefined' && terrain.quality !== q) {
    terrain.quality = q;
    terrain.lastCenter = null;
  }
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  resize();
}

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd7ea, 300, 3200);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);

// lights
const hemi = new THREE.HemisphereLight(0xd2e5ff, 0x6e654c, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

const sky = new Sky(scene);

// water: translucent dreamy aquamarine plane that follows the car
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(CHUNK_SIZE * 26, CHUNK_SIZE * 26).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x489eb2, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.9 }),
);
water.position.y = WATER_LEVEL;
water.receiveShadow = true;
scene.add(water);

// ------------------------------------------------------------------ Dream Particles
class DreamDust {
  constructor(scene, count = 650) {
    this.count = count;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    this.phases = new Float32Array(count);
    this.speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 20;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;

      const t = Math.random();
      if (t < 0.45) {
        col[i * 3] = 1.0; col[i * 3 + 1] = 0.88; col[i * 3 + 2] = 0.65;
      } else if (t < 0.75) {
        col[i * 3] = 0.68; col[i * 3 + 1] = 0.95; col[i * 3 + 2] = 0.92;
      } else {
        col[i * 3] = 0.95; col[i * 3 + 1] = 0.72; col[i * 3 + 2] = 0.96;
      }
      this.phases[i] = Math.random() * Math.PI * 2;
      this.speeds[i] = 0.6 + Math.random() * 0.8;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,245,230,0.85)');
    g.addColorStop(0.7, 'rgba(255,210,180,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);

    this.mat = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      map: tex,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.Points(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.pos = pos;
    this.box = 80;
  }

  update(dt, time, cx, cy, cz, night) {
    const p = this.pos;
    const half = this.box / 2;
    this.mat.opacity = 0.5 + night * 0.45;
    this.mat.size = 1.4 + night * 0.7;

    for (let i = 0; i < this.count; i++) {
      const idx = i * 3;
      const ph = this.phases[i];
      const sp = this.speeds[i];

      p[idx + 1] += Math.sin(time * sp + ph) * 0.02 + 0.006;
      p[idx] += Math.cos(time * 0.7 * sp + ph) * 0.012;
      p[idx + 2] += Math.sin(time * 0.5 * sp + ph) * 0.012;

      let dx = p[idx] - cx;
      let dz = p[idx + 2] - cz;
      if (dx < -half) p[idx] += this.box;
      else if (dx > half) p[idx] -= this.box;
      if (dz < -half) p[idx + 2] += this.box;
      else if (dz > half) p[idx + 2] -= this.box;

      let dy = p[idx + 1] - cy;
      if (dy < -3) p[idx + 1] = cy + 16 + Math.random() * 4;
      else if (dy > 22) p[idx + 1] = cy + Math.random() * 2;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
const dreamDust = new DreamDust(scene);

// ------------------------------------------------------------------ offroad dust & skid puffs
class DustSystem {
  constructor(scene, max = 180) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max); // seconds remaining
    this.ttl = new Float32Array(max);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0xc9b28e) } },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (340.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float d = smoothstep(0.5, 0.12, length(gl_PointCoord - 0.5));
          if (d * vA < 0.01) discard;
          gl_FragColor = vec4(uColor, d * vA);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, size, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.life[i] = life;
    this.ttl[i] = life;
    this.alpha[i] = 0;
  }

  update(dt) {
    const { pos, vel, alpha, life, ttl } = this;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; any = true; } continue; }
      any = true;
      life[i] -= dt;
      const k = Math.max(0, life[i] / ttl[i]);
      alpha[i] = 0.5 * Math.sin(Math.min(1, 1 - k) * Math.PI) * Math.min(1, k * 6 + 0.2);
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      vel[i * 3 + 1] += 1.4 * dt; // puffs rise
      this.size[i] += dt * 1.6;
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
  }
}
const dust = new DustSystem(scene);

// ------------------------------------------------------------------ world
const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
const propMats = makePropMaterials();
let world = new World(settings.seed);
const terrain = new Terrain(scene, settings.seed, { ground: groundMat, ...propMats }, qualityLevel());
const road = new Road(scene, world, renderer);
const car = new Car(scene);
car.setVehicle(settings.vehicle, settings.color);
car.placeOnRoad(world, SPAWN_INDEX);

const audio = new AudioEngine();
Object.entries(settings.volumes).forEach(([k, v]) => audio.setVolume(k, v));
const input = new Input();

applyQuality();

// ------------------------------------------------------------------ state
const state = {
  mode: 'menu',
  autodrive: false,
  camMode: 0, // 0 chase, 1 low chase, 2 bonnet / first person, 3 cinematic
  time: TIME_PRESETS[settings.time] ?? TIME_PRESETS.sunset,
  elapsed: 0,
};
const CAM_NAMES = ['chase', 'low chase', 'bonnet', 'cinematic'];

function newWorld(seed) {
  settings.seed = seed;
  save();
  world = new World(seed);
  terrain.reset(seed);
  road.reset(world);
  car.placeOnRoad(world, SPAWN_INDEX);
  car.distance = 0;
  camInit = false;
  updateSeedUi();
  showToast('new road · seed ' + seed);
}

function resetToRoad(silent = false) {
  const i = car.roadIndex;
  car.placeOnRoad(world, i);
  camInit = false;
  if (!silent && state.mode === 'drive') showToast('back on the road');
}

// ------------------------------------------------------------------ camera
let camInit = false;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmp = new THREE.Vector3();
let cineTimer = 0;
const cinePos = new THREE.Vector3();

function updateCamera(dt) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const spd = Math.abs(car.speed);
  const carPos = tmp.set(car.x, car.y, car.z);
  let wantPos, wantLook, stiffness = 5;
  const isBike = car.spec.isBike;

  if (state.mode === 'menu') {
    const a = state.elapsed * 0.08 + 2.2;
    wantPos = new THREE.Vector3(car.x + Math.sin(a) * 8.5, car.y + (isBike ? 2.0 : 2.6), car.z + Math.cos(a) * 8.5);
    wantLook = new THREE.Vector3(car.x, car.y + (isBike ? 0.75 : 0.9), car.z);
    stiffness = 3;
  } else if (state.camMode === 2) {
    const yOff = isBike ? 1.25 : car.spec.twoTone ? 2.05 : 1.35;
    const zOff = isBike ? 0.08 : 0.3;
    wantPos = new THREE.Vector3(car.x + fx * zOff, car.y + yOff, car.z + fz * zOff);
    wantLook = new THREE.Vector3(car.x + fx * 30, car.y + (isBike ? 1.15 : 1.0) + Math.sin(car.pitch) * 30, car.z + fz * 30);
    stiffness = 40;
  } else if (state.camMode === 3) {
    cineTimer -= dt;
    const d = cinePos.distanceTo(carPos);
    if (!camInit || cineTimer <= 0 || d > 90) {
      const j = Math.min(world.length - 1, car.roadIndex + Math.round(30 + spd * 1.6));
      const side = Math.random() < 0.5 ? -1 : 1;
      const h = world.rh[j];
      const off = side * (9 + Math.random() * 12);
      const x = world.rx[j] + Math.cos(h) * off, z = world.rz[j] - Math.sin(h) * off;
      const g = world.heightAt(x, z).h;
      cinePos.set(x, Math.max(g, WATER_LEVEL) + 1.2 + Math.random() * 5, z);
      cineTimer = 9 + Math.random() * 4;
      camPos.copy(cinePos);
      camLook.set(car.x, car.y + 1, car.z);
    }
    wantPos = cinePos;
    wantLook = new THREE.Vector3(car.x, car.y + (isBike ? 0.8 : 1), car.z);
    stiffness = 1000;
  } else {
    const low = state.camMode === 1;
    const dist = (isBike ? (low ? 4.3 : 6.0) : (low ? 5.8 : 7.8)) + spd * 0.05 + car.spec.length * 0.2;
    const height = (isBike ? (low ? 1.35 : 2.1) : (low ? 1.5 : 2.7)) + (car.spec.twoTone ? 0.6 : 0);
    camYaw = lerpAngle(camYaw, car.heading, 1 - Math.exp(-dt * 2.8));
    const cx = Math.sin(camYaw), cz = Math.cos(camYaw);
    wantPos = new THREE.Vector3(car.x - cx * dist, car.y + height, car.z - cz * dist);
    wantLook = new THREE.Vector3(car.x + fx * 6, car.y + (isBike ? 0.85 : 1.1), car.z + fz * 6);
    stiffness = 7;
  }

  if (!camInit) {
    camPos.copy(wantPos);
    camLook.copy(wantLook);
    camYaw = car.heading;
    camInit = true;
  }
  const k = 1 - Math.exp(-dt * stiffness);
  camPos.lerp(wantPos, k);
  camLook.lerp(wantLook, 1 - Math.exp(-dt * stiffness * 1.6));

  if (state.camMode !== 2) {
    const g = world.heightAt(camPos.x, camPos.z).h;
    const minY = Math.max(g, WATER_LEVEL) + 0.7;
    if (camPos.y < minY) camPos.y = minY;
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // Dynamic camera banking when motorcycle leans into curves
  if (isBike && state.mode === 'drive') {
    camera.rotation.z += (car.lean || 0) * (state.camMode === 2 ? 0.45 : 0.26);
  }

  const fovT = state.camMode === 2 ? (isBike ? 72 : 68) : 60 + clamp(spd / car.spec.maxSpeed, 0, 1) * 10;
  camera.fov = lerp(camera.fov, state.camMode === 3 ? 38 : fovT, 1 - Math.exp(-dt * 2));
  camera.updateProjectionMatrix();
}
let camYaw = 0;
function lerpAngle(a, b, t) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * t;
}

// ------------------------------------------------------------------ environment
const waterDay = new THREE.Color();
const waterNight = new THREE.Color();
function applyTime(hours) {
  sky.setTime(hours);
  sun.color.copy(sky.lightColor);
  sun.intensity = sky.lightIntensity;
  hemi.color.copy(sky.hemiSky);
  hemi.groundColor.copy(sky.hemiGround);
  hemi.intensity = sky.hemiIntensity;
  scene.fog.color.copy(sky.fogColor);
  renderer.toneMappingExposure = lerp(1.08, 1.38, sky.night);
  const n = sky.night;
  car.setNight(n);
  road.setNight(n);
  setPropNight(propMats, n);
  // water shifts smoothly through the day and picks up a cooler cast in snowy regions
  waterDay.setHex(0x489eb2).lerp(WATER_ICE, curBiome.snow * 0.55);
  waterNight.setHex(0x22364c).lerp(WATER_ICE_NIGHT, curBiome.snow * 0.4);
  water.material.color.copy(waterDay).lerp(waterNight, n);
}
const WATER_ICE = new THREE.Color(0x9fc4d8);
const WATER_ICE_NIGHT = new THREE.Color(0x33475c);

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), pause: $('pause'), hud: $('hud'), toast: $('toast'), loading: $('loading'),
  speed: $('speed'), unit: $('unit'), dist: $('dist'), clock: $('clock'), auto: $('auto-badge'),
  biome: $('biome'), touch: $('touch'),
};

function fmtDistance(m) {
  if (settings.units === 'mph') return (m / 1609.34).toFixed(1) + ' mi';
  return (m / 1000).toFixed(1) + ' km';
}
function fmtClock(h) {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

let toastTimer = 0;
function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  toastTimer = 2.2;
}

function buildChoiceRow(el, items, current, onPick) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (it.value === current ? ' active' : '');
    if (it.swatch) {
      b.classList.add('swatch');
      b.style.setProperty('--c', it.swatch);
      b.setAttribute('aria-label', 'colour ' + it.swatch);
    } else b.textContent = it.label;
    b.addEventListener('click', () => {
      el.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      onPick(it.value);
    });
    el.appendChild(b);
  }
}

function initUi() {
  const vehicleItems = Object.entries(VEHICLES).map(([k, v]) => ({ value: k, label: v.label }));
  document.querySelectorAll('[data-row="vehicle"]').forEach((el) =>
    buildChoiceRow(el, vehicleItems, settings.vehicle, (v) => {
      settings.vehicle = v; save();
      car.setVehicle(v, settings.color); applyTime(state.time); syncRows();
    }));
  document.querySelectorAll('[data-row="color"]').forEach((el) =>
    buildChoiceRow(el, COLORS.map((c) => ({ value: c, swatch: c })), settings.color, (c) => {
      settings.color = c; save();
      car.setVehicle(settings.vehicle, c); applyTime(state.time); syncRows();
    }));
  const timeItems = Object.keys(TIME_PRESETS).map((k) => ({ value: k, label: k }));
  document.querySelectorAll('[data-row="time"]').forEach((el) =>
    buildChoiceRow(el, timeItems, settings.time, (t) => {
      settings.time = t; save();
      state.time = TIME_PRESETS[t]; syncRows();
    }));
  document.querySelectorAll('[data-row="quality"]').forEach((el) =>
    buildChoiceRow(el, ['auto', 'low', 'medium', 'high'].map((q) => ({ value: q, label: q })), settings.quality, (q) => {
      settings.quality = q; save(); applyQuality(); syncRows();
    }));
  document.querySelectorAll('[data-row="units"]').forEach((el) =>
    buildChoiceRow(el, [{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }], settings.units, (u) => {
      settings.units = u; save(); syncRows();
    }));

  document.querySelectorAll('input[data-vol]').forEach((el) => {
    el.value = settings.volumes[el.dataset.vol];
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      settings.volumes[el.dataset.vol] = v;
      audio.setVolume(el.dataset.vol, v);
      document.querySelectorAll(`input[data-vol="${el.dataset.vol}"]`).forEach((o) => { if (o !== el) o.value = v; });
      save();
    });
  });
  document.querySelectorAll('input[data-setting="cycle"]').forEach((el) => {
    el.checked = settings.cycle;
    el.addEventListener('change', () => {
      settings.cycle = el.checked; save();
      document.querySelectorAll('input[data-setting="cycle"]').forEach((o) => (o.checked = el.checked));
    });
  });

  $('begin').addEventListener('click', startDrive);
  $('resume').addEventListener('click', () => setPaused(false));
  $('to-menu').addEventListener('click', () => { setPaused(false); state.mode = 'menu'; showMenu(); });
  document.querySelectorAll('[data-action="new-road"]').forEach((b) =>
    b.addEventListener('click', () => newWorld(Math.floor(Math.random() * 1e6))));
  $('seed-input').addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isNaN(v) && v >= 0) newWorld(v % 1e6);
  });
  $('share').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?seed=' + settings.seed;
    try { await navigator.clipboard.writeText(url); showToast('link copied'); } catch { showToast(url); }
  });
  $('pause-btn').addEventListener('click', () => setPaused(true));
  updateSeedUi();
}

function syncRows() {
  const map = { vehicle: settings.vehicle, color: settings.color, time: settings.time, quality: settings.quality, units: settings.units };
  for (const [row, val] of Object.entries(map)) {
    document.querySelectorAll(`[data-row="${row}"]`).forEach((el) => {
      const items = [...el.children];
      items.forEach((c) => c.classList.remove('active'));
      const keys = row === 'color' ? COLORS : row === 'vehicle' ? Object.keys(VEHICLES) : row === 'time' ? Object.keys(TIME_PRESETS) : row === 'quality' ? ['auto', 'low', 'medium', 'high'] : ['kmh', 'mph'];
      const idx = keys.indexOf(val);
      if (items[idx]) items[idx].classList.add('active');
    });
  }
}

function updateSeedUi() {
  $('seed-input').value = settings.seed;
  document.querySelectorAll('.seed-label').forEach((el) => (el.textContent = settings.seed));
}

function showMenu() {
  ui.menu.hidden = false;
  ui.menu.classList.remove('fade');
  ui.hud.hidden = true;
  ui.pause.hidden = true;
}

function startDrive() {
  audio.start();
  state.mode = 'drive';
  ui.menu.classList.add('fade');
  setTimeout(() => { if (state.mode !== 'menu') ui.menu.hidden = true; }, 700);
  ui.hud.hidden = !settings.hud;
  camInit = false;
  showToast(isMobile ? 'hold ▲ to drive' : 'W / ↑ to drive · E autodrive · C camera · H hide ui');
}

function setPaused(p) {
  if (state.mode === 'menu') return;
  state.mode = p ? 'pause' : 'drive';
  ui.pause.hidden = !p;
  ui.hud.hidden = p || !settings.hud;
  if (p) audio.suspend(); else audio.resume();
}

// keyboard shortcuts
input.on('Escape', () => { if (state.mode === 'drive') setPaused(true); else if (state.mode === 'pause') setPaused(false); });
input.on('KeyP', () => { if (state.mode === 'drive') setPaused(true); else if (state.mode === 'pause') setPaused(false); });
input.on('Enter', () => { if (state.mode === 'menu') startDrive(); else if (state.mode === 'pause') setPaused(false); });
input.on('KeyE', () => {
  if (state.mode !== 'drive') return;
  state.autodrive = !state.autodrive;
  car.cruise = Math.max(12, Math.min(car.spec.maxSpeed * 0.7, Math.abs(car.speed) || car.spec.maxSpeed * 0.55));
  showToast(state.autodrive ? 'autodrive on · sit back' : 'autodrive off');
});
input.on('KeyC', () => {
  if (state.mode !== 'drive') return;
  state.camMode = (state.camMode + 1) % CAM_NAMES.length;
  camInit = false;
  showToast('camera: ' + CAM_NAMES[state.camMode]);
});
input.on('KeyH', () => {
  if (state.mode !== 'drive') return;
  settings.hud = !settings.hud; save();
  ui.hud.hidden = !settings.hud;
});
input.on('KeyR', () => { if (state.mode === 'drive') resetToRoad(); });
input.on('KeyN', () => { if (state.mode === 'drive') newWorld(Math.floor(Math.random() * 1e6)); });
input.on('KeyT', () => {
  if (state.mode !== 'drive') return;
  const keys = Object.keys(TIME_PRESETS);
  settings.time = keys[(keys.indexOf(settings.time) + 1) % keys.length];
  state.time = TIME_PRESETS[settings.time]; save(); syncRows();
  showToast('time: ' + settings.time);
});
input.on('KeyF', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'drive') setPaused(true);
});
document.querySelectorAll('[data-touch-btn]').forEach((el) => {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); input._emit(el.dataset.touchBtn); });
});
document.getElementById('touch').addEventListener('contextmenu', (e) => e.preventDefault());

// ------------------------------------------------------------------ loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let lastT = performance.now();
let fpsAcc = 0, fpsFrames = 0;
let firstReady = false;
const curBiome = { snow: 0, desert: 0, autumn: 0, blossom: 0, farm: 0 };
let lastBiome = '';
let biomeAcc = 0;
let biomeToastCd = 0;
let dustAcc = 0;
let driveInput = { throttle: 0, brake: 0, steer: 0 };

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 1 / 20);
  lastT = now;
  state.elapsed += dt;

  // poll every frame so gamepad buttons work in the menus and while paused
  const raw = input.read();
  if (state.mode !== 'pause') {
    let drive = { throttle: 0, brake: 0, steer: 0 };
    if (state.mode === 'drive') {
      drive = raw;
      driveInput = drive;
      if (state.autodrive && (raw.brake > 0 || Math.abs(raw.steer) > 0)) {
        state.autodrive = false;
        showToast('autodrive off');
      }
      if (state.autodrive && raw.throttle > 0) car.cruise = Math.min(car.spec.maxSpeed * 0.95, (car.cruise || 20) + dt * 4);
    }
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    let fell = false;
    for (let s = 0; s < steps; s++) fell = car.update(h, world, drive, state.autodrive && state.mode === 'drive') || fell;
    if (fell) resetToRoad(state.mode !== 'drive');

    if (settings.cycle && state.mode === 'drive') {
      state.time = (state.time + dt * (24 / 1200)) % 24;
    }
  }

  // Animate floating dreamcore objects via shader uniform
  floatingTimeUniform.value = state.elapsed;

  // biome tracking: HUD label always current, toast when crossing into a new one
  biomeAcc -= dt;
  if (biomeAcc <= 0) {
    biomeAcc = 0.4;
    world.biomeWeights(car.x, car.z, true, curBiome);
    const name = world.biomeName(car.x, car.z);
    if (ui.biome.textContent !== name) {
      ui.biome.textContent = name;
      if (state.mode === 'drive' && name !== lastBiome && state.elapsed > 6 && biomeToastCd <= 0) {
        showToast('entering ' + name);
        biomeToastCd = 12;
      }
      if (name !== lastBiome) lastBiome = name;
    }
  }
  biomeToastCd = Math.max(0, biomeToastCd - dt);

  applyTime(state.time);
  terrain.update(car.x, car.z);
  road.update(car.roadIndex);
  updateCamera(dt);
  sky.update(camera, state.elapsed);
  dreamDust.update(dt, state.elapsed, car.x, car.y, car.z, sky.night);

  // kicked-up dust: gravel when off-road, tyre smoke under hard braking, white in snow
  const spdAbs = Math.abs(car.speed);
  if (state.mode === 'drive' && ((car.offRoad > 0.5 && spdAbs > 4) || (driveInput.brake > 0.6 && spdAbs > 14))) {
    dustAcc += dt * Math.min(30, spdAbs);
    while (dustAcc > 1) {
      dustAcc -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const snowPuff = curBiome.snow > 0.5;
      const col = snowPuff ? 0xeef3f8 : curBiome.desert > 0.5 ? 0xd8b98a : 0xc9b28e;
      dust.mat.uniforms.uColor.value.setHex(col);
      dust.spawn(
        car.x - fx * 1.6 + rx * side * 0.8 + (Math.random() - 0.5) * 0.4,
        car.y + 0.15,
        car.z - fz * 1.6 + rz * side * 0.8 + (Math.random() - 0.5) * 0.4,
        -fx * spdAbs * 0.15 + (Math.random() - 0.5) * 1.2,
        0.6 + Math.random() * 1.2,
        -fz * spdAbs * 0.15 + (Math.random() - 0.5) * 1.2,
        0.35 + Math.random() * 0.5,
        0.7 + Math.random() * 0.6
      );
    }
  }
  dust.update(dt);

  // light/shadow & water follow the car
  sun.position.set(car.x + sky.lightDir.x * 300, car.y + sky.lightDir.y * 300, car.z + sky.lightDir.z * 300);
  sun.target.position.set(car.x, car.y, car.z);
  water.position.x = Math.round(car.x / 64) * 64;
  water.position.z = Math.round(car.z / 64) * 64;

  // fog must sit inside the streamed terrain radius or the world edge shows
  const ringFar = qualityLevel() > 0 ? 2950 : 1980; // matches the outermost LOD ring
  const fogFar = lerp(ringFar, 1450, sky.night);
  scene.fog.far = fogFar;
  scene.fog.near = fogFar * 0.08;

  // HUD
  if (state.mode === 'drive' && settings.hud) {
    const s = Math.abs(car.speed) * (settings.units === 'mph' ? 2.23694 : 3.6);
    ui.speed.textContent = Math.round(s);
    ui.unit.textContent = settings.units === 'mph' ? 'mph' : 'km/h';
    ui.dist.textContent = fmtDistance(car.distance);
    ui.clock.textContent = fmtClock(state.time);
    ui.auto.classList.toggle('on', state.autodrive);
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.classList.remove('show');
  }

  audio.update({
    rpm: car.rpm, speed: car.speed, throttle: state.mode === 'drive' ? car.throttleVis : 0,
    offRoad: car.offRoad, night: sky.night, paused: state.mode === 'pause' || state.mode === 'menu',
    engineRange: car.spec.engine.range / 95, isBike: car.spec.isBike,
    biodamp: clamp(curBiome.desert + curBiome.snow, 0, 1),
  });

  ui.touch.hidden = !isMobile || state.mode !== 'drive';

  if (!firstReady && terrain.chunks.size >= 9) {
    firstReady = true;
    ui.loading.classList.add('done');
    $('begin').disabled = false;
  }

  renderer.render(scene, camera);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 1) { window.__fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
}

initUi();
applyTime(state.time);
resize();
frame();

window.zen = { state, car, world: () => world, terrain, settings, newWorld };
