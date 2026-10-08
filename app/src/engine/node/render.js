// The canonical renderer: a song rendered sample by sample in plain JS, with no Web Audio at all. This is what
// "deterministic" means in Overdub: the same song JSON gives the same samples, bit for bit, every run, on any machine
// running the same JS engine (golden hashes in tools/golden.json). The browser's OfflineAudioContext render
// (engine/render.js) is the preview: it is measured to agree with this one within -90 dBFS for kernel devices
// (tools/golden-test.js).
//
//   import { renderSong } from './engine/node/render.js';
//   const r = renderSong(project, { from = 0, to = songEnd, tracks = null, sr = 48000, tail = 2, assets, graph, latencyMax })
//   (latencyMax, seconds: hold tracks back to at least this, as engine/render.js does for stems)
//   r = { sr, length, channels: [L, R] (Float32Array), from, to, warnings: [{ kind, track?, insert?, device?, message }],
//         skipped: { tracks: [id], inserts: [id] }, devices: { kernel, graph, missing },
//         latency: { tracks: { id: s }, comp: { id: samples }, max, master, total } }
//
// It runs the SAME code the studio's AudioWorklet runs: kernel/worklet.js's KernelCore (compiling, voices, stealing,
// the note queue, param smoothing, the transport) with the same dsp stdlib, in 128-frame blocks from frame 0. Around
// it, it mirrors the engine's graph (engine/strip.js, engine/render.js) step for step, in float32:
//   track:  [instrument | audio clips] -> inserts (kernel effects: feed / wet / dry as kernel/host.js wires them)
//           -> fader (track gain) -> balance pan (cosine law: centre is unity on both sides) -> sum, in track order
//   (plugin delay compensation: a track's notes and clips are held back by the latest track's latency less its own,
//   whole samples, as the engine schedules them)
//   master: sum -> master inserts -> fader (master gain) -> safety soft clip (the WaveShaper's curve, interpolated
//           the way Chrome interpolates it), or with master.clip 'clean' a hard ceiling at 0 dBFS
//   keys (sidechains, strip.js keyPlan): every strip renders its block in key order, each key source before the tracks
//           it keys, into its own buffers; a keyed insert reads its source's (after its inserts, before its fader); the
//           sum is still in track order, so a song without keys renders exactly as before. A key source that isn't
//           heard (muted, soloed out, not in `tracks`) is rendered and not summed
// Notes come from engine/schedule.js's notesIn (the same chase, the same note-off-before-note-on order at one time).
//
// Graph devices (pedals and amps: Web Audio node graphs) cannot run here. An insert that names one is bypassed (its
// input passes through) and a track whose instrument is one is skipped; each is reported in `warnings`. Pass
// graph: 'error' to throw instead. Missing devices and kernels that fail to compile are treated the same way.
//
// Automation (docs/research/AUTOMATION.md 3.5): a kernel's lanes go to its KernelCore as the same 'auto' messages the
// worklet gets (engine/schedule.js's autoIn, chased at `from`), so they render bit for bit as the studio's kernels do;
// gain and pan lanes are control points every 128 frames (schedule.js mixGrid), interpolated per sample the way a Web
// Audio linear ramp is. A graph device's lanes go with the device (bypassed). Every device starts at its lanes' values
// at `from`.
//
// Audio clips play their samples from `assets` ({ [assetId]: { sr, channels: [Float32Array] } }); a missing asset is
// a warning and silence.
//
// Kernel data (docs/DEVICES.md "Kernel data"): a device whose def names files ({ kit: 'sha256-<hex>' }) gets them from
// app/kits/ (engine/node/data.js, read once, checked against the hash). A file that isn't there is a warning
// (kind 'data') and the kernel gets null: a sampled kit plays nothing.

import { kernelCore, kernelCompiler } from '../../kernel/worklet.js';
import { kernelSpecs } from '../../kernel/host.js';
import { noteExpr } from '../../kernel/expr.js';
import { makeDsp } from '../../kernel/dsp.js';
import { getDevice, normParam, paramValues, seedOf } from '../../devices/registry.js';
import '../../devices/builtin/index.js';
import '../../devices/library/index.js'; // the house shelf of agent-built kernels (claude.*), which songs can use
import '../../devices/guitar/index.js'; // registered so they are named and reported as graph devices, never run
import { cleanProject, songEnd as projectSongEnd } from '../../core/project.js';
import { notesIn, audioIn, autoIn, lanesOf, mixGrid, GRID } from '../schedule.js';
import { audibility, trackSpec, masterSpec, softClipCurve, SC_K, keyPlan } from '../strip.js';
import { dbToGain, beatsPerBarOf } from '../util.js';
import { dataFor } from './data.js';
import { normData } from '../../kernel/odk.js';

export const Q = 128;   // the render quantum: kernels see exactly the blocks the AudioWorklet sees
const f32 = Math.fround;
const cores = new Map(); // sr -> KernelCore class

function coreClass(sr) {
  let K = cores.get(sr);
  if (!K) { K = kernelCore(sr, makeDsp(sr), kernelCompiler); cores.set(sr, K); }
  return K;
}

// The song's end in beats, as the engine reckons it (whole bars, at least one).
export function songEnd(p) {
  const bpb = beatsPerBarOf(p.meter);
  let end;
  try { end = projectSongEnd(p); } catch (e) { end = 0; for (const t of p.tracks || []) for (const c of t.clips || []) end = Math.max(end, c.start + c.length); }
  return Math.max(bpb, Math.ceil(end / bpb - 1e-9) * bpb);
}

// A hand-written song may leave ids out. The studio would invent random ones, and ids seed the devices, so here they
// are filled in from positions instead (and reported): the render still repeats.
function fixIds(p, warn) {
  const q = JSON.parse(JSON.stringify(p));
  const pad = (i) => String(i).padStart(4, '0');
  (q.tracks || []).forEach((t, i) => {
    if (!t.id) { t.id = 't_x' + pad(i).slice(1) + 'x'; warn({ kind: 'id', track: t.id, message: `track ${i + 1} ("${t.name || ''}") had no id: using ${t.id} (ids seed devices; save the song from the studio to keep them)` }); }
    (t.inserts || []).forEach((x, j) => { if (!x.id) { x.id = `fx_${pad(i)}${String(j).padStart(2, '0')}`.slice(0, 9); warn({ kind: 'id', track: t.id, insert: x.id, message: `an insert on ${t.id} had no id: using ${x.id}` }); } });
    (t.clips || []).forEach((c, j) => { if (!c.id) c.id = `c_${pad(i)}${String(j).padStart(2, '0')}`.slice(0, 8); });
  });
  ((q.master && q.master.inserts) || []).forEach((x, j) => { if (!x.id) { x.id = `fx_m${String(j).padStart(5, '0')}`; warn({ kind: 'id', insert: x.id, message: `a master insert had no id: using ${x.id}` }); } });
  return q;
}

// The def for a device id: a kernel written in this song (project.devices) wins over the registry, as in the studio
// (main.js registers project devices with replace).
function resolver(p) {
  const local = new Map();
  for (const src of Object.values(p.devices || {})) {
    if (!src || !src.id) continue;
    local.set(src.id, { ...src, params: (src.params || src.knobs || []).map(normParam), flavour: src.build ? 'graph' : 'kernel' });
  }
  return (id) => local.get(id) || getDevice(id);
}

// One kernel device, hosted the way kernel/host.js hosts it. Returns null (and warns) if it can't run here.
function kernelDevice(def, kind, { uid, params, on = true, bpm, from, sr, warn, where, key = false }) {
  const K = coreClass(sr);
  const values = paramValues(def, params || {});
  let failed = null;
  const post = (m) => {
    if (!m) return;
    if (m.type === 'error') {
      if (m.stage === 'compile') failed = m.message;
      else warn({ kind: 'fault', ...where, device: def.id, message: `${def.id} stopped: ${m.message}` });
    }
  };
  const data = dataFor(def.data);
  if (data) for (const [k, v] of Object.entries(data)) if (!v) warn({ kind: 'data', ...where, device: def.id, message: `${def.id} plays nothing: its ${k} (${normData(def.data)[k].slice(0, 19)}...) isn't in app/kits/ (node tools/fetch-kits.js fetches it)` });
  const core = new K({ source: def.kernel, kind, params: kernelSpecs(def), values, poly: def.poly, seed: seedOf(uid) >>> 0,
    transport: { bpm, playing: true, beat: from, time: 0 }, data, ...(key ? { key: true, keyOn: false } : {}) }, post);
  if (failed || !core.cur) {
    warn({ kind: 'error', ...where, device: def.id, message: `${def.id} failed to build: ${failed || 'no kernel'} (${kind === 'instrument' ? 'track skipped' : 'bypassed'})` });
    return null;
  }
  // what makeInstance does next: the params again (snapped), then the tempo
  core.msg({ type: 'params', values, jump: true });
  core.msg({ type: 'transport', bpm, playing: true, beat: from, time: 0 });
  return core;
}

// What a kernel reports as its latency, in seconds, the way kernel/host.js's Instance.latency does.
function kernelLatency(core, def, sr, on = true) {
  if (!on) return +def.latency || 0; // (a bypassed effect is its dry path, delayed by the declared latency)
  return ((core.cur && +core.cur.latency) || 0) / sr || +def.latency || 0;
}

// An insert: kernel/host.js's effect wiring. input -> feed -> kernel -> wet -> out, input -> dry (-> latency delay) -> out.
function effectChain(def, ins, ctx) {
  const core = kernelDevice(def, 'effect', { ...ctx, uid: ins.id, params: ins.params, on: ins.on, where: ctx.where, key: def.key === true });
  if (!core) return null;
  const on = ins.on !== false, trails = !!def.trails;
  // (bypassed: the input goes round the kernel; a trails device keeps its wet path open so a tail rings out)
  const feed = on ? 1 : 0, wet = on ? 1 : (trails ? 1 : 0), dry = on ? 0 : 1;
  const iL = new Float32Array(Q), iR = new Float32Array(Q), oL = new Float32Array(Q), oR = new Float32Array(Q);
  // the dry path's latency delay (a DelayNode of def.latency seconds: linear interpolation between frames)
  const lat = +def.latency || 0;
  const dly = dry && lat > 0 ? delayLine(f32(lat) * ctx.sr) : null;
  return {
    core,
    latency: kernelLatency(core, def, ctx.sr, on),
    // key: the strip this insert's key hears (its L and R after its inserts), or null
    key: null,
    run(L, R, f0) {
      if (feed) { iL.set(L); iR.set(R); } else { iL.fill(0); iR.fill(0); }
      const k = this.key;
      if (k) core.block(iL, iR, oL, oR, f0, k.L, k.R); else core.block(iL, iR, oL, oR, f0);
      if (dry === 0) { // on: the wet path alone (the dry gain is 0)
        if (wet === 1) { L.set(oL); R.set(oR); } else { L.fill(0); R.fill(0); }
        return;
      }
      if (dly) dly.run(L, R);
      for (let i = 0; i < Q; i++) { L[i] = f32(wet * oL[i] + L[i]); R[i] = f32(wet * oR[i] + R[i]); }
    },
  };
}

function delayLine(d) {
  const N = 1 << 16, bl = new Float32Array(N), br = new Float32Array(N), di = Math.floor(d), fr = d - di;
  let w = 0;
  return {
    run(L, R) {
      for (let i = 0; i < Q; i++) {
        bl[w & (N - 1)] = L[i]; br[w & (N - 1)] = R[i];
        const a = (w - di) & (N - 1), b = (w - di - 1) & (N - 1);
        L[i] = f32(bl[a] + (bl[b] - bl[a]) * fr); R[i] = f32(br[a] + (br[b] - br[a]) * fr);
        w++;
      }
    },
  };
}

// An audio clip, as engine/schedule.js's playBuffer plays it: a buffer source from `offset` seconds, through a gain
// envelope that ramps in and out over 3 ms, from frame t0 to t1.
function clipVoice(asset, { f0: s0, offset, f1: s1, gain, sr }) {
  const g = f32(gain), ch = asset.channels, bsr = asset.sr, rate = bsr / sr;
  const t0 = s0 / sr, t1 = s1 / sr, fd = Math.min(0.003, (t1 - t0) / 2);
  const len = ch[0].length;
  const env = (k) => {
    const t = k / sr;
    if (t < t0) return 0;
    if (t < t0 + fd) return f32(g * (t - t0) / fd);
    if (t < t1 - fd) return g;
    if (t < t1) return f32(g + (0 - g) * (t - (t1 - fd)) / fd);
    return 0;
  };
  const read = (x, pos) => {
    const i = Math.floor(pos), fr = pos - i;
    if (i >= len) return 0;
    const a = x[i], b = i + 1 < len ? x[i + 1] : 0;
    return fr === 0 ? a : f32(a + (b - a) * fr);
  };
  const stopAt = Math.ceil((t1 + 0.001) * sr);
  return {
    s0, end: stopAt,
    add(L, R, f0) {
      const a = Math.max(f0, s0), b = Math.min(f0 + Q, stopAt);
      for (let k = a; k < b; k++) {
        const pos = offset * bsr + (k - s0) * rate;
        if (pos >= len) break;
        const e = env(k);
        const l = read(ch[0], pos), r = ch.length > 1 ? read(ch[1], pos) : l;
        L[k - f0] = f32(L[k - f0] + f32(l * e)); R[k - f0] = f32(R[k - f0] + f32(r * e));
      }
    },
  };
}

// The safety soft clip: pre-gain 1/SC_K into a WaveShaper with no oversampling, computed as Chrome computes it (in
// float32: index = (x + 1) * (n - 1) / 2, clamped, then a linear interpolation between curve points).
function softClipper() {
  const curve = softClipCurve(), n = curve.length, half = f32(0.5 * (n - 1)), pre = f32(1 / SC_K), top = n - 1;
  return (x) => {
    let v = f32(f32(f32(x * pre) + 1) * half);
    if (!(v > 0)) v = 0; else if (v > top) v = top;
    const i = Math.floor(v), j = i + 1 > top ? top : i + 1, k = f32(v - i);
    const a = curve[i], b = curve[j];
    return f32(a + f32(k * f32(b - a)));
  };
}

// master.clip 'clean': nothing between the master fader and the output but a hard ceiling at +-1.0 (what the browser's
// destination and every export do to a sample over full scale; engine/strip.js)
const cleanClip = (x) => (x > 1 ? 1 : x < -1 ? -1 : x);

export function renderSong(project, { from = 0, to, tracks = null, sr = 48000, tail = 2, assets = null, graph = 'bypass', latencyMax = 0 } = {}) {
  const warnings = [];
  const warn = (w) => warnings.push(w);
  const p = cleanProject(fixIds(project, warn));
  if (to == null) to = songEnd(p);
  if (!(to > from)) throw new Error(`render: empty range ${from}..${to}`);
  const bpm = +p.tempo || 120, spb = 60 / bpm;
  const len = Math.max(1, Math.ceil(((to - from) * spb + Math.max(0, tail)) * sr));
  const def = resolver(p);
  const skipped = { tracks: [], inserts: [] };
  const counts = { kernel: 0, graph: 0, missing: 0 };
  // tracks given by id or exact name
  let only = null;
  if (tracks) {
    only = [];
    for (const want of tracks) {
      const t = p.tracks.find((x) => x.id === want) || p.tracks.find((x) => x.name === want);
      if (!t) throw new Error(`render: no track "${want}" (tracks: ${p.tracks.map((x) => x.name).join(', ')})`);
      only.push(t.id);
    }
  }
  const heard = audibility(p, only);
  // keys: every key source is rendered before the tracks it keys, and rendered even when it isn't heard (strip.js keyPlan)
  const plan = keyPlan(p, { def, heard });
  for (const id of plan.cut) warn({ kind: 'key', insert: id, message: `the key on ${id} would close a loop (a track keying itself through others): it hears silence` });
  const ctx = { bpm, from, sr, warn };

  // Can this device run here? Returns its def, or null after a warning.
  const usable = (id, kind, where) => {
    const d = def(id);
    const what = kind === 'instrument' ? 'the track is skipped' : 'bypassed';
    let why = null;
    if (!d) { why = `no device "${id}"`; counts.missing++; } else if (d.build || d.flavour === 'graph' || typeof d.kernel !== 'string') {
      why = `"${id}" (${d.name || id}) is a graph device (Web Audio nodes), which the Node renderer cannot run`; counts.graph++;
      if (graph === 'error') throw new Error(`render: ${why}`);
    } else if (d.kind !== kind) { why = `"${id}" is an ${d.kind}, not an ${kind}`; counts.missing++; }
    if (why) { warn({ kind: d && (d.build || d.flavour === 'graph') ? 'graph' : 'device', ...where, device: id, message: `${why}: ${what}` }); return null; }
    counts.kernel++;
    return d;
  };
  const chainOf = (spec, where) => {
    const out = [];
    for (const ins of spec.inserts) {
      const w = { ...where, insert: ins.id };
      const d = usable(ins.device, 'effect', w);
      const fx = d && effectChain(d, ins, { ...ctx, where: w });
      if (fx) { fx.id = ins.id; fx.keySrc = plan.keyOf.has(ins.id) ? plan.keyOf.get(ins.id) : undefined; out.push(fx); } else skipped.inserts.push(ins.id);
    }
    return out;
  };

  // the strips
  const strips = [];
  for (const t of p.tracks) {
    if (!heard[t.id] && !plan.needed.has(t.id)) continue;
    const spec = trackSpec(t, { at: from, def }), where = { track: t.id };
    let inst = null, lat = 0;
    if (spec.instrument) {
      const d = usable(spec.instrument.device, 'instrument', where);
      inst = d && kernelDevice(d, 'instrument', { ...ctx, uid: `${t.id}:instrument`, params: spec.instrument.params, where });
      if (!inst) { skipped.tracks.push(t.id); continue; }
      lat += kernelLatency(inst, d, sr);
    }
    const fx = chainOf(spec, where);
    for (const f of fx) lat += f.latency;
    const x = Math.max(-1, Math.min(1, +t.pan || 0));
    strips.push({
      id: t.id, inst, fx, lat, voices: [], events: [], ei: 0, heard: !!heard[t.id], L: new Float32Array(Q), R: new Float32Array(Q),
      fader: f32(dbToGain(+t.gain || 0)),
      panL: f32(x <= 0 ? 1 : Math.cos(x * Math.PI / 2)), panR: f32(x >= 0 ? 1 : Math.cos(-x * Math.PI / 2)),
    });
  }
  const master = { id: 'master', fx: chainOf(masterSpec(p, { at: from, def }), { track: 'master' }), fader: f32(dbToGain(+(p.master && p.master.gain) || 0)) };
  // plugin delay compensation (engine/render.js): every track's notes and clips held back to the latest track
  const latency = { tracks: {}, comp: {}, max: Number.isFinite(latencyMax) && latencyMax > 0 ? latencyMax : 0, master: master.fx.reduce((a, f) => a + f.latency, 0), total: 0 };
  for (const s of strips) { latency.tracks[s.id] = s.lat; if (s.lat > latency.max) latency.max = s.lat; }
  for (const s of strips) latency.comp[s.id] = Math.max(0, Math.round((latency.max - s.lat) * sr));
  latency.total = latency.max + latency.master;
  const held = (track) => latency.comp[track] / sr;
  const byId = new Map(strips.map((s) => [s.id, s]));
  const want = strips.map((s) => s.id);
  // wire the keys: each keyed insert reads its source strip's block (silence, and t.key.on false, when there is none)
  for (const s of strips) for (const fx of s.fx) {
    if (fx.keySrc === undefined) continue;
    const src = fx.keySrc ? byId.get(fx.keySrc) : null;
    fx.key = src || null;
    fx.core.msg({ type: 'key', on: !!src });
  }
  // the order the strips render in (keys first; the sum is still in track order)
  const renderOrder = plan.order.map((id) => byId.get(id)).filter(Boolean);

  // notes: engine/render.js's order (time, then note-offs before note-ons), posted to each kernel a block ahead
  const T = (beat) => Math.round((beat - from) * spb * sr) / sr;
  const ev = [];
  for (const n of notesIn(p, from, to, { chase: true, tracks: want })) {
    ev.push({ t: T(n.at), on: 1, n });
    ev.push({ t: T(n.off), on: 0, n });
  }
  ev.sort((a, b) => a.t - b.t || a.on - b.on);
  for (const e of ev) {
    const s = byId.get(e.n.track);
    if (!s || !s.inst) continue;
    const note = e.n.note, t = e.t + held(s.id);
    s.events.push(e.on
      ? { type: 'on', p: note.p | 0, v: Number.isFinite(note.v) ? +note.v : 0.8, time: t, f: Math.round(t * sr), x: noteExpr(note, spb, e.n.into) }
      : { type: 'off', p: note.p | 0, time: t, f: Math.round(t * sr) });
  }
  // audio clips
  for (const a of audioIn(p, from, to, { fresh: true, tracks: want })) {
    const s = byId.get(a.track);
    const asset = assets && (assets[a.clip.asset] || (assets.get && assets.get(a.clip.asset)));
    if (!asset) { warn({ kind: 'asset', track: a.track, asset: a.clip.asset, message: `audio asset "${a.clip.asset}" is missing: that clip is silent` }); continue; }
    const t0 = T(a.at) + held(a.track), offset = (+a.clip.offset || 0) + a.into * spb;
    const dur = asset.channels[0].length / asset.sr, left = dur - (offset >= 0 ? offset : 0);
    if (left <= 0.001) continue;
    let t1 = Math.min(T(a.end) + held(a.track), t0 + left);
    if (t1 - t0 < 0.002) continue;
    t1 = Math.round(t1 * sr) / sr;
    s.voices.push(clipVoice(asset, { f0: Math.round(t0 * sr), offset: offset >= 0 ? offset : 0, f1: Math.round(t1 * sr), gain: dbToGain(+a.clip.gain || 0), sr }));
  }
  for (const s of strips) s.voices.sort((a, b) => a.s0 - b.s0);
  // automation: kernel lanes as 'auto' messages, up front (the browser's render posts them before it starts too)
  const lanes = lanesOf(p, { tracks: [...want, 'master'], def });
  if (lanes.length) {
    const coreOf = (track, insert) => {
      const s = track === 'master' ? master : byId.get(track);
      if (!s) return null;
      if (insert === 'instrument') return s.inst || null;
      const f = s.fx.find((x) => x.id === insert);
      return f ? f.core : null;
    };
    // (through the tail, as the browser's render does: a cut or a swell after the last clip is part of the ending)
    for (const g of autoIn(p, from, from + len / sr / spb, { chase: true, lanes: lanes.filter((L) => L.kind === 'device') })) {
      const core = coreOf(g.track, g.insert);
      if (!core) continue;
      const h = g.track === 'master' ? 0 : held(g.track);
      core.msg({ type: 'auto', key: g.param, time: T(g.at) + h, end: T(g.end) + h, a: g.a, b: g.b, c: g.c, start: T(g.start) + h });
    }
  }
  // gain and pan lanes: control points on the 128-frame grid (the lane at the beat each point's frame plays)
  const blocksN = Math.ceil(len / Q);
  for (const L of lanes) {
    if (L.kind !== 'mix') continue;
    const s = L.track === 'master' ? master : byId.get(L.track);
    if (!s) continue;
    const h = L.track === 'master' ? 0 : held(L.track);
    const grid = mixGrid(L.lane, L.param, blocksN, (fr) => from + (fr / sr - h) / spb);
    if (L.param === 'gain') s.gGrid = grid.g; else { s.lGrid = grid.l; s.rGrid = grid.r; }
  }
  // a param's value at frame i of block b: the Web Audio linear ramp between grid points b and b + 1
  const ramp = (G, b, out) => { const v0 = G[b], d = G[b + 1] - v0; for (let i = 0; i < Q; i++) out[i] = f32(v0 + d * (i / GRID)); };
  const gB = new Float32Array(Q), lB = new Float32Array(Q), rB = new Float32Array(Q);

  // render, block by block
  const outL = new Float32Array(len), outR = new Float32Array(len);
  const mL = new Float32Array(Q), mR = new Float32Array(Q);
  // the master's end: the safety soft clip, or (master.clip 'clean') a hard ceiling at 0 dBFS, exactly linear below it
  const clip = p.master && p.master.clip === 'clean' ? cleanClip : softClipper();
  const blocks = Math.ceil(len / Q);
  for (let b = 0; b < blocks; b++) {
    const f0 = b * Q;
    mL.fill(0); mR.fill(0);
    for (const s of renderOrder) {
      const L = s.L, R = s.R;
      if (s.inst) {
        const evs = s.events;
        while (s.ei < evs.length && evs[s.ei].f < f0 + 2 * Q) s.inst.msg(evs[s.ei++]);
        s.inst.block(null, null, L, R, f0);
      } else { L.fill(0); R.fill(0); }
      for (const v of s.voices) if (v.s0 < f0 + Q && v.end > f0) v.add(L, R, f0);
      for (const fx of s.fx) fx.run(L, R, f0);
    }
    let first = true;
    for (const s of strips) {
      if (!s.heard) continue;
      const L = s.L, R = s.R;
      const g = s.fader, gl = s.panL, gr = s.panR;
      if (s.gGrid || s.lGrid) {
        if (s.gGrid) ramp(s.gGrid, b, gB); else gB.fill(g);
        if (s.lGrid) { ramp(s.lGrid, b, lB); ramp(s.rGrid, b, rB); } else { lB.fill(gl); rB.fill(gr); }
        for (let i = 0; i < Q; i++) {
          const l = f32(f32(L[i] * gB[i]) * lB[i]), r = f32(f32(R[i] * gB[i]) * rB[i]);
          if (first) { mL[i] = l; mR[i] = r; } else { mL[i] = f32(mL[i] + l); mR[i] = f32(mR[i] + r); }
        }
      } else {
        for (let i = 0; i < Q; i++) {
          const l = f32(f32(L[i] * g) * gl), r = f32(f32(R[i] * g) * gr);
          if (first) { mL[i] = l; mR[i] = r; } else { mL[i] = f32(mL[i] + l); mR[i] = f32(mR[i] + r); }
        }
      }
      first = false;
    }
    for (const fx of master.fx) fx.run(mL, mR, f0);
    const n = Math.min(Q, len - f0), g = master.fader;
    if (master.gGrid) { ramp(master.gGrid, b, gB); for (let i = 0; i < n; i++) { outL[f0 + i] = clip(f32(mL[i] * gB[i])); outR[f0 + i] = clip(f32(mR[i] * gB[i])); } }
    else for (let i = 0; i < n; i++) { outL[f0 + i] = clip(f32(mL[i] * g)); outR[f0 + i] = clip(f32(mR[i] * g)); }
  }
  return { sr, length: len, channels: [outL, outR], from, to, warnings, skipped, devices: counts, latency };
}
