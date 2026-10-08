// HumBench: how well "hum it" turns a voice into notes. Synthesises hummed and sung phrases whose notes are known,
// runs them through hum.js's hear(), and scores the notes it heard.
//
//   node tools/hum-bench.js                     the full set (36 phrases), a summary table and the hard cases
//   node tools/hum-bench.js --impl <hum.js>     score another hum.js (any module exporting hear(samples, sr))
//   node tools/hum-bench.js --n 12 --json       fewer phrases; one JSON line of the totals
//   node tools/hum-bench.js --list              each phrase: what it is, and how it scored
//
// The voices are not sines: a Rosenberg glottal pulse (jitter, shimmer, an open quotient per voice) through a cascade
// of formant resonators (a closed-mouth "mm" for hums; ah, oo, ee, la for sung syllables), lip radiation, then a mic.
// Every phrase has what an untrained voice does: vibrato (5-7 Hz, ±30-80 cents) on the long notes, scoops into notes
// (100-200 ms from below), a drift of 20-40 cents across the phrase, aspiration noise, soft onsets, repeated notes
// separated only by a dip in level, breaths in the rests, and room noise 30 dB under the voice. Three ranges (bass,
// tenor, soprano). The bass hums go through a laptop mic's high-pass, some with a period-doubled (fry-ish) pulse: the
// octave-ambiguous low hums.
//
// Scoring (note level, as mir_eval's transcription metrics): a heard note matches a sung one when its onset is within
// ±80 ms and its pitch within ±50 cents of the note the singer meant; one-to-one, nearest onset first. Octave errors are
// sung notes left unmatched that have a heard note at their onset 12 or 24 semitones off. Frame level: raw pitch
// accuracy (voiced frames within 50 cents of the pitch actually sung), voicing recall and false alarm. Cost: ms of
// analysis per second of audio, and µs per 10 ms frame.
//
// Deterministic (seeded); the numbers move only when the tracker does. Where it stood (seed 1, Node 24, M-series):
//   YIN + hysteresis segmenter (before pYIN)  P 76.8  R 84.8  F1 80.6  octave errors 10  126 µs a frame
//   pYIN + Viterbi + the note tracker now     P 97.1  R 95.2  F1 96.2  octave errors  4   85 µs a frame
// (seeds 2 and 3, never tuned on: F1 81.1 -> 95.6 and 83.1 -> 95.3)
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const SR = 48000;
const BREATH = 0.8; // aspiration: a sung vowel's harmonics-to-noise ratio lands at 12-25 dB

/* ------------------------------------------------------------------ a seeded rng */
export function rng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (xs) => xs[Math.floor(r() * xs.length)];
  r.chance = (p) => r() < p;
  r.gauss = () => {
    let u = 0;
    for (let i = 0; i < 6; i++) u += r();
    return (u - 3) / Math.sqrt(0.5);
  };
  return r;
}

/* ------------------------------------------------------------------ voices */
export const RANGES = { bass: [40, 60], tenor: [48, 67], soprano: [60, 81] };
// formants (Hz) and bandwidths for a few vowels; 'm' is a closed-mouth hum (a nasal murmur, little above 1 kHz)
const VOWELS = {
  m: { f: [260, 1150, 2400], bw: [70, 300, 400], lp: 900 },
  n: { f: [300, 1500, 2600], bw: [80, 300, 400], lp: 1100 },
  u: { f: [320, 870, 2250], bw: [70, 100, 120], lp: 0 },
  a: { f: [730, 1100, 2450], bw: [90, 110, 160], lp: 0 },
  i: { f: [280, 2250, 3000], bw: [60, 120, 200], lp: 0 },
  o: { f: [500, 850, 2400], bw: [80, 100, 150], lp: 0 },
  e: { f: [530, 1850, 2500], bw: [70, 110, 160], lp: 0 },
};

// A phrase's score: notes [{ m (the meant MIDI note), beats, gapBeats, ...articulation }], timed in seconds.
export function makePhrase(idx, { seed = 1 } = {}) {
  const r = rng(seed * 7919 + idx * 104729 + 17);
  const range = ['bass', 'tenor', 'soprano'][idx % 3];
  const style = ['hum', 'sung'][Math.floor(idx / 3) % 2];
  const [lo, hi] = RANGES[range];
  const lowHum = range === 'bass' && style === 'hum';
  const fry = lowHum && Math.floor(idx / 6) % 2 === 0;
  const tempo = r.int(72, 128),
    spb = 60 / tempo;
  const minor = r.chance(0.5),
    scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const tonic = lo + 3 + r.int(0, 8);
  const deg = (d) => tonic + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
  const fast = r.chance(0.3);
  const legato = r.chance(0.6);
  const count = r.int(7, 13);
  let d = r.int(0, 4);
  const notes = [];
  let t = r.range(0.25, 0.5);
  for (let k = 0; k < count; k++) {
    if (k) {
      const prev = d;
      const step = r.chance(0.18) ? 0 : r.pick([-1, -1, 1, 1, -2, 2, -1, 1, 3, -3, 4, -4, 2, -2, 7, -7]);
      d += step;
      while (deg(d) > hi) d -= 2;
      while (deg(d) < lo) d += 2;
      if (step === 0) d = prev;
    }
    const beats = fast && r.chance(0.35) ? 0.25 : r.pick([0.5, 0.5, 1, 1, 1, 1.5, 2, 2, 3]);
    const dur = beats * spb;
    notes.push({
      m: deg(d),
      t0: t,
      dur,
      beats,
      err: r.range(-0.08, 0.08), // the note's own intonation error (semitones)
      gain: Math.pow(10, r.range(-4, 2) / 20),
      // (a scoop or a soft start takes at most part of a short note: nobody scoops for longer than the note lasts)
      scoop: r.chance(0.35) ? { depth: r.range(0.7, 2.5), dur: Math.min(r.range(0.1, 0.2), 0.6 * dur) } : null,
      soft: r.chance(0.3) ? Math.min(r.range(0.06, 0.15), 0.5 * dur) : 0,
      vib:
        dur > 0.38
          ? { rate: r.range(5, 7), depth: r.range(0.3, 0.8), delay: r.range(0.15, 0.3), ph: r.range(0, 6.28) }
          : null,
      vowel: style === 'hum' ? (r.chance(0.8) ? 'm' : 'n') : r.pick(['a', 'u', 'o', 'e', 'i', 'a']),
    });
    // what follows: legato (no gap), a short gap, or a rest (with a breath in it now and then)
    let gap = legato ? 0 : r.range(0.05, 0.14);
    if (r.chance(0.12) && k < count - 1) gap = r.pick([0.5, 1]) * spb;
    if (!legato && gap < 0.2) gap = Math.min(gap, dur * 0.3);
    t += dur;
    notes[k].gapAfter = gap;
    t += gap;
  }
  // repeated notes sung legato: only a dip in level between them (always, when there's no gap; most of the time when
  // there is a short one); else the short gap
  for (let k = 1; k < notes.length; k++) {
    const a = notes[k - 1],
      b = notes[k];
    if (a.m !== b.m) continue;
    if (a.gapAfter === 0 || (a.gapAfter < 0.2 && r.chance(0.75))) {
      const shift = a.gapAfter;
      a.gapAfter = 0;
      for (let j = k; j < notes.length; j++) notes[j].t0 -= shift;
      b.dip = { depth: r.range(8, 20), dur: r.range(0.04, 0.08) };
    }
  }
  const total = notes[notes.length - 1].t0 + notes[notes.length - 1].dur + 0.5;
  const drift = { start: r.range(-0.05, 0.05), amount: r.range(0.2, 0.4) * (r.chance(0.5) ? 1 : -1) };
  return {
    idx,
    range,
    style,
    lowHum,
    fry,
    tempo,
    notes,
    total,
    drift,
    legato,
    fast,
    voice: {
      oq: style === 'hum' ? r.range(0.6, 0.75) : r.range(0.45, 0.65),
      breath: r.range(0.04, 0.12) * (style === 'hum' ? 1.4 : 1),
      jitter: r.range(0.002, 0.006),
      shimmer: r.range(0.02, 0.06),
      hp: lowHum ? r.range(160, 220) : 70, // a laptop mic for the low hums
    },
    room: -30,
    seed: seed * 7919 + idx,
  };
}

// A phrase by hand (for tests): notes [{ m, beats, gap (beats of silence after), scoop: [depth st, s], vib: [rate Hz,
// depth st], soft (s), dip (dB: a legato repeat's dip before this note), vowel }], at a tempo, in a voice.
export function phrase(
  list,
  {
    tempo = 100,
    style = 'hum',
    range = 'tenor',
    drift = 0,
    lowHum = false,
    fry = false,
    breath = 0.08,
    room = -30,
    seed = 7,
  } = {},
) {
  const spb = 60 / tempo;
  let t = 0.3;
  const notes = list.map((n) => {
    const dur = n.beats * spb;
    const o = {
      m: n.m,
      t0: t,
      dur,
      beats: n.beats,
      err: 0,
      gain: 1,
      vowel: n.vowel || (style === 'hum' ? 'm' : 'a'),
      scoop: n.scoop ? { depth: n.scoop[0], dur: n.scoop[1] } : null,
      soft: n.soft || 0,
      vib: n.vib ? { rate: n.vib[0], depth: n.vib[1], delay: 0.2, ph: 0 } : null,
      dip: n.dip ? { depth: n.dip, dur: 0.06 } : null,
      gapAfter: (n.gap || 0) * spb,
    };
    t += dur + o.gapAfter;
    return o;
  });
  return {
    idx: -1,
    range,
    style,
    lowHum,
    fry,
    tempo,
    notes,
    total: t + 0.5,
    drift: { start: 0, amount: drift },
    legato: true,
    fast: false,
    voice: { oq: style === 'hum' ? 0.65 : 0.55, breath, jitter: 0.004, shimmer: 0.03, hp: lowHum ? 190 : 70 },
    room,
    seed,
  };
}

// The audio for a phrase, and the truth: the pitch actually sung (MIDI, per sample, 0 when silent).
export function render(ph, sr = SR) {
  const r = rng(ph.seed ^ 0x5bd1e995);
  const N = Math.ceil(ph.total * sr),
    x = new Float32Array(N),
    sung = new Float32Array(N),
    env = new Float32Array(N);
  const notes = ph.notes,
    V = ph.voice;
  // per-sample pitch (meant + drift + scoop + glide + vibrato), envelope and vowel
  const fIdx = new Int16Array(N).fill(-1);
  for (let k = 0; k < notes.length; k++) {
    const n = notes[k],
      prev = notes[k - 1],
      next = notes[k + 1];
    const a = Math.round(n.t0 * sr),
      b = Math.min(N, Math.round((n.t0 + n.dur) * sr));
    const joined = prev && prev.gapAfter === 0,
      joinedNext = next && n.gapAfter === 0;
    const att = n.dip ? 0.03 : joined ? 0 : n.soft || r.range(0.015, 0.035);
    const startLvl = n.dip ? Math.pow(10, -n.dip.depth / 20) : 0;
    const rel = joinedNext ? (next.dip ? next.dip.dur : 0) : r.range(0.03, 0.08);
    const endLvl = joinedNext ? (next.dip ? Math.pow(10, -next.dip.depth / 20) : 1) : 0;
    const glide = joined && !n.scoop && prev.m !== n.m ? r.range(0.03, 0.06) : 0;
    for (let i = a; i < b; i++) {
      const t = i / sr,
        into = t - n.t0,
        left = n.t0 + n.dur - t;
      let m = n.m + n.err + ph.drift.start + ph.drift.amount * (t / ph.total);
      if (n.scoop && into < n.scoop.dur) m -= n.scoop.depth * (0.5 + 0.5 * Math.cos((Math.PI * into) / n.scoop.dur));
      if (glide && into < glide) m += (prev.m - n.m) * (0.5 + 0.5 * Math.cos((Math.PI * into) / glide));
      if (n.vib && into > n.vib.delay)
        m += n.vib.depth * Math.sin(2 * Math.PI * n.vib.rate * t + n.vib.ph) * Math.min(1, (into - n.vib.delay) / 0.15);
      let e = n.gain;
      if (att > 0 && into < att) e *= startLvl + (1 - startLvl) * Math.sin((Math.PI / 2) * (into / att)) ** 2;
      if (rel > 0 && left < rel) e *= endLvl + (1 - endLvl) * Math.sin((Math.PI / 2) * (left / rel)) ** 2;
      if (n.vib && into > n.vib.delay) e *= 1 + 0.08 * Math.sin(2 * Math.PI * n.vib.rate * t + n.vib.ph + 0.6); // a little AM with the vibrato
      sung[i] = m;
      env[i] = e;
      fIdx[i] = k;
    }
  }
  // the source: a Rosenberg glottal flow, period by period
  let ph0 = 0,
    amp = 1,
    alt = 1,
    jit = 0,
    lpS = 0,
    nz = 0,
    lastM = 60;
  const res = [mkRes(), mkRes(), mkRes(), mkRes()];
  let curV = null,
    curK = -1,
    tgt = [500, 1500, 2500],
    cur = [500, 1500, 2500],
    bw = [80, 100, 150],
    lpHz = 0;
  const hp = mkHp(V.hp, sr);
  let prevY = 0;
  for (let i = 0; i < N; i++) {
    const k = fIdx[i];
    const m = k >= 0 ? sung[i] : lastM;
    if (k >= 0) lastM = m;
    const f0 = 440 * Math.pow(2, (m - 69) / 12) * (1 + jit);
    ph0 += f0 / sr;
    if (ph0 >= 1) {
      ph0 -= 1;
      jit = V.jitter * r.gauss();
      amp = 1 + V.shimmer * r.gauss();
      alt = ph.fry ? (alt === 1 ? 0.8 : 1) : 1; // period doubling: every other pulse weaker
    }
    const oq = V.oq,
      Tp = 0.65 * oq,
      Tn = 0.35 * oq;
    let g = 0;
    if (ph0 < Tp) g = 0.5 * (1 - Math.cos((Math.PI * ph0) / Tp));
    else if (ph0 < Tp + Tn) g = Math.cos((Math.PI * (ph0 - Tp)) / (2 * Tn));
    const e = env[i];
    const asp = (r() * 2 - 1) * V.breath * (0.35 + 0.65 * g) * BREATH;
    let s = e * (g * amp * alt + asp);
    nz += 0.35 * (e * asp - nz); // through the nose: a hum's breath gets past the closed mouth
    // the vowel: formants glide (20 ms) when the syllable changes
    if (k >= 0 && (notes[k].vowel !== curV || k !== curK)) {
      curV = notes[k].vowel;
      curK = k;
      const v = VOWELS[curV];
      tgt = v.f.slice();
      bw = v.bw;
      lpHz = v.lp;
      // a singer tunes the first formant up to a high note (else the vowel swallows it)
      const f0n = 440 * Math.pow(2, (notes[k].m - 69) / 12);
      if (!lpHz && tgt[0] < 1.15 * f0n) {
        tgt[0] = Math.min(1200, 1.15 * f0n);
        tgt[1] = Math.max(tgt[1], tgt[0] + 300);
      }
    }
    if ((i & 31) === 0) {
      for (let q = 0; q < 3; q++) {
        cur[q] += (tgt[q] - cur[q]) * 0.6;
        setRes(res[q], cur[q], bw[q], sr);
      }
      setRes(res[3], 3500, 250, sr);
    }
    for (let q = 0; q < 4; q++) s = runRes(res[q], s);
    if (lpHz) {
      const c = 1 - Math.exp((-2 * Math.PI * lpHz) / sr);
      lpS += c * (s - lpS);
      s = lpS + 0.12 * nz;
    }
    const y = s - prevY;
    prevY = s; // lip radiation
    x[i] = hp(y);
  }
  // level: the voice at about -18 dBFS rms, then the room 30 dB under it (pink noise), and breaths in the rests
  let se = 0,
    sc = 0;
  for (let i = 0; i < N; i++)
    if (env[i] > 0.3) {
      se += x[i] * x[i];
      sc++;
    }
  const vr = Math.sqrt(se / Math.max(1, sc)),
    gain = Math.pow(10, -18 / 20) / (vr || 1);
  for (let i = 0; i < N; i++) x[i] *= gain;
  const roomRms = Math.pow(10, (-18 + ph.room) / 20);
  const pink = pinkNoise(N, r);
  for (let i = 0; i < N; i++) x[i] += roomRms * pink[i];
  for (let k = 0; k + 1 < notes.length; k++) {
    const n = notes[k];
    if (n.gapAfter < 0.3) continue;
    const a = Math.round((n.t0 + n.dur + 0.05) * sr),
      b = Math.min(N, a + Math.round(Math.min(0.35, n.gapAfter - 0.1) * sr));
    let lp = 0,
      lp2 = 0;
    for (let i = a; i < b; i++) {
      const u = (i - a) / (b - a),
        w = Math.sin(Math.PI * u) ** 2;
      const z = r() * 2 - 1;
      lp += 0.3 * (z - lp);
      lp2 += 0.05 * (z - lp2);
      x[i] += Math.pow(10, -40 / 20) * w * (lp - lp2) * 6;
    }
  }
  // the truth, sung: pitch where the voice is really sounding
  for (let i = 0; i < N; i++) if (env[i] < 0.12 * (fIdx[i] >= 0 ? notes[fIdx[i]].gain : 1)) sung[i] = 0;
  return { x, sr, sung, notes: notes.map((n) => ({ t0: n.t0, t1: n.t0 + n.dur, m: n.m, tags: tagsOf(n, ph) })) };
}
function tagsOf(n, ph) {
  const t = [];
  if (n.vib) t.push('vibrato');
  if (n.scoop) t.push('scoop');
  if (n.dip) t.push('repeat');
  if (n.soft) t.push('soft');
  if (ph.lowHum) t.push('lowhum');
  if (n.dur < 0.2) t.push('short');
  return t;
}
function mkRes() {
  return { a: 1, b: 0, c: 0, y1: 0, y2: 0 };
}
function setRes(o, f, bw, sr) {
  const R = Math.exp((-Math.PI * bw) / sr);
  o.b = 2 * R * Math.cos((2 * Math.PI * f) / sr);
  o.c = -R * R;
  o.a = 1 - o.b - o.c;
}
function runRes(o, x) {
  const y = o.a * x + o.b * o.y1 + o.c * o.y2;
  o.y2 = o.y1;
  o.y1 = y;
  return y;
}
function mkHp(fc, sr) {
  // 2nd-order Butterworth high-pass
  const w = Math.tan((Math.PI * fc) / sr),
    k = 1 / (1 + Math.SQRT2 * w + w * w);
  const b0 = k,
    b1 = -2 * k,
    b2 = k,
    a1 = 2 * (w * w - 1) * k,
    a2 = (1 - Math.SQRT2 * w + w * w) * k;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}
function pinkNoise(N, r) {
  // Paul Kellet's filter, normalised to unit rms
  const o = new Float32Array(N);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0,
    s = 0;
  for (let i = 0; i < N; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    o[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    s += o[i] * o[i];
  }
  const k = 1 / Math.sqrt(s / N);
  for (let i = 0; i < N; i++) o[i] *= k;
  return o;
}

/* ------------------------------------------------------------------ scoring */
export function scoreNotes(ref, est, { onTol = 0.08, pitchTol = 0.5 } = {}) {
  const pairs = [];
  for (let i = 0; i < ref.length; i++)
    for (let j = 0; j < est.length; j++) {
      const dt = Math.abs(est[j].t0 - ref[i].t0);
      if (dt <= onTol && Math.abs(est[j].midi - ref[i].m) <= pitchTol) pairs.push([dt, i, j]);
    }
  pairs.sort((a, b) => a[0] - b[0]);
  const ri = new Set(),
    ej = new Set(),
    match = new Map();
  for (const [, i, j] of pairs)
    if (!ri.has(i) && !ej.has(j)) {
      ri.add(i);
      ej.add(j);
      match.set(i, j);
    }
  // onset only (any pitch)
  const op = [];
  for (let i = 0; i < ref.length; i++)
    for (let j = 0; j < est.length; j++) {
      const dt = Math.abs(est[j].t0 - ref[i].t0);
      if (dt <= onTol) op.push([dt, i, j]);
    }
  op.sort((a, b) => a[0] - b[0]);
  const oi = new Set(),
    oj = new Set();
  for (const [, i, j] of op)
    if (!oi.has(i) && !oj.has(j)) {
      oi.add(i);
      oj.add(j);
    }
  let octave = 0;
  for (let i = 0; i < ref.length; i++) {
    if (match.has(i)) continue;
    if (
      est.some(
        (e) =>
          Math.abs(e.t0 - ref[i].t0) <= onTol &&
          [12, 24].some((o) => Math.abs(Math.abs(e.midi - ref[i].m) - o) <= pitchTol),
      )
    )
      octave++;
  }
  return { tp: match.size, nRef: ref.length, nEst: est.length, onsetTp: oi.size, octave, matched: match };
}
export function scoreFrames(frames, sung, sr) {
  let voiced = 0,
    rp = 0,
    rc = 0,
    vHit = 0,
    unv = 0,
    fa = 0;
  for (const f of frames) {
    const i = Math.min(sung.length - 1, Math.max(0, Math.round(f.t * sr)));
    const truth = sung[i],
      est = f.hz > 0 ? f.midi : 0;
    if (truth > 0) {
      voiced++;
      if (est > 0) {
        vHit++;
        const d = Math.abs(est - truth);
        if (d <= 0.5) rp++;
        if (Math.abs(d - 12 * Math.round(d / 12)) <= 0.5) rc++;
      }
    } else {
      unv++;
      if (est > 0) fa++;
    }
  }
  return { voiced, rp, rc, vHit, unv, fa };
}

/* ------------------------------------------------------------------ the run */
export async function bench({ impl, n = 36, seed = 1, onPhrase } = {}) {
  const mod = await import(pathToFileURL(path.resolve(impl)).href);
  const tot = {
    tp: 0,
    nRef: 0,
    nEst: 0,
    onsetTp: 0,
    octave: 0,
    voiced: 0,
    rp: 0,
    rc: 0,
    vHit: 0,
    unv: 0,
    fa: 0,
    secs: 0,
    ms: 0,
    frames: 0,
    track: 0,
    decode: 0,
    segment: 0,
    costed: 0,
    rightLow: 0,
    wrong: 0,
    wrongLow: 0,
  };
  const byTag = {},
    byRange = {},
    byStyle = {};
  const add = (o, k, tp, nn) => {
    o[k] = o[k] || { tp: 0, n: 0 };
    o[k].tp += tp;
    o[k].n += nn;
  };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const ph = makePhrase(i, { seed });
    const au = render(ph);
    const t0 = performance.now();
    const { frames, segs, cost } = mod.hear(au.x, au.sr);
    if (cost) {
      tot.track += cost.track;
      tot.decode += cost.decode;
      tot.segment += cost.segment;
      tot.costed += frames.length;
    }
    const ms = performance.now() - t0;
    const sn = scoreNotes(au.notes, segs);
    const sf = scoreFrames(frames, au.sung, au.sr);
    // the repair view dims a note under 0.45 confidence (hum.js transcribe): are the dimmed ones the wrong ones?
    const hit = new Set(sn.matched.values());
    segs.forEach((g, j) => {
      const low = (g.conf ?? 1) < 0.45;
      if (hit.has(j)) tot.rightLow += low ? 1 : 0;
      else {
        tot.wrong++;
        tot.wrongLow += low ? 1 : 0;
      }
    });
    for (const k of ['tp', 'nRef', 'nEst', 'onsetTp', 'octave']) tot[k] += sn[k];
    for (const k of Object.keys(sf)) tot[k] += sf[k];
    tot.secs += au.x.length / au.sr;
    tot.ms += ms;
    tot.frames += frames.length;
    au.notes.forEach((nt, k) => {
      for (const tg of nt.tags) add(byTag, tg, sn.matched.has(k) ? 1 : 0, 1);
      add(byTag, 'all', sn.matched.has(k) ? 1 : 0, 1);
    });
    add(byRange, ph.range, sn.tp, 0);
    byRange[ph.range].ref = (byRange[ph.range].ref || 0) + sn.nRef;
    byRange[ph.range].est = (byRange[ph.range].est || 0) + sn.nEst;
    add(byStyle, ph.style, sn.tp, 0);
    byStyle[ph.style].ref = (byStyle[ph.style].ref || 0) + sn.nRef;
    byStyle[ph.style].est = (byStyle[ph.style].est || 0) + sn.nEst;
    const row = {
      i,
      range: ph.range,
      style: ph.style,
      lowHum: ph.lowHum,
      fry: ph.fry,
      tempo: ph.tempo,
      ref: sn.nRef,
      est: sn.nEst,
      tp: sn.tp,
      octave: sn.octave,
      f1: f1(sn.tp, sn.nRef, sn.nEst),
      au,
      segs,
      frames,
      ph,
    };
    rows.push(row);
    if (onPhrase) onPhrase(row);
  }
  return { tot, byTag, byRange, byStyle, rows };
}
export const f1 = (tp, nr, ne) => (tp ? (2 * tp) / (nr + ne) : 0);
export function summary(res) {
  const t = res.tot,
    P = t.tp / Math.max(1, t.nEst),
    R = t.tp / Math.max(1, t.nRef);
  return {
    phrases: res.rows.length,
    notes: t.nRef,
    heard: t.nEst,
    precision: P,
    recall: R,
    f1: f1(t.tp, t.nRef, t.nEst),
    onsetF1: f1(t.onsetTp, t.nRef, t.nEst),
    octaveErrors: t.octave,
    dimmedWrong: t.wrongLow / Math.max(1, t.wrong),
    dimmedRight: t.rightLow / Math.max(1, t.tp),
    rawPitchAcc: t.rp / Math.max(1, t.voiced),
    rawChromaAcc: t.rc / Math.max(1, t.voiced),
    voicingRecall: t.vHit / Math.max(1, t.voiced),
    voicingFalseAlarm: t.fa / Math.max(1, t.unv),
    msPerSec: t.ms / t.secs,
    usPerFrame: (t.ms * 1000) / Math.max(1, t.frames),
    trackUsPerFrame: t.costed ? (t.track * 1000) / t.costed : null,
    decodeUsPerFrame: t.costed ? (t.decode * 1000) / t.costed : null,
    segmentUsPerFrame: t.costed ? (t.segment * 1000) / t.costed : null,
    recallBy: Object.fromEntries(Object.entries(res.byTag).map(([k, v]) => [k, v.tp / v.n])),
    f1By: Object.fromEntries(
      [...Object.entries(res.byRange), ...Object.entries(res.byStyle)].map(([k, v]) => [k, f1(v.tp, v.ref, v.est)]),
    ),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2),
    o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['json', 'list'].includes(k)) o[k] = true;
    else o[k] = argv[++i];
  }
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const impl = o.impl || path.join(HERE, '../app/src/input/hum.js');
  const pct = (x) => (100 * x).toFixed(1).padStart(5);
  const res = await bench({
    impl,
    n: Number(o.n || 36),
    seed: Number(o.seed || 1),
    onPhrase: o.list
      ? (r) =>
          console.log(
            `  ${String(r.i).padStart(2)} ${r.range.padEnd(7)} ${r.style.padEnd(4)} ${r.lowHum ? (r.fry ? 'low+fry' : 'low    ') : '       '} ${String(r.tempo).padStart(3)} bpm  ${String(r.tp).padStart(2)}/${String(r.ref).padStart(2)} matched, ${String(r.est).padStart(2)} heard, F1 ${pct(r.f1)}%${r.octave ? `, ${r.octave} octave` : ''}`,
          )
      : null,
  });
  const s = summary(res);
  if (o.json) {
    console.log(JSON.stringify({ impl: path.relative(process.cwd(), impl), ...s }));
  } else {
    console.log(`HumBench: ${s.phrases} phrases, ${s.notes} notes (${path.relative(process.cwd(), impl)})`);
    console.log(
      `  notes      precision ${pct(s.precision)}%  recall ${pct(s.recall)}%  F1 ${pct(s.f1)}%   (onset only F1 ${pct(s.onsetF1)}%)   octave errors ${s.octaveErrors}`,
    );
    console.log(
      `  dimmed     ${pct(s.dimmedWrong).trim()}% of the wrong notes, ${pct(s.dimmedRight).trim()}% of the right ones (confidence under 0.45)`,
    );
    console.log(
      `  frames     raw pitch ${pct(s.rawPitchAcc)}%  chroma ${pct(s.rawChromaAcc)}%  voicing recall ${pct(s.voicingRecall)}%  false alarm ${pct(s.voicingFalseAlarm)}%`,
    );
    console.log(
      `  recall by  ${Object.entries(s.recallBy)
        .map(([k, v]) => `${k} ${pct(v).trim()}%`)
        .join('  ')}`,
    );
    console.log(
      `  F1 by      ${Object.entries(s.f1By)
        .map(([k, v]) => `${k} ${pct(v).trim()}%`)
        .join('  ')}`,
    );
    console.log(
      `  cost       ${s.msPerSec.toFixed(1)} ms per second of audio, ${s.usPerFrame.toFixed(0)} µs per 10 ms frame (whole pipeline)` +
        (s.trackUsPerFrame != null
          ? `; tracking ${s.trackUsPerFrame.toFixed(0)} µs, decode ${s.decodeUsPerFrame.toFixed(1)} µs, segment ${s.segmentUsPerFrame.toFixed(1)} µs a frame`
          : ''),
    );
  }
}
