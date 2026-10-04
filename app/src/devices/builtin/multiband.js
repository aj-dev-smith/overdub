// core.multiband: Gaffer Tape. The three-band compressor producers put on everything: each band lifts its quiet detail
// up (upward compression, below one threshold) and holds its loud peaks down (downward compression, above another),
// then one DEPTH knob mixes it in. On a synth, a drum bus or a vocal it makes the sound loud, dense and finished.
// The design note, with sources and what was measured, is docs/research/MULTIBAND.md; its window is
// ui/editors/multiband.js (editor: 'multiband').
//
// The signal path: INPUT gain; then two paths. The detectors: a Linkwitz-Riley crossover (24 dB per octave) into low,
// mid and high bands at LOW-MID SPLIT and MID-HIGH SPLIT, and in each band a level detector (a mean square through two
// one-poles of 7, 3.5 or 1.75 ms, low to high, and the band's peak beside it), the static curve (downward above
// <band>_down_thresh at <band>_down_ratio, upward below <band>_up_thresh at <band>_up_ratio, both soft, the lift at
// most 30 dB and fading out under about -70 dB) and the gains smoothed in dB (the downward side at <band>_attack as it
// falls and <band>_release as it rises, and on the band's peak at the attack, let go within 10 ms, so a fast attack
// catches a hit's front; the lift lets go within a millisecond and comes back at <band>_release; TIME scales attack and
// release), then <band>_gain, and DEPTH mixing each band's gain toward 0 dB. The sound: the input, 5 ms behind the
// detectors (the look-ahead, so a gain is in place when what asked for it arrives), never split: the mid band's gain on
// all of it, a low shelf at LOW-MID SPLIT for the low band's and a high shelf at MID-HIGH SPLIT for the high band's
// (each two trapezoidal SVF shelves, 24 dB per octave at their steepest); OUTPUT gain; then a safety ceiling on the
// whole output. The crossover, the dynamics and the shelves are multiband-curve.js, pasted into the kernel as source
// and imported by the window, so the window draws and reads what it does.
//
// Why shelves and not the crossover's bands: a crossover's bands add back to an allpass, whose phase turn near the
// splits rebuilds peaks that an instrument's safety knee had rounded off (+4.5 dB of true peak on Studio A, +5.9 dB
// on Gobo Kit, at depth 0, in the version before). The shelves are flat when the three gains agree, so at depth 0 the
// output is the input, sample for sample, and the phase only turns where the bands' gains differ.
//
// The safety ceiling: a look-ahead true-peak limiter (Red Line's method, core.limiter: the peaks between samples
// estimated 4x, a 1.5 ms look-ahead, a smooth ramp) holding everything it puts out at -1 dBTP, at any setting. It lets
// go of a short over within about 10 ms (a hit's front) and of a long one over 150 ms (a held bass note), so it shaves
// a transient without pulling the body after it down. The look-ahead and the ceiling cost 6.8 ms of latency (328
// samples at 48 kHz), declared, which the studio compensates. The On switch is the true bypass.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { MB_SOURCE, MB_BANDS, transfer } from './multiband-curve.js';

// a ratio reads as a ratio: "4.0:1", "20:1"
const ratioText = (v) => `${+v < 9.95 ? (+v).toFixed(1) : Math.round(+v)}:1`;
const WHAT = {
  low: 'the low band (under LOW-MID SPLIT: kick and bass weight)',
  mid: 'the mid band (between the splits: the body of most parts)',
  high: 'the high band (over MID-HIGH SPLIT: presence, attack and air)',
};
const N = { low: 'LOW', mid: 'MID', high: 'HIGH' };
// The classic, each band's numbers (set by measurement on the house's test signals and drum parts:
// docs/research/MULTIBAND.md): every band lifted hard toward its upward threshold and coming back quickly after each
// hit, so the room, the tails and the quiet detail come up; held gently at the top; made up a little. All of it (Full
// depth) is louder and denser; the defaults are these at 40% depth, within a decibel of bypass.
//            down thresh, down ratio, up thresh, up ratio, attack, release, gain
const CLASSIC = {
  low: [-4, 3, -26, 6, 20, 60, 2],
  mid: [-8, 3, -24, 6, 10, 50, 1.5],
  high: [-14, 3, -32, 6, 5, 40, 2],
};
const params = [];
for (const B of MB_BANDS) {
  const b = B.id, U = N[b], group = B.name, face = false, [dt, dr, ut, ur, at, rl, gn] = CLASSIC[b];
  params.push(
    { key: `${b}_down_thresh`, label: `${U} DOWN THRESH`, min: -60, max: 0, def: dt, unit: 'dB', role: 'level', group, face,
      desc: `${WHAT[b]}: above this level it is pulled down at ${U} DOWN RATIO. Lower it to hold more of the band down; 0 dB leaves it alone` },
    { key: `${b}_down_ratio`, label: `${U} DOWN RATIO`, min: 1, max: 50, def: dr, curve: 'log', unit: 'x', role: 'depth', group, face, fmt: ratioText,
      desc: `how hard the ${B.word} band's loud parts are held down above ${U} DOWN THRESH: 1 none, 2-4 gentle, 10 and up a wall` },
    { key: `${b}_up_thresh`, label: `${U} UP THRESH`, min: -70, max: 0, def: ut, unit: 'dB', role: 'level', group, face,
      desc: `${WHAT[b]}: below this level it is lifted at ${U} UP RATIO, by at most 30 dB (nothing under about -70 dB is lifted, so silence stays silent). Raise it to bring more quiet detail up; it never sits above ${U} DOWN THRESH` },
    { key: `${b}_up_ratio`, label: `${U} UP RATIO`, min: 1, max: 20, def: ur, curve: 'log', unit: 'x', role: 'depth', group, face, fmt: ratioText,
      desc: `how hard the ${B.word} band's quiet parts are lifted toward ${U} UP THRESH: 1 none, 2 half the way, 4 most of it` },
    { key: `${b}_attack`, label: `${U} ATTACK`, min: 0.1, max: 300, def: at, curve: 'log', unit: 'ms', role: 'attack', group, face,
      desc: `how fast the ${B.word} band reacts as it gets louder: fast (under 5 ms) catches a hit's front (it hears 5 ms ahead) and flattens transients; slower (20-60 ms) lets a hit's front through before it clamps, which is punchier` },
    { key: `${b}_release`, label: `${U} RELEASE`, min: 5, max: 3000, def: rl, curve: 'log', unit: 'ms', role: 'release', group, face,
      desc: `how fast the ${B.word} band lets go as it gets quieter: fast (under 80 ms) is louder and more breathless, slow (300 ms and up) smoother` },
    { key: `${b}_gain`, label: `${U} GAIN`, min: -24, max: 24, def: gn, unit: 'dB', role: 'level', group, face,
      desc: `the ${B.word} band's level after its compression: makeup for what it holds down, or a tilt between the bands` },
  );
}
params.push(
  { key: 'xover_lo', label: 'LOW-MID SPLIT', min: 30, max: 1000, def: 120, curve: 'log', unit: 'Hz', role: 'tone', group: 'Crossover', face: false,
    desc: 'where the low band ends and the mid band starts (24 dB per octave): 80-150 Hz keeps the kick and bass on their own' },
  { key: 'xover_hi', label: 'MID-HIGH SPLIT', min: 600, max: 16000, def: 2500, curve: 'log', unit: 'Hz', role: 'tone', group: 'Crossover', face: false,
    desc: 'where the mid band ends and the high band starts; always at least 1.5 times LOW-MID SPLIT (it moves up out of the way)' },
  { key: 'depth', label: 'DEPTH', min: 0, max: 100, def: 40, unit: '%', role: 'mix', group: 'Main',
    desc: 'how much of the compressed sound you hear, the main control: 0% is the dry sound, untouched; 20-40% adds density and detail; 100% is the full, dense sound, and the louder for it' },
  { key: 'in_gain', label: 'INPUT', min: -12, max: 12, def: 0, unit: 'dB', role: 'drive', group: 'Main',
    desc: 'the level into it: more pushes every band harder against its thresholds (more squash, more lift); the dry part comes up too' },
  { key: 'out_gain', label: 'OUTPUT', min: -12, max: 12, def: 0, unit: 'dB', role: 'level', group: 'Main',
    desc: 'the level out, after everything; a safety ceiling then holds everything it puts out at -1 dBTP, at any setting' },
  { key: 'time', label: 'TIME', min: 10, max: 1000, def: 100, curve: 'log', unit: '%', role: 'time', group: 'Main',
    desc: 'scales every attack and release together: under 100% everything reacts faster (more aggressive, more pumping), over 100% slower (smoother, more of each attack gets through)' },
);

// presets: each is the whole sound; params left out take their defaults
const band = (b, [downThresh, downRatio, upThresh, upRatio, attack, release, gain]) => ({
  [`${b}_down_thresh`]: downThresh, [`${b}_down_ratio`]: downRatio, [`${b}_up_thresh`]: upThresh, [`${b}_up_ratio`]: upRatio,
  [`${b}_attack`]: attack, [`${b}_release`]: release, [`${b}_gain`]: gain,
});
// (set by measurement on the house's test signals and drum parts: docs/research/MULTIBAND.md. Full depth, Drum smash and
// Vocal presence come out 1 to 3 LU louder on drums, the crest factor down; the others within about a decibel)
export const PRESETS = [
  { name: 'Full depth', blurb: 'The classic, all of it: the room, the tails and the quiet detail brought right up, the peaks held, half a decibel up',
    params: { depth: 100, out_gain: 0.5 } },
  { name: 'Glue (bus)', blurb: 'Gentle on a bus: low ratios, slow attacks, the quiet parts lifted a little, about half in',
    params: { ...band('low', [-12, 1.5, -24, 3, 60, 125, 2]), ...band('mid', [-14, 1.5, -22, 3, 40, 100, 0.5]), ...band('high', [-18, 1.5, -44, 3, 20, 80, 0.5]), depth: 60 } },
  { name: 'Drum smash', blurb: 'The kick held hard and fast, the room and the tails pulled right up, the click pulled back: loud, roomy drums',
    params: { ...band('low', [-6, 30, -20, 6, 4, 45, 4]), ...band('mid', [-2, 4, -18, 6, 1.5, 40, 3]), ...band('high', [-4, 4, -42, 6, 0.5, 30, -6]), xover_lo: 110, xover_hi: 3000, depth: 80, time: 80 } },
  { name: 'Vocal presence', blurb: 'The lows steady; the mids and highs lifted hard and quick to come back, so every word and breath is up front',
    params: { ...band('low', [-6, 1.2, -38, 2, 70, 100, 3]), ...band('mid', [-2, 4, -16, 6, 30, 40, 1]), ...band('high', [-10, 2, -28, 6, 15, 30, 2]), xover_lo: 150, xover_hi: 3000, depth: 70 } },
  { name: 'Bass tighten', blurb: 'The low end evened out: each note\'s tail lifted toward its front, the fizz above it pulled back a little',
    params: { ...band('low', [-4, 2, -24, 4, 45, 80, 2]), ...band('mid', [-4, 2, -18, 4, 30, 80, 1]), ...band('high', [-6, 2, -60, 1, 15, 60, -3]), xover_lo: 100, xover_hi: 1800, depth: 70 } },
  { name: 'Subtle 30%', blurb: 'The classic at 30%: density and detail, the dynamics still there',
    params: { depth: 30 } },
];

// what the library page plays it at (app/library.html: def.demo)
const demo = { params: { ...PRESETS[2].params } };

// One line for get_project (core/project.js summarize): each band's curve in words, the splits, the depth
const r1 = (x) => Math.round(x * 10) / 10;
const dbs = (x) => `${x > 0 ? '+' : ''}${r1(x)} dB`;
const hzs = (f) => (f >= 1000 ? `${r1(f / 1000)} kHz` : `${Math.round(f)} Hz`);
const DEFAULTS = Object.fromEntries(params.map((p) => [p.key, p.def]));
export function describe(values = {}) {
  const v = { ...DEFAULTS, ...values };
  const bandText = (B) => {
    const k = (s) => +v[`${B.id}_${s}`];
    return `${B.word}: down above ${dbs(k('down_thresh'))} at ${ratioText(k('down_ratio'))}, up below ${dbs(k('up_thresh'))} at ${ratioText(k('up_ratio'))}, attack ${r1(k('attack'))} ms, release ${Math.round(k('release'))} ms, gain ${dbs(k('gain'))}`;
  };
  return `depth ${Math.round(+v.depth)}%, splits at ${hzs(+v.xover_lo)} and ${hzs(+v.xover_hi)}; ${MB_BANDS.map(bandText).join('; ')}; input ${dbs(+v.in_gain)}, output ${dbs(+v.out_gain)}, time ${Math.round(+v.time)}%`;
}

// The face's screen in the rack (ui/faces.js): each band's transfer curve, low to high, drawn with the window's own
// function (multiband-curve.js transfer). Called with a 2D context already scaled to CSS pixels, its size and the params.
function screen(g, { w, h, ink, dim }, values) {
  const v = { ...DEFAULTS, ...values };
  const pad = 6, gap = 10, cw = (w - 2 * pad - 2 * gap) / 3, ch = h - 2 * pad, lo = -60, hi = 0;
  MB_BANDS.forEach((B, i) => {
    const x0 = pad + i * (cw + gap), y0 = pad;
    const X = (db) => x0 + (db - lo) / (hi - lo) * cw, Y = (db) => y0 + ch - (Math.max(lo, Math.min(hi + 6, db)) - lo) / (hi + 6 - lo) * ch;
    g.strokeStyle = dim; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(lo), Y(lo)); g.lineTo(X(hi), Y(hi)); g.stroke();
    g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath();
    for (let k = 0; k <= 40; k++) { const db = lo + (hi - lo) * k / 40, y = Y(transfer(v, B.id, db)); if (k) g.lineTo(X(db), y); else g.moveTo(X(db), y); }
    g.stroke();
  });
}

export default defineDevice({
  id: 'core.multiband', name: 'Gaffer Tape', kind: 'effect', cat: 'dynamics', by: 'overdub',
  blurb: 'Three bands: quiet detail lifted, peaks held, one depth',
  nod: 'the aggressive three-band upward and downward compression producers put on synths, drum buses and vocals',
  editor: 'multiband',
  screen,
  describe,
  params,
  presets: PRESETS,
  demo,
  // gaffer tape, the fluorescent pink kind that marks the stage, written on in black marker
  look: { color: '#ec5a96', ink: '#1d1216', shape: 'rack', finish: 'flat', knob: 'black', label: 'script', led: '#ffe3ef' },
  latency: 328 / 48000, tail: 0.1,
  kernel: kernel(String.raw`
// The detectors' crossover, the dynamics and the shelves (devices/builtin/multiband-curve.js): the same functions the
// device window draws and reads with.
${MB_SOURCE}
const BANDS = ['low', 'mid', 'high'];
return {
  create({ sr }) {
    const KEYS = BANDS.map((b) => [b + '_down_thresh', b + '_down_ratio', b + '_up_thresh', b + '_up_ratio', b + '_attack', b + '_release', b + '_gain']);
    // the detectors' crossover: seven filters a channel, and each band's samples for the block
    const zL = new Float64Array(14), zR = new Float64Array(14), fr = new Float64Array(2);
    let cap = 128, BL = [0, 1, 2].map(() => new Float64Array(cap)), BR = [0, 1, 2].map(() => new Float64Array(cap));
    let g1 = 0, g2 = 0, first = true;
    // each band: its dynamics (mbStep's six numbers), its own gain (glided), its gain after the depth, the block's
    // settings: the thresholds and ratios glide a sample at a time toward the block's (the host moves a param in
    // block-sized steps, and a lift let go within a millisecond would follow each one)
    const S = new Float64Array(18), bg = new Float64Array(3), M = new Float64Array(3);
    const tD = new Float64Array(3), rDn = new Float64Array(3), tU = new Float64Array(3), rUp = new Float64Array(3);
    const tDT = new Float64Array(3), rDnT = new Float64Array(3), tUT = new Float64Array(3), rUpT = new Float64Array(3);
    const cA = new Float64Array(3), cR = new Float64Array(3), bgT = new Float64Array(3);
    const cD = [mbCoef(MB_DET_MS[0], sr), mbCoef(MB_DET_MS[1], sr), mbCoef(MB_DET_MS[2], sr)];
    const cC = mbCoef(MB_CATCH_MS, sr), cL = mbCoef(MB_LIFT_MS, sr);
    // the look-ahead: the sound waits LB samples for its gains (a ring a channel); then the shelves (eight numbers a
    // channel) and their coefficients
    const LB = Math.max(1, Math.round(MB_AHEAD_MS * sr / 1000));
    const xL = new Float64Array(LB), xR = new Float64Array(LB), sL = new Float64Array(8), sR = new Float64Array(8), co = new Float64Array(12);
    let xp = 0, c1 = 0, c2 = 0;
    // input, output and depth glide (12 ms), so a knob turned never steps
    const kS = 1 - Math.exp(-1 / (0.012 * sr));
    let gin = 1, gout = 1, dep = 0;
    // the safety ceiling: a look-ahead true-peak limiter at -1 dBTP (Red Line's method). The peak around the sample T
    // back is estimated with a 3-phase windowed-sinc interpolator over the last 2T samples (the meter's: audio/measure.js);
    // the gain is the sliding minimum of what each peak needs, smoothed by two moving averages (a triangle) so it bends
    // into a peak instead of stepping. It lets go in two ways at once: within 10 ms, and over 150 ms as far as the last
    // 30 ms of its work asks, so a short over (a hit's front) is shaved without pulling down what follows, and a long
    // one (a held bass note) is held steady instead of rippling
    const T = 16, i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / 2 / k) * (x / 2 / k); s += t; } return s; };
    const PH = [0.25, 0.5, 0.75].map((f) => {
      const row = new Float64Array(2 * T); let sum = 0;
      for (let j = 0; j < 2 * T; j++) { const t = j - (T - 1) - f, u = t / (T + 0.5), w = Math.abs(u) >= 1 ? 0 : i0(8 * Math.sqrt(1 - u * u)) / i0(8); row[j] = (Math.abs(t) < 1e-9 ? 0.94 : Math.sin(Math.PI * 0.94 * t) / (Math.PI * t)) * w; sum += row[j]; }
      for (let j = 0; j < 2 * T; j++) row[j] /= sum;
      return row;
    });
    // (the most any phase can raise a peak: a window quieter than CEIL / GMAX can't go over, and skips the estimate)
    let GMAX = 1;
    for (const row of PH) { let s = 0; for (let j = 0; j < 2 * T; j++) s += Math.abs(row[j]); if (s > GMAX) GMAX = s; }
    const CEIL = Math.pow(10, -1.1 / 20), RF = Math.exp(-1 / (0.01 * sr)), AS = Math.exp(-1 / (0.03 * sr)), RS = Math.exp(-1 / (0.15 * sr));
    const hl = new Float64Array(4 * T), hr = new Float64Array(4 * T); let hp = 0;
    const LA = Math.max(8, Math.round(0.0015 * sr) & ~1), H = LA / 2 + 1, W = 2 * H - 1, D = W - 1 + T;
    const dlL = new Float64Array(D + 1), dlR = new Float64Array(D + 1); let dw = 0;
    const qv = new Float64Array(W + 2), qi = new Float64Array(W + 2);
    let qh = 0, qt = 0, qn = 0, idx = 0;
    const b1 = new Float64Array(H).fill(1), b2 = new Float64Array(H).fill(1);
    let s1 = H, s2 = H, p1 = 0, p2 = 0, fast = 1, slow = 1, tick = 0;
    let wL = new Float64Array(cap), wR = new Float64Array(cap);
    return {
      latency: LB + D,
      process(L, R, n, P) {
        if (n > cap) { cap = n; BL = [0, 1, 2].map(() => new Float64Array(cap)); BR = [0, 1, 2].map(() => new Float64Array(cap)); wL = new Float64Array(cap); wR = new Float64Array(cap); }
        // the block's settings
        const tm = P.time / 100;
        for (let b = 0; b < 3; b++) {
          const k = KEYS[b];
          tDT[b] = P[k[0]]; rDnT[b] = P[k[1]]; tUT[b] = P[k[2]]; rUpT[b] = P[k[3]];
          cA[b] = mbCoef(P[k[4]] * tm, sr); cR[b] = mbCoef(P[k[5]] * tm, sr); bgT[b] = P[k[6]];
          if (first) { bg[b] = bgT[b]; tD[b] = tDT[b]; rDn[b] = rDnT[b]; tU[b] = tUT[b]; rUp[b] = rUpT[b]; }
        }
        const ginT = Math.pow(10, P.in_gain / 20), goutT = Math.pow(10, P.out_gain / 20), depT = P.depth / 100;
        if (first) { gin = ginT; gout = goutT; dep = depT; }
        mbFreqs(P.xover_lo, P.xover_hi, sr, fr);
        const g1b = mbG(fr[0], sr), g2b = mbG(fr[1], sr);
        if (first) { g1 = g1b; g2 = g2b; c1 = g1b; c2 = g2b; }
        // the input gain, then the detectors' crossover (the bands of each channel for the whole block)
        for (let i = 0; i < n; i++) { gin += (ginT - gin) * kS; L[i] *= gin; R[i] *= gin; }
        mbSplit(L, n, zL, 0, g1, g1b, g2, g2b, BL[0], BL[1], BL[2]);
        mbSplit(R, n, zR, 0, g1, g1b, g2, g2b, BR[0], BR[1], BR[2]);
        // each sample: the bands' gains from what the detectors hear now (each band's own gain glided, then the depth);
        // the sound from LB samples ago through the shelves at those gains (their splits glide a sample at a time)
        let wmax = 0;
        for (let i = 0; i < n; i++) {
          dep += (depT - dep) * kS;
          for (let b = 0; b < 3; b++) {
            const l = BL[b][i], r = BR[b][i], ll = l * l, rr = r * r;
            tD[b] += (tDT[b] - tD[b]) * kS; rDn[b] += (rDnT[b] - rDn[b]) * kS; tU[b] += (tUT[b] - tU[b]) * kS; rUp[b] += (rUpT[b] - rUp[b]) * kS;
            const g = mbStep(ll > rr ? ll : rr, S, 6 * b, tD[b], rDn[b], tU[b], rUp[b], cA[b], cR[b], cD[b], cC, cL);
            bg[b] += (bgT[b] - bg[b]) * kS;
            M[b] = 1 + dep * (Math.exp(0.11512925464970229 * (g + bg[b])) - 1);
          }
          c1 += (g1b - c1) * kS; c2 += (g2b - c2) * kS;
          mbShelfCoefs(M[0], M[1], M[2], c1, c2, co);
          const pl = xL[xp], pr = xR[xp];
          xL[xp] = L[i]; xR[xp] = R[i]; xp = xp + 1 === LB ? 0 : xp + 1;
          gout += (goutT - gout) * kS;
          const ol = gout * mbShelve(pl, sL, 0, co), or = gout * mbShelve(pr, sR, 0, co);
          wL[i] = ol; wR[i] = or;
          const a = ol < 0 ? -ol : ol, c = or < 0 ? -or : or;
          if (a > wmax) wmax = a; if (c > wmax) wmax = c;
        }
        g1 = g1b; g2 = g2b;
        // (a long silence decays the shelves toward subnormals: flush them)
        for (let j = 0; j < 8; j++) { if (sL[j] < 1e-25 && sL[j] > -1e-25) sL[j] = 0; if (sR[j] < 1e-25 && sR[j] > -1e-25) sR[j] = 0; }
        // the safety ceiling, on the whole output, D samples on
        let hmax = 0;
        for (let j = hp + 1; j <= hp + 2 * T; j++) { const a = Math.abs(hl[j]), c = Math.abs(hr[j]); if (a > hmax) hmax = a; if (c > hmax) hmax = c; }
        const quiet = (wmax > hmax ? wmax : hmax) * GMAX < CEIL;
        for (let i = 0; i < n; i++) {
          const xl = wL[i], xr = wR[i];
          hl[hp] = xl; hl[hp + 2 * T] = xl; hr[hp] = xr; hr[hp + 2 * T] = xr;
          let want = 1;
          if (!quiet) {
            // the window, oldest to newest, is hl[hp + 1 .. hp + 2T]; the peak around the two samples in its middle
            const o = hp + 1, c0 = o + T - 1, c1 = o + T;
            let pk = Math.max(Math.abs(hl[c0]), Math.abs(hl[c1]), Math.abs(hr[c0]), Math.abs(hr[c1]));
            for (let k = 0; k < 3; k++) {
              const row = PH[k]; let s = 0, u = 0;
              for (let j = 0; j < 2 * T; j++) { s += hl[o + j] * row[j]; u += hr[o + j] * row[j]; }
              if (s < 0) s = -s; if (u < 0) u = -u;
              if (s > pk) pk = s; if (u > pk) pk = u;
            }
            if (pk > CEIL) want = CEIL / pk;
          }
          hp = hp + 1 === 2 * T ? 0 : hp + 1;
          // the sliding minimum over W samples (a monotonic deque in two rings)
          while (qn > 0 && qv[(qt + W + 1) % (W + 2)] >= want) { qt = (qt + W + 1) % (W + 2); qn--; }
          qv[qt] = want; qi[qt] = idx; qt = (qt + 1) % (W + 2); qn++;
          while (qi[qh] <= idx - W) { qh = (qh + 1) % (W + 2); qn--; }
          const mn = qv[qh];
          idx++;
          // letting go: fast within 10 ms; slow follows fast down over 30 ms and comes back over 150 ms; the lower holds
          fast = Math.min(mn, 1 - (1 - fast) * RF);
          slow = fast < slow ? fast + (slow - fast) * AS : 1 - (1 - slow) * RS;
          const env = fast < slow ? fast : slow;
          s1 += env - b1[p1]; b1[p1] = env; p1 = p1 + 1 === H ? 0 : p1 + 1;
          const a1 = s1 / H;
          s2 += a1 - b2[p2]; b2[p2] = a1; p2 = p2 + 1 === H ? 0 : p2 + 1;
          if (++tick >= 4096) { tick = 0; s1 = 0; s2 = 0; for (let k = 0; k < H; k++) { s1 += b1[k]; s2 += b2[k]; } }   // (no drift)
          let gg = s2 / H; if (gg > 1) gg = 1;
          // the delay: what went in D samples ago, at the gain worked out for it
          const rd = dw + 1 === D + 1 ? 0 : dw + 1;
          L[i] = gg === 1 ? dlL[rd] : dlL[rd] * gg; R[i] = gg === 1 ? dlR[rd] : dlR[rd] * gg;
          dlL[dw] = xl; dlR[dw] = xr; dw = rd;
        }
        first = false;
      },
    };
  },
};
`),
});
