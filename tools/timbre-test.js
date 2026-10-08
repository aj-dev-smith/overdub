// Every built-in instrument held to its family's numbers (docs/research/INSTRUMENTS.md, §2 and §4). Nobody building
// this can listen, so each instrument family has a signature: what a piano, an organ or a bowed section does that we
// can measure in a render. This renders single notes through the canonical renderer (app/src/engine/node/render.js)
// and checks, family by family:
//
//   balance     loudness across the playable range at equal velocity (K-weighted, a 400 ms window), max - min
//   velocity    the level swing from velocity 0.3 to 1.0 (inside the family's band), and the colour: the onset's
//               spectral centroid (the first 85 ms) at 1.0 over 0.3 (harder is brighter for struck and plucked
//               things; a pad swells, it doesn't bark)
//   decay       T60 by register (the slope from -6 to -36 dB under the peak while the key is held) and the spectrum
//               falling over the note (struck, plucked)
//   inharm.     B fitted from the tracked partials (piano), against measured grands
//   tuning      the fundamental against equal temperament (the stretch curve for the piano)
//   release     time to -40 dB after the key comes up
//   modulation  a tremolo's or a rotor's rate from the envelope spectrum, a section's vibrato from its pitch track
//   aliasing    a held C7 (and C8 for synths) at full brightness: the loudest thing between the partials, under the
//               fundamental
//   steadiness  a held bowed note's level, 250 ms windows (a section doesn't swell and sag on its own)
//   CPU         16 held voices, as a share of one core in real time, timed next to a reference (Lamp Tines' GRAND,
//               3.3% on an idle Apple Silicon core, tools/instruments-test.js) so a busy machine doesn't fail it.
//               Budgets: a piano 10%, everything else 6% (the roadmap's §3).
//
// Targets come from published measurements where there are any (the roadmap's §2 cites them) and are marked as
// working estimates where there aren't. Instruments that predate the targets keep their sound (their golden hashes pin
// it, and ids are forever): a gap the roadmap already names is printed as a known gap (`..`) instead of failing, and a
// better sound ships as a new id. Batch 1 (Baby Grand, Rotor Cabinet, Music Stands, Flatwound) has no known gaps. An
// instrument added to builtin/index.js later is held to its family by id (the roadmap's names) or by its shelf `cat`.
//   node tools/timbre-test.js [id ...]       only those instruments; CPU=0 skips the timing
import { tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';
import { lufs } from '../app/src/audio/measure.js';
import { INSTRUMENTS } from '../app/src/devices/builtin/index.js';
import { drumPhrase, DRUM_PHRASE_BEATS } from '../app/src/audio/testsignals.js';

const t = tally('timbre');
const SR = 48000,
  BPM = 120,
  BEAT = 60 / BPM;
const STAMP = '2026-09-30T00:00:00.000Z';
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const span = (a) => Math.max(...a) - Math.min(...a);

// ------------------------------------------------------------------------------------------------ rendering
function project(id, notes, params, beats) {
  return {
    ...createProject(),
    id: 'p_timbre',
    title: id,
    key: null,
    tempo: BPM,
    meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [
      {
        id: 't_timbre',
        name: 'Inst',
        kind: 'instrument',
        instrument: { device: id, params },
        inserts: [],
        clips: [
          {
            id: 'c_timbre',
            kind: 'notes',
            start: 0,
            length: beats,
            notes: notes.map((n, i) => ({ id: 'n' + (i + 1), by: 'overdub', ...n })),
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
}
// notes in seconds -> { L, R, m (mono), sr }; cached, since several checks hear the same note
const cache = new Map();
function play(id, params, notes, secs, tail = 0.5) {
  const key = JSON.stringify([id, params, notes, secs, tail]);
  if (cache.has(key)) return cache.get(key);
  const beats = Math.ceil(secs / BEAT);
  const r = renderSong(
    project(
      id,
      notes.map((n) => ({ p: n.p, v: n.v ?? 0.6, t: n.t / BEAT, d: n.d / BEAT })),
      params,
      beats,
    ),
    { from: 0, to: beats, tail },
  );
  const [L, R] = r.channels,
    m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (L[i] + R[i]);
  const out = { L, R, m, sr: r.sr };
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}
const note = (id, params, p, v, hold, tail = 0.5) => play(id, params, [{ p, v, t: 0, d: hold }], hold, tail);

// ------------------------------------------------------------------------------------------------ measures
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let x = re[i];
      re[i] = re[j];
      re[j] = x;
      x = im[i];
      im[i] = im[j];
      im[j] = x;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a),
      h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < h; j++) {
        const k = i + j + h,
          vr = re[k] * cr - im[k] * ci,
          vi = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - vr;
        im[k] = im[i + j] - vi;
        re[i + j] += vr;
        im[i + j] += vi;
        const x = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = x;
      }
    }
  }
}
// power spectrum of x[at .. at+N) with a Hann window
function power(x, at, N) {
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[at + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  fft(re, im);
  const P = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
  return P;
}
function centroid(x, at, N = 4096) {
  const P = power(x, at, N);
  let a = 0,
    b = 0;
  for (let k = 1; k < P.length; k++) {
    a += k * P[k];
    b += P[k];
  }
  return b > 1e-30 ? ((a / b) * SR) / N : 0;
}
// the note's onset: the first 1 ms frame within 40 dB of the loudest
function onset(x) {
  const fr = 48;
  let pk = 0;
  const e = [];
  for (let a = 0; a + fr <= x.length; a += fr) {
    let s = 0;
    for (let i = a; i < a + fr; i++) s += x[i] * x[i];
    e.push(s);
    if (s > pk) pk = s;
  }
  for (let i = 0; i < e.length; i++) if (e[i] > pk * 1e-4) return i * fr;
  return 0;
}
// K-weighted loudness of [a, b) seconds after the onset, both channels
function loud(r, a, b) {
  const on = onset(r.m),
    i0 = on + Math.round(a * SR),
    i1 = on + Math.round(b * SR);
  return lufs({ sr: SR, channels: [r.L.subarray(i0, i1), r.R.subarray(i0, i1)] });
}
// RMS envelope, dB, `fr` seconds a frame
function envelope(x, fr = 0.005, from = 0, to = x.length) {
  const n = Math.round(fr * SR),
    out = [];
  for (let a = from; a + n <= to; a += n) {
    let s = 0;
    for (let i = a; i < a + n; i++) s += x[i] * x[i];
    out.push(10 * Math.log10(s / n + 1e-24));
  }
  return out;
}
// T60 from the slope between -6 and -36 dB under the peak, while the key is held (offAt seconds)
function t60(x, offAt) {
  const e = envelope(x, 0.005, 0, Math.round(offAt * SR)),
    pk = Math.max(...e),
    ip = e.indexOf(pk);
  const xs = [],
    ys = [];
  for (let i = ip; i < e.length; i++)
    if (e[i] < pk - 6 && e[i] > pk - 36) {
      xs.push(i * 0.005);
      ys.push(e[i]);
    }
  if (xs.length < 5) return Infinity;
  const n = xs.length,
    mx = xs.reduce((u, v) => u + v) / n,
    my = ys.reduce((u, v) => u + v) / n;
  let sxy = 0,
    sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const sl = sxy / sxx;
  return sl < 0 ? -60 / sl : Infinity;
}
// time from note-off to 40 dB under the level just before it
function release40(x, offAt) {
  const e = envelope(x, 0.005),
    off = Math.round(offAt / 0.005),
    ref = e[off - 2];
  for (let i = off; i < e.length; i++) if (e[i] < ref - 40) return (i - off) * 0.005;
  return Infinity;
}
// Goertzel magnitude of f over x[a .. a+len) (Hann)
function goertzel(x, a, len, f) {
  const w = (2 * Math.PI * f) / SR,
    c = 2 * Math.cos(w);
  let s1 = 0,
    s2 = 0;
  for (let i = 0; i < len; i++) {
    const s = (x[a + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1))) + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) * 4) / len;
}
// the strongest frequency within +-rel of f (a coarse scan, then a fine one)
function peakFreq(x, a, len, f, rel) {
  let best = 0,
    bf = f;
  for (let k = -60; k <= 60; k++) {
    const ff = f * (1 + (rel * k) / 60),
      m = goertzel(x, a, len, ff);
    if (m > best) {
      best = m;
      bf = ff;
    }
  }
  const step = (f * rel) / 60;
  for (let k = -20; k <= 20; k++) {
    const ff = bf + (step * k) / 20,
      m = goertzel(x, a, len, ff);
    if (m > best) {
      best = m;
      bf = ff;
    }
  }
  return { f: bf, mag: best };
}
// inharmonicity: track partials 1..K, each predicted from the B fitted so far, then fit f_k = k f1 sqrt((1 + B k^2) / (1 + B))
function inharmonicity(x, a, len, f0, K) {
  const fs = [];
  let B = 0;
  for (let k = 1; k <= K; k++) {
    const f1 = fs.length ? fs[0][1] : f0,
      pred = k * f1 * Math.sqrt((1 + B * k * k) / (1 + B));
    if (pred > 9000) break;
    fs.push([k, peakFreq(x, a, len, pred, k < 3 ? 0.02 : 0.008).f]);
    if (fs.length >= 2) B = fitB(fs);
  }
  return { B, partials: fs.length, f1: fs[0][1] };
}
function fitB(fs) {
  let best = 0,
    err = Infinity;
  for (let B = 1e-6; B < 0.05; B *= 1.01) {
    let e = 0;
    for (const [k, f] of fs) {
      const pr = k * fs[0][1] * Math.sqrt((1 + B * k * k) / (1 + B));
      e += ((f - pr) / f) ** 2;
    }
    if (e < err) {
      err = e;
      best = B;
    }
  }
  return best;
}
// the strongest rate (Hz) in a series sampled at `fr` Hz, between lo and hi
function rate(series, fr, lo, hi) {
  const mean = series.reduce((u, v) => u + v, 0) / series.length,
    e = series.map((v) => v - mean);
  let best = 0,
    bf = 0;
  for (let f = lo; f <= hi; f += 0.01) {
    let re = 0,
      im = 0;
    for (let i = 0; i < e.length; i++) {
      re += e[i] * Math.cos((2 * Math.PI * f * i) / fr);
      im += e[i] * Math.sin((2 * Math.PI * f * i) / fr);
    }
    const m = re * re + im * im;
    if (m > best) {
      best = m;
      bf = f;
    }
  }
  return bf;
}
// a pitch track (cents against f0) by autocorrelation, 40 ms frames every 10 ms
function pitchTrack(x, from, to, f0) {
  const W = Math.round(0.04 * SR),
    hop = Math.round(0.01 * SR),
    out = [];
  const lag0 = SR / f0,
    lo = Math.floor(lag0 / Math.pow(2, 100 / 1200)),
    hi = Math.ceil(lag0 * Math.pow(2, 100 / 1200));
  for (let a = from; a + W + hi < to; a += hop) {
    let bl = lo,
      bv = -Infinity;
    const c = new Float64Array(hi + 2);
    for (let l = lo - 1; l <= hi + 1; l++) {
      let s = 0;
      for (let i = 0; i < W; i++) s += x[a + i] * x[a + i + l];
      c[l - lo + 1] = s;
      if (l >= lo && l <= hi && s > bv) {
        bv = s;
        bl = l;
      }
    }
    const y0 = c[bl - lo],
      y1 = c[bl - lo + 1],
      y2 = c[bl - lo + 2],
      d = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2 || 1e-12);
    out.push(1200 * Math.log2(lag0 / (bl + d)));
  }
  return out;
}
// aliasing: the loudest bin between the partials (and under the fundamental), in dB under the fundamental's peak.
// Partials are wherever the spectrum peaks near k f1 (+-0.6%, so detuned unisons and stretch count as partials).
function aliasing(x, at, f0, base = 1, tol = 0.006) {
  // five half-overlapping frames averaged (Welch), so a noise floor (a bow's rosin) reads as its mean, and tones stand out
  const N = 16384,
    P = new Float64Array(N / 2),
    bin = SR / N;
  for (let f = 0; f < 5; f++) {
    const Q = power(x, at + (f * N) / 2, N);
    for (let i = 0; i < P.length; i++) P[i] += Q[i] / 5;
  }
  const f1 = peakFreq(x, at, 2 * N, f0, 0.02).f * base;
  const mask = new Uint8Array(P.length);
  const guard = (f, w) => {
    const a = Math.max(0, Math.floor((f - w) / bin)),
      b = Math.min(P.length - 1, Math.ceil((f + w) / bin));
    for (let i = a; i <= b; i++) mask[i] = 1;
  };
  for (let k = 1; k * f1 < SR / 2; k++) guard(k * f1, tol * k * f1 + 6 * bin);
  guard(0, 20);
  let ref = 0;
  for (let i = Math.floor(((f1 / base) * 0.98) / bin); i <= Math.ceil(((f1 / base) * 1.02) / bin); i++)
    ref = Math.max(ref, P[i]);
  let worst = 0,
    wf = 0;
  for (let i = 0; i < P.length; i++)
    if (!mask[i] && P[i] > worst && i * bin < 20000) {
      worst = P[i];
      wf = i * bin;
    }
  return { db: 10 * Math.log10(worst / ref + 1e-30), at: wf };
}

// ------------------------------------------------------------------------------------------------ the families
// Each profile: the params it's heard with, its playable range (balance), the velocity pitches, the loudness window
// (seconds after the onset: struck things at once, bowed and pads once they've arrived), and targets. `known` lists the
// gaps the roadmap names for instruments that predate it (printed, not failed). Targets marked (w) are working
// estimates (the roadmap says so); the rest cite §2.
const FAMILY = {
  piano: {
    win: [0, 0.4],
    hold: 3,
    balance: 6,
    velLevel: [18, 30],
    velColour: 1.4,
    colourAt: [60, 64],
    decay: { 40: [10, 25], 64: [5, 12], 88: [2, 6] }, // E2 / E4 / E6, §2.1
    fall: [40, 64, 88],
    tune: { 28: [-20, -5], 69: [-2, 2] }, // stretch: flat in the bass
    inharm: { 28: [2e-4, 4e-4], 52: [1e-4, 2e-4], 64: [3e-4, 4.5e-4], 88: [1.2e-3, 4e-3] },
    release: { 60: [0.2, 0.6] },
    cpu: 10,
  },
  ep: {
    win: [0, 0.4],
    hold: 3,
    balance: 8,
    velLevel: [10, 24],
    velColour: 1.6,
    colourAt: [60],
    epBark: true,
    fall: [48, 72],
    tune: { 60: [-2, 2] },
    cpu: 6,
  },
  organ: {
    win: [0.3, 0.7],
    hold: 1.5,
    balance: 6,
    velLevel: [0, 6],
    velColourRange: [0.97, 1.3],
    colourAt: [60],
    tune: { 48: [-2, 2], 72: [-2, 2] },
    steady: true,
    release: { 60: [0.005, 0.6] },
    cpu: 6,
  },
  strings: {
    win: [0.8, 1.2],
    hold: 2,
    balance: 6,
    velLevel: [4, 14],
    velColour: 1.3,
    colourAt: [64],
    tune: { 57: [-4, 4], 76: [-4, 4] },
    tuneByTrack: true,
    attack: true,
    vibrato: [4.5, 6.5],
    swing: 3,
    corr: [0.3, 0.7],
    release: { 64: [0.2, 2] },
    cpu: 6,
  },
  bassgtr: {
    win: [0, 0.4],
    hold: 2.5,
    balance: 6,
    velLevel: [6, 20],
    velColour: 1.25,
    colourAt: [28, 40],
    decayFalls: [28, 40, 52],
    decay: { 28: [3, 16] },
    fall: [28, 40],
    tune: { 33: [-2, 2], 45: [-2, 2] },
    release: { 40: [0.02, 0.4] },
    cpu: 6,
  },
  plucked: {
    win: [0, 0.4],
    hold: 2.5,
    balance: 6,
    velLevel: [6, 20],
    velColour: 1.25,
    colourAt: [52, 64],
    decayFalls: [40, 52, 64, 76],
    fall: [52, 76],
    tune: { 52: [-2, 2], 64: [-2, 2] },
    upper: 76,
    cpu: 6,
  },
  synth: {
    win: [0.05, 0.45],
    hold: 1.5,
    balance: 6,
    velLevel: [4, 16],
    velColour: 1.3,
    colourAt: [48, 60],
    tune: { 48: [-2, 2], 60: [-2, 2] },
    alias: [96, 108],
    cpu: 6,
  },
  synthbass: {
    win: [0.02, 0.42],
    hold: 1,
    balance: 6,
    velLevel: [4, 16],
    velColour: 1.15,
    colourAt: [36],
    tune: { 36: [-2, 2] },
    alias: [72],
    cpu: 6,
  },
  pad: {
    win: [1.2, 1.6],
    hold: 2.5,
    balance: 6,
    velLevel: [4, 10],
    velColourRange: [0.9, 1.15],
    colourAt: [60],
    tune: { 60: [-2, 2] },
    cpu: 6,
  },
  mallet: {
    win: [0, 0.4],
    hold: 2.5,
    balance: 8,
    velLevel: [8, 24],
    velColour: 1.5,
    colourAt: [60, 72],
    fall: [60, 72],
    tune: { 60: [-2, 2] },
    cpu: 6,
  },
  brass: {
    win: [0.1, 0.5],
    hold: 1.5,
    balance: 6,
    velLevel: [6, 18],
    velColour: 1.8,
    colourAt: [60],
    tune: { 60: [-3, 3] },
    cpu: 6,
  },
};
// per instrument: family, params, range and anything the family default doesn't fit
const PROFILES = {
  'core.piano': { family: 'piano', params: { room: 0 }, range: [28, 40, 52, 64, 76, 88], alias: null },
  // the organ's aliasing is heard on FLUTE (8' and 4', an exact octave) at full drive: the tempered mutations of a
  // fuller registration intermodulate in the preamp, off any harmonic grid, as they do on the real thing
  'core.organ': {
    family: 'organ',
    params: { cab: 0, drive: 0, click: 0 },
    range: [36, 48, 60, 72, 84],
    rotor: true,
    alias: [96, 108],
    aliasParams: { reg: 0, cab: 0, drive: 1, tone: 1, click: 0 },
  },
  // a section's partials are four players wide (and its leveller's gain moves at their beat rate): a 1.5% grid
  'core.strings': {
    family: 'strings',
    params: { hall: 0 },
    range: [40, 52, 64, 76, 88],
    alias: [96],
    aliasParams: { bright: 1, vibrato: 0, ensemble: 0, hall: 0, attack: 0.05 },
    aliasTol: 0.015,
  },
  'core.bassguitar': { family: 'bassgtr', params: {}, range: [28, 35, 42, 49, 56], styles: true },
  'core.keys#tines': {
    id: 'core.keys',
    family: 'ep',
    params: { voice: 0, trem: 0 },
    range: [36, 48, 60, 72, 84],
    trem: { params: { voice: 0, trem: 0.6, rate: 4.5 }, hz: 4.5 },
    known: {
      velColour:
        'Lamp Tines TINES gets brighter only at full velocity: FM brightness, not the pickup bark (roadmap §1; core.ep is batch 2)',
      epBark: 'the tine bark comes from the pickup, not FM (roadmap §1, §2.2)',
      velLevel: 'Lamp Tines changes level within a narrow band (roadmap §1)',
      balance: 'Lamp Tines is not register-normalised (roadmap §1)',
    },
  },
  'core.keys#grand': {
    id: 'core.keys',
    family: 'piano',
    params: { voice: 1 },
    range: [28, 40, 52, 64, 76, 88],
    alias: null,
    known: {
      velLevel:
        'GRAND swings 8 dB with velocity, a grand 18-30 (roadmap §1: superseded by Baby Grand, kept for Lido and the golden scenes)',
      inharm: 'GRAND is ten times too harmonic at the top (roadmap §1)',
      decay: 'GRAND rings too long in the treble (roadmap §1)',
      fall: "GRAND's treble partials hold their level, like a celesta (roadmap §1)",
      tune: 'GRAND is barely stretch-tuned (roadmap §2.1)',
      balance: 'GRAND is not register-normalised',
      velColour: 'GRAND changes colour little with velocity (roadmap §1)',
      release: 'GRAND is a Lamp Tines voice, released by its RELEASE',
      cpu: null,
    },
  },
  'core.pluck': {
    family: 'plucked',
    params: {},
    range: [40, 52, 64, 76],
    known: {
      upper:
        "Pinch Roller's one-zero loss filter dulls the high strings (roadmap §1: the per-pitch loss filter is batch 2)",
      velColour: 'Pinch Roller barely changes colour with velocity at E5 (roadmap §1)',
      balance: 'Pinch Roller is not register-normalised',
      decayFalls: "Pinch Roller's high strings die fast (roadmap §1)",
      fall: 'Pinch Roller (roadmap §1)',
      velLevel: 'Pinch Roller (roadmap §1)',
    },
  },
  'core.poly': {
    family: 'synth',
    params: { detune: 0, unison: 0 },
    range: [36, 48, 60, 72, 84],
    aliasParams: { cutoff: 16000, reso: 0, envamt: 0, detune: 0, unison: 0, sub: 0 },
    known: {
      velColour: "Patch Bay's velocity scales the envelope amount only (roadmap §1; Patch Bay v2 is a new id)",
      alias: "Patch Bay's polyBLEP saws alias at the top (roadmap §2.11: the target for v2)",
      balance: 'Patch Bay is not register-normalised',
      velLevel: 'Patch Bay (roadmap §1)',
    },
  },
  'core.bass': {
    family: 'synthbass',
    params: { mode: 1, glide: 0 },
    range: [24, 31, 36, 43, 52],
    aliasParams: { cutoff: 8000, reso: 0, envamt: 0, drive: 1, mode: 1, glide: 0 },
    known: {
      velLevel: "Capstan's velocity covers 2.5 dB (roadmap §1)",
      velColour: "Capstan's colour hardly moves with velocity (roadmap §1, §2.10)",
      alias: "Capstan's 2x drive and saw alias at full drive",
      balance: 'Capstan is not register-normalised',
    },
  },
  // batch 2 (wave 10): their builders' own suite is tools/instruments2-test.js; these are the roadmap's family numbers
  'core.ep': {
    family: 'ep',
    params: { trem: 0 },
    range: [36, 48, 60, 72, 84],
    trem: { params: { trem: 0.6, rate: 4.5 }, hz: 4.5 },
  },
  'core.guitar': { family: 'plucked', params: { strum: 0 }, range: [40, 52, 64, 76, 88] },
  'core.mallets': { family: 'mallet', params: {}, range: [48, 60, 72, 84, 96] },
  'core.pad': {
    family: 'pad',
    params: { detune: 0 },
    range: [36, 48, 60, 72, 84],
    known: { balance: 'Room Tone is not register-normalised', velLevel: 'Room Tone (roadmap §1)' },
  },
  'core.drums': { family: 'drums' },
  // Light Table: its unison stack measured undetuned (a stack a few cents wide has no one spectral peak to tune by)
  'core.wavetable': { family: 'synth', params: { a_detune: 0 }, range: [36, 48, 60, 72, 84] },
};
// the roadmap's names for instruments still to come, then the shelf's categories
const BY_ID = { 'core.brass': 'brass', 'core.poly2': 'synth' };
const BY_CAT = {
  keys: 'ep',
  synth: 'synth',
  bass: 'synthbass',
  drums: 'drums',
  pluck: 'plucked',
  guitar: 'plucked',
  strings: 'strings',
  mallets: 'mallet',
  brass: 'brass',
  pad: 'pad',
};

// ------------------------------------------------------------------------------------------------ the checks
const only = process.argv.slice(2);
const profiles = [];
for (const def of INSTRUMENTS) {
  const mine = Object.entries(PROFILES).filter(([k, v]) => (v.id || k) === def.id);
  if (mine.length) for (const [k, v] of mine) profiles.push({ key: k, id: def.id, def, ...v });
  else {
    const family = BY_ID[def.id] || BY_CAT[def.cat] || 'synth';
    profiles.push({
      key: def.id,
      id: def.id,
      def,
      family,
      params: {},
      range: family === 'synthbass' || family === 'bassgtr' ? [28, 36, 43, 50] : [36, 48, 60, 72, 84],
      unprofiled: true,
    });
  }
}
const summary = [];
for (const pr of profiles) {
  if (only.length && !only.some((w) => pr.key.includes(w))) continue;
  if (pr.family === 'drums') {
    drums(pr);
    continue;
  }
  const F = { ...FAMILY[pr.family], ...pr };
  const name = `${pr.key} (${pr.def.name}${pr.key.includes('#') ? ' ' + pr.key.split('#')[1].toUpperCase() : ''}, ${pr.family})`;
  console.log(
    name + (pr.unprofiled ? ': no profile of its own yet; held to its family by ' + (BY_ID[pr.id] ? 'id' : 'cat') : ''),
  );
  const known = pr.known || {};
  const check = (what, cond, msg) => {
    if (cond || !(what in known)) return t.ok(cond, `${pr.key}: ${msg}`);
    t.note(`${pr.key}: known gap: ${msg} | ${known[what]}`);
    return false;
  };
  const P = F.params || {},
    row = { key: pr.key };
  // balance: equal velocity across the range
  const lv = F.range.map((p) => loud(note(pr.id, P, p, 0.6, F.hold), F.win[0], F.win[1]));
  row.balance = span(lv);
  check(
    'balance',
    span(lv) <= F.balance,
    `register balance ${fmt(span(lv))} dB across ${F.range.join('/')} at velocity 0.6 (${lv.map((v) => fmt(v, 1)).join(' / ')} LUFS; want <= ${F.balance})`,
  );
  // velocity: level and colour
  const vp = F.colourAt[0];
  const soft = loud(note(pr.id, P, vp, 0.3, F.hold), F.win[0], F.win[1]),
    hard = loud(note(pr.id, P, vp, 1, F.hold), F.win[0], F.win[1]);
  row.velLevel = hard - soft;
  check(
    'velLevel',
    hard - soft >= F.velLevel[0] && hard - soft <= F.velLevel[1],
    `velocity 0.3 -> 1.0 at p${vp} is ${fmt(hard - soft)} dB louder (family: ${F.velLevel[0]}..${F.velLevel[1]})`,
  );
  const ratios = F.colourAt.map((p) => {
    const c = (v) => {
      const r = note(pr.id, P, p, v, F.hold);
      return centroid(r.m, onset(r.m) + Math.round(Math.max(0, F.win[0] - 0.05) * SR));
    };
    return c(1) / c(0.3);
  });
  row.colour = Math.min(...ratios);
  if (F.velColourRange)
    check(
      'velColour',
      ratios.every((q) => q >= F.velColourRange[0] && q <= F.velColourRange[1]),
      `velocity colour: centroid x${ratios.map((q) => fmt(q, 2)).join(', x')} at 1.0 over 0.3 (p${F.colourAt.join(', p')}; this family keeps its colour: ${F.velColourRange.join('..')})`,
    );
  else
    check(
      'velColour',
      ratios.every((q) => q >= F.velColour),
      `harder is brighter: onset centroid x${ratios.map((q) => fmt(q, 2)).join(', x')} at velocity 1.0 over 0.3 (p${F.colourAt.join(', p')}; want >= ${F.velColour})`,
    );
  if (F.epBark) {
    const r = (v) => {
      const x = note(pr.id, P, 60, v, F.hold);
      return centroid(x.m, onset(x.m)) / mtof(60);
    };
    const lo = r(0.3),
      hi = r(1);
    check(
      'epBark',
      lo >= 1.3 && lo <= 1.8 && hi >= 3,
      `the tine bark: onset centroid / f0 at C4 ${fmt(lo, 2)} soft (want 1.3..1.8), ${fmt(hi, 2)} hard (want >= 3; §2.2)`,
    );
  }
  if (pr.styles) {
    // the bass's hands: fingers 1.25 (above), a pick 1.4 (§3, roadmap entry 6)
    const pick = [28, 40].map((p) => {
      const c = (v) => {
        const x = note(pr.id, { style: 1 }, p, v, F.hold);
        return centroid(x.m, onset(x.m));
      };
      return c(1) / c(0.3);
    });
    check(
      'velColour',
      pick.every((q) => q >= 1.4),
      `PICK: harder is brighter, x${pick.map((q) => fmt(q, 2)).join(', x')} (p28, p40; want >= 1.4)`,
    );
  }
  // decay by register, and the spectrum falling over the note (held 6 s)
  if (F.decay || F.fall || F.decayFalls) {
    const long = (p) => note(pr.id, P, p, 0.6, p < 50 ? 12 : 6, 0.2);
    if (F.decay) {
      const got = Object.entries(F.decay).map(([p, [lo, hi]]) => {
        const v = t60(long(+p).m, p < 50 ? 12 : 6);
        return { p, v, ok: v >= lo && v <= hi, lo, hi };
      });
      row.t60 = got.map((g) => `p${g.p} ${fmt(g.v)}`).join(' ');
      check(
        'decay',
        got.every((g) => g.ok),
        `T60 by register: ${got.map((g) => `p${g.p} ${fmt(g.v)} s (${g.lo}..${g.hi})`).join(', ')}`,
      );
    }
    if (F.decayFalls) {
      const v = F.decayFalls.map((p) => t60(long(p).m, p < 50 ? 12 : 6));
      check(
        'decayFalls',
        v.every((x, i) => i === 0 || x < v[i - 1]),
        `notes ring shorter up the neck: T60 ${F.decayFalls.map((p, i) => `p${p} ${fmt(v[i])} s`).join(', ')}`,
      );
    }
    if (F.fall) {
      const c = F.fall.map((p) => {
        const x = long(p).m,
          on = onset(x);
        return [centroid(x, on), centroid(x, on + 0.3 * SR), centroid(x, on + SR)];
      });
      check(
        'fall',
        c.every(([a, b, d]) => b < a && d <= b * 1.02),
        `the spectrum falls over the note (c0 > c300 >= c1s): ${F.fall.map((p, i) => `p${p} ${c[i].map(Math.round).join(' > ')} Hz`).join(', ')}`,
      );
    }
  }
  // the upper partials of a plucked string still ring at E5 (the 10th above -40 dB, §2.5)
  if (F.upper) {
    const x = note(pr.id, P, F.upper, 0.6, 2).m,
      on = onset(x) + Math.round(0.05 * SR),
      f0 = mtof(F.upper);
    const lv1 = dB(goertzel(x, on, 8192, f0)),
      l10 = dB(peakFreq(x, on, 8192, 10 * f0, 0.03).mag); // +-3%: stiff strings run sharp
    check(
      'upper',
      l10 - lv1 >= -40,
      `the 10th partial at p${F.upper} sits ${fmt(l10 - lv1)} dB under the fundamental (want >= -40)`,
    );
  }
  // inharmonicity
  if (F.inharm) {
    const got = Object.entries(F.inharm).map(([p, [lo, hi]]) => {
      const x = note(pr.id, P, +p, 0.6, 3).m,
        on = onset(x) + Math.round(0.08 * SR);
      const r = inharmonicity(x, on, 24000, mtof(+p), 12);
      return { p, B: r.B, n: r.partials, ok: r.B >= lo * 0.5 && r.B <= hi * 1.5, lo, hi };
    });
    row.B = got.map((g) => `p${g.p} ${g.B.toExponential(1)}`).join(' ');
    check(
      'inharm',
      got.every((g) => g.ok),
      `inharmonicity B ${got.map((g) => `p${g.p} ${g.B.toExponential(2)} (${g.n} partials; grands ${g.lo.toExponential(0)}..${g.hi.toExponential(0)})`).join(', ')}, within +-50%`,
    );
  }
  // tuning
  if (F.tune) {
    const got = Object.entries(F.tune).map(([p, [lo, hi]]) => {
      // a section's pitch is its players' average: the mean of the pitch track (a lone tone's: the spectral peak)
      const x = note(pr.id, P, +p, 0.6, F.tuneByTrack ? 3 : 2).m,
        on = onset(x) + Math.round(0.4 * SR);
      const tr = F.tuneByTrack ? pitchTrack(x, on, on + 2.4 * SR, mtof(+p)) : null;
      const c = tr
        ? tr.reduce((u, v) => u + v, 0) / tr.length
        : 1200 * Math.log2(peakFreq(x, on, 48000, mtof(+p), 0.01).f / mtof(+p));
      return { p, c, ok: c >= lo && c <= hi, lo, hi };
    });
    row.tune = got.map((g) => `p${g.p} ${fmt(g.c)}`).join(' ');
    check(
      'tune',
      got.every((g) => g.ok),
      `tuning: ${got.map((g) => `p${g.p} ${g.c >= 0 ? '+' : ''}${fmt(g.c)} cents (${g.lo}..${g.hi})`).join(', ')}`,
    );
  }
  // release
  if (F.release) {
    // with the instrument's defaults: its room or cabinet is part of how a note stops
    const got = Object.entries(F.release).map(([p, [lo, hi]]) => {
      const v = release40(note(pr.id, pr.relParams || {}, +p, 0.6, 1, 2).m, 1);
      return { p, v, ok: v >= lo && v <= hi, lo, hi };
    });
    check(
      'release',
      got.every((g) => g.ok),
      `let go, a note is 40 dB down in ${got.map((g) => `${fmt(g.v, 2)} s at p${g.p} (${g.lo}..${g.hi})`).join(', ')}, at defaults`,
    );
  }
  // organ: the steady tone and the rotor
  if (F.steady) {
    const x = note(pr.id, P, 60, 0.6, 3).m,
      e = envelope(x, 0.1, Math.round(0.2 * SR), Math.round(2.8 * SR));
    check('steady', span(e) < 1, `a held note doesn't decay: ${fmt(span(e), 2)} dB from 0.2 to 2.8 s (want < 1)`);
  }
  if (pr.rotor) {
    const am = (rotor) => {
      const r = play(
          pr.id,
          { reg: 4, rotor, cab: 1 },
          [72, 76, 79].map((p) => ({ p, v: 0.6, t: 0, d: 8 })),
          8,
          0,
        ),
        x = r.L,
        fl = 480,
        env = [];
      let prev = 0;
      for (let a = Math.round(3 * SR); a + fl <= Math.round(8 * SR); a += fl) {
        let s = 0;
        for (let i = a; i < a + fl; i++) {
          const h = x[i] - prev;
          prev = x[i];
          s += h * h;
        }
        env.push(Math.sqrt(s / fl));
      }
      return rate(env, 100, 0.3, 9);
    };
    const slow = am(0),
      fast = am(1);
    check(
      'rotor',
      slow > 0.55 && slow < 1.0 && fast > 5.8 && fast < 7.4,
      `the horn throws the top end at ${fmt(slow, 2)} Hz slow, ${fmt(fast, 2)} Hz fast (a Leslie 147: 0.67 / 7.06 Hz, §2.3)`,
    );
  }
  if (pr.trem) {
    // one side: a suitcase's tremolo pans, so the sum hardly moves
    const x = note(pr.id, pr.trem.params, 60, 0.6, 4).L,
      e = envelope(x, 0.01, Math.round(0.5 * SR), Math.round(4 * SR)).map((d) => Math.pow(10, d / 20));
    const hz = rate(e, 100, 1, 9);
    check(
      'trem',
      Math.abs(hz - pr.trem.hz) <= 0.1,
      `the tremolo sits at ${fmt(hz, 2)} Hz in the envelope (RATE ${pr.trem.hz}; want +-0.1)`,
    );
  }
  // strings: the attack, the vibrato, the steadiness of a held note, the section's width
  if (F.attack) {
    const atk = (v) => {
      // 10-90% of the held level, the power averaged over five notes (the players' arrival is staggered)
      let pw = null;
      for (const p of [55, 60, 64, 67, 72]) {
        const e = envelope(note(pr.id, P, p, v, 2.5).m, 0.005).map((d) => Math.pow(10, d / 10));
        pw = pw ? pw.map((u, i) => u + e[i]) : e;
      }
      // against the held level (the median from 0.25 to 1.75 s): the section breathes a dB or two once it has arrived,
      // so 10-90% is read from 10% to -3 dB, scaled as for a bow's exponential approach (x1.96)
      const held = pw.slice(50, 350).sort((u, w) => u - w)[150];
      const a10 = pw.findIndex((u) => u > held * 0.01),
        a70 = pw.findIndex((u) => u > held * 0.5);
      return (a70 - a10) * 0.005 * 1.96;
    };
    const s = atk(0.3),
      h = atk(1);
    row.attack = `${fmt(s, 2)}/${fmt(h, 2)}`;
    check(
      'attack',
      s >= 0.08 && s <= 0.4 && h >= 0.03 && h <= 0.12 && h < s,
      `the bows come in (10-90%) over ${fmt(s, 2)} s soft, ${fmt(h, 2)} s hard (§2.4: 0.08-0.4 s and 0.03-0.12 s)`,
    );
  }
  if (F.vibrato) {
    const x = note(pr.id, { ...P, ensemble: 0 }, 69, 0.6, 4).m,
      tr = pitchTrack(x, Math.round(1.5 * SR), Math.round(4 * SR), mtof(69));
    const hz = rate(tr, 100, 2, 10),
      mean = tr.reduce((u, v) => u + v, 0) / tr.length;
    const ext = Math.sqrt((2 * tr.reduce((u, v) => u + (v - mean) ** 2, 0)) / tr.length);
    check(
      'vibrato',
      hz >= F.vibrato[0] && hz <= F.vibrato[1],
      `vibrato in the pitch track at ${fmt(hz, 2)} Hz, +-${fmt(ext)} cents for the section (want ${F.vibrato.join('..')} Hz; players +-10..30 cents each, which average down)`,
    );
  }
  if (F.swing) {
    const sw = [52, 60, 67, 72, 79].map((p) => {
      const r = note(pr.id, {}, p, 0.6, 5);
      const e = envelope(r.m, 0.25, SR, 5 * SR);
      return span(e);
    });
    row.swing = Math.max(...sw);
    check(
      'swing',
      Math.max(...sw) <= F.swing,
      `a held note's level moves ${sw.map((v) => fmt(v)).join(' / ')} dB (250 ms windows, 1-5 s, p52-p79, defaults; want <= ${F.swing})`,
    );
  }
  if (F.corr) {
    const r = note(pr.id, P, 64, 0.6, 2.5);
    let lr = 0,
      ll = 0,
      rr = 0;
    for (let i = Math.round(0.6 * SR); i < Math.round(2.4 * SR); i++) {
      lr += r.L[i] * r.R[i];
      ll += r.L[i] * r.L[i];
      rr += r.R[i] * r.R[i];
    }
    const c = lr / Math.sqrt(ll * rr);
    check(
      'corr',
      c >= F.corr[0] && c <= F.corr[1],
      `one note is a section: L/R correlation ${fmt(c, 2)} (want ${F.corr.join('..')}; a solo player is > 0.9)`,
    );
  }
  // aliasing at the top
  const aliasAt = pr.alias === null ? null : pr.alias || F.alias;
  if (aliasAt) {
    const got = aliasAt.map((p) => {
      const x = note(pr.id, pr.aliasParams || P, p, 1, 2).m;
      return { p, ...aliasing(x, onset(x) + Math.round(0.4 * SR), mtof(p), pr.aliasBase || 1, pr.aliasTol || 0.006) };
    });
    row.alias = Math.max(...got.map((g) => g.db));
    check(
      'alias',
      got.every((g) => g.db <= -60),
      `aliasing at full brightness: the loudest thing between the partials is ${got.map((g) => `${fmt(g.db)} dB at p${g.p} (${Math.round(g.at)} Hz)`).join(', ')} under the fundamental (want <= -60)`,
    );
  }
  summary.push(row);
}

// ------------------------------------------------------------------------------------------------ drums
function drums(pr) {
  console.log(`${pr.id} (${pr.def.name}, drums)`);
  const kits = (pr.def.params.find((q) => q.key === 'kit') || { opts: ['FIELD'] }).opts;
  for (let kit = 0; kit < kits.length; kit++) {
    const hit = (p, v) => {
      const r = play(pr.id, { kit }, [{ p, v, t: 0, d: 0.25 }], 1, 0.5);
      return { l: loud(r, 0, 0.4), c: centroid(r.m, onset(r.m), 2048) };
    };
    const pieces = [
      [36, 'kick'],
      [38, 'snare'],
      [42, 'closed hat'],
    ].map(([p, n]) => {
      const a = hit(p, 0.4),
        b = hit(p, 1);
      return { p, n, dl: b.l - a.l, dc: b.c / a.c };
    });
    t.ok(
      pieces.every((q) => q.dl >= 4 && q.dl <= 22),
      `${pr.id} ${kits[kit]}: velocity 0.4 -> 1.0 is louder by ${pieces.map((q) => `${fmt(q.dl)} dB (${q.n})`).join(', ')} (want 4..22)`,
    );
    const sn = pieces[1];
    if (kit === 0)
      t.ok(
        sn.dc >= 1.3,
        `${pr.id} ${kits[kit]}: a harder snare hit is brighter, centroid x${fmt(sn.dc, 2)} (want >= 1.3)`,
      );
    const kick = pieces[0];
    if (kick.dc < 1.5)
      t.note(
        `${pr.id} ${kits[kit]}: ${kits[kit] === 'FIELD' ? 'known gap: ' : ''}the kick's beater click doesn't grow with force, centroid x${fmt(kick.dc, 2)} (§2.9 wants >= 1.5 on an acoustic kit)`,
      );
  }
}

// ------------------------------------------------------------------------------------------------ CPU
// 16 held voices (the roadmap's audit chord: whole tones up from an octave over the bottom of the range), best of
// three, timed beside the reference (tools/instruments-test.js's: GRAND, 16 notes a minor third apart from C2, 3.3% on
// an idle core), then scaled to idle. Per voice is (16 voices - none) / 16.
const REF_IDLE = 2.1; // it was 3.3% until the 2026-10-01 performance pass made GRAND about 44% cheaper, bit-exact; recalibrated to 2.1% measured on a quiet machine
if (process.env.CPU !== '0') {
  console.log('CPU, 16 held voices');
  const ms = (id, params, notes) => {
    const b = 8,
      t0 = performance.now();
    renderSong(
      project(
        id,
        notes.map((n) => ({ ...n, t: 0, d: b })),
        params,
        b,
      ),
      { from: 0, to: b, tail: 0 },
    );
    return ((performance.now() - t0) / 4000) * 100;
  };
  // a kit isn't held: it plays its own phrase (every piece, a groove and a fill)
  const kit = (id) => {
    const b = DRUM_PHRASE_BEATS,
      t0 = performance.now();
    renderSong(project(id, drumPhrase(), {}, b), { from: 0, to: b, tail: 0 });
    return ((performance.now() - t0) / (b * BEAT * 1000)) * 100;
  };
  const chord = (lo, step = 2) => Array.from({ length: 16 }, (_, k) => ({ p: lo + step * k, v: 0.8 }));
  const seen = new Set();
  const list = profiles.filter(
    (pr) => (!only.length || only.some((w) => pr.key.includes(w))) && !seen.has(pr.key) && seen.add(pr.key),
  );
  const best = new Map(),
    ref = { v: Infinity };
  for (let round = 0; round < 3; round++) {
    ref.v = Math.min(ref.v, ms('core.keys', { voice: 1 }, chord(36, 3)));
    for (const pr of list) {
      const P = pr.family === 'drums' ? {} : pr.params || {},
        lo = pr.family === 'drums' ? 35 : (pr.range || [28])[0] + 12;
      const b = best.get(pr.key) || { full: Infinity, none: Infinity };
      b.full = Math.min(b.full, pr.family === 'drums' ? kit(pr.id) : ms(pr.id, P, chord(lo)));
      b.none = Math.min(b.none, ms(pr.id, P, []));
      best.set(pr.key, b);
    }
  }
  const scale = REF_IDLE / ref.v;
  t.note(
    `the reference (Lamp Tines GRAND, 16 voices) took ${fmt(ref.v, 2)}% of real time here, so this machine reads x${fmt(1 / scale, 2)} its idle speed; figures below are scaled to idle`,
  );
  for (const pr of list) {
    const b = best.get(pr.key),
      full = b.full * scale,
      voice = ((b.full - b.none) * scale) / 16;
    const budget = (FAMILY[pr.family] || {}).cpu || 6;
    const row = summary.find((r) => r.key === pr.key);
    if (row) row.cpu = full;
    const known = pr.known || {};
    const msg =
      pr.family === 'drums'
        ? `the drum phrase at ${fmt(full, 2)}% of a core (${fmt(b.none * scale, 2)}% with nothing playing; budget ${budget}%)`
        : `16 held voices at ${fmt(full, 2)}% of a core (${fmt(voice, 3)}% a voice, ${fmt(b.none * scale, 2)}% with none; budget ${budget}%)`;
    if (full <= budget || !('cpu' in known) || known.cpu === null) t.ok(full <= budget, `${pr.key}: ${msg}`);
    else t.note(`${pr.key}: known gap: ${msg} | ${known.cpu}`);
  }
}

console.log(
  '\n  ' +
    ['instrument', 'balance dB', 'vel dB', 'colour x', 'T60 s', 'B', 'tuning c', 'alias dB', 'cpu %'].join(' | '),
);
for (const r of summary)
  console.log(
    '  ' +
      [
        r.key,
        fmt(r.balance),
        fmt(r.velLevel),
        fmt(r.colour, 2),
        r.t60 || '',
        r.B || '',
        r.tune || '',
        r.alias !== undefined ? fmt(r.alias) : '',
        r.cpu !== undefined ? fmt(r.cpu, 2) : '',
      ].join(' | '),
  );
t.done();
