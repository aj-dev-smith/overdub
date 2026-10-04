// core.crush: Chewed Tape. Fewer bits and a lower sample rate, on purpose: the sound of early samplers and game consoles.
// RATE holds each sample (zero-order hold at a fractional rate, so any rate works, not just divisions), BITS rounds
// the level to fewer steps (fractional bits are fine: the step size moves smoothly), and a gentle anti-alias low-pass before the hold
// (SMOOTH) chooses between crunchy aliasing and a cleaner, darker lo-fi. MIX blends the clean signal back in.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.crush', name: 'Chewed Tape', kind: 'effect', cat: 'glitch', by: 'overdub',
  blurb: 'Bitcrusher and sample-rate reducer: lo-fi grit',
  nod: 'an early 12-bit sampler and an 8-bit game console',
  params: [
    { key: 'bits', label: 'BITS', min: 1, max: 16, def: 10, unit: 'x', role: 'drive', desc: 'fewer bits: hiss, then grit, then broken' },
    { key: 'rate', label: 'RATE', min: 400, max: 48000, def: 22000, curve: 'log', unit: 'Hz', role: 'tone', desc: 'lower rates alias: metallic, then robotic' },
    { key: 'smooth', label: 'SMOOTH', min: 0, max: 1, def: 0.3, role: 'tone', desc: 'raw aliasing (0) or filtered before it is held (1)' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', desc: 'clean to fully chewed' },
  ],
  look: { color: '#b2466d', ink: '#fff0f5', shape: 'mini', finish: 'stripe', knob: 'cream', label: 'block', led: '#ffd36b' },
  tail: 0.02,
  kernel: kernel(String.raw`
return {
  create({ sr }) {
    const aL = svf(sr), aR = svf(sr);
    let ph = 1, hl = 0, hr = 0;
    const mS = glide(20, sr, 1), bS = glide(30, sr, 10);
    return {
      process(L, R, n, P) {
        const step = Math.min(1, P.rate / sr);
        const fc = Math.min(sr * 0.45, P.rate * 0.45);
        aL.set(fc, 0.6); aR.set(fc, 0.6);
        const sm = P.smooth;
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          const fl = aL.tick(xl), fr = aR.tick(xr);
          const il = xl + (fl - xl) * sm, ir = xr + (fr - xr) * sm;
          ph += step; if (ph >= 1) { ph -= 1; hl = il; hr = ir; }
          const b = bS.next(P.bits), q = Math.pow(2, b - 1);
          // fractional bits: between the two neighbouring step sizes
          const yl = Math.round(hl * q) / q, yr = Math.round(hr * q) / q;
          const m = mS.next(P.mix);
          L[i] = xl + (yl - xl) * m; R[i] = xr + (yr - xr) * m;
        }
      },
    };
  },
};
`),
});
