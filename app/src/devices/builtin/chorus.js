// core.chorus: Double Track. Two modulated delay taps per side, their sweeps a quarter-cycle apart between left and
// right (so a mono source opens into stereo), with a little seeded drift so the sweep never sounds like a metronome.
// FEEDBACK pushes it toward a flanger. Equal-gain mixing keeps the level where it was.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.chorus', name: 'Double Track', kind: 'effect', cat: 'mod', by: 'overdub',
  blurb: 'Shimmering stereo chorus, to flanger with feedback',
  nod: 'an analog bucket-brigade stereo chorus',
  params: [
    { key: 'rate', label: 'RATE', min: 0.05, max: 8, def: 0.7, curve: 'log', unit: 'Hz', role: 'rate', desc: 'how fast it sweeps' },
    { key: 'depth', label: 'DEPTH', min: 0, max: 1, def: 0.5, role: 'depth', desc: 'how far it sweeps: subtle to seasick' },
    { key: 'delay', label: 'DELAY', min: 1, max: 30, def: 9, curve: 'log', unit: 'ms', role: 'time', desc: 'short is flangey, long is doubled' },
    { key: 'feedback', label: 'FEEDBACK', min: 0, max: 0.85, def: 0, role: 'feedback', desc: 'metallic jet-plane resonance' },
    { key: 'width', label: 'WIDTH', min: 0, max: 1, def: 1, role: 'width', desc: 'mono to fully spread' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 0.5, role: 'mix', desc: 'dry to all chorus' },
  ],
  look: { color: '#22355e', ink: '#eef3ff', shape: 'box', finish: 'sparkle', knob: 'chrome', label: 'script', led: '#8fd8ff' },
  tail: 0.2,
  kernel: kernel(String.raw`
return {
  create({ sr, seed }) {
    const M = Math.ceil(0.06 * sr);
    const dl = delayLine(M), dr = delayLine(M);
    const wr = rng(seed ^ 0xc41c);
    let ph = 0, drift = 0, driftT = 0, cnt = 0, fbl = 0, fbr = 0;
    const mixS = glide(30, sr), dS = glide(80, sr), depS = glide(40, sr), wS = glide(30, sr);
    return {
      process(L, R, n, P) {
        const dt = P.rate / sr, fb = P.feedback;
        for (let i = 0; i < n; i++) {
          ph += dt; if (ph >= 1) ph -= 1;
          if ((cnt++ & 4095) === 0) driftT = wr();
          drift += (driftT - drift) * 0.0003;
          const base = dS.next(P.delay) * sr / 1000, dep = depS.next(P.depth) * Math.min(base * 0.9, 0.004 * sr) * 0.5;
          const p2 = ph + 0.25 + drift * 0.05;
          const a = dl.cubic(Math.max(2, base + dep * (1 + sinT(ph)))), b = dl.cubic(Math.max(2, base * 1.13 + dep * (1 + sinT((ph + 0.5) % 1))));
          const c = dr.cubic(Math.max(2, base + dep * (1 + sinT(p2 - Math.floor(p2))))), d = dr.cubic(Math.max(2, base * 1.13 + dep * (1 + sinT((p2 + 0.5) - Math.floor(p2 + 0.5)))));
          const xl = L[i], xr = R[i];
          fbl = (a + b) * 0.5; fbr = (c + d) * 0.5;
          dl.write(xl + fbl * fb); dr.write(xr + fbr * fb);
          const w = wS.next(P.width);
          let wl = fbl * (1 - fb * 0.5), wr2 = fbr * (1 - fb * 0.5);
          const m = 0.5 * (wl + wr2), s = 0.5 * (wl - wr2) * w; wl = m + s; wr2 = m - s;
          const mx = mixS.next(P.mix), dry = 1 - 0.3 * mx, wet = mx;
          L[i] = xl * dry + wl * wet; R[i] = xr * dry + wr2 * wet;
        }
      },
    };
  },
};
`),
});
