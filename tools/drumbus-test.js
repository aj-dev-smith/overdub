// Drum Riser (core.drumbus), the drum bus (intent 0008, spec R15, R16).
//
//   node tools/drumbus-test.js
//
// The device check in Node; the latency it declares is where an impulse comes out, and the dry, wet, room and crush
// paths all line up there (a click through it at any MIX is one click, not two); within 1 LU of bypass at its
// defaults on the check's drum loop, the DI strum and a Rusty Sticks groove, every true peak at or under -1 dBTP;
// each preset renders and keeps the level near; the snare's crest after Modern sits at 9-13 dB (a real dry snare's
// 13-17, brought down as a bus does); the transient shaper lifts and softens the hits and the ring as it says; the
// crush is high-passed; two renders are bit-exact; the page's worklet renders the same samples; and the golden scene
// integration adds (fx:core.drumbus) renders to the hash held here. The groove checks need Rusty Sticks' kit (node
// tools/fetch-kits.js sticks); without it they are skipped.
import fs from 'node:fs';
import { tally, open } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { dataPath } from '../app/src/engine/node/data.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { measure } from '../app/src/audio/measure.js';
import { presetParams } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import BUS from '../app/src/devices/builtin/drumbus.js';
import { METALKIT_HASH } from '../app/src/devices/builtin/metalkit.js';
import { createProject } from '../app/src/core/project.js';
import { diStrum } from '../app/src/audio/testsignals.js';

// the hashes are held as tools/golden.json holds its own: on the engine it was made on (another V8 rounds Math.exp and
// Math.sin differently in the last bit), reported elsewhere
const GOLDEN_MADE = JSON.parse(fs.readFileSync(new URL('./golden.json', import.meta.url), 'utf8')).made || {};
const SAME_ENGINE = String(GOLDEN_MADE.node || '').split('.')[0] === process.versions.node.split('.')[0] && GOLDEN_MADE.arch === process.arch;
const t = tally('drumbus');
const SR = 48000;
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const r2 = (x) => Math.round(x * 100) / 100;
const STAMP = '2026-09-30T00:00:00.000Z';
const META = { created: STAMP, modified: STAMP, authors: {} };

// fx:core.drumbus, as tools/golden-scenes.js's effectScene builds it (the DI strum, 8 s, defaults, 4 s of tail)
const GOLDEN_FX = '8e34613a676d4ad6abf89c8439ab2d5411d12917300d6788d63605ee824390bb';

// an audio clip through the bus: channels [L, R] at 48 kHz
function throughBus(channels, params, { on = true, tail = 1 } = {}) {
  const secs = channels[0].length / SR, beats = secs * 2;
  const p = { ...createProject(), id: 'p_bus', title: 'bus', key: null, tempo: 120, devices: {}, meta: META,
    assets: { a_in: { kind: 'audio', name: 'in', sr: SR, channels: 2, duration: secs } },
    tracks: [{ id: 't_bus', name: 'Drums', kind: 'audio', instrument: null,
      inserts: on ? [{ id: 'fx_bus', device: 'core.drumbus', on: true, params, by: 'overdub' }] : [],
      clips: [{ id: 'c_in', kind: 'audio', start: 0, length: beats, asset: 'a_in', offset: 0, gain: 0, by: 'overdub' }],
      gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }] };
  return renderSong(p, { from: 0, to: beats, tail, assets: { a_in: { sr: SR, channels } } });
}
// a Rusty Sticks groove on a track, through the bus or not: 4 bars at 160 BPM
function groove(params, { on = true, notes = null, tempo = 160, kit = {} } = {}) {
  const n = notes || [];
  if (!notes) for (let b = 0; b < 4; b++) for (let s = 0; s < 16; s++) {
    const tt = b * 4 + s / 4;
    if (s % 2 === 0) n.push({ p: 36, t: tt, v: 0.8 });
    if (s === 4 || s === 12) n.push({ p: 38, t: tt, v: 0.9 });
    if (s % 2 === 0) n.push({ p: 42, t: tt, v: s % 4 ? 0.6 : 0.8 });
    if (s === 0 && b % 2 === 0) n.push({ p: 49, t: tt, v: 1 });
  }
  const len = Math.max(4, Math.ceil(Math.max(...n.map((x) => x.t + 0.25))));
  const p = { ...createProject(), id: 'p_bus', title: 'bus', key: null, tempo, devices: {}, meta: META,
    tracks: [{ id: 't_kit', name: 'Drums', kind: 'instrument', instrument: { device: 'core.metalkit', params: kit },
      inserts: on ? [{ id: 'fx_bus', device: 'core.drumbus', on: true, params, by: 'overdub' }] : [],
      clips: [{ id: 'c_kit', kind: 'notes', start: 0, length: len, by: 'overdub', notes: n.map((x, i) => ({ id: 'n' + i, p: x.p, t: x.t, d: 0.2, v: x.v, by: 'overdub' })) }],
      gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }] };
  return renderSong(p, { from: 0, to: len, tail: 2 });
}
const lufsOf = (r) => measure({ sr: r.sr, channels: r.channels });
const preset = (name) => presetParams(BUS, name);

console.log('the device check');
{
  const rep = await checkDeviceNode(BUS, {});
  t.ok(rep.ok && rep.deterministic && !rep.nan, `checkDevice passes in Node: ${rep.cpu && rep.cpu.pct}% CPU${rep.ok ? '' : ': ' + rep.errors.join('; ')}`);
  for (const w of rep.warnings || []) t.note('checkDevice: ' + w);
  t.ok(rep.latency && rep.latency.declared === 23 && rep.latency.samples === 23, `it declares 23 samples (the 4x clip's latency) and an impulse comes out there (${rep.latency && rep.latency.samples})`);
  t.ok(Math.abs(rep.level.deltaLU) <= 1 && Math.abs(rep.level.drumsDeltaLU) <= 1 && rep.truePeak <= -1, `at its defaults within 1 LU of bypass: the DI strum ${rep.level.deltaLU} LU, the drum loop ${rep.level.drumsDeltaLU} LU; ${rep.truePeak} dBTP`);
}

console.log('the paths line up');
{
  // a click at -12 dBFS: the dry path, the clip path, the room and the crush, each alone, come out at sample 23
  const n = SR, x = new Float32Array(n); x[4800] = 0.25;
  const at = (params) => { const r = throughBus([x, x], { squash: 0, drive: 0, ...params }, { tail: 0.5 }); const y = r.channels[0]; let pk = 0, pi = 0; for (let i = 4700; i < 4900; i++) if (Math.abs(y[i]) > pk) { pk = Math.abs(y[i]); pi = i; } return pi - 4800; };
  const dry = at({ mix: 0 }), wet = at({ mix: 1 }), half = at({ mix: 0.5 });
  t.ok(dry === 23 && wet === 23 && half === 23, `a click comes out 23 samples later dry (${dry}), through the clip (${wet}) and half and half (${half})`);
  // half and half: one click, not two (the 2x half-band rings symmetrically about its centre: nothing else near it)
  const r = throughBus([x, x], { squash: 0, drive: 0, mix: 0.5 }, { tail: 0.5 }), y = r.channels[0];
  let side = 0; for (let i = 4823 - 40; i < 4823 + 40; i++) if (Math.abs(i - 4823) > 16) side = Math.max(side, Math.abs(y[i]));
  t.ok(db(side) < db(Math.abs(y[4823])) - 40, `mixed half and half it is one click: nothing within 40 samples of it above ${r2(db(side) - db(Math.abs(y[4823])))} dB re the click (want < -40)`);
  // the crush: its lows taken out before it squashes. A 60 Hz and a 1 kHz tone, equal, through the crush alone: the
  // difference it adds holds the 1 kHz tone well over the 60 Hz one
  const two = new Float32Array(SR); for (let i = 0; i < SR; i++) two[i] = 0.15 * (Math.sin(2 * Math.PI * 60 * i / SR) + Math.sin(2 * Math.PI * 1000 * i / SR)) * Math.min(1, i / 480, (SR - i) / 480);
  const crushOnly = { mix: 1, squash: 0, drive: 0, crush: 0, output: 0 };
  const w = throughBus([two, two], crushOnly), d0 = throughBus([two, two], { ...crushOnly, crush: -40 });
  const diff = w.channels[0].map((v, i) => v - d0.channels[0][i]);
  const bin = (x, f) => { let re = 0, im = 0; for (let i = 12000; i < 36000; i++) { re += x[i] * Math.cos(2 * Math.PI * f * i / SR); im += x[i] * Math.sin(2 * Math.PI * f * i / SR); } return db(Math.hypot(re, im)); };
  const l60 = bin(diff, 60), l1k = bin(diff, 1000);
  t.ok(l1k - l60 > 10, `the crush is high-passed: of two equal tones it adds the 1 kHz ${r2(l1k - l60)} dB over the 60 Hz (want > 10)`);
}

const HAVE = fs.existsSync(dataPath(METALKIT_HASH));
if (!HAVE) t.note('Rusty Sticks\' kit hasn\'t been fetched (node tools/fetch-kits.js sticks): the groove checks are skipped');
else {
  console.log('on a Rusty Sticks groove');
  const by = groove({}, { on: false }), mb = lufsOf(by);
  const rows = [];
  for (const [name, params] of [['defaults', {}], ...BUS.presets.map((p) => [p.name, preset(p.name)])]) {
    const r = groove(params), m = lufsOf(r), d = r2(m.lufs - mb.lufs);
    rows.push(`${name}: ${d > 0 ? '+' : ''}${d} LU, ${m.truePeak} dBTP`);
    if (name === 'defaults') t.ok(Math.abs(d) <= 1 && m.truePeak <= -1, `at its defaults the groove is ${d} LU from bypass (want within 1), ${m.truePeak} dBTP`);
    else t.ok(Math.abs(d) <= 2 && m.truePeak <= 0, `${name}: ${d} LU from bypass, ${m.truePeak} dBTP`);
  }
  console.log('    bypass ' + mb.lufs + ' LUFS; ' + rows.join('; '));
  // the snare's crest over its first 100 ms, a lone hit, the kit's room off: dry, then through Modern
  const crest = (params, on) => {
    const r = groove(params, { on, notes: [{ p: 38, t: 1, v: 0.8 }], tempo: 120, kit: { room: -40 } });
    const x = r.channels[0].map((v, i) => (v + r.channels[1][i]) / 2), t0 = Math.round(0.5 * SR + r.latency.total * SR);
    let pk = 0; for (let i = t0 - 96; i < t0 + SR; i++) pk = Math.max(pk, Math.abs(x[i]));
    let o = t0 - 96; while (Math.abs(x[o]) < 0.1 * pk) o++;
    let e = 0, p2 = 0; for (let i = o; i < o + 4800; i++) { e += x[i] * x[i]; p2 = Math.max(p2, Math.abs(x[i])); }
    return db(p2) - 10 * Math.log10(e / 4800);
  };
  const dry = crest({}, false), modern = crest(preset('Modern'), true);
  t.ok(modern >= 9 && modern <= 13 && modern < dry, `the snare's crest: ${r2(dry)} dB dry, ${r2(modern)} dB after Modern (want 9-13)`);
  // the shaper: ATTACK up lifts the first 5 ms of a hit against its next 50; SUSTAIN up lifts the ring
  const shape = (params) => {
    const r = groove({ squash: 0, drive: 0, ...params }, { notes: [{ p: 38, t: 1, v: 0.8 }], tempo: 120, kit: { room: -40 } });
    const x = r.channels[0], t0 = Math.round(0.5 * SR + r.latency.total * SR);
    const e = (a, b) => { let s = 0; for (let i = t0 + a; i < t0 + b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / (b - a)); };
    return { head: e(0, 240), ring: e(4800, 14400) };
  };
  const s0 = shape({}), sa = shape({ attack: 100 }), ss = shape({ sustain: 100 }), sd = shape({ sustain: -100 });
  t.ok(sa.head - s0.head > 2, `ATTACK +100% lifts the first 5 ms of a snare hit by ${r2(sa.head - s0.head)} dB`);
  t.ok(ss.ring - s0.ring > 2 && s0.ring - sd.ring > 2, `SUSTAIN moves its ring (100-300 ms): +100% ${r2(ss.ring - s0.ring)} dB, -100% ${r2(sd.ring - s0.ring)} dB`);
  const a = groove(preset('Modern')), b = groove(preset('Modern'));
  t.ok(sha256(a) === sha256(b), `two renders through Modern are bit-identical (${sha256(a).slice(0, 16)})`);
}

console.log('the golden scene integration adds');
{
  const r = throughBus([diStrum(8), diStrum(8)], {}, { tail: 4 });
  // effectScene's song: a mono clip of the strum, 16 beats at 120, 4 s of tail
  const strum = diStrum(8);
  const p = { ...createProject(), id: 'p_golden', title: 'core.drumbus on the DI strum', key: null, meta: META, tempo: 120, devices: {},
    assets: { a_distrm: { kind: 'audio', name: 'DI strum', sr: 48000, channels: 1, duration: 8 } },
    tracks: [{ id: 't_golden', name: 'Guitar', kind: 'audio', instrument: null, inserts: [{ id: 'fx_golden', device: 'core.drumbus', on: true, params: {}, by: 'overdub' }],
      clips: [{ id: 'c_strum', kind: 'audio', start: 0, length: 16, asset: 'a_distrm', offset: 0, gain: 0, by: 'overdub' }], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }] };
  const g = renderSong(p, { from: 0, to: 16, tail: 4, assets: { a_distrm: { sr: 48000, channels: [strum] } } });
  const h = sha256(g), m = measure({ sr: g.sr, channels: g.channels });
  if (GOLDEN_FX && SAME_ENGINE) t.ok(h === GOLDEN_FX, `fx:core.drumbus: ${m.lufs} LUFS, ${m.truePeak} dBTP, sha256 ${h.slice(0, 16)}${h === GOLDEN_FX ? ' matches' : ' != ' + GOLDEN_FX.slice(0, 16)}`);
  else t.note(`fx:core.drumbus: ${m.lufs} LUFS, ${m.truePeak} dBTP, sha256 ${h} (${GOLDEN_FX ? "held: " + GOLDEN_FX.slice(0, 16) + ", another engine" : "not held yet"})`);
  t.ok(r.length > 0, 'the DI strum through it renders');

  const { page, close } = await open('/app/', { query: 'new' });
  try {
    await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
    const out = await page.evaluate(async ({ p, b64 }) => {
      await import('/app/src/devices/builtin/drumbus.js');
      const { renderProject } = await import('/app/src/engine/render.js');
      const { cleanProject } = await import('/app/src/core/project.js');
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const strum = new Float32Array(u.buffer);
      const c = new OfflineAudioContext(1, strum.length, 48000), ab = c.createBuffer(1, strum.length, 48000); ab.copyToChannel(strum, 0);
      const buf = await renderProject(cleanProject(p), { from: 0, to: 16, tail: 4, assets: { get: async () => ab } });
      const enc = (f) => { const v = new Uint8Array(f.buffer.slice(0)); let s = ''; for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode.apply(null, v.subarray(i, i + 0x8000)); return btoa(s); };
      return { ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))], len: buf.length };
    }, { p, b64: Buffer.from(strum.buffer).toString('base64') });
    const unb = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
    const ch = out.ch.map(unb);
    let worst = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(ch[c].length, g.channels[c].length); i++) worst = Math.max(worst, Math.abs(ch[c][i] - g.channels[c][i]));
    t.ok(out.len === g.length && db(worst) <= -90, `the page's render (the worklet) matches Node's within -90 dBFS (worst ${worst ? r2(db(worst)) + ' dBFS' : '-inf: bit-identical'})`);
  } finally { await close(); }
}
t.done();
