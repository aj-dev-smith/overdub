// The canonical renderer's checks: "deterministic" has one definition, and this is where it is held.
//
//   node tools/golden-test.js                    Node renders vs tools/golden.json, then the browser-vs-Node parity
//   NODE_ONLY=1 node tools/golden-test.js        skip the browser part
//   UPDATE_GOLDEN=1 node tools/golden-test.js    rewrite tools/golden.json (READ THE RULE BELOW FIRST)
//   UPDATE_GOLDEN=fx:core.verb,demo ...          rewrite only those scenes
//
// 1. Every scene in tools/golden-scenes.js (each built-in kernel instrument on the test phrase, each built-in kernel
//    effect on the DI strum, the showcase kernels, the demo song with its graph devices bypassed) renders with
//    app/src/engine/node/render.js to the SHA-256 tools/golden.json pins, twice the same.
// 2. The browser's OfflineAudioContext render (engine/render.js, the studio's preview) of each kernel-only scene
//    matches the Node render within -90 dBFS, sample for sample (tools/pw.js).
//
// THE RULE: golden.json is never regenerated casually. A hash that moves means the sound moved. Regenerate a scene only
// when a change to that sound is intended (a device's DSP was changed on purpose, a new scene was added), regenerate
// just those scenes, and say which ones and why in the commit. Never regenerate to make a red check green. The hashes
// are bound to the JS engine they were made with (golden.json "made": Node major and CPU arch): another V8 can round
// Math.exp / Math.pow differently in the last bit, so on a different Node major or arch the hashes are reported, not
// enforced, and each scene's loudness and true peak must still match to 0.05 dB. (clawd-o-matic keeps the same rule
// for web/tools/compat-golden.json.)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tally, OUTDIR } from './pw.js';
import { scenes, missingScenes } from './golden-scenes.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256, encodeWav, decodeWav, writeWav } from '../app/src/engine/node/io.js';
import { measure } from '../app/src/audio/measure.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'golden.json');
const OUT = path.join(OUTDIR, 'golden');
fs.mkdirSync(OUT, { recursive: true });
const t = tally('golden');
const PARITY_DB = -90;
const ENGINE = { node: process.versions.node, v8: process.versions.v8, arch: process.arch, platform: process.platform };
const major = (v) => String(v || '').split('.')[0];
const dbfs = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmtDb = (x) => (x === -Infinity ? '-inf' : x.toFixed(1));

const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : { scenes: {} };
const update = process.env.UPDATE_GOLDEN;
const updating = update
  ? update === '1' || update === 'all'
    ? null
    : new Set(update.split(',').map((s) => s.trim()))
  : undefined;
const sameEngine = golden.made && major(golden.made.node) === major(ENGINE.node) && golden.made.arch === ENGINE.arch;

// ------------------------------------------------------------------------------------------------ Node renders
console.log('canonical renders (Node ' + ENGINE.node + ', ' + ENGINE.arch + ')');
if (golden.made && !sameEngine)
  t.note(
    `golden.json was made on Node ${golden.made.node} ${golden.made.arch}: hashes are reported, not enforced; loudness and true peak must match to 0.05 dB`,
  );
const all = scenes();
const missing = missingScenes();
for (const name of missing) t.note(`${name}: skipped, its samples haven't been fetched (node tools/fetch-kits.js)`);
const renders = new Map();
const fresh = {};
let t0 = Date.now();
for (const s of all) {
  const a = Date.now();
  const r = renderSong(s.project, { ...s.opts, assets: s.assets });
  const m = measure({ sr: r.sr, channels: r.channels });
  const h = sha256(r);
  renders.set(s.name, r);
  fresh[s.name] = {
    sha256: h,
    frames: r.length,
    lufs: m.lufs,
    truePeak: m.truePeak,
    peak: m.peak,
    ...(s.data ? { data: s.data } : {}),
  };
  const g = golden.scenes && golden.scenes[s.name];
  const tag = `${s.name}: ${m.lufs} LUFS, ${m.truePeak} dBTP, ${(r.length / r.sr).toFixed(1)} s in ${Date.now() - a} ms`;
  if (updating !== undefined && (updating === null || updating.has(s.name))) {
    t.note(
      `${tag} -> ${h.slice(0, 16)} (${g ? (g.sha256 === h ? 'unchanged' : 'CHANGED from ' + g.sha256.slice(0, 16)) : 'new'})`,
    );
    continue;
  }
  if (!g) {
    t.ok(
      false,
      `${tag}: no golden hash (a new scene? UPDATE_GOLDEN=${s.name} node tools/golden-test.js, and say why in the commit)`,
    );
    continue;
  }
  t.ok(r.length === g.frames, `${s.name}: ${r.length} frames (golden ${g.frames})`);
  // a scene that plays kernel data pins the files too (whole hashes): the same render from another kit is no match
  if (s.data || g.data)
    t.ok(
      JSON.stringify(s.data) === JSON.stringify(g.data),
      `${s.name}: plays the kit golden.json names (${Object.values(s.data || {})
        .map((x) => x.slice(0, 19))
        .join(', ')}...)`,
    );
  if (sameEngine)
    t.ok(
      h === g.sha256,
      `${tag}: sha256 ${h.slice(0, 16)}${h === g.sha256 ? ' matches' : ' != golden ' + g.sha256.slice(0, 16) + ' (the sound changed: if that was intended, see THE RULE in this file)'}`,
    );
  else {
    t.note(
      `${s.name}: sha256 ${h.slice(0, 16)} (golden ${g.sha256.slice(0, 16)}, ${h === g.sha256 ? 'same' : 'differs'} on this engine)`,
    );
    t.ok(
      Math.abs(m.lufs - g.lufs) <= 0.05 && Math.abs(m.truePeak - g.truePeak) <= 0.05,
      `${tag}: within 0.05 dB of golden (${g.lufs} LUFS, ${g.truePeak} dBTP)`,
    );
  }
}
t.note(`${all.length} scenes in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

if (updating !== undefined) {
  const next = { ...golden, scenes: { ...(golden.scenes || {}) } };
  for (const [k, v] of Object.entries(fresh)) if (updating === null || updating.has(k)) next.scenes[k] = v;
  for (const k of Object.keys(next.scenes)) if (!fresh[k] && !missing.includes(k)) delete next.scenes[k];
  next.rule =
    'Never regenerate casually: a hash that moves means the sound moved. Regenerate only the scenes whose sound changed on purpose (UPDATE_GOLDEN=<scene,...> node tools/golden-test.js) and say which and why in the commit. See tools/golden-test.js.';
  next.hash =
    "SHA-256 of the render's float samples: channel 0 then channel 1, each as Float32 little-endian (app/src/engine/node/io.js sha256)";
  next.renderer = 'app/src/engine/node/render.js at 48 kHz; scenes from tools/golden-scenes.js';
  next.made = { ...ENGINE, date: new Date().toISOString().slice(0, 10) };
  const ordered = { rule: next.rule, hash: next.hash, renderer: next.renderer, made: next.made, scenes: next.scenes };
  fs.writeFileSync(GOLDEN, JSON.stringify(ordered, null, 2) + '\n');
  console.log(
    `wrote ${path.relative(process.cwd(), GOLDEN)} (${updating === null ? 'every scene' : [...updating].join(', ')})`,
  );
}

// determinism within one process: a second render of three scenes is bit-identical
for (const name of [
  'inst:core.drums',
  'fx:core.verb',
  'demo',
  ...all.filter((s) => s.name.includes('#')).map((s) => s.name),
]) {
  const s = all.find((x) => x.name === name);
  const again = sha256(renderSong(s.project, { ...s.opts, assets: s.assets }));
  t.ok(again === fresh[name].sha256, `${name}: a second render is bit-identical`);
}

// the demo: graph devices reported and bypassed, nothing else touched
{
  const r = renders.get('demo');
  const graph = r.warnings
    .filter((w) => w.kind === 'graph')
    .map((w) => w.device)
    .sort();
  t.ok(
    graph.join() === 'amp.jangle,pedal.chorus,pedal.gate' && r.warnings.length === 3,
    `demo: the guitar's graph devices are reported (${graph.join(', ')}) and nothing else (${r.warnings.length} warnings)`,
  );
  t.ok(
    r.skipped.inserts.length === 3 && r.skipped.tracks.length === 0,
    `demo: ${r.skipped.inserts.length} inserts bypassed, ${r.skipped.tracks.length} tracks skipped`,
  );
  t.ok(
    fresh.demo.lufs > -12 && fresh.demo.lufs < -9 && fresh.demo.truePeak <= -0.9,
    `demo: ${fresh.demo.lufs} LUFS, ${fresh.demo.truePeak} dBTP (the mix was set by measurement at about -10.6 LUFS, -1.2 dBTP)`,
  );
  let threw = null;
  try {
    renderSong(all.find((x) => x.name === 'demo').project, { to: 1, graph: 'error' });
  } catch (e) {
    threw = e.message;
  }
  t.ok(
    threw && /graph device/.test(threw),
    `graph: 'error' refuses a song with graph devices (${threw && threw.slice(0, 70)}...)`,
  );
  for (const s of all.filter((x) => x.browser))
    if (renders.get(s.name).warnings.length)
      t.ok(false, `${s.name}: warnings in a kernel-only scene: ${JSON.stringify(renders.get(s.name).warnings)}`);
}

// a bypassed trails effect at load is the dry signal (it used to feed the kernel too: +6 dB)
{
  const s = JSON.parse(JSON.stringify(all.find((x) => x.name === 'fx:core.verb')));
  const assets = all.find((x) => x.name === 'fx:core.verb').assets;
  s.project.tracks[0].inserts[0].on = false;
  const off = sha256(renderSong(s.project, { ...s.opts, assets }));
  s.project.tracks[0].inserts = [];
  const dry = sha256(renderSong(s.project, { ...s.opts, assets }));
  t.ok(off === dry, 'a bypassed Stairwell (trails) renders exactly the dry track');
}

// the CLI: a song file in, a 24-bit WAV and the same hash out; an audio clip's samples from --assets
{
  const s = all.find((x) => x.name === 'demo');
  const song = path.join(OUT, 'demo.json'),
    wav = path.join(OUT, 'demo.wav');
  fs.writeFileSync(song, JSON.stringify(s.project));
  const run = (...a) => spawnSync(process.execPath, [path.join(HERE, 'render.js'), ...a], { encoding: 'utf8' });
  const r = run(song, '--out', wav, '--hash', '--measure', '--json');
  let j = null;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    /* below */
  }
  t.ok(
    r.status === 0 && j && j.sha256 === fresh.demo.sha256,
    `tools/render.js demo.json --hash: ${j && j.sha256 && j.sha256.slice(0, 16)} (exit ${r.status})`,
  );
  t.ok(
    j && j.measure && j.measure.lufs === fresh.demo.lufs,
    `--measure prints measure(): ${j && j.measure && j.measure.lufs} LUFS`,
  );
  t.ok(/graph device/.test(r.stderr), 'the bypassed graph devices are warned about on stderr');
  const w = fs.existsSync(wav) ? fs.readFileSync(wav) : null;
  const back = w && decodeWav(w);
  t.ok(
    w && w.readUInt16LE(34) === 24 && back.sr === 48000 && back.channels[0].length === fresh.demo.frames,
    `the WAV is 24-bit, 48 kHz, ${back && back.channels[0].length} frames`,
  );
  let err = 0;
  if (back) {
    const ch = renders.get('demo').channels;
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < ch[c].length; i++) err = Math.max(err, Math.abs(ch[c][i] - back.channels[c][i]));
  }
  t.ok(back && err < 2 / 8388607, `the WAV holds the render to 24 bits (worst error ${fmtDb(dbfs(err))} dBFS)`);
  const strict = run(song, '--strict', '--no-wav');
  t.ok(strict.status === 1, `--strict exits 1 when graph devices were bypassed (exit ${strict.status})`);
  const part = run(song, '--tracks', 'Bass,Keys', '--to', '8', '--no-wav', '--json');
  let pj = null;
  try {
    pj = JSON.parse(part.stdout);
  } catch {
    /* below */
  }
  t.ok(
    part.status === 0 && pj && pj.warnings.length === 0 && pj.seconds > 5,
    `--tracks Bass,Keys --to 8: ${pj && pj.seconds} s, no warnings (the guitar isn't built)`,
  );
  // an effect scene from files: the DI strum as a float WAV in an assets folder
  const fx = all.find((x) => x.name === 'fx:core.delay');
  const dir = path.join(OUT, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, a] of Object.entries(fx.assets)) writeWav(path.join(dir, id + '.wav'), a, { float: true });
  const fxSong = path.join(OUT, 'delay.json');
  fs.writeFileSync(fxSong, JSON.stringify(fx.project));
  const fr = run(fxSong, '--assets', dir, '--to', '16', '--tail', '4', '--hash', '--no-wav', '--json');
  let fj = null;
  try {
    fj = JSON.parse(fr.stdout);
  } catch {
    /* below */
  }
  t.ok(
    fj && fj.sha256 === fresh['fx:core.delay'].sha256,
    `--assets: the DI strum from a WAV renders fx:core.delay to its hash (${fj && fj.sha256 && fj.sha256.slice(0, 16)})`,
  );
  const enc = decodeWav(encodeWav({ sr: 48000, channels: [Float32Array.of(0, 0.5, -0.5, 1, -1)] }));
  t.ok(
    enc.channels[0][1] > 0.49999 && enc.channels[0][4] === (-1 * 8388607) / 8388608,
    'WAV encode/decode round-trips',
  );
}

// ------------------------------------------------------------------------------------------------ browser parity
if (process.env.NODE_ONLY || updating !== undefined) {
  t.note('browser parity skipped (' + (process.env.NODE_ONLY ? 'NODE_ONLY' : 'UPDATE_GOLDEN') + ')');
} else {
  console.log(`browser preview vs canonical (OfflineAudioContext in Chromium; within ${PARITY_DB} dBFS)`);
  const { open } = await import('./pw.js');
  const { page, close, errors } = await open('/app/', { query: 'new' });
  try {
    await page.waitForFunction(() => window.overdub && window.overdub.store, null, { timeout: 30000 });
    const b64 = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
    const unb64 = (s) => {
      const b = Buffer.from(s, 'base64');
      return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    };
    let exact = 0,
      n = 0;
    t0 = Date.now();
    for (const s of all.filter((x) => x.browser)) {
      const r = renders.get(s.name);
      const assets = Object.fromEntries(
        Object.entries(s.assets).map(([k, a]) => [k, { sr: a.sr, channels: a.channels.map(b64) }]),
      );
      const out = await page.evaluate(
        async ({ project, opts, assets }) => {
          const { renderProject } = await import('/app/src/engine/render.js');
          const { cleanProject } = await import('/app/src/core/project.js');
          const reg = await import('/app/src/devices/registry.js');
          for (const d of Object.values(project.devices || {}))
            reg.defineDevice({ ...d, source: 'project' }, { replace: true });
          const dec = (s) => {
            const b = atob(s),
              u = new Uint8Array(b.length);
            for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
            return new Float32Array(u.buffer);
          };
          const bufs = {};
          for (const [k, a] of Object.entries(assets)) {
            const ch = a.channels.map(dec);
            const ab = new AudioBuffer({ length: ch[0].length, numberOfChannels: ch.length, sampleRate: a.sr });
            ch.forEach((c, i) => ab.copyToChannel(c, i));
            bufs[k] = ab;
          }
          const report = [];
          const buf = await renderProject(cleanProject(project), {
            ...opts,
            assets: { get: async (id) => bufs[id] || null },
            report: (e) => report.push(e),
          });
          const enc = (f) => {
            const u = new Uint8Array(f.buffer);
            let s = '';
            for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
            return btoa(s);
          };
          return {
            report,
            len: buf.length,
            sr: buf.sampleRate,
            ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))],
          };
        },
        { project: s.project, opts: s.opts, assets },
      );
      const ch = out.ch.map(unb64);
      let worst = 0,
        diff = 0;
      for (let c = 0; c < 2; c++) {
        const a = ch[c],
          b = r.channels[c],
          m = Math.min(a.length, b.length);
        for (let i = 0; i < m; i++) {
          const d = Math.abs(a[i] - b[i]);
          if (d) {
            diff++;
            if (d > worst) worst = d;
          }
        }
      }
      n++;
      if (!diff) exact++;
      t.ok(
        out.len === r.length && out.sr === r.sr && !out.report.length && dbfs(worst) <= PARITY_DB,
        `${s.name}: browser and Node differ by at most ${fmtDb(dbfs(worst))} dBFS (${diff ? diff + ' samples differ' : 'bit-identical'})${out.report.length ? ' REPORT ' + JSON.stringify(out.report) : ''}`,
      );
    }
    t.note(
      `${exact} of ${n} scenes bit-identical between Chromium and Node (the rest differ by a last-bit rounding: Chromium's V8 and Node's round Math.exp, sin, tanh... differently for a few % of inputs) in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
    t.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await close();
  }
}
t.done();
