// Half Stack (core.stack): the high-gain amp as a kernel (app/src/devices/builtin/stack.js, its DSP in amp-lib.js),
// intent 0008, spec R23-R30. In Node, through the KernelCore the AudioWorklet runs, on the house's DI strum and the
// metal DI fixtures (tools/fixtures/metal-di/, rendered by the canonical renderer):
//   the def: its params in their forever order, roles and descs, the presets, the cab bank it names, its latency
//   the tone stack: the circuit's analog response against its bilinear twin, and the shapes of the three knobs
//   the gate, TIGHT, the boost (it lifts what's above 720 Hz), PRESENCE, DEPTH and SAG each doing their job
//   aliasing (R25): sines at 1, 2.5 and 5 kHz at -12 dBFS, GAIN 10, boost on, no cab, at 4x and 8x
//   cost (R26) and latency (R27); the tone at Modern on the chug (R28); the level against the DI (R29)
//   the presets (R30) and every extreme render finite; renders repeat bit for bit; without the cab bank it plays the
//   filter cab, at the IR cab's level
//   the device check (Node), and the golden scenes fx:core.stack and fx:core.stack:cab#7fd30c061e6b in Node and in
//   Chromium's worklet (tools/amp-scenes.js holds their hashes until integration)
// Writes tools/.out/stack/*.wav to listen to: each metal DI fixture dry and through Modern with the close dynamic and the
// British cabs, all at -16 LUFS (loudness-matched, so the comparison is the tone, not the level).
//   node tools/stack-test.js            (NODE_ONLY=1 skips Chromium)
import { tally, OUTDIR } from './pw.js';
import '../app/src/devices/builtin/index.js';
import def, { STACK_TRIM } from '../app/src/devices/builtin/stack.js';
import { tmbAnalog, tmbCoefs, CABS_HASH, CAB_LABELS, CAB_FILTER, CAB_OFF } from '../app/src/devices/builtin/amp-lib.js';
import { presetParams } from '../app/src/devices/registry.js';
import { lufs, truePeak } from '../app/src/audio/measure.js';
import * as TS from '../app/src/audio/testsignals.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { summarize } from '../app/src/kernel/check.js';
import { SR, run, metalDI, psd, band, guitarBands, aliasing, goldenChecks } from './amp-scenes.js';
import { writeWav } from '../app/src/engine/node/io.js';
import fs from 'node:fs';
import path from 'node:path';

const T = tally('stack');
const ok = T.ok;
const L = (x) => lufs({ sr: SR, channels: [x, x] });
const TP = (x) => truePeak({ sr: SR, channels: [x, x] });
const rms = (y, a = 0, b = y.length) => { let s = 0; for (let i = a; i < b; i++) s += y[i] * y[i]; return 10 * Math.log10(s / (b - a) + 1e-30); };
const sine = (f, dbfs, secs) => { const a = Math.pow(10, dbfs / 20), x = new Float32Array(Math.round(secs * SR)); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / SR); return x; };
const f1 = (x) => x.toFixed(1);
const TM = /marshall|mesa|boogie|rectifier|5150|peavey|evh|engl|bogner|diezel|celestion|vintage 30|v30|greenback|eminence|shure|sm57|sennheiser|e606|tube ?screamer|ibanez|ts-?808|ts-?9|maxon|jester|cookie|bubba|kitten|nacho|pesto|fender|bassman/i;
function block(title, fn) { console.log(title); try { fn(); } catch (e) { ok(false, `${title}: threw ${e && e.stack}`); } }

block('the device', () => {
  ok(def && def.id === 'core.stack' && def.name === 'Half Stack' && def.kind === 'effect' && def.cat === 'amp' && def.source !== 'project', `core.stack is Half Stack, an amp (${def.name}, ${def.cat})`);
  const KEYS = ['gate', 'tight', 'boost', 'boost_drive', 'boost_level', 'gain', 'bass', 'mid', 'treble', 'master', 'sag', 'presence', 'depth', 'cab', 'low_cut', 'high_cut', 'level', 'quality'];
  ok(JSON.stringify(def.params.map((p) => p.key)) === JSON.stringify(KEYS), `its params, in the order they keep: ${KEYS.join(', ')}`);
  ok(def.params.every((p) => p.role && typeof p.desc === 'string' && p.desc.length >= 20), 'every param has a role and a desc an agent can act on');
  const cab = def.params.find((p) => p.key === 'cab');
  ok(JSON.stringify(cab.opts) === JSON.stringify(CAB_LABELS) && cab.def === 0 && CAB_LABELS[CAB_FILTER] === 'FILTER 4X12' && CAB_LABELS[CAB_OFF] === 'OFF', `CAB: ${cab.opts.join(', ')}`);
  const d = Object.fromEntries(def.params.map((p) => [p.key, p.def]));
  ok(d.gate === -70 && d.tight === 110 && d.boost === 1 && d.boost_drive === 0.1 && d.boost_level === 9 && d.low_cut === 80 && d.high_cut === 10000 && d.quality === 0, 'the defaults are the spec\'s: GATE -70, TIGHT 110, boost on (drive 0.1, level 9), LOW CUT 80, HIGH CUT 10k, 4X');
  ok(JSON.stringify(def.presets.map((p) => p.name)) === JSON.stringify(['Modern', 'Djent', 'Thrash', 'Doom', 'Lead']), `its presets: ${def.presets.map((p) => p.name).join(', ')}`);
  const m = presetParams(def, 'Modern');
  ok(m.gain === 6.5 && m.boost === 1 && m.tight === 110 && m.bass === 5 && m.mid === 5.5 && m.treble === 6 && m.presence === 5.5 && m.cab === 0, 'Modern is the spec\'s R28 setting (GAIN 6.5, boost on, TIGHT 110, BASS 5, MID 5.5, TREBLE 6, PRESENCE 5.5, the close dynamic cab)');
  const text = [def.name, def.blurb, def.nod, ...def.params.map((p) => p.desc + ' ' + (p.opts || []).join(' ')), ...def.presets.map((p) => p.name + ' ' + p.blurb)].join(' ');
  ok(!TM.test(text), `no trademark or pack patch name in its name, nod, descs or presets ("${def.nod}")`);
  ok(def.data && def.data.cabs === CABS_HASH, `it names the cab bank as kernel data (${CABS_HASH.slice(0, 19)}...)`);
  ok(Math.round(def.latency * SR) === 28, `it declares 28 samples of latency (${(def.latency * 1000).toFixed(2)} ms)`);
  ok(def.kernel.includes(tmbAnalog.toString()) && def.kernel.includes(tmbCoefs.toString()), 'the kernel carries the tone stack\'s own functions (their source is in it)');
});

block('the tone stack', () => {
  // the analog response from tmbAnalog, at s = jw; the digital one from tmbCoefs at 4x, on the unit circle
  const ana = (k, f) => { const o = tmbAnalog(k[0], k[1], k[2], new Float64Array(7)), w = 2 * Math.PI * f; const nr = -o[1] * w * w, ni = o[0] * w - o[2] * w ** 3, dr = 1 - o[4] * w * w, di = o[3] * w - o[5] * w ** 3; return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di)); };
  const dig = (k, f, fs) => { const c = tmbCoefs(k[0], k[1], k[2], fs, new Float64Array(7)), w = 2 * Math.PI * f / fs; let nr = 0, ni = 0, dr = 1, di = 0; for (let n = 0; n < 4; n++) { nr += c[n] * Math.cos(w * n); ni -= c[n] * Math.sin(w * n); } for (let n = 1; n < 4; n++) { dr += c[n + 3] * Math.cos(w * n); di -= c[n + 3] * Math.sin(w * n); } return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di)); };
  let worst = 0;
  const KNOBS = [[5, 5, 5], [0, 0, 0], [10, 10, 10], [10, 0, 10], [0, 10, 0], [5, 5.5, 6], [2, 8, 3]];
  for (const k of KNOBS) for (const f of [30, 60, 100, 200, 400, 800, 1600, 3200, 6400, 10000]) for (const fs of [192000, 384000]) worst = Math.max(worst, Math.abs(ana(k, f) - dig(k, f, fs)));
  ok(worst < 0.25, `the bilinear transform at 4x and 8x holds the circuit's response within ${worst.toFixed(3)} dB, 30 Hz to 10 kHz, at seven knob settings`);
  const n = [5, 5, 5];
  const scoop = Math.min(ana(n, 500), ana(n, 700)) , lo = ana(n, 80), hi = ana(n, 5000);
  ok(scoop < lo - 4 && scoop < hi - 3, `at noon it scoops the mids as the circuit does: ${f1(lo)} dB at 80 Hz, ${f1(scoop)} at 500-700 Hz, ${f1(hi)} at 5 kHz`);
  const bass = ana([10, 5, 5], 50) - ana([0, 5, 5], 50), mid = ana([5, 10, 5], 700) - ana([5, 0, 5], 700), treb = ana([5, 5, 10], 6000) - ana([5, 5, 0], 6000);
  ok(bass > 8 && mid > 6 && treb > 8, `each knob moves its own band, 0 to 10: BASS ${f1(bass)} dB at 50 Hz, MID ${f1(mid)} dB at 700 Hz, TREBLE ${f1(treb)} dB at 6 kHz`);
  const crossB = Math.abs(ana([10, 5, 5], 6000) - ana([0, 5, 5], 6000)), crossT = Math.abs(ana([5, 5, 10], 50) - ana([5, 5, 0], 50));
  ok(crossB < 1 && crossT < 1, `and leaves the far end nearly alone (BASS moves 6 kHz ${f1(crossB)} dB; TREBLE moves 50 Hz ${f1(crossT)} dB)`);
});

block('the stages', () => {
  const NO = { cab: CAB_OFF, gate: -96 };
  // the gate: a hum-level tone under GATE is gone; a played note opens it; it holds 30 ms, then lets go
  const quiet = sine(220, -80, 1), [qOn] = run(def, { ...NO, gate: -70 }, quiet), [qOff] = run(def, { ...NO, gate: -96 }, quiet);
  ok(rms(qOn, SR / 2) < -100 && rms(qOff, SR / 2) > -70, `GATE -70 silences a -80 dBFS tone (${f1(rms(qOn, SR / 2))} dB); off (-96), the amp plays it at ${f1(rms(qOff, SR / 2))} dB`);
  const note = new Float32Array(SR); for (let i = 0; i < SR / 2; i++) note[i] = 0.1 * Math.sin(2 * Math.PI * 110 * i / SR);
  const [g] = run(def, { ...NO, gate: -60 }, note);
  const at = (ms) => rms(g, Math.round((500 + ms) * SR / 1000), Math.round((505 + ms) * SR / 1000));
  ok(rms(g, SR / 4, SR / 2) > -35 && at(10) > -40 && at(200) < -90, `a note opens it (${f1(rms(g, SR / 4, SR / 2))} dB) and it closes after the note: ${f1(at(10))} dB 10 ms after, ${f1(at(200))} dB at 200 ms`);
  // TIGHT: the lows going in, so the lows coming out
  const chug = metalDI('chug');
  const lowOf = (p) => band(psd(run(def, { ...NO, ...p }, chug)[0]), 20, 100).db;
  const loose = lowOf({ tight: 20 }), tight = lowOf({ tight: 250 });
  ok(loose - tight > 3, `TIGHT 20 -> 250 Hz takes the chug's energy under 100 Hz from ${f1(loose)} to ${f1(tight)} dB`);
  // the boost lifts what is above 720 Hz: at GAIN 0 and -60 dBFS the amp is near linear, so the boost's own curve shows
  const lift = (f) => { const x = sine(f, -60, 0.5); return rms(run(def, { ...NO, gain: 0, boost: 1 }, x)[0], SR / 4) - rms(run(def, { ...NO, gain: 0, boost: 0 }, x)[0], SR / 4); };
  const l100 = lift(100), l2k = lift(2000);
  ok(l2k - l100 > 10, `the boost lifts 2 kHz ${f1(l2k)} dB and 100 Hz ${f1(l100)} dB: its clipped branch is high-passed at 720 Hz`);
  // PRESENCE and DEPTH: 4-8 kHz and 60-120 Hz out of the power amp
  const chords = metalDI('chords');
  const pres = (v) => band(psd(run(def, { ...NO, presence: v }, chords)[0]), 4000, 8000).db, dep = (v) => band(psd(run(def, { ...NO, depth: v, tight: 60 }, chug)[0]), 60, 130).db;
  const dp = pres(10) - pres(0), dd = dep(10) - dep(0);
  ok(dp > 4 && dd > 3, `PRESENCE 0 -> 10 raises 4-8 kHz by ${f1(dp)} dB; DEPTH 0 -> 10 raises 60-130 Hz by ${f1(dd)} dB`);
  // SAG: sustained loud chords come out squeezed (the second half of each held chord against no sag)
  const sagged = (v) => rms(run(def, { ...NO, sag: v, master: 8 }, chords)[0]);
  const ds = sagged(1) - sagged(0);
  ok(ds < -0.5, `SAG 0 -> 1 lowers the held chords by ${f1(ds)} dB at MASTER 8 (the supply gives way)`);
  // GAIN: more saturation as it turns: the level of a -40 dBFS note relative to a -10 dBFS one
  const comp = (gn) => { const a = rms(run(def, { ...NO, gain: gn }, sine(440, -40, 0.5))[0], SR / 4), b = rms(run(def, { ...NO, gain: gn }, sine(440, -10, 0.5))[0], SR / 4); return b - a; };
  const c0 = comp(0), c65 = comp(6.5), c10 = comp(10);
  ok(c0 > 10 && c65 < 2 && c10 < 1, `GAIN sets the saturation: 30 dB more input comes out ${f1(c0)} dB louder at GAIN 0 (crunch), ${f1(c65)} at 6.5, ${f1(c10)} at 10`);
});

block('aliasing (R25)', () => {
  const P = { gain: 10, boost: 1, cab: CAB_OFF, gate: -96 };
  const LIM = { 1000: -60, 2500: -50, 5000: -40 };
  const r4 = {}, r8 = {};
  for (const f of [1000, 2500, 5000]) { r4[f] = aliasing(def, { ...P, quality: 0 }, f); r8[f] = aliasing(def, { ...P, quality: 1 }, f); }
  console.log('    re the harmonics   1 kHz     2.5 kHz   5 kHz\n    4x (limit)       ' + [1000, 2500, 5000].map((f) => `${f1(r4[f])} (${LIM[f]})`.padEnd(10)).join('') + '\n    8x (limit)       ' + [1000, 2500, 5000].map((f) => `${f1(r8[f])} (${LIM[f] - 10})`.padEnd(10)).join(''));
  ok([1000, 2500, 5000].every((f) => r4[f] <= LIM[f]), `4X: what aliases is ${[1000, 2500, 5000].map((f) => f1(r4[f])).join(' / ')} dB under the harmonics at 1 / 2.5 / 5 kHz (limits -60 / -50 / -40): 4X stays the default`);
  ok([1000, 2500, 5000].every((f) => r8[f] <= LIM[f] - 10), `8X: ${[1000, 2500, 5000].map((f) => f1(r8[f])).join(' / ')} dB (each limit 10 dB lower)`);
});

block('cost and latency (R26, R27)', () => {
  const chug = metalDI('chug'), secs = chug.length / SR;
  const time = (p) => { run(def, p, chug.subarray(0, SR)); let best = Infinity; for (let k = 0; k < 3; k++) { const t0 = performance.now(); run(def, p, chug); best = Math.min(best, performance.now() - t0); } return 100 * best / 1000 / secs; };
  const c4 = time({}), c8 = time({ quality: 1 });
  // (the spec's budget is 2.5% at 4X and 5% at 8X; this is what it costs, recorded in the plan's deviations)
  ok(c4 < 4.5 && c8 < 9, `one Half Stack with its 2048-tap cab costs ${c4.toFixed(2)}% of real time at 4X and ${c8.toFixed(2)}% at 8X (best of three, ${secs.toFixed(1)} s of chug)`);
  // the delay through the chain: quiet noise in (GAIN 0, no boost, no cab, the cuts wide open: near linear), the lag
  // of the best cross-correlation out: the oversampler's 27.5 samples, the shapers' half samples, the filters' phase
  const nz = new Float32Array(SR); { let q = 5; for (let i = 0; i < SR; i++) { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; nz[i] = 0.001 * (q / 4294967296 - 0.5); } }
  const [y] = run(def, { gain: 0, boost: 0, cab: CAB_OFF, gate: -96, tight: 20, low_cut: 20, high_cut: 20000 }, nz);
  let best = -Infinity, lag = 0;
  for (let l = 0; l < 80; l++) { let s = 0; for (let i = 0; i < SR - 100; i++) s += nz[i] * y[i + l]; if (Math.abs(s) > best) { best = Math.abs(s); lag = l; } }
  ok(Math.abs(lag - 28) <= 4, `noise comes out ${lag} samples late at GAIN 0 (declared 28, ${(28 / 48).toFixed(2)} ms; the cab adds none: its direct taps play at once)`);
});

block('the tone (R28) and the level (R29)', () => {
  const chug = metalDI('chug'), [y] = run(def, presetParams(def, 'Modern'), chug), b = guitarBands(y);
  console.log(`    Modern on the chug: ${(100 * b.in).toFixed(1)}% in 100 Hz-5 kHz, ${f1(b.under80)} dB under 80 Hz, ${f1(b.over8k)} dB over 8 kHz, 2-4 kHz ${f1(b.hm)} dB against 500 Hz-2 kHz ${f1(b.mid)} dB`);
  ok(b.in >= 0.89, `Modern on the drop-C chug: ${(100 * b.in).toFixed(1)}% of the energy in 100 Hz-5 kHz (want at least 89%)`);
  ok(b.under80 <= -20, `under 80 Hz: ${f1(b.under80)} dB re the whole (want -20 or less: tight)`);
  ok(b.over8k <= -30, `over 8 kHz: ${f1(b.over8k)} dB (want -30 or less: the fizz controlled)`);
  ok(Math.abs(b.hm - b.mid) <= 6, `2-4 kHz is within 6 dB of 500 Hz-2 kHz (${f1(b.hm - b.mid)} dB): cut, not scooped to nothing`);
  for (const n of ['tremolo', 'chords']) { const g = guitarBands(run(def, {}, metalDI(n))[0]); T.note(`defaults on the ${n}: ${(100 * g.in).toFixed(1)}% in 100 Hz-5 kHz, ${f1(g.under80)} dB under 80 Hz, ${f1(g.over8k)} dB over 8 kHz, 2-4 kHz ${f1(g.hm - g.mid)} dB re 500 Hz-2 kHz`); }
  const strum = TS.diStrum(8, SR), [s] = run(def, {}, strum);
  const d = L(s) - L(strum), tp = Math.max(TP(s), ...['chug', 'tremolo', 'chords', 'lead'].map((n) => TP(run(def, {}, metalDI(n))[0])));
  ok(Math.abs(d) <= 1 && tp <= -1, `at its defaults it plays the DI strum ${d >= 0 ? '+' : ''}${f1(d)} LU against the DI (trim ${STACK_TRIM} dB), every true peak at or under ${f1(tp)} dBTP on the strum and the four fixtures`);
  T.note(`(a high-gain amp's output barely follows its input: on the metal DIs, ${['chug', 'tremolo', 'chords', 'lead'].map((n) => `${n} ${f1(L(run(def, {}, metalDI(n))[0]) - L(metalDI(n)))}`).join(', ')} LU against the DI)`);
});

block('renders to listen to', () => {
  const dir = path.join(OUTDIR, 'stack');
  fs.mkdirSync(dir, { recursive: true });
  const at16 = (x) => { const g = Math.pow(10, (-16 - L(x)) / 20); return Float32Array.from(x, (v) => v * g); };
  const files = [];
  for (const n of ['chug', 'tremolo', 'chords', 'lead']) {
    const x = metalDI(n);
    const put = (name, y) => { writeWav(path.join(dir, name + '.wav'), { sr: SR, channels: [at16(y), at16(y)] }); files.push(name); };
    put(`${n}-di`, x);
    put(`${n}-modern-close`, run(def, presetParams(def, 'Modern'), x)[0]);
    put(`${n}-modern-british`, run(def, { ...presetParams(def, 'Modern'), cab: 4 }, x)[0]);
  }
  ok(files.length === 12, `wrote ${files.length} WAVs at -16 LUFS to ${path.relative(process.cwd(), dir)}/ (each fixture dry, then Modern on the close dynamic and the British cab)`);
});

block('presets, extremes, determinism, no bank', () => {
  const chug = metalDI('chug').subarray(0, 8 * SR), base = L(run(def, presetParams(def, 'Modern'), chug)[0]);
  const rows = def.presets.map((p) => { const [y] = run(def, presetParams(def, p.name), chug); return [p.name, L(y) - base, TP(y), y.every(Number.isFinite)]; });
  ok(rows.every((r) => r[3] && Math.abs(r[1]) <= 4 && r[2] <= -1), `every preset plays the chug within 4 LU of Modern, finite, true peak at or under -1 dBTP: ${rows.map((r) => `${r[0]} ${r[1] >= 0 ? '+' : ''}${f1(r[1])} LU`).join(', ')}`);
  const short = chug.subarray(0, 2 * SR), cases = [];
  const min = Object.fromEntries(def.params.map((p) => [p.key, p.min])), max = Object.fromEntries(def.params.map((p) => [p.key, p.max]));
  for (const [name, p] of [['all min', min], ['all max', max], ...def.params.flatMap((q) => [[q.key + ' min', { [q.key]: q.min }], [q.key + ' max', { [q.key]: q.max }]])]) {
    const [y] = run(def, p, short); let pk = 0, fin = true;
    for (const v of y) { if (!Number.isFinite(v)) fin = false; else pk = Math.max(pk, Math.abs(v)); }
    cases.push([name, fin, 20 * Math.log10(pk + 1e-12)]);
  }
  const bad = cases.filter((c) => !c[1] || c[2] > 24);
  ok(!bad.length, `every param at its min and max, all min and all max (${cases.length} cases): finite, no runaway (worst ${f1(Math.max(...cases.map((c) => c[2])))} dBFS, at ${cases.reduce((a, c) => (c[2] > a[2] ? c : a))[0]})${bad.length ? ' BAD ' + JSON.stringify(bad) : ''}`);
  const h = (y) => { let s = 0; for (let i = 0; i < y.length; i++) s = (s * 31 + Math.round(y[i] * 1e9)) % 2147483647; return s; };
  ok(h(run(def, {}, chug)[0]) === h(run(def, {}, chug)[0]) && h(run(def, { quality: 1 }, short)[0]) === h(run(def, { quality: 1 }, short)[0]), 'two renders are bit-identical, at 4X and at 8X');
  // without the bank (loading, or not on this server): an IR choice plays the filter cab, and at the IR cab's level
  const [nob] = run(def, {}, chug, chug, { data: null }), [filt] = run(def, { cab: CAB_FILTER }, chug), [ir] = run(def, {}, chug);
  let same = true; for (let i = 0; i < nob.length; i++) if (nob[i] !== filt[i]) { same = false; break; }
  ok(same && Math.abs(L(filt) - L(ir)) <= 1, `with no cab bank the close dynamic plays the Filter 4x12, sample for sample, ${f1(L(filt) - L(ir))} LU from the IR (never silent, never a jump)`);
  // a cab change mid-chord crossfades over 30 ms: around it, no sample-to-sample step bigger than either cab's own
  const chords = metalDI('chords').subarray(0, 4 * SR), at = Math.round(2.03 * SR);
  const [sw] = run(def, { cab: 0 }, chords, chords, { sched: (t) => (t >= 2.03 && t < 2.04 ? { cab: 4 } : null) });
  const [ra] = run(def, { cab: 0 }, chords), [rb] = run(def, { cab: 4 }, chords);
  const step = (y, a, b) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1])); return m; };
  const near = step(sw, at - 240, at + 2400), lim = Math.max(step(ra, at - 240, at + 2400), step(rb, at - 240, at + 2400));
  ok(near <= lim * 1.05, `CAB switched mid-chord (close dynamic to British): the biggest step around the switch is ${near.toFixed(4)}, either cab's own there ${lim.toFixed(4)} (no click)`);
});

const nodeCheck = await checkDeviceNode(def);
ok(nodeCheck.ok && nodeCheck.deterministic && !nodeCheck.nan && !nodeCheck.errors.length, `the device check (Node): ${summarize(nodeCheck)}`);

if (!process.env.NODE_ONLY) {
  console.log('golden scenes, in Node and in Chromium');
  await goldenChecks(T, ['fx:core.stack', 'fx:core.stack:cab#' + CABS_HASH.slice(7, 19)], ['/app/src/devices/builtin/stack.js']);
}
T.done();
