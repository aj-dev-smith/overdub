// core/store.js: dispatch (atomic, attributed), the three grains of undo, redo, coalescing, joins, the guard,
// previews, change events and authors.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, describe as label } from '../../app/src/core/store.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const song = (p) => {
  const s = clone(p);
  delete s.meta;
  return JSON.stringify(s);
};

function withKeys(by = 'you') {
  const store = createStore();
  const r = store.dispatch(
    [
      { type: 'track.add', ref: 't', track: { name: 'Keys', instrument: { device: 'core.poly', params: {} } } },
      { type: 'clip.add', ref: 'c', track: '$t', clip: { start: 0, length: 4, notes: 'C4@0:1' } },
    ],
    { by },
  );
  assert.ok(r.ok, r.error);
  return { store, t: r.created.t, c: r.created.c };
}

describe('dispatch', () => {
  test('a new store holds an empty song', () => {
    const store = createStore();
    const p = store.get();
    assert.equal(p.format, 'overdub/0');
    assert.deepEqual(p.tracks, []);
    assert.equal(store.canUndo(), false);
    assert.equal(store.canRedo(), false);
  });

  test('takes one op or a list, and an empty list is a no-op', () => {
    const store = createStore();
    assert.ok(store.dispatch({ type: 'project.set', patch: { tempo: 90 } }).ok);
    assert.equal(store.get().tempo, 90);
    const r = store.dispatch([]);
    assert.deepEqual(r, { ok: true, txn: null, created: {} });
    assert.equal(store.history.length, 1);
  });

  test('refs name things made earlier in the same transaction, and created maps them', () => {
    const { store, t, c } = withKeys();
    assert.match(t, /^t_[0-9a-z]{6}$/);
    assert.match(c, /^c_[0-9a-z]{6}$/);
    assert.equal(store.clip(t, c).notes.length, 1);
    assert.equal(store.findClip(c).track.id, t);
  });

  test('a transaction is all or nothing: a failing op rolls back the ones before it', () => {
    const { store, t } = withKeys();
    const before = song(store.get());
    const n = store.history.length;
    const r = store.dispatch([
      { type: 'track.set', track: t, patch: { gain: -6 } },
      { type: 'clip.add', track: t, clip: { start: 8, notes: 'E4@0:1' } },
      { type: 'track.set', track: t, patch: { gain: 99 } },
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.index, 2);
    assert.match(r.error, /op 3 of 3 \(track\.set\) failed: .*nothing was changed .*2 ops before it were rolled back/);
    assert.equal(song(store.get()), before);
    assert.equal(store.history.length, n);
  });

  test('the song object stays the same object through a rollback', () => {
    const { store, t } = withKeys();
    const doc = store.get();
    store.dispatch([{ type: 'track.set', track: t, patch: { gain: -6 } }, { type: 'nope' }]);
    assert.equal(store.get(), doc);
  });

  test('the ops given are not mutated or kept by reference', () => {
    const { store, t } = withKeys();
    const op = { type: 'track.set', track: t, patch: { gain: -3 } };
    const copy = clone(op);
    store.dispatch(op);
    assert.deepEqual(op, copy);
    op.patch.gain = -40;
    assert.equal(store.history.at(-1).ops[0].patch.gain, -3);
  });

  test('every transaction is attributed, labelled and kept with its reason', () => {
    const { store, t } = withKeys('claude');
    store.dispatch({ type: 'track.set', track: t, patch: { gain: -2 } }, { by: 'mcp:cursor', reason: 'too loud' });
    const h = store.history;
    assert.equal(h[0].by, 'claude');
    assert.equal(h[1].by, 'mcp:cursor');
    assert.equal(h[1].reason, 'too loud');
    assert.equal(h[1].label, 'track gain');
    assert.equal(store.get().meta.authors.claude.kind, 'agent');
  });

  test('change listeners hear do, undo, redo and load, and can unsubscribe', () => {
    const store = createStore();
    const kinds = [];
    const off = store.on('change', (e) => kinds.push(e.kind));
    store.dispatch({ type: 'project.set', patch: { tempo: 100 } });
    store.undo();
    store.redo();
    store.load({ title: 'x' });
    off();
    store.dispatch({ type: 'project.set', patch: { tempo: 110 } });
    assert.deepEqual(kinds, ['do', 'undo', 'redo', 'load']);
  });

  test('silent dispatches are not emitted but are undoable', () => {
    const store = createStore();
    let n = 0;
    store.on('change', () => n++);
    store.dispatch({ type: 'project.set', patch: { tempo: 100 } }, { silent: true });
    assert.equal(n, 0);
    assert.ok(store.canUndo());
  });

  test('a listener that throws does not stop the dispatch or the others', () => {
    const store = createStore();
    const seen = [];
    const err = console.error;
    console.error = () => {};
    try {
      store.on('change', () => {
        throw new Error('boom');
      });
      store.on('change', (e) => seen.push(e.kind));
      assert.ok(store.dispatch({ type: 'project.set', patch: { tempo: 100 } }).ok);
    } finally {
      console.error = err;
    }
    assert.deepEqual(seen, ['do']);
  });

  test('history keeps the latest 500 transactions', () => {
    const store = createStore();
    for (let i = 0; i < 510; i++) store.dispatch({ type: 'project.set', patch: { tempo: 60 + (i % 100) } });
    assert.equal(store.history.length, 500);
  });
});

describe('undo and redo', () => {
  test('undo then redo, last in first out, and a new edit clears redo', () => {
    const store = createStore();
    for (const tempo of [100, 110, 120]) store.dispatch({ type: 'project.set', patch: { tempo } });
    store.undo();
    store.undo();
    assert.equal(store.get().tempo, 100);
    store.redo();
    assert.equal(store.get().tempo, 110);
    store.dispatch({ type: 'project.set', patch: { title: 'new' } });
    assert.equal(store.canRedo(), false);
    assert.equal(store.redo().ok, false);
  });

  test('nothing to undo says so', () => {
    const r = createStore().undo();
    assert.equal(r.ok, false);
    assert.match(r.error, /nothing to undo/);
  });

  test('undo returns forward, the ops that put the change back exactly', () => {
    const { store, t } = withKeys();
    store.dispatch({ type: 'track.set', track: t, patch: { name: 'Piano' } });
    const after = song(store.get());
    const u = store.undo({ redo: false });
    assert.ok(u.ok);
    assert.equal(store.canRedo(), false, 'redo: false leaves nothing to redo');
    assert.ok(store.dispatch(u.forward).ok);
    assert.equal(song(store.get()), after);
  });

  test('redo brings back the same ids', () => {
    const store = createStore();
    const r = store.dispatch({ type: 'track.add', track: { name: 'A' } });
    store.undo();
    assert.equal(store.get().tracks.length, 0);
    store.redo();
    assert.equal(store.get().tracks[0].id, r.created.track);
  });

  test("undo by author takes that author's latest, keeping later edits by others", () => {
    const { store, t } = withKeys();
    store.dispatch({ type: 'track.set', track: t, patch: { gain: -6 } }, { by: 'claude' });
    store.dispatch({ type: 'project.set', patch: { tempo: 88 } }, { by: 'you' });
    const r = store.undo({ by: 'claude' });
    assert.ok(r.ok, r.error);
    assert.equal(store.track(t).gain, 0);
    assert.equal(store.get().tempo, 88);
    assert.equal(store.canUndo('claude'), false);
    assert.equal(store.undo({ by: 'claude' }).ok, false);
  });

  test("an author's undo refuses, changing nothing, when someone else built on it", () => {
    const store = createStore();
    const r = store.dispatch(
      [
        { type: 'track.add', ref: 't', track: { name: 'Bass' } },
        { type: 'clip.add', ref: 'c', track: '$t', clip: { notes: 'C2@0:1' } },
      ],
      { by: 'claude' },
    );
    // the person adds notes to the agent's clip
    store.dispatch({ type: 'notes.add', track: r.created.t, clip: r.created.c, notes: 'E2@1:1' }, { by: 'you' });
    const before = song(store.get());
    const u = store.undo({ by: 'claude' });
    assert.equal(u.ok, false);
    assert.match(u.error, /could not undo/);
    assert.equal(song(store.get()), before);
  });

  test('undoing a note someone else has since edited refuses instead of deleting their work', () => {
    const { store, t, c } = withKeys('you');
    const add = store.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'G4@2:1' }, { by: 'claude' });
    const id = add.created.notes[0];
    store.dispatch({ type: 'notes.set', track: t, clip: c, notes: [{ id, p: 68 }] }, { by: 'you' });
    const u = store.undo({ by: 'claude' });
    assert.equal(u.ok, false);
    assert.ok(store.clip(t, c).notes.some((n) => n.id === id));
  });

  test('note ids are never reused while history can name them', () => {
    const { store, t, c } = withKeys();
    const a = store.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'D4@1:1' }).created.notes[0];
    store.undo();
    const b = store.dispatch({ type: 'notes.add', track: t, clip: c, notes: 'D4@1:1' }).created.notes[0];
    assert.notEqual(a, b);
  });

  test('undo by id', () => {
    const store = createStore();
    const a = store.dispatch({ type: 'project.set', patch: { tempo: 90 } }).txn;
    store.dispatch({ type: 'project.set', patch: { title: 'B' } });
    assert.ok(store.undo({ id: a.id }).ok);
    assert.equal(store.get().tempo, 120);
    assert.equal(store.get().title, 'B');
    assert.equal(store.undo({ id: 'x999' }).ok, false);
  });
});

describe('revertAuthor', () => {
  test("takes out everything one author did, keeps everyone else's, and one redo puts it all back", () => {
    const { store, t } = withKeys('you');
    const start = song(store.get());
    store.dispatch({ type: 'track.set', track: t, patch: { gain: -6 } }, { by: 'claude' });
    store.dispatch({ type: 'project.set', patch: { tempo: 90 } }, { by: 'you' });
    store.dispatch({ type: 'track.add', track: { name: 'Pad' } }, { by: 'claude' });
    const mid = song(store.get());
    const r = store.revertAuthor('claude');
    assert.deepEqual([r.ok, r.reverted, r.skipped.length], [true, 2, 0]);
    assert.equal(store.track(t).gain, 0);
    assert.equal(store.get().tracks.length, 1);
    assert.equal(store.get().tempo, 90);
    assert.notEqual(song(store.get()), start);
    assert.ok(store.redo().ok);
    assert.equal(song(store.get()), mid);
  });

  test('since: only from that transaction on; one not in the history reverts nothing', () => {
    const store = createStore();
    store.dispatch({ type: 'project.set', patch: { tempo: 90 } }, { by: 'claude' });
    const since = store.dispatch({ type: 'project.set', patch: { title: 'T' } }, { by: 'claude' }).txn.id;
    assert.equal(store.revertAuthor('claude', { since }).reverted, 1);
    assert.equal(store.get().tempo, 90);
    const r = store.revertAuthor('claude', { since: 'x404' });
    assert.equal(r.ok, false);
    assert.equal(r.reverted, 0);
    assert.equal(store.get().tempo, 90);
  });

  test('reports what it had to skip', () => {
    const store = createStore();
    const r = store.dispatch(
      [
        { type: 'track.add', ref: 't', track: { name: 'Bass' } },
        { type: 'clip.add', ref: 'c', track: '$t', clip: { notes: 'C2@0:1' } },
      ],
      { by: 'claude' },
    );
    store.dispatch({ type: 'notes.add', track: r.created.t, clip: r.created.c, notes: 'E2@1:1' }, { by: 'you' });
    const v = store.revertAuthor('claude');
    assert.equal(v.ok, false);
    assert.equal(v.skipped.length, 1);
    assert.equal(store.get().tracks.length, 1);
  });
});

describe('coalesce and join', () => {
  test("a gesture's dispatches with one coalesce key are one undo step", () => {
    const { store, t } = withKeys();
    for (const gain of [-1, -2, -3, -4])
      store.dispatch({ type: 'track.set', track: t, patch: { gain } }, { coalesce: 'gain:' + t });
    assert.equal(store.history.length, 2);
    store.undo();
    assert.equal(store.track(t).gain, 0);
  });

  test('a different author or key starts a new step', () => {
    const { store, t } = withKeys();
    store.dispatch({ type: 'track.set', track: t, patch: { gain: -1 } }, { coalesce: 'k' });
    store.dispatch({ type: 'track.set', track: t, patch: { gain: -2 } }, { coalesce: 'k', by: 'claude' });
    store.dispatch({ type: 'track.set', track: t, patch: { gain: -3 } }, { coalesce: 'other', by: 'claude' });
    assert.equal(store.history.length, 4);
  });

  test('join puts a change into the newest transaction by the same author', () => {
    const store = createStore();
    const a = store.dispatch({ type: 'track.add', ref: 't', track: { name: 'Take' } });
    const j = store.dispatch({ type: 'clip.add', track: a.created.t, clip: { notes: 'C4@0:1' } }, { join: a.txn.id });
    assert.equal(j.txn.id, a.txn.id);
    assert.equal(store.history.length, 1);
    store.undo();
    assert.equal(store.get().tracks.length, 0);
  });

  test('join with another author, or after something else, is its own step', () => {
    const store = createStore();
    const a = store.dispatch({ type: 'track.add', ref: 't', track: { name: 'Take' } });
    store.dispatch({ type: 'project.set', patch: { tempo: 99 } });
    store.dispatch({ type: 'clip.add', track: a.created.t, clip: { notes: 'C4@0:1' } }, { join: a.txn.id });
    assert.equal(store.history.length, 3);
    const b = store.dispatch({ type: 'project.set', patch: { tempo: 98 } }, { by: 'you' });
    store.dispatch({ type: 'project.set', patch: { tempo: 97 } }, { join: b.txn.id, by: 'claude' });
    assert.equal(store.history.length, 5);
  });
});

describe('guard and preview', () => {
  test('a guard holds a change: nothing applied, nothing emitted', () => {
    const store = createStore();
    let n = 0;
    store.on('change', () => n++);
    const seen = [];
    store.guard = (ops, info) => {
      seen.push(info.by);
      return { error: 'wait for a keep', hold: { id: 1 } };
    };
    const r = store.dispatch({ type: 'project.set', patch: { tempo: 70 } }, { by: 'claude' });
    assert.deepEqual([r.ok, r.held, r.error, r.hold], [false, true, 'wait for a keep', { id: 1 }]);
    assert.equal(store.get().tempo, 120);
    assert.equal(n, 0);
    assert.deepEqual(seen, ['claude']);
    assert.ok(store.dispatch({ type: 'project.set', patch: { tempo: 70 } }, { kept: true }).ok, 'kept skips the guard');
    assert.equal(store.get().tempo, 70);
  });

  test('a guard that throws lets the change through', () => {
    const store = createStore();
    const err = console.error;
    console.error = () => {};
    try {
      store.guard = () => {
        throw new Error('bug');
      };
      assert.ok(store.dispatch({ type: 'project.set', patch: { tempo: 70 } }).ok);
    } finally {
      console.error = err;
    }
  });

  test('preview applies outside the history and release takes it back exactly', () => {
    const { store, t } = withKeys();
    const before = song(store.get());
    const h = store.history.length;
    const pv = store.preview([
      { type: 'track.set', track: t, patch: { gain: -12 } },
      { type: 'clip.add', track: t, clip: { start: 8, notes: 'A4@0:1' } },
    ]);
    assert.ok(pv.ok);
    assert.equal(store.track(t).gain, -12);
    assert.equal(store.history.length, h);
    assert.deepEqual(pv.release(), { ok: true, skipped: 0 });
    assert.equal(song(store.get()), before);
    assert.deepEqual(pv.release(), { ok: true, skipped: 0 }, 'a second release is harmless');
  });

  test('a preview that fails changes nothing', () => {
    const store = createStore();
    const pv = store.preview({ type: 'track.set', track: 'nope', patch: {} });
    assert.equal(pv.ok, false);
    pv.release();
  });
});

describe('load', () => {
  test('replaces the song and clears history unless asked to keep it', () => {
    const store = createStore();
    store.dispatch({ type: 'project.set', patch: { tempo: 90 } });
    store.load({ title: 'Other', tempo: 140, tracks: [] });
    assert.equal(store.get().title, 'Other');
    assert.equal(store.canUndo(), false);
    store.dispatch({ type: 'project.set', patch: { tempo: 90 } });
    store.load({ title: 'Third' }, { keepHistory: true });
    assert.ok(store.canUndo());
  });

  test('cleans what it loads', () => {
    const store = createStore({ title: 42, tracks: 'nope', format: 'earworm/0' });
    const p = store.get();
    assert.equal(p.format, 'overdub/0');
    assert.ok(Array.isArray(p.tracks));
    assert.equal(typeof p.title, 'string');
  });
});

describe('authors', () => {
  test("the studio's own, and an id's form fixes its kind", () => {
    const store = createStore();
    assert.deepEqual(store.author('you'), { kind: 'human', name: 'You' });
    assert.equal(store.author('claude').kind, 'agent');
    assert.equal(store.author('overdub').kind, 'house');
    assert.equal(store.author('claude.ai').kind, 'agent');
    assert.deepEqual(store.author('mcp:cursor'), { kind: 'agent', name: 'cursor' });
    assert.equal(store.author('guest:sam-firefox').kind, 'human');
    assert.equal(store.isAgent('mcp:x'), true);
    assert.equal(store.isAgent('you'), false);
  });

  test('a song cannot pass a guest off as an agent, or take a studio name', () => {
    const store = createStore({
      meta: {
        authors: { 'guest:sam-x': { kind: 'agent', name: 'Claude' }, 'guest:ana-y': { kind: 'human', name: 'Ana' } },
      },
    });
    assert.deepEqual(store.author('guest:sam-x'), { kind: 'human', name: 'Guest' });
    assert.deepEqual(store.author('guest:ana-y'), { kind: 'human', name: 'Ana' });
  });

  test("an agent that joins takes its name; a guest can't then go by it", () => {
    const store = createStore({ meta: { authors: { 'guest:z-1': { kind: 'human', name: 'Cursor' } } } });
    assert.equal(store.author('guest:z-1').name, 'Cursor');
    store.addAuthor('mcp:cursor', { kind: 'agent', name: 'Cursor' });
    assert.equal(store.author('mcp:cursor').name, 'Cursor');
    assert.equal(store.author('guest:z-1').name, 'Guest');
  });
});

describe('describe (history labels)', () => {
  test('one op and many', () => {
    assert.equal(label([{ type: 'track.add', track: { name: 'Bass' } }]), 'add track Bass');
    assert.equal(label([{ type: 'notes.remove', ids: ['n1'] }]), 'delete 1 note');
    assert.equal(label([{ type: 'notes.remove', ids: ['n1', 'n2'] }]), 'delete 2 notes');
    assert.equal(label([{ type: 'insert.set', patch: { on: false } }]), 'effect off');
    assert.equal(label([{ type: 'clip.add' }, { type: 'notes.add' }, { type: 'clip.set' }]), '3 changes (clip, notes)');
    assert.equal(label([{ type: 'time.insert' }]), 'time.insert');
  });
});
