import { clamp } from './noise.js';

const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { forward: false, back: false, left: false, right: false };
    this.handlers = {};
    this.lastPad = [];

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this._emit(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // touch buttons
    document.querySelectorAll('[data-touch]').forEach((el) => {
      const k = el.dataset.touch;
      const on = (e) => { e.preventDefault(); this.touch[k] = true; el.classList.add('down'); };
      const off = (e) => { e.preventDefault(); this.touch[k] = false; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    });
  }

  on(code, fn) {
    this.handlers[code] = fn;
  }

  _emit(code) {
    const fn = this.handlers[code];
    if (fn) fn();
  }

  _down(action) {
    return KEYMAP[action].some((k) => this.keys.has(k)) || this.touch[action];
  }

  read() {
    let throttle = this._down('forward') ? 1 : 0;
    let brake = this._down('back') ? 1 : 0;
    let steer = (this._down('left') ? 1 : 0) - (this._down('right') ? 1 : 0);
    let usingPad = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (Math.abs(ax) > 0.12) { steer = -clamp((Math.abs(ax) - 0.12) / 0.88, 0, 1) * Math.sign(ax); usingPad = true; }
      if (rt > 0.05) { throttle = Math.max(throttle, rt); usingPad = true; }
      if (lt > 0.05) { brake = Math.max(brake, lt); usingPad = true; }
      // edge-triggered buttons: A confirm, Y camera, X autodrive, Start pause, B reset
      const map = { 0: 'Enter', 3: 'KeyC', 2: 'KeyE', 9: 'Escape', 1: 'KeyR' };
      for (const b in map) {
        const pressed = p.buttons[b] && p.buttons[b].pressed;
        const key = p.index + ':' + b;
        if (pressed && !this.lastPad[key]) this._emit(map[b]);
        this.lastPad[key] = pressed;
      }
    }
    const any = throttle > 0 || brake > 0 || steer !== 0;
    return { throttle, brake, steer, any, usingPad };
  }
}
