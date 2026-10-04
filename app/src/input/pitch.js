// Pitch: YIN for a tuner, a probabilistic tracker (pYIN) for a voice, and the note tracker that turns its frames into
// notes. Pure functions (no DOM, no audio graph), so they run in the browser and in Node (tools/input-test.js,
// tools/hum-bench.js).
//
//   yin(buf, sr, { lo, hi, out })        -> { hz, ap, conf, sure }   one window, hz 0 when there is no one clear note
//   createPitchTracker({ sr, hop, win, lo, hi })
//                                        -> { push(samples) -> new frames, decode() -> frames, trace() -> frames (the
//                                             undecoded tail from each frame's own best guess), frames, n, peakDb,
//                                             cands(i) -> [[midi, p], ...] }
//   frames(samples, sr, { hop, win })    -> [{ t, hz, midi, conf, pv, db, flux, ap, raw, own, up, dn }]  a take, decoded
//       hz/midi on the decoded path (0: unvoiced); conf the candidates' weight there times the level's; pv the frame's
//       voicing; raw its own best candidate; own/up/dn the weight at the path's pitch and an octave up and down
//   segment(frames, opts)                -> notes [{ t0, t1, midi, p, cents, conf, db, sung, tune, octaveDoubt, frames,
//                                             reattack }]  seconds; midi with the singer's drift taken off (sung: as sung)
//   createTracker({ hold })              -> a live tuner: push(frame) -> { midi, p, cents, stable, heldMs }  (cents only
//                                           when stable, else null)
//   createTuner({ lo, hi })              -> YIN, the instrument's range and the tracker: push(buf, sr, t) -> reading | null
//   fft(re, im), rms, dbOf, median, ftom
//
// YIN is ported from clawd-o-matic's plugYin (de Cheveigné & Kawahara): the search runs at half rate over the first
// half of the buffer (pairs averaged), the dip is refined at full rate with a parabola, so a tuner keeps its tenth of a
// cent at a tenth of the autocorrelation's work. lo is the lowest note (Hz) to look for: its period has to fit a quarter
// of the buffer (A1 = 55 Hz wants 4096 samples at 48 kHz).
//
// A voice is harder than a string: vibrato and breath blur the period, and a weak fundamental (a low hum through a
// laptop mic) makes YIN's one threshold pick the octave below or above. So the tracker is pYIN (Mauch & Dixon 2014):
// every dip of YIN's curve is a pitch candidate, weighted by how many thresholds (a Beta(2, 18) spread of them) would
// have picked it; a hidden Markov model over 0.2-semitone pitch states plus one unvoiced state then picks the path
// through the candidates (Viterbi), so a frame that jumps an octave and back costs two leaps (an octave leap costs
// more than any other) and loses to the candidate that stays put. YIN reads a copy low-passed at 2 kHz and taken down
// to about 12 kHz (breath lives up there and blurs the period; a quarter of the work). Each frame also carries its
// level and spectral flux, which the note tracker uses to split a repeated note sung legato (a dip in level, a new
// syllable) where the pitch never moves.
//
// Real time: the tracker takes samples as they come and does a fixed amount of work per 10 ms frame (the YIN
// difference, a 1024-point FFT, one Viterbi step: about 80 µs in Node on an M-series Mac) in buffers it allocated up
// front; it grows its frame store a chunk (5 s) at a time. decode() (a backtrace) and segment() are linear in the take
// and run a few times a second while you hum. tools/hum-bench.js measures all of it.

export const median = (a) => { const s = Array.from(a).sort((p, q) => p - q), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
export const ftom = (f) => 69 + 12 * Math.log2(f / 440);
export const dbOf = (x) => 20 * Math.log10(Math.max(1e-9, x));
export function rms(x, a = 0, b = x.length) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }

const SCRATCH = new Map(); // N -> { x, d }
export function yin(buf, sr, { lo = 50, hi = 1400, out = {}, thresh = 0.15 } = {}) {
  out.hz = 0; out.ap = 1; out.conf = 0; out.sure = false;
  const N = buf.length >> 1, s = sr / 2, W = N >> 1;
  const maxT = Math.min(W - 2, Math.floor(s / lo)), minT = Math.max(2, Math.floor(s / hi));
  if (maxT <= minT + 2) return out;
  let sc = SCRATCH.get(N);
  if (!sc) { sc = { x: new Float32Array(N), d: new Float32Array(W) }; SCRATCH.set(N, sc); }
  const x = sc.x, d = sc.d;
  let e = 0;
  for (let i = 0; i < N; i++) { const v = (buf[2 * i] + buf[2 * i + 1]) * 0.5; x[i] = v; e += v * v; }
  if (Math.sqrt(e / N) < 0.0015) return out;
  // the cumulative mean normalised difference d'(τ)
  let sum = 0;
  d[0] = 1;
  for (let t = 1; t <= maxT; t++) {
    let a = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; a += v * v; }
    sum += a;
    d[t] = sum > 0 ? (a * t) / sum : 1;
  }
  // the first dip under the threshold (then down to its bottom), else the deepest dip
  let T = -1;
  for (let t = minT; t <= maxT; t++) {
    if (d[t] < thresh) { while (t + 1 <= maxT && d[t + 1] < d[t]) t++; T = t; break; }
  }
  if (T < 0) { let b = 1; for (let t = minT; t <= maxT; t++) if (d[t] < b) { b = d[t]; T = t; } }
  if (T < 0 || T >= maxT) return out;
  out.ap = d[T];
  out.conf = Math.max(0, Math.min(1, 1 - d[T] / 0.4));
  if (d[T] > 0.4) return out; // no one clear period: a chord, noise, breath, a note dying away
  out.sure = d[T] <= 0.25;
  out.hz = refine(buf, sr, T, s);
  return out;
}
// the period at the full rate: the plain difference around 2T, then a parabola through its bottom three
function refine(buf, sr, T, s) {
  const Wf = buf.length >> 1, lim = buf.length - Wf - 1;
  const c0 = Math.round(2 * T);
  let best = c0, bv = Infinity;
  for (let t = Math.max(2, c0 - 2); t <= Math.min(lim, c0 + 2); t++) { const v = sqdiff(buf, t, Wf); if (v < bv) { bv = v; best = t; } }
  if (best < 3 || best >= lim) return s / T;
  const a = sqdiff(buf, best - 1, Wf), c = sqdiff(buf, best + 1, Wf), den = a - 2 * bv + c;
  return sr / (best + (den > 0 ? (a - c) / (2 * den) : 0));
}
// the same around a full-rate period estimate Tf (searching ±3%)
function refineAt(buf, sr, Tf) {
  const Wf = buf.length >> 1, lim = buf.length - Wf - 1;
  const c0 = Math.round(Tf), r = Math.max(2, Math.ceil(Tf * 0.03));
  let best = c0, bv = Infinity;
  for (let t = Math.max(2, c0 - r); t <= Math.min(lim, c0 + r); t++) { const v = sqdiff(buf, t, Wf); if (v < bv) { bv = v; best = t; } }
  if (best < 3 || best >= lim || best === c0 - r || best === c0 + r) return sr / Tf;
  const a = sqdiff(buf, best - 1, Wf), c = sqdiff(buf, best + 1, Wf), den = a - 2 * bv + c;
  return sr / (best + (den > 0 ? (a - c) / (2 * den) : 0));
}
function sqdiff(buf, t, W) { let a = 0; for (let i = 0; i < W; i++) { const v = buf[i] - buf[i + t]; a += v * v; } return a; }
// a 2nd-order Butterworth low-pass (two in a row make a 4th-order one)
function biquadLp(fc, sr) {
  const w = Math.tan((Math.PI * Math.min(fc, sr * 0.45)) / sr), k = 1 / (1 + Math.SQRT2 * w + w * w);
  const b0 = w * w * k, b1 = 2 * b0, a1 = 2 * (w * w - 1) * k, a2 = (1 - Math.SQRT2 * w + w * w) * k;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return { run(x) { const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; } };
}

/* ---------------------------------------------------------------- pYIN + Viterbi: the voice tracker */
// the cumulative weight of thresholds s ≤ x, for s = 0.01 .. 1.00 weighted by a Beta(2, b) (b = 18: a mean of 0.1), as a
// table over 0..1
const BETAS = new Map();
function betaCdf(b) {
  if (BETAS.has(b)) return BETAS.get(b);
  const a = 2, w = [];
  let tot = 0;
  for (let i = 1; i <= 100; i++) { const s = i / 100, v = Math.pow(s, a - 1) * Math.pow(1 - s, b - 1); w.push(v); tot += v; }
  const G = new Float32Array(1002); let acc = 0, k = 0;
  for (let j = 0; j <= 1001; j++) { const x = j / 1000; while (k < 100 && (k + 1) / 100 <= x + 1e-9) { acc += w[k] / tot; k++; } G[j] = acc; }
  BETAS.set(b, G);
  return G;
}

export function createPitchTracker({
  sr, hop = 0.01, win = 2048, lo = 65, hi = 1300, res = 0.2, reach = 15, jumpP = 0.004, switchP = 0.01,
  maxCand = 6, chunk = 512, gateDb = null, unvoiced = 0.12, lp = 2000, octaveP = 0.03, beta = 18,
} = {}) {
  // YIN reads a low-passed copy (breath and hiss live above 2 kHz and blur the period) at about 12 kHz; the flux reads
  // the whole band at half rate
  const H = Math.max(1, Math.round(hop * sr)), N = win >> 1, s2 = sr / 2;
  const D = Math.max(1, Math.floor(sr / 12000)), fs = sr / D, NY = Math.floor(win / D), W = NY >> 1;
  const maxT = Math.min(W - 2, Math.floor(fs / lo)), minT = Math.max(2, Math.floor(fs / hi));
  const lpA = biquadLp(lp, sr), lpB = biquadLp(lp, sr);
  const m0 = Math.floor(ftom(lo)), m1 = Math.ceil(ftom(hi)), B = Math.round((m1 - m0) / res) + 1, U = B, S = B + 1;
  const FB = Math.min(N >> 1, Math.round(5000 / (s2 / N))); // flux bins (up to 5 kHz)
  // scratch, allocated once
  const ring = new Float32Array(win), ringF = new Float32Array(win), fbuf = new Float32Array(win), lbuf = new Float32Array(win);
  const x = new Float32Array(NY), xr = new Float32Array(N), d = new Float32Array(maxT + 2);
  const re = new Float32Array(N), im = new Float32Array(N), hann = new Float32Array(N), lm = [new Float32Array(FB), new Float32Array(FB)];
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const trT = new Int32Array(maxT), trD = new Float32Array(maxT); // troughs (τ, d')
  const cT = new Float32Array(maxCand), cP = new Float32Array(maxCand), cM = new Float32Array(maxCand);
  const ob = new Float64Array(S), dA = new Float64Array(S), dB = new Float64Array(S);
  const logT = new Float64Array(2 * reach + 1);
  // (scaled so that holding a pitch costs what staying unvoiced does: one unvoiced state stands for pYIN's B of them)
  for (let k = -reach; k <= reach; k++) logT[k + reach] = Math.log(((reach + 1 - Math.abs(k)) / (reach + 1)) * (1 - jumpP) * (1 - switchP));
  const logJump = Math.log(jumpP * (1 - switchP)), logVU = Math.log(switchP), logUU = Math.log(1 - switchP), logUV = Math.log(switchP);
  const G = betaCdf(beta), cdf = (v) => (v >= 1 ? 1 : v <= 0 ? 0 : G[Math.floor(v * 1000)]);
  const logFloor = Math.log(1e-4), OCT = Math.round(12 / res), logOct = Math.log(octaveP);
  let w = 0, total = 0, n = 0, cur = dA, nxt = dB, flip = 0, peak = -120;
  cur.fill(-Infinity); cur[U] = 0;
  const chunks = [];
  const C = chunk;
  function newChunk() {
    return { bp: new Uint16Array(C * S), cm: new Float32Array(C * maxCand), cp: new Float32Array(C * maxCand), cn: new Uint8Array(C),
      t: new Float64Array(C), db: new Float32Array(C), pv: new Float32Array(C), lev: new Float32Array(C), fx: new Float32Array(C), ap: new Float32Array(C) };
  }
  const tr = {
    sr, hop: H / sr, win, lo, hi, bins: B, m0, res,
    get n() { return n; },
    get peakDb() { return peak; },
    frames: [],
    // feed samples (any length); analyses every hop; returns how many frames were added
    push(xs) {
      const before = n;
      for (let i = 0; i < xs.length; i++) {
        const v = xs[i];
        ring[w] = v; ringF[w] = lpB.run(lpA.run(v)); w = w + 1 === win ? 0 : w + 1; total++;
        if (total >= win && (total - win) % H === 0) analyse((total - win + win / 2) / sr);
      }
      return n - before;
    },
    // tr.frames, with the frames not decoded yet filled from their own best guess (the live trace between decodes)
    trace() {
      const fr = tr.frames;
      for (let i = fr.length; i < n; i++) {
        const c = chunks[(i / C) | 0], k = i % C, nc = c.cn[k];
        let bm = 0, bp = 0;
        for (let q = 0; q < nc; q++) if (c.cp[k * maxCand + q] > bp) { bp = c.cp[k * maxCand + q]; bm = c.cm[k * maxCand + q]; }
        const conf = Math.min(1, bp * c.lev[k] * 1.1), on = conf >= 0.3;
        fr.push({ t: c.t[k], hz: on ? 440 * Math.pow(2, (bm - 69) / 12) : 0, midi: on ? bm : 0, conf, pv: c.pv[k] * c.lev[k], ap: c.ap[k], db: c.db[k], flux: c.fx[k], raw: bm, own: 0, up: 0, dn: 0 });
      }
      return fr;
    },
    // the frame's candidates: [[midi, probability], ...]
    cands(i) {
      const c = chunks[(i / C) | 0], k = i % C, out = [];
      for (let q = 0; q < c.cn[k]; q++) out.push([c.cm[k * maxCand + q], c.cp[k * maxCand + q]]);
      return out;
    },
    decode,
  };

  function analyse(t) {
    // the window, oldest sample first
    for (let i = 0, j = w; i < win; i++) { fbuf[i] = ring[j]; lbuf[i] = ringF[j]; j = j + 1 === win ? 0 : j + 1; }
    let e = 0;
    for (let i = win >> 2, e2 = (win * 3) >> 2; i < e2; i++) e += fbuf[i] * fbuf[i];
    const db = 10 * Math.log10(Math.max(1e-18, e / (win >> 1)));
    if (db > peak) peak = db;
    let ex = 0;
    for (let i = 0; i < NY; i++) { let v = 0; for (let k = 0; k < D; k++) v += lbuf[D * i + k]; v /= D; x[i] = v; ex += v * v; }
    // spectral flux (half-wave rectified, log magnitude) on the half-rate window
    for (let i = 0; i < N; i++) xr[i] = (fbuf[2 * i] + fbuf[2 * i + 1]) * 0.5;
    for (let i = 0; i < N; i++) { re[i] = xr[i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const Lc = lm[flip], Lp = lm[flip ^ 1];
    let fx = 0;
    for (let k = 1; k < FB; k++) { const v = Math.log(1 + 1000 * Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N); Lc[k] = v; const dd = v - Lp[k]; if (dd > 0) fx += dd; }
    flip ^= 1;
    fx /= FB;
    // YIN's d'(τ), its troughs, and the probability that a threshold picks each
    let nc = 0, dMin = 1, pv = 0;
    if (ex > 1e-12) {
      let sum = 0; d[0] = 1;
      for (let tau = 1; tau <= maxT; tau++) {
        let a = 0;
        for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; a += v * v; }
        sum += a; d[tau] = sum > 0 ? (a * tau) / sum : 1;
      }
      let nt = 0, gmin = 2, gi = -1;
      for (let tau = minT; tau < maxT; tau++) {
        if (d[tau] < d[tau - 1] && d[tau] <= d[tau + 1]) { trT[nt] = tau; trD[nt] = d[tau]; if (d[tau] < gmin) { gmin = d[tau]; gi = nt; } nt++; }
      }
      dMin = gmin;
      let prevMin = 2;
      for (let k = 0; k < nt; k++) {
        const dk = trD[k];
        let p = prevMin > dk ? cdf(prevMin) - cdf(dk) : 0;
        if (k === gi) p += 0.01 * cdf(gmin); // no threshold reached it: the deepest dip, barely
        if (dk < prevMin) prevMin = dk;
        if (p < 1e-4) continue;
        // keep the maxCand most probable
        let at = nc;
        if (nc === maxCand) { let lo2 = 0; for (let q = 1; q < nc; q++) if (cP[q] < cP[lo2]) lo2 = q; if (cP[lo2] >= p) continue; at = lo2; } else nc++;
        const tau = trT[k], a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
        cT[at] = tau + (den > 0 ? (a - c) / (2 * den) : 0); cP[at] = p;
      }
      for (let q = 0; q < nc; q++) pv += cP[q];
      // the most probable candidates get the full-rate period (a tuner's precision); the rest keep the parabola's
      for (let q = 0; q < nc; q++) cM[q] = cP[q] > 0.15 ? ftom(refineAt(lbuf, sr, cT[q] * D)) : ftom(fs / cT[q]);
    }
    // level: a frame well under the take's peak is not a note, whatever YIN says
    const gate = gateDb ?? Math.max(-62, peak - 38);
    const lev = 1 / (1 + Math.exp(-(db - gate) / 2.5));
    if (pv > 0.99) pv = 0.99;
    const pvl = pv * lev;
    // observation: a voiced state is as likely as the candidates at its pitch (spread over a bin either side) times
    // the level's say; the unvoiced state gets what the candidates don't claim
    const llev = Math.log(Math.max(1e-6, lev)), base = llev + logFloor;
    for (let j = 0; j < B; j++) ob[j] = 0;
    for (let q = 0; q < nc; q++) {
      const b = (cM[q] - m0) / res;
      if (!(b > -1 && b < B)) continue;
      const j0 = Math.floor(b), f = b - j0;
      if (j0 >= 0) ob[j0] += cP[q] * (1 - f) * 0.75;
      if (j0 + 1 < B) ob[j0 + 1] += cP[q] * f * 0.75;
      if (j0 - 1 >= 0) ob[j0 - 1] += cP[q] * 0.125;
      if (j0 + 2 < B) ob[j0 + 2] += cP[q] * 0.125;
    }
    for (let j = 0; j < B; j++) ob[j] = ob[j] > 0 ? llev + Math.log(ob[j] + 1e-4) : base;
    ob[U] = Math.log(Math.max(1e-6, (1 - pvl) * unvoiced));
    // one Viterbi step
    const ci = (n / C) | 0, k = n % C;
    if (ci >= chunks.length) chunks.push(newChunk());
    const ch = chunks[ci], bp = ch.bp, o = k * S;
    // a leap from anywhere: from the best three separate peaks, an octave leap costing more (it is the tracker's
    // favourite mistake, and rarely the singer's)
    let mv = -Infinity, mj = 0, p2 = -1, p3 = -1;
    for (let j = 0; j < B; j++) if (cur[j] > mv) { mv = cur[j]; mj = j; }
    for (let j = 0; j < B; j++) if ((j - mj > 5 || mj - j > 5) && (p2 < 0 || cur[j] > cur[p2])) p2 = j;
    if (p2 >= 0) for (let j = 0; j < B; j++) if ((j - mj > 5 || mj - j > 5) && (j - p2 > 5 || p2 - j > 5) && (p3 < 0 || cur[j] > cur[p3])) p3 = j;
    const cu = cur[U];
    let best = -Infinity;
    for (let j = 0; j < B; j++) {
      let bv = -Infinity, bj = mj;
      for (let q = 0; q < 3; q++) {
        const pk = q === 0 ? mj : q === 1 ? p2 : p3;
        if (pk < 0) break;
        const dj = pk > j ? pk - j : j - pk, oct = dj >= OCT - 3 && dj <= OCT + 3;
        const v = cur[pk] + logJump + (oct ? logOct : 0);
        if (v > bv) { bv = v; bj = pk; }
        if (!oct) break;
      }
      const a = j - reach < 0 ? 0 : j - reach, b = j + reach >= B ? B - 1 : j + reach;
      for (let i = a; i <= b; i++) { const v = cur[i] + logT[j - i + reach]; if (v > bv) { bv = v; bj = i; } }
      const vu = cu + logUV;
      if (vu > bv) { bv = vu; bj = U; }
      const r = bv + ob[j];
      nxt[j] = r; bp[o + j] = bj;
      if (r > best) best = r;
    }
    { const a = cu + logUU, b = mv + logVU; const r = (a >= b ? a : b) + ob[U]; nxt[U] = r; bp[o + U] = a >= b ? U : mj; if (r > best) best = r; }
    for (let j = 0; j < S; j++) nxt[j] -= best;
    const tmp = cur; cur = nxt; nxt = tmp;
    // keep the frame
    ch.t[k] = t; ch.db[k] = db; ch.pv[k] = pv; ch.lev[k] = lev; ch.fx[k] = fx; ch.ap[k] = dMin; ch.cn[k] = nc;
    for (let q = 0; q < nc; q++) { ch.cm[k * maxCand + q] = cM[q]; ch.cp[k * maxCand + q] = cP[q]; }
    n++;
  }

  // The most likely path so far (a backtrace from the best state now), written into tr.frames (one object a frame,
  // reused): hz/midi on the path (the candidate there, at its own precision), 0 when unvoiced; conf the candidates'
  // probability near the path times the level's; raw the frame's own best candidate.
  let path = new Int16Array(0);
  function decode() {
    if (path.length < n) { const np = new Int16Array(Math.max(n, path.length * 2, 1024)); path = np; }
    let s = U, bv = -Infinity;
    for (let j = 0; j < S; j++) if (cur[j] > bv) { bv = cur[j]; s = j; }
    for (let i = n - 1; i >= 0; i--) { path[i] = s; const c = chunks[(i / C) | 0]; s = c.bp[(i % C) * S + s]; }
    const fr = tr.frames;
    for (let i = 0; i < n; i++) {
      const c = chunks[(i / C) | 0], k = i % C, j = path[i], nc = c.cn[k];
      let f = fr[i];
      if (!f) { f = fr[i] = { t: 0, hz: 0, midi: 0, conf: 0, pv: 0, ap: 1, db: -120, flux: 0, raw: 0, own: 0, up: 0, dn: 0 }; }
      f.t = c.t[k]; f.db = c.db[k]; f.flux = c.fx[k]; f.ap = c.ap[k]; f.pv = c.pv[k] * c.lev[k];
      let rb = 0, rm = 0;
      for (let q = 0; q < nc; q++) if (c.cp[k * maxCand + q] > rb) { rb = c.cp[k * maxCand + q]; rm = c.cm[k * maxCand + q]; }
      f.raw = rm;
      f.own = 0; f.up = 0; f.dn = 0;
      if (j === U) { f.hz = 0; f.midi = 0; f.conf = 0; continue; }
      const bm = m0 + j * res;
      let pm = bm, pp = 0, near = 0;
      for (let q = 0; q < nc; q++) {
        const cm = c.cm[k * maxCand + q], cp = c.cp[k * maxCand + q];
        if (Math.abs(cm - bm) <= 2.5 * res) { near += cp; if (cp > pp) { pp = cp; pm = cm; } }
      }
      f.midi = pm; f.hz = 440 * Math.pow(2, (pm - 69) / 12);
      f.conf = Math.min(1, near * c.lev[k] * 1.1);
      // how much the octaves either side were believed (the note tracker weighs them against the tune)
      for (let q = 0; q < nc; q++) {
        const dm = c.cm[k * maxCand + q] - pm, cp = c.cp[k * maxCand + q];
        if (Math.abs(dm - 12) < 0.6) f.up += cp; else if (Math.abs(dm + 12) < 0.6) f.dn += cp;
      }
      f.own = near;
    }
    fr.length = n;
    return fr;
  }
  return tr;
}

// pYIN over a whole take: a frame every `hop` seconds with a `win`-sample window, decoded.
export function frames(samples, sr, { hop = 0.01, win = 2048, lo = 65, hi = 1300, gateDb = null } = {}) {
  const tr = createPitchTracker({ sr, hop, win, lo, hi, gateDb });
  tr.push(samples);
  return tr.decode();
}

/* ---------------------------------------------------------------- the note tracker */
// Frames -> notes, for an untrained voice. A note starts where the voice starts, where it dips in level and comes back
// (a repeated note sung legato; spectral flux at the same moment counts too), or where its pitch leaves the note it was
// on and stays left. "Stays": the pitch has to sit `split` semitones away for `hold` seconds and average further than a
// vibrato's crest does, so a vibrato of ±80 cents is one note. A scoop or a slide is the start of the note it goes to
// (a note isn't settled until its pitch is, or 0.2 s have passed). Then blips go, octave slips fold back, the singer's
// drift is measured (a running circular mean of how far each note sits off the semitone grid) and taken off, so a
// phrase that sinks 40 cents still lands on its notes. Each note's pitch is the trimmed mean of its settled part (the
// centre of a vibrato), and its confidence comes from the tracker's, how steady it was, its length and how near the
// grid it sat.
export function segment(fr, {
  minDur = 0.07, split = 0.6, hold = 0.07, gateDb = null, dipDb = 4.5, gap = 0.04, settle = 0.2, tune = true, fluxK = 2.5, riseDb = 6, settleSpan = 0.4, settleSlope = 0.2,
} = {}) {
  const n = fr.length;
  if (!n) return [];
  const hop = n > 1 ? (fr[n - 1].t - fr[0].t) / (n - 1) : 0.01;
  let peakDb = -120; for (const f of fr) if (f.db > peakDb) peakDb = f.db;
  const gate = gateDb ?? Math.max(-62, peakDb - 36);
  const v = new Uint8Array(n), m = new Float64Array(n), db = new Float64Array(n), fx = new Float64Array(n), cf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = fr[i];
    v[i] = f.hz > 0 && f.db > gate && (f.pv == null ? f.ap < 0.3 : true) ? 1 : 0;
    m[i] = f.midi || 0; db[i] = f.db; fx[i] = f.flux || 0; cf[i] = f.conf ?? 0.5;
  }
  // short dropouts inside a voiced stretch (no level dip, the pitch carries on): voiced
  const gapF = Math.max(1, Math.round(gap / hop));
  for (let i = 1; i < n; i++) {
    if (v[i] || !v[i - 1]) continue;
    let j = i; while (j < n && !v[j]) j++;
    if (j < n && j - i <= gapF) {
      let dip = Infinity; for (let k = i; k < j; k++) dip = Math.min(dip, db[k]);
      if (dip > Math.min(db[i - 1], db[j]) - 6 && Math.abs(m[j] - m[i - 1]) < 1.5) for (let k = i; k < j; k++) { v[k] = 1; m[k] = m[i - 1] + ((m[j] - m[i - 1]) * (k - i + 1)) / (j - i + 1); cf[k] = 0; }
    }
    i = j;
  }
  const notes = [];
  const K = Math.max(2, Math.round(hold / hop)), SET = Math.max(3, Math.round(settle / hop)), L = Math.max(4, Math.round(0.15 / hop));
  for (let a = 0; a < n;) {
    if (!v[a]) { a++; continue; }
    let b = a; while (b < n && v[b]) b++;
    // octave slips: fold a frame back when it sits ~12 st off its neighbourhood
    for (let i = a; i < b; i++) {
      const nb = []; for (let k = Math.max(a, i - 4); k < Math.min(b, i + 5); k++) if (k !== i) nb.push(m[k]);
      if (nb.length < 3) continue;
      const md = median(nb), dv = m[i] - md;
      if (Math.abs(Math.abs(dv) - 12) < 1.2) m[i] -= 12 * Math.sign(dv);
    }
    // the pitch through a 3-median
    const len = b - a, mm = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      const p = m[a + Math.max(0, i - 1)], q = m[a + i], r = m[a + Math.min(len - 1, i + 1)];
      mm[i] = Math.max(Math.min(p, q), Math.min(Math.max(p, q), r));
    }
    // re-attacks: a dip in level that comes back (a repeated note sung legato), or a sudden climb from a low point
    // with a flux peak on it (a new syllable, an accent); on the level as measured, not smoothed. A vibrato swings the
    // level too (its harmonics sweep across the formants), every cycle: a dip has to stand out from its neighbours.
    const cuts = new Uint8Array(len);
    let fmed = 0;
    { const xs = Array.from(fx.subarray(a, b)).sort((p, q) => p - q); fmed = xs[xs.length >> 1] || 0; }
    const mins = [];
    for (let i = 1; i < len - 2; i++) {
      const x0 = db[a + i];
      if (!(x0 <= db[a + i - 1] && x0 < db[a + i + 1])) continue;
      let lm = -Infinity, rm = -Infinity, r4 = -Infinity, fpk = 0;
      for (let k = Math.max(0, i - L); k < i; k++) lm = Math.max(lm, db[a + k]);
      for (let k = i + 1; k <= Math.min(len - 1, i + L); k++) rm = Math.max(rm, db[a + k]);
      for (let k = i + 1; k <= Math.min(len - 1, i + 4); k++) r4 = Math.max(r4, db[a + k]);
      for (let k = i; k <= Math.min(len - 1, i + 3); k++) fpk = Math.max(fpk, fx[a + k]);
      mins.push({ i, dip: Math.min(lm, rm) - x0, rise: r4 - x0, fl: fmed > 0 ? fpk / fmed : 0 });
    }
    const R = Math.round(0.3 / hop), V = Math.round(0.12 / hop);
    for (const c of mins) {
      // is the pitch swinging here (a vibrato: its crests and troughs 0.5 st or more apart once the trend is off)?
      let lo2 = Infinity, hi2 = -Infinity;
      for (let k = Math.max(0, c.i - V); k <= Math.min(len - 1, c.i + V); k++) {
        let sm = 0, sn = 0; for (let q = Math.max(0, k - 7); q <= Math.min(len - 1, k + 7); q++) { sm += mm[q]; sn++; }
        const r = mm[k] - sm / sn; if (r < lo2) lo2 = r; if (r > hi2) hi2 = r;
      }
      let need = dipDb;
      if (hi2 - lo2 > 0.5) {
        let swing = 0; for (const o of mins) if (o !== c && Math.abs(o.i - c.i) <= R && o.dip > swing) swing = o.dip;
        need = swing >= 1.5 ? Math.max(dipDb, 1.8 * swing + 1) : dipDb * 1.6;
      }
      if (c.dip >= need || (c.dip >= need * 0.6 && c.fl >= fluxK)) cuts[c.i] = 1;
      else if (c.rise >= Math.max(riseDb, need + 1.5) && c.fl >= fluxK) cuts[c.i + 1] = 1;
    }
    // walk the run: notes split at cuts and at pitch moves that stay
    let s0 = 0, settled = false, ref = mm[0], sAt = 0;
    const bounds = [0], hard = new Set([0]);
    const restart = (i, isHard) => { bounds.push(i); if (isHard) hard.add(i); s0 = i; sAt = i; settled = false; ref = mm[i]; };
    for (let i = 1; i < len; i++) {
      if (cuts[i] && i - s0 >= 3 && len - i >= 3) { restart(i, true); continue; }
      if (!settled) {
        // a note settles when its last K frames hold within half a semitone, or after `settle` seconds whatever they do
        const from = Math.max(s0, i - K + 1);
        let lo2 = Infinity, hi2 = -Infinity, sm = 0;
        for (let k = from; k <= i; k++) { lo2 = Math.min(lo2, mm[k]); hi2 = Math.max(hi2, mm[k]); }
        const span = Math.max(s0, i - 14);
        for (let k = span; k <= i; k++) sm += mm[k];
        ref = sm / (i - span + 1);
        const slope = i - from + 1 >= K ? Math.abs((mm[i] + mm[i - 1] + mm[i - 2]) - (mm[from] + mm[from + 1] + mm[from + 2])) / 3 : 9;
        if ((i - from + 1 >= K && hi2 - lo2 < settleSpan && slope < settleSlope) || i - s0 >= SET) { settled = true; sAt = from; }
        continue;
      }
      // the note's pitch: the mean of its last ~200 ms (a whole vibrato cycle, so its centre), excursions and all
      { const from = Math.max(sAt, i - 20); let sm = 0; for (let k = from; k < i; k++) sm += mm[k]; ref = sm / (i - from); }
      const dv = mm[i] - ref;
      if (Math.abs(dv) <= split) continue;
      if (len - i < K) break; // a fall at the end of a note isn't a note
      const sg = Math.sign(dv);
      let out = 0, sum = 0;
      for (let k = i; k < i + K; k++) { const d2 = (mm[k] - ref) * sg; if (d2 > split * 0.8) out++; sum += d2; }
      if (out < K - 1 || sum / K < split + 0.15) { continue; }
      // the note left at the last frame still near it
      let at = i;
      for (let q = i - 1; q > Math.max(s0 + 2, i - 20); q--) { if (Math.abs(mm[q] - ref) <= 0.3) break; at = q; }
      if (at - s0 < 3) at = i;
      restart(at, false);
      i = at;
    }
    bounds.push(len);
    for (let q = 0; q + 1 < bounds.length; q++) {
      const i0 = bounds[q], i1 = bounds[q + 1];
      if (i1 - i0 < 1) continue;
      const nt = noteOf(fr, m, mm, cf, a, i0, i1, hop, SET, K);
      nt.reattack = hard.has(i0) && i0 > 0;
      notes.push(nt);
    }
    a = b;
  }
  let ns = tidy(notes, { minDur, hop, m });
  ns = octaves(ns, fr);
  if (tune) ns = tuning(ns);
  for (const c of ns) {
    c.p = Math.round(c.midi); c.cents = Math.round((c.midi - c.p) * 100);
    // less sure: between two semitones, or when the frames believed another octave nearly as much
    const off = Math.abs(c.midi - c.p);
    let own = 0, alt = 0;
    for (let i = c.frames[0]; i < c.frames[1]; i++) { const f = fr[i]; if (f.hz > 0 && f.own != null) { own += f.own; alt += Math.max(f.up, f.dn); } }
    c.octaveDoubt = own > 0 ? Math.round((alt / own) * 100) / 100 : 0;
    c.conf = Math.max(0, Math.min(1, c.conf * (off > 0.3 ? 1 - (off - 0.3) * 2.5 : 1) * Math.max(0.3, Math.min(1, 1 - (c.octaveDoubt - 0.15) * 1.2))));
    c.peakDb = peakDb;
  }
  return ns;
}

function noteOf(fr, m, mm, cf, a, i0, i1, hop, SET, K) {
  const len = i1 - i0;
  // the settled part: after the scoop (the first frame from which K frames hold within half a semitone, at most SET in)
  let st = -1;
  for (let i = i0; i + K <= i1 && i - i0 <= SET; i++) {
    let lo = Infinity, hi = -Infinity; for (let k = i; k < i + K; k++) { lo = Math.min(lo, mm[k]); hi = Math.max(hi, mm[k]); }
    if (hi - lo < 0.5) { st = i; break; }
  }
  if (st < 0 && len > SET + K) st = i0 + SET; // a vibrato from the start: past the longest scoop
  // never settled (all scoop): where it got to, at the end
  const unsettled = st < 0 || i1 - st < Math.max(2, len * 0.4);
  if (unsettled) st = Math.max(i0, i1 - 4);
  const en = unsettled ? i1 : Math.max(st + 1, i1 - Math.floor((i1 - st) * 0.12));
  const all = []; for (let i = st; i < en; i++) all.push(m[a + i]);
  // a trimmed mean (a vibrato's centre) of the frames near the median (an octave slip at the tail is not the note)
  const md = median(all), xs = all.filter((x) => Math.abs(x - md) <= 1.2).sort((p, q) => p - q);
  const cut = Math.floor(xs.length * 0.1);
  let s = 0, c = 0; for (let i = cut; i < xs.length - cut; i++) { s += xs[i]; c++; }
  const midi = c ? s / c : md;
  // steadiness: the pitch through a ~150 ms mean (blind to vibrato) around the note's pitch
  let dev = 0, dn = 0;
  for (let i = st; i < en; i++) { let q = 0, qn = 0; for (let k = Math.max(st, i - 7); k <= Math.min(en - 1, i + 7); k++) { q += mm[k]; qn++; } dev += (q / qn - midi) ** 2; dn++; }
  dev = Math.sqrt(dev / Math.max(1, dn));
  let cs = 0, db = -120; for (let i = i0; i < i1; i++) { cs += cf[a + i]; db = Math.max(db, fr[a + i].db); }
  cs /= len;
  const dur = len * hop;
  const conf = Math.min(1, 1.25 * cs) * Math.exp(-Math.max(0, dev - 0.15) / 0.4) * Math.min(1, dur / 0.12);
  return { t0: fr[a + i0].t - hop / 2, t1: fr[a + i1 - 1].t + hop / 2, midi, sung: midi, p: Math.round(midi), cents: 0, conf, db, dev, frames: [a + i0, a + i1] };
}

// Merge what an untrained voice splits: blips under minDur go to the neighbour they lead into (a scoop is the start of
// the note it reaches) or come from, a short note between two others whose pitch lies between theirs is a slide into
// the next, and touching notes on the same pitch without a re-attack are one.
function tidy(notes, { minDur, hop, m }) {
  let ns = notes.slice();
  // from c's first frame to where next arrives, the pitch only moves toward next (a scoop or a slide), never sitting
  // still for 70 ms on the way (a note held that long was a note)
  const glides = (c, next) => {
    const d = next.midi - c.midi, sg = Math.sign(d);
    if (Math.abs(d) < 0.5 || Math.abs(d) > 3) return false;
    const a = c.frames[0], lim = Math.round(0.07 / hop);
    let from = a;
    for (let i = a + 1; i < next.frames[1]; i++) {
      if ((m[i] - m[i - 1]) * sg < -0.12) return false;
      if (Math.abs(m[i] - m[from]) >= 0.1) from = i; else if (i - from >= lim && i < c.frames[1]) return false;
      if (i >= next.frames[0] && Math.abs(m[i] - next.midi) < 0.3) return (m[i] - m[a]) * sg >= 0.6;
    }
    return false;
  };
  const touch = (x, y) => y.t0 - x.t1 < Math.max(0.03, 2.5 * hop);
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (let i = 0; i < ns.length; i++) {
      const c = ns[i], dur = c.t1 - c.t0, prev = out[out.length - 1], next = ns[i + 1];
      const between = prev && next && touch(prev, c) && touch(c, next) && (c.midi - prev.midi) * (next.midi - c.midi) > 0 && Math.abs(next.midi - prev.midi) >= 1;
      // a scoop: short, and gliding without a stop into the note it touches
      const scoop = next && dur < 0.25 && touch(c, next) && !next.reattack && glides(c, next);
      if (scoop) { next.t0 = c.t0; next.frames = [c.frames[0], next.frames[1]]; next.reattack = c.reattack; continue; }
      if (dur < minDur || (dur < 0.12 && between)) {
        const tp = prev && touch(prev, c), tn = next && touch(c, next);
        if (tn && (!tp || between || c.reattack || Math.abs(c.midi - next.midi) <= Math.abs(c.midi - prev.midi))) { next.t0 = c.t0; next.frames = [c.frames[0], next.frames[1]]; if (c.reattack) next.reattack = true; }
        else if (tp) { prev.t1 = c.t1; prev.frames = [prev.frames[0], c.frames[1]]; }
        continue; // (a lone blip: a click, a consonant)
      }
      if (prev && touch(prev, c) && Math.round(prev.midi) === Math.round(c.midi) && !c.reattack && Math.abs(prev.midi - c.midi) < 0.5) {
        const w1 = prev.t1 - prev.t0, w2 = dur;
        prev.midi = (prev.midi * w1 + c.midi * w2) / (w1 + w2); prev.sung = prev.midi; prev.t1 = c.t1; prev.frames = [prev.frames[0], c.frames[1]];
        prev.conf = (prev.conf * w1 + c.conf * w2) / (w1 + w2); prev.db = Math.max(prev.db, c.db);
        continue;
      }
      out.push(c);
    }
    ns = out;
  }
  return ns;
}

// Octaves: a low hum through a small mic, or a voice with a fry in it, can leave YIN two periods an octave apart for a
// whole note, and the path takes one. A note an octave off both its neighbours (who agree with each other, close by)
// moves back to them, if its frames saw that octave too. A note whose frames never saw it never moves.
function octaves(ns, fr) {
  for (let i = 1; i + 1 < ns.length; i++) {
    const a = ns[i - 1].midi, c = ns[i].midi, b = ns[i + 1].midi;
    if (Math.abs(a - b) > 5 || ns[i].t0 - ns[i - 1].t1 > 0.6 || ns[i + 1].t0 - ns[i].t1 > 0.6) continue;
    const mid = (a + b) / 2;
    for (const o of [12, -12]) {
      if (!(Math.abs(c + o - mid) < 4 && Math.abs(c - mid) > 9)) continue;
      let alt = 0, k = 0;
      for (let j = ns[i].frames[0]; j < ns[i].frames[1]; j++) { const f = fr[j]; if (f.hz > 0) { alt += (o > 0 ? f.up : f.dn) || 0; k++; } }
      if (k && alt / k >= 0.15) { ns[i].midi += o; ns[i].sung += o; ns[i].octave = o; ns[i].conf *= 0.8; }
      break;
    }
  }
  return ns;
}

// The singer's drift: each note's offset from the semitone grid, as a circular mean over its neighbours (weighted by
// length, ~3 s either side), when they agree; taken off each note (note.tune, in semitones; note.sung keeps the pitch
// as sung).
function tuning(ns) {
  if (ns.length < 3) { for (const c of ns) c.tune = 0; return ns; }
  const th = ns.map((c) => 2 * Math.PI * (c.midi - Math.round(c.midi)));
  const out = ns.map((c, i) => {
    let sx = 0, sy = 0, sw = 0;
    const tc = (c.t0 + c.t1) / 2;
    ns.forEach((o, j) => {
      const w = Math.min(1, o.t1 - o.t0) * Math.exp(-Math.abs((o.t0 + o.t1) / 2 - tc) / 3) * (0.3 + o.conf);
      sx += w * Math.cos(th[j]); sy += w * Math.sin(th[j]); sw += w;
    });
    const R = Math.hypot(sx, sy) / Math.max(1e-9, sw);
    const off = R > 0.6 ? Math.atan2(sy, sx) / (2 * Math.PI) : 0;
    return Math.max(-0.4, Math.min(0.4, off * Math.min(1, (R - 0.6) / 0.2)));
  });
  ns.forEach((c, i) => { c.tune = out[i]; c.midi = c.sung - out[i]; });
  return ns;
}

/* ---------------------------------------------------------------- a live tracker (tuning, the spiral's beads) */
// push({ t (s), hz, conf, db }) once a frame; returns the note it hears with hysteresis: it changes note only when the
// new one has held for `hold` seconds, so a vibrato or a scoop doesn't flicker the display.
//   p       the note it's on (0: nothing for `release` seconds)        midi  the pitch (the median of the last 5 frames)
//   stable  settled: the median's nearest note is p, `settle` of the last frames sit within half a semitone of it, and
//           a clear frame came in the last `fresh` seconds. Not while the pitch moves to another note (p waits `hold`
//           for it), on a chord or between notes.
//   cents   how far the pitch sits from p, -50..+50, only when stable (null otherwise: a held note is never measured
//           against a pitch that has already left it)
export function createTracker({ hold = 0.06, release = 0.25, minConf = 0.35, settle = 3, fresh = 0.1 } = {}) {
  const st = { midi: 0, p: 0, cents: null, stable: false, heldMs: 0, since: 0, cand: 0, candAt: 0, heardAt: -1, hist: [] };
  return {
    state: st,
    push(f) {
      const t = f.t;
      if (!(f.hz > 0) || f.conf < minConf) {
        if (t - st.heardAt > release) { st.p = 0; st.midi = 0; st.heldMs = 0; st.hist.length = 0; }
        if (t - st.heardAt > fresh) { st.stable = false; st.cents = null; }
        return st;
      }
      const m = ftom(f.hz);
      st.hist.push(m); if (st.hist.length > 5) st.hist.shift();
      const mm = median(st.hist), q = Math.round(mm);
      st.heardAt = t;
      if (q !== st.p) {
        if (q !== st.cand) { st.cand = q; st.candAt = t; }
        if (!st.p || t - st.candAt >= hold) { st.p = q; st.since = t; }
      } else st.cand = q;
      let near = 0;
      for (const h of st.hist) if (Math.abs(h - st.p) < 0.5) near++;
      st.midi = mm;
      st.stable = q === st.p && near >= settle;
      st.cents = st.stable ? Math.round((mm - st.p) * 100) : null;
      st.heldMs = (t - st.since) * 1000;
      return st;
    },
  };
}

// A tuner: YIN on a window (the last 4096 samples), the frames it can trust into the tracker. lo and hi (Hz) are the
// instrument's range: YIN looks only there, and a frame whose nearest note is outside it is dropped, so a chord's
// common period (an A7 strummed reads as A1, a fifth or more under the strings) is never a note. The default runs down
// to 38 Hz, a bass's low E (41 Hz); a guitar passes its low string and top fret. Frames YIN isn't sure of (conf under
// minConf: a chord, a pick's attack, noise) are dropped too.
//   createTuner({ lo, hi, minConf, ...tracker options }) -> { lo, hi, push(buf, sr, t (s)) -> { hz, midi, p, cents,
//       stable, conf } | null }   (null: no note)
export function createTuner({ lo = 38, hi = 1400, minConf = 0.5, ...opts } = {}) {
  const tr = createTracker({ minConf, ...opts }), y = {}, qt = Math.pow(2, 1 / 24);
  const m0 = Math.round(ftom(lo)), m1 = Math.round(ftom(hi));
  return {
    lo, hi, tracker: tr,
    push(buf, sr, t) {
      yin(buf, sr, { lo: lo / qt, hi: hi * qt, out: y });
      const m = y.hz > 0 ? Math.round(ftom(y.hz)) : 0, inRange = m >= m0 && m <= m1;
      const s = tr.push({ t, hz: inRange ? y.hz : 0, conf: inRange ? y.conf : 0 });
      return s.p ? { hz: y.hz, midi: s.midi, p: s.p, cents: s.cents, stable: s.stable, conf: y.conf } : null;
    },
  };
}

/* ---------------------------------------------------------------- a small FFT (radix 2, in place) */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
