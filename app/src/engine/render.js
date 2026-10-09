// Offline render: the song (or a range of it, or some tracks) through the same strips, devices and soft clip the
// live engine uses, in an OfflineAudioContext. Every note and audio clip in range is scheduled up front, every
// device is awaited ready, then it renders. Deterministic: the same project renders to the same samples.
//
//   renderProject(project, { from, to, tracks, sr, tail, assets, report, latencyMax, trims }) -> Promise<AudioBuffer>
//     (trims: { [trackId]: dB } at each strip's mute stage, as the live Band level puts them: the Jam room measures with
//     it; nothing else passes it, so a render, an export and the golden hashes never have it)
//   probeLatency(project, { tracks, withMix, sr, report }) -> Promise<{ tracks: { id: s }, max }>   (builds the strips, renders nothing)
//
// Time 0 of the buffer is beat `from` as it enters the tracks; the mix comes out `latency.total` seconds later when
// devices add latency (buffer.latency: { tracks, comp, max, master, total }, as engine.latency reports it live). Every
// track is held back to line up with the latest one (plugin delay compensation: its notes and clips are scheduled
// that much later, as the live engine does). latencyMax (seconds) lines them up to at least that instead: a stem
// rendered alone, given the whole mix's max (probeLatency), comes out on the same samples as it does in the mix, so
// stems line up with each other and sum to the mix. The loop is ignored
// (a render is linear). Notes that started before `from` and still sound at it are started at 0 ("chased"), so a
// render from mid-song doesn't lose a held chord: the live transport chases the same way when it starts somewhere.
// The metronome is never in a render.
// Automation (docs/research/AUTOMATION.md 3.5): every device starts at its lanes' values at `from`; kernel lanes go to
// the worklet as timed segments (schedule.js autoIn, chased at `from`) before rendering starts, so a kernel renders
// them exactly as the Node renderer does; graph devices get set(values, { at }) every 20 ms; gain and pan ramp
// linearly through control points every 128 frames (schedule.js mixGrid, the same numbers the Node renderer uses).

import { Strip, trackSpec, masterSpec, audibility, keyPlan } from './strip.js';
import { gridClock } from './clock.js';
import { notesIn, audioIn, playBuffer, autoIn, lanesOf, mixGrid, laneValue, GRID } from './schedule.js';
import { noteExpr } from '../kernel/expr.js';
import { beatsPerBarOf, frame } from './util.js';

export async function renderProject(p, { from = 0, to, tracks = null, sr = 48000, tail = 2, assets, report = null, latencyMax = 0, trims = null } = {}) {
  const bpm = +p.tempo || 120, spb = 60 / bpm;
  if (!(to > from)) throw new Error(`render: empty range ${from}..${to}`);
  await notHeld();
  const len = Math.max(1, Math.ceil(((to - from) * spb + Math.max(0, tail)) * sr));
  const c = new OfflineAudioContext({ numberOfChannels: 2, length: len, sampleRate: sr });
  const bpb = beatsPerBarOf(p.meter);
  const clock = gridClock(c, { bpm, beatsPerBar: bpb, from, playing: true });
  const opts = { clock, bpm: () => bpm, report, meters: false };

  const master = new Strip(c, { ...opts, id: 'master', master: true, dest: c.destination });
  master.setMix({ gain: +(p.master && p.master.gain) || 0 }, true);
  const clean = !!(p.master && p.master.clip === 'clean');
  master.setClip(clean ? 'clean' : 'soft');
  const heard = audibility(p, tracks);
  // keys: a key source is built even when it isn't heard (it isn't summed), and wired once everything is built
  const plan = keyPlan(p, { heard });
  const strips = new Map();
  const builds = [master.sync(masterSpec(p, { at: from }))];
  // tracks sum into the master through a chain (each node adds one track to the ones before it), so the sum is in
  // track order every time (a node fed 3+ connections sums them in an order that varies between runs)
  let chain = null;
  for (const t of p.tracks || []) {
    if (!heard[t.id] && !plan.needed.has(t.id)) continue;
    const s = new Strip(c, { ...opts, id: t.id, dest: null });
    if (heard[t.id]) {
      const sum = c.createGain();
      if (chain) chain.connect(sum);
      s.out.connect(sum);
      chain = sum;
    }
    s.setMix({ gain: +t.gain || 0, pan: +t.pan || 0, audible: true, trim: (trims && +trims[t.id]) || 0 }, true);
    strips.set(t.id, s);
    builds.push(s.sync(trackSpec(t, { at: from })));
  }
  if (chain) chain.connect(master.head);
  const want = [...strips.keys()];
  // the samples behind audio clips in range
  const clips = audioIn(p, from, to, { fresh: true, tracks: want });
  const bufs = new Map();
  if (clips.length) {
    if (!assets) throw new Error('render: audio clips need the asset store');
    await Promise.all([...new Set(clips.map((a) => a.clip.asset))].map(async (id) => bufs.set(id, await assets.get(id))));
  }
  await Promise.all(builds);
  wireKeys(p, plan, strips);
  // plugin delay compensation: hold every track back to the latest one
  const lat = {}, comp = {};
  let max = Number.isFinite(latencyMax) && latencyMax > 0 ? latencyMax : 0;
  for (const [id, s] of strips) { lat[id] = s.latency(); if (lat[id] > max) max = lat[id]; }
  for (const id of strips.keys()) comp[id] = Math.max(0, Math.round((max - lat[id]) * sr));
  const latency = { tracks: lat, comp, max, master: master.latency(), total: 0 };
  latency.total = latency.max + latency.master;

  const T = (beat) => frame(c, (beat - from) * spb);
  // notes, time-ordered with offs before ons at equal times (a repeated note releases the previous one first)
  const ev = [];
  for (const n of notesIn(p, from, to, { chase: true, tracks: want })) {
    ev.push({ t: T(n.at), on: 1, n });
    ev.push({ t: T(n.off), on: 0, n });
  }
  ev.sort((a, b) => a.t - b.t || a.on - b.on);
  const held = (track) => (comp[track] || 0) / sr; // (plugin delay compensation)
  for (const e of ev) {
    const inst = strips.get(e.n.track) && strips.get(e.n.track).instance('instrument');
    if (!inst) continue;
    const t = e.t + held(e.n.track);
    try {
      if (e.on) inst.noteOn(e.n.note.p, Number.isFinite(e.n.note.v) ? e.n.note.v : 0.8, t, noteExpr(e.n.note, spb, e.n.into));
      else inst.noteOff(e.n.note.p, t);
    } catch (err) { report && report({ kind: 'note', track: e.n.track, message: err.message }); }
  }
  for (const a of clips) {
    const buf = bufs.get(a.clip.asset), s = strips.get(a.track);
    if (!buf) { report && report({ kind: 'asset', track: a.track, asset: a.clip.asset, message: `audio asset "${a.clip.asset}" is missing` }); continue; }
    if (!s) continue;
    playBuffer(c, buf, s.head, { t0: T(a.at) + held(a.track), offset: (+a.clip.offset || 0) + a.into * spb, t1: T(a.end) + held(a.track), gainDb: +a.clip.gain || 0 });
  }
  scheduleLanes(c, p, { from, len, spb, sr, want, strips, master, held });
  const out = await c.startRendering();
  master.dispose();
  for (const s of strips.values()) s.dispose();
  // master.clip 'clean': the ceiling the converter and an export put on it, at 0 dBFS (strip.js setClip)
  if (clean) for (let ch = 0; ch < out.numberOfChannels; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) { const v = d[i]; if (v > 1) d[i] = 1; else if (v < -1) d[i] = -1; } }
  out.latency = latency;
  return out;
}

// Wire each keyed insert's key input to its source strip's key tap (keyPlan), and tell it whether it has one.
// strips: Map(track id -> Strip). Returns the links made: [{ insert, inst, tap }].
export function wireKeys(p, plan, strips) {
  const links = [];
  for (const t of (p && p.tracks) || []) {
    const s = strips.get(t.id);
    if (!s) continue;
    for (const x of t.inserts || []) {
      if (!plan.keyOf.has(x.id)) continue;
      const inst = s.instance(x.id);
      if (!inst || !inst.keyInput) continue;
      const id = plan.keyOf.get(x.id), src = id ? strips.get(id) : null;
      if (src) { src.keyTap().connect(inst.keyInput); links.push({ insert: x.id, inst, tap: src.keyTap() }); }
      inst.setKey(!!src);
    }
  }
  return links;
}

// A device check gave up on a render that hasn't ended (kernel/check.js heldRenders: a process() that never returns).
// Chrome renders every offline context on one worklet thread, so a render now would wait behind it for good, and
// loading its worklets would block the page: an export, a reference compare or arrange_around says so instead.
// (The check is imported only when a render asks, so rendering doesn't load it.)
async function notHeld() {
  const n = await import('../kernel/check.js').then((m) => m.heldRenders(), () => 0);
  if (n) throw new Error('the audio thread is still held by a device check\'s render that hasn\'t finished: try again in a moment, or reload the studio');
}

export const GRAPH_STEP = 0.02; // seconds between a graph device's automation points

// Every lane in the render, handed over before it starts (see the header). held(track): its compensation in seconds.
function scheduleLanes(c, p, { from, len, spb, sr, want, strips, master, held }) {
  const lanes = lanesOf(p, { tracks: [...want, 'master'] });
  if (!lanes.length) return;
  const T = (beat) => frame(c, (beat - from) * spb);
  const stripOf = (track) => (track === 'master' ? master : strips.get(track));
  const hOf = (track) => (track === 'master' ? 0 : held(track));
  // kernels: segments
  for (const g of autoIn(p, from, from + len / sr / spb, { chase: true, lanes: lanes.filter((L) => L.kind === 'device') })) {
    const s = stripOf(g.track), inst = s && s.instance(g.insert);
    if (!inst || !inst.auto) continue;
    const h = hOf(g.track);
    inst.auto({ key: g.param, time: T(g.at) + h, end: T(g.end) + h, a: g.a, b: g.b, c: g.c, start: T(g.start) + h });
  }
  // graph devices: one merged set() per device every GRAPH_STEP
  const graph = new Map();
  for (const L of lanes) {
    if (L.kind !== 'device') continue;
    const s = stripOf(L.track), inst = s && s.instance(L.insert);
    if (!inst || inst.auto || !inst.set) continue;
    if (!graph.has(inst)) graph.set(inst, { L: [], track: L.track, insert: L.insert });
    graph.get(inst).L.push(L);
  }
  for (const [inst, w] of graph) {
    const spec = (w.track === 'master' ? masterSpec(p, { at: from }) : trackSpec(p.tracks.find((t) => t.id === w.track), { at: from }));
    const base = w.insert === 'instrument' ? spec.instrument && spec.instrument.params : (spec.inserts.find((x) => x.id === w.insert) || {}).params;
    const h = hOf(w.track), dur = len / sr;
    for (let t = GRAPH_STEP; t < dur; t += GRAPH_STEP) {
      const v = { ...(base || {}) }, beat = from + (t - h) / spb;
      for (const L of w.L) { const x = laneValue(L.lane, beat, L.spec); if (x != null) v[L.param] = x; }
      try { inst.set(v, { at: t }); } catch { /* a device that can't take it */ }
    }
  }
  // gain and pan: linear ramps through the 128-frame grid
  const n = Math.ceil(len / GRID);
  const ramp = (param, G) => {
    param.cancelScheduledValues(0);
    param.setValueAtTime(G[0], 0);
    for (let k = 1; k <= n; k++) param.linearRampToValueAtTime(G[k], (k * GRID) / sr);
  };
  for (const L of lanes) {
    if (L.kind !== 'mix') continue;
    const s = stripOf(L.track);
    if (!s) continue;
    const h = hOf(L.track);
    const G = mixGrid(L.lane, L.param, n, (fr) => from + (fr / sr - h) / spb);
    if (L.param === 'gain') ramp(s.fader.gain, G.g);
    else if (s.panL) { ramp(s.panL.gain, G.l); ramp(s.panR.gain, G.r); }
  }
}

// Each heard track's plugin latency (seconds) and the latest, as renderProject's delay compensation would see them,
// without rendering: the strips are built on a tiny offline context, read and thrown away. tracks: these ids (default
// the ones the mix hears); withMix: these and the ones the mix hears.
export async function probeLatency(p, { tracks = null, withMix = false, sr = 48000, report = null } = {}) {
  await notHeld();
  const bpm = +p.tempo || 120;
  const c = new OfflineAudioContext({ numberOfChannels: 2, length: 128, sampleRate: sr });
  const clock = gridClock(c, { bpm, beatsPerBar: beatsPerBarOf(p.meter), from: 0, playing: true });
  const opts = { clock, bpm: () => bpm, report, meters: false };
  const only = audibility(p, tracks), mix = withMix && tracks ? audibility(p) : {};
  const heard = Object.fromEntries((p.tracks || []).map((t) => [t.id, !!(only[t.id] || mix[t.id])]));
  const strips = new Map();
  try {
    const builds = [];
    for (const t of p.tracks || []) {
      if (!heard[t.id]) continue;
      const s = new Strip(c, { ...opts, id: t.id, dest: null });
      strips.set(t.id, s);
      builds.push(s.sync(trackSpec(t)));
    }
    await Promise.all(builds);
    const lat = {};
    let max = 0;
    for (const [id, s] of strips) { lat[id] = s.latency(); if (lat[id] > max) max = lat[id]; }
    return { tracks: lat, max };
  } finally {
    for (const s of strips.values()) s.dispose();
  }
}
