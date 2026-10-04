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
//   demo:<id>   a song from the demo shelf (only those listed in SHELF_SCENES), whole, as demoById builds it (its ids
//               are stable already), its timestamps pinned. Each scene is pinned on purpose, not the whole shelf.
//
// `browser: true` marks the kernel-only scenes tools/golden-test.js also renders in Chromium's OfflineAudioContext.
import { INSTRUMENTS, EFFECTS } from '../app/src/devices/builtin/index.js';
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

export function scenes() {
  const out = [];
  for (const d of INSTRUMENTS) out.push(instrumentScene(d));
  // core.drums' appended kits, each pinned on its own (the scene above plays the default, FIELD)
  const kit = INSTRUMENTS.find((d) => d.id === 'core.drums');
  if (kit) for (const [k, tag] of [[3, '808'], [4, '909'], [5, 'acoustic-plus']]) out.push(instrumentScene(kit, {}, { kit: k }, ':' + tag));
  for (const d of showcase('instrument')) out.push(instrumentScene(d, asDevices([d])));
  for (const d of EFFECTS) out.push(effectScene(d));
  for (const d of showcase('effect')) out.push(effectScene(d, asDevices([d])));
  const demo = fixedDemo();
  out.push({ name: 'demo', browser: false, opts: { from: 0, to: 32, tail: 2 }, assets: {}, project: demo });
  const kern = JSON.parse(JSON.stringify(demo));
  kern.tracks = kern.tracks.filter((t) => t.name !== 'Guitar');
  out.push({ name: 'demo-kernels', browser: true, opts: { from: 0, to: 32, tail: 2 }, assets: {}, project: kern });
  out.push(automationScene());
  for (const id of SHELF_SCENES) {
    const p = demoById(id);
    p.meta = { ...p.meta, created: STAMP, modified: STAMP };
    out.push({ name: 'demo:' + id, browser: false, opts: { from: 0, to: p.loop.end, tail: 2 }, assets: {}, project: p });
  }
  return out;
}
