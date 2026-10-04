// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'jellyswell-swell' worklet (pedals/30-dynfilter.js, the jellyswell pedal's), as the code builds it; do not edit, re-run it
class JellySwell extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'attack', defaultValue: 0.3, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    { name: 'sens', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'k-rate' }]; }
  constructor() { super(); this.f = 0; this.s = 0; this.r = 1; this.g = 1; this.since = 1e9; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const sr = sampleRate, att = p.attack[0], on = att > 0.005, step = on ? 1 / (att * sr) : 1;
    const floor = Math.pow(10, (-66 + p.sens[0] * 3) / 20), jump = 2.2 - p.sens[0] * 0.08, gap = 0.07 * sr;
    const fa = 1 - Math.exp(-1 / (0.001 * sr)), fr = 1 - Math.exp(-1 / (0.012 * sr)), sa = 1 - Math.exp(-1 / (0.06 * sr)), sr2 = 1 - Math.exp(-1 / (0.25 * sr));
    const duck = 1 - Math.exp(-1 / (0.003 * sr));
    for (let n = 0; n < o.length; n++) {
      const a = Math.abs(i[n]);
      this.f += (a - this.f) * (a > this.f ? fa : fr);
      this.s += (a - this.s) * (a > this.s ? sa : sr2);
      this.since++;
      if (on && this.f > floor && this.f > this.s * jump && this.since > gap) { this.r = 0; this.since = 0; }
      if (this.r < 1) this.r = Math.min(1, this.r + step);
      const t = on ? this.r * this.r * (3 - 2 * this.r) : 1;
      this.g = t < this.g ? this.g + (t - this.g) * duck : t;
      o[n] = i[n] * this.g;
    }
    return true;
  }
}
registerProcessor('jellyswell-swell', JellySwell);