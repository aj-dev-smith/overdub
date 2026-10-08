// The golden scenes the guitar track adds (intent 0008, spec R2), and what its tests share (below). Each is built the
// way tools/golden-scenes.js builds an fx: scene (the effect on the house's DI strum, 16 beats at 120 bpm, 4 s of
// tail, fixed ids), and pinned here until the integration branch moves them into golden-scenes.js and golden.json by
// name. A scene that plays the cab bank carries its first 12 hex digits in its name, as a sampled instrument's does: a
// different bank is a different scene.
//   fx:core.stack                       Half Stack at its defaults but the Filter 4x12 (no kernel data)
//   fx:core.stack:cab#7fd30c061e6b      Half Stack at its defaults: the close dynamic IR
//   fx:core.cab#7fd30c061e6b            Iso Cab at its defaults
//   fx:core.bassrig#7fd30c061e6b        Y Cable at its defaults, on the house's bass DI
// (tools/stack-test.js, cab-test.js and bassrig-test.js render each in Node and in Chromium and hold them to these.)
import fs from 'node:fs';
import { createProject } from '../app/src/core/project.js';
import { kernelCore, kernelCompiler } from '../app/src/kernel/worklet.js';
import { kernelSpecs } from '../app/src/kernel/host.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { paramValues } from '../app/src/devices/registry.js';
import { dataFor } from '../app/src/engine/node/data.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { diStrum, bassDI } from '../app/src/audio/testsignals.js';
import { CABS_HASH, CAB_FILTER } from '../app/src/devices/builtin/amp-lib.js';

const STAMP = '2026-09-30T00:00:00.000Z';
const META = { created: STAMP, modified: STAMP, authors: {} };
const TAG = '#' + CABS_HASH.slice(7, 19);

export const AMP_GOLDEN = {
  'fx:core.stack': 'd4aa3d21c3cfd32f53f7527574e92dedae01e1f3591ea0c8774c0f0a895a1218',
  ['fx:core.stack:cab' + TAG]: 'ea4856427a043275dcb973293735c7696ab18cdd7916933a6873f801efb6c119',
  ['fx:core.cab' + TAG]: '4348da3d328686a08bc0e8548753874b525688654708a0f6f0b4fbe1e14583aa',
  ['fx:core.bassrig' + TAG]: '827c5ab0475e33f669067362bc447bd9d7c3523dcdfa683284752d097eee0180',
};

function scene(name, id, params, signal = 'strum') {
  const sig = signal === 'bass' ? bassDI(8) : diStrum(8);
  return {
    name, browser: true, opts: { from: 0, to: 16, tail: 4 },
    assets: { a_distrm: { sr: 48000, channels: [sig] } },
    project: {
      ...createProject(), id: 'p_golden', title: id + ' on the DI strum', key: null, meta: META, tempo: 120,
      assets: { a_distrm: { kind: 'audio', name: signal === 'bass' ? 'bass DI' : 'DI strum', sr: 48000, channels: 1, duration: 8 } },
      tracks: [{ id: 't_golden', name: 'Guitar', kind: 'audio', instrument: null,
        inserts: [{ id: 'fx_golden', device: id, on: true, params, by: 'overdub' }],
        clips: [{ id: 'c_strum', kind: 'audio', start: 0, length: 16, asset: 'a_distrm', offset: 0, gain: 0, by: 'overdub' }],
        gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }],
    },
  };
}

export function ampScenes() {
  return [
    scene('fx:core.stack', 'core.stack', { cab: CAB_FILTER }),
    { ...scene('fx:core.stack:cab' + TAG, 'core.stack', {}), data: { cabs: CABS_HASH } },
    { ...scene('fx:core.cab' + TAG, 'core.cab', {}), data: { cabs: CABS_HASH } },
    { ...scene('fx:core.bassrig' + TAG, 'core.bassrig', {}, 'bass'), data: { cabs: CABS_HASH } },
  ];
}

// ------------------------------------------------------------------------------------------------ shared by the tests
// A kernel effect through the KernelCore the AudioWorklet runs (the canonical path), in 128-frame blocks:
// run(def, params, inL, inR?, { data, sched }) -> [L, R]. data: the def's files (default), or null for none; sched(sec)
// may return new params at a block (posted as the host posts them).

export const SR = 48000;
const K = kernelCore(SR, makeDsp(SR), kernelCompiler);
export function run(def, params, inL, inR = inL, { data, sched } = {}) {
  const values = paramValues(def, params), errs = [];
  const c = new K({ source: def.kernel, kind: 'effect', params: kernelSpecs(def), values, seed: 1, data: data === undefined ? dataFor(def.data) : data,
    transport: { bpm: 120, playing: true, beat: 0, time: 0 } }, (m) => { if (m.type === 'error') errs.push(m.message); });
  c.msg({ type: 'params', values, jump: true });
  if (errs.length || !c.cur) throw new Error(def.id + ' did not compile: ' + errs.join('; '));
  const n = inL.length, oL = new Float32Array(n), oR = new Float32Array(n);
  const iL = new Float32Array(128), iR = new Float32Array(128), bL = new Float32Array(128), bR = new Float32Array(128);
  for (let f = 0; f < n; f += 128) {
    const m = Math.min(128, n - f);
    iL.fill(0); iR.fill(0); iL.set(inL.subarray(f, f + m)); iR.set(inR.subarray(f, f + m));
    const p = sched && sched(f / SR);
    if (p) c.msg({ type: 'params', values: paramValues(def, p) });
    c.block(iL, iR, bL, bR, f);
    oL.set(bL.subarray(0, m), f); oR.set(bR.subarray(0, m), f);
  }
  if (errs.length) throw new Error(def.id + ': ' + errs.join('; '));
  return [oL, oR];
}
// the metal DI fixtures (tools/fixtures/metal-di/), rendered once each by the canonical renderer: mono Float32Array
const DIS = {};
export function metalDI(name) {
  if (!DIS[name]) DIS[name] = renderSong(JSON.parse(fs.readFileSync(new URL(`./fixtures/metal-di/${name}.json`, import.meta.url), 'utf8')), { tail: 0.5 }).channels[0];
  return DIS[name];
}
// a power spectrum (Hann, 8192 points, half overlap) and band energies
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, h = len >> 1; for (let k = 0; k < h; k++) { const wr = Math.cos(a * k), wi = Math.sin(a * k); for (let i = k; i < n; i += len) { const q = i + h, xr = re[q] * wr - im[q] * wi, xi = re[q] * wi + im[q] * wr; re[q] = re[i] - xr; im[q] = im[i] - xi; re[i] += xr; im[i] += xi; } } }
}
export { fft };
export function psd(x, N = 8192) {
  const p = new Float64Array(N / 2), w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= x.length; s += N / 2) { im.fill(0); for (let i = 0; i < N; i++) re[i] = x[s + i] * w[i]; fft(re, im); for (let k = 0; k < N / 2; k++) p[k] += re[k] * re[k] + im[k] * im[k]; }
  return p;
}
// the energy between lo and hi Hz, dB re the whole (or as a share, 0..1)
export function band(p, lo, hi, N = 8192) {
  let s = 0, tot = 0;
  for (let k = 1; k < N / 2; k++) { tot += p[k]; const f = k * SR / N; if (f >= lo && f < hi) s += p[k]; }
  return { db: 10 * Math.log10(s / tot + 1e-30), share: s / tot };
}
// the rhythm-guitar numbers of the spec's "Pro tier" (R28): energy in 100 Hz-5 kHz, under 80 Hz, over 8 kHz, and
// 2-4 kHz against 500 Hz-2 kHz
export function guitarBands(x) {
  const p = psd(x);
  return { in: band(p, 100, 5000).share, under80: band(p, 0, 80).db, over8k: band(p, 8000, 24000).db, hm: band(p, 2000, 4000).db, mid: band(p, 500, 2000).db };
}
// the non-harmonic energy of a sine through a device, dB re its harmonics (R25): a -12 dBFS sine at f (moved to a
// bin), 1 s to settle, then a 65,536-point Blackman-Harris spectrum; bins within 4 of a harmonic (the window's main
// lobe) are the harmonics, the rest is what aliased
export function aliasing(def, params, f0, dbfs = -12) {
  const N = 65536, bin = Math.round(f0 * N / SR), f = bin * SR / N, a = Math.pow(10, dbfs / 20), len = N + SR;
  const x = new Float32Array(len); for (let i = 0; i < len; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / SR);
  const [y] = run(def, params, x);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { const u = 2 * Math.PI * i / N; re[i] = y[SR + i] * (0.35875 - 0.48829 * Math.cos(u) + 0.14128 * Math.cos(2 * u) - 0.01168 * Math.cos(3 * u)); }
  fft(re, im);
  const harm = new Uint8Array(N / 2);
  for (let k = 0; k * bin < N / 2 + 4; k++) for (let d = -4; d <= 4; d++) { const b = k * bin + d; if (b >= 0 && b < N / 2) harm[b] = 1; }
  let h = 0, o = 0;
  for (let b = Math.ceil(20 * N / SR); b < N / 2; b++) { const pw = re[b] * re[b] + im[b] * im[b]; if (harm[b]) h += pw; else o += pw; }
  return 10 * Math.log10(o / h);
}

// The scenes in Node (the canonical render: their hashes against AMP_GOLDEN, twice the same) and in Chromium's
// OfflineAudioContext (the studio's preview, through the same worklet), sample for sample. `modules`: the device files
// the page imports to register them (they aren't in builtin/index.js until integration).
export async function goldenChecks(T, names, modules) {
  const { sha256 } = await import('../app/src/engine/node/io.js');
  const { measure } = await import('../app/src/audio/measure.js');
  const all = ampScenes().filter((s) => names.includes(s.name)), renders = new Map();
  for (const s of all) {
    const r = renderSong(s.project, { ...s.opts, assets: s.assets }), h = sha256(r), m = measure({ sr: r.sr, channels: r.channels });
    renders.set(s.name, r);
    const want = AMP_GOLDEN[s.name];
    T.ok(!r.warnings.length && h === want, `${s.name}: ${m.lufs} LUFS, ${m.truePeak} dBTP, sha256 ${h.slice(0, 16)}${want ? (h === want ? ' (pinned)' : ' != pinned ' + want.slice(0, 16)) : ' (not pinned yet)'}${r.warnings.length ? ' ' + JSON.stringify(r.warnings) : ''}`);
    T.ok(sha256(renderSong(s.project, { ...s.opts, assets: s.assets })) === h, `${s.name}: a second render is bit-identical`);
  }
  const { open } = await import('./pw.js');
  const { page, close, errors } = await open('/app/', { query: 'new' });
  try {
    await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
    const b64 = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
    const unb64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
    for (const s of all) {
      const assets = Object.fromEntries(Object.entries(s.assets).map(([k, a]) => [k, { sr: a.sr, channels: a.channels.map(b64) }]));
      const out = await page.evaluate(async ({ project, opts, assets, modules }) => {
        for (const m of modules) await import(m);
        const { renderProject } = await import('/app/src/engine/render.js');
        const { cleanProject } = await import('/app/src/core/project.js');
        const dec = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); };
        const bufs = {};
        for (const [k, a] of Object.entries(assets)) {
          const ch = a.channels.map(dec), ab = new AudioBuffer({ length: ch[0].length, numberOfChannels: ch.length, sampleRate: a.sr });
          ch.forEach((c, i) => ab.copyToChannel(c, i));
          bufs[k] = ab;
        }
        const report = [];
        const buf = await renderProject(cleanProject(project), { ...opts, assets: { get: async (id) => bufs[id] || null }, report: (e) => report.push(e) });
        const enc = (f) => { const u = new Uint8Array(f.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
        return { report, len: buf.length, ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))] };
      }, { project: s.project, opts: s.opts, assets, modules });
      const r = renders.get(s.name), ch = out.ch.map(unb64);
      let worst = 0, diff = 0;
      for (let c = 0; c < 2; c++) { const a = ch[c], b = r.channels[c]; for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = Math.abs(a[i] - b[i]); if (d) { diff++; if (d > worst) worst = d; } } }
      const db = worst > 0 ? 20 * Math.log10(worst) : -Infinity;
      T.ok(out.len === r.length && !out.report.length && db <= -90, `${s.name}: Chromium's worklet and Node ${diff ? `differ by at most ${db.toFixed(1)} dBFS (${diff} samples)` : 'are bit-identical'}${out.report.length ? ' ' + JSON.stringify(out.report) : ''}`);
    }
    T.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally { await close(); }
}
