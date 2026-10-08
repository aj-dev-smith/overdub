// Fetch and build the sampled kits (kernel data: docs/DEVICES.md, "Kernel data"). The audio stays out of git: this
// downloads the pinned upstream files (by commit), checks each one's SHA-256, decodes them (tools/flac.js, held to each
// file's own MD5), trims and converts them the same way every time, and writes the .odk container to app/kits/
// (gitignored), named by the SHA-256 of its bytes, and beside it the packed transfer copy, <hex>.odkz (kernel/odkz.js:
// lossless, about two thirds the size once gzipped; the studio fetches it first and unpacks it back to the .odk).
// deploy/deploy.sh uploads app/kits/.
//
//   node tools/fetch-kits.js            fetch and build every kit a device names; fails unless the build is the pinned one
//                                       (a pinned kit already here is not rebuilt: only its .odkz is written again)
//   node tools/fetch-kits.js --rebuild  build every kit from its upstream files even when it is here
//   node tools/fetch-kits.js --check    say whether each pinned kit is here (and is its own hash) with its .odkz (which
//                                       unpacks to it), build nothing: exit 0 here, 1 missing or wrong
//   node tools/fetch-kits.js --verify   build from the download cache alone (no network) and compare with the pinned
//                                       hash, writing nothing: exit 0 the same, 1 different, 2 the cache is incomplete
//   node tools/fetch-kits.js ... rusty  any of the above for the kits whose name or repo has that word in it (any case)
//   ... --only <name>                   the same: just the kits whose recipe name or repo contains <name>
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
import { packOdk, unpackOdk } from '../app/src/kernel/odkz.js';
import zlib from 'node:zlib';
import { KIT_HASH } from '../app/src/devices/builtin/drumkit.js';
import { RECIPE as KIT_RECIPE } from './kits/virtuosity.js';
import { RECIPE as UPRIGHT_RECIPE } from './kits/upright-kw.js';
import { UPRIGHT_HASH } from '../app/src/devices/builtin/upright.js';
import { RECIPE as BRUSH_RECIPE } from './kits/big-rusty.js';
import { BRUSH_HASH } from '../app/src/devices/builtin/brushkit.js';
import { RECIPE as HAND_RECIPE } from './kits/vcsl-hand.js';
import { HAND_HASH } from '../app/src/devices/builtin/handkit.js';
import { qaSample, qaInstrument } from './kits/qa.js';
import { buildInstrument } from './kits/build.js';
import { RECIPE as GRAND_RECIPE } from './kits/salamander.js';
import { GRAND_HASH } from '../app/src/devices/builtin/grand.js';
import { RECIPE as ENSEMBLE_RECIPE } from './kits/vsco-strings.js';
import { ENSEMBLE_HASH } from '../app/src/devices/builtin/ensemble.js';
import { RECIPE as VIBES_RECIPE } from './kits/vcsl-vibes.js';
import { VIBES_HASH } from '../app/src/devices/builtin/vibes.js';
import { RECIPE as EBASS_RECIPE } from './kits/karoryfer-bass.js';
import { EBASS_HASH } from '../app/src/devices/builtin/ebass.js';
import { RECIPE as EGUITAR_RECIPE } from './kits/karoryfer-guitar.js';
import { EGUITAR_HASH } from '../app/src/devices/builtin/eguitar.js';
import { RECIPE as BARISAX_RECIPE } from './kits/karoryfer-barisax.js';
import { BARISAX_HASH } from '../app/src/devices/builtin/barisax.js';
import { RECIPE as CELLO_RECIPE } from './kits/karoryfer-cello.js';
import { CELLO_HASH } from '../app/src/devices/builtin/cello.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const KITS_DIR = path.join(ROOT, 'app', 'kits');
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

// A WAV file (integer PCM, 16 or 24-bit, any channel count) -> { sr, bits, frames, channels: [Int32Array, ...] }, as
// decodeFlac gives. Some upstream sets keep their long samples as WAV (Big Rusty's brush stirs).
export function decodeWav(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = b.subarray(o + 8, o + 8 + n);
    else if (id === 'data') data = b.subarray(o + 8, Math.min(b.length, o + 8 + n));
    o += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error('a WAV file without fmt or data');
  const tag = fmt.readUInt16LE(0), ch = fmt.readUInt16LE(2), sr = fmt.readUInt32LE(4), bits = fmt.readUInt16LE(14);
  if ((tag !== 1 && tag !== 0xfffe) || (bits !== 16 && bits !== 24)) throw new Error(`a WAV file I can't read (format ${tag}, ${bits}-bit)`);
  const bps = bits / 8, frames = Math.floor(data.length / (bps * ch));
  const channels = Array.from({ length: ch }, () => new Int32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) { const p = (i * ch + c) * bps; channels[c][i] = bits === 24 ? data.readIntLE(p, 3) : data.readInt16LE(p); }
  return { sr, bits, frames, channels };
}
const decodeAny = (file, b) => (/\.wav$/i.test(file) ? decodeWav(b) : decodeFlac(b));

// 24-bit stereo in, trimmed (above), 16-bit out. Integer samples, IEEE doubles in a fixed order: the same bytes on any
// engine. keep: frames that stay whatever their level (a loop's end); no fade then, as the loop never reaches it.
// thr: the trim threshold on the 24-bit scale (a recipe's piece may set its own, `trim` in dBFS).
function trim16(d, keep = 0, thr = TRIM_24) {
  const [L, R] = d.channels.length > 1 ? d.channels : [d.channels[0], d.channels[0]];
  const shift = 24 - d.bits; // (a 16-bit source is scaled up to 24 bits first)
  const at = (x, i) => x[i] * (1 << shift);
  const T2 = thr * thr * WIN;
  let end = 0;
  for (let a = Math.floor(d.frames / WIN) * WIN; a >= 0 && !end; a -= WIN) {
    let el = 0, er = 0;
    for (let i = a; i < Math.min(d.frames, a + WIN); i++) { const l = at(L, i), r = at(R, i); el += l * l; er += r * r; }
    if (el >= T2 || er >= T2) end = Math.min(d.frames, a + WIN);
  }
  if (keep > 0) end = Math.max(end, Math.min(d.frames, keep));
  const frames = keep > 0 && end === Math.min(d.frames, keep) ? end : Math.min(d.frames, end + FADE), fade = frames - end;
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

// A drum kit: each piece's velocity layers of strokes, in the recipe's order. A piece may set its own trim (`trim`, dBFS:
// the default is -70), a longest stroke (`max`, seconds: cut there with a `fadeMs` linear fade, default 50 ms), or a
// loop (`loop: { at, len, xfade }`, seconds: a sustained articulation such as a brush stir, rung while its note is
// held; the loop's last `xfade` seconds are crossfaded at equal power with what came before its start, so the jump
// back is seamless, and the four frames after the loop's end repeat its start for the interpolator). A recipe with
// `qa: true` runs the QA rubric on every stroke (tools/kits/qa.js) before anything is processed.
async function build(recipe) {
  // the licence first: the kit is built only from the commit whose LICENSE is the CC0 text pinned here
  const lic = await fetchFile(recipe, recipe.licenceFile.path, recipe.licenceFile.sha256);
  if (!/CC0 1\.0 Universal/.test(lic.toString('utf8'))) throw new Error('the pinned LICENSE is not CC0 1.0 Universal');
  const samples = [];
  let n = 0, inFrames = 0, outFrames = 0;
  for (const piece of recipe.pieces) {
    piece.layers.forEach((layer, li) => {
      layer.files.forEach((file, rr) => samples.push({ piece: piece.id, layer: li, rr, vel: layer.vel, file, opts: piece }));
    });
  }
  const out = [], rows = [];
  for (const s of samples) {
    const b = await fetchFile(recipe, s.file);
    const d = decodeAny(s.file, b);
    if (d.sr !== recipe.sr) throw new Error(`${s.file}: ${d.sr} Hz, the kit is ${recipe.sr} Hz`);
    if (recipe.qa) rows.push({ id: `${s.piece}.${s.layer}.${s.rr}`, key: recipe.pieces.findIndex((p) => p.id === s.piece), layer: s.layer, rr: s.rr, hash: sha256(b), qa: qaSample({ ch: d.channels, bits: d.bits, sr: d.sr }, { key: 60, tuning: false, looped: !!s.opts.loop }) });
    const o = s.opts, sr = recipe.sr;
    const thr = o.trim != null ? Math.round(8388608 * Math.pow(10, o.trim / 20)) : TRIM_24;
    let t, loop;
    if (o.loop) {
      const S = Math.round(o.loop.at * sr), E = S + Math.round(o.loop.len * sr), X = Math.round(o.loop.xfade * sr);
      if (S < X || E + 4 > d.frames) throw new Error(`${s.file}: the loop (${S}-${E}, crossfade ${X}) doesn't fit its ${d.frames} frames`);
      t = trim16(d, E + 4, thr);
      const ch = t.ch.map((c) => c.slice(0, E + 4));
      for (const c of ch) {
        const a = c.slice();
        for (let i = 0; i < X; i++) { const w = (i + 0.5) / X, j = E - X + i; c[j] = Math.round(a[j] * Math.sqrt(1 - w) + a[S - X + i] * Math.sqrt(w)); }
        for (let k = 0; k < 4; k++) c[E + k] = a[S + k];
      }
      t = { ch, frames: E + 4 };
      loop = { s: S, e: E };
    } else {
      t = trim16(d, 0, thr);
      const M = o.max ? Math.round(o.max * sr) : 0;
      if (M && t.frames > M) {
        const F = Math.round((o.fadeMs ?? 50) * sr / 1000);
        const ch = t.ch.map((c) => c.slice(0, M));
        for (const c of ch) for (let i = M - F; i < M; i++) c[i] = Math.round(c[i] * (M - i) / (F + 1));
        t = { ch, frames: M };
      }
    }
    inFrames += d.frames; outFrames += t.frames;
    out.push({ id: `${s.piece}.${s.layer}.${s.rr}`, piece: s.piece, layer: s.layer, rr: s.rr, vel: s.vel, start: startOf(t.ch, t.frames, recipe.sr), ...(loop ? { loop } : {}), src: s.file, ch: t.ch });
    ++n;
    if (process.stdout.isTTY) process.stdout.write(`\r  ${n}/${samples.length} ${s.file.slice(-44).padEnd(44)}`);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  const meta = { ...(recipe.kind ? { kind: recipe.kind } : {}), source: recipe.source, repo: recipe.repo, commit: recipe.commit, licence: recipe.licence, credit: recipe.credit,
    trim: recipe.trimNote || 'after the last 20 ms window at or above -70 dBFS RMS, then a 10 ms linear fade; 24-bit to 16-bit by rounding' };
  const bytes = encodeOdk({ name: recipe.name, sr: recipe.sr, bits: 16, channels: 2, meta, samples: out });
  return { bytes, hash: 'sha256-' + sha256(bytes), count: out.length, inFrames, outFrames, ...(recipe.qa ? { qa: qaInstrument(rows, recipe.waive || [], { drums: true }) } : {}) };
}

// ------------------------------------------------------------------------------------------------ melodic kits
// The plain SFZ a melodic recipe names: <global>, <group> and <region> headers (each inheriting the one above),
// `opcode=value` pairs (a sample's path runs to the end of its line), // comments. -> [{ opcode: value }] per region
export function parseSfz(text) {
  const regions = [], scope = { global: {}, group: {}, region: null };
  let cur = scope.global;
  const close = () => { if (scope.region) regions.push({ ...scope.global, ...scope.group, ...scope.region }); scope.region = null; };
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\/\/.*$/, '');
    const re = /<(\w+)>|([a-z0-9_]+)=/g;
    let m, pending = null, last = 0;
    const put = (end) => { if (pending) { cur[pending] = (pending === 'sample' ? line.slice(last, end) : line.slice(last, end).trim().split(/\s+/)[0]).trim(); pending = null; } };
    while ((m = re.exec(line))) {
      if (pending === 'sample') break;
      put(m.index);
      if (m[1]) {
        const h = m[1];
        if (h === 'global' || h === 'control') { close(); cur = scope.global; }
        else if (h === 'group' || h === 'master') { close(); scope.group = {}; cur = scope.group; }
        else if (h === 'region') { close(); scope.region = {}; cur = scope.region; }
        else { close(); cur = {}; }
      } else { pending = m[2]; last = re.lastIndex; }
    }
    put(line.length);
  }
  close();
  return regions;
}

const NOTE_NUM = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const noteOf = (v) => { if (/^-?\d+$/.test(v)) return +v; const m = /^([a-gA-G])(#|b)?(-?\d+)$/.exec(v); if (!m) throw new Error('sfz: a note I can\'t read: ' + v); return 12 * (+m[3] + 1) + NOTE_NUM[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
// the opcodes a region's mapping comes from; anything else is reported, never silently dropped
const USED = new Set(['sample', 'key', 'lokey', 'hikey', 'pitch_keycenter', 'lovel', 'hivel', 'loop_mode', 'loop_start', 'loop_end', 'fil_type', 'cutoff', 'ampeg_release']);

async function buildMelodic(recipe) {
  const lic = await fetchFile(recipe, recipe.licenceFile.path, recipe.licenceFile.sha256);
  if (!/CC0 1\.0 Universal/.test(lic.toString('utf8'))) throw new Error('the pinned LICENSE is not CC0 1.0 Universal');
  const readme = await fetchFile(recipe, recipe.readme.path, recipe.readme.sha256);
  if (!/Creative Commons CC0 public domain dedication/.test(readme.toString('utf8'))) throw new Error('the pinned README no longer dedicates it to CC0');
  const regions = parseSfz((await fetchFile(recipe, recipe.sfz.path, recipe.sfz.sha256)).toString('utf8'));
  const ignored = new Set();
  for (const r of regions) for (const k of Object.keys(r)) if (!USED.has(k)) ignored.add(`${k}=${r[k]}`);
  const rows = [], out = [];
  let inFrames = 0, outFrames = 0, release = null;
  for (const [n, r] of regions.entries()) {
    const file = r.sample.replace(/\\/g, '/');
    if (!recipe.files[file]) throw new Error(`the SFZ names ${file}, which the recipe doesn't pin`);
    const key = noteOf(r.pitch_keycenter ?? r.key ?? r.lokey);
    const lo = noteOf(r.lokey ?? r.key ?? key), hi = noteOf(r.hikey ?? r.key ?? key);
    const vlo = +(r.lovel ?? 0), vhi = +(r.hivel ?? 127);
    const looped = (r.loop_mode === 'loop_continuous' || r.loop_mode === 'loop_sustain') && r.loop_start != null && r.loop_end != null;
    if (r.ampeg_release != null) release = +r.ampeg_release;
    const d = decodeFlac(await fetchFile(recipe, file));
    if (d.sr !== recipe.sr) throw new Error(`${file}: ${d.sr} Hz, the kit is ${recipe.sr} Hz`);
    const qa = qaSample({ ch: d.channels, bits: d.bits, sr: d.sr }, { key, looped });
    // (SFZ loop_end is the loop's last frame; ours is one past it)
    const loop = looped ? { s: +r.loop_start, e: +r.loop_end + 1, mode: r.loop_mode === 'loop_sustain' ? 'sustain' : 'continuous' } : undefined;
    if (loop && loop.e > d.frames) throw new Error(`${file}: the loop ends at ${loop.e}, after the sample (${d.frames})`);
    const t = trim16(d, loop ? loop.e : 0);
    inFrames += d.frames; outFrames += t.frames;
    const layer = vlo > 0 ? 1 : 0;
    const id = `${file.replace(/^.*\//, '').replace(/\.flac$/, '')}`;
    rows.push({ id, key, layer, src: file, qa });
    out.push({ id, key, lo, hi, vlo, vhi, ...(loop ? { loop } : {}), ...(r.fil_type === 'lpf_2p' && r.cutoff ? { cutoff: +r.cutoff } : {}),
      tune: 0, gain: 0, start: startOf(t.ch, t.frames, recipe.sr), src: file, ch: t.ch });
    if (process.stdout.isTTY) process.stdout.write(`\r  ${n + 1}/${regions.length} ${file.slice(-44).padEnd(44)}`);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  // the layers of one key, aligned: a soft attack crosses the start threshold later than a hard one, so each soft
  // sample's start moves to where it lines up best with the hard sample of the same key (the lag, within 10 ms, that
  // maximizes their correlation over the first half second, mono). Two aligned layers add like one sound, so the
  // kernel crossfades them linearly instead of cancelling (measured: 0.8 to 0.97 correlated aligned, as low as -0.5
  // as they were). Integer arithmetic on the 16-bit samples.
  for (const a of out) {
    if (a.vlo !== 0) continue;
    const h = out.find((c) => c !== a && c.key === a.key && c.vlo > 0);
    if (!h) continue;
    const N = Math.min(Math.round(0.5 * recipe.sr), a.ch[0].length - a.start - 1000, h.ch[0].length - h.start - 1000), M = Math.round(0.01 * recipe.sr);
    let best = 0, lag = 0;
    for (let l = -M; l <= M; l++) {
      if (a.start + l < 0) continue;
      let xy = 0, xx = 0, yy = 0;
      for (let i = 0; i < N; i++) { const x = a.ch[0][a.start + l + i] + a.ch[1][a.start + l + i], y = h.ch[0][h.start + i] + h.ch[1][h.start + i]; xy += x * y; xx += x * x; yy += y * y; }
      const r = xy / Math.sqrt(xx * yy || 1);
      if (r > best) { best = r; lag = l; }
    }
    a.start += lag;
    a.align = Math.round(100 * best) / 100;
  }
  // gain: the files are peak-normalized, so their attacks sit at whatever level that left them. Each sample is set on
  // one smooth curve across the keyboard (a least-squares quadratic in the key through the hard layer's attack
  // levels), so neighbouring zones and the two layers of a key meet at one level; the velocity curve then makes the
  // dynamics (the SFZ's own default: 40 log10(vel / 127)). Rounded to 0.01 dB.
  const hard = rows.filter((r) => r.layer === 1);
  const fit = quadFit(hard.map((r) => r.key), hard.map((r) => r.qa.attack));
  rows.forEach((r, i) => { out[i].gain = Math.round(100 * (fit(r.key) - r.qa.attack)) / 100; r.gain = out[i].gain; });
  const qa = qaInstrument(rows, recipe.waive || []);
  const meta = { kind: 'melodic', source: recipe.source, repo: recipe.repo, commit: recipe.commit, licence: recipe.licence, credit: recipe.credit,
    sfz: recipe.sfz.path, env: { r: release ?? 0.6 },
    trim: 'after the last 20 ms window at or above -70 dBFS RMS, then a 10 ms linear fade (a looped sample: kept to its loop end); 24-bit to 16-bit by rounding; kept at 44.1 kHz',
    gain: 'each sample set on one quadratic across the keys through the hard layer\'s attack levels (RMS of 150 ms from the onset)',
    ignored: [...ignored].sort() };
  const bytes = encodeOdk({ name: recipe.name, sr: recipe.sr, bits: 16, channels: 2, meta, samples: out });
  return { bytes, hash: 'sha256-' + sha256(bytes), count: out.length, inFrames, outFrames, qa };
}

// y ~ a + b x + c x^2, least squares (normal equations, Cramer's rule): the fitted function
function quadFit(xs, ys) {
  let n = 0, sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  xs.forEach((x0, i) => { const x = (x0 - 64) / 32, y = ys[i]; n++; sx += x; sx2 += x * x; sx3 += x ** 3; sx4 += x ** 4; sy += y; sxy += x * y; sx2y += x * x * y; });
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [[n, sx, sx2], [sx, sx2, sx3], [sx2, sx3, sx4]], D = det3(M), Y = [sy, sxy, sx2y];
  const col = (k) => det3(M.map((row, i) => row.map((v, j) => (j === k ? Y[i] : v)))) / D;
  const a = col(0), b = col(1), c = col(2);
  return (x0) => { const x = (x0 - 64) / 32; return a + b * x + c * x * x; };
}

const printQa = (qa) => { for (const [c, v, why] of qa.verdicts) console.log(`  qa ${c.padEnd(22)} ${v.padEnd(7)} ${why}`); };

// the packed twin of an .odk (kernel/odkz.js), written beside it; returns its size and both gzipped sizes
function writePacked(file, bytes) {
  const z = packOdk(bytes);
  fs.writeFileSync(file + 'z', z);
  const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
  return { odk: bytes.length, odkz: z.length, gzOdk: gz(bytes), gzOdkz: gz(z) };
}
const mb = (x) => (x / 1e6).toFixed(2) + ' MB';
const sizes = (s) => `${mb(s.gzOdk)} gzipped as .odk, ${mb(s.gzOdkz)} as .odkz (${(100 * (1 - s.gzOdkz / s.gzOdk)).toFixed(0)}% less)`;

// a recipe that lays out its own regions (tools/kits/build.js)
async function buildLaidOut(recipe) {
  const r = await buildInstrument(recipe, fetchFile);
  return { ...r, hash: 'sha256-' + sha256(r.bytes) };
}

// every kit a device names: [recipe, the hash the device pins, how it's built]
const KITS = [[KIT_RECIPE, KIT_HASH, build], [UPRIGHT_RECIPE, UPRIGHT_HASH, buildMelodic], [BRUSH_RECIPE, BRUSH_HASH, build], [HAND_RECIPE, HAND_HASH, build],
  [GRAND_RECIPE, GRAND_HASH, buildLaidOut],
  [ENSEMBLE_RECIPE, ENSEMBLE_HASH, buildLaidOut], [VIBES_RECIPE, VIBES_HASH, buildLaidOut],
  [EBASS_RECIPE, EBASS_HASH, buildLaidOut], [EGUITAR_RECIPE, EGUITAR_HASH, buildLaidOut],
  [BARISAX_RECIPE, BARISAX_HASH, buildLaidOut],
  [CELLO_RECIPE, CELLO_HASH, buildLaidOut]];

async function one(recipe, pinned, make, { check, verify, rebuild }) {
  const file = path.join(ROOT, 'app', dataFile(pinned));
  if (check) {
    const here = fs.existsSync(file) && 'sha256-' + sha256(fs.readFileSync(file)) === pinned;
    let packed = false;
    try { packed = here && 'sha256-' + sha256(unpackOdk(fs.readFileSync(file + 'z'))) === pinned; } catch (e) { /* missing or bad */ }
    console.log(`${recipe.name}: ${here ? 'here' : fs.existsSync(file) ? 'NOT the pinned file' : 'not fetched'} (${path.relative(ROOT, file)}), .odkz ${packed ? 'here' : 'missing or wrong'}`);
    return here && packed ? 0 : 1;
  }
  console.log(`${recipe.name}: ${recipe.repo} at ${recipe.commit.slice(0, 12)} (${recipe.licence})`);
  if (verify) {
    OFFLINE = true;
    let r;
    try { r = await make(recipe); } catch (e) { console.log('  ' + e.message); return e.code === 'NOCACHE' ? 2 : 1; }
    console.log(r.hash === pinned ? `  ok rebuilt from the cache: ${r.hash}, the pinned kit` : `  FAIL rebuilt ${r.hash}; the device pins ${pinned}`);
    return r.hash === pinned ? 0 : 1;
  }
  if (!rebuild && fs.existsSync(file) && 'sha256-' + sha256(fs.readFileSync(file)) === pinned) {
    const s = writePacked(file, fs.readFileSync(file));
    console.log(`  here already (${path.relative(ROOT, file)}): wrote its .odkz; ${sizes(s)}`);
    return 0;
  }
  const r = await make(recipe);
  if (r.qa) {
    printQa(r.qa);
    // the report, one row per sample with every number (tools/.out/library/<repo>/qa.json)
    const dir = path.join(HERE, '.out', 'library', recipe.qaName || recipe.repo.replace(/\//g, '_'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'qa.json'), JSON.stringify({ kit: recipe.name, commit: recipe.commit, verdicts: r.qa.verdicts, rows: r.qa.rows }, null, 1) + '\n');
    console.log(`  the QA report: ${path.relative(ROOT, path.join(dir, 'qa.json'))}`);
  }
  fs.mkdirSync(KITS_DIR, { recursive: true });
  const outFile = path.join(ROOT, 'app', dataFile(r.hash));
  fs.writeFileSync(outFile, r.bytes);
  const s = writePacked(outFile, r.bytes);
  console.log(`  ${r.count} samples, ${(r.outFrames / recipe.sr).toFixed(1)} s of ${recipe.channels === 1 ? 'mono' : 'stereo'} (trimming cut ${(100 * (1 - r.outFrames / r.inFrames)).toFixed(0)}%), ${mb(r.bytes.length)}; ${sizes(s)}`);
  console.log(`  wrote ${path.relative(ROOT, outFile)} and its .odkz`);
  if (r.hash !== pinned) {
    console.log(`  FAIL the build is ${r.hash}; the device pins ${pinned}`);
    return 1;
  }
  console.log('  ok the build is the pinned kit, byte for byte');
  return 0;
}

async function main() {
  const flags = { check: process.argv.includes('--check'), verify: process.argv.includes('--verify'), rebuild: process.argv.includes('--rebuild') };
  let code = 0;
  // (names after the flags pick kits: `node tools/fetch-kits.js --verify rusty` is Rusty Brushes alone, as is
  // `--only rusty`; a name matches a recipe's name or repo, any case)
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => a.toLowerCase());
  for (const [recipe, pinned, make] of KITS) {
    if (only.length && !only.some((w) => recipe.name.toLowerCase().includes(w) || String(recipe.repo || '').toLowerCase().includes(w))) continue;
    code = Math.max(code, await one(recipe, pinned, make, flags));
  }
  process.exitCode = code;
}

main().catch((e) => { console.error('fetch-kits: ' + e.message); process.exitCode = 1; });
