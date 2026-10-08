// input/timing.js: forgiving time, against the click (the gentle grid, a steady lean) and in free time (the pulse).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapGentle,
  leanOf,
  placeTake,
  tightness,
  blend,
  findPulse,
  fitHits,
  fitSegs,
} from '../../app/src/input/timing.js';

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

describe('the gentle grid', () => {
  test('near an eighth goes to it; a deliberate sixteenth stays; a hum keeps its timing', () => {
    assert.equal(snapGentle(1.16), 1); // 80 ms late at 120: on the beat
    assert.equal(snapGentle(0.6), 0.5);
    assert.equal(snapGentle(0.75), 0.75); // a sixteenth pickup
    assert.equal(snapGentle(0.2), 0.25); // past the eighth's reach, inside the sixteenth's
    assert.equal(snapGentle(-0.1) + 0, 0); // (-0 here; the same beat)
    assert.ok(Number.isNaN(snapGentle(NaN)));
    // past both: kept, on a 1/64 grid
    assert.equal(snapGentle(0.2, { tol: 0.1, fineTol: 0.05 }), Math.round(0.2 * 64) / 64);
  });
  test('tightness and blend', () => {
    assert.deepEqual(['tight', 'loose', 'played', 'other'].map(tightness), [1, 0.5, 0, 1]);
    assert.equal(blend(1.2, 1, 0), 1.2);
    assert.equal(blend(1.2, 1, 1), 1);
    assert.equal(blend(1.2, 1, 0.5), 1.1);
  });
});

describe('a steady lean', () => {
  const kicks = (off) => [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ p: 36, b: b + off }));
  test('a take late by the same amount every hit comes back onto the beats', () => {
    assert.deepEqual(leanOf(kicks(0.3)), { lean: 0.3, by: 'beat', n: 8 });
    const r = placeTake(kicks(0.3));
    assert.deepEqual(r.t, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(r.lean, 0.3);
  });
  test('rushing is a negative lean', () => {
    assert.equal(leanOf(kicks(-0.2)).lean, -0.2);
  });
  test('small slop is no lean (the gentle grid has it), and too few hits say nothing', () => {
    assert.equal(leanOf(kicks(0.05)).lean, 0);
    assert.deepEqual(
      leanOf([
        { p: 36, b: 0.3 },
        { p: 36, b: 1.3 },
      ]),
      { lean: 0, by: null, n: 2 },
    );
    assert.deepEqual(leanOf([]), { lean: 0, by: null, n: 0 });
  });
  test('hats on the "and"s keep their place while the kick sets the lean', () => {
    const hits = [...kicks(0.15), ...[0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ p: 42, b: b + 0.5 + 0.15 }))];
    const r = placeTake(hits);
    assert.equal(r.by, 'beat');
    assert.deepEqual(r.t.slice(8), [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
  });
});

describe('the pulse in free playing', () => {
  test('steady taps at 100 BPM, anywhere in time, start on the 1', () => {
    const r = findPulse(Array.from({ length: 8 }, (_, i) => 1.3 + i * 0.6));
    assert.equal(r.bpm, 100);
    assert.deepEqual(r.beats, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(r.fit, 1);
    assert.equal(r.drift, 0);
  });
  test('a lone sixteenth between eighths is a half step, not a shift of everything after', () => {
    const r = findPulse([0, 0.5, 1, 1.25, 1.5, 2, 2.5, 3]);
    assert.equal(r.bpm, 120);
    assert.deepEqual(r.beats, [0, 1, 2, 2.5, 3, 4, 5, 6]);
  });
  test('jittered taps still find the tempo (seeded)', () => {
    const rnd = lcg(42);
    const ts = Array.from({ length: 16 }, (_, i) => i * 0.5 + (rnd() - 0.5) * 0.03);
    const r = findPulse(ts);
    assert.ok(Math.abs(r.bpm - 120) <= 3, `bpm ${r.bpm}`);
    assert.deepEqual(
      r.beats.map(Math.round),
      Array.from({ length: 16 }, (_, i) => i),
    );
  });
  test('order does not matter; a flam is one moment; under three moments is no pulse', () => {
    const a = findPulse([0, 0.6, 1.2, 1.8]),
      b = findPulse([1.8, 0, 1.2, 0.6]);
    assert.equal(a.bpm, b.bpm);
    assert.deepEqual(findPulse([0, 0.6, 0.61, 1.2, 1.8]).beats, a.beats);
    assert.equal(findPulse([0, 1]), null);
    assert.equal(findPulse([0, 0.01, 1]), null);
    assert.equal(findPulse([]), null);
  });
  test("fitHits: tapped drums become notes on the player's beats", () => {
    const hits = Array.from({ length: 8 }, (_, i) => ({ t: 0.25 + i * 0.6, p: i % 2 ? 38 : 36, v: 0.8 }));
    const r = fitHits(hits);
    assert.equal(r.bpm, 100);
    assert.equal(r.bars, 2);
    assert.deepEqual(
      r.notes.map((n) => [n.p, n.t]),
      [
        [36, 0],
        [38, 1],
        [36, 2],
        [38, 3],
        [36, 4],
        [38, 5],
        [36, 6],
        [38, 7],
      ],
    );
    assert.equal(fitHits([{ t: 0, p: 36 }]), null);
  });
  test("fitSegs: a hum's notes keep their order and lengths", () => {
    const segs = Array.from({ length: 6 }, (_, i) => ({ t0: i * 0.5, t1: i * 0.5 + 0.4 }));
    const r = fitSegs(segs);
    assert.ok(r);
    for (let i = 1; i < r.starts.length; i++) assert.ok(r.starts[i] > r.starts[i - 1]);
    for (let i = 0; i < r.starts.length; i++) assert.ok(r.ends[i] > r.starts[i]);
  });
});
