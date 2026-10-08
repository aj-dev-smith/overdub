// @ts-check
// "Turndown": French house, 32 bars in B minor at 124 bpm. A disco loop on the Suitcase's reeds (the chords and the
// root inside it, chopped in sixteenths, Bm9 Gmaj7 Em7 F#m7) through Keyhole, low-pass, and the song is that filter:
// shut in the intro, opening slowly through the build, wide open on the drop, slammed shut for the break and swept back
// up, closing again over the outro. The loop ducks on every kick (its fader, drawn as a lane), the 909 four to the
// floor, a disco bass in octaves. The house played all of that and drew those two lanes. Claude played over it: the
// riff in the second drop, a detuned saw with a little glide that opens as it goes (its cutoff lane), and the
// resonance on the loop's filter through the break, so the sweep back up squelches.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { HOUSE, AGENT, clip, fx, track, bars, grid, groove, demo, automate } from './lib.js';

export const META = {
  id: 'turndown',
  title: 'Turndown',
  genre: 'French house',
  line: 'a disco loop through a filter that opens and shuts, a riff by Claude',
  tempo: 124,
  key: 'B minor',
};

// Bm9 Gmaj7 Em7 F#m7, rootless an octave over middle C, each voice a step from the last (the loop's root sits under)
const BM9 = [74, 78, 81, 85]; // D F# A C#
const GMAJ7 = [74, 78, 79, 83]; // D F# G B
const EM7 = [74, 76, 79, 83]; // D E G B
const FSM7 = [73, 76, 78, 81]; // C# E F# A
const CHORDS = [BM9, GMAJ7, EM7, FSM7];
const ROOTS = [35, 31, 40, 42]; // B1 G1 E2 F#2

const LOOP_DB = -3; // the loop's fader: the pump ducks it from here
const BARS = 32;

export function make() {
  // drums: the kick alone, then hats, the clap from the build with a roll into the drop; no kick in the break
  const kit = groove(
    bars(BARS, (b) => {
      const r = { kick: 'X...X...X...X...' };
      if (b >= 2) r.open = '..o...o...o...o.';
      if (b >= 4 && b < 16) {
        r.clap = '....X.......X...';
        r.hat = 'x-o-x-o-x-o-x-o-';
      }
      if (b >= 8 && b < 16) r.open = '..x...x...x...x.';
      if (b === 7) r.clap = '....X...x.x.XxXX';
      if (b === 15) r.clap = '....X.......X.xX';
      if (b >= 16 && b < 20) {
        delete r.kick;
        r.hat = 'x-o-x-o-x-o-x-o-';
        r.clap = b === 19 ? 'o.o.x.x.xxxxXXXX' : '............X...';
      }
      if (b >= 20 && b < 30) {
        r.clap = '....X.......X...';
        r.hat = 'x-o-x-o-x-o-x-o-';
        r.open = '..x...x...x...x.';
        r.tamb = '..o...o...o...o.';
      }
      if (b === 27) r.clap = '....X.......XxXX';
      if (b >= 30) {
        r.hat = b === 31 ? 'x-o-x-o-........' : 'x-o-x-o-x-o-x-o-';
        if (b === 31) {
          r.kick = 'X...X...........';
          delete r.open;
        }
      }
      const g = grid(r);
      if (b === 8 || b === 20) g.push({ p: 49, t: 0, d: 2, v: 0.7 });
      return g;
    }),
    { seed: 124, swing: 0.53, push: { 39: 0.006, 54: -0.004 }, vel: 0.1, time: 0.004 },
  );

  // bass: disco octaves with a sixteenth kick-back, from the drop; out in the break, back for the second drop
  const bass = groove(
    bars(BARS, (b) => {
      if (b < 8 || (b >= 16 && b < 20) || b >= 30) return [];
      const r = ROOTS[b % 4];
      const out = [
        { p: r, t: 0, d: 0.4, v: 0.86 },
        { p: r + 12, t: 0.5, d: 0.25, v: 0.7 },
        { p: r, t: 0.75, d: 0.2, v: 0.6 },
        { p: r + 12, t: 1.5, d: 0.3, v: 0.72 },
        { p: r, t: 2, d: 0.4, v: 0.84 },
        { p: r + 12, t: 2.5, d: 0.25, v: 0.7 },
        { p: r + 7, t: 3, d: 0.3, v: 0.66 },
        { p: r + 12, t: 3.5, d: 0.3, v: 0.74 },
      ];
      return out;
    }),
    { seed: 9, swing: 0.53, vel: 0.05, time: 0.003 },
  );

  // the loop: the chord in a two-bar sixteenth chop, its root underneath on the long hits, every bar of the song
  const CHOP = [
    [
      [0, 0.5, 0.86],
      [0.75, 0.25, 0.6],
      [1.5, 0.5, 0.76],
      [2.25, 0.25, 0.56],
      [2.5, 0.75, 0.8],
      [3.5, 0.25, 0.6],
    ],
    [
      [0, 0.5, 0.86],
      [0.75, 0.25, 0.6],
      [1.5, 0.25, 0.7],
      [2, 0.5, 0.76],
      [2.75, 0.5, 0.8],
      [3.5, 0.5, 0.64],
    ],
  ];
  const loop = groove(
    bars(BARS, (b) => {
      const ch = CHORDS[b % 4],
        root = ROOTS[b % 4] + 24;
      const hits = b === 31 ? CHOP[1].slice(0, 1) : CHOP[b % 2];
      const out = [];
      for (const [t, d, v] of hits) {
        for (const p of ch) out.push({ p, t, d, v });
        if (d >= 0.5) out.push({ p: root, t, d, v: v * 0.9 });
      }
      return out;
    }),
    { seed: 77, swing: 0.53, vel: 0.06, time: 0.003 },
  );

  // Claude's riff: four bars, one per chord, answered by a second pass that climbs out of the F#m7
  const pass = [
    [78, 0, 0.4],
    [78, 0.75, 0.2],
    [81, 1.5, 0.5],
    [83, 2.25, 0.5],
    [81, 3, 0.25],
    [78, 3.5, 0.5],
    [74, 4, 0.4],
    [74, 4.75, 0.2],
    [78, 5.5, 0.5],
    [79, 6.25, 0.5],
    [78, 7, 0.25],
    [74, 7.5, 0.5],
    [76, 8, 0.4],
    [76, 8.75, 0.2],
    [79, 9.5, 0.5],
    [83, 10.25, 0.6],
    [81, 11, 0.25],
    [79, 11.5, 0.5],
  ];
  const end1 = [
    [78, 12, 0.7],
    [76, 12.75, 0.25],
    [73, 13.5, 0.5],
    [76, 14.25, 0.5],
    [78, 15, 0.9],
  ];
  const end2 = [
    [81, 12, 0.7],
    [78, 12.75, 0.25],
    [76, 13.5, 0.5],
    [73, 14.25, 0.5],
    [71, 15, 0.45],
    [73, 15.5, 0.45],
  ];
  const riffNotes = [
    ...pass,
    ...end1,
    ...pass.map(([p, t, d]) => [p, t + 16, d]),
    ...end2.map(([p, t, d]) => [p, t + 16, d]),
  ];
  const riff = groove(
    riffNotes.map(([p, t, d], i) => ({ p, t, d, v: (t % 4 === 0 ? 0.86 : 0.72) + (i % 5 === 0 ? 0.06 : 0) })),
    { seed: 21, swing: 0.53, vel: 0.05, time: 0.004 },
  );

  const p = demo({
    title: META.title,
    tempo: META.tempo,
    key: { root: 'B', scale: 'minor' },
    bars: BARS,
    sections: [
      ['Intro', 0, 4],
      ['Build', 4, 4],
      ['Drop', 8, 8],
      ['Break', 16, 4],
      ['Drop 2', 20, 8],
      ['Outro', 28, 4],
    ],
    tracks: [
      track({
        name: 'Drums',
        color: 'var(--c-1)',
        device: 'core.drums',
        params: { kit: 4, tune: 0, decay: 0.9, tone: 0.15, drive: 0.4, width: 0.6, room: 0.15 },
        inserts: [fx('core.comp', { threshold: -18, ratio: 4, attack: 8, release: 90 })],
        clips: [clip(0, BARS * 4, kit, 'Four to the floor')],
        gain: -0.5,
      }),
      track({
        name: 'Bass',
        color: 'var(--c-5)',
        device: 'core.bass',
        params: {
          wave: 0.55,
          sub: 0.4,
          cutoff: 700,
          reso: 0.3,
          envamt: 0.5,
          fdecay: 0.12,
          drive: 0.35,
          glide: 0,
          release: 0.04,
          mode: 1,
        },
        inserts: [fx('core.eq', { hp: 32, low: -1, lowf: 70 })],
        clips: [clip(0, BARS * 4, bass, 'Octaves')],
        gain: -3,
      }),
      track({
        name: 'Loop',
        color: 'var(--c-6)',
        device: 'core.ep',
        params: { voice: 1, voicing: 0.6, bright: 0.7, decay: 0.8, drive: 0.45, trem: 0, release: 0.08 },
        inserts: [
          fx('core.filter', {
            mode: 0,
            cutoff: 14000,
            reso: 0.3,
            sync: 0,
            rate: 0.5,
            lfo: 0,
            env: 0,
            drive: 0.3,
            mix: 1,
          }),
          fx('core.verb', { size: 0.3, decay: 0.9, mix: 0.1 }),
        ],
        clips: [clip(0, BARS * 4, loop, 'Disco loop')],
        gain: LOOP_DB,
      }),
      track({
        name: 'Riff',
        color: 'var(--c-2)',
        device: 'core.poly',
        params: {
          wave: 0,
          detune: 12,
          sub: 0.1,
          spread: 0.6,
          unison: 0.4,
          cutoff: 3000,
          reso: 0.2,
          envamt: 0.3,
          fdecay: 0.25,
          attack: 0.003,
          decay: 0.4,
          sustain: 0.6,
          release: 0.12,
          glide: 30,
        },
        inserts: [
          fx('core.delay', { div: 8, mode: 1, feedback: 0.3, tone: 4000, mix: 0.18 }, AGENT),
          fx('core.verb', { size: 0.45, decay: 1.6, mix: 0.12 }, AGENT),
        ],
        clips: [clip(80, 32, riff, 'Riff', AGENT)],
        gain: 5,
        pan: 0.1,
        by: AGENT,
      }),
    ],
    master: {
      gain: 0,
      inserts: [
        fx('core.comp', { threshold: -16, ratio: 2, attack: 15, release: 150 }),
        fx('core.limiter', { gain: 4.3, ceiling: -1 }),
      ],
    },
  });

  // The house's lanes: the filter (shut, creeping, opening into the drop; slammed shut for the break and swept back
  // up; closing over the outro) and the pump (the loop ducks on every kick and breathes back before the next).
  const pump = [];
  for (let beat = 0; beat < 120; beat++) {
    if (beat >= 64 && beat < 80) continue; // the break: no kick, no pump
    const depth = beat < 32 ? 5 : 7;
    pump.push(`${beat}:${LOOP_DB}`, `${beat + 0.04}:${LOOP_DB - depth}~-0.5`, `${beat + 0.62}:${LOOP_DB}`);
  }
  automate(p, HOUSE, [
    {
      track: 'Loop',
      insert: 'core.filter',
      param: 'cutoff',
      points:
        '0:200~0.3 16:420~0.55 31.5:4200 32:14000 64:14000 64:420 70:420~0.6 79.5:7000 80:14000 112:14000~-0.3 128:240',
    },
    { track: 'Loop', param: 'gain', points: pump.join(' ') },
  ]);
  // Claude's: the resonance up through the break (the sweep squelches), and its riff opening over the second drop
  automate(p, AGENT, [
    { track: 'Loop', insert: 'core.filter', param: 'reso', points: '64:0.3 66:0.55~0.4 79.5:0.66 80:0.3' },
    { track: 'Riff', insert: 'instrument', param: 'cutoff', points: '80:900~0.4 96:5200 108:5200 112:2600' },
  ]);
  return p;
}
export default make;
