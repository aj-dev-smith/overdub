// core.width: Gatefold. The utility every track needs: GAIN, a balance PAN, stereo WIDTH (mid/side: 0 is mono, 1 as
// it was, 2 extra wide) and MONO BASS below a frequency (the side signal's lows are taken out with a complementary
// split, so nothing else changes). Unity and transparent at defaults.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.width', name: 'Gatefold', kind: 'effect', cat: 'utility', by: 'overdub',
  blurb: 'Gain, pan, stereo width and mono bass',
  nod: 'a mixing console utility strip with mid/side width',
  params: [
    { key: 'gain', label: 'GAIN', min: -36, max: 18, def: 0, unit: 'dB', role: 'level', desc: 'louder or quieter' },
    { key: 'pan', label: 'PAN', min: -1, max: 1, def: 0, role: 'width', desc: 'left to right (balance)' },
    { key: 'width', label: 'WIDTH', min: 0, max: 2, def: 1, unit: 'x', role: 'width', desc: 'mono (0) to as recorded (1) to extra wide (2)' },
    { key: 'monobass', label: 'MONO BASS', min: 20, max: 500, def: 20, curve: 'log', unit: 'Hz', role: 'tone', desc: 'everything below this goes mono (tight low end)' },
  ],
  look: { color: '#36414f', ink: '#e8eef7', shape: 'mini', finish: 'brushed', knob: 'small', label: 'plate', led: '#9fe7ff' },
  tail: 0,
  kernel: kernel(String.raw`
return {
  create({ sr }) {
    const lo = svf(sr), lo2 = svf(sr);
    const gS = glide(20, sr, 1), pS = glide(20, sr, 0), wS = glide(20, sr, 1), mbOn = glide(30, sr, 0);
    return {
      process(L, R, n, P) {
        lo.set(P.monobass, 0.5); lo2.set(P.monobass, 0.5);
        const g = dbg(P.gain), mbT = P.monobass > 20.5 ? 1 : 0;
        for (let i = 0; i < n; i++) {
          const l = L[i], r = R[i];
          const m = 0.5 * (l + r);
          let s = 0.5 * (l - r);
          // mono bass: take the side's lows out (a 2nd-order low-pass twice: its own complement is the rest)
          const sl = lo2.tick(lo.tick(s)), on = mbOn.next(mbT);
          s -= sl * on;
          s *= wS.next(P.width);
          let ol = m + s, or = m - s;
          const p = pS.next(P.pan), gg = gS.next(g);
          // balance: the far side dips, the near side stays at unity
          ol *= (p > 0 ? 1 - p : 1) * gg; or *= (p < 0 ? 1 + p : 1) * gg;
          L[i] = ol; R[i] = or;
        }
      },
    };
  },
};
`),
});
