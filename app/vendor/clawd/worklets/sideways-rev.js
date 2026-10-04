// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'sideways-rev' worklet (pedals/60-time.js, the sideways pedal's), as the code builds it; do not edit, re-run it
class SidewaysRev extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'len', defaultValue: 0.5, minValue: 0.05, maxValue: 4, automationRate: 'k-rate' }, { name: 'fb', defaultValue: 0, minValue: 0, maxValue: 0.9, automationRate: 'k-rate' }]; }
  constructor() { super(); let n = 1; while (n < sampleRate * 8.5) n <<= 1; this.b = new Float32Array(n); this.m = n - 1; this.w = 0; this.j = 0; this.N = 0; this.pS = 0; this.pN = 0; this.F = Math.round(0.012 * sampleRate); }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const b = this.b, m = this.m, fb = p.fb[0], F = this.F;
    if (!this.N) this.N = Math.max(4 * F, Math.round(p.len[0] * sampleRate));
    for (let n = 0; n < o.length; n++) {
      let y = 0;
      const j = this.j, pN = this.pN;
      if (j < pN) { const e = Math.min(1, j / F, (pN - 1 - j) / F); y = b[(this.pS + pN - 1 - j) & m] * e * e * (3 - 2 * e); }
      b[this.w] = (i ? i[n] : 0) + fb * y;
      o[n] = y;
      this.w = (this.w + 1) & m;
      if (++this.j >= this.N) { this.pN = this.N; this.pS = (this.w - this.N) & m; this.N = Math.max(4 * F, Math.round(p.len[0] * sampleRate)); this.j = 0; }
    }
    return true;
  }
}
registerProcessor('sideways-rev', SidewaysRev);