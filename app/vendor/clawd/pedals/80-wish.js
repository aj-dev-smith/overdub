// vendored verbatim from clawd-o-matic/web/pedals/80-wish.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- pedal pack: the wish list. docs/PEDALS.md says how a pack works. */
// The pedals the preset-bank authors reached for and couldn't find: a drop tuner, a double-tracker, a two-voice
// harmonizer in the key, a 12-string, a reverse-gate reverb, a pick-triggered kill switch, a trem-arm bender and an
// expression treadle. Most of them need AudioWorklets. They share a small library (WISH_LIB, pasted into each: every
// processor is its own module), a copy of pedals/50-pitch.js's (a pack's constants are its own, and a processor name
// can only be shared with byte-identical code, so a copy is the honest way to reuse it):
//   Line   a delay line, read at a fractional delay
//   Shift  the two-tap rotating pitch shifter with the correlation splice (see 50-pitch.js). Here it takes a fifth
//          argument, the lowest note its splice search covers (75 Hz by default: one low-E period), so the drop tuner
//          can trade a shorter search for less latency.
//   Onset  a pick-attack detector: a fast envelope jumping over a slow one, with a settable ratio (the sensitivity)
//   Pitch, Note  the YIN tracker and a note that ignores one stray estimate (the harmonizer)
// Everything is deterministic (seeded, never Math.random) and allocates nothing in process().
{
const WISH_LIB = `
const WIN = new Float32Array(1026);
for (let i = 0; i < 1026; i++) { const s = Math.sin((Math.PI * Math.min(i, 1024)) / 1024); WIN[i] = s * s; }
const P = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
const MAJ = [0, 2, 4, 5, 7, 9, 11];
// semitones from midi note n to 'steps' steps up (or down) the major scale of key
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
  constructor(sr, sweep, gmin, gmax, lo) {
    const s = sr / 48000;
    this.D = Math.round((sweep || 1024) * s); this.gmin = Math.round((gmin || 512) * s); this.gmax = Math.round((gmax || 4096) * s);
    this.dmin = Math.round(24 * s); this.S = Math.round(sr / (lo || 75)); this.n = Math.round(sr * 0.008) >> 2;
    this.d0 = this.dmin; this.d1 = this.dmin; this.p0 = 0; this.p1 = 0.5; this.inc = 1 / this.gmax; this.base = 0;
  }
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
class Onset {
  constructor(sr) {
    this.f = 0; this.s = 0; this.hold = 0; this.ref = Math.round(0.07 * sr); this.k = 1.7; this.floor = 0.004;
    this.af = 1 - Math.exp(-1 / (0.0007 * sr)); this.rf = 1 - Math.exp(-1 / (0.02 * sr));
    this.as = 1 - Math.exp(-1 / (0.04 * sr)); this.rs = 1 - Math.exp(-1 / (0.3 * sr));
  }
  tick(x) {
    const a = x < 0 ? -x : x;
    this.f += (a - this.f) * (a > this.f ? this.af : this.rf);
    this.s += (this.f - this.s) * (this.f > this.s ? this.as : this.rs);
    if (this.hold > 0) { this.hold--; return false; }
    if (this.f > this.s * this.k + this.floor) { this.hold = this.ref; return true; }
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
    if (e < W * 1e-6) { this.ok = false; return; }
    let run = 0; d[0] = 1;
    for (let t = 1; t <= T; t++) { let s = 0; for (let j = o; j < o + W; j++) { const u = b[j] - b[j + t]; s += u * u; } run += s; d[t] = run > 0 ? (s * t) / run : 1; }
    let tau = -1;
    for (let t = this.t0; t < T; t++) if (d[t] < 0.18) { while (t + 1 < T && d[t + 1] < d[t]) t++; tau = t; break; }
    if (tau < 1) { this.ok = false; return; }
    const a = d[tau - 1], m = d[tau], c = d[tau + 1], den = a + c - 2 * m, sh = den > 0 ? (0.5 * (a - c)) / den : 0;
    this.f = this.sr / ((tau + sh) * this.D); this.midi = 69 + 12 * Math.log2(this.f / 440); this.ok = true;
  }
}
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
const wishSrc = (name, body) => WISH_LIB + body + `\nregisterProcessor('${name}', WishProc);`;
const WISH_MONO = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
const WISH_STEREO = Object.assign({}, WISH_MONO, { outputChannelCount: [2] });
const wishP = (n, key) => n.parameters.get(key);
// a pedal whose worklet didn't load: a wire
const wishWire = (k) => { const g = k.G(1); return { input: g, output: g, set() {} }; };
const wishLive = (c) => !(typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext);
const wishSemi = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)) + ' st';
const wishRound = (v, n) => Math.max(0, Math.min(n - 1, Math.round(v)));
// The song's key, 0-11 (C = 0), major, the way Hermit Harmony reads it: the key at the bar playing, or the song's.
// (The app's globals: this file loads before app.js, so they're only read when a pedal is set; missing means C.)
function wishKey() {
  try {
    if (typeof song === 'undefined' || !song) return 0;
    const pl = typeof PLUG !== 'undefined' && PLUG.clock && PLUG.clock.playing();
    const k = pl && typeof AR !== 'undefined' && AR.keyAt ? AR.keyAt(song, Math.max(0, PLUG.clock.bar())) : song.key;
    return ((Math.round(+k) % 12) + 12) % 12 || 0;
  } catch (e) { return 0; }
}

/* ============================================================ LOW TIDE: the drop tuner */
// The whole guitar down 1 to 12 semitones, chords and all, 100% wet (a drop tuner has no dry: that would be a
// detuned chorus). Two shifters off one line, and a switch between them: CLEAN (a 1024-sample sweep, grains up to
// 85 ms, a splice search a whole low-E period long: the cleanest chords, 10-18 ms behind) and TIGHT (half the sweep,
// shorter grains, the search cut to an A string's period: 6-10 ms behind, a little more grain on big chords). Small
// drops are the cheapest: at -1 a grain sweeps only 230 samples. FINE is ±50 cents, for tuning to a detuned record.
const LOW_SRC = wishSrc('lowtide-drop', `
class WishProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('semis', -1, -13, 1), P('tight', 0, 0, 1)]; }
  constructor() {
    super(); const sr = sampleRate;
    this.L = new Line(8192); this.a = new Shift(sr, 1024, 512, 4096); this.b = new Shift(sr, 512, 384, 2048, 110);
    this.s = null; this.r = 1; this.w = 0; this.c = 1 - Math.exp(-1 / (0.01 * sr));
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const tgt = p.semis[0], tw = p.tight[0] > 0.5 ? 1 : 0, L = this.L, c = this.c;
    if (this.s === null) { this.s = tgt; this.w = tw; this.r = Math.pow(2, tgt / 12); }
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      if (this.s !== tgt) { this.s += (tgt - this.s) * c; if (Math.abs(tgt - this.s) < 1e-4) this.s = tgt; this.r = Math.pow(2, this.s / 12); }
      if (this.w !== tw) { this.w += (tw - this.w) * c; if (Math.abs(tw - this.w) < 1e-4) this.w = tw; }
      const w = this.w, r = this.r;
      let y = 0;
      if (w < 1) y += (1 - w) * this.a.tick(L, r);
      if (w > 0) y += w * this.b.tick(L, r);
      const s = this.s < 0 ? -this.s : this.s, u = s >= 0.5 ? 1 : s * 2; // (within a quarter tone of unison: the dry note)
      o[n] = u * y + (1 - u) * x;
    }
    return true;
  }
}`);
// the shifter's average delay (s) at a drop: its base, half its sweep, half its search (the numbers in LOW_SRC)
const lowLat = (semis, tight) => {
  const a = 1 - Math.pow(2, semis / 12), D = tight ? 512 : 1024, gmax = tight ? 2048 : 4096, S = 48000 / (tight ? 110 : 75);
  if (Math.abs(semis) < 0.5) return 0;
  const G = Math.max(tight ? 384 : 512, Math.min(gmax, D / a));
  return (24 + (a * G) / 2 + S / 2) / 48000;
};
pedalDef({
  id: 'lowtide', name: 'Low Tide', kind: 'DROP TUNER', cat: 'pitch', where: 'pre',
  color: '#0b2a4a', ink: '#8fe9ff', nod: 'the polyphonic drop-tune pedal that saves you retuning between songs',
  blurb: 'Tune the whole guitar down without touching a peg',
  look: { shape: 'box', finish: 'brushed', knob: 'chrome', label: 'plate', led: '#3df0ff' },
  worklets: { 'lowtide-drop': LOW_SRC },
  latency: lowLat(-1, 0),
  trim: 0,
  knobs: [['drop', 'DROP', -12, -1, -1, 1, wishSemi], ['fine', 'FINE', -50, 50, 0, 1, (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)) + '¢'],
    { key: 'feel', label: 'FEEL', opts: ['CLEAN', 'TIGHT'], def: 0 }],
  build(c, k) {
    const n = k.worklet('lowtide-drop', WISH_MONO);
    if (!n) return wishWire(k);
    let lat = lowLat(-1, 0);
    return { input: n, output: n, node: n, get latency() { return lat; }, set(v, x) {
      const s = Math.round(v.drop) + v.fine / 100;
      x.to(wishP(n, 'semis'), s, 0.02); wishP(n, 'tight').setValueAtTime(v.feel, x.t);
      lat = lowLat(s, v.feel);
    } };
  },
});

/* ============================================================ DOUBLE DORY: the double-tracker (ADT) */
// The studio trick for a double-tracked rhythm without playing it twice: a copy on a delay that wanders like a second
// take. Each copy's delay walks between 2 ms and 2 ms + the span (TIGHT: 30 ms loose, 5 ms tight), at a speed DETUNE
// sets (a delay that moves is a pitch that moves: ±N cents, like varispeed tape), picking a new random target each
// time it gets near one (seeded per instance). No grains, so no warble on chords. 2 VOICES is the pop-punk wall: you on
// the left, the double on the right (WIDTH folds them to the middle). 3 puts you in the middle and a double each side.
// TONE darkens the doubles a little, like a second take on another pickup.
const DORY_SRC = wishSrc('doubledory-adt', `
class WishProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('span', 12, 5, 30), P('cents', 6, 0, 20), P('width', 1, 0, 1), P('voices', 2, 2, 3), P('tone', 6000, 800, 16000)]; }
  constructor(o) {
    super(); const sr = sampleRate, q = (o && o.processorOptions) || {};
    this.sr = sr; this.ms = sr / 1000; this.L = new Line(Math.ceil(sr * 0.04));
    this.seed = (q.seed >>> 0) || 12345;
    this.d = [0, 0]; this.v = [0, 0]; this.t = [0, 0]; this.lp = [0, 0]; this.init = false;
    this.vc = 1 - Math.exp(-1 / (0.08 * sr)); this.kk = 1 / (0.05 * sr);
  }
  rnd() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const lo = 2 * this.ms, span = p.span[0] * this.ms, vmax = Math.max(0.3, p.cents[0]) / 1731, w = p.width[0], three = p.voices[0] > 2.5;
    const a = 1 - Math.exp((-2 * Math.PI * p.tone[0]) / this.sr), L = this.L, d = this.d, v = this.v, t = this.t, lp = this.lp;
    if (!this.init) { this.init = true; for (let q = 0; q < 2; q++) { d[q] = lo + span * (0.3 + 0.4 * q); t[q] = lo + span * this.rnd(); } }
    const gd = three ? 0.75 : 1, gc = three ? 0.8 : 1, pl = 0.5 + 0.5 * w, pr = 0.5 - 0.5 * w;
    for (let n = 0; n < oL.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      for (let q = 0; q < (three ? 2 : 1); q++) {
        const e = t[q] - d[q];
        let want = e * this.kk * vmax * 400; want = want > vmax ? vmax : want < -vmax ? -vmax : want;
        v[q] += (want - v[q]) * this.vc; d[q] += v[q];
        if ((e < 0 ? -e : e) < 0.08 * span + 2) t[q] = lo + span * this.rnd();
        lp[q] += (L.read(d[q]) - lp[q]) * a;
      }
      if (three) {
        const A = gc * lp[0], B = gc * lp[1], D = gd * x;
        oL[n] = D + pl * A + pr * B; oR[n] = D + pr * A + pl * B;
      } else {
        const m = 0.5 * (x + lp[0]), s = 0.5 * (x - lp[0]) * w;
        oL[n] = m + s; oR[n] = m - s;
      }
    }
    return true;
  }
}`);
pedalDef({
  id: 'doubledory', name: 'Double Dory', kind: 'ADT · DOUBLER', cat: 'mod', where: 'post', stereo: true,
  color: '#2e86de', ink: '#fff7c2', nod: 'the automatic double tracking tape trick from sixties studios',
  blurb: 'One rhythm guitar becomes a hard-panned, double-tracked wall',
  look: { shape: 'wide', finish: 'stripe', knob: 'cream', label: 'script', led: '#ffe14d' },
  worklets: { 'doubledory-adt': DORY_SRC },
  latency: 0, // (you're dry on one side; the double is 2-32 ms behind by design)
  trim: 0,
  knobs: [['tight', 'TIGHT', 0, 10, 6, 0, (v) => Math.round(30 - v * 2.5) + ' ms'], ['cents', 'DETUNE', 0, 20, 6, 1, (v) => '±' + Math.round(v) + '¢'],
    ['width', 'WIDTH', 0, 10, 10], ['tone', 'TONE', 0, 10, 6], { key: 'voices', label: 'VOICES', opts: ['2', '3'], def: 0 }],
  build(c, k) {
    const n = k.worklet('doubledory-adt', Object.assign({ processorOptions: { seed: k.seed } }, WISH_STEREO));
    if (!n) return wishWire(k);
    return { input: n, output: n, node: n, set(v, x) {
      x.to(wishP(n, 'span'), 30 - v.tight * 2.5, 0.1); x.to(wishP(n, 'cents'), v.cents); x.to(wishP(n, 'width'), v.width / 10);
      x.to(wishP(n, 'tone'), 1500 * Math.pow(2, v.tone * 0.34)); // 1.5 to 16 kHz
      wishP(n, 'voices').setValueAtTime(v.voices ? 3 : 2, x.t);
    } };
  },
});

/* ============================================================ DOLPHIN TRIO: two harmony voices in the key */
// Hermit Harmony with a second voice: it tracks the note you play and shifts two copies to two intervals of the
// song's key (a 3rd and a 5th above, a 3rd and a 6th, a 3rd below and above...), so one lead line becomes the three-
// guitar harmony. SPREAD pans the voices apart with you in the middle. A chord confuses the tracker: it holds its last
// intervals. The voices are ~16 ms behind; you aren't.
const TRIO_SETS = [['3+5', 2, 4], ['3+6', 2, 5], ['3+8VA', 2, 7], ['5+8VA', 4, 7], ['−3+3', -2, 2], ['−6+3', -5, 2], ['±8VA', -7, 7]];
const TRIO_SRC = wishSrc('dolphintrio-harm', `
class WishProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('s1', 2, -7, 7), P('s2', 4, -7, 7), P('key', 0, 0, 11), P('g1', 0.6, 0, 2), P('g2', 0.6, 0, 2), P('dry', 1, 0, 2), P('spread', 0.7, 0, 1)]; }
  constructor() {
    super(); const sr = sampleRate;
    this.L = new Line(8192); this.a = new Shift(sr, 900); this.b = new Shift(sr, 900); this.b.p0 = 0.25; this.b.p1 = 0.75;
    this.pt = new Pitch(sr, 5); this.nt = new Note();
    this.r1 = 1; this.r2 = 1; this.rc = 1 - Math.exp(-1 / (0.008 * sr)); this.g = 0; this.gc = 1 - Math.exp(-1 / (0.02 * sr));
  }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const s1 = Math.round(p.s1[0]), s2 = Math.round(p.s2[0]), key = Math.round(p.key[0]), L = this.L, nt = this.nt;
    const g1 = p.g1[0], g2 = p.g2[0], dry = p.dry[0], th = 0.7853981634 * p.spread[0];
    // voice 1 to the left, voice 2 to the right (constant power)
    const aL = Math.cos(0.7853981634 - th), aR = Math.sin(0.7853981634 - th), bL = Math.cos(0.7853981634 + th), bR = Math.sin(0.7853981634 + th);
    let t1 = nt.n < 0 ? 1 : Math.pow(2, dia(nt.n, key, s1) / 12), t2 = nt.n < 0 ? 1 : Math.pow(2, dia(nt.n, key, s2) / 12);
    for (let n = 0; n < oL.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      if (this.pt.push(x) && this.pt.ok && nt.see(this.pt.midi)) { t1 = Math.pow(2, dia(nt.n, key, s1) / 12); t2 = Math.pow(2, dia(nt.n, key, s2) / 12); }
      this.r1 += (t1 - this.r1) * this.rc; this.r2 += (t2 - this.r2) * this.rc;
      this.g += ((nt.n < 0 ? 0 : 1) - this.g) * this.gc;
      const g = this.g, v1 = g > 1e-4 ? g * g1 * this.a.tick(L, this.r1) : 0, v2 = g > 1e-4 ? g * g2 * this.b.tick(L, this.r2) : 0, dx = dry * x;
      oL[n] = dx + aL * v1 + bL * v2; oR[n] = dx + aR * v1 + bR * v2;
    }
    return true;
  }
}`);
pedalDef({
  id: 'dolphintrio', name: 'Dolphin Trio', kind: 'DUAL HARMONY · KEY', cat: 'pitch', where: 'pre', stereo: true,
  color: '#9aa7b8', ink: '#10202e', nod: 'the two-voice intelligent harmonizer triple-guitar bands set to the key',
  blurb: 'Play one line, hear three guitars harmonising in the key',
  look: { shape: 'wide', finish: 'sparkle', knob: 'chrome', label: 'block', led: '#7df9ff' },
  worklets: { 'dolphintrio-harm': TRIO_SRC },
  latency: 0, // (you're dry; the two voices are the shifter's ~16 ms behind)
  trim: 0,
  knobs: [['set', 'VOICES', 0, TRIO_SETS.length - 1, 0, 1, (v) => TRIO_SETS[wishRound(v, TRIO_SETS.length)][0]], ['g1', 'VOICE 1', 0, 10, 5], ['g2', 'VOICE 2', 0, 10, 5],
    ['spread', 'SPREAD', 0, 10, 7], ['dry', 'DRY', 0, 10, 8]],
  build(c, k) {
    const n = k.worklet('dolphintrio-harm', WISH_STEREO);
    if (!n) return wishWire(k);
    const key = wishP(n, 'key');
    let last = -1;
    const keyNow = () => { const kk = wishKey(); if (kk !== last) { last = kk; key.setValueAtTime(kk, c.currentTime); } };
    // (the key isn't in the pedal API: read it at set() and, on a live context, every 0.4 s so a key change follows)
    if (wishLive(c)) { const iv = setInterval(() => { try { keyNow(); } catch (e) { /* no app */ } }, 400); k.onDispose(() => clearInterval(iv)); }
    return { input: n, output: n, node: n, set(v, x) {
      keyNow();
      const s = TRIO_SETS[wishRound(v.set, TRIO_SETS.length)];
      wishP(n, 's1').setValueAtTime(s[1], x.t); wishP(n, 's2').setValueAtTime(s[2], x.t);
      x.to(wishP(n, 'g1'), (v.g1 / 10) * 1.2); x.to(wishP(n, 'g2'), (v.g2 / 10) * 1.2);
      x.to(wishP(n, 'dry'), v.dry / 8 * 0.85); x.to(wishP(n, 'spread'), v.spread / 10);
    } };
  },
});

/* ============================================================ JANGLE STARFISH: the 12-string */
// A 12-string's low four courses have an octave string, its top two a unison one. So the guitar's split at SPLIT
// (330 Hz: the top of the G string's fundamentals) by a complementary pair (the low band, and the input minus it): the
// low band goes up an octave (the octave strings, a few cents sharp, as they always are), the high band gets a unison
// double on a slowly moving delay (the second string of the course, never quite in tune). SHIMMER is how far both
// wander. You stay dry in the middle; the octave courses lean right, the unisons left.
const JANG_SRC = wishSrc('jangle-twelve', `
class WishProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('oct', 0.8, 0, 2), P('uni', 0.6, 0, 2), P('shim', 0.5, 0, 1), P('split', 330, 150, 700)]; }
  constructor() {
    super(); const sr = sampleRate; this.sr = sr;
    this.L1 = new Line(8192); this.L2 = new Line(Math.ceil(sr * 0.02)); this.sh = new Shift(sr, 768);
    this.f = -1; this.b0 = 0; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0;
    this.hp = 0; this.hx = 0; this.ah = Math.exp((-2 * Math.PI * 120) / sr);
    this.ph1 = 0; this.ph2 = 0.37; this.i1 = 0.6 / sr; this.i2 = 1.37 / sr; this.ms = sr / 1000;
  }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const f = p.split[0];
    if (f !== this.f) { // (an RBJ low-pass, Q 0.707)
      this.f = f; const w = (2 * Math.PI * f) / this.sr, cs = Math.cos(w), al = Math.sin(w) / (2 * 0.7071), a0 = 1 + al;
      this.b0 = (1 - cs) / 2 / a0; this.b1 = (1 - cs) / a0; this.b2 = this.b0; this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
    }
    const go = p.oct[0], gu = p.uni[0], sm = p.shim[0], L1 = this.L1, L2 = this.L2, TAU = 6.283185307;
    // the octave course: an octave and 2-8 cents sharp, drifting (once a block: it moves slowly)
    const r = 2 * Math.pow(2, (2 + 6 * sm * (0.5 + 0.5 * Math.sin(TAU * this.ph1 * 0.7))) / 1200);
    for (let n = 0; n < oL.length; n++) {
      const x = i ? i[n] : 0;
      const lo = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * lo + this.z2; this.z2 = this.b2 * x - this.a2 * lo;
      L1.push(lo); L2.push(x - lo);
      let y = go > 1e-4 ? this.sh.tick(L1, r) : 0;
      this.hp = this.ah * (this.hp + y - this.hx); this.hx = y; y = this.hp * go;
      this.ph1 += this.i1; if (this.ph1 >= 1) this.ph1 -= 1; this.ph2 += this.i2; if (this.ph2 >= 1) this.ph2 -= 1;
      const d = (5 + sm * (1.3 * Math.sin(TAU * this.ph1) + 0.45 * Math.sin(TAU * this.ph2))) * this.ms;
      const u = gu * L2.read(d);
      oL[n] = 0.75 * y + u; oR[n] = y + 0.75 * u;
    }
    return true;
  }
}`);
pedalDef({
  id: 'jangle', name: 'Jangle Starfish', kind: '12-STRING', cat: 'pitch', where: 'pre', stereo: true,
  color: '#c8102e', ink: '#fff4e0', nod: 'the twelve-string sixties folk-rock jangle, octave courses and all',
  blurb: 'Your six-string rings like a jangly twelve-string',
  look: { shape: 'box', finish: 'flat', knob: 'cream', label: 'script', led: '#ffd166' },
  worklets: { 'jangle-twelve': JANG_SRC },
  latency: 0, // (you're dry; the octave courses are the shifter's ~15 ms behind, the unisons about 5 ms)
  trim: 0,
  knobs: [['oct', 'OCTAVE', 0, 10, 6], ['uni', 'UNISON', 0, 10, 5], ['shim', 'SHIMMER', 0, 10, 4], ['split', 'SPLIT', 0, 10, 5, 0, (v) => Math.round(165 * Math.pow(2, v * 0.2)) + ' Hz']],
  build(c, k) {
    const n = k.worklet('jangle-twelve', WISH_STEREO);
    if (!n) return wishWire(k);
    const input = k.G(1), output = k.G(1), dry = k.G(1);
    k.chain(input, dry, output); k.chain(input, n, output);
    return { input, output, node: n, set(v, x) {
      x.to(wishP(n, 'oct'), (v.oct / 10) * 1.3); x.to(wishP(n, 'uni'), (v.uni / 10) * 1.1); x.to(wishP(n, 'shim'), v.shim / 10);
      x.to(wishP(n, 'split'), 165 * Math.pow(2, v.split * 0.2)); // 165 to 660 Hz
      x.to(dry.gain, 1 - (v.oct + v.uni) * 0.012);
    } };
  },
});

/* ============================================================ UNDERTOW: the reverse-gate reverb */
// The eighties digital reverb's reverse program: a burst of dense reverb whose level RISES over LENGTH and then stops
// dead, so every chord sucks in backwards behind you (the shoegaze wash). GATE flips it into the gated reverb of the
// big eighties snare: full level at once, a slight droop, then cut. A trails pedal, and each IR is its own seeded
// noise (the two channels decorrelated), normalised to the same energy whatever the length, so LENGTH doesn't change
// the level.
const UT_WET = 5.5; // (the convolver normalises its IR quietly: measured, MIX 5 puts the wet about 8 dB under you)
const utLen = (v) => 0.08 * Math.pow(10, v / 10); // 80 to 800 ms
pedalDef({
  id: 'undertow', name: 'Undertow', kind: 'REVERSE GATE VERB', cat: 'ambient', where: 'post', trails: true, stereo: true,
  color: '#1b1035', ink: '#ff8ad8', nod: 'the reverse and gated programs of an eighties digital reverb rack',
  blurb: 'Reverb that swells in backwards, then stops dead',
  look: { shape: 'box', finish: 'hammer', knob: 'black', label: 'stencil', led: '#ff2bd6' },
  trim: 0,
  knobs: [['len', 'LENGTH', 0, 10, 5, 0, (v) => Math.round(1000 * utLen(v)) + ' ms'], ['tone', 'TONE', 0, 10, 5], ['mix', 'MIX', 0, 10, 5],
    { key: 'mode', label: 'MODE', opts: ['REV', 'GATE'], def: 0 }],
  build(c, k) {
    const input = k.G(1), conv = k.convolver(), tone = k.F('lowpass', 6000, -3), wet = k.G(0);
    k.chain(input, k.F('highpass', 160, -3), conv, tone, wet);
    const make = (len, mode) => {
      const sr = c.sampleRate, N = Math.round(len * sr), F = Math.round(0.004 * sr), b = c.createBuffer(2, N + 1, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch), r = k.rng(0x7d0 + ch * 977 + Math.round(len * 100) + mode * 31);
        let lp = 0, e2 = 0;
        for (let i = 0; i < N; i++) {
          const t = i / N;
          lp += (r() - lp) * 0.6; // (a touch of darkening: less fizz)
          const env = mode ? 1 - 0.35 * t : Math.pow(t, 1.8) * (0.2 + 0.8 * t);
          const cut = i > N - F ? (N - i) / F : 1; // (the gate closing: 4 ms, click-free)
          d[i] = lp * env * cut; e2 += d[i] * d[i];
        }
        const g = 1 / Math.sqrt(e2 || 1); for (let i = 0; i < N; i++) d[i] *= g;
      }
      return b;
    };
    let key = null, timer = 0;
    const ir = (len, mode) => {
      const kk = len.toFixed(3) + mode;
      if (kk === key) return;
      key = kk; clearTimeout(timer);
      if (!conv.buffer) conv.buffer = make(len, mode); else timer = k.later(() => (conv.buffer = make(len, mode)), 120);
    };
    return { input, output: wet, set(v, x) {
      ir(utLen(v.len), v.mode);
      x.to(tone.frequency, 1500 * Math.pow(2, v.tone * 0.3)); // 1.5 to 12 kHz
      x.to(wet.gain, v.mix * 0.1 * UT_WET);
    } };
  },
});

/* ============================================================ KILLER WHALE: the pick-triggered kill switch */
// The guitarist's toggle-switch stutter, played for you: every pick attack starts a chop at RATE, open for DUTY of
// each cycle, beginning open so the attack speaks. BURST chops for LENGTH, then lets the note ring. HOLD chops the whole
// note (and each pick restarts it, so the chops line up with your picking). SHOT is the momentary kill: the note gets
// LENGTH, then it's cut until your next pick. Edges are 0.6 ms: hard, not clicky.
const ORCA_SRC = wishSrc('killerwhale-kill', `
class WishProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('rate', 12, 1, 40), P('duty', 0.5, 0.05, 0.95), P('len', 0.4, 0.02, 3), P('mode', 0, 0, 2), P('sens', 5, 0, 10)]; }
  constructor() {
    super(); const sr = sampleRate; this.sr = sr;
    this.on = new Onset(sr); this.t = 0; this.ph = 0; this.armed = false; this.g = 1; this.gc = 1 - Math.exp(-1 / (0.0006 * sr));
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const inc = p.rate[0] / this.sr, duty = p.duty[0], lenS = p.len[0] * this.sr, mode = Math.round(p.mode[0]), s = p.sens[0], on = this.on;
    on.k = 1.25 + (10 - s) * 0.15; on.floor = 0.0015 + (10 - s) * 0.0006;
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      if (on.tick(x)) { this.t = 0; this.ph = 0; this.armed = true; } else { this.t++; this.ph += inc; if (this.ph >= 1) this.ph -= 1; }
      let tgt = 1;
      if (this.armed) {
        const chop = this.ph < duty ? 1 : 0;
        tgt = mode === 0 ? (this.t < lenS ? chop : 1) : mode === 1 ? chop : this.t < lenS ? 1 : 0;
      }
      this.g += (tgt - this.g) * this.gc;
      o[n] = x * this.g;
    }
    return true;
  }
}`);
const orcaHz = (v) => 3 * Math.pow(10, v / 10); // 3 to 30 Hz
const orcaLen = (v) => 0.05 * Math.pow(40, v / 10); // 50 ms to 2 s
pedalDef({
  id: 'killerwhale', name: 'Killer Whale', kind: 'PICK KILL SWITCH', cat: 'glitch', where: 'pre',
  color: '#0d0d0d', ink: '#f5f5f5', nod: 'the toggle-switch stutter of the rap-metal guitar hero, on a pick trigger',
  blurb: 'Every pick attack stutters: machine-gun chops, hands-free',
  look: { shape: 'wide', finish: 'stripe', knob: 'chicken', label: 'block', led: '#ff2020' },
  worklets: { 'killerwhale-kill': ORCA_SRC },
  trim: 0.8,
  knobs: [['rate', 'RATE', 0, 10, 5, 0, (v) => orcaHz(v).toFixed(orcaHz(v) < 10 ? 1 : 0) + ' Hz'], ['duty', 'DUTY', 10, 90, 55, 1, (v) => Math.round(v) + '%'],
    ['len', 'LENGTH', 0, 10, 4, 0, (v) => { const s = orcaLen(v); return s < 1 ? Math.round(s * 1000) + 'ms' : s.toFixed(1) + 's'; }], ['sens', 'SENS', 0, 10, 5],
    { key: 'mode', label: 'MODE', opts: ['BURST', 'HOLD', 'SHOT'], def: 0 }],
  build(c, k) {
    const n = k.worklet('killerwhale-kill', WISH_MONO);
    if (!n) return wishWire(k);
    return { input: n, output: n, node: n, set(v, x) {
      wishP(n, 'rate').setValueAtTime(orcaHz(v.rate), x.t); wishP(n, 'duty').setValueAtTime(v.duty / 100, x.t);
      wishP(n, 'len').setValueAtTime(orcaLen(v.len), x.t); wishP(n, 'mode').setValueAtTime(v.mode, x.t); wishP(n, 'sens').setValueAtTime(v.sens, x.t);
    } };
  },
});

/* ============================================================ BARRACUDA BAR: the trem-arm bender */
// The whammy bar worked for you on every pick: DIP pushes the bar and lets it back (a quick sag and return), SCOOP
// starts each note flat and pulls it up to pitch, SHIMMY flicks the bar so the note flutters and settles, DIVE sinks
// the note, holds it down, then lets the bar spring back with a wobble. DEPTH is how far in semitones, SPEED how fast.
// Chords bend too (the shifter's polyphonic). In tune, it's the dry note; bending, it's the shifter's ~16 ms behind.
const BAR_MODES = ['DIP', 'SCOOP', 'SHIMMY', 'DIVE'];
const BAR_SRC = wishSrc('barracuda-bar', `
class WishProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [P('mode', 0, 0, 3), P('depth', 1, 0, 12), P('time', 0.15, 0.02, 2)]; }
  constructor() {
    super(); const sr = sampleRate; this.dt = 1 / sr;
    this.L = new Line(8192); this.sh = new Shift(sr, 900); this.on = new Onset(sr); this.t = 1e9; this.s = 0; this.sc = 1 - Math.exp(-1 / (0.003 * sr));
  }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const mode = Math.round(p.mode[0]), D = p.depth[0], T = p.time[0], L = this.L, PI = Math.PI;
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      L.push(x);
      if (this.on.tick(x)) this.t = 0; else this.t += this.dt;
      const t = this.t;
      let s = 0;
      if (mode === 0) { if (t < T) s = -D * Math.sin((PI * t) / T); }
      else if (mode === 1) { if (t < T) { const u = 1 - t / T; s = -D * u * u; } }
      else if (mode === 2) { if (t < 8 * T) s = 0.5 * D * Math.sin(2 * PI * t * (1.2 / T > 14 ? 14 : 1.2 / T)) * Math.exp(-t / (2 * T)); }
      else if (t < 3 * T) { const u = t < T ? t / T : 1; s = -D * u * Math.sqrt(u); }
      else if (t < 6 * T) { const u = t - 3 * T; s = -D * Math.exp(-u / (0.35 * T)) * Math.cos((2 * PI * u) / (0.6 * T)); }
      this.s += (s - this.s) * this.sc;
      const a = this.s < 0 ? -this.s : this.s, g = a >= 0.4 ? 1 : a * 2.5;
      o[n] = g > 0 ? g * this.sh.tick(L, Math.pow(2, this.s / 12)) + (1 - g) * x : x;
    }
    return true;
  }
}`);
const barDepth = (v) => 0.25 * Math.pow(48, v / 10); // a quarter tone to an octave
const barTime = (v) => 0.6 * Math.pow(1 / 15, v / 10); // 600 ms (slow) to 40 ms (fast)
pedalDef({
  id: 'barracuda', name: 'Barracuda Bar', kind: 'TREM-ARM BENDER', cat: 'pitch', where: 'pre',
  color: '#b8c4cc', ink: '#1a2b36', nod: 'a floating tremolo bar, dipped, flicked and dived on every note',
  blurb: 'Trem-bar dips, scoops, flutters and dives on every pick',
  look: { shape: 'round', finish: 'brushed', knob: 'black', label: 'script', led: '#ffae00' },
  worklets: { 'barracuda-bar': BAR_SRC },
  latency: 0, // (at rest it's the dry note; mid-bend the shifted one is ~16 ms behind)
  trim: 0,
  knobs: [['mode', 'MODE', 0, BAR_MODES.length - 1, 0, 1, (v) => BAR_MODES[wishRound(v, BAR_MODES.length)]], ['depth', 'DEPTH', 0, 10, 3, 0, (v) => barDepth(v).toFixed(1) + ' st'],
    ['speed', 'SPEED', 0, 10, 5, 0, (v) => Math.round(1000 * barTime(v)) + ' ms']],
  build(c, k) {
    const n = k.worklet('barracuda-bar', WISH_MONO);
    if (!n) return wishWire(k);
    return { input: n, output: n, node: n, set(v, x) {
      wishP(n, 'mode').setValueAtTime(wishRound(v.mode, BAR_MODES.length), x.t);
      x.to(wishP(n, 'depth'), barDepth(v.depth)); x.to(wishP(n, 'time'), barTime(v.speed));
    } };
  },
});

/* ============================================================ GROUND SWELL: the expression treadle */
// A treadle between two settings you choose: HEEL and TOE. In VOL it's a volume pedal (an audio taper: heel 0 is
// silence), in FILT a resonant low-pass (heel 0 is 250 Hz, 10 is wide open), in BOTH the two together, the darker
// the quieter, like rolling a guitar's volume and tone at once. RATE rocks it for you: a slow swell from heel to toe
// and back, one cycle every beat to every four bars, starting at the heel on the band's bar lines (sync).
const SWELL_RATES = [['FOOT', 0], ['1/4', 0.25], ['1/2', 0.5], ['1 BAR', 1], ['2 BAR', 2], ['4 BAR', 4]];
pedalDef({
  id: 'groundswell', name: 'Ground Swell', kind: 'EXPRESSION SWELL', cat: 'filter', where: 'post',
  color: '#2f6f4f', ink: '#f0ffe8', nod: 'the expression pedal, wired to volume and tone with its heel and toe set',
  blurb: 'Rock between two settings: swells, fades, dark to bright',
  look: { shape: 'wah', treadle: 'pos', finish: 'hammer', knob: 'cream', label: 'plate', led: '#8cff66' },
  trim: 0,
  knobs: [['pos', 'TREADLE', 0, 10, 10], ['heel', 'HEEL', 0, 10, 0], ['toe', 'TOE', 0, 10, 10], { key: 'mode', label: 'MODE', opts: ['VOL', 'FILT', 'BOTH'], def: 0 },
    ['rate', 'RATE', 0, SWELL_RATES.length - 1, 0, 1, (v) => SWELL_RATES[wishRound(v, SWELL_RATES.length)][0]]],
  build(c, k) {
    const input = k.G(1), filt = k.F('lowpass', 18000, 2), vca = k.G(1);
    k.chain(input, filt, vca);
    // the treadle, 0 (heel) to 1 (toe): the foot's position (a constant) plus a swell (an oscillator, started on a bar)
    const foot = k.constant(1), ctl = k.G(1), lfoAmt = k.G(0), smooth = k.F('lowpass', 25, 0); // (a restarted swell can't step)
    foot.connect(ctl); lfoAmt.connect(ctl); ctl.connect(smooth);
    const sq = k.curve((x) => (x <= 0 ? 0 : x * x), 'none', 1025); // (the volume's audio taper)
    const vDepth = k.G(0), fDepth = k.G(0);
    vca.gain.value = 1; filt.detune.value = 0;
    k.chain(smooth, sq, vDepth, vca.gain); k.chain(smooth, fDepth, filt.detune);
    let osc = null, hz = 0.5, bars = 0;
    // The swell: -cos over its cycle (at 0 it's at the heel). An oscillator can't be told its phase, so each start
    // gets a wave already turned to where the band's grid is (x.phaseAt): started now, it's in step at once, and a
    // cycle begins on the bar lines (every 2 or 4 bars for the long ones) without waiting for the next one.
    const anchor = (clock) => {
      const at = c.currentTime + 0.005, ph = 2 * Math.PI * (bars > 0 ? clock.phaseAt(at, bars) : 0);
      const wave = c.createPeriodicWave(new Float32Array([0, -Math.cos(ph)]), new Float32Array([0, Math.sin(ph)]), { disableNormalization: true });
      const o = k.own(c.createOscillator()); o.setPeriodicWave(wave); o.frequency.value = hz; o.connect(lfoAmt); o.start(at);
      if (osc) { try { osc.stop(at); } catch (e) { /* already stopped */ } }
      osc = o;
    };
    return { input, output: vca, set(v, x) {
      const r = SWELL_RATES[wishRound(v.rate, SWELL_RATES.length)];
      const was = bars; bars = r[1];
      const auto = bars > 0;
      hz = auto ? (x.bpm || 120) / 60 / (4 * bars) : 0.5;
      if (osc && was !== bars) anchor(x.clock); // (a new cycle length: in step with the grid at once)
      else if (osc) x.to(osc.frequency, hz, 0.001);
      x.to(foot.offset, auto ? 0.5 : v.pos / 10); x.to(lfoAmt.gain, auto ? 0.5 : 0);
      const vol = v.mode !== 1, fil = v.mode !== 0;
      // volume: heel and toe as audio-taper gains; the treadle's squared travel moves between them
      const gh = Math.pow(v.heel / 10, 2), gt = Math.pow(v.toe / 10, 2);
      x.to(vca.gain, vol ? gh : 1); x.to(vDepth.gain, vol ? gt - gh : 0);
      // filter: heel and toe as frequencies (250 Hz to 16 kHz); the travel sweeps between them in cents (exponential)
      const fh = 250 * Math.pow(2, v.heel * 0.6), ft = 250 * Math.pow(2, v.toe * 0.6);
      x.to(filt.frequency, fil ? fh : 20000); x.to(fDepth.gain, fil ? 1200 * Math.log2(ft / fh) : 0);
    },
    sync(x) {
      if (x.why !== 'bar' || !osc) anchor(x.clock); // (a whole number of bars: only a start, jump or tempo moves it)
    } };
  },
});
}
