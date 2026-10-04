// vendored verbatim from clawd-o-matic/web/pedals/50-pitch.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: pitch and synth. docs/PEDALS.md says how a pack works. */
// Octaves, whammy, doublers, a harmonizer that knows the song's key, a freeze, a guitar synth, and three odd ones
// (a dying-tape pitch drop, a random arpeggiator in the key, an octave-up choir). Nearly all of it needs AudioWorklets:
// Web Audio has no pitch shifter. The worklets share a little library (PP_LIB, pasted into each: every processor is its
// own module) of four parts:
//   Line   a delay line, read at a fractional delay
//   Shift  the classic two-tap rotating pitch shifter: two read taps sweep across a window of N samples, half a window
//          apart, each faded by sin² so they sum to one; when a tap starts a new grain it slides (up to one low-E
//          period) to where its waveform lines up with the other tap's, so the splices don't phase-cancel (without
//          that, the octave up measured two semitones sharp and the octave down smeared). Polyphonic (it shifts chords
//          too). Its latency is signal-dependent: on average 24 samples + half the sweep + half the search, 15-18 ms
//          at 48k (declared per pedal). Pedals that can rest at unison crossfade to the dry note there (zero latency).
//   Pitch  a YIN pitch tracker on the input decimated to about 12 kHz: 18 ms windows every few ms, 70 to 1400 Hz.
//          Monophonic: a single note tracks, a chord gives nonsense (so the pedals that use it hold their last note).
//   Onset  a pick-attack detector: a fast envelope jumping over a slow one.
// Everything is deterministic (seeded hashes, never Math.random) and allocates nothing in process().
// The song's key (the harmonizer and the arpeggiator): song.key (0-11, C = 0, major), or the key at the bar that's
// playing (AR.keyAt) while the band plays. The pedal API doesn't pass it, so ppKey() reads the app's globals at set()
// time and a live context polls it every 0.4 s (a key change mid-song follows).
{
const PP_LIB = `
const WIN = new Float32Array(1026), SIN = new Float32Array(1026);
for (let i = 0; i < 1026; i++) { const s = Math.sin((Math.PI * Math.min(i, 1024)) / 1024); WIN[i] = s * s; SIN[i] = s; }
const P = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
const MAJ = [0, 2, 4, 5, 7, 9, 11];
// semitones from midi note n to 'steps' steps up (or down) the major scale of key; a note outside the scale moves as
// the scale note below it does
function dia(n, key, steps) {
  const pc = (((n - key) % 12) + 12) % 12;
  let i = 6; while (MAJ[i] > pc) i--;
  const j = i + steps, oct = Math.floor(j / 7), jj = ((j % 7) + 7) % 7;
  return MAJ[jj] + 12 * oct - MAJ[i];
}
class Line {
  constructor(n) { let s = 1; while (s < n) s <<= 1; this.b = new Float32Array(s); this.m = s - 1; this.w = 0; }
  push(x) { this.b[this.w] = x; this.w = (this.w + 1) & this.m; }
  read(d) { const p = this.w - d, i = Math.floor(p), f = p - i, b = this.b, m = this.m, a = b[i & m]; return a + (b[(i + 1) & m] - a) * f; }
}
class Shift {
  // sweep: how far (samples at 48k) a tap's delay travels in one grain; the grain is sweep / |1 - r| long, kept
  // between gmin and gmax. base: a fixed extra delay.
  constructor(sr, sweep, gmin, gmax) {
    const s = sr / 48000;
    this.D = Math.round((sweep || 1024) * s); this.gmin = Math.round((gmin || 512) * s); this.gmax = Math.round((gmax || 4096) * s);
    this.dmin = Math.round(24 * s); this.S = Math.round(sr / 75); this.n = Math.round(sr * 0.008) >> 2;
    this.d0 = this.dmin; this.d1 = this.dmin; this.p0 = 0; this.p1 = 0.5; this.inc = 1 / this.gmax; this.base = 0;
  }
  // where a tap starts its next grain: the start of its sweep, then up to one low-E period later, wherever its
  // waveform best lines up with the other tap's (normalised cross-correlation, every 4th sample, then refined)
  place(L, r, dOther) {
    const a = r > 1 ? r - 1 : 1 - r;
    let G = a > 1e-6 ? this.D / a : this.gmax; G = G < this.gmin ? this.gmin : G > this.gmax ? this.gmax : G;
    this.inc = 1 / G;
    const nom = r > 1 ? this.dmin + (r - 1) * G : this.dmin, b = L.b, m = L.m, n = this.n, o = L.w - Math.round(dOther + this.base), c0 = L.w - Math.round(nom + this.base);
    let best = 0, bs = -1e30;
    for (let dl = 0; dl <= this.S; dl += 4) { const sc = this.score(b, m, n, o, c0 - dl); if (sc > bs) { bs = sc; best = dl; } }
    const c = best;
    for (let dl = Math.max(0, c - 3); dl <= c + 3; dl++) { if (dl === c) continue; const sc = this.score(b, m, n, o, c0 - dl); if (sc > bs) { bs = sc; best = dl; } }
    return nom + best;
  }
  score(b, m, n, o, c) {
    let xy = 0, yy = 1e-12;
    for (let j = 0; j < n; j++) { const v = b[(c - 4 * j) & m]; xy += b[(o - 4 * j) & m] * v; yy += v * v; }
    return xy / Math.sqrt(yy);
  }
  tick(L, r) {
    let p0 = this.p0 + this.inc, p1 = this.p1 + this.inc;
    if (p0 >= 1) { p0 -= 1; this.d0 = this.place(L, r, this.d1); }
    if (p1 >= 1) { p1 -= 1; this.d1 = this.place(L, r, this.d0); }
    this.p0 = p0; this.p1 = p1;
    const dr = 1 - r, top = L.m - 2 - this.base;
    let d0 = this.d0 + dr, d1 = this.d1 + dr;
    d0 = d0 < 1 ? 1 : d0 > top ? top : d0; d1 = d1 < 1 ? 1 : d1 > top ? top : d1;
    this.d0 = d0; this.d1 = d1;
    return L.read(d0 + this.base) * WIN[(p0 * 1024) | 0] + L.read(d1 + this.base) * WIN[(p1 * 1024) | 0];
  }
}
// The analogue way to find a note: the string through a low-pass that follows it (1.5x the note, so the fundamental
// dominates), squared up with hysteresis; each upward zero crossing is a period. tick() is true at each one; per is
// the period in samples (0 when it's lost the note); v is the filtered string.
class Div {
  constructor(sr) {
    this.sr = sr; this.ah = Math.exp((-2 * Math.PI * 60) / sr); this.hp = 0; this.hx = 0; this.v = 0;
    this.z0 = 0; this.z1 = 0; this.z2 = 0; this.z3 = 0; this.a = 0; this.setF(250);
    this.pk = 0; this.pr = Math.exp(-1 / (0.03 * sr)); this.arm = false; this.since = 0; this.per = 0; this.pmin = sr / 1400; this.pmax = sr / 60;
  }
  setF(f) { this.a = 1 - Math.exp((-2 * Math.PI * f) / this.sr); }
  tick(x) {
    this.hp = this.ah * (this.hp + x - this.hx); this.hx = x;
    const a = this.a;
    this.z0 += (this.hp - this.z0) * a; this.z1 += (this.z0 - this.z1) * a; this.z2 += (this.z1 - this.z2) * a; this.z3 += (this.z2 - this.z3) * a;
    const v = (this.v = this.z3), av = v < 0 ? -v : v;
    this.pk = av > this.pk ? av : this.pk * this.pr;
    if (++this.since > this.pmax * 1.5 && this.per) { this.per = 0; this.setF(250); }
    if (v < -0.4 * this.pk) { if (this.since > this.per * 0.45) this.arm = true; }
    else if (this.arm && v >= 0) {
      this.arm = false;
      const p = this.since; this.since = 0;
      if (p > this.pmin && p < this.pmax) { this.per = p; const f = (1.5 * this.sr) / p; this.setF(f < 150 ? 150 : f > 1000 ? 1000 : f); }
      return true;
    }
    return false;
  }
}
class Onset {
  constructor(sr) {
    this.f = 0; this.s = 0; this.hold = 0; this.ref = Math.round(0.07 * sr);
    this.af = 1 - Math.exp(-1 / (0.0007 * sr)); this.rf = 1 - Math.exp(-1 / (0.02 * sr));
    this.as = 1 - Math.exp(-1 / (0.04 * sr)); this.rs = 1 - Math.exp(-1 / (0.3 * sr));
  }
  tick(x) {
    const a = x < 0 ? -x : x;
    this.f += (a - this.f) * (a > this.f ? this.af : this.rf);
    this.s += (this.f - this.s) * (this.f > this.s ? this.as : this.rs);
    if (this.hold > 0) { this.hold--; return false; }
    if (this.f > this.s * 1.7 + 0.004) { this.hold = this.ref; return true; }
    return false;
  }
}
class Pitch {
  constructor(sr, hopMs) {
    const D = Math.max(1, Math.round(sr / 12000)), fs = sr / D;
    this.sr = sr; this.D = D; this.W = Math.round(fs * 0.018); this.T = Math.ceil(fs / 70); this.t0 = Math.max(2, Math.floor(fs / 1400));
    this.n = this.W + this.T; this.b = new Float32Array(this.n * 2); this.w = 0; this.d = new Float32Array(this.T + 2);
    this.k = 0; this.h = 0; this.hop = Math.max(8, Math.round((fs * (hopMs || 5)) / 1000));
    this.a = 1 - Math.exp((-2 * Math.PI * 1400) / sr); this.l1 = 0; this.l2 = 0;
    this.f = 0; this.midi = 0; this.ok = false;
  }
  // one input sample; true when a new estimate is ready (ok: voiced, midi: its note as a float)
  push(v) {
    this.l1 += (v - this.l1) * this.a; this.l2 += (this.l1 - this.l2) * this.a;
    if (++this.k < this.D) return false;
    this.k = 0;
    const n = this.n, w = this.w; this.b[w] = this.l2; this.b[w + n] = this.l2; this.w = w + 1 === n ? 0 : w + 1;
    if (++this.h < this.hop) return false;
    this.h = 0; this.est(); return true;
  }
  est() {
    const b = this.b, o = this.w, W = this.W, T = this.T, d = this.d;
    let e = 0; for (let j = o + T; j < o + T + W; j++) e += b[j] * b[j];
    if (e < W * 1e-6) { this.ok = false; return; } // (quieter than -60 dB)
    let run = 0; d[0] = 1;
    for (let t = 1; t <= T; t++) { let s = 0; for (let j = o; j < o + W; j++) { const u = b[j] - b[j + t]; s += u * u; } run += s; d[t] = run > 0 ? (s * t) / run : 1; }
    let tau = -1;
    for (let t = this.t0; t < T; t++) if (d[t] < 0.18) { while (t + 1 < T && d[t + 1] < d[t]) t++; tau = t; break; }
    if (tau < 1) { this.ok = false; return; }
    const a = d[tau - 1], m = d[tau], c = d[tau + 1], den = a + c - 2 * m, sh = den > 0 ? (0.5 * (a - c)) / den : 0;
    this.f = this.sr / ((tau + sh) * this.D); this.midi = 69 + 12 * Math.log2(this.f / 440); this.ok = true;
  }
}
// a note that holds until another has been heard twice running (a tracker's stray estimate doesn't move it)
class Note {
  constructor() { this.n = -1; this.cand = -1; this.cnt = 0; }
  see(midi) {
    const c = Math.round(midi);
    if (c === this.n) { this.cnt = 0; return false; }
    if (c === this.cand) this.cnt++; else { this.cand = c; this.cnt = 1; }
    if (this.cnt >= 2 || this.n < 0) { this.n = c; this.cnt = 0; return true; }
    return false;
  }
}
`;
const ppSrc = (name, body) => PP_LIB + body + `\nregisterProcessor('${name}', PPProc);`;
const PP_MONO = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
const PP_STEREO = Object.assign({}, PP_MONO, { outputChannelCount: [2] });
const ppParam = (n, k) => n.parameters.get(k);
// A pedal whose worklet didn't load: a wire (it passes the guitar dry).
const ppWire = (k) => { const g = k.G(1); return { input: g, output: g, set() {} }; };
const ppLive = (c) => !(typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext);
// The song's key, 0-11 (C = 0), major: the key at the bar playing, or the song's. (The app's globals: this file loads
// before app.js, so they're read only when a pedal is set, and a missing one means C.)
function ppKey() {
  try {
    if (!song) return 0;
    const pl = typeof PLUG !== 'undefined' && PLUG.clock && PLUG.clock.playing();
    const k = pl && typeof AR !== 'undefined' && AR.keyAt ? AR.keyAt(song, Math.max(0, PLUG.clock.bar())) : song.key;
    return ((Math.round(+k) % 12) + 12) % 12 || 0;
  } catch (e) { return 0; }
}
// Every 0.4 s on a live context, fn() (the key, the band's bar line): stopped when the pedal leaves the board.
function ppPoll(c, k, fn) {
  if (!ppLive(c)) return;
  const iv = setInterval(() => { try { fn(); } catch (e) { /* the app isn't there */ } }, 400);
  k.onDispose(() => clearInterval(iv));
}
const ppSemi = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)) + ' st';

/* ============================================================ SUBMARINE: the analogue octave divider */
// A flip-flop clocked by the note's zero crossings flips the polarity of the (filtered) note: that's an octave down,
// with the note's own dynamics; a second flip-flop off the first is two down. Blended with a square off the same
// flip-flop for the buzz. Monophonic: play a chord and it stumbles, which is half the charm.
const SUB_SRC = ppSrc('submarine-div', `
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('o1', 0.7, 0, 2), P('o2', 0.3, 0, 2)]; }
  constructor() {
    super(); const sr = sampleRate;
    this.dv = new Div(sr);
    this.ea = 1 - Math.exp(-1 / (0.004 * sr)); this.er = 1 - Math.exp(-1 / (0.09 * sr)); this.env = 0;
    this.f1 = 1; this.f2 = 1; this.g = 0; this.gc = 1 - Math.exp(-1 / (0.012 * sr));
    this.c1 = 1 - Math.exp((-2 * Math.PI * 420) / sr); this.c2 = 1 - Math.exp((-2 * Math.PI * 260) / sr);
    this.a1 = 0; this.b1 = 0; this.a2 = 0; this.b2 = 0;
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const g1 = p.o1[0], g2 = p.o2[0];
    for (let n = 0; n < o.length; n++) {
      const x = i[n];
      if (this.dv.tick(x)) { this.f1 = -this.f1; if (this.f1 > 0) this.f2 = -this.f2; } // (the flip lands where the string crosses 0: no step)
      const v = this.dv.v;
      const ax = x < 0 ? -x : x;
      this.env += (ax - this.env) * (ax > this.env ? this.ea : this.er);
      this.g += ((this.env > 0.003 ? 1 : 0) - this.g) * this.gc; // (the tracking gate: quiet strings don't growl)
      const s1 = this.f1 * (1.4 * v + 0.5 * this.env), s2 = this.f2 * (1.1 * v + 0.7 * this.env);
      this.a1 += (s1 - this.a1) * this.c1; this.b1 += (this.a1 - this.b1) * this.c1;
      this.a2 += (s2 - this.a2) * this.c2; this.b2 += (this.a2 - this.b2) * this.c2;
      o[n] = this.g * (g1 * this.b1 + g2 * this.b2) * 1.6;
    }
    return true;
  }
}`);
pedalDef({
  id: 'submarine', name: 'Submarine', kind: 'OCTAVE DOWN', cat: 'pitch', where: 'pre',
  color: '#f2c230', ink: '#1b1606', nod: 'the analogue octave box with two sub voices and a direct knob',
  blurb: 'One or two octaves under your riff: fat, growly, analogue',
  look: { shape: 'box', finish: 'hammer', knob: 'black', label: 'stencil', led: '#ff3b30' },
  worklets: { 'submarine-div': SUB_SRC },
  trim: 0,
  knobs: [['o1', 'OCT 1', 0, 10, 7], ['o2', 'OCT 2', 0, 10, 3], ['dry', 'DIRECT', 0, 10, 7]],
  build(c, k) {
    const n = k.worklet('submarine-div', PP_MONO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(1);
    k.chain(input, dry, output); k.chain(input, n, output);
    return { input, output, node: n, set(v, x) {
      x.to(ppParam(n, 'o1'), v.o1 / 7); x.to(ppParam(n, 'o2'), v.o2 / 7); x.to(dry.gain, v.dry / 7);
    } };
  },
});

/* ============================================================ OCTOPUS: the polyphonic octave */
// Three shifters off one delay line: an octave down (a long sweep: a smooth sub, about 18 ms behind), an octave up and
// two up (shorter sweeps, 15 ms). Chords work. The dry path is untouched, so with DRY up the pedal adds no latency you'd feel.
const OCT_SRC = ppSrc('octopus-shift', `
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('sub', 1, 0, 2), P('up', 0, 0, 2), P('up2', 0, 0, 2)]; }
  constructor() {
    super(); const sr = sampleRate, s = sr / 48000;
    this.L = new Line(8192); this.sd = new Shift(sr, 1024); this.su = new Shift(sr, 768); this.s2 = new Shift(sr, 768);
    this.lc = 1 - Math.exp((-2 * Math.PI * 1600) / sr); this.l1 = 0; this.l2 = 0;
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const sub = p.sub[0], up = p.up[0], up2 = p.up2[0], L = this.L;
    for (let n = 0; n < o.length; n++) {
      L.push(i ? i[n] : 0);
      let y = 0;
      if (sub > 1e-4) { const d = this.sd.tick(L, 0.5); this.l1 += (d - this.l1) * this.lc; this.l2 += (this.l1 - this.l2) * this.lc; y += sub * this.l2; }
      if (up > 1e-4) y += up * this.su.tick(L, 2);
      if (up2 > 1e-4) y += up2 * this.s2.tick(L, 4);
      o[n] = y;
    }
    return true;
  }
}`);
pedalDef({
  id: 'octopus', name: 'Octopus', kind: 'POLY OCTAVE', cat: 'pitch', where: 'pre',
  color: '#5b2a8c', ink: '#f7eaff', nod: 'the polyphonic octave generator with a slider for each voice',
  blurb: 'Octaves under and over whole chords: organ, 12-string, bass',
  look: { shape: 'wide', finish: 'flat', knob: 'chrome', label: 'script', led: '#b388ff' },
  worklets: { 'octopus-shift': OCT_SRC },
  latency: 0, // (the dry path; the sub voice alone is about 18 ms behind, the up voices 15: see build's latency)
  trim: 1.2,
  knobs: [['sub', 'SUB', 0, 10, 6], ['dry', 'DRY', 0, 10, 7], ['up', 'UP', 0, 10, 4], ['up2', '2 UP', 0, 10, 0], ['tone', 'TONE', 0, 10, 6]],
  build(c, k) {
    const n = k.worklet('octopus-shift', PP_MONO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(1), tone = k.F('lowpass', 5000, 0), wet = k.G(1);
    k.chain(input, dry, output); k.chain(input, n, tone, wet, output);
    let lat = 0;
    return { input, output, node: n, get latency() { return lat; }, set(v, x) {
      x.to(ppParam(n, 'sub'), v.sub / 10 * 1.2); x.to(ppParam(n, 'up'), v.up / 10); x.to(ppParam(n, 'up2'), v.up2 / 10 * 0.8);
      x.to(dry.gain, v.dry / 10);
      x.to(tone.frequency, 900 * Math.pow(2, v.tone * 0.35)); // 900 Hz to 10 kHz
      // the latency of the loudest part of it
      const loud = Math.max(v.dry, v.sub, v.up, v.up2);
      lat = loud === v.dry ? 0 : loud === v.sub ? 0.0178 : 0.0152;
    } };
  },
});

/* ============================================================ WHAMMERHEAD: the pitch treadle */
// One shifter whose interval the treadle sweeps: heel to toe, from one interval to another (heel is unison in the
// whammy modes, with no dry; the harmony modes keep the dry and sweep the second voice between two intervals).
const WH_MODES = [['+2 OCT', 0, 24, 0], ['+OCT', 0, 12, 0], ['+5TH', 0, 7, 0], ['+4TH', 0, 5, 0], ['−2ND', 0, -2, 0], ['−5TH', 0, -7, 0],
  ['−OCT', 0, -12, 0], ['−2 OCT', 0, -24, 0], ['DIVE', 0, -36, 0], ['H ±OCT', -12, 12, 1], ['H 4/5', 5, 7, 1], ['H 3RD', 3, 4, 1]];
const WH_SRC = ppSrc('whammerhead-shift', `
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('semis', 12, -36, 24)]; }
  constructor() { super(); const sr = sampleRate; this.L = new Line(8192); this.sh = new Shift(sr, 900); this.s = 0; this.sc = 1 - Math.exp(-1 / (0.005 * sr)); }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const tgt = p.semis[0], L = this.L;
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      this.s += (tgt - this.s) * this.sc;
      const s = this.s, a = s < 0 ? -s : s, u = a >= 0.5 ? 1 : a * 2, y = this.sh.tick(L, Math.pow(2, s / 12));
      o[n] = u * y + (1 - u) * x; // (at unison: the dry note, not two taps half a window apart)
    }
    return true;
  }
}`);
pedalDef({
  id: 'whammerhead', name: 'Whammerhead', kind: 'PITCH TREADLE', cat: 'pitch', where: 'pre',
  color: '#d7263d', ink: '#fff1f1', nod: 'the red pitch-shifting treadle of every screaming solo',
  blurb: 'Rock it: bends up to two octaves, dive bombs, harmonies',
  look: { shape: 'wah', treadle: 'pedal', finish: 'flat', knob: 'black', label: 'block', led: '#ffe14d' },
  worklets: { 'whammerhead-shift': WH_SRC },
  latency: 0.0165, // (the shifter's average delay: 24 + 900/2 + 640/2 samples at 48k)
  trim: 0,
  knobs: [['pedal', 'PEDAL', 0, 10, 10], ['mode', 'MODE', 0, WH_MODES.length - 1, 1, 1, (v) => WH_MODES[Math.max(0, Math.min(WH_MODES.length - 1, Math.round(v)))][0]]],
  build(c, k) {
    const n = k.worklet('whammerhead-shift', PP_MONO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(0), wet = k.G(1);
    k.chain(input, dry, output); k.chain(input, n, wet, output);
    let harm = 0;
    return { input, output, node: n, get latency() { return harm ? 0 : 0.0165; }, set(v, x) {
      const m = WH_MODES[Math.max(0, Math.min(WH_MODES.length - 1, Math.round(v.mode)))];
      harm = m[3];
      x.to(ppParam(n, 'semis'), m[1] + ((m[2] - m[1]) * v.pedal) / 10, 0.02);
      x.to(dry.gain, harm ? 0.85 : 0); x.to(wet.gain, harm ? 0.6 : 1);
    } };
  },
});

/* ============================================================ CLONE CRAB: the micro-pitch doubler */
// The rack trick behind every 80s stereo lead: a copy a few cents flat on the left, one a few cents sharp on the right,
// each a few ms late. Two guitars from one.
const CLONE_SRC = ppSrc('clonecrab-shift', `
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('cents', 9, 0, 60), P('dly', 14, 0, 80)]; }
  constructor() {
    super(); const sr = sampleRate; this.sr = sr;
    this.L = new Line(16384); this.a = new Shift(sr, 1024); this.b = new Shift(sr, 1024); this.b.p0 = 0.27; this.b.p1 = 0.77;
    this.ba = 0; this.bb = 0; this.bc = 1 - Math.exp(-1 / (0.05 * sr)); this.first = true;
  }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const c = p.cents[0], rL = Math.pow(2, -c / 1200), rR = Math.pow(2, c / 1200), ms = this.sr / 1000, L = this.L;
    const tA = 1 + p.dly[0] * ms, tB = 1 + (p.dly[0] * 1.37 + 3) * ms;
    if (this.first) { this.ba = tA; this.bb = tB; this.first = false; }
    for (let n = 0; n < oL.length; n++) {
      L.push(i ? i[n] : 0);
      this.ba += (tA - this.ba) * this.bc; this.bb += (tB - this.bb) * this.bc; this.a.base = this.ba; this.b.base = this.bb;
      oL[n] = this.a.tick(L, rL); oR[n] = this.b.tick(L, rR);
    }
    return true;
  }
}`);
pedalDef({
  id: 'clonecrab', name: 'Clone Crab', kind: 'MICRO PITCH', cat: 'pitch', where: 'post', stereo: true,
  color: '#1fa6a0', ink: '#effffd', nod: 'the rack micro-pitch shifter that doubled every 80s lead',
  blurb: 'One guitar becomes two: wide, thick, still in tune',
  look: { shape: 'box', finish: 'brushed', knob: 'small', label: 'plate', led: '#7dfff3' },
  worklets: { 'clonecrab-shift': CLONE_SRC },
  trim: 0,
  knobs: [['cents', 'DETUNE', 0, 30, 9, 1, (v) => Math.round(v) + '¢'], ['dly', 'DELAY', 0, 50, 14, 1, (v) => Math.round(v) + ' ms'], ['mix', 'MIX', 0, 10, 5]],
  build(c, k) {
    const n = k.worklet('clonecrab-shift', PP_STEREO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(1), wet = k.G(0.5);
    k.chain(input, dry, output); k.chain(input, n, wet, output);
    return { input, output, node: n, set(v, x) {
      x.to(ppParam(n, 'cents'), v.cents); x.to(ppParam(n, 'dly'), v.dly, 0.05);
      x.to(wet.gain, (v.mix / 10) * 0.9); x.to(dry.gain, 1 - v.mix * 0.04);
    } };
  },
});

/* ============================================================ HERMIT HARMONY: the harmonizer that knows the key */
// It tracks the note you play (single notes: a lead line), finds the note a 3rd, 5th or 6th above it (or below) in the
// song's key, and shifts a copy there, so the harmony is major or minor where the key says. A chord confuses the
// tracker: it holds its last interval. The harmony's ~16 ms behind the dry (the shifter); the dry isn't.
const HERM_SRC = ppSrc('hermit-harm', `
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('steps', 2, 1, 7), P('dir', 1, -1, 1), P('key', 0, 0, 11)]; }
  constructor() {
    super(); const sr = sampleRate;
    this.L = new Line(8192); this.sh = new Shift(sr, 900); this.pt = new Pitch(sr, 5); this.nt = new Note();
    this.r = 1; this.rc = 1 - Math.exp(-1 / (0.008 * sr)); this.g = 0; this.gc = 1 - Math.exp(-1 / (0.02 * sr));
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const steps = Math.round(p.steps[0]) * (p.dir[0] < 0 ? -1 : 1), key = Math.round(p.key[0]), L = this.L, nt = this.nt;
    let tgt = nt.n < 0 ? 1 : Math.pow(2, dia(nt.n, key, steps) / 12);
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      if (this.pt.push(x) && this.pt.ok && nt.see(this.pt.midi)) tgt = Math.pow(2, dia(nt.n, key, steps) / 12);
      this.r += (tgt - this.r) * this.rc;
      this.g += ((nt.n < 0 ? 0 : 1) - this.g) * this.gc; // (no harmony until it's heard a note)
      o[n] = this.g * this.sh.tick(L, this.r);
    }
    return true;
  }
}`);
const HERM_STEPS = [2, 4, 5]; // (scale steps: a 3rd, a 5th, a 6th)
pedalDef({
  id: 'harmony', name: 'Hermit Harmony', kind: 'HARMONIZER · KEY', cat: 'pitch', where: 'pre',
  color: '#e8e1cf', ink: '#2b2118', nod: 'the intelligent pitch shifter twin-guitar players set to the key',
  blurb: 'A second guitar a 3rd, 5th or 6th away, in the song’s key',
  look: { shape: 'box', finish: 'stripe', knob: 'cream', label: 'script', led: '#45d0ff' },
  worklets: { 'hermit-harm': HERM_SRC },
  trim: 0,
  knobs: [{ key: 'int', label: 'INTERVAL', opts: ['3RD', '5TH', '6TH'], def: 0 }, { key: 'dir', label: 'VOICE', opts: ['ABOVE', 'BELOW'], def: 0 }, ['mix', 'HARMONY', 0, 10, 6]],
  build(c, k) {
    const n = k.worklet('hermit-harm', PP_MONO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(1), wet = k.G(0);
    k.chain(input, dry, output); k.chain(input, n, wet, output);
    const key = ppParam(n, 'key');
    let last = -1;
    const keyNow = () => { const kk = ppKey(); if (kk !== last) { last = kk; key.setValueAtTime(kk, c.currentTime); } };
    ppPoll(c, k, keyNow);
    return { input, output, node: n, set(v, x) {
      keyNow();
      ppParam(n, 'steps').setValueAtTime(HERM_STEPS[v.int] || 2, x.t); ppParam(n, 'dir').setValueAtTime(v.dir ? -1 : 1, x.t);
      x.to(wet.gain, (v.mix / 10) * 0.85); x.to(dry.gain, 1 - v.mix * 0.025);
    } };
  },
});

/* ============================================================ SLIPPERY EEL: portamento */
// It tracks your note and, when it changes, starts the new one at the old pitch and glides it over: every note change
// becomes a slide. LEGATO glides only between notes you don't pick (hammer-ons, pull-offs, slides). The glide's
// intervals are exact; vibrato passes straight through. At rest it's the dry note.
const EEL_SRC = ppSrc('eelslide-glide', `
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('glide', 0.15, 0.01, 2), P('legato', 0, 0, 1)]; }
  constructor() {
    super(); const sr = sampleRate; this.sr = sr;
    this.L = new Line(8192); this.sh = new Shift(sr, 900); this.pt = new Pitch(sr, 4); this.nt = new Note(); this.on = new Onset(sr);
    this.off = 0; this.picked = false;
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const dec = Math.exp(-1 / (p.glide[0] * this.sr)), leg = p.legato[0] > 0.5, L = this.L, nt = this.nt;
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      if (this.on.tick(x)) this.picked = true;
      if (this.pt.push(x) && this.pt.ok) {
        const was = nt.n;
        if (nt.see(this.pt.midi)) {
          if (was >= 0 && !(leg && this.picked)) { this.off += was - nt.n; if (this.off > 24) this.off = 24; else if (this.off < -24) this.off = -24; }
          else this.off = 0;
          this.picked = false;
        }
      }
      this.off *= dec;
      const a = this.off < 0 ? -this.off : this.off, u = a >= 0.4 ? 1 : a * 2.5, y = this.sh.tick(L, Math.pow(2, this.off / 12));
      o[n] = u * y + (1 - u) * x;
    }
    return true;
  }
}`);
pedalDef({
  id: 'eelslide', name: 'Slippery Eel', kind: 'PORTAMENTO', cat: 'pitch', where: 'pre',
  color: '#0f5c46', ink: '#c8ffe8', nod: 'the glide knob on a monophonic synth, for guitar',
  blurb: 'Every note slides into the next, like a synth lead',
  look: { shape: 'mini', finish: 'flat', knob: 'chicken', label: 'script', led: '#9dff5c' },
  worklets: { 'eelslide-glide': EEL_SRC },
  latency: 0, // (at rest it's the dry note; mid-glide the shifted one is about 16 ms behind)
  trim: 0,
  knobs: [['glide', 'GLIDE', 0, 10, 6, 0, (v) => Math.round(1000 * 0.02 * Math.pow(40, v / 10)) + ' ms'], { key: 'legato', label: 'SLIDE ON', opts: ['ALL', 'LEGAT'], def: 0 }],
  build(c, k) {
    const n = k.worklet('eelslide-glide', PP_MONO);
    if (!n) return ppWire(k);
    return { input: n, output: n, node: n, set(v, x) {
      x.to(ppParam(n, 'glide'), 0.02 * Math.pow(40, v.glide / 10) / 3); // (the time constant: the glide's mostly done in 3 of them)
      ppParam(n, 'legato').setValueAtTime(v.legato, x.t);
    } };
  },
});

/* ============================================================ SHIPWRECK: the gravity drop (weird) */
// Every note you pick starts in tune and sinks, slowly then faster, like a tape machine dying, with a little wow as it
// goes. UP makes it a tape spinning up instead. It retriggers on each pick attack.
const WRECK_SRC = ppSrc('shipwreck-grav', `
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('drop', 3, 0, 24), P('time', 1.5, 0.1, 10), P('dir', -1, -1, 1)]; }
  constructor() {
    super(); const sr = sampleRate; this.dt = 1 / sr;
    this.L = new Line(8192); this.sh = new Shift(sr, 1024); this.on = new Onset(sr); this.t = 0; this.live = false;
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const drop = p.drop[0], T = p.time[0], dir = p.dir[0] < 0 ? -1 : 1, L = this.L;
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      if (this.on.tick(x)) { this.t = 0; this.live = true; } else this.t += this.dt;
      let s = 0;
      if (this.live) {
        const f = this.t >= T ? 1 : this.t / T;
        s = dir * drop * (Math.pow(f, 1.7) + 0.06 * f * Math.sin(5.6 * this.t)); // (the sag, and wow that grows with it)
      }
      const a = s < 0 ? -s : s, u = a >= 0.4 ? 1 : a * 2.5, y = this.sh.tick(L, Math.pow(2, s / 12));
      o[n] = u * y + (1 - u) * x;
    }
    return true;
  }
}`);
pedalDef({
  id: 'shipwreck', name: 'Shipwreck', kind: 'GRAVITY DROP', cat: 'pitch', where: 'pre',
  color: '#8a4b2a', ink: '#ffe7c9', nod: 'a tape machine with its motor dying',
  blurb: 'Every note sinks as it rings, like a dying tape deck',
  look: { shape: 'round', finish: 'hammer', knob: 'cream', label: 'stencil', led: '#ffb347' },
  worklets: { 'shipwreck-grav': WRECK_SRC },
  latency: 0.0178, // (the shifter's, once a note has started to sink; in tune, it's the dry note)
  trim: 0,
  knobs: [['drop', 'DROP', 0, 24, 3, 1, ppSemi], ['time', 'TIME', 0, 10, 4, 0, (v) => (0.2 * Math.pow(30, v / 10)).toFixed(1) + ' s'], { key: 'dir', label: 'GRAVITY', opts: ['DOWN', 'UP'], def: 0 }],
  build(c, k) {
    const n = k.worklet('shipwreck-grav', PP_MONO);
    if (!n) return ppWire(k);
    return { input: n, output: n, node: n, set(v, x) {
      x.to(ppParam(n, 'drop'), v.drop); x.to(ppParam(n, 'time'), 0.2 * Math.pow(30, v.time / 10));
      ppParam(n, 'dir').setValueAtTime(v.dir ? 1 : -1, x.t);
    } };
  },
});

/* ============================================================ MERMAID CHOIR: the choir (weird) */
// Two octave-up voices a few cents apart, one each side, plus a quiet second octave for air, swelling in behind each
// note, then sung through vowel formants: the guitar hums along an octave up, like a choir behind you.
const SIREN_SRC = ppSrc('mermaid-choir', `
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('air', 0.3, 0, 1), P('swell', 0.25, 0.005, 3)]; }
  constructor() {
    super(); const sr = sampleRate, s = sr / 48000;
    this.L = new Line(8192); this.a = new Shift(sr, 768); this.b = new Shift(sr, 768); this.b.base = Math.round(0.004 * sr); this.b.p0 = 0.3; this.b.p1 = 0.8; this.c = new Shift(sr, 768);
    this.ra = Math.pow(2, 1 - 7 / 1200); this.rb = Math.pow(2, 1 + 7 / 1200);
    this.ef = 0; this.es = 0; this.fa = 1 - Math.exp(-1 / (0.002 * sr)); this.rel = 1 - Math.exp(-1 / (0.35 * sr)); this.sr = sr;
  }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const air = p.air[0], sa = 1 - Math.exp(-1 / (p.swell[0] * this.sr)), L = this.L;
    for (let n = 0; n < oL.length; n++) {
      const x = i ? i[n] : 0, ax = x < 0 ? -x : x;
      L.push(x);
      this.ef += (ax - this.ef) * (ax > this.ef ? this.fa : this.rel);
      this.es += (ax - this.es) * (ax > this.es ? sa : this.rel);
      const g = this.es >= this.ef ? 1 : this.es / (this.ef + 1e-6); // (a slow envelope over a fast one: each note swells in)
      const c = air > 1e-4 ? 0.7 * air * this.c.tick(L, 4) : 0;
      oL[n] = g * (this.a.tick(L, this.ra) + c); oR[n] = g * (this.b.tick(L, this.rb) + c);
    }
    return true;
  }
}`);
// formants (Hz) of a sung ah, oh, oo: VOWEL morphs along them
const SIREN_VOW = [[800, 1150, 2900], [450, 800, 2830], [325, 700, 2700]];
pedalDef({
  id: 'mermaid', name: 'Mermaid Choir', kind: 'CHOIR · OCT UP', cat: 'pitch', where: 'post', stereo: true,
  color: '#8fe3c8', ink: '#0d2b24', nod: 'an octave-up shimmer through a vocal formant filter',
  blurb: 'A choir of mermaids hums your notes an octave up',
  look: { shape: 'box', finish: 'sparkle', knob: 'chrome', label: 'script', led: '#ffffff' },
  worklets: { 'mermaid-choir': SIREN_SRC },
  trim: 0,
  knobs: [['mix', 'CHOIR', 0, 10, 5], ['vowel', 'VOWEL', 0, 10, 3, 0, (v) => (v < 2.5 ? 'AH' : v < 7.5 ? 'OH' : 'OO')], ['air', 'AIR', 0, 10, 3], ['swell', 'SWELL', 0, 10, 4]],
  build(c, k) {
    const n = k.worklet('mermaid-choir', PP_STEREO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(1), wet = k.G(0), body = k.G(0.3);
    k.chain(input, dry, output);
    const fs = [k.F('bandpass', 800, 6), k.F('bandpass', 1150, 7), k.F('bandpass', 2900, 8)], fg = [k.G(1), k.G(0.6), k.G(0.35)];
    const hp = k.chain(n, k.F('highpass', 180, 0));
    input.connect(n);
    fs.forEach((f, j) => k.chain(hp, f, fg[j], wet));
    k.chain(hp, body, wet); // (a little of the voice unfiltered, so it isn't thin)
    wet.connect(output);
    return { input, output, node: n, set(v, x) {
      const t = (v.vowel / 10) * 2, j = Math.min(1, Math.floor(t)), f = t - j;
      fs.forEach((b, q) => x.to(b.frequency, SIREN_VOW[j][q] + (SIREN_VOW[j + 1][q] - SIREN_VOW[j][q]) * f));
      x.to(ppParam(n, 'air'), v.air / 10); x.to(ppParam(n, 'swell'), 0.01 + 0.12 * v.swell * v.swell / 10);
      x.to(wet.gain, (v.mix / 10) * 2.2); x.to(dry.gain, 1 - v.mix * 0.03);
    } };
  },
});

/* ============================================================ NEON SQUID: the guitar synth */
// The note squared up (a comparator with hysteresis on the filtered string) clocks an oscillator: a saw or a square
// locked to what you play (band-limited, so it doesn't fizz), or a square an octave down. It follows your picking's
// level, and goes through a resonant low-pass the pick attack sweeps: HARD is a bright blip that closes, SOFT swells
// in, filter and volume both, like a bowed synth. Single notes; chords make it sputter.
const SQUID_SRC = ppSrc('neonsquid-synth', `
function blep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('wave', 1, 0, 2), P('att', 0, 0, 1), P('cut', 400, 60, 8000), P('res', 0.5, 0, 1), P('env', 0.6, 0, 1)]; }
  constructor() {
    super(); const sr = sampleRate; this.sr = sr;
    this.dv = new Div(sr); this.inc = 0; this.ph = 0; this.ph2 = 0; this.ff = false;
    this.env = 0; this.er = 1 - Math.exp(-1 / (0.12 * sr));
    this.on = new Onset(sr); this.fe = 0; this.stage = 0;
    this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.cc = 0;
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const sr = this.sr, wave = Math.round(p.wave[0]), soft = p.att[0] > 0.5, cut = p.cut[0], k = 2 - 1.86 * p.res[0], depth = p.env[0] * 5;
    const ea = 1 - Math.exp(-1 / ((soft ? 0.18 : 0.004) * sr)), fa = 1 - Math.exp(-1 / ((soft ? 0.3 : 0.001) * sr)), fd = 1 - Math.exp(-1 / ((soft ? 0.7 : 0.25) * sr));
    for (let n = 0; n < o.length; n++) {
      const x = i[n];
      // the tracker: each period of the string nudges the oscillator
      if (this.dv.tick(x) && this.dv.per) {
        const want = 1 / this.dv.per;
        this.inc = this.inc > 0 && Math.abs(want / this.inc - 1) < 0.06 ? this.inc + (want - this.inc) * 0.5 : want;
        // (a soft sync: the oscillator's phase pulled towards the string's, so it stays locked without a hard reset)
        const e = this.ph > 0.5 ? this.ph - 1 : this.ph; this.ph -= e * 0.3; if (this.ph < 0) this.ph += 1;
        this.ff = !this.ff;
        if (this.ff) { const e2 = this.ph2 > 0.5 ? this.ph2 - 1 : this.ph2; this.ph2 -= e2 * 0.3; if (this.ph2 < 0) this.ph2 += 1; }
      }
      // the oscillator
      let y = 0;
      const dt = this.inc;
      if (dt > 0) {
        this.ph += dt; if (this.ph >= 1) this.ph -= 1;
        this.ph2 += dt * 0.5; if (this.ph2 >= 1) this.ph2 -= 1;
        if (wave === 0) { const t = this.ph; let t2 = t + 0.5; if (t2 >= 1) t2 -= 1; y = (t < 0.5 ? 1 : -1) + blep(t, dt) - blep(t2, dt); y *= 0.7; }
        else if (wave === 1) y = 2 * this.ph - 1 - blep(this.ph, dt);
        else { const t = this.ph2, d2 = dt * 0.5; let t2 = t + 0.5; if (t2 >= 1) t2 -= 1; y = (t < 0.5 ? 1 : -1) + blep(t, d2) - blep(t2, d2); y *= 0.75; }
      }
      // the level: your picking (a fast or a slow attack)
      const ax = x < 0 ? -x : x;
      this.env += (ax - this.env) * (ax > this.env ? ea : this.er);
      // the filter's envelope: up on the pick, then down to a third
      if (this.on.tick(x)) this.stage = 1;
      if (this.stage === 1) { this.fe += (1.05 - this.fe) * fa; if (this.fe >= 1) { this.fe = 1; this.stage = 2; } }
      else this.fe += (0.3 * Math.min(1, this.env * 20) - this.fe) * fd;
      if (--this.cc <= 0) {
        this.cc = 8;
        let fc = cut * Math.pow(2, depth * this.fe); if (fc > 0.42 * sr) fc = 0.42 * sr;
        const g = Math.tan((Math.PI * fc) / sr);
        this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
      }
      const v3 = y - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
      this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
      let z = v2 * this.env * 6;
      z = z > 3 ? 1 : z < -3 ? -1 : (z * (27 + z * z)) / (27 + 9 * z * z); // (a soft clip, driven: synth-steady, and the resonance can't run away)
      o[n] = z * 0.3;
    }
    return true;
  }
}`);
pedalDef({
  id: 'neonsquid', name: 'Neon Squid', kind: 'GUITAR SYNTH', cat: 'synth', where: 'pre',
  color: '#15121f', ink: '#ff3df2', nod: 'the 80s guitar synthesizer: a string-driven oscillator and a resonant filter',
  blurb: 'Your guitar as an 80s synth lead: saws, squares, a filter',
  look: { shape: 'rack', finish: 'brushed', knob: 'small', label: 'block', led: '#00f0ff' },
  worklets: { 'neonsquid-synth': SQUID_SRC },
  trim: 5.4, // (the synth is voiced mid-forward and its peaks are the pick; measured: clean and punk within 1 LU of each other)
  knobs: [{ key: 'wave', label: 'WAVE', opts: ['SQR', 'SAW', 'SUB'], def: 1 }, { key: 'att', label: 'ATTACK', opts: ['HARD', 'SOFT'], def: 0 },
    ['cut', 'FILTER', 0, 10, 7], ['res', 'RESO', 0, 10, 6], ['env', 'ENV', 0, 10, 3], ['mix', 'MIX', 0, 10, 5]],
  build(c, k) {
    const n = k.worklet('neonsquid-synth', PP_MONO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(0.2), wet = k.G(1);
    k.chain(input, dry, output);
    // (voiced as a lead: the low end thinned and the mids lifted, so it cuts through the amp instead of booming)
    k.chain(input, n, k.F('highpass', 240, 0), k.F('peaking', 1300, 0.8, 5), wet, output);
    return { input, output, node: n, set(v, x) {
      ppParam(n, 'wave').setValueAtTime(v.wave, x.t); ppParam(n, 'att').setValueAtTime(v.att, x.t);
      x.to(ppParam(n, 'cut'), 90 * Math.pow(2, v.cut * 0.6)); // 90 Hz to 5.8 kHz, before the envelope opens it
      x.to(ppParam(n, 'res'), v.res / 10); x.to(ppParam(n, 'env'), v.env / 10);
      x.to(wet.gain, v.mix / 10); x.to(dry.gain, 1 - v.mix / 10);
    } };
  },
});

/* ============================================================ ICEBERG: freeze */
// Strike a chord and it's caught: 60 ms after the pick (past the attack) it records 0.4 s, and plays it back as a
// cloud of overlapping grains from random places in it (sine windows, a seeded shuffle) for as long as SUSTAIN says,
// forever at 10. EVERY catches each new chord and crossfades to it (FADE); FIRST keeps the first until you stomp it
// off. Stomped off, it lets go.
const ICE_SRC = ppSrc('iceberg-freeze', `
class Voice {
  constructor(n, G) { this.buf = new Float32Array(n); this.len = n; this.G = G; this.g = 0; this.gt = 0; this.s = [0, 0]; this.k = [0, G >> 1]; }
  read(rng) {
    let y = 0;
    for (let h = 0; h < 2; h++) {
      const k = this.k[h];
      y += this.buf[this.s[h] + k] * SIN[((k * 1024) / this.G) | 0];
      if (++this.k[h] >= this.G) { this.k[h] = 0; this.s[h] = Math.floor(rng() * (this.len - this.G)); }
    }
    return y;
  }
}
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('sus', 5, 0, 40), P('fade', 0.5, 0.02, 4), P('catch', 0, 0, 1)]; }
  constructor() {
    super(); const sr = sampleRate; this.sr = sr;
    this.N = Math.round(0.4 * sr); this.cap = new Float32Array(this.N); this.pos = -1; this.wait = 0;
    const G = Math.round(0.26 * sr); this.v = [new Voice(this.N, G), new Voice(this.N, G)];
    this.on = new Onset(sr); this.have = false; this.lvl = 0; this.seed = 12345;
    this.rng = () => { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; };
  }
  process(ins, outs, p) {
    const o = outs[0][0];
    if (!o) return true;
    const i = ins[0] && ins[0][0];
    if (!i) { // (unfed: stomped off a moment ago. Let go of everything)
      this.have = false; this.pos = -1; this.wait = 0; this.v[0].g = this.v[1].g = this.v[0].gt = this.v[1].gt = 0; o.fill(0); return true;
    }
    const dg = Math.pow(10, -p.sus[0] / 20 / this.sr), fc = 1 - Math.exp(-1 / (p.fade[0] * this.sr)), first = p.catch[0] > 0.5, V = this.v;
    for (let n = 0; n < o.length; n++) {
      const x = i[n];
      if (this.on.tick(x) && !(first && this.have) && this.pos < 0) this.wait = Math.round(0.06 * this.sr);
      if (this.wait > 0 && --this.wait === 0) this.pos = 0;
      if (this.pos >= 0) {
        this.cap[this.pos++] = x;
        if (this.pos >= this.N) { // caught: into the quieter voice, which fades up as the other fades out
          this.pos = -1;
          const q = V[0].g <= V[1].g ? 0 : 1, a = V[q], b = V[1 - q];
          a.buf.set(this.cap); a.gt = 1; b.gt = 0; a.s[0] = 0; a.s[1] = Math.floor(this.rng() * (this.N - a.G)); a.k[0] = 0; a.k[1] = a.G >> 1;
          this.have = true; this.lvl = 1;
        }
      }
      this.lvl *= dg;
      let y = 0;
      for (let q = 0; q < 2; q++) { const w = V[q]; w.g += (w.gt - w.g) * fc; if (w.g > 1e-5) y += w.g * w.read(this.rng); }
      o[n] = y * this.lvl;
    }
    return true;
  }
}`);
pedalDef({
  id: 'iceberg', name: 'Iceberg', kind: 'FREEZE · SUSTAIN', cat: 'synth', where: 'post', drone: true,
  color: '#dff4fb', ink: '#0b3a55', nod: 'the freeze pedal that holds a chord forever',
  blurb: 'Freezes the chord you strike into an endless pad',
  look: { shape: 'box', finish: 'brushed', knob: 'chrome', label: 'plate', led: '#62d6ff' },
  worklets: { 'iceberg-freeze': ICE_SRC },
  tail: 0,
  trim: 0,
  knobs: [['sus', 'SUSTAIN', 0, 10, 6, 0, (v) => (v >= 10 ? '∞' : Math.round(60 / (30 * Math.pow(1 - v / 10, 2))) + ' s')], // (how long it takes to fall 60 dB)
    ['fade', 'FADE', 0, 10, 4, 0, (v) => { const t = 0.03 * Math.pow(100, v / 10); return t < 1 ? Math.round(t * 1000) + 'ms' : t.toFixed(1) + 's'; }],
    ['level', 'LEVEL', 0, 10, 6], { key: 'catch', label: 'CATCH', opts: ['EVERY', 'FIRST'], def: 0 }],
  build(c, k) {
    const n = k.worklet('iceberg-freeze', PP_MONO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), wet = k.G(0.6);
    k.chain(input, output); k.chain(input, n, wet, output);
    return { input, output, node: n, set(v, x) {
      x.to(ppParam(n, 'sus'), 30 * Math.pow(1 - v.sus / 10, 2)); x.to(ppParam(n, 'fade'), 0.03 * Math.pow(100, v.fade / 10) / 3);
      ppParam(n, 'catch').setValueAtTime(v.catch, x.t);
      x.to(wet.gain, v.level / 10);
    } };
  },
});

/* ============================================================ CRABPEGGIO: the random arpeggiator (weird) */
// It plays the note you're holding back in 16ths (or 8ths, or triplets), each one at a random interval of the song's
// key (a 5th, an octave, a 3rd... SPREAD says how wild), gated short. The pattern is a seeded shuffle that repeats
// every bar, so it's a riff, not noise; SEED picks another. While the band plays it locks to the band's bar lines.
const ARP_SRC = ppSrc('crabpeggio-arp', `
const POOL = [0, 4, 7, 2, 5, 9, -3, 11, -7, 14]; // (scale steps, the tamest first)
class PPProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('key', 0, 0, 11), P('step', 0.125, 0.02, 2), P('gate', 0.5, 0.05, 1), P('spread', 0.4, 0, 1), P('seed', 0, 0, 99), P('per', 16, 1, 64)]; }
  constructor() {
    super(); const sr = sampleRate; this.sr = sr;
    this.L = new Line(8192); this.sh = new Shift(sr, 768); this.pt = new Pitch(sr, 6); this.nt = new Note();
    this.t0 = 0; this.idx = -1e9; this.semis = 0; this.ga = 0; this.gc = 1 - Math.exp(-1 / (0.002 * sr));
    this.port.onmessage = (e) => { if (e.data && typeof e.data.t0 === 'number') this.t0 = e.data.t0; };
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const key = Math.round(p.key[0]), step = p.step[0], gate = p.gate[0], pool = 3 + Math.round(p.spread[0] * (POOL.length - 3)), seed = Math.round(p.seed[0]), per = Math.round(p.per[0]);
    const L = this.L, nt = this.nt, t0 = currentTime - this.t0;
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      if (this.pt.push(x) && this.pt.ok) nt.see(this.pt.midi);
      const pos = (t0 + n / this.sr) / step, idx = Math.floor(pos), f = pos - idx;
      if (idx !== this.idx) {
        this.idx = idx;
        const s = ((idx % per) + per) % per, h = Math.imul((s + 1) ^ Math.imul(seed + 7, 0x2545f491), 0x9e3779b1) >>> 0;
        const st = s === 0 ? 0 : POOL[(h >>> 13) % pool]; // (the bar's first step: your own note, so it's grounded)
        this.semis = dia(nt.n >= 0 ? nt.n : key, key, st);
      }
      this.ga += ((f < gate ? 1 : 0) - this.ga) * this.gc;
      const y = this.sh.tick(L, Math.pow(2, this.semis / 12));
      o[n] = this.ga * (this.semis === 0 ? x : y);
    }
    return true;
  }
}`);
const ARP_RATES = [['16TH', 0.25, 16], ['8TH', 0.5, 8], ['TRIP', 1 / 3, 12]]; // (quarter notes a step, steps a bar)
pedalDef({
  id: 'crabpeggio', name: 'Crabpeggio', kind: 'RANDOM ARP · KEY', cat: 'synth', where: 'pre',
  color: '#ff7a1a', ink: '#1a0c00', nod: 'a synth arpeggiator with its random button stuck on',
  blurb: 'Hold a note: it skitters round the key in 16ths, in time',
  look: { shape: 'wide', finish: 'check', knob: 'black', label: 'block', led: '#39ff14' },
  worklets: { 'crabpeggio-arp': ARP_SRC },
  trim: 2.5,
  knobs: [{ key: 'rate', label: 'RATE', opts: ['16TH', '8TH', 'TRIP'], def: 0 }, ['spread', 'SPREAD', 0, 10, 4], ['gate', 'GATE', 0, 10, 5], ['mix', 'MIX', 0, 10, 7], ['seed', 'PATTERN', 0, 9, 0, 1, (v) => '#' + (Math.round(v) + 1)]],
  build(c, k) {
    const n = k.worklet('crabpeggio-arp', PP_MONO);
    if (!n) return ppWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(0.3), wet = k.G(1);
    k.chain(input, dry, output); k.chain(input, n, wet, output);
    const key = ppParam(n, 'key');
    let lastK = -1, lastT = null;
    const sync = () => {
      const kk = ppKey(); if (kk !== lastK) { lastK = kk; key.setValueAtTime(kk, c.currentTime); }
      // the band's current bar line (in this context's time) while it plays: the steps line up with it
      if (typeof PLUG !== 'undefined' && PLUG.clock && PLUG.clock.playing()) {
        const t0 = PLUG.clock.barTime(Math.floor(PLUG.clock.bar()));
        if (Number.isFinite(t0) && t0 !== lastT) { lastT = t0; n.port.postMessage({ t0 }); }
      }
    };
    ppPoll(c, k, sync);
    return { input, output, node: n, set(v, x) {
      try { sync(); } catch (e) { /* the app isn't there */ }
      const r = ARP_RATES[v.rate] || ARP_RATES[0];
      x.to(ppParam(n, 'step'), (r[1] * 60) / (x.bpm || 120), 0.001); ppParam(n, 'per').setValueAtTime(r[2], x.t);
      x.to(ppParam(n, 'spread'), v.spread / 10); x.to(ppParam(n, 'gate'), 0.08 + (v.gate / 10) * 0.9); ppParam(n, 'seed').setValueAtTime(v.seed, x.t);
      x.to(wet.gain, (v.mix / 10) * 1.1); x.to(dry.gain, 1 - v.mix / 10);
    } };
  },
});
}
