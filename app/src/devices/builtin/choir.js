// @ts-check
// core.choir: Risers. A choir, sample-free: voices made the way a voice is made, a buzzing source through the
// resonances of a throat and mouth (formants), with the tables changing by register the way a choir's sections do
// (docs/research/INSTRUMENTS.md, 2.8; Choir Loft stays as it is).
//   SECTIONS  every note is sung by the section whose range it sits in: basses below about G2, tenors around E3, altos
//             around D4, sopranos from C5 up, each with its own formant table (the Csound manual's: five formants per
//             vowel per voice type, frequency, level and bandwidth), blended between neighbours so no key jumps. Above
//             the first formant a singer raises it to sit on the note (formant tuning), so high notes don't thin out.
//   VOWEL     OO, OH, AH, EH, EE across the knob, morphing smoothly (it can be automated: a choir going "oo-ah").
//   SINGERS   three per note: a leader and a pair either side, a few cents sharp and flat (ENSEMBLE), mirrored in
//             pitch, phase, vibrato and timing, so the note stays in tune on average however they beat. Vibrato
//             arrives after 0.3-0.7 s, as trained singers' does.
//   EFFORT    the source is a band-limited glottal buzz whose spectrum tilts with velocity: sung louder, the upper
//             harmonics grow faster than the fundamental (as real voices do), so velocity is colour as well as level.
//             BREATH adds aspiration through the same formants.
//   ONSET     NONE (the vowel speaks at once), M (a hummed "m" opening into the vowel), D (a voiced stop: a short voice
//             bar, a burst, the formants sliding in from the "d" locus) or L (a lateral "l", low second formant).
// Then choir seating (low voices right, high left) and a hall. The mod wheel adds vibrato, the bend wheel bends. About
// -16 LUFS on the test phrase at defaults. tools/instruments3-test.js and tools/timbre-test.js hold it to its numbers.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { TABLES } from './tables.js';

export default defineDevice({
  id: 'core.choir',
  name: 'Risers',
  kind: 'instrument',
  cat: 'synth',
  by: 'overdub',
  blurb: 'A choir: oohs and aahs, basses to sopranos, in a hall',
  nod: 'a mixed choir singing vowels, with consonant onsets',
  params: [
    {
      key: 'vowel',
      label: 'VOWEL',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'shape',
      desc: 'OO, OH, AH, EH, EE across the knob',
    },
    {
      key: 'onset',
      label: 'ONSET',
      opts: ['NONE', 'M', 'D', 'L'],
      def: 0,
      role: 'shape',
      desc: 'how each note starts: the vowel at once, or a hummed m, a d, an l',
    },
    {
      key: 'ensemble',
      label: 'ENSEMBLE',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'width',
      desc: 'a tight chamber choir to a big, loose one',
    },
    {
      key: 'vibrato',
      label: 'VIBRATO',
      min: 0,
      max: 1,
      def: 0.3,
      role: 'depth',
      desc: "how much the singers' pitch moves on held notes",
    },
    { key: 'breath', label: 'BREATH', min: 0, max: 1, def: 0.3, role: 'mix', desc: 'air in the voices' },
    {
      key: 'attack',
      label: 'ATTACK',
      min: 0.01,
      max: 3,
      def: 0.15,
      curve: 'log',
      unit: 's',
      role: 'attack',
      desc: 'how slowly the voices come in (louder notes come in faster)',
    },
    {
      key: 'release',
      label: 'RELEASE',
      min: 0.05,
      max: 4,
      def: 0.5,
      curve: 'log',
      unit: 's',
      role: 'release',
      desc: 'how long the voices take to stop',
    },
    { key: 'hall', label: 'HALL', min: 0, max: 1, def: 0.35, role: 'mix', desc: 'how much of the hall you hear' },
  ],
  presets: [
    { name: 'Aahs', params: {} },
    { name: 'Oohs', params: { vowel: 0, breath: 0.4, attack: 0.35, release: 0.9, hall: 0.45 } },
    { name: 'Hummed', params: { vowel: 0.12, onset: 1, attack: 0.25, vibrato: 0.2 } },
    { name: 'Da da', params: { vowel: 0.5, onset: 2, attack: 0.03, release: 0.25, vibrato: 0.15, hall: 0.25 } },
    { name: 'Cathedral', params: { vowel: 0.35, ensemble: 0.85, attack: 0.6, release: 1.6, hall: 0.8 } },
  ],
  look: {
    color: '#2f3a4a',
    ink: '#ecebe4',
    shape: 'wide',
    finish: 'flat',
    knob: 'cream',
    label: 'script',
    led: '#c9d8ff',
  },
  tail: 6,
  kernel: kernel(
    TABLES +
      String.raw`
// the source: a flat buzz (every harmonic equal); effort tilts the formants above the first (setF)
const FLAT = wavetable(() => 0.2);
// formants [F1..F5 Hz, A1..A5 dB, B1..B5 Hz] by section and vowel (u o a e i), from the Csound manual's table
const FT = [
  [ // bass
    [350, 600, 2400, 2675, 2950, 0, -20, -32, -28, -36, 40, 80, 100, 120, 120],
    [400, 750, 2400, 2600, 2900, 0, -11, -21, -20, -40, 40, 80, 100, 120, 120],
    [600, 1040, 2250, 2450, 2750, 0, -7, -9, -9, -20, 60, 70, 110, 120, 130],
    [400, 1620, 2400, 2800, 3100, 0, -12, -9, -12, -18, 40, 80, 100, 120, 120],
    [250, 1750, 2600, 3050, 3340, 0, -30, -16, -22, -28, 60, 90, 100, 120, 120]],
  [ // tenor
    [350, 600, 2700, 2900, 3300, 0, -20, -17, -14, -26, 40, 60, 100, 120, 120],
    [400, 800, 2600, 2800, 3000, 0, -10, -12, -12, -26, 40, 80, 100, 120, 120],
    [650, 1080, 2650, 2900, 3250, 0, -6, -7, -8, -22, 80, 90, 120, 130, 140],
    [400, 1700, 2600, 3200, 3580, 0, -14, -12, -14, -20, 70, 80, 100, 120, 120],
    [290, 1870, 2800, 3250, 3540, 0, -15, -18, -20, -30, 40, 90, 100, 120, 120]],
  [ // alto
    [325, 700, 2530, 3500, 4950, 0, -12, -30, -40, -64, 50, 60, 170, 180, 200],
    [450, 800, 2830, 3500, 4950, 0, -9, -16, -28, -55, 70, 80, 100, 130, 135],
    [800, 1150, 2800, 3500, 4950, 0, -4, -20, -36, -60, 80, 90, 120, 130, 140],
    [400, 1600, 2700, 3300, 4950, 0, -24, -30, -35, -60, 60, 80, 120, 150, 200],
    [350, 1700, 2700, 3700, 4950, 0, -20, -30, -36, -60, 50, 100, 120, 150, 200]],
  [ // soprano
    [325, 700, 2700, 3800, 4950, 0, -16, -35, -40, -60, 50, 60, 170, 180, 200],
    [450, 800, 2830, 3800, 4950, 0, -11, -22, -22, -50, 70, 80, 100, 130, 135],
    [800, 1150, 2900, 3900, 4950, 0, -6, -32, -20, -50, 80, 90, 120, 130, 140],
    [350, 2000, 2800, 3600, 4950, 0, -20, -15, -40, -56, 60, 100, 120, 150, 200],
    [270, 2140, 2950, 3900, 4950, 0, -12, -26, -26, -44, 60, 90, 100, 120, 120]],
];
const ANCHOR = [43, 52, 62, 72];   // where each section's table is itself (G2, E3, D4, C5)
// the consonants' own formants (the shape the vowel slides out of): M (nasal murmur), D (the alveolar locus), L
const CONS = [null,
  [260, 1000, 2200, 3200, 4000, 0, -26, -32, -40, -46, 50, 120, 150, 200, 200],
  [250, 1700, 2600, 3300, 4000, 0, -14, -20, -26, -34, 60, 100, 120, 150, 200],
  [360, 1100, 2700, 3300, 4000, 0, -10, -22, -28, -36, 60, 90, 120, 150, 200]];
// per ONSET: how long the consonant holds, how long the slide into the vowel takes, its level while held
const CT = [[0, 0, 1], [0.07, 0.06, 0.4], [0.018, 0.045, 0.14], [0.05, 0.05, 0.6]];
const NS = 3;
return {
  poly: 16,
  create({ sr, seed }) {
    const T1 = FLAT.T;
    const hall = fdn(sr, seed ^ 0xc401), pre = delayLine(Math.ceil(0.03 * sr)), preR = delayLine(Math.ceil(0.03 * sr));
    hall.set(0.8, 2.6, 0.5);
    const hlS = glide(40, sr), dcl = dcblock(sr), dcr = dcblock(sr);
    return {
      voice(vi) {
        const r = rng((seed ^ 0xc0a1) + vi * 5003);
        let ns = ((seed ^ 0x5eed) + vi * 313) | 0;
        const ph = new Float64Array(NS), dt = new Float64Array(NS), rel = new Float64Array(NS), sg = new Float64Array(NS), am = new Float64Array(NS);
        const fv = new Float64Array(15), fq = new Float64Array(15), fw = new Float64Array(15), cur = new Float64Array(15);
        // the five formant resonators (state-variable band-passes, inline): coefficients and states
        const a1 = new Float64Array(5), a2 = new Float64Array(5), a3 = new Float64Array(5), kg = new Float64Array(5);
        const s1 = new Float64Array(5), s2 = new Float64Array(5);
        // the low end under the first formant (a cascade's skirt): a gentle low-pass on the buzz
        let b1 = 0, b2 = 0, ba1 = 1, ba2 = 0, ba3 = 0, bG = 0;
        // the glottis: its spectrum falls 12 dB an octave above a corner that rises with effort (soft: about 700 Hz)
        let t1 = 0, t2 = 0, ta1 = 1, ta2 = 0, ta3 = 0;
        let f0 = 261, p0 = 60, vel = 0.7, t = 0, cnt = 0, gate = false, e = 0, ka = 0, kr = 0, vib = 0, vph = 0, vdt = 0, vOn = 0.4;
        let ons = 0, late = 0, mix = 0.3, og = 1, pan0 = 1, pan1 = 1, nzA = 0, burst = 0, kb = 0, by = 0, cg = 1, lastV = -1, jit = 1, alive = 0;
        let base1 = 0, top8 = 1;
        // the vowel's formants for this note's section, at VOWEL v (0..1), into fv
        const vowel = (v) => {
          const x = clamp(v, 0, 1) * 4, i = Math.min(3, x | 0), u = x - i;
          let s = 0; while (s < 3 && p0 > ANCHOR[s + 1]) s++;
          const w = clamp((p0 - ANCHOR[s]) / (ANCHOR[Math.min(3, s + 1)] - ANCHOR[s] || 1), 0, 1), s2i = Math.min(3, s + 1);
          for (let k = 0; k < 15; k++) {
            const lo = FT[s][i][k] + (FT[s][i + 1][k] - FT[s][i][k]) * u, hi = FT[s2i][i][k] + (FT[s2i][i + 1][k] - FT[s2i][i][k]) * u;
            fv[k] = lo + (hi - lo) * w;
          }
          for (let k = 0; k < 5; k++) fv[k] *= jit;
          // formant tuning: a singer lifts the first formant to sit on a note above it
          if (fv[0] < f0 * 1.08) { fv[10] = Math.max(fv[10], f0 * 0.12); fv[0] = f0 * 1.08; }
          if (fv[1] < fv[0] * 1.3) fv[1] = fv[0] * 1.3;
        };
        const setF = () => {
          for (let k = 0; k < 5; k++) {
            // a harmonic source samples the resonance every f0: a band at least about half a harmonic wide keeps the level
            // even from key to key (a section's many voices and their vibrato smear it the same way)
            const bw = Math.sqrt(cur[10 + k] * cur[10 + k] + 0.36 * f0 * f0);
            const g = Math.tan(Math.PI * clamp(cur[k], 40, sr * 0.45) / sr), q = clamp(cur[k] / Math.max(30, bw), 0.5, 40);
            const kq = 1 / q;
            // effort: sung softly, the formants above the first fall away (about 7 dB an octave, on top of the glottis's own tilt), less as it gets louder
            const tl = k ? -7 * (1 - mix) * Math.log2(Math.max(1, cur[k] / cur[0])) : 0;
            a1[k] = 1 / (1 + g * (g + kq)); a2[k] = g * a1[k]; a3[k] = g * a2[k]; kg[k] = kq * dbg(cur[5 + k] + tl);
          }
          const g = Math.tan(Math.PI * clamp(cur[0] * 0.85, 40, sr * 0.45) / sr);
          ba1 = 1 / (1 + g * (g + 1.4142)); ba2 = g * ba1; ba3 = g * ba2;
          bG = 0.8 * Math.sqrt(f0 / Math.max(f0, cur[0]));
          const gt = Math.tan(Math.PI * Math.min(sr * 0.4, Math.max(f0 * 2, 700 * Math.pow(2, 2.9 * mix))) / sr);
          ta1 = 1 / (1 + gt * (gt + 1.6)); ta2 = gt * ta1; ta3 = gt * ta2;
        };
        return {
          start(p, v, P) {
            f0 = mtof(p); p0 = p; vel = v; t = 0; cnt = 0; gate = true; e = 0; alive = 1;
            ons = P.onset | 0;
            const ens = P.ensemble;
            // the singers: a leader, and a pair mirrored around them
            // above the sopranos' range (C6) the singers narrow to one line by C7: no spread, no vibrato
            top8 = clamp((96 - p) / 12, 0, 1);
            const c = (r() + 1) / 2, g = 0.12 + 0.12 * (r() + 1), cents = (3 + 12 * ens * (0.8 + 0.2 * (r() + 1))) * top8;
            rel[0] = 1; sg[0] = 0; ph[0] = c; am[0] = 1;
            for (let s = 1; s < 3; s++) { const d = s === 1 ? -1 : 1; rel[s] = Math.pow(2, d * cents / 1200); sg[s] = d; ph[s] = c + d * g; ph[s] -= Math.floor(ph[s]); am[s] = 0.3 + 0.12 * ens; }
            late = Math.round((0.004 + 0.03 * ens) * (0.6 + 0.4 * (r() + 1)) * sr);
            // effort: louder is flatter (brighter) at the source
            mix = 0.02 + 0.92 * v * v;
            const atk = P.attack * (1.4 - 0.8 * v);
            ka = 1 - coef(Math.max(0.004, atk) / 2.2, sr / 16);
            vph = (r() + 1) / 2; vdt = (5.1 + 0.4 * (r() + 1)) * 16 / sr; vib = 0; vOn = 0.3 + 0.2 * (r() + 1);
            jit = 1 + 0.03 * r();
            for (let k = 0; k < 5; k++) { s1[k] = 0; s2[k] = 0; }
            b1 = 0; b2 = 0; t1 = 0; t2 = 0;
            vowel(P.vowel); lastV = P.vowel;
            const C = CONS[ons];
            for (let k = 0; k < 15; k++) cur[k] = C ? C[k] : fv[k];
            setF();
            cg = ons ? CT[ons][2] : 1;
            burst = ons === 2 ? 0.5 * (0.5 + 0.5 * v) : 0; kb = coef(0.006, sr); by = 0;
            // seating: low voices to the right, high to the left
            const pg = panLR(clamp((60 - p) / 30, -1, 1) * 0.45); pan0 = pg[0]; pan1 = pg[1];
            // level: the buzz has a harmonic every f0, so low notes put more of them through each formant
            og = 0.6 * (0.35 + 0.65 * v);
          },
          release(P) { gate = false; kr = coef(Math.max(0.03, P.release) / 4.6, sr / 16); },
          render(L, R, n, P, tt) {
            const bend = tt && tt.bend ? tt.bend : 0, mod = tt && tt.mod > 0 ? tt.mod : 0;
            const bth = P.breath, CTo = CT[ons];
            for (let c0 = 0; c0 < n;) {
              if ((cnt & 15) === 0) {
                if (gate) e += (1 - e) * ka; else e *= kr;
                alive = e;
                const secs = t / sr;
                // the consonant: held, then the slide into the vowel
                if (P.vowel !== lastV) { vowel(P.vowel); lastV = P.vowel; }
                let w = 0;
                if (ons) {
                  w = secs < CTo[0] ? 1 : clamp(1 - (secs - CTo[0]) / CTo[1], 0, 1);
                  cg = CTo[2] + (1 - CTo[2]) * (1 - w);
                }
                if (w > 0 || (cnt & 63) === 0) {
                  const C = CONS[ons];
                  for (let k = 0; k < 15; k++) cur[k] = w > 0 ? fv[k] + (C[k] - fv[k]) * w * w * (3 - 2 * w) : fv[k];
                  setF();
                }
                const va = (secs > vOn ? clamp((secs - vOn) / 0.5, 0, 1) : 0) * (P.vibrato * 28 * top8 + mod * 40);
                vib += (va - vib) * 0.03;
                vph += vdt; if (vph >= 1) vph -= 1;
                const sv = sinT(vph), fb = f0 * Math.pow(2, bend / 12);
                let top = 1;
                for (let s = 0; s < NS; s++) {
                  const f = rel[s] * Math.pow(2, vib * (s ? 0.85 * sg[s] : 1) * sv / 1200);
                  dt[s] = fb * f / sr; if (f > top) top = f;
                }
                base1 = wtBase(FLAT, fb * top * 1.02 / sr);
                nzA = bth * 0.05 * Math.pow(2, -clamp(p0 - 60, 0, 48) / 12);
              }
              const len = Math.min(16 - (cnt & 15), n - c0), end = c0 + len;
              const ee = e * cg * og, ap = t >= late ? am[1] : 0;
              let q0 = ph[0], q1 = ph[1], q2 = ph[2];
              const d0 = dt[0], d1 = dt[1], d2 = dt[2];
              for (let i = c0; i < end; i++) {
                q0 += d0; if (q0 >= 1) q0 -= 1;
                q1 += d1; if (q1 >= 1) q1 -= 1;
                q2 += d2; if (q2 >= 1) q2 -= 1;
                let x = wtRead(T1, base1, q0) + (wtRead(T1, base1, q1) + wtRead(T1, base1, q2)) * ap;
                // aspiration, and the burst of a released d
                ns = (Math.imul(ns, 1664525) + 1013904223) | 0;
                const wn = ns * 4.656612873077393e-10;
                x += wn * nzA;
                // the glottis's tilt, the low skirt, then the five formants in parallel
                { const v3 = x - t2, v1 = ta1 * t1 + ta2 * v3, v2 = t2 + ta2 * t1 + ta3 * v3; t1 = 2 * v1 - t1; t2 = 2 * v2 - t2; x = v2; }
                let y;
                { const v3 = x - b2, v1 = ba1 * b1 + ba2 * v3, v2 = b2 + ba2 * b1 + ba3 * v3; b1 = 2 * v1 - b1; b2 = 2 * v2 - b2; y = v2 * bG; }
                for (let k = 0; k < 5; k++) {
                  const u1 = s1[k], u2 = s2[k], v3 = x - u2, v1 = a1[k] * u1 + a2[k] * v3, v2 = u2 + a2[k] * u1 + a3[k] * v3;
                  s1[k] = 2 * v1 - u1; s2[k] = 2 * v2 - u2;
                  y += v1 * kg[k];
                }
                // the burst of a released d: bright noise, straight out of the mouth
                if (burst > 1e-5 && t + (i - c0) >= CTo[0] * sr) { by += (wn - by) * 0.35; y += (wn - by) * burst; burst *= kb; }
                y *= ee;
                L[i] += y * pan0; R[i] += y * pan1;
              }
              ph[0] = q0; ph[1] = q1; ph[2] = q2;
              cnt += len; t += len; c0 = end;
            }
            return gate || alive > 1e-4;
          },
          stop() { gate = false; e = 0; alive = 0; },
        };
      },
      process(L, R, n, P) {
        for (let i = 0; i < n; i++) {
          const l = L[i], r = R[i], h = hlS.next(P.hall);
          pre.write(l); preR.write(r);
          hall.tick(pre.read(0.025 * sr), preR.read(0.025 * sr));
          const OUT = 0.8, wet = h * h * 0.12 + h * 0.34;
          L[i] = knee(dcl((l * (1 - 0.3 * h) + (hall.l * 0.8 + hall.r * 0.2) * wet) * OUT));
          R[i] = knee(dcr((r * (1 - 0.3 * h) + (hall.r * 0.8 + hall.l * 0.2) * wet) * OUT));
        }
      },
    };
  },
};
`,
  ),
});
