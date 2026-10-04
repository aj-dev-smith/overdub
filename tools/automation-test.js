// Automation in Node (core/automation.js, the auto.* ops in core/ops.js, the lanes in core/project.js, the planners in
// core/arrangement.js, the export in core/dawproject.js): the text form round-trips; travel and bend; valueAt and
// segmentsIn agree; the ops, their errors and their guarded inverses; the normalisers keep lanes; the time edits move
// lanes as docs/research/AUTOMATION.md 3.11 says; limits, songSize and summarize; DAWproject <Points>; and a seeded
// fuzz of 2,000 random op sequences in which every undo puts the song back byte for byte and every redo forward.
//
//   node tools/automation-test.js            AUTO_SEQS=5000 for a longer fuzz (default 2000), AUTO_SEED=n
import { createStore } from '../app/src/core/store.js';
import { createProject, cleanProject, normTrack, normInsert, summarize, songSize, sizeError, LIMITS } from '../app/src/core/project.js';
import {
  MIXER, paramSpec, specFor, toPos, fromPos, travel, dbToPos, posToDb, bend, valueAt, valueBefore, segmentsIn, posAt,
  lanesOf, laneAt, laneKey, normPoints, normLane, parsePoints, formatPoints, shapePoints, thin, pointsPrint, cutLane,
  spliceLane, insertTime, removeTime, laneView, laneAuthors, pointBy, FADER_TOP,
} from '../app/src/core/automation.js';
import { followClips, planTimeInsert } from '../app/src/core/arrangement.js';
import { dawprojectXml } from '../app/src/core/dawproject.js';
import { tally } from './pw.js';

const T = tally('automation');
const SEQS = Math.max(50, +process.env.AUTO_SEQS || 2000);
const SEED = +process.env.AUTO_SEED || 20261001;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const body = (s) => JSON.stringify({ ...s.get(), meta: null });

// a tiny device registry: an instrument and an effect with a log, a linear, a switch and an ms param
const DEVS = {
  'x.synth': { id: 'x.synth', kind: 'instrument', name: 'Testsynth', params: [
    { key: 'cutoff', label: 'CUTOFF', min: 40, max: 16000, def: 2000, curve: 'log', unit: 'Hz' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0 },
    { key: 'wave', label: 'WAVE', opts: ['SAW', 'SQR', 'TRI'], def: 0 },
  ].map(paramSpec) },
  'x.fx': { id: 'x.fx', kind: 'effect', name: 'Testverb', params: [
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 0.3 },
    { key: 'time', label: 'TIME', min: 10, max: 2000, def: 300, curve: 'log', unit: 'ms' },
  ].map(paramSpec) },
};
DEVS['x.other'] = { id: 'x.other', kind: 'instrument', name: 'Other', params: [paramSpec({ key: 'tone', min: 0, max: 1, def: 0.5 })] };
const getDevice = (id) => DEVS[id] || null;
function baseSong() {
  const s = createStore(createProject({ title: 'Lanes' }), { getDevice });
  const r = s.dispatch([
    { type: 'track.add', ref: 'a', track: { name: 'Keys', instrument: { device: 'x.synth' } } },
    { type: 'track.add', ref: 'b', track: { name: 'Pad', instrument: { device: 'x.synth' }, inserts: [{ device: 'x.fx' }] } },
    { type: 'insert.add', track: 'master', ref: 'm', insert: { device: 'x.fx' } },
    { type: 'clip.add', track: '$a', ref: 'c1', clip: { start: 8, length: 8, notes: 'C4@0:1 E4@2:1' } },
    { type: 'clip.add', track: '$b', ref: 'c2', clip: { start: 0, length: 16, notes: 'A3@0:8' } },
    { type: 'section.add', section: { name: 'Verse', start: 0, length: 16 } },
    { type: 'section.add', section: { name: 'Chorus', start: 16, length: 16 } },
  ], { by: 'overdub' });
  if (!r.ok) throw new Error(r.error);
  return { s, a: r.created.a, b: r.created.b, m: r.created.m, c1: r.created.c1, c2: r.created.c2, fx: s.get().tracks[1].inserts[0].id };
}

/* ================================================================== 1. the text form, travel, bend */
{
  const pts = parsePoints('32:400 48:8000~0.5 64:8000');
  T.ok(pts.length === 3 && pts[1].c === 0.5 && pts[0].t === 32 && pts[2].v === 8000, 'parsePoints reads "32:400 48:8000~0.5 64:8000"');
  T.ok(formatPoints(pts) === '32:400 48:8000~0.5 64:8000', 'formatPoints writes it back the same: ' + formatPoints(pts));
  const j = parsePoints('0:-60, 16:-6~step 16:0 1/3:0.5');
  T.ok(j[0].v === -60 && j[1].c === 'step' && j[2].t === 16 && near(j[3].t, 1 / 3), 'negative values, ~step, a jump (two at one beat), fractions and commas');
  T.ok(formatPoints(normPoints(j)) === '0:-60 0.333008:0.5 16:-6~step 16:0', 'normPoints sorts (stably) and rounds beats to 1/1024: ' + formatPoints(normPoints(j)));
  const bad = ['32', '32:x', 'a:1', '1:2~2', '1:2~soft'].map((x) => { try { parsePoints(x); return ''; } catch (e) { return e.message; } });
  T.ok(bad.every((m) => /bad point/.test(m) && /beat:value/.test(m)), 'a bad point says what it expected: ' + bad[0]);
  const three = normPoints([{ t: 4, v: 1 }, { t: 4, v: 2 }, { t: 4, v: 3 }, { t: 2, v: 0 }]);
  T.ok(formatPoints(three) === '2:0 4:1 4:3', 'at most two points at one beat: the arriving and the leaving one');

  const cut = DEVS['x.synth'].params[0];
  let rt = true;
  for (const v of [40, 100, 440, 2000, 16000]) rt = rt && near(fromPos(cut, toPos(cut, v)), v, 1e-6);
  T.ok(rt && near(toPos(cut, Math.sqrt(40 * 16000)), 0.5), 'a log knob: travel round-trips, and the middle of the travel is the geometric middle');
  let fr = true;
  for (const db of [-96, -60, -30, -12, -6, 0, 3, 6, 12, 24]) fr = fr && near(fromPos(MIXER.gain, toPos(MIXER.gain, db)), db, 1e-9);
  T.ok(fr && toPos(MIXER.gain, -96) === 0 && toPos(MIXER.gain, 24) === 1, 'the fader: −96..+24 dB round-trips through its travel');
  T.ok(near(toPos(MIXER.gain, 0) / toPos(MIXER.gain, 6), 0.8) && near(toPos(MIXER.gain, -12) / toPos(MIXER.gain, 6), 0.5), "the fader's travel is the mixer's console law (0 dB at 0.8, −12 at 0.5 of the way to +6)");
  T.ok(dbToPos(0) === 0.8 && dbToPos(-12) === 0.5 && posToDb(0.8) === 0 && posToDb(0.005) === -96, 'dbToPos / posToDb are the mixer fader law (for ui/mixer.js to import)');
  T.ok(near(toPos(MIXER.pan, 0), 0.5) && travel(MIXER.pan).fromPos(0.75) === 0.5, 'pan is linear');
  let mono = true;
  for (const c of [-1, -0.5, 0, 0.3, 1]) { let last = -1; for (let x = 0; x <= 1.0001; x += 0.01) { const y = bend(Math.min(1, x), c); if (y < last - 1e-12 || y < 0 || y > 1) mono = false; last = y; } if (bend(0, c) !== 0 || bend(1, c) !== 1) mono = false; }
  T.ok(mono && bend(0.5, 1) < 0.5 && bend(0.5, -1) > 0.5 && bend(0.99, 'step') === 0 && bend(1, 'step') === 1, 'bend: monotone, 0 to 1, never overshoots; c > 0 starts slow, c < 0 fast, step holds');
}

/* ================================================================== 2. reading a lane */
{
  const cut = DEVS['x.synth'].params[0];
  const lane = { points: normPoints(parsePoints('4:200 8:3200 12:3200~0.5 16:100~step 20:800 20:50 24:50')), by: 'you' };
  T.ok(valueAt(lane, 0, cut) === 200 && valueAt(lane, 99, cut) === 50, 'before the first point the lane holds the first value; after the last, the last');
  T.ok(near(valueAt(lane, 6, cut), 800, 1e-6), 'a straight segment is straight in travel: halfway from 200 Hz to 3.2 kHz on a log knob is 800 Hz (' + valueAt(lane, 6, cut).toFixed(3) + ')');
  T.ok(valueAt(lane, 17, cut) === 100 && valueAt(lane, 19.99, cut) === 100 && valueBefore(lane, 20, cut) === 100, 'a step holds until the next point');
  T.ok(valueAt(lane, 20, cut) === 50 && valueBefore(lane, 20, cut) === 100, 'at a jump, valueAt is the value leaving and valueBefore the value arriving');
  T.ok(valueAt(lane, 4, cut) === 200 && valueAt(lane, 8, cut) === 3200, 'at a point, its own value exactly');
  const bent = valueAt(lane, 14, cut), straight = fromPos(cut, (toPos(cut, 3200) + toPos(cut, 100)) / 2);
  T.ok(bent > straight, `a slow start (c 0.5) is still near its start halfway along (${bent.toFixed(0)} Hz vs ${straight.toFixed(0)} straight)`);
  const fade = { points: [{ t: 0, v: -96 }, { t: 16, v: 0 }], by: 'you' };
  const mid = valueAt(fade, 8, MIXER.gain);
  T.ok(mid > -24 && mid < -12, `a fade drawn straight on the fader is a hand on a fader, not 3 bars of nothing (halfway: ${mid.toFixed(1)} dB)`);
  // valueAt and segmentsIn agree, at many beats
  let agree = true, worst = 0;
  const segs = segmentsIn(lane, -10, 40, cut);
  for (let b = -2; b < 30; b += 0.0625) {
    const seg = segs.filter((g) => g.t0 <= b && b < g.t1).pop();
    if (!seg) { agree = false; continue; }
    const v = fromPos(cut, posAt(seg, b)), w = valueAt(lane, b, cut);
    worst = Math.max(worst, Math.abs(v - w) / w);
    if (Math.abs(v - w) > 1e-6 * Math.max(1, Math.abs(w))) agree = false;
  }
  T.ok(agree, `valueAt and segmentsIn agree at 512 beats (worst ${worst.toExponential(1)})`);
  T.ok(segs[0].t0 === -Infinity && segs[segs.length - 1].t1 === Infinity && segs.every((g) => g.t1 > g.t0) && segmentsIn(lane, 9, 10, cut).length === 1, 'segmentsIn: the holds at both ends, no zero-length piece for a jump, only the pieces in range');
  const wave = DEVS['x.synth'].params[2];
  const sw = { points: [{ t: 0, v: 0 }, { t: 4, v: 2 }], by: 'you' };
  T.ok(valueAt(sw, 3.9, wave) === 0 && segmentsIn(sw, 0, 4, wave).every((g) => g.c === 'step'), 'a switch param always steps');
}

/* ================================================================== 3. the ops */
{
  const { s, a, b, m, fx } = baseSong();
  let r = s.dispatch({ type: 'auto.write', track: 'Keys', insert: 'instrument', param: 'cutoff', points: '32:400 48:8000~0.5 64:8000' }, { by: 'claude' });
  const lane = laneAt(s.get(), { track: a, insert: 'instrument', param: 'cutoff' });
  T.ok(r.ok && lane && lane.by === 'claude' && lane.points.length === 3 && s.get().tracks[0].instrument.auto.cutoff === lane, 'auto.write makes a lane on the instrument, signed by its writer: ' + (r.error || formatPoints(lane.points)));
  r = s.dispatch({ type: 'auto.write', track: a, param: 'gain', points: [{ t: 0, v: -60 }, { t: 16, v: -6 }] }, { by: 'you' });
  r = s.dispatch({ type: 'auto.write', track: 'master', param: 'gain', points: '0:0 4:-3' }, { by: 'you' });
  r = s.dispatch({ type: 'auto.write', track: 'master', insert: m, param: 'time', points: '0:100 8:400' }, { by: 'you' });
  T.ok(r.ok && s.get().tracks[0].auto.gain.points.length === 2 && s.get().master.auto.gain && s.get().master.inserts[0].auto.time, 'lanes on a track fader, the master fader and a master insert');
  // replace a range
  r = s.dispatch({ type: 'auto.write', track: a, insert: 'instrument', param: 'cutoff', points: '40:1000 44:2000' }, { by: 'you' });
  T.ok(r.ok && formatPoints(laneAt(s.get(), { track: a, insert: 'instrument', param: 'cutoff' }).points) === '32:400 40:1000 44:2000 48:8000~0.5 64:8000', 'a write replaces exactly the points in its range (default: the span of its points)');
  r = s.dispatch({ type: 'auto.write', track: a, insert: 'instrument', param: 'cutoff', from: 36, to: 50, points: '40:1000' }, { by: 'you' });
  T.ok(r.ok && formatPoints(laneAt(s.get(), { track: a, insert: 'instrument', param: 'cutoff' }).points) === '32:400 40:1000 64:8000', 'from/to widen the range a write replaces');
  // errors
  const err = (op) => { const x = s.dispatch(op, { by: 'claude' }); return x.ok ? '' : x.error; };
  const before = body(s);
  const errs = [
    [{ type: 'auto.write', track: a, insert: 'instrument', param: 'nope', points: '0:1' }, /x.synth has no param "nope" \(its params: cutoff, drive, wave\)/],
    [{ type: 'auto.write', track: a, insert: 'instrument', param: 'cutoff', points: '0:20000' }, /cutoff goes from 40 to 16000 Hz/],
    [{ type: 'auto.write', track: a, param: 'pan', points: '0:2' }, /pan goes from -1 to 1/],
    [{ type: 'auto.write', track: a, param: 'level', points: '0:0' }, /mixer lanes .* are gain and pan/],
    [{ type: 'auto.write', track: 'master', param: 'pan', points: '0:0' }, /master are gain/],
    [{ type: 'auto.write', track: a, param: 'gain', from: 10, to: 12, points: '4:0' }, /outside from–to/],
    [{ type: 'auto.write', track: a, param: 'gain', points: '9000:0' }, /beat 0 to 8,192/],
    [{ type: 'auto.write', track: a, param: 'gain' }, /needs points/],
    [{ type: 'auto.write', track: a, param: 'gain', points: '0:0~3' }, /bad point/],
    [{ type: 'auto.write', track: a, insert: 'fx_nope', param: 'mix', points: '0:0' }, /no insert "fx_nope"/],
    [{ type: 'auto.clear', track: b, param: 'pan' }, /no lane for pan on track .* to clear/],
    [{ type: 'auto.set', track: a, param: 'gain', patch: { off: 'yes' } }, /patch: \{ off: true \}/],
    [{ type: 'auto.set', track: a, param: 'gain', patch: { by: 'x' } }, /can't change "by"/],
    [{ type: 'auto.write', track: a, param: 'gain', points: '0:0' }, null],
  ];
  const bad = errs.slice(0, -1).map(([op, re]) => [err(op), re]).filter(([m, re]) => !re.test(m));
  T.ok(!bad.length && body(s) === before, `bad auto ops are refused with what would be right, and change nothing${bad.length ? ': ' + bad.map(([m]) => m || '(accepted)').join(' | ') : ''}`);
  // auto.set
  r = s.dispatch({ type: 'auto.set', track: a, param: 'gain', patch: { off: true } }, { by: 'you' });
  const held = s.get().tracks[0].auto.gain;
  T.ok(r.ok && held.off === true && JSON.stringify(Object.keys(held)) === '["points","off","by"]', 'auto.set { off: true } holds the lane (stored { points, off, by })');
  s.dispatch({ type: 'auto.set', track: a, param: 'gain', patch: { off: false } }, { by: 'you' });
  T.ok(!('off' in s.get().tracks[0].auto.gain), '…and { off: false } stores no flag');
  // clear
  r = s.dispatch({ type: 'auto.clear', track: a, insert: 'instrument', param: 'cutoff', from: 33, to: 70 }, { by: 'you' });
  T.ok(r.ok && formatPoints(laneAt(s.get(), { track: a, insert: 'instrument', param: 'cutoff' }).points) === '32:400', 'auto.clear removes the points in a range');
  r = s.dispatch({ type: 'auto.clear', track: a, insert: 'instrument', param: 'cutoff' }, { by: 'you' });
  T.ok(r.ok && !s.get().tracks[0].instrument.auto, 'auto.clear with no range removes the lane (and an empty auto goes with it)');
  s.undo(); s.undo();
  T.ok(formatPoints(laneAt(s.get(), { track: a, insert: 'instrument', param: 'cutoff' }).points) === '32:400 40:1000 64:8000', 'undo puts both clears back exactly');
  // the insert's lanes go with it, and come back with an undo; so do a track's and an instrument's
  s.dispatch({ type: 'auto.write', track: b, insert: fx, param: 'mix', points: '0:0 8:1~-0.25 16:0.5' }, { by: 'claude' });
  s.dispatch({ type: 'auto.set', track: b, insert: fx, param: 'mix', patch: { off: true } }, { by: 'you' });
  const withAll = body(s);
  const steps = [
    { type: 'insert.remove', track: b, insert: fx },
    { type: 'track.remove', track: a },
    { type: 'instrument.set', track: a, device: 'x.other' },
  ];
  let exact = true;
  for (const op of steps) { const x = s.dispatch(op, { by: 'you' }); s.undo(); if (!x.ok || body(s) !== withAll) { exact = false; T.note(`${op.type}: ${x.error || 'differs'}`); } }
  T.ok(exact, 'removing an insert, a track or changing an instrument takes their lanes, and undo brings them back byte for byte');
  const swapped = s.dispatch({ type: 'instrument.set', track: a, device: 'x.synth', params: { drive: 0.5 } }, { by: 'you' });
  T.ok(swapped.ok && s.get().tracks[0].instrument.auto?.cutoff, 'a param change on the same instrument keeps its lanes');
  s.undo();
  // the normalisers keep lanes
  const p = s.get();
  const again = cleanProject(JSON.parse(JSON.stringify(p)));
  T.ok(JSON.stringify(lanesOf(again).map((l) => [l.key, l.lane])) === JSON.stringify(lanesOf(p).map((l) => [l.key, l.lane])) && lanesOf(p).length === 5, `cleanProject keeps every lane exactly (${lanesOf(p).length}: ${lanesOf(p).map((l) => l.key).join(', ')})`);
  const messy = normTrack({ name: 'M', auto: { pan: { points: [{ t: 8, v: 3 }, { t: 2.0001, v: -0.5, c: 9 }, { t: 'x', v: 1 }], by: 'claude' }, gain: { points: [] }, cutoff: { points: [{ t: 0, v: 1 }] } } });
  T.ok(JSON.stringify(messy.auto) === '{"pan":{"points":[{"t":2,"v":-0.5,"c":1},{"t":8,"v":1}],"by":"claude"}}', 'a loaded lane is cleaned: sorted, rounded, clamped, malformed points and empty lanes dropped: ' + JSON.stringify(messy.auto));
  const fxn = normInsert({ device: 'x.fx', auto: { mix: { points: [{ t: 0, v: 0.5 }], off: true, by: 'you' } } });
  T.ok(fxn.auto.mix.off === true && fxn.auto.mix.points.length === 1, 'normInsert keeps an insert\'s lanes, held flag and all');
  T.ok(normLane({ points: [] }) === null && cleanProject({ ...createProject(), master: { gain: -2, inserts: [], auto: { gain: { points: [{ t: 0, v: -3 }], by: 'you' } } } }).master.auto.gain.points[0].v === -3, 'a lane with no points is no lane; the master keeps its gain lane');
  // summarize lists lanes
  const text = summarize(s.get(), { devices: getDevice });
  T.ok(/auto: Testsynth cutoff \(instrument\) 32:400 40:1000 64:8000, by you/.test(text) && /auto: gain 0:-60 16:-6, by you/.test(text) && /auto: Testverb mix \(fx_[a-z0-9]+\) 0:0 8:1~-0.25 16:0.5 \(held\), by claude/.test(text) && /master auto: gain 0:0 4:-3, by you/.test(text), 'summarize lists each lane under what it moves, held ones marked:\n' + text.split('\n').filter((l) => /auto:/.test(l)).join('\n'));
  s.dispatch({ type: 'auto.write', track: b, param: 'pan', points: Array.from({ length: 40 }, (_, i) => ({ t: i, v: Math.sin(i) * 0.9 })) }, { by: 'you' });
  T.ok(/auto: pan 40 points, -0\.9\d*–0\.9\d*, bars 1–10, by you/.test(summarize(s.get())), 'a long lane is summed up: ' + (/auto: pan .*/.exec(summarize(s.get())) || [''])[0]);
  // limits
  const sz = songSize(s.get());
  T.ok(sz.points === lanesOf(s.get()).reduce((n, l) => n + l.lane.points.length, 0) && sz.lanePoints === 40, `songSize counts automation points (${sz.points}, ${sz.lanePoints} in the longest lane)`);
  const many = Array.from({ length: LIMITS.lanePoints + 1 }, (_, i) => ({ t: i * 0.5, v: 0 }));
  const big = s.dispatch({ type: 'auto.write', track: a, param: 'pan', points: many }, { by: 'claude' });
  T.ok(!big.ok && /a lane holds up to 10,000/.test(big.error), 'a lane holds up to 10,000 points: ' + big.error);
  T.ok(/a song holds up to 50,000/.test(sizeError({ ...sz, points: 50001 }, sz) || ''), 'and the song up to 50,000 (the store refuses an op that grows past it)');
}

/* ================================================================== 4. guarded inverses */
{
  const { s, a } = baseSong();
  s.dispatch({ type: 'auto.write', track: a, param: 'gain', points: '0:-12 16:0' }, { by: 'claude' });
  s.dispatch({ type: 'auto.write', track: a, param: 'gain', points: '8:-6 12:-3' }, { by: 'you' });
  const mine = body(s);
  const u = s.undo({ by: 'claude' });
  T.ok(!u.ok && /the lane for gain on track .* was changed since in beats 0–16, so it stays/.test(u.error) && body(s) === mine, "an author's undo refuses when someone has since written into that range of that lane: " + u.error);
  const rv = s.revertAuthor('claude');
  T.ok(rv.reverted === 0 && rv.skipped.length === 1 && body(s) === mine, 'revertAuthor skips it and says why');
  // someone writing elsewhere on the lane doesn't block it, and keeps their part and their name
  const { s: s2, a: a2 } = baseSong();
  s2.dispatch({ type: 'auto.write', track: a2, param: 'gain', points: '0:-12 16:0' }, { by: 'claude' });
  s2.dispatch({ type: 'auto.write', track: a2, param: 'gain', points: '32:-6 40:-3' }, { by: 'you' });
  const u2 = s2.undo({ by: 'claude' });
  const l2 = laneAt(s2.get(), { track: a2, param: 'gain' });
  T.ok(u2.ok && formatPoints(l2.points) === '32:-6 40:-3' && l2.by === 'you', 'writing elsewhere on the lane doesn\'t block an undo, and the lane keeps the later writer\'s points and byline: ' + (u2.error || formatPoints(l2.points)));
  // an undone lane creation refuses if the lane was cleared and rewritten in that range since
  const { s: s3, a: a3 } = baseSong();
  s3.dispatch({ type: 'auto.write', track: a3, param: 'pan', points: '0:-1 4:1' }, { by: 'claude' });
  s3.dispatch({ type: 'auto.clear', track: a3, param: 'pan' }, { by: 'you' });
  s3.dispatch({ type: 'auto.write', track: a3, param: 'pan', points: '2:0.5' }, { by: 'you' });
  const u3 = s3.undo({ by: 'claude' });
  T.ok(!u3.ok && laneAt(s3.get(), { track: a3, param: 'pan' }).points.length === 1, 'undoing a lane someone has since rewritten refuses: ' + u3.error);
  // a hold is independent of the points
  const { s: s4, a: a4 } = baseSong();
  s4.dispatch({ type: 'auto.write', track: a4, param: 'pan', points: '0:-1 4:1' }, { by: 'claude' });
  s4.dispatch({ type: 'auto.set', track: a4, param: 'pan', patch: { off: true } }, { by: 'you' });
  const u4 = s4.undo({ by: 'claude' });
  T.ok(u4.ok && !laneAt(s4.get(), { track: a4, param: 'pan' }) && s4.undo().ok === false, "holding a lane doesn't block undoing its writer's points; the hold goes with the lane (then nothing is left to undo)");
}

/* ================================================================== 5. time edits carry lanes */
{
  const fresh = () => {
    const x = baseSong();
    x.s.dispatch([
      { type: 'auto.write', track: x.a, param: 'gain', points: '0:-24 16:0 32:-12' },
      { type: 'auto.write', track: x.a, insert: 'instrument', param: 'cutoff', points: '8:200 12:3200~step 16:800' },
      { type: 'auto.write', track: x.b, insert: x.fx, param: 'mix', points: '20:0 24:1' },
    ], { by: 'claude' });
    return x;
  };
  const pts = (s, addr) => formatPoints(laneAt(s.get(), addr)?.points || []);
  const vAt = (s, addr, beat) => valueAt(laneAt(s.get(), addr), beat, specFor(s.get(), addr, getDevice));
  // insert
  let x, gainA, cutA, mixB;
  const reset = () => { x = fresh(); gainA = { track: x.a, param: 'gain' }; cutA = { track: x.a, insert: 'instrument', param: 'cutoff' }; mixB = { track: x.b, insert: x.fx, param: 'mix' }; };
  reset();
  const g8 = vAt(x.s, gainA, 8), g12 = vAt(x.s, gainA, 12);
  let r = x.s.dispatch({ type: 'time.insert', at: 8, length: 4 }, { by: 'you' });
  T.ok(r.ok && near(vAt(x.s, gainA, 8), g8, 1e-9) && near(vAt(x.s, gainA, 11), g8, 1e-9) && near(vAt(x.s, gainA, 16), g12, 1e-6) && pts(x.s, mixB) === '24:0 28:1', `time.insert moves points right and holds the value at its beat across the gap (gain: ${pts(x.s, gainA)})`);
  T.ok(laneAt(x.s.get(), gainA).by === 'claude', 'a lane moved by a time edit keeps its author');
  T.ok(pts(x.s, cutA) === '12:200 16:3200~step 20:800', 'a lane that starts at the insert beat just moves (it held its first value before it anyway): ' + pts(x.s, cutA));
  x.s.undo();
  T.ok(pts(x.s, gainA) === '0:-24 16:0 32:-12' && pts(x.s, cutA) === '8:200 12:3200~step 16:800', 'undo puts the lanes back');
  // remove
  reset();
  const before4 = vAt(x.s, gainA, 4), after16 = vAt(x.s, gainA, 16), after20 = vAt(x.s, gainA, 20);
  r = x.s.dispatch({ type: 'time.remove', at: 4, length: 12 }, { by: 'you' });
  T.ok(r.ok && near(valueBefore(laneAt(x.s.get(), gainA), 4, MIXER.gain), before4, 1e-9) && near(vAt(x.s, gainA, 4), after16, 1e-9) && near(vAt(x.s, gainA, 8), after20, 1e-6), `time.remove closes the lane up: the value from before meets the value from after at the cut (${pts(x.s, gainA)})`);
  T.ok(pts(x.s, mixB) === '8:0 12:1' && pts(x.s, cutA) === '4:200 4:800', 'later points move left; a lane whose sweep was inside the cut keeps a jump: ' + pts(x.s, cutA));
  // section.duplicate with push
  reset();
  r = x.s.dispatch({ type: 'section.duplicate', section: 'Verse', push: true }, { by: 'you' });
  const g = laneAt(x.s.get(), gainA);
  let dupOk = true;
  for (let t = 0; t < 16; t += 0.5) if (!near(valueAt(g, 16 + t, MIXER.gain), valueAt(g, t, MIXER.gain), 1e-6)) dupOk = false;
  const orig = { points: normPoints(parsePoints('0:-24 16:0 32:-12')) };
  for (let t = 16; t < 33; t += 0.5) if (!near(valueAt(g, 16 + t, MIXER.gain), valueAt(orig, t, MIXER.gain), 1e-6)) dupOk = false;
  T.ok(r.ok && dupOk, 'section.duplicate (push) copies the section\'s stretch of every lane to the copy and moves the rest right: ' + formatPoints(g.points));
  T.ok(pts(x.s, cutA) === '8:200 12:3200~step 16:3200 16:200 24:200 28:3200~step 32:3200 32:800', 'a sweep in the section repeats in the copy, and what came after it follows the copy: ' + pts(x.s, cutA));
  // clip.repeat copies the lanes under the clip on that track only
  reset();
  r = x.s.dispatch({ type: 'clip.repeat', track: x.a, clip: x.c1, times: 3 }, { by: 'you' });
  const c = laneAt(x.s.get(), cutA);
  let repOk = true;
  for (let t = 8; t < 16; t += 0.25) for (const k of [1, 2]) if (!near(valueAt(c, t + 8 * k, specFor(x.s.get(), cutA, getDevice)), valueAt(c, t, specFor(x.s.get(), cutA, getDevice)), 1e-6)) repOk = false;
  T.ok(r.ok && repOk && pts(x.s, mixB) === '20:0 24:1', 'clip.repeat writes the lane under the clip into each copy (the other track\'s lanes stay): ' + pts(x.s, cutA));
  x.s.undo();
  T.ok(pts(x.s, cutA) === '8:200 12:3200~step 16:800' && pts(x.s, gainA) === '0:-24 16:0 32:-12', 'and its undo puts them back');
  reset();
  r = x.s.dispatch({ type: 'clip.repeat', track: x.a, clip: x.c1, times: 2, mode: 'loop' }, { by: 'you' });
  T.ok(r.ok && near(vAt(x.s, cutA, 21), vAt(x.s, cutA, 13), 1e-6), 'so does a loop\'s extension');
  // clip.split and a raw clip.move don't touch lanes
  reset();
  const pre = JSON.stringify(lanesOf(x.s.get()).map((l) => l.lane));
  x.s.dispatch({ type: 'clip.split', track: x.a, clip: x.c1, at: 12 }, { by: 'you' });
  x.s.dispatch({ type: 'clip.move', track: x.a, clip: x.c1, start: 40 }, { by: 'you' });
  T.ok(JSON.stringify(lanesOf(x.s.get()).map((l) => l.lane)) === pre, 'clip.split and an agent\'s raw clip.move leave lanes where they are');
  // followClips (the arranger's moves, wave B)
  reset();
  const plan = followClips(x.s.get(), [{ track: x.a, clip: x.c1, start: 40 }], { getDevice });
  r = x.s.dispatch(plan.ops, { by: 'you' });
  T.ok(r.ok && plan.lanes === 1 && near(vAt(x.s, cutA, 44), 3200, 1e-6) && near(vAt(x.s, cutA, 41), fromPos(DEVS['x.synth'].params[0], 0.5 * toPos(DEVS['x.synth'].params[0], 200) + 0.5 * toPos(DEVS['x.synth'].params[0], 3200) - 0.25 * (toPos(DEVS['x.synth'].params[0], 3200) - toPos(DEVS['x.synth'].params[0], 200))), 1e-3) && near(vAt(x.s, cutA, 12), 200, 1e-9) && near(vAt(x.s, cutA, 15), 200, 1e-9), 'followClips: a moved clip takes the lane under it to its new span and leaves the value from before it holding: ' + pts(x.s, cutA));
  reset();
  const plan2 = followClips(x.s.get(), [{ track: x.a, clip: x.c1, toTrack: x.b, start: 0, copy: true }], { getDevice });
  T.ok(plan2.ops.length >= 1 && plan2.ops.every((o) => o.track === x.b), 'across tracks a copy goes to the same params on the other track (the mixer, the same instrument)');
  r = x.s.dispatch(plan2.ops, { by: 'you' });
  T.ok(r.ok && near(vAt(x.s, { track: x.b, insert: 'instrument', param: 'cutoff' }, 4), 3200, 1e-6), '…and lands there');
  // across tracks, every point keeps who wrote it: the agent's points moved onto a lane you hold (or a new one) stay
  // the agent's, and the hold points the move leaves behind are the line they hold (the agent's here)
  {
    const y = baseSong();
    const gA = { track: y.a, param: 'gain' }, gB = { track: y.b, param: 'gain' };
    y.s.dispatch({ type: 'auto.write', ...gA, points: '0:0 10:-20 14:-3 20:0' }, { by: 'claude' });
    const fc = followClips(y.s.get(), [{ track: y.a, clip: y.c1, toTrack: y.b, start: 8 }], { getDevice });
    const rr = y.s.dispatch([{ type: 'clip.move', track: y.a, clip: y.c1, toTrack: y.b, start: 8 }, ...fc.ops], { by: 'you' });
    const LB = laneAt(y.s.get(), gB), LA = laneAt(y.s.get(), gA);
    const byOf = (L) => L.points.map((q) => `${q.t}:${pointBy(L, q)}`).join(' ');
    T.ok(rr.ok && LB && laneAuthors(LB).join() === 'claude' && LB.points.filter((q) => q.t === 10 || q.t === 14).every((q) => pointBy(LB, q) === 'claude') && laneAuthors(LA).join() === 'claude',
      `followClips across tracks: the agent's points keep the agent's name on the other track (${byOf(LB || { points: [] })}; was all "you"), and its lane stays the agent's (${byOf(LA)})`);
    // onto a lane you already hold: yours stay yours, the agent's stay the agent's
    const z = baseSong();
    z.s.dispatch({ type: 'auto.write', track: z.b, param: 'gain', points: '0:-6 32:-6' }, { by: 'you' });
    z.s.dispatch({ type: 'auto.write', track: z.a, param: 'gain', points: '0:0 10:-20 14:-3 20:0' }, { by: 'claude' });
    const fz = followClips(z.s.get(), [{ track: z.a, clip: z.c1, toTrack: z.b, start: 8 }], { getDevice });
    z.s.dispatch([{ type: 'clip.move', track: z.a, clip: z.c1, toTrack: z.b, start: 8 }, ...fz.ops], { by: 'you' });
    const LZ = laneAt(z.s.get(), { track: z.b, param: 'gain' });
    T.ok(laneAuthors(LZ).join() === 'you,claude' && pointBy(LZ, LZ.points.find((q) => q.t === 10)) === 'claude' && pointBy(LZ, LZ.points[0]) === 'you',
      `…and onto a lane you hold, it reads "you and Claude" (${byOf(LZ)})`);
  }
}

/* ================================================================== 6. pure helpers */
{
  const sp = shapePoints('hold', { from: 8, to: 16, v0: 0.2, v1: 0.9 });
  T.ok(formatPoints(sp) === '8:0.2 8.5:0.9 15.5:0.9 16:0.2', 'shapePoints hold: half-beat ramps in and out: ' + formatPoints(sp));
  T.ok(formatPoints(shapePoints('ramp', { from: 0, to: 16, v0: -60, v1: -6 })) === '0:-60 16:-6' && formatPoints(shapePoints('swell', { from: 0, to: 8, v0: 0, v1: 1 })) === '0:0 4:1 8:0', 'ramp and swell');
  T.ok(shapePoints('pulse', { from: 0, to: 4, v0: 0, v1: 1 }).length === 5 && shapePoints('pulse', { from: 0, to: 4, v0: 0, v1: 1 })[0].c === 'step', 'pulse: a step every beat');
  let threw = ''; try { shapePoints('wobble', { from: 0, to: 4, v0: 0 }); } catch (e) { threw = e.message; }
  T.ok(/unknown shape "wobble" \(ramp, swell, dip, hold, flat, pulse\)/.test(threw), 'an unknown shape says which there are');
  const cut = DEVS['x.synth'].params[0];
  const raw = Array.from({ length: 401 }, (_, i) => ({ t: i / 25, v: fromPos(cut, i < 200 ? i / 200 : 1) }));
  const th = thin(raw, 0.005, cut);
  T.ok(th.length <= 4 && th[0].t === 0 && th[th.length - 1].t === 16, `thin: a recorded sweep of 401 points (straight in travel, then flat) thins to ${th.length}`);
  const pr = pointsPrint([{ t: 1, v: 2 }, { t: 2, v: 3, c: 'step' }]);
  T.ok(pr === '[[1,2],[2,3,"step"]]', 'pointsPrint: a compact print for guarded inverses');
  T.ok(laneKey({ track: 't_x', insert: 'instrument', param: 'cutoff' }) === 't_x/instrument/cutoff' && laneKey({ track: 'master', param: 'gain' }) === 'master/gain', 'laneKey');
  const w = cutLane(parsePoints('0:0 8:1 16:0'), 4, 12, MIXER.pan);
  T.ok(formatPoints(w) === '0:0.5 4:1 8:0.5', 'cutLane: the window with its edge values, from 0: ' + formatPoints(w));
  T.ok(formatPoints(spliceLane(normPoints(parsePoints('0:0 16:1')), 4, 8, parsePoints('4:-1 8:-1'), MIXER.pan)) === '0:0 4:0.25 4:-1 8:-1 8:0.5 16:1', 'spliceLane joins to the lane either side (a jump in and out)');
  T.ok(formatPoints(insertTime(parsePoints('0:0 8:1'), 4, 4, MIXER.pan)) === '0:0 4:0.5 8:0.5 12:1' && formatPoints(removeTime(parsePoints('0:0 8:1'), 2, 4, MIXER.pan)) === '0:0 2:0.25 2:0.75 4:1', 'insertTime / removeTime');
}

/* ================================================================== 6b. the lane menu's Ramp up / Ramp down (ui/lanes.js) */
// FRESH-EYES-5 producer: on a level 30 Hz stretch, Ramp up over bar 3 rose to 735 Hz and fell straight back to 30 Hz, so
// the chorus stayed filtered to nothing. A ramp goes to where the lane is going and holds there.
{
  const { shapeLane, rampPlan } = await import('../app/src/ui/lanes.js');
  const cut = paramSpec({ key: 'cutoff', min: 30, max: 18000, curve: 'log', unit: 'Hz' });   // Keyhole's cutoff
  const lane = (s) => normPoints(parsePoints(s), cut);
  const at = (pts, b) => Math.round(valueAt(pts, b, cut));
  // level after the range: up, then held through the chorus (bars 5-8), not back down at bar 4
  const level = lane('0:2000 8:30 16:30');
  const up = shapeLane('ramp-up', level, cut, 8, 12, 5000);
  T.ok(at(up, 8) === 30 && at(up, 12) === 735 && at(up, 14) === 735 && at(up, 20) === 735 && at(up, 31) === 735 && at(up, 4) === at(level, 4),
    `Ramp up over bar 3 on a level 30 Hz rises to 735 Hz and holds there through the chorus (${formatPoints(up)}; bar 6 at ${at(up, 20)} Hz, was ${at(level, 20)})`);
  // the lane jumps up at the chorus: the ramp goes there, held from the end of the bar up to the jump
  const jumps = lane('0:30 16:30 16:18000 32:18000');
  const into = shapeLane('ramp-up', jumps, cut, 8, 12, 5000);
  const plan = rampPlan?.(1, jumps, cut, 8, 12, 5000);
  T.ok(at(into, 12) === 18000 && at(into, 14) === 18000 && at(into, 20) === 18000 && plan?.how === 'jump' && plan.until === 16,
    `Ramp up over bar 3 before a chorus that opens to 18 kHz goes to 18 kHz and holds into it (${formatPoints(into)})`);
  // Ramp down mirrors it
  const dn = shapeLane('ramp-down', lane('0:18000 32:18000'), cut, 8, 12, 5000);
  T.ok(at(dn, 12) === 735 && at(dn, 20) === 735 && at(dn, 4) === 18000, `Ramp down on a level 18 kHz falls to 735 Hz and holds there (${formatPoints(dn)})`);
  // bars that already ramp there: the same points (nothing to do; the menu says so), its plan says it joins the lane
  const ramps = lane('0:2000 8:253 16:18000 32:18000');
  T.ok(formatPoints(shapeLane('ramp-up', ramps, cut, 8, 16, 5000)) === formatPoints(ramps) && rampPlan?.(1, ramps, cut, 8, 16, 5000).how === 'joins', 'Ramp up over bars that already ramp up into the chorus leaves the lane as it is');
  // a later move of the lane's own is kept: held until it, then the lane goes on as it was
  const later = lane('0:30 24:30 28:6000');
  const kept = shapeLane('ramp-up', later, cut, 8, 12, 5000);
  T.ok(at(kept, 20) === 735 && kept.some((x) => x.t === 24 && x.v === 30) && at(kept, 28) === 6000, `held until the lane's own next move (bar 7), which stays as it was (${formatPoints(kept)})`);
  // no lane yet: the bars before keep the knob's value
  const fresh = shapeLane('ramp-up', [], cut, 32, 36, 12000);
  T.ok(at(fresh, 4) === 12000 && at(fresh, 36) === 12000 && at(fresh, 33) < 12000, `a ramp on an empty lane leaves the bars before at the knob's 12 kHz (${formatPoints(fresh)})`);
}

/* ================================================================== 7. DAWproject */
{
  const { s, a, b, fx } = baseSong();
  s.dispatch([
    { type: 'auto.write', track: a, param: 'gain', points: '0:-60 4:-6' },
    { type: 'auto.write', track: a, param: 'pan', points: '0:-1 8:1~step 12:0' },
    { type: 'auto.write', track: a, insert: 'instrument', param: 'drive', points: '0:0 8:1' },
    { type: 'auto.write', track: b, insert: fx, param: 'time', points: '0:100 4:1000' },
    { type: 'auto.write', track: b, insert: fx, param: 'mix', points: '0:0 4:1' },
    { type: 'auto.set', track: b, insert: fx, param: 'mix', patch: { off: true } },
    { type: 'auto.write', track: 'master', param: 'gain', points: '0:0 2:-3' },
  ], { by: 'you' });
  const x = dawprojectXml(s.get(), { getDevice });
  const xml = x.project;
  const points = [...xml.matchAll(/<Points id="(id\d+)" unit="([a-z]+)">\s*<Target parameter="(id\d+)"\/>([\s\S]*?)<\/Points>/g)];
  const idOf = (re) => (re.exec(xml) || [])[1];
  const target = (unit) => points.filter((m) => m[2] === unit).map((m) => m[3]);
  const vols = [...xml.matchAll(/<Volume id="(id\d+)"/g)].map((m) => m[1]), pans = [...xml.matchAll(/<Pan id="(id\d+)"/g)].map((m) => m[1]);
  T.ok(x.lanes === 5 && points.length === 5, `five lanes go out as <Points> (the held one stays behind): ${points.length}`);
  T.ok(target('linear').includes(vols[0]) && target('linear').includes(vols[vols.length - 1]) && target('normalized').includes(pans[0]), 'each targets its parameter: the track and master Volume, the Pan');
  const drive = idOf(/<RealParameter id="(id\d+)" name="DRIVE"/), time = idOf(/<RealParameter id="(id\d+)" name="TIME"/);
  T.ok(points.some((m) => m[3] === drive) && points.some((m) => m[3] === time && m[2] === 'seconds'), 'device params target their placeholder RealParameter (ms as seconds)');
  const pan = points.find((m) => m[3] === pans[0]);
  const panPts = [...pan[4].matchAll(/<RealPoint time="([\d.]+)" value="([\d.]+)" interpolation="(\w+)"/g)].map((m) => [+m[1], +m[2], m[3]]);
  T.ok(JSON.stringify(panPts) === '[[0,0,"linear"],[8,1,"hold"],[12,0.5,"linear"]]', 'pan: straight stays straight (normalized), a step is hold: ' + JSON.stringify(panPts));
  const vol = points.find((m) => m[3] === vols[0]);
  const volPts = [...vol[4].matchAll(/<RealPoint time="([\d.]+)" value="([\d.e-]+)"/g)].map((m) => [+m[1], +m[2]]);
  const midV = volPts.find((q) => q[0] === 2);
  T.ok(volPts.length === 65 && near(midV[1], 10 ** (valueAt(laneAt(s.get(), { track: a, param: 'gain' }), 2, MIXER.gain) / 20), 1e-5), `a fader move is sampled every 1/16 beat in linear gain (${volPts.length} points)`);
  T.ok(x.warnings.length === 1 && /mix lane is held/.test(x.warnings[0]), 'the held lane is left out with a warning: ' + x.warnings[0]);
  const ids = [...xml.matchAll(/ id="(id\d+)"/g)].map((m) => m[1]);
  T.ok(new Set(ids).size === ids.length && points.every((m) => ids.includes(m[3])), 'ids stay unique and every Target resolves');
}

/* ================================================================== 7b. second fresh eyes (docs/FRESH-EYES-2.md) */
{
  // several clips moved right together (the arranger sends them in track order): each takes its own lane along
  const mk2 = () => {
    const s = createStore(createProject({ title: 'Group' }), { getDevice });
    const r = s.dispatch([
      { type: 'track.add', ref: 'a', track: { name: 'Keys', instrument: { device: 'x.synth' } } },
      { type: 'clip.add', track: '$a', ref: 'A', clip: { start: 0, length: 4, notes: 'C4@0:1' } },
      { type: 'clip.add', track: '$a', ref: 'B', clip: { start: 4, length: 4, notes: 'E4@0:1' } },
      { type: 'auto.write', track: '$a', param: 'gain', points: '0:-20 2:-10 4:-20 6:0 8:-20 12:-20' },
    ], { by: 'you' });
    return { s, a: r.created.a, A: r.created.A, B: r.created.B };
  };
  const want = '0:-20 4:-20 6:-10 8:-20 10:0 12:-20';
  const run = (order) => {
    const x = mk2();
    const mv = { A: { track: x.a, clip: x.A, start: 4 }, B: { track: x.a, clip: x.B, start: 8 } };
    const moves = order.map((k) => mv[k]);
    const plan = followClips(x.s.get(), moves, { getDevice });
    const r = x.s.dispatch([...moves.map((m) => ({ type: 'clip.move', track: m.track, clip: m.clip, start: m.start })), ...plan.ops], { by: 'you' });
    return r.ok ? formatPoints(laneAt(x.s.get(), { track: x.a, param: 'gain' }).points) : r.error;
  };
  const ab = run(['A', 'B']), ba = run(['B', 'A']);
  T.ok(ab === want && ba === want, `followClips: two clips moved one clip right together each take their own lane, in either order (A, B: ${ab}; B, A: ${ba})`);

  // a recorded or drawn staircase on a switch keeps every step
  const sync = paramSpec({ key: 'sync', label: 'SYNC', opts: ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/2T', '1/4T', '1/8T', '1/16T', '1/2D', '1/4D'], def: 3 });
  const stair = [];
  for (let i = 0; i <= 7; i++) stair.push({ t: 8 + i * 0.5, v: 3 + i });
  stair.push({ t: 11.5, v: 10 });
  const ts = thin(stair, 0.005, sync);
  const hand = [8.6, 9.1, 9.6, 10.1, 10.6, 11.1].map((b) => valueAt(normPoints(ts, sync), b, sync));
  T.ok(hand.join() === '4,5,6,7,8,9' && ts.every((p) => p.c === 'step'), `thin keeps a switch's every step (the hand at 4..9, the lane reads ${hand.join(', ')}; ${ts.length} points)`);
  const held = thin([{ t: 0, v: 2 }, { t: 1, v: 2 }, { t: 2, v: 2 }, { t: 3, v: 5 }, { t: 4, v: 5 }], 0.005, sync);
  T.ok(formatPoints(held) === '0:2~step 3:5~step 4:5~step', 'and drops the points where the setting didn\'t change: ' + formatPoints(held));

  // a knob whose step is only its resolution ramps and bends; a switch or a few-setting param steps
  const micpos = paramSpec({ key: 'micpos', label: 'MIC POS', min: 0, max: 1.35, def: 0.5, step: 0.01 });
  const eq = paramSpec({ key: 'b1k', label: '1K', min: -15, max: 15, def: 0, step: 0.5, unit: 'dB' });
  const ms = paramSpec({ key: 'ms', label: 'TIME', min: 20, max: 2000, def: 300, step: 1, unit: 'ms' });
  const div = paramSpec({ key: 'time', label: 'TIME', min: 0, max: 5, def: 2, step: 1 });
  const mp = normPoints([{ t: 0, v: 0 }, { t: 16, v: 1.35 }], micpos);
  const bent = normPoints([{ t: 0, v: -15, c: 0.5 }, { t: 8, v: 15 }], eq);
  T.ok(near(valueAt(mp, 8, micpos), 0.675, 1e-9) && mp.every((p) => p.c === undefined) && bent[0].c === 0.5 && valueAt(bent, 4, eq) < 0 && near(valueAt(normPoints([{ t: 0, v: 20 }, { t: 4, v: 2000 }], ms), 2, ms), 1010, 1e-9),
    `a mic position (step 0.01), an EQ band (0.5 dB) and a delay time (1 ms) ramp and keep their bends (mic at beat 8 of 16: ${valueAt(mp, 8, micpos)})`);
  T.ok(formatPoints(normPoints([{ t: 0, v: 0.333 }, { t: 4, v: 7.26 }], eq)) === '0:0.5 4:7.5' && valueAt(normPoints([{ t: 0, v: 0 }, { t: 4, v: 5 }], div), 3.9, div) === 0 && segmentsIn(normPoints([{ t: 0, v: 0 }, { t: 4, v: 5 }], div), 0, 4, div).every((g) => g.c === 'step'),
    'their points still snap to the step; a note division (0..5, step 1) still steps');

  // an out-of-range value from an old file doesn't block the arrangement's edits
  const raw = JSON.parse(JSON.stringify(baseSong().s.get()));
  raw.tracks[0].instrument.auto = { cutoff: { points: [{ t: 0, v: 400 }, { t: 8, v: 20000 }], by: 'you' } };
  const s3 = createStore(cleanProject(raw), { getDevice });
  const tid = s3.get().tracks[0].id, cid = s3.get().tracks[0].clips[0].id;
  const r1 = s3.dispatch(planTimeInsert(s3.get(), { at: 4, length: 4 }, { getDevice }).ops, { by: 'you' });
  const after1 = formatPoints(laneAt(s3.get(), { track: tid, insert: 'instrument', param: 'cutoff' }).points);
  const r2 = s3.dispatch({ type: 'clip.repeat', track: tid, clip: cid, times: 2 }, { by: 'you' });
  const fc = followClips(s3.get(), [{ track: tid, clip: cid, start: 40 }], { getDevice });
  const r3 = s3.dispatch([{ type: 'clip.move', track: tid, clip: cid, start: 40 }, ...fc.ops], { by: 'you' });
  let refused = ''; try { const q = s3.dispatch({ type: 'auto.write', track: tid, insert: 'instrument', param: 'cutoff', points: '0:20000' }, { by: 'you' }); refused = q.ok ? '' : q.error; } catch (e) { refused = e.message; }
  T.ok(r1.ok && r2.ok && r3.ok && /12:16000/.test(after1) && /goes from 40 to 16000/.test(refused), `a lane value out of range (20000 Hz on a 40..16000 cutoff, from a file) doesn't block time insert, clip repeat or a clip move: it is clamped as it moves (${after1}); a write of one is still refused`);
  const und = [s3.undo(), s3.undo(), s3.undo()];
  T.ok(und.every((u) => u.ok) && JSON.stringify(laneAt(s3.get(), { track: tid, insert: 'instrument', param: 'cutoff' }).points) === '[{"t":0,"v":400},{"t":8,"v":20000}]', 'and undo puts the lane back exactly as the file had it');
}

/* ------------------------------------------------------------------ the canonical render: kernel lanes through the tail, ramps on fine-step knobs */
{
  const { defineDevice } = await import('../app/src/devices/registry.js');
  const { renderSong } = await import('../app/src/engine/node/render.js');
  const { PROBE } = await import('./probe-kernel.js');
  defineDevice(PROBE, { replace: true });
  defineDevice({ id: 'test.probefine', name: 'Probe fine', kind: 'effect', cat: 'utility', version: 1,
    params: [{ key: 'x', label: 'X', min: 0, max: 1.35, def: 0, step: 0.01 }, { key: 'm', label: 'M', min: 0, max: 5, def: 0, step: 1 }],
    kernel: `({ create() { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] = p.x; R[i] = p.m; } } }; } })` }, { replace: true });
  const song = (device, auto) => ({ format: 'overdub/0', id: 'p_tail01', title: 'T', tempo: 120, meter: [4, 4], key: null, loop: { on: false, start: 0, end: 4 }, sections: [], devices: {}, assets: {}, meta: {},
    master: { gain: 0, inserts: [] },
    tracks: [{ id: 't_p', name: 'probe', kind: 'audio', instrument: null, inserts: [{ id: 'fx_p', device, on: true, params: {}, auto }], clips: [], gain: 0, pan: 0, mute: false, solo: false }] });
  const SR = 48000, at = (r, ch, beat) => r.channels[ch][Math.round(beat * 0.5 * SR)];
  // a cut that starts after `to`, in the tail: the Node render plays it as the browser's does
  const r = renderSong(song('test.probe', { v: { points: [{ t: 0, v: 0.6 }, { t: 4.5, v: 0.6 }, { t: 5, v: 0 }] } }), { from: 0, to: 4, tail: 3 });
  T.ok(near(at(r, 0, 3, 0), 0.6, 1e-4) && Math.abs(at(r, 0, 7)) < 1e-4, `the Node render follows a kernel's lane into the tail (beat 3: ${at(r, 0, 3).toFixed(4)}, beat 7, after a cut at 4.5–5: ${at(r, 0, 7).toFixed(4)})`);
  // a fine-step knob ramps in the kernel (the worklet's own rule), a note division steps
  const f = renderSong(song('test.probefine', { x: { points: [{ t: 0, v: 0 }, { t: 8, v: 1.35 }] }, m: { points: [{ t: 0, v: 0 }, { t: 8, v: 5 }] } }), { from: 0, to: 8, tail: 0 });
  T.ok(near(at(f, 0, 4), 0.68, 0.02) && at(f, 1, 7.5) === 0, `in the render too: a step-0.01 knob ramps (half way: ${at(f, 0, 4).toFixed(3)}), a 0..5 division holds until its point (${at(f, 1, 7.5)} at beat 7.5)`);
}

/* ================================================================== 7b. who wrote each point; the lane as drawn */
{
  const { s, a } = baseSong();
  const G = { track: a, param: 'gain' };
  s.dispatch({ type: 'auto.write', ...G, points: '0:-20 16:-6' }, { by: 'you', label: 'mine' });
  const mine = body(s);
  const l0 = laneAt(s.get(), G);
  T.ok(l0.by === 'you' && l0.points.every((x) => !('by' in x)) && laneAuthors(l0).join() === 'you', 'a lane one author wrote carries no by on its points (as before): ' + JSON.stringify(l0.points));
  // the agent fades out after it, and rewrites my bar-5 point unchanged as the start of its range
  const r = s.dispatch({ type: 'auto.write', ...G, points: '16:-6 24:-30 32:-60' }, { by: 'claude', label: 'theirs' });
  const l1 = laneAt(s.get(), G);
  const who = l1.points.map((x) => `${x.t}:${pointBy(l1, x)}`).join(' ');
  T.ok(r.ok && l1.by === 'claude' && who === '0:you 16:you 24:claude 32:claude', `points keep who wrote them: mine stay mine (the one the agent rewrote unchanged too), the agent's are its own (${who})`);
  T.ok(laneAuthors(l1).join() === 'you,claude', 'laneAuthors: you, then the agent (' + laneAuthors(l1).join() + ')');
  // a move of my point by the agent signs it the agent's
  s.dispatch({ type: 'auto.write', ...G, from: 0, to: 0, points: '0:-12' }, { by: 'claude', label: 'moved mine' });
  const l2 = laneAt(s.get(), G);
  T.ok(pointBy(l2, l2.points[0]) === 'claude' && pointBy(l2, l2.points[1]) === 'you', 'a point the agent changed is the agent\'s; the rest stay as they were');
  s.undo(); s.undo();
  T.ok(body(s) === mine, 'undo puts the lane back byte for byte (one author, no by on any point)');
  s.redo(); s.redo();
  const l3 = laneAt(s.get(), G);
  T.ok(l3.points.map((x) => pointBy(l3, x)).join() === 'claude,you,claude,claude', 'and redo signs them the same way again');
  // the author survives a time insert and a save
  const r2 = s.dispatch({ type: 'time.insert', at: 8, length: 4 }, { by: 'you', label: 'insert' });
  const l4 = laneAt(s.get(), G);
  T.ok(r2.ok && pointBy(l4, l4.points.find((x) => x.t === 20)) === 'you' && pointBy(l4, l4.points.find((x) => x.t === 36)) === 'claude', 'a time insert moves points with their authors: ' + l4.points.map((x) => `${x.t}:${pointBy(l4, x)}`).join(' '));
  const again = cleanProject(JSON.parse(JSON.stringify(s.get())));
  T.ok(JSON.stringify(laneAt(again, G)) === JSON.stringify(laneAt(s.get(), G)), 'cleanProject keeps each point\'s author');
  const nl = normLane({ points: [{ t: 0, v: 1, by: 'claude' }, { t: 4, v: 2, by: 'you' }, { t: 8, v: 3 }], by: 'you' });
  T.ok(JSON.stringify(nl.points) === '[{"t":0,"v":1,"by":"claude"},{"t":4,"v":2},{"t":8,"v":3}]', 'normLane drops a point\'s by when it is the lane\'s: ' + JSON.stringify(nl.points));

  // the gain lane as drawn and edited: its travel ends at the fader's +6 dB, the same line scaled
  const V = laneView(MIXER.gain);
  T.ok(V.max === FADER_TOP && FADER_TOP === 6 && near(toPos(V, 6), 1) && near(fromPos(V, 1), 6) && fromPos(V, 0) === -96 && MIXER.gain.max === 24, `laneView: the gain lane tops out at +6 dB (top: ${fromPos(V, 1)} dB); the core still takes +24`);
  let worst = 0;
  for (let k = 0; k <= 200; k++) { const db = -96 + (k / 200) * 102; worst = Math.max(worst, Math.abs(fromPos(V, toPos(V, db)) - db)); }
  const ln = [{ t: 0, v: -36 }, { t: 8, v: 4 }];
  let worst2 = 0;
  for (let b = 0; b <= 8; b += 0.25) worst2 = Math.max(worst2, Math.abs(valueAt(ln, b, V) - valueAt(ln, b, MIXER.gain)));
  T.ok(worst < 1e-9 && worst2 < 1e-9 && laneView(MIXER.pan) === MIXER.pan, `and round-trips (worst ${worst.toExponential(1)} dB); a line reads the same in either scaling (worst ${worst2.toExponential(1)} dB); other specs are as they were`);
}

/* ================================================================== 8. the fuzz: every undo exact */
{
  let seed = SEED >>> 0;
  const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let z = seed; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const AUTHORS = ['you', 'claude', 'mcp:x'];
  let base = baseSong();
  const addrs = () => {
    const p = base.s.get(), t0 = p.tracks[0], t1 = p.tracks[1];
    const out = [{ track: 'master', param: 'gain' }];
    for (const t of [t0, t1]) {
      if (!t) continue;
      out.push({ track: t.id, param: 'gain' }, { track: t.id, param: 'pan' });
      if (t.instrument?.device === 'x.synth') out.push({ track: t.id, insert: 'instrument', param: pick(['cutoff', 'drive', 'wave']) });
      for (const fx of t.inserts) out.push({ track: t.id, insert: fx.id, param: pick(['mix', 'time']) });
    }
    for (const fx of p.master.inserts) out.push({ track: 'master', insert: fx.id, param: 'time' });
    return out;
  };
  const randPoints = (spec, n) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = rnd() < 0.5 ? Math.floor(rnd() * 64) / 2 : Math.round(rnd() * 64 * 1024) / 1024;
      const v = spec ? fromPos(spec, rnd()) : rnd();
      const c = rnd() < 0.6 ? undefined : rnd() < 0.5 ? 'step' : Math.round((rnd() * 2 - 1) * 100) / 100;
      pts.push(c === undefined ? { t, v } : { t, v, c });
    }
    return pts;
  };
  const randOp = () => {
    const p = base.s.get();
    const k = rnd();
    const ad = pick(addrs());
    const spec = specFor(p, ad, getDevice);
    if (k < 0.34) {
      const pts = randPoints(spec, Math.floor(rnd() * 6));
      const op = { type: 'auto.write', ...ad, points: rnd() < 0.3 ? formatPoints(pts) : pts };
      if (rnd() < 0.4 || !pts.length) { const a = Math.floor(rnd() * 40); op.from = a; op.to = a + Math.floor(rnd() * 24); op.points = pts.filter((x) => x.t >= op.from && x.t <= op.to); }
      return op;
    }
    if (k < 0.46) { const op = { type: 'auto.clear', ...ad }; if (rnd() < 0.6) { op.from = Math.floor(rnd() * 32); op.to = op.from + Math.floor(rnd() * 16); } return op; }
    if (k < 0.56) return { type: 'auto.set', ...ad, patch: { off: rnd() < 0.5 } };
    if (k < 0.64) return { type: 'time.insert', at: Math.floor(rnd() * 16) * 2, length: pick([1, 2, 4, 8]) };
    if (k < 0.72) return { type: 'time.remove', at: Math.floor(rnd() * 16) * 2, length: pick([1, 2, 4, 8]) };
    if (k < 0.78) return { type: 'section.duplicate', section: pick(p.sections)?.id || 'Verse', push: rnd() < 0.6 };
    if (k < 0.84) { const t = pick(p.tracks); const c = t && pick(t.clips); return c ? { type: 'clip.repeat', track: t.id, clip: c.id, times: pick([2, 3]), mode: pick(['copies', 'loop']) } : { type: 'auto.set', ...ad, patch: { off: true } }; }
    if (k < 0.88) { const t = pick(p.tracks); return t && t.inserts.length ? { type: 'insert.remove', track: t.id, insert: t.inserts[0].id } : { type: 'auto.clear', ...ad }; }
    if (k < 0.91) { const t = pick(p.tracks); return t ? { type: 'instrument.set', track: t.id, device: pick(['x.synth', 'x.other']) } : { type: 'auto.clear', ...ad }; }
    if (k < 0.93 && p.tracks.length > 1) return { type: 'track.remove', track: p.tracks[1].id };
    if (k < 0.97) { // a planned follow (wave B's arranger): one or two clip moves
      const t = pick(p.tracks); const c = t && pick(t.clips);
      if (!c) return { type: 'auto.set', ...ad, patch: { off: false } };
      return { plan: followClips(p, [{ track: t.id, clip: c.id, start: Math.floor(rnd() * 32), copy: rnd() < 0.5, toTrack: rnd() < 0.3 ? pick(p.tracks).id : undefined }], { getDevice }).ops };
    }
    return { type: 'auto.write', ...ad, points: randPoints(spec, 1 + Math.floor(rnd() * 3)) };
  };
  const canonical = (p) => {
    for (const l of lanesOf(p)) {
      const pts = l.lane.points;
      if (JSON.stringify(normPoints(pts)) !== JSON.stringify(pts)) return `${l.key} isn't canonical: ${formatPoints(pts)}`;
      if (JSON.stringify(Object.keys(l.lane)) !== (l.lane.off ? '["points","off","by"]' : '["points","by"]')) return `${l.key} keys ${Object.keys(l.lane)}`;
      // (a point's own by only when it isn't the lane's: one form per lane, so undo can be byte for byte)
      if (pts.some((x) => 'by' in x && (x.by === l.lane.by || typeof x.by !== 'string'))) return `${l.key} signs a point with the lane's own by`;
    }
    const hosts = [...p.tracks.flatMap((t) => [t, t.instrument, ...t.inserts]), p.master, ...p.master.inserts].filter(Boolean);
    for (const h of hosts) if (h.auto) { const ks = Object.keys(h.auto); if (!ks.length || ks.join() !== [...ks].sort().join() || ks.some((k) => !h.auto[k].points.length)) return 'an auto map is empty or unsorted'; }
    return null;
  };
  const whyRefused = new Map();
  let ops = 0, refused = 0, undos = 0, bad = 0, outOfOrder = 0, outRefused = 0, outRedone = 0, reverts = 0, sequences = 0, maxLanes = 0;
  const fail = (msg) => { if (bad++ < 5) T.note(msg); };
  for (let q = 0; q < SEQS; q++) {
    if (q % 50 === 0 || songSize(base.s.get()).points > 3000 || songSize(base.s.get()).end > 2000 || base.s.get().tracks.length < 2) base = baseSong();
    const s = base.s;
    const start = body(s);
    const n = 1 + Math.floor(rnd() * 5);
    let done = 0;
    for (let i = 0; i < n; i++) {
      const op = randOp();
      const by = pick(AUTHORS);
      const b0 = body(s);
      const r = op.plan ? (op.plan.length ? s.dispatch(op.plan, { by }) : { ok: false, error: 'empty plan' }) : s.dispatch(op, { by });
      ops++;
      if (!r.ok) { refused++; const k = `${op.type || 'plan'}: ${String(r.error).replace(/^op \d+ of \d+ \(([^)]*)\) failed: /, '$1: ').replace(/[`"][^`"]*[`"]|\d+(\.\d+)?/g, '…').slice(0, 70)}`; whyRefused.set(k, (whyRefused.get(k) || 0) + 1); if (body(s) !== b0) fail(`a refused ${op.type || 'plan'} changed the song: ${r.error}`); continue; }
      done++;
      const b1 = body(s);
      const why = canonical(s.get());
      if (why) fail(`after ${op.type || 'plan'}: ${why}`);
      if (q % 20 === 0) { const c = cleanProject(JSON.parse(JSON.stringify(s.get()))); if (JSON.stringify({ ...c, meta: null }) !== b1) fail(`cleanProject changed the song after ${op.type || 'plan'}`); }
      const u = s.undo(); undos++;
      if (!u.ok || body(s) !== b0) { fail(`undo of ${JSON.stringify(op).slice(0, 200)} is not exact: ${u.error || 'differs'}`); base = baseSong(); break; }
      const rr = s.redo();
      if (!rr.ok || body(s) !== b1) { fail(`redo of ${op.type || 'plan'} is not exact: ${rr.error || 'differs'}`); base = baseSong(); break; }
      maxLanes = Math.max(maxLanes, lanesOf(s.get()).length);
    }
    if (base.s !== s) continue;
    // an out-of-order undo by one author either refuses and changes nothing, or goes through; one that goes through
    // redoes exactly (History's Undo on one author's line, then ⌘⇧Z), and so does a revert of everything by one author
    if (rnd() < 0.3 && done > 1) {
      const by = pick(AUTHORS);
      const b0 = body(s);
      const later = s.history.length && s.history[s.history.length - 1].by !== by;   // someone's edit after it is kept
      const u = s.undo({ by });
      outOfOrder++;
      if (!u.ok) { outRefused++; if (body(s) !== b0) fail('a refused out-of-order undo changed the song'); }
      else {
        done = -1; const why = canonical(s.get()); if (why) fail('after an out-of-order undo: ' + why);
        if (rnd() < 0.5) { const rr = s.redo(); if (!rr.ok || body(s) !== b0) fail(`redo of an out-of-order undo by ${by} is not exact: ${rr.error || 'differs'}`); else if (later) outRedone++; }
      }
    } else if (rnd() < 0.1 && done > 1) {
      const by = pick(AUTHORS);
      const b0 = body(s);
      const rv = s.revertAuthor(by);
      if (rv.reverted) {
        done = -1;
        const rr = s.redo();
        if (!rr.ok || body(s) !== b0) fail(`redo of a revert of ${rv.reverted} by ${by} is not exact: ${rr.error || 'differs'}`); else reverts++;
      }
    }
    // the whole sequence undoes back to where it started, half the time
    if (done > 0 && rnd() < 0.5) {
      for (let i = 0; i < done; i++) { if (!s.undo().ok) { fail('a sequence undo refused'); break; } undos++; }
      if (body(s) !== start) fail(`sequence ${q} didn't undo back to its start`);
    }
    sequences++;
  }
  T.ok(bad === 0, `fuzz: ${sequences} sequences, ${ops} ops (${refused} refused, changing nothing), ${undos} undos: every undo exact, every redo exact, every lane canonical (up to ${maxLanes} lanes at once)`);
  T.note('refused, by why: ' + [...whyRefused].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${n}× ${k}`).join(' | '));
  T.ok(outOfOrder > 10, `out-of-order undos by one author: ${outOfOrder} (${outRefused} refused, changing nothing)`);
  T.ok(outRedone > 10 && reverts > 5, `and they redo: ${outRedone} undos of one author's change with a later edit kept, and ${reverts} reverts of one author's changes, each redone exactly ("nothing to redo" before)`);
}

T.done();
