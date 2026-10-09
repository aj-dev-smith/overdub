// Build a band (core/arrange.js): a seeded, deterministic arranger around a seed clip.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrangeAround,
  planArrangement,
  checkArrangement,
  balanceGains,
  findStyle,
  harmonyKeyOf,
  strongTimes,
  strongOffsets,
  voice,
  nearestPitch,
  seedKind,
  STYLES,
  STYLE_IDS,
  PARTS,
  MAX_BEATS,
} from '../../app/src/core/arrange.js';
import { parseNotes, scalePcs } from '../../app/src/core/music.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';

const C_MAJOR = { root: 'C', scale: 'major' };
// Four bars of a plain diatonic tune in C major.
const TUNE = parseNotes('C4@0:1 E4@1:1 G4@2:2 F4@4:1 A4@5:1 G4@6:2 E4@8:1 D4@9:1 C4@10:2 D4@12:2 C4@14:2');
const build = (o = {}) =>
  arrangeAround({ notes: TUNE, start: 0, length: 16, key: C_MAJOR, meter: [4, 4], tempo: 110, ...o });

describe('arrangeAround', () => {
  test('the same seed gives the same band; another seed can differ', () => {
    for (const style of STYLE_IDS) {
      const a = build({ style, seed: 7, parts: PARTS }),
        b = build({ style, seed: 7, parts: PARTS });
      assert.deepEqual(a, b, style);
    }
    const a = build({ seed: 1 }),
      c = build({ seed: 2 });
    assert.notDeepEqual(a.parts.drums, c.parts.drums, 'velocities and ghosts come from the seed');
  });

  test('a diatonic tune gets a band in key, with nothing rubbing on the strong beats, in every style', () => {
    for (const style of STYLE_IDS) {
      const r = build({ style, parts: PARTS });
      assert.equal(r.error, undefined, style);
      assert.deepEqual(r.check.outOfKey, [], `${style}: out of key`);
      assert.deepEqual(r.check.clashes, [], `${style}: clashes`);
      assert.deepEqual(r.check.roots, [], `${style}: bass off the root`);
      assert.deepEqual(r.check.offGrid, [], `${style}: drums off the grid`);
    }
  });

  test('every note sits inside the clip, well formed and sorted; the bass and chords in their registers', () => {
    for (const style of STYLE_IDS) {
      const r = build({ style, parts: PARTS });
      const S = STYLES[style];
      for (const [part, notes] of Object.entries(r.parts)) {
        assert.ok(notes.length > 0, `${style} ${part} has notes`);
        for (const n of notes) {
          assert.ok(n.t >= 0 && n.t < 16 && n.t + n.d <= 16 + 1e-9, `${style} ${part} note in the clip`);
          assert.ok(n.d > 0 && n.v >= 0.05 && n.v <= 1 && Number.isInteger(n.p));
        }
        for (let i = 1; i < notes.length; i++) assert.ok(notes[i - 1].t <= notes[i].t);
      }
      const [blo, bhi] = S.bass.range;
      // (the range is where roots sit: an octave jump may reach a fifth past its top, a walk-in a step past either end)
      for (const n of r.parts.bass)
        assert.ok(n.p >= blo - 2 && n.p <= bhi + 7, `${style} bass ${n.p} near ${blo}-${bhi}`);
      assert.ok(
        r.parts.bass.filter((n) => n.p >= blo && n.p <= bhi).length >= r.parts.bass.length / 2,
        `${style}: most of the bass in its range`,
      );
      const [clo, chi] = S.chords.register;
      for (const n of r.parts.chords)
        assert.ok(n.p >= clo && n.p <= chi, `${style} chord tone ${n.p} in ${clo}-${chi}`);
    }
  });

  test('it never touches the seed notes it is given', () => {
    const notes = TUNE.map((n) => ({ ...n }));
    const before = JSON.stringify(notes);
    arrangeAround({ notes, length: 16, key: C_MAJOR });
    assert.equal(JSON.stringify(notes), before);
  });

  test('parts: default chords, bass and drums; aliases; unknown words fall back to the default', () => {
    assert.deepEqual(build().made, ['chords', 'bass', 'drums']);
    assert.deepEqual(build({ parts: 'keys, groove' }).made, ['chords', 'drums']);
    assert.deepEqual(build({ parts: ['strings'] }).made, ['pad']);
    assert.deepEqual(build({ parts: 'kazoo' }).made, ['chords', 'bass', 'drums']);
  });

  test('a beat seeds the harmony from the style and skips the drums; a chord seed skips the chords', () => {
    const beat = parseNotes('36@0:0.25 42@0.5:0.25 38@1:0.25 42@1.5:0.25 36@2:0.25 38@3:0.25');
    const d = arrangeAround({ notes: beat, length: 4, key: C_MAJOR, drums: true });
    assert.equal(d.kind, 'drums');
    assert.deepEqual(d.skipped, [{ part: 'drums', why: 'the seed is the beat' }]);
    assert.ok(d.parts.bass.length && !d.parts.drums);
    const chords = parseNotes('C4@0:2 E4@0:2 G4@0:2 F4@2:2 A4@2:2 C5@2:2');
    const c = arrangeAround({ notes: chords, length: 4, key: C_MAJOR });
    assert.equal(c.kind, 'chords');
    assert.deepEqual(c.skipped, [{ part: 'chords', why: 'the seed is the chords' }]);
    assert.equal(seedKind(TUNE), 'melody');
    assert.equal(seedKind(TUNE, true), 'drums');
  });

  test('a fill every 4th bar, none under 4 bars', () => {
    assert.deepEqual(build().fills, [4]);
    assert.deepEqual(arrangeAround({ notes: TUNE.slice(0, 3), length: 8, key: C_MAJOR }).fills, []);
  });

  test('refuses nothing to build on, and a clip too long to build over, saying what to do', () => {
    const empty = arrangeAround({ notes: [], length: 8, key: C_MAJOR });
    assert.match(empty.error, /no notes/);
    assert.ok(empty.hint);
    const long = arrangeAround({ notes: TUNE, length: MAX_BEATS + 4, key: C_MAJOR });
    assert.match(long.error, /up to 256 bars/);
    assert.ok(long.hint);
  });

  test('works in 3/4 and 6/8, and guesses a key when none is given', () => {
    for (const meter of [
      [3, 4],
      [6, 8],
    ]) {
      const r = arrangeAround({ notes: TUNE, length: 12, meter, key: C_MAJOR });
      assert.equal(r.error, undefined);
      assert.deepEqual(r.check.outOfKey, []);
    }
    const g = arrangeAround({ notes: TUNE, length: 16 });
    assert.ok(g.key && g.key.root && g.key.scale);
  });
});

describe('time and harmony helpers', () => {
  test('strong beats by meter', () => {
    assert.deepEqual(strongOffsets([4, 4]), [0, 2]);
    assert.deepEqual(strongOffsets([3, 4]), [0]);
    assert.deepEqual(strongOffsets([6, 8]), [0, 1.5]);
    assert.deepEqual(strongTimes({ start: 0, length: 8 }), [0, 2, 4, 6]);
    assert.deepEqual(strongTimes({ start: 1, length: 4 }), [1, 3], 'in clip time, from a clip that starts off the bar');
  });

  test('harmonyKeyOf: seven-note scales stand; others borrow their parent major or minor', () => {
    assert.deepEqual(harmonyKeyOf({ root: 'D', scale: 'dorian' }), { root: 'D', scale: 'dorian' });
    assert.deepEqual(harmonyKeyOf({ root: 'A', scale: 'minorPentatonic' }).scale, 'minor');
    assert.deepEqual(harmonyKeyOf({ root: 'G', scale: 'majorPentatonic' }).scale, 'major');
    assert.deepEqual(harmonyKeyOf({ root: 'E', scale: 'blues' }).scale, 'minor');
  });

  test("voice: the chord's pitch classes, in range, moving little from the last voicing", () => {
    const v = voice([0, 4, 7], [52, 71], null);
    assert.deepEqual(v.map((p) => p % 12).sort(), [0, 4, 7]);
    assert.ok(v.every((p) => p >= 52 && p <= 71));
    const next = voice([5, 9, 0], [52, 71], v);
    const moved = next.reduce((s, p) => s + Math.min(...v.map((q) => Math.abs(p - q))), 0);
    assert.ok(moved <= 4, `C to F moves ${moved} semitones in all`);
    assert.equal(nearestPitch(7, 60, 31, 47), 43);
  });

  test('findStyle takes ids and the usual words', () => {
    assert.equal(findStyle('Pop'), 'pop');
    assert.equal(findStyle('lo-fi'), 'lofi');
    assert.equal(findStyle('EDM'), 'house');
    assert.equal(findStyle('polka'), null);
  });

  test('checkArrangement finds a semitone rub on a strong beat and a note out of key', () => {
    const seed = parseNotes('E4@0:2');
    const r = checkArrangement(
      seed,
      { chords: parseNotes('F4@0:2'), pad: parseNotes('C#4@2:2') },
      { key: C_MAJOR, length: 4 },
    );
    assert.equal(r.ok, false);
    assert.equal(r.clashes.length, 1);
    assert.equal(r.outOfKey.length, 1);
    assert.ok(scalePcs(C_MAJOR).includes(5));
  });

  test('balanceGains puts each part its level under the seed', () => {
    const g = balanceGains({
      style: 'pop',
      seedLufs: -14,
      parts: { bass: { gain: -10, lufs: -20 }, drums: { gain: 0, lufs: -80 } },
    });
    assert.deepEqual(g, { bass: -8 }); // -10 + (-14 - 4) - (-20)
    assert.deepEqual(balanceGains({ style: 'pop', seedLufs: -90, parts: { bass: { gain: 0, lufs: -20 } } }), {});
  });
});

describe('planArrangement', () => {
  function seedSong() {
    const store = createStore(createProject({ key: C_MAJOR }));
    const r = store.dispatch([
      { type: 'track.add', ref: 'v', track: { name: 'Vocal', instrument: { device: 'core.poly' } } },
      { type: 'clip.add', ref: 'c', track: '$v', clip: { start: 8, length: 16, notes: TUNE } },
      { type: 'track.add', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
    ]);
    assert.equal(r.ok, true, r.error);
    return { store, ids: r.created };
  }

  test('one dispatch adds a named track and clip per part after the seed, and one undo takes them all back', () => {
    const { store, ids } = seedSong();
    const before = JSON.stringify(store.get().tracks);
    const plan = planArrangement(store.get(), { track: ids.v, clip: ids.c, style: 'rock', parts: PARTS, seed: 3 });
    assert.equal(plan.error, undefined);
    const r = store.dispatch(plan.ops, { by: 'overdub' });
    assert.equal(r.ok, true, r.error);
    const names = store.get().tracks.map((t) => t.name);
    assert.deepEqual(names, ['Vocal', ...plan.tracks.map((t) => t.name), 'Bass']);
    assert.ok(names.includes('Bass 2'), 'a taken name gets the next number');
    for (const t of store.get().tracks.slice(1, -1)) {
      assert.equal(t.clips.length, 1);
      assert.equal(t.clips[0].start, 8);
      assert.equal(t.clips[0].length, 16);
    }
    assert.equal(JSON.stringify(store.get().tracks[0]), JSON.stringify(JSON.parse(before)[0]), 'the seed is untouched');
    assert.equal(store.undo().ok, true);
    assert.equal(JSON.stringify(store.get().tracks), before);
  });

  test('is deterministic for a seed', () => {
    const { store, ids } = seedSong();
    const a = planArrangement(store.get(), { track: ids.v, clip: ids.c, seed: 5 });
    const b = planArrangement(store.get(), { track: ids.v, clip: ids.c, seed: 5 });
    assert.deepEqual(a.ops, b.ops);
  });

  test('says what is wrong: no track, no clip, an empty or audio clip, an unknown style', () => {
    const { store, ids } = seedSong();
    assert.match(planArrangement(store.get(), { track: 'Nope' }).error, /no track/);
    assert.match(planArrangement(store.get(), { track: ids.v, clip: 'c_nope00' }).error, /no clip/);
    assert.match(planArrangement(store.get(), { track: ids.v, clip: ids.c, style: 'polka' }).error, /no style/);
    store.dispatch({ type: 'notes.replace', track: ids.v, clip: ids.c, notes: [] });
    assert.match(planArrangement(store.get(), { track: 'Vocal' }).error, /no notes/);
  });
});
