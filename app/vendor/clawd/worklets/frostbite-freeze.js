// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'frostbite-freeze' worklet (pedals/60-time.js, the frostbite pedal's), as the code builds it; do not edit, re-run it
class FrostbiteFreeze extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'hold', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor() {
    super(); let n = 1; while (n < sampleRate * 1.1) n <<= 1; this.b = new Float32Array(n); this.m = n - 1; this.w = 0;
    this.F = Math.round(0.7 * sampleRate); this.fz = new Float32Array(this.F); this.G = Math.round(0.3 * sampleRate);
    this.V = 5; this.pos = new Float64Array(5); this.age = new Float64Array(5); this.s = 12345; this.was = false; this.env = 0;
    this.up = 1 - Math.exp(-1 / (0.35 * sampleRate)); this.down = 1 - Math.exp(-1 / (1.8 * sampleRate));
  }
  r() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const hold = p.hold[0] > 0.5, F = this.F, G = this.G, V = this.V, b = this.b, m = this.m, fz = this.fz;
    if (hold && !this.was) {
      for (let k = 0; k < F; k++) fz[k] = b[(this.w - F + k) & m];
      for (let v = 0; v < V; v++) { this.age[v] = (v * G) / V; this.pos[v] = this.r() * (F - G - 1); }
    }
    this.was = hold;
    const want = hold ? 1 : 0, rate = hold ? this.up : this.down, norm = 1 / Math.sqrt(V * 0.375);
    for (let n = 0; n < oL.length; n++) {
      b[this.w] = i ? i[n] : 0; this.w = (this.w + 1) & m;
      this.env += (want - this.env) * rate;
      if (this.env < 1e-5) { oL[n] = 0; oR[n] = 0; continue; }
      let L = 0, R = 0;
      for (let v = 0; v < V; v++) {
        const a = this.age[v] / G, s = fz[Math.floor(this.pos[v] + this.age[v])] * (0.5 - 0.5 * Math.cos(6.283185307 * a));
        if (v & 1) { L += s * 0.45; R += s * 0.89; } else { L += s * 0.89; R += s * 0.45; }
        if (++this.age[v] >= G) { this.age[v] = 0; this.pos[v] = this.r() * (F - G - 1); }
      }
      const e = this.env * norm;
      oL[n] = L * e; oR[n] = R * e;
    }
    return true;
  }
}
registerProcessor('frostbite-freeze', FrostbiteFreeze);