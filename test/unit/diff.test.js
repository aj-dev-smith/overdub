// agent/diff.js: the lines an agent, a variation card and History read about a change.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import { diffProjects, opsSummary, targetsOf, laneLine, laneValue, paramValue, paramWord, lanesIn, pointsOf, isArrangementOp } from '../../app/src/agent/diff.js';

const snap = (s) => structuredClone(s.get());
// A song with a Bass track holding one clip "Walk" (A1, E3).
function band() {
  const s = createStore(createProject({ title: 'T' }));
  const r = s.dispatch([
    { type: 'track.add', ref: 'b', track: { name: 'Bass', instrument: { device: 'core.poly' } } },
    { type: 'clip.add', track: '$b', ref: 'c', clip: { start: 0, length: 4, name: 'Walk', notes: 'A1@0:1 E3@1:1' } },
  ]);
  assert.equal(r.ok, true);
  return { s, t: r.created.b, c: r.created.c };
}
const VERB = { id: 'x.verb', name: 'Hall', params: [{ key: 'mix', label: 'MIX', def: 0.2, unit: '%' }, { key: 'size', label: 'Room size', unit: 's' }] };
const getDevice = (id) => (id === 'x.verb' ? VERB : null);

describe('diffProjects', () => {
  test('identical songs have no lines', () => {
    const { s } = band();
    assert.deepEqual(diffProjects(snap(s), snap(s)), []);
  });

  test('a new track names its instrument, clips and notes; ids only when asked', () => {
    const s = createStore(createProject());
    const A = snap(s);
    const { t } = (() => { const r = s.dispatch({ type: 'track.add', ref: 'b', track: { name: 'Bass', instrument: { device: 'core.poly' }, clips: [{ start: 0, length: 4, notes: [{ p: 36, t: 0, d: 1 }, { p: 43, t: 1, d: 1 }, { p: 48, t: 2, d: 1 }] }] } }); return { t: r.created.b }; })();
    const B = snap(s);
    assert.deepEqual(diffProjects(A, B), [`new track ${t} "Bass" (core.poly), 1 clip, 3 notes`]);
    assert.deepEqual(diffProjects(A, B, { ids: false }), ['new track "Bass" (core.poly), 1 clip, 3 notes']);
    assert.deepEqual(diffProjects(B, A), ['removed track "Bass"']);
  });

  // ops.js track.add calls toNotes() on each clip's notes to read the text form, but normTrack -> normClip has already
  // turned a string into [] by then, so the notes vanish (while opsSummary reports them as added).
  test('a new track whose clip notes are given as text keeps them', () => {
    const s = createStore(createProject());
    const A = snap(s);
    s.dispatch({ type: 'track.add', track: { name: 'Bass', clips: [{ start: 0, length: 4, notes: 'C2@0:1 G2@1:1 C3@2:1' }] } });
    assert.equal(s.get().tracks[0].clips[0].notes.length, 3);
    assert.match(diffProjects(A, snap(s))[0], /1 clip, 3 notes$/);
  });

  test('song settings, track controls and a new insert, in keys and in words', () => {
    const { s } = band();
    const A = snap(s);
    s.dispatch([
      { type: 'project.set', patch: { tempo: 90, key: { root: 'A', scale: 'minor' }, meter: [3, 4] } },
      { type: 'track.set', track: 'Bass', patch: { gain: -3, mute: true } },
      { type: 'insert.add', track: 'Bass', insert: { device: 'x.verb', params: { mix: 0.3 } } },
    ]);
    const B = snap(s);
    const keys = diffProjects(A, B, { getDevice });
    assert.ok(keys.includes('tempo 120 → 90'));
    assert.ok(keys.some((l) => /^key .* → A minor$/.test(l)));
    assert.ok(keys.includes('meter 4/4 → 3/4'));
    assert.ok(keys.includes('Bass: gain 0 → -3 dB'));
    assert.ok(keys.includes('Bass: mute false → true'));
    assert.ok(keys.some((l) => l.startsWith('Bass: + Hall insert (fx_') && l.endsWith('mix 0.2 (default) → 0.3%')), keys.join('\n'));
    const words = diffProjects(A, B, { getDevice, ids: false });
    assert.ok(words.includes('Bass: level 0 → -3 dB'));
    assert.ok(words.includes('Bass: muted'));
    assert.ok(words.includes('Bass: + Hall, mix 0.3%'), words.join('\n'));
    assert.ok(!words.some((l) => /fx_|t_/.test(l)), 'no ids in words');
  });

  test('note edits: added with their range, removed, and changed by kind', () => {
    const { s, t, c } = band();
    const A = snap(s);
    const [n1] = s.get().tracks[0].clips[0].notes;
    s.dispatch([
      { type: 'notes.add', track: t, clip: c, notes: 'C4@2:1 G4@3:1' },
      { type: 'notes.set', track: t, clip: c, notes: [{ id: n1.id, p: n1.p + 1, v: 0.5 }] },
    ]);
    const B = snap(s);
    assert.deepEqual(diffProjects(A, B), ['Bass "Walk": +2 notes (C4–G4), 1 note changed (pitch, velocity)']);
    const n2 = s.get().tracks[0].clips[0].notes.find((n) => n.p === 52);
    s.dispatch({ type: 'notes.remove', track: t, clip: c, ids: [n2.id] });
    assert.deepEqual(diffProjects(B, snap(s)), ['Bass "Walk": −1 note']);
  });

  test('a moved clip reads as beats, or as a bar in words', () => {
    const { s, t, c } = band();
    const A = snap(s);
    s.dispatch({ type: 'clip.set', track: t, clip: c, patch: { start: 8 } });
    assert.deepEqual(diffProjects(A, snap(s)), ['Bass "Walk": start 0 → 8']);
    assert.deepEqual(diffProjects(A, snap(s), { ids: false }), ['Bass "Walk": moved to bar 3']);
  });

  test('a new automation lane says its bars, points and values', () => {
    const { s } = band();
    const A = snap(s);
    s.dispatch({ type: 'auto.write', track: 'Bass', param: 'gain', points: '0:-6 16:0' });
    assert.deepEqual(diffProjects(A, snap(s)), ['Bass › level: new lane, bars 1–4, 2 points, -6 dB → 0 dB']);
  });

  test('max cuts the list and says how many more', () => {
    const s = createStore(createProject());
    const A = snap(s);
    s.dispatch(Array.from({ length: 5 }, (_, i) => ({ type: 'track.add', track: { name: `T${i}` } })));
    const lines = diffProjects(A, snap(s), { max: 2 });
    assert.equal(lines.length, 3);
    assert.equal(lines[2], '… and 3 more changes');
  });
});

describe('opsSummary', () => {
  test('counts notes in text, lists and grids, and names the track', () => {
    const { s, t } = band();
    const p = s.get();
    assert.equal(opsSummary([{ type: 'notes.add', track: t, clip: 'x', notes: 'C4@0:1 D4@1:1' }], p), '+2 notes · Bass');
    assert.equal(opsSummary([{ type: 'notes.add', track: 'Bass', clip: 'x', notes: [{ p: 60 }] }], p), '+1 note · Bass');
    assert.equal(opsSummary([{ type: 'clip.add', track: t, clip: { grid: { rows: { kick: 'x...x...', hat: 'x.x.x.x.' } } } }], p), 'new clip, +6 notes · Bass');
    assert.equal(opsSummary([{ type: 'notes.remove', track: t, clip: 'x', ids: ['n1', 'n2', 'n3'] }], p), '−3 notes · Bass');
  });

  test('song settings read as what they are', () => {
    assert.equal(opsSummary([{ type: 'project.set', patch: { tempo: 98, key: { root: 'A', scale: 'harmonicMinor' } } }]), 'tempo 98, key A harmonic minor');
    assert.equal(opsSummary([{ type: 'project.set', patch: { loop: { on: true, start: 0, end: 32 } } }]), 'loop bars 1–8');
    assert.equal(opsSummary([{ type: 'project.set', patch: { loop: { on: false } } }]), 'loop off');
    assert.equal(opsSummary([{ type: 'master.set', patch: { gain: -1.5 } }]), 'master level -1.5 dB · Master'.replace(' · Master', ''));
  });

  test('devices by name, an insert removed by what it was', () => {
    const { s, t } = band();
    s.dispatch({ type: 'insert.add', track: t, ref: 'v', insert: { device: 'x.verb' } });
    const fx = s.get().tracks[0].inserts[0].id;
    assert.equal(opsSummary([{ type: 'insert.add', track: t, insert: { device: 'x.verb' } }], s.get(), { getDevice }), '+Hall · Bass');
    assert.equal(opsSummary([{ type: 'insert.remove', track: t, insert: fx }], s.get(), { getDevice }), '−Hall · Bass');
    assert.equal(opsSummary([{ type: 'insert.set', track: t, insert: fx, patch: { params: { size: 2 }, on: false } }], s.get(), { getDevice }), 'Hall Room size, bypassed · Bass');
  });

  test('a clip made and repeated in one call counts its copies', () => {
    const ops = [
      { type: 'track.add', ref: 'b', track: { name: 'Keys' } },
      { type: 'clip.add', track: '$b', ref: 'v', clip: { start: 0, length: 4, notes: 'C4@0:1 E4@1:1' } },
      { type: 'clip.repeat', track: '$b', clip: '$v', times: 4 },
    ];
    assert.equal(opsSummary(ops), 'new track, 4 new clips, +8 notes · Keys');
  });

  test('repeated counters and at most three parts and three tracks', () => {
    assert.equal(opsSummary([{ type: 'section.add', section: { name: 'A' } }, { type: 'track.add', track: {} }, { type: 'track.add', track: {} }]), 'new section A, new track ×2');
    assert.equal(opsSummary([]), '');
    assert.equal(opsSummary([null, 7, { type: 'weird.thing' }]), 'weird thing');
  });
});

describe('targetsOf', () => {
  test('resolves refs, track names and created ids', () => {
    const { s, t, c } = band();
    const r = targetsOf([{ type: 'notes.add', track: 'Bass', clip: c }, { type: 'clip.add', track: '$k', clip: '$z' }], s.get(), { k: 't_newone', z: 'c_newone' });
    assert.deepEqual(r.tracks.sort(), [t, 't_newone'].sort());
    assert.deepEqual(r.clips.sort(), [c, 'c_newone'].sort());
  });

  test('an arrangement op names what it moved only through its inverse', () => {
    const { s, t, c } = band();
    const ops = [{ type: 'time.insert', at: 0, length: 4 }];
    assert.deepEqual(targetsOf(ops, s.get()), { tracks: [], clips: [] });
    const r = s.dispatch(ops);
    assert.equal(r.ok, true);
    const tg = targetsOf(ops, s.get(), {}, r.txn.inverse);
    assert.ok(tg.clips.includes(c));
    assert.ok(tg.tracks.includes(t));
  });
});

describe('lanes in words', () => {
  test('laneValue formats each unit', () => {
    assert.equal(laneValue(440, 'Hz'), '440 Hz');
    assert.equal(laneValue(4500, 'Hz'), '4.5 kHz');
    assert.equal(laneValue(-3.04, 'dB'), '-3 dB');
    assert.equal(laneValue(0.001, 'pan'), 'centre');
    assert.equal(laneValue(-0.5, 'pan'), '50% left');
    assert.equal(laneValue(1, 'pan'), '100% right');
    assert.equal(laneValue(1, '', ['off', 'on']), 'on');
    assert.equal(laneValue(NaN, 'dB'), 'NaN');
  });

  test('paramWord and paramValue read a param as the person does', () => {
    assert.equal(paramWord({ label: 'THRESHOLD' }), 'threshold');
    assert.equal(paramWord({ label: 'Room size' }), 'Room size');
    assert.equal(paramWord(undefined, 'mix'), 'mix');
    assert.equal(paramValue({ unit: 'dB' }, -80), '-80 dB');
    assert.equal(paramValue({ opts: ['SINE', 'SAW'] }, 1), 'saw');
    assert.equal(paramValue({ unit: 'x' }, 2.5), '2.5');
    assert.equal(paramValue({}, null), 'its default');
  });

  test('laneLine for write, clear and hold', () => {
    const { s } = band();
    const p = s.get();
    assert.equal(laneLine({ type: 'auto.write', track: 'Bass', param: 'gain', points: '0:-6 16:0' }, p), 'wrote level on Bass, bars 1–4: -6 dB → 0 dB');
    assert.equal(laneLine({ type: 'auto.write', track: 'Bass', param: 'pan', points: '0:0 4:1 8:0' }, p), 'wrote pan on Bass, bars 1–2: centre → 100% right and back');
    assert.equal(laneLine({ type: 'auto.clear', track: 'Bass', param: 'gain' }, p), 'removed the level lane on Bass');
    assert.equal(laneLine({ type: 'auto.clear', track: 'Bass', param: 'gain', from: 4, to: 12 }, p), 'cleared level on Bass, bars 2–3');
    assert.equal(laneLine({ type: 'auto.set', track: 'Bass', param: 'gain', patch: { off: true } }, p, { where: false }), 'held level');
  });

  test('pointsOf never throws on bad text', () => {
    assert.deepEqual(pointsOf('not points at all'), []);
    assert.equal(pointsOf('0:1 4:2').length, 2);
  });

  test('lanesIn names tracks and the mixer', () => {
    const { s, t } = band();
    s.dispatch({ type: 'auto.write', track: t, param: 'gain', points: '0:-6 4:0' });
    const l = lanesIn(s.get());
    assert.equal(l.length, 1);
    assert.equal(l[0].name, 'Bass');
    assert.equal(l[0].device, 'mixer');
    assert.deepEqual(lanesIn(null), []);
  });

  test('isArrangementOp', () => {
    assert.equal(isArrangementOp({ type: 'clip.split' }), true);
    assert.equal(isArrangementOp({ type: 'clip.set' }), false);
    assert.equal(isArrangementOp({ type: 'toString' }), false);
    assert.equal(isArrangementOp(null), false);
  });
});
