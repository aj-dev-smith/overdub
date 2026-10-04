// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'krillroll-rep' worklet (pedals/70-glitch.js, the krillroll pedal's), as the code builds it; do not edit, re-run it

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

class KrillRoll extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'slice', defaultValue: 0.25, minValue: 0.05, maxValue: 1, automationRate: 'k-rate' },
    { name: 'chance', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'roll', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'decay', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.N = Math.round(sampleRate * 4); this.buf = new Float32Array(this.N); this.w = 0; this.cell = null; this.ev = 0; this.st = 0; this.len = 1; this.cur = 1; this.pos = 0; this.g = 1; this.m = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const N = this.N, buf = this.buf, bpm = p.bpm[0], spb = (60 / bpm) * sampleRate, db = 1 / spb, sl = p.slice[0];
    const chance = p.chance[0], shrink = 1 - p.roll[0] * 0.5, fall = 1 - p.decay[0] * 0.35, F = Math.round(sampleRate * 0.002), mk = 1 / Math.round(sampleRate * 0.0015);
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const v = x ? x[n] : 0;
      buf[this.w] = v;
      const cell = Math.floor(b);
      if (cell !== this.cell) {
        const first = this.cell === null, r = this.rnd();
        this.cell = cell;
        if (!first && this.ev <= 0 && r < chance) {
          // the slice that ends now, looped for a beat (two when the slice is a whole beat)
          const len = Math.max(F * 4, Math.min(N >> 1, Math.round(sl * spb)));
          this.st = (this.w - len + 1 + N) % N; this.len = this.cur = len; this.pos = 0; this.g = 1;
          this.ev = Math.round(spb * (sl > 0.9 ? 2 : 1));
        }
      }
      let y = 0;
      if (this.ev > 0) {
        const e = Math.min(1, this.pos / F, (this.cur - this.pos) / F, this.ev / F);
        y = buf[(this.st + this.pos) % N] * this.g * e;
        this.ev--;
        if (++this.pos >= this.cur) { this.pos = 0; this.g *= fall; this.cur = Math.max(F * 2 + 8, Math.round(this.len / 16), Math.round(this.cur * shrink)); }
      }
      const t = this.ev > 0 ? 1 : 0;
      this.m += t > this.m ? Math.min(mk, t - this.m) : Math.max(-mk, t - this.m);
      o[n] = v * (1 - this.m) + y * this.m;
      this.w = this.w + 1 === N ? 0 : this.w + 1;
    }
    return true;
  }
}
registerProcessor('krillroll-rep', KrillRoll);