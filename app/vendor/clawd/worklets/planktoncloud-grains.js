// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'planktoncloud-grains' worklet (pedals/60-time.js, the planktoncloud pedal's), as the code builds it; do not edit, re-run it
class PlanktonGrains extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'size', defaultValue: 0.2, minValue: 0.02, maxValue: 0.6, automationRate: 'k-rate' },
    { name: 'spread', defaultValue: 1, minValue: 0, maxValue: 2.6, automationRate: 'k-rate' },
    { name: 'drift', defaultValue: 10, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
    { name: 'oct', defaultValue: 0, minValue: 0, maxValue: 0.5, automationRate: 'k-rate' },
    { name: 'fb', defaultValue: 0.4, minValue: 0, maxValue: 0.85, automationRate: 'k-rate' }]; }
  constructor(o) {
    super(); let n = 1; while (n < sampleRate * 4.5) n <<= 1; this.b = new Float32Array(n); this.m = n - 1; this.w = 0;
    this.s = ((o && o.processorOptions && o.processorOptions.seed) || 7) >>> 0;
    const V = this.V = 24; this.pos = new Float64Array(V); this.inc = new Float64Array(V); this.len = new Float64Array(V); this.age = new Float64Array(V);
    this.gl = new Float32Array(V); this.gr = new Float32Array(V); this.on = new Uint8Array(V); this.next = 0;
    this.hann = new Float32Array(1025); for (let j = 0; j <= 1024; j++) this.hann[j] = 0.5 - 0.5 * Math.cos((6.283185307 * j) / 1024); // (a table: no cos per grain per sample)
  }
  r() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], i = ins[0] && ins[0][0];
    if (!oL) return true;
    const sr = sampleRate, b = this.b, m = this.m, V = this.V, size = p.size[0], len = Math.max(64, size * sr), sp = p.spread[0] * sr;
    const drift = p.drift[0], oct = p.oct[0], fb = p.fb[0], every = (len / 6), norm = 1 / Math.sqrt(6 * 0.375);
    for (let n = 0; n < oL.length; n++) {
      if (--this.next <= 0) {
        this.next = every * (0.5 + this.r());
        for (let v = 0; v < V; v++) if (!this.on[v]) {
          let c = drift * (this.r() * 2 - 1); const u = this.r();
          if (u < oct) c += u < oct / 2 ? 1200 : -1200;
          const inc = Math.pow(2, c / 1200), pan = 0.1 + 0.8 * this.r();
          this.on[v] = 1; this.inc[v] = inc; this.len[v] = len; this.age[v] = 0;
          this.pos[v] = this.w - (len * Math.max(1, inc) + 128 + this.r() * sp);
          this.gl[v] = Math.cos(pan * 1.5708); this.gr[v] = Math.sin(pan * 1.5708);
          break;
        }
      }
      let L = 0, R = 0;
      for (let v = 0; v < V; v++) {
        if (!this.on[v]) continue;
        const win = this.hann[(this.age[v] * 1024 / this.len[v]) | 0];
        const q = this.pos[v], q0 = Math.floor(q), f = q - q0, x0 = b[q0 & m], x1 = b[(q0 + 1) & m], s = (x0 + (x1 - x0) * f) * win;
        L += s * this.gl[v]; R += s * this.gr[v];
        this.pos[v] = q + this.inc[v];
        if (++this.age[v] >= this.len[v]) this.on[v] = 0;
      }
      L *= norm; R *= norm;
      b[this.w] = (i ? i[n] : 0) + fb * 0.7071 * (L + R);
      this.w = (this.w + 1) & m;
      oL[n] = L; oR[n] = R;
    }
    return true;
  }
}
registerProcessor('planktoncloud-grains', PlanktonGrains);