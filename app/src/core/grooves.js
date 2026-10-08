// Grooves [core]: a drum library played by a drummer, not a grid; tap-to-find; and a song creator that writes a whole
// drum track for the song's sections. Pure: no DOM, seeded randomness only, works in Node and the browser. The design
// note is docs/research/GROOVES.md; the panel is ui/grooves.js and the agent tools are agent/grooves-tool.js.
//
//   STYLES / GROOVES / LIBRARY                 the library, parsed once from the style files in ./grooves/
//   parseGrooves(text, { file })               -> { styles, grooves, errors }   (the format, below)
//   getStyle(idOrWord) / getGroove(idOrWord, { style })                          (or null)
//   findGrooves({ style, part, feel, tempo, query, limit })                      -> [groove]
//   realize(groove, { tempo, seed, human, length, offset })                     -> notes [{ p, t, d, v }] (beats)
//   gridText(groove) / describe(groove) / lengthLabel(groove)                    the written rows; a one-line summary
//   tempoFromTaps(seconds[]) -> { bpm, beats, phase }                            the tempo a tapped rhythm was played at
//   matchTaps(taps, { limit, parts, styles })  -> { bpm, taps, results: [{ groove, score, matched, of, shift, bpm }] }
//   planPut(project, { groove, track, bar, bars, seed, studioA, device })        -> { ops, summary, ... } | { error, hint }
//   planDrumTrack(project, { style, seed, studioA, device, parts, ending, crashes }) -> { ops, plan, summary, ... } | { error, hint }
//   songLoops(project)                          whether the loop goes round the drums' end (then no ending by default)
//
// The format. A style file is plain text an agent can write. `#` starts a comment. A style opens with `style <id>
// <Name>`, then its lines; each groove opens with `<part> <Name> <N> bar(s)|beat(s)` and has one row per piece:
//
//   style rock  Rock
//   blurb   straight eighths and a big backbeat
//   tempo   88-160                  the tempo range it is played at (BPM)
//   feel    straight                words a search matches ("swung", "laid back", "half-time" ...)
//   swing   16 54%                  8 or 16: which offbeats swing; 50% is straight, 66% a triplet; "66-58%" runs from
//                                   the slow end of the tempo range to the fast end (swing tightens as tempo rises)
//   lay     snare +18  hat -4       micro-timing per piece or family, in ms: + behind the beat, - ahead of it
//   human   5ms 7%                  humanising: timing spread (ms) and velocity spread; seeded, correlated over time
//   accent  hat 1 .84 .66           the time-keeping hand: on the beat, on the "and", on the "e"/"a" (then triplets)
//   kit     acoustic room .3        acoustic | plus | machine | dust | 808 | 909, and Gobo Kit params; or a kind with a
//                                   kit of its own (KIT_DEVICES: metal is Rusty Sticks), and that kit's params
//   studio  Arena                   the Studio A preset an acoustic style plays on, when the studio has Studio A
//   art     open half               on a kit with articulations (Studio A), the open row plays the half-open hat;
//                                   General MIDI stays the default, so every groove plays right on Gobo Kit
//
//   verse   Straight eighths  1 bar
//     hat     x.x. x.x. x.x. x.x.   cells: X accent, x hit, O soft, o ghost, g feathered (barely there), f flam,
//                                   F accented flam, . or - rest
//     snare   .... X... .... X...   groups split by spaces or |: one per beat (here), one per bar, or one for it all;
//     kick    X... .... X.x. ....   a group's cells share its span evenly: 4 = 16ths, 3 = triplets, 8 = 32nds
//
// Parts: intro, verse, chorus, bridge, half (half-time), fill, ending. A groove line may override the style's tempo,
// feel, swing, lay, human or accent. Rows are music.js DRUM_MAP names (kick, snare, rim, clap, hat, pedal, open, ride,
// bell, crash, tom1, tom2, tom3, floor, cowbell, shaker, tamb ...), a few more (stick, crash2, splash, china), or MIDI
// numbers: General MIDI, so every groove plays on Gobo Kit (core.drums) and on any GM kit.
//
// How it plays (realize): the written grid, then swing (by tempo), the hand's accents, the style's lay (ms at the song's
// tempo) and the humanising: a timing drift that wanders slowly (AR(1) per sixteenth: human timing is correlated, not
// white noise) plus a little independent spread per limb, and velocity spread with a slow swell. All from rng(seed), so
// the same groove, seed and tempo give the same notes everywhere.

import { DRUM_MAP, DRUM_NAMES, beatsPerBar, parsePitch } from './music.js';
import { rng } from './transforms.js';
import { TEXTS } from './grooves/index.js';

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const SQ3 = 1.7320508075688772;

export const PARTS = ['intro', 'verse', 'chorus', 'bridge', 'half', 'fill', 'ending'];
export const MAIN_PARTS = ['verse', 'chorus', 'bridge', 'half'];
export const PART_LABEL = { intro: 'Intro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', half: 'Half-time', fill: 'Fill', ending: 'Ending' };
export const MARKS = { X: 1, x: 0.8, O: 0.6, o: 0.45, g: 0.28, F: 1, f: 0.8 };
const REST = new Set(['.', '-', '_']);
const KEYS = new Set(['blurb', 'tempo', 'feel', 'swing', 'lay', 'human', 'accent', 'kit', 'studio', 'art', 'meter', 'tags']);
// names beyond music.js DRUM_MAP (which names General MIDI and Studio A's articulations)
const EXTRA = { stick: 37, xstick: 37, crash2: 57, splash: 55, china: 52, ride2: 59, floor2: 41, lofloor: 41, kick2: 35 };
// families: what the matcher and the pictures group, and what `lay snare` reaches. Studio A's articulations (its hats'
// openness 21-24 and 26, its chokes 25 and 27-30, the snare's flam, drag, roll and edge 31-34) belong where they sound.
export const FAMILY = {
  kick: [35, 36],
  snare: [38, 40, 39, 37, 31, 32, 33, 34],
  tom: [41, 43, 45, 47, 48, 50],
  hat: [42, 44, 46, 21, 22, 23, 24, 26],
  ride: [51, 53, 59],
  cymbal: [49, 57, 52, 55, 25, 27, 28, 29, 30],
  perc: [54, 56, 69, 70, 82],
};
const FLAM = 31;   // Studio A's snare flam: one note, the grace stroke in it
const FAMILY_OF = Object.fromEntries(Object.entries(FAMILY).flatMap(([f, ps]) => ps.map((p) => [p, f])));
export const familyOf = (p) => FAMILY_OF[p] || 'perc';
// the time-keeping hand: what `accent` shapes when a style doesn't say (hat, pedal, ride, shaker, tamb, cowbell)
const KEEPERS = new Set([42, 44, 51, 59, 70, 54, 56, 69, 82]);
const DEFAULT_ACCENT = [1, 0.84, 0.66, 0.78, 0.58];   // on the beat, the "and", the "e"/"a", a triplet, anything finer
// Gobo Kit's characters (core.drums `kit`): FIELD, MACHINE, DUST, 808, 909, ACOUSTIC+
const KITS = { field: 0, machine: 1, dust: 2, 808: 3, 909: 4, plus: 5, acoustic: 5 };
// The kinds that name a kit device of their own: a style written for it plays on it when the studio has it (kitFor's
// `device` lookup), else as an acoustic style does (Studio A, else Gobo Kit's ACOUSTIC+). One entry per kit.
export const KIT_DEVICES = { metal: 'core.metalkit' };
const KIT_NAMES = { 'core.metalkit': 'Rusty Sticks' };
// Studio A, the acoustic kit with articulations and a mic mix (devices/builtin/drumroom.js). Its id has "drum" in it,
// which is how the studio knows a drum track.
export const STUDIO_A = 'core.drumroom';

export function pieceOf(name) {
  const k = String(name).toLowerCase();
  if (Object.hasOwn(DRUM_MAP, k)) return DRUM_MAP[k];
  if (Object.hasOwn(EXTRA, k)) return EXTRA[k];
  if (/^\d{1,3}$/.test(k)) { const n = Number(k); return n >= 0 && n <= 127 ? n : NaN; }
  const p = parsePitch(name);
  return Number.isFinite(p) ? p : NaN;
}
export const pieceName = (p) => DRUM_NAMES[p] || ({ 52: 'China', 55: 'Splash', 57: 'Crash 2', 59: 'Ride 2', 48: 'High-mid tom', 41: 'Low floor tom', 35: 'Kick 2', 40: 'Snare 2' }[p]) || `Note ${p}`;
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'groove';

/* ------------------------------------------------------------------------------------------------ parsing */
function parseKey(key, rest, where, errors) {
  const val = rest.trim();
  switch (key) {
    case 'blurb': case 'feel': case 'tags': return val;
    case 'meter': {
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(val);
      if (!m) { errors.push(`${where}: meter is "4/4"`); return undefined; }
      return [Number(m[1]), Number(m[2])];
    }
    case 'tempo': {
      const m = /^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)$/.exec(val);
      if (!m || !(+m[1] > 20 && +m[2] >= +m[1] && +m[2] < 400)) { errors.push(`${where}: tempo is a range of BPM, like "88-160"`); return undefined; }
      return [Number(m[1]), Number(m[2])];
    }
    case 'swing': {
      if (/^(none|0|off|straight)$/i.test(val)) return null;
      const m = /^(8|16)\s+(\d+(?:\.\d+)?)%?(?:\s*(?:-|–)\s*(\d+(?:\.\d+)?)%?)?$/.exec(val);
      if (!m) { errors.push(`${where}: swing is "8 62%", "16 56%" or "8 66-58%" (slow end to fast end), or none`); return undefined; }
      const a = Number(m[2]), b = m[3] != null ? Number(m[3]) : a;
      if (!(a >= 50 && a <= 80 && b >= 50 && b <= 80)) { errors.push(`${where}: swing runs from 50% (straight) to 80%`); return undefined; }
      return { grid: Number(m[1]), slow: a / 100, fast: b / 100 };
    }
    case 'lay': {
      const out = {};
      const toks = val.split(/\s+/).filter(Boolean);
      if (toks.length % 2) { errors.push(`${where}: lay is pairs of a piece and ms, like "snare +18 hat -4"`); return undefined; }
      for (let i = 0; i < toks.length; i += 2) {
        const name = toks[i].toLowerCase(), ms = Number(toks[i + 1].replace(/ms$/, ''));
        if (!Number.isFinite(ms) || Math.abs(ms) > 60) { errors.push(`${where}: lay ${name} ${toks[i + 1]}: ms between -60 and +60`); continue; }
        if (!FAMILY[name] && !Number.isFinite(pieceOf(name))) { errors.push(`${where}: lay: unknown piece "${name}"`); continue; }
        out[name] = ms;
      }
      return out;
    }
    case 'human': {
      const m = /^(\d+(?:\.\d+)?)\s*ms\s+(\d+(?:\.\d+)?)\s*%$/.exec(val);
      if (!m || +m[1] > 40 || +m[2] > 40) { errors.push(`${where}: human is "<ms>ms <velocity>%", like "5ms 7%"`); return undefined; }
      return { ms: Number(m[1]), vel: Number(m[2]) / 100 };
    }
    case 'accent': {
      const toks = val.split(/\s+/).filter(Boolean);
      const name = toks.shift()?.toLowerCase();
      const nums = toks.map(Number);
      if (!name || !nums.length || nums.some((x) => !(x >= 0 && x <= 1.5))) { errors.push(`${where}: accent is a piece and 1-5 numbers (beat, and, e/a, triplet, finer), like "hat 1 .84 .66"`); return undefined; }
      return { [name]: nums };
    }
    case 'kit': {
      const toks = val.split(/\s+/).filter(Boolean);
      const kind = (toks.shift() || '').toLowerCase();
      if (!Object.hasOwn(KITS, kind) && !Object.hasOwn(KIT_DEVICES, kind)) { errors.push(`${where}: kit is one of ${[...Object.keys(KITS), ...Object.keys(KIT_DEVICES)].join(', ')}`); return undefined; }
      const params = {};
      for (let i = 0; i + 1 < toks.length; i += 2) { const v = Number(toks[i + 1]); if (Number.isFinite(v)) params[toks[i]] = v; else errors.push(`${where}: kit ${toks[i]} needs a number`); }
      return { kind, params };
    }
    case 'studio': return val;   // the Studio A preset that suits the style, by name
    case 'art': {
      // "art open half": on a kit with articulations (Studio A), the open row plays the half-open hat; GM stays the default
      const toks = val.split(/\s+/).filter(Boolean);
      if (toks.length % 2) { errors.push(`${where}: art is pairs of a row and an articulation, like "open half"`); return undefined; }
      const out = {};
      for (let i = 0; i < toks.length; i += 2) {
        const p = pieceOf(toks[i + 1]);
        if (!Number.isFinite(p)) { errors.push(`${where}: art: unknown articulation "${toks[i + 1]}" (a DRUM_MAP name: half, quarter, hatedge, rimshot, rideedge ...)`); continue; }
        out[toks[i].toLowerCase()] = p;
      }
      return out;
    }
    default: return undefined;
  }
}

// One row: "hat x.x. x.x. | x.x. x.x." over a groove of `length` beats -> [{ p, t, d, v, mark, div }]
function parseRow(name, cellsText, length, bpb, where, errors) {
  const p = pieceOf(name);
  if (!Number.isFinite(p)) { errors.push(`${where}: unknown piece "${name}" (a DRUM_MAP name like kick, snare, hat, ride, crash, tom1, or a MIDI number)`); return []; }
  const groups = cellsText.split(/[\s|]+/).filter(Boolean);
  const bars = length / bpb;
  let span;
  if (groups.length === Math.round(length) && Math.abs(length - Math.round(length)) < EPS) span = 1;
  else if (groups.length === 1) span = length;
  else if (Math.abs(bars - Math.round(bars)) < EPS && groups.length === Math.round(bars)) span = bpb;
  else { errors.push(`${where}: ${name} has ${groups.length} groups; write one per beat (${length}), one per bar${bars >= 1 && Math.abs(bars - Math.round(bars)) < EPS ? ` (${Math.round(bars)})` : ''}, or one for the whole groove`); return []; }
  const out = [];
  groups.forEach((g, gi) => {
    const n = g.length, a = gi * span, step = span / n;
    for (let i = 0; i < n; i++) {
      const c = g[i];
      if (REST.has(c)) continue;
      if (!Object.hasOwn(MARKS, c)) { errors.push(`${where}: ${name}: "${c}" isn't a mark (X x O o g f F, or . for a rest)`); continue; }
      out.push({ p, t: r4(a + i * step), d: r4(Math.min(0.5, step)), v: MARKS[c], mark: c, div: n / span, row: name.toLowerCase() });
    }
  });
  return out;
}

const HEAD = /^(intro|verse|chorus|bridge|half|fill|ending)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(bars?|beats?)\s*$/i;
export function parseGrooves(text, { file = 'grooves' } = {}) {
  const styles = [], grooves = [], errors = [];
  let style = null, groove = null;
  const close = () => {
    if (groove && !groove.hits.length) errors.push(`${groove.where}: "${groove.name}" has no hits`);
    groove = null;
  };
  String(text).split('\n').forEach((raw, li) => {
    const where = `${file} line ${li + 1}`;
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const first = line.split(/\s+/)[0].toLowerCase();
    if (first === 'style') {
      close();
      const m = /^style\s+([a-z0-9-]+)\s+(.+)$/i.exec(line);
      if (!m) { errors.push(`${where}: a style opens with "style <id> <Name>"`); style = null; return; }
      if (styles.some((s) => s.id === m[1].toLowerCase())) errors.push(`${where}: style "${m[1]}" is already defined`);
      style = { id: m[1].toLowerCase(), name: m[2].trim(), blurb: '', tempo: [70, 160], feel: '', swing: null, lay: {}, human: { ms: 5, vel: 0.07 }, accent: {}, art: {}, kit: { kind: 'acoustic', params: {} }, studio: null, meter: [4, 4], tags: '', file, grooves: [] };
      styles.push(style);
      return;
    }
    if (!style) { errors.push(`${where}: open a style first ("style <id> <Name>")`); return; }
    const hm = HEAD.exec(line);
    if (hm) {
      close();
      const part = hm[1].toLowerCase(), name = hm[2].trim(), n = Number(hm[3]), unit = hm[4].toLowerCase();
      const bpb = beatsPerBar(style.meter);
      const length = unit.startsWith('bar') ? n * bpb : n;
      if (!(length > 0 && length <= 16 * bpb)) { errors.push(`${where}: a groove is 1 beat to 16 bars long`); return; }
      const id = `${style.id}/${slug(name)}`;
      if (grooves.some((g) => g.id === id)) errors.push(`${where}: "${name}" is already a ${style.name} groove`);
      groove = { id, style: style.id, name, part, length, where, hits: [], rows: [], over: {} };
      grooves.push(groove);
      style.grooves.push(groove);
      return;
    }
    const rest = line.slice(first.length);
    if (KEYS.has(first)) {
      const v = parseKey(first, rest, where, errors);
      if (v === undefined) return;
      const target = groove ? groove.over : style;
      if (first === 'lay' || first === 'accent' || first === 'art') target[first] = { ...(target[first] || (groove ? {} : style[first])), ...v };
      else target[first] = v;
      return;
    }
    if (!groove) { errors.push(`${where}: "${first}" isn't a style line (${[...KEYS].join(', ')}); a groove opens with "<part> <Name> <N> bars"`); return; }
    const bpb = beatsPerBar(style.meter);
    const hits = parseRow(first, rest, groove.length, bpb, where, errors);
    groove.rows.push({ name: first, cells: rest.trim() });
    groove.hits.push(...hits);
  });
  close();
  // each groove's own view of the style (its overrides win)
  for (const g of grooves) {
    const s = styles.find((x) => x.id === g.style);
    finish(g, s);
  }
  return { styles, grooves, errors };
}
function finish(g, s) {
  const o = g.over;
  g.styleName = s.name;
  g.meter = s.meter;
  g.bars = r4(g.length / beatsPerBar(s.meter));
  g.tempo = o.tempo || s.tempo;
  g.feel = o.feel || s.feel;
  g.swing = o.swing !== undefined ? o.swing : s.swing;
  g.lay = o.lay ? { ...s.lay, ...o.lay } : s.lay;
  g.human = o.human || s.human;
  g.accent = o.accent ? { ...s.accent, ...o.accent } : s.accent;
  g.art = o.art ? { ...s.art, ...o.art } : s.art;
  g.kit = s.kit;
  g.hits.sort((a, b) => a.t - b.t || a.p - b.p);
  delete g.over; delete g.where;
}

/* ------------------------------------------------------------------------------------------------ the library */
let LIB = null;
export function library() {
  if (LIB) return LIB;
  const styles = [], grooves = [], errors = [];
  for (const [file, text] of TEXTS) {
    const r = parseGrooves(text, { file });
    for (const s of r.styles) if (!styles.some((x) => x.id === s.id)) styles.push(s); else errors.push(`${file}: style "${s.id}" is defined twice`);
    grooves.push(...r.grooves.filter((g) => !grooves.some((x) => x.id === g.id)));
    errors.push(...r.errors);
  }
  LIB = { styles, grooves, byId: new Map(grooves.map((g) => [g.id, g])), errors };
  return LIB;
}
export const STYLES = () => library().styles;
export const GROOVES = () => library().grooves;

const STYLE_WORDS = {
  'boom bap': 'boombap', 'boom-bap': 'boombap', 'hip hop': 'boombap', 'hip-hop': 'boombap', hiphop: 'boombap', rap: 'boombap',
  'neo soul': 'neosoul', 'neo-soul': 'neosoul', soul: 'neosoul', 'r&b': 'neosoul', rnb: 'neosoul',
  'lo fi': 'lofi', 'lo-fi': 'lofi', chill: 'lofi', 'drum and bass': 'dnb', 'drum & bass': 'dnb', 'drum n bass': 'dnb', jungle: 'dnb', 'd&b': 'dnb',
  blues: 'shuffle', 'blues shuffle': 'shuffle', 'one drop': 'reggae', ska: 'reggae', 'bossa nova': 'bossa', brazilian: 'samba',
  'afro beat': 'afrobeat', 'afro-beat': 'afrobeat', dance: 'house', techno: 'house', edm: 'house', 'four on the floor': 'house',
  'train beat': 'country', 'double kick': 'metal', heavy: 'metal', 'pop punk': 'punk', 'pop-punk': 'punk', swing: 'jazz', bebop: 'jazz',
  church: 'gospel', soulful: 'gospel', 'indie rock': 'indie', alternative: 'indie', alt: 'indie', 'garage rock': 'indie', 'sixties soul': 'motown', '60s soul': 'motown', northern: 'motown',
};
export function getStyle(word) {
  if (!word) return null;
  const k = String(word).trim().toLowerCase();
  const all = library().styles;
  return all.find((s) => s.id === k) || all.find((s) => s.name.toLowerCase() === k) || all.find((s) => s.id === STYLE_WORDS[k]) || null;
}
// A style named anywhere in a sentence ("give me a funk beat"), or null. Only genre names count here: words that are
// also plain words (swing, heavy, chill, dance, soul) are a feel, not a style, in a sentence.
const GENRE_WORDS = ['boom bap', 'boom-bap', 'hip hop', 'hip-hop', 'hiphop', 'neo soul', 'neo-soul', 'r&b', 'rnb', 'lo fi', 'lo-fi', 'drum and bass', 'drum & bass', 'drum n bass', 'jungle', 'd&b', 'blues shuffle', 'blues', 'one drop', 'bossa nova', 'afro beat', 'afro-beat', 'techno', 'edm', 'train beat', 'pop punk', 'pop-punk', 'bebop', 'indie rock', 'garage rock', 'sixties soul', '60s soul'];
export function styleIn(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9&\s-]+/g, ' ')} `;
  const all = library().styles;
  for (const w of [...GENRE_WORDS].sort((a, b) => b.length - a.length)) if (t.includes(` ${w} `)) return getStyle(STYLE_WORDS[w] || w);
  for (const s of all) if (t.includes(` ${s.id} `) || t.includes(` ${s.name.toLowerCase()} `)) return s;
  return null;
}
export function getGroove(word, { style = null } = {}) {
  if (!word) return null;
  if (typeof word === 'object' && word.hits) return word;
  const L = library(), k = String(word).trim().toLowerCase();
  if (L.byId.has(k)) return L.byId.get(k);
  const pool = style ? L.grooves.filter((g) => g.style === (getStyle(style)?.id || style)) : L.grooves;
  return pool.find((g) => g.name.toLowerCase() === k) || pool.find((g) => `${g.styleName} ${g.name}`.toLowerCase() === k) || pool.find((g) => g.id.endsWith('/' + slug(k))) || null;
}
// The grooves of a style for a part (main grooves first by the order they're written).
export const groovesFor = (style, part) => library().grooves.filter((g) => g.style === style && g.part === part);

// Search: every filter that's given narrows; words (query) score names, styles, parts and feels.
export function findGrooves({ style = null, part = null, feel = null, tempo = null, query = null, limit = 12, length = null } = {}) {
  let list = library().grooves.slice();
  if (style) { const s = getStyle(style); list = s ? list.filter((g) => g.style === s.id) : []; }
  if (part) { const ps = (Array.isArray(part) ? part : [part]).map((x) => partWord(x)).filter(Boolean); list = list.filter((g) => ps.includes(g.part)); }
  if (length) list = list.filter((g) => Math.abs(g.length - length) < EPS);
  if (tempo) list = list.filter((g) => tempo >= g.tempo[0] - 6 && tempo <= g.tempo[1] + 6);
  const words = [feel, query].filter(Boolean).join(' ').toLowerCase().split(/[^a-z0-9%-]+/).filter((w) => w.length > 1 && !STOP.has(w));
  if (words.length) {
    const scored = list.map((g) => {
      const hay = `${g.name} ${g.styleName} ${g.style} ${g.part} ${PART_LABEL[g.part]} ${g.feel} ${library().styles.find((s) => s.id === g.style)?.blurb || ''} ${g.rows.map((r) => r.name).join(' ')}`.toLowerCase();
      return { g, s: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    list = scored.map((x) => x.g);
  }
  return list.slice(0, Math.max(1, limit));
}
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'with', 'groove', 'grooves', 'beat', 'beats', 'drum', 'drums', 'pattern', 'me', 'some']);
export function partWord(w) {
  const k = String(w || '').toLowerCase().trim();
  if (PARTS.includes(k)) return k;
  if (/half/.test(k)) return 'half';
  if (/^(fills?|break|turnaround)$/.test(k)) return 'fill';
  if (/intro|count|start/.test(k)) return 'intro';
  if (/end|outro|finish|last/.test(k)) return 'ending';
  if (/chorus|hook|refrain/.test(k)) return 'chorus';
  if (/bridge|middle/.test(k)) return 'bridge';
  if (/verse/.test(k)) return 'verse';
  return null;
}

/* ------------------------------------------------------------------------------------------------ playing it */
// The swing a groove has at a tempo: the fraction of the beat (8) or half beat (16) the offbeat lands on.
export function swingAt(g, tempo) {
  const s = g.swing;
  if (!s) return null;
  const [lo, hi] = g.tempo, x = hi > lo ? clamp((tempo - lo) / (hi - lo), 0, 1) : 0.5;
  return { grid: s.grid, at: s.slow + (s.fast - s.slow) * x };
}
function swung(t, div, sw) {
  if (!sw || ![1, 2, 4, 8].includes(Math.round(div * 1000) / 1000)) return t;
  const b = Math.floor(t + EPS), f = t - b;
  if (Math.abs(f * 4 - Math.round(f * 4)) > 1e-6) return t;
  const s = sw.at;
  const warp = (r) => (r < 0.5 ? (r / 0.5) * s : s + ((r - 0.5) / 0.5) * (1 - s));
  if (sw.grid === 8) return b + warp(f);
  const h = f < 0.5 - EPS ? 0 : 0.5;
  return b + h + 0.5 * warp((f - h) / 0.5);
}
function accentOf(g, h) {
  const prof = g.accent[h.row] || g.accent[familyOf(h.p)] || (KEEPERS.has(h.p) ? DEFAULT_ACCENT : null);
  if (!prof) return 1;
  const f = h.t - Math.floor(h.t + EPS);
  const at = (k) => prof[Math.min(k, prof.length - 1)];
  if (Math.abs(f) < 1e-6) return at(0);
  if (Math.abs(f - 0.5) < 1e-6) return prof.length > 1 ? at(1) : at(0);
  if (Math.abs(f - 0.25) < 1e-6 || Math.abs(f - 0.75) < 1e-6) return prof.length > 2 ? at(2) : Math.min(...prof);
  if (Math.abs(f * 3 - Math.round(f * 3)) < 1e-6) return prof.length > 3 ? at(3) : Math.min(...prof);
  return prof.length > 4 ? at(4) : Math.min(...prof) * 0.92;
}
function layOf(g, h) {
  const l = g.lay;
  if (Object.hasOwn(l, h.row)) return l[h.row];
  const fam = familyOf(h.p);
  return Object.hasOwn(l, fam) ? l[fam] : 0;
}
// ~N(0, 1) from four uniforms (no Math.log or Math.cos: the same bits in every engine)
const gauss = (R) => (R() + R() + R() + R() - 2) * SQ3;
const PHI = 0.86, INNOV = Math.sqrt(1 - PHI * PHI), PHI_V = 0.96, INNOV_V = Math.sqrt(1 - PHI_V * PHI_V);

// The groove as a drummer plays it at this tempo: notes [{ p, t, d, v }] from 0 (beats). length: how many beats to
// play (it loops; default its own length); offset: where in its loop to start. human: 0 is the bare grid with swing,
// accents and lay; 1 the style's humanising; 2 twice that. seed: the same seed gives the same notes.
// articulations: true on a kit that has them (Studio A): rows the groove's `art` lines name play those articulations,
// and a snare flam is the kit's own flam note. Off (the default), every note is General MIDI, for any kit.
export function realize(groove, { tempo = 120, seed = 1, human = 1, length = null, offset = 0, swing = true, articulations = false } = {}) {
  const g = getGroove(groove);
  if (!g) throw new Error(`no groove "${groove}"`);
  const L = g.length, total = length == null ? L : Math.max(0, Number(length));
  const R = rng(`${g.id}:${seed}`);
  const sw = swing ? swingAt(g, tempo) : null;
  const perMs = tempo / 60000;   // beats per millisecond at this tempo
  const hum = g.human, amt = clamp(Number(human) || 0, 0, 3);
  const evs = [];
  for (let k = Math.floor((offset + EPS) / L); k * L < offset + total - EPS; k++) {
    for (const h of g.hits) {
      const tg = k * L + h.t - offset;
      if (tg < -EPS || tg >= total - EPS) continue;
      evs.push({ h, tg, loopT: k * L + h.t });
    }
  }
  evs.sort((a, b) => a.tg - b.tg || a.h.p - b.h.p);
  let drift = 0, vdrift = 0, step = Math.round((evs[0]?.tg || 0) * 4);
  const out = [];
  for (const { h, tg, loopT } of evs) {
    const s16 = Math.round(tg * 4);
    while (step < s16) { drift = PHI * drift + INNOV * gauss(R); vdrift = PHI_V * vdrift + INNOV_V * gauss(R); step++; }
    let t = swung(loopT, h.div, sw) - loopT + tg;
    t += layOf(g, h) * perMs;
    const white = gauss(R), vw = gauss(R);
    t += amt * hum.ms * (0.7 * drift + 0.55 * white) * perMs;
    let v = h.v * accentOf(g, h);
    v *= 1 + amt * hum.vel * (vw + 0.5 * vdrift);
    const d = h.d, p = articulations && Object.hasOwn(g.art || {}, h.row) ? g.art[h.row] : h.p;
    const flam = h.mark === 'f' || h.mark === 'F';
    if (flam && articulations && (h.p === 38 || h.p === 40)) { out.push({ p: FLAM, t, d, v }); continue; }
    if (flam) out.push({ p, t: t - 26 * perMs, d: Math.min(d, 0.125), v: v * 0.38 });
    out.push({ p, t, d, v });
  }
  const end = total - 1 / 128;
  const down = (x) => Math.floor(x * 10000 + 1e-7) / 10000;   // a length rounded down, so a note never runs past the end
  return out.map((n) => { const t = r4(clamp(n.t, 0, end)); return { p: n.p, t, d: down(Math.max(1 / 64, Math.min(n.d, total - t))), v: r4(clamp(n.v, 0.05, 1)) }; })
    .filter((n) => n.t < total - EPS)
    .sort((a, b) => a.t - b.t || a.p - b.p);
}

// How many bars a groove fills when it's put in the song and nobody said: a main groove four (or its own length when
// longer), an intro or an ending its own length; a fill isn't counted in bars (it lands at the end of one).
export const defaultBars = (g) => (MAIN_PARTS.includes(g.part) ? Math.max(4, Math.round(g.bars)) : Math.max(1, Math.round(g.bars)));
export function lengthLabel(g) {
  const bpb = beatsPerBar(g.meter || [4, 4]), b = g.length / bpb;
  if (Math.abs(b - Math.round(b)) < EPS && b >= 1) return `${Math.round(b)} bar${Math.round(b) === 1 ? '' : 's'}`;
  return `${r4(g.length)} beat${Math.abs(g.length - 1) < EPS ? '' : 's'}`;
}
// The rows as written, one per line: what an agent reads (and can write back as a style file).
export function gridText(g) { return g.rows.map((r) => `${r.name.padEnd(6)} ${r.cells}`).join('\n'); }
// A one-line summary for people who can't see the picture: "kick 3, snare 2 (1 ghost), hat 8".
export function describe(g) {
  const by = new Map();
  for (const h of g.hits) {
    const k = h.row;
    const x = by.get(k) || { n: 0, ghost: 0, acc: 0 };
    x.n++; if (h.mark === 'o') x.ghost++; if (h.mark === 'X' || h.mark === 'F') x.acc++;
    by.set(k, x);
  }
  return [...by].map(([k, x]) => `${k} ${x.n}${x.ghost ? ` (${x.ghost} ghost${x.ghost === 1 ? '' : 's'})` : ''}`).join(', ');
}
export const grooveTitle = (g) => `${g.styleName}, ${g.name}`;

/* ------------------------------------------------------------------------------------------------ tap-to-find */
// The grids a tapped rhythm might sit on, within one beat: straight sixteenths, eighth-note triplets (a shuffle), and
// sixteenths with the eighths (8) or the sixteenths (16) swung. main: the positions that aren't syncopation; cost: how
// much less likely the reading is than a straight one.
const swing8 = (s) => ({ grid: `swing 8 ${Math.round(s * 100)}%`, pos: [0, s / 2, s, s + (1 - s) / 2], main: [0, s], step: 0.25, cost: 0.12 });
const swing16 = (s) => ({ grid: `swing 16 ${Math.round(s * 100)}%`, pos: [0, s / 2, 0.5, 0.5 + s / 2], main: [0, 0.5], step: 0.25, cost: 0.12 });
const READINGS = [
  { grid: 'straight', pos: [0, 0.25, 0.5, 0.75], main: [0, 0.5], step: 0.25, cost: 0 },
  { grid: 'triplets', pos: [0, 1 / 3, 2 / 3], main: [0, 2 / 3], step: 1 / 3, cost: 0.15 },   // (a shuffle's "let" is a pulse)
  swing8(0.58), swing8(0.62), swing16(0.56), swing16(0.6), swing16(0.64),
];
// The tempo a tapped rhythm was played at. seconds: tap times (any origin). Every tempo from lo to hi is tried with every
// reading above, each with the first tap on each of its positions: how well the taps sit on it (in grid steps, so a
// finer grid isn't free: the taps' own spread counts against it), how many land off the main pulses, the reading's own
// cost, and a prior around 105 BPM (where people tap most comfortably). The best is fitted by least squares through
// the taps' places on it. -> { bpm, grid, beats (each tap in beats from the beat it fell in), phase (s) } | null with
// fewer than 3 taps.
export function tempoFromTaps(seconds, { lo = 56, hi = 200 } = {}) {
  const t = [...seconds].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (t.length < 3 || t[t.length - 1] - t[0] < 0.2) return null;
  const n = t.length, t0 = t[0];
  const place = (P, a, R) => t.map((x) => {
    const u = (x - a) / P, k = Math.floor(u + EPS), f = u - k;
    let best = null;
    for (const q of [...R.pos, 1]) { const d = Math.abs(f - q); if (!best || d < best.d) best = { d, q }; }
    return { k: best.q === 1 ? k + 1 : k, q: best.q === 1 ? 0 : best.q, d: best.d };
  });
  let best = null;
  for (let bpm = lo; bpm <= hi + EPS; bpm += 0.5) {
    const P = 60 / bpm, pr = Math.log2(bpm / 105) / 0.62, prior = 0.5 * pr * pr;
    for (const R of READINGS) {
      for (const q0 of R.pos) {
        const a = t0 - q0 * P;
        let err = 0, off = 0;
        for (const x of place(P, a, R)) { const e = x.d / R.step; err += e * e; if (!R.main.some((m) => Math.abs(m - x.q) < EPS)) off++; }
        const cost = err / n / 0.012 + 0.9 * (off / n) + R.cost + prior;
        if (!best || cost < best.cost - 1e-12) best = { bpm, cost, R, a };
      }
    }
  }
  // least squares through the taps' places: t_i = a + (k_i + q_i) * P
  const pl = place(60 / best.bpm, best.a, best.R).map((x) => x.k + x.q);
  const mk = pl.reduce((s, x) => s + x, 0) / n, mt = t.reduce((s, x) => s + x, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (pl[i] - mk) * (t[i] - mt); den += (pl[i] - mk) * (pl[i] - mk); }
  const P = den > 0 ? num / den : 60 / best.bpm, a = mt - P * mk;
  const bpm = clamp(60 / P, lo * 0.9, hi * 1.1);
  return { bpm: Math.round(bpm * 10) / 10, grid: best.R.grid, beats: t.map((x) => (x - a) / (60 / bpm)), phase: a };
}

// Where a groove's hits are (beats in its loop, swung at its middle tempo), by family: what taps are matched against.
// Each set is { main, any }: main the hits a person taps (accents and plain hits), any adds the ghost notes, which a tap
// may land on (it counts, a little less) but nobody has to tap. all is every hit in the groove.
const ONSETS = new Map();
export function onsetsOf(g) {
  if (ONSETS.has(g.id)) return ONSETS.get(g.id);
  const mid = (g.tempo[0] + g.tempo[1]) / 2, sw = swingAt(g, mid);
  const at = (h) => r4(swung(h.t, h.div, sw));
  const uniq = (xs) => [...new Set(xs)].sort((a, b) => a - b);
  const set = (fn) => {
    const hs = g.hits.filter(fn);
    const main = uniq(hs.filter((h) => h.v >= 0.6).map(at));
    return { main, any: uniq(hs.map(at)).map((p) => ({ p, w: main.includes(p) ? 1 : 0.85 })) };
  };
  const o = {
    kick: set((h) => familyOf(h.p) === 'kick'),
    snare: set((h) => familyOf(h.p) === 'snare'),
    ks: set((h) => familyOf(h.p) === 'kick' || familyOf(h.p) === 'snare'),
    all: set(() => true),
  };
  o.all.main = o.all.any.map((x) => x.p);   // every hit counts once, ghost or not
  o.all.any = o.all.any.map((x) => ({ p: x.p, w: 1 }));
  ONSETS.set(g.id, o);
  return o;
}
const TAU = 0.15;   // beats: how far a tap may sit from a hit and still count (a sixteenth is 0.25)
const credit = (d) => (d >= TAU ? 0 : 1 - (d / TAU) * (d / TAU));
// Soft F-score of taps (unrolled beats, shifted onto the groove's loop) against a set: precision against every hit a
// tap may land on (set.any, ghost notes a little less), recall against the hits a person would tap (set.main), over the
// stretch that was tapped.
function fscore(xs, set0, L) {
  // a voice played only as ghost notes (jazz comping, a feathered kick): its ghosts are its main hits
  const set = set0.main.length ? set0 : { main: set0.any.map((x) => x.p), any: set0.any.map((x) => ({ p: x.p, w: 1 })) };
  if (!xs.length || !set.main.length) return { f: 0, hit: 0 };
  let cp = 0, hit = 0;
  for (const x of xs) {
    const m = ((x % L) + L) % L;
    let c = 0;
    for (const o of set.any) { const e = Math.abs(o.p - m); c = Math.max(c, credit(Math.min(e, L - e)) * o.w); }
    cp += c; if (c > 0.5) hit++;
  }
  const P = cp / xs.length;
  const a = xs[0] - TAU, b = xs[xs.length - 1] + TAU;
  let want = 0, got = 0;
  for (let k = Math.floor(a / L) - 1; k * L <= b; k++) {
    for (const o of set.main) {
      const y = k * L + o;
      if (y < a || y > b) continue;
      want++;
      let d = Infinity;
      for (const x of xs) d = Math.min(d, Math.abs(x - y));
      got += credit(d);
    }
  }
  const Rc = want ? got / want : 0;
  return { f: P + Rc > 0 ? (2 * P * Rc) / (P + Rc) : 0, hit };
}
// How well a tempo suits a groove: 1 inside its range, falling away outside it (a quarter out: about a third).
export function tempoFit(g, bpm) {
  const [lo, hi] = g.tempo;
  const rel = bpm < lo ? (lo - bpm) / lo : bpm > hi ? (bpm - hi) / hi : 0;
  return Math.exp(-(rel / 0.25) * (rel / 0.25));
}
// taps: [{ t (seconds), voice?: 'kick' | 'snare' | 'hat' | ... }] (or plain seconds). Kick and snare first, every
// piece second: with taps on two or more pads they are matched voice by voice (kick taps against the kick, snare taps
// against the snare family), else all of them against the kick and snare together; then all of them against every
// hit. Every cyclic shift that puts the first tap on one of the groove's hits is tried, at the tapped tempo and at the
// other readings of the same taps (half and double: half-time and double-time; 2/3, 3/4, 4/5 and their inverses: a
// swung or triplet feel read as straight, or the other way round), each weighed by how well that tempo suits the
// groove (tempoFit), and the best of each groove counts.
// -> { bpm, taps, results: [{ groove, score, matched, of, shift, bpm }] } (results best first), or null.
const RATIOS = [[1, 1], [0.5, 0.97], [2, 0.97], [4 / 3, 0.95], [3 / 4, 0.95], [3 / 2, 0.95], [2 / 3, 0.95], [5 / 4, 0.93], [4 / 5, 0.93]];
export function matchTaps(taps, { limit = 5, parts = MAIN_PARTS, styles = null, tempo = null } = {}) {
  const list = (taps || []).map((x) => (typeof x === 'number' ? { t: x } : { t: Number(x.t), voice: x.voice ? String(x.voice).toLowerCase() : null })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  const est = tempo ? { bpm: tempo, beats: list.map((x) => ((x.t - list[0].t) * tempo) / 60) } : tempoFromTaps(list.map((x) => x.t));
  if (!est) return null;
  const voices = new Set(list.map((x) => voiceFamily(x.voice)).filter(Boolean));
  const voiced = voices.size >= 2;
  const pool = library().grooves.filter((g) => (!parts || parts.includes(g.part)) && (!styles || styles.includes(g.style)) && g.length >= 1);
  const cands = (tempo ? [[1, 1]] : RATIOS).map(([k, w]) => ({ bpm: est.bpm * k, k, w })).filter((c) => c.bpm >= 48 && c.bpm <= 250);
  const best = new Map();
  for (const c of cands) {
    const beats = est.beats.map((b) => b * c.k);
    const b0 = beats[0];
    const xs = beats.map((b) => b - b0);
    const byVoice = (v) => xs.filter((_, i) => voiceFamily(list[i].voice) === v);
    for (const g of pool) {
      const o = onsetsOf(g), L = g.length, fitT = tempo ? 1 : tempoFit(g, c.bpm);
      if (fitT * c.w < 0.2) continue;
      const shifts = new Set(o.all.main);
      for (const sh of shifts) {
        const ys = xs.map((x) => x + sh);
        let ks;
        if (voiced) {
          const kx = byVoice('kick').map((x) => x + sh), sx = byVoice('snare').map((x) => x + sh);
          const a = fscore(kx, o.kick, L), b = fscore(sx, o.snare, L);
          const n = kx.length + sx.length;
          ks = n ? { f: (a.f * kx.length + b.f * sx.length) / n, hit: a.hit + b.hit } : { f: 0, hit: 0 };
        } else ks = fscore(ys, o.ks.main.length ? o.ks : o.all, L);
        const all = fscore(ys, o.all, L);
        const score = (0.7 * ks.f + 0.3 * all.f) * c.w * fitT;
        const prev = best.get(g.id);
        if (!prev || score > prev.score + 1e-9) best.set(g.id, { groove: g, score: r4(score), matched: Math.max(all.hit, ks.hit), of: xs.length, shift: r4(((sh % L) + L) % L), bpm: Math.round(c.bpm * 10) / 10 });
      }
    }
  }
  const order = (g) => PARTS.indexOf(g.part);
  const results = [...best.values()].sort((a, b) => b.score - a.score || order(a.groove) - order(b.groove) || a.groove.id.localeCompare(b.groove.id)).slice(0, Math.max(1, limit));
  return { bpm: est.bpm, taps: list.length, voiced, results };
}
function voiceFamily(v) {
  if (!v) return null;
  if (/kick|bd|bass/.test(v)) return 'kick';
  if (/snare|sd|clap|rim|stick/.test(v)) return 'snare';
  return 'other';
}

/* ------------------------------------------------------------------------------------------------ into the song */
// The kit a style plays on: a kind with a kit of its own (KIT_DEVICES) on that kit when the studio has it (device: id ->
// its definition or null; leave it out and the style plays as an acoustic one); an acoustic style on Studio A when the
// studio has it, set to the preset the style's `studio` line names (studioA: Studio A's definition, for its presets;
// true works too, with its defaults), else Gobo Kit's acoustic character (ACOUSTIC+, where velocity moves the colour); a
// machine style on Gobo Kit's machine of its kind. -> { device, params, preset }
export function kitFor(style, { studioA = null, device = null } = {}) {
  const s = typeof style === 'string' ? getStyle(style) : style;
  let kit = s?.kit || { kind: 'acoustic', params: {} };
  if (Object.hasOwn(KIT_DEVICES, kit.kind)) {
    const id = KIT_DEVICES[kit.kind];
    if (device && device(id)) return { device: id, params: { ...kit.params }, preset: null };
    kit = { kind: 'acoustic', params: {} };   // (its params are its own kit's: none of them carry over)
  }
  if ((kit.kind === 'acoustic' || kit.kind === 'plus' || kit.kind === 'field') && studioA) {
    const presets = typeof studioA === 'object' && Array.isArray(studioA.presets) ? studioA.presets : [];
    const pr = s?.studio ? presets.find((x) => String(x.name).toLowerCase() === s.studio.toLowerCase()) : null;
    return { device: STUDIO_A, params: pr ? { ...pr.params } : {}, preset: pr ? pr.name : null };
  }
  return { device: 'core.drums', params: { kit: KITS[kit.kind] ?? 5, ...kit.params }, preset: null };
}
const kitName = (kit) => (kit.device === STUDIO_A ? `Studio A${kit.preset ? ` (${kit.preset})` : ''}` : KIT_NAMES[kit.device] || 'Gobo Kit');
const isDrumTrack = (t, isDrum) => !!t && t.kind === 'instrument' && !!t.instrument && (isDrum ? isDrum(t) : /drum|studioa/i.test(t.instrument.device));
function uniqueName(p, name) {
  const used = new Set(p.tracks.map((t) => t.name.toLowerCase()));
  let n = name, i = 2;
  while (used.has(n.toLowerCase())) n = `${name} ${i++}`;
  return n;
}
function freeColor(p) {
  const used = new Set(p.tracks.map((t) => t.color));
  const pref = ['var(--c-1)', 'var(--c-4)', 'var(--c-7)', 'var(--c-3)', 'var(--c-2)', 'var(--c-6)', 'var(--c-8)', 'var(--c-5)'];
  return pref.find((c) => !used.has(c)) || pref[p.tracks.length % pref.length];
}
const barsText = (a, b) => (b > a ? `bars ${a}–${b}` : `bar ${a}`);
const count = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const listText = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
// a deterministic seed from words (the same groove at the same bar plays the same notes)
export function seedFrom(...parts) {
  let h = 2166136261;
  for (const ch of parts.join(':')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % 1000000;
}
function meterError(p) {
  const m = p.meter || [4, 4];
  if (m[0] === 4 && m[1] === 4) return null;
  return { error: `the library's grooves are in 4/4, and this song is in ${m[0]}/${m[1]}`, hint: 'a style file in app/src/core/grooves/ can add grooves in another meter (meter 3/4); until then, write the beat in the Beat tab' };
}

// Put one groove on a drum track at a bar: -> { ops, summary, label, start, length, track, newTrack, groove, notes }
// track: a drum track's id or name; null or "new": a new Drums track ("new" always means that, so a track named "new"
// is reached by its id). bar: 1-based. bars: how many bars it plays (a main groove loops to fill them; default its own
// length). A fill lands at the end of the bar (a one-beat fill on its last beat).
// under: what happens to clips already on the track there. 'cut' cuts them away, as a clip dropped in the arranger
// cuts (planDrop: core/arrangement.js planDropTrim, passed in so this file stays free of the arranger's planners);
// 'refuse' (the agents' tool) changes nothing and says what is there. The hints are the agents' (the Grooves tab shows
// a person the error alone): they name use_groove's track "new", since leaving the track out picks the selected or
// first drum track again.
export const isNewTrack = (track) => typeof track === 'string' && track.trim().toLowerCase() === 'new';
const NEW_HINT = 'give track "new" for a new Drums track';
export function planPut(p, { groove, track = null, bar = 1, bars = null, seed = null, studioA = false, device = null, human = 1, planDrop = null, isDrum = null, under = 'cut' } = {}) {
  const g = getGroove(groove);
  if (!g) return { error: `no groove "${groove}"`, hint: 'find_grooves lists them; ids look like "rock/straight-eighths"' };
  const me = meterError(p);
  if (me) return me;
  const bpb = beatsPerBar(p.meter);
  const b = Math.max(1, Math.floor(Number(bar) || 1));
  let start, length;
  if (g.length < bpb - EPS) { start = (b - 1) * bpb + (bpb - g.length); length = g.length; }
  else {
    const n = bars == null ? Math.max(1, Math.round(g.length / bpb)) : Math.max(1, Math.min(64, Math.round(Number(bars) || 1)));
    start = (b - 1) * bpb; length = n * bpb;
  }
  let t = null;
  if (track && !isNewTrack(track)) {
    t = p.tracks.find((x) => x.id === track) || p.tracks.find((x) => x.name.toLowerCase() === String(track).toLowerCase());
    if (!t) return { error: `no track "${track}"`, hint: `tracks: ${p.tracks.map((x) => `"${x.name}"`).join(', ') || 'none'}; or ${NEW_HINT}` };
    if (!isDrumTrack(t, isDrum)) return { error: `${t.name} isn't a drum track (it plays ${t.instrument?.device || 'audio'})`, hint: `name a drum track, or ${NEW_HINT}` };
  }
  const b0 = Math.floor(start / bpb + EPS) + 1, b1 = Math.ceil((start + length) / bpb - EPS);
  const where = g.length < bpb - EPS ? `the end of bar ${b0}` : barsText(b0, b1);
  if (t && under === 'refuse') {
    const there = t.clips.filter((c) => c.start < start + length - EPS && c.start + c.length > start + EPS);
    if (there.length) return { error: `${barsText(b0, b1)} on ${t.name} already ${there.length === 1 ? 'holds' : 'hold'} ${listText(there.map((c) => `"${c.name || 'a clip'}"`))}`, hint: `pick bars that are free, ${NEW_HINT}, or ask the human whether to replace what's there`, occupied: there.map((c) => ({ clip: c.id, name: c.name || null, start: c.start, length: c.length })) };
  }
  const s = seed == null ? seedFrom(g.id, t?.id || 'new', b) : seed;
  const kit = t ? null : kitFor(g.style, { studioA, device });
  // Studio A plays the groove's articulations; any other kit, General MIDI
  const onStudioA = t ? t.instrument?.device === STUDIO_A : kit.device === STUDIO_A;
  const notes = realize(g, { tempo: p.tempo, seed: s, human, length, articulations: onStudioA });
  const name = grooveTitle(g);
  const ops = [];
  let cut = '';
  if (t) {
    if (planDrop) {
      const d = planDrop(p, [{ track: t.id, start, end: start + length }]);
      if (d?.ops?.length) { ops.push(...d.ops); cut = d.summary || ''; }
    }
    ops.push({ type: 'clip.add', track: t.id, ref: 'groove', clip: { kind: 'notes', start, length, name, notes } });
  } else {
    ops.push({ type: 'track.add', ref: 'drums', track: { name: uniqueName(p, 'Drums'), kind: 'instrument', color: freeColor(p), instrument: { device: kit.device, params: kit.params } } });
    ops.push({ type: 'clip.add', track: '$drums', ref: 'groove', clip: { kind: 'notes', start, length, name, notes } });
  }
  const on = t ? t.name : `a new track, ${ops[0].track.name}${kit.device === STUDIO_A ? ' on Studio A' : KIT_NAMES[kit.device] ? ` on ${KIT_NAMES[kit.device]}` : ''}`;
  const summary = `${name} on ${on}, ${where} (${g.length < bpb - EPS ? lengthLabel(g) : count(Math.round(length / bpb), 'bar')}, ${count(notes.length, 'hit')}, at ${p.tempo} BPM).${cut ? ' ' + cut : ''}`;
  return { ops, summary, label: `${name} at ${where}`, where, start, length, bars: [b0, b1], track: t?.id || null, trackName: t ? t.name : ops[0].track.name, newTrack: !t, groove: g, notes: notes.length, seed: s, cut };
}

/* ------------------------------------------------------------------------------------------------ the song creator */
// Which part a section is, by its name: -> part | 'outro' | null (no clue in the name)
export function partOfName(name) {
  const n = String(name || '').toLowerCase();
  if (/\bintro|opening|count[- ]?in/.test(n)) return 'intro';
  if (/\boutro|\bcoda|\bending|\bend\b|\btag\b|\bfinale/.test(n)) return 'outro';
  if (/\bhalf|breakdown|\bbreak\b|\bdrop\b/.test(n)) return 'half';
  if (/pre[- ]?chorus|\bbuild|\blift|\bclimb/.test(n)) return 'verse';
  if (/chorus|\bhook|refrain|\bsolo/.test(n)) return 'chorus';
  if (/bridge|middle ?8|middle eight|interlude|^b\s*\d*$/.test(n)) return 'bridge';   // (A and B of an AABA form)
  if (/verse|\brap\b|^v\s*\d*$|^a\s*\d*$/.test(n)) return 'verse';
  return null;
}
// How busy each section is, from the parts that aren't drums: velocity-weighted notes per beat. -> number per section
export function sectionEnergy(p, sections, { isDrum = null } = {}) {
  return sections.map((s) => {
    let e = 0;
    for (const t of p.tracks) {
      if (isDrumTrack(t, isDrum) || t.mute) continue;
      for (const c of t.clips) {
        if (c.kind !== 'notes' || c.mute) continue;
        for (const n of c.notes) { const at = c.start + n.t; if (at >= s.start - EPS && at < s.start + s.length - EPS) e += n.v ?? 0.8; }
      }
    }
    return s.length > 0 ? e / s.length : 0;
  });
}
// The style a song wants, when nobody named one: the family whose grooves are closest to its drums (the matcher, on
// the drum part's hits), else one played at the song's tempo.
export function styleForSong(p, { isDrum = null } = {}) {
  const drums = p.tracks.filter((t) => isDrumTrack(t, isDrum) && !t.mute);
  const hits = [];
  for (const t of drums) for (const c of t.clips) if (c.kind === 'notes' && !c.mute) for (const n of c.notes) hits.push({ t: ((c.start + n.t) * 60) / p.tempo, voice: familyOf(n.p) === 'kick' ? 'kick' : familyOf(n.p) === 'snare' ? 'snare' : 'hat' });
  const window = hits.sort((a, b) => a.t - b.t).slice(0, 48);
  if (window.length >= 4) {
    const m = matchTaps(window, { tempo: p.tempo, limit: 1 });
    if (m?.results?.length && m.results[0].score > 0.45) return { style: getStyle(m.results[0].groove.style), why: `closest to the song's drums (${m.results[0].groove.name})` };
  }
  const pref = ['pop', 'rock', 'funk', 'indie', 'motown', 'neosoul', 'boombap', 'house', 'disco', 'lofi', 'reggae', 'trap', 'dnb', 'punk', 'metal'];
  const fits = library().styles.filter((s) => p.tempo >= s.tempo[0] && p.tempo <= s.tempo[1]);
  const s = pref.map((id) => fits.find((x) => x.id === id)).find(Boolean) || fits[0] || getStyle('pop');
  return { style: s, why: `played at ${p.tempo} BPM` };
}

// The sections the song creator writes over, in order: the song's own (a bar or longer), or with none, one made over
// the loop when it's on, else over the song's length. -> { secs: [{ id, name, start, length }], made }
function songSections(p, bpb) {
  const secs = (p.sections || []).filter((s) => s.length >= bpb - EPS).map((s) => ({ id: s.id, name: s.name, start: s.start, length: s.length })).sort((a, b) => a.start - b.start);
  if (secs.length) return { secs, made: null };
  let a, b;
  const onLoop = !!p.loop?.on && p.loop.end - p.loop.start >= bpb - EPS;
  if (onLoop) { a = Math.floor(p.loop.start / bpb + EPS) * bpb; b = Math.ceil(p.loop.end / bpb - EPS) * bpb; }
  else {
    let end = 0;
    for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
    a = 0; b = Math.max(4 * bpb, Math.ceil(end / bpb - EPS) * bpb);
  }
  const made = { name: 'Verse', start: a, length: b - a, from: onLoop ? 'the loop' : "the song's length" };
  return { secs: [{ id: null, name: made.name, start: a, length: b - a }], made };
}
// Whether the loop goes round the drums' end: it's on and holds their last bar (counted in whole bars), so an ending
// written there would play on every pass.
function loopsAt(p, end, bpb) {
  const lp = p.loop;
  if (!lp?.on || !(lp.end - lp.start > EPS)) return false;
  const a = Math.floor(lp.start / bpb + EPS) * bpb, b = Math.ceil(lp.end / bpb - EPS) * bpb;
  return a < end - EPS && b >= end - EPS;
}
export function songLoops(p) {
  const bpb = beatsPerBar(p.meter || [4, 4]), last = songSections(p, bpb).secs.at(-1);
  return !!last && loopsAt(p, last.start + last.length, bpb);
}

// The plan and ops for a whole drum track, on a new track: one clip per section, each section's groove (its part by
// name, else by how busy it is; the n-th section of a part plays the n-th groove written for it that suits the tempo),
// a fill in the last bar before each change (a bar of it going up into a chorus, two beats coming down, one beat
// between equals), a crash on each new section's downbeat, and an ending in the last section's last bars. With no
// sections, one from the loop (when it's on) or the song's length, added as a section. parts: { [section id or name]:
// part } overrides. ending: true writes the style's ending, false leaves it out (the last section plays its groove to
// its end); by default there's none when the loop goes round the drums' end (songLoops), so it doesn't play on every
// pass, else there is. crashes: false leaves out the crash on each section's downbeat (the grooves keep their own
// cymbals). -> { ops, plan, summary, label, style, trackName, kit } | { error, hint }
export function planDrumTrack(p, { style = null, seed = 1, studioA = false, device = null, parts = null, human = 1, isDrum = null, ending = null, crashes = true } = {}) {
  const me = meterError(p);
  if (me) return me;
  const bpb = beatsPerBar(p.meter);
  let S, styleWhy = null;
  if (style) { S = getStyle(style); if (!S) return { error: `no style "${style}"`, hint: `styles: ${library().styles.map((x) => x.id).join(', ')}` }; }
  else { const pick = styleForSong(p, { isDrum }); S = pick.style; styleWhy = pick.why; }
  // the sections, in order (a song with none gets one: the loop, or the song's whole bars)
  const { secs, made } = songSections(p, bpb);
  const songEnd = secs[secs.length - 1].start + secs[secs.length - 1].length;
  const loops = loopsAt(p, songEnd, bpb);
  const withEnding = ending == null ? !loops : !!ending;
  // parts: the name says, else how busy it is against the others
  const energy = sectionEnergy(p, secs, { isDrum });
  const sorted = energy.filter((e) => e > 0).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const has = (part) => groovesFor(S.id, part).length > 0;
  const fallback = { intro: ['intro', 'verse'], verse: ['verse'], chorus: ['chorus', 'verse'], bridge: ['bridge', 'half', 'verse'], half: ['half', 'bridge', 'verse'], outro: ['chorus', 'verse'] };
  const plan = secs.map((s, i) => {
    const said = parts && (parts[s.id] || parts[s.name] || parts[String(s.name).toLowerCase()]);
    let part = said ? (partWord(said) === 'ending' ? 'outro' : partWord(said) || partOfName(said)) : partOfName(s.name);
    let by = said ? 'asked' : part ? 'name' : 'energy';
    if (!part) {
      const e = energy[i];
      part = !median ? 'verse' : e >= median * 1.25 ? 'chorus' : e <= median * 0.6 && e > 0 ? 'bridge' : 'verse';
    }
    const use = (fallback[part] || ['verse']).find(has) || 'verse';
    return { section: s, part, use, by, energy: Math.round(energy[i] * 100) / 100 };
  });
  // the n-th section of a part plays the n-th groove written for it (cycling), so Verse 2 can be the style's second verse;
  // of the grooves that suit the song's tempo, when any do
  const suits = (list) => { const ok = list.filter((g) => tempoFit(g, p.tempo) > 0.5); return ok.length ? ok : list; };
  const nth = {};
  for (const x of plan) {
    const list = suits(groovesFor(S.id, x.use));
    const k = (nth[x.use] = (nth[x.use] ?? -1) + 1);
    x.groove = list.length ? list[k % list.length] : null;
  }
  if (plan.some((x) => !x.groove)) return { error: `${S.name} has no ${plan.find((x) => !x.groove).use} groove`, hint: 'pick another style' };
  const fillsOf = (beats) => groovesFor(S.id, 'fill').filter((g) => Math.abs(g.length - beats) < EPS);
  const anyFill = (beats) => fillsOf(beats)[0] || fillsOf(bpb / 2)[0] || fillsOf(1)[0] || groovesFor(S.id, 'fill')[0] || null;
  const rank = { intro: 0, half: 1, bridge: 1, verse: 2, outro: 2, chorus: 3 };
  const endings = groovesFor(S.id, 'ending');
  let fillN = 0;
  for (let i = 0; i < plan.length; i++) {
    const x = plan[i], s = x.section, next = plan[i + 1], last = i === plan.length - 1;
    const end = s.start + s.length;
    x.segments = [];
    // the ending: the last section's last bars (it stays inside the section, so the track is one clip per section); when
    // the section is too short for all of it, its last bars, so the final hit is always there
    let tail = end;
    if (last && endings.length && withEnding) {
      const e = endings[0], room = Math.max(bpb, s.length - (x.part === 'intro' ? 0 : bpb));
      const len = Math.min(e.length, Math.floor(room / bpb) * bpb);
      if (len >= bpb - EPS && s.length - len >= -EPS) { x.ending = { groove: e, start: end - len, length: len, offset: e.length - len }; tail = end - len; }
    }
    // the fill: the last bar before a change (into the next section, when it starts where this one ends)
    if (next && Math.abs(next.section.start - end) < EPS && !(x.part === 'intro' && s.length < 2 * bpb)) {
      const up = (rank[next.part] ?? 2) - (rank[x.part] ?? 2);
      const want = up > 0 ? (s.length >= 4 * bpb ? bpb : bpb / 2) : up < 0 ? bpb / 2 : 1;
      const list = fillsOf(want);
      const f = list.length ? list[fillN++ % list.length] : anyFill(want);
      if (f && f.length <= s.length - EPS) x.fill = { groove: f, start: end - f.length, length: f.length };
    }
    const mainEnd = x.fill ? x.fill.start : tail;
    if (mainEnd - s.start > EPS) x.segments.push({ groove: x.groove, from: 0, to: mainEnd - s.start });
    if (x.fill) x.segments.push({ groove: x.fill.groove, from: x.fill.start - s.start, to: x.fill.start - s.start + x.fill.length });
    if (x.ending) x.segments.push({ groove: x.ending.groove, from: x.ending.start - s.start, to: x.ending.start - s.start + x.ending.length, offset: x.ending.offset });
    // a crash on the downbeat of every new section (not on an intro at the top: it has its own way in)
    x.crash = crashes !== false && !(i === 0 && x.part === 'intro');
  }
  // the notes, section by section (on Studio A with the grooves' articulations, else General MIDI)
  const kit = kitFor(S, { studioA, device });
  const articulations = kit.device === STUDIO_A;
  const clips = plan.map((x, i) => {
    const s = x.section, notes = [];
    x.segments.forEach((seg, k) => {
      const len = seg.to - seg.from;
      const part = realize(seg.groove, { tempo: p.tempo, seed: seedFrom(seed, S.id, i, k), human, length: len, offset: seg.offset || 0, articulations });
      for (const n of part) notes.push({ ...n, t: r4(n.t + seg.from) });
    });
    if (x.crash) {
      // the hand moves from the hats to the crash on the one, and the kick lands with it
      const one = (n) => n.t < 0.06;
      for (let j = notes.length - 1; j >= 0; j--) if (one(notes[j]) && (familyOf(notes[j].p) === 'hat' || familyOf(notes[j].p) === 'ride' || familyOf(notes[j].p) === 'cymbal')) notes.splice(j, 1);
      notes.push({ p: 49, t: 0, d: 0.5, v: 0.96 });
      if (!notes.some((n) => one(n) && familyOf(n.p) === 'kick')) notes.push({ p: 36, t: 0, d: 0.25, v: 0.9 });
    }
    notes.sort((a, b) => a.t - b.t || a.p - b.p);
    return { start: s.start, length: s.length, name: `${S.name} ${PART_LABEL[x.use].toLowerCase()}`, notes };
  });
  // the ops: one transaction (the section, when the song had none; the track; a clip per section)
  const ops = [];
  if (made) ops.push({ type: 'section.add', ref: 'sec', section: { name: made.name, start: made.start, length: made.length } });
  const trackName = uniqueName(p, 'Drums');
  ops.push({ type: 'track.add', ref: 'drums', track: { name: trackName, kind: 'instrument', color: freeColor(p), instrument: { device: kit.device, params: kit.params } } });
  clips.forEach((c, i) => ops.push({ type: 'clip.add', track: '$drums', ref: `sec${i}`, clip: { kind: 'notes', ...c } }));
  const others = p.tracks.filter((x) => isDrumTrack(x, isDrum) && !x.mute).map((x) => x.name);
  // the plan, in words: "Rock, verse groove in bars 1–8, chorus groove in 9–16, fills at 8 and 16"
  const barOf = (beat) => Math.floor(beat / bpb + EPS) + 1;
  const lastBar = (end) => Math.max(1, Math.ceil(end / bpb - EPS));
  const spans = plan.map((x) => ({ x, a: barOf(x.section.start), b: lastBar(x.section.start + x.section.length) }));
  const fills = plan.filter((x) => x.fill).map((x) => barOf(x.fill.start));
  const crashBars = plan.filter((x) => x.crash).map((x) => barOf(x.section.start));
  const lastEnd = plan[plan.length - 1].ending;
  const endBars = lastEnd ? [barOf(lastEnd.start), lastBar(lastEnd.start + lastEnd.length)] : null;
  const said = spans.map(({ x, a, b }, i) => `${x.use === 'intro' ? 'the intro' : `${PART_LABEL[x.use].toLowerCase()} groove`} in ${i ? (b > a ? `${a}–${b}` : `${a}`) : barsText(a, b)}`);
  const endSaid = lastEnd ? `; the ending in ${barsText(endBars[0], endBars[1])}` : !withEnding ? `; no ending${loops ? ', so the loop goes round' : ''}` : '';
  const kits = others.length ? `; ${listText(others)} ${others.length === 1 ? 'stays' : 'stay'} as ${others.length === 1 ? 'it is, so both kits play' : 'they are, so all the kits play'} together` : '';
  const summary = `${S.name}, ${listText(said)}${fills.length ? `; fills at ${listText(fills.map(String))}` : ''}${endSaid}${crashes === false ? '; no crashes' : ''}. On a new track, ${trackName}, ${kitName(kit)}${made ? `; a ${made.name} section from ${made.from}, since the song has none` : ''}${kits}.`;
  return {
    ops, summary, label: `drums for the song (${S.name})`, style: S.id, styleName: S.name, styleWhy, trackName, kit, madeSection: made, otherDrums: others,
    plan: {
      style: S.id, fills, crashes: crashBars, loops,
      ending: lastEnd ? { groove: lastEnd.groove.id, name: lastEnd.groove.name, bars: endBars } : null,
      sections: plan.map((x, i) => ({
        id: x.section.id, name: x.section.name, part: x.part === 'outro' ? 'outro' : x.part, plays: x.use, by: x.by, energy: x.energy, groove: x.groove.id, grooveName: x.groove.name,
        bars: [spans[i].a, spans[i].b], crash: x.crash, notes: clips[i].notes.length,
        ...(x.fill ? { fill: { groove: x.fill.groove.id, name: x.fill.groove.name, bar: barOf(x.fill.start), beats: x.fill.length } } : {}),
        ...(x.ending ? { ending: { groove: x.ending.groove.id, name: x.ending.groove.name, bars: [barOf(x.ending.start), lastBar(x.ending.start + x.ending.length)] } } : {}),
      })),
    },
  };
}
