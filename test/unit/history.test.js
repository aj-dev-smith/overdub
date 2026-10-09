// agent/history.js noteShares: who wrote the notes, as History's strip of tape shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteShares } from '../../app/src/agent/history.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';

const notes = (n, by) => Array.from({ length: n }, (_, i) => ({ p: 60, t: i, d: 1, ...(by ? { by } : {}) }));
function song(clips) {
  const s = createStore(createProject());
  const r = s.dispatch({ type: 'track.add', track: { name: 'Keys', clips } });
  assert.equal(r.ok, true);
  return s;
}
const author = (s) => (by) => s.author(by);

test('an empty song: you, at 0%', () => {
  const s = createStore(createProject());
  assert.deepEqual(noteShares(s.get(), author(s)), {
    total: 0,
    parts: [{ by: 'you', kind: 'human', name: s.author('you').name, n: 0, pct: 0 }],
  });
});

test('people first (you leading), then agents by count, then the house as one share', () => {
  const s = song([
    {
      start: 0,
      length: 16,
      by: 'you',
      notes: [
        ...notes(2, 'you'),
        ...notes(5, 'claude'),
        ...notes(1, 'mcp:cursor'),
        ...notes(3, 'overdub'),
        ...notes(1, 'guest:ann-chrome'),
      ],
    },
  ]);
  const { total, parts } = noteShares(s.get(), author(s));
  assert.equal(total, 12);
  assert.deepEqual(
    parts.map((p) => [p.by, p.kind, p.n]),
    [
      ['you', 'human', 2],
      ['guest:ann-chrome', 'human', 1],
      ['claude', 'agent', 5],
      ['mcp:cursor', 'agent', 1],
      ['overdub', 'house', 3],
    ],
  );
  assert.equal(parts.find((p) => p.kind === 'house').name, 'Overdub');
  assert.equal(parts.find((p) => p.by === 'claude').pct, 42);
});

test("a note without its own author counts as its clip's", () => {
  const s = song([{ start: 0, length: 4, by: 'claude', notes: notes(4) }]);
  const { parts } = noteShares(s.get(), author(s));
  // (the store signs notes it reads with their clip's author)
  assert.equal(parts.find((p) => p.by === 'claude').n, 4);
  const raw = { tracks: [{ clips: [{ by: 'claude', notes: [{ p: 60 }, { p: 62 }] }, { notes: [{ p: 64 }] }] }] };
  const r = noteShares(raw, author(s));
  assert.deepEqual(
    r.parts.map((p) => [p.by, p.n, p.pct]),
    [
      ['you', 1, 33],
      ['claude', 2, 67],
    ],
  );
});

test('you are always listed, even with none of the notes', () => {
  const s = song([{ start: 0, length: 4, by: 'claude', notes: notes(3, 'claude') }]);
  const { parts } = noteShares(s.get(), author(s));
  assert.deepEqual(
    parts.map((p) => [p.by, p.n, p.pct]),
    [
      ['you', 0, 0],
      ['claude', 3, 100],
    ],
  );
});

test('a song with no tracks or clips reads as empty', () => {
  const s = createStore(createProject());
  assert.equal(noteShares({}, author(s)).total, 0);
  assert.equal(noteShares({ tracks: [{}] }, author(s)).total, 0);
});
