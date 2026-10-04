// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'bitreef-crush' worklet (pedals/70-glitch.js, the bitreef pedal's), as the code builds it; do not edit, re-run it

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

class BitReef extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bits', defaultValue: 6, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
    { name: 'rate', defaultValue: 8000, minValue: 50, maxValue: 96000, automationRate: 'k-rate' },
    { name: 'jitter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.ph = 0; this.h = 0; this.next = 1; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    if (!x) { o.fill(0); return true; }
    // (the converter sees the guitar about 10 dB hotter than it is: a DI peaks near -10 dBFS, so BITS means bits)
    const q = Math.pow(2, p.bits[0] - 1), inc = Math.min(1, p.rate[0] / sampleRate), j = p.jitter[0];
    for (let n = 0; n < o.length; n++) {
      this.ph += inc;
      if (this.ph >= this.next) { this.ph -= this.next; const v = x[n] * 3; this.h = v > 1 ? 1 : v < -1 ? -1 : v; this.next = 1 + j * (this.rnd() - 0.5) * 1.6; }
      o[n] = Math.round(this.h * q) / (q * 3);
    }
    return true;
  }
}
registerProcessor('bitreef-crush', BitReef);