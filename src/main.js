import * as THREE from 'three';
import './style.css';
import { World, SPAWN_INDEX, WATER_LEVEL, CHUNK_SIZE } from './world.js';
import { Terrain } from './terrain.js';
import { Road } from './road.js';
import { Sky, TIME_PRESETS } from './sky.js';
import { Car, VEHICLES, COLORS } from './car.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { makePropMaterials } from './props.js';
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
renderer.toneMappingExposure = 1.0;
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
    terrain.lastCenter = null; // re-plan rings next frame
  }
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  resize();
}

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd7ea, 300, 3200);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);

// lights
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a6448, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
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

// water: one big plane that follows the car
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(CHUNK_SIZE * 26, CHUNK_SIZE * 26).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x5b95ad, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.9 }),
);
water.position.y = WATER_LEVEL;
water.receiveShadow = true;
scene.add(water);

// ------------------------------------------------------------------ world
const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
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
  mode: 'menu', // menu | drive | pause
  autodrive: false,
  camMode: 0, // 0 chase, 1 low chase, 2 bonnet, 3 cinematic
  time: TIME_PRESETS[settings.time] ?? TIME_PRESETS.sunset,
  photo: false,
  elapsed: 0,
  idleTimer: 0,
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

function resetToRoad() {
  const i = car.roadIndex;
  car.placeOnRoad(world, i);
  camInit = false;
  showToast('back on the road');
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

  if (state.mode === 'menu') {
    // slow orbit around the car
    const a = state.elapsed * 0.08 + 2.2;
    wantPos = new THREE.Vector3(car.x + Math.sin(a) * 9, car.y + 2.6, car.z + Math.cos(a) * 9);
    wantLook = new THREE.Vector3(car.x, car.y + 0.9, car.z);
    stiffness = 3;
  } else if (state.camMode === 2) {
    wantPos = new THREE.Vector3(car.x + fx * 0.3, car.y + (car.spec.twoTone ? 2.05 : 1.35), car.z + fz * 0.3);
    wantLook = new THREE.Vector3(car.x + fx * 30, car.y + 1.0 + Math.sin(car.pitch) * 30, car.z + fz * 30);
    stiffness = 40;
  } else if (state.camMode === 3) {
    // cinematic: drop a camera beside the road ahead; hold until the car passes well by
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
    wantLook = new THREE.Vector3(car.x, car.y + 1, car.z);
    stiffness = 1000;
  } else {
    const low = state.camMode === 1;
    const dist = (low ? 5.8 : 7.8) + spd * 0.05 + car.spec.length * 0.2;
    const height = (low ? 1.5 : 2.7) + (car.spec.twoTone ? 0.6 : 0);
    // trail the car's direction of travel (smoothed separately for a floaty, calm feel)
    camYaw = lerpAngle(camYaw, car.heading, 1 - Math.exp(-dt * 2.8));
    const cx = Math.sin(camYaw), cz = Math.cos(camYaw);
    wantPos = new THREE.Vector3(car.x - cx * dist, car.y + height, car.z - cz * dist);
    wantLook = new THREE.Vector3(car.x + fx * 6, car.y + 1.1, car.z + fz * 6);
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

  // keep the camera above ground and water
  if (state.camMode !== 2) {
    const g = world.heightAt(camPos.x, camPos.z).h;
    const minY = Math.max(g, WATER_LEVEL) + 0.7;
    if (camPos.y < minY) camPos.y = minY;
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  const fovT = state.camMode === 2 ? 68 : 60 + clamp(spd / car.spec.maxSpeed, 0, 1) * 10;
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
function applyTime(hours) {
  sky.setTime(hours);
  sun.color.copy(sky.lightColor);
  sun.intensity = sky.lightIntensity;
  hemi.color.copy(sky.hemiSky);
  hemi.groundColor.copy(sky.hemiGround);
  hemi.intensity = sky.hemiIntensity;
  scene.fog.color.copy(sky.fogColor);
  renderer.toneMappingExposure = lerp(1.1, 1.4, sky.night);
  const n = sky.night;
  car.setNight(n);
  road.setNight(n);
  water.material.color.setHex(n > 0.5 ? 0x2a3c50 : 0x5b95ad);
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), pause: $('pause'), hud: $('hud'), toast: $('toast'), loading: $('loading'),
  speed: $('speed'), unit: $('unit'), dist: $('dist'), clock: $('clock'), auto: $('auto-badge'),
  cam: $('cam-badge'), touch: $('touch'),
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
input.on('Enter', () => { if (state.mode === 'menu') startDrive(); });
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
  el.addEventListener('click', () => input._emit(el.dataset.touchBtn));
});

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

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 1 / 20);
  lastT = now;
  state.elapsed += dt;

  if (state.mode !== 'pause') {
    const raw = input.read();
    let drive = { throttle: 0, brake: 0, steer: 0 };
    if (state.mode === 'drive') {
      drive = raw;
      if (state.autodrive && (raw.brake > 0 || Math.abs(raw.steer) > 0)) {
        // any manual steering/braking takes over from autodrive
        state.autodrive = false;
        showToast('autodrive off');
      }
      if (state.autodrive && raw.throttle > 0) car.cruise = Math.min(car.spec.maxSpeed * 0.95, (car.cruise || 20) + dt * 4);
    }
    // physics at a fixed-ish sub-step for stability
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    let fell = false;
    for (let s = 0; s < steps; s++) fell = car.update(h, world, drive, state.autodrive && state.mode === 'drive') || fell;
    if (fell) resetToRoad();

    if (settings.cycle && state.mode === 'drive') {
      state.time = (state.time + dt * (24 / 1200)) % 24; // full day every 20 minutes
    }
  }

  applyTime(state.time);
  terrain.update(car.x, car.z);
  road.update(car.roadIndex);
  updateCamera(dt);
  sky.update(camera, state.elapsed);

  // light/shadow & water follow the car
  sun.position.set(car.x + sky.lightDir.x * 300, car.y + sky.lightDir.y * 300, car.z + sky.lightDir.z * 300);
  sun.target.position.set(car.x, car.y, car.z);
  water.position.x = Math.round(car.x / 64) * 64;
  water.position.z = Math.round(car.z / 64) * 64;
  // fog: denser at dawn/night for mood
  const fogFar = lerp(qualityLevel() > 0 ? 3600 : 2600, 1600, sky.night);
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
    engineRange: car.spec.engine.range / 95,
  });

  ui.touch.hidden = !isMobile || state.mode !== 'drive';

  // loading veil until the nearby terrain exists
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

// Expose for debugging in the console
window.zen = { state, car, world: () => world, terrain, settings, newWorld };
