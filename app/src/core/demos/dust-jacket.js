// "Dust Jacket": 90s boom bap, 16 bars in D minor at 90 bpm. An electric piano loop played like a record you'd
// sample (rootless ninth voicings, chopped hits, run through a dusty record and a little bit-crush), a lazy sampler
// swing on the kit with the snare laid back, and an upright-ish bass that lands on the kicks and walks into each
// chord. The house played all of that. Claude played over it: vibes on its marimba (claude.biscuit-tin) answering the
// loop in the hook, and Leading Edge on the kit for more snap.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, grid, groove, chordHits, demo } from './lib.js';

export const META = { id: 'dust-jacket', title: 'Dust Jacket', genre: 'Boom bap', line: 'swung drums, a dusty electric piano loop, vibes by Claude', tempo: 90, key: 'D minor' };

// rootless voicings, voice-led: every note moves a step or holds
const DM9 = [53, 57, 60, 64];   // F A C E      Dm9
const BBM9 = [50, 53, 57, 60];  // D F A C      Bbmaj9
const GM9 = [53, 57, 58, 62];   // F A Bb D     Gm9
const A7S = [52, 55, 57, 62];   // E G A D      A7sus4
const CHORDS = [DM9, BBM9, GM9, A7S];
const ROOTS = [38, 34, 31, 33]; // D2 Bb1 G1 A1
const APPROACH = [36, 33, 34, 36]; // into the next root: C2 -> Bb, A1 -> G, Bb1 -> A, C2 -> D

export function make() {
  const SW = 0.58; // where the off 16th lands in its 8th: the lazy swing of an old sampler

  // the loop: four chopped hits a bar, the second hit an anticipation on the swung 16th, the top voice a hair louder
  const loopBar = (b) => {
    const ch = CHORDS[b % 4];
    const hits = b % 2 ? [[0, 1.4, 0.66], [1.75, 0.45, 0.42], [2.5, 0.7, 0.56], [3.25, 0.6, 0.4]] : [[0, 1.4, 0.7], [1.75, 0.45, 0.45], [2.5, 1.3, 0.6]];
    return chordHits(ch, hits, { strum: 0.012 }).map((n) => (n.p === ch[3] ? { ...n, v: Math.min(1, n.v + 0.08) } : n));
  };
  const keys = groove(bars(16, loopBar), { seed: 11, swing: SW, vel: 0.07, time: 0.006 });

  // the kit: boom (1, the and of 2, the and of 3), bap (2 and 4, laid back), the hats leaning on the downbeats
  const A = { kick: 'X.....x...x.....', snare: '....X.......X...', hat: 'x.o.x.o.x.o.x.o.' };
  const B = { kick: 'X.........x..x..', snare: '....X.......X..o', hat: 'x.o.x.o.x.o.x.oo' };
  const T = { kick: 'X.....x...x..x..', snare: '....X..o....X.o.', hat: 'x.o.x.o.x.o.x...', open: '..............x.' };
  const intro = { hat: 'o...o.-.o...o.-.', rim: '................' };
  const kit = (b) => {
    if (b < 2) return [];
    if (b < 4) return grid(b === 3 ? { ...intro, rim: '....o.......o.o.' } : intro);
    const g = grid((b % 4) === 3 ? T : b % 2 ? B : A);
    if (b === 4 || b === 12) g.push({ p: 49, t: 0, d: 2, v: 0.62 });
    return g;
  };
  const drums = groove(bars(16, kit), { seed: 7, swing: SW, push: { 38: 0.022, 37: 0.015, 42: -0.004, 46: -0.004 }, vel: 0.1, time: 0.006 });

  // bass on the kicks: the root with the boom, again with the and of 3, a step into the next chord on the last 8th
  const bassBar = (b) => {
    const r = ROOTS[b % 4], a = APPROACH[b % 4];
    return b % 2 === 0
      ? [{ p: r, t: 0, d: 1.2, v: 0.86 }, { p: r, t: 1.5, d: 0.4, v: 0.66 }, { p: r, t: 2.5, d: 0.75, v: 0.8 }, { p: a, t: 3.5, d: 0.45, v: 0.64 }]
      : [{ p: r, t: 0, d: 1.6, v: 0.86 }, { p: r, t: 2.5, d: 0.6, v: 0.78 }, { p: r + 12, t: 3.25, d: 0.25, v: 0.6 }, { p: a, t: 3.75, d: 0.25, v: 0.62 }];
  };
  const bass = groove(bars(12, (b) => bassBar(b + 4)), { seed: 3, swing: SW, push: {}, vel: 0.05, time: 0.005 });

  // Claude's vibes over the hook: minor pentatonic around the loop's top voice, answering it in the gaps
  const vibes = groove([
    { p: 69, t: 0.5, d: 0.5, v: 0.62 }, { p: 72, t: 1, d: 0.5, v: 0.7 }, { p: 74, t: 1.5, d: 1.2, v: 0.8 }, { p: 77, t: 3, d: 0.5, v: 0.66 }, { p: 76, t: 3.5, d: 0.5, v: 0.6 },
    { p: 74, t: 4, d: 1.5, v: 0.78 }, { p: 72, t: 5.75, d: 0.25, v: 0.52 }, { p: 69, t: 6, d: 1.5, v: 0.66 },
    { p: 70, t: 8.5, d: 0.5, v: 0.62 }, { p: 74, t: 9, d: 0.5, v: 0.7 }, { p: 77, t: 9.5, d: 1, v: 0.8 }, { p: 76, t: 10.5, d: 0.5, v: 0.62 }, { p: 74, t: 11, d: 1, v: 0.7 },
    { p: 76, t: 12, d: 1, v: 0.76 }, { p: 74, t: 13, d: 0.5, v: 0.6 }, { p: 69, t: 13.5, d: 2.4, v: 0.7 },
  ], { seed: 21, swing: SW, vel: 0.05, time: 0.01 });

  return demo({
    title: META.title, tempo: META.tempo, key: { root: 'D', scale: 'minor' }, bars: 16,
    sections: [['Intro', 0, 4], ['Verse', 4, 8], ['Hook', 12, 4]],
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drums', params: { kit: 2, tune: -1, decay: 0.9, tone: -0.15, drive: 0.35, width: 0.45, room: 0.18 },
        inserts: [fx('claude.leading-edge', { attack: 35, sustain: -20, output: 0 }, AGENT), fx('core.comp', { threshold: -16, ratio: 3, attack: 8, release: 120 })],
        clips: [clip(0, 64, drums, 'Swung kit')], gain: 2 }),
      track({ name: 'Bass', color: 'var(--c-5)', device: 'core.bass', params: { wave: 0.08, sub: 0.7, cutoff: 420, reso: 0.15, envamt: 0.3, fdecay: 0.2, drive: 0.3, glide: 25, release: 0.08 },
        inserts: [fx('core.eq', { hp: 32, low: 1.5, lowf: 90, mid: -2, midf: 320, q: 1 })],
        clips: [clip(16, 48, bass, 'Upright walk')], gain: -3 }),
      track({ name: 'Keys loop', color: 'var(--c-6)', device: 'core.keys', params: { voice: 0, bright: 0.58, bell: 0.35, decay: 1.4, release: 0.25, trem: 0.25, rate: 3.6 },
        inserts: [fx('claude.charity-shop', { dust: 0.45, wear: 0.45, warp: 0.25, mix: 1 }), fx('core.crush', { bits: 11, rate: 20000, smooth: 0.5, mix: 0.45 }), fx('core.eq', { hp: 190, lp: 9000, mid: 2.5, midf: 1500, q: 0.8 })],
        clips: [clip(0, 64, keys, 'The loop')], gain: -1.5, pan: -0.08 }),
      track({ name: 'Vibes', color: 'var(--c-2)', device: 'claude.biscuit-tin', params: { sound: 0, mallet: 0.7, decay: 2.4, damp: 0.3, width: 0.6 },
        inserts: [fx('core.delay', { div: 7, mode: 1, feedback: 0.28, tone: 3800, mix: 0.18 }, AGENT), fx('core.verb', { size: 0.4, decay: 1.6, mix: 0.18 }, AGENT)],
        clips: [clip(48, 16, vibes, 'Answer', AGENT)], gain: 3.5, pan: 0.18, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -18, ratio: 2, attack: 20, release: 200 }),
      fx('core.limiter', { gain: 4.5, ceiling: -1 }),
    ] },
  });
}
export default make;
