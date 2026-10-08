// Y Cable (core.bassrig): a bass split in two. In Node, through the KernelCore the
// AudioWorklet runs:
//   the def: its params in their forever order, the presets, the bank it names, Half Stack's latency
//   the split: at DRIVE 0 (LOW and HIGH at 0 dB, under the compressor's threshold) the output is the input delayed by
//   the latency, within 0.5 dB from 20 Hz to 10 kHz (the Linkwitz-Riley halves sum flat)
//   below 120 Hz the output is mono (correlation 1.0) whatever goes in; the low half stays clean as the top distorts
//   the level on the house's bass DI and on the bass fixture (Roundwound playing the chug's roots) against bypass;
//   the presets; extremes; determinism; the device check
//   the golden scene fx:core.bassrig#7fd30c061e6b, in Node and in Chromium's worklet
//   node tools/bassrig-test.js            (NODE_ONLY=1 skips Chromium)
import { tally } from './pw.js';
import '../app/src/devices/builtin/index.js';
import def from '../app/src/devices/builtin/bassrig.js';
import { CABS_HASH, CAB_OFF } from '../app/src/devices/builtin/amp-lib.js';
import { presetParams } from '../app/src/devices/registry.js';
import { lufs, truePeak } from '../app/src/audio/measure.js';
import * as TS from '../app/src/audio/testsignals.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { summarize } from '../app/src/kernel/check.js';
import { SR, run, metalDI, psd, band, fft, goldenChecks } from './amp-scenes.js';

const T = tally('bassrig');
const ok = T.ok;
const L = (x) => lufs({ sr: SR, channels: [x, x] });
const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
function block(title, fn) { console.log(title); try { fn(); } catch (e) { ok(false, `${title}: threw ${e && e.stack}`); } }
const LAT = Math.round(def.latency * SR);

block('the device', () => {
  ok(def.id === 'core.bassrig' && def.name === 'Y Cable' && def.kind === 'effect' && def.cat === 'amp', `core.bassrig is Y Cable (${def.cat})`);
  ok(JSON.stringify(def.params.map((p) => p.key)) === JSON.stringify(['xover', 'low', 'drive', 'mid', 'treble', 'cab', 'high', 'level']), `its params, in the order they keep: ${def.params.map((p) => p.key).join(', ')}`);
  ok(def.params.every((p) => p.role && p.desc && p.desc.length >= 20), 'every param has a role and a desc an agent can act on');
  const x = def.params.find((p) => p.key === 'xover');
  ok(x.min === 80 && x.max === 400 && x.def === 200, 'XOVER runs 80-400 Hz, 200 by default');
  ok(JSON.stringify(def.presets.map((p) => p.name)) === JSON.stringify(['Modern', 'Grind', 'Clean']), `its presets: ${def.presets.map((p) => p.name).join(', ')}`);
  ok(def.data.cabs === CABS_HASH && LAT === 28, `it names the cab bank and shares Half Stack's latency (${LAT} samples)`);
  ok(!/darkglass|ampeg|sansamp|tech 21|celestion|shure|sennheiser|marshall|jester/i.test(JSON.stringify([def.blurb, def.nod, def.params, def.presets])), `no brand on it ("${def.nod}")`);
});

block('the split', () => {
  // an impulse at -30 dBFS (under the compressor's -24 dBFS threshold) through DRIVE 0, LOW and HIGH at 0 dB
  const n = 16384, x = new Float32Array(n); x[1000] = Math.pow(10, -30 / 20);
  for (const xo of [80, 200, 400]) {
    const [y] = run(def, { drive: 0, low: 0, high: 0, xover: xo }, x);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = y[i];
    fft(re, im);
    const ri = new Float64Array(n), ii = new Float64Array(n); for (let i = 0; i < n; i++) ri[i] = x[i];
    fft(ri, ii);
    let worst = 0;
    for (let k = Math.ceil(20 * n / SR); k <= 10000 * n / SR; k++) worst = Math.max(worst, Math.abs(10 * Math.log10((re[k] * re[k] + im[k] * im[k]) / (ri[k] * ri[k] + ii[k] * ii[k]))));
    let pk = 0, at = 0; for (let i = 0; i < n; i++) if (Math.abs(y[i]) > pk) { pk = Math.abs(y[i]); at = i; }
    ok(worst <= 0.5, `XOVER ${xo} Hz at DRIVE 0: the two halves sum to the input within ${f2(worst)} dB from 20 Hz to 10 kHz (the impulse's peak ${at - 1000} samples late)`);
  }
  // mono below 120 Hz: a wide stereo bass in, the low end out on both sides the same
  const bL = TS.bassDI(8, SR), bR = Float32Array.from(bL, (v, i) => (i > 7 ? bL[i - 7] * -0.6 : 0));
  const [yl, yr] = run(def, {}, bL, bR);
  const lp = (z) => { const o = new Float64Array(z.length); let a = 0, b = 0; const k = 1 - Math.exp(-2 * Math.PI * 120 / SR); for (let i = 0; i < z.length; i++) { a += k * (z[i] - a); b += k * (a - b); o[i] = b; } return o; };
  const ll = lp(yl), rr = lp(yr); let xy = 0, xx = 0, yy = 0; for (let i = 0; i < ll.length; i++) { xy += ll[i] * rr[i]; xx += ll[i] * ll[i]; yy += rr[i] * rr[i]; }
  ok(xy / Math.sqrt(xx * yy) === 1 || xy / Math.sqrt(xx * yy) > 0.999999, `below 120 Hz the output is mono: correlation ${(xy / Math.sqrt(xx * yy)).toFixed(6)} with a wide, half-cancelling stereo bass in`);
  // the low half stays clean while the top drives: the low end's level holds within a decibel as DRIVE goes 0 -> 10
  const di = metalDI('bass');
  const lows = [0, 5, 10].map((d) => { const [y] = run(def, { drive: d, high: -24 }, di); return 10 * Math.log10(psd(y).slice(Math.ceil(30 * 8192 / SR), Math.floor(90 * 8192 / SR)).reduce((a, b) => a + b, 0)); });
  ok(Math.abs(lows[2] - lows[0]) <= 1, `the clean low end holds while the top distorts: 30-90 Hz at DRIVE 0 / 5 / 10 is ${lows.map((v) => f1(v - lows[0])).join(' / ')} dB`);
  const top = (d) => band(psd(run(def, { drive: d }, di)[0]), 800, 4000).db;
  ok(top(8) - top(0) > 6, `the top grinds: 800 Hz-4 kHz rises ${f1(top(8) - top(0))} dB from DRIVE 0 to 8`);
  // the driven top meets the clean low end in phase: a tone at the crossover and one above it never sink below both
  // ends of DRIVE's first step (where the clean top fades into the amp) by more than a decibel; an amp out of polarity
  // with the low end would cancel there
  const rmsAt = (f, d) => { const x = new Float32Array(2 * SR), a = Math.pow(10, -18 / 20); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / SR); const [y] = run(def, { drive: d, low: 0, high: 0, cab: CAB_OFF }, x); let e = 0; for (let i = SR; i < y.length; i++) e += y[i] * y[i]; return 10 * Math.log10(e / SR); };
  const dips = [200, 400].map((f) => { const lv = [0, 0.25, 0.5, 0.75, 1].map((d) => rmsAt(f, d)); return [f, Math.min(lv[0], lv[4]) - Math.min(...lv)]; });
  ok(dips.every((d) => d[1] <= 1), `no cancellation as the amp fades in: a tone at ${dips.map((d) => `${d[0]} Hz dips ${f1(d[1])} dB`).join(', ')} below the lower end of DRIVE 0 to 1`);
});

block('level, presets, extremes, determinism', () => {
  const bdi = TS.bassDI(8, SR), fx = metalDI('bass');
  const d1 = L(run(def, {}, bdi)[0]) - L(bdi), d2 = L(run(def, {}, fx)[0]) - L(fx), tp = Math.max(...[bdi, fx].map((x) => truePeak({ sr: SR, channels: [run(def, {}, x)[0], run(def, {}, x)[1]] })));
  ok(Math.abs(d1) <= 1 && Math.abs(d2) <= 1 && tp <= -1, `at its defaults: ${d1 >= 0 ? '+' : ''}${f1(d1)} LU on the house's bass DI and ${d2 >= 0 ? '+' : ''}${f1(d2)} LU on the Roundwound fixture against bypass, true peak ${f1(tp)} dBTP`);
  const rows = def.presets.map((p) => { const [y] = run(def, presetParams(def, p.name), fx); return [p.name, L(y) - L(fx), truePeak({ sr: SR, channels: [y, y] })]; });
  ok(rows.every((r) => Math.abs(r[1]) <= 3 && r[2] <= -1), `the presets on the fixture: ${rows.map((r) => `${r[0]} ${r[1] >= 0 ? '+' : ''}${f1(r[1])} LU, ${f1(r[2])} dBTP`).join('; ')}`);
  const short = fx.subarray(0, 2 * SR), cases = [];
  for (const [name, p] of [['all min', Object.fromEntries(def.params.map((q) => [q.key, q.min]))], ['all max', Object.fromEntries(def.params.map((q) => [q.key, q.max]))], ...def.params.flatMap((q) => [[q.key + ' min', { [q.key]: q.min }], [q.key + ' max', { [q.key]: q.max }]])]) {
    const [y] = run(def, p, short); let pk = 0, fin = true; for (const v of y) { if (!Number.isFinite(v)) fin = false; else pk = Math.max(pk, Math.abs(v)); }
    cases.push([name, fin, 20 * Math.log10(pk + 1e-12)]);
  }
  ok(cases.every((c) => c[1] && c[2] < 24), `every param at its min and max, all min and all max (${cases.length} cases): finite, worst ${f1(Math.max(...cases.map((c) => c[2])))} dBFS`);
  const [a] = run(def, {}, short), [b] = run(def, {}, short);
  ok(a.every((v, i) => v === b[i]), 'two renders are bit-identical');
  const [nob] = run(def, {}, short, short, { data: null }), [filt] = run(def, { cab: 6 }, short);
  ok(nob.every((v, i) => v === filt[i]), 'with no cab bank its top plays the Filter 4x12');
});

const nc = await checkDeviceNode(def);
ok(nc.ok && nc.deterministic && !nc.errors.length, `the device check (Node): ${summarize(nc)}`);

if (!process.env.NODE_ONLY) {
  console.log('golden scene, in Node and in Chromium');
  await goldenChecks(T, ['fx:core.bassrig#' + CABS_HASH.slice(7, 19)], ['/app/src/devices/builtin/bassrig.js']);
}
T.done();
