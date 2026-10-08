// core.vibes: Damper Bar. A vibraphone, sampled: the Versilian Community Sample Library's (CC0), every bar it
// recorded, the motor off, played by the sampled-instrument kernel (sampler.js). docs/DEVICES.md "Melodic kits" is how;
// tools/fetch-kits.js builds the kit (tools/kits/vcsl-vibes.js pins every upstream file, and says why the vibraphone
// over VCSL's marimba and harp); docs/SOUNDS.md is its licence record.
//
// What it plays. 44 stereo samples at 44.1 kHz: 11 bars from F3 to E6 (a third apart), four velocity layers: soft
// mallets below 64, hard mallets above, two strokes each, lined up and crossfaded across each seam. The level follows
// a velocity curve set from the layers' recorded levels, scaled by DYNAMICS. Each note rings up to 6 s. Params:
// DYNAMICS, RELEASE (the damper bar: seconds to -60 dB once the key, and the pedal, are up), TUNE (cents), TONE (a tilt
// around 900 Hz) and LEVEL. A missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const VIBES_HASH = 'sha256-e41ad6c162933d1dcc259cd6b3a6e3ca5c7567dd2a38cc96fd60cc1d0207f751';

export default defineDevice({
  id: 'core.vibes', name: 'Damper Bar', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'A real vibraphone, sampled, soft and hard mallets',
  nod: 'VCSL Vibraphone (Versilian Studios, CC0): eleven bars, the motor off, soft mallets for soft notes and hard for hard',
  data: { kit: VIBES_HASH },
  params: samplerParams({ release: 1 }),
  presets: [
    { name: 'Bars', params: {}, blurb: 'the vibraphone as recorded, the damper half lifted' },
    { name: 'Pedal down', params: { release: 6 }, blurb: 'every bar left to ring' },
    { name: 'Dampened', params: { release: 0.15 }, blurb: 'the damper bar drops at once' },
    { name: 'Soft mallets', params: { dynamics: 50, tone: -40 }, blurb: 'quieter and rounder, the yarn forward' },
    { name: 'Bright', params: { tone: 40 }, blurb: 'tilted up, the bars ringing over a band' },
  ],
  look: { color: '#3d4a52', ink: '#eef3f5', shape: 'wide', finish: 'brushed', knob: 'chrome', label: 'block', led: '#9fe7ff' },
  tail: 6,
  kernel: samplerKernel({ makeup: 1.1, poly: 32, xfade: 6, law: 'aligned' }),
});
