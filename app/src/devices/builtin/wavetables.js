// Light Table's wavetables (core.wavetable): one source of truth for the kernel and the page. The kernel carries
// `lightTables` as text (wavetable.js puts `(${lightTables})()` into its source, since a kernel sees only `dsp`), and
// the page imports the same function to draw them, so what the editor shows is exactly what plays.
//
//   const LT = lightTables();
//   LT.F                    frames per table (49: a frame every 1/48 of POS, so 0, 1/4, 1/3, 1/2 ... land on frames)
//   LT.TABLES               [{ name, cycles, desc }]: the tables, in the order of the a_table / b_table switch
//   LT.frame(t, x, n = 256) one table cycle of table t at position x (0..1), n points, normalised exactly as the kernel
//                           plays it (a whole number of note cycles: `cycles`, 1 for most tables, 2 ORGAN, 4 BELL)
//   LT.frames(t, n = 256)   every frame of table t, for the 3D view: [Float32Array(n)] x F
//   LT.spectrum(t, x)       { a, b }: harmonic k's sine (a[k]) and cosine (b[k]) amplitudes, k = 1..1023, before the
//                           frame is normalised (the editor can draw the spectrum; LT.gain(t, x) is the normaliser)
//   LT.store()              (the kernel's) a table in memory: every frame at 11 band limits, built a frame at a time
//
// How a table is held (the kernel's store): F frames, each at 11 band limits (mips) with 1023, 512, 256 ... 2, 1
// harmonics, for octaves of pitch, so a note only ever plays harmonics under the sample rate (the oscillator picks the
// mip from its pitch, per block). A mip of K harmonics is a cycle of max(1024, min(2048, 8K)) samples plus one guard
// sample, read with linear interpolation: at 8 samples a harmonic its images sit 34 dB or more under it, and the
// small mips get 16 or more (47 dB). 49 frames x 14,347 floats = 2.8 MB a table. Every mip is the frame's spectrum cut off at
// its K and turned into samples by an inverse FFT (two mips a transform), so a frame costs about a fifth of a
// millisecond and a table about ten: the kernel builds a table's frames nearest the playing position first, at once,
// and the rest four a block (about half a millisecond), so changing tables never holds the audio thread.
//
// Each table is a function of position x (0..1) filling a frame's harmonic amplitudes, analytic wherever a wave has
// edges (pulses, the hard-synced saw and the stepped waves are summed in closed form, so they are exactly band-limited
// however bright), sampled and transformed only where the wave is smooth (FM). Each frame is scaled so its full-band
// peak is 1. Nothing here allocates after store() and nothing reads Math.random: the same frames every time, here, in
// the AudioWorklet and in the Node renderer.
export function lightTables() {
  'use strict';
  const PI = Math.PI, TAU = 2 * Math.PI;
  const F = 49;                        // frames a table
  const NMAX = 2048, KMAX = 1023;      // the richest mip: 1023 harmonics in 2048 samples
  const MIPS = 11;
  const MK = new Int32Array(MIPS), MN = new Int32Array(MIPS), MO = new Int32Array(MIPS);
  let FS = 0;                          // floats a frame (every mip with its guard sample)
  for (let m = 0; m < MIPS; m++) {
    const n = Math.min(NMAX, Math.max(1024, 8 * (1024 >> m)));
    MN[m] = n; MK[m] = Math.min(1024 >> m, n / 2 - 1); MO[m] = FS; FS += n + 1;
  }

  /* ---------------------------------------------------------------- the FFT (radix 2, in place, twiddles from one table) */
  const CT = new Float64Array(NMAX / 2), ST = new Float64Array(NMAX / 2);
  for (let j = 0; j < NMAX / 2; j++) { CT[j] = Math.cos(TAU * j / NMAX); ST[j] = Math.sin(TAU * j / NMAX); }
  // forward: X[k] = sum x[n] e^(-2 pi i k n / N); inverse (inv): x[n] = sum X[k] e^(+2 pi i k n / N), not scaled
  function fft(re, im, n, inv) {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const h = len >> 1, step = NMAX / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < h; j++) {
          const wr = CT[j * step], wi = inv ? ST[j * step] : -ST[j * step];
          const a = i + j, b = a + h;
          const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- helpers for the tables */
  const sinc = (u) => (Math.abs(u) < 1e-9 ? 1 : Math.sin(u) / u);
  // a resonance's level at harmonic k: 1 at its centre c, falling away with sharpness q (a band-pass's magnitude)
  const peak = (k, c, q) => 1 / Math.sqrt(1 + q * q * (k / c - c / k) * (k / c - c / k));
  // Phase laws for the tables whose look isn't the point: a chirp (Schroeder's low-peak phases, quadratic in k) spreads
  // a frame's energy over the cycle, so its peak stays low and its loudness holds as POS moves (GROWL keeps within
  // 2 dB across its sweep this way; in sine phase it fell 11). The phase depends on k alone, so a harmonic keeps its
  // phase from frame to frame and morphing between frames never cancels it.
  const chirp = (k, d) => PI * k * k / d;
  const pol = (a, b, k, g, p) => { a[k] += g * Math.cos(p); b[k] += g * Math.sin(p); };
  // a wave of S steps (step j holds v[j] over [j/S, (j+1)/S)): its exact spectrum, from the steps' own DFT and the
  // hold's sinc. Sums into a, b with weight w.
  const stepRe = new Float64Array(64), stepIm = new Float64Array(64);
  function steps(v, S, w, a, b, K) {
    for (let q = 0; q < S; q++) {
      let r = 0, i = 0;
      for (let j = 0; j < S; j++) { const th = -TAU * q * j / S; r += v[j] * Math.cos(th); i += v[j] * Math.sin(th); }
      stepRe[q] = r; stepIm[q] = i;
    }
    for (let k = 1; k <= K; k++) {
      const q = k % S, g = sinc(PI * k / S) / S, th = -PI * k / S, c = Math.cos(th), s = Math.sin(th);
      // c_k = g e^(i th) V[q]; the wave is sum 2 Re(c_k e^(2 pi i k x)): cosine part 2 Re c_k, sine part -2 Im c_k
      const cr = g * (c * stepRe[q] - s * stepIm[q]), ci = g * (c * stepIm[q] + s * stepRe[q]);
      b[k] += w * 2 * cr; a[k] -= w * 2 * ci;
    }
  }
  const stepV = new Float64Array(64);
  // a pulse of width wd (out of 32 steps) centred on a quarter cycle, as 32 steps (so its fundamental is in sine phase)
  function pulse32(wd, w, a, b, K) {
    for (let j = 0; j < 32; j++) { const d = Math.abs(j + 0.5 - 8); stepV[j] = Math.min(d, 32 - d) < wd / 2 ? 1 : -1; }
    steps(stepV, 32, w, a, b, K);
  }
  // the time-domain route, for smooth waves: fill tre with one cycle at NMAX points, then its spectrum into a, b
  const tre = new Float64Array(NMAX), tim = new Float64Array(NMAX);
  function fromTime(a, b, K) {
    tim.fill(0);
    fft(tre, tim, NMAX, false);
    for (let k = 1; k <= K; k++) { b[k] += 2 * tre[k] / NMAX; a[k] -= 2 * tim[k] / NMAX; }
  }
  // registrations for ORGAN: drawbars 16' 5 1/3' 8' 4' 2 2/3' 2' 1 3/5' 1 1/3' 1' at table harmonics (two note cycles)
  const DH = [1, 3, 2, 4, 6, 8, 10, 12, 16];
  const REG = [[0, 0, 8, 4, 0, 0, 0, 0, 0], [8, 8, 8, 0, 0, 0, 0, 0, 0], [8, 8, 8, 8, 0, 0, 0, 0, 0], [8, 6, 8, 8, 6, 0, 0, 0, 8], [8, 8, 8, 8, 8, 8, 8, 8, 8]];
  // BELL: partials (ratio to the note, level) of a struck bar and bell, at quarter-note-cycle resolution
  const BELL = [0.5, 0.16, 1, 1, 2, 0.42, 2.75, 0.55, 3, 0.2, 4.25, 0.32, 5.5, 0.4, 6.75, 0.22, 8.25, 0.26, 9, 0.14, 11, 0.12, 12.5, 0.1, 13.75, 0.09, 16.5, 0.07];
  // VOWEL: a bass voice's five formants (Hz, dB, bandwidth Hz) for A E I O U (the Csound manual's formant table),
  // placed on the harmonics of G3 (196 Hz)
  const VOW = [
    [[600, 0, 60], [1040, -7, 70], [2250, -9, 110], [2450, -9, 120], [2750, -20, 130]],
    [[400, 0, 40], [1620, -12, 80], [2400, -9, 100], [2800, -12, 120], [3100, -18, 120]],
    [[250, 0, 60], [1750, -30, 90], [2600, -16, 100], [3050, -22, 120], [3340, -28, 120]],
    [[400, 0, 40], [750, -11, 80], [2400, -21, 100], [2600, -20, 120], [2900, -40, 120]],
    [[350, 0, 40], [600, -20, 80], [2400, -32, 100], [2675, -28, 120], [2950, -36, 120]],
  ];
  const VREF = 196;
  // CHIP's 4-bit triangle: 32 steps of a sine-phase triangle, 16 levels
  const TRI4 = new Float64Array(32);
  for (let j = 0; j < 32; j++) { const u = (j + 0.5) / 32, t = u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4; TRI4[j] = (Math.round((t + 1) / 2 * 15) / 15) * 2 - 1; }
  // BASIC's four shapes (sine, triangle, falling saw, square), harmonic k's sine amplitude; fundamentals all in phase
  function basic(s, k) {
    const odd = k & 1;
    if (s === 0) return k === 1 ? 1 : 0;
    if (s === 1) return odd ? (8 / (PI * PI * k * k)) * ((k - 1) % 4 ? -1 : 1) : 0;
    if (s === 2) return 2 / (PI * k);
    return odd ? 4 / (PI * k) : 0;
  }
  // a drawbar's level: 8 is full, each step down 3 dB, 0 off
  const bar = (dv) => (dv > 0 ? Math.pow(10, (dv - 8) * 3 / 20) : 0);
  // CHIP's keyframes: pulses 4, 8 and 16 steps wide of 32, then the 4-bit triangle
  function chip(i, w, a, b, K) { if (i < 3) pulse32(i === 0 ? 4 : i === 1 ? 8 : 16, w, a, b, K); else steps(TRI4, 32, w, a, b, K); }
  const GLASS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

  // The tables. fill(x, a, b, K) adds harmonic k's sine (a[k]) and cosine (b[k]) amplitudes for position x; a and b
  // arrive zeroed. The order is the switch's: append new tables at the end, never reorder (songs store the index).
  const TABLES = [
    { name: 'BASIC', cycles: 1, desc: 'sine, triangle, saw and square at POS 0, 1/3, 2/3 and 1, morphing between them',
      fill(x, a, b, K) {
        const seg = Math.min(2, Math.floor(x * 3 + 1e-9)), u = Math.max(0, Math.min(1, x * 3 - seg));
        for (let k = 1; k <= K; k++) a[k] = basic(seg, k) * (1 - u) + basic(seg + 1, k) * u;
      } },
    { name: 'PULSE', cycles: 1, desc: 'a square narrowing to a thin pulse (50% to 4%): sweep POS with an LFO for pulse-width modulation',
      fill(x, a, b, K) {
        const w = 0.5 - 0.46 * x;
        for (let k = 1; k <= K; k++) { const th = TAU * k * w; b[k] = 2 * Math.sin(th) / (PI * k); a[k] = 2 * (1 - Math.cos(th)) / (PI * k); }
      } },
    { name: 'HARMONICS', cycles: 1, desc: 'adds harmonics one at a time, a sine at 0 to 49 harmonics at 1, so POS opens it like a filter',
      fill(x, a, b, K) {
        const H = 1 + 48 * x, n = Math.floor(H + 1e-9), fr = H - n;
        for (let k = 1; k <= Math.min(K, n + 1); k++) a[k] = (k <= n ? 1 : fr) / Math.pow(k, 0.85);
      } },
    { name: 'VOWEL', cycles: 1, desc: 'sung vowels A, E, I, O, U at POS 0, 1/4, 1/2, 3/4, 1 (formants placed for about G3; they move with pitch)',
      fill(x, a, b, K) {
        const s = Math.min(3, Math.floor(x * 4 + 1e-9)), u = Math.max(0, Math.min(1, x * 4 - s)), A = VOW[s], B = VOW[s + 1];
        for (let k = 1; k <= K; k++) {
          const f = k * VREF;
          if (f > 9000) break;
          let g = 0;
          for (let i = 0; i < 5; i++) {
            const fc = Math.exp(Math.log(A[i][0]) * (1 - u) + Math.log(B[i][0]) * u), db = A[i][1] * (1 - u) + B[i][1] * u, bw = 1.6 * (A[i][2] * (1 - u) + B[i][2] * u);
            const d = 2 * (f - fc) / bw;
            g += Math.pow(10, db / 20) / Math.sqrt(1 + d * d);
          }
          pol(a, b, k, g, chirp(k, 16));
        }
      } },
    { name: 'SYNC', cycles: 1, desc: 'a hard-synced saw whose slave runs at 1 to 6 times the pitch: the classic sync sweep',
      fill(x, a, b, K) {
        // a falling saw restarted every note cycle: jumps of +2 at each of its own resets (j / r) and 2 frac(r) at 0;
        // a wave of constant slope with jumps J at x_j has c_k = sum J e^(-2 pi i k x_j) / (2 pi i k)
        const r = 1 + 5 * x, n = Math.ceil(r - 1e-9) - 1, j0 = r - Math.floor(r) < 1e-9 ? 2 : 2 * (r - Math.floor(r));
        for (let k = 1; k <= K; k++) {
          let sr = j0, si = 0;
          for (let j = 1; j <= n; j++) { const th = TAU * k * j / r; sr += 2 * Math.cos(th); si += 2 * Math.sin(th); }
          a[k] = sr / (PI * k); b[k] = -si / (PI * k);
        }
      } },
    { name: 'BELL', cycles: 4, desc: 'bell and bar partials (2.75, 5.5, 8.25 ... times the pitch), soft at 0, clanging at 1',
      fill(x, a, b, K) {
        for (let i = 0; i < BELL.length; i += 2) {
          const r = BELL[i], l = BELL[i + 1], k = Math.round(r * 4);
          if (k > K) continue;
          const g = l * Math.pow(r, -2.2 * (1 - x)) * (r < 1 ? 1 - 0.6 * x : 1);
          pol(a, b, k, g, chirp(k, 16));
        }
      } },
    { name: 'ORGAN', cycles: 2, desc: 'drawbar registrations from a soft flute (008400000) through 888000000 to full organ (888888888)',
      fill(x, a, b, K) {
        const s = Math.min(3, Math.floor(x * 4 + 1e-9)), u = Math.max(0, Math.min(1, x * 4 - s));
        for (let d = 0; d < 9; d++) {
          const g = bar(REG[s][d]) * (1 - u) + bar(REG[s + 1][d]) * u, k = DH[d];
          if (k <= K) pol(a, b, k, g, chirp(k, 64));
        }
      } },
    { name: 'FM', cycles: 1, desc: 'two-operator FM at 1:1, index 0 to 6.5: a sine growing a bright, buzzy digital edge',
      fill(x, a, b, K) {
        const I = 6.5 * Math.pow(x, 1.5);
        for (let i = 0; i < NMAX; i++) { const p = TAU * i / NMAX; tre[i] = Math.sin(p + I * Math.sin(p)); }
        fromTime(a, b, K);
      } },
    { name: 'HOLLOW', cycles: 1, desc: 'notches combed through a saw: hollow and square-like at 0, the notches thinning to a plain saw at 1',
      fill(x, a, b, K) {
        const s = 0.5 * Math.pow(0.06 / 0.5, x);
        for (let k = 1; k <= K; k++) { const c = Math.cos(PI * (k - 1) * s); pol(a, b, k, (0.06 + 0.94 * c * c) * 2 / (PI * k), -PI * k * (k - 1) / 50); }
      } },
    { name: 'GRIT', cycles: 1, desc: 'a stepped, bit-reduced wave: 64 steps and 6 bits at 0, down to 3 steps and 1 bit at 1',
      fill(x, a, b, K) {
        const S = Math.max(3, Math.round(64 * Math.pow(3 / 64, x))), bits = 6 - 5 * x, L = Math.pow(2, bits - 1);
        for (let j = 0; j < S; j++) {
          const u = (j + 0.5) / S, v = 0.62 * Math.sin(TAU * u) + 0.38 * (1 - 2 * u);
          stepV[j] = Math.max(-1, Math.min(1, Math.round(v * L) / L));
        }
        steps(stepV, S, 1, a, b, K);
      } },
    { name: 'GLASS', cycles: 1, desc: 'a pure tone with sparkling octaves and fifths; POS lifts the sparkle higher',
      fill(x, a, b, K) {
        const c = 2 * Math.pow(16, x);
        for (let i = 0; i < GLASS.length; i++) {
          const k = GLASS[i]; if (k > K) break;
          const d = Math.log2(k / c), g = (k === 1 ? 1 : 0.42 / Math.pow(k, 0.55)) * (0.4 + 1.5 * Math.exp(-d * d / 0.5));
          pol(a, b, k, g, chirp(k, 16));
        }
      } },
    { name: 'GROWL', cycles: 1, desc: 'a resonant double peak sweeping up through a saw: the talking, yawning bass growl',
      fill(x, a, b, K) {
        const kc = 1.5 * Math.pow(28 / 1.5, x);
        for (let k = 1; k <= K; k++) pol(a, b, k, (0.12 + 2.2 * peak(k, kc, 3.2) + 0.9 * peak(k, kc * 2.3, 4)) / Math.pow(k, 0.9), chirp(k, 16));
      } },
    { name: 'REED', cycles: 1, desc: 'a hollow, clarinet-like reed (odd harmonics) at 0 to a nasal, oboe-like one at 1',
      fill(x, a, b, K) {
        const ev = 0.06 + 0.94 * x * x, kf = 3 + 5 * x;
        for (let k = 1; k <= K; k++) a[k] = ((k & 1) ? 1 : ev) * (0.45 + 1.6 * peak(k, kf, 2.5)) / Math.pow(k, 1.15) / (1 + Math.pow(k / 24, 2));
      } },
    { name: 'CHIP', cycles: 1, desc: 'eight-bit console waves: pulses of 12.5%, 25% and 50% at POS 0, 1/3, 2/3, then a 4-bit stepped triangle at 1',
      fill(x, a, b, K) {
        const seg = Math.min(2, Math.floor(x * 3 + 1e-9)), u = Math.max(0, Math.min(1, x * 3 - seg));
        if (1 - u > 1e-9) chip(seg, 1 - u, a, b, K);
        if (u > 1e-9) chip(seg + 1, u, a, b, K);
      } },
  ];

  /* ---------------------------------------------------------------- spectra and frames */
  const SA = new Float64Array(KMAX + 1), SB = new Float64Array(KMAX + 1);
  function fill(t, x) {
    SA.fill(0); SB.fill(0);
    TABLES[t].fill(Math.max(0, Math.min(1, x)), SA, SB, KMAX);
    SA[0] = 0; SB[0] = 0;
  }
  const re = new Float64Array(NMAX), im = new Float64Array(NMAX);
  // two mips of the same length into re (mip m1) and im (mip m2, or nothing when m2 < 0), from SA/SB
  function pair(m1, m2) {
    const n = MN[m1], k1 = MK[m1], k2 = m2 < 0 ? 0 : MK[m2];
    for (let i = 0; i < n; i++) { re[i] = 0; im[i] = 0; }
    const top = Math.max(k1, k2);
    for (let k = 1; k <= top; k++) {
      const ar = k <= k1 ? SB[k] / 2 : 0, ai = k <= k1 ? -SA[k] / 2 : 0;
      const br = k <= k2 ? SB[k] / 2 : 0, bi = k <= k2 ? -SA[k] / 2 : 0;
      re[k] = ar - bi; im[k] = ai + br;
      re[n - k] = ar + bi; im[n - k] = br - ai;
    }
    fft(re, im, n, true);
  }
  // the mips in pairs of one length (one inverse FFT each): [m1, m2], -1 for none
  const ORDER = new Int32Array([0, 1, 2, -1, 3, 4, 5, 6, 7, 8, 9, 10]);
  function put(T, o, m, src, g) {
    const n = MN[m], b = o + MO[m];
    for (let i = 0; i < n; i++) T[b + i] = src[i] * g;
    T[b + n] = T[b];
  }
  // one frame, every mip, into T at offset o, scaled so the full-band peak is 1 (the spectrum must be in SA/SB)
  function render(T, o) {
    let g = 1;
    for (let p = 0; p < ORDER.length; p += 2) {
      const m1 = ORDER[p], m2 = ORDER[p + 1];
      pair(m1, m2);
      if (p === 0) { let pk = 0; for (let i = 0; i < MN[0]; i++) { const v = re[i] < 0 ? -re[i] : re[i]; if (v > pk) pk = v; } g = pk > 1e-12 ? 1 / pk : 0; }
      put(T, o, m1, re, g);
      if (m2 >= 0) put(T, o, m2, im, g);
    }
    return g;
  }

  // A table held in memory, built a frame at a time: frames nearest `pos` first. near[f] is the built frame closest to
  // f (reading an unbuilt frame reads that instead), so a half-built table plays at once.
  function store() {
    const T = new Float32Array(F * FS), done = new Uint8Array(F), near = new Int16Array(F), order = new Int16Array(F);
    function build(f) {
      fill(s.table, f / (F - 1));
      render(T, f * FS);
      done[f] = 1; s.left--;
      let last = -1;
      for (let k = 0; k < F; k++) if (done[k]) { if (last < 0) for (let j = 0; j < k; j++) near[j] = k; else for (let j = last + 1; j < k; j++) near[j] = (j - last <= k - j) ? last : k; near[k] = k; last = k; }
      for (let j = last + 1; j < F; j++) near[j] = last;
    }
    const s = {
      T, near, table: -1, left: 0, i: 0, at: 0, np: 0,
      start(t, pos) {
        s.table = t; s.left = F; s.i = 0; done.fill(0);
        // the build order: nearest the position first (an insertion sort: nothing allocated)
        const c = Math.max(0, Math.min(1, pos)) * (F - 1);
        s.at = c;
        for (let f = 0; f < F; f++) {
          let j = f;
          const df = Math.abs(f - c);
          while (j > 0 && Math.abs(order[j - 1] - c) > df) { order[j] = order[j - 1]; j--; }
          order[j] = f;
        }
        return s;
      },
      // build the next frame; false when the table is complete
      // build the next frame in the order; false when the table is complete
      step() {
        while (s.i < F && done[order[s.i]]) s.i++;
        if (!s.left || s.i >= F) return false;
        build(order[s.i++]);
        return s.left > 0;
      },
      // the two frames either side of position np (set it first), now (what a voice is about to read), and the rest of
      // the order re-centred on it when it has moved
      need() {
        if (!s.left) return;
        const pos = s.np, c = (pos < 0 ? 0 : pos > 1 ? 1 : pos) * (F - 1), f = c >= F - 2 ? F - 2 : Math.floor(c);
        if (!done[f]) build(f);
        if (!done[f + 1]) build(f + 1);
        if (Math.abs(c - s.at) > 2) {
          // the frames not yet built, nearest pos first (an insertion sort over the rest of the order)
          for (let i = s.i + 1; i < F; i++) {
            const v = order[i], dv = Math.abs(v - c);
            let j = i;
            while (j > s.i && Math.abs(order[j - 1] - c) > dv) { order[j] = order[j - 1]; j--; }
            order[j] = v;
          }
          s.at = c;
        }
      },
      ready() { return s.left === 0; },
    };
    return s;
  }

  // The page's views: one frame as the kernel plays it, every frame of a table, a frame's spectrum.
  function frame(t, x, n = 256) {
    fill(t, x);
    const T = new Float32Array(FS);
    render(T, 0);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = i * MN[0] / n, j = p | 0, f = p - j; out[i] = T[j] + (T[j + 1] - T[j]) * f; }
    return out;
  }
  function frames(t, n = 256) { const out = []; for (let f = 0; f < F; f++) out.push(frame(t, f / (F - 1), n)); return out; }
  function spectrum(t, x) { fill(t, x); return { a: Float64Array.from(SA), b: Float64Array.from(SB) }; }
  function gain(t, x) { fill(t, x); const T = new Float32Array(FS); return render(T, 0); }

  return { F, FS, MIPS, MK, MN, MO, KMAX, TABLES, NAMES: TABLES.map((d) => d.name), store, frame, frames, spectrum, gain, fft };
}

// The table names, in switch order (a_table / b_table), and what each sounds like (docs/research/LIGHT-TABLE.md).
const META = lightTables();
export const TABLE_NAMES = META.NAMES;
export const TABLE_INFO = META.TABLES.map((d) => ({ name: d.name, cycles: d.cycles, desc: d.desc }));
export const FRAMES = META.F;
