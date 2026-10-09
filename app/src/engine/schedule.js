// What happens in a stretch of the song: the notes that start and the audio clips that play in [from, to) beats.
// Pure functions over the project document, shared by the live scheduler (a slice every 25 ms) and the offline
// renderer (the whole range at once), so both hear the same song. A muted clip (clip.mute) plays in neither, nor in
// the Node renderer, which reads the song through these too.

import { dbToGain, frame, soon } from './util.js';

// Notes whose start is in [from, to). Each: { track, clip, note, at (song beat), off (song beat), key }; a chased
// one also has chased: true and into (the beats it had already sounded: its bend and mod curves start that far in).
//   cut: a beat no note may sound past (the loop end), or Infinity
//   chase: also include notes that started before `from` and still sound at it (offline renders from mid-song)
export function notesIn(p, from, to, { cut = Infinity, chase = false, tracks = null } = {}) {
  const out = [];
  for (const t of p.tracks || []) {
    if (t.kind === 'audio' || !t.instrument) continue;
    if (tracks && !tracks.includes(t.id)) continue;
    for (const c of t.clips || []) {
      if (c.kind !== 'notes' || !Array.isArray(c.notes) || c.mute) continue;
      const cs = +c.start || 0, ce = cs + (+c.length || 0);
      if (ce <= from || cs >= to) continue;
      for (const n of c.notes) {
        if (!n || !Number.isFinite(n.p) || !Number.isFinite(n.t)) continue;
        const at = cs + n.t;
        if (at >= ce || n.t < 0) continue;
        const end = Math.min(at + Math.max(0.001, +n.d || 0.25), ce, cut);
        if (at >= from && at < to) out.push({ track: t.id, clip: c.id, note: n, at, off: end, key: `${c.id}/${n.id}/${at}` });
        else if (chase && at < from && end > from) out.push({ track: t.id, clip: c.id, note: n, at: from, off: end, key: `${c.id}/${n.id}/${at}`, chased: true, into: from - at });
      }
    }
  }
  return out;
}

// The song beat where the last thing the song plays stops sounding: the end of its last note (in a clip that plays,
// cut at its clip's end) or of its last audio clip; 0 when it plays nothing. Muted and unsoloed tracks count (they can
// be unmuted while it plays); muted clips don't (they play nowhere). The live transport stops a bar after it (engine.js).
export function lastSound(p) {
  let end = 0;
  for (const t of p.tracks || []) {
    for (const c of t.clips || []) {
      if (!c || c.mute) continue;
      const cs = +c.start || 0, ce = cs + (+c.length || 0);
      if (c.kind === 'audio') { if (c.asset && ce > end) end = ce; continue; }
      if (c.kind !== 'notes' || !Array.isArray(c.notes) || t.kind === 'audio' || !t.instrument) continue;
      for (const n of c.notes) {
        if (!n || !Number.isFinite(n.p) || !Number.isFinite(n.t) || n.t < 0) continue;
        const at = cs + n.t;
        if (at >= ce) continue;
        const e = Math.min(at + Math.max(0.001, +n.d || 0.25), ce);
        if (e > end) end = e;
      }
    }
  }
  return end;
}

// Audio clips that start in [from, to), or (fresh: after a start, a seek or a loop wrap) are already sounding at
// `from`. Each: { track, clip, at (song beat it starts sounding), into (beats into the clip), end (song beat) }.
export function audioIn(p, from, to, { cut = Infinity, fresh = false, tracks = null } = {}) {
  const out = [];
  for (const t of p.tracks || []) {
    if (tracks && !tracks.includes(t.id)) continue;
    for (const c of t.clips || []) {
      if (c.kind !== 'audio' || !c.asset || c.mute) continue;
      const cs = +c.start || 0, ce = cs + (+c.length || 0);
      const end = Math.min(ce, cut);
      if (cs >= from && cs < to) out.push({ track: t.id, clip: c, at: cs, into: 0, end, key: `${c.id}/a/${cs}` });
      else if (fresh && cs < from && ce > from + 1e-6) out.push({ track: t.id, clip: c, at: from, into: from - cs, end, key: `${c.id}/a/${cs}` });
    }
  }
  return out;
}

export const FADE_OUT = 0.010;   // seconds: how an audio clip stops early, live (docs/ARCHITECTURE.md "Muted clips")

// Start an audio clip on context c: a buffer source through a 3 ms fade in / out at the clip's gain, into `dest`.
//   t0: audio time it starts sounding; offset: seconds into the buffer; t1: audio time it stops
export function playBuffer(c, buffer, dest, { t0, offset = 0, t1, gainDb = 0 }) {
  t0 = frame(c, Math.max(t0, c.currentTime));
  if (!(offset >= 0)) offset = 0;
  const left = buffer.duration - offset;
  if (left <= 0.001) return null;
  t1 = Math.min(t1, t0 + left);
  if (t1 - t0 < 0.002) return null;
  t1 = frame(c, t1);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const env = c.createGain();
  const g = dbToGain(gainDb || 0), f = Math.min(0.003, (t1 - t0) / 2);
  env.gain.value = 0;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(g, t0 + f);
  env.gain.setValueAtTime(g, t1 - f);
  env.gain.linearRampToValueAtTime(0, t1);
  src.connect(env); env.connect(dest);
  src.start(t0, offset);
  src.stop(t1 + 0.001);
  const h = { src, env, t0, t1, stopped: false };
  src.onended = () => { h.stopped = true; try { env.disconnect(); } catch { /* ok */ } };
  // stop early with a short fade (transport stop, seek, the clip muted or deleted under the playhead): `fade` long in
  // util.ramp's sense (an exponential approach with time constant fade / 4: -35 dB at `fade`, -70 dB at twice it),
  // stopped at three times it (-104 dB)
  h.fadeOut = (at = soon(c), fade = FADE_OUT) => {
    if (h.stopped) return;
    const t = Math.max(at, soon(c));
    try {
      if (t <= t0) { src.stop(t0); } else {
        env.gain.cancelScheduledValues(t);
        env.gain.setTargetAtTime(0, t, fade / 4);
        src.stop(t + fade * 3);
      }
    } catch { /* already stopped */ }
  };
  return h;
}

// ---------------------------------------------------------------------------------------------------- automation
// Lanes (docs/research/AUTOMATION.md 3.2; core/automation.js is the model): points { t (song beat), v (the param's
// units), c? (the segment leaving it: a bend in -1..1, or 'step') } stored on what they move: track.auto.gain / .pan,
// track.instrument.auto[key], insert.auto[key], master.auto.gain. A held lane (off) plays its static value. Values
// between points are interpolated in knob travel (core/automation.js toPos / fromPos: log params through their log
// travel, the fader through its console law, pan linearly), and every renderer reads the song through the functions
// below, so they all hear the same curve.
import { getDevice } from '../devices/registry.js';
import { MIXER, paramSpec, toPos as specToPos, fromPos as specFromPos, bend, valueAt, discrete } from '../core/automation.js';

export { bend };
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
export const FADER = MIXER.gain;
export const PAN = MIXER.pan;
// knob travel for a param spec: { toPos(v) -> 0..1, fromPos(pos) -> v } (KernelCore transcribes fromPos)
export function travel(s) {
  return { toPos: (v) => clamp01(specToPos(s, v)), fromPos: (x) => specFromPos(s, x) };
}
// (a switch or a few-setting param steps; a knob with a fine step ramps: core/automation.js discrete)
const stepped = discrete;
// (cached per lane object: the song is never mutated in place, so a lane's points can't change under the cache)
const SORTED = new WeakMap();
const sortedPoints = (lane) => {
  if (!lane || typeof lane !== 'object') return [];
  let s = SORTED.get(lane);
  if (!s || s.src !== lane.points) { s = { src: lane.points, pts: sortPoints(lane) }; SORTED.set(lane, s); }
  return s.pts;
};
const sortPoints = (lane) => (lane && Array.isArray(lane.points) ? lane.points.filter((q) => q && Number.isFinite(+q.t) && Number.isFinite(+q.v)) : [])
  .map((q, i) => [q, i]).sort((x, y) => x[0].t - y[0].t || x[1] - y[1]).map((x) => x[0]);
// a lane's travel position at `beat` (before the first point: the first value; after the last: the last)
export function lanePos(lane, beat, s, tr = travel(s), pts = sortedPoints(lane)) {
  if (!pts.length) return null;
  let i = -1;
  for (let j = 0; j < pts.length && pts[j].t <= beat; j++) i = j;
  if (i < 0) return tr.toPos(+pts[0].v);
  if (i === pts.length - 1) return tr.toPos(+pts[i].v);
  const p0 = pts[i], p1 = pts[i + 1], a = tr.toPos(+p0.v), b = tr.toPos(+p1.v);
  return a + (b - a) * bend((beat - p0.t) / (p1.t - p0.t), stepped(s) ? 'step' : p0.c == null ? 0 : p0.c);
}
// the lane's value at `beat`, in the param's units (null: no points)
export function laneValue(lane, beat, s) {
  return valueAt(lane, beat, s);
}

// Every lane that plays (not held, with points) in the song: [{ track, insert, param, id, lane, spec, kind }].
// insert: 'instrument', an insert id, or null (the mixer: gain, pan; the master: gain). kind: 'mix' | 'device'.
// def(id): the device def (default the registry); a param a device marks auto: false gets no lane.
export function lanesOf(p, { tracks = null, def = getDevice } = {}) {
  const out = [];
  const specOf = (device, key) => {
    const d = def(device);
    const q = d && (d.params || []).find((x) => (Array.isArray(x) ? x[0] : x.key) === key);
    if (!q) return null;
    const s = paramSpec(q);
    return s.auto === false ? null : s;
  };
  const playing = (lane) => lane && !lane.off && Array.isArray(lane.points) && lane.points.length > 0;
  const add = (track, insert, param, lane, spec, kind) => { if (spec && playing(lane)) out.push({ track, insert, param, id: `${track}/${insert || 'mix'}/${param}`, lane, spec, kind }); };
  const devLanes = (track, insert, device, auto) => { for (const k of Object.keys(auto || {})) add(track, insert, k, auto[k], specOf(device, k), 'device'); };
  for (const t of p.tracks || []) {
    if (tracks && !tracks.includes(t.id)) continue;
    const a = t.auto || {};
    add(t.id, null, 'gain', a.gain, FADER, 'mix');
    add(t.id, null, 'pan', a.pan, PAN, 'mix');
    if (t.kind !== 'audio' && t.instrument && t.instrument.device) devLanes(t.id, 'instrument', t.instrument.device, t.instrument.auto);
    for (const x of t.inserts || []) devLanes(t.id, x.id, x.device, x.auto);
  }
  const m = p.master || {};
  if (!tracks || tracks.includes('master')) {
    add('master', null, 'gain', (m.auto || {}).gain, FADER, 'mix');
    for (const x of m.inserts || []) devLanes('master', x.id, x.device, x.auto);
  }
  return out;
}

// The lane segments that start in [from, to): each { track, insert, param, lane (its id), at, end, a, b, c, start,
// key } in song beats, a and b in travel. With chase, also what plays at `from`: the segment covering it (start: from),
// or, where none does (before the first point, after the last), a constant at from. cut: no segment starts at or past
// it (the loop's end: the wrap chases afresh). lanes: lanesOf's list (default: the song's).
export function autoIn(p, from, to, { cut = Infinity, chase = false, tracks = null, def, lanes = null } = {}) {
  const out = [];
  for (const L of lanes || lanesOf(p, { tracks, def })) {
    const s = L.spec, tr = travel(s), pts = sortedPoints(L.lane), step = stepped(s);
    let covered = false;
    const seg = (at, end, a, b, c, start) => out.push({ track: L.track, insert: L.insert, param: L.param, lane: L.id, at, end, a, b, c, start, key: `${L.id}/${at}/${end}` });
    for (let i = 0; i + 1 < pts.length; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      if (!(p1.t > p0.t)) continue; // (a jump: the next segment leaves from the second value)
      const c = step ? 'step' : p0.c == null ? 0 : p0.c;
      if (p0.t >= from && p0.t < to && p0.t < cut) { seg(p0.t, p1.t, tr.toPos(+p0.v), tr.toPos(+p1.v), c, p0.t); if (p0.t === from) covered = true; }
      else if (chase && p0.t < from && p1.t > from) { seg(p0.t, p1.t, tr.toPos(+p0.v), tr.toPos(+p1.v), c, from); covered = true; }
    }
    if (chase && !covered && from < cut) { const v = lanePos(L.lane, from, s, tr, pts); if (v != null) seg(from, from, v, v, 0, from); }
  }
  return out;
}
// A segment's travel position at song beat `beat`.
export function segPos(g, beat) {
  if (!(beat < g.end)) return g.b;
  const x = beat <= g.at ? 0 : (beat - g.at) / (g.end - g.at);
  return g.a + (g.b - g.a) * bend(x, g.c);
}
// What the mixer's AudioParams take for a travel position: the fader's linear gain; pan's two cosine-law gains.
export function mixGain(pos) { return dbToGain(specFromPos(FADER, pos)); }
export function panGains(pos) {
  const x = Math.max(-1, Math.min(1, specFromPos(PAN, pos)));
  return [x <= 0 ? 1 : Math.cos(x * Math.PI / 2), x >= 0 ? 1 : Math.cos(-x * Math.PI / 2)];
}
// Gain and pan as both renderers play them: control points every 128 frames (GRID), linear between. Point k is
// the lane at the song beat that frame k * 128 plays (beatOf(frame)). Returns Float32Arrays of n + 1 points: { g }
// for gain, { l, r } for pan. engine/render.js ramps an AudioParam through them; engine/node/render.js interpolates
// them per sample (v0 + (v1 - v0) * i / 128, the Web Audio linear ramp).
export const GRID = 128;
export function mixGrid(lane, param, n, beatOf) {
  const s = param === 'pan' ? PAN : FADER, tr = travel(s), pts = sortedPoints(lane);
  if (param === 'pan') {
    const l = new Float32Array(n + 1), r = new Float32Array(n + 1);
    for (let k = 0; k <= n; k++) { const [a, b] = panGains(lanePos(lane, beatOf(k * GRID), s, tr, pts)); l[k] = a; r[k] = b; }
    return { l, r };
  }
  const g = new Float32Array(n + 1);
  for (let k = 0; k <= n; k++) g[k] = mixGain(lanePos(lane, beatOf(k * GRID), s, tr, pts));
  return { g };
}
