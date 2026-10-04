// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'clawd-amps' worklet (amps.js, the amps' PLUG_WORKLETS), as the code builds it; do not edit, re-run it
class ClawdOctave extends AudioWorkletProcessor {
  constructor() { super(); this.env = 0; this.hi = false; this.flip = 1; this.y = 0; }
  process(ins, outs) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const att = 1 - Math.exp(-1 / (0.002 * sampleRate)), rel = 1 - Math.exp(-1 / (0.15 * sampleRate)), sm = 1 - Math.exp(-2 * Math.PI * 2500 / sampleRate);
    for (let n = 0; n < o.length; n++) {
      const x = i[n], a = Math.abs(x);
      this.env += (a - this.env) * (a > this.env ? att : rel);
      const th = 0.45 * this.env + 1e-5; // (well clear of the wiggles the harmonics leave)
      if (!this.hi && x > th) { this.hi = true; this.flip = -this.flip; }
      else if (this.hi && x < -th) this.hi = false;
      const g = this.env > 3e-4 ? this.env : (this.env * this.env) / 3e-4;
      this.y += (this.flip * g - this.y) * sm;
      o[n] = this.y;
    }
    return true;
  }
}
registerProcessor('clawd-octave', ClawdOctave);