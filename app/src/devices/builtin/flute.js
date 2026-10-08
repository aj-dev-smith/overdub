// core.flute: Head Joint. A flute, sampled: Versilian's VS Chamber Orchestra 2 Community Edition (CC0), the solo flute's
// sustained notes with vibrato, played by the sampled-instrument kernel (sampler.js). docs/DEVICES.md "Melodic kits" is
// how; tools/fetch-kits.js builds the kit (tools/kits/vsco-flute.js pins every upstream file, and says why the vibrato
// sustains); docs/SOUNDS.md is its licence record.
//
// What it plays. 10 stereo samples at 44.1 kHz: every note VSCO recorded, C4 to C7, a third apart, one dynamic, every
// note looped where it has settled, so it holds for as long as the key does. The level follows the velocity along a
// curve, scaled by DYNAMICS. Params: DYNAMICS, RELEASE (the breath stopping: seconds to -60 dB), TUNE (cents), TONE (a
// tilt around 900 Hz) and LEVEL. A missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const FLUTE_HASH = 'sha256-e0b2d47de416f715f3793a0f90b64a832d26d5988bcfbfac2afacaa3588718ec';

export default defineDevice({
  id: 'core.flute', name: 'Head Joint', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'A real flute, sampled, with vibrato',
  nod: 'VS Chamber Orchestra 2 CE (Versilian Studios, CC0): the solo flute, sustained with vibrato, looped',
  data: { kit: FLUTE_HASH },
  params: samplerParams({ release: 0.25 }),
  presets: [
    { name: 'Flute', params: {}, blurb: 'the flute as recorded, in its room' },
    { name: 'Breathy', params: { dynamics: 60, tone: -35 }, blurb: 'softer and darker, for under a vocal' },
    { name: 'Airy', params: { tone: 40 }, blurb: 'tilted up, the breath forward' },
    { name: 'Staccato', params: { release: 0.07 }, blurb: 'the breath stops the moment the key lifts' },
    { name: 'Hall', params: { release: 1.2 }, blurb: 'every note left to fall away' },
  ],
  look: { color: '#c9ccd2', ink: '#1d2027', shape: 'wide', finish: 'brushed', knob: 'chrome', label: 'script', led: '#7aa7ff' },
  tail: 2,
  kernel: samplerKernel({ makeup: 1.6, poly: 16, xfade: 0, law: 'power' }),
});
