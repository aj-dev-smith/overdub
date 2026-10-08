// The ears for bass music's parts (tools/bassmusic-test.js and tools/clubkit-test.js use them): what measure() doesn't
// read, measured the same way every time. Pure JS on Float32Arrays, Node.
//
//   renderInst(device, params, notes, { bpm, beats, tail, sr }) -> { sr, channels, r }   one instrument track, alone
//   centroidTrack(x, sr, { hop, win, lo, hi }) -> { t: Float64Array (s), c: Float64Array (Hz) }   the spectral centroid
//   talk(x, sr, { bpm, beats, from, to }) -> { octaves, minima: [s], offGridMs: [ms] }   a growl's movement: how far
//        its centroid moves (octaves, 5th to 95th percentile) and where each of its minima falls against the grid
//   corrAbove(L, R, sr, hz) -> correlation of L and R above hz (a 4th-order high pass)
//   beating(x, sr, { from, to }) -> { hz, depthDb }   the strongest amplitude movement 0.3-20 Hz on a held note
//   subClean(x, sr, { split }) -> dB of the energy above `split` against the energy below it
//   fundamental(x, sr, { from, to, lo, hi }) -> Hz of the strongest peak in [lo, hi]
//   hitStats(x, sr, at, { win }) -> { peakMs, crest100, ... }   one drum hit: where it peaks and its crest over 100 ms
//   decayT60(x, sr, at, { lo, hi }) -> seconds for the band's energy to fall 60 dB (from its peak, by a line fitted
//        through its fall from -5 to -35 dB)
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';

const STAMP = '2026-10-07T00:00:00.000Z';

export function renderInst(device, params, notes, { bpm = 140, beats = 16, tail = 1, sr = 48000, inserts = [] } = {}) {
  const p = {
    ...createProject(),
    id: 'p_bm',
    title: 'bm',
    tempo: bpm,
    key: null,
    meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [
      {
        id: 't_bm',
        name: 'Part',
        kind: 'instrument',
        instrument: { device, params },
        inserts,
        clips: [
          {
            id: 'c_bm',
            kind: 'notes',
            start: 0,
            length: beats,
            notes: notes.map((n, i) => ({ id: 'n' + (i + 1), by: 'overdub', v: 0.9, ...n })),
            by: 'overdub',
          },
        ],
        gain: 0,
        pan: 0,
        mute: false,
        solo: false,
        arm: false,
        by: 'overdub',
      },
    ],
  };
  const r = renderSong(p, { from: 0, to: beats, tail, sr });
  return { sr: r.sr, channels: r.channels, r };
}

/* ---------------------------------------------------------------- an FFT (radix 2, in place) */
const tw = new Map();
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  let T = tw.get(n);
  if (!T) {
    T = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
    for (let k = 0; k < n / 2; k++) {
      T.c[k] = Math.cos((-2 * Math.PI * k) / n);
      T.s[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    tw.set(n, T);
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = T.c[k * step],
          wi = T.s[k * step],
          a = i + k,
          b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi,
          xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
  }
}
// the power spectrum of x[at .. at + N) under a Hann window
export function power(x, at, N, out = new Float64Array(N / 2 + 1)) {
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const v = x[at + i] || 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  }
  fft(re, im);
  for (let k = 0; k <= N / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}
export const mono = (ch) => {
  const n = ch[0].length,
    m = new Float32Array(n);
  for (const x of ch) for (let i = 0; i < n; i++) m[i] += x[i] / ch.length;
  return m;
};

export function centroidTrack(x, sr, { hop = 48, win = 1024, lo = 40, hi = 12000, from = 0, to = x.length / sr } = {}) {
  const a = Math.round(from * sr),
    b = Math.min(x.length - win, Math.round(to * sr));
  const t = [],
    c = [],
    P = new Float64Array(win / 2 + 1),
    hz = sr / win;
  for (let at = a; at < b; at += hop) {
    power(x, at, win, P);
    let num = 0,
      den = 0;
    for (let k = 1; k <= win / 2; k++) {
      const f = k * hz;
      if (f < lo || f > hi) continue;
      const m = Math.sqrt(P[k]);
      num += f * m;
      den += m;
    }
    t.push((at + win / 2) / sr);
    c.push(den > 1e-9 ? num / den : NaN);
  }
  return { t: Float64Array.from(t), c: Float64Array.from(c) };
}
const pct = (arr, q) => {
  const s = [...arr].filter(Number.isFinite).sort((p, r) => p - r);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : NaN;
};

// A growl's talk: its centroid's range in octaves, and its minima (one per `per` beats, the lowest point in each such
// stretch) against the nearest grid line of `per` beats.
// phase: where in its cycle the LFO puts the minimum (SAW UP 0, SINE and TRI 0.75): the grid line shifted by that much
export function talk(x, sr, { bpm = 140, per = 0.5, phase = 0, from = 0.5, to = null, hop = 24, win = 1024 } = {}) {
  const end = to == null ? x.length / sr - 0.5 : to;
  const { t, c } = centroidTrack(x, sr, { hop, win, from, to: end });
  const oct = Math.log2(pct(c, 0.95) / pct(c, 0.05));
  const spb = 60 / bpm,
    cyc = per * spb,
    sh = phase * cyc,
    minima = [],
    off = [];
  // (each cycle's trough: the middle of the times its centroid is within a tenth of its range of its lowest, so a
  // trough that ripples with the note's own period is read where it is, not at whichever ripple dips lowest)
  for (let s = Math.ceil(from / cyc) * cyc + sh; s + cyc <= end; s += cyc) {
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < t.length; i++)
      if (t[i] >= s - cyc / 2 && t[i] < s + cyc / 2 && Number.isFinite(c[i])) {
        if (c[i] < lo) lo = c[i];
        if (c[i] > hi) hi = c[i];
      }
    if (!(hi > lo)) continue;
    const cut = lo + 0.1 * (hi - lo);
    let st = 0,
      sn = 0;
    for (let i = 0; i < t.length; i++)
      if (t[i] >= s - cyc / 2 && t[i] < s + cyc / 2 && c[i] <= cut) {
        st += t[i];
        sn++;
      }
    const at = st / sn;
    minima.push(at);
    off.push((at - sh - Math.round((at - sh) / cyc) * cyc) * 1000);
  }
  return { octaves: oct, minima, offGridMs: off };
}

function biq(x, c) {
  const y = new Float64Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
function bw(sr, hz, high) {
  const K = Math.tan((Math.PI * hz) / sr),
    q = Math.SQRT1_2,
    a0 = 1 + K / q + K * K;
  return high
    ? { b0: 1 / a0, b1: -2 / a0, b2: 1 / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / q + K * K) / a0 }
    : {
        b0: (K * K) / a0,
        b1: (2 * K * K) / a0,
        b2: (K * K) / a0,
        a1: (2 * (K * K - 1)) / a0,
        a2: (1 - K / q + K * K) / a0,
      };
}
export const highpass = (x, sr, hz) => {
  const c = bw(sr, hz, true);
  return biq(biq(x, c), c);
};
export const lowpass = (x, sr, hz) => {
  const c = bw(sr, hz, false);
  return biq(biq(x, c), c);
};

export function corrAbove(L, R, sr, hz = 200, { from = 0, to = null } = {}) {
  const a = highpass(L, sr, hz),
    b = highpass(R, sr, hz),
    i0 = Math.round(from * sr),
    i1 = to == null ? a.length : Math.round(to * sr);
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = i0; i < i1; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 1;
}

// the amplitude envelope (RMS over 20 ms, every 5 ms) of x in [from, to), its strongest movement 0.3-20 Hz
export function beating(x, sr, { from = 0.5, to = null } = {}) {
  const a = Math.round(from * sr),
    b = to == null ? x.length : Math.round(to * sr),
    hop = Math.round(sr * 0.005),
    w = Math.round(sr * 0.02);
  const env = [];
  for (let at = a; at + w < b; at += hop) {
    let s = 0;
    for (let i = at; i < at + w; i++) s += x[i] * x[i];
    env.push(Math.sqrt(s / w));
  }
  const fs = sr / hop,
    mean = env.reduce((p, v) => p + v, 0) / env.length;
  let N = 1;
  while (N < env.length * 4) N <<= 1;
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let i = 0; i < env.length; i++)
    re[i] = (env[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (env.length - 1)));
  fft(re, im);
  let bk = -1,
    bm = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * fs) / N;
    if (f < 0.3 || f > 20) continue;
    const m = re[k] * re[k] + im[k] * im[k];
    if (m > bm) {
      bm = m;
      bk = k;
    }
  }
  const lo = pct(env, 0.05),
    hi = pct(env, 0.95);
  return { hz: bk > 0 ? (bk * fs) / N : 0, depthDb: 20 * Math.log10(hi / Math.max(lo, 1e-9)) };
}

export function subClean(x, sr, { split = 120, from = 0, to = null } = {}) {
  const i0 = Math.round(from * sr),
    i1 = to == null ? x.length : Math.round(to * sr);
  const lo = lowpass(x, sr, split),
    hi = highpass(x, sr, split);
  let el = 0,
    eh = 0;
  for (let i = i0; i < i1; i++) {
    el += lo[i] * lo[i];
    eh += hi[i] * hi[i];
  }
  return 10 * Math.log10(eh / Math.max(el, 1e-30));
}

export function fundamental(x, sr, { from = 0.2, to = null, lo = 20, hi = 200 } = {}) {
  const N = 1 << 16,
    at = Math.round(from * sr),
    P = power(x, at, Math.min(N, 1 << Math.floor(Math.log2(((to == null ? x.length / sr : to) - from) * sr))));
  const n = (P.length - 1) * 2,
    hz = sr / n;
  let bk = 1;
  for (let k = 1; k < P.length; k++) {
    const f = k * hz;
    if (f >= lo && f <= hi && P[k] > P[bk]) bk = k;
  }
  // (a parabola through the peak's bins for the fraction)
  const a = P[bk - 1] || 0,
    b = P[bk],
    c = P[bk + 1] || 0,
    d = (a - c) / (2 * (a - 2 * b + c) || 1);
  return (bk + d) * hz;
}

// One hit at `at` (s): where its loudest sample is (ms after `at`) and its crest over the first 100 ms (peak against
// RMS, dB)
export function hitStats(x, sr, at, { win = 0.1 } = {}) {
  const a = Math.round(at * sr),
    b = a + Math.round(win * sr);
  let pk = 0,
    pi = a,
    sq = 0;
  for (let i = a; i < b; i++) {
    const v = Math.abs(x[i]);
    if (v > pk) {
      pk = v;
      pi = i;
    }
    sq += x[i] * x[i];
  }
  const rms = Math.sqrt(sq / (b - a));
  return {
    peakMs: ((pi - a) / sr) * 1000,
    peakDb: 20 * Math.log10(pk + 1e-12),
    crest100: 20 * Math.log10(pk / Math.max(rms, 1e-12)),
  };
}
// the T60 of x's energy in [lo, hi] Hz after `at`: a line through its fall from 5 to 35 dB under its peak, extended
export function decayT60(x, sr, at, { lo = 2500, hi = 20000, span = 1.5 } = {}) {
  const a = Math.round(at * sr),
    n = Math.round(span * sr),
    seg = x.subarray(a, a + n);
  const y = lo > 30 ? highpass(seg, sr, lo) : Float64Array.from(seg),
    z = hi < sr / 2 ? lowpass(y, sr, hi) : y;
  const hop = Math.round(sr * 0.002),
    w = Math.round(sr * 0.005),
    env = [];
  for (let i = 0; i + w < z.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + w; j++) s += z[j] * z[j];
    env.push(10 * Math.log10(s / w + 1e-30));
  }
  let pk = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > env[pk]) pk = i;
  let i5 = -1,
    i35 = -1;
  for (let i = pk; i < env.length; i++) {
    if (i5 < 0 && env[i] <= env[pk] - 5) i5 = i;
    if (i35 < 0 && env[i] <= env[pk] - 35) {
      i35 = i;
      break;
    }
  }
  if (i5 < 0) return Infinity;
  if (i35 < 0) i35 = env.length - 1;
  // a line fitted through the fall (least squares, from the peak when the fall is a step or two)
  const from = i35 - i5 >= 2 ? i5 : pk;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    k = 0;
  for (let i = from; i <= i35; i++) {
    const t = (i * hop) / sr;
    sx += t;
    sy += env[i];
    sxx += t * t;
    sxy += t * env[i];
    k++;
  }
  const slope = k > 1 ? (k * sxy - sx * sy) / (k * sxx - sx * sx) : NaN; // dB per second (negative)
  return slope < 0 ? -60 / slope : Infinity;
}
// energy (dB) of x in [lo, hi] Hz over [from, to) against its loudest band of `bands`
export function bandDb(x, sr, lo, hi, { from = 0, to = null } = {}) {
  const i0 = Math.round(from * sr),
    i1 = to == null ? x.length : Math.round(to * sr);
  let y = lo > 0 ? highpass(x.subarray(i0, i1), sr, lo) : Float64Array.from(x.subarray(i0, i1));
  if (hi < sr / 2) y = lowpass(y, sr, hi);
  let e = 0;
  for (const v of y) e += v * v;
  return 10 * Math.log10(e / y.length + 1e-30);
}

// each band's share of x's energy (%), from its whole spectrum averaged (Hann, N points, half overlapped): edges
// [[lo, hi], ...] in Hz (tools/wavetable-test.js's measure, for the same answers)
export function shares(x, sr, edges, N = 1 << 15) {
  const P = new Float64Array(N / 2);
  for (let at = 0; at + N <= x.length; at += N / 2) {
    const re = new Float64Array(N),
      im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  const bin = sr / N;
  let tot = 0;
  for (let k = 1; k < N / 2; k++) tot += P[k];
  return edges.map(([a, b]) => {
    let s = 0;
    for (let k = Math.max(1, Math.ceil(a / bin)); k < Math.min(N / 2, b / bin); k++) s += P[k];
    return (100 * s) / (tot || 1);
  });
}
