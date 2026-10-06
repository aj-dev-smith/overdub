// core.drumroom: Studio A. An acoustic kit set up in a big tracking room, synthesized (no samples) and miked the way a
// recorded kit is: a close mic on each drum, a spaced pair of overheads, a pair of room mics and a crushed mono room.
// docs/research/STUDIO-A.md is the design note (the engine, the note map, the params, CPU, what comes next).
//
// How it plays. Every piece is one physical model that keeps ringing between hits, the way a drum does: a hit adds to
// what is already moving, so repeated strokes never sound alike (no machine-gun), a roll builds, a ride's wash grows.
//   membranes   (kick, snare, four toms) a head's modes (Bessel zeros, with the second head's partner), a shell
//               resonance, a stick or beater that pushes for a contact time that shortens as it hits harder (brighter),
//               a strike position that picks the modes (centre: fat; edge and rimshot: thin and ringing), tension
//               modulation (a hard hit bends the head up, then it settles), the stick's crack or the beater's slap
//   snare wires noise gated by the head's own motion over a threshold (the buzz follows the head), and a sympathetic
//               head resonance that the kick and toms excite, so the wires buzz when they ring
//   hi-hat      two plates' partials with an openness from 0 (clamped) to 1 (wide open) that sets how long they ring
//               and how much they sizzle; closing (a closed or pedal note, or the foot) chokes what was ringing, with
//               the chick of the plates meeting
//   cymbals     inharmonic partials plus three noise bands of wash that swell after the hit (the high band latest: the
//               energy climbing the spectrum), ride bow, bell and edge zones, chokes
// The voices the host hands out are only probes: each one times its note to the sample (the frames it renders before
// process() runs give its offset in the block) and reads the note's mod. The kit itself runs in process(), where the
// mic buses are shared: close (per piece, panned to the layout), overheads (each piece's distance to each overhead gives
// its time of flight and level: the stereo image is the kit's layout), room (distance, early reflections, a diffuse
// tail sized by room_size, mono under 120 Hz), crush (a mono room through a brick-wall compressor), and bleed (each
// piece leaking into the other close mics, by distance). The view switch mirrors the whole image (drummer's or
// audience's side). Each close mic and overhead runs into its own soft ceiling (a driven preamp rounding the hardest
// hits), and the mix into a stereo-linked true-peak limiter that looks 1.67 ms ahead (declared as latency, so the studio
// lines other tracks up): a natural kit's transients sit at -1 dBTP or under without clipping, and velocity still moves
// the level.
// A note the map doesn't name plays the side stick, quietly.
//
// The note map is NOTE_MAP below (also core/music.js DRUM_MAP and docs/DEVICES.md): General MIDI notes play what GM
// names; the articulations beyond GM have notes of their own. The def's `notes` names each one for the drum grid, the
// piano roll and agents (get_device). A hat note's mod (0..1), if it has one, sets how open the hats are for that hit;
// a held snare roll note rolls until it ends, and its mod, if any, swells it.
// Its window (`editor: 'drumroom'`, ui/editors/drumroom.js) draws the kit from LAYOUT, the same layout the mics are
// built from. Deterministic: every per-hit variation comes from the instance's seed, drawn in the order hits arrive.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export const PIECES = ['kick', 'snare', 'hat', 'tom1', 'tom2', 'tom3', 'tom4', 'crash1', 'crash2', 'ride', 'china', 'splash', 'tamb', 'cowbell', 'shaker', 'clap'];
// articulations, by piece (index = the code the kernel uses)
export const ARTS = {
  kick: ['hit'], snare: ['center', 'rimshot', 'sidestick', 'edge', 'flam', 'drag', 'roll'],
  hat: ['tip', 'edge', 'pedal', 'quarter', 'half', 'open', 'splash', 'openedge'],
  tom1: ['hit'], tom2: ['hit'], tom3: ['hit'], tom4: ['hit'],
  crash1: ['hit', 'choke'], crash2: ['hit', 'choke'], ride: ['bow', 'bell', 'edge', 'choke'], china: ['hit', 'choke'], splash: ['hit', 'choke'],
  tamb: ['hit'], cowbell: ['hit'], shaker: ['hit'], clap: ['hit'],
};
// The note map: [MIDI note, piece, articulation, what to call it]. GM notes first, then the articulations GM has no
// note for. This is the contract grooves, the drum editor and agents write to: notes are never renumbered.
export const NOTE_MAP = [
  [35, 'kick', 'hit', 'Kick (GM acoustic bass drum)'],
  [36, 'kick', 'hit', 'Kick'],
  [37, 'snare', 'sidestick', 'Side stick'],
  [38, 'snare', 'center', 'Snare'],
  [39, 'clap', 'hit', 'Clap'],
  [40, 'snare', 'rimshot', 'Rimshot (GM electric snare)'],
  [41, 'tom4', 'hit', 'Floor tom 2 (GM low floor tom)'],
  [42, 'hat', 'tip', 'Hat closed'],
  [43, 'tom4', 'hit', 'Floor tom 2'],
  [44, 'hat', 'pedal', 'Hat pedal'],
  [45, 'tom3', 'hit', 'Floor tom 1'],
  [46, 'hat', 'open', 'Hat open'],
  [47, 'tom2', 'hit', 'Rack tom 2'],
  [48, 'tom1', 'hit', 'Rack tom 1 (GM hi-mid tom)'],
  [49, 'crash1', 'hit', 'Crash'],
  [50, 'tom1', 'hit', 'Rack tom 1'],
  [51, 'ride', 'bow', 'Ride'],
  [52, 'china', 'hit', 'China'],
  [53, 'ride', 'bell', 'Ride bell'],
  [54, 'tamb', 'hit', 'Tambourine'],
  [55, 'splash', 'hit', 'Splash'],
  [56, 'cowbell', 'hit', 'Cowbell'],
  [57, 'crash2', 'hit', 'Crash 2'],
  [59, 'ride', 'edge', 'Ride edge (GM ride 2)'],
  [69, 'shaker', 'hit', 'Shaker (GM cabasa)'],
  [70, 'shaker', 'hit', 'Shaker'],
  [82, 'shaker', 'hit', 'Shaker (GM2)'],
  // beyond GM: the hats' edge notes follow the e-kit convention (closed edge 22, open edge 26)
  [21, 'hat', 'splash', 'Hat foot splash'],
  [22, 'hat', 'edge', 'Hat closed edge'],
  [23, 'hat', 'quarter', 'Hat open 1/4'],
  [24, 'hat', 'half', 'Hat open 1/2'],
  [25, 'ride', 'choke', 'Ride choke'],
  [26, 'hat', 'openedge', 'Hat open edge'],
  [27, 'crash1', 'choke', 'Crash choke'],
  [28, 'crash2', 'choke', 'Crash 2 choke'],
  [29, 'china', 'choke', 'China choke'],
  [30, 'splash', 'choke', 'Splash choke'],
  [31, 'snare', 'flam', 'Snare flam'],
  [32, 'snare', 'drag', 'Snare drag'],
  [33, 'snare', 'roll', 'Snare roll (held)'],
  [34, 'snare', 'edge', 'Snare edge'],
];
const NOTES_SRC = JSON.stringify(Object.fromEntries(NOTE_MAP.map(([p, piece, art]) => [p, [PIECES.indexOf(piece), ARTS[piece].indexOf(art)]])));
// What each note is called in a row (the drum grid, the piano roll) and to an agent (get_device): short, the piece
// that is drawn; a note that plays the same piece as another says its number. `other` is what every note the map
// doesn't name plays (core/music.js kitNotes).
const NOTE_NAMES = {
  35: 'Kick (35)', 36: 'Kick', 37: 'Side stick', 38: 'Snare', 39: 'Clap', 40: 'Rimshot', 41: 'Floor tom 2 (41)', 42: 'Hat',
  43: 'Floor tom 2', 44: 'Pedal hat', 45: 'Floor tom 1', 46: 'Open hat', 47: 'Rack tom 2', 48: 'Rack tom 1 (48)', 49: 'Crash',
  50: 'Rack tom 1', 51: 'Ride', 52: 'China', 53: 'Ride bell', 54: 'Tamb', 55: 'Splash', 56: 'Cowbell', 57: 'Crash 2',
  59: 'Ride edge', 69: 'Shaker (69)', 70: 'Shaker', 82: 'Shaker (82)',
  21: 'Hat foot splash', 22: 'Hat edge', 23: 'Hat 1/4 open', 24: 'Hat 1/2 open', 25: 'Ride choke', 26: 'Open hat edge',
  27: 'Crash choke', 28: 'Crash 2 choke', 29: 'China choke', 30: 'Splash choke', 31: 'Flam', 32: 'Drag', 33: 'Roll',
  34: 'Snare edge', other: 'Side stick',
};

// Where everything stands, in metres (the drummer's view: x to the right, y away from the drummer, z up): each piece
// of PIECES, the spaced pair of overheads, the room pair and where it aims, and the crush mic. The kernel builds its
// mics from it (each piece's distance to each mic is its time of flight and level: the stereo image is this layout)
// and the drawn kit in its window is drawn from it, so the picture and the stereo image agree.
export const LAYOUT = {
  pieces: {
    kick: [0.05, 0.45, 0.35], snare: [-0.17, 0.12, 0.66], hat: [-0.52, 0.18, 0.92], tom1: [-0.2, 0.47, 0.86], tom2: [0.17, 0.5, 0.86],
    tom3: [0.5, 0.12, 0.62], tom4: [0.74, -0.06, 0.58], crash1: [-0.6, 0.6, 1.3], crash2: [0.42, 0.75, 1.38], ride: [0.82, 0.38, 1.08],
    china: [1.0, 0.18, 1.4], splash: [-0.3, 0.68, 1.36], tamb: [-0.66, 0.34, 1.04], cowbell: [0.0, 0.62, 0.98], shaker: [-0.35, 1.25, 1.3],
    clap: [0.3, 1.3, 1.35],
  },
  overheads: [[-0.62, 0.22, 1.86], [0.62, 0.22, 1.86]],
  room: [[-1.25, 3.6, 1.7], [1.25, 3.6, 1.7]], roomAim: [0, 0.3, 0.9],
  crush: [0, 1.7, 1.15],
};
const src = (v) => JSON.stringify(v);

export const KITS = ['MAPLE', 'BIRCH', 'JAZZ', 'ARENA', 'DEAD'];

// per-piece params: tune, decay, level (snare: wires too)
const pieceParams = (key, name, label, extra = {}) => [
  { key: `${key}_tune`, label: `${label} TUNE`, min: -12, max: 12, def: 0, unit: 'st', role: 'pitch', group: key, desc: `${name} pitch, semitones from the kit's tuning` },
  { key: `${key}_decay`, label: `${label} DECAY`, min: 0.2, max: 2.5, def: 1, unit: 'x', role: 'decay', group: key, desc: `${name} ring: below 1 damped (tape and gel), above 1 left open` },
  { key: `${key}_level`, label: `${label} LEVEL`, min: -40, max: 6, def: 0, unit: 'dB', role: 'level', group: key, desc: `${name} level in every mic (-40 is off)`, ...extra },
];

export default defineDevice({
  id: 'core.drumroom', name: 'Studio A', kind: 'instrument', cat: 'drums', by: 'overdub',
  blurb: 'An acoustic kit in a big room: close, overhead and room mics',
  nod: 'the big multi-miked drum libraries, played by a physical model instead of samples (GM drum map plus articulations)',
  editor: 'drumroom', notes: NOTE_NAMES,
  params: [
    { key: 'kit', label: 'KIT', opts: KITS, def: 0, role: 'shape', group: 'kit', desc: 'the kit: warm 70s maple, punchy modern birch, a small jazz kit, a big arena rock kit, or a dry dead 70s kit (sizes, tunings, heads, beater, cymbals)' },
    { key: 'tune', label: 'TUNE', min: -12, max: 12, def: 0, unit: 'st', role: 'pitch', group: 'kit', desc: 'every drum and cymbal up or down, semitones' },
    { key: 'decay', label: 'DECAY', min: 0.3, max: 2, def: 1, unit: 'x', role: 'decay', group: 'kit', desc: 'every piece: below 1 deader (towels on the heads), above 1 more ring' },
    { key: 'mix_close', label: 'CLOSE', min: -40, max: 6, def: 0, unit: 'dB', role: 'mix', group: 'mics', desc: 'the close mics (one on each drum, the hat and the ride), panned to the layout; -40 is off' },
    { key: 'mix_oh', label: 'OH', min: -40, max: 6, def: -2, unit: 'dB', role: 'mix', group: 'mics', desc: 'the spaced pair of overheads: the cymbals and the stereo picture of the whole kit; -40 is off' },
    { key: 'mix_room', label: 'ROOM', min: -40, max: 6, def: -8, unit: 'dB', role: 'mix', group: 'mics', desc: 'the room pair a few metres out: early reflections and the tail; -40 is off' },
    { key: 'mix_crush', label: 'CRUSH', min: -40, max: 6, def: -40, unit: 'dB', role: 'mix', group: 'mics', desc: 'a mono room mic squashed flat by a brick-wall compressor (the big rock trick); -40 is off' },
    { key: 'bleed', label: 'BLEED', min: 0, max: 1, def: 0.5, role: 'mix', group: 'mics', desc: 'how much each piece leaks into the other close mics: 0 isolated, 1 wide open (the hat in the snare mic, cymbals in the toms)' },
    { key: 'room_size', label: 'SIZE', min: 0, max: 1, def: 0.5, role: 'size', group: 'mics', desc: 'the room: 0 a small booth, 1 a big hall-like live room (reflections later, tail longer)' },
    { key: 'view', label: 'VIEW', opts: ['DRUMMER', 'AUDIENCE'], def: 0, role: 'width', group: 'mics', desc: "the stereo picture from the drummer's seat (hat left) or from out front (hat right)" },
    { key: 'humanize', label: 'HUMAN', min: 0, max: 1, def: 0.5, role: 'depth', group: 'kit', desc: 'how much each hit varies (where the stick lands, how hard, how long it touches); 0 every hit alike' },
    { key: 'velocity', label: 'VEL', min: -1, max: 1, def: 0, role: 'sens', group: 'kit', desc: 'how velocity maps to force: below 0 a light touch (more ghosts), above 0 a heavy hand' },
    ...pieceParams('kick', 'the kick', 'K'),
    ...pieceParams('snare', 'the snare', 'S'),
    { key: 'snare_wires', label: 'WIRES', min: 0, max: 1, def: 0.6, role: 'tone', group: 'snare', desc: 'the snare wires: 0 off (a tom-like snare), 1 loose and buzzy (more sympathetic buzz from the toms and kick)' },
    ...pieceParams('hat', 'the hi-hat', 'H'),
    { key: 'hat_model', label: 'HAT MODEL', opts: ['ORIGINAL', 'PLATES'], def: 0, role: 'shape', group: 'hat', desc: 'the hi-hat model: the original, or two plates of dense modes that chatter as they ring (fuller under 3 kHz, never pitched)' },
    ...pieceParams('tom1', 'rack tom 1 (high)', 'T1'),
    ...pieceParams('tom2', 'rack tom 2', 'T2'),
    ...pieceParams('tom3', 'floor tom 1', 'T3'),
    ...pieceParams('tom4', 'floor tom 2 (low)', 'T4'),
    ...pieceParams('ride', 'the ride', 'RD'),
    ...pieceParams('crash1', 'crash 1', 'C1'),
    ...pieceParams('crash2', 'crash 2', 'C2'),
    ...pieceParams('china', 'the china', 'CH'),
    ...pieceParams('splash', 'the splash', 'SP'),
    { key: 'perc_level', label: 'PERC', min: -40, max: 6, def: 0, unit: 'dB', role: 'level', group: 'perc', desc: 'tambourine, cowbell, shaker and claps (-40 is off)' },
  ],
  presets: [
    { name: 'Maple 70s', params: { kit: 0 }, blurb: 'warm maple, coated heads, felt beater' },
    { name: 'Birch modern', params: { kit: 1, mix_oh: -3, mix_room: -10, bleed: 0.35 }, blurb: 'punchy and focused, close mics up front' },
    { name: 'Jazz club', params: { kit: 2, mix_close: -3, mix_oh: -1, mix_room: -9, room_size: 0.35, bleed: 0.7 }, blurb: 'a small kit, open heads, the overheads carry it' },
    { name: 'Arena', params: { kit: 3, mix_room: -4, mix_crush: -12, room_size: 0.85 }, blurb: 'a big kit in a big room, a touch of crush' },
    { name: 'Dead 70s', params: { kit: 4, mix_close: 2, mix_oh: -6, mix_room: -24, bleed: 0.25, room_size: 0.2 }, blurb: 'towels on the heads, dry and close' },
    { name: 'Dry and tight', params: { mix_close: 2, mix_oh: -8, mix_room: -40, mix_crush: -40, bleed: 0.15, decay: 0.75 }, blurb: 'close mics only, short and dry' },
    { name: 'Big room', params: { mix_close: -3, mix_oh: -1, mix_room: -2, room_size: 0.9, bleed: 0.6 }, blurb: 'the room pair pushed up in a big room' },
    { name: 'Crushed', params: { mix_room: -10, mix_crush: -4, room_size: 0.7 }, blurb: 'the squashed mono room under the close mics' },
  ],
  look: { color: '#2f3a33', ink: '#e9e0c8', shape: 'wide', finish: 'brushed', knob: 'cream', label: 'plate', led: '#ff8a3d' },
  tail: 6,
  kernel: kernel(String.raw`
// ------------------------------------------------------------------------------------------------ the map, the pieces
const NOTES = __NOTES__;                 // MIDI note -> [piece, articulation]
const KICK = 0, SNARE = 1, HAT = 2, TOM1 = 3, TOM4 = 6, CRASH1 = 7, CRASH2 = 8, RIDE = 9, CHINA = 10, SPLASH = 11, TAMB = 12, COW = 13, SHAKER = 14, CLAP = 15, NP = 16;
const S_CENTER = 0, S_RIM = 1, S_SIDE = 2, S_EDGE = 3, S_FLAM = 4, S_DRAG = 5, S_ROLL = 6;
const H_TIP = 0, H_EDGE = 1, H_PEDAL = 2, H_SPLASH = 6, H_OEDGE = 7;
const H_OPEN = [0, 0, 0, 0.25, 0.5, 1, 0.6, 1];              // each hat articulation's openness
const C_HIT = 0, R_BOW = 0, R_BELL = 1, R_EDGE = 2;
const PKEY = ['kick', 'snare', 'hat', 'tom1', 'tom2', 'tom3', 'tom4', 'crash1', 'crash2', 'ride', 'china', 'splash'];
const TKEY = PKEY.map((k) => k + '_tune'), DKEY = PKEY.map((k) => k + '_decay'), LKEY = PKEY.map((k) => k + '_level').concat(['perc_level', 'perc_level', 'perc_level', 'perc_level']);
// where each piece sits (metres; the drummer's view: x to the right, y away from the drummer, z up): LAYOUT's pieces
const POS = __POS__;
const CLOSE = [1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1];      // has a close (or spot) mic
const ISO = [0.25, 1, 1, 1, 1, 1, 1, 0, 0, 0.8, 0, 0, 0.6, 0.6, 0.6, 0.6]; // how much of the room a close mic hears (the kick mic is inside the drum)
const UP = [0.4, 1, 1.1, 0.9, 0.9, 0.9, 0.9, 1.25, 1.25, 1.15, 1.25, 1.25, 1, 1, 1, 1];        // radiation toward the overheads
const FRONT = [1.6, 1, 0.9, 1, 1, 1, 1, 1.1, 1.1, 1, 1.1, 1.1, 1, 1, 1, 1];  // toward the room (the kick's front head faces it)
const OHL = __OHL__, OHR = __OHR__;                                  // a spaced pair over the kit, pointing down
const RML = __RML__, RMR = __RMR__, RMAIM = __RMAIM__;               // the room pair, aimed at the kit
const CRM = __CRM__;                                                 // the mono crush mic, omni
const CS = 343, LN1000 = 6.907755278982137;
// relative piece levels, balanced by measurement: each piece's loudness 400 ms after a 0.8 stroke against a mixed kit's
// balance (docs/research/STUDIO-A.md has the table)
const GAIN = [0.555, 0.62, 0.143, 0.335, 0.187, 0.218, 0.298, 0.191, 0.19, 0.0313, 0.112, 0.223, 0.105, 0.121, 0.105, 0.455];
// The kits. A membrane: f0 (Hz), t60 (s, the fundamental), damp (0..1: how much faster the overtones die), split (the
// other head's mode, a ratio above f0), glide (how far a hard hit bends the head), shell [Hz, s, level], tc [hard, soft]
// (ms of stick or beater contact), r (where it lands, 0 centre .. 1 edge), nz [Hz, Q, ms, level] (the crack or the
// beater's slap), kn [Hz (toms: x f0), Q, ms, level] (the knock), felt (a soft beater's rounded push). The snare adds
// wires. Hats: peak (Hz), open / closed ring (s), sizzle. Cymbals: [size ("), peak (Hz), t60 (s), bright].
const KITS = [
  { // MAPLE: a warm 70s maple kit, coated heads, a felt beater, medium damping
    kick: { f0: 53, t60: 0.32, damp: 0.75, split: 0.04, glide: 0.1, shell: [360, 0.05, 0.3], tc: [2.0, 6.5], r: 0.12, nz: [2800, 0.7, 3, 4.5], kn: [600, 0.9, 9, 3.15], felt: 1 },
    snare: { f0: 188, t60: 0.2, damp: 0.5, split: 0.55, glide: 0.03, shell: [520, 0.1, 0.12], tc: [0.45, 1.4], r: 0.3, nz: [3200, 0.55, 6, 3.96], kn: [700, 0.8, 10, 1.35], wires: 0.75 },
    toms: [138, 118, 98, 80], tomT: [0.75, 0.85, 1.0, 1.2], tom: { damp: 0.55, split: 0.025, glide: 0.08, shell: 3.6, tc: [0.36, 1.89], r: 0.4, nz: [2200, 0.6, 3.5, 5.5], kn: [4, 0.9, 8, 1.8] },
    hat: { peak: 7800, open: 1.6, closed: 0.07, sizzle: 0.8 },
    cym: [[16, 5200, 3.2, 0.9], [18, 4600, 3.8, 0.85], [20, 5500, 5.5, 0.8], [18, 2900, 2.5, 1], [10, 6900, 1.3, 1]], gain: 1,
  },
  { // BIRCH: punchy modern birch, clear heads, a plastic beater
    kick: { f0: 57, t60: 0.26, damp: 0.82, split: 0.03, glide: 0.14, shell: [420, 0.05, 0.4], tc: [0.9, 3.4], r: 0.1, nz: [3800, 0.7, 2.5, 8], kn: [700, 0.9, 7, 3.5], felt: 0 },
    snare: { f0: 225, t60: 0.18, damp: 0.45, split: 0.5, glide: 0.03, shell: [620, 0.1, 0.12], tc: [0.35, 1.2], r: 0.28, nz: [4200, 0.55, 5, 4.84], kn: [800, 0.8, 9, 1.35], wires: 0.7 },
    toms: [172, 142, 108, 86], tomT: [0.6, 0.7, 0.85, 1.0], tom: { damp: 0.5, split: 0.02, glide: 0.07, shell: 3.8, tc: [0.32, 1.62], r: 0.38, nz: [2800, 0.6, 3, 7.5], kn: [4, 0.9, 7, 2.1] },
    hat: { peak: 9600, open: 1.8, closed: 0.06, sizzle: 0.9 },
    cym: [[17, 6200, 3.4, 1], [18, 5700, 3.8, 1], [21, 6500, 5.5, 0.9], [18, 3400, 2.6, 1], [10, 8300, 1.3, 1]], gain: 1.12,
  },
  { // JAZZ: a small kit tuned up, open heads, thin dark cymbals
    kick: { f0: 70, t60: 0.75, damp: 0.45, split: 0.05, glide: 0.08, shell: [400, 0.08, 0.25], tc: [2.6, 7], r: 0.15, nz: [2400, 0.8, 3, 2.5], kn: [550, 1, 12, 2.45], felt: 1 },
    snare: { f0: 290, t60: 0.24, damp: 0.35, split: 0.45, glide: 0.02, shell: [700, 0.12, 0.1], tc: [0.4, 1.3], r: 0.35, nz: [4000, 0.55, 5, 3.3], kn: [900, 0.8, 9, 1.05], wires: 0.85 },
    toms: [212, 178, 140, 112], tomT: [1.0, 1.1, 1.3, 1.5], tom: { damp: 0.3, split: 0.03, glide: 0.04, shell: 3.4, tc: [0.36, 1.89], r: 0.42, nz: [2400, 0.6, 3, 4.5], kn: [3.6, 0.9, 9, 1.5] },
    hat: { peak: 6600, open: 2.2, closed: 0.09, sizzle: 0.7 },
    cym: [[16, 4200, 3.0, 0.75], [18, 3900, 4.0, 0.7], [20, 4600, 7.0, 0.7], [16, 2800, 2.2, 0.9], [8, 6000, 1.0, 0.9]], gain: 0.76,
  },
  { // ARENA: a big rock kit, deep toms, a wood beater, big bright cymbals
    kick: { f0: 46, t60: 0.4, damp: 0.68, split: 0.04, glide: 0.16, shell: [330, 0.06, 0.4], tc: [0.8, 3.0], r: 0.1, nz: [3400, 0.7, 2.6, 9], kn: [550, 0.9, 9, 3.85], felt: 0 },
    snare: { f0: 172, t60: 0.28, damp: 0.5, split: 0.58, glide: 0.04, shell: [480, 0.14, 0.14], tc: [0.4, 1.3], r: 0.3, nz: [3000, 0.55, 7, 4.4], kn: [650, 0.8, 12, 1.5], wires: 0.7 },
    toms: [125, 106, 82, 68], tomT: [1.0, 1.15, 1.4, 1.7], tom: { damp: 0.5, split: 0.025, glide: 0.11, shell: 3.6, tc: [0.32, 1.76], r: 0.4, nz: [2300, 0.6, 3.5, 7], kn: [4, 0.9, 9, 2.4] },
    hat: { peak: 8400, open: 2.3, closed: 0.08, sizzle: 1.0 },
    cym: [[18, 5800, 4.5, 1], [19, 5500, 4.8, 1], [22, 6500, 6.0, 0.95], [20, 3400, 3.0, 1], [10, 7500, 1.4, 1]], gain: 0.95,
  },
  { // DEAD: a dry 70s kit, towels on the heads, low tunings, small dark cymbals
    kick: { f0: 50, t60: 0.17, damp: 0.92, split: 0.02, glide: 0.06, shell: [300, 0.03, 0.2], tc: [2.4, 7], r: 0.12, nz: [2200, 0.8, 2.5, 2.5], kn: [450, 1, 7, 2.8], felt: 1 },
    snare: { f0: 168, t60: 0.09, damp: 0.85, split: 0.5, glide: 0.02, shell: [450, 0.05, 0.08], tc: [0.6, 1.8], r: 0.3, nz: [2400, 0.6, 4, 2.2], kn: [550, 0.9, 8, 1.5], wires: 0.55 },
    toms: [128, 110, 86, 72], tomT: [0.28, 0.32, 0.38, 0.45], tom: { damp: 0.85, split: 0.015, glide: 0.05, shell: 3.2, tc: [0.44, 2.29], r: 0.4, nz: [1700, 0.6, 3, 3.5], kn: [3.4, 0.9, 8, 2.1] },
    hat: { peak: 6000, open: 1.1, closed: 0.05, sizzle: 0.6 },
    cym: [[15, 3900, 2.0, 0.7], [16, 3600, 2.4, 0.7], [20, 4200, 3.5, 0.7], [16, 2500, 1.6, 0.85], [8, 5800, 0.9, 0.85]], gain: 1.5,
  },
];
// the snare's hoop (rimshots) and a stick laid across the rim (side stick): [Hz, s, level]
const RIM = [[1180, 0.18, 2.2], [2060, 0.14, 2.0], [3350, 0.11, 1.5], [5100, 0.08, 1.1]];
const SIDE = [[430, 0.05, 0.6], [880, 0.04, 0.55], [1650, 0.03, 0.42], [2900, 0.025, 0.27]];
// the circular membrane's modes after (0,1): [m, j_mn]
const MEMBRANE = [[0, 2.4048], [1, 3.8317], [2, 5.1356], [0, 5.5201], [3, 6.3802], [1, 7.0156], [4, 7.5883], [2, 8.4172], [0, 8.6537]];

// ------------------------------------------------------------------------------------------------ building blocks
// lib's svf(), op for op, as a class (one tick() every call site can inline)
class SV {
  constructor(sr) { this.sr = sr; this.ic1 = 0; this.ic2 = 0; this.k = 1; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  set(fc, q) { const g = Math.tan(Math.PI * clamp(fc, 5, this.sr * 0.49) / this.sr), k = 1 / Math.max(0.05, q), a1 = 1 / (1 + g * (g + k)), a2 = g * a1; this.k = k; this.a1 = a1; this.a2 = a2; this.a3 = g * a2; return this; }
  tick(v0) {
    const ic1 = this.ic1, ic2 = this.ic2, a2 = this.a2;
    const v3 = v0 - ic2, v1 = this.a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - ic1; this.ic2 = 2 * v2 - ic2;
    this.lp = v2; this.bp = v1; this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
  reset() { this.ic1 = this.ic2 = 0; this.lp = this.bp = this.hp = 0; }
}
// Bessel J_m(x) by its series (strikes only: a handful of modes per hit)
function besselJ(m, x) {
  let t = 1; for (let k = 1; k <= m; k++) t *= x / 2 / k;
  let s = 0; const q = -(x * x) / 4;
  for (let k = 0; k < 40; k++) { s += t; t *= q / ((k + 1) * (k + 1 + m)); if (t < 1e-12 && t > -1e-12) break; }
  return s;
}
// a seeded draw (lib's rng step, its state in a typed array, so a kit change draws without allocating): 0..1
function draw(S) { const v = (Math.imul(S[0], 1664525) + 1013904223) >>> 0; S[0] = v; return v / 4294967296; }

// A bank of two-pole resonators, one per mode: frequencies f (Hz) x fm, T60s t (s) x dm. The input gain b[k] is set
// per stroke (where the stick lands), so a stroke's force E[] rings each mode in proportion. A mode that has died away
// is skipped until a stroke wakes it.
class Bank {
  constructor(N) {
    this.N = N; this.n = 0;
    this.f = new Float64Array(N); this.t = new Float64Array(N); this.r = new Float64Array(N); this.w = new Float64Array(N);
    this.a1 = new Float64Array(N); this.a2 = new Float64Array(N); this.b = new Float64Array(N); this.s = new Float64Array(N);
    this.y1 = new Float64Array(N); this.y2 = new Float64Array(N); this.on = new Uint8Array(N);
    this.fm = -1; this.dm = -1;
  }
  set(sr, fm, dm) {
    const n = this.n;
    if (dm !== this.dm) {
      this.dm = dm; this.fm = -1;
      for (let k = 0; k < n; k++) { const r = Math.exp(-LN1000 / (Math.max(0.004, this.t[k] * dm) * sr)); this.r[k] = r; this.a2[k] = r * r; }
    }
    if (fm !== this.fm) {
      this.fm = fm;
      const top = sr * 0.45;
      for (let k = 0; k < n; k++) { let f = this.f[k] * fm; if (f > top) f = top; const w = TAU * f / sr; this.w[k] = w; this.s[k] = Math.sin(w); this.a1[k] = 2 * this.r[k] * Math.cos(w); }
    }
  }
  run(out, E, a, e, drive) {
    const n = this.n, A1 = this.a1, A2 = this.a2, B = this.b, Y1 = this.y1, Y2 = this.y2, ON = this.on;
    for (let k = 0; k < n; k++) {
      const b = drive ? B[k] : 0;
      if (!ON[k] && b === 0) continue;
      const p = A1[k], q = A2[k];
      let u1 = Y1[k], u2 = Y2[k];
      if (b !== 0) { for (let i = a; i < e; i++) { const v = p * u1 - q * u2 + b * E[i]; u2 = u1; u1 = v; out[i] += v; } ON[k] = 1; }
      else for (let i = a; i < e; i++) { const v = p * u1 - q * u2; u2 = u1; u1 = v; out[i] += v; }
      Y1[k] = u1; Y2[k] = u2;
    }
  }
  // the modes that have died away stop costing anything; returns how many still ring
  prune() {
    let live = 0;
    const Y1 = this.y1, Y2 = this.y2, ON = this.on;
    for (let k = 0; k < this.n; k++) {
      if (!ON[k]) continue;
      if (Y1[k] * Y1[k] + Y2[k] * Y2[k] < 1e-18) { Y1[k] = 0; Y2[k] = 0; ON[k] = 0; } else live++;
    }
    return live;
  }
  // mode k's amplitude squared (a sinusoid's: (y1^2 + y2^2 - 2 cos(w) y1 y2) / sin(w)^2)
  amp2(k) { const y1 = this.y1[k], y2 = this.y2[k], s = this.s[k]; return (y1 * y1 + y2 * y2 - (this.a1[k] / this.r[k]) * y1 * y2) / (s * s + 1e-12); }
  clear() { this.y1.fill(0); this.y2.fill(0); this.on.fill(0); }
}

// The contact force of a stick or beater: up to four overlapping pushes, each a half sine (a stick on a head) or a
// raised cosine (a felt beater; a stick on metal, whose dense partials a half sine's sidelobes would notch) of a given
// length (samples) and impulse (area). A shorter push for the same impulse reaches higher partials: harder is brighter.
// (A real stroke stays on the head for several ms, but its sharp first impact is what carries the brightness.)
class Pulse {
  constructor() { this.pos = new Float64Array(4); this.len = new Float64Array(4); this.amp = new Float64Array(4); this.hn = new Uint8Array(4); this.n = 0; }
  add(len, area, hann) {
    if (this.n >= 4) { for (let k = 1; k < 4; k++) { this.pos[k - 1] = this.pos[k]; this.len[k - 1] = this.len[k]; this.amp[k - 1] = this.amp[k]; this.hn[k - 1] = this.hn[k]; } this.n = 3; }
    const L = Math.max(1, len), k = this.n++;
    this.pos[k] = 0; this.len[k] = L; this.hn[k] = hann ? 1 : 0; this.amp[k] = hann ? area * 2 / L : area * Math.PI / (2 * L);
  }
  fill(E, a, e) {
    for (let i = a; i < e; i++) E[i] = 0;
    if (!this.n) return false;
    for (let k = 0; k < this.n; k++) {
      let p = this.pos[k];
      const L = this.len[k], A = this.amp[k], m = Math.min(e, a + Math.ceil(L - p));
      if (this.hn[k]) for (let i = a; i < m; i++, p++) { const s = sinT(0.5 * (p + 0.5) / L); E[i] += A * s * s; }
      else for (let i = a; i < m; i++, p++) E[i] += A * sinT(0.5 * (p + 0.5) / L);
      this.pos[k] = p;
    }
    let j = 0;
    for (let k = 0; k < this.n; k++) if (this.pos[k] < this.len[k]) { this.pos[j] = this.pos[k]; this.len[j] = this.len[k]; this.amp[j] = this.amp[k]; this.hn[j] = this.hn[k]; j++; }
    this.n = j;
    return true;
  }
}
// one stroke on a piece, at a frame of the block: articulation, force (0..1+), where it lands (0..1), contact (ms)
function strokes(k) { const a = []; for (let i = 0; i < k; i++) a.push({ at: 0, art: 0, F: 0, r: 0, tc: 1, w: 0 }); return a; }

// ------------------------------------------------------------------------------------------------ the drums
// A membrane (kick 0, snare 1, tom 2): the head's modes, the other head's partner of (0,1), the shell; the snare adds
// its hoop, the side stick, and the wires.
class Drum {
  constructor(sr, type, seed) {
    this.sr = sr; this.type = type;
    this.bank = new Bank(20); this.pulse = new Pulse();
    this.E = new Float64Array(128); this.near = new Float64Array(128); this.far = new Float64Array(128); this.body = new Float64Array(128);
    this.ns = (seed >>> 0) || 0x9e3779b9;
    this.nf = new SV(sr); this.nz = 0; this.nzK = 0;                          // the crack (or the beater's slap)
    this.nk = new SV(sr); this.kz = 0; this.kzK = 0;                          // the knock: the head's dense middle
    this.wh = new SV(sr); this.wb = new SV(sr); this.wl = new SV(sr);          // the wires: high pass, sizzle, buzz
    this.sy = new SV(sr);                                                      // the head's sympathetic resonance
    this.we = 0; this.wa = 1 - Math.exp(-1 / (0.0002 * sr)); this.wr = Math.exp(-1 / (0.006 * sr)); this.wire = 0; this.wthr = 0.01;
    this.mm = new Int8Array(20); this.mj = new Float64Array(20); this.ma = new Float64Array(20);
    this.H = 0; this.spec = null; this.tm = 1; this.dm = 1; this.G = 0; this.ref2 = 1; this.gl = 0;
    this.ev = strokes(16); this.nev = 0; this.on = false; this.lvl = -1;
  }
  configure(s, f0, t60) {
    const B = this.bank, type = this.type, H = type === 0 ? 7 : type === 1 ? 10 : 8;
    this.spec = s;
    B.f[0] = f0; B.t[0] = t60; this.mm[0] = 0; this.mj[0] = 2.4048; this.ma[0] = 1;
    // the other head: for toms and the kick nearly the same pitch (they beat); the snare's bottom head tuned well above
    B.f[1] = f0 * (1 + s.split); B.t[1] = t60 * (type === 1 ? 0.5 : 0.8); this.mm[1] = 0; this.mj[1] = 2.4048; this.ma[1] = type === 1 ? 0.4 : 0.55;
    for (let k = 2; k < H; k++) {
      const m = MEMBRANE[k - 1][0], j = MEMBRANE[k - 1][1], ratio = Math.pow(j / 2.4048, type === 1 ? 1 : 0.94);   // air loading flattens a tom's
      B.f[k] = f0 * ratio; B.t[k] = t60 * Math.pow(1 / ratio, 1 + 2.5 * s.damp); this.mm[k] = m; this.mj[k] = j; this.ma[k] = Math.pow(ratio, type === 2 ? -0.2 : -0.35);
    }
    let N = H;
    const sh = type === 2 ? f0 * s.shell : s.shell[0];
    B.f[N] = sh; B.t[N] = type === 2 ? 0.07 : s.shell[1]; this.ma[N] = type === 2 ? 0.15 : s.shell[2]; this.mm[N] = -1; N++;
    if (type === 1) {
      for (let k = 0; k < 4; k++) { B.f[N] = RIM[k][0]; B.t[N] = RIM[k][1]; this.ma[N] = RIM[k][2]; this.mm[N] = -2; N++; }
      for (let k = 0; k < 4; k++) { B.f[N] = SIDE[k][0]; B.t[N] = SIDE[k][1]; this.ma[N] = SIDE[k][2]; this.mm[N] = -3; N++; }
    }
    B.n = N; this.H = H; B.dm = -1; B.fm = -1; this.G = s.glide;
    this.nf.set(s.nz[0], s.nz[1]); this.nzK = Math.exp(-1 / (s.nz[2] * 0.001 * this.sr));
    this.nk.set(type === 2 ? f0 * s.kn[0] : s.kn[0], s.kn[1]); this.kzK = Math.exp(-1 / (s.kn[2] * 0.001 * this.sr));
    if (type === 1) { this.wh.set(1800, 0.6); this.wb.set(5600, 0.75); this.wl.set(1500, 1.1); this.sy.set(f0, 3); }
  }
  // tm: the pitch multiplier, dm: the ring multiplier (per block, from the params); wires 0..1 (the snare)
  params(tm, dm, wires) {
    this.tm = tm; this.dm = dm;
    if (this.type === 1) { this.wire = wires; this.wthr = 0.004 + 0.03 * (1 - wires); }
  }
  strike(e) {
    const B = this.bank, s = this.spec, sr = this.sr, F = e.F, art = e.art;
    let head = 1, shell = 1, rim = 0, side = 0;
    if (this.type === 1) {
      if (art === S_RIM) { rim = 1; head = 1.1; }
      else if (art === S_SIDE) { side = 1; head = 0.08; shell = 0.4; }
      else if (art === S_EDGE) head = 0.9;
    }
    for (let k = 0; k < B.n; k++) {
      const m = this.mm[k];
      let a;
      if (m >= 0) a = head * Math.abs(besselJ(m, this.mj[k] * e.r)) * this.ma[k] * (m ? 1.25 : 1);
      else a = (m === -1 ? shell : m === -2 ? rim : side) * this.ma[k];
      B.b[k] = a * B.s[k];
    }
    this.pulse.add(e.tc * 0.001 * sr, F, this.type === 0 && s.felt ? 1 : 0);
    // the crack (the stick on the head, and on the rim) or the beater's slap grows faster than the force, and its band
    // climbs with it; the knock (the head's dense middle) follows the force
    const am = art === S_RIM ? 2.2 : art === S_SIDE ? 0.6 : art === S_EDGE ? 1.25 : 1, fm = art === S_RIM ? 1.45 : art === S_SIDE ? 0.8 : 1;
    this.nf.set(s.nz[0] * (0.4 + 0.75 * F) * fm, s.nz[1]);
    this.nz += s.nz[3] * Math.pow(F, this.type === 0 ? 3 : this.type === 1 ? 2.2 : 2.3) * am * (this.type === 0 ? 1.4 : this.type === 1 ? 1.25 : 2.8);
    this.kz += s.kn[3] * Math.pow(F, this.type === 0 ? 2 : 1.3) * (art === S_SIDE ? 0.3 : 1);
    this.ref2 = Math.max(1e-6, this.ma[0] * this.ma[0]);
    this.on = true;
  }
  // [a, e): the modes (retuned every 32 samples while a hard hit bends the head), the noise, the wires
  seg(a, e, symp) {
    const B = this.bank, E = this.E, body = this.body, near = this.near, far = this.far, s = this.spec;
    for (let i = a; i < e; i++) body[i] = 0;
    let fmLast = -1;
    for (let p = a; p < e; p += 32) {
      const q = Math.min(e, p + 32);
      let fm = this.tm;
      if (this.G > 0 && B.on[0]) {
        const x = B.amp2(0) / this.ref2, gx = this.G * (x > 2 ? 2 : x);
        if (gx > 1e-4) fm = this.tm * (1 + gx);      // (once the bend is under 0.2 cents, the head has settled)
      }
      if (fm !== fmLast) { B.set(this.sr, fm, this.dm); fmLast = fm; }
      const drive = this.pulse.fill(E, p, q);
      B.run(body, E, p, q, drive);
    }
    let ns = this.ns, nz = this.nz, kz = this.kz;
    const nzK = this.nzK, nf = this.nf, nk = this.nk, kzK = this.kzK, kick = this.type === 0;
    if (this.type === 1 && (this.wire > 0 || symp)) {
      // the wires: noise gated by the head's motion, an envelope over a threshold plus the motion itself (the buzz)
      const wh = this.wh, wb = this.wb, wl = this.wl, sy = this.sy, wa = this.wa, wr = this.wr, thr = this.wthr, wg = this.wire * s.wires;
      let we = this.we, wc = -1;
      for (let i = a; i < e; i++) {
        // the wires buzz brighter the harder the head drives them (a ghost note's wires are soft and dark)
        if (((i - a) & 31) === 0) { const c = 2600 + 4200 * (we > 1 ? 1 : we); if (Math.abs(c - wc) > 60) { wb.set(c, 0.75); wc = c; } }
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1;
        let x = body[i];
        if (symp) { sy.tick(symp[i]); x += sy.bp * 0.9; body[i] += sy.bp * 0.25; }
        const ax = x < 0 ? -x : x;
        we = ax > we ? we + (ax - we) * wa : we * wr;
        const g = (we > thr ? we - thr : 0) * 1.4 + ax * 0.35;
        const v = w * g * wg;
        wh.tick(v); wb.tick(wh.hp); wl.tick(v);
        const wires = sat((wb.bp * 1.25 + wl.bp * 0.35) * 5) * 0.36;   // (a rattle has no Gaussian spikes: bounded)
        nf.tick(w); const c = sat(nf.bp * 2.5) * 0.4 * nz; nz *= nzK;
        nk.tick(w); const kk = nk.bp * kz; kz *= kzK;
        near[i] = body[i] + wires + c + kk; far[i] = body[i] + wires * 0.8 + c * 0.35 + kk * 0.7;
      }
      this.we = we;
    } else {
      for (let i = a; i < e; i++) {
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1;
        nf.tick(w); const c = sat(nf.bp * 2.5) * 0.4 * nz; nz *= nzK;
        nk.tick(w); const kk = nk.bp * kz; kz *= kzK;
        near[i] = body[i] + c + kk; far[i] = body[i] + c * (kick ? 0.2 : 0.35) + kk * 0.7;
      }
    }
    this.ns = ns; this.nz = nz < 1e-9 ? 0 : nz; this.kz = kz < 1e-9 ? 0 : kz;
  }
  render(n, symp) {
    this.bank.set(this.sr, this.tm, this.dm);     // (a stroke at the block's first frame reads the tuning)
    let pos = 0;
    for (let k = 0; k < this.nev; k++) {
      const ev = this.ev[k], at = ev.at < pos ? pos : ev.at > n ? n : ev.at;
      if (at > pos) { this.seg(pos, at, symp); pos = at; }
      this.strike(ev);
    }
    this.nev = 0;
    if (pos < n) this.seg(pos, n, symp);
    const live = this.bank.prune();
    this.on = live > 0 || this.pulse.n > 0 || this.nz > 1e-7 || this.kz > 1e-7 || this.we > 1e-6;
    return this.on;
  }
}

// ------------------------------------------------------------------------------------------------ the hi-hat
// Two plates' partials. Openness h (0 clamped .. 1 wide open) sets each partial's ring between its closed and open
// times and how much the plates sizzle against each other; closing moves h to 0 over a few ms (the choke).
class Hat {
  constructor(sr, seed) {
    this.sr = sr; this.bank = new Bank(14); this.pulse = new Pulse();
    this.E = new Float64Array(128); this.near = new Float64Array(128); this.far = new Float64Array(128); this.body = new Float64Array(128);
    this.ns = (seed >>> 0) || 0x2545f491;
    this.tO = new Float64Array(14); this.tC = new Float64Array(14); this.wT = new Float64Array(14); this.wE = new Float64Array(14); this.amp = new Float64Array(14);
    this.s1 = new SV(sr); this.s2 = new SV(sr); this.c1 = new SV(sr); this.c2 = new SV(sr); this.tk = new SV(sr);
    this.h = 0; this.ht = 0; this.hset = -1; this.se = 0; this.C = 0; this.T = 0;
    this.sa = 1 - Math.exp(-1 / (0.0001 * sr)); this.sr2 = Math.exp(-1 / (0.004 * sr));   // the sizzle follows the plates
    this.cK = Math.exp(-1 / (0.013 * sr)); this.tK = Math.exp(-1 / (0.0016 * sr));
    this.sizzle = 1; this.tm = 1; this.dm = 1; this.spec = null;
    this.ev = strokes(16); this.nev = 0; this.on = false; this.lvl = -1;
  }
  configure(s, S) {
    const B = this.bank;
    this.spec = s; this.sizzle = s.sizzle;
    for (let k = 0; k < 14; k++) {
      const lo = k < 3, u = draw(S), f = lo ? 380 * Math.pow(1100 / 380, u) : 3000 * Math.pow(16000 / 3000, Math.pow(u, 0.85));
      B.f[k] = f;
      const lf = Math.log2(f / s.peak);
      this.amp[k] = (0.45 + 0.55 * draw(S)) * (lo ? 0.22 : 1 / (1 + lf * lf / 1.8));
      this.tO[k] = s.open * Math.pow(f / 4000, lo ? -0.15 : -0.35) * (0.8 + 0.4 * draw(S)) * (lo ? 0.6 : 1);
      this.tC[k] = s.closed * Math.pow(f / 4000, -0.25) * (lo ? 0.45 : 1);
      this.wT[k] = lo ? 0.1 : Math.min(1.6, Math.pow(f / 5000, 0.5));
      this.wE[k] = lo ? 0.85 : Math.min(1.2, Math.pow(f / 3000, -0.15));
    }
    B.n = 14; this.hset = -1;
    this.s1.set(4800, 0.7); this.s2.set(8600, 0.9); this.c1.set(1900, 1.4); this.c2.set(420, 0.8); this.tk.set(9500, 0.8);
  }
  params(tm, dm) { if (tm !== this.tm || dm !== this.dm) { this.tm = tm; this.dm = dm; this.hset = -1; } }
  // the other hat model took over: stop ringing, so switching back starts from silence
  silence() { this.bank.clear(); this.pulse.n = 0; this.nev = 0; this.se = 0; this.C = 0; this.T = 0; this.h = 0; this.ht = 0; this.hset = -1; this.on = false; this.lvl = -1; }
  // each partial's ring at openness h (between the plates clamped and wide open)
  open(h) {
    const B = this.bank, sr = this.sr, dm = this.dm, e = Math.pow(h, 0.65), top = sr * 0.45;
    for (let k = 0; k < B.n; k++) {
      const t = this.tC[k] * Math.pow(this.tO[k] / this.tC[k], e) * dm, r = Math.exp(-LN1000 / (Math.max(0.004, t) * sr));
      let f = B.f[k] * this.tm; if (f > top) f = top;
      const w = TAU * f / sr;
      B.r[k] = r; B.a2[k] = r * r; B.w[k] = w; B.s[k] = Math.sin(w); B.a1[k] = 2 * r * Math.cos(w);
    }
    this.hset = h;
  }
  strike(e) {
    const B = this.bank, art = e.art, F = e.F;
    let h = H_OPEN[art];
    if (e.w > 0.02 && art !== H_PEDAL && art !== H_SPLASH) h = e.w;   // a note's mod: how open, for this hit (a wheel resting a hair off 0 isn't one)
    if (art === H_PEDAL) {
      // the foot: the plates meet (louder from open), then they are clamped
      this.C += F * (this.h > 0.12 ? 1 : 0.4); this.ht = 0; this.c1.set(1400 + 1300 * F, 1.4);
      for (let k = 0; k < B.n; k++) B.b[k] = this.amp[k] * this.wE[k] * 0.25 * B.s[k];
      this.pulse.add(0.6 * 0.001 * this.sr, F * 0.5, 1);
    } else {
      if (art === H_SPLASH) { this.C += F * 0.9; }
      if (h > this.h || art === H_SPLASH) { this.h = h; this.open(h); }    // the foot lifted before the stick came down
      this.ht = h;
      const edge = art === H_EDGE || art === H_SPLASH || art === H_OEDGE, W = edge ? this.wE : this.wT;
      for (let k = 0; k < B.n; k++) B.b[k] = this.amp[k] * W[k] * B.s[k];
      this.pulse.add(e.tc * (edge ? 1.8 : 1) * 0.001 * this.sr, F * (edge ? 1.9 : 1) * (1 - 0.45 * h), 1);
      // the stick's tick grows faster than the force: a soft stroke is darker
      if (!edge) this.T += F * F;
    }
    this.on = true;
  }
  seg(a, e) {
    const B = this.bank, E = this.E, body = this.body, near = this.near, far = this.far;
    for (let i = a; i < e; i++) body[i] = 0;
    for (let p = a; p < e; p += 32) {
      const q = Math.min(e, p + 32);
      if (this.h !== this.ht) {
        // closing: the plates clamp over about 3 ms
        this.h = this.ht + (this.h - this.ht) * Math.exp(-(q - p) / (0.003 * this.sr));
        if (Math.abs(this.h - this.ht) < 1e-3) this.h = this.ht;
      }
      if (this.h !== this.hset) this.open(this.h);
      const drive = this.pulse.fill(E, p, q);
      B.run(body, E, p, q, drive);
    }
    // the sizzle (the plates rattling against each other, driven by their own motion: most at half open), the chick
    // (the plates meeting), the tick (the stick's tip)
    const h = this.h, sz = this.sizzle * (0.6 + 1.6 * h * (1 - h) - 0.25 * h) * 5, sa = this.sa, sr2 = this.sr2, cK = this.cK, tK = this.tK;
    const s1 = this.s1, s2 = this.s2, c1 = this.c1, c2 = this.c2, tk = this.tk;
    let ns = this.ns, se = this.se, C = this.C, T = this.T;
    for (let i = a; i < e; i++) {
      ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1;
      const b = body[i], ab = b < 0 ? -b : b;
      se = ab > se ? se + (ab - se) * sa : se * sr2;
      s1.tick(w * se); s2.tick(s1.hp);
      const chick = C > 1e-7 ? (c1.tick(w * C), c2.tick(w * C), c1.bp * 5 + c2.lp * 2.6) : 0;
      tk.tick(w * T);
      const x = b + s2.bp * sz + tk.bp * 1.1;
      near[i] = x + chick; far[i] = x + chick * 0.4;
      C *= cK; T *= tK;
    }
    this.ns = ns; this.se = se < 1e-9 ? 0 : se; this.C = C < 1e-9 ? 0 : C; this.T = T < 1e-9 ? 0 : T;
  }
  render(n) {
    if (this.hset !== this.h) this.open(this.h);
    let pos = 0;
    for (let k = 0; k < this.nev; k++) {
      const ev = this.ev[k], at = ev.at < pos ? pos : ev.at > n ? n : ev.at;
      if (at > pos) { this.seg(pos, at); pos = at; }
      this.strike(ev);
    }
    this.nev = 0;
    if (pos < n) this.seg(pos, n);
    const live = this.bank.prune();
    this.on = live > 0 || this.pulse.n > 0 || this.se > 1e-7 || this.C > 1e-7 || this.T > 1e-7;
    return this.on;
  }
}

// PLATES (hat_model 1): the same hat (strokes, openness, the foot, the chick and the tick), with two plates of 48 modes
// each, evenly dense from the plates' body to the top (stratified: no two modes beat, none line up into a pitch), and in
// place of the sizzle, the chatter of the plates touching: noise that follows the plates' own motion, a little more
// held shut (cC). Fitted to real one-shots by measurement (overdub-private tools/drum-room/hat-models.mjs and
// tune-hats.mjs; clash, a lower slap half open, and thud, the stick on the stand, came out 0), and as loud in a groove
// as the original (g). Its own seeded draws, so the original hat and the cymbals draw exactly what they did.
const HAT2 = { nm: 48, lo: 119.8, hi: 17000, warp: 1, tilt: 0.014, ampExp: -0.3097, p2: 0.9294, edge: 0.0527, tC: 0.4319, tO: 2.643, hExp: 0.35, tcK: 0.6239, chatter: 7.37, cbF: 5860, cbQ: 0.5, chp: 1378, fol: 87.83, cC: 0.5, clash: 0, clF: 900, thud: 0, thF: 160, tick: 2.687, chick: 2.177, g: 0.955, go: 1.56, gp: 0.763 };
class Hat2 extends Hat {
  constructor(sr, seed) {
    super(sr, seed);
    const N = 2 * HAT2.nm;
    this.bank = new Bank(N); this.N = N;
    this.tO = new Float64Array(N); this.tC = new Float64Array(N); this.wT = new Float64Array(N); this.wE = new Float64Array(N); this.amp = new Float64Array(N);
    this.cb = new SV(sr); this.ch = new SV(sr); this.cl = new SV(sr); this.th = new SV(sr); this.folA = Math.exp(-TAU * HAT2.fol / sr);
    this.D = 0; this.dK = Math.exp(-1 / (0.006 * sr));
    this.S2 = new Uint32Array(1); this.seed2 = seed >>> 0;
  }
  configure(s) {
    const X = HAT2, B = this.bank, S2 = this.S2, N = this.N;
    S2[0] = (this.seed2 ^ 0x5eed ^ Math.round(s.peak)) >>> 0 || 1;
    this.spec = s; this.sizzle = s.sizzle;
    const kc = s.closed / 0.07, ko = s.open / 1.8;   // each kit's hats: its own closed and open rings, against BIRCH-ish
    for (let pl = 0; pl < 2; pl++) {
      const lo = X.lo * (1 + 0.07 * pl);
      for (let k = 0; k < X.nm; k++) {
        const j = pl * X.nm + k, f = lo + (X.hi - lo) * Math.pow((k + 0.15 + 0.7 * draw(S2)) / X.nm, X.warp), tf = Math.pow(f / 4000, X.tilt) * (0.7 + 0.6 * draw(S2));
        B.f[j] = f; this.tC[j] = X.tC * kc * tf; this.tO[j] = X.tO * ko * tf;
        this.amp[j] = (0.4 + 0.6 * draw(S2)) * Math.pow(f / 1000, X.ampExp) / Math.sqrt(X.nm) * (pl ? X.p2 : 1);
        this.wT[j] = 1; this.wE[j] = Math.min(1.5, Math.pow(f / 3000, X.edge));
      }
    }
    B.n = N; this.hset = -1;
    this.c1.set(1900, 1.4); this.c2.set(420, 0.8); this.tk.set(9500, 0.8); this.cb.set(X.cbF, X.cbQ); this.ch.set(X.chp, 0.7);
    this.cl.set(X.clF, 0.7); this.th.set(X.thF, 0.7);
  }
  open(h) {
    const B = this.bank, sr = this.sr, dm = this.dm, e = Math.pow(h, HAT2.hExp), top = sr * 0.45;
    for (let k = 0; k < B.n; k++) {
      const t = this.tC[k] * Math.pow(this.tO[k] / this.tC[k], e) * dm, r = Math.exp(-LN1000 / (Math.max(0.004, t) * sr));
      let f = B.f[k] * this.tm; if (f > top) f = top;
      const w = TAU * f / sr;
      B.r[k] = r; B.a2[k] = r * r; B.w[k] = w; B.s[k] = Math.sin(w); B.a1[k] = 2 * r * Math.cos(w);
    }
    this.hset = h;
  }
  // a shorter push reaches higher: the plates' stick is a touch quicker than the original's
  strike(e) {
    // the balance (go, gp: an open stroke +4 LU and the foot -5 LU against a closed one, measured), the stick's contact
    const X = HAT2, art = e.art;
    let h = H_OPEN[art]; if (e.w > 0.02 && art !== H_PEDAL && art !== H_SPLASH) h = e.w;
    e.F *= art === H_PEDAL ? X.gp : 1 + (X.go - 1) * h;
    e.tc *= X.tcK; if (art !== H_PEDAL) this.D += X.thud * e.F;
    super.strike(e);
  }
  silence() { super.silence(); this.D = 0; }
  seg(a, e) {
    const B = this.bank, E = this.E, body = this.body, near = this.near, far = this.far;
    for (let i = a; i < e; i++) body[i] = 0;
    for (let p = a; p < e; p += 32) {
      const q = Math.min(e, p + 32);
      if (this.h !== this.ht) {
        this.h = this.ht + (this.h - this.ht) * Math.exp(-(q - p) / (0.003 * this.sr));
        if (Math.abs(this.h - this.ht) < 1e-3) this.h = this.ht;
      }
      if (this.h !== this.hset) this.open(this.h);
      const drive = this.pulse.fill(E, p, q);
      B.run(body, E, p, q, drive);
    }
    // the chatter (the plates touching, as much as they move), the chick (the plates meeting), the tick (the stick)
    const X = HAT2, h = this.h, cg = X.chatter * this.sizzle * (1 + X.cC * (1 - h)), clg = X.clash * this.sizzle * 4 * h * (1 - h);
    const fa = this.folA, cK = this.cK, tK = this.tK, dK = this.dK, cb = this.cb, ch = this.ch, cl = this.cl, th = this.th, c1 = this.c1, c2 = this.c2, tk = this.tk;
    const tg = 1.1 * X.tick, chg = X.chick, G = X.g;
    let ns = this.ns, se = this.se, C = this.C, T = this.T, D = this.D;
    for (let i = a; i < e; i++) {
      ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1;
      const b = body[i], ab = b < 0 ? -b : b;
      se = ab + (se - ab) * fa;
      cb.tick(w); ch.tick(cb.bp);
      const chick = C > 1e-7 ? (c1.tick(w * C), c2.tick(w * C), (c1.bp * 5 + c2.lp * 2.6) * chg) : 0;
      tk.tick(w * T);
      let x = b + ch.hp * cg * se + tk.bp * tg;
      if (clg > 0) { cl.tick(w); x += cl.bp * clg * se; }
      if (D > 1e-7) { x += th.tick(w) * D; D *= dK; }
      near[i] = (x + chick) * G; far[i] = (x + chick * 0.4) * G;
      C *= cK; T *= tK;
    }
    this.ns = ns; this.se = se < 1e-9 ? 0 : se; this.C = C < 1e-9 ? 0 : C; this.T = T < 1e-9 ? 0 : T; this.D = D < 1e-9 ? 0 : D;
  }
}

// ------------------------------------------------------------------------------------------------ the cymbals
// type 0 crash, 1 ride, 2 china, 3 splash. Partials (seeded per kit, so a cymbal keeps its voice), and three bands of
// wash: a stroke fills each band's reservoir, which swells into the band (the higher bands later) and drains with its
// ring. Repeated strokes add up: a ride's wash builds.
const WASH = [
  [[1600, 4200, 0.4, 0.9, 18], [4200, 8500, 1.0, 0.75, 40], [8500, 15500, 0.9, 0.5, 75]],
  [[2000, 5000, 0.3, 0.8, 10], [5000, 10000, 0.45, 0.7, 25], [10000, 16000, 0.3, 0.5, 50]],
  [[900, 2800, 0.8, 0.8, 8], [2800, 6500, 0.9, 0.6, 18], [6500, 12000, 0.5, 0.45, 35]],
  [[2500, 6000, 0.6, 0.8, 6], [6000, 11000, 0.8, 0.6, 12], [11000, 16000, 0.6, 0.4, 22]],
];
class Cym {
  constructor(sr, seed, type) {
    this.sr = sr; this.type = type; const N = type === 1 ? 26 : type === 3 ? 16 : 22;
    this.bank = new Bank(N); this.pulse = new Pulse();
    this.E = new Float64Array(128); this.near = new Float64Array(128); this.far = new Float64Array(128); this.body = new Float64Array(128);
    this.ns = (seed >>> 0) || 0x68e31da4;
    this.amp = new Float64Array(N); this.wB = new Float64Array(N); this.wL = new Float64Array(N); this.wE = new Float64Array(N);
    this.hp = [new SV(sr), new SV(sr), new SV(sr)]; this.lp = [new SV(sr), new SV(sr), new SV(sr)];
    this.I = new Float64Array(3); this.Bw = new Float64Array(3); this.dI = new Float64Array(3); this.kS = new Float64Array(3); this.gW = new Float64Array(3); this.tW = new Float64Array(3);
    this.tk = new SV(sr); this.T = 0; this.tK = Math.exp(-1 / (0.003 * sr));
    this.am = 0; this.tr = 0; this.trK = 1 - Math.exp(-TAU * 45 / sr);
    this.choke = 1; this.grabAt = -1; this.tm = 1; this.dm = 1; this.dset = -1; this.spec = null; this.bright = 1;
    this.ev = strokes(16); this.nev = 0; this.on = false; this.lvl = -1;
  }
  configure(c, S) {
    const B = this.bank, type = this.type, N = B.N, size = c[0], peak = c[1], t60 = c[2];
    this.spec = c; this.bright = c[3];
    const lo = (type === 3 ? 620 : type === 2 ? 260 : 300) * 16 / size, hi = type === 2 ? 7500 : 13500;
    let k = 0;
    if (type === 1) {
      // the bell: four near-harmonic partials that ring long
      const fb = 760 * 20 / size, BR = [1, 2.03, 2.97, 4.1];
      for (; k < 4; k++) { B.f[k] = fb * BR[k] * (0.99 + 0.02 * draw(S)); B.t[k] = t60 * (0.7 - 0.1 * k); this.amp[k] = 0.9 - 0.15 * k; this.wL[k] = 2.2; this.wB[k] = 0.1; this.wE[k] = 0.3; }
    }
    for (; k < N; k++) {
      const u = draw(S), f = lo * Math.pow(hi / lo, Math.pow(u, 0.9)), lf = Math.log2(f / peak);
      B.f[k] = f;
      B.t[k] = Math.min(1.4 * t60, Math.max(0.2, t60 * Math.pow(f / 1000, -0.42) * (0.75 + 0.5 * draw(S)))) * (f < 800 ? 0.7 : 1);
      this.amp[k] = (0.35 + 0.65 * draw(S)) / (1 + lf * lf / 2.6) * Math.pow(f / (f + 800), 1.5) * (type === 0 ? 0.6 : 1);
      this.wL[k] = f < 2400 ? 1.4 : 0.25;
      this.wB[k] = Math.min(1.5, Math.pow(f / 3000, 0.35));
      this.wE[k] = 1.2 * Math.pow(f / 1000, -0.15);
    }
    B.n = N; B.fm = -1; B.dm = -1; this.dset = -1;
    const sc = Math.sqrt(size / 16), W = WASH[type];
    for (let b = 0; b < 3; b++) {
      this.hp[b].set(W[b][0] * this.tm, 0.7); this.lp[b].set(Math.min(W[b][1] * this.tm, this.sr * 0.45), 0.7);
      this.gW[b] = W[b][2] * c[3] * 2.5; this.tW[b] = t60 * W[b][3];
      this.kS[b] = 1 - Math.exp(-1 / (W[b][4] * 0.001 * sc * this.sr));
    }
    this.tk.set(type === 1 ? 6500 : 5200, 1.1);
  }
  params(tm, dm) {
    if (tm !== this.tm) { this.tm = tm; const W = WASH[this.type]; for (let b = 0; b < 3; b++) { this.hp[b].set(W[b][0] * tm, 0.7); this.lp[b].set(Math.min(W[b][1] * tm, this.sr * 0.45), 0.7); } }
    this.dm = dm;
  }
  decays() {
    const d = this.dm * this.choke;
    this.bank.set(this.sr, this.tm, d);
    for (let b = 0; b < 3; b++) this.dI[b] = Math.exp(-LN1000 / (Math.max(0.01, this.tW[b] * d) * this.sr));
    this.dset = d;
  }
  strike(e) {
    const B = this.bank, art = e.art, type = this.type;
    const grab = (type === 1 && art === 3) || (type !== 1 && art === 1);
    this.choke = 1; this.grabAt = grab ? e.at + Math.round(0.11 * this.sr) : -1;   // a choke: the hit, then a hand grabs it
    if (this.dset !== this.dm) this.decays();
    let W = this.wE, wash = 1, tick = 0, tc = e.tc;
    if (type === 1) {
      if (art === R_BOW) { W = this.wB; wash = 0.2; tick = 1; tc *= 0.7; }
      else if (art === R_BELL) { W = this.wL; wash = 0.06; tick = 0.4; }
      else wash = 0.85;
    }
    for (let k = 0; k < B.n; k++) B.b[k] = this.amp[k] * W[k] * B.s[k];
    const F = e.F;
    this.pulse.add(tc * 0.001 * this.sr, F, 1);
    // the wash grows faster than the force: a hard hit throws more energy up the spectrum
    const wf = wash * Math.pow(F, 1.35);
    for (let b = 0; b < 3; b++) this.I[b] += wf * (b === 2 ? F : 1);
    this.T += tick * F * F;
    this.on = true;
  }
  seg(a, e) {
    const B = this.bank, E = this.E, body = this.body, near = this.near, far = this.far;
    for (let i = a; i < e; i++) body[i] = 0;
    const drive = this.pulse.fill(E, a, e);
    B.run(body, E, a, e, drive);
    let ns = this.ns, am = this.am, tr = this.tr, T = this.T;
    const I = this.I, Bw = this.Bw, dI = this.dI, kS = this.kS, gW = this.gW, h0 = this.hp[0], h1 = this.hp[1], h2 = this.hp[2], l0 = this.lp[0], l1 = this.lp[1], l2 = this.lp[2];
    const china = this.type === 2, trK = this.trK, tk = this.tk, tK = this.tK;
    let i0 = I[0], i1 = I[1], i2 = I[2], b0 = Bw[0], b1 = Bw[1], b2 = Bw[2];
    const d0 = dI[0], d1 = dI[1], d2 = dI[2], k0 = kS[0], k1 = kS[1], k2 = kS[2], g0 = gW[0], g1 = gW[1], g2 = gW[2];
    for (let i = a; i < e; i++) {
      ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1;
      am += (w - am) * 0.0004;                                   // a slow drift in the wash (the cymbal turning)
      b0 += (i0 - b0) * k0; b1 += (i1 - b1) * k1; b2 += (i2 - b2) * k2;
      i0 *= d0; i1 *= d1; i2 *= d2;
      let m = 1 + 3 * am;
      if (china) { tr += (w - tr) * trK; m *= 1 + 2.2 * tr; }      // the china's trash: a fast rough flutter
      h0.tick(w); l0.tick(h0.hp); h1.tick(w); l1.tick(h1.hp); h2.tick(w); l2.tick(h2.hp);
      const wash = (l0.lp * b0 * g0 + l1.lp * b1 * g1 + l2.lp * b2 * g2) * m;
      tk.tick(w * T); T *= tK;
      const x = body[i] + wash * 0.6;
      near[i] = x + tk.bp * 0.7; far[i] = x + tk.bp * 0.4;
    }
    I[0] = i0; I[1] = i1; I[2] = i2; Bw[0] = b0; Bw[1] = b1; Bw[2] = b2;
    this.ns = ns; this.am = am; this.tr = tr; this.T = T < 1e-9 ? 0 : T;
  }
  render(n) {
    if (this.dset !== this.dm * this.choke) this.decays();
    let pos = 0, k = 0;
    while (pos < n || k < this.nev) {
      // the next thing to happen: a stroke, or the hand closing on the cymbal
      const ea = k < this.nev ? Math.min(n, Math.max(pos, this.ev[k].at)) : n, ga = this.grabAt >= 0 && this.grabAt < n ? Math.max(pos, this.grabAt) : n, at = ea < ga ? ea : ga;
      if (at > pos) { this.seg(pos, at); pos = at; }
      if (ga === pos && this.grabAt >= 0 && this.grabAt < n) { this.grabAt = -1; this.choke = 0.025; this.decays(); continue; }
      if (k < this.nev && ea === pos) { this.strike(this.ev[k++]); if (this.dset !== this.dm * this.choke) this.decays(); continue; }
      if (pos >= n) break;
    }
    this.nev = 0;
    if (this.grabAt >= n) this.grabAt -= n;
    const live = this.bank.prune(), I = this.I, Bw = this.Bw;
    const wash = I[0] + I[1] + I[2] + Bw[0] + Bw[1] + Bw[2];
    if (wash < 1e-7) { I.fill(0); Bw.fill(0); }
    this.on = live > 0 || this.pulse.n > 0 || wash >= 1e-7 || this.T > 1e-7;
    return this.on;
  }
}

// ------------------------------------------------------------------------------------------------ percussion
// tambourine (jingles: a few quick collisions), cowbell (a struck bell's partials), shaker (beads), claps (a few people)
class Perc {
  constructor(sr, seed, type) {
    this.sr = sr; this.type = type;
    this.bank = new Bank(6); this.pulse = new Pulse();
    this.E = new Float64Array(128); this.near = new Float64Array(128); this.far = new Float64Array(128); this.body = new Float64Array(128);
    this.ns = (seed >>> 0) || 0x1b873593;
    this.f1 = new SV(sr); this.f2 = new SV(sr);
    this.env = 0; this.att = 0; this.qa = new Float64Array(6); this.qt = new Float64Array(6); this.nq = 0; this.t = 0;
    this.tm = -1; this.ev = strokes(16); this.nev = 0; this.on = false; this.lvl = -1; this.S = new Uint32Array(1);
    this.S[0] = (seed ^ 0x5bd1e995) >>> 0 || 7;
    const B = this.bank;
    if (type === 0) { B.n = 5; for (let k = 0; k < 5; k++) { B.f[k] = (6100 + 1150 * k) * (0.96 + 0.08 * draw(this.S)); B.t[k] = 0.28; } this.f1.set(5200, 0.7); this.f2.set(9000, 0.8); }
    else if (type === 1) { const F = [545, 815, 1450, 2180, 3280], T = [0.45, 0.38, 0.22, 0.16, 0.1], A = [1, 0.8, 0.6, 0.5, 0.35]; B.n = 5; for (let k = 0; k < 5; k++) { B.f[k] = F[k]; B.t[k] = T[k]; this.qa[k] = A[k]; } this.f1.set(3000, 1); }
    else if (type === 2) { B.n = 0; this.f1.set(6500, 1.2); this.f2.set(3000, 0.7); }
    else { B.n = 0; this.f1.set(1350, 0.9); this.f2.set(650, 0.7); }
    B.fm = -1; B.dm = -1;
  }
  params(tm) { this.tm = tm; this.bank.set(this.sr, tm, 1); }
  strike(e) {
    const F = e.F, B = this.bank, sr = this.sr;
    this.t = 0; this.nq = 0;
    if (this.type === 0) {
      for (let k = 0; k < B.n; k++) B.b[k] = (0.6 + 0.4 * draw(this.S)) * B.s[k];
      const at = [0, 5.5, 12, 21];
      for (let k = 0; k < 4; k++) { this.qt[k] = (at[k] + (k ? 2 * draw(this.S) : 0)) * 0.001 * sr; this.qa[k] = F * (1 - 0.22 * k); }
      this.nq = 4; this.env += F;
    } else if (this.type === 1) {
      for (let k = 0; k < B.n; k++) B.b[k] = this.qa[k] * B.s[k];
      this.pulse.add(0.3 * 0.001 * sr * (1.5 - 0.5 * F), F, 0); this.env += F;
    } else if (this.type === 2) { this.att = F; this.env = 0; }
    else {
      const at = [0, 6.5, 13, 22];
      for (let k = 0; k < 4; k++) { this.qt[k] = (at[k] + 2.5 * draw(this.S)) * 0.001 * sr; this.qa[k] = F * (k === 3 ? 1 : 0.8); }
      this.nq = 4;
    }
    this.on = true;
  }
  seg(a, e) {
    const B = this.bank, E = this.E, body = this.body, near = this.near, far = this.far, sr = this.sr, type = this.type;
    for (let i = a; i < e; i++) body[i] = 0;
    if (type === 0 && this.nq) {
      // the jingles meeting: a burst of short pushes
      for (let i = a; i < e; i++) E[i] = 0;
      let any = false;
      for (let k = 0; k < this.nq; k++) { const at = Math.round(this.qt[k] - this.t) + a; if (at >= a && at < e) { E[at] += this.qa[k]; any = true; } }
      if (any) B.run(body, E, a, e, true); else B.run(body, E, a, e, false);
    } else if (B.n) { const drive = this.pulse.fill(E, a, e); B.run(body, E, a, e, drive); }
    let ns = this.ns, env = this.env, t = this.t;
    const f1 = this.f1, f2 = this.f2;
    if (type === 0) {
      const k = Math.exp(-1 / (0.045 * sr));
      for (let i = a; i < e; i++) { ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1; f1.tick(w * env); f2.tick(f1.hp); const x = body[i] * 0.5 + f2.bp * 0.9; near[i] = x; far[i] = x; env *= k; }
    } else if (type === 1) {
      const k = Math.exp(-1 / (0.002 * sr));
      for (let i = a; i < e; i++) { ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1; f1.tick(w * env); const x = body[i] + f1.bp * 0.3; near[i] = x; far[i] = x; env *= k; }
    } else if (type === 2) {
      // beads: a 10 ms swing in, then they settle
      const rise = 1 / (0.01 * sr), k = Math.exp(-1 / (0.05 * sr));
      let att = this.att;
      for (let i = a; i < e; i++) {
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1;
        if (att > 0) { env += att * rise; if (t * rise >= 1) att = 0; } else env *= k;
        const g = (ns & 7) === 0 ? 2.2 : 0.85;   // grains
        f1.tick(w * env * g); f2.tick(f1.bp);
        const x = f2.hp * 1.4; near[i] = x; far[i] = x; t++;
      }
      this.att = att;
    } else {
      // claps: four people a few ms apart, each a short burst
      const k = Math.exp(-1 / (0.008 * sr));
      for (let i = a; i < e; i++, t++) {
        for (let q = 0; q < this.nq; q++) if (t >= this.qt[q] && t < this.qt[q] + 1) env += this.qa[q];
        ns = (Math.imul(ns, 1664525) + 1013904223) >>> 0; const w = ns * 4.656612873077393e-10 - 1;
        f1.tick(w * env); f2.tick(f1.bp);
        const x = f2.hp * 2.2; near[i] = x; far[i] = x; env *= k;
      }
    }
    if (type !== 2 && type !== 3) this.t += e - a; else this.t = t;
    this.ns = ns; this.env = env < 1e-9 ? 0 : env;
  }
  render(n) {
    let pos = 0;
    for (let k = 0; k < this.nev; k++) {
      const ev = this.ev[k], at = ev.at < pos ? pos : ev.at > n ? n : ev.at;
      if (at > pos) { this.seg(pos, at); pos = at; }
      this.strike(ev);
    }
    this.nev = 0;
    if (pos < n) this.seg(pos, n);
    const live = this.bank.prune();
    const pending = (this.type === 0 || this.type === 3) && this.t < 0.03 * this.sr;
    this.on = live > 0 || this.pulse.n > 0 || this.env > 1e-7 || this.att > 0 || pending;
    return this.on;
  }
}

// ------------------------------------------------------------------------------------------------ the room
// A small FDN for the room pair's tail (eight lines, a Householder mix, damping in the loop), linear reads so a size
// change glides; early reflections are taps on a line of the room mics' signal.
function room(sr, S) {
  const N = 8, BASE = [601, 733, 859, 977, 1103, 1237, 1361, 1489], k = sr / 48000;
  let size = 1; while (size < Math.ceil(1489 * 2.4 * k) + 8) size <<= 1;
  const mask = size - 1, buf = new Float32Array(size * N), len = new Float64Array(N), g = new Float64Array(N), lp = new Float64Array(N), x = new Float64Array(N);
  let a = 0, w = 0, last = -1;
  const ER = [7.3, 11.9, 17.1, 23.6, 31.4, 41.7], ERR = [8.6, 13.4, 16.2, 26.3, 34.1, 44.8], EG = [0.62, -0.5, 0.42, -0.36, 0.3, -0.24];
  let esz = 1; while (esz < Math.ceil(0.1 * sr) + 8) esz <<= 1;
  const em = esz - 1, eL = new Float32Array(esz), eR = new Float32Array(esz), tL = new Float64Array(6), tR = new Float64Array(6);
  let ew = 0;
  const o = {
    l: 0, r: 0, e: 0,
    set(s) {
      if (s === last) return;
      last = s;
      const sc = (0.45 + 1.0 * s) * k, t60 = 0.3 + 1.5 * Math.pow(s, 1.2);
      for (let i = 0; i < N; i++) { len[i] = BASE[i] * sc * 2; g[i] = Math.pow(10, -3 * len[i] / (t60 * sr)); }
      a = Math.exp(-TAU * (8000 + 4000 * (1 - s)) / sr);
      const es = (0.55 + 1.0 * s) * sr * 0.001;
      for (let i = 0; i < 6; i++) { tL[i] = ER[i] * es; tR[i] = ERR[i] * es; }
    },
    // in: the room mics' signal; out: (.l, .r) the reflections and the tail, without the direct sound
    tick(inL, inR) {
      eL[ew] = inL; eR[ew] = inR;
      let el = 0, er = 0;
      for (let i = 0; i < 6; i++) {
        const pl = ew - tL[i], jl = Math.floor(pl), fl = pl - jl, vl = eL[jl & em], pr = ew - tR[i], jr = Math.floor(pr), fr = pr - jr, vr = eR[jr & em];
        el += EG[i] * (vl + (eL[(jl + 1) & em] - vl) * fl); er += EG[i] * (vr + (eR[(jr + 1) & em] - vr) * fr);
      }
      ew = (ew + 1) & em;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const p = w - len[i], j = Math.floor(p), f = p - j, base = i * size, v0 = buf[base + (j & mask)], v = v0 + (buf[base + ((j + 1) & mask)] - v0) * f;
        lp[i] = v + (lp[i] - v) * a;
        x[i] = lp[i] * g[i]; sum += x[i];
      }
      sum *= 2 / N;
      const il = (inL + el) * 0.35, ir = (inR + er) * 0.35;
      for (let i = 0; i < N; i++) buf[i * size + w] = x[i] - sum + ((i & 1) ? ir : il);
      w = (w + 1) & mask;
      o.l = el + x[0] - x[2] + x[4] - x[6] + 0.5 * (x[1] - x[5]);
      o.r = er + x[1] - x[3] + x[5] - x[7] + 0.5 * (x[2] - x[6]);
      o.e = sum;
    },
    clear() { buf.fill(0); lp.fill(0); x.fill(0); eL.fill(0); eR.fill(0); },
  };
  return o;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const besselI0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / 2 / k) * (x / 2 / k); s += t; } return s; };
const dbx = (d) => (d <= -39.9 ? 0 : Math.pow(10, d / 20));
// the last safety, past the limiter's ceiling (it never engages at any setting the limiter can hold): linear to 0.9
const ceil = (x) => { const a = x < 0 ? -x : x; if (a <= 0.9) return x; const y = 0.9 + 0.09 * Math.tanh((a - 0.9) / 0.09); return x < 0 ? -y : y; };

return {
  poly: 24,
  create({ sr, seed }) {
    const S = new Uint32Array(1);                  // create-time and kit draws
    const HR = new Uint32Array(1); HR[0] = (seed ^ 0x4b1d) >>> 0 || 99;   // every hit's variation, in the order hits arrive
    const hr = () => draw(HR) * 2 - 1;
    // the pieces
    const P = [];
    P[KICK] = new Drum(sr, 0, seed ^ 0x11);
    P[SNARE] = new Drum(sr, 1, seed ^ 0x22);
    P[HAT] = new Hat(sr, seed ^ 0x33);
    const hat1 = P[HAT], hat2 = new Hat2(sr, seed ^ 0x34);   // hat_model: 0 the original, 1 PLATES
    for (let k = 0; k < 4; k++) P[TOM1 + k] = new Drum(sr, 2, seed ^ (0x44 + k));
    P[CRASH1] = new Cym(sr, seed ^ 0x55, 0); P[CRASH2] = new Cym(sr, seed ^ 0x56, 0); P[RIDE] = new Cym(sr, seed ^ 0x57, 1);
    P[CHINA] = new Cym(sr, seed ^ 0x58, 2); P[SPLASH] = new Cym(sr, seed ^ 0x59, 3);
    P[TAMB] = new Perc(sr, seed ^ 0x61, 0); P[COW] = new Perc(sr, seed ^ 0x62, 1); P[SHAKER] = new Perc(sr, seed ^ 0x63, 2); P[CLAP] = new Perc(sr, seed ^ 0x64, 3);
    const ORDER = [KICK, TOM1, TOM1 + 1, TOM1 + 2, TOM4, SNARE, HAT, CRASH1, CRASH2, RIDE, CHINA, SPLASH, TAMB, COW, SHAKER, CLAP];

    // ---- the mics: each piece's pan in the close mics, its time of flight and level at each overhead, room mic and the
    // crush mic, and how it leaks into the other close mics
    let RING = 1; while (RING < Math.ceil(0.04 * sr) + 2048) RING <<= 1;
    const RM = RING - 1;
    const clL = new Float64Array(NP), clR = new Float64Array(NP), ohD = new Float64Array(NP * 2), ohG = new Float64Array(NP * 2);
    const rmD = new Int32Array(NP * 2), rmG = new Float64Array(NP * 2), crD = new Int32Array(NP), crG = new Float64Array(NP);
    const blD = new Int32Array(NP), blL = new Float64Array(NP), blR = new Float64Array(NP);
    const card = (mic, aim, p) => { const v = [p[0] - mic[0], p[1] - mic[1], p[2] - mic[2]], a = [aim[0] - mic[0], aim[1] - mic[1], aim[2] - mic[2]], d = Math.hypot(v[0], v[1], v[2]) || 1, da = Math.hypot(a[0], a[1], a[2]) || 1; return 0.5 + 0.5 * (v[0] * a[0] + v[1] * a[1] + v[2] * a[2]) / (d * da); };
    for (let p = 0; p < NP; p++) {
      const x = POS[p], pan = clamp(x[0] / 0.8, -1, 1) * 0.85, g = panLR(pan);
      clL[p] = g[0]; clR[p] = g[1];
      const dl = dist(x, OHL), dr = dist(x, OHR);
      ohD[2 * p] = dl / CS * sr; ohD[2 * p + 1] = dr / CS * sr;
      ohG[2 * p] = UP[p] * card(OHL, [OHL[0], OHL[1], 0], x) / Math.max(0.3, dl); ohG[2 * p + 1] = UP[p] * card(OHR, [OHR[0], OHR[1], 0], x) / Math.max(0.3, dr);
      const rl = dist(x, RML), rr = dist(x, RMR);
      rmD[2 * p] = Math.round(rl / CS * sr); rmD[2 * p + 1] = Math.round(rr / CS * sr);
      rmG[2 * p] = FRONT[p] * card(RML, RMAIM, x) * 3 / rl; rmG[2 * p + 1] = FRONT[p] * card(RMR, RMAIM, x) * 3 / rr;
      const dc = dist(x, CRM); crD[p] = Math.round(dc / CS * sr); crG[p] = FRONT[p] * 1.6 / dc;
      // leaks into the other close mics, each heard at that mic's pan, by distance (a close mic sits 6 cm from its drum)
      let sl = 0, sr2 = 0, sd = 0, sw = 0;
      for (let m = 0; m < NP; m++) {
        if (m === p || !CLOSE[m]) continue;
        const d = dist(x, POS[m]), leak = Math.min(0.35, 0.06 / d * 0.45 * ISO[m]), gm = panLR(clamp(POS[m][0] / 0.8, -1, 1) * 0.85);
        sl += leak * gm[0]; sr2 += leak * gm[1]; sd += leak * d; sw += leak;
      }
      blL[p] = sl; blR[p] = sr2; blD[p] = Math.round((sw ? sd / sw : 0.5) / CS * sr);
    }
    // the buses: rings the pieces write ahead into (each at its own delay), read and cleared a block at a time
    const oL = new Float64Array(RING), oR = new Float64Array(RING), mL = new Float64Array(RING), mR = new Float64Array(RING), cR = new Float64Array(RING), bL = new Float64Array(RING), bR = new Float64Array(RING);
    let wp = 0;
    let CL = new Float64Array(128), CR = new Float64Array(128), SY = new Float64Array(128);
    const rm = room(sr, S);
    // the overheads' EQ (a low cut, a little air), the room's (darker, distant), the crush chain, the bleed's tone
    const ohHL = new SV(sr).set(90, 0.6), ohHR = new SV(sr).set(90, 0.6), ohAL = new SV(sr).set(9000, 0.7), ohAR = new SV(sr).set(9000, 0.7);
    const rmHL = new SV(sr).set(60, 0.6), rmHR = new SV(sr).set(60, 0.6), rmLL = new SV(sr).set(11000, 0.6), rmLR = new SV(sr).set(11000, 0.6);
    const crH = new SV(sr).set(140, 0.6), crL = new SV(sr).set(8000, 0.6);
    const blHL = new SV(sr).set(150, 0.6), blHR = new SV(sr).set(150, 0.6), blLL = new SV(sr).set(6500, 0.6), blLR = new SV(sr).set(6500, 0.6);
    // The room pair is mono in the lows: mid and side, the side (L - R) through a fourth-order high pass at MONO Hz,
    // the middle untouched. The room's reflections reach its two mics at different times and alternate in sign, and its
    // tail differs on each side, so without it the kick's low end came out of phase between left and right and
    // cancelled in mono. Only the room: the overheads' low end is in phase already (the kick sits between them), and
    // turning a spaced pair's side would turn its time differences into level differences (the floor toms would swap
    // sides). Above the corner the room is as wide as it was.
    const MONO = 120, rsA = new SV(sr).set(MONO, 0.5412), rsB = new SV(sr).set(MONO, 1.3066);
    let crE1 = 0;
    // the preamps: each close mic and each overhead runs into its own soft ceiling, rounding the top few dB of the hardest
    // hits the way a driven console or tape does (a hit well under it passes untouched)
    const HRC = 0.6, iHRC = 1 / HRC;
    // the output: a stereo-linked true-peak limiter with a 1.5 ms window, plus its detector's 8 samples (1.67 ms at 48 kHz
    // in all, declared as latency, so the studio lines the other tracks up), so a natural kit's transients land under
    // -1 dBTP without clipping. The gain is the lowest any point in the window asks for, averaged over the window: it eases
    // down to exactly what the loudest needs as it arrives.
    const LA = Math.max(1, Math.round(0.0015 * sr));
    let LN = 1; while (LN < LA + 8 + 2) LN <<= 1;
    const LM = LN - 1, dlL = new Float64Array(LN), dlR = new Float64Array(LN), hb = new Float64Array(LN).fill(1);
    const dqV = new Float64Array(LN), dqI = new Float64Array(LN);
    let dqH = 0, dqT = 0, lw = 0, nAbs = 0, gLim = 1;
    // the detector reads true peaks (between the samples too): a 4x polyphase windowed sinc, as audio/measure.js does,
    // 16 taps a phase; the audio waits its half-length (TT) more, so every point it finds is in the window in time
    const TT = 8, TPR = [];
    for (let ph = 1; ph < 4; ph++) {
      const f = ph / 4, row = new Float64Array(2 * TT); let sum = 0;
      for (let j = -TT + 1; j <= TT; j++) { const x = j - f, u = x / (TT + 0.5), w = Math.abs(u) >= 1 ? 0 : besselI0(8 * Math.sqrt(1 - u * u)) / besselI0(8), v = Math.sin(Math.PI * 0.94 * x) / (Math.PI * x); row[j + TT - 1] = v * w; sum += v * w; }
      for (let k = 0; k < row.length; k++) row[k] /= sum;
      TPR.push(row);
    }
    const ringL = new Float64Array(32), ringR = new Float64Array(32);
    let ti = 0;
    const THR = Math.pow(10, -1.5 / 20), limRel = Math.exp(-1 / (0.04 * sr)), boxN = LA + 1;
    const crRel = Math.exp(-1 / (0.07 * sr)), CRT = 0.008;
    // and a gate after it, as on the records that made the trick: once the room has fallen 20 dB under the threshold the
    // crush closes over 120 ms, so its tail ends instead of the makeup lifting the room's last breath
    let gate = 0;
    const gateT = CRT * 0.1, gateA = 1 - Math.exp(-1 / (0.001 * sr)), gateR = 1 - Math.exp(-1 / (0.12 * sr));
    // fader glides (per sample, ~15 ms)
    const gk = 1 - Math.exp(-1 / (0.015 * sr));
    let gC = 0, gO = 0, gM = 0, gX = 0, gB = 0, swap = 0, first = true, roomOn = false, crushOn = false, quiet = 0;
    const QUIET = Math.round(0.1 * sr);
    let kit = -1;
    // ---- strokes due later (flams, drags, rolls): [frame, piece, art, F, r, tc]
    const Q = []; for (let i = 0; i < 64; i++) Q.push({ f: 0, p: 0, art: 0, F: 0, r: 0, tc: 1, w: 0 });
    let nQ = 0, F0 = 0;
    const later = (f, p, art, F, r, tc) => { if (nQ >= 64) return; const q = Q[nQ++]; q.f = f; q.p = p; q.art = art; q.F = F; q.r = r; q.tc = tc; q.w = 0; };
    // rolls: a held note keeps the sticks bouncing until it ends
    const ROLLS = []; for (let i = 0; i < 4; i++) ROLLS.push({ probe: null, next: 0, F: 0, k: 0, stop: -1 });
    // the probes: hits started this block, in order
    const pend = []; for (let i = 0; i < 64; i++) pend.push({ p: 0, v: 0, probe: null });
    let nPend = 0;
    let hand = 0;

    function configure(kt) {
      const K = KITS[kt];
      S[0] = (seed ^ (0x9e37 * (kt + 1))) >>> 0 || 1;
      P[KICK].configure(K.kick, K.kick.f0, K.kick.t60);
      P[SNARE].configure(K.snare, K.snare.f0, K.snare.t60);
      for (let k = 0; k < 4; k++) P[TOM1 + k].configure(K.tom, K.toms[k], K.tomT[k]);
      hat1.configure(K.hat, S); hat2.configure(K.hat);
      for (let k = 0; k < 5; k++) P[CRASH1 + k].configure(K.cym[k], S);
    }
    function push(p, at, art, F, r, tc, w) {
      const pc = P[p];
      if (pc.nev >= pc.ev.length) return;
      // keep them in time order
      let j = pc.nev++;
      while (j > 0 && pc.ev[j - 1].at > at) { const t = pc.ev[j]; pc.ev[j] = pc.ev[j - 1]; pc.ev[j - 1] = t; j--; }
      const e = pc.ev[j]; e.at = at; e.art = art; e.F = F; e.r = r; e.tc = tc; e.w = w;
    }
    // a stroke's force, landing spot and contact from its velocity, the articulation and the humanize amount
    function hit(p, art, vel, at, Pm, w, probe) {
      const H = Pm.humanize, vc = Math.pow(2, -Pm.velocity);
      let F = Math.pow(clamp(vel, 0.01, 1), 1.15 * vc) * (1 + 0.06 * H * hr());
      const K = KITS[kit];
      let r = 0.3, tc = 0.6;
      const soft = F < 1 ? 1 - F : 0;                // (humanize can push a full-velocity hit a hair past 1)
      if (p === KICK) { r = K.kick.r; tc = K.kick.tc[0] + (K.kick.tc[1] - K.kick.tc[0]) * Math.pow(soft, 1.3); }
      else if (p === SNARE) {
        r = art === S_RIM ? 0.82 : art === S_EDGE ? 0.72 : art === S_SIDE ? 0.92 : K.snare.r + (F < 0.4 ? 0.08 : 0);
        tc = K.snare.tc[0] + (K.snare.tc[1] - K.snare.tc[0]) * Math.pow(soft, 1.4);
        if (art === S_RIM) tc *= 0.7;
      } else if (p >= TOM1 && p <= TOM4) { r = K.tom.r; tc = K.tom.tc[0] + (K.tom.tc[1] - K.tom.tc[0]) * Math.pow(soft, 1.4); }
      else if (p === HAT) tc = 0.12 + 0.32 * Math.pow(soft, 1.3);
      else if (p >= CRASH1 && p <= SPLASH) tc = 0.15 + 0.45 * Math.pow(soft, 1.3);
      r = clamp(r + 0.06 * H * hr(), 0, 0.95); tc *= 1 + 0.12 * H * hr();
      if (p === SNARE && (art === S_FLAM || art === S_DRAG)) {
        // grace notes first, from the other hand, then the stroke: the main hit lands a flam (or a drag) late
        const sp = (art === S_FLAM ? 0.024 : 0.034) * sr * (1 + 0.15 * H * hr());
        push(SNARE, at, S_CENTER, F * 0.42, clamp(r + 0.07, 0, 0.9), tc * 1.3, 0);
        if (art === S_DRAG) later(F0 + at + Math.round(sp), SNARE, S_CENTER, F * 0.34, clamp(r + 0.05, 0, 0.9), tc * 1.35);
        later(F0 + at + Math.round(sp * (art === S_DRAG ? 2.2 : 1)), SNARE, S_CENTER, F, r, tc);
        return;
      }
      if (p === SNARE && art === S_ROLL) {
        let slot = null;
        for (const R of ROLLS) if (!R.probe) { slot = R; break; }
        if (!slot) slot = ROLLS[0];
        slot.probe = probe; slot.next = F0 + at; slot.F = F; slot.k = 0; slot.stop = -1;
        if (probe) probe.roll = slot;
        return;
      }
      push(p, at, art, F, r, tc, w);
    }

    configure(0); kit = 0;
    return {
      latency: LA + 8,
      voice() {
        // a probe: it times its note (frames rendered before process() runs) and reads the note's mod
        const me = { n: 0, st: 0, mod: 0, relN: 0, early: false, roll: null,
          start(p, v) { me.n = 0; me.st = 1; me.mod = 0; me.relN = 0; me.early = false; me.roll = null; if (nPend < 64) { const h = pend[nPend++]; h.p = p; h.v = v; h.probe = me; } },
          release() { if (me.st === 2) { me.st = 4; me.relN = 0; } else if (me.st === 1) me.early = true; },
          render(L, R, m, Pm, t) {
            if (me.st === 1) { if (me.n === 0) me.mod = t ? t.mod || 0 : 0; me.n += m; return true; }
            if (me.st === 2) { me.mod = t ? t.mod || 0 : 0; return true; }
            if (me.st === 4) { me.relN += m; return true; }
            return false;
          },
          stop() { if (me.roll) { me.roll.stop = F0; me.roll = null; } me.st = 0; },
        };
        return me;
      },
      process(L, R, n, Pm) {
        if (CL.length < n) {
          CL = new Float64Array(n); CR = new Float64Array(n); SY = new Float64Array(n);
          for (const pc of P.concat([P[HAT] === hat1 ? hat2 : hat1])) { pc.E = new Float64Array(n); pc.near = new Float64Array(n); pc.far = new Float64Array(n); pc.body = new Float64Array(n); }
        }
        const kt = Pm.kit | 0;
        if (kt !== kit) { kit = kt; configure(kt); }
        const hw = (Pm.hat_model | 0) === 1 ? hat2 : hat1;
        if (P[HAT] !== hw) { P[HAT].silence(); hw.silence(); hw.tm = -1; P[HAT] = hw; }
        const K = KITS[kit];
        // ---- per-block params: each piece's tuning and ring
        const tg = Math.pow(2, Pm.tune / 12), dg = Pm.decay;
        for (let p = 0; p < 12; p++) {
          const tm = tg * Math.pow(2, Pm[TKEY[p]] / 12), dm = dg * Pm[DKEY[p]];
          P[p].params(tm, dm, Pm.snare_wires);
        }
        for (let p = TAMB; p <= CLAP; p++) if (P[p].tm !== tg) P[p].params(tg);
        // ---- the hits the probes started in this block
        for (let h = 0; h < nPend; h++) {
          const e = pend[h], pr = e.probe, at = clamp(n - pr.n, 0, n - 1), m = NOTES[e.p];
          let p = SNARE, art = S_SIDE, v = e.v;
          if (m) { p = m[0]; art = m[1]; } else v *= 0.5;   // a note the kit doesn't have: the side stick, quietly
          const w = p === HAT ? pr.mod : 0;
          hit(p, art, v, at, Pm, w, pr);
          pr.st = pr.roll ? 2 : 3;
          if (pr.roll && pr.early) { pr.roll.stop = F0 + n; pr.roll = null; pr.st = 3; }
        }
        nPend = 0;
        // ---- releases (rolls end) and rolls' strokes due this block
        for (const Rl of ROLLS) {
          const pr = Rl.probe;
          if (!pr) continue;
          if (pr.st === 4) { Rl.stop = F0 + clamp(n - pr.relN, 0, n); pr.st = 3; pr.roll = null; }
          const swell = pr.mod > 0.02 ? 0.15 + 0.85 * pr.mod : 1;
          while (Rl.next < F0 + n && (Rl.stop < 0 || Rl.next < Rl.stop)) {
            // a press roll: each hand's stroke and its bounces, alternating, about 48 a second
            const k = Rl.k++, pat = (k & 3) === 0 ? 1 : (k & 3) === 1 ? 0.62 : (k & 3) === 2 ? 0.42 : 0.28;
            const H = Pm.humanize, F = Rl.F * swell * pat * ((k & 4) ? 0.92 : 1) * (1 + 0.08 * H * hr());
            push(SNARE, Rl.next - F0, S_CENTER, F, clamp(0.3 + ((k & 4) ? 0.06 : -0.02) + 0.04 * hr(), 0, 0.9), 0.9 + 0.3 * (1 - F), 0);
            Rl.next += Math.round(0.021 * sr * (1 + 0.12 * hr()));
          }
          if (Rl.stop >= 0 && (Rl.next >= Rl.stop || Rl.stop < F0 + n)) { Rl.probe = null; Rl.stop = -1; }
        }
        // ---- grace notes and stroke followers due this block
        for (let i = 0; i < nQ;) {
          const q = Q[i];
          if (q.f < F0 + n) { push(q.p, Math.max(0, q.f - F0), q.art, q.F, q.r, q.tc, q.w); Q[i] = Q[--nQ]; Q[nQ] = q; } else i++;
        }
        // ---- the faders: per-sample glides toward this block's targets
        const tC = dbx(Pm.mix_close), tO = dbx(Pm.mix_oh), tM = dbx(Pm.mix_room), tX = dbx(Pm.mix_crush), tB = Pm.bleed, tS = Pm.view === 1 ? 1 : 0;
        if (first) { gC = tC; gO = tO; gM = tM; gX = tX; gB = tB; swap = tS; first = false; }
        if (tM > 0) roomOn = true;
        if (tX > 0) crushOn = true;
        rm.set(Pm.room_size);
        // ---- nothing sounding, and the output silent for 100 ms (every ring read out by then): the kit rests
        let live = false;
        for (let p = 0; p < NP; p++) if (P[p].on || P[p].nev) { live = true; break; }
        if (!live && quiet >= QUIET) { gC = tC; gO = tO; gM = tM; gX = tX; gB = tB; swap = tS; F0 += n; return; }
        // ---- the pieces, then their mics
        for (let i = 0; i < n; i++) { CL[i] = 0; CR[i] = 0; SY[i] = 0; }
        let any = false, symp = false;
        const kitG = K.gain;
        for (let oi = 0; oi < NP; oi++) {
          const p = ORDER[oi], pc = P[p], g1 = dbx(Pm[LKEY[p]]) * GAIN[p] * kitG;
          // (a piece that wakes starts at its level: no fade-in on the first stroke)
          if (!pc.on && !pc.nev && !(p === SNARE && symp)) { pc.lvl = g1; continue; }
          if (p === SNARE) pc.render(n, symp ? SY : null); else pc.render(n);
          // the kick and the toms shake the snare's wires
          if (p === KICK || (p >= TOM1 && p <= TOM4)) { const body = pc.body, c = p === KICK ? 0.035 : 0.07; for (let i = 0; i < n; i++) SY[i] += body[i] * c; symp = true; }
          any = true;
          const g0 = pc.lvl < 0 ? g1 : pc.lvl, dg2 = (g1 - g0) / n;
          pc.lvl = g1;
          const near = pc.near, far = pc.far, cl = CLOSE[p] ? 1 : 0, pl = clL[p], pr = clR[p];
          const dOL = ohD[2 * p], dOR = ohD[2 * p + 1], iOL = Math.floor(dOL), iOR = Math.floor(dOR), fOL = dOL - iOL, fOR = dOR - iOR, gOL = ohG[2 * p], gOR = ohG[2 * p + 1];
          const iML = rmD[2 * p], iMR = rmD[2 * p + 1], gML = rmG[2 * p], gMR = rmG[2 * p + 1], iX = crD[p], gXp = crG[p], iB = blD[p], gBL = blL[p], gBR = blR[p];
          let g = g0;
          for (let i = 0; i < n; i++) {
            g += dg2;
            const x = near[i] * g, y = far[i] * g, wi = wp + i;
            if (cl) { const xs = HRC * sat(x * iHRC); CL[i] += xs * pl; CR[i] += xs * pr; }
            let j = (wi + iOL) & RM; oL[j] += y * gOL * (1 - fOL); oL[(j + 1) & RM] += y * gOL * fOL;
            j = (wi + iOR) & RM; oR[j] += y * gOR * (1 - fOR); oR[(j + 1) & RM] += y * gOR * fOR;
            if (roomOn) { mL[(wi + iML) & RM] += y * gML; mR[(wi + iMR) & RM] += y * gMR; }
            if (crushOn) cR[(wi + iX) & RM] += y * gXp;
            bL[(wi + iB) & RM] += y * gBL; bR[(wi + iB) & RM] += y * gBR;
          }
        }
        // ---- the buses: read what has arrived, mix
        const swapK = gk, OUT = 1.12;
        let hsum = 0; for (let k = 0; k < boxN; k++) hsum += hb[(lw - k) & LM];
        let opk = 0;
        for (let i = 0; i < n; i++) {
          const j = (wp + i) & RM;
          const ol = oL[j], or2 = oR[j], ml = mL[j], mr = mR[j], cx = cR[j], bl = bL[j], br = bR[j];
          oL[j] = 0; oR[j] = 0; mL[j] = 0; mR[j] = 0; cR[j] = 0; bL[j] = 0; bR[j] = 0;
          gC += (tC - gC) * gk; gO += (tO - gO) * gk; gM += (tM - gM) * gk; gX += (tX - gX) * gk; gB += (tB - gB) * gk; swap += (tS - swap) * swapK;
          // close mics, with what bleeds into them
          blHL.tick(bl); blLL.tick(blHL.hp); blHR.tick(br); blLR.tick(blHR.hp);
          let l = (CL[i] + blLL.lp * gB * 1.6) * gC, r = (CR[i] + blLR.lp * gB * 1.6) * gC;
          // overheads
          ohHL.tick(ol); ohAL.tick(ohHL.hp); ohHR.tick(or2); ohAR.tick(ohHR.hp);
          l += HRC * sat((ohHL.hp + ohAL.hp * 0.25) * gO * 1.1 * iHRC); r += HRC * sat((ohHR.hp + ohAR.hp * 0.25) * gO * 1.1 * iHRC);
          // the room pair: direct, reflections, tail; mono under MONO Hz (the side high-passed, the middle as it was)
          if (roomOn) {
            rm.tick(ml, mr);
            rmHL.tick(ml + rm.l); rmLL.tick(rmHL.hp); rmHR.tick(mr + rm.r); rmLR.tick(rmHR.hp);
            const ql = rmLL.lp * gM * 0.9, qr = rmLR.lp * gM * 0.9, qm = (ql + qr) * 0.5;
            rsA.tick((ql - qr) * 0.5); rsB.tick(rsA.hp);
            l += qm + rsB.hp; r += qm - rsB.hp;
          }
          // the crushed mono room
          if (crushOn) {
            crH.tick(cx); const x = crH.hp, ax = x < 0 ? -x : x;
            // a brick wall: the gain follows every peak at once and lets go over 70 ms, so the room swells up between hits
            crE1 = ax > crE1 ? ax : crE1 * crRel;
            gate += ((crE1 > gateT ? 1 : 0) - gate) * (crE1 > gateT ? gateA : gateR);
            const y = sat(x * CRT / (crE1 > CRT ? crE1 : CRT) * 14) * gate;
            crL.tick(y);
            l += crL.lp * gX * 2.6; r += crL.lp * gX * 2.6;
          }
          // the view: the audience's side is the drummer's mirrored (every mic is symmetric about the kit's centre)
          const L2 = l + (r - l) * swap, R2 = r + (l - r) * swap;
          // the limiter: the lowest gain any sample in the window wants, eased in over the window, released over 40 ms
          // the detector: the sample TT back and the three points after it (only near the ceiling, where it matters)
          const ol2 = L2 * OUT, or3 = R2 * OUT;
          ringL[ti] = ol2; ringR[ti] = or3;
          const cI = (ti - TT) & 31, cL = ringL[cI], cR2 = ringR[cI], nL = ringL[(cI + 1) & 31], nR = ringR[(cI + 1) & 31];
          let pk = Math.max(cL < 0 ? -cL : cL, cR2 < 0 ? -cR2 : cR2);
          if (2 * Math.max(pk, nL < 0 ? -nL : nL, nR < 0 ? -nR : nR) > THR) {
            for (let r3 = 0; r3 < 3; r3++) {
              const row = TPR[r3]; let sl = 0, sr3 = 0;
              for (let j = 0; j < 16; j++) { const k = (cI - TT + 1 + j) & 31; sl += ringL[k] * row[j]; sr3 += ringR[k] * row[j]; }
              const a1 = sl < 0 ? -sl : sl, a2 = sr3 < 0 ? -sr3 : sr3; if (a1 > pk) pk = a1; if (a2 > pk) pk = a2;
            }
          }
          ti = (ti + 1) & 31;
          const gt = pk > THR ? THR / pk : 1;
          while (dqT > dqH && dqV[(dqT - 1) & LM] >= gt) dqT--;
          dqV[dqT & LM] = gt; dqI[dqT & LM] = nAbs; dqT++;
          while (dqI[dqH & LM] <= nAbs - boxN) dqH++;
          const h = dqV[dqH & LM];
          lw = (lw + 1) & LM;
          hsum += h - hb[(lw - boxN) & LM]; hb[lw] = h;
          const gb = hsum / boxN;
          gLim = gb < gLim ? gb : gLim + (gb - gLim) * (1 - limRel);
          dlL[lw] = ol2; dlR[lw] = or3;
          const j2 = (lw - LA - TT) & LM;
          const yl = ceil(dlL[j2] * gLim), yr = ceil(dlR[j2] * gLim);
          L[i] = yl; R[i] = yr;
          const al3 = yl < 0 ? -yl : yl, ar3 = yr < 0 ? -yr : yr; if (al3 > opk) opk = al3; if (ar3 > opk) opk = ar3;
          nAbs++;
        }
        wp = (wp + n) & RM;
        // the buses' tails: stop running the room and the crush once they have died away (and their faders are down)
        if (roomOn && tM === 0 && gM < 1e-5) { roomOn = false; rm.clear(); rsA.reset(); rsB.reset(); }
        if (crushOn && tX === 0 && gX < 1e-5) crushOn = false;
        quiet = !any && opk < 1e-6 ? quiet + n : 0;
        F0 += n;
      },
    };
  },
};
`.replace('__NOTES__', NOTES_SRC).replace('__POS__', src(PIECES.map((k) => LAYOUT.pieces[k])))
    .replace('__OHL__', src(LAYOUT.overheads[0])).replace('__OHR__', src(LAYOUT.overheads[1]))
    .replace('__RML__', src(LAYOUT.room[0])).replace('__RMR__', src(LAYOUT.room[1])).replace('__RMAIM__', src(LAYOUT.roomAim))
    .replace('__CRM__', src(LAYOUT.crush))),
});
