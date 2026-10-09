// core/transforms.js: the note transforms behind the piano roll and the agent's `transform` tool.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSFORMS,
  transform,
  planTransform,
  findTransform,
  readParams,
  diffOps,
  rng,
  onsets,
  guessKey,
  labelFor,
  catalog,
  isDrumDevice,
} from '../../app/src/core/transforms.js';
import { parseNotes, inScale } from '../../app/src/core/music.js';

const C_MAJOR = { root: 'C', scale: 'major' };
const ctx = { key: C_MAJOR, meter: [4, 4], tempo: 120 };
const withIds = (ns) => ns.map((n, i) => ({ ...n, id: 'n' + (i + 1) }));
// a C chord, a melody, and a gap: something every transform can work on
const CHORDS = withIds(parseNotes('C4@0:2 E4@0:2 G4@0:2 F4@2:2 A4@2:2 C5@2:2'));
const MELODY = withIds(parseNotes('C4@0:0.5 D4@0.5:0.5 E4@1:0.5 G4@1.5:0.5 A4@2:1 G4@3:1 E4@6:1 D4@7:1'));
const byTime = (a, b) => a.t - b.t || a.p - b.p;
const strip = (ns) => ns.map(({ p, t, d, v }) => ({ p, t, d, v })).sort(byTime);

describe('the catalog', () => {
  test('every transform has a unique name, a label, a group, params and a describe', () => {
    const names = TRANSFORMS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    for (const t of TRANSFORMS) {
      assert.equal(typeof t.label, 'string');
      assert.ok(['Feel', 'Pitch', 'Write'].includes(t.group), t.name);
      assert.equal(typeof t.run, 'function');
      assert.equal(typeof t.describe(readParams(t, {})), 'string');
    }
    assert.equal(catalog().split('\n').length, TRANSFORMS.length);
  });
  test('findTransform takes names, aliases, case and dashes', () => {
    assert.equal(findTransform('humanize').name, 'humanize');
    assert.equal(findTransform('Humanise').name, 'humanize');
    assert.equal(findTransform('arp').name, 'arpeggiate');
    assert.equal(findTransform('fill-the gap').name, 'fill_the_gap');
    assert.equal(findTransform('reverse').name, 'retrograde');
    assert.equal(findTransform('nope'), null);
    assert.equal(findTransform(undefined), null);
  });
  test('readParams clamps numbers, checks options, reads booleans and drops unknown keys', () => {
    const q = findTransform('quantize');
    assert.deepEqual(readParams(q, { grid: 100, strength: -1, junk: 1 }), { grid: 4, strength: 0, swing: 0 });
    assert.deepEqual(readParams(q, { grid: 'x' }), { grid: 0.25, strength: 1, swing: 0 });
    const s = findTransform('strum');
    assert.equal(readParams(s, { direction: 'sideways' }).direction, 'up');
    assert.equal(readParams(s, { direction: 'down' }).direction, 'down');
    const h = findTransform('humanize');
    assert.equal(readParams(h, { timing: 'true' }).timing, true);
    assert.equal(readParams(h, { timing: 'no' }).timing, false);
    assert.equal(readParams(h, { seed: 'abc' }).seed, 'abc');
  });
  test('labelFor makes a short History label', () => {
    assert.equal(labelFor('strum', { direction: 'up', ms: 30 }, 'Keys'), 'strum up · 30 ms · Keys');
    assert.equal(labelFor('nope', {}), 'nope');
    assert.ok(labelFor('humanize', {}, 'x'.repeat(200)).length <= 80);
  });
  test('isDrumDevice', () => {
    assert.ok(isDrumDevice('core.drums'));
    assert.ok(isDrumDevice('core.drumroom'));
    assert.ok(!isDrumDevice('core.poly'));
    assert.ok(!isDrumDevice(undefined));
  });
});

describe('helpers', () => {
  test('rng is deterministic per seed, in [0, 1), and seeds differ', () => {
    const a = rng(7),
      b = rng(7),
      c = rng(8),
      s = rng('seven'),
      s2 = rng('seven');
    const xa = Array.from({ length: 50 }, a),
      xb = Array.from({ length: 50 }, b),
      xc = Array.from({ length: 50 }, c);
    assert.deepEqual(xa, xb);
    assert.notDeepEqual(xa, xc);
    assert.ok(xa.every((x) => x >= 0 && x < 1));
    assert.deepEqual(Array.from({ length: 10 }, s), Array.from({ length: 10 }, s2));
  });
  test('onsets groups notes that start together into chords', () => {
    const g = onsets(CHORDS);
    assert.equal(g.length, 2);
    assert.deepEqual(
      g.map((x) => [x.t, x.notes.length, x.low, x.top, x.end]),
      [
        [0, 3, 60, 67, 2],
        [2, 3, 65, 72, 4],
      ],
    );
    assert.equal(
      onsets([
        { p: 60, t: 0, d: 1 },
        { p: 64, t: 0.02, d: 1 },
      ]).length,
      1,
    );
  });
  test('guessKey', () => {
    assert.deepEqual(guessKey(parseNotes('A3@0:1 C4@1:1 E4@2:1 A3@3:2')), { root: 'A', scale: 'minor' });
    assert.deepEqual(guessKey(parseNotes('C4@0:1 E4@1:1 G4@2:1 C5@3:2')), { root: 'C', scale: 'major' });
    assert.deepEqual(guessKey([]), { root: 'C', scale: 'major' });
  });
});

describe('every transform', () => {
  for (const t of TRANSFORMS) {
    test(`${t.name}: valid notes, deterministic, input untouched`, () => {
      const input =
        t.name === 'strum' ||
        t.name === 'arpeggiate' ||
        t.name === 'chords_from_melody' ||
        t.name === 'melody_from_chords'
          ? CHORDS
          : MELODY;
      const before = structuredClone(input);
      const a = transform(t.name, input, { seed: 3 }, ctx);
      const b = transform(t.name, input, { seed: 3 }, ctx);
      assert.deepEqual(input, before, 'the input is not mutated');
      assert.deepEqual(a.notes, b.notes, 'the same seed gives the same notes');
      assert.equal(typeof a.summary, 'string');
      assert.ok(a.notes.length > 0);
      for (const n of a.notes) {
        assert.ok(Number.isInteger(n.p) && n.p >= 0 && n.p <= 127, `pitch ${n.p}`);
        assert.ok(n.t >= 0 && n.d > 0 && n.v > 0 && n.v <= 1, JSON.stringify(n));
      }
      const ids = a.notes.filter((n) => n.id).map((n) => n.id);
      assert.equal(new Set(ids).size, ids.length, 'an id is kept at most once');
      assert.ok(
        ids.every((id) => input.some((n) => n.id === id)),
        'no invented ids',
      );
    });
  }
});

describe('feel', () => {
  test('humanize moves notes a little, by seed; amount 0 moves nothing much on the beat', () => {
    const a = transform('humanize', MELODY, { seed: 1 }, ctx).notes;
    const c = transform('humanize', MELODY, { seed: 2 }, ctx).notes;
    assert.notDeepEqual(a, c);
    const maxB = ((4 + 22 * 0.35) * 120) / 60000;
    for (const n of a) {
      const o = MELODY.find((x) => x.id === n.id);
      assert.ok(Math.abs(n.t - o.t) <= maxB * 1.25 + 1e-4, `${n.t} vs ${o.t}`);
      assert.equal(n.p, o.p);
    }
    const off = transform('humanize', MELODY, { timing: false, velocity: false }, ctx).notes;
    assert.deepEqual(strip(off), strip(MELODY));
  });
  test('quantize pulls to the grid; strength 0 leaves notes alone', () => {
    const loose = withIds(parseNotes('C4@0.07:0.5 D4@0.98:0.5 E4@2.13:0.5'));
    const q = transform('quantize', loose, { grid: 0.5 }, ctx).notes;
    assert.deepEqual(
      q.map((n) => n.t),
      [0, 1, 2],
    );
    assert.deepEqual(
      transform('quantize', loose, { strength: 0 }, ctx).notes.map((n) => n.t),
      loose.map((n) => n.t),
    );
  });
  test('strum spreads each chord low to high (up) and keeps note ends', () => {
    const r = transform('strum', CHORDS, { direction: 'up', ms: 50 }, ctx).notes;
    const first = r.filter((n) => n.t < 1).sort((a, b) => a.p - b.p);
    assert.deepEqual(
      first.map((n) => n.t),
      [0, 0.1, 0.2],
    ); // 50 ms at 120 BPM is 0.1 beat
    for (const n of first) assert.ok(Math.abs(n.t + n.d - 2) < 1e-3);
    const down = transform('strum', CHORDS, { direction: 'down', ms: 50 }, ctx)
      .notes.filter((n) => n.t < 1)
      .sort((a, b) => a.t - b.t);
    assert.deepEqual(
      down.map((n) => n.p),
      [67, 64, 60],
    );
  });
  test('strum and arpeggiate refuse a line with no chords, with a hint', () => {
    for (const name of ['strum', 'arpeggiate']) {
      assert.throws(
        () => transform(name, MELODY, {}, ctx),
        (e) => /no chords/.test(e.message) && !!e.hint && e.transform === true,
      );
    }
  });
  test('arpeggiate plays the chord one note at a time at the rate, over the chord', () => {
    const r = transform('arpeggiate', CHORDS.slice(0, 3), { pattern: 'up', rate: 0.5 }, ctx).notes;
    assert.deepEqual(
      r.map((n) => n.p),
      [60, 64, 67, 60],
    );
    assert.deepEqual(
      r.map((n) => n.t),
      [0, 0.5, 1, 1.5],
    );
    const down = transform('arpeggiate', CHORDS.slice(0, 3), { pattern: 'down', rate: 0.5 }, ctx).notes;
    assert.deepEqual(
      down.map((n) => n.p),
      [67, 64, 60, 67],
    );
  });
  test('legato stretches to the next onset; the last keeps its length', () => {
    const ns = withIds(parseNotes('C4@0:0.25 D4@1:0.25 E4@3:0.5'));
    assert.deepEqual(
      transform('legato', ns, {}, ctx).notes.map((n) => n.d),
      [1, 2, 0.5],
    );
  });
  test('staccato shortens by the fraction, never below 1/32', () => {
    const r = transform('staccato', MELODY, { length: 0.5 }, ctx).notes;
    assert.deepEqual(
      r.map((n) => n.d),
      MELODY.map((n) => n.d / 2),
    );
    const tiny = transform('staccato', withIds(parseNotes('C4@0:0.0625')), { length: 0.05 }, ctx).notes;
    assert.equal(tiny[0].d, 0.0313);
  });
});

describe('pitch', () => {
  test('transpose in key keeps every note in key and comes back exactly', () => {
    const up = transform('transpose', MELODY, { steps: 2 }, ctx).notes;
    assert.deepEqual(
      up.map((n) => n.p),
      [64, 65, 67, 71, 72, 71, 67, 65],
    );
    assert.ok(up.every((n) => inScale(n.p, C_MAJOR)));
    const back = transform('transpose', up, { steps: -2 }, ctx).notes;
    assert.deepEqual(
      back.map((n) => n.p),
      MELODY.map((n) => n.p),
    );
    assert.deepEqual(
      transform('transpose', MELODY, { steps: 7 }, ctx).notes.map((n) => n.p),
      MELODY.map((n) => n.p + 12),
    );
  });
  test('transpose stays on the keyboard', () => {
    const r = transform('transpose', withIds(parseNotes('120@0:1')), { steps: 21 }, ctx).notes;
    assert.ok(r[0].p <= 127);
  });
  test('invert mirrors around the first note in key, and twice is the original', () => {
    const inv = transform('invert', MELODY, {}, ctx).notes;
    assert.equal(inv[0].p, 60);
    assert.equal(inv[1].p, 59); // D (a step up) -> B (a step down)
    assert.ok(inv.every((n) => inScale(n.p, C_MAJOR)));
    const twice = transform('invert', inv, { pitch: 60 }, ctx).notes;
    assert.deepEqual(
      twice.map((n) => n.p),
      MELODY.map((n) => n.p),
    );
  });
  test('retrograde in time reverses the timing within the span, and twice is the original', () => {
    const r = transform('retrograde', MELODY, {}, ctx).notes;
    const span0 = Math.min(...MELODY.map((n) => n.t)),
      span1 = Math.max(...MELODY.map((n) => n.t + n.d));
    for (const n of r) {
      const o = MELODY.find((x) => x.id === n.id);
      assert.equal(n.t, span0 + span1 - (o.t + o.d));
    }
    assert.deepEqual(strip(transform('retrograde', r, {}, ctx).notes), strip(MELODY));
  });
  test('retrograde of pitches keeps the rhythm and refuses on drums', () => {
    const r = transform('retrograde', MELODY, { mode: 'pitches' }, ctx).notes;
    assert.deepEqual(
      r.map((n) => n.t),
      MELODY.map((n) => n.t),
    );
    assert.deepEqual(
      r.map((n) => n.p),
      MELODY.map((n) => n.p).reverse(),
    );
    assert.throws(() => transform('retrograde', MELODY, { mode: 'pitches' }, { ...ctx, drums: true }), /drums/);
  });
  test('double adds a softer octave copy and refuses when everything is doubled', () => {
    const r = transform('double', MELODY, { octave: 1 }, ctx);
    assert.equal(r.notes.length, MELODY.length * 2);
    const added = r.notes.filter((n) => !n.id);
    assert.deepEqual(added.map((n) => n.p).sort(), MELODY.map((n) => n.p + 12).sort());
    assert.ok(added.every((n) => n.v < 0.8));
    const octaves = withIds(parseNotes('C4@0:1 C5@0:1'));
    assert.deepEqual(
      transform('double', octaves, { octave: 1 }, ctx)
        .notes.filter((n) => !n.id)
        .map((n) => n.p),
      [84],
    ); // C5 is there already
    assert.throws(() => transform('double', withIds(parseNotes('120@0:1')), { octave: 1 }, ctx), /nothing to double/);
  });
  test('thin keeps every Nth onset and by velocity, never nothing', () => {
    assert.equal(transform('thin', MELODY, { every: 2 }, ctx).notes.length, 4);
    const soft = withIds(parseNotes('C4@0:1*0.3 D4@1:1*0.9 E4@2:1*0.2'));
    assert.deepEqual(
      transform('thin', soft, { every: 1, below: 0.5 }, ctx).notes.map((n) => n.p),
      [62],
    );
    // nothing that loud: the first onset's loudest note stays
    assert.deepEqual(
      transform('thin', soft, { every: 1, below: 0.95 }, ctx).notes.map((n) => n.p),
      [60],
    );
    assert.throws(() => transform('thin', withIds(parseNotes('C4@0:1')), { every: 2 }, ctx), /nothing to thin/);
  });
});

describe('write', () => {
  test('chords_from_melody adds in-key notes and keeps the melody', () => {
    const r = transform('chords_from_melody', MELODY, {}, ctx);
    for (const n of MELODY) assert.ok(r.notes.some((x) => x.id === n.id && x.p === n.p && x.t === n.t));
    const added = r.notes.filter((n) => !n.id);
    assert.ok(added.length > 0);
    assert.ok(added.every((n) => inScale(n.p, C_MAJOR)));
  });
  test('fill_the_gap needs a gap', () => {
    assert.throws(() => transform('fill_the_gap', CHORDS.slice(0, 3), {}, ctx), /gap/);
    const r = transform('fill_the_gap', MELODY, {}, ctx);
    assert.ok(
      r.notes.some((n) => !n.id && n.t >= 4 && n.t < 6),
      'adds notes in the gap between beats 4 and 6',
    );
  });
  test('continue writes past the phrase, and differs by seed', () => {
    const a = transform('continue', MELODY.slice(0, 6), { seed: 1 }, ctx).notes;
    const b = transform('continue', MELODY.slice(0, 6), { seed: 99 }, ctx).notes;
    assert.ok(a.some((n) => !n.id && n.t >= 4));
    assert.notDeepEqual(strip(a), strip(b));
  });
});

describe('transform errors', () => {
  test('unknown name, no notes, pitched transform on drums', () => {
    assert.throws(
      () => transform('nope', MELODY),
      (e) => /no transform "nope"/.test(e.message) && /humanize/.test(e.hint),
    );
    assert.throws(() => transform('quantize', []), /no notes/);
    assert.throws(() => transform('transpose', MELODY, {}, { drums: true }), /pitched parts/);
    assert.doesNotThrow(() => transform('quantize', MELODY, {}, { drums: true }));
  });
});

describe('diffOps and planTransform', () => {
  test('diffOps: removes, edits by id and adds', () => {
    const before = withIds(parseNotes('C4@0:1 D4@1:1 E4@2:1'));
    const after = [{ ...before[0] }, { ...before[1], p: 65 }, { p: 70, t: 3, d: 1, v: 0.8 }];
    const d = diffOps('t1', 'c1', before, after);
    assert.deepEqual(d.ops, [
      { type: 'notes.remove', track: 't1', clip: 'c1', ids: ['n3'] },
      { type: 'notes.set', track: 't1', clip: 'c1', notes: [{ id: 'n2', p: 65 }] },
      { type: 'notes.add', track: 't1', clip: 'c1', notes: [{ p: 70, t: 3, d: 1, v: 0.8 }] },
    ]);
    assert.deepEqual(
      diffOps(
        't1',
        'c1',
        before,
        before.map((n) => ({ ...n })),
      ).ops,
      [],
    );
  });
  test('diffOps: an id given twice is an edit once and an add after', () => {
    const before = withIds(parseNotes('C4@0:1'));
    const d = diffOps('t', 'c', before, [{ ...before[0] }, { ...before[0], t: 2 }]);
    assert.equal(d.added.length, 1);
    assert.deepEqual(d.removed, []);
  });
  test('planTransform on a selection leaves the rest alone', () => {
    const plan = planTransform('transpose', MELODY, {
      ids: ['n1', 'n2'],
      params: { steps: 1 },
      key: C_MAJOR,
      track: 't',
      clip: 'c',
      length: 8,
    });
    assert.equal(plan.scope, 'selection');
    assert.equal(plan.changed, 2);
    assert.deepEqual(plan.changedIds.sort(), ['n1', 'n2']);
    assert.equal(plan.ops.length, 1);
    assert.equal(plan.ops[0].type, 'notes.set');
    assert.equal(plan.notes.length, MELODY.length);
  });
  test('planTransform grows the clip to whole bars when the result runs past its end', () => {
    const plan = planTransform('legato', withIds(parseNotes('C4@0:1 D4@6:4')), {
      key: C_MAJOR,
      meter: [4, 4],
      track: 't',
      clip: 'c',
      length: 8,
      params: { overlap: 0.5 },
    });
    assert.ok(!plan.error, plan.error);
    // D4 at 6 for 4 already runs to 10: the clip grows to 12
    assert.deepEqual(plan.ops[0], { type: 'clip.set', track: 't', clip: 'c', patch: { length: 12 } });
    assert.equal(plan.length, 12);
  });
  test('planTransform reports errors as data, and a no-op as nothing', () => {
    assert.deepEqual(Object.keys(planTransform('nope', MELODY)).sort(), ['error', 'hint']);
    const strum = planTransform('strum', MELODY, { key: C_MAJOR });
    assert.match(strum.error, /no chords/);
    const same = planTransform('quantize', withIds(parseNotes('C4@0:1 D4@1:1')), { key: C_MAJOR });
    assert.equal(same.nothing, true);
  });
});
