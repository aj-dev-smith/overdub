// core.clipper: Clip Lamp. A clipper for drums and loud masters: DRIVE pushes the sound into a CEILING it never passes,
// and the peaks that would have gone over are cut off (HARD), rounded (SOFT) or leaned on like tape (TAPE), KNEE
// setting how far under the ceiling the bend starts. The clip LED on a console, lit on purpose.
//
// Why a clipper before the limiter: a limiter brings a loud mix down by turning its gain down around each peak, which
// pumps when the peaks are kicks and snares; a clipper takes the top few decibels off each peak in its first
// milliseconds and leaves the rest alone, so the limiter after it has less to do. On a drum bus it trades a few
// decibels of transient for loudness; on a master, Clip Lamp then Red Line (core.limiter) at -1 dBTP is the loud
// master's chain.
//
// It runs at 4x the sample rate (the dsp stdlib's oversample4x: two Kaiser half-band stages up, the curve, the same
// down), so the harmonics it makes above the top of the band are filtered out, not folded back; its latency (27.5
// samples) is declared. At the 4x rate it never puts out a sample over CEILING (the curve ends in a hard stop there);
// the filters after it can rebuild a peak a little over (the overshoot), which meter() reports and the limiter after
// it catches. MIX blends the clean sound (as it came in, before DRIVE) back in at the 4x rate, through the same
// filters, so nothing combs. OUTPUT
// is after everything. At its defaults (DRIVE 0, CEILING 0 dBFS, HARD with no knee) anything under 0 dBFS passes
// as it was, delayed and band-limited by the filters (within 0.1 LU on the house's test signals).
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export const PRESETS = [
  { name: 'Drum bus clip', tags: ['bass-music', 'drums', 'bus'], blurb: 'Drums 4 dB hotter into a hard ceiling at -3 dBFS: the peaks shaved, the punch kept',
    params: { drive: 4, ceiling: -3, knee: 0.15, shape: 'HARD', output: 0, mix: 100 } },
  { name: 'Master clip (+3)', tags: ['bass-music', 'master'], blurb: 'Before Red Line: 3 dB into a ceiling at -1 dBFS, a short knee',
    params: { drive: 3, ceiling: -1, knee: 0.1, shape: 'HARD', output: 0, mix: 100 } },
  { name: 'Master clip (+6)', tags: ['bass-music', 'master'], blurb: 'Before Red Line, loud: 6 dB into a rounded ceiling at -1 dBFS',
    params: { drive: 6, ceiling: -1, knee: 0.25, shape: 'SOFT', output: 0, mix: 100 } },
  { name: 'Bass grit', tags: ['bass-music', 'growl'], blurb: 'A bass pushed hard into tape: thicker, buzzier, the clean bass still under it',
    params: { drive: 14, ceiling: -8, knee: 0.5, shape: 'TAPE', output: 0, mix: 60 } },
];

export default defineDevice({
  id: 'core.clipper', name: 'Clip Lamp', kind: 'effect', cat: 'dynamics', by: 'overdub',
  blurb: 'A clipper: pushes into a ceiling it never passes, 4x oversampled',
  nod: 'the oversampled clippers producers put on drum buses and before the master limiter',
  params: [
    { key: 'drive', label: 'DRIVE', min: 0, max: 24, def: 0, unit: 'dB', role: 'drive', desc: 'how hard it is pushed into the ceiling: each decibel over is a decibel of peak cut off, and the sound gets louder against its peaks' },
    { key: 'ceiling', label: 'CEILING', min: -12, max: 0, def: 0, unit: 'dB', role: 'level', desc: 'the most it lets out (at 4x the sample rate): -1 before a limiter, lower to clip a part harder' },
    { key: 'knee', label: 'KNEE', min: 0, max: 1, def: 0, role: 'shape', desc: 'where the bend starts under the ceiling: 0 a hard corner, 1 six decibels under it (softer, fewer harmonics)' },
    { key: 'shape', label: 'SHAPE', opts: ['HARD', 'SOFT', 'TAPE'], def: 0, role: 'shape', desc: 'HARD cuts the peaks off flat; SOFT rounds them (tanh); TAPE rounds them a little lopsided, for even harmonics' },
    { key: 'output', label: 'OUTPUT', min: -24, max: 6, def: 0, unit: 'dB', role: 'level', desc: 'the level out, after everything' },
    { key: 'mix', label: 'MIX', min: 0, max: 100, def: 100, unit: '%', role: 'mix', desc: 'how much of the clipped sound you hear: lower blends the clean sound back in (parallel clipping)' },
  ],
  presets: PRESETS,
  // a clip LED in a black panel: red, the only colour on it
  look: { color: '#141210', ink: '#f2e4d0', shape: 'mini', finish: 'flat', knob: 'small', label: 'stencil', led: '#ff3b2f' },
  latency: 27.5 / 48000, tail: 0.01,
  kernel: kernel(String.raw`
return {
  create({ sr, dsp }) {
    const oL = dsp.oversample4x(), oR = dsp.oversample4x();
    // the curve for the block (set from the params in process): ceiling c, the bend's start t, shape s, mix m
    let c = 1, t = 1, s = 0, m = 1, b = 0, b0 = 0, bs = 1, over = 0, gi = 1;
    const tanh = Math.tanh;
    const curve = (v) => {
      let y;
      const a = v < 0 ? -v : v;
      if (s === 2) {
        // TAPE: a tanh leaning on a bias (even harmonics), the bias's own offset taken back out, scaled so its lower
        // half meets the ceiling only in the limit (unscaled, it reached -c at about 1.4-2.4 x the ceiling and was cut
        // there flat: a hard clip on one side); the upper half tops out under it, at c (1 - tanh b) / (1 + tanh b)
        y = c * (tanh(v / c + b) - b0) * bs;
      } else if (a <= t) y = v;
      else {
        const w = c - t, u = (a - t) / w;
        // HARD: a quadratic bend from t that meets the ceiling flat at t + 2w; SOFT: a tanh from t
        const k = s === 1 ? tanh(u) : u >= 2 ? 1 : u - 0.25 * u * u;
        y = v < 0 ? -(t + w * k) : t + w * k;
      }
      if (y > c) y = c; else if (y < -c) y = -c;
      // (the clean sound blended back is the sound as it came in, before DRIVE)
      return m === 1 ? y : v * gi + m * (y - v * gi);
    };
    const gS = glide(20, sr, 1), oS = glide(20, sr, 1);
    return {
      latency: oL.latency,
      // how far over the ceiling the last block came out after the filters (dB; 0: not over)
      meter() { return over; },
      process(L, R, n, P) {
        c = Math.pow(10, P.ceiling / 20); s = P.shape | 0; m = P.mix / 100;
        // the bend starts KNEE x 6 dB under the ceiling (SOFT: at least 1.5 dB under, so it is never a corner)
        const kn = s === 1 ? Math.max(P.knee, 0.25) : P.knee;
        t = c * Math.pow(10, -6 * kn / 20);
        if (t > c * 0.9999) t = c;
        b = 0.12 * (0.3 + P.knee); b0 = tanh(b); bs = 1 / (1 + b0);
        const gd = dbg(P.drive), go = dbg(P.output);
        let pk = 0;
        for (let i = 0; i < n; i++) {
          const g = gS.next(gd), o = oS.next(go);
          gi = 1 / g;
          const yl = oL.process(L[i] * g, curve), yr = oR.process(R[i] * g, curve);
          const al = yl < 0 ? -yl : yl, ar = yr < 0 ? -yr : yr;
          if (al > pk) pk = al; if (ar > pk) pk = ar;
          L[i] = yl * o; R[i] = yr * o;
        }
        over = pk > c ? 20 * Math.log10(pk / c) : 0;
      },
    };
  },
};
`),
});
