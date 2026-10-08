// "Build a band around this" [core]: a deterministic, seeded arranger. The person's take is the seed (a hummed or
// played melody, a chord part, or a beat); this adds the band around it: chords, a bassline, a drum groove and an
// optional pad, each on a new track, in the song's key, tempo and meter. It never touches the seed's notes. Pure: no
// DOM, no Math.random, works in Node and the browser (the same seed gives the same band, always).
//
//   arrangeAround({ notes, start, length, key, meter, tempo, style, parts, seed, kind?, drums? })
//     -> { style, kind, key, harmony, segments, parts: { chords?, bass?, drums?, pad? }, skipped, check, summary }
//        notes in every part are { p, t, d, v } in beats from the seed clip's start (the band's clips start there too)
//   planArrangement(project, { track, clip, style, parts, seed, gains? }) -> { ops, tracks, ...arrangeAround } | { error, hint }
//        ops for ONE dispatch: track.add (named, coloured, a fitting device, a balanced gain) + clip.add per part
//   checkArrangement(seedNotes, parts, { key, meter, start, length, segments }) -> { outOfKey, clashes, roots, ... }
//   STYLES, STYLE_IDS, PARTS, strongTimes(...), harmonyKeyOf(key), levelFor(style, part)
//   drumBar, bassLine, chordPart, voice, nearestPitch: the part builders, for a chart of chords made elsewhere (the Jam
//        room's jam tracks, core/jam.js, play a progression they are given rather than one harmonized here)
//
// How it decides. The clip is cut into units, one per strong beat (beats 1 and 3 in 4/4, the bar in 3/4). For a melody,
// a Viterbi pass picks one diatonic chord per unit: chord tones under the tune score, a seed note sounding on a strong
// beat must never sit a semitone from a chord tone (that is the "clash" the checks look for), the style's harmonic
// rhythm decides how dear a change in mid-bar is, its progression and the usual pulls (V to I, IV to V, ii to V) score,
// and chords_from_melody's own pick (core/transforms.js) is a small prior. A chord seed is read, unit by unit; a beat
// seed gets the style's progression. The bass plays the chord's root at every change and on the downbeats, rides the
// kick (or the style's own line), and walks into the next chord on a scale step. Drums come from the style's grid
// (music.parseGrid), with seeded velocities, ghost notes, a fill in every 4th bar and a crash after it. Anything left
// that could still rub (an out-of-key hummed note) is dropped from the voicing on that beat rather than fought.

import { SCALES, scalePcs, beatsPerBar, chordName, spellPc, spellNote, parseGrid, normNote } from './music.js';
import { rng, guessKey, transform, onsets, isDrumDevice } from './transforms.js';
import { TRACK_COLORS } from './project.js';

const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const EPS = 1e-6;
const WIN = 0.125; // a note "sounds on" a strong beat if it starts up to a 32nd after it and is still held
export const PARTS = ['chords', 'bass', 'drums', 'pad'];
const DEFAULT_PARTS = ['chords', 'bass', 'drums'];
const KICKS = new Set([35, 36]);

/* ------------------------------------------------------------------------------------------------ the styles */
// Each style: what a chord change in mid-bar costs (midCost: the harmony moves by the bar, and mid-bar only when the
// tune asks for it), its progression (for beats and empty bars), and one recipe per part. Rhythms are in beats inside a 4/4 bar ([start, length, velocity]); other meters get a generic
// version of the same idea. Drum rows are music.parseGrid rows (16 steps of a 16th); `alt` replaces rows in every
// second bar; `fill` replaces the end of every 4th bar from step `from`. `level` is where each part sits against the
// seed, in LU (the seed leads: every part is below it). `gain` is the fader that lands there with a typical seed when
// nothing could be measured (calibrated with tools/render.js against a hummed line on Pinch Roller).
export const STYLES = {
  pop: {
    label: 'Pop',
    blurb: 'piano pushes, bass on the kick, a straight backbeat',
    midCost: 0.5,
    sevenths: false,
    swing: 0,
    ghost: 0.04,
    prog: { major: [0, 4, 5, 3], minor: [0, 5, 2, 6] },
    chords: {
      name: 'Piano',
      device: 'core.keys',
      params: { voice: 1, bright: 0.55, trem: 0 },
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
      device: 'core.bass',
      params: { cutoff: 760, drive: 0.3, sub: 0.45 },
      mode: 'kick',
      line: ['R', 'R', '5', 'R'],
      approach: 'add',
      legato: 0.9,
      range: [31, 47],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 0, room: 0.28, tone: 0.2 },
      rows: { kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
      alt: { kick: 'X.....x.X.x.....' },
      fill: { from: 12, rows: { kick: 'x...', snare: 'xx..', tom1: '..x.', tom3: '...X' } },
      crash: 'start',
    },
    pad: { name: 'Pad', device: 'core.pad', params: { tone: 1800, space: 0.4 }, register: [55, 76] },
    level: { chords: -5, bass: -4, drums: -3, pad: -10 },
    gain: { chords: -9, bass: -10, drums: -7, pad: -13 },
  },
  rock: {
    label: 'Rock',
    blurb: 'driving eighths on power chords and bass, big backbeat',
    midCost: 0.6,
    sevenths: false,
    power: true,
    swing: 0,
    ghost: 0.03,
    prog: { major: [0, 3, 0, 4], minor: [0, 6, 5, 6] },
    chords: {
      name: 'Rhythm',
      device: 'core.pluck',
      params: { tone: 0.7, decay: 1.2, mute: 0.12, body: 0.35 },
      inserts: [{ device: 'core.drive', params: {} }],
      register: [40, 64],
      rhythm: [
        [0, 0.5, 1],
        [0.5, 0.5, 0.7],
        [1, 0.5, 0.85],
        [1.5, 0.5, 0.7],
        [2, 0.5, 0.95],
        [2.5, 0.5, 0.7],
        [3, 0.5, 0.85],
        [3.5, 0.5, 0.72],
      ],
      legato: 0.9,
    },
    bass: {
      name: 'Bass',
      device: 'core.bass',
      params: { wave: 0.6, cutoff: 1100, drive: 0.55, sub: 0.35, mode: 1 },
      mode: 'eighths',
      line: ['R'],
      approach: 'last',
      legato: 0.85,
      range: [28, 45],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 0, room: 0.5, drive: 0.35, tone: 0.3 },
      rows: { kick: 'X.....x.X.x.....', snare: '....X.......X...', hat: 'X.x.X.x.X.x.X.x.' },
      alt: { kick: 'X.x...x.X.x.....' },
      fill: {
        from: 8,
        rows: { kick: 'x...x...', snare: 'xxxx....', tom1: '....xx..', tom2: '......x.', tom3: '.......X' },
      },
      crash: 'start',
    },
    pad: { name: 'Pad', device: 'core.pad', params: { tone: 2400, space: 0.3 }, register: [55, 76] },
    level: { chords: -4, bass: -4, drums: -2, pad: -11 },
    gain: { chords: -9, bass: -11, drums: -8, pad: -13 },
  },
  lofi: {
    label: 'Lo-fi',
    blurb: 'dusty Rhodes sevenths, lazy swung beat, warm round bass',
    midCost: 0.6,
    sevenths: true,
    rootless: true,
    swing: 0.2,
    ghost: 0.16,
    strum: 0.012,
    prog: { major: [1, 4, 0, 5], minor: [0, 3, 6, 2] },
    chords: {
      name: 'Rhodes',
      device: 'core.keys',
      params: { voice: 0, bright: 0.3, trem: 0.35, decay: 1.4 },
      register: [50, 72],
      rhythm: [
        [0, 2.25, 0.82],
        [2.5, 1.5, 0.68],
      ],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bass',
      params: { wave: 0, sub: 0.8, cutoff: 360, drive: 0.15, glide: 60 },
      mode: 'kick',
      line: ['R', '8', '5'],
      approach: 'add',
      legato: 0.95,
      range: [28, 45],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 2, room: 0.2, tone: -0.35, decay: 0.9 },
      inserts: [{ device: 'claude.charity-shop', params: { dust: 0.25, wear: 0.4, warp: 0.15 } }],
      rows: { kick: 'X......x..x.....', snare: '....X.......X...', hat: 'x.xox.x.x.xox.x.' },
      alt: { kick: 'X......x..x...x.' },
      fill: { from: 12, rows: { kick: '.x..', snare: 'x.ox', hat: 'x...' } },
      crash: 'none',
    },
    pad: { name: 'Pad', device: 'core.pad', params: { tone: 900, motion: 0.5, space: 0.5 }, register: [53, 74] },
    level: { chords: -5, bass: -4, drums: -3, pad: -11 },
    gain: { chords: -8, bass: -12, drums: -6, pad: -15 },
  },
  house: {
    label: 'House',
    blurb: 'four on the floor, offbeat stabs and bass, open hats',
    midCost: 0.7,
    sevenths: true,
    swing: 0.08,
    ghost: 0,
    prog: { major: [0, 5, 3, 4], minor: [0, 6, 5, 6] },
    chords: {
      name: 'Stabs',
      device: 'core.poly',
      params: { wave: 1, cutoff: 2200, envamt: 0.3, attack: 0.002, decay: 0.25, sustain: 0.35, release: 0.18 },
      inserts: [{ device: 'core.verb', params: { mix: 0.2, size: 0.5 } }],
      register: [55, 76],
      rhythm: [
        [0.5, 0.35, 0.9],
        [1.5, 0.35, 0.78],
        [2.5, 0.35, 0.9],
        [3.5, 0.35, 0.8],
      ],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bass',
      params: { wave: 0.3, cutoff: 650, reso: 0.4, envamt: 0.7, fdecay: 0.15, sub: 0.5, mode: 1 },
      mode: 'offbeat',
      line: ['R', 'R', '8', 'R', '8'],
      approach: 'none',
      legato: 0.45,
      range: [28, 45],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 1, room: 0.15, tone: 0.25 },
      rows: { kick: 'X...X...X...X...', clap: '....X.......X...', open: '..x...x...x...x.', hat: '.o.o.o.o.o.o.o.o' },
      alt: null,
      fill: { from: 8, rows: { kick: 'X...X...', clap: 'oooxxxXX', open: '........' } },
      crash: 'after',
    },
    pad: { name: 'Pad', device: 'core.pad', params: { tone: 2600, motion: 0.45, space: 0.45 }, register: [57, 79] },
    level: { chords: -5, bass: -3, drums: -2, pad: -11 },
    gain: { chords: -7, bass: -6, drums: -6, pad: -16 },
  },
  ballad: {
    label: 'Ballad',
    blurb: 'broken piano chords, half-time kit, long bass notes',
    midCost: 0.25,
    sevenths: false,
    swing: 0,
    ghost: 0,
    arp: true,
    prog: { major: [0, 5, 3, 4], minor: [0, 5, 2, 6] },
    chords: {
      name: 'Piano',
      device: 'core.keys',
      params: { voice: 1, bright: 0.4, trem: 0 },
      inserts: [{ device: 'core.verb', params: { mix: 0.25, size: 0.65 } }],
      register: [43, 72],
      legato: 1,
    },
    bass: {
      name: 'Bass',
      device: 'core.bass',
      params: { wave: 0.1, sub: 0.65, cutoff: 420, drive: 0.1, glide: 30 },
      mode: 'half',
      line: ['R', '5'],
      approach: 'add',
      legato: 1,
      range: [28, 45],
    },
    drums: {
      name: 'Drums',
      device: 'core.drums',
      params: { kit: 0, room: 0.45, decay: 1.15, tone: -0.1 },
      rows: { kick: 'X.........x.....', snare: '........X.......', hat: 'x.o.x.o.x.o.x.o.' },
      alt: null,
      fill: { from: 12, rows: { tom1: 'xx..', tom2: '..x.', tom3: '...x', hat: '....' } },
      crash: 'after',
    },
    pad: {
      name: 'Strings',
      device: 'claude.dust-sheet',
      params: { tone: 2600, attack: 0.5, release: 1.4 },
      register: [55, 76],
    },
    level: { chords: -5, bass: -5, drums: -5, pad: -9 },
    gain: { chords: -9, bass: -11, drums: -10, pad: -12 },
  },
};
export const STYLE_IDS = Object.keys(STYLES);
const STYLE_ALIASES = {
  'lo-fi': 'lofi',
  lofi: 'lofi',
  'lo fi': 'lofi',
  chill: 'lofi',
  hiphop: 'lofi',
  'hip-hop': 'lofi',
  dance: 'house',
  edm: 'house',
  slow: 'ballad',
  piano: 'ballad',
  indie: 'rock',
};
export function findStyle(name) {
  const k = String(name || '')
    .trim()
    .toLowerCase();
  return STYLES[k] ? k : STYLE_ALIASES[k] || null;
}
export const levelFor = (style, part) => STYLES[style]?.level?.[part] ?? -6;
const PART_WORD = { chords: 'chords', bass: 'bass', drums: 'drums', pad: 'pad' };

/* ------------------------------------------------------------------------------------------------ keys and time */
// The 7-note scale chords are built from (pentatonic, blues and chromatic keys borrow their parent major/minor).
export function harmonyKeyOf(key) {
  const sc = SCALES[key.scale] || SCALES.major;
  if (sc.length === 7) return { root: key.root, scale: SCALES[key.scale] ? key.scale : 'major' };
  return { root: key.root, scale: /minor|blues/i.test(key.scale) ? 'minor' : 'major' };
}
const keyText = (k) => `${k.root} ${k.scale.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
// Strong beats inside a bar (beats from the bar line).
export function strongOffsets(meter = [4, 4]) {
  const [n, d] = meter,
    bpb = beatsPerBar(meter);
  if (d === 4 && n === 4) return [0, 2];
  if (d === 4 && n === 6) return [0, 3];
  if (d === 8 && n === 6) return [0, 1.5];
  if (d === 8 && n === 12) return [0, 3];
  if (d === 2 && n === 2) return [0, 2];
  return bpb >= 4 && n % 2 === 0 ? [0, bpb / 2] : [0];
}
// The strong beats inside a clip, in clip time.
export function strongTimes({ start = 0, length, meter = [4, 4] }) {
  const bpb = beatsPerBar(meter),
    out = [];
  for (let k = Math.floor((start + EPS) / bpb); k * bpb < start + length - EPS; k++) {
    for (const o of strongOffsets(meter)) {
      const t = k * bpb + o - start;
      if (t > -EPS && t < length - EPS) out.push(r4(Math.max(0, t)));
    }
  }
  return out;
}
const soundsAt = (n, s) => n.t <= s + WIN && n.t + n.d > s + 0.02;
const ic1 = (a, b) => {
  const x = (((a - b) % 12) + 12) % 12;
  return x === 1 || x === 11;
};

/* ------------------------------------------------------------------------------------------------ chords */
function diatonic(hk) {
  const sc = scalePcs(hk);
  return [0, 1, 2, 3, 4, 5, 6].map((k) => {
    const pcs = [0, 2, 4, 6].map((j) => sc[(k + j) % 7]);
    const third = (pcs[1] - pcs[0] + 12) % 12,
      fifth = (pcs[2] - pcs[0] + 12) % 12;
    const quality = fifth === 6 ? 'dim' : fifth === 8 ? 'aug' : third === 4 ? 'maj' : 'min';
    return { degree: k, root: pcs[0], triad: pcs.slice(0, 3), seventh: pcs[3], ninth: sc[(k + 1) % 7], quality };
  });
}
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const roman = (c) =>
  (c.quality === 'maj' || c.quality === 'aug' ? ROMAN[c.degree] : ROMAN[c.degree].toLowerCase()) +
  (c.quality === 'dim' ? '°' : '');
// spelled for the key: Ab, not G#, in C minor
function nameOf(ch, pcs, hk = null) {
  const ps = pcs.map((pc, i) => (i === 0 ? 48 + pc : 60 + pc));
  return chordName(ps, hk) || spellPc(ch.root, hk);
}
// Prior per degree and the pulls between degrees (functional harmony, a little; the style's loop, a little more).
function priors(hk) {
  const major = (scalePcs(hk)[2] - scalePcs(hk)[0] + 12) % 12 === 4;
  return major ? [-0.15, 0, 0.12, -0.12, -0.12, -0.08, 0.9] : [-0.15, 0.9, -0.04, -0.08, 0.02, -0.12, -0.08];
}
function pull(a, b, major) {
  if (major) {
    if (a === 4 && b === 0) return -0.25;
    if (a === 3 && b === 4) return -0.12;
    if (a === 1 && b === 4) return -0.2;
    if (a === 5 && b === 3) return -0.1;
    if (a === 3 && b === 0) return -0.08;
    if (a === 0 && (b === 3 || b === 4 || b === 5)) return -0.05;
  } else {
    if ((a === 4 || a === 6) && b === 0) return -0.2;
    if (a === 5 && b === 6) return -0.12;
    if (a === 3 && b === 4) return -0.1;
    if (a === 0 && (b === 5 || b === 3 || b === 6)) return -0.05;
  }
  return 0;
}

// Cut the clip into units: one per strong beat, each up to the next strong beat (or the clip's end).
function unitsOf({ start, length, meter }) {
  const bpb = beatsPerBar(meter),
    offs = strongOffsets(meter),
    out = [];
  const k0 = Math.floor((start + EPS) / bpb);
  for (let k = k0; k * bpb < start + length - EPS; k++) {
    for (let i = 0; i < offs.length; i++) {
      const a = k * bpb + offs[i] - start,
        b = k * bpb + (i + 1 < offs.length ? offs[i + 1] : bpb) - start;
      const ca = Math.max(0, a),
        cb = Math.min(length, b);
      if (cb - ca < EPS) continue;
      out.push({
        a: r4(ca),
        b: r4(cb),
        strong: a > -EPS ? r4(a) : null,
        bar: k - k0,
        half: i > 0,
        downbeat: i === 0 && a > -EPS,
      });
    }
  }
  return out;
}

// The melody's notes in each unit: overlap, and whether each sounds on the unit's strong beat.
function unitNotes(u, mel) {
  const out = [];
  for (const n of mel) {
    const ov = Math.min(u.b, n.t + n.d) - Math.max(u.a, n.t);
    if (ov <= EPS) continue;
    const strong = u.strong != null && soundsAt(n, u.strong);
    out.push({ pc: ((n.p % 12) + 12) % 12, ov, strong, w: clamp(ov, 0.5, 2) * (0.6 + 0.5 * (n.v ?? 0.8)) });
  }
  return out;
}
function fit(un, ch) {
  let c = 0;
  const set = new Set(ch.triad);
  for (const n of un) {
    const inC = set.has(n.pc);
    if (n.strong) c += inC ? -1.0 * n.w : ch.triad.some((q) => ic1(q, n.pc)) ? 50 : 0.7 * n.w;
    else c += inC ? -0.35 * n.ov : 0.25 * n.ov;
  }
  return c;
}

// chords_from_melody's pick per unit (a small prior: the Transform menu would have said the same).
function cfmPrior(mel, ctx, chords, units, every) {
  const out = units.map(() => null);
  try {
    const r = transform(
      'chords_from_melody',
      mel.map((n, i) => ({ ...n, id: 'm' + i })),
      { kind: 'triads', every },
      ctx,
    );
    const added = r.notes.filter((n) => !n.id);
    for (let i = 0; i < units.length; i++) {
      const at = added.filter((n) => n.t <= units[i].a + EPS && n.t + n.d > units[i].a + EPS);
      if (!at.length) continue;
      const pcs = new Set(at.map((n) => n.p % 12));
      const ch = chords.find((c) => c.triad.every((pc) => pcs.has(pc)) && pcs.size === 3);
      if (ch) out[i] = ch.degree;
    }
  } catch (e) {
    /* no prior: fine */
  }
  return out;
}

function harmonizeMelody(mel, units, chords, S, hk, ctx, R) {
  const pr = priors(hk),
    major = (scalePcs(hk)[2] - scalePcs(hk)[0] + 12) % 12 === 4;
  const prog = major ? S.prog.major : S.prog.minor;
  const loop = new Set(prog.map((d, i) => `${d}>${prog[(i + 1) % prog.length]}`));
  const cfm = cfmPrior(mel, ctx, chords, units, 'bar');
  const allowed = chords.filter((c) => !(S.power && c.quality === 'dim'));
  const N = units.length;
  const uns = units.map((u) => unitNotes(u, mel));
  const local = units.map((u, i) =>
    allowed.map((c) => {
      let x = fit(uns[i], c) + pr[c.degree] + (cfm[i] === c.degree ? -0.12 : 0) + (R() - 0.5) * 0.06;
      if (c.quality === 'dim') x += 0.6;
      return x;
    }),
  );
  // Viterbi
  const cost = [local[0].map((x, j) => x + (allowed[j].degree === 0 ? -0.3 : 0))],
    back = [allowed.map(() => -1)];
  for (let i = 1; i < N; i++) {
    const u = units[i],
      empty = !uns[i].length && !uns[i - 1].length;
    cost.push([]);
    back.push([]);
    for (let j = 0; j < allowed.length; j++) {
      let best = Infinity,
        bk = 0;
      for (let q = 0; q < allowed.length; q++) {
        const a = allowed[q].degree,
          b = allowed[j].degree;
        let tr;
        if (a === b) tr = u.half ? 0 : empty ? 0.05 : 0.3;
        else {
          tr = u.half ? S.midCost : 0;
          tr += loop.has(`${a}>${b}`) ? (u.half ? -0.1 : -0.3) : 0;
          tr += pull(a, b, major);
        }
        const x = cost[i - 1][q] + tr;
        if (x < best - 1e-12) {
          best = x;
          bk = q;
        }
      }
      cost[i][j] = best + local[i][j] + (i === N - 1 && allowed[j].degree === 0 ? -0.1 : 0);
      back[i][j] = bk;
    }
  }
  let j = cost[N - 1].indexOf(Math.min(...cost[N - 1]));
  const pick = new Array(N);
  for (let i = N - 1; i >= 0; i--) {
    pick[i] = allowed[j];
    j = back[i][j];
  }
  return pick;
}

// A chord seed: read the chord sounding in each unit (the lowest note names the root when it can't tell).
function readChords(seed, units, chords) {
  let prev = chords[0];
  return units.map((u) => {
    const here = seed.filter((n) => n.t < u.b - EPS && n.t + n.d > u.a + EPS);
    if (!here.length) return prev;
    const w = new Array(12).fill(0);
    for (const n of here) w[n.p % 12] += Math.min(u.b, n.t + n.d) - Math.max(u.a, n.t);
    const low = here.reduce((a, b) => (b.p < a.p ? b : a)).p % 12;
    let best = null;
    for (const c of chords) {
      const s =
        c.triad.reduce((x, pc) => x + w[pc], 0) -
        0.5 * w.reduce((x, v, pc) => x + (c.triad.includes(pc) ? 0 : v), 0) +
        (c.root === low ? 0.3 : 0);
      if (!best || s > best.s + 1e-9) best = { c, s };
    }
    prev = best.c;
    return best.c;
  });
}

/* ------------------------------------------------------------------------------------------------ voicing */
function motion(prev, v) {
  if (!prev || !prev.length) return 0;
  let c = 0;
  for (const q of v) c += Math.min(...prev.map((p) => Math.abs(p - q)));
  return c + Math.abs(prev.length - v.length) * 2;
}
// Close voicings of pcs (ordered root-first), every inversion and octave inside [lo, hi]; the one nearest the last.
export function voice(pcs, [lo, hi], prev, top) {
  let best = null;
  for (let inv = 0; inv < pcs.length; inv++) {
    const rot = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let base = lo; base <= hi; base++) {
      if (base % 12 !== rot[0]) continue;
      const v = [base];
      for (let j = 1; j < rot.length; j++) {
        let q = rot[j] + 12 * Math.floor(v[j - 1] / 12);
        while (q <= v[j - 1]) q += 12;
        v.push(q);
      }
      if (v[v.length - 1] > hi) continue;
      let cost = prev ? motion(prev, v) : Math.abs(v.reduce((a, b) => a + b, 0) / v.length - (lo + hi) / 2) * 0.5;
      cost += inv === 0 ? 0 : inv === 1 ? 0.6 : 1.1;
      if (top != null && v[v.length - 1] > top) cost += (v[v.length - 1] - top) * 0.8;
      if (!best || cost < best.cost - 1e-9) best = { v, cost };
    }
  }
  return best ? best.v : pcs.map((pc) => lo + ((pc - (lo % 12) + 12) % 12)).sort((a, b) => a - b);
}
export function nearestPitch(pc, ref, lo, hi) {
  let best = null;
  for (let p = lo; p <= hi; p++)
    if (p % 12 === pc && (best == null || Math.abs(p - ref) < Math.abs(best - ref))) best = p;
  return best ?? clamp(pc + 12 * Math.floor(ref / 12), lo, hi);
}

/* ------------------------------------------------------------------------------------------------ the arranger */
// The work grows faster than the clip: 1,024 beats (256 bars of 4/4) takes well under a second; 65,536 took a minute.
export const MAX_BEATS = 1024;
export function arrangeAround(opts = {}) {
  const meter = opts.meter || [4, 4],
    tempo = opts.tempo || 120,
    start = Number(opts.start) || 0;
  const style = findStyle(opts.style) || 'pop',
    S = STYLES[style];
  const seedNotes = (opts.notes || []).map((n) => normNote(n));
  const bpb = beatsPerBar(meter);
  // the clip's own length when it has one (a seed shorter than a bar gets a band that short); else the seed's bars
  let seedEnd = 0;
  for (const n of seedNotes) seedEnd = Math.max(seedEnd, n.t + n.d);
  const length = Number(opts.length) > 0 ? Number(opts.length) : Math.max(bpb, Math.ceil((seedEnd - EPS) / bpb) * bpb);
  if (length > MAX_BEATS)
    return {
      error: `the clip is ${Math.ceil(length / bpb).toLocaleString('en-US')} bars long; a band is built over up to ${Math.floor(MAX_BEATS / bpb)} bars at a time`,
      hint: 'split the clip, or keep a shorter take, and build on that',
    };
  const R = rng(`${opts.seed ?? 1}:${style}`);
  const kind = opts.kind || seedKind(seedNotes, opts.drums);
  const key = opts.key || (kind === 'drums' ? { root: 'C', scale: 'major' } : guessKey(seedNotes));
  const hk = harmonyKeyOf(key);
  const keyPcs = new Set(scalePcs(hk));
  const chords = diatonic(hk);
  const units = unitsOf({ start, length, meter });
  const ctx = { key, meter, tempo, start };
  const want = normParts(opts.parts);
  const skipped = [];
  if (!seedNotes.length)
    return {
      error: 'the clip has no notes to build on',
      hint: 'hum, tap or play something first, then keep it as a clip',
    };
  if (!units.length) return { error: 'the clip is empty', hint: 'a clip needs some length' };

  // 1. the harmony, one chord per unit
  let pick;
  const mel = kind === 'melody' ? seedNotes : [];
  if (kind === 'melody') pick = harmonizeMelody(mel, units, chords, S, hk, ctx, R);
  else if (kind === 'chords') pick = readChords(seedNotes, units, chords);
  else {
    const major = (scalePcs(hk)[2] - scalePcs(hk)[0] + 12) % 12 === 4;
    const prog = major ? S.prog.major : S.prog.minor;
    pick = units.map((u) => chords[prog[u.bar % prog.length]]);
  }
  // what could still rub on each strong beat (an out-of-key note in the seed): those tones sit that beat out
  const clashSeed = kind === 'drums' ? [] : seedNotes;
  // units with the same chord inside one bar make one segment (a chord, its colour tones, what it leaves out)
  const segs = [];
  units.forEach((u, i) => {
    const c = pick[i],
      last = segs[segs.length - 1];
    if (last && last.chord.degree === c.degree && Math.abs(last.b - u.a) < EPS && !u.downbeat) {
      last.b = u.b;
      last.units.push(u);
    } else segs.push({ a: u.a, b: u.b, chord: c, units: [u], bar: u.bar });
  });
  segs.forEach((s, i) => {
    const c = s.chord;
    const strongPcs = [
      ...new Set(
        s.units.flatMap((u) =>
          u.strong == null ? [] : clashSeed.filter((n) => soundsAt(n, u.strong)).map((n) => n.p % 12),
        ),
      ),
    ];
    const rubs = (pc) => strongPcs.some((m) => ic1(pc, m));
    const avoid = c.triad.filter(rubs);
    const pcs = S.power ? [c.root, c.triad[2]] : c.triad.slice();
    if (S.sevenths && c.quality !== 'dim' && !rubs(c.seventh)) pcs.push(c.seventh);
    if (style === 'lofi' && c.quality !== 'dim' && !rubs(c.ninth)) pcs.push(c.ninth);
    s.pcs = pcs.filter((pc) => !avoid.includes(pc));
    s.avoid = avoid;
    s.bassPc = !avoid.includes(c.root) ? c.root : (c.triad.find((pc) => !avoid.includes(pc)) ?? null);
    s.change = i === 0 || segs[i - 1].chord.degree !== c.degree;
  });
  for (const s of segs)
    s.name =
      s.pcs.length >= 2
        ? nameOf(s.chord, [s.chord.root, ...s.pcs.filter((pc) => pc !== s.chord.root)], hk)
        : spellPc(s.chord.root, hk);

  // 2. the drums (or the seed's kick, when the seed is the beat)
  const S16 = Math.round(bpb * 4);
  const k0 = Math.floor((start + EPS) / bpb),
    k1 = Math.ceil((start + length - EPS) / bpb);
  const gridAt = (k, step) => r4(k * bpb + step * 0.25 + (step % 2 === 1 ? (S.swing || 0) * 0.25 : 0) - start);
  const drumBars = [];
  for (let k = k0; k < k1; k++) drumBars.push(drumBar(S, style, meter, S16, k - k0, R));
  const parts = {};
  const inClip = (n) => n.t >= -EPS && n.t < length - EPS;
  if (want.includes('drums')) {
    if (kind === 'drums') skipped.push({ part: 'drums', why: 'the seed is the beat' });
    else {
      const out = [];
      drumBars.forEach((bar, i) => {
        for (const n of bar.notes) {
          const t = gridAt(k0 + i, n.step);
          if (t > -EPS && t < length - EPS) out.push({ p: n.p, t: Math.max(0, t), d: 0.25, v: n.v });
        }
      });
      parts.drums = out;
    }
  }
  // kick steps per bar: the seed's when it is the beat, else the groove's
  const kickSteps = drumBars.map((bar, i) => {
    if (kind === 'drums') {
      const a = (k0 + i) * bpb - start;
      return [
        ...new Set(
          seedNotes
            .filter((n) => KICKS.has(n.p) && n.t >= a - EPS && n.t < a + bpb - EPS && n.v >= 0.5)
            .map((n) => Math.round((n.t - a) / 0.25)),
        ),
      ].sort((x, y) => x - y);
    }
    return bar.notes
      .filter((n) => KICKS.has(n.p))
      .map((n) => n.step)
      .sort((x, y) => x - y);
  });

  // 3. the bass
  const segAt = (t) => segs.find((s) => t >= s.a - EPS && t < s.b - EPS) || segs[segs.length - 1];
  if (want.includes('bass'))
    parts.bass = bassLine(S, segs, kickSteps, { k0, bpb, S16, start, length, gridAt, segAt, hk, R, meter });

  // 4. the chords (unless the seed is the chords)
  const top = (s) => {
    if (!mel.length) return null;
    const here = mel.filter((n) => n.t < s.b - EPS && n.t + n.d > s.a + EPS);
    return here.length ? Math.min(...here.map((n) => n.p)) - 1 : null;
  };
  if (want.includes('chords')) {
    if (kind === 'chords') skipped.push({ part: 'chords', why: 'the seed is the chords' });
    else parts.chords = chordPart(S, style, segs, { k0, bpb, start, length, meter, gridAt, top, R });
  }
  // 5. the pad: the chord held through each change, tied across bars while it stays
  if (want.includes('pad')) {
    const out = [];
    let prevV = null,
      prevSeg = null,
      held = [];
    for (const s of segs) {
      if (!s.pcs.length) {
        prevSeg = null;
        held = [];
        continue;
      }
      const pcs = s.pcs.filter((pc, i, a) => a.indexOf(pc) === i).slice(0, 4);
      if (prevSeg && prevSeg.b === s.a && prevSeg.pcs.join() === s.pcs.join() && held.length) {
        for (const n of held) n.d = r4(s.b - n.t);
        prevSeg = s;
        continue;
      }
      const v = voice(pcs, S.pad.register, prevV, null);
      held = v.map((p) => ({ p, t: s.a, d: r4(s.b - s.a), v: r4(clamp(0.5 + (R() - 0.5) * 0.06, 0.3, 0.7)) }));
      out.push(...held);
      prevV = v;
      prevSeg = s;
    }
    parts.pad = out;
  }
  for (const k of Object.keys(parts))
    parts[k] = parts[k]
      .filter(inClip)
      .map((n) => ({
        p: n.p,
        t: r4(Math.max(0, n.t)),
        d: r4(Math.max(1 / 32, Math.min(n.d, length - n.t))),
        v: r4(clamp(n.v, 0.05, 1)),
      }))
      .sort((a, b) => a.t - b.t || a.p - b.p);

  const check = checkArrangement(seedNotes, parts, { key, meter, start, length, segments: segs, kind, style });
  const fills = drumBars.map((b, i) => (b.fill ? i + 1 : 0)).filter(Boolean);
  const prog = segs.filter((s, i) => i === 0 || s.name !== segs[i - 1].name).map((s) => s.name);
  const made = PARTS.filter((p) => parts[p]);
  const summary =
    `${S.label} band around ${seedNotes.length} ${kind === 'drums' ? 'hits' : 'notes'} in ${keyText(key)}: ${made.join(', ') || 'nothing'}` +
    (prog.length ? `. Chords ${prog.slice(0, 8).join(' – ')}${prog.length > 8 ? ' …' : ''}` : '') +
    (parts.bass
      ? `; bass ${S.bass.mode === 'kick' ? 'on the kick' : S.bass.mode === 'eighths' ? 'in eighths' : S.bass.mode === 'offbeat' ? 'on the offbeats' : 'in long notes'}`
      : '') +
    (parts.drums ? (fills.length ? `; a fill in bar ${fills.join(', ')}` : '; no fill (under 4 bars)') : '') +
    `. ${check.clashes.length ? `${check.clashes.length} strong-beat rub${check.clashes.length === 1 ? '' : 's'} left` : 'Nothing rubs against your notes on the strong beats'}.`;
  return {
    style,
    label: S.label,
    kind,
    key,
    harmony: hk,
    length,
    start,
    segments: segs.map((s) => ({
      a: s.a,
      b: s.b,
      degree: s.chord.degree,
      roman: roman(s.chord),
      name: s.name,
      root: s.chord.root,
      bass: s.bassPc,
      pcs: s.pcs,
      change: s.change,
    })),
    progression: prog,
    parts,
    made,
    skipped,
    fills,
    check,
    summary,
  };
}

function normParts(parts) {
  if (!parts) return DEFAULT_PARTS.slice();
  const ALIAS = {
    chord: 'chords',
    keys: 'chords',
    piano: 'chords',
    bassline: 'bass',
    drum: 'drums',
    beat: 'drums',
    groove: 'drums',
    pads: 'pad',
    strings: 'pad',
  };
  const list = (Array.isArray(parts) ? parts : String(parts).split(/[\s,]+/))
    .map((x) => String(x).trim().toLowerCase())
    .map((x) => ALIAS[x] || x);
  const out = PARTS.filter((p) => list.includes(p));
  return out.length ? out : DEFAULT_PARTS.slice();
}

// What the seed is: a beat (a drum device, or every pitch a drum), chords (mostly 3+ notes at once) or a melody.
export function seedKind(notes, drums) {
  if (drums) return 'drums';
  if (!notes.length) return 'melody';
  const g = onsets(notes);
  const big = g.filter((x) => x.notes.length >= 3).length;
  return big / g.length >= 0.5 ? 'chords' : 'melody';
}

/* ------------------------------------------------------------------------------------------------ the parts */
// One bar of the groove: rows from the style (the alt rows on every second bar, the fill on every 4th, a crash after
// a fill), as { p, step, v } with seeded velocities (accents on the beat, softer offbeats, ghost notes).
export function drumBar(S, style, meter, S16, i, R) {
  const D = S.drums;
  let rows;
  if (S16 === 16) rows = { ...D.rows, ...(i % 2 === 1 && D.alt ? D.alt : {}) };
  else rows = genericRows(style, meter, S16);
  const fill = i % 4 === 3;
  let from = S16;
  if (fill) {
    const f = S16 === 16 ? D.fill : { from: S16 - 4, rows: { snare: 'xx..', tom1: '..x.', tom3: '...X' } };
    from = f.from;
    for (const k of Object.keys(rows)) rows[k] = rows[k].slice(0, from).padEnd(S16, '.');
    for (const [k, r] of Object.entries(f.rows)) rows[k] = (rows[k] || '').padEnd(S16, '.').slice(0, from) + r;
  }
  if (i % 4 === 0 && (D.crash === 'start' ? true : D.crash === 'after' ? i > 0 : false))
    rows.crash = 'X'.padEnd(S16, '.');
  const notes = parseGrid({ steps: S16, step: 0.25, rows }).map((n) => ({
    p: n.p,
    step: Math.round(n.t / 0.25),
    v: n.v,
  }));
  // ghost notes on the snare between the backbeats (never in the fill)
  if (S.ghost)
    for (let st = 1; st < from; st += 2)
      if (R() < S.ghost && !notes.some((n) => n.step === st && (n.p === 38 || n.p === 39)))
        notes.push({ p: 38, step: st, v: 0.32 });
  for (const n of notes) {
    let acc = 1;
    if (n.p === 42 || n.p === 44 || n.p === 70 || n.p === 51)
      acc = n.step % 4 === 0 ? 1 : n.step % 2 === 0 ? 0.78 : 0.62;
    else if (KICKS.has(n.p)) acc = n.step === 0 ? 1 : 0.92;
    if (fill && n.step >= from) acc *= 0.82 + 0.18 * ((n.step - from) / Math.max(1, S16 - 1 - from));
    n.v = r4(clamp(n.v * acc * (1 + (R() - 0.5) * 0.12), 0.12, 1));
  }
  notes.sort((a, b) => a.step - b.step || a.p - b.p);
  return { notes, fill, from };
}
// The same ideas outside 4/4: a waltz, a compound 6/8 lilt, or kick-on-one / snare-in-the-middle.
function genericRows(style, meter, S16) {
  const row = (hits) => {
    const a = Array(S16).fill('.');
    for (const [i, c] of hits) if (i < S16) a[i] = c;
    return a.join('');
  };
  const eighths = (ch, off) => row(Array.from({ length: Math.ceil(S16 / 2) }, (_, j) => [j * 2, j % 2 ? off : ch]));
  const [n, d] = meter;
  if (d === 8 && n % 3 === 0) {
    // compound: dotted-quarter pulses
    const pulses = Array.from({ length: n / 3 }, (_, j) => j * 6);
    return {
      kick: row([[0, 'X'], ...(style === 'house' ? pulses.slice(1).map((s) => [s, 'x']) : [])]),
      snare: row(pulses.slice(1).map((s, j) => [s, j === pulses.length - 2 ? 'X' : 'x'])),
      hat: eighths('x', 'o'),
    };
  }
  if (n === 3)
    return {
      kick: row([[0, 'X']]),
      snare: row([
        [4, 'o'],
        [8, 'x'],
      ]),
      hat: eighths('x', 'o'),
    };
  const mid = Math.round(S16 / 2 / 2) * 2;
  return {
    kick: row([
      [0, 'X'],
      ...(style === 'house' ? Array.from({ length: Math.floor(S16 / 4) }, (_, j) => [j * 4, 'X']) : []),
    ]),
    snare: row([[mid, 'X']]),
    hat: eighths('x', 'o'),
  };
}

export function bassLine(S, segs, kickSteps, { k0, bpb, S16, start, length, gridAt, segAt, hk, R, meter }) {
  const B = S.bass,
    [lo, hi] = B.range;
  const ladder = [];
  const pcs = new Set(scalePcs(hk));
  for (let p = lo - 2; p <= hi + 2; p++) if (pcs.has(p % 12)) ladder.push(p);
  // onsets: per bar from the mode, plus one at every segment start (a chord change always lands on its root)
  const times = new Set();
  const half = strongOffsets(meter).map((o) => Math.round(o * 4));
  for (let i = 0; i < kickSteps.length; i++) {
    let steps;
    if (B.mode === 'kick') steps = kickSteps[i].length ? kickSteps[i] : [0];
    else if (B.mode === 'eighths') steps = Array.from({ length: Math.ceil(S16 / 2) }, (_, j) => j * 2);
    else if (B.mode === 'offbeat')
      steps = S16 === 16 ? [0, 2, 6, 10, 14] : [0, ...Array.from({ length: Math.floor(S16 / 4) }, (_, j) => j * 4 + 2)];
    else steps = half;
    for (const st of steps) times.add(gridAt(k0 + i, st));
  }
  for (const s of segs) times.add(r4(s.a));
  // walk-ins: an extra note on the "and" of the last beat before a change
  if (B.approach === 'add')
    for (const s of segs)
      if (s.change && s.a > EPS) {
        const t = r4(s.a - (S.arp ? 1 : 0.5));
        if (t > EPS && ![...times].some((x) => x > t - EPS && x < s.a - EPS)) times.add(t);
      }
  const list = [...times].filter((t) => t > -EPS && t < length - EPS).sort((a, b) => a - b);
  const out = [];
  let prevP = Math.round((lo + hi) / 2) - 2,
    idx = 0,
    curSeg = null;
  for (let i = 0; i < list.length; i++) {
    const t = list[i],
      next = i + 1 < list.length ? list[i + 1] : length;
    const s = segAt(t);
    if (s !== curSeg) {
      curSeg = s;
      idx = 0;
    }
    if (s.bassPc == null) continue;
    const root = nearestPitch(s.bassPc, prevP, lo, hi);
    let p = root;
    const role = idx === 0 ? 'R' : B.line[idx % B.line.length];
    if (role === '5') {
      const f = s.pcs.includes(s.chord.triad[2]) && !s.avoid.includes(s.chord.triad[2]) ? s.chord.triad[2] : s.bassPc;
      p = nearestPitch(f, root + 5, lo, hi);
    } else if (role === '8') p = root + 12 <= hi + 7 ? root + 12 : root;
    // the last note before a change walks to the next root by a scale step
    const nextSeg = segs.find((x) => x.a > t + EPS);
    const lastBefore = nextSeg && next >= nextSeg.a - EPS && nextSeg.change && nextSeg.bassPc != null && idx > 0;
    if (lastBefore && (B.approach === 'add' || B.approach === 'last')) {
      const target = nearestPitch(nextSeg.bassPc, p, lo, hi);
      const ti = ladder.indexOf(target);
      if (ti >= 0) {
        const below = ladder[ti - 1],
          above = ladder[ti + 1];
        const cand = [below, above].filter((x) => x != null && x >= lo - 2 && x <= hi + 2 && !ic1(x, nextSeg.bassPc));
        if (cand.length) p = cand.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a));
      }
    }
    const onKick = kickSteps.some((ks, bi) => ks.some((st) => Math.abs(gridAt(k0 + bi, st) - t) < 0.01));
    const v = (idx === 0 ? 0.88 : onKick ? 0.82 : 0.7) * (1 + (R() - 0.5) * 0.1);
    const d = Math.max(0.1, Math.min(next - t, 2 * bpb) * B.legato);
    out.push({ p, t, d: r4(d), v: r4(v) });
    prevP = p;
    idx++;
  }
  return out;
}

export function chordPart(S, style, segs, { k0, bpb, start, length, meter, gridAt, top, R }) {
  const C = S.chords,
    out = [];
  let prevV = null;
  const voicings = new Map();
  for (const s of segs) {
    if (!s.pcs.length) continue;
    let v;
    if (S.power) {
      const r = nearestPitch(s.chord.root, prevV ? prevV[0] : 45, C.register[0], C.register[0] + 12);
      v = s.pcs.length === 2 ? [r, r + ((s.pcs[1] - s.pcs[0] + 12) % 12), r + 12] : [r, r + 12];
      v = v.filter((p) => !s.avoid.includes(p % 12));
    } else if (S.arp) {
      // a broken chord: root, fifth, octave, tenth (what is left of them after any rub)
      const r = nearestPitch(s.chord.root, prevV ? prevV[0] : 52, C.register[0], C.register[0] + 11);
      const th = (s.chord.triad[1] - s.chord.root + 12) % 12,
        fi = (s.chord.triad[2] - s.chord.root + 12) % 12;
      v = [r, r + fi, r + 12, r + 12 + th].filter((p) => s.pcs.includes(p % 12));
    } else {
      let pcs = s.pcs.slice();
      if (S.rootless && pcs.length >= 4) pcs = pcs.filter((pc) => pc !== s.chord.root);
      v = voice(pcs, C.register, prevV, top(s));
    }
    voicings.set(s, v);
    if (v.length) prevV = v;
  }
  const hits = [];
  if (S.arp) {
    // eighths through each segment, every note held to its end (the sustain pedal)
    for (const s of segs) {
      const v = voicings.get(s);
      if (!v || !v.length) continue;
      const order = [0, 1, 2, 3, 2, 1, 2, 3];
      const seq = [];
      for (let t = s.a, j = 0; t < s.b - EPS; t += 0.5, j++)
        seq.push({ p: v[order[j % order.length] % v.length], t: r4(t) });
      seq.forEach((n, i) => {
        const again = seq.slice(i + 1).find((m) => m.p === n.p); // held until that string is struck again
        const strong = Math.abs(n.t - s.a) < EPS;
        out.push({
          p: n.p,
          t: n.t,
          d: r4((again ? again.t : s.b) - n.t),
          v: r4(clamp((strong ? 0.62 : 0.48) * (1 + (R() - 0.5) * 0.12), 0.2, 0.9)),
        });
      });
    }
    return out;
  }
  const simple = meter[1] === 4 && meter[0] === 4;
  const k1 = Math.ceil((start + length - EPS) / bpb);
  for (let k = k0; k < k1; k++) {
    let rhythm = C.rhythm;
    if (!simple) {
      const offs = strongOffsets(meter);
      if (S.power) rhythm = Array.from({ length: Math.floor(bpb * 2) }, (_, j) => [j * 0.5, 0.5, j % 2 ? 0.7 : 0.9]);
      else if (style === 'house') rhythm = Array.from({ length: Math.floor(bpb) }, (_, j) => [j + 0.5, 0.35, 0.85]);
      else rhythm = offs.map((o, i) => [o, (i + 1 < offs.length ? offs[i + 1] : bpb) - o, i ? 0.8 : 0.95]);
    }
    for (const [rt, rd, rv] of rhythm) {
      const step = Math.round(rt * 4);
      const a = r4(k * bpb + rt + (step % 2 === 1 ? (S.swing || 0) * 0.25 : 0) - start);
      const b = r4(a + rd);
      hits.push({ a, b, v: rv });
    }
  }
  for (const hit of hits) {
    // split a hit where the chord changes under it: the new chord gets its own hit at the change
    for (const s of segs) {
      const a = Math.max(hit.a, s.a),
        b = Math.min(hit.b, s.b);
      if (b - a < 0.05 || a < -EPS || a >= length - EPS) continue;
      const v = voicings.get(s);
      if (!v || !v.length) continue;
      const vel = hit.v * (Math.abs(a - hit.a) > EPS ? 0.9 : 1);
      v.forEach((p, i) =>
        out.push({
          p,
          t: r4(a + (S.strum || 0) * i),
          d: r4(Math.max(0.05, (b - a) * (C.legato || 1) - (S.strum || 0) * i)),
          v: r4(clamp(vel * (0.72 + (R() - 0.5) * 0.08), 0.2, 0.95)),
        }),
      );
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ the checks */
// In key (the harmony key's scale), nothing a semitone from the seed on a strong beat, the bass on the root at every
// change and downbeat, the drums on the style's grid (16ths, swung where the style swings).
export function checkArrangement(
  seedNotes,
  parts,
  { key, meter = [4, 4], start = 0, length, segments, kind = 'melody', style = 'pop' } = {},
) {
  const hk = harmonyKeyOf(key || { root: 'C', scale: 'major' });
  const pcs = new Set(scalePcs(hk));
  const pitched = ['chords', 'bass', 'pad'].flatMap((k) => (parts[k] || []).map((n) => ({ ...n, part: k })));
  const nn = (p) => spellNote(p, hk);
  const outOfKey = pitched.filter((n) => !pcs.has(n.p % 12)).map((n) => `${n.part} ${nn(n.p)}@${n.t}`);
  const clashes = [];
  if (kind !== 'drums')
    for (const s of strongTimes({ start, length, meter })) {
      const mine = seedNotes.filter((n) => soundsAt(n, s));
      const theirs = pitched.filter((n) => soundsAt(n, s));
      for (const m of mine)
        for (const o of theirs) if (ic1(m.p, o.p)) clashes.push(`${o.part} ${nn(o.p)} against ${nn(m.p)} at beat ${s}`);
    }
  const roots = [];
  const bpb = beatsPerBar(meter);
  if (parts.bass && segments) {
    const segOf = (t) => segments.find((s) => t >= s.a - EPS && t < s.b - EPS);
    const points = new Set(segments.filter((s) => s.change).map((s) => r4(s.a)));
    for (let k = Math.ceil((start - EPS) / bpb); k * bpb < start + length - EPS; k++) points.add(r4(k * bpb - start));
    for (const t of points) {
      const s = segOf(t);
      if (!s || (s.bassPc ?? s.bass) == null) continue;
      const first = parts.bass.find((n) => n.t >= t - EPS && n.t < t + 1 - EPS);
      if (!first) roots.push(`no bass note at beat ${t}`);
      else if (first.p % 12 !== (s.bassPc ?? s.bass)) roots.push(`bass ${nn(first.p)} under ${s.name} at beat ${t}`);
    }
  }
  const sw = (STYLES[style]?.swing || 0) * 0.25;
  const onGrid = (x) => Math.abs(x * 4 - Math.round(x * 4)) < 1e-3;
  const offGrid = (parts.drums || [])
    .filter((n) => {
      const song = n.t + start;
      if (onGrid(song)) return !(sw === 0 || Math.round(song * 4) % 2 === 0);
      return !(sw > 0 && onGrid(song - sw) && Math.round((song - sw) * 4) % 2 !== 0);
    })
    .map((n) => `${n.p}@${n.t}`);
  return {
    ok: !outOfKey.length && !clashes.length && !roots.length && !offGrid.length,
    outOfKey,
    clashes,
    roots,
    offGrid,
  };
}

/* ------------------------------------------------------------------------------------------------ into ops */
// The ops for one dispatch: a track per part (named, coloured, with its device and a gain) and a clip on each, right
// after the seed track. gains: { part: dB } overrides the style's calibrated faders (the page measures them).
export function planArrangement(
  project,
  { track, clip, style = 'pop', parts, seed = 1, gains = null, drums = null } = {},
) {
  const t = (project.tracks || []).find((x) => x.id === track) || (project.tracks || []).find((x) => x.name === track);
  if (!t)
    return {
      error: `no track "${track}"`,
      hint: `tracks: ${(project.tracks || []).map((x) => `"${x.name}"`).join(', ')}`,
    };
  const c = (t.clips || []).find((x) => x.id === clip) || (!clip && t.clips.length === 1 ? t.clips[0] : null);
  if (!c)
    return {
      error: clip ? `no clip "${clip}" on ${t.name}` : `which clip on ${t.name}?`,
      hint: `${t.name}'s clips: ${t.clips.map((x) => `${x.id} "${x.name || ''}"`).join(', ') || 'none'}`,
    };
  if (c.kind !== 'notes')
    return {
      error: `${c.name || 'that clip'} is audio`,
      hint: 'the band builds around notes: hum it or play it, then keep it as a clip',
    };
  if (!c.notes.length)
    return { error: `${c.name || 'that clip'} has no notes`, hint: 'hum, tap or play something into it first' };
  const sid = findStyle(style);
  if (!sid) return { error: `no style "${style}"`, hint: `styles: ${STYLE_IDS.join(', ')}` };
  const isDrums = drums ?? isDrumDevice(t.instrument?.device);
  const r = arrangeAround({
    notes: c.notes,
    start: c.start,
    length: c.length,
    key: project.key,
    meter: project.meter,
    tempo: project.tempo,
    style: sid,
    parts,
    seed,
    drums: isDrums,
  });
  if (r.error) return r;
  const S = STYLES[sid];
  const used = new Set((project.tracks || []).map((x) => x.name.toLowerCase()));
  const colorsUsed = new Set((project.tracks || []).map((x) => x.color));
  const free = TRACK_COLORS.filter((x) => !colorsUsed.has(x));
  const prefer = { chords: 'var(--c-6)', bass: 'var(--c-5)', drums: 'var(--c-1)', pad: 'var(--c-2)' };
  const pickColor = (part, i) => {
    const p = prefer[part];
    if (free.includes(p)) {
      free.splice(free.indexOf(p), 1);
      return p;
    }
    return free.length ? free.shift() : TRACK_COLORS[(i + 3) % TRACK_COLORS.length];
  };
  const uniq = (name) => {
    let n = name,
      i = 2;
    while (used.has(n.toLowerCase())) n = `${name} ${i++}`;
    used.add(n.toLowerCase());
    return n;
  };
  const index = project.tracks.indexOf(t) + 1;
  const order = ['chords', 'pad', 'bass', 'drums'].filter((p) => r.parts[p]);
  const ops = [],
    tracks = [];
  order.forEach((part, i) => {
    const R = S[part];
    const name = uniq(R.name);
    const gain = r4(clamp(gains && Number.isFinite(gains[part]) ? gains[part] : S.gain[part], -30, 6));
    const ref = `band_${part}`;
    ops.push({
      type: 'track.add',
      ref,
      index: index + i,
      track: {
        name,
        kind: 'instrument',
        color: pickColor(part, i),
        instrument: { device: R.device, params: { ...R.params } },
        inserts: (R.inserts || []).map((fx) => ({ device: fx.device, params: { ...fx.params }, on: true })),
        gain,
        pan: part === 'chords' ? -0.12 : part === 'pad' ? 0.12 : 0,
      },
    });
    ops.push({
      type: 'clip.add',
      track: '$' + ref,
      ref: ref + '_clip',
      clip: { kind: 'notes', start: c.start, length: c.length, name: CLIP_NAME[part](S), notes: r.parts[part] },
    });
    tracks.push({ part, ref, name, device: R.device, gain, notes: r.parts[part].length });
  });
  return {
    ...r,
    ops,
    tracks,
    seed: { track: t.id, clip: c.id, name: `${t.name} › ${c.name || 'clip'}`, notes: c.notes.length },
  };
}
const CLIP_NAME = {
  chords: (S) => `${S.label} chords`,
  bass: (S) => `${S.label} bass`,
  drums: (S) => `${S.label} groove`,
  pad: (S) => S.pad.name,
};

// Gains that put each part `level` LU under the seed, from measured loudness (LUFS of each stem at its current gain).
export function balanceGains({ style, seedLufs, parts }) {
  const out = {};
  if (!(seedLufs > -70)) return out;
  for (const [part, m] of Object.entries(parts)) {
    if (!(m && m.lufs > -70)) continue;
    out[part] = Math.round(clamp(m.gain + (seedLufs + levelFor(style, part)) - m.lufs, -30, 6) * 10) / 10;
  }
  return out;
}
