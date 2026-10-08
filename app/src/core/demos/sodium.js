// @ts-check
// "Sodium": synthwave, 24 bars in F# minor at 104 bpm, named for the orange of motorway lights at night. The house
// played the bed: a machine kit with a big roomy snare on 2 and 4, a bass pumping eighths in octaves, Room Tone pads on
// i-VI-III-VII voiced so every change moves a step or holds, and a sixteenth arpeggio on Patch Bay rising out of the
// intro. Claude played over it: the lead, a detuned saw with a little glide through a dotted-eighth echo, which takes
// the chorus and then answers itself over the breakdown, and its Skylight on the pads.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, grid, groove, demo } from './lib.js';

export const META = {
  id: 'sodium',
  title: 'Sodium',
  genre: 'Synthwave',
  line: 'gated drums, an arpeggio in the headlights, a lead by Claude',
  tempo: 104,
  key: 'F# minor',
};

// i VI III VII: F#m7, Dmaj7, Aadd9, E6, each voice a step from the last
const FSM7 = [57, 61, 64, 66]; // A C# E F#
const DMAJ7 = [57, 61, 62, 66]; // A C# D F#
const AADD9 = [57, 59, 61, 64]; // A B C# E
const E6 = [56, 59, 61, 64]; // G# B C# E
// the breakdown: iv VI VII VII (Bm7, Dmaj7, E6, Esus4), so the loop falls back home to F#m
const BM7 = [57, 59, 62, 66]; // A B D F#
const ESUS = [57, 59, 64, 69]; // A B E A
const LOOP = [FSM7, DMAJ7, AADD9, E6];
const BREAK = [BM7, DMAJ7, E6, ESUS];
const ROOTS = [42, 38, 45, 40]; // F#2 D2 A2 E2
const BREAK_ROOTS = [35, 38, 40, 40]; // B1 D2 E2 E2

export function make() {
  const chordAt = (b) => (b >= 20 ? BREAK[b - 20] : LOOP[b % 4]);
  const rootAt = (b) => (b >= 20 ? BREAK_ROOTS[b - 20] : ROOTS[b % 4]);

  // drums: nothing in the intro but a swelling snare roll into the verse; kick on 1 and 3 with a push before 3, the
  // snare on 2 and 4 in a big room, sixteenth hats with the downbeats leaning; four on the floor in the chorus
  const V = { kick: 'X.......X.x.....', snare: '....X.......X...', hat: 'x-o-x-o-x-o-x-o-' };
  const C = {
    kick: 'X...X...X...X.x.',
    snare: '....X.......X...',
    clap: '....x.......x...',
    hat: 'x-o-x-o-x-o-x-o-',
    open: '..o...o...o...o.',
  };
  const kit = groove(
    bars(24, (b) => {
      if (b < 2) return [];
      if (b === 2) return grid({ kick: 'X...............' });
      if (b === 3) {
        const roll = Array.from({ length: 16 }, (_, i) => ({ p: 38, t: i * 0.25, d: 0.2, v: 0.2 + i * 0.045 }));
        return [{ p: 36, t: 0, d: 0.5, v: 0.9 }, ...roll];
      }
      if (b >= 20) {
        // the breakdown: kick and a soft hat, then toms home
        if (b === 23)
          return grid({
            kick: 'X.......',
            snare: '....x...x.xXXXXX',
            htom: '........x.x.....',
            tom: '..........x.x...',
            ltom: '............x.x.',
          });
        return grid({ kick: 'X.......X.......', hat: '..o...o...o...o.' });
      }
      const g = grid(b >= 12 ? C : V);
      if (b === 4 || b === 12) g.push({ p: 49, t: 0, d: 3, v: 0.7 });
      if (b === 11 || b === 19)
        g.push(...grid({ htom: '............x...', tom: '.............x..', ltom: '..............xx' }));
      return g;
    }),
    { seed: 51, push: { 38: 0.008, 39: 0.012, 42: -0.004 }, vel: 0.08, time: 0.004 },
  );

  // bass: eighths in octaves on the root, the low one leaning; whole notes in the intro and the breakdown
  const bass = groove(
    bars(24, (b) => {
      const r = rootAt(b);
      if (b < 2) return [];
      if (b < 4 || b >= 20)
        return [
          { p: r, t: 0, d: 2.9, v: 0.78 },
          { p: r, t: 3, d: 0.9, v: 0.6 },
        ];
      return Array.from({ length: 8 }, (_, i) => ({
        p: i % 2 ? r + 12 : r,
        t: i * 0.5,
        d: 0.4,
        v: i % 2 ? 0.66 : 0.86,
      }));
    }),
    { seed: 6, vel: 0.05, time: 0.003 },
  );

  // pads: the chord held across each bar, an octave of air on top in the chorus
  const pad = bars(24, (b) => {
    const ch = chordAt(b);
    const out = ch.map((p) => ({ p, t: 0, d: 4, v: 0.55 }));
    if (b >= 12 && b < 20) out.push({ p: ch[3] + 12, t: 0, d: 4, v: 0.42 });
    return out;
  });

  // the arpeggio: up and back through the chord, an octave over the pad, sixteenths with the beat accented
  const arp = groove(
    bars(24, (b) => {
      const ch = chordAt(b).map((p) => p + 12);
      const shape = [ch[0], ch[1], ch[2], ch[3], ch[2] + 12, ch[3], ch[2], ch[1]];
      if (b < 1) return [];
      const lead = b < 2 ? 8 : 16;
      return Array.from({ length: 16 }, (_, i) =>
        i >= 16 - lead
          ? { p: shape[i % 8], t: i * 0.25, d: 0.2, v: (i % 4 === 0 ? 0.78 : i % 2 ? 0.48 : 0.6) * (b >= 20 ? 0.7 : 1) }
          : null,
      ).filter(Boolean);
    }),
    { seed: 12, vel: 0.06, time: 0.002 },
  );

  // Claude's lead: the chorus hook (twice, the second climbing to F#), then an answer an octave down over the breakdown
  const hook = [
    [73, 0, 1.5],
    [71, 1.5, 0.5],
    [69, 2, 1.5],
    [66, 3.5, 0.5],
    [69, 4, 0.75],
    [71, 4.75, 0.75],
    [73, 5.5, 2.5],
    [76, 8, 1],
    [73, 9, 0.5],
    [71, 9.5, 1.5],
    [69, 11, 0.5],
    [71, 11.5, 0.5],
    [68, 12, 2],
    [64, 14, 0.5],
    [66, 14.5, 0.5],
    [68, 15, 1],
    [73, 16, 1.5],
    [71, 17.5, 0.5],
    [69, 18, 1.5],
    [66, 19.5, 0.5],
    [69, 20, 0.75],
    [71, 20.75, 0.75],
    [73, 21.5, 1.5],
    [78, 23, 1],
    [76, 24, 1.5],
    [78, 25.5, 0.5],
    [76, 26, 1],
    [73, 27, 1],
    [71, 28, 1.5],
    [68, 29.5, 0.5],
    [71, 30, 2],
  ];
  const answer = [
    [66, 32, 1.5],
    [69, 33.5, 0.5],
    [71, 34, 2],
    [69, 36, 1.5],
    [66, 37.5, 0.5],
    [64, 38, 2],
    [68, 40, 1],
    [71, 41, 1],
    [73, 42, 2],
    [71, 44, 3],
    [68, 47, 1],
  ];
  const lead = groove(
    [...hook, ...answer].map(([p, t, d], i) => ({
      p,
      t,
      d: d - 0.04,
      v: t >= 32 ? 0.72 : 0.76 + (i % 4 === 0 ? 0.1 : 0),
    })),
    { seed: 61, vel: 0.05, time: 0.006 },
  );

  return demo({
    title: META.title,
    tempo: META.tempo,
    key: { root: 'F#', scale: 'minor' },
    bars: 24,
    sections: [
      ['Intro', 0, 4],
      ['Verse', 4, 8],
      ['Chorus', 12, 8],
      ['Breakdown', 20, 4],
    ],
    tracks: [
      track({
        name: 'Drums',
        color: 'var(--c-1)',
        device: 'core.drums',
        params: { kit: 1, tune: -2, decay: 1.3, tone: 0.1, drive: 0.3, width: 0.75, room: 0.55 },
        inserts: [fx('core.comp', { threshold: -16, ratio: 3, attack: 10, release: 120 })],
        clips: [clip(0, 96, kit, 'Gated kit')],
        gain: -1.5,
      }),
      track({
        name: 'Bass',
        color: 'var(--c-5)',
        device: 'core.bass',
        params: {
          wave: 0.1,
          sub: 0.45,
          cutoff: 900,
          reso: 0.25,
          envamt: 0.5,
          fdecay: 0.15,
          drive: 0.35,
          glide: 0,
          release: 0.05,
          mode: 1,
        },
        inserts: [fx('core.eq', { hp: 30, low: 1, lowf: 80, mid: -2, midf: 300, q: 1 })],
        clips: [clip(0, 96, bass, 'Octaves')],
        gain: -5,
      }),
      track({
        name: 'Pad',
        color: 'var(--c-7)',
        device: 'core.pad',
        params: { tone: 2600, detune: 18, motion: 0.4, attack: 0.6, release: 2, chorus: 0.7, space: 0.4 },
        inserts: [fx('claude.skylight', { shimmer: 0.25, decay: 4, tone: 0.5, mix: 0.2 }, AGENT)],
        clips: [clip(0, 96, pad, 'Bed')],
        gain: -5,
      }),
      track({
        name: 'Arp',
        color: 'var(--c-3)',
        device: 'core.poly',
        params: {
          wave: 1,
          detune: 5,
          sub: 0,
          cutoff: 1800,
          reso: 0.3,
          envamt: 0.45,
          fdecay: 0.12,
          attack: 0.002,
          decay: 0.18,
          sustain: 0.25,
          release: 0.1,
        },
        inserts: [
          fx('core.delay', { div: 7, mode: 1, feedback: 0.3, tone: 3500, mix: 0.2 }),
          fx('core.filter', { mode: 0, cutoff: 3500, reso: 0.2, sync: 14, lfo: 1.2, mix: 1 }),
        ],
        clips: [clip(0, 96, arp, 'Sixteenths')],
        gain: 2.5,
        pan: -0.15,
      }),
      track({
        name: 'Lead',
        color: 'var(--c-2)',
        device: 'core.poly',
        params: {
          wave: 0,
          detune: 14,
          sub: 0.15,
          spread: 0.5,
          unison: 0.4,
          cutoff: 3000,
          reso: 0.15,
          envamt: 0.25,
          fdecay: 0.4,
          attack: 0.01,
          decay: 0.5,
          sustain: 0.75,
          release: 0.3,
          glide: 40,
        },
        inserts: [
          fx('core.delay', { div: 7, mode: 1, feedback: 0.38, tone: 4000, mix: 0.24 }, AGENT),
          fx('core.verb', { size: 0.6, decay: 2.2, mix: 0.18 }, AGENT),
        ],
        clips: [clip(48, 48, lead, 'Hook', AGENT)],
        gain: 1.5,
        pan: 0.1,
        by: AGENT,
      }),
    ],
    master: {
      gain: 0,
      inserts: [
        fx('core.comp', { threshold: -18, ratio: 2, attack: 20, release: 200 }),
        fx('core.limiter', { gain: 3, ceiling: -1 }),
      ],
    },
  });
}
export default make;
