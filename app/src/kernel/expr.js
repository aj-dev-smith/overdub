// @ts-check
// Expression: pitch bend, the mod wheel and the sustain pedal, on their way into kernel instruments.
// docs/DEVICES.md ("Expression") is the contract; kernel/worklet.js's KernelCore does the playing.
//
// Two ways in, and a kernel reads both the same way (t.bend, t.mod, t.sustain in render and process):
//   - the channel (MIDI 1.0): instance.expr({ bend?, mod?, sustain? }, time). input/midi.js sends the wheels and the
//     pedal here; bend is in semitones (the controller's 14 bits times the bend range).
//   - the note (from note data, so a render repeats it): a note may carry
//       bend: semitones for the whole note, or [[beat, semis], ...] (beats from the note's start, linear between
//             points, the first value before the first point and the last after the last)
//       mod:  0..1, or [[beat, value], ...] the same way
//     The engine, the browser render and the Node renderer turn them into seconds (noteExpr below) and send them with
//     the note-on. Inside a voice's render, t.bend is the channel's plus the note's own; t.mod is their sum, clamped.
//
//   noteExpr(note, spb, into = 0) -> null | { bend, mod }   seconds (a number, or a flat [sec, v, sec, v, ...] array);
//                                   into: beats the note had already sounded (a note chased from mid-song)
//   normCurve(x, lo, hi)          -> undefined | number | [[beat, v], ...]   (the stored form, sorted and clamped)
//   chanExpr(x)                   -> { bend?, mod?, sustain? }   a channel message, clamped
export const BEND_MAX = 48;   // semitones either way
export const CURVE_MAX = 64;  // points in one note's curve

const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const r4 = (x) => Math.round(x * 10000) / 10000;

// The stored form of a note's bend or mod. Returns undefined when there is nothing (or nothing sane) to store.
export function normCurve(x, lo, hi) {
  if (x == null) return undefined;
  if (fin(x)) return x === 0 ? undefined : r4(clamp(x, lo, hi));
  if (!Array.isArray(x)) return undefined;
  const pts = [];
  for (const pt of x) {
    if (!Array.isArray(pt) || !fin(pt[0]) || !fin(pt[1])) continue;
    pts.push([r4(Math.max(0, pt[0])), r4(clamp(pt[1], lo, hi))]);
  }
  if (!pts.length) return undefined;
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length > CURVE_MAX) pts.length = CURVE_MAX;
  if (pts.every((p) => p[1] === 0)) return undefined;
  return pts;
}

// beats -> seconds (flat), shifted back by `into` beats. A curve is kept whole: the kernel evaluates it per block.
function secs(x, spb, into, lo, hi) {
  const c = normCurve(x, lo, hi);
  if (c === undefined) return undefined;
  if (typeof c === 'number') return c;
  const out = new Array(c.length * 2);
  for (let i = 0; i < c.length; i++) { out[2 * i] = (c[i][0] - into) * spb; out[2 * i + 1] = c[i][1]; }
  return out;
}

export function noteExpr(note, spb, into = 0) {
  if (!note || (note.bend == null && note.mod == null)) return null;
  const s = fin(spb) && spb > 0 ? spb : 0.5, k = fin(into) && into > 0 ? into : 0;
  const bend = secs(note.bend, s, k, -BEND_MAX, BEND_MAX), mod = secs(note.mod, s, k, 0, 1);
  if (bend === undefined && mod === undefined) return null;
  const x = {};
  if (bend !== undefined) x.bend = bend;
  if (mod !== undefined) x.mod = mod;
  return x;
}

export function chanExpr(x) {
  const o = {};
  if (!x || typeof x !== 'object') return o;
  if (fin(x.bend)) o.bend = clamp(x.bend, -BEND_MAX, BEND_MAX);
  if (fin(x.mod)) o.mod = clamp(x.mod, 0, 1);
  if (x.sustain != null) o.sustain = !!x.sustain;
  return o;
}
