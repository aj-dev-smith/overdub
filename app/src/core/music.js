// Music theory and the text formats agents use. Pure functions; works in Node and the browser.
//
//   noteName(60) -> 'C4'        parsePitch('F#3') -> 54       mtof(69) -> 440
//   parseNotes('C4@0:0.5 E4@0.5:0.5*0.9')   -> [{ p, t, d, v }]       formatNotes(notes) -> text
//   parseGrid({ steps: 16, rows: { kick: 'x...x...' } })      -> drum notes (General MIDI)
//   kitNotes(def) -> a drum kit's own names for its notes ; drumName(40, kitNotes(def)) -> 'Rimshot' (GM's otherwise)
//   SCALES, scalePitches(root, scale, lo, hi), inScale(p, key), snapToScale(p, key), quantize(t, grid, strength)
//   chordName(pitches, key?), CHORDS, chordPitches('Am7', octave)
//   keySpelling(key), spellPc(8, { root: 'C', scale: 'minor' }) -> 'Ab' (names spelled for a key)

import { normCurve, BEND_MAX } from '../kernel/expr.js';

export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = { Db: 1, Eb: 3, Gb: 6, Ab: 8, Bb: 10, Cb: 11, Fb: 4, 'E#': 5, 'B#': 0 };
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f) => 69 + 12 * Math.log2(f / 440);
export const noteName = (p) => NAMES[((Math.round(p) % 12) + 12) % 12] + (Math.floor(Math.round(p) / 12) - 1);
export const pcName = (pc) => NAMES[((pc % 12) + 12) % 12];

// 'C4' -> 60, 'F#3' -> 54, 'Bb2' -> 46, '60' -> 60. Returns NaN when it can't.
export function parsePitch(s) {
  if (typeof s === 'number') return s;
  s = String(s).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(s);
  if (!m) return NaN;
  let pc = PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return pc + (Number(m[3]) + 1) * 12;
}
export function parsePc(s) {
  s = String(s).trim();
  if (FLATS[s] != null) return FLATS[s];
  const m = /^([A-Ga-g])([#b♯♭]*)$/.exec(s);
  if (!m) return NaN;
  let pc = PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

/* ---------------------------------------------------------------- scales and keys */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10], harmonicMinor: [0, 2, 3, 5, 7, 8, 11], melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  majorPentatonic: [0, 2, 4, 7, 9], minorPentatonic: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const keyLabel = (key) => (key ? `${key.root} ${key.scale.replace(/([A-Z])/g, ' $1').toLowerCase()}` : 'No key');
export function scalePcs(key) {
  if (!key) return SCALES.chromatic;
  const root = parsePc(key.root), sc = SCALES[key.scale] || SCALES.major;
  return sc.map((i) => (root + i) % 12);
}
export const inScale = (p, key) => scalePcs(key).includes(((Math.round(p) % 12) + 12) % 12);
export function snapToScale(p, key) {
  if (!key) return Math.round(p);
  const pcs = scalePcs(key);
  let best = Math.round(p), bd = 99;
  for (let q = Math.floor(p) - 2; q <= Math.ceil(p) + 2; q++) {
    if (!pcs.includes(((q % 12) + 12) % 12)) continue;
    const d = Math.abs(q - p);
    if (d < bd - 1e-9) { bd = d; best = q; }
  }
  return best;
}
export function scalePitches(key, lo = 48, hi = 72) {
  const out = [];
  for (let p = lo; p <= hi; p++) if (inScale(p, key)) out.push(p);
  return out;
}

/* ---------------------------------------------------------------- chords */
export const CHORDS = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], 5: [0, 7],
  7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], 9: [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14],
};
// 'Am7' -> pitches around octave 4 (root at or above C3 by default)
export function chordPitches(sym, octave = 3) {
  const m = /^([A-G][#b]?)(.*)$/.exec(String(sym).trim());
  if (!m || !(m[2] in CHORDS)) return [];
  const root = parsePc(m[1]) + (octave + 1) * 12;
  return CHORDS[m[2]].map((i) => root + i);
}
/* ---------------------------------------------------------------- spelling in a key */
// Names spelled for a key: one letter per scale degree (C minor is C D Eb F G Ab Bb, never G#), and a note outside
// the scale takes the key's side (flats in a flat key, sharps in a sharp one; in C major or A minor the usual
// borrowed notes: C# Eb F# Ab Bb). With no key, the plain sharp names (NAMES).
//   keySpelling({ root: 'C', scale: 'minor' }) -> ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']
//   spellPc(8, key) -> 'Ab'     spellNote(68, key) -> 'Ab4'     chordName(pitches, key) -> 'Ab', 'Fm7', 'Eb/G'
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NEUTRAL = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const spellCache = new Map();
function spellFrom(rootName, steps) {
  const L = LETTERS.indexOf(rootName[0].toUpperCase());
  const root = parsePc(rootName);
  return steps.map((iv, i) => {
    const letter = LETTERS[(L + i) % 7], pc = (root + iv) % 12;
    let acc = ((pc - PC[letter]) % 12 + 12) % 12;
    if (acc > 6) acc -= 12;
    return { pc, name: letter + (acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc)), odd: Math.abs(acc) > 1 };
  });
}
export function keySpelling(key) {
  if (!key || !key.root || Number.isNaN(parsePc(key.root))) return NAMES.slice();
  const id = `${key.root} ${key.scale}`;
  if (spellCache.has(id)) return spellCache.get(id).slice();
  let sc = SCALES[key.scale];
  if (!sc || sc.length !== 7) sc = /minor|blues/i.test(key.scale || '') ? SCALES.minor : SCALES.major;
  let root = String(key.root).replace('♯', '#').replace('♭', 'b');
  let deg = spellFrom(root, sc);
  // D# major would need double sharps: spell it from its enharmonic (Eb) instead
  if (deg.some((d) => d.odd)) { root = (root.includes('#') ? FLAT_NAMES : NAMES)[parsePc(root)]; deg = spellFrom(root, sc); }
  const flats = deg.some((d) => /b/.test(d.name)), sharps = deg.some((d) => /#/.test(d.name));
  const base = flats && !sharps ? FLAT_NAMES : sharps && !flats ? NAMES : NEUTRAL;
  const out = base.slice();
  for (const d of deg) out[d.pc] = d.name;
  spellCache.set(id, out);
  return out.slice();
}
export const spellPc = (pc, key) => (key ? keySpelling(key) : NAMES)[((Math.round(pc) % 12) + 12) % 12];
export const spellNote = (p, key) => spellPc(p, key) + (Math.floor(Math.round(p) / 12) - 1);

// A best-guess name for a set of pitches ('Am7', 'C', 'G5'), or '' if nothing fits. With a key, spelled for it.
export function chordName(pitches, key = null) {
  const pcName = (pc) => spellPc(pc, key);
  const pcs = [...new Set(pitches.map((p) => ((Math.round(p) % 12) + 12) % 12))];
  if (pcs.length < 2) return pcs.length ? pcName(pcs[0]) : '';
  const bass = ((Math.round(Math.min(...pitches)) % 12) + 12) % 12;
  let best = '', bestScore = -1;
  for (const root of pcs) {
    const rel = pcs.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b);
    for (const [q, iv] of Object.entries(CHORDS)) {
      const set = new Set(iv.map((i) => i % 12));
      if (rel.length !== set.size || !rel.every((r) => set.has(r))) continue;
      const score = 10 - iv.length + (root === bass ? 5 : 0);
      if (score > bestScore) { bestScore = score; best = pcName(root) + q + (root === bass ? '' : '/' + pcName(bass)); }
    }
  }
  return best;
}

/* ---------------------------------------------------------------- time */
export const beatsPerBar = (meter) => (meter ? meter[0] * (4 / meter[1]) : 4);
// A meter Overdub can draw and play: 1 to 32 beats of a whole, half, quarter … 32nd note. Everything that sets
// one (project.set, cleanProject, a MIDI file's time signature) holds to this, so a corrupt or crafted value can't
// make a bar a billionth of a beat long.
export const METER_UNITS = [1, 2, 4, 8, 16, 32];
export const validMeter = (m) => Array.isArray(m) && m.length === 2 && Number.isInteger(m[0]) && m[0] >= 1 && m[0] <= 32 && METER_UNITS.includes(m[1]);
export const beatToSec = (b, bpm) => (b * 60) / bpm;
export const secToBeat = (s, bpm) => (s * bpm) / 60;
// "bar.beat.sixteenth" (1-based), as a DAW shows it
export function posLabel(beat, meter = [4, 4]) {
  const bpb = beatsPerBar(meter);
  const bar = Math.floor(beat / bpb) + 1, inBar = beat - (bar - 1) * bpb;
  const bt = Math.floor(inBar) + 1, six = Math.floor((inBar - Math.floor(inBar)) * 4) + 1;
  return `${bar}.${bt}.${six}`;
}
// Move t toward the nearest grid line by strength (0..1). swing (0..1) delays every second grid step.
export function quantize(t, grid = 0.25, strength = 1, swing = 0) {
  const n = Math.round(t / grid);
  let target = n * grid;
  if (swing && n % 2 === 1) target += grid * swing * 0.5;
  return t + (target - t) * strength;
}

/* ---------------------------------------------------------------- the notes text format */
// "pitch@start:dur[*vel]" separated by spaces or commas. A # that starts a line or a word comments out the rest of
// the line (a sharp, C#4, is inside a word).
export function parseNotes(text) {
  if (Array.isArray(text)) return text.map(normNote);
  const out = [];
  const errors = [];
  for (const raw of String(text).replace(/(^|[\s,;])#[^\n]*/g, '$1').split(/[\s,;]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    const m = /^([^@]+)@(-?[\d.]+(?:\/\d+)?):([\d.]+(?:\/\d+)?)(?:\*([\d.]+))?$/.exec(tok);
    if (!m) { errors.push(tok); continue; }
    const p = parsePitch(m[1]);
    if (!Number.isFinite(p)) { errors.push(tok); continue; }
    let v = m[4] == null ? 0.8 : Number(m[4]);
    if (v > 1) v = v / 127; // tolerate MIDI velocities
    out.push(normNote({ p, t: frac(m[2]), d: frac(m[3]), v }));
  }
  if (errors.length) {
    const e = new Error(`could not read note(s): ${errors.slice(0, 5).join(' ')}${errors.length > 5 ? ' …' : ''} — expected pitch@start:dur[*vel], e.g. C4@0:0.5 or 60@1.5:0.25*0.9`);
    e.partial = out;
    throw e;
  }
  return out;
}
function frac(s) { if (String(s).includes('/')) { const [a, b] = String(s).split('/'); return Number(a) / Number(b); } return Number(s); }
const r4 = (x) => Math.round(x * 10000) / 10000;
// A note that can't be read (an unknown pitch, a start that isn't a number) throws "could not read note"; a missing or
// unreadable length or velocity falls back to the default.
export function normNote(n) {
  if (!n || typeof n !== 'object') throw new Error(`could not read note ${JSON.stringify(n)}: expected { p, t, d?, v? }`);
  const p = Math.max(0, Math.min(127, Math.round(parsePitch(n.p ?? n.pitch))));
  const t = Math.max(0, r4(Number(n.t ?? n.start ?? 0)));
  if (!Number.isFinite(p) || !Number.isFinite(t)) throw new Error(`could not read note ${JSON.stringify({ p: n.p ?? n.pitch, t: n.t ?? n.start })}: p is a pitch (C4, F#3, 60) and t a start in beats`);
  const d0 = Number(n.d ?? n.dur ?? n.duration ?? 0.25);
  const d = Math.max(1 / 64, r4(Number.isFinite(d0) ? d0 : 0.25));
  let v = Number(n.v ?? n.vel ?? n.velocity ?? 0.8);
  if (!Number.isFinite(v)) v = 0.8;
  if (v > 1) v /= 127;
  const out = { p, t, d, v: Math.max(0.01, Math.min(1, r4(v))) };
  // expression (kernel/expr.js): bend in semitones and mod 0..1, each a number or [[beat, value], ...] from the start
  const bend = normCurve(n.bend, -BEND_MAX, BEND_MAX), mod = normCurve(n.mod, 0, 1);
  if (bend !== undefined) out.bend = bend;
  if (mod !== undefined) out.mod = mod;
  // where a guitarist plays it (core/fretboard.js): s the string (0 the lowest), f the fret from the nut. Both or
  // neither; the pitch stays the truth (a place that no longer matches it is re-fingered where tab is drawn)
  if (isPlace(n.s, n.f)) { out.s = n.s; out.f = n.f; }
  if (n.id) out.id = n.id;
  if (n.by) out.by = n.by;
  return out;
}
// A note's place on a fretted neck: a whole string number from 0 (the lowest; up to 12 strings) and a whole fret from 0
// (the nut) to 36. Older readers skip both fields.
export const isPlace = (s, f) => Number.isInteger(s) && s >= 0 && s <= 11 && Number.isInteger(f) && f >= 0 && f <= 36;
export function formatNotes(notes, { names = true } = {}) {
  return [...notes].sort((a, b) => a.t - b.t || a.p - b.p)
    .map((n) => `${names ? noteName(n.p) : n.p}@${r4(n.t)}:${r4(n.d)}${Math.abs(n.v - 0.8) > 0.005 ? '*' + r4(n.v) : ''}`).join(' ');
}

/* ---------------------------------------------------------------- drum grids */
// Names for grid rows (any case). General MIDI first; then the kit pieces GM numbers but had no name here, and the
// articulations beyond GM that Studio A (core.drumroom, devices/builtin/drumroom.js NOTE_MAP) plays: a kit without
// them plays whatever it maps those notes to. Names are added, never renumbered: a song's notes keep their meaning.
// (formatGrid names a note by its last name here, so a new alias for an existing note goes before the old name.)
export const DRUM_MAP = {
  kick: 36, bd: 36, rim: 37, side: 37, snare: 38, sd: 38, clap: 39, cp: 39, hat: 42, hh: 42, ch: 42, closed: 42,
  pedal: 44, ph: 44, open: 46, oh: 46, tom1: 50, hitom: 50, tom2: 47, midtom: 47, tom3: 45, lotom: 45,
  tom4: 43, floor: 43, crash: 49, cy: 49, ride: 51, rd: 51, bell: 53, cowbell: 56, cb: 56, shaker: 70, sh: 70, tamb: 54,
  rimshot: 40, lowfloor: 41, himid: 48, china: 52, splash: 55, crash2: 57, rideedge: 59,
  footsplash: 21, hatedge: 22, quarter: 23, half: 24, ridechoke: 25, openedge: 26, crashchoke: 27, crash2choke: 28,
  chinachoke: 29, splashchoke: 30, flam: 31, drag: 32, roll: 33, snareedge: 34,
};
// Every label the studio gave a drum note before kits named their own (Studio A's articulations included). Rows are
// named per kit now: drumName(p, kitNotes(def)) below.
export const DRUM_NAMES = { 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 42: 'Hat', 44: 'Pedal hat', 46: 'Open hat', 43: 'Floor tom', 45: 'Low tom', 47: 'Mid tom', 50: 'High tom', 49: 'Crash', 51: 'Ride', 53: 'Bell', 54: 'Tamb', 56: 'Cowbell', 70: 'Shaker',
  35: 'Kick 2', 40: 'Rimshot', 41: 'Low floor tom', 48: 'Hi-mid tom', 52: 'China', 55: 'Splash', 57: 'Crash 2', 59: 'Ride edge', 69: 'Cabasa', 82: 'Shaker 2',
  21: 'Hat foot splash', 22: 'Hat edge', 23: 'Hat 1/4 open', 24: 'Hat 1/2 open', 25: 'Ride choke', 26: 'Open hat edge',
  27: 'Crash choke', 28: 'Crash 2 choke', 29: 'China choke', 30: 'Splash choke', 31: 'Flam', 32: 'Drag', 33: 'Roll', 34: 'Snare edge' };

/* ---------------------------------------------------------------- a kit's own names for its notes */
// The General MIDI drum names (35-81, and GM2's shaker on 82), in the studio's short words: what a note is called on a
// kit that names nothing itself.
export const GM_DRUMS = {
  35: 'Kick 2', 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 40: 'Snare 2', 41: 'Low floor tom', 42: 'Hat', 43: 'Floor tom',
  44: 'Pedal hat', 45: 'Low tom', 46: 'Open hat', 47: 'Mid tom', 48: 'Hi-mid tom', 49: 'Crash', 50: 'High tom', 51: 'Ride',
  52: 'China', 53: 'Bell', 54: 'Tamb', 55: 'Splash', 56: 'Cowbell', 57: 'Crash 2', 58: 'Vibraslap', 59: 'Ride 2', 60: 'Hi bongo',
  61: 'Low bongo', 62: 'Mute hi conga', 63: 'Open hi conga', 64: 'Low conga', 65: 'High timbale', 66: 'Low timbale',
  67: 'High agogo', 68: 'Low agogo', 69: 'Cabasa', 70: 'Shaker', 71: 'Short whistle', 72: 'Long whistle', 73: 'Short guiro',
  74: 'Long guiro', 75: 'Claves', 76: 'Hi wood block', 77: 'Low wood block', 78: 'Mute cuica', 79: 'Open cuica',
  80: 'Mute triangle', 81: 'Open triangle', 82: 'Shaker 2',
};
// A drum kit names its own notes with `notes` on its def: { 36: 'Kick', 40: 'Rimshot', ..., other: 'Side stick' }
// (other: what every note it doesn't name plays). Gobo Kit's names are here, by its id, until its def carries them
// (devices/builtin/drums.js: what it plays).
export const KIT_NOTES = {
  'core.drums': {
    35: 'Kick (35)', 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 40: 'Snare (40)', 41: 'Low floor tom', 42: 'Hat', 43: 'Floor tom',
    44: 'Pedal hat', 45: 'Low tom', 46: 'Open hat', 47: 'Mid tom', 48: 'Hi-mid tom', 49: 'Crash', 50: 'High tom', 51: 'Ride',
    52: 'Crash (52)', 53: 'Bell', 54: 'Tamb', 55: 'Crash (55)', 56: 'Cowbell', 57: 'Crash 2', 59: 'Ride (59)', 69: 'Shaker (69)',
    70: 'Shaker', 82: 'Shaker (82)', other: 'Rim',
  },
};
// A device's note names, read as text (a song's device is anyone's JSON): MIDI notes 0-127 and `other`, each a short
// string. -> a frozen { [note]: name, other? }, or null when the device names none.
const NOTES_SEEN = new WeakMap();
export function kitNotes(def) {
  if (!def || typeof def !== 'object') return null;
  if (NOTES_SEEN.has(def)) return NOTES_SEEN.get(def);
  const raw = def.notes && typeof def.notes === 'object' && !Array.isArray(def.notes) ? def.notes : KIT_NOTES[def.id] || null;
  let out = null;
  if (raw) {
    const ok = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== 'string') continue;
      const name = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
      if (!name) continue;
      if (k === 'other' || (/^\d{1,3}$/.test(k) && +k <= 127)) ok[k === 'other' ? k : +k] = name;
    }
    if (Object.keys(ok).length) out = Object.freeze(ok);
  }
  NOTES_SEEN.set(def, out);
  return out;
}
// What a note is called on a kit: its own name; else, when the kit says what its other notes play, that and the
// number ("Rim (60)"); else General MIDI's name. null when nothing names it (a pitched row).
export function drumName(p, notes = null) {
  if (notes) {
    if (notes[p]) return notes[p];
    if (notes.other) return `${notes.other} (${p})`;
  }
  return GM_DRUMS[p] || null;
}
// Said beside a note map (get_device): how to read it and write to it.
export const NOTES_HINT = 'MIDI note -> what this kit plays there ("other": every note it doesn\'t name). Write these numbers in notes, or as drum grid rows (a row may be a MIDI number or a grid name: kick 36, rimshot 40, half 24, flam 31 ...).';
const HIT = { X: 1, x: 0.8, o: 0.45, O: 0.6 };
// { steps: 16, step: 0.25, rows: { kick: 'x...x...' } } -> notes. Row names map through DRUM_MAP or may be MIDI numbers.
export function parseGrid(grid) {
  const step = Number(grid.step || 0.25);
  const out = [];
  for (const [name, row] of Object.entries(grid.rows || {})) {
    const p = DRUM_MAP[String(name).toLowerCase()] ?? parsePitch(name);
    if (!Number.isFinite(p)) throw new Error(`unknown drum row "${name}" (use ${Object.keys(DRUM_MAP).slice(0, 12).join(', ')} … or a MIDI number)`);
    const cells = String(row).replace(/[\s|]/g, '');
    for (let i = 0; i < cells.length; i++) {
      const v = HIT[cells[i]];
      if (v) out.push(normNote({ p, t: i * step, d: step, v }));
    }
  }
  return out;
}
export function formatGrid(notes, { steps = 16, step = 0.25 } = {}) {
  const rows = {};
  const names = Object.fromEntries(Object.entries(DRUM_MAP).filter(([k]) => k.length > 2).map(([k, v]) => [v, k]));
  Object.assign(names, { 36: 'kick', 38: 'snare', 42: 'hat', 44: 'pedal', 46: 'open', 49: 'crash', 51: 'ride' });
  for (const n of notes) {
    const name = names[n.p] || String(n.p);
    rows[name] = rows[name] || Array(steps).fill('.');
    const i = Math.round(n.t / step);
    if (i >= 0 && i < steps) rows[name][i] = n.v >= 0.95 ? 'X' : n.v < 0.55 ? 'o' : 'x';
  }
  return { steps, step, rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.join('')])) };
}
