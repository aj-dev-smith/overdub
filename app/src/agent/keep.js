// A song from a link isn't the person's yet: what an agent would take away waits for them (docs/SECURITY.md, "Decided
// and built"; AJ's call). While the person listens to a song someone sent (app.share.listening: ui/share.js sets it for
// a song opened from a link and clears it on Make it yours, Back to my song, or another song opening), an agent's change
// that deletes, rewrites what's there or brings new code isn't applied: the store's guard (core/store.js) holds it, and
// agent/tools.js runTool puts the whole call on a card with one take, Keep and Keep as it was (the propose_variations
// machinery). Keep applies it signed by the agent; Keep as it was changes nothing. Small additive moves go straight
// through, as everywhere: they're undoable and take nothing away.
//
// Why: a shared song's text can steer an agent (song text is content, not instructions, but a name in it can still talk
// one into wiping the song), and the person listening hasn't decided to keep it. Nothing an agent does to it should
// destroy the friend's work without the person seeing it first.
//
//   keepFirst(app, by) -> bool           would this caller's taking-away changes wait for a Keep right now? (any caller
//                                        but the person, while listening)
//   installKeep(app, { onHold })         sets app.store.guard (idempotent); onHold(hold) hears each hold
//   takenBy(project, ops, { by, getDevice }) -> { ok: true, items, ops } | { ok: false, error }   worked out on a copy:
//                                        what the ops take away (items), and the ops with every track named by its id
//   itemsText(items, nameOf, { apos }) -> 'delete Bass (Sam’s part) and replace the notes in Hook on Keys (Sam’s)'
//   whoseIds(item) / whoseText(ids, nameOf, { part, apos })
//   heldCodeFirst(app, by), HELD_CODE_FINE, kernelPrint(source)   a song with held devices: new code waits for Keep
//                                        too, and a held device's code is known with its names and comments changed
//
// What counts (AJ's list): deletions (a track, a clip, notes, a section, bars of time, an insert, a lane or its points, a
// device, a recording, the reference track), rewrites of what's there (notes.replace, notes.set on notes that were
// there, an automation write that takes out points that were there, a new instrument in place of the one there, a loop
// that drops the notes past a clip's end) and new code (device.define, new or a new version). Everything else (adds,
// mix moves, renames, moves, splits, copies, tempo) takes nothing away. Something the same call made first (a track it
// added, notes it added) is the call's own: taking it out again takes nothing away.
//
// An Item: { kind, verb, past, what, whose: [author ids], part?, code?, device? } ('delete', 'deleted', 'Bass', ['guest:sam-…'],
// part: true reads "(Sam’s part)").

import { applyOp } from '../core/ops.js';
import { idNotes, songSize, sizeError } from '../core/project.js';
import { laneAt } from '../core/automation.js';
import { spanLabel, whereLabel } from '../core/arrangement.js';
import { laneParam } from './diff.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const EPS = 1e-9;

// The person's own calls (by 'you') never wait; anyone else's do, while the song on screen came from a link.
export function keepFirst(app, by) {
  return !!(app && app.share && app.share.listening) && by !== 'you';
}

/* ------------------------------------------------------------------------------------------------ held code */
// A song can bring devices whose code this browser hasn't allowed (held: devices/trust.js). Only the person lets that
// code run. define_device refuses a held device's code outright, as it is or with its names, comments or spacing changed
// (kernelPrint, below); and on a song that has held devices, any new code an agent defines waits for the person's Keep,
// as it does on a song from a link: a real rewrite of held code can't be told from new code, and Keep is where the
// person decides whether code runs here (AJ's call, FRESH-EYES-6). The device check runs when they press Keep.
//
//   heldCodeFirst(app, by) -> bool       would new code from this caller wait for a Keep because of held devices?
//   HELD_CODE_FINE                       the card's small print for it
//   kernelPrint(source) -> string        a kernel's code with names, comments and spacing taken out
export function heldCodeFirst(app, by) {
  if (!app || by === 'you') return false;
  try {
    return (app.devices?.heldDevices?.() || []).length > 0;
  } catch {
    return true;
  } // (can't tell: wait)
}
export const HELD_CODE_FINE =
  'This song has devices kept off on this computer, so new code waits for you. The device check runs when you press Keep; nothing of it runs before.';

// The code of a kernel with what can change without changing the code taken out: comments and spacing, semicolons and
// trailing commas, and its names (each name that isn't a property, after a dot, or a keyword becomes $0, $1, … in order
// of first use). Numbers are read by value; strings, templates, regexes, properties and every other token stay as they
// are. Two kernels with the same print are one program, whatever its names, comments or layout. -> string
const KEYWORDS = new Set(
  (
    'break case catch class const continue debugger default delete do else export extends false finally for function if ' +
    'import in instanceof let new null of return super switch this throw true try typeof var void while with yield async await undefined NaN Infinity'
  ).split(' '),
);
const REGEX_AFTER = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'instanceof',
  'yield',
  'await',
]);
export function kernelPrint(source) {
  const s = String(source ?? '');
  const out = [],
    names = new Map();
  let i = 0,
    prev = null;
  const push = (kind, v) => {
    out.push(v);
    prev = { kind, v };
  };
  // a / starts a regex where a value can't end: after an operator, an opening bracket, a comma or a keyword like return
  const regexHere = () =>
    !prev || (prev.kind === 'p' && !/^[)\]}]$/.test(prev.v)) || (prev.kind === 'k' && REGEX_AFTER.has(prev.v));
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const j = s.indexOf('*/', i + 2);
      i = j < 0 ? s.length : j + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
      push('s', s.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1,
        depth = 0;
      while (j < s.length) {
        if (s[j] === '\\') {
          j += 2;
          continue;
        }
        if (!depth && s[j] === '`') break;
        if (s[j] === '$' && s[j + 1] === '{') {
          depth++;
          j += 2;
          continue;
        }
        if (depth && s[j] === '}') depth--;
        j++;
      }
      push('s', s.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const m = /^(?:0[xXbBoO][0-9a-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/.exec(s.slice(i));
      const txt = m ? m[0] : c,
        n = Number(txt.replace(/_/g, '').replace(/n$/, ''));
      push('n', Number.isFinite(n) ? String(n) : txt);
      i += txt.length;
      continue;
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      const w = /^[A-Za-z_$\u0080-￿][\w$\u0080-￿]*/.exec(s.slice(i))[0];
      i += w.length;
      if (KEYWORDS.has(w)) push('k', w);
      else if (prev && prev.v === '.')
        push('i', w); // a property: its name is what it is
      else {
        if (!names.has(w)) names.set(w, '$' + names.size);
        push('i', names.get(w));
      }
      continue;
    }
    if (c === '/' && regexHere()) {
      let j = i + 1,
        cls = false;
      while (j < s.length && (cls || s[j] !== '/') && s[j] !== '\n') {
        if (s[j] === '\\') j++;
        else if (s[j] === '[') cls = true;
        else if (s[j] === ']') cls = false;
        j++;
      }
      j++;
      while (j < s.length && /[a-z]/.test(s[j])) j++;
      push('r', s.slice(i, j));
      i = j;
      continue;
    }
    push('p', c);
    i++;
  }
  // semicolons and trailing commas (before a closing bracket) carry nothing
  const toks = out.filter((t) => t !== ';');
  return toks.filter((t, k) => !(t === ',' && /^[)\]}]$/.test(toks[k + 1] || ''))).join(' ');
}

// What the guard says to whoever dispatched a change it held (a tool sees this as its dispatch's error; runTool turns
// the call into a card and tells the agent so).
export const HELD_ERROR =
  "held: this song came from a link and isn't the person's yet (until Make it yours), so deletions, note rewrites and new devices go to them as a card to Keep; nothing changed";

export function installKeep(app, { onHold = null } = {}) {
  const store = app && app.store;
  if (!store || store._keepGuard) return;
  store._keepGuard = true;
  store.guard = (ops, { by, label, reason, as = null } = {}) => {
    if (!keepFirst(app, by)) return null;
    const getDevice = app.devices?.getDevice || null;
    let v;
    try {
      // an arrangement move dispatched as its plan (a split rewrites the left half and moves the rest into a new clip) is
      // read as the move it is: a split or bars put in take nothing; bars taken out do. Its card keeps the plan's own ops.
      // (as comes from studio code, never from an agent's ops; if it can't be read, the plan itself is)
      const read = as && as.length ? takenBy(store.get(), as, { by, getDevice }) : null;
      v = read && read.ok ? { ...read, ops } : takenBy(store.get(), ops, { by, getDevice });
    } catch (e) {
      // a fault in working it out: hold it, said plainly (never let a change through unread)
      console.error('keep: reading what a change takes', e);
      v = { ok: true, ops, items: [{ kind: 'change', verb: 'change', past: 'changed', what: 'the song', whose: [] }] };
    }
    if (!v.ok || !v.items.length) return null; // (a change that can't apply is refused by the dispatch, as always)
    const hold = {
      by,
      ops: v.ops,
      label: label || '',
      reason: reason || '',
      items: v.items,
      at: Date.now(),
      call: null,
      claimed: false,
    };
    if (onHold) {
      try {
        onHold(hold);
      } catch (e) {
        console.error('keep: onHold', e);
      }
    }
    return { error: HELD_ERROR, hold };
  };
}

/* ------------------------------------------------------------------------------------------------ what it takes */
const findTrack = (p, ref) =>
  typeof ref !== 'string'
    ? null
    : p.tracks.find((t) => t.id === ref) ||
      p.tracks.find((t) => String(t.name).toLowerCase() === ref.toLowerCase()) ||
      null;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// a note's author: its own, else its clip's (the convention every view reads)
const noteBy = (n, clip) => n.by || clip?.by || null;
// whose, people first: you, then the guests a link names, then agents (sort is stable: otherwise in the order met)
const rank = (id) => (id === 'you' ? 0 : /^guest:/.test(id) ? 1 : 2);

// Run the ops on a copy of the song, one by one (as the store would, refs and limits included), and read what each one
// took away from its inverse: an inverse that puts back something the song had is something the op took.
export function takenBy(project, ops, { by = 'claude', getDevice = null } = {}) {
  const doc = clone(project);
  const seq = new Map();
  for (const t of doc.tracks) for (const c of t.clips) if (c.kind === 'notes') idNotes(c, seq);
  const ctx = { by, refs: {}, getDevice, doc, restore: false, noteSeq: seq };
  const size0 = songSize(doc);
  const born = { tracks: new Set(), clips: new Set(), inserts: new Set(), sections: new Set(), notes: new Set() };
  const items = [],
    out = [];
  const tname = (id) => (id === 'master' ? 'the master' : doc.tracks.find((t) => t.id === id)?.name || id);
  const clipOf = (tid, cid) => doc.tracks.find((t) => t.id === tid)?.clips.find((c) => c.id === cid) || null;
  const clipWhere = (tid, cid, c = clipOf(tid, cid)) => `${c && c.name ? c.name : 'a clip'} on ${tname(tid)}`;
  const dname = (id) => getDevice?.(id)?.name || doc.devices?.[id]?.name || id;
  const bornNote = (cid, nid) => born.clips.has(cid) || born.notes.has(`${cid}:${nid}`);
  for (let i = 0; i < ops.length; i++) {
    // a track named by its name is named by its id from here on, so a Keep later lands on the track the card showed
    const op = ops[i] && typeof ops[i] === 'object' ? { ...ops[i] } : ops[i];
    for (const k of ['track', 'toTrack']) {
      if (!op || typeof op[k] !== 'string' || op[k] === 'master' || op[k].startsWith('$')) continue;
      const t = findTrack(doc, op[k]);
      if (t) op[k] = t.id;
    }
    out.push(op);
    // what the op needs from the song before it runs
    const resolve = (ref) => (typeof ref === 'string' && ref.startsWith('$') ? ctx.refs[ref.slice(1)] : ref);
    const t0 = op && typeof op.track === 'string' ? findTrack(doc, resolve(op.track)) : null;
    const instrument0 = t0?.instrument?.device || null;
    const device0 =
      op?.type === 'device.define'
        ? doc.devices?.[op.device?.id] || null
        : op?.type === 'device.remove'
          ? doc.devices?.[op.id] || null
          : null;
    const asset0 = op?.type === 'asset.remove' ? doc.assets?.[op.id] || null : null;
    const loop0 =
      op?.type === 'clip.repeat' && op.mode === 'loop' && t0
        ? clone(t0.clips.find((c) => c.id === resolve(op.clip)) || null)
        : null;
    let r;
    try {
      r = applyOp(doc, op, ctx);
      const why = sizeError(songSize(doc), size0);
      if (why) throw new Error(why);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const inv = r.inverse || [];
    const take = (item) =>
      items.push({
        ...item,
        whose: [...new Set((item.whose || []).filter((x) => typeof x === 'string' && x))].sort(
          (a, b) => rank(a) - rank(b),
        ),
      });
    try {
      switch (op.type) {
        // what the call makes is its own
        case 'track.add': {
          const id = inv.find((o) => o.type === 'track.remove')?.track;
          const t = doc.tracks.find((x) => x.id === id);
          if (t) {
            born.tracks.add(t.id);
            for (const c of t.clips) born.clips.add(c.id);
            for (const fx of t.inserts) born.inserts.add(fx.id);
          }
          break;
        }
        case 'clip.add': {
          const id = inv.find((o) => o.type === 'clip.remove')?.clip;
          if (id) born.clips.add(id);
          break;
        }
        case 'insert.add': {
          const id = inv.find((o) => o.type === 'insert.remove')?.insert;
          if (id) born.inserts.add(id);
          break;
        }
        case 'section.add': {
          const id = inv.find((o) => o.type === 'section.remove')?.section;
          if (id) born.sections.add(id);
          break;
        }
        case 'notes.add': {
          const a = inv.find((o) => o.type === 'notes.remove');
          for (const id of a?.ids || []) born.notes.add(`${a.clip}:${id}`);
          break;
        }
        // deletions
        case 'track.remove': {
          const t = inv.find((o) => o.type === 'track.add')?.track;
          if (t && !born.tracks.has(t.id))
            take({
              kind: 'track',
              verb: 'delete',
              past: 'deleted',
              what: t.name || 'a track',
              part: true,
              whose: [t.by],
            });
          break;
        }
        case 'clip.remove': {
          const a = inv.find((o) => o.type === 'clip.add'),
            c = a?.clip;
          if (c && !born.clips.has(c.id))
            take({
              kind: 'clip',
              verb: 'delete',
              past: 'deleted',
              what: `${c.name ? `the clip ${c.name}` : 'a clip'} on ${tname(a.track)}`,
              whose: [c.by],
            });
          break;
        }
        case 'notes.remove': {
          const a = inv.find((o) => o.type === 'notes.restore');
          const c = a && clipOf(a.track, a.clip);
          const gone = (a?.notes || []).filter((n) => !bornNote(a.clip, n.id));
          if (gone.length)
            take({
              kind: 'notes',
              verb: 'delete',
              past: 'deleted',
              what: `${plural(gone.length, 'note')} in ${clipWhere(a.track, a.clip, c)}`,
              whose: gone.map((n) => noteBy(n, c)),
            });
          break;
        }
        case 'section.remove': {
          const s = inv.find((o) => o.type === 'section.add')?.section;
          if (s && !born.sections.has(s.id))
            take({ kind: 'section', verb: 'delete', past: 'deleted', what: `the section ${s.name || ''}`.trim() });
          break;
        }
        case 'insert.remove': {
          const a = inv.find((o) => o.type === 'insert.add'),
            fx = a?.insert;
          if (fx && !born.inserts.has(fx.id))
            take({
              kind: 'insert',
              verb: 'remove',
              past: 'removed',
              what: `${dname(fx.device)} from ${tname(a.track)}`,
              whose: [fx.by],
            });
          break;
        }
        case 'time.remove': {
          // who made what was in those bars: the clips it took out or cut, and their notes
          const whose = [];
          for (const o of inv) {
            if (o.type === 'clip.add' && o.clip) {
              whose.push(o.clip.by);
              for (const n of o.clip.notes || []) whose.push(noteBy(n, o.clip));
            } else if (o.type === 'notes.restore' || o.type === 'notes.replace') {
              const c = clipOf(o.track, o.clip);
              for (const n of o.notes || o._restore || []) whose.push(noteBy(n, c));
            } else if (o.type === 'clip.set' && o.clip) {
              const c = clipOf(o.track, o.clip);
              if (c) whose.push(c.by);
            }
          }
          take({
            kind: 'time',
            verb: 'delete',
            past: 'deleted',
            what: `${spanLabel(doc, Number(op.length) || 0)} from ${whereLabel(doc, Number(op.at) || 0)} and what plays in them`,
            whose,
          });
          break;
        }
        case 'device.remove':
          take({
            kind: 'device',
            verb: 'delete',
            past: 'deleted',
            what: `the device ${device0?.name || op.id}`,
            whose: [device0?.by],
          });
          break;
        case 'asset.remove':
          take({ kind: 'asset', verb: 'delete', past: 'deleted', what: `the recording ${asset0?.name || op.id}` });
          break;
        case 'asset.add': {
          if (inv[0]?.type === 'asset.add')
            take({
              kind: 'asset',
              verb: 'replace',
              past: 'replaced',
              what: `the recording ${inv[0].asset?.name || op.asset?.id}`,
            });
          break;
        }
        case 'reference.set': {
          const old = inv[0]?.reference;
          if (old)
            take({
              kind: 'reference',
              verb: op.reference ? 'replace' : 'remove',
              past: op.reference ? 'replaced' : 'removed',
              what: 'the reference track',
              whose: [old.by],
            });
          break;
        }
        // rewrites of what's there
        case 'notes.replace': {
          const a = inv.find((o) => o.type === 'notes.replace');
          const c = a && clipOf(a.track, a.clip);
          const old = (a?._restore || []).filter((n) => !bornNote(a.clip, n.id));
          if (old.length)
            take({
              kind: 'notes',
              verb: 'replace the notes in',
              past: 'replaced the notes in',
              what: clipWhere(a.track, a.clip, c),
              whose: old.map((n) => noteBy(n, c)),
            });
          break;
        }
        case 'notes.set': {
          const a = inv.find((o) => o.type === 'notes.set');
          const c = a && clipOf(a.track, a.clip);
          const old = (a?.notes || []).filter((n) => !bornNote(a.clip, n.id));
          if (old.length)
            take({
              kind: 'notes',
              verb: 'rewrite',
              past: 'rewrote',
              what: `${plural(new Set(old.map((n) => n.id)).size, 'note')} in ${clipWhere(a.track, a.clip, c)}`,
              whose: old.map((n) => n.by || c?.by),
            });
          break;
        }
        case 'instrument.set': {
          // a new instrument in place of the one there: its sound and its lanes go with it
          const t = t0 && doc.tracks.find((x) => x.id === t0.id);
          if (t && op.device && instrument0 && op.device !== instrument0 && !born.tracks.has(t.id))
            take({
              kind: 'instrument',
              verb: 'replace',
              past: 'replaced',
              what: `the instrument on ${t.name} (${dname(instrument0)})`,
              whose: [t.by],
            });
          break;
        }
        case 'auto.write':
        case 'auto.clear': {
          // the points that were in the range: a write that keeps every one of them takes nothing away
          const a = inv[0];
          if (!a || a.type !== 'auto.write' || !Array.isArray(a.points) || !a.points.length) break;
          const addr = { track: a.track, ...(a.insert != null ? { insert: a.insert } : {}), param: a.param };
          const lane = laneAt(doc, addr);
          const left = lane?.points || [];
          const gone = a.points.filter(
            (q) =>
              !left.some(
                (x) => Math.abs(x.t - q.t) < EPS && Math.abs(x.v - q.v) < EPS && (x.c ?? null) === (q.c ?? null),
              ),
          );
          if (!gone.length) break;
          const host = a.track === 'master' ? doc.master : doc.tracks.find((t) => t.id === a.track);
          const dev =
            a.insert == null
              ? 'mixer'
              : a.insert === 'instrument'
                ? host?.instrument?.device
                : (host?.inserts || []).find((x) => x.id === a.insert)?.device;
          const pn = laneParam(dev || 'mixer', a.param, getDevice).name;
          const on = tname(a.track);
          const what = !lane
            ? `the ${pn} lane on ${on}`
            : `${plural(gone.length, 'point')} ${op.type === 'auto.clear' ? 'from' : 'of'} the ${pn} lane on ${on}`;
          take({
            kind: 'lane',
            verb: !lane ? 'delete' : op.type === 'auto.clear' ? 'clear' : 'write over',
            past: !lane ? 'deleted' : op.type === 'auto.clear' ? 'cleared' : 'wrote over',
            what,
            whose: gone.map((q) => q.by),
          });
          break;
        }
        case 'clip.repeat': {
          // a loop plays the clip as it sounds: the notes past its old end (silent there) are dropped
          if (!loop0 || born.clips.has(loop0.id) || loop0.kind !== 'notes') break;
          const dropped = (loop0.notes || []).filter((n) => n.t >= loop0.length - 1e-6 && !bornNote(loop0.id, n.id));
          if (dropped.length)
            take({
              kind: 'notes',
              verb: 'delete',
              past: 'deleted',
              what: `${plural(dropped.length, 'silent note')} past the end of ${clipWhere(t0.id, loop0.id, loop0)}`,
              whose: dropped.map((n) => noteBy(n, loop0)),
            });
          break;
        }
        // new code: a device new to the song, or a new version of one in it
        case 'device.define': {
          const d = op.device || {};
          take(
            device0
              ? {
                  kind: 'device',
                  code: true,
                  device: d.id,
                  verb: 'rewrite',
                  past: 'rewrote',
                  what: `the device ${device0.name || d.id}`,
                  whose: [device0.by],
                }
              : {
                  kind: 'device',
                  code: true,
                  device: d.id,
                  verb: 'add',
                  past: 'added',
                  what: `a new device, ${d.name || d.id}`,
                },
          );
          break;
        }
        default:
          break; // adds, mix moves, renames, moves, splits, copies, tempo: nothing taken
      }
    } catch (e) {
      // a fault in reading it: hold it as a change to the song, said plainly
      console.error('keep: reading', op?.type, e);
      take({ kind: 'change', verb: 'change', past: 'changed', what: 'the song' });
    }
  }
  // a new device that the same call puts on a track says where it goes
  for (const it of items) {
    if (!it.code) continue;
    const use = out.find(
      (o) =>
        o &&
        ((o.type === 'insert.add' && o.insert?.device === it.device) ||
          (o.type === 'instrument.set' && o.device === it.device)),
    );
    if (use)
      it.what += `, on ${use.track === 'master' ? 'the master' : tname(typeof use.track === 'string' && use.track.startsWith('$') ? ctx.refs[use.track.slice(1)] : use.track)}`;
  }
  return { ok: true, items, ops: out };
}

/* ------------------------------------------------------------------------------------------------ in words */
// The authors an item names: people and agents, never the house (it's unsigned), each once.
export function whoseIds(item) {
  return [...new Set((item?.whose || []).filter((x) => typeof x === 'string' && x && x !== 'overdub'))];
}
// "(Sam’s part)", "(Sam’s and Claude’s)", "(yours)": who the thing it takes was by. nameOf(id) -> a display name.
export function whoseText(ids, nameOf, { part = false, apos = '’' } = {}) {
  if (!ids.length) return '';
  const names = ids.map((id) => (id === 'you' ? (part ? 'your' : 'yours') : `${nameOf(id)}${apos}s`));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list}${part ? ' part' : ''}`;
}
export function itemText(item, nameOf, { apos = '’', past = false } = {}) {
  const who = whoseText(whoseIds(item), nameOf, { part: !!item.part, apos });
  return `${past ? item.past : item.verb} ${item.what}${who ? ` (${who})` : ''}`;
}
// One line for a list of items: "delete Bass (Sam’s part) and replace the notes in Hook on Keys (Sam’s)"; past: "deleted …".
export function itemsText(items, nameOf, { apos = '’', past = false, max = 3 } = {}) {
  const seen = new Set(),
    list = [];
  for (const it of items || []) {
    const s = itemText(it, nameOf, { apos, past });
    if (!seen.has(s)) {
      seen.add(s);
      list.push(s);
    }
  }
  if (!list.length) return past ? 'changed the song' : 'change the song';
  if (list.length <= max)
    return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
}
