// "Service Lift": dubstep, 64 bars in F minor at 140 bpm (1:50), the form a bass-music track has: intro, build, drop,
// break, drop 2 (a different bass), outro. A service lift is the one the staff ride: bare, loud, and it drops. Every
// part of it is an op, dispatched through the store as an agent's would be (lib.js built), on the devices the genre
// guide names (get_guide "genres", bass-music):
//   - Sandbag (core.clubkit), DUBSTEP, its sub kick tuned to F1: half time in the drops (kick on 1, snare on 3, ghost
//     kicks and hats that turn to triplets on every fourth bar), a build that rolls quarters to thirty-seconds over
//     its own riser, a bar's gap, and the impact on each drop's downbeat. Clip Lamp (Drum bus clip), then Gaffer Tape
//     (Drum density at 35%).
//   - The sub on its own track: Light Table's Dark Slide on the root (F1, Db1, Ab1, Eb1), ducked under the kick by
//     Dim Switch keyed from the drums, made mono under 120 Hz by Gatefold (STEEP).
//   - Drop 1, the growl: Fixer an octave over the sub, trading with the drums (call and response), its switch-up at
//     bar 25 handing every other phrase to Hard Cut's riddim stabs in triplets. Drop 2, another bass: Strobe's wobble
//     locked to the grid, answered by Halation, Jump Cut's metallic stabs closing each phrase. Every bass the guide's
//     chain: Slide Rule (a 24 dB cut at 40 Hz, +6 dB at 110 Hz), Dim Switch on the kick and the snare, Gaffer Tape
//     (Bass density), Gatefold mono to 200 Hz.
//   - Wide Angle's supersaw chords through the intro, the build (a filter opening on an automation lane) and the break,
//     and Fade Up rising under the build.
// The house played that. Claude played over it: Key Light's lead, the hook over the break and its answer in drop 2's
// last eight bars, and the drop 2 wobble's MACRO 1 lane, deeper through each phrase.
// The master: Clip Lamp (Master clip +6), then Red Line at -1 dBTP, a clean ceiling (master.clip 'clean').
// Measured on the canonical Node render (tools/genre-demos-test.js holds it to TARGETS['bass-music']); the numbers are
// in that test's table and in the intent's report, not repeated here where they would drift.

import { HOUSE, AGENT, demo, built, preset, rng } from './lib.js';

export const META = { id: 'service-lift', title: 'Service Lift', genre: 'Dubstep', line: 'a half-time drop on Sandbag and Light Table, the lead by Claude', tempo: 140, key: 'F minor', targets: 'bass-music' };

const TEMPO = 140, BARS = 64;
export const FORM = [['Intro', 0, 8], ['Build', 8, 8], ['Drop', 16, 16], ['Break', 32, 8], ['Drop 2', 40, 16], ['Outro', 56, 8]];
// the drops, for the measuring: [name, first bar, bars]
export const DROPS = [['Drop', 16, 16], ['Drop 2', 40, 16]];

// i - VI - III - VII: [sub root (F1 = 43.7 Hz ... Db1 = 34.6 Hz), the pad's voicing]
const CH = { Fm: [29, [53, 56, 60, 65]], Db: [25, [53, 56, 61, 65]], Ab: [32, [51, 56, 60, 63]], Eb: [27, [51, 55, 58, 63]] };
const PROG = ['Fm', 'Fm', 'Db', 'Eb', 'Fm', 'Fm', 'Ab', 'Eb'];
const chordAt = (b) => PROG[b % 8];
const n = (p, t, d, v = 0.9) => ({ p, t, d, v });

// -------------------------------------------------------------------------------------------------- the drums
const K = 36, S = 38, H = 42, OH = 46, CR = 49, RISER = 34, IMPACT = 33;
function dropBar(b, R, riddim) {
  const out = [n(K, 0, 0.25, 1), n(S, 2, 0.25, 1)];
  const four = b % 4;
  if (riddim) {
    if (four === 1 || four === 3) out.push(n(K, 1.5, 0.25, 0.85));
    if (four === 3) out.push(n(K, 3.25, 0.25, 0.8), n(K, 3.5, 0.25, 0.85));
  } else {
    if (four === 1) out.push(n(K, 2.75, 0.25, 0.8));
    if (four === 3) out.push(n(K, 1.5, 0.25, 0.8), n(K, 3.5, 0.25, 0.75));
  }
  if (four === 3) {
    // hats in triplets, then a flam into the next phrase
    for (let i = 0; i < 6; i++) out.push(n(H, i / 3, 0.08, i % 3 ? 0.42 : 0.62));
    out.push(n(S, 3.5, 0.2, 0.55), n(S, 3.75, 0.2, 0.7));
  } else {
    for (let i = 0; i < 8; i++) out.push(n(H, i * 0.5, 0.08, i % 2 ? 0.42 : 0.62));
    if (riddim) for (const t of [0.75, 1.75, 2.75, 3.75]) out.push(n(H, t, 0.06, 0.32));
  }
  if (b % 8 === 7) out.push(n(OH, 3.5, 0.25, 0.6));
  return out.map((x) => ({ ...x, v: Math.min(1, x.v * (0.96 + 0.08 * R())) }));
}
function drums() {
  const R = rng(140), out = [];
  const put = (bar, list) => { for (const x of list) out.push({ ...x, t: x.t + bar * 4 }); };
  // intro: a hat from bar 5, a kick every bar from bar 7
  for (let b = 4; b < 8; b++) put(b, [...Array.from({ length: 8 }, (_, i) => n(H, i * 0.5, 0.08, i % 2 ? 0.35 : 0.5)), ...(b >= 6 ? [n(K, 0, 0.25, 0.8)] : [])]);
  // the build: kick on the beat, the snare doubling up each bar, the riser over bars 13-16, a gap of half a bar
  for (let b = 8; b < 12; b++) put(b, [n(K, 0, 0.25, 0.9), n(K, 2, 0.25, 0.85), n(S, 2, 0.25, 0.85), ...Array.from({ length: 8 }, (_, i) => n(H, i * 0.5, 0.08, i % 2 ? 0.4 : 0.6))]);
  put(12, [n(RISER, 0, 15.5, 0.6)]);
  const roll = [[12, 1], [13, 2], [14, 4], [15, 8]];
  for (const [b, per] of roll) for (let i = 0; i < 4 * per; i++) { const t = i / per; if (b === 15 && t >= 2) break; put(b, [n(S, t, Math.min(0.2, 0.9 / per), 0.25 + 0.35 * ((b - 12) * 4 + t) / 14)]); }
  for (let b = 12; b < 15; b++) put(b, [n(K, 0, 0.25, 0.9)]);
  // drop 1 (bars 17-32), the impact and a crash on its downbeat
  put(16, [n(IMPACT, 0, 2, 1), n(CR, 0, 1, 1)]);
  for (let b = 16; b < 32; b++) put(b, dropBar(b, R, b >= 24));
  put(24, [n(CR, 0, 1, 0.9)]);
  // the break: nothing, then hats, the riser and a roll into drop 2
  for (let b = 36; b < 40; b++) put(b, Array.from({ length: 8 }, (_, i) => n(H, i * 0.5, 0.08, i % 2 ? 0.35 : 0.55)));
  put(36, [n(RISER, 0, 15.5, 0.5)]);
  for (let i = 0; i < 16; i++) put(39, [n(S, i * 0.125, 0.1, 0.25 + 0.3 * i / 16)]);
  // drop 2 (bars 41-56), riddim
  put(40, [n(IMPACT, 0, 2, 1), n(CR, 0, 1, 1)]);
  for (let b = 40; b < 56; b++) put(b, dropBar(b, R, true));
  put(48, [n(CR, 0, 1, 0.9)]);
  // the outro: the drop's kick and snare, thinning out
  for (let b = 56; b < 60; b++) put(b, [n(K, 0, 0.25, 0.85), n(S, 2, 0.25, 0.8), ...Array.from({ length: 8 }, (_, i) => n(H, i * 0.5, 0.08, i % 2 ? 0.35 : 0.5))]);
  put(60, [n(CR, 0, 2, 0.7)]);
  return out;
}

// -------------------------------------------------------------------------------------------------- the basses
const sub = (from, bars) => Array.from({ length: bars }, (_, i) => n(CH[chordAt(from + i)][0], (from + i) * 4, 3.9, 0.9));
// Fixer's call: two bars of growl answering the drums ([t, d, interval over the root])
const CALL = [[0.5, 0.75, 0], [1.5, 0.25, 0], [1.75, 0.25, 12], [2.5, 0.5, 0], [3, 0.25, 3], [3.25, 0.5, 0]];
const ANSWER = [[0.5, 0.5, 0], [1, 0.5, 7], [1.5, 1, 0], [2.75, 0.25, 12], [3, 1, 10]];
function growl(from, bars, skip = () => false) {
  const out = [];
  for (let i = 0; i < bars; i++) {
    const b = from + i;
    if (skip(b)) continue;
    const r = CH[chordAt(b)][0] + 12;
    for (const [t, d, iv] of (i % 2 ? ANSWER : CALL)) out.push(n(r + iv, b * 4 + t, d, 0.9));
  }
  return out;
}
// Hard Cut's riddim stabs in eighth triplets with gaps (the switch-up's odd bars)
function stabs(from, bars, only) {
  const out = [];
  for (let i = 0; i < bars; i++) {
    const b = from + i;
    if (!only(b)) continue;
    const r = CH[chordAt(b)][0] + 12;
    for (const k of [1, 2, 4, 5, 7, 9, 10]) out.push(n(r + (k === 10 ? 12 : 0), b * 4 + k / 3, 0.22, k % 3 === 1 ? 0.95 : 0.85));
  }
  return out;
}
// drop 2: Strobe's wobble on long notes, Halation's answers
function wobble(from, bars) {
  const out = [];
  for (let i = 0; i < bars; i++) {
    const b = from + i, r = CH[chordAt(b)][0] + 12;
    if (i % 2 === 0) out.push(n(r, b * 4 + 0.5, 1.5, 0.9), n(r + 12, b * 4 + 2.5, 0.5, 0.85), n(r, b * 4 + 3, 0.75, 0.9));
  }
  return out;
}
function halation(from, bars) {
  const out = [];
  for (let i = 0; i < bars; i++) {
    const b = from + i, r = CH[chordAt(b)][0] + 12;
    if (i % 2 === 1) for (const [t, d, iv] of [[0.5, 0.5, 0], [1, 0.25, 0], [1.25, 0.25, 3], [1.5, 0.75, 0], [2.5, 0.5, 7], [3, 0.5, 0]]) out.push(n(r + iv, b * 4 + t, d, 0.9));
  }
  return out;
}
function jumpCut(from, bars) {
  const out = [];
  for (let i = 0; i < bars; i++) {
    const b = from + i, r = CH[chordAt(b)][0] + 12;
    if (i % 4 === 3) for (const t of [3, 3.25, 3.5, 3.75]) out.push(n(r + 12, b * 4 + t, 0.18, 0.9));
  }
  return out;
}

// -------------------------------------------------------------------------------------------------- the melody
const pad = (from, bars, v = 0.7) => {
  const out = [];
  for (let i = 0; i < bars; i++) { const b = from + i; for (const p of CH[chordAt(b)][1]) out.push(n(p, b * 4, 3.9, v)); }
  return out;
};
// Claude's hook over the break (F minor, around C5), and its answer an octave up over drop 2's last eight bars
const HOOK = [[72, 0, 1.5], [75, 1.5, 0.5], [77, 2, 1], [75, 3, 1], [72, 4, 2], [68, 6, 1], [70, 7, 1],
  [72, 8, 1.5], [75, 9.5, 0.5], [80, 10, 1], [79, 11, 1], [77, 12, 1], [75, 13, 1], [77, 14, 2],
  [72, 16, 1.5], [75, 17.5, 0.5], [77, 18, 1], [75, 19, 1], [72, 20, 2], [68, 22, 1], [70, 23, 1],
  [72, 24, 1], [70, 25, 1], [68, 26, 1], [67, 27, 1], [65, 28, 4]];
const hook = (bar, up = 0, v = 0.8) => HOOK.map(([p, t, d]) => n(p + up, bar * 4 + t, d - 0.05, v));

const EQ_BASS = { b1_on: 1, b1_type: 4, b1_freq: 40, b2_on: 1, b2_type: 0, b2_freq: 110, b2_gain: 6, b2_q: 0.8 };

export function make() {
  const base = demo({ title: 'Service Lift', tempo: TEMPO, key: { root: 'F', scale: 'minor' }, sections: [], tracks: [], bars: BARS });
  const ops = [];
  for (const [name, start, length] of FORM) ops.push({ type: 'section.add', section: { name, start: start * 4, length: length * 4 } });
  const clipOf = (track, start, bars, notes) => ({ type: 'clip.add', track, clip: { start: start * 4, length: bars * 4, notes: notes.filter((x) => x.t >= start * 4 && x.t < (start + bars) * 4).map((x) => ({ ...x, t: +(x.t - start * 4).toFixed(4) })) } });
  const D = drums();
  const bassChain = (track, id, key, extra = {}) => [
    { type: 'insert.add', track, insert: { id: id + 'eq', device: 'core.eq8', params: EQ_BASS } },
    { type: 'insert.add', track, insert: { id: id + 'dk', device: 'core.ducker', params: preset('core.ducker', 'Kick and snare duck'), key: { track: key } } },
    { type: 'insert.add', track, insert: { id: id + 'mb', device: 'core.multiband', params: preset('core.multiband', 'Bass density', extra.mb || {}) } },
    { type: 'insert.add', track, insert: { id: id + 'wd', device: 'core.width', params: { monobass: 200, mono_mode: 1 } } },
  ];
  const house = [
    ...ops,
    { type: 'track.add', track: { id: 't_drums', name: 'Drums', color: 'var(--c-1)', instrument: { device: 'core.clubkit', params: preset('core.clubkit', 'Dubstep') } } },
    ...FORM.map(([, s, l]) => clipOf('t_drums', s, l, D)),
    { type: 'insert.add', track: 't_drums', insert: { id: 'fx_dclip', device: 'core.clipper', params: preset('core.clipper', 'Drum bus clip') } },
    { type: 'insert.add', track: 't_drums', insert: { id: 'fx_dmb', device: 'core.multiband', params: preset('core.multiband', 'Drum density', { depth: 35 }) } },

    { type: 'track.add', track: { id: 't_sub', name: 'Sub', color: 'var(--c-5)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Dark Slide') }, gain: -4.5 } },
    clipOf('t_sub', 16, 16, sub(16, 16)), clipOf('t_sub', 40, 16, sub(40, 16)), clipOf('t_sub', 56, 4, sub(56, 4)),
    { type: 'insert.add', track: 't_sub', insert: { id: 'fx_sduck', device: 'core.ducker', params: preset('core.ducker', 'Kick duck'), key: { track: 't_drums' } } },
    { type: 'insert.add', track: 't_sub', insert: { id: 'fx_smono', device: 'core.width', params: { monobass: 120, mono_mode: 1 } } },

    { type: 'track.add', track: { id: 't_growl', name: 'Growl', color: 'var(--c-6)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Fixer') }, gain: 0 } },
    clipOf('t_growl', 16, 16, growl(16, 16, (b) => b >= 24 && b % 2 === 1)),
    ...bassChain('t_growl', 'fx_g', 't_drums'),
    { type: 'track.add', track: { id: 't_stab', name: 'Stabs', color: 'var(--c-8)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Hard Cut') }, gain: -2 } },
    clipOf('t_stab', 24, 8, stabs(24, 8, (b) => b % 2 === 1)),
    ...bassChain('t_stab', 'fx_t', 't_drums'),

    { type: 'track.add', track: { id: 't_wob', name: 'Wobble', color: 'var(--c-4)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Strobe') }, gain: 0 } },
    clipOf('t_wob', 40, 16, wobble(40, 16)),
    ...bassChain('t_wob', 'fx_w', 't_drums'),
    { type: 'track.add', track: { id: 't_hal', name: 'Fold', color: 'var(--c-3)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Halation') }, gain: -1 } },
    clipOf('t_hal', 40, 16, [...halation(40, 16)]),
    ...bassChain('t_hal', 'fx_h', 't_drums'),
    { type: 'track.add', track: { id: 't_jump', name: 'Metal', color: 'var(--c-2)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Jump Cut') }, gain: -3 } },
    clipOf('t_jump', 40, 16, jumpCut(40, 16)),
    ...bassChain('t_jump', 'fx_j', 't_drums'),

    { type: 'track.add', track: { id: 't_pad', name: 'Chords', color: 'var(--c-7)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Wide Angle') }, gain: -9 } },
    clipOf('t_pad', 0, 16, pad(0, 16, 0.6)), clipOf('t_pad', 32, 8, pad(32, 8, 0.55)), clipOf('t_pad', 56, 8, pad(56, 8, 0.6)),
    { type: 'insert.add', track: 't_pad', insert: { id: 'fx_pfilt', device: 'core.filter', params: { cutoff: 700, lfo: 0 } } },
    { type: 'insert.add', track: 't_pad', insert: { id: 'fx_pduck', device: 'core.ducker', params: preset('core.ducker', 'Gentle pump'), key: { track: 't_drums' } } },
    { type: 'insert.add', track: 't_pad', insert: { id: 'fx_peq', device: 'core.eq8', params: { b1_on: 1, b1_type: 4, b1_freq: 180 } } },
    { type: 'auto.write', track: 't_pad', insert: 'fx_pfilt', param: 'cutoff', points: '0:500 28:1400~0.3 32:900 60:9000~0.5 64:16000 128:2500 160:12000~0.4 224:3000 256:600~-0.3' },

    { type: 'track.add', track: { id: 't_rise', name: 'Riser', color: 'var(--c-8)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Fade Up') }, gain: -14 } },
    clipOf('t_rise', 12, 4, [n(65, 48, 15.5, 0.8)]), clipOf('t_rise', 36, 4, [n(65, 144, 15.5, 0.8)]),
    { type: 'insert.add', track: 't_rise', insert: { id: 'fx_req', device: 'core.eq8', params: { b1_on: 1, b1_type: 4, b1_freq: 250 } } },

    { type: 'insert.add', track: 'master', insert: { id: 'fx_mclip', device: 'core.clipper', params: preset('core.clipper', 'Master clip (+6)') } },
    { type: 'insert.add', track: 'master', insert: { id: 'fx_mlim', device: 'core.limiter', params: { gain: 6.5, ceiling: -1, release: 60 } } },
    { type: 'master.set', patch: { clip: 'clean' } },
  ];
  const claude = [
    { type: 'track.add', track: { id: 't_lead', name: 'Lead', color: 'var(--c-2)', instrument: { device: 'core.wavetable', params: preset('core.wavetable', 'Key Light') }, gain: -10 } },
    clipOf('t_lead', 32, 8, hook(32, 0, 0.8)), clipOf('t_lead', 48, 8, hook(48, 12, 0.7)),
    { type: 'insert.add', track: 't_lead', insert: { id: 'fx_leq', device: 'core.eq8', params: { b1_on: 1, b1_type: 4, b1_freq: 220 } } },
    { type: 'insert.add', track: 't_lead', insert: { id: 'fx_lduck', device: 'core.ducker', params: preset('core.ducker', 'Gentle pump'), key: { track: 't_drums' } } },
    { type: 'auto.write', track: 't_wob', insert: 'instrument', param: 'macro1', points: '160:0.2 188:0.8~0.4 192:0.3 220:1~0.4 224:0.4' },
  ];
  return built(base, [[HOUSE, 'the house plays Service Lift', house], [AGENT, 'Claude plays the lead, and moves the wobble', claude]]);
}
export default make;
