// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'clawd-gate' worklet (pedals.js, the gate's PLUG_GATE), as the code builds it; do not edit, re-run it
class ClawdGate extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'threshold', defaultValue: -62, minValue: -100, maxValue: 0, automationRate: 'k-rate' }]; }
  constructor() { super(); this.env = 0; this.g = 0; this.hold = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const th = p.threshold[0], open = Math.pow(10, th / 20), shut = open * 0.5, off = th <= -99;
    const rel = Math.exp(-1 / (0.06 * sampleRate)), up = 1 - Math.exp(-1 / (0.001 * sampleRate)), down = 1 - Math.exp(-1 / (0.07 * sampleRate)), holdN = 0.05 * sampleRate;
    for (let n = 0; n < o.length; n++) {
      const a = Math.abs(i[n]);
      this.env = a > this.env ? a : this.env * rel;
      if (off || this.env > open) this.hold = holdN;
      else if (this.env < shut && this.hold > 0) this.hold--;
      const want = off || this.hold > 0 ? 1 : 0;
      this.g += (want - this.g) * (want > this.g ? up : down);
      o[n] = i[n] * this.g;
    }
    return true;
  }
}
registerProcessor('clawd-gate', ClawdGate);