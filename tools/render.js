// Render a song with the canonical Node renderer (app/src/engine/node/render.js): the same kernels the studio's
// AudioWorklet runs, sample by sample, no browser. What it writes is the reference; the studio's playback and its
// OfflineAudioContext renders are the preview (measured to agree within -90 dBFS for kernel devices).
//
//   node tools/render.js song.json [--out song.wav] [--from 0 --to 32] [--tracks Bass,Keys] [--measure] [--hash]
//                                  [--tail 2] [--assets dir] [--strict] [--json] [--no-wav]
//   node tools/render.js --scene demo [...]          a fixed scene from tools/golden-scenes.js ('--scene list' lists them)
//
//   song.json     a saved song (the project JSON the studio exports; { project } or { song } wrappers are fine)
//   --out         where the 24-bit WAV goes (default: next to the song, <name>.wav)
//   --from/--to   beats (default: the whole song); --tail seconds after `to` (default 2)
//   --tracks      track names or ids, comma separated (default: what the mixer would play: mute and solo apply)
//   --assets dir  audio clips' samples as <assetId>.wav in dir (the studio keeps them in IndexedDB)
//   --measure     print measure() (app/src/audio/measure.js: LUFS, true peak, bands, key...) as JSON
//   --hash        print the SHA-256 of the float samples (channel 0 then 1, Float32 little-endian): the render's identity
//   --strict      fail (exit 1) if any device had to be skipped or bypassed (graph devices, missing ones)
//   --json        one JSON object on stdout: { file, seconds, sha256?, measure?, warnings, skipped }
//
// Graph devices (the pedals and amps) can't run outside a browser: an insert that uses one is bypassed and a track
// whose instrument is one is skipped, each with a warning on stderr.
//
// A song's kernels are code from whoever wrote the song, and here they run in Node, not a worklet. A song file is
// rendered in a sandbox (tools/node-permissions.js: Node's permission model; it reads app/, this script, the song and
// --assets and nothing else in the checkout, writes only the WAV, spawns nothing; the network stays open, since Node
// 24's model doesn't cover it). OVERDUB_TRUST_KERNELS=1 renders in-process, for files you'd run as code.
import path from 'node:path';
import { renderSong } from '../app/src/engine/node/render.js';
import { readSong, writeWav, sha256, readAssets } from '../app/src/engine/node/io.js';
import { measure } from '../app/src/audio/measure.js';
import { sandboxed } from './node-permissions.js';

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      o._.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split('=');
    if (['measure', 'hash', 'strict', 'json', 'no-wav', 'help'].includes(k)) o[k] = true;
    else o[k] = v != null ? v : argv[++i];
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.help || (!o._.length && !o.scene)) {
    console.log(
      'usage: node tools/render.js song.json [--out song.wav] [--from 0 --to 32] [--tracks Bass,Keys] [--measure] [--hash] [--tail 2] [--assets dir] [--strict] [--json] [--no-wav]',
    );
    console.log('       node tools/render.js --scene <name | list> [...]');
    process.exitCode = o.help ? 0 : 1;
    return;
  }
  if (!o.scene) {
    const file = path.resolve(o._[0]);
    await sandboxed(import.meta.url, {
      reads: [file, o.assets],
      writes: o['no-wav'] ? [] : [o.out || file.replace(/\.json$/i, '') + '.wav'],
    });
  }
  let project,
    assets = null,
    base,
    scene = null;
  if (o.scene) {
    const { scenes } = await import('./golden-scenes.js');
    const all = scenes();
    if (o.scene === 'list') {
      for (const s of all) console.log(s.name);
      return;
    }
    scene = all.find((s) => s.name === o.scene);
    if (!scene) throw new Error(`no scene "${o.scene}" (--scene list)`);
    project = scene.project;
    assets = scene.assets;
    base = path.resolve(scene.name.replace(/[^a-z0-9.-]+/gi, '-'));
  } else {
    const file = path.resolve(o._[0]);
    project = readSong(file);
    base = file.replace(/\.json$/i, '');
    if (o.assets) assets = readAssets(path.resolve(o.assets), project);
  }
  const num = (v, d) => (v == null ? d : Number(v));
  const opts = {
    from: num(o.from, scene ? scene.opts.from : 0),
    to: o.to != null ? Number(o.to) : scene ? scene.opts.to : undefined,
    tail: num(o.tail, scene ? scene.opts.tail : 2),
    tracks: o.tracks
      ? String(o.tracks)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
    assets,
  };
  const t0 = Date.now();
  const r = renderSong(project, opts);
  const ms = Date.now() - t0;
  const secs = r.length / r.sr;
  const out = o['no-wav'] ? null : path.resolve(o.out || base + '.wav');
  if (out) writeWav(out, r, { bits: 24 });
  const result = {
    file: out,
    seconds: +secs.toFixed(3),
    beats: [r.from, r.to],
    ms,
    warnings: r.warnings,
    skipped: r.skipped,
  };
  if (o.hash) result.sha256 = sha256(r);
  if (o.measure) result.measure = measure({ sr: r.sr, channels: r.channels });
  for (const w of r.warnings)
    console.error('warning: ' + (w.track ? `[${w.track}${w.insert ? ' ' + w.insert : ''}] ` : '') + w.message);
  if (o.json) console.log(JSON.stringify(result, null, 2));
  else {
    const title = project.title ? `"${project.title}"` : 'the song';
    console.log(
      `${title}: beats ${r.from}–${r.to} (+${opts.tail} s tail), ${secs.toFixed(2)} s at ${r.sr / 1000} kHz, rendered in ${ms} ms${out ? ` -> ${path.relative(process.cwd(), out) || out} (24-bit WAV)` : ''}`,
    );
    if (r.skipped.tracks.length || r.skipped.inserts.length)
      console.log(
        `skipped tracks: ${r.skipped.tracks.join(', ') || 'none'}; bypassed inserts: ${r.skipped.inserts.join(', ') || 'none'}`,
      );
    if (result.measure) console.log('measure ' + JSON.stringify(result.measure, null, 2));
    if (result.sha256) console.log('sha256 ' + result.sha256);
  }
  if (o.strict && (r.skipped.tracks.length || r.skipped.inserts.length)) {
    console.error(
      `--strict: ${r.skipped.tracks.length} track(s) skipped and ${r.skipped.inserts.length} insert(s) bypassed`,
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('render: ' + ((e && e.message) || e));
  process.exitCode = 1;
});
