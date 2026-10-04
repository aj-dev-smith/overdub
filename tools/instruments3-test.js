// Batch 3 of the instrument roadmap (docs/research/INSTRUMENTS.md, "later"): core.poly2 (Step Ladder), core.brass
// (Brass Rail) and core.choir (Risers). Nobody building this can listen, so each is held to its family's signatures
// from the roadmap, measured on the canonical Node render (app/src/engine/node/render.js):
//
//   all       the test phrase at house level (-18.5..-13.5 LUFS, true peak <= -1 dBTP), every preset at -20..-12 LUFS,
//             no NaN, two renders bit-identical, 16 held voices within 6% of a core (scaled by a reference measured
//             alongside, as tools/timbre-test.js does; Brass Rail within 4.5%: it measures about 3% since its voices
//             were made a class working in locals, so this holds that, with room for a loaded machine)
//   poly2     (2.11) the ladder sings at its cutoff (+-5%) at RESO 1; the passband loses <= 6 dB at high resonance;
//             the supersaw keeps its level as DETUNE spreads it (+-3 dB); a C8 saw and pulse at full brightness have
//             nothing between their partials above -60 dB; harder is brighter (x1.3)
//   brass     (2.7) the centroid follows the loudness over a swelled note (Pearson r >= 0.8); attack 10-90% in 20-80 ms;
//             the onset starts flat and settles within 100 ms; harder is brighter (x1.8)
//   choir     (2.8) the spectral envelope's F1 and F2 within 10% of the table for the singing section (bass at G2,
//             tenor at E3, AH and EH); vibrato in the pitch track at 4.5-6.5 Hz; an M onset starts quieter and darker
//             than the vowel; a D onset has its burst (energy over 2.5 kHz in the first 40 ms)
//
// Then each passes checkDevice (kernel/check.js, full mode) in Chromium with no warnings.
//   node tools/instruments3-test.js            NODE_ONLY=1 skips the browser, CPU=0 the timing
import crypto from 'node:crypto';
import { tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';
import { measure } from '../app/src/audio/measure.js';
import { phrase, PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import { INSTRUMENTS } from '../app/src/devices/builtin/index.js';

const t = tally('instruments3');
const SR = 48000, BPM = 120, BEAT = 60 / BPM;
const STAMP = '2026-09-30T00:00:00.000Z';
const IDS = ['core.poly2', 'core.brass', 'core.choir'];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const defs = Object.fromEntries(INSTRUMENTS.filter((d) => IDS.includes(d.id)).map((d) => [d.id, d]));

function project(id, notes, params = {}, beats = PHRASE_BEATS) {
  return {
    ...createProject(), id: 'p_inst3', title: id, key: null, tempo: BPM, meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [{ id: 't_inst3', name: 'Inst', kind: 'instrument', instrument: { device: id, params }, inserts: [],
      clips: [{ id: 'c_inst3', kind: 'notes', start: 0, length: beats, notes: notes.map((n, i) => ({ id: 'n' + (i + 1), by: 'overdub', ...n })), by: 'overdub' }],
      gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }],
  };
}
// notes in seconds -> { L, R, m }
function play(id, notes, params = {}, secs = 3, tail = 0.5) {
  const beats = Math.ceil(secs / BEAT);
  const r = renderSong(project(id, notes.map((n) => ({ p: n.p, v: n.v ?? 0.8, t: n.t / BEAT, d: n.d / BEAT })), params, beats), { from: 0, to: beats, tail });
  const [L, R] = r.channels, m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (L[i] + R[i]);
  return { L, R, m, r };
}
const note = (id, p, v, params = {}, hold = 2, tail = 0.5) => play(id, [{ p, v, t: 0, d: hold }], params, hold, tail);
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const k = i + j + h, vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - vr; im[k] = im[i + j] - vi; re[i + j] += vr; im[i + j] += vi;
        const x = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = x;
      }
    }
  }
}
function power(x, at, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[at + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  fft(re, im);
  const P = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
  return P;
}
function centroid(x, at, N = 4096) { const P = power(x, at, N); let a = 0, b = 0; for (let k = 1; k < P.length; k++) { a += k * P[k]; b += P[k]; } return b > 1e-30 ? a / b * SR / N : 0; }
function onset(x) {
  const fr = 48; let pk = 0; const e = [];
  for (let a = 0; a + fr <= x.length; a += fr) { let s = 0; for (let i = a; i < a + fr; i++) s += x[i] * x[i]; e.push(s); if (s > pk) pk = s; }
  for (let i = 0; i < e.length; i++) if (e[i] > pk * 1e-4) return i * fr;
  return 0;
}
function goertzel(x, a, len, f) {
  const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) { const s = (x[a + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1))) + c * s1 - s2; s2 = s1; s1 = s; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) * 4 / len;
}
function rms(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
// a pitch track (cents against f0) by autocorrelation, 40 ms frames every `hop` s
function pitchTrack(x, from, to, f0, hop = 0.01, W = Math.round(0.04 * SR)) {
  const out = [], lag0 = SR / f0, lo = Math.floor(lag0 / Math.pow(2, 150 / 1200)), hi = Math.ceil(lag0 * Math.pow(2, 150 / 1200));
  for (let a = from; a + W + hi < to; a += Math.round(hop * SR)) {
    let bl = lo, bv = -Infinity; const c = new Float64Array(hi + 2);
    for (let l = lo - 1; l <= hi + 1; l++) { let s = 0; for (let i = 0; i < W; i++) s += x[a + i] * x[a + i + l]; c[l - lo + 1] = s; if (l >= lo && l <= hi && s > bv) { bv = s; bl = l; } }
    const y0 = c[bl - lo], y1 = c[bl - lo + 1], y2 = c[bl - lo + 2], d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 || 1e-12);
    out.push(1200 * Math.log2(lag0 / (bl + d)));
  }
  return out;
}
function rate(series, fr, lo, hi) {
  const mean = series.reduce((u, v) => u + v, 0) / series.length, e = series.map((v) => v - mean);
  let best = 0, bf = 0;
  for (let f = lo; f <= hi; f += 0.02) { let re = 0, im = 0; for (let i = 0; i < e.length; i++) { re += e[i] * Math.cos(2 * Math.PI * f * i / fr); im += e[i] * Math.sin(2 * Math.PI * f * i / fr); } const m = re * re + im * im; if (m > best) { best = m; bf = f; } }
  return bf;
}

// ------------------------------------------------------------------------------------------------ all three
console.log('all: the phrase, presets, determinism');
const PH = phrase().map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT }));
for (const id of IDS) {
  const def = defs[id];
  t.ok(!!def, `${id} is registered as a built-in instrument (${def ? def.name : 'missing'})`);
  if (!def) continue;
  const a = play(id, PH, {}, PHRASE_BEATS * BEAT, 2), b = play(id, PH, {}, PHRASE_BEATS * BEAT, 2);
  const m = measure(a.r);
  let nan = 0; for (const c of a.r.channels) for (const x of c) if (!Number.isFinite(x)) nan++;
  const h = (r) => crypto.createHash('sha1').update(Buffer.from(r.L.buffer)).update(Buffer.from(r.R.buffer)).digest('hex');
  t.ok(m.lufs >= -18.5 && m.lufs <= -13.5 && m.truePeak <= -1 && !nan, `${id} (${def.name}): the test phrase at ${m.lufs} LUFS, ${m.truePeak} dBTP, no NaN (want -18.5..-13.5, <= -1)`);
  t.ok(h(a) === h(b), `${id}: two renders are bit-identical`);
  const rows = (def.presets || []).map((pr) => { const mm = measure(play(id, PH, pr.params, PHRASE_BEATS * BEAT, 2).r); return [pr.name, mm.lufs, mm.truePeak]; });
  const off = rows.filter(([, l, tp]) => !(l >= -20 && l <= -12) || tp > -1);
  t.ok(rows.length >= 2 && !off.length, `${id}: ${rows.length} presets at -20..-12 LUFS, true peaks <= -1 dBTP (${rows.map((r) => `${r[0]} ${r[1]}/${r[2]}`).join(', ')})`);
}

// ------------------------------------------------------------------------------------------------ Step Ladder
console.log('core.poly2 (Step Ladder): the ladder, the supersaw, the oscillators');
{
  const ID = 'core.poly2';
  // the ladder sings at its cutoff: a low C1 (its harmonics 33 Hz apart, so the peak is the filter's), velocity 0.6,
  // ENV 0, so the cutoff is CUTOFF times the key tracking (half the way: sqrt(f0 / C4))
  const sing = [2000, 4000, 8000].map((knob) => {
    const fc = knob * Math.sqrt(mtof(24) / 261.6);
    const x = note(ID, 24, 0.6, { reso: 1, env: 0, cutoff: knob, attack: 0.001 }, 1.5).m, at = onset(x) + Math.round(0.6 * SR);
    const P = power(x, at, 16384), bin = SR / 16384; let best = 0, bf = 0;
    for (let k = Math.floor(fc * 0.5 / bin); k < Math.ceil(fc * 2 / bin); k++) if (P[k] > best) { best = P[k]; bf = k * bin; }
    return { fc, f: bf };
  });
  t.ok(sing.every((s) => Math.abs(s.f / s.fc - 1) <= 0.05), `at RESO 1 the loudest thing near the cutoff is at it: ${sing.map((s) => `${Math.round(s.fc)} Hz -> ${Math.round(s.f)} Hz`).join(', ')} (+-5%)`);
  // passband: a low note's fundamental, well under the cutoff, at RESO 0 and 0.85
  const fund = (reso) => { const x = note(ID, 36, 0.6, { reso, env: 0, cutoff: 4000 }, 1.5).m; return dB(goertzel(x, onset(x) + Math.round(0.5 * SR), 16384, mtof(36))); };
  const loss = fund(0) - fund(0.85);
  t.ok(loss <= 6, `the passband loses ${fmt(loss)} dB at RESO 0.85 against 0 (compensated; want <= 6)`);
  // the supersaw keeps its level as it spreads
  const lv = [0.1, 0.5, 0.9].map((d) => { const x = note(ID, 60, 0.7, { wave: 1, detune: d }, 1.5).m; const a = onset(x); return dB(rms(x, a + Math.round(0.3 * SR), a + Math.round(1.3 * SR))); });
  t.ok(Math.max(...lv) - Math.min(...lv) <= 3, `SUPER keeps its level as DETUNE spreads (0.1 / 0.5 / 0.9: ${lv.map((v) => fmt(v)).join(' / ')} dB; within 3)`);
  // nothing between the partials at C8, full brightness, SAW and PULSE
  const alias = (wave) => {
    const p = 108, f0 = mtof(p), x = note(ID, p, 1, { wave, detune: 0, cutoff: 16000, env: 1, reso: 0 }, 2).m, at = onset(x) + Math.round(0.4 * SR);
    const N = 16384, P = power(x, at, N), bin = SR / N; let ref = 0, worst = 0;
    for (let k = 0; k < P.length; k++) {
      const f = k * bin, h = f / f0, near = Math.abs(h - Math.round(h)) * f0 < 0.006 * f + 6 * bin || f < 20;
      if (Math.abs(f - f0) < 3 * bin) ref = Math.max(ref, P[k]); else if (!near && f < 20000) worst = Math.max(worst, P[k]);
    }
    return 10 * Math.log10(worst / ref + 1e-30);
  };
  const al = [0, 2].map(alias);
  t.ok(al.every((v) => v <= -60), `a C8 at full brightness has nothing between its partials above -60 dB (SAW ${fmt(al[0])}, PULSE ${fmt(al[1])} dB)`);
  const c = (v) => { const x = note(ID, 60, v, {}, 1).m; return centroid(x, onset(x)); };
  t.ok(c(1) / c(0.3) >= 1.3, `harder opens the filter: onset centroid x${fmt(c(1) / c(0.3), 2)} at velocity 1.0 over 0.3 (want >= 1.3)`);
}

// ------------------------------------------------------------------------------------------------ Brass Rail
console.log('core.brass (Brass Rail): brightness follows loudness, the attack, the scoop');
{
  const ID = 'core.brass';
  // a swell: the centroid follows the level (frames of 20 ms from the onset to well into the release)
  const x = note(ID, 60, 0.9, { attack: 0.6, release: 0.5, players: 0, breath: 0 }, 1.5, 1).m, a = onset(x), fr = Math.round(0.02 * SR);
  const lv = [], ce = [];
  for (let i = a; i + 2048 < Math.min(x.length, a + Math.round(2.2 * SR)); i += fr) { const r = rms(x, i, i + 2048); if (r < 1e-4) continue; lv.push(dB(r)); ce.push(centroid(x, i, 2048)); }
  const mean = (u) => u.reduce((p, q) => p + q, 0) / u.length, ml = mean(lv), mc = mean(ce);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < lv.length; i++) { sxy += (lv[i] - ml) * (ce[i] - mc); sxx += (lv[i] - ml) ** 2; syy += (ce[i] - mc) ** 2; }
  const rr = sxy / Math.sqrt(sxx * syy);
  t.ok(rr >= 0.8, `over a swelled note the centroid follows the level: Pearson r ${fmt(rr, 2)} over ${lv.length} frames (want >= 0.8; Risset & Mathews)`);
  // the attack, 10-90% of the held level, one player (a section's pairs beat against the lead once it has arrived)
  const atk = (v) => {
    const y = note(ID, 60, v, { players: 0 }, 1.2).m, e = []; for (let i = 0; i + 240 < Math.round(1.1 * SR); i += 240) e.push(rms(y, i, i + 240));
    const held = e.slice(100, 200).sort((p, q) => p - q)[50], a10 = e.findIndex((u) => u > held * 0.1), a90 = e.findIndex((u) => u > held * 0.9);
    return (a90 - a10) * 0.005;
  };
  const ah = atk(0.8), as = atk(0.4);
  t.ok(ah >= 0.02 && ah <= 0.08 && as >= 0.02 && as <= 0.08, `the air gets going (10-90%) in ${fmt(as * 1000, 0)} ms soft, ${fmt(ah * 1000, 0)} ms hard (want 20-80 ms)`);
  // the scoop: flat at the start, settled by 100 ms (a solo player at C5, so the pitch track is one horn; the
  // autocorrelation normalised, so the rising level doesn't read as pitch)
  const s = note(ID, 72, 0.6, { players: 0, vibrato: 0, breath: 0 }, 1).m, on = onset(s);
  const tr = normTrack(s, on, on + Math.round(0.3 * SR), mtof(72));
  const first = Math.min(...tr.slice(0, 5)), late = tr.slice(20, 40), settled = late.every((c) => Math.abs(c) <= 5);
  t.ok(first <= -8 && settled, `each note lips up: ${fmt(first)} cents at the start, within +-5 cents from 100 ms (${late.slice(0, 4).map((c) => fmt(c)).join(', ')}...)`);
  const c = (v) => { const y = note(ID, 60, v, {}, 1.5).m; return centroid(y, onset(y) + Math.round(0.05 * SR)); };
  t.ok(c(1) / c(0.3) >= 1.8, `harder is brassier: centroid x${fmt(c(1) / c(0.3), 2)} at velocity 1.0 over 0.3 (want >= 1.8; Risset)`);
}

// ------------------------------------------------------------------------------------------------ Risers
console.log('core.choir (Risers): formants by section, vibrato, onsets');
{
  const ID = 'core.choir';
  // the spectral envelope from the harmonics' levels (log-parabolic peak), one singer, no vibrato, no hall
  const TABLE = { 43: { 0.5: [600, 1040], 0.75: [400, 1620] }, 52: { 0.5: [650, 1080], 0.75: [400, 1700] } };
  const solo = { ensemble: 0, vibrato: 0, hall: 0, breath: 0 };
  const res = [];
  for (const p of [43, 52]) for (const vw of [0.5, 0.75]) {
    const f0 = mtof(p), x = note(ID, p, 0.8, { ...solo, vowel: vw }, 2).m, at = onset(x) + Math.round(0.6 * SR);
    const H = []; for (let k = 1; k * f0 < 4000; k++) H.push(dB(goertzel(x, at, 32768, k * f0)));
    const peak = (lo, hi) => {
      let bk = -1; for (let k = 0; k < H.length; k++) { const f = (k + 1) * f0; if (f >= lo && f <= hi && (bk < 0 || H[k] > H[bk])) bk = k; }
      const y0 = H[bk - 1] ?? H[bk], y1 = H[bk], y2 = H[bk + 1] ?? H[bk], d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 || 1e-9);
      return (bk + 1 + clampN(d, -0.5, 0.5)) * f0;
    };
    const [F1, F2] = TABLE[p][vw], g1 = peak(F1 * 0.6, F1 * 1.4), g2 = peak(Math.max(F2 * 0.75, g1 * 1.3), F2 * 1.25);
    res.push({ p, vw, F1, F2, g1, g2, ok: Math.abs(g1 / F1 - 1) <= 0.1 && Math.abs(g2 / F2 - 1) <= 0.1 });
  }
  t.ok(res.every((r) => r.ok), `the formants are the section's: ${res.map((r) => `p${r.p} ${r.vw === 0.5 ? 'AH' : 'EH'} F1 ${Math.round(r.g1)}/${r.F1}, F2 ${Math.round(r.g2)}/${r.F2}`).join('; ')} (within 10%)`);
  // vibrato, once it has arrived
  const v = note(ID, 64, 0.7, { ensemble: 0, hall: 0, breath: 0 }, 4).m, tr = pitchTrack(v, Math.round(1.5 * SR), Math.round(4 * SR), mtof(64));
  const hz = rate(tr, 100, 2, 10);
  t.ok(hz >= 4.5 && hz <= 6.5, `vibrato in the pitch track at ${fmt(hz, 2)} Hz (want 4.5-6.5)`);
  // M: the hum is quieter and darker than the vowel it opens into
  const m = note(ID, 57, 0.8, { onset: 1, attack: 0.01, hall: 0, breath: 0 }, 1).m, om = onset(m);
  const hum = [dB(rms(m, om, om + Math.round(0.05 * SR))), centroid(m, om, 2048)], vow = [dB(rms(m, om + Math.round(0.25 * SR), om + Math.round(0.3 * SR))), centroid(m, om + Math.round(0.25 * SR), 2048)];
  t.ok(vow[0] - hum[0] >= 6 && hum[1] < vow[1], `an M onset hums first: ${fmt(vow[0] - hum[0])} dB under the vowel, centroid ${Math.round(hum[1])} Hz against ${Math.round(vow[1])} Hz`);
  // D: the burst, energy over 2.5 kHz in the first 40 ms that NONE doesn't have
  const hiBand = (on) => { const y = note(ID, 57, 0.8, { onset: on, attack: 0.01, hall: 0, breath: 0 }, 1).m, a = onset(y), P = power(y, a, 2048), bin = SR / 2048; let hi = 0, all = 0; for (let k = 1; k < P.length; k++) { all += P[k]; if (k * bin > 2500) hi += P[k]; } return 10 * Math.log10(hi / all); };
  const dHi = hiBand(2), nHi = hiBand(0);
  t.ok(dHi - nHi >= 6, `a D onset bursts: ${fmt(dHi)} dB of the first 40 ms over 2.5 kHz, ${fmt(nHi)} dB without (want 6 more)`);
}
function clampN(x, a, b) { return x < a ? a : x > b ? b : x; }
// pitch by normalised autocorrelation, 15 ms frames every 5 ms (cents against f0)
function normTrack(x, from, to, f0) {
  const W = Math.round(0.015 * SR), hop = Math.round(0.005 * SR), out = [], lag0 = SR / f0;
  const lo = Math.floor(lag0 / Math.pow(2, 150 / 1200)), hi = Math.ceil(lag0 * Math.pow(2, 150 / 1200));
  for (let a = from; a + W + hi + 1 < to; a += hop) {
    const c = new Float64Array(hi + 3); let bl = lo, bv = -Infinity;
    for (let l = lo - 1; l <= hi + 1; l++) { let s = 0, e0 = 0, e1 = 0; for (let i = 0; i < W; i++) { s += x[a + i] * x[a + i + l]; e0 += x[a + i] ** 2; e1 += x[a + i + l] ** 2; } const v = s / Math.sqrt(e0 * e1 + 1e-30); c[l - lo + 1] = v; if (l >= lo && l <= hi && v > bv) { bv = v; bl = l; } }
    const y0 = c[bl - lo], y1 = c[bl - lo + 1], y2 = c[bl - lo + 2], d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 || 1e-12);
    out.push(1200 * Math.log2(lag0 / (bl + d)));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ CPU
if (process.env.CPU !== '0') {
  console.log('CPU, 16 held voices');
  const ms = (id, params, notes) => { const b = 8, t0 = performance.now(); renderSong(project(id, notes.map((n) => ({ ...n, t: 0, d: b })), params, b), { from: 0, to: b, tail: 0 }); return (performance.now() - t0) / 4000 * 100; };
  const chord = (lo, step) => Array.from({ length: 16 }, (_, k) => ({ p: lo + step * k, v: 0.8 }));
  let ref = Infinity; const best = {};
  for (let round = 0; round < 3; round++) {
    ref = Math.min(ref, ms('core.keys', { voice: 1 }, chord(36, 3)));
    for (const id of IDS) best[id] = Math.min(best[id] ?? Infinity, ms(id, {}, chord(48, 2)));
  }
  const scale = 2.1 / ref;   // the reference's idle cost: it was 3.3% until the 2026-10-01 performance pass made GRAND about 44% cheaper, bit-exact; recalibrated to 2.1% measured on a quiet machine
  t.note(`the reference (Lamp Tines GRAND, 16 voices) took ${fmt(ref, 2)}% here; figures scaled to an idle core`);
  const BUDGET = { 'core.brass': 4.5 };
  for (const id of IDS) { const cap = BUDGET[id] ?? 6; t.ok(best[id] * scale <= cap, `${id}: 16 held voices at ${fmt(best[id] * scale, 2)}% of a core (budget ${cap}%)`); }
}

// ------------------------------------------------------------------------------------------------ the device check, in Chromium
if (!process.env.NODE_ONLY) {
  console.log('checkDevice in Chromium (full mode)');
  const { open } = await import('./pw.js');
  const { page, errors, close } = await open('/app/');
  try {
    for (const id of IDS) {
      const r = await page.evaluate(async (id) => {
        const { getDevice } = await import('/app/src/devices/registry.js');
        const { checkDevice, summarize } = await import('/app/src/kernel/check.js');
        await import('/app/src/devices/builtin/index.js');
        const def = getDevice(id);
        const rep = await checkDevice(def);
        return { ok: rep.ok, errors: rep.errors, warnings: rep.warnings, sum: summarize(rep), worst: rep.extremes && rep.extremes.worstPeak, failed: rep.extremes && rep.extremes.failed, hash: def.hash, lufs: rep.level?.lufs, deltaLU: rep.level?.deltaLU, truePeak: rep.truePeak, cpu: rep.cpu?.pct, tail: rep.tail?.seconds };
      }, id);
      t.ok(r.ok, `${id}: checkDevice ok: ${r.sum}${r.ok ? '' : ' | ' + r.errors.join(' | ')}`);
      t.ok(!r.warnings.length, `${id}: no check warnings${r.warnings.length ? ': ' + r.warnings.join(' | ') : ''}`);
      t.ok(!(r.failed && r.failed.length), `${id}: every param at min and max renders (worst raw peak ${r.worst} dBFS)`);
      const r1 = (x) => (x == null ? x : Math.round(x * 10) / 10);
      if (process.env.REPORT) console.log(`  ${JSON.stringify(id)}: ${JSON.stringify({ hash: r.hash, kind: 'instrument', ok: r.ok, lufs: r1(r.lufs), deltaLU: r1(r.deltaLU), truePeak: r1(r.truePeak), cpu: r1(r.cpu), tail: r1(r.tail), warnings: r.warnings.length })},`);
    }
    // the faces fit a phone
    await page.setViewportSize({ width: 390, height: 844 });
    const faces = await page.evaluate(async (ids) => {
      const { getDevice } = await import('/app/src/devices/registry.js');
      const { renderFace } = await import('/app/src/ui/faces.js');
      const out = {};
      for (const id of ids) { const f = renderFace(getDevice(id), {}, {}).el; document.body.appendChild(f); out[id] = f.scrollWidth > f.clientWidth + 1 || f.getBoundingClientRect().right > innerWidth + 1; f.remove(); }
      return out;
    }, IDS);
    t.ok(Object.values(faces).every((s) => !s), `the faces fit a 390 px phone (${JSON.stringify(faces)})`);
    const mine = errors.filter((e) => /devices\/builtin\/(poly2|brass|choir|tables)/.test(e));
    t.ok(!mine.length, `no page errors from these instruments${mine.length ? ': ' + mine.join(' | ') : ''}`);
  } finally { await close(); }
}
t.done();
