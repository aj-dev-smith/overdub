// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'hermithold-sh' worklet (pedals/70-glitch.js, the hermithold pedal's), as the code builds it; do not edit, re-run it

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

class HermitHold extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'beats', defaultValue: 0.5, minValue: 0.0625, maxValue: 4, automationRate: 'k-rate' },
    { name: 'slew', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.v = 0; this.t = 0; this.cell = null; }
  process(ins, outs, p) {
    const o = outs[0][0];
    if (!o) return true;
    const bpm = p.bpm[0], sl = p.beats[0], db = bpm / 60 / sampleRate;
    // (never an instant step: a resonant filter jumping clicks. 1.5 ms at least)
    const secs = Math.max(0.0015, p.slew[0] * sl * (60 / bpm) * 0.7), k = 1 - Math.exp(-1 / (secs * sampleRate));
    let b = this.beat(bpm);
    for (let n = 0; n < o.length; n++, b += db) {
      const cell = Math.floor(b / sl);
      if (cell !== this.cell) { this.cell = cell; this.t = this.rnd() * 2 - 1; }
      this.v += (this.t - this.v) * k;
      o[n] = this.v;
    }
    return true;
  }
}
registerProcessor('hermithold-sh', HermitHold);