// A sloppy human, for the checks of what capture makes of imperfect playing (tools/input-test.js, sketch-rec-test.js).
// Nobody taps or hums exactly in time; these play what a person meant the way a non-musician plays it: each hit or note
// a little off (jitter), the whole thing drifting (a tempo that slows or rushes as it goes), some notes rushed (a snare
// early), a hum's onsets soft and late or early and its notes let go before their time. Seeded: the same seed plays the
// same take.
//
//   rng(seed) -> () => 0..1                    (and .gauss(): about -2..2, a bell)
//   perform(pattern, { bpm, bars, jitter, drift, rush, start, seed }) -> [{ t (s), p, want (beat) }]
//       pattern: [[beat in the bar, GM note]]; jitter: s (the bell's width), drift: the tempo's change over the take
//       (-0.06: 6% slower by the end), rush: { [p]: s early }
//   sloppyHum(melody, { tempo, sloppy, seed }) -> { x (Float32Array, 48 kHz), sr, want: [{ m, beat }], seconds }
//       melody: [[midi, beats, rest after]]; sloppy: each onset up to this many seconds early or late; each note held
//       75-95% of its length (a hummer lets go early). The voice is tools/hum-bench.js's (vibrato, scoops, breath).
//   wav(x, sr, file, { lead, tail }) -> seconds     a 16-bit mono WAV (Chromium's fake mic plays it from the top)
import fs from 'node:fs';
import { phrase, render } from './hum-bench.js';

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const r = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  r.gauss = () => {
    let u = 0;
    for (let i = 0; i < 6; i++) u += r();
    return (u - 3) * 1.41;
  };
  return r;
}

export function perform(
  pattern,
  { bpm = 100, bars = 2, bpb = 4, jitter = 0.025, drift = 0, rush = {}, start = 1, seed = 1 } = {},
) {
  const r = rng(seed),
    total = bars * bpb,
    out = [];
  for (let b = 0; b < bars; b++) {
    for (const [bt, p] of pattern) {
      const beat = b * bpb + bt;
      // a tempo that changes evenly over the take: the time of a beat is the integral of 60 / tempo
      const avg = bpm * (1 + (drift * (beat / total)) / 2);
      out.push({ t: start + (beat * 60) / avg + jitter * r.gauss() - (rush[p] || 0), p, want: beat });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export function sloppyHum(melody, { tempo = 100, sloppy = 0.05, seed = 5, range = 'tenor' } = {}) {
  const ph = phrase(
    melody.map(([m, beats, gap = 0]) => ({ m, beats, gap })),
    { tempo, style: 'hum', range, seed: 11 + seed },
  );
  const r = rng(seed),
    spb = 60 / tempo;
  let at = 0.3,
    beat = 0;
  const want = [];
  ph.notes.forEach((n, i) => {
    want.push({ m: melody[i][0], beat });
    n.t0 = at + (r() * 2 - 1) * sloppy;
    n.dur = n.beats * spb * (0.75 + 0.2 * r());
    at += n.beats * spb + n.gapAfter;
    beat += melody[i][1] + (melody[i][2] || 0);
  });
  ph.total = at + 0.5;
  const au = render(ph, 48000);
  return { x: au.x, sr: 48000, want, seconds: au.x.length / 48000 };
}

export function wav(x, sr, file, { lead = 0.6, tail = 1.5, gain = 0.35 } = {}) {
  let pk = 0;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  const N = Math.round((lead + x.length / sr + tail) * sr),
    y = new Float32Array(N),
    o = Math.round(lead * sr);
  for (let i = 0; i < x.length && i + o < N; i++) y[i + o] = (x[i] / (pk || 1)) * gain;
  const b = Buffer.alloc(44 + N * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + N * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(N * 2, 40);
  for (let i = 0; i < N; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, y[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, b);
  return N / sr;
}
