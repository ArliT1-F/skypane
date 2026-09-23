// Keyboard, gamepad and touch input, merged into one analog state.
import { clamp } from './noise.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.state = { steer: 0, throttle: 0, brake: 0, reverse: 0 };
    this.touch = { steer: 0, throttle: 0, brake: 0 };
    this.handlers = {};
    this._pressed = new Set();
    this.kbSteer = 0;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this._emit(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(code, fn) {
    (this.handlers[code] ||= []).push(fn);
  }

  _emit(code) {
    const list = this.handlers[code];
    if (list) list.forEach((fn) => fn());
  }

  _gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const steer = dz(p.axes[0] || 0);
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      const a = p.buttons[0] && p.buttons[0].pressed ? 1 : 0;
      const b = p.buttons[1] && p.buttons[1].pressed ? 1 : 0;
      // edge-triggered buttons
      const edges = [
        [3, 'KeyC'], // Y: camera
        [2, 'KeyR'], // X: reset
        [9, 'Escape'], // start: menu
        [5, 'KeyF'], // RB: autodrive
      ];
      for (const [bi, code] of edges) {
        const pressed = p.buttons[bi] && p.buttons[bi].pressed;
        const id = `pad${bi}`;
        if (pressed && !this._pressed.has(id)) this._emit(code);
        if (pressed) this._pressed.add(id);
        else this._pressed.delete(id);
      }
      return { steer, throttle: Math.max(rt, a), brake: Math.max(lt, b) };
    }
    return null;
  }

  update(dt, speed) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    const up = k.has('ArrowUp') || k.has('KeyW');
    const down = k.has('ArrowDown') || k.has('KeyS');
    const hand = k.has('Space');

    // keyboard steering ramps so digital keys feel analog
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 6 : Math.sign(target) !== Math.sign(this.kbSteer) ? 8 : 3.2;
    this.kbSteer += clamp(target - this.kbSteer, -rate * dt, rate * dt);

    let steer = this.kbSteer;
    let throttle = up ? 1 : 0;
    let brake = hand ? 1 : 0;
    let reverse = 0;
    if (down) {
      if (speed > 0.5) brake = 1;
      else reverse = 1;
    }

    const pad = this._gamepad();
    if (pad) {
      if (Math.abs(pad.steer) > Math.abs(steer)) steer = pad.steer;
      throttle = Math.max(throttle, pad.throttle);
      if (pad.brake > 0) {
        if (speed > 0.5) brake = Math.max(brake, pad.brake);
        else reverse = Math.max(reverse, pad.brake);
      }
    }
    const t = this.touch;
    if (Math.abs(t.steer) > Math.abs(steer)) steer = t.steer;
    throttle = Math.max(throttle, t.throttle);
    if (t.brake > 0) {
      if (speed > 0.5) brake = Math.max(brake, t.brake);
      else reverse = Math.max(reverse, t.brake);
    }

    this.state.steer = clamp(steer, -1, 1);
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.reverse = reverse;
    return this.state;
  }
}
