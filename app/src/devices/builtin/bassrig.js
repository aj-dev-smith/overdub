// core.bassrig: Y Cable. The modern metal bass sound: a clean, compressed low end under a distorted top (intent 0008,
// spec R31-R32). The input is split at XOVER by a 4th-order Linkwitz-Riley crossover, whose two halves sum flat:
//   low    mono and clean, through a light fixed compressor (2:1 above -18 dBFS, 20 ms attack, 200 ms release),
//          delayed to line up with the top; LOW sets its level
//   top    Half Stack's oversampled preamp, tone stack and power amp (amp-lib.js) with its own DRIVE, MID and TREBLE,
//          then a guitar cab (as producers put a bass top through one: Modern 4x12, close dynamic by default); HIGH
//          sets its level. At DRIVE 0 the top is clean and uncabbed, so the two halves sum back to the input; the amp
//          fades in over DRIVE's first step
// Below XOVER the output is mono by construction: one signal on both sides. Latency: Half Stack's 28 samples, the low
// half and the clean top delayed to match.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { AMP_LIB, CAB_LIB, CABS_HASH, CAB_LABELS, CAB_NAMES, CAB_SAYS } from './amp-lib.js';

// the distorted top's trim (dB): the defaults land within a decibel of bypass on the house's bass DI (tools/bassrig-test.js)
export const BASSRIG_TRIM = -14;
const LAT = 28;

export default defineDevice({
  id: 'core.bassrig', name: 'Y Cable', kind: 'effect', cat: 'amp', by: 'overdub',
  blurb: 'Bass split in two: a clean low end, a driven top',
  nod: 'a split bass rig: a clean low path under a high-gain top through a guitar cab',
  params: [
    { key: 'xover', label: 'XOVER', min: 80, max: 400, def: 200, curve: 'log', unit: 'Hz', role: 'tone', desc: 'where the clean low end hands over to the driven top: lower for more grind, higher for a cleaner, rounder bass' },
    { key: 'low', label: 'LOW', min: -24, max: 6, def: 1, unit: 'dB', role: 'level', desc: 'the clean low end\'s level (mono, compressed)' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 10, def: 5, role: 'drive', desc: 'the top\'s gain: 0 clean, 3 growl, 5 modern metal, 8 and up fuzz' },
    { key: 'mid', label: 'MID', min: 0, max: 10, def: 6, role: 'tone', desc: 'the top\'s mids: up to cut through the guitars' },
    { key: 'treble', label: 'TREBLE', min: 0, max: 10, def: 5, role: 'tone', desc: 'the top\'s treble: the string clank and the pick' },
    { key: 'cab', label: 'CAB', opts: CAB_LABELS, def: 0, role: 'shape', desc: `the top's cab: ${CAB_NAMES.slice(0, 6).join('; ')}; Filter 4x12; OFF (the amp's line out)` },
    { key: 'high', label: 'HIGH', min: -24, max: 6, def: -3, unit: 'dB', role: 'level', desc: 'the driven top\'s level against the low end' },
    { key: 'level', label: 'LEVEL', min: -24, max: 12, def: 0, unit: 'dB', role: 'level', desc: 'the output level, both halves together' },
  ],
  presets: [
    { name: 'Modern', blurb: 'a clean low end under a growling top at 200 Hz: the modern metal bass', params: { xover: 200, low: 1, drive: 5, mid: 6, treble: 5, cab: 0, high: -3 } },
    { name: 'Grind', blurb: 'more drive and a lower split: the top snarls over the guitars', params: { xover: 140, low: -1, drive: 7.5, mid: 7, treble: 6, cab: 1, high: -1 } },
    { name: 'Clean', blurb: 'no drive: the split only compresses the low end', params: { xover: 250, low: 1, drive: 0, mid: 5, treble: 5, cab: 7, high: 0 } },
  ],
  look: { color: '#22303a', ink: '#e6eef2', shape: 'box', finish: 'tolex', knob: 'chrome', label: 'block', led: '#4fc3f7' },
  data: { cabs: CABS_HASH }, dataSays: CAB_SAYS,
  latency: LAT / 48000, tail: 0.1,
  kernel: kernel(String.raw`
${AMP_LIB}
${CAB_LIB}
const TRIM = ${BASSRIG_TRIM}, LAT = ${LAT};
return {
  create({ sr, dsp, data }) {
    // the crossover: two Butterworth sections each way (Linkwitz-Riley 24 dB/oct, in phase, summing flat)
    const l1 = svf(sr), l2 = svf(sr), h1 = svf(sr), h2 = svf(sr);
    const os = dsp.oversample4x(), top = chain(sr * 4, sr), cab = makeCab(sr, dsp, data && data.cabs);
    const run = (u) => top.tick(u);
    // the top's settings for the shared chain: no boost, the guitar amp's middle settings but for DRIVE, MID, TREBLE
    const T = { boost: 0, boost_drive: 0, boost_level: 9, gain: 0, bass: 5, mid: 6, treble: 5, master: 4, sag: 0.2, presence: 5, depth: 5 };
    const dLow = delayLine(LAT + 4), dTop = delayLine(LAT + 4);
    // the low half's compressor: 2:1 over -18 dBFS, 20 ms attack, 200 ms release (its gain worked out every 16 samples;
    // no makeup, so below the threshold the two halves still sum to the input)
    const cA = 1 - Math.exp(-1 / (0.020 * sr)), cR = 1 - Math.exp(-1 / (0.200 * sr)), THR = dbg(-18);
    let env = 0, cg = 1;
    const lo = glide(30, sr, 1), hi = glide(30, sr, 1), wet = glide(20, sr, 1), lv = glide(30, sr, 1);
    let bufA = new Float64Array(128), bufB = new Float64Array(128), bufL = new Float64Array(128);
    return {
      latency: LAT,
      process(L, R, n, P) {
        l1.set(P.xover, 0.7071); l2.set(P.xover, 0.7071); h1.set(P.xover, 0.7071); h2.set(P.xover, 0.7071);
        T.gain = P.drive; T.mid = P.mid; T.treble = P.treble;
        top.set(T);
        cab.set(P.cab);
        // the amp fades in over DRIVE's first step (0: the top is clean and uncabbed)
        const w = clamp(P.drive, 0, 1);
        if (bufA.length < n) { bufA = new Float64Array(n); bufB = new Float64Array(n); bufL = new Float64Array(n); }
        for (let i = 0; i < n; i++) {
          const x = 0.5 * (L[i] + R[i]);
          l1.tick(x); const low = l2.tick(l1.lp);
          h1.tick(x); h2.tick(h1.hp); const high = h2.hp;
          // the low half: compressed, delayed into line
          const a = low < 0 ? -low : low;
          env += (a > env ? cA : cR) * (a - env);
          if ((i & 15) === 0) cg = env > THR ? Math.sqrt(THR / env) : 1;
          dLow.write(low * cg); bufL[i] = dLow.tap(LAT);
          // the top: clean (delayed), and through the amp
          dTop.write(high); bufB[i] = dTop.tap(LAT);
          bufA[i] = top.post(os.process(high, run));
        }
        cab.process(bufA, n);
        const tg = dbg(TRIM), gl = dbg(P.low), gh = dbg(P.high), go = dbg(P.level);
        for (let i = 0; i < n; i++) {
          const ww = wet.next(w), y = bufL[i] * lo.next(gl) + (bufB[i] + (bufA[i] * tg - bufB[i]) * ww) * hi.next(gh);
          const o = y * lv.next(go);
          L[i] = o; R[i] = o;
        }
      },
    };
  },
};
`),
});
