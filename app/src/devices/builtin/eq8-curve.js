// core.eq8 (Slide Rule): its filter math, in one place. The kernel (eq8.js) runs these exact functions in the
// AudioWorklet (their source is pasted into it, EQ_SOURCE), and the device window (ui/editors/eq8.js) draws its curves
// with them, so the curve on the screen is the filter you hear, coefficient for coefficient. tools/eq-test.js holds
// the two to each other: an impulse through the kernel, measured, against eqBandPow at the same frequencies.
//
// Coefficients follow the Audio EQ Cookbook (Robert Bristow-Johnson; published by the W3C as a Note): a band is one
// to four biquad sections, each five numbers in a row, [b0, b1, b2, a1, a2], normalised by a0. Cuts are Butterworth
// cascades (12, 24 or 48 dB per octave: one, two or four sections).
//
// The functions are pure: numbers in, numbers out, no closures and nothing allocated, except the tables
// eqAutoTables makes (once, in create()). They may only call each other and Math, since they run in the worklet too.

export const EQ_BANDS = 8;
// a band's shape, as its type param holds it (b<n>_type): the index is what the kernel sees
export const EQ_TYPES = ['BELL', 'LOW SHELF', 'HIGH SHELF', 'LOW CUT 12', 'LOW CUT 24', 'LOW CUT 48', 'HIGH CUT 12', 'HIGH CUT 24', 'HIGH CUT 48', 'NOTCH', 'BAND PASS'];
// where each band is parked (its default frequency): spread across the spectrum, each over a region it is often for
export const EQ_PARK = [60, 150, 300, 700, 1500, 3000, 6000, 12000];
export const EQ_STRIDE = 20;   // numbers per band in a coefficient array: four sections of five
// the shapes, for people: a type is a shape and (for cuts) a slope
export const EQ_SHAPES = [
  { id: 'bell', label: 'Bell', types: [0] },
  { id: 'lowshelf', label: 'Low shelf', types: [1] },
  { id: 'highshelf', label: 'High shelf', types: [2] },
  { id: 'lowcut', label: 'Low cut', types: [3, 4, 5] },
  { id: 'highcut', label: 'High cut', types: [6, 7, 8] },
  { id: 'notch', label: 'Notch', types: [9] },
  { id: 'bandpass', label: 'Band pass', types: [10] },
];
export const EQ_SLOPES = [12, 24, 48];
export const shapeOf = (type) => EQ_SHAPES.find((s) => s.types.includes(type)) || EQ_SHAPES[0];
export const slopeOf = (type) => (type >= 3 && type <= 8 ? EQ_SLOPES[(type - 3) % 3] : null);
// what the gain param does on this type: bells and shelves boost or cut by it; the others don't use it
export const usesGain = (type) => type <= 2;
// the corner of a shelf or a cut takes its Q as resonance (1 flat, up to 4); a bell, a notch or a band pass as width
export const isCorner = (type) => type >= 1 && type <= 8;

// Five coefficients, normalised by a0, into out at o.
export function eqPut(out, o, b0, b1, b2, a0, a1, a2) {
  const r = 1 / a0;
  out[o] = b0 * r; out[o + 1] = b1 * r; out[o + 2] = b2 * r; out[o + 3] = a1 * r; out[o + 4] = a2 * r;
}

// The Q of section k (0-based, ascending) of an order-n Butterworth cascade: 0.7071 for n = 2; 0.5412 and 1.3066 for
// 4; 0.5098, 0.6013, 0.9000 and 2.5629 for 8.
export function eqButterQ(n, k) {
  return 0.5 / Math.cos((2 * k + 1) * Math.PI / (2 * n));
}

// One band's sections, written into out from index at; returns how many (1, 2 or 4).
//   type  0 bell, 1 low shelf, 2 high shelf, 3/4/5 low cut 12/24/48, 6/7/8 high cut 12/24/48, 9 notch, 10 band pass
//   f     its frequency in Hz (a bell's centre, a shelf's midpoint, a cut's -3 dB corner)
//   gain  dB, for the bell and the shelves (the rest don't use it)
//   q     a bell's, notch's or band pass's Q (the cookbook's); on a shelf or a cut, the resonance at its corner: 1 is
//         flat (a shelf at the cookbook's S = 1, a cut a plain Butterworth), 2 lifts the corner 6 dB, up to 4
export function eqSections(type, f, gain, q, sr, out, at) {
  const fc = f < 10 ? 10 : f > sr * 0.49 ? sr * 0.49 : f;
  const w = 2 * Math.PI * fc / sr, cw = Math.cos(w), sw = Math.sin(w);
  if (type === 0 || type === 9 || type === 10) {
    const Q = q < 0.05 ? 0.05 : q > 40 ? 40 : q, al = sw / (2 * Q);
    if (type === 0) {
      const A = Math.pow(10, gain / 40);
      eqPut(out, at, 1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A);
    } else if (type === 9) eqPut(out, at, 1, -2 * cw, 1, 1 + al, -2 * cw, 1 - al);
    else eqPut(out, at, al, 0, -al, 1 + al, -2 * cw, 1 - al);
    return 1;
  }
  const k = q < 0.1 ? 0.1 : q > 4 ? 4 : q;
  if (type === 1 || type === 2) {
    const A = Math.pow(10, gain / 40), t = 2 * Math.sqrt(A) * (sw / (2 * 0.7071067811865476 * k));
    if (type === 1) eqPut(out, at, A * ((A + 1) - (A - 1) * cw + t), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - t), (A + 1) + (A - 1) * cw + t, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - t);
    else eqPut(out, at, A * ((A + 1) + (A - 1) * cw + t), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - t), (A + 1) - (A - 1) * cw + t, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - t);
    return 1;
  }
  // a cut: a Butterworth cascade whose last (highest-Q) section takes the resonance
  const hp = type <= 5, order = type - (hp ? 3 : 6), n = order === 0 ? 2 : order === 1 ? 4 : 8, ns = n / 2;
  for (let s = 0; s < ns; s++) {
    const al = sw / (2 * eqButterQ(n, s) * (s === ns - 1 ? k : 1));
    if (hp) eqPut(out, at + 5 * s, (1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al);
    else eqPut(out, at + 5 * s, (1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al);
  }
  return ns;
}

// What a band's solo plays, from the input: the region the band works on. A bell, a notch or a band pass: a band pass
// at its frequency and Q (0.3 at the widest). A low shelf or a low cut: what lies below the corner (a low pass of the
// cut's order; 12 dB per octave for a shelf). A high shelf or a high cut: what lies above it. Returns the sections.
export function eqSoloSections(type, f, q, sr, out, at) {
  if (type === 0 || type === 9 || type === 10) return eqSections(10, f, 0, q < 0.3 ? 0.3 : q, sr, out, at);
  if (type === 1) return eqSections(6, f, 0, 1, sr, out, at);
  if (type === 2) return eqSections(3, f, 0, 1, sr, out, at);
  if (type >= 3 && type <= 5) return eqSections(type + 3, f, 0, 1, sr, out, at);
  return eqSections(type - 3, f, 0, 1, sr, out, at);
}

// |H|² of one section at angle w, given cos w, cos 2w, sin w and sin 2w.
export function eqSecPow(c, o, cw, c2w, sw, s2w) {
  const nr = c[o] + c[o + 1] * cw + c[o + 2] * c2w, ni = c[o + 1] * sw + c[o + 2] * s2w;
  const dr = 1 + c[o + 3] * cw + c[o + 4] * c2w, di = c[o + 3] * sw + c[o + 4] * s2w;
  return (nr * nr + ni * ni) / (dr * dr + di * di);
}
// |H|² of a band (its ns sections, from o).
export function eqBandPow(c, o, ns, cw, c2w, sw, s2w) {
  let p = 1;
  for (let s = 0; s < ns; s++) p *= eqSecPow(c, o + 5 * s, cw, c2w, sw, s2w);
  return p;
}

// K-weighting (ITU-R BS.1770: the shelf and the high pass a loudness meter listens through), as two sections into
// out[0..9], the same derivation as audio/measure.js kCoeffs.
export function eqKCoefs(sr, out) {
  let K = Math.tan(Math.PI * 1681.974450955533 / sr), Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  eqPut(out, 0, Vh + Vb * K / Q + K * K, 2 * (K * K - Vh), Vh - Vb * K / Q + K * K, 1 + K / Q + K * K, 2 * (K * K - 1), 1 - K / Q + K * K);
  K = Math.tan(Math.PI * 38.13547087602444 / sr); Q = 0.5003270373238773;
  eqPut(out, 5, 1, -2, 1, 1, 2 * (K * K - 1) / (1 + K / Q + K * K), (1 - K / Q + K * K) / (1 + K / Q + K * K));
}

// The tables auto gain's first guess reads, made once: m frequencies, log-spaced from 25 Hz to 16 kHz, with each
// one's angle (cos and sin, and the double angle's) at sample rate sr, and a weight: what a loudness meter hears of
// a mix there. A mix's long-term spectrum falls about 1.5 dB per octave faster than pink noise (the 4.5 dB per
// octave slope analyzers tilt by, so a typical mix reads flat), heard through K-weighting.
export function eqAutoTables(sr, m) {
  const t = { m, cw: new Float64Array(m), c2w: new Float64Array(m), sw: new Float64Array(m), s2w: new Float64Array(m), w: new Float64Array(m), sum: 0 };
  const kc = new Float64Array(10);
  eqKCoefs(sr, kc);
  for (let i = 0; i < m; i++) {
    const f = 25 * Math.pow(16000 / 25, i / (m - 1)), w = 2 * Math.PI * f / sr;
    t.cw[i] = Math.cos(w); t.c2w[i] = Math.cos(2 * w); t.sw[i] = Math.sin(w); t.s2w[i] = Math.sin(2 * w);
    t.w[i] = Math.pow(f / 1000, -0.5) * eqBandPow(kc, 0, 2, t.cw[i], t.c2w[i], t.sw[i], t.s2w[i]);   // (-1.5 dB an octave)
    t.sum += t.w[i];
  }
  return t;
}
// Auto gain's first guess: the trim, in dB, that puts a mix's loudness back where it was: -10 log10 of the weighted
// mean of the curve's power over the tables (clamped to ±24 dB). The kernel starts from it (instant, so a move is
// judged at the same level at once) and then corrects it, slowly, by what it measures (eq8.js). c holds every band's
// sections (EQ_STRIDE numbers per band), ns how many each has, on which bands count (1 or 0), nb how many bands.
export function eqAutoGainDb(c, ns, on, nb, t) {
  let acc = 0;
  for (let i = 0; i < t.m; i++) {
    let p = 1;
    for (let b = 0; b < nb; b++) if (on[b] && ns[b]) p *= eqBandPow(c, b * 20, ns[b], t.cw[i], t.c2w[i], t.sw[i], t.s2w[i]);
    acc += t.w[i] * p;
  }
  const db = acc > 0 ? -10 * Math.log10(acc / t.sum) : 0;
  return db < -24 ? -24 : db > 24 ? 24 : db;
}

// The kernel's copy: the same functions, as source.
export const EQ_SOURCE = [eqPut, eqButterQ, eqSections, eqSoloSections, eqSecPow, eqBandPow, eqKCoefs, eqAutoTables, eqAutoGainDb].map((fn) => fn.toString()).join('\n');

/* ------------------------------------------------------------------------------------------ for the window and tests */
// A band's params as numbers: { on, type, freq, gain, q }, from a params object (b<n>_*). n is 1-based.
export function bandOf(params, n) {
  const g = (k, d) => { const v = +params[`b${n}_${k}`]; return Number.isFinite(v) ? v : d; };
  return { on: g('on', 0) >= 0.5 ? 1 : 0, type: Math.round(g('type', 0)), freq: g('freq', EQ_PARK[n - 1]), gain: g('gain', 0), q: g('q', 1) };
}
// Every band's sections from a params object: { c (EQ_STRIDE per band), ns, on }.
export function eqState(params, sr, nb = EQ_BANDS) {
  const c = new Float64Array(nb * EQ_STRIDE), ns = new Int32Array(nb), on = new Uint8Array(nb);
  for (let b = 0; b < nb; b++) {
    const x = bandOf(params, b + 1);
    ns[b] = eqSections(x.type, x.freq, x.gain, x.q, sr, c, b * EQ_STRIDE);
    on[b] = x.on;
  }
  return { c, ns, on };
}
// The angle tables for a list of frequencies (Hz) at sr: { cw, c2w, sw, s2w }.
export function angles(freqs, sr) {
  const n = freqs.length, a = { cw: new Float64Array(n), c2w: new Float64Array(n), sw: new Float64Array(n), s2w: new Float64Array(n) };
  for (let i = 0; i < n; i++) { const w = 2 * Math.PI * freqs[i] / sr; a.cw[i] = Math.cos(w); a.c2w[i] = Math.cos(2 * w); a.sw[i] = Math.sin(w); a.s2w[i] = Math.sin(2 * w); }
  return a;
}
// One band's response in dB at frequency f (its own curve, on or not).
export function bandDb(st, b, f, sr) {
  const w = 2 * Math.PI * f / sr;
  const p = eqBandPow(st.c, b * EQ_STRIDE, st.ns[b], Math.cos(w), Math.cos(2 * w), Math.sin(w), Math.sin(2 * w));
  return 10 * Math.log10(Math.max(p, 1e-30));
}
// The whole EQ's response in dB at frequency f: the bands that are on, multiplied (output gain not included).
export function curveDb(st, f, sr) {
  const w = 2 * Math.PI * f / sr, cw = Math.cos(w), c2w = Math.cos(2 * w), sw = Math.sin(w), s2w = Math.sin(2 * w);
  let p = 1;
  for (let b = 0; b < st.ns.length; b++) if (st.on[b]) p *= eqBandPow(st.c, b * EQ_STRIDE, st.ns[b], cw, c2w, sw, s2w);
  return 10 * Math.log10(Math.max(p, 1e-30));
}
let autoTablesCache = null;
// Auto gain's first guess for these params at sr, in dB (eqAutoGainDb over a 48-point table, as the kernel starts from).
export function autoGainFor(params, sr) {
  if (!autoTablesCache || autoTablesCache.sr !== sr) autoTablesCache = { sr, t: eqAutoTables(sr, 48) };
  const st = eqState(params, sr);
  return eqAutoGainDb(st.c, st.ns, st.on, EQ_BANDS, autoTablesCache.t);
}
