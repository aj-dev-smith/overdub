// @ts-check
// core.stack: Half Stack. A high-gain head into a real 4x12, as a kernel: it renders in the canonical Node render and
// the studio alike, bit for bit, and plays live through an armed audio track with 28 samples (0.6 ms) of latency.
// The DSP is amp-lib.js's (the gate, TIGHT, the boost, three triode stages, the TMB tone
// stack, the power amp with sag, presence and depth, all oversampled 4x or 8x), then the cab: one of six measured
// 4x12 impulse responses (Jester Dyne Productions' Brutal and Emerald packs, CC0: tools/kits/jester-cabs.js) through
// dsp.convolver with no latency, or the designed Filter 4x12 (what every IR choice plays until the bank is in, or if it
// isn't on this server), or OFF (the line out). Then LOW CUT and HIGH CUT (12 dB/oct each) and LEVEL.
// Mono in ((L + R) / 2), the same signal out on both sides: double-track by playing twice and panning the two tracks.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { AMP_LIB, CAB_LIB, CABS_HASH, CAB_LABELS, CAB_NAMES, CAB_SAYS } from './amp-lib.js';

// the output trim (dB) that puts the defaults within a decibel of the DI's loudness (measured by tools/stack-test.js
// on the house's DI strum and the metal DI fixtures)
export const STACK_TRIM = -16.8;

export default defineDevice({
  id: 'core.stack', name: 'Half Stack', kind: 'effect', cat: 'amp', by: 'overdub',
  blurb: 'A tight high-gain head into a real 4x12',
  nod: 'a modern high-gain amp with a green overdrive in front, into measured cab impulse responses',
  params: [
    { key: 'gate', label: 'GATE', min: -96, max: -20, def: -70, unit: 'dB', role: 'level', desc: 'a noise gate before the gain: it closes under this level (-96 is off); raise it until the hiss between chugs is gone' },
    { key: 'tight', label: 'TIGHT', min: 20, max: 250, def: 110, curve: 'log', unit: 'Hz', role: 'tone', desc: 'cuts the lows before the gain (12 dB/oct): higher is tighter, faster palm mutes; lower is fuller and looser' },
    { key: 'boost', label: 'BOOST', opts: ['OFF', 'ON'], def: 1, role: 'shape', desc: 'an overdrive in front, set clean and loud: it pushes the mids into the amp and tightens the low end' },
    { key: 'boost_drive', label: 'B DRIVE', min: 0, max: 1, def: 0.1, role: 'drive', desc: 'the overdrive\'s own clipping: keep it low for a tight boost; turn it up for more saturation' },
    { key: 'boost_level', label: 'B LEVEL', min: 0, max: 18, def: 9, unit: 'dB', role: 'level', desc: 'how hard the overdrive hits the amp' },
    { key: 'gain', label: 'GAIN', min: 0, max: 10, def: 6.5, role: 'drive', desc: 'the preamp gain: 3 crunch, 5 hard rock, 6 to 7 modern metal rhythm, 8 and up leads' },
    { key: 'bass', label: 'BASS', min: 0, max: 10, def: 5, role: 'tone', desc: 'the tone stack\'s bass (after the gain, so it adds weight without mud)' },
    { key: 'mid', label: 'MID', min: 0, max: 10, def: 5.5, role: 'tone', desc: 'the tone stack\'s mids: up to cut through a mix, down for a scooped tone' },
    { key: 'treble', label: 'TREBLE', min: 0, max: 10, def: 6, role: 'tone', desc: 'the tone stack\'s treble: the pick attack and the edge' },
    { key: 'master', label: 'MASTER', min: 0, max: 10, def: 5, role: 'drive', desc: 'how hard the power amp is pushed: higher is more compressed and thicker' },
    { key: 'sag', label: 'SAG', min: 0, max: 1, def: 0.3, role: 'shape', desc: 'the power supply giving way under sustained playing: higher blooms and squashes, lower is stiff and fast' },
    { key: 'presence', label: 'PRESENCE', min: 0, max: 10, def: 5.5, role: 'tone', desc: 'the power amp\'s upper mids and highs, from about 3.5 kHz: the bite' },
    { key: 'depth', label: 'DEPTH', min: 0, max: 10, def: 5, role: 'tone', desc: 'the power amp\'s low resonance, near 90 Hz: the thump of the cab' },
    { key: 'cab', label: 'CAB', opts: CAB_LABELS, def: 0, role: 'shape', desc: `the speaker cabinet: ${CAB_NAMES.slice(0, 6).join('; ')} (measured impulse responses); Filter 4x12 (designed); OFF (the amp's line out, for a cab of your own)` },
    { key: 'low_cut', label: 'LOW CUT', min: 20, max: 200, def: 80, curve: 'log', unit: 'Hz', role: 'tone', desc: 'a high-pass after the cab (12 dB/oct): leave the room under the guitars to the bass and kick' },
    { key: 'high_cut', label: 'HIGH CUT', min: 4000, max: 20000, def: 10000, curve: 'log', unit: 'Hz', role: 'tone', desc: 'a low-pass after the cab (12 dB/oct): lower it to take the fizz off' },
    { key: 'level', label: 'LEVEL', min: -24, max: 12, def: 0, unit: 'dB', role: 'level', desc: 'the amp\'s output level, after the cab and the cuts' },
    { key: 'quality', label: 'QUALITY', opts: ['4X', '8X'], def: 0, role: 'shape', desc: 'oversampling: 8X aliases less at very high gain and costs twice the processing' },
  ],
  presets: [
    { name: 'Modern', blurb: 'tight rhythm: boost on, gain 6.5, mids in, the close dynamic cab', params: { gate: -70, tight: 110, boost: 'ON', boost_drive: 0.1, boost_level: 9, gain: 6.5, bass: 5, mid: 5.5, treble: 6, master: 5, sag: 0.3, presence: 5.5, depth: 5, cab: 0 } },
    { name: 'Djent', blurb: 'tighter, more mids, the gate harder: for syncopated chugs on low strings', params: { gate: -56, tight: 150, boost: 'ON', boost_drive: 0.05, boost_level: 12, gain: 6, bass: 4.5, mid: 7, treble: 6.5, master: 4, sag: 0.1, presence: 6.5, depth: 4, cab: 1 } },
    { name: 'Thrash', blurb: 'more mids, less boost: fast picking that stays clear', params: { gate: -64, tight: 100, boost: 'ON', boost_drive: 0.2, boost_level: 5, gain: 6, bass: 5.5, mid: 7, treble: 6.5, master: 5.5, sag: 0.2, presence: 6, depth: 5, cab: 2 } },
    { name: 'Doom', blurb: 'loose and huge: no boost, TIGHT down at 60 Hz, the British cab', params: { gate: -80, tight: 60, boost: 'OFF', gain: 7.5, bass: 7, mid: 4, treble: 4.5, master: 7, sag: 0.6, presence: 4, depth: 7, cab: 4, high_cut: 7000 } },
    { name: 'Lead', blurb: 'more gain and mids, a softer gate, for solos that sustain', params: { gate: -80, tight: 90, boost: 'ON', boost_drive: 0.3, boost_level: 8, gain: 8.5, bass: 4.5, mid: 7, treble: 5.5, master: 6, sag: 0.4, presence: 5, depth: 4.5, cab: 3 } },
  ],
  look: { color: '#1b1b1d', ink: '#e9e4d8', shape: 'wide', finish: 'tolex', knob: 'chrome', label: 'block', led: '#ff3b2f' },
  data: { cabs: CABS_HASH }, dataSays: CAB_SAYS,
  latency: 28 / 48000, tail: 0.1,
  kernel: kernel(String.raw`
${AMP_LIB}
${CAB_LIB}
const TRIM = ${STACK_TRIM};
return {
  create({ sr, dsp, data }) {
    const amp = makeAmp(sr, dsp), cab = makeCab(sr, dsp, data && data.cabs);
    const lc = svf(sr), hc = svf(sr), lv = glide(30, sr, 1);
    let buf = new Float64Array(128);
    return {
      latency: amp.latency,
      process(L, R, n, P) {
        amp.set(P);
        cab.set(P.cab);
        lc.set(P.low_cut, 0.7071); hc.set(P.high_cut, 0.7071);
        const g = dbg(P.level + TRIM);
        if (buf.length < n) buf = new Float64Array(n);
        for (let i = 0; i < n; i++) buf[i] = amp.tick(0.5 * (L[i] + R[i]));
        cab.process(buf, n);
        for (let i = 0; i < n; i++) { lc.tick(buf[i]); const y = hc.tick(lc.hp) * lv.next(g); L[i] = y; R[i] = y; }
      },
    };
  },
};
`),
});
