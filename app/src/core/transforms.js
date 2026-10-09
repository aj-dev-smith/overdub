// Musical transforms and infill [core]: pure, deterministic functions over notes, shared by the piano roll (by 'you')
// and the `transform` agent tool (by the agent). Works in Node and the browser; no DOM, no Math.random.
//
//   transform(name, notes, params?, ctx?)  -> { notes, summary }    notes: [{ id?, p, t, d, v }] (t, d in beats)
//   planTransform(name, clipNotes, { ids, params, key, meter, tempo, start, length, drums, track, clip })
//                                          -> { ops, notes, summary, added, changed, removed, length? } | { error, hint }
//   runTransform(store, { track, clip, ids?, name, params?, by, label?, reason? })   plan + one dispatch (one undo step)
//   TRANSFORMS [{ name, label, group, blurb, drums, adds, params, presets, describe(p) }]   findTransform(name)
//
// Conventions. A transform gets copies of the notes it works on (the selection, or the whole clip) and returns the
// notes that should be there instead: a note that keeps its `id` is an edit of that note, a note without one is new,
// and an id that is missing was removed. planTransform turns that into notes.remove / notes.set / notes.add ops (plus a
// clip.set when the result runs past the clip's end). ctx: { key, meter, tempo, start (the clip's song beat, for bar
// lines), drums, seed }. With no key, the key is guessed from the notes. Random choices come from params.seed
// (default 1): the same seed gives the same notes, always. Pitch-writing transforms keep to the key (pentatonic and
// blues keys build chords from their parent major/minor scale) and to sensible registers.

import { scalePcs, SCALES, NAMES, quantize as qz, beatsPerBar, chordName, normNote, noteName } from './music.js';

const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const MIN_D = 1 / 32;
const ONSET = 0.03;          // notes starting within this many beats are one onset (a chord)
const EPS = 1e-6;

/* ------------------------------------------------------------------------------------------------ helpers */
// mulberry32: small, fast, the same everywhere
export function rng(seed = 1) {
  let s = seedOf(seed) || 1;
  s = Math.imul(s ^ (s >>> 16), 0x7feb352d) >>> 0;   // spread neighbouring seeds apart (lowbias32)
  s = Math.imul(s ^ (s >>> 15), 0x846ca68b) >>> 0;
  s = (s ^ (s >>> 16)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return Math.abs(Math.round(x)) >>> 0;
  let h = 2166136261;
  for (const ch of String(x ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
const pick = (R, arr) => arr[Math.floor(R() * arr.length) % arr.length];
function weighted(R, items, w) {
  const tot = w.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return items[0];
  let x = R() * tot;
  for (let i = 0; i < items.length; i++) { x -= w[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
}
const byTime = (a, b) => a.t - b.t || a.p - b.p;
const endOf = (n) => n.t + n.d;
const gridName = (g) => (Math.abs(4 / g - Math.round(4 / g)) < 1e-6 ? `1/${Math.round(4 / g)}` : `${r4(g)} beats`);
const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

// Onsets: notes grouped by start time (a chord is one onset). [{ t, notes, top, low, end }]
export function onsets(notes) {
  const out = [];
  for (const n of [...notes].sort(byTime)) {
    const g = out[out.length - 1];
    if (g && n.t - g.t < ONSET) g.notes.push(n); else out.push({ t: n.t, notes: [n] });
  }
  for (const g of out) {
    g.top = Math.max(...g.notes.map((n) => n.p));
    g.low = Math.min(...g.notes.map((n) => n.p));
    g.end = Math.max(...g.notes.map(endOf));
  }
  return out;
}
const topNote = (g) => g.notes.reduce((a, b) => (b.p > a.p ? b : a));

// The key the notes are most likely in (major or minor), weighting by length; ties go to the first/last note's pc.
export function guessKey(notes) {
  if (!notes || !notes.length) return { root: 'C', scale: 'major' };
  const w = new Array(12).fill(0);
  for (const n of notes) w[((n.p % 12) + 12) % 12] += Math.max(0.1, Math.min(4, n.d));
  const s = [...notes].sort(byTime);
  const s0 = s.filter((n) => n.t - s[0].t < ONSET);
  const first = s[0].p % 12, bass0 = Math.min(...s0.map((n) => n.p)) % 12, last = s[s.length - 1].p % 12, lowest = notes.reduce((a, b) => (b.p < a.p ? b : a)).p % 12;
  let best = null;
  for (let r = 0; r < 12; r++) {
    for (const scale of ['major', 'minor']) {
      const pcs = new Set(SCALES[scale].map((i) => (r + i) % 12));
      let sc = 0;
      for (let pc = 0; pc < 12; pc++) sc += pcs.has(pc) ? w[pc] : -1.5 * w[pc];
      sc += (r === last ? 0.6 : 0) + (r === first ? 0.3 : 0) + (r === bass0 ? 0.5 : 0) + (r === lowest ? 0.4 : 0) + w[r] * 0.25 + w[(r + 7) % 12] * 0.1;
      if (!best || sc > best.sc + 1e-9) best = { sc, root: NAMES[r], scale };
    }
  }
  return { root: best.root, scale: best.scale };
}
// The 7-note scale chords are built from (pentatonic/blues/chromatic keys borrow their parent scale).
function harmonyKey(key) {
  const sc = SCALES[key.scale] || SCALES.major;
  if (sc.length === 7) return key;
  return { root: key.root, scale: /minor|blues/i.test(key.scale) ? 'minor' : 'major' };
}
// Every in-key pitch 0..127, ascending: the ladder diatonic moves climb.
function ladder(key) {
  const pcs = new Set(scalePcs(key));
  const L = [];
  for (let p = 0; p < 128; p++) if (pcs.has(p % 12)) L.push(p);
  return L;
}
// The ladder index at or below p, and how far p sits above it (0 for an in-key pitch).
function degOf(p, L) {
  if (p <= L[0]) return { i: 0, off: p - L[0] };
  let lo = 0, hi = L.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m] <= p) lo = m; else hi = m - 1; }
  return { i: lo, off: p - L[lo] };
}
// Move p by n scale steps (a chromatic note keeps its offset from the scale note below it).
function stepFrom(p, n, L) {
  const { i, off } = degOf(p, L);
  return clamp(L[clamp(i + n, 0, L.length - 1)] + off, 0, 127);
}
function snapL(p, L) {
  const { i } = degOf(p, L);
  const a = L[i], b = L[Math.min(L.length - 1, i + 1)];
  return p - a <= b - p ? a : b;
}
// fold a pitch into [lo, hi] by octaves
function fold(p, lo, hi) {
  while (p > hi && p - 12 >= 0) p -= 12;
  while (p < lo && p + 12 <= 127) p += 12;
  return clamp(p, 0, 127);
}
function fail(error, hint) { const e = new Error(error); e.hint = hint; e.transform = true; throw e; }

// Bar lines in clip time (clips usually start on a bar; ctx.start says where this one does).
const barFloor = (t, c) => Math.floor((c.start + t + EPS) / c.bpb) * c.bpb - c.start;
const barCeil = (t, c) => Math.ceil((c.start + t - EPS) / c.bpb) * c.bpb - c.start;
const onBeat = (t, c) => Math.abs((c.start + t) - Math.round(c.start + t)) < 0.02;
const onBar = (t, c) => Math.abs((c.start + t) / c.bpb - Math.round((c.start + t) / c.bpb)) < 0.005;

/* ------------------------------------------------------------------------------------------------ the transforms */
// params: { key: { def, min?, max?, opts? } }. presets: the menu's choices for the main parameter (and the agent's
// alternative take). describe(p): a few words for labels ("up · 30 ms").
export const TRANSFORMS = [
  {
    name: 'humanize', label: 'Humanize', group: 'Feel', drums: true,
    blurb: 'loosen timing and velocity a little, like a player (seeded; downbeats move least)',
    params: { amount: { def: 0.35, min: 0, max: 1 }, timing: { def: true }, velocity: { def: true }, seed: { def: 1 } },
    presets: [{ amount: 0.2 }, { amount: 0.35 }, { amount: 0.6 }],
    describe: (p) => (p.amount <= 0.25 ? 'a touch' : p.amount >= 0.55 ? 'a lot' : 'a bit'),
    run(ns, p, c) {
      const R = c.rand;
      const ms = 4 + 22 * p.amount, maxB = (ms * c.tempo) / 60000;
      const out = [];
      for (const g of onsets(ns)) {
        const k = onBeat(g.t, c) ? 0.5 : 1;
        const base = (R() * 2 - 1) * maxB * k;
        for (const n of g.notes) {
          const jt = (R() * 2 - 1) * maxB * 0.25, jv = (R() * 2 - 1) * 0.3 * p.amount;
          out.push({ ...n, t: p.timing ? r4(Math.max(0, n.t + base + jt)) : n.t, v: p.velocity ? r4(clamp(n.v * (1 + jv), 0.05, 1)) : n.v });
        }
      }
      return { notes: out, summary: `loosened ${ns.length} note${ns.length === 1 ? '' : 's'}${p.timing ? ` by up to ±${Math.round(ms)} ms` : ''}${p.velocity ? `, velocity ±${Math.round(30 * p.amount)}%` : ''}` };
    },
  },
  {
    name: 'quantize', label: 'Quantize', group: 'Feel', drums: true,
    blurb: 'pull onsets toward the grid by strength, with swing on every second step (music.quantize)',
    params: { grid: { def: 0.25, min: 1 / 32, max: 4 }, strength: { def: 1, min: 0, max: 1 }, swing: { def: 0, min: 0, max: 1 } },
    presets: [{ grid: 0.25, strength: 1 }, { grid: 0.25, strength: 0.6 }, { grid: 0.5, strength: 1 }, { grid: 0.25, strength: 1, swing: 0.5 }],
    describe: (p) => `${gridName(p.grid)}${p.strength < 1 ? ` at ${Math.round(p.strength * 100)}%` : ''}${p.swing ? `, swing ${Math.round(p.swing * 100)}%` : ''}`,
    run(ns, p) {
      let moved = 0;
      const out = ns.map((n) => { const t = r4(Math.max(0, qz(n.t, p.grid, p.strength, p.swing))); if (Math.abs(t - n.t) > EPS) moved++; return { ...n, t }; });
      return { notes: out, summary: `pulled ${moved} of ${ns.length} notes to the ${gridName(p.grid)} grid${p.strength < 1 ? ` at ${Math.round(p.strength * 100)}%` : ''}${p.swing ? ` with ${Math.round(p.swing * 100)}% swing` : ''}` };
    },
  },
  {
    name: 'strum', label: 'Strum', group: 'Feel', drums: false,
    blurb: 'spread each chord in time, low to high (up), high to low (down) or alternating with the beat',
    params: { direction: { def: 'up', opts: ['up', 'down', 'alternate'] }, ms: { def: 30, min: 2, max: 200 } },
    presets: [{ direction: 'up', ms: 30 }, { direction: 'down', ms: 30 }, { direction: 'up', ms: 60 }, { direction: 'alternate', ms: 25 }],
    describe: (p) => `${p.direction} · ${Math.round(p.ms)} ms`,
    run(ns, p, c) {
      const gap = (p.ms * c.tempo) / 60000;
      const out = [];
      let chords = 0;
      for (const g of onsets(ns)) {
        if (g.notes.length < 2) { out.push(...g.notes); continue; }
        chords++;
        const dir = p.direction === 'alternate' ? (onBeat(g.t, c) ? 'up' : 'down') : p.direction;
        const order = [...g.notes].sort((a, b) => (dir === 'up' ? a.p - b.p : b.p - a.p));
        order.forEach((n, i) => { const off = i * gap; out.push({ ...n, t: r4(n.t + off), d: r4(Math.max(MIN_D, n.d - off)) }); });
      }
      if (!chords) fail('no chords to strum', 'strum spreads notes that start together; select some chords (or use humanize on single notes)');
      return { notes: out, summary: `strummed ${chords} chord${chords === 1 ? '' : 's'} ${p.direction === 'alternate' ? 'up on the beat, down off it' : p.direction}, ${Math.round(p.ms)} ms between strings` };
    },
  },
  {
    name: 'arpeggiate', label: 'Arpeggiate', group: 'Feel', drums: false,
    blurb: 'turn each chord into a pattern of its notes (up, down, updown or seeded random) at a rate',
    params: { pattern: { def: 'up', opts: ['up', 'down', 'updown', 'random'] }, rate: { def: 0.25, min: 1 / 16, max: 2 }, gate: { def: 0.85, min: 0.1, max: 1 }, seed: { def: 1 } },
    presets: [{ pattern: 'up', rate: 0.25 }, { pattern: 'down', rate: 0.25 }, { pattern: 'updown', rate: 0.25 }, { pattern: 'random', rate: 0.25 }, { pattern: 'up', rate: 0.5 }],
    describe: (p) => `${p.pattern === 'updown' ? 'up-down' : p.pattern} · ${gridName(p.rate)}`,
    run(ns, p, c) {
      const R = c.rand, out = [];
      let chords = 0;
      for (const g of onsets(ns)) {
        if (g.notes.length < 2) { out.push(...g.notes); continue; }
        chords++;
        const asc = [...g.notes].sort((a, b) => a.p - b.p);
        const span = Math.max(p.rate, g.end - g.t);
        const steps = Math.max(1, Math.round(span / p.rate));
        const seq = p.pattern === 'down' ? asc.slice().reverse() : p.pattern === 'updown' ? (asc.length > 2 ? [...asc, ...asc.slice(1, -1).reverse()] : asc) : asc;
        const vel = asc.reduce((a, n) => a + n.v, 0) / asc.length;
        const reuse = new Map(asc.map((n) => [n, n.id]));
        let last = null;
        for (let k = 0; k < steps; k++) {
          let src;
          if (p.pattern === 'random') { do { src = pick(R, asc); } while (asc.length > 1 && src === last); } else src = seq[k % seq.length];
          last = src;
          const t = r4(g.t + k * p.rate);
          const d = r4(Math.max(MIN_D, Math.min(p.rate * p.gate, g.t + span - t)));
          const n = { p: src.p, t, d, v: r4(clamp(vel * (k % seq.length === 0 ? 1.08 : 0.94), 0.05, 1)) };
          const id = reuse.get(src);
          if (id) { n.id = id; reuse.delete(src); }
          out.push(n);
        }
      }
      if (!chords) fail('no chords to arpeggiate', 'arpeggiate plays the notes of each chord one at a time; select notes that start together');
      return { notes: out, summary: `arpeggiated ${chords} chord${chords === 1 ? '' : 's'} ${p.pattern === 'updown' ? 'up and down' : p.pattern} in ${gridName(p.rate)}s` };
    },
  },
  {
    name: 'legato', label: 'Legato', group: 'Feel', drums: false,
    blurb: 'stretch each note to the next onset (the last keeps its length), with optional overlap',
    params: { overlap: { def: 0, min: 0, max: 0.5 } },
    presets: [{ overlap: 0 }, { overlap: 0.05 }],
    describe: (p) => (p.overlap ? 'slight overlap' : 'to the next note'),
    run(ns, p) {
      const gs = onsets(ns), out = [];
      gs.forEach((g, i) => {
        const nxt = gs[i + 1];
        for (const n of g.notes) out.push(nxt ? { ...n, d: r4(Math.max(MIN_D, nxt.t - n.t + p.overlap)) } : n);
      });
      return { notes: out, summary: `joined ${Math.max(0, gs.length - 1)} onset${gs.length === 2 ? '' : 's'} legato${p.overlap ? `, ${p.overlap} beats of overlap` : ''}` };
    },
  },
  {
    name: 'staccato', label: 'Staccato', group: 'Feel', drums: true,
    blurb: 'shorten every note to a fraction of its length',
    params: { length: { def: 0.5, min: 0.05, max: 1 } },
    presets: [{ length: 0.5 }, { length: 0.25 }, { length: 0.75 }],
    describe: (p) => `${Math.round(p.length * 100)}% length`,
    run(ns, p) {
      return { notes: ns.map((n) => ({ ...n, d: r4(Math.max(MIN_D, n.d * p.length)) })), summary: `cut ${ns.length} notes to ${Math.round(p.length * 100)}% of their length` };
    },
  },
  {
    name: 'transpose', label: 'Transpose in key', group: 'Pitch', drums: false,
    blurb: 'move notes by scale steps in the key (2 steps = up a third), so they stay in key',
    params: { steps: { def: 2, min: -21, max: 21 } },
    presets: [{ steps: 1 }, { steps: 2 }, { steps: 4 }, { steps: -1 }, { steps: -2 }, { steps: -4 }, { steps: 7 }, { steps: -7 }],
    describe: (p) => (p.steps % 7 === 0 && p.steps ? `${p.steps > 0 ? 'up' : 'down'} ${Math.abs(p.steps / 7) === 1 ? 'an octave' : Math.abs(p.steps / 7) + ' octaves'}` : `${p.steps > 0 ? '+' : '−'}${Math.abs(p.steps)} step${Math.abs(p.steps) === 1 ? '' : 's'}${Math.abs(p.steps) === 2 ? ' (a 3rd)' : Math.abs(p.steps) === 4 ? ' (a 5th)' : ''}`),
    run(ns, p, c) {
      const steps = Math.round(p.steps);
      return { notes: ns.map((n) => ({ ...n, p: stepFrom(n.p, steps, c.L) })), summary: `moved ${ns.length} notes ${steps >= 0 ? 'up' : 'down'} ${Math.abs(steps)} step${Math.abs(steps) === 1 ? '' : 's'} in ${c.keyName}` };
    },
  },
  {
    name: 'invert', label: 'Invert', group: 'Pitch', drums: false,
    blurb: 'mirror the line around a pitch by scale steps (default: its first note), staying in key',
    params: { around: { def: 'first', opts: ['first', 'middle', 'lowest', 'highest'] }, pitch: { def: null, min: 0, max: 127 } },
    presets: [{ around: 'first' }, { around: 'middle' }],
    describe: (p) => (p.pitch != null ? `around ${noteName(p.pitch)}` : `around the ${p.around === 'first' ? 'first note' : p.around + ' note'}`),
    run(ns, p, c) {
      const ps = ns.map((n) => n.p);
      const axis = snapL(p.pitch != null ? p.pitch : p.around === 'middle' ? Math.round((Math.min(...ps) + Math.max(...ps)) / 2) : p.around === 'lowest' ? Math.min(...ps) : p.around === 'highest' ? Math.max(...ps) : [...ns].sort(byTime)[0].p, c.L);
      const ia = degOf(axis, c.L).i;
      const out = ns.map((n) => {
        const { i, off } = degOf(n.p, c.L);
        const q = c.L[clamp(2 * ia - i, 0, c.L.length - 1)] - off;
        return { ...n, p: fold(q, 0, 127) };
      });
      return { notes: out, summary: `inverted ${ns.length} notes around ${noteName(axis)} in ${c.keyName}` };
    },
  },
  {
    name: 'retrograde', label: 'Retrograde', group: 'Pitch', drums: true,
    blurb: 'play it backwards: reverse the timing ("time"), or keep the rhythm and reverse the pitches ("pitches")',
    params: { mode: { def: 'time', opts: ['time', 'pitches'] } },
    presets: [{ mode: 'time' }, { mode: 'pitches' }],
    describe: (p) => (p.mode === 'time' ? 'reverse time' : 'reverse pitches'),
    run(ns, p, c) {
      if (p.mode === 'pitches') {
        if (c.drums) fail('reversing pitches makes no sense on drums', 'use mode "time"');
        const gs = onsets(ns), tops = gs.map((g) => g.top).reverse(), out = [];
        gs.forEach((g, i) => {
          const shift = degOf(tops[i], c.L).i - degOf(g.top, c.L).i;
          for (const n of g.notes) out.push({ ...n, p: n.p === g.top ? tops[i] : stepFrom(n.p, shift, c.L) });
        });
        return { notes: out, summary: `reversed the pitches of ${gs.length} onsets, keeping the rhythm` };
      }
      const t0 = Math.min(...ns.map((n) => n.t)), t1 = Math.max(...ns.map(endOf));
      return { notes: ns.map((n) => ({ ...n, t: r4(Math.max(0, t0 + t1 - endOf(n))) })), summary: `reversed ${ns.length} notes in time` };
    },
  },
  {
    name: 'double', label: 'Double', group: 'Pitch', drums: false, adds: true,
    blurb: 'add a copy an octave up (1) or down (-1), a little softer; skips doubles that already exist',
    params: { octave: { def: 1, min: -2, max: 2 } },
    presets: [{ octave: 1 }, { octave: -1 }],
    describe: (p) => `${Math.abs(p.octave) === 1 ? 'an octave' : Math.abs(p.octave) + ' octaves'} ${p.octave > 0 ? 'up' : 'down'}`,
    run(ns, p) {
      const k = Math.round(p.octave) || 1, out = [...ns];
      const has = new Set(ns.map((n) => `${n.p}@${Math.round(n.t * 100)}`));
      let added = 0;
      for (const n of ns) {
        const q = n.p + 12 * k;
        if (q < 0 || q > 127 || has.has(`${q}@${Math.round(n.t * 100)}`)) continue;
        out.push({ p: q, t: n.t, d: n.d, v: r4(clamp(n.v * 0.85, 0.05, 1)) });
        added++;
      }
      if (!added) fail('nothing to double', 'those notes are already doubled there, or it would go off the keyboard');
      return { notes: out, summary: `doubled ${added} notes an octave ${k > 0 ? 'up' : 'down'}${Math.abs(k) > 1 ? ` (${Math.abs(k)} octaves)` : ''}` };
    },
  },
  {
    name: 'thin', label: 'Thin out', group: 'Pitch', drums: true,
    blurb: 'keep every Nth onset, and/or drop notes quieter than a velocity',
    params: { every: { def: 2, min: 1, max: 16 }, below: { def: 0, min: 0, max: 1 } },
    presets: [{ every: 2 }, { every: 3 }, { every: 1, below: 0.5 }],
    describe: (p) => [p.every > 1 ? `every ${ordinal(Math.round(p.every))}` : '', p.below > 0 ? `drop below ${Math.round(p.below * 127)}` : ''].filter(Boolean).join(', ') || 'nothing',
    run(ns, p) {
      const every = Math.max(1, Math.round(p.every));
      const gs = onsets(ns);
      let out = gs.filter((g, i) => i % every === 0).flatMap((g) => g.notes);
      if (p.below > 0) out = out.filter((n) => n.v >= p.below);
      if (!out.length) out = [gs[0].notes.reduce((a, b) => (b.v > a.v ? b : a))];
      if (out.length === ns.length) fail('nothing to thin', every > 1 ? 'there is only one onset' : 'no note is below that velocity');
      return { notes: out, summary: `thinned ${ns.length} → ${out.length} notes (${[every > 1 ? `every ${ordinal(every)} onset` : '', p.below > 0 ? `velocity ≥ ${Math.round(p.below * 127)}` : ''].filter(Boolean).join(', ')})` };
    },
  },
  {
    name: 'ornament', label: 'Ornament', group: 'Pitch', drums: false, adds: true,
    blurb: 'add grace notes, mordents and turns (scale neighbours) to some notes, chosen by seed',
    params: { density: { def: 0.3, min: 0, max: 1 }, kind: { def: 'mix', opts: ['mix', 'grace', 'mordent', 'turn'] }, seed: { def: 1 } },
    presets: [{ density: 0.25, kind: 'mix' }, { density: 0.5, kind: 'mix' }, { density: 0.3, kind: 'grace' }, { density: 0.3, kind: 'mordent' }],
    describe: (p) => `${p.kind === 'mix' ? (p.density >= 0.45 ? 'more' : 'a few') : p.kind + 's'}`,
    run(ns, p, c) {
      const R = c.rand, L = c.L;
      const g = clamp(r4((c.tempo * 0.07) / 60), 0.0625, 0.125);   // ~70 ms
      const gs = onsets(ns);
      const out = [...ns];
      const cand = [];
      let prevEnd = -Infinity;
      gs.forEach((G) => { const n = topNote(G); if (n.d >= 2 * g + EPS) cand.push({ n, prevEnd, beat: onBeat(n.t, c) }); prevEnd = Math.max(prevEnd, G.end); });
      if (!cand.length) fail('the notes are too short to ornament', 'ornaments need notes of an eighth or longer');
      let chosen = cand.filter((x) => R() < Math.min(p.density >= 1 ? 1 : 0.95, p.density * (x.n.d >= 1 ? 1.3 : 1) * (x.beat ? 1.15 : 0.85)));
      if (!chosen.length && p.density > 0) chosen = [cand.reduce((a, b) => (b.n.d > a.n.d ? b : a))];
      const counts = {};
      for (const { n, prevEnd: pe } of chosen) {
        let kind = p.kind === 'mix' ? pick(R, ['grace', 'grace', 'mordent', 'turn']) : p.kind;
        if (kind === 'turn' && n.d < 4 * g + EPS) kind = n.d >= 3 * g + EPS ? 'mordent' : 'grace';
        if (kind === 'mordent' && n.d < 3 * g + EPS) kind = 'grace';
        const up = R() < 0.6, hi = stepFrom(n.p, 1, L), lo = stepFrom(n.p, -1, L), v = r4(clamp(n.v * 0.8, 0.05, 1));
        if (kind === 'grace') {
          const gp = up ? hi : lo;
          if (n.t - g >= -EPS && n.t - g >= pe - EPS) out.push({ p: gp, t: r4(Math.max(0, n.t - g)), d: g, v });
          else { out.push({ p: gp, t: n.t, d: g, v }); n.t = r4(n.t + g); n.d = r4(n.d - g); }
        } else if (kind === 'mordent') {
          out.push({ p: n.p, t: n.t, d: g, v: n.v }, { p: up ? hi : lo, t: r4(n.t + g), d: g, v });
          n.t = r4(n.t + 2 * g); n.d = r4(n.d - 2 * g);
        } else {
          out.push({ p: hi, t: n.t, d: g, v }, { p: n.p, t: r4(n.t + g), d: g, v }, { p: lo, t: r4(n.t + 2 * g), d: g, v });
          n.t = r4(n.t + 3 * g); n.d = r4(n.d - 3 * g);
        }
        counts[kind] = (counts[kind] || 0) + 1;
      }
      const what = Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ');
      return { notes: out, summary: `ornamented ${chosen.length} of ${gs.length} notes (${what})` };
    },
  },
  {
    name: 'chords_from_melody', label: 'Chords from melody', group: 'Write', drums: false, adds: true,
    blurb: 'harmonize the line in the key: a triad or seventh under it on each strong beat, voice-led',
    params: { kind: { def: 'triads', opts: ['triads', 'sevenths'] }, every: { def: 'half', opts: ['bar', 'half', 'beat'] } },
    presets: [{ kind: 'triads', every: 'bar' }, { kind: 'triads', every: 'half' }, { kind: 'sevenths', every: 'bar' }, { kind: 'sevenths', every: 'half' }],
    describe: (p) => `${p.kind} · ${p.every === 'bar' ? 'per bar' : p.every === 'half' ? 'per half bar' : 'per beat'}`,
    run(ns, p, c) {
      const hk = harmonyKey(c.key), sc = scalePcs(hk);
      const major = (sc[2] - sc[0] + 12) % 12 === 4;
      const PRIOR = major ? [0.25, 0.1, 0.04, 0.18, 0.2, 0.15, -0.25] : [0.25, -0.25, 0.1, 0.18, 0.1, 0.16, 0.12];
      const size = p.kind === 'sevenths' ? 4 : 3;
      const chords = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ k, pcs: [0, 2, 4, 6].slice(0, size).map((j) => sc[(k + j) % 7]) }));
      const slot = p.every === 'beat' ? 1 : p.every === 'bar' || c.bpb % 2 ? c.bpb : c.bpb / 2;
      const t0 = Math.min(...ns.map((n) => n.t)), t1 = Math.max(...ns.map(endOf));
      let s = Math.floor((c.start + t0 + EPS) / slot) * slot - c.start;
      const out = [...ns], names = [];
      let prev = null, prevVoicing = null, slots = 0;
      const nSlots = Math.ceil((t1 - s - EPS) / slot);
      for (let si = 0; s < t1 - EPS; s += slot, si++) {
        const a = Math.max(0, s), b = s + slot;
        const here = ns.filter((n) => n.t < b - EPS && endOf(n) > a + EPS);
        if (!here.length) { prev = null; continue; }
        const w = new Array(12).fill(0);
        let strong = null;
        for (const n of here) {
          const ov = Math.min(b, endOf(n)) - Math.max(a, n.t);
          const st = Math.abs(n.t - a) < ONSET || (n.t < a && endOf(n) > a);
          w[n.p % 12] += ov * (st ? 1.5 : 1) * (0.5 + n.v);
          if (st && (!strong || n.p > strong.p)) strong = n;
        }
        const tot = w.reduce((x, y) => x + y, 0);
        let best = null;
        for (const ch of chords) {
          const cov = ch.pcs.reduce((x, pc) => x + w[pc], 0);
          let score = (cov - 0.6 * (tot - cov)) / tot + PRIOR[ch.k];
          if (strong && ch.pcs.includes(strong.p % 12)) score += 0.15;
          if (prev) {
            if (prev.k === ch.k) score -= 0.12;
            if ((prev.k === 4 && ch.k === 0) || (prev.k === 3 && ch.k === 4) || (prev.k === 1 && ch.k === 4)) score += 0.08;
          } else if (si === 0 && ch.k === 0) score += 0.1;
          if (si === nSlots - 1 && ch.k === 0) score += 0.12;
          if (!best || score > best.score + 1e-9) best = { ...ch, score };
        }
        // voice it under the melody, close to the last chord
        const low = Math.min(...here.map((n) => n.p));
        const floor = low < 52 ? Math.max(24, low - 26) : 40;
        let voicing = null, bestCost = Infinity;
        for (let inv = 0; inv < size; inv++) {
          const pcs = [...best.pcs.slice(inv), ...best.pcs.slice(0, inv)];
          for (let oct = 1; oct <= 6; oct++) {
            const v = [pcs[0] + 12 * oct];
            for (let j = 1; j < pcs.length; j++) { let q = pcs[j] + 12 * oct; while (q <= v[j - 1]) q += 12; v.push(q); }
            if (v[0] < floor || v[v.length - 1] > low - 2) continue;
            let cost = prevVoicing ? v.reduce((x, q, j) => x + Math.abs(q - (prevVoicing[j] ?? prevVoicing[prevVoicing.length - 1])), 0) : Math.abs(v[0] - 54);
            cost += [0, 2, 5, 3][inv];   // root position first; second inversions only when they lead well
            cost += Math.max(0, low - 2 - v[v.length - 1] - 7) * 0.5;   // don't leave a hole under the tune
            if (cost < bestCost) { bestCost = cost; voicing = v; }
          }
        }
        if (!voicing) {
          voicing = best.pcs.map((pc) => pc + 48);
          for (let j = 1; j < voicing.length; j++) while (voicing[j] <= voicing[j - 1]) voicing[j] += 12;
          while (voicing[voicing.length - 1] > low - 1 && voicing[0] - 12 >= 12) voicing = voicing.map((q) => q - 12);
        }
        const vel = r4(clamp((here.reduce((x, n) => x + n.v, 0) / here.length) * 0.8, 0.35, 0.8));
        const sounding = new Set(here.filter((n) => n.t <= a + ONSET).map((n) => n.p));
        for (const q of voicing) if (!sounding.has(q)) out.push({ p: q, t: r4(a), d: r4(b - a), v: vel });
        names.push(chordName(voicing, c.key) || noteName(voicing[0]));
        prev = best; prevVoicing = voicing; slots++;
      }
      if (!slots) fail('no melody to harmonize');
      const prog = names.filter((x, i) => i === 0 || x !== names[i - 1]);
      return { notes: out, summary: `harmonized ${ns.length} notes in ${c.keyName}: ${prog.slice(0, 8).join(' – ')}${prog.length > 8 ? ' …' : ''} (${p.kind}, ${p.every === 'bar' ? 'one per bar' : p.every === 'half' ? 'one per half bar' : 'one per beat'})` };
    },
  },
  {
    name: 'melody_from_chords', label: 'Melody from chords', group: 'Write', drums: false, adds: true,
    blurb: 'write a singable line over the chords: chord tones on the beats, passing and neighbour tones between (seeded)',
    params: { rate: { def: 0.5, min: 0.25, max: 2 }, rests: { def: 0.1, min: 0, max: 0.5 }, seed: { def: 1 } },
    presets: [{ rate: 0.5 }, { rate: 1 }, { rate: 0.5, rests: 0.3 }],
    describe: (p) => `${p.rate >= 1 ? 'quarters' : 'eighths'}${p.rests >= 0.25 ? ', airy' : ''}`,
    run(ns, p, c) {
      const R = c.rand, L = c.L;
      const t0 = Math.floor(Math.min(...ns.map((n) => n.t)) + EPS), t1 = Math.ceil(Math.max(...ns.map(endOf)) - EPS);
      const top = Math.max(...ns.map((n) => n.p));
      const center = clamp(top + 8, 64, 74), lo = center - 7, hi = center + 9;
      const keyPcs = new Set(scalePcs(c.key));
      // the chord on each beat
      const beats = [];
      let last = null;
      for (let b = t0; b < t1; b++) {
        const here = ns.filter((n) => n.t < b + 0.5 && endOf(n) > b + 0.01);
        const pcs = here.length ? [...new Set(here.map((n) => n.p % 12))] : last;
        const bass = here.length ? Math.min(...here.map((n) => n.p)) % 12 : beats[beats.length - 1]?.bass;
        if (pcs) { beats.push({ b, pcs, bass }); last = pcs; }
      }
      if (!beats.length) fail('no chords to write over');
      const tonesOf = (pcs) => { const all = []; for (let q = lo; q <= hi; q++) if (pcs.includes(q % 12)) all.push(q); const inKey = all.filter((q) => keyPcs.has(q % 12)); return inKey.length ? inKey : all; };
      // the skeleton: a chord tone on every beat, mostly by step, leaps recovered
      const skel = [];
      let prevP = snapL(center, L), leap = 0, reps = 0;
      beats.forEach((B, i) => {
        const tones = tonesOf(B.pcs);
        const lastBeat = i === beats.length - 1;
        const w = tones.map((q) => {
          const d = q - prevP;
          let x = Math.exp(-Math.abs(d) / 2.5);
          if (d === 0) x *= reps >= 1 ? 0.04 : 0.3;
          x *= Math.exp(-Math.abs(q - center) / 9);   // drift back toward the middle of the range
          if (Math.abs(leap) > 4 && Math.sign(d) === Math.sign(leap)) x *= 0.25;
          if (Math.abs(d) > 9) x *= 0.05;
          if (lastBeat && q % 12 === (B.bass ?? q % 12)) x *= 3;
          return x;
        });
        const q = weighted(R, tones, w);
        reps = q === prevP ? reps + 1 : 0;
        leap = q - prevP; prevP = q;
        skel.push(q);
      });
      // rhythm and the notes between
      const out = [...ns];
      const endHold = beats.length >= 4 ? 2 : 1;
      for (let i = 0; i < beats.length; i++) {
        const B = beats[i], q = skel[i];
        const strongBar = onBar(B.b, c);
        const vS = strongBar ? 0.85 : 0.78, vW = 0.68;
        if (i >= beats.length - endHold) {   // the phrase ends on a long chord tone
          out.push({ p: q, t: B.b, d: r4(t1 - B.b), v: vS });
          break;
        }
        if (i > 0 && !strongBar && R() < p.rests) continue;
        const nxt = skel[i + 1] ?? q;
        const between = () => {
          const di = degOf(snapL(nxt, L), L).i - degOf(snapL(q, L), L).i;
          if (Math.abs(di) === 2) return stepFrom(snapL(q, L), Math.sign(di), L);        // passing tone
          if (di === 0) return stepFrom(snapL(q, L), R() < 0.5 ? 1 : -1, L);              // neighbour
          if (Math.abs(di) === 1) return R() < 0.5 ? nxt : stepFrom(snapL(q, L), -Math.sign(di), L);   // anticipation or escape tone
          return stepFrom(snapL(nxt, L), -Math.sign(di), L);                                // step into the leap's goal
        };
        if (p.rate >= 1) {
          out.push({ p: q, t: B.b, d: r4(p.rate >= 2 ? 1.9 : 0.95), v: vS });
        } else {
          const cell = weighted(R, ['q', 'ee', 'de'], [0.3, 0.55, 0.15]);
          if (cell === 'q') out.push({ p: q, t: B.b, d: 0.95, v: vS });
          else if (cell === 'ee') out.push({ p: q, t: B.b, d: 0.48, v: vS }, { p: between(), t: B.b + 0.5, d: 0.48, v: vW });
          else out.push({ p: q, t: B.b, d: 0.72, v: vS }, { p: between(), t: B.b + 0.75, d: 0.24, v: vW });
        }
      }
      const made = out.length - ns.length;
      const ps = out.slice(ns.length).map((n) => n.p);
      return { notes: out, summary: `wrote a ${made}-note line over ${beats.length} beats of chords (${noteName(Math.min(...ps))}–${noteName(Math.max(...ps))}, ${p.rate >= 1 ? 'quarters' : 'eighths'})` };
    },
  },
  {
    name: 'continue', label: 'Continue', group: 'Write', drums: true, adds: true,
    blurb: 'extend the phrase by N bars from its own motifs: repetition with variation (sequence, neighbours), cadence at the end (seeded)',
    params: { bars: { def: 2, min: 1, max: 16 }, variation: { def: 0.5, min: 0, max: 1 }, seed: { def: 1 } },
    presets: [{ bars: 1 }, { bars: 2 }, { bars: 4 }],
    describe: (p) => `${p.bars} bar${p.bars === 1 ? '' : 's'}`,
    run(ns, p, c) {
      const R = c.rand, L = c.L, bpb = c.bpb, nb = Math.max(1, Math.round(p.bars));
      const a = barFloor(Math.min(...ns.map((n) => n.t)), c);
      const lastOn = Math.max(...ns.map((n) => n.t));
      const e = Math.max(barCeil(lastOn + 0.01, c), barCeil(Math.max(...ns.map(endOf)) - 0.01, c));
      const k = Math.max(1, Math.round((e - a) / bpb));
      const cells = [];
      for (let i = 0; i < k; i++) {
        const c0 = a + i * bpb;
        cells.push(ns.filter((n) => n.t >= c0 - EPS && n.t < c0 + bpb - EPS).map((n) => ({ p: n.p, t: n.t - c0, d: n.d, v: n.v })));
      }
      const ps = ns.map((n) => n.p), srcLo = Math.min(...ps), srcHi = Math.max(...ps);
      const tonic = scalePcs(harmonyKey(c.key)), tonicPcs = new Set([tonic[0], tonic[2], tonic[4]]);
      const out = [...ns];
      let added = 0;
      for (let j = 0; j < nb; j++) {
        let idx = j % k;
        if (k > 1 && R() < 0.35 * p.variation) idx = Math.floor(R() * k) % k;
        let cell = cells[idx].map((n) => ({ ...n }));
        if (!cell.length) continue;
        const lastCell = j === nb - 1;
        if (!c.drums) {
          if (!lastCell && R() < 0.4 * p.variation) {   // a sequence: the motif a step or two away
            let sh = pick(R, [1, -1, 2, -2]);
            const fits = (s) => cell.every((n) => { const q = stepFrom(n.p, s, L); return q >= srcLo - 4 && q <= srcHi + 4; });
            if (!fits(sh)) sh = fits(-sh) ? -sh : 0;
            if (sh) cell = cell.map((n) => ({ ...n, p: stepFrom(n.p, sh, L) }));
          }
          cell.forEach((n, i) => { if (i > 0 && !onBeat(n.t, { start: 0 }) && R() < 0.3 * p.variation) n.p = stepFrom(n.p, R() < 0.5 ? 1 : -1, L); });
        }
        if (cell.length > 2 && R() < 0.25 * p.variation) {   // a little air: drop the weakest offbeat note
          const weak = cell.map((n, i) => ({ n, i })).filter((x) => x.i > 0 && !onBeat(x.n.t, { start: 0 }));
          if (weak.length) { const w = weak.reduce((x, y) => (y.n.v < x.n.v ? y : x)); cell.splice(w.i, 1); }
        }
        for (const n of cell) n.v = r4(clamp(n.v * (1 + (R() * 2 - 1) * 0.08), 0.05, 1));
        if (lastCell && !c.drums) {   // cadence: the last note settles on the tonic chord and rings to the bar line
          const lt = Math.max(...cell.map((n) => n.t));
          const lastG = cell.filter((n) => Math.abs(n.t - lt) < ONSET);
          if (lastG.length === 1) {
            const n = lastG[0];
            let bestQ = n.p, bd = Infinity;
            for (let q = n.p - 5; q <= n.p + 5; q++) {
              if (!tonicPcs.has(((q % 12) + 12) % 12)) continue;
              const d = Math.abs(q - n.p) - (q % 12 === tonic[0] ? 1.5 : 0);
              if (d < bd) { bd = d; bestQ = q; }
            }
            n.p = clamp(bestQ, 0, 127);
            n.d = Math.max(n.d, bpb - n.t);
          }
        }
        for (const n of cell) { out.push({ p: n.p, t: r4(e + j * bpb + n.t), d: r4(Math.max(MIN_D, n.d)), v: n.v }); added++; }
      }
      if (!added) fail('nothing to continue from', 'select a phrase with notes in it');
      return { notes: out, summary: `continued a ${k}-bar phrase by ${nb} bar${nb === 1 ? '' : 's'} (${added} notes from its own motifs)` };
    },
  },
  {
    name: 'fill_the_gap', label: 'Fill the gap', group: 'Write', drums: true, adds: true,
    blurb: 'bridge the longest silence between two phrases: the first one\'s motif sequenced toward the second ("motif"), or a scale run ("run")',
    params: { style: { def: 'motif', opts: ['motif', 'run'] }, seed: { def: 1 } },
    presets: [{ style: 'motif' }, { style: 'run' }],
    describe: (p) => (p.style === 'run' ? 'a scale run' : 'from the motif'),
    run(ns, p, c) {
      const R = c.rand, L = c.L, bpb = c.bpb;
      const gs = onsets(ns);
      if (gs.length < 2) fail('fill the gap needs notes on both sides of a gap', 'select two phrases with space between them (or use continue)');
      let runEnd = -Infinity, best = null;
      for (let i = 0; i < gs.length - 1; i++) {
        runEnd = Math.max(runEnd, gs[i].end);
        const gap = gs[i + 1].t - runEnd;
        if (gap >= 1 - EPS && (!best || gap > best.gap + EPS)) best = { i, ga: runEnd, gb: gs[i + 1].t, gap };
      }
      if (!best) fail('no gap of a beat or more between the notes', 'select two phrases with at least a beat of silence between them');
      const before = gs.slice(0, best.i + 1), B = gs[best.i + 1];
      const pA = before[before.length - 1].top, pB = B.top;
      const ioi = before.slice(-6).map((g, i, arr) => (i ? g.t - arr[i - 1].t : null)).filter((x) => x > EPS).sort((x, y) => x - y);
      let rate = ioi.length ? ioi[Math.floor(ioi.length / 2)] : 0.5;
      rate = [0.25, 0.5, 1].reduce((x, y) => (Math.abs(y - rate) < Math.abs(x - rate) ? y : x));
      const vel = r4(clamp(before.slice(-4).flatMap((g) => g.notes).reduce((x, n, _, arr) => x + n.v / arr.length, 0), 0.3, 1));
      const out = [...ns];
      const made = [];
      const lastStart = barFloor(before[before.length - 1].t, c);
      if (p.style === 'motif' || c.drums) {
        // tile the last bar before the gap across it, each copy a little nearer the next phrase
        const pat = ns.filter((n) => n.t >= lastStart - EPS && n.t < lastStart + bpb - EPS && n.t < best.ga + EPS).map((n) => ({ ...n, t: n.t - lastStart }));
        const reps = Math.max(1, Math.ceil((best.gb - (lastStart + bpb)) / bpb));
        const base = pat.length ? degOf(snapL(pat[pat.length - 1].p, L), L).i : 0;
        const total = degOf(snapL(pB, L), L).i - base;
        for (let r = 1; r <= reps && pat.length; r++) {
          const sh = c.drums ? 0 : Math.round((total * r) / (reps + 1));
          for (const n of pat) {
            const t = lastStart + r * bpb + n.t;
            if (t < best.ga - EPS || t >= best.gb - 0.05) continue;
            made.push({ p: c.drums ? n.p : stepFrom(n.p, sh, L), t: r4(t), d: r4(Math.max(MIN_D, Math.min(n.d, best.gb - t))), v: n.v });
          }
        }
      }
      if (!made.length && !c.drums) {
        // a scale run from the last note to a step away from the next phrase's first
        const start = Math.ceil((best.ga - EPS) / rate) * rate;
        const n = Math.max(1, Math.floor((best.gb - start) / rate + EPS));
        const dA = degOf(snapL(pA, L), L).i, dB = degOf(snapL(pB, L), L).i;
        const dir = Math.sign(dB - dA) || 1;
        const goal = dB === dA ? dB + 1 : dB - dir;   // a step from the next phrase's first note
        // a stepwise line that wanders out (seeded direction) and turns back to arrive exactly on the goal
        const mid = (dA + goal) / 2, reach = Math.max(3, Math.abs(goal - dA) / 2 + 3);
        let pos = dA, way = R() < 0.5 ? 1 : -1;
        const vel1 = B.notes[0].v;
        const hold = n > 1 && (n - Math.abs(goal - dA)) % 2 !== 0;   // steps can't land on the goal: hold the first note
        const steps = hold ? n - 1 : n;
        for (let k = 1; k <= steps; k++) {
          const rem = steps - k;
          const ok = (mv) => Math.abs(goal - (pos + mv)) <= rem;
          let mv;
          if (ok(way) && Math.abs(pos + way - mid) <= reach) mv = way;
          else if (ok(-way)) { way = -way; mv = way; }
          else mv = Math.sign(goal - pos) * Math.min(2, Math.abs(goal - pos));
          pos += mv;
          const slot = hold && k > 1 ? k : k - 1, len = hold && k === 1 ? 2 * rate : rate;
          const t = start + slot * rate;
          made.push({ p: L[clamp(pos, 0, L.length - 1)], t: r4(t), d: r4(Math.max(MIN_D, Math.min(len - rate * 0.08, best.gb - t))), v: r4(clamp(vel + ((vel1 - vel) * k) / steps, 0.05, 1)) });
        }
      }
      if (!made.length) fail('nothing fits in that gap', 'try style "run", or select a longer phrase before it');
      if (!c.drums) {   // the last note leads into the next phrase by step
        made.sort(byTime);
        const lt = made[made.length - 1].t;
        const lastG = made.filter((n) => Math.abs(n.t - lt) < ONSET);
        const q = lastG.reduce((x, y) => (y.p > x.p ? y : x));
        const approach = stepFrom(snapL(pB, L), q.p < pB ? -1 : 1, L);
        const shift = approach - q.p;
        if (lastG.length === 1) q.p = approach; else for (const n of lastG) n.p = clamp(n.p + shift, 0, 127);
      }
      out.push(...made);
      return { notes: out, summary: `filled ${r4(best.gap)} beats between the phrases with ${made.length} notes (${p.style === 'run' && !c.drums ? 'a scale run' : 'the motif, sequenced'})` };
    },
  },
];

const ALIASES = {
  humanise: 'humanize', arp: 'arpeggiate', arpeggio: 'arpeggiate', reverse: 'retrograde', octave: 'double', thin_out: 'thin',
  harmonize: 'chords_from_melody', harmonise: 'chords_from_melody', chords: 'chords_from_melody', melody: 'melody_from_chords',
  extend: 'continue', fill: 'fill_the_gap', fill_gap: 'fill_the_gap', bridge: 'fill_the_gap', grace: 'ornament', diatonic_transpose: 'transpose',
};
const BY_NAME = new Map(TRANSFORMS.map((t) => [t.name, t]));
export function findTransform(name) {
  const k = String(name || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return BY_NAME.get(k) || BY_NAME.get(ALIASES[k]) || null;
}
// One line per transform, for the agent tool's description.
export function catalog() {
  return TRANSFORMS.map((t) => `${t.name}: ${t.blurb}. params ${Object.entries(t.params).map(([k, s]) => (s.opts ? `${k} ${s.opts.join('|')}` : `${k}=${s.def}`)).join(', ')}`).join('\n');
}

// Coerce params against the spec: numbers clamped, options checked, booleans read, unknown keys dropped.
export function readParams(t, input = {}) {
  const out = {};
  for (const [k, s] of Object.entries(t.params)) {
    const v = input[k];
    if (v === undefined || v === null || v === '') { out[k] = s.def; continue; }
    if (s.opts) out[k] = s.opts.includes(String(v)) ? String(v) : s.def;
    else if (typeof s.def === 'boolean') out[k] = v === true || v === 'true' || v === 1;
    else if (k === 'seed') out[k] = typeof v === 'number' ? v : String(v);
    else { const n = Number(v); out[k] = Number.isFinite(n) ? clamp(n, s.min ?? -Infinity, s.max ?? Infinity) : s.def; }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ running them */
function context(ctx, notes, p) {
  const key = ctx.key || guessKey(ctx.allNotes || notes);
  return {
    key, keyName: `${key.root} ${key.scale.replace(/([A-Z])/g, ' $1').toLowerCase()}`, L: ladder(key),
    bpb: beatsPerBar(ctx.meter || [4, 4]), meter: ctx.meter || [4, 4], tempo: ctx.tempo || 120, start: ctx.start || 0,
    drums: !!ctx.drums, rand: rng(p.seed ?? ctx.seed ?? 1),
  };
}
const norm = (n) => { const x = normNote(n); if (n.id) x.id = n.id; return x; };

// Run one transform on some notes. Throws (with .hint) when it can't apply; returns { notes, summary }.
export function transform(name, notes, params = {}, ctx = {}) {
  const t = findTransform(name);
  if (!t) fail(`no transform "${name}"`, `transforms: ${TRANSFORMS.map((x) => x.name).join(', ')}`);
  const ns = (notes || []).map((n) => norm(n));
  if (!ns.length) fail('no notes to transform', 'select some notes, or a clip with notes in it');
  if (ctx.drums && !t.drums) fail(`${t.label.toLowerCase()} is for pitched parts, not drums`, `on drums: ${TRANSFORMS.filter((x) => x.drums).map((x) => x.name).join(', ')}`);
  const p = readParams(t, params);
  const c = context(ctx, ns, p);
  const r = t.run(ns, p, c);
  return { notes: r.notes.map((n) => norm(n)), summary: r.summary, params: p };
}

// Notes before -> after as ops on one clip: removes, edits (by id), adds.
export function diffOps(track, clip, before, after) {
  const byId = new Map(before.map((n) => [n.id, n]));
  const kept = new Set(), set = [], add = [];
  for (const n of after) {
    const o = n.id && !kept.has(n.id) ? byId.get(n.id) : null;
    if (o) {
      kept.add(n.id);
      const patch = { id: n.id };
      let ch = false;
      for (const k of ['p', 't', 'd', 'v']) if (Math.abs(o[k] - n[k]) > 1e-6) { patch[k] = n[k]; ch = true; }
      if (ch) set.push(patch);
    } else add.push({ p: n.p, t: n.t, d: n.d, v: n.v });
  }
  const remove = before.filter((n) => !kept.has(n.id)).map((n) => n.id);
  const ops = [];
  if (remove.length) ops.push({ type: 'notes.remove', track, clip, ids: remove });
  if (set.length) ops.push({ type: 'notes.set', track, clip, notes: set });
  if (add.length) ops.push({ type: 'notes.add', track, clip, notes: add });
  return { ops, removed: remove, changed: set.map((x) => x.id), added: add };
}

// Plan a transform on a clip (the notes with `ids`, or all of them) -> the ops for one transaction.
export function planTransform(name, clipNotes, opts = {}) {
  const t = findTransform(name);
  if (!t) return { error: `no transform "${name}"`, hint: `transforms: ${TRANSFORMS.map((x) => x.name).join(', ')}` };
  const all = (clipNotes || []).map((n) => norm(n));
  const ids = opts.ids && opts.ids.length ? new Set(opts.ids) : null;
  const subset = ids ? all.filter((n) => ids.has(n.id)) : all;
  const rest = ids ? all.filter((n) => !ids.has(n.id)) : [];
  let r;
  try { r = transform(t.name, subset, opts.params, { ...opts, allNotes: all }); } catch (e) { if (e.transform) return { error: e.message, hint: e.hint }; throw e; }
  const after = [...rest, ...r.notes];
  const d = diffOps(opts.track, opts.clip, all, after);
  const ops = d.ops;
  let length = null;
  const end = Math.max(0, ...after.map(endOf));
  if (opts.length != null && end > opts.length + 1e-3) {
    const bpb = beatsPerBar(opts.meter || [4, 4]);
    length = Math.ceil((end - 1e-3) / bpb) * bpb;
    ops.unshift({ type: 'clip.set', track: opts.track, clip: opts.clip, patch: { length } });
  }
  if (!ops.length) return { error: `${t.label.toLowerCase()} changed nothing here`, hint: 'try another setting, or other notes', nothing: true };
  return { ops, notes: after, result: r.notes, summary: r.summary, params: r.params, transform: t.name, label: t.label, added: d.added.length, changed: d.changed.length, removed: d.removed.length, changedIds: d.changed, removedIds: d.removed, length, scope: ids ? 'selection' : 'clip' };
}

// A short History label: "strum up · 30 ms · Keys"
export function labelFor(name, params, where) {
  const t = findTransform(name);
  if (!t) return name;
  const p = readParams(t, params);
  return `${t.label.toLowerCase()} ${t.describe(p)}${where ? ' · ' + where : ''}`.slice(0, 80);
}

const isDrumDevice = (dev) => /drum/i.test(String(dev || ''));
// Plan and dispatch as one undo step. -> { ok, txn, created, summary, plan } | { ok: false, error, hint }
export function runTransform(store, { track, clip, ids, name, params, by = 'you', label, reason, drums } = {}) {
  const f = store.findClip(clip);
  if (!f || f.clip.kind !== 'notes') return { ok: false, error: 'no notes clip to transform', hint: 'pick a notes clip' };
  const p = store.get();
  const plan = planTransform(name, f.clip.notes, {
    ids, params, key: p.key, meter: p.meter, tempo: p.tempo, start: f.clip.start, length: f.clip.length,
    drums: drums ?? isDrumDevice(f.track.instrument?.device), track: f.track.id, clip: f.clip.id,
  });
  if (plan.error) return { ok: false, ...plan };
  const res = store.dispatch(plan.ops, { by, label: label || labelFor(name, plan.params, f.track.name) });
  if (!res.ok) return { ok: false, error: res.error };
  if (res.txn && reason) res.txn.reason = reason;
  return { ok: true, txn: res.txn, created: res.created, summary: plan.summary, plan };
}
export { isDrumDevice };
