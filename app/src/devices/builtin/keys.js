// @ts-check
// core.keys: Lamp Tines. Two keyboards in one:
//   TINES  a tine electric piano: two-operator FM (the index barks at the strike and settles mellow, more the harder
//          you play), a bell partial on top, a two-stage decay that is long in the bass and short up high, a little
//          drive when you dig in, and the suitcase's stereo tremolo.
//   GRAND  a piano, near enough: stretched (inharmonic) partials that decay faster the higher they are, two of them
//          doubled a hair out of tune (the slow beat of a real unison), felt-hammer noise, dampers that let go slowly
//          in the bass. Brighter the harder you play.
// Both are ports of clawd-o-matic's live keys (web/plug/keys.js: the "Tines" and "Grand" patches), by the same hands.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.keys', name: 'Lamp Tines', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'Electric piano with bark and shimmer, or a grand',
  nod: 'a tine electric piano with a suitcase tremolo (and a grand piano)',
  params: [
    { key: 'voice', label: 'VOICE', opts: ['TINES', 'GRAND'], def: 0, role: 'shape', desc: 'electric piano or acoustic grand' },
    { key: 'bright', label: 'BRIGHT', min: 0, max: 1, def: 0.5, role: 'tone', desc: 'mellow to glassy (and how much it barks when you dig in)' },
    { key: 'bell', label: 'BELL', min: 0, max: 1, def: 0.4, role: 'tone', desc: 'the tine ping on top of each note (TINES)' },
    { key: 'decay', label: 'DECAY', min: 0.3, max: 2.5, def: 1, unit: 'x', role: 'decay', desc: 'how long notes ring' },
    { key: 'release', label: 'RELEASE', min: 0.02, max: 2, def: 0.12, curve: 'log', unit: 's', role: 'release', desc: 'how fast the dampers stop a note' },
    { key: 'trem', label: 'TREM', min: 0, max: 1, def: 0.2, role: 'depth', desc: 'stereo tremolo depth: the suitcase wobble' },
    { key: 'rate', label: 'RATE', min: 0.5, max: 9, def: 4.2, curve: 'log', unit: 'Hz', role: 'rate', desc: 'tremolo speed' },
  ],
  look: { color: '#ecdfc6', ink: '#4a2e1f', shape: 'wide', finish: 'flat', knob: 'black', label: 'script', led: '#ff5d5d' },
  tail: 8,
  kernel: kernel(String.raw`
// THE COST. A voice is a class (one render() V8 compiles once, where closures were a copy per voice) that works in
// locals, written back once a block: a number kept in a closure is boxed on the heap, a new box at every store, every
// sample. The grand runs partial by partial (each one's phasor and decays stay in registers for the whole block) and
// adds them into the block in the order it always did. Every sum and product is in its old order, so the sound is bit
// for bit what it was (tools/golden.json, inst:core.keys and the demo songs).
const K = 16;
class Voice {
  constructor(sr, seed) {
    this.sr = sr;
    this.kind = 0; this.t = 0; this.vel = 0.8; this.p0 = 1; this.p1 = 1; this.env = 0; this.atk = 1; this.rel = false; this.rk = 1; this.kr = 0.999; this.lvl = 0;
    // tines
    this.fc = 0; this.pc = 0; this.pm = 0; this.pb = 0; this.fb2 = 0; this.I0 = 0; this.Ie = 1; this.Ik = 0; this.Ib = 0; this.Ibk = 0;
    this.af = 0; this.as = 0; this.df = 0; this.ds = 0; this.drv = 1; this.dn = 1;
    // grand: up to 16 partials as rotating phasors
    this.px = new Float64Array(K); this.py = new Float64Array(K); this.pcs = new Float64Array(K); this.psn = new Float64Array(K);
    this.paf = new Float64Array(K); this.pas = new Float64Array(K); this.pdf = new Float64Array(K); this.pds = new Float64Array(K);
    this.np = 0; this.hk = 0.3; this.hlp = 0; this.kd = 1;
    this.ns = ((seed ^ 0x77) >>> 0) || 0x9e3779b9; // (lib.js rng(seed ^ 0x77), written out)
    this.xb = new Float64Array(128);
  }
  start(p, v, P) {
    const sr = this.sr;
    const kind = this.kind = P.voice | 0; this.vel = v; this.t = 0; this.rel = false; this.rk = 1; this.env = this.lvl > 1e-4 ? this.env : 0;
    const vel = v, f0 = mtof(p), dec = P.decay, br = P.bright;
    const pan = panLR(clamp((p - 60) / 60, -0.35, 0.35)); this.p0 = pan[0]; this.p1 = pan[1];
    this.kr = coef(Math.max(0.01, P.release) / 2.5, sr);
    if (kind === 0) {
      this.fc = f0 / sr; this.pc = 0; this.pm = 0; this.pb = 0; this.fb2 = f0 * 13.9 < sr * 0.45 ? (f0 * 13.9) / sr : 0;
      const hi = clamp((p - 48) / 48, 0, 1);
      this.I0 = vel * (2.2 - 1.2 * hi) * (0.45 + 1.1 * br); this.Ie = 1; this.Ik = coef(0.14, sr);
      this.Ib = 0.22 * vel * vel * P.bell * 2; this.Ibk = coef(0.035 + 0.02 * P.bell, sr);
      const ts = 3.8 * Math.pow(2, -(p - 48) / 26) * dec;
      this.af = 0.4; this.as = 0.6; this.df = coef(0.4 * dec, sr); this.ds = coef(ts, sr);
      const drv = this.drv = 1 + 2.4 * Math.max(0, vel - 0.55) * (0.4 + br); this.dn = Math.tanh(drv);
      this.atk = 1 / (0.001 * sr);
    } else {
      const px = this.px, py = this.py, pcs = this.pcs, psn = this.psn, paf = this.paf, pas = this.pas, pdf = this.pdf, pds = this.pds;
      const B = 0.00012 * Math.pow(2, (p - 60) / 24), ts = clamp(14 * Math.pow(2, -(p - 21) / 18), 0.6, 14) * dec, hard = clamp(vel * (0.6 + 0.8 * br), 0, 1.2);
      let np = 0;
      for (let k = 1; k <= 14 && np < K - 2; k++) {
        const f = f0 * k * Math.sqrt(1 + B * k * k);
        if (f > sr * 0.45) break;
        const a = Math.pow(k, -(1.75 - 0.95 * hard)) * (k === 7 || k === 14 ? 0.35 : 1), tk = ts / (1 + 0.32 * (k - 1));
        const w = TAU * f / sr;
        px[np] = 0; py[np] = 1; pcs[np] = Math.cos(w); psn[np] = Math.sin(w);
        paf[np] = a * 0.55; pas[np] = a * 0.45; pdf[np] = coef(tk * 0.16, sr); pds[np] = coef(tk, sr); np++;
      }
      // the unison twins of the first two partials, a hair out
      const n0 = np;
      for (let j = 0; j < Math.min(2, n0) && np < K; j++) {
        const w = Math.atan2(psn[j], pcs[j]) * Math.pow(2, (j ? -0.7 : 0.9) / 1200);
        px[np] = 0; py[np] = 1; pcs[np] = Math.cos(w); psn[np] = Math.sin(w);
        paf[np] = paf[j] * 0.6; pas[np] = pas[j] * 0.6; pdf[np] = pdf[j]; pds[np] = pds[j]; np++;
      }
      this.np = np;
      this.hk = 0.15 + 0.6 * vel; this.hlp = 0;
      this.kd = p >= 89 ? 1 : coef((0.07 + 0.22 * Math.max(0, (60 - p) / 36)) * (P.release / 0.12), sr);
      this.atk = 1 / (0.0015 * sr);
    }
  }
  release() { this.rel = true; }
  render(L, R, n, P) {
    return this.kind === 0 ? this.tines(L, R, n) : this.grand(L, R, n);
  }
  tines(L, R, n) {
    const fc = this.fc, fb2 = this.fb2, I0 = this.I0, Ik = this.Ik, Ibk = this.Ibk, df = this.df, ds = this.ds, rel = this.rel, kr = this.kr;
    const vel = this.vel, drv = this.drv, dn = this.dn, atk = this.atk, p0 = this.p0, p1 = this.p1;
    let pc = this.pc, pm = this.pm, pb = this.pb, Ie = this.Ie, Ib = this.Ib, af = this.af, as = this.as, rk = this.rk, env = this.env, lvl = this.lvl, t = this.t;
    let top = 0;
    for (let i = 0; i < n; i++, t++) {
      if (env < 1) env = Math.min(1, env + atk);
      pc += fc; if (pc >= 1) pc -= 1;
      pm += fc; if (pm >= 1) pm -= 1;
      Ie *= Ik;
      let ph = pc + (I0 * (0.25 + 0.75 * Ie) * sinT(pm)) / TAU; ph -= Math.floor(ph);
      let x = sinT(ph);
      if (fb2) { pb += fb2; if (pb >= 1) pb -= 1; Ib *= Ibk; x += sinT(pb) * Ib; }
      af *= df; as *= ds;
      let e = af + as;
      if (rel) { rk *= kr; e *= rk; }
      lvl = e;
      const y = Math.tanh(x * e * env * vel * drv) / dn * 0.5;
      L[i] += y * p0; R[i] += y * p1;
      if (lvl > top) top = lvl;
    }
    this.pc = pc; this.pm = pm; this.pb = pb; this.Ie = Ie; this.Ib = Ib; this.af = af; this.as = as; this.rk = rk; this.env = env; this.lvl = lvl; this.t = t;
    return !(top < 3e-5 && t > 64);
  }
  grand(L, R, n) {
    const sr = this.sr, np = this.np, k = this.rel ? this.kd : 1;
    const px = this.px, py = this.py, pcs = this.pcs, psn = this.psn, paf = this.paf, pas = this.pas, pdf = this.pdf, pds = this.pds;
    if (this.xb.length < n) this.xb = new Float64Array(n);
    const xb = this.xb;
    for (let i = 0; i < n; i++) xb[i] = 0;
    // the partials, one at a time through the block (top: the loudest any reached; lvl: the loudest at the last sample)
    let top = 0, lvl = 0;
    for (let j = 0; j < np; j++) {
      const c = pcs[j], s = psn[j], mf = pdf[j] * k, ms = pds[j] * k;
      let x = px[j], y = py[j], af = paf[j], as = pas[j], a = 0;
      for (let i = 0; i < n; i++) {
        const nx = x * c + y * s; y = y * c - x * s; x = nx;
        af *= mf; as *= ms;
        a = af + as; xb[i] += x * a; if (a > top) top = a;
      }
      if (a > lvl) lvl = a;
      px[j] = x; py[j] = y; paf[j] = af; pas[j] = as;
    }
    // the felt (the first 5 ms), the attack, the level
    const vel = this.vel, atk = this.atk, hk = this.hk, p0 = this.p0, p1 = this.p1, felt = 0.005 * sr, g = 0.25 + 0.75 * vel;
    let env = this.env, t = this.t, hlp = this.hlp, ns = this.ns;
    for (let i = 0; i < n; i++, t++) {
      if (env < 1) env = Math.min(1, env + atk);
      let x = xb[i];
      if (t < felt) {
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0;
        hlp += hk * ((ns / 4294967296) * 2 - 1 - hlp); x += hlp * 0.35 * vel * vel * (1 - t / felt);
      }
      const y = x * env * 0.38 * g;
      L[i] += y * p0; R[i] += y * p1;
    }
    this.env = env; this.t = t; this.hlp = hlp; this.ns = ns; this.lvl = lvl;
    // keep the phasors on the unit circle
    for (let j = 0; j < np; j++) { const m = Math.hypot(px[j], py[j]) || 1; px[j] /= m; py[j] /= m; }
    return !(top < 3e-5 && t > 64);
  }
}
return {
  poly: 14,
  create({ sr, seed }) {
    let trPh = 0;
    return {
      voice() { return new Voice(sr, seed); },
      // the suitcase: a stereo tremolo (each side dips in turn), then the level
      process(L, R, n, P) {
        const d = P.trem * 0.85, dt = P.rate / sr, OUT = (P.voice | 0) === 0 ? 0.35 : 0.275;
        for (let i = 0; i < n; i++) {
          trPh += dt; if (trPh >= 1) trPh -= 1;
          const s = sinT(trPh) * d;
          L[i] = knee(L[i] * (1 - Math.max(0, s)) * OUT); R[i] = knee(R[i] * (1 + Math.min(0, s)) * OUT);
        }
      },
    };
  },
};
`),
});
