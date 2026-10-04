// core.drive: Hot Print. A saturator: a tilt into a 2x oversampled waveshaper (a smooth tanh with a BIAS that leans it
// asymmetric for even, tube-like harmonics), a TONE low-pass after, and a level that follows the drive so turning it up
// adds heat rather than volume. MIX blends the clean signal back in, delayed to match the oversampler (no combing).
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.drive', name: 'Hot Print', kind: 'effect', cat: 'drive', by: 'overdub',
  blurb: 'Warm saturation to full fuzz, with tone and blend',
  nod: 'a tube / tape style saturator',
  params: [
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.3, role: 'drive', desc: 'warmth, then crunch, then fuzz' },
    { key: 'bias', label: 'BIAS', min: 0, max: 1, def: 0.2, role: 'shape', desc: 'symmetric and tight (0) to lopsided and tube-like' },
    { key: 'tone', label: 'TONE', min: 800, max: 18000, def: 9000, curve: 'log', unit: 'Hz', role: 'tone', desc: 'tames the fizz above this' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', desc: 'clean to all dirt' },
    { key: 'output', label: 'OUTPUT', min: -18, max: 12, def: 0, unit: 'dB', role: 'level', desc: 'level after the drive' },
  ],
  look: { color: '#ad4222', ink: '#fff0d2', shape: 'box', finish: 'hammer', knob: 'cream', label: 'block', led: '#ff7a2f' },
  latency: 15 / 48000, tail: 0.05,
  kernel: kernel(String.raw`
// level back out after the shaper, dB, at DRIVE 0, 0.1 .. 1 (measured on the test program, tools/sounds-test.js): the
// level rises gently with DRIVE (about +0.5 LU clean to +2.5 LU flat out) instead of the raw shaper's +19
const COMP = [-1.27, 2.0, 5.13, 8.0, 10.48, 12.47, 13.92, 14.91, 15.54, 15.94, 16.16];
return {
  create({ sr }) {
    let bias = 0.2, dc0 = 0;
    const shape = (x) => sat(x + bias) - dc0;
    const oL = os2(shape), oR = os2(shape);
    const dL = delayLine(64), dR = delayLine(64);
    const lpL = svf(sr), lpR = svf(sr), dcL = dcblock(sr), dcR = dcblock(sr);
    const dS = glide(30, sr), mS = glide(30, sr, 1), oS = glide(30, sr, 1);
    return {
      latency: 15,
      process(L, R, n, P) {
        bias = P.bias * 0.45; dc0 = sat(bias);
        lpL.set(P.tone, 0.6); lpR.set(P.tone, 0.6);
        const out = dbg(P.output);
        let gin = 1, gout = 1;
        for (let i = 0; i < n; i++) {
          if ((i & 15) === 0) {
            const d = dS.next(P.drive), x = clamp(d, 0, 1) * 10, k = Math.min(9, x | 0), f = x - k;
            gin = Math.pow(10, d * 36 / 20); gout = Math.pow(10, -(COMP[k] + (COMP[k + 1] - COMP[k]) * f) / 20);
          }
          const xl = L[i], xr = R[i];
          const yl = lpL.tick(dcL(oL(xl * gin))) * gout, yr = lpR.tick(dcR(oR(xr * gin))) * gout;
          const cl = dL.tap(15), cr = dR.tap(15);
          dL.write(xl); dR.write(xr);
          const m = mS.next(P.mix), o = oS.next(out);
          L[i] = (cl + (yl - cl) * m) * o; R[i] = (cr + (yr - cr) * m) * o;
        }
      },
    };
  },
};
`),
});
