// Test signals: what Overdub renders through a device (or a chain) when it needs to hear how something behaves.
// Pure JS, deterministic (seeded), Node and browser. Audio comes back as Float32Arrays at `sr` (mono unless noted);
// `stereo(x)` / `toBuffer(c, ...)` wrap them. Levels are stated, and checked in tools/sounds-test.js.
//
//   diStrum(secs = 8, sr)       a guitar DI: Karplus-Strong power chords, open and palm-muted, peaks -10 dBFS
//   bassDI(secs = 8, sr)        a finger-style bass DI, E1..C2 roots with octave pops, peaks -10 dBFS
//   drumLoop(secs = 8, sr, bpm) a synthesized kick / snare / hat loop, peaks -6 dBFS (stereo: hats a little wide)
//   sweep(secs = 4, sr, { f0, f1, db })   a log sine sweep (faded ends), default 20 Hz..20 kHz at -12 dBFS
//   pinkNoise(secs = 4, sr, { db })       seeded pink noise, default -18 dBFS RMS
//   impulse(secs = 2, sr, { at, amp })    one sample at `amp` (default 1) `at` seconds in
//   program(secs = 8, sr)       the effect test program: drums + guitar + bass, stereo, about -18 LUFS
//   PHRASE / phrase()           the instrument test phrase as notes (chords, a melody, a fast run), 8 bars at 120
//   DRUM_PHRASE / drumPhrase()  every kit piece Overdub maps (GM), as a two-bar groove plus a fill
//
// The DI strum and bass are ports of clawd-o-matic's tools/plug-meter.js (the same numbers), so a pedal measured there
// and here sees the same guitar.

export const SR = 48000;
const lcg = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const normPeak = (x, db) => { let t = 0; for (const v of x) t = Math.max(t, Math.abs(v)); if (t > 0) { const g = Math.pow(10, db / 20) / t; for (let i = 0; i < x.length; i++) x[i] *= g; } return x; };

export function stereo(x, y = x) { return { sr: SR, channels: [x, y === x ? Float32Array.from(x) : y] }; }
// An AudioBuffer on context `c` (or any { createBuffer }) from mono / stereo arrays.
export function toBuffer(c, chans, sr = c.sampleRate) {
  const list = Array.isArray(chans) ? chans : [chans];
  const b = c.createBuffer(Math.max(2, list.length), list[0].length, sr);
  for (let i = 0; i < b.numberOfChannels; i++) b.copyToChannel(Float32Array.from(list[Math.min(i, list.length - 1)]), i);
  return b;
}

// The DI: strums of E5, G5, A5, C5 (two bars each at 170 bpm, eighths); palm-muted eighths damp fast, open hits ring.
export function diStrum(secs = 8, sr = SR) {
  const di = new Float32Array(Math.round(sr * secs));
  const rnd = lcg(7);
  const pluck = (hz, at, len, damp, v) => {
    const N = Math.round(sr / hz), buf = new Float32Array(N);
    for (let i = 0; i < N; i++) buf[i] = rnd() * v;
    let p = 0;
    for (let i = Math.round(at * sr), end = Math.min(di.length, i + Math.round(len * sr)); i < end; i++) {
      const nx = (p + 1) % N, y = buf[p]; buf[p] = damp * 0.5 * (buf[p] + buf[nx]); p = nx; di[i] += y;
    }
  };
  const e8 = 60 / 170 / 2, roots = [82.41, 98.0, 110.0, 130.81];
  const hits = Math.floor(secs / e8);
  for (let k = 0; k < hits; k++) {
    const r = roots[Math.floor(k / 16) % 4], open = k % 8 === 0 || k % 8 === 6, t = k * e8 + (k % 2 ? 0.004 : 0);
    for (const [m, j] of [[1, 0], [1.5, 0.006], [2, 0.012]]) pluck(r * m, t + j, open ? e8 * 2 : e8, open ? 0.999 : 0.985, open ? 0.12 : 0.09);
  }
  return normPeak(di, -10);
}

// A bass string's first period as a finger leaves it (a triangle plucked a tenth of the way along, rounded off, no DC).
function bassPluck(buf, rnd, v) {
  const N = buf.length, at = Math.round(N * 0.1);
  let a = 0, b = 0, m = 0;
  for (let i = 0; i < N; i++) { const tri = i < at ? i / at : (N - i) / (N - at); a += (tri + 0.2 * rnd() - a) * 0.6; b += (a - b) * 0.6; buf[i] = b; m += b; }
  for (let i = 0; i < N; i++) buf[i] = (buf[i] - m / N) * v;
}
export function bassDI(secs = 8, sr = SR) {
  const di = new Float32Array(Math.round(sr * secs));
  const rnd = lcg(11);
  const pluck = (hz, at, len, damp, v) => {
    const N = Math.round(sr / hz), buf = new Float32Array(N);
    bassPluck(buf, rnd, v);
    let p = 0;
    const i0 = Math.round(at * sr), n = Math.round(len * sr), rel = Math.round(0.012 * sr);
    for (let k = 0; k < n + rel && i0 + k < di.length; k++) {
      const nx = (p + 1) % N, y = buf[p]; buf[p] = damp * 0.5 * (buf[p] + buf[nx]); p = nx;
      di[i0 + k] += y * (k < n ? 1 : 1 - (k - n) / rel);
    }
  };
  const e8 = 60 / 120 / 2, roots = [41.2, 49.0, 55.0, 65.41];
  for (let bar = 0; bar < Math.floor(secs / 2); bar++) {
    const r = roots[bar % 4];
    [1, 1, 1, 2, 1, 1, 2, bar % 4 === 0 ? 4 : 1].forEach((m, k) => {
      const ring = m > 1 || k === 7, v = k % 2 ? 0.8 : 1;
      pluck(r * m, bar * 2 + k * e8 + (k % 2 ? 0.006 : 0), ring ? e8 * 0.95 : e8 * 0.7, ring ? 0.999 : 0.992, v);
    });
  }
  return normPeak(di, -10);
}

// A small drum machine for test material (not the kit; that is core.drums). Stereo: the hats sit a little right.
export function drumLoop(secs = 8, sr = SR, bpm = 120) {
  const n = Math.round(sr * secs), L = new Float32Array(n), R = new Float32Array(n), rnd = lcg(23);
  const s16 = 60 / bpm / 4;
  const kick = (at, v) => {
    let ph = 0; const i0 = Math.round(at * sr);
    for (let i = 0; i < sr * 0.45 && i0 + i < n; i++) {
      const t = i / sr, f = 48 + 110 * Math.exp(-t * 28); ph += 2 * Math.PI * f / sr;
      const y = v * (Math.sin(ph) * Math.exp(-t * 7) + 0.3 * rnd() * Math.exp(-t * 400));
      L[i0 + i] += y; R[i0 + i] += y;
    }
  };
  const snare = (at, v) => {
    let ph = 0, lp = 0, hp = 0; const i0 = Math.round(at * sr);
    for (let i = 0; i < sr * 0.3 && i0 + i < n; i++) {
      const t = i / sr; ph += 2 * Math.PI * 185 / sr;
      const w = rnd(); lp += (w - lp) * 0.5; hp = w - lp;
      const y = v * (0.5 * Math.sin(ph) * Math.exp(-t * 30) + 0.7 * hp * Math.exp(-t * 14));
      L[i0 + i] += y; R[i0 + i] += y;
    }
  };
  const hat = (at, v, open) => {
    let a = 0, b = 0; const i0 = Math.round(at * sr), len = open ? 0.35 : 0.06;
    for (let i = 0; i < sr * len && i0 + i < n; i++) {
      const t = i / sr, w = rnd(); a += (w - a) * 0.7; const h = w - a; b += (h - b) * 0.9;
      const y = v * 0.35 * b * Math.exp(-t * (open ? 9 : 70));
      L[i0 + i] += y * 0.8; R[i0 + i] += y * 1.2;
    }
  };
  const bars = Math.ceil(secs / (s16 * 16));
  for (let bar = 0; bar < bars; bar++) for (let s = 0; s < 16; s++) {
    const t = (bar * 16 + s) * s16 + (s % 2 ? s16 * 0.08 : 0);       // a touch of swing
    if (s === 0 || s === 6 || s === 8 || (bar % 2 && s === 14)) kick(t, s === 0 ? 1 : 0.85);
    if (s === 4 || s === 12) snare(t, 1);
    if (s === 15 && bar % 2) snare(t, 0.35);                           // a ghost
    if (s === 14 && !(bar % 2)) hat(t, 0.7, true); else hat(t, s % 4 === 0 ? 0.9 : s % 2 ? 0.45 : 0.65, false);
  }
  let t = 0; for (let i = 0; i < n; i++) t = Math.max(t, Math.abs(L[i]), Math.abs(R[i]));
  const g = Math.pow(10, -6 / 20) / (t || 1);
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  return { sr, channels: [L, R] };
}

export function sweep(secs = 4, sr = SR, { f0 = 20, f1 = 20000, db = -12 } = {}) {
  const n = Math.round(sr * secs), x = new Float32Array(n), a = Math.pow(10, db / 20), K = Math.log(f1 / f0), fade = Math.round(sr * 0.02);
  for (let i = 0; i < n; i++) {
    const t = i / sr, ph = 2 * Math.PI * f0 * secs / K * (Math.exp(t / secs * K) - 1);
    x[i] = a * Math.sin(ph) * Math.min(1, i / fade, (n - 1 - i) / fade);
  }
  return x;
}

// Paul Kellet's refined pink filter on seeded white noise, scaled to `db` RMS.
export function pinkNoise(secs = 4, sr = SR, { db = -18, seed = 3 } = {}) {
  const n = Math.round(sr * secs), x = new Float32Array(n), rnd = lcg(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    const y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    x[i] = y; sq += y * y;
  }
  const g = Math.pow(10, db / 20) / Math.sqrt(sq / n), fade = Math.round(sr * 0.01);
  for (let i = 0; i < n; i++) x[i] *= g * Math.min(1, i / fade, (n - 1 - i) / fade);
  return x;
}

export function impulse(secs = 2, sr = SR, { at = 0, amp = 1 } = {}) {
  const x = new Float32Array(Math.round(sr * secs)); x[Math.min(x.length - 1, Math.round(at * sr))] = amp; return x;
}

// The effect program: drums, guitar and bass together in stereo (guitar a little left, bass centre), about -18 LUFS.
export function program(secs = 8, sr = SR) {
  const d = drumLoop(secs, sr), g = diStrum(secs, sr), b = bassDI(secs, sr), n = d.channels[0].length;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = 0.73 * d.channels[0][i] + 0.8 * g[i] + 0.73 * b[i];
    R[i] = 0.73 * d.channels[1][i] + 0.47 * g[i] + 0.73 * b[i];
  }
  return { sr, channels: [L, R] };
}

// ------------------------------------------------------------------------------------------------ note phrases
// Notes are { p, t, d, v } in beats (the project's Note shape, without ids). The instrument phrase is 8 bars at 120
// (16 s): sustained chords (i - VI - III - VII in A minor), a melody over them, a fast 16th run, then a low-to-high
// sweep of single notes and a final held chord, so an instrument's level, range and release all get heard.
export const PHRASE_BPM = 120;
export function phrase() {
  const N = [];
  const add = (p, t, d, v = 0.8) => N.push({ p, t, d, v });
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  chords.forEach((c, k) => c.forEach((p, j) => add(p, k * 4, 3.75, 0.62 + j * 0.04)));
  const mel = [[76, 0, 1], [74, 1, 0.5], [72, 1.5, 0.5], [71, 2, 2], [72, 4, 1.5], [74, 5.5, 0.5], [76, 6, 2],
    [79, 8, 1], [77, 9, 1], [76, 10, 1.5], [72, 11.5, 0.5], [74, 12, 3.5]];
  for (const [p, t, d] of mel) add(p, t, d, 0.85);
  // a fast 16th run up and down A minor (bar 5)
  const run = [69, 71, 72, 74, 76, 77, 79, 81, 83, 81, 79, 77, 76, 74, 72, 71];
  run.forEach((p, k) => add(p, 16 + k * 0.25, 0.22, k % 4 === 0 ? 0.9 : 0.7));
  // low to high single notes (bar 6): range and the low end
  [33, 40, 45, 52, 57, 64, 69, 76].forEach((p, k) => add(p, 20 + k * 0.5, 0.45, 0.8));
  // dynamics: the same note soft to hard (bar 7)
  [0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1, 1].forEach((v, k) => add(64, 24 + k * 0.5, 0.4, v));
  // a held final chord with a bass note, released at beat 31 (the release tail is part of the take)
  [45, 57, 60, 64, 69].forEach((p) => add(p, 28, 3, 0.75));
  return N;
}
export const PHRASE_BEATS = 32;

// Bass phrase: the same progression's roots, two octaves down, with eighth-note movement, slides and octave pops.
export function bassPhrase() {
  const N = [], add = (p, t, d, v = 0.85) => N.push({ p, t, d, v });
  const roots = [33, 29, 36, 31];
  for (let bar = 0; bar < 8; bar++) {
    const r = roots[bar % 4];
    const pat = bar % 2 ? [[0, 0, 0.45], [0.5, 0, 0.45], [1, 12, 0.4], [1.5, 0, 0.45], [2, 0, 0.9], [3, 7, 0.45], [3.5, 10, 0.45]]
      : [[0, 0, 1.4], [1.5, 0, 0.45], [2, 0, 0.45], [2.5, 12, 0.4], [3, 0, 0.95]];
    for (const [t, iv, d] of pat) add(r + iv, bar * 4 + t, d, t === 0 ? 0.95 : 0.78);
  }
  // legato: overlapping notes (a slide when glide is on)
  add(33, 31, 0.6); add(36, 31.5, 0.5);
  return N.sort((a, b) => a.t - b.t);
}

// The kit, every piece (GM): a groove with ghost notes, open hats choked by closed / pedal ones, a tom fill, cymbals.
export function drumPhrase() {
  const N = [], add = (p, t, v = 0.8, d = 0.1) => N.push({ p, t, d, v });
  for (let bar = 0; bar < 4; bar++) {
    const b = bar * 4;
    add(36, b, 1); add(36, b + 1.5, 0.8); add(36, b + 2.75, 0.7);
    add(38, b + 1, 0.95); add(38, b + 3, 1); add(38, b + 2.25, 0.3);
    for (let s = 0; s < 8; s++) {
      const t = b + s * 0.5;
      if (bar === 1) add(51, t, s % 2 ? 0.55 : 0.8);                    // a ride bar
      else if (s === 7) add(46, t, 0.7);                                 // open hat on the last eighth, choked by the downbeat
      else add(42, t, s % 2 ? 0.5 : 0.8);
    }
    if (bar === 2) { add(39, b + 1, 0.8); add(39, b + 3, 0.85); add(70, b + 0.25, 0.5); add(70, b + 0.75, 0.5); add(70, b + 1.25, 0.5); add(70, b + 1.75, 0.5); add(37, b + 2.5, 0.7); add(56, b + 3.5, 0.7); add(44, b + 2, 0.6); }
  }
  // the fill (bar 5): toms high to low, then a crash and kick on the next downbeat
  [[50, 16], [50, 16.25], [47, 16.5], [47, 16.75], [45, 17], [45, 17.25], [45, 17.5], [38, 17.75]].forEach(([p, t], k) => add(p, t, 0.75 + k * 0.03));
  add(36, 18, 1); add(49, 18, 0.9); add(44, 19, 0.6);
  add(36, 20, 1); add(49, 20, 0.6); add(51, 20.5, 0.6); add(53, 21, 0.7);
  return N.sort((a, b) => a.t - b.t);
}
export const DRUM_PHRASE_BEATS = 24;
