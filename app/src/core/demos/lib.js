// What the demo songs are made with: tracks, clips and inserts in the project format, and a seeded groove (swing,
// lay-back, velocity and timing drift) so the house parts sound played rather than pasted. Everything is seeded: the
// same demo builds the same notes every time (only the ids differ), so its renders and measurements are repeatable.
//
//   rng(seed) -> () => 0..1              mulberry32
//   clip(start, length, notes, name, by) a notes clip, every note signed `by`
//   track({ name, color, device, params, inserts, clips, gain, pan, by })
//   fx(device, params?, by?)             an insert
//   bars(n, fn(bar) -> notes, len = 4)   fn's notes for each bar, laid end to end
//   grid(rows, bar?)                     a 16-step drum bar ({ kick: 'x...', ... }, accents as music.parseGrid)
//   groove(notes, opts)                  swing, push/lay-back per pitch, velocity and timing drift (seeded)
//   chordHits(voicing, hits)             a chord on each [t, d, v] hit
//   demo({ ... })                        a project: authors, sections, loop, master
//   automate(p, by, ops)                 automation lanes, written with the auto ops (core/ops.js) as `by` would send
//                                        them; an op's insert may name its device ('core.filter': the track's first)
//   built(project, steps)                a song made wholly of ops through the store (store.dispatch validates each,
//                                        as it does an agent's): steps [[by, label, ops], ...], one undo step each
//   preset(device, name, extra?)         a built-in preset's params (registry), with extra on top

import { createProject, newId, idNotes } from '../project.js';
import { normNote } from '../music.js';
import { applyOp } from '../ops.js';
import { createStore } from '../store.js';
import { getDevice, presetParams } from '../../devices/registry.js';

export const HOUSE = 'overdub';
export const AGENT = 'claude';

export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clip = (start, length, notes, name, by = HOUSE) =>
  idNotes({ id: newId('c'), kind: 'notes', start, length, name, by, notes: notes.map((n) => ({ ...normNote(n), by })) });

export const fx = (device, params = {}, by = HOUSE) => ({ id: newId('fx'), device, on: true, params, by });

export function track({ name, color, device, params = {}, inserts = [], clips = [], gain = 0, pan = 0, by = HOUSE }) {
  return { id: newId('t'), name, color, kind: 'instrument', instrument: { device, params }, inserts, clips, gain, pan, mute: false, solo: false, arm: false, by };
}

// fn(bar) -> notes in that bar (t from 0); returns them all, offset bar by bar
export function bars(n, fn, len = 4) {
  const out = [];
  for (let b = 0; b < n; b++) for (const x of fn(b) || []) out.push({ ...x, t: x.t + b * len });
  return out;
}

const DRUM = { kick: 36, rim: 37, snare: 38, clap: 39, hat: 42, pedal: 44, open: 46, crash: 49, ride: 51, tamb: 54, shaker: 70, tom: 45, ltom: 43, htom: 50 };
const HIT = { X: 1, x: 0.8, O: 0.6, o: 0.45, '-': 0.3 };
// one bar of drums from 16-step rows; d is short so hats don't hang over
export function grid(rows) {
  const out = [];
  for (const [name, row] of Object.entries(rows)) {
    const p = DRUM[name] ?? Number(name);
    const cells = row.replace(/[\s|]/g, '');
    for (let i = 0; i < cells.length; i++) if (HIT[cells[i]]) out.push({ p, t: i * 0.25, d: 0.2, v: HIT[cells[i]] });
  }
  return out;
}

// The feel. swing: where the off 16th lands inside its 8th (0.5 straight, 0.58 the lazy swing of an old sampler);
// push: beats of lean per pitch (+ late, - early: a laid-back snare, a pushed hat); vel / time: the size of the seeded
// drift.
export function groove(notes, { seed = 1, swing = 0.5, push = {}, vel = 0.06, time = 0.008, step = 0.25 } = {}) {
  const R = rng(seed);
  return notes.map((n) => {
    let t = n.t;
    const pos = t / step;
    if (Math.abs(pos - Math.round(pos)) < 1e-6 && Math.round(pos) % 2 === 1) t += (swing - 0.5) * 2 * step;
    t += (push[n.p] || 0) + (R() * 2 - 1) * time;
    const v = Math.min(1, Math.max(0.05, n.v * (1 + (R() * 2 - 1) * vel)));
    return { ...n, t: Math.max(0, t), v };
  });
}

// a voicing on each hit: [[t, d, v], ...], with an optional strum (beats between strings, low to high)
export function chordHits(voicing, hits, { strum = 0 } = {}) {
  const out = [];
  for (const [t, d, v] of hits) voicing.forEach((p, i) => out.push({ p, t: t + i * strum, d: Math.max(0.05, d - i * strum), v }));
  return out;
}

export function demo({ title, tempo, key, sections, tracks, master, bars: n }) {
  const now = new Date().toISOString();
  return createProject({
    title, tempo, key,
    loop: { on: true, start: 0, end: n * 4 },
    sections: sections.map(([name, start, length]) => ({ id: newId('s'), name, start: start * 4, length: length * 4 })),
    tracks,
    master,
    meta: { created: now, modified: now, authors: { [HOUSE]: { kind: 'house', name: 'Overdub' }, [AGENT]: { kind: 'agent', name: 'Claude' } } },
  });
}

// Lanes go on through the same ops the store applies (auto.write, auto.set), signed `by`, so a demo's automation is
// exactly what an agent or a person drawing would have left. { track: 'Loop', insert: 'core.filter', param: 'cutoff',
// points: '0:300 16:2500~0.4' }: the insert by its device (the track's first of it), or 'instrument', or none for
// the mixer's gain and pan.
export function automate(p, by, ops) {
  const ctx = { by, refs: {}, getDevice: null, doc: p, restore: false, noteSeq: new Map() };
  for (const op of ops) {
    const o = { type: 'auto.write', ...op };
    if (o.insert && o.insert !== 'instrument' && !/^fx_/.test(o.insert)) {
      const list = o.track === 'master' ? p.master.inserts : p.tracks.find((t) => t.name === o.track)?.inserts || [];
      const fx = list.find((x) => x.device === o.insert);
      if (!fx) throw new Error(`${o.track} has no ${o.insert} insert`);
      o.insert = fx.id;
    }
    applyOp(p, o, ctx);
  }
  return p;
}

// A song made the way a person or an agent makes one: every change an op, dispatched through the store, which checks
// each one (a device that isn't there, a key that would loop) and signs it. The house's parts are 'overdub' and
// Claude's 'claude'. The project comes back as the store holds it.
export function built(project, steps) {
  const store = createStore(project, { getDevice });
  for (const [by, label, ops] of steps) {
    const r = store.dispatch(ops, { by, label });
    if (!r.ok) throw new Error(`${project.title}: "${label}" was refused: ${r.error}`);
  }
  return store.get();
}
export function preset(device, name, extra = {}) {
  const p = presetParams(device, name);
  if (!p) throw new Error(`${device} has no preset "${name}"`);
  return { ...p, ...extra };
}
