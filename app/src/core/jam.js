// The Jam room's music [core]: the chords of any song as a timeline, the jam tracks the house band makes on the spot,
// and tips made from the song's own harmony. Pure (no DOM, no Math.random): Node and the browser give the same answer.
// The room is ui/jam.js; the neck is core/fretboard.js; the band is core/arrange.js's part builders.
//
// Chords
//   parseChord('C/E', key?) -> { root, quality, pcs, bass, name } | null      'A7', 'F#m7b5', 'Bbmaj7', 'E5', 'Dm6', 'G/B'
//   parseProgression('I IV V' | 'Am F C G' | 'i7 | iv7 V7', key) -> { bars: [[chord, ...], ...] } | { error, hint }
//       one bar per token, or bars split by |, two or more chords in a bar share it; % repeats the bar before
//   chordTimeline(project, { grain }) -> { key, keyFrom, grain, windows, chords: [{ start, end, bar, name, root, quality,
//       pcs, bass, roman, tones, conf }] }   the song's harmony from its notes: the pitch classes sounding in each
//       window (a half bar in 4/4: the strong beats; grain 'beat' or 'bar'), matched to chords (root, quality, the bass
//       for a slash chord), then smoothed (Viterbi: a change costs, more in mid-bar), so a passing note isn't a chord
//   chordAt(timeline, beat) -> { chord, next, i } ; whereAt(project, timeline, beat) -> where the playhead is
//   nextChange(project, timeline, beat) -> { chord, from, at, bar, wrap: '' | 'loop' | 'top', lead } | null   the next
//       chord that isn't this one, round the loop (or round to the top past the song's last change)
//   romanOf(rootPc, quality, key) -> 'bVII7', 'ii7', 'i'   (relative to the key's own major scale: bIII, bVI, bVII in minor)
//   intervalName(semitones) -> 'R', 'b3', '5', 'b7' ; chordTones(chord) -> [{ pc, iv, name }]
//   scaleFor(key) / pentatonicFor(key) -> { name, pcs }
// Jam tracks
//   JAM_STYLES, JAM_STYLE_IDS, JAM_PRESETS (one ready-made track per style), findJamStyle(name), parseKey(text)
//   jamTrack({ style, key, tempo, progression, bars, seed, by, rig }) -> { project, chart, summary } | { error, hint }
//       a real song: drums, bass and a chord part from the style (arrange.js's builders, playing this progression),
//       a Guitar track for you (DI Box, the style's tone: rig(id) gives its chain), sections, the loop round the form,
//       meta.jam (the recipe). Signed `by` (the house, 'overdub', unless an agent asked for it).
// Tips
//   jamTips(project, timeline, { tuning, at }) -> [{ id, kind, text, show, lick? }]  which scale and where to start on the
//       neck, the note to land on at the next change, the notes outside the key and where the key moves, a two-bar lick
//   makeLick(timeline, { key, bar, tuning, seed, next }) -> { notes: [{ p, t, d, v, s, f, finger }], tab, bars, over, text,
//       starts, wrap }   next: nextChange's answer when the lick's second bar goes round the loop (bars 24 and 13)

import { SCALES, scalePcs, parsePc, spellPc, beatsPerBar, noteName } from './music.js';
import { rng, guessKey, isDrumDevice } from './transforms.js';
import { createProject, stableIds, cleanProject } from './project.js';
import { STYLES, strongOffsets, drumBar, bassLine, chordPart, voice, nearestPitch } from './arrange.js';
import { tuningOf, boxStart, boxOf, fingering, formatTab, stringNumber, positionsOf } from './fretboard.js';

const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;
const EPS = 1e-6;
const ORD = [
  '',
  '1st',
  '2nd',
  '3rd',
  '4th',
  '5th',
  '6th',
  '7th',
  '8th',
  '9th',
  '10th',
  '11th',
  '12th',
  '13th',
  '14th',
  '15th',
  '16th',
  '17th',
  '18th',
  '19th',
  '20th',
  '21st',
  '22nd',
];
const fretWord = (f) => (f === 0 ? 'open' : `${ORD[f] || f + 'th'} fret`);
const STRING_WORD = ['low E', 'A', 'D', 'G', 'B', 'high e'];
// "the B string", in the tuning's own names (the 6th string, D, in drop D)
function stringWord(s, T) {
  const names = tuningOf(T).notes.split(' ');
  if (tuningOf(T).id === 'standard') return `${STRING_WORD[s]} string`;
  return `${stringNumber(s)}${['th', 'th', 'th', 'rd', 'nd', 'st'][s]} string (${names[s]})`;
}

/* ================================================================================================ chords */
// Chord qualities: intervals from the root. `detect` ones are what the timeline listens for; the rest are read when
// written (a 9 is heard as its 7th chord, its 9th a colour tone). Extensions sit above the octave: b9 13, 9 14, #9 15,
// 11 17, #11 18, b13 20, 13 21 (a 13 is spelled as guitarists voice it: root, 3rd, 5th, 7th and the 13th, no 9th).
export const QUALITIES = {
  '': { iv: [0, 4, 7], prior: 0, detect: true },
  m: { iv: [0, 3, 7], prior: 0, detect: true, minor: true },
  7: { iv: [0, 4, 7, 10], prior: -0.05, detect: true },
  maj7: { iv: [0, 4, 7, 11], prior: -0.05, detect: true },
  m7: { iv: [0, 3, 7, 10], prior: -0.05, detect: true, minor: true },
  m7b5: { iv: [0, 3, 6, 10], prior: -0.12, detect: true, minor: true },
  dim: { iv: [0, 3, 6], prior: -0.18, detect: true, minor: true },
  sus4: { iv: [0, 5, 7], prior: -0.15, detect: true },
  sus2: { iv: [0, 2, 7], prior: -0.2, detect: true },
  5: { iv: [0, 7], prior: -0.08, detect: true },
  6: { iv: [0, 4, 7, 9], prior: -0.1, detect: true },
  m6: { iv: [0, 3, 7, 9], prior: -0.1, detect: true, minor: true },
  dim7: { iv: [0, 3, 6, 9], prior: -0.2, minor: true },
  aug: { iv: [0, 4, 8], prior: -0.2 },
  9: { iv: [0, 4, 7, 10, 14], prior: -0.1 },
  maj9: { iv: [0, 4, 7, 11, 14], prior: -0.1 },
  m9: { iv: [0, 3, 7, 10, 14], prior: -0.1, minor: true },
  '7#9': { iv: [0, 4, 7, 10, 15], prior: -0.15 },
  add9: { iv: [0, 4, 7, 14], prior: -0.12 },
  11: { iv: [0, 4, 7, 10, 14, 17], prior: -0.15 },
  m11: { iv: [0, 3, 7, 10, 14, 17], prior: -0.15, minor: true },
  13: { iv: [0, 4, 7, 10, 21], prior: -0.15 },
  m13: { iv: [0, 3, 7, 10, 21], prior: -0.15, minor: true },
  maj13: { iv: [0, 4, 7, 11, 21], prior: -0.15 },
  '7sus4': { iv: [0, 5, 7, 10], prior: -0.15 },
  '9sus4': { iv: [0, 5, 7, 10, 14], prior: -0.15 },
  '7b9': { iv: [0, 4, 7, 10, 13], prior: -0.15 },
  '7#11': { iv: [0, 4, 7, 10, 18], prior: -0.15 },
  '6/9': { iv: [0, 4, 7, 9, 14], prior: -0.15 },
};
const Q_ALIAS = {
  M: '',
  maj: '',
  major: '',
  min: 'm',
  minor: 'm',
  '-': 'm',
  M7: 'maj7',
  ma7: 'maj7',
  Δ: 'maj7',
  Δ7: 'maj7',
  min7: 'm7',
  '-7': 'm7',
  ø: 'm7b5',
  ø7: 'm7b5',
  'm7-5': 'm7b5',
  min7b5: 'm7b5',
  '°': 'dim',
  o: 'dim',
  '°7': 'dim7',
  o7: 'dim7',
  '+': 'aug',
  sus: 'sus4',
  M9: 'maj9',
  min9: 'm9',
  '-9': 'm9',
  dom7: '7',
  maj6: '6',
  min6: 'm6',
  '-6': 'm6',
  add2: 'add9',
  '7sus': '7sus4',
  sus7: '7sus4',
  '9sus': '9sus4',
  69: '6/9',
  '6add9': '6/9',
  min11: 'm11',
  '-11': 'm11',
  min13: 'm13',
  '-13': 'm13',
  M13: 'maj13',
  Δ13: 'maj13',
  '7-9': '7b9',
  '7+11': '7#11',
};
const normQ = (q) => (q in QUALITIES ? q : (Q_ALIAS[q] ?? null));

const IV_NAME = ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
export const intervalName = (n) => IV_NAME[((n % 12) + 12) % 12];
// a chord tone's name by its role in the chord (a dim chord's 6 is its b5, a 9th chord's 2 its 9, an aug's 8 its #5;
// above the octave, the extensions)
const EXT_NAME = { 13: 'b9', 14: '9', 15: '#9', 17: '11', 18: '#11', 20: 'b13', 21: '13' };
function toneName(iv, quality) {
  if (EXT_NAME[iv]) return EXT_NAME[iv];
  if (iv === 8 && quality === 'aug') return '#5';
  if (iv === 9 && quality === 'dim7') return 'bb7';
  return intervalName(iv);
}

function spell(pc, key) {
  return spellPc(pc, key && key.root ? key : null);
}
function nameOf(root, quality, bass, key) {
  return spell(root, key) + quality + (bass != null && bass !== root ? '/' + spell(bass, key) : '');
}
// A chord tone spelled from its chord: the letter its degree gives (E7's third is G#, not Ab; Bb7's is D), with the
// root spelled for the key. A tone that would need a double sharp or flat takes the key's own name instead.
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEPS = {
  0: 0,
  1: 1,
  2: 1,
  3: 2,
  4: 2,
  5: 3,
  6: 4,
  7: 4,
  8: 5,
  9: 5,
  10: 6,
  11: 6,
  13: 1,
  14: 1,
  15: 1,
  17: 3,
  18: 3,
  20: 5,
  21: 5,
};
export function spellTone(root, iv, key = null, quality = '') {
  const rootName = spell(root, key),
    L = LETTERS.indexOf(rootName[0]);
  let steps = STEPS[iv] ?? STEPS[iv % 12];
  if (quality === 'dim7' && iv === 9) steps = 6;
  if (quality === 'aug' && iv === 8) steps = 4;
  const pc = (root + iv) % 12,
    letter = LETTERS[(L + steps) % 7];
  let acc = (((pc - NATURAL[letter]) % 12) + 12) % 12;
  if (acc > 6) acc -= 12;
  if (Math.abs(acc) > 1 || L < 0) return spell(pc, key);
  return letter + (acc > 0 ? '#' : acc < 0 ? 'b' : '');
}
// A note's name in a key: the key's own spelling, except the blue note (a minor or blues key's b5), which is the fifth
// flattened, the way players name it (Bb in E, not A#).
export function spellIn(pc, key) {
  const r = key && key.root ? parsePc(key.root) : null;
  if (r != null && isMinorKey(key) && (((pc - r) % 12) + 12) % 12 === 6) return spellTone(r, 6, key);
  return spell(pc, key);
}
export function chordTones(ch, key = null) {
  const Q = QUALITIES[ch.quality] || QUALITIES[''];
  return Q.iv.map((iv) => ({
    pc: (ch.root + iv) % 12,
    iv: iv % 12,
    name: toneName(iv, ch.quality),
    note: spellTone(ch.root, iv, key, ch.quality),
  }));
}
function makeChord(root, quality, bass = null, key = null) {
  const Q = QUALITIES[quality];
  const pcs = [...new Set(Q.iv.map((iv) => (root + iv) % 12))];
  const b = bass == null ? root : bass;
  return { root, quality, pcs, bass: b, name: nameOf(root, quality, b, key) };
}

// 'C', 'Am7', 'F#m7b5', 'Bbmaj7', 'E5', 'D/F#', 'A13', 'E7sus4', 'C6/9' -> a chord (or null)
export function parseChord(sym, key = null) {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)(6\/9|[^/\s]*)(?:\/([A-Ga-g][#b♯♭]?))?\s*$/.exec(String(sym || ''));
  if (!m) return null;
  const root = parsePc(m[1].toUpperCase() + m[2].replace('♯', '#').replace('♭', 'b'));
  const q = normQ(m[3]);
  if (q == null || !Number.isFinite(root)) return null;
  const bass = m[4] ? parsePc(m[4][0].toUpperCase() + m[4].slice(1).replace('♯', '#').replace('♭', 'b')) : null;
  return makeChord(root, q, Number.isFinite(bass) ? bass : null, key);
}

// Roman numerals relative to the key's tonic and its own MAJOR scale (so bIII, bVI and bVII in a minor key: what the
// chord is, whatever the mode). Case says the quality: upper major, lower minor; a quality suffix may follow.
const DEG = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };
const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
export function parseRoman(sym, key) {
  const m =
    /^\s*([b#♭♯]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(6\/9|[^/\s]*)(?:\/([b#♭♯]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i))?\s*$/.exec(
      String(sym || ''),
    );
  if (!m || !key) return null;
  const tonic = parsePc(key.root);
  const acc = (a) => (a === 'b' || a === '♭' ? -1 : a === '#' || a === '♯' ? 1 : 0);
  const deg = DEG[m[2].toLowerCase()] + acc(m[1]);
  const lower = m[2] === m[2].toLowerCase();
  let q = m[3];
  if (q === '°' || q === 'o') q = 'dim';
  else if (q === 'ø' || q === 'ø7') q = 'm7b5';
  else if (q === '°7' || q === 'o7') q = 'dim7';
  else if (lower && (q === '' || q === '7' || q === '6' || q === '9' || q === '7b5' || q === '11' || q === '13'))
    q = 'm' + q;
  const quality = normQ(q);
  if (quality == null) return null;
  let bass = null;
  if (m[5]) bass = (tonic + DEG[m[5].toLowerCase()] + acc(m[4]) + 120) % 12;
  return makeChord((tonic + deg + 120) % 12, quality, bass, key);
}
export function romanOf(rootPc, quality, key) {
  if (!key) return '';
  const deg = (rootPc - parsePc(key.root) + 120) % 12;
  const Q = QUALITIES[quality] || {};
  let r = ROMAN[deg];
  if (Q.minor) r = r.toLowerCase().replace(/^b/, 'b');
  const suffix = { '': '', m: '', dim: '°', m7b5: 'ø7', m7: '7', m6: '6', m9: '9', m11: '11', m13: '13' }[quality];
  return r + (suffix ?? quality);
}

// 'A', 'A minor', 'Am', 'F# major', 'Eb', 'e minor', { root, scale } -> { root, scale } | null
export function parseKey(k, fallback = null) {
  if (!k) return fallback;
  if (typeof k === 'object' && k.root)
    return SCALES[k.scale] ? { root: k.root, scale: k.scale } : { root: k.root, scale: 'major' };
  const m =
    /^\s*([A-Ga-g])([#b♯♭]?)\s*(m(?:in(?:or)?)?|maj(?:or)?|minor|major|dorian|mixolydian|blues|phrygian|lydian)?\s*$/i.exec(
      String(k),
    );
  if (!m) return null;
  const root = m[1].toUpperCase() + (m[2] || '').replace('♯', '#').replace('♭', 'b');
  if (!Number.isFinite(parsePc(root))) return null;
  const w = (m[3] || '').toLowerCase();
  const scale = !w ? fallback?.scale || 'major' : /^m(in(or)?)?$/.test(w) ? 'minor' : /^maj/.test(w) ? 'major' : w;
  return { root, scale };
}

// A progression as bars of chords. Tokens are chord symbols or Roman numerals (in the key); | splits bars when it is
// there (a bar with two chords shares it), else every token is a bar. % repeats the bar before.
export function parseProgression(text, key) {
  const src = String(text || '').trim();
  if (!src)
    return {
      error: 'the progression is empty',
      hint: 'chord names a bar each ("Am F C G") or numerals in the key ("I IV V", "i7 iv7 v7"); | splits bars ("C G | Am F")',
    };
  if (src.length > 2000) return { error: 'the progression is too long', hint: 'up to 64 bars' };
  const groups = src.includes('|')
    ? src
        .split('|')
        .map((g) => g.trim())
        .filter(Boolean)
        .map((g) => g.split(/\s+/))
    : src
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((t) => [t]);
  const bars = [],
    bad = [];
  for (const g of groups) {
    if (g.length === 1 && (g[0] === '%' || g[0] === '-')) {
      if (bars.length) bars.push(bars[bars.length - 1].slice());
      continue;
    }
    const bar = [];
    for (const tok of g) {
      // (% inside a bar: the chord before, again)
      if (tok === '%' || tok === '-') {
        const prev = bar[bar.length - 1] || bars[bars.length - 1]?.slice(-1)[0];
        if (prev) bar.push(prev);
        continue;
      }
      const c = parseChord(tok, key) || parseRoman(tok, key);
      if (!c) bad.push(tok);
      else bar.push(c);
    }
    if (bar.length) bars.push(bar);
  }
  // (each bad token once: "A13" three times in a vamp is one thing to fix)
  const odd = [...new Set(bad)];
  if (odd.length)
    return {
      error: `can't read ${odd
        .slice(0, 4)
        .map((x) => `"${x}"`)
        .join(', ')}${odd.length > 4 ? ' …' : ''} as a chord`,
      hint: 'chord names (A7, F#m7b5, Bbmaj7, G/B, E5, A13, E7sus4, C6/9) or numerals in the key (I, ii7, bVII, V7); one bar each, or | between bars',
    };
  if (!bars.length)
    return {
      error: 'no chords in the progression',
      hint: 'chord names a bar each ("Am F C G") or numerals ("I IV V")',
    };
  if (bars.length > 64)
    return {
      error: `${bars.length} bars of chords; a jam track's form is up to 64`,
      hint: 'give one time round; the track repeats it',
    };
  return { bars };
}

/* ================================================================================================ scales */
const SCALE_WORDS = {
  major: 'major',
  minor: 'minor',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  locrian: 'locrian',
  harmonicMinor: 'harmonic minor',
  melodicMinor: 'melodic minor',
  majorPentatonic: 'major pentatonic',
  minorPentatonic: 'minor pentatonic',
  blues: 'blues',
  chromatic: 'chromatic',
};
const MINORISH = /minor|dorian|phrygian|locrian|blues/i;
export const isMinorKey = (key) =>
  !!key && MINORISH.test(key.scale) && !/major/i.test(key.scale.replace(/Pentatonic/, ''));
export function scaleFor(key) {
  if (!key) return { name: 'chromatic', pcs: SCALES.chromatic.slice(), id: 'chromatic' };
  return { name: `${key.root} ${SCALE_WORDS[key.scale] || key.scale}`, pcs: scalePcs(key), id: key.scale };
}
export function pentatonicFor(key) {
  if (!key) return { name: 'A minor pentatonic', pcs: [9, 0, 2, 4, 7], minor: true };
  const root = parsePc(key.root),
    minor = isMinorKey(key) || key.scale === 'minorPentatonic';
  const iv = minor ? SCALES.minorPentatonic : SCALES.majorPentatonic;
  return {
    name: `${key.root} ${minor ? 'minor' : 'major'} pentatonic`,
    pcs: iv.map((i) => (root + i) % 12),
    minor,
    root,
  };
}

/* ================================================================================================ the timeline */
const DETECT = Object.entries(QUALITIES)
  .filter(([, q]) => q.detect)
  .map(([q, Q]) => ({ q, Q, iv: [...new Set(Q.iv.map((i) => i % 12))] }));

// The notes the harmony is read from: every clip that plays (muted clips don't; a muted track still counts, since a
// guitarist mutes the keys to play the chords themselves), drums left out. A part with chords weighs more than a line.
function harmonyNotes(p) {
  const out = [];
  for (const t of p.tracks || []) {
    if (t.kind === 'audio' || !t.instrument) continue;
    if (isDrumDevice(t.instrument.device) || /\b(drums?|kit|beat|perc(ussion)?)\b/i.test(t.name || '')) continue;
    for (const c of t.clips || []) {
      if (c.kind !== 'notes' || c.mute || !Array.isArray(c.notes) || !c.notes.length) continue;
      const cs = +c.start || 0,
        len = +c.length || 0;
      const ns = c.notes.filter((n) => Number.isFinite(n.p) && Number.isFinite(n.t) && n.t >= 0 && n.t < len);
      if (!ns.length) continue;
      // how chordal the clip is: the share of notes that start with another
      const starts = new Map();
      for (const n of ns) {
        const k = Math.round(n.t * 32);
        starts.set(k, (starts.get(k) || 0) + 1);
      }
      const together = ns.filter((n) => starts.get(Math.round(n.t * 32)) > 1).length / ns.length;
      const med = ns.map((n) => n.p).sort((a, b) => a - b)[ns.length >> 1];
      const role = together >= 0.4 ? 'chords' : med < 52 ? 'bass' : 'line';
      const w = role === 'chords' ? 1 : role === 'bass' ? 1.2 : 0.5; // (a bass note is the loudest root in the room)
      for (const n of ns) {
        const t0 = cs + n.t,
          t1 = Math.min(cs + len, t0 + Math.max(1 / 64, +n.d || 0.25));
        out.push({ p: n.p, t: t0, e: t1, v: Number.isFinite(n.v) ? n.v : 0.8, w, role });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// The windows a song's harmony is read in: between strong beats (half bars in 4/4), or every beat, or every bar.
function windowsOf(meter, end, grain) {
  const bpb = beatsPerBar(meter),
    out = [];
  const offs =
    grain === 'bar'
      ? [0]
      : grain === 'beat'
        ? Array.from({ length: Math.ceil(bpb - EPS) }, (_, i) => i)
        : strongOffsets(meter);
  for (let k = 0; k * bpb < end - EPS; k++) {
    for (let i = 0; i < offs.length; i++) {
      const a = k * bpb + offs[i],
        b = k * bpb + (i + 1 < offs.length ? offs[i + 1] : bpb);
      if (b - a > EPS) out.push({ a: r4(a), b: r4(b), bar: k, first: i === 0 });
    }
  }
  return out;
}

export const MAX_TIMELINE_BARS = 512;
export function chordTimeline(p, { grain = 'half', maxBars = MAX_TIMELINE_BARS } = {}) {
  const meter = p.meter || [4, 4],
    bpb = beatsPerBar(meter);
  const notes = harmonyNotes(p);
  const key =
    p.key && p.key.root
      ? { root: p.key.root, scale: p.key.scale }
      : notes.length
        ? guessKey(notes.map((n) => ({ p: n.p, t: n.t, d: n.e - n.t })))
        : null;
  const keyFrom = p.key && p.key.root ? 'song' : notes.length ? 'guessed' : 'none';
  let end = 0;
  for (const n of notes) end = Math.max(end, n.e);
  end = Math.min(Math.ceil((end - EPS) / bpb) * bpb, maxBars * bpb);
  const W = windowsOf(meter, end, grain);
  if (!W.length) return { key, keyFrom, grain, windows: 0, chords: [] };
  const keyPcs = new Set(key ? scalePcs(key) : []);
  // the pitch classes in each window (weighted by how long and how hard they sound, more at the window's start) and
  // the bass: the lowest note sounding as the window starts (the chord's bass is what's under it when it arrives: a
  // walking or approach note later in the window counts for little)
  let j0 = 0;
  const win = W.map((w) => {
    const chroma = new Array(12).fill(0),
      bassW = new Array(12).fill(0);
    let lowest = Infinity,
      startLow = null;
    while (j0 < notes.length && notes[j0].e <= w.a) j0++;
    const here = [];
    for (let j = j0; j < notes.length && notes[j].t < w.b; j++) {
      const n = notes[j];
      const ov = Math.min(w.b, n.e) - Math.max(w.a, n.t);
      if (ov <= 1e-3) continue;
      const atStart = n.t <= w.a + 0.0625 ? 1.3 : 1;
      // (a bass note after the window's start is often a walk to the next chord: it counts for half)
      chroma[pcOf(n.p)] += ov * (0.5 + 0.5 * n.v) * n.w * atStart * (n.role === 'bass' && atStart === 1 ? 0.5 : 1);
      here.push({ n, ov });
      if (ov >= 0.25) lowest = Math.min(lowest, n.p);
      if (n.t <= w.a + 0.0625 && n.e > w.a + 0.0625 && (startLow == null || n.p < startLow.p)) startLow = n;
    }
    if (startLow) bassW[pcOf(startLow.p)] += 2;
    for (const { n, ov } of here) if (n !== startLow && n.p <= lowest + 7 && ov >= 0.25) bassW[pcOf(n.p)] += 0.5 * ov;
    const total = chroma.reduce((a, b) => a + b, 0);
    let bass = -1,
      bw = 0;
    for (let pc = 0; pc < 12; pc++)
      if (bassW[pc] > bw + 1e-9) {
        bw = bassW[pc];
        bass = pc;
      }
    return { ...w, chroma, bassW, bass, total };
  });
  // the candidates and what each window says about each
  const cands = [];
  for (let r = 0; r < 12; r++)
    for (const d of DETECT)
      cands.push({ root: r, q: d.q, pcs: d.iv.map((i) => (r + i) % 12), iv: d.iv, prior: d.Q.prior });
  const NC = cands.length; // the last state: no chord (nothing pitched sounds)
  const emit = (w) => {
    const out = new Float64Array(NC + 1);
    if (w.total < 1e-6) {
      out.fill(-0.6);
      out[NC] = 0;
      return out;
    }
    for (let c = 0; c < NC; c++) {
      const C = cands[c];
      let inW = 0;
      for (const pc of C.pcs) inW += w.chroma[pc];
      let s = (inW - 0.7 * (w.total - inW)) / w.total;
      // a chord tone that isn't there: the third most of all (a power chord has none), the root next, the fifth least
      C.iv.forEach((iv) => {
        if (w.chroma[(C.root + iv) % 12] < 0.06 * w.total)
          s -= iv === 3 || iv === 4 ? 0.22 : iv === 0 ? 0.15 : iv === 7 ? 0.05 : 0.12;
      });
      if (w.bass >= 0) s += w.bass === C.root ? 0.2 : C.pcs.includes(w.bass) ? 0.03 : -0.12;
      s += C.prior;
      if (keyPcs.size && C.pcs.every((pc) => keyPcs.has(pc))) s += 0.05;
      out[c] = s;
    }
    out[NC] = -1;
    return out;
  };
  // Viterbi with a cost for a change (more inside the bar); staying is free
  const CHANGE = 0.18,
    MID = 0.12;
  let cost = emit(win[0]).map((x) => -x);
  const back = [];
  for (let i = 1; i < win.length; i++) {
    const e = emit(win[i]);
    let bi = 0;
    for (let c = 1; c <= NC; c++) if (cost[c] < cost[bi]) bi = c;
    const pen = CHANGE + (win[i].first ? 0 : MID);
    const nc = new Float64Array(NC + 1),
      bk = new Int32Array(NC + 1);
    for (let c = 0; c <= NC; c++) {
      const stay = cost[c],
        move = cost[bi] + pen;
      if (stay <= move) {
        nc[c] = stay - e[c];
        bk[c] = c;
      } else {
        nc[c] = move - e[c];
        bk[c] = bi;
      }
    }
    cost = nc;
    back.push(bk);
  }
  let s = 0;
  for (let c = 1; c <= NC; c++) if (cost[c] < cost[s]) s = c;
  const path = new Array(win.length);
  for (let i = win.length - 1; i >= 0; i--) {
    path[i] = s;
    if (i > 0) s = back[i - 1][s];
  }
  // spans of one chord; the bass that held most of each (a slash chord when it isn't the root)
  const chords = [];
  for (let i = 0; i < win.length; i++) {
    const c = path[i],
      last = chords[chords.length - 1];
    if (last && last.state === c && Math.abs(last.end - win[i].a) < EPS) {
      last.end = win[i].b;
      last.wins.push(win[i]);
      continue;
    }
    chords.push({ state: c, start: win[i].a, end: win[i].b, wins: [win[i]] });
  }
  const out = [];
  for (const sp of chords) {
    if (sp.state === NC) continue;
    const C = cands[sp.state];
    // (the bass as the chord arrives counts most, then the ones on bar lines)
    const bw = new Array(12).fill(0);
    sp.wins.forEach((w, k) => {
      const m = k === 0 ? 3 : w.first ? 2 : 1;
      for (let pc = 0; pc < 12; pc++) bw[pc] += w.bassW[pc] * m;
    });
    const tot = bw.reduce((a, b) => a + b, 0);
    let bass = C.root,
      best = 0;
    for (let pc = 0; pc < 12; pc++)
      if (bw[pc] > best + 1e-9) {
        best = bw[pc];
        bass = pc;
      }
    // a bass outside the chord names a slash chord only when it holds the span
    if (bass !== C.root && !C.pcs.includes(bass) && best < 0.7 * tot) bass = C.root;
    const ch = makeChord(C.root, C.q, bass, key);
    const conf = sp.wins.reduce((a, w) => a + Math.max(0, Math.min(1, emit(w)[sp.state])), 0) / sp.wins.length;
    out.push({
      start: r4(sp.start),
      end: r4(sp.end),
      bar: Math.floor(sp.start / bpb + EPS) + 1,
      name: ch.name,
      root: ch.root,
      quality: ch.quality,
      pcs: ch.pcs,
      bass: ch.bass,
      roman: romanOf(ch.root, ch.quality, key) + (ch.bass !== ch.root ? '/' + intervalName(ch.bass - ch.root) : ''),
      tones: chordTones(ch, key),
      conf: Math.round(conf * 100) / 100,
    });
  }
  return { key, keyFrom, grain, windows: win.length, chords: out };
}

// The chord at a song beat, and the next one (wrapping round the loop is the caller's business).
export function chordAt(tl, beat) {
  const list = tl?.chords || [];
  let i = -1;
  for (let k = 0; k < list.length; k++) {
    if (list[k].start <= beat + EPS) i = k;
    else break;
  }
  const chord = i >= 0 && beat < list[i].end - EPS ? list[i] : null;
  const next = list[i + 1] || null;
  return { chord, next, i };
}

// Where a song beat is: bar and beat (1-based), the section, the chord, the next change and how far off it is.
// loop: when the loop is on and the beat is inside it, the next chord after the loop's end is its start's.
export function whereAt(p, tl, beat) {
  const bpb = beatsPerBar(p.meter || [4, 4]);
  const b = Math.max(0, beat || 0);
  const bar = Math.floor(b / bpb + EPS) + 1,
    inBar = b - (bar - 1) * bpb;
  const sec = (p.sections || []).find((s) => b >= s.start - EPS && b < s.start + s.length - EPS) || null;
  const { chord, next: after } = chordAt(tl, b);
  let next = after;
  const lp = p.loop || {};
  if (
    lp.on &&
    lp.end - lp.start > EPS &&
    b >= lp.start - EPS &&
    b < lp.end - EPS &&
    (!next || next.start >= lp.end - EPS)
  ) {
    const first = chordAt(tl, lp.start).chord;
    next =
      first && (!chord || first.name !== chord.name || first.start !== chord.start) ? { ...first, wrap: true } : next;
  }
  const until = next ? (next.wrap ? lp.end - b + 0 : next.start - b) : null;
  return {
    bar,
    beat: Math.floor(inBar + EPS) + 1,
    beats: bpb,
    section: sec ? { name: sec.name, start: sec.start, length: sec.length, bars: Math.round(sec.length / bpb) } : null,
    chord,
    next,
    beatsToNext: until == null ? null : Math.max(0, until),
  };
}

// The next change from a song beat, for the tips and the lick: the next chord that isn't the one sounding, on through
// the song; round the loop when the loop is on and the beat is in it (as whereAt counts it for the stage), else round
// to the top once the song's last change has gone by (a jam track goes round its form, and a song starts again at
// bar 1). The chord now is the one sounding, else the one that just ended, else the song's first.
//   -> { chord, from, at (the beat it lands on), bar, wrap: '' | 'loop' | 'top', lead (the bar before it, as played:
//        where a two-bar lick into it starts) } | null (one chord all the way round)
export function nextChange(p, tl, beat) {
  const chords = tl?.chords || [];
  if (!chords.length) return null;
  const bpb = beatsPerBar(p.meter || [4, 4]),
    barOf = (x) => Math.floor(x / bpb + EPS) + 1;
  const b = Math.max(0, beat || 0);
  const here = chordAt(tl, b);
  const cur = here.chord || (here.i >= 0 ? chords[here.i] : null) || chords[0];
  const lp = p.loop || {};
  const loop = !!lp.on && lp.end - lp.start > EPS && b >= lp.start - EPS && b < lp.end - EPS;
  const end = loop ? lp.end : Infinity;
  const ahead = chords.find((c) => c.start > b + EPS && c.start < end - EPS && c.name !== cur.name);
  if (ahead)
    return { chord: ahead, from: cur, at: ahead.start, bar: ahead.bar, wrap: '', lead: Math.max(1, ahead.bar - 1) };
  // round: the chord sounding at the loop's start (or bar 1), then the ones after it, up to here
  const from = loop ? lp.start : 0,
    top = chordAt(tl, from).chord;
  const round = (top ? [{ c: top, at: from }] : []).concat(
    chords.filter((c) => c.start > from + EPS && c.start <= b + EPS).map((c) => ({ c, at: c.start })),
  );
  const hit = round.find((x) => x.c.name !== cur.name);
  if (!hit) return null;
  const bar = barOf(hit.at),
    last = barOf((loop ? lp.end : chords[chords.length - 1].end) - 1e-3);
  return {
    chord: hit.c,
    from: cur,
    at: hit.at,
    bar,
    wrap: loop ? 'loop' : 'top',
    lead: hit.at <= from + EPS ? last : Math.max(1, bar - 1),
  };
}

/* ================================================================================================ jam tracks */
// Each style is a recipe in arrange.js's STYLES shape (the drums' rows and fills, the chord part's rhythm and voicing,
// the bass's mode) plus what a jam track needs: a key, a tempo and a form (named sections of a progression), a bass
// riff where the style has its own figure (blues boogie, funk, dub, bossa, the chug), an 8th-note shuffle, the
// Guitar track's voice (DI Box) and tone (a Guitar Studio rig), and the faders (measured: tools/jam-test.js renders
// every preset and holds the mix to its level).
const DI_CLEAN = { body: 0, pick: 0.3, pickup: 0.55, tone: 0.65, decay: 1, strum: 10, mute: 0 };
const DI_NECK = { body: 0, pick: 0.4, pickup: 0.85, tone: 0.5, decay: 1.3, strum: 10, mute: 0 };
const DI_CRUNCH = { body: 0, pick: 0.15, pickup: 0, tone: 0.7, decay: 1.2, strum: 7, mute: 1 };
const DI_NYLON = { body: 1, pick: 0.55, pickup: 0.25, tone: 0.4, decay: 1, strum: 22, mute: 0 };
const B = (t, role, d, v) => [t, role, d, v];
export const JAM_STYLES = {
  blues: {
    label: 'Blues shuffle',
    blurb: 'a twelve-bar shuffle: boogie bass, organ on the backbeat',
    key: { root: 'A', scale: 'blues' },
    tempo: 92,
    shuffle: 1,
    sevenths: true,
    rootless: true,
    midCost: 0.6,
    swing: 0,
    ghost: 0.04,
    progs: { twelve: 'I7 I7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7' },
    form: [
      ['Chorus 1', 'twelve'],
      ['Chorus 2', 'twelve'],
    ],
    chords: {
      name: 'Organ',
      device: 'core.organ',
      params: { reg: 2, perc: 2, click: 0.4, drive: 0.2, rotor: 0, cab: 0.85, tone: 0.5 },
      register: [55, 72],
      rhythm: [
        [1, 0.55, 0.85],
        [1.5, 0.4, 0.58],
        [3, 0.55, 0.88],
        [3.5, 0.4, 0.6],
      ],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bassguitar',
      params: { style: 0, tone: 0.35, pickup: 0.25, sustain: 1, mute: 0.08, drive: 0.2 },
      range: [28, 52],
      riff: [
        B(0, 'R', 0.45, 0.9),
        B(0.5, '3', 0.4, 0.72),
        B(1, '5', 0.45, 0.84),
        B(1.5, '6', 0.4, 0.7),
        B(2, 'b7', 0.45, 0.86),
        B(2.5, '6', 0.4, 0.7),
        B(3, '5', 0.45, 0.82),
        B(3.5, '3', 0.4, 0.7),
      ],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 5, room: 0.45, tone: 0, decay: 1, drive: 0.15 },
      rows: { kick: 'X.......X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
      alt: { kick: 'X.......X.....x.' },
      fill: { from: 12, rows: { snare: 'x.x.', tom3: '...' } },
      crash: 'after',
    },
    guitar: { params: DI_NECK, tone: 'blues' },
    gain: { chords: -3.3, bass: -6.6, drums: -4.8, guitar: -1 },
  },
  funk: {
    label: 'Funk',
    blurb: 'a two-chord vamp: sixteenth hats, ghost notes, stabs on the e-piano',
    key: { root: 'E', scale: 'minor' },
    tempo: 104,
    sevenths: true,
    ninths: true,
    rootless: true,
    midCost: 0.6,
    swing: 0.08,
    ghost: 0.1,
    progs: { vamp: 'i7 i7 IV7 IV7', turn: 'bVImaj7 bVImaj7 V7 V7' },
    form: [
      ['Groove', 'vamp'],
      ['Groove', 'vamp'],
      ['Turn', 'turn'],
      ['Groove', 'vamp'],
    ],
    chords: {
      name: 'E-piano',
      device: 'core.ep',
      params: { voice: 0, voicing: 0.85, bright: 0.6, decay: 1, drive: 0.45, trem: 0, rate: 4.5, release: 0.14 },
      register: [57, 74],
      rhythm: [
        [0.25, 0.2, 0.72],
        [0.75, 0.22, 0.86],
        [1.75, 0.2, 0.7],
        [2.5, 0.22, 0.86],
        [3.25, 0.2, 0.68],
        [3.75, 0.2, 0.74],
      ],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bassguitar',
      params: { style: 1, tone: 0.45, pickup: 0.8, sustain: 1, mute: 0.08, drive: 0.2 },
      range: [28, 52],
      riff: [
        B(0, 'R', 0.25, 0.95),
        B(0.75, 'R', 0.2, 0.6),
        B(1, '8', 0.2, 0.86),
        B(1.5, 'b7', 0.25, 0.72),
        B(2, 'R', 0.25, 0.9),
        B(2.5, '5', 0.2, 0.66),
        B(2.75, 'b7', 0.2, 0.7),
        B(3, '8', 0.25, 0.86),
        B(3.5, '5', 0.2, 0.7),
        B(3.75, 'lead', 0.2, 0.76),
      ],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 0, room: 0.2, tone: 0.2, decay: 0.9, drive: 0.2 },
      rows: { kick: 'X.....x..x......', snare: '....X..o.o..X..o', hat: 'xxxxxxxxxxxxxxxx' },
      alt: { kick: 'X.x...x..x....x.' },
      fill: { from: 12, rows: { snare: 'xoxX', hat: '....' } },
      crash: 'after',
    },
    guitar: { params: DI_CLEAN, tone: 'gr-clucky' },
    gain: { chords: -5.3, bass: -5.3, drums: -4.6, guitar: 8.5 },
  },
  indie: {
    label: 'Indie',
    blurb: 'eighth-note bass and a bright piano under a jangly verse and chorus',
    key: { root: 'G', scale: 'major' },
    tempo: 122,
    midCost: 0.5,
    swing: 0,
    ghost: 0.04,
    progs: { verse: 'I V vi IV', chorus: 'IV I V vi' },
    form: [
      ['Verse', 'verse'],
      ['Verse', 'verse'],
      ['Chorus', 'chorus'],
      ['Chorus', 'chorus'],
    ],
    chords: {
      name: 'Piano',
      device: 'core.piano',
      params: { tone: 0.8, touch: 0.35, decay: 1, damper: 0.16, hammer: 0.4, unison: 0.2, width: 0.6, room: 0.15 },
      register: [52, 71],
      rhythm: [
        [0, 1.5, 1],
        [1.5, 1, 0.78],
        [2.5, 1.5, 0.86],
      ],
      legato: 0.95,
    },
    bass: {
      name: 'Bass',
      device: 'core.bassguitar',
      params: { style: 1, tone: 0.45, pickup: 0.35, sustain: 1, mute: 0.08, drive: 0.4 },
      mode: 'eighths',
      line: ['R'],
      approach: 'last',
      legato: 0.85,
      range: [28, 47],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 0, room: 0.35, tone: 0.2, decay: 1, drive: 0.15 },
      rows: { kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
      alt: { kick: 'X.....x.X.x.....' },
      fill: { from: 12, rows: { kick: 'x...', snare: 'xx..', tom1: '..x.', tom3: '...X' } },
      crash: 'start',
    },
    guitar: { params: DI_CLEAN, tone: 'jangle' },
    gain: { chords: -7.3, bass: -5.7, drums: -5.3, guitar: 3.7 },
  },
  ballad: {
    label: 'Ballad',
    blurb: 'broken piano chords, strings, a half-time kit',
    key: { root: 'C', scale: 'major' },
    tempo: 68,
    midCost: 0.25,
    swing: 0,
    ghost: 0,
    arp: true,
    progs: { verse: 'I V vi IV', chorus: 'vi IV I V' },
    form: [
      ['Verse', 'verse'],
      ['Verse', 'verse'],
      ['Chorus', 'chorus'],
      ['Chorus', 'chorus'],
    ],
    chords: { ...STYLES.ballad.chords },
    bass: { ...STYLES.ballad.bass },
    drums: { ...STYLES.ballad.drums },
    pad: {
      name: 'Strings',
      device: 'core.strings',
      params: { attack: 0.6, release: 1.2, bright: 0.45, vibrato: 0.45, ensemble: 0.5, width: 0.6, hall: 0.35 },
      register: [55, 76],
    },
    guitar: { params: DI_NECK, tone: 'siren' },
    gain: { chords: -1.6, bass: -8.5, drums: -6.2, pad: -8, guitar: 2 },
  },
  neosoul: {
    label: 'Neo-soul',
    blurb: 'lazy drums, ninth chords on the electric piano, a round bass',
    key: { root: 'Eb', scale: 'major' },
    tempo: 78,
    sevenths: true,
    ninths: true,
    rootless: true,
    strum: 0.015,
    midCost: 0.6,
    swing: 0.18,
    ghost: 0.14,
    progs: { a: 'IVmaj7 iii7 ii7 Imaj7', b: 'vi7 II7 ii7 V7' },
    form: [
      ['Verse', 'a'],
      ['Verse', 'a'],
      ['Bridge', 'b'],
      ['Verse', 'a'],
    ],
    chords: {
      name: 'E-piano',
      device: 'core.ep',
      params: { voice: 0, voicing: 0.5, bright: 0.45, decay: 1.1, drive: 0.2, trem: 0.25, rate: 4.5, release: 0.2 },
      register: [50, 72],
      rhythm: [
        [0, 2.25, 0.8],
        [2.5, 1.5, 0.66],
      ],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bassguitar',
      params: { style: 0, tone: 0.3, pickup: 0.2, sustain: 1.1, mute: 0.08, drive: 0.15 },
      mode: 'kick',
      line: ['R', '5', '8'],
      approach: 'add',
      legato: 0.9,
      range: [28, 47],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 2, room: 0.25, tone: -0.1, decay: 0.95, drive: 0.25 },
      rows: { kick: 'X......x..x.....', snare: '....X.......X...', hat: 'x.xox.x.x.xox.x.' },
      alt: { kick: 'X......x..x...x.' },
      fill: { from: 12, rows: { kick: '.x..', snare: 'x.ox', hat: 'x...' } },
      crash: 'none',
    },
    guitar: { params: DI_NECK, tone: 'gr-motown' },
    gain: { chords: -1, bass: -5.5, drums: -3.4, guitar: 4.9 },
  },
  metal: {
    label: 'Metal',
    blurb: 'a palm-muted chug on a rhythm guitar, double kick, power chords',
    key: { root: 'E', scale: 'minor' },
    tempo: 132,
    power: true,
    midCost: 0.6,
    swing: 0,
    ghost: 0,
    progs: { riff: 'i5 i5 bVI5 bVII5', lift: 'bVI5 bVII5 i5 i5' },
    form: [
      ['Riff', 'riff'],
      ['Riff', 'riff'],
      ['Lift', 'lift'],
      ['Riff', 'riff'],
    ],
    chords: {
      name: 'Rhythm',
      device: 'core.guitar',
      params: DI_CRUNCH,
      inserts: [{ device: 'core.stack', params: {} }],
      register: [40, 52],
      rhythm: [
        [0, 0.2, 0.95],
        [0.25, 0.2, 0.3],
        [0.5, 0.2, 0.3],
        [0.75, 0.2, 0.3],
        [1, 0.45, 0.9],
        [1.5, 0.2, 0.3],
        [1.75, 0.2, 0.3],
        [2, 0.2, 0.95],
        [2.25, 0.2, 0.3],
        [2.5, 0.2, 0.3],
        [2.75, 0.2, 0.3],
        [3, 0.9, 0.9],
      ],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bassguitar',
      params: { style: 1, tone: 0.5, pickup: 0.35, sustain: 1, mute: 0.08, drive: 0.6 },
      range: [28, 47],
      riff: [
        B(0, 'R', 0.2, 0.95),
        B(0.25, 'R', 0.2, 0.7),
        B(0.5, 'R', 0.2, 0.75),
        B(0.75, 'R', 0.2, 0.7),
        B(1, 'R', 0.45, 0.9),
        B(1.5, 'R', 0.2, 0.75),
        B(1.75, 'R', 0.2, 0.7),
        B(2, 'R', 0.2, 0.95),
        B(2.25, 'R', 0.2, 0.7),
        B(2.5, 'R', 0.2, 0.75),
        B(2.75, 'R', 0.2, 0.7),
        B(3, 'R', 0.9, 0.9),
      ],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 5, room: 0.3, tone: 0.2, decay: 0.9, drive: 0.4 },
      rows: { kick: 'X.xxX.xxX.xxX.xx', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
      alt: { kick: 'XxxxX.xxXxxxX.xx' },
      fill: { from: 12, rows: { kick: 'xxxx', snare: 'xxxX', hat: '....' } },
      crash: 'start',
    },
    guitar: { params: DI_CRUNCH, tone: 'kraken' },
    gain: { chords: 1.9, bass: -5.9, drums: -7.4, guitar: 0.5 },
  },
  reggae: {
    label: 'Reggae',
    blurb: 'a one drop: the kick and rim on three, the organ skank on two and four',
    key: { root: 'A', scale: 'minor' },
    tempo: 74,
    midCost: 0.6,
    swing: 0.1,
    ghost: 0,
    progs: { a: 'i i iv iv', b: 'bVI bVII i i' },
    form: [
      ['Verse', 'a'],
      ['Verse', 'a'],
      ['Chorus', 'b'],
      ['Verse', 'a'],
    ],
    chords: {
      name: 'Organ',
      device: 'core.organ',
      params: { reg: 1, perc: 1, click: 0.4, drive: 0, rotor: 0, cab: 0.85, tone: 0.55 },
      register: [55, 72],
      rhythm: [
        [1, 0.35, 0.86],
        [3, 0.35, 0.86],
      ],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bass',
      params: { wave: 0.05, sub: 0.75, cutoff: 420, reso: 0.15, envamt: 0.2, drive: 0.1, glide: 30, release: 0.08 },
      range: [28, 47],
      riff: [
        B(0, 'R', 1.2, 0.9),
        B(1.5, '5', 0.4, 0.74),
        B(2, '8', 0.4, 0.7),
        B(2.5, '5', 0.9, 0.8),
        B(3.5, '3', 0.4, 0.72),
      ],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 0, room: 0.3, tone: 0.1, decay: 1, drive: 0.1 },
      rows: { kick: '........X.......', rim: '........X.......', hat: 'x.x.x.x.x.x.x.x.' },
      alt: { hat: 'x.x.x.x.x.x.x.xo' },
      fill: { from: 12, rows: { rim: 'x.x.', tom1: '...x' } },
      crash: 'none',
    },
    guitar: { params: DI_CLEAN, tone: 'gr-skank' },
    gain: { chords: -3.7, bass: -5.9, drums: 0, guitar: 8.3 },
  },
  bossa: {
    label: 'Bossa nova',
    blurb: 'the clave on the rim, a soft kick heartbeat, felt piano comping',
    key: { root: 'D', scale: 'minor' },
    tempo: 132,
    sevenths: true,
    rootless: true,
    midCost: 0.6,
    swing: 0,
    ghost: 0,
    progs: { a: 'i6 i6 ii7b5 V7', b: 'iv7 bVII7 bIIImaj7 bVImaj7' },
    form: [
      ['A', 'a'],
      ['A', 'a'],
      ['B', 'b'],
      ['A', 'a'],
    ],
    chords: {
      name: 'Piano',
      device: 'core.piano',
      params: { tone: 0.15, touch: 0.5, decay: 0.8, damper: 0.16, hammer: 0.7, unison: 0.2, width: 0.6, room: 0.4 },
      register: [52, 72],
      rhythm: [
        [0, 0.75, 0.72],
        [1.5, 0.5, 0.7],
        [2.5, 0.75, 0.7],
        [3.5, 0.45, 0.64],
      ],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bassguitar',
      params: { style: 0, tone: 0.3, pickup: 0.2, sustain: 1.1, mute: 0.08, drive: 0.1 },
      range: [28, 47],
      riff: [B(0, 'R', 1.4, 0.86), B(1.5, '5', 0.45, 0.7), B(2, '5', 1.4, 0.8), B(3.5, 'R', 0.45, 0.7)],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 0, room: 0.25, tone: -0.2, decay: 0.9, drive: 0.05 },
      rows: { kick: 'X..xX..xX..xX..x', rim: 'x..x..x...x..x..', hat: 'xoxoxoxoxoxoxoxo' },
      alt: { rim: '..x..x...x..x...' },
      fill: { from: 16, rows: {} },
      crash: 'none',
    },
    guitar: { params: DI_NYLON, tone: 'gr-jazz' },
    gain: { chords: 2, bass: -6.9, drums: -9.4, guitar: -0.3 },
  },
  lofi: {
    label: 'Lo-fi',
    blurb: 'dusty Rhodes sevenths, a lazy swung beat, a warm round bass',
    key: { root: 'F', scale: 'major' },
    tempo: 80,
    sevenths: true,
    ninths: true,
    rootless: true,
    strum: 0.012,
    midCost: 0.6,
    swing: 0.2,
    ghost: 0.16,
    progs: { a: 'ii7 V7 Imaj7 vi7', b: 'IVmaj7 V7 iii7 vi7' },
    form: [
      ['A', 'a'],
      ['A', 'a'],
      ['B', 'b'],
      ['A', 'a'],
    ],
    chords: { ...STYLES.lofi.chords },
    bass: { ...STYLES.lofi.bass },
    drums: { ...STYLES.lofi.drums },
    guitar: { params: DI_NECK, tone: 'in-salad' },
    gain: { chords: -4.8, bass: -10, drums: -2.4, guitar: -1.2 },
  },
  rock: {
    label: 'Classic rock',
    blurb: 'driving eighths, power chords and a big backbeat',
    key: { root: 'E', scale: 'mixolydian' },
    tempo: 116,
    power: true,
    midCost: 0.6,
    swing: 0,
    ghost: 0.03,
    progs: { verse: 'I bVII IV I', chorus: 'IV V IV V' },
    form: [
      ['Verse', 'verse'],
      ['Verse', 'verse'],
      ['Chorus', 'chorus'],
      ['Verse', 'verse'],
    ],
    chords: { ...STYLES.rock.chords },
    bass: { ...STYLES.rock.bass },
    drums: { ...STYLES.rock.drums },
    guitar: { params: DI_CLEAN, tone: 'crunch' },
    gain: { chords: -6.1, bass: -8.3, drums: -6.2, guitar: 1.2 },
  },
};
export const JAM_STYLE_IDS = Object.keys(JAM_STYLES);
const STYLE_ALIAS = {
  'blues shuffle': 'blues',
  shuffle: 'blues',
  'slow blues': 'blues',
  '12 bar': 'blues',
  'twelve bar': 'blues',
  funky: 'funk',
  disco: 'funk',
  'indie rock': 'indie',
  'indie pop': 'indie',
  pop: 'indie',
  jangle: 'indie',
  'power ballad': 'ballad',
  slow: 'ballad',
  'neo-soul': 'neosoul',
  'neo soul': 'neosoul',
  soul: 'neosoul',
  'r&b': 'neosoul',
  rnb: 'neosoul',
  'metal chug': 'metal',
  chug: 'metal',
  djent: 'metal',
  heavy: 'metal',
  'one drop': 'reggae',
  dub: 'reggae',
  ska: 'reggae',
  'bossa nova': 'bossa',
  jazz: 'bossa',
  latin: 'bossa',
  'lo-fi': 'lofi',
  'lo fi': 'lofi',
  chill: 'lofi',
  hiphop: 'lofi',
  'hip-hop': 'lofi',
  'classic rock': 'rock',
  'hard rock': 'rock',
};
export function findJamStyle(name) {
  const k = String(name || '')
    .trim()
    .toLowerCase();
  return JAM_STYLES[k] ? k : STYLE_ALIAS[k] || null;
}
// The ready-made jam tracks the picker offers: one per style, at its own key and tempo.
export const JAM_PRESETS = JAM_STYLE_IDS.map((id) => {
  const S = JAM_STYLES[id];
  return { id, style: id, title: `${S.label} in ${keyWord(S.key)}`, key: S.key, tempo: S.tempo, blurb: S.blurb };
});
function keyWord(k) {
  return /blues|mixolydian|major/.test(k.scale) && !/minor/i.test(k.scale) ? k.root : `${k.root} minor`;
}

// The chord's notes a part plays: its tones (a power chord: root and fifth); where the style wants sevenths, a plain
// triad gets the one it has in the key (a minor triad its m7, the V its dominant 7th, any other major triad its maj7,
// a diminished one its m7b5); where it wants colour, a seventh chord gets its 9th.
function partPcs(ch, S, key) {
  if (S.power) return [ch.root, (ch.root + 7) % 12];
  const iv = [...(QUALITIES[ch.quality] || QUALITIES['']).iv];
  if (S.sevenths && iv.length === 3) {
    const deg = key ? (ch.root - parsePc(key.root) + 12) % 12 : -1;
    if (ch.quality === 'm') iv.push(10);
    else if (ch.quality === '') iv.push(deg === 7 ? 10 : 11);
    else if (ch.quality === 'dim') iv.push(10);
  }
  // (a ninth only where the key has it: Bm7 in G gets no C#; and never on a chord that has its own 9th, flat or sharp)
  if (
    S.ninths &&
    iv.length >= 4 &&
    ch.quality !== 'm7b5' &&
    ch.quality !== 'dim7' &&
    !iv.some((i) => i >= 13 && i <= 15) &&
    (!key || scalePcs(key).includes((ch.root + 2) % 12))
  )
    iv.push(14);
  return [...new Set(iv.map((i) => (ch.root + i) % 12))];
}

// arrange.js's segments for a chart: one per chord, the tones a part plays, the bass note, whether it's a change.
function segmentsOf(chart, S, key) {
  return chart.map((c, i) => {
    const Q = QUALITIES[c.chord.quality] || QUALITIES[''];
    const triad = [
      c.chord.root,
      (c.chord.root + (Q.iv[1] ?? 7)) % 12,
      (c.chord.root + (Q.iv.find((x) => x === 6 || x === 7 || x === 8) ?? 7)) % 12,
    ];
    const prev = chart[i - 1];
    return {
      a: c.a,
      b: c.b,
      bar: c.bar,
      chord: {
        degree: c.id,
        root: c.chord.root,
        triad,
        seventh: (c.chord.root + (Q.iv[3] ?? 10)) % 12,
        ninth: (c.chord.root + 2) % 12,
        quality: c.chord.quality,
      },
      pcs: partPcs(c.chord, S, key),
      avoid: [],
      bassPc: c.chord.bass,
      change: !prev || prev.chord.name !== c.chord.name,
      name: c.chord.name,
    };
  });
}

// A bass riff from the style: each [t, role, d, v] of a 4/4 bar, on the chord sounding there. Roles: R the chord's
// bass note, 3 its third (the major or minor one it has), 5 its fifth, 6 a major sixth, b7 a flat seventh, 8 the octave,
// lead a semitone under the next chord's root (on the last note before a change, else the fifth). The first note
// under a new chord is its root, wherever in the bar the chord arrives (a D7 on beat 3 of a boogie bar gets its D, not
// the bar's tail, C B A F#).
function riffBass(S, segs, { bars, bpb, R }) {
  const Bs = S.bass,
    [lo, hi] = Bs.range,
    out = [];
  let prev = Math.round((lo + hi) / 2) - 3,
    last = null;
  const segAt = (t) => segs.find((s) => t >= s.a - EPS && t < s.b - EPS) || segs[segs.length - 1];
  // (the chord a note is under is the one sounding when it's heard: a shuffled offbeat 8th sounds a third of a beat late)
  const late = (rt) => (S.shuffle && Math.abs(rt - Math.floor(rt + EPS) - 0.5) < 0.02 ? S.shuffle / 6 : 0);
  for (let k = 0; k < bars; k++) {
    for (const [rt, bRole, rd, rv] of Bs.riff) {
      const t = k * bpb + rt,
        s = segAt(r4(t + late(rt)));
      if (!s || s.bassPc == null) continue;
      const role = s !== last && s.change ? 'R' : bRole;
      last = s;
      const Q = QUALITIES[s.chord.quality] || QUALITIES[''];
      const third = Q.iv.includes(4) ? 4 : Q.iv.includes(3) ? 3 : 0;
      const fifth = Q.iv.find((x) => x === 6 || x === 7 || x === 8) ?? 7; // (a m7b5's is flat, an aug's sharp)
      const root = nearestPitch(s.bassPc, prev, lo, Math.min(hi, lo + 14));
      const R0 = nearestPitch(s.chord.root, root, lo, hi);
      let p;
      if (role === 'R') p = root;
      else if (role === '3') p = R0 + third;
      else if (role === '5') p = nearestPitch((s.chord.root + fifth) % 12, root + 3, lo, hi);
      else if (role === '6') p = R0 + 9;
      else if (role === 'b7') p = R0 + 10;
      else if (role === '8') p = root + 12 <= hi ? root + 12 : root;
      else if (role === 'lead') {
        const next = segs.find((x) => x.a > t + EPS && x.a <= t + rd + 0.5 && x.change);
        p = next
          ? nearestPitch(next.bassPc, root, lo, hi) - 1
          : nearestPitch((s.chord.root + fifth) % 12, root, lo, hi);
      } else p = root;
      while (p > hi) p -= 12;
      while (p < lo) p += 12;
      out.push({
        p,
        t: r4(t),
        d: r4(Math.min(rd, s.b - t + 0.02)),
        v: r4(clamp(rv * (1 + (R() - 0.5) * 0.08), 0.1, 1)),
      });
      prev = root;
    }
  }
  return out;
}

// The pad: each chord held to the next change, voice-led.
function padPart(S, segs) {
  const out = [];
  let prevV = null;
  for (const s of segs) {
    if (!s.pcs.length) continue;
    const v = voice(s.pcs.slice(0, 4), S.pad.register, prevV, null);
    for (const p of v) out.push({ p, t: s.a, d: r4(s.b - s.a), v: 0.5 });
    prevV = v;
  }
  return out;
}

// An 8th-note shuffle: notes on an offbeat 8th move to the last third of the beat (amount 1: a full triplet feel).
function shuffle(notes, amount = 1) {
  const sh = (1 / 6) * amount;
  return notes.map((n) => {
    const f = n.t - Math.floor(n.t + EPS);
    if (Math.abs(f - 0.5) < 0.02) return { ...n, t: r4(n.t + sh), d: r4(Math.max(0.05, n.d - sh)) };
    if (Math.abs(f) < 0.02 && n.d > 0.35 && n.d < 0.55) return { ...n, d: r4(n.d + sh * 0.8) }; // the long first of a pair
    return n;
  });
}

const PART_COLOR = {
  chords: 'var(--c-6)',
  pad: 'var(--c-2)',
  bass: 'var(--c-5)',
  drums: 'var(--c-1)',
  guitar: 'var(--c-3)',
};
export const JAM_MAX_BARS = 64;

// A jam track: a real song, made on the spot by the house band.
//   style: a JAM_STYLES id (or a word for one: "slow blues", "bossa nova"); key: 'A', 'E minor', { root, scale };
//   tempo: 40..240; progression: text (parseProgression; default the style's form); bars: the length (the form, or the
//   progression, repeated to fill it; default the form); seed: the take (velocities, ghost notes, fills);
//   by: who the parts are signed by; rig(id) -> [{ device, params, on }] the Guitar track's tone, when the guitar
//   rigs are loaded (in the page; the Node renderer bypasses graph devices anyway).
export function jamTrack({
  style = 'blues',
  key = null,
  tempo = null,
  progression = null,
  bars = null,
  seed = 1,
  by = 'overdub',
  rig = null,
} = {}) {
  const sid = findJamStyle(style);
  if (!sid) return { error: `no jam style "${style}"`, hint: `styles: ${JAM_STYLE_IDS.join(', ')}` };
  const S = JAM_STYLES[sid];
  const k = key == null ? S.key : parseKey(key, S.key);
  if (!k)
    return {
      error: `can't read the key "${typeof key === 'object' ? JSON.stringify(key) : key}"`,
      hint: 'a note and major or minor: "A", "E minor", "Bb major", "F# minor"',
    };
  // a key given as a note keeps the style's scale (blues stays blues); a key with its own word takes it
  const bpm = tempo == null || tempo === '' ? S.tempo : Number(tempo);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240)
    return { error: `tempo ${tempo} is out of range`, hint: 'a jam track is 40 to 240 BPM' };
  const meter = [4, 4],
    bpb = 4;
  // the form: [{ name, bars: [[chord, ...], ...] }]
  let form;
  if (progression) {
    const pr = parseProgression(progression, k);
    if (pr.error) return pr;
    form = [{ name: 'Jam', bars: pr.bars }];
  } else {
    form = S.form.map(([name, id]) => ({ name, bars: parseProgression(S.progs[id], k).bars }));
  }
  const formBars = form.reduce((a, f) => a + f.bars.length, 0);
  const total =
    bars == null
      ? progression
        ? Math.max(formBars, Math.ceil(16 / formBars) * formBars)
        : formBars
      : Math.round(Number(bars));
  if (!Number.isFinite(total) || total < 1)
    return { error: `bars must be a number of bars (got ${bars})`, hint: `1 to ${JAM_MAX_BARS}` };
  if (total > JAM_MAX_BARS)
    return { error: `${total} bars is too long for a jam track`, hint: `up to ${JAM_MAX_BARS} bars; it loops` };
  // lay the form out, round and round, to `total` bars: the chart (one entry per chord) and the sections
  const chart = [],
    sections = [];
  let bar = 0,
    ids = new Map();
  while (bar < total) {
    for (const f of form) {
      if (bar >= total) break;
      const startBar = bar;
      for (const chordsInBar of f.bars) {
        if (bar >= total) break;
        const n = chordsInBar.length;
        chordsInBar.forEach((ch, i) => {
          const a = bar * bpb + (i * bpb) / n,
            b = bar * bpb + ((i + 1) * bpb) / n;
          if (!ids.has(ch.name)) ids.set(ch.name, ids.size);
          chart.push({ a: r4(a), b: r4(b), bar: bar + 1, chord: ch, id: ids.get(ch.name) });
        });
        bar++;
      }
      const last = sections[sections.length - 1];
      // two rounds of one part in a row are one section ("Verse", bars 1-8), not two
      if (last && last.name === f.name && Math.abs(last.start + last.length - startBar * bpb) < EPS)
        last.length += (bar - startBar) * bpb;
      else sections.push({ name: f.name, start: startBar * bpb, length: (bar - startBar) * bpb });
    }
  }
  // merge a chord that runs on into the next bar (a chart reads "A7 for four bars", the band plays it as one)
  const length = total * bpb,
    R = rng(`${seed}:${sid}:jam`);
  const segs = segmentsOf(chart, S, k);
  const S16 = 16,
    k0 = 0;
  const gridAt = (kk, step) => r4(kk * bpb + step * 0.25 + (step % 2 === 1 ? (S.swing || 0) * 0.25 : 0));
  const hk = isMinorKey(k) ? { root: k.root, scale: 'minor' } : { root: k.root, scale: 'major' };
  // drums: arrange.js's grooves, a bar at a time (the fill every 4th bar, the crash, seeded velocities and ghosts)
  const drumBars = [];
  for (let kk = 0; kk < total; kk++) drumBars.push(drumBar({ ...S, drums: S.drums }, sid, meter, S16, kk, R));
  const parts = {};
  parts.drums = [];
  drumBars.forEach((b, i) => {
    for (const n of b.notes) parts.drums.push({ p: n.p, t: gridAt(i, n.step), d: 0.25, v: n.v });
  });
  const kickSteps = drumBars.map((b) =>
    b.notes
      .filter((n) => n.p === 35 || n.p === 36)
      .map((n) => n.step)
      .sort((x, y) => x - y),
  );
  const segAt = (t) => segs.find((s) => t >= s.a - EPS && t < s.b - EPS) || segs[segs.length - 1];
  // the bass: the style's riff, or arrange.js's line (on the kick, in eighths, in halves)
  parts.bass = S.bass.riff
    ? riffBass(S, segs, { bars: total, bpb, R })
    : bassLine({ ...S, bass: S.bass }, segs, kickSteps, {
        k0,
        bpb,
        S16,
        start: 0,
        length,
        gridAt,
        segAt,
        hk,
        R,
        meter,
      });
  // the chord part: arrange.js's comping (its rhythm, voice leading, power chords, broken chords, rootless sevenths)
  parts.chords = chordPart({ ...S, chords: S.chords }, sid, segs, {
    k0,
    bpb,
    start: 0,
    length,
    meter,
    gridAt,
    top: () => null,
    R,
  });
  if (S.pad) parts.pad = padPart(S, segs);
  if (S.shuffle) for (const pk of Object.keys(parts)) parts[pk] = shuffle(parts[pk], S.shuffle);
  for (const pk of Object.keys(parts))
    parts[pk] = parts[pk]
      .filter((n) => n.t >= -EPS && n.t < length - EPS)
      .map((n) => ({
        p: n.p,
        t: r4(Math.max(0, n.t)),
        d: r4(Math.max(1 / 32, Math.min(n.d, length - n.t))),
        v: r4(clamp(n.v, 0.05, 1)),
      }))
      .sort((a, b) => a.t - b.t || a.p - b.p);

  // the song
  const title = `${S.label} in ${keyWord(k)}`;
  const order = ['drums', 'bass', 'chords', 'pad'].filter((pk) => parts[pk] && parts[pk].length);
  const clipName = {
    drums: 'Groove',
    bass: 'Bass line',
    chords: S.chords.name === 'Rhythm' ? 'Chug' : 'Comping',
    pad: 'Strings',
  };
  const tracks = order.map((pk) => {
    const P = S[pk];
    return {
      name: P.name,
      color: PART_COLOR[pk],
      kind: 'instrument',
      instrument: { device: P.device, params: { ...(P.params || {}) } },
      inserts: (P.inserts || []).map((fx) => ({ device: fx.device, params: { ...fx.params }, on: true, by })),
      clips: [{ kind: 'notes', start: 0, length, name: clipName[pk], by, notes: parts[pk].map((n) => ({ ...n, by })) }],
      gain: S.gain[pk] ?? -10,
      pan: pk === 'chords' ? -0.18 : pk === 'pad' ? 0.18 : 0,
      mute: false,
      solo: false,
      arm: false,
      by,
    };
  });
  const tone = S.guitar.tone;
  const chain = typeof rig === 'function' ? rig(tone) : null;
  tracks.push({
    name: 'Guitar',
    color: PART_COLOR.guitar,
    kind: 'instrument',
    instrument: { device: 'core.guitar', params: { ...S.guitar.params } },
    inserts: (chain || []).map((s) => ({ device: s.device, params: { ...s.params }, on: s.on !== false, by })),
    clips: [],
    gain: S.gain.guitar ?? -4,
    pan: 0.12,
    mute: false,
    solo: false,
    arm: false,
    by,
  });
  const authors = { overdub: { kind: 'house', name: 'Overdub' } };
  const progText = form
    .map((f) => `${f.name}: ${f.bars.map((b) => b.map((c) => c.name).join(' ')).join(' | ')}`)
    .join('; ');
  const project = createProject({
    title,
    tempo: bpm,
    meter,
    key: k,
    loop: { on: true, start: 0, end: length },
    sections: sections.map((s) => ({ name: s.name, start: s.start, length: s.length })),
    tracks,
    master: {
      gain: 0,
      inserts: [
        { device: 'core.comp', on: true, params: { threshold: -16, ratio: 2, attack: 25, release: 220 }, by },
        { device: 'core.limiter', on: true, params: { gain: 0, ceiling: -1 }, by },
      ],
    },
    meta: {
      authors,
      jam: { style: sid, key: k, tempo: bpm, progression: progression || null, bars: total, seed, tone },
    },
  });
  // in the song's own form (ids for notes, the normalisers' defaults), then ids from the recipe: the same jam track
  // sounds the same every time it's made (ids seed the instruments' randomness)
  const p = stableIds(
    cleanProject(project),
    `jam:${sid}:${k.root}:${k.scale}:${bpm}:${total}:${seed}:${progression || ''}`,
  );
  // (the house band only when the house signed the parts: an agent's jam track is signed by the agent)
  const summary = `${title}, ${bpm} BPM, ${total} bars: ${progText}. ${order.map((pk) => S[pk].name).join(', ')}${by === 'overdub' ? ' by the house band' : ''}, and a Guitar track for you${chain ? ` with ${tone}` : ''}.`;
  return {
    project: p,
    chart: chart.map((c) => ({ a: c.a, b: c.b, bar: c.bar, name: c.chord.name })),
    sections,
    summary,
    style: sid,
    key: k,
    tempo: bpm,
    bars: total,
    tone,
  };
}

/* ================================================================================================ tips */
// The note of `next` to land on as it arrives: the one it has that `cur` doesn't (that's what says "the change"),
// preferring its third, then its seventh, root and fifth; the third when every tone is shared.
export function changeTone(cur, next, key = null) {
  const tones = chordTones(next, key);
  const has = new Set(cur ? cur.pcs : []);
  const rank = (x) => ({ 3: 0, 4: 0, 10: 1, 11: 1, 0: 2, 7: 3 })[x.iv] ?? 4;
  const fresh = tones.filter((x) => !has.has(x.pc)).sort((a, b) => rank(a) - rank(b));
  if (fresh.length) return { ...fresh[0], fresh: true };
  return { ...(tones.find((x) => x.iv === 3 || x.iv === 4) || tones[0]), fresh: false };
}
const ROLE_WORD = {
  R: 'root',
  3: '3rd',
  b3: '3rd',
  5: '5th',
  b5: 'flat 5th',
  '#5': 'sharp 5th',
  b7: '7th',
  7: '7th',
  bb7: '7th',
  9: '9th',
  '#9': 'sharp 9th',
  6: '6th',
  4: '4th',
  2: '2nd',
  b2: 'flat 2nd',
  b9: 'flat 9th',
  11: '11th',
  '#11': 'sharp 11th',
  b13: 'flat 13th',
  13: '13th',
};

// The place of pitch class pc nearest a hand position: in the box (frets pos .. pos+3, a finger a fret), mid strings
// first; then a stretch a fret either side (pos-1, pos+4); else the nearest anywhere on frets from..to. inBox: under a
// finger without a stretch (the only place the tips call "inside the box").
function nearestPlace(pc, T, pos, { from = 0, to = 15 } = {}) {
  let best = null;
  T.strings.forEach((open, s) => {
    for (let f = from; f <= to; f++) {
      if (pcOf(open + f) !== pc) continue;
      const inBox = f >= pos && f <= pos + 3;
      const d = inBox
        ? 0
        : f === pos - 1 || f === pos + 4
          ? 0.2
          : Math.min(Math.abs(f - pos), Math.abs(f - (pos + 3))) + 1;
      const c = d * 10 + Math.abs(s - 3) * 0.5 + (f === 0 ? 2 : 0);
      if (!best || c < best.c) best = { s, f, p: open + f, c, inBox };
    }
  });
  return best;
}
// where the pentatonic box goes for a key: the root under the first finger on the lowest string (minor), or under the
// second (major: the shape a fret lower), between the 3rd and 14th frets
export function boxFor(key, tuning = 'standard') {
  const T = tuningOf(tuning),
    pent = pentatonicFor(key),
    rootPc = parsePc(key.root);
  const r = boxStart(rootPc, T, { min: 3, max: 14 });
  return { at: pent.minor ? r : Math.max(0, r - 1), pent, rootPc };
}

export function jamTips(p, tl, { tuning = 'standard', at = 0, seed = 1 } = {}) {
  const T = tuningOf(tuning),
    out = [];
  const key = tl?.key || null,
    chords = tl?.chords || [];
  if (!chords.length || !key) return out;
  // 1. the scale that fits, and where to put your hand
  const { at: boxAt, pent, rootPc } = boxFor(key, T);
  const box = boxOf(pent.pcs, rootPc, T, { at: boxAt });
  const lowRoot = box.notes.find((n) => n.s === 0 && n.pc === rootPc) || box.notes.find((n) => n.pc === rootPc);
  const keyPcs = scalePcs(key);
  const fitsAll = chords.every((c) => c.tones.every((t) => keyPcs.includes(t.pc)));
  const where = lowRoot
    ? `Start at the ${fretWord(boxAt)}: ${pent.minor ? 'your first finger' : 'your second finger'} on the ${stringWord(lowRoot.s, T)}${lowRoot.f === boxAt ? '' : ` at the ${fretWord(lowRoot.f)}`} is ${spell(rootPc, key)}.`
    : `Start at the ${fretWord(boxAt)}.`;
  out.push({
    id: 'scale',
    kind: 'scale',
    text: `${pent.name} ${fitsAll ? 'fits the whole song' : 'fits most of it'}: ${pent.pcs.map((pc) => spell(pc, key)).join(' ')}. ${where}`,
    show: {
      scale: pent.name,
      pcs: pent.pcs,
      root: rootPc,
      frets: [Math.max(0, boxAt - 1), boxAt + 4],
      positions: box.notes.map(({ s, f }) => ({ s, f })),
      label: `${pent.name}, ${fretWord(boxAt)}`,
    },
  });
  // 2. the note to land on at the next change (from the playhead, round the loop as the stage counts it, or round to
  // the top past the song's last change)
  const nc = nextChange(p, tl, at);
  const cur = nc ? nc.from : chordAt(tl, at).chord || chords[0];
  const next = nc ? nc.chord : null;
  if (next) {
    const tone = changeTone(cur, next, key);
    const place = nearestPlace(tone.pc, T, boxAt);
    const fret = place ? fretWord(place.f) : '';
    const round = nc.wrap === 'loop' ? ', round the loop,' : nc.wrap === 'top' ? ', from the top,' : '';
    out.push({
      id: 'target',
      kind: 'target',
      text: `At bar ${nc.bar}${round} the chord moves to ${next.name}. Land on ${tone.note}, its ${ROLE_WORD[tone.name] || tone.name}${tone.fresh ? `: ${cur.name} doesn't have it, so it's the note that says the change` : ''}.${place ? ` ${fret[0].toUpperCase() + fret.slice(1)}, ${stringWord(place.s, T)}${place.inBox ? ', inside the box' : ''}.` : ''}`,
      show: {
        chord: next.name,
        pcs: next.pcs,
        root: next.root,
        positions: place ? [{ s: place.s, f: place.f }] : [],
        label: `${next.name}: land on ${tone.note}`,
        frets: place ? [Math.max(0, place.f - 2), place.f + 2] : null,
      },
      bar: nc.bar,
    });
  }
  // 3. the chords that step outside the key, and the note each one brings
  const outKey = [];
  for (const c of uniqBy(chords, (c) => c.name)) {
    const off = c.tones.filter((t) => !keyPcs.includes(t.pc));
    if (off.length) outKey.push({ chord: c, off });
  }
  if (outKey.length) {
    const lines = outKey
      .slice(0, 3)
      .map(({ chord, off }) => `${off.map((t) => t.note).join(' and ')} over ${chord.name}`);
    const dominant = outKey.every(({ chord }) => chord.quality === '7' || chord.quality === '9');
    out.push({
      id: 'outside',
      kind: 'outside',
      text: `${outKey.length === 1 ? `${outKey[0].chord.name} steps` : `${outKey.length} chords step`} outside ${scaleFor(key).name}: play ${lines.join(', ')}${outKey.length > 3 ? ', and more' : ''}. ${dominant ? 'Slide or bend into them from a fret below: that is the sound of the changes.' : 'Those are the notes that follow the chord; the scale’s own would rub there.'}`,
      show: {
        chord: outKey[0].chord.name,
        pcs: outKey[0].off.map((t) => t.pc),
        root: outKey[0].chord.root,
        label: `${outKey[0].chord.name}: ${outKey[0].off.map((t) => t.note).join(' ')}`,
      },
    });
  }
  // 4. a section in another key
  const shift = sectionKeys(p, tl, key);
  if (shift) out.push({ id: 'shift', kind: 'shift', text: shift.text, show: shift.show });
  // 5. a two-bar lick into the next change, shown on the neck (round the loop: the loop's last bar, then its first)
  const bar0 = nc ? nc.lead : cur.bar;
  const lick = makeLick(tl, {
    key,
    bar: bar0,
    tuning: T,
    seed,
    meter: p.meter,
    box: boxAt,
    next: nc && nc.bar !== bar0 + 1 ? nc : null,
  });
  if (lick && !lick.error)
    out.push({
      id: 'lick',
      kind: 'lick',
      text: lick.text,
      lick,
      show: {
        positions: lick.notes.map(({ s, f }) => ({ s, f })),
        label: lick.label,
        frets: [Math.max(0, boxAt - 1), boxAt + 4],
      },
      bar: bar0,
    });
  return out;
}
function uniqBy(list, key) {
  const seen = new Set();
  return list.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// A section in another key: its chords all fit one major or minor key that isn't the song's, they bring two or more
// notes the song's key doesn't have, and some other section does fit the song's key (a blues, whose every chord steps
// out, isn't a key change; that's the "outside" tip's business). "Chorus moves to D major (bars 9-16): F# and C# …"
export function sectionKeys(p, tl, key) {
  const secs = p.sections || [];
  if (secs.length < 2 || !key) return null;
  const home = new Set(scalePcs(key));
  const info = secs.map((s) => {
    const cs = tl.chords.filter((c) => c.start >= s.start - EPS && c.start < s.start + s.length - EPS);
    const pcs = [...new Set(cs.flatMap((c) => c.pcs))];
    return { s, cs, pcs, off: pcs.filter((pc) => !home.has(pc)) };
  });
  if (!info.some((x) => x.cs.length && !x.off.length)) return null;
  const bpb = beatsPerBar(p.meter || [4, 4]);
  for (const x of info) {
    if (x.off.length < 2 || x.cs.length < 2) continue;
    let best = null;
    for (let r = 0; r < 12; r++)
      for (const sc of ['major', 'minor']) {
        const k2 = new Set(SCALES[sc].map((i) => (r + i) % 12));
        if (!x.pcs.every((pc) => k2.has(pc))) continue;
        const lean =
          (x.cs[0].root === r ? 1 : 0) +
          (x.cs[x.cs.length - 1].root === r ? 1 : 0) +
          (x.cs.some((c) => c.root === r) ? 0.5 : 0);
        if (!best || lean > best.lean) best = { r, sc, lean };
      }
    if (!best) continue;
    const k2 = { root: spellPc(best.r, { root: NAMESAFE(best.r), scale: best.sc }), scale: best.sc };
    const a = Math.round(x.s.start / bpb) + 1,
      b = Math.round((x.s.start + x.s.length) / bpb);
    const notes = x.off.map((pc) => spellPc(pc, k2));
    return {
      text: `${x.s.name} moves to ${k2.root} ${k2.scale} (bars ${a}–${b}): ${notes.join(' and ')} come in. Take your box to ${k2.root} there, or play ${notes.length > 1 ? 'those notes' : 'that note'} where the old scale had ${notes.length > 1 ? 'their neighbours' : 'its neighbour'}.`,
      show: {
        scale: `${k2.root} ${k2.scale}`,
        pcs: SCALES[best.sc].map((i) => (best.r + i) % 12),
        root: best.r,
        label: `${x.s.name}: ${k2.root} ${k2.scale}`,
      },
    };
  }
  return null;
}
// a key's own name for its root (F# major, not Gb; Bb major, not A#): the spelling with fewer accidentals
function NAMESAFE(pc) {
  return ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][pc];
}

/* ------------------------------------------------------------------------------------------------ the lick */
// Rhythms for two bars of 4/4 ([t, d] in beats; the 7th note lands on beat 1 of the second bar) and phrase shapes
// (steps along the box between notes: a descending answer, a climb and fall, a repeat that resolves, a call). The
// seed picks one of each.
const LICK_RHYTHMS = [
  [
    [0, 0.5],
    [0.5, 0.5],
    [1, 0.5],
    [1.5, 0.5],
    [2, 1],
    [3, 0.5],
    [4, 1.5],
    [5.5, 0.5],
    [6, 2],
  ],
  [
    [0.5, 0.5],
    [1, 0.5],
    [1.5, 0.5],
    [2, 0.5],
    [2.5, 1],
    [3.5, 0.5],
    [4, 1],
    [5, 1],
    [6, 2],
  ],
  [
    [0, 1],
    [1, 0.5],
    [1.5, 0.5],
    [2, 0.5],
    [2.5, 0.5],
    [3, 1],
    [4, 1.5],
    [5.5, 0.5],
    [6, 2],
  ],
];
const LICK_SHAPES = [
  [-1, -1, +1, -1, -1, -1, 0, -1],
  [+1, +1, +1, -1, -2, -1, +1, -1],
  [0, +1, -1, -1, +2, -1, -1, +1],
  [+2, -1, -1, 0, -1, -1, +1, +1],
];
// A two-bar lick over bars `bar` and bar+1, in the pentatonic box: it starts on a tone of the first chord near the top
// of the box, follows a phrase shape, lands on beat 1 of the second bar on the note that says that bar's chord (from
// the key's scale when the pentatonic doesn't have it), and ends long on a tone of that chord. Fingered in the box.
// Its second bar goes round: `next` ({ chord, bar, wrap: 'loop' | 'top' }, from nextChange) is the bar it lands in when
// that isn't bar+1 (the loop's last bar, then its first); past the song's last bar it lands on the song's first.
//   -> { notes: [{ p, t, d, v, s, f, finger }], tab, text, label, bars, over, box, start, starts (each bar's beat), wrap }
export function makeLick(
  tl,
  { key, bar = 1, tuning = 'standard', seed = 1, meter = [4, 4], box = null, next = null } = {},
) {
  const T = tuningOf(tuning),
    bpb = beatsPerBar(meter);
  if (bpb !== 4) return { error: 'licks are written for 4/4 for now', hint: 'a song in 4/4' };
  key = key || tl?.key;
  if (!key || !tl?.chords?.length)
    return { error: 'no chords to play over', hint: 'a song with chords (or a jam track)' };
  const bx = box == null ? boxFor(key, T).at : box;
  const pent = pentatonicFor(key),
    rootPc = parsePc(key.root);
  const ladder = [...new Set(boxOf(pent.pcs, rootPc, T, { at: bx }).notes.map((n) => n.p))].sort((a, b) => a - b);
  const wide = [...new Set(boxOf(scalePcs(key), rootPc, T, { at: bx }).notes.map((n) => n.p))].sort((a, b) => a - b);
  // every note under the hand (for a change's note that is outside the key: F# over D7 in a blues in A)
  const under = [];
  T.strings.forEach((open, s) => {
    for (let f = Math.max(0, bx - 1); f <= bx + 4; f++) under.push(open + f);
  });
  if (ladder.length < 6) return { error: 'the box is too small for a lick', hint: 'another tuning or key' };
  const a0 = (bar - 1) * bpb;
  const c1 = chordAt(tl, a0 + 0.01).chord || tl.chords[0];
  let c2 = chordAt(tl, a0 + bpb + 0.01).chord,
    bar2 = bar + 1,
    wrap = '';
  if (next && next.chord && next.bar !== bar + 1) {
    c2 = next.chord;
    bar2 = next.bar;
    wrap = next.wrap || 'loop';
  } else if (!c2 && a0 + bpb >= tl.chords[tl.chords.length - 1].end - EPS) {
    c2 = tl.chords[0];
    bar2 = c2.bar;
    wrap = 'top';
  }
  c2 = c2 || c1;
  const R = rng(`${seed}:lick:${bar}:${c1.name}:${c2.name}`);
  const rhythm = LICK_RHYTHMS[Math.floor(R() * LICK_RHYTHMS.length)];
  const shape = LICK_SHAPES[Math.floor(R() * LICK_SHAPES.length)];
  const tones = (c) => new Set(c.pcs);
  const nearestIn = (list, want, ref) => {
    const o = list.filter((q) => want(q));
    return o.length
      ? o.reduce((a, b) =>
          Math.abs(b - ref) < Math.abs(a - ref) || (Math.abs(b - ref) === Math.abs(a - ref) && b > a) ? b : a,
        )
      : null;
  };
  // start: a tone of the first chord in the upper half of the box
  const top = ladder[Math.floor(ladder.length * 0.7)];
  let cur = nearestIn(ladder, (q) => tones(c1).has(pcOf(q)), top) ?? top;
  const land = changeTone(c1, c2, key);
  const notes = [];
  rhythm.forEach(([t, d], i) => {
    let p = cur;
    if (i > 0) {
      const idx = ladder.indexOf(cur) >= 0 ? ladder.indexOf(cur) : ladder.findIndex((q) => q >= cur);
      let j = idx + shape[(i - 1) % shape.length];
      if (j < 0) j = 1;
      if (j >= ladder.length) j = ladder.length - 2;
      p = ladder[j];
      if (Math.abs(t - bpb) < EPS)
        p =
          nearestIn(ladder, (q) => pcOf(q) === land.pc, cur) ??
          nearestIn(wide, (q) => pcOf(q) === land.pc, cur) ??
          nearestIn(under, (q) => pcOf(q) === land.pc, cur) ??
          p;
      else if (i === rhythm.length - 1)
        p =
          nearestIn(
            ladder,
            (q) =>
              tones(c2).has(pcOf(q)) &&
              (pcOf(q) === c2.root || pcOf(q) === (c2.root + 3) % 12 || pcOf(q) === (c2.root + 4) % 12),
            cur,
          ) ??
          nearestIn(ladder, (q) => tones(c2).has(pcOf(q)), cur) ??
          p;
      // a strong beat leans to a tone of its chord when one is a step away
      else if (t % 1 < EPS) {
        const ch = t < bpb ? c1 : c2;
        if (!tones(ch).has(pcOf(p))) {
          const k = ladder.indexOf(p);
          const alt = [ladder[k - 1], ladder[k + 1]].find((q) => q != null && tones(ch).has(pcOf(q)));
          if (alt != null) p = alt;
        }
      }
    }
    notes.push({ p, t, d, v: i === rhythm.length - 1 ? 0.84 : t % 1 < EPS ? 0.8 : 0.66 });
    cur = p;
  });
  const fg = fingering(notes, T, { near: bx, from: Math.max(0, bx - 1), to: bx + 4, open: 0.6 });
  if (fg.error) return fg;
  const placed = fg.notes;
  const tab = formatTab(placed, { tuning: T, step: 0.5, meter: [4, 4], bars: 2 });
  const landN = placed.find((n) => Math.abs(n.t - bpb) < EPS),
    lastN = placed[placed.length - 1];
  const over = c1.name !== c2.name ? `${c1.name} to ${c2.name}` : c1.name;
  const landed = landN && pcOf(landN.p) === land.pc;
  const end = spellTone(c2.root, (pcOf(lastN.p) - c2.root + 12) % 12, key, c2.quality);
  const bars = wrap
    ? `bars ${bar} and ${bar2}, ${wrap === 'top' ? 'from the top' : 'round the loop'}`
    : `bars ${bar}–${bar + 1}`;
  const text = `A two-bar lick over ${over} (${bars}), in the box at the ${fretWord(bx)}${landed ? `: it lands on ${land.note} as ${c2.name} arrives and ends on ${end}` : `, ending on ${end}`}.`;
  return {
    notes: placed,
    tab,
    text,
    label: wrap ? `Lick, bars ${bar} and ${bar2}` : `Lick, bars ${bar}–${bar + 1}`,
    bars: [bar, bar2],
    over,
    box: bx,
    start: a0,
    starts: [a0, (bar2 - 1) * bpb],
    wrap,
    shifts: fg.shifts,
  };
}
export { noteName, positionsOf };
