// Writes the bench's starting songs (tools/bench/songs/*.json) from the studio's own material. Run it only to change
// a song on purpose: every task, oracle and score depends on these files, ids included (ids seed devices, so a song's
// ids are part of its sound). Nothing here is random.
//
//   node tools/bench/make-songs.js            writes night-shift.json, lab.json, loose-groove.json
//
// night-shift   "Night Shift" from app/src/core/demo.js (8 bars, A minor, 92 bpm), rearranged for mix tasks: the kick
//               on its own track, the hook in both sections (so verse and chorus start out the same), no guitar (the
//               pedals and amps are graph devices: the canonical renderer can't run them), no master inserts.
// lab           a device bench: Snaps (claps), Bell (a pad playing a tune) and Room (a synth with a low end) at 100 bpm.
// loose-groove  four bars of swung sixteenths played loose: every hit off the grid by a fixed, seeded amount.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoProject } from '../../app/src/core/demo.js';
import { parseNotes, parseGrid } from '../../app/src/core/music.js';
import { idNotes } from '../../app/src/core/project.js';
import { FORMAT } from '../../app/src/core/project.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AT = '2026-10-01T00:00:00.000Z';
const BY = 'overdub';

const clip = (id, start, length, notes, name) => idNotes({ id, kind: 'notes', start, length, name, by: BY, notes: notes.map((n) => ({ ...n, by: BY })) });
const track = (id, name, color, device, params, clips, extra = {}) => ({
  id, name, color, kind: 'instrument', instrument: { device, params }, inserts: [], clips, gain: 0, pan: 0, mute: false, solo: false, arm: false, by: BY, ...extra,
});
const fx = (id, device, params = {}) => ({ id, device, on: true, params, by: BY });
const song = (patch) => ({
  format: FORMAT, id: patch.id, title: patch.title, tempo: patch.tempo, meter: [4, 4], key: patch.key,
  loop: { on: false, start: 0, end: patch.end }, tracks: patch.tracks, sections: patch.sections || [], devices: {}, assets: {},
  master: { gain: 0, inserts: [] }, meta: { created: AT, modified: AT, authors: { overdub: { kind: 'house', name: 'Overdub' } } },
});
const strip = (notes) => notes.map(({ p, t, d, v }) => ({ p, t, d, v }));

function nightShift() {
  const demo = demoProject();
  const T = Object.fromEntries(demo.tracks.map((t) => [t.name, t]));
  const drums = strip(T.Drums.clips[0].notes);
  const kick = drums.filter((n) => n.p === 36), kit = drums.filter((n) => n.p !== 36);
  const lead = strip(T.Hook.clips[0].notes);
  const dp = T.Drums.instrument.params;
  return song({
    id: 'p_bnight', title: 'Night Shift (bench)', tempo: 92, key: { root: 'A', scale: 'minor' }, end: 32,
    sections: [{ id: 's_verse1', name: 'Verse', start: 0, length: 16 }, { id: 's_chors1', name: 'Chorus', start: 16, length: 16 }],
    tracks: [
      track('t_kick01', 'Kick', 'var(--c-1)', 'core.drums', { ...dp }, [clip('c_kick01', 0, 32, kick, 'Four on the floor')]),
      track('t_kit001', 'Kit', 'var(--c-1)', 'core.drums', { ...dp }, [clip('c_kit001', 0, 32, kit, 'Beat')]),
      track('t_bass01', 'Bass', 'var(--c-5)', 'core.bass', { ...T.Bass.instrument.params },
        [clip('c_bass01', 0, 16, strip(T.Bass.clips[0].notes), 'Walk'), clip('c_bass02', 16, 16, strip(T.Bass.clips[1].notes), 'Walk 2')], { gain: -1.5 }),
      track('t_keys01', 'Keys', 'var(--c-6)', 'core.keys', { ...T.Keys.instrument.params },
        [clip('c_keys01', 0, 32, strip(T.Keys.clips[0].notes), 'Changes')], { gain: -3, pan: -0.15, inserts: [fx('fx_kverb1', 'core.verb')] }),
      track('t_hook01', 'Hook', 'var(--c-4)', 'core.pluck', {},
        [clip('c_hook01', 0, 16, lead, 'Hook'), clip('c_hook02', 16, 16, lead, 'Hook 2')], { gain: 3, pan: 0.15, inserts: [fx('fx_hdly01', 'core.delay')] }),
    ],
  });
}

function lab() {
  const claps = [];
  for (let bar = 0; bar < 4; bar++) for (const n of parseGrid({ steps: 16, step: 0.25, rows: { clap: '....x.......x...', rim: '..........o.....' } })) claps.push({ ...n, t: n.t + bar * 4 });
  const tune = parseNotes('C5@0:1 E5@1:1 G5@2:2 F5@4:1 E5@5:1 D5@6:2 E5@8:1 G5@9:1 C6@10:2 B5@12:1 G5@13:1 C5@14:2');
  const room = parseNotes('C2@0:4 G2@0:4 E3@0:4 A1@4:4 E2@4:4 C3@4:4 F1@8:4 C2@8:4 A2@8:4 G1@12:4 D2@12:4 B2@12:4');
  return song({
    id: 'p_blab01', title: 'Device lab (bench)', tempo: 100, key: { root: 'C', scale: 'major' }, end: 16,
    tracks: [
      track('t_snap01', 'Snaps', 'var(--c-1)', 'core.drums', { kit: 1, room: 0 }, [clip('c_snap01', 0, 16, strip(claps), 'Claps')], { gain: -3 }),
      track('t_bell01', 'Bell', 'var(--c-3)', 'core.pad', { release: 3, space: 0.6 }, [clip('c_bell01', 0, 16, strip(tune), 'Tune')], { gain: -4 }),
      track('t_room01', 'Room', 'var(--c-5)', 'core.poly', { cutoff: 1800 }, [clip('c_room01', 0, 16, strip(room), 'Chords')], { gain: -6 }),
    ],
  });
}

// A fixed, seeded jitter (a small LCG: the same numbers forever).
function jitters(n, seed = 7) {
  let s = seed >>> 0; const out = [];
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out.push(((s / 4294967296) * 2 - 1)); }
  return out;
}
export const GROOVE = { swing: 0.06, jitter: 0.025 }; // beats: odd sixteenths are 0.06 late; every hit is off by up to 0.025

function looseGroove() {
  const grid = { steps: 16, step: 0.25, rows: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' } };
  const bar = parseGrid(grid);
  const raw = [];
  for (let b = 0; b < 4; b++) for (const n of bar) {
    const step = Math.round(n.t / 0.25);
    const v = n.p === 42 ? (step % 2 ? 0.45 : step % 4 === 0 ? 0.85 : 0.65) : n.v;
    raw.push({ p: n.p, t: b * 4 + n.t + (step % 2 ? GROOVE.swing : 0), d: n.p === 42 ? 0.125 : 0.25, v });
  }
  raw.sort((a, b) => a.t - b.t || a.p - b.p);
  const j = jitters(raw.length);
  const drums = raw.map((n, i) => ({ ...n, t: Math.max(0, Math.round((n.t + j[i] * GROOVE.jitter) * 10000) / 10000) }));
  const bass = parseNotes('E1@0:0.75 E1@1.5:0.5 G1@2.5:0.5 A1@3:1 E1@4:0.75 E1@5.5:0.5 D2@6.5:0.5 B1@7:1 C2@8:0.75 C2@9.5:0.5 B1@10.5:0.5 A1@11:1 B1@12:0.75 B1@13.5:0.5 D2@14.5:0.5 E2@15:1');
  return song({
    id: 'p_bgroov', title: 'Loose groove (bench)', tempo: 96, key: { root: 'E', scale: 'minor' }, end: 16,
    tracks: [
      track('t_drum01', 'Drums', 'var(--c-1)', 'core.drums', { kit: 0, room: 0.2 }, [clip('c_drum01', 0, 16, drums, 'Loose')]),
      track('t_bass01', 'Bass', 'var(--c-5)', 'core.bass', {}, [clip('c_bass01', 0, 16, strip(bass), 'Line')], { gain: -2 }),
    ],
  });
}

// JSON, two-space indented, with every innermost object (a note, a param set) on one line.
export function pretty(x) {
  return JSON.stringify(x, null, 2).replace(/\{[^{}\[\]]*\}/g, (m) => m.replace(/\s*\n\s*/g, ' ').replace(/\{ /, '{ ').replace(/ \}$/, ' }'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, p] of [['night-shift', nightShift()], ['lab', lab()], ['loose-groove', looseGroove()]]) {
    const file = path.join(HERE, 'songs', name + '.json');
    fs.writeFileSync(file, pretty(p) + '\n');
    console.log('wrote', path.relative(process.cwd(), file), p.tracks.map((t) => `${t.name}(${t.clips.reduce((a, c) => a + c.notes.length, 0)})`).join(' '));
  }
}
