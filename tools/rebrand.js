// Rename the product, mechanically and safely: the name in every text file, files named after it, the project
// format (old songs keep opening: see isProjectFormat / cleanProject in app/src/core/project.js) and the brand marks.
//
//   node tools/rebrand.js --name "Wren" --slug wren --dry     print what would change, change nothing
//   node tools/rebrand.js --name "Wren" --slug wren           do it (then run the checks and re-render, it says how)
//
// What it touches: every git-tracked (or untracked, not ignored) text file except app/vendor/** (verbatim third-party
// copies), docs/brand-options/** (the options themselves), tools/.out and this script. Name → "Name" in prose,
// lower case → slug (ids, the wordmark, file names), upper case → SLUG (env vars, the device-face maker label).
//
// What it keeps, on purpose (CLAUDE.md: "ids are forever"), and reports:
//   - browser storage names: localStorage/sessionStorage keys '<old>:*' and the IndexedDB databases '<old>-assets'
//     and '<old>-capture'. Renaming them would orphan people's autosaved song, API key and recordings.
//   - absolute paths to the repo folder (/Users/.../<old>/server/mcp.js): the folder is not renamed by this script.
// Songs saved under the old format and house author keep loading through app/src/core/project.js, which builds the
// old name from pieces so this script can't rewrite it.
//
// Brand marks: if docs/brand-options/<slug>/ has mark.svg, wordmark.svg, wordmark-ink.svg or favicon.svg, they are
// copied over logo.svg / wordmark.svg / wordmark-ink.svg / favicon.svg in app/assets/ and site/assets/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url));

// The old name, built from pieces so a run never rewrites this script (it is also excluded by path).
const OLD = ['ear', 'worm'].join('');
const OLD_RE = new RegExp(OLD, 'i');

// ---- arguments
function usage(msg) {
  if (msg) console.error(`rebrand: ${msg}\n`);
  console.error('usage: node tools/rebrand.js --name "Wren" --slug wren [--dry]');
  console.error('  --name  the product name as it reads in prose (sentence case, e.g. "Wren")');
  console.error('  --slug  lower-case letters and digits, starting with a letter: ids, file names, the wordmark text');
  console.error('  --dry   print the summary and change nothing');
  process.exit(msg ? 2 : 0);
}
const argv = process.argv.slice(2);
const opt = { dry: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry' || a === '--dry-run') opt.dry = true;
  else if (a === '--help' || a === '-h') usage();
  else if (a === '--name' || a === '--slug') {
    if (argv[i + 1] == null) usage(`${a} needs a value`);
    opt[a.slice(2)] = argv[++i];
  } else if (/^--(name|slug)=/.test(a)) {
    const [k, ...v] = a.slice(2).split('=');
    opt[k] = v.join('=');
  } else usage(`unknown argument ${a}`);
}
if (!opt.name || !opt.slug) usage('--name and --slug are both required');
const NAME = opt.name.trim();
const SLUG = opt.slug.trim();
if (!/^[a-z][a-z0-9]*$/.test(SLUG))
  usage(
    `--slug "${SLUG}" must be lower-case letters and digits, starting with a letter (it becomes part of JS identifiers like window.${OLD} and ${OLD}Dsp)`,
  );
if (!NAME || /[\n\r`'"\\]/.test(NAME)) usage('--name must be one line without quotes or backticks');
if (SLUG === OLD) usage(`the slug is already "${OLD}"`);
const NAME_ID = NAME.replace(/[^A-Za-z0-9]/g, ''); // the name where it is part of an identifier (a class name)
if (!/^[A-Za-z]/.test(NAME_ID)) usage(`--name "${NAME}" needs to start with a letter`);
const UPPER = SLUG.toUpperCase();

// ---- the files
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
let tracked;
try {
  tracked = new Set(git('ls-files', '-z').split('\0').filter(Boolean));
} catch (e) {
  usage(`${ROOT} is not a git work tree`);
}
const all = git('ls-files', '-z', '-c', '-o', '--exclude-standard').split('\0').filter(Boolean);
const EXCLUDE = [/^app\/vendor\//, /^docs\/brand-options\//, /^tools\/\.out\//, /^\.git\//, /^node_modules\//];
const inScope = (f) => f !== SELF && !EXCLUDE.some((re) => re.test(f)) && fs.existsSync(path.join(ROOT, f));
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|mp4|webm|mov|mp3|wav|ogg|flac|m4a|aac|woff2?|ttf|otf|eot|zip|gz|pdf|wasm|bin)$/i;
function isText(f, buf) {
  if (BINARY_EXT.test(f)) return false;
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}
const files = [...new Set(all)].filter(inScope).sort();

// ---- the rewrite
const IDENT = /[A-Za-z0-9_$]/;
// Absolute paths to the repo folder: /Users/aj/Code/<old>/..., /home/x/<old>, ~/Code/<old>
const ABS_PATH_BEFORE =
  /(?:^|[\s'"`(=:,[])(?:~|\/(?:Users|home|private|tmp|var|opt|srv|mnt|Volumes))(?:\/[^\s'"`/]+)*\/$/;
const STORAGE_AFTER = /^:[a-z*]/; // '<old>:project', '<old>:*'
const IDB_AFTER = /^-(assets|capture)\b/; // IndexedDB database names
const ARTICLE = /\b(an?|An?|AN?)( +)$/;
const startsWithVowel = (s) => /^[aeiou]/i.test(s) && !/^(uni|use|eu|one)/i.test(s);

const kept = []; // { file, line, why, text }
const ambiguous = []; // { file, line, why, text }
const perFile = []; // { file, n }
const writes = []; // { file, content }

// Why this occurrence stays as it is, or null.
function keepWhy(text, i, word) {
  const before = text.slice(Math.max(0, i - 300), i),
    after = text.slice(i + word.length, i + word.length + 40);
  const lineStart = before.slice(before.lastIndexOf('\n') + 1);
  if (ABS_PATH_BEFORE.test(lineStart) && /^(\/|$|['"`\s)])/.test(after))
    return 'absolute path to the repo folder (rename the folder yourself)';
  if (word === OLD && STORAGE_AFTER.test(after)) return "browser storage key (people's saved song, API key, settings)";
  if (word === OLD && IDB_AFTER.test(after)) return "IndexedDB database name (people's recordings)";
  return null;
}
function lineOf(text, idx) {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < idx; i = text.indexOf('\n', i + 1)) n++;
  return n;
}
function lineText(text, idx) {
  const a = text.lastIndexOf('\n', idx - 1) + 1,
    b = text.indexOf('\n', idx);
  return text
    .slice(a, b === -1 ? undefined : b)
    .trim()
    .slice(0, 160);
}

function rewrite(file, text) {
  const re = new RegExp(OLD, 'gi');
  let out = '',
    last = 0,
    n = 0,
    m;
  while ((m = re.exec(text))) {
    const i = m.index,
      word = m[0],
      before = text.slice(Math.max(0, i - 300), i),
      after = text.slice(i + word.length, i + word.length + 40);
    const lineStart = before.slice(before.lastIndexOf('\n') + 1);
    const note = (list, why) => list.push({ file, line: lineOf(text, i), why, text: lineText(text, i) });
    const keep = keepWhy(text, i, word);
    if (keep) {
      note(kept, keep);
      continue;
    }
    // what it becomes
    const prev = text[i - 1] || '',
      next = text[i + word.length] || '';
    const inIdent = IDENT.test(prev) || IDENT.test(next);
    let rep;
    if (word === OLD) rep = SLUG;
    else if (word === OLD.toUpperCase()) rep = UPPER;
    else if (word === OLD[0].toUpperCase() + OLD.slice(1)) rep = inIdent ? NAME_ID : NAME;
    else {
      rep = inIdent ? NAME_ID : NAME;
      note(ambiguous, `odd capitalisation "${word}" → "${rep}"`);
    }
    // flag what a human should read again
    if (word === OLD && !inIdent) {
      if (/\b(the|an?|that|your|my|this)\s+$/i.test(lineStart))
        note(
          ambiguous,
          `common noun? ("${lineStart.match(/(\S+)\s+$/)[1]} ${OLD}" means a song stuck in your head) → "${rep}"`,
        );
      else if (/(alt|aria-label|title)=["']$|<title>$/.test(lineStart) && NAME.toLowerCase() !== SLUG)
        note(ambiguous, `wordmark text → slug "${SLUG}"; the lower-case name would be "${NAME.toLowerCase()}"`);
      else if (/mcp add $/.test(lineStart) || /serverInfo: \{ name: '$/.test(lineStart))
        note(
          ambiguous,
          `MCP server name → "${SLUG}"; an existing \`claude mcp add ${OLD}\` registration keeps working under the old name`,
        );
      else if (/^-provenance\//.test(after))
        note(
          ambiguous,
          `attribution-log format → "${SLUG}-provenance/0"; old logs opened as songs get "isn't a ${NAME} project" instead of the log hint`,
        );
    }
    // 'an <Old>' → 'a Wren': fix the article to the new name
    let head = text.slice(last, i);
    const art = head.match(ARTICLE);
    if (art && !inIdent) {
      const want = startsWithVowel(rep) ? 'an' : 'a';
      const cased =
        art[1] === art[1].toUpperCase() && art[1].length > 1
          ? want.toUpperCase()
          : art[1][0] === art[1][0].toUpperCase()
            ? want[0].toUpperCase() + want.slice(1)
            : want;
      if (cased !== art[1]) head = head.slice(0, head.length - art[0].length) + cased + art[2];
    }
    out += head + rep;
    last = i + word.length;
    n++;
  }
  return { content: out + text.slice(last), n };
}

// Targeted code patches, applied after the rewrite. Each is checked; a missing anchor is reported, not ignored.
const PATCHES = [
  {
    file: 'app/src/ui/export.js',
    why: 'Open… accepts songs saved under the old format (via isProjectFormat in core/project.js)',
    apply(s) {
      const anchor = `(p.format && !String(p.format).startsWith('${SLUG}/'))`;
      if (!s.includes(anchor)) return null;
      s = s.replace(anchor, '(p.format && !isProjectFormat(p.format))');
      if (!/import \{[^}]*\bisProjectFormat\b[^}]*\} from '\.\.\/core\/project\.js'/.test(s)) {
        const imports = [...s.matchAll(/^import .*;$/gm)];
        const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
        s = s.slice(0, at) + "\nimport { isProjectFormat } from '../core/project.js';" + s.slice(at);
      }
      return s;
    },
  },
];
const patchResults = [];

for (const f of files) {
  const abs = path.join(ROOT, f);
  const buf = fs.readFileSync(abs);
  if (!isText(f, buf)) continue;
  const text = buf.toString('utf8');
  let { content, n } = OLD_RE.test(text) ? rewrite(f, text) : { content: text, n: 0 };
  for (const p of PATCHES.filter((x) => x.file === f)) {
    const r = p.apply(content);
    patchResults.push({ file: f, why: p.why, ok: r != null });
    if (r != null) content = r;
  }
  if (content !== text) {
    writes.push({ file: f, content });
    perFile.push({ file: f, n });
  }
}
for (const p of PATCHES) if (!files.includes(p.file)) patchResults.push({ file: p.file, why: p.why, ok: false });

// ---- file and directory names
const renameName = (seg) =>
  seg.replace(new RegExp(OLD, 'gi'), (w) => (w === OLD ? SLUG : w === OLD.toUpperCase() ? UPPER : NAME_ID));
const renames = files
  .filter((f) => OLD_RE.test(f))
  .map((f) => ({ from: f, to: f.split('/').map(renameName).join('/'), tracked: tracked.has(f) }));
for (const r of renames)
  if (fs.existsSync(path.join(ROOT, r.to))) usage(`can't rename ${r.from}: ${r.to} already exists`);

// ---- brand marks
const OPT_DIR = path.join('docs/brand-options', SLUG);
const MARKS = [
  ['mark.svg', 'logo.svg'],
  ['wordmark.svg', 'wordmark.svg'],
  ['wordmark-ink.svg', 'wordmark-ink.svg'],
  ['favicon.svg', 'favicon.svg'],
];
const copies = [];
for (const [src, dst] of MARKS) {
  const s = path.join(OPT_DIR, src);
  if (fs.existsSync(path.join(ROOT, s)))
    for (const d of ['app/assets', 'site/assets']) copies.push({ from: s, to: path.join(d, dst) });
}

// ---- do it
if (!opt.dry) {
  for (const w of writes) fs.writeFileSync(path.join(ROOT, w.file), w.content);
  for (const r of renames) {
    fs.mkdirSync(path.dirname(path.join(ROOT, r.to)), { recursive: true });
    if (r.tracked) git('mv', r.from, r.to);
    else fs.renameSync(path.join(ROOT, r.from), path.join(ROOT, r.to));
    // drop directories the rename left empty
    for (let d = path.dirname(r.from); d && d !== '.'; d = path.dirname(d)) {
      const abs = path.join(ROOT, d);
      if (fs.existsSync(abs) && !fs.readdirSync(abs).length) fs.rmdirSync(abs);
      else break;
    }
  }
  for (const c of copies) fs.copyFileSync(path.join(ROOT, c.from), path.join(ROOT, c.to));
}

// ---- after a real run: what's left of the old name, outside the excluded paths
const leftovers = [];
if (!opt.dry) {
  const now = git('ls-files', '-z', '-c', '-o', '--exclude-standard').split('\0').filter(Boolean).filter(inScope);
  for (const f of now) {
    if (OLD_RE.test(f)) leftovers.push({ file: f, line: 0, text: '(file name)' });
    const buf = fs.readFileSync(path.join(ROOT, f));
    if (!isText(f, buf)) continue;
    const t = buf.toString('utf8'),
      re = new RegExp(OLD, 'gi');
    for (let m; (m = re.exec(t)); )
      if (!keepWhy(t, m.index, m[0])) leftovers.push({ file: f, line: lineOf(t, m.index), text: lineText(t, m.index) });
  }
}

// ---- report
const total = perFile.reduce((a, b) => a + b.n, 0);
const P = (s = '') => console.log(s);
P(
  `${opt.dry ? 'DRY RUN (nothing changed): ' : ''}${OLD[0].toUpperCase() + OLD.slice(1)} → ${NAME} (slug ${SLUG}, ${UPPER}) in ${ROOT}`,
);
P(`scanned ${files.length} files (skipped app/vendor/, docs/brand-options/, tools/.out/, ${SELF})`);
P();
P(`text: ${total} replacements in ${perFile.filter((x) => x.n).length} files`);
for (const x of perFile.slice().sort((a, b) => b.n - a.n || a.file.localeCompare(b.file)))
  P(`  ${String(x.n).padStart(4)}  ${x.file}`);
P();
P(`renames (${renames.length}):`);
for (const r of renames) P(`  ${r.from} → ${r.to}${r.tracked ? '  (git mv)' : '  (untracked: plain rename)'}`);
if (!renames.length) P('  none');
P();
P('code patches:');
for (const p of patchResults)
  P(
    `  ${p.ok ? 'ok     ' : 'MISSING'} ${p.file}: ${p.why}${p.ok ? '' : ' (anchor not found: fix by hand, or old song files will be refused by Open…)'}`,
  );
P();
P(`brand marks from ${OPT_DIR}/:`);
if (copies.length) for (const c of copies) P(`  ${c.from} → ${c.to}`);
else P(`  none there yet (looked for ${MARKS.map((m) => m[0]).join(', ')}); the current marks stay`);
if (copies.length && !copies.some((c) => c.to.endsWith('wordmark-ink.svg')))
  P('  note: no wordmark-ink.svg in the option, so the old light-background wordmark stays');
P();
const byWhy = (list) => {
  const g = new Map(),
    seen = new Set();
  for (const k of list) {
    const key = `${k.why}\0${k.file}:${k.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!g.has(k.why)) g.set(k.why, []);
    g.get(k.why).push(k);
  }
  return g;
};
P(`kept on purpose (${kept.length}):`);
for (const [why, list] of byWhy(kept)) {
  P(`  ${why} (${list.length}):`);
  for (const k of list) P(`    ${k.file}:${k.line}  ${k.text}`);
}
if (!kept.length) P('  none');
P();
P(`ambiguous, replaced anyway; read these again (${ambiguous.length}):`);
for (const [why, list] of byWhy(ambiguous)) {
  P(`  ${why}:`);
  for (const k of list) P(`    ${k.file}:${k.line}  ${k.text}`);
}
if (!ambiguous.length) P('  none');
P();
P(
  'theme copy a rename cannot fix (worms, soil and garden device names, "stuck in your head"): docs/brand-options/THEME-COPY.md',
);
if (!opt.dry) {
  P();
  if (leftovers.length) {
    P(`STILL MENTIONS ${OLD} (${leftovers.length}), not counting what was kept on purpose:`);
    for (const l of leftovers) P(`  ${l.file}:${l.line}  ${l.text}`);
  } else P(`no other mention of "${OLD}" left outside app/vendor/ and docs/brand-options/.`);
  P();
  P('Next:');
  P('  node tools/run-all.js                 every check');
  P('  node tools/shots.js                   re-render the landing page screenshots');
  P('  node tools/brand-og.js                re-render the social card (site/assets/og.png)');
  P('  node tools/demo-video.js              re-render the demo video and its poster');
  P(`  claude mcp remove ${OLD} && claude mcp add ${SLUG} -- node ${ROOT}/server/mcp.js   (if you use the MCP server)`);
  P(`  tools/brand-marks.js regenerates the Weave mark and favicon (it no longer draws the old spiral).`);
  P('  Then rewrite the theme copy listed in docs/brand-options/THEME-COPY.md.');
}
