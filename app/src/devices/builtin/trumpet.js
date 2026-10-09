// @ts-check
// core.trumpet: Spit Valve. A trumpet, sampled: Versilian's VS Chamber Orchestra 2 Community Edition (CC0), the solo
// trumpet's straight sustained notes, played by the sampled-instrument kernel (sampler.js). Brass Rail (core.brass) is
// the synthesized section. docs/DEVICES.md "Melodic kits" is how; tools/fetch-kits.js builds the kit
// (tools/kits/vsco-trumpet.js pins every upstream file, and says why the trumpet over the horn); docs/SOUNDS.md is its
// licence record.
//
// What it plays. 20 stereo samples at 44.1 kHz: every note VSCO recorded, F3 to C6, about a minor third apart, its
// softest and loudest dynamics crossfaded across velocity 72/73, every note looped where it has settled, so it holds
// for as long as the key does. The level follows the velocity along a curve set from the two dynamics' recorded
// distance, scaled by DYNAMICS. Params: DYNAMICS, RELEASE (the breath stopping: seconds to -60 dB), TUNE (cents), TONE
// (a tilt around 900 Hz) and LEVEL. A missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const TRUMPET_HASH = 'sha256-3b61055341a0939a835c2ee27c751c7cedb275147923da73ad03aca91e2100b4';

export default defineDevice({
  id: 'core.trumpet', name: 'Spit Valve', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'A real trumpet, sampled, a straight tone',
  nod: 'VS Chamber Orchestra 2 CE (Versilian Studios, CC0): the solo trumpet, sustained, soft and loud, looped',
  data: { kit: TRUMPET_HASH },
  params: samplerParams({ release: 0.2 }),
  presets: [
    { name: 'Open', params: {}, blurb: 'the trumpet as recorded, in its room' },
    { name: 'Flugel', params: { dynamics: 60, tone: -50 }, blurb: 'softer and darker, nearer a flugelhorn' },
    { name: 'Bright', params: { tone: 40 }, blurb: 'tilted up, the bell pointed at you' },
    { name: 'Stabs', params: { release: 0.06 }, blurb: 'notes stop the moment the key lifts, for horn hits' },
    { name: 'Hall', params: { release: 1.2 }, blurb: 'every note left to fall away' },
  ],
  look: { color: '#c8973a', ink: '#1c160a', shape: 'wide', finish: 'gloss', knob: 'gold', label: 'block', led: '#ff7a3d' },
  tail: 2,
  kernel: samplerKernel({ makeup: 0.75, poly: 16, xfade: 8, law: 'power' }),
});
