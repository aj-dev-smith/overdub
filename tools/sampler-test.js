// The sampled-instrument kernel (app/src/devices/builtin/sampler.js) and the melodic fields of a kit
// (docs/DEVICES.md, "Melodic kits").
//
//   node tools/sampler-test.js
//
// Always, on a kit made here from sine waves (so every check knows exactly what should come out): the melodic fields
// round-trip and leave older kits as they were; a note plays its zone at the right pitch (and a sample's `tune`);
// velocity picks the layer and crossfades across the boundary; the level climbs with velocity; round robins come
// from the seed and never repeat back to back; a sustain loop holds while the key is down and plays out after; a
// release sample sounds at note-off, softer the longer the key was held; the voice cap steals the oldest; the
// sustain pedal holds note-offs; a sample's `cutoff` filters it; the interpolator keeps a bright tone clean when it
// is moved up; renders repeat bit for bit.
// With Parlour Upright's kit fetched (node tools/fetch-kits.js): the file is the pinned one, packs within the piano
// budget and rebuilds byte for byte from the download cache; the device passes checkDevice, renders bit-exact twice
// and at 44.1 kHz; every one of the 88 keys plays its zone's sample at the right pitch; the level climbs with
// velocity on every octave, across the layer seam too; the studio fetches it packed and renders what Node does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from './pw.js';
import { encodeOdk, decodeOdk } from '../app/src/kernel/odk.js';
import { kernelCore, kernelCompiler } from '../app/src/kernel/worklet.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { normParam, paramValues } from '../app/src/devices/registry.js';
import { samplerKernel, samplerParams } from '../app/src/devices/builtin/sampler.js';
import { sha256 } from '../app/src/engine/node/io.js';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { open } from './pw.js';
import { getDevice } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import { UPRIGHT_HASH } from '../app/src/devices/builtin/upright.js';
import { RECIPE } from './kits/upright-kw.js';
import { GRAND_HASH } from '../app/src/devices/builtin/grand.js';
import { RECIPE as GRAND_RECIPE } from './kits/salamander.js';
import { ENSEMBLE_HASH } from '../app/src/devices/builtin/ensemble.js';
import { RECIPE as ENSEMBLE_RECIPE } from './kits/vsco-strings.js';
import { VIBES_HASH } from '../app/src/devices/builtin/vibes.js';
import { RECIPE as VIBES_RECIPE } from './kits/vcsl-vibes.js';
import { EBASS_HASH } from '../app/src/devices/builtin/ebass.js';
import { RECIPE as EBASS_RECIPE } from './kits/karoryfer-bass.js';
import { dataPath } from '../app/src/engine/node/data.js';
import { unpackOdk } from '../app/src/kernel/odkz.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { measure } from '../app/src/audio/measure.js';
import { createProject } from '../app/src/core/project.js';
import { phrase as testPhrase, PHRASE_BPM, PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import { pitchAt } from './kits/qa.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const t = tally('sampler');
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);

// ------------------------------------------------------------------------------------------------ a test kit
// Every sample is a sine (or two) at a known frequency, 48 kHz, so the kernel's output can be read back exactly:
//   key 60 (C4, 261.63 Hz), keys 55-66: a soft layer (vel 0-63, 2 round robins: 261.63 Hz and the same with a
//     2nd harmonic marker at 3x) and a hard layer (vel 64-127: 261.63 Hz plus a 5x marker)
//   key 72, keys 67-80, one layer, tuned 30 cents flat on record (tune: +30 puts it right)
//   key 48, keys 40-54: 1.0 s with a sustain loop over its last 0.5 s
//   a release sample for keys 55-66: 1.5 kHz, 0.3 s
//   key 84, keys 81-96: a 6 kHz tone, `cutoff` 2 kHz (filtered: much quieter than without)
//   key 100, keys 97-127: a 15 kHz tone (the interpolator's bright test)
const SR = 48000;
const tone = (secs, parts, fade = 0.02) => {
  const n = Math.round(secs * SR), x = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const [f, a] of parts) v += a * Math.sin(2 * Math.PI * f * i / SR);
    const g = Math.min(1, i / (0.002 * SR), (n - i) / (fade * SR));
    x[i] = Math.round(v * g * 16000);
  }
  return x;
};
const C4 = 261.6255653005986;
const st = (s) => [tone(s[0], s[1], s[2]), tone(s[0], s[1], s[2])];
const SAMPLES = [
  { id: 'c4.soft.0', key: 60, lo: 55, hi: 66, vlo: 0, vhi: 63, rr: 0, ch: st([2, [[C4, 1]]]) },
  { id: 'c4.soft.1', key: 60, lo: 55, hi: 66, vlo: 0, vhi: 63, rr: 1, ch: st([2, [[C4, 1], [3 * C4, 0.3]]]) },
  { id: 'c4.hard', key: 60, lo: 55, hi: 66, vlo: 64, vhi: 127, gain: 0, ch: st([2, [[C4, 1], [5 * C4, 0.3]]]) },
  { id: 'c5', key: 72, lo: 67, hi: 80, tune: 30, ch: st([2, [[2 * C4 * Math.pow(2, -30 / 1200), 1]]]) },
  { id: 'c3.loop', key: 48, lo: 40, hi: 54, loop: { s: 24000, e: 48000, mode: 'sustain' }, ch: st([1, [[C4 / 2, 1]], 0]) },
  { id: 'c4.rel', key: 60, lo: 55, hi: 66, trig: 'release', ch: st([0.3, [[1500, 0.5]]]) },
  { id: 'c6.lp', key: 84, lo: 81, hi: 96, cutoff: 2000, ch: st([1, [[6000, 1]]]) },
  { id: 'bright', key: 100, lo: 97, hi: 127, ch: st([1, [[15000, 1]]]) },
];
const kitBytes = encodeOdk({ name: 'Sine Test', sr: SR, bits: 16, channels: 2, meta: { kind: 'melodic', rt: { decay: 6 } }, samples: SAMPLES });
const KIT = decodeOdk(kitBytes);

// ------------------------------------------------------------------------------------------------ the format
console.log('melodic fields in the .odk');
{
  const s = KIT.samples.find((x) => x.id === 'c3.loop'), r = KIT.samples.find((x) => x.id === 'c4.rel'), c = KIT.samples.find((x) => x.id === 'c5');
  t.ok(s.key === 48 && s.lo === 40 && s.hi === 54 && s.loop.s === 24000 && s.loop.mode === 'sustain' && r.trig === 'release' && c.tune === 30 && KIT.meta.kind === 'melodic',
    'key, lo, hi, vlo, vhi, rr, trig, tune, gain, loop and cutoff ride in the header as plain fields, and come back');
  // an older kit (no melodic fields) decodes to exactly what it did: the fields are optional, the format string is the same
  const old = encodeOdk({ name: 'old', sr: SR, bits: 16, channels: 1, meta: {}, samples: [{ id: 'k', piece: 'kick', layer: 0, rr: 0, vel: 127, start: 3, ch: [Int16Array.of(1, 2, 3)] }] });
  const d = decodeOdk(old);
  t.ok(d.format === 'overdub-kit/1' && JSON.stringify(Object.keys(d.samples[0])) === JSON.stringify(['id', 'piece', 'layer', 'rr', 'vel', 'start', 'frames', 'at', 'ch']),
    'a drum kit\'s header is untouched: the same format string, the same fields');
}

// ------------------------------------------------------------------------------------------------ playing it
const PARAMS = samplerParams().map(normParam);
const SRC = samplerKernel({ makeup: 1, poly: 8, xfade: 6, law: 'linear' });   // (the test kit's layers are in phase: their amplitudes add)
function play(events, { secs = 2, sr = SR, params = {}, seed = 1, kit = KIT, src = SRC, poly = 8, specs = PARAMS } = {}) {
  const Core = kernelCore(sr, makeDsp(sr), kernelCompiler);
  const out = [];
  const c = new Core({ source: src, kind: 'instrument', params: specs, values: paramValues({ params: specs }, params), poly, seed, tail: 4, data: { kit } }, (m) => out.push(m));
  const err = out.find((m) => m.type === 'error');
  if (err) throw new Error(err.message);
  for (const e of events) c.msg({ ...e, time: e.time || 0 });
  const n = Math.ceil(secs * sr / 128) * 128, L = new Float32Array(n), R = new Float32Array(n);
  const bl = new Float32Array(128), br = new Float32Array(128);
  for (let f = 0; f < n; f += 128) { bl.fill(0); br.fill(0); c.block(null, null, bl, br, f); L.set(bl, f); R.set(br, f); }
  out.length = 0; c.msg({ type: 'stats' });
  return { sr, channels: [L, R], length: n, stats: out.find((m) => m.type === 'stats'), core: c };
}
const on = (p, v, time = 0) => ({ type: 'on', p, v, time });
const off = (p, time) => ({ type: 'off', p, time });
const rms = (x, a, b, sr = SR) => { let e = 0; const i0 = Math.round(a * sr), i1 = Math.min(x.length, Math.round(b * sr)); for (let i = i0; i < i1; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, i1 - i0)); };
// the amplitude of frequency f in x[a s..b s] (a Hann-windowed single-bin DFT)
const amp = (x, f, a, b, sr = SR) => { const i0 = Math.round(a * sr), i1 = Math.round(b * sr), N = i1 - i0; let re = 0, im = 0, w = 0; for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); re += x[i0 + i] * h * Math.cos(2 * Math.PI * f * i / sr); im += x[i0 + i] * h * Math.sin(2 * Math.PI * f * i / sr); w += h; } return 2 * Math.hypot(re, im) / w; };
// the frequency of the strongest partial near f0 (a fine search over a single-bin DFT), in Hz
const peakHz = (x, f0, a, b, sr = SR) => { let best = f0, bv = 0; for (let c = -60; c <= 60; c += 0.25) { const f = f0 * Math.pow(2, c / 1200), v = amp(x, f, a, b, sr); if (v > bv) { bv = v; best = f; } } return best; };
const cents = (f, ref) => 1200 * Math.log2(f / ref);

console.log('the sampler kernel');
{
  // pitch: two semitones up the C4 zone, and the zone at 44.1 kHz too; a sample's tune field
  for (const sr of [48000, 44100]) {
    const r = play([on(62, 0.9)], { sr, secs: 1 });
    const want = C4 * Math.pow(2, 2 / 12), got = peakHz(r.channels[0], want, 0.1, 0.9, sr);
    t.ok(Math.abs(cents(got, want)) < 0.5, `D4 from the C4 zone at ${sr / 1000} kHz: ${got.toFixed(2)} Hz (${cents(got, want).toFixed(2)} cents off ${want.toFixed(2)})`);
  }
  const c5 = play([on(72, 0.9)], { secs: 1 });
  const g5 = peakHz(c5.channels[0], 2 * C4, 0.1, 0.9);
  t.ok(Math.abs(cents(g5, 2 * C4)) < 0.5, `a sample recorded 30 cents flat with tune +30 plays C5 in tune (${cents(g5, 2 * C4).toFixed(2)} cents)`);
  const up = play([on(60, 0.9)], { secs: 1, params: { tune: 50 } });
  t.ok(Math.abs(cents(peakHz(up.channels[0], C4 * Math.pow(2, 50 / 1200), 0.1, 0.9), C4) - 50) < 0.5, 'TUNE +50 moves it 50 cents');

  // velocity: the layers, by their markers (3x: the soft layer's second round robin; 5x: the hard layer)
  const soft = play([on(60, 0.25)], { secs: 1 }), hard = play([on(60, 0.95)], { secs: 1 });
  const m5 = (r) => amp(r.channels[0], 5 * C4, 0.1, 0.9) / amp(r.channels[0], C4, 0.1, 0.9);
  t.ok(m5(soft) < 0.01 && Math.abs(m5(hard) - 0.3) < 0.01, `velocity picks the layer (the hard layer's marker: ${m5(soft).toFixed(3)} soft, ${m5(hard).toFixed(3)} hard)`);
  const edge = play([on(60, 63.5 / 127)], { secs: 1 });
  t.ok(m5(edge) > 0.1 && m5(edge) < 0.25, `on the boundary both layers play, crossfaded (marker ${m5(edge).toFixed(3)} of 0.3)`);
  const lv = [];
  for (let v = 4; v <= 127; v += 3) { const r = play([on(60, v / 127)], { secs: 0.4 }); lv.push([v, db(rms(r.channels[0], 0.05, 0.35))]); }
  // (the curve: 40 log10(vel / 127), the SFZ default, when a kit names none)
  let down = 0, worst = 0;
  for (let i = 1; i < lv.length; i++) if (lv[i][1] - lv[i - 1][1] < -0.05) down++;
  for (const [v, d] of lv) worst = Math.max(worst, Math.abs(d - lv[lv.length - 1][1] - 40 * Math.log10(v / lv[lv.length - 1][0])));
  t.ok(down === 0 && worst < 0.6, `the level climbs with velocity along the curve (${lv[0][1].toFixed(1)} dB at 4 to ${lv[lv.length - 1][1].toFixed(1)} at 127, never down, at most ${worst.toFixed(2)} dB off 40 log10(v/127), across the layer seam too)`);
  const flat = play([on(60, 0.2)], { secs: 0.4, params: { dynamics: 0 } }), full = play([on(60, 0.95)], { secs: 0.4, params: { dynamics: 0 } });
  t.ok(Math.abs(db(rms(flat.channels[0], 0.05, 0.35)) - db(rms(full.channels[0], 0.05, 0.35))) < 1.5, 'DYNAMICS 0% plays soft and hard notes at one level');

  // round robins: the soft layer's two samples, told apart by the 3x marker; repeats never back to back; from the seed
  const seq = (seed) => {
    const ev = []; for (let k = 0; k < 8; k++) ev.push(on(60, 0.3, k * 0.25), off(60, k * 0.25 + 0.2));
    const r = play(ev, { secs: 2.2, seed, params: { release: 0.05 } });
    return Array.from({ length: 8 }, (_, k) => (amp(r.channels[0], 3 * C4, k * 0.25 + 0.03, k * 0.25 + 0.18) / amp(r.channels[0], C4, k * 0.25 + 0.03, k * 0.25 + 0.18) > 0.15 ? 2 : 1)).join('');
  };
  const s1 = seq(1), s1b = seq(1), s2 = seq(7);
  t.ok(s1 === s1b && !/11|22/.test(s1) && s1 !== s2 || (s1 === s1b && !/11|22/.test(s1) && !/11|22/.test(s2)), `round robins alternate, never the same sample twice running, the same for the same seed (${s1}, again ${s1b}; seed 7: ${s2})`);

  // a sustain loop: held past the sample's end it keeps sounding; released, it plays out its last loop pass and stops
  const held = play([on(48, 0.9), off(48, 3)], { secs: 4.5, params: { release: 6 } });
  const lvHeld = db(rms(held.channels[0], 2.5, 2.9));
  t.ok(lvHeld > -30, `a sustain loop holds while the key is down (2.5 s into a 1 s sample: ${lvHeld.toFixed(1)} dB)`);
  t.ok(db(rms(held.channels[0], 3.6, 4.4)) < -100, 'let go, it plays on to the sample\'s end and stops (no loop after the key lifts)');

  // a release sample: 1.5 kHz at note-off, softer after a longer hold
  const relAt = (hold) => { const r = play([on(60, 0.9), off(60, hold)], { secs: hold + 0.5, params: { release: 0.05 } }); return amp(r.channels[0], 1500, hold + 0.02, hold + 0.25); };
  const r1 = relAt(0.2), r2 = relAt(1.2);
  t.ok(r1 > 0.005 && r2 < r1 && Math.abs(db(r1 / r2) - 6) < 1, `a release sample sounds when the key lifts, ${db(r1 / r2).toFixed(1)} dB softer after a second more of holding (the kit's rt decay: 6 dB/s)`);
  const noRel = play([on(60, 0.9)], { secs: 1 });
  t.ok(amp(noRel.channels[0], 1500, 0.3, 0.8) < 1e-4, 'and never while the key is down');

  // the voice cap: 12 notes on an 8-voice instance
  const many = play(Array.from({ length: 12 }, (_, k) => on(55 + k % 12, 0.8, k * 0.05)), { secs: 1 });
  t.ok(many.stats.voices <= 8 && many.stats.maxVoices <= 10 && many.stats.steals >= 4, `twelve notes on eight voices: ${many.stats.voices} sound, ${many.stats.steals} stolen (the oldest first, by the host; at most ${many.stats.maxVoices} at once while the stolen fade)`);

  // the sustain pedal (the host's CC64): a note-off while it's down waits for it to lift
  const ped = play([{ type: 'expr', sustain: true, time: 0 }, on(60, 0.9), off(60, 0.2), { type: 'expr', sustain: false, time: 1.2 }], { secs: 2, params: { release: 0.1 } });
  t.ok(db(rms(ped.channels[0], 0.8, 1.1)) > -30 && db(rms(ped.channels[0], 1.6, 2)) < -60, `the pedal holds a released note (${db(rms(ped.channels[0], 0.8, 1.1)).toFixed(1)} dB at 0.8 s) until it lifts (${db(rms(ped.channels[0], 1.6, 2)).toFixed(1)} dB after)`);

  // a sample's cutoff: 6 kHz through a 2 kHz 2-pole low pass is about 19 dB down
  const lp = play([on(84, 0.9)], { secs: 0.6 });
  const nolp = play([on(84, 0.9)], { secs: 0.6, kit: { ...KIT, samples: KIT.samples.map((s) => (s.id === 'c6.lp' ? { ...s, cutoff: undefined } : s)) } });
  const cut = db(amp(lp.channels[0], 6000, 0.1, 0.5) / amp(nolp.channels[0], 6000, 0.1, 0.5));
  t.ok(cut < -17 && cut > -21, `a sample's cutoff filters it (6 kHz through 2 kHz: ${cut.toFixed(1)} dB)`);

  // the interpolator: a 15 kHz tone moved up 3 semitones; what isn't the tone is the interpolator's error
  const br = play([on(103, 0.9)], { secs: 0.6, params: { dynamics: 0 } });
  const fo = 15000 * Math.pow(2, 3 / 12), x = br.channels[0], i0 = Math.round(0.1 * SR), N = 16384;
  let a = 0, b = 0, cc = 0, ss = 0;
  for (let i = 0; i < N; i++) { const c = Math.cos(2 * Math.PI * fo * i / SR), s = Math.sin(2 * Math.PI * fo * i / SR); a += x[i0 + i] * c; b += x[i0 + i] * s; cc += c * c; ss += s * s; }
  let e = 0, sig = 0;
  for (let i = 0; i < N; i++) { const r = x[i0 + i] - (a / cc) * Math.cos(2 * Math.PI * fo * i / SR) - (b / ss) * Math.sin(2 * Math.PI * fo * i / SR); e += r * r; sig += x[i0 + i] * x[i0 + i]; }
  const spur = 10 * Math.log10(e / sig);
  t.ok(spur < -60, `a 15 kHz tone moved up 3 semitones stays clean: everything else is ${spur.toFixed(1)} dB under it (the drum kit's Hermite: -16.5)`);

  // the same events, the same samples, bit for bit
  const ev = [on(60, 0.5), on(64, 0.7, 0.1), on(67, 0.9, 0.2), off(60, 0.8), off(64, 0.9), off(67, 1)];
  t.ok(sha256(play(ev)) === sha256(play(ev)), 'two renders are bit-identical');

  // no kit: silence, and no error
  const none = play([on(60, 0.9)], { secs: 0.5, kit: null });
  t.ok(rms(none.channels[0], 0, 0.5) === 0, 'with no kit it plays silence');
}

// ------------------------------------------------------------------------------------------------ Parlour Upright
const def = getDevice('core.upright');
if (!fs.existsSync(dataPath(UPRIGHT_HASH))) {
  t.note(`Parlour Upright's kit isn't fetched (${path.relative(path.join(HERE, '..'), dataPath(UPRIGHT_HASH))}): node tools/fetch-kits.js, then this runs in full`);
  t.done();
  process.exit();
}
console.log('Parlour Upright: the kit file');
const bytes = fs.readFileSync(dataPath(UPRIGHT_HASH));
const up = decodeOdk(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
{
  t.ok('sha256-' + crypto.createHash('sha256').update(bytes).digest('hex') === UPRIGHT_HASH, `the file is the pinned kit (${UPRIGHT_HASH.slice(0, 19)}...)`);
  const zf = dataPath(UPRIGHT_HASH) + 'z', have = fs.existsSync(zf);
  const zb = have ? fs.readFileSync(zf) : null;
  t.ok(have && 'sha256-' + crypto.createHash('sha256').update(unpackOdk(zb)).digest('hex') === UPRIGHT_HASH, 'its .odkz unpacks to it, byte for byte');
  if (zb) {
    const g1 = zlib.gzipSync(bytes, { level: 9 }).length, g2 = zlib.gzipSync(zb, { level: 9 }).length;
    t.ok(g2 <= 15e6, `on the wire: ${(g2 / 1e6).toFixed(2)} MB packed and gzipped (the piano budget is 15 MB; ${(g1 / 1e6).toFixed(2)} MB as a gzipped .odk)`);
  }
  t.ok(up.sr === 44100 && up.bits === 16 && up.channels === 2 && up.samples.length === 66, `66 samples, 44.1 kHz, 16-bit, stereo (${up.samples.length}, ${up.sr}, ${up.bits}, ${up.channels})`);
  t.ok(up.meta.licence === 'CC0-1.0' && up.meta.commit === RECIPE.commit && up.meta.source === RECIPE.source && up.meta.kind === 'melodic', `it carries its source and licence (${up.meta.licence}, ${up.meta.repo}@${String(up.meta.commit).slice(0, 12)})`);
  // every key A0..C8 is covered by exactly one zone per layer
  const gaps = [];
  for (let k = 21; k <= 108; k++) for (const [lo, hi] of [[0, 80], [81, 127]]) { const n = up.samples.filter((s) => k >= s.lo && k <= s.hi && s.vlo === lo && s.vhi === hi).length; if (n !== 1) gaps.push(`${k}@${lo}:${n}`); }
  t.ok(!gaps.length, `all 88 keys have one sample in each layer${gaps.length ? ' (not: ' + gaps.slice(0, 8).join(', ') + ')' : ''}`);
  // the build: no flat tops in the 16-bit samples, DC under -60 dBFS, every unlooped tail ends 60 dB down or more
  let flat = 0, dc = -200, tail = -200;
  for (const sm of up.samples) {
    for (const c of sm.ch) { let s0 = 0, run = 0; for (let i = 0; i < c.length; i++) { s0 += c[i]; if (Math.abs(c[i]) >= 32400 && i && c[i] === c[i - 1]) { if (++run === 2) flat++; } else run = 0; } dc = Math.max(dc, db(Math.abs(s0 / c.length) / 32768)); }
    if (!sm.loop) { const c = sm.ch[0], n = c.length; let pk = 0, e = 0; for (const x of c) pk = Math.max(pk, Math.abs(x)); for (let i = n - 441; i < n; i++) e += c[i] * c[i]; tail = Math.max(tail, db(Math.sqrt(e / 441) / pk)); }
  }
  t.ok(flat === 0 && dc <= -60 && tail <= -60, `the samples: no flat tops, DC ${dc.toFixed(1)} dBFS at worst, every unlooped sample ending ${(-tail).toFixed(0)} dB or more under its peak (trimmed at -70 dBFS and faded)`);
  const cache = path.join(HERE, '.out', 'kits-cache');
  if (fs.existsSync(cache)) {
    const v = spawnSync(process.execPath, [path.join(HERE, 'fetch-kits.js'), '--verify', '--only', 'upright'], { encoding: 'utf8' });
    const line = v.stdout.split('\n').filter((l) => /rebuilt|cache/.test(l)).pop() || '';
    if (/Upright[^]*isn't in the download cache/.test(v.stdout)) t.note('the download cache is incomplete: the byte-for-byte rebuild was not run');
    else t.ok(/ok rebuilt from the cache: sha256-c9b7|ok rebuilt from the cache: /.test(v.stdout.split('Upright Piano KW')[1] || ''), `the kit rebuilds byte for byte from the pinned upstream files (${line.trim()})`);
  } else t.note('no download cache: the byte-for-byte rebuild was not run');
}

console.log('Parlour Upright: the device');
const specs = def.params.map(normParam);
const pplay = (events, o = {}) => play(events, { kit: up, src: def.kernel, poly: def.poly || 32, specs, ...o });
const usong = (notes, params = {}) => ({
  ...createProject(), id: 'p_up', title: 'up', key: null, tempo: PHRASE_BPM, devices: {},
  tracks: [{ id: 't_up', name: 'Piano', kind: 'instrument', instrument: { device: 'core.upright', params }, inserts: [],
    clips: [{ id: 'c1', kind: 'notes', start: 0, length: 64, notes: notes.map((n, i) => ({ id: 'n' + i, d: 1, v: 0.8, ...n, by: 'overdub' })), by: 'overdub' }],
    gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }],
});
{
  const rep = await checkDeviceNode(def, {});
  t.ok(rep.ok && !rep.warnings.length, `checkDevice (Node) passes with no warnings${rep.ok ? '' : ': ' + rep.errors.join('; ')}${rep.warnings.length ? ' (' + rep.warnings.join('; ') + ')' : ''}`);
  t.ok(rep.deterministic === true, 'checkDevice: two renders are bit-identical');
  t.ok(rep.level.lufs >= -18.5 && rep.level.lufs <= -13.5 && rep.truePeak <= -1, `checkDevice: ${rep.level.lufs} LUFS on the test phrase, ${rep.truePeak} dBTP`);
  t.ok(rep.cpu && rep.cpu.pct < 25, `cpu ${rep.cpu && rep.cpu.pct}% of real time on the test phrase (${rep.voices && rep.voices.maxVoices} voices at most)`);
  // a held, pedalled cluster: 32 voices at once, the interpolator on every one
  {
    const ev = [{ type: 'expr', sustain: true, time: 0 }];
    for (let k = 0; k < 32; k++) ev.push(on(36 + ((k * 2) % 60), 0.7, k * 0.02));
    const t0 = performance.now(); const r = pplay(ev, { secs: 4 }); const ms = performance.now() - t0;
    t.ok(r.stats.maxVoices >= 30 && ms / 4000 < 0.5, `32 notes held under the pedal: ${(100 * ms / 4000).toFixed(1)}% of real time in Node (${r.stats.maxVoices} voices at once)`);
  }
  // create() on the audio thread: the zone maps and the sinc table, no scan of the audio
  {
    const values = paramValues({ params: specs }, {});
    for (const sr of [48000, 44100]) {
      const K = kernelCore(sr, makeDsp(sr), kernelCompiler);
      let best = Infinity, ready = 0;
      for (let i = 0; i < 5; i++) { const t0 = performance.now(); new K({ source: def.kernel, kind: 'instrument', params: specs, values, poly: 32, seed: 1, tail: def.tail, data: { kit: up } }, (m) => { if (m && m.type === 'ready') ready++; }); best = Math.min(best, performance.now() - t0); }
      t.ok(ready === 5 && best < 15, `building an instance at ${sr / 1000} kHz takes ${best.toFixed(1)} ms (best of 5)`);
    }
  }
  const ph = testPhrase();
  const a = renderSong(usong(ph), { from: 0, to: PHRASE_BEATS, tail: 2 }), b = renderSong(usong(ph), { from: 0, to: PHRASE_BEATS, tail: 2 });
  t.ok(sha256(a) === sha256(b) && !a.warnings.length, `the test phrase renders bit-exact twice (${sha256(a).slice(0, 16)}), no warnings`);
  const m = measure({ sr: a.sr, channels: a.channels });
  const a44 = renderSong(usong(ph), { from: 0, to: PHRASE_BEATS, tail: 2, sr: 44100 }), m44 = measure({ sr: 44100, channels: a44.channels });
  t.ok(Math.abs(m44.lufs - m.lufs) < 0.5 && sha256(a44) === sha256(renderSong(usong(ph), { from: 0, to: PHRASE_BEATS, tail: 2, sr: 44100 })), `at 44.1 kHz it plays the same (${m44.lufs} LUFS against ${m.lufs}), bit-exact twice`);

  // pitch, every key: the kernel moves its zone's sample by 2^((key - sample's key) / 12). Checked on the sample's
  // strongest partial (of the first four; a bass note's fundamental is too weak to read): read in the sample over a
  // stretch of it, then in the render over the same stretch of the note (output time x the ratio is sample time), the
  // render must be that partial moved by exactly the ratio
  const sampleOf = (k, v) => up.samples.find((s) => k >= s.lo && k <= s.hi && v >= s.vlo && v <= s.vhi);
  const mono = (L, R) => { const x = new Float64Array(L.length); for (let i = 0; i < L.length; i++) x[i] = (L[i] + R[i]) / 2; return x; };
  const monos = new Map();
  let worst = 0, worstKey = 21; const curve = [];
  for (let k = 21; k <= 108; k++) {
    const s = sampleOf(k, 100), ratio = Math.pow(2, (k - s.key) / 12);
    if (!monos.has(s)) monos.set(s, mono(s.ch[0], s.ch[1]));
    const src = monos.get(s), r = pplay([on(k, 100 / 127)], { secs: 0.8, params: { release: 6 } });
    const x = mono(r.channels[0], r.channels[1]);
    const a0 = 0.15, len = 0.25, fs0 = 440 * Math.pow(2, (s.key - 69) / 12), fk = 440 * Math.pow(2, (k - 69) / 12);
    const sa = s.start + Math.round(a0 * ratio * up.sr), sl = Math.round(len * ratio * up.sr);
    let n = 1, best = null;
    for (let h = 1; h <= 4; h++) { if (h * fs0 > 8000) break; const q = pitchAt(src, up.sr, sa, sl, h * fs0); if (!best || q.amp > best.amp) { best = q; n = h; } }
    const got = pitchAt(x, SR, Math.round(a0 * SR), Math.round(len * SR), n * fk);
    curve.push([k, n, got.cents]);
    const d = Math.abs(got.cents - best.cents);
    if (d > worst) { worst = d; worstKey = k; }
  }
  t.ok(worst < 1, `all 88 keys play their zone's sample moved by the right ratio (the worst, key ${worstKey}, ${worst.toFixed(2)} cents off it, on its strongest partial)`);
  const fund = curve.filter(([, n]) => n === 1);
  t.note(`against equal temperament, on the keys whose fundamental is their strongest partial (${fund.length} of 88): ${fund.filter((_, i) => i % 6 === 0).map(([k, , c]) => `${k}: ${c >= 0 ? '+' : ''}${c.toFixed(0)}`).join(', ')} cents (stretch-tuned, as recorded)`);

  // velocity: the level climbs on every octave, across the layer seam (80 / 81) too
  const steps = [];
  let down = 0, seam = 0;
  for (const k of [21, 33, 45, 57, 60, 69, 81, 93, 105, 108]) {
    let prev = null;
    for (let v = 8; v <= 127; v += 4) {
      const vv = v === 80 ? 80 : v === 84 ? 81 : v;
      const r = pplay([on(k, vv / 127)], { secs: 0.25, params: { release: 6 } });
      const lv = db(rms(r.channels[0], 0.01, 0.2));
      if (prev != null) { if (lv < prev - 0.3) down++; steps.push(lv - prev); if (vv === 81) seam = Math.max(seam, Math.abs(lv - prev)); }
      prev = lv;
    }
  }
  t.ok(down === 0 && seam < 2, `the level climbs with velocity on ten keys A0..C8 (never down by more than 0.3 dB; across the seam from 80 to 81 at most ${seam.toFixed(2)} dB)`);
}

console.log('Parlour Upright: the studio');
{
  const { page, close, errors } = await open('/app/', { query: 'new' });
  try {
    await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
    const ph = testPhrase().slice(0, 16);
    const node = renderSong(usong(ph), { from: 0, to: 8, tail: 2 });
    const reqs = [];
    page.on('request', (rq) => { if (/\.odkz?$/.test(rq.url())) reqs.push(rq.url().endsWith('z') ? 'odkz' : 'odk'); });
    const out = await page.evaluate(async ({ p }) => {
      const { renderProject } = await import('/app/src/engine/render.js');
      const { cleanProject } = await import('/app/src/core/project.js');
      const buf = await renderProject(cleanProject(p), { from: 0, to: 8, tail: 2, assets: { get: async () => null } });
      const enc = (f) => { const u = new Uint8Array(f.buffer.slice(0)); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      return { ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))], len: buf.length };
    }, { p: usong(ph) });
    const unb = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
    const ch = out.ch.map(unb);
    let worst = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(ch[c].length, node.channels[c].length); i++) worst = Math.max(worst, Math.abs(ch[c][i] - node.channels[c][i]));
    t.ok(reqs.join() === 'odkz', `the studio fetched the kit once, packed (${reqs.join(', ')})`);
    t.ok(out.len === node.length && db(worst) <= -90, `the page's render matches Node's within -90 dBFS (worst ${worst ? db(worst).toFixed(1) : '-inf'} dBFS${worst ? '' : ': bit-identical'})`);
    // an agent finds it: list_devices names it among the keys, get_device gives its params and presets
    const ag = await page.evaluate(async () => {
      const l = await window.overdub.tools.run('list_devices', { kind: 'instrument', cat: 'keys' }, { by: 'claude' });
      const g = await window.overdub.tools.run('get_device', { id: 'core.upright' }, { by: 'claude' });
      return { list: JSON.stringify(l), get: JSON.stringify(g) };
    });
    t.ok(/core\.upright/.test(ag.list) && /Parlour Upright/.test(ag.list) && /dynamics/.test(ag.get) && /Felt/.test(ag.get), 'an agent finds it: list_devices names Parlour Upright among the keys, get_device gives its params and presets');
    t.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }
}


// ------------------------------------------------------------------------------------------------ the other sampled instruments
// Each held to the same bar as Parlour Upright, from one table: the kit file and its budget, the keys and layers it
// covers, the rebuild from the cache, checkDevice, renders bit-exact twice, every key's pitch, the level climbing
// with velocity, a held note holding (a looped kit), and in the studio: fetched packed, the page's render against
// Node's, and an agent finding it.
const MORE = [
  { id: 'core.grand', hash: GRAND_HASH, recipe: GRAND_RECIPE, only: 'salamander', mb: 15, keys: [21, 108], layers: [[1, 58], [59, 100], [101, 127]], preset: 'Half stick' },
  // (a bowed note swells for its first seconds: its velocity is read once it has settled; the solo bass's two layers
  // are partly alike, so its equal-power crossfade can sit 1 dB over the loud layer alone)
  { id: 'core.ensemble', hash: ENSEMBLE_HASH, recipe: ENSEMBLE_RECIPE, only: 'vsco', mb: 8, keys: [24, 96], layers: [[0, 72], [73, 127]], preset: 'Soft bows', velWin: [2.9, 3.4], velTol: 1 },
  { id: 'core.vibes', hash: VIBES_HASH, recipe: VIBES_RECIPE, only: 'vibraphone', mb: 8, keys: [53, 89], layers: [[0, 31], [32, 63], [64, 95], [96, 127]], preset: 'Soft mallets' },
  { id: 'core.ebass', hash: EBASS_HASH, recipe: EBASS_RECIPE, only: 'dark black', mb: 8, keys: [23, 64], layers: [[0, 31], [32, 63], [64, 95], [96, 127]], preset: 'Thumb' },
];
const fetched = MORE.filter((x) => fs.existsSync(dataPath(x.hash)));
for (const x of MORE) if (!fetched.includes(x)) t.note(`${x.id}: its kit isn't fetched (node tools/fetch-kits.js), skipped`);
for (const x of fetched) {
  const d = getDevice(x.id);
  console.log(`${d.name} (${x.id}): the kit file`);
  const kb = fs.readFileSync(dataPath(x.hash));
  const kit = decodeOdk(new Uint8Array(kb.buffer, kb.byteOffset, kb.length));
  t.ok('sha256-' + crypto.createHash('sha256').update(kb).digest('hex') === x.hash, `${d.name}: the file is the pinned kit (${x.hash.slice(0, 19)}...)`);
  const zf = dataPath(x.hash) + 'z', zb = fs.existsSync(zf) ? fs.readFileSync(zf) : null;
  t.ok(zb && 'sha256-' + crypto.createHash('sha256').update(unpackOdk(zb)).digest('hex') === x.hash, `${d.name}: its .odkz unpacks to it, byte for byte`);
  if (zb) { const g = zlib.gzipSync(zb, { level: 9 }).length; t.ok(g <= x.mb * 1e6, `${d.name}: ${(g / 1e6).toFixed(2)} MB on the wire, packed and gzipped (its budget is ${x.mb} MB)`); }
  t.ok(kit.sr === x.recipe.sr && kit.bits === 16 && kit.channels === (x.recipe.channels || 2) && kit.samples.length === x.recipe.regions.length, `${d.name}: ${kit.samples.length} samples, ${kit.sr / 1000} kHz, 16-bit, ${kit.channels === 1 ? 'mono' : 'stereo'}`);
  t.ok(kit.meta.commit === x.recipe.commit && kit.meta.source === x.recipe.source && kit.meta.credit === x.recipe.credit && kit.meta.kind === 'melodic', `${d.name}: it carries its source, licence and credit (${kit.meta.repo}@${String(kit.meta.commit).slice(0, 12)})`);
  const att = kit.samples.filter((sm) => sm.trig !== 'release');
  const gaps = [];
  for (let k = x.keys[0]; k <= x.keys[1]; k++) for (const [lo, hi] of x.layers) { const n = new Set(att.filter((sm) => k >= sm.lo && k <= sm.hi && sm.vlo === lo && sm.vhi === hi).map((sm) => sm.rr | 0)).size, m = att.filter((sm) => k >= sm.lo && k <= sm.hi && sm.vlo === lo && sm.vhi === hi).length; if (!n || n !== m) gaps.push(`${k}@${lo}:${m}`); }
  t.ok(!gaps.length, `${d.name}: every key ${x.keys[0]}..${x.keys[1]} has one zone in each of its ${x.layers.length} layers${gaps.length ? ' (not: ' + gaps.slice(0, 8).join(', ') + ')' : ''}`);
  let flat = 0, dc = -200;
  for (const sm of kit.samples) for (const c of sm.ch) { let s0 = 0, run = 0; for (let i = 0; i < c.length; i++) { s0 += c[i]; if (Math.abs(c[i]) >= 32400 && i && c[i] === c[i - 1]) { if (++run === 2) flat++; } else run = 0; } dc = Math.max(dc, db(Math.abs(s0 / c.length) / 32768)); }
  t.ok(flat === 0 && dc <= -60, `${d.name}: no flat tops, DC ${dc.toFixed(1)} dBFS at worst`);
  if (fs.existsSync(path.join(HERE, '.out', 'kits-cache'))) {
    const v = spawnSync(process.execPath, [path.join(HERE, 'fetch-kits.js'), '--verify', '--only', x.only], { encoding: 'utf8' });
    if (/isn't in the download cache/.test(v.stdout)) t.note(`${d.name}: the download cache is incomplete, the byte-for-byte rebuild was not run`);
    else t.ok(v.status === 0 && /ok rebuilt from the cache/.test(v.stdout), `${d.name}: the kit rebuilds byte for byte from the pinned upstream files`);
  }

  console.log(`${d.name} (${x.id}): the device`);
  const specs2 = d.params.map(normParam);
  const dplay = (events, o = {}) => play(events, { kit, src: d.kernel, poly: d.poly || 32, specs: specs2, ...o });
  const dsong = (notes, params = {}) => ({ ...usong(notes, params), tracks: usong(notes, params).tracks.map((tr) => ({ ...tr, instrument: { device: x.id, params } })) });
  const rep = await checkDeviceNode(d, {});
  t.ok(rep.ok && !rep.warnings.length && rep.deterministic === true, `${d.name}: checkDevice (Node) passes, no warnings, bit-identical twice${rep.ok ? '' : ': ' + rep.errors.join('; ')}${rep.warnings.length ? ' (' + rep.warnings.join('; ') + ')' : ''}`);
  t.ok(rep.level.lufs >= -18.5 && rep.level.lufs <= -13.5 && rep.truePeak <= -1 && rep.cpu.pct < 25, `${d.name}: ${rep.level.lufs} LUFS on the test phrase, ${rep.truePeak} dBTP, ${rep.cpu.pct}% cpu`);
  const ph = testPhrase();
  const a = renderSong(dsong(ph), { from: 0, to: PHRASE_BEATS, tail: 2 }), b = renderSong(dsong(ph), { from: 0, to: PHRASE_BEATS, tail: 2 });
  t.ok(sha256(a) === sha256(b) && !a.warnings.length, `${d.name}: the test phrase renders bit-exact twice (${sha256(a).slice(0, 16)})`);
  const pre = renderSong(dsong(ph, d.presets.find((q) => q.name === x.preset).params), { from: 0, to: PHRASE_BEATS, tail: 2 });
  t.ok(sha256(pre) !== sha256(a), `${d.name}: the ${x.preset} preset changes the sound`);
  // pitch: every key plays its zone's sample moved by the right ratio (its strongest partial of the first four)
  const mono = (L, R) => { const y = new Float64Array(L.length); for (let i = 0; i < L.length; i++) y[i] = (L[i] + R[i]) / 2; return y; };
  // (the middle of the top layer: near its edge the layer below crossfades in, another recording of the note)
  const vTop = Math.round((x.layers[x.layers.length - 1][0] + x.layers[x.layers.length - 1][1]) / 2);
  let worst = 0, wk = x.keys[0];
  const monos = new Map(), unread = [];
  for (let k = x.keys[0]; k <= x.keys[1]; k++) {
    const sm = att.find((q) => k >= q.lo && k <= q.hi && vTop >= q.vlo && vTop <= q.vhi && !(q.rr | 0)), ratio = Math.pow(2, (k - sm.key + (sm.tune || 0) / 100) / 12);
    if (!monos.has(sm)) monos.set(sm, mono(sm.ch[0], sm.ch[1] || sm.ch[0]));
    const src = monos.get(sm), r = dplay([on(k, vTop / 127)], { secs: 0.8, params: { release: 6 } }), y = mono(r.channels[0], r.channels[1]);
    const a0 = 0.15, len = Math.min(0.25, (sm.frames - sm.start) / kit.sr / ratio - a0 - 0.02), fs0 = 440 * Math.pow(2, (sm.key - 69) / 12);
    const sa = sm.start + Math.round(a0 * ratio * kit.sr), sl = Math.round(len * ratio * kit.sr);
    let n = 1, best = null;
    for (let h = 1; h <= 4; h++) { if (h * fs0 * Math.max(1, ratio) > 9000) break; const q = pitchAt(src, kit.sr, sa, sl, h * fs0); if (!best || q.amp > best.amp) { best = q; n = h; } }
    const got = pitchAt(y, SR, Math.round(a0 * SR), Math.round(len * SR), n * fs0 * ratio);
    // (a sample whose strongest partial sits 100 cents or more from its note can't be read this way: counted, skipped)
    if (best.edge || got.edge) { unread.push(k); continue; }
    const dd = Math.abs(got.cents - best.cents);
    if (dd > worst) { worst = dd; wk = k; }
  }
  t.ok(worst < 1 && unread.length <= 4, `${d.name}: every key ${x.keys[0]}..${x.keys[1]} plays its zone's sample moved by the right ratio, tune included (the worst, key ${wk}, ${worst.toFixed(2)} cents off${unread.length ? '; unreadable: ' + unread.join(', ') : ''})`);
  // velocity: the level climbs, across every layer seam too
  let down = 0, seam = 0;
  const seams = new Set(x.layers.slice(1).map(([lo]) => lo));
  const kk = []; for (let k = x.keys[0]; k <= x.keys[1]; k += Math.max(1, Math.floor((x.keys[1] - x.keys[0]) / 7))) kk.push(k);
  for (const k of kk) {
    let prev = null;
    for (let v = 4; v <= 127; v += 3) {
      const [w0, w1] = x.velWin || [0.01, 0.2];
      const r = dplay([on(k, v / 127)], { secs: w1 + 0.05, params: { release: 6 } });
      const lv = db(rms(r.channels[0], w0, w1) + rms(r.channels[1], w0, w1));
      if (prev != null) { if (lv < prev - (x.velTol || 0.5)) down++; if ([...seams].some((sv) => v - 3 < sv && v >= sv)) seam = Math.max(seam, Math.abs(lv - prev)); }
      prev = lv;
    }
  }
  t.ok(down === 0 && seam < 3, `${d.name}: the level climbs with velocity on ${kk.length} keys (never down by more than ${x.velTol || 0.5} dB; at most ${seam.toFixed(2)} dB in a step across a layer seam)`);
  // a looped kit: a note held for 8 s keeps sounding at a steady level, and stops when let go
  if (att.some((sm) => sm.loop)) {
    let worstHold = 0;
    for (const k of kk) {
      const r = dplay([on(k, 0.8), off(k, 8)], { secs: 9.5 });
      const l1 = db(rms(r.channels[0], 2, 3)), l2 = db(rms(r.channels[0], 6.5, 7.5)), gone = db(rms(r.channels[0], 9.2, 9.5));
      worstHold = Math.max(worstHold, Math.abs(l2 - l1), gone > -60 ? 99 : 0);
    }
    t.ok(worstHold < 3, `${d.name}: a note held 8 s holds its level (within ${worstHold.toFixed(1)} dB from 2 s to 7.5 s) and dies once let go`);
  }
}

if (fetched.length) {
  console.log('the other sampled instruments: the studio');
  const { page, close, errors } = await open('/app/', { query: 'new' });
  try {
    await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
    for (const x of fetched) {
      const d = getDevice(x.id);
      const ph = testPhrase().slice(0, 16);
      const sng = { ...usong(ph), tracks: usong(ph).tracks.map((tr) => ({ ...tr, instrument: { device: x.id, params: {} } })) };
      const node = renderSong(sng, { from: 0, to: 8, tail: 2 });
      const reqs = [];
      const onReq = (rq) => { if (/\.odkz?$/.test(rq.url())) reqs.push(rq.url().endsWith('z') ? 'odkz' : 'odk'); };
      page.on('request', onReq);
      const out = await page.evaluate(async ({ p }) => {
        const { renderProject } = await import('/app/src/engine/render.js');
        const { cleanProject } = await import('/app/src/core/project.js');
        const buf = await renderProject(cleanProject(p), { from: 0, to: 8, tail: 2, assets: { get: async () => null } });
        const enc = (f) => { const u = new Uint8Array(f.buffer.slice(0)); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
        return { ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))], len: buf.length };
      }, { p: sng });
      page.off('request', onReq);
      const unb = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
      const ch = out.ch.map(unb);
      let worst = 0;
      for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(ch[c].length, node.channels[c].length); i++) worst = Math.max(worst, Math.abs(ch[c][i] - node.channels[c][i]));
      t.ok(reqs.join() === 'odkz', `${d.name}: the studio fetched the kit once, packed (${reqs.join(', ')})`);
      t.ok(out.len === node.length && db(worst) <= -90, `${d.name}: the page's render matches Node's within -90 dBFS (worst ${worst ? db(worst).toFixed(1) : '-inf'} dBFS${worst ? '' : ': bit-identical'})`);
      const ag = await page.evaluate(async ({ id, cat }) => {
        const l = await window.overdub.tools.run('list_devices', { kind: 'instrument', cat }, { by: 'claude' });
        const g = await window.overdub.tools.run('get_device', { id }, { by: 'claude' });
        return { list: JSON.stringify(l), get: JSON.stringify(g) };
      }, { id: x.id, cat: d.cat });
      t.ok(ag.list.includes(x.id) && ag.list.includes(d.name) && /dynamics/.test(ag.get) && ag.get.includes(x.preset), `${d.name}: an agent finds it (list_devices names it among the ${d.cat}, get_device gives its params and presets)`);
    }
    t.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }
}
t.done();
