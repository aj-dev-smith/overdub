// The house riff writer [core]: a riff for a section of the song, for a guitarist to read as tab and play over it.
// Deterministic and seeded (no Math.random): the same song, section, style, difficulty and seed give the same riff, and
// "Another" is the next seed. Pure (no DOM): the Jam room's tab lane (ui/tabs.js), the suggest_riff tool
// (agent/tabs-tool.js) and the demo agent all write with it, and tools/tabs-test.js holds it to what it says.
//
// How a riff is made. The section's chords and key come from the chord timeline (core/jam.js); the riff covers its first
// 1-4 bars (the section's own harmonic cycle, two bars at least, unless asked). A style is a set of one-bar motifs,
// each a rhythm with a role per note (the root, the chord's 3rd or 5th, an octave up, a step up or down the pentatonic,
// a power chord, a bend into the 5th...). The motif plays in the first bar and comes back in the others, each time on
// the chord sounding there; the second and fourth bars answer it with another ending. Roles become pitches from what one
// hand can reach: a position on the neck (four frets, plus the open strings when the hand is low) is chosen first, for
// the style and for the chords (each chord's root where the style wants it, and its tones), and every note comes from
// there, so the riff is fingered (core/fretboard.js) without moving the hand. Then it is held to two rules and says
// whether it kept them: a note that starts on a strong beat (1 and 3 in 4/4, 1 in 3/4) lands on a tone of its chord
// (a bend counts where it lands), and every note is in the key, a tone of its chord, or (in a blues) the sweet side the
// room's neck allows. Difficulty: easy keeps to eighths, single notes and the low frets; medium is the style as written,
// power chords included; hard adds sixteenth passing notes and bends.
//
//   RIFF_STYLES, RIFF_STYLE_IDS, DIFFICULTIES, findRiffStyle(word) -> id | null (a jam style's name works too)
//   riffStyleFor(project) -> the style that suits the song (a jam track's own, a blues key's blues, else rock)
//   riffSpan(project, timeline, { section, bars, at }) -> { start, end, bars: [a, b], name, section } | { error, hint }
//   writeRiff(project, { timeline, section, bars, at, length, style, difficulty, seed, motif, tuning, capo })
//       -> { notes: [{ p, t, d, v, s, f, finger, bend? }] (t from the riff's start), start (song beat), bars (count),
//            span: [first bar, last bar], section, chords, style, difficulty, seed, motif, position, label, text, tab,
//            step, checks } | { error, hint }
//   riffTakes(project, opts, n = 3) -> { takes: [riff, ...], span } | { error, hint }   n different riffs (seeds on)
//   riffChecks(riff, timeline, { key, tuning, capo, meter }) -> { inKey, outside, strong, offStrong, playable,
//       unplayable, span, shifts, oneHand }   what the riff claims, checked

import { scalePcs, parsePc, beatsPerBar, noteName, spellPc } from './music.js';
import { rng } from './transforms.js';
import { chordAt, pentatonicFor, isMinorKey, spellIn, QUALITIES, findJamStyle } from './jam.js';
import { tuningOf, fingering, formatTab, handSpan, MAX_FRET, capoOf, placeOk, tabLayout } from './fretboard.js';

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;
const T23 = 2 / 3;
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const S = (t, d, role, a = 0.75) => [t, d, role, a];

/* ================================================================================================ the styles */
// Each motif is one bar of 4/4: [t (beat in the bar), d, role, accent]. A 3/4 song keeps the first three beats.
// answers: endings for the bars that answer it, from beat `at` on. level: the least difficulty it needs (1 medium).
// Roles: R the chord's root (low on the neck for the low styles), R+ the root an octave above the last one, 3 5 7 the
// chord's (a 7 it lacks is the key's), 6 2 4 the key's degrees above the root (a blues' 6 is its major sixth), b3 the
// minor third (a blue third, never on a strong beat), up / dn a step along the style's scale from the note before,
// P5 / P6 the root with its fifth / sixth on the next string, B5 / B3 a bend up into the 5th / the 3rd (hard; else
// played straight), v0-v4 the notes of a chord shape low to high, top a step above the shape (an arpeggio's colour).
export const RIFF_STYLES = {
  rock: {
    label: 'Rock 8ths',
    blurb: 'driving eighths on the low strings: roots, fifths and the pentatonic',
    register: [40, 57],
    low: true,
    ladder: 'penta',
    open: 0.25,
    prefer: [0, 5],
    motifs: [
      {
        id: 'drive',
        name: 'driving roots',
        slots: [
          S(0, 0.45, 'R', 1),
          S(0.5, 0.45, 'R', 0.6),
          S(1, 0.45, 'R', 0.75),
          S(1.5, 0.45, 'R', 0.6),
          S(2, 0.45, '5', 0.9),
          S(2.5, 0.45, 'R', 0.6),
          S(3, 0.45, '7', 0.75),
          S(3.5, 0.45, '5', 0.65),
        ],
        answers: [
          { at: 3, name: 'a turn through the 6th', slots: [S(3, 0.45, '6', 0.75), S(3.5, 0.45, '5', 0.65)] },
          {
            at: 2,
            name: 'a climb to the octave',
            slots: [S(2, 0.45, 'R+', 0.9), S(2.5, 0.45, '7', 0.6), S(3, 0.45, '5', 0.75), S(3.5, 0.45, 'dn', 0.65)],
          },
        ],
      },
      {
        id: 'hook',
        name: 'a pentatonic hook',
        slots: [
          S(0, 0.45, 'R', 1),
          S(0.5, 0.45, 'up', 0.6),
          S(1, 0.45, 'up', 0.8),
          S(1.5, 0.45, 'R', 0.6),
          S(2, 0.9, '5', 0.9),
          S(3, 0.45, 'up', 0.7),
          S(3.5, 0.45, 'dn', 0.65),
        ],
        answers: [
          { at: 3, name: 'falling at the end', slots: [S(3, 0.45, 'dn', 0.7), S(3.5, 0.45, 'dn', 0.65)] },
          {
            at: 2,
            name: 'a climb to the octave',
            slots: [S(2, 0.95, 'R+', 0.9), S(3, 0.45, 'dn', 0.75), S(3.5, 0.45, 'dn', 0.65)],
          },
        ],
      },
      {
        id: 'stabs',
        name: 'power-chord stabs',
        slots: [
          S(0, 0.9, 'P5', 1),
          S(1, 0.45, 'R', 0.6),
          S(1.5, 0.45, 'R', 0.6),
          S(2, 0.45, 'P5', 0.95),
          S(2.5, 0.45, 'R', 0.6),
          S(3, 0.45, 'up', 0.7),
          S(3.5, 0.45, 'up', 0.7),
        ],
        answers: [{ at: 3, name: 'back down to the root', slots: [S(3, 0.45, 'dn', 0.7), S(3.5, 0.45, 'R', 0.7)] }],
      },
      {
        id: 'push',
        name: 'pushed eighths',
        level: 1,
        slots: [
          S(0, 0.7, 'R', 1),
          S(0.75, 0.25, 'R', 0.6),
          S(1, 0.45, '5', 0.75),
          S(1.5, 0.45, 'R', 0.6),
          S(2, 0.7, '5', 0.9),
          S(2.75, 0.25, 'up', 0.6),
          S(3, 0.45, 'up', 0.7),
          S(3.5, 0.45, 'R', 0.65),
        ],
        answers: [
          {
            at: 2,
            name: 'a climb to the octave',
            slots: [S(2, 0.7, 'R+', 0.9), S(2.75, 0.25, 'dn', 0.6), S(3, 0.45, 'dn', 0.7), S(3.5, 0.45, '5', 0.65)],
          },
        ],
      },
    ],
  },
  blues: {
    label: 'Blues shuffle',
    blurb: 'a shuffle: the boogie walk, a two-string shuffle, a call with a blue third',
    register: [40, 64],
    low: true,
    ladder: 'blues',
    shuffle: true,
    open: 0.1,
    prefer: [0, 5],
    motifs: [
      {
        id: 'boogie',
        name: 'the boogie walk',
        slots: [
          S(0, 0.62, 'R', 1),
          S(T23, 0.3, '3', 0.65),
          S(1, 0.62, '5', 0.85),
          S(1 + T23, 0.3, '6', 0.65),
          S(2, 0.62, '7', 0.9),
          S(2 + T23, 0.3, '6', 0.65),
          S(3, 0.62, '5', 0.8),
          S(3 + T23, 0.3, '3', 0.65),
        ],
        answers: [
          { at: 3, name: 'a blue third to end on', slots: [S(3, 0.62, '5', 0.8), S(3 + T23, 0.3, 'b3', 0.65)] },
          {
            at: 2,
            name: 'down from the octave',
            slots: [
              S(2, 0.62, 'R+', 0.9),
              S(2 + T23, 0.3, '7', 0.65),
              S(3, 0.62, '6', 0.8),
              S(3 + T23, 0.3, '5', 0.65),
            ],
          },
        ],
      },
      {
        id: 'shuffle',
        name: 'a two-string shuffle',
        needs: 'open',
        slots: [
          S(0, 0.62, 'P5', 1),
          S(T23, 0.3, 'P5', 0.6),
          S(1, 0.62, 'P6', 0.85),
          S(1 + T23, 0.3, 'P6', 0.6),
          S(2, 0.62, 'P5', 0.9),
          S(2 + T23, 0.3, 'P5', 0.6),
          S(3, 0.62, 'P6', 0.85),
          S(3 + T23, 0.3, 'P6', 0.6),
        ],
        answers: [
          { at: 3, name: 'a blue third at the end', slots: [S(3, 0.62, 'P5', 0.85), S(3 + T23, 0.3, 'b3', 0.6)] },
        ],
      },
      {
        id: 'call',
        name: 'a call with a blue third',
        slots: [
          S(0, 0.62, 'R', 1),
          S(T23, 0.3, 'b3', 0.7),
          S(1, 0.62, '3', 0.85),
          S(1 + T23, 0.3, '5', 0.65),
          S(2, 0.95, 'B5', 0.9),
          S(3, 0.62, '7', 0.75),
          S(3 + T23, 0.3, '5', 0.65),
        ],
        answers: [
          {
            at: 2,
            name: 'a climb to the octave',
            slots: [S(2, 0.62, 'R+', 0.9), S(2 + T23, 0.3, '7', 0.65), S(3, 0.95, '5', 0.8)],
          },
        ],
      },
    ],
  },
  funk: {
    label: 'Funk 16ths',
    blurb: 'tight sixteenths in the middle of the neck: octave pops, the seventh, a walk',
    register: [45, 69],
    ladder: 'penta',
    open: 0.6,
    prefer: [4, 9],
    motifs: [
      {
        id: 'pop',
        name: 'octave pops',
        level: 1,
        slots: [
          S(0, 0.2, 'R', 1),
          S(0.75, 0.2, 'R', 0.6),
          S(1, 0.2, 'R+', 0.85),
          S(1.5, 0.2, '7', 0.65),
          S(1.75, 0.2, 'R+', 0.6),
          S(2.5, 0.2, 'R', 0.75),
          S(3, 0.2, '5', 0.8),
          S(3.25, 0.2, '7', 0.6),
          S(3.5, 0.2, 'R+', 0.7),
        ],
        answers: [
          {
            at: 3,
            name: 'a run up to the octave',
            slots: [S(3, 0.2, '5', 0.8), S(3.25, 0.2, 'up', 0.6), S(3.5, 0.2, 'up', 0.65), S(3.75, 0.2, 'R+', 0.7)],
          },
        ],
      },
      {
        id: 'walk',
        name: 'a walk up from the root',
        level: 1,
        slots: [
          S(0, 0.2, 'R', 1),
          S(0.5, 0.15, 'R', 0.55),
          S(0.75, 0.2, '3', 0.7),
          S(1, 0.2, '4', 0.75),
          S(1.5, 0.2, '5', 0.7),
          S(2, 0.2, '7', 0.85),
          S(2.75, 0.2, '5', 0.6),
          S(3, 0.2, 'R+', 0.8),
          S(3.5, 0.2, '7', 0.65),
          S(3.75, 0.2, '5', 0.6),
        ],
        answers: [
          {
            at: 2,
            name: 'walking back down',
            slots: [S(2, 0.2, '5', 0.85), S(2.5, 0.2, '4', 0.6), S(2.75, 0.2, '3', 0.6), S(3, 0.45, 'R', 0.8)],
          },
        ],
      },
      {
        id: 'stab',
        name: 'stabs on the and',
        slots: [
          S(0, 0.2, 'R', 1),
          S(0.5, 0.2, '5', 0.7),
          S(1.5, 0.2, 'R+', 0.8),
          S(2, 0.2, 'R', 0.85),
          S(3, 0.2, '7', 0.75),
          S(3.5, 0.2, '5', 0.7),
        ],
        answers: [{ at: 3, name: 'up to the octave', slots: [S(3, 0.2, '5', 0.75), S(3.5, 0.2, 'R+', 0.75)] }],
      },
    ],
  },
  indie: {
    label: 'Indie arpeggio',
    blurb: 'a chord shape picked across the strings and let ring, the top note moving',
    register: [40, 76],
    arp: true,
    ladder: 'scale',
    open: -0.1,
    prefer: [0, 4],
    motifs: [
      {
        id: 'roll',
        name: 'a rolling arpeggio',
        slots: [
          S(0, 1, 'v0', 0.9),
          S(0.5, 1, 'v2', 0.65),
          S(1, 1, 'v3', 0.75),
          S(1.5, 1, 'v4', 0.65),
          S(2, 1, 'v1', 0.85),
          S(2.5, 1, 'v3', 0.65),
          S(3, 1, 'v4', 0.75),
          S(3.5, 1, 'v3', 0.65),
        ],
        answers: [{ at: 3, name: 'a step on top at the end', slots: [S(3, 1, 'top', 0.75), S(3.5, 1, 'v3', 0.65)] }],
      },
      {
        id: 'cross',
        name: 'cross-picking',
        slots: [
          S(0, 1, 'v0', 0.9),
          S(0.5, 1, 'v3', 0.65),
          S(1, 1, 'v2', 0.75),
          S(1.5, 1, 'v4', 0.65),
          S(2, 1, 'v0', 0.85),
          S(2.5, 1, 'v3', 0.65),
          S(3, 1, 'v2', 0.75),
          S(3.5, 1, 'v4', 0.65),
        ],
        answers: [
          {
            at: 2,
            name: 'the top note moving',
            slots: [S(2, 1, 'v1', 0.85), S(2.5, 1, 'v4', 0.65), S(3, 1, 'top', 0.75), S(3.5, 1, 'v4', 0.65)],
          },
        ],
      },
      {
        id: 'pulse',
        name: 'sixteenths up top',
        level: 1,
        slots: [
          S(0, 1, 'v0', 0.9),
          S(0.5, 0.5, 'v2', 0.6),
          S(0.75, 0.5, 'v3', 0.6),
          S(1, 1, 'v4', 0.75),
          S(1.5, 0.5, 'v3', 0.6),
          S(2, 1, 'v1', 0.85),
          S(2.5, 0.5, 'v3', 0.6),
          S(2.75, 0.5, 'v4', 0.6),
          S(3, 1, 'top', 0.75),
          S(3.5, 0.5, 'v4', 0.6),
        ],
        answers: [{ at: 3, name: 'back to the shape', slots: [S(3, 1, 'v4', 0.75), S(3.5, 0.5, 'v3', 0.6)] }],
      },
    ],
  },
  metal: {
    label: 'Metal chug',
    blurb: 'palm-muted chugs on the low string with power-chord accents',
    register: [38, 52],
    low: true,
    ladder: 'penta',
    chug: true,
    open: -0.2,
    prefer: [0, 3],
    motifs: [
      {
        id: 'chug',
        name: 'eighth-note chugs',
        slots: [
          S(0, 0.4, 'P5', 1),
          S(0.5, 0.2, 'R', 0.32),
          S(1, 0.2, 'R', 0.32),
          S(1.5, 0.2, 'R', 0.32),
          S(2, 0.4, 'P5', 0.95),
          S(2.5, 0.2, 'R', 0.32),
          S(3, 0.45, 'up', 0.85),
          S(3.5, 0.45, 'up', 0.85),
        ],
        answers: [{ at: 3, name: 'up and back', slots: [S(3, 0.45, 'up', 0.85), S(3.5, 0.45, 'dn', 0.85)] }],
      },
      {
        id: 'gallop',
        name: 'a gallop',
        level: 1,
        slots: [
          S(0, 0.2, 'P5', 1),
          S(0.5, 0.15, 'R', 0.32),
          S(0.75, 0.15, 'R', 0.32),
          S(1, 0.2, 'R', 0.5),
          S(1.5, 0.15, 'R', 0.32),
          S(1.75, 0.15, 'R', 0.32),
          S(2, 0.2, 'P5', 0.95),
          S(2.5, 0.15, 'R', 0.32),
          S(2.75, 0.15, 'R', 0.32),
          S(3, 0.2, 'up', 0.85),
          S(3.5, 0.2, 'up', 0.85),
        ],
        answers: [
          {
            at: 3,
            name: 'a turn on the low string',
            slots: [S(3, 0.2, 'dn', 0.85), S(3.25, 0.15, 'R', 0.32), S(3.5, 0.2, 'up', 0.85), S(3.75, 0.15, 'R', 0.32)],
          },
        ],
      },
      {
        id: 'burst',
        name: 'sixteenth bursts',
        level: 2,
        slots: [
          S(0, 0.2, 'R', 1),
          S(0.25, 0.15, 'R', 0.32),
          S(0.5, 0.15, 'R', 0.32),
          S(0.75, 0.2, 'up', 0.8),
          S(1, 0.2, 'R', 0.5),
          S(1.25, 0.15, 'R', 0.32),
          S(1.5, 0.2, 'up', 0.8),
          S(1.75, 0.15, 'R', 0.32),
          S(2, 0.2, 'P5', 0.95),
          S(2.5, 0.15, 'R', 0.32),
          S(2.75, 0.15, 'R', 0.32),
          S(3, 0.45, 'P5', 0.9),
        ],
        answers: [
          {
            at: 3,
            name: 'a run at the end',
            slots: [S(3, 0.2, 'up', 0.85), S(3.25, 0.2, 'up', 0.8), S(3.5, 0.2, 'dn', 0.8), S(3.75, 0.15, 'R', 0.32)],
          },
        ],
      },
    ],
  },
};
export const RIFF_STYLE_IDS = Object.keys(RIFF_STYLES);
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
// a jam style's riff style (core/jam.js JAM_STYLES), and words for them
const FROM_JAM = {
  blues: 'blues',
  funk: 'funk',
  neosoul: 'funk',
  indie: 'indie',
  ballad: 'indie',
  lofi: 'indie',
  bossa: 'indie',
  metal: 'metal',
  rock: 'rock',
  reggae: 'rock',
};
const WORDS = {
  shuffle: 'blues',
  boogie: 'blues',
  '12 bar': 'blues',
  funky: 'funk',
  '16ths': 'funk',
  sixteenths: 'funk',
  arpeggio: 'indie',
  arpeggios: 'indie',
  picked: 'indie',
  jangle: 'indie',
  chug: 'metal',
  chugs: 'metal',
  djent: 'metal',
  heavy: 'metal',
  '8ths': 'rock',
  eighths: 'rock',
  'hard rock': 'rock',
  'classic rock': 'rock',
  punk: 'rock',
};
export function findRiffStyle(word) {
  const k = String(word || '')
    .trim()
    .toLowerCase();
  if (!k) return null;
  if (RIFF_STYLES[k]) return k;
  if (WORDS[k]) return WORDS[k];
  const j = findJamStyle(k);
  if (j && FROM_JAM[j]) return FROM_JAM[j];
  for (const id of RIFF_STYLE_IDS) if (k.includes(id)) return id;
  for (const [w, id] of Object.entries(WORDS)) if (k.includes(w)) return id;
  return null;
}
export function riffStyleFor(p) {
  const j = p?.meta?.jam?.style;
  if (j && FROM_JAM[j]) return FROM_JAM[j];
  if (p?.key && /blues/i.test(p.key.scale || '')) return 'blues';
  return 'rock';
}

/* ================================================================================================ where */
// The stretch a riff is for: a section (its name or id), bars [first, last] (1-based), or the section the playhead is
// in (else the four bars around it).
export function riffSpan(p, tl, { section = null, bars = null, at = null } = {}) {
  const bpb = beatsPerBar(p.meter || [4, 4]);
  const secs = p.sections || [];
  if (section != null && section !== '') {
    const s =
      secs.find((x) => x.id === section) ||
      secs.find((x) => String(x.name).toLowerCase() === String(section).trim().toLowerCase());
    if (!s)
      return {
        error: `no section "${String(section).slice(0, 60)}"`,
        hint: secs.length
          ? `sections: ${secs.map((x) => x.name).join(', ')}; or give bars [first, last]`
          : 'this song has no sections: give bars [first, last]',
      };
    return {
      start: s.start,
      end: s.start + s.length,
      bars: [
        Math.floor(s.start / bpb + EPS) + 1,
        Math.max(Math.floor(s.start / bpb + EPS) + 1, Math.ceil((s.start + s.length) / bpb - EPS)),
      ],
      name: s.name,
      section: s.id,
    };
  }
  if (Array.isArray(bars) && bars.length) {
    const a = Math.round(Number(bars[0])),
      b = Math.round(Number(bars[bars.length - 1]));
    if (!(a >= 1) || !(b >= a))
      return {
        error: `bars must be [first, last], 1-based (got ${JSON.stringify(bars).slice(0, 40)})`,
        hint: 'e.g. [9, 12] for bars 9 to 12',
      };
    const sec = secs.find((x) => (a - 1) * bpb >= x.start - EPS && (a - 1) * bpb < x.start + x.length - EPS) || null;
    return {
      start: (a - 1) * bpb,
      end: b * bpb,
      bars: [a, b],
      name: sec && Math.abs(sec.start - (a - 1) * bpb) < EPS ? sec.name : null,
      section: sec ? sec.id : null,
    };
  }
  const beat = Math.max(0, Number(at) || 0);
  const s = secs.find((x) => beat >= x.start - EPS && beat < x.start + x.length - EPS);
  if (s) return riffSpan(p, tl, { section: s.id });
  const k = Math.floor(Math.floor(beat / bpb + EPS) / 4) * 4;
  return { start: k * bpb, end: (k + 4) * bpb, bars: [k + 1, k + 4], name: null, section: null };
}
// The chords under each beat of [start, end): [{ t (beat from start), chord }]; a stretch with none takes the key's own
// chord (honestly: the text says so).
function harmonyOf(tl, key, start, end) {
  const out = [];
  let any = false;
  for (let b = 0; b < end - start - EPS; b += 0.5) {
    const c = chordAt(tl, start + b + 0.01).chord;
    if (c) any = true;
    out.push({ t: b, chord: c });
  }
  if (!any) {
    if (!key) return null;
    const root = parsePc(key.root),
      minor = isMinorKey(key);
    const q = minor ? 'm' : '';
    const pcs = QUALITIES[q].iv.map((i) => (root + i) % 12);
    const tonic = {
      root,
      quality: q,
      pcs,
      bass: root,
      name: spellPc(root, key) + q,
      tones: QUALITIES[q].iv.map((iv) => ({ pc: (root + iv) % 12, iv })),
      tonic: true,
    };
    return out.map((x) => ({ ...x, chord: tonic }));
  }
  // a beat with no chord (a rest in the band) takes the one before it, else the one after
  for (let i = 0; i < out.length; i++)
    if (!out[i].chord)
      out[i].chord =
        out
          .slice(0, i)
          .reverse()
          .find((x) => x.chord)?.chord || out.slice(i).find((x) => x.chord)?.chord;
  return out;
}
// How many bars the riff covers: the section's harmonic cycle (the chords bar by bar repeat every 1, 2 or 4 bars), at
// least 2 and at most 4 (or the section's length).
function cycleOf(harm, bpb, nBars) {
  const barSig = (k) =>
    harm
      .filter((x) => x.t >= k * bpb - EPS && x.t < (k + 1) * bpb - EPS)
      .map((x) => x.chord?.name)
      .join(',');
  const sigs = Array.from({ length: nBars }, (_, k) => barSig(k));
  for (const P of [1, 2, 4])
    if (P <= nBars && sigs.every((s, k) => s === sigs[k % P])) return Math.min(nBars, Math.max(2, P));
  return Math.min(nBars, 4);
}

/* ================================================================================================ notes that fit */
const ivOf = (ch) => (QUALITIES[ch.quality] || QUALITIES['']).iv.map((i) => i % 12);
// a degree above the chord's root that the key has: the first of the choices in the key's scale, else the first
function diatonic(ch, keyPcs, ...choices) {
  for (const c of choices) if (keyPcs.has((ch.root + c) % 12)) return c;
  return choices[0];
}
// Does pitch class pc fit over this chord in this key: a tone of the chord, in the key's scale, or (a blues key) the
// sweet side: the key's 2nd, 3rd or 6th where the chord's own major pentatonic has it (as the room's neck says).
export function fitsOver(pc, key, ch) {
  if (ch && ch.pcs.includes(pc)) return true;
  if (!key) return true;
  if (scalePcs(key).includes(pc)) return true;
  if (/blues/i.test(key.scale)) {
    const root = parsePc(key.root);
    return [2, 4, 9].includes((pc - root + 12) % 12) && (!ch || [0, 2, 4, 7, 9].includes((pc - ch.root + 12) % 12));
  }
  return false;
}
// The pitch classes a role wants over a chord.
function rolePcs(role, ch, key, keyPcs, style) {
  const iv = ivOf(ch),
    has = (x) => iv.includes(x);
  const third = has(4) ? 4 : has(3) ? 3 : diatonic(ch, keyPcs, 4, 3);
  const fifth = has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : 7;
  const seventh = has(10) ? 10 : has(11) ? 11 : diatonic(ch, keyPcs, 10, 11);
  const at = (x) => [(ch.root + x) % 12];
  switch (role) {
    case 'R':
    case 'R+':
      return at(0);
    case '3':
      return at(third);
    case 'b3':
      return at(3);
    case '5':
      return at(fifth);
    case '7':
      return at(seventh);
    case '6':
      return at(style.ladder === 'blues' && fitsOver((ch.root + 9) % 12, key, ch) ? 9 : diatonic(ch, keyPcs, 9, 8));
    case '2':
      return at(diatonic(ch, keyPcs, 2, 1));
    case '4':
      return at(diatonic(ch, keyPcs, 5, 6));
    default:
      return null;
  }
}

/* ================================================================================================ the hand */
// The places one hand at `pos` reaches: frets pos..pos+3 (pos 0: the open position, frets 1-4), and the open strings
// when the hand is low (or the style chugs on them). Pitches in a virtual tuning with the capo as its nut.
function paletteAt(pos, Tc, top, style) {
  const lo = Math.max(1, pos),
    hi = Math.min(top, lo + 3);
  const openOk = pos <= 5 || style.chug;
  const out = [];
  Tc.strings.forEach((open, s) => {
    if (openOk) out.push({ s, f: 0, p: open });
    for (let f = lo; f <= hi; f++) out.push({ s, f, p: open + f });
  });
  return { pos, lo, hi, openOk, places: out, pitches: [...new Set(out.map((x) => x.p))].sort((a, b) => a - b) };
}
// How well a position serves the riff: each chord's root where the style wants it (low on the neck for the low
// styles) and its tones, the style's favourite part of the neck, and (easy) the low frets.
function positionScore(pal, chords, style, lvl) {
  const [rlo, rhi] = style.register;
  let s = 0;
  for (const ch of chords) {
    const inReg = pal.pitches.filter((p) => p >= rlo && p <= rhi + 12);
    const root = inReg.filter((p) => pcOf(p) === ch.root);
    const lowRoot = root.some((p) => p <= rlo + 12);
    s += root.length ? (style.low && !lowRoot ? 1.5 : 3) : 0;
    const iv = ivOf(ch);
    const third = iv.find((x) => x === 3 || x === 4),
      fifth = iv.find((x) => x === 6 || x === 7 || x === 8);
    if (third != null && inReg.some((p) => pcOf(p) === (ch.root + third) % 12)) s += 1.5;
    if (fifth != null && inReg.some((p) => pcOf(p) === (ch.root + fifth) % 12)) s += 1;
    if (iv.length > 3 && inReg.some((p) => pcOf(p) === (ch.root + iv[3]) % 12)) s += 0.3;
  }
  s /= Math.max(1, chords.length);
  const [a, b] = style.prefer;
  s -= (pal.pos < a ? a - pal.pos : pal.pos > b ? pal.pos - b : 0) * 0.35;
  if (lvl === 0) s -= pal.pos * 0.12;
  return s;
}

// a power chord's shape for each chord's root under the hand (root and fifth on neighbouring strings)
function powerScore(pal, chords, Tc) {
  let k = 0;
  for (const ch of chords)
    if (
      pal.places.some(
        (x) =>
          pcOf(x.p) === ch.root &&
          x.s + 1 < Tc.strings.length &&
          pal.places.some((y) => y.s === x.s + 1 && y.p === x.p + 7),
      )
    )
      k++;
  return (k / Math.max(1, chords.length)) * 1.5;
}

/* ================================================================================================ writing */
export function writeRiff(p, opts = {}) {
  const tl = opts.timeline;
  if (!tl) return { error: 'no chord timeline', hint: 'pass timeline: chordTimeline(project)' };
  const meter = p.meter || [4, 4],
    bpb = beatsPerBar(meter);
  if (!(meter[1] === 4 && (meter[0] === 4 || meter[0] === 3 || meter[0] === 2)))
    return {
      error: `riffs are written in 4/4, 3/4 or 2/4 for now (this song is in ${meter.join('/')})`,
      hint: 'a song in 4/4',
    };
  const styleId = opts.style ? findRiffStyle(opts.style) : riffStyleFor(p);
  if (!styleId)
    return {
      error: `no riff style "${String(opts.style).slice(0, 40)}"`,
      hint: `styles: ${RIFF_STYLE_IDS.join(', ')}`,
    };
  const style = RIFF_STYLES[styleId];
  const lvl = opts.difficulty == null ? 1 : DIFFICULTIES.indexOf(String(opts.difficulty).toLowerCase());
  if (lvl < 0)
    return { error: `no difficulty "${String(opts.difficulty).slice(0, 20)}"`, hint: `${DIFFICULTIES.join(', ')}` };
  const span = opts.span || riffSpan(p, tl, opts);
  if (span.error) return span;
  const key = tl.key || (p.key && p.key.root ? p.key : null);
  const T = tuningOf(opts.tuning || 'standard'),
    capo = capoOf(opts.capo);
  const Tc = { id: T.id, name: T.name, notes: T.notes, strings: T.strings.map((x) => x + capo) };
  const top = MAX_FRET - capo;
  const spanBars = Math.max(1, Math.round((span.end - span.start) / bpb));
  const harmAll = harmonyOf(tl, key, span.start, span.end);
  if (!harmAll)
    return {
      error: `no chords in ${span.name ? `the ${span.name}` : `bars ${span.bars[0]}-${span.bars[1]}`}, and the song has no key to play over`,
      hint: 'a song with parts that have notes (the chords are read from them), or a jam track',
    };
  const n = opts.length
    ? Math.max(1, Math.min(4, Math.round(Number(opts.length)), spanBars))
    : cycleOf(harmAll, bpb, spanBars);
  const length = n * bpb;
  const harm = harmAll.filter((x) => x.t < length - EPS);
  const keyPcs = new Set(key ? scalePcs(key) : scalePcs(null));
  const chordAtT = (t) => {
    let c = harm[0].chord;
    for (const x of harm) if (x.t <= t + EPS) c = x.chord;
    return c;
  };
  const chords = [];
  for (const x of harm) if (!chords.some((c) => c.name === x.chord.name)) chords.push(x.chord);
  const seed = Number.isFinite(+opts.seed) ? Math.round(+opts.seed) : 1;
  const R = rng(`${seed}:riff:${styleId}:${lvl}:${harm.map((x) => x.chord.name).join(',')}:${T.id}:${capo}`);
  // the motif: one the difficulty allows (and the hand can play: a two-string shuffle wants open roots)
  let motifs = style.motifs.filter((m) => (m.level || 0) <= lvl);
  if (!motifs.length) motifs = style.motifs.slice(0, 1);
  // the position: every one scored, a seeded pick among the best
  const pals = [];
  for (let pos = 0; pos <= Math.min(12, top - 3); pos++) if (pos !== 1) pals.push(paletteAt(pos, Tc, top, style));
  // (the motif first: a power chord wants its shape under the hand)
  let motifPick = opts.motif ? motifs.find((m) => m.id === opts.motif) : null;
  if (!motifPick) motifPick = motifs[Math.floor(R() * motifs.length)];
  const powered = motifPick.slots.some((x) => x[2] === 'P5' || x[2] === 'P6');
  const scored = pals
    .map((pal) => ({ pal, s: positionScore(pal, chords, style, lvl) + (powered ? powerScore(pal, chords, Tc) : 0) }))
    .sort((a, b) => b.s - a.s || a.pal.pos - b.pal.pos);
  const near = scored.filter((x) => x.s >= scored[0].s - 0.45).slice(0, 3);
  const order = [];
  const startPos = Math.floor(R() * near.length);
  for (let i = 0; i < near.length; i++) order.push(near[(startPos + i) % near.length].pal);
  for (const x of scored) if (!order.includes(x.pal)) order.push(x.pal);
  const answerOrder = R() < 0.5 ? 0 : 1;
  let best = null;
  for (const pal of order.slice(0, 8)) {
    const motif =
      motifPick.needs === 'open' && !chords.every((c) => pal.places.some((x) => x.f === 0 && pcOf(x.p) === c.root))
        ? motifs.find((m) => m.needs !== 'open') || motifPick
        : motifPick;
    const r = realize({
      style,
      styleId,
      lvl,
      motif,
      pal,
      harm,
      chordAtT,
      key,
      keyPcs,
      n,
      bpb,
      length,
      Tc,
      top,
      R: rng(`${seed}:${pal.pos}:${motif.id}`),
      answerOrder,
    });
    if (!r) continue;
    const fg = fingering(r.notes, Tc, {
      span: 4,
      near: pal.lo,
      open: style.open,
      allow: (s, f) => (f === 0 ? pal.openOk : f >= pal.lo && f <= pal.hi),
      to: top,
    });
    if (fg.error) continue;
    const placed = fg.notes.map(({ fixed, ...x }) => ({ ...x, f: x.f + capo, p: x.p }));
    const cand = { r, fg, placed, pal, motif };
    if (fg.shifts === 0 && handSpan(placed.map((x) => ({ f: x.f - capo }))) <= 4) {
      best = cand;
      break;
    }
    if (!best) best = cand;
  }
  if (!best)
    return {
      error: `couldn't fit a ${style.label.toLowerCase()} riff for ${chords.map((c) => c.name).join(', ')} under one hand in ${T.name} tuning`,
      hint: 'another style, another tuning, or take the capo off',
    };
  const { r, fg, pal, motif } = best;
  const notes = best.placed
    .map((x) => ({
      p: x.p,
      t: r4(x.t),
      d: r4(x.d),
      v: r4(x.v),
      s: x.s,
      f: x.f,
      finger: x.finger,
      ...(x.bend ? { bend: x.bend } : {}),
    }))
    .sort((a, b) => a.t - b.t || a.p - b.p);
  const under = [];
  for (const x of harm)
    if (!under.length || under[under.length - 1].name !== x.chord.name)
      under.push({ t: x.t, name: x.chord.name, root: x.chord.root, pcs: x.chord.pcs.slice() });
  const riff = {
    notes,
    under,
    start: span.start,
    bars: n,
    span: [span.bars[0], span.bars[0] + n - 1],
    section: span.name || null,
    sectionId: span.section || null,
    chords: uniqRun(harm.map((x) => x.chord.name)),
    chordsTonic: !!harm[0].chord.tonic,
    key,
    style: styleId,
    difficulty: DIFFICULTIES[lvl],
    seed,
    motif: motif.id,
    position: pal.pos === 0 ? 0 : pal.lo + capo,
    tuning: T.id,
    capo,
    meter,
  };
  riff.checks = riffChecks(riff, tl, { key, tuning: T, capo, meter });
  riff.checks.shifts = fg.shifts;
  riff.label = labelOf(riff, motif, r.answers);
  riff.text = textOf(riff, motif, r.answers, style, bpb);
  const L = tabLayout(notes, { tuning: T, capo, meter, bars: n });
  riff.step = L.step;
  riff.tab = formatTab(notes, { tuning: T, capo, meter, bars: n, count: true });
  return riff;
}
const uniqRun = (xs) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

// The motif, bar by bar, its roles turned into pitches from the palette.
function realize({ style, styleId, lvl, motif, pal, harm, chordAtT, key, keyPcs, n, bpb, length, Tc, R, answerOrder }) {
  const answers = [];
  const variant = (k) =>
    n === 1 ? null : n === 2 ? (k === 1 ? 0 : null) : n === 3 ? (k === 2 ? 0 : null) : k === 1 ? 0 : k === 3 ? 1 : null;
  const ans = (i) => {
    const list = motif.answers || [];
    if (!list.length) return null;
    return list[(i + answerOrder) % list.length];
  };
  const slotsOf = (k) => {
    const v = variant(k),
      a = v == null ? null : ans(v);
    let slots = motif.slots;
    if (a) {
      slots = [...slots.filter((x) => x[0] < a.at - EPS), ...a.slots];
      if (!answers.some((x) => x.bar === k)) answers.push({ bar: k, name: a.name });
    }
    return slots.filter((x) => x[0] < bpb - EPS);
  };
  // the slots of the whole riff, with the difficulty's changes
  let slots = [];
  for (let k = 0; k < n; k++)
    for (const [t, d, role, acc] of slotsOf(k)) slots.push({ t: r4(k * bpb + t), d, role, acc, bar: k });
  if (lvl === 0) {
    // easy: eighths (and a shuffle's offbeats), single notes, no bends, at most six notes a bar
    slots = slots.filter((x) =>
      style.shuffle
        ? Math.abs((x.t % 1) - T23) < 1e-3 || Math.abs(x.t % 1) < 1e-3
        : Math.abs(x.t * 2 - Math.round(x.t * 2)) < 1e-6,
    );
    for (const x of slots) {
      if (x.role === 'P5' || x.role === 'P6') x.role = 'R';
      if (x.role === 'B5') x.role = '5';
      if (x.role === 'B3') x.role = '3';
      if (x.role === 'b3') x.role = '3';
    }
    const keep = [];
    for (let k = 0; k < n; k++) {
      const bar = slots.filter((x) => x.bar === k);
      const ranked = bar
        .slice()
        .sort((a, b) => b.acc - a.acc || a.t - b.t)
        .slice(0, 6);
      keep.push(...bar.filter((x) => ranked.includes(x)));
    }
    slots = keep;
  } else if (lvl === 1) {
    for (const x of slots) {
      if (x.role === 'B5') x.role = '5';
      if (x.role === 'B3') x.role = '3';
    }
  } else {
    // hard: a bend into the 5th on beat 3 of an answering bar (a blues or rock riff's cry), and a sixteenth leading into
    // a strong note across a gap (one or two a bar, seeded)
    if (style.ladder === 'blues' || styleId === 'rock') {
      for (let k = 1; k < n; k += 2) {
        const x = slots.find((y) => y.bar === k && Math.abs(y.t - (k * bpb + 2)) < 1e-6 && y.role === '5');
        if (x) x.role = 'B5';
      }
    }
    const add = [];
    for (let k = 0; k < n; k++) {
      const bar = slots.filter((x) => x.bar === k);
      let room = 1 + (R() < 0.5 ? 1 : 0);
      for (let i = 1; i < bar.length && room > 0; i++) {
        const a = bar[i - 1],
          b = bar[i];
        const lead = style.shuffle ? 1 / 3 : 0.25;
        if (b.t - a.t >= 0.75 - EPS && !/^P|^v/.test(b.role) && R() < 0.7) {
          add.push({ t: r4(b.t - lead), d: lead * 0.8, role: 'apr', acc: 0.6, bar: k });
          a.d = Math.min(a.d, b.t - lead - a.t);
          room--;
        }
      }
    }
    slots = [...slots, ...add].sort((a, b) => a.t - b.t);
  }
  if (!slots.length) return null;
  // the ladder of steps for up / dn / apr: the style's scale over the key, kept to what fits each chord
  const pent = key ? pentatonicFor(key).pcs : [9, 0, 2, 4, 7];
  const blues = key ? scalePcs({ root: key.root, scale: 'blues' }) : pent;
  const ladderPcs =
    style.ladder === 'scale' || lvl === 2
      ? [...new Set([...pent, ...keyPcs])]
      : style.ladder === 'blues'
        ? blues
        : pent;
  const [rlo, rhi] = style.register;
  const P = pal.pitches;
  const fits = (q, ch) => fitsOver(pcOf(q), key, ch);
  const out = [];
  let prev = null,
    lastRoot = null;
  const nearest = (cands, ref) =>
    cands.length
      ? cands.reduce((a, b) =>
          Math.abs(b - ref) < Math.abs(a - ref) - EPS ||
          (Math.abs(Math.abs(b - ref) - Math.abs(a - ref)) < EPS && b < a)
            ? b
            : a,
        )
      : null;
  const lowRoot = (ch) => {
    const c = P.filter((q) => pcOf(q) === ch.root);
    const reg = c.filter((q) => q >= rlo - 2 && q <= rhi);
    return style.low ? (reg[0] ?? c[0] ?? null) : nearest(reg.length ? reg : c, prev ?? (rlo + rhi) / 2);
  };
  const ladder = (ch) => P.filter((q) => ladderPcs.includes(pcOf(q)) && fits(q, ch));
  // a power chord's shape: the root on a string and the interval above it on the next one, both under the hand
  const shapeAt = (root, iv) => {
    for (const x of pal.places) {
      if (x.p !== root || x.s + 1 >= Tc.strings.length) continue;
      const y = pal.places.find((z) => z.s === x.s + 1 && z.p === root + iv);
      if (y)
        return [
          { s: x.s, f: x.f },
          { s: y.s, f: y.f },
        ];
    }
    return null;
  };
  // a chord shape for the arpeggio: the root low (strings 0-2), then a chord tone a string, open ones welcome
  const shapes = new Map();
  const shapeOf = (ch) => {
    if (shapes.has(ch.name)) return shapes.get(ch.name);
    const places = pal.places;
    const rootPl =
      places.filter((x) => x.s <= 2 && pcOf(x.p) === ch.root).sort((a, b) => a.p - b.p)[0] ||
      places.filter((x) => pcOf(x.p) === ch.root).sort((a, b) => a.p - b.p)[0];
    const v = [];
    if (rootPl) v.push(rootPl.p);
    for (let s = rootPl ? rootPl.s + 1 : 0; s < Tc.strings.length && v.length < 5; s++) {
      const opts = places
        .filter(
          (x) => x.s === s && ch.pcs.includes(pcOf(x.p)) && !v.includes(x.p) && (!v.length || x.p > v[v.length - 1]),
        )
        .sort((a, b) => a.f - b.f);
      if (opts.length) v.push(opts[0].p);
    }
    shapes.set(ch.name, v);
    return v;
  };
  for (let i = 0; i < slots.length; i++) {
    const sl = slots[i];
    const ch = chordAtT(sl.t);
    let ps = null,
      bend = null,
      fx = null;
    const pickRole = (role) => {
      const want = rolePcs(role, ch, key, keyPcs, style);
      if (role === 'R') {
        const q = lowRoot(ch);
        return q == null ? null : [q];
      }
      if (role === 'R+') {
        const base = lastRoot ?? lowRoot(ch) ?? prev;
        const c = P.filter((q) => pcOf(q) === ch.root && q > (base ?? 0));
        const q = nearest(c, (base ?? 48) + 12);
        return q == null ? null : [q];
      }
      if (want) {
        const c = P.filter((q) => want.includes(pcOf(q)) && fits(q, ch));
        if (!c.length) return null;
        // the nearest to the note before (a riff moves by small steps), a little dearer under the last root (it
        // climbs from its root), the higher of two as near
        const ref = prev ?? lastRoot ?? (rlo + rhi) / 2;
        const cost = (q) =>
          Math.abs(q - ref) +
          (lastRoot != null && q < lastRoot - 0.5 ? 2.5 : 0) +
          (q < rlo - 2 || q > rhi + 12 ? 4 : 0);
        return [c.reduce((a, b) => (cost(b) < cost(a) - EPS || (Math.abs(cost(b) - cost(a)) < EPS && b > a) ? b : a))];
      }
      return null;
    };
    switch (sl.role) {
      case 'up':
      case 'dn': {
        const L = ladder(ch),
          ref = prev ?? lowRoot(ch);
        if (ref == null) break;
        const upq = L.filter((q) => q > ref),
          dnq = L.filter((q) => q < ref);
        const q = sl.role === 'up' ? (upq[0] ?? dnq[dnq.length - 1]) : (dnq[dnq.length - 1] ?? upq[0]);
        if (q != null) ps = [q];
        break;
      }
      case 'apr':
        ps = ['apr'];
        break; // (filled once the note after it is known)
      case 'P5':
      case 'P6': {
        const root = lowRoot(ch);
        if (root == null) break;
        const six = sl.role === 'P6' && fits(root + 9, ch) ? shapeAt(root, 9) : null,
          five = fits(root + 7, ch) ? shapeAt(root, 7) : null;
        ps = six ? [root, root + 9] : five ? [root, root + 7] : [root];
        fx = six || five || null; // (the shape stays as found: a fingering would happily grip it some other way)
        break;
      }
      case 'B5':
      case 'B3': {
        // a bend up into the 5th (a whole step) or the 3rd (a half step, over a chord with a major one): from the note
        // under it, on the G, B or high e where one is under the hand (where guitarists bend), pinned there
        const step = sl.role === 'B5' ? 2 : 1;
        const want = rolePcs(sl.role === 'B5' ? '5' : '3', ch, key, keyPcs, style);
        const ok = sl.role === 'B5' || ivOf(ch).includes(4);
        const from = ok
          ? pal.places.filter(
              (x) =>
                x.f > 0 &&
                x.s >= Math.min(2, Tc.strings.length - 1) &&
                want.includes(pcOf(x.p + step)) &&
                fits(x.p, ch) &&
                fits(x.p + step, ch),
            )
          : [];
        if (from.length) {
          const ref = prev ?? (rlo + rhi) / 2;
          const best = from.reduce((a, b) => (Math.abs(b.p + step - ref) < Math.abs(a.p + step - ref) ? b : a));
          ps = [best.p];
          bend = step;
          fx = [{ s: best.s, f: best.f }];
        } else ps = pickRole(sl.role === 'B5' ? '5' : '3');
        break;
      }
      case 'v0':
      case 'v1':
      case 'v2':
      case 'v3':
      case 'v4': {
        const v = shapeOf(ch);
        if (v.length) ps = [v[Math.min(v.length - 1, Number(sl.role[1]))]];
        break;
      }
      case 'top': {
        const v = shapeOf(ch);
        if (!v.length) break;
        const hi = v[v.length - 1];
        const q = ladder(ch).find((x) => x > hi && x <= hi + 3);
        ps = [q ?? hi];
        break;
      }
      default:
        ps = pickRole(sl.role);
    }
    if (!ps || !ps.length) continue;
    out.push({ t: sl.t, d: sl.d, v: sl.acc, ps, bend, fx, role: sl.role, bar: sl.bar });
    if (ps[0] !== 'apr') {
      prev = ps[0];
      if (sl.role === 'R' || sl.role === 'R+' || sl.role === 'P5' || sl.role === 'P6' || sl.role === 'v0')
        lastRoot = ps[0];
    }
  }
  // approach notes: a step of the ladder next to the note after, on the side of the note before
  for (let i = 0; i < out.length; i++) {
    if (out[i].ps[0] !== 'apr') continue;
    const nx = out.slice(i + 1).find((x) => x.ps[0] !== 'apr'),
      pv = out
        .slice(0, i)
        .reverse()
        .find((x) => x.ps[0] !== 'apr');
    const ch = chordAtT(out[i].t);
    if (!nx) {
      out.splice(i--, 1);
      continue;
    }
    const tgt = nx.ps[0],
      from = pv ? pv.ps[0] : tgt - 2;
    const L = ladder(ch).filter((q) => q !== tgt && q !== from);
    const q = from < tgt ? L.filter((x) => x < tgt).pop() : L.find((x) => x > tgt);
    if (q == null || Math.abs(q - tgt) > 3) {
      out.splice(i--, 1);
      continue;
    }
    out[i].ps = [q];
  }
  // the rules: a strong beat lands on a tone of its chord, and everything fits
  const strong = bpb === 4 ? [0, 2] : [0];
  for (const x of out) {
    const ch = chordAtT(x.t),
      inBar = x.t - Math.floor(x.t / bpb + EPS) * bpb;
    const isStrong = strong.some((b) => Math.abs(inBar - b) < 1e-4);
    x.ps = x.ps
      .map((q, j) => {
        const land = q + (j === 0 && x.bend ? x.bend : 0);
        const ok = fits(land, ch) && (!isStrong || ch.pcs.includes(pcOf(land)));
        if (ok) return q;
        if (j === 0) x.bend = null;
        const c = P.filter((y) => (isStrong ? ch.pcs.includes(pcOf(y)) : fits(y, ch)));
        return nearest(c, q);
      })
      .filter((q) => q != null);
    const was = x.ps.length;
    x.ps = [...new Set(x.ps)];
    if (
      x.fx &&
      (x.ps.length !== was ||
        x.ps.length !== x.fx.length ||
        x.ps.some((q, j) => Tc.strings[x.fx[j].s] + x.fx[j].f !== q))
    )
      x.fx = null;
  }
  // lengths: no further than the riff's end; an arpeggio's notes ring to the next pick of the same note (two beats at
  // most); a note an approach leads into isn't cut short
  for (const x of out) {
    if (style.arp) {
      const same = out.find((y) => y.t > x.t + EPS && y.ps.includes(x.ps[0]));
      x.d = Math.min(2, (same ? same.t : x.t + 2) - x.t);
    }
    x.d = Math.max(0.12, Math.min(x.d, length - x.t));
  }
  const notes = [];
  for (const x of out) {
    if (!x.ps.length) continue;
    x.ps.forEach((q, j) =>
      notes.push({
        p: q,
        t: x.t,
        d: x.d,
        v: j ? Math.max(0.3, x.v - 0.1) : x.v,
        ...(j === 0 && x.bend
          ? {
              bend: [
                [0, 0],
                [r4(Math.min(0.25, x.d / 2)), x.bend],
              ],
            }
          : {}),
        ...(x.fx ? { fixed: x.fx[j] } : {}),
      }),
    );
  }
  return notes.length ? { notes, answers } : null;
}

/* ================================================================================================ checks and words */
// What the riff says about itself, checked against the song: every note in the key (or a tone of its chord, or a
// blues' sweet side), every strong beat on a chord tone (where a bend lands), every place playing its pitch, one hand.
export function riffChecks(riff, tl, { key = null, tuning = 'standard', capo = 0, meter = [4, 4] } = {}) {
  const bpb = beatsPerBar(meter),
    strong = bpb === 4 ? [0, 2] : [0];
  const k = key || tl?.key || null;
  const outside = [],
    offStrong = [],
    unplayable = [];
  for (const n of riff.notes) {
    const ch = chordUnder(riff, tl, n.t);
    const land = Math.round(n.p) + (n.bend ? bendTop(n.bend) : 0);
    if (!fitsOver(pcOf(n.p), k, ch) || !fitsOver(pcOf(land), k, ch)) outside.push(n);
    const inBar = n.t - Math.floor(n.t / bpb + EPS) * bpb;
    if (strong.some((b) => Math.abs(inBar - b) < 1e-4) && ch && !ch.pcs.includes(pcOf(land))) offStrong.push(n);
    if (!placeOk(n, tuning, capo)) unplayable.push(n);
  }
  const span = handSpan(riff.notes.map((n) => ({ f: n.f - capoOf(capo) })));
  return {
    inKey: !outside.length,
    outside,
    strong: !offStrong.length,
    offStrong,
    playable: !unplayable.length,
    unplayable,
    span,
    oneHand: span <= 4,
  };
}
// the chord under a note: the one the riff was written over (riff.under), else the timeline's
function chordUnder(riff, tl, t) {
  if (Array.isArray(riff.under) && riff.under.length) {
    let c = riff.under[0];
    for (const x of riff.under) if (x.t <= t + EPS) c = x;
    return c;
  }
  return chordAt(tl, riff.start + t + 0.01).chord;
}
const bendTop = (b) =>
  typeof b === 'number' ? b : Array.isArray(b) ? b.reduce((m, x) => (Math.abs(x[1]) > Math.abs(m) ? x[1] : m), 0) : 0;

function labelOf(riff, motif, answers) {
  const a = answers[0];
  const s = `${motif.name}${a && riff.bars > 1 ? `, ${a.name}` : ''}`;
  return s.length > 48 ? s.slice(0, 47) + '…' : s;
}
function textOf(riff, motif, answers, style, bpb) {
  const [a, b] = riff.span;
  const where = riff.section
    ? `${/\d$/.test(riff.section) ? '' : 'the '}${riff.section}, ${b > a ? `bars ${a}–${b}` : `bar ${a}`}`
    : b > a
      ? `bars ${a}–${b}`
      : `bar ${a}`;
  const chords = riff.chordsTonic
    ? `${riff.chords[0]}, the key's own chord: no chords are read there`
    : riff.chords.join(', ');
  const pos =
    riff.position === 0
      ? riff.capo
        ? `in the open position at the capo`
        : 'in the open position'
      : `at the ${ORD(riff.position)} fret`;
  let shape;
  if (riff.bars === 1) shape = `${motif.name}, one bar that loops`;
  else if (riff.bars === 2)
    shape = `${motif.name} in bar ${a}, answered in bar ${a + 1} with ${answers[0] ? answers[0].name : 'the same'}`;
  else if (riff.bars === 3)
    shape = `${motif.name} twice, then ${answers[0] ? answers[0].name : 'once more'} in bar ${a + 2}`;
  else if (answers.length === 2 && answers[0].name === answers[1].name)
    shape = `${motif.name} over each bar, with ${answers[0].name} in bars ${a + answers[0].bar} and ${a + answers[1].bar}`;
  else
    shape = `${motif.name} over each bar${answers.length ? `, with ${answers.map((x) => `${x.name} in bar ${a + x.bar}`).join(' and ')}` : ''}`;
  const ck = riff.checks;
  const beats = bpb === 4 ? 'beats 1 and 3' : 'beat 1';
  const claims = [];
  if (ck.strong) claims.push(`Every note on ${beats} is a chord tone`);
  const bends = riff.notes.filter((n) => n.bend);
  if (bends.length) {
    const n = bends[0],
      bar = a + Math.floor(n.t / bpb + EPS),
      semis = bendTop(n.bend);
    claims.push(
      `${claims.length ? 'and the' : 'The'} bend in bar ${bar} goes up ${semis >= 2 ? 'a whole step' : 'a half step'} to ${spellIn(pcOf(n.p + semis), riff.key)}`,
    );
  }
  const two = `${style.label} over ${where} (${chords}), ${pos}: ${shape}.`;
  return claims.length ? `${two} ${claims.join(', ')}.` : two;
}
export function riffTakes(p, opts = {}, n = 3) {
  const tl = opts.timeline;
  const span = riffSpan(p, tl, opts);
  if (span.error) return span;
  const style = opts.style ? findRiffStyle(opts.style) : riffStyleFor(p);
  if (!style)
    return {
      error: `no riff style "${String(opts.style).slice(0, 40)}"`,
      hint: `styles: ${RIFF_STYLE_IDS.join(', ')}`,
    };
  const lvl = opts.difficulty == null ? 1 : DIFFICULTIES.indexOf(String(opts.difficulty).toLowerCase());
  if (lvl < 0)
    return { error: `no difficulty "${String(opts.difficulty).slice(0, 20)}"`, hint: DIFFICULTIES.join(', ') };
  const seed0 = Number.isFinite(+opts.seed) ? Math.round(+opts.seed) : 1;
  const motifs = RIFF_STYLES[style].motifs.filter((m) => (m.level || 0) <= lvl);
  // a different motif for each take where the style has them, in an order the seed picks
  const R = rng(`${seed0}:takes:${style}:${lvl}`);
  const order = motifs
    .map((m) => [R(), m.id])
    .sort((a, b) => a[0] - b[0])
    .map((x) => x[1]);
  const takes = [],
    seen = new Set();
  for (let k = 0; takes.length < n && k < n * 4; k++) {
    const r = writeRiff(p, { ...opts, span, style, seed: seed0 + k, motif: order[k % order.length] });
    if (r.error) {
      if (!takes.length && k >= n) return r;
      continue;
    }
    const sig = r.notes.map((x) => `${x.p}@${x.t}`).join(' ');
    if (seen.has(sig)) continue;
    seen.add(sig);
    takes.push(r);
  }
  if (!takes.length) return writeRiff(p, { ...opts, span, style, seed: seed0 });
  // labels that read apart: the same idea twice says where each one sits
  for (const t of takes)
    if (takes.filter((x) => x.label === t.label).length > 1)
      t.label =
        `${t.label.replace(/…$/, '')}, ${t.position ? `at the ${ORD(t.position)} fret` : 'open position'}`.slice(0, 48);
  return { takes, span };
}
export { noteName };
