// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'chewedcable-dsp' worklet (pedals/70-glitch.js, the chewedcable pedal's), as the code builds it; do not edit, re-run it

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

class ChewedCable extends GlBase {
  static get parameterDescriptors() { return [
    { name: 'broke', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'crackle', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'hum', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor(o) { super(o); this.el = 0; this.drop = 0; this.chat = 0; this.tick = 0; this.tgt = 1; this.g = 1; this.cr = 0; this.crL = 1; this.ca = 0; this.hp = 0; this.hl = 0; }
  process(ins, outs, p) {
    const o = outs[0][0], x = ins[0] && ins[0][0];
    if (!o) return true;
    const br = p.broke[0], ck = p.crackle[0], hm = p.hum[0], sr = sampleRate;
    const pDrop = br > 0.001 ? (0.3 + 6 * br * br) / sr : 0, pCr = (ck * (0.3 + br) * 70) / sr;
    const rel = Math.exp(-1 / (0.6 * sr)), hk = 1 - Math.exp(-1 / (0.006 * sr)), dw = (6.283185307 * 60) / sr;
    for (let n = 0; n < o.length; n++) {
      const v = x ? x[n] : 0, a = Math.abs(v);
      this.el = a > this.el ? a : this.el * rel;
      // a dropout now and then; the contact chatters for a few ms each way
      if (this.drop > 0) { if (--this.drop === 0) this.chat = Math.round(sr * (0.002 + 0.01 * this.rnd())); }
      else if (this.rnd() < pDrop) { this.drop = Math.round(sr * (0.008 + this.rnd() * this.rnd() * (0.06 + 0.4 * br))); this.chat = Math.round(sr * (0.002 + 0.008 * this.rnd())); }
      if (this.chat > 0) { this.chat--; if (--this.tick <= 0) { this.tick = Math.round(sr * (0.0004 + 0.0018 * this.rnd())); this.tgt = this.rnd() < 0.5 ? 0 : 1; } }
      else this.tgt = this.drop > 0 ? 0 : 1;
      this.g += (this.tgt - this.g) * 0.25;
      let y = v * this.g;
      // crackle: short scratchy bursts, as loud as you're playing
      if (this.cr > 0) { this.cr--; y += this.ca * (this.rnd() * 2 - 1) * (this.cr / this.crL); }
      else if (this.rnd() < pCr) { this.cr = this.crL = Math.round(sr * (0.0003 + 0.002 * this.rnd())); this.ca = this.el * (0.4 + this.rnd()) * ck; }
      // the hum: loud while the ground's gone (a dropout), a whisper otherwise
      const ht = (this.drop > 0 ? 1 : 0.1 * br) * hm * Math.min(1, this.el * 6);
      this.hl += (ht - this.hl) * hk;
      this.hp += dw; if (this.hp > 6.283185307) this.hp -= 6.283185307;
      const s = Math.sin(this.hp);
      o[n] = y + this.hl * 0.09 * (s + 0.45 * (1 - 2 * s * s));
    }
    return true;
  }
}
registerProcessor('chewedcable-dsp', ChewedCable);