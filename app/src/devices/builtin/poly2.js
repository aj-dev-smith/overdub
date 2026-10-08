// @ts-check
// core.poly2: Step Ladder. The analogue polysynth people mean when they say "a poly": oscillators that never alias,
// a 24 dB ladder low-pass and a chorus, with velocity opening the filter by default (docs/research/INSTRUMENTS.md,
// 2.11; Patch Bay stays as it is, since songs and golden scenes use it).
//   WAVE    SAW: three saws a few cents apart (DETUNE), each drifting on its own, as a two-oscillator poly with a
//           little unison sounds. SUPER: seven saws on the classic supersaw's detune curve, the centre and the sides
//           mixed so the level holds as DETUNE spreads them (Szabo 2010, after the JP-8000). PULSE: two pulses a
//           few cents apart, their widths swept slowly against each other (PWM). Every oscillator reads a table
//           with only the harmonics that fit under the sample rate, so a C8 is as clean as a C2.
//   LADDER  four trapezoidal one-poles with the feedback solved exactly and the input stage saturated (Zavalishin),
//           its passband loss half made up as RESO rises; at RESO 1 it whistles at the cutoff on its own. CUTOFF
//           follows the keyboard (half the way), ENV is how far the filter envelope opens it, DECAY how fast it
//           falls back, and velocity is part of the envelope: harder notes open the filter further (x1.3 or more
//           in the onset's centroid at C3 and C4), as well as playing louder.
//   CHORUS  the two-tap bucket-brigade chorus every 80s poly had: one delay line read by two taps on opposite
//           phases of a slow sine, left and right, which is where the width comes from.
// The mod wheel adds vibrato and the bend wheel bends (docs/DEVICES.md, "Expression"). About -16 LUFS on the test
// phrase at defaults. tools/instruments3-test.js and tools/timbre-test.js hold it to its numbers.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { TABLES } from './tables.js';

export default defineDevice({
  id: 'core.poly2', name: 'Step Ladder', kind: 'instrument', cat: 'synth', by: 'overdub',
  blurb: 'A ladder-filter poly: warm saws, supersaws, PWM',
  nod: 'an analogue polysynth with a 24 dB ladder filter, a supersaw and a chorus',
  params: [
    { key: 'wave', label: 'WAVE', opts: ['SAW', 'SUPER', 'PULSE'], def: 0, role: 'shape', desc: 'three warm saws, the seven-saw supersaw, or two pulses sweeping' },
    { key: 'detune', label: 'DETUNE', min: 0, max: 1, def: 0.2, role: 'width', desc: 'how far apart the oscillators are: tight to huge' },
    { key: 'cutoff', label: 'CUTOFF', min: 40, max: 16000, def: 900, curve: 'log', unit: 'Hz', role: 'tone', desc: 'where the ladder filter closes (it follows the keys)' },
    { key: 'reso', label: 'RESO', min: 0, max: 1, def: 0.25, role: 'tone', desc: 'the ladder\'s peak at the cutoff; at the top it whistles' },
    { key: 'env', label: 'ENV', min: 0, max: 1, def: 0.45, role: 'depth', desc: 'how far each note opens the filter (and how much harder playing opens it)' },
    { key: 'attack', label: 'ATTACK', min: 0.001, max: 4, def: 0.004, curve: 'log', unit: 's', role: 'attack', desc: 'fade-in time: pluck to swell' },
    { key: 'decay', label: 'DECAY', min: 0.03, max: 4, def: 0.5, curve: 'log', unit: 's', role: 'decay', desc: 'how fast the filter falls back after it opens' },
    { key: 'release', label: 'RELEASE', min: 0.005, max: 6, def: 0.3, curve: 'log', unit: 's', role: 'release', desc: 'tail after the key lets go' },
  ],
  presets: [
    { name: 'Warm poly', params: {} },
    { name: 'Supersaw', params: { wave: 1, detune: 0.45, cutoff: 3500, reso: 0.1, env: 0.35, decay: 0.8, release: 0.45 } },
    { name: 'Ladder bass', params: { wave: 0, detune: 0.1, cutoff: 260, reso: 0.55, env: 0.7, decay: 0.25, release: 0.08 } },
    { name: 'PWM strings', params: { wave: 2, detune: 0.35, cutoff: 2200, reso: 0.1, env: 0.15, attack: 0.35, decay: 1.5, release: 0.9 } },
  ],
  look: { color: '#23252b', ink: '#e9e4d6', shape: 'rack', finish: 'brushed', knob: 'black', label: 'plate', led: '#ff9f43' },
  tail: 6,
  kernel: kernel(TABLES + String.raw`
// the supersaw's seven offsets (relative, at full detune) and the curve that spreads them (Szabo 2010)
const SS = [-0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242];
const ssAmt = (x) => ((((((((((10028.7312891634 * x - 50818.8652045924) * x + 111363.4808729368) * x - 138150.6761080548) * x + 106649.6679158292) * x - 53046.9642751875) * x + 17019.951858008) * x - 3425.0836591318) * x + 404.2703938388) * x - 24.1878824391) * x + 0.6717417634) * x + 0.0030115596;
const SAW = wavetable((k) => (k & 1 ? 1 : -1) * 0.6366197723675814 / k);
const MAXO = 7;
return {
  poly: 16,
  create({ sr, seed }) {
    // the chorus: one delay line, two taps on opposite phases of a slow sine
    const cd = delayLine(Math.ceil(0.012 * sr)), dcl = dcblock(sr), dcr = dcblock(sr);
    let cph = 0;
    const T = SAW.T;
    return {
      voice(vi) {
        const r = rng((seed ^ 0x1add) + vi * 7727);
        const ph = new Float64Array(MAXO), dt = new Float64Array(MAXO), gn = new Float64Array(MAXO), rel = new Float64Array(MAXO), drift = new Float64Array(MAXO);
        for (let j = 0; j < MAXO; j++) { ph[j] = (r() + 1) / 2; drift[j] = r(); }
        const amp = adsr(sr), fenv = adsr(sr), lad = ladder(sr);
        let wave = 0, no = 3, f0 = 261, vel = 0.7, base = 0, cnt = 0, pwA = 0, pwB = 0, pwPh = (r() + 1) / 2, vph = 0, keyG = 1, velG = 1, lv = 0;
        let lastBend = 0, lastMod = 0, lastDet = -1;
        const tune = (P, bend, mod) => {
          const d = P.detune;
          // vibrato from the mod wheel: up to +-35 cents at 5.5 Hz
          const vib = mod > 0 ? mod * 35 * sinT(vph) : 0;
          const fb = f0 * Math.pow(2, (bend * 100 + vib) / 1200);
          let top = 1;
          if (wave === 1) {
            const a = ssAmt(clamp(d, 0, 1));
            for (let j = 0; j < 7; j++) { rel[j] = 1 + SS[j] * a + drift[j] * 0.0006; if (rel[j] > top) top = rel[j]; }
            const side = -0.73764 * d * d + 1.2841 * d + 0.044372, mid = -0.55366 * d + 0.99785;
            // and the whole stack held to one power as it spreads
            const nm = 0.62 / Math.sqrt(mid * mid + 6 * side * side);
            for (let j = 0; j < 7; j++) gn[j] = (j === 3 ? mid : side) * nm;
          } else {
            const c = (wave === 2 ? 3 : 2) + 22 * d * d;         // cents either side
            const n2 = wave === 2 ? 2 : 3;
            for (let j = 0; j < n2; j++) {
              const s = n2 === 3 ? j - 1 : (j ? 1 : -1) * 0.5;
              rel[j] = Math.pow(2, s * (c + drift[0] * 1.2) / 1200); if (rel[j] > top) top = rel[j];
              gn[j] = n2 === 3 ? (j === 1 ? 0.62 : 0.24) : 0.3;   // the centre outweighs the pair, so a beat never cancels it
            }
          }
          for (let j = 0; j < no; j++) dt[j] = fb * rel[j] / sr;
          base = wtBase(SAW, fb * top * (wave === 2 ? 1.02 : 1) / sr);
        };
        return {
          start(p, v, P) {
            wave = P.wave | 0; no = wave === 1 ? 7 : wave === 2 ? 2 : 3;
            f0 = mtof(p); vel = v; cnt = 0; lastBend = 0; lastMod = 0; lastDet = P.detune;
            // SAW and PULSE: the oscillators sit either side of the centre in pitch and in phase, a mirror image (the
            // gap seeded per note), so each harmonic beats in level but never leans sharp or flat; the supersaw runs free
            if (wave === 1) for (let j = 0; j < MAXO; j++) ph[j] = (r() + 1) / 2;
            else {
              const c = (r() + 1) / 2, g = 0.15 + 0.1 * (r() + 1);
              if (wave === 0) { ph[1] = c; ph[0] = c - g + 1; ph[2] = c + g; }
              else { ph[0] = c - g / 2 + 1; ph[1] = c + g / 2; }
              for (let j = 0; j < 3; j++) ph[j] -= Math.floor(ph[j]);
            }
            tune(P, 0, 0);
            amp.set(P.attack * (1.15 - 0.3 * v), 0.3, 1, P.release); amp.gate(true);
            fenv.set(Math.max(0.002, P.attack * 0.6), P.decay, 0.3, P.release); fenv.gate(true);
            // register: the ladder tracks the keys, so a low note is darker and a high one hotter; a gentle tilt
            // holds the keyboard even by loudness
            keyG = Math.pow(2, -clamp(p - 60, -36, 36) / 48);
            velG = 0.3 + 0.7 * Math.pow(v, 1.15);
            lad.reset();
          },
          release(P) { amp.set(P.attack, 0.3, 1, P.release); fenv.set(Math.max(0.002, P.attack * 0.6), P.decay, 0.3, P.release); amp.gate(false); fenv.gate(false); },
          render(L, R, n, P, t) {
            const bend = t && t.bend ? t.bend : 0, mod = t && t.mod > 0 ? t.mod : 0;
            if (mod > 0) { vph += n * 5.5 / sr; if (vph >= 1) vph -= 1; }
            if (bend !== lastBend || mod > 0 || lastMod > 0 || P.detune !== lastDet) { tune(P, bend, mod); lastBend = bend; lastMod = mod; lastDet = P.detune; }
            // into the ladder: clean at low RESO (no growl between detuned saws), driving its input harder as the peak rises
            const res = 4.1 * Math.pow(P.reso, 0.8), drv = 0.1 + 0.3 * P.reso * P.reso, og = 0.32 * keyG * velG / drv;
            const cut = P.cutoff * Math.pow(f0 / 261.6, 0.5), ea = P.env * (5.5 + 2.5 * vel) * (0.35 + 0.65 * vel);
            const vc = Math.pow(2, (vel - 0.6) * 1.4);
            for (let i = 0; i < n; i++) {
              if ((cnt & 15) === 0) {
                const fe = fenv.v;
                lad.set(cut * vc * Math.pow(2, ea * fe), res);
                if (wave === 2) {
                  pwPh += 16 * 0.31 / sr; if (pwPh >= 1) pwPh -= 1;
                  const s = sinT(pwPh);
                  pwA = 0.5 - (0.12 + 0.25 * P.detune) * (0.5 + 0.5 * s); pwB = 0.5 - (0.12 + 0.25 * P.detune) * (0.5 - 0.5 * s);
                }
              }
              cnt++;
              fenv.next();
              const a = amp.next();
              let x = 0;
              if (wave === 2) {
                for (let j = 0; j < 2; j++) {
                  let q = ph[j] + dt[j]; if (q >= 1) q -= 1; ph[j] = q;
                  let q2 = q + (j ? pwB : pwA); if (q2 >= 1) q2 -= 1;
                  x += (wtRead(T, base, q) - wtRead(T, base, q2)) * 0.3;
                }
              } else {
                for (let j = 0; j < no; j++) { let q = ph[j] + dt[j]; if (q >= 1) q -= 1; ph[j] = q; x += wtRead(T, base, q) * gn[j]; }
              }
              const y = lad.tick(x * drv) * a * og;
              L[i] += y; R[i] += y;
              if (i === 0) lv = a;
            }
            return amp.active();
          },
          stop() { amp.kill(); },
        };
      },
      process(L, R, n) {
        // the chorus adds to one side what it takes from the other, so in mono it is the dry poly (no comb)
        const dt = 0.47 / sr, base = 0.0045 * sr, dep = 0.0011 * sr;
        for (let i = 0; i < n; i++) {
          const x = L[i];
          cd.write(x);
          cph += dt; if (cph >= 1) cph -= 1;
          const w = cd.read(base + dep * sinT(cph)) * 0.42;
          const OUT = 0.86;
          L[i] = knee(dcl((x + w) * OUT));
          R[i] = knee(dcr((x - w) * OUT));
        }
      },
    };
  },
};
`),
});
