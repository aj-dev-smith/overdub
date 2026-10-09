// @ts-check
// core.metalkit: Rusty Sticks. A real kit played with sticks, made for heavy music: Big Rusty Drums (Karoryfer Samples,
// CC0), the big Polish kit Rusty Brushes plays, here hit with sticks, each drum mixed from its close mic and the overhead
// pair (tools/kits/big-rusty-sticks.js has the blend and why; tools/fetch-kits.js builds it; docs/SOUNDS.md is its
// licence record). docs/DEVICES.md "Rusty Sticks" is what it does.
//
// What it plays: Studio A's note map (so grooves and agents write one map): a kick with four strokes in each of five
// layers, a snare with rimshots and a side stick, seven ways of playing the hi-hat, four toms (the 22" is a kick laid on
// its side), a ride (bow, bell, edge), a crash, a sizzle crash, a China, a three-cymbal stack, and chokes. The kernel is
// drumsampler.js with four options:
//   - the stroke picker never repeats: each hit draws from its layer and the nearer neighbour layer, never either of the
//     last two strokes on that piece nor a near twin of the last, with a seeded +-0.4 dB and +-4 cents of its own (no
//     machine gun at 16ths);
//   - TIGHT: a new kick fades the last one over TIGHT ms, and each kick's tail is held to it;
//   - the trigger: a synthesized click and sub under the kick, the "trigger" of modern metal, consistent by
//     construction, starting at the stroke's attack with the stroke's own polarity;
//   - the room: each piece sends into a small live room (kitroom.js), snare most, kick least.
// Every stroke starts 1.0 ms before its attack, and the kernel declares that millisecond with its limiter's look-ahead
// as latency, so in a song the hits land on the grid with everything else.
// A missing kit plays the trigger alone (a click and a sub on the kick notes), and the studio says the kit is missing.
import { defineDevice } from '../registry.js';
import { drumSamplerKernel, pieceLevel } from './drumsampler.js';
import { KITROOM } from './kitroom.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const METALKIT_HASH = 'sha256-9e0becc0ce4f330d152bb27466130ff581bd4933ea08ed3eaeac18bdc7c5c9aa';

// The note map: [MIDI note, piece, name], on Studio A's numbers.
export const NOTE_MAP = [
  [35, 'kick', 'Kick (35)'], [36, 'kick', 'Kick'],
  [38, 'snare', 'Snare'], [40, 'rim', 'Rimshot'], [37, 'stick', 'Side stick'],
  [42, 'hat', 'Hat closed'], [22, 'hattight', 'Hat tight'], [44, 'hatpedal', 'Hat pedal'], [23, 'hatq', 'Hat open 1/4'],
  [24, 'hathalf', 'Hat open 1/2'], [46, 'hatopen', 'Hat open'], [21, 'hatsplash', 'Hat foot splash'],
  [48, 'tom1', 'Rack tom 1 (48)'], [50, 'tom1', 'Rack tom 1'], [47, 'tom2', 'Rack tom 2'], [45, 'tom3', 'Floor tom 1'],
  [43, 'tom4', 'Floor tom 2'], [41, 'tom4', 'Floor tom 2 (41)'],
  [49, 'crash', 'Crash'], [57, 'crash2', 'Crash 2 (sizzle)'], [52, 'china', 'China'], [55, 'stack', 'Stack'],
  [51, 'ride', 'Ride'], [53, 'bell', 'Ride bell'], [59, 'rideedge', 'Ride edge'],
  [27, 'crashchoke', 'Crash choke'], [28, 'crash2choke', 'Crash 2 choke'], [29, 'chinachoke', 'China choke'], [25, 'ridechoke', 'Ride choke'],
];
const NOTE_NAMES = Object.fromEntries([...NOTE_MAP.map(([n, , name]) => [n, name]), ['other', 'Not in this kit']]);
export const PIECES = ['kick', 'snare', 'rim', 'stick', 'hattight', 'hat', 'hatpedal', 'hatq', 'hathalf', 'hatopen', 'hatsplash',
  'tom1', 'tom2', 'tom3', 'tom4', 'ride', 'bell', 'rideedge', 'crash', 'crash2', 'china', 'stack', 'ridechoke', 'crashchoke', 'crash2choke', 'chinachoke'];
export const LEVEL_OF = {
  kick: 'kick', snare: 'snare', rim: 'snare', stick: 'snare',
  hattight: 'hat', hat: 'hat', hatpedal: 'hat', hatq: 'hat', hathalf: 'hat', hatopen: 'hat', hatsplash: 'hat',
  tom1: 'toms', tom2: 'toms', tom3: 'toms', tom4: 'toms',
  ride: 'ride', bell: 'ride', rideedge: 'ride', ridechoke: 'ride',
  crash: 'crash', crash2: 'crash', stack: 'crash', crashchoke: 'crash', crash2choke: 'crash',
  china: 'china', chinachoke: 'china',
};
const HATS = ['hattight', 'hat', 'hatpedal', 'hatq', 'hathalf', 'hatopen', 'hatsplash'];
const CYMBALS = ['ride', 'bell', 'rideedge', 'crash', 'crash2', 'china', 'stack', 'ridechoke', 'crashchoke', 'crash2choke', 'chinachoke'];
// the room sends: the snare most, then the toms, the cymbals, the hats, the kick least
const SEND = { kick: 0.1, snare: 1, rim: 1, stick: 1, tom1: 0.8, tom2: 0.8, tom3: 0.8, tom4: 0.8, ...Object.fromEntries(HATS.map((h) => [h, 0.15])), ...Object.fromEntries(CYMBALS.map((c) => [c, 0.3])) };

// the kernel's shape beyond the note map (drumsampler.js has the words for each)
export const KIT_OPTIONS = {
  choke: {
    ...Object.fromEntries(HATS.map((h) => [h, [1, h === 'hatopen' || h === 'hathalf' || h === 'hatsplash' || h === 'hatq' ? 80 : 30]])),
    ride: [2, 400], bell: [2, 400], rideedge: [2, 400], ridechoke: [2, 40],
    crash: [3, 400], crashchoke: [3, 40], crash2: [4, 400], crash2choke: [4, 40], china: [5, 400], chinachoke: [5, 40],
  },
  // the house level: the drum test phrase at -16.7 LUFS, true peak -1.4 dBTP (the limiter takes snares and rimshots
  // at velocity 0.8 and up by 4 to 10 dB; the snare's crest over its first 100 ms stays 15 dB)
  makeup: 2.6,
  // each piece against the others under its knob, dB: the recipe brings every piece to -1 dBFS at its loudest, so these
  // set the mix. Measured without the makeup, room off, as each piece's loudness over 400 ms at velocity 0.8 against the
  // snare's: rimshots 2 over, the toms 1 under, crashes and China 4 under, the ride 8 under, closed hats 8 under. The
  // kick, with its trigger (whose click sets its peak), sits where a kick at velocity 0.8 just misses the limiter:
  // at -4.9 every kick from 0.5 up came out at one peak (the limiter took 1.7 to 6.5 dB) and the cymbals above 9 kHz
  // dipped up to 5 dB under a double kick (2 now, as with no limiter); here a kick at 0.5, 0.8 and 1 peaks at -6.6,
  // -2.7 and -2.0 dBFS, and over 16 quarter notes it is 2.7 LU under the snare (it was 1)
  offset: { kick: -10.5, snare: -1.3, rim: 2.5, stick: -8.1, hat: -6, hattight: -5.8, hatpedal: -9.4, hatq: -9, hathalf: -8.3, hatopen: -8.3, hatsplash: -12.7,
    tom1: -1.7, tom2: -5, tom3: -3.3, tom4: -5.5, ride: -8.3, bell: -2.5, rideedge: -13.5, ridechoke: -10,
    crash: -5.9, crash2: -14.6, stack: -15.7, crashchoke: -10, crash2choke: -14, china: -10.4, chinachoke: -12 },
  // after a stroke, its near twins (over 0.99 alike in their first 30 ms) are passed over: Big Rusty's kick round robins
  // of one layer correlate 0.99-0.9999 with each other, so without this half the hits of a double kick at 200 BPM came out
  // over 0.995 alike (the machine gun); with it none do
  rr: 'norepeat', similar: 0.99,
  tight: { piece: 'kick', key: 'tight', hold: 3, t60: 20 },
  trigger: { piece: 'kick', ref: -21.3, ck: 5.2, sk: 2, imp: 2 },
  room: { send: SEND, gain: 3, src: KITROOM },
  onset: 0.001,
};

export default defineDevice({
  id: 'core.metalkit', name: 'Rusty Sticks', kind: 'instrument', cat: 'drums', by: 'overdub',
  blurb: 'A real kit hit hard with sticks, sampled, with a kick trigger and a room',
  nod: 'Big Rusty Drums (Karoryfer Samples, CC0): close mics and overheads, four strokes a layer on the kick and snare, and the click-and-sub kick reinforcement of modern metal records',
  notes: NOTE_NAMES,
  data: { kit: METALKIT_HASH },
  params: [
    { key: 'tune', label: 'TUNE', min: -12, max: 12, def: 0, unit: 'st', role: 'pitch', group: 'kit', desc: 'every piece up or down, semitones (by resampling: lower is longer)' },
    { key: 'decay', label: 'DECAY', min: 5, max: 100, def: 100, unit: '%', role: 'decay', group: 'kit', desc: 'how long each stroke rings: 100% is the recording, lower gates it shorter' },
    { key: 'tone', label: 'TONE', min: -100, max: 100, def: 0, unit: '%', role: 'tone', group: 'kit', desc: 'a tilt around 900 Hz: below 0 darker, above 0 brighter (up to 6 dB each way at the ends); 0 is the recording' },
    { key: 'tight', label: 'TIGHT', min: 5, max: 60, def: 18, unit: 'ms', role: 'decay', group: 'kit', desc: 'the kick: a new kick fades the last over this many ms, and each kick rings about ten times this before it falls away (lower is tighter, for fast double kick)' },
    { key: 'level', label: 'LEVEL', min: -24, max: 6, def: 0, unit: 'dB', role: 'level', group: 'kit', desc: 'the whole kit' },
    { key: 'click', label: 'CLICK', min: -40, max: 6, def: -12, unit: 'dB', role: 'tone', group: 'trigger', desc: 'the trigger\'s click on every kick: a 2-6 kHz beater snap, 4 ms (-40 is off)' },
    { key: 'sub', label: 'SUB', min: -40, max: 6, def: -10, unit: 'dB', role: 'level', group: 'trigger', desc: 'the trigger\'s sub on every kick: a sine that drops an octave onto SUB HZ and dies with TIGHT (-40 is off)' },
    { key: 'sub_hz', label: 'SUB HZ', min: 40, max: 70, def: 52, unit: 'Hz', role: 'pitch', group: 'trigger', desc: 'the sub\'s pitch: tune it to the song\'s low note' },
    { key: 'trig_vel', label: 'TRIG VEL', min: 0, max: 1, def: 0.5, role: 'shape', group: 'trigger', desc: 'how much the kick\'s velocity moves the trigger: 0 every hit the same, 1 as loud as the stroke' },
    { key: 'room', label: 'ROOM', min: -40, max: 6, def: -14, unit: 'dB', role: 'mix', group: 'room', desc: 'the kit\'s room: the snare most, the toms, the cymbals, the hats and the kick least (-40 is off)' },
    { key: 'room_size', label: 'ROOM SIZE', min: 0, max: 1, def: 0.4, role: 'size', group: 'room', desc: 'a tight booth (0) to a big live room (1): 0.5 to 1.4 s' },
    pieceLevel('kick', 'the kick and its trigger'),
    pieceLevel('snare', 'the snare: centre, rimshot and side stick'),
    pieceLevel('hat', 'the hi-hat, every way it is played'),
    pieceLevel('toms', 'all four toms'),
    pieceLevel('ride', 'the ride: bow, bell and edge'),
    pieceLevel('crash', 'both crashes and the stack'),
    pieceLevel('china', 'the China'),
  ],
  presets: [
    { name: 'Modern', params: {}, blurb: 'the trigger on, a short room: a produced metal kit' },
    { name: 'Natural', params: { click: -40, sub: -40, room: -8, tight: 30 }, blurb: 'no trigger, more room: the kit as it sounds in the room' },
    { name: 'Tight', params: { tight: 10, room: -24 }, blurb: 'the kick gated hard, the room low: for blasts and fast double kick' },
  ],
  look: { color: '#26262a', ink: '#e8e4dc', shape: 'wide', finish: 'brushed', knob: 'black', label: 'stencil', led: '#ff5a36' },
  tail: 6,
  kernel: drumSamplerKernel({ pieces: PIECES, levelOf: LEVEL_OF, note: Object.fromEntries(NOTE_MAP.map(([n, piece]) => [n, piece])), ...KIT_OPTIONS }),
});
