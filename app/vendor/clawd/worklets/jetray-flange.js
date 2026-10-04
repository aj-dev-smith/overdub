// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'jetray-flange' worklet (pedals/40-mod.js, the jetray pedal's), as the code builds it; do not edit, re-run it
class JetrayFlange extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });
    return [k('manual', 0.003, 0.0001, 0.02), k('width', 0.6, 0, 1), k('rate', 0.3, 0.01, 10), k('regen', 0.5, -0.92, 0.92), k('mix', 0.5, 0, 1)];
  }
  constructor() {
    super();
    this.buf = [new Float32Array(4096), new Float32Array(4096)]; this.w = 0; this.ph = 0; this.z = new Float64Array(2);
    this.lpc = 1 - Math.exp((-2 * Math.PI * 6500) / sampleRate);
  }
  process(ins, outs, p) {
    const inp = ins[0], out = outs[0];
    if (!out || !out.length) return true;
    const N = out[0].length, sr = sampleRate, inc = p.rate[0] / sr;
    if (!inp || !inp.length) { for (const y of out) y.fill(0); this.ph = (this.ph + N * inc) % 1; return true; }
    const man = p.manual[0], wd = p.width[0] * 3.5, rg = p.regen[0], mix = p.mix[0], norm = 1 - 0.45 * Math.abs(rg), lpc = this.lpc, mask = 4095;
    const lo = 0.00005 * sr, hi = Math.min(0.02 * sr, 4000);
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch], bf = this.buf[ch & 1];
      let ph = this.ph, w = this.w, z = this.z[ch & 1];
      for (let n = 0; n < N; n++) {
        ph += inc; if (ph >= 1) ph -= 1;
        const tr = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        let ds = man * sr * Math.pow(2, wd * tr);
        ds = ds < lo ? lo : ds > hi ? hi : ds;
        // (w is where this sample goes, so w - ds is ds samples ago: between i0 and the newer i0 + 1)
        const r = w - ds, i0 = Math.floor(r), f = r - i0, a = bf[i0 & mask], v = a + (bf[(i0 + 1) & mask] - a) * f;
        z += (v - z) * lpc;
        let s = x[n] + rg * z;
        s = s > 3 ? 3 : s < -3 ? -3 : s;
        bf[w] = s; w = (w + 1) & mask;
        y[n] = (x[n] * (1 - mix) + z * mix) * norm;
      }
      if (Math.abs(z) < 1e-20) z = 0;
      this.z[ch & 1] = z;
      if (ch === out.length - 1) { this.w = w; this.ph = ph; }
    }
    return true;
  }
}
registerProcessor('jetray-flange', JetrayFlange);