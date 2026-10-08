// Arrangement edits (core/arrangement.js): the planners, through the ops of the same names in a store, and undo.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import {
  planClipSplit, planClipRepeat, planTimeInsert, planTimeRemove, planSectionDuplicate, followClips,
  nextName, barBeat, whereLabel, spanLabel, retake, takeFolders, takeNumber, laneWrite,
} from '../../app/src/core/arrangement.js';

// The song as a document, without the clock's last-modified stamp and the authors it has met (kept across undo).
const snap = (p) => { const x = JSON.parse(JSON.stringify(p)); delete x.meta.modified; delete x.meta.authors; return x; };

// Keys (0-8): C4@0:1, E4@1:3 (across beat 2), G4@6:1. Drums (0-8): a kick, a long "hit" across beat 2, a snare at 3.5.
// Sections Verse 0-8 and Chorus 8-16, the loop 0-16 on, a gain lane on Keys from -6 to 0 over the clip.
function song() {
  const store = createStore(createProject({ title: 'Fixture', loop: { on: true, start: 0, end: 16 } }));
  const r = store.dispatch([
    { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.poly' } } },
    { type: 'clip.add', ref: 'kc', track: '$k', clip: { start: 0, length: 8, notes: 'C4@0:1 E4@1:3 G4@6:1' } },
    { type: 'track.add', ref: 'd', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
    { type: 'clip.add', ref: 'dc', track: '$d', clip: { start: 0, length: 8, notes: 'C2@0:1 D2@1:2 D2@3.5:0.5' } },
    { type: 'section.add', ref: 'v', section: { name: 'Verse', start: 0, length: 8 } },
    { type: 'section.add', ref: 'ch', section: { name: 'Chorus', start: 8, length: 8 } },
    { type: 'auto.write', track: '$k', param: 'gain', points: '0:-6 8:0' },
  ]);
  assert.equal(r.ok, true, r.error);
  const ids = r.created;
  const keys = () => store.get().tracks.find((t) => t.id === ids.k);
  const drums = () => store.get().tracks.find((t) => t.id === ids.d);
  return { store, ids, keys, drums };
}

// Apply, then check the undo puts the song back exactly and the redo forward again exactly.
function roundTrip(store, ops, opts) {
  const before = snap(store.get());
  const r = store.dispatch(ops, opts);
  assert.equal(r.ok, true, r.error);
  const after = snap(store.get());
  assert.equal(store.undo().ok, true);
  assert.deepEqual(snap(store.get()), before, 'undo restores the song exactly');
  assert.equal(store.redo().ok, true);
  assert.deepEqual(snap(store.get()), after, 'redo makes the same change again');
  return r;
}

describe('clip.split', () => {
  test('a pitched note across the cut is cut in two, keeping its id; the halves add up', () => {
    const { store, ids, keys } = song();
    const r = roundTrip(store, { type: 'clip.split', track: 'Keys', clip: ids.kc, at: 2 });
    const [left, right] = keys().clips;
    assert.equal(left.start, 0); assert.equal(left.length, 2);
    assert.equal(right.start, 2); assert.equal(right.length, 6);
    assert.equal(right.id, r.created.clip);
    const e4l = left.notes.find((n) => n.p === 64), e4r = right.notes.find((n) => n.p === 64);
    assert.equal(e4l.id, e4r.id);
    assert.equal(e4l.d + e4r.d, 3);
    assert.equal(e4r.t, 0);
    assert.deepEqual(right.notes.find((n) => n.p === 67).t, 4, 'later notes move to clip time of the right half');
    assert.equal(left.notes.length + right.notes.length, 4);
  });

  test('a drum hit across the cut stays whole on its side (no tail struck again)', () => {
    const { store, ids, drums } = song();
    roundTrip(store, { type: 'clip.split', track: 'Drums', clip: ids.dc, at: 2 });
    const [left, right] = drums().clips;
    assert.deepEqual(left.notes.map((n) => n.p), [36, 38]);
    assert.deepEqual(right.notes.map((n) => [n.p, n.t]), [[38, 1.5]], 'only the snare at 3.5 lands in the right half');
  });

  test('the right half is signed by the clip\'s maker, whoever split it', () => {
    const { store, ids, keys } = song();
    assert.equal(store.dispatch({ type: 'clip.split', track: 'Keys', clip: ids.kc, at: 4 }, { by: 'claude' }).ok, true);
    assert.equal(keys().clips[1].by, 'you');
  });

  test('a cut too near an edge, or outside the clip, is refused and changes nothing', () => {
    const { store, ids } = song();
    const before = snap(store.get());
    for (const at of [0, 0.1, 7.9, 8, 12, -1]) {
      assert.throws(() => planClipSplit(store.get(), { track: 'Keys', clip: ids.kc, at }), /split/);
      const r = store.dispatch({ type: 'clip.split', track: 'Keys', clip: ids.kc, at });
      assert.equal(r.ok, false);
    }
    assert.throws(() => planClipSplit(store.get(), { clip: ids.kc, at: 'x' }), /number of beats/);
    assert.throws(() => planClipSplit(store.get(), { clip: 'c_nope00', at: 2 }), /no clip/);
    assert.deepEqual(snap(store.get()), before);
  });

  test('an undo by its author refuses once someone else has edited the half it made', () => {
    const { store, ids, keys } = song();
    store.dispatch({ type: 'clip.split', track: 'Keys', clip: ids.kc, at: 4 }, { by: 'claude' });
    const right = keys().clips[1];
    assert.equal(store.dispatch({ type: 'notes.add', track: 'Keys', clip: right.id, notes: 'A4@1:1' }, { by: 'you' }).ok, true);
    const before = snap(store.get());
    const u = store.undo({ by: 'claude' });
    assert.equal(u.ok, false);
    assert.deepEqual(snap(store.get()), before);
  });
});

describe('clip.repeat', () => {
  test('copies: end to end, signed by whoever asked, notes keep their authors, lanes follow', () => {
    const { store, ids, keys } = song();
    const r = roundTrip(store, { type: 'clip.repeat', track: 'Keys', clip: ids.kc, times: 3 }, { by: 'claude' });
    const cs = keys().clips;
    assert.deepEqual(cs.map((c) => c.start), [0, 8, 16]);
    assert.equal(new Set(cs.map((c) => c.id)).size, 3);
    assert.deepEqual(r.created.clips ?? cs.slice(1).map((c) => c.id), cs.slice(1).map((c) => c.id));
    for (const c of cs.slice(1)) {
      assert.equal(c.by, 'claude');
      assert.deepEqual(c.notes.map((n) => [n.p, n.t, n.d, n.by]), cs[0].notes.map((n) => [n.p, n.t, n.d, n.by]));
    }
    // the gain lane's ramp under the clip is written again under each copy
    const pts = keys().auto.gain.points;
    for (const s of [8, 16]) assert.ok(pts.some((x) => x.t === s && x.v === -6), `ramp restarts at ${s}`);
    assert.ok(pts.some((x) => x.t === 24 && x.v === 0));
  });

  test('loop: one longer clip, notes looped, a note past its end cut there', () => {
    const { store, ids, keys } = song();
    store.dispatch({ type: 'notes.add', track: 'Keys', clip: ids.kc, notes: 'B4@7:4' });
    roundTrip(store, { type: 'clip.repeat', track: 'Keys', clip: ids.kc, times: 2, mode: 'loop' });
    const [c] = keys().clips;
    assert.equal(keys().clips.length, 1);
    assert.equal(c.length, 16);
    assert.equal(c.notes.length, 8);
    const bs = c.notes.filter((n) => n.p === 71);
    assert.deepEqual(bs.map((n) => [n.t, n.d]), [[7, 1], [15, 1]]);
    assert.equal(new Set(c.notes.map((n) => n.id)).size, 8, 'every note has its own id');
  });

  test('bad times and modes are refused with what would work', () => {
    const { store, ids } = song();
    for (const times of [1, 0, 65, 2.5, 'two']) assert.throws(() => planClipRepeat(store.get(), { clip: ids.kc, times }), /2 to 64/);
    assert.throws(() => planClipRepeat(store.get(), { clip: ids.kc, times: 2, mode: 'stretch' }), /copies.*loop/);
  });

  test('held to the song\'s limits before anything is built, saying what fits', () => {
    const { store, ids } = song();
    // 400 notes looped 64 times would be 25,600 in one clip (a clip holds 20,000)
    const many = Array.from({ length: 400 }, (_, i) => ({ p: 60 + (i % 12), t: (i % 32) / 4, d: 0.25, v: 0.5 }));
    assert.equal(store.dispatch({ type: 'notes.replace', track: 'Keys', clip: ids.kc, notes: many }).ok, true);
    assert.throws(() => planClipRepeat(store.get(), { clip: ids.kc, times: 64, mode: 'loop' }), /clip of 25,600 notes.*×50 fits/);
    // a clip near the song's last beat can't be repeated past it
    store.dispatch({ type: 'clip.set', track: 'Drums', clip: ids.dc, patch: { start: 8180 } });
    assert.throws(() => planClipRepeat(store.get(), { clip: ids.dc, times: 2 }), /beat 8,192/);
    const before = snap(store.get());
    assert.equal(store.dispatch({ type: 'clip.repeat', clip: ids.dc, times: 2 }).ok, false);
    assert.deepEqual(snap(store.get()), before);
  });

  test('a copy of a take is an ordinary clip', () => {
    const { store, ids } = song();
    const p = JSON.parse(JSON.stringify(store.get()));
    p.tracks[0].clips[0].take = 'tk_abcd';
    const s2 = createStore(p);
    s2.dispatch({ type: 'clip.repeat', track: 'Keys', clip: ids.kc, times: 2 });
    const cs = s2.get().tracks[0].clips;
    assert.equal(cs[0].take, 'tk_abcd');
    assert.equal(cs[1].take, undefined);
  });
});

describe('time.insert', () => {
  test('clips across it split, later things move, a section across it grows, the loop and lanes follow', () => {
    const { store, ids, keys } = song();
    roundTrip(store, { type: 'time.insert', at: 4, length: 4 });
    const p = store.get();
    const kc = keys().clips;
    assert.deepEqual(kc.map((c) => [c.start, c.length]), [[0, 4], [8, 4]]);
    const verse = p.sections.find((s) => s.id === ids.v), chorus = p.sections.find((s) => s.id === ids.ch);
    assert.deepEqual([verse.start, verse.length], [0, 12]);
    assert.deepEqual([chorus.start, chorus.length], [12, 8]);
    assert.deepEqual(p.loop, { on: true, start: 0, end: 20 });
    // the lane: the value at beat 4 (-3) held across the new bars, the end moved to 12
    const pts = keys().auto.gain.points;
    assert.deepEqual(pts[0], { t: 0, v: -6 });
    const near = (t) => pts.find((x) => x.t === t && Math.abs(x.v + 3) < 1e-9);
    assert.ok(near(4) && near(8), JSON.stringify(pts));
    assert.deepEqual(pts[pts.length - 1], { t: 12, v: 0 });
  });

  test('at the very end it only moves what is after it; bad arguments are refused', () => {
    const { store } = song();
    const plan = planTimeInsert(store.get(), { at: 16, length: 4 });
    assert.equal(plan.moved, 0); assert.equal(plan.split, 0);
    assert.throws(() => planTimeInsert(store.get(), { at: -1, length: 4 }), />= 0/);
    assert.throws(() => planTimeInsert(store.get(), { at: 0, length: 0 }), /more than 0/);
    assert.throws(() => planTimeInsert(store.get(), { at: 0 }), /number of beats/);
    assert.throws(() => planTimeInsert(store.get(), { at: 0, length: 8190 }), /beat 8,192/);
  });
});

describe('time.remove', () => {
  test('a notes clip closes up around the cut; each note keeps its sounding part; a drum hit inside goes', () => {
    const { store, ids, keys, drums } = song();
    roundTrip(store, { type: 'time.remove', at: 2, length: 4 });
    const [k] = keys().clips;
    assert.deepEqual([k.start, k.length], [0, 4]);
    assert.deepEqual(k.notes.map((n) => [n.p, n.t, n.d]), [[60, 0, 1], [64, 1, 1], [67, 2, 1]]);
    const [d] = drums().clips;
    assert.deepEqual(d.notes.map((n) => n.p), [36, 38], 'the snare at 3.5 was inside the cut');
    const p = store.get();
    assert.deepEqual(p.sections.map((s) => [s.name, s.start, s.length]), [['Verse', 0, 4], ['Chorus', 4, 8]]);
    assert.deepEqual(p.loop, { on: true, start: 0, end: 12 });
  });

  test('sections and clips wholly inside go; a loop inside the cut turns off', () => {
    const { store, keys } = song();
    store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 9, end: 11 } } });
    const plan = planTimeRemove(store.get(), { at: 8, length: 8 });
    assert.equal(plan.loop, 'off');
    roundTrip(store, { type: 'time.remove', at: 8, length: 8 });
    const p = store.get();
    assert.deepEqual(p.sections.map((s) => s.name), ['Verse']);
    assert.equal(p.loop.on, false);
    assert.equal(keys().clips.length, 1);
  });

  test('removing a whole clip\'s span removes the clip', () => {
    const { store, keys } = song();
    roundTrip(store, { type: 'time.remove', at: 0, length: 8 });
    assert.equal(keys().clips.length, 0);
    assert.deepEqual(store.get().sections.map((s) => [s.name, s.start]), [['Chorus', 0]]);
  });
});

describe('section.duplicate', () => {
  test('copies the section and its clips right after it, named next in the series', () => {
    const { store, ids, keys } = song();
    const r = roundTrip(store, { type: 'section.duplicate', section: 'verse', ref: 'v2' }, { by: 'claude' });
    const p = store.get();
    const copy = p.sections.find((s) => s.id === r.created.v2);
    assert.deepEqual([copy.name, copy.start, copy.length], ['Verse 2', 8, 8]);
    const kc = keys().clips;
    assert.equal(kc.length, 2);
    assert.equal(kc[1].start, 8);
    assert.equal(kc[1].by, 'claude');
    assert.deepEqual(kc[1].notes.map((n) => [n.p, n.t, n.d]), kc[0].notes.map((n) => [n.p, n.t, n.d]));
  });

  test('push makes room first: what was after moves right by the section\'s length', () => {
    const { store, ids } = song();
    roundTrip(store, { type: 'section.duplicate', section: ids.v, push: true });
    const p = store.get();
    assert.deepEqual(p.sections.map((s) => [s.name, s.start]).sort((a, b) => a[1] - b[1]), [['Verse', 0], ['Verse 2', 8], ['Chorus', 16]]);
    assert.equal(p.loop.end, 24);
  });

  test('a clip that starts before the section brings only its part, with a pitched tail', () => {
    const { store, ids, keys } = song();
    store.dispatch({ type: 'section.add', ref: 'mid', section: { name: 'Mid', start: 2, length: 4 } });
    const plan = planSectionDuplicate(store.get(), { section: 'Mid', to: 32 });
    const add = plan.ops.find((o) => o.type === 'clip.add' && o.track === keys().id);
    assert.deepEqual([add.clip.start, add.clip.length], [32, 4]);
    assert.deepEqual(add.clip.notes.map((n) => [n.p, n.t, n.d]), [[64, 0, 2]], 'E4 rings in from before: its tail');
  });

  test('an unknown section names the ones there are', () => {
    const { store } = song();
    assert.throws(() => planSectionDuplicate(store.get(), { section: 'Bridge' }), /no section "Bridge".*Verse.*Chorus/);
  });
});

describe('planners are pure', () => {
  test('planning never changes the song', () => {
    const { store, ids } = song();
    const p = store.get(), before = JSON.stringify(p);
    planClipSplit(p, { clip: ids.kc, at: 3 });
    planClipRepeat(p, { clip: ids.kc, times: 4 });
    planClipRepeat(p, { clip: ids.kc, times: 4, mode: 'loop' });
    planTimeInsert(p, { at: 3, length: 2 });
    planTimeRemove(p, { at: 3, length: 2 });
    planSectionDuplicate(p, { section: 'Verse', push: true });
    followClips(p, [{ track: 'Keys', clip: ids.kc, start: 16 }]);
    assert.equal(JSON.stringify(p), before);
  });
});

describe('followClips', () => {
  test('a move writes the lane at the new span and holds the old span', () => {
    const { store, ids, keys } = song();
    store.dispatch({ type: 'auto.write', track: 'Keys', param: 'gain', points: '0:-6 4:-3 8:0' });
    const { ops, lanes } = followClips(store.get(), [{ track: 'Keys', clip: ids.kc, start: 16 }]);
    assert.equal(lanes, 1);
    const r = store.dispatch([...ops, { type: 'clip.move', track: 'Keys', clip: ids.kc, start: 16 }]);
    assert.equal(r.ok, true, r.error);
    const pts = keys().auto.gain.points;
    assert.ok(pts.some((x) => x.t === 20 && x.v === -3), 'the middle point moved with the clip');
    assert.ok(!pts.some((x) => x.t === 4), 'and left the old span');
  });

  test('a copy leaves the old span; a clip with no points under it plans nothing', () => {
    const { store, ids } = song();
    store.dispatch({ type: 'auto.write', track: 'Keys', param: 'gain', points: '0:-6 4:-3 8:0' });
    const copy = followClips(store.get(), [{ track: 'Keys', clip: ids.kc, start: 16, copy: true }]);
    assert.equal(copy.lanes, 1);
    assert.ok(copy.ops[0].from >= 16);
    assert.equal(followClips(store.get(), [{ track: 'Drums', clip: ids.dc, start: 16 }]).lanes, 0);
    assert.equal(followClips(store.get(), [{ track: 'Keys', clip: ids.kc, start: 0 }]).lanes, 0, 'not moved');
  });
});

describe('helpers', () => {
  const p = { meter: [4, 4], sections: [{ name: 'Chorus' }, { name: 'Chorus 2' }, { name: 'Verse 2' }] };
  test('nextName counts on in a series and skips names taken', () => {
    assert.equal(nextName(p, 'Chorus'), 'Chorus 3');
    assert.equal(nextName(p, 'Verse 2'), 'Verse 3');
    assert.equal(nextName(p, 'Bridge'), 'Bridge 2');
    assert.equal(nextName(p, 'Take 99999999999999999999'), 'Take 99999999999999999999 2');
  });
  test('positions read as a DAW counts them', () => {
    assert.equal(barBeat(p, 0), '1.1');
    assert.equal(barBeat(p, 22), '6.3');
    assert.equal(barBeat(p, 22.5), '6.3.3');
    assert.equal(whereLabel(p, 32), 'bar 9');
    assert.equal(whereLabel(p, 33.5), 'beat 33.5');
    assert.equal(spanLabel(p, 16), '4 bars');
    assert.equal(spanLabel(p, 4), '1 bar');
    assert.equal(spanLabel(p, 6), '6 beats');
    assert.equal(whereLabel({ meter: [3, 4] }, 3), 'bar 2');
  });
  test('laneWrite: only the beats that differ, null when nothing does', () => {
    const a = [{ t: 0, v: 0 }, { t: 4, v: 1 }, { t: 8, v: 0 }];
    assert.equal(laneWrite({ track: 't', param: 'gain' }, a, a), null);
    const w = laneWrite({ track: 't', param: 'gain' }, a, [{ t: 0, v: 0 }, { t: 4, v: 2 }, { t: 8, v: 0 }]);
    assert.deepEqual([w.from, w.to, w.points], [4, 4, [{ t: 4, v: 2 }]]);
  });
});

describe('take folders', () => {
  test('retake: a lone copy of a take is ordinary; copies of two takes are a new folder of their own', () => {
    const [lone] = retake([{ take: 'tk_aaaa' }]);
    assert.equal(lone.take, undefined);
    const two = retake([{ take: 'tk_aaaa' }, { take: 'tk_aaaa' }, { name: 'plain' }]);
    assert.equal(two[0].take, two[1].take);
    assert.notEqual(two[0].take, 'tk_aaaa');
    assert.match(two[0].take, /^tk_/);
    assert.equal(two[2].take, undefined);
  });

  test('takeFolders: clips sharing a take id, in take order, the unmuted one playing', () => {
    const c = (id, name, mute) => ({ id, kind: 'notes', start: 0, length: 4, name, take: 'tk_abcd', notes: [], ...(mute ? { mute: true } : {}) });
    const t = { clips: [c('c3', 'Take 2', false), c('c1', 'Changes', true), c('c2', 'Take 1', true), { id: 'x', kind: 'notes', start: 8, length: 4, notes: [] }] };
    const [f] = takeFolders(t);
    assert.equal(takeFolders(t).length, 1);
    assert.deepEqual(f.clips.map((x) => x.id), ['c1', 'c2', 'c3']);
    assert.equal(f.playing.id, 'c3');
    assert.deepEqual([f.start, f.end], [0, 4]);
    assert.equal(takeNumber({ name: 'Take 12' }), 12);
    assert.equal(takeNumber({ name: 'Take one' }), 0);
    assert.equal(takeNumber(null), 0);
  });

  test('splitting a take splits its whole folder; both halves are folders', () => {
    const { store, ids } = song();
    const p = JSON.parse(JSON.stringify(store.get()));
    const t = p.tracks[0];
    const a = t.clips[0];
    a.take = 'tk_abcd'; a.name = 'Take 1'; a.mute = true;
    t.clips.push({ ...JSON.parse(JSON.stringify(a)), id: 'c_take02', name: 'Take 2', mute: false });
    const s2 = createStore(p);
    const before = snap(s2.get());
    const r = s2.dispatch({ type: 'clip.split', track: 'Keys', clip: ids.kc, at: 4 });
    assert.equal(r.ok, true, r.error);
    const folders = takeFolders(s2.get().tracks[0]);
    assert.equal(folders.length, 2);
    for (const f of folders) assert.equal(f.clips.length, 2);
    assert.deepEqual(folders.map((f) => [f.start, f.end]).sort((x, y) => x[0] - y[0]), [[0, 4], [4, 8]]);
    assert.equal(s2.undo().ok, true);
    assert.deepEqual(snap(s2.get()), before);
  });
});
