// "Lobby Bar": bossa nova, 32 bars in D minor at 136 bpm. A nylon-string guitar on the DI Box plays the batida (the
// thumb's two beats left to the bass, the fingers' two-bar pattern pushed off the beat) on four-note voicings that
// move a step at a time: Dm9, Em7b5, A7b9 in the A section, then a bridge through Bbmaj9, Am7, D7b9, Gm9, C13 and
// Fmaj9, and a coda that leans on Ebmaj9 (the flat second) before a Dm6/9. A Flatwound bass plays the surdo (the root
// on one, the fifth on three, each pushed by an eighth), an ACOUSTIC+ kit plays cross-stick, shaker and a feathered
// kick, and Music Stands come in under the bridge. The house played all of that. Claude played over it: the tune, on
// the Mallet Bag's vibes with the motor turning.
// Mixed by measurement (tools/demos-test.js); levels in the test.

import { AGENT, clip, fx, track, bars, grid, groove, chordHits, demo } from './lib.js';

export const META = {
  id: 'lobby-bar',
  title: 'Lobby Bar',
  genre: 'Bossa nova',
  line: 'nylon guitar and a soft kit, the vibes by Claude',
  tempo: 136,
  key: 'D minor',
};

// [voicing, root] per half bar; a bar of one chord is two of the same
const C = {
  Dm9: [[50, 53, 57, 60, 64], 38], // D F A C E
  Em7b5: [[55, 58, 62, 64], 40], // G Bb D E
  A7b9: [[55, 58, 61, 64], 33], // G Bb C# E
  Gm9: [[53, 57, 58, 62], 43], // F A Bb D
  C13: [[52, 57, 58, 62], 36], // E A Bb D
  Fmaj9: [[52, 55, 57, 60], 41], // E G A C
  E7b5: [[52, 55, 58, 62], 40], // the Em7b5 again, lower (E G Bb D)
  A7b9lo: [[52, 55, 58, 61], 33], // E G Bb C#
  Bbmaj9: [[53, 57, 60, 62], 34], // F A C D
  Am7: [[55, 57, 60, 64], 45], // G A C E
  D7b9: [[54, 57, 60, 63], 38], // F# A C Eb
  Ebmaj9: [[55, 58, 62, 65], 39], // G Bb D F
  Dm69: [[50, 53, 57, 59, 64], 38], // D F A B E
};
const bar = (a, b = a) => [C[a], C[b]];
const INTRO = [bar('Dm9'), bar('Ebmaj9'), bar('Dm9'), bar('Ebmaj9')];
const A = [
  bar('Dm9'),
  bar('Dm9'),
  bar('Em7b5'),
  bar('A7b9'),
  bar('Dm9'),
  bar('Gm9', 'C13'),
  bar('Fmaj9'),
  bar('E7b5', 'A7b9lo'),
];
const B = [
  bar('Bbmaj9'),
  bar('Bbmaj9'),
  bar('Am7'),
  bar('D7b9'),
  bar('Gm9'),
  bar('C13'),
  bar('Fmaj9'),
  bar('E7b5', 'A7b9lo'),
];
const CODA = [bar('Dm9'), bar('Ebmaj9'), bar('Dm9'), bar('Dm69')];
const SONG = [...INTRO, ...A, ...B, ...A, ...CODA];

// the tune, [pitch, beat, length] over eight bars
const TUNE_A = [
  [69, 1, 0.5],
  [72, 1.5, 0.5],
  [76, 2, 1.5],
  [74, 3.5, 2],
  [72, 5.5, 0.5],
  [69, 6, 1.5],
  [70, 8.5, 0.5],
  [74, 9, 0.5],
  [76, 9.5, 0.5],
  [79, 10, 1.5],
  [76, 11.5, 0.5],
  [70, 12, 1],
  [73, 13, 0.5],
  [76, 13.5, 0.5],
  [79, 14, 1],
  [77, 15, 0.5],
  [76, 15.5, 0.5],
  [77, 16, 2],
  [76, 18, 0.5],
  [74, 18.5, 0.5],
  [72, 19, 1],
  [70, 20.5, 0.5],
  [74, 21, 0.5],
  [77, 21.5, 0.5],
  [81, 22, 1.5],
  [79, 23.5, 0.5],
  [76, 24, 1.5],
  [72, 25.5, 0.5],
  [69, 26, 1.5],
  [67, 27.5, 0.5],
  [70, 28, 1],
  [67, 29, 0.5],
  [64, 29.5, 0.5],
  [73, 30, 1],
  [69, 31, 1],
];
const TUNE_B = [
  [77, 0, 0.5],
  [81, 0.5, 1.5],
  [79, 2, 0.5],
  [77, 2.5, 0.5],
  [74, 3, 1],
  [72, 4.5, 0.5],
  [74, 5, 0.5],
  [77, 5.5, 0.5],
  [81, 6, 2],
  [79, 8, 1],
  [76, 9, 0.5],
  [72, 9.5, 0.5],
  [76, 10, 1.5],
  [79, 11.5, 0.5],
  [78, 12, 1.5],
  [75, 13.5, 0.5],
  [72, 14, 1],
  [69, 15, 1],
  [70, 16, 0.5],
  [74, 16.5, 0.5],
  [77, 17, 0.5],
  [81, 17.5, 1.5],
  [79, 19, 1],
  [76, 20, 1.5],
  [74, 21.5, 0.5],
  [70, 22, 1],
  [69, 23, 1],
  [69, 24.5, 0.5],
  [72, 25, 0.5],
  [76, 25.5, 0.5],
  [79, 26, 2],
  [76, 28, 0.5],
  [74, 28.5, 0.5],
  [70, 29, 1],
  [73, 30, 0.5],
  [76, 30.5, 0.5],
  [79, 31, 0.5],
  [76, 31.5, 0.5],
];
const TUNE_CODA = [
  [74, 1, 0.5],
  [77, 1.5, 0.5],
  [81, 2, 2],
  [79, 4, 0.5],
  [81, 4.5, 2.5],
  [77, 8, 1.5],
  [74, 9.5, 2.5],
  [74, 13, 2.9],
];

export function make() {
  const n = SONG.length; // 32
  const sec = (b) => (b < 4 ? 'intro' : b < 12 ? 'a' : b < 20 ? 'b' : b < 28 ? 'a2' : 'coda');

  // guitar: the fingers' two-bar pattern in eighths (1, the and of 2, 4 | the and of 1, 3, the and of 4), released
  // short; the last eighth of a bar already plays the next bar's chord (the push); in the intro and coda the thumb
  // plays the roots on one and three
  const PAT = [
    [0, 0.45, 0.62],
    [1.5, 0.45, 0.5],
    [3, 0.45, 0.56],
    [4.5, 0.45, 0.5],
    [6, 0.45, 0.6],
    [7.5, 0.45, 0.48],
  ];
  const guitar = groove(
    bars(
      n / 2,
      (k) => {
        const out = [];
        for (const [t, d, v] of PAT) {
          const push = t % 4 === 3.5 && 2 * k + Math.floor(t / 4) < n - 1;
          const b = 2 * k + Math.floor(t / 4) + (push ? 1 : 0),
            half = push ? 0 : Math.floor((t % 4) / 2),
            [vo] = SONG[b][half];
          const last = b === n - 1;
          out.push(...chordHits(vo, [[t, last && t >= 6 ? 2 : d, last ? 0.55 : v]]));
        }
        for (let i = 0; i < 2; i++) {
          const b = 2 * k + i;
          if (sec(b) === 'intro' || sec(b) === 'coda')
            for (const [half, at] of [
              [0, 0],
              [1, 2],
            ])
              out.push({ p: SONG[b][half][1] + 12, t: i * 4 + at, d: 1.6, v: 0.5 });
        }
        return out;
      },
      8,
    ),
    { seed: 3, vel: 0.07, time: 0.006 },
  );

  // bass: the surdo, root on one and the fifth on three, each pushed by the eighth before; out in the intro
  const bass = groove(
    bars(n, (b) => {
      const s = sec(b);
      if (s === 'intro') return [];
      const [[, r1], [, r2]] = SONG[b];
      if (b === n - 1) return [{ p: r1, t: 0, d: 3.8, v: 0.8 }];
      const nr = SONG[b + 1][0][1];
      const fifth = (r) => (r + 7 > 45 ? r - 5 : r + 7);
      const three = r2 === r1 ? fifth(r1) : r2; // the fifth, or the new root when the chord changes on three
      return [
        { p: r1, t: 0, d: 1.4, v: 0.86 },
        { p: three, t: 1.5, d: 0.4, v: 0.55 },
        { p: three, t: 2, d: 1.4, v: 0.8 },
        { p: nr, t: 3.5, d: 0.4, v: 0.6 },
      ];
    }),
    { seed: 5, vel: 0.05, time: 0.005 },
  );

  // drums: a cross-stick clave over two bars, a shaker on the sixteenths, the kick feathered with the bass, a pedal
  // hat on two and four; brighter (the ride) in the bridge
  const CLAVE = ['x.....x.....x...', '....x.....x.....'];
  const kit = groove(
    bars(n, (b) => {
      const s = sec(b);
      if (s === 'intro') return b >= 2 ? grid({ shaker: 'x-o-x-o-x-o-x-o-' }) : [];
      const rows = {
        kick: 'x.....o.x.....o.',
        rim: CLAVE[b % 2],
        shaker: 'x-o-x-o-x-o-x-o-',
        pedal: '....o.......o...',
      };
      if (s === 'b') {
        rows.ride = 'o.-.o.-.o.-.o.-.';
        delete rows.shaker;
      }
      if (s === 'coda') {
        if (b === n - 1) return grid({ kick: 'o...............', ride: 'o...............' });
      }
      const g = grid(rows);
      if (b === 4 || b === 20) g.push({ p: 49, t: 0, d: 2, v: 0.35 });
      if (b === 11 || b === 19) g.push(...grid({ snare: '..........o.o-oo' }));
      return g;
    }),
    { seed: 11, push: { 70: -0.006, 37: 0.008 }, vel: 0.12, time: 0.006 },
  );

  // strings: the bridge's chords held high, the tops an octave up; a long Dm9 to close
  const strings = bars(n, (b) => {
    if (sec(b) === 'b')
      return SONG[b][0] === SONG[b][1]
        ? SONG[b][0][0].slice(1).map((p) => ({ p: p + 12, t: 0, d: 3.9, v: 0.5 }))
        : [0, 1].flatMap((h) => SONG[b][h][0].slice(1).map((p) => ({ p: p + 12, t: h * 2, d: 1.9, v: 0.5 })));
    if (b === n - 2) return C.Dm9[0].slice(1).map((p) => ({ p: p + 12, t: 0, d: 7.8, v: 0.45 }));
    return [];
  });

  // Claude's vibes: the tune through the A section, the bridge and the A again, a few long notes in the coda
  const tune = [
    ...TUNE_A.map(([p, t, d]) => [p, t + 16, d]),
    ...TUNE_B.map(([p, t, d]) => [p, t + 48, d]),
    ...TUNE_A.map(([p, t, d]) => [p, t + 80, d]),
    ...TUNE_CODA.map(([p, t, d]) => [p, t + 112, d]),
  ];
  const vibes = groove(
    tune.map(([p, t, d], i) => ({ p, t, d: d * 0.9, v: 0.62 + ((i * 3) % 5) * 0.04 + (t % 2 === 0 ? 0.04 : 0) })),
    { seed: 13, vel: 0.05, time: 0.008 },
  );

  return demo({
    title: META.title,
    tempo: META.tempo,
    key: { root: 'D', scale: 'minor' },
    bars: n,
    sections: [
      ['Intro', 0, 4],
      ['A', 4, 8],
      ['Bridge', 12, 8],
      ['A again', 20, 8],
      ['Coda', 28, 4],
    ],
    tracks: [
      track({
        name: 'Drums',
        color: 'var(--c-1)',
        device: 'core.drums',
        params: { kit: 5, tune: 1, decay: 0.9, tone: -0.15, drive: 0, width: 0.6, room: 0.35 },
        clips: [clip(0, 128, kit, 'Cross-stick')],
        gain: 0,
      }),
      track({
        name: 'Bass',
        color: 'var(--c-5)',
        device: 'core.bassguitar',
        params: { style: 0, tone: 0.3, pickup: 0.15, sustain: 0.9, mute: 0.12, drive: 0.1 },
        clips: [clip(0, 128, bass, 'Surdo')],
        gain: -3,
      }),
      track({
        name: 'Guitar',
        color: 'var(--c-3)',
        device: 'core.guitar',
        params: { body: 1, pick: 0.55, tone: 0.45, decay: 1, strum: 4, mute: 0 },
        inserts: [fx('core.verb', { size: 0.35, decay: 1.2, mix: 0.12 })],
        clips: [clip(0, 128, guitar, 'Batida')],
        gain: -1.5,
        pan: -0.15,
      }),
      track({
        name: 'Strings',
        color: 'var(--c-7)',
        device: 'core.strings',
        params: { attack: 0.8, release: 1, bright: 0.4, vibrato: 0.4, ensemble: 0.5, width: 0.7, hall: 0.4 },
        clips: [clip(0, 128, strings, 'Bridge')],
        gain: 0,
      }),
      track({
        name: 'Vibes',
        color: 'var(--c-2)',
        device: 'core.mallets',
        params: { bar: 1, mallet: 0.4, decay: 1.1, damp: 0.5, motor: 4.5, width: 0.5, room: 0.3 },
        clips: [clip(0, 128, vibes, 'Tune', AGENT)],
        gain: 2.5,
        pan: 0.15,
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
