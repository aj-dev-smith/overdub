// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'modemmantis-dsp' worklet (pedals/70-glitch.js, the modemmantis pedal's), as the code builds it; do not edit, re-run it

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

const TONES = [1070, 1270, 2025, 2225, 1200, 2400, 980, 1180, 1650, 1850, 2100, 1300, 2300];
class ModemMantis extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'screech', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'baud', defaultValue: 8, minValue: 0.5, maxValue: 60, automationRate: 'k-rate' },
    { name: 'pitch', defaultValue: 1, minValue: 0.1, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.ph = 0; this.f = 1200; this.ft = 1200; this.hop = 0; this.e = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const sr = sampleRate, sc = p.screech[0], hopN = sr / p.baud[0], pitch = p.pitch[0], TAU = 6.283185307;
    const gl = 1 - Math.exp(-1 / (0.003 * sr)), at = 1 - Math.exp(-1 / (0.002 * sr)), rl = 1 - Math.exp(-1 / (0.15 * sr));
    for (let n = 0; n < o.length; n++) {
      const v = x ? x[n] : 0, a = Math.abs(v);
      if (--this.hop <= 0) { this.hop = hopN * (0.6 + 0.8 * this.rnd()); this.ft = TONES[Math.floor(this.rnd() * TONES.length)] * pitch; }
      this.f += (this.ft - this.f) * gl;
      this.e += (a - this.e) * (a > this.e ? at : rl);
      this.ph += (TAU * (this.f + sc * v * 4000)) / sr;
      this.ph -= TAU * Math.floor(this.ph / TAU);
      const cr = Math.sin(this.ph);
      o[n] = v * cr * 1.6 + cr * this.e * sc * 0.35;
    }
    return true;
  }
}
registerProcessor('modemmantis-dsp', ModemMantis);