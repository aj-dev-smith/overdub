// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'killerwhale-kill' worklet (pedals/80-wish.js, the killerwhale pedal's), as the code builds it; do not edit, re-run it

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
}
registerProcessor('killerwhale-kill', WishProc);