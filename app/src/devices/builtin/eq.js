// @ts-check
// core.eq: Top Shelf. A musical five-band equaliser: a low cut, a low shelf, a sweepable bell, a high shelf and a high
// cut, all state-variable filters (Simper's trapezoidal SVF), so sweeping a band while the song plays never zips or
// blows up. Flat at defaults (every gain 0 dB, the cuts out of the way).
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.eq',
  name: 'Top Shelf',
  kind: 'effect',
  cat: 'eq',
  by: 'overdub',
  blurb: 'Shape the tone: shelves, a sweepable bell, cuts',
  nod: 'a classic console channel equaliser',
  params: [
    {
      key: 'hp',
      label: 'LOW CUT',
      min: 10,
      max: 1000,
      def: 10,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'removes rumble and mud below this',
    },
    {
      key: 'lowf',
      label: 'LOW FREQ',
      min: 30,
      max: 600,
      def: 110,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'where the low shelf starts',
    },
    { key: 'low', label: 'LOW', min: -15, max: 15, def: 0, unit: 'dB', role: 'tone', desc: 'more or less weight' },
    {
      key: 'midf',
      label: 'MID FREQ',
      min: 150,
      max: 9000,
      def: 1000,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'where the bell sits',
    },
    {
      key: 'mid',
      label: 'MID',
      min: -15,
      max: 15,
      def: 0,
      unit: 'dB',
      role: 'tone',
      desc: 'boost to bring out, cut to clear space',
    },
    {
      key: 'q',
      label: 'Q',
      min: 0.3,
      max: 8,
      def: 0.9,
      curve: 'log',
      unit: 'x',
      role: 'shape',
      desc: 'wide and gentle to narrow and surgical',
    },
    {
      key: 'highf',
      label: 'HIGH FREQ',
      min: 1500,
      max: 16000,
      def: 7000,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'where the high shelf starts',
    },
    {
      key: 'high',
      label: 'HIGH',
      min: -15,
      max: 15,
      def: 0,
      unit: 'dB',
      role: 'tone',
      desc: 'more or less air and bite',
    },
    {
      key: 'lp',
      label: 'HIGH CUT',
      min: 1000,
      max: 22000,
      def: 22000,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'darkens everything above this',
    },
    { key: 'gain', label: 'OUTPUT', min: -18, max: 18, def: 0, unit: 'dB', role: 'level', desc: 'level after the EQ' },
  ],
  look: {
    color: '#a7aeb2',
    ink: '#16191d',
    shape: 'rack',
    finish: 'flat',
    knob: 'black',
    label: 'plate',
    led: '#ffcf4a',
  },
  tail: 0.05,
  kernel: kernel(String.raw`
return {
  create({ sr }) {
    const mk = () => ({ hp: svf(sr), lo: svf(sr), mid: svf(sr), hi: svf(sr), lp: svf(sr), hp2: svf(sr), lp2: svf(sr) });
    const ch = [mk(), mk()];
    const gS = glide(20, sr, 1), hpOn = glide(30, sr), lpOn = glide(30, sr);
    const nyq = sr * 0.45;
    return {
      process(L, R, n, P) {
        for (const c of ch) {
          c.hp.set(P.hp, 0.54); c.hp2.set(P.hp, 1.31);
          c.lo.shelfLo(P.lowf, 0.7, P.low); c.mid.bell(P.midf, P.q, P.mid); c.hi.shelfHi(P.highf, 0.7, P.high);
          c.lp.set(Math.min(P.lp, nyq), 0.54); c.lp2.set(Math.min(P.lp, nyq), 1.31);
        }
        // the cuts fade out of the path at their extremes (so "flat" is exactly flat)
        const hpT = P.hp > 10.5 ? 1 : 0, lpT = P.lp < 21500 && P.lp < nyq ? 1 : 0, g = dbg(P.gain);
        const [a, b] = ch;
        for (let i = 0; i < n; i++) {
          const hw = hpOn.next(hpT), lw = lpOn.next(lpT), gg = gS.next(g);
          let l = L[i], r = R[i];
          if (hw > 1e-4) { a.hp.tick(l); a.hp2.tick(a.hp.hp); b.hp.tick(r); b.hp2.tick(b.hp.hp); l += (a.hp2.hp - l) * hw; r += (b.hp2.hp - r) * hw; }
          l = a.hi.eq(a.mid.eq(a.lo.eq(l))); r = b.hi.eq(b.mid.eq(b.lo.eq(r)));
          if (lw > 1e-4) { const ll = a.lp2.tick(a.lp.tick(l)), rl = b.lp2.tick(b.lp.tick(r)); l += (ll - l) * lw; r += (rl - r) * lw; }
          L[i] = l * gg; R[i] = r * gg;
        }
      },
    };
  },
};
`),
});
