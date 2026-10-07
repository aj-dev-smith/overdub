// core.handkit: Hand Crate. Hand and aux percussion, sampled: a cajon, congas, bongos, shakers, tambourines, a
// cowbell, claves, a woodblock, an agogo and a guiro, and a tambourine roll that rings while its note is held from VCSL (Versilian Studios, CC0), through VCSL's stereo pair.
// docs/DEVICES.md "Hand Crate" is what it does; tools/fetch-kits.js builds the kit (tools/kits/vcsl-hand.js pins every
// upstream file); docs/SOUNDS.md is its licence record.
//
// It plays General MIDI's percussion notes where they are (60-64 bongos and congas, 54 tambourine, 56 cowbell, 67
// agogo, 70 and 82 shakers, 73 guiro, 75 claves, 76-77 woodblock), and a drum kit's notes as a hand player would: the
// kick is the cajon's bass, the snare its slap, the hats a shaker and a tambourine, the toms the congas. So any beat
// written for a kit plays on it. The kernel is drumsampler.js (as Rusty Brushes): velocity crossfades between layers
// along their measured levels, strokes from the instance's seed, a muted conga stops the open one, and a true-peak
// limiter on the output. A missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { drumSamplerKernel, pieceLevel, KIT_PARAMS } from './drumsampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const HAND_HASH = 'sha256-a449e40fb8b4140342b680823a4d0fbcfae079e2baf03d286b17f2b1cfec1ec7';

// The note map: [MIDI note, piece, name].
export const NOTE_MAP = [
  [35, 'cajonbass', 'Cajon bass (35)'], [36, 'cajonbass', 'Cajon bass'],
  [38, 'cajonslap', 'Cajon slap'], [40, 'cajonslap', 'Cajon slap (40)'],
  [42, 'shaker', 'Shaker (42)'], [44, 'shaker', 'Shaker (44)'], [82, 'shaker', 'Shaker'],
  [46, 'tambourine', 'Tambourine (46)'], [54, 'tambourine', 'Tambourine'], [33, 'tambroll', 'Tambourine roll (held)'],
  [69, 'shakerbig', 'Big shaker (69)'], [70, 'shakerbig', 'Big shaker'],
  [56, 'cowbell', 'Cowbell'],
  [60, 'bongohi', 'High bongo'], [61, 'bongolo', 'Low bongo'],
  [62, 'congamute', 'Conga, muted'], [63, 'congaopen', 'Conga, open'], [64, 'tumba', 'Low conga'],
  [50, 'congaopen', 'Conga (50)'], [48, 'congaopen', 'Conga (48)'], [47, 'congaopen', 'Conga (47)'],
  [45, 'tumba', 'Low conga (45)'], [43, 'tumba', 'Low conga (43)'], [41, 'tumba', 'Low conga (41)'],
  [67, 'agogo', 'Agogo'], [73, 'guiro', 'Guiro'], [75, 'claves', 'Claves'],
  [76, 'woodblock', 'Woodblock'], [77, 'woodblock', 'Woodblock (77)'],
];
const NOTE_NAMES = Object.fromEntries([...NOTE_MAP.map(([n, , name]) => [n, name]), ['other', 'Not in this kit']]);
export const PIECES = ['cajonbass', 'cajonslap', 'congaopen', 'congamute', 'tumba', 'bongohi', 'bongolo', 'shaker', 'shakerbig', 'tambourine', 'tambroll', 'cowbell', 'claves', 'woodblock', 'agogo', 'guiro'];
const LEVEL_OF = { cajonbass: 'cajon', cajonslap: 'cajon', congaopen: 'congas', congamute: 'congas', tumba: 'congas', bongohi: 'bongos', bongolo: 'bongos', shaker: 'shakers', shakerbig: 'shakers', tambourine: 'shakers', tambroll: 'shakers', guiro: 'shakers', cowbell: 'bells', agogo: 'bells', claves: 'bells', woodblock: 'bells' };

export default defineDevice({
  id: 'core.handkit', name: 'Hand Crate', kind: 'instrument', cat: 'drums', by: 'overdub',
  blurb: 'Real hand percussion, sampled: cajon, congas, shakers and more',
  nod: 'VCSL (Versilian Studios, CC0): hand and aux percussion, up to three velocity layers each',
  notes: NOTE_NAMES,
  data: { kit: HAND_HASH },
  params: [
    ...KIT_PARAMS,
    pieceLevel('cajon', 'the cajon, bass and slap', -3),
    pieceLevel('congas', 'the congas, open, muted and low', 6),
    pieceLevel('bongos', 'both bongos', 6),
    pieceLevel('shakers', 'the shakers, tambourine and guiro', 6),
    pieceLevel('bells', 'the cowbell, agogo, claves and woodblock', 3),
  ],
  presets: [
    { name: 'Crate', params: {}, blurb: 'the cajon eased back, the hand drums and shakers forward' },
    { name: 'As recorded', params: { cajon_level: 0, congas_level: 0, bongos_level: 0, shakers_level: 0, bells_level: 0 }, blurb: "every knob at 0" },
    { name: 'Shakers up', params: { shakers_level: 4, bells_level: -3 }, blurb: 'the shakers and tambourine forward' },
    { name: 'Dark', params: { tone: -60 }, blurb: 'tilted down, for under a vocal' },
    { name: 'Tight', params: { decay: 45 }, blurb: 'every stroke gated shorter' },
    { name: 'No bells', params: { bells_level: -40 }, blurb: 'drums and shakers only' },
  ],
  look: { color: '#7a5a2e', ink: '#fbf0dc', shape: 'wide', finish: 'wood', knob: 'cream', label: 'stencil', led: '#ffd27a' },
  tail: 3,
  kernel: drumSamplerKernel({
    pieces: PIECES, levelOf: LEVEL_OF,
    note: Object.fromEntries(NOTE_MAP.map(([n, piece]) => [n, piece])),
    choke: { congaopen: [1, 60], congamute: [1, 30] },
    metal: { shaker: 1, shakerbig: 1, tambourine: 1, tambroll: 1, guiro: 1 },
    held: { tambroll: [30, 120] },
    makeup: 1.6,
    offset: { shaker: 10, guiro: 12, claves: 4, agogo: 6, tumba: 3 },   // (VCSL recorded these quieter than their neighbours)
    even: true,   // (VCSL's strokes of one layer are up to 6.6 dB apart: each plays at its layer's level)
  }),
});
