// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'nautilus-phase' worklet (pedals/40-mod.js, the nautilus pedal's), as the code builds it; do not edit, re-run it
class NautilusPhase extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });
    return [k('rate', 0.5, 0.01, 20), k('depth', 0.8, 0, 1), k('lo', 200, 10, 8000), k('hi', 3000, 20, 16000), k('fb', 0, -0.95, 0.95),
      k('mix', 0.5, 0, 1), k('stages', 4, 1, 12), k('shape', 0, 0, 1), k('width', 0, 0, 1), k('throb', 0, 0, 1)];
  }
  constructor(o) {
    super();
    const q = (o && o.processorOptions) || {};
    this.lamp = !!q.lamp; this.uni = !q.mul; this.mul = new Float64Array(12).fill(1);
    if (q.mul) for (let i = 0; i < 12 && i < q.mul.length; i++) this.mul[i] = q.mul[i];
    this.x1 = [new Float64Array(12), new Float64Array(12)]; this.y1 = [new Float64Array(12), new Float64Array(12)];
    this.last = new Float64Array(2); this.lb = new Float64Array(2); this.lg = new Float64Array(2); this.ph = 0;
    const sr = sampleRate, c = (s) => 1 - Math.exp(-1 / (s * sr));
    // the lamp heats fast and cools slower; the cell follows it faster up than down: a lopsided, throbbing sweep
    this.lu = c(0.006); this.ld = c(0.028); this.gu = c(0.01); this.gd = c(0.045);
  }
  process(ins, outs, p) {
    const inp = ins[0], out = outs[0];
    if (!out || !out.length) return true;
    const N = out[0].length, sr = sampleRate, inc = p.rate[0] / sr;
    if (!inp || !inp.length) { for (const y of out) y.fill(0); this.ph = (this.ph + N * inc) % 1; return true; }
    const depth = p.depth[0], lo = p.lo[0], lr = Math.log(Math.max(p.hi[0], lo + 1) / lo), fb = p.fb[0], mix = p.mix[0], st = Math.round(p.stages[0]);
    const tri = p.shape[0] > 0.5, width = p.width[0], throb = p.throb[0], lamp = this.lamp, uni = this.uni, mul = this.mul, fmax = 0.45 * sr, K = Math.PI / sr;
    const base = this.ph;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch], xs = this.x1[ch & 1], ys = this.y1[ch & 1];
      let ph = base + (ch ? width * 0.25 : 0), last = this.last[ch & 1], b = this.lb[ch & 1], g = this.lg[ch & 1];
      ph -= Math.floor(ph);
      for (let n = 0; n < N; n++) {
        ph += inc; if (ph >= 1) ph -= 1;
        let pos, m;
        if (lamp) {
          const d = 0.5 + 0.5 * Math.sin(6.283185307179586 * ph), heat = d * d;
          b += (heat - b) * (heat > b ? this.lu : this.ld);
          g += (b - g) * (b > g ? this.gu : this.gd);
          m = g; pos = g * depth;
        } else {
          m = tri ? (ph < 0.5 ? 2 * ph : 2 - 2 * ph) : 0.5 - 0.5 * Math.cos(6.283185307179586 * ph);
          pos = 0.5 + (m - 0.5) * depth;
        }
        const t = Math.tan(K * Math.min(fmax, lo * Math.exp(lr * pos)));
        let u = x[n] + fb * last;
        for (let i = 0; i < st; i++) {
          const w = uni ? t : Math.min(20, t * mul[i]), a = (w - 1) / (w + 1), v = a * u + xs[i] - a * ys[i];
          xs[i] = u; ys[i] = v; u = v;
        }
        last = u;
        y[n] = x[n] * (1 - mix) + u * mix * (1 - throb * (1 - m));
      }
      if (Math.abs(last) < 1e-20) last = 0;
      this.last[ch & 1] = last; this.lb[ch & 1] = b; this.lg[ch & 1] = g;
    }
    this.ph = (base + N * inc) % 1;
    return true;
  }
}
registerProcessor('nautilus-phase', NautilusPhase);