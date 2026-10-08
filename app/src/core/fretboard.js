// The guitar neck [core]: tunings, every place a note can be played, a fingering that keeps the hand in one place, and
// tab text in and out with its rhythm. Pure (no DOM, no Math.random): the Jam room draws with it (ui/jam.js, the tab
// lane in ui/tabs.js), agents read and write with it (get_jam, show_on_fretboard, tab_for, write_tab, suggest_riff).
//
// Strings are numbered two ways. Inside: s = 0..5, low to high, the order `tuning.strings` lists them (the low E first).
// For people (and tab): the guitarist's number, 6 (the low E) to 1 (the high e): stringNumber(s) = 6 - s. Frets are
// 0 (open) to MAX_FRET, counted from the nut; with a capo, tab's numbers count from the capo (f - capo).
//
//   TUNINGS                 { standard, 'drop-d', 'half-down', dadgad, 'open-g' } -> { id, name, notes, strings }
//   tuningOf(id | { strings }) -> a tuning (an unknown id is standard)
//   noteAt(tuning, s, f)    -> MIDI pitch           stringNumber(s) / stringIndex(n)
//   positionsOf(p, tuning, { from, to })      -> [{ s, f }]  every place the pitch can be played, low string first
//   pcPositions(pcs, tuning, { from, to })    -> [{ s, f, p, pc }] every place a set of pitch classes falls
//   fingering(notes, tuning, { span, near, from, to, open, allow }) -> { notes, position, span, shifts, cost } | { error }
//       notes: [{ p, t?, d?, fixed?: { s, f }, ... }] a line (one after another) or chords (notes at one time go on
//       different strings). Each is placed on a string and fret so the hand moves as little as possible: dynamic
//       programming over every playable place of every note, where a hand position is the fret of the first finger and
//       covers `span` frets (4: a fret a finger; open strings fit anywhere). Moving the hand costs, by how far; so do
//       high frets and string skips, a little. A note with `fixed` keeps that place; allow(s, f) leaves out places.
//       Returns each note with { s, f, finger (0 open, 1-4) }, `position` (where the hand starts), and how many times
//       it moves (`shifts`).
//   placeNotes(notes, { tuning, capo, span, open, near }) -> fingering's result: a note whose s and f still match its
//       pitch (placeOk) keeps them (kept: true), the rest are fingered around them. The pitch is the truth.
//   placeOk(note, tuning, capo) -> does its stored place play its pitch, at or above the capo
//   boxOf(pcs, root, tuning, { at, span }) -> { position, notes: [{ s, f, p, pc }] }  a scale in one hand position
//   boxStart(rootPc, tuning, { min, max }) -> the fret of rootPc on the lowest string, in [min, max]
//   formatTab(notes, { tuning, capo, step, meter, width, bars, sustain, count, perLine }) -> ASCII tab with its rhythm
//       (the format is below, "Tab text"); notes need s and f (placeNotes) and t, d in beats from the tab's start
//   parseTab(text, { tuning, capo, step, meter }) -> { notes: [{ p, t, d, s, f, v, bend? }], errors, warnings, tuning,
//       capo, bars, step, guessed }   the inverse, forgiving of tab people type
//   tabLayout(notes, opts) -> { step, width, cellsPerBar, bars }   the grid and column width formatTab chose
//   tabLegend(step) -> the format in one line, for whoever reads a tab out of the studio
//   handSpan(notes) -> the frets between the lowest and highest fretted notes, + 1 (open strings left out)
//   INLAYS, MAX_FRET

import { parsePitch, noteName, parsePc } from './music.js';

export const MAX_FRET = 22;
// fret markers: dots at these frets, two at 12 and 24
export const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

// MIDI pitches low to high. Standard: E2 A2 D3 G3 B3 E4.
export const TUNINGS = {
  standard: { id: 'standard', name: 'Standard', notes: 'E A D G B E', strings: [40, 45, 50, 55, 59, 64] },
  'drop-d': { id: 'drop-d', name: 'Drop D', notes: 'D A D G B E', strings: [38, 45, 50, 55, 59, 64] },
  'half-down': {
    id: 'half-down',
    name: 'Half-step down',
    notes: 'Eb Ab Db Gb Bb Eb',
    strings: [39, 44, 49, 54, 58, 63],
  },
  dadgad: { id: 'dadgad', name: 'DADGAD', notes: 'D A D G A D', strings: [38, 45, 50, 55, 57, 62] },
  'open-g': { id: 'open-g', name: 'Open G', notes: 'D G D G B D', strings: [38, 43, 50, 55, 59, 62] },
};
export const TUNING_IDS = Object.keys(TUNINGS);

export function tuningOf(t) {
  if (t && typeof t === 'object' && Array.isArray(t.strings) && t.strings.length) return t;
  const k = String(t || '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (TUNINGS[k]) return TUNINGS[k];
  const alias = {
    std: 'standard',
    'e-standard': 'standard',
    dropd: 'drop-d',
    'drop-d-tuning': 'drop-d',
    eb: 'half-down',
    'e-flat': 'half-down',
    'half-step-down': 'half-down',
    'half-step': 'half-down',
    'open-g-tuning': 'open-g',
    openg: 'open-g',
  };
  return TUNINGS[alias[k]] || TUNINGS.standard;
}

export const noteAt = (tuning, s, f) => tuningOf(tuning).strings[s] + f;
export const stringNumber = (s, n = 6) => n - s;
export const stringIndex = (num, n = 6) => n - num;
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;

// Every place pitch p can be played, frets from..to, low string first.
export function positionsOf(p, tuning, { from = 0, to = MAX_FRET } = {}) {
  const T = tuningOf(tuning),
    out = [];
  const q = Math.round(parsePitch(p));
  if (!Number.isFinite(q)) return out;
  T.strings.forEach((open, s) => {
    const f = q - open;
    if (f >= from && f <= to) out.push({ s, f });
  });
  return out;
}

// Every place a set of pitch classes falls (a scale, a chord's tones), frets from..to.
export function pcPositions(pcs, tuning, { from = 0, to = MAX_FRET } = {}) {
  const T = tuningOf(tuning),
    want = new Set([...pcs].map(pcOf)),
    out = [];
  T.strings.forEach((open, s) => {
    for (let f = from; f <= to; f++) {
      const p = open + f;
      if (want.has(pcOf(p))) out.push({ s, f, p, pc: pcOf(p) });
    }
  });
  return out;
}

// The frets between the lowest and highest fretted notes, counting both (open strings left out): 4 is one finger a fret.
export function handSpan(notes) {
  const fr = notes.map((n) => n.f).filter((f) => f > 0);
  return fr.length ? Math.max(...fr) - Math.min(...fr) + 1 : 0;
}

// The fret of a pitch class on the lowest string, the first one in [min, max] (the box of a scale starts there).
export function boxStart(rootPc, tuning, { min = 1, max = 12 } = {}) {
  const T = tuningOf(tuning),
    low = T.strings[0];
  for (let f = 0; f <= MAX_FRET; f++) if (pcOf(low + f) === pcOf(rootPc) && f >= min && f <= max) return f;
  for (let f = 0; f <= MAX_FRET; f++) if (pcOf(low + f) === pcOf(rootPc)) return f;
  return 0;
}

// A scale in one hand position: its notes from fret `at` across `span` frets on every string (a stretch of one more
// fret where a string would otherwise have only one note), the way a pentatonic box is taught.
export function boxOf(pcs, root, tuning, { at = null, span = 4 } = {}) {
  const T = tuningOf(tuning);
  const position = at == null ? boxStart(pcOf(typeof root === 'number' ? root : parsePitch(root + '4')), T) : at;
  const lo = Math.max(0, position - (position > 0 ? 1 : 0)),
    hi = position + span - 1;
  const notes = [];
  const want = new Set([...pcs].map(pcOf));
  T.strings.forEach((open, s) => {
    const row = [];
    for (let f = lo; f <= hi + 1; f++) if (want.has(pcOf(open + f))) row.push(f);
    // the window itself, then a stretch either side only to give the string a second note
    let inside = row.filter((f) => f >= position && f <= hi);
    if (inside.length < 2) {
      const extra = row.filter((f) => (f === position - 1 || f === hi + 1) && !inside.includes(f));
      inside = [...inside, ...extra.slice(0, 2 - inside.length)].sort((a, b) => a - b);
    }
    for (const f of inside) notes.push({ s, f, p: open + f, pc: pcOf(open + f) });
  });
  return { position, notes };
}

/* ------------------------------------------------------------------------------------------------ the fingering */
// Notes starting within this many beats of each other are played at once (a chord): each on its own string.
const TOGETHER = 0.03;

// The hand windows a set of fretted frets fits in: first-finger positions pos with every fret in [pos, pos + span - 1].
function windowsFor(frets, span) {
  const fr = frets.filter((f) => f > 0);
  if (!fr.length) return [null]; // all open: the hand can be anywhere
  const lo = Math.min(...fr),
    hi = Math.max(...fr);
  if (hi - lo + 1 > span) return [];
  const out = [];
  for (let pos = Math.max(1, hi - span + 1); pos <= lo; pos++) out.push(pos);
  return out;
}

// The placements of one onset: each note on its own string. [{ places: [{ s, f }], frets }] (a chord's combinations are
// searched with the strings taken; at most `limit` of them, the closest-packed first). A note with `fixed` has that one
// place (a chord of fixed places that needs a stretch gets it); allow(s, f) leaves out the places it refuses.
function placementsOf(group, T, { from, to, span, limit = 48, allow = null }) {
  const opts = group.map((n) =>
    n.fixed ? [n.fixed] : positionsOf(n.p, T, { from, to }).filter((x) => !allow || allow(x.s, x.f)),
  );
  if (opts.some((o) => !o.length)) return [];
  if (group.some((n) => n.fixed)) span = Math.max(span, handSpan(group.filter((n) => n.fixed).map((n) => n.fixed)));
  const out = [];
  const pick = (i, used, acc) => {
    if (out.length >= limit * 4) return;
    if (i === opts.length) {
      out.push(acc.slice());
      return;
    }
    for (const o of opts[i]) {
      if (used.has(o.s)) continue;
      used.add(o.s);
      acc.push(o);
      pick(i + 1, used, acc);
      acc.pop();
      used.delete(o.s);
    }
  };
  pick(0, new Set(), []);
  return out
    .map((places) => ({ places, frets: places.map((x) => x.f) }))
    .filter((x) => windowsFor(x.frets, span).length)
    .sort((a, b) => handSpan(a.places) - handSpan(b.places))
    .slice(0, limit);
}

// open: what an open string costs against a fretted note: 0 (either), < 0 (chords: open voicings ring), > 0 (a lead
// line in a box, played fretted where the hand is)
export function fingering(
  notes,
  tuning,
  { span = 4, near = null, from = 0, to = MAX_FRET, open = 0, allow = null } = {},
) {
  const T = tuningOf(tuning);
  const list = (notes || []).map((n, i) => ({
    ...n,
    p: Math.round(parsePitch(n.p)),
    t: Number.isFinite(+n.t) ? +n.t : i,
    i,
  }));
  if (!list.length) return { notes: [], position: near ?? 0, span, shifts: 0, cost: 0 };
  const bad = list.filter((n) => !Number.isFinite(n.p));
  if (bad.length)
    return {
      error: `can't read ${bad.length} of the notes as pitches`,
      hint: 'give each note a MIDI number or a name like A3 or F#4',
    };
  // onsets, in time order
  const sorted = list.slice().sort((a, b) => a.t - b.t || a.p - b.p);
  const groups = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && n.t - g[0].t <= TOGETHER) g.push(n);
    else groups.push([n]);
  }
  const out = (g) => g.map((n) => `${noteName(n.p)}`).join(' ');
  const lowest = T.strings[0],
    highest = T.strings[T.strings.length - 1] + to;
  for (const g of groups) {
    if (g.length > T.strings.length)
      return {
        error: `${g.length} notes at once (${out(g)}): a guitar has ${T.strings.length} strings`,
        hint: 'spread the chord out in time, or leave a note out',
        group: g.map((n) => n.i),
        why: 'strings',
      };
    const off = g.find((n) => !n.fixed && (n.p < lowest + from || n.p > highest));
    if (off)
      return {
        error: `${noteName(off.p)} is off the neck in ${T.name} tuning (${noteName(lowest + from)} to ${noteName(highest)})`,
        hint: 'move it an octave, or pick another tuning',
        group: [off.i],
        why: 'neck',
      };
  }
  // the states of each onset: a placement and a hand position it fits (a stretch a fixed chord needs, it gets)
  const states = groups.map((g) => {
    const pl = placementsOf(g, T, { from, to, span, allow });
    const st = [];
    for (const x of pl) {
      const w = Math.max(span, g.some((n) => n.fixed) ? handSpan(x.places) : 0);
      for (const pos of windowsFor(x.frets, w)) st.push({ places: x.places, pos });
    }
    return st;
  });
  const empty = states.findIndex((s) => !s.length);
  if (empty >= 0)
    return {
      error: `can't fit ${out(groups[empty])} under one hand (${span} frets)`,
      hint: 'open the voicing up, or give span 5 for a stretch',
      group: groups[empty].map((n) => n.i),
      why: 'hand',
    };
  // what a place costs on its own: high up the neck and far from the middle strings a little
  const placeCost = (st) =>
    st.places.reduce((c, x) => c + (x.f > 12 ? 0.04 * (x.f - 12) : 0) + (x.f === 0 ? open : 0), 0) +
    (st.pos == null ? 0 : 0.01 * st.pos);
  // moving from one state to the next: the hand's move (open strings let it stay), and a string skip in a line
  const posOf = (st, prev) => (st.pos == null ? prev : st.pos);
  const moveCost = (a, b, pa) => {
    const pb = posOf(b, pa);
    let c = pa == null || pb == null ? 0 : Math.abs(pb - pa) * 1.0 + (pb !== pa ? 0.6 : 0);
    if (a.places.length === 1 && b.places.length === 1) {
      const ds = Math.abs(b.places[0].s - a.places[0].s);
      if (ds > 1) c += 0.25 * (ds - 1);
    }
    return c;
  };
  // Viterbi over onsets (the hand position each state leaves the hand at rides along)
  const N = groups.length;
  let cost = states[0].map(
    (st) => placeCost(st) + (near != null && st.pos != null ? 0.5 * Math.abs(st.pos - near) : 0),
  );
  let hand = states[0].map((st) => posOf(st, near));
  const back = [states[0].map(() => -1)];
  for (let i = 1; i < N; i++) {
    const nc = [],
      nh = [],
      bk = [];
    for (let j = 0; j < states[i].length; j++) {
      let best = Infinity,
        bi = 0;
      for (let k = 0; k < states[i - 1].length; k++) {
        const c = cost[k] + moveCost(states[i - 1][k], states[i][j], hand[k]);
        if (c < best - 1e-12) {
          best = c;
          bi = k;
        }
      }
      nc.push(best + placeCost(states[i][j]));
      nh.push(posOf(states[i][j], hand[bi]));
      bk.push(bi);
    }
    cost = nc;
    hand = nh;
    back.push(bk);
  }
  let j = cost.indexOf(Math.min(...cost));
  const total = cost[j];
  const chosen = new Array(N);
  for (let i = N - 1; i >= 0; i--) {
    chosen[i] = states[i][j];
    j = back[i][j];
  }
  // the hand position through the line (open strings keep the last one), the moves, the fingers
  let pos = null,
    shifts = 0,
    first = null;
  const placed = new Map();
  chosen.forEach((st, i) => {
    if (st.pos != null) {
      if (pos != null && st.pos !== pos) shifts++;
      pos = st.pos;
      if (first == null) first = pos;
    }
    groups[i].forEach((n, k) => {
      const x = st.places[k];
      placed.set(n.i, { s: x.s, f: x.f, finger: x.f === 0 ? 0 : Math.max(1, Math.min(4, x.f - (pos ?? x.f) + 1)) });
    });
  });
  const res = list.map((n) => {
    const { i, ...rest } = n;
    return { ...rest, ...placed.get(i) };
  });
  return { notes: res, position: first ?? 0, span, shifts, cost: Math.round(total * 1000) / 1000 };
}

/* ------------------------------------------------------------------------------------------------ places */
// A capo's fret: 1 to 12, else 0 (none).
export const capoOf = (c) => {
  const n = Math.round(Number(c) || 0);
  return n >= 1 && n <= 12 ? n : 0;
};
// Does a note's stored place (s, f) play its pitch in this tuning, on the neck, at or above the capo? The pitch is the
// truth: a place that doesn't (the note was moved, the tuning changed) is fingered again wherever tab is drawn.
export function placeOk(n, tuning, capo = 0) {
  const T = tuningOf(tuning),
    c = capoOf(capo);
  return (
    !!n &&
    Number.isInteger(n.s) &&
    Number.isInteger(n.f) &&
    n.s >= 0 &&
    n.s < T.strings.length &&
    n.f >= c &&
    n.f <= MAX_FRET &&
    T.strings[n.s] + n.f === Math.round(Number(parsePitch(n.p)))
  );
}
// Every note on a string and a fret: the ones whose stored place still plays their pitch keep it (kept: true), the
// rest are fingered around them. A capo is a nut at its fret: the neck is fingered from there, and f is still counted
// from the nut (tab prints f - capo). open: what an open string costs (fingering's), near: a hand position to start by.
export function placeNotes(notes, { tuning = 'standard', capo = 0, span = 4, open = 0.3, near = null } = {}) {
  const T = tuningOf(tuning),
    c = capoOf(capo);
  const src = (notes || []).map((n) => ({ ...n, p: Math.round(parsePitch(n.p)) }));
  const list = src.map((n) => {
    const keep = placeOk(n, T, c);
    const { s, f, finger, kept, fixed, ...rest } = n;
    return { ...rest, p: n.p - c, ...(keep ? { fixed: { s, f: f - c } } : {}) };
  });
  const lo = T.strings[0] + c,
    hi = T.strings[T.strings.length - 1] + MAX_FRET;
  const off = src.find((n) => Number.isFinite(n.p) && (n.p < lo || n.p > hi));
  if (off)
    return {
      error: `${noteName(off.p)} is off the neck in ${T.name} tuning${c ? ` with a capo at the ${c}${ORDS[c] || 'th'} fret` : ''} (${noteName(lo)} to ${noteName(hi)})`,
      hint: c ? 'move it an octave, or take the capo off' : 'move it an octave, or pick another tuning',
      group: [src.indexOf(off)],
      why: 'neck',
    };
  const fg = fingering(list, T, { span, open, near: near == null ? null : Math.max(0, near - c), to: MAX_FRET - c });
  if (fg.error) {
    // (named in the notes as they sound, not as the fingering saw them under the capo)
    if (c && fg.group) {
      const names = fg.group.map((i) => noteName(src[i].p)).join(' ');
      return {
        ...fg,
        error: fg.error.replace(/\(([A-G][#b]?-?\d\s?)+\)|[A-G][#b]?-?\d( [A-G][#b]?-?\d)*/, (m) =>
          m.startsWith('(') ? `(${names})` : names,
        ),
      };
    }
    return fg;
  }
  return {
    ...fg,
    position: fg.position ? fg.position + c : c,
    notes: fg.notes.map(({ fixed, ...n }) => ({ ...n, p: n.p + c, f: n.f + c, kept: !!fixed })),
  };
}
const ORDS = ['', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th', 'th', 'th', 'th'];

/* ------------------------------------------------------------------------------------------------ tab text */
// Tab text, the six-line form guitarists and language models both know, with the rhythm written in:
//
//      |1e+a2e+a3e+a4e+a|1e+a2e+a3e+a4e+a|   the count line (optional, ignored when read): the beats, numbered
//    e |----------------|----------------|
//    B |--------5=------|----------------|   a number is the fret a note starts on (from the capo, with one);
//    G |------7=--------|----------------|   = holds it on through another column; - is silence; | a bar line
//    D |5===--------7b9=|5===------------|   7b9: picked at the 7th fret and bent up to the 9th's pitch (7b9r7:
//    A |----------------|----------------|   and let back down); 5h7, 7p5, 5/7: the second note not picked
//    E |----------------|----------------|
//
// A line per string, the high e on top, each labelled with its open note. One column is one step of the grid: a 16th
// (four columns a beat), or an 8th-note triplet (three) when the rhythm swings, or finer when it must; a column is two
// or three characters wide when a fret number needs the room. Notes in one column are a chord. Bars run on in systems
// of `perLine`, a blank line between. A note's length is its columns: its number and the = after it, rounded to the
// grid (the studio keeps each note's real length; the text keeps the grid's). Reading is forgiving: each bar's columns
// are spread evenly over the bar (or over the count line's beats, when there is one), so tab typed with any spacing
// reads; with no = anywhere (most tab people paste) each note rings until the next on its string, and the reader says
// that is a guess.
const TAB_GRIDS = [0.25, 1 / 3, 1 / 6, 0.125, 1 / 12];
const onGrid = (x, g) => Math.abs(x / g - Math.round(x / g)) < 2e-3;
const SUBS = { 1: [''], 2: ['', '+'], 3: ['', '+', 'a'], 4: ['', 'e', '+', 'a'] };
const GRID_WORD = (g) =>
  Math.abs(g - 0.25) < 1e-6
    ? '16th'
    : Math.abs(g - 1 / 3) < 1e-6
      ? '8th-note triplet'
      : Math.abs(g - 1 / 6) < 1e-6
        ? '16th-note triplet'
        : Math.abs(g - 0.125) < 1e-6
          ? '32nd'
          : Math.abs(g - 0.5) < 1e-6
            ? '8th'
            : Math.abs(g - 1) < 1e-6
              ? 'beat'
              : `${Math.round(1 / g)} to a beat`;
// The step a set of onsets sits on: 16ths, else 8th-note triplets, 16th triplets, 32nds, a twelfth of a beat; else 16ths
// (rounded).
export function gridOf(times, step = null) {
  if (step > 0) return step;
  for (const g of TAB_GRIDS) if (times.every((t) => onGrid(t, g))) return g;
  return 0.25;
}
// The format in a sentence, for whoever reads the tab out of the studio (a message, a notes app, another agent).
export function tabLegend(step = 0.25) {
  const per = Math.round(1 / step),
    sub = SUBS[per] ? SUBS[per].map((x, i) => (i ? x : '1')).join(' ') : null;
  return `One column per ${GRID_WORD(step)}${sub ? ` (count ${sub})` : ''}: a number is the fret a note starts on and = holds it on (a note lasts the columns its number and its = take), - is silence; 7b9 bends from the 7th fret up to the 9th's pitch; the high e is on top.`;
}
// The top-to-bottom labels: the tuning's notes, the highest first (a high E written e), two characters each.
function labelsOf(T) {
  const names = T.notes.split(' ');
  const out = T.strings.map((_, s) => (names[s] || '?').slice(0, 2).padEnd(2, ' ')).reverse();
  if (/^E/.test(out[0])) out[0] = 'e' + out[0].slice(1);
  return out;
}
// A bend's text: 7b9 (up a whole step, held), 7b9r7 (and back down), '' for none.
function bendText(n, num) {
  const c = n.bend;
  if (c == null) return '';
  const pts = typeof c === 'number' ? [[0, c]] : Array.isArray(c) ? c.filter((x) => Array.isArray(x)) : [];
  if (!pts.length) return '';
  const top = pts.reduce((m, x) => (Math.abs(x[1]) > Math.abs(m) ? x[1] : m), 0);
  if (!(top >= 0.5)) return '';
  const back = pts.length > 1 && Math.abs(pts[pts.length - 1][1]) < 0.25;
  return `b${num + Math.round(top)}${back ? `r${num}` : ''}`;
}
// The grid, the column width and the bars formatTab will use for these notes (each with s, f, t, d).
export function tabLayout(
  notes,
  { tuning = 'standard', capo = 0, step = null, meter = [4, 4], width = null, bars = null } = {},
) {
  const T = tuningOf(tuning),
    c = capoOf(capo),
    n = T.strings.length;
  const bpb = (meter?.[0] || 4) * (4 / (meter?.[1] || 4));
  const list = (notes || []).filter(
    (x) =>
      Number.isInteger(x.s) && x.s >= 0 && x.s < n && Number.isInteger(x.f) && Number.isFinite(+x.t) && +x.t >= -1e-9,
  );
  const g = gridOf(
    list.map((x) => +x.t),
    step,
  );
  const cellsPerBar = Math.max(1, Math.round(bpb / g));
  const end = list.reduce((m, x) => Math.max(m, +x.t + Math.max(g, +x.d || g)), 0);
  const nBars = bars || Math.max(1, Math.ceil((end - 1e-6) / bpb));
  const total = nBars * cellsPerBar;
  // each note's cells: from its onset to its end, rounded to the grid, cut by the next note on its string
  const cells = [];
  for (let s = 0; s < n; s++) {
    const on = list
      .filter((x) => x.s === s)
      .map((x) => ({ x, c0: Math.round(+x.t / g) }))
      .filter((o) => o.c0 < total)
      .sort((a, b) => a.c0 - b.c0);
    on.forEach((o, i) => {
      if (i && on[i - 1].c0 === o.c0) return; // (two notes on one string at once: the first one)
      const next = on.slice(i + 1).find((q) => q.c0 > o.c0);
      let c1 = Math.max(o.c0 + 1, Math.round((+o.x.t + Math.max(0, +o.x.d || g)) / g));
      if (next) c1 = Math.min(c1, next.c0);
      c1 = Math.min(c1, total);
      const num = o.x.f - c;
      cells.push({ s, c0: o.c0, c1, tok: `${num}${bendText(o.x, num)}`, note: o.x });
    });
  }
  let w = width;
  if (!w) {
    // the narrowest columns that read back as written: every number and its = in its own columns
    for (w = 1; w < 4; w++) if (verifies(cells, n, total, w)) break;
  }
  return {
    T,
    capo: c,
    bpb,
    step: g,
    width: w,
    cellsPerBar,
    bars: nBars,
    total,
    cells,
    cellsPerBeat: Math.round(1 / g),
  };
}
function layLine(cells, s, total, w, sustain = true) {
  const a = new Array(total * w).fill('-');
  for (const x of cells) {
    if (x.s !== s) continue;
    const at = x.c0 * w;
    for (let i = 0; i < x.tok.length && at + i < a.length; i++) a[at + i] = x.tok[i];
    // (= only for a note that lasts past its own column: a 16th in two-character columns is "5-", an 8th "5===")
    if (sustain && x.c1 > x.c0 + 1) for (let i = at + x.tok.length; i < Math.min(a.length, x.c1 * w); i++) a[i] = '=';
  }
  return a.join('');
}
function verifies(cells, n, total, w) {
  for (let s = 0; s < n; s++) {
    const mine = cells.filter((x) => x.s === s);
    // each number fits the columns its note lasts, with room before the next one on its string (5-7-, never 57)
    if (
      mine.some(
        (x, i) => x.tok.length > (x.c1 - x.c0) * w || (mine[i + 1] && x.tok.length >= (mine[i + 1].c0 - x.c0) * w),
      )
    )
      return false;
    const back = scanLine(layLine(cells, s, total, w));
    if (back.length !== mine.length || back.some((b, i) => b.col !== mine[i].c0 * w || b.tok !== mine[i].tok))
      return false;
  }
  return true;
}
// Notes (each with s, f, t, d in beats from the tab's start) as tab text: six lines (and a count line above with
// count: true) per system of `perLine` bars. sustain: false leaves the = out (the old look: numbers alone).
export function formatTab(notes, opts = {}) {
  const { sustain = true, count = false, perLine = 4 } = opts;
  const L = tabLayout(notes, opts);
  const { T, width: w, cellsPerBar, bars: nBars, total, cells, cellsPerBeat } = L;
  const labels = labelsOf(T),
    n = T.strings.length;
  const lines = Array.from({ length: n }, (_, s) => layLine(cells, s, total, w, sustain));
  const per = cellsPerBar * w,
    sys = [];
  for (let b0 = 0; b0 < nBars; b0 += perLine) {
    const b1 = Math.min(nBars, b0 + perLine),
      out = [];
    if (count) {
      const bar = Array.from({ length: cellsPerBar }, (_, c) => {
        const k = c % cellsPerBeat,
          ch = k === 0 ? String((Math.floor(c / cellsPerBeat) + 1) % 10) : SUBS[cellsPerBeat]?.[k] || '.';
        return ch + ' '.repeat(w - 1);
      }).join('');
      out.push(`  |${Array.from({ length: b1 - b0 }, () => bar).join('|')}|`);
    }
    for (let line = 0; line < n; line++) {
      const s = n - 1 - line,
        body = [];
      for (let b = b0; b < b1; b++) body.push(lines[s].slice(b * per, (b + 1) * per));
      out.push(`${labels[line]}|${body.join('|')}|`);
    }
    sys.push(out.join('\n'));
  }
  return sys.join('\n\n');
}

// The tab as a reader gets it (a message, a notes app, another agent): a line saying what it is ("Riff, bars 9–12.
// Standard tuning (E A D G B E), capo 2, 98 BPM."), the tab with its count line, and the format in a sentence. Reads
// back with parseTab, tuning and capo included.
export function tabText(
  notes,
  {
    tuning = 'standard',
    capo = 0,
    meter = [4, 4],
    bars = null,
    step = null,
    title = '',
    tempo = null,
    perLine = 4,
  } = {},
) {
  const T = tuningOf(tuning),
    c = capoOf(capo);
  const L = tabLayout(notes, { tuning: T, capo: c, meter, bars, step });
  const head = `${title ? `${String(title).replace(/\s+/g, ' ').trim()}. ` : ''}${T.name} tuning (${T.notes})${c ? `, capo ${c}` : ''}${tempo ? `, ${Math.round(tempo * 10) / 10} BPM` : ''}.`;
  return `${head}\n${formatTab(notes, { tuning: T, capo: c, meter, bars: L.bars, step: L.step, count: true, perLine })}\n${tabLegend(L.step)}`;
}

// The marks one line of tab makes, left to right: [{ col, tok, num, end (its last column), sus (the last = after it),
// bend?, back?, ghost?, legato? }]. Two digits are one fret when they make 24 or less ("12"), else two notes ("57").
function readNum(src, j) {
  const a = src[j],
    b = src[j + 1];
  if (/\d/.test(b || '') && Number(a + b) <= MAX_FRET + 2) return { v: Number(a + b), len: 2 };
  return { v: Number(a), len: 1 };
}
const isDigit = (ch) => ch >= '0' && ch <= '9';
function scanLine(src) {
  const out = [];
  let cur = null,
    legato = false;
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (isDigit(ch) || (ch === '(' && isDigit(src[i + 1] || ''))) {
      const ghost = ch === '(';
      let j = ghost ? i + 1 : i;
      const num = readNum(src, j);
      j += num.len;
      if (ghost && src[j] === ')') j++;
      const note = {
        col: i,
        num: num.v,
        end: j - 1,
        sus: j - 1,
        ...(ghost ? { ghost: true } : {}),
        ...(legato ? { legato: true } : {}),
      };
      if (src[j] === 'b' && isDigit(src[j + 1] || '')) {
        const b = readNum(src, j + 1);
        note.bend = b.v - num.v;
        j += 1 + b.len;
        if (src[j] === 'r' && isDigit(src[j + 1] || '')) {
          const r = readNum(src, j + 1);
          note.back = true;
          j += 1 + r.len;
        }
        note.end = note.sus = j - 1;
      }
      note.tok = src.slice(i, j);
      if (legato && cur) cur.sus = Math.max(cur.sus, i - 1);
      legato = false;
      out.push(note);
      cur = note;
      i = j;
      // a hammer-on, pull-off or slide: the number after it is the next note, not picked
      if (/[hp/\\s]/.test(src[i] || '') && isDigit(src[i + 1] || '')) {
        legato = true;
        cur.sus = Math.max(cur.sus, i);
        i++;
      }
      continue;
    }
    if (ch === '=' || ch === '~') {
      if (cur) cur.sus = i;
      i++;
      continue;
    }
    if ((ch === 'x' || ch === 'X') && out) out.dead = (out.dead || 0) + 1;
    cur = null;
    i++;
  }
  return out;
}

// What a line is: a string of tab (a label, then |, then marks), the count line, or words.
const STRING_LINE = /^\s*([A-Ga-g][#b]?|[1-9])?\s*\|(.*)$/;
function kindOf(line) {
  const m = STRING_LINE.exec(line);
  if (!m) return { kind: 'text' };
  const body = m[2];
  if (!/[-=]/.test(body) && /\d/.test(body) && /^[\d\s|e+a&.t]*$/i.test(body.replace(/\|/g, '')))
    return { kind: 'count', body };
  if (!/[-=0-9]/.test(body)) return { kind: 'text' };
  return { kind: 'string', label: (m[1] || '').trim(), body };
}
// A tuning named in words around a tab ("Tuning: Drop D", "DADGAD", "half-step down"), or null.
function tuningInWords(text) {
  if (/\bdrop[\s-]?d\b/i.test(text)) return 'drop-d';
  if (/\bdadgad\b/i.test(text)) return 'dadgad';
  if (/\bopen[\s-]?g\b/i.test(text)) return 'open-g';
  if (/\bhalf[\s-]?(step|tone)\b|\be[\s-]?flat\b|\beb standard\b/i.test(text)) return 'half-down';
  if (/\bstandard( tuning)?\b|\be standard\b/i.test(text)) return 'standard';
  return null;
}
// The tuning a tab's labels spell, low string to high ("E A D G B E", "D A D G B E"), or null.
function tuningFromLabels(labels) {
  const pcs = labels.map((l) => parsePc(l ? l[0].toUpperCase() + l.slice(1) : '')).reverse();
  if (pcs.some((x) => !Number.isFinite(x))) return null;
  const hit = TUNING_IDS.find(
    (id) =>
      TUNINGS[id].strings.length === pcs.length && TUNINGS[id].strings.every((p, s) => ((p % 12) + 12) % 12 === pcs[s]),
  );
  return hit || null;
}

// Read tab text into notes: { notes: [{ p, t, d, s, f, v, bend? }], errors, warnings, tuning, capo, bars, step, guessed }.
// tuning / capo: what to read it in (else what the text says: "Drop D", "Capo 2", its labels; else standard, no capo).
// step: the grid in beats (else the one its onsets sit on); meter: for the bars.
export function parseTab(text, { tuning = null, capo = null, step = null, meter = [4, 4] } = {}) {
  const errors = [],
    warnings = [];
  const bpb = (meter?.[0] || 4) * (4 / (meter?.[1] || 4));
  const src = String(text || '')
    .replace(/\t/g, '    ')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''));
  const kinds = src.map(kindOf);
  const words = src.filter((_, i) => kinds[i].kind === 'text').join('\n');
  // systems: runs of string lines (a count line just above one belongs to it)
  const systems = [];
  for (let i = 0; i < src.length; i++) {
    if (kinds[i].kind !== 'string') continue;
    const run = [];
    let j = i;
    while (j < src.length && kinds[j].kind === 'string') run.push(kinds[j++]);
    systems.push({ lines: run, count: i > 0 && kinds[i - 1].kind === 'count' ? kinds[i - 1].body : null });
    i = j - 1;
  }
  const out = (o) => ({
    notes: [],
    errors,
    warnings,
    tuning: null,
    capo: 0,
    bars: 0,
    step: null,
    guessed: false,
    ...o,
  });
  if (!systems.length) {
    errors.push('no lines of tab in it: six lines, one per string, each starting with its note and a | (e|---5---|)');
    return out();
  }
  const tid = tuning
    ? tuningOf(tuning).id
    : tuningInWords(words) || tuningFromLabels(systems[0].lines.map((l) => l.label)) || 'standard';
  const T = tuningOf(tid),
    n = T.strings.length;
  if (
    !tuning &&
    !tuningInWords(words) &&
    systems[0].lines.some((l) => l.label) &&
    !tuningFromLabels(systems[0].lines.map((l) => l.label))
  )
    warnings.push(
      `its labels (${systems[0].lines.map((l) => l.label || '?').join(' ')}) aren't a tuning the studio has, so it is read in standard tuning`,
    );
  const cm = /\bcapo\W{0,3}(\d{1,2})\b/i.exec(words);
  const c = capo != null ? capoOf(capo) : cm ? capoOf(cm[1]) : 0;
  const bad = systems.find((sy) => sy.lines.length !== n);
  if (bad) {
    errors.push(`expected ${n} lines of tab (one per string), got ${bad.lines.length}`);
    return out({ tuning: tid, capo: c });
  }
  const legacy = !systems.some((sy) => sy.lines.some((l) => /[=~]/.test(l.body)));
  const raw = [];
  let bar0 = 0,
    deadAll = 0,
    ragged = false;
  for (const sy of systems) {
    const parts = sy.lines.map((l) => {
      const b = l.body.split('|');
      if (b.length > 1 && !b[b.length - 1].trim()) b.pop();
      return b;
    });
    const nb = Math.max(...parts.map((b) => b.length));
    const widths = Array.from({ length: nb }, (_, k) => Math.max(1, ...parts.map((b) => (b[k] || '').length)));
    for (let k = 0; k < nb; k++) if (parts.some((b) => Math.abs((b[k] || '').length - widths[k]) > 1)) ragged = true;
    // the count line's beats, bar by bar (when it has a digit for each beat): a column's time between them
    const cbars = sy.count ? sy.count.split('|') : [];
    const beatCols = widths.map((wd, k) => {
      const seg = cbars[k] || '';
      const at = [...seg].map((ch, x) => (isDigit(ch) ? x : -1)).filter((x) => x >= 0);
      return at.length === Math.round(bpb) && at[0] === 0 && Math.abs(seg.length - wd) <= 1 ? at : null;
    });
    const starts = [];
    let acc = 0;
    for (const wd of widths) {
      starts.push(acc);
      acc += wd;
    }
    const timeAt = (col) => {
      let k = 0;
      while (k + 1 < nb && col >= starts[k + 1]) k++;
      const x = col - starts[k],
        wd = widths[k],
        bc = beatCols[k];
      let inBar = (x / wd) * bpb;
      if (bc) {
        let j = 0;
        while (j + 1 < bc.length && x >= bc[j + 1]) j++;
        const nxt = j + 1 < bc.length ? bc[j + 1] : wd;
        inBar = j + (x - bc[j]) / Math.max(1, nxt - bc[j]);
      }
      return (bar0 + k) * bpb + inBar;
    };
    sy.lines.forEach((l, line) => {
      const s = n - 1 - line; // the top line is the highest string
      const flat = widths.map((wd, k) => (parts[line][k] || '').padEnd(wd, '-')).join('');
      const marks = scanLine(flat);
      deadAll += marks.dead || 0;
      for (const mk of marks) {
        const f = mk.num + c;
        if (f > MAX_FRET) {
          errors.push(`fret ${mk.num}${c ? ` (from the capo)` : ''} on string ${stringNumber(s, n)} is off the neck`);
          continue;
        }
        raw.push({
          s,
          f,
          t: timeAt(mk.col),
          end: timeAt(Math.max(mk.end, mk.sus) + 1),
          sysEnd: (bar0 + nb) * bpb,
          bend: mk.bend,
          back: mk.back,
          ghost: mk.ghost,
          legato: mk.legato,
          hasSus: mk.sus > mk.end,
        });
      }
    });
    bar0 += nb;
  }
  const g = gridOf(
    raw.map((x) => x.t),
    step,
  );
  const off = raw.some((x) => !onGrid(x.t, g));
  if (off || ragged)
    warnings.push(
      `the spacing doesn't keep to one grid${ragged ? " (the strings' lines aren't the same length in a bar)" : ''}: times were rounded to the nearest ${GRID_WORD(g)}`,
    );
  if (deadAll) warnings.push(`${deadAll} muted note${deadAll === 1 ? '' : 's'} (x) left out: they have no pitch`);
  const snap = (x) => Math.round(x / g) * g;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const notes = raw.map((x) => ({ ...x, t: r4(snap(x.t)) })).sort((a, b) => a.t - b.t || a.s - b.s);
  for (const x of notes) {
    let end;
    if (legacy) {
      // no = anywhere: a note rings until the next one on its string (or the end of the tab): a guess
      const next = notes.find((y) => y.s === x.s && y.t > x.t + 1e-9);
      end = next ? next.t : x.sysEnd;
    } else end = Math.ceil(x.end / g - 0.05) * g;
    x.d = r4(Math.max(g, end - x.t));
    x.p = T.strings[x.s] + x.f;
    x.v = x.ghost ? 0.45 : x.legato ? 0.65 : 0.8;
    if (x.bend)
      x.bend = x.back
        ? [
            [0, 0],
            [r4(x.d * 0.3), x.bend],
            [r4(x.d * 0.6), x.bend],
            [r4(x.d * 0.85), 0],
          ]
        : [
            [0, 0],
            [r4(Math.min(0.25, x.d / 2)), x.bend],
          ];
    for (const k of ['end', 'sysEnd', 'back', 'ghost', 'legato', 'hasSus']) delete x[k];
    if (!x.bend) delete x.bend;
  }
  if (legacy && notes.length)
    warnings.push('no = marks, so each note rings until the next on its string: the lengths are a guess');
  return {
    notes: notes.map(({ p, t, d, s, f, v, bend }) => ({ p, t, d, s, f, v, ...(bend ? { bend } : {}) })),
    errors,
    warnings,
    tuning: tid,
    capo: c,
    bars: bar0,
    step: g,
    guessed: legacy || off || ragged,
  };
}
