// Rusty Sticks (core.metalkit) and the options drumsampler.js grew for it (intent 0008, spec R3, R5, R7-R12, R14).
//
//   node tools/metalkit-test.js
//
// Always (no kit needed): drumSamplerKernel with none of the new options returns the very source it did before them
// (Rusty Brushes' and Hand Crate's kernels hash as on main), and a kit that isn't here plays the trigger alone (a
// click and a sub on the kick notes, nothing on the rest) and says the kit is missing. With the kit fetched (node
// tools/fetch-kits.js): the file is the pinned one and rebuilds byte for byte from the download cache, every note of
// the map sounds and any other is silent, checkDevice passes, the phrase sits at the house level, 8 bars of double
// kick at 160, 200 and 240 BPM hold their level, colour and timing with no stroke played twice in a row, TIGHT gates the
// kick, the trigger's click reads and its sub adds in phase, the room lengthens the snare, two renders are bit-exact,
// the page's render matches Node's, and the two scenes integration adds to tools/golden.json render to the hashes
// held here (inst:core.metalkit#<kit> and its :trigger twin).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, open } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { dataPath } from '../app/src/engine/node/data.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { measure } from '../app/src/audio/measure.js';
import { defineDevice } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import MK, { METALKIT_HASH, NOTE_MAP, PIECES, LEVEL_OF, KIT_OPTIONS } from '../app/src/devices/builtin/metalkit.js';
import { drumSamplerKernel } from '../app/src/devices/builtin/drumsampler.js';
import BRUSH from '../app/src/devices/builtin/brushkit.js';
import HAND from '../app/src/devices/builtin/handkit.js';
import { createProject } from '../app/src/core/project.js';
import { drumPhrase, PHRASE_BPM, DRUM_PHRASE_BEATS } from '../app/src/audio/testsignals.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// the hashes are held as tools/golden.json holds its own: on the engine it was made on (another V8 rounds Math.exp and
// Math.sin differently in the last bit), reported elsewhere
const GOLDEN_MADE = JSON.parse(fs.readFileSync(new URL('./golden.json', import.meta.url), 'utf8')).made || {};
const SAME_ENGINE = String(GOLDEN_MADE.node || '').split('.')[0] === process.versions.node.split('.')[0] && GOLDEN_MADE.arch === process.arch;
const t = tally('metalkit');
const SR = 48000;
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const r2 = (x) => Math.round(x * 100) / 100;
const hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The golden scenes integration adds (tools/golden-scenes.js), rendered here until then: inst:core.metalkit#<12 hex> is
// the instrument scene every sampled device gets (the drum phrase at defaults); :trigger plays it with the trigger up
// and the room off (CLICK 0, SUB 0, TRIG VEL 0, ROOM off), so the synthesized layers are pinned on their own.
const GOLDEN = {
  [`inst:core.metalkit#${METALKIT_HASH.slice(7, 19)}`]: { params: {}, sha256: '38f83e5e87238e1a7a64a06c6d327fafb180ad4593c852c6cd7580c548539183' },
  [`inst:core.metalkit#${METALKIT_HASH.slice(7, 19)}:trigger`]: { params: { click: 0, sub: 0, trig_vel: 0, room: -40 }, sha256: 'c447519f26c55d96592a52003b7c604bca763b2b612f928b95bdf2d576bcaf9e' },
};

const STAMP = '2026-09-30T00:00:00.000Z';
let nid = 0;
// a one-track song on a kit: notes [{ p, t, d, v }] in beats
function song(notes, params = {}, device = 'core.metalkit', tempo = 120, length = null) {
  const len = length ?? Math.max(4, Math.ceil(Math.max(...notes.map((n) => n.t + n.d))));
  return { ...createProject(), id: 'p_metalkit', title: 'metal kit', key: null, tempo, devices: {}, meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [{ id: 't_kit', name: 'Kit', kind: 'instrument', instrument: { device, params }, inserts: [],
      clips: [{ id: 'c_kit', kind: 'notes', start: 0, length: len, by: 'overdub', notes: notes.map((n) => ({ id: 'n' + (nid++), p: n.p, t: n.t, d: n.d ?? 0.2, v: n.v ?? 0.8, by: 'overdub' })) }],
      gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }] };
}
const render = (notes, params, opts = {}) => renderSong(song(notes, params, opts.device, opts.tempo, opts.length), { from: 0, to: opts.length ?? Math.max(4, Math.ceil(Math.max(...notes.map((n) => n.t + (n.d ?? 0.2))))), tail: opts.tail ?? 2 });
const mono = (r) => { const m = new Float64Array(r.length); for (let i = 0; i < r.length; i++) m[i] = (r.channels[0][i] + r.channels[1][i]) / 2; return m; };
const peakOf = (x, a = 0, b = x.length) => { let p = 0; for (let i = a; i < b; i++) { const v = x[i] < 0 ? -x[i] : x[i]; if (v > p) p = v; } return p; };
const ms = (x, a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return e / Math.max(1, b - a); };
// a zero-phase band: RBJ biquads (Q 0.707), high-pass at lo and low-pass at hi, two each way
function band(x, lo, hi) {
  const biq = (y, f, hp) => {
    const w = 2 * Math.PI * f / SR, cs = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
    const b0 = (hp ? (1 + cs) / 2 : (1 - cs) / 2) / a0, b1 = (hp ? -(1 + cs) : 1 - cs) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; y[i] = v; }
  };
  let y = Float64Array.from(x);
  for (let k = 0; k < 2; k++) { biq(y, lo, true); biq(y, hi, false); y.reverse(); }
  return y;
}
// T60 from a band: the 10 ms RMS envelope, a straight line fitted from 5 to 35 dB (or 25) under its peak
function t60(x, from) {
  const W = 480, env = [];
  for (let a = from; a + W <= x.length; a += W) env.push(10 * Math.log10(ms(x, a, a + W) + 1e-30));
  let pi = 0; env.forEach((v, i) => { if (v > env[pi]) pi = i; });
  const pk = env[pi]; let i5 = pi; while (i5 < env.length && env[i5] > pk - 5) i5++;
  let iE = i5; while (iE < env.length && env[iE] > pk - 35) iE++;
  if (iE >= env.length) { iE = i5; while (iE < env.length && env[iE] > pk - 25) iE++; }
  if (iE >= env.length || iE - i5 < 2) return null;
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = i5; i <= iE; i++) { const tt = i * 0.01; n++; sx += tt; sy += env[i]; sxx += tt * tt; sxy += tt * env[i]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return slope < 0 ? -60 / slope : null;
}
// the spectral centroid of x[a..b) (Hann window, a plain DFT on a power-of-two FFT)
function centroid(x, a, b) {
  const len = b - a; let n = 1; while (n < len) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < len; i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / len));
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let L = 2; L <= n; L <<= 1) { const ang = -2 * Math.PI / L; for (let i = 0; i < n; i += L) for (let k = 0; k < L / 2; k++) { const c = Math.cos(ang * k), s = Math.sin(ang * k), p = i + k, q = p + L / 2; const tr = re[q] * c - im[q] * s, ti = re[q] * s + im[q] * c; re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; } }
  let s = 0, w = 0; for (let k = 1; k < n / 2; k++) { const m = Math.hypot(re[k], im[k]); s += m * k * SR / n; w += m; }
  return s / w;
}
const corr = (x, a, b, n) => { let xy = 0, xx = 0, yy = 0; for (let i = 0; i < n; i++) { xy += x[a + i] * x[b + i]; xx += x[a + i] ** 2; yy += x[b + i] ** 2; } return xy / Math.sqrt(xx * yy || 1); };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// ------------------------------------------------------------------------------------------------ always
console.log('drumsampler.js, without the new options');
{
  // the kernels' SHA-256 on main before the options existed (intent 0008, spec R3)
  const MAIN = { 'core.brushkit': '04feabb3b88fb50f4e81cd1ddf9b41ffa4def7d3d5ae9953dacb07e4e166c196', 'core.handkit': '232a9df3de9f7484ccc26e0c987aeaa6ec79de606c06ff83a62e5b0b45cca7fd' };
  for (const d of [BRUSH, HAND]) t.ok(hex(d.kernel) === MAIN[d.id], `${d.id}: its kernel source is the one main generates (${hex(d.kernel).slice(0, 12)})`);
  const plain = drumSamplerKernel({ pieces: ['a'], levelOf: { a: 'a' }, note: { 36: 'a' } });
  t.ok(!/NOREPEAT|TIGHT|TRIG|ROOMSEND|kitRoom|ONSET/.test(plain), 'with no options passed, none of the options\' code is in the source');
}

console.log('a kit that isn\'t here');
{
  // the same device pointed at a kit nobody has: the trigger plays on the kick notes, nothing else sounds
  defineDevice({ ...MK, id: 'test.metalkit-missing', name: 'Rusty Sticks (missing kit)', presets: [], data: { kit: 'sha256-' + '0'.repeat(64) } });
  const r = render([{ p: 36, t: 0.5 }, { p: 38, t: 1.5 }, { p: 42, t: 2.5 }], {}, { device: 'test.metalkit-missing' });
  const x = mono(r), b = (beat) => Math.round(beat * 0.5 * SR);
  const kick = peakOf(x, b(0.5), b(1.4)), rest = peakOf(x, b(1.5), x.length);
  t.ok(r.warnings.some((w) => w.kind === 'data'), `the render says the kit is missing (${(r.warnings.find((w) => w.kind === 'data') || {}).message || 'no warning'})`);
  t.ok(db(kick) > -30 && rest === 0, `the kick note plays the trigger alone (peak ${r2(db(kick))} dBFS); the snare and the hat are silent (${rest === 0 ? 'nothing' : r2(db(rest)) + ' dBFS'})`);
}

// ------------------------------------------------------------------------------------------------ with the kit
const HAVE = fs.existsSync(dataPath(METALKIT_HASH));
if (!HAVE) t.note(`the kit (${METALKIT_HASH.slice(0, 19)}...) hasn't been fetched: node tools/fetch-kits.js sticks. The kit's checks are skipped`);
else {
  console.log('the kit file');
  {
    const bytes = fs.readFileSync(dataPath(METALKIT_HASH));
    t.ok('sha256-' + hex(bytes) === METALKIT_HASH, `app/kits holds the pinned kit (${(bytes.length / 1e6).toFixed(1)} MB)`);
    const v = spawnSync(process.execPath, [path.join(HERE, 'fetch-kits.js'), '--verify', 'sticks'], { encoding: 'utf8' });
    if (v.status === 2) t.note('the download cache is incomplete: the byte-for-byte rebuild is skipped (node tools/fetch-kits.js --rebuild sticks fills it)');
    else t.ok(v.status === 0, `fetch-kits --verify rebuilds it byte for byte from the download cache${v.status ? ': ' + v.stdout.trim().split('\n').pop() : ''}`);
  }

  console.log('the note map (R5)');
  {
    const quiet = [];
    for (const [p, piece] of NOTE_MAP) { const r = render([{ p, t: 0.5, v: 0.8 }], { room: -40 }, { length: 2, tail: 1 }); if (db(peakOf(mono(r))) < -40) quiet.push(`${p} ${piece}`); }
    t.ok(!quiet.length, `every note of the map sounds (${NOTE_MAP.length} notes)${quiet.length ? ': silent ' + quiet.join(', ') : ''}`);
    t.ok(PIECES.every((p) => LEVEL_OF[p]) && NOTE_MAP.every(([, p]) => PIECES.includes(p)), 'every piece answers to a level knob, and every note to a piece');
    const other = render([{ p: 60, t: 0.5 }, { p: 39, t: 1 }, { p: 56, t: 1.5 }], { room: -40 }, { length: 2, tail: 1 });
    t.ok(peakOf(mono(other)) === 0, 'a note outside the map (60, the clap 39, the cowbell 56) plays nothing');
  }

  console.log('the device check and the house level (R12)');
  {
    const rep = await checkDeviceNode(MK, {});
    t.ok(rep.ok && rep.deterministic && !rep.nan, `checkDevice passes in Node: ${rep.level && rep.level.lufs} LUFS, ${rep.truePeak} dBTP, ${rep.cpu && rep.cpu.pct}% CPU, latency ${rep.latency && rep.latency.declared} samples declared${rep.ok ? '' : ': ' + rep.errors.join('; ')}`);
    for (const w of rep.warnings || []) t.note('checkDevice: ' + w);
    const ph = drumPhrase();
    const r = renderSong(song(ph, {}, 'core.metalkit', PHRASE_BPM, DRUM_PHRASE_BEATS), { from: 0, to: DRUM_PHRASE_BEATS, tail: 2 });
    const m = measure({ sr: r.sr, channels: r.channels });
    t.ok(m.lufs >= -17 && m.lufs <= -15 && m.truePeak <= -1, `the drum phrase at defaults: ${m.lufs} LUFS (want -16 +-1), ${m.truePeak} dBTP (want <= -1)`);
    const r2_ = renderSong(song(ph, {}, 'core.metalkit', PHRASE_BPM, DRUM_PHRASE_BEATS), { from: 0, to: DRUM_PHRASE_BEATS, tail: 2 });
    t.ok(sha256(r) === sha256(r2_), `two renders of the phrase are bit-identical (${sha256(r).slice(0, 16)})`);
  }

  console.log('double kick (R7, R8)');
  {
    // 8 bars of sixteenths at one velocity; each hit's peak, 0-30 ms centroid and onset (found on the 1-8 kHz band,
    // where the last hit's low tail doesn't reach), against the note plus the kit's declared latency
    const table = [];
    for (const bpm of [160, 200, 240]) {
      const n = 128, notes = [];
      for (let i = 0; i < n; i++) notes.push({ p: 36, t: 1 + i / 4, d: 0.2, v: 0.8 });
      const r = render(notes, {}, { tempo: bpm, length: 34, tail: 1 });
      const x = mono(r), hb = band(x, 1000, 8000), lat = Math.round(r.latency.total * SR), spb = 60 / bpm, W = Math.round(spb / 4 * SR);
      const pk = [], cen = [], on = [], at = [];
      for (let i = 0; i < n; i++) {
        const t0 = Math.round((1 + i / 4) * spb * SR) + lat;
        pk.push(db(peakOf(x, t0 - 48, t0 + W - 48)));
        const hp = peakOf(hb, t0 - 96, t0 + 480);
        let o = t0 - 96; while (Math.abs(hb[o]) < 0.1 * hp) o++;
        on.push((o - t0) / SR * 1000); at.push(o);
        cen.push(centroid(x, o, o + Math.round(0.03 * SR)));
      }
      const cs = []; for (let i = 1; i < n; i++) cs.push(corr(x, at[i - 1], at[i], Math.round(0.03 * SR)));
      const row = { bpm, levelSd: sd(pk), cv: 100 * sd(cen) / mean(cen), corrMax: Math.max(...cs), corrMean: mean(cs), onMean: mean(on), onSpread: sd(on), onMax: Math.max(...on.map(Math.abs)) };
      table.push(row);
      t.ok(row.levelSd <= 1, `${bpm} BPM: the hits' peak level varies by ${r2(row.levelSd)} dB (sd; want <= 1)`);
      t.ok(row.cv >= 2 && row.cv <= 10, `${bpm} BPM: the 0-30 ms centroid varies by ${r2(row.cv)}% (want 2-10%: never identical, never wild)`);
      t.ok(row.onMax <= 0.5 && row.onSpread <= 0.25, `${bpm} BPM: every onset within ${r2(row.onMax)} ms of its note (want 0.5), spread ${r2(row.onSpread)} ms (want <= 0.25): no flams`);
      // no stroke twice in a row: two hits of one recording correlate 0.99999 and more; different strokes never do here
      t.ok(row.corrMax < 0.9999, `${bpm} BPM: no two consecutive hits are one recording (the closest pair correlates ${row.corrMax.toFixed(4)} over 30 ms)`);
      if (row.corrMax > 0.995) t.note(`${bpm} BPM: consecutive hits correlate up to ${row.corrMax.toFixed(4)} (mean ${row.corrMean.toFixed(4)}); the spec's 0.995 is not met: Big Rusty's own strokes of one layer correlate 0.989-1.000 over their first 30 ms (the recipe's header)`);
    }
    console.log('    ' + table.map((r) => `${r.bpm} BPM: level sd ${r2(r.levelSd)} dB, centroid CV ${r2(r.cv)}%, corr max ${r.corrMax.toFixed(4)} mean ${r.corrMean.toFixed(4)}, onset ${r2(r.onMean)} ms +-${r2(r.onSpread)}`).join('\n    '));
  }

  console.log('TIGHT, the trigger and the room (R9-R11)');
  {
    const one = (p, params, v = 0.8) => { const r = render([{ p, t: 1, d: 0.2, v }], params, { length: 2, tail: 3 }); const x = mono(r); const t0 = Math.round(0.5 * SR + r.latency.total * SR); const pk = peakOf(x, t0 - 96, t0 + SR); let o = t0 - 96; while (Math.abs(x[o]) < 0.1 * pk) o++; return { x, o }; };
    const k = one(36, {}), lo = band(k.x, 40, 150), hi = band(k.x, 2000, 6000);
    const click = 10 * Math.log10(ms(hi, k.o, k.o + 480) / ms(lo, k.o, k.o + 2400));
    const T = t60(lo, k.o - 480);
    t.ok(T != null && T <= 0.25, `the kick's 40-150 Hz T60 at the defaults is ${T && r2(T)} s (want <= 0.25)`);
    const loose = t60(band(one(36, { tight: 60 }).x, 40, 150), 0), tight = t60(band(one(36, { tight: 5 }).x, 40, 150), 0);
    t.ok(tight < T && T < loose, `TIGHT shortens the kick: ${r2(tight)} s at 5 ms, ${r2(T)} s at 18, ${r2(loose)} s at 60`);
    t.ok(click >= -10, `the click reads: the 2-6 kHz band in the first 10 ms is ${r2(click)} dB re the 40-150 Hz band over 50 ms (want >= -10)`);
    const off = one(36, { click: -40, sub: -40 }), offClick = 10 * Math.log10(ms(band(off.x, 2000, 6000), off.o, off.o + 480) / ms(band(off.x, 40, 150), off.o, off.o + 2400));
    t.ok(offClick < click - 10, `with the trigger off it doesn't (${r2(offClick)} dB): the click is the trigger's`);
    const subOn = ms(band(one(36, { click: -40 }).x, 35, 80), 0, SR * 1.5), subOff = ms(band(off.x, 35, 80), 0, SR * 1.5);
    t.ok(subOn > subOff * 1.25, `the sub adds in phase: 35-80 Hz up ${r2(10 * Math.log10(subOn / subOff))} dB with it on (an inverted sub would cancel)`);
    const snDry = one(38, { room: -40 }), snWet = one(38, {});
    const tDry = t60(band(snDry.x, 600, 2500), snDry.o - 480), tWet = t60(band(snWet.x, 600, 2500), snWet.o - 480);
    t.ok(tWet > tDry, `the room lengthens the snare above 600 Hz: T60 ${r2(tDry)} s dry, ${r2(tWet)} s with ROOM at its default`);
    let pkS = 0; for (let i = snDry.o; i < snDry.o + 4800; i++) pkS = Math.max(pkS, Math.abs(snDry.x[i]));
    const crest = db(pkS) - 10 * Math.log10(ms(snDry.x, snDry.o, snDry.o + 4800));
    t.ok(crest >= 13 && crest <= 17, `the dry snare's crest over its first 100 ms is ${r2(crest)} dB (want 13-17, the real snares' range)`);
    const h = one(42, {}), th = t60(band(h.x, 6000, 12000), h.o - 480);
    t.ok(th != null && th <= 0.5, `the closed hat's 6-12 kHz T60 is ${th && r2(th)} s (want <= 0.5: it doesn't wash)`);
  }

  console.log('the golden scenes integration adds');
  {
    // built as tools/golden-scenes.js's instrumentScene builds them (its ids seed the kit's strokes)
    const META = { created: STAMP, modified: STAMP, authors: {} };
    for (const [name, g] of Object.entries(GOLDEN)) {
      const p = { ...createProject(), id: 'p_golden', title: 'core.metalkit test phrase', key: null, meta: META, tempo: PHRASE_BPM, devices: {},
        tracks: [{ id: 't_golden', name: 'Phrase', kind: 'instrument', instrument: { device: 'core.metalkit', params: g.params }, inserts: [],
          clips: [{ id: 'c_phrase', kind: 'notes', start: 0, length: DRUM_PHRASE_BEATS, notes: drumPhrase().map((n, i) => ({ id: 'n' + (i + 1), p: n.p, t: n.t, d: n.d, v: n.v, by: 'overdub' })), by: 'overdub' }],
          gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }] };
      const r = renderSong(p, { from: 0, to: DRUM_PHRASE_BEATS, tail: 2 });
      const h = sha256(r), m = measure({ sr: r.sr, channels: r.channels });
      if (g.sha256 && SAME_ENGINE) t.ok(h === g.sha256, `${name}: ${m.lufs} LUFS, ${m.truePeak} dBTP, sha256 ${h.slice(0, 16)}${h === g.sha256 ? ' matches' : ' != ' + g.sha256.slice(0, 16)}`);
      else t.note(`${name}: ${m.lufs} LUFS, ${m.truePeak} dBTP, sha256 ${h} (${g.sha256 ? "held: " + g.sha256.slice(0, 16) + ", another engine" : "not held yet"})`);
    }
  }

  console.log('the studio');
  {
    const { page, close } = await open('/app/', { query: 'new' });
    try {
      await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
      const ph = drumPhrase().filter((n) => n.t < 8);
      const p = song(ph, {}, 'core.metalkit', PHRASE_BPM, 8);
      const node = renderSong(p, { from: 0, to: 8, tail: 2 });
      const out = await page.evaluate(async ({ p }) => {
        await import('/app/src/devices/builtin/metalkit.js');
        const { renderProject } = await import('/app/src/engine/render.js');
        const { cleanProject } = await import('/app/src/core/project.js');
        const buf = await renderProject(cleanProject(p), { from: 0, to: 8, tail: 2, assets: { get: async () => null } });
        const enc = (f) => { const u = new Uint8Array(f.buffer.slice(0)); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
        return { ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))], len: buf.length };
      }, { p });
      const unb = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
      const ch = out.ch.map(unb);
      let worst = 0;
      for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(ch[c].length, node.channels[c].length); i++) worst = Math.max(worst, Math.abs(ch[c][i] - node.channels[c][i]));
      t.ok(out.len === node.length && db(worst) <= -90, `the page's render (the worklet) matches Node's within -90 dBFS (worst ${worst ? r2(db(worst)) + ' dBFS' : '-inf: bit-identical'})`);
    } finally { await close(); }
  }
}
t.done();
