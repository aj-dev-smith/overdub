// @ts-check
// core.ensemble: Rosin. A string section, sampled: Versilian's VS Chamber Orchestra 2 Community Edition (CC0), its
// contrabass, cello, viola and violin sections bowing sustained notes with vibrato, one section per register as an
// ensemble patch splits them, played by the sampled-instrument kernel (sampler.js). docs/DEVICES.md "Melodic kits" is
// how; tools/fetch-kits.js builds the kit (tools/kits/vsco-strings.js pins every upstream file); docs/SOUNDS.md is its
// licence record.
//
// What it plays. 30 stereo samples at 44.1 kHz: 15 zones (the contrabass to A1, the cellos to E3, the violas to E4,
// the violins above), two dynamics each, crossfaded across velocity 72/73, every note looped where it has settled,
// so it holds for as long as the key does. The level follows the velocity along a curve set from the two layers'
// recorded distance, scaled by DYNAMICS. Params: DYNAMICS, RELEASE (the bow leaving the string: seconds to -60 dB),
// TUNE (cents), TONE (a tilt around 900 Hz) and LEVEL. A missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const ENSEMBLE_HASH = 'sha256-2eb3cfbd8fd7aca225201abc1b20eeb0d830029037d92ac5318941d05472a39b';

export default defineDevice({
  id: 'core.ensemble', name: 'Rosin', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'A real string section, sampled, bows on the string',
  nod: 'VS Chamber Orchestra 2 CE (Versilian Studios, CC0): bass, cellos, violas and violins, sustained with vibrato',
  data: { kit: ENSEMBLE_HASH },
  params: samplerParams({ release: 0.4 }),
  presets: [
    { name: 'Section', params: {}, blurb: 'the sections as recorded, a bow on every note' },
    { name: 'Soft bows', params: { dynamics: 60, tone: -30 }, blurb: 'quieter and darker, for under a vocal' },
    { name: 'Long hall', params: { release: 1.6 }, blurb: 'every note left to ring out after the bow lifts' },
    { name: 'Short bows', params: { release: 0.15 }, blurb: 'the bow lifts at once, for stabs' },
    { name: 'Bright', params: { tone: 35 }, blurb: 'tilted up, the rosin forward' },
  ],
  look: { color: '#7a3d17', ink: '#f6e7cf', shape: 'wide', finish: 'wood', knob: 'cream', label: 'script', led: '#ffb347' },
  tail: 4,
  kernel: samplerKernel({ makeup: 1.3, poly: 32, xfade: 8, law: 'power' }),
});
