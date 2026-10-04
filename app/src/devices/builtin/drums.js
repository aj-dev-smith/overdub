// core.drums: Gobo Kit. A whole drum kit synthesized per hit (no samples), General MIDI mapped:
//   35/36 kick  37 rim  38/40 snare  39 clap  42 closed hat  44 pedal hat  46 open hat (choked by 42/44)
//   41/43 floor toms  45 low tom  47 mid tom  48 high-mid tom  50 high tom  49/57 crash  51/59 ride  53 ride bell
//   54 tambourine  56 cowbell  69/70/82 shaker. Anything else plays the rim.
// Three characters: FIELD (an acoustic kit: membrane modes with tension pitch-drop, snare wires that follow the head,
// cymbals as banks of inharmonic partials plus blooming noise bands), MACHINE (a classic analog drum machine: a long
// pitched sine kick, tone-plus-noise snare, six-square metallic hats), and DUST (the field kit through an old sampler:
// darker, crunchier, narrower). The acoustic physics are ported from opus55-experiments/pop-punk/engine.js
// ("Tell Me How It Sounds"); the machine voices follow the classic analog circuits' recipes.
// Velocity sets level and brightness. Global TUNE, DECAY, TONE (a tilt around 1 kHz) and DRIVE (2x oversampled).
// Appended later (options 3-5; the first three never change, so no old song moves):
//   808        the classic machine's own circuits (after Werner, Abel & Smith's models): a bridged-T kick pinged by
//              a pulse (a slight rise, then fall, in pitch; DECAY is the resonance, TONE the low-pass on it, no click),
//              a two-resonator snare with high-passed noise (TONE is SNAPPY), three-burst clap, six band-limited
//              squares through two band-passes for hats and cymbal, sine toms, a two-resonator rim, maracas.
//   909        a swept triangle kick waveshaped toward a sine with a separate click (TONE sets the click), two
//              triangles 1.6x apart plus noise with its own envelope for the snare (TONE is SNAPPY), a four-burst
//              clap with a tail, swept toms, a three-resonator rim. Its hats and cymbals were samples, so here they
//              are synthesis in that manner: six band-limited squares and noise (hats), the FIELD cymbals.
//   ACOUSTIC+  the FIELD kit where velocity moves the colour as well as the level: the beater and stick click
//              grow with force (kick and toms), a hard hit bends the head further, and the hats are modal (struck
//              brass partials and noise, not six squares).
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.drums', name: 'Gobo Kit', kind: 'instrument', cat: 'drums', by: 'overdub',
  blurb: 'A full synthesized drum kit, acoustic or machine',
  nod: 'an acoustic studio kit and a classic analog drum machine (GM drum map)',
  params: [
    { key: 'kit', label: 'KIT', opts: ['FIELD', 'MACHINE', 'DUST', '808', '909', 'ACOUSTIC+'], def: 0, role: 'shape', desc: 'acoustic kit, analog drum machine, a dusty old sampler, the two classic machines, or an acoustic kit that changes colour with velocity' },
    { key: 'tune', label: 'TUNE', min: -12, max: 12, def: 0, unit: 'st', role: 'pitch', desc: 'every drum up or down' },
    { key: 'decay', label: 'DECAY', min: 0.3, max: 2.5, def: 1, unit: 'x', role: 'decay', desc: 'tight and dead to long and ringing' },
    { key: 'tone', label: 'TONE', min: -1, max: 1, def: 0, role: 'tone', desc: 'darker (warm, vintage) or brighter (snappy, modern)' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.15, role: 'drive', desc: 'glue, then crunch' },
    { key: 'width', label: 'WIDTH', min: 0, max: 1, def: 0.6, role: 'width', desc: 'how far the hats, toms and cymbals spread' },
    { key: 'room', label: 'ROOM', min: 0, max: 1, def: 0.3, role: 'mix', desc: 'the room around the kit: dry booth to big live room' },
  ],
  presets: [
    { name: 'Studio kit', params: {} },
    { name: 'Four on the floor', params: { kit: 4, tone: 0.2, room: 0.15 } },
    { name: 'Trap', params: { kit: 3, decay: 1.8, room: 0.1 } },
    { name: 'Boom bap', params: { kit: 2, drive: 0.35, room: 0.2 } },
    { name: 'Live room', params: { kit: 5, room: 0.6 } },
  ],
  look: { color: '#33302b', ink: '#f1dc8a', shape: 'wide', finish: 'sparkle', knob: 'chrome', label: 'block', led: '#ffb347' },
  tail: 4,
  kernel: kernel(String.raw`
// piece types
const KICK = 0, SNARE = 1, CLAP = 2, RIM = 3, HAT = 4, TOM = 5, CYM = 6, COW = 7, SHAKE = 8, TAMB = 9;
// membrane modes of an ideal circular drum head (Bessel zeros), relative to the fundamental
const MEMBRANE = [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501];
const SNARE_A = [1, 0.5, 0.42, 0.3, 0.26, 0.2, 0.16, 0.12], SNARE_T = [0.13, 0.08, 0.06, 0.055, 0.045, 0.04, 0.035, 0.03];
const TOM_A = [1, 0.45, 0.3, 0.22, 0.15, 0.1], TOM_T = [0.42, 0.2, 0.14, 0.11, 0.09, 0.07];
const HAT808 = [205.3, 304.4, 369.6, 522.7, 540, 800];
const TOMS = { 41: 70, 43: 82, 45: 98, 47: 118, 48: 140, 50: 165 };
const PAN = { 41: 0.42, 43: 0.36, 45: 0.24, 47: 0.08, 48: -0.08, 50: -0.22, 42: -0.32, 44: -0.32, 46: -0.32, 49: -0.4, 57: 0.45, 51: 0.38, 59: 0.38, 53: 0.38, 54: -0.25, 56: 0.18, 69: 0.3, 70: 0.3, 82: 0.3 };
// relative levels, balanced by measurement (tools/sounds-test.js renders each piece): kick and snare lead, toms a step
// back, cymbals and percussion sit around them
const LEVEL = { [KICK]: 1.33, [SNARE]: 0.62, [CLAP]: 0.98, [RIM]: 0.35, [HAT]: 0.67, [TOM]: 0.39, [CYM]: 0.36, [COW]: 0.24, [SHAKE]: 0.175, [TAMB]: 0.18 };
// the appended kits' own voices (808: K8.., 909: K9.., ACOUSTIC+: the modal hat HM), mapped from the GM pieces above
const K8 = 10, S8 = 11, CP8 = 12, H8 = 13, T8 = 14, RM8 = 15, CY8 = 16, MA8 = 17, K9 = 18, S9 = 19, CP9 = 20, H9 = 21, T9 = 22, RM9 = 23, HM = 24;
const KITMAP = [null, null, null,
  { [KICK]: K8, [SNARE]: S8, [CLAP]: CP8, [HAT]: H8, [TOM]: T8, [RIM]: RM8, [CYM]: CY8, [SHAKE]: MA8 },
  { [KICK]: K9, [SNARE]: S9, [CLAP]: CP9, [HAT]: H9, [TOM]: T9, [RIM]: RM9 },
  { [HAT]: HM }];
Object.assign(LEVEL, { [K8]: 1.38, [S8]: 0.95, [CP8]: 0.9, [H8]: 0.6, [T8]: 0.67, [RM8]: 0.56, [CY8]: 0.55, [MA8]: 0.27, [K9]: 1.32, [S9]: 1.2, [CP9]: 0.83, [H9]: 0.6, [T9]: 0.67, [RM9]: 0.56, [HM]: 0.6 });
const HAT909 = [317.2, 436.4, 551.6, 697.1, 873.3, 1104.5];
// lib's svf() and onepole(), op for op, as classes: one shared tick() a call site can inline, where lib's closures are a
// fresh function per voice (so every voice's filters would be a different callee to the same line)
class SV {
  constructor(sr) { this.sr = sr; this.ic1 = 0; this.ic2 = 0; this.k = 1; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.m0 = 0; this.m1 = 0; this.m2 = 1; this.lp = 0; this.bp = 0; this.hp = 0; }
  set(fc, q) { return this.setG(Math.tan(Math.PI * clamp(fc, 5, this.sr * 0.49) / this.sr), q); }
  setG(g, q) { const k = 1 / Math.max(0.05, q), a1 = 1 / (1 + g * (g + k)), a2 = g * a1; this.k = k; this.a1 = a1; this.a2 = a2; this.a3 = g * a2; return this; }
  tick(v0) {
    const ic1 = this.ic1, ic2 = this.ic2, a2 = this.a2;
    const v3 = v0 - ic2, v1 = this.a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - ic1; this.ic2 = 2 * v2 - ic2;
    this.lp = v2; this.bp = v1; this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
  shelfLo(fc, q, dbGain) { const A = Math.pow(10, dbGain / 40); this.setG(Math.tan(Math.PI * clamp(fc, 5, this.sr * 0.49) / this.sr) / Math.sqrt(A), q); this.m0 = 1; this.m1 = this.k * (A - 1); this.m2 = A * A - 1; return this; }
  shelfHi(fc, q, dbGain) { const A = Math.pow(10, dbGain / 40); this.setG(Math.tan(Math.PI * clamp(fc, 5, this.sr * 0.49) / this.sr) * Math.sqrt(A), q); this.m0 = A * A; this.m1 = this.k * (1 - A) * A; this.m2 = 1 - A * A; return this; }
  bell(fc, q, dbGain) { const A = Math.pow(10, dbGain / 40); this.setG(Math.tan(Math.PI * clamp(fc, 5, this.sr * 0.49) / this.sr), q * A); this.m0 = 1; this.m1 = this.k * (A * A - 1); this.m2 = 0; return this; }
  eq(x) { this.tick(x); return this.m0 * x + this.m1 * this.bp + this.m2 * this.lp; }
  reset() { this.ic1 = this.ic2 = 0; }
}
class OP {
  constructor(sr) { this.sr = sr; this.a = 0; this.y = 0; }
  set(fc) { this.a = Math.exp(-TAU * clamp(fc, 1, this.sr * 0.49) / this.sr); return this; }
  lp(x) { return (this.y = x + (this.y - x) * this.a); }
  reset() { this.y = 0; }
}
// band-limited square (polyBLEP), phase 0..1 (one function for every voice, so it inlines)
const bsq = (t, dt) => (t < 0.5 ? 1 : -1) + blep(t, dt) - blep(t < 0.5 ? t + 0.5 : t - 0.5, dt);
// lib's rng(seed) step for step, its state in a typed array (a closure's uint32 is a boxed number, allocated each draw)
function rnd(S) { const v = (Math.imul(S[0], 1664525) + 1013904223) >>> 0; S[0] = v; return (v / 4294967296) * 2 - 1; }
// lib's fdn(sr, seed), op for op (the same draws, the same float32 lines, the same sums in the same order), with its
// eight delay lines in one ring and their reads inline: lib's lines are eight sets of closures, a call apiece
function fdn8(sr, seed) {
  const N = 8, BASE = [1031, 1327, 1523, 1801, 2111, 2437, 2741, 3089], k = sr / 48000;
  const rr = rng(seed ^ 0xf00d);
  let size = 1; while (size < Math.ceil(BASE[N - 1] * 1.8 * k) + 64 + 4) size <<= 1;
  const mask = size - 1, buf = new Float32Array(size * N);
  const len = new Float64Array(N), g = new Float64Array(N), lp = new Float64Array(N), x = new Float64Array(N);
  const mph = new Float64Array(N), mdt = new Float64Array(N);
  for (let i = 0; i < N; i++) { mph[i] = (rr() + 1) / 2; mdt[i] = (0.07 + 0.11 * i / N + 0.03 * rr()) / sr; }
  let a = 0, depth = 6 * k, lastS = -1, lastT = -1, lastD = -1, w = 0;
  const o = {
    l: 0, r: 0,
    set(sz, t60, damp) {
      if (sz === lastS && t60 === lastT && damp === lastD) return o;
      lastS = sz; lastT = t60; lastD = damp;
      const sc = (0.3 + 1.45 * clamp(sz, 0, 1)) * k;
      for (let i = 0; i < N; i++) { len[i] = BASE[i] * sc; g[i] = Math.pow(10, -3 * len[i] / (Math.max(0.05, t60) * sr)); }
      a = Math.exp(-TAU * (16000 * Math.pow(0.05, clamp(damp, 0, 1))) / sr);
      depth = (3 + 9 * clamp(sz, 0, 1)) * k;
      return o;
    },
    tick(inL, inR) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        let p = mph[i] + mdt[i]; if (p >= 1) p -= 1; mph[i] = p;
        const r = w - (len[i] + depth * (1 + sinT(p))), j = Math.floor(r), f = r - j, base = i * size;
        const y0 = buf[base + ((j - 1) & mask)], y1 = buf[base + (j & mask)], y2 = buf[base + ((j + 1) & mask)], y3 = buf[base + ((j + 2) & mask)];
        const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        const v = ((c3 * f + c2) * f + c1) * f + y1;
        lp[i] = v + (lp[i] - v) * a;            // damping in the loop
        x[i] = lp[i] * g[i]; sum += x[i];
      }
      sum *= 2 / N;
      for (let i = 0; i < N; i++) buf[i * size + w] = x[i] - sum + ((i & 1) ? inR : inL);
      w = (w + 1) & mask;
      o.l = x[0] - x[2] + x[4] - x[6] + 0.5 * (x[1] - x[5]);
      o.r = x[1] - x[3] + x[5] - x[7] + 0.5 * (x[2] - x[6]);
      return o.l;
    },
  };
  return o;
}
// lib's os2(sat), sum for sum in the same order (so bit for bit the same), a block at a time: the input and the 2x
// stream each run on from their history, so no read wraps a ring. run(X, n) replaces X[0..n) with the output.
const HBE = new Float64Array(16), HBO = new Float64Array(15);
for (let k = 0; k < 16; k++) { HBE[k] = HB[2 * k]; if (k < 15) HBO[k] = HB[2 * k + 1]; }
function os2sat() {
  let x = new Float64Array(15 + 128), u = new Float64Array(30 + 256);
  return function run(X, n) {
    if (x.length < 15 + n) { const nx = new Float64Array(15 + n), nu = new Float64Array(30 + 2 * n); nx.set(x.subarray(0, 15)); nu.set(u.subarray(0, 30)); x = nx; u = nu; }
    for (let i = 0; i < n; i++) x[15 + i] = X[i];
    // up: the even 2x sample from the even taps, the odd one from the odd taps (zero-stuffed input, gain 2)
    for (let i = 0; i < n; i++) {
      const xs = 15 + i;
      let a = 0, b = 0;
      for (let k = 0; k < 16; k++) a += HBE[k] * x[xs - k];
      for (let k = 0; k < 15; k++) b += HBO[k] * x[xs - k];
      u[30 + 2 * i] = sat(2 * a); u[31 + 2 * i] = sat(2 * b);
    }
    // down: the 2x stream filtered at each even sample
    for (let i = 0; i < n; i++) {
      const us = 30 + 2 * i;
      let s = 0;
      for (let j = 0; j < 31; j++) s += HB[j] * u[us - j];
      X[i] = s;
    }
    x.copyWithin(0, n, n + 15); u.copyWithin(0, 2 * n, 2 * n + 30);
  };
}
return {
  poly: 24,
  create({ sr, seed }) {
    const r = rng(seed ^ 0xd2);
    const tl = new SV(sr), tr = new SV(sr), hl = new SV(sr), hr = new SV(sr), osL = os2sat(), osR = os2sat();
    let XL = new Float64Array(128), XR = new Float64Array(128);   // the bus, a block at a time
    const room = fdn8(sr, seed ^ 0x2007), rhl = new SV(sr), rhr = new SV(sr), roomS = glide(40, sr);
    // the cymbals' partials: fixed per kit instance (a crash keeps its voice), [freq, T60, amp]
    function metalBank(nModes, fLo, fHi, skew, tau, slope, peak, width, partials) {
      const out = [];
      for (let m = 0; m < nModes; m++) {
        const f = fLo + (fHi - fLo) * Math.pow((r() + 1) / 2, skew);
        const t = tau * Math.pow(f / 3000, -slope) * (0.5 + (r() + 1) / 2);
        const lf = Math.log2(f / peak), a = (partials * (0.3 + (r() + 1) / 2) / Math.sqrt(nModes)) / (1 + (lf * lf) / (width * width));
        out.push([f, t, a, (r() + 1) * Math.PI]);
      }
      return out;
    }
    const BANKS = {
      49: { modes: metalBank(28, 350, 7000, 1, 1.0, 0.4, 3000, 1.6, 0.35), bands: [[1800, 4500, 0.5, 1.1, 0], [4500, 9000, 0.9, 0.85, 0.008], [9000, 15000, 0.7, 0.5, 0.012]], dur: 3.4, gain: 0.89 },
      57: { modes: metalBank(28, 300, 6500, 1, 1.2, 0.4, 2600, 1.7, 0.35), bands: [[1500, 4000, 0.55, 1.3, 0], [4000, 8500, 0.85, 0.95, 0.01], [8500, 14000, 0.6, 0.55, 0.014]], dur: 3.8, gain: 0.89 },
      51: { modes: metalBank(22, 500, 9000, 1.2, 1.0, 0.3, 3800, 1.2, 1.0), bands: [[3000, 7000, 0.12, 0.08, 0], [5000, 12000, 0.14, 0.6, 0.004]], dur: 2.6, gain: 0.58 },
      53: { modes: metalBank(14, 600, 3200, 0.8, 1.6, 0.2, 1400, 1.0, 1.4), bands: [[2500, 6000, 0.08, 0.05, 0]], dur: 2.8, gain: 0.375 },
    };
    BANKS[59] = BANKS[51];
    // ACOUSTIC+'s hats: a pair of struck brass plates as fixed partials (their own seeded generator, so the other kits'
    // draws are untouched): [freq, amp, phase]
    const ra = rng(seed ^ 0xacc5), HATM = [];
    for (let m = 0; m < 10; m++) HATM.push([3100 + 8600 * Math.pow((ra() + 1) / 2, 1.25), 0.55 + 0.45 * (ra() + 1) / 2, (ra() + 1) * Math.PI]);
    const voices = [];
    return {
      voice() {
        // state, preallocated
        const MX = 32, ph = new Float64Array(MX), amp = new Float64Array(MX), dk = new Float64Array(MX), fr = new Float64Array(MX);
        const y1 = new Float64Array(MX), y2 = new Float64Array(MX), c1 = new Float64Array(MX), c2 = new Float64Array(MX);
        const nb = [new SV(sr), new SV(sr), new SV(sr), new SV(sr), new SV(sr), new SV(sr)], hb = [new SV(sr), new SV(sr), new SV(sr)], lb = [new SV(sr), new SV(sr), new SV(sr)];
        const bandG = new Float64Array(3), bandE = new Float64Array(3), bandK = new Float64Array(3), bandB = new Float64Array(3);
        const vlp = new OP(sr);
        let type = KICK, kit = 0, t = 0, len = 1, vel = 1, g = 1, pan = [1, 1], nModes = 0, nBands = 0, f0 = 50, dec = 1, tn = 1;
        let choke = 0, ck = 1, open = false, pedal = false, dark = false, p1 = 0, p2 = 0, sq = new Float64Array(6), am = 0, gone = false;
        const NS = new Uint32Array(1);   // the hit's noise (rnd)
        let pitchN = 36;
        let tone = 0, xa = 0.1, xb = 0.1, xk = 1, x2 = 0, acc = 1;
        // the appended kits' voices: set-up (kits 3-5; the first three never reach here)
        function setupX(p) {
          const tt = (tone + 1) / 2;
          switch (type) {
            case K8: f0 = 52 * tn * (1 + 0.004 * r()); xa = 0.16 * Math.pow(dec, 1.6); len = (xa * 9 + 0.05) * sr; nb[0].set(900 + 3600 * tt, 0.6); break;
            case K9: f0 = 50 * tn; xa = 0.13 * Math.pow(dec, 1.4); len = (xa * 8 + 0.06) * sr; nb[0].set(3500, 0.7); nb[1].set(9000, 0.7); xk = 0.35 + 0.65 * tt; break;
            case S8: f0 = 185 * tn; xa = 0.1 * dec; xb = 0.13 * dec; xk = clamp(0.3 + 0.55 * tt, 0, 1); nb[0].set(1800, 0.7); nb[1].set(9000, 0.7); len = Math.max(0.25, 8 * xb) * sr; break;
            case S9: f0 = 172 * tn; xa = 0.075 * dec; xb = 0.16 * dec; xk = clamp(0.3 + 0.55 * tt, 0, 1); nb[0].set(700, 0.7); nb[1].set(8500, 0.7); len = Math.max(0.25, 8 * xb) * sr; break;
            case CP8: nb[0].set(1000, 1.3); nb[1].set(500, 0.7); xa = 0.13 * dec; len = (0.03 + 8 * xa) * sr; break;
            case CP9: nb[0].set(1300, 1.6); nb[1].set(600, 0.7); nb[2].set(1100, 0.8); xa = 0.2 * dec; len = (0.03 + 7 * xa) * sr; break;
            case H8: case H9: {
              const F = type === H8 ? HAT808 : HAT909;
              for (let k = 0; k < 6; k++) { fr[k] = Math.min(F[k] * tn, sr * 0.2) / sr; sq[k] = (r() + 1) / 2; }
              if (open) g *= type === H8 ? 0.6 : 0.85;
              if (type === H8) { nb[0].set(7100, 2.2); nb[1].set(6000, 0.7); xa = open ? 0.24 * dec : pedal ? 0.016 : 0.036 * Math.sqrt(dec); xb = xa; x2 = 0; }
              else { nb[0].set(7500, 0.7); nb[1].set(10500, 0.9); xa = open ? 0.02 : pedal ? 0.02 : 0.01; xb = open ? 0.32 * dec : pedal ? 0.03 : 0.05 * Math.sqrt(dec); x2 = open ? 0.6 : 0.45; }
              len = Math.min(4, 8 * Math.max(xa, xb) + 0.02) * sr;
              break;
            }
            case T8: f0 = (TOMS[p] || 98) * 1.18 * tn; xa = 0.2 * dec; nb[0].set(f0 * 2.3, 2); len = 8 * xa * sr; break;
            case T9: f0 = (TOMS[p] || 98) * 1.25 * tn; xa = 0.22 * dec; nb[0].set(3000, 0.7); len = 8 * xa * sr; break;
            case RM8: f0 = 455 * tn; nb[0].set(500, 0.7); len = 0.12 * sr; break;
            case RM9: f0 = 480 * tn; nb[0].set(2000, 0.7); nb[1].set(500, 0.7); len = 0.12 * sr; break;
            case CY8: {
              for (let k = 0; k < 6; k++) { fr[k] = Math.min(HAT808[k] * tn, sr * 0.2) / sr; sq[k] = (r() + 1) / 2; }
              nb[0].set(3440, 1.5); nb[1].set(7100, 1.5); nb[2].set(5000, 0.7);
              const ride = p === 51 || p === 59, bell = p === 53;
              if (ride) g *= 1.25;
              xa = (bell ? 0.35 : ride ? 0.1 : 0.2) * dec; xb = (bell ? 0.25 : ride ? 0.55 : 0.9) * dec; x2 = bell ? 2 : 1;
              len = Math.min(6, 7 * Math.max(xa, xb)) * sr;
              break;
            }
            case MA8: nb[0].set(5500, 0.7); len = 0.15 * sr; break;
            case HM: {
              nModes = HATM.length;
              const sc = tn * (1 + 0.01 * r());
              for (let k = 0; k < nModes; k++) {
                const [f, a, phi] = HATM[k], fk = Math.min(f * sc, sr * 0.45), w = TAU * fk / sr;
                const tau = (open ? 0.42 * dec : pedal ? 0.012 : 0.03 * Math.sqrt(dec)) * Math.pow(fk / 5000, -0.4), rr = coef(tau, sr);
                c1[k] = 2 * rr * Math.cos(w); c2[k] = rr * rr;
                const aa = a * 0.12 * (0.85 + 0.15 * (r() + 1));
                y2[k] = aa * Math.sin(phi); y1[k] = aa * rr * Math.sin(w + phi);
              }
              nb[0].set(6500, 0.7); nb[1].set(12000, 0.7); nb[2].set(4200, 1);
              xa = open ? 0.3 * dec : pedal ? 0.014 : 0.04 * Math.sqrt(dec); xk = 0.15 + 0.85 * vel * vel;
              g *= open ? 0.5 : pedal ? 0.85 : 0.6;
              len = Math.min(4, 8 * xa * 1.3 + 0.03) * sr;
              break;
            }
          }
        }
        // ---------------------------------------------------------------- the pieces: raw samples into Y, from sample t of the hit
        let Y = new Float64Array(128), Xb = new Float64Array(128), Bb = new Float64Array(128);
        // a struck head's modes over the block, mode by mode: Xb[i] gets 0 + mode 0 + mode 1 + ..., the very sums (in the
        // very order) a per-sample loop over the modes makes, with each mode's phase and level held in registers.
        // Bb[i] is the pitch bend at sample i.
        function modes(nm, end) {
          for (let k = 0; k < nm; k++) {
            const fm = f0 * MEMBRANE[k], d = dk[k];
            let q = ph[k], a = amp[k];
            for (let i = 0; i < end; i++) { q += fm * Bb[i] / sr; if (q >= 1) q -= 1; a *= d; Xb[i] += sinT(q) * a; }
            ph[k] = q; amp[k] = a;
          }
        }
        // a bank of two-pole resonators (the cymbals' and ACOUSTIC+'s hats' partials) the same way, into Xb
        function bank(end) {
          for (let i = 0; i < end; i++) Xb[i] = 0;
          let k = 0;
          for (; k + 1 < nModes; k += 2) {   // two at a time: (Xb[i] + mode k) + mode k+1, the same sums in the same order
            const a1 = c1[k], a2 = c2[k], b1 = c1[k + 1], b2 = c2[k + 1];
            let u1 = y1[k], u2 = y2[k], w1 = y1[k + 1], w2 = y2[k + 1];
            for (let i = 0; i < end; i++) {
              const v = a1 * u1 - a2 * u2; u2 = u1; u1 = v;
              const z = b1 * w1 - b2 * w2; w2 = w1; w1 = z;
              Xb[i] = Xb[i] + v + z;
            }
            y1[k] = u1; y2[k] = u2; y1[k + 1] = w1; y2[k + 1] = w2;
          }
          if (k < nModes) {
            const a1 = c1[k], a2 = c2[k];
            let u1 = y1[k], u2 = y2[k];
            for (let i = 0; i < end; i++) { const v = a1 * u1 - a2 * u2; u2 = u1; u1 = v; Xb[i] += v; }
            y1[k] = u1; y2[k] = u2;
          }
        }
        const gKICK = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            if (kit === 1) {
              const f = f0 * (1 + 1.6 * Math.exp(-s / 0.03)); p1 += f / sr; if (p1 >= 1) p1 -= 1;
              const body = sinT(p1) * Math.exp(-s / (0.45 * dec)) * Math.min(1, s / 0.0006);
              const cl = nb[0].tick(rnd(NS)) * Math.exp(-s / 0.0015) * 0.5;
              y = sat(body * 1.25 + cl) * 0.63;
            } else {
              const f = f0 * (1 + 1.1 * Math.exp(-s / 0.011)); p1 += f / sr; if (p1 >= 1) p1 -= 1; p2 += f * 1.58 / sr; if (p2 >= 1) p2 -= 1;
              const body = sinT(p1) * (Math.exp(-s / (0.13 * dec)) * 0.85 + 0.15 * Math.exp(-s / 0.05)) * Math.min(1, s / 0.0008);
              const shell = sinT(p2) * Math.exp(-s / 0.035) * 0.3;
              const nz = rnd(NS);
              const cl = (nb[0].tick(nz) * Math.exp(-s / 0.0028) * 2.4 + nb[1].tick(nz) * Math.exp(-s / 0.007) * 1.1) * (0.6 + 0.4 * vel);
              y = nb[2].tick(sat((body + shell) * 1.35 + (kit === 5 ? cl * acc : cl) * 0.8));
              if (kit === 5) { nb[3].tick(nz); y += nb[3].bp * Math.exp(-s / 0.02) * x2; }   // the beater's slap
            }
            Y[i] = y;
          }
        };
        const gSNARE = (Y, end, t) => {
          if (kit !== 1) {
            // the head's modes, each run through the block (sums per sample in the same order as a mode-by-mode loop)
            for (let i = 0; i < end; i++) { const s = (t + i) / sr; Bb[i] = 1 + 0.09 * Math.exp(-s / 0.012); Xb[i] = 0; }
            modes(8, end);
            for (let i = 0; i < end; i++, t++) {
              const s = t / sr;
              let body = Xb[i];
              body *= Math.min(1, s / 0.0007);
              const nz = rnd(NS), soft = vel < 0.5 ? 1 : 0;
              const env = Math.exp(-s / (0.2 * (soft ? 0.6 : 1) * dec)) * (0.35 + 0.65 * Math.exp(-s / 0.05));
              nb[0].tick(nz); const w1 = nb[0].hp; const w2 = nb[1].eq(w1); const wires = nb[2].tick(w2) * env * Math.min(1, s / 0.0015);
              const click = nb[3].tick(nz) * Math.exp(-s / 0.0025) * 1.8;
              Y[i] = sat((body * 0.9 + wires * (soft ? 1.0 : 1.5) + click * 0.8) * 1.5);
            }
            return;
          }
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            const f = f0 * (1 + 0.5 * Math.exp(-s / 0.008)); p1 += f / sr; if (p1 >= 1) p1 -= 1; p2 += f * 1.83 / sr; if (p2 >= 1) p2 -= 1;
            const tone = (sinT(p1) * 0.8 + sinT(p2) * 0.45) * Math.exp(-s / (0.06 * dec));
            nb[0].tick(rnd(NS)); const nzv = nb[1].tick(nb[0].hp) * Math.exp(-s / (0.16 * dec));
            Y[i] = sat((tone + nzv * 1.6) * 1.2) * 1.2;
          }
        };
        const gCLAP = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            const nz = rnd(NS); nb[1].tick(nz); nb[0].tick(nb[1].hp);
            // four hands a few ms apart, then the room
            let e = 0; for (let k = 0; k < 4; k++) { const d = s - k * 0.0105; if (d >= 0) e = Math.max(e, Math.exp(-d / 0.0045) * (k === 3 ? 1 : 0.8)); }
            e = Math.max(e, 0.55 * Math.exp(-Math.max(0, s - 0.032) / (0.11 * dec)) * Math.min(1, s / 0.03));
            y = sat(nb[0].bp * e * 4.5);
            Y[i] = y;
          }
        };
        const gRIM = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            const nz = rnd(NS);
            const click = nb[0].tick(nz) * Math.exp(-s / 0.003) * 2.2;
            nb[1].tick(nz); nb[2].tick(nz);
            const ring = (nb[1].bp * 3 + nb[2].bp * 2.5) * Math.exp(-s / 0.05);
            y = sat((click + ring * 0.9) * 1.2);
            Y[i] = y;
          }
        };
        const gHAT = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            let m = 0;
            for (let k = 0; k < 6; k++) { sq[k] += fr[k]; if (sq[k] >= 1) sq[k] -= 1; m += sq[k] < 0.5 ? 1 : -1; }
            const nz = rnd(NS);
            const src = kit === 1 ? m * 0.42 + nz * 0.26 : m * 0.12 + nz * 0.5;
            nb[0].tick(src); nb[1].tick(nb[0].bp); const x = nb[2].tick(nb[1].hp);
            amp[0] *= dk[0];
            const atk = Math.min(1, s / 0.0004);
            y = x * amp[0] * atk * (pedal ? 1.76 : open ? 0.99 : 2.2);
            if (pedal) y += nb[0].bp * Math.exp(-s / 0.008) * 0.3;
            Y[i] = y;
          }
        };
        const gTOM = (Y, end, t) => {
          if (kit !== 1) {
            const bd = kit === 5 ? x2 : 0.14;
            for (let i = 0; i < end; i++) { const s = (t + i) / sr; Bb[i] = 1 + bd * Math.exp(-s / 0.05); Xb[i] = 0; }
            modes(6, end);
            for (let i = 0; i < end; i++, t++) {
              const s = t / sr;
              const body = Xb[i];
              const click = nb[0].tick(rnd(NS)) * Math.exp(-s / 0.003);
              let y = nb[1].tick(sat((body * Math.min(1, s / 0.001) + (kit === 5 ? click * acc : click) * 0.8) * 1.4));
              if (kit === 5) { nb[3].tick(rnd(NS)); y += nb[3].bp * Math.exp(-s / 0.02) * xk; }   // the stick
              Y[i] = y;
            }
            return;
          }
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            const f = f0 * (1 + 0.6 * Math.exp(-s / 0.04)); p1 += f / sr; if (p1 >= 1) p1 -= 1;
            Y[i] = sat((sinT(p1) * Math.exp(-s / (0.32 * dec)) + nb[0].tick(rnd(NS)) * Math.exp(-s / 0.004) * 0.4) * 1.3);
          }
        };
        const gCYM = (Y, end, t) => {
          bank(end);
          const stick = pitchN === 51 || pitchN === 59, late = Math.ceil(0.25 * sr);
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let x = Xb[i];
            am += (rnd(NS) - am) * 0.002;
            for (let k = 0; k < nBands; k++) {
              hb[k].tick(rnd(NS)); const b = lb[k].tick(hb[k].hp);
              bandE[k] *= bandK[k];
              let q = b * bandG[k] * bandE[k] * (1 + 2.2 * am);
              const B = bandB[k];
              if (B) {
                // the bloom, 1 - B^t: once B^t is under 2^-54 that is exactly 1, and stays so (B^t only falls)
                const bt = Math.pow(B, t);
                if (bt < 5.551115123125783e-17) bandB[k] = 0; else q *= 1 - bt;
              }
              x += q;
            }
            if (stick) {   // the stick on the ride
              const st = nb[0].tick(rnd(NS));
              // past 0.25 s the stick is under |st| * 1e-27, and once that is under 2^-55 of x, adding it can't move x
              // by a bit: skip the exp then (it's computed, as before, whenever it could count)
              const ax = Math.abs(x);
              if (t < late || ax < 1e-200 || !(Math.abs(st) * 1e-27 < ax * 2.7755575615628914e-17)) x += st * Math.exp(-s / 0.004) * 0.6;
            }
            Y[i] = x * Math.min(1, s / 0.0004);
          }
        };
        const gCOW = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            sq[0] += fr[0]; if (sq[0] >= 1) sq[0] -= 1; sq[1] += fr[1]; if (sq[1] >= 1) sq[1] -= 1;
            const x = (sq[0] < 0.5 ? 1 : -1) + (sq[1] < 0.5 ? 1 : -1);
            nb[0].tick(x); nb[1].tick(nb[0].bp);
            y = nb[1].hp * (0.5 * Math.exp(-s / 0.012) + 0.5 * Math.exp(-s / (0.16 * dec))) * 1.6;
            Y[i] = y;
          }
        };
        const gSHAKE = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            nb[0].tick(rnd(NS)); nb[1].tick(nb[0].hp);
            const e = Math.min(1, s / 0.012) * Math.exp(-Math.max(0, s - 0.012) / 0.05);
            y = nb[1].bp * e * 2.4;
            Y[i] = y;
          }
        };
        const gTAMB = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            nb[0].tick(rnd(NS)); const hp = nb[0].hp;
            let j = 0; for (let k = 0; k < 4; k++) { const v = c1[k] * y1[k] - c2[k] * y2[k] + hp * amp[k] * (s < 0.03 ? 1 : 0.15); y2[k] = y1[k]; y1[k] = v; j += v; }
            y = (hp * Math.exp(-s / (0.07 * dec)) * 0.9 + j * 0.06) * Math.min(1, s / 0.002);
            Y[i] = y;
          }
        };
        // ------------------------------------------------------------ the appended kits (3: 808, 4: 909, 5: ACOUSTIC+)
        const gK8 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            // the bridged-T: a damped sine pinged by the trigger, its pitch rising a touch then falling
            const f = f0 * (1 + 0.22 * Math.exp(-s / 0.018) - 0.12 * Math.exp(-s / 0.0015)); p1 += f / sr; if (p1 >= 1) p1 -= 1;
            const kn = s < 0.001 ? Math.sin(Math.PI * s / 0.001) * 0.3 : 0;
            y = sat(nb[0].tick(sinT(p1) * Math.exp(-s / xa) + kn) * 1.2) * 0.9;
            Y[i] = y;
          }
        };
        const gK9 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            // a triangle swept down from about four times its pitch, rounded toward a sine; the click is separate
            const f = f0 * (1 + 3.2 * Math.exp(-s / 0.011) + 0.22 * Math.exp(-s / 0.07)); p1 += f / sr; if (p1 >= 1) p1 -= 1;
            let q = p1 + 0.25; if (q >= 1) q -= 1;
            const body = sat(1.7 * (1 - 4 * Math.abs(q - 0.5))) * 1.043 * (s < 0.004 ? 1 : Math.exp(-(s - 0.004) / xa)) * Math.min(1, s / 0.0004);
            nb[0].tick(rnd(NS));
            const click = nb[0].hp * Math.exp(-s / 0.0015) * 1.6 + nb[1].tick(s < 0.0006 ? 1 : 0) * 1.3;
            y = sat(body * 1.15 + click * 0.9 * xk) * 0.92;
            Y[i] = y;
          }
        };
        const gS8 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            const bend = 1 + 0.06 * Math.exp(-s / 0.01);
            p1 += f0 * bend / sr; if (p1 >= 1) p1 -= 1; p2 += f0 * 1.78 * bend / sr; if (p2 >= 1) p2 -= 1;
            const body = sinT(p1) * Math.exp(-s / xa) + 0.55 * sinT(p2) * Math.exp(-s / (0.6 * xa));
            nb[0].tick(rnd(NS)); const nz = nb[1].tick(nb[0].hp) * Math.exp(-s / xb);
            y = sat((body * (1.1 - 0.4 * xk) + nz * xk * 1.6) * 1.2) * 0.95 * Math.min(1, s / 0.0003);
            Y[i] = y;
          }
        };
        const gS9 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            const bend = 1 + 0.35 * Math.exp(-s / 0.012);
            p1 += f0 * bend / sr; if (p1 >= 1) p1 -= 1; p2 += f0 * 1.6 * bend / sr; if (p2 >= 1) p2 -= 1;
            let q1 = p1 + 0.25; if (q1 >= 1) q1 -= 1; let q2 = p2 + 0.25; if (q2 >= 1) q2 -= 1;
            const body = ((1 - 4 * Math.abs(q1 - 0.5)) + 0.6 * (1 - 4 * Math.abs(q2 - 0.5))) * Math.exp(-s / xa);
            nb[0].tick(rnd(NS)); const nz = nb[1].tick(nb[0].hp) * (0.6 * Math.exp(-s / 0.035) + 0.4 * Math.exp(-s / xb));
            y = sat((body * 0.9 * (1.15 - 0.4 * xk) + nz * xk * 1.7) * 1.25) * 0.9 * Math.min(1, s / 0.0003);
            Y[i] = y;
          }
        };
        const gCP8 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            const nz = rnd(NS); nb[1].tick(nz); nb[0].tick(nb[1].hp);
            // hands: three (808) or four (909) bursts a few ms apart, each a sawtooth envelope, then the tail
            let e = 0;
            if (type === CP8) { for (let k = 0; k < 3; k++) { const d = s - k * 0.0095; if (d >= 0) e = Math.max(e, Math.exp(-d / 0.0032)); } }
            else { for (let k = 0; k < 4; k++) { const d = s - (k === 3 ? 0.03 : k * 0.0093); if (d >= 0) e = Math.max(e, Math.exp(-d / 0.0028)); } }
            const t0 = type === CP8 ? 0.0285 : 0.03, tail = s >= t0 ? (type === CP8 ? 0.6 : 0.5) * Math.exp(-(s - t0) / xa) : 0;
            if (type === CP8) y = sat(nb[0].bp * Math.max(e, tail) * 4.2);
            else { nb[2].tick(nz); y = sat((nb[0].bp * e + nb[2].bp * tail * 1.3) * 4.2); }
            Y[i] = y;
          }
        };
        const gH8 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            let m = 0;
            for (let k = 0; k < 6; k++) { const d = fr[k]; let q = sq[k] + d; if (q >= 1) q -= 1; sq[k] = q; m += bsq(q, d); }
            if (type === H8) {
              nb[0].tick(m * 0.25); nb[1].tick(nb[0].bp);
              y = nb[1].hp * Math.exp(-s / xa) * Math.min(1, s / 0.0003) * 3.2;
            } else {
              nb[0].tick(m * 0.14 + rnd(NS) * 0.5); nb[1].tick(nb[0].hp);
              y = nb[1].bp * (x2 * Math.exp(-s / xa) + (1 - x2) * Math.exp(-s / xb)) * Math.min(1, s / 0.0003) * 2.6;
            }
            Y[i] = y;
          }
        };
        const gT8 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            const f = f0 * (1 + 0.1 * Math.exp(-s / 0.05)); p1 += f / sr; if (p1 >= 1) p1 -= 1;
            nb[0].tick(rnd(NS));
            y = sat((sinT(p1) * Math.exp(-s / xa) * Math.min(1, s / 0.0005) + nb[0].bp * Math.exp(-s / 0.02) * 0.25) * 1.2) * 0.9;
            Y[i] = y;
          }
        };
        const gT9 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            const f = f0 * (1 + 0.45 * Math.exp(-s / 0.025) + 0.1 * Math.exp(-s / 0.15)); p1 += f / sr; if (p1 >= 1) p1 -= 1;
            let q = p1 + 0.25; if (q >= 1) q -= 1;
            const body = sat(1.5 * (1 - 4 * Math.abs(q - 0.5))) * Math.exp(-s / xa) * Math.min(1, s / 0.0005);
            y = sat(body * 1.2 + nb[0].tick(rnd(NS)) * Math.exp(-s / 0.006) * 0.35) * 0.9;
            Y[i] = y;
          }
        };
        const gRM8 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            p1 += f0 / sr; if (p1 >= 1) p1 -= 1; p2 += f0 * 3.664 / sr; if (p2 >= 1) p2 -= 1;
            nb[0].tick(sinT(p1) * Math.exp(-s / 0.011) + 0.8 * sinT(p2) * Math.exp(-s / 0.006));
            y = sat(nb[0].hp * 1.6);
            Y[i] = y;
          }
        };
        const gRM9 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            p1 += f0 / sr; if (p1 >= 1) p1 -= 1; p2 += f0 * 3.44 / sr; if (p2 >= 1) p2 -= 1; am += f0 * 4.96 / sr; if (am >= 1) am -= 1;
            nb[0].tick(rnd(NS));
            nb[1].tick(sinT(p1) * Math.exp(-s / 0.009) + 0.8 * sinT(p2) * Math.exp(-s / 0.007) + 0.5 * sinT(am) * Math.exp(-s / 0.005) + nb[0].hp * Math.exp(-s / 0.002) * 0.6);
            y = sat(nb[1].hp * 1.5);
            Y[i] = y;
          }
        };
        const gCY8 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            let m = 0;
            for (let k = 0; k < 6; k++) { const d = fr[k]; let q = sq[k] + d; if (q >= 1) q -= 1; sq[k] = q; m += bsq(q, d); }
            m *= 0.2;
            nb[0].tick(m); nb[1].tick(m); nb[2].tick(nb[1].bp);
            y = (nb[0].bp * Math.exp(-s / xa) * x2 + nb[2].hp * Math.exp(-s / xb) * 1.4) * Math.min(1, s / 0.0004) * 1.6;
            Y[i] = y;
          }
        };
        const gMA8 = (Y, end, t) => {
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            let y = 0;
            nb[0].tick(rnd(NS));
            y = nb[0].hp * Math.min(1, s / 0.0015) * Math.exp(-s / 0.022) * 1.8;
            Y[i] = y;
          }
        };
        const gHM = (Y, end, t) => {
          bank(end);
          for (let i = 0; i < end; i++, t++) {
            const s = t / sr;
            const x = Xb[i];
            const nz = rnd(NS);
            nb[0].tick(nz); nb[1].tick(nb[0].hp); nb[2].tick(nz);
            Y[i] = (x + nb[1].lp * Math.exp(-s / xa) * 0.9 + nb[2].bp * Math.exp(-s / 0.0012) * xk * 1.2) * Math.min(1, s / 0.0003) * (pedal ? 1.5 : open ? 1 : 1.8);
          }
        };
        const me = {
          get open() { return open && !gone; },
          choke() { if (!choke) choke = coef(0.012, sr); },
          start(p, v, P) {
            kit = P.kit | 0; vel = v; t = 0; choke = 0; ck = 1; gone = false; dec = P.decay; tn = Math.pow(2, P.tune / 12); pitchN = p;
            NS[0] = (((r() * 4294967296) ^ p) >>> 0) || 0x9e3779b9;
            open = false; pedal = false;
            const field = kit !== 1;
            if (p === 35 || p === 36) type = KICK;
            else if (p === 38 || p === 40) type = SNARE;
            else if (p === 39) type = CLAP;
            else if (p === 42 || p === 44 || p === 46) { type = HAT; open = p === 46; pedal = p === 44; for (const o of voices) if (o !== me && o.open && !open) o.choke(); }
            else if (TOMS[p]) type = TOM;
            else if (p === 49 || p === 57 || p === 51 || p === 59 || p === 53 || p === 52 || p === 55) type = CYM;
            else if (p === 56) type = COW;
            else if (p === 69 || p === 70 || p === 82) type = SHAKE;
            else if (p === 54) type = TAMB;
            else type = RIM;
            if (kit >= 3 && KITMAP[kit] && KITMAP[kit][type] !== undefined) type = KITMAP[kit][type];
            tone = P.tone;
            const bright = kit === 2 ? 0.55 : 1;
            g = LEVEL[type] * Math.pow(vel, 1.4);
            dark = (vel < 0.97 || kit === 2) && kit !== 3 && kit !== 4;
            vlp.set(Math.min(sr * 0.45, (1800 + 17000 * vel * vel) * bright)); vlp.reset();
            const pw = P.width;
            pan = panLR((PAN[p] || 0) * pw * (kit === 2 ? 0.6 : 1));
            p1 = 0; p2 = 0; nModes = 0; nBands = 0;
            for (const f of nb) f.reset(); for (const f of hb) f.reset(); for (const f of lb) f.reset();
            if (type === KICK) {
              f0 = (kit === 1 ? 49 : 53 * (1 + r() * 0.015)) * tn;
              len = (kit === 1 ? 1.4 : 0.55) * dec * sr;
              nb[0].set(4200, 0.9); nb[1].set(1700, 1.6); nb[2].set(9000, 0.7);
              if (kit === 5) { acc = 0.08 + 4.2 * vel * vel * vel; x2 = 1.25 * vel * vel * vel; nb[0].set(8000, 0.8); nb[1].set(2600, 1.2); nb[3].set(3400, 0.9); }
            } else if (type === SNARE) {
              if (field) {
                f0 = 205 * tn * (1 + r() * 0.01); nModes = 8;
                for (let k = 0; k < 8; k++) { ph[k] = (r() + 1) / 2; amp[k] = SNARE_A[k] * (0.8 + 0.2 * (r() + 1)); dk[k] = coef(SNARE_T[k] * (vel < 0.5 ? 0.6 : 1) * Math.sqrt(dec), sr); }
                nb[0].set(1600, 0.7); nb[1].bell(4800, 0.8, 6); nb[2].set(10500, 0.7); nb[3].set(2600, 0.8);
              } else { f0 = 180 * tn; nb[0].set(2000, 0.7); nb[1].set(9000, 0.7); }
              len = 0.75 * dec * sr;
            } else if (type === CLAP) {
              nb[0].set(1150, 1.4); nb[1].set(700, 0.7); len = 0.6 * dec * sr;
            } else if (type === RIM) {
              nb[0].set(2600, 0.9); nb[1].set(900, 6); nb[2].set(1650, 7); len = 0.15 * sr;
            } else if (type === HAT) {
              const base = (field ? 1.18 : 1) * tn;
              for (let k = 0; k < 6; k++) { fr[k] = HAT808[k] * base * (field ? 1.43 : 1) / sr; sq[k] = (r() + 1) / 2; }
              nb[0].set(field ? 9000 : 10000, 1.1); nb[1].set(7000, 0.7); nb[2].set(open ? 15000 : 13000, 0.7);
              const tau = open ? 0.42 * dec : pedal ? 0.022 : 0.04 * Math.sqrt(dec);
              dk[0] = coef(tau, sr); amp[0] = 1;
              len = (open ? 2.2 : 0.3) * dec * sr;
            } else if (type === TOM) {
              f0 = TOMS[p] * tn * (1 + r() * 0.01);
              if (field) { nModes = 6; for (let k = 0; k < 6; k++) { ph[k] = (r() + 1) / 2; amp[k] = TOM_A[k]; dk[k] = coef(TOM_T[k] * dec, sr); } }
              nb[0].set(2200, 0.8); nb[1].set(7000, 0.7);
              if (kit === 5) { acc = 0.08 + 4.5 * vel * vel * vel; x2 = 0.05 + 0.2 * vel; xk = 1.05 * vel * vel * vel; nb[0].set(7000, 0.8); nb[3].set(2600, 0.9); }
              len = 1.2 * dec * sr;
            } else if (type === CYM) {
              const B = BANKS[p] || BANKS[49];
              nModes = Math.min(MX, B.modes.length);
              const sc = tn * (kit === 1 ? 1.1 : 1);
              for (let k = 0; k < nModes; k++) {
                const [f, tau, a, phi] = B.modes[k], w = TAU * Math.min(f * sc, sr * 0.45) / sr, rr = coef(tau * dec, sr);
                c1[k] = 2 * rr * Math.cos(w); c2[k] = rr * rr;
                const aa = a * (0.85 + 0.15 * (r() + 1));
                y2[k] = aa * Math.sin(phi); y1[k] = aa * rr * Math.sin(w + phi);
              }
              nBands = B.bands.length;
              for (let k = 0; k < nBands; k++) { const [lo, hi, gain, tau, bloom] = B.bands[k]; hb[k].set(lo * sc, 0.7); lb[k].set(Math.min(hi * sc, sr * 0.45), 0.7); bandG[k] = gain; bandE[k] = 1; bandK[k] = coef(tau * dec, sr); bandB[k] = bloom ? coef(bloom, sr) : 0; }
              len = B.dur * dec * sr; am = 0; g *= B.gain;
              nb[0].set(5200, 1.2);
            } else if (type === COW) {
              fr[0] = 540 * tn / sr; fr[1] = 800 * tn / sr; sq[0] = 0; sq[1] = 0.3; nb[0].set(2640 * tn, 1.3); nb[1].set(700, 0.7); len = 0.9 * dec * sr;
            } else if (type === SHAKE) {
              nb[0].set(5200, 0.7); nb[1].set(8500, 1.4); len = 0.3 * sr;
            } else if (type === TAMB) {
              nb[0].set(6000, 0.7); nModes = 4;
              for (let k = 0; k < 4; k++) { const f = (6200 + 900 * k + r() * 300) * tn, w = TAU * Math.min(f, sr * 0.45) / sr, rr = coef(0.18 * dec, sr); c1[k] = 2 * rr * Math.cos(w); c2[k] = rr * rr; y1[k] = 0; y2[k] = 0; amp[k] = 0.25; }
              len = 0.6 * dec * sr;
            } else if (type >= K8) setupX(p);
          },
          release() {},
          stop() { gone = true; },
          render(L, R, n, P) {
            if (gone) return false;
            const end = Math.min(n, Math.max(0, Math.ceil(len - t)));
            if (Y.length < n) { Y = new Float64Array(n); Xb = new Float64Array(n); Bb = new Float64Array(n); }
            // the piece (each its own loop, so the filters and the noise inline), then the voice's level, choke and fade
            switch (type) {
              case KICK: gKICK(Y, end, t); break;
              case SNARE: gSNARE(Y, end, t); break;
              case CLAP: gCLAP(Y, end, t); break;
              case RIM: gRIM(Y, end, t); break;
              case HAT: gHAT(Y, end, t); break;
              case TOM: gTOM(Y, end, t); break;
              case CYM: gCYM(Y, end, t); break;
              case COW: gCOW(Y, end, t); break;
              case SHAKE: gSHAKE(Y, end, t); break;
              case TAMB: gTAMB(Y, end, t); break;
              case K8: gK8(Y, end, t); break;
              case K9: gK9(Y, end, t); break;
              case S8: gS8(Y, end, t); break;
              case S9: gS9(Y, end, t); break;
              case CP8: case CP9: gCP8(Y, end, t); break;
              case H8: case H9: gH8(Y, end, t); break;
              case T8: gT8(Y, end, t); break;
              case T9: gT9(Y, end, t); break;
              case RM8: gRM8(Y, end, t); break;
              case RM9: gRM9(Y, end, t); break;
              case CY8: gCY8(Y, end, t); break;
              case MA8: gMA8(Y, end, t); break;
              case HM: gHM(Y, end, t); break;
            }
            for (let i = 0; i < end; i++, t++) {
              let y = Y[i];
              if (dark) y = vlp.lp(y);
              if (choke) { ck *= choke; y *= ck; if (ck < 1e-4) len = t + 1; }
              // fade the last 20 ms so nothing ends on a step
              const left = len - t; if (left < 0.02 * sr) y *= left / (0.02 * sr);
              y *= g;
              L[i] += y * pan[0]; R[i] += y * pan[1];
            }
            return t < len;
          },
        };
        voices.push(me);
        return me;
      },
      // the bus: the room, a tilt around 1 kHz, the drive, and (DUST) the old sampler
      process(L, R, n, P) {
        const kit = P.kit | 0;
        tl.shelfLo(900, 0.6, -P.tone * 4); tr.shelfLo(900, 0.6, -P.tone * 4);
        hl.shelfHi(2500, 0.6, P.tone * 5 - (kit === 2 ? 4 : 0)); hr.shelfHi(2500, 0.6, P.tone * 5 - (kit === 2 ? 4 : 0));
        const dg = 1 + P.drive * P.drive * 9 + (kit === 2 ? 1.2 : 0), comp = Math.pow(dg, -0.55), OUT = 0.48;
        const crush = kit === 2 ? 1 / 2048 : 0;
        room.set(0.18 + 0.25 * P.room, 0.35 + 0.9 * P.room, 0.55); rhl.set(250, 0.6); rhr.set(250, 0.6);
        if (XL.length < n) { XL = new Float64Array(n); XR = new Float64Array(n); }
        for (let i = 0; i < n; i++) {
          let l = L[i], r = R[i];
          room.tick(l, r); rhl.tick(room.l); rhr.tick(room.r);
          const rm = roomS.next(P.room) * 0.9;
          l += rhl.hp * rm; r += rhr.hp * rm;
          l = hl.eq(tl.eq(l)); r = hr.eq(tr.eq(r));
          XL[i] = l * dg; XR[i] = r * dg;
        }
        osL(XL, n); osR(XR, n);
        for (let i = 0; i < n; i++) {
          let l = XL[i] * comp, r = XR[i] * comp;
          if (crush) { l = Math.round(l / crush) * crush; r = Math.round(r / crush) * crush; }
          L[i] = knee(l * OUT); R[i] = knee(r * OUT);
        }
      },
    };
  },
};
`),
});
