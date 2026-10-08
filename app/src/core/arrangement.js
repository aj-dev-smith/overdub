// Arrangement edits [core]: the structural moves every session needs. Duplicate a section with its clips, insert or
// delete bars across the whole song, repeat a clip, split a clip. Pure functions over the project: each reads the
// song as it is and returns the list of ordinary ops (core/ops.js) that makes the change, so the arranger, the
// `arrange_song` agent tool and the ops of the same names (registered in ops.js for apply_ops) share one plan. Applied
// in one dispatch they are one undo step, and their inverses are the primitives' own, so an undo is exact. Those
// inverses are guarded (ops.js `_expect`): undoing or reverting one refuses, changing nothing, if anyone has edited the
// notes of a clip it rewrote or made since, so a revert never takes someone else's later work with it.
//
//   planSectionDuplicate(p, { section, to?, push? })   copy a section and every clip that plays in it (cut to the
//                                                      section's bars) to `to` (default: right after it); push: first
//                                                      insert that many beats there, so nothing is overlapped
//   planTimeInsert(p, { at, length })                  insert `length` beats of silence at beat `at` across the song:
//                                                      clips, sections and the loop after it move right; a clip across
//                                                      it is split there (a take folder across it: as Split splits
//                                                      one, the part after is a folder of its own); a section across
//                                                      it grows
//   planTimeRemove(p, { at, length })                  delete beats [at, at + length): clips and sections inside go,
//                                                      ones across an edge are trimmed (a notes clip across the whole
//                                                      cut closes up around it; an audio one becomes two, both muted
//                                                      if it was and in its take folder), later ones move left, and
//                                                      so does the loop
//   planClipRepeat(p, { track?, clip, times, mode? })  times = how often it plays in all (2 = once more): 'copies' adds
//                                                      new clips end to end; 'loop' lengthens a notes clip, notes looped
//   planClipSplit(p, { track?, clip, at })             split a clip at song beat `at` into two (a take: every take in
//                                                      its folder, and both halves are folders: see "comping" below)
//   -> { ops, summary, ... } (the summary is one plain sentence); bad input throws an Error that says what would work
//
// Notes keep their sounding part: a note across a cut is shortened to it, and its tail (a pitched note's; a drum hit
// is all attack) goes with the other side, so the two parts add up to the original. Moved, copied and cut notes keep
// their ids within a clip and their authors (who wrote the music); a new clip made by a copy is signed by whoever
// asked (the op's ctx.by), the right half of a split by whoever made the clip.
// All times are beats. `ref` on section.duplicate / clip.split / clip.repeat names the new section or first new clip.
// Plans that grow the song are held to project.js LIMITS (notes in a clip and in the song, clips, the song's last beat)
// before they build anything: a loop or a copy multiplies what it's given, so a few bytes of ops could otherwise ask
// for millions of notes.

import { newId, LIMITS, songSize, isTakeId } from './project.js';
import { beatsPerBar } from './music.js';
import {
  lanesOf,
  specFor,
  cutLane,
  spliceLane,
  insertTime,
  removeTime,
  laneKey,
  mkPoint,
  rt,
  valueBefore,
  pointBy,
} from './automation.js';

const EPS = 1e-6;
const MIN_NOTE = 1 / 64; // music.js normNote's shortest note
const MIN_CLIP = 0.25; // ops.js clip.set's shortest clip
const r4 = (x) => Math.round(x * 10000) / 10000;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
const isDrums = (t) => /drum/i.test(String(t?.instrument?.device || ''));
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const count = (n) => Number(n).toLocaleString('en-US');

// New ids for a plan's clips and sections, never one the song (or this plan) already uses.
function idMinter(p) {
  let used = null;
  return (prefix) => {
    if (!used) {
      used = new Set();
      for (const t of p.tracks) {
        used.add(t.id);
        for (const c of t.clips) used.add(c.id);
        for (const fx of t.inserts) used.add(fx.id);
      }
      for (const fx of p.master.inserts) used.add(fx.id);
      for (const sec of p.sections) used.add(sec.id);
    }
    for (;;) {
      const id = newId(prefix);
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
}
// Is there room in the song for what a plan adds? clips/notes: how many more; clipNotes: the most one clip would hold;
// end: the last beat the song would reach. Throws, saying what fits, when there isn't. (A song already past a limit,
// from an old file, can still be rearranged as long as it doesn't grow past where it is.)
function roomFor(p, what, { clips = 0, notes = 0, clipNotes = 0, end = 0 } = {}, hint = '') {
  const s = songSize(p);
  const tail = hint ? `; ${hint}` : '';
  if (clipNotes > LIMITS.clipNotes)
    throw new Error(
      `${what} would make a clip of ${count(clipNotes)} notes; a clip holds up to ${count(LIMITS.clipNotes)}${tail}`,
    );
  if (notes > 0 && s.notes + notes > LIMITS.songNotes)
    throw new Error(
      `${what} would bring the song to ${count(s.notes + notes)} notes; a song holds up to ${count(LIMITS.songNotes)}${tail}`,
    );
  if (clips > 0 && s.clips + clips > LIMITS.clips)
    throw new Error(
      `${what} would bring the song to ${count(s.clips + clips)} clips; a song holds up to ${count(LIMITS.clips)}${tail}`,
    );
  if (end > LIMITS.beats + EPS && end > s.end + EPS) {
    const bars = Math.floor(LIMITS.beats / beatsPerBar(p.meter));
    throw new Error(
      `${what} would run the song to beat ${count(r4(end))}; a song runs up to beat ${count(LIMITS.beats)} (${count(bars)} bars of ${p.meter[0]}/${p.meter[1]})${tail}`,
    );
  }
}

function resolve(ctx, id) {
  if (typeof id === 'string' && id.startsWith('$') && ctx?.refs) {
    const r = ctx.refs[id.slice(1)];
    if (!r) throw new Error(`unknown reference ${id} (refs are made by ref: "name" on an earlier op in the same call)`);
    return r;
  }
  return id;
}
function findSection(p, id, ctx) {
  id = resolve(ctx, typeof id === 'object' && id ? id.id : id);
  const s =
    p.sections.find((x) => x.id === id) ||
    p.sections.find((x) => String(x.name).toLowerCase() === String(id).toLowerCase());
  if (!s)
    throw new Error(
      `no section "${id}" (sections: ${p.sections.map((x) => `${x.id} "${x.name}"`).join(', ') || 'none'})`,
    );
  return s;
}
function findClip(p, trackRef, clipRef, ctx) {
  const cid = resolve(ctx, clipRef);
  if (!cid) throw new Error('which clip? pass clip: "<clip id>" (and track)');
  let track = null;
  if (trackRef != null && trackRef !== '') {
    const tid = resolve(ctx, trackRef);
    track =
      p.tracks.find((x) => x.id === tid) ||
      p.tracks.find((x) => String(x.name).toLowerCase() === String(tid).toLowerCase());
    if (!track)
      throw new Error(`no track "${tid}" (tracks: ${p.tracks.map((x) => `${x.id} "${x.name}"`).join(', ') || 'none'})`);
  }
  for (const t of track ? [track] : p.tracks) {
    const c = t.clips.find((x) => x.id === cid);
    if (c) return { track: t, clip: c };
  }
  throw new Error(
    track
      ? `no clip "${cid}" on track ${track.id} "${track.name}" (clips: ${track.clips.map((x) => x.id).join(', ') || 'none'})`
      : `no clip "${cid}"`,
  );
}
function beatArg(v, what) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) throw new Error(`${what} must be a number of beats`);
  return r4(n);
}

// Where a beat is, for summaries: "bar 9", or "beat 33.5" off the barline.
export function whereLabel(p, beat) {
  const bpb = beatsPerBar(p.meter),
    b = beat / bpb;
  return Math.abs(b - Math.round(b)) < EPS ? `bar ${Math.round(b) + 1}` : `beat ${r4(beat)}`;
}
// "4 bars" when it's whole bars, else "6 beats".
export function spanLabel(p, beats) {
  const bpb = beatsPerBar(p.meter),
    b = beats / bpb;
  return Math.abs(b - Math.round(b)) < EPS ? plural(Math.round(b), 'bar') : plural(r4(beats), 'beat');
}
// Where a beat is as a DAW counts it, 1-based: "6.1" on a beat, "6.3.3" on a sixteenth (bar 6, beat 3, its third
// sixteenth), "6.3.2.5" between them. Comps, take lanes and the takes menu all say positions this way.
export function barBeat(p, beat) {
  const bpb = beatsPerBar(p.meter),
    bar = Math.floor(beat / bpb + EPS),
    inBar = Math.max(0, beat - bar * bpb);
  const bt = Math.floor(inBar + EPS),
    six = (inBar - bt) * 4;
  if (six < 1e-4) return `${bar + 1}.${bt + 1}`;
  return `${bar + 1}.${bt + 1}.${Math.abs(six - Math.round(six)) < 1e-4 ? Math.round(six) + 1 : Math.round((six + 1) * 100) / 100}`;
}
// "5.1–6.1": a stretch of the song, from its first beat to the beat it stops at
export const barBeatSpan = (p, a, b) => `${barBeat(p, a)}–${barBeat(p, b)}`;
// The next free name in a series: Chorus -> Chorus 2, Verse 2 -> Verse 3.
// A number too big to count on from (past 2^53, n + 1 === n) is part of the name: "Take 99999999999999999999 2".
// At most one name per section is taken, so a free one turns up within sections + 1 tries.
export function nextName(p, name) {
  name = String(name ?? '');
  const used = new Set(p.sections.map((s) => String(s.name).toLowerCase()));
  const m = /^(.*?)\s*(\d+)$/.exec(name);
  const num = m && m[1] ? Number(m[2]) : NaN;
  const counts = Number.isSafeInteger(num + 1);
  const base = counts ? m[1] : name;
  let n = counts ? num + 1 : 2;
  for (let k = 0; k <= used.size && used.has(`${base} ${n}`.toLowerCase()); k++) n++;
  return `${base} ${n}`;
}

/* ------------------------------------------------------------------------------------------------ lanes */
// Automation lanes follow the music (core/automation.js): each planner works out every lane's points after the edit
// and plans one auto.write per lane that changed, over just the range that changed, keeping the lane's author
// (_by: false). The write's inverse is guarded like a notes rewrite.

const laneAddr = ({ track, insert, param }) => (insert ? { track, insert, param } : { track, param });
// The auto.write that turns points `a` into `b` (both canonical), over the beats where they differ; null if none.
export function laneWrite(addr, a, b) {
  const group = (pts) => {
    const m = new Map();
    for (const x of pts) m.set(x.t, (m.get(x.t) || '') + JSON.stringify(x));
    return m;
  };
  const ga = group(a),
    gb = group(b);
  let lo = Infinity,
    hi = -Infinity;
  for (const t of new Set([...ga.keys(), ...gb.keys()]))
    if (ga.get(t) !== gb.get(t)) {
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  if (lo === Infinity) return null;
  return {
    type: 'auto.write',
    ...laneAddr(addr),
    from: lo,
    to: hi,
    points: b.filter((x) => x.t >= lo && x.t <= hi),
    _by: false,
    _fit: true,
  };
}
// Plan a write for every lane `fn(points, spec, lane)` changes (points past the song's last beat are dropped).
function lanesPlan(p, ctx, fn, filter = null) {
  const ops = [];
  for (const l of lanesOf(p)) {
    if (filter && !filter(l)) continue;
    const spec = specFor(p, l, ctx?.getDevice || null);
    const next = fn(l.lane.points, spec, l);
    if (!next) continue;
    const w = laneWrite(
      l,
      l.lane.points,
      next.filter((x) => x.t <= LIMITS.beats),
    );
    if (w) ops.push(w);
  }
  return ops;
}
const shiftPts = (pts, by) => pts.map((x) => mkPoint(rt(x.t + by), x.v, x.c, x.by));
const hasIn = (pts, a, b) => pts.some((x) => x.t >= a - EPS && x.t <= b + EPS);
const strictlyIn = (pts, a, b) => pts.some((x) => x.t > a + EPS && x.t < b - EPS);
// Is this lane on track t (its mixer, its instrument, its inserts)?
const onTrack = (t) => (l) => l.track === t.id;

/* Lanes follow clips (the arranger's moves, Alt-copies, ⌘D and pastes, with "Lanes follow clips" on):
   followClips(p, moves, ctx) -> { ops, lanes }
     moves: [{ track, clip, toTrack?, start, copy? }] in the song before the move: the clip, where it lands (start, and
     toTrack when it changes track) and whether it is a copy. For each lane on the clip's track with points strictly
     inside the clip's span, the lane over that span is written at the new span (replacing what was there); a move also
     clears the old span, holding the value from before it. Across tracks the lane goes to the same param on the other
     track (the mixer's always; an instrument's when it is the same device; an insert's on the first insert of the same
     device); when there is none, it stays where it was. */
export function followClips(p, moves = [], ctx = null) {
  const getDevice = ctx?.getDevice || null;
  const state = new Map(); // laneKey -> { addr, pts0, pts }
  // (each point with its author spelled out: a point signed only by its lane's byline would take the other lane's
  // byline when it lands there, so the agent's points moved onto your lane would read as yours)
  const get = (addr) => {
    const k = laneKey(addr);
    if (!state.has(k)) {
      const l = lanesOf(p).find((x) => x.key === k);
      const pts = l ? l.lane.points.map((x) => mkPoint(x.t, x.v, x.c, pointBy(l.lane, x))) : [];
      state.set(k, { addr, pts0: pts, pts });
    }
    return state.get(k);
  };
  const findT = (id) =>
    p.tracks.find((x) => x.id === id) ||
    p.tracks.find((x) => String(x.name).toLowerCase() === String(id).toLowerCase()) ||
    null;
  // Every window is cut from the song before the move (pts0), and every old span is cleared before any window lands,
  // so the order of the moves doesn't matter: moving A and B one clip right writes A's lane over B's old span and B's
  // over the span after it, never A's twice.
  const clears = [],
    lands = [];
  for (const mv of moves) {
    const t = findT(resolve(ctx, mv.track));
    const cid = resolve(ctx, mv.clip);
    const c = t?.clips.find((x) => x.id === cid);
    if (!t || !c) continue;
    const d = mv.toTrack ? findT(resolve(ctx, mv.toTrack)) || t : t;
    const s = c.start,
      e = c.start + c.length,
      ns = Number.isFinite(Number(mv.start)) ? r4(Math.max(0, Number(mv.start))) : s;
    if (d === t && Math.abs(ns - s) < EPS && !mv.copy) continue;
    for (const l of lanesOf(p).filter(onTrack(t))) {
      const src = get(laneAddr(l));
      if (!strictlyIn(src.pts0, s, e)) continue;
      let to = null;
      if (d === t) to = laneAddr(l);
      else if (l.insert == null) to = { track: d.id, param: l.param };
      else if (l.insert === 'instrument') {
        if (d.instrument && t.instrument && d.instrument.device === t.instrument.device)
          to = { track: d.id, insert: 'instrument', param: l.param };
      } else {
        const fx = d.inserts.find((x) => x.device === l.device);
        if (fx) to = { track: d.id, insert: fx.id, param: l.param };
      }
      if (!to) continue;
      const spec = specFor(p, l, getDevice);
      if (!mv.copy) clears.push({ src, s, e, spec });
      lands.push({ to, ns, len: e - s, W: cutLane(src.pts0, s, e, spec), spec });
    }
  }
  for (const { src, s, e, spec } of clears) {
    const v = src.pts.length ? valueBefore(src.pts, s, spec) : null;
    src.pts = spliceLane(src.pts, s, e, [mkPoint(rt(s), v), mkPoint(rt(e), v)], spec);
  }
  for (const { to, ns, len, W, spec } of lands) {
    const dst = get(to);
    dst.pts = spliceLane(dst.pts, ns, rt(ns + len), shiftPts(W, ns), specFor(p, to, getDevice) || spec);
  }
  const ops = [];
  for (const x of state.values()) {
    const w = laneWrite(
      x.addr,
      x.pts0,
      x.pts.filter((q) => q.t <= LIMITS.beats),
    );
    if (w) ops.push(w);
  }
  return { ops, lanes: ops.length };
}

/* ------------------------------------------------------------------------------------------------ notes */

// The notes of a clip that sound in [from, to) (clip-relative beats), moved to start at `from`.
//   trim: the window ends at a cut (a note across `to` stops there; its tail belongs to the next piece)
//   tails: notes that started before `from` and still sound past it keep that part, from 0 (not for drum hits)
// Notes are copied with their ids and authors; a note that didn't change keeps its exact values.
function sliceNotes(notes, from, to, { trim = false, tails = false, drums = false } = {}) {
  const out = [];
  for (const n of notes) {
    const s = n.t,
      e = n.t + n.d;
    const end = trim ? Math.min(e, to) : e;
    if (s >= from - EPS && s < to - EPS) {
      const x = { ...n, t: r4(s - from) };
      if (end < e - EPS) x.d = r4(end - s);
      if (x.d >= MIN_NOTE - EPS) out.push(x);
    } else if (tails && !drums && s < from - EPS && end > from + EPS) {
      const d = r4(end - from);
      if (d >= MIN_NOTE - EPS) out.push({ ...n, t: 0, d });
    }
  }
  return out;
}
// a piece of a clip keeps the tuning and capo its tab is written for (a whole copy is a clone, and keeps them anyway)
function tabOf(c, x) {
  if (c.tuning) x.tuning = c.tuning;
  if (c.capo) x.capo = c.capo;
  return x;
}
const sortNotes = (ns) => ns.sort((a, b) => a.t - b.t || a.p - b.p || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const sameNotes = (a, b) =>
  a.length === b.length && JSON.stringify(sortNotes(a.slice())) === JSON.stringify(sortNotes(b.slice()));
// Rewrite a clip's notes exactly (ids and authors kept): notes.replace's restore form.
const rewrite = (track, clip, notes) => ({ type: 'notes.replace', track, clip, _restore: sortNotes(notes) });

/* ------------------------------------------------------------------------------------------------ split */

// The two halves of a clip cut at song beat `at`: { left: { length, notes? }, right: Partial<Clip> } (right without id).
function halves(p, t, c, at) {
  const rel = at - c.start;
  const right = { kind: c.kind, start: r4(at), length: r4(c.start + c.length - at), by: c.by };
  if (c.name) right.name = c.name;
  if (c.color) right.color = c.color;
  if (c.mute) right.mute = true; // (a muted clip's right half stays muted)
  tabOf(c, right);
  const left = { length: r4(rel) };
  if (c.kind === 'audio') {
    Object.assign(right, { asset: c.asset, offset: r4((+c.offset || 0) + rel * (60 / p.tempo)), gain: +c.gain || 0 });
  } else {
    const drums = isDrums(t);
    left.notes = sliceNotes(c.notes, 0, rel, { trim: true });
    // notes from the cut on (including any past the clip's end, which stay silent there too)
    right.notes = sliceNotes(c.notes, rel, Infinity, { tails: true, drums });
  }
  return { left, right };
}
function splitOps(p, t, c, at, { moveRightBy = 0, id, ref = null, take = null } = {}) {
  const { left, right } = halves(p, t, c, at);
  if (isTakeId(take)) right.take = take;
  const ops = [{ type: 'clip.set', track: t.id, clip: c.id, patch: { length: left.length } }];
  if (c.kind === 'notes' && !sameNotes(left.notes, c.notes)) ops.push(rewrite(t.id, c.id, left.notes));
  right.start = r4(right.start + moveRightBy);
  const add = { type: 'clip.add', track: t.id, clip: { id, ...right } };
  if (ref) add.ref = ref;
  ops.push(add);
  return { ops, id, left, right };
}

export function planClipSplit(p, op = {}, ctx = null) {
  const { track: t, clip: c } = findClip(p, op.track, op.clip, ctx);
  const at = beatArg(op.at, 'at (the song beat to split at)');
  // a take of a folder: every take in it is split there, and both halves are folders
  if (isTakeId(c.take)) return planFolderSplit(p, t, c, at, op);
  const end = c.start + c.length;
  if (!(at >= c.start + MIN_CLIP - EPS && at <= end - MIN_CLIP + EPS)) {
    throw new Error(
      `beat ${at} isn't inside clip ${c.id} far enough to split it (it covers beats ${r4(c.start)}–${r4(end)}; split at least ${MIN_CLIP} beats from either end)`,
    );
  }
  roomFor(p, `Splitting ${c.name || t.name}`, { clips: 1 });
  const sp = splitOps(p, t, c, at, { ref: op.ref || null, id: idMinter(p)('c') });
  const cut =
    c.kind === 'notes' ? c.notes.filter((n) => n.t < at - c.start - EPS && n.t + n.d > at - c.start + EPS).length : 0;
  const name = c.name || t.name;
  return {
    ops: sp.ops,
    clip: sp.id,
    track: t.id,
    left: c.kind === 'notes' ? sp.left.notes.length : null,
    right: c.kind === 'notes' ? sp.right.notes.length : null,
    cut,
    summary: `Split ${name} at ${whereLabel(p, at)}${c.kind === 'notes' ? `: ${plural(sp.left.notes.length, 'note')} before, ${plural(sp.right.notes.length, 'note')} after${cut ? `, ${plural(cut, 'note')} cut in two` : ''}` : ''}.`,
  };
}

/* ------------------------------------------------------------------------------------------------ repeat */

// The lanes on the clip's track with points under the clip: that stretch written again under each repeat.
function repeatLanes(p, t, c, times, ctx) {
  const L = c.length,
    s = c.start;
  return lanesPlan(
    p,
    ctx,
    (pts, spec) => {
      if (!hasIn(pts, s, s + L)) return null;
      const W = cutLane(pts, s, s + L, spec);
      let out = pts;
      for (let k = 1; k < times; k++)
        out = spliceLane(out, rt(s + k * L), rt(s + (k + 1) * L), shiftPts(W, s + k * L), spec);
      return out;
    },
    onTrack(t),
  );
}

export function planClipRepeat(p, op = {}, ctx = null) {
  const { track: t, clip: c } = findClip(p, op.track, op.clip, ctx);
  const times = op.times == null ? 2 : Number(op.times);
  if (!(Number.isInteger(times) && times >= 2 && times <= 64))
    throw new Error(
      'times is how often the clip plays in all, counting itself: a whole number from 2 to 64 (2 = one more time)',
    );
  const mode = op.mode || 'copies';
  if (mode !== 'copies' && mode !== 'loop')
    throw new Error('mode is "copies" (new clips end to end) or "loop" (a longer clip, its notes looped)');
  const L = c.length,
    name = c.name || t.name;
  const ops = [],
    ids = [];
  const until = c.start + L * times;
  const what = `${mode === 'loop' ? 'Looping' : 'Repeating'} ${name} ×${times}`;
  const overlaps = t.clips.filter(
    (x) => x !== c && x.start < until - EPS && x.start + x.length > c.start + L + EPS,
  ).length;
  if (mode === 'loop') {
    if (c.kind !== 'notes')
      throw new Error(`${name} is an audio clip: it can't loop inside itself; repeat it as copies (mode "copies")`);
    // one pass of the clip as it sounds: notes cut at its end (the engine cuts them there), none from past it
    const pass = c.notes
      .filter((n) => n.t < L - EPS)
      .map((n) => (n.t + n.d > L + EPS ? { ...n, d: r4(L - n.t) } : { ...n }));
    const dropped = c.notes.length - pass.length;
    const per = Math.max(1, pass.length);
    const fits = Math.min(
      64,
      Math.floor(LIMITS.clipNotes / per),
      Math.floor((LIMITS.songNotes - songSize(p).notes + c.notes.length) / per),
      Math.floor((LIMITS.beats - c.start) / L),
    );
    roomFor(
      p,
      what,
      { clipNotes: pass.length * times, notes: pass.length * times - c.notes.length, end: until },
      fits >= 2 ? `×${fits} fits` : '',
    );
    const notes = pass.map((n) => ({ ...n }));
    for (let k = 1; k < times; k++)
      for (const n of pass) {
        const x = { ...n, t: r4(n.t + k * L) };
        delete x.id;
        notes.push(x);
      }
    ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { length: r4(L * times) } });
    ops.push(rewrite(t.id, c.id, notes));
    ops.push(...repeatLanes(p, t, c, times, ctx));
    return {
      ops,
      clip: c.id,
      track: t.id,
      clips: [],
      overlaps,
      until: r4(until),
      summary: `Looped ${name} ×${times}: it now runs ${spanLabel(p, L * times)} to ${whereLabel(p, until)}, ${plural(pass.length * times, 'note')}${dropped ? ` (${plural(dropped, 'silent note')} past its old end dropped)` : ''}${overlaps ? `; it now overlaps ${plural(overlaps, 'clip')} after it` : ''}.`,
    };
  }
  const n = c.kind === 'notes' ? c.notes.length : 0,
    s0 = songSize(p);
  const fits = Math.min(
    64,
    1 + LIMITS.clips - s0.clips,
    n ? 1 + Math.floor((LIMITS.songNotes - s0.notes) / n) : 64,
    Math.floor((LIMITS.beats - c.start) / L),
  );
  roomFor(p, what, { clips: times - 1, notes: n * (times - 1), end: until }, fits >= 2 ? `×${fits} fits` : '');
  const mint = idMinter(p);
  for (let k = 1; k < times; k++) {
    const x = clone(c);
    x.id = mint('c');
    delete x.by; // the copy is whoever asked's; the notes stay their authors'
    x.start = r4(c.start + k * L);
    retake([x]); // (a copy of a take is an ordinary clip, not one more piece of its folder)
    ids.push(x.id);
    const add = { type: 'clip.add', track: t.id, clip: x };
    if (k === 1 && op.ref) add.ref = op.ref;
    ops.push(add);
  }
  ops.push(...repeatLanes(p, t, c, times, ctx));
  return {
    ops,
    clip: c.id,
    track: t.id,
    clips: ids,
    overlaps,
    until: r4(until),
    summary: `Repeated ${name} ×${times}: ${plural(times - 1, 'copy', 'copies')} end to end, up to ${whereLabel(p, until)}${overlaps ? `; ${overlaps === 1 ? 'it overlaps a clip' : `they overlap ${overlaps} clips`} that ${overlaps === 1 ? 'was' : 'were'} there` : ''}.`,
  };
}

/* ------------------------------------------------------------------------------------------------ insert */

export function planTimeInsert(p, op = {}, ctx = null) {
  const at = beatArg(op.at, 'at (the beat to insert at)');
  const L = beatArg(op.length, 'length (how many beats to insert)');
  if (at < 0) throw new Error('at must be a beat >= 0');
  if (!(L > 0)) throw new Error('length must be more than 0 beats');
  const end0 = songSize(p).end;
  if (end0 > at + EPS) roomFor(p, `Inserting ${spanLabel(p, L)} at ${whereLabel(p, at)}`, { end: end0 + L });
  const mint = idMinter(p);
  const ops = [];
  let moved = 0,
    split = 0,
    grown = 0,
    shifted = 0;
  // a clip that starts at or after `at`, or within a quarter beat before it, moves whole; one that runs less than
  // a quarter beat past it stays (ringing a hair into the new bars); one across it is split there
  const how = (c) =>
    c.start + c.length <= at + EPS
      ? 'stays'
      : c.start >= at - MIN_CLIP + EPS
        ? 'moves'
        : c.start + c.length - at >= MIN_CLIP - EPS
          ? 'splits'
          : 'stays';
  for (const t of p.tracks) {
    // a take folder the new bars cut in two is split there, as Split splits it: every take is cut, and what lands
    // after the new bars is a folder of its own (each half keeps its takes)
    const parts = new Map();
    for (const c of t.clips)
      if (isTakeId(c.take)) {
        const h = how(c),
          x = parts.get(c.take) || { left: false, right: false };
        if (h !== 'moves') x.left = true;
        if (h !== 'stays') x.right = true;
        parts.set(c.take, x);
      }
    const side = new Map();
    for (const [id, x] of parts) if (x.left && x.right) side.set(id, newId('tk'));
    for (const c of t.clips) {
      const h = how(c),
        tk = side.get(c.take) || null;
      if (h === 'moves') {
        ops.push({
          type: 'clip.set',
          track: t.id,
          clip: c.id,
          patch: { start: r4(c.start + L), ...(tk ? { take: tk } : {}) },
        });
        moved++;
      } else if (h === 'splits') {
        ops.push(...splitOps(p, t, c, at, { moveRightBy: L, id: mint('c'), take: tk }).ops);
        split++;
      }
    }
  }
  for (const s of p.sections) {
    if (s.start >= at - EPS) {
      ops.push({ type: 'section.set', section: s.id, patch: { start: r4(s.start + L) } });
      shifted++;
    } else if (s.start + s.length > at + EPS) {
      ops.push({ type: 'section.set', section: s.id, patch: { length: r4(s.length + L) } });
      grown++;
    }
  }
  const lp = p.loop || {};
  let loop = false;
  if (fin(lp.start) && fin(lp.end)) {
    const ns = lp.start >= at - EPS ? lp.start + L : lp.start,
      ne = lp.end > at + EPS ? lp.end + L : lp.end;
    if (ns !== lp.start || ne !== lp.end) {
      ops.push({ type: 'project.set', patch: { loop: { on: !!lp.on, start: r4(ns), end: r4(ne) } } });
      loop = true;
    }
  }
  const laneOps = lanesPlan(p, ctx, (pts, spec) => insertTime(pts, at, L, spec));
  ops.push(...laneOps);
  const bits = [];
  if (moved) bits.push(`${plural(moved, 'clip')} moved right`);
  if (split) bits.push(`${plural(split, 'clip')} split there`);
  if (shifted || grown)
    bits.push(
      [shifted && `${plural(shifted, 'section')} moved`, grown && `${plural(grown, 'section')} grew`]
        .filter(Boolean)
        .join(', '),
    );
  if (loop) bits.push('the loop moved with them');
  if (laneOps.length) bits.push(`${plural(laneOps.length, 'automation lane')} moved too`);
  return {
    ops,
    at,
    length: L,
    moved,
    split,
    sections: { moved: shifted, grown },
    loop,
    lanes: laneOps.length,
    summary: `Inserted ${spanLabel(p, L)} at ${whereLabel(p, at)}${bits.length ? `: ${bits.join('; ')}` : ''}.`,
  };
}

/* ------------------------------------------------------------------------------------------------ remove */

export function planTimeRemove(p, op = {}, ctx = null) {
  const A = beatArg(op.at, 'at (the first beat to delete)');
  const L = beatArg(op.length, 'length (how many beats to delete)');
  if (A < 0) throw new Error('at must be a beat >= 0');
  if (!(L > 0)) throw new Error('length must be more than 0 beats');
  const B = A + L;
  const cs = (x) => (x < A + EPS ? x : x < B - EPS ? A : x - L); // a start after the cut closes up
  const ce = (x) => (x <= A + EPS ? x : x <= B + EPS ? A : x - L); // an end
  const spb = 60 / p.tempo;
  const mint = idMinter(p);
  const ops = [];
  let removed = 0,
    trimmed = 0,
    moved = 0,
    cutNotes = 0;
  for (const t of p.tracks) {
    const drums = isDrums(t);
    for (const c of t.clips) {
      const s = c.start,
        e = c.start + c.length;
      if (e <= A + EPS) continue;
      if (s >= B - EPS) {
        ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { start: r4(s - L) } });
        moved++;
        continue;
      }
      const left = s < A - EPS ? [s, Math.min(e, A)] : null,
        right = e > B + EPS ? [Math.max(s, B), e] : null;
      const len = (x) => (x ? x[1] - x[0] : 0);
      if (len(left) + len(right) < MIN_CLIP - EPS) {
        ops.push({ type: 'clip.remove', track: t.id, clip: c.id });
        removed++;
        continue;
      }
      if (c.kind === 'audio') {
        const pieces = [left, right].filter((x) => x && len(x) >= MIN_CLIP - EPS);
        if (!pieces.length) {
          ops.push({ type: 'clip.remove', track: t.id, clip: c.id });
          removed++;
          continue;
        }
        const at0 = (x) => ({
          start: r4(cs(x[0])),
          length: r4(len(x)),
          offset: r4((+c.offset || 0) + (x[0] - s) * spb),
        });
        const first = at0(pieces[0]);
        const patch = {};
        for (const k of ['start', 'length', 'offset'])
          if (Math.abs((k === 'offset' ? +c.offset || 0 : c[k]) - first[k]) > EPS) patch[k] = first[k];
        if (Object.keys(patch).length) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch });
        if (pieces[1]) {
          const x = { id: mint('c'), kind: 'audio', asset: c.asset, gain: +c.gain || 0, by: c.by, ...at0(pieces[1]) };
          if (c.name) x.name = c.name;
          if (c.color) x.color = c.color;
          // (a muted clip stays muted; a take stays in its folder, which closes up around the cut like a notes take)
          if (c.mute) x.mute = true;
          if (isTakeId(c.take)) x.take = c.take;
          ops.push({ type: 'clip.add', track: t.id, clip: x });
        }
        trimmed++;
        continue;
      }
      // a notes clip closes up around the cut: one clip, its notes outside the cut kept (each keeps its sounding part)
      const ns = r4(cs(s)),
        nl = r4(len(left) + len(right));
      const notes = [];
      for (const n of c.notes) {
        const a = s + n.t,
          b = Math.min(a + n.d, e); // (a note sounds up to the clip's end)
        if (a + n.d <= A + EPS || a >= B - EPS) {
          notes.push({ ...n, t: r4(cs(a) - ns) });
          continue;
        } // untouched (maybe moved)
        cutNotes++;
        if (drums && a >= A - EPS) continue; // a hit inside the cut goes with it
        const na = cs(a),
          nb = ce(b);
        if (nb - na >= MIN_NOTE - EPS) notes.push({ ...n, t: r4(na - ns), d: r4(nb - na) });
      }
      const patch = {};
      if (Math.abs(ns - s) > EPS) patch.start = ns;
      if (Math.abs(nl - c.length) > EPS) patch.length = nl;
      if (Object.keys(patch).length) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch });
      if (!sameNotes(notes, c.notes)) ops.push(rewrite(t.id, c.id, notes));
      trimmed++;
    }
  }
  let secGone = 0,
    secCut = 0,
    secMoved = 0;
  for (const sec of p.sections) {
    const s = sec.start,
      e = sec.start + sec.length;
    if (e <= A + EPS) continue;
    if (s >= B - EPS) {
      ops.push({ type: 'section.set', section: sec.id, patch: { start: r4(s - L) } });
      secMoved++;
      continue;
    }
    const ns = r4(cs(s)),
      ne = r4(ce(e));
    if (ne - ns < EPS || (s >= A - EPS && e <= B + EPS)) {
      ops.push({ type: 'section.remove', section: sec.id });
      secGone++;
      continue;
    }
    const patch = {};
    if (Math.abs(ns - s) > EPS) patch.start = ns;
    if (Math.abs(ne - ns - sec.length) > EPS) patch.length = r4(ne - ns);
    if (Object.keys(patch).length) {
      ops.push({ type: 'section.set', section: sec.id, patch });
      secCut++;
    }
  }
  const lp = p.loop || {};
  let loop = null;
  if (fin(lp.start) && fin(lp.end) && lp.end > A + EPS) {
    let ns = r4(cs(lp.start)),
      ne = r4(ce(lp.end));
    let off = false;
    if (ne - ns < EPS) {
      ns = A;
      ne = r4(A + beatsPerBar(p.meter));
      off = !!lp.on;
    } // the loop was inside the cut
    if (ns !== lp.start || ne !== lp.end) {
      ops.push({ type: 'project.set', patch: { loop: { on: off ? false : !!lp.on, start: ns, end: ne } } });
      loop = off ? 'off' : 'moved';
    }
  }
  const laneOps = lanesPlan(p, ctx, (pts, spec) => removeTime(pts, A, L, spec));
  ops.push(...laneOps);
  const bits = [];
  if (removed) bits.push(`${plural(removed, 'clip')} gone`);
  if (trimmed) bits.push(`${plural(trimmed, 'clip')} trimmed`);
  if (moved) bits.push(`${plural(moved, 'clip')} moved left`);
  if (secGone) bits.push(`${plural(secGone, 'section')} gone`);
  if (secCut) bits.push(`${plural(secCut, 'section')} shortened`);
  if (loop) bits.push(loop === 'off' ? 'the loop was inside them, so it is off' : 'the loop moved with them');
  if (laneOps.length) bits.push(`${plural(laneOps.length, 'automation lane')} closed up too`);
  return {
    ops,
    at: A,
    length: L,
    removed,
    trimmed,
    moved,
    notesCut: cutNotes,
    sections: { removed: secGone, shortened: secCut, moved: secMoved },
    loop,
    lanes: laneOps.length,
    summary: `Deleted ${spanLabel(p, L)} from ${whereLabel(p, A)}${bits.length ? `: ${bits.join(', ')}` : ''}.`,
  };
}

/* ------------------------------------------------------------------------------------------------ duplicate */

export function planSectionDuplicate(p, op = {}, ctx = null) {
  const sec = findSection(p, op.section, ctx);
  const a = sec.start,
    b = sec.start + sec.length,
    L = sec.length;
  const to = op.to == null ? b : beatArg(op.to, 'to (the beat the copy starts at)');
  if (to < 0) throw new Error('to must be a beat >= 0');
  const push = !!op.push;
  const ops = [];
  let ins = null;
  if (push) {
    ins = planTimeInsert(p, { at: to, length: L }, ctx);
    ops.push(...ins.ops);
  }
  const mint = idMinter(p);
  const clips = [];
  let notes = 0;
  for (const t of p.tracks) {
    for (const c of t.clips) {
      // every clip that plays in the section, cut to it: one that starts before it (a whole-song beat or pad) brings
      // the part from the section's start, as a split there would (a pitched note ringing across keeps its tail)
      const s = c.start,
        e = c.start + c.length;
      if (s >= b - EPS || e <= a + EPS) continue;
      const from = s < a - EPS ? a : s,
        end = Math.min(e, b);
      if (end - from < MIN_CLIP - EPS) continue;
      const x = clone(c);
      x.id = mint('c');
      delete x.by; // the copy is whoever asked's; the notes stay their authors'
      x.start = r4(from - a + to);
      x.length = r4(end - from);
      if (c.kind === 'notes') {
        x.notes =
          from > s
            ? sliceNotes(c.notes, from - s, end - s, { trim: e > b + EPS, tails: true, drums: isDrums(t) })
            : e > b + EPS
              ? sliceNotes(c.notes, 0, end - s, { trim: true })
              : clone(c.notes);
        notes += x.notes.length;
      } else if (from > s) x.offset = r4((+c.offset || 0) + (from - s) * (60 / p.tempo));
      clips.push({ track: t.id, clip: x.id, from: c.id });
      ops.push({ type: 'clip.add', track: t.id, clip: x });
    }
  }
  // (the copies of a take folder are a folder of their own: comping or deleting a take in one never reaches the other)
  retake(ops.filter((o) => o.type === 'clip.add' && clips.some((x) => x.clip === o.clip.id)).map((o) => o.clip));
  // (push made room after `to` already, and planTimeInsert held that to the length limit; this is the copy itself)
  roomFor(p, `Copying ${sec.name} to ${whereLabel(p, to)}`, { clips: clips.length, notes, end: to + L });
  const id = mint('s');
  const add = {
    type: 'section.add',
    section: { id, name: nextName(p, sec.name), start: to, length: L, ...(sec.color ? { color: sec.color } : {}) },
  };
  if (op.ref) add.ref = op.ref;
  ops.push(add);
  // each lane with points in the section: the section's stretch of it (its values at both edges) written at the copy,
  // on the lane as it is after the push made room
  let laneCount = 0;
  for (const l of lanesOf(p)) {
    if (!hasIn(l.lane.points, a, b)) continue;
    const spec = specFor(p, l, ctx?.getDevice || null);
    const now = push ? insertTime(l.lane.points, to, L, spec) : l.lane.points;
    const next = spliceLane(now, to, rt(to + L), shiftPts(cutLane(l.lane.points, a, b, spec), to), spec);
    const w = laneWrite(
      l,
      now,
      next.filter((x) => x.t <= LIMITS.beats),
    );
    if (w) {
      ops.push(w);
      laneCount++;
    }
  }
  const after = Math.abs(to - b) < EPS;
  const moved = ins ? ins.moved + ins.split : 0;
  return {
    ops,
    section: id,
    name: add.section.name,
    source: sec.name,
    from: r4(a),
    to: r4(to),
    length: L,
    clips,
    notes,
    pushed: push,
    insert: ins,
    lanes: laneCount,
    summary: `Copied ${sec.name} (${spanLabel(p, L)}) to ${after ? 'right after it' : whereLabel(p, to)} as ${add.section.name}, with ${plural(clips.length, 'clip')}${laneCount ? ` and its automation (${plural(laneCount, 'lane')})` : ''}${push ? (moved || ins.sections.moved ? `; everything after moved right ${spanLabel(p, L)}` : '') : ''}.`,
  };
}

/* ------------------------------------------------------------------------------------------------ takes */
// Take folders. A recording's passes over one range of a track (input/recorder.js) are one take folder: clips that
// share a take id (clip.take) and all cover the same beats [start, end). One plays; the others are kept, muted. What
// played there before is one more entry (keeping its own name, "Changes", or "What played" when it was another
// folder's take), the first; the passes are named "Take N" in folder order, so the name, "take N of M" and "M takes"
// agree, and no two entries share a name. A folder never holds a piece covering other bars,
// and never an empty leftover: an alternative take whose part of a range has no notes in it goes.
//
//   takeNumber(clip)                  N of "Take N", else 0 (what played before, or an unnamed clip)
//   takeFolders(track)                -> [{ id, clips (folder order), start, end, playing }]
//   planTakeFolder(p, spec)           the ops that put new passes over [start, end) of a track as one folder:
//     spec: { track, kind: 'notes' | 'audio', start, end, take (a new take id), drums?, active? (index), passes:
//       [{ start, end, notes?: [{ p, t (song beat), d, v }], audio?: { asset, offset, gain? } }] }
//     -> { ops, group, refs (one per pass, its clip.add ref), names, active: { ref, name, num, notes }, total, under }
//     What it covers: a clip across an edge is cut there (its outer parts stay as they were); what played inside goes
//     into the folder, muted (one entry; a range under several clips becomes one clip of what was heard), and a note
//     ringing out of it past its end isn't struck again there (the take replaced its start); a folder
//     over the same range takes the new passes; one over other bars is cut at the edges, its takes there joining this
//     one. A notes pass narrower than the range (the first pass of a take begun inside the loop, a pass cut short by
//     the stop) is filled out with what played there before, so picking any take never leaves part of the range silent.
//   planClipTrim(p, { track, clip, start, end })   cut a clip's window to [start, end) (notes stay where they sound;
//     an audio clip's offset moves): the arranger's edge drags and "Trim to the loop". Trimming the playing take of a
//     folder also gives back what it no longer covers: what played there before plays again, and the other takes
//     there stay, muted, as a folder of their own; growing it again puts what it covers back in its folder, muted. An
//     audio clip's start stops where its recording starts. -> { ops, uncovered: [[a, b)], covered: [[a, b)], summary }
//   retake(copies)                    copies of takes leave the source's folder (a folder of their own, or none)

// Copies of clips (a duplicated section, a repeat, ⌘D, an Alt-drag) never join their source's take folder: copies of
// two or more of one folder's takes, made together, are a folder of their own; a lone copy of a take is an ordinary
// clip (muted if its take was). Mutates the copies (new clips, without ids yet or with them) and returns them.
export function retake(copies) {
  const groups = new Map();
  for (const x of copies)
    if (x && isTakeId(x.take)) {
      if (!groups.has(x.take)) groups.set(x.take, []);
      groups.get(x.take).push(x);
    }
  for (const xs of groups.values()) {
    const id = xs.length > 1 ? newId('tk') : null;
    for (const x of xs) {
      if (id) x.take = id;
      else delete x.take;
    }
  }
  return copies;
}

export const takeNumber = (c) => {
  const m = /^Take (\d+)$/.exec((c && c.name) || '');
  return m ? +m[1] : 0;
};
const near = (a, b) => Math.abs(a - b) < 1e-3;
const clipEnd = (c) => c.start + c.length;
const overlapOf = (c, a, b) => Math.min(b, clipEnd(c)) - Math.max(a, c.start);

export function takeFolders(t) {
  const m = new Map();
  (t?.clips || []).forEach((c, i) => {
    if (isTakeId(c.take)) {
      if (!m.has(c.take)) m.set(c.take, []);
      m.get(c.take).push({ c, i });
    }
  });
  return [...m].map(([id, list]) => {
    const clips = list.sort((x, y) => takeNumber(x.c) - takeNumber(y.c) || x.i - y.i).map((x) => x.c);
    const lanes = folderLanes(clips);
    const cuts = cutsOf(clips);
    const comp = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k],
        b = cuts[k + 1];
      const lane = lanes.findIndex((l) => l.clips.some((c) => !c.mute && covers(c, a, b)));
      const clip = lane < 0 ? null : lanes[lane].clips.find((c) => covers(c, a, b));
      comp.push({ start: a, end: b, lane, clip });
    }
    return {
      id,
      clips,
      start: Math.min(...clips.map((c) => c.start)),
      end: Math.max(...clips.map(clipEnd)),
      playing: clips.find((c) => !c.mute) || null,
      lanes,
      cuts,
      comp,
    };
  });
}

/* ------------------------------------------------------------------------------------------------ comping */
// A take folder's lanes: one per take (the clips of one name: "Take 2", or what played before), in folder order. A
// lane is one clip over the folder's beats until it is comped; then it is pieces, cut where the comp changes take
// (cuts: every piece's edges), and in each stretch between two cuts one lane's piece plays (comp: which one, or -1).
// Comping is splits and mutes, never new notes: picking a take for some bars cuts every lane there (a note across a
// cut keeps its sounding part, and its id, on each side, as a split does) and plays that lane's piece; cuts that no
// longer change the take are joined up again, so taking the whole folder back to one take leaves one clip per lane.
// Only a note a cut split is joined back into one (the same id on both sides); and an audio lane's pieces that are
// two recordings side by side (what played was two takes) stay two clips, each playing its own file.
//
//   planTakeComp(p, { track, take | clip, lane (index, or a clip of the lane), start, end })   that take plays there,
//                                            from start to end as given (an end a hair off a cut goes to it); -> cut:
//                                            how many notes ring over its edges and are cut there (the summary says so)
//   planTakeLaneDelete(p, { track, clip })   a take (its whole lane) goes; where it played the newest take left plays
//   planTakesFlatten(p, { track, clip })     what plays stays as one ordinary clip (merged, notes where they played;
//                                            two audio recordings side by side stay two); what didn't play goes
//   -> { ops, summary, ... }; one dispatch is one undo step, and the arranger signs it by whoever asked
//   planClipSplit on a take: every take in the folder is cut there; the right halves are a folder of their own
const covers = (c, a, b) => c.start <= a + EPS && clipEnd(c) >= b - EPS;
// Can piece b of a lane, right after piece a, be one clip with it? Notes can (each note keeps its sounding part). Audio
// only when b carries on in the same file where a stops, as a cut leaves it: two recordings side by side (what played
// over a range was two takes) stay two clips, each playing its own file.
function joins(a, b, spb) {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'audio') return true;
  return (
    a.asset === b.asset &&
    (+a.gain || 0) === (+b.gain || 0) &&
    Math.abs((+b.offset || 0) - ((+a.offset || 0) + (b.start - a.start) * spb)) < 1e-3
  );
}
function cutsOf(clips) {
  const xs = [];
  for (const c of clips) for (const x of [r4(c.start), r4(clipEnd(c))]) if (!xs.some((y) => near(x, y))) xs.push(x);
  return xs.sort((a, b) => a - b);
}
function folderLanes(clips) {
  const lanes = [];
  for (const c of clips) {
    const key = c.name || '';
    let l = lanes.find((x) => x.key === key && !x.clips.some((y) => overlapOf(y, c.start, clipEnd(c)) > EPS));
    if (!l) {
      l = { key, name: c.name || null, num: takeNumber(c), clips: [] };
      lanes.push(l);
    }
    l.clips.push(c);
  }
  for (const l of lanes) l.clips.sort((a, b) => a.start - b.start);
  return lanes;
}
function folderOf(p, op, ctx) {
  const ref = op.clip ? findClip(p, op.track, op.clip, ctx) : null;
  const t = ref ? ref.track : p.tracks.find((x) => x.id === op.track || x.name === op.track);
  if (!t) throw new Error(`no track "${op.track}"`);
  const take = op.take || ref?.clip.take;
  const f = takeFolders(t).find((x) => x.id === take);
  if (!f) throw new Error(`${ref ? `clip ${ref.clip.id}` : `"${take}"`} isn't in a take folder on ${t.name}`);
  return { t, f, clip: ref ? ref.clip : null };
}
const laneOfClip = (f, c) => f.lanes.findIndex((l) => l.clips.includes(c));
const laneName = (t, l) => (l && l.name) || t.name;

// The ops that make a folder's lanes play `plays` (one lane index or -1 per stretch between `cuts`), cut only where
// the take changes (or a lane starts or stops), without the lanes in `drop`.
function rebuildFolder(p, t, f, cuts, plays, drop = new Set()) {
  const mint = idMinter(p),
    drums = isDrums(t),
    spb = 60 / p.tempo;
  const m = cuts.length - 1;
  const cov = f.lanes.map((l) =>
    [...Array(m).keys()].map((k) => l.clips.find((c) => covers(c, cuts[k], cuts[k + 1])) || null),
  );
  const keep = (k) =>
    plays[k - 1] !== plays[k] || f.lanes.some((l, i) => !drop.has(i) && !!cov[i][k - 1] !== !!cov[i][k]);
  // (a lane also keeps a cut between two of its pieces that aren't one recording: two takes side by side stay two)
  const seam = (i, k) => !!cov[i][k - 1] && !!cov[i][k] && !joins(cov[i][k - 1], cov[i][k], spb);
  const ops = [];
  f.lanes.forEach((l, i) => {
    if (drop.has(i)) {
      for (const c of l.clips) ops.push({ type: 'clip.remove', track: t.id, clip: c.id });
      return;
    }
    // the pieces it should have: runs of stretches it covers, cut where a cut is kept
    const want = [];
    for (let k = 0; k < m; k++) {
      if (!cov[i][k]) continue;
      const last = want[want.length - 1];
      if (last && near(last.end, cuts[k]) && !keep(k) && !seam(i, k)) last.end = cuts[k + 1];
      else want.push({ start: cuts[k], end: cuts[k + 1], mute: plays[k] !== i, k });
    }
    const same =
      want.length === l.clips.length &&
      want.every((w, j) => near(w.start, l.clips[j].start) && near(w.end, clipEnd(l.clips[j])));
    if (same) {
      want.forEach((w, j) => {
        const c = l.clips[j];
        if (!!c.mute !== w.mute) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { mute: w.mute } });
      });
      return;
    }
    // re-cut: the lane's notes in song beats (a note cut by an old cut joined up again), then sliced at the new cuts
    const runs = [];
    for (const c of l.clips) {
      const r = runs[runs.length - 1];
      if (r && near(r.end, c.start) && joins(r.clips[r.clips.length - 1], c, spb)) {
        r.clips.push(c);
        r.end = clipEnd(c);
      } else runs.push({ start: c.start, end: clipEnd(c), clips: [c] });
    }
    const used = new Set();
    for (const run of runs) {
      const notes = [];
      if (run.clips[0].kind === 'notes') {
        run.clips.forEach((c, j) => {
          const lastC = j === run.clips.length - 1;
          for (const n of c.notes) {
            if (!lastC && n.t >= c.length - EPS) continue;
            const x = { ...n, t: r4(c.start + n.t - run.start), _src: c.id };
            // a note a cut split joins up again: its tail starts the next piece with the note's own id (a cut keeps
            // it on both parts). A note of the same pitch that only ends on the cut, with the next struck there, is two.
            const prev =
              !drums &&
              n.t < EPS &&
              n.id != null &&
              notes.find((y) => y._end != null && near(y._end, c.start) && y.id === n.id && y.p === n.p && y.v === n.v);
            if (prev) {
              prev.d = r4(prev.d + n.d);
              prev._end = !lastC && near(n.t + n.d, c.length) ? clipEnd(c) : null;
              continue;
            }
            x._end = !lastC && near(n.t + n.d, c.length) ? clipEnd(c) : null;
            notes.push(x);
          }
        });
      }
      for (const w of want.filter((x) => x.start >= run.start - EPS && x.end <= run.end + EPS)) {
        const reuse = run.clips.find((c) => near(c.start, w.start) && !used.has(c.id)) || null;
        // (notes keep their ids, a cut note's id on both its parts, so a later join can tell it from two notes; an id
        // twice in one piece goes, and the clip gives that note a new one)
        const seen = new Set();
        const ns =
          run.clips[0].kind !== 'notes'
            ? null
            : sliceNotes(notes, w.start - run.start, w.end - run.start, {
                trim: w.end < run.end - EPS,
                tails: w.start > run.start + EPS,
                drums,
              }).map((n) => {
                const x = { ...n };
                if (x.id != null && seen.has(x.id)) delete x.id;
                else if (x.id != null) seen.add(x.id);
                delete x._src;
                delete x._end;
                return x;
              });
        // (the piece of the run where this one starts: its file and offset, its name)
        const src = run.clips.find((c) => c.start <= w.start + EPS && clipEnd(c) > w.start + EPS) || run.clips[0];
        if (reuse) {
          used.add(reuse.id);
          const patch = {};
          if (!near(w.end - w.start, reuse.length)) patch.length = r4(w.end - w.start);
          if (!!reuse.mute !== w.mute) patch.mute = w.mute;
          if (Object.keys(patch).length) ops.push({ type: 'clip.set', track: t.id, clip: reuse.id, patch });
          if (ns && !sameNotes(ns, reuse.notes)) ops.push(rewrite(t.id, reuse.id, ns));
        } else {
          const x = {
            id: mint('c'),
            kind: src.kind,
            start: r4(w.start),
            length: r4(w.end - w.start),
            by: src.by,
            take: f.id,
          };
          if (src.name) x.name = src.name;
          if (src.color) x.color = src.color;
          if (w.mute) x.mute = true;
          if (src.kind === 'audio')
            Object.assign(x, {
              asset: src.asset,
              offset: r4((+src.offset || 0) + (w.start - src.start) * spb),
              gain: +src.gain || 0,
            });
          else x.notes = ns;
          ops.push({ type: 'clip.add', track: t.id, clip: x });
        }
      }
      for (const c of run.clips) if (!used.has(c.id)) ops.push({ type: 'clip.remove', track: t.id, clip: c.id });
    }
  });
  // (removes first, so the adds never meet a clip of the same id; mutes and lengths before the adds)
  const rank = (o) => (o.type === 'clip.remove' ? 0 : o.type === 'clip.add' ? 2 : 1);
  return ops
    .map((o, i) => [o, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map((x) => x[0]);
}
// which lane plays each stretch now
const playsOf = (f, cuts) =>
  cuts.slice(0, -1).map((a, k) => f.lanes.findIndex((l) => l.clips.some((c) => !c.mute && covers(c, a, cuts[k + 1]))));
function withCuts(f, xs) {
  const cuts = f.cuts.slice();
  for (const x of xs) if (!cuts.some((y) => near(x, y))) cuts.push(r4(x));
  return cuts.sort((a, b) => a - b);
}

export function planTakeComp(p, op = {}, ctx = null) {
  const { t, f } = folderOf(p, op, ctx);
  let li = Number.isInteger(op.lane) ? op.lane : -1;
  if (li < 0 && op.lane) {
    const f2 = findClip(p, t.id, op.lane, ctx);
    li = laneOfClip(f, f2.clip);
  }
  if (li < 0 && !op.lane && op.clip) li = laneOfClip(f, findClip(p, t.id, op.clip, ctx).clip);
  const lane = f.lanes[li];
  if (!lane)
    throw new Error(
      `no take ${op.lane} in this folder (it has ${f.lanes.length}: ${f.lanes.map((l) => laneName(t, l)).join(', ')})`,
    );
  let a = Math.max(f.start, beatArg(op.start ?? f.start, 'start')),
    b = Math.min(f.end, beatArg(op.end ?? f.end, 'end'));
  // (an end close to a cut or the folder's edge goes to it: no sliver of a clip is left)
  const snap = (x) => {
    const c = f.cuts.find((y) => Math.abs(y - x) < MIN_CLIP - EPS);
    return c != null ? c : r4(x);
  };
  a = snap(a);
  b = snap(b);
  if (b - a < MIN_CLIP - EPS)
    throw new Error(
      `pick at least ${MIN_CLIP} beats of ${laneName(t, lane)} inside the folder (beats ${r4(f.start)}–${r4(f.end)})`,
    );
  const cuts = withCuts(f, [a, b]);
  const plays = playsOf(f, cuts),
    was = plays.slice();
  let n = 0;
  for (let k = 0; k + 1 < cuts.length; k++) {
    if (cuts[k] < a - EPS || cuts[k + 1] > b + EPS) continue;
    if (lane.clips.some((c) => covers(c, cuts[k], cuts[k + 1]))) {
      if (plays[k] !== li) n++;
      plays[k] = li;
    }
  }
  const ops = n ? rebuildFolder(p, t, f, cuts, plays) : [];
  const whole = near(a, f.start) && near(b, f.end);
  // the comp's edges are where it was asked for (on the caller's grid): a note ringing over one, in the take that plays
  // up to it, is cut there (its tail stays in its own lane, muted), and the summary says so
  const cut = [];
  if (ops.length) {
    for (let k = 1; k + 1 < cuts.length; k++) {
      if (!near(cuts[k], a) && !near(cuts[k], b)) continue;
      if (plays[k - 1] < 0 || plays[k - 1] === plays[k]) continue;
      if (was[k - 1] === plays[k - 1] && was[k] !== was[k - 1]) continue; // (cut there already: nothing new is cut)
      const m = ringingOver(f.lanes[plays[k - 1]], cuts[k], t);
      if (m) cut.push({ at: cuts[k], n: m });
    }
  }
  const cutN = cut.reduce((x, y) => x + y.n, 0);
  return {
    ops,
    track: t.id,
    take: f.id,
    lane: li,
    name: laneName(t, lane),
    start: a,
    end: b,
    cut: cutN,
    summary: `${laneName(t, lane)} plays ${whole ? 'all of the folder' : barBeatSpan(p, a, b)} on ${t.name}${ops.length ? '' : ' already'}${cutN ? `, ${plural(cutN, 'note')} cut at ${cut.map((x) => barBeat(p, x.at)).join(' and ')}` : ''}.`,
  };
}
// How many of a lane's notes sound across song beat x (a note an earlier cut left there counts once: its part up to x
// and its tail from x share an id). Drum hits are all attack: none.
function ringingOver(lane, x, t) {
  if (!lane || isDrums(t)) return 0;
  let n = 0;
  for (const c of lane.clips) {
    if (c.kind !== 'notes' || c.start > x - EPS || clipEnd(c) < x - EPS) continue;
    for (const nt of c.notes) {
      const s = c.start + nt.t,
        e = Math.min(s + nt.d, clipEnd(c));
      if (s >= x - EPS) continue;
      if (e > x + EPS) n++;
      else if (
        near(e, x) &&
        near(clipEnd(c), x) &&
        nt.id != null &&
        lane.clips.some(
          (d) =>
            near(d.start, x) && d.kind === 'notes' && d.notes.some((y) => y.t < EPS && y.id === nt.id && y.p === nt.p),
        )
      )
        n++;
    }
  }
  return n;
}

export function planTakeLaneDelete(p, op = {}, ctx = null) {
  const { t, f, clip } = folderOf(p, op, ctx);
  const li = laneOfClip(f, clip);
  const cuts = f.cuts.slice(),
    plays = playsOf(f, cuts);
  let now = null;
  for (let k = 0; k < plays.length; k++) {
    if (plays[k] !== li) continue;
    // the newest take left there plays
    let j = f.lanes.length - 1;
    while (j >= 0 && (j === li || !f.lanes[j].clips.some((c) => covers(c, cuts[k], cuts[k + 1])))) j--;
    plays[k] = j;
    if (j >= 0 && now == null) now = j;
  }
  for (let k = 0; k < plays.length; k++) if (plays[k] > li) plays[k]--; // (indexes once the lane is gone)
  const g = { ...f, lanes: f.lanes.filter((_, i) => i !== li) };
  const ops = f.lanes[li].clips
    .map((c) => ({ type: 'clip.remove', track: t.id, clip: c.id }))
    .concat(rebuildFolder(p, t, g, cuts, plays));
  const nowName = now != null ? laneName(t, f.lanes[now]) : null;
  return {
    ops,
    track: t.id,
    take: f.id,
    name: laneName(t, f.lanes[li]),
    plays: nowName,
    summary: `Deleted ${laneName(t, f.lanes[li])}${nowName ? `; ${nowName} plays` : ''}.`,
  };
}

export function planTakesFlatten(p, op = {}, ctx = null) {
  const { t, f, clip } = folderOf(p, op, ctx);
  const playing = f.clips.filter((c) => !c.mute);
  // nothing plays (every take muted): the one asked for stays, playing
  const stay = (playing.length ? playing : [clip || f.clips[f.clips.length - 1]])
    .slice()
    .sort((a, b) => a.start - b.start);
  const ops = f.clips.filter((c) => !stay.includes(c)).map((c) => ({ type: 'clip.remove', track: t.id, clip: c.id }));
  // what plays merges into one clip, as Ableton's Flatten and Logic's Flatten and Merge do: pieces end to end are one
  // run (audio only while it carries on in one recording: two recordings side by side stay two clips); each run keeps
  // its first piece (its id), grown over the run, with every note where it played
  const spb = 60 / p.tempo,
    drums = isDrums(t),
    runs = [];
  for (const c of stay) {
    const r = runs[runs.length - 1],
      last = r && r[r.length - 1];
    if (last && near(clipEnd(last), c.start) && last.kind === c.kind && (c.kind === 'notes' || joins(last, c, spb)))
      r.push(c);
    else runs.push([c]);
  }
  for (const run of runs) {
    const head = run[0];
    const patch = { take: null, ...(head.mute ? { mute: false } : {}) };
    if (run.length > 1) {
      patch.length = r4(clipEnd(run[run.length - 1]) - head.start);
      // (a comp of several takes is no one take: it goes by its track's name, as a new clip does)
      if (new Set(run.map((c) => c.name || '')).size > 1) patch.name = null;
      for (const c of run.slice(1)) ops.push({ type: 'clip.remove', track: t.id, clip: c.id });
    }
    ops.push({ type: 'clip.set', track: t.id, clip: head.id, patch });
    if (run.length > 1 && head.kind === 'notes') {
      const notes = [];
      run.forEach((c, j) => {
        const lastC = j === run.length - 1;
        for (const n of c.notes) {
          if (n.t >= c.length - EPS) continue; // (silent past its piece's end, so not in the merge either)
          const at = r4(c.start + n.t - head.start),
            d = r4(lastC ? n.d : Math.min(n.d, c.length - n.t));
          // a note a cut split (its tail starts the next piece, same id and pitch) is one note again
          const prev =
            !drums &&
            n.t < EPS &&
            n.id != null &&
            notes.find((y) => y.id === n.id && y.p === n.p && y.v === n.v && near(y.t + y.d, at));
          if (prev) {
            prev.d = r4(prev.d + d);
            continue;
          }
          const x = { ...n, t: at, d };
          // (who played it stays with the note: a piece by someone else signs its notes)
          if (!x.by && c.by && c.by !== head.by) x.by = c.by;
          notes.push(x);
        }
      });
      // (ids are per clip: one seen twice goes, and the clip gives that note a new one)
      const seen = new Set();
      for (const x of notes) {
        if (x.id != null && seen.has(x.id)) delete x.id;
        else if (x.id != null) seen.add(x.id);
      }
      ops.push(rewrite(t.id, head.id, notes));
    }
  }
  const names = [...new Set(stay.map((c) => c.name || t.name))];
  const gone = f.lanes.filter((l) => !l.clips.some((c) => stay.includes(c))).length;
  const goneSay = gone ? `${plural(gone, 'muted take')} gone` : 'nothing else muted to keep';
  const summary =
    names.length < 2
      ? `Flattened: ${names[0]} stays, ${goneSay}.`
      : runs.length === 1
        ? `Flattened the comp into one clip: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} as they played; what didn't play is gone.`
        : `Flattened the comp into ${plural(runs.length, 'clip')} (audio from different recordings, or a gap, stays apart): ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} as they played; what didn't play is gone.`;
  return { ops, track: t.id, clips: runs.map((r) => r[0].id), names, summary };
}

// every take in the folder cut at `at` (an end of a piece near it: there); the left halves keep the folder, the right
// halves are a folder of their own
function planFolderSplit(p, t, c, at, op) {
  const f = takeFolders(t).find((x) => x.id === c.take);
  const cut = f.cuts.find((y) => Math.abs(y - at) < MIN_CLIP - EPS && !near(y, f.start) && !near(y, f.end));
  if (cut != null) at = cut;
  if (!(at >= f.start + MIN_CLIP - EPS && at <= f.end - MIN_CLIP + EPS)) {
    throw new Error(
      `beat ${at} isn't inside the take folder of ${c.id} far enough to split it (it covers beats ${r4(f.start)}–${r4(f.end)}; split at least ${MIN_CLIP} beats from either end)`,
    );
  }
  const across = f.clips.filter((x) => x.start < at - EPS && clipEnd(x) > at + EPS);
  roomFor(p, `Splitting ${c.name || t.name}`, { clips: across.length });
  const mint = idMinter(p),
    side = newId('tk');
  const ops = [];
  let mine = null,
    cutNotes = 0;
  for (const x of f.clips) {
    if (across.includes(x)) {
      const sp = splitOps(p, t, x, at, { id: mint('c'), take: side, ref: x === c ? op.ref || null : null });
      ops.push(...sp.ops);
      if (x === c) {
        mine = sp;
        cutNotes =
          x.kind === 'notes'
            ? x.notes.filter((n) => n.t < at - x.start - EPS && n.t + n.d > at - x.start + EPS).length
            : 0;
      }
    } else if (x.start >= at - EPS) ops.push({ type: 'clip.set', track: t.id, clip: x.id, patch: { take: side } });
  }
  const name = c.name || t.name,
    n = f.lanes.length;
  const right = mine ? mine.id : null;
  const lhs = mine && c.kind === 'notes' ? mine.left.notes.length : null,
    rhs = mine && c.kind === 'notes' ? mine.right.notes.length : null;
  return {
    ops,
    clip: right,
    track: t.id,
    take: f.id,
    side,
    left: lhs,
    right: rhs,
    cut: cutNotes,
    takes: n,
    summary: `Split ${name} at ${whereLabel(p, at)}${n > 1 ? ` with the ${plural(n - 1, 'take')} under it` : ''}${lhs != null ? `: ${plural(lhs, 'note')} before, ${plural(rhs, 'note')} after${cutNotes ? `, ${plural(cutNotes, 'note')} cut in two` : ''}` : ''}${n > 1 ? '; both halves keep their takes' : ''}.`,
  };
}

// The notes heard on a track's playing notes clips in song beats [a, b): [{ p, t (song beat), d, v, by }], a pitched
// note ringing in from before a keeping the part from a on (a drum hit is all attack)
function heardIn(t, a, b, drums) {
  const out = [];
  for (const c of t?.clips || []) {
    if (c.kind !== 'notes' || c.mute || clipEnd(c) <= a + EPS || c.start >= b - EPS) continue;
    for (const n of c.notes) {
      const s = c.start + n.t,
        e = Math.min(s + n.d, clipEnd(c), b);
      if (s >= clipEnd(c) - EPS) continue;
      const x = { p: n.p, v: n.v, ...(n.by ? { by: n.by } : {}) };
      if (s >= a - EPS && s < b - EPS) {
        if (e - s >= MIN_NOTE - EPS) out.push({ ...x, t: s, d: e - s });
      } else if (!drums && s < a - EPS && e > a + MIN_NOTE) out.push({ ...x, t: a, d: e - a });
    }
  }
  return out.sort((x, y) => x.t - y.t || x.p - y.p);
}
// song-beat notes -> a clip's notes from `from`, cut at `to`, only those starting in [lo, hi)
const relNotes = (ns, from, to, lo = -Infinity, hi = Infinity) =>
  ns
    .filter((n) => n.t >= lo - EPS && n.t < hi - EPS && n.t < to - EPS && n.t >= from - EPS)
    .map((n) => {
      const x = { p: n.p, t: r4(n.t - from), d: r4(Math.max(MIN_NOTE, Math.min(n.d, to - n.t))), v: n.v };
      if (n.by) x.by = n.by;
      return x;
    });

// Reshape one clip into pieces: [{ start, end, patch?: { mute?, take? }, notes? (clip-relative, else its own notes
// there) }]. The first piece keeps the clip's id; the others are new clips (ids from mint). No pieces: it goes.
function reshape(p, t, c, pieces, mint) {
  const ops = [],
    ids = [];
  if (!pieces.length) return { ops: [{ type: 'clip.remove', track: t.id, clip: c.id }], ids };
  const drums = isDrums(t),
    cs = c.start,
    ce = clipEnd(c),
    spb = 60 / p.tempo;
  pieces.forEach((pc, i) => {
    const notes =
      c.kind !== 'notes'
        ? null
        : pc.notes ||
          (pc.start > cs + EPS
            ? sliceNotes(c.notes, pc.start - cs, pc.end - cs, { trim: pc.end < ce - EPS, tails: true, drums })
            : sliceNotes(c.notes, 0, pc.end - cs, { trim: pc.end < ce - EPS }));
    const offset = c.kind === 'audio' ? r4((+c.offset || 0) + (pc.start - cs) * spb) : null;
    if (i === 0) {
      const patch = {};
      if (!near(pc.start, cs)) patch.start = r4(pc.start);
      if (!near(pc.end - pc.start, c.length)) patch.length = r4(pc.end - pc.start);
      if (offset != null && Math.abs(offset - (+c.offset || 0)) > EPS) patch.offset = offset;
      for (const [k, v] of Object.entries(pc.patch || {}))
        if ((c[k] ?? null) !== v && !(k === 'mute' && !!c.mute === v)) patch[k] = v;
      if (Object.keys(patch).length) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch });
      if (notes && !sameNotes(notes, c.notes)) ops.push(rewrite(t.id, c.id, notes));
      ids.push(c.id);
      return;
    }
    const id = mint('c');
    const x = { id, kind: c.kind, start: r4(pc.start), length: r4(pc.end - pc.start), by: c.by };
    if (c.name) x.name = c.name;
    if (c.color) x.color = c.color;
    tabOf(c, x);
    if (c.kind === 'audio') Object.assign(x, { asset: c.asset, offset, gain: +c.gain || 0 });
    else x.notes = notes;
    if (pc.patch && pc.patch.name) x.name = pc.patch.name;
    const mute = pc.patch && 'mute' in pc.patch ? pc.patch.mute : !!c.mute;
    if (mute) x.mute = true;
    const take = pc.patch && 'take' in pc.patch ? pc.patch.take : c.take;
    if (isTakeId(take)) x.take = take;
    ops.push({ type: 'clip.add', track: t.id, clip: x });
    ids.push(id);
  });
  return { ops, ids };
}
const hasNotesIn = (c, a, b) =>
  c.kind !== 'notes' || c.notes.some((n) => c.start + n.t >= a - EPS && c.start + n.t < b - EPS);

export function planTakeFolder(p, spec) {
  const kind = spec.kind === 'audio' ? 'audio' : 'notes';
  const A = r4(spec.start),
    B = r4(spec.end);
  const t = p.tracks.find((x) => x.id === spec.track) || null;
  const tid = t ? t.id : spec.track;
  const drums = !!spec.drums || (t ? isDrums(t) : false);
  const mint = idMinter(p);
  const ops = [];
  const clips = t ? t.clips.filter((c) => c.kind === kind) : [];
  const over = clips.filter((c) => overlapOf(c, A, B) >= MIN_CLIP - EPS);
  // a folder over exactly these beats takes the passes
  const folders = t ? takeFolders(t) : [];
  // (a comped folder is pieces over the range: its span is the range)
  const same =
    folders.find(
      (f) =>
        f.clips.some((c) => over.includes(c)) &&
        f.clips.every((c) => c.kind === kind) &&
        near(f.start, A) &&
        near(f.end, B),
    ) || null;
  const group = same ? same.id : spec.take;
  const heard = kind === 'notes' ? heardIn(t, A, B, drums) : [];
  // what played inside: one clip of it, muted, first in the folder (the clip itself, when one clip covered it all)
  const playing = over.filter((c) => !c.mute && (!same || c.take !== same.id));
  const solo =
    playing.length === 1 &&
    (kind === 'audio' || (near(Math.max(playing[0].start, A), A) && near(Math.min(clipEnd(playing[0]), B), B)));
  const sideId = new Map(); // a folder cut at an edge: its pieces past B are a folder of their own
  let entries = same ? same.lanes.length : 0,
    top = same ? Math.max(0, ...same.clips.map(takeNumber)) : 0;
  // What played here is never named "Take N" (that's a pass's name, and it may be another folder's take): it keeps
  // its own name, or is "What played" when a take of another folder was playing in it. Another folder's takes joining
  // this one (its original too: only what played here is a folder's original) are numbered after it, so "Take N" is
  // the Nth entry and no two share a name.
  const heardName = (c) => (takeNumber(c) ? 'What played' : c.name);
  let alt = same ? Math.max(entries, top) : kind === 'audio' ? playing.length : playing.length ? 1 : 0; // (audio: one entry each)
  const alts = [];
  for (const c of over) {
    const inG = isTakeId(c.take) ? c.take : null;
    if (same && inG === same.id) {
      if (!c.mute) ops.push({ type: 'clip.set', track: tid, clip: c.id, patch: { mute: true } });
      continue;
    }
    if (!inG && c.mute) continue; // a clip you muted yourself: left as it is
    const cs = c.start,
      ce = clipEnd(c);
    const cutL = A - cs >= MIN_CLIP - EPS,
      cutR = ce - B >= MIN_CLIP - EPS;
    const ms = cutL ? A : cs,
      me = cutR ? B : ce;
    const pieces = [];
    const keepOuter = (a, b) => !inG || hasNotesIn(c, a, b); // (an empty leftover of a folder goes)
    if (cutL && keepOuter(cs, A)) pieces.push({ start: cs, end: A });
    if (!c.mute) {
      // what was heard: the clip itself goes in (muted) when it covers the range alone; else it is in the merged one
      const nm = heardName(c) !== c.name ? { name: heardName(c) } : {};
      if (solo && kind === 'notes') pieces.push({ start: ms, end: me, patch: { mute: true, take: group, ...nm } });
      else if (kind === 'audio') pieces.push({ start: ms, end: me, patch: { mute: true, take: group, ...nm } });
      if (solo || kind === 'audio') entries++;
    } else if (hasNotesIn(c, ms, me)) {
      // another take of an overlapping folder: its part here joins this folder, filled out to the range
      const own =
        kind === 'notes'
          ? sliceNotes(c.notes, ms - cs, me - cs, { trim: me < ce - EPS, tails: ms > cs + EPS, drums }).map((n) => ({
              ...n,
              t: n.t + ms,
            }))
          : null;
      if (kind === 'notes') {
        const notes = [...relNotes(heard, A, B, A, ms), ...relNotes(own, A, B), ...relNotes(heard, A, B, me, B)];
        alts.push({ start: A, end: B, patch: { mute: true, take: group, name: `Take ${++alt}` }, notes });
      } else alts.push({ start: ms, end: me, patch: { mute: true, take: group, name: `Take ${++alt}` } });
      pieces.push(alts[alts.length - 1]);
      entries++;
    }
    if (cutR && keepOuter(B, ce)) {
      if (inG && !sideId.has(inG)) sideId.set(inG, newId('tk'));
      // (a note ringing across B began in what this folder replaces: it isn't struck again at B)
      pieces.push({
        start: B,
        end: ce,
        patch: inG ? { take: sideId.get(inG) } : {},
        ...(kind === 'notes' ? { notes: sliceNotes(c.notes, B - cs, ce - cs) } : {}),
      });
    }
    pieces.sort((x, y) => x.start - y.start);
    ops.push(...reshape(p, t, c, pieces, mint).ops);
  }
  if (playing.length && !solo && kind === 'notes') {
    // several clips (or a part of one) played here: what was heard, as one clip
    const main = playing.slice().sort((x, y) => overlapOf(y, A, B) - overlapOf(x, A, B))[0];
    const x = {
      id: mint('c'),
      kind: 'notes',
      start: A,
      length: r4(B - A),
      name: (!playing.some((c) => takeNumber(c)) && main.name) || 'What played',
      mute: true,
      take: group,
      by: main.by,
      notes: relNotes(heard, A, B),
    };
    if (main.color) x.color = main.color;
    ops.push({ type: 'clip.add', track: tid, clip: x });
    entries++;
  }
  // the passes: in folder order the others first, the one that plays last
  const passes = spec.passes || [];
  const ai =
    Number.isInteger(spec.active) && spec.active >= 0 && spec.active < passes.length ? spec.active : passes.length - 1;
  const order = [...passes.keys()].filter((i) => i !== ai).concat(ai);
  const base = Math.max(entries, top, alt);
  const refs = new Array(passes.length),
    names = new Array(passes.length);
  let active = null,
    refN = 0;
  order.forEach((i, k) => {
    const ps = passes[i],
      num = base + k + 1,
      last = i === ai;
    const ref = (spec.refPrefix || 'tf') + ++refN;
    const clip = { kind, name: `Take ${num}`, take: group, ...(last ? {} : { mute: true }) };
    let own = 0;
    if (kind === 'audio')
      Object.assign(clip, {
        start: r4(ps.start),
        length: r4(Math.max(MIN_CLIP, ps.end - ps.start)),
        asset: ps.audio.asset,
        offset: r4(ps.audio.offset),
        gain: ps.audio.gain || 0,
      });
    else {
      const mine = relNotes(ps.notes, A, B);
      own = mine.length;
      // (narrower than the range: what played there before fills it out)
      clip.notes = [
        ...relNotes(heard, A, B, A, ps.start),
        ...mine.filter((n) => n.t + A >= ps.start - EPS),
        ...relNotes(heard, A, B, ps.end, B),
      ].sort((x, y) => x.t - y.t || x.p - y.p);
      Object.assign(clip, { start: A, length: r4(B - A) });
    }
    ops.push({ type: 'clip.add', track: tid, ref, clip });
    refs[i] = ref;
    names[i] = clip.name;
    if (last) active = { ref, name: clip.name, num, notes: own };
  });
  const total = base + passes.length;
  return { ops, group, refs, names, active, total, under: total - 1 };
}

// The ops that cut a clip's window to [start, end): notes stay where they sound in the song (the ones before the new
// start go); an audio clip's offset moves with its start.
function windowOps(p, t, c, start, end) {
  const delta = start - c.start;
  const ops = [{ type: 'clip.set', track: t.id, clip: c.id, patch: { start: r4(start), length: r4(end - start) } }];
  if (Math.abs(delta) < 1e-9) return ops;
  if (c.kind === 'notes') {
    const keep = [],
      gone = [];
    for (const n of c.notes) (n.t - delta < -1e-6 ? gone : keep).push(n);
    if (gone.length) ops.push({ type: 'notes.remove', track: t.id, clip: c.id, ids: gone.map((n) => n.id) });
    if (keep.length)
      ops.push({
        type: 'notes.set',
        track: t.id,
        clip: c.id,
        notes: keep.map((n) => ({ id: n.id, t: r4(Math.max(0, n.t - delta)) })),
      });
  } else ops[0].patch.offset = Math.max(0, r4((c.offset || 0) + delta * (60 / p.tempo)));
  return ops;
}

export function planClipTrim(p, op = {}, ctx = null) {
  const { track: t, clip: c } = findClip(p, op.track, op.clip, ctx);
  let start = beatArg(op.start ?? c.start, 'start');
  const end = beatArg(op.end ?? clipEnd(c), 'end');
  // an audio clip's window opens no earlier than its file starts: the start stops there, and the recording stays on
  // the beats it was played on (an offset can't go below 0, so a start past it would slide the whole file earlier)
  if (c.kind === 'audio') start = Math.max(start, r4(c.start - (+c.offset || 0) / (60 / p.tempo)));
  if (!(start >= 0) || end - start < MIN_CLIP - EPS)
    throw new Error(
      `a clip must run at least ${MIN_CLIP} beats from a start >= 0${c.kind === 'audio' && start > 0 ? ` (an audio clip starts no earlier than its recording, beat ${r4(start)} here)` : ''}`,
    );
  const ops =
    Math.abs(start - c.start) < 1e-9 && Math.abs(end - clipEnd(c)) < 1e-9 ? [] : windowOps(p, t, c, start, end);
  const uncovered = [],
    covered = [];
  if (isTakeId(c.take) && !c.mute) {
    if (start > c.start + EPS) uncovered.push([c.start, Math.min(start, clipEnd(c))]);
    if (end < clipEnd(c) - EPS) uncovered.push([Math.max(end, c.start), clipEnd(c)]);
    if (start < c.start - EPS) covered.push([start, Math.min(c.start, end)]);
    if (end > clipEnd(c) + EPS) covered.push([Math.max(clipEnd(c), start), end]);
  }
  const mint = idMinter(p);
  let refolded = 0;
  if (covered.length) {
    // The playing take grows over beats again (back over what a shorter drag gave back, say): what plays there, and
    // the takes kept there, go back into its folder, muted, as a recording over them would put them; a clip you
    // muted yourself stays as it is. The parts of them outside those beats stay where they were.
    for (const x of t.clips) {
      if (x === c || x.kind !== c.kind || x.take === c.take || (!isTakeId(x.take) && x.mute)) continue;
      const xs = x.start,
        xe = clipEnd(x);
      const ins = [];
      for (const [a, b] of covered) {
        if (overlapOf(x, a, b) < MIN_CLIP - EPS) continue;
        // (a sliver of it left outside goes in with the rest)
        ins.push([a - xs >= MIN_CLIP - EPS ? a : xs, xe - b >= MIN_CLIP - EPS ? b : xe]);
      }
      if (!ins.length) continue;
      const pieces = [];
      let at = xs;
      for (const [a, b] of ins) {
        if (a > at + EPS)
          pieces.push({
            start: at,
            end: a,
            ...(at > xs + EPS && x.kind === 'notes'
              ? { notes: sliceNotes(x.notes, at - xs, a - xs, { trim: a < xe - EPS }) }
              : {}),
          });
        pieces.push({ start: a, end: b, patch: { mute: true, take: c.take } });
        at = b;
      }
      // (a note ringing out past the take began in what it replaces: it isn't struck again after it)
      if (xe > at + EPS)
        pieces.push({
          start: at,
          end: xe,
          ...(x.kind === 'notes' ? { notes: sliceNotes(x.notes, at - xs, xe - xs) } : {}),
        });
      ops.push(...reshape(p, t, x, pieces, mint).ops);
      refolded++;
    }
  }
  if (uncovered.length) {
    // (the folder's takes under this clip: a comped folder's pieces elsewhere stay as they are)
    const others = t.clips.filter(
      (x) => x !== c && x.take === c.take && overlapOf(x, c.start, clipEnd(c)) >= MIN_CLIP - EPS,
    );
    const sides = uncovered.map(([a, b]) => ({
      a,
      b,
      id: newId('tk'),
      alts: others.filter((x) => takeNumber(x) && overlapOf(x, a, b) >= MIN_CLIP - EPS && hasNotesIn(x, a, b)).length,
    }));
    for (const x of others) {
      const xs = x.start,
        xe = clipEnd(x),
        orig = !takeNumber(x);
      const pieces = [];
      // inside what the take still covers: it stays in the folder as it was
      const ia = Math.max(xs, start),
        ib = Math.min(xe, end);
      for (const s of sides) {
        const a = Math.max(xs, s.a),
          b = Math.min(xe, s.b);
        if (b - a < MIN_CLIP - EPS) continue;
        // what played before plays here again (in a folder of its own when other takes are kept here too); another
        // take's part here stays muted with it, or goes when there is nothing in it
        if (orig) pieces.push({ start: a, end: b, patch: { mute: false, take: s.alts ? s.id : null } });
        else if (hasNotesIn(x, a, b)) pieces.push({ start: a, end: b, patch: { mute: true, take: s.id } });
      }
      if (ib - ia >= MIN_CLIP - EPS) pieces.push({ start: ia, end: ib });
      pieces.sort((u, v) => u.start - v.start);
      ops.push(...reshape(p, t, x, pieces, mint).ops);
    }
  }
  const name = c.name || t.name;
  return {
    ops,
    track: t.id,
    clip: c.id,
    uncovered,
    covered: refolded ? covered : [],
    summary: `Trimmed ${name} to ${spanLabel(p, end - start)} from ${whereLabel(p, start)}${uncovered.length ? `; what played under it plays again ${uncovered.map(([a, b]) => `from ${whereLabel(p, a)} for ${spanLabel(p, b - a)}`).join(' and ')}` : ''}${refolded ? '; what played under it there is back in its folder, muted' : ''}.`,
  };
}

/* ------------------------------------------------------------------------------------------------ dropping clips */
// A clip dropped on a track (the arranger's drag: a move or an Alt-copy) takes the beats it covers there, as a clip
// dropped on another does in Live: whatever lies under it on that track is cut away under it and kept on either side,
// or goes when it is covered whole. Muted clips are cut too, so nothing waits under a dropped clip to play over it
// later. A take folder under it is cut across every one of its takes, as Split cuts one: the part before keeps the
// folder and the part after is a folder of its own, so each folder is still one range with one take playing in each
// stretch of it; a part left with a single clip is an ordinary clip. Notes keep their sounding part, as a split's do,
// except that a note ringing into the dropped clip's beats isn't struck again after them (the dropped clip replaced
// its middle). Planned from the song before the drop; dispatched with the move, it is the same undo step.
//
//   planDropTrim(p, drops, { keep }) drops: [{ track, start, end }] where the dropped clips land; keep: the ids of the
//   clips being dropped (a move's own clips, left alone) -> { ops, cut, removed, folders, sides, tracks, summary }
//   (cut: clips cut short or in two; removed: clips covered whole; folders: take folders cut; sides: { take: [new
//   take ids] } for the parts after; summary: '' when nothing was under the drop)
const minusSpans = (xs, xe, rs) => {
  const out = [];
  let at = xs;
  for (const [a, b] of rs) {
    if (b <= at + EPS) continue;
    if (a >= xe - EPS) break;
    if (a > at + EPS) out.push([at, Math.min(a, xe)]);
    at = Math.max(at, b);
    if (at >= xe - EPS) break;
  }
  if (xe > at + EPS) out.push([at, xe]);
  return out.filter(([a, b]) => b - a >= MIN_CLIP - EPS);
};
export function planDropTrim(p, drops = [], { keep = [] } = {}) {
  const keepIds = new Set(keep);
  const spans = new Map(); // track -> covered stretches, merged
  for (const d of drops || []) {
    const t = p.tracks.find((x) => x.id === d?.track);
    const a = r4(Math.max(0, Number(d?.start))),
      b = r4(Number(d?.end));
    if (!t || !fin(a) || !fin(b) || b - a <= EPS) continue;
    if (!spans.has(t)) spans.set(t, []);
    spans.get(t).push([a, b]);
  }
  const mint = idMinter(p);
  const ops = [],
    sides = {},
    tracks = [],
    cutNames = [],
    goneNames = [];
  let cut = 0,
    removed = 0,
    folders = 0;
  const tally = (t, x, n) => {
    const nm = x.name || t.name;
    if (n) {
      cut++;
      if (!cutNames.includes(nm)) cutNames.push(nm);
    } else {
      removed++;
      if (!goneNames.includes(nm)) goneNames.push(nm);
    }
  };
  for (const [t, raw] of spans) {
    const rs = raw
      .sort((x, y) => x[0] - y[0])
      .reduce((m, r) => {
        const l = m[m.length - 1];
        if (l && r[0] <= l[1] + EPS) l[1] = Math.max(l[1], r[1]);
        else m.push(r.slice());
        return m;
      }, []);
    const hit = (x) => !keepIds.has(x.id) && rs.some(([a, b]) => overlapOf(x, a, b) > EPS);
    const under = t.clips.filter(hit);
    if (!under.length) continue;
    tracks.push(t.id);
    // each piece a clip keeps: [a, b) with its notes (the first from the clip's start cut at the drop; a later one
    // from the drop's end on, not struck again there)
    const piecesOf = (x) =>
      minusSpans(x.start, clipEnd(x), rs).map(([a, b]) => ({
        start: a,
        end: b,
        ...(x.kind === 'notes'
          ? { notes: sliceNotes(x.notes, a - x.start, b - x.start, { trim: b < clipEnd(x) - EPS }) }
          : {}),
      }));
    // take folders under the drop: every clip of the folder (under it or not) goes to the part of the folder it is in
    const hitFolders = new Set(under.filter((x) => isTakeId(x.take)).map((x) => x.take));
    const done = new Set();
    for (const f of takeFolders(t).filter((x) => hitFolders.has(x.id))) {
      folders++;
      const segs = minusSpans(f.start, f.end, rs);
      const ids = segs.map((_, k) => (k ? newId('tk') : f.id));
      if (ids.length > 1) sides[f.id] = ids.slice(1);
      const segOf = (a) => {
        let k = 0;
        for (let i = 0; i < segs.length; i++) if (segs[i][0] <= a + EPS) k = i;
        return k;
      };
      const plan = f.clips.map((x) => ({
        x,
        pieces: (hit(x) ? piecesOf(x) : [{ start: x.start, end: clipEnd(x), whole: true }]).map((pc) => ({
          ...pc,
          seg: segOf(pc.start),
        })),
      }));
      const count = segs.map((_, k) => plan.reduce((n, q) => n + q.pieces.filter((pc) => pc.seg === k).length, 0));
      for (const { x, pieces } of plan) {
        done.add(x.id);
        const takeAt = (k) => (count[k] > 1 ? ids[k] : null);
        if (pieces.length === 1 && pieces[0].whole) {
          const want = takeAt(pieces[0].seg);
          if ((x.take ?? null) !== want) ops.push({ type: 'clip.set', track: t.id, clip: x.id, patch: { take: want } });
          continue;
        }
        tally(t, x, pieces.length);
        ops.push(
          ...reshape(
            p,
            t,
            x,
            pieces.map((pc) => ({
              start: pc.start,
              end: pc.end,
              patch: { take: takeAt(pc.seg) },
              ...(pc.notes ? { notes: pc.notes } : {}),
            })),
            mint,
          ).ops,
        );
      }
    }
    for (const x of under) {
      if (done.has(x.id)) continue;
      const pieces = piecesOf(x);
      tally(t, x, pieces.length);
      ops.push(...reshape(p, t, x, pieces, mint).ops);
    }
  }
  // (removes first, so an add never meets a clip of the same id; then sets, then adds)
  const rank = (o) => (o.type === 'clip.remove' ? 0 : o.type === 'clip.add' ? 2 : 1);
  const sorted = ops
    .map((o, i) => [o, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map((x) => x[0]);
  const names = tracks.map((id) => p.tracks.find((x) => x.id === id)?.name).filter(Boolean);
  const few = (xs) => (xs.length > 2 ? `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more` : xs.join(' and '));
  const what = [
    cutNames.length ? `${few(cutNames)} cut where it landed` : '',
    goneNames.length ? `${few(goneNames)} gone, covered whole` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return {
    ops: sorted,
    cut,
    removed,
    folders,
    sides,
    tracks,
    summary: what
      ? `Under it on ${names.join(' and ')}: ${what}${folders ? ` (${folders === 1 ? 'a take folder, with all its takes' : `${folders} take folders, with all their takes`})` : ''}.`
      : '',
  };
}

// The ops of the same names (ops.js registers them): each plans from the song as it is when it's applied.
export const ARRANGEMENT_OPS = {
  'section.duplicate': planSectionDuplicate,
  'time.insert': planTimeInsert,
  'time.remove': planTimeRemove,
  'clip.repeat': planClipRepeat,
  'clip.split': planClipSplit,
};
