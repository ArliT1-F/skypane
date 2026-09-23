import * as THREE from 'three';
import './style.css';
import { World } from './world/world.js';
import { BIOMES, BIOME_KEYS } from './world/biomes.js';
import { Sky, TIME_PRESETS } from './world/sky.js';
import { Precipitation, WEATHER } from './world/weather.js';
import { Car } from './car/car.js';
import { CAR_COLORS } from './car/carModel.js';
import { CameraRig, CAMERA_MODES, CAMERA_LABELS } from './core/camera.js';
import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { hashString, clamp } from './core/noise.js';
import { ROAD_HALF } from './world/terrain.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/* ------------------------------------------------------------------ settings */

const DEFAULTS = {
  biome: 'meadow',
  time: 'golden',
  timeFlow: false,
  weather: 'clear',
  car: 'sage',
  camera: 'chase',
  quality: 'medium',
  autodrive: false,
  hud: true,
  units: 'kmh',
  engine: true,
  ambience: true,
  music: true,
  volume: 0.8,
  seed: '',
};
const STORE_KEY = 'zen-drive-settings-v1';
const settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
const saveSettings = () => localStorage.setItem(STORE_KEY, JSON.stringify(settings));

/* ------------------------------------------------------------------ renderer */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);

function applyQualityToRenderer() {
  const q = settings.quality;
  const maxDpr = q === 'low' ? 1 : q === 'high' ? 2 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.shadowMap.enabled = q !== 'low';
}
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
applyQualityToRenderer();
resize();
window.addEventListener('resize', resize);

const sky = new Sky(scene, renderer);
// soft studio reflections so the car paint reads well even when backlit
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}
const precip = new Precipitation(scene);
const input = new Input();
const audio = new AudioEngine();

/* ------------------------------------------------------------------ state */

let world = null;
let car = null;
let rig = null;
let running = false; // game started (past title)
let paused = true;
let hour = TIME_PRESETS[settings.time] ?? 17.6;
let elapsed = 0;
let resetFade = 0;
let loading = false;

const $ = (id) => document.getElementById(id);
const ui = {
  title: $('title'),
  begin: $('begin'),
  menu: $('menu'),
  hud: $('hud'),
  speed: $('speed'),
  unit: $('unit'),
  dist: $('dist'),
  distUnit: $('dist-unit'),
  auto: $('auto-badge'),
  loader: $('loader'),
  loaderBar: $('loader-bar'),
  toast: $('toast'),
  fade: $('fade'),
  touch: $('touch'),
  resume: $('resume'),
};

function currentSeed() {
  const s = settings.seed.trim();
  return s ? hashString(s) : 0;
}

/* ------------------------------------------------------------------ world lifecycle */

async function buildWorld() {
  loading = true;
  ui.loader.classList.add('show');
  ui.loaderBar.style.width = '0%';
  await nextFrame();

  if (world) world.dispose();
  if (car) scene.remove(car.model.group);

  let seed = currentSeed();
  if (!seed) seed = (Math.random() * 2 ** 31) | 0;
  const biome = BIOMES[settings.biome];
  world = new World({ scene, renderer, seed, biome, quality: settings.quality });
  car = new Car(scene, world, CAR_COLORS[settings.car]);
  car.autodrive = settings.autodrive;
  const startS = -world.road.startProgress; // world origin
  world.road.ensure(1500);
  car.placeOnRoad(startS);
  rig = new CameraRig(camera, world);
  rig.setMode(running ? settings.camera : 'far');
  bindCameraDrag();
  applyShadowSettings();

  const total = world.prime(car.pos.x, car.pos.z) || 1;
  let left = total;
  while (left > 0) {
    left = world.step(24);
    ui.loaderBar.style.width = `${Math.round((1 - left / total) * 100)}%`;
    await nextFrame();
  }
  car.pos.y = world.groundHeight(car.pos.x, car.pos.z);
  rig.snap = true;
  ui.loader.classList.remove('show');
  loading = false;
}

function applyShadowSettings() {
  const on = settings.quality !== 'low';
  sky.setShadows(on, settings.quality === 'high' ? 4096 : 2048);
  if (car) car.setShadows(on);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* ------------------------------------------------------------------ menu / settings UI */

function buildOptions() {
  const groups = {
    biome: BIOME_KEYS.map((k) => [k, BIOMES[k].label]),
    time: Object.keys(TIME_PRESETS).map((k) => [k, k === 'golden' ? 'Golden hour' : k[0].toUpperCase() + k.slice(1)]),
    weather: Object.keys(WEATHER).map((k) => [k, WEATHER[k].label]),
    camera: CAMERA_MODES.map((k) => [k, CAMERA_LABELS[k]]),
    quality: [
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ],
    units: [
      ['kmh', 'km/h'],
      ['mph', 'mph'],
    ],
  };
  for (const [key, opts] of Object.entries(groups)) {
    const el = document.querySelector(`[data-group="${key}"]`);
    if (!el) continue;
    el.innerHTML = '';
    for (const [val, label] of opts) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = label;
      b.dataset.value = val;
      if (key === 'biome') b.title = BIOMES[val].blurb;
      b.addEventListener('click', () => setOption(key, val));
      el.appendChild(b);
    }
  }
  const swatches = document.querySelector('[data-group="car"]');
  swatches.innerHTML = '';
  for (const [name, hex] of Object.entries(CAR_COLORS)) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = `#${hex.toString(16).padStart(6, '0')}`;
    b.dataset.value = name;
    b.title = name;
    b.setAttribute('aria-label', `${name} paint`);
    b.addEventListener('click', () => setOption('car', name));
    swatches.appendChild(b);
  }
  for (const key of ['timeFlow', 'autodrive', 'hud', 'engine', 'ambience', 'music']) {
    const el = document.querySelector(`[data-toggle="${key}"]`);
    if (el) el.addEventListener('change', () => setOption(key, el.checked));
  }
  $('volume').addEventListener('input', (e) => setOption('volume', +e.target.value));
  $('seed').addEventListener('change', (e) => {
    settings.seed = e.target.value;
    saveSettings();
  });
  $('regen').addEventListener('click', () => regenerate());
  $('random-seed').addEventListener('click', () => {
    const words = ['amber', 'cedar', 'drift', 'ember', 'fern', 'glass', 'haze', 'isle', 'juniper', 'kelp', 'lumen', 'moss', 'north', 'opal', 'pine', 'quiet', 'river', 'sable', 'tide', 'umber', 'vale', 'willow', 'yarrow', 'zephyr'];
    const pick = () => words[(Math.random() * words.length) | 0];
    settings.seed = `${pick()}-${pick()}-${(Math.random() * 100) | 0}`;
    $('seed').value = settings.seed;
    saveSettings();
    regenerate();
  });
  syncUI();
}

function syncUI() {
  for (const el of document.querySelectorAll('[data-group]')) {
    const key = el.dataset.group;
    let val = settings[key];
    for (const c of el.children) c.classList.toggle('active', c.dataset.value === val);
  }
  for (const el of document.querySelectorAll('[data-toggle]')) el.checked = !!settings[el.dataset.toggle];
  $('volume').value = settings.volume;
  $('seed').value = settings.seed;
  document.body.classList.toggle('no-hud', !settings.hud);
  ui.unit.textContent = settings.units === 'mph' ? 'mph' : 'km/h';
  ui.auto.classList.toggle('on', settings.autodrive);
  const tf = document.querySelector('[data-group="time"]');
  tf.classList.toggle('flowing', settings.timeFlow);
}

let regenPending = false;
function setOption(key, val) {
  const prev = settings[key];
  settings[key] = val;
  saveSettings();
  switch (key) {
    case 'biome':
      if (prev !== val && running) regenPending = true;
      break;
    case 'time':
      hour = TIME_PRESETS[val];
      break;
    case 'car':
      if (car) car.model.setColor(CAR_COLORS[val]);
      break;
    case 'camera':
      if (rig) rig.setMode(val);
      break;
    case 'autodrive':
      if (car) car.autodrive = val;
      break;
    case 'quality':
      applyQualityToRenderer();
      resize();
      applyShadowSettings();
      if (world) world.setQuality(val);
      break;
    case 'engine':
    case 'ambience':
    case 'music':
      audio.enabled[key] = val;
      break;
    case 'volume':
      audio.setVolume(val);
      break;
  }
  syncUI();
  if (regenPending && key === 'biome') {
    regenPending = false;
    regenerate();
  }
}

async function regenerate() {
  if (loading) return;
  await buildWorld();
  if (running) toast(`${BIOMES[settings.biome].label} · a new road`);
}

function openMenu() {
  if (!running) return;
  paused = true;
  ui.menu.classList.add('show');
  audio.update(0, car, settings.weather, true);
}
function closeMenu() {
  ui.menu.classList.remove('show');
  paused = false;
  lastT = performance.now();
}

let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

/* ------------------------------------------------------------------ camera drag */

let dragBound = false;
function bindCameraDrag() {
  if (dragBound) return;
  dragBound = true;
  let down = false;
  let lx = 0;
  let ly = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    down = true;
    lx = e.clientX;
    ly = e.clientY;
    rig.dragging = true;
  });
  window.addEventListener('pointermove', (e) => {
    if (!down || !rig) return;
    rig.orbit += (e.clientX - lx) * 0.006;
    rig.orbitPitch = clamp(rig.orbitPitch - (e.clientY - ly) * 0.004, -0.2, 1.2);
    lx = e.clientX;
    ly = e.clientY;
  });
  window.addEventListener('pointerup', () => {
    down = false;
    if (rig) rig.dragging = false;
  });
}

/* ------------------------------------------------------------------ touch controls */

function bindTouch() {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!isTouch) return;
  document.body.classList.add('touch');
  const pad = $('steer-pad');
  const knob = $('steer-knob');
  let id = null;
  let cx = 0;
  const move = (x) => {
    const r = pad.getBoundingClientRect();
    const half = r.width / 2;
    const v = clamp((x - cx) / (half * 0.8), -1, 1);
    input.touch.steer = v;
    knob.style.transform = `translateX(${v * half * 0.6}px)`;
  };
  pad.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    const r = pad.getBoundingClientRect();
    cx = r.left + r.width / 2;
    pad.setPointerCapture(id);
    move(e.clientX);
  });
  pad.addEventListener('pointermove', (e) => e.pointerId === id && move(e.clientX));
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    input.touch.steer = 0;
    knob.style.transform = '';
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  const hold = (el, key) => {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      input.touch[key] = 1;
      el.classList.add('down');
    });
    const up = () => {
      input.touch[key] = 0;
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  hold($('gas'), 'throttle');
  hold($('brake'), 'brake');
}

/* ------------------------------------------------------------------ key bindings */

input.on('Escape', () => (ui.menu.classList.contains('show') ? closeMenu() : openMenu()));
input.on('KeyP', () => (ui.menu.classList.contains('show') ? closeMenu() : openMenu()));
input.on('KeyC', () => {
  if (!rig || paused) return;
  settings.camera = rig.next();
  saveSettings();
  syncUI();
  toast(`camera · ${CAMERA_LABELS[settings.camera].toLowerCase()}`);
});
input.on('KeyF', () => {
  if (!car || paused) return;
  setOption('autodrive', !settings.autodrive);
  toast(settings.autodrive ? 'autodrive on · sit back' : 'autodrive off');
});
input.on('KeyH', () => {
  if (!running) return;
  setOption('hud', !settings.hud);
});
input.on('KeyR', () => {
  if (!car || paused) return;
  softReset();
});
input.on('KeyT', () => {
  if (!running || paused) return;
  const keys = Object.keys(TIME_PRESETS);
  const i = (keys.indexOf(settings.time) + 1) % keys.length;
  setOption('time', keys[i]);
  toast(`time · ${keys[i] === 'golden' ? 'golden hour' : keys[i]}`);
});
input.on('KeyM', () => {
  if (!running) return;
  setOption('music', !settings.music);
  toast(settings.music ? 'music on' : 'music off');
});

function softReset() {
  resetFade = 1;
  setTimeout(() => {
    car.resetToRoad();
    rig.snap = true;
  }, 280);
}

/* ------------------------------------------------------------------ main loop */

let lastT = performance.now();
let idleTimer = 0;
let offroadTimer = 0;
const tmpFocus = new THREE.Vector3();
const farProbe = { found: false };

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min((now - lastT) / 1000, 0.5);
  lastT = now;
  const dt = Math.min(realDt, 1 / 20);
  if (!world || loading) {
    renderer.render(scene, camera);
    return;
  }

  const w = WEATHER[settings.weather];
  const active = running && !paused;
  if (active) {
    elapsed += dt;
    const inp = input.update(dt, car.speed);
    // physics at fixed substeps for stability
    const sub = Math.ceil(dt / (1 / 120));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) car.update(h, inp);
    if (settings.timeFlow) hour = (hour + dt * (24 / 1200)) % 24; // 20 min day

    // idle HUD fade: the hud recedes after a while of calm driving
    const busy = Math.abs(inp.steer) > 0.3 || inp.brake > 0;
    idleTimer = busy ? 0 : idleTimer + dt;
    ui.hud.classList.toggle('calm', idleTimer > 6);

    // gentle auto-recovery if stuck in water or far off-road
    if (car.inWater && car.sinking > 1.2) softReset();
    const far = car.world.road.nearest(car.pos.x, car.pos.z, 300, farProbe);
    offroadTimer = far.found ? 0 : offroadTimer + dt;
    if (offroadTimer > 4) {
      offroadTimer = 0;
      softReset();
    }
  } else if (running) {
    input.update(dt, car.speed);
  } else {
    // title screen: let the car drive itself for a living backdrop
    car.autodrive = true;
    car.cruise = 17;
    car.update(dt, { steer: 0, throttle: 0, brake: 0, reverse: 0 });
  }

  world.update(car.pos.x, car.pos.z, camera, active ? 4 : 8);
  rig.update(dt, car);

  tmpFocus.copy(car.pos);
  sky.update(hour, tmpFocus, world.viewDist, elapsed + now * 0.0003, w);
  car.setLights(sky.night);
  scene.environmentIntensity = (0.12 + 0.5 * (1 - sky.night)) * (1 - w.overcast * 0.3);
  const precipMode = settings.weather === 'snow' ? 'snow' : 'rain';
  precip.update(dt, camera, precipMode, w.precip * (settings.quality === 'low' ? 0.5 : 1), 1 - sky.night * 0.7, renderer.getPixelRatio());
  renderer.toneMappingExposure = 1.0 + sky.night * 0.25;

  audio.update(dt, car, settings.weather, !active);

  // HUD
  if (running) {
    const v = settings.units === 'mph' ? car.kmh * 0.621371 : car.kmh;
    ui.speed.textContent = Math.round(v);
    const d = settings.units === 'mph' ? car.distance / 1609.34 : car.distance / 1000;
    ui.dist.textContent = d < 10 ? d.toFixed(2) : d < 100 ? d.toFixed(1) : Math.round(d);
    ui.distUnit.textContent = settings.units === 'mph' ? 'mi' : 'km';
  }

  if (resetFade > 0) {
    ui.fade.style.opacity = Math.min(1, resetFade * 1.6).toFixed(3);
    resetFade = Math.max(0, resetFade - realDt * 1.6);
    if (resetFade === 0) ui.fade.style.opacity = '0';
  }

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ boot */

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (running && !paused) openMenu();
    audio.suspend();
  } else audio.resume();
});

ui.begin.addEventListener('click', start);
ui.resume.addEventListener('click', closeMenu);
$('menu-btn').addEventListener('click', openMenu);
$('title-settings').addEventListener('click', () => {
  ui.menu.classList.add('show', 'from-title');
});

function start() {
  audio.enabled = { engine: settings.engine, ambience: settings.ambience, music: settings.music };
  audio.volume = settings.volume;
  audio.start();
  ui.title.classList.add('hide');
  ui.menu.classList.remove('show', 'from-title');
  document.body.classList.add('playing');
  resetFade = 1;
  setTimeout(() => {
    car.autodrive = settings.autodrive;
    car.cruise = 24;
    car.distance = 0;
    const road = world.road;
    const near = road.nearest(car.pos.x, car.pos.z, 500, {});
    car.placeOnRoad(near.found ? near.s : -road.startProgress);
    rig.setMode(settings.camera);
    running = true;
    paused = false;
    elapsed = 0;
    lastT = performance.now();
    toast(settings.autodrive ? 'autodrive on · press F to take the wheel' : 'W / ↑ to drive · F for autodrive');
  }, 300);
}

// close menu when it was opened from title
$('menu-close').addEventListener('click', () => {
  if (ui.menu.classList.contains('from-title')) ui.menu.classList.remove('show', 'from-title');
  else closeMenu();
});

buildOptions();
bindTouch();
buildWorld().then(() => {
  ui.begin.disabled = false;
  ui.begin.textContent = 'begin';
});
requestAnimationFrame(frame);

// expose for debugging in the console
window.zen = { get world() { return world; }, get car() { return car; }, settings, ROAD_HALF };
