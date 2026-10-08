// The FFT and the partitioned convolver behind dsp.fft and dsp.convolver (kernel/dsp.js lists them; docs/DEVICES.md
// and kernel/guide.js document them). They run in the AudioWorkletGlobalScope as well as in Node (kernel/dsp.js
// imports this module, and kernel/processor.js imports that), so the top level uses nothing but the language.
//
//   fft(n)                       n a power of two, 16..8192: a real FFT
//     .forward(x, Xr, Xi)        x: n reals -> Xr, Xi: n/2 + 1 bins (DC and Nyquist real)
//     .inverse(Xr, Xi, x)        back, scaled by 1/n, so inverse(forward(x)) is x
//   convolver(taps, { head = 128, body = 1024, direct = 0 })
//     taps: one channel (a Float32Array / Float64Array / array of numbers) or [left, right]: one output per channel
//     .process(x, outL, outR, n) the input x (mono) convolved with the taps into outL (and outR, for two channels;
//                                with one channel outR, if given, gets the same). x may be outL (in place).
//     .latency                   frames the wet output is late: `head` (0006's design, a fixed 128) or 0 with `direct`
//     .set(taps)                 new taps (up to the length it was made for), planned in place: no allocation
//     .reset()                   clear the history (silence in, silence out from the next sample)
//   dsin(x), dcos(x)             the sine series below (for tools that must build the same doubles: tools/kits/)
//
// How it convolves (intent 0006's design, R1-R5; Gardner, "Efficient convolution without input-output delay", JAES
// 43(3), 1995): two levels of uniformly partitioned overlap-save. The head runs in `head`-frame blocks (2 * head-point
// real FFTs) and covers the taps up to `body`; the body runs in `body`-frame blocks from tap `body` on, and its block's
// result is due exactly when it is computed. The input spectra wait in a frequency-domain delay line per level, and
// each completed block multiplies them by the taps' spectra and adds the inverse into one output ring. With `direct`
// (only `direct: head`), the first `head` taps are convolved in the time domain, sample by sample, so the output has
// no latency; the head's partitions take over from tap `head`.
//
// Bit-exact on every engine: Float64 throughout, IEEE basic operations only (+ - * /, Math.round, Math.floor) in a
// fixed order (JS never fuses a multiply and an add), and the twiddles come from a sine series rather than Math.sin,
// whose last bit differs between engines. Scaling is by 1/n, a power of two, so it is exact. Every block is computed
// at the same input sample whatever frames the host passes, so a split of 1..128 frames gives the same output.
// Nothing allocates after creation.

// sin(x) from + - * / and Math.round alone: the same doubles everywhere (the series sampler.js's sinc table uses,
// copied rather than shared: sampler.js keeps its own inside its kernel source, which songs carry)
export function dsin(x) {
  const k = Math.round(x / (2 * Math.PI)); x -= k * 2 * Math.PI;
  if (x > Math.PI / 2) x = Math.PI - x; else if (x < -Math.PI / 2) x = -Math.PI - x;
  const x2 = x * x; let term = x, s = x;
  for (let n = 1; n < 12; n++) { term *= -x2 / ((2 * n) * (2 * n + 1)); s += term; }
  return s;
}
export const dcos = (x) => dsin(Math.PI / 2 - x);

// A real FFT of n points through a complex one of n/2 (even samples real, odd imaginary), then the split.
export function fft(n) {
  n = n | 0;
  if (n < 16 || n > 8192 || (n & (n - 1))) throw new Error(`dsp.fft(${n}): n must be a power of two from 16 to 8192`);
  const M = n >> 1, H = M >> 1;
  // the complex FFT's twiddles e^(-2 pi i k / M), k < M/2, and the split's e^(-2 pi i k / n), k <= M/2
  const cr = new Float64Array(H), ci = new Float64Array(H);
  for (let k = 0; k < H; k++) { const a = (2 * Math.PI * k) / M; cr[k] = dcos(a); ci[k] = -dsin(a); }
  const wr = new Float64Array(H + 1), wi = new Float64Array(H + 1);
  for (let k = 0; k <= H; k++) { const a = (2 * Math.PI * k) / n; wr[k] = dcos(a); wi[k] = -dsin(a); }
  // the bit-reversed order of M
  const rev = new Uint32Array(M);
  let bits = 0; while ((1 << bits) < M) bits++;
  for (let i = 0; i < M; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const zr = new Float64Array(M), zi = new Float64Array(M);

  // in place on zr, zi (already in bit-reversed order): a twiddle-free radix-4 pass (the first two radix-2 stages,
  // the same operations in the same order), then radix-2 stages. sign -1 forward, +1 inverse (conjugate twiddles).
  function cfft(sign) {
    for (let i = 0; i < M; i += 4) {
      const ar = zr[i], ai = zi[i], br = zr[i + 1], bi = zi[i + 1], er = zr[i + 2], ei = zi[i + 2], fr = zr[i + 3], fi = zi[i + 3];
      const s0r = ar + br, s0i = ai + bi, d0r = ar - br, d0i = ai - bi;
      const s1r = er + fr, s1i = ei + fi, d1r = er - fr, d1i = ei - fi;
      // the second stage's odd twiddle is -i forward, +i inverse
      const tr = sign < 0 ? d1i : -d1i, ti = sign < 0 ? -d1r : d1r;
      zr[i] = s0r + s1r; zi[i] = s0i + s1i;
      zr[i + 2] = s0r - s1r; zi[i + 2] = s0i - s1i;
      zr[i + 1] = d0r + tr; zi[i + 1] = d0i + ti;
      zr[i + 3] = d0r - tr; zi[i + 3] = d0i - ti;
    }
    for (let len = 8; len <= M; len <<= 1) {
      const half = len >> 1, step = M / len;
      for (let i = 0; i < M; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const w1 = cr[k], w2 = sign < 0 ? ci[k] : -ci[k];
          const p = i + j, q = p + half;
          const xr = zr[q] * w1 - zi[q] * w2, xi = zr[q] * w2 + zi[q] * w1;
          zr[q] = zr[p] - xr; zi[q] = zi[p] - xi;
          zr[p] = zr[p] + xr; zi[p] = zi[p] + xi;
        }
      }
    }
  }

  return {
    n,
    forward(x, Xr, Xi) {
      for (let i = 0; i < M; i++) { const r = rev[i]; zr[r] = x[2 * i]; zi[r] = x[2 * i + 1]; }
      cfft(-1);
      // X[k] = (Z[k] + conj Z[M-k]) / 2 - i W^k (Z[k] - conj Z[M-k]) / 2
      Xr[0] = zr[0] + zi[0]; Xi[0] = 0;
      Xr[M] = zr[0] - zi[0]; Xi[M] = 0;
      for (let k = 1; k <= H; k++) {
        const j = M - k;
        const er = (zr[k] + zr[j]) * 0.5, ei = (zi[k] - zi[j]) * 0.5;
        const or = (zi[k] + zi[j]) * 0.5, oi = (zr[j] - zr[k]) * 0.5;
        const tr = wr[k] * or - wi[k] * oi, ti = wr[k] * oi + wi[k] * or;
        // (X[M-k] = conj(E) - conj(W^k O); at k = M/2 the two are the same bin, written once)
        if (j !== k) { Xr[j] = er - tr; Xi[j] = ti - ei; }
        Xr[k] = er + tr; Xi[k] = ei + ti;
      }
    },
    inverse(Xr, Xi, x) {
      // Z[k] = E[k] + i O[k], with E = (X[k] + conj X[M-k]) / 2 and O = (X[k] - conj X[M-k]) / 2 * conj(W^k); the
      // complex inverse after it is scaled by 2/n (exact: a power of two)
      zr[0] = (Xr[0] + Xr[M]) * 0.5; zi[0] = (Xr[0] - Xr[M]) * 0.5;
      for (let k = 1; k <= H; k++) {
        const j = M - k;
        const er = (Xr[k] + Xr[j]) * 0.5, ei = (Xi[k] - Xi[j]) * 0.5;
        const dr = (Xr[k] - Xr[j]) * 0.5, di = (Xi[k] + Xi[j]) * 0.5;
        // O = D * conj(W^k), then Z[k] = E + i O and Z[M-k] = conj(E) + i conj(O)
        const or = dr * wr[k] + di * wi[k], oi = di * wr[k] - dr * wi[k];
        zr[k] = er - oi; zi[k] = ei + or;
        if (j !== k) { zr[j] = er + oi; zi[j] = or - ei; }
      }
      // bit-reverse in place (a swap per pair), then the inverse transform
      for (let i = 0; i < M; i++) { const r = rev[i]; if (r > i) { let t = zr[i]; zr[i] = zr[r]; zr[r] = t; t = zi[i]; zi[i] = zi[r]; zi[r] = t; } }
      cfft(1);
      const s = 2 / n;
      for (let i = 0; i < M; i++) { x[2 * i] = zr[i] * s; x[2 * i + 1] = zi[i] * s; }
    },
  };
}

// One level of uniformly partitioned overlap-save: block B (FFT 2B), partitions over taps [a, a + P * B).
function level(B, a, P, ffts) {
  const N = 2 * B, K = B + 1, F = ffts(N);
  const hr = [], hi = [];   // per channel: P spectra of K bins, flat
  return {
    B, a, P, F, K,
    used: 0,                 // partitions with taps in them (the rest are skipped)
    xr: new Float64Array(P * K), xi: new Float64Array(P * K),   // the input spectra, a ring of P
    slot: 0,
    hr, hi,
    frame: new Float64Array(N), tr: new Float64Array(K), ti: new Float64Array(K), yr: new Float64Array(K), yi: new Float64Array(K), out: new Float64Array(N),
  };
}

export function convolver(taps, opts = {}) {
  const chans = Array.isArray(taps) && taps.length && typeof taps[0] === 'object' && taps[0] && taps[0].length != null ? taps : [taps];
  if (chans.length < 1 || chans.length > 2) throw new Error('dsp.convolver: taps are one channel or [left, right]');
  const C = chans.length;
  const cap = Math.max(1, ...chans.map((c) => c.length | 0));
  const HB = opts.head == null ? 128 : opts.head | 0, BB = opts.body == null ? 1024 : opts.body | 0;
  if (!(HB >= 8 && HB <= 4096 && !(HB & (HB - 1))) || !(BB > HB && BB <= 4096 && !(BB & (BB - 1)))) throw new Error('dsp.convolver: head and body are powers of two, head 8..4096 and body above it');
  const DIRECT = opts.direct ? HB : 0;
  if (opts.direct && (opts.direct | 0) !== HB) throw new Error(`dsp.convolver: direct is the head's length (${HB}) or nothing`);
  const D = DIRECT ? 0 : HB;   // the latency
  const ffts = (n) => fft(n);

  // the levels: the head from DIRECT to min(cap, BB), the body from BB on
  const hp = Math.max(0, Math.ceil((Math.min(cap, BB) - DIRECT) / HB));
  const bp = cap > BB ? Math.ceil((cap - BB) / BB) : 0;
  const levels = [];
  if (hp) levels.push(level(HB, DIRECT, hp, ffts));
  if (bp) levels.push(level(BB, BB, bp, ffts));
  for (const L of levels) for (let c = 0; c < C; c++) { L.hr.push(new Float64Array(L.P * L.K)); L.hi.push(new Float64Array(L.P * L.K)); }

  // the input history (a power-of-two ring long enough for the body's 2 blocks and the direct taps)
  let RN = 1; while (RN < 2 * BB + DIRECT + 8) RN <<= 1;
  // (twice over: every sample is written at p and p + RN, so the direct taps read a run without wrapping)
  const RM = RN - 1, hist = new Float64Array(2 * RN);
  // the output ring: every level adds its block where it is due; read and cleared sample by sample
  let ON = 1; while (ON < BB + BB + D + HB + 8) ON <<= 1;
  const OM = ON - 1, ring = [];
  for (let c = 0; c < C; c++) ring.push(new Float64Array(ON));
  // the direct taps, per channel
  const dt = [];
  for (let c = 0; c < C; c++) dt.push(new Float64Array(DIRECT));
  let t = 0;          // input samples taken (also the output's time)
  const len = new Int32Array(C);

  function plan(list) {
    for (let c = 0; c < C; c++) {
      const h = list[c], n = Math.min(cap, h.length | 0);
      len[c] = n;
      for (let i = 0; i < DIRECT; i++) dt[c][i] = i < n ? +h[i] : 0;
      for (const L of levels) {
        const fr = L.frame;
        for (let p = 0; p < L.P; p++) {
          const s = L.a + p * L.B;
          for (let i = 0; i < L.B; i++) { const j = s + i; fr[i] = j < n ? +h[j] : 0; }
          for (let i = L.B; i < 2 * L.B; i++) fr[i] = 0;
          L.F.forward(fr, L.tr, L.ti);
          L.hr[c].set(L.tr, p * L.K); L.hi[c].set(L.ti, p * L.K);
        }
      }
    }
    let n = 0;
    for (let c = 0; c < C; c++) if (len[c] > n) n = len[c];
    for (const L of levels) L.used = Math.max(0, Math.min(L.P, Math.ceil((n - L.a) / L.B)));
  }

  // a level's block has completed at input time t (the sample t - 1 was its last): FFT the last 2B inputs, multiply
  // by every partition's spectrum against the input spectra behind it, and add the inverse's valid half to the ring
  // at the times it is due (the block's first output sample is due at t - B + a + D)
  function blockDone(L) {
    const B = L.B, N = 2 * B, K = L.K, fr = L.frame;
    for (let i = 0; i < N; i++) fr[i] = hist[(t - N + i) & RM];
    const s0 = L.slot * K;
    L.F.forward(fr, L.tr, L.ti);
    L.xr.set(L.tr, s0); L.xi.set(L.ti, s0);
    const due = t - B + L.a + D;
    for (let c = 0; c < C; c++) {
      const yr = L.yr, yi = L.yi, Hr = L.hr[c], Hi = L.hi[c];
      yr.fill(0); yi.fill(0);
      for (let p = 0; p < L.used; p++) {
        let sl = L.slot - p; if (sl < 0) sl += L.P;
        const xo = sl * K, ho = p * K, xr = L.xr, xi = L.xi;
        for (let k = 0; k < K; k++) {
          const ar = xr[xo + k], ai = xi[xo + k], br = Hr[ho + k], bi = Hi[ho + k];
          yr[k] += ar * br - ai * bi;
          yi[k] += ar * bi + ai * br;
        }
      }
      L.F.inverse(yr, yi, L.out);
      const R = ring[c], o = L.out;
      for (let i = 0; i < B; i++) { const q = (due + i) & OM; R[q] += o[B + i]; }
    }
    L.slot = L.slot + 1 === L.P ? 0 : L.slot + 1;
  }

  const api = {
    latency: D,
    set(list) {
      const l = chans.length === 1 && !(Array.isArray(list) && list.length && typeof list[0] === 'object' && list[0] && list[0].length != null) ? [list] : list;
      if (!l || l.length !== C) throw new Error(`dsp.convolver: set() takes ${C} channel${C > 1 ? 's' : ''}, as it was made`);
      plan(l);
      return api;
    },
    reset() {
      hist.fill(0); for (const R of ring) R.fill(0);
      for (const L of levels) { L.xr.fill(0); L.xi.fill(0); L.slot = 0; }
      t = 0;
      return api;
    },
    process(x, outL, outR, n) {
      n = n == null ? x.length : n;
      const two = C === 2;
      for (let i = 0; i < n; i++) {
        const v = +x[i];
        const hp = t & RM;
        hist[hp] = v; hist[hp + RN] = v;
        // the output at t: the ring (the partitions' sum) plus the direct taps
        const q = t & OM;
        let yl = ring[0][q]; ring[0][q] = 0;
        let yr = 0;
        if (two) { yr = ring[1][q]; ring[1][q] = 0; }
        if (DIRECT) {
          const h0 = dt[0];
          let s = 0;
          const b = hp + RN;
          for (let k = 0; k < DIRECT; k++) s += h0[k] * hist[b - k];
          yl += s;
          if (two) { const h1 = dt[1]; let s1 = 0; for (let k = 0; k < DIRECT; k++) s1 += h1[k] * hist[b - k]; yr += s1; }
        }
        t++;
        for (let j = 0; j < levels.length; j++) { const L = levels[j]; if (L.used && (t % L.B) === 0) blockDone(L); }
        outL[i] = yl;
        if (outR) outR[i] = two ? yr : yl;
      }
    },
  };
  plan(chans);
  return api;
}
