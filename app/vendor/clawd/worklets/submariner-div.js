// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'submariner-div' worklet (pedals/20-fuzz.js, the submariner pedal's), as the code builds it; do not edit, re-run it
class SubMarinerDiv extends AudioWorkletProcessor {
  constructor() { super(); this.l1 = 0; this.l2 = 0; this.env = 0; this.hi = false; this.ff = 1; this.sm = 1;
    this.a = 1 - Math.exp(-2 * Math.PI * 500 / sampleRate); this.rel = Math.exp(-1 / (0.05 * sampleRate)); this.e = 1 - Math.exp(-2 * Math.PI * 3000 / sampleRate); }
  process(ins, outs) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); this.env = 0; return true; }
    let { l1, l2, env, hi, ff, sm } = this; const a = this.a, rel = this.rel, e = this.e;
    for (let n = 0; n < o.length; n++) {
      l1 += (i[n] - l1) * a; l2 += (l1 - l2) * a; // (two poles at 500 Hz: find the fundamental)
      const av = l2 < 0 ? -l2 : l2; env = av > env ? av : env * rel;
      const th = env * 0.3;
      if (!hi && l2 > th) { hi = true; ff = -ff; } else if (hi && l2 < -th) hi = false; // (a Schmitt trigger into the flip-flop)
      sm += (ff - sm) * e;
      o[n] = env > 1e-4 ? sm * l2 : 0;
    }
    this.l1 = l1; this.l2 = l2; this.env = env; this.hi = hi; this.ff = ff; this.sm = sm;
    return true;
  }
}
registerProcessor('submariner-div', SubMarinerDiv);