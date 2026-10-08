// @ts-check
// Shared kernel source for batch 3 of the instrument roadmap (core.poly2, core.brass, core.choir): band-limited
// single-cycle tables and a 24 dB ladder low-pass. Like lib.js it is kernel source, prepended to each device's body,
// so a device carries its DSP with it and stays exactly as measured. (It sits beside lib.js rather than in it: a change
// to lib.js would change every other built-in's kernel, and with it their hashes.)
//
//   wavetable(amp)   one table per quarter octave, each with only the harmonics that fit under 0.42 x the sample rate
//                    at the pitches it plays, so a saw, a pulse or a glottal buzz never aliases however high it goes.
//                    amp(k) is harmonic k's amplitude in sine phase, camp(k) (optional) in cosine phase. Built once per kernel, cumulatively (about two
//                    million multiply-adds for 1000 harmonics). wtBase(W, dt) picks a table for a phase increment
//                    (cycles a sample: f / sr), wtRead(T, base, phase) reads it (linear interpolation).
//   ladder(sr)       a zero-delay-feedback 4-pole ladder low-pass (Zavalishin, "The Art of VA Filter Design", 5.x):
//                    four trapezoidal one-poles, the feedback solved exactly, the input stage saturated, and the
//                    passband loss half made up as the resonance rises (so a resonant patch loses about 4 dB, not 14).
//                    At RESO 1 (k about 4.1) it sings on its own at the cutoff, held by the saturation.
export const TABLES = String.raw`
const WT_N = 2048, WT_M = 2047, WT_S = WT_N + 1;
function wavetable(amp, camp) {
  const K = [];
  for (let j = 0; ; j++) { const k = Math.max(1, Math.floor(1000 * Math.pow(2, -j / 4))); K.push(k); if (k === 1) break; }
  const S = new Float64Array(WT_N); for (let i = 0; i < WT_N; i++) S[i] = Math.sin(TAU * i / WT_N);
  const T = new Float32Array(K.length * WT_S), acc = new Float64Array(WT_N);
  let done = 0;
  for (let j = K.length - 1; j >= 0; j--) {
    for (let k = done + 1; k <= K[j]; k++) {
      const a = amp(k), c = camp ? camp(k) : 0;
      if (a) for (let i = 0; i < WT_N; i++) acc[i] += a * S[(k * i) & WT_M];
      if (c) for (let i = 0; i < WT_N; i++) acc[i] += c * S[(k * i + WT_N / 4) & WT_M];
    }
    done = K[j];
    const b = j * WT_S; for (let i = 0; i < WT_N; i++) T[b + i] = acc[i]; T[b + WT_N] = acc[0];
  }
  return { T, K: Int32Array.from(K), n: K.length };
}
// the table for a phase increment: the richest whose top harmonic stays under 0.42 x sr
function wtBase(W, dt) {
  const kmax = 0.42 / Math.max(1e-9, dt);
  let j = Math.min(W.n - 1, Math.max(0, Math.ceil(4 * Math.log2(1000 / Math.max(1, kmax))) - 1));
  while (j < W.n - 1 && W.K[j] > kmax) j++;
  return j * WT_S;
}
const wtRead = (T, b, ph) => { const x = ph * WT_N, i = x | 0, a = T[b + i]; return a + (T[b + i + 1] - a) * (x - i); };

function ladder(sr) {
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, G = 0, gi = 1, k = 0, comp = 1, G4 = 0, den = 1, c1 = 0, c2 = 0, c3 = 0, c4 = 0, cx = 0;
  const f = {
    set(fc, res) {
      const g = Math.tan(Math.PI * clamp(fc, 10, sr * 0.45) / sr);
      G = g / (1 + g); gi = 1 / (1 + g); k = res; comp = 1 + 0.5 * res; G4 = G * G * G * G; den = 1 / (1 + k * G4);
      c1 = G * G * G * gi * den; c2 = G * G * gi * den; c3 = G * gi * den; c4 = gi * den; cx = G4 * comp * den;
      return f;
    },
    tick(x) {
      const y4 = cx * x + c1 * s1 + c2 * s2 + c3 * s3 + c4 * s4;
      const u = sat(x * comp - k * y4);
      let v = (u - s1) * G; const y1 = v + s1; s1 = y1 + v;
      v = (y1 - s2) * G; const y2 = v + s2; s2 = y2 + v;
      v = (y2 - s3) * G; const y3 = v + s3; s3 = y3 + v;
      v = (y3 - s4) * G; const y = v + s4; s4 = y + v;
      return y;
    },
    reset() { s1 = s2 = s3 = s4 = 0; },
  };
  return f;
}
`;
