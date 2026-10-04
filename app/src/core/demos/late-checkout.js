// "Late Checkout": neo-soul, 24 bars in Eb major at 84 bpm. An electric piano on IV-iii-ii-V (Abmaj9, Gm9, Fm9,
// Bb13) in rootless voicings that fall a step at a time, the chords pushed ahead of the barline; a kit on the dusty
// sampler played drunk the way the genre likes it (the kick early, the snare late, swung sixteenths, ghost notes); a
// bass that slides into each root. A four-bar change (Cm9, Fm9, Dbmaj9, Bb9sus4) before the last eight. The house played
// all of that. Claude played over it: the lead, a glide synth through its Say Ahh so it talks like a talk box.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, grid, groove, chordHits, demo } from './lib.js';

export const META = { id: 'late-checkout', title: 'Late Checkout', genre: 'Neo-soul', line: 'drunk drums, ninth chords on the electric piano, a talk-box lead by Claude', tempo: 84, key: 'Eb major' };

// rootless, each a step below the last: G C Eb Bb | F Bb D A | Eb Ab C G | D Ab C G
const ABMAJ9 = [55, 60, 63, 70];
const GM9 = [53, 58, 62, 69];
const FM9 = [51, 56, 60, 67];
const BB13 = [50, 56, 60, 67];
// the change: Cm9 Fm9 Dbmaj9 Bb9sus4, a step or a hold each time
const CM9 = [51, 58, 62, 67];    // Eb Bb D G
const DBMAJ9 = [53, 56, 60, 63]; // F Ab C Eb
const BB9SUS = [51, 56, 60, 65]; // Eb Ab C F
const LOOP = [ABMAJ9, GM9, FM9, BB13];
const CHANGE = [CM9, FM9, DBMAJ9, BB9SUS];
const ROOTS = [44, 43, 41, 34];        // Ab2 G2 F2 Bb1
const CHANGE_ROOTS = [36, 41, 37, 34]; // C2 F2 Db2 Bb1

export function make() {
  const SW = 0.6; // a heavy, late swing on the sixteenths
  const inChange = (b) => b >= 12 && b < 16;
  const chordAt = (b) => (inChange(b) ? CHANGE[b - 12] : LOOP[b % 4]);
  const rootAt = (b) => (inChange(b) ? CHANGE_ROOTS[b - 12] : ROOTS[b % 4]);

  // keys: a raked chord on 1, a soft re-hit, one on the and of 3; every other bar the next chord comes in early, on
  // the last sixteenth, and ties over the barline
  const keys = groove(bars(24, (b) => {
    const ch = chordAt(b), next = chordAt((b + 1) % 24);
    const pushedIn = b % 2 === 1;  // this bar's chord already arrived on the last sixteenth of the bar before
    const hits = [[1.5, 0.35, 0.4], [2.5, 0.95, 0.56]];
    if (!pushedIn) hits.unshift([0, 1.4, 0.62]);
    const out = chordHits(ch, hits, { strum: 0.02 });
    if (b % 2 === 0) out.push(...chordHits(next, [[3.75, 0.2, 0.6]], { strum: 0.02 }));
    else out.push(...chordHits(ch, [[3.5, 0.4, 0.36]], { strum: 0.015 }));
    const room = b >= 16 ? 0.86 : 1; // under the lead, the hands get lighter
    return out.map((n) => ({ ...n, v: Math.min(1, (n.p === Math.max(...ch, ...next) ? n.v + 0.06 : n.v) * room) }));
  }), { seed: 19, swing: SW, vel: 0.08, time: 0.008 });
  // the pushed chords ring into the next bar: lengthen each last-sixteenth hit
  for (const n of keys) if (Math.abs((n.t % 4) - 3.75) < 0.06) n.d = 1.4;

  // drums: the kick a hair early, the snare and its ghosts a hair late, hats loose on the swung sixteenths
  const A = { kick: 'X......x..X.....', snare: '....X..-.-..X..-', hat: 'x.o-x.o.x.o-x.oo' };
  const B = { kick: 'X.....x...X..x..', snare: '....X.-..-..X.-.', hat: 'x.o-x.o.x.o-x.o.', open: '..............o.' };
  const kit = groove(bars(24, (b) => {
    if (b < 2) return [];
    if (b < 4) return grid(b === 3 ? { hat: 'x.o-x.o.x.o-x.oo', rim: '....o.......o.o.', kick: '..........x.....' } : { hat: 'x.o.x.o.x.o.x.o.' });
    if (inChange(b)) return grid({ kick: 'X.........X.....', rim: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.', ...(b === 15 ? { snare: '........x.-.xXxX' } : {}) });
    const g = grid(b % 2 ? B : A);
    if (b >= 16) g.push(...grid({ tamb: '....x.......x...' }));
    if (b === 4 || b === 16) g.push({ p: 49, t: 0, d: 3, v: 0.5 });
    return g;
  }), { seed: 23, swing: SW, push: { 36: -0.018, 38: 0.03, 37: 0.025, 42: 0.006, 54: 0.01 }, vel: 0.12, time: 0.012 });

  // bass: the root, a ghosted repeat, the fifth, and on the last eighth a note a step off the next root that slides in
  const bass = groove(bars(20, (bb) => {
    const b = bb + 4, r = rootAt(b), nr = rootAt((b + 1) % 24);
    const approach = nr + (nr > r ? -1 : 1);
    return [
      { p: r, t: 0, d: 1.1, v: 0.88 }, { p: r, t: 1.5, d: 0.2, v: 0.45 }, { p: r + 7, t: 1.75, d: 0.6, v: 0.66 },
      { p: r, t: 2.5, d: 0.75, v: 0.78 }, { p: approach, t: 3.5, d: 0.6, v: 0.62 },
    ];
  }), { seed: 8, swing: SW, vel: 0.06, time: 0.008 });

  // Claude's lead: two passes over the loop, the second higher, ending on Eb so the song turns round on itself
  const lead = groove([
    [67, 0.5, 0.5], [70, 1, 0.5], [72, 1.5, 1.5], [70, 3, 0.25], [67, 3.25, 0.25], [65, 3.5, 0.5],
    [67, 4, 1.5], [65, 5.5, 0.5], [70, 6, 0.75], [69, 6.75, 0.25], [67, 7, 1],
    [72, 8.5, 0.5], [75, 9, 1], [72, 10, 0.5], [70, 10.5, 0.5], [67, 11, 1],
    [68, 12, 1.5], [67, 13.5, 0.5], [65, 14, 1], [63, 15, 1],
    [67, 16.5, 0.5], [70, 17, 0.5], [72, 17.5, 1], [75, 18.5, 0.5], [77, 19, 1],
    [79, 20, 1.5], [77, 21.5, 0.5], [74, 22, 1], [72, 23, 1],
    [75, 24.5, 0.5], [72, 25, 0.5], [70, 25.5, 0.5], [68, 26, 1], [67, 27, 0.75], [65, 27.75, 0.25],
    [67, 28, 2.5], [65, 30.5, 0.5], [63, 31, 0.9],
  ].map(([p, t, d], i) => ({ p, t, d: d + 0.05, v: 0.7 + ((i * 5) % 4) * 0.05 })), { seed: 29, swing: SW, vel: 0.04, time: 0.01 });
  for (const n of lead) n.d = Math.min(n.d, 32 - n.t - 0.01);

  return demo({
    title: META.title, tempo: META.tempo, key: { root: 'Eb', scale: 'major' }, bars: 24,
    sections: [['Intro', 0, 4], ['Verse', 4, 8], ['Change', 12, 4], ['Hook', 16, 8]],
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drums', params: { kit: 2, tune: -1, decay: 0.9, tone: -0.1, drive: 0.3, width: 0.5, room: 0.22 },
        inserts: [fx('core.comp', { threshold: -16, ratio: 3, attack: 10, release: 120 })],
        clips: [clip(0, 96, kit, 'Drunk kit')], gain: 0 }),
      track({ name: 'Bass', color: 'var(--c-5)', device: 'core.bass', params: { wave: 0.05, sub: 0.6, cutoff: 480, reso: 0.12, envamt: 0.25, fdecay: 0.25, drive: 0.25, glide: 70, release: 0.08, mode: 0 },
        inserts: [fx('core.eq', { hp: 30, low: 1, lowf: 80, mid: -2, midf: 300, q: 1 })],
        clips: [clip(16, 80, bass, 'Slides')], gain: -5.5 }),
      track({ name: 'Keys', color: 'var(--c-6)', device: 'core.keys', params: { voice: 0, bright: 0.5, bell: 0.3, decay: 1.6, release: 0.3, trem: 0.3, rate: 4.2 },
        inserts: [fx('core.chorus', { rate: 0.6, depth: 0.35, mix: 0.3 }), fx('core.eq', { hp: 150, lp: 9000, mid: -2, midf: 350, q: 0.8 }), fx('core.verb', { size: 0.4, decay: 1.4, mix: 0.14 })],
        clips: [clip(0, 96, keys, 'Changes')], gain: 1.5, pan: -0.1 }),
      track({ name: 'Lead', color: 'var(--c-2)', device: 'core.poly', params: { wave: 0, detune: 6, sub: 0.2, spread: 0.2, cutoff: 2600, reso: 0.2, envamt: 0.3, fdecay: 0.3, attack: 0.02, decay: 0.4, sustain: 0.8, release: 0.2, glide: 90 },
        inserts: [fx('claude.say-ahh', { vowel: 0.4, talk: 0.75, sway: 0, mix: 1 }, AGENT), fx('core.delay', { div: 7, mode: 1, feedback: 0.25, tone: 3500, mix: 0.16 }, AGENT), fx('core.verb', { size: 0.5, decay: 1.8, mix: 0.16 }, AGENT)],
        clips: [clip(64, 32, lead, 'Talk box', AGENT)], gain: -5.5, pan: 0.12, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -18, ratio: 2, attack: 20, release: 200 }),
      fx('core.limiter', { gain: 4, ceiling: -1 }),
    ] },
  });
}
export default make;
