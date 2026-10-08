// core/music.js: pitches, keys, chords, time, the notes text format and drum grids.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteName, parsePitch, parsePc, mtof, ftom, SCALES, scalePcs, inScale, snapToScale, scalePitches,
  chordPitches, chordName, keySpelling, spellPc, spellNote, beatsPerBar, validMeter, beatToSec, secToBeat, posLabel,
  quantize, parseNotes, formatNotes, normNote, isPlace, parseGrid, formatGrid, DRUM_MAP, kitNotes, drumName, GM_DRUMS,
} from '../../app/src/core/music.js';

const C_MAJOR = { root: 'C', scale: 'major' };
const C_MINOR = { root: 'C', scale: 'minor' };

describe('pitches', () => {
  test('names and parses MIDI pitches both ways', () => {
    assert.equal(noteName(60), 'C4');
    assert.equal(noteName(0), 'C-1');
    assert.equal(noteName(127), 'G9');
    for (let p = 0; p <= 127; p++) assert.equal(parsePitch(noteName(p)), p);
  });
  test('reads sharps, flats, unicode accidentals, lower case and numbers', () => {
    assert.equal(parsePitch('F#3'), 54);
    assert.equal(parsePitch('Bb2'), 46);
    assert.equal(parsePitch('B♭2'), 46);
    assert.equal(parsePitch('C♯4'), 61);
    assert.equal(parsePitch('c4'), 60);
    assert.equal(parsePitch('Cb4'), 59);
    assert.equal(parsePitch('B#3'), 60);
    assert.equal(parsePitch('60'), 60);
    assert.equal(parsePitch(62), 62);
  });
  test('an unreadable pitch is NaN, not a throw', () => {
    for (const s of ['H4', '', 'C', '@', 'C#x']) assert.ok(Number.isNaN(parsePitch(s)), s);
  });
  test('pitch classes, enharmonics included', () => {
    assert.equal(parsePc('C'), 0);
    assert.equal(parsePc('Db'), 1);
    assert.equal(parsePc('Cb'), 11);
    assert.equal(parsePc('E#'), 5);
    assert.ok(Number.isNaN(parsePc('X')));
  });
  test('mtof and ftom are inverses around A4 = 440', () => {
    assert.equal(mtof(69), 440);
    assert.ok(Math.abs(mtof(81) - 880) < 1e-9);
    for (const m of [21, 48.5, 69, 108]) assert.ok(Math.abs(ftom(mtof(m)) - m) < 1e-9);
  });
});

describe('scales and keys', () => {
  test('scale pitch classes start on the root', () => {
    assert.deepEqual(scalePcs(C_MAJOR), [0, 2, 4, 5, 7, 9, 11]);
    assert.deepEqual(scalePcs({ root: 'A', scale: 'minor' }), [9, 11, 0, 2, 4, 5, 7]);
    assert.deepEqual(scalePcs(null), SCALES.chromatic);
  });
  test('an unknown scale falls back to major', () => {
    assert.deepEqual(scalePcs({ root: 'D', scale: 'nope' }), scalePcs({ root: 'D', scale: 'major' }));
  });
  test('inScale, in any octave and below 0', () => {
    assert.ok(inScale(64, C_MAJOR));
    assert.ok(!inScale(61, C_MAJOR));
    assert.ok(inScale(-12, C_MAJOR));
    assert.ok(inScale(61, null));
  });
  test('snapToScale moves to the nearest in-key pitch, lower on a tie', () => {
    assert.equal(snapToScale(60, C_MAJOR), 60);
    assert.equal(snapToScale(61, C_MAJOR), 60);
    assert.equal(snapToScale(66, C_MAJOR), 65);
    assert.equal(snapToScale(63.6, C_MAJOR), 64);
    assert.equal(snapToScale(61.4, null), 61);
    for (let p = 40; p < 90; p++) assert.ok(inScale(snapToScale(p, C_MINOR), C_MINOR));
  });
  test('scalePitches lists the in-key pitches in a range, inclusive', () => {
    assert.deepEqual(scalePitches(C_MAJOR, 60, 72), [60, 62, 64, 65, 67, 69, 71, 72]);
  });
});

describe('chords', () => {
  test('chordPitches builds from the root in the octave', () => {
    assert.deepEqual(chordPitches('C', 4), [60, 64, 67]);
    assert.deepEqual(chordPitches('Am7'), [57, 60, 64, 67]);
    assert.deepEqual(chordPitches('F#m'), [54, 57, 61]);
    assert.deepEqual(chordPitches('Cxyz'), []);
    assert.deepEqual(chordPitches('nope'), []);
  });
  test('chordName names chords, inversions as slash chords', () => {
    assert.equal(chordName([57, 60, 64, 67]), 'Am7');
    assert.equal(chordName([60, 64, 67]), 'C');
    assert.equal(chordName([64, 67, 72]), 'C/E');
    assert.equal(chordName([48, 55]), 'C5');
    assert.equal(chordName([60]), 'C');
    assert.equal(chordName([]), '');
    assert.equal(chordName([60, 61, 62]), '');
  });
  test('chordName round-trips chordPitches for every quality in root position', () => {
    for (const sym of ['C', 'Dm', 'Edim', 'Gsus4', 'G7', 'Fmaj7', 'Bm7b5', 'Am6']) assert.equal(chordName(chordPitches(sym)), sym);
  });
  test('names are spelled for the key', () => {
    assert.equal(chordName([68, 72, 75], C_MINOR), 'Ab');
    assert.equal(chordName([68, 72, 75]), 'G#');
  });
});

describe('spelling in a key', () => {
  test('one letter per degree', () => {
    const s = keySpelling(C_MINOR);
    assert.deepEqual([0, 2, 3, 5, 7, 8, 10].map((pc) => s[pc]), ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb']);
    const f = keySpelling({ root: 'F', scale: 'major' });
    assert.equal(f[10], 'Bb');
    const e = keySpelling({ root: 'E', scale: 'major' });
    assert.deepEqual([4, 6, 8, 9, 11, 1, 3].map((pc) => e[pc]), ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#']);
  });
  test('a key that would need double sharps is spelled from its enharmonic', () => {
    const s = keySpelling({ root: 'D#', scale: 'major' });
    assert.ok(s.every((n) => !/##|bb/.test(n)));
    assert.equal(s[3], 'Eb');
  });
  test('no key: the plain sharp names; the result is a copy', () => {
    assert.deepEqual(keySpelling(null), ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
    const a = keySpelling(C_MINOR);
    a[0] = 'X';
    assert.equal(keySpelling(C_MINOR)[0], 'C');
  });
  test('spellPc and spellNote', () => {
    assert.equal(spellPc(8, C_MINOR), 'Ab');
    assert.equal(spellPc(-4, C_MINOR), 'Ab');
    assert.equal(spellNote(68, C_MINOR), 'Ab4');
    assert.equal(spellNote(68), 'G#4');
  });
});

describe('time', () => {
  test('beats per bar for common meters', () => {
    assert.equal(beatsPerBar([4, 4]), 4);
    assert.equal(beatsPerBar([6, 8]), 3);
    assert.equal(beatsPerBar([3, 4]), 3);
    assert.equal(beatsPerBar(null), 4);
  });
  test('validMeter accepts 1..32 over a power of two up to 32 and nothing else', () => {
    for (const m of [[4, 4], [7, 8], [1, 1], [32, 32]]) assert.ok(validMeter(m), JSON.stringify(m));
    for (const m of [[0, 4], [33, 4], [4, 3], [4, 64], [4.5, 4], [4], '4/4', null]) assert.ok(!validMeter(m), JSON.stringify(m));
  });
  test('beats and seconds', () => {
    assert.equal(beatToSec(4, 120), 2);
    assert.equal(secToBeat(2, 120), 4);
  });
  test('posLabel is bar.beat.sixteenth, 1-based', () => {
    assert.equal(posLabel(0), '1.1.1');
    assert.equal(posLabel(5.5), '2.2.3');
    assert.equal(posLabel(7, [6, 8]), '3.2.1');
  });
  test('quantize: strength, swing and already-on-grid', () => {
    assert.equal(quantize(0.3, 0.25), 0.25);
    assert.equal(quantize(0.5, 0.25), 0.5);
    assert.ok(Math.abs(quantize(0.3, 0.25, 0.5) - 0.275) < 1e-12);
    assert.equal(quantize(0.3, 0.25, 0), 0.3);
    assert.equal(quantize(0.3, 0.25, 1, 0.5), 0.3125); // the second step is late
    assert.equal(quantize(0.5, 0.25, 1, 0.5), 0.5);    // an even step isn't
  });
});

describe('the notes text format', () => {
  test('reads the documented example', () => {
    assert.deepEqual(parseNotes('C2@0:0.5 C2@0.5:0.5 G1@1:1*0.9'), [
      { p: 36, t: 0, d: 0.5, v: 0.8 }, { p: 36, t: 0.5, d: 0.5, v: 0.8 }, { p: 31, t: 1, d: 1, v: 0.9 },
    ]);
  });
  test('fractions, numbers, commas, comments and MIDI velocities', () => {
    const ns = parseNotes('#intro\nE4@1/3:1/3, 60@2:1*127; 62@3:0.5');
    assert.equal(ns.length, 3);
    assert.equal(ns[0].t, 0.3333);
    assert.equal(ns[0].d, 0.3333);
    assert.equal(ns[1].v, 1);
    assert.equal(ns[2].p, 62);
  });
  test('a comment line of several words is skipped', () => {
    assert.deepEqual(parseNotes('# the verse riff\nC4@0:1'), [{ p: 60, t: 0, d: 1, v: 0.8 }]);
  });
  test('a comment after the notes ends the line, and a sharp is not a comment', () => {
    assert.deepEqual(parseNotes('C#4@0:1 # the hook\nD4@1:1').map((n) => n.p), [61, 62]);
  });
  test('an empty text is no notes', () => {
    assert.deepEqual(parseNotes(''), []);
    assert.deepEqual(parseNotes('   '), []);
  });
  test('a bad token throws with what it read so far, and says the format', () => {
    let err;
    try { parseNotes('C4@0:1 nope X9@1:1'); } catch (e) { err = e; }
    assert.ok(err);
    assert.match(err.message, /nope/);
    assert.match(err.message, /pitch@start:dur/);
    assert.equal(err.partial.length, 1);
  });
  test('formatNotes then parseNotes round-trips (sorted, default velocity left out)', () => {
    const text = 'C4@0:0.5 E4@0:0.5*0.6 G4@0.5:0.25 C5@1.25:2*1';
    const ns = parseNotes(text);
    assert.equal(formatNotes(ns), text);
    assert.deepEqual(parseNotes(formatNotes(ns)), ns);
    assert.equal(formatNotes(ns, { names: false }).split(' ')[0], '60@0:0.5');
  });
  test('formatNotes sorts by time then pitch and does not mutate its input', () => {
    const ns = [{ p: 64, t: 1, d: 1, v: 0.8 }, { p: 67, t: 0, d: 1, v: 0.8 }, { p: 60, t: 0, d: 1, v: 0.8 }];
    const copy = structuredClone(ns);
    assert.equal(formatNotes(ns), 'C4@0:1 G4@0:1 E4@1:1');
    assert.deepEqual(ns, copy);
  });
  test('an array goes through normNote', () => {
    assert.deepEqual(parseNotes([{ p: 'A4', t: 1 }]), [{ p: 69, t: 1, d: 0.25, v: 0.8 }]);
  });
});

describe('normNote', () => {
  test('clamps pitch, start, length and velocity', () => {
    assert.deepEqual(normNote({ p: 200, t: -3, d: 0, v: 5 }), { p: 127, t: 0, d: 1 / 64, v: 5 / 127 > 1 ? 1 : Math.round((5 / 127) * 1e4) / 1e4 });
    assert.equal(normNote({ p: -5, t: 0 }).p, 0);
    assert.equal(normNote({ p: 60, t: 0, v: 0 }).v, 0.01);
    assert.equal(normNote({ p: 60, t: 0, v: 1.5 }).v, Math.round((1.5 / 127) * 1e4) / 1e4);
  });
  test('accepts the long field names and defaults a bad length or velocity', () => {
    assert.deepEqual(normNote({ pitch: 'C4', start: 2, duration: 1, velocity: 0.5 }), { p: 60, t: 2, d: 1, v: 0.5 });
    assert.deepEqual(normNote({ p: 60, t: 0, d: 'x', v: 'y' }), { p: 60, t: 0, d: 0.25, v: 0.8 });
  });
  test('an unreadable note throws', () => {
    assert.throws(() => normNote(null), /could not read note/);
    assert.throws(() => normNote({ p: 'H2', t: 0 }), /could not read note/);
    assert.throws(() => normNote({ p: 60, t: 'soon' }), /could not read note/);
  });
  test('keeps id and by; a place only when both string and fret are valid', () => {
    const n = normNote({ p: 40, t: 0, id: 'n3', by: 'claude', s: 0, f: 0 });
    assert.equal(n.id, 'n3');
    assert.equal(n.by, 'claude');
    assert.equal(n.s, 0);
    assert.equal(n.f, 0);
    assert.ok(!('s' in normNote({ p: 40, t: 0, s: 1 })));
    assert.ok(!('s' in normNote({ p: 40, t: 0, s: 1.5, f: 2 })));
    assert.ok(!('f' in normNote({ p: 40, t: 0, s: 1, f: 37 })));
  });
  test('isPlace bounds', () => {
    assert.ok(isPlace(0, 0));
    assert.ok(isPlace(11, 36));
    assert.ok(!isPlace(12, 0));
    assert.ok(!isPlace(0, -1));
    assert.ok(!isPlace(undefined, 3));
  });
});

describe('drum grids', () => {
  test('parseGrid: hits, accents, ghosts and rests on the step grid', () => {
    const ns = parseGrid({ steps: 8, step: 0.5, rows: { kick: 'X..x', snare: '..o.' } });
    assert.deepEqual(ns, [
      { p: 36, t: 0, d: 0.5, v: 1 }, { p: 36, t: 1.5, d: 0.5, v: 0.8 }, { p: 38, t: 1, d: 0.5, v: 0.45 },
    ]);
  });
  test('row names are case-insensitive aliases or MIDI numbers; bars and spaces are ignored', () => {
    const ns = parseGrid({ rows: { HH: 'x.x. | x...', 40: 'x' } });
    assert.deepEqual(ns.map((n) => [n.p, n.t]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), [[40, 0], [42, 0], [42, 0.5], [42, 1]]);
  });
  test('an unknown row name throws', () => {
    assert.throws(() => parseGrid({ rows: { tuba: 'x...' } }), /unknown drum row "tuba"/);
  });
  test('formatGrid then parseGrid round-trips on-grid notes', () => {
    const grid = { steps: 16, step: 0.25, rows: { kick: 'X...x...o...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } };
    const ns = parseGrid(grid);
    const back = formatGrid(ns);
    assert.deepEqual(back.rows, grid.rows);
    const key = (n) => `${n.p}@${n.t}:${n.v}`;
    assert.deepEqual(parseGrid(back).map(key).sort(), ns.map(key).sort());
  });
  test('formatGrid leaves out notes off the end of the grid and names numbers it has no name for', () => {
    const g = formatGrid([{ p: 36, t: 10, d: 0.25, v: 0.8 }, { p: 99, t: 0, d: 0.25, v: 0.8 }], { steps: 4 });
    assert.equal(g.rows.kick, '....');
    assert.equal(g.rows['99'], 'x...');
  });
  test('the documented GM map holds', () => {
    const want = { kick: 36, snare: 38, clap: 39, rim: 37, hat: 42, pedal: 44, open: 46, tom1: 50, tom2: 47, tom3: 45, crash: 49, ride: 51, cowbell: 56, shaker: 70, rimshot: 40, half: 24, flam: 31, roll: 33, crashchoke: 27 };
    for (const [k, v] of Object.entries(want)) assert.equal(DRUM_MAP[k], v, k);
  });
});

describe('kit note names', () => {
  test('a kit names its own notes, cleaned; other names the rest', () => {
    const def = { id: 'x.kit', notes: { 36: ' Boom\n', 40: 'Crack', 200: 'nope', foo: 'bar', 41: 7, 42: '', other: 'Side stick' } };
    const n = kitNotes(def);
    assert.deepEqual({ ...n }, { 36: 'Boom', 40: 'Crack', other: 'Side stick' });
    assert.ok(Object.isFrozen(n));
    assert.equal(kitNotes(def), n); // the same object for the same def
    assert.equal(drumName(36, n), 'Boom');
    assert.equal(drumName(60, n), 'Side stick (60)');
  });
  test('no names: General MIDI, or null for a pitched row', () => {
    assert.equal(kitNotes({ id: 'core.poly' }), null);
    assert.equal(kitNotes(null), null);
    assert.equal(drumName(38), GM_DRUMS[38]);
    assert.equal(drumName(10), null);
  });
  test('Gobo Kit is named by its id', () => {
    assert.equal(drumName(52, kitNotes({ id: 'core.drums' })), 'Crash (52)');
  });
});
