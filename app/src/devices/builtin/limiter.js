// @ts-check
// core.limiter: Red Line. A look-ahead brickwall limiter for the master: it sees peaks 1.5 ms before they arrive
// (including the peaks between samples, estimated by interpolation), ducks just enough with a smooth ramp, and recovers
// over RELEASE. Nothing passes the CEILING (in dBTP; -1 by default, the streaming services' ask). GAIN pushes into it
// for loudness. It reports its latency (1.5 ms plus 16 samples) so the studio lines everything else up.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.limiter',
  name: 'Red Line',
  kind: 'effect',
  cat: 'dynamics',
  by: 'overdub',
  blurb: 'Brickwall master limiter: loud, clean, never over',
  nod: 'a transparent look-ahead mastering limiter',
  params: [
    {
      key: 'gain',
      label: 'GAIN',
      min: 0,
      max: 24,
      def: 0,
      unit: 'dB',
      role: 'drive',
      desc: 'push into the limiter: louder, then squashed',
    },
    {
      key: 'ceiling',
      label: 'CEILING',
      min: -12,
      max: 0,
      def: -1,
      unit: 'dB',
      role: 'level',
      desc: 'the most it ever lets out (true peak)',
    },
    {
      key: 'release',
      label: 'RELEASE',
      min: 5,
      max: 1000,
      def: 90,
      curve: 'log',
      unit: 'ms',
      role: 'release',
      desc: 'how fast it recovers: fast is loud, slow is smooth',
    },
  ],
  look: {
    color: '#16130f',
    ink: '#f4ead6',
    shape: 'rack',
    finish: 'brushed',
    knob: 'chrome',
    label: 'plate',
    led: '#ff4d4d',
  },
  latency: 88 / 48000,
  tail: 0.01,
  kernel: kernel(String.raw`
return {
  create({ sr }) {
    // inter-sample peaks: a 3-phase windowed-sinc interpolator over the last 2T samples (detection runs T samples late)
    const T = 16, i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / 2 / k) * (x / 2 / k); s += t; } return s; };
    const PH = [0.25, 0.5, 0.75].map((f) => {
      const row = new Float64Array(2 * T); let sum = 0;
      for (let j = 0; j < 2 * T; j++) { const t = j - (T - 1) - f, u = t / (T + 0.5), w = Math.abs(u) >= 1 ? 0 : i0(8 * Math.sqrt(1 - u * u)) / i0(8); row[j] = (Math.abs(t) < 1e-9 ? 0.94 : Math.sin(Math.PI * 0.94 * t) / (Math.PI * t)) * w; sum += row[j]; }
      for (let j = 0; j < 2 * T; j++) row[j] /= sum;
      return row;
    });
    const hl = new Float64Array(2 * T), hr = new Float64Array(2 * T); let hp = 0;
    const LA = Math.max(8, Math.round(0.0015 * sr) & ~1), H = LA / 2 + 1, W = 2 * H - 1, D = W - 1 + T;
    const dl = delayLine(D + 8), dr = delayLine(D + 8);
    // sliding minimum of the wanted gain over W samples (a monotonic deque in two rings)
    const qv = new Float64Array(W + 2), qi = new Float64Array(W + 2);
    let qh = 0, qt = 0, qn = 0, idx = 0;
    // the smooth ramp: two moving averages of H samples in a row (a triangle W samples long), so the gain bends
    // gently into every peak instead of in straight lines (less splatter, fewer new peaks between samples)
    const b1 = new Float64Array(H).fill(1), b2 = new Float64Array(H).fill(1);
    let s1 = H, s2 = H, p1 = 0, p2 = 0, env = 1, gr = 0, tick = 0;
    const gS = glide(20, sr, 1), cS = glide(20, sr, 1);
    const abs = (x) => (x < 0 ? -x : x);
    return {
      latency: D,
      meter() { return gr; },
      process(L, R, n, P) {
        const rel = coef(P.release / 1000, sr);
        let lo = 1;
        for (let i = 0; i < n; i++) {
          const g = gS.next(dbg(P.gain)), ceil = cS.next(dbg(P.ceiling - 0.1));
          const xl = L[i] * g, xr = R[i] * g;
          // the peak around sample n - T: it and its neighbour, and the three points between them (4x)
          hl[hp] = xl; hr[hp] = xr; hp = (hp + 1) % (2 * T);
          const c0 = (hp + T - 1) % (2 * T), c1 = (hp + T) % (2 * T);
          let pk = Math.max(abs(hl[c0]), abs(hl[c1]), abs(hr[c0]), abs(hr[c1]));
          for (let k = 0; k < 3; k++) {
            const row = PH[k]; let a = 0, b = 0;
            for (let j = 0; j < 2 * T; j++) { const q = (hp + j) % (2 * T); a += hl[q] * row[j]; b += hr[q] * row[j]; }
            pk = Math.max(pk, abs(a), abs(b));
          }
          const want = pk > ceil ? ceil / pk : 1;
          // push into the deque (drop larger values from the back), drop the front once it leaves the window
          while (qn > 0 && qv[(qt + W + 1) % (W + 2)] >= want) { qt = (qt + W + 1) % (W + 2); qn--; }
          qv[qt] = want; qi[qt] = idx; qt = (qt + 1) % (W + 2); qn++;
          while (qi[qh] <= idx - W) { qh = (qh + 1) % (W + 2); qn--; }
          const m = qv[qh];
          idx++;
          // instant down to the sliding minimum, exponential back up
          env = Math.min(m, 1 - (1 - env) * rel);
          s1 += env - b1[p1]; b1[p1] = env; p1 = (p1 + 1) % H;
          const a1 = s1 / H;
          s2 += a1 - b2[p2]; b2[p2] = a1; p2 = (p2 + 1) % H;
          if (++tick >= 4096) { tick = 0; s1 = 0; s2 = 0; for (let k = 0; k < H; k++) { s1 += b1[k]; s2 += b2[k]; } }   // (no drift)
          const gg = Math.min(1, s2 / H);
          if (gg < lo) lo = gg;
          const ol = dl.tap(D), or = dr.tap(D);
          dl.write(xl); dr.write(xr);
          L[i] = ol * gg; R[i] = or * gg;
        }
        gr = lo < 1 ? 20 * Math.log10(lo) : 0;
      },
    };
  },
};
`),
});
