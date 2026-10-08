// The core in Node: the song document, ops and their inverses, the store's transactions and undo, the text formats.
import { createStore } from '../app/src/core/store.js';
import {
  parseNotes,
  formatNotes,
  parseGrid,
  formatGrid,
  chordName,
  snapToScale,
  parsePitch,
  noteName,
  quantize,
  validMeter,
  keySpelling,
  spellPc,
  spellNote,
} from '../app/src/core/music.js';
import {
  summarize,
  validateProject,
  cleanProject,
  createProject,
  LIMITS,
  songSize,
  sizeError,
  songEnd,
  NAME_MAX,
  TRACK_COLORS,
} from '../app/src/core/project.js';
import { demoProject } from '../app/src/core/demo.js';
import { OP_TYPES, OPS } from '../app/src/core/ops.js';
import { tally } from './pw.js';

const t = tally('core');
const snap = (s) => JSON.stringify(s.get().tracks);
// canonical JSON (sorted keys): the same song, whatever order its keys were written in
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((kk) => [kk, v[kk]]),
        )
      : v,
  );
const same = (a, b) => canon(a) === canon(b);

// text formats
t.ok(
  parsePitch('C4') === 60 && parsePitch('F#3') === 54 && parsePitch('Bb2') === 46 && parsePitch('60') === 60,
  'pitch names',
);
t.ok(noteName(61) === 'C#4', 'note names');
const ns = parseNotes('C4@0:0.5 E4@0.5:0.5*0.9, G4@1:1');
t.ok(ns.length === 3 && ns[1].v === 0.9 && ns[2].d === 1, 'parseNotes');
t.ok(formatNotes(ns) === 'C4@0:0.5 E4@0.5:0.5*0.9 G4@1:1', 'formatNotes round trip: ' + formatNotes(ns));
let threw = '';
try {
  parseNotes('C4@0:0.5 nope');
} catch (e) {
  threw = e.message;
}
t.ok(/expected pitch@start:dur/.test(threw), 'a bad note says what it expected');
const grid = { steps: 16, rows: { kick: 'x...x...x...x...', snare: '....X.......X..o', hat: 'x.x.x.x.x.x.x.x.' } };
const g = parseGrid(grid);
t.ok(g.length === 4 + 3 + 8, 'parseGrid hits: ' + g.length);
t.ok(
  formatGrid(g).rows.kick === grid.rows.kick && formatGrid(g).rows.snare === grid.rows.snare,
  'formatGrid round trip',
);
t.ok(
  chordName([57, 60, 64, 67]) === 'Am7' && chordName([52, 55, 60]) === 'C/E',
  'chord names: ' + chordName([52, 55, 60]),
);
{
  // spelled for the key: one letter per degree, the key's side for the rest
  const cm = { root: 'C', scale: 'minor' },
    eM = { root: 'E', scale: 'major' },
    fs = { root: 'F#', scale: 'major' },
    ds = { root: 'D#', scale: 'major' };
  const sp = (k) => keySpelling(k).join(' ');
  t.ok(
    chordName([56, 60, 63], cm) === 'Ab' &&
      chordName([56, 60, 63]) === 'G#' &&
      chordName([55, 58, 63], cm) === 'Eb/G' &&
      chordName([53, 56, 60, 63], cm) === 'Fm7' &&
      spellPc(10, cm) === 'Bb' &&
      spellNote(68, cm) === 'Ab4',
    `in C minor, Ab not G# (${chordName([56, 60, 63], cm)}, ${chordName([55, 58, 63], cm)}, ${chordName([53, 56, 60, 63], cm)})`,
  );
  t.ok(
    sp(eM).includes('G#') &&
      sp(eM).includes('C#') &&
      !/b/.test(sp(eM)) &&
      spellPc(5, fs) === 'E#' &&
      spellPc(3, ds) === 'Eb' &&
      spellPc(8, { root: 'A', scale: 'minor' }) === 'Ab',
    `sharps in E major (${sp(eM)}), E# in F# major, D# major read as Eb, A minor's borrowed Ab`,
  );
}
t.ok(
  snapToScale(61, { root: 'C', scale: 'major' }) === 60 || snapToScale(61, { root: 'C', scale: 'major' }) === 62,
  'snap to scale',
);
t.ok(
  Math.abs(quantize(1.1, 0.25) - 1) < 1e-9 && Math.abs(quantize(1.1, 0.25, 0.5) - 1.05) < 1e-9,
  'quantize with strength',
);

// store: refs, attribution, atomicity
const s = createStore();
let r = s.dispatch(
  [
    { type: 'track.add', ref: 'bass', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
    { type: 'clip.add', track: '$bass', ref: 'v1', clip: { start: 0, notes: 'A1@0:0.5 E2@1:0.5' } },
    { type: 'notes.add', track: '$bass', clip: '$v1', notes: 'G1@2:1' },
    { type: 'insert.add', track: '$bass', ref: 'fx', insert: { device: 'core.drive', params: { drive: 4 } } },
  ],
  { by: 'claude', label: 'a bassline' },
);
t.ok(r.ok && r.created.bass && r.created.v1 && r.created.fx, 'refs resolve inside one transaction');
const bass = s.get().tracks[0];
t.ok(
  bass.by === 'claude' && bass.clips[0].notes.every((n) => n.by === 'claude' && n.id),
  'everything the agent made is signed by it',
);
t.ok(bass.clips[0].length === 4, 'a clip sizes itself to its notes');
const before = snap(s);
r = s.dispatch([
  { type: 'track.set', track: bass.id, patch: { gain: -3 } },
  { type: 'clip.set', track: bass.id, clip: 'nope', patch: { start: 1 } },
]);
t.ok(
  !r.ok && /op 2 of 2/.test(r.error) && /rolled back/.test(r.error),
  'a failing op rolls back the whole transaction',
);
t.ok(snap(s) === before, '…and nothing changed');
r = s.dispatch({ type: 'insert.add', track: bass.id, insert: { device: 'x' } });
t.ok(r.ok, 'without a device registry any device id is accepted');

// every op has an exact inverse: apply, undo, compare
const s2 = createStore(demoProject());
const pristine = JSON.stringify(s2.get());
const tr = s2.get().tracks[1],
  cl = tr.clips[0],
  fx = s2.get().tracks[2].inserts[0];
const trials = [
  { type: 'project.set', patch: { tempo: 101, title: 'X', key: { root: 'D', scale: 'dorian' }, loop: { on: false } } },
  { type: 'track.add', track: { name: 'New', kind: 'audio' }, index: 1 },
  { type: 'track.remove', track: tr.id },
  { type: 'track.move', track: tr.id, index: 3 },
  { type: 'track.set', track: tr.id, patch: { name: 'B', gain: -9, pan: 0.5, mute: true } },
  { type: 'instrument.set', track: tr.id, device: 'core.poly', params: { cutoff: 900 } },
  { type: 'instrument.set', track: tr.id, params: { drive: 3 } },
  { type: 'insert.add', track: tr.id, insert: { device: 'core.comp' }, index: 0 },
  { type: 'insert.add', track: 'master', insert: { device: 'core.limiter' } },
  { type: 'insert.remove', track: s2.get().tracks[2].id, insert: fx.id },
  {
    type: 'insert.move',
    track: s2.get().tracks.find((x) => x.name === 'Guitar').id,
    insert: s2.get().tracks.find((x) => x.name === 'Guitar').inserts[0].id,
    index: 2,
  },
  {
    type: 'insert.set',
    track: s2.get().tracks[2].id,
    insert: fx.id,
    patch: { on: false, params: { mix: 3, size: 8 } },
  },
  { type: 'clip.add', track: tr.id, clip: { start: 40, notes: 'C3@0:1' } },
  { type: 'clip.remove', track: tr.id, clip: cl.id },
  { type: 'clip.set', track: tr.id, clip: cl.id, patch: { start: 2, length: 8, name: 'renamed' } },
  { type: 'clip.move', track: tr.id, clip: cl.id, toTrack: s2.get().tracks[2].id, start: 12 },
  { type: 'notes.add', track: tr.id, clip: cl.id, notes: 'C3@0:1 D3@1:1' },
  { type: 'notes.remove', track: tr.id, clip: cl.id, ids: cl.notes.slice(0, 3).map((n) => n.id) },
  { type: 'notes.set', track: tr.id, clip: cl.id, notes: [{ id: cl.notes[0].id, p: 40, t: 0.25, v: 0.3 }] },
  { type: 'notes.replace', track: tr.id, clip: cl.id, grid: grid },
  { type: 'section.add', section: { name: 'Bridge', start: 32, length: 8 } },
  { type: 'section.set', section: s2.get().sections[0].id, patch: { name: 'Intro', length: 8 } },
  { type: 'section.remove', section: s2.get().sections[1].id },
  {
    type: 'device.define',
    device: {
      id: 'you.tiny',
      name: 'Tiny',
      kind: 'effect',
      params: [],
      kernel: '({ create() { return { process() {} }; } })',
    },
  },
  { type: 'master.set', patch: { gain: -3 } },
  { type: 'asset.add', asset: { id: 'a_test01', kind: 'audio', name: 'take 1', sr: 48000, channels: 1, duration: 2 } },
  {
    type: 'reference.set',
    reference: {
      asset: 'a_ref001',
      name: 'ref.wav',
      sr: 48000,
      channels: 2,
      duration: 3,
      profile: { lufs: -9, bands: { mid: -4 } },
    },
  },
  // arrangement ops (core/arrangement.js; tools/arrangement-test.js has the musical checks)
  { type: 'section.duplicate', section: s2.get().sections[0].id, push: true },
  { type: 'time.insert', at: 6, length: 4 },
  { type: 'time.remove', at: 6, length: 12 },
  { type: 'clip.repeat', track: tr.id, clip: cl.id, times: 3 },
  { type: 'clip.repeat', track: tr.id, clip: cl.id, times: 2, mode: 'loop' },
  { type: 'clip.split', track: tr.id, clip: cl.id, at: cl.start + 2.5 },
  // automation (core/automation.js; tools/automation-test.js has the fuzz)
  { type: 'auto.write', track: tr.id, param: 'gain', points: '0:-60 16:-6~0.5 32:-6' },
];
{
  // auto.clear and auto.set need a lane to work on: each undoes back to the song with the lane, exactly
  s2.dispatch({ type: 'auto.write', track: tr.id, param: 'pan', points: '0:-1 8:1' }, { by: 'you' });
  const withLane = JSON.stringify(s2.get());
  for (const op of [
    { type: 'auto.clear', track: tr.id, param: 'pan', from: 4, to: 8 },
    { type: 'auto.clear', track: tr.id, param: 'pan' },
    { type: 'auto.set', track: tr.id, param: 'pan', patch: { off: true } },
  ]) {
    const res = s2.dispatch(op, { by: 'claude' });
    s2.undo();
    t.ok(
      res.ok && canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(withLane), meta: null }),
      `${op.type} undoes exactly${res.ok ? '' : ': ' + res.error}`,
    );
    if (res.ok) trials.push({ type: op.type, _skip: true });
  }
  s2.undo();
}
s2.dispatch({
  type: 'device.define',
  device: { id: 'you.keep', name: 'Keep', kind: 'effect', params: [], kernel: '({})' },
});
const pristine2 = JSON.stringify(s2.get());
const rm = s2.dispatch({ type: 'device.remove', id: 'you.keep' });
s2.undo();
t.ok(
  rm.ok && canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine2), meta: null }),
  'device.remove undoes exactly',
);
s2.undo();
if (rm.ok) trials.push({ type: 'device.remove', _skip: true });
s2.dispatch({ type: 'asset.add', asset: { id: 'a_keep01', name: 'kept', sr: 48000, channels: 1, duration: 1 } });
const pristine3 = JSON.stringify(s2.get());
const ar = s2.dispatch({ type: 'asset.remove', id: 'a_keep01' });
s2.undo();
t.ok(
  ar.ok && canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine3), meta: null }),
  'asset.remove undoes exactly',
);
s2.undo();
if (ar.ok) trials.push({ type: 'asset.remove', _skip: true });
// the reference (ui/reference.js): replacing and clearing one undo exactly, and it is never a track
s2.dispatch(
  { type: 'reference.set', reference: { asset: 'a_ref0a', name: 'first.wav', duration: 2, profile: { lufs: -10 } } },
  { by: 'you' },
);
const pristine4 = JSON.stringify(s2.get());
const rf1 = s2.dispatch({
  type: 'reference.set',
  reference: { asset: 'a_ref0b', name: 'second.wav', duration: 4, profile: { lufs: -8 } },
});
s2.undo();
const back1 = canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine4), meta: null });
const rf2 = s2.dispatch({ type: 'reference.set', reference: null });
const cleared = !('reference' in s2.get());
s2.undo();
const back2 = canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine4), meta: null });
t.ok(
  rf1.ok &&
    rf2.ok &&
    back1 &&
    back2 &&
    cleared &&
    s2.get().reference.by === 'you' &&
    s2.get().tracks.length === JSON.parse(pristine).tracks.length,
  'reference.set replaces and clears, and undoes exactly',
);
s2.undo();
t.ok(!('reference' in s2.get()), '…and the first one undoes to no reference at all');
// a reference with no measured profile can't be drawn (the Reference tab reads profile.lufs): the op refuses it, and a
// loaded song (a share link, a project file) drops it
{
  const pre = JSON.stringify(s2.get());
  const bad = [
    { name: 'x' },
    { name: 'x.mp3', asset: 'a_zzzzzz' },
    { name: 'x', profile: {} },
    { name: 'x', profile: { lufs: 'loud' } },
    { name: 'x', profile: null },
  ];
  const res = bad.map((reference) => s2.dispatch({ type: 'reference.set', reference }, { by: 'claude' }));
  t.ok(
    res.every((r) => !r.ok && /profile/.test(r.error)) && JSON.stringify(s2.get()) === pre,
    'reference.set refuses a reference without a measured profile: ' + res[0].error,
  );
  const loaded = bad.map((reference) => 'reference' in cleanProject({ ...createProject(), reference }));
  const good = cleanProject({
    ...createProject(),
    reference: { name: 'ok.wav', asset: 'a_ok0001', profile: { lufs: -9 } },
  });
  t.ok(
    loaded.every((x) => !x) && good.reference?.name === 'ok.wav',
    'a loaded song drops a reference without a profile and keeps a measured one',
  );
}
// define a device and place it in one transaction (the agent's one-undo-step "build me a pedal")
const s4 = createStore(undefined, { getDevice: () => null });
const both = s4.dispatch(
  [
    { type: 'track.add', ref: 'g', track: { name: 'G', kind: 'audio' } },
    { type: 'device.define', device: { id: 'claude.x', name: 'X', kind: 'effect', params: [], kernel: '({})' } },
    { type: 'insert.add', track: '$g', insert: { device: 'claude.x' } },
  ],
  { by: 'claude', reason: 'asked for X' },
);
t.ok(
  both.ok && both.txn.reason === 'asked for X',
  'a device can be written and placed in one undo step, with a reason ' + (both.error || ''),
);
const pv = s4.preview({ type: 'track.set', track: s4.get().tracks[0].id, patch: { gain: -12 } });
const heard = s4.get().tracks[0].gain;
pv.release();
t.ok(
  heard === -12 && s4.get().tracks[0].gain === 0 && s4.history.length === 1,
  'preview applies and releases without touching history',
);
const tested = new Set();
for (const op of trials) {
  if (op._skip) {
    tested.add(op.type);
    continue;
  }
  const res = s2.dispatch(op, { by: 'claude' });
  if (!t.ok(res.ok, `${op.type} applies${res.ok ? '' : ': ' + res.error}`)) continue;
  tested.add(op.type);
  const u = s2.undo();
  const back = canon({ ...s2.get(), meta: null }) === canon({ ...JSON.parse(pristine), meta: null });
  t.ok(u.ok && back, `${op.type} undoes exactly`);
  const rr = s2.redo();
  s2.undo();
  t.ok(rr.ok, `${op.type} redoes`);
}
t.ok(
  OP_TYPES.every((x) => tested.has(x)),
  'every op type is covered: missing ' + OP_TYPES.filter((x) => !tested.has(x)).join(', '),
);

// three grains of undo
const s3 = createStore(demoProject());
const drums = s3.get().tracks[0];
const g0 = drums.gain;
s3.dispatch({ type: 'track.set', track: drums.id, patch: { gain: -1 } }, { by: 'claude' });
s3.dispatch({ type: 'track.set', track: drums.id, patch: { pan: 0.3 } }, { by: 'you' });
s3.dispatch({ type: 'track.set', track: drums.id, patch: { mute: true } }, { by: 'claude' });
const u = s3.undo({ by: 'claude' });
t.ok(
  u.ok && drums.mute === false && drums.pan === 0.3 && drums.gain === -1,
  "undo({ by }) takes back only that author's latest",
);
s3.dispatch({ type: 'track.set', track: drums.id, patch: { solo: true } }, { by: 'claude' });
const rv = s3.revertAuthor('claude');
t.ok(
  rv.ok && rv.reverted === 2 && drums.gain === g0 && drums.solo === false && drums.pan === 0.3,
  "revertAuthor keeps the human's edits",
);

// coalescing: a knob drag is one undo step
for (const v of [1, 2, 3, 4])
  s3.dispatch({ type: 'track.set', track: drums.id, patch: { gain: -v } }, { coalesce: 'gain' });
const n = s3.history.length;
s3.undo();
t.ok(drums.gain === g0 && s3.history.length === n - 1, 'a coalesced gesture undoes in one step');

// note ids are never reused: an author's undo can't land on someone else's note
{
  const s = createStore();
  const r0 = s.dispatch(
    [
      { type: 'track.add', ref: 'k', track: { name: 'Keys' } },
      { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, notes: 'C4@0:1 E4@1:1' } },
    ],
    { by: 'you' },
  );
  const tk = r0.created.k,
    ck = r0.created.c;
  const add = s.dispatch({ type: 'notes.add', track: tk, clip: ck, notes: 'G4@2:1 B4@3:1' }, { by: 'claude' });
  s.dispatch({ type: 'notes.remove', track: tk, clip: ck, ids: [add.created.notes[1]] }, { by: 'you' });
  const mine = s.dispatch({ type: 'notes.add', track: tk, clip: ck, notes: 'D5@3.5:0.5' }, { by: 'you' });
  t.ok(
    !add.created.notes.includes(mine.created.notes[0]),
    `a freed note id isn't handed out again (claude's ${add.created.notes.join(', ')}, then yours ${mine.created.notes[0]})`,
  );
  const u = s.undo({ by: 'claude' });
  const left = s
    .clip(tk, ck)
    .notes.map((n) => `${n.p}:${n.by}`)
    .join(' ');
  t.ok(
    u.ok && left === '60:you 64:you 74:you',
    `undo({ by: 'claude' }) takes back only claude's notes; your D5 stays (${left})`,
  );
  // …and the clip's counter survives the clip being deleted and put back
  s.dispatch({ type: 'notes.remove', track: tk, clip: ck, ids: [mine.created.notes[0]] }, { by: 'you' });
  s.dispatch({ type: 'clip.remove', track: tk, clip: ck }, { by: 'you' });
  s.undo();
  const again = s.dispatch({ type: 'notes.add', track: tk, clip: ck, notes: 'F5@3:1' }, { by: 'you' });
  t.ok(
    again.created.notes[0] !== mine.created.notes[0] && !add.created.notes.includes(again.created.notes[0]),
    `…and through a deleted and restored clip (${again.created.notes[0]})`,
  );
  // defense in depth: a note claude added that you then edited is yours now, and claude's undo leaves it
  const c2 = s.dispatch({ type: 'notes.add', track: tk, clip: ck, notes: 'A5@0:1' }, { by: 'claude' }).created.notes[0];
  s.dispatch({ type: 'notes.set', track: tk, clip: ck, notes: [{ id: c2, v: 0.5 }] }, { by: 'you' });
  const u2 = s.undo({ by: 'claude' });
  t.ok(
    !u2.ok && /stays/.test(u2.error) && s.clip(tk, ck).notes.some((n) => n.id === c2 && n.by === 'you'),
    `an undo by claude won't delete a note you've since edited: "${u2.error}"`,
  );
}

// a transaction is all or nothing, even when the op that fails changed something before it threw
{
  const s = createStore(demoProject());
  const tr = s.get().tracks[1],
    cl = tr.clips[0],
    fxTrack = s.get().tracks.find((x) => x.inserts.length);
  const n1 = cl.notes[0];
  const doc0 = s.get();
  const fails = [
    ['project.set title + a bad tempo', { type: 'project.set', patch: { title: 'New', tempo: 9999 } }],
    ['project.set a backwards loop', { type: 'project.set', patch: { loop: { start: 12, end: 4 } } }],
    ['project.set a meter of 4/2^40 (a bar 1e-11 beats long)', { type: 'project.set', patch: { meter: [4, 2 ** 40] } }],
    ['project.set a meter of 4/12', { type: 'project.set', patch: { meter: [4, 12] } }],
    ['project.set a meter of 33/4', { type: 'project.set', patch: { meter: [33, 4] } }],
    ['project.set a meter of 0/4', { type: 'project.set', patch: { meter: [0, 4] } }],
    ['track.set name + a bad gain', { type: 'track.set', track: tr.id, patch: { name: 'Renamed', gain: 999 } }],
    [
      'notes.set a good note + a missing one',
      { type: 'notes.set', track: tr.id, clip: cl.id, notes: [{ id: n1.id, p: 50 }, { id: 'nzz' }] },
    ],
    [
      'instrument.set a new device + a bad param',
      { type: 'instrument.set', track: tr.id, device: 'core.poly', params: { cutoff: { no: 1 } } },
    ],
    [
      'insert.set on + a bad param',
      {
        type: 'insert.set',
        track: fxTrack.id,
        insert: fxTrack.inserts[0].id,
        patch: { on: false, params: { mix: 1, size: [1] } },
      },
    ],
    ['clip.set name + a bad start', { type: 'clip.set', track: tr.id, clip: cl.id, patch: { name: 'x', start: -1 } }],
    [
      'section.set name + a bad start',
      { type: 'section.set', section: s.get().sections[0].id, patch: { name: 'x', start: 'soon' } },
    ],
  ];
  for (const [what, op] of fails) {
    const was = canon(s.get()),
      h = s.history.length;
    const r = s.dispatch(op, { by: 'claude' });
    t.ok(
      !r.ok && canon(s.get()) === was && s.history.length === h && /nothing was changed/.test(r.error),
      `${what}: refused, and the song is exactly as it was (${r.error})`,
    );
  }
  // the safety net: an op that changes the song and then throws is put back from a snapshot, the doc object kept
  OPS['test.half'] = (p) => {
    p.title = 'half';
    p.tracks[0].gain = -40;
    throw new Error('halfway');
  };
  const was = canon(s.get());
  const r = s.dispatch([{ type: 'track.set', track: tr.id, patch: { gain: -6 } }, { type: 'test.half' }], {
    by: 'claude',
  });
  delete OPS['test.half'];
  t.ok(
    !r.ok && canon(s.get()) === was && s.get() === doc0 && /nothing was changed/.test(r.error),
    'an op that throws halfway leaves nothing behind (the store keeps the same song object)',
  );
}

// insert.add by track name: the undo names the track by id, so a rename doesn't strand it
{
  const s = createStore();
  const b = s.dispatch({ type: 'track.add', track: { name: 'Bass' } }).created.track;
  const fxr = s.dispatch({ type: 'insert.add', track: 'Bass', insert: { device: 'core.eq' } }, { by: 'claude' });
  t.ok(fxr.txn.inverse[0].track === b, 'insert.add records its inverse by track id');
  s.dispatch({ type: 'track.set', track: b, patch: { name: 'Low end' } }, { by: 'you' });
  const u = s.undo({ by: 'claude' });
  t.ok(
    u.ok && s.track(b).inserts.length === 0 && s.track(b).name === 'Low end',
    `undo({ by }) removes the effect after a rename${u.ok ? '' : ': ' + u.error}`,
  );
  s.dispatch({ type: 'insert.add', track: 'low END', insert: { device: 'core.eq' } }, { by: 'claude' });
  s.dispatch({ type: 'track.set', track: b, patch: { name: 'Sub' } }, { by: 'you' });
  const rv = s.revertAuthor('claude');
  t.ok(
    rv.ok && rv.reverted === 1 && s.track(b).inserts.length === 0,
    `revertAuthor removes it too${rv.ok ? '' : ': ' + JSON.stringify(rv.skipped.map((x) => x.error))}`,
  );
}

// a device this browser hasn't loaded: deleting the track or effect can be undone and redone
{
  const getDevice = (id) =>
    id.startsWith('core.') ? { id, kind: /eq|drive|comp|verb|limiter|delay/.test(id) ? 'effect' : 'instrument' } : null;
  const song = {
    title: 'Missing',
    tracks: [
      {
        id: 't_miss01',
        name: 'Wobble',
        instrument: { device: 'sam.wobble', params: { depth: 3 } },
        inserts: [{ id: 'fx_miss01', device: 'pedal.future', params: { warp: 2 } }],
        clips: [{ id: 'c_miss01', start: 0, length: 4, notes: [{ p: 48, t: 0, d: 1, v: 0.8, by: 'you' }] }],
      },
    ],
  };
  const s = createStore(song, { getDevice });
  const was = canon(s.get().tracks);
  let r = s.dispatch({ type: 'insert.remove', track: 't_miss01', insert: 'fx_miss01' });
  let u = s.undo();
  t.ok(
    r.ok && u.ok && canon(s.get().tracks) === was,
    `undo puts back an effect whose device isn't loaded${u.ok ? '' : ': ' + u.error}`,
  );
  t.ok(s.redo().ok && s.get().tracks[0].inserts.length === 0 && s.undo().ok, '…and redoes');
  r = s.dispatch({ type: 'track.remove', track: 't_miss01' });
  u = s.undo();
  t.ok(
    r.ok && u.ok && canon(s.get().tracks) === was,
    `undo puts back a track on a device that isn't loaded, clips and all${u.ok ? '' : ': ' + u.error}`,
  );
  t.ok(s.redo().ok && s.get().tracks.length === 0 && s.undo().ok && s.get().tracks.length === 1, '…and redoes');
  s.dispatch({ type: 'track.remove', track: 't_miss01' }, { by: 'claude' });
  const rv = s.revertAuthor('claude');
  t.ok(rv.ok && rv.reverted === 1 && canon(s.get().tracks) === was, 'revertAuthor puts it back too');
  const fresh = s.dispatch({ type: 'insert.add', track: 't_miss01', insert: { device: 'pedal.future' } });
  t.ok(!fresh.ok && /no device/.test(fresh.error), 'a new effect on an unknown device is still refused');
}

// revertAuthor with a since that isn't in the history reverts nothing
{
  const s = createStore();
  const ids = [];
  for (let i = 0; i < 5; i++)
    ids.push(s.dispatch({ type: 'track.add', track: { name: 'T' + i } }, { by: 'claude' }).txn.id);
  s.undo({ by: 'claude' });
  const rv = s.revertAuthor('claude', { since: ids[4] });
  t.ok(
    !rv.ok && rv.reverted === 0 && /nothing was reverted/.test(rv.error) && s.get().tracks.length === 4 && s.canRedo(),
    `a stale since reverts nothing and keeps the redo (${rv.error})`,
  );
  const ok = s.revertAuthor('claude', { since: ids[2] });
  t.ok(ok.ok && ok.reverted === 2 && s.get().tracks.length === 2, 'a since in the history reverts from there on');
}

// notes.set naming one note twice undoes to where it started; clip.set offset on a clip that had none undoes
{
  const s = createStore();
  const r0 = s.dispatch(
    [
      { type: 'track.add', ref: 'k', track: { name: 'K' } },
      { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, notes: [{ p: 36, t: 0, d: 1 }] } },
    ],
    { by: 'you' },
  );
  const tk = r0.created.k,
    ck = r0.created.c,
    nid = s.clip(tk, ck).notes[0].id;
  s.dispatch(
    {
      type: 'notes.set',
      track: tk,
      clip: ck,
      notes: [
        { id: nid, p: 40 },
        { id: nid, p: 45 },
      ],
    },
    { by: 'claude' },
  );
  s.undo();
  const n = s.clip(tk, ck).notes[0];
  t.ok(n.p === 36 && n.by === 'you', `notes.set with one note twice undoes to its first value (${n.p}, by ${n.by})`);
  t.ok(s.redo().ok && s.clip(tk, ck).notes[0].p === 45 && s.undo().ok, '…and redoes to its last');
  const was = canon(s.clip(tk, ck));
  const r = s.dispatch({ type: 'clip.set', track: tk, clip: ck, patch: { offset: 1 } });
  const u = s.undo();
  t.ok(
    r.ok && u.ok && canon(s.clip(tk, ck)) === was,
    `clip.set offset on a clip without one undoes${u.ok ? '' : ': ' + u.error}`,
  );
}

// meters: 1 to 32 beats of 1, 2, 4, 8, 16 or 32; anything else is refused or put back to 4/4 on load
t.ok(
  validMeter([4, 4]) &&
    validMeter([7, 8]) &&
    validMeter([1, 1]) &&
    validMeter([32, 32]) &&
    ![[4, 64], [4, 2 ** 31], [0, 4], [33, 4], [4.5, 4], [4, 3], [4], '4/4', null].some(validMeter),
  'validMeter: 1–32 beats of 1, 2, 4, 8, 16 or 32',
);
{
  const s = createStore(createProject());
  t.ok(
    s.dispatch({ type: 'project.set', patch: { meter: [7, 8] } }).ok && s.get().meter.join('/') === '7/8',
    'project.set takes 7/8',
  );
  const crafted = { ...createProject(), meter: [4, 2 ** 40] };
  t.ok(
    cleanProject(crafted).meter.join('/') === '4/4' &&
      cleanProject({ ...createProject(), meter: [6, 8] }).meter.join('/') === '6/8',
    `cleanProject puts an out-of-range meter (a share link's, a file's) back to 4/4: ${cleanProject(crafted).meter}`,
  );
  t.ok(createStore(crafted).get().meter.join('/') === '4/4', 'a store made from that song has 4/4');
  const tp = (tempo) => cleanProject({ ...createProject(), tempo }).tempo;
  t.ok(
    tp(97.5) === 97.5 &&
      tp(0.0001) === 20 &&
      tp(1e12) === 400 &&
      tp('fast') === 120 &&
      tp(null) === 120 &&
      tp(undefined) === 120,
    `cleanProject holds a loaded tempo to 20–400 bpm (0.0001 -> ${tp(0.0001)}, 1e12 -> ${tp(1e12)}, "fast" -> ${tp('fast')})`,
  );
}

// growth limits (core/project.js LIMITS): the store refuses any op that takes the song past one, primitives included
{
  const s = createStore(createProject());
  const clips = Array.from({ length: LIMITS.clips + 1 }, (_, i) => ({ start: i, length: 1, notes: [] }));
  const before = JSON.stringify(s.get());
  const r = s.dispatch(
    { type: 'track.add', track: { name: 'Many', instrument: { device: 'core.keys' }, clips } },
    { by: 'mcp:x' },
  );
  t.ok(
    !r.ok && /a song holds up to 4,096/.test(r.error) && JSON.stringify(s.get()) === before,
    `a track.add carrying ${LIMITS.clips + 1} clips is refused, nothing changed: "${(r.error || '').slice(0, 90)}"`,
  );
  const big = s.dispatch(
    {
      type: 'track.add',
      track: {
        name: 'Big',
        instrument: { device: 'core.keys' },
        clips: [
          {
            start: 0,
            length: 4,
            notes: Array.from({ length: LIMITS.clipNotes + 1 }, (_, i) => ({ p: 60, t: i / 10000, d: 0.02 })),
          },
        ],
      },
    },
    { by: 'mcp:x' },
  );
  t.ok(!big.ok && /a clip holds up to 20,000/.test(big.error), 'a track.add with a 20,001-note clip is refused');
  const ok = s.dispatch(
    { type: 'track.add', track: { name: 'Fine', instrument: { device: 'core.keys' }, clips: clips.slice(0, 64) } },
    { by: 'you' },
  );
  t.ok(
    ok.ok && songSize(s.get()).clips === 64 && sizeError(songSize(s.get())) === null,
    'an ordinary track.add goes in',
  );
}

// clip.take: the take group a recording stacks (input/recorder.js). Optional, kept by normalising, set and cleared by
// clip.set with an exact undo, checked; a song without it is unchanged
{
  const s = createStore(createProject());
  const r0 = s.dispatch({ type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } });
  const k = r0.created.k;
  const before = canon(s.get().tracks);
  const r1 = s.dispatch(
    [
      {
        type: 'clip.add',
        track: k,
        ref: 'a',
        clip: { start: 0, length: 4, name: 'Take 1', notes: 'C4@0:1', take: 'tk_ab12cd' },
      },
      {
        type: 'clip.add',
        track: k,
        ref: 'b',
        clip: { start: 0, length: 4, name: 'Take 2', notes: 'E4@0:1', take: 'tk_ab12cd', mute: true },
      },
    ],
    { by: 'you', label: 'record take 2 on Keys' },
  );
  const [ca, cb] = [r1.created.a, r1.created.b].map((id) => s.clip(k, id));
  t.ok(
    r1.ok && ca.take === 'tk_ab12cd' && cb.take === 'tk_ab12cd' && cb.mute === true,
    'clip.add keeps a take group (and a muted take)',
  );
  t.ok(
    cleanProject(JSON.parse(JSON.stringify(s.get()))).tracks[0].clips.every((c) => c.take === 'tk_ab12cd'),
    'normalising a song keeps the take group',
  );
  t.ok(
    !(
      'take' in
      cleanProject({
        ...createProject(),
        tracks: [{ name: 'K', clips: [{ start: 0, length: 4, take: 'not a take' }] }],
      }).tracks[0].clips[0]
    ),
    "a take that isn't a take id is dropped on load",
  );
  const withTake = canon(s.get().tracks);
  const r2 = s.dispatch(
    [
      { type: 'clip.set', track: k, clip: ca.id, patch: { mute: true } },
      { type: 'clip.set', track: k, clip: cb.id, patch: { mute: false } },
    ],
    { by: 'you', label: 'take 2' },
  );
  t.ok(r2.ok && ca.mute === true && !('mute' in cb), 'switching takes is a clip.set { mute } pair');
  s.undo();
  t.ok(canon(s.get().tracks) === withTake, 'and one undo switches back exactly');
  const r3 = s.dispatch({ type: 'clip.set', track: k, clip: ca.id, patch: { take: null } }, { by: 'you' });
  t.ok(r3.ok && !('take' in s.clip(k, ca.id)), 'clip.set { take: null } takes a clip out of its group (no key left)');
  s.undo();
  t.ok(s.clip(k, ca.id).take === 'tk_ab12cd', 'its undo puts it back in');
  const r4 = s.dispatch({ type: 'clip.set', track: k, clip: ca.id, patch: { take: 'tk_zz9' } }, { by: 'you' });
  const r5 = s.dispatch({ type: 'clip.add', track: k, clip: { start: 8, length: 4, take: 42 } }, { by: 'you' });
  t.ok(
    !r4.ok && /take group id/.test(r4.error) && !r5.ok && /take group id/.test(r5.error),
    `a malformed take is refused (${r4.error})`,
  );
  t.ok(
    /\(take 1 of 2, playing\)/.test(summarize(s.get())) && /\(take 2 of 2\) \(muted\)/.test(summarize(s.get())),
    "the agent's view says which take plays: " + (summarize(s.get()).match(/\(take[^)]*\)[^b]*/g) || []).join(' | '),
  );
  s.undo();
  t.ok(canon(s.get().tracks) === before, 'undoing the recording takes both takes out, exactly');
}

// the demo and the agent view
t.ok(validateProject(demoProject()).length === 0, 'the demo song is valid');
const text = summarize(demoProject());
t.ok(
  /Night Shift/.test(text) && /track t_\w+ "Bass"/.test(text) && /A1@0:0.75/.test(text),
  'summarize shows tracks and notes in the text format',
);
// project.set refuses a title that isn't text (a share link or an agent could send an object; the UI's sink is closed
// too, but the song should never hold one)
{
  const s = createStore(createProject());
  const before = JSON.stringify(s.get());
  const bad = [{ html: '<img src=x onerror=alert(1)>' }, ['x'], 42, 'x'.repeat(201)];
  const results = bad.map((title) => s.dispatch({ type: 'project.set', patch: { title } }, { by: 'mcp:probe' }));
  t.ok(
    results.every((r) => !r.ok && /title must be text/.test(r.error)) && JSON.stringify(s.get()) === before,
    'project.set refuses a title that is not text (an object, an array, a number, 201 characters), and nothing changes',
  );
  const ok = s.dispatch({ type: 'project.set', patch: { title: 'Night Shift (mine)' } }, { by: 'you' });
  t.ok(ok.ok && s.get().title === 'Night Shift (mine)', 'and a text title still sets');
}

// a song file is read with JSON.parse, where 1e400 is Infinity, and cleanProject passed it on: a clip starting at
// Infinity, notes at -Infinity, a song that never ended. A clip gets a finite start and length (and an audio clip a
// finite offset and gain), a note the studio can't place is left out, and a note that leaves out its length or
// velocity (an older or hand-written song) stays
{
  const text = `{"title":"Inf","tracks":[{"name":"I","instrument":{"device":"core.keys","params":{}},"clips":[
    {"id":"c_inf0001","kind":"notes","start":1e400,"length":1e400,"notes":[{"id":"n1","p":1e400,"t":0,"d":1,"v":0.8},{"id":"n2","p":60,"t":-1e400,"d":1,"v":0.8},
      {"id":"n3","p":62,"t":1,"d":1e400,"v":0.8},{"id":"n4","p":64,"t":2,"d":1,"v":-1e400},{"id":"n5","p":65,"t":3,"d":1,"v":0.8},{"id":"n6","p":67,"t":3.5}]},
    {"id":"c_inf0002","kind":"audio","asset":"a_inf0001","start":4,"length":4,"offset":1e400,"gain":-1e400}]}],
    "sections":[{"name":"S","start":1e400,"length":1e400}],"master":{"gain":1e400,"inserts":[]}}`;
  const p = cleanProject(JSON.parse(text));
  const [nc, ac] = ['c_inf0001', 'c_inf0002'].map((id) => p.tracks[0].clips.find((c) => c.id === id));
  const sz = songSize(p),
    sec = p.sections[0];
  const st = createStore(JSON.parse(text));
  t.ok(
    nc.start === 0 &&
      nc.length === 4 &&
      nc.notes.map((n) => n.id).join(' ') === 'n5 n6' &&
      ac.offset === 0 &&
      ac.gain === 0 &&
      sec.start === 0 &&
      sec.length === 16 &&
      p.master.gain === 0 &&
      sz.end === 16 &&
      songEnd(p) === 16 &&
      st.dispatch({ type: 'project.set', patch: { tempo: 99 } }).ok,
    `a song file's 1e400 (Infinity) stays out of the song: the clip at beat ${nc.start} for ${nc.length}, notes ${nc.notes.map((n) => n.id).join(' and ')} kept (the rest can't be placed), the song ends at beat ${sz.end}`,
  );
}

// names set by an op: a rename was any length (and clip.set took any value), and every name and the title kept control
// and bidi characters, which can turn a name round to read as another. A rename past NAME_MAX is refused like a long
// title; control and bidi characters are dropped; a new thing's name is cut, never refused (a duplicate's "Chorus 2",
// an importer's name, a device from a file)
{
  const s = createStore(createProject());
  const r0 = s.dispatch(
    [
      { type: 'track.add', ref: 'k', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
      { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, length: 4, notes: 'C4@0:1' } },
      { type: 'section.add', ref: 's', section: { name: 'Verse', start: 0, length: 4 } },
    ],
    { by: 'you' },
  );
  const { k, c, s: sec } = r0.created;
  const before = canon({ ...s.get(), meta: null });
  const long = 'n'.repeat(NAME_MAX + 1);
  const refused = [
    { type: 'track.set', track: k, patch: { name: long } },
    { type: 'clip.set', track: k, clip: c, patch: { name: long } },
    { type: 'clip.set', track: k, clip: c, patch: { name: { html: '<b>x</b>' } } },
    { type: 'section.set', section: sec, patch: { name: long } },
  ].map((op) => s.dispatch(op, { by: 'mcp:probe' }));
  t.ok(
    refused.every((r) => !r.ok && /name must be text, 100 characters at most/.test(r.error)) &&
      canon({ ...s.get(), meta: null }) === before,
    `a rename past ${NAME_MAX} characters, or not text, is refused and nothing changes: "${refused[0].error}"`,
  );
  const set = s.dispatch(
    [
      { type: 'track.set', track: k, patch: { name: 'Keys\u0000\u001b\u202e ☕ Ünï' } },
      { type: 'clip.set', track: k, clip: c, patch: { name: 'Hook\u0085' } },
      { type: 'section.set', section: sec, patch: { name: '\u2067Chorus\u2069' } },
      { type: 'project.set', patch: { title: '\u202eNight\u0007 Shift' } },
      {
        type: 'device.define',
        device: {
          id: 'you.named',
          name: '\u202eNamed',
          kind: 'effect',
          params: [],
          kernel: '({})',
          presets: [{ name: 'Soft\u0000', params: {} }],
        },
      },
    ],
    { by: 'you' },
  );
  const p = s.get(),
    dev = p.devices['you.named'];
  t.ok(
    set.ok &&
      p.tracks[0].name === 'Keys ☕ Ünï' &&
      s.clip(k, c).name === 'Hook' &&
      p.sections[0].name === 'Chorus' &&
      p.title === 'Night Shift' &&
      dev.name === 'Named' &&
      dev.presets[0].name === 'Soft',
    `control and bidi characters are dropped from a rename, a title and a device ("${p.tracks[0].name}", "${p.sections[0].name}", "${p.title}"); the rest of Unicode stays`,
  );
  t.ok(s.undo().ok && canon({ ...s.get(), meta: null }) === before, '…and one undo puts every name back exactly');
  const add = s.dispatch(
    [
      { type: 'track.add', ref: 't', track: { name: 'x'.repeat(300) } },
      { type: 'section.add', ref: 'w', section: { name: 'w'.repeat(NAME_MAX), start: 8, length: 4 } },
      {
        type: 'device.define',
        device: {
          id: 'you.long',
          name: 'Long Name '.repeat(50),
          kind: 'effect',
          params: [],
          kernel: '({})',
          presets: [{ name: 'p'.repeat(300), params: {} }],
        },
      },
    ],
    { by: 'you' },
  );
  const dup = add.ok ? s.dispatch({ type: 'section.duplicate', section: add.created.w }, { by: 'you' }) : add;
  const long2 = s.get().devices['you.long'];
  t.ok(
    add.ok &&
      s.track(add.created.t).name.length === NAME_MAX &&
      long2?.name.length === NAME_MAX &&
      long2.presets[0].name.length === NAME_MAX &&
      dup.ok &&
      s.get().sections.every((x) => x.name.length <= NAME_MAX),
    `a new track's 300-character name and a device's 500-character one are cut to ${NAME_MAX}, and duplicating a section whose name is already ${NAME_MAX} long still works${dup.ok ? '' : ': ' + dup.error}`,
  );
}

// colours set by an op: track.set, clip.set and the section ops took any value (an agent's url(...) drew as CSS and was
// fetched). A recolour must be a palette token or hex; a new thing's odd colour gets the default; null still clears an
// optional colour (the inverse of setting one)
{
  const s = createStore(createProject());
  const beacon = 'url("https://example.com/beacon.gif")';
  const r0 = s.dispatch(
    [
      { type: 'track.add', ref: 'k', track: { name: 'Keys', color: beacon, instrument: { device: 'core.keys' } } },
      { type: 'clip.add', track: '$k', ref: 'c', clip: { start: 0, length: 4, color: beacon, notes: 'C4@0:1' } },
      { type: 'section.add', ref: 's', section: { name: 'Verse', start: 0, length: 4, color: beacon } },
    ],
    { by: 'mcp:probe' },
  );
  const { k, c, s: sec } = r0.created;
  const made = [s.track(k).color, s.clip(k, c).color, s.get().sections[0].color];
  const before = canon({ ...s.get(), meta: null });
  const bad = [
    { type: 'track.set', track: k, patch: { color: beacon } },
    { type: 'track.set', track: k, patch: { color: 'red' } },
    { type: 'clip.set', track: k, clip: c, patch: { color: 'rgb(1, 2, 3)' } },
    { type: 'section.set', section: sec, patch: { color: 'var(--c-1, url(x))' } },
  ].map((op) => s.dispatch(op, { by: 'mcp:probe' }));
  const good = s.dispatch(
    [
      { type: 'track.set', track: k, patch: { color: '#4fa3e0' } },
      { type: 'clip.set', track: k, clip: c, patch: { color: 'var(--c-2)' } },
      { type: 'section.set', section: sec, patch: { color: '#abc' } },
    ],
    { by: 'you' },
  );
  const after = [s.track(k).color, s.clip(k, c).color, s.get().sections[0].color];
  const cleared = s.dispatch(
    [
      { type: 'clip.set', track: k, clip: c, patch: { color: null } },
      { type: 'section.set', section: sec, patch: { color: null } },
    ],
    { by: 'you' },
  );
  t.ok(
    TRACK_COLORS.includes(made[0]) &&
      made[1] === undefined &&
      made[2] === undefined &&
      bad.every((r) => !r.ok && /color must be a palette colour/.test(r.error)) &&
      good.ok &&
      same(after, ['#4fa3e0', 'var(--c-2)', '#abc']) &&
      cleared.ok &&
      !('color' in s.clip(k, c)) &&
      !('color' in s.get().sections[0]),
    `a colour an op sets is a palette token or hex: url(...), named and rgb() are refused ("${bad[0].error}"), a new thing's gets the default; null still clears one`,
  );
  t.ok(s.undo().ok && s.undo().ok && canon({ ...s.get(), meta: null }) === before, '…and recolours undo exactly');
}

// store.author: who an author id is. A song (a link's above all) said what kind each was and what it was called, and
// the session learned it; an id's kind is its form now, and a name the studio's own go by (or that of an agent that
// joined this session) is no one else's. The answer follows the song and the session as they change.
{
  const s = createStore({
    ...createProject(),
    meta: {
      authors: {
        'mcp:evil': { kind: 'human', name: 'Claude Code' },
        'guest:sam-ab12cd': { kind: 'agent', name: 'Sam' },
        'claude.ai': { kind: 'human', name: 'You' },
        x: { kind: 'agent', name: 'X' },
      },
    },
  });
  const said = (id) => {
    const a = s.author(id);
    return `${a.kind} ${a.name}`;
  };
  const first = ['mcp:evil', 'guest:sam-ab12cd', 'claude.ai', 'x'].map(said);
  s.addAuthor('mcp:claude-code', { kind: 'agent', name: 'Claude Code' }); // (agent/bridge.js, as Claude Code connects)
  const joined = said('mcp:evil');
  s.addAuthor('guest:sam-ab12cd', { kind: 'agent', name: 'Claude' }); // (ui/share.js teaches the session a song's names)
  const learned = said('guest:sam-ab12cd');
  s.load({ ...createProject(), meta: { authors: { 'mcp:evil': { kind: 'agent', name: 'Evil' } } } });
  const loaded = said('mcp:evil');
  t.ok(
    same(first, ['agent Claude Code', 'human Sam', 'agent claude.ai', 'agent X']) &&
      joined === 'agent evil' &&
      learned === 'human Guest' &&
      loaded === 'agent Evil' &&
      s.isAgent('mcp:evil') &&
      !s.isAgent('guest:sam-ab12cd') &&
      said('you') === 'human You',
    `an author's kind is its id's form and a name is no one else's: ${first.join(', ')}; once Claude Code joins, mcp:evil is "${joined}"; a learned guest called Claude is "${learned}"; after a load, "${loaded}"`,
  );
}

{
  // History's summary counts notes in words that agree: "+1 note", "1 note edited", never "1 notes"
  const { opsSummary } = await import('../app/src/agent/diff.js');
  const one = [
    opsSummary([{ type: 'notes.add', clip: 'c', notes: 'C4@0:1' }]),
    opsSummary([{ type: 'notes.set', clip: 'c', notes: [{ id: 'n1', v: 0.5 }] }]),
    opsSummary([{ type: 'notes.remove', clip: 'c', ids: ['n1'] }]),
    opsSummary([{ type: 'notes.replace', clip: 'c', notes: 'C4@0:1' }]),
  ];
  const two = opsSummary([{ type: 'notes.add', clip: 'c', notes: 'C4@0:1 D4@1:1' }]);
  t.ok(
    same(one, ['+1 note', '1 note edited', '−1 note', 'rewrote 1 note']) && two === '+2 notes',
    `History's note counts read right: ${one.join(' | ')} | ${two}`,
  );
}

{
  // the Agent tab's chip for show_device says what opened, not the tool's name
  const { chipFor } = await import('../app/src/agent/tools.js');
  const app = { store: { get: () => ({ tracks: [] }) } };
  const a = chipFor(app, 'show_device', {}, { ok: true, showing: 'Keyhole on Bass' }),
    b = chipFor(app, 'show_device', { close: true }, { ok: true, closed: 'x' });
  t.ok(
    a?.text === 'opened Keyhole on Bass' && b?.text === 'closed the device window',
    `show_device's chip reads as a sentence: "${a?.text}", "${b?.text}"`,
  );
}

// The Jam room's music (core/jam.js), fresh eyes 6: two chords in a bar, tips that go round the loop, the chords a
// guitarist writes, "inside the box" and who a jam track's summary credits
{
  const JAM = await import('../app/src/core/jam.js');
  const { noteName: nn } = await import('../app/src/core/music.js');
  // two chords in a bar: the first bass note under a new chord is its root, wherever in the bar it arrives (a boogie's
  // tail played C B A F# over a D7 on beat 3), so the timeline reads each half bar's chord back, in every riff style
  const halves = [
    ['blues', 'I7 IV7 | I7 V7'],
    ['blues', 'I7 IV7 | V7 IV7'],
    ['funk', 'i7 IV7 | bVImaj7 V7'],
    ['reggae', 'i iv | bVI bVII'],
    ['bossa', 'i6 ii7b5 | iv7 V7'],
    ['metal', 'i5 bVI5 | bVII5 i5'],
  ];
  const misread = [];
  for (const [style, progression] of halves) {
    const r = JAM.jamTrack({ style, progression, bars: 2 }),
      tl = JAM.chordTimeline(r.project);
    const got = [0, 2, 4, 6].map((b) => JAM.chordAt(tl, b + 0.01).chord?.name || '-').join(' '),
      want = r.chart.map((c) => c.name).join(' ');
    if (got !== want) misread.push(`${style} "${progression}": ${want} read as ${got}`);
  }
  t.ok(
    !misread.length,
    `two chords in a bar read back by the half bar in every riff style (${halves.length} progressions${misread.length ? ': ' + misread.join('; ') : ''})`,
  );
  // the agent's own progression: three chords in bar 2 (A7, A7 again, E7 a third of the way into beat 3)
  const ag = JAM.jamTrack({ style: 'blues', progression: 'I7 IV7 | I7 % V7', bars: 2 });
  const bass = ag.project.tracks.find((x) => x.name === 'Bass').clips[0].notes;
  const under = (a) => bass.filter((n) => n.t >= a - 1e-3).sort((x, y) => x.t - y.t)[0];
  const d7 = under(2),
    e7 = under(ag.chart.find((c) => c.name === 'E7').a),
    atl = JAM.chordTimeline(ag.project);
  const bar1 = [0, 2].map((b) => JAM.chordAt(atl, b + 0.01).chord?.name).join(' ');
  t.ok(
    d7.p % 12 === 2 && e7.p % 12 === 4 && Math.abs(e7.t - 6.6667) < 1e-3 && bar1 === 'A7 D7',
    `"I7 IV7 | I7 % V7": the bass plays ${nn(d7.p)} as the D7 arrives on beat 3 and ${nn(e7.p)} at ${e7.t} as the E7 does (the shuffled 8th that lands there), and bar 1 reads ${bar1}`,
  );

  // the tips go round the loop: on the blues' last bar (E7, the turnaround) the next change is bar 13's A7 when Chorus 2
  // loops, bar 1's when the loop is the form, and from the top with no loop; the lick's second bar goes round with it
  const bl = JAM.jamTrack({ style: 'blues' }),
    btl = JAM.chordTimeline(bl.project),
    at24 = 23 * 4 + 1;
  const tipsAt = (loop) =>
    Object.fromEntries(JAM.jamTips({ ...bl.project, loop }, btl, { at: at24 }).map((x) => [x.kind, x]));
  const ch2 = tipsAt({ on: true, start: 48, end: 96 }),
    form = tipsAt({ on: true, start: 0, end: 96 }),
    off = tipsAt({ on: false, start: 0, end: 96 });
  t.ok(
    /^At bar 13, round the loop, the chord moves to A7\. Land on C#, its 3rd/.test(ch2.target?.text || '') &&
      /^At bar 1, round the loop, the chord moves to A7/.test(form.target?.text || '') &&
      /^At bar 1, from the top, the chord moves to A7/.test(off.target?.text || ''),
    `on bar 24 the land-on tip goes round: "${ch2.target?.text}" / "${off.target?.text?.slice(0, 50)}…"`,
  );
  const lk = ch2.lick?.lick;
  t.ok(
    lk &&
      /^A two-bar lick over E7 to A7 \(bars 24 and 13, round the loop\)/.test(lk.text) &&
      lk.bars.join() === '24,13' &&
      lk.starts.join() === '92,48' &&
      lk.notes.find((n) => n.t === 4)?.p % 12 === 1 &&
      /bars 24 and 1, from the top/.test(off.lick?.text || ''),
    `and the lick into it: "${lk?.text}" (main: "over E7 (bars 24–25)", a bar that isn't there)`,
  );

  // Make your own: the chords a funk or jazz player writes (13ths, 11ths, sus and altered dominants, 6/9), each read
  // from its name; a chord it can't read is named once
  const funk = JAM.parseProgression('Em9 A13 Em9 A13 Gmaj7 F#7#9 Em9 A13', { root: 'E', scale: 'minor' });
  const a13 = JAM.parseChord('A13');
  const more = ['E7sus4', 'D7sus', 'G9sus4', 'B7b9', 'C7#11', 'F6/9', 'Bb69', 'Dm11', 'Fmaj13', 'G11', 'Am13'].map(
    (s) => JAM.parseChord(s)?.name || `(${s}?)`,
  );
  const bad = JAM.parseProgression('Em9 X13 Em9 X13 Gmaj7 X13', { root: 'E', scale: 'minor' });
  t.ok(
    !funk.error &&
      funk.bars.length === 8 &&
      a13 &&
      JAM.chordTones(a13)
        .map((x) => x.note)
        .join(' ') === 'A C# E G F#' &&
      !more.some((x) => x.startsWith('(')) &&
      /^can't read "X13" as a chord$/.test(bad.error || ''),
    `Make your own reads "Em9 A13 … F#7#9 …" (${funk.error || 'ok'}); A13 is ${
      a13
        ? JAM.chordTones(a13)
            .map((x) => `${x.note}:${x.name}`)
            .join(' ')
        : 'unread'
    }; ${more.join(' ')}; a bad chord is named once: ${bad.error}`,
  );
  const tonesOf = (s) => {
    const c = JAM.parseChord(s);
    return c
      ? JAM.chordTones(c)
          .map((x) => x.note)
          .join(' ')
      : `(${s} unread)`;
  };
  const c711 = tonesOf('A7#11'),
    b7b9 = tonesOf('E7b9');
  // (a style that adds 9ths, funk, in a key that has G7's 9th: G7#9's voicing keeps its A# and gets no A)
  const fj = JAM.jamTrack({ style: 'funk', key: 'C major', progression: 'Cmaj7 | G7#9' });
  const ep = (fj.project?.tracks.find((x) => x.name === 'E-piano')?.clips[0].notes || []).filter(
    (n) => n.t >= 4 && n.t < 8,
  );
  const pcs = [...new Set(ep.map((n) => n.p % 12))].sort((x, y) => x - y);
  t.ok(
    c711 === 'A C# E G D#' && b7b9 === 'E G# B D F' && !fj.error && pcs.includes(10) && !pcs.includes(9),
    `extensions are spelled from the chord (A7#11: ${c711}; E7b9: ${b7b9}), and a funk band never stacks a 9th on a chord with its own sharp 9 (G7#9 voiced as pitch classes ${pcs.join(' ')})`,
  );

  // "inside the box" only for a note under a finger of the box (frets at..at+3), never a stretch a fret outside it:
  // over the blues' D7, F# is the B string's 7th fret (main chose the D string's 4th and called it inside)
  const into = Object.fromEntries(JAM.jamTips(bl.project, btl, { at: 3 * 4 + 1 }).map((x) => [x.kind, x]));
  const stretched = [];
  for (const id of JAM.JAM_STYLE_IDS) {
    const x = JAM.jamTrack({ style: id }),
      xtl = JAM.chordTimeline(x.project),
      box = JAM.boxFor(xtl.key).at;
    for (const c of xtl.chords) {
      const tg = JAM.jamTips(x.project, xtl, { at: c.start + 0.01 }).find((y) => y.kind === 'target');
      const f = tg?.show.positions[0]?.f;
      if (tg && /inside the box/.test(tg.text) && !(f >= box && f <= box + 3))
        stretched.push(`${id} bar ${c.bar}: fret ${f}, box at ${box}`);
    }
  }
  t.ok(
    /Land on F#, its 3rd.* 7th fret, B string, inside the box\.$/.test(into.target?.text || '') && !stretched.length,
    `"inside the box" is a fret of the box, never its stretch: "${(into.target?.text || '').replace(/^.*Land on/, 'Land on')}" (every style's changes checked${stretched.length ? '; stretched: ' + stretched.slice(0, 3).join(', ') : ''})`,
  );

  // who the summary credits: the house band when the house made it; an agent's jam track is signed by the agent
  const house = JAM.jamTrack({ style: 'blues' }).summary,
    agent = JAM.jamTrack({ style: 'blues', by: 'mcp:claude-code' });
  t.ok(
    /Drums, Bass, Organ by the house band, and a Guitar track for you/.test(house) &&
      !/house band/.test(agent.summary) &&
      /Drums, Bass, Organ, and a Guitar track for you/.test(agent.summary) &&
      agent.project.tracks.every((x) => x.by === 'mcp:claude-code'),
    `an agent's jam track doesn't credit the house band ("…${agent.summary.slice(agent.summary.lastIndexOf('.', agent.summary.length - 2) + 2)}"); the house's still does`,
  );
}

t.done();
