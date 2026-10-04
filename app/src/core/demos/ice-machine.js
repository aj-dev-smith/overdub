// "Ice Machine": dub, 24 bars in G minor at 75 bpm, Gm Eb Cm Dm round and round. A one drop on the Gobo Kit (the
// kick and the rim together on three, swung eighths on the hat), a deep round bass, a DI Box skanking on two and
// four, the Rotor Cabinet bubbling on the offbeats (faded in from nothing over the first two bars: the house's lane).
// The house played all of that. Claude played over it twice: a melodica tune (Patch Bay on a narrow pulse), each
// phrase's last note thrown into a dotted-eighth echo; and the desk, through the dub, the way a dub is mixed: the
// drums and then the bass pulled out and dropped back, echo thrown on the skank's last chop with the feedback pushed
// till it blooms, a spring splash on the rim, and the skank thinned by a high-pass sweep into the last verse.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { HOUSE, AGENT, clip, fx, track, bars, grid, groove, demo, automate } from './lib.js';

export const META = { id: 'ice-machine', title: 'Ice Machine', genre: 'Dub', line: 'a one drop, a skank, a melodica and the desk by Claude', tempo: 75, key: 'G minor' };

// [skank voicing, organ voicing] per bar: Gm Eb Cm Dm (the last bar goes home to Gm)
const GM = [[67, 70, 74], [55, 58, 62]];   // G Bb D
const EB = [[67, 70, 75], [55, 58, 63]];   // G Bb Eb
const CM = [[67, 72, 75], [55, 60, 63]];   // G C Eb
const DM = [[69, 74, 77], [57, 62, 65]];   // A D F
const BARS = 24;
const chordAt = (b) => (b === BARS - 1 ? GM : [GM, EB, CM, DM][b % 4]);

// the bass, a bar per chord: the root, its pickup, down to the fifth or the third and walking back up
const BASS = {
  GM: [[43, 0, 0.7], [43, 0.75, 0.2], [38, 1, 0.45], [34, 1.5, 0.95], [36, 2.5, 0.45], [38, 3, 0.9]],
  EB: [[39, 0, 1.2], [39, 1.25, 0.2], [34, 1.5, 0.95], [39, 2.5, 0.45], [41, 3, 0.45], [43, 3.5, 0.45]],
  CM: [[36, 0, 1.2], [36, 1.25, 0.2], [43, 1.5, 0.95], [39, 2.5, 0.45], [38, 3, 0.45], [36, 3.5, 0.45]],
  DM: [[38, 0, 1.2], [38, 1.25, 0.2], [45, 1.5, 0.95], [41, 2.5, 0.45], [43, 3, 0.45], [45, 3.5, 0.45]],
};

// Track levels (the faders the desk lanes pull from and drop back to)
const DRUMS_DB = 5, BASS_DB = -5.5, ORGAN_DB = 2.5;

export function make() {
  const SWUNG = { seed: 0, swing: 0.6, step: 0.5 };   // eighths swung toward the triplet, as a one drop sits

  // drums: hats in the intro, the one drop from the riddim on; tom fills at the turnarounds; the last bar one hit
  const kit = groove(bars(BARS, (b) => {
    if (b < 2) return [];
    const r = { hat: 'x.o.x.o.x.o.x.o.' };
    if (b === 2) r.hat = '........x.o.x.o.';
    if (b >= 4) { r.kick = '........X.......'; r.rim = '........X.......'; }
    if (b >= 4 && b % 2 === 1) r.hat = 'x.o.x.o.x.o.x.ox';
    if (b === 3 || b === 11 || b === 19) Object.assign(r, { htom: '..........x.....', tom: '............x...', ltom: '..............x.' });
    if (b === BARS - 1) return grid({ kick: 'X...............', rim: 'X...............' });
    const g = grid(r);
    if (b === 4 || b === 12 || b === 20) g.push({ p: 49, t: 0, d: 2, v: 0.5 });
    return g;
  }), { ...SWUNG, seed: 75, push: { 37: 0.01, 42: -0.004 }, vel: 0.1, time: 0.005 });

  // bass: from bar 2, a bar per chord; the last bar a long low G
  const bass = groove(bars(BARS, (b) => {
    if (b < 2) return [];
    if (b === BARS - 1) return [{ p: 31, t: 0, d: 3, v: 0.85 }];
    const name = ['GM', 'EB', 'CM', 'DM'][b % 4];
    return BASS[name].map(([p, t, d]) => ({ p, t, d, v: t === 0 ? 0.88 : 0.74 }));
  }), { ...SWUNG, seed: 31, vel: 0.05, time: 0.004 });

  // the skank: a short chop on two and four, a lighter double on the last one every other bar
  const skank = groove(bars(BARS, (b) => {
    const ch = chordAt(b)[0];
    if (b === BARS - 1) return ch.map((p) => ({ p, t: 1, d: 0.2, v: 0.8 }));
    const out = [];
    for (const [t, v] of b % 2 ? [[1, 0.82], [3, 0.8], [3.5, 0.5]] : [[1, 0.82], [3, 0.8]]) for (const p of ch) out.push({ p, t, d: 0.16, v });
    return out;
  }), { ...SWUNG, seed: 4, vel: 0.06, time: 0.003 });

  // the organ bubble: offbeat eighths, the downbeat ones leaning harder
  const organ = groove(bars(BARS, (b) => {
    const ch = chordAt(b)[1];
    const hits = b === BARS - 1 ? [[0.5, 0.7]] : [[0.5, 0.72], [1.5, 0.55], [2.5, 0.68], [3.5, 0.55]];
    return hits.flatMap(([t, v]) => ch.map((p) => ({ p, t, d: 0.22, v })));
  }), { ...SWUNG, seed: 12, vel: 0.06, time: 0.003 });

  // Claude's melodica: a call in the intro, the tune through the riddim (A, then A' climbing), one fragment in the
  // dub, the tune again to close, landing on G
  const A = [
    [74, 0.5, 0.45], [77, 1, 0.45], [79, 1.5, 1.4], [77, 3, 0.45], [74, 3.5, 0.45],
    [75, 4, 1.4], [74, 5.5, 0.45], [70, 6, 0.95], [67, 7, 0.9],
    [72, 8.5, 0.45], [75, 9, 0.45], [79, 9.5, 0.95], [77, 10.5, 0.45], [75, 11, 0.95],
    [74, 12, 2.4], [69, 14.5, 0.45], [70, 15, 0.45], [72, 15.5, 0.45],
  ];
  const A2 = [
    [74, 16, 1.4], [70, 17.5, 0.45], [67, 18, 0.95], [70, 19, 0.45], [72, 19.5, 0.45],
    [70, 20, 0.95], [67, 21, 0.45], [65, 21.5, 0.45], [67, 22, 1.9],
    [79, 24.5, 0.45], [82, 25, 0.45], [84, 25.5, 0.95], [82, 26.5, 0.45], [79, 27, 0.95],
    [77, 28, 0.45], [74, 28.5, 0.45], [72, 29, 0.45], [70, 29.5, 0.45], [69, 30, 1.9],
  ];
  const call = [[67, 0.5, 0.45], [70, 1, 0.45], [74, 1.5, 2.4], [72, 8.5, 0.45], [70, 9, 0.45], [69, 9.5, 2.4]];
  const fragment = [[74, 0, 0.45], [77, 0.5, 0.45], [81, 1, 1.9]];
  const close = [...A.slice(0, 14), [74, 12, 0.95], [70, 13, 0.45], [67, 13.5, 2.4]];
  const at = (notes, bar) => notes.map(([p, t, d]) => [p, t + bar * 4, d]);
  const tune = [...call, ...at(A, 4), ...at(A2, 4), ...at(fragment, 15), ...at(close, 20)];
  const melodica = groove(tune.map(([p, t, d], i) => ({ p, t, d, v: 0.74 + (t % 2 === 0 ? 0.08 : 0) + (i % 3 === 0 ? 0.04 : 0) })), { ...SWUNG, seed: 61, vel: 0.05, time: 0.006 });

  const p = demo({
    title: META.title, tempo: META.tempo, key: { root: 'G', scale: 'minor' }, bars: BARS,
    sections: [['Intro', 0, 4], ['Riddim', 4, 8], ['Dub', 12, 8], ['Outro', 20, 4]],
    tracks: [
      track({ name: 'Drums', color: 'var(--c-1)', device: 'core.drums', params: { kit: 0, tune: -3, decay: 1.1, tone: -0.1, drive: 0.2, width: 0.5, room: 0.2 },
        inserts: [fx('core.verb', { size: 0.3, decay: 1.6, damp: 0.25, predelay: 8, lowcut: 300, mix: 0.1 }), fx('core.comp', { threshold: -18, ratio: 3, attack: 12, release: 120 })],
        clips: [clip(0, BARS * 4, kit, 'One drop')], gain: DRUMS_DB }),
      track({ name: 'Bass', color: 'var(--c-5)', device: 'core.bass', params: { wave: 0.05, sub: 0.55, cutoff: 380, reso: 0.1, envamt: 0.2, fdecay: 0.2, drive: 0.2, glide: 20, release: 0.08, mode: 0 },
        inserts: [fx('core.eq', { hp: 28, low: 1, lowf: 90, mid: -2, midf: 400, q: 1 })],
        clips: [clip(0, BARS * 4, bass, 'Riddim')], gain: BASS_DB }),
      track({ name: 'Skank', color: 'var(--c-4)', device: 'core.guitar', params: { body: 0, pick: 0.15, pickup: 0.1, tone: 0.8, decay: 0.5, strum: 5, mute: 0 },
        inserts: [fx('core.filter', { mode: 2, cutoff: 30, reso: 0.3, sync: 0, rate: 0.5, lfo: 0, env: 0, drive: 0, mix: 1 }), fx('core.delay', { div: 8, mode: 1, feedback: 0.45, tone: 2800, lowcut: 300, wow: 0.25, mix: 0 }), fx('core.verb', { size: 0.4, decay: 1.4, mix: 0.12 })],
        clips: [clip(0, BARS * 4, skank, 'Skank')], gain: 0, pan: 0.25 }),
      track({ name: 'Organ', color: 'var(--c-6)', device: 'core.organ', params: { reg: 1, perc: 0, click: 0.2, drive: 0.2, rotor: 0, cab: 0.85, tone: 0.45 },
        clips: [clip(0, BARS * 4, organ, 'Bubble')], gain: ORGAN_DB, pan: -0.25 }),
      track({ name: 'Melodica', color: 'var(--c-2)', device: 'core.poly', params: { wave: 2, pw: 0.22, detune: 5, sub: 0, spread: 0.2, unison: 0, cutoff: 2600, reso: 0.1, envamt: 0.15, fdecay: 0.3, attack: 0.03, decay: 0.3, sustain: 0.85, release: 0.12, glide: 25 },
        inserts: [fx('core.delay', { div: 8, mode: 1, feedback: 0.5, tone: 2500, lowcut: 300, wow: 0.3, mix: 0.08 }, AGENT), fx('core.verb', { size: 0.5, decay: 2.2, mix: 0.16 }, AGENT)],
        clips: [clip(0, BARS * 4, melodica, 'Melodica', AGENT)], gain: -1.5, pan: -0.05, by: AGENT }),
    ],
    master: { gain: 0, inserts: [
      fx('core.comp', { threshold: -18, ratio: 2, attack: 20, release: 200 }),
      fx('core.limiter', { gain: 4.2, ceiling: -1 }),
    ] },
  });

  // the house's lane: the organ faded in from nothing over the first two bars
  automate(p, HOUSE, [{ track: 'Organ', param: 'gain', points: `0:-60~0.4 8:${ORGAN_DB}` }]);

  // Claude's lanes. A throw: the echo's mix up for a note (and the beats after it), then back down.
  const throws = (notes, base, up) => notes.flatMap(([t, d, hold = 2]) => [`${t - 0.1}:${base}`, `${t}:${up}`, `${t + d + hold}:${up}~0.3`, `${t + d + hold + 1}:${base}`]);
  const cut = (from, to, db, out = -50) => [`${from}:${db}`, `${from + 0.06}:${out}`, `${to - 0.06}:${out}`, `${to}:${db}`];
  automate(p, AGENT, [
    // the melodica: each phrase's last long note thrown
    { track: 'Melodica', insert: 'core.delay', param: 'mix', points: throws([[1.5, 2.4], [9.5, 2.4], [28, 2.4, 0.6], [46, 1.9], [61, 1.9]], 0.08, 0.5).join(' ') + ' 93.4:0.08 93.5:0.55' },
    // ... and the last one left to run
    { track: 'Melodica', insert: 'core.delay', param: 'feedback', points: '92:0.5 93.5:0.5~0.4 96:0.78' },
    // the dub: the drums out for two bars, then the bass for two, the drums stopping for half a bar before the outro
    { track: 'Drums', param: 'gain', points: [...cut(56, 64, DRUMS_DB), ...cut(77.9, 80, DRUMS_DB)].join(' ') },
    { track: 'Bass', param: 'gain', points: cut(63.9, 72, BASS_DB).join(' ') },
    // the skank's echo opened through the dub, its last chop of every other bar thrown with the feedback pushed
    { track: 'Skank', insert: 'core.delay', param: 'mix', points: `47.5:0 48:0.28 ${throws([[55.5, 0.2, 1.5], [63.5, 0.2, 1.5], [71.5, 0.2, 1.5]], 0.28, 0.62).join(' ')} 79.4:0.28 79.5:0.62 81:0.62~0.3 84:0` },
    { track: 'Skank', insert: 'core.delay', param: 'feedback', points: '55.4:0.45 55.5:0.72 57.5:0.72~0.3 58.5:0.45 63.4:0.45 63.5:0.8 65.5:0.8~0.3 66.5:0.45 71.4:0.45 71.5:0.72 73.5:0.72~0.3 74.5:0.45 79.4:0.45 79.5:0.75 81:0.75~0.3 84:0.45' },
    // the skank thinned by a high-pass into the outro, back to full at the drop
    { track: 'Skank', insert: 'core.filter', param: 'cutoff', points: '64:30 65:150 79.75:3000 80:30' },
    // a spring splash on the rim, twice
    { track: 'Drums', insert: 'core.verb', param: 'mix', points: '53.9:0.1 54:0.5 56:0.5~0.3 57:0.1 69.9:0.1 70:0.5 72:0.5~0.3 73:0.1' },
  ]);
  return p;
}
export default make;
