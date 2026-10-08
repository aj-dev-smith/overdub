// core/fretboard.js: tunings, places on the neck, fingering and tab text in and out.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUNINGS,
  TUNING_IDS,
  MAX_FRET,
  tuningOf,
  noteAt,
  stringNumber,
  stringIndex,
  positionsOf,
  capoOf,
  placeOk,
  placeNotes,
  fingering,
  handSpan,
  tabText,
  parseTab,
  gridOf,
} from '../../app/src/core/fretboard.js';

// a small seeded generator, so the round trips below are the same every run
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

describe('tunings', () => {
  test('standard is E2 A2 D3 G3 B3 E4, and unknown ids fall back to it', () => {
    assert.deepEqual(TUNINGS.standard.strings, [40, 45, 50, 55, 59, 64]);
    assert.equal(tuningOf('nonsense'), TUNINGS.standard);
    assert.equal(tuningOf(null), TUNINGS.standard);
  });
  test('aliases and spellings', () => {
    assert.equal(tuningOf('Drop D'), TUNINGS['drop-d']);
    assert.equal(tuningOf('dropd'), TUNINGS['drop-d']);
    assert.equal(tuningOf('E-flat'), TUNINGS['half-down']);
    assert.equal(tuningOf('open_g'), TUNINGS['open-g']);
    const custom = { strings: [36, 43, 50] };
    assert.equal(tuningOf(custom), custom);
  });
  test('every tuning has six strings, low to high, and its notes match', () => {
    for (const id of TUNING_IDS) {
      const T = TUNINGS[id];
      assert.equal(T.strings.length, 6, id);
      for (let i = 1; i < 6; i++) assert.ok(T.strings[i] > T.strings[i - 1], id);
      assert.equal(T.notes.split(' ').length, 6, id);
    }
  });
  test('string numbers: 6 is the low E, 1 the high e', () => {
    assert.equal(stringNumber(0), 6);
    assert.equal(stringNumber(5), 1);
    for (let s = 0; s < 6; s++) assert.equal(stringIndex(stringNumber(s)), s);
    assert.equal(noteAt('standard', 1, 5), 50);
  });
});

describe('places', () => {
  test('positionsOf lists every place a pitch plays, each one sounding it', () => {
    const ps = positionsOf('E4', 'standard');
    assert.deepEqual(ps, [
      { s: 1, f: 19 },
      { s: 2, f: 14 },
      { s: 3, f: 9 },
      { s: 4, f: 5 },
      { s: 5, f: 0 },
    ]);
    for (const x of ps) assert.equal(noteAt('standard', x.s, x.f), 64);
    assert.deepEqual(positionsOf(30, 'standard'), []);
    assert.deepEqual(positionsOf('not a note', 'standard'), []);
    assert.deepEqual(positionsOf(64, 'standard', { from: 1, to: 10 }), [
      { s: 3, f: 9 },
      { s: 4, f: 5 },
    ]);
  });
  test('capoOf keeps 1..12 only', () => {
    assert.deepEqual([0, 1, 12, 13, -2, 'x', 2.4].map(capoOf), [0, 1, 12, 0, 0, 0, 2]);
  });
  test('placeOk: the place must play the pitch, on the neck, at or above the capo', () => {
    assert.equal(placeOk({ p: 45, s: 0, f: 5 }, 'standard'), true);
    assert.equal(placeOk({ p: 'A2', s: 1, f: 0 }, 'standard'), true);
    assert.equal(placeOk({ p: 46, s: 0, f: 5 }, 'standard'), false); // moved since
    assert.equal(placeOk({ p: 45, s: 0, f: 5 }, 'drop-d'), false); // tuning changed
    assert.equal(placeOk({ p: 45, s: 1, f: 0 }, 'standard', 2), false); // behind the capo
    assert.equal(placeOk({ p: 45, s: 6, f: 0 }, 'standard'), false);
    assert.equal(placeOk({ p: 45, s: 0.5, f: 5 }, 'standard'), false);
    assert.equal(placeOk(null, 'standard'), false);
  });
  test('handSpan counts fretted notes only', () => {
    assert.equal(handSpan([{ f: 0 }, { f: 3 }, { f: 5 }]), 3);
    assert.equal(handSpan([{ f: 0 }]), 0);
  });
});

describe('fingering and placeNotes', () => {
  test('every placed note plays its pitch, and a line keeps under one hand', () => {
    const line = ['A2', 'C3', 'D3', 'E3', 'G3', 'A3'].map((p, t) => ({ p, t, d: 1 }));
    const r = placeNotes(line);
    assert.ok(!r.error, r.error);
    for (const n of r.notes) assert.equal(noteAt('standard', n.s, n.f), n.p);
    assert.equal(r.shifts, 0);
    assert.ok(handSpan(r.notes) <= 4);
  });
  test('a place that still plays the pitch is kept; one that does not is fingered again', () => {
    const r = placeNotes([
      { p: 64, t: 0, s: 1, f: 19 },
      { p: 65, t: 1, s: 0, f: 0 },
    ]);
    assert.equal(r.notes[0].kept, true);
    assert.deepEqual([r.notes[0].s, r.notes[0].f], [1, 19]);
    assert.equal(r.notes[1].kept, false);
    assert.equal(noteAt('standard', r.notes[1].s, r.notes[1].f), 65);
  });
  test('a capo: frets count from the nut and none fall behind it', () => {
    const r = placeNotes(
      [
        { p: 47, t: 0 },
        { p: 52, t: 1 },
        { p: 54, t: 2 },
      ],
      { capo: 2 },
    );
    for (const n of r.notes) {
      assert.ok(n.f >= 2);
      assert.equal(noteAt('standard', n.s, n.f), n.p);
    }
    assert.ok(r.position >= 2);
  });
  test('a chord goes on different strings', () => {
    const r = fingering(
      [
        { p: 48, t: 0 },
        { p: 52, t: 0 },
        { p: 55, t: 0 },
        { p: 60, t: 0 },
      ],
      'standard',
      { open: -0.2 },
    );
    assert.ok(!r.error);
    assert.equal(new Set(r.notes.map((n) => n.s)).size, 4);
  });
  test('errors say what is wrong', () => {
    const off = placeNotes([{ p: 'C2' }]);
    assert.equal(off.why, 'neck');
    assert.match(off.error, /C2 is off the neck in Standard tuning/);
    assert.match(placeNotes([{ p: 'C2' }], { tuning: 'drop-d' }).error, /off the neck in Drop D/);
    const seven = fingering(
      [60, 61, 62, 63, 64, 65, 66].map((p) => ({ p, t: 0 })),
      'standard',
    );
    assert.equal(seven.why, 'strings');
    assert.match(fingering([{ p: 'H9' }], 'standard').error, /can't read 1 of the notes/);
    assert.deepEqual(fingering([], 'standard').notes, []);
  });
  test('deterministic: the same line fingers the same way twice', () => {
    const line = [52, 55, 57, 59, 62, 64, 67].map((p, t) => ({ p, t }));
    assert.deepEqual(placeNotes(line), placeNotes(line));
  });
});

describe('tab text', () => {
  const pick = (n) => ({ p: n.p, t: n.t, d: n.d, s: n.s, f: n.f });
  test('gridOf picks 16ths, triplets, or falls back to 16ths', () => {
    assert.equal(gridOf([0, 0.25, 0.5]), 0.25);
    assert.equal(gridOf([0, 1 / 3, 2 / 3]), 1 / 3);
    assert.equal(gridOf([0, 0.01]), 0.25);
    assert.equal(gridOf([0, 1], 0.5), 0.5);
  });
  test('a riff reads back exactly, with its tuning, capo and rhythm', () => {
    for (const [tuning, capo] of [
      ['standard', 0],
      ['drop-d', 0],
      ['dadgad', 0],
      ['standard', 2],
      ['open-g', 5],
    ]) {
      const lo = TUNINGS[tuning].strings[0] + capo;
      const line = [0, 3, 5, 7, 10, 12].map((k, i) => ({ p: lo + k, t: i * 0.5, d: 0.5 }));
      const placed = placeNotes(line, { tuning, capo });
      assert.ok(!placed.error, placed.error);
      const text = tabText(placed.notes, { tuning, capo, title: 'Riff', tempo: 98 });
      const back = parseTab(text);
      assert.deepEqual(back.errors, [], `${tuning} capo ${capo}`);
      assert.equal(back.tuning, tuning);
      assert.equal(back.capo, capo);
      assert.equal(back.guessed, false);
      assert.deepEqual(back.notes.map(pick), placed.notes.map(pick), `${tuning} capo ${capo}`);
    }
  });
  test('round trip over seeded random lines on the 16th grid, across bars', () => {
    const rnd = lcg(7);
    for (let k = 0; k < 25; k++) {
      const notes = [];
      let t = 0;
      while (notes.length < 12) {
        const d = 0.25 * (1 + Math.floor(rnd() * 4));
        notes.push({ p: 45 + Math.floor(rnd() * 20), t, d });
        t += d + 0.25 * Math.floor(rnd() * 2);
      }
      const placed = placeNotes(notes);
      if (placed.error) continue;
      const back = parseTab(tabText(placed.notes));
      assert.deepEqual(back.errors, []);
      assert.deepEqual(back.notes.map(pick), placed.notes.map(pick), `case ${k}`);
    }
  });
  test('tab with no = rings each note to the next, and says it is a guess', () => {
    const r = parseTab('e|-----|\nB|-----|\nG|-----|\nD|-----|\nA|0-2-|\nE|-----|');
    assert.equal(r.guessed, true);
    assert.deepEqual(
      r.notes.map((n) => [n.p, n.s, n.f]),
      [
        [45, 1, 0],
        [47, 1, 2],
      ],
    );
    assert.ok(r.warnings.some((w) => /guess/.test(w)));
  });
  test('text that is not tab says what tab looks like', () => {
    const r = parseTab('hello');
    assert.deepEqual(r.notes, []);
    assert.match(r.errors[0], /no lines of tab/);
    assert.equal(parseTab('').notes.length, 0);
  });
  test('MAX_FRET bounds the neck', () => {
    assert.equal(placeOk({ p: 40 + MAX_FRET, s: 0, f: MAX_FRET }, 'standard'), true);
    assert.equal(placeOk({ p: 40 + MAX_FRET + 1, s: 0, f: MAX_FRET + 1 }, 'standard'), false);
  });
});
