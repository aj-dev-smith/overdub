// dsp.fft and dsp.convolver (app/src/kernel/convolve.js): the FFT and the two-level partitioned convolver that Half
// Stack's and Iso Cab's cabs run on.
//
// In Node: the FFT against a direct DFT and back again; the convolver against direct convolution on random taps of 1
// to 14,400 frames, one channel and two (within -240 dB of the peak); host splits of 1..128 frames give bit-identical
// output; `direct: 128` has no latency and the same accuracy; set() re-plans in place; reset() clears; the pinned
// SHA-256 of the twiddles (an impulse's spectrum) and of one fixed convolution; nothing allocates in process() (no
// garbage collection while it runs); the cost of a 4096-tap cab and of planning a 200 ms room. The same fixed
// convolution's hash in Chromium's and WebKit's worklets is held by tools/compat-test.js.
//   node tools/convolver-test.js
// local-only: times the convolver's CPU cost against real time (4.5% for a 4096-tap cab): a shared runner measures its neighbours
import crypto from 'node:crypto';
import { PerformanceObserver } from 'node:perf_hooks';
import { tally } from './pw.js';
import { fft, convolver } from '../app/src/kernel/convolve.js';
import { makeDsp, DSP_API } from '../app/src/kernel/dsp.js';
import { FIXED_CONVOLUTION_SHA, FIXED_TWIDDLES_SHA, fixedConvolution, fixedTwiddles } from './fixtures/convolve-fixed.js';

const T = tally('convolver');
const ok = T.ok;
const sha = (a) => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const db = (x) => 20 * Math.log10(Math.max(x, 1e-300));
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
const rand = (n, seed) => { const r = lcg(seed), a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = r(); return a; };

/* ------------------------------------------------------------------ the FFT */
console.log('the FFT');
{
  let worst = -Infinity, round = -Infinity;
  for (let n = 16; n <= 8192; n *= 2) {
    const F = fft(n), x = rand(n, n), Xr = new Float64Array(n / 2 + 1), Xi = new Float64Array(n / 2 + 1);
    F.forward(x, Xr, Xi);
    // a direct DFT, the angle reduced exactly (k i mod n) before the trig, so its own error stays near 1e-16
    let e = 0, pk = 0;
    for (let k = 0; k <= n / 2; k += n > 1024 ? 7 : 1) {
      let a = 0, b = 0;
      for (let i = 0; i < n; i++) { const w = (2 * Math.PI * ((k * i) % n)) / n; a += x[i] * Math.cos(w); b -= x[i] * Math.sin(w); }
      e = Math.max(e, Math.hypot(a - Xr[k], b - Xi[k])); pk = Math.max(pk, Math.hypot(a, b));
    }
    worst = Math.max(worst, db(e / pk));
    const y = new Float64Array(n); F.inverse(Xr, Xi, y);
    let r = 0, xp = 0; for (let i = 0; i < n; i++) { r = Math.max(r, Math.abs(y[i] - x[i])); xp = Math.max(xp, Math.abs(x[i])); }
    round = Math.max(round, db(r / xp));
  }
  ok(worst < -240, `forward matches a direct DFT for n = 16..8192: worst error ${worst.toFixed(1)} dB re the peak bin`);
  ok(round < -280, `inverse(forward(x)) is x for n = 16..8192: worst ${round.toFixed(1)} dB`);
  let threw = 0;
  for (const n of [8, 12, 16384, 100]) { try { fft(n); } catch (e) { threw++; } }
  ok(threw === 4, 'fft(n) refuses n under 16, over 8192 or not a power of two');
  const F = fft(64), Xr = new Float64Array(33), Xi = new Float64Array(33), dc = new Float64Array(64).fill(0.25);
  F.forward(dc, Xr, Xi);
  ok(Xr[0] === 16 && Xi[0] === 0 && Xr.slice(1).every((v) => Math.abs(v) < 1e-15) && Xi[32] === 0, `DC goes to bin 0 exactly (${Xr[0]}), the Nyquist bin is real`);
}

/* ------------------------------------------------------------------ the convolver against direct convolution */
console.log('the convolver');
function direct(h, x, lat, n) {
  const y = new Float64Array(n);
  for (let t = lat; t < n; t++) { const u = t - lat; let a = 0; const m = Math.min(h.length - 1, u); for (let j = 0; j <= m; j++) a += h[j] * x[u - j]; y[t] = a; }
  return y;
}
function run(C, x, outs, splits) {
  const n = x.length, oL = new Float64Array(n), oR = outs === 2 ? new Float64Array(n) : null;
  let i = 0, k = 0;
  while (i < n) {
    const m = Math.min(splits[k++ % splits.length], n - i);
    C.process(x.subarray(i, i + m), oL.subarray(i, i + m), oR ? oR.subarray(i, i + m) : null, m);
    i += m;
  }
  return [oL, oR];
}
const errOf = (a, b) => { let e = 0, pk = 0; for (let i = 0; i < a.length; i++) { e = Math.max(e, Math.abs(a[i] - b[i])); pk = Math.max(pk, Math.abs(b[i])); } return db(e / pk); };
{
  const LENS = [1, 7, 127, 128, 129, 1000, 1023, 1024, 1025, 2048, 4096, 5000, 9600, 14400];
  let worst = -Infinity, worstDirect = -Infinity, worstStereo = -Infinity;
  const lats = new Set(), dlats = new Set();
  for (const L of LENS) {
    const h = rand(L, L + 11), N = Math.max(6000, L + 4000), x = rand(N, L + 3);
    const C = convolver(h); lats.add(C.latency);
    worst = Math.max(worst, errOf(run(C, x, 1, [128])[0], direct(h, x, 128, N)));
    const Cd = convolver(h, { direct: 128 }); dlats.add(Cd.latency);
    worstDirect = Math.max(worstDirect, errOf(run(Cd, x, 1, [128])[0], direct(h, x, 0, N)));
    if (L === 129 || L === 4096 || L === 14400) {
      const h2 = rand(L, L + 99), Cs = convolver([h, h2], { direct: 128 });
      const [yl, yr] = run(Cs, x, 2, [128]);
      worstStereo = Math.max(worstStereo, errOf(yl, direct(h, x, 0, N)), errOf(yr, direct(h2, x, 0, N)));
    }
  }
  ok(worst < -240 && [...lats].join() === '128', `random taps of ${LENS[0]}..${LENS[LENS.length - 1]} frames: within ${worst.toFixed(1)} dB of direct convolution, 128 frames late`);
  ok(worstDirect < -240 && [...dlats].join() === '0', `direct: 128: within ${worstDirect.toFixed(1)} dB of direct convolution, with no latency`);
  ok(worstStereo < -240, `two channels of taps, one output each: within ${worstStereo.toFixed(1)} dB`);
}
{
  // host splits: every frame count 1..128 (and a mix of them) is bit-identical to whole 128-frame blocks
  const h = rand(4096, 5), x = rand(12000, 6);
  for (const opt of [{}, { direct: 128 }]) {
    const ref = run(convolver(h, opt), x, 1, [128])[0], hr = sha(ref);
    let same = 0;
    for (let s = 1; s <= 128; s++) if (sha(run(convolver(h, opt), x, 1, [s])[0]) === hr) same++;
    const mixed = sha(run(convolver(h, opt), x, 1, [1, 37, 91, 127, 128, 3, 64]) [0]) === hr;
    ok(same === 128 && mixed, `${opt.direct ? 'direct: 128' : 'the default'}: host splits of 1..128 frames and a mixed run give the same output, bit for bit (${same} of 128)`);
  }
  // in place: x as outL
  const C1 = convolver(h, { direct: 128 }), C2 = convolver(h, { direct: 128 });
  const a = Float32Array.from(x.subarray(0, 4096)), b = new Float32Array(4096);
  C2.process(a, b, null, 4096); C1.process(a, a, null, 4096);
  ok(sha(a) === sha(b), 'in place (the output written over the input) is the same as out of place');
}
{
  // set() re-plans in place; reset() clears
  const h1 = rand(4096, 21), h2 = rand(2500, 22), x = rand(9000, 23);
  const C = convolver(h1);
  run(C, x, 1, [128]);
  C.set(h2).reset();
  const y = run(C, x, 1, [128])[0];
  ok(errOf(y, direct(h2, x, 128, x.length)) < -240, 'set() to shorter taps, then reset(): the new taps, from silence');
  const fresh = run(convolver(h2), x, 1, [128])[0];
  let longer = false; try { C.set(rand(5000, 1)); } catch (e) { longer = true; }
  ok(longer || errOf(run(C.reset(), x, 1, [128])[0], direct(rand(5000, 1).subarray(0, 4096), x, 128, x.length)) < -240, 'taps longer than it was made for are cut to that length');
  void fresh;
  let bad = 0;
  for (const o of [{ direct: 64 }, { head: 100 }, { head: 1024, body: 512 }]) { try { convolver(h1, o); } catch (e) { bad++; } }
  ok(bad === 3, 'it refuses a direct length other than the head\'s, a head that is not a power of two, and a body under the head');
}

/* ------------------------------------------------------------------ pinned: the same doubles everywhere */
console.log('pinned');
{
  const tw = sha(fixedTwiddles(fft)), cv = sha(fixedConvolution(convolver));
  ok(tw === FIXED_TWIDDLES_SHA, `the twiddles (an impulse's spectrum at n = 256 and 2048) hash to the pinned ${tw.slice(0, 16)}`);
  ok(cv === FIXED_CONVOLUTION_SHA, `a fixed convolution (4,800 taps, direct: 128, a 37-frame host) hashes to the pinned ${cv.slice(0, 16)}`);
  const dsp = makeDsp(48000);
  ok(DSP_API.includes('fft') && DSP_API.includes('convolver') && typeof dsp.fft === 'function' && typeof dsp.convolver === 'function', 'dsp.fft and dsp.convolver are in the stdlib and in DSP_API');
  ok(sha(fixedConvolution(dsp.convolver)) === FIXED_CONVOLUTION_SHA, 'through dsp.convolver, the same hash');
  // the convolver never reads Math.sin / cos / exp / pow (an engine's own last bit)
  const src = (await import('node:fs')).readFileSync(new URL('../app/src/kernel/convolve.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  const used = [...src.matchAll(/Math\.(\w+)/g)].map((m) => m[1]);
  const allowed = new Set(['PI', 'round', 'floor', 'max', 'min', 'ceil']);
  ok(used.every((k) => allowed.has(k)), `it uses only Math.${[...new Set(used)].join(', Math.')} (no engine trig or exp)`);
}

/* ------------------------------------------------------------------ no allocation, and the cost */
console.log('cost');
{
  const h = Float32Array.from(rand(4096, 31)), x = Float32Array.from(rand(128, 32)), y = new Float32Array(128);
  const C = convolver(h, { direct: 128 }), Cd = convolver(h);
  for (let b = 0; b < 3000; b++) { C.process(x, y, null, 128); Cd.process(x, y, null, 128); }
  // (empty the young generation first: what the checks above left in it would otherwise be collected in the window)
  { let junk = 0; for (let i = 0; i < 256; i++) junk += new Float64Array(1 << 15).length; if (!junk) throw new Error('unreachable'); }
  await new Promise((r) => setTimeout(r, 50));
  let gcs = 0;
  const obs = new PerformanceObserver((list) => { gcs += list.getEntries().length; });
  obs.observe({ entryTypes: ['gc'] });
  const blocks = Math.round(48000 * 10 / 128);
  const t0 = performance.now(); for (let b = 0; b < blocks; b++) C.process(x, y, null, 128); const ms = performance.now() - t0;
  const t1 = performance.now(); for (let b = 0; b < blocks; b++) Cd.process(x, y, null, 128); const msd = performance.now() - t1;
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  ok(gcs === 0, `process() allocates nothing: no garbage collection over 20 s of audio (${gcs})`);
  ok(ms / 100 < 2, `a 4096-tap mono cab with direct: 128 costs ${(ms / 100).toFixed(2)}% of real time (${(msd / 100).toFixed(2)}% at 128 frames' latency)`);
  const room = rand(9600, 41), R = convolver(room);
  const t2 = performance.now(); for (let k = 0; k < 50; k++) R.set(room); const setMs = (performance.now() - t2) / 50;
  ok(setMs < 2, `planning a 200 ms room (9,600 taps) takes ${setMs.toFixed(3)} ms`);
}

T.done();
