// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'databend-dsp' worklet (pedals/70-glitch.js, the databend pedal's), as the code builds it; do not edit, re-run it

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

const SPEEDS = [-1, 0.5, 1, 2, -2, -0.5, 1.5, 0.25];
class DataKraken extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'beats', defaultValue: 0.5, minValue: 0.0625, maxValue: 4, automationRate: 'k-rate' },
    { name: 'chaos', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'wild', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.N = Math.round(sampleRate * 4); this.buf = new Float32Array(this.N); this.w = 0; this.cell = null; this.left = 0; this.pos = 0; this.rd = 0; this.sp = 1; this.m = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const N = this.N, buf = this.buf, bpm = p.bpm[0], db = bpm / 60 / sampleRate, sl = p.beats[0], chaos = p.chaos[0], nS = 2 + Math.round(p.wild[0] * 6);
    const F = Math.round(sampleRate * 0.002), mk = 1 / Math.round(sampleRate * 0.0015);
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const v = x ? x[n] : 0;
      buf[this.w % N] = v;
      const cell = Math.floor(b / sl);
      if (cell !== this.cell) {
        const first = this.cell === null, r = this.rnd(), s = SPEEDS[Math.min(nS - 1, Math.floor(this.rnd() * nS))];
        this.cell = cell; this.left = 0;
        if (!first && r < chaos) {
          const len = Math.max(F * 4, Math.min(Math.round(sampleRate * 0.9), Math.round((sl * 60 / bpm) * sampleRate)));
          this.sp = s; this.left = len; this.pos = 0;
          // start where the read never overtakes the write: backwards from now, or far enough back to finish at now
          this.rd = s < 0 ? this.w - 1 : this.w - Math.max(1, s) * len;
        }
      }
      let y = 0;
      if (this.left > 0) {
        const e = Math.min(1, this.pos / F, this.left / F);
        if (this.rd < this.w - N + 4) this.rd = this.w - N + 4;
        if (this.rd < 0) this.rd = 0;
        const i = Math.floor(this.rd), f = this.rd - i, a = buf[i % N], c = buf[(i + 1) % N];
        y = (a + (c - a) * f) * e;
        this.rd = Math.min(this.w, this.rd + this.sp); this.pos++; this.left--;
      }
      const t = this.left > 0 ? 1 : 0;
      this.m += t > this.m ? Math.min(mk, t - this.m) : Math.max(-mk, t - this.m);
      o[n] = v * (1 - this.m) + y * this.m;
      this.w++;
    }
    return true;
  }
}
registerProcessor('databend-dsp', DataKraken);