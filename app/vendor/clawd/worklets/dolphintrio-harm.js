// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'dolphintrio-harm' worklet (pedals/80-wish.js, the dolphintrio pedal's), as the code builds it; do not edit, re-run it

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
}
registerProcessor('dolphintrio-harm', WishProc);