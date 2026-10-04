// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'crabwalk-shift' worklet (pedals/70-glitch.js, the crabwalk pedal's), as the code builds it; do not edit, re-run it

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

class CrabWalk extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    { name: 'beats', defaultValue: 0.5, minValue: 0.0625, maxValue: 4, automationRate: 'k-rate' },
    { name: 'spread', defaultValue: 5, minValue: 0, maxValue: 12, automationRate: 'k-rate' },
    { name: 'width', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.sh = new GlShift(Math.round(sampleRate * 0.045)); this.cell = null; this.to = 0; this.st = 0; this.side = 1; this.pan = 0; this.gl = Math.SQRT1_2; this.gr = Math.SQRT1_2; }
  process(ins, outs, p) {
    const L = outs[0][0], R = outs[0][1], x = ins[0] && ins[0][0];
    if (!L) return true;
    const bpm = p.bpm[0], sl = p.beats[0], sp = Math.round(p.spread[0]), wd = p.width[0], nf = L.length;
    const b = this.beat(bpm), cell = Math.floor((b + (nf * bpm) / 60 / sampleRate) / sl);
    // a step lands in this block: a new interval and the other side (checked per block: 3 ms is plenty for a scuttle)
    if (cell !== this.cell) {
      const first = this.cell === null;
      this.cell = cell;
      if (!first && sp >= 1) {
        let t = this.to + (this.rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(this.rnd() * 3));
        if (t > sp) t = 2 * sp - t; if (t < -sp) t = -2 * sp - t;
        if (t > sp || t < -sp) t = 0;
        if (t === 0) t = this.to > 0 ? -1 : 1;
        this.to = Math.max(-sp, Math.min(sp, t)); this.side = -this.side;
      } else if (sp < 1) this.to = 0;
    }
    const k = 1 - Math.exp(-nf / (0.012 * sampleRate)), kp = 1 - Math.exp(-nf / (0.03 * sampleRate));
    this.st += (this.to - this.st) * k; this.pan += (this.side * wd - this.pan) * kp;
    const r = Math.pow(2, this.st / 12), q = ((this.pan + 1) * Math.PI) / 4, gl1 = Math.cos(q), gr1 = Math.sin(q);
    for (let n = 0; n < nf; n++) {
      const u = n / nf, y = this.sh.run(x ? x[n] : 0, r, 0);
      L[n] = y * (this.gl + (gl1 - this.gl) * u); if (R) R[n] = y * (this.gr + (gr1 - this.gr) * u);
    }
    this.gl = gl1; this.gr = gr1;
    return true;
  }
}
registerProcessor('crabwalk-shift', CrabWalk);