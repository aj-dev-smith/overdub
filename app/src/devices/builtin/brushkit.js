// @ts-check
// core.brushkit: Rusty Brushes. A kit played with brushes and mallets, where Virtuosity Kit is played with sticks: Big
// Rusty Drums (Karoryfer Samples, CC0), a big Polish kit from about 1980, recorded through one stereo pair of overheads
// and played from samples. docs/DEVICES.md "Rusty Brushes" is what it does; tools/fetch-kits.js builds the kit
// (tools/kits/big-rusty.js pins every upstream file); docs/SOUNDS.md is its licence record.
//
// What it plays. Thirteen articulations: the kick (felt beater); brushes on the snare (taps, digs for accents, a stir
// that rings while its note is held, the brush lifting off), on the hi-hat (closed, quarter open, open, the pedal) and
// on the ride; mallets on the crash and on a rack and a floor tom. Two to four velocity layers of two strokes each.
// The kernel is drumsampler.js: velocity crossfades between layers along their measured levels, the strokes come from
// the instance's seed, the hats choke each other, and the output runs into a true-peak limiter. The stir loops while
// its note is held and fades out over 150 ms after it.
// A missing kit (the samples were never fetched, or a song names a kit this server doesn't have) plays nothing, and
// the studio says so.
import { defineDevice } from '../registry.js';
import { drumSamplerKernel, pieceLevel, KIT_PARAMS } from './drumsampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const BRUSH_HASH = 'sha256-653ce5fbd513951101d8c0b81d2a11e9177b89e8588ca403074003b1eb917ba3';

// The note map: [MIDI note, piece, name]. General MIDI, Studio A's half-open hat and held roll, and Big Rusty's own
// notes for its stir (73, 74) and dig (76).
export const NOTE_MAP = [
  [35, 'kick', 'Kick (35)'],
  [36, 'kick', 'Kick'],
  [38, 'snare', 'Snare, brush'],
  [40, 'dig', 'Snare dig (accent)'],
  [76, 'dig', 'Snare dig (76)'],
  [33, 'swirl', 'Snare swirl (held)'],
  [73, 'swirl', 'Snare swirl (73)'],
  [74, 'swirl', 'Snare swirl (74)'],
  [77, 'sweep', 'Brush lift-off'],
  [42, 'hat', 'Hat closed, brush'],
  [22, 'hat', 'Hat closed (22)'],
  [44, 'hatpedal', 'Hat pedal'],
  [46, 'hatopen', 'Hat open, brush'],
  [26, 'hatopen', 'Hat open (26)'],
  [24, 'hathalf', 'Hat 1/4 open, brush'],
  [23, 'hathalf', 'Hat 1/4 open (23)'],
  [51, 'ride', 'Ride, brush'],
  [59, 'ride', 'Ride (59)'],
  [49, 'crash', 'Crash, mallet'],
  [57, 'crash', 'Crash (57)'],
  [50, 'tomhi', 'High tom, mallet'],
  [48, 'tomhi', 'High tom (48)'],
  [47, 'tomhi', 'High tom (47)'],
  [45, 'tomlo', 'Floor tom, mallet'],
  [43, 'tomlo', 'Floor tom (43)'],
  [41, 'tomlo', 'Floor tom (41)'],
];
const NOTE_NAMES = Object.fromEntries([...NOTE_MAP.map(([n, , name]) => [n, name]), ['other', 'Not in this kit']]);
export const PIECES = [
  'kick',
  'snare',
  'dig',
  'swirl',
  'sweep',
  'hat',
  'hathalf',
  'hatopen',
  'hatpedal',
  'ride',
  'crash',
  'tomhi',
  'tomlo',
];
const LEVEL_OF = {
  kick: 'kick',
  snare: 'snare',
  dig: 'snare',
  sweep: 'snare',
  swirl: 'swirl',
  hat: 'hat',
  hathalf: 'hat',
  hatopen: 'hat',
  hatpedal: 'hat',
  ride: 'ride',
  crash: 'crash',
  tomhi: 'toms',
  tomlo: 'toms',
};

export default defineDevice({
  id: 'core.brushkit',
  name: 'Rusty Brushes',
  kind: 'instrument',
  cat: 'drums',
  by: 'overdub',
  blurb: 'A real kit played with brushes and mallets, sampled',
  nod: 'Big Rusty Drums (Karoryfer Samples, CC0): brushes and mallets on a big old kit, two strokes per layer',
  notes: NOTE_NAMES,
  data: { kit: BRUSH_HASH },
  params: [
    ...KIT_PARAMS,
    pieceLevel('kick', 'the kick', -4),
    pieceLevel('snare', 'the snare: brush taps, digs and the lift-off', 4),
    pieceLevel('swirl', 'the snare swirl', 6),
    pieceLevel('hat', 'the hi-hat, every way it is played'),
    pieceLevel('toms', 'both toms', -3),
    pieceLevel('ride', 'the ride', 8),
    pieceLevel('crash', 'the crash', -2),
  ],
  presets: [
    { name: 'Brushes', params: {}, blurb: 'the pair, balanced for a quiet room' },
    {
      name: 'As recorded',
      params: {
        kick_level: 0,
        snare_level: 0,
        swirl_level: 0,
        hat_level: 0,
        toms_level: 0,
        ride_level: 0,
        crash_level: 0,
      },
      blurb: "the overhead pair's own balance",
    },
    { name: 'Swirl forward', params: { swirl_level: 4, ride_level: -3 }, blurb: 'the stir up front, the ride back' },
    { name: 'Dark', params: { tone: -60, crash_level: -3 }, blurb: 'tilted down, the cymbals back' },
    { name: 'Tight', params: { decay: 45 }, blurb: 'every stroke gated shorter' },
    { name: 'No cymbals', params: { ride_level: -40, crash_level: -40 }, blurb: 'drums and hats only, for layering' },
  ],
  look: {
    color: '#6b3f2a',
    ink: '#f4e6d4',
    shape: 'wide',
    finish: 'wood',
    knob: 'cream',
    label: 'plate',
    led: '#e8a05c',
  },
  tail: 6,
  kernel: drumSamplerKernel({
    pieces: PIECES,
    levelOf: LEVEL_OF,
    note: Object.fromEntries(NOTE_MAP.map(([n, piece]) => [n, piece])),
    choke: { hat: [1, 30], hatpedal: [1, 30], hathalf: [1, 80], hatopen: [1, 80] },
    metal: { hat: 1, hathalf: 1, hatopen: 1, hatpedal: 1, ride: 1, crash: 1, snare: 1, dig: 1, swirl: 1, sweep: 1 }, // (brushes are noise too)
    held: { swirl: [40, 150] },
    makeup: 2.66,
  }),
});
