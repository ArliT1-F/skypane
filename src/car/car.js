// Forgiving arcade car physics + optional autodrive that follows the road.
import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/noise.js';
import { buildCar } from './carModel.js';
import { ROAD_HALF } from '../world/terrain.js';

const WHEELBASE = 2.62;
const HALF_TRACK = 0.78;
const MAX_SPEED = 44; // m/s (~158 km/h)
const G = 9.81;

const _probe = {};
const _pt = {};
const _near = { found: false };

export class Car {
  constructor(scene, world, colorHex) {
    this.world = world;
    this.model = buildCar(colorHex);
    scene.add(this.model.group);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.lateralV = 0;
    this.steer = 0;
    this.vy = 0;
    this.pitch = 0;
    this.roll = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.wheelSpin = 0;
    this.onRoad = true;
    this.inWater = false;
    this.distance = 0;
    this.autodrive = false;
    this.cruise = 24; // m/s target for autodrive (~86 km/h)
    this.throttle = 0;
    this.brake = 0;
    this.surfaceRough = 0;
    this.airborne = false;
    this.sinking = 0;
  }

  get forward() {
    return _fwd.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }

  /** place the car on the road at arc length s (right-hand lane) */
  placeOnRoad(s) {
    const road = this.world.road;
    road.pointAt(s, _pt);
    const lane = ROAD_HALF / 2;
    this.pos.set(_pt.x - _pt.dirz * lane, _pt.h, _pt.z + _pt.dirx * lane);
    this.yaw = Math.atan2(_pt.dirx, -_pt.dirz);
    this.speed = 0;
    this.lateralV = 0;
    this.vy = 0;
    this.steer = 0;
    this.sinking = 0;
    this.inWater = false;
    this.pos.y = this.world.groundHeight(this.pos.x, this.pos.z);
  }

  resetToRoad() {
    const road = this.world.road;
    road.nearest(this.pos.x, this.pos.z, 3000, _near);
    const s = _near.found ? _near.s : (this.distance || 0);
    const keepSpeed = this.autodrive ? 0 : 0;
    this.placeOnRoad(s + 10);
    this.speed = keepSpeed;
  }

  _autopilot(dt) {
    const road = this.world.road;
    road.nearest(this.pos.x, this.pos.z, 250, _near);
    if (!_near.found) return { steer: 0, throttle: 0.3, brake: 0 };
    const v = Math.max(Math.abs(this.speed), 6);
    const look = clamp(v * 0.85, 9, 32);
    road.pointAt(_near.s + look, _pt);
    const lane = ROAD_HALF / 2;
    const tx = _pt.x - _pt.dirz * lane;
    const tz = _pt.z + _pt.dirx * lane;
    const desired = Math.atan2(tx - this.pos.x, -(tz - this.pos.z));
    let diff = desired - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // pure pursuit steering angle
    const steerAngle = Math.atan((2 * WHEELBASE * Math.sin(diff)) / look);
    const steer = clamp(steerAngle / this._maxSteer(), -1, 1);

    // slow for upcoming curves
    const curv = road.maxCurvature(_near.s, _near.s + Math.max(60, v * 4));
    const comfy = curv > 1e-4 ? Math.sqrt(3.0 / curv) : Infinity;
    const target = Math.min(this.cruise, comfy);
    const err = target - this.speed;
    return {
      steer,
      throttle: clamp(err * 0.35, 0, 1),
      brake: clamp(-err * 0.18, 0, 1),
    };
  }

  _maxSteer() {
    // less steering lock at speed, for stability
    const v = Math.abs(this.speed);
    return lerp(0.6, 0.075, clamp(v / 38, 0, 1) ** 0.7);
  }

  update(dt, input) {
    const world = this.world;
    let steerIn = input.steer;
    let throttle = input.throttle;
    let brake = input.brake;
    if (this.autodrive) {
      const ap = this._autopilot(dt);
      // let the driver nudge / override
      steerIn = Math.abs(input.steer) > 0.05 ? input.steer : ap.steer;
      throttle = input.throttle > 0.05 ? input.throttle : ap.throttle;
      brake = input.brake > 0.05 ? input.brake : ap.brake;
    }
    this.throttle = throttle;
    this.brake = brake;

    // steering: smooth, and self-centering
    const steerRate = Math.abs(steerIn) > 0.01 ? (this.autodrive ? 7 : 3.6) : 5;
    this.steer += (steerIn - this.steer) * damp(steerRate, dt);

    const f = this.forward;
    world.probe(this.pos.x, this.pos.z, _probe);
    this.onRoad = _probe.onRoad;
    const roadDist = _probe.roadDist;
    const offroad = roadDist > ROAD_HALF + 1.5;
    this.surfaceRough = offroad ? 1 : roadDist > ROAD_HALF + 0.2 ? 0.4 : 0;

    // slope along heading
    const ahead = world.groundHeight(this.pos.x + f.x * 1.5, this.pos.z + f.z * 1.5);
    const behind = world.groundHeight(this.pos.x - f.x * 1.5, this.pos.z - f.z * 1.5);
    const grade = (ahead - behind) / 3;

    // longitudinal forces
    const v = this.speed;
    let acc = 0;
    const power = 6.2 * (1 - clamp(v / MAX_SPEED, 0, 1) ** 1.6);
    if (throttle > 0) acc += throttle * power;
    if (input.reverse > 0 && v < 1) acc -= input.reverse * 3.5;
    if (brake > 0) acc -= Math.sign(v) * brake * 11;
    acc -= v * Math.abs(v) * 0.0009; // air
    acc -= Math.sign(v) * (offroad ? 1.6 : 0.18); // rolling resistance
    acc -= grade * G * 0.8;
    if (offroad) acc -= v * 0.12;
    let nv = v + acc * dt;
    // don't let braking/rolling resistance reverse the car
    if ((v > 0 && nv < 0 && input.reverse <= 0) || (v < 0 && nv > 0 && throttle <= 0)) nv = 0;
    if (Math.abs(nv) < 0.05 && throttle <= 0 && input.reverse <= 0) nv = 0;
    this.speed = clamp(nv, -8, MAX_SPEED);

    // yaw from bicycle model
    const steerAngle = this.steer * this._maxSteer();
    const yawRate = (this.speed * Math.tan(steerAngle)) / WHEELBASE;
    this.yaw += yawRate * dt;

    // slight slide outward in fast corners (just for feel), grip restores it
    const latAcc = this.speed * yawRate;
    const grip = offroad ? 2.2 : 5;
    this.lateralV += (-latAcc * 0.02 - this.lateralV * grip) * dt;

    const nf = this.forward;
    const rx = -nf.z;
    const rz = nf.x;
    this.pos.x += (nf.x * this.speed + rx * this.lateralV) * dt;
    this.pos.z += (nf.z * this.speed + rz * this.lateralV) * dt;
    this.distance += Math.abs(this.speed) * dt;

    // vertical: sample the four contact patches
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const wx = (lx, lz) => this.pos.x + lx * cy - lz * sy;
    const wz = (lx, lz) => this.pos.z + lx * sy + lz * cy;
    const hFL = world.groundHeight(wx(-HALF_TRACK, -WHEELBASE / 2), wz(-HALF_TRACK, -WHEELBASE / 2));
    const hFR = world.groundHeight(wx(HALF_TRACK, -WHEELBASE / 2), wz(HALF_TRACK, -WHEELBASE / 2));
    const hRL = world.groundHeight(wx(-HALF_TRACK, WHEELBASE / 2), wz(-HALF_TRACK, WHEELBASE / 2));
    const hRR = world.groundHeight(wx(HALF_TRACK, WHEELBASE / 2), wz(HALF_TRACK, WHEELBASE / 2));
    let ground = (hFL + hFR + hRL + hRR) / 4;
    const tPitch = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, WHEELBASE);
    const tRoll = Math.atan2((hFR + hRR) / 2 - (hFL + hRL) / 2, HALF_TRACK * 2);

    // water: float/sink gently, then fade back to the road
    const wet = world.biome.water && !world.biome.frozen && ground < -0.6;
    this.inWater = wet;
    if (wet) {
      this.speed *= Math.exp(-2.5 * dt);
      this.sinking += dt;
      ground = Math.max(ground, -0.9);
    } else {
      this.sinking = Math.max(0, this.sinking - dt * 2);
    }
    if (world.biome.frozen) ground = Math.max(ground, 0.0);

    // simple suspension with the ability to crest hills lightly
    this.vy -= G * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      const impact = ground - this.pos.y;
      this.pos.y = ground;
      // follow terrain upward
      this.vy = Math.max(this.vy, impact / Math.max(dt, 1e-3) * 0.5);
      if (this.vy < 0) this.vy = 0;
      this.airborne = false;
    } else {
      this.airborne = this.pos.y - ground > 0.25;
      if (!this.airborne) {
        // stick to the ground on gentle crests
        this.pos.y += (ground - this.pos.y) * damp(18, dt);
        this.vy *= 0.9;
      }
    }

    this.pitch += (tPitch - this.pitch) * damp(this.airborne ? 2 : 12, dt);
    this.roll += (tRoll - this.roll) * damp(this.airborne ? 2 : 12, dt);

    // body motion: squat, dive, lean, rough-road jiggle
    const tBodyPitch = clamp(-acc * 0.004, -0.035, 0.035);
    const tBodyRoll = clamp(latAcc * 0.0045, -0.05, 0.05);
    this.bodyPitch += (tBodyPitch - this.bodyPitch) * damp(5, dt);
    this.bodyRoll += (tBodyRoll - this.bodyRoll) * damp(4, dt);

    this._syncModel(dt);
  }

  _syncModel(dt) {
    const m = this.model;
    const g = m.group;
    g.position.copy(this.pos);
    g.rotation.set(0, 0, 0);
    g.rotation.order = 'YXZ';
    g.rotation.y = -this.yaw;
    g.rotation.x = this.pitch;
    g.rotation.z = -this.roll;
    const jig = this.surfaceRough * Math.min(1, Math.abs(this.speed) / 8);
    const t = performance.now() * 0.001;
    m.body.position.y = Math.sin(t * 23) * 0.012 * jig + Math.sin(t * 37) * 0.008 * jig;
    m.body.rotation.x = this.bodyPitch + Math.sin(t * 17) * 0.004 * jig;
    m.body.rotation.z = this.bodyRoll;
    this.wheelSpin += (this.speed * dt) / 0.34;
    for (const w of m.wheels) {
      w.spin.rotation.x = -this.wheelSpin;
      w.pivot.rotation.y = w.front ? -this.steer * this._maxSteer() : 0;
    }
  }

  setLights(night) {
    const m = this.model;
    const on = night > 0.3;
    for (const b of m.beams) b.intensity = on ? 38 * night : 0;
    m.headMat.emissiveIntensity = on ? 2.5 : 0.2;
    m.tailMat.emissiveIntensity = on ? 1.6 : 0.25;
  }

  setShadows(on) {
    this.model.group.traverse((o) => {
      if (o.isMesh && o.material && !o.material.transparent) o.castShadow = on;
    });
  }
}

const _fwd = new THREE.Vector3();
