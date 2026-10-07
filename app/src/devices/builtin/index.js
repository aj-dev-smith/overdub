// Overdub's built-in kernel devices. Importing this module registers every one of them (ids are forever; the display
// names are studio objects: the things on the desk and in the live room).
//   instruments: core.poly (Patch Bay), core.bass (Capstan), core.keys (Lamp Tines), core.pluck (Pinch Roller),
//                core.drums (Gobo Kit), core.pad (Room Tone), core.piano (Baby Grand), core.organ (Rotor Cabinet),
//                core.strings (Music Stands), core.bassguitar (Flatwound), core.guitar (DI Box), core.ep (Suitcase),
//                core.mallets (Mallet Bag), core.poly2 (Step Ladder), core.brass (Brass Rail), core.choir (Risers),
//                core.drumroom (Studio A), core.wavetable (Light Table)
//   sampled:     core.drumkit (Virtuosity Kit), core.upright (Parlour Upright): instruments that play recorded samples
//                (kernel data, fetched by tools/fetch-kits.js; without them they play nothing). Not in INSTRUMENTS, whose
//                every member is synthesized and checked as such everywhere; tools/drumkit-test.js and
//                tools/sampler-test.js hold them to the same bar
//   effects:     core.eq (Top Shelf), core.comp (Squeeze Box), core.verb (Stairwell), core.delay (Echo Reel),
//                core.chorus (Double Track), core.filter (Keyhole), core.drive (Hot Print), core.crush (Chewed Tape),
//                core.width (Gatefold), core.limiter (Red Line), core.eq8 (Slide Rule), core.shaper (Scribble Strip),
//                core.multiband (Gaffer Tape)
// Levels are measured by tools/sounds-test.js: instruments land around -16 LUFS on the test phrase, effects within
// about a decibel of bypass at their defaults, every true peak at or under -1 dBTP.
import poly from './poly.js';
import bass from './bass.js';
import keys from './keys.js';
import pluck from './pluck.js';
import drums from './drums.js';
import pad from './pad.js';
import piano from './piano.js';
import organ from './organ.js';
import strings from './strings.js';
import bassguitar from './bassguitar.js';
import guitar from './guitar.js';
import ep from './ep.js';
import mallets from './mallets.js';
import poly2 from './poly2.js';
import brass from './brass.js';
import choir from './choir.js';
import drumroom from './drumroom.js';
import wavetable from './wavetable.js';
import drumkit from './drumkit.js';
import upright from './upright.js';
import eq from './eq.js';
import comp from './comp.js';
import verb from './verb.js';
import delay from './delay.js';
import chorus from './chorus.js';
import filter from './filter.js';
import drive from './drive.js';
import crush from './crush.js';
import width from './width.js';
import limiter from './limiter.js';
import eq8 from './eq8.js';
import shaper from './shaper.js';
import multiband from './multiband.js';

export const INSTRUMENTS = [poly, bass, keys, pluck, drums, pad, piano, organ, strings, bassguitar, guitar, ep, mallets, poly2, brass, choir, drumroom, wavetable];
export const EFFECTS = [eq, comp, verb, delay, chorus, filter, drive, crush, width, limiter, eq8, shaper, multiband];
export const SAMPLED = [drumkit, upright];
export const BUILTINS = [...INSTRUMENTS, ...SAMPLED, ...EFFECTS];
export default BUILTINS;
