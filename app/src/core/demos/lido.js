// "Lido": summer house, 16 bars in G major at 122 bpm. Four on the floor on the machine kit, the bass on every offbeat
// between the kicks (so the two never fight), house piano stabs on the grand in a 3-3-2, a warm pad, and a kalimba
// topline. The house played all of that. Claude played over it: a sixteenth-note arpeggio on Patch Bay that takes the
// lead for the last four bars, and its Chopping Block on the pad, gating it in time so the bed pumps.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, grid, groove, chordHits, demo } from './lib.js';

export const META = { id: 'lido', title: 'Lido', genre: 'House', line: 'four on the floor, piano stabs, an arpeggio by Claude', tempo: 122, key: 'G major' };

// I V vi IV: Gadd9, Dadd9, Em7, Cmaj7, voiced close round middle C so each change moves a step or holds
const GADD9 = [57, 59, 62, 67];   // A B D G
const DADD9 = [57, 62, 64, 66];   // A D E F#
const EM7 = [55, 59, 62, 64];     // G B D E
const CMAJ7 = [55, 59, 60, 64];   // G B C E
const CHORDS = [GADD9, DADD9, EM7, CMAJ7];
const ROOTS = [43, 38, 40, 36];   // G2 D2 E2 C2

export function make() {
  // drums: kick on every beat, clap on 2 and 4, open hats on the offbeats, closed sixteenths that breathe, a shaker
  const kit = groove(bars(16, (b) => {
    const rows = { kick: 'X...X...X...X...', clap: '....X.......X...', hat: 'x-o-x-o-x-o-x-oo', open: '..x...x...x...x.', shaker: 'o-o-o-o-o-o-o-o-' };
    if (b < 2) { delete rows.clap; delete rows.open; delete rows.shaker; }
    if (b === 3 || b === 11) rows.clap = '....X.......X.xX';
    if (b === 15) rows.clap = '....X...x.x.XxXX';
    const g = grid(rows);
    if (b === 4 || b === 12) g.push({ p: 49, t: 0, d: 2, v: 0.6 });
    return g;
  }), { seed: 31, swing: 0.54, push: { 39: 0.006, 70: -0.006 }, vel: 0.12, time: 0.004 });

  // bass: the root on the offbeats, an octave pop on the last one, a pickup into every other bar
  const bass = groove(bars(16, (b) => {
    const r = ROOTS[b % 4];
    const out = [0.5, 1.5, 2.5].map((t) => ({ p: r, t, d: 0.32, v: 0.82 }));
    out.push({ p: r + 12, t: 3.5, d: 0.25, v: 0.72 });
    if (b % 2) out.push({ p: r + 7, t: 3.75, d: 0.2, v: 0.6 });
    return out;
  }), { seed: 2, vel: 0.06, time: 0.003 });

  // piano: stabs on 1, the a of 1 and the and of 2 (3-3-2), then the and of 3 and 4
  const STABS = [[0, 0.35, 0.78], [0.75, 0.3, 0.6], [1.5, 0.4, 0.7], [2.5, 0.3, 0.62], [3, 0.6, 0.68]];
  const piano = groove(bars(16, (b) => chordHits(CHORDS[b % 4], b === 15 ? STABS.slice(0, 3) : STABS)), { seed: 17, swing: 0.54, vel: 0.08, time: 0.004 });

  // pad: the chords held, an octave up, from the groove on
  const pad = bars(12, (b) => CHORDS[b % 4].map((p) => ({ p: p + 12, t: 0, d: 4, v: 0.55 })));

  // the topline: a kalimba hook an octave over the piano, syncopated, answered on the way round
  const line = [
    [74, 0, 0.5], [71, 0.75, 0.5], [67, 1.5, 0.5], [71, 2.5, 0.5], [74, 3, 0.75],
    [78, 4.5, 0.5], [76, 5, 0.5], [74, 5.5, 1], [69, 7, 0.5], [71, 7.5, 0.5],
    [74, 8, 0.75], [71, 8.75, 0.75], [67, 9.5, 0.5], [71, 10.5, 0.5], [74, 11, 0.5], [79, 11.5, 0.5],
    [76, 12, 1.5], [74, 13.5, 0.5], [72, 14, 1.5],
  ];
  const second = line.slice(0, 16).concat([[79, 12, 1], [76, 13, 0.5], [74, 13.5, 0.5], [71, 14, 1.5]]);
  const topline = groove([...line, ...second.map(([p, t, d]) => [p, t + 16, d])].map(([p, t, d], i) => ({ p: p + 12, t, d, v: 0.7 + (i % 3 === 0 ? 0.12 : 0) })), { seed: 23, swing: 0.54, vel: 0.06, time: 0.004 });

  // Claude's arpeggio: up through each chord and back, sixteenths, accents on the beat, in the octave above the topline
  const arp = groove(bars(4, (b) => {
    const ch = CHORDS[b % 4].map((p) => p + 12);
    const up = [ch[0], ch[1], ch[2], ch[3], ch[0] + 12, ch[3], ch[2], ch[1]];
    return Array.from({ length: 16 }, (_, i) => ({ p: up[i % 8], t: i * 0.25, d: 0.2, v: i % 4 === 0 ? 0.82 : i % 2 ? 0.52 : 0.64 }));
  }), { seed: 41, swing: 0.54, vel: 0.05, time: 0.003 });

  return demo({
    title: META.title, tempo: META.tempo, key: { root: 'G', scale: 'major' }, bars: 16,
    sections: [['Intro', 0, 4], ['Groove', 4, 8], ['Lift', 12, 4]],
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drums', params: { kit: 1, decay: 0.9, tone: 0.2, drive: 0.25, width: 0.7, room: 0.12 },
        inserts: [fx('core.comp', { threshold: -16, ratio: 3, attack: 10, release: 100 })],
        clips: [clip(0, 64, kit, 'Four on the floor')], gain: -1.5 }),
      track({ name: 'Bass', color: 'var(--c-5)', device: 'core.bass', params: { wave: 0.65, sub: 0.45, cutoff: 650, reso: 0.35, envamt: 0.55, fdecay: 0.12, drive: 0.3, glide: 0, release: 0.05, mode: 1 },
        clips: [clip(0, 64, bass, 'Offbeats')], gain: -1 }),
      track({ name: 'Piano', color: 'var(--c-6)', device: 'core.keys', params: { voice: 1, bright: 0.75, decay: 0.9, release: 0.15, trem: 0 },
        inserts: [fx('core.eq', { hp: 220, high: 2, highf: 6000 }), fx('core.verb', { size: 0.35, decay: 1.2, mix: 0.16 })],
        clips: [clip(0, 64, piano, 'Stabs')], gain: -2.5, pan: -0.1 }),
      track({ name: 'Pad', color: 'var(--c-7)', device: 'core.pad', params: { tone: 3200, detune: 14, motion: 0.3, attack: 0.3, release: 1.2, chorus: 0.5, space: 0.3 },
        inserts: [fx('claude.chopping-block', { rate: 0, pattern: 3, length: 92, smooth: 14, depth: 0.8 }, AGENT)],
        clips: [clip(16, 48, pad, 'Bed')], gain: -4.5 }),
      track({ name: 'Topline', color: 'var(--c-4)', device: 'claude.biscuit-tin', params: { sound: 1, mallet: 0.95, decay: 2, damp: 0.3, width: 0.5 },
        inserts: [fx('core.delay', { div: 7, mode: 1, feedback: 0.3, tone: 5000, mix: 0.2 })],
        clips: [clip(16, 32, topline, 'Hook')], gain: 0.5, pan: 0.1 }),
      track({ name: 'Arp', color: 'var(--c-2)', device: 'core.poly', params: { wave: 2, pw: 0.3, detune: 6, sub: 0, cutoff: 3200, reso: 0.25, envamt: 0.4, fdecay: 0.15, attack: 0.002, decay: 0.2, sustain: 0.3, release: 0.12 },
        inserts: [fx('core.delay', { div: 7, mode: 1, feedback: 0.35, tone: 4500, mix: 0.22 }, AGENT), fx('core.verb', { size: 0.5, decay: 1.8, mix: 0.15 }, AGENT)],
        clips: [clip(48, 16, arp, 'Sixteenths', AGENT)], gain: 3.5, pan: 0.15, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -16, ratio: 2, attack: 15, release: 150 }),
      fx('core.limiter', { gain: 2.2, ceiling: -1 }),
    ] },
  });
}
export default make;
