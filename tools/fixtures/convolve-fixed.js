// The fixed FFT and convolution whose SHA-256 every engine must agree on (tools/convolver-test.js in Node,
// tools/compat-test.js in Chromium's, WebKit's and Firefox's audio worklets). Plain JS, no imports: the browser loads it
// too. Inputs are integers over 32768 (exact anywhere), from a linear congruential generator.
export const FIXED_TWIDDLES_SHA = '55702b70c5fc9d6aaf02053cbb4e6777ca6f5e932bf322c0bca7345c24a80451';
export const FIXED_CONVOLUTION_SHA = '2890e02498e48e25082dcc93ba7a21f366bfa2b2230fc41f2b7acb355fb75dbd';

function ints(n, seed) {
  let s = seed >>> 0;
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = ((s >>> 16) - 32768) / 32768; }
  return a;
}

// an impulse at sample 1 through fft(256) and fft(2048): its spectrum is the twiddles, e^(-2 pi i k / n)
export function fixedTwiddles(fft) {
  const out = new Float64Array(2 * (129 + 1025));
  let o = 0;
  for (const n of [256, 2048]) {
    const F = fft(n), x = new Float64Array(n), Xr = new Float64Array(n / 2 + 1), Xi = new Float64Array(n / 2 + 1);
    x[1] = 1;
    F.forward(x, Xr, Xi);
    out.set(Xr, o); o += Xr.length; out.set(Xi, o); o += Xi.length;
  }
  return out;
}

// 4,800 taps (a decaying noise, like a short room or a long cab), direct: 128, 24,000 frames fed 37 at a time
export function fixedConvolution(convolver) {
  const L = 4800, N = 24000, h = ints(L, 7), x = ints(N, 11);
  for (let i = 0; i < L; i++) h[i] *= (L - i) / L;
  const C = convolver(h, { direct: 128 }), y = new Float64Array(N);
  for (let i = 0; i < N; i += 37) { const m = Math.min(37, N - i); C.process(x.subarray(i, i + m), y.subarray(i, i + m), null, m); }
  return y;
}
