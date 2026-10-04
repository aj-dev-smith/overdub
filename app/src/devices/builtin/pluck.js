// core.pluck: Pinch Roller. A plucked string (extended Karplus-Strong): a burst of seeded noise, shaped by where the pick
// hits (a comb notch at the pick position) and how hard (softer is darker), circulates in a tuned delay loop with a
// one-zero damping filter and an allpass for exact tuning, losing just enough each pass to ring for DECAY seconds.
// Letting go of a key mutes the string over MUTE. Then a wooden body: four resonances (air, top, back, the bright
// knock) added to the strings, more or less of it with BODY. About -16 LUFS on the test phrase at defaults.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.pluck', name: 'Pinch Roller', kind: 'instrument', cat: 'pluck', by: 'overdub',
  blurb: 'Plucked strings: guitar, harp, koto, music box',
  nod: 'a physically modelled plucked string with a wooden body',
  params: [
    { key: 'tone', label: 'TONE', min: 0, max: 1, def: 0.55, role: 'tone', desc: 'dark nylon to bright steel' },
    { key: 'decay', label: 'DECAY', min: 0.2, max: 12, def: 3.5, curve: 'log', unit: 's', role: 'decay', desc: 'how long a string rings (low strings ring longer)' },
    { key: 'pick', label: 'PICK', min: 0.04, max: 0.5, def: 0.18, role: 'shape', desc: 'where it is plucked: near the bridge is thin and twangy, the middle round' },
    { key: 'body', label: 'BODY', min: 0, max: 1, def: 0.5, role: 'tone', desc: 'how much wooden body resonance' },
    { key: 'mute', label: 'MUTE', min: 0.03, max: 3, def: 0.35, curve: 'log', unit: 's', role: 'release', desc: 'how fast a string stops once the key lets go' },
    { key: 'spread', label: 'SPREAD', min: 0, max: 1, def: 0.5, role: 'width', desc: 'low strings left, high strings right, like sitting at a harp' },
  ],
  look: { color: '#8f6224', ink: '#fff1d6', shape: 'box', finish: 'stripe', knob: 'cream', label: 'script', led: '#f1dc8a' },
  tail: 12,
  kernel: kernel(String.raw`
return {
  poly: 12,
  create({ sr, seed }) {
    const r = rng(seed ^ 0x9a1d);
    // the body (shared, after the strings): air, top, back, and a bright knock
    const BF = [102, 196, 388, 2400], BQ = [5, 4.5, 3.5, 1.6], BG = [1.0, 0.8, 0.5, 0.25];
    const bl = BF.map(() => svf(sr)), br = BF.map(() => svf(sr));
    BF.forEach((f, i) => { bl[i].set(f, BQ[i]); br[i].set(f * 1.03, BQ[i]); });
    const MAX = Math.ceil(sr / 25) + 8;
    return {
      voice() {
        const buf = new Float32Array(MAX), exc = new Float32Array(MAX);
        let N = 100, w = 0, b = 0.3, g = 0.999, gMute = 0.9, a = 0, x1 = 0, y1 = 0, s1 = 0, released = false, lvl = 0, pan = [1, 1], quiet = 0, frac = 0, t = 0;
        let gNow = 0.999, atk = 1;
        return {
          start(p, v, P) {
            const f = mtof(p), per = sr / f;
            b = 0.5 - 0.42 * P.tone;                              // one-zero damping: 0.5 = averaging (dark), lower = brighter
            const D = per - b;                                    // the loop's delay minus the filter's own
            N = Math.max(2, Math.floor(D - 0.15)); frac = D - N; a = (1 - frac) / (1 + frac);
            // loop gain for the decay (lower strings ring a little longer)
            const T60 = P.decay * Math.pow(2, -(p - 52) / 36);
            g = Math.pow(10, -3 / (T60 * f));
            gMute = Math.pow(10, -3 / (Math.max(0.02, P.mute) * f));
            gNow = g;
            // excitation: the string's shape as the pick lets go (a triangle peaking at the pick point) with some
            // noise for the pick's scrape, darker when soft
            const pk = Math.max(1, Math.round(P.pick * N)), nAmt = 0.12 + 0.3 * P.tone, lp = 0.2 + 0.65 * v * (0.35 + 0.65 * P.tone);
            let y = 0, m = 0;
            for (let i = 0; i < N; i++) {
              const tri = i < pk ? i / pk : (N - i) / (N - pk);
              y += ((1 - nAmt) * tri + nAmt * r() - y) * lp; exc[i] = y; m += y;
            }
            m /= N;
            let pkAbs = 1e-9; for (let i = 0; i < N; i++) { exc[i] -= m; pkAbs = Math.max(pkAbs, Math.abs(exc[i])); }
            const amp = (0.25 + 0.75 * v) / pkAbs;
            // pluck into a ringing string: add to what is there (a re-plucked string keeps some of its old motion)
            for (let i = 0; i < N; i++) buf[(w + i) % N] = buf[(w + i) % N] * 0.3 + exc[i] * amp;
            x1 = y1 = s1 = 0; released = false; quiet = 0; t = 0; atk = 0;
            pan = panLR(clamp((p - 60) / 30, -1, 1) * P.spread * 0.6);
          },
          release(P) { released = true; gMute = Math.pow(10, -3 / (Math.max(0.02, P.mute) * 220)); },
          render(L, R, n, P) {
            let pk = 0;
            const target = released ? Math.min(g, gMute) : g;
            for (let i = 0; i < n; i++) {
              gNow += (target - gNow) * 0.002;
              const s = buf[w];
              const lpY = gNow * ((1 - b) * s + b * s1); s1 = s;
              const y = a * lpY + x1 - a * y1; x1 = lpY; y1 = y;   // allpass: the fractional part of the period
              buf[w] = y; w++; if (w >= N) w = 0;
              if (atk < 1) atk = Math.min(1, atk + 1 / (0.0006 * sr));   // a pick's edge, not a step
              const o = s * 0.3 * atk;
              L[i] += o * pan[0]; R[i] += o * pan[1];
              const ao = o < 0 ? -o : o; if (ao > pk) pk = ao;
            }
            t += n;
            if (pk < 2e-5) quiet += n; else quiet = 0;
            return quiet < sr * 0.05;
          },
          stop() { buf.fill(0); },
        };
      },
      process(L, R, n, P) {
        const amt = P.body, OUT = 0.78;
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          let bl0 = 0, br0 = 0;
          for (let k = 0; k < 4; k++) { bl[k].tick(xl); br[k].tick(xr); bl0 += bl[k].bp * BG[k]; br0 += br[k].bp * BG[k]; }
          L[i] = knee((xl * (1 - 0.35 * amt) + bl0 * amt * 1.1) * OUT);
          R[i] = knee((xr * (1 - 0.35 * amt) + br0 * amt * 1.1) * OUT);
        }
      },
    };
  },
};
`),
});
