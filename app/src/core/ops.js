// Every change to a song is an op. applyOp(project, op, ctx) mutates the project and returns { inverse: [ops], created }.
// The store wraps these in transactions (atomic, attributed, undoable). docs/ARCHITECTURE.md has the catalog.
//
// Errors are thrown as plain Errors with messages written for whoever sent the op (often an agent): say what was
// wrong and what would be right.
//
// References: ops that create things accept `ref: 'name'`; later ops in the SAME transaction can name the new thing
// as '$name' (track: '$bass', clip: '$verse1'). ctx.refs holds them.

import {
  normTrack,
  normClip,
  normInsert,
  normKey,
  idNotes,
  sortNotes,
  newId,
  isValidReference,
  isTakeId,
  LIMITS,
  plainText,
  cleanName,
  isColor,
  NAME_MAX,
  TITLE_MAX,
} from './project.js';
import { parseNotes, parseGrid, normNote, validMeter, isPlace } from './music.js';
import { TUNING_IDS } from './fretboard.js';
import { ARRANGEMENT_OPS } from './arrangement.js';
import {
  MIXER,
  paramSpec,
  parsePoints,
  normPoints,
  pointsPrint,
  rt,
  mkPoint,
  pointBy,
  signPoints,
} from './automation.js';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

function resolve(ctx, id) {
  if (typeof id === 'string' && id.startsWith('$')) {
    const r = ctx.refs[id.slice(1)];
    if (!r) throw new Error(`unknown reference ${id} (refs are made by ref: "name" on an earlier op in the same call)`);
    return r;
  }
  return id;
}
function findTrack(p, ctx, id) {
  id = resolve(ctx, id);
  const t =
    p.tracks.find((x) => x.id === id) ||
    p.tracks.find((x) => String(x.name).toLowerCase() === String(id).toLowerCase());
  if (!t)
    throw new Error(`no track "${id}" (tracks: ${p.tracks.map((x) => `${x.id} "${x.name}"`).join(', ') || 'none'})`);
  return t;
}
function insertList(p, ctx, trackId) {
  if (trackId === 'master') return p.master.inserts;
  return findTrack(p, ctx, trackId).inserts;
}
function findClip(t, ctx, id) {
  id = resolve(ctx, id);
  const c = t.clips.find((x) => x.id === id);
  if (!c)
    throw new Error(
      `no clip "${id}" on track ${t.id} "${t.name}" (clips: ${t.clips.map((x) => x.id).join(', ') || 'none'})`,
    );
  return c;
}
function findInsert(list, ctx, id, where) {
  id = resolve(ctx, id);
  const fx = list.find((x) => x.id === id);
  if (!fx)
    throw new Error(
      `no insert "${id}" on ${where} (inserts: ${list.map((x) => `${x.id}=${x.device}`).join(', ') || 'none'})`,
    );
  return fx;
}
// An insert's key (a sidechain), checked: { track } naming another track of the song (by id, name or $ref), on a
// track's insert (not the master's), closing no loop (a track whose sound reaches, through keys, the track it keys).
// Returns the key with the track's id. fxId: the insert whose key is being replaced (its old key doesn't count).
function checkKey(p, ctx, tid, key, fxId, device) {
  if (typeof key !== 'object' || Array.isArray(key) || key.track == null)
    throw new Error(
      'key is { track: "<track id or name>" } (the track whose sound this insert hears beside its own), or null for none',
    );
  // (a device that doesn't listen to a key would carry one it never hears, and the mixer would say "keyed by")
  const def = device && ctx.getDevice ? ctx.getDevice(device) : null;
  if (def && def.key !== true)
    throw new Error(
      `${def.name || device} has no key input: only a device that hears another track takes a key (Dim Switch, core.ducker)`,
    );
  if (tid === 'master')
    throw new Error(
      "a master insert can't take a key: put the device on the track that should duck, keyed by the one it ducks under",
    );
  const src = findTrack(p, ctx, key.track);
  if (src.id === tid) throw new Error(`a track can't key itself: name another track than ${tid} "${src.name}"`);
  // the loop check: tid's sound reaches every track keyed by it, and on; a loop is tid reaching src
  const keyedBy = (id) =>
    p.tracks.filter((t) => t.inserts.some((x) => x.id !== fxId && x.key && x.key.track === id)).map((t) => t.id);
  const seen = new Set([tid]),
    todo = [tid];
  while (todo.length) {
    const id = todo.pop();
    for (const next of keyedBy(id)) {
      if (next === src.id)
        throw new Error(
          `that key would make a loop: ${tid}'s sound already keys ${src.id} "${src.name}" (through keys), so ${src.id} can't key ${tid}`,
        );
      if (!seen.has(next)) {
        seen.add(next);
        todo.push(next);
      }
    }
  }
  return { track: src.id };
}
function checkDevice(ctx, id, kind) {
  // (an undo, redo or revert puts back exactly what was there, loaded in this browser or not)
  if (!ctx.getDevice || ctx.restore) return;
  const d = ctx.getDevice(id) || (ctx.doc && ctx.doc.devices && ctx.doc.devices[id]) || null;
  if (!d) throw new Error(`no device "${id}" — list_devices shows what exists, or define one first`);
  if (kind && d.kind !== kind) throw new Error(`device "${id}" is an ${d.kind}, not an ${kind}`);
}
// Is an id taken anywhere in the song? (A scan that stops at the first match, with no set built: a plan that adds a
// thousand clips asks a thousand times.)
function idUsed(p, id) {
  for (const t of p.tracks) {
    if (t.id === id) return true;
    for (const c of t.clips) if (c.id === id) return true;
    for (const fx of t.inserts) if (fx.id === id) return true;
  }
  for (const fx of p.master.inserts) if (fx.id === id) return true;
  for (const sec of p.sections) if (sec.id === id) return true;
  return false;
}
// A clip holds up to LIMITS.clipNotes notes (undo and redo put back what was there).
function checkClipNotes(ctx, n, clip) {
  if (!ctx.restore && n > LIMITS.clipNotes)
    throw new Error(
      `clip ${clip} would hold ${n.toLocaleString('en-US')} notes; a clip holds up to ${LIMITS.clipNotes.toLocaleString('en-US')} (split the part across clips)`,
    );
}
// A name or a colour a rename or a recolour sets is checked like a title (project.set): a name is text, at most
// NAME_MAX characters once its control and bidi characters are out (they're dropped, core/project.js plainText); a
// colour is a palette token or hex, the kinds the studio draws (core/project.js isColor). New things (track.add,
// clip.add, section.add, device.define) are normalised instead, as a loaded song is: a long name is cut, an odd colour
// gets the default, so a planner's "Chorus 2", an importer's name or a device from a file never fails an op.
function checkName(v) {
  if (!(typeof v === 'string' && plainText(v).length <= NAME_MAX))
    throw new Error(`name must be text, ${NAME_MAX} characters at most`);
}
function checkColor(v) {
  if (!isColor(v))
    throw new Error(
      `color must be a palette colour like "var(--c-3)" or hex like "#4fa3e0" (got ${String(JSON.stringify(v)).slice(0, 60)})`,
    );
}
// A note's place on the neck (notes.set): s and f together, whole numbers (s the string, 0 the lowest; f the fret from
// the nut), or both null to take the place off. The pitch is still the note's: a place that doesn't match it is
// re-fingered wherever tab is drawn, so set p with them when the place moves the note.
function checkPlace(patch, n) {
  if (!('s' in patch) && !('f' in patch)) return;
  if (patch.s == null && patch.f == null) return;
  if (!isPlace(patch.s, patch.f))
    throw new Error(
      `note ${n.id}: s and f go together, as whole numbers: s the string (0 the lowest, 5 the high e on a guitar) and f the fret (0 open, up to 36); both null take the place off (got s ${JSON.stringify(patch.s)}, f ${JSON.stringify(patch.f)})`,
    );
}
// A clip's tuning (clip.set): one of core/fretboard.js's, or null for none (standard)
function checkTuning(v) {
  if (v !== null && !TUNING_IDS.includes(v))
    throw new Error(`tuning is one of ${TUNING_IDS.join(', ')} (or null: standard)`);
}
// Ops check everything before they change anything, so one that throws leaves the song as it was.
function checkParams(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v !== null && typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean')
      throw new Error(`param ${k} must be a number (got ${JSON.stringify(v)})`);
  }
}
// Merge params; a null value removes the key (back to the device's default). Returns the inverse patch.
function mergeParams(target, patch) {
  checkParams(patch);
  const inv = {};
  for (const [k, v] of Object.entries(patch || {})) {
    inv[k] = k in target ? target[k] : null;
    if (v === null) delete target[k];
    else target[k] = v;
  }
  return inv;
}
function toNotes(notes, grid) {
  if (grid) return parseGrid(grid);
  if (notes == null) return [];
  if (typeof notes === 'string') return parseNotes(notes);
  if (!Array.isArray(notes))
    throw new Error('notes must be an array of {p,t,d,v} or a text string like "C4@0:0.5 E4@0.5:0.5"');
  return notes.map(normNote);
}
const stamp = (obj, by) => {
  if (by) obj.by = by;
  return obj;
};
// Clips and sections stay in order of start, then id, so ties always come out the same way and an undo is exact.
const byStart = (a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Guarded inverses. An inverse that rewrites a clip's notes (notes.replace) or removes a clip or a track carries
// `_expect`, a print of what its op left there (every note, ids and authors included). If someone has changed it since
// (added, edited or deleted a note, or put a clip on the track), the inverse refuses instead of overwriting their
// work, so undo({ by }) fails and revertAuthor skips that change and says why. Redo rebuilds the print as it goes.
// (a note's print: its fields in a fixed order, any others after them sorted by name)
const NOTE_KEYS = new Set(['id', 'p', 't', 'd', 'v', 'by']);
const noteSig = (n) => {
  const x = [n.id, n.p, n.t, n.d, n.v, n.by];
  for (const k of Object.keys(n).sort()) if (!NOTE_KEYS.has(k)) x.push(k, n[k]);
  return JSON.stringify(x);
};
const cmpNotes = (a, b) => a.t - b.t || a.p - b.p || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function notesPrint(notes) {
  let ns = notes || [];
  for (let i = 1; i < ns.length; i++)
    if (cmpNotes(ns[i - 1], ns[i]) > 0) {
      ns = ns.slice().sort(cmpNotes);
      break;
    } // (clips keep them sorted)
  return '[' + ns.map(noteSig).join(',') + ']';
}
const clipPrint = (c) => (c.kind === 'notes' ? notesPrint(c.notes) : `audio:${c.asset}`);
const trackPrint = (t) => JSON.stringify(t.clips.map((c) => [c.id, clipPrint(c)]));
// Why a clip no longer matches its print (null when it does).
function clipChanged(c, print) {
  if (clipPrint(c) === print) return null;
  if (c.kind !== 'notes') return `clip ${c.id} was changed since`;
  let was = [];
  try {
    was = JSON.parse(print);
  } catch (e) {
    /* an unreadable print never matches */
  }
  if (!Array.isArray(was)) was = [];
  const before = new Set(was.map((a) => JSON.stringify(a)));
  const added = c.notes.find((n) => !before.has(noteSig(n)));
  if (added) return `clip ${c.id} was changed by ${added.by || 'someone'} since (note ${added.id})`;
  const after = new Set(c.notes.map(noteSig));
  const gone = was.find((a) => !after.has(JSON.stringify(a)));
  return `clip ${c.id} was changed since (note ${gone ? gone[0] : '?'} was deleted)`;
}
function expectClip(c, print) {
  const why = print == null ? null : clipChanged(c, print);
  if (why) throw new Error(`${why}, so it stays as it is (undo that change first)`);
}
function expectTrack(t, print) {
  if (print == null || trackPrint(t) === print) return;
  let was = [];
  try {
    was = JSON.parse(print);
  } catch (e) {
    /* never matches */
  }
  const old = new Map(Array.isArray(was) ? was : []);
  let why = null;
  for (const c of t.clips) {
    if (!old.has(c.id)) {
      why = `clip ${c.id} was put on track ${t.id} "${t.name}" by ${c.by || 'someone'} since`;
      break;
    }
    if ((why = clipChanged(c, old.get(c.id)))) break;
  }
  if (!why) {
    const ids = new Set(t.clips.map((c) => c.id));
    why = `clip ${[...old.keys()].find((id) => !ids.has(id))} on track ${t.id} "${t.name}" was deleted since`;
  }
  throw new Error(`${why}, so the track stays (undo that change first)`);
}
// A name is text (code lowercases names to find things by them), plain and at most NAME_MAX characters.
const sectionName = (v) => cleanName(v, 'Section');
// A note an undo names that isn't in its clip any more was either deleted (then there's nothing to take back) or moved
// into a new clip by a split or an insert (it keeps its id, pitch and author there). A moved one makes the undo refuse:
// reporting success while the note stays would drop the step. -> the clip it's in now, or null
function movedTo(t, c, id, { p = null, by = null } = {}) {
  for (const o of t.clips) {
    if (o === c || o.kind !== 'notes') continue;
    if (o.notes.some((n) => n.id === id && (p == null || n.p === p) && (!by || n.by === by))) return o;
  }
  return null;
}
const movedNote = (id, c, o) =>
  new Error(
    `note ${id} isn't in clip ${c.id} any more (a split or an insert since moved it to clip ${o.id}), so it stays where it is (undo that change first)`,
  );
// _p (on inverses): each note's pitch, so a moved note can be told from a deleted one
const removeNotes = (track, clip, ids, by, notes = null) => {
  const op = { type: 'notes.remove', track, clip, ids };
  if (by) op.by = by;
  if (notes) op._p = Object.fromEntries(notes.map((n) => [n.id, n.p]));
  return op;
};

/* Automation lanes (core/automation.js). A lane is named { track, insert?, param }: insert is an insert id or
   'instrument', absent for the mixer (param 'gain' or 'pan'); track 'master' takes 'gain' or an insert on the master.
   auto.write replaces the points in [from, to] (default: the span of the points given); auto.clear removes the points
   in [from, to] (with neither, the lane); auto.set { off } holds the lane or gives it back. Their inverses are each
   other: a write's undo writes the old points back over the same range, carrying a print of what the write left there
   (_expect), so it refuses when someone has written into that range since. Internal fields on inverses and planned
   ops: _by (the author to sign the lane with; false keeps it), _byIf (only if the lane is still signed so), _off (the
   held flag of a lane being brought back), _expect, _fit (points a planner or an editor carries over from the lane:
   clamped to the param's range like the rest, never refused, so one bad value from an old file can't block an edit). */
function laneTarget(p, op, ctx) {
  const param = op.param;
  if (typeof param !== 'string' || !param)
    throw new Error(
      'which param? auto ops name a lane as { track, insert?, param }: param "gain" or "pan" for the mixer, or a device param key with insert: "<insert id>" or "instrument"',
    );
  const tid = op.track === 'master' ? 'master' : findTrack(p, ctx, op.track).id;
  const t = tid === 'master' ? null : p.tracks.find((x) => x.id === tid);
  const where = t ? `track ${t.id} "${t.name}"` : 'the master';
  let host,
    insert = null,
    device = null,
    spec = null,
    label;
  if (op.insert == null || op.insert === '') {
    const ok = tid === 'master' ? ['gain'] : ['gain', 'pan'];
    if (!ok.includes(param))
      throw new Error(
        `the mixer lanes on ${where} are ${ok.join(' and ')}; for a device's knob name its insert ("<insert id>" or "instrument") and the param key`,
      );
    host = t || p.master;
    spec = MIXER[param];
    label = `${param} on ${where}`;
  } else if (resolve(ctx, op.insert) === 'instrument') {
    if (!t) throw new Error("the master has no instrument; its lanes are gain and its inserts' params");
    if (t.kind !== 'instrument' || !t.instrument)
      throw new Error(`track ${t.id} is an audio track; it has no instrument`);
    host = t.instrument;
    insert = 'instrument';
    device = t.instrument.device;
    label = `${param} on ${where}'s instrument`;
  } else {
    host = findInsert(insertList(p, ctx, tid), ctx, op.insert, tid);
    insert = host.id;
    device = host.device;
    label = `${param} on ${where}'s ${host.id}`;
  }
  if (device) {
    const def =
      (ctx.getDevice && ctx.getDevice(device)) ||
      (ctx.doc && ctx.doc.devices && ctx.doc.devices[device]) ||
      p.devices[device] ||
      null;
    const raw = def ? (def.params || []).find((q) => (Array.isArray(q) ? q[0] : q.key) === param) : null;
    if (raw) spec = paramSpec(raw);
    else if (def && !ctx.restore) {
      const keys = (def.params || []).map((q) => (Array.isArray(q) ? q[0] : q.key));
      throw new Error(`${device} has no param "${param}" (its params: ${keys.join(', ') || 'none'})`);
    }
  }
  return { host, track: tid, insert, param, spec, label };
}
const laneAddr = (g) =>
  g.insert ? { track: g.track, insert: g.insert, param: g.param } : { track: g.track, param: g.param };
const inRange = (pts, from, to) => pts.filter((x) => x.t >= from && x.t <= to);
// Put a lane on its host (canonical: { points, off?, by }, auto's keys sorted), or take it off (null).
function setLane(host, param, lane) {
  const auto = { ...(host.auto || {}) };
  if (lane)
    auto[param] = lane.off ? { points: lane.points, off: true, by: lane.by } : { points: lane.points, by: lane.by };
  else delete auto[param];
  const keys = Object.keys(auto).sort();
  if (!keys.length) {
    delete host.auto;
    return;
  }
  host.auto = Object.fromEntries(keys.map((k) => [k, auto[k]]));
}
const beatsText = (from, to) => (from === to ? `beat ${from}` : `beats ${from}–${to}`);
function expectRange(g, pts, from, to, print) {
  if (print == null) return;
  if (pointsPrint(inRange(pts, from, to)) !== print)
    throw new Error(
      `the lane for ${g.label} was changed since in ${beatsText(from, to)}, so it stays (undo that change first)`,
    );
}
// Replace [from, to] of a lane with `next` (canonical, inside the range) -> the inverse ops.
function writeRange(g, from, to, next, op, ctx) {
  const lane = g.host.auto && g.host.auto[g.param];
  const pts = lane ? lane.points : [];
  expectRange(g, pts, from, to, op._expect);
  let merged = [...pts.filter((x) => x.t < from), ...next, ...pts.filter((x) => x.t > to)];
  if (!ctx.restore && merged.length > LIMITS.lanePoints && merged.length > pts.length)
    throw new Error(
      `the lane for ${g.label} would hold ${merged.length.toLocaleString('en-US')} points; a lane holds up to ${LIMITS.lanePoints.toLocaleString('en-US')} (thin it, or write fewer)`,
    );
  // (every point keeps who wrote it, as a by of its own when it isn't the lane's: the inverse carries each old point's
  // author, so undo puts the lane back byte for byte)
  const old = inRange(pts, from, to).map((x) => mkPoint(x.t, x.v, x.c, pointBy(lane, x)));
  let by;
  if (op._by === false) by = lane ? lane.by : ctx.by || 'you';
  else if (typeof op._by === 'string') by = lane && op._byIf !== undefined && lane.by !== op._byIf ? lane.by : op._by;
  else by = ctx.by || 'you';
  // Who wrote each point in the range: an inverse or a planner (_by given) carries its points' authors; a fresh write
  // signs what it changed with its writer and leaves a point it rewrote unchanged with whoever wrote it.
  let authorIn;
  if (op._by !== undefined) {
    const dflt = typeof op._by === 'string' ? op._by : by;
    authorIn = (x) => x.by || dflt;
  } else {
    const was = new Map();
    for (const x of old) {
      const k = `${x.t}|${x.v}|${x.c}`;
      if (!was.has(k)) was.set(k, []);
      was.get(k).push(x.by);
    }
    const me = ctx.by || 'you';
    authorIn = (x) => {
      const q = was.get(`${x.t}|${x.v}|${x.c}`);
      return q && q.length ? q.shift() : me;
    };
  }
  merged = merged.map((x) =>
    x.t >= from && x.t <= to ? mkPoint(x.t, x.v, x.c, authorIn(x)) : mkPoint(x.t, x.v, x.c, pointBy(lane, x)),
  );
  merged = signPoints(merged, by);
  const after = merged.length ? { points: merged, off: lane ? !!lane.off : op._off === true, by } : null;
  setLane(g.host, g.param, after);
  const addr = laneAddr(g);
  if (!lane && !after) return [{ type: 'auto.write', ...addr, from, to, points: [] }];
  if (!lane) return [{ type: 'auto.clear', ...addr, from, to, _by: false, _expect: pointsPrint(next) }];
  const inv = { type: 'auto.write', ...addr, from, to, points: old, _by: lane.by, _expect: pointsPrint(next) };
  if (after) inv._byIf = by;
  else if (lane.off) inv._off = true;
  return [inv];
}
function rangeArg(v, what) {
  if (v == null) return null;
  const n = Number(v);
  if (v === '' || !Number.isFinite(n) || n < 0) throw new Error(`${what} must be a beat >= 0`);
  return rt(n);
}

const AUTO_OPS = {
  'auto.write'(p, op, ctx) {
    const g = laneTarget(p, op, ctx);
    const raw = op.points == null ? [] : parsePoints(op.points);
    if (!ctx.restore) {
      for (const x of raw) {
        if (
          !x ||
          typeof x !== 'object' ||
          !fin(Number(x.t)) ||
          !fin(Number(x.v)) ||
          typeof x.t === 'boolean' ||
          typeof x.v === 'boolean'
        )
          throw new Error(
            `a point is { t: beat, v: value, c?: curve } with numbers (got ${JSON.stringify(x).slice(0, 60)})`,
          );
        if (x.t < 0 || x.t > LIMITS.beats)
          throw new Error(`point at beat ${x.t}: points go from beat 0 to ${LIMITS.beats.toLocaleString('en-US')}`);
        if (x.c != null && x.c !== 'step' && !(fin(x.c) && x.c >= -1 && x.c <= 1))
          throw new Error(
            `point at beat ${x.t}: c (the curve leaving it) is a number from -1 (fast start) to 1 (slow start), or "step"`,
          );
        const s = g.spec;
        if (s && !op._fit && Number.isFinite(s.min) && Number.isFinite(s.max)) {
          const lo = Math.min(s.min, s.max),
            hi = Math.max(s.min, s.max),
            tol = (hi - lo) * 1e-9;
          if (x.v < lo - tol || x.v > hi + tol)
            throw new Error(
              `point at beat ${x.t}: ${g.param} goes from ${lo} to ${hi}${s.unit ? ' ' + s.unit : ''} (got ${x.v})`,
            );
        }
      }
    }
    const next = normPoints(raw, ctx.restore ? null : g.spec);
    let from = rangeArg(op.from, 'from'),
      to = rangeArg(op.to, 'to');
    if (from == null) from = next.length ? (to != null ? Math.min(next[0].t, to) : next[0].t) : null;
    if (to == null) to = next.length ? Math.max(next[next.length - 1].t, from) : null;
    if (from == null || to == null)
      throw new Error(
        'auto.write needs points (text like "0:-60 16:-6", or [{ t, v, c? }]), or from and to with none to clear that range',
      );
    if (to < from) throw new Error(`to (${to}) must be at or after from (${from})`);
    const out = next.find((x) => x.t < from || x.t > to);
    if (out)
      throw new Error(
        `point at beat ${out.t} is outside from–to (${from}–${to}); the write replaces exactly that range`,
      );
    return { inverse: writeRange(g, from, to, next, op, ctx) };
  },

  'auto.clear'(p, op, ctx) {
    const g = laneTarget(p, op, ctx);
    const lane = g.host.auto && g.host.auto[g.param];
    let from = rangeArg(op.from, 'from'),
      to = rangeArg(op.to, 'to');
    if (!lane) {
      if (op._expect != null && op._expect !== '[]')
        throw new Error(`the lane for ${g.label} was removed since, so it stays as it is (undo that change first)`);
      if (!ctx.restore) throw new Error(`there is no lane for ${g.label} to clear`);
      return { inverse: [] };
    }
    if (from == null) from = op.to == null ? lane.points[0].t : 0;
    if (to == null)
      to =
        op.from == null ? lane.points[lane.points.length - 1].t : Math.max(from, lane.points[lane.points.length - 1].t);
    if (to < from) throw new Error(`to (${to}) must be at or after from (${from})`);
    return { inverse: writeRange(g, from, to, [], op, ctx) };
  },

  'auto.set'(p, op, ctx) {
    const g = laneTarget(p, op, ctx);
    const lane = g.host.auto && g.host.auto[g.param];
    if (!lane) throw new Error(`there is no lane for ${g.label} (write one with auto.write first)`);
    const patch = op.patch || {};
    for (const k of Object.keys(patch))
      if (k !== 'off')
        throw new Error(
          `auto.set can't change "${k}" (off: true holds the lane at its knob's value, false gives it back)`,
        );
    if (!('off' in patch) || typeof patch.off !== 'boolean')
      throw new Error('auto.set needs patch: { off: true } (hold the lane) or { off: false } (back to the lane)');
    const was = !!lane.off;
    setLane(g.host, g.param, { points: lane.points, off: patch.off, by: lane.by });
    return { inverse: [{ type: 'auto.set', ...laneAddr(g), patch: { off: was } }] };
  },
};

export const OPS = {
  'project.set'(p, op) {
    const patch = op.patch || {};
    const inv = {},
      next = {};
    for (const k of ['title', 'tempo', 'meter', 'key', 'loop']) {
      if (!(k in patch)) continue;
      const v = patch[k];
      // a title is text: anything else (an object from a share link, an agent's JSON) is refused here, not trusted later
      // (and plain: its control and bidi characters are dropped, as a name's are)
      if (k === 'title' && !(typeof v === 'string' && plainText(v).length <= TITLE_MAX))
        throw new Error(`title must be text, ${TITLE_MAX} characters at most`);
      if (k === 'tempo' && !(fin(v) && v >= 20 && v <= 400)) throw new Error('tempo must be a number from 20 to 400');
      if (k === 'meter' && !validMeter(v))
        throw new Error('meter must be [beats, unit]: 1 to 32 beats, unit 1, 2, 4, 8, 16 or 32, e.g. [4, 4] or [6, 8]');
      if (k === 'key' && v !== null && !(v && typeof v.root === 'string' && typeof v.scale === 'string'))
        throw new Error('key must be { root: "C", scale: "minor" } or null');
      if (k === 'loop' && !(v && typeof v === 'object')) throw new Error('loop must be { on, start, end } in beats');
      next[k] = k === 'loop' ? { ...p.loop, ...clone(v) } : k === 'title' ? plainText(v) : clone(v);
      if (k === 'loop' && !(next.loop.end > next.loop.start)) throw new Error('loop end must be after loop start');
    }
    for (const [k, v] of Object.entries(next)) {
      inv[k] = clone(p[k]);
      p[k] = v;
    }
    return { inverse: [{ type: 'project.set', patch: inv }] };
  },

  'track.add'(p, op, ctx) {
    const raw0 = op.track || {};
    if (raw0.id && idUsed(p, raw0.id)) throw new Error(`id ${raw0.id} is already used`);
    const by = raw0.by || ctx.by;
    // (restored tracks keep their authors; new things are stamped with whoever is adding them)
    const raw = {
      ...raw0,
      by,
      clips: (raw0.clips || []).map((c) => ({
        ...c,
        by: c.by || by,
        ...(typeof c.notes === 'string' ? { notes: toNotes(c.notes) } : {}),
      })),
      inserts: (raw0.inserts || []).map((fx) => ({ ...fx, by: fx.by || by })),
    };
    const t = normTrack(raw, p.tracks.length);
    if (t.instrument) checkDevice(ctx, t.instrument.device, 'instrument');
    for (const fx of t.inserts) checkDevice(ctx, fx.device, 'effect');
    for (const c of t.clips)
      if (c.kind === 'notes') checkClipNotes(ctx, Array.isArray(c.notes) ? c.notes.length : 0, c.id);
    // (an undo puts back the notes exactly as they were, keys in their order; new ones are read and signed)
    for (const c of t.clips)
      if (c.kind === 'notes') {
        if (!ctx.restore) c.notes = toNotes(c.notes).map((n) => (n.by ? n : stamp(n, c.by)));
        idNotes(c, ctx.noteSeq);
      }
    const index = fin(op.index) ? Math.max(0, Math.min(p.tracks.length, op.index)) : p.tracks.length;
    p.tracks.splice(index, 0, t);
    if (op.ref) ctx.refs[op.ref] = t.id;
    return {
      inverse: [{ type: 'track.remove', track: t.id, _expect: trackPrint(t) }],
      created: { [op.ref || 'track']: t.id },
    };
  },

  'track.remove'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    expectTrack(t, op._expect);
    const index = p.tracks.indexOf(t);
    p.tracks.splice(index, 1);
    return { inverse: [{ type: 'track.add', track: clone(t), index }] };
  },

  'track.move'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const from = p.tracks.indexOf(t);
    const to = Math.max(0, Math.min(p.tracks.length - 1, op.index | 0));
    p.tracks.splice(from, 1);
    p.tracks.splice(to, 0, t);
    return { inverse: [{ type: 'track.move', track: t.id, index: from }] };
  },

  'track.set'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const patch = op.patch || {};
    const inv = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!['name', 'color', 'gain', 'pan', 'mute', 'solo', 'arm', 'input'].includes(k))
        throw new Error(`track.set can't change "${k}" (name, color, gain, pan, mute, solo, arm, input)`);
      if (k === 'gain' && !(fin(v) && v >= -96 && v <= 24)) throw new Error('gain is in dB, -96..24');
      if (k === 'pan' && !(fin(v) && v >= -1 && v <= 1)) throw new Error('pan is -1 (left) .. 1 (right)');
      if (k === 'name') checkName(v);
      if (k === 'color') checkColor(v);
    }
    for (const [k, v] of Object.entries(patch)) {
      inv[k] = clone(t[k]);
      t[k] = k === 'name' ? plainText(v) : clone(v);
    }
    return { inverse: [{ type: 'track.set', track: t.id, patch: inv }] };
  },

  'instrument.set'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    if (t.kind !== 'instrument') throw new Error(`track ${t.id} is an audio track; it has no instrument`);
    const old = clone(t.instrument);
    checkParams(op.params);
    if (op.device && op.device !== t.instrument.device) {
      checkDevice(ctx, op.device, 'instrument');
      t.instrument = { device: op.device, params: {} };
    }
    mergeParams(t.instrument.params, op.params);
    return { inverse: [{ type: 'instrument.set', track: t.id, device: old.device, params: null, _restore: old }] };
  },

  'insert.add'(p, op, ctx) {
    // the inverse names the track by its id, never by the name it was asked for (a rename would orphan the undo)
    const tid = op.track === 'master' ? 'master' : findTrack(p, ctx, op.track).id;
    const list = insertList(p, ctx, tid);
    const raw = op.insert || {};
    if (!raw.device) throw new Error('insert.add needs insert: { device: "<device id>" }');
    checkDevice(ctx, raw.device, 'effect');
    if (raw.id && idUsed(p, raw.id)) throw new Error(`id ${raw.id} is already used`);
    const fx = normInsert({
      ...raw,
      by: raw.by || ctx.by,
      key: raw.key == null || ctx.restore ? raw.key : checkKey(p, ctx, tid, raw.key, null, raw.device),
    });
    const index = fin(op.index) ? Math.max(0, Math.min(list.length, op.index)) : list.length;
    list.splice(index, 0, fx);
    if (op.ref) ctx.refs[op.ref] = fx.id;
    return {
      inverse: [{ type: 'insert.remove', track: tid, insert: fx.id }],
      created: { [op.ref || 'insert']: fx.id },
    };
  },

  'insert.remove'(p, op, ctx) {
    const tid = op.track === 'master' ? 'master' : findTrack(p, ctx, op.track).id;
    const list = insertList(p, ctx, tid);
    const fx = findInsert(list, ctx, op.insert, tid);
    const index = list.indexOf(fx);
    list.splice(index, 1);
    return { inverse: [{ type: 'insert.add', track: tid, insert: clone(fx), index }] };
  },

  'insert.move'(p, op, ctx) {
    const tid = op.track === 'master' ? 'master' : findTrack(p, ctx, op.track).id;
    const list = insertList(p, ctx, tid);
    const fx = findInsert(list, ctx, op.insert, tid);
    const from = list.indexOf(fx),
      to = Math.max(0, Math.min(list.length - 1, op.index | 0));
    list.splice(from, 1);
    list.splice(to, 0, fx);
    return { inverse: [{ type: 'insert.move', track: tid, insert: fx.id, index: from }] };
  },

  'insert.set'(p, op, ctx) {
    const tid = op.track === 'master' ? 'master' : findTrack(p, ctx, op.track).id;
    const list = insertList(p, ctx, tid);
    const fx = findInsert(list, ctx, op.insert, tid);
    const patch = op.patch || {};
    const inv = {};
    if (patch.params) inv.params = mergeParams(fx.params, patch.params); // (checks every param first)
    if ('on' in patch) {
      inv.on = fx.on;
      fx.on = !!patch.on;
    }
    if ('key' in patch) {
      const next =
        patch.key == null
          ? null
          : ctx.restore
            ? normKey(patch.key)
            : checkKey(p, ctx, tid, patch.key, fx.id, fx.device);
      inv.key = fx.key ? clone(fx.key) : null;
      if (next) fx.key = next;
      else delete fx.key;
    }
    return { inverse: [{ type: 'insert.set', track: tid, insert: fx.id, patch: inv }] };
  },

  'clip.add'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const raw = op.clip || {};
    if (raw.id && idUsed(p, raw.id)) throw new Error(`id ${raw.id} is already used`);
    const kind = raw.kind || (t.kind === 'audio' ? 'audio' : 'notes');
    if (kind === 'audio' && !raw.asset) throw new Error('an audio clip needs asset: "<asset id>"');
    if (raw.take != null && !isTakeId(raw.take)) throw new Error('take must be a take group id like "tk_a1b2c3"');
    if (kind === 'notes' && t.kind === 'audio')
      throw new Error(`track ${t.id} is an audio track; notes go on instrument tracks`);
    const c = normClip({ ...raw, kind, notes: [], by: raw.by || ctx.by });
    if (kind === 'notes') {
      // (an undo puts back the notes exactly as they were, keys in their order)
      c.notes =
        ctx.restore && Array.isArray(raw.notes) && !raw.grid
          ? clone(raw.notes)
          : toNotes(raw.notes, raw.grid).map((n) => stamp({ ...n }, n.by || ctx.by));
      checkClipNotes(ctx, c.notes.length, c.id);
      idNotes(c, ctx.noteSeq);
      if (!raw.length && c.notes.length) {
        let end = 0;
        for (const n of c.notes) end = Math.max(end, n.t + n.d);
        c.length = Math.max(4, Math.ceil(end / 4) * 4);
      }
    }
    t.clips.push(c);
    t.clips.sort(byStart);
    if (op.ref) ctx.refs[op.ref] = c.id;
    return {
      inverse: [{ type: 'clip.remove', track: t.id, clip: c.id, _expect: clipPrint(c) }],
      created: { [op.ref || 'clip']: c.id },
    };
  },

  'clip.remove'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const c = findClip(t, ctx, op.clip);
    expectClip(c, op._expect);
    t.clips.splice(t.clips.indexOf(c), 1);
    return { inverse: [{ type: 'clip.add', track: t.id, clip: clone(c) }] };
  },

  'clip.set'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const c = findClip(t, ctx, op.clip);
    const inv = {};
    const patch = op.patch || {};
    for (const [k, v] of Object.entries(patch)) {
      if (!['start', 'length', 'name', 'color', 'offset', 'gain', 'mute', 'take', 'tuning', 'capo'].includes(k))
        throw new Error(
          `clip.set can't change "${k}" (start, length, name, color, offset, gain, mute, take, tuning, capo)`,
        );
      if (k === 'mute' && v !== null && typeof v !== 'boolean') throw new Error('mute must be true or false');
      if (k === 'take' && v !== null && !isTakeId(v))
        throw new Error('take must be a take group id like "tk_a1b2c3" (or null to leave the group)');
      if ((k === 'tuning' || k === 'capo') && c.kind !== 'notes')
        throw new Error(`clip ${c.id} is audio: a tuning and a capo are for a notes clip's tab`);
      if (k === 'tuning') checkTuning(v);
      if (k === 'capo' && v !== null && !(Number.isInteger(v) && v >= 0 && v <= 12))
        throw new Error('capo is the fret the capo sits at, 0 (none) to 12');
      // null clears an optional field (the inverse of setting one the clip didn't have); start and length always stay
      if (v === null && k !== 'start' && k !== 'length') continue;
      if ((k === 'start' || k === 'offset') && !(fin(v) && v >= 0)) throw new Error(`${k} must be a number >= 0`);
      if (k === 'length' && !(fin(v) && v >= 0.25)) throw new Error('length must be at least 0.25 beats');
      if (k === 'name') checkName(v);
      if (k === 'color') checkColor(v);
    }
    for (const [k, v] of Object.entries(patch)) {
      inv[k] = c[k] === undefined ? null : clone(c[k]);
      // (mute: false is stored as no mute at all, the way every older song has it; so is capo 0)
      if (v === null || (k === 'mute' && v === false) || (k === 'capo' && v === 0)) delete c[k];
      else c[k] = k === 'name' ? plainText(v) : clone(v);
    }
    t.clips.sort(byStart);
    return { inverse: [{ type: 'clip.set', track: t.id, clip: c.id, patch: inv }] };
  },

  'clip.move'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const c = findClip(t, ctx, op.clip);
    const to = op.toTrack ? findTrack(p, ctx, op.toTrack) : t;
    if (to.kind !== t.kind)
      throw new Error(`can't move a ${c.kind} clip onto ${to.kind === 'audio' ? 'an audio' : 'an instrument'} track`);
    const oldStart = c.start;
    if (fin(op.start)) c.start = Math.max(0, op.start);
    if (to !== t) {
      t.clips.splice(t.clips.indexOf(c), 1);
      to.clips.push(c);
    }
    to.clips.sort(byStart);
    return { inverse: [{ type: 'clip.move', track: to.id, clip: c.id, toTrack: t.id, start: oldStart }] };
  },

  'notes.add'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const c = findClip(t, ctx, op.clip);
    if (c.kind !== 'notes') throw new Error(`clip ${c.id} is audio; notes go in notes clips`);
    const add = toNotes(op.notes, op.grid).map((n) => stamp({ ...n, id: undefined }, ctx.by));
    for (const n of add) delete n.id;
    checkClipNotes(ctx, c.notes.length + add.length, c.id);
    const before = new Set(c.notes.map((n) => n.id));
    c.notes.push(...add);
    idNotes(c, ctx.noteSeq);
    const ids = c.notes.filter((n) => !before.has(n.id)).map((n) => n.id);
    return {
      inverse: [
        removeNotes(
          t.id,
          c.id,
          ids,
          ctx.by,
          c.notes.filter((n) => !before.has(n.id)),
        ),
      ],
      created: { notes: ids },
    };
  },

  // by (set on inverses): the notes must still be that author's. If someone else has changed one since (an edit signs
  // the note), the remove refuses instead of deleting their work, so an author's undo never takes another's notes.
  // An undo, redo or revert also refuses when a note it names was moved into another clip since (movedTo above); a
  // note someone deleted is already gone, so it's skipped, as a forward remove skips any missing id.
  'notes.remove'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const c = findClip(t, ctx, op.clip);
    const ids = new Set(op.ids || []);
    const gone = c.notes.filter((n) => ids.has(n.id));
    if (ctx.restore && gone.length < ids.size) {
      const have = new Set(gone.map((n) => n.id));
      for (const id of ids) {
        const o = have.has(id) ? null : movedTo(t, c, id, { p: op._p ? op._p[id] : null, by: op.by });
        if (o) throw movedNote(id, c, o);
      }
    }
    if (op.by) {
      const theirs = gone.find((n) => n.by !== op.by);
      if (theirs)
        throw new Error(
          `note ${theirs.id} in clip ${c.id} was changed by ${theirs.by || 'someone'} since ${op.by} added it, so it stays (undo that change first)`,
        );
    }
    c.notes = c.notes.filter((n) => !ids.has(n.id));
    return { inverse: [{ type: 'notes.restore', track: t.id, clip: c.id, notes: clone(gone) }] };
  },

  // Internal: put notes back with their ids (the inverse of notes.remove).
  'notes.restore'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const c = findClip(t, ctx, op.clip);
    c.notes.push(...clone(op.notes));
    idNotes(c, ctx.noteSeq); // (they all have ids: this keeps the clip's counter past them, and sorts)
    const bys = new Set(op.notes.map((n) => n.by));
    return {
      inverse: [
        removeNotes(
          t.id,
          c.id,
          op.notes.map((n) => n.id),
          bys.size === 1 ? [...bys][0] : null,
          op.notes,
        ),
      ],
    };
  },

  'notes.set'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const c = findClip(t, ctx, op.clip);
    const inv = [];
    const patches = (op.notes || []).map((patch) => {
      const n = c.notes.find((x) => x.id === patch.id);
      if (!n) throw new Error(`no note ${patch.id} in clip ${c.id}`);
      for (const k of ['p', 't', 'd', 'v']) if (k in patch) normNote({ ...n, [k]: patch[k] }); // (throws on a bad value)
      checkPlace(patch, n);
      return [n, patch];
    });
    for (const [n, patch] of patches) {
      const old = { id: n.id };
      for (const k of ['p', 't', 'd', 'v']) {
        if (!(k in patch)) continue;
        old[k] = n[k];
        const fixed = normNote({ ...n, [k]: patch[k] });
        n[k] = fixed[k];
      }
      // its place on the neck (s, f: both, or null for none); the inverse puts back what was there, or none
      if ('s' in patch || 'f' in patch) {
        old.s = n.s ?? null;
        old.f = n.f ?? null;
        if (patch.s == null) {
          delete n.s;
          delete n.f;
        } else {
          n.s = patch.s;
          n.f = patch.f;
        }
      }
      old.by = n.by ?? null; // (null: the note had no author; the undo leaves it with none, exactly)
      if (ctx.by) n.by = ctx.by;
      inv.unshift(old); // (newest first: two patches to one note undo back to the first one's old value)
    }
    sortNotes(c);
    return { inverse: [{ type: 'notes.set', track: t.id, clip: c.id, notes: inv, _keepBy: true }] };
  },

  'notes.replace'(p, op, ctx) {
    const t = findTrack(p, ctx, op.track);
    const c = findClip(t, ctx, op.clip);
    expectClip(c, op._expect);
    const old = clone(c.notes);
    const next = op._restore
      ? clone(op._restore)
      : toNotes(op.notes, op.grid).map((n) => stamp({ ...n, id: undefined }, ctx.by));
    checkClipNotes(ctx, next.length, c.id);
    if (!op._restore) for (const n of next) delete n.id;
    c.notes = next;
    idNotes(c, ctx.noteSeq);
    // (the inverse puts the old notes back only while the clip is still as this left it)
    return {
      inverse: [{ type: 'notes.replace', track: t.id, clip: c.id, _restore: old, _expect: notesPrint(c.notes) }],
    };
  },

  'section.add'(p, op, ctx) {
    const s = op.section || {};
    const sec = {
      id: s.id || newId('s'),
      name: sectionName(s.name),
      start: Math.max(0, Number(s.start) || 0),
      length: Math.max(1, Number(s.length) || 16),
    };
    if (isColor(s.color)) sec.color = s.color;
    p.sections.push(sec);
    p.sections.sort(byStart);
    if (op.ref) ctx.refs[op.ref] = sec.id;
    return { inverse: [{ type: 'section.remove', section: sec.id }], created: { [op.ref || 'section']: sec.id } };
  },
  'section.set'(p, op, ctx) {
    const id = resolve(ctx, typeof op.section === 'object' ? op.section.id : op.section);
    const sec = p.sections.find((s) => s.id === id || String(s.name).toLowerCase() === String(id).toLowerCase());
    if (!sec)
      throw new Error(
        `no section "${id}" (sections: ${p.sections.map((s) => `${s.id} "${s.name}"`).join(', ') || 'none'})`,
      );
    const inv = {};
    const patch = op.patch || {};
    for (const [k, v] of Object.entries(patch)) {
      if (!['name', 'start', 'length', 'color'].includes(k))
        throw new Error(`section.set can't change "${k}" (name, start, length, color)`);
      if (k === 'start' && !(fin(v) && v >= 0)) throw new Error('start must be a number >= 0');
      if (k === 'length' && !(fin(v) && v > 0)) throw new Error('length must be a number of beats > 0');
      if (k === 'name') checkName(v);
      if (k === 'color' && v !== null) checkColor(v);
    }
    for (const [k, v] of Object.entries(patch)) {
      inv[k] = sec[k] === undefined ? null : sec[k];
      if (v === null) delete sec[k];
      else sec[k] = k === 'name' ? plainText(v) : v;
    }
    p.sections.sort(byStart);
    return { inverse: [{ type: 'section.set', section: sec.id, patch: inv }] };
  },
  'section.remove'(p, op, ctx) {
    const id = resolve(ctx, typeof op.section === 'object' ? op.section.id : op.section);
    const i = p.sections.findIndex((s) => s.id === id);
    if (i < 0) throw new Error(`no section "${id}"`);
    const [sec] = p.sections.splice(i, 1);
    return { inverse: [{ type: 'section.add', section: clone(sec) }] };
  },

  'master.set'(p, op) {
    const patch = op.patch || {};
    const inv = {};
    if ('clip' in patch && patch.clip != null && !['soft', 'clean'].includes(patch.clip))
      throw new Error(
        'master clip is "soft" (the safety soft clip, the default) or "clean" (a hard ceiling at 0 dBFS, linear below: for a master that ends in a limiter)',
      );
    if ('gain' in patch) {
      if (!(fin(patch.gain) && patch.gain >= -96 && patch.gain <= 24)) throw new Error('master gain is in dB, -96..24');
      inv.gain = p.master.gain;
      p.master.gain = patch.gain;
    }
    if ('clip' in patch) {
      inv.clip = p.master.clip === 'clean' ? 'clean' : 'soft';
      if (patch.clip === 'clean') p.master.clip = 'clean';
      else delete p.master.clip;
    }
    return { inverse: [{ type: 'master.set', patch: inv }] };
  },

  'asset.add'(p, op) {
    const a = op.asset || {};
    if (!a.id) throw new Error('asset.add needs asset: { id, kind: "audio", name, sr, channels, duration }');
    const old = p.assets[a.id];
    p.assets[a.id] = {
      kind: a.kind || 'audio',
      name: a.name || a.id,
      sr: a.sr,
      channels: a.channels,
      duration: a.duration,
    };
    return {
      inverse: [old ? { type: 'asset.add', asset: { id: a.id, ...clone(old) } } : { type: 'asset.remove', id: a.id }],
    };
  },
  'asset.remove'(p, op) {
    const old = p.assets[op.id];
    if (!old) throw new Error(`no asset "${op.id}"`);
    delete p.assets[op.id];
    return { inverse: [{ type: 'asset.add', asset: { id: op.id, ...clone(old) } }] };
  },

  // The reference track (ui/reference.js): a finished song to compare against, kept beside the song and never in it
  // (not a track, not in the mix or any render). reference: { asset, name, sr, channels, duration, profile } | null.
  'reference.set'(p, op, ctx) {
    const r = op.reference;
    if (r !== null && !isValidReference(r))
      throw new Error(
        'reference.set needs reference: { asset, name, duration, profile: { lufs, bands, … } } (measured, as the Reference tab does) or null',
      );
    const old = p.reference ? clone(p.reference) : null;
    if (r === null) delete p.reference;
    else p.reference = { ...clone(r), by: r.by || ctx.by };
    return { inverse: [{ type: 'reference.set', reference: old }] };
  },

  'device.define'(p, op, ctx) {
    const d = op.device || {};
    if (!d.id || typeof d.kernel !== 'string')
      throw new Error('device.define needs device: { id, name, kind, params, kernel: "source" }');
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(d.id))
      throw new Error(`bad device id "${String(d.id).slice(0, 80)}": 2-64 of a-z 0-9 . _ -, e.g. "claude.velvet-fuzz"`);
    // a song's devices add to the studio; they never take over one it ships (built-in namespaces, the house shelf)
    // (undo and redo put back what was there, as everywhere)
    const shipped = ctx.getDevice && !ctx.restore ? ctx.getDevice(d.id) : null;
    if (
      !ctx.restore &&
      (/^(core|pedal|amp|cab|overdub)\./.test(d.id) || (shipped && shipped.source && shipped.source !== 'project'))
    )
      throw new Error(
        `"${d.id}" is a device the studio ships, and its id is fixed: write yours under your own name, e.g. "${
          String(ctx.by || 'you')
            .replace(/^mcp:/, '')
            .replace(/[^a-z0-9]+/gi, '-')
            .toLowerCase() || 'you'
        }.${d.id.split('.').slice(1).join('-') || 'device'}"`,
      );
    if (d.kernel.length > 256 * 1024)
      throw new Error(`the kernel is ${Math.ceil(d.kernel.length / 1024)} KB; a device's source can be up to 256 KB`);
    const old = p.devices[d.id];
    const src = {
      ...clone(d),
      by: d.by || ctx.by,
      version: old ? (old.version || 1) + 1 : 1,
      created: old?.created || new Date().toISOString(),
      modified: new Date().toISOString(),
    };
    // its name and its presets' names are names, kept as a loaded song keeps them (a device is new, or a new version):
    // plain and cut to NAME_MAX, a name that isn't text left out (the registry still holds a preset's to 40)
    if ('name' in src) {
      const name = cleanName(src.name, '');
      if (name) src.name = name;
      else delete src.name;
    }
    if (Array.isArray(src.presets))
      src.presets = src.presets.map((pr) =>
        pr && typeof pr === 'object' && typeof pr.name === 'string' ? { ...pr, name: cleanName(pr.name, '') } : pr,
      );
    if (op._restore) Object.assign(src, clone(op._restore));
    p.devices[d.id] = src;
    return {
      inverse: [
        old ? { type: 'device.define', device: clone(old), _restore: clone(old) } : { type: 'device.remove', id: d.id },
      ],
    };
  },
  'device.remove'(p, op) {
    const old = p.devices[op.id];
    if (!old) throw new Error(`no project device "${op.id}"`);
    delete p.devices[op.id];
    return { inverse: [{ type: 'device.define', device: clone(old), _restore: clone(old) }] };
  },
};

Object.assign(OPS, AUTO_OPS);

// instrument.set's inverse restores the whole instrument (device + params) exactly.
const _instrumentSet = OPS['instrument.set'];
OPS['instrument.set'] = function (p, op, ctx) {
  if (op._restore) {
    const t = findTrack(p, ctx, op.track);
    const old = clone(t.instrument);
    t.instrument = clone(op._restore);
    return { inverse: [{ type: 'instrument.set', track: t.id, _restore: old }] };
  }
  return _instrumentSet(p, op, ctx);
};
// notes.set inverses put back the previous author too.
const _notesSet = OPS['notes.set'];
OPS['notes.set'] = function (p, op, ctx) {
  if (op._keepBy) {
    const t = findTrack(p, ctx, op.track),
      c = findClip(t, ctx, op.clip);
    for (const patch of op.notes) {
      // (an edit undone after a split moved the note refuses; a deleted note is skipped)
      const o = c.notes.some((x) => x.id === patch.id) ? null : movedTo(t, c, patch.id, { by: ctx.by });
      if (o) throw movedNote(patch.id, c, o);
    }
    const inv = [];
    for (const patch of op.notes) {
      const n = c.notes.find((x) => x.id === patch.id);
      if (!n) continue;
      const old = { id: n.id, by: n.by ?? null };
      for (const k of ['p', 't', 'd', 'v'])
        if (k in patch) {
          old[k] = n[k];
          n[k] = patch[k];
        }
      if ('s' in patch || 'f' in patch) {
        old.s = n.s ?? null;
        old.f = n.f ?? null;
        if (patch.s == null) {
          delete n.s;
          delete n.f;
        } else {
          n.s = patch.s;
          n.f = patch.f;
        }
      }
      if (patch.by) n.by = patch.by;
      else if (patch.by === null) delete n.by;
      inv.unshift(old);
    }
    sortNotes(c);
    return { inverse: [{ type: 'notes.set', track: t.id, clip: c.id, notes: inv, _keepBy: true }] };
  }
  return _notesSet(p, op, ctx);
};
// Arrangement ops (core/arrangement.js): section.duplicate, time.insert, time.remove, clip.repeat, clip.split. Each
// plans the ops above from the song as it is, checks everything first (a plan that can't be made throws before
// anything changes), and applies them; its inverse is theirs, newest first, so an undo is exact. created.clips lists
// every clip it made, in order (a repeat's copies, a split's right half, a duplicate's copies), and created.clip is
// the first of them, the one `ref` names.
for (const [type, plan] of Object.entries(ARRANGEMENT_OPS)) {
  OPS[type] = function (p, op, ctx) {
    const inverse = [],
      created = {},
      clips = [];
    for (const o of plan(p, op, ctx).ops) {
      const r = OPS[o.type](p, o, ctx);
      inverse.unshift(...r.inverse);
      Object.assign(created, r.created || {});
      if (o.type === 'clip.add' && r.created) clips.push(...Object.values(r.created));
    }
    if (clips.length) {
      created.clips = clips;
      created.clip = clips[0];
    }
    return { inverse, created };
  };
}

export const OP_TYPES = Object.keys(OPS).filter((k) => k !== 'notes.restore');

export function applyOp(p, op, ctx) {
  if (!op || typeof op !== 'object') throw new Error('an op must be an object like { type: "track.add", ... }');
  const fn = OPS[op.type];
  if (!fn) throw new Error(`unknown op type "${op.type}" (known: ${OP_TYPES.join(', ')})`);
  return fn(p, op, ctx);
}
