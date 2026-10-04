// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'halojelly-pitch' worklet (pedals/60-time.js, the halojelly pedal's), as the code builds it; do not edit, re-run it
class HaloPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 2, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() { super(); this.b = new Float32Array(16384); this.w = 0; this.ph = 0; this.W = Math.min(12000, Math.round(0.07 * sampleRate)); }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const b = this.b, M = 16383, W = this.W, step = (1 - p.ratio[0]) / W;
    let ph = this.ph, w = this.w;
    for (let n = 0; n < o.length; n++) {
      b[w] = i ? i[n] : 0;
      ph += step; ph -= Math.floor(ph);
      const q2 = ph + 0.5 - Math.floor(ph + 0.5);
      const r1 = w - 2 - ph * W, a1 = Math.floor(r1), f1 = r1 - a1, x1 = b[a1 & M], y1 = b[(a1 + 1) & M];
      const r2 = w - 2 - q2 * W, a2 = Math.floor(r2), f2 = r2 - a2, x2 = b[a2 & M], y2 = b[(a2 + 1) & M];
      o[n] = 0.8 * ((x1 + (y1 - x1) * f1) * Math.sin(Math.PI * ph) + (x2 + (y2 - x2) * f2) * Math.sin(Math.PI * q2));
      w = (w + 1) & M;
    }
    this.ph = ph; this.w = w;
    return true;
  }
}
registerProcessor('halojelly-pitch', HaloPitch);