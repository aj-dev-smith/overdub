// app/src/audio/measure.js, the ears, on synthetic buffers whose levels are known (and app/src/audio/testsignals.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOOR,
  channelsOf,
  lufs,
  truePeak,
  onsets,
  chroma,
  keyOf,
  measure,
  lowMono,
  dbToGain,
  gainToDb,
} from '../../app/src/audio/measure.js';
import { SR, stereo, sweep, pinkNoise, impulse } from '../../app/src/audio/testsignals.js';

const sine = (hz, secs, db = 0, sr = SR, phase = 0) => {
  const a = dbToGain(db),
    x = new Float32Array(Math.round(sr * secs));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * hz * i) / sr + phase);
  return x;
};
const near = (got, want, tol, what = '') =>
  assert.ok(Math.abs(got - want) <= tol, `${what} ${got} not within ${tol} of ${want}`);

describe('input shapes', () => {
  test('channelsOf takes a Float32Array, an array, { sr, channels } and an AudioBuffer-like', () => {
    const x = new Float32Array(480);
    assert.equal(channelsOf(x, { sr: 44100 }).sr, 44100);
    assert.equal(channelsOf([x, x], { sr: 48000 }).ch.length, 2);
    assert.equal(channelsOf({ sr: 96000, channels: [x] }).sr, 96000);
    const ab = { numberOfChannels: 2, sampleRate: 22050, getChannelData: () => x };
    assert.deepEqual([channelsOf(ab).ch.length, channelsOf(ab).sr], [2, 22050]);
    assert.equal(channelsOf(x).sr, 48000);
    assert.throws(() => channelsOf(42), /expected an AudioBuffer/);
  });
  test('from / to cut a range in seconds, clamped to the buffer', () => {
    const x = new Float32Array(48000);
    assert.equal(channelsOf(x, { sr: 48000, from: 0.25, to: 0.5 }).ch[0].length, 12000);
    assert.equal(channelsOf(x, { sr: 48000, from: 0.9, to: 5 }).ch[0].length, 4800);
    assert.equal(channelsOf(x, { sr: 48000, from: 2, to: 1 }).ch[0].length, 0);
  });
});

describe('loudness (BS.1770)', () => {
  test('a 1 kHz sine at -20 dBFS reads -23 LUFS in one channel and -20 LUFS in both', () => {
    const x = sine(1000, 1, -20);
    near(lufs({ sr: SR, channels: [x] }), -23, 0.1, 'mono');
    near(lufs(stereo(x)), -20, 0.1, 'stereo');
  });
  test('loudness reads the same at 44.1, 48 and 96 kHz', () => {
    for (const sr of [44100, 96000]) near(lufs({ sr, channels: [sine(1000, 1, -20, sr)] }), -23, 0.1, String(sr));
  });
  test('6 dB more gain is 6 LU louder', () => {
    near(lufs(stereo(sine(500, 1, -14))) - lufs(stereo(sine(500, 1, -20))), 6, 0.01);
  });
  test('silence reads FLOOR, not -Infinity', () => {
    assert.equal(lufs(new Float32Array(48000)), FLOOR);
    assert.equal(truePeak(new Float32Array(100)), FLOOR);
  });
});

describe('true peak', () => {
  test('an fs/4 sine at 45° peaks at -3 dBFS in its samples and 0 dBTP between them', () => {
    const x = sine(SR / 4, 0.1, 0, SR, Math.PI / 4);
    const m = measure({ sr: SR, channels: [x] });
    near(m.peak, -3.01, 0.05, 'sample peak');
    near(m.truePeak, 0, 0.2, 'true peak'); // the 4x FIR's tolerance, as tools/sounds-test.js holds it
  });
  test('true peak is never below the sample peak', () => {
    for (const x of [sine(997, 0.2, -6), pinkNoise(0.5), impulse(0.1, SR, { at: 0.05, amp: 0.5 })]) {
      const m = measure({ sr: SR, channels: [x] });
      assert.ok(m.truePeak >= m.peak - 1e-9, `${m.truePeak} < ${m.peak}`);
    }
  });
});

describe('measure', () => {
  test('a full-scale-ish sine: peak, RMS and crest are the textbook values', () => {
    const m = measure({ sr: SR, channels: [sine(1000, 0.5, -6)] });
    near(m.peak, -6, 0.02, 'peak');
    near(m.rms, -9.01, 0.03, 'rms');
    near(m.crest, 3.01, 0.03, 'crest');
    assert.equal(m.clipped, 0);
    assert.equal(m.channels, 1);
    near(m.duration, 0.5, 0.001);
  });
  test('the spectrum puts a sine in its band and its centroid near its frequency', () => {
    const m = measure({ sr: SR, channels: [sine(1000, 0.5, -12)] });
    const loudest = Object.entries(m.bands).sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(loudest, 'mid');
    near(m.bands.mid, 0, 0.1, 'mid share');
    near(m.centroid, 1000, 150, 'centroid');
    const low = measure({ sr: SR, channels: [sine(100, 0.5, -12)] });
    assert.equal(Object.entries(low.bands).sort((a, b) => b[1] - a[1])[0][0], 'low');
  });
  test('silence: everything at the floor, 100% silent, and the result survives JSON', () => {
    const m = measure({ sr: SR, channels: [new Float32Array(SR / 2), new Float32Array(SR / 2)] });
    assert.equal(m.lufs, FLOOR);
    assert.equal(m.peak, FLOOR);
    assert.equal(m.rms, FLOOR);
    assert.equal(m.silencePct, 100);
    assert.equal(m.key, null);
    assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
  });
  test('an empty buffer gives a whole, finite result', () => {
    const m = measure(new Float32Array(0));
    assert.equal(m.duration, 0);
    assert.equal(m.lufs, FLOOR);
    assert.equal(m.silencePct, 100);
  });
  test('stereo: identical channels correlate 1, inverted -1, and side energy follows', () => {
    const x = sine(440, 0.3, -12);
    const same = measure(stereo(x));
    assert.equal(same.correlation, 1);
    assert.equal(same.sideDb, FLOOR);
    const inv = measure({ sr: SR, channels: [x, x.map((v) => -v)] });
    assert.equal(inv.correlation, -1);
    assert.equal(inv.sideDb, 0); // all side, no mid
  });
  test('samples at or past full scale are counted as clipped', () => {
    const x = sine(100, 0.1, 0);
    x[10] = 1;
    x[20] = -1.5;
    assert.ok(measure({ sr: SR, channels: [x] }).clipped >= 2);
  });
  test('half silence reads about 50% silent', () => {
    const x = new Float32Array(SR);
    x.set(sine(440, 0.5, -12));
    near(measure({ sr: SR, channels: [x] }).silencePct, 50, 6);
  });
  test('the same buffer measures the same twice', () => {
    const x = pinkNoise(0.5);
    assert.deepEqual(measure({ sr: SR, channels: [x] }), measure({ sr: SR, channels: [x] }));
  });
});

describe('onsets', () => {
  test('clicks every 250 ms are found at their times', () => {
    const x = new Float32Array(SR * 2);
    const at = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
    for (const t of at)
      for (let i = 0; i < 200; i++) x[Math.round(t * SR) + i] = 0.8 * Math.exp(-i / 40) * (i % 2 ? 1 : -1);
    const found = onsets({ sr: SR, channels: [x] });
    assert.equal(found.length, at.length, JSON.stringify(found));
    found.forEach((t, i) => near(t, at[i], 0.03, `onset ${i}`));
  });
  test('a steady tone has no onsets after its start, and a very short buffer has none', () => {
    assert.ok(onsets({ sr: SR, channels: [sine(440, 1, -12)] }).length <= 1);
    assert.deepEqual(onsets({ sr: SR, channels: [new Float32Array(1500)] }), []);
  });
});

describe('chroma and key', () => {
  test('an A minor triad reads as A minor (or its relative, C major, as runner up)', () => {
    const n = SR,
      x = new Float32Array(n);
    for (const hz of [220, 261.63, 329.63, 110]) {
      const s = sine(hz, 1, -18);
      for (let i = 0; i < n; i++) x[i] += s[i];
    }
    const c = chroma({ sr: SR, channels: [x] });
    assert.equal(c.length, 12);
    assert.equal(Math.max(...c), 1);
    // A, C, E carry the energy
    for (const pc of [9, 0, 4]) assert.ok(c[pc] > 0.3, `pc ${pc}: ${c[pc]}`);
    const k = keyOf(c);
    assert.deepEqual([k.root, k.scale], ['A', 'minor']);
    assert.ok(k.confidence > 0.5);
  });
  test('chroma of silence is null, and so is its key', () => {
    assert.equal(chroma(new Float32Array(SR)), null);
    assert.equal(keyOf(null), null);
  });
  test('keyOf a C major scale profile is C major', () => {
    const c = [1, 0, 0.6, 0, 0.8, 0.6, 0, 0.9, 0, 0.6, 0, 0.4];
    const k = keyOf(c);
    assert.deepEqual([k.root, k.scale], ['C', 'major']);
  });
});

describe('low end and helpers', () => {
  test('lowMono: a mono low end reads FLOOR side and correlation 1; an out-of-phase one reads -1', () => {
    const x = sine(60, 0.5, -12);
    assert.deepEqual(lowMono(stereo(x)), { lowSideDb: FLOOR, lowCorrelation: 1 });
    assert.equal(lowMono({ sr: SR, channels: [x, x.map((v) => -v)] }).lowCorrelation, -1);
    assert.deepEqual(lowMono({ sr: SR, channels: [x] }), { lowSideDb: FLOOR, lowCorrelation: 1 });
  });
  test('lowMono stays finite on wide content above its crossover', () => {
    const hi = sine(5000, 0.5, -12);
    const r = lowMono({ sr: SR, channels: [hi, hi.map((v) => -v)] });
    assert.ok(Number.isFinite(r.lowSideDb) && Number.isFinite(r.lowCorrelation));
  });
  test('dbToGain and gainToDb invert each other; 0 gain is FLOOR', () => {
    for (const d of [-60, -6, 0, 12]) near(gainToDb(dbToGain(d)), d, 1e-9);
    assert.equal(gainToDb(0), FLOOR);
  });
  test('the test signals are deterministic and at their stated levels', () => {
    assert.deepEqual(pinkNoise(0.2), pinkNoise(0.2));
    assert.notDeepEqual(pinkNoise(0.2, SR, { seed: 1 }), pinkNoise(0.2, SR, { seed: 2 }));
    near(measure({ sr: SR, channels: [sweep(0.5)] }).peak, -12, 0.05, 'sweep peak');
    const im = impulse(0.1, SR, { at: 0.05, amp: 0.5 });
    assert.equal(im[Math.round(0.05 * SR)], 0.5);
    assert.equal(
      im.reduce((n, v) => n + (v !== 0), 0),
      1,
    );
  });
});
