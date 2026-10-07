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
function play(events, { secs = 2, sr = SR, params = {}, seed = 1, kit = KIT, src = SRC, poly = 8 } = {}) {
  const Core = kernelCore(sr, makeDsp(sr), kernelCompiler);
  const out = [];
  const c = new Core({ source: src, kind: 'instrument', params: PARAMS, values: paramValues({ params: PARAMS }, params), poly, seed, tail: 4, data: { kit } }, (m) => out.push(m));
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

t.done();
