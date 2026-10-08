// @ts-check
// core.cab: Iso Cab. The speaker cabinet on its own: Half Stack's cab stage for anything else,
// after a Guitar Studio amp, a pedal, a kernel drive or a line out. One of six measured 4x12 impulse responses
// (Jester Dyne Productions' Brutal and Emerald packs, CC0: tools/kits/jester-cabs.js) through dsp.convolver with no
// latency, or the designed Filter 4x12 (what every IR choice plays until the bank is in, or if it isn't on this
// server). Each side has its own cab. Then LOW CUT and HIGH CUT (12 dB/oct), MIX (the dry signal is already in time:
// the cab adds no latency) and LEVEL.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { CAB_LIB, CABS_HASH, CAB_LABELS, CAB_NAMES, CAB_SAYS } from './amp-lib.js';

// the cab's own trim (dB, on the wet signal) that puts the defaults within a decibel of bypass on the house's DI strum
// (tools/cab-test.js)
export const CAB_TRIM = 2.4;

export default defineDevice({
  id: 'core.cab',
  name: 'Iso Cab',
  kind: 'effect',
  cat: 'amp',
  by: 'overdub',
  blurb: 'A miked 4x12 for any amp or pedal',
  nod: 'measured guitar-cabinet impulse responses',
  params: [
    {
      key: 'cab',
      label: 'CAB',
      opts: CAB_LABELS.slice(0, 7),
      def: 0,
      role: 'shape',
      desc: `the cabinet and mic: ${CAB_NAMES.slice(0, 6).join('; ')} (measured impulse responses), or Filter 4x12 (designed)`,
    },
    {
      key: 'low_cut',
      label: 'LOW CUT',
      min: 20,
      max: 200,
      def: 60,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'a high-pass after the cab (12 dB/oct)',
    },
    {
      key: 'high_cut',
      label: 'HIGH CUT',
      min: 4000,
      max: 20000,
      def: 12000,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'a low-pass after the cab (12 dB/oct): lower it to take the fizz off',
    },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', desc: 'the dry signal (0) to all cab (1)' },
    {
      key: 'level',
      label: 'LEVEL',
      min: -24,
      max: 12,
      def: 0,
      unit: 'dB',
      role: 'level',
      desc: 'the output level, after the cab, the cuts and the mix',
    },
  ],
  presets: [
    { name: 'Modern close', blurb: 'the close dynamic on the modern 4x12: tight and forward', params: { cab: 0 } },
    { name: 'Modern bright', blurb: 'a brighter speaker: more bite for a dark amp', params: { cab: 1 } },
    { name: 'Two mics', blurb: 'two mics on two speakers: wider in the mids', params: { cab: 3 } },
    { name: 'British', blurb: 'the old British 4x12: rounder, the classic rock cab', params: { cab: 4 } },
    {
      name: 'Blend',
      blurb: 'half the dry signal back in, for a bass or a synth through a cab',
      params: { cab: 0, mix: 0.5, low_cut: 30 },
    },
  ],
  look: {
    color: '#2a2622',
    ink: '#efe6d6',
    shape: 'box',
    finish: 'tolex',
    knob: 'chrome',
    label: 'block',
    led: '#ffb347',
  },
  data: { cabs: CABS_HASH },
  dataSays: CAB_SAYS,
  latency: 0,
  tail: 0.05,
  kernel: kernel(String.raw`
${CAB_LIB}
const TRIM = ${CAB_TRIM};
return {
  create({ sr, dsp, data }) {
    const bank = data && data.cabs;
    const cl = makeCab(sr, dsp, bank), cr = makeCab(sr, dsp, bank);
    const lcl = svf(sr), lcr = svf(sr), hcl = svf(sr), hcr = svf(sr), lv = glide(30, sr, 1), mx = glide(30, sr, 1);
    let bl = new Float64Array(128), br = new Float64Array(128);
    return {
      process(L, R, n, P) {
        cl.set(P.cab); cr.set(P.cab);
        lcl.set(P.low_cut, 0.7071); lcr.set(P.low_cut, 0.7071); hcl.set(P.high_cut, 0.7071); hcr.set(P.high_cut, 0.7071);
        if (bl.length < n) { bl = new Float64Array(n); br = new Float64Array(n); }
        for (let i = 0; i < n; i++) { bl[i] = L[i]; br[i] = R[i]; }
        cl.process(bl, n); cr.process(br, n);
        const g = dbg(P.level), tg = dbg(TRIM);
        for (let i = 0; i < n; i++) {
          lcl.tick(bl[i]); lcr.tick(br[i]);
          const wl = hcl.tick(lcl.hp) * tg, wr = hcr.tick(lcr.hp) * tg, m = mx.next(P.mix), o = lv.next(g);
          L[i] = (L[i] + (wl - L[i]) * m) * o; R[i] = (R[i] + (wr - R[i]) * m) * o;
        }
      },
    };
  },
};
`),
});
