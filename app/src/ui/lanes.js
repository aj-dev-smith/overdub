// Automation lanes in the arranger [ui-arrange]: drawing a lane, its hit-testing and gestures (pointer and touch), the
// bar-range shapes, the lane menu and the lane header. arranger.js owns the layout (a lane row under its track, in
// rows()); this file owns what happens inside a row. docs/research/AUTOMATION.md 3.7 is the spec, core/automation.js
// the values (one formula everywhere: a straight line on a lane is a straight turn of the knob).
//
// In the Liner notes look (design/LINER-NOTES-KIT.md): no box and no fill block, the room, the beat grid and the line.
// The line is the track's ink at 1.5 px with the area under it at the clip fill's 13%; points are 5 px squares in the
// track ink; selected points are reverse print (filled cream) and a selected range gets the cream hairline frame. Held
// is the muted look (the line dashed in pencil, the name struck, "held" where the byline was). Being written is the
// record ink (the stretch in --rec, a red frame on it). Before the first point and after the last the line runs flat
// in pencil: it holds, but nobody drew it. An agent's lane is signed on its header; arriving, it gets crop marks.
//
//   click: a point (snapped in time; on the line, the line's value)    drag a point: move it (shift: fine, no snap)
//   drag the line between two points: move both ends                  alt-drag the line: bend it (alt-double-click: straight)
//   double-click a point: delete it                                   drag across empty lane: select the points there
//   Draw (the header's lamp, or hold mod): paint freehand, thinned on release
//   right-click (touch: hold): Ramp up, Ramp down, Swell, Dip, Hold, Pulse on the selected bars (or the bar under it),
//   Simplify, Clear, Hide; on a point: Delete, Straight, Ease in, Ease out, Step
//   keys (a lane point selected, the lanes focused): left/right the previous / next point, up/down its value, Delete;
//   ⌘C copies the selected points, ⌘V pastes them at the playhead (one undo step)
//   hover, drag or select: the value at the cursor in the param's units ("-3.0 dB", "1.20 kHz"), a tip that floats
//   the lane's name: pick another param for the row (device and param); + lane: open another; the lower edge: its height
// Every gesture is one auto.write by you: one undo step. A point is signed by whoever wrote it (core/automation.js
// pointBy); the header signs the lane with everyone but you ("you and Claude" when you share it).
// The master's lanes have their own block under the last track, headed "Master" (masterTrack: gain and its inserts).

import { h, css, clamp, byline } from './dom.js';
import { palette, resolveColor, rgba, authorKind, deviceName, menu, closePopover, snapTo, floorTo, drawPointSquare, HELD_DASH, MOD } from './arrange-kit.js';
import {
  specFor, toPos, fromPos, valueAt, valueBefore, segmentsIn, posAt, laneAt, laneKey, lanesOf, normPoints, shapePoints,
  thin, spliceLane, mkPoint, rt, MIXER, paramSpec, laneView, laneAuthors, discrete,
} from '../core/automation.js';
const MODK = MOD;

export const LANE_H = 40;          // a lane row (48 on phones), until you drag its lower edge
export const LANE_H_PHONE = 48;
export const LANE_MIN = 28, LANE_MAX = 240;

/* ================================================================ heights, remembered per lane (this browser) */
const HKEY = 'overdub:lanes';
let heights = null;
function loadHeights() {
  if (heights) return heights;
  heights = {};
  try { const s = JSON.parse(localStorage.getItem(HKEY) || '{}'); if (s && s.h && typeof s.h === 'object') for (const [k, v] of Object.entries(s.h)) if (Number.isFinite(v)) heights[k] = clamp(Math.round(v), LANE_MIN, LANE_MAX); } catch { /* fresh */ }
  return heights;
}
// A lane row's height: the one you dragged it to, else 40 (48 on a phone)
export function laneHeight(key, phone = false) { const v = loadHeights()[key]; return v || (phone ? LANE_H_PHONE : LANE_H); }
export function setLaneHeight(key, px, { save = true } = {}) {
  const H = loadHeights();
  const v = clamp(Math.round(px), LANE_MIN, LANE_MAX);
  if (v === LANE_H) delete H[key]; else H[key] = v;
  heightsRev++;
  if (save) {
    const keys = Object.keys(H);
    if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete H[k];
    try { localStorage.setItem(HKEY, JSON.stringify({ h: H })); } catch { /* private mode: this session only */ }
  }
  return v;
}
let heightsRev = 0;
// changes whenever a height does (the arranger's layout cache reads it)
export const heightsSig = () => heightsRev;

/* ================================================================ the master's block */
// The master as a row the lanes can sit under: its fader and its inserts (no clips, no instrument, no pan).
export function masterTrack(p) {
  return { id: 'master', name: 'Master', color: 'var(--text-2)', kind: 'master', inserts: p.master?.inserts || [], instrument: null, clips: [], by: 'overdub' };
}
const narrowScreen = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
const hostTrack = (p, id) => (id === 'master' ? masterTrack(p) : p.tracks.find((t) => t.id === id) || null);
const PAD = 6;                     // the line's travel stays this far inside the row
const EPS = 1e-6;

/* ================================================================ params and names */

const ACRO = new Set(['lfo', 'eq', 'hp', 'lp', 'bp', 'fm', 'am', 'bpm', 'q', 'adsr', 'vco', 'vcf', 'dc', 'fx', 'lo', 'hi']);
// "CUTOFF" -> "Cutoff", "LFO RATE" -> "LFO rate" (labels are stored upper case; heads are sentence case)
export function sentence(label) {
  const words = String(label || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.map((w, i) => (ACRO.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}
const A = (addr) => (addr.insert ? { track: addr.track, insert: addr.insert, param: addr.param } : { track: addr.track, param: addr.param });
const defOf = (app, p, device) => (device && (app.devices?.getDevice?.(device) || p.devices?.[device])) || null;
const paramsOfDef = (def) => (def?.params || []).map(paramSpec).filter((q) => q && q.key && q.auto !== false);

// What a track can automate, in the order the lanes are listed: the mixer first (Level, Pan), then its instrument's
// knobs, then each insert's. [{ addr, key, name, device, spec }]
export function laneParams(app, p, t) {
  const out = [];
  const add = (addr, name, device, spec) => out.push({ addr: A(addr), key: laneKey(addr), name, device, spec });
  add({ track: t.id, param: 'gain' }, 'Level', '', MIXER.gain);
  if (t.id !== 'master') add({ track: t.id, param: 'pan' }, 'Pan', '', MIXER.pan);
  if (t.kind === 'instrument' && t.instrument) {
    const def = defOf(app, p, t.instrument.device);
    for (const q of paramsOfDef(def)) add({ track: t.id, insert: 'instrument', param: q.key }, sentence(q.label || q.key), deviceName(app, t.instrument.device), q);
  }
  for (const fx of t.inserts || []) {
    const def = defOf(app, p, fx.device);
    for (const q of paramsOfDef(def)) add({ track: t.id, insert: fx.id, param: q.key }, sentence(q.label || q.key), deviceName(app, fx.device), q);
  }
  return out;
}
// A lane's name, its device and its spec (null for a param a device no longer has: "no such param").
export function laneInfo(app, p, addr) {
  const spec = specFor(p, addr, (id) => app.devices?.getDevice?.(id) || null);
  let name = addr.param === 'gain' && !addr.insert ? 'Level' : addr.param === 'pan' && !addr.insert ? 'Pan' : sentence(spec?.label || addr.param);
  let device = '';
  if (addr.insert === 'instrument') device = deviceName(app, p.tracks.find((t) => t.id === addr.track)?.instrument?.device);
  else if (addr.insert) {
    const t = hostTrack(p, addr.track);
    const fx = t?.inserts.find((x) => x.id === addr.insert);
    device = fx ? deviceName(app, fx.device) : '';
  }
  if (!spec) name = name || addr.param;
  return { name, device, spec };
}
// The value a param holds without its lane: the fader, the pan, the knob (the device's default when unset).
export function staticValue(p, addr, spec) {
  const t = hostTrack(p, addr.track);
  if (!t) return spec?.def ?? 0;
  if (!addr.insert) return Number((addr.track === 'master' ? p.master?.[addr.param] : t[addr.param]) ?? spec?.def ?? 0);
  const host = addr.insert === 'instrument' ? t.instrument : t.inserts.find((x) => x.id === addr.insert);
  const v = host?.params?.[addr.param];
  return Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : spec?.def ?? spec?.min ?? 0;
}
// The ops that set a param's static value (Clear sets it to the lane's value at the playhead first, so nothing jumps).
function staticOps(addr, v) {
  if (!addr.insert && addr.track === 'master') return [{ type: 'master.set', patch: { [addr.param]: v } }];
  if (!addr.insert) return [{ type: 'track.set', track: addr.track, patch: { [addr.param]: v } }];
  if (addr.insert === 'instrument') return [{ type: 'instrument.set', track: addr.track, params: { [addr.param]: v } }];
  return [{ type: 'insert.set', track: addr.track, insert: addr.insert, patch: { params: { [addr.param]: v } } }];
}

// A value as the knob says it ("1.20 kHz", "-6.0 dB", "L 40", "Saw").
export function fmtValue(spec, v) {
  if (v == null || !Number.isFinite(v)) return '';
  if (!spec) return String(Math.round(v * 100) / 100);
  if (spec.opts) return String(spec.opts[clamp(Math.round(v), 0, spec.opts.length - 1)] ?? '');
  if (typeof spec.fmt === 'function') { try { const s = spec.fmt(v); if (s != null) return String(s); } catch { /* its own business */ } }
  if (spec === MIXER.pan || (spec.key === 'pan' && spec.min === -1 && spec.max === 1 && !spec.unit)) {
    const k = Math.round(Math.abs(v) * 100);
    return k === 0 ? 'C' : `${v < 0 ? 'L' : 'R'} ${k}`;
  }
  const span = Math.abs(spec.max - spec.min);
  const d = spec.step >= 1 ? 0 : span >= 50 ? 0 : span >= 5 ? 1 : 2;
  const n = (x, k = d) => (+x).toFixed(k);
  // (under 10 Hz or 10 ms, an LFO's rate or a fast attack: decimals, so 0.5 Hz isn't "1 Hz" and 0.4 ms isn't "0 ms";
  // a param that moves in whole steps stays whole)
  const fine = (x) => (Math.abs(x) >= 10 || x === 0 || spec.step >= 1 ? String(Math.round(x)) : n(x, Math.abs(x) < 1 ? 2 : 1));
  switch (spec.unit) {
    case 'Hz': return v >= 1000 ? n(v / 1000, v >= 10000 ? 1 : 2) + ' kHz' : fine(v) + ' Hz';
    case 'dB': return v <= -95.9 ? '−∞ dB' : (v > 0 ? '+' : '') + n(v, 1) + ' dB';
    case 'ms': return v >= 1000 ? n(v / 1000, 2) + ' s' : fine(v) + ' ms';
    case 's': return n(v, v < 10 ? 2 : 1) + ' s';
    case '%': return Math.round(v) + '%';
    default: return n(v);
  }
}

/* ================================================================ which lanes show */

// ui.state.lanes = { tracks: { [trackId]: { open, extra: [addr], hide: [key], focus } }, draw: laneKey | null }.
// open: E (or the header's A key) shows the track's lanes; extra: lanes asked for (Add a lane, Automate) that have no
// points yet; hide: lanes hidden one by one; focus: the lane asked for last (a phone shows that one). Hidden lanes
// still play.
export function laneState(ui) {
  const s = ui.state.lanes || (ui.state.lanes = {});
  if (!s.tracks) s.tracks = {};
  if (!('draw' in s)) s.draw = null;
  return s;
}
export function trackLanes(ui, tid) {
  const s = laneState(ui);
  return s.tracks[tid] || (s.tracks[tid] = { open: false, extra: [], hide: [], focus: null });
}
// The lanes on a track that hold points: [key].
export function laneKeysOn(p, t) { return lanesOf(p).filter((l) => l.track === t.id).map((l) => l.key); }
// The lane rows under a track (none while its lanes are hidden): [{ addr, key }] in the order laneParams lists them,
// then any lane whose param its device no longer has. One at a time on a phone (the one asked for last).
export function shownLanes(app, p, t, { narrow = false } = {}) {
  const st = laneState(app.ui).tracks[t.id];
  if (!st || !st.open) return [];
  if (t.id === 'master' && !p.master) return [];
  const have = lanesOf(p).filter((l) => l.track === t.id);
  const want = new Map();
  for (const l of have) want.set(l.key, A(l));
  for (const a of st.extra || []) if (a && a.track === t.id) want.set(laneKey(a), A(a));
  for (const k of st.hide || []) want.delete(k);
  const out = [];
  for (const q of laneParams(app, p, t)) if (want.has(q.key)) { out.push({ addr: q.addr, key: q.key }); want.delete(q.key); }
  for (const l of have) if (want.has(l.key)) { out.push({ addr: A(l), key: l.key }); want.delete(l.key); }
  if (narrow && out.length > 1) { const f = out.find((x) => x.key === st.focus); return [f || out[0]]; }
  return out;
}

/* ================================================================ writing */

// ←/→ from the selection (beats { from, to }): the index of the first point at the next beat after it (→) or at the
// beat before it (←); a range collapses to its first point on ←. A jump (two points at one beat) is one stop: → from
// it goes on to the next beat. At either end it stays on the last (first) point.
export function stepIndex(pts, sel, dir) {
  const n = pts.length, range = sel.to - sel.from > EPS;
  let i;
  if (dir > 0) { i = pts.findIndex((x) => x.t > sel.to + EPS); if (i < 0) i = n - 1; }
  else if (range) { i = pts.findIndex((x) => x.t >= sel.from - EPS); if (i < 0) i = n - 1; }
  else { i = -1; for (let k = n - 1; k >= 0; k--) if (pts[k].t < sel.from - EPS) { i = k; break; } if (i < 0) i = 0; }
  // (the first point at that beat)
  while (i > 0 && pts[i - 1].t === pts[i].t) i--;
  return i;
}

// The auto.write that turns points `a` into `b` (both canonical) over the beats where they differ; null when they
// don't. Signed by whoever dispatches it (no _by: the lane's byline becomes the writer's). _fit: a point carried over
// from the lane that is out of the param's range (an old file) is clamped, not refused.
export function writeOp(addr, a, b) {
  const group = (pts) => { const m = new Map(); for (const x of pts) m.set(x.t, (m.get(x.t) || '') + JSON.stringify(x)); return m; };
  const ga = group(a), gb = group(b);
  let lo = Infinity, hi = -Infinity;
  for (const t of new Set([...ga.keys(), ...gb.keys()])) if (ga.get(t) !== gb.get(t)) { if (t < lo) lo = t; if (t > hi) hi = t; }
  if (lo === Infinity) return null;
  return { type: 'auto.write', ...A(addr), from: lo, to: hi, points: b.filter((x) => x.t >= lo && x.t <= hi), _fit: true };
}

// A point's value moved `dp` of the lane's travel as drawn (laneView), for a drag or ↑/↓. The row stops at the
// fader's +6 dB, but a gain point can sit higher (an agent's, a file's, a recorded knob's, up to the +24 the mixer
// takes): it keeps its value when only its time moves, and its reach runs on past the drawn top along the same law up
// to where it is, so it can come down but is never pulled down to +6.
export function moveValue(spec, v, dp) {
  if (!spec || !dp) return v;
  const p0 = toPos(laneView(spec), v), x = clamp(p0 + dp, 0, Math.max(1, p0));
  return x === p0 ? v : viewValue(spec, x);
}
// travel as drawn (laneView) -> value, where travel past 1 on a gain lane runs on along the fader law toward +24
export function viewValue(spec, x) {
  const vs = laneView(spec);
  return x > 1 && vs !== spec ? fromPos(spec, x * toPos(spec, vs.max)) : fromPos(vs, x);
}
// ↑/↓ on a point (dir ±1; big: Shift): a hundredth of the travel (a tenth), and at least one step of a param that
// steps (a switch, a mode, a division), so every lane moves from the keyboard.
export function nudgeValue(spec, v, dir, big = false) {
  const nv = moveValue(spec, v, (big ? 0.1 : 0.01) * dir);
  if (!spec || !(spec.step > 0)) return nv;
  const lo = Math.min(spec.min, spec.max), hi = Math.max(spec.min, spec.max);
  const snap = (x) => spec.min + Math.round((clamp(x, lo, hi) - spec.min) / spec.step) * spec.step;
  return Math.abs(snap(nv) - snap(v)) >= spec.step / 2 ? nv : clamp(snap(v) + dir * spec.step, lo, hi);
}

// A shape over [from, to] (beats) on a lane: the points of the whole lane after it, joined to what's either side.
//   ramp-up / ramp-down: from the value going in to where the lane is going, and it holds there (rampPlan below)
//   swell / dip: up (down) to a third of the travel past them at the middle and back; hold: the value going in, flat;
//   pulse: a step every `every` beats (default 1) between the value going in and one `depth` of the travel away
//   (default 0.4), toward the middle
// Values are worked out in the lane's travel as drawn (laneView: the gain lane stops at +6 dB). The values going in
// and coming out are the lane's own, though: a gain lane held above +6 dB (an agent's, a file's) is read at its real
// level, its reach runs on to there, and the edges of the shape join it there (no 6 dB step, no cut for a Swell).
export const SHAPES = [['ramp-up', 'Ramp up'], ['ramp-down', 'Ramp down'], ['swell', 'Swell'], ['dip', 'Dip'], ['hold', 'Hold here'], ['pulse', 'Pulse']];
export const PULSE_RATES = [[0.25, '1/16'], [0.5, '1/8'], [1, '1/4'], [2, '1/2'], [4, '1 bar']];
export const PULSE_DEPTHS = [0.2, 0.4, 0.7, 1];
export function shapeLane(name, pts, spec0, from, to, stat, { every = 1, depth = 0.4 } = {}) {
  const spec = laneView(spec0);
  const has = pts.length > 0;
  const vIn = has ? valueBefore(pts, from, spec0) : stat;
  const vOut = has ? valueAt(pts, to, spec0) : stat;
  // (travel as drawn, 0..1, and past 1 for a gain value above the drawn top: the reach is up to the higher of the two)
  const P = (v) => Math.max(0, toPos(spec, v));
  const p0 = P(vIn), p1 = P(vOut), lo = Math.min(p0, p1), hi = Math.max(p0, p1), top = Math.max(1, hi);
  const V = (x) => { const q = clamp(x, 0, top); return q === p0 ? vIn : q === p1 ? vOut : viewValue(spec0, q); };
  let inner;
  switch (name) {
    case 'ramp-up': case 'ramp-down': {
      const r = rampPlan(name === 'ramp-up' ? 1 : -1, pts, spec0, from, to, stat);
      inner = shapePoints('ramp', { from, to, v0: r.v0, v1: r.v1 });
      // (no lane yet: the bars before keep the knob's value, and after the range it holds the ramp's end by itself)
      if (!has) return normPoints(r.v0 === stat ? inner : [mkPoint(from, stat), ...inner], spec0);
      // held to the lane's end: the level stretch after the range goes, and the lane ends on the ramp's last point
      if (r.until === Infinity) return normPoints([...spliceLane(pts, from, to, inner, spec0).filter((x) => x.t < to), inner[inner.length - 1]], spec0);
      // held to where the lane jumps (or next moves): that stretch is the ramp's end value, then the lane goes on
      if (r.until > to) return normPoints(spliceLane(pts, from, r.until, [...inner, mkPoint(r.until, r.v1)], spec0), spec0);
      break;
    }
    case 'swell': inner = shapePoints('swell', { from, to, v0: vIn, v1: V(Math.min(top, hi + 0.34)), vEnd: vOut }); break;
    case 'dip': inner = shapePoints('dip', { from, to, v0: vIn, v1: V(Math.max(0, lo - 0.34)), vEnd: vOut }); break;
    case 'hold': inner = shapePoints('flat', { from, to, v0: vIn }); break;
    case 'pulse': {
      const d = clamp(Number(depth) || 0.4, 0.02, 1);
      inner = shapePoints('pulse', { from, to, v0: vIn, v1: V(p0 > 0.5 ? p0 - d : p0 + d), vEnd: vOut, every: Math.max(1 / 16, Number(every) || 1) });
      break;
    }
    default: throw new Error(`no shape "${name}"`);
  }
  return normPoints(has ? spliceLane(pts, from, to, inner, spec0) : inner, spec0);
}

// Ramp up (dir 1) / Ramp down (-1) over [from, to] goes from the value going in to where the lane is going, and holds
// there (FRESH-EYES-5: on a level stretch it rose over a bar and fell straight back, leaving the chorus where it was):
//   'joins'  the value coming out of the range, when that lies that way: the ramp meets the lane, nothing after moves
//   'jump'   else, when the lane stays level after the range and then jumps that way (into the next section, or
//            wherever it was drawn): the value it jumps to, held from the end of the range up to the jump
//   'holds'  else half the travel that way, held until the lane next moves (its end, when it never does)
//   'back'   near the far end of the travel, from half the travel the other way back to where the lane is (a build:
//            it ends on the lane's own level, so it holds by itself)
// -> { v0, v1, until, how }: v0 at `from` to v1 at `to`, held to `until` (`to`: nothing after the range changes;
// Infinity: to the lane's end)
export function rampPlan(dir, pts, spec0, from, to, stat) {
  const spec = laneView(spec0);
  const has = pts.length > 0;
  const P = (v) => Math.max(0, toPos(spec, v));
  const vIn = has ? valueBefore(pts, from, spec0) : stat;
  const vOut = has ? valueAt(pts, to, spec0) : stat;
  const p0 = P(vIn);
  const thatWay = (v) => dir * (P(v) - p0) > 0.05;
  if (has && thatWay(vOut)) return { v0: vIn, v1: vOut, until: to, how: 'joins' };
  const run = has ? levelRun(pts, to, vOut, spec0) : { end: Infinity, jump: null };
  if (run.jump != null && thatWay(run.jump)) return { v0: vIn, v1: run.jump, until: run.end, how: 'jump' };
  const top = Math.max(1, p0);
  if (dir > 0 ? p0 > 0.5 : p0 <= 0.5) return { v0: viewValue(spec0, clamp(p0 - dir * 0.5, 0, top)), v1: vIn, until: to, how: 'back' };
  return { v0: vIn, v1: viewValue(spec0, clamp(p0 + dir * 0.5, 0, 1)), until: run.end, how: 'holds' };
}
// From `at` on, how long the lane stays at level v: -> { end, jump }. end: the beat it leaves that level (Infinity:
// never; `at`: it's already moving there); jump: the value it jumps to there (two points at one beat, or a step), null
// when it moves off gradually.
export function levelRun(pts, at, v, spec0) {
  const spec = laneView(spec0);
  const level = (x) => Math.abs(toPos(spec, x) - toPos(spec, v)) <= 0.005;
  const steps = discrete(spec0);
  for (let i = pts.findIndex((p) => p.t > at); i >= 0 && i < pts.length; i++) {
    if (level(pts[i].v)) continue;
    const prev = pts[i - 1];
    if (prev && level(prev.v) && (prev.t === pts[i].t || prev.c === 'step' || steps)) return { end: pts[i].t, jump: pts[i].v };
    return { end: prev && prev.t > at ? prev.t : at, jump: null };
  }
  return { end: Infinity, jump: null };
}

/* ================================================================ drawing */

// One lane row, in view coordinates: y is its top, h its height, W the canvas width; sx the scroll, pb px per beat.
// o: { pal, t, spec, pts, held, stat, sel: { from, to } | null, rec: { from, to } | [{ from, to }] | null, selPts: Set<index> }
export function drawLaneRow(g, { y, h: hh, W, sx, pb, t, spec: spec0, pts, held, stat, sel, rec, selPts, empty }) {
  const pal = palette();
  const col = resolveColor(t.color);
  const spec = laneView(spec0);
  const top = y + PAD, bh = Math.max(4, hh - PAD * 2 - 1);
  const Y = (pos) => top + (1 - clamp(pos, 0, 1)) * bh;
  const P = (v) => toPos(spec, v);
  g.save();
  g.beginPath(); g.rect(0, y, W, hh); g.clip();
  // a gain lane: unity (0 dB) as a pencil hairline, labelled at the left
  if (spec && spec.curve === 'fader') {
    const y0 = Math.round(Y(P(0))) + 0.5;
    g.strokeStyle = rgba(pal.text3, 0.55); g.lineWidth = 1; g.setLineDash([1, 3]);
    g.beginPath(); g.moveTo(0, y0); g.lineTo(W, y0); g.stroke(); g.setLineDash([]);
    if (hh >= 34) { g.font = `400 9.5px ${pal.mono || pal.ui}`; g.fillStyle = pal.text3; g.textBaseline = 'bottom'; g.textAlign = 'right'; g.fillText('0 dB', W - 6, y0 - 1); g.textAlign = 'left'; }
  }
  // the selected bars: a cream hairline frame (and the faint wash the arranger's range has)
  if (sel && sel.to > sel.from) {
    const x0 = Math.round(sel.from * pb - sx), x1 = Math.round(sel.to * pb - sx);
    g.fillStyle = rgba(pal.text, 0.035); g.fillRect(x0, y + 1, x1 - x0, hh - 3);
    g.strokeStyle = rgba(pal.text, 0.6); g.lineWidth = 1; g.strokeRect(x0 + 0.5, y + 1.5, Math.max(1, x1 - x0 - 1), hh - 4);
  }
  const recs = (Array.isArray(rec) ? rec : rec ? [rec] : []).filter((r) => r && r.to > r.from && r.to * pb - sx >= 0 && r.from * pb - sx <= W);
  const recFrame = (r) => { const x0 = Math.round(r.from * pb - sx), x1 = Math.max(x0 + 1, Math.round(r.to * pb - sx)); g.strokeStyle = pal.rec; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y + 1.5, Math.max(1, x1 - x0 - 1), hh - 4); return [x0, x1]; };
  if (!pts.length) {
    // not automated yet: the static value as a dotted pencil line, and what to do (being written: in record ink there)
    const yy = Math.round(Y(P(stat))) + 0.5;
    g.strokeStyle = pal.text3; g.lineWidth = 1; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); g.setLineDash([]);
    for (const r of recs) { const [x0, x1] = recFrame(r); g.fillStyle = pal.rec; g.fillRect(x0, Math.round(yy - 0.5), x1 - x0, 1.5); }
    if (empty && !recs.length) {
      g.font = `400 11px ${pal.ui}`; g.fillStyle = pal.text3; g.textBaseline = 'middle';
      const ty = yy < y + hh / 2 ? Math.min(y + hh - 9, yy + 10) : Math.max(y + 9, yy - 10);
      g.fillText(empty, 10, ty);
    }
    g.restore();
    return;
  }
  const b0 = sx / pb - 1, b1 = (sx + W) / pb + 1;
  const segs = segmentsIn(pts, b0, b1, spec);
  const X = (b) => b * pb - sx;
  const first = pts[0].t, last = pts[pts.length - 1].t;
  // the holds before the first point and after the last: flat, pencil
  g.strokeStyle = pal.text3; g.lineWidth = 1;
  if (X(first) > 0) { const yy = Math.round(Y(P(pts[0].v))) + 0.5; g.beginPath(); g.moveTo(0, yy); g.lineTo(X(first), yy); g.stroke(); }
  if (X(last) < W) { const yy = Math.round(Y(P(pts[pts.length - 1].v))) + 0.5; g.beginPath(); g.moveTo(X(last), yy); g.lineTo(W, yy); g.stroke(); }
  // the drawn stretch: one path through every segment in view (a jump is the vertical between two of them)
  const path = [];
  for (const s of segs) {
    if (!Number.isFinite(s.t0) || !Number.isFinite(s.t1)) continue;
    const x0 = X(s.t0), x1 = X(s.t1);
    if (x1 < -4 || x0 > W + 4) continue;
    if (s.c === 'step') { path.push([x0, Y(s.a)], [x1, Y(s.a)], [x1, Y(s.b)]); continue; }
    const xa = Math.max(-4, x0), xb = Math.min(W + 4, x1);
    path.push([x0 >= -4 ? x0 : xa, Y(posAt(s, (xa + sx) / pb))]);
    const step = s.c ? 2 : Math.max(2, xb - xa);
    for (let x = xa + step; x < xb; x += step) path.push([x, Y(posAt(s, (x + sx) / pb))]);
    path.push([x1 <= W + 4 ? x1 : xb, Y(posAt(s, (xb + sx) / pb))]);
  }
  const stroke = (color, dash) => {
    if (!path.length) return;
    g.strokeStyle = color; g.lineWidth = 1.5; g.lineJoin = 'round';
    if (dash) g.setLineDash(dash);
    g.beginPath(); g.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
    g.stroke(); g.setLineDash([]);
  };
  if (path.length) {
    if (!held) {
      // the area under the line, at the clip fill's 13%: "which part", never "who"
      g.fillStyle = rgba(col, 0.13);
      g.beginPath(); g.moveTo(path[0][0], top + bh);
      for (const [x, yy] of path) g.lineTo(x, yy);
      g.lineTo(path[path.length - 1][0], top + bh); g.closePath(); g.fill();
    }
    stroke(held ? pal.text3 : col, held ? HELD_DASH : null);
  }
  // being written: each stretch in record ink, a red frame on it, nothing else (rec: one { from, to } or a list)
  for (const r of recs) {
    const x0 = Math.round(X(r.from)), x1 = Math.max(x0 + 1, Math.round(X(r.to)));
    g.save(); g.beginPath(); g.rect(x0, y, x1 - x0, hh); g.clip(); stroke(pal.rec, null); g.restore();
    recFrame(r);
  }
  // the points: 5 px squares in the track's ink; selected, reverse print (filled cream)
  for (let i = 0; i < pts.length; i++) {
    const x = X(pts[i].t);
    if (x < -6 || x > W + 6) continue;
    drawPointSquare(g, x, Y(P(pts[i].v)), { color: held ? pal.text3 : col, on: !!(selPts && selPts.has(i)) });
  }
  g.restore();
}

/* ================================================================ the lane header (DOM, in the header column) */

// Who signs a lane: everyone who wrote a point on it but the house; nothing when it's all yours (your song). Mixed with
// you: "you and Claude". -> [by] (empty: unsigned)
export function laneSigners(app, lane) {
  if (!lane) return [];
  const all = laneAuthors(lane).filter((b) => authorKind(app, b) !== 'house');
  return all.length === 1 && all[0] === 'you' ? [] : all;
}
function signers(app, list) {
  const out = [];
  list.forEach((b, i) => { if (i) out.push(i === list.length - 1 ? ' and ' : ', '); out.push(byline(b, { app })); });
  return out;
}

css('lanes-ui', `
.ar-lname[aria-haspopup]::after { content: '⌄'; margin-left: 3px; color: var(--text-3); font-weight: 400; }
.ar-lsize { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; cursor: ns-resize; z-index: 2; touch-action: none; }
.ar-mhead { display: flex; align-items: baseline; gap: 8px; padding: 0 10px 0 12px; border-top: var(--rule-2); border-bottom: var(--rule); background: var(--bg); white-space: nowrap; overflow: hidden; }
.ar-mhead .ar-mname { font: 600 12.5px/26px var(--font-ui); color: var(--text); }
.ar-mhead .ar-lhide { margin-left: auto; height: 18px; min-height: 0; padding: 0 2px; font-size: 11px; }
.ar-lsize:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -3px; }
.ar-lhead.sizing, .ar-lhead .ar-lsize:hover { border-bottom-color: var(--line-2); }
.ar .ar-lhead .ar-ladd { margin-left: 0; }
.ar-ltip { position: fixed; z-index: 60; pointer-events: none; padding: 2px 6px; background: var(--bg-3); border: var(--rule-2); box-shadow: var(--shadow-2); font: 11.5px/1.35 var(--font-mono); color: var(--text); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ar-ltip .t3 { color: var(--text-3); }
.ar-ltip[hidden] { display: none; }
@media (max-width: 700px) { .ar-lname[aria-haspopup]::after { content: ''; margin: 0; } .ar-lsize { display: none; } }
`);

// The param's name in sentence case (a chooser: click it for another of the track's params, device and param), the
// device in pencil, a byline for everyone but you who wrote points on it ("you and Claude" when shared; the house
// unsigned); held: the name struck and "held" where the byline was. The value at the playhead in mono, Draw (a lamp;
// held, Back to the lane in its place), Hide, and on the track's last lane "+ lane". Its lower edge drags its height.
// On a phone the whole header is the name's button. From the keyboard Enter on the name picks a point (Alt+↓ the
// chooser).
export function laneHead(app, { t, addr, key, lane, info, height, draw, onDraw, onBack, onHide, onMenu, onPick, onChoose, onAdd, onResize, last = false }) {
  const held = !!lane?.off;
  const by = signers(app, laneSigners(app, lane));
  const val = h('span.ar-lval.mono', { 'aria-hidden': 'true' }, '');
  const drawBtn = h('button.tog.ar-ldraw' + (draw ? '.on' : ''), { type: 'button', 'aria-pressed': String(!!draw), title: 'Draw: paint the lane freehand (or hold ⌘ / Ctrl while you drag)', onclick: (e) => { e.stopPropagation(); onDraw(); } }, 'Draw');
  const nameBtn = h('button.ar-lname' + (held ? '.struck' : ''), {
    type: 'button',
    title: onChoose ? `${info.name}: click for another param on ${t.name}. Enter picks a point (then ←/→ between points, ↑/↓ its value, Delete)` : `${info.name}: pick a point (then ←/→ between points, ↑/↓ its value, Delete)`,
    'aria-label': `${info.name} lane on ${t.name}${held ? ', held' : ''}`,
    'aria-haspopup': onChoose ? 'menu' : null,
    onclick: (e) => {
      e.stopPropagation();
      // (a pointer's click chooses the param; Enter or Space from the keyboard (detail 0) picks a point, as it did)
      if (onChoose && e.detail > 0 && !narrowScreen()) { const r = e.currentTarget.getBoundingClientRect(); onChoose({ x: r.left, y: r.bottom + 2 }); return; }
      onPick();
    },
    onkeydown: (e) => {
      if (onChoose && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onChoose({ x: r.left, y: r.bottom + 2 }); }
    },
  }, info.name);
  const row = h('div.ar-lhead' + (held ? '.held' : ''), {
    dataset: { lane: key }, style: { height: height + 'px' },
    title: `${info.name}${info.device ? `, ${info.device}` : ''} on ${t.name}${held ? ' (held: its knob plays)' : ''}`,
  },
  h('div.ar-lrow',
    // (a button: Tab reaches the lane, Enter picks its point at the playhead, then the arrows walk the points)
    nameBtn,
    info.device ? h('span.ar-ldev', info.device) : null,
    !info.spec ? h('span.ar-ldev', 'no such param') : null,
    held ? h('span.ar-lheld', 'held') : by.length ? h('span.ar-lby', ...by) : null),
  h('div.ar-lrow.ar-lacts',
    val,
    // (held: Back to the lane takes Draw's place, so the row fits its column; Draw stays in the lane's menu)
    held ? null : drawBtn,
    held ? h('button.btn.btn-txt.ar-lback', { type: 'button', title: 'Give the lane back: it plays again', onclick: (e) => { e.stopPropagation(); onBack(); } }, 'Back to the lane') : null,
    last && onAdd && !held ? h('button.btn.btn-txt.ar-ladd', { type: 'button', title: `Open another lane on ${t.name}: Level, Pan, any knob`, 'aria-label': `Add a lane on ${t.name}`, onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onAdd({ x: r.left, y: r.bottom + 2 }); } }, '+ lane') : null,
    h('button.btn.btn-txt.ar-lhide', { type: 'button', title: 'Hide this lane (it still plays)', onclick: (e) => { e.stopPropagation(); onHide(); } }, 'Hide')));
  // the lower edge: drag it for a taller or shorter lane (remembered for this lane); ↑/↓ from the keyboard
  if (onResize) {
    const grip = h('div.ar-lsize', { role: 'separator', tabindex: '0', 'aria-orientation': 'horizontal', 'aria-label': `Height of the ${info.name} lane`, 'aria-valuenow': String(height), 'aria-valuemin': String(LANE_MIN), 'aria-valuemax': String(LANE_MAX), title: 'Drag for a taller or shorter lane' });
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const y0 = e.clientY, h0 = height;
      row.classList.add('sizing');
      const mv = (ev) => { onResize(h0 + (ev.clientY - y0), false); };
      const end = (ev) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); row.classList.remove('sizing'); onResize(h0 + ((ev.clientY ?? y0) - y0), true); };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
    grip.addEventListener('dblclick', (e) => { e.stopPropagation(); onResize(LANE_H, true); });
    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation();
      onResize(height + (e.key === 'ArrowDown' ? 8 : -8), true);
      // (landing rebuilds the headers: the keyboard stays on this lane's edge, so the next press keeps going)
      if (!grip.isConnected) [...document.querySelectorAll('.ar-lhead .ar-lsize')].find((x) => x.closest('.ar-lhead')?._lane === key)?.focus({ preventScroll: true });
    });
    row.append(grip);
  }
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); });
  // the keyboard's menu (Shift+F10, or the menu key) from the lane's name: the selected point's curve, the shapes on the
  // selected bars (or the playhead's bar), a point at the playhead
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
    e.preventDefault(); e.stopPropagation();
    const r = e.target.getBoundingClientRect();
    onMenu({ x: r.left, y: r.bottom + 2 });
  });
  row._lane = key;
  row._val = val;
  row._t = t.id;
  void addr;
  return row;
}

/* ================================================================ gestures */

// The floating value tip (one for the page): the value at the cursor while you hover, drag or pick a point.
let tipEl = null;
function tipShow(x, y, main, sub) {
  if (typeof document === 'undefined') return;
  if (!tipEl) { tipEl = h('div.ar-ltip', { 'aria-hidden': 'true', hidden: true }); document.body.append(tipEl); }
  tipEl.replaceChildren(h('span', main), sub ? h('span.t3', '  ' + sub) : null);
  tipEl.hidden = false;
  const w = tipEl.offsetWidth || 80, vw = window.innerWidth || 1200;
  tipEl.style.left = Math.round(Math.min(vw - w - 4, Math.max(4, x + 14))) + 'px';
  tipEl.style.top = Math.round(Math.max(4, y - 28)) + 'px';
}
export function tipHide() { if (tipEl && !tipEl.hidden) tipEl.hidden = true; }
// the tip now: { text, x, y } | null (for the checks)
export function tipNow() { return tipEl && !tipEl.hidden ? { text: tipEl.textContent, x: parseFloat(tipEl.style.left), y: parseFloat(tipEl.style.top) } : null; }

// What ⌘C took: { addr, spec, key, name, pts: [{ t (from the start), v, c }], len } (one per page: paste on any lane)
let clipboard = null;

// The editor: one per arranger. host = {
//   P(), ppb(), sx(), sy(), bpb(), snapGrid(e), row(key) -> { y, h } (content coords) | null, box() (the lanes'
//   canvas rect), dirty(), refresh(), say(text), scrollTo(left, top), beat() (the playhead), show(trackId, addr)
// }
export function laneEditor(app, host) {
  const { store, ui } = app;
  let sel = null;          // { key, addr, from, to }: the selected bars (from === to: one point's beat)
  let edit = null;         // the gesture in progress
  let preview = null;      // { key, points }: what a gesture would leave, drawn until it lands
  const touchy = (e) => e.pointerType === 'touch';

  const ctxOf = (addr) => {
    const p = host.P();
    const info = laneInfo(app, p, addr);
    const lane = laneAt(p, addr);
    const spec = info.spec;
    return { p, info, lane, spec, vs: laneView(spec), pts: lane ? lane.points : [], stat: staticValue(p, addr, spec) };
  };
  const geom = (row) => {
    const top = row.y - host.sy() + PAD, bh = Math.max(4, row.h - PAD * 2 - 1);
    return { top, bh, Y: (pos) => top + (1 - clamp(pos, 0, 1)) * bh, pos: (vy) => clamp(1 - (vy - top) / bh, 0, 1) };
  };
  const X = (b) => b * host.ppb() - host.sx();
  const where = (t) => {
    const bpb = host.bpb(), bar = Math.floor(t / bpb + 1e-9), inBar = t - bar * bpb;
    return Math.abs(inBar) < 1e-6 ? `bar ${bar + 1}` : `bar ${bar + 1}, beat ${Math.round((inBar + 1) * 1000) / 1000}`;
  };
  const barsText = (a, b) => {
    const bpb = host.bpb(), x = Math.floor(a / bpb + 1e-9) + 1, y = Math.max(x, Math.ceil(b / bpb - 1e-9));
    return x === y ? `bar ${x}` : `bars ${x}–${y}`;
  };
  const trackName = (addr) => (addr.track === 'master' ? 'the master' : host.P().tracks.find((t) => t.id === addr.track)?.name || addr.track);
  // the tip's words: the value, then where ("-3.0 dB  bar 3, beat 2")
  const tipText = (spec, v, t) => [fmtValue(spec, v), t == null ? '' : where(t)];
  // the tip over a point of a lane row (a key or a pick: no pointer to follow)
  function tipPoint(key, addr, i) {
    const r = host.row?.(key), box = host.box?.();
    const c = ctxOf(addr);
    if (!r || !box || !c.pts[i] || !c.spec) { tipHide(); return; }
    const G = geom(r);
    const vx = X(c.pts[i].t), vy = G.Y(toPos(c.vs, c.pts[i].v));
    if (vx < 0 || vx > box.width || vy < 0 || vy > box.height) { tipHide(); return; }
    const [a, b] = tipText(c.spec, c.pts[i].v, c.pts[i].t);
    tipShow(box.left + vx, box.top + vy, a, b);
  }

  // land a gesture: one auto.write by you (and anything else that goes with it), one undo step
  function commit(addr, before, after, label, extra = []) {
    const c = ctxOf(addr);
    const next = normPoints(after.filter((x) => x.t <= 8192), c.spec);
    const op = writeOp(addr, normPoints(before, c.spec), next);
    if (!op && !extra.length) return null;
    // (the row stays open even when this leaves the lane empty: it reads "not automated yet" until you hide it)
    const st = trackLanes(ui, addr.track);
    if (!st.extra.some((x) => laneKey(x) === laneKey(addr))) st.extra.push(A(addr));
    const r = store.dispatch([...extra, ...(op ? [op] : [])], { by: 'you', label: `${c.info.name} on ${trackName(addr)}: ${label}` });
    if (!r.ok) ui.toast(r.error, { kind: 'bad' });
    host.dirty();
    return r;
  }

  // which point is under (vx, vy) in a row, or -1 (a finger gets a 20 px reach: a 40 px target)
  function pointAt(row, pts, spec, vx, vy, reach) {
    const G = geom(row);
    let best = -1, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = X(pts[i].t) - vx, dy = G.Y(toPos(spec, pts[i].v)) - vy;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // the segment leaving point i covers beat (between two points), or -1
  const segAt = (pts, beat) => { for (let i = 0; i < pts.length - 1; i++) if (beat >= pts[i].t && beat <= pts[i + 1].t && pts[i + 1].t > pts[i].t) return i; return -1; };
  const selected = (key, pts) => {
    const out = new Set();
    if (!sel || sel.key !== key) return out;
    pts.forEach((x, i) => { if (x.t >= sel.from - EPS && x.t <= sel.to + EPS) out.add(i); });
    return out;
  };

  // pointerdown in a lane row. pt: the arranger's at(e) ({ x, y, beat, vx, vy }); row: { key, addr, y, h, t }.
  // Returns true when the lane took the gesture.
  function down(e, pt, row, clicks) {
    const { addr, key } = row;
    const c = ctxOf(addr);
    if (!c.spec) { ui.toast(`${c.info.name}: its device has no such param any more, so the lane does nothing. Remove it from the lane's menu.`); return true; }
    const G = geom(row);
    const reach = touchy(e) ? 20 : 6;
    const i = pointAt(row, c.pts, c.vs, pt.vx, pt.vy, reach);
    const drawing = laneState(ui).draw === key || ((e.metaKey || e.ctrlKey) && !touchy(e));
    const base = { addr, key, row, pt0: pt, moved: false, pts0: c.pts.map((x) => ({ ...x })), spec: c.spec, vs: c.vs, stat: c.stat, G, clicks, touch: touchy(e) };
    if (drawing) {
      edit = { ...base, mode: 'draw', raw: new Map() };
      addRaw(edit, pt, e);
    } else if (i >= 0) {
      if (clicks >= 2) {
        // double-click a point: it goes
        const next = c.pts.filter((_, k) => k !== i);
        commit(addr, c.pts, next, `deleted the point at ${where(c.pts[i].t)}`);
        sel = null; edit = null;
        return true;
      }
      if (touchy(e)) {
        // a finger on a point: a drag scrolls, as it does on the clips and the empty lane (a 40 px reach covers most of a
        // dense lane, so grabbing at once turned a scroll into a jump); a tap picks it; held still, it is picked up
        // (lift(), from the arranger's long press: its menu opens, and a drag from there moves it)
        edit = { ...base, mode: 'touchpoint', i, pan: { x: e.clientX, y: e.clientY, sl: host.sx(), st: host.sy() } };
        host.dirty();
        return true;
      }
      edit = { ...base, mode: 'point', ...grab(key, addr, c, i) };
    } else {
      const s = segAt(c.pts, pt.beat);
      const lineY = c.pts.length ? G.Y(toPos(c.vs, valueAt(c.pts, pt.beat, c.vs))) : G.Y(toPos(c.vs, c.stat));
      const nearLine = Math.abs(pt.vy - lineY) <= (touchy(e) ? 16 : 8);
      if (e.altKey && s >= 0) {
        if (clicks >= 2) { const next = c.pts.map((x, k) => (k === s ? mkPoint(x.t, x.v) : x)); commit(addr, c.pts, next, `straightened the line at ${where(pt.beat)}`); edit = null; return true; }
        const c0 = typeof c.pts[s].c === 'number' ? c.pts[s].c : 0;
        edit = { ...base, mode: 'bend', s, c0, rising: toPos(c.spec, c.pts[s + 1].v) >= toPos(c.spec, c.pts[s].v) };
      } else {
        edit = { ...base, mode: 'pending', seg: nearLine && s >= 0 ? s : -1, nearLine, lineY,
          pan: touchy(e) ? { x: e.clientX, y: e.clientY, sl: host.sx(), st: host.sy() } : null };
      }
    }
    host.dirty();
    return true;
  }

  // the points a drag on point i moves: the selection when i is in it, else i alone (selected)
  function grab(key, addr, c, i) {
    const inSel = selected(key, c.pts);
    const group = inSel.has(i) && inSel.size > 1 ? [...inSel] : [i];
    if (!inSel.has(i) || inSel.size <= 1) sel = { key, addr, from: c.pts[i].t, to: c.pts[i].t };
    return { i, group };
  }
  // a finger held still on a point picks it up: true when there was one to pick (the arranger then opens its menu)
  function lift() {
    const d = edit;
    if (!d || d.mode !== 'touchpoint' || d.moved) return false;
    const c = ctxOf(d.addr);
    if (!c.pts[d.i]) return false;
    Object.assign(d, { mode: 'point', lifted: true, pan: null, pts0: c.pts.map((x) => ({ ...x })) }, grab(d.key, d.addr, c, d.i));
    try { navigator.vibrate?.(12); } catch { /* no buzz */ }
    host.dirty();
    return true;
  }

  function addRaw(d, pt, e) {
    const g = host.snapGrid(e);
    const coarse = g >= host.bpb() - 1e-9;   // freehand snaps only to a bar or coarser
    const t = Math.max(0, coarse ? snapTo(pt.beat, g) : pt.beat);
    d.raw.set(Math.round(t * 64), mkPoint(rt(t), fromPos(d.vs, d.G.pos(pt.vy))));
    const raw = [...d.raw.values()].sort((a, b) => a.t - b.t);
    const lo = raw[0].t, hi = raw[raw.length - 1].t;
    preview = { key: d.key, points: [...d.pts0.filter((x) => x.t < lo), ...raw, ...d.pts0.filter((x) => x.t > hi)] };
  }

  function move(e, pt) {
    const d = edit;
    if (!d) return;
    const dx = pt.vx - d.pt0.vx, dy = pt.vy - d.pt0.vy;
    if (!d.moved && Math.hypot(dx, dy) < (d.touch ? 8 : 3)) return;
    if (!d.moved && d.lifted) closePopover();   // (held, then dragged: the menu goes, the point moves)
    d.moved = true;
    const fine = e.shiftKey ? 0.25 : 1;
    const g = e.shiftKey ? 0 : host.snapGrid(e);
    if (d.mode === 'draw') { addRaw(d, pt, e); const [a, b] = tipText(d.spec, fromPos(d.vs, d.G.pos(pt.vy)), null); tipShow(e.clientX, e.clientY, a, b); host.dirty(); return; }
    if ((d.mode === 'pending' || d.mode === 'touchpoint') && d.pan) {
      // a finger dragging across a lane scrolls, as on the clips (there is no wheel); hold it for the menu
      host.scrollTo(d.pan.sl - (e.clientX - d.pan.x), d.pan.st - (e.clientY - d.pan.y));
      return;
    }
    if (d.mode === 'pending') d.mode = d.seg >= 0 ? 'segment' : 'range';
    const pts = d.pts0.map((x) => ({ ...x }));
    if (d.mode === 'point') {
      const lead = d.pts0[d.i];
      let nt = lead.t + dx / host.ppb();
      nt = g ? snapTo(nt, g) : nt;
      let dt = Math.max(nt, 0) - lead.t;
      // kept between its neighbours: a point (or the selected run of points) stops a grid step short of the next
      // point either side (1/64 beat with no snap), so it can't land on one and swallow the line to it. A point
      // already at its neighbour's beat (the two halves of a jump) stays at that beat.
      {
        const gap = g > 0 ? g : 1 / 64;
        const i0 = Math.min(...d.group), i1 = Math.max(...d.group);
        const first = d.pts0[i0].t, lastT = d.pts0[i1].t;
        const prev = i0 > 0 ? d.pts0[i0 - 1] : null, next = i1 < d.pts0.length - 1 ? d.pts0[i1 + 1] : null;
        const lo = prev ? (prev.t >= first ? prev.t : Math.min(first, prev.t + gap)) : 0;
        const hi = next ? (next.t <= lastT ? next.t : Math.max(lastT, next.t - gap)) : Infinity;
        dt = clamp(dt, lo - first, hi - lastT);
      }
      const dp = (-dy / d.G.bh) * fine;
      d.group.forEach((k) => { pts[k] = mkPoint(rt(d.pts0[k].t + dt), moveValue(d.spec, d.pts0[k].v, dp), d.pts0[k].c, d.pts0[k].by); });
      d.dt = dt;
      { const q = pts[d.i]; const [a, b] = tipText(d.spec, q.v, q.t); tipShow(e.clientX, e.clientY, a, b); }
    } else if (d.mode === 'segment') {
      const dp = (-dy / d.G.bh) * fine;
      for (const k of [d.seg, d.seg + 1]) pts[k] = mkPoint(d.pts0[k].t, moveValue(d.spec, d.pts0[k].v, dp), d.pts0[k].c, d.pts0[k].by);
      { const a = fmtValue(d.spec, pts[d.seg].v), b = fmtValue(d.spec, pts[d.seg + 1].v); tipShow(e.clientX, e.clientY, a === b ? a : `${a} to ${b}`, ''); }
    } else if (d.mode === 'bend') {
      const u = -dy / d.G.bh;
      const c = clamp(d.c0 + (d.rising ? -2 : 2) * u, -1, 1);
      pts[d.s] = mkPoint(d.pts0[d.s].t, d.pts0[d.s].v, Math.abs(c) < 0.02 ? undefined : c);
    } else if (d.mode === 'range') {
      const a = Math.max(0, Math.min(d.pt0.beat, pt.beat)), b = Math.max(d.pt0.beat, pt.beat);
      const gg = host.snapGrid(e) || 0;
      const from = gg ? floorTo(a, gg) : a, to = gg ? Math.ceil(b / gg - 1e-9) * gg : b;
      sel = { key: d.key, addr: d.addr, from, to: Math.max(to, from + (gg || 0.25)) };
      { const n = selected(d.key, d.pts0).size; tipShow(e.clientX, e.clientY, barsText(sel.from, sel.to), n ? `${n} point${n === 1 ? '' : 's'}` : ''); }
      preview = null;
      host.dirty();
      return;
    }
    preview = { key: d.key, points: pts };
    host.dirty();
  }

  function up(e, pt) {
    const d = edit;
    edit = null;
    if (d && (d.moved || d.touch)) tipHide();
    const pv = preview;
    preview = null;
    host.dirty();
    if (!d) return;
    if (d.mode === 'touchpoint' && d.moved) return;   // (it scrolled)
    if (!d.moved) {
      if (d.lifted) return;   // picked up and let go where it was: its menu stays open
      if (d.mode === 'touchpoint') {
        const c = ctxOf(d.addr);
        if (c.pts[d.i]) { sel = { key: d.key, addr: d.addr, from: c.pts[d.i].t, to: c.pts[d.i].t }; host.say(`${c.info.name}, ${where(c.pts[d.i].t)}: ${fmtValue(d.spec, c.pts[d.i].v)}.`); }
        return;
      }
      if (d.mode === 'point') { host.say(`${laneInfo(app, host.P(), d.addr).name}, ${where(d.pts0[d.i].t)}: ${fmtValue(d.spec, d.pts0[d.i].v)}.`); return; }
      if (d.mode === 'bend') return;
      // a click: a point there (snapped in time; on the line, the line's value). The first one on an empty lane
      // also puts one at bar 1 with the value it had, so the first edit is a move from where it was, not a jump.
      if (d.mode === 'pending' || d.mode === 'draw') {
        const g = host.snapGrid(e);
        const t = rt(Math.max(0, g ? snapTo(d.pt0.beat, g) : d.pt0.beat));
        const v = d.mode === 'pending' && d.nearLine ? (d.pts0.length ? valueAt(d.pts0, t, d.spec) : d.stat) : fromPos(d.vs, d.G.pos(d.pt0.vy));
        const next = d.pts0.length ? [...d.pts0, mkPoint(t, v)] : t > 0 ? [mkPoint(0, d.stat), mkPoint(t, v)] : [mkPoint(0, v)];
        commit(d.addr, d.pts0, next, `a point at ${where(t)}`);
        sel = { key: d.key, addr: d.addr, from: t, to: t };
      }
      return;
    }
    if (d.mode === 'range') { if (sel) host.say(`${laneInfo(app, host.P(), d.addr).name}: ${barsText(sel.from, sel.to)} selected. Right-click for shapes.`); return; }
    if (d.mode === 'draw') {
      const raw = [...d.raw.values()].sort((a, b) => a.t - b.t);
      const drawn = thin(raw, 0.005, d.spec, { minGap: 1 / 64 });
      const lo = raw[0].t, hi = raw[raw.length - 1].t;
      const next = [...d.pts0.filter((x) => x.t < lo), ...drawn, ...d.pts0.filter((x) => x.t > hi)];
      commit(d.addr, d.pts0, next, `drew ${barsText(lo, hi)}`);
      sel = null;
      return;
    }
    if (!pv) return;
    const labels = { point: d.group?.length > 1 ? `moved ${d.group.length} points` : 'moved a point', segment: 'moved the line', bend: 'bent the line' };
    const r = commit(d.addr, d.pts0, pv.points, labels[d.mode] || 'edited');
    if (r?.ok && d.mode === 'point' && sel && sel.key === d.key && d.dt) sel = { ...sel, from: rt(sel.from + d.dt), to: rt(sel.to + d.dt) };
  }
  function cancel() { edit = null; preview = null; tipHide(); host.dirty(); }

  // the pointer over a lane row with nothing held: the tip says the value a click there makes, or the point's under it
  // (row null: off the lanes, the tip goes)
  function hover(e, pt, row) {
    if (edit) return;
    if (!row || !pt || !e) { tipHide(); return; }
    const c = ctxOf(row.addr);
    if (!c.spec) { tipHide(); return; }
    const G = geom(row);
    const i = pointAt(row, c.pts, c.vs, pt.vx, pt.vy, touchy(e) ? 20 : 6);
    let v, t;
    if (i >= 0) { v = c.pts[i].v; t = c.pts[i].t; }
    else {
      const g = host.snapGrid(e);
      t = rt(Math.max(0, g ? snapTo(pt.beat, g) : pt.beat));
      const lineV = c.pts.length ? valueAt(c.pts, pt.beat, c.spec) : c.stat;
      const near = Math.abs(pt.vy - G.Y(toPos(c.vs, lineV))) <= 8;
      v = near ? lineV : fromPos(c.vs, G.pos(pt.vy));
    }
    const [a, b] = tipText(c.spec, v, t);
    tipShow(e.clientX, e.clientY, a, b);
  }

  /* ---------------------------------------------------------------- menus */
  // the pulse's rate and depth, remembered for the next one (ui.state.lanes.pulse)
  const pulseOpts = () => { const st = laneState(ui); return st.pulse || (st.pulse = { every: 1, depth: 0.4 }); };
  const rateName = (every) => (PULSE_RATES.find(([b]) => Math.abs(b - every) < 1e-9) || [every, `${every} beats`])[1];
  function applyShape(addr, name, from, to, opts = null) {
    const c = ctxOf(addr);
    if (!c.spec) return null;
    const po = name === 'pulse' ? { ...pulseOpts(), ...(opts || {}) } : {};
    if (name === 'pulse') Object.assign(pulseOpts(), po);
    const next = shapeLane(name, c.pts, c.spec, from, to, c.stat, po);
    let label = SHAPES.find(([k]) => k === name)?.[1] || name;
    if (name === 'pulse') label = `Pulse, ${rateName(po.every)} at ${Math.round(po.depth * 100)}%`;
    const bars = barsText(from, to);
    const ramp = name === 'ramp-up' || name === 'ramp-down' ? { up: name === 'ramp-up', ...rampPlan(name === 'ramp-up' ? 1 : -1, c.pts, c.spec, from, to, c.stat) } : null;
    const r = commit(addr, c.pts, next, `${label.toLowerCase()}, ${bars}`);
    // nothing to do (the lane already does it): said, never silent
    if (!r) { ui.toast(ramp ? `${c.info.name} already ramps ${ramp.up ? 'up' : 'down'} over ${bars}, to ${fmtValue(c.spec, ramp.v1)}. Nothing changed.` : `${c.info.name} already does that over ${bars}. Nothing changed.`); return null; }
    if (r.ok) {
      sel = { key: laneKey(addr), addr: A(addr), from, to };
      if (ramp) ui.toast(rampWords(c.info.name, bars, ramp, c.spec), { action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
      else host.say(`${label} on ${c.info.name}, ${bars}.`);
    }
    return r;
  }
  // what a ramp did, with its numbers: "Cutoff ramps up over bar 3, 30 Hz to 735 Hz, and holds there to the end."
  function rampWords(name, bars, { up, v0, v1, until, how }, spec) {
    const way = up ? 'up' : 'down', f = (v) => fmtValue(spec, v);
    if (how === 'back') return `${name} ramps ${way} over ${bars}, from ${f(v0)} back ${way} to ${f(v1)}, where it was.`;
    const rest = how === 'joins' ? ', where the lane goes on.' : until === Infinity ? ', and holds there to the end.'
      : how === 'jump' ? `, and holds there into ${where(until)}.` : `, and holds there until ${where(until)}, where the lane goes on as it was.`;
    return `${name} ramps ${way} over ${bars}, ${f(v0)} to ${f(v1)}${rest}`;
  }
  // Pulse's own menu: its rate (1/16 to a bar) and its depth (how far from the value going in), each writes it
  function pulseMenu(at, addr, range) {
    const po = pulseOpts();
    const items = [{ head: `Pulse, ${barsText(range.from, range.to)}: rate` }];
    for (const [every, name] of PULSE_RATES) items.push({ label: name, sub: Math.abs(every - po.every) < 1e-9 ? 'now' : '', run: () => applyShape(addr, 'pulse', range.from, range.to, { every }) });
    items.push('-', { head: 'Depth' });
    for (const depth of PULSE_DEPTHS) items.push({ label: `${Math.round(depth * 100)}%`, sub: Math.abs(depth - po.depth) < 1e-9 ? 'now' : depth === 1 ? 'the whole travel' : '', run: () => applyShape(addr, 'pulse', range.from, range.to, { depth }) });
    return menu(at, items);
  }
  function simplify(addr) {
    const c = ctxOf(addr);
    if (c.pts.length < 3) return null;
    const next = thin(c.pts, 0.005, c.spec);
    return commit(addr, c.pts, next, `simplified (${c.pts.length} points to ${next.length})`);
  }
  // Clear: the knob takes the lane's value at the playhead first, so nothing jumps; then the lane goes
  function clear(addr) {
    const c = ctxOf(addr);
    if (!c.lane) return null;
    const v = valueAt(c.pts, host.beat(), c.spec);
    const st = trackLanes(ui, addr.track);
    if (!st.extra.some((x) => laneKey(x) === laneKey(addr))) st.extra.push(A(addr));
    const r = store.dispatch([...staticOps(addr, v), { type: 'auto.clear', ...A(addr) }], { by: 'you', label: `cleared the ${c.info.name} lane on ${trackName(addr)}` });
    if (!r.ok) ui.toast(r.error, { kind: 'bad' });
    else { sel = null; ui.toast(`Cleared the ${c.info.name} lane. The knob stays at ${fmtValue(c.spec, v)}.`, { action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } }); }
    return r;
  }
  function back(addr) {
    const c = ctxOf(addr);
    if (!c.lane?.off) return null;
    const r = store.dispatch({ type: 'auto.set', ...A(addr), patch: { off: false } }, { by: 'you', label: `${c.info.name} on ${trackName(addr)} back to its lane` });
    if (!r.ok) ui.toast(r.error, { kind: 'bad' });
    return r;
  }
  function setCurve(addr, i, cv, label) {
    const c = ctxOf(addr);
    if (!c.pts[i]) return null;
    const next = c.pts.map((x, k) => (k === i ? mkPoint(x.t, x.v, cv) : x));
    return commit(addr, c.pts, next, label);
  }
  function deleteSelected() {
    if (!sel) return false;
    const c = ctxOf(sel.addr);
    const keep = c.pts.filter((x) => !(x.t >= sel.from - EPS && x.t <= sel.to + EPS));
    if (keep.length === c.pts.length) return false;
    const n = c.pts.length - keep.length;
    commit(sel.addr, c.pts, keep, n > 1 ? `deleted ${n} points` : `deleted the point at ${where(sel.from)}`);
    sel = null; tipHide();
    return true;
  }
  // ←/→: the previous / next point; ↑/↓: its value (shift: ten times as far). One undo step per press, run together.
  function stepPoint(dir) {
    if (!sel) return;
    const c = ctxOf(sel.addr);
    if (!c.pts.length) return;
    const i = stepIndex(c.pts, sel, dir);
    sel = { ...sel, from: c.pts[i].t, to: c.pts[i].t };
    host.dirty();
    // (a jump is two points at one beat, picked together: "points 2 and 3 of 4, bar 2: jumps from −20.0 dB to 0.0 dB")
    const j = c.pts[i + 1] && c.pts[i + 1].t === c.pts[i].t ? i + 1 : i;
    host.say(j > i
      ? `${c.info.name}, points ${i + 1} and ${j + 1} of ${c.pts.length}, ${where(c.pts[i].t)}: jumps from ${fmtValue(c.spec, c.pts[i].v)} to ${fmtValue(c.spec, c.pts[j].v)}.`
      : `${c.info.name}, point ${i + 1} of ${c.pts.length}, ${where(c.pts[i].t)}: ${fmtValue(c.spec, c.pts[i].v)}.`);
    tipPoint(sel.key, sel.addr, j);
  }
  function nudge(dir, big) {
    if (!sel) return;
    const c = ctxOf(sel.addr);
    const inSel = selected(sel.key, c.pts);
    if (!inSel.size) return;
    const next = c.pts.map((x, k) => (inSel.has(k) ? mkPoint(x.t, nudgeValue(c.spec, x.v, dir, big), x.c, x.by) : x));
    const op = writeOp(sel.addr, c.pts, normPoints(next, c.spec));
    // (at the top or the bottom already: nothing to write, but the value is still said)
    if (!op) { const k = [...inSel][0]; if (c.pts[k]) host.say(`${c.info.name}: ${fmtValue(c.spec, c.pts[k].v)}, its ${dir > 0 ? 'top' : 'bottom'}.`); return; }
    const r = store.dispatch(op, { by: 'you', label: `${c.info.name} on ${trackName(sel.addr)}: nudged`, coalesce: `auto:${sel.key}` });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return; }
    const k = [...inSel][0], now = ctxOf(sel.addr).pts[k];
    if (now) { host.say(`${c.info.name}: ${fmtValue(c.spec, now.v)}.`); tipPoint(sel.key, sel.addr, k); }
    host.dirty();
  }

  // the lane's menu (right-click, or touch and hold): on a point its curve; shapes on the selected bars, or the bar
  // under it; then Simplify, Clear, Hide
  function openMenu(at, row, pt, more = []) {
    const { addr, key } = row;
    const c = ctxOf(addr);
    const items = [{ head: `${c.info.name}${c.info.device ? `, ${c.info.device}` : ''} on ${trackName(addr)}` }];
    // (no pointer: the keyboard's menu, on the point selected on this lane, if one is)
    const selPoint = () => (sel && sel.key === key && sel.to - sel.from <= EPS ? c.pts.findIndex((x) => Math.abs(x.t - sel.from) <= EPS) : -1);
    if (c.spec) {
      const i = pt ? pointAt(row, c.pts, c.vs, pt.vx, pt.vy, pt.touch ? 20 : 8) : selPoint();
      if (i >= 0) {
        sel = { key, addr, from: c.pts[i].t, to: c.pts[i].t };
        items.push(
          { label: 'Delete the point', kbd: 'dbl-click', run: () => { sel = { key, addr, from: c.pts[i].t, to: c.pts[i].t }; deleteSelected(); } },
          { label: 'Straight', sub: 'to the next point', run: () => setCurve(addr, i, undefined, 'straight line') },
          { label: 'Ease in', sub: 'starts slow', run: () => setCurve(addr, i, 0.5, 'eased in') },
          { label: 'Ease out', sub: 'starts fast', run: () => setCurve(addr, i, -0.5, 'eased out') },
          { label: 'Step', sub: 'holds, then jumps', run: () => setCurve(addr, i, 'step', 'a step') },
          '-');
      }
    }
    if (c.spec) {
      const bpb = host.bpb();
      const at0 = pt ? pt.beat : sel && sel.key === key ? sel.from : host.beat();
      const range = sel && sel.key === key && sel.to - sel.from > EPS ? { from: sel.from, to: sel.to }
        : { from: floorTo(Math.max(0, at0), bpb), to: floorTo(Math.max(0, at0), bpb) + bpb };
      if (range) {
        items.push({ head: `Shapes, ${barsText(range.from, range.to)}` });
        for (const [k, label] of SHAPES) {
          if (k === 'pulse') { const po = pulseOpts(); items.push({ label: 'Pulse…', sub: `${rateName(po.every)}, ${Math.round(po.depth * 100)}%`, run: () => setTimeout(() => pulseMenu(at, addr, range), 0) }); }
          else items.push({ label, run: () => applyShape(addr, k, range.from, range.to) });
        }
        items.push('-');
      }
    }
    const st = laneState(ui);
    if (c.spec && !pt) items.push({ label: 'A point at the playhead', sub: 'its value now, so nothing jumps', run: () => pointHere(addr) });
    if (sel && sel.key === key && selected(key, c.pts).size) items.push({ label: 'Copy the points', kbd: `${MODK}C`, run: () => copy() });
    if (clipboard && c.spec) items.push({ label: 'Paste at the playhead', kbd: `${MODK}V`, sub: `${clipboard.pts.length} point${clipboard.pts.length === 1 ? '' : 's'}`, run: () => paste(addr) });
    items.push(
      { label: st.draw === key ? 'Stop drawing' : 'Draw freehand', sub: 'paint the lane', run: () => { st.draw = st.draw === key ? null : key; host.refresh(); } },
      { label: 'Simplify', disabled: c.pts.length < 3, sub: 'fewer points, same line', run: () => simplify(addr) },
      ...(c.lane?.off ? [{ label: 'Back to the lane', sub: 'it plays again', run: () => back(addr) }] : []),
      { label: 'Clear', danger: true, disabled: !c.lane, sub: 'the knob keeps the value here', run: () => clear(addr) },
      ...more);
    return menu(at, items);
  }

  // a point at the playhead's beat with the value the lane (or the knob) has there, selected: nothing jumps, and the
  // arrows take it from there. The keyboard's way to a first point (Enter on an empty lane, or the lane's menu).
  function pointHere(addr) {
    const c = ctxOf(addr);
    if (!c.spec) return null;
    const t = rt(Math.max(0, Math.floor(host.beat() + 1e-6)));
    const i0 = c.pts.findIndex((x) => Math.abs(x.t - t) <= EPS);
    if (i0 < 0) {
      const v = c.pts.length ? valueAt(c.pts, t, c.spec) : c.stat;
      const r = commit(addr, c.pts, [...c.pts, mkPoint(t, v)], `a point at ${where(t)}`);
      if (!r?.ok) return r;
    }
    const now = ctxOf(addr), i = now.pts.findIndex((x) => Math.abs(x.t - t) <= EPS);
    if (i < 0) return null;
    sel = { key: laneKey(addr), addr: A(addr), from: now.pts[i].t, to: now.pts[i].t };
    host.dirty();
    host.say(`${now.info.name}: a point at ${where(t)}, ${fmtValue(now.spec, now.pts[i].v)}, point ${i + 1} of ${now.pts.length}. Up and down arrows change it, left and right move between points, Shift+F10 for curves and shapes.`);
    tipPoint(laneKey(addr), addr, i);
    return { ok: true, i };
  }
  // the keyboard's way in: the point at (or after) the playhead, selected; the arrows take it from there. An empty lane
  // gets its first point there (with the knob's value: nothing changes until the arrows move it).
  function pick(addr) {
    const c = ctxOf(addr);
    if (!c.spec) { host.say(`${c.info.name}: its device has no such param any more.`); return false; }
    if (!c.pts.length) return !!pointHere(addr)?.ok;
    const b = host.beat();
    let i = c.pts.findIndex((x) => x.t >= b - EPS);
    if (i < 0) i = c.pts.length - 1;
    sel = { key: laneKey(addr), addr: A(addr), from: c.pts[i].t, to: c.pts[i].t };
    host.dirty();
    host.say(`${c.info.name}, point ${i + 1} of ${c.pts.length}, ${where(c.pts[i].t)}: ${fmtValue(c.spec, c.pts[i].v)}. Left and right arrows move between points, up and down change it, Delete removes it.`);
    tipPoint(laneKey(addr), addr, i);
    return true;
  }

  /* ---------------------------------------------------------------- copy and paste */
  // ⌘C: the selected points (a range: from its start; points: from the first), with the lane they came from
  function copy() {
    if (!sel) return false;
    const c = ctxOf(sel.addr);
    const idx = [...selected(sel.key, c.pts)].sort((a, b) => a - b);
    if (!idx.length || !c.spec) return false;
    const range = sel.to - sel.from > EPS;
    const base = range ? sel.from : c.pts[idx[0]].t;
    const len = range ? sel.to - sel.from : c.pts[idx[idx.length - 1]].t - base;
    clipboard = { addr: A(sel.addr), key: sel.key, spec: c.spec, name: c.info.name, len: rt(len), pts: idx.map((k) => ({ t: rt(c.pts[k].t - base), v: c.pts[k].v, c: c.pts[k].c })) };
    const n = idx.length;
    ui.toast(`Copied ${n} point${n === 1 ? '' : 's'} from ${c.info.name} (${range ? barsText(sel.from, sel.to) : where(base)}). ${MODK}V pastes ${n === 1 ? 'it' : 'them'} at the playhead.`, { ms: 2600 });
    return true;
  }
  const canPaste = () => !!clipboard;
  // ⌘V: the copied points at the playhead, on the selected lane (else the one they came from, else the only lane
  // showing), over what was there for their length; another param takes them by travel (a sweep on a cutoff is a sweep
  // on a level). One undo step. Only ever on a lane you can see: a selection left on a lane since hidden doesn't count.
  function paste(addr0 = null) {
    if (!clipboard) return null;
    const addr = addr0 || pasteTarget();
    if (!addr) {
      ui.toast(`Pick a point on the lane to paste onto: ${trackName(clipboard.addr)}'s ${clipboard.name} lane is hidden.`, { ms: 2600 });
      return null;
    }
    const c = ctxOf(addr);
    if (!c.spec) return null;
    const at = rt(Math.max(0, host.beat()));
    const same = laneKey(addr) === clipboard.key || (c.spec.key === clipboard.spec.key && c.spec.min === clipboard.spec.min && c.spec.max === clipboard.spec.max && c.spec.curve === clipboard.spec.curve);
    const sv = laneView(clipboard.spec);
    const conv = (v) => (same ? v : fromPos(c.vs, clamp(toPos(sv, v), 0, 1)));
    const pts = clipboard.pts.map((x) => mkPoint(rt(at + x.t), conv(x.v), x.c));
    const to = rt(at + clipboard.len);
    let next;
    if (!c.pts.length) next = pts;
    else if (to > at) next = spliceLane(c.pts, at, to, pts, c.spec);
    else next = [...c.pts.filter((x) => Math.abs(x.t - at) > EPS), ...pts];
    const n = pts.length;
    const r = commit(addr, c.pts, next, `pasted ${n} point${n === 1 ? '' : 's'} at ${where(at)}`);
    if (r?.ok) {
      sel = { key: laneKey(addr), addr: A(addr), from: at, to: to > at ? to : at };
      ui.toast(`Pasted ${n} point${n === 1 ? '' : 's'} on ${trackName(addr)}'s ${c.info.name} lane at ${where(at)}${same ? '' : ` (from ${clipboard.name}, by travel)`}.`, { action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    }
    return r;
  }
  // where ⌘V lands: the selected lane, the lane the points came from, or the one lane showing, if it is showing
  function pasteTarget() {
    const shown = (a) => !host.row || !!host.row(laneKey(a));
    if (sel && shown(sel.addr)) return sel.addr;
    if (shown(clipboard.addr)) return clipboard.addr;
    if (!host.row) return null;
    const p = host.P(), rows = [];
    for (const t of [...p.tracks, masterTrack(p)]) for (const r of shownLanes(app, p, t)) if (host.row(r.key)) rows.push(r.addr);
    return rows.length === 1 ? rows[0] : null;
  }

  /* ---------------------------------------------------------------- which param a row shows */
  // the params a track (or the master) can automate, as a menu grouped by device: on a lane's name it swaps the row to
  // another param (the old lane, if it has points, is hidden and still plays); from "+ lane" it opens one more
  function paramMenu(at, t, row = null) {
    const p = host.P();
    const have = new Set(lanesOf(p).filter((l) => l.track === t.id).map((l) => l.key));
    const shown = new Set(shownLanes(app, p, t).map((x) => x.key));
    const items = [{ head: row ? `${laneInfo(app, p, row.addr).name} on ${t.name}: show instead` : `Add a lane on ${t.name}` }];
    let dev = null;
    for (const q of laneParams(app, p, t)) {
      const d = q.device || 'Mixer';
      if (d !== dev) { if (dev !== null) items.push({ head: d }); else if (d !== 'Mixer') items.push({ head: d }); dev = d; }
      const here = row && q.key === row.key;
      items.push({ label: q.name, disabled: here || (!row && shown.has(q.key)), sub: here ? 'this lane' : shown.has(q.key) ? 'shown' : have.has(q.key) ? 'has points' : '', run: () => (row ? swap(row, t, q.addr) : host.show?.(t.id, q.addr)) });
    }
    // (adding: the master's lanes too, its level and its inserts' knobs, in their own block under the last track)
    if (!row && t.id !== 'master' && p.master) {
      const mt = masterTrack(p), mh = new Set(lanesOf(p).filter((l) => l.track === 'master').map((l) => l.key));
      items.push({ head: 'Master' });
      for (const q of laneParams(app, p, mt)) items.push({ label: q.name === 'Level' ? 'Master level' : q.name, sub: mh.has(q.key) ? 'has points' : q.device || '', run: () => host.show?.('master', q.addr) });
    }
    return menu(at, items);
  }
  function swap(row, t, addr) {
    const st = trackLanes(ui, t.id);
    const p = host.P(), oldKey = row.key, key = laneKey(addr);
    st.extra = st.extra.filter((x) => laneKey(x) !== oldKey);
    if (laneAt(p, row.addr) && !st.hide.includes(oldKey)) st.hide.push(oldKey);
    st.hide = st.hide.filter((k) => k !== key);
    if (!st.extra.some((x) => laneKey(x) === key)) st.extra.push(A(addr));
    st.open = true;
    st.focus = key;
    if (sel && sel.key === oldKey) sel = null;
    if (laneState(ui).draw === oldKey) laneState(ui).draw = null;
    host.refresh?.();
    const a = laneInfo(app, p, row.addr).name, b = laneInfo(app, p, addr);
    host.say(`${b.name}${b.device ? `, ${b.device}` : ''} lane in place of ${a}${laneAt(p, row.addr) ? ` (${a} still plays; its lane is hidden)` : ''}.`);
    return key;
  }

  return {
    down, move, up, cancel, hover, lift, openMenu, pick, pointHere, applyShape, simplify, clear, back, deleteSelected, stepPoint, nudge,
    copy, paste, canPaste, paramMenu, pulseMenu, tipHide,
    get sel() { return sel; },
    set sel(v) { sel = v; if (!v) tipHide(); host.dirty(); },
    get editing() { return !!edit; },
    // what to draw for a lane this frame: { pts, selPts }
    view(key, pts) {
      const shown = preview && preview.key === key ? normPoints(preview.points) : pts;
      const keep = sel;
      if (sel && edit && edit.mode === 'point' && edit.dt && edit.key === key) sel = { ...sel, from: sel.from + edit.dt, to: sel.to + edit.dt };
      const selPts = selected(key, shown);
      sel = keep;
      return { pts: shown, selPts, sel: sel && sel.key === key && sel.to - sel.from > EPS ? sel : null };
    },
  };
}
