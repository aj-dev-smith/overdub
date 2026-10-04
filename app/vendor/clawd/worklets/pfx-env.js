// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'pfx-env' worklet (pedals.js, the kit's PFX_ENV), as the code builds it; do not edit, re-run it
class PfxEnv extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'attack', defaultValue: 0.005, minValue: 0.0001, maxValue: 2, automationRate: 'k-rate' }, { name: 'release', defaultValue: 0.12, minValue: 0.001, maxValue: 5, automationRate: 'k-rate' }]; }
  constructor() { super(); this.e = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], inp = ins[0];
    if (!o) return true;
    const a = 1 - Math.exp(-1 / (p.attack[0] * sampleRate)), r = 1 - Math.exp(-1 / (p.release[0] * sampleRate));
    for (let n = 0; n < o.length; n++) {
      let x = 0;
      if (inp) for (let ch = 0; ch < inp.length; ch++) x = Math.max(x, Math.abs(inp[ch][n]));
      this.e += (x - this.e) * (x > this.e ? a : r);
      o[n] = this.e < 1e-9 ? 0 : this.e;
    }
    return true;
  }
}
registerProcessor('pfx-env', PfxEnv);