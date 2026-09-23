// Camera rigs: chase, hood, and a slow cinematic mode that drifts between angles.
import * as THREE from 'three';
import { damp, clamp } from './noise.js';

export const CAMERA_MODES = ['chase', 'far', 'hood', 'cinematic'];
export const CAMERA_LABELS = { chase: 'Chase', far: 'Wide', hood: 'Hood', cinematic: 'Cinematic' };

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yawLag = 0;
    this.orbit = 0; // user mouse orbit offset
    this.orbitPitch = 0;
    this.cine = { t: 0, shot: 0, anchor: new THREE.Vector3(), side: 1 };
    this.snap = true;
  }

  setMode(m) {
    this.mode = m;
    this.snap = true;
    this.cine.t = 999;
  }

  next() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  update(dt, car) {
    const cam = this.camera;
    const f = car.forward;
    // lag the heading so turns feel smooth
    let dy = car.yaw - this.yawLag;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yawLag += dy * (this.snap ? 1 : damp(2.6, dt));
    // let orbit drift home when not dragging
    if (!this.dragging) {
      this.orbit *= 1 - damp(0.9, dt);
      this.orbitPitch *= 1 - damp(0.9, dt);
    }
    const yaw = this.yawLag + this.orbit;
    const bx = Math.sin(yaw);
    const bz = -Math.cos(yaw);
    const speedK = clamp(car.kmh / 140, 0, 1);

    if (this.mode === 'chase' || this.mode === 'far') {
      const far = this.mode === 'far';
      const dist = (far ? 14 : 8.2) + speedK * 1.2;
      const height = (far ? 5.2 : 3.0) + this.orbitPitch * 6;
      _desired.set(car.pos.x - bx * dist, car.pos.y + height, car.pos.z - bz * dist);
      const gh = this.world.groundHeight(_desired.x, _desired.z) + 1.0;
      if (_desired.y < gh) _desired.y = gh;
      _target.set(car.pos.x + bx * 8, car.pos.y + (far ? 1.6 : 1.7), car.pos.z + bz * 8);
      const k = this.snap ? 1 : damp(7, dt);
      this.pos.lerp(_desired, k);
      this.look.lerp(_target, this.snap ? 1 : damp(10, dt));
      cam.fov += ((far ? 55 : 60) + speedK * 8 - cam.fov) * damp(2, dt);
    } else if (this.mode === 'hood') {
      _desired.set(0, 1.62, -0.35).applyEuler(car.model.group.rotation).add(car.pos);
      this.pos.copy(_desired);
      _target.set(Math.sin(car.yaw + this.orbit), 0, -Math.cos(car.yaw + this.orbit));
      _target.multiplyScalar(20).add(this.pos);
      _target.y = this.pos.y + Math.sin(car.pitch) * 20 - 0.6 + this.orbitPitch * 12;
      this.look.copy(_target);
      cam.fov += (68 + speedK * 6 - cam.fov) * damp(3, dt);
    } else {
      this._cinematic(dt, car, f);
    }

    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    cam.updateProjectionMatrix();
    this.snap = false;
  }

  _cinematic(dt, car, f) {
    const c = this.cine;
    const cam = this.camera;
    c.t += dt;
    const shotLen = 11;
    if (c.t > shotLen) {
      c.t = 0;
      c.shot = (c.shot + 1) % 4;
      c.side = Math.random() < 0.5 ? -1 : 1;
      // trackside anchor ahead of the car
      const ahead = 40 + Math.abs(car.speed) * 4;
      const rx = -f.z;
      const rz = f.x;
      const lat = c.side * (12 + Math.random() * 18);
      c.anchor.set(car.pos.x + f.x * ahead + rx * lat, 0, car.pos.z + f.z * ahead + rz * lat);
      c.anchor.y = this.world.groundHeight(c.anchor.x, c.anchor.z) + 2 + Math.random() * 6;
      this.snap = true;
    }
    const rx = -f.z;
    const rz = f.x;
    if (c.shot === 0 || c.shot === 2) {
      // static trackside camera watching the car pass
      this.pos.copy(c.anchor);
      _look.set(car.pos.x, car.pos.y + 0.8, car.pos.z);
      this.look.lerp(_look, this.snap ? 1 : damp(6, dt));
      const d = this.pos.distanceTo(car.pos);
      cam.fov = clamp(2400 / Math.max(d, 10), 22, 60);
      if (d > 220) c.t = shotLen + 1;
    } else if (c.shot === 1) {
      // slow orbit around the car
      const a = c.t * 0.18 * c.side + 0.9;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ox = (f.x * ca + rx * sa) * 9;
      const oz = (f.z * ca + rz * sa) * 9;
      _desired.set(car.pos.x + ox, 0, car.pos.z + oz);
      _desired.y = Math.max(car.pos.y + 1.8, this.world.groundHeight(_desired.x, _desired.z) + 1);
      this.pos.lerp(_desired, this.snap ? 1 : damp(8, dt));
      this.look.set(car.pos.x, car.pos.y + 0.9, car.pos.z);
      cam.fov = 50;
    } else {
      // high drone shot trailing behind
      _desired.set(car.pos.x - f.x * 28 + rx * 14 * c.side, car.pos.y + 22, car.pos.z - f.z * 28 + rz * 14 * c.side);
      const gh = this.world.groundHeight(_desired.x, _desired.z) + 6;
      if (_desired.y < gh) _desired.y = gh;
      this.pos.lerp(_desired, this.snap ? 1 : damp(2, dt));
      _look.set(car.pos.x + f.x * 20, car.pos.y, car.pos.z + f.z * 20);
      this.look.lerp(_look, this.snap ? 1 : damp(4, dt));
      cam.fov = 50;
    }
  }
}
