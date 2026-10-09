// @ts-check
// "Halation": shoegaze, 16 bars in E major at 78 bpm. Halation is the glow film gets round a bright light. Two guitars
// on the ported rigs, played from a plucked-string instrument (no audio needed): the wall (the "Wall of Kelp" rig:
// fuzz into a top-boost amp, chorus, dark delay, a sea-sized reverb) strumming open chords that keep E and B ringing
// on top, and a clean arpeggio on the "Trench Swells" rig. Room Tone pads under them, a round bass, a washy kit. The
// house played all of that. Claude sang over it: a wordless top line on its choir (claude.choir-loft) through its
// Skylight, low in the wall the way the genre buries a voice, and leading the last four bars.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, grid, groove, demo } from './lib.js';

export const META = { id: 'halation', title: 'Halation', genre: 'Shoegaze', line: 'a fuzz wall on the guitar rigs, a choir by Claude', tempo: 78, key: 'E major' };

// open-string voicings: the top two strings stay on E4 and B4 the whole way round, the way an open tuning rings
const E = [40, 47, 52, 56, 64, 71];     // E B E G# E B         E
const CSM = [37, 44, 49, 52, 64, 71];   // C# G# C# E E B       C#m7
const AM = [33, 40, 49, 52, 64, 71];    // A E C# E E B         Aadd9
const BS = [35, 42, 47, 51, 64, 71];    // B F# B D# E B        Badd11
const CHORDS = [E, CSM, AM, BS];
// the arpeggio's four notes over each (with the colour the wall leaves out: E's major seventh, B's fifth)
const ARPS = [[64, 68, 75, 71], [61, 64, 71, 68], [61, 64, 71, 69], [63, 66, 75, 71]];
const ROOTS = [40, 37, 33, 35];      // E2 C#2 A1 B1

export function make() {
  // the wall: down strums on the beat, lighter up strums between, every note left to ring into the next
  const STRUM = 0.018;
  const strum = (voicing, t, d, v, up) => {
    const vs = up ? [...voicing].reverse().slice(0, 4) : voicing;
    return vs.map((p, i) => ({ p, t: t + i * STRUM, d: d - i * STRUM, v: v * (up ? 0.7 : 1) * (1 - i * 0.03) }));
  };
  const wallBar = (b) => {
    const ch = CHORDS[b % 4];
    const pat = [[0, 1, 0.82, 0], [1, 0.5, 0.62, 0], [1.5, 1, 0.6, 1], [2.5, 0.5, 0.58, 1], [3, 0.5, 0.74, 0], [3.5, 0.5, 0.56, 1]];
    return pat.flatMap(([t, d, v, up]) => strum(ch, t, d + 0.25, v, up));
  };
  const wall = groove(bars(8, (b) => wallBar(b + 4)), { seed: 5, vel: 0.08, time: 0.008 });

  // the arpeggio: eighths rolling over the top of each chord, rung long so they bloom into the delay
  const arpBar = (b) => {
    const a = ARPS[b % 4];
    return [0, 1, 2, 3, 0, 1, 2, 3].map((k, i) => ({ p: a[k], t: i * 0.5, d: 1.25, v: (i % 2 ? 0.5 : 0.66) + (i === 0 ? 0.1 : 0) }));
  };
  const glide = groove([...bars(4, arpBar), ...bars(4, (b) => arpBar(b + 12)).map((n) => ({ ...n, t: n.t + 48 }))], { seed: 9, vel: 0.1, time: 0.01 });

  // pads: the chord without its bass, held across each bar
  const pad = bars(16, (b) => CHORDS[b % 4].slice(2).map((p) => ({ p, t: 0, d: 4, v: 0.5 })));

  // bass: whole notes in the haze, driving eighths on the root in the wall, with the kicks leaning on 1 and the and of 2
  const bass = bars(16, (b) => {
    const r = ROOTS[b % 4];
    if (b < 4 || b >= 12) return [{ p: r, t: 0, d: 3.8, v: 0.7 }];
    return Array.from({ length: 8 }, (_, i) => ({ p: r, t: i * 0.5, d: 0.42, v: [0.86, 0.6, 0.66, 0.78, 0.8, 0.6, 0.66, 0.62][i] }));
  });
  const bassG = groove(bass, { seed: 4, vel: 0.05, time: 0.006 });

  // the kit: ride and snare under the wall; a crash at the top of it and a fill into the last four bars
  const K = { kick: 'X.....x.X.......', snare: '....X.......X...', ride: 'x.o.x.o.x.o.x.o.' };
  const F = { kick: 'X.....x.X.......', snare: '....X.......XoXX', ride: 'x.o.x.o.x.o.....', tom: '..............x.' };
  const kit = groove(bars(16, (b) => {
    if (b < 3) return [];
    if (b === 3) return grid({ ride: '........o.o.o.x.', snare: '............o.xX' });
    if (b >= 12) return grid({ ride: b === 15 ? 'x...............' : 'o...o...o...o...' });
    const g = grid(b === 11 ? F : K);
    if (b === 4 || b === 8) g.push({ p: 49, t: 0, d: 2, v: 0.75 });
    return g;
  }), { seed: 13, push: { 38: 0.012 }, vel: 0.1, time: 0.008 });

  // Claude's top line: long vowels that climb a third the second time round, then lead the afterglow
  const choir = [
    [68, 0, 3], [66, 3, 1], [64, 4, 2], [68, 6, 2], [71, 8, 3], [69, 11, 1], [68, 12, 2], [66, 14, 2],
    [71, 16, 3], [68, 19, 1], [68, 20, 2], [71, 22, 2], [76, 24, 3], [73, 27, 1], [75, 28, 2], [78, 30, 2],
    [76, 32, 3], [75, 35, 1], [73, 36, 4], [69, 40, 2], [68, 42, 2], [66, 44, 2], [71, 46, 2],
  ].map(([p, t, d], i) => ({ p, t, d: d - 0.1, v: 0.62 + ((i * 7) % 5) * 0.03 }));

  return demo({
    title: META.title, tempo: META.tempo, key: { root: 'E', scale: 'major' }, bars: 16,
    sections: [['Haze', 0, 4], ['Wall', 4, 8], ['Afterglow', 12, 4]],
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drums', params: { kit: 0, decay: 1.2, tone: -0.2, drive: 0.2, width: 0.7, room: 0.6 },
        inserts: [fx('core.comp', { threshold: -18, ratio: 3, attack: 15, release: 160 })],
        clips: [clip(0, 64, kit, 'Washy kit')], gain: -1.5 }),
      track({ name: 'Bass', color: 'var(--c-5)', device: 'core.bass', params: { wave: 0.3, sub: 0.5, cutoff: 700, reso: 0.15, envamt: 0.3, drive: 0.4, glide: 30, release: 0.1 },
        clips: [clip(0, 64, bassG, 'Root pulse')], gain: -3 }),
      track({ name: 'Pad', color: 'var(--c-7)', device: 'core.pad', params: { tone: 1800, detune: 16, motion: 0.45, attack: 1.4, release: 2.5, chorus: 0.6, space: 0.5 },
        clips: [clip(0, 64, pad, 'Bed')], gain: -5 }),
      track({ name: 'Wall', color: 'var(--c-3)', device: 'core.pluck', params: { tone: 0.6, decay: 6, pick: 0.2, body: 0.6, mute: 0.6, spread: 0.6 },
        inserts: [
          fx('pedal.fuzz', { sustain: 6, tone: 6, level: 5 }), fx('amp.jangle', { gain: 4, bass: 5, mid: 5, treble: 5, presence: 5, level: 9 }),
          fx('pedal.chorus', { rate: 2, depth: 7, mix: 5 }), fx('pedal.delay', { time: 3, fb: 5, mix: 3 }), fx('pedal.verb', { decay: 9, tone: 4, mix: 7 }),
        ],
        clips: [clip(16, 32, wall, 'Strum')], gain: 0, pan: -0.2 }),
      track({ name: 'Glide', color: 'var(--c-4)', device: 'core.pluck', params: { tone: 0.7, decay: 4, pick: 0.15, body: 0.4, spread: 0.7 },
        inserts: [
          fx('amp.clean', { gain: 3, bass: 4.5, mid: 5, treble: 5.5, presence: 5, level: 9.5 }), fx('pedal.chorus', { rate: 1.5, depth: 5, mix: 4 }),
          fx('pedal.delay', { time: 4, fb: 6, mix: 5 }), fx('pedal.verb', { decay: 10, tone: 4, mix: 8 }),
        ],
        clips: [clip(0, 64, glide, 'Arpeggio')], gain: -2, pan: 0.25 }),
      track({ name: 'Choir', color: 'var(--c-2)', device: 'claude.choir-loft', params: { vowel: 0.3, singers: 0.6, breath: 0.35, attack: 0.5, release: 1.6, space: 0.3 },
        inserts: [fx('claude.skylight', { shimmer: 0.35, decay: 5, tone: 0.5, mix: 0.3 }, AGENT)],
        clips: [clip(16, 48, choir, 'Ooh', AGENT)], gain: -4, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -18, ratio: 2, attack: 25, release: 250 }),
      fx('core.limiter', { gain: 3.5, ceiling: -1 }),
    ] },
  });
}
export default make;
