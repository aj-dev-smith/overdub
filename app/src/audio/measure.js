// The ears. Agents can't hear, so Overdub measures: anything that makes sound is rendered offline and read here.
// Pure JS on Float32Arrays / AudioBuffers (Node and the browser); spectrogram() is the only part that wants a canvas,
// and it falls back to a tiny pure-JS PNG encoder where there is none.
//
//   measure(buffer, { from?, to? }) -> { lufs, lufsShortMax, lra, truePeak, peak, rms, crest, bands, bandsAbs, centroid,
//                                        width, correlation, sideDb, onsetsPerSec, silencePct, clipped, duration, sr,
//                                        chroma, key }
//   bands: each band's share of the total energy, dB (the balance: cutting the loudest band raises the others' share)
//   bandsAbs: each band's own energy, dB per analysis frame and channel (compare two renders of the same range: an EQ
//             cut of 3 dB reads as about -3 here, whatever the other bands do)
//   spectrogram(buffer, { width, height, from?, to?, floor? }) -> Promise<PNG data URL>
//   lufs(buffer), truePeak(buffer), kWeight(x, sr): the pieces, unrounded (for checks)
//
// `buffer` is an AudioBuffer, { sampleRate | sr, channels: Float32Array[] }, an array of Float32Arrays, or one
// Float32Array (mono; pass { sr }). from / to are seconds. dB values never go below FLOOR (-120): silence reads
// -120, not -Infinity, so the result survives JSON.
//
// Loudness is ITU-R BS.1770-4 (K-weighting computed for the buffer's own sample rate, 400 ms blocks with 75% overlap,
// absolute -70 LUFS and relative -10 LU gates, channel powers summed with unit weights); LRA is EBU Tech 3342 (3 s
// short-term windows every 100 ms, -70 absolute and -20 LU relative gates, 10th to 95th percentile); true peak is 4x
// oversampled with a windowed-sinc polyphase FIR in the spirit of BS.1770 Annex 2. Verified in tools/sounds-test.js:
// a 1 kHz sine at -20 dBFS in one channel reads -23.0 LUFS, the same in both reads -20.0, and an fs/4 sine at 45°
// phase reads 0 dBTP where its samples peak at -3 dBFS.

export const FLOOR = -120;
const LN10_20 = 20 / Math.LN10, LN10_10 = 10 / Math.LN10;
const dB = (x) => (x > 0 ? Math.max(FLOOR, Math.log(x) * LN10_20) : FLOOR);       // amplitude
const dBp = (x) => (x > 0 ? Math.max(FLOOR, Math.log(x) * LN10_10) : FLOOR);      // power
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---------------------------------------------------------------------------------------------------- input
export function channelsOf(buf, { sr, from, to } = {}) {
  let ch, rate;
  if (buf && typeof buf.getChannelData === 'function') {
    ch = []; for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
    rate = buf.sampleRate;
  } else if (buf instanceof Float32Array || buf instanceof Float64Array) { ch = [buf]; rate = sr; }
  else if (Array.isArray(buf)) { ch = buf; rate = sr; }
  else if (buf && (buf.channels || buf.data)) { ch = buf.channels || buf.data; rate = buf.sampleRate || buf.sr || sr; }
  else throw new Error('measure: expected an AudioBuffer, { sr, channels }, or Float32Array(s)');
  rate = rate || 48000;
  if (from != null || to != null) {
    const n = ch[0] ? ch[0].length : 0;
    const a = Math.max(0, Math.min(n, Math.round((from || 0) * rate)));
    const b = Math.max(a, Math.min(n, to == null ? n : Math.round(to * rate)));
    ch = ch.map((x) => x.subarray(a, b));
  }
  return { ch: ch.slice(0, 8), sr: rate };
}

// ---------------------------------------------------------------------------------------------------- loudness
// K-weighting (BS.1770-4) for any sample rate: the two biquads re-derived from their analog prototypes (the same
// derivation as libebur128), so 44.1k, 48k and 96k all read the same loudness.
export function kCoeffs(sr) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr);
  a0 = 1 + K / Q + K * K;
  const hp = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}
function biquad(x, c, out) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
export function kWeight(x, sr) {
  const [s, h] = kCoeffs(sr), out = new Float64Array(x.length);
  biquad(x, s, out); biquad(out, h, out);
  return out;
}

// Mean-square per 100 ms segment, summed over channels (unit channel weights: mono/stereo).
function segmentPowers(ch, sr) {
  const seg = Math.round(sr * 0.1), n = ch[0] ? ch[0].length : 0, nseg = Math.floor(n / seg);
  const P = new Float64Array(nseg);
  let total = 0;
  for (const x of ch) {
    const k = kWeight(x, sr);
    for (let s = 0; s < nseg; s++) { let a = 0; for (let i = s * seg, e = i + seg; i < e; i++) a += k[i] * k[i]; P[s] += a / seg; }
    let a = 0; for (let i = 0; i < n; i++) a += k[i] * k[i]; total += n ? a / n : 0;
  }
  return { P, total, n };
}
const L = (power) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);
// Windowed loudnesses: each window `w` segments long, stepping one segment (100 ms).
function windows(P, w) {
  const out = [];
  if (P.length < w) return out;
  let a = 0; for (let i = 0; i < w; i++) a += P[i];
  out.push(a / w);
  for (let i = w; i < P.length; i++) { a += P[i] - P[i - w]; out.push(Math.max(0, a / w)); }
  return out;
}
function gated(powers) {
  const abs = powers.filter((p) => L(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((s, p) => s + p, 0) / abs.length) - 10;
  const kept = abs.filter((p) => L(p) > rel);
  return kept.length ? L(kept.reduce((s, p) => s + p, 0) / kept.length) : -Infinity;
}
function loudnessParts(ch, sr) {
  const { P, total } = segmentPowers(ch, sr);
  const blocks = windows(P, 4), shorts = windows(P, 30);
  // shorter than a block: the ungated loudness of what there is (if above the absolute gate)
  const integrated = blocks.length ? gated(blocks) : (L(total) > -70 ? L(total) : -Infinity);
  const st = shorts.length ? shorts : [total];
  let stMax = -Infinity; for (const p of st) stMax = Math.max(stMax, L(p));
  // LRA (EBU Tech 3342)
  let lra = 0;
  const abs = st.filter((p) => L(p) > -70);
  if (abs.length > 1) {
    const rel = L(abs.reduce((s, p) => s + p, 0) / abs.length) - 20;
    const v = abs.map(L).filter((l) => l > rel).sort((a, b) => a - b);
    if (v.length > 1) {
      const q = (f) => { const x = (v.length - 1) * f, i = Math.floor(x); return v[i] + (v[Math.min(v.length - 1, i + 1)] - v[i]) * (x - i); };
      lra = q(0.95) - q(0.10);
    }
  }
  return { integrated, stMax, lra };
}
export function lufs(buffer, opts = {}) {
  const { ch, sr } = channelsOf(buffer, opts);
  const v = loudnessParts(ch, sr).integrated;
  return Number.isFinite(v) ? v : FLOOR;
}

// ---------------------------------------------------------------------------------------------------- true peak
// 4 phases x 32 taps of a Kaiser-windowed sinc (cutoff just under the input Nyquist), each phase normalised to unity
// DC gain. Phase 0 is the sample itself. Ripple under 0.05 dB to 0.8 x Nyquist (checked in sounds-test).
const TP = (() => {
  const P = 4, T = 16, beta = 8, fc = 0.94;
  const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / 2 / k) * (x / 2 / k); s += t; } return s; };
  const rows = [];
  for (let ph = 1; ph < P; ph++) {
    const f = ph / P, row = new Float64Array(2 * T);
    let sum = 0;
    for (let j = -T + 1; j <= T; j++) {
      const t = j - f, u = t / (T + 0.5);
      const w = Math.abs(u) >= 1 ? 0 : i0(beta * Math.sqrt(1 - u * u)) / i0(beta);
      const s = t === 0 ? fc : Math.sin(Math.PI * fc * t) / (Math.PI * t);
      row[j + T - 1] = s * w; sum += s * w;
    }
    for (let k = 0; k < row.length; k++) row[k] /= sum;
    rows.push(row);
  }
  return { rows, T };
})();
function truePeakOf(x) {
  const n = x.length, { rows, T } = TP;
  let sp = 0; for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a > sp) sp = a; }
  let tp = sp;
  const B = 512;
  for (let b0 = 0; b0 < n; b0 += B) {
    // skip blocks that can't beat the current peak (inter-sample overs of real signals stay well under +6 dB)
    let m = 0; for (let i = Math.max(0, b0 - T), e = Math.min(n, b0 + B + T); i < e; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
    if (m * 2 < tp || m === 0) continue;
    for (let i = b0, e = Math.min(n, b0 + B); i < e; i++) {
      const base = i - T + 1;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]; let s = 0;
        if (base >= 0 && base + 2 * T <= n) { for (let j = 0; j < 2 * T; j++) s += x[base + j] * row[j]; }
        else { for (let j = 0; j < 2 * T; j++) { const k = base + j; if (k >= 0 && k < n) s += x[k] * row[j]; } }
        const a = Math.abs(s); if (a > tp) tp = a;
      }
    }
  }
  return { tp, sp };
}
export function truePeak(buffer, opts = {}) {
  const { ch } = channelsOf(buffer, opts);
  let tp = 0; for (const x of ch) tp = Math.max(tp, truePeakOf(x).tp);
  return dB(tp);
}

// ---------------------------------------------------------------------------------------------------- FFT
const FFTS = new Map();
function fftPlan(N) {
  let p = FFTS.get(N);
  if (p) return p;
  const bits = Math.log2(N) | 0, rev = new Uint32Array(N), cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), win = new Float64Array(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / N); sin[i] = Math.sin(-2 * Math.PI * i / N); }
  let wsum = 0; for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); wsum += win[i]; }
  p = { N, rev, cos, sin, win, wsum, re: new Float64Array(N), im: new Float64Array(N) };
  FFTS.set(N, p);
  return p;
}
// Power spectrum (N/2+1 bins) of x[at .. at+N) (zero padded), Hann windowed, scaled so a full-scale sine's bin ~ 0.25*... (relative use only)
function powerSpectrum(x, at, N, out) {
  const p = fftPlan(N), { rev, cos, sin, win, re, im } = p;
  for (let i = 0; i < N; i++) { const k = at + i, v = k >= 0 && k < x.length ? x[k] * win[i] : 0; re[rev[i]] = v; im[rev[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let j = 0, t = 0; j < half; j++, t += step) {
        const a = s + j, b = a + half, wr = cos[t], wi = sin[t];
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
  const norm = 1 / (p.wsum * p.wsum);
  for (let k = 0; k <= N / 2; k++) out[k] = (re[k] * re[k] + im[k] * im[k]) * norm;
  return out;
}
// Frame starts for an analysis of n samples, at most `max` frames (evenly strided) so long songs stay quick.
function frameStarts(n, N, hop, max) {
  const count = Math.max(1, Math.floor((n - N) / hop) + 1), stride = Math.max(1, Math.ceil(count / max)), out = [];
  for (let f = 0; f < count; f += stride) out.push(f * hop);
  return out;
}

// ---------------------------------------------------------------------------------------------------- spectrum
export const BANDS = [['sub', 0, 60], ['low', 60, 250], ['lowmid', 250, 500], ['mid', 500, 2000], ['highmid', 2000, 4000], ['presence', 4000, 8000], ['air', 8000, Infinity]];
function spectrumStats(ch, sr) {
  const N = 4096, n = ch[0].length, acc = new Float64Array(N / 2 + 1), tmp = new Float64Array(N / 2 + 1);
  const starts = frameStarts(n, N, N / 2, 1500);
  for (const x of ch) for (const at of starts) { powerSpectrum(x, at, N, tmp); for (let k = 0; k < acc.length; k++) acc[k] += tmp[k]; }
  const hz = sr / N;
  let total = 0; for (let k = 1; k < acc.length; k++) total += acc[k];
  const bands = {}, bandsAbs = {};
  const perFrame = 1 / Math.max(1, starts.length * ch.length);
  for (const [name, lo, hi] of BANDS) {
    let e = 0; for (let k = 1; k < acc.length; k++) { const f = k * hz; if (f >= lo && f < hi) e += acc[k]; }
    bands[name] = total > 0 ? r2(dBp(e / total)) : FLOOR;
    bandsAbs[name] = r2(dBp(e * perFrame));
  }
  let num = 0, den = 0; for (let k = 1; k < acc.length; k++) { const m = Math.sqrt(acc[k]); num += k * hz * m; den += m; }
  return { bands, bandsAbs, centroid: den > 0 ? Math.round(num / den) : 0, spectrum: acc, hz };
}

// ---------------------------------------------------------------------------------------------------- onsets
function mono(ch) {
  if (ch.length === 1) return ch[0];
  const n = ch[0].length, m = new Float32Array(n), g = 1 / ch.length;
  for (const x of ch) for (let i = 0; i < n; i++) m[i] += x[i] * g;
  return m;
}
// Spectral flux of log-compressed magnitudes, half-wave rectified; peaks over a local median + a margin, 50 ms apart.
export function onsets(buffer, opts = {}) {
  const { ch, sr } = channelsOf(buffer, opts);
  const x = mono(ch), N = 1024, hop = 512, nb = N / 2 + 1;
  const frames = Math.max(0, Math.floor((x.length - N) / hop) + 1);
  if (frames < 3) return [];
  let prev = new Float64Array(nb), cur = new Float64Array(nb), ps = new Float64Array(nb);
  const flux = new Float64Array(frames), loud = new Float64Array(frames);
  const kmax = Math.min(nb, Math.round(16000 / (sr / N)));
  for (let f = 0; f < frames; f++) {
    powerSpectrum(x, f * hop, N, ps);
    let fl = 0, e = 0;
    for (let k = 1; k < kmax; k++) { e += ps[k]; cur[k] = Math.log(1 + 1000 * Math.sqrt(ps[k])); const d = cur[k] - prev[k]; if (d > 0) fl += d; }
    flux[f] = fl; loud[f] = e;   // frame 0 against silence: a sound that starts the take is an onset
    const t = prev; prev = cur; cur = t;
  }
  let mean = 0; for (const v of flux) mean += v; mean /= frames;
  let maxLoud = 0, maxFlux = 0; for (const v of loud) maxLoud = Math.max(maxLoud, v);
  for (const v of flux) maxFlux = Math.max(maxFlux, v);
  // an onset must also rise above a fixed floor (a quarter of the bins up by ~1/8 of a natural-log unit: steady
  // tones and stationary noise wobble well under it) and above a tenth of the loudest onset in the take
  const floorAbs = 0.03 * kmax, floorRel = 0.1 * maxFlux;
  const W = Math.max(3, Math.round(0.1 * sr / hop)), minGap = Math.round(0.05 * sr / hop), out = [];
  const win = [];
  let last = -1e9;
  for (let f = 0; f < frames; f++) {
    win.length = 0;
    for (let j = Math.max(0, f - W); j <= Math.min(frames - 1, f + W); j++) win.push(flux[j]);
    win.sort((a, b) => a - b);
    const th = Math.max(win[win.length >> 1] + 0.5 * mean, floorAbs, floorRel);
    const v = flux[f];
    if (v > th && (f === 0 || v >= flux[f - 1]) && (f === frames - 1 || v >= flux[f + 1]) && loud[f] > maxLoud * 1e-5 && f - last >= minGap) { out.push((f * hop + N / 2) / sr); last = f; }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- chroma & key
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export function chroma(buffer, opts = {}) {
  const { ch, sr } = channelsOf(buffer, opts);
  const x = mono(ch), N = 8192, nb = N / 2 + 1, hz = sr / N, ps = new Float64Array(nb), c = new Float64Array(12);
  const kLo = Math.ceil(55 / hz), kHi = Math.min(nb - 2, Math.floor(4200 / hz));
  const pc = new Int8Array(nb), w = new Float64Array(nb);
  for (let k = kLo; k <= kHi; k++) { const m = 69 + 12 * Math.log2(k * hz / 440), r = Math.round(m), d = m - r; pc[k] = ((r % 12) + 12) % 12; w[k] = Math.cos(Math.PI * d) ** 2; }
  let used = 0;
  for (const at of frameStarts(x.length, N, N / 2, 600)) {
    powerSpectrum(x, at, N, ps);
    let mx = 0; for (let k = kLo; k <= kHi; k++) mx = Math.max(mx, ps[k]);
    if (mx < 1e-12) continue;
    const fc = new Float64Array(12), th = mx * 1e-5;
    for (let k = kLo; k <= kHi; k++) {
      const v = ps[k];
      if (v > th && v >= ps[k - 1] && v >= ps[k + 1]) fc[pc[k]] += Math.sqrt(v) * w[k] * (1 / Math.sqrt(1 + k * hz / 1000)); // favour fundamentals a little
    }
    let fm = 0; for (const v of fc) fm = Math.max(fm, v);
    if (fm > 0) { for (let i = 0; i < 12; i++) c[i] += fc[i] / fm; used++; }
  }
  if (!used) return null;
  let m = 0; for (const v of c) m = Math.max(m, v);
  return Array.from(c, (v) => r3(v / m));
}
function pearson(a, b) {
  const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}
// Krumhansl-Schmuckler: correlate the chroma with the 24 rotated key profiles. confidence = the best correlation
// (0..1); `alt` is the runner up (often the relative major/minor).
export function keyOf(chromaVec) {
  if (!chromaVec) return null;
  const all = [];
  for (let root = 0; root < 12; root++) for (const [scale, prof] of [['major', KS_MAJOR], ['minor', KS_MINOR]]) {
    const rot = prof.map((_, i) => prof[(i - root + 12) % 12]);
    all.push({ root: NAMES[root], scale, r: pearson(chromaVec, rot) });
  }
  all.sort((a, b) => b.r - a.r);
  const [best, alt] = all;
  return { root: best.root, scale: best.scale, confidence: r2(Math.max(0, best.r)), alt: { root: alt.root, scale: alt.scale, confidence: r2(Math.max(0, alt.r)) } };
}

// ---------------------------------------------------------------------------------------------------- measure
export function measure(buffer, opts = {}) {
  const { ch, sr } = channelsOf(buffer, opts);
  const n = ch[0] ? ch[0].length : 0;
  const out = { duration: r3(n / sr), sr, channels: ch.length };
  if (!n) return Object.assign(out, { lufs: FLOOR, lufsShortMax: FLOOR, lra: 0, truePeak: FLOOR, peak: FLOOR, rms: FLOOR, crest: 0, bands: null, bandsAbs: null, centroid: 0, width: 1, correlation: 1, sideDb: FLOOR, onsetsPerSec: 0, silencePct: 100, clipped: 0, chroma: null, key: null });

  const ld = loudnessParts(ch, sr);
  let sp = 0, tp = 0, sq = 0, clipped = 0;
  for (const x of ch) {
    const t = truePeakOf(x); sp = Math.max(sp, t.sp); tp = Math.max(tp, t.tp);
    for (let i = 0; i < n; i++) { const v = x[i]; sq += v * v; if (v >= 1 || v <= -1) clipped++; }
  }
  const rms = Math.sqrt(sq / (n * ch.length));
  // stereo: correlation of L and R, and the side channel's energy against the mid's
  let correlation = 1, sideDb = FLOOR;
  if (ch.length >= 2) {
    const [a, b] = ch; let ab = 0, aa = 0, bb = 0, mm = 0, ss = 0;
    for (let i = 0; i < n; i++) { const l = a[i], r = b[i]; ab += l * r; aa += l * l; bb += r * r; const m = l + r, s = l - r; mm += m * m; ss += s * s; }
    correlation = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : (aa + bb > 0 ? 0 : 1);
    sideDb = mm > 0 ? dBp(ss / mm) : (ss > 0 ? 0 : FLOOR);
  }
  // silence: 50 ms frames whose loudest channel's RMS is under -60 dBFS
  const fl = Math.max(1, Math.round(sr * 0.05)), nf = Math.max(1, Math.ceil(n / fl));
  let silent = 0;
  for (let f = 0; f < nf; f++) {
    let m = 0;
    for (const x of ch) { let s = 0; const a = f * fl, e = Math.min(n, a + fl); for (let i = a; i < e; i++) s += x[i] * x[i]; m = Math.max(m, s / Math.max(1, e - a)); }
    if (m < 1e-6) silent++;
  }
  const spec = spectrumStats(ch, sr);
  const on = onsets({ channels: ch, sr });
  const chr = rms > 1e-5 ? chroma({ channels: ch, sr }) : null;
  const fin = (v) => (Number.isFinite(v) ? r2(v) : FLOOR);
  return Object.assign(out, {
    lufs: fin(ld.integrated), lufsShortMax: fin(ld.stMax), lra: r2(ld.lra),
    truePeak: r2(dB(tp)), peak: r2(dB(sp)), rms: r2(dB(rms)), crest: r2(dB(sp) - dB(rms)),
    bands: spec.bands, bandsAbs: spec.bandsAbs, centroid: spec.centroid,
    width: r3(correlation), correlation: r3(correlation), sideDb: r2(sideDb),
    onsetsPerSec: r2(on.length / (n / sr)), silencePct: r2(100 * silent / nf), clipped,
    chroma: chr, key: chr ? keyOf(chr) : null,
  });
}

// ---------------------------------------------------------------------------------------------------- spectrogram
// Dark to warm (an inferno-like ramp: black, deep violet, crimson, orange, pale yellow).
const RAMP = [[0, 0, 0, 4], [0.15, 31, 12, 72], [0.3, 85, 15, 109], [0.45, 136, 34, 106], [0.6, 186, 54, 85], [0.72, 227, 89, 51], [0.85, 249, 140, 10], [0.95, 249, 201, 50], [1, 252, 255, 164]];
function color(v) {
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  for (let i = 1; i < RAMP.length; i++) if (v <= RAMP[i][0]) {
    const a = RAMP[i - 1], b = RAMP[i], t = (v - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
  return RAMP[RAMP.length - 1].slice(1);
}
// RGBA pixels of a log-frequency spectrogram (20 Hz at the bottom to min(20k, Nyquist) at the top).
export function spectrogramPixels(buffer, { width = 800, height = 300, floor = 90, ...opts } = {}) {
  const { ch, sr } = channelsOf(buffer, opts);
  const x = mono(ch), N = 4096, nb = N / 2 + 1, hz = sr / N, ps = new Float64Array(nb);
  const W = Math.max(8, width | 0), H = Math.max(8, height | 0), lo = 20, hi = Math.min(20000, sr / 2);
  const cols = new Array(W);
  let top = -Infinity;
  // which bins each row covers (rows map to log frequency; low rows interpolate between bins, high rows take the max)
  const rowLo = new Float64Array(H), rowHi = new Float64Array(H);
  for (let r = 0; r < H; r++) {
    rowLo[r] = lo * Math.pow(hi / lo, r / H) / hz; rowHi[r] = lo * Math.pow(hi / lo, (r + 1) / H) / hz;
  }
  for (let c = 0; c < W; c++) {
    const centre = Math.round(((c + 0.5) / W) * x.length) - N / 2;
    powerSpectrum(x, centre, N, ps);
    const col = new Float64Array(H);
    for (let r = 0; r < H; r++) {
      let v;
      const a = rowLo[r], b = rowHi[r];
      if (b - a < 1) { const k = (a + b) / 2, i = Math.floor(k), t = k - i; v = ps[Math.min(nb - 1, i)] * (1 - t) + ps[Math.min(nb - 1, i + 1)] * t; }
      else { v = 0; for (let k = Math.floor(a); k <= Math.min(nb - 1, Math.ceil(b)); k++) v = Math.max(v, ps[k]); }
      col[r] = dBp(v); if (col[r] > top) top = col[r];
    }
    cols[c] = col;
  }
  if (!Number.isFinite(top) || top <= FLOOR) top = 0;
  const px = new Uint8ClampedArray(W * H * 4);
  // faint octave lines at 31.25 Hz * 2^k (125, 250, 500, 1k, 2k, 4k, 8k, 16k...)
  const lines = new Set();
  for (let f = 31.25; f < hi; f *= 2) if (f > lo) lines.add(H - 1 - Math.floor(H * Math.log(f / lo) / Math.log(hi / lo)));
  for (let c = 0; c < W; c++) for (let r = 0; r < H; r++) {
    const y = H - 1 - r, [R, G, B] = color(1 + (cols[c][r] - top) / floor), o = (y * W + c) * 4;
    const ln = lines.has(y) ? 0.14 : 0;
    px[o] = R + (255 - R) * ln; px[o + 1] = G + (255 - G) * ln; px[o + 2] = B + (255 - B) * ln; px[o + 3] = 255;
  }
  return { width: W, height: H, data: px };
}
export async function spectrogram(buffer, opts = {}) {
  const img = spectrogramPixels(buffer, opts);
  // a canvas when there is one (browser), else the pure-JS encoder (Node, workers without OffscreenCanvas)
  if (typeof document !== 'undefined' && document.createElement) {
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d');
    if (g) { g.putImageData(new ImageData(img.data, img.width, img.height), 0, 0); return cv.toDataURL('image/png'); }
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const cv = new OffscreenCanvas(img.width, img.height), g = cv.getContext('2d');
    g.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    return 'data:image/png;base64,' + b64(new Uint8Array(await blob.arrayBuffer()));
  }
  return 'data:image/png;base64,' + b64(await encodePNG(img));
}

// A minimal PNG encoder (RGB, filter 0). Deflate via CompressionStream when available, else stored blocks.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function adler32(b) { let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }
async function zlib(raw) {
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate'), w = cs.writable.getWriter();
    w.write(raw); w.close();
    const parts = [], rd = cs.readable.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); }
    let len = 0; for (const p of parts) len += p.length;
    const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const nblk = Math.ceil(raw.length / 65535) || 1, out = new Uint8Array(2 + raw.length + nblk * 5 + 4);
  out[0] = 0x78; out[1] = 0x01; let o = 2;
  for (let b = 0; b < nblk; b++) {
    const a = b * 65535, len = Math.min(65535, raw.length - a);
    out[o++] = b === nblk - 1 ? 1 : 0; out[o++] = len & 255; out[o++] = len >> 8; out[o++] = ~len & 255; out[o++] = (~len >> 8) & 255;
    out.set(raw.subarray(a, a + len), o); o += len;
  }
  const ad = adler32(raw); out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 255; out[o++] = (ad >>> 8) & 255; out[o++] = ad & 255;
  return out;
}
export async function encodePNG({ width, height, data }) {
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; for (let x = 0; x < width; x++) { const i = (y * width + x) * 4, o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = data[i]; raw[o + 1] = data[i + 1]; raw[o + 2] = data[i + 2]; } }
  const chunk = (type, body) => {
    const b = new Uint8Array(12 + body.length), dv = new DataView(b.buffer);
    dv.setUint32(0, body.length); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(body, 8); dv.setUint32(8 + body.length, crc32(b.subarray(4, 8 + body.length)));
    return b;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array(0))];
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function b64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// A few helpers others want.
export const dbToGain = (d) => Math.pow(10, d / 20);
export const gainToDb = dB;
