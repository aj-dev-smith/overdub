// core.ebass: Roundwound. An electric bass, sampled: Karoryfer's Black And Blue Basses (CC0), the "dark black"
// five-string played with the fingers, recorded dry, played by the sampled-instrument kernel (sampler.js). Flatwound
// (core.bassguitar) is the synthesized one. docs/DEVICES.md "Melodic kits" is how; tools/fetch-kits.js builds the kit
// (tools/kits/karoryfer-bass.js pins every upstream file); docs/SOUNDS.md is its licence record.
//
// What it plays. 112 mono samples at 44.1 kHz: 14 zones from the low B (B0) to D4, every third semitone, four
// dynamics (crossfaded across each seam) of two round robins each, so a repeated note never plays the same pluck twice
// running. The level follows a velocity curve set from the dynamics' recorded levels, scaled by DYNAMICS; each note
// rings up to 3.4 s. Params: DYNAMICS, RELEASE (the fretting hand letting go: seconds to -60 dB), TUNE (cents), TONE
// (a tilt around 900 Hz) and LEVEL. A missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const EBASS_HASH = 'sha256-9ecd56b866304181640c5cb0bd12a1ab88057a107bbaf2143ca46fd867a09e10';

export default defineDevice({
  id: 'core.ebass', name: 'Roundwound', kind: 'instrument', cat: 'bass', by: 'overdub',
  blurb: 'A real five-string bass, sampled, played with the fingers',
  nod: 'Black And Blue Basses (Karoryfer Samples, CC0): the dark black five-string, four dynamics, two plucks each',
  data: { kit: EBASS_HASH },
  params: samplerParams({ release: 0.12 }),
  presets: [
    { name: 'Fingers', params: {}, blurb: 'the bass as recorded, straight from the instrument' },
    { name: 'Even', params: { dynamics: 50 }, blurb: 'every note close to the same level, as a compressor would' },
    { name: 'Thumb', params: { tone: -50 }, blurb: 'darker and rounder, the top rolled off' },
    { name: 'Bright', params: { tone: 45 }, blurb: 'more string, to cut through' },
    { name: 'Held', params: { release: 0.6 }, blurb: 'notes ring a little after the hand lets go' },
  ],
  look: { color: '#1d1f24', ink: '#d8dde6', shape: 'wide', finish: 'flat', knob: 'black', label: 'block', led: '#7aa7ff' },
  tail: 4,
  kernel: samplerKernel({ makeup: 0.68, poly: 16, xfade: 6, law: 'aligned' }),
});
