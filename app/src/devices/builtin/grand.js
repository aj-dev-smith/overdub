// core.grand: Full Stick. A concert grand, sampled: Alexander Holm's Salamander Grand Piano V3 (public domain since
// 2022; he is credited anyway), played across the keyboard by the sampled-instrument kernel (sampler.js), the lid on
// the full stick. docs/DEVICES.md "Melodic kits" is how; tools/fetch-kits.js builds the kit (tools/kits/salamander.js
// pins every upstream file and says what was cut to fit 15 MB); docs/SOUNDS.md is its licence record.
//
// What it plays. 90 stereo samples at 48 kHz: three velocity layers (soft to 58, middle to 100, hard above, crossfaded
// across each seam) at every minor third from A0 to C8, tuned by the source's own Retuned set, and the dampers'
// release noise at the same keys. The layers keep their recorded levels; on top, the velocity follows the source's
// curve (amp_veltrack 73%), scaled by DYNAMICS. Each note is cut at 2.6 to 4.6 s by register (the budget), so a long
// held chord dies a little early. Params: DYNAMICS, RELEASE (the dampers: seconds to -60 dB once the key and the
// pedal are up), TUNE (cents), TONE (a tilt around 900 Hz) and LEVEL. A missing kit plays nothing, and the studio
// says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const GRAND_HASH = 'sha256-15cab44d14055d312f55e04bee8f54ca1cc99d6bc8e78ba9f1c1cb34a73eb58e';

export default defineDevice({
  id: 'core.grand', name: 'Full Stick', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'A real concert grand, sampled, the lid wide open',
  nod: 'Salamander Grand Piano V3 (Alexander Holm, public domain): a six-foot-seven grand, three velocity layers',
  data: { kit: GRAND_HASH },
  params: samplerParams({ release: 0.5 }),
  presets: [
    { name: 'Full stick', params: {}, blurb: 'the grand as recorded, two mics over the strings' },
    { name: 'Even', params: { dynamics: 55 }, blurb: 'soft and hard notes closer together, for a busy mix' },
    { name: 'Half stick', params: { tone: -45, dynamics: 85 }, blurb: 'the lid lower: darker, a little rounder' },
    { name: 'Bright', params: { tone: 40 }, blurb: 'tilted up, to cut through a band' },
    { name: 'Staccato', params: { release: 0.1 }, blurb: 'the dampers drop at once' },
    { name: 'Wide dynamics', params: { dynamics: 140 }, blurb: 'soft notes softer still, for a solo' },
  ],
  look: { color: '#141414', ink: '#efe9dc', shape: 'wide', finish: 'flat', knob: 'chrome', label: 'script', led: '#f4f1e8' },
  tail: 6,
  kernel: samplerKernel({ makeup: 0.9, poly: 32, xfade: 6, law: 'aligned' }),
});
