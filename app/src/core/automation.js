// Automation [core]: lanes of points in song beats that move a fader, a pan or a device's knob over time. Pure (no DOM,
// no audio): the ops (core/ops.js), the arrangement planners, both renderers, the knobs and the agent all read lanes
// through these functions, so one formula decides every value everywhere. docs/research/AUTOMATION.md is the spec;
// docs/ARCHITECTURE.md ("Automation") the contract.
//
// Where lanes live: on the thing they move, keyed by the param they move.
//   track.auto.gain / track.auto.pan                 the mixer (dB, -1..1)
//   track.instrument.auto[key]                        an instrument's params
//   insert.auto[key]                                  an effect's params (track and master inserts)
//   project.master.auto.gain                          the master fader
// Lane  = { points: [Point], off?: true, by }        off: held (the static value plays); by: who last wrote it
// Point = { t, v, c?, by? }                           t: song beat; v: the param's own units; c: the segment leaving
//                                                     it: absent = straight, -1..1 = bent, 'step' = hold, then jump;
//                                                     by: who wrote this point, only when it isn't the lane's by
//                                                     (absent: the lane's). One canonical form, so undo stays exact.
// Canonical: sorted by t (t rounded to 1/1024 beat), at most two points at one t (a jump: arriving, then leaving).
// Before the first point the lane holds the first value, after the last the last. A lane with no points doesn't exist.
//
// Values between points follow the control's travel, not its raw units: a straight line on a cutoff lane is a straight
// turn of a log knob, on a gain lane a straight push of the fader (the console law), on pan plain linear.
//
//   MIXER, paramSpec(raw), specFor(p, addr, getDevice)   the spec a lane is read with (min, max, curve, step, opts)
//   laneView(spec)                                       the spec a lane is drawn and edited with (the gain lane
//                                                        stops at the fader's +6 dB; the same travel, scaled)
//   pointBy(lane, pt) / laneAuthors(lane)                who wrote a point / everyone who wrote the lane
//   toPos(spec, v) / fromPos(spec, x) / travel(spec)     value <-> control travel (0..1)
//   dbToPos(db) / posToDb(pos)                           the mixer fader's law (ui/mixer.js), for the UI to import
//   bend(x, c)                                           0..1 -> 0..1 along a segment of curve c
//   valueAt(lane, beat, spec) / valueBefore(...)         the lane's value at a beat (at a jump: the leaving value) /
//                                                        arriving at it from the left
//   segmentsIn(lane, from, to, spec)                     the pieces of the lane over [from, to): [{ t0, t1, a, b, c }]
//                                                        (a, b in travel; t0 -Infinity / t1 Infinity for the holds)
//   posAt(seg, beat)                                     travel along one such piece
//   lanesOf(p) / laneAt(p, addr) / laneKey(addr)         every lane with its address; one lane; a stable string key
//   normPoints(points, spec?) / normLane(lane) / normAuto(auto, host)   canonical form (the normalisers use these)
//   parsePoints(text) / formatPoints(points)             the text form: "32:400 48:8000~0.5 64:8000"
//   shapePoints(shape, { from, to, v0, v1, vEnd?, ... }) ramp / swell / dip / hold / flat / pulse over a range
//   thin(points, tol, spec)                              drop points a line through their neighbours already gives
//   discrete(spec)                                       a switch or a few-setting param: its lanes only step
//   pointsPrint(points)                                  a print of points, for guarded inverses
//   cutLane(points, from, to, spec) / spliceLane(points, from, to, inner, spec)   the windows the planners copy
//   insertTime / removeTime                              what time.insert and time.remove do to a lane's points

export const GRID = 1024; // t is rounded to 1/1024 beat
export const rt = (x) => Math.round(x * GRID) / GRID;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const r6 = (x) => {
  const r = Math.round(x * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/* ------------------------------------------------------------------------------------------------ specs */

// The mixer's params. Gain is the fader (dB, -96..24 as track.set takes it), pan -1 (left) .. 1 (right).
export const MIXER = {
  gain: Object.freeze({ key: 'gain', label: 'LEVEL', min: -96, max: 24, def: 0, curve: 'fader', unit: 'dB', step: 0 }),
  pan: Object.freeze({ key: 'pan', label: 'PAN', min: -1, max: 1, def: 0, curve: 'lin', step: 0 }),
};

// A device param spec in the shape devices/registry.js normParam gives (arrays and switch objects accepted too).
export function paramSpec(p) {
  if (!p) return null;
  if (Array.isArray(p)) {
    const [key, label, min, max, def, step] = p;
    p = { key, label, min, max, def, step };
  }
  const q = { ...p };
  if (q.opts) {
    q.min = 0;
    q.max = q.opts.length - 1;
    q.step = 1;
  }
  q.min = Number(q.min ?? 0);
  q.max = Number(q.max ?? 1);
  if (!(q.step > 0)) q.step = 0;
  q.curve = q.curve || 'lin';
  return q;
}
// Does a lane on this param jump from value to value (every segment 'step')? Switches (opts) and whole-number params
// with a few settings (a mode, a note division, bits, semitones: up to 24 steps). A knob whose step is only its
// resolution (0.5 dB, 10 Hz, 1 ms, 0.01) is continuous: its points snap to the step and its segments ramp and bend.
export const MAX_STEPS = 24;
export const discrete = (spec) =>
  !!spec &&
  (!!spec.opts ||
    (Number.isInteger(spec.step) && spec.step >= 1 && Math.abs(spec.max - spec.min) / spec.step <= MAX_STEPS));
const stepped = discrete;

// The spec a lane is read with: the mixer's, or the device's param (the registry's def, else the song's own device
// source). null when the param isn't known (an unloaded device, or a param a new version removed).
export function specFor(p, { track, insert, param } = {}, getDevice = null) {
  const t = track === 'master' ? null : findTrack(p, track);
  if (insert == null || insert === '')
    return track === 'master' ? (param === 'gain' ? MIXER.gain : null) : MIXER[param] || null;
  let device = null;
  if (insert === 'instrument') device = t?.instrument?.device;
  else {
    const list = track === 'master' ? p.master?.inserts || [] : t?.inserts || [];
    device = list.find((x) => x.id === insert)?.device;
  }
  if (!device) return null;
  const def = (getDevice && getDevice(device)) || p.devices?.[device] || null;
  const raw = (def?.params || []).find((q) => (Array.isArray(q) ? q[0] : q.key) === param);
  return raw ? paramSpec(raw) : null;
}

/* ------------------------------------------------------------------------------------------------ travel */

// The fader law (ui/mixer.js): piecewise like a console's, so 0 dB sits high and the useful range gets the travel.
const LAW = [
  [-96, 0],
  [-60, 0.04],
  [-48, 0.1],
  [-36, 0.19],
  [-24, 0.32],
  [-12, 0.5],
  [-6, 0.65],
  [0, 0.8],
  [6, 1],
];
export function dbToPos(db) {
  if (!(db > -96)) return 0;
  if (db >= 6) return 1;
  for (let i = 1; i < LAW.length; i++) {
    const [d1, p1] = LAW[i],
      [d0, p0] = LAW[i - 1];
    if (db <= d1) return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
  }
  return 1;
}
// (the mixer's: the bottom 1.2% of the fader is off, -96)
export function posToDb(pos) {
  if (pos <= 0.012) return -96;
  if (pos >= 1) return 6;
  for (let i = 1; i < LAW.length; i++) {
    const [d1, p1] = LAW[i],
      [d0, p0] = LAW[i - 1];
    if (pos <= p1) return d0 + ((pos - p0) / (p1 - p0)) * (d1 - d0);
  }
  return 6;
}
// For automation the law runs on past +6 dB to the +24 the mixer allows, at its last slope (0.2 of travel per 6 dB),
// with no dead zone at the bottom, and is scaled to 0..1 over -96..+24 (a straight line in either scaling is the same
// line, so the sound is the fader's).
const FLAW = [...LAW, [24, 1.6]];
const FTOP = 1.6;
function faderPos(db) {
  if (!(db > -96)) return 0;
  if (db >= 24) return 1;
  for (let i = 1; i < FLAW.length; i++) {
    const [d1, p1] = FLAW[i],
      [d0, p0] = FLAW[i - 1];
    if (db <= d1) return (p0 + ((db - d0) / (d1 - d0)) * (p1 - p0)) / FTOP;
  }
  return 1;
}
function faderDb(x) {
  const pos = clamp(x, 0, 1) * FTOP;
  for (let i = 1; i < FLAW.length; i++) {
    const [d1, p1] = FLAW[i],
      [d0, p0] = FLAW[i - 1];
    if (pos <= p1) return d0 + ((pos - p0) / (p1 - p0)) * (d1 - d0);
  }
  return 24;
}
const logOk = (s) => s.curve === 'log' && s.min > 0 && s.max > s.min;
// A fader spec with a lower top than +24 (laneView): the same law, its travel scaled so the top is 1.
const ftop = (s) => (s.max < 24 ? faderPos(s.max) : 1);
// The fader's top (ui/mixer.js): the gain lane is drawn and edited up to here; the engine still takes +24.
export const FADER_TOP = 6;
// The spec a lane row is drawn and edited with: the gain lane's travel ends at the fader's +6 dB, so a click near the
// top is +6, not +24 (a straight line is the same line in either scaling). Other specs as they are.
export const laneView = (spec) =>
  spec && spec.curve === 'fader' && spec.max > FADER_TOP ? { ...spec, max: FADER_TOP } : spec;
// value -> travel 0..1 (ui/faces.js's knob travel: log for curve 'log' over a positive range)
export function toPos(spec, v) {
  if (!spec) return v;
  if (spec.curve === 'fader') return faderPos(v) / ftop(spec);
  if (spec.max === spec.min) return 0;
  return logOk(spec) ? Math.log(v / spec.min) / Math.log(spec.max / spec.min) : (v - spec.min) / (spec.max - spec.min);
}
// travel -> value (clamped to the travel)
export function fromPos(spec, x) {
  if (!spec) return x;
  if (spec.curve === 'fader') return faderDb(clamp(x, 0, 1) * ftop(spec));
  return logOk(spec)
    ? spec.min * Math.pow(spec.max / spec.min, clamp(x, 0, 1))
    : spec.min + clamp(x, 0, 1) * (spec.max - spec.min);
}
export const travel = (spec) => ({ toPos: (v) => toPos(spec, v), fromPos: (x) => fromPos(spec, x) });

// Where along a segment, 0..1 -> 0..1. c > 0 starts slow (x^(1+3c)), c < 0 starts fast, 0 or absent is straight,
// 'step' holds until the end. Monotone, never overshoots.
export function bend(x, c) {
  if (c === 'step') return x >= 1 ? 1 : 0;
  if (!c) return x;
  return c > 0 ? Math.pow(x, 1 + 3 * c) : 1 - Math.pow(1 - x, 1 - 3 * c);
}

/* ------------------------------------------------------------------------------------------------ reading */

// The index of the last point at or before `beat` (-1 when the beat is before the first point).
function lastAtOrBefore(pts, beat) {
  let lo = 0,
    hi = pts.length - 1,
    ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (pts[m].t <= beat) {
      ans = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans;
}
// The value along the segment from point a to point b at `beat` (a.t <= beat <= b.t), in the param's units.
function along(a, b, beat, spec) {
  const c = stepped(spec) ? 'step' : a.c;
  if (beat <= a.t || c === 'step' || b.t <= a.t) return beat >= b.t && b.t > a.t && c !== 'step' ? b.v : a.v;
  if (beat >= b.t) return b.v;
  const x = (beat - a.t) / (b.t - a.t);
  if (!spec) return a.v + (b.v - a.v) * bend(x, c);
  const pa = toPos(spec, a.v),
    pb = toPos(spec, b.v);
  return fromPos(spec, pa + (pb - pa) * bend(x, c));
}
const pointsOf = (lane) => (Array.isArray(lane) ? lane : lane?.points || []);

// The lane's value at `beat`: at a jump, the value leaving it. A lane (or a points array); null for an empty one.
export function valueAt(lane, beat, spec = null) {
  const pts = pointsOf(lane);
  if (!pts.length) return null;
  const i = lastAtOrBefore(pts, beat);
  if (i < 0) return pts[0].v;
  if (i === pts.length - 1) return pts[i].v;
  return along(pts[i], pts[i + 1], beat, spec);
}
// The value arriving at `beat` from the left (the value just before a jump or a step there).
export function valueBefore(lane, beat, spec = null) {
  const pts = pointsOf(lane);
  if (!pts.length) return null;
  let i = lastAtOrBefore(pts, beat);
  while (i >= 0 && pts[i].t >= beat) i--;
  if (i < 0) return pts[0].v;
  if (i === pts.length - 1) return pts[i].v;
  const b = pts[i + 1];
  if (b.t > beat) return along(pts[i], b, beat, spec);
  // the next point is at `beat`: arriving at it (a step arrives at the old value)
  return stepped(spec) || pts[i].c === 'step' ? pts[i].v : b.v;
}
// The curve of the segment covering `beat` (leaving the last point at or before it), or undefined.
function curveAt(pts, beat) {
  const i = lastAtOrBefore(pts, beat);
  return i < 0 ? undefined : pts[i].c;
}

// The pieces of the lane over [from, to), uncut: [{ t0, t1, a, b, c }] with a, b in travel, c the bend or 'step'.
// The hold before the first point starts at -Infinity, the one after the last ends at Infinity; a jump (two points at
// one beat) has no piece of its own.
export function segmentsIn(lane, from, to, spec = null) {
  const pts = pointsOf(lane);
  const out = [];
  if (!pts.length) return out;
  const P = (v) => toPos(spec, v);
  const step = stepped(spec);
  const push = (t0, t1, a, b, c) => {
    if (t1 > from && t0 < to && t1 > t0) out.push({ t0, t1, a, b, c: step ? 'step' : c || 0 });
  };
  push(-Infinity, pts[0].t, P(pts[0].v), P(pts[0].v), 0);
  for (let i = 0; i < pts.length - 1; i++) push(pts[i].t, pts[i + 1].t, P(pts[i].v), P(pts[i + 1].v), pts[i].c);
  const last = pts[pts.length - 1];
  push(last.t, Infinity, P(last.v), P(last.v), 0);
  return out;
}
// Travel along one piece at `beat`.
export function posAt(seg, beat) {
  if (!(seg.t1 > seg.t0) || !Number.isFinite(seg.t0) || !Number.isFinite(seg.t1)) return seg.a;
  const x = clamp((beat - seg.t0) / (seg.t1 - seg.t0), 0, 1);
  return seg.a + (seg.b - seg.a) * bend(x, seg.c);
}

/* ------------------------------------------------------------------------------------------------ where lanes are */

function findTrack(p, id) {
  if (id == null) return null;
  return (
    p.tracks.find((x) => x.id === id) ||
    p.tracks.find((x) => String(x.name).toLowerCase() === String(id).toLowerCase()) ||
    null
  );
}
// A lane's stable name: "t_x/gain", "t_x/instrument/cutoff", "t_x/fx_y/mix", "master/gain", "master/fx_z/mix".
export const laneKey = ({ track, insert, param }) =>
  [track, insert || null, param].filter((x) => x != null && x !== '').join('/');

// Every lane in the song: [{ track, insert, param, lane, key, device? }] (track: an id or 'master'; insert: an insert
// id, 'instrument' or null for the mixer), in song order (the tracks, then the master; mixer, instrument, inserts).
export function lanesOf(p) {
  const out = [];
  const add = (track, insert, auto, device) => {
    if (!auto) return;
    for (const param of Object.keys(auto)) {
      const lane = auto[param];
      if (!lane || !Array.isArray(lane.points) || !lane.points.length) continue;
      const x = { track, insert, param, lane, key: laneKey({ track, insert, param }) };
      if (device) x.device = device;
      out.push(x);
    }
  };
  for (const t of p.tracks || []) {
    add(t.id, null, t.auto);
    if (t.instrument) add(t.id, 'instrument', t.instrument.auto, t.instrument.device);
    for (const fx of t.inserts || []) add(t.id, fx.id, fx.auto, fx.device);
  }
  if (p.master) {
    add('master', null, p.master.auto);
    for (const fx of p.master.inserts || []) add('master', fx.id, fx.auto, fx.device);
  }
  return out;
}
// The object a lane is stored on ({ host, ok }), by ids (or a track's name). host is null when the thing isn't there.
export function laneHost(p, { track, insert } = {}) {
  if (track === 'master') {
    if (insert == null || insert === '') return p.master || null;
    return (p.master?.inserts || []).find((x) => x.id === insert) || null;
  }
  const t = findTrack(p, track);
  if (!t) return null;
  if (insert == null || insert === '') return t;
  if (insert === 'instrument') return t.instrument || null;
  return t.inserts.find((x) => x.id === insert) || null;
}
// One lane, or null.
export function laneAt(p, addr = {}) {
  const host = laneHost(p, addr);
  const lane = host?.auto?.[addr.param];
  return lane && Array.isArray(lane.points) && lane.points.length ? lane : null;
}

/* ------------------------------------------------------------------------------------------------ canonical form */

// A point's curve, canonical: undefined (straight), a number in -1..1 (4 decimals) or 'step'.
export function normCurve(c) {
  if (c === 'step') return 'step';
  if (c == null || c === '' || c === 0) return undefined;
  const n = Number(c);
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(clamp(n, -1, 1) * 10000) / 10000;
  return r === 0 || Object.is(r, -0) ? undefined : r;
}
export function mkPoint(t, v, c, by) {
  const pt = { t, v };
  const cc = normCurve(c);
  if (cc !== undefined) pt.c = cc;
  if (typeof by === 'string' && by) pt.by = by;
  return pt;
}
// Who wrote a point: its own by, else the lane's.
export const pointBy = (lane, pt) => (pt && typeof pt.by === 'string' && pt.by) || lane?.by || 'you';
// Everyone who wrote points on a lane, you first, then in the order they first appear.
export function laneAuthors(lane) {
  const out = [];
  for (const x of pointsOf(lane)) {
    const b = pointBy(lane, x);
    if (!out.includes(b)) out.push(b);
  }
  out.sort((a, b) => (a === 'you' ? -1 : b === 'you' ? 1 : 0));
  return out;
}
// Points in the canonical author form for a lane signed `by`: a point's by only when it isn't the lane's.
export const signPoints = (points, by) =>
  points.map((x) => (x.by && x.by !== by ? x : x.by === undefined ? x : mkPoint(x.t, x.v, x.c)));
// Points in canonical order: finite only, t rounded and >= 0, v clamped (and snapped to its step; a discrete param's
// segments 'step') when the spec is known, sorted by t (stable), at most two at one t (the first and the last given there).
export function normPoints(points, spec = null) {
  const out = [];
  for (const p of points || []) {
    if (!p || typeof p !== 'object') continue;
    let t = Number(p.t),
      v = Number(p.v);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    t = Math.max(0, rt(t));
    let c = p.c;
    if (spec) {
      const lo = Math.min(spec.min, spec.max),
        hi = Math.max(spec.min, spec.max);
      if (Number.isFinite(lo) && Number.isFinite(hi)) v = clamp(v, lo, hi);
      if (spec.step > 0) v = r6(spec.min + Math.round((v - spec.min) / spec.step) * spec.step);
      if (stepped(spec)) c = 'step';
    }
    out.push(mkPoint(t, Object.is(v, -0) ? 0 : v, c, p.by));
  }
  const idx = out.map((x, i) => i);
  idx.sort((a, b) => out[a].t - out[b].t || a - b);
  const sorted = idx.map((i) => out[i]);
  const res = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].t === sorted[i].t) j++;
    res.push(sorted[i]);
    if (j > i) res.push(sorted[j]);
    i = j + 1;
  }
  return res;
}
// A lane, canonical ({ points, off?, by }), or null when it has no points.
export function normLane(lane, spec = null) {
  if (!lane || typeof lane !== 'object') return null;
  const points = normPoints(lane.points, spec);
  if (!points.length) return null;
  const by = typeof lane.by === 'string' && lane.by ? lane.by : 'you';
  const out = { points: signPoints(points, by) };
  if (lane.off === true) out.off = true;
  out.by = by;
  return out;
}
// An auto map ({ [param]: Lane }), canonical: keys sorted, empty lanes dropped; undefined when nothing is left.
// mixer: true clamps gain and pan to their ranges (a track's or the master's own lanes).
export function normAuto(auto, { mixer = false } = {}) {
  if (!auto || typeof auto !== 'object' || Array.isArray(auto)) return undefined;
  const out = {};
  for (const k of Object.keys(auto).sort()) {
    if (mixer && !MIXER[k]) continue;
    const lane = normLane(auto[k], mixer ? MIXER[k] : null);
    if (lane) out[k] = lane;
  }
  return Object.keys(out).length ? out : undefined;
}

/* ------------------------------------------------------------------------------------------------ text */

// "32:400 48:8000~0.5 64:8000": beat:value[~curve], space (or comma) separated; curve a number in -1..1 or 'step';
// two tokens at one beat make a jump. Beats and values may be fractions ("1/3:0.5").
const numTok = (s) => {
  const m = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]) / Number(m[2]);
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
};
export function parsePoints(text) {
  if (Array.isArray(text)) return text.map((p) => ({ ...p }));
  if (typeof text !== 'string')
    throw new Error(
      'points must be text like "32:400 48:8000~0.5 64:8000" (beat:value, ~curve optional) or an array of { t, v, c? }',
    );
  const out = [];
  for (const tok of text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)) {
    const m = /^([^:~]+):([^:~]+)(?:~(.+))?$/.exec(tok);
    const t = m ? numTok(m[1]) : NaN,
      v = m ? numTok(m[2]) : NaN;
    let c;
    if (m && m[3] != null) c = m[3].toLowerCase() === 'step' ? 'step' : numTok(m[3]);
    if (
      !m ||
      !Number.isFinite(t) ||
      !Number.isFinite(v) ||
      (c !== undefined && c !== 'step' && !(Number.isFinite(c) && c >= -1 && c <= 1))
    ) {
      throw new Error(
        `bad point "${tok.slice(0, 40)}": write beat:value, like 32:400, with ~curve after it to bend the line that leaves it (~0.5 starts slow, ~-0.5 fast, ~step holds then jumps)`,
      );
    }
    out.push(c === undefined ? { t, v } : { t, v, c });
  }
  return out;
}
export function formatPoints(points) {
  return (points || [])
    .map((p) => `${r6(p.t)}:${r6(p.v)}${p.c === 'step' ? '~step' : p.c ? `~${r6(p.c)}` : ''}`)
    .join(' ');
}

// A print of points, for guarded inverses: equal prints, equal points.
export const pointsPrint = (points) =>
  JSON.stringify((points || []).map((p) => (p.c === undefined ? [p.t, p.v] : [p.t, p.v, p.c])));

/* ------------------------------------------------------------------------------------------------ shapes */

// Points for a shape over [from, to] (song beats), in the param's units. v0: the value going in (and coming back to);
// v1: the value it goes to; vEnd: the value after the range (default v0). c: a bend for ramps.
//   'ramp'        v0 at from -> v1 at to
//   'swell' / 'dip'   v0 -> v1 at the middle -> vEnd
//   'hold'        v0 -> v1 over `ramp` beats (default 0.5), held, -> vEnd over the last `ramp` beats
//   'flat'        v0 from from to to
//   'pulse'       a step every `every` beats (default 1) between v0 and v1, then vEnd
export function shapePoints(shape, { from, to, v0, v1 = v0, vEnd = v0, c, ramp = 0.5, every = 1 } = {}) {
  if (!(fin(from) && fin(to) && to > from)) throw new Error('a shape needs from < to (beats)');
  if (!fin(v0) || !fin(v1) || !fin(vEnd)) throw new Error('a shape needs values v0 (and v1) as numbers');
  const L = to - from;
  switch (shape) {
    case 'ramp':
      return [mkPoint(from, v0, c), mkPoint(to, v1)];
    case 'swell':
    case 'dip': {
      const m = rt(from + L / 2);
      return [mkPoint(from, v0, c), mkPoint(m, v1, c != null ? -c : undefined), mkPoint(to, vEnd)];
    }
    case 'hold': {
      const r = Math.min(Math.max(0, ramp), L / 4);
      if (!(r > 0)) return [mkPoint(from, v0), mkPoint(from, v1), mkPoint(to, v1), mkPoint(to, vEnd)];
      return [mkPoint(from, v0), mkPoint(rt(from + r), v1), mkPoint(rt(to - r), v1), mkPoint(to, vEnd)];
    }
    case 'flat':
      return [mkPoint(from, v0), mkPoint(to, v0)];
    case 'pulse': {
      const e = Math.max(1 / 64, Number(every) || 1);
      const out = [];
      let k = 0;
      for (let t = from; t < to - 1e-9 && out.length < 4096; t = rt(from + ++k * e))
        out.push(mkPoint(rt(t), k % 2 ? v0 : v1, 'step'));
      out.push(mkPoint(to, vEnd));
      return out;
    }
    default:
      throw new Error(`unknown shape "${shape}" (ramp, swell, dip, hold, flat, pulse)`);
  }
}

// Ramer-Douglas-Peucker in travel space, by each point's distance in travel from the line through the kept points
// either side of it at its beat. tol: travel (0.005 = 0.5%). Bent and step points, jumps and the ends are kept.
// minGap: drop points closer than this many beats to the last kept one (freehand drawing: 1/64).
export function thin(points, tol = 0.005, spec = null, { minGap = 0 } = {}) {
  // (a switch or a stepped param: a point wherever the setting changes, each one a step; a staircase is the music)
  if (stepped(spec)) {
    const all = normPoints(points, spec),
      out = [];
    for (let i = 0; i < all.length; i++) {
      const prev = out[out.length - 1];
      if (
        i === 0 ||
        i === all.length - 1 ||
        all[i].v !== prev.v ||
        all[i].t === all[i - 1].t ||
        (all[i + 1] && all[i + 1].t === all[i].t)
      )
        out.push(all[i]);
    }
    return normPoints(out, spec);
  }
  let pts = normPoints(points);
  if (minGap > 0 && pts.length > 2) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++)
      if (pts[i].c !== undefined || pts[i].t - out[out.length - 1].t >= minGap) out.push(pts[i]);
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  if (pts.length <= 2) return pts;
  const P = pts.map((p) => toPos(spec, p.v));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].c !== undefined) keep[i] = 1;
    if (i > 0 && pts[i].t === pts[i - 1].t) {
      keep[i] = keep[i - 1] = 1;
    }
  }
  const stack = [];
  let a = 0;
  for (let i = 1; i < pts.length; i++)
    if (keep[i]) {
      stack.push([a, i]);
      a = i;
    }
  while (stack.length) {
    const [i0, i1] = stack.pop();
    if (i1 - i0 < 2) continue;
    const t0 = pts[i0].t,
      t1 = pts[i1].t;
    let worst = -1,
      wi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const x = t1 > t0 ? (pts[i].t - t0) / (t1 - t0) : 0;
      const d = Math.abs(P[i] - (P[i0] + (P[i1] - P[i0]) * x));
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (worst > tol) {
      keep[wi] = 1;
      stack.push([i0, wi], [wi, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ------------------------------------------------------------------------------------------------ windows */
// The planners (core/arrangement.js) move lanes with the music through these. All take and return canonical points.
// A bent segment cut in the middle keeps its curve number on each side (close, not exact); straight, step and held
// stretches are exact.

// Two points at one beat collapse to one when they are equal.
function pushAt(out, t, v, c, by) {
  const last = out[out.length - 1],
    prev = out[out.length - 2];
  if (last && last.t === t && last.v === v && !(prev && prev.t === t)) {
    out[out.length - 1] = mkPoint(t, v, c, by ?? last.by);
    return;
  }
  if (last && last.t === t && prev && prev.t === t) {
    out[out.length - 1] = mkPoint(t, v, c, by);
    return;
  }
  out.push(mkPoint(t, v, c, by));
}
// the author of the point governing `beat` (the last at or before it, else the first): an edge a window makes is theirs
const byAt = (pts, beat) => {
  const i = lastAtOrBefore(pts, beat);
  return pts[Math.max(0, i)]?.by;
};
// The lane over [from, to] as points starting at `from` (shifted to 0 when rebase): its value leaving `from`, the
// points strictly inside, and the value arriving at `to`. Empty for an empty lane.
export function cutLane(points, from, to, spec = null, { rebase = true } = {}) {
  const pts = pointsOf(points);
  if (!pts.length || !(to > from)) return [];
  const o = rebase ? from : 0;
  const out = [];
  pushAt(out, rt(from - o), valueAt(pts, from, spec), curveAt(pts, from), byAt(pts, from));
  for (const p of pts) if (p.t > from && p.t < to) pushAt(out, rt(p.t - o), p.v, p.c, p.by);
  pushAt(out, rt(to - o), valueBefore(pts, to, spec), undefined, byAt(pts, to - 1e-9));
  return out;
}
// The lane with [from, to] replaced by `inner` (points inside [from, to]), joined to what's either side: the value
// arriving at `from` is kept as a point there when anything comes before, and the value leaving `to` (with its curve)
// when anything comes after.
export function spliceLane(points, from, to, inner, spec = null) {
  const pts = pointsOf(points);
  const out = [];
  for (const p of pts) if (p.t < from) out.push(p);
  // (a lane holds its first value before its first point and its last after its last, so any lane has an edge)
  const before = pts.length > 0,
    after = pts.length > 0;
  if (before) pushAt(out, from, valueBefore(pts, from, spec), undefined, byAt(pts, from - 1e-9));
  for (const p of normPoints(inner)) if (p.t >= from && p.t <= to) pushAt(out, p.t, p.v, p.c, p.by);
  if (after) pushAt(out, to, valueAt(pts, to, spec), curveAt(pts, to), byAt(pts, to));
  for (const p of pts) if (p.t > to) out.push(p);
  return normPoints(out);
}
// time.insert: `length` beats at `at`. Points from `at` on move right; the value at `at` holds across the gap.
export function insertTime(points, at, length, spec = null) {
  const pts = pointsOf(points);
  if (!pts.some((p) => p.t >= at)) return pts.slice();
  if (!pts.some((p) => p.t < at)) return pts.map((p) => mkPoint(rt(p.t + length), p.v, p.c, p.by));
  const vIn = valueBefore(pts, at, spec),
    vAt = valueAt(pts, at, spec),
    cAt = curveAt(pts, at);
  const bIn = byAt(pts, at - 1e-9),
    bAt = byAt(pts, at);
  const out = pts.filter((p) => p.t < at).map((p) => ({ ...p }));
  pushAt(out, at, vIn, undefined, bIn);
  if (vAt !== vIn) pushAt(out, at, vAt, undefined, bAt);
  pushAt(out, rt(at + length), vAt, cAt, bAt);
  for (const p of pts) if (p.t > at) out.push(mkPoint(rt(p.t + length), p.v, p.c, p.by));
  return normPoints(out);
}
// time.remove: beats [at, at + length) go; later points move left; at `at` the value from before meets the value from
// after (a jump when they differ).
export function removeTime(points, at, length, spec = null) {
  const pts = pointsOf(points);
  const B = at + length;
  if (!pts.some((p) => p.t >= at)) return pts.slice();
  const shift = (p) => mkPoint(rt(p.t - length), p.v, p.c, p.by);
  if (!pts.some((p) => p.t <= B)) return pts.map(shift);
  if (!pts.some((p) => p.t < at) && !pts.some((p) => p.t >= at && p.t <= B)) return pts.map(shift);
  const vIn = valueBefore(pts, at, spec),
    vB = valueAt(pts, B, spec),
    cB = curveAt(pts, B);
  const out = pts.filter((p) => p.t < at).map((p) => ({ ...p }));
  if (vB !== vIn) pushAt(out, at, vIn, undefined, byAt(pts, at - 1e-9));
  pushAt(out, at, vB, cB, byAt(pts, B));
  for (const p of pts) if (p.t > B) out.push(shift(p));
  return normPoints(out);
}
