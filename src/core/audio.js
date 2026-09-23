// Fully procedural audio: engine, wind, tyre/gravel rumble, rain, and a slow
// generative ambient pad. No sample files needed.
import { clamp } from './noise.js';

function noiseBuffer(ctx, seconds = 2, brown = false) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

// pentatonic-ish scales for the ambient pad (MIDI notes)
const CHORDS = [
  [50, 57, 62, 66, 69],
  [47, 54, 59, 62, 66],
  [43, 50, 55, 59, 62],
  [45, 52, 57, 61, 64],
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = { engine: true, ambience: true, music: true };
    this.volume = 0.8;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // ---- engine: two detuned saws + sub, through a lowpass ----
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0;
    const lp = (this.engineLP = ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 2;
    this.engineOsc = [];
    const types = [
      ['sawtooth', 1, 0.28],
      ['sawtooth', 1.004, 0.22],
      ['triangle', 0.5, 0.5],
      ['square', 2, 0.04],
    ];
    for (const [type, mul, g] of types) {
      const o = ctx.createOscillator();
      o.type = type;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(lp);
      o.start();
      this.engineOsc.push({ o, mul });
    }
    lp.connect(this.engineBus).connect(this.master);

    // ---- wind: pink-ish noise through a bandpass ----
    const white = noiseBuffer(ctx, 3);
    const brown = noiseBuffer(ctx, 3, true);
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = white;
    windSrc.loop = true;
    this.windBP = ctx.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.frequency.value = 500;
    this.windBP.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windBP).connect(this.windGain).connect(this.master);
    windSrc.start();

    // ---- tyre / gravel rumble ----
    const roadSrc = ctx.createBufferSource();
    roadSrc.buffer = brown;
    roadSrc.loop = true;
    this.roadLP = ctx.createBiquadFilter();
    this.roadLP.type = 'lowpass';
    this.roadLP.frequency.value = 300;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    roadSrc.connect(this.roadLP).connect(this.roadGain).connect(this.master);
    roadSrc.start();

    // ---- rain ----
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = white;
    rainSrc.loop = true;
    rainSrc.playbackRate.value = 0.7;
    const rainHP = ctx.createBiquadFilter();
    rainHP.type = 'highpass';
    rainHP.frequency.value = 1200;
    const rainLP = ctx.createBiquadFilter();
    rainLP.type = 'lowpass';
    rainLP.frequency.value = 7000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainHP).connect(rainLP).connect(this.rainGain).connect(this.master);
    rainSrc.start();

    // ---- ambient pad ----
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.62;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    const padLP = ctx.createBiquadFilter();
    padLP.type = 'lowpass';
    padLP.frequency.value = 1600;
    this.padIn = ctx.createGain();
    this.padIn.connect(padLP);
    padLP.connect(this.musicBus);
    padLP.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.musicBus);
    this.musicBus.connect(this.master);
    this.chord = 0;
    this.nextChord = ctx.currentTime + 0.5;
    this.nextBell = ctx.currentTime + 3;
  }

  _padChord() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = CHORDS[this.chord % CHORDS.length];
    this.chord += Math.random() < 0.7 ? 1 : 2;
    const dur = 14;
    for (let i = 0; i < 3; i++) {
      const n = notes[(i * 2 + Math.floor(Math.random() * 2)) % notes.length];
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = mtof(n - (i === 0 ? 12 : 0));
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05 / (i + 1), t + 4);
        g.gain.linearRampToValueAtTime(0.04 / (i + 1), t + dur - 4);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g).connect(this.padIn);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
    this.nextChord = t + dur - 5;
  }

  _bell() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = CHORDS[(this.chord + 3) % CHORDS.length];
    const n = notes[Math.floor(Math.random() * notes.length)] + 12;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    o.connect(g).connect(this.padIn);
    o.start(t);
    o.stop(t + 4.2);
    this.nextBell = t + 2.5 + Math.random() * 6;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  update(dt, car, weather, paused) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const T = 0.08;
    const on = !paused;
    const v = Math.abs(car.speed);

    // engine rpm: fake 5-speed gearbox
    const kmh = v * 3.6;
    const gears = [0, 30, 58, 88, 120, 999];
    let g = 1;
    while (g < gears.length - 1 && kmh > gears[g]) g++;
    const lo = gears[g - 1];
    const hi = Math.min(gears[g], 170);
    const r = clamp((kmh - lo) / (hi - lo), 0, 1);
    const rpm = 850 + r * 3600 + car.throttle * 250;
    const f0 = rpm / 60; // firing ~ rpm/60 * cylinders/2 (4 cyl => rpm/30), keep it low and soft
    for (const { o, mul } of this.engineOsc) o.frequency.setTargetAtTime(f0 * 1.0 * mul, t, T);
    this.engineLP.frequency.setTargetAtTime(220 + car.throttle * 700 + r * 500, t, 0.15);
    const eng = this.enabled.engine && on ? 0.16 + car.throttle * 0.12 : 0;
    this.engineBus.gain.setTargetAtTime(eng, t, 0.2);

    const amb = this.enabled.ambience && on;
    this.windBP.frequency.setTargetAtTime(300 + v * 22, t, 0.3);
    this.windGain.gain.setTargetAtTime(amb ? clamp(0.02 + v * v * 0.00018, 0, 0.42) : 0, t, 0.3);
    this.roadLP.frequency.setTargetAtTime(160 + v * 10 + car.surfaceRough * 500, t, 0.2);
    this.roadGain.gain.setTargetAtTime(amb ? clamp(v / 30, 0, 1) * (0.1 + car.surfaceRough * 0.35) : 0, t, 0.15);
    this.rainGain.gain.setTargetAtTime(amb && weather === 'rain' ? 0.22 : 0, t, 1.2);

    const music = this.enabled.music && on;
    this.musicBus.gain.setTargetAtTime(music ? 0.9 : 0, t, 1.5);
    if (this.enabled.music) {
      if (t > this.nextChord) this._padChord();
      if (t > this.nextBell) this._bell();
    }
  }

  suspend() {
    if (this.ctx) this.ctx.suspend();
  }
  resume() {
    if (this.ctx) this.ctx.resume();
  }
}
