// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'tapesnail-vs' worklet (pedals/70-glitch.js, the tapesnail pedal's), as the code builds it; do not edit, re-run it

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

class TapeSnail extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'stop', defaultValue: 1, minValue: 0.0625, maxValue: 4, automationRate: 'k-rate' },
    { name: 'spin', defaultValue: 0.25, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    { name: 'auto', defaultValue: 0, minValue: 0, maxValue: 64, automationRate: 'k-rate' },
    { name: 'hold', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.N = Math.round(sampleRate * 6); this.buf = new Float32Array(this.N); this.w = 0; this.rd = 0; this.sp = 1; this.dir = 1; this.xf = 1; this.lp = -1; this.brk = false; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const N = this.N, buf = this.buf, bpm = p.bpm[0], spbS = 60 / bpm, db = bpm / 60 / sampleRate;
    const stopB = p.stop[0], dec = 1 / Math.max(64, stopB * spbS * sampleRate), inc = p.spin[0] > 0.01 ? 1 / (p.spin[0] * spbS * sampleRate) : 1;
    const per = p.auto[0], hold = p.hold[0] > 0.5, xinc = 1 / (0.006 * sampleRate);
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const v = x ? x[n] : 0, wi = this.w % N;
      buf[wi] = v;
      // AUTO: brake stop beats before the end of every per beats; let go on the bar line
      if (per > 0) {
        const ph = ((b % per) + per) % per, at = per - stopB;
        if (this.lp >= 0) { if (this.lp < at && ph >= at) this.brk = true; if (ph < this.lp) this.brk = false; }
        this.lp = ph;
      } else { this.brk = false; this.lp = -1; }
      const want = hold || this.brk ? -1 : 1;
      if (want !== this.dir) {
        if (want < 0 && this.xf >= 1) { this.rd = this.w; this.xf = 0; } // (from the live signal: the tape is it, so no seam)
        if (want > 0 && this.sp <= 0) this.rd = this.w; // (from a standstill: spin up on what's coming in now)
        this.dir = want;
      }
      this.sp = this.dir < 0 ? Math.max(0, this.sp - dec) : Math.min(1, this.sp + inc);
      let tape = 0;
      if (this.xf < 1) {
        if (this.w - this.rd > N - 4) this.rd = this.w - N + 4;
        const i = Math.floor(this.rd), f = this.rd - i, a = buf[i % N], c = buf[(i + 1) % N];
        // (the level falls with the speed at the very end: a stopped reel is silence, not a thump)
        tape = (a + (c - a) * f) * Math.min(1, this.sp * 3);
        this.rd = Math.min(this.w, this.rd + this.sp);
        if (this.dir > 0 && this.sp >= 1) this.xf = Math.min(1, this.xf + xinc);
      }
      o[n] = v * this.xf + tape * (1 - this.xf);
      this.w++;
      if (this.xf >= 1) this.rd = this.w;
    }
    return true;
  }
}
registerProcessor('tapesnail-vs', TapeSnail);