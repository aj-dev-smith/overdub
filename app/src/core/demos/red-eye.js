// @ts-check
// "Red Eye": trap, 32 bars in C minor at 140 bpm (half time: the clap on 3). A dark piano loop over iv-V-i-VI, the
// melody a 3-3-2 figure that takes the raised seventh over the G; an 808 on Sub Basement, each hit falling into its
// note, locked to the kick; a choir under the second hook. The house played all of that. Claude played over it: the
// hats, on their own track the way producers program them, eighths that break into sixteenth-triplet and thirty-second
// rolls at the ends of phrases, busier in the verse where the piano leaves room.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, grid, groove, demo } from './lib.js';

export const META = { id: 'red-eye', title: 'Red Eye', genre: 'Trap', line: 'a dark piano loop, a sliding 808, hat rolls by Claude', tempo: 140, key: 'C minor' };

// two bars a chord: Cm, Ab, Fm, G7. Left hand close round middle C, every change a step or a hold
const LH = [[55, 60, 63], [56, 60, 63], [56, 60, 65], [55, 59, 65]]; // G C Eb | Ab C Eb | Ab C F | G B F
const ROOTS = [36, 32, 29, 31]; // C2 Ab1 F1 G1
// the melody: the same figure up through each chord, its answer falling home; the B natural over the G pulls back to C
const MELODY = [
  [67, 0, 0.5], [72, 0.75, 0.5], [75, 1.5, 0.75], [74, 2.5, 0.5], [72, 3, 1], [67, 4.5, 0.5], [70, 5, 0.5], [72, 6, 1.75],
  [67, 8, 0.5], [72, 8.75, 0.5], [75, 9.5, 0.75], [74, 10.5, 0.5], [72, 11, 1], [68, 12.5, 0.5], [67, 13, 0.5], [63, 14, 1.75],
  [68, 16, 0.5], [72, 16.75, 0.5], [75, 17.5, 0.75], [74, 18.5, 0.5], [72, 19, 1], [65, 20.5, 0.5], [68, 21, 0.5], [72, 22, 1.75],
  [67, 24, 0.5], [71, 24.75, 0.5], [74, 25.5, 0.75], [77, 26.5, 0.5], [75, 27, 1], [74, 28.5, 0.5], [71, 29, 0.5], [67, 30, 1.75],
];

export function make() {
  const sec = (b) => (b < 4 ? 'intro' : b < 12 ? 'hook' : b < 20 ? 'verse' : b < 28 ? 'hook2' : 'outro');

  // the loop starts halfway round: the intro is Fm and G7 (iv-V), so the first hook lands on C minor
  const chord = (b) => ((b + 4) >> 1) % 4;

  // piano: the left hand on every bar, the melody over it (an octave down and thinned in the verse, home in the outro)
  const melody = [];
  for (let k = 0; k < 5; k++) for (const [p, t, d] of MELODY) {
    const at = t - 16 + k * 32, b = Math.floor(at / 4), s = sec(b);
    if (at < 0 || at >= 128) continue;
    const i = MELODY.findIndex((m) => m[1] === t);
    if (s === 'verse') { if (i % 8 < 5) melody.push({ p: p - 12, t: at, d, v: 0.52 }); continue; }
    if (s === 'outro' && b >= 30 && at > 121) continue;
    melody.push({ p, t: at, d, v: (i % 8 === 2 ? 0.76 : 0.64) * (s === 'outro' || s === 'intro' ? 0.85 : 1) });
  }
  const piano = groove([...bars(32, (b) => LH[chord(b)].map((p) => ({ p, t: 0, d: 3.8, v: b % 2 ? 0.36 : 0.46 }))), ...melody], { seed: 71, vel: 0.06, time: 0.004 });

  // the 808: each hit drops onto the root; two shapes a chord, the second walking into the next root
  const A = [[0, 1.3, 0.95], [1.5, 0.45, 0.8], [2.5, 0.9, 0.86], [3.5, 0.4, 0.74]];
  const B = [[0, 2.4, 0.95], [2.75, 0.5, 0.8], [3.5, 0.45, 0.82]];
  const V = [[0, 2.9, 0.95], [3.25, 0.6, 0.78]];
  const sub = bars(32, (b) => {
    const s = sec(b), r = ROOTS[chord(b)], next = ROOTS[(chord(b) + 1) % 4];
    if (s === 'intro') return [];
    if (s === 'outro') return b === 28 ? [{ p: r, t: 0, d: 3.8, v: 0.9 }] : [];
    const shape = s === 'verse' ? V : b % 2 ? B : A;
    return shape.map(([t, d, v], i) => ({ p: b % 2 && i === shape.length - 1 ? next : r, t, d, v }));
  });

  // drums: kick on the 808's downbeats, clap and snare on 3, a crash into each hook, a snare build at the end of the intro
  const kit = groove(bars(32, (b) => {
    const s = sec(b);
    if (s === 'intro') return b === 3 ? grid({ snare: '........o.o.x.xx', clap: '..............xX' }) : [];
    if (s === 'outro') return b === 28 ? grid({ kick: 'X...............', crash: 'X...............' }) : [];
    const rows = s === 'verse'
      ? { kick: 'X...........x...', clap: '........X.......', snare: '........x.......' }
      : { kick: b % 2 ? 'X..........x....' : 'X.....x...x.....', clap: '........X.......', snare: '........x.......' };
    if (b === 11 || b === 27) rows.snare = '........x...x.xx';
    if (b === 19) { rows.kick = 'X...............'; rows.snare = '........x.x.xxXX'; }
    const g = grid(rows);
    if (b === 4 || b === 20) g.push({ p: 49, t: 0, d: 3, v: 0.62 });
    if (s === 'hook2' && b % 4 === 3) g.push({ p: 46, t: 3.5, d: 0.5, v: 0.5 });
    return g;
  }), { seed: 37, vel: 0.06, time: 0.003 });

  // Claude's hats: eighths with the offbeats softer, and a roll at the end of every other bar (more in the verse)
  const roll = (at, len, n, v0, v1) => Array.from({ length: n }, (_, i) => ({ p: 42, t: at + (i * len) / n, d: 0.08, v: v0 + ((v1 - v0) * i) / Math.max(1, n - 1) }));
  const hatBar = (b) => {
    const s = sec(b);
    if (s === 'intro' || s === 'outro') return b === 2 || b === 3 ? Array.from({ length: 8 }, (_, i) => ({ p: 42, t: i * 0.5, d: 0.1, v: i % 2 ? 0.4 : 0.55 })) : [];
    const busy = s === 'verse';
    const out = [];
    const end = b % 2 ? (busy && b % 4 === 3 ? 2.5 : 3) : 4;
    for (let t = 0; t < end; t += 0.5) out.push({ p: 42, t, d: 0.1, v: t % 1 ? 0.5 : 0.72 });
    if (busy && b % 2 === 0) out.push({ p: 42, t: 1.75, d: 0.08, v: 0.42 }, { p: 42, t: 3.25, d: 0.08, v: 0.4 });
    if (b % 2) {
      if (b % 4 === 1) out.push(...roll(3, 1, 6, 0.42, 0.7));                       // a sixteenth-triplet roll on 4
      else if (busy) out.push(...roll(2.5, 1, 8, 0.36, 0.72), { p: 46, t: 3.5, d: 0.45, v: 0.5 }); // thirty-seconds, an open hat
      else out.push(...roll(3, 0.5, 4, 0.45, 0.62), ...roll(3.5, 0.5, 3, 0.62, 0.48)); // a stutter that falls back
    }
    return out;
  };
  const hats = groove(bars(32, hatBar), { seed: 43, vel: 0.05, time: 0.002 });

  // choir under the second hook: the left hand an octave up, held
  const choir = bars(8, (b) => LH[chord(b + 20)].map((p) => ({ p: p + 12, t: 0, d: 4, v: 0.5 })));

  return demo({
    title: META.title, tempo: META.tempo, key: { root: 'C', scale: 'minor' }, bars: 32,
    sections: [['Intro', 0, 4], ['Hook', 4, 8], ['Verse', 12, 8], ['Hook 2', 20, 8], ['Outro', 28, 4]],
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drums', params: { kit: 1, tune: 0, decay: 0.8, tone: 0.25, drive: 0.25, width: 0.6, room: 0.2 },
        inserts: [fx('core.comp', { threshold: -16, ratio: 3, attack: 8, release: 100 })],
        clips: [clip(0, 128, kit, 'Kick and clap')], gain: -2 }),
      track({ name: '808', color: 'var(--c-5)', device: 'claude.sub-basement', params: { drop: 5, fall: 45, decay: 2.2, drive: 0.6, tone: 1600 },
        inserts: [fx('core.eq', { hp: 28, low: 0, lowf: 60, mid: -1, midf: 250, q: 1, gain: 4 })],
        clips: [clip(0, 128, sub, '808')], gain: 0 }),
      track({ name: 'Piano', color: 'var(--c-6)', device: 'core.keys', params: { voice: 1, bright: 0.4, decay: 2, release: 0.4, trem: 0 },
        inserts: [fx('core.eq', { hp: 180, lp: 9000, mid: -3, midf: 320, q: 0.8 }), fx('core.delay', { div: 7, mode: 1, feedback: 0.3, tone: 3000, mix: 0.16 }), fx('core.verb', { size: 0.6, decay: 2.4, mix: 0.2 })],
        clips: [clip(0, 128, piano, 'Loop')], gain: 0, pan: -0.05 }),
      track({ name: 'Choir', color: 'var(--c-7)', device: 'claude.choir-loft', params: { vowel: 0.15, singers: 0.7, breath: 0.3, attack: 0.6, release: 1.5, space: 0.5 },
        clips: [clip(80, 32, choir, 'Ooh')], gain: -9 }),
      track({ name: 'Hats', color: 'var(--c-2)', device: 'core.drums', params: { kit: 1, tune: 2, decay: 1.1, tone: -0.1, drive: 0.1, width: 0.5, room: 0.1 },
        inserts: [fx('core.eq', { hp: 500, lp: 6500, gain: 12 }, AGENT)],
        clips: [clip(0, 128, hats, 'Rolls', AGENT)], gain: 5.5, pan: 0.1, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -18, ratio: 2, attack: 15, release: 150 }),
      fx('core.limiter', { gain: 5, ceiling: -1 }),
    ] },
  });
}
export default make;
