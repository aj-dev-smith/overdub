// Vendors the Guitar Studio from clawd-o-matic (AJ's browser punk song maker) into Overdub, verbatim, and generates the
// ES-module wrappers that run it here. Re-run it whenever clawd-o-matic changes:
//
//   node tools/vendor-clawd.js            (CLAWD=/path/to/clawd-o-matic/web to point somewhere else)
//
// 1. Copies the sources VERBATIM into app/vendor/clawd/ (same relative paths as clawd-o-matic/web), each with one line
//    on top saying where it came from. Nobody edits those copies: change clawd-o-matic and re-run this.
// 2. Generates two modules that evaluate that code inside one function scope each, the way clawd-o-matic's build
//    concatenates it into one page scope, with the few app globals it expects injected:
//      app/src/devices/guitar/clawd.gen.js  the sound: pedals.js (the platform: PFX, the registry, boards), amps.js,
//                                           pedals/*.js (every pack), presets.js + presets/*.js (every bank)
//      app/src/devices/guitar/looks.gen.js  the looks: pedalboard.js (pedal faces, their CSS) and ampui.js (amp faces)
//    Each exports evaluate(env) -> the names Overdub uses. Nothing runs at import: devices/guitar/index.js calls it.
// 3. Writes every worklet that code loads to a file of its own, app/vendor/clawd/worklets/<name>.js: the processor
//    source exactly as the code builds it, under one line saying so (the code builds some at load, the pitch pack
//    pasting a shared library into each, so the sound module is evaluated here and the strings taken from it). The
//    names are the ones the code loads them under: pedalDef's registry (PFX.worklets) and the amps' PLUG_WORKLETS, as
//    plugin.js loads it. clawd.gen.js exports WORKLETS, name -> the file's URL, and Overdub's pedals and amps name
//    those: the studio loads worklet modules only from its own origin (its policy refuses the data: and blob: URLs
//    clawd-o-matic's pfxWorklet makes from the strings; app/index.html says why).
// The packs read a few of clawd-o-matic's app globals lazily (PLUG.clock, song.key, ctx); the wrapper declares them as
// variables the Overdub side can point at its own clock, song key and live context (env.bind).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(process.env.CLAWD || path.join(ROOT, '..', 'clawd-o-matic', 'web'));
const VENDOR = path.join(ROOT, 'app/vendor/clawd');
const GEN = path.join(ROOT, 'app/src/devices/guitar');

if (!fs.existsSync(path.join(SRC, 'pedals.js'))) {
  console.error('vendor-clawd: no clawd-o-matic at ' + SRC + ' (set CLAWD=…/clawd-o-matic/web)');
  process.exit(1);
}
let rev = 'unknown';
try {
  rev = execSync('git log -1 --format=%h', { cwd: SRC, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch (e) {
  /* not a checkout */
}
try {
  if (
    execSync('git status --porcelain -- .', { cwd: SRC, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  )
    rev += '+dirty';
} catch (e) {
  /* fine */
}

const list = (dir) =>
  fs
    .readdirSync(path.join(SRC, dir))
    .filter((f) => /^\d\d-[\w-]+\.js$/.test(f))
    .sort()
    .map((f) => dir + '/' + f);
const SOUND = ['pedals.js', 'amps.js', ...list('pedals'), 'presets.js', ...list('presets')];
const LOOKS = ['pedalboard.js', 'ampui.js'];
const DOCS = ['../docs/PEDALS.md', '../docs/GUITAR.md'];

// 1. the verbatim copies (anything vendored before that's gone upstream is removed, once the worklets are written too)
const want = new Set();
const copy = (rel) => {
  const src = path.join(SRC, rel),
    out = path.join(VENDOR, rel.replace(/^\.\.\//, ''));
  const head = rel.endsWith('.md')
    ? `<!-- vendored verbatim from clawd-o-matic/web/${rel} @ ${rev} by tools/vendor-clawd.js: do not edit, re-run it -->\n`
    : `// vendored verbatim from clawd-o-matic/web/${rel} @ ${rev} by tools/vendor-clawd.js: do not edit, re-run it\n`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, head + fs.readFileSync(src, 'utf8'));
  want.add(path.resolve(out));
};
for (const rel of [...SOUND, ...LOOKS, ...DOCS]) copy(rel);
// ... and Claw'd-o-Matic's licence (MIT), which travels with the copies, unchanged
const LICENSE = path.join(SRC, '..', 'LICENSE');
if (!fs.existsSync(LICENSE)) {
  console.error('vendor-clawd: no LICENSE at ' + LICENSE);
  process.exit(1);
}
fs.copyFileSync(LICENSE, path.join(VENDOR, 'LICENSE'));
want.add(path.resolve(VENDOR, 'LICENSE'));

// plugin.js isn't vendored (it's the live Plug in tab), but presets.js reads its PLUG_DEFAULT: lifted out by name. It
// also loads the amps' worklets (PLUG_WORKLETS): the name it loads them under is lifted too (3).
const plugin = fs.readFileSync(path.join(SRC, 'plugin.js'), 'utf8');
const plugDefault = (plugin.match(/^const PLUG_DEFAULT = .*;$/m) || [])[0];
if (!plugDefault) {
  console.error('vendor-clawd: PLUG_DEFAULT not found in plugin.js');
  process.exit(1);
}
const ampWorklets = (plugin.match(/pfxWorklet\(\s*c\s*,\s*'([\w-]+)'\s*,\s*PLUG_WORKLETS\s*\)/) || [])[1];
if (!ampWorklets) {
  console.error('vendor-clawd: plugin.js no longer loads PLUG_WORKLETS as pfxWorklet(c, name, PLUG_WORKLETS)');
  process.exit(1);
}

// 2. the wrappers
const body = (rel) => {
  const code = fs.readFileSync(path.join(SRC, rel), 'utf8');
  if (/^\s*(import|export)\s/m.test(code))
    throw new Error(rel + ': has import/export; it is meant for a classic script scope');
  return (
    `\n  // ---------------------------------------------------------------- app/vendor/clawd/${rel}\n` + code + '\n'
  );
};
const banner = (
  what,
  files,
) => `// GENERATED by tools/vendor-clawd.js from clawd-o-matic @ ${rev}: do not edit (re-run the tool).
// ${what}
// The code below is clawd-o-matic's, verbatim (copies in app/vendor/clawd/): ${files.join(', ')}.
// It runs inside evaluate(), one function scope, as clawd-o-matic's build runs it in one page scope.
/* eslint-disable */
`;

const sound =
  banner(
    'The sound of the Guitar Studio: the pedal platform, the amps and cabs, every pedal pack, every preset bank.',
    SOUND,
  ) +
  `
export function evaluate(env = {}) {
  // ---- what the code expects from the rest of clawd-o-matic's page, injected
  const FONTS = env.FONTS || { dirt: '"Rubik Dirt", Impact, sans-serif', pixel: 'Silkscreen, monospace' };
  const PLUG = env.PLUG;                  // (plugin.js) { clock, _bus }: Overdub's clock behind a shim (devices/guitar/index.js)
  const store = env.store || { get() { return null; }, set() {} };
  let song = null, ctx = null, AR;        // (app.js) the song (its key) and the live context, pointed at by env.bind
  if (env.bind) env.bind({ song: (s) => { song = s; }, ctx: (c) => { ctx = c; } });
  // (plugin.js, lifted by the tool)
  ${plugDefault}
${SOUND.map(body).join('')}
  return {
    // the platform (pedals.js)
    PFX, PLUG_GATE, PFX_ENV, PFX_END, DELAY_NOTES, PEDAL_CATS, PEDAL_RANK, PEDAL_DEFS, PEDAL_LIST, pedalKnob, pfxGlide,
    boardClean, boardFromFx, boardDefault, boardEntry,
    // the amps, cabs and mics (amps.js)
    PLUG_AMPS, PLUG_WORKLETS, PLUG_CABS, PLUG_AMP_BOX, PLUG_MICS, PLUG_MIC_DEFAULT, PLUG_MIC2_DEFAULT, plugAmp, plugCabNet, plugCabClean,
    // the presets (presets.js, presets/*.js)
    PLUG_PRESETS, PRESET_BANKS, PRESET_KNOBS, presetResolve, presetBanks, PLUG_DEFAULT,
  };
}
`;

const looks =
  banner('The looks of the Guitar Studio: procedural pedal faces and the amps (pure CSS, no images).', LOOKS) +
  `
export function evaluate(env = {}) {
  const FONTS = env.FONTS || { dirt: '"Rubik Dirt", Impact, sans-serif', pixel: 'Silkscreen, monospace' };
  const PLUG_AMPS = env.PLUG_AMPS || {};  // (amps.js) only read for an amp's style
  const store = env.store || { get() { return null; }, set() {} };
${LOOKS.map(body).join('')}
  return { PEDAL_LOOKS, pedalLook, PEDAL_CSS, AMP_LOOKS, AMP_STYLE_LOOK, AMP_PICTO, AMP_FONT, AMP_TONES, ampLookOf, ampPaint, AMP_CSS };
}
`;

// 3. the worklets: the sound module evaluated as the studio evaluates it (with a stopped clock), and every processor
// source it loads taken from it, by the name it loads it under
const FREE = {
  playing: () => false,
  bpm: () => 120,
  beatsPerBar: () => 4,
  bar: () => 0,
  barTime: (b) => b * 2,
  barAt: (t) => t / 2,
};
const C = (await import('data:text/javascript;base64,' + Buffer.from(sound).toString('base64'))).evaluate({
  PLUG: { clock: FREE, _bus: null },
});
const code = Object.fromEntries(SOUND.map((rel) => [rel, fs.readFileSync(path.join(SRC, rel), 'utf8')]));
const packOf = (id) => SOUND.find((rel) => code[rel].includes(`id: '${id}'`)) || 'a pack';
const platform = new Map([
  [C.PFX_ENV, "pedals.js, the kit's PFX_ENV"],
  [C.PLUG_GATE, "pedals.js, the gate's PLUG_GATE"],
]);
const WL = {};
for (const [name, w] of Object.entries(C.PFX.worklets))
  WL[name] = { src: w.src, from: platform.get(w.src) || `${packOf(w.id)}, the ${w.id} pedal's` };
if (WL[ampWorklets]) {
  console.error(`vendor-clawd: a pedal's worklet is called "${ampWorklets}", the amps' name too`);
  process.exit(1);
}
WL[ampWorklets] = { src: C.PLUG_WORKLETS, from: "amps.js, the amps' PLUG_WORKLETS" };
const NAMES = Object.keys(WL).sort();
for (const n of NAMES) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) {
    console.error(`vendor-clawd: worklet "${n}": not a name a file can have here (a-z 0-9 -)`);
    process.exit(1);
  }
  if (typeof WL[n].src !== 'string' || !/registerProcessor\(/.test(WL[n].src)) {
    console.error(`vendor-clawd: worklet "${n}" has no processor source`);
    process.exit(1);
  }
}
if (C.PFX.refused.length)
  console.warn('vendor-clawd: pedalDef refused ' + C.PFX.refused.map((r) => `${r.id} (${r.why})`).join(', '));
// (pfxWorklet in pedals.js is the one place the code loads a module; one loaded some other way isn't written out here)
const elsewhere = SOUND.filter(
  (rel) => (code[rel].match(/\baddModule\(/g) || []).length > (rel === 'pedals.js' ? 1 : 0),
);
if (elsewhere.length)
  console.warn(
    `vendor-clawd: ${elsewhere.join(', ')} load worklet modules outside pfxWorklet: the studio refuses ones made from strings, so give them files here`,
  );
const WDIR = path.join(VENDOR, 'worklets');
fs.mkdirSync(WDIR, { recursive: true });
for (const n of NAMES) {
  const out = path.join(WDIR, n + '.js');
  fs.writeFileSync(
    out,
    `// vendored verbatim from clawd-o-matic/web @ ${rev} by tools/vendor-clawd.js: the '${n}' worklet (${WL[n].from}), as the code builds it; do not edit, re-run it\n` +
      WL[n].src,
  );
  want.add(path.resolve(out));
}
const url = (n) =>
  path
    .relative(GEN, path.join(WDIR, n + '.js'))
    .split(path.sep)
    .join('/');
const worklets = `
// ---------------------------------------------------------------- the worklets (by tools/vendor-clawd.js)
// Every processor the code above loads, by the name it loads it under, is a file of its own in
// app/vendor/clawd/worklets/: its source as the code builds it, verbatim. Overdub's pedals and amps name these files
// (devices/guitar/clawd.js), as the studio loads worklet modules only from its own origin: its policy refuses the data:
// and blob: URLs pfxWorklet makes from the strings (app/index.html says why).
export const WORKLETS = {
${NAMES.map((n) => `  '${n}': new URL('${url(n)}', import.meta.url).href,`).join('\n')}
};
`;

// anything vendored before that's gone upstream
(function prune(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) prune(p);
    else if (!want.has(path.resolve(p))) {
      fs.unlinkSync(p);
      console.log('  removed', path.relative(ROOT, p));
    }
  }
})(VENDOR);

fs.mkdirSync(GEN, { recursive: true });
fs.writeFileSync(path.join(GEN, 'clawd.gen.js'), sound + worklets);
fs.writeFileSync(path.join(GEN, 'looks.gen.js'), looks);
const kb = (f) => (fs.statSync(path.join(GEN, f)).size / 1024).toFixed(0) + ' KB';
console.log(
  `vendor-clawd: clawd-o-matic @ ${rev} -> app/vendor/clawd (${SOUND.length + LOOKS.length} sources, ${DOCS.length} docs, ${NAMES.length} worklets)`,
);
console.log(`  app/src/devices/guitar/clawd.gen.js ${kb('clawd.gen.js')}, looks.gen.js ${kb('looks.gen.js')}`);
