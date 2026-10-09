// @ts-check
// The song a new studio opens with: "Night Shift", 8 bars in A minor at 92 bpm, so there is something to play, look
// at and ask the agent about. Most of it is by 'overdub' (the house: drawn neutral). The parts an agent made are
// signed by 'claude' and drawn cool: the Fireflies track and its instrument, and the two effects it built (the
// cathedral on the guitar, the cassette on the keys). See devices/showcase.js for the requests behind them.

import { createProject, newId, idNotes, stableIds } from './project.js';
import { parseNotes, parseGrid } from './music.js';
import { SHOWCASE } from '../devices/showcase.js';
import { MORE_DEMOS } from './demos/index.js';

const BY = 'overdub';
const AGENT = 'claude'; // the parts an agent wrote in the session this demo stands for (see devices/showcase.js)
const clip = (start, length, notes, name, by = BY) => idNotes({ id: newId('c'), kind: 'notes', start, length, name, by, notes: notes.map((n) => ({ ...n, by })) });

export function demoProject() { return stableIds(buildNightShift(), 'night-shift'); }
function buildNightShift() {
  const drumBar = (fill) => ({
    steps: 16, step: 0.25,
    rows: fill
      ? { kick: 'x.....x...x.....', snare: '....X.......X.xx', hat: 'x.x.x.x.x.x.x...', open: '..............x.' }
      : { kick: 'x.....x...x.....', snare: '....X.......X...', hat: 'x.xox.xox.xox.xo' },
  });
  const drums = [];
  for (let bar = 0; bar < 8; bar++) for (const n of parseGrid(drumBar(bar === 3 || bar === 7))) drums.push({ ...n, t: n.t + bar * 4 });

  const bass = parseNotes(`
    A1@0:0.75 A1@0.75:0.25 E2@1.5:0.5 A1@2:1 G1@3.5:0.5
    F1@4:0.75 F1@4.75:0.25 C2@5.5:0.5 F1@6:1 E1@7.5:0.5
    C2@8:0.75 C2@8.75:0.25 G1@9.5:0.5 C2@10:1 B1@11.5:0.5
    G1@12:0.75 G1@12.75:0.25 D2@13.5:0.5 G1@14:1 G#1@15.5:0.5`);

  const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [52, 55, 60, 64], [55, 59, 62, 65]];
  const keys = [];
  for (let bar = 0; bar < 8; bar++) {
    const ch = chords[bar % 4], t0 = bar * 4;
    for (const p of ch) {
      keys.push({ p, t: t0, d: 1.5, v: 0.62 }, { p, t: t0 + 1.5, d: 0.5, v: 0.42 }, { p, t: t0 + 2.5, d: 1.4, v: 0.55 });
    }
  }
  const lead = parseNotes(`
    E5@0:0.5 D5@0.5:0.5 C5@1:0.5 A4@1.5:1.5 G4@3:0.5 A4@3.5:0.5
    C5@4:1 A4@5:0.5 C5@5.5:0.5 D5@6:1.5 C5@7.5:0.5
    E5@8:0.5 G5@8.5:0.5 E5@9:0.5 D5@9.5:0.5 C5@10:1.5 D5@11.5:0.5
    B4@12:1 D5@13:0.5 B4@13.5:0.5 A4@14:2`);

  // Claude's twinkle over the chorus, on the instrument it built for it (claude.firefly)
  const fireflies = parseNotes(`
    E6@0:0.5*0.7 C6@0.75:0.5*0.55 A5@1.5:1*0.6 G6@2.5:0.5*0.5 E6@3:1*0.65
    F6@4:0.5*0.7 C6@4.75:0.5*0.55 A5@5.5:1*0.6 E6@6.5:0.5*0.5 C6@7:1*0.65
    G6@8:0.5*0.72 E6@8.75:0.5*0.55 C6@9.5:1*0.6 D6@10.5:0.5*0.5 E6@11:1*0.66
    D6@12:0.5*0.7 B5@12.75:0.5*0.55 G5@13.5:1*0.6 A5@14.5:0.5*0.5 B5@15:1*0.7`);
  const now = new Date().toISOString();
  const devices = Object.fromEntries(SHOWCASE.map((d) => [d.id, { ...d, created: now, modified: now }]));

  return createProject({
    title: 'Night Shift',
    tempo: 92,
    devices,
    key: { root: 'A', scale: 'minor' },
    loop: { on: true, start: 0, end: 32 },
    sections: [
      { id: newId('s'), name: 'Verse', start: 0, length: 16 },
      { id: newId('s'), name: 'Chorus', start: 16, length: 16 },
    ],
    tracks: [
      { id: newId('t'), name: 'Drums', color: 'var(--c-1)', kind: 'instrument', instrument: { device: 'core.drums', params: { kit: 2, room: 0.25, tone: 0.35 } },
        inserts: [], clips: [clip(0, 32, drums, 'Beat')], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: BY },
      { id: newId('t'), name: 'Bass', color: 'var(--c-5)', kind: 'instrument', instrument: { device: 'core.bass', params: { sub: 0.15, cutoff: 900, drive: 0.35 } },
        inserts: [], clips: [clip(0, 16, bass, 'Walk'), clip(16, 16, bass, 'Walk 2')], gain: -1.5, pan: 0, mute: false, solo: false, arm: false, by: BY },
      { id: newId('t'), name: 'Keys', color: 'var(--c-6)', kind: 'instrument', instrument: { device: 'core.keys', params: { bright: 0.6 } },
        inserts: [{ id: newId('fx'), device: 'claude.night-bus', on: true, params: {}, by: AGENT }, { id: newId('fx'), device: 'core.verb', on: true, params: {}, by: BY }], clips: [clip(0, 32, keys, 'Changes')], gain: -3, pan: -0.15, mute: false, solo: false, arm: false, by: BY },
      { id: newId('t'), name: 'Hook', color: 'var(--c-4)', kind: 'instrument', instrument: { device: 'core.pluck', params: {} },
        inserts: [{ id: newId('fx'), device: 'core.delay', on: true, params: {}, by: BY }], clips: [clip(16, 16, lead, 'Hook')], gain: 3, pan: 0.15, mute: false, solo: false, arm: false, by: BY },
      { id: newId('t'), name: 'Fireflies', color: 'var(--c-2)', kind: 'instrument', instrument: { device: 'claude.firefly', params: {} },
        inserts: [], clips: [clip(16, 16, fireflies, 'Twinkle', AGENT)], gain: 3, pan: 0.25, mute: false, solo: false, arm: false, by: AGENT },
      { id: newId('t'), name: 'Guitar', color: 'var(--c-2)', kind: 'audio', instrument: null,
        inserts: [
          { id: newId('fx'), device: 'pedal.gate', on: true, params: {}, by: BY },
          { id: newId('fx'), device: 'pedal.chorus', on: true, params: {}, by: BY },
          { id: newId('fx'), device: 'amp.jangle', on: true, params: {}, by: BY },
          { id: newId('fx'), device: 'claude.tidal-cathedral', on: true, params: {}, by: AGENT },
        ],
        clips: [], gain: -4, pan: 0, mute: false, solo: false, arm: false, input: { device: 'default', channel: 1 }, by: BY },
    ],
    // the master: a gentle glue and a limiter, mixed by measurement (tools/song-test.js: about -10.6 LUFS, -1.2 dBTP)
    master: { gain: 0, inserts: [
      { id: newId('fx'), device: 'core.comp', on: true, params: { threshold: -18, ratio: 2, attack: 20, release: 200 }, by: BY },
      { id: newId('fx'), device: 'core.limiter', on: true, params: { gain: 3, ceiling: -1 }, by: BY },
    ] },
    meta: { created: new Date().toISOString(), modified: new Date().toISOString(), authors: { overdub: { kind: 'house', name: 'Overdub' }, claude: { kind: 'agent', name: 'Claude' } } },
  });
}

// The demo shelf (core/demos/): Night Shift first, then a song per genre. demoById(id) -> a fresh project (an unknown
// or missing id gives Night Shift), so /app/?demo=lido opens that one.
export const DEMOS = [
  { id: 'night-shift', title: 'Night Shift', genre: 'Lo-fi', line: 'the first song: keys, a hook, fireflies by Claude', tempo: 92, key: 'A minor', make: demoProject },
  ...MORE_DEMOS,
];
export function demoById(id) {
  const d = DEMOS.find((x) => x.id === id) || DEMOS[0];
  return stableIds(d.make(), d.id); // (stable ids: the same demo sounds the same for everyone)
}
