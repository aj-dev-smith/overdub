// vendored verbatim from clawd-o-matic/web @ cd36948 by tools/vendor-clawd.js: the 'squaresquid-osc' worklet (pedals/20-fuzz.js, the squaresquid pedal's), as the code builds it; do not edit, re-run it
class SquareSquidOsc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: 'glide', defaultValue: 0.03, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: 'oct', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
    { name: 'duty', defaultValue: 0.5, minValue: 0.05, maxValue: 0.5, automationRate: 'k-rate' }]; }
  constructor() { super(); this.l1 = 0; this.l2 = 0; this.env = 0; this.hi = false; this.since = 0; this.per = 0; this.tgt = 0; this.ph = 0; this.amp = 0;
    this.a = 1 - Math.exp(-2 * Math.PI * 900 / sampleRate); this.rel = Math.exp(-1 / (0.08 * sampleRate)); this.ag = 1 - Math.exp(-1 / (0.006 * sampleRate));
    this.lo = sampleRate / 1400; this.hiP = sampleRate / 38; }
  process(ins, outs, p) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    const gl = p.glide[0], g = gl < 0.001 ? 1 : 1 - Math.exp(-1 / (gl * sampleRate)), oc = p.oct[0], mul = oc > 0.5 ? 2 : oc < -0.5 ? 0.5 : 1, duty = p.duty[0];
    let { l1, l2, env, hi, since, per, tgt, ph, amp } = this; const a = this.a, rel = this.rel, ag = this.ag, lo = this.lo, hiP = this.hiP;
    const blep = (t, dt) => { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; };
    for (let n = 0; n < o.length; n++) {
      const x = i ? i[n] : 0;
      l1 += (x - l1) * a; l2 += (l1 - l2) * a;
      const av = l2 < 0 ? -l2 : l2; env = av > env ? av : env * rel;
      since++;
      const th = env * 0.35 + 1e-5;
      if (!hi && l2 > th) { hi = true; if (since >= lo && since <= hiP) { tgt = since; if (per === 0) per = since; } since = 0; }
      else if (hi && l2 < -th) hi = false;
      if (since > 4 * hiP) since = 4 * hiP; // (no overflow in a long silence)
      if (per > 0) per += (tgt - per) * g;
      const want = env > 0.003 ? Math.min(1, Math.sqrt(env) * 1.3) : 0;
      amp += (want - amp) * ag;
      if (per > 0 && amp > 1e-5) {
        const dt = mul / per; ph += dt; if (ph >= 1) ph -= 1;
        let s = ph < duty ? 1 : -1;
        s += blep(ph, dt); let t2 = ph - duty; if (t2 < 0) t2 += 1; s -= blep(t2, dt);
        o[n] = s * amp * 0.5;
      } else o[n] = 0;
    }
    if (amp < 1e-5) amp = 0;
    this.l1 = l1; this.l2 = l2; this.env = env; this.hi = hi; this.since = since; this.per = per; this.tgt = tgt; this.ph = ph; this.amp = amp;
    return true;
  }
}
registerProcessor('squaresquid-osc', SquareSquidOsc);