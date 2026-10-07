// Rounds: play it as many times round as you like, and what you played most often is kept. Pure (Node and the
// browser): nothing here touches the song. Built on input/timing.js (the pulse, the gentle snap, the three timing
// words), which it never changes. Start a song (ui/start.js) uses it on a beat tapped in free time.
//
//   loopOf(notes, { bpb = 4 }) -> { bars: 1 | 2 | 4 | null, length (beats), rounds: [[start, end]], agree }
//       notes: [{ p, t (beats, tidied), raw?, v? }] from timing.js fitHits, beat 0 the first hit. The loop is the
//       smallest of 1, 2 or 4 bars at which one round and the next agree (the cells each sound was played in, over the
//       cells both rounds reached) at 0.6 or more; a larger loop wins only when it agrees far better. No repeat: bars
//       null, one round over the whole take (up to 8 bars).
//   foldRounds(notes, loop, { bpb = 4 }) -> { notes (kept), strays, rounds, rows: { [p]: rounds that row was played in },
//       beyond }
//       Per row (one drum sound) and cell: of the rounds that played that row at all and reached that cell, a hit is
//       kept when it is in the only one, in both of two, or in at least half of three or more. A kept hit's raw offset
//       and velocity are the medians over the rounds that have it. Everything else is a stray: never added on top of a
//       kept hit. No loop: every hit up to 8 bars is kept as played (beyond: how many were later).
//   downbeatOf(notes, { bpb = 4, length }) -> { shift (beats to move bar 1 by, 0..bpb in 8ths), sure, margin, why }
//       Where the 1 is, read from the kick and the snare (GM 35/36, 38/40): kicks on 1 and 3, snares on 2 and 4. With
//       neither, the first hit is the 1 and the reading isn't sure. Rotations that sound the same round the loop count
//       as one reading.
//   rotate(notes, shift, length) -> notes   the loop started `shift` beats later (raw moved with it)
//   readingsOf({ notes, length, bpm }, { bpb = 4, lo = 60, hi = 180 }) -> [{ bpm, shift, notes, length, why }]
//       1 to 3 readings, the first the current: the other place the 1 could be (when nearly as likely), and the tempo
//       halved or doubled while it stays within lo..hi. why: 'kick' | 'snare' | 'first' | 'slower' | 'faster'.
//   atLevel(notes, level, { length }) -> notes   the Timing words: 'tight' where each hit was meant, 'loose' half way,
//       'played' as played (timing.js blend), kept inside the loop; with no raw, as tight
//   moved(notes, level, { bpm }) -> { n, ms }   how many hits the level moves from where they were played, and by how
//       much on average (the line under the Timing words counts it)
//   steadiest(rounds [{ notes: [{ t, raw }] }]) -> index   the round with the least mean |raw - t|, ties to the latest
//   takeOf(hits, { bpb }) -> all of the above at once, for a beat tapped in free time (below)

import { blend, tightness, fitHits } from './timing.js';

const r4 = (x) => Math.round(x * 10000) / 10000;
const CELL = 0.25;                       // a sixteenth: the cells rounds are compared and folded in
const KICKS = new Set([35, 36]);
const SNARES = new Set([37, 38, 39, 40]);
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const cellOf = (t) => Math.round(t / CELL);
const lastT = (notes) => notes.reduce((m, n) => Math.max(m, n.t), 0);

// each note's round and its cell in that round (a hit snapped onto the next round's first cell belongs to that round)
function placeIn(notes, L) {
  const C = Math.round(L / CELL);
  return notes.map((n) => {
    let k = Math.floor((n.t + 1e-9) / L), c = cellOf(n.t - k * L);
    if (c >= C) { k++; c -= C; }
    return { n, k, c };
  });
}

export function loopOf(notes, { bpb = 4 } = {}) {
  const end = lastT(notes);
  const tries = [];
  for (const bars of [1, 2, 4]) {
    const L = bars * bpb, C = Math.round(L / CELL);
    const placed = placeIn(notes, L);
    const n = placed.reduce((m, x) => Math.max(m, x.k), 0) + 1;
    if (n < 2) continue;
    const sets = Array.from({ length: n }, () => new Set());
    for (const x of placed) sets[x.k].add(`${x.n.p}@${x.c}`);
    // (the last round reaches only as far as its last hit: the rest of it isn't compared)
    const reach = (k) => (k < n - 1 ? C : cellOf(end - k * L) + 1);
    const agrees = [];
    for (let k = 0; k + 1 < n; k++) {
      const upto = Math.min(reach(k), reach(k + 1));
      if (upto < C / 2 && k + 1 === n - 1) continue;   // a scrap of a last round says nothing either way
      const a = [...sets[k]].filter((s) => +s.split('@')[1] < upto), b = [...sets[k + 1]].filter((s) => +s.split('@')[1] < upto);
      const A = new Set(a), both = b.filter((s) => A.has(s)).length, union = new Set([...a, ...b]).size;
      agrees.push(union ? both / union : 0);
    }
    if (!agrees.length) continue;
    const agree = Math.round(median(agrees) * 100) / 100;
    tries.push({ bars, L, n, agree });
  }
  // the smallest loop that agrees nearly as well as the best (a 2-bar beat whose bars nearly match agrees at 1 bar too,
  // but less well than at 2)
  const ok = tries.filter((x) => x.agree >= 0.6);
  const top = ok.reduce((m, x) => Math.max(m, x.agree), 0);
  const pick = ok.find((x) => x.agree >= top - 0.05) || null;
  if (!pick) {
    const length = Math.min(8 * bpb, Math.max(bpb, Math.ceil((end + CELL) / bpb - 1e-9) * bpb));
    return { bars: null, length, rounds: [[0, length]], agree: tries.length ? Math.max(...tries.map((x) => x.agree)) : 0 };
  }
  return { bars: pick.bars, length: pick.L, rounds: Array.from({ length: pick.n }, (_, k) => [k * pick.L, (k + 1) * pick.L]), agree: pick.agree };
}

export function foldRounds(notes, loop, { bpb = 4 } = {}) {
  if (!loop || !loop.bars) {
    const L = (loop && loop.length) || 8 * bpb;
    const keep = notes.filter((n) => n.t < L - 1e-9).map((n) => ({ p: n.p, t: r4(n.t), d: n.d || CELL, v: n.v ?? 0.8, raw: n.raw ?? n.t }));
    return { notes: keep, strays: [], rounds: 1, rows: {}, beyond: notes.length - keep.length };
  }
  const L = loop.length, n = loop.rounds.length, end = lastT(notes);
  const placed = placeIn(notes, L);
  const reach = (k) => (k < n - 1 ? Infinity : cellOf(end - k * L));
  const played = new Map();               // p -> Set of rounds
  const at = new Map();                   // `${p}@${c}` -> Map(k -> note)
  for (const { n: x, k, c } of placed) {
    if (!played.has(x.p)) played.set(x.p, new Set());
    played.get(x.p).add(k);
    const key = `${x.p}@${c}`;
    if (!at.has(key)) at.set(key, new Map());
    const m = at.get(key), was = m.get(k);
    if (!was || (was.v ?? 0) < (x.v ?? 0)) m.set(k, { ...x, off: (x.raw ?? x.t) - k * L });
  }
  const kept = [], strays = [];
  for (const [key, m] of at) {
    const [p, c] = key.split('@').map(Number);
    const eligible = [...played.get(p)].filter((k) => c <= reach(k)).length;
    const present = m.size;
    const need = eligible <= 1 ? 1 : eligible === 2 ? 2 : Math.ceil(eligible / 2);
    const hits = [...m.values()];
    const note = { p, t: r4(c * CELL), d: CELL, v: r4(median(hits.map((x) => x.v ?? 0.8))), raw: r4(median(hits.map((x) => x.off))), n: present };
    (present >= need ? kept : strays).push(note);
  }
  const byT = (a, b) => a.t - b.t || a.p - b.p;
  return { notes: kept.sort(byT), strays: strays.sort(byT), rounds: n, rows: Object.fromEntries([...played].map(([p, s]) => [p, s.size])), beyond: 0 };
}

const wrap = (t, L) => r4(((t % L) + L) % L);
export function rotate(notes, shift, length) {
  if (!shift) return notes.map((n) => ({ ...n }));
  return notes.map((n) => {
    const t = wrap(n.t - shift, length);
    // (raw moves with its hit: the same offset from where it was meant)
    return { ...n, t, ...(n.raw != null ? { raw: r4(t + (n.raw - n.t)) } : {}) };
  }).sort((a, b) => a.t - b.t || a.p - b.p);
}

const printOf = (notes, L) => notes.map((n) => `${n.p}@${cellOf(wrap(n.t, L))}`).sort().join(',');
export function downbeatOf(notes, { bpb = 4, length = null } = {}) {
  const L = length || Math.max(bpb, Math.ceil((lastT(notes) + CELL) / bpb) * bpb);
  const has = notes.some((n) => KICKS.has(n.p) || SNARES.has(n.p));
  if (!has) return { shift: 0, sure: false, margin: 0, why: 'first' };
  const score = (s) => {
    let x = s === 0 ? 0.5 : 0;            // (the first hit is the 1 unless the beat says otherwise)
    for (const n of notes) {
      const t = wrap(n.t - s, L), b = r4(t % bpb);
      // (a kick just after the 1 is less usual than one leading into beat 3 or 4: a near tie goes the usual way)
      if (KICKS.has(n.p)) { if (b === 0) x += 3 + (t === 0 ? 1 : 0); else if (bpb === 4 && b === 2) x += 1; else if (b === 0.5) x -= 0.25; }
      else if (SNARES.has(n.p)) { if (bpb === 4 && (b === 1 || b === 3)) x += 2; else if (b === 0) x -= 2; else if (bpb === 4 && b === 2) x += 0.5; }
    }
    return x;
  };
  const seen = new Map();                 // the loop as it sounds -> its best phase
  for (let s = 0; s < Math.min(L, bpb * 2) - 1e-9; s += 0.5) {
    const pr = printOf(notes.map((n) => ({ ...n, t: n.t - s })), L), sc = score(s);
    if (!seen.has(pr) || seen.get(pr).score < sc) seen.set(pr, { shift: s, score: sc });
  }
  const ranked = [...seen.values()].sort((a, b) => b.score - a.score || a.shift - b.shift);
  const best = ranked[0], next = ranked[1];
  const margin = next && best.score > 0 ? r4((best.score - next.score) / best.score) : 1;
  const first = rotate(notes, best.shift, L).find((n) => n.t === 0);
  return { shift: best.shift, sure: best.score > 0 && margin > 0.15, margin, why: first && SNARES.has(first.p) ? 'snare' : first && KICKS.has(first.p) ? 'kick' : 'first', alt: next && margin <= 0.15 ? next.shift : null };
}

export function readingsOf({ notes, length, bpm }, { bpb = 4, lo = 60, hi = 180 } = {}) {
  const db = downbeatOf(notes, { bpb, length });
  const cur = { bpm, shift: db.shift, notes: rotate(notes, db.shift, length), length, why: db.why };
  const out = [cur];
  if (db.alt != null) {
    const ns = rotate(notes, db.alt, length), f = ns.find((n) => n.t === 0);
    out.push({ bpm, shift: db.alt, notes: ns, length, why: f && SNARES.has(f.p) ? 'snare' : f && KICKS.has(f.p) ? 'kick' : 'first' });
  }
  const scaled = (k, why) => {
    const b = r4(bpm * k);
    if (b < lo || b > hi) return null;
    let ns = cur.notes.map((n) => ({ ...n, t: r4(n.t * k), d: r4(Math.max(CELL, n.d * k)), ...(n.raw != null ? { raw: r4(n.raw * k) } : {}) }));
    let L = r4(length * k);
    // (a loop shorter than a bar plays twice to fill one)
    while (L < bpb - 1e-9) { ns = [...ns, ...ns.map((n) => ({ ...n, t: r4(n.t + L), ...(n.raw != null ? { raw: r4(n.raw + L) } : {}) }))]; L = r4(L * 2); }
    return { bpm: b, shift: db.shift, notes: ns, length: L, why };
  };
  const half = scaled(0.5, 'slower'), dbl = scaled(2, 'faster');
  const other = [half, dbl].filter(Boolean).sort((a, b) => Math.abs(Math.log2(a.bpm / 100)) - Math.abs(Math.log2(b.bpm / 100)));
  for (const x of other) if (out.length < 3) out.push(x);
  return out;
}

// A beat tapped in free time, from the hits to the loop: timing.js fitHits, then the tempo's octave (a beat read with
// no step between its beats above 125 BPM is a beat in eighths at half that: the 8ths were read as the beats), the
// loop, the fold, the 1 and the readings.
//   takeOf(hits [{ t (s), p, v }], { bpb = 4 }) -> { bpm, fit, loop, fold, downbeat, notes (the loop, bar 1 on the
//     1), length, readings } | null (too few hits)
export function takeOf(hits, { bpb = 4 } = {}) {
  const fit = fitHits(hits, { bpb });
  if (!fit) return null;
  let notes = fit.notes, bpm = fit.bpm;
  if (fit.sub === 1 && bpm > 125 && bpm / 2 >= 60) {
    bpm = r4(bpm / 2);
    notes = notes.map((n) => ({ ...n, t: r4(n.t / 2), d: 0.25, raw: n.raw != null ? r4(n.raw / 2) : n.raw }));
  }
  const loop = loopOf(notes, { bpb });
  const fold = foldRounds(notes, loop, { bpb });
  const length = loop.length;
  const downbeat = downbeatOf(fold.notes, { bpb, length });
  const readings = readingsOf({ notes: fold.notes, length, bpm }, { bpb });
  return { bpm, fit, loop, fold, downbeat, notes: readings[0].notes, strays: rotate(fold.strays, downbeat.shift, length), length, readings };
}

export function atLevel(notes, level = 'tight', { length = Infinity } = {}) {
  const s = tightness(level);
  return notes.map((n) => {
    if (n.raw == null || s === 1) return { ...n };
    let t = blend(n.raw, n.t, s);
    t = Math.max(0, Math.min(length - 1 / 64, t));
    return { ...n, t };
  });
}

export function moved(notes, level = 'tight', { bpm = 120 } = {}) {
  const s = tightness(level);
  const spb = 60 / bpm;
  const offs = notes.filter((n) => n.raw != null).map((n) => Math.abs(n.raw - blend(n.raw, n.t, s)) * spb * 1000).filter((ms) => ms >= 1);
  return { n: offs.length, ms: offs.length ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length) : 0 };
}

export function steadiest(rounds) {
  let best = -1, bestE = Infinity;
  rounds.forEach((r, i) => {
    const ns = (r.notes || []).filter((n) => n.raw != null);
    if (!ns.length) return;
    const e = ns.reduce((a, n) => a + Math.abs(n.raw - n.t), 0) / ns.length;
    if (e <= bestE + 1e-9) { bestE = e; best = i; }
  });
  return best;
}
