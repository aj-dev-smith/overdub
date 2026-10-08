// The store: the one place a song changes. Every change is a transaction of ops (core/ops.js): atomic, attributed to
// an author (a person or an agent), logged, and undoable. The GUI, the in-app agent and outside agents all come
// through dispatch(), so there is one history and one truth.
//
//   const store = createStore(project, { getDevice });
//   store.dispatch(ops, { by: 'claude', label: 'walking bassline', coalesce?: 'knob:fx_1:drive', kept? })
//     -> { ok: true, txn, created } | { ok: false, error } | { ok: false, held: true, error, hold }
//   store.dispatch(ops, { ..., join: txnId })  the change and that transaction are one undo step, when it is still the
//     newest (nothing done after it, nothing undone) and by the same author: a take onto the track made for it (the
//     track at the count-in, its hits at the stop) undoes in one step. Otherwise it is a transaction of its own.
//   store.guard = (ops, { by, label, reason, as }) -> null | { error, hold }   a hold: the change isn't applied (kept
//     skips it); as: [op], what the ops are as one op (an arrangement move dispatched as its plan), for the guard to read
//   store.undo({ by?, id?, redo? }) / store.redo() / store.canUndo() / store.canRedo()
//   store.on('change', fn)  fn({ txn, ops, by, kind: 'do' | 'undo' | 'redo' | 'load' })
//   store.history           the done transactions, oldest first
//   store.authors / store.author(id) / store.addAuthor(id, { kind, name })

import { applyOp } from './ops.js';
import {
  createProject,
  cleanProject,
  idNotes,
  songSize,
  sizeError,
  namedAuthor,
  looseName,
  STUDIO_NAMES,
} from './project.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const COALESCE_MS = 1500;
const HISTORY_MAX = 500;

export function createStore(project, { getDevice = null } = {}) {
  let doc = project ? cleanProject(project) : createProject();
  const listeners = new Map(); // type -> Set
  const done = []; // transactions that can be undone (oldest first)
  let undone = []; // transactions that can be redone (most recent last)
  let seq = 0;
  // clip id -> the next note number to hand out (project.js idNotes): ids are never reused while history can name them
  const noteSeq = new Map();
  const seedNoteIds = (fresh = true) => {
    if (fresh) noteSeq.clear();
    for (const t of doc.tracks) for (const c of t.clips) if (c.kind === 'notes') idNotes(c, noteSeq);
  };
  seedNoteIds();
  const authors = {
    you: { kind: 'human', name: 'You' },
    claude: { kind: 'agent', name: 'Claude' },
    overdub: { kind: 'house', name: 'Overdub' }, // demo content: neither yours nor an agent's
  };
  const OWN = new Set(Object.keys(authors));
  // Anyone else is named by this session or by the song, and both can be a link's word (ui/share.js teaches the session
  // the song's names), so every answer goes through project.js namedAuthor: the kind is the id's form, and a name is
  // shown only when it is no one else's. Taken: the studio's own and those of the agents that joined this session (only
  // presence.js puts an mcp: id in this table). Answers are kept while what they were made from is unchanged: the piano
  // roll asks for every note it draws.
  const named = new Map();
  let joined = 0;
  function takenBesides(id) {
    const out = new Set(STUDIO_NAMES);
    for (const [k, a] of Object.entries(authors))
      if (k !== id && k.startsWith('mcp:') && typeof a?.name === 'string') out.add(looseName(a.name));
    return out;
  }

  function emit(type, detail) {
    for (const fn of listeners.get(type) || []) {
      try {
        fn(detail);
      } catch (e) {
        console.error('store listener', type, e);
      }
    }
  }

  // Apply ops in order, all or nothing: if one throws, the song goes back exactly as it was and the error is rethrown.
  // The ops already applied are rolled back by their inverses (so the objects the GUI holds stay the same objects);
  // if anything still differs (an op that threw halfway), the song is put back from a snapshot taken before.
  // restore: undo, redo and reverts put back what was there, so they don't re-check devices (a song may hold devices
  // this browser hasn't loaded: they're kept, and deleting one must be undoable).
  function run(ops, by, { restore = false } = {}) {
    const ctx = { by, refs: {}, getDevice, doc, restore, noteSeq };
    const inverse = [];
    const created = {};
    const applied = [];
    const before = JSON.stringify(doc);
    // (the backstop on growth, core/project.js LIMITS: an op that takes the song past one is refused like any bad op.
    // Undo, redo and reverts put back a song that was already here, so they aren't held to it.)
    const size0 = restore ? null : songSize(doc);
    try {
      for (const op of ops) {
        const r = applyOp(doc, op, ctx);
        inverse.unshift(...r.inverse); // the inverse of [a, b] is [b⁻¹, a⁻¹]
        if (size0) {
          const why = sizeError(songSize(doc), size0);
          if (why) throw new Error(why);
        }
        applied.push(op);
        if (r.created) for (const [k, v] of Object.entries(r.created)) created[k] = v;
      }
    } catch (e) {
      const rb = { by, refs: {}, getDevice: null, restore: true, noteSeq };
      for (const inv of inverse) {
        try {
          applyOp(doc, inv, rb);
        } catch (e2) {
          /* the snapshot below puts it right */
        }
      }
      if (JSON.stringify(doc) !== before) {
        const snap = JSON.parse(before);
        for (const k of Object.keys(doc)) delete doc[k];
        Object.assign(doc, snap); // (the same doc object: store.get() and ctx.doc hand it out)
      }
      const i = applied.length;
      const err = new Error(
        `op ${i + 1} of ${ops.length} (${ops[i]?.type}) failed: ${e.message} — nothing was changed${i ? ` (the ${i} op${i > 1 ? 's' : ''} before it ${i > 1 ? 'were' : 'was'} rolled back)` : ''}`,
      );
      err.index = i;
      throw err;
    }
    return { inverse, created };
  }

  function touch(by) {
    doc.meta.modified = new Date().toISOString();
    if (by && authors[by] && !doc.meta.authors[by]) doc.meta.authors[by] = { ...authors[by] };
  }

  // Redo a revert (revertAuthor's one redo step): its changes go back in, oldest first, each one its own History line
  // again. All or nothing: if one can't go back, the ones before it are taken out again and the song is as it was.
  function redoRevert(entry) {
    const back = [];
    try {
      for (const x of entry.revert) {
        const r = run(x.forward, x.by, { restore: true });
        back.push({ id: x.id, at: Date.now(), by: x.by, label: x.label, ops: x.ops, inverse: r.inverse });
      }
    } catch (e) {
      for (const b of back.slice().reverse()) {
        try {
          run(b.inverse, b.by, { restore: true });
        } catch (e2) {
          console.error('store: redo of a revert, rolling back', e2);
        }
      }
      undone = [];
      return { ok: false, error: 'could not redo: ' + e.message };
    }
    done.push(...back);
    if (done.length > HISTORY_MAX) done.splice(0, done.length - HISTORY_MAX);
    touch(entry.by);
    const last = back[back.length - 1];
    emit('change', {
      txn: last,
      ops: entry.revert.flatMap((x) => x.forward),
      by: entry.by,
      kind: 'redo',
      restored: back,
    });
    return { ok: true, txn: last, restored: back.length };
  }

  const store = {
    get: () => doc,
    get history() {
      return done;
    },
    get redoable() {
      return undone;
    },
    authors,
    author(id) {
      const key = String(id);
      if (OWN.has(key)) return authors[key];
      // what this session says about them, else what the song does (a guest from a share link, an agent the sender
      // worked with)
      const song = doc.meta?.authors;
      const said =
        (Object.hasOwn(authors, key) && authors[key]) || (song && Object.hasOwn(song, key) && song[key]) || null;
      const was = named.get(key);
      if (was && was.said === said && was.kind === said?.kind && was.name === said?.name && was.joined === joined)
        return was.out;
      const out = namedAuthor(key, said, takenBesides(key));
      named.set(key, { said, kind: said?.kind, name: said?.name, joined, out });
      return out;
    },
    addAuthor(id, info) {
      authors[id] = { kind: info.kind || 'agent', name: info.name || id };
      joined++;
    },
    isAgent(id) {
      return store.author(id).kind === 'agent';
    },

    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },

    // guard: set by the app (agent/keep.js): a change it holds isn't applied, and nothing is emitted; the caller gets
    // { ok: false, held: true, error, hold }. kept: the person said yes to exactly these ops (a card's Keep), so the
    // guard isn't asked. as: the same change as one op (core/arrangement.js plans dispatched as their primitives), which
    // the guard reads for what the change is.
    guard: null,

    dispatch(
      opOrOps,
      {
        by = 'you',
        label = '',
        reason = '',
        coalesce = null,
        silent = false,
        audition = false,
        kept = false,
        as = null,
        join = null,
      } = {},
    ) {
      const ops = (Array.isArray(opOrOps) ? opOrOps : [opOrOps]).map(clone);
      if (!ops.length) return { ok: true, txn: null, created: {} };
      if (!kept && typeof store.guard === 'function') {
        let g = null;
        try {
          g = store.guard(ops, { by, label, reason, as: Array.isArray(as) ? as.map(clone) : null });
        } catch (e) {
          console.error('store guard', e);
        }
        if (g)
          return {
            ok: false,
            held: true,
            error: g.error || 'held: this change waits for the person to keep it',
            hold: g.hold || null,
          };
      }
      let r;
      try {
        r = run(ops, by);
      } catch (e) {
        return { ok: false, error: e.message, index: e.index };
      }
      touch(by);
      const last = done[done.length - 1];
      let txn;
      if (join && last && last.id === join && last.by === by && !undone.length) {
        last.ops.push(...ops);
        last.inverse = [...r.inverse, ...last.inverse];
        last.at = Date.now();
        if (label) last.label = label;
        if (reason) last.reason = reason;
        txn = last;
      } else if (
        coalesce &&
        last &&
        last.coalesce === coalesce &&
        last.by === by &&
        Date.now() - last.at < COALESCE_MS &&
        !undone.length
      ) {
        last.ops.push(...ops);
        last.inverse = [...r.inverse, ...last.inverse];
        last.at = Date.now();
        txn = last;
      } else {
        txn = { id: 'x' + ++seq, at: Date.now(), by, label: label || describe(ops), ops, inverse: r.inverse, coalesce };
        if (reason) txn.reason = reason;
        if (audition) txn.audition = true;
        done.push(txn);
        if (done.length > HISTORY_MAX) done.shift();
      }
      undone = [];
      if (!silent) emit('change', { txn, ops, by, kind: 'do', created: r.created });
      return { ok: true, txn, created: r.created };
    },

    // Hear ops without keeping them (hold-to-audition): applies them silently to the song and returns release(),
    // which takes them back out exactly. Nothing reaches the history. Listeners get kind 'preview' both ways.
    preview(opOrOps, { by = 'you' } = {}) {
      const ops = (Array.isArray(opOrOps) ? opOrOps : [opOrOps]).map(clone);
      let r;
      try {
        r = run(ops, by);
      } catch (e) {
        return { ok: false, error: e.message, release() {} };
      }
      emit('change', { txn: null, ops, by, kind: 'preview' });
      let done_ = false;
      // release() -> { ok, skipped }: if a later edit made the exact inverse impossible (the track is gone), each inverse
      // op is put back on its own and the ones that can't apply are skipped, so as little of the preview as possible stays.
      return {
        ok: true,
        created: r.created,
        release() {
          if (done_) return { ok: true, skipped: 0 };
          done_ = true;
          let skipped = 0;
          try {
            run(r.inverse, by, { restore: true });
          } catch (e) {
            for (const inv of r.inverse) {
              try {
                run([inv], by, { restore: true });
              } catch (e2) {
                skipped++;
              }
            }
            console.error('preview release failed', e);
          }
          emit('change', { txn: null, ops: r.inverse, by, kind: 'preview' });
          return { ok: skipped === 0, skipped };
        },
      };
    },

    canUndo: (by) => (by ? done.some((t) => t.by === by) : done.length > 0),

    // Revert everything one author did (since a transaction id, if given), newest first, keeping everyone else's
    // edits. Transactions that can't be undone any more (later edits built on them) are skipped and reported.
    // A `since` that isn't in the history (undone, aged out, mistyped) reverts nothing: it never widens to everything.
    // A revert is an undo, so one redo puts the whole of it back (History's Revert all, then ⌘⇧Z).
    revertAuthor(by, { since = null } = {}) {
      const start = since ? done.findIndex((t) => t.id === since) : 0;
      if (start < 0)
        return {
          ok: false,
          reverted: 0,
          skipped: [],
          error: `no change ${since} in the history (it was undone, or is older than the last ${HISTORY_MAX} changes); nothing was reverted`,
        };
      const targets = done
        .slice(start)
        .filter((t) => t.by === by)
        .reverse();
      const reverted = [],
        skipped = [],
        back = [];
      for (const txn of targets) {
        const i = done.indexOf(txn);
        try {
          const r = run(txn.inverse, txn.by, { restore: true });
          done.splice(i, 1);
          reverted.push(txn);
          back.unshift({ ...txn, forward: r.inverse });
        } catch (e) {
          skipped.push({ txn, error: e.message });
        }
      }
      if (reverted.length) {
        undone.push({
          id: 'v' + ++seq,
          at: Date.now(),
          by,
          label: back.length === 1 ? back[0].label : `${back.length} changes`,
          revert: back,
        });
        touch(by);
        emit('change', { txn: null, ops: [], by, kind: 'undo', reverted });
      }
      return { ok: skipped.length === 0, reverted: reverted.length, skipped };
    },
    canRedo: () => undone.length > 0,

    // Undo the latest transaction, or the latest by one author (which may not be the latest overall: if later
    // changes depend on it, this can fail, and nothing changes), or the one with this id. redo: false takes it out
    // without leaving it to redo (a call rolled back to go to the person as one card: agent/tools.js). forward: the
    // ops that put it back exactly, ids and authors included.
    undo({ by = null, id = null, redo = true } = {}) {
      let i = done.length - 1;
      if (id) i = done.findIndex((t) => t.id === id);
      else if (by) while (i >= 0 && done[i].by !== by) i--;
      if (i < 0)
        return {
          ok: false,
          error: id ? `no change ${id} to undo` : by ? `nothing by ${by} to undo` : 'nothing to undo',
        };
      const txn = done[i];
      let r;
      try {
        r = run(txn.inverse, txn.by, { restore: true });
      } catch (e) {
        return { ok: false, error: 'could not undo: ' + e.message };
      }
      done.splice(i, 1);
      // redoing re-applies exactly what was undone (with the same ids): the inverse of the inverse. An undo out of order
      // (one author's latest, History's Undo, with later edits kept) redoes too: redo is last in, first out, and any new
      // edit clears it, so each redo meets the song exactly as its undo left it.
      if (redo) undone.push({ ...txn, inverse: txn.inverse, forward: r.inverse });
      touch(txn.by);
      emit('change', { txn, ops: txn.inverse, by: txn.by, kind: 'undo' });
      return { ok: true, txn, forward: r.inverse };
    },

    redo() {
      const txn = undone.pop();
      if (!txn) return { ok: false, error: 'nothing to redo' };
      if (txn.revert) return redoRevert(txn);
      let r;
      try {
        r = run(txn.forward, txn.by, { restore: true });
      } catch (e) {
        undone = [];
        return { ok: false, error: 'could not redo: ' + e.message };
      }
      const back = { id: txn.id, at: Date.now(), by: txn.by, label: txn.label, ops: txn.ops, inverse: r.inverse };
      done.push(back);
      touch(txn.by);
      emit('change', { txn: back, ops: txn.forward, by: txn.by, kind: 'redo' });
      return { ok: true, txn: back };
    },

    load(project, { by = 'you', keepHistory = false } = {}) {
      doc = cleanProject(project);
      if (!keepHistory) {
        done.length = 0;
        undone = [];
      }
      seedNoteIds(!keepHistory); // (history kept: so are the counters it may name)
      emit('change', { txn: null, ops: [], by, kind: 'load' });
      return doc;
    },

    // finders
    track: (id) => doc.tracks.find((t) => t.id === id) || null,
    clip: (trackId, clipId) => store.track(trackId)?.clips.find((c) => c.id === clipId) || null,
    insert: (trackId, insertId) =>
      (trackId === 'master' ? doc.master.inserts : store.track(trackId)?.inserts || []).find(
        (x) => x.id === insertId,
      ) || null,
    findClip(clipId) {
      for (const t of doc.tracks) {
        const c = t.clips.find((x) => x.id === clipId);
        if (c) return { track: t, clip: c };
      }
      return null;
    },
  };
  return store;
}

// A short human label for a transaction ("add track Bass", "4 notes", ...).
export function describe(ops) {
  if (ops.length === 1) {
    const o = ops[0];
    switch (o.type) {
      case 'track.add':
        return `add track ${o.track?.name || ''}`.trim();
      case 'track.remove':
        return 'remove track';
      case 'track.set':
        return 'track ' + Object.keys(o.patch || {}).join(', ');
      case 'clip.add':
        return 'add clip';
      case 'clip.remove':
        return 'delete clip';
      case 'clip.move':
        return 'move clip';
      case 'clip.set':
        return 'clip ' + Object.keys(o.patch || {}).join(', ');
      case 'notes.add':
        return 'add notes';
      case 'notes.remove':
        return `delete ${o.ids?.length || ''} note${o.ids?.length === 1 ? '' : 's'}`;
      case 'notes.set':
        return `edit ${o.notes?.length || ''} note${o.notes?.length === 1 ? '' : 's'}`;
      case 'notes.replace':
        return 'rewrite notes';
      case 'insert.add':
        return `add ${o.insert?.device || 'effect'}`;
      case 'insert.remove':
        return 'remove effect';
      case 'insert.set':
        return o.patch && 'on' in o.patch && !o.patch.params
          ? o.patch.on
            ? 'effect on'
            : 'effect off'
          : 'tweak effect';
      case 'instrument.set':
        return o.device ? `instrument ${o.device}` : 'tweak instrument';
      case 'project.set':
        return Object.keys(o.patch || {}).join(', ');
      case 'device.define':
        return `write device ${o.device?.name || o.device?.id || ''}`.trim();
      default:
        return o.type;
    }
  }
  const kinds = [...new Set(ops.map((o) => o.type.split('.')[0]))];
  return `${ops.length} changes (${kinds.join(', ')})`;
}
