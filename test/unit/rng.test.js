// The seeded randomness renders rely on: dsp.rng (kernels, app/src/kernel/dsp.js) and kit.rng (graph devices,
// app/src/devices/kit.js). Same seed, same sequence, on every run; renders are bit-exact because of it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeDsp } from '../../app/src/kernel/dsp.js';
import { rng as kitRng } from '../../app/src/devices/kit.js';

const take = (r, n) => Array.from({ length: n }, () => r());

describe('dsp.rng (mulberry32)', () => {
  const { rng, noise } = makeDsp(48000);
  test('the same seed gives the same sequence', () => {
    assert.deepEqual(take(rng(42), 1000), take(rng(42), 1000));
  });
  test('the sequence is pinned, and the same at every sample rate: a change here moves every seeded render', () => {
    assert.deepEqual(take(rng(1), 3), [0.18967728852294385, 0.31778763560578227, 0.7830808095168322]);
    assert.deepEqual(take(makeDsp(44100).rng(1), 3), take(rng(1), 3));
  });
  test('different seeds give different sequences', () => {
    const seqs = [0, 1, 2, 3, 12345, 0xffffffff].map((s) => take(rng(s), 8).join());
    assert.equal(new Set(seqs).size, seqs.length);
  });
  test('r() is in [0, 1), r.bi() in [-1, 1), and both look uniform', () => {
    const r = rng(7);
    let sum = 0,
      lo = 1,
      hi = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const x = r();
      assert.ok(x >= 0 && x < 1);
      sum += x;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    assert.ok(Math.abs(sum / N - 0.5) < 0.01);
    assert.ok(lo < 0.001 && hi > 0.999);
    const b = rng(7);
    for (let i = 0; i < 1000; i++) {
      const x = b.bi();
      assert.ok(x >= -1 && x < 1);
    }
  });
  test('r.gauss() is finite with mean ~0 and variance ~1', () => {
    const r = rng(9);
    let s = 0,
      s2 = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const x = r.gauss();
      assert.ok(Number.isFinite(x));
      s += x;
      s2 += x * x;
    }
    assert.ok(Math.abs(s / N) < 0.05);
    assert.ok(Math.abs(s2 / N - 1) < 0.05);
  });
  test('two generators with one seed do not share state', () => {
    const a = rng(5),
      b = rng(5);
    a();
    a();
    const c = rng(5);
    c();
    c();
    assert.equal(a(), c());
    assert.equal(b(), rng(5)());
  });
  test('noise(seed) is repeatable, and white noise stays in +-1', () => {
    for (const color of ['white', 'pink', 'brown']) {
      const a = noise(3, color),
        b = noise(3, color);
      const xa = Array.from({ length: 2000 }, () => a.next()),
        xb = Array.from({ length: 2000 }, () => b.next());
      assert.deepEqual(xa, xb, color);
      assert.ok(xa.every(Number.isFinite), color);
    }
    const w = noise(3, 'white');
    for (let i = 0; i < 2000; i++) {
      const x = w.next();
      assert.ok(x >= -1 && x <= 1);
    }
    const n3 = noise(3),
      n4 = noise(4);
    assert.notDeepEqual(
      Array.from({ length: 16 }, () => n3.next()),
      Array.from({ length: 16 }, () => n4.next()),
    );
  });
});

describe('kit.rng (LCG)', () => {
  test('the same seed gives the same sequence; different seeds differ', () => {
    assert.deepEqual(take(kitRng(42), 1000), take(kitRng(42), 1000));
    assert.deepEqual(take(kitRng(1), 3), [-0.527088949456811, -0.2614586525596678, 0.008484064601361752]);
    const seqs = [1, 2, 3, 99, 0xdeadbeef].map((s) => take(kitRng(s), 8).join());
    assert.equal(new Set(seqs).size, seqs.length);
  });
  test('values are in [-1, 1) and centred', () => {
    const r = kitRng(11);
    let sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const x = r();
      assert.ok(x >= -1 && x < 1);
      sum += x;
    }
    assert.ok(Math.abs(sum / N) < 0.02);
  });
  test('seed 0 is not a stuck generator (it reads as seed 1)', () => {
    const x = take(kitRng(0), 16);
    assert.ok(new Set(x).size > 10);
    assert.deepEqual(x, take(kitRng(1), 16));
  });
});
