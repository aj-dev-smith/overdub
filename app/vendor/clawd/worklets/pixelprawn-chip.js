// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'pixelprawn-chip' worklet (pedals/70-glitch.js, the pixelprawn pedal's), as the code builds it; do not edit, re-run it

class GlBase extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const po = (o && o.processorOptions) || {};
    this.s = (po.seed >>> 0) || 1; this.t0 = 0;
    this.port.onmessage = (e) => { if (e.data && Number.isFinite(e.data.t0)) this.t0 = e.data.t0; };
  }
  rnd() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  beat(bpm) { return ((currentFrame / sampleRate - this.t0) * bpm) / 60; }
}

const CHORDS = [[0, 12], [0, 4, 7, 12], [0, 3, 7, 12]];
class PixelPrawn extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'arp', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'chord', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    { name: 'duty', defaultValue: 0.25, minValue: 0.05, maxValue: 0.5, automationRate: 'k-rate' }]; }
  constructor(o) {
    super(o);
    this.db = new Float32Array(1024); this.di = 0; this.acc = 0; this.cnt = 0; this.lp = 0; this.hop = 0; this.yd = new Float32Array(320);
    this.semi = -1; this.env = 0; this.slow = 0; this.ph = 0; this.cell = null; this.step = 0; this.lf = 1; this.nz = 0; this.nb = 0; this.cool = 0; this.nt = 0;
  }
  track() {
    if (this.env < 0.004) return;
    const B = this.db, W = 200, T = 300, s0 = (this.di - (W + T) + 4096) & 1023, d = this.yd;
    let run = 0, found = 0;
    for (let tau = 1; tau < T; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) { const a = B[(s0 + j) & 1023] - B[(s0 + j + tau) & 1023]; sum += a * a; }
      run += sum; d[tau] = run > 0 ? (sum * tau) / run : 1;
      if (tau > 17 && d[tau - 1] < 0.18 && d[tau] > d[tau - 1]) { found = tau - 1; break; }
    }
    if (!found) return;
    const a = d[found - 1], b = d[found], c = d[found + 1], den = a - 2 * b + c, per = found + (den ? (a - c) / (2 * den) : 0);
    const f = sampleRate / 4 / per;
    if (f > 40 && f < 1400) this.semi = Math.round(69 + 12 * Math.log2(f / 440));
  }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const sr = sampleRate, bpm = p.bpm[0], db = bpm / 60 / sr, ab = p.arp[0], ch = CHORDS[Math.round(p.chord[0])] || CHORDS[0], duty = p.duty[0], dc = 2 * duty - 1;
    const at = 1 - Math.exp(-1 / (0.002 * sr)), rl = 1 - Math.exp(-1 / (0.09 * sr)), sk = 1 - Math.exp(-1 / (0.03 * sr)), NB = Math.round(sr * 0.035);
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const v = x ? x[n] : 0, a = Math.abs(v);
      // a quarter-rate copy to track (one-pole low-pass, then the mean of four)
      this.lp += (v - this.lp) * 0.35; this.acc += this.lp;
      if (++this.cnt === 4) { this.db[this.di] = this.acc * 0.25; this.di = (this.di + 1) & 1023; this.acc = 0; this.cnt = 0; if (++this.hop >= 256) { this.hop = 0; this.track(); } }
      this.env += (a - this.env) * (a > this.env ? at : rl);
      this.slow += (this.env - this.slow) * sk;
      // a pick: the noise channel crunches
      if (this.cool > 0) this.cool--;
      else if (this.env > this.slow * 1.7 + 0.01) { this.nb = NB; this.cool = Math.round(sr * 0.1); }
      if (ab > 0) { const cell = Math.floor(b / ab); if (cell !== this.cell) { this.cell = cell; this.step++; } } else this.step = 0;
      const vol = Math.round(Math.min(1, this.env * 2.5) * 15) / 15;
      let y = 0;
      if (this.semi >= 0) {
        const note = this.semi + 12 + ch[this.step % ch.length];
        this.ph += (440 * Math.pow(2, (note - 69) / 12)) / sr;
        if (this.ph >= 1) this.ph -= Math.floor(this.ph);
        y = ((this.ph < duty ? 1 : -1) - dc) * vol * 0.5;
      }
      if (this.nb > 0) {
        if (--this.nt <= 0) { this.nt = 6; const bit = (this.lf ^ (this.lf >> 1)) & 1; this.lf = (this.lf >> 1) | (bit << 14); this.nz = this.lf & 1 ? 1 : -1; }
        y += this.nz * (this.nb / NB) * vol * 0.35; this.nb--;
      }
      o[n] = y;
    }
    return true;
  }
}
registerProcessor('pixelprawn-chip', PixelPrawn);