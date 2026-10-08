// The fixed scenes tools/golden.json pins (rendered by the canonical Node renderer, app/src/engine/node/render.js).
// Every scene is a song document plus the samples of its audio clips, built the same way every time: fixed ids (ids
// seed devices), the test signals from app/src/audio/testsignals.js.
//
//   inst:<id>   a built-in kernel instrument playing the test phrase (the kit plays the drum phrase), 120 bpm
//   fx:<id>     a built-in kernel effect on the DI strum (an audio clip of 8 s), defaults, 4 s of tail
//   demo        the demo song ("Night Shift") with fixed ids; its graph devices (the guitar's pedals and amp) bypassed
//   demo-kernels  the same without the Guitar track: kernels only, so the browser can render exactly the same thing
//   automation  a pad with a gain fade in, a pan sweep and a filter sweep on a kernel insert (bent, a jump, a step):
//               the lanes both renderers play (docs/research/AUTOMATION.md 3.5)
//   sidechain   a bass and a pad ducking under kicks through Dim Switch's key (one key a muted ghost kick), both renderers
//   master-clean  the same mix through Red Line at -1 dBTP on the master and a clean ceiling (master.clip 'clean')
//   demo:<id>   a song from the demo shelf (only those listed in SHELF_SCENES), whole, as demoById builds it (its ids
//               are stable already), its timestamps pinned. Each scene is pinned on purpose, not the whole shelf.
//   inst:core.wavetable:akwf   Light Table on two of its AKWF tables (the bank in app/src/devices/builtin/akwf.js),
//               osc A's POS swept by an LFO across its waves
//   inst:<id>#<12 hex>   a sampled instrument (kernel data) on its phrase: the name carries the first 12 hex digits of
//               the kit it plays, so a different kit is a different scene, never a moved hash. Only when the kit has
//               been fetched (node tools/fetch-kits.js); otherwise it is listed by missingScenes() and skipped.
//
// `browser: true` marks the kernel-only scenes tools/golden-test.js also renders in Chromium's OfflineAudioContext.
import fs from 'node:fs';
import { INSTRUMENTS, SAMPLED, EFFECTS } from '../app/src/devices/builtin/index.js';
import { dataPath } from '../app/src/engine/node/data.js';
import { SHOWCASE } from '../app/src/devices/showcase.js';
import { demoProject, demoById } from '../app/src/core/demo.js';
import { createProject } from '../app/src/core/project.js';
import { phrase, drumPhrase, diStrum, PHRASE_BPM, PHRASE_BEATS, DRUM_PHRASE_BEATS } from '../app/src/audio/testsignals.js';

const STAMP = '2026-09-30T00:00:00.000Z';
const META = { created: STAMP, modified: STAMP, authors: {} };
const notes = (list) => list.map((n, i) => ({ id: 'n' + (i + 1), p: n.p, t: n.t, d: n.d, v: n.v, by: 'overdub' }));
const showcase = (kind) => SHOWCASE.filter((d) => d.kind === kind);
const project = (patch) => ({ ...createProject(), id: 'p_golden', title: 'golden', key: null, meta: META, ...patch });
const asDevices = (list) => Object.fromEntries(list.map((d) => [d.id, { ...d, created: STAMP, modified: STAMP }]));

function instrumentScene(def, devices = {}, params = {}, suffix = '') {
  const drums = def.cat === 'drums';
  const beats = drums ? DRUM_PHRASE_BEATS : PHRASE_BEATS;
  return {
    name: 'inst:' + def.id + suffix, browser: true, opts: { from: 0, to: beats, tail: 2 }, assets: {},
    project: project({
      title: def.id + ' test phrase', tempo: PHRASE_BPM, devices,
      tracks: [{ id: 't_golden', name: 'Phrase', kind: 'instrument', instrument: { device: def.id, params }, inserts: [],
        clips: [{ id: 'c_phrase', kind: 'notes', start: 0, length: beats, notes: notes(drums ? drumPhrase() : phrase()), by: 'overdub' }],
        gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }],
    }),
  };
}

let STRUM = null;
function effectScene(def, devices = {}) {
  if (!STRUM) STRUM = diStrum(8);
  return {
    name: 'fx:' + def.id, browser: true, opts: { from: 0, to: 16, tail: 4 },
    assets: { a_distrm: { sr: 48000, channels: [STRUM] } },
    project: project({
      title: def.id + ' on the DI strum', tempo: 120, devices,
      assets: { a_distrm: { kind: 'audio', name: 'DI strum', sr: 48000, channels: 1, duration: 8 } },
      tracks: [{ id: 't_golden', name: 'Guitar', kind: 'audio', instrument: null,
        inserts: [{ id: 'fx_golden', device: def.id, on: true, params: {}, by: 'overdub' }],
        clips: [{ id: 'c_strum', kind: 'audio', start: 0, length: 16, asset: 'a_distrm', offset: 0, gain: 0, by: 'overdub' }],
        gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }],
    }),
  };
}

// automation: lanes on a track's fader and pan and on a kernel insert's cutoff and resonance
function automationScene() {
  const chord = [{ p: 45, t: 0, d: 16, v: 0.8 }, { p: 57, t: 0, d: 16, v: 0.7 }, { p: 64, t: 0, d: 16, v: 0.7 }, { p: 69, t: 8, d: 8, v: 0.7 }];
  return {
    name: 'automation', browser: true, opts: { from: 0, to: 16, tail: 2 }, assets: {},
    project: project({
      title: 'automation', tempo: 120,
      tracks: [{ id: 't_golden', name: 'Pad', kind: 'instrument', instrument: { device: 'core.pad', params: {} },
        inserts: [{ id: 'fx_golden', device: 'core.filter', on: true, params: { cutoff: 600, lfo: 0 }, by: 'overdub',
          auto: {
            cutoff: { points: [{ t: 0, v: 300 }, { t: 6, v: 6000, c: 0.5 }, { t: 8, v: 6000 }, { t: 8, v: 900 }, { t: 12, v: 2500, c: -0.5 }, { t: 16, v: 400 }], by: 'overdub' },
            reso: { points: [{ t: 0, v: 0.2, c: 'step' }, { t: 10, v: 0.6 }], by: 'overdub' },
          } }],
        clips: [{ id: 'c_pad', kind: 'notes', start: 0, length: 16, notes: notes(chord), by: 'overdub' }],
        gain: -6, pan: 0, mute: false, solo: false, arm: false, by: 'overdub',
        auto: { gain: { points: [{ t: 0, v: -48 }, { t: 4, v: -6 }, { t: 14, v: -6 }, { t: 16, v: -30 }], by: 'overdub' }, pan: { points: [{ t: 2, v: -0.7 }, { t: 12, v: 0.7, c: 0.3 }], by: 'overdub' } } }],
    }),
  };
}

// sidechain: a bass and a pad ducking under kicks through Dim Switch's key (strip.js keyPlan). The bass comes before
// the kick in track order, so the key's order is tested; the pad's key is a muted "ghost" kick, rendered and not heard
function sidechainScene() {
  const four = (p) => notes(Array.from({ length: 8 }, (_, i) => ({ p, t: i, d: 0.25, v: 0.9 })));
  const tr = (id, name, device, params, clipNotes, extra = {}) => ({ id, name, kind: 'instrument', instrument: { device, params }, inserts: [],
    clips: [{ id: 'c_' + id.slice(2), kind: 'notes', start: 0, length: 8, notes: clipNotes, by: 'overdub' }], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub', ...extra });
  const bass = tr('t_bass', 'Bass', 'core.bass', {}, notes([{ p: 33, t: 0, d: 4, v: 0.9 }, { p: 36, t: 4, d: 4, v: 0.9 }]), { gain: -3 });
  bass.inserts = [{ id: 'fx_duckb', device: 'core.ducker', on: true, params: { depth: 10, attack: 1, hold: 15, release: 160, curve: 0.2, thresh: -30, key_lo: 30, key_hi: 150 }, key: { track: 't_kick' }, by: 'overdub' }];
  const pad = tr('t_pad', 'Pad', 'core.pad', {}, notes([{ p: 57, t: 0, d: 8, v: 0.7 }, { p: 60, t: 0, d: 8, v: 0.7 }, { p: 64, t: 0, d: 8, v: 0.7 }]), { gain: -6 });
  pad.inserts = [{ id: 'fx_duckp', device: 'core.ducker', on: true, params: { mode: 1, depth: 8, attack: 5, hold: 10, release: 300, thresh: -36 }, key: { track: 't_ghost' }, by: 'overdub' }];
  return {
    name: 'sidechain', browser: true, opts: { from: 0, to: 8, tail: 2 }, assets: {},
    project: project({ title: 'sidechain', tempo: 128, tracks: [bass, tr('t_kick', 'Kick', 'core.drums', {}, four(36)), pad, tr('t_ghost', 'Ghost kick', 'core.drums', {}, notes(Array.from({ length: 4 }, (_, i) => ({ p: 36, t: 2 * i + 1, d: 0.25, v: 1 }))), { mute: true })] }),
  };
}
// master-clean: a loud master that ends in Red Line at -1 dBTP and a clean ceiling (master.clip), no soft clip after it
function masterCleanScene() {
  const sc = sidechainScene();
  const p = JSON.parse(JSON.stringify(sc.project));
  p.title = 'master-clean';
  p.master = { gain: 0, clip: 'clean', inserts: [{ id: 'fx_mlim', device: 'core.limiter', on: true, params: { gain: 9, ceiling: -1, release: 60 }, by: 'overdub' }] };
  return { ...sc, name: 'master-clean', project: p };
}

// the shelf songs pinned as scenes (kernel devices only; tools/demos-test.js renders them in the browser)
const SHELF_SCENES = ['sodium', 'red-eye', 'late-checkout', 'wake-up-call', 'lobby-bar', 'room-service', 'turndown', 'ice-machine', 'vacancy'];

// The demo song with every id replaced by a fixed one (in document order), so it renders the same every time.
export function fixedDemo() {
  const p = demoProject();
  let k = 0;
  const id = (prefix) => `${prefix}_g${String(++k).padStart(5, '0')}`;
  p.id = 'p_golden'; p.meta = { ...p.meta, created: STAMP, modified: STAMP };
  for (const d of Object.values(p.devices)) { d.created = STAMP; d.modified = STAMP; }
  for (const s of p.sections) s.id = id('s');
  for (const t of p.tracks) {
    t.id = id('t');
    for (const x of t.inserts) x.id = id('fx');
    for (const c of t.clips) c.id = id('c');
  }
  for (const x of p.master.inserts) x.id = id('fx');
  return p;
}

// the sampled instruments' scenes: [scene, the files it needs are here]
function sampledScenes() {
  return SAMPLED.map((d) => {
    const hashes = Object.values(d.data || {});
    const tag = '#' + hashes.map((h) => h.slice(7, 19)).join('+');
    return [{ ...instrumentScene(d, {}, {}, tag), data: { ...d.data } }, hashes.every((h) => fs.existsSync(dataPath(h)))];
  });
}
// the scenes skipped because their kernel data hasn't been fetched
export const missingScenes = () => sampledScenes().filter(([, here]) => !here).map(([s]) => s.name);

export function scenes() {
  const out = [];
  for (const d of INSTRUMENTS) out.push(instrumentScene(d));
  for (const [s, here] of sampledScenes()) if (here) out.push(s);
  // core.drums' appended kits, each pinned on its own (the scene above plays the default, FIELD)
  const kit = INSTRUMENTS.find((d) => d.id === 'core.drums');
  if (kit) for (const [k, tag] of [[3, '808'], [4, '909'], [5, 'acoustic-plus']]) out.push(instrumentScene(kit, {}, { kit: k }, ':' + tag));
  // Light Table on two AKWF tables (recorded single cycles: wavetables.js's bank), osc A's POS swept between waves
  const lt = INSTRUMENTS.find((d) => d.id === 'core.wavetable');
  if (lt) {
    const ti = (name) => lt.params.find((q) => q.key === 'a_table').opts.indexOf(name);
    out.push(instrumentScene(lt, {}, { a_table: ti('AKWF VOICE'), a_pos: 0.3, b_table: ti('AKWF BASS'), b_pos: 0.5, b_oct: -1, b_level: 0.35, m1_src: 5, m1_dst: 1, m1_amt: 0.25 }, ':akwf'));
  }
  for (const d of showcase('instrument')) out.push(instrumentScene(d, asDevices([d])));
  for (const d of EFFECTS) out.push(effectScene(d));
  for (const d of showcase('effect')) out.push(effectScene(d, asDevices([d])));
  const demo = fixedDemo();
  out.push({ name: 'demo', browser: false, opts: { from: 0, to: 32, tail: 2 }, assets: {}, project: demo });
  const kern = JSON.parse(JSON.stringify(demo));
  kern.tracks = kern.tracks.filter((t) => t.name !== 'Guitar');
  out.push({ name: 'demo-kernels', browser: true, opts: { from: 0, to: 32, tail: 2 }, assets: {}, project: kern });
  out.push(automationScene());
  out.push(sidechainScene());
  out.push(masterCleanScene());
  for (const id of SHELF_SCENES) {
    const p = demoById(id);
    p.meta = { ...p.meta, created: STAMP, modified: STAMP };
    out.push({ name: 'demo:' + id, browser: false, opts: { from: 0, to: p.loop.end, tail: 2 }, assets: {}, project: p });
  }
  return out;
}
