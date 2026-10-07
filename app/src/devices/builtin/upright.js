// core.upright: Parlour Upright. The studio's first sampled melodic instrument: a Kawai upright in a living room
// (FreePats' Upright Piano KW, CC0), played from samples across the keyboard by the sampled-instrument kernel
// (sampler.js). docs/DEVICES.md "Melodic kits" is how; tools/fetch-kits.js builds the kit (tools/kits/upright-kw.js
// pins every upstream file); docs/SOUNDS.md is its licence record.
//
// What it plays. 66 stereo samples: two velocity layers (soft up to 80, hard from 81, crossfaded across the seam),
// a zone every two or three keys from A0 to C8, the bass with the source's own sustain loops, three soft zones
// through the source's low pass. The level follows the velocity along the SFZ's curve (40 log10(vel / 127)), scaled
// by DYNAMICS; the sustain pedal is the host's. Params: DYNAMICS, RELEASE (the dampers: seconds to -60 dB once the
// key and the pedal are up), TUNE (cents), TONE (a tilt around 900 Hz) and LEVEL.
// A missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const UPRIGHT_HASH = 'sha256-cc1e7ab496aafa7f73b44b45fa0f9bdb96015c6b3ca2ff1fe29d6565a17ece86';

export default defineDevice({
  id: 'core.upright', name: 'Parlour Upright', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'A real upright piano in a living room, sampled',
  nod: 'Upright Piano KW (FreePats, CC0): a Kawai upright, two velocity layers across the keyboard',
  data: { kit: UPRIGHT_HASH },
  params: samplerParams({ release: 0.6 }),
  presets: [
    { name: 'Parlour', params: {}, blurb: 'the piano as recorded, from the player\'s seat' },
    { name: 'Even', params: { dynamics: 55 }, blurb: 'soft and hard notes closer together, for a busy mix' },
    { name: 'Felt', params: { tone: -70, dynamics: 80, release: 0.9 }, blurb: 'darker and rounder, the dampers slower' },
    { name: 'Bright', params: { tone: 45 }, blurb: 'tilted up, to cut through' },
    { name: 'Staccato', params: { release: 0.12 }, blurb: 'the dampers drop at once' },
    { name: 'Old tuning', params: { tune: -32 }, blurb: 'a third of a semitone flat, near A = 432' },
  ],
  look: { color: '#4a2f24', ink: '#f1e6d2', shape: 'wide', finish: 'wood', knob: 'cream', label: 'script', led: '#ffcf7a' },
  tail: 6,
  kernel: samplerKernel({ makeup: 0.7, poly: 32, xfade: 6, law: 'aligned' }),
});
