// @ts-check
// The kernel stdlib: everything a kernel gets as `dsp`. docs/DEVICES.md and kernel/guide.js document it.
//
//   import { makeDsp, overdubDsp } from './dsp.js';
//   const dsp = makeDsp(48000);          // the main thread (device checks, tests) and the Node renderer
//   overdubDsp(sampleRate)               // the worklet: kernel/processor.js imports this module into the
//                                        // AudioWorkletGlobalScope, so its top level uses nothing of the page's
//
// Conventions (kept by every building block below):
//   - Factories (dsp.svf(), dsp.osc('saw') ...) allocate; call them in create() or voice(), never in process().
//   - Methods on the hot path allocate nothing. Generators have next(); one-in/one-out processors have tick(x);
//     stereo processors have tick(l, r) and leave their (wet-only) output in .l and .r.
//   - Times are in seconds unless a name says ms; frequencies in Hz; gains are linear unless a name says dB.
//   - Nothing here reads Math.random: randomness comes from rng(seed) / noise(seed), so renders are repeatable.
//
// Ported and credited: the rational tanh, polyBLEP, mulberry32 rng, Simper/Cytomic SVF, RBJ biquads, Kaiser
// half-band resampler and the 8-line Householder reverb come from AJ's opus55-experiments/pop-punk/engine.js
// ("Tell Me How It Sounds").

import { fft as makeFft, convolver as makeConvolver } from './convolve.js';

/* eslint-disable no-inner-declarations */
export function overdubDsp(sr) {
  'use strict';
  sr = +sr || 48000;
  const TAU = Math.PI * 2, PI = Math.PI;

  /* ------------------------------------------------------------------ math */
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const ftom = (f) => 69 + 12 * Math.log2(f / 440);
  const dB = (d) => Math.pow(10, d / 20);
  const toDb = (g) => 20 * Math.log10(Math.max(Math.abs(g), 1e-10));
  const sstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  // Rational tanh: exact at 0, odd, reaches +-1 with zero slope at +-3 (cheap and smooth; not Math.tanh).
  function tanh(x) {
    if (x <= -3) return -1;
    if (x >= 3) return 1;
    const x2 = x * x;
    return (x * (27 + x2)) / (27 + 9 * x2);
  }
  // Cubic soft clip: slope 1 at 0, reaches +-1 with zero slope at +-1.5.
  function softclip(x) {
    if (x <= -1.5) return -1;
    if (x >= 1.5) return 1;
    return x - (4 / 27) * x * x * x;
  }
  const hardclip = (x, lim = 1) => (x < -lim ? -lim : x > lim ? lim : x);
  // Triangle wavefolder: identity in -1..1, then folds back (period 4). Drive it with gain > 1.
  function fold(x) {
    let t = (x + 1) * 0.25;
    t -= Math.floor(t);
    return 1 - Math.abs(4 * t - 2);
  }
  // Bit crusher: quantise -1..1 to `bits` (fractional bits are fine: 7.5).
  function crush(x, bits) {
    const q = Math.pow(2, Math.max(1, bits) - 1);
    return Math.round(x * q) / q;
  }

  /* ------------------------------------------------------------------ randomness (seeded only) */
  // mulberry32. r() is uniform in [0, 1); r.bi() in [-1, 1); r.gauss() is standard normal.
  function rng(seed) {
    let a = (seed >>> 0) ^ 0x9e3779b9;
    const r = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.bi = () => r() * 2 - 1;
    r.gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(TAU * r());
    return r;
  }
  // Noise generator: next() -> a sample. 'white' is uniform in +-1 (RMS 0.58); 'pink' (-3 dB/oct, Kellet) and
  // 'brown' (-6 dB/oct) have an RMS of about 0.3 (peaks near +-1.5).
  class Noise {
    constructor(seed, color) {
      this.r = rng(seed == null ? 1 : seed);
      this.c = color === 'pink' ? 1 : color === 'brown' ? 2 : 0;
      this.b0 = this.b1 = this.b2 = this.b3 = this.b4 = this.b5 = this.b6 = 0;
    }
    next() {
      const w = this.r() * 2 - 1;
      if (this.c === 0) return w;
      if (this.c === 1) {
        this.b0 = 0.99886 * this.b0 + w * 0.0555179;
        this.b1 = 0.99332 * this.b1 + w * 0.0750759;
        this.b2 = 0.969 * this.b2 + w * 0.153852;
        this.b3 = 0.8665 * this.b3 + w * 0.3104856;
        this.b4 = 0.55 * this.b4 + w * 0.5329522;
        this.b5 = -0.7616 * this.b5 - w * 0.016898;
        const y = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
        this.b6 = w * 0.115926;
        return y * 0.19;
      }
      this.b0 = (this.b0 + 0.02 * w) / 1.02;
      return this.b0 * 5.3;
    }
  }
  const noise = (seed, color = 'white') => new Noise(seed, color);

  /* ------------------------------------------------------------------ oscillators */
  // 2-sample polyBLEP residual for a step of +2 at phase 0 (t: phase 0..1, dt: phase increment).
  function blep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  // polyBLAMP residual for a unit change of slope (per sample) at phase 0.
  function blamp(t, dt) {
    let x;
    if (t < dt) x = 1 - t / dt;
    else if (t > 1 - dt) x = 1 + (t - 1) / dt;
    else return 0;
    return (x * x * x) / 6;
  }
  const SHAPES = { sine: 0, saw: 1, square: 2, pulse: 3, tri: 4 };
  // Band-limited oscillator. osc.freq(hz) (chainable), osc.next() -> -1..1, osc.phase (0..1), osc.pw (pulse
  // width 0.02..0.98, 'pulse' only), osc.wave(shape) to switch, osc.reset(phase).
  class Osc {
    constructor(shape) { this.s = 1; this.phase = 0; this.dt = 0; this.pw = 0.5; this.wave(shape || 'saw'); }
    wave(shape) {
      const s = SHAPES[shape];
      if (s === undefined) throw new Error(`dsp.osc: unknown shape "${shape}" (sine, saw, square, pulse, tri)`);
      this.s = s; return this;
    }
    freq(hz) { this.dt = clamp(hz / sr, 0, 0.49); return this; }
    reset(phase = 0) { this.phase = phase - Math.floor(phase); return this; }
    next() {
      const t = this.phase, dt = this.dt;
      let y;
      switch (this.s) {
        case 0: y = Math.sin(TAU * t); break;
        case 1: y = 2 * t - 1 - blep(t, dt); break;
        case 4: {
          y = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
          let t2 = t - 0.5; if (t2 < 0) t2 += 1;
          y += 8 * dt * (blamp(t, dt) - blamp(t2, dt));
          break;
        }
        default: {
          const pw = this.s === 2 ? 0.5 : clamp(this.pw, 0.02, 0.98);
          y = t < pw ? 1 : -1;
          let t2 = t - pw; if (t2 < 0) t2 += 1;
          y += blep(t, dt) - blep(t2, dt);
          y -= 2 * pw - 1; // centre it (no DC)
        }
      }
      let p = t + dt; if (p >= 1) p -= 1;
      this.phase = p;
      return y;
    }
  }
  const osc = (shape = 'saw') => new Osc(shape);

  // Low-frequency oscillator: next() -> -1..1, uni() -> 0..1 (both advance one sample). Shapes: sine, tri, saw
  // (rising), square, sh (sample and hold, seeded), drift (smoothed random). rate(hz) sets the speed;
  // sync(beats, t) once per block locks it to the song: one cycle every `beats` beats, phase-aligned to t.beat
  // while the transport plays (t is the transport the host passes to process/render).
  const LFO_SHAPES = { sine: 0, tri: 1, saw: 2, square: 3, sh: 4, drift: 5 };
  class LFO {
    constructor(shape, hz, seed) {
      this.s = LFO_SHAPES[shape || 'sine'];
      if (this.s === undefined) throw new Error(`dsp.lfo: unknown shape "${shape}" (sine, tri, saw, square, sh, drift)`);
      this.phase = 0; this.dt = 0; this.rate(hz == null ? 1 : hz);
      this.r = rng(seed == null ? 7 : seed); this.h = this.r() * 2 - 1; this.h0 = this.h; this.y = 0;
      this.offset = 0;
    }
    rate(hz) { this.dt = Math.max(0, hz) / sr; return this; }
    sync(beats, t) {
      if (!t || !(beats > 0)) return this;
      this.dt = (t.bpm || 120) / 60 / beats / sr;
      if (t.playing) { const ph = t.beat / beats + this.offset; this.phase = ph - Math.floor(ph); }
      return this;
    }
    next() {
      const t = this.phase;
      let y;
      switch (this.s) {
        case 0: y = Math.sin(TAU * t); break;
        case 1: y = t < 0.5 ? 4 * t - 1 : 3 - 4 * t; break;
        case 2: y = 2 * t - 1; break;
        case 3: y = t < 0.5 ? 1 : -1; break;
        case 4: y = this.h; break;
        default: y = this.h0 + (this.h - this.h0) * (t * t * (3 - 2 * t));
      }
      let p = t + this.dt;
      if (p >= 1) { p -= Math.floor(p); this.h0 = this.h; this.h = this.r() * 2 - 1; }
      this.phase = p;
      return y;
    }
    uni() { return 0.5 + 0.5 * this.next(); }
  }
  const lfo = (shape = 'sine', hz = 1, seed) => new LFO(shape, hz, seed);

  /* ------------------------------------------------------------------ filters */
  // Zero-delay-feedback state variable filter (Simper / Cytomic). Retune it every sample if you like.
  //   f.set(fc, q, gainDb = 0)   q 0.5 = soft, 0.707 = Butterworth, 10+ = ringing (stable at any q)
  //   one output per call (each call advances one sample):
  //   f.lp(x) f.bp(x) f.hp(x) f.notch(x) f.peak(x) (resonant peak: lp - hp) f.allpass(x)
  //   f.bell(x) (EQ bell: gainDb at fc) f.lowshelf(x) f.highshelf(x) (shelf by gainDb, corner fc)
  //   several outputs from one sample: f.tick(x) then read f.low f.band f.high (notch = low + high)
  class SVF {
    constructor() {
      this.s1 = 0; this.s2 = 0; this.fc = 1000; this.q = 0.7071; this.gain = 0; this.m = -1;
      this.k = 1; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.A = 1; this.low = 0; this.band = 0; this.high = 0;
      this.co(0);
    }
    set(fc, q = 0.7071, gainDb = 0) {
      this.fc = fc; this.q = q; this.gain = gainDb;
      this.co(this.m < 0 ? 0 : this.m);
      return this;
    }
    co(mode) {
      this.m = mode;
      let g = Math.tan((PI * clamp(this.fc, 5, sr * 0.49)) / sr);
      const q = clamp(this.q, 0.025, 1000);
      const A = Math.pow(10, this.gain / 40);
      this.A = A;
      let k = 1 / q;
      if (mode === 1) k = 1 / (q * A);
      else if (mode === 2) g /= Math.sqrt(A);
      else if (mode === 3) g *= Math.sqrt(A);
      this.k = k;
      this.a1 = 1 / (1 + g * (g + k));
      this.a2 = g * this.a1;
      this.a3 = g * this.a2;
    }
    tick(x) {
      const v3 = x - this.s2, v1 = this.a1 * this.s1 + this.a2 * v3, v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
      this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
      this.low = v2; this.band = v1; this.high = x - this.k * v1 - v2;
      return v2;
    }
    lp(x) { if (this.m) this.co(0); return this.tick(x); }
    bp(x) { if (this.m) this.co(0); this.tick(x); return this.k * this.band; }
    hp(x) { if (this.m) this.co(0); this.tick(x); return this.high; }
    notch(x) { if (this.m) this.co(0); this.tick(x); return this.low + this.high; }
    peak(x) { if (this.m) this.co(0); this.tick(x); return this.low - this.high; }
    allpass(x) { if (this.m) this.co(0); this.tick(x); return x - 2 * this.k * this.band; }
    bell(x) { if (this.m !== 1) this.co(1); this.tick(x); return x + this.k * (this.A * this.A - 1) * this.band; }
    lowshelf(x) {
      if (this.m !== 2) this.co(2);
      this.tick(x);
      const A = this.A;
      return x + this.k * (A - 1) * this.band + (A * A - 1) * this.low;
    }
    highshelf(x) {
      if (this.m !== 3) this.co(3);
      this.tick(x);
      const A = this.A;
      return A * A * x + this.k * (1 - A) * A * this.band + (1 - A * A) * this.low;
    }
    reset() { this.s1 = this.s2 = 0; return this; }
  }
  const svf = () => new SVF();

  // One-pole: set(fc), lp(x), hp(x). The cheapest smoother / tone control there is.
  class OnePole {
    constructor(fc) { this.y = 0; this.a = 1; if (fc) this.set(fc); }
    set(fc) { this.a = 1 - Math.exp((-TAU * clamp(fc, 0.01, sr * 0.49)) / sr); return this; }
    lp(x) { return (this.y += this.a * (x - this.y)); }
    hp(x) { this.y += this.a * (x - this.y); return x - this.y; }
    reset(v = 0) { this.y = v; return this; }
  }
  const onepole = (fc) => new OnePole(fc);

  // DC blocker (first-order high-pass at about 10 Hz): tick(x).
  class DCBlock {
    constructor() { this.x1 = 0; this.y1 = 0; this.R = 1 - (TAU * 10) / sr; }
    tick(x) { const y = x - this.x1 + this.R * this.y1; this.x1 = x; this.y1 = y; return y; }
  }
  const dcblock = () => new DCBlock();

  // RBJ cookbook biquad: set(type, fc, q = 0.707, gainDb = 0) then tick(x). Types: lp hp bp (0 dB peak) notch
  // allpass peak (EQ bell) lowshelf highshelf. Coefficients cost a few trig calls: set per block, not per sample.
  class Biquad {
    constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
    set(type, f, q = 0.7071, gainDb = 0) {
      const w = (TAU * clamp(f, 5, sr * 0.49)) / sr, c = Math.cos(w), s = Math.sin(w), A = Math.pow(10, gainDb / 40);
      const al = s / (2 * clamp(q, 0.025, 1000));
      let b0, b1, b2, a0, a1, a2;
      switch (type) {
        case 'lp': b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
        case 'hp': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
        case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
        case 'notch': b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
        case 'allpass': b0 = 1 - al; b1 = -2 * c; b2 = 1 + al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
        case 'peak': b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
        case 'lowshelf': case 'highshelf': {
          const sA = 2 * Math.sqrt(A) * al;
          if (type === 'highshelf') {
            b0 = A * (A + 1 + (A - 1) * c + sA); b1 = -2 * A * (A - 1 + (A + 1) * c); b2 = A * (A + 1 + (A - 1) * c - sA);
            a0 = A + 1 - (A - 1) * c + sA; a1 = 2 * (A - 1 - (A + 1) * c); a2 = A + 1 - (A - 1) * c - sA;
          } else {
            b0 = A * (A + 1 - (A - 1) * c + sA); b1 = 2 * A * (A - 1 - (A + 1) * c); b2 = A * (A + 1 - (A - 1) * c - sA);
            a0 = A + 1 + (A - 1) * c + sA; a1 = -2 * (A - 1 + (A + 1) * c); a2 = A + 1 + (A - 1) * c - sA;
          }
          break;
        }
        default: throw new Error(`dsp.biquad: unknown type "${type}" (lp hp bp notch allpass peak lowshelf highshelf)`);
      }
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
      return this;
    }
    tick(x) {
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      return y;
    }
    reset() { this.z1 = this.z2 = 0; return this; }
  }
  const biquad = () => new Biquad();

  /* ------------------------------------------------------------------ delays */
  // Delay line holding up to maxSamples. Read BEFORE you write in each sample: read(d) is the input from d
  // samples ago (fractional, linear interpolation, d >= 1); cubic(d) the same with 4-point Hermite (d >= 2, for
  // modulated delays); write(x) pushes the current input. ms(t) converts milliseconds to samples.
  class Delay {
    constructor(maxSamples) {
      this.max = Math.max(4, Math.ceil(maxSamples));
      let size = 8; while (size < this.max + 4) size <<= 1;
      this.buf = new Float32Array(size); this.mask = size - 1; this.w = 0;
    }
    read(d) {
      d = d < 1 ? 1 : d > this.max ? this.max : d;
      const r = this.w - d, i = Math.floor(r), f = r - i, m = this.mask, b = this.buf;
      const a = b[i & m];
      return a + (b[(i + 1) & m] - a) * f;
    }
    cubic(d) {
      d = d < 2 ? 2 : d > this.max ? this.max : d;
      const r = this.w - d, i = Math.floor(r), f = r - i, m = this.mask, b = this.buf;
      const y0 = b[(i - 1) & m], y1 = b[i & m], y2 = b[(i + 1) & m], y3 = b[(i + 2) & m];
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      return ((c3 * f + c2) * f + c1) * f + y1;
    }
    write(x) { this.buf[this.w & this.mask] = x; this.w = (this.w + 1) & 0x3fffffff; }
    ms(t) { return (t * sr) / 1000; }
    clear() { this.buf.fill(0); return this; }
  }
  const delay = (maxSamples) => new Delay(maxSamples);

  // Schroeder allpass (diffuser): tick(x). len in samples, g about 0.5..0.7.
  class Allpass {
    constructor(len, g) { this.buf = new Float32Array(Math.max(1, Math.round(len))); this.p = 0; this.g = g == null ? 0.5 : g; }
    tick(x) {
      const b = this.buf, p = this.p, d = b[p], w = x + this.g * d;
      b[p] = w;
      this.p = p + 1 === b.length ? 0 : p + 1;
      return d - this.g * w;
    }
  }
  const allpass = (len, g) => new Allpass(len, g);

  // Feedback comb with damping in the loop (Freeverb style): tick(x). fb 0..0.99, damp 0 (bright) .. 1 (dark).
  class Comb {
    constructor(len, fb, damp) { this.buf = new Float32Array(Math.max(1, Math.round(len))); this.p = 0; this.z = 0; this.set(fb == null ? 0.8 : fb, damp == null ? 0.2 : damp); }
    set(fb, damp) { this.fb = clamp(fb, -0.999, 0.999); this.damp = clamp(damp, 0, 0.99); return this; }
    tick(x) {
      const b = this.buf, p = this.p, y = b[p];
      this.z = y * (1 - this.damp) + this.z * this.damp;
      b[p] = x + this.z * this.fb;
      this.p = p + 1 === b.length ? 0 : p + 1;
      return y;
    }
  }
  const comb = (len, fb, damp) => new Comb(len, fb, damp);

  /* ------------------------------------------------------------------ envelopes and smoothing */
  // ADSR with exponential (analog-style) segments; a, d, r in seconds, s 0..1. gate(true) attacks from wherever
  // it is (retrigger without a click); gate(false) releases; hit() attacks then releases on its own (one-shots).
  // next() -> 0..1; active() is false once the release has finished; set(a, d, s, r) retunes (cheap if unchanged).
  class ADSR {
    constructor(a, d, s, r) { this.v = 0; this.st = 0; this.auto = false; this.ca = 0; this.cd = 0; this.cr = 0; this.set(a, d, s, r); }
    set(a = 0.005, d = 0.1, s = 0.7, r = 0.2) {
      if (a !== this.a) { this.a = a; this.ca = this.coef(a, 0.3); }
      if (d !== this.d) { this.d = d; this.cd = this.coef(d, 0.0001); }
      if (r !== this.r) { this.r = r; this.cr = this.coef(r, 0.0001); }
      this.s = clamp(s, 0, 1);
      return this;
    }
    coef(t, ratio) { const n = Math.max(1, t * sr); return Math.exp(-Math.log((1 + ratio) / ratio) / n); }
    gate(on) {
      if (on) { this.st = 1; this.auto = false; } else if (this.st) this.st = 4;
      return this;
    }
    hit() { this.st = 1; this.auto = true; return this; }
    next() {
      switch (this.st) {
        case 1: // attack toward 1.3, stop at 1
          this.v = 1.3 * (1 - this.ca) + this.v * this.ca;
          if (this.v >= 1) { this.v = 1; this.st = this.auto ? 4 : 2; }
          break;
        case 2: { // decay toward s
          const tgt = this.s - 0.0001 * (1 - this.s);
          this.v = tgt * (1 - this.cd) + this.v * this.cd;
          if (this.v <= this.s) { this.v = this.s; this.st = 3; }
          break;
        }
        case 3: this.v += (this.s - this.v) * 0.002; break; // sustain follows s without a step
        case 4:
          this.v = -0.0001 * (1 - this.cr) + this.v * this.cr;
          if (this.v <= 0) { this.v = 0; this.st = 0; }
          break;
        default: break;
      }
      return this.v;
    }
    active() { return this.st !== 0; }
    reset() { this.v = 0; this.st = 0; return this; }
  }
  const adsr = (a, d, s, r) => new ADSR(a, d, s, r);
  // Attack-release: an ADSR that holds at 1 while the gate is on. hit() for a one-shot.
  const ar = (a = 0.002, r = 0.3) => new ADSR(a, 0.001, 1, r);

  // Envelope follower (peak, attack/release in ms): tick(x) -> the level of x (0..).
  class Follower {
    constructor(atk, rel) { this.v = 0; this.set(atk, rel); }
    set(atk = 5, rel = 100) {
      this.ka = 1 - Math.exp(-1000 / (Math.max(0.01, atk) * sr));
      this.kr = 1 - Math.exp(-1000 / (Math.max(0.01, rel) * sr));
      return this;
    }
    tick(x) { const a = x < 0 ? -x : x; this.v += (a > this.v ? this.ka : this.kr) * (a - this.v); return this.v; }
  }
  const follower = (atk = 5, rel = 100) => new Follower(atk, rel);

  // One-pole smoother: tick(target) -> value gliding toward target with time constant ms. reset(v) jumps.
  class Smooth {
    constructor(ms, init) { this.value = init || 0; this.set(ms); }
    set(ms) { this.k = 1 - Math.exp(-1000 / (Math.max(0.01, ms) * sr)); return this; }
    tick(target) { return (this.value += this.k * (target - this.value)); }
    reset(v) { this.value = v; return this; }
  }
  const smooth = (ms = 10, init = 0) => new Smooth(ms, init);
  // Slew: like smooth but with separate rise and fall times (ms) - portamento, envelope shaping.
  class Slew {
    constructor(rise, fall, init) { this.value = init || 0; this.set(rise, fall); }
    set(rise, fall = rise) {
      this.ku = 1 - Math.exp(-1000 / (Math.max(0.01, rise) * sr));
      this.kd = 1 - Math.exp(-1000 / (Math.max(0.01, fall) * sr));
      return this;
    }
    tick(target) { const d = target - this.value; return (this.value += (d > 0 ? this.ku : this.kd) * d); }
    reset(v) { this.value = v; return this; }
  }
  const slew = (rise = 10, fall, init = 0) => new Slew(rise, fall == null ? rise : fall, init);

  /* ------------------------------------------------------------------ oversampling */
  // Kaiser-windowed half-band FIR (taps 4K - 1), as streaming per-sample 2x up / down.
  function halfband(K, beta) {
    const M = 2 * K - 1;
    const I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
    const h = new Float64Array(K); let sum = 0.5;
    for (let k = 1; k <= K; k++) {
      const m = 2 * k - 1, w = I0(beta * Math.sqrt(1 - (m / M) ** 2)) / I0(beta);
      h[k - 1] = (Math.sin((PI * m) / 2) / (PI * m)) * w; sum += 2 * h[k - 1];
    }
    for (let k = 0; k < K; k++) h[k] /= sum;
    return { c: h, c0: 0.5 / sum, K };
  }
  class HB2 {
    constructor(K, beta) {
      const d = halfband(K, beta);
      this.c = d.c; this.c0 = d.c0; this.K = K;
      this.uL = 2 * K; this.ux = new Float64Array(4 * K); this.up_ = 0;
      this.dL = 4 * K; this.dz = new Float64Array(8 * K); this.dp = 0;
      this.e = 0; this.o = 0;
    }
    up(x) { // -> this.e, this.o (two samples at the doubled rate)
      const L = this.uL, K = this.K, c = this.c, u = this.ux;
      let p = this.up_ + 1; if (p === L) p = 0; this.up_ = p;
      u[p] = x; u[p + L] = x;
      const base = p + L - K;
      let acc = 0;
      for (let k = 1; k <= K; k++) acc += c[k - 1] * (u[base + 1 - k] + u[base + k]);
      this.e = u[base] * (2 * this.c0); this.o = 2 * acc;
    }
    down(a, b) {
      const L = this.dL, K = this.K, c = this.c, z = this.dz;
      let p = this.dp + 1; if (p === L) p = 0; z[p] = a; z[p + L] = a;
      p += 1; if (p === L) p = 0; z[p] = b; z[p + L] = b;
      this.dp = p;
      const c0 = p + L - (2 * K - 1);
      let acc = this.c0 * z[c0];
      for (let k = 1; k <= K; k++) acc += c[k - 1] * (z[c0 - (2 * k - 1)] + z[c0 + (2 * k - 1)]);
      return acc;
    }
  }
  // os.process(x, fn) runs fn (a function of one sample, made once in create()) at 2x / 4x the rate and returns
  // one band-limited sample. os.latency is the delay it adds, in samples at the base rate.
  class Over2 {
    constructor() { this.a = new HB2(12, 8); this.latency = 23; }
    process(x, fn) { const a = this.a; a.up(x); return a.down(fn(a.e), fn(a.o)); }
  }
  class Over4 {
    constructor() { this.a = new HB2(12, 8); this.b = new HB2(5, 7); this.latency = 27.5; }
    process(x, fn) {
      const a = this.a, b = this.b;
      a.up(x);
      b.up(a.e); const y0 = b.down(fn(b.e), fn(b.o));
      b.up(a.o); const y1 = b.down(fn(b.e), fn(b.o));
      return a.down(y0, y1);
    }
  }
  const oversample2x = () => new Over2();
  const oversample4x = () => new Over4();

  /* ------------------------------------------------------------------ physical models */
  // Plucked string (extended Karplus-Strong): pluck(vel = 1, hz?) excites it (seeded noise shaped by a pick
  // position and brightness), next() -> a sample. freq(hz) retunes; set(decay, bright) changes the T60 (seconds) of
  // the fundamental and the brightness 0..1 from the next pluck on. mute(t60 = 0.08) damps it (a release); the next
  // pluck restores the decay. active() while audible.
  class String_ {
    constructor(hz, decay, bright, seed) {
      this.n = Math.ceil(sr / 20) + 8;
      this.d = new Float32Array(this.n);
      this.r = rng(seed == null ? 3 : seed);
      this.p = 0; this.lp = 0; this.apx = 0; this.apy = 0; this.lvl = 0; this.N = 2; this.apc = 0; this.hl = 1;
      this.decay = decay == null ? 3 : decay; this.t60 = this.decay; this.bright = bright == null ? 0.5 : bright;
      this.rel = Math.exp(-1 / (0.05 * sr));
      this.freq(hz || 220);
    }
    freq(hz) {
      this.f = clamp(hz, 20, sr * 0.25);
      const f = this.f, P = sr / f;
      const w = (TAU * f) / sr, gt = Math.pow(10, -3 / (Math.max(0.01, this.decay) * f));
      // the damping filter's loss at f, which must stay under the loop's budget for this decay (high notes get
      // less damping so their fundamental still rings for `decay`)
      let dm = clamp(0.04 + 0.55 * (1 - this.bright), 0, 0.9);
      const loss = (d) => (1 - d) / Math.sqrt(1 - 2 * d * Math.cos(w) + d * d);
      for (let i = 0; i < 24 && loss(dm) < gt; i++) dm *= 0.8;
      this.damp = dm;
      const pd = Math.atan2(dm * Math.sin(w), 1 - dm * Math.cos(w)) / w;
      this.N = Math.max(2, Math.min(this.n - 2, Math.floor(P - pd - 0.2)));
      const frac = P - pd - this.N;
      this.apc = (1 - frac) / (1 + frac);
      // loop gain: the fundamental rings for t60 (the damping filter's loss at f is made up), overtones die sooner
      this.hl = loss(dm);
      this.g = Math.min(0.99999, Math.pow(10, -3 / (Math.max(0.01, this.t60) * f)) / this.hl);
      return this;
    }
    pluck(vel = 1, hz) {
      this.t60 = this.decay;
      if (hz) this.freq(hz); else this.freq(this.f);
      const N = this.N, d = this.d, b = clamp(this.bright, 0, 1);
      const apex = Math.max(1, Math.min(N - 1, Math.round(0.14 * N)));
      const a = 1 - Math.exp((-TAU * (400 + 9000 * b * b * (0.4 + 0.6 * vel))) / sr);
      let z = 0, mean = 0;
      for (let k = 0; k < N; k++) {
        const tri = k < apex ? k / apex : (N - k) / (N - apex);
        z += a * (tri + (this.r() - 0.5) * 0.6 * (0.3 + b) - z);
        d[(this.p - N + k + this.n) % this.n] = z; mean += z;
      }
      mean /= N;
      for (let k = 0; k < N; k++) { const i = (this.p - N + k + this.n) % this.n; d[i] = (d[i] - mean) * vel; }
      this.lvl = vel;
      return this;
    }
    set(decay, bright) { if (decay != null) this.decay = decay; if (bright != null) this.bright = bright; return this; }
    mute(t60 = 0.08) { this.t60 = Math.min(this.t60, t60); this.g = Math.min(0.99999, Math.pow(10, -3 / (Math.max(0.005, this.t60) * this.f)) / this.hl); return this; }
    next() {
      const d = this.d, n = this.n;
      let rp = this.p - this.N; if (rp < 0) rp += n;
      const y = d[rp];
      this.lp += (1 - this.damp) * (y - this.lp);
      const ap = this.apc * this.lp + this.apx - this.apc * this.apy; this.apx = this.lp; this.apy = ap;
      d[this.p] = ap * this.g;
      if (++this.p === n) this.p = 0;
      const a = y < 0 ? -y : y;
      this.lvl = a > this.lvl ? a : this.lvl * this.rel;
      return y;
    }
    active() { return this.lvl > 1e-4; }
  }
  const karplus = (hz = 220, decay = 3, bright = 0.5, seed) => new String_(hz, decay, bright, seed);

  // Modal resonator bank (drums, bells, bars, bodies): freqs (Hz), decays (T60 s), gains, all arrays of the same
  // length. strike(vel) excites every mode at once; tick(x) excites them with an input signal and returns the
  // sum; next() = tick(0). tune(ratio) moves every mode (pitch), damp(k) multiplies the decays (k < 1 chokes).
  class Modal {
    constructor(freqs, decays, gains) {
      const n = freqs.length;
      this.f = Float64Array.from(freqs); this.t = Float64Array.from(freqs, (_, i) => decays[i] ?? decays[decays.length - 1] ?? 1);
      this.gn = Float64Array.from(freqs, (_, i) => gains ? gains[i] ?? 0 : 1 / n);
      this.b = new Float64Array(n); this.a1 = new Float64Array(n); this.a2 = new Float64Array(n);
      this.y1 = new Float64Array(n); this.y2 = new Float64Array(n);
      this.n = n; this.ratio = 1; this.dk = 1; this.lvl = 0; this.pend = 0;
      this.rel = Math.exp(-1 / (0.05 * sr));
      this.co();
    }
    co() {
      for (let i = 0; i < this.n; i++) {
        const f = this.f[i] * this.ratio;
        if (f >= sr * 0.48 || f <= 0) { this.b[i] = 0; this.a1[i] = 0; this.a2[i] = 0; continue; }
        const w = (TAU * f) / sr, r = Math.pow(10, -3 / (Math.max(0.001, this.t[i] * this.dk) * sr));
        this.b[i] = this.gn[i] * Math.sin(w); this.a1[i] = 2 * r * Math.cos(w); this.a2[i] = -r * r;
      }
    }
    tune(ratio) { if (ratio !== this.ratio) { this.ratio = ratio; this.co(); } return this; }
    damp(k) { if (k !== this.dk) { this.dk = k; this.co(); } return this; }
    strike(vel = 1) { this.pend += vel; this.lvl = Math.max(this.lvl, vel); return this; }
    tick(x) {
      const n = this.n, b = this.b, a1 = this.a1, a2 = this.a2, y1 = this.y1, y2 = this.y2;
      const e = x + this.pend; this.pend = 0;
      let s = 0;
      for (let i = 0; i < n; i++) {
        const y = b[i] * e + a1[i] * y1[i] + a2[i] * y2[i];
        y2[i] = y1[i]; y1[i] = y; s += y;
      }
      const a = s < 0 ? -s : s;
      this.lvl = a > this.lvl ? a : this.lvl * this.rel;
      return s;
    }
    next() { return this.tick(0); }
    active() { return this.lvl > 1e-4; }
  }
  const modal = (freqs, decays, gains) => new Modal(freqs, decays, gains);

  // 8-line feedback delay network reverb (Householder matrix, damping in the loops, input diffusion, slow
  // modulation). tick(l, r) leaves the WET signal in .l and .r. set(size, decay, damp): size 0..1 (room to hall),
  // decay = T60 in seconds, damp 0 (bright) .. 1 (dark). Mix it with the dry yourself.
  class FDN {
    constructor(size, decay, damp, seed) {
      const sc = sr / 44100;
      this.base = Float64Array.from([1433, 1601, 1867, 2053, 2251, 2399, 2617, 2797], (l) => l * sc);
      this.lines = Array.from(this.base, (l) => new Delay(l * 1.55 + 64 * sc));
      this.ap = [allpass(229 * sc, 0.7), allpass(163 * sc, 0.7), allpass(557 * sc, 0.6), allpass(419 * sc, 0.6)];
      this.apR = [allpass(241 * sc, 0.7), allpass(173 * sc, 0.7), allpass(541 * sc, 0.6), allpass(433 * sc, 0.6)];
      this.z = new Float64Array(8); this.v = new Float64Array(8); this.g = new Float64Array(8);
      this.len = new Float64Array(8);
      const r = rng(seed == null ? 11 : seed);
      this.mc = new Float64Array(8); this.ms = new Float64Array(8); this.mr = new Float64Array(8); this.mcnt = 0;
      for (let k = 0; k < 8; k++) {
        const ph = r() * TAU, hz = 0.3 + 0.9 * r();
        this.mc[k] = Math.cos(ph); this.ms[k] = Math.sin(ph); this.mr[k] = (TAU * hz) / sr;
      }
      this.depth = 5 * sc;
      this.hpL = new OnePole(70); this.hpR = new OnePole(70);
      this.sz = new Smooth(80, 0); this.l = 0; this.r = 0;
      this.size = -1; this.set(size == null ? 0.6 : size, decay == null ? 2 : decay, damp == null ? 0.4 : damp);
      this.sz.reset(this.scale);
    }
    set(size, decay, damp) {
      this.size = clamp(size, 0, 1); this.decay = Math.max(0.05, decay); this.dampv = clamp(damp, 0, 1);
      this.scale = 0.35 + 1.15 * this.size;
      for (let k = 0; k < 8; k++) this.g[k] = Math.pow(10, (-3 * this.base[k] * this.scale) / (this.decay * sr));
      this.da = 1 - Math.exp((-TAU * (900 * Math.pow(20, 1 - this.dampv))) / sr);
      return this;
    }
    tick(xl, xr) {
      const sc = this.sz.tick(this.scale);
      let a = this.hpL.hp(xl), b = this.hpR.hp(xr);
      for (let k = 0; k < 4; k++) { a = this.ap[k].tick(a); b = this.apR[k].tick(b); }
      const lines = this.lines, z = this.z, v = this.v, g = this.g, da = this.da, base = this.base;
      const mc = this.mc, ms = this.ms, mr = this.mr, dep = this.depth;
      let sum = 0, yl = 0, yr = 0;
      for (let k = 0; k < 8; k++) {
        // rotate the modulation phasor
        const c = mc[k], s = ms[k], w = mr[k];
        mc[k] = c - w * s; ms[k] = s + w * c;
        const y = lines[k].read(base[k] * sc + dep * (1 + ms[k]));
        if (k & 1) yr += (k & 2 ? -y : y); else yl += (k & 4 ? -y : y);
        z[k] += da * (y - z[k]);
        const vk = z[k] * g[k];
        v[k] = vk; sum += vk;
      }
      if (++this.mcnt >= 4096) { // renormalise the phasors
        this.mcnt = 0;
        for (let k = 0; k < 8; k++) { const m = 1 / Math.hypot(mc[k], ms[k]); mc[k] *= m; ms[k] *= m; }
      }
      sum *= 0.25;
      const ia = a * 0.35, ib = b * 0.35;
      for (let k = 0; k < 8; k++) lines[k].write(v[k] - sum + (k < 4 ? (k & 1 ? -ia : ia) : (k & 1 ? -ib : ib)));
      this.l = yl; this.r = yr;
      return this.l;
    }
  }
  const fdn = (size, decay, damp, seed) => new FDN(size, decay, damp, seed);

  // Stereo chorus: tick(l, r) leaves the WET signal in .l and .r (two voices in quadrature). set(depth, rate):
  // depth 0..1 (up to +-5 ms of sweep around 12 ms), rate in Hz.
  class Chorus {
    constructor(depth, rate) {
      this.dl = new Delay((sr * 30) / 1000); this.dr = new Delay((sr * 30) / 1000);
      this.ph = 0; this.l = 0; this.r = 0; this.set(depth == null ? 0.5 : depth, rate == null ? 0.8 : rate);
    }
    set(depth, rate) { this.depth = clamp(depth, 0, 1); this.dt = Math.max(0, rate) / sr; return this; }
    tick(xl, xr) {
      const c = (sr * 12) / 1000, a = (sr * 5 * this.depth) / 1000;
      const s1 = Math.sin(TAU * this.ph), s2 = Math.cos(TAU * this.ph);
      this.ph += this.dt; if (this.ph >= 1) this.ph -= 1;
      this.l = this.dl.cubic(c + a * s1); this.r = this.dr.cubic(c + a * s2);
      this.dl.write(xl); this.dr.write(xr);
      return this.l;
    }
  }
  const chorus = (depth, rate) => new Chorus(depth, rate);

  const buffer = (n) => new Float32Array(Math.max(0, n | 0));

  /* ------------------------------------------------------------------ convolution (kernel/convolve.js) */
  // fft(n): a real FFT, n a power of two 16..8192 -> .forward(x, Xr, Xi) / .inverse(Xr, Xi, x) (n/2 + 1 bins).
  // convolver(taps, { head = 128, body = 1024, direct }) -> .process(x, outL, outR, n) .set(taps) .reset() .latency:
  // a two-level partitioned convolver (one or two channels of taps), bit-exact on every engine; latency 128 frames,
  // or 0 with direct: 128 (the first 128 taps in the time domain).
  const fft = (n) => makeFft(n);
  const convolver = (taps, opts) => makeConvolver(taps, opts);

  return Object.freeze({
    sr, TAU, PI,
    clamp, lerp, mtof, ftom, dB, toDb, sstep, tanh, softclip, hardclip, fold, crush,
    rng, noise, blep, blamp, osc, lfo,
    svf, onepole, dcblock, biquad,
    delay, allpass, comb,
    adsr, ar, follower, smooth, slew,
    oversample2x, oversample4x,
    karplus, modal, fdn, chorus,
    buffer,
    fft, convolver,
  });
}

// The names in `dsp`, for docs and checks.
export const DSP_API = [
  'sr', 'TAU', 'PI', 'clamp', 'lerp', 'mtof', 'ftom', 'dB', 'toDb', 'sstep', 'tanh', 'softclip', 'hardclip', 'fold', 'crush',
  'rng', 'noise', 'blep', 'blamp', 'osc', 'lfo', 'svf', 'onepole', 'dcblock', 'biquad', 'delay', 'allpass', 'comb',
  'adsr', 'ar', 'follower', 'smooth', 'slew', 'oversample2x', 'oversample4x', 'karplus', 'modal', 'fdn', 'chorus', 'buffer',
  'fft', 'convolver',
];

const cache = new Map();
// The dsp object for a sample rate (one per rate; it is frozen and stateless, so sharing is safe).
export function makeDsp(sr = 48000) {
  let d = cache.get(sr);
  if (!d) { d = overdubDsp(sr); cache.set(sr, d); }
  return d;
}
