// Gaffer Tape (core.multiband), the three-band upward and downward compressor: the kernel
// (app/src/devices/builtin/multiband.js), its detectors, curves and shelves (multiband-curve.js, shared with the
// window), the window (app/src/ui/editors/multiband.js) and what agents' adjust does with it (app/src/agent/lexicon.js).
//
// In Node, through the KernelCore the AudioWorklet runs (the canonical path), on the house's test signals and on three
// drum parts the canonical renderer plays (Studio A and Gobo Kit on the drum phrase; Studio A on the Pop grooves with
// the mics a producer set): the def (keys, roles, descs, presets, the nod) and the kernel carrying the shared functions
// as source; at its defaults it sits near bypass; at depth 0 the output is the input, sample for sample, and the band
// gains go on through shelves whose response is the shared function's; downward compression lowers a loud band and
// upward compression raises a quiet one, as the shared curve says; TIME scales the envelope's speed; a fast attack
// catches a hit's front; nothing it outputs goes over -1 dBTP at any setting; the presets make drums denser and the
// loud ones louder; renders repeat bit for bit; nothing clicks; the cost; the lexicon's plan.
// In Chromium: the device check at the defaults and on every preset; the window (it opens from the rack, a threshold
// drag is one undo step signed you, the splits move their frequencies, the loudness out against in and the In and Out
// meters while the song plays, each band's held or lifted readout, an agent's change flashes, the keys, the screen
// reader's words, the phone sheet); adjust on it; no page errors.
//   node tools/multiband-test.js        screenshots: tools/.out/multiband-*.png
import { open, tally } from './pw.js';
import { kernelCore, kernelCompiler } from '../app/src/kernel/worklet.js';
import { kernelSpecs } from '../app/src/kernel/host.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { getDevice, paramValues, presetParams } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import * as C from '../app/src/devices/builtin/multiband-curve.js';
import { describe as describeMb } from '../app/src/devices/builtin/multiband.js';
import { eqSections } from '../app/src/devices/builtin/eq8-curve.js';
import { lufs, truePeak } from '../app/src/audio/measure.js';
import * as TS from '../app/src/audio/testsignals.js';
import { planMoves, isMultiband } from '../app/src/agent/lexicon.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';
import * as GR from '../app/src/core/grooves.js';

const T = tally('multiband');
const ok = T.ok;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SR = 48000;
const def = getDevice('core.multiband');
const K = kernelCore(SR, makeDsp(SR), kernelCompiler);
const db = (x) => 20 * Math.log10(Math.max(Math.abs(x), 1e-12));
const D = 328;   // the look-ahead (5 ms) and the safety ceiling's (88 samples) at 48 kHz: what the kernel declares
const LAT = Math.round(def.latency * SR);   // (what this tree declares: renders are lined up by it)
const BANDS = ['low', 'mid', 'high'];
const sg = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
// one section of checks: a throw is a failed check, so a tree without something says so instead of stopping there
function block(title, fn) { console.log(title); try { fn(); } catch (e) { ok(false, `${title.trim()}: threw ${e && e.message}`); } }

/* ======================================================================== the device, in Node */
console.log('the device');
ok(def && def.kind === 'effect' && def.cat === 'dynamics' && def.name === 'Gaffer Tape' && def.editor === 'multiband' && def.source === 'builtin', `core.multiband is a built-in dynamics effect, Gaffer Tape, naming its editor (${def?.name}, ${def?.editor})`);
{
  const keys = def.params.map((p) => p.key);
  const want = [];
  for (const b of BANDS) want.push(`${b}_down_thresh`, `${b}_down_ratio`, `${b}_up_thresh`, `${b}_up_ratio`, `${b}_attack`, `${b}_release`, `${b}_gain`);
  want.push('xover_lo', 'xover_hi', 'depth', 'in_gain', 'out_gain', 'time');
  ok(JSON.stringify(keys) === JSON.stringify(want), `its params are a band at a time (thresholds and ratios down and up, attack, release, gain), then the splits, depth, input, output and time: ${keys.length}`);
  ok(def.params.every((p) => typeof p.desc === 'string' && p.desc.length >= 40 && p.role), 'every param has a role and a desc an agent can act on');
  ok(/punch/.test(def.params.find((p) => p.key === 'low_attack').desc) && /main control/.test(def.params.find((p) => p.key === 'depth').desc), 'the descs say what makes it punchier (a slower attack) and that DEPTH is the main control');
  ok(def.params.filter((p) => /^(low|mid|high|xover)_/.test(p.key)).every((p) => p.face === false) && ['depth', 'in_gain', 'out_gain', 'time'].every((k) => def.params.find((p) => p.key === k).face !== false) && typeof def.screen === 'function', 'the face shows its curves (screen) and depth, input, output and time; the bands live in the window');
  ok(def.nod && !/ott|xfer|ableton|serum|fabfilter|waves|izotope|steve duda|over the top/i.test(def.nod + ' ' + def.blurb + ' ' + def.presets.map((p) => p.name + ' ' + p.blurb).join(' ')), `the nod, the blurb and the presets name no trademark ("${def.nod}")`);
  const WANT = ['Full depth', 'Glue (bus)', 'Drum smash', 'Vocal presence', 'Bass tighten', 'Subtle 30%'];
  ok(JSON.stringify(def.presets.map((p) => p.name)) === JSON.stringify(WANT) && def.presets.every((p) => p.blurb && p.blurb.length > 20), `its presets: ${def.presets.map((p) => p.name).join(', ')}`);
  const shared = [C.mbSplit, C.mbCurve, C.mbWeights, C.mbFreqs, C.mbG, C.mbMix, C.mbCoef, C.mbStep, C.mbShelfCoefs, C.mbShelve, C.mbResponse];
  ok(shared.every((fn) => typeof fn === 'function' && def.kernel.includes(fn.toString())), 'the kernel runs the shared functions themselves (their source is in it): the detectors, the curve, the dynamics and the shelves, one source of truth for the sound, the curves and the window\'s readouts');
  ok(def.latency * SR === D, `it declares its latency: ${def.latency * SR} samples (the 5 ms look-ahead and the safety ceiling's)`);
  const line = describeMb(paramValues(def, {}));
  ok(/^depth 40%, splits at 120 Hz and 2\.5 kHz; low: down above -\d+(\.\d)? dB at \d+(\.\d)?:1, up below -\d+(\.\d)? dB at \d\.\d:1/.test(line), `get_project reads it in words: "${line.slice(0, 110)}…"`);
}

// a KernelCore with these params (jumped there, as an instance starts), and a render through it in 128-frame blocks;
// sched(t) may return new params at a block (posted as the host posts them: glided, switches snapping)
function core(params) {
  const values = paramValues(def, params), errs = [];
  const c = new K({ source: def.kernel, kind: 'effect', params: kernelSpecs(def), values, seed: 1, transport: { bpm: 120, playing: true, beat: 0, time: 0 } }, (m) => { if (m.type === 'error') errs.push(m.message); });
  c.msg({ type: 'params', values, jump: true });
  if (errs.length || !c.cur) throw new Error('core.multiband did not compile: ' + errs.join('; '));
  return c;
}
function render(params, inL, inR = inL, sched = null) {
  const c = core(params), n = inL.length, oL = new Float32Array(n), oR = new Float32Array(n);
  const iL = new Float32Array(128), iR = new Float32Array(128), bL = new Float32Array(128), bR = new Float32Array(128);
  for (let f = 0; f < n; f += 128) {
    const m = Math.min(128, n - f);
    iL.fill(0); iR.fill(0); iL.set(inL.subarray(f, f + m)); iR.set(inR.subarray(f, f + m));
    const p = sched && sched(f / SR);
    if (p) c.msg({ type: 'params', values: paramValues(def, p) });
    c.block(iL, iR, bL, bR, f);
    oL.set(bL.subarray(0, m), f); oR.set(bR.subarray(0, m), f);
  }
  return [oL, oR];
}
const stereo = (s) => ({ sr: SR, channels: s.channels ? [s.channels[0], s.channels[1] || s.channels[0]] : [s, s] });
const through = (params, s) => { const [L, R] = render(params, s.channels[0], s.channels[1]); return { sr: SR, channels: [L, R] }; };
const noise = (secs, seed = 7, amp = 0.5) => { const x = new Float32Array(Math.round(secs * SR)); let s = seed; for (let i = 0; i < x.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; x[i] = (s / 4294967296 - 0.5) * amp; } return x; };
const sine = (f, secs, dbfs) => { const a = Math.pow(10, dbfs / 20), x = new Float32Array(Math.round(secs * SR)); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / SR); return x; };
// a steady tone's level (dB, as its peak) over [a, b) seconds
const toneLevel = (x, a, b) => { let s = 0; const i0 = Math.round(a * SR), i1 = Math.round(b * SR); for (let i = i0; i < i1; i++) s += x[i] * x[i]; return 10 * Math.log10(2 * s / (i1 - i0)); };
// the response of an impulse at f, in dB (a DFT bin at exactly f)
const dft = (h, f) => { let re = 0, im = 0; const w = 2 * Math.PI * f / SR; for (let i = 0; i < h.length; i++) { re += h[i] * Math.cos(w * i); im -= h[i] * Math.sin(w * i); } return 10 * Math.log10(re * re + im * im + 1e-30); };
const TF = [20, 31.5, 50, 80, 100, 125, 160, 200, 315, 500, 800, 1250, 2000, 2500, 3150, 5000, 8000, 12500, 16000, 19000];
const impulse = (secs = 1, amp = 1) => { const x = new Float32Array(Math.round(secs * SR)); x[0] = amp; return x; };
// crest factor as audio/measure.js reads it: the sample peak over the RMS, dB
const crest = (s) => { let pk = 0, sq = 0, n = s.channels[0].length; for (const x of s.channels) for (let i = 0; i < n; i++) { const v = x[i], a = v < 0 ? -v : v; if (a > pk) pk = a; sq += v * v; } return db(pk) - 10 * Math.log10(sq / (n * s.channels.length)); };
const SIG = { strum: stereo(TS.diStrum(8, SR)), drums: TS.drumLoop(8, SR, 120), program: TS.program(8, SR), bass: stereo(TS.bassDI(8, SR)) };
// the drum parts: a house kit on the drum phrase, and Studio A on the Pop verse then chorus at 124 bpm with the mics a
// producer set (overheads -6.4, room -8.1, crush -23), each rendered by the canonical renderer
function part(device, params, notes, beats, tempo) {
  const song = { ...createProject(), id: 'p_mb', title: 'mb', tempo, key: null,
    tracks: [{ id: 't1', name: 'Drums', kind: 'instrument', instrument: { device, params }, inserts: [], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub',
      clips: [{ id: 'c1', kind: 'notes', start: 0, length: beats, notes: notes.map((n, i) => ({ id: 'n' + i, ...n, by: 'overdub' })), by: 'overdub' }] }] };
  const r = renderSong(song, { from: 0, to: beats, tail: 1 });
  return { sr: r.sr, channels: r.channels };
}
const pop = () => { const v = GR.groovesFor('pop', 'verse')[0], c = GR.groovesFor('pop', 'chorus')[0]; return [...GR.realize(v.id, { tempo: 124, seed: 1, length: 16, articulations: true }), ...GR.realize(c.id, { tempo: 124, seed: 2, length: 16, articulations: true }).map((n) => ({ ...n, t: n.t + 16 }))]; };
const KITS = {
  'Studio A': part('core.drumroom', {}, TS.drumPhrase(), TS.DRUM_PHRASE_BEATS, 120),
  'Gobo Kit': part('core.drums', {}, TS.drumPhrase(), TS.DRUM_PHRASE_BEATS, 120),
  'Studio A, Pop': part('core.drumroom', { mix_oh: -6.4, mix_room: -8.1, mix_crush: -23 }, pop(), 32, 124),
};
const DRUMS = { drums: SIG.drums, ...KITS };   // (the drum loop, then the kits)
const ALL = { ...SIG, ...KITS };
const IN = new Map(Object.entries(ALL).map(([k, s]) => [k, { lu: lufs(s), crest: crest(s), tp: truePeak(s) }]));
// one setting on one signal: its LU against the input, its crest's change, its true peak
const versus = (params, k) => { const o = through(params, ALL[k]), i = IN.get(k); return { lu: lufs(o) - i.lu, crest: crest(o) - i.crest, tp: truePeak(o) }; };

block('\nat its defaults', () => {
  const rows = Object.keys(ALL).map((k) => [k, versus({}, k)]);
  ok(rows.every(([, v]) => Math.abs(v.lu) <= 1), `the classic at 40% depth sits within a decibel of bypass on the house's signals and the drum parts (${rows.map(([k, v]) => `${k} ${sg(v.lu, 2)} LU`).join(', ')})`);
  ok(rows.every(([, v]) => v.tp <= -1), `…with every true peak at or under -1 dBTP (${rows.map(([k, v]) => `${k} ${v.tp.toFixed(1)}`).join(', ')} dBTP)`);
});

block('\nat depth 0 it is the input', () => {
  // depth 0: the output is the input, sample for sample, D samples on (nothing is split, and the shelves are flat)
  const x = noise(2, 11, 0.4), y = noise(2, 23, 0.4), [L, R] = render({ depth: 0 }, x, y);
  let worst = 0; for (let i = LAT; i < x.length; i++) worst = Math.max(worst, Math.abs(L[i] - x[i - LAT]), Math.abs(R[i] - y[i - LAT]));
  ok(worst === 0, `at depth 0 the output is the input, ${LAT} samples on, bit for bit: the largest difference is ${worst}`);
  // every band neutral at full depth: the same, bit for bit
  const neutral = { depth: 100 };
  for (const b of BANDS) Object.assign(neutral, { [`${b}_down_ratio`]: 1, [`${b}_up_ratio`]: 1, [`${b}_gain`]: 0 });
  const [L1, R1] = render(neutral, x, y);
  ok(L1.every((v, i) => v === L[i]) && R1.every((v, i) => v === R[i]), 'with every band neutral (ratios 1:1, gains 0 dB) at full depth the output is the same, bit for bit');
  // the house kits keep their peaks at depth 0 (a crossover's phase turn rebuilt them: +4.5 dB on Studio A before)
  const kp = ['Studio A', 'Gobo Kit'].map((k) => [k, IN.get(k).tp, truePeak(through({ depth: 0 }, KITS[k]))]);
  ok(kp.every(([, a, b]) => Math.abs(a - b) < 0.01), `…so the house kits keep their true peaks at depth 0 (${kp.map(([k, a, b]) => `${k} ${a.toFixed(2)} -> ${b.toFixed(2)} dBTP`).join(', ')})`);
  // the bands' gains go on through the shelves: +12, 0 and -12 dB on low, mid and high, against the shared response
  const [f1, f2] = C.freqsOf(paramValues(def, {}), SR);
  const tilt = { ...neutral, low_gain: 12, mid_gain: 0, high_gain: -12 };
  const [ht] = render(tilt, impulse(1, 0.25));
  const gl = Math.pow(10, 12 / 20), gh = Math.pow(10, -12 / 20);
  const errs = TF.map((f) => [f, Math.abs(dft(ht, f) - db(0.25) - db(C.mbResponse(f, f1, f2, gl, 1, gh, SR)))]);
  const we = errs.reduce((a, b) => (b[1] > a[1] ? b : a));
  ok(we[1] < 0.01, `the bands' gains go on through the shelves: +12 / 0 / -12 dB on low, mid and high measure within ${we[1].toFixed(4)} dB of the shared response (mbResponse, the window's) at ${TF.length} frequencies (worst at ${we[0]} Hz)`);
  const ends = [C.mbResponse(20, f1, f2, gl, 1, gh, SR), C.mbResponse(f1, f1, f2, gl, 1, gh, SR), C.mbResponse(f2, f1, f2, gl, 1, gh, SR), C.mbResponse(20000, f1, f2, gl, 1, gh, SR)].map(db);
  ok(Math.abs(ends[0] - 12) < 0.3 && Math.abs(ends[1] - 6) < 0.5 && Math.abs(ends[2] + 6) < 0.5 && Math.abs(ends[3] + 12) < 0.3, `…a band's gain at its far end and half of it in dB at its split (${ends.map((v) => sg(v)).join(', ')} dB at 20 Hz, ${f1} Hz, ${f2} Hz and 20 kHz)`);
  // the detectors' bands: the shares of a tone add to 1, and the low band carries half of one at the low-mid split
  const w = [0, 0, 0];
  C.mbWeights(f1, f1, f2, SR, w);
  ok(Math.abs(w[0] - 0.5) < 0.01 && Math.abs(w[0] + w[1] + w[2] - 1) < 1e-12, `the detectors hear the bands through the shared crossover: at the low-mid split (${f1} Hz) the low band carries half of a tone (${w[0].toFixed(3)}), and the three shares add to 1`);
});

block('\ndownward and upward, against the shared curve', () => {
  // a loud tone in the mid band, only the downward side working, gains 0: the steady level is the curve's
  const pDown = { depth: 100, mid_down_thresh: -30, mid_down_ratio: 30 };
  for (const b of BANDS) Object.assign(pDown, { [`${b}_up_ratio`]: 1, [`${b}_gain`]: 0 });
  const loud = sine(1000, 2, -6), [Ld] = render(pDown, loud);
  const got = toneLevel(Ld, 1.2, 1.9), want = -6 + C.toneGain(paramValues(def, pDown), 1000, -6, SR);
  ok(got < -6 - 3 && Math.abs(got - want) < 0.3, `downward compression lowers a loud band: a 1 kHz tone at -6 dBFS comes out at ${got.toFixed(2)} dB (the curve says ${want.toFixed(2)})`);
  // a quiet tone: lifted, at the defaults (40%) and at full depth, as the curve and the mix law say
  for (const depth of [40, 100]) {
    const p = { depth }, q = sine(1000, 2, -50), [Lq] = render(p, q);
    const g = toneLevel(Lq, 1.2, 1.9) + 50, w2 = C.toneGain(paramValues(def, p), 1000, -50, SR);
    ok(g > 4 && Math.abs(g - w2) < 0.3, `upward compression raises a quiet band: a 1 kHz tone at -50 dBFS comes up ${g.toFixed(2)} dB at ${depth}% depth (the shared curve: ${w2.toFixed(2)} dB)`);
  }
  // and in the low band, a bass note's level
  // (a bass note ripples the low band's detector a little at twice its pitch, and the lift lets go faster than it
  // comes back, so it settles a fraction of a dB under the curve)
  const pl = { depth: 100 }, ql = sine(60, 3, -50), [Ll] = render(pl, ql);
  const gl = toneLevel(Ll, 2, 2.9) + 50, wl = C.toneGain(paramValues(def, pl), 60, -50, SR);
  ok(Math.abs(gl - wl) < 0.4, `…and the low band: a 60 Hz tone at -50 dBFS comes up ${gl.toFixed(2)} dB (the curve: ${wl.toFixed(2)})`);
  // silence and hiss far down are left alone: under the floor nothing is lifted
  const deep = sine(1000, 2, -96), [Lz] = render({ depth: 100 }, deep);
  const gz = toneLevel(Lz, 1.2, 1.9) + 96, mg = paramValues(def, {}).mid_gain;
  ok(Math.abs(gz - mg) < 0.5, `a tone at -96 dBFS isn't lifted (only the band's gain: ${gz.toFixed(2)} dB, its gain ${mg} dB): silence stays silent`);
});

block('\nTIME scales the envelope', () => {
  // a 500 Hz tone (in the middle of the mid band, held above -28 dB at 30:1 and lifted below -38 at 4:1; the other bands
  // neutral) at -50 dBFS, then -10 dBFS (1.5 s), then -50 again (3 s). The gain is smoothed in dB, so once the detector
  // has the new level, the gain's distance from where it is going shrinks exponentially at the band's attack (or
  // release) times TIME: from 6 dB away to 2 dB away takes that time constant times ln 3. (The first 20 ms after a step
  // are skipped.)
  const n = 8 * SR, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR, a = t >= 1.5 && t < 3 ? Math.pow(10, -10 / 20) : Math.pow(10, -50 / 20); x[i] = a * Math.sin(2 * Math.PI * 500 * i / SR); }
  const mid = paramValues(def, { mid_attack: 22, mid_release: 260 }), outer = { low_down_ratio: 1, low_up_ratio: 1, low_gain: 0, high_down_ratio: 1, high_up_ratio: 1, high_gain: 0, mid_attack: 22, mid_release: 260, mid_down_thresh: -28, mid_down_ratio: 30, mid_up_thresh: -38, mid_up_ratio: 4, mid_gain: 5 };
  const span = (time) => {
    const [L] = render({ depth: 100, time, ...outer }, x);
    const g = (t) => toneLevel(L, t, t + 0.002) - toneLevel(x, t - LAT / SR, t - LAT / SR + 0.002);
    const from6to2 = (t0, t1) => { const fin = g(t1 - 0.01); let a6 = null; for (let t = t0 + 0.02; t < t1; t += 0.0005) { const e = Math.abs(g(t) - fin); if (a6 == null && e <= 6) a6 = t; if (a6 != null && e <= 2) return t - a6; } return NaN; };
    return { attack: from6to2(1.5 + LAT / SR, 2.95), release: from6to2(3 + LAT / SR, 7.95) };
  };
  const a = span(100), b = span(300);
  const ra = b.attack / a.attack, rr = b.release / a.release, ln3 = Math.log(3);
  ok(Math.abs(ra - 3) < 0.3 && Math.abs(a.attack / ln3 * 1000 - mid.mid_attack) < 0.15 * mid.mid_attack, `after a step up the gain closes from 6 dB to 2 dB away in ${(a.attack * 1000).toFixed(1)} ms at TIME 100% (a 22 ms attack times ln 3 is ${(mid.mid_attack * ln3).toFixed(1)}) and ${(b.attack * 1000).toFixed(1)} ms at 300% (${ra.toFixed(2)}x)`);
  ok(Math.abs(rr - 3) < 0.25 && Math.abs(a.release / ln3 * 1000 - mid.mid_release) < 0.15 * mid.mid_release, `after a step down, in ${(a.release * 1000).toFixed(0)} ms (a 260 ms release times ln 3 is ${(mid.mid_release * ln3).toFixed(0)}) and ${(b.release * 1000).toFixed(0)} ms at 300% (${rr.toFixed(2)}x)`);
});

block('\na fast attack catches a hit\'s front', () => {
  // a 1 kHz tone in the mid band, quiet (-50 dBFS: lifted, with the band's gain on), then a hit: up to -6 dBFS in 2 ms
  // (so it stays in the mid band) and held 300 ms; the other bands neutral. With a fast attack the gain is in place
  // before the hit reaches it (the look-ahead), so the hit's first 10 ms come out no louder than the hit settles at:
  // neither the lift nor the band's gain lands on its front. A slow attack lets the front through, as it should.
  const n = 2 * SR, x = new Float32Array(n), q = Math.pow(10, -50 / 20), l = Math.pow(10, -6 / 20);
  for (let i = 0; i < n; i++) { const t = i / SR, a = t < 1 || t >= 1.3 ? q : t < 1.002 ? q + (l - q) * 0.5 * (1 - Math.cos(Math.PI * (t - 1) / 0.002)) : l; x[i] = a * Math.sin(2 * Math.PI * 1000 * i / SR); }
  const outer = { low_down_ratio: 1, low_up_ratio: 1, low_gain: 0, high_down_ratio: 1, high_up_ratio: 1, high_gain: 0 };
  const front = (attack) => {
    const [L] = render({ depth: 100, ...outer, mid_down_thresh: -30, mid_down_ratio: 30, mid_up_thresh: -40, mid_up_ratio: 4, mid_attack: attack, mid_release: 200, mid_gain: 6 }, x), at = SR + LAT;
    let pk = 0, st = 0;
    for (let i = at; i < at + Math.round(0.01 * SR); i++) pk = Math.max(pk, Math.abs(L[i]));
    for (let i = at + Math.round(0.2 * SR); i < at + Math.round(0.29 * SR); i++) st = Math.max(st, Math.abs(L[i]));
    return db(pk) - db(st);
  };
  const fast = front(1), slow = front(40);
  ok(fast <= 1.5, `with a 1 ms attack the hit's first 10 ms come out ${sg(fast)} dB against where it settles (the lift and a 6 dB band gain were on the quiet before it)`);
  ok(slow >= 6, `…and a 40 ms attack lets the front through: ${sg(slow)} dB over where it settles`);
});

block('\nnothing goes over -1 dBTP, at any setting', () => {
  // every preset, and the defaults at depth 0, 50 and 100, on the house's signals and the drum parts
  const settings = [...def.presets.map((p) => [p.name, p.params]), ['depth 0', { depth: 0 }], ['depth 50', { depth: 50 }], ['depth 100', { depth: 100 }]];
  const rows = [];
  for (const [name, p] of settings) for (const k of Object.keys(ALL)) rows.push([name, k, truePeak(through(p, ALL[k]))]);
  const worst = rows.reduce((a, b) => (b[2] > a[2] ? b : a)), over = rows.filter((r) => r[2] > -1);
  ok(worst[2] <= -1, `every preset and depth 0, 50 and 100 on the strum, the drum loop, the program, the bass, Studio A, Gobo Kit and the Pop groove (${rows.length} renders): the loudest is ${worst[2].toFixed(2)} dBTP (${worst[0]} on ${worst[1]})${over.length ? `; over: ${over.slice(0, 4).map((r) => `${r[0]} on ${r[1]} ${r[2].toFixed(2)}`).join(', ')}` : ''}`);
  // pushed: the program 12 dB hotter, through Full depth and through depth 0, with the output 12 dB up; the ceiling
  // holds both (at depth 0 too: the ceiling is on everything it puts out)
  const hot = { sr: SR, channels: SIG.program.channels.map((c) => Float32Array.from(c, (v) => v * 4)) };
  const a = truePeak(through({ ...presetParams(def, 'Full depth'), out_gain: 12 }, hot)), b = truePeak(through({ depth: 0, out_gain: 12 }, hot));
  ok(a <= -1 && b <= -1, `pushed (the program +12 dB in, OUTPUT +12 dB) the safety ceiling holds it at ${a.toFixed(2)} dBTP through Full depth and ${b.toFixed(2)} dBTP at depth 0`);
});

block('\nthe presets: denser, and the loud ones louder', () => {
  // Gobo Kit is dense already (a crest factor of 11 dB on the drum phrase) and its loudest moments are ones where the
  // bands partly cancel: any change to its balance (a static 3 dB tilt of one band alone) raises its crest a little.
  // So on it the presets are held to louder and not peakier (within half a decibel); on the drum loop and Studio A,
  // to denser
  const rows = {};
  for (const pr of def.presets) rows[pr.name] = Object.fromEntries(Object.keys(ALL).map((k) => [k, versus(pr.params, k)]));
  const say = (name, keys) => keys.map((k) => `${k} ${sg(rows[name][k].lu)} LU, crest ${sg(rows[name][k].crest)}`).join('; ');
  const dk = Object.keys(DRUMS), dense = dk.filter((k) => k !== 'Gobo Kit');
  const notPeakier = (r, slack = 0) => dense.every((k) => r[k].crest <= slack) && r['Gobo Kit'].crest <= 0.5;
  for (const name of ['Full depth', 'Drum smash', 'Vocal presence']) {
    const r = rows[name];
    ok(dk.every((k) => r[k].lu >= 1 && r[k].lu <= 3), `${name} comes out 1 to 3 LU louder on drums (${say(name, dk)})`);
    ok(dense.every((k) => r[k].crest < 0) && notPeakier(r), `…and denser: the crest comes down on the drum loop and Studio A, and Gobo Kit is no peakier`);
  }
  ok(['strum', 'program', 'bass'].every((k) => ['Full depth', 'Drum smash', 'Vocal presence'].every((n) => rows[n][k].lu > 0 && rows[n][k].crest <= 0.3)), `…and louder, not peakier, on the strum, the program and the bass (Full depth: ${say('Full depth', ['strum', 'program', 'bass'])})`);
  for (const name of ['Glue (bus)', 'Subtle 30%']) {
    const r = rows[name];
    ok(Object.keys(ALL).every((k) => Math.abs(r[k].lu) <= 1) && notPeakier(r, 0.1), `${name} stays gentle: within a decibel of the input everywhere, and no peakier (${say(name, dk)})`);
  }
  const bt = rows['Bass tighten'];
  ok(bt.bass.crest <= -0.5 && bt.bass.lu >= 0 && bt.bass.lu <= 2 && dk.every((k) => Math.abs(bt[k].lu) <= 1.5) && notPeakier(bt, 0.1), `Bass tighten evens out the bass DI (${say('Bass tighten', ['bass'])}) and leaves drums about level (${say('Bass tighten', dk)})`);
});

block('\nrenders repeat', () => {
  const p = presetParams(def, 'Drum smash');
  const sched = (t) => ({ ...p, depth: 50 + 40 * Math.sin(t * 3), mid_down_thresh: -30 + 6 * Math.sin(t * 5), xover_lo: 110 * Math.pow(2, Math.sin(t * 2)) });
  const a = render(p, SIG.program.channels[0], SIG.program.channels[1], sched), b = render(p, SIG.program.channels[0], SIG.program.channels[1], sched);
  ok(a[0].every((v, i) => v === b[0][i]) && a[1].every((v, i) => v === b[1][i]), 'a preset with its depth, a threshold and a split moving renders bit for bit the same twice');
});

block('\nnothing clicks (the energy above 3 kHz of a 220 Hz sine, after the first 50 ms)', () => {
  const residual = (y) => {
    const c = new Float64Array(20), ns = eqSections(5, 3000, 0, 1, SR, c, 0), out = Float64Array.from(y);
    for (let s = 0; s < ns; s++) { const o = s * 5; let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < out.length; i++) { const v0 = out[i], v = c[o] * v0 + c[o + 1] * x1 + c[o + 2] * x2 - c[o + 3] * y1 - c[o + 4] * y2; x2 = x1; x1 = v0; y2 = y1; y1 = v; out[i] = v; } }
    let pk = 0; for (let i = Math.round(0.05 * SR); i < out.length; i++) pk = Math.max(pk, Math.abs(out[i]));
    return db(pk);
  };
  const x = sine(220, 3, -12);
  const jumps = {
    'depth jumping between 0 and 100% every 0.25 s': (t) => ({ depth: Math.floor(t / 0.25) % 2 ? 100 : 0 }),
    'the output jumping between -12 and +6 dB': (t) => ({ out_gain: Math.floor(t / 0.25) % 2 ? 6 : -12 }),
    'the low band\'s gain jumping between -12 and +12 dB': (t) => ({ depth: 100, low_gain: Math.floor(t / 0.25) % 2 ? 12 : -12 }),
    'the thresholds jumping between -50 and -10 dB': (t) => { const v = Math.floor(t / 0.25) % 2 ? -10 : -50; return { depth: 100, low_down_thresh: v, mid_down_thresh: v, low_up_thresh: v - 10, mid_up_thresh: v - 10 }; },
    'the low-mid split jumping between 60 and 400 Hz (the tone crossing it)': (t) => ({ depth: 100, xover_lo: Math.floor(t / 0.25) % 2 ? 400 : 60 }),
  };
  for (const [name, sched] of Object.entries(jumps)) { const r = residual(render(sched(0), x, x, sched)[0]); ok(r < -70, `${name}: ${r.toFixed(1)} dBFS`); }
  const step = residual(Float32Array.from(x, (v, i) => (i >= SR ? v * 0.5 : v)));
  ok(step > -65, `…and it hears a click: a plain 6 dB step on the same tone reads ${step.toFixed(1)} dBFS`);
});

block('\nthe ends of every range', () => {
  // every param at its ends, singly and all together, and the splits the wrong way round: finite, and the ceiling
  // holds every one of them, at whatever depth
  const x = noise(1, 3, 0.9);
  const lo = Object.fromEntries(def.params.map((p) => [p.key, p.min])), hi = Object.fromEntries(def.params.map((p) => [p.key, p.max]));
  const cases = [lo, hi, { ...lo, depth: 100 }, { xover_lo: 1000, xover_hi: 600, depth: 100 }];
  for (const p of def.params) cases.push({ [p.key]: p.min, depth: 100 }, { [p.key]: p.max, depth: 100 }, { [p.key]: p.min }, { [p.key]: p.max });
  let bad = 0, pk = -Infinity, n = 0;
  for (const p of cases) {
    const [L, R] = render(p, x);
    n++;
    if (!L.every(Number.isFinite) || !R.every(Number.isFinite)) { bad++; continue; }
    pk = Math.max(pk, truePeak({ sr: SR, channels: [L, R] }));
  }
  ok(!bad, `${n} settings at the ends of the ranges stay finite`);
  ok(pk <= -1, `…and the ceiling holds every one of them: the loudest is ${pk.toFixed(2)} dBTP`);
});

block('\ncost', () => {
  const x = SIG.program.channels;
  render({ depth: 100 }, x[0], x[1]);   // (warm the JIT)
  // (the process's own CPU time, the best of three, under 6% of real time: this kernel takes about 1.8 times the first
  // version's, and a busy machine runs its cores slower, so what it takes swings with whatever else is running)
  let ms = Infinity; for (let k = 0; k < 3; k++) { const c0 = process.cpuUsage(); render({ depth: 100 }, x[0], x[1]); const c = process.cpuUsage(c0); ms = Math.min(ms, (c.user + c.system) / 1000); }
  ok(ms / 8000 * 100 < 6, `8 s of the program at full depth in ${ms.toFixed(1)} ms of CPU in Node (the best of three): ${(ms / 80).toFixed(2)}% of real time (the device check warns at 25%)`);
});

block('\nagents: the plan adjust uses', () => {
  const at = (values) => [{ where: 'fx_g', def, values: paramValues(def, values) }];
  ok(isMultiband(def) && !isMultiband(getDevice('core.comp')) && !isMultiband(getDevice('core.eq8')), 'the lexicon knows a three-band compressor when it sees one (and Squeeze Box and Slide Rule aren\'t)');
  // more depth is denser (a lower crest): "punchier" turns it down, "squashed" and "glued" up
  const up = planMoves('punch', 0.66, at({}), 1), down = planMoves('punch', 0.66, at({}), -1), sq = planMoves('squash', 0.66, at({}), 1);
  ok(up.length === 1 && up[0].key === 'depth' && up[0].from === 40 && up[0].to === 23.5 && down[0].to === 56.5, `"punchier" turns its DEPTH down (${up.map((m) => `${m.from} -> ${m.to}`)}), "less punchy" up (${down.map((m) => `${m.from} -> ${m.to}`)})`);
  ok(sq.length === 1 && sq[0].key === 'depth' && sq[0].to === 56.5, `"squashed" and "glued" turn it up (${sq.map((m) => `${m.from} -> ${m.to}`)})`);
  ok(!planMoves('punch', 0.66, at({ depth: 2 }), 1).length && !planMoves('squash', 0.66, at({ depth: 2 }), -1).length, 'at a depth near 0 it plans nothing for "punchier" or "less squashed" (adjust does what it did without it)');
  ok(['brightness', 'warmth', 'length', 'body', 'grit'].every((a) => !planMoves(a, 0.66, at({}), 1).length), 'other words leave it alone (tone words go to an EQ)');
  const comp = getDevice('core.comp');
  const cm = planMoves('punch', 0.66, [{ where: 'fx_c', def: comp, values: paramValues(comp, {}) }], 1);
  ok(cm.length === 1 && cm[0].key === 'attack' && cm[0].to > cm[0].from, `on a track without it nothing changes: Squeeze Box's attack slows for punch as before (${cm[0]?.from} -> ${cm[0]?.to} ms)`);
});

/* ======================================================================== in Chromium */
const ours = (errors) => errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext|getUserMedia/.test(e));
console.log('\nthe device check (Chromium)');
{
  const s = await open('/app/');
  const { page, errors } = s;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const res = await page.evaluate(async () => {
      const { getDevice } = await import('/app/src/devices/registry.js');
      const { checkDevice } = await import('/app/src/kernel/check.js');
      const def = getDevice('core.multiband');
      const out = [{ name: 'defaults', r: await checkDevice(def) }];
      for (const pr of def.presets) out.push({ name: pr.name, r: await checkDevice({ ...def, params: def.params.map((p) => ({ ...p, def: pr.params[p.key] ?? p.def })) }, { quick: true }) });
      return out.map(({ name, r }) => ({ name, ok: r.ok, errors: r.errors, warnings: r.warnings, delta: r.level?.deltaLU, drums: r.level?.drumsDeltaLU, tp: r.truePeak, nan: r.nan, det: r.deterministic, cpu: r.cpu?.pct, worst: r.extremes?.worstPeak, lat: r.latency, cases: r.extremes?.cases }));
    });
    const d = res[0];
    ok(d.ok && !d.nan && d.det === true && !d.warnings.length, `at its defaults the check passes with no warnings: no NaN, deterministic, ${d.cases} extreme cases (${d.errors.join('; ') || 'no errors'})`);
    ok(Math.abs(d.delta) <= 1 && Math.abs(d.drums) <= 1, `at its defaults it measures ${d.delta} LU (strum) and ${d.drums} LU (drums) from bypass`);
    ok(d.tp <= -1 && d.cpu < 10 && d.worst <= 6, `true peak ${d.tp} dBTP, CPU ${d.cpu}% of real time (well inside the check's 25%); no extreme setting runs hot (over +6 dBFS: the worst peaks at ${d.worst} dBFS)`);
    ok(d.lat && d.lat.declared === D && Math.abs(d.lat.samples - D) <= 2, `an impulse comes out where it says (${d.lat?.samples} samples; declared ${d.lat?.declared})`);
    for (const p of res.slice(1)) ok(p.ok && !p.nan && p.det === true && p.cpu < 10 && p.tp <= -1, `"${p.name}": the check passes (${p.delta} LU, ${p.drums} LU on the drums, ${p.tp} dBTP, CPU ${p.cpu}%${p.warnings.length ? '; ' + p.warnings.join(' | ') : ''})`);
    ok(!ours(errors).length, `no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) { ok(false, 'the check threw: ' + (e && e.stack || e)); }
  await s.close();
}

console.log('\nthe window (Chromium, desktop)');
{
  const s = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const { page, errors, shot } = s;
  page.setDefaultTimeout(15000);
  const E = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(400);
    await E(() => document.querySelector('.ar-welcome-x')?.click());
    const setup = await E(() => {
      const a = window.overdub, t = a.store.get().tracks.find((x) => /drum/i.test(x.name)) || a.store.get().tracks.find((x) => x.kind === 'instrument');
      const r = a.store.dispatch({ type: 'insert.add', track: t.id, insert: { device: 'core.multiband' }, ref: 'g' }, { by: 'you', label: 'gaffer' });
      a.ui.select({ track: t.id, clip: null, insert: r.created.g }); a.ui.show('rack');
      return { track: t.id, fx: r.created.g };
    });
    await sleep(500);
    // it opens from the rack's Open
    await E((fx) => document.querySelector(`[data-panel="rack"] .rk-card[data-insert="${fx}"]`)?.scrollIntoView({ inline: 'center' }), setup.fx);
    await page.click(`[data-panel="rack"] .rk-card[data-insert="${setup.fx}"] .rk-open`);
    await page.waitForSelector('.pw[data-editor="multiband"] .mb-plot', { timeout: 10000 });
    await sleep(300);
    const first = await E(() => {
      const w = document.querySelector('.pw'), body = w.querySelector('.pw-body');
      const keys = new Set([...body.querySelectorAll('.pk-ctl[data-key]')].map((x) => x.dataset.key));
      const want = window.overdub.devices.getDevice('core.multiband').params.map((p) => p.key);
      const r = w.getBoundingClientRect(), depth = w.querySelector('.mb-depth .pk-dial').getBoundingClientRect(), knob = w.querySelector('.mb-ctl .pk-dial').getBoundingClientRect();
      return { editor: w.dataset.editor, bands: w.querySelectorAll('.mb-band').length, handles: w.querySelectorAll('.mb-h').length, divs: w.querySelectorAll('.mb-div').length, every: want.every((k) => keys.has(k)), missing: want.filter((k) => !keys.has(k)), depth: Math.round(depth.width), knob: Math.round(knob.width), fits: r.bottom <= innerHeight && r.right <= innerWidth, over: body.scrollWidth - body.clientWidth, scroll: body.scrollHeight - body.clientHeight, face: !!document.querySelector('.rk-card .pd-screen'), lu: w.querySelector('.mb-lu')?.textContent, meters: w.querySelectorAll('.mb-loud [role=meter]').length };
    });
    ok(first.editor === 'multiband' && first.bands === 3 && first.handles === 6 && first.divs === 2, `Open on its face opens its own window: three bands, six thresholds, two splits (${first.editor}, ${first.bands}, ${first.handles}, ${first.divs})`);
    ok(first.every, `every param has its control in the window${first.missing.length ? ': missing ' + first.missing.join(', ') : ''}`);
    ok(first.depth >= 96 && first.depth > first.knob * 2, `DEPTH is the big knob (${first.depth} px, the band knobs ${first.knob})`);
    ok(first.fits && first.over <= 1 && first.scroll <= 1, `it fits a 1440 x 900 screen whole: nothing runs out sideways or needs scrolling (${first.scroll} px over)`);
    ok(first.face, 'its face in the rack draws the three curves on a screen');
    ok(first.lu === '–' && first.meters === 2, `under DEPTH, the loudness out against in waits for the song ("${first.lu}"), with an In and an Out meter (${first.meters})`);
    await shot('multiband-desktop');

    // (an insert stores only the params that were set: the rest are at their defaults)
    const params = () => E(({ track, fx }) => { const a = window.overdub, d = a.devices.getDevice('core.multiband'); return { ...Object.fromEntries(d.params.map((p) => [p.key, p.def])), ...a.store.insert(track, fx).params }; }, setup);
    const hist = () => E(() => { const h = window.overdub.store.history, l = h[h.length - 1]; return { n: h.length, by: l?.by, label: l?.label }; });
    const centre = (sel) => E((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const drag = async (sel, dx, dy = 0, mods = []) => {
      const c = await centre(sel);
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.move(c.x, c.y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(c.x + dx * i / 10, c.y + dy * i / 10);
      await page.mouse.up();
      for (const m of mods) await page.keyboard.up(m);
      await sleep(80);
    };
    const DEF = await E(() => Object.fromEntries(window.overdub.devices.getDevice('core.multiband').params.map((p) => [p.key, p.def])));

    // a threshold: drag it, one undo step signed you; undo puts it back
    const p0 = await params(), h0 = await hist();
    await drag('.mb-band[data-band="mid"] .mb-h[data-side="down"]', 40, 10);
    const p1 = await params(), h1 = await hist();
    ok(p1.mid_down_thresh > DEF.mid_down_thresh + 5 && h1.n - h0.n === 1 && h1.by === 'you' && /mid band down threshold/.test(h1.label), `dragging the mid band's downward threshold right raises it (${DEF.mid_down_thresh} -> ${p1.mid_down_thresh} dB), one undo step signed you ("${h1.label}")`);
    const lab = await E(() => document.querySelector('.mb-band[data-band="mid"] .mb-h[data-side="down"]').getAttribute('aria-valuetext'));
    const words = Math.abs(p1.mid_down_thresh) < 0.05 ? '0 dB' : `${p1.mid_down_thresh < 0 ? 'minus' : 'plus'} ${Math.abs(p1.mid_down_thresh).toFixed(1)} dB`;
    ok(lab.startsWith(words), `…and its words follow ("${lab}")`);
    await E(() => window.overdub.store.undo());
    await sleep(60);
    ok((await params()).mid_down_thresh === p0.mid_down_thresh, 'one undo puts it back');
    await drag('.mb-band[data-band="low"] .mb-h[data-side="up"]', -30);
    const p2 = await params(), h2 = await hist();
    ok(p2.low_up_thresh < DEF.low_up_thresh && h2.n - h0.n === 1 && h2.by === 'you', `dragging the low band's upward threshold left lowers it (${DEF.low_up_thresh} -> ${p2.low_up_thresh} dB), one step`);
    // Shift: finer
    const before = (await params()).low_up_thresh;
    await drag('.mb-band[data-band="low"] .mb-h[data-side="up"]', -30, 0, ['Shift']);
    const fine = before - (await params()).low_up_thresh, coarse = DEF.low_up_thresh - p2.low_up_thresh;
    ok(fine > 0 && fine < coarse / 3, `Shift moves it finer: the same 30 px is ${fine.toFixed(1)} dB instead of ${coarse.toFixed(1)}`);
    // they can't cross: the upward one dragged far right stops at the downward one
    await drag('.mb-band[data-band="high"] .mb-h[data-side="up"]', 400);
    const p3 = await params();
    ok(p3.high_up_thresh === p3.high_down_thresh, `the thresholds can't cross: the upward one stops at the downward one (${p3.high_up_thresh} / ${p3.high_down_thresh} dB)`);
    // double-click: back to its default
    const dc = await centre('.mb-band[data-band="high"] .mb-h[data-side="up"]');
    await page.mouse.dblclick(dc.x, dc.y);
    await sleep(80);
    ok((await params()).high_up_thresh === DEF.high_up_thresh, 'a double-click puts a threshold back to its default');

    // the splits: dragging moves their frequencies; the keys move them a semitone
    const s0 = await params(), sh0 = await hist();
    await drag('.mb-div[data-key="xover_lo"]', 80);
    const s1 = await params(), sh1 = await hist();
    ok(s1.xover_lo > 120 * 1.3 && sh1.n - sh0.n === 1 && sh1.by === 'you' && /low-mid split/.test(sh1.label), `dragging the low-mid split right moves it up (120 -> ${s1.xover_lo} Hz), one undo step signed you`);
    const range = await E(() => document.querySelector('.mb-band[data-band="low"] .mb-br').textContent);
    ok(range === `under ${s1.xover_lo} Hz`, `…and the low band says where it ends now ("${range}")`);
    await E(() => document.querySelector('.mb-div[data-key="xover_hi"]').focus());
    await page.keyboard.press('ArrowRight');
    await sleep(60);
    const s2 = await params();
    ok(Math.abs(Math.log2(s2.xover_hi / s0.xover_hi) - 1 / 12) < 0.01, `an arrow key moves the mid-high split a semitone (${s0.xover_hi} -> ${s2.xover_hi} Hz)`);
    await drag('.mb-div[data-key="xover_lo"]', 900);
    const s3 = await params();
    ok(s3.xover_lo <= s3.xover_hi / 1.5 + 1, `the splits keep 1.5 times apart: the low one dragged past the high one stops at ${s3.xover_lo} Hz (the high one at ${s3.xover_hi})`);
    await E(({ track, fx }) => window.overdub.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { xover_lo: 120, xover_hi: 2500 } } }, { by: 'you', label: 'back' }), setup);

    // the keyboard on a threshold
    await E(() => document.querySelector('.mb-band[data-band="mid"] .mb-h[data-side="down"]').focus());
    const k0 = (await params()).mid_down_thresh;
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('PageDown');
    await sleep(60);
    const k1 = (await params()).mid_down_thresh;
    ok(Math.abs(k1 - (k0 - 6.6)) < 1e-6, `arrows move a threshold 0.5 dB, Shift 0.1 and Page Down 6 (${k0} -> ${k1} dB)`);
    await page.keyboard.press('Home');
    await sleep(60);
    const k2 = await params();
    ok(k2.mid_down_thresh === k2.mid_up_thresh, `Home takes the downward threshold as low as it goes: down to the upward one (${k2.mid_down_thresh} dB)`);
    // Tab walks the splits, the knobs and the thresholds
    await E(() => document.querySelector('.mb-div[data-key="xover_lo"]').focus());
    const order = [];
    for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); order.push(await E(() => document.activeElement?.closest('[data-key]')?.dataset.key || document.activeElement?.className || '')); }
    ok(order[0] === 'xover_hi' && order.includes('depth') && order.includes('low_down_thresh') && order.includes('low_up_thresh'), `Tab walks the splits, depth and its knobs, then the bands' thresholds and knobs (${order.join(' > ')})`);
    const unnamed = await E(() => [...document.querySelectorAll('.pw button, .pw [role=slider], .pw [role=radio], .pw select, .pw [tabindex="0"]')].filter((x) => x.getClientRects().length && !(x.getAttribute('aria-label') || x.textContent.trim() || x.getAttribute('aria-labelledby'))).length);
    ok(unnamed === 0, `every control in the window has a name (${unnamed} without)`);
    const names = await E(() => [...document.querySelectorAll('.mb-ctl [role=slider]')].map((x) => x.getAttribute('aria-label')));
    ok(new Set(names).size === names.length && names.includes('Low band downward ratio') && names.includes('High band release'), `each band's knobs say which band they're in ("${names[0]}", "${names[names.length - 1]}")`);
    await E(({ track, fx }) => { const a = window.overdub, d = a.devices.getDevice('core.multiband'); a.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: Object.fromEntries(d.params.map((p) => [p.key, p.def])) } }, { by: 'you', label: 'defaults' }); }, setup);

    // while the song plays: the loudness out against in, the In and Out meters, each band held or lifted, the dots
    const read = () => E(() => { const w = document.querySelector('.pw'), m = w.querySelector('.mb').mbMap.readouts(); return { ...m, lu: m.lu, luText: w.querySelector('.mb-lu').textContent, say: w.querySelector('.mb-lus').textContent, said: w.querySelector('.mb-ld').textContent, state: w.querySelector('.mb-loud').dataset.state, peakText: w.querySelector('.mb-pk').textContent, now: [...w.querySelectorAll('.mb-now')].map((x) => x.textContent), levels: [...w.querySelectorAll('.mb-band')].map((b) => b.dataset.level), color: getComputedStyle(w.querySelector('.mb-lu')).color, status: w.querySelector('.pw-status')?.textContent || '' }; });
    await E(async () => { const a = window.overdub; await a.engine.start?.(); a.engine.play(0); });
    await sleep(2500);
    const r1 = await read();
    await sleep(500);
    const r2 = await read();
    await shot('multiband-playing');
    ok(Number.isFinite(r1.lu) && /^[+−]?\d+\.\d LU$/.test(r1.luText) && /(louder|quieter) than it came in|as loud as it came in/.test(r1.say), `while the song plays the window says what it does to the level, out against in: "${r1.luText}, ${r1.say}"`);
    ok(r1.out.rms > -100 && r1.out.rms !== r2.out.rms && r1.inp.rms !== r2.inp.rms && /^−?\d+\.\d$/.test(r1.peakText), `…the In and Out meters move (out ${r1.out.rms.toFixed(1)} then ${r2.out.rms.toFixed(1)} dB RMS), and the Out meter holds its peak ("${r1.peakText}")`);
    ok(r1.bands.every((v) => Number.isFinite(v)) && r1.bands.some((v, i) => v !== r2.bands[i]) && r1.now.every((t) => /^(held|lifted) \d+\.\d dB$|^untouched$/.test(t)), `each band says how far it holds the sound down or lifts it now, worked out on the page with the kernel's own detectors (${r1.now.join(', ')}; then ${r2.now.join(', ')})`);
    ok(r1.levels.every((x) => x !== '' && Number.isFinite(+x)) && r1.levels.some((x, i) => x !== r2.levels[i]), `…and the live dot moves: each band's level (${r1.levels.join(', ')} dB, then ${r2.levels.join(', ')})`);
    // the readout is right: at depth 0 with OUTPUT at -6 dB the device is a 6 dB cut, and the window reads -6.0 LU; a
    // drop of a decibel or more is in the warning ink, and the window's line says it once
    await E(({ track, fx }) => window.overdub.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { depth: 0, out_gain: -6 } } }, { by: 'you', label: 'cut' }), setup);
    await sleep(5500);
    const r3 = await read();
    const warn = await E(() => getComputedStyle(document.documentElement).getPropertyValue('--warn').trim());
    await shot('multiband-quieter');
    ok(Math.abs(r3.lu + 6) <= 0.3 && /quieter than it came in/.test(r3.say) && /quieter/.test(r3.state), `a 6 dB cut reads ${r3.luText} ("${r3.say}"): the window's loudness is the measured one`);
    const hex = (c) => { const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(c); return m ? '#' + m.slice(1).map((v) => (+v).toString(16).padStart(2, '0')).join('') : c; };
    ok(hex(r3.color) === warn.toLowerCase() && (r1.lu <= -1 || hex(r1.color) !== warn.toLowerCase()), `…in the warning ink (${hex(r3.color)}) when it takes a decibel or more off, and not otherwise (${hex(r1.color)} at ${r1.luText})`);
    ok(/Coming out \d+\.\d LU quieter than it goes in/.test(r3.status), `…and the window's line says so ("${r3.status}")`);
    await E(() => window.overdub.engine.stop());
    await sleep(250);
    const r4 = await read();
    ok(/when it last played/.test(r4.said) && /last/.test(r4.state) && r4.now.every((t) => t === '') && r4.levels.every((x) => x === ''), `when the song stops it keeps the last reading ("${r4.said}", dimmed), and the bands' readouts and dots leave`);
    await E(({ track, fx }) => window.overdub.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { depth: 40, out_gain: 0 } } }, { by: 'you', label: 'back' }), setup);

    // an agent's change: what it moved flashes in its ink, and the window says what it was
    const ag = await E(async ({ track, fx }) => {
      const a = window.overdub;
      a.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { low_down_thresh: -24 } } }, { by: 'claude', label: 'more body' });
      await new Promise((r) => setTimeout(r, 80));
      const hd = document.querySelector('.mb-band[data-band="low"] .mb-h[data-side="down"]');
      const one = { flash: hd.classList.contains('pk-flash'), color: getComputedStyle(hd).outlineColor, say: document.querySelector('.pw .pw-status')?.textContent };
      a.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { depth: 65 } } }, { by: 'claude', label: 'deeper' });
      await new Promise((r) => setTimeout(r, 80));
      const two = { flash: document.querySelector('.mb-depth').classList.contains('pk-flash'), say: document.querySelector('.pw .pw-status')?.textContent };
      a.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { xover_hi: 3000 } } }, { by: 'claude', label: 'split' });
      await new Promise((r) => setTimeout(r, 80));
      const three = { flash: document.querySelector('.mb-div[data-key="xover_hi"]').classList.contains('pk-flash'), say: document.querySelector('.pw .pw-status')?.textContent };
      return { one, two, three };
    }, setup);
    ok(ag.one.flash && ag.one.color === 'rgb(76, 195, 255)' && /Claude moved the low band's downward threshold to −24\.0 dB\./.test(ag.one.say), `an agent's threshold flashes in cool ink and the window says so ("${ag.one.say}")`);
    ok(ag.two.flash && /Claude set Depth to 65%/.test(ag.two.say), `…its depth flashes the big knob ("${ag.two.say}")`);
    ok(ag.three.flash && /Claude moved the mid-high split to 3 kHz/.test(ag.three.say), `…and a split flashes too ("${ag.three.say}")`);
    await shot('multiband-agent');
    await sleep(1800);
    ok(await E(() => !document.querySelector('.mb .pk-flash, .mb-depth.pk-flash')), 'the flashes fade');

    // agents: get_device describes it; adjust "punchier" turns its depth down and "glue" up, each measured. (On Studio A, the
    // kit in the report: on the demo's Gobo Kit depth barely moves the crest, and adjust's measuring turns the plan round)
    const gd = await E(() => window.overdub.tools.run('get_device', { id: 'core.multiband' }, { by: 'claude' }));
    const lines = gd.params || [];
    ok(lines.some((l) => /^depth 0\.\.100 % def=40 role=mix — how much of the compressed sound you hear/.test(l)) && lines.some((l) => /^low_attack /.test(l) && /punchier/.test(l)) && (gd.presets || []).length === 6, `get_device describes every param ("${lines.find((l) => l.startsWith('depth'))?.slice(0, 90)}…")`);
    const adj = await E(async ({ track, fx }) => {
      const a = window.overdub, out = {};
      a.store.dispatch({ type: 'instrument.set', track, device: 'core.drumroom' }, { by: 'you', label: 'Studio A' });
      for (const [axis, direction] of [['punchier', 'more'], ['glue', 'more']]) {
        a.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { depth: 40, low_down_thresh: a.devices.getDevice('core.multiband').params.find((p) => p.key === 'low_down_thresh').def, xover_hi: 2500 } } }, { by: 'you', label: 'back' });
        const r = await a.tools.run('adjust', { axis, direction, amount: 'a_bit', target: { track } }, { by: 'claude' });
        const p = a.store.insert(track, fx).params, ins = a.store.track(track).inserts.map((x) => x.device);
        out[axis] = { changed: r.changed, result: r.measured?.result, corrected: r.corrected, depth: p.depth, ins, error: r.error };
      }
      return out;
    }, setup);
    ok(adj.punchier.depth < 40 && (!adj.punchier.corrected || /pushed further/.test(adj.punchier.corrected)) && /punch: moved/.test(adj.punchier.result || '') && adj.punchier.ins.length === 1, `adjust "punchier" on the drums turns Gaffer Tape's depth down and measures it (${adj.punchier.changed?.join('; ')}; ${adj.punchier.result}${adj.punchier.corrected ? '; ' + adj.punchier.corrected : ''})`);
    ok(adj.glue.depth > 40 && (!adj.glue.corrected || /pushed further/.test(adj.glue.corrected)) && /squash\): moved/.test(adj.glue.result || '') && adj.glue.ins.length === 1, `adjust "glue" turns it up and measures it, with nothing added (${adj.glue.changed?.join('; ')}; ${adj.glue.result}${adj.glue.corrected ? '; ' + adj.glue.corrected : ''})`);
    // its CSS keeps the liner-notes rules (design/LINER-NOTES-KIT.md; docs/research/AI-SMELLS.md)
    const sheet = await E(() => [...document.querySelectorAll('style[data-css="plugin-multiband"]')].map((x) => x.textContent).join('\n'));
    ok(sheet.length > 1000 && !/border-(left|right|top)\s*:\s*[2-9]px solid|border-(left|right|top)(-color)?\s*:\s*[^;]*var\(--(human|agent|accent|accent-2)\)|inset\s+-?\d+px\s+0\s+0|border-radius:\s*(50%|(99|999|9999)px)|backdrop-filter|radial-gradient|linear-gradient|box-shadow/.test(sheet), 'its CSS has no coloured edge, no pill, no glass, no glow, no shadow');
    ok(!ours(errors).length, `desktop: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'the desktop run threw: ' + (e && e.stack || e));
  }
  await s.close();
}

console.log('\nthe window (Chromium, a phone)');
{
  const s = await open('/app/', { query: 'demo', width: 390, height: 844 });
  const { page, errors, shot } = s;
  const E = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(400);
    const setup = await E(async () => {
      const a = window.overdub, t = a.store.get().tracks.find((x) => x.kind === 'instrument');
      const r = a.store.dispatch({ type: 'insert.add', track: t.id, insert: { device: 'core.multiband' }, ref: 'g' }, { by: 'you', label: 'gaffer' });
      a.plugin.open({ track: t.id, slot: r.created.g });
      for (let i = 0; i < 60 && document.querySelector('.pw')?.dataset.editor !== 'multiband'; i++) await new Promise((res) => setTimeout(res, 50));
      await new Promise((res) => setTimeout(res, 300));
      return { track: t.id, fx: r.created.g };
    });
    await shot('multiband-phone');
    const m = await E(() => {
      const w = document.querySelector('.pw'), r = w.getBoundingClientRect(), mb = w.querySelector('.mb');
      const cols = [...w.querySelectorAll('.mb-band')].map((b) => b.getBoundingClientRect());
      const box = (q) => [...mb.querySelectorAll(q)].filter((x) => x.getClientRects().length).map((x) => { const b = x.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
      const texts = [...mb.querySelectorAll('*')].filter((x) => x.getClientRects().length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      const small = texts.map((x) => [x.className, parseFloat(getComputedStyle(x).fontSize), x.textContent.trim().slice(0, 16)]).filter((x) => x[1] < 12);
      // a 44 px target under a finger: the point 20 px either side of a handle's or a split's centre still reaches it
      const reach = (q) => [...mb.querySelectorAll(q)].filter((x) => x.getClientRects().length).map((x) => { x.scrollIntoView({ block: 'center' }); const b = x.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2; const at = (dx, dy) => { const t = document.elementFromPoint(cx + dx, cy + dy); return !!t && (t === x || x.contains(t)); }; return at(-20, 0) && at(20, 0) && at(0, -20) && at(0, 20); });
      const loud = w.querySelector('.mb-loud')?.getBoundingClientRect();
      return { phone: w.classList.contains('pw-phone'), w: Math.round(r.width), vw: innerWidth, stacked: cols.every((c, i) => i === 0 || (Math.abs(c.left - cols[0].left) < 2 && c.top > cols[i - 1].bottom - 2)), colW: Math.round(cols[0].width), knobs: box('.pk-dial'), small, handles: reach('.mb-h'), divs: reach('.mb-div'), over: w.querySelector('.pw-body').scrollWidth - w.querySelector('.pw-body').clientWidth, loud: !!loud && loud.width > 0 && loud.right <= innerWidth };
    });
    const all44 = (xs) => xs.length > 0 && xs.every(([w, hh]) => w >= 44 && hh >= 44);
    ok(m.phone && m.w === m.vw && m.over <= 1, `under 900 px it is a full-height sheet, nothing running out sideways (${m.w} of ${m.vw} px)`);
    ok(m.stacked && m.colW >= m.vw - 2, `the bands stack, each the width of the screen (${m.colW} px)`);
    ok(m.handles.length === 6 && m.handles.every(Boolean) && m.divs.length === 2 && m.divs.every(Boolean), 'every threshold and both splits are 44 px targets under a finger');
    ok(all44(m.knobs), `every knob is a 44 px target (the smallest ${Math.min(...m.knobs.map(([w, hh]) => Math.min(w, hh)))} px)`);
    ok(!m.small.length && m.loud, `no text under 12 px, and the loudness readout fits the screen${m.small.length ? ' (' + m.small.slice(0, 3).map((x) => `${x[0]} ${x[1]}px "${x[2]}"`).join('; ') + ')' : ''}`);
    // a finger drags a threshold: one step
    const h0 = await E(() => window.overdub.store.history.length);
    const c = await E(() => { const x = document.querySelector('.mb-band[data-band="mid"] .mb-h[data-side="down"]'); x.scrollIntoView({ block: 'center' }); const b = x.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await E(async (c) => {
      const el = document.elementFromPoint(c.x, c.y);
      const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: c.y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      ev('pointerdown', c.x);
      for (let i = 1; i <= 8; i++) ev('pointermove', c.x + i * 5);
      ev('pointerup', c.x + 40);
      await new Promise((r) => setTimeout(r, 120));
    }, c);
    const after = await E(({ track, fx, h0 }) => ({ v: window.overdub.store.insert(track, fx).params.mid_down_thresh, def: window.overdub.devices.getDevice('core.multiband').params.find((p) => p.key === 'mid_down_thresh').def, steps: window.overdub.store.history.length - h0 }), { ...setup, h0 });
    ok(after.v > after.def && after.steps === 1, `a finger drags a threshold: ${after.def} -> ${after.v} dB, one step`);
    await E(() => { document.querySelector('.pw-body').scrollTop = 700; });
    await sleep(200);
    await shot('multiband-phone-scrolled');
    ok(!ours(errors).length, `phone: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'the phone run threw: ' + (e && e.stack || e));
  }
  await s.close();
}
T.done();
