// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'clamshut-gate' worklet (pedals/30-dynfilter.js, the clamshut pedal's), as the code builds it; do not edit, re-run it
class ClamShutGate extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'threshold', defaultValue: -58, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
    { name: 'decay', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
    { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor() { super(); this.e = 0; this.g = 0; this.hold = 0; this.pk = 0; this.x1 = 0; this.y1 = 0; this.isOpen = false; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const sr = sampleRate, chug = p.mode[0] >= 0.5, th = p.threshold[0], off = th <= -99, open = Math.pow(10, th / 20), shut = open * (chug ? 0.6 : 0.5);
    const envRel = Math.exp(-1 / ((chug ? 0.004 : 0.02) * sr)), up = 1 - Math.exp(-1 / ((chug ? 0.0003 : 0.0008) * sr));
    const holdN = (chug ? 0.004 : 0.025) * sr, hpA = Math.exp(-2 * Math.PI * 180 / sr), dec = p.decay[0];
    // the release: CHUG 3 to 33 ms; smart: 20 to 370 ms, times up to 3 by how far over the threshold the note was
    const baseRel = chug ? 0.003 + dec * 0.003 : 0.02 + dec * 0.035;
    const rel = chug ? baseRel : baseRel * (1 + Math.min(2, Math.log2(Math.max(1, this.pk / open)) / 4));
    const down = 1 - Math.exp(-1 / (rel * sr * 0.25));
    for (let n = 0; n < o.length; n++) {
      const x = i[n], hp = hpA * (this.y1 + x - this.x1); this.x1 = x; this.y1 = hp;
      const a = Math.abs(hp) + Math.abs(x) * 0.25;
      this.e = a > this.e ? a : this.e * envRel;
      if (off || this.e > open) { if (!this.isOpen) this.pk = 0; this.isOpen = true; this.hold = holdN; if (this.e > this.pk) this.pk = this.e; }
      else if (this.e < shut) { if (this.hold > 0) this.hold--; else this.isOpen = false; }
      const want = off || this.isOpen ? 1 : 0;
      this.g += (want - this.g) * (want > this.g ? up : down);
      o[n] = x * this.g;
    }
    if (this.y1 < 1e-20 && this.y1 > -1e-20) this.y1 = 0;
    return true;
  }
}
registerProcessor('clamshut-gate', ClamShutGate);