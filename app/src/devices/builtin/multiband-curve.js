// core.multiband (Gaffer Tape): how it hears the bands, what it does to each, and how it applies that, in one place.
// The kernel (multiband.js) runs these exact functions in the AudioWorklet (their source is pasted into it, MB_SOURCE),
// and the device window (ui/editors/multiband.js) draws its curves and runs its live readouts with them, so what the
// window shows is what the kernel does, number for number. tools/multiband-test.js holds the two to each other.
//
// Hearing the bands: a Linkwitz-Riley crossover, 24 dB per octave (Linkwitz 1976): each split is two Butterworth
// 2nd-order filters in a row, so the low and high sides are 6 dB down at the corner, in phase with each other, and add
// back to an allpass. Three bands take two splits; the low band also goes through the upper corner's allpass, so all
// three stay in phase. The filters are trapezoidal state-variable filters (Zavalishin), which stay well-behaved while a
// corner moves. The crossover only feeds the detectors: the sound itself is never split.
//
// Each band's dynamics (mbStep): a level detector (the band's mean square through two one-poles, read as a sine's
// peak, and beside it the band's peak, which jumps with a hit and falls at the same speed), a static curve (the gain in
// dB for a steady level, with soft knees: Giannoulis, Massberg and Reiss 2012) and smoothing in dB. Above the downward
// threshold the band is pulled down; below the upward one it is lifted, by at most MB_RANGE dB, and the lift fades out
// under a floor so silence and hiss between notes stay where they are. The downward side follows the mean square at
// the band's attack (falling) and release (rising), and the same curve on the band's peak at the same attack, let go
// within MB_CATCH_MS: so a fast attack catches a hit's first milliseconds, and a slow one lets them through.
//
// Applying them (mbShelfCoefs, mbShelve): the three bands' gains go onto the whole sound, which is never split: the mid
// band's gain over all of it, a low shelf at the lower split for the low band's gain over the mid's, and a high shelf
// at the upper split for the high band's. Each shelf is two trapezoidal SVF shelves of half the dB each (Simper's
// form), in a row: 24 dB per octave at its steepest, halfway in dB at its split. When the three gains agree the shelves
// are flat and the sound is that gain, untouched: so at depth 0 the output is the input, sample for sample, and the
// phase only turns where the bands differ, and only as much as they differ. mbResponse is their response.
//
// The functions are pure: numbers in, numbers out, nothing allocated. They may only call each other, Math and the
// MB_ constants (which the kernel declares the same), since they run in the worklet too.

export const MB_KNEE = 6;           // dB: the width of both soft knees
export const MB_RANGE = 30;         // dB: the most the upward side lifts a band
export const MB_FLOOR_LO = -84;     // dB: below this level nothing is lifted
export const MB_FLOOR_HI = -66;     // dB: the lift fades in between MB_FLOOR_LO and here (a smoothstep)
export const MB_SPLIT = 1.5;        // the upper crossover stays at least this ratio above the lower one
export const MB_DET_MS = [7, 3.5, 1.75];   // ms: each band's level detector: a mean square through two one-poles of this
export const MB_AHEAD_MS = 5;       // ms: the look-ahead: the sound reaches its gains this long after the detectors heard it
export const MB_CATCH_MS = 10;      // ms: what the attack takes off a hit's first milliseconds is let go within this
export const MB_LIFT_MS = 1;        // ms: the lift lets go this fast as a band gets louder
export const MB_SHELF_K = 1.4142135623730951;   // the shelves' damping (Butterworth: 1 / Q, Q = 1 / sqrt 2)

// The bands, low to high, as the params name them (low_*, mid_*, high_*)
export const MB_BANDS = Object.freeze([
  Object.freeze({ id: 'low', name: 'Low', word: 'low' }),
  Object.freeze({ id: 'mid', name: 'Mid', word: 'mid' }),
  Object.freeze({ id: 'high', name: 'High', word: 'high' }),
]);

// The two crossover frequencies the kernel uses, from the params, into out: [f1, f2] in Hz. Each inside 20 Hz and
// 0.45 of the sample rate, and f2 at least MB_SPLIT times f1 (an agent may set them the wrong way round: then the upper
// one moves up out of the way).
export function mbFreqs(lo, hi, sr, out) {
  const top = sr * 0.45;
  let f1 = lo > 0 ? lo : 100, f2 = hi > 0 ? hi : 2500;
  if (f1 < 20) f1 = 20; if (f1 > top / MB_SPLIT) f1 = top / MB_SPLIT;
  if (f2 < f1 * MB_SPLIT) f2 = f1 * MB_SPLIT; if (f2 > top) f2 = top;
  out[0] = f1; out[1] = f2;
  return out;
}

// A trapezoidal state-variable filter's coefficient for a corner at f: tan(pi f / sr). The kernel's filters and the
// window's curves both use it, so the response drawn is the one heard, the bilinear transform's warping included.
export function mbG(f, sr) { return Math.tan(Math.PI * f / sr); }

// How much of a steady tone at f each band carries, into out: [low, mid, high]. The bands are in phase at every
// frequency, so these are plain magnitudes and they add up to exactly 1: a 24 dB/octave Linkwitz-Riley low pass is
// 1 / (1 + w^4) and its high pass w^4 / (1 + w^4), w the frequency over the corner (warped as the filters warp it).
export function mbWeights(f, f1, f2, sr, out) {
  const fc = f < 0 ? 0 : f > sr * 0.4999 ? sr * 0.4999 : f;
  const t = Math.tan(Math.PI * fc / sr), u = t / Math.tan(Math.PI * f1 / sr), v = t / Math.tan(Math.PI * f2 / sr);
  const u4 = u * u * u * u, v4 = v * v * v * v;
  const lp1 = 1 / (1 + u4), hp1 = u4 / (1 + u4), lp2 = 1 / (1 + v4);
  out[0] = lp1; out[1] = hp1 * lp2; out[2] = hp1 * (v4 / (1 + v4));
  return out;
}

// The static curve: the gain in dB a band applies to a steady level x (dB, read as a sine's peak: a full-scale sine is
// 0 dB) before the depth mix. Above thrD it pulls down at rD:1 (1: not at all); below thrU it lifts at rU:1 (1: not at
// all), at most MB_RANGE dB (a soft ceiling over the last knee's width), fading out under MB_FLOOR_HI and gone at
// MB_FLOOR_LO. Both knees are MB_KNEE dB wide; an upward threshold above the downward one counts as the downward one.
export function mbCurve(x, thrD, rD, thrU, rU) {
  const W = MB_KNEE;
  let g = 0;
  const sd = rD > 1 ? 1 - 1 / rD : 0;
  if (sd > 0) {
    const o = x - thrD;
    if (2 * o > W) g = -o * sd;
    else if (2 * o > -W) { const q = o + W / 2; g = -sd * q * q / (2 * W); }
  }
  const su = rU > 1 ? 1 - 1 / rU : 0;
  if (su > 0 && x > MB_FLOOR_LO) {
    const u = (thrU < thrD ? thrU : thrD) - x;
    let up = 0;
    if (2 * u > W) up = u * su;
    else if (2 * u > -W) { const q = u + W / 2; up = su * q * q / (2 * W); }
    const c0 = MB_RANGE - W;
    if (up > c0) { const t = up - c0; up = t >= 2 * W ? MB_RANGE : c0 + t - t * t / (4 * W); }
    if (x < MB_FLOOR_HI) { const s = (x - MB_FLOOR_LO) / (MB_FLOOR_HI - MB_FLOOR_LO); up *= s * s * (3 - 2 * s); }
    g += up;
  }
  return g;
}

// A band's linear gain after the depth mix: the curve's g dB (smoothed) and the band's own gain bg dB, at depth d (0: 1,
// the sound untouched .. 1 all of it). The three go onto the one unsplit sound through the shelves, so a part mix is a
// smaller gain, never a second copy beside the first: nothing combs.
export function mbMix(g, bg, d) { return 1 + d * (Math.pow(10, (g + bg) / 20) - 1); }

// A one-pole's coefficient for a time constant of ms (63% of the way in that long; 0: no smoothing)
export function mbCoef(ms, sr) { return ms > 0 ? Math.exp(-1000 / (ms * sr)) : 0; }

// The crossover over a block: X (n samples) into the low, mid and high bands B0, B1, B2 (X untouched). The corners'
// coefficients (mbG) move in a straight line from g1a to g1b and g2a to g2b across the block (the same: they stay). z
// holds the seven filters' state from zo on (14 numbers). The first split's 2nd-order low and high pass share one
// filter; a second filter on each makes them the 24 dB/octave pair; the second split works on the first's high side
// the same way; the low band then goes through the upper corner's allpass, so the three bands stay in phase.
export function mbSplit(X, n, z, zo, g1a, g1b, g2a, g2b, B0, B1, B2) {
  const k = 1.4142135623730951;   // Butterworth: Q = 1/sqrt 2
  let a1 = 1 / (1 + g1a * (g1a + k)), a2 = g1a * a1, a3 = g1a * a2;
  let b1 = 1 / (1 + g2a * (g2a + k)), b2 = g2a * b1, b3 = g2a * b2;
  const m1 = g1a !== g1b, m2 = g2a !== g2b;
  let A1 = z[zo], A2 = z[zo + 1], C1 = z[zo + 2], C2 = z[zo + 3], D1 = z[zo + 4], D2 = z[zo + 5];
  let E1 = z[zo + 6], E2 = z[zo + 7], F1 = z[zo + 8], F2 = z[zo + 9], H1 = z[zo + 10], H2 = z[zo + 11];
  let P1 = z[zo + 12], P2 = z[zo + 13];
  for (let i = 0; i < n; i++) {
    if (m1) { const g = g1a + (g1b - g1a) * (i + 1) / n; a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
    if (m2) { const g = g2a + (g2b - g2a) * (i + 1) / n; b1 = 1 / (1 + g * (g + k)); b2 = g * b1; b3 = g * b2; }
    const x = X[i];
    // the first split: low and high pass of x, then each again (24 dB/octave)
    let v3 = x - A2, v1 = a1 * A1 + a2 * v3, v2 = A2 + a2 * A1 + a3 * v3;
    A1 = 2 * v1 - A1; A2 = 2 * v2 - A2;
    const lo2 = v2, hi2 = x - k * v1 - v2;
    v3 = lo2 - C2; v1 = a1 * C1 + a2 * v3; v2 = C2 + a2 * C1 + a3 * v3;
    C1 = 2 * v1 - C1; C2 = 2 * v2 - C2;
    const low = v2;
    v3 = hi2 - D2; v1 = a1 * D1 + a2 * v3; v2 = D2 + a2 * D1 + a3 * v3;
    D1 = 2 * v1 - D1; D2 = 2 * v2 - D2;
    const rest = hi2 - k * v1 - v2;
    // the second split, on the rest
    v3 = rest - E2; v1 = b1 * E1 + b2 * v3; v2 = E2 + b2 * E1 + b3 * v3;
    E1 = 2 * v1 - E1; E2 = 2 * v2 - E2;
    const lo3 = v2, hi3 = rest - k * v1 - v2;
    v3 = lo3 - F2; v1 = b1 * F1 + b2 * v3; v2 = F2 + b2 * F1 + b3 * v3;
    F1 = 2 * v1 - F1; F2 = 2 * v2 - F2;
    B1[i] = v2;
    v3 = hi3 - H2; v1 = b1 * H1 + b2 * v3; v2 = H2 + b2 * H1 + b3 * v3;
    H1 = 2 * v1 - H1; H2 = 2 * v2 - H2;
    B2[i] = hi3 - k * v1 - v2;
    // the low band through the upper corner's allpass (what the second split does to the rest's phase)
    v3 = low - P2; v1 = b1 * P1 + b2 * v3; v2 = P2 + b2 * P1 + b3 * v3;
    P1 = 2 * v1 - P1; P2 = 2 * v2 - P2;
    B0[i] = low - 2 * k * v1;
  }
  z[zo] = A1; z[zo + 1] = A2; z[zo + 2] = C1; z[zo + 3] = C2; z[zo + 4] = D1; z[zo + 5] = D2;
  z[zo + 6] = E1; z[zo + 7] = E2; z[zo + 8] = F1; z[zo + 9] = F2; z[zo + 10] = H1; z[zo + 11] = H2;
  z[zo + 12] = P1; z[zo + 13] = P2;
  // (a long silence decays the state toward subnormals: flush them)
  for (let j = zo; j < zo + 14; j++) if (z[j] < 1e-25 && z[j] > -1e-25) z[j] = 0;
}

// One band's dynamics for one sample. e: the band's power this sample (the louder channel's square). s: the band's
// state from o on (6 numbers: the detector's two one-poles, its peak, the downward gain, the lift, the onset's gain).
// thrD, rD, thrU, rU: the curve; cA, cR: the attack and release (mbCoef), cD: the detector's, cC: MB_CATCH_MS's, cL:
// MB_LIFT_MS's. Returns the band's gain in dB from the curve, smoothed (before the band's own gain and the depth).
//   The downward side follows the mean square: at the attack as its gain falls, the release as it rises. Beside it the
// same curve on the band's peak (which jumps with a hit and falls at the detector's speed) falls at the attack too but
// is let go within MB_CATCH_MS: a fast attack catches a hit's first milliseconds without holding the body down for the
// whole release, and a slow attack lets them through. The lift reads the louder of the two, lets go within MB_LIFT_MS
// (so nothing jumps out of a quiet spot) and comes back at the release. Held still, the sum is the curve (mbCurve with
// both ratios): a steady tone's peak and mean square read the same.
// sd, su (optional): Gaffer Tape's DOWNWARD and UPWARD (1 = 100%): the downward side's dB and the lift's dB are scaled
// by them, the classic three-band plugin's two big knobs (the lift still at most MB_RANGE). Left out, or both 1, the arithmetic is exactly what it was before they existed.
export function mbStep(e, s, o, thrD, rD, thrU, rU, cA, cR, cD, cC, cL, sd, su) {
  let m1 = e + (s[o] - e) * cD;
  if (m1 < 1e-30) m1 = 0;
  s[o] = m1;
  let m = m1 + (s[o + 1] - m1) * cD;
  if (m < 1e-30) m = 0;
  s[o + 1] = m;
  let p = s[o + 2] * cD;
  if (e > p) p = e;
  if (p < 1e-30) p = 0;
  s[o + 2] = p;
  const ms = 2 * m, x = 4.342944819032518 * Math.log(ms + 1e-30), xp = p > ms ? 4.342944819032518 * Math.log(p + 1e-30) : x;
  const td = mbCurve(x, thrD, rD, thrU, 1), d0 = s[o + 3];
  let gd = td + (d0 - td) * (td < d0 ? cA : cR);
  if (gd < 1e-12 && gd > -1e-12) gd = 0;
  s[o + 3] = gd;
  const tc = xp === x ? td : mbCurve(xp, thrD, rD, thrU, 1), c0 = s[o + 5];
  let gc = tc + (c0 - tc) * (tc < c0 ? cA : cC);
  if (gc < 1e-12 && gc > -1e-12) gc = 0;
  s[o + 5] = gc;
  const tu = mbCurve(xp, thrD, 1, thrU, rU), u0 = s[o + 4];
  let gu = tu + (u0 - tu) * (tu < u0 ? cL : cR);
  if (gu < 1e-12) gu = 0;
  s[o + 4] = gu;
  if (sd === undefined || (sd === 1 && su === 1)) return (gc < gd ? gc : gd) + gu;
  const lift = gu * su;
  return (gc < gd ? gc : gd) * sd + (lift > MB_RANGE ? MB_RANGE : lift);
}

// The shelves' coefficients for the three bands' linear gains gl, gm, gh (after the depth: mbMix), into co (12
// numbers). c1, c2: mbG of the two splits. Each shelf is two stages of half its dB; a stage of linear gain r has
// A = sqrt r (Simper: A = 10^(dB / 40)), its corner moved by sqrt A so the shelf is halfway in dB at the split.
export function mbShelfCoefs(gl, gm, gh, c1, c2, co) {
  const k = MB_SHELF_K;
  let r = Math.sqrt(gl / gm), A = Math.sqrt(r), g = c1 / Math.sqrt(A);
  let a1 = 1 / (1 + g * (g + k));
  co[0] = a1; co[1] = g * a1; co[2] = g * g * a1; co[3] = k * (A - 1); co[4] = r - 1;
  r = Math.sqrt(gh / gm); A = Math.sqrt(r); g = c2 * Math.sqrt(A);
  a1 = 1 / (1 + g * (g + k));
  co[5] = a1; co[6] = g * a1; co[7] = g * g * a1; co[8] = r; co[9] = k * (1 - A) * A; co[10] = 1 - r;
  co[11] = gm;
  return co;
}

// One sample x through the shelves (co: mbShelfCoefs; s: their state from o on, 8 numbers): the two low stages, the
// two high stages, then the mid band's gain. With the three gains equal the shelves are flat and this is gm * x.
export function mbShelve(x, s, o, co) {
  let y = x;
  for (let j = 0; j < 4; j++) {
    const h = j < 2 ? 0 : 5, i1 = s[o + 2 * j], i2 = s[o + 2 * j + 1];
    const v3 = y - i2, v1 = co[h] * i1 + co[h + 1] * v3, v2 = i2 + co[h + 1] * i1 + co[h + 2] * v3;
    s[o + 2 * j] = 2 * v1 - i1; s[o + 2 * j + 1] = 2 * v2 - i2;
    y = j < 2 ? y + co[3] * v1 + co[4] * v2 : co[8] * y + co[9] * v1 + co[10] * v2;
  }
  return co[11] * y;
}

// The shelves' response at f (Hz), as a linear gain, for the bands' linear gains gl, gm, gh and splits f1, f2: the
// analog prototype at the bilinear transform's warped frequency, which is exactly what the trapezoidal filters do.
export function mbResponse(f, f1, f2, gl, gm, gh, sr) {
  const k = MB_SHELF_K, t = Math.tan(Math.PI * (f < 0 ? 0 : f > sr * 0.4999 ? sr * 0.4999 : f) / sr);
  let mag = gm;
  for (let j = 0; j < 2; j++) {
    const r = Math.sqrt((j ? gh : gl) / gm), A = Math.sqrt(r);
    const g = j ? Math.tan(Math.PI * f2 / sr) * Math.sqrt(A) : Math.tan(Math.PI * f1 / sr) / Math.sqrt(A), w = t / g;
    const dr = 1 - w * w, di = k * w, nr = j ? 1 - r * w * w : r - w * w, ni = k * A * w;
    mag *= (nr * nr + ni * ni) / (dr * dr + di * di);
  }
  return mag;
}

// The kernel's copy: the constants, then the same functions, as source.
export const MB_SOURCE = [
  `const MB_KNEE = ${MB_KNEE}, MB_RANGE = ${MB_RANGE}, MB_FLOOR_LO = ${MB_FLOOR_LO}, MB_FLOOR_HI = ${MB_FLOOR_HI}, MB_SPLIT = ${MB_SPLIT};`,
  `const MB_DET_MS = [${MB_DET_MS.join(', ')}], MB_AHEAD_MS = ${MB_AHEAD_MS}, MB_CATCH_MS = ${MB_CATCH_MS}, MB_LIFT_MS = ${MB_LIFT_MS}, MB_SHELF_K = ${MB_SHELF_K};`,
  ...[mbFreqs, mbG, mbWeights, mbCurve, mbMix, mbCoef, mbSplit, mbStep, mbShelfCoefs, mbShelve, mbResponse].map((fn) => fn.toString()),
].join('\n');

/* ------------------------------------------------------------------------------------------ for the window and tests */
// A band's dynamics params as numbers: { thrD, rD, thrU, rU, att, rel, gain }, from a params object. b: 'low' | 'mid' | 'high'
export function bandOf(params, b) {
  const g = (k, d) => { const v = +params[`${b}_${k}`]; return Number.isFinite(v) ? v : d; };
  return { thrD: g('down_thresh', -24), rD: g('down_ratio', 4), thrU: g('up_thresh', -40), rU: g('up_ratio', 2), att: g('attack', 20), rel: g('release', 200), gain: g('gain', 0) };
}
const num = (v, d) => { const x = +v; return Number.isFinite(x) ? x : d; };
// The whole device's static transfer for a steady tone in one band, level in (dB at the device's input) to level out
// (dB at its output), with the input and output gains and the depth: what the window draws for each band
export function transfer(params, b, x) {
  const p = bandOf(params, b), gin = num(params.in_gain, 0), gout = num(params.out_gain, 0), d = Math.min(1, Math.max(0, num(params.depth, 100) / 100));
  const lv = x + gin;
  const m = mbMix(scaledCurve(params, lv, p), p.gain, d);
  return lv + 20 * Math.log10(Math.max(m, 1e-12)) + gout;
}
// The static curve with DOWNWARD and UPWARD (params.downward, params.upward, %, default 100) scaling its two sides, as
// mbStep does: at 100% each, mbCurve itself.
export function scaledCurve(params, x, p) {
  const sd = num(params.downward, 100) / 100, su = num(params.upward, 100) / 100;
  if (sd === 1 && su === 1) return mbCurve(x, p.thrD, p.rD, p.thrU, p.rU);
  const lift = mbCurve(x, p.thrD, 1, p.thrU, p.rU) * su;
  return mbCurve(x, p.thrD, p.rD, p.thrU, 1) * sd + (lift > MB_RANGE ? MB_RANGE : lift);
}
// The same at full depth (what the compressor itself does, before the dry is mixed back)
export function transferFull(params, b, x) { return transfer({ ...params, depth: 100 }, b, x); }
// The crossover frequencies for a params object at sr: [f1, f2]
export function freqsOf(params, sr) { return mbFreqs(num(params.xover_lo, 90), num(params.xover_hi, 2500), sr, [0, 0]); }
// The three bands' gains after the depth (linear: what mbShelfCoefs takes) for a steady tone at f, its level at the
// device's input (dB, a sine's peak): each band's detector hears its share of the tone (mbWeights) and answers with
// its curve. Into out ([low, mid, high]).
export function toneGains(params, f, level, sr, out = [0, 0, 0]) {
  const [f1, f2] = freqsOf(params, sr), w = mbWeights(f, f1, f2, sr, [0, 0, 0]);
  const gin = num(params.in_gain, 0), d = Math.min(1, Math.max(0, num(params.depth, 100) / 100));
  for (let i = 0; i < 3; i++) {
    const p = bandOf(params, MB_BANDS[i].id);
    const lv = level + gin + 20 * Math.log10(Math.max(w[i], 1e-30));
    out[i] = mbMix(scaledCurve(params, lv, p), p.gain, d);
  }
  return out;
}
// A tone at f through the whole device, steady: the gain in dB (the bands' gains, through the shelves at f).
// level: the tone's level at the device's input (dB, a sine's peak)
export function toneGain(params, f, level, sr) {
  const [f1, f2] = freqsOf(params, sr), g = toneGains(params, f, level, sr);
  const gin = num(params.in_gain, 0), gout = num(params.out_gain, 0);
  return gin + 20 * Math.log10(Math.max(mbResponse(f, f1, f2, g[0], g[1], g[2], sr), 1e-30)) + gout;
}
