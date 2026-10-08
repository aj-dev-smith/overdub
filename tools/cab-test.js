// The cab bank and Iso Cab (core.cab), intent 0008, spec R19-R22 and R35. In Node:
//   the bank (kernel data, tools/kits/jester-cabs.js): six 24-bit mono IRs of 2048 taps at 48 kHz, each set to unity
//   power between 1 and 3 kHz; rebuilt from the download cache it is the pinned file, byte for byte, its handbooks (the
//   CC0 grant) checked first; each cut's third-octave error against the whole IR, 80 Hz to 10 kHz, within 1.0 dB
//   every option sounds and differs from every other by at least 1 dB in some third octave
//   the Filter 4x12's shape (high-pass 80, +4 at 110, -3 at 400, +3 at 2.5 kHz, 12 dB/oct from 5 kHz)
//   Iso Cab: its params and presets, no latency, within 1 LU of bypass at its defaults, MIX 0 the dry signal exactly,
//   with no bank the filter cab; the device check; the words the rack shows while the bank loads or is missing
//   the golden scene fx:core.cab#7fd30c061e6b, in Node and in Chromium's worklet
//   node tools/cab-test.js            (NODE_ONLY=1 skips Chromium)
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { tally } from './pw.js';
import '../app/src/devices/builtin/index.js';
import def, { CAB_TRIM } from '../app/src/devices/builtin/cab.js';
import { CABS_HASH, CAB_LABELS, CAB_NAMES, CAB_IDS, CAB_FILTER, CAB_SAYS } from '../app/src/devices/builtin/amp-lib.js';
import { dataFor } from '../app/src/engine/node/data.js';
import { RECIPE, buildCabs, wav24, cutIr, thirdOctaves, THIRDS } from './kits/jester-cabs.js';
import { openZip } from './kits/zip.js';
import { presetParams } from '../app/src/devices/registry.js';
import { lufs, truePeak } from '../app/src/audio/measure.js';
import * as TS from '../app/src/audio/testsignals.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { summarize } from '../app/src/kernel/check.js';
import { SR, run, goldenChecks } from './amp-scenes.js';

const T = tally('cab');
const ok = T.ok;
const CACHE = path.join(path.dirname(new URL(import.meta.url).pathname), '.out', 'kits-cache');
const L = (x) => lufs({ sr: SR, channels: [x, x] });
const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
function block(title, fn) { console.log(title); return Promise.resolve().then(fn).catch((e) => ok(false, `${title}: threw ${e && e.stack}`)); }

const bank = dataFor(def.data).cabs;
const tapsOf = (i) => { const s = bank.samples[i], g = s.gain / 8388608; return Float64Array.from(s.ch[0], (v) => v * g); };

await block('the bank', async () => {
  ok(bank && bank.bits === 24 && bank.channels === 1 && bank.sr === 48000 && bank.samples.length === 6, `the cab bank (${CABS_HASH.slice(0, 19)}...) is here: ${bank && bank.samples.length} IRs, ${bank && bank.bits}-bit, ${bank && bank.channels} channel, ${bank && bank.sr} Hz (node tools/fetch-kits.js cab builds it)`);
  ok(bank.samples.every((s, i) => s.id === CAB_IDS[i] && s.name === CAB_NAMES[i] && s.frames === 2048 && s.gain > 0.1 && s.gain < 0.5), `in the switch's order, each 2048 taps with its gain: ${bank.samples.map((s) => `${s.id} ${s.gain}`).join(', ')}`);
  ok(bank.meta.kind === 'cabs' && /CC0/.test(bank.meta.licence) && /Jester Dyne Productions/.test(bank.meta.credit), `its header says what it is, its licence and its credit ("${bank.meta.credit}")`);
  // unity mean power gain between 1 and 3 kHz, each (the level the build set)
  const mid = bank.samples.map((_, i) => { const t = thirdOctaves(tapsOf(i)); const k = THIRDS.map((f, j) => [f, t[j]]).filter(([f]) => f >= 1000 && f <= 2600); return 10 * Math.log10(k.reduce((a, [, v]) => a + Math.pow(10, v / 10), 0) / k.length); });
  ok(mid.every((v) => Math.abs(v) < 1), `each sits at unity between 1 and 3 kHz (third-octave mean ${mid.map(f2).join(', ')} dB)`);
  // rebuilt from the cache: the pinned bytes; and the cut's error against the whole IR
  const have = Object.values(RECIPE.zips).every((z) => fs.existsSync(path.join(CACHE, z.sha256 + '.zip')));
  if (!have) { T.note('the IR packs are not in the download cache (node tools/fetch-kits.js cab fetches them): the rebuild and the cut errors are skipped'); return; }
  const r = await buildCabs(RECIPE, (k, z) => openZip(z, { cache: CACHE, offline: true }));
  ok('sha256-' + crypto.createHash('sha256').update(r.bytes).digest('hex') === CABS_HASH, 'rebuilt from the cached zips (the handbooks checked first), it is the pinned bank, byte for byte');
  console.log('    IR                cut    third-octave error at 2048 / 4096 taps (80 Hz-10 kHz)');
  for (const row of r.rows) console.log(`    ${row.id.padEnd(17)} ${String(row.taps).padEnd(6)} ${row.errs.map((e) => f2(e) + ' dB').join(' / ')}  (of ${row.frames} frames)`);
  ok(r.rows.every((row) => row.taps === 2048 && row.errs[0] <= 1), `every cut is within 1.0 dB of its whole IR in every third octave (worst ${f2(Math.max(...r.rows.map((x) => x.errs[0])))} dB at 2048 taps)`);
  // the handbook pins are the licence: a changed handbook stops the build
  const z = await openZip(RECIPE.zips.brutal, { cache: CACHE, offline: true });
  let refused = false; try { z.read(RECIPE.zips.brutal.handbook.path, '0'.repeat(64)); } catch (e) { refused = /SHA-256/.test(e.message); }
  ok(refused, 'a handbook that isn\'t the pinned one is refused (the CC0 grant is checked, not assumed)');
  // the cut, directly: an IR's third octaves after cutIr against before
  const x = wav24(z.read(RECIPE.cabs[0].file, RECIPE.zips.brutal.files[RECIPE.cabs[0].file])).x, full = thirdOctaves(x), cut = thirdOctaves(cutIr(x, 2048));
  ok(Math.max(...full.map((v, i) => Math.abs(v - cut[i]))) <= 1 && x.length > 50000, `the close dynamic's ${x.length} frames (1.2 s of cab and room) cut to 2048 taps keep its third octaves within ${f2(Math.max(...full.map((v, i) => Math.abs(v - cut[i]))))} dB`);
});

await block('the options', () => {
  const resp = [0, 1, 2, 3, 4, 5].map((i) => thirdOctaves(tapsOf(i)));
  let worstPair = Infinity, pair = '';
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) { const d = Math.max(...resp[a].map((v, k) => Math.abs(v - resp[b][k]))); if (d < worstPair) { worstPair = d; pair = `${CAB_IDS[a]} / ${CAB_IDS[b]}`; } }
  ok(worstPair >= 1, `every IR differs from every other by at least 1 dB in some third octave (the closest pair, ${pair}, by ${f1(worstPair)} dB)`);
  const strum = TS.diStrum(8, SR);
  const outs = [0, 1, 2, 3, 4, 5, 6].map((c) => run(def, { cab: c }, strum)[0]);
  ok(outs.every((y) => L(y) > -40), `each of the seven options sounds on the DI strum (${outs.map((y) => f1(L(y))).join(', ')} LUFS)`);
  // the filter cab's shape: Iso Cab's response with the cuts wide open
  const imp = new Float32Array(SR); imp[0] = 0.5;
  const [h] = run(def, { cab: CAB_FILTER, low_cut: 20, high_cut: 20000 }, imp);
  const at = (f) => { let re = 0, im = 0; for (let i = 0; i < 24000; i++) { re += h[i] * Math.cos(2 * Math.PI * f * i / SR); im -= h[i] * Math.sin(2 * Math.PI * f * i / SR); } return 20 * Math.log10(2 * Math.hypot(re, im)); };
  const r = { 40: at(40), 110: at(110), 400: at(400), 1000: at(1000), 2500: at(2500), 10000: at(10000) };
  const rel = (f) => r[f] - r[1000];
  ok(rel(110) > 2 && rel(400) < -1.5 && rel(2500) > 1.5 && rel(40) < -6 && rel(10000) < -12, `the Filter 4x12, re 1 kHz: ${Object.keys(r).map((f) => `${f} Hz ${f1(rel(+f))}`).join(', ')} dB (the high-pass, the 110 Hz bump, the 400 Hz dip, the 2.5 kHz lift, the 5 kHz roll-off)`);
});

await block('Iso Cab', () => {
  ok(def.id === 'core.cab' && def.name === 'Iso Cab' && def.kind === 'effect' && def.cat === 'amp', `core.cab is Iso Cab (${def.cat})`);
  ok(JSON.stringify(def.params.map((p) => p.key)) === JSON.stringify(['cab', 'low_cut', 'high_cut', 'mix', 'level']), `its params, in the order they keep: ${def.params.map((p) => p.key).join(', ')}`);
  ok(JSON.stringify(def.params[0].opts) === JSON.stringify(CAB_LABELS.slice(0, 7)) && def.params.every((p) => p.desc && p.desc.length >= 20 && p.role), 'CAB: the six IRs and the filter cab; every param has a role and a desc');
  ok(def.presets.length >= 4 && def.presets.every((p) => presetParams(def, p.name)), `its presets: ${def.presets.map((p) => p.name).join(', ')}`);
  ok(!/celestion|vintage 30|greenback|shure|sm57|sennheiser|e606|marshall|jester|cookie|nacho|pesto/i.test(JSON.stringify([def.name, def.blurb, def.nod, def.params, def.presets])), 'no brand or pack patch name on it');
  ok(def.data.cabs === CABS_HASH && def.latency === 0 && JSON.stringify(def.dataSays) === JSON.stringify(CAB_SAYS), 'it names the bank, declares no latency, and says its own words while the bank loads');
  ok(CAB_SAYS.loading[0] === 'Loading cabs…' && CAB_SAYS.missing[0] === 'Cab file missing: playing the filter cab', `the rack says "${CAB_SAYS.loading[0]}" while it loads and "${CAB_SAYS.missing[0]}" without it`);
  const strum = TS.diStrum(8, SR), [y] = run(def, {}, strum);
  const d = L(y) - L(strum), tp = truePeak({ sr: SR, channels: [y, y] });
  ok(Math.abs(d) <= 1 && tp <= -1, `at its defaults: ${d >= 0 ? '+' : ''}${f1(d)} LU against bypass on the DI strum (trim ${CAB_TRIM} dB), ${f1(tp)} dBTP`);
  const [dry] = run(def, { mix: 0 }, strum);
  let same = true; for (let i = 0; i < strum.length; i++) if (dry[i] !== strum[i]) { same = false; break; }
  ok(same, 'MIX 0 is the dry signal, sample for sample');
  const imp = new Float32Array(4800); imp[100] = 0.5;
  const [hi] = run(def, {}, imp);
  let first = -1; for (let i = 0; i < hi.length; i++) if (Math.abs(hi[i]) > 1e-6) { first = i; break; }
  ok(first === 100, `no latency: an impulse at sample 100 is heard from sample ${first} (the first 128 taps convolve directly)`);
  const [nob] = run(def, {}, strum, strum, { data: null }), [filt] = run(def, { cab: CAB_FILTER }, strum);
  let eq = true; for (let i = 0; i < nob.length; i++) if (nob[i] !== filt[i]) { eq = false; break; }
  ok(eq && Math.abs(L(filt) - L(y)) <= 1.5, `with no bank every IR choice plays the Filter 4x12 (${f1(L(filt) - L(y))} LU from the close dynamic)`);
  const st = [0.3, -0.3].map((g) => Float32Array.from(strum, (v) => v * g));
  const [sl, sr] = run(def, {}, st[0], st[1]);
  let anti = 0; for (let i = 0; i < sl.length; i++) anti = Math.max(anti, Math.abs(sl[i] + sr[i]));
  ok(anti < 1e-6, 'each side has its own cab: opposite signals in come out opposite');
});

const nc = await checkDeviceNode(def);
ok(nc.ok && nc.deterministic && !nc.errors.length && !nc.warnings.length, `the device check (Node): ${summarize(nc)}`);

if (!process.env.NODE_ONLY) {
  console.log('golden scene, in Node and in Chromium');
  await goldenChecks(T, ['fx:core.cab#' + CABS_HASH.slice(7, 19)], ['/app/src/devices/builtin/cab.js']);
}
T.done();
