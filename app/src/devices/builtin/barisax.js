// @ts-check
// core.barisax: Bell Up. A baritone saxophone, sampled: Karoryfer's Bear Sax (CC0), a 1926 Conn, sustained notes,
// played by the sampled-instrument kernel (sampler.js). docs/DEVICES.md "Melodic kits" is how; tools/fetch-kits.js
// builds the kit (tools/kits/karoryfer-barisax.js pins every upstream file, and says why Bear Sax over Weresax);
// docs/SOUNDS.md is its licence record.
//
// What it plays. 22 mono samples at 44.1 kHz: 11 zones from Db2 to G4, every third semitone, a soft and a loud take of
// each, crossfaded across the middle of the velocity range, every note looped on the loop Karoryfer made, so it holds
// for as long as the key does. The level follows the velocity along a curve set from the takes' recorded distance,
// scaled by DYNAMICS. Params: DYNAMICS, RELEASE (the breath stopping: seconds to -60 dB), TUNE (cents), TONE (a tilt
// around 900 Hz) and LEVEL. A missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const BARISAX_HASH = 'sha256-8821720c6600ccce800a666bbc8dded6196a4f2e2235f66313abc9364a6f157e';

export default defineDevice({
  id: 'core.barisax', name: 'Bell Up', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'A real baritone sax, sampled, held notes',
  nod: 'Bear Sax (Karoryfer Samples, CC0): a 1926 Conn baritone, soft and loud takes, looped as Karoryfer looped them',
  data: { kit: BARISAX_HASH },
  params: samplerParams({ release: 0.18 }),
  presets: [
    { name: 'Bari', params: {}, blurb: 'the sax as recorded, close and dry' },
    { name: 'Subtone', params: { dynamics: 60, tone: -45 }, blurb: 'softer and breathier, the edge rolled off' },
    { name: 'Honk', params: { tone: 45 }, blurb: 'brighter, the reed forward, to cut through a band' },
    { name: 'Stabs', params: { release: 0.06 }, blurb: 'notes stop the moment the key lifts, for horn hits' },
    { name: 'Long breath', params: { release: 0.8 }, blurb: 'every note left to fall away' },
  ],
  look: { color: '#8a6a22', ink: '#1c160a', shape: 'wide', finish: 'brushed', knob: 'black', label: 'script', led: '#ffcf5a' },
  tail: 2,
  kernel: samplerKernel({ makeup: 1.25, poly: 16, xfade: 16, law: 'aligned' }),
});
