// core/automation.js: lanes, their values between points, the text form, shapes, thinning and the time windows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIXER, paramSpec, discrete, specFor, dbToPos, posToDb, toPos, fromPos, laneView, bend, valueAt, valueBefore,
  segmentsIn, posAt, laneKey, lanesOf, laneAt, laneHost, normCurve, mkPoint, pointBy, laneAuthors, normPoints, normLane,
  normAuto, parsePoints, formatPoints, pointsPrint, shapePoints, thin, cutLane, spliceLane, insertTime, removeTime, rt,
} from '../../app/src/core/automation.js';

const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} ≈ ${b}`);
const LIN = paramSpec({ key: 'mix', min: 0, max: 1 });
const LOG = paramSpec({ key: 'cutoff', min: 20, max: 20000, curve: 'log' });
const MODE = paramSpec({ key: 'mode', opts: ['a', 'b', 'c'] });
const SEMIS = paramSpec({ key: 'semi', min: -12, max: 12, step: 1 });
const HZ = paramSpec({ key: 'hz', min: 0, max: 1000, step: 10 });

describe('specs', () => {
  test('paramSpec reads arrays, switches and fills defaults', () => {
    assert.deepEqual(paramSpec(['drive', 'DRIVE', 0, 10, 2, 0.5]), { key: 'drive', label: 'DRIVE', min: 0, max: 10, def: 2, step: 0.5, curve: 'lin' });
    assert.deepEqual([MODE.min, MODE.max, MODE.step], [0, 2, 1]);
    assert.equal(paramSpec(null), null);
    assert.deepEqual([paramSpec({ key: 'x' }).min, paramSpec({ key: 'x' }).max, paramSpec({ key: 'x' }).step], [0, 1, 0]);
  });
  test('discrete: switches and whole steps up to 24 settings; a resolution step is continuous', () => {
    assert.ok(discrete(MODE));
    assert.ok(discrete(SEMIS));
    assert.ok(!discrete(HZ));
    assert.ok(!discrete(LIN));
    assert.ok(!discrete(MIXER.gain));
    assert.ok(!discrete(null));
  });
  test('specFor finds the mixer, the instrument and an insert param', () => {
    const p = {
      tracks: [{ id: 't1', name: 'Bass', instrument: { device: 'dev.syn' }, inserts: [{ id: 'fx1', device: 'dev.fx' }] }],
      master: { inserts: [{ id: 'm1', device: 'dev.fx' }] },
      devices: { 'dev.syn': { params: [{ key: 'cutoff', min: 20, max: 20000, curve: 'log' }] } },
    };
    const getDevice = (id) => (id === 'dev.fx' ? { params: [['mix', 'MIX', 0, 1, 0.5]] } : null);
    assert.equal(specFor(p, { track: 't1', param: 'gain' }), MIXER.gain);
    assert.equal(specFor(p, { track: 'bass', param: 'pan' }), MIXER.pan);
    assert.equal(specFor(p, { track: 't1', param: 'nope' }), null);
    assert.equal(specFor(p, { track: 'master', param: 'gain' }), MIXER.gain);
    assert.equal(specFor(p, { track: 'master', param: 'pan' }), null);
    assert.equal(specFor(p, { track: 't1', insert: 'instrument', param: 'cutoff' }).curve, 'log');
    assert.equal(specFor(p, { track: 't1', insert: 'fx1', param: 'mix' }, getDevice).max, 1);
    assert.equal(specFor(p, { track: 'master', insert: 'm1', param: 'mix' }, getDevice).key, 'mix');
    assert.equal(specFor(p, { track: 't1', insert: 'fx1', param: 'mix' }), null); // the device isn't known
  });
});

describe('travel', () => {
  test('the fader law: 0 dB at 0.8, -96 off, +6 the top, and the two directions agree', () => {
    assert.equal(dbToPos(0), 0.8);
    assert.equal(dbToPos(-96), 0);
    assert.equal(dbToPos(-Infinity), 0);
    assert.equal(dbToPos(6), 1);
    assert.equal(dbToPos(12), 1);
    assert.equal(posToDb(0), -96);
    assert.equal(posToDb(0.01), -96);
    assert.equal(posToDb(1), 6);
    for (const db of [-60, -36, -12, -6, -3, 0, 3]) close(posToDb(dbToPos(db)), db, 1e-9);
    let last = -1;
    for (let db = -95; db <= 6; db += 0.5) { const x = dbToPos(db); assert.ok(x > last); last = x; }
  });
  test('toPos and fromPos are inverses for linear, log and fader specs', () => {
    for (const [spec, vals] of [[LIN, [0, 0.25, 1]], [LOG, [20, 200, 2000, 20000]], [MIXER.gain, [-60, -12, 0, 6, 24]], [MIXER.pan, [-1, 0, 0.5]]]) {
      for (const v of vals) close(fromPos(spec, toPos(spec, v)), v, 1e-9, `${spec.key} ${v}`);
    }
    close(toPos(LOG, 632.4555320336758), 0.5, 1e-12); // a log knob's middle is the geometric mean
    assert.equal(toPos(MIXER.gain, 24), 1);
    assert.equal(fromPos(LIN, 2), 1); // clamped
    assert.equal(toPos(null, 5), 5);
  });
  test('laneView ends the gain lane at the fader top, and leaves others alone', () => {
    const v = laneView(MIXER.gain);
    assert.equal(v.max, 6);
    close(toPos(v, 6), 1, 1e-12);
    close(fromPos(v, toPos(v, -12)), -12, 1e-9);
    assert.equal(laneView(LIN), LIN);
  });
  test('bend: endpoints fixed, straight by default, monotone, slow or fast start, step', () => {
    for (const c of [undefined, 0, 0.5, -0.5, 1, -1]) {
      assert.equal(bend(0, c), 0);
      assert.equal(bend(1, c), 1);
      let last = -1;
      for (let x = 0; x <= 1.0001; x += 0.05) { const y = bend(Math.min(1, x), c); assert.ok(y >= last && y <= 1); last = y; }
    }
    assert.equal(bend(0.5, undefined), 0.5);
    assert.ok(bend(0.5, 0.5) < 0.5);
    assert.ok(bend(0.5, -0.5) > 0.5);
    assert.equal(bend(0.99, 'step'), 0);
    assert.equal(bend(1, 'step'), 1);
  });
});

describe('reading a lane', () => {
  const lane = { points: [{ t: 4, v: 0.2 }, { t: 8, v: 0.6 }, { t: 8, v: 1 }, { t: 12, v: 0, c: 'step' }, { t: 16, v: 0.5 }] };
  test('holds the first value before and the last after', () => {
    assert.equal(valueAt(lane, 0, LIN), 0.2);
    assert.equal(valueAt(lane, 4, LIN), 0.2);
    assert.equal(valueAt(lane, 100, LIN), 0.5);
    assert.equal(valueAt({ points: [] }, 3), null);
    assert.equal(valueAt([], 3), null);
  });
  test('straight between points', () => {
    close(valueAt(lane, 6, LIN), 0.4);
    close(valueAt(lane, 7, LIN), 0.5);
  });
  test('a jump: valueAt is the leaving value, valueBefore the arriving one', () => {
    assert.equal(valueAt(lane, 8, LIN), 1);
    close(valueBefore(lane, 8, LIN), 0.6);
    close(valueBefore(lane, 7, LIN), 0.5);
  });
  test('a step segment holds, then jumps at the next point', () => {
    assert.equal(valueAt(lane, 12, LIN), 0);
    assert.equal(valueAt(lane, 15.9, LIN), 0);
    assert.equal(valueAt(lane, 16, LIN), 0.5);
    assert.equal(valueBefore(lane, 16, LIN), 0);
  });
  test('a log param ramps in travel (the knob), a fader in fader travel', () => {
    close(valueAt([{ t: 0, v: 20 }, { t: 4, v: 20000 }], 2, LOG), Math.sqrt(20 * 20000), 1e-9);
    const mid = valueAt([{ t: 0, v: -96 }, { t: 4, v: 6 }], 2, MIXER.gain);
    close(mid, fromPos(MIXER.gain, (toPos(MIXER.gain, -96) + toPos(MIXER.gain, 6)) / 2), 1e-9);
    close(mid, -12, 1e-9, `halfway up the fader (off to +6) is -12 dB, not the -45 dB halfway in dB: ${mid}`);
    close(valueAt([{ t: 0, v: 20 }, { t: 4, v: 20000 }], 2, null), 10010, 1e-9);
  });
  test('a bent segment starts slow (c > 0) or fast (c < 0)', () => {
    assert.ok(valueAt([{ t: 0, v: 0, c: 0.5 }, { t: 4, v: 1 }], 2, LIN) < 0.5);
    assert.ok(valueAt([{ t: 0, v: 0, c: -0.5 }, { t: 4, v: 1 }], 2, LIN) > 0.5);
  });
  test('a discrete param steps even without a step curve', () => {
    const pts = [{ t: 0, v: 0 }, { t: 4, v: 2 }];
    assert.equal(valueAt(pts, 3.9, MODE), 0);
    assert.equal(valueAt(pts, 4, MODE), 2);
    assert.equal(valueBefore(pts, 4, MODE), 0);
  });
  test('segmentsIn covers the range with the holds, in travel, and posAt agrees with valueAt', () => {
    const segs = segmentsIn(lane, 0, 20, LIN);
    assert.equal(segs[0].t0, -Infinity);
    assert.equal(segs[segs.length - 1].t1, Infinity);
    assert.ok(!segs.some((s) => s.t0 === 8 && s.t1 === 8), 'a jump has no piece of its own');
    for (const beat of [5, 6.5, 9, 13, 18]) {
      const s = segs.find((x) => beat >= x.t0 && beat < x.t1);
      close(fromPos(LIN, posAt(s, beat)), valueAt(lane, beat, LIN), 1e-9, `beat ${beat}`);
    }
    assert.deepEqual(segmentsIn(lane, 5, 6, LIN).length, 1);
    assert.deepEqual(segmentsIn({ points: [] }, 0, 4), []);
    assert.ok(segmentsIn([{ t: 0, v: 0 }, { t: 4, v: 2 }], 0, 8, MODE).every((s) => s.c === 'step'));
  });
});

describe('where lanes live', () => {
  const song = () => ({
    tracks: [{
      id: 't1', name: 'Keys', auto: { gain: { points: [{ t: 0, v: -6 }], by: 'you' }, pan: { points: [] } },
      instrument: { device: 'core.poly', auto: { cutoff: { points: [{ t: 0, v: 400 }], by: 'claude' } } },
      inserts: [{ id: 'fx1', device: 'pedal.x', auto: { mix: { points: [{ t: 1, v: 0.5 }], by: 'you' } } }],
    }],
    master: { inserts: [{ id: 'm1', device: 'core.comp', auto: { thr: { points: [{ t: 0, v: -10 }] } } }], auto: { gain: { points: [{ t: 0, v: 0 }] } } },
  });
  test('laneKey', () => {
    assert.equal(laneKey({ track: 't1', param: 'gain' }), 't1/gain');
    assert.equal(laneKey({ track: 't1', insert: 'instrument', param: 'cutoff' }), 't1/instrument/cutoff');
    assert.equal(laneKey({ track: 'master', insert: '', param: 'gain' }), 'master/gain');
  });
  test('lanesOf lists every non-empty lane in song order', () => {
    assert.deepEqual(lanesOf(song()).map((x) => x.key), ['t1/gain', 't1/instrument/cutoff', 't1/fx1/mix', 'master/gain', 'master/m1/thr']);
    assert.equal(lanesOf(song())[1].device, 'core.poly');
    assert.deepEqual(lanesOf({ tracks: [] }), []);
  });
  test('laneAt and laneHost', () => {
    const p = song();
    assert.equal(laneAt(p, { track: 't1', param: 'gain' }), p.tracks[0].auto.gain);
    assert.equal(laneAt(p, { track: 'keys', insert: 'fx1', param: 'mix' }), p.tracks[0].inserts[0].auto.mix);
    assert.equal(laneAt(p, { track: 't1', param: 'pan' }), null); // empty
    assert.equal(laneAt(p, { track: 'nope', param: 'gain' }), null);
    assert.equal(laneHost(p, { track: 'master' }), p.master);
    assert.equal(laneHost(p, { track: 'master', insert: 'm1' }), p.master.inserts[0]);
    assert.equal(laneHost(p, { track: 't1', insert: 'instrument' }), p.tracks[0].instrument);
    assert.equal(laneHost(p, { track: 't1', insert: 'gone' }), null);
  });
});

describe('canonical form', () => {
  test('normCurve', () => {
    assert.equal(normCurve('step'), 'step');
    assert.equal(normCurve(0), undefined);
    assert.equal(normCurve(null), undefined);
    assert.equal(normCurve('x'), undefined);
    assert.equal(normCurve(5), 1);
    assert.equal(normCurve(-0.123456), -0.1235);
    assert.equal(normCurve(0.00001), undefined);
  });
  test('mkPoint and pointBy', () => {
    assert.deepEqual(mkPoint(1, 2, 0.5, 'claude'), { t: 1, v: 2, c: 0.5, by: 'claude' });
    assert.deepEqual(mkPoint(1, 2, 0, ''), { t: 1, v: 2 });
    assert.equal(pointBy({ by: 'claude' }, { t: 0, v: 0 }), 'claude');
    assert.equal(pointBy({ by: 'claude' }, { t: 0, v: 0, by: 'you' }), 'you');
    assert.equal(pointBy(null, { t: 0, v: 0 }), 'you');
  });
  test('laneAuthors puts you first', () => {
    assert.deepEqual(laneAuthors({ by: 'claude', points: [{ t: 0, v: 0 }, { t: 1, v: 0, by: 'you' }, { t: 2, v: 0, by: 'mcp:x' }] }), ['you', 'claude', 'mcp:x']);
  });
  test('normPoints sorts stably, rounds t, drops junk and keeps at most two at one beat', () => {
    const out = normPoints([{ t: 2, v: 1 }, null, { t: 'x', v: 1 }, { t: -3, v: 0.5 }, { t: 1.00001, v: 0 }, { t: 2, v: 2 }, { t: 2, v: 3 }, { t: 1, v: NaN }]);
    assert.deepEqual(out, [{ t: 0, v: 0.5 }, { t: 1, v: 0 }, { t: 2, v: 1 }, { t: 2, v: 3 }]);
    assert.equal(rt(1 / 3), Math.round(1024 / 3) / 1024);
  });
  test('normPoints clamps to the spec, snaps to its step and steps a discrete param', () => {
    assert.deepEqual(normPoints([{ t: 0, v: 2 }, { t: 1, v: -1 }], LIN), [{ t: 0, v: 1 }, { t: 1, v: 0 }]);
    assert.deepEqual(normPoints([{ t: 0, v: 123 }], HZ), [{ t: 0, v: 120 }]);
    assert.deepEqual(normPoints([{ t: 0, v: 1.4 }], MODE), [{ t: 0, v: 1, c: 'step' }]);
    assert.deepEqual(normPoints([{ t: 0, v: -0 }]), [{ t: 0, v: 0 }]);
    assert.ok(!Object.is(normPoints([{ t: 0, v: -0.0000001 }], HZ)[0].v, -0));
  });
  test('normPoints is idempotent', () => {
    const raw = [{ t: 3.3, v: 0.4, c: 0.3 }, { t: 1, v: 9 }, { t: 1, v: 0.1, by: 'claude' }, { t: 7, v: 0.2, c: 'step' }];
    const once = normPoints(raw, LIN);
    assert.deepEqual(normPoints(once, LIN), once);
  });
  test('normLane: canonical authors, held flag, null when empty', () => {
    assert.deepEqual(normLane({ points: [{ t: 0, v: 1, by: 'claude' }, { t: 1, v: 0, by: 'you' }], by: 'claude', off: true }),
      { points: [{ t: 0, v: 1 }, { t: 1, v: 0, by: 'you' }], off: true, by: 'claude' });
    assert.deepEqual(normLane({ points: [{ t: 0, v: 1 }], off: 'yes' }), { points: [{ t: 0, v: 1 }], by: 'you' });
    assert.equal(normLane({ points: [] }), null);
    assert.equal(normLane(null), null);
  });
  test('normAuto: sorted keys, empty lanes dropped, mixer lanes clamped and limited to gain and pan', () => {
    const a = normAuto({ pan: { points: [{ t: 0, v: 3 }] }, gain: { points: [{ t: 0, v: 99 }] }, cutoff: { points: [{ t: 0, v: 1 }] }, x: { points: [] } }, { mixer: true });
    assert.deepEqual(Object.keys(a), ['gain', 'pan']);
    assert.equal(a.gain.points[0].v, 24);
    assert.equal(a.pan.points[0].v, 1);
    assert.equal(normAuto({ x: { points: [] } }), undefined);
    assert.equal(normAuto([]), undefined);
  });
  test('pointsPrint: equal prints for equal points', () => {
    assert.equal(pointsPrint([{ t: 0, v: 1 }, { t: 1, v: 2, c: 'step' }]), pointsPrint([{ t: 0, v: 1 }, { t: 1, v: 2, c: 'step' }]));
    assert.notEqual(pointsPrint([{ t: 0, v: 1 }]), pointsPrint([{ t: 0, v: 1, c: 0.5 }]));
    assert.equal(pointsPrint(null), '[]');
  });
});

describe('the text form', () => {
  test('reads the documented example', () => {
    assert.deepEqual(parsePoints('32:400 48:8000~0.5 64:8000'), [{ t: 32, v: 400 }, { t: 48, v: 8000, c: 0.5 }, { t: 64, v: 8000 }]);
  });
  test('fractions, negatives, step, commas and exponents', () => {
    assert.deepEqual(parsePoints('1/3:0.5, 2:-6~step 4:1e3~-1'), [{ t: 1 / 3, v: 0.5 }, { t: 2, v: -6, c: 'step' }, { t: 4, v: 1000, c: -1 }]);
    assert.deepEqual(parsePoints(''), []);
  });
  test('refuses bad tokens with the format in the message', () => {
    for (const bad of ['32', '32:x', 'a:1', '1:2~2', '1:2~wobble', '1:2:3']) assert.throws(() => parsePoints(bad), /beat:value/, bad);
    assert.throws(() => parsePoints(42), /points must be text/);
  });
  test('an array is copied, not shared', () => {
    const a = [{ t: 0, v: 1 }];
    const b = parsePoints(a);
    assert.deepEqual(b, a);
    assert.notEqual(b[0], a[0]);
  });
  test('formatPoints then parsePoints round-trips canonical points', () => {
    const pts = normPoints([{ t: 0, v: -6 }, { t: 8, v: 0, c: 0.25 }, { t: 8, v: 3 }, { t: 12.5, v: -96, c: 'step' }, { t: 16, v: 0 }]);
    assert.equal(formatPoints(pts), '0:-6 8:0~0.25 8:3 12.5:-96~step 16:0');
    assert.deepEqual(normPoints(parsePoints(formatPoints(pts))), pts);
    assert.equal(formatPoints(null), '');
  });
});

describe('shapes', () => {
  test('ramp, swell, dip, flat', () => {
    assert.deepEqual(shapePoints('ramp', { from: 0, to: 8, v0: 0, v1: 1, c: 0.5 }), [{ t: 0, v: 0, c: 0.5 }, { t: 8, v: 1 }]);
    assert.deepEqual(shapePoints('swell', { from: 0, to: 8, v0: 0, v1: 1 }), [{ t: 0, v: 0 }, { t: 4, v: 1 }, { t: 8, v: 0 }]);
    assert.deepEqual(shapePoints('dip', { from: 0, to: 8, v0: 1, v1: 0, vEnd: 0.5, c: 0.4 }), [{ t: 0, v: 1, c: 0.4 }, { t: 4, v: 0, c: -0.4 }, { t: 8, v: 0.5 }]);
    assert.deepEqual(shapePoints('flat', { from: 2, to: 4, v0: 0.3 }), [{ t: 2, v: 0.3 }, { t: 4, v: 0.3 }]);
  });
  test('hold ramps in and out over `ramp` beats (at most a quarter of the range), or jumps with ramp 0', () => {
    assert.deepEqual(shapePoints('hold', { from: 0, to: 8, v0: 0, v1: 1 }), [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 7.5, v: 1 }, { t: 8, v: 0 }]);
    assert.deepEqual(shapePoints('hold', { from: 0, to: 4, v0: 0, v1: 1, ramp: 10 }).map((p) => p.t), [0, 1, 3, 4]);
    assert.deepEqual(shapePoints('hold', { from: 0, to: 4, v0: 0, v1: 1, ramp: 0 }), [{ t: 0, v: 0 }, { t: 0, v: 1 }, { t: 4, v: 1 }, { t: 4, v: 0 }]);
  });
  test('pulse alternates in steps every `every` beats, then vEnd', () => {
    const p = shapePoints('pulse', { from: 0, to: 4, v0: 0, v1: 1, every: 1 });
    assert.deepEqual(p.map((x) => x.t), [0, 1, 2, 3, 4]);
    assert.deepEqual(p.slice(0, -1).map((x) => x.v), [1, 0, 1, 0]);
    assert.ok(p.slice(0, -1).every((x) => x.c === 'step'));
    assert.equal(p.length, 5);
    assert.ok(shapePoints('pulse', { from: 0, to: 8192, v0: 0, v1: 1, every: 0.0001 }).length <= 4097, 'capped');
  });
  test('every shape is already canonical', () => {
    for (const s of ['ramp', 'swell', 'dip', 'hold', 'flat', 'pulse']) {
      const pts = shapePoints(s, { from: 1, to: 9, v0: 0.2, v1: 0.9, c: 0.3 });
      assert.deepEqual(normPoints(pts), pts, s);
    }
  });
  test('refuses an empty range, missing values or an unknown shape', () => {
    assert.throws(() => shapePoints('ramp', { from: 4, to: 4, v0: 0 }), /from < to/);
    assert.throws(() => shapePoints('ramp', { from: 0, to: 4 }), /values/);
    assert.throws(() => shapePoints('wiggle', { from: 0, to: 4, v0: 0 }), /unknown shape "wiggle"/);
  });
});

describe('thin', () => {
  test('drops points on a straight line and keeps the ends', () => {
    const pts = Array.from({ length: 33 }, (_, i) => ({ t: i, v: i / 32 }));
    assert.deepEqual(thin(pts, 0.005, LIN), [{ t: 0, v: 0 }, { t: 32, v: 1 }]);
  });
  test('keeps a corner, a jump and a bent point', () => {
    const pts = [{ t: 0, v: 0 }, { t: 1, v: 0.5 }, { t: 2, v: 1 }, { t: 3, v: 0.5 }, { t: 4, v: 0 }];
    assert.deepEqual(thin(pts, 0.005, LIN).map((p) => p.t), [0, 2, 4]);
    const jump = [{ t: 0, v: 0 }, { t: 1, v: 0 }, { t: 2, v: 0 }, { t: 2, v: 1 }, { t: 3, v: 1 }, { t: 4, v: 1 }];
    assert.deepEqual(thin(jump, 0.005, LIN), [{ t: 0, v: 0 }, { t: 2, v: 0 }, { t: 2, v: 1 }, { t: 4, v: 1 }]);
    const bent = [{ t: 0, v: 0 }, { t: 1, v: 0.25, c: 0.5 }, { t: 2, v: 0.5 }, { t: 3, v: 0.75 }];
    assert.ok(thin(bent, 0.005, LIN).some((p) => p.t === 1));
  });
  test('the thinned lane stays within tolerance of the original', () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ t: i / 8, v: 0.5 + 0.5 * Math.sin(i / 10) }));
    const tol = 0.01, out = thin(pts, tol, LIN);
    assert.ok(out.length < pts.length / 3);
    for (const p of pts) close(valueAt(out, p.t, LIN), p.v, tol + 1e-9, `at ${p.t}`);
  });
  test('minGap drops points too close to the last kept one', () => {
    const pts = [{ t: 0, v: 0 }, { t: 0.001, v: 1 }, { t: 0.5, v: 0 }, { t: 1, v: 1 }];
    assert.ok(!thin(pts, 0, LIN, { minGap: 1 / 64 }).some((p) => p.t === 0.001));
  });
  test('a discrete lane keeps a point wherever the setting changes', () => {
    const pts = [{ t: 0, v: 0 }, { t: 1, v: 0 }, { t: 2, v: 1 }, { t: 3, v: 1 }, { t: 4, v: 2 }, { t: 5, v: 2 }];
    assert.deepEqual(thin(pts, 0.005, MODE).map((p) => [p.t, p.v]), [[0, 0], [2, 1], [4, 2], [5, 2]]);
  });
});

describe('windows and time', () => {
  const lane = [{ t: 0, v: 0 }, { t: 8, v: 0.8 }, { t: 12, v: 0.2, c: 'step' }, { t: 16, v: 1 }];
  test('cutLane gives the edges and the inside, rebased', () => {
    assert.deepEqual(cutLane(lane, 4, 14, LIN), [{ t: 0, v: 0.4 }, { t: 4, v: 0.8 }, { t: 8, v: 0.2, c: 'step' }, { t: 10, v: 0.2 }]);
    assert.deepEqual(cutLane(lane, 4, 14, LIN, { rebase: false })[0], { t: 4, v: 0.4 });
    assert.deepEqual(cutLane([], 0, 4), []);
    assert.deepEqual(cutLane(lane, 4, 4), []);
  });
  test('splicing a window back in changes no value', () => {
    const inner = cutLane(lane, 4, 14, LIN, { rebase: false });
    const out = spliceLane(lane, 4, 14, inner, LIN);
    for (let b = 0; b <= 20; b += 0.25) close(valueAt(out, b, LIN), valueAt(lane, b, LIN), 1e-9, `beat ${b}`);
  });
  test('spliceLane replaces the window and joins the edges', () => {
    const out = spliceLane(lane, 4, 6, [{ t: 5, v: 1 }], LIN);
    assert.equal(valueAt(out, 5, LIN), 1);
    close(valueBefore(out, 4, LIN), 0.4);
    close(valueAt(out, 6, LIN), 0.6);
    assert.deepEqual(out.filter((p) => p.t > 6), lane.filter((p) => p.t > 6));
  });
  test('insertTime holds the value across the gap and moves later points right', () => {
    const out = insertTime([{ t: 0, v: 0 }, { t: 8, v: 8 }], 4, 4);
    assert.deepEqual(out, [{ t: 0, v: 0 }, { t: 4, v: 4 }, { t: 8, v: 4 }, { t: 12, v: 8 }]);
    assert.deepEqual(insertTime([{ t: 0, v: 1 }], 4, 4), [{ t: 0, v: 1 }]);           // nothing after: unchanged
    assert.deepEqual(insertTime([{ t: 6, v: 1 }], 4, 4), [{ t: 10, v: 1 }]);          // everything after: shifted
  });
  test('removeTime closes up, a jump where the values differ', () => {
    assert.deepEqual(removeTime([{ t: 0, v: 0 }, { t: 8, v: 8 }], 2, 4), [{ t: 0, v: 0 }, { t: 2, v: 2 }, { t: 2, v: 6 }, { t: 4, v: 8 }]);
    assert.deepEqual(removeTime([{ t: 0, v: 1 }, { t: 10, v: 1 }], 2, 4), [{ t: 0, v: 1 }, { t: 2, v: 1 }, { t: 6, v: 1 }]);
    assert.deepEqual(removeTime([{ t: 0, v: 1 }], 2, 4), [{ t: 0, v: 1 }]);
  });
  // (straight, step and held stretches are exact; a bent segment cut in two is close, not exact, by design)
  test('insertTime then removeTime of the same stretch gives the same values', () => {
    const before = [{ t: 0, v: 0.1 }, { t: 3, v: 0.9, c: 'step' }, { t: 5, v: 0.4 }, { t: 9, v: 0.3 }, { t: 9, v: 0.7 }, { t: 14, v: 0.5 }];
    const out = removeTime(insertTime(before, 6, 4, LIN), 6, 4, LIN);
    for (let b = 0; b <= 16; b += 0.25) close(valueAt(out, b, LIN), valueAt(before, b, LIN), 1e-9, `beat ${b}`);
  });
  test('the windows keep authors on the points they carry', () => {
    const pts = [{ t: 0, v: 0, by: 'claude' }, { t: 8, v: 1 }];
    const out = insertTime(pts, 4, 4);
    assert.equal(out[0].by, 'claude');
    assert.equal(out.find((p) => p.t === 4).by, 'claude');
  });
});
