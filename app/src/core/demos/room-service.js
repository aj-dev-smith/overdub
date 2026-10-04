// "Room Service": boogie, 24 bars in E minor at 112 bpm, the early-eighties kind built on the 808. The verse vamps
// Em7 to Cmaj7 and a B7b13 that pulls home; the hook climbs Am9, Bm7, Cmaj9 to B7sus4 and B7. The Gobo Kit's 808
// (claps doubled with its snare, sixteenth hats that open on the and of four, a cowbell in the hook), a Flatwound
// played with a pick (the root, a ghost, the octave pop, the seventh and the fifth), the Suitcase's barky tines
// pushing the chords off the beat, and a DI Box scratching sixteenths on MUTE SOFT, so the ghosts stay choked and the
// accents ring open. The house played all of that. Claude played over it: the lead, on a second DI Box in octaves off
// the neck pickup, answering the keys in the verse and singing the hook, each long note scooped up from a half step
// below (a bend) with finger vibrato on the mod wheel.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, grid, groove, demo } from './lib.js';

export const META = { id: 'room-service', title: 'Room Service', genre: 'Boogie', line: 'an 808, a picked bass, scratch guitar, an octave lead by Claude', tempo: 112, key: 'E minor' };

// [keys voicing, bass root] per half bar
const EM7 = [[55, 59, 62, 64], 40];   // G B D E
const CMAJ7 = [[55, 59, 60, 64], 36]; // G B C E
const B7 = [[57, 59, 63, 67], 35];    // A B D# G (b13)
const AM9 = [[55, 59, 60, 64], 33];   // G B C E
const BM7 = [[57, 59, 62, 66], 35];   // A B D F#
const B7SUS = [[57, 59, 64, 66], 35]; // A B E F#
const bar = (a, b = a) => [a, b];
const VERSE = [bar(EM7), bar(EM7), bar(CMAJ7), bar(B7)];
const HOOK = [bar(AM9), bar(BM7), bar(CMAJ7), bar(B7SUS, B7)];
const SONG = [...VERSE, ...VERSE, ...VERSE, ...HOOK, ...HOOK, ...VERSE];

// Claude's lead, [pitch, beat, length], played in octaves (the pitch and the octave under it)
const LICKS = [
  [71, 4.5, 0.25], [74, 4.75, 0.25], [76, 5, 0.75], [74, 5.75, 0.25], [71, 6, 0.5], [69, 6.5, 0.5], [67, 7, 1],
  [69, 13.5, 0.5], [71, 14, 1.25], [75, 15.25, 0.25], [71, 15.5, 0.5],
  [76, 20.5, 0.25], [79, 20.75, 0.25], [81, 21, 0.75], [79, 21.75, 0.25], [76, 22, 0.5], [74, 22.5, 0.5], [76, 23, 1],
  [75, 28.5, 0.5], [78, 29, 0.5], [81, 29.5, 0.5], [79, 30, 1], [78, 31, 1],
];
const HOOK_TUNE = [
  [76, 0, 0.5], [76, 0.75, 0.25], [79, 1, 0.5], [81, 1.5, 1.5], [79, 3, 0.5], [76, 3.5, 0.5],
  [74, 4, 0.5], [78, 4.75, 0.25], [81, 5, 1], [78, 6, 0.5], [74, 6.5, 0.5], [71, 7, 1],
  [76, 8, 0.5], [76, 8.75, 0.25], [79, 9, 0.5], [83, 9.5, 1.5], [81, 11, 0.5], [79, 11.5, 0.5],
  [78, 12, 1], [76, 13, 0.5], [75, 13.5, 0.5], [78, 14, 2],
  [76, 16, 0.5], [76, 16.75, 0.25], [79, 17, 0.5], [81, 17.5, 1.5], [83, 19, 0.5], [81, 19.5, 0.5],
  [78, 20, 0.5], [81, 20.75, 0.25], [83, 21, 1], [81, 22, 0.5], [78, 22.5, 0.5], [74, 23, 1],
  [76, 24, 0.5], [79, 24.5, 0.5], [83, 25, 0.5], [84, 25.5, 1.5], [83, 27, 0.5], [79, 27.5, 0.5],
  [78, 28, 0.5], [81, 28.5, 0.5], [79, 29, 0.5], [78, 29.5, 0.5], [76, 30, 1.9],
];

export function make() {
  const n = SONG.length; // 24
  const sec = (b) => (b < 4 ? 'intro' : b < 12 ? 'verse' : b < 20 ? 'hook' : 'outro');
  const last = (b) => b === n - 1;

  // drums: the 808, a kick that skips, clap and snare together on two and four, sixteenth hats, the open hat on the
  // and of four; the cowbell in the hook; a fill at the end of each eight; one hit to finish
  const kit = groove(bars(n, (b) => {
    const s = sec(b);
    if (last(b)) return grid({ kick: 'X...............', clap: 'X...............', crash: 'x...............' });
    const rows = { kick: 'X.....x.X.....x.', clap: '....X.......X...', snare: '....x.......x...', hat: 'x-o-x-o-x-o-x-o.', open: '..............o.' };
    if (s === 'intro' && b < 2) { delete rows.clap; delete rows.snare; delete rows.open; }
    if (s === 'hook') { rows[56] = 'o..o..o...o.o...'; rows.kick = 'X..x..x.X.....x.'; }
    if (s === 'outro') { delete rows.hat; rows[56] = 'o..o..o...o.o...'; }
    if (b === 3 || b === 11) { rows.snare = '....x.......xoxX'; delete rows.open; }
    if (b === 19) { rows.snare = '....x...x.xoxXxX'; rows.clap = '....X...........'; delete rows.open; }
    const g = grid(rows); // (56 is the cowbell)
    if (b === 4 || b === 12) g.push({ p: 49, t: 0, d: 2, v: 0.6 });
    return g;
  }), { seed: 53, swing: 0.53, push: { 39: 0.004, 42: -0.004 }, vel: 0.08, time: 0.004 });

  // bass: per half bar, the root, a ghost, the octave pop (first half); the root, a ghost, the seventh, the octave and
  // the fifth (second half). The intro is the root alone, the last bar one long E
  const bass = groove(bars(n, (b) => {
    const [[, r1], [, r2]] = SONG[b];
    if (last(b)) return [{ p: 40, t: 0, d: 3, v: 0.9 }];
    if (b < 2) return [{ p: r1, t: 0, d: 0.45, v: 0.9 }, { p: r1, t: 1.5, d: 0.2, v: 0.6 }, { p: r1, t: 2, d: 0.45, v: 0.85 }, { p: r1, t: 3.5, d: 0.2, v: 0.6 }];
    const out = [
      { p: r1, t: 0, d: 0.45, v: 0.92 }, { p: r1, t: 0.75, d: 0.15, v: 0.42 }, { p: r1 + 12, t: 1.5, d: 0.2, v: 0.78 },
      { p: r2, t: 2, d: 0.4, v: 0.86 }, { p: r2, t: 2.75, d: 0.15, v: 0.4 }, { p: r2 + 10, t: 3, d: 0.22, v: 0.7 }, { p: r2 + 12, t: 3.25, d: 0.2, v: 0.76 }, { p: r2 + 7, t: 3.5, d: 0.3, v: 0.66 },
    ];
    return out;
  }), { seed: 59, swing: 0.53, vel: 0.06, time: 0.004 });

  // keys: the Suitcase pushing the chords: a short stab on one, a held one on the and of two, a third on the a of three
  // that ties over; out for the first four bars
  const keys = groove(bars(n, (b) => {
    if (b < 4) return [];
    const [[c1], [c2]] = SONG[b];
    if (last(b)) return EM7[0].map((p) => ({ p, t: 0, d: 3, v: 0.62 }));
    const hit = (ch, t, d, v) => ch.map((p, i) => ({ p, t, d, v: v + (i === ch.length - 1 ? 0.06 : 0) }));
    return [...hit(c1, 0, 0.3, 0.6), ...hit(c1, 1.5, 0.7, 0.52), ...hit(c2, 2.75, 1.1, 0.56)];
  }), { seed: 61, swing: 0.53, vel: 0.07, time: 0.005 });

  // scratch guitar: a high triad on every sixteenth, the ghosts soft enough to stay palm-muted, the accents open
  const ACCENT = new Set([2, 6, 7, 10, 14]);
  const guitar = groove(bars(n, (b) => {
    if (last(b)) return [];
    const out = [];
    for (let i = 0; i < 16; i++) {
      const [ch] = SONG[b][i < 8 ? 0 : 1];
      const tri = ch.slice(1).map((p) => p + 12);
      const acc = ACCENT.has(i);
      for (const p of tri) out.push({ p, t: i * 0.25, d: acc ? 0.2 : 0.1, v: acc ? 0.7 : 0.22 });
    }
    return out;
  }), { seed: 67, swing: 0.53, vel: 0.05, time: 0.003 });

  // Claude's lead: octaves; every note of a beat or longer scooped up from a half step below, with vibrato as it holds
  const line = [...LICKS.map(([p, t, d]) => [p, t + 16, d]), ...HOOK_TUNE.map(([p, t, d]) => [p, t + 48, d])];
  const lead = [];
  line.forEach(([p, t, d], i) => {
    const long = d >= 1;
    const expr = long ? { bend: [[0, -1], [0.12, 0]], mod: [[0, 0], [0.4, 0], [d, 0.6]] } : {};
    const v = 0.7 + ((i * 3) % 4) * 0.05;
    lead.push({ p, t, d: d * 0.92, v, ...expr }, { p: p - 12, t, d: d * 0.92, v: v * 0.85, ...expr });
  });
  const leadG = groove(lead, { seed: 71, swing: 0.53, vel: 0.04, time: 0.004 });

  return demo({
    title: META.title, tempo: META.tempo, key: { root: 'E', scale: 'minor' }, bars: n,
    sections: [['Intro', 0, 4], ['Verse', 4, 8], ['Hook', 12, 8], ['Outro', 20, 4]],
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drums', params: { kit: 3, tune: 0, decay: 1, tone: 0.1, drive: 0.15, width: 0.5, room: 0.15 },
        inserts: [fx('core.comp', { threshold: -16, ratio: 3, attack: 10, release: 120 })],
        clips: [clip(0, 96, kit, '808')], gain: -3 }),
      track({ name: 'Bass', color: 'var(--c-5)', device: 'core.bassguitar', params: { style: 1, tone: 0.55, pickup: 0.7, sustain: 0.8, mute: 0.06, drive: 0.25 },
        clips: [clip(0, 96, bass, 'Pops')], gain: -1 }),
      track({ name: 'Keys', color: 'var(--c-6)', device: 'core.ep', params: { voice: 0, voicing: 0.8, bright: 0.55, decay: 1, drive: 0.4, trem: 0, release: 0.12 },
        inserts: [fx('core.chorus', { rate: 0.5, depth: 0.3, mix: 0.25 })],
        clips: [clip(0, 96, keys, 'Stabs')], gain: 0, pan: -0.1 }),
      track({ name: 'Guitar', color: 'var(--c-3)', device: 'core.guitar', params: { body: 0, pick: 0.1, pickup: 0.4, tone: 0.5, decay: 1, strum: 6, mute: 1 },
        inserts: [fx('core.eq', { hp: 220, lp: 2600, high: -6, highf: 2000 })],
        clips: [clip(0, 96, guitar, 'Scratch')], gain: -0.5, pan: 0.35 }),
      track({ name: 'Lead', color: 'var(--c-2)', device: 'core.guitar', params: { body: 0, pick: 0.45, pickup: 1, tone: 0.55, decay: 1.2, strum: 0, mute: 0 },
        inserts: [fx('core.verb', { size: 0.4, decay: 1.4, mix: 0.14 }, AGENT)],
        clips: [clip(0, 96, leadG, 'Octaves', AGENT)], gain: -1.5, pan: -0.05, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -18, ratio: 2, attack: 15, release: 150 }),
      fx('core.limiter', { gain: 4, ceiling: -1 }),
    ] },
  });
}
export default make;
