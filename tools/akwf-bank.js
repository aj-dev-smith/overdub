// Build Light Table's AKWF bank (app/src/devices/builtin/akwf.js) from the pinned upstream files in tools/kits/akwf.js.
// AKWF (Adventure Kid Waveforms, Kristoffer Ekstrand) is CC0 1.0: the 108 single cycles the bank holds are small enough
// to sit in git (about 90 KB of text), so Light Table plays them with no download and every song renders the same
// anywhere. This downloads each file from the pinned commit, checks its SHA-256 and the upstream LICENSE.md, reads the
// 16-bit samples, and writes the module the same way every time.
//
// The samples go into the kernel's own source (a kernel sees nothing else), and a kernel can be at most 256 KB, so they
// are packed losslessly: each sample less its prediction from the two before it (2 x[i-1] - x[i-2]; the first two from
// 0 and x[0]), zigzagged, written five bits a character, low bits first, in the base64 alphabet: 0-31 a last group,
// 32-63 a group with more to come. About 1.6 characters a sample, against 2.7 as plain base64.
//
//   node tools/akwf-bank.js                 fetch (or read the cache) and rewrite app/src/devices/builtin/akwf.js
//   node tools/akwf-bank.js --verify        rebuild from the download cache alone and compare with the committed module:
//                                           exit 0 the same, 1 different, 2 the cache is incomplete
//   node tools/akwf-bank.js --from <dir>    read the files from a local AKWF-FREE checkout instead (each still checked)
//   node tools/akwf-bank.js --pick <dir>    print how the waves were picked from a checkout (the list in the recipe):
//                                           per family, the cycles with a clear fundamental (harmonic 1 at least a fifth
//                                           of the strongest), then nine by farthest-point sampling on their first 48
//                                           harmonics in dB (from the median-brightness one), ordered dark to bright
//
// The downloads are cached in tools/.out/akwf-cache/ (by SHA-256).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RECIPE } from './kits/akwf.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'app', 'src', 'devices', 'builtin', 'akwf.js');
const CACHE = path.join(HERE, '.out', 'akwf-cache');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i < 0 ? null : (args[i + 1] || ''); };
const VERIFY = args.includes('--verify'), FROM = flag('--from'), PICK = flag('--pick');

async function getFile(file, want) {
  if (FROM != null) {
    const b = fs.readFileSync(path.join(FROM, file));
    if (sha256(b) !== want) throw new Error(`${file}: SHA-256 ${sha256(b)}, pinned ${want}`);
    return b;
  }
  const cached = path.join(CACHE, want + path.extname(file));
  if (fs.existsSync(cached)) { const b = fs.readFileSync(cached); if (sha256(b) === want) return b; }
  if (VERIFY) throw Object.assign(new Error(`${file} isn't in the download cache`), { code: 'NOCACHE' });
  const url = `https://raw.githubusercontent.com/${RECIPE.repo}/${RECIPE.commit}/${file.split('/').map(encodeURIComponent).join('/')}`;
  let b = null, err = null;
  for (let attempt = 0; attempt < 3 && !b; attempt++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); b = Buffer.from(await r.arrayBuffer()); } catch (e) { err = e; }
  }
  if (!b) throw new Error(`could not download ${url}: ${err && err.message}`);
  if (sha256(b) !== want) throw new Error(`${file}: SHA-256 ${sha256(b)}, pinned ${want} (the upstream file changed, or the download is bad)`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cached, b);
  return b;
}

// a RIFF WAVE file's 16-bit mono PCM (the chunks walked, so any extra chunk is skipped)
export function readWav(buf, name = 'wav') {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${name}: not a WAVE file`);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4), n = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(o + 8), ch: buf.readUInt16LE(o + 10), bits: buf.readUInt16LE(o + 22) };
    else if (id === 'data') data = buf.subarray(o + 8, Math.min(buf.length, o + 8 + n));
    o += 8 + n + (n & 1);
  }
  if (!fmt || !data || fmt.tag !== 1 || fmt.ch !== 1 || fmt.bits !== 16) throw new Error(`${name}: not 16-bit mono PCM`);
  const s = new Int16Array(data.length >> 1);
  for (let i = 0; i < s.length; i++) s[i] = data.readInt16LE(2 * i);
  return s;
}

// the packing (see the top): samples as int16 little-endian bytes <-> text, a cycle of n at a time
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function pack(pcm, n) {
  const N = pcm.length / 2, out = [];
  for (let i = 0; i < N; i++) {
    const j = i % n, x = pcm.readInt16LE(2 * i), p1 = j > 0 ? pcm.readInt16LE(2 * i - 2) : 0, p2 = j > 1 ? pcm.readInt16LE(2 * i - 4) : p1;
    const r = x - (j > 1 ? 2 * p1 - p2 : p1);
    let z = r < 0 ? -2 * r - 1 : 2 * r;
    while (z >= 32) { out.push(B64[32 + (z % 32)]); z = Math.floor(z / 32); }
    out.push(B64[z]);
  }
  return out.join('');
}
export function unpack(code, N, n) {
  const out = Buffer.alloc(2 * N);
  let c = 0;
  for (let i = 0; i < N; i++) {
    let z = 0, m = 1, d;
    do { d = B64.indexOf(code[c++]); z += (d & 31) * m; m *= 32; } while (d >= 32);
    const r = z % 2 ? -(z + 1) / 2 : z / 2, j = i % n;
    const p1 = j > 0 ? out.readInt16LE(2 * i - 2) : 0, p2 = j > 1 ? out.readInt16LE(2 * i - 4) : p1;
    out.writeInt16LE(r + (j > 1 ? 2 * p1 - p2 : p1), 2 * i);
  }
  if (c !== code.length) throw new Error('trailing characters in the packed bank');
  return out;
}

// the waves' names as the bank keeps them: the upstream file name without "AKWF_" and ".wav"
const waveName = (file) => path.basename(file, '.wav').replace(/^AKWF_/, '');

async function build() {
  const lic = await getFile(RECIPE.licenceFile.path, RECIPE.licenceFile.sha256);
  if (!/CC0 1\.0 Universal/.test(lic.toString('utf8'))) throw new Error('LICENSE.md is not CC0 1.0 Universal');
  const families = [], parts = [];
  for (const fam of RECIPE.families) {
    const waves = [];
    for (const [file, want] of Object.entries(fam.files)) {
      const s = readWav(await getFile(file, want), file);
      if (s.length !== RECIPE.samples) throw new Error(`${file}: ${s.length} samples, not ${RECIPE.samples}`);
      const b = Buffer.alloc(2 * s.length);
      for (let i = 0; i < s.length; i++) b.writeInt16LE(s[i], 2 * i);
      parts.push(b);
      waves.push(waveName(file));
    }
    families.push({ table: fam.table, label: fam.label, about: fam.about, waves });
  }
  const pcm = Buffer.concat(parts);
  const code = pack(pcm, RECIPE.samples);
  if (!unpack(code, pcm.length / 2, RECIPE.samples).equals(pcm)) throw new Error('the packing does not round-trip');
  const bank = { commit: RECIPE.commit, licence: RECIPE.licence, n: RECIPE.samples, sha256: sha256(pcm), families, code };
  const L = [
    '// GENERATED by node tools/akwf-bank.js from tools/kits/akwf.js: do not edit by hand (--verify checks it).',
    '//',
    `// ${RECIPE.credit} ${RECIPE.source} at commit ${RECIPE.commit.slice(0, 12)}.`,
    '// Light Table\'s AKWF bank (core.wavetable): a table per family, nine single cycles of 600 samples each, 16-bit,',
    '// family after family in `code`, packed losslessly (tools/akwf-bank.js says how); `sha256` is the hash of the',
    '// samples as 16-bit little-endian bytes. wavetables.js unpacks them, turns each cycle into a spectrum (its own',
    '// DFT) and band-limits it per octave like every other table.',
    'export const AKWF = {',
    `  commit: ${JSON.stringify(bank.commit)}, licence: ${JSON.stringify(bank.licence)}, n: ${bank.n},`,
    `  sha256: ${JSON.stringify(bank.sha256)},`,
    '  families: [',
    ...families.map((f) => `    ${JSON.stringify(f)},`),
    '  ],',
    `  code: ${JSON.stringify(bank.code)},`,
    '};',
    '',
  ];
  return { text: L.join('\n'), bank };
}

// --pick: the selection, re-run on a checkout (the folders each family drew from are the recipe's)
function pick(dir) {
  for (const fam of RECIPE.families) {
    const folders = fam.folders || [...new Set(Object.keys(fam.files).map((f) => path.dirname(f)))];
    const cands = [];
    for (const d of folders) for (const file of fs.readdirSync(path.join(dir, d)).filter((x) => x.endsWith('.wav')).sort()) {
      let s; try { s = readWav(fs.readFileSync(path.join(dir, d, file)), file); } catch { continue; }
      if (s.length !== RECIPE.samples) continue;
      const N = s.length, m = new Float64Array(N / 2);
      for (let k = 1; k < N / 2; k++) { let r = 0, i = 0; for (let n = 0; n < N; n++) { const th = 2 * Math.PI * k * n / N; r += s[n] * Math.cos(th); i -= s[n] * Math.sin(th); } m[k] = Math.hypot(r, i) * 2 / N; }
      let mx = 0, e = 0, ce = 0;
      for (let k = 1; k < m.length; k++) { mx = Math.max(mx, m[k]); e += m[k] * m[k]; ce += k * m[k] * m[k]; }
      if (e < 1e3 || m[1] < 0.2 * mx) continue;
      const v = []; for (let k = 1; k <= 48; k++) v.push(Math.max(-60, 20 * Math.log10(m[k] / mx + 1e-9)));
      cands.push({ file: `${d}/${file}`, cen: ce / e, v });
    }
    const dist = (a, b) => { let q = 0; for (let i = 0; i < a.v.length; i++) q += (a.v[i] - b.v[i]) ** 2; return Math.sqrt(q); };
    const byc = [...cands].sort((a, b) => a.cen - b.cen), chosen = [byc[Math.floor(byc.length / 2)]];
    while (chosen.length < 9 && chosen.length < cands.length) {
      let best = null, bd = -1;
      for (const x of cands) { if (chosen.includes(x)) continue; const md = Math.min(...chosen.map((c) => dist(c, x))); if (md > bd) { bd = md; best = x; } }
      chosen.push(best);
    }
    chosen.sort((a, b) => a.cen - b.cen);
    const same = JSON.stringify(chosen.map((c) => c.file)) === JSON.stringify(Object.keys(fam.files));
    console.log(`${fam.table}: ${cands.length} candidates -> ${chosen.map((c) => waveName(c.file)).join(' ')}${same ? '' : '  (NOT the recipe\'s list)'}`);
  }
}

const MAIN = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (!MAIN) { /* imported (tools/wavetable-test.js: unpack) */ } else if (PICK != null) pick(PICK);
else {
  try {
    const { text, bank } = await build();
    const waves = bank.families.reduce((n, f) => n + f.waves.length, 0);
    if (VERIFY) {
      const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text;
      console.log(same ? `akwf.js is the pinned bank: ${waves} waves, ${bank.sha256.slice(0, 16)}` : 'akwf.js differs from what the recipe builds');
      process.exit(same ? 0 : 1);
    }
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(ROOT, OUT)}: ${bank.families.length} families, ${waves} waves, ${(text.length / 1024).toFixed(0)} KB, pcm ${bank.sha256.slice(0, 16)}`);
  } catch (e) {
    console.error(e.message);
    process.exit(e.code === 'NOCACHE' ? 2 : 1);
  }
}
