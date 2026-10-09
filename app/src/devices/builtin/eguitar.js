// @ts-check
// core.eguitar: Hollow Body. An electric guitar, sampled: Karoryfer's Black And Green Guitars (CC0), the green Gretsch
// Anniversary hollow body, picked, recorded dry, played by the sampled-instrument kernel (sampler.js). DI Box
// (core.guitar) is the synthesized one. docs/DEVICES.md "Melodic kits" is how; tools/fetch-kits.js builds the kit
// (tools/kits/karoryfer-guitar.js pins every upstream file, and says why this guitar over Emilyguitar and the black
// Hofner); docs/SOUNDS.md is its licence record.
//
// What it plays. 96 mono samples at 44.1 kHz: 16 zones from the open low E (E2) to C#6, every third semitone, three
// dynamics (crossfaded across each seam) of two picks each, so a repeated note never plays the same pick twice running.
// The level follows a velocity curve set from the dynamics' recorded levels, scaled by DYNAMICS; each note rings up to
// 3.4 s. Params: DYNAMICS, RELEASE (the fretting hand letting go: seconds to -60 dB), TUNE (cents), TONE (a tilt
// around 900 Hz) and LEVEL. It plays dry, as recorded: put an amp from the Guitar Studio after it for the room. A
// missing kit plays nothing, and the studio says so.
import { defineDevice } from '../registry.js';
import { samplerKernel, samplerParams } from './sampler.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const EGUITAR_HASH = 'sha256-bd0513cef14ffd4f2b32584973417dbb571e49b91eadd289549f1ffdb373f2d7';

export default defineDevice({
  id: 'core.eguitar', name: 'Hollow Body', kind: 'instrument', cat: 'pluck', by: 'overdub',
  blurb: 'A real hollow-body electric guitar, sampled, picked',
  nod: 'Black And Green Guitars (Karoryfer Samples, CC0): the green Gretsch, three dynamics, two picks each',
  data: { kit: EGUITAR_HASH },
  params: samplerParams({ release: 0.15 }),
  presets: [
    { name: 'Picked', params: {}, blurb: 'the guitar as recorded, straight from the pickups' },
    { name: 'Jazz neck', params: { tone: -45, dynamics: 70 }, blurb: 'darker and rounder, the tone knob rolled back' },
    { name: 'Even', params: { dynamics: 45 }, blurb: 'every note close to the same level, as a compressor would' },
    { name: 'Twang', params: { tone: 40 }, blurb: 'more string and pick, to cut through' },
    { name: 'Let ring', params: { release: 1.2 }, blurb: 'notes ring on after the hand lets go' },
  ],
  look: { color: '#2f6b4a', ink: '#f2ead8', shape: 'wide', finish: 'gloss', knob: 'gold', label: 'script', led: '#ffcf5a' },
  tail: 4,
  kernel: samplerKernel({ makeup: 2.0, poly: 16, xfade: 10, law: 'aligned' }),
});
