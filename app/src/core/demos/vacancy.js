// "Vacancy": indie pop, 64 bars in D major at 116 bpm (2:12), a whole song in the arranger's sections: intro, verse,
// chorus, verse 2, chorus 2, bridge, chorus 3, outro. Vacancy is the sign still lit at two in the morning. The song is
// played on Studio A, Light Table, Slide Rule and Scribble Strip:
//   - Studio A, BIRCH, miked for this record: the overheads down, the room pair up, a little of the crushed room. A
//     drummer plays it: a cross-stick under the first verse, the backbeat with ghost strokes in the second, four on the
//     floor with half-open hats and rimshots in the choruses, the ride's bow and bell through the bridge's half time
//     (the room pair opened for it), a flam or a drag into every fill, a crash on every section's downbeat the kit
//     plays, a roll swelling into the last chorus (the crushed room pushed, a tambourine on two and four, a china on
//     the and of four) and one last hit with the crash grabbed.
//   - Light Table three ways: the bass (from Sprocket: an FM click over a sine an octave down; roots in eighths,
//     octaves in the choruses), the sign (Neon, from Zoetrope: string-machine pulses a Scribble Strip chops 3-3-2 in
//     every half bar, its filter opening over the intro and again through the bridge, an echo after it) and the
//     chorus pad (from Long Exposure).
//   - A DI Box guitar, picking through the second verse and the outro, strumming its low strings in the later choruses.
//   - Slide Rule doing the quiet work: the bass gives the kick 58 Hz (-2.5 dB) and loses the rumble under 30 Hz, the
//     pad stays over the bass (a 24 dB cut at 230 Hz) and under the topline (-4 dB at 850 Hz), and the guitar is
//     thinned under 160 Hz and scooped at 700 Hz (-5.5 dB) for the sign and the topline.
// The house played all of that. Claude played over it: the topline on Light Table (from Magic Lantern, a vowel lead
// that slides from note to note, with its own Slide Rule taking 2.5 dB off at 3 kHz), and the pump on the pad (a
// Scribble Strip ducking every beat, which its lane slows to half notes for the bridge).
// Measured on the canonical Node render (app/src/audio/measure.js; tools/demos-test.js holds the mix): -10.5 LUFS,
// -1.1 dBTP, crest 11.8 dB, the key reading D major. Sections: intro -14.0, verse -12.0, chorus -9.6, verse 2 -11.3,
// chorus 2 -9.2, bridge -9.7 (-10.1 in the half time, -9.3 in the build), chorus 3 -9.3, outro -11.8 LUFS. Each part
// through the master: drums -14.8, bass -14.8, Neon -15.1, pad -16.9, guitar -17.9, topline -13.9. The topline is 2.7
// to 3 LU over the next part in every chorus, and 0.7 LU (2.3 dB in its own band) over the sign's sweep in the
// bridge; Neon is 4 LU over the guitar in the verses. In third-octave spectra, part against part, section by section:
// the kick takes 63 Hz (by 3-5 dB); in the choruses the bass takes 80-315 Hz (2-5 dB over the pad) and the topline
// 630 Hz to 3 kHz (3-4 dB clear at 1.3-2 kHz), with the topline, the pad and the strummed guitar within a decibel at
// 800 Hz; in the verses Neon takes 400-630 Hz (5-6 dB over the guitar). The gate swings the sign 45 dB; the pump moves
// the pad 12 dB on every beat.

import { HOUSE, AGENT, clip, fx, track, bars, groove, demo, automate } from './lib.js';
import { DRUM_MAP } from '../music.js';

export const META = { id: 'vacancy', title: 'Vacancy', genre: 'Indie pop', line: 'a drummer in Studio A, a gated synth, the topline and the pump by Claude', tempo: 116, key: 'D major' };

const TEMPO = 116, BARS = 64;
const FORM = [['Intro', 0, 8], ['Verse', 8, 8], ['Chorus', 16, 8], ['Verse 2', 24, 8], ['Chorus 2', 32, 8], ['Bridge', 40, 8], ['Chorus 3', 48, 8], ['Outro', 56, 8]];
const where = (b) => { let k = 0; while (k + 1 < FORM.length && b >= FORM[k + 1][1]) k++; return { s: FORM[k][0], i: b - FORM[k][1] }; };
const isChorus = (s) => s.startsWith('Chorus');
// Studio A lands a flam's stroke 24 ms after its grace note and a drag's 75 ms after: written that much early, the
// stroke lands on the beat (docs/research/STUDIO-A.md, the note map)
const early = (ms) => (ms / 1000) * TEMPO / 60;
const FLAM = early(24), DRAG = early(75);

// [bass root (its sine sub an octave down), the sign's voicing, the pad's, the guitar's open shape low to high]. Under
// the Gmaj7 the guitar plays a plain G: the seventh is the sign's, and an F# beside its G4 would rub.
const CH = {
  Bm7: [47, [66, 69, 71, 74], [57, 59, 62, 66], [47, 54, 57, 62, 66]],
  Gmaj7: [43, [67, 71, 74, 78], [55, 59, 62, 66], [43, 47, 50, 55, 59, 67]],
  D: [50, [66, 69, 74, 76], [57, 62, 66, 69], [50, 57, 62, 66]],
  A: [45, [64, 69, 73, 76], [57, 61, 64, 69], [45, 52, 57, 61, 64]],
  'A/C#': [49, [64, 69, 73, 76], [57, 61, 64, 69], [49, 52, 57, 61, 64]],
  G: [43, [67, 71, 74, 79], [55, 59, 62, 67], [43, 47, 50, 55, 59, 67]],
  Em7: [40, [64, 67, 71, 74], [55, 59, 62, 64], [40, 47, 52, 55, 62, 64]],
  Bb: [46, [65, 70, 74, 77], [53, 58, 62, 65], [46, 53, 58, 62, 65]],
  C: [48, [67, 72, 76, 79], [55, 60, 64, 67], [48, 52, 55, 60, 64]],
};
const VERSE = ['Bm7', 'Gmaj7', 'D', 'A'], CHORUS = ['D', 'A/C#', 'Bm7', 'G'], BRIDGE = ['Em7', 'G', 'Bm7', 'A', 'Em7', 'G', 'Bb', 'C'];
const chordAt = (b) => {
  const { s, i } = where(Math.min(b, BARS - 1));
  if (s === 'Bridge') return BRIDGE[i];
  if (isChorus(s)) return CHORUS[i % 4];
  if (s === 'Outro' && i >= 6) return 'D';
  return VERSE[i % 4];
};

// Claude's topline: the hook (two answers to one phrase, the second reaching up), the bridge's long line, and the
// last chorus climbing to D
const HOOK = [
  [78, 0, 0.75], [76, 0.75, 0.25], [74, 1, 1], [69, 2, 0.5], [74, 2.5, 0.5], [76, 3, 0.5], [78, 3.5, 1.25], [76, 4.75, 1.75],
  [73, 7, 0.5], [76, 7.5, 0.5], [78, 8, 1], [81, 9, 0.75], [78, 9.75, 0.25], [76, 10, 0.5], [74, 10.5, 1], [71, 11.5, 2.5],
  [74, 15, 0.5], [76, 15.5, 0.5],
  [78, 16, 0.75], [76, 16.75, 0.25], [74, 17, 1], [69, 18, 0.5], [74, 18.5, 0.5], [76, 19, 0.5], [81, 19.5, 1.25], [78, 20.75, 0.25], [76, 21, 1.5],
  [78, 23, 0.5], [81, 23.5, 0.5], [83, 24, 1.5], [81, 25.5, 0.5], [78, 26, 1], [76, 27, 0.5], [74, 27.5, 2.5], [71, 30.5, 1.25],
];
const HOOK3 = [...HOOK.filter(([, t]) => t < 23),
  [81, 23, 0.5], [83, 23.5, 0.5], [86, 24, 1.5], [83, 25.5, 0.5], [81, 26, 1], [78, 27, 0.5], [76, 27.5, 2.5], [74, 30.5, 1.25]];
const LINE = [
  [79, 0, 2.5], [78, 2.5, 0.5], [76, 3, 1], [74, 4, 2.5], [76, 6.5, 0.5], [79, 7, 1],
  [78, 8, 3], [76, 11, 0.5], [74, 11.5, 0.5], [73, 12, 2], [76, 14, 1], [81, 15, 1],
  [83, 16, 2.5], [81, 18.5, 0.5], [79, 19, 1], [79, 20, 2], [81, 22, 1], [83, 23, 1],
  [86, 24, 2], [84, 26, 1], [82, 27, 1], [84, 28, 1.5], [82, 29.5, 0.5], [81, 30, 1], [79, 31, 1],
];

// one 16-step bar of Studio A: rows by music.js DRUM_MAP name (rimshot, half, bell, crashchoke...), X accent, x hit,
// O and o softer, - and g the ghost strokes (under 0.35 a snare stroke is soft and dark)
const VEL = { X: 1, x: 0.8, O: 0.62, o: 0.45, '-': 0.3, g: 0.2 };
function kit(rows) {
  const out = [];
  for (const [name, row] of Object.entries(rows)) {
    const p = DRUM_MAP[name] ?? Number(name), cells = row.replace(/[\s|]/g, '');
    for (let k = 0; k < cells.length; k++) if (VEL[cells[k]]) out.push({ p, t: k * 0.25, d: 0.2, v: VEL[cells[k]] });
  }
  return out;
}
const hit = (p, t, v, d = 0.2, x = {}) => ({ p: DRUM_MAP[p] ?? p, t, d, v, ...x });

// a part bar by bar, each note tagged with the bar it was written in (groove may nudge a downbeat a hair early)
const part = (fn) => bars(BARS, (b) => (fn(b) || []).map((x) => ({ ...x, bar: b })));
// song-time notes -> a clip for each section they were written in, from its first bar with a note to the section's
// end, named for what plays there (a downbeat nudged early lands on its bar line)
const cut = (notes, name, by = HOUSE) => FORM.map(([s, b0, n]) => {
  const mine = notes.filter((x) => x.bar >= b0 && x.bar < b0 + n);
  if (!mine.length) return null;
  const t0 = Math.min(...mine.map((x) => x.bar)) * 4, end = (b0 + n) * 4;
  return clip(t0, end - t0, mine.map(({ bar, ...x }) => ({ ...x, t: Math.max(0, x.t - t0) })), name(s), by);
}).filter(Boolean);

// a Scribble Strip lane from [x, y, bend, step] points (devices/builtin/shaper.js: <lane>_n, <lane><i>_x _y _c _s)
const shape = (lane, pts) => Object.assign({ [`${lane}_n`]: pts.length },
  ...pts.map(([x, y, c = 0, s = 0], k) => ({ [`${lane}${k + 1}_x`]: x, [`${lane}${k + 1}_y`]: y, [`${lane}${k + 1}_c`]: c, [`${lane}${k + 1}_s`]: s })));

export function make() {
  /* ---------------------------------------------------------------------------------------------- the drummer */
  const drumBar = (b) => {
    const { s, i } = where(b);
    if (s === 'Intro') {
      if (b < 4) return [];
      if (b === 7) return [...kit({ kick: 'X.......x.......', hat: 'o.-.o.-.', snare: '..........ox....', tom1: '............x...', tom2: '.............x..', tom3: '..............x.', floor: '...............X' }), hit('flam', 2 - FLAM, 0.8)];
      const g = kit({ kick: b === 5 ? 'X.......x.....x.' : 'X.......x.......', hat: 'o.-.o.-.o.-.o.-.', snare: b === 6 ? '............o...' : '' });
      if (b === 4) g.push(hit('crash', 0, 0.55));
      return g;
    }
    if (s === 'Verse') {   // a cross-stick on two and four, the hats closed
      const r = { kick: i % 2 ? 'X.....x.x.....x.' : 'X.....x.x.......', rim: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' };
      if (i === 0) { r.hat = '..o.x.o.x.o.x.o.'; r.crash = 'X...............'; }
      if (i === 3) { r.hat = 'x.o.x.o.x.o.x...'; r.open = '..............o.'; }
      if (i === 7) return [...kit({ kick: 'X.....x.x.......', rim: '....x...........', hat: 'x.o.x.o.x.o.....', tom1: '.............x..', tom3: '..............x.', floor: '...............x' }), hit('drag', 3 - DRAG, 0.7)];
      return kit(r);
    }
    if (isChorus(s)) {     // four on the floor, the hats half open, rimshots on two and four
      const r = { kick: 'X...X...X...X...', rimshot: '....x.......x...', half: 'o.x.o.x.o.x.o.x.' };
      if (i === 0) { r.half = '..x.o.x.o.x.o.x.'; r.crash = 'X...............'; }
      if (i === 4) { r.half = '..x.o.x.o.x.o.x.'; if (s === 'Chorus') r.crash = 'x...............'; else r.crash2 = 'x...............'; }
      if (i === 3) r.snare = '..............ox';
      if (s === 'Chorus 3') { r.tamb = '....o.......o...'; if (i % 2 === 1 && i < 7) { r.half = 'o.x.o.x.o.x.o...'; r.china = '..............x.'; } }
      if (i === 7) {
        if (s === 'Chorus') return [...kit({ kick: 'X...X...X.......', rimshot: '....X...........', half: 'o.x.o.x.', snare: '.........o......', tom1: '..........xx....', tom2: '............xx..', floor: '..............xX' }), hit('flam', 2 - FLAM, 0.85)];
        if (s === 'Chorus 2') return [...kit({ kick: 'X...X...X...X...', rimshot: '....X.......', half: 'o.x.o.x.o.x.', snare: '..............xX' }), hit('drag', 3 - DRAG, 0.75)];
        return [...kit({ kick: 'X.......x...x...', half: 'o.x.', snare: '.....oxo........', tom1: '........xx......', tom2: '..........xx....', tom3: '............xx..', floor: '..............xX' }), hit('flam', 1 - FLAM, 0.9)];
      }
      return kit(r);
    }
    if (s === 'Verse 2') { // the snare on the backbeat now, more ghosts, sixteenths on the hats in the second half
      const r = { kick: i % 2 ? 'X.....x.x..x....' : 'X.....x.x.......', snare: '....X..g..g.X...', hat: i >= 4 ? 'x-o-x-o-x-o-x-o-' : 'x.o.x.o.x.o.x.o.' };
      if (i === 0) { r.hat = '..o.x.o.x.o.x.o.'; r.crash = 'X...............'; }
      if (i === 3) { r.hat = 'x.o.x.o.x.o.x...'; r.open = '..............o.'; }
      if (i === 7) return [...kit({ kick: 'X.....x.x.......', snare: '....X...-go-ox..', hat: 'x-o-x-o-', floor: '...............X' }), hit('flam', 3.5 - FLAM, 0.9)];
      return kit(r);
    }
    if (s === 'Bridge') {
      if (i < 4) {         // half time: the ride's bow on the beat and its bell between, the foot on two and four
        const r = { kick: i % 2 ? 'x.........o...o.' : 'x.........o.....', snare: '........x.......', ride: 'o...o...o...o...', bell: '..O...O...O...O.', pedal: '....o.......o...' };
        if (i === 0) { r.ride = '....o...o...o...'; r.crash = 'X...............'; }
        if (i === 3) { r.snare = '........x.....o.'; r.floor = '............o..x'; }
        return kit(r);
      }
      if (i < 6) return kit({ kick: 'X.....x.x.......', snare: '....X.......X...', ride: 'x.o.x.o.x.o.x...', bell: '..............x.' });
      if (i === 6) return kit({ kick: 'X...X...X...X.x.', snare: '....X.......X...', ride: 'x.x.x.x.x.x.x.x.' });
      // the roll, swelling, and a flam onto the last chorus
      return [...kit({ kick: 'X...X...X...X...' }), hit('roll', 0, 0.55, 3.35, { mod: [[0, 0.12], [3.35, 1]] }), hit('flam', 3.5 - FLAM, 1)];
    }
    // the outro: the backbeat again, then the band drops to the hats, and stops on one hit with the crash grabbed
    if (i < 4) {
      const r = { kick: 'X.....x.x.......', snare: '....X..g..g.X...', hat: 'x.o.x.o.x.o.x.o.' };
      if (i === 0) { r.hat = '..o.x.o.x.o.x.o.'; r.crash = 'X...............'; }
      if (i === 3) { r.hat = 'x.o.x.o.x.o.x...'; r.open = '..............o.'; }
      return kit(r);
    }
    if (i === 4) return kit({ kick: 'X.......x.......', hat: 'x.o.x.o.x.o.x.o.' });
    if (i === 5) return kit({ kick: 'X.......x.......', hat: 'x.o.x.o.x.o.....', snare: '............o.xX' });
    if (i === 6) return kit({ kick: 'X...............', crashchoke: 'X...............', floor: 'x...............' });
    return [];
  };
  const drums = groove(part(drumBar), { seed: 116, push: { 37: 0.006, 38: 0.008, 40: 0.008, 42: -0.004, 24: -0.004 }, vel: 0.07, time: 0.005 });
  const DRUMS = { Intro: 'Way in', Verse: 'Cross-stick', Chorus: 'Four on the floor', 'Verse 2': 'Backbeat', 'Chorus 2': 'Four on the floor', Bridge: 'Ride and bell', 'Chorus 3': 'Four on the floor', Outro: 'Backbeat, then the stop' };

  /* ---------------------------------------------------------------------------------------------- the bass */
  const approach = (r, next) => (next > r ? next - 1 : next + 2);
  const EIGHTHS = [0.9, 0.62, 0.74, 0.62, 0.84, 0.62, 0.74, 0.66];
  const bassBar = (b) => {
    const { s, i } = where(b), r = CH[chordAt(b)][0], next = CH[chordAt(b + 1)][0];
    if (s === 'Intro') return b < 4 ? [] : [{ p: r, t: 0, d: 3.8, v: 0.8 }];
    if (s === 'Outro' && i >= 4) return i === 6 ? [{ p: r, t: 0, d: 0.3, v: 0.95 }] : i === 7 ? [] : [{ p: r, t: 0, d: 3.8, v: 0.8 }];
    if (isChorus(s)) return EIGHTHS.map((v, k) => ({ p: r + (k % 2 ? 12 : 0), t: k * 0.5, d: 0.4, v }));
    if (s === 'Bridge' && i < 4) return [{ p: r, t: 0, d: 2.6, v: 0.88 }, { p: r, t: 3, d: 0.4, v: 0.62 }, { p: approach(r, next), t: 3.5, d: 0.4, v: 0.7 }];
    return EIGHTHS.map((v, k) => ({ p: k === 7 && next !== r ? approach(r, next) : r, t: k * 0.5, d: 0.42, v }));
  };
  const bass = groove(part(bassBar), { seed: 29, push: {}, vel: 0.05, time: 0.004 });

  /* ---------------------------------------------------------------------------------------------- the sign, the pad */
  const neon = part((b) => {
    const { s, i } = where(b);
    if (isChorus(s) || (s === 'Bridge' && i < 4)) return [];
    return CH[chordAt(b)][1].map((p) => ({ p, t: 0, d: 4, v: 0.72 }));
  });
  const pad = part((b) => {
    const { s, i } = where(b);
    if (!isChorus(s) && s !== 'Bridge') return [];
    return CH[chordAt(b)][2].map((p, k) => ({ p, t: 0, d: 4, v: (0.58 + k * 0.03) * (s === 'Bridge' && i < 4 ? 0.8 : 1) }));
  });

  /* ---------------------------------------------------------------------------------------------- the guitar */
  const UPDOWN = [0, 2, 1, 3, 2, 1, 3, 2];
  const STRUM = [[0, 0.9, 0.66], [1, 0.45, 0.48], [1.5, 0.9, 0.56], [2.5, 0.45, 0.48], [3, 0.45, 0.52], [3.5, 0.5, 0.46]];
  const guitarBar = (b) => {
    const { s, i } = where(b), strings = CH[chordAt(b)][3];
    const pick = () => { const top = strings.slice(-4); return UPDOWN.map((k, j) => ({ p: top[k], t: j * 0.5, d: Math.min(1.4, 4 - j * 0.5), v: j % 2 ? 0.6 : 0.74 })); };
    const strum = () => STRUM.flatMap(([t, d, v]) => strings.slice(0, 4).map((p) => ({ p, t, d, v })));   // the low strings: the top is the topline's
    if (s === 'Verse 2' || (s === 'Outro' && i < 6)) return pick();
    if (s === 'Chorus 2' || s === 'Chorus 3' || (s === 'Bridge' && i >= 4)) return strum();
    if (s === 'Outro' && i === 6) return strings.map((p) => ({ p, t: 0, d: 0.35, v: 0.85 }));
    return [];
  };
  const guitar = groove(part(guitarBar), { seed: 7, vel: 0.06, time: 0.006 });

  /* ---------------------------------------------------------------------------------------------- Claude's topline */
  // (a note running straight into the next is held a hair over it, so the lead slides there instead of starting again)
  const at = (list, bar) => list.map(([p, t, d], k) => ({ p, t: t + bar * 4, bar: bar + Math.floor(t / 4), d: list[k + 1] && Math.abs(list[k + 1][1] - t - d) < 1e-6 ? d + 0.04 : d, v: 0.78 + (t % 4 === 0 ? 0.08 : 0) + (d >= 1.5 ? 0.04 : 0) }));
  const line = at(LINE, 40).map((n) => (n.t < 176 ? { ...n, v: n.v * 0.7 } : n));   // (softer through the half-time bars)
  const topline = groove([...at(HOOK, 16), ...at(HOOK, 32), ...line, ...at(HOOK3, 48)], { seed: 61, vel: 0.04, time: 0.004 });

  // Switches are stored as indexes. Light Table's (devices/builtin/wavetable.js) here: tables PULSE 1, HARMONICS 2,
  // VOWEL 3, FM 7 (BASIC 0); filters LP12 0, LP24 1; voices MONO 1, LEGATO 2; LFOs SINE 0, TRI 1, FREE 0, RETRIG 1;
  // mod sources ENV3 3, LFO1 4, LFO2 5; destinations A POS 1, B POS 7, FINE 19, M2 AMT 27; delay 1/4D 6. Slide Rule's
  // band types: BELL 0, LOW CUT 12 3, LOW CUT 24 4. Echo Reel's div 7 is 1/8D; Scribble Strip's rates 8 and 11 are 1/4
  // and 1/2.
  const p = demo({
    title: META.title, tempo: TEMPO, key: { root: 'D', scale: 'major' }, bars: BARS,
    sections: FORM,
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drumroom',
        params: { kit: 1, mix_close: 0, mix_oh: -4.5, mix_room: -5, mix_crush: -15, room_size: 0.65, bleed: 0.4, humanize: 0.55, velocity: 0.1, hat_level: -2.5, kick_level: 1 },
        clips: cut(drums, (s) => DRUMS[s]), gain: -0.5 }),
      track({ name: 'Bass', color: 'var(--c-5)', device: 'core.wavetable',
        params: { a_table: 7, a_pos: 0.1, a_unison: 1, a_level: 0.8, b_table: 0, b_pos: 0, b_oct: -1, b_level: 0.5, flt_type: 0, flt_cutoff: 2000, flt_res: 0.1, flt_env: 0.2, flt_key: 0.3,
          env1_attack: 0.001, env1_decay: 0.5, env1_sustain: 0.6, env1_release: 0.06, env1_curve: 0.5, env3_attack: 0.001, env3_decay: 0.18, env3_sustain: 0, env3_release: 0.1, env3_curve: 0.6,
          voice_mode: 1, fx_verb_mix: 0, m1_src: 3, m1_dst: 1, m1_amt: 0.6, voice_level: 4.5 },
        inserts: [fx('core.eq8', { b1_on: 1, b1_type: 4, b1_freq: 30, b2_on: 1, b2_type: 0, b2_freq: 58, b2_gain: -2.5, b2_q: 1.4 })],
        clips: cut(bass, (s) => (isChorus(s) ? 'Octaves' : s === 'Intro' ? 'Roots' : s === 'Bridge' ? 'Bridge' : 'Eighths')), gain: -4.5 }),
      track({ name: 'Neon', color: 'var(--c-3)', device: 'core.wavetable',
        params: { a_table: 1, a_pos: 0.25, a_unison: 4, a_detune: 0.25, a_level: 0.75, b_table: 1, b_pos: 0.6, b_oct: 0, b_fine: 6, b_unison: 2, b_level: 0.6,
          flt_type: 1, flt_cutoff: 3000, flt_res: 0.12, flt_env: 0.1, flt_key: 0.5, env1_attack: 0.02, env1_decay: 1, env1_sustain: 0.85, env1_release: 0.4,
          lfo1_shape: 1, lfo1_rate: 0.6, lfo1_mode: 0, lfo2_shape: 0, lfo2_rate: 0.45, lfo2_mode: 0, fx_chorus_mix: 0.5, fx_chorus_depth: 0.6, fx_verb_mix: 0.1, fx_verb_size: 0.65,
          m1_src: 4, m1_dst: 1, m1_amt: 0.35, m2_src: 5, m2_dst: 7, m2_amt: -0.3, voice_level: -2 },
        inserts: [
          fx('core.shaper', { vol_rate: 11, vol_depth: 100, smooth: 3, flt_on: 1, flt_cut: 7000, flt_res: 0.2,
            ...shape('vol', [[0, 1, 0.35], [0.3, 0, 0, 1], [0.375, 1, 0.35], [0.675, 0, 0, 1], [0.75, 1, 0.35], [0.95, 0, 0, 1]]) }),
          fx('core.delay', { div: 7, mode: 1, feedback: 0.32, tone: 3800, lowcut: 350, wow: 0.1, mix: 0.2 }),
        ],
        clips: cut(neon, () => 'Sign'), gain: -0.5, pan: -0.1 }),
      track({ name: 'Pad', color: 'var(--c-7)', device: 'core.wavetable',
        params: { a_table: 2, a_pos: 0.35, a_unison: 6, a_detune: 0.3, a_blend: 0.8, a_spread: 0.9, a_level: 0.75, b_table: 0, b_pos: 2 / 3, b_oct: -1, b_unison: 4, b_detune: 0.25, b_level: 0.35,
          flt_type: 1, flt_cutoff: 2200, flt_res: 0.1, flt_env: 0.15, flt_key: 0.4, env1_attack: 0.25, env1_decay: 2, env1_sustain: 0.9, env1_release: 1.2, env1_curve: -0.3,
          env2_attack: 1.2, env2_decay: 2, env2_sustain: 0.6, env2_release: 2, lfo1_shape: 0, lfo1_rate: 0.08, lfo1_mode: 0, lfo2_shape: 1, lfo2_rate: 0.13, lfo2_mode: 0,
          fx_chorus_mix: 0.4, fx_chorus_depth: 0.5, fx_verb_mix: 0.3, fx_verb_size: 0.8, m1_src: 4, m1_dst: 1, m1_amt: 0.25, m2_src: 5, m2_dst: 7, m2_amt: 0.15, voice_level: 1.6 },
        inserts: [
          fx('core.eq8', { b1_on: 1, b1_type: 4, b1_freq: 230, b5_on: 1, b5_type: 0, b5_freq: 850, b5_gain: -4, b5_q: 0.8 }),
          fx('core.shaper', { vol_rate: 8, vol_depth: 85, smooth: 4, ...shape('vol', [[0, 0, -0.4], [0.55, 1], [1, 1]]) }, AGENT),
        ],
        clips: cut(pad, () => 'Chords'), gain: -2.5 }),
      track({ name: 'Guitar', color: 'var(--c-4)', device: 'core.guitar',
        params: { body: 0, pick: 0.3, pickup: 0.55, tone: 0.65, decay: 1, strum: 10, mute: 0 },
        inserts: [
          fx('core.eq8', { b1_on: 1, b1_type: 3, b1_freq: 160, b3_on: 1, b3_type: 0, b3_freq: 700, b3_gain: -5.5, b3_q: 0.8 }),
          fx('core.chorus', { rate: 0.6, depth: 0.35, delay: 9, mix: 0.35 }),
          fx('core.delay', { div: 7, mode: 1, feedback: 0.3, tone: 3500, lowcut: 300, wow: 0.15, mix: 0.2 }),
          fx('core.verb', { size: 0.5, decay: 1.8, mix: 0.15 }),
        ],
        clips: cut(guitar, (s) => (s === 'Verse 2' || s === 'Outro' ? 'Picking' : 'Strums')), gain: -3, pan: 0.3 }),
      track({ name: 'Topline', color: 'var(--c-2)', device: 'core.wavetable',
        params: { a_table: 3, a_pos: 0.2, a_unison: 2, a_detune: 0.12, a_level: 0.8, b_table: 3, b_pos: 0.7, b_oct: 0, b_fine: -8, b_level: 0.45,
          flt_type: 0, flt_cutoff: 4800, flt_res: 0.1, flt_env: 0, flt_key: 0.3, env1_attack: 0.02, env1_decay: 0.8, env1_sustain: 0.9, env1_release: 0.3,
          env3_attack: 0.001, env3_decay: 0.7, env3_sustain: 0, env3_release: 0.3, env3_curve: -0.5, voice_mode: 2, voice_glide: 45,
          fx_delay_time: 6, fx_delay_fb: 0.25, fx_delay_mix: 0.12, fx_verb_mix: 0.25, fx_verb_size: 0.55,
          lfo1_shape: 1, lfo1_rate: 0.35, lfo1_mode: 1, lfo2_shape: 0, lfo2_rate: 5.2, lfo2_mode: 1,
          m1_src: 4, m1_dst: 1, m1_amt: 0.6, m2_src: 5, m2_dst: 19, m2_amt: 0.12, m3_src: 3, m3_dst: 27, m3_amt: -0.12, voice_level: 2.4 },
        inserts: [fx('core.eq8', { b6_on: 1, b6_type: 0, b6_freq: 3000, b6_gain: -2.5, b6_q: 1.4, b7_on: 1, b7_type: 0, b7_freq: 6800, b7_gain: -1.5, b7_q: 1.5 }, AGENT)],
        clips: cut(topline, (s) => (s === 'Bridge' ? 'Bridge line' : 'Hook'), AGENT), gain: -1.8, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -18, ratio: 2, attack: 20, release: 200 }),
      fx('core.limiter', { gain: 4.3, ceiling: -1 }),
    ] },
  });

  // The house's lanes: the sign's filter (opening over the intro, shut again when it comes back in the bridge and swept
  // up through it into the last chorus, closing over the last two bars, where the loop finds it shut), the room pair
  // opened for the half-time bars of the bridge, and the crushed room pushed for the last chorus
  automate(p, HOUSE, [
    { track: 'Neon', insert: 'core.shaper', param: 'flt_cut', points: '0:350~0.45 16:7000 176:7000 176:600~0.35 192:14000 192:7000 248:7000~-0.2 256:350' },
    { track: 'Drums', insert: 'instrument', param: 'mix_room', points: '0:-5 160:-5 162:-2.5 174:-2.5 176:-5' },
    { track: 'Drums', insert: 'instrument', param: 'mix_crush', points: '0:-15 191:-15 192:-9 223:-9 224:-15' },
  ]);
  // Claude's: the pump slowed to half notes for the bridge
  automate(p, AGENT, [
    { track: 'Pad', insert: 'core.shaper', param: 'vol_rate', points: '0:8 160:8 160:11 192:11 192:8' },
  ]);
  return p;
}
export default make;
