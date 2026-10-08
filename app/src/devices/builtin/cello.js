// @ts-check
// core.cello: Endpin. A solo cello, sampled: Karoryfer x bigcat cello (CC0), Kamila Borowiak bowing sustained notes,
// played by the sampled-instrument kernel (sampler.js). Rosin (core.ensemble) is a section; this is one player.
// docs/DEVICES.md "Melodic kits" is how; tools/fetch-kits.js builds the kit (tools/kits/karoryfer-cello.js pins every
// upstream file); docs/SOUNDS.md is its licence record.
//
// What it plays. 32 mono samples at 44.1 kHz: 16 zones from the open C string (C2) to A5, a minor third apart, two
// dynamics (mp and f) crossfaded across velocity 80/81, every note looped on the loop Karoryfer made, so it holds for
// as long as the key does. The bow is straight, as recorded: no vibrato. The level follows the velocity along a curve
// set from the two dynamics' recorded distance, scaled by DYNAMICS. Params: DYNAMICS, RELEASE (the bow leaving the
// string: seconds to -60 dB), TUNE (cents), TONE (a tilt around 900 Hz) and LEVEL. A missing kit plays nothing, and the
// studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const CELLO_HASH = 'sha256-144ed798636d54cb0c61829ba27cf800f860b51b66b584c07cd5459045e161ad';

export default defineDevice({
  id: 'core.cello', name: 'Endpin', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'A real solo cello, sampled, a straight bow',
  nod: 'Karoryfer x bigcat cello (Karoryfer Samples, CC0): Kamila Borowiak, bowed, two dynamics, looped as Karoryfer looped them',
  data: { kit: CELLO_HASH },
  params: samplerParams({ release: 0.3 }),
  presets: [
    { name: 'Bowed', params: {}, blurb: 'the cello as recorded, close and dry' },
    { name: 'Sul tasto', params: { dynamics: 60, tone: -40 }, blurb: 'quieter and darker, the bow over the fingerboard' },
    { name: 'Long bow', params: { release: 1.4 }, blurb: 'every note left to ring after the bow lifts' },
    { name: 'Short bows', params: { release: 0.1 }, blurb: 'the bow lifts at once' },
    { name: 'Bright', params: { tone: 35 }, blurb: 'tilted up, the rosin forward' },
  ],
  look: { color: '#5a2c14', ink: '#f3e2c4', shape: 'wide', finish: 'wood', knob: 'cream', label: 'script', led: '#ffb347' },
  tail: 3,
  kernel: samplerKernel({ makeup: 1, poly: 16, xfade: 8, law: 'power' }),
});
