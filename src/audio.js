// All sound is synthesised live with the Web Audio API, so there are no audio assets to ship.

import { clamp } from './noise.js';

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    // pinkish noise
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  return buf;
}

// pentatonic-ish scale (A minor pentatonic + 9ths) for the ambient pad
const SCALE = [0, 3, 5, 7, 10, 12, 14, 15, 17, 19, 22, 24];
const CHORDS = [
  [0, 7, 12, 15],
  [-4, 3, 8, 12],
  [-7, 0, 5, 12],
  [-2, 5, 10, 14],
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, engine: 0.6, music: 0.5, ambience: 0.6 };
  }

  get ready() {
    return !!this.ctx;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // --- reverb for music
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(4.5);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.75;
    this.reverb.connect(revGain).connect(this.master);

    // --- engine: two detuned saws + sub sine through a low-pass
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 1.2;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.osc = [];
    const types = [['sawtooth', 0.22, 1], ['sawtooth', 0.18, 1.007], ['sine', 0.55, 0.5], ['triangle', 0.12, 2]];
    for (const [type, g, mul] of types) {
      const o = ctx.createOscillator();
      o.type = type;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.engineFilter);
      o.start();
      o.mul = mul;
      this.osc.push(o);
    }

    // --- road / tyre / wind noise
    const nb = noiseBuffer(ctx, 3);
    const mkNoise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = nb;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start(0, Math.random() * 2);
      return { f, g };
    };
    this.road = mkNoise('lowpass', 500, 0.7);
    this.wind = mkNoise('bandpass', 700, 0.5);
    this.gravel = mkNoise('bandpass', 1800, 0.9);
    // nature bed (soft broadband + occasional birds)
    this.nature = mkNoise('highpass', 3500, 0.3);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.nextChordAt = ctx.currentTime + 0.5;
    this.nextNoteAt = ctx.currentTime + 2;
    this.nextBirdAt = ctx.currentTime + 4;
    this.chordIndex = 0;
    this.rootHz = 110;
  }

  _impulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  setVolume(kind, v) {
    this.volumes[kind] = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'master') this.master.gain.setTargetAtTime(v, t, 0.1);
    if (kind === 'music') this.musicBus.gain.setTargetAtTime(v, t, 0.3);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** state: { rpm 0..1, speed m/s, throttle 0..1, offRoad 0..1, night 0..1, paused } */
  update(s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const tc = 0.06;
    const ev = this.volumes.engine, av = this.volumes.ambience;
    const spd = Math.abs(s.speed);

    const f0 = 32 + s.rpm * 110 * (s.engineRange ?? 1);
    for (const o of this.osc) o.frequency.setTargetAtTime(f0 * o.mul, t, tc);
    this.engineFilter.frequency.setTargetAtTime(220 + s.rpm * 900 + s.throttle * 700, t, tc);
    this.engineGain.gain.setTargetAtTime(s.paused ? 0 : ev * (0.05 + 0.1 * s.throttle + 0.06 * s.rpm), t, 0.12);

    this.road.g.gain.setTargetAtTime(s.paused ? 0 : av * clamp(spd / 40, 0, 1) * 0.35 * (1 - s.offRoad * 0.6), t, 0.1);
    this.road.f.frequency.setTargetAtTime(200 + spd * 14, t, 0.1);
    this.wind.g.gain.setTargetAtTime(s.paused ? 0 : av * Math.pow(clamp(spd / 45, 0, 1), 2) * 0.3, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(400 + spd * 18 + Math.sin(t * 0.3) * 120, t, 0.3);
    this.gravel.g.gain.setTargetAtTime(s.paused ? 0 : av * s.offRoad * clamp(spd / 12, 0, 1) * 0.5, t, 0.05);
    this.nature.g.gain.setTargetAtTime(av * (0.02 + 0.03 * (1 - clamp(spd / 20, 0, 1))), t, 0.5);

    // ---------------------------------------------------------------- music
    if (this.volumes.music > 0.001) {
      if (t >= this.nextChordAt) this._playChord(t);
      if (t >= this.nextNoteAt) this._playNote(t);
    }
    if (t >= this.nextBirdAt) {
      if (s.night < 0.5 && !s.paused) this._bird(t);
      else if (s.night >= 0.5 && !s.paused && Math.random() < 0.5) this._cricket(t);
      this.nextBirdAt = t + 3 + Math.random() * 9;
    }
  }

  _voice(freq, start, dur, gain, type = 'sine', attack = 1.5) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 1.003;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + attack);
    g.gain.setTargetAtTime(0, start + dur - attack, attack / 2.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.musicBus);
    o.start(start);
    o2.start(start);
    o.stop(start + dur + 2);
    o2.stop(start + dur + 2);
  }

  _playChord(t) {
    const chord = CHORDS[this.chordIndex % CHORDS.length];
    this.chordIndex++;
    const dur = 11;
    for (const semi of chord) {
      this._voice(this.rootHz * Math.pow(2, semi / 12), t, dur + 3, 0.035, 'triangle', 3.5);
    }
    this.currentChord = chord;
    this.nextChordAt = t + dur;
  }

  _playNote(t) {
    const semi = SCALE[Math.floor(Math.random() * SCALE.length)] + 12;
    const f = this.rootHz * Math.pow(2, semi / 12);
    // soft bell-ish pluck
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.01;
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    o.start(t);
    o2.start(t);
    o.stop(t + 4);
    o2.stop(t + 4);
    this.nextNoteAt = t + 1.2 + Math.random() * 3.5;
  }

  _bird(t) {
    const ctx = this.ctx;
    const chirps = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1800;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = 0.02 * this.volumes.ambience;
    if (pan) {
      pan.pan.value = Math.random() * 1.6 - 0.8;
      out.connect(pan).connect(this.master);
    } else out.connect(this.master);
    for (let i = 0; i < chirps; i++) {
      const s = t + i * (0.12 + Math.random() * 0.08);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), s + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, s + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(1, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.12);
    }
  }

  _cricket(t) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.012 * this.volumes.ambience;
    out.connect(this.master);
    for (let i = 0; i < 6; i++) {
      const s = t + i * 0.16;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 4400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(1, s + 0.01);
      g.gain.linearRampToValueAtTime(0, s + 0.06);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.07);
    }
  }
}
