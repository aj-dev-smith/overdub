// Virtuosity Kit (core.drumkit) and kernel data (docs/DEVICES.md, "Kernel data").
//
//   node tools/drumkit-test.js
//
// Always: the .odk container round-trips, a device's `data` field keeps only hashes, and a kit that isn't here plays
// nothing and says so (Node renderer and studio). With the kit fetched (node tools/fetch-kits.js): the file is the
// pinned one (and rebuilds byte for byte from the download cache), the device passes checkDevice in Node and in the
// page, renders bit-exact twice, follows velocity without jumps, chokes its hats, varies its strokes by seed, tunes,
// gates and tilts as its params say, renders at 44.1 kHz, and the studio loads it once (IndexedDB), says "loading"
// while it does, and renders the same samples as Node.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tally, open } from './pw.js';
import { encodeOdk, decodeOdk, normData } from '../app/src/kernel/odk.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { dataPath } from '../app/src/engine/node/data.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { measure } from '../app/src/audio/measure.js';
import { getDevice, defineDevice } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import { KIT_HASH, NOTE_MAP, PIECES } from '../app/src/devices/builtin/drumkit.js';
import { RECIPE } from './kits/virtuosity.js';
import { createProject } from '../app/src/core/project.js';
import { drumPhrase, PHRASE_BPM, DRUM_PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import { kernelCore, kernelCompiler } from '../app/src/kernel/worklet.js';
import { kernelSpecs } from '../app/src/kernel/host.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { paramValues } from '../app/src/devices/registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const t = tally('drumkit');
const def = getDevice('core.drumkit');
const HAVE = fs.existsSync(dataPath(KIT_HASH));
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);

// a one-track song: `notes` ([{ p, t, d, v }]) on the kit with `params`
const song = (notes, params = {}, device = 'core.drumkit', devices = {}) => ({
  ...createProject(), id: 'p_kit', title: 'kit', key: null, tempo: PHRASE_BPM, devices,
  tracks: [{ id: 't_kit', name: 'Kit', kind: 'instrument', instrument: { device, params }, inserts: [],
    clips: [{ id: 'c1', kind: 'notes', start: 0, length: 64, notes: notes.map((n, i) => ({ id: 'n' + i, d: 0.25, v: 0.8, ...n, by: 'overdub' })), by: 'overdub' }],
    gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }],
});
const render = (notes, params, opts = {}) => renderSong(song(notes, params), { from: 0, to: opts.to || 4, tail: opts.tail ?? 4, sr: opts.sr || 48000 });
const rms = (r, a, b) => { const [L, R] = r.channels; let e = 0; const i0 = Math.round(a * r.sr), i1 = Math.min(L.length, Math.round(b * r.sr)); for (let i = i0; i < i1; i++) e += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(e / Math.max(1, 2 * (i1 - i0))); };
const peak = (r) => { let p = 0; for (const c of r.channels) for (const x of c) { const a = Math.abs(x); if (a > p) p = a; } return p; };

// ---------------------------------------------------------------------------------------------- the container
console.log('the .odk container');
{
  const a = [Int16Array.of(0, 1, -1, 32767, -32768), Int16Array.of(5, 4, 3, 2, 1)];
  const b = [Int32Array.of(8388607, -8388608, 0, 12345, -54321, 7), Int32Array.of(1, 2, 3, 4, 5, 6)];
  const bytes16 = encodeOdk({ name: 'x', sr: 48000, bits: 16, channels: 2, meta: { m: 1 }, samples: [{ id: 'a', piece: 'k', ch: a }, { id: 'b', piece: 's', ch: [Int16Array.of(9), Int16Array.of(-9)] }] });
  const d16 = decodeOdk(bytes16);
  t.ok(d16.samples.length === 2 && d16.samples[0].ch.every((c, k) => c.every((v, i) => v === a[k][i])) && d16.samples[1].ch[1][0] === -9 && d16.meta.m === 1 && d16.samples[0].piece === 'k',
    '16-bit samples round-trip exactly, with their fields and the meta');
  const d24 = decodeOdk(encodeOdk({ name: 'y', sr: 44100, bits: 24, channels: 2, samples: [{ id: 'c', ch: b }] }));
  t.ok(d24.sr === 44100 && d24.samples[0].ch.every((c, k) => c.every((v, i) => v === b[k][i])), '24-bit samples round-trip exactly (sign-extended)');
  t.ok(bytes16.length % 4 === 0 && String.fromCharCode(...bytes16.subarray(0, 4)) === 'ODK1', 'the file starts ODK1 and its PCM is 4-byte aligned');
  const again = encodeOdk({ name: 'x', sr: 48000, bits: 16, channels: 2, meta: { m: 1 }, samples: [{ id: 'a', piece: 'k', ch: a }, { id: 'b', piece: 's', ch: [Int16Array.of(9), Int16Array.of(-9)] }] });
  t.ok(Buffer.compare(Buffer.from(bytes16), Buffer.from(again)) === 0, 'encoding is deterministic (the same input, the same bytes)');
  let bad = 0;
  for (const junk of [new Uint8Array(3), Uint8Array.from([0x4f, 0x44, 0x4b, 0x31, 255, 255, 0, 0]), bytes16.subarray(0, bytes16.length - 4)]) { try { decodeOdk(junk); } catch (e) { bad++; } }
  t.ok(bad === 3, 'a short, oversized or truncated file is refused, not read past its end');
  let threw = null; try { encodeOdk({ name: 'z', bits: 16, channels: 1, samples: [{ id: 'q', ch: [Int16Array.of(1)] }].map((s) => ({ ...s, ch: [Float32Array.of(0.5)] })) }); } catch (e) { threw = e.message; }
  t.ok(threw && /integer/.test(threw), `a non-integer sample is refused (${threw})`);
  const n = normData({ kit: KIT_HASH, other: 'sha256-xyz', Bad: KIT_HASH, url: 'https://example.com/kit.odk', n: 3 });
  t.ok(JSON.stringify(n) === JSON.stringify({ kit: KIT_HASH }) && normData({ a: 'nope' }) === null && normData('sha256-0') === null, 'a def\'s `data` keeps only { name: sha256-<64 hex> }');
  const proj = defineDevice({ id: 'you.kit-probe', name: 'Probe', kind: 'instrument', source: 'project', kernel: '({ create() { return { voice() { return { start() {}, release() {}, render() { return false; } }; } }; } })', data: { kit: KIT_HASH, bytes: 'AAAA' } }, { replace: true });
  t.ok(JSON.stringify(proj.data) === JSON.stringify({ kit: KIT_HASH }), 'a song\'s device keeps its kit by hash, and nothing else of `data`');
}

// ---------------------------------------------------------------------------------------------- a missing kit
console.log('a kit that is not here');
{
  const fake = { ...def, id: 'you.missing-kit', source: 'project', data: { kit: 'sha256-' + 'f'.repeat(64) } };
  delete fake.flavour;
  const r = renderSong(song(drumPhrase().slice(0, 12), {}, 'you.missing-kit', { 'you.missing-kit': fake }), { from: 0, to: 4, tail: 1 });
  const w = r.warnings.filter((x) => x.kind === 'data');
  t.ok(w.length === 1 && /plays nothing/.test(w[0].message) && /fetch-kits/.test(w[0].message), `the Node renderer says so: "${w[0] && w[0].message}"`);
  t.ok(peak(r) === 0 && r.skipped.tracks.length === 0, 'and the track renders as silence (not skipped, not an error)');
}

if (!HAVE) {
  t.note(`the kit isn't fetched (${path.relative(path.join(HERE, '..'), dataPath(KIT_HASH))}): node tools/fetch-kits.js, then this runs in full`);
  t.done();
  process.exit();
}

// ---------------------------------------------------------------------------------------------- the file
console.log('the kit file');
const bytes = fs.readFileSync(dataPath(KIT_HASH));
const kit = decodeOdk(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
{
  t.ok('sha256-' + crypto.createHash('sha256').update(bytes).digest('hex') === KIT_HASH, `the file is the pinned kit (${KIT_HASH.slice(0, 19)}...)`);
  t.ok(bytes.length <= 30 * 1048576, `${(bytes.length / 1048576).toFixed(1)} MB (the budget is 30 MB)`);
  t.ok(kit.sr === 48000 && kit.bits === 16 && kit.channels === 2, `48 kHz, 16-bit, stereo (${kit.sr}, ${kit.bits}, ${kit.channels})`);
  const want = PIECES.length * 3 * 2;
  const by = {};
  for (const s of kit.samples) (by[s.piece] ??= new Set()).add(`${s.layer}.${s.rr}`);
  t.ok(kit.samples.length === want && PIECES.every((p) => by[p] && by[p].size === 6), `${kit.samples.length} samples: ${PIECES.length} articulations x 3 velocity layers x 2 strokes`);
  t.ok(kit.meta.licence === 'CC0-1.0' && kit.meta.commit === RECIPE.commit && kit.meta.source === RECIPE.source, `it carries its source and licence (${kit.meta.licence}, ${kit.meta.repo}@${kit.meta.commit.slice(0, 12)})`);
  // each stroke's start is in the file (create() reads it instead of scanning the kit on the audio thread): 2 ms
  // before the stroke first comes within 20 dB of its peak
  const wrong = kit.samples.filter((s) => {
    const [L0, R0] = s.ch; let pk = 0;
    for (let i = 0; i < s.frames; i++) pk = Math.max(pk, Math.abs(L0[i]), Math.abs(R0[i]));
    let on = 0; while (on < s.frames && Math.abs(L0[on]) * 10 < pk && Math.abs(R0[on]) * 10 < pk) on++;
    return s.start !== Math.max(0, on - Math.round(0.002 * kit.sr));
  });
  t.ok(!wrong.length, `every stroke's start is in the file, 2 ms before its attack${wrong.length ? ' (wrong: ' + wrong.map((s) => s.id).join(', ') + ')' : ''}`);
  t.ok(NOTE_MAP.every(([, piece]) => PIECES.includes(piece)) && Object.values(def.notes).every((s) => typeof s === 'string' && s.length <= 40), `every mapped note (${NOTE_MAP.length}) plays a piece in the kit, and names it`);
  const cache = path.join(HERE, '.out', 'kits-cache');
  if (fs.existsSync(cache)) {
    const v = spawnSync(process.execPath, [path.join(HERE, 'fetch-kits.js'), '--verify'], { encoding: 'utf8' });
    if (v.status === 2) t.note('the download cache is incomplete: the byte-for-byte rebuild was not run');
    else t.ok(v.status === 0, `the kit rebuilds byte for byte from the pinned upstream files (${(v.stdout.trim().split('\n').pop() || '').trim()})`);
  } else t.note('no download cache: the byte-for-byte rebuild was not run');
}

// ---------------------------------------------------------------------------------------------- the device
console.log('the device');
{
  const rep = await checkDeviceNode(def, {});
  t.ok(rep.ok && !rep.warnings.length, `checkDevice (Node) passes with no warnings${rep.ok ? '' : ': ' + rep.errors.join('; ')}${rep.warnings.length ? ' (' + rep.warnings.join('; ') + ')' : ''}`);
  t.ok(rep.deterministic === true, 'checkDevice: two renders are bit-identical');
  t.ok(rep.level.lufs >= -18.5 && rep.level.lufs <= -13.5 && rep.truePeak <= -1, `checkDevice: ${rep.level.lufs} LUFS on the drum phrase, ${rep.truePeak} dBTP`);
  t.ok(rep.latency && rep.latency.samples >= rep.latency.declared && rep.latency.samples <= rep.latency.declared + 96, `a stroke sounds ${rep.latency && rep.latency.samples} samples after its note: the limiter's declared look-ahead (${rep.latency && rep.latency.declared}) and at most the 2 ms each stroke starts before its attack`);
  t.ok(rep.cpu && rep.cpu.pct < 25, `cpu ${rep.cpu && rep.cpu.pct}% of real time`);
  // create() runs on the audio thread (a new kit track, an undo, the samples arriving for a live one): it reads only
  // the first 150 ms of each stroke, not the whole kit. Best of five, with the kit already decoded, as the worklet has it.
  {
    const data = { kit }, specs = kernelSpecs(def), values = paramValues({ params: specs }, {});
    for (const sr of [48000, 44100]) {
      const K = kernelCore(sr, makeDsp(sr), kernelCompiler);
      let best = Infinity, ready = 0;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        new K({ source: def.kernel, kind: 'instrument', params: specs, values, poly: def.poly, seed: 1, tail: def.tail, data }, (m) => { if (m && m.type === 'ready') ready++; });
        best = Math.min(best, performance.now() - t0);
      }
      t.ok(ready === 5 && best < 10, `building a kit instance at ${sr / 1000} kHz takes ${best.toFixed(1)} ms (best of 5; under 10, not a scan of the whole kit)`);
    }
  }

  const phrase = drumPhrase();
  const a = render(phrase, {}, { to: DRUM_PHRASE_BEATS, tail: 2 }), b = render(phrase, {}, { to: DRUM_PHRASE_BEATS, tail: 2 });
  t.ok(sha256(a) === sha256(b), `the drum phrase renders bit-exact twice (${sha256(a).slice(0, 16)})`);
  const m = measure({ sr: a.sr, channels: a.channels });
  t.ok(m.lufs >= -18.5 && m.lufs <= -13.5 && m.truePeak <= -1, `the drum phrase: ${m.lufs} LUFS, ${m.truePeak} dBTP`);
  t.ok(!a.warnings.length, 'no warnings from the renderer');

  // velocity: the snare's level climbs with velocity and never jumps where the layers change
  const lv = [];
  for (let v = 0.1; v <= 1.0001; v += 0.02) {
    const r = render([{ p: 38, t: 0, v }], {}, { to: 1, tail: 0.6 });
    lv.push([v, db(rms(r, 0, 0.3))]);
  }
  let down = 0, jump = 0;
  for (let i = 1; i < lv.length; i++) { const d = lv[i][1] - lv[i - 1][1]; if (d < -0.5) down++; if (Math.abs(d) > jump) jump = Math.abs(d); }
  t.ok(down === 0 && jump < 2, `the snare's level follows velocity (${lv[0][1].toFixed(1)} dB at ${lv[0][0].toFixed(2)} to ${lv[lv.length - 1][1].toFixed(1)} dB at 1; biggest step ${jump.toFixed(2)} dB per 0.02)`);
  // a velocity on a boundary plays both layers: the render differs from either neighbour's timbre scaled
  const top0 = RECIPE.pieces.find((p) => p.id === 'snare').layers[0].vel / 127;
  const mid = render([{ p: 38, t: 0, v: top0 }], {}, { to: 1, tail: 0.6 }), lo = render([{ p: 38, t: 0, v: top0 - 0.1 }], {}, { to: 1, tail: 0.6 });
  t.ok(sha256(mid) !== sha256(lo) && rms(mid, 0, 0.3) > rms(lo, 0, 0.3), 'across a layer boundary the layers crossfade (and it is louder than below it)');

  // round robin: the same seed repeats exactly; eight snares in a row (2 s apart, so none overlaps) aren't one stroke
  // eight times, and the order is the seed's
  const eight = Array.from({ length: 8 }, (_, k) => ({ p: 38, t: 4 * k, v: 0.95 }));
  const order = (r) => { const out = []; for (let k = 0; k < 8; k++) { const i0 = Math.round(k * 2 * r.sr) + 200; out.push(sha256({ channels: [r.channels[0].subarray(i0, i0 + 2400)] })); } return out; };
  const r8 = render(eight, {}, { to: 32, tail: 1 }), o8 = order(r8);
  const strokes = new Set(o8);
  t.ok(strokes.size === 2, `eight snares at one velocity play both strokes (${strokes.size} different: ${o8.map((h) => [...strokes].indexOf(h) + 1).join('')})`);
  const p2 = song(eight); p2.tracks[0].id = 't_other';
  const o8b = order(renderSong(p2, { from: 0, to: 32, tail: 1 }));
  t.ok(sha256(render(eight, {}, { to: 32, tail: 1 })) === sha256(r8) && o8b.join() !== o8.join(), `the strokes come from the track's seed: the same track repeats, another track draws its own (${o8b.map((h) => [...strokes].indexOf(h) + 1).join('')})`);

  // the hats: a closed note chokes an open hat
  const open1 = render([{ p: 46, t: 0, v: 0.9 }], {}, { to: 2, tail: 2 });
  const choked = render([{ p: 46, t: 0, v: 0.9 }, { p: 42, t: 1, v: 0.3 }], {}, { to: 2, tail: 2 });
  const ringOn = db(rms(open1, 0.7, 1.2)), ringOff = db(rms(choked, 0.7, 1.2));
  t.ok(ringOn - ringOff > 15, `a closed hat chokes the open one (0.2-0.7 s after it: ${ringOn.toFixed(1)} dB open, ${ringOff.toFixed(1)} dB choked)`);
  const ped = render([{ p: 46, t: 0, v: 0.9 }, { p: 44, t: 1, v: 0.5 }], {}, { to: 2, tail: 2 });
  t.ok(ringOn - db(rms(ped, 0.7, 1.2)) > 10, 'so does the pedal');
  const crash = render([{ p: 49, t: 0, v: 0.9 }, { p: 42, t: 1, v: 0.3 }], {}, { to: 2, tail: 2 }), crash1 = render([{ p: 49, t: 0, v: 0.9 }], {}, { to: 2, tail: 2 });
  t.ok(Math.abs(db(rms(crash, 1.5, 2.5)) - db(rms(crash1, 1.5, 2.5))) < 1, 'a hat note leaves the crash ringing');

  // tune: an octave up is half as long; at 0 it reads the samples as they are (no interpolation)
  const k0 = render([{ p: 36, t: 0, v: 0.9 }], {}, { to: 1, tail: 3 }), kUp = render([{ p: 36, t: 0, v: 0.9 }], { tune: 12 }, { to: 1, tail: 3 });
  const lastAbove = (r, thr) => { const L = r.channels[0]; for (let i = L.length - 1; i >= 0; i--) if (Math.abs(L[i]) > thr) return i / r.sr; return 0; };
  const e0 = lastAbove(k0, 1e-4), eUp = lastAbove(kUp, 1e-4);
  t.ok(eUp < e0 * 0.65 && eUp > e0 * 0.35, `TUNE +12 plays the kick an octave up: it rings ${eUp.toFixed(2)} s against ${e0.toFixed(2)} s`);
  const s0 = kit.samples.find((s) => s.piece === 'kick' && s.layer === 2), lat = rep.latency.declared;
  const hit = render([{ p: 36, t: 0, v: 1 }], { kick_level: 0, level: 0 }, { to: 1, tail: 1 });
  // the stroke's samples, through its gain: output = sample x one constant while nothing limits it (to the master
  // soft clip's float32 curve, a few 1e-7 absolute)
  // (each stroke starts 2 ms before it first comes within 20 dB of its peak, faded in over 1 ms: compared after that)
  const x = hit.channels[0], ratios = new Set();
  for (const s of kit.samples.filter((q) => q.piece === 'kick' && q.layer === 2)) {
    const [L0, R0] = s.ch; let pk = 0;
    for (let i = 0; i < s.frames; i++) pk = Math.max(pk, Math.abs(L0[i]), Math.abs(R0[i]));
    let on = 0; while (on < s.frames && Math.abs(L0[on]) * 10 < pk && Math.abs(R0[on]) * 10 < pk) on++;
    const at = Math.max(0, on - 96);
    let ok = true; const r0 = x[lat + 1000] / L0[at + 1000];
    for (let i = 48; i < 4800; i++) { const y = x[lat + i], w = L0[at + i]; if (Math.abs(y - w * r0) > 2e-6) { ok = false; break; } }
    if (ok) ratios.add(s.id);
  }
  t.ok(ratios.size === 1 && s0, `at TUNE 0 a stroke is its recorded samples, scaled (it matches ${[...ratios].join('') || 'neither stroke'} sample for sample)`);

  // decay gates; level knobs; tone tilts
  const cr = render([{ p: 49, t: 0, v: 0.9 }], {}, { to: 1, tail: 6 }), crShort = render([{ p: 49, t: 0, v: 0.9 }], { decay: 30 }, { to: 1, tail: 6 });
  t.ok(db(rms(crShort, 2, 3)) < db(rms(cr, 2, 3)) - 20 && Math.abs(db(rms(crShort, 0, 0.05)) - db(rms(cr, 0, 0.05))) < 1, `DECAY 30% cuts the crash's tail (2-3 s: ${db(rms(cr, 2, 3)).toFixed(1)} to ${db(rms(crShort, 2, 3)).toFixed(1)} dB) and keeps its attack`);
  const off = render([{ p: 49, t: 0, v: 0.9 }], { crash_level: -40 }, { to: 1, tail: 1 });
  t.ok(peak(off) === 0, 'a piece at -40 dB is off');
  const dark = render([{ p: 51, t: 0, v: 0.8 }], { tone: -100 }, { to: 1, tail: 1 }), bright = render([{ p: 51, t: 0, v: 0.8 }], { tone: 100 }, { to: 1, tail: 1 }), flat = render([{ p: 51, t: 0, v: 0.8 }], {}, { to: 1, tail: 1 });
  const cen = (r) => measure({ sr: r.sr, channels: r.channels }).centroid;
  t.ok(cen(dark) < cen(flat) && cen(flat) < cen(bright), `TONE tilts the ride (centroid ${Math.round(cen(dark))} / ${Math.round(cen(flat))} / ${Math.round(cen(bright))} Hz at -100 / 0 / +100)`);
  // other sample rates: resampled by the kernel's own interpolator
  const r44 = render(phrase, {}, { to: DRUM_PHRASE_BEATS, tail: 2, sr: 44100 });
  const m44 = measure({ sr: 44100, channels: r44.channels });
  t.ok(Math.abs(m44.lufs - m.lufs) < 0.5 && sha256(r44) === sha256(render(phrase, {}, { to: DRUM_PHRASE_BEATS, tail: 2, sr: 44100 })), `at 44.1 kHz it plays the same kit (${m44.lufs} LUFS against ${m.lufs}), bit-exact twice`);
  // notes it doesn't map are silent; its kit names them
  const none = render([{ p: 39, t: 0 }, { p: 56, t: 1 }, { p: 60, t: 2 }], {}, { to: 3, tail: 1 });
  t.ok(peak(none) === 0 && def.notes.other === 'Not in this kit', 'notes it has no samples for (clap, cowbell, 60) are silent, and named "Not in this kit"');
}

// ---------------------------------------------------------------------------------------------- the studio
console.log('the studio');
{
  const { page, close, errors } = await open('/app/', { query: 'new' });
  try {
    await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
    // the browser's render of the phrase against Node's
    const phrase = drumPhrase();
    const node = render(phrase, {}, { to: DRUM_PHRASE_BEATS, tail: 2 });
    let fetched = 0;
    page.on('request', (rq) => { if (rq.url().endsWith('.odk')) fetched++; });
    const out = await page.evaluate(async ({ p }) => {
      const { renderProject } = await import('/app/src/engine/render.js');
      const { cleanProject } = await import('/app/src/core/project.js');
      const { checkDevice } = await import('/app/src/kernel/check.js');
      const reg = await import('/app/src/devices/registry.js');
      const D = await import('/app/src/kernel/data.js');
      const before = D.dataState(reg.getDevice('core.drumkit').data.kit) || 'none';
      const buf = await renderProject(cleanProject(p), { from: 0, to: 24, tail: 2, assets: { get: async () => null } });
      const rep = await checkDevice(reg.getDevice('core.drumkit'));
      const enc = (f) => { const u = new Uint8Array(f.buffer.slice(0)); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      return { before, after: D.dataState(reg.getDevice('core.drumkit').data.kit), ok: rep.ok, errors: rep.errors, lufs: rep.level && rep.level.lufs, ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))], len: buf.length };
    }, { p: song(phrase) });
    const unb = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
    const ch = out.ch.map(unb);
    let worst = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(ch[c].length, node.channels[c].length); i++) worst = Math.max(worst, Math.abs(ch[c][i] - node.channels[c][i]));
    t.ok(out.before === 'none' && out.after === 'ready', `nothing is fetched until a render needs the kit (${out.before} -> ${out.after})`);
    t.ok(out.len === node.length && db(worst) <= -90, `the page's render matches Node's within -90 dBFS (worst ${worst ? db(worst).toFixed(1) : '-inf'} dBFS${worst ? '' : ': bit-identical'})`);
    t.ok(fetched === 1, `the kit was fetched once for a render and a device check (${fetched} requests)`);
    t.ok(out.ok, `checkDevice in the page passes (${out.lufs} LUFS)${out.ok ? '' : ': ' + out.errors.join('; ')}`);
    // cached: a reload takes it from IndexedDB, not the network
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
    fetched = 0;
    const st = await page.evaluate(async () => { const D = await import('/app/src/kernel/data.js'); const h = (await import('/app/src/devices/registry.js')).getDevice('core.drumkit').data.kit; const b = await D.loadData(h); return { n: b && b.length, s: D.dataState(h) }; });
    t.ok(st.s === 'ready' && st.n === bytes.length && fetched === 0, `after a reload it comes from IndexedDB (${fetched} requests, ${(st.n / 1048576).toFixed(1)} MB)`);
    t.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }

  // live: a track with the kit says it's loading until the samples arrive, then plays; a kit the server hasn't got says so
  for (const mode of ['slow', 'missing']) {
    const o = await open('/app/', { query: 'new' });
    try {
      await o.page.route('**/*.odk', async (route) => {
        if (mode === 'missing') return route.fulfill({ status: 404, body: 'not found' });
        await new Promise((r) => setTimeout(r, 2500));
        return route.continue();
      });
      await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
      // (a fresh browser: nothing cached in IndexedDB)
      const tid = await o.page.evaluate(async () => {
        const a = window.overdub;
        await a.engine.start();
        window.__kitErr = [];
        a.engine.on('error', (e) => window.__kitErr.push(e));
        const r = a.store.dispatch({ type: 'track.add', track: { kind: 'instrument', name: 'Kit', instrument: { device: 'core.drumkit', params: {} } } }, { by: 'you' });
        const id = r.created.track;
        a.ui.select({ track: id, insert: null });
        a.ui.show('rack');
        return id;
      });
      if (mode === 'slow') {
        const saw = await o.page.waitForFunction(() => [...document.querySelectorAll('.rk-data')].some((el) => !el.hidden && /Loading samples/.test(el.textContent) && /plays once/.test(el.title)), null, { timeout: 2000 }).then(() => true, () => false);
        if (saw) await o.shot('drumkit-loading');
        t.ok(saw, 'while the samples load, the device says "Loading samples…" beside its name');
        const gone = await o.page.waitForFunction(() => [...document.querySelectorAll('.rk-data')].every((el) => el.hidden), null, { timeout: 15000 }).then(() => true, () => false);
        const live = await o.page.evaluate(async (id) => { const i = window.overdub.engine.instance(id); return i && i.data && i.data.state; }, tid);
        t.ok(gone && live === 'ready', `then the line goes and the track's instance has its kit (${live})`);
      } else {
        const said = await o.page.waitForFunction(() => [...document.querySelectorAll('.rk-data')].some((el) => !el.hidden && /No samples/.test(el.textContent) && /aren’t on this server/.test(el.title)), null, { timeout: 10000 }).then(() => true, () => false);
        const err = await o.page.waitForFunction(() => window.__kitErr.some((e) => e.kind === 'data'), null, { timeout: 5000 }).then(() => o.page.evaluate(() => window.__kitErr.find((e) => e.kind === 'data').message), () => null);
        t.ok(said && err && /plays nothing/.test(err), `a kit the server hasn't got: the device says so, and so does the engine ("${err}")`);
      }
      await o.shot('drumkit-' + mode);
      t.ok(!o.errors.filter((e) => !/404|Failed to load resource/.test(e)).length, `${mode}: no page errors${o.errors.length ? ' (' + o.errors.slice(0, 2).join(' | ') + ')' : ''}`);
    } finally { await o.close(); }
  }
}
t.done();
