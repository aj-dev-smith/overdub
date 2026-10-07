// Fetch and build the sampled kits (kernel data: docs/DEVICES.md, "Kernel data"). The audio stays out of git: this
// downloads the pinned upstream files (by commit), checks each one's SHA-256, decodes them (tools/flac.js, held to each
// file's own MD5), trims and converts them the same way every time, and writes the .odk container to app/kits/
// (gitignored), named by the SHA-256 of its bytes. deploy/deploy.sh uploads app/kits/.
//
//   node tools/fetch-kits.js            fetch and build every kit a device names; fails unless the build is the pinned one
//   node tools/fetch-kits.js --check    say whether the pinned kit is here (and is its own hash), build nothing:
//                                       exit 0 here, 1 missing or wrong
//   node tools/fetch-kits.js --verify   build from the download cache alone (no network) and compare with the pinned
//                                       hash, writing nothing: exit 0 the same, 1 different, 2 the cache is incomplete
//
// The downloads are cached in tools/.out/kits-cache/ (by SHA-256), so a rebuild is offline. The build is deterministic:
// the same upstream bytes give the same .odk bytes (integer arithmetic only, fixed key order), so the hash a device
// pins (KIT_HASH in app/src/devices/builtin/drumkit.js) is reproducible by anyone with this script.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeFlac } from './flac.js';
import { encodeOdk, dataFile } from '../app/src/kernel/odk.js';
import { KIT_HASH } from '../app/src/devices/builtin/drumkit.js';
import { RECIPE as KIT_RECIPE } from './kits/virtuosity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const KITS = path.join(ROOT, 'app', 'kits');
const CACHE = path.join(HERE, '.out', 'kits-cache');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// The tail is cut after the last 20 ms window whose RMS (either channel) is at or above -70 dBFS: on a 24-bit scale,
// 8388608 * 10^(-70/20) = 2652.7. Then a 10 ms linear fade. (Windows, not single samples: a lone click in the room's
// noise floor would otherwise keep seconds of hiss.)
const TRIM_24 = 2653;
const WIN = 960;
const FADE = 480;

let OFFLINE = false;
async function fetchFile(recipe, file, want = recipe.files[file]) {
  const cached = path.join(CACHE, want + path.extname(file));
  if (fs.existsSync(cached)) {
    const b = fs.readFileSync(cached);
    if (sha256(b) === want) return b;
  }
  if (OFFLINE) throw Object.assign(new Error(`${file} isn't in the download cache`), { code: 'NOCACHE' });
  const url = `https://raw.githubusercontent.com/${recipe.repo}/${recipe.commit}/${file.split('/').map(encodeURIComponent).join('/')}`;
  let b = null, err = null;
  for (let attempt = 0; attempt < 3 && !b; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      b = Buffer.from(await r.arrayBuffer());
    } catch (e) { err = e; }
  }
  if (!b) throw new Error(`could not download ${url}: ${err && err.message}`);
  const got = sha256(b);
  if (got !== want) throw new Error(`${file}: SHA-256 ${got}, pinned ${want} (the upstream file changed, or the download is bad)`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cached, b);
  return b;
}

// 24-bit stereo in, trimmed (above), 16-bit out. Integer samples, IEEE doubles in a fixed order: the same bytes on any
// engine.
function trim16(d) {
  const [L, R] = d.channels.length > 1 ? d.channels : [d.channels[0], d.channels[0]];
  const shift = 24 - d.bits; // (a 16-bit source is scaled up to 24 bits first)
  const at = (x, i) => x[i] * (1 << shift);
  const T2 = TRIM_24 * TRIM_24 * WIN;
  let end = 0;
  for (let a = Math.floor(d.frames / WIN) * WIN; a >= 0 && !end; a -= WIN) {
    let el = 0, er = 0;
    for (let i = a; i < Math.min(d.frames, a + WIN); i++) { const l = at(L, i), r = at(R, i); el += l * l; er += r * r; }
    if (el >= T2 || er >= T2) end = Math.min(d.frames, a + WIN);
  }
  const frames = Math.min(d.frames, end + FADE), fade = frames - end;
  const out = [new Int16Array(frames), new Int16Array(frames)];
  [L, R].forEach((x, c) => {
    for (let i = 0; i < frames; i++) {
      let v = at(x, i);
      if (i >= end && fade > 0) v = Math.round(v * (frames - i) / (fade + 1));
      v = Math.round(v / 256);
      out[c][i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  });
  return { ch: out, frames, cut: d.frames - frames };
}

// Where a stroke starts, for the kernel (each sample's `start` in the header): 2 ms before it first comes within 20 dB
// of its peak, so the overheads' flight time and, on the pedal, the foot's travel before the plates meet, are skipped
// and every stroke lands on its note. Worked out here, once per kit, so a kernel's create() doesn't scan 6 million
// frames on the audio thread. Integers only.
function startOf(ch, frames, sr) {
  const [L, R] = [ch[0], ch[1] || ch[0]];
  let pk = 0;
  for (let i = 0; i < frames; i++) { const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i]; if (a > pk) pk = a; if (b > pk) pk = b; }
  let on = 0;
  while (on < frames && Math.abs(L[on]) * 10 < pk && Math.abs(R[on]) * 10 < pk) on++;
  return Math.max(0, on - Math.round(0.002 * sr));
}

async function build(recipe) {
  // the licence first: the kit is built only from the commit whose LICENSE is the CC0 text pinned here
  const lic = await fetchFile(recipe, recipe.licenceFile.path, recipe.licenceFile.sha256);
  if (!/CC0 1\.0 Universal/.test(lic.toString('utf8'))) throw new Error('the pinned LICENSE is not CC0 1.0 Universal');
  const samples = [];
  let n = 0, inFrames = 0, outFrames = 0;
  for (const piece of recipe.pieces) {
    piece.layers.forEach((layer, li) => {
      layer.files.forEach((file, rr) => samples.push({ piece: piece.id, layer: li, rr, vel: layer.vel, file }));
    });
  }
  const out = [];
  for (const s of samples) {
    const b = await fetchFile(recipe, s.file);
    const d = decodeFlac(b);
    if (d.sr !== recipe.sr) throw new Error(`${s.file}: ${d.sr} Hz, the kit is ${recipe.sr} Hz`);
    const t = trim16(d);
    inFrames += d.frames; outFrames += t.frames;
    out.push({ id: `${s.piece}.${s.layer}.${s.rr}`, piece: s.piece, layer: s.layer, rr: s.rr, vel: s.vel, start: startOf(t.ch, t.frames, recipe.sr), src: s.file, ch: t.ch });
    ++n;
    if (process.stdout.isTTY) process.stdout.write(`\r  ${n}/${samples.length} ${s.file.slice(-44).padEnd(44)}`);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  const meta = { source: recipe.source, repo: recipe.repo, commit: recipe.commit, licence: recipe.licence, credit: recipe.credit, trim: 'after the last 20 ms window at or above -70 dBFS RMS, then a 10 ms linear fade; 24-bit to 16-bit by rounding' };
  const bytes = encodeOdk({ name: recipe.name, sr: recipe.sr, bits: 16, channels: 2, meta, samples: out });
  return { bytes, hash: 'sha256-' + sha256(bytes), count: out.length, inFrames, outFrames };
}

async function main() {
  const check = process.argv.includes('--check'), verify = process.argv.includes('--verify');
  const file = path.join(ROOT, 'app', dataFile(KIT_HASH));
  if (check) {
    const here = fs.existsSync(file) && 'sha256-' + sha256(fs.readFileSync(file)) === KIT_HASH;
    console.log(`${KIT_RECIPE.name}: ${here ? 'here' : fs.existsSync(file) ? 'NOT the pinned file' : 'not fetched'} (${path.relative(ROOT, file)})`);
    if (!here) process.exitCode = 1;
    return;
  }
  console.log(`${KIT_RECIPE.name}: ${KIT_RECIPE.repo} at ${KIT_RECIPE.commit.slice(0, 12)} (${KIT_RECIPE.licence})`);
  if (verify) {
    OFFLINE = true;
    let r;
    try { r = await build(KIT_RECIPE); } catch (e) { console.log('  ' + e.message); process.exitCode = e.code === 'NOCACHE' ? 2 : 1; return; }
    console.log(r.hash === KIT_HASH ? `  ok rebuilt from the cache: ${r.hash}, the pinned kit` : `  FAIL rebuilt ${r.hash}; the device pins ${KIT_HASH}`);
    process.exitCode = r.hash === KIT_HASH ? 0 : 1;
    return;
  }
  const r = await build(KIT_RECIPE);
  fs.mkdirSync(KITS, { recursive: true });
  const outFile = path.join(ROOT, 'app', dataFile(r.hash));
  fs.writeFileSync(outFile, r.bytes);
  const mb = (x) => (x / 1048576).toFixed(1) + ' MB';
  console.log(`  ${r.count} samples, ${(r.outFrames / KIT_RECIPE.sr).toFixed(1)} s of stereo (trimming cut ${(100 * (1 - r.outFrames / r.inFrames)).toFixed(0)}%), ${mb(r.bytes.length)}`);
  console.log(`  wrote ${path.relative(ROOT, outFile)}`);
  if (r.hash !== KIT_HASH) {
    console.log(`  FAIL the build is ${r.hash}; the device pins ${KIT_HASH}`);
    process.exitCode = 1;
  } else console.log('  ok the build is the pinned kit, byte for byte');
}

main().catch((e) => { console.error('fetch-kits: ' + e.message); process.exitCode = 1; });
