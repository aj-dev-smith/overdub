// "Wake-Up Call": a gospel ballad in 12/8, 20 bars in Ab major at 66 bpm (each beat a dotted quarter, three triplet
// eighths to it). The Baby Grand plays a Sunday-morning verse: I-iii-vi, Ab7 over its seventh walking the bass down to
// Db/F, then the minor plagal (Dbm6) and home through Ab/Eb and Eb9sus4, every chord a step or a hold from the last;
// the right hand pulses on the triplets with the tune on top. A Flatwound bass walks a triplet into every change, an
// ACOUSTIC+ kit plays cross-stick in the verse and opens up for the shout, Music Stands hold the shout and the amen.
// The house played all of that. Claude played over it: the Rotor Cabinet on the gospel drawbars with the rotor
// spinning fast, quiet chords under the verse, then the tune of the shout (Db, D dim, Ab/Eb, F7b9, Bbm9, Eb13) and the
// plagal amen at the end.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, groove, demo } from './lib.js';

export const META = { id: 'wake-up-call', title: 'Wake-Up Call', genre: 'Gospel', line: 'a Sunday ballad on the grand, the organ by Claude', tempo: 66, key: 'Ab major' };

const T = 1 / 3; // a triplet eighth

// [right hand, bass] for each half bar (two beats). The right hand stays between B3 and C5 so the tune sits above it.
const H = (rh, bass) => ({ rh, bass });
const VERSE = [
  H([60, 63, 67, 70], 44), H([60, 63, 67, 70], 48),   // Abmaj9 | Cm7 (the same four notes, the bass moves)
  H([60, 63, 67, 68], 41), H([60, 63, 66, 68], 42),   // Fm9 | Ab7/Gb
  H([61, 65, 68, 72], 41), H([61, 64, 68, 70], 40),   // Dbmaj7/F | Dbm6/Fb (the minor plagal; the bass walks F, E, Eb)
  H([60, 63, 68, 72], 39), H([61, 65, 68, 70], 39),   // Ab/Eb | Eb9sus4 (the last beat lifts to Eb13: see below)
];
const EB13 = [61, 67, 70, 72];
const SHOUT = [
  H([60, 63, 65, 68], 37), H([60, 63, 65, 68], 37),   // Dbmaj9
  H([59, 62, 65, 68], 38), H([59, 62, 65, 68], 38),   // D dim7 (the passing #iv)
  H([60, 63, 68, 72], 39), H([60, 63, 68, 72], 39),   // Ab/Eb
  H([60, 63, 66, 69], 41), H([60, 63, 66, 69], 45),   // F7b9 (to A in the bass)
  H([61, 65, 68, 72], 46), H([61, 65, 68, 72], 46),   // Bbm9
  H([61, 67, 70, 72], 39), H([61, 67, 70, 72], 39),   // Eb13
  H([60, 63, 67, 70], 44), H([60, 63, 66, 70], 42),   // Abmaj9 | Ab7/Gb
  H([61, 65, 68, 72], 41), H([61, 64, 68, 70], 40),   // Db/F | Dbm6/Fb
];
const AMEN = [H([61, 65, 68, 72], 44), H([61, 64, 68, 70], 44), H([60, 63, 67, 70], 44), H([60, 63, 67, 70], 44)]; // Db/Ab, Dbm6/Ab, Abmaj9

// the tune: [pitch, beat, length] over each four-bar verse phrase, and the second time higher
const TUNE_A = [
  [72, 0, 1.33], [70, 1.33, T], [68, 1.67, T], [67, 2, 1.33], [70, 3.33, T], [72, 3.67, T],
  [75, 4, 1], [72, 5, 0.67], [68, 5.67, T], [72, 6, 0.67], [75, 6.67, T], [78, 7, 1],
  [77, 8, 1.67], [75, 9.67, T], [76, 10, 1], [75, 11, 0.67], [73, 11.67, T],
  [72, 12, 1.33], [68, 13.33, T], [70, 13.67, T], [70, 14, 1.33], [68, 15.33, T], [67, 15.67, T],
];
const TUNE_B = [
  [75, 0, 1.33], [72, 1.33, T], [75, 1.67, T], [79, 2, 1], [77, 3, 0.67], [75, 3.67, T],
  [80, 4, 1], [77, 5, 0.67], [75, 5.67, T], [72, 6, 0.67], [75, 6.67, T], [78, 7, 1],
  [77, 8, 1], [80, 9, 0.67], [77, 9.67, T], [76, 10, 1.33], [75, 11.33, T], [73, 11.67, T],
  [72, 12, 1], [75, 13, 0.67], [72, 13.67, T], [70, 14, 1.67], [68, 15.67, T],
];
// Claude's shout, on the organ: a bar a chord, the line climbing to C6 over the Eb13 and falling home
const SHOUT_TUNE = [
  [77, 0, 1.67], [80, 1.67, T], [80, 2, 1.33], [77, 3.33, T], [75, 3.67, T],
  [77, 4, 1], [80, 5, 1], [83, 6, 1.33], [80, 7.33, T], [77, 7.67, T],
  [75, 8, 2], [72, 10, 0.67], [75, 10.67, T], [77, 11, 1],
  [78, 12, 1], [77, 13, 0.67], [75, 13.67, T], [72, 14, 1.33], [69, 15.33, 0.67],
  [70, 16, 0.67], [73, 16.67, T], [77, 17, 1], [80, 18, 1.33], [77, 19.33, T], [73, 19.67, T],
  [75, 20, 1], [79, 21, 1], [84, 22, 1.33], [82, 23.33, T], [79, 23.67, T],
  [80, 24, 2], [78, 26, 1.33], [75, 27.33, T], [72, 27.67, T],
  [73, 28, 1], [77, 29, 1], [76, 30, 1], [75, 31, 1],
];

export function make() {
  // the chords bar by bar: two bars of intro (the verse's last two), two verses, the shout, the amen
  const halves = [...VERSE.slice(4), ...VERSE, ...VERSE, ...SHOUT, ...AMEN];
  const sec = (b) => (b < 2 ? 'intro' : b < 10 ? 'verse' : b < 18 ? 'shout' : 'amen');
  const rhAt = (h, beat) => (halves[h] === VERSE[7] && beat % 2 === 1 ? EB13 : halves[h].rh); // the sus lifts on its second beat

  // piano: the left hand an octave over the bass with a triplet pickup into each change; the right hand a chord on each
  // beat and the last triplet of the beat ringing into the next (the 12/8 pulse), the tune on top
  const piano = [];
  halves.forEach((hv, h) => {
    const b = h >> 1, s = sec(b), at = h * 2;
    const lh = hv.bass + 12;
    if (s === 'intro') {
      // rolled, rubato chords
      piano.push({ p: lh, t: at, d: 1.9, v: 0.5 });
      rhAt(h, 0).forEach((p, i) => piano.push({ p, t: at + 0.08 + i * 0.06, d: 1.8 - i * 0.06, v: 0.42 + i * 0.03 }));
      if (h % 2) rhAt(h, 1).forEach((p, i) => piano.push({ p, t: at + 1 + i * 0.04, d: 0.9, v: 0.4 }));
      return;
    }
    const soft = s === 'shout' ? 0.82 : s === 'amen' ? 0.9 : 1;
    piano.push({ p: lh, t: at, d: 1.25, v: 0.58 * soft }, { p: lh - 12, t: at, d: 1.25, v: 0.4 * soft });
    const nb = halves[h + 1] ? halves[h + 1].bass + 12 : lh;
    if (s !== 'amen' && nb !== lh) piano.push({ p: nb + (nb > lh ? -1 : 1), t: at + 1 + 2 * T, d: T, v: 0.44 * soft });
    else if (s !== 'amen') piano.push({ p: lh + 7, t: at + 1 + T, d: 0.5, v: 0.36 * soft });
    if (s === 'amen' && b === 19) return;
    for (let k = 0; k < 2; k++) {
      const ch = rhAt(h, k);
      for (const p of ch) piano.push({ p, t: at + k, d: 0.6, v: (k ? 0.36 : 0.42) * soft });
      for (const p of ch) piano.push({ p, t: at + k + 2 * T, d: 0.4, v: 0.26 * soft });
    }
  });
  // the amen: the last chord rolled and held
  AMEN[3].rh.forEach((p, i) => piano.push({ p, t: 76 + i * 0.05, d: 3.9 - i * 0.05, v: 0.44 }));
  // the tune in the verses, an octave of weight under the first note of each phrase
  const tune = [...TUNE_A.map(([p, t, d]) => [p, t + 8, d]), ...TUNE_B.map(([p, t, d]) => [p, t + 24, d])];
  for (const [p, t, d] of tune) piano.push({ p, t, d: d * 0.95, v: 0.64 + (t % 4 === 0 ? 0.08 : 0) });
  const pianoG = groove(piano, { seed: 61, vel: 0.06, time: 0.006 });

  // bass: the root on the beat, a triplet walk into each change (the step below or above), held through the amen
  const bass = groove(halves.flatMap((hv, h) => {
    const b = h >> 1, s = sec(b), at = h * 2;
    if (s === 'intro') return [];
    if (s === 'amen') return h === halves.length - 4 ? [{ p: 32, t: at, d: 7.8, v: 0.8 }] : [];
    const out = [{ p: hv.bass, t: at, d: 1.25, v: 0.86 }, { p: hv.bass + (s === 'shout' ? 12 : 7), t: at + 1 + T, d: T, v: 0.5 }];
    const nb = halves[h + 1].bass;
    out.push(nb === hv.bass ? { p: hv.bass + 7, t: at + 1 + 2 * T, d: T, v: 0.6 } : { p: nb + (nb > hv.bass ? -1 : 1), t: at + 1 + 2 * T, d: T, v: 0.62 });
    return out;
  }), { seed: 7, vel: 0.05, time: 0.006 });

  // drums: a cross-stick and the hats on every triplet in the verse; the snare, a crash and the ride in the shout; a
  // roll into the shout and a cymbal over the amen
  const trip = (p, from, n, v, every = 1) => Array.from({ length: n }, (_, i) => ({ p, t: from + i * T, d: 0.15, v: i % 3 ? v * 0.7 : v * (i % 6 ? 0.9 : 1) })).filter((_, i) => i % every === 0);
  const kit = groove(bars(20, (b) => {
    const s = sec(b);
    if (s === 'intro') return b === 1 ? [{ p: 51, t: 3, d: 1, v: 0.35 }, ...trip(42, 3, 3, 0.3)] : [];
    if (s === 'amen') return b === 18 ? [{ p: 36, t: 0, d: 1, v: 0.8 }, { p: 49, t: 0, d: 4, v: 0.6 }, { p: 51, t: 2, d: 1, v: 0.3 }] : [{ p: 49, t: 0, d: 4, v: 0.4 }];
    const out = [{ p: 36, t: 0, d: 0.5, v: 0.9 }, { p: 36, t: 2, d: 0.5, v: 0.78 }, { p: 36, t: 1 + 2 * T, d: 0.3, v: 0.5 }];
    if (s === 'verse') {
      out.push(...trip(42, 0, 12, 0.42), { p: 37, t: 1, d: 0.3, v: 0.62 }, { p: 37, t: 3, d: 0.3, v: 0.66 });
      if (b === 9) out.push(...[2, 2 + T, 2 + 2 * T, 3, 3 + T, 3 + 2 * T].map((t, i) => ({ p: i < 3 ? 38 : 45, t, d: 0.3, v: 0.4 + i * 0.08 })));
    } else {
      out.push(...trip(51, 0, 12, 0.45), { p: 38, t: 1, d: 0.4, v: 0.86 }, { p: 38, t: 3, d: 0.4, v: 0.9 }, { p: 38, t: 3 + 2 * T, d: 0.2, v: 0.3 }, { p: 44, t: 1, d: 0.2, v: 0.4 }, { p: 44, t: 3, d: 0.2, v: 0.4 });
      if (b === 10 || b === 14) out.push({ p: 49, t: 0, d: 3, v: 0.62 });
      if (b === 17) out.push(...[3, 3 + T, 3 + 2 * T].map((t, i) => ({ p: [48, 45, 43][i], t, d: 0.3, v: 0.6 + i * 0.1 })));
    }
    return out;
  }), { seed: 17, push: { 37: 0.01, 38: 0.012 }, vel: 0.08, time: 0.006 });

  // strings: the shout's chords an octave up, swelled; the amen held long
  const strings = halves.flatMap((hv, h) => {
    const b = h >> 1, s = sec(b), at = h * 2;
    if (s !== 'shout' && s !== 'amen') return [];
    if (s === 'amen') return h % 2 ? [] : hv.rh.slice(1).map((p) => ({ p: p + 12, t: at, d: h === halves.length - 2 ? 3.8 : 3.9, v: 0.5 }));
    if (h % 2 && hv.rh.join() === halves[h - 1].rh.join()) return [];
    const long = h % 2 === 0 && hv.rh.join() === halves[h + 1].rh.join();
    return hv.rh.slice(1).map((p) => ({ p: p + 12, t: at, d: long ? 3.95 : 1.95, v: 0.55 }));
  });

  // Claude's organ: soft held chords under the verse (lower, so the piano's tune stays on top), the shout's tune over
  // its own chords, and the amen's plagal chords
  const organ = [];
  halves.forEach((hv, h) => {
    const b = h >> 1, s = sec(b), at = h * 2;
    if (s === 'intro') return;
    if (s === 'verse') { for (const p of hv.rh.slice(0, 3)) organ.push({ p: p - 12, t: at + 0.02, d: 1.95, v: 0.5 }); return; }
    if (s === 'amen') { if (h < halves.length - 1) for (const p of hv.rh) organ.push({ p, t: at, d: h === halves.length - 2 ? 3.9 : 1.95, v: 0.6 }); return; }
    // the shout: the chord stabbed on the beat with the left hand, left to sustain under the line
    for (const p of hv.rh.slice(0, 3)) organ.push({ p: p - 12, t: at, d: 0.9, v: 0.66 }, { p: p - 12, t: at + 1 + T, d: 0.6, v: 0.5 });
  });
  for (const [p, t, d] of SHOUT_TUNE) organ.push({ p, t: t + 40, d: d * 0.96, v: 0.82 });
  const organG = groove(organ, { seed: 41, vel: 0.04, time: 0.006 });

  return demo({
    title: META.title, tempo: META.tempo, key: { root: 'Ab', scale: 'major' }, bars: 20,
    sections: [['Intro', 0, 2], ['Verse', 2, 8], ['Shout', 10, 8], ['Amen', 18, 2]],
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drums', params: { kit: 5, tune: 0, decay: 1, tone: -0.1, drive: 0.1, width: 0.6, room: 0.45 },
        inserts: [fx('core.comp', { threshold: -18, ratio: 3, attack: 12, release: 140 })],
        clips: [clip(0, 80, kit, 'Brushes and backbeat')], gain: 1.5 }),
      track({ name: 'Bass', color: 'var(--c-5)', device: 'core.bassguitar', params: { style: 0, tone: 0.35, pickup: 0.2, sustain: 1.2, mute: 0.1, drive: 0.15 },
        clips: [clip(0, 80, bass, 'Walk')], gain: -3 }),
      track({ name: 'Piano', color: 'var(--c-6)', device: 'core.piano', params: { tone: 0.45, touch: 0.6, decay: 1.2, damper: 0.2, hammer: 0.35, unison: 0.15, width: 0.6, room: 0.35 },
        inserts: [fx('core.eq', { hp: 60, lp: 12000, mid: -1.5, midf: 300, q: 0.8 })],
        clips: [clip(0, 80, pianoG, 'Hymn')], gain: 4, pan: -0.05 }),
      track({ name: 'Strings', color: 'var(--c-7)', device: 'core.strings', params: { attack: 0.6, release: 1.2, bright: 0.45, vibrato: 0.5, ensemble: 0.6, width: 0.7, hall: 0.4 },
        clips: [clip(0, 80, strings, 'Swell')], gain: -4, pan: 0.05 }),
      track({ name: 'Organ', color: 'var(--c-2)', device: 'core.organ', params: { reg: 3, perc: 0, click: 0.4, drive: 0.35, rotor: 1, cab: 0.9, tone: 0.5 },
        inserts: [fx('core.verb', { size: 0.6, decay: 2, mix: 0.12 }, AGENT)],
        clips: [clip(0, 80, organG, 'Shout', AGENT)], gain: -4, pan: 0.1, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -18, ratio: 2, attack: 20, release: 200 }),
      fx('core.limiter', { gain: 4, ceiling: -1 }),
    ] },
  });
}
export default make;
