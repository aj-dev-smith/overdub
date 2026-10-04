// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'shellac-disc' worklet (pedals/70-glitch.js, the shellac pedal's), as the code builds it; do not edit, re-run it

class GlBase extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const po = (o && o.processorOptions) || {};
    this.s = (po.seed >>> 0) || 1; this.t0 = 0;
    this.port.onmessage = (e) => { if (e.data && Number.isFinite(e.data.t0)) this.t0 = e.data.t0; };
  }
  rnd() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  beat(bpm) { return ((currentFrame / sampleRate - this.t0) * bpm) / 60; }
}

class GlShift {
  constructor(W) { this.b = new Float32Array(8192); this.w = 0; this.ph = 0.5; this.W = W; }
  run(x, r, e) {
    const b = this.b, W = this.W;
    b[this.w] = x;
    let ph = this.ph;
    if (Math.abs(1 - r) < 1e-6) ph += (0.5 - ph) * 0.00005;
    else { ph += (1 - r) / W; ph -= Math.floor(ph); }
    this.ph = ph;
    const p2 = ph >= 0.5 ? ph - 0.5 : ph + 0.5, g = 0.5 - 0.5 * Math.cos(6.283185307 * ph);
    const y = this.tap(ph * W + e + 1) * g + this.tap(p2 * W + e + 1) * (1 - g);
    this.w = (this.w + 1) & 8191;
    return y;
  }
  tap(d) { const p = this.w - d, i = Math.floor(p), f = p - i, b = this.b; return b[i & 8191] * (1 - f) + b[(i + 1) & 8191] * f; }
}

class ShellacClam extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'wow', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'dust', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'slow', defaultValue: 0, minValue: 0, maxValue: 12, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.sh = new GlShift(Math.round(sampleRate * 0.03)); this.t = 0; this.el = 0; this.pop = 0; this.pa = 0; this.hs = 0; this.ra = 1; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const sr = sampleRate, wow = p.wow[0], du = p.dust[0], TAU = 6.283185307;
    const rt = Math.pow(2, -p.slow[0] / 12);
    this.ra += (rt - this.ra) * (1 - Math.exp(-o.length / (0.15 * sr))); // (the platter slows; it doesn't jump)
    const A = wow * 0.0012 * sr, Af = wow * 0.00004 * sr, rel = Math.exp(-1 / (0.5 * sr)), pPop = (du * 5) / sr, pTick = (du * 160) / sr, pd = Math.exp(-1 / (0.00025 * sr));
    for (let n = 0; n < o.length; n++) {
      const v = x ? x[n] : 0, a = Math.abs(v);
      this.el = a > this.el ? a : this.el * rel;
      this.t += 1 / sr; if (this.t > 1000) this.t -= 1000;
      // wow at 33 1/3 rpm (0.55 Hz, a touch off-centre so it has a second harmonic) and a flutter at 7 Hz
      const s = Math.sin(TAU * 0.555 * this.t), e = A * (1 + s + 0.25 * s * s) + Af * (1 + Math.sin(TAU * 7.1 * this.t));
      let y = this.sh.run(v, this.ra, e);
      // the needle: pops, ticks and a hiss, as long as there's music in the groove
      const nd = Math.min(1, this.el * 8) * du;
      if (this.rnd() < pPop) this.pa = (this.rnd() < 0.5 ? -1 : 1) * (0.05 + 0.2 * this.rnd());
      else if (this.rnd() < pTick) this.pa = (this.rnd() - 0.5) * 0.05;
      this.pop = this.pop * pd + this.pa; this.pa = 0;
      this.hs += ((this.rnd() * 2 - 1) - this.hs) * 0.4;
      o[n] = y + (this.pop * 0.5 + this.hs * 0.006) * nd;
    }
    return true;
  }
}
registerProcessor('shellac-disc', ShellacClam);