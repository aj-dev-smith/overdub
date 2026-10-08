// Measure a folder of reference tracks for a genre's targets (app/src/audio/targets.js), numbers only.
//
//   OVERDUB_REFS=~/refs/bass-music node tools/genre-refs.js [--genre bass-music]
//
// The folder holds the tracks (WAV or FLAC; MP3, M4A and the like when ffmpeg is on the PATH, converted on the fly),
// loose or in a subfolder per subgenre (dubstep/, riddim/, dnb/, melodic/). For each track: the whole song's integrated
// loudness, true peak and PLR, and its drop: the loudest 16 s by short-term loudness, where the short-term loudness is
// at its loudest, the crest, the low end's mono-ness under 120 Hz and the band balance. Then, per subgenre and for all
// of them, each metric's median and interquartile range, and the range a target would take from them (the median +-
// max(2 dB, 1.5 x IQR)). Written to tools/.out/refs-<genre>.json. No audio, file name, title or artist is written
// anywhere: a track is "track 3 of 7" in the output, and nothing goes in the repo (tools/.out is ignored).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measure } from '../app/src/audio/measure.js';
import { decodeWav } from '../app/src/engine/node/io.js';
import { decodeFlac } from './flac.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const genre = (process.argv.includes('--genre') ? process.argv[process.argv.indexOf('--genre') + 1] : null) || 'bass-music';
const ROOT = process.env.OVERDUB_REFS ? path.resolve(process.env.OVERDUB_REFS.replace(/^~/, os.homedir())) : null;
if (!ROOT || !fs.existsSync(ROOT)) { console.log('genre-refs: set OVERDUB_REFS to a folder of reference tracks (WAV or FLAC; MP3 and M4A with ffmpeg on the PATH)'); process.exit(ROOT ? 1 : 0); }

const AUDIO = /\.(wav|flac|mp3|m4a|aac|ogg|aiff?)$/i;
function decode(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.wav') return decodeWav(fs.readFileSync(file));
  if (ext === '.flac') {
    const f = decodeFlac(fs.readFileSync(file)), k = 2 ** (f.bits - 1);
    return { sr: f.sr, channels: f.channels.map((c) => Float32Array.from(c, (v) => v / k)) };
  }
  // anything else: ffmpeg to a 32-bit float WAV, if it's here
  const tmp = path.join(os.tmpdir(), `genre-refs-${process.pid}.wav`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ac', '2', '-c:a', 'pcm_f32le', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('needs ffmpeg on the PATH to read this kind of file');
  try { return decodeWav(fs.readFileSync(tmp)); } finally { fs.rmSync(tmp, { force: true }); }
}
// the loudest window of `secs` by short-term loudness (3 s), stepped every second: [from, to] in seconds
function dropWindow(buf, secs = 16) {
  const dur = buf.channels[0].length / buf.sr;
  if (dur <= secs) return [0, dur];
  let best = 0, at = 0;
  for (let t = 0; t + secs <= dur; t += 1) {
    const m = measure(buf, { from: t, to: t + secs });
    if (m.lufsShortMax > best || at === 0 && t === 0) { best = m.lufsShortMax; at = t; }
  }
  return [at, at + secs];
}
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const quart = (xs, q) => { const s = xs.slice().sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };
const r2 = (x) => Math.round(x * 100) / 100;
function summary(rows) {
  const out = {};
  for (const k of Object.keys(rows[0] || {})) {
    const xs = rows.map((r) => r[k]).filter(Number.isFinite);
    if (!xs.length) continue;
    const med = median(xs), iqr = quart(xs, 0.75) - quart(xs, 0.25), w = Math.max(2, 1.5 * iqr);
    out[k] = { n: xs.length, median: r2(med), iqr: r2(iqr), range: [r2(med - w), r2(med + w)] };
  }
  return out;
}

const groups = new Map();
const walk = (dir, group) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, group || e.name.toLowerCase());
    else if (AUDIO.test(e.name)) { const g = group || 'all'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
  }
};
walk(ROOT, null);
const result = { genre, measured: new Date().toISOString().slice(0, 10), subgenres: {}, all: null, note: 'numbers only: no audio, names, titles or artists' };
const everyone = [];
for (const [g, files] of groups) {
  const rows = [];
  files.forEach((f, i) => {
    try {
      const buf = decode(f), song = measure(buf), [a, b] = dropWindow(buf), drop = measure(buf, { from: a, to: b });
      const row = { lufs: song.lufs, truePeak: song.truePeak, plr: r2(song.truePeak - song.lufs), lufsShortMax: drop.lufsShortMax, crest: drop.crest, lowSideDb: drop.lowSideDb, lowCorrelation: drop.lowCorrelation };
      for (const [k, v] of Object.entries(drop.bands || {})) row[k] = v;
      rows.push(row);
      console.log(`  ${g}: track ${i + 1} of ${files.length}: ${song.lufs} LUFS, drop ${drop.lufsShortMax} LUFS short-term, ${song.truePeak} dBTP`);
    } catch (e) { console.log(`  ${g}: track ${i + 1} of ${files.length}: skipped (${e.message})`); }
  });
  result.subgenres[g] = { count: rows.length, metrics: summary(rows) };
  everyone.push(...rows);
}
result.all = { count: everyone.length, metrics: summary(everyone) };
const out = path.join(HERE, '.out', `refs-${genre}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(`genre-refs: ${everyone.length} tracks in ${groups.size} group(s) -> ${path.relative(process.cwd(), out)}${everyone.length < 5 ? ' (five or more per subgenre replace a provisional range)' : ''}`);
