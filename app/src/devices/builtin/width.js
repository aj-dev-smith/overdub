// @ts-check
// core.width: Gatefold. The utility every track needs: GAIN, a balance PAN, stereo WIDTH (mid/side: 0 is mono, 1 as
// it was, 2 extra wide) and MONO BASS below a frequency (the side signal's lows are taken out with a complementary
// split, so nothing else changes). Unity and transparent at defaults.
// MONO MODE (appended): ORIGINAL is that first split, which every song made before it keeps. It is not a high pass:
// the side minus its low-passed self is still most of the side around MONO BASS (measured on the curve: about +2 dB
// at half of MONO BASS and at MONO BASS, -8 dB at a tenth of it), so it leaves the low end about as wide as it found
// it. STEEP takes the side through a 24 dB per octave high pass (Linkwitz-Riley) at MONO BASS instead: under it the
// side is gone (-12 dB at half of it, -24 at a quarter), which is what mono bass means for a club system.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.width',
  name: 'Gatefold',
  kind: 'effect',
  cat: 'utility',
  by: 'overdub',
  blurb: 'Gain, pan, stereo width and mono bass',
  nod: 'a mixing console utility strip with mid/side width',
  params: [
    { key: 'gain', label: 'GAIN', min: -36, max: 18, def: 0, unit: 'dB', role: 'level', desc: 'louder or quieter' },
    { key: 'pan', label: 'PAN', min: -1, max: 1, def: 0, role: 'width', desc: 'left to right (balance)' },
    {
      key: 'width',
      label: 'WIDTH',
      min: 0,
      max: 2,
      def: 1,
      unit: 'x',
      role: 'width',
      desc: 'mono (0) to as recorded (1) to extra wide (2)',
    },
    {
      key: 'monobass',
      label: 'MONO BASS',
      min: 20,
      max: 500,
      def: 20,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'everything below this goes mono (tight low end) with MONO MODE at STEEP',
    },
    {
      key: 'mono_mode',
      label: 'MONO MODE',
      opts: ['ORIGINAL', 'STEEP'],
      def: 0,
      role: 'shape',
      desc: 'STEEP takes the side out under MONO BASS for real (24 dB per octave): use it. ORIGINAL is the first, gentle split songs made before it keep; it leaves much of the side in place',
    },
  ],
  look: {
    color: '#36414f',
    ink: '#e8eef7',
    shape: 'mini',
    finish: 'brushed',
    knob: 'small',
    label: 'plate',
    led: '#9fe7ff',
  },
  tail: 0,
  kernel: kernel(String.raw`
return {
  create({ sr }) {
    const lo = svf(sr), lo2 = svf(sr), hi = svf(sr), hi2 = svf(sr);
    const gS = glide(20, sr, 1), pS = glide(20, sr, 0), wS = glide(20, sr, 1), mbOn = glide(30, sr, 0);
    // MONO MODE: 0 ORIGINAL, 1 STEEP, crossfaded (starting where the song starts it)
    let stS = null;
    return {
      process(L, R, n, P) {
        lo.set(P.monobass, 0.5); lo2.set(P.monobass, 0.5); hi.set(P.monobass, 0.7071); hi2.set(P.monobass, 0.7071);
        const g = dbg(P.gain), mbT = P.monobass > 20.5 ? 1 : 0, stT = (P.mono_mode | 0) === 1 ? 1 : 0;
        if (!stS) stS = glide(30, sr, stT);
        for (let i = 0; i < n; i++) {
          const l = L[i], r = R[i];
          const m = 0.5 * (l + r);
          let s = 0.5 * (l - r);
          // mono bass: take the side's lows out. ORIGINAL: a 2nd-order low-pass twice, subtracted; STEEP: what is left
          // is the side through two 2nd-order Butterworth high passes (Linkwitz-Riley, 24 dB per octave)
          const sl = lo2.tick(lo.tick(s)), on = mbOn.next(mbT);
          hi.tick(s); hi2.tick(hi.hp);
          const st = stS.next(stT);
          s -= st === 0 ? sl * on : (sl + (s - hi2.hp - sl) * st) * on;
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
