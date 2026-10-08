// @ts-check
// core.brass: Brass Rail. A horn section, sample-free, built on the one thing every analysis of brass agrees on: the
// louder a horn plays, the brighter it gets, harmonic by harmonic, and on the way in the low harmonics arrive first
// (Risset & Mathews 1969; docs/research/INSTRUMENTS.md, 2.7). So each note is:
//   PLAYERS  a lead player, then a pair or two around them (a trio or five), each pair a few cents apart and a few
//            milliseconds late. A pair is a mirror image (the same
//            distance sharp and flat, the same distance ahead and behind in phase, the same vibrato turned the other
//            way), so the section is in tune on average however its players beat. The lead always outweighs the
//            pairs, as a lead trumpet does.
//   BREATH   the blowing pressure: a fast rise (faster when harder, with a little overshoot, the blat, on a hard
//            attack), a hold, a release. A band-limited saw (trumpet and trombone: cylindrical bores, every
//            harmonic) or pulse (sax) goes through a 24 dB ladder whose cutoff follows that pressure, as a number of
//            harmonics: about four at pianissimo and up to twenty-odd at fortissimo with BITE up, so velocity is
//            colour first and level second (the onset's centroid doubles from 0.3 to 1.0). A soft saturation after
//            the filter, driven by the same pressure, is the brassy edge of a loud note. Breath noise rides on top,
//            strongest in the first tens of milliseconds.
//   SCOOP    every note starts flat and lips up to pitch in 30-80 ms (more when softer), as players do.
//   HORN     HORNS (a trumpet leading two saxes, then two trombones), TRUMPET, TROMBONE or SAX: the source, the
//            brightness range and the bell's resonances (a shared EQ: the trumpet's peak near 1.3 kHz, the
//            trombone's near 550 Hz, the sax's nasal 1.6 kHz). Saxes growl a little when pushed.
// Then a small room's first reflections. The mod wheel adds vibrato, the bend wheel bends. About -16 LUFS on the test phrase at defaults.
// tools/instruments3-test.js and tools/timbre-test.js (the brass family) hold it to its numbers.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { TABLES } from './tables.js';

export default defineDevice({
  id: 'core.brass', name: 'Brass Rail', kind: 'instrument', cat: 'synth', by: 'overdub',
  blurb: 'A horn section: stabs, swells and falls that bite',
  nod: 'a brass and sax section: trumpets, trombones and saxes',
  params: [
    { key: 'horn', label: 'HORN', opts: ['HORNS', 'TRUMPET', 'TROMBONE', 'SAX'], def: 0, role: 'shape', desc: 'a mixed section (a trumpet leading saxes and trombones), or all one horn' },
    { key: 'players', label: 'PLAYERS', opts: ['SOLO', 'TRIO', 'FIVE'], def: 1, role: 'width', desc: 'one player, or a lead with a pair or two around them' },
    { key: 'bite', label: 'BITE', min: 0, max: 1, def: 0.5, role: 'tone', desc: 'how brassy loud notes get: mellow to blaring' },
    { key: 'scoop', label: 'SCOOP', min: 0, max: 1, def: 0.4, role: 'pitch', desc: 'how far below the note each one starts before it lips up' },
    { key: 'breath', label: 'BREATH', min: 0, max: 1, def: 0.35, role: 'mix', desc: 'air in the sound, most on the attack' },
    { key: 'vibrato', label: 'VIBRATO', min: 0, max: 1, def: 0.25, role: 'depth', desc: 'vibrato on held notes (it comes in after the attack)' },
    { key: 'attack', label: 'ATTACK', min: 0.005, max: 1.5, def: 0.06, curve: 'log', unit: 's', role: 'attack', desc: 'how fast the air gets going: stab to swell (harder is faster)' },
    { key: 'release', label: 'RELEASE', min: 0.02, max: 2, def: 0.12, curve: 'log', unit: 's', role: 'release', desc: 'how fast a note stops when you let go' },
  ],
  presets: [
    { name: 'Horn section', params: {} },
    { name: 'Stabs', params: { bite: 0.75, scoop: 0.25, attack: 0.012, release: 0.06, vibrato: 0 } },
    { name: 'Mellow swell', params: { horn: 2, players: 2, bite: 0.2, attack: 0.45, release: 0.5, breath: 0.25 } },
    { name: 'Tenor sax', params: { horn: 3, players: 0, bite: 0.55, scoop: 0.6, breath: 0.55, vibrato: 0.45 } },
    { name: 'Solo trumpet', params: { horn: 1, players: 0, bite: 0.6, vibrato: 0.4 } },
  ],
  look: { color: '#5a3d12', ink: '#f6e2b0', shape: 'wide', finish: 'brushed', knob: 'chrome', label: 'script', led: '#ffd166' },
  tail: 3,
  kernel: kernel(TABLES + String.raw`
const SAW = wavetable((k) => (k & 1 ? 1 : -1) * 0.6366197723675814 / k);
// the sax's pulse (width 0.42): a saw less itself shifted by the width, as one table
const PW = 0.42, sawA = (k) => (k & 1 ? 1 : -1) * 0.6366197723675814 / k;
const PULSE = wavetable((k) => sawA(k) * (1 - Math.cos(TAU * k * PW)) * 0.62, (k) => -sawA(k) * Math.sin(TAU * k * PW) * 0.62);
// per horn type: brightness (how many harmonics at full pressure), scoop scale, pulse width (0: a saw), level
const TYPES = [
  { br: 1.0, sc: 1.0, pw: 0, g: 1.0 },      // trumpet
  { br: 0.62, sc: 1.25, pw: 0, g: 1.4 },    // trombone
  { br: 0.85, sc: 1.1, pw: 0.42, g: 1.05 }, // sax
];
// who plays: [lead, pair 1, pair 2] by HORN
const CAST = [[0, 2, 1], [0, 0, 0], [1, 1, 1], [2, 2, 2]];
const NP = 5, T = SAW.T, TP = PULSE.T;
// THE COST. Sixteen of these play at once. A voice is a class (one render() V8 compiles once and inlines into, where
// closures were a fresh copy per voice), and render() works in locals, written back once a block: a number kept in a
// closure is boxed on the heap, a new box for every store, every sample. The ladder (tables.js's, op for op) is
// inlined into the sample loop, and its coefficients are worked out again only when the cutoff moves. Every sum is
// in the order it always was, so the sound is bit for bit what it was (tools/golden.json, inst:core.brass), at
// about half the old cost (tools/instruments3-test.js holds 16 voices to 4.5% of a core).
class Horn {
  constructor(sr, seed, vi) {
    this.sr = sr;
    this.r = rng((seed ^ 0xb4a5) + vi * 6007);
    this.ns = ((seed ^ 0x0b1e) + vi * 911) | 0;
    this.ph = new Float64Array(NP); this.dt = new Float64Array(NP); this.rel = new Float64Array(NP); this.pw = new Float64Array(NP);
    this.gl = new Float64Array(NP); this.env = new Float64Array(NP); this.de = new Float64Array(NP); this.et = new Float64Array(NP);
    this.dly = new Int32Array(NP); this.sgn = new Float64Array(NP);
    this.np = 3; this.f0 = 261; this.vel = 0.7; this.t = 0; this.cnt = 0; this.gate = false; this.e = 0; this.ka = 0; this.kr = 0; this.over = 0; this.ko = 0;
    this.scoop = 0; this.ks = 0; this.base = 0; this.vph = 0; this.vdt = 0; this.vib = 0; this.growl = 0; this.gph = 0; this.gdt = 0; this.hmax = 4; this.og = 1;
    this.chiff = 0; this.kc = 0; this.ny = 0; this.alive = 0; this.tl = 0; this.ta = 0; this.tilt = 0; this.tv = 0; this.pan0 = 1; this.pan1 = 1;
    // the ladder: its state, and its coefficients for the cutoff it was last set to
    this.s1 = 0; this.s2 = 0; this.s3 = 0; this.s4 = 0; this.fc = -1;
    this.G = 0; this.c1 = 0; this.c2 = 0; this.c3 = 0; this.c4 = 0; this.cx = 0;
  }
  start(p, v, P) {
    const sr = this.sr, r = this.r, ph = this.ph, rel = this.rel, gl = this.gl, pw = this.pw;
    const f0 = this.f0 = mtof(p); this.vel = v; this.t = 0; this.cnt = 0; this.gate = true; this.e = 0; this.alive = 1;
    const horn = P.horn | 0, cast = CAST[horn];
    this.np = [1, 3, 5][P.players | 0];
    const lead = cast[0];
    // the players: the lead in the middle, the pairs mirrored around them in pitch and phase
    const c = (r() + 1) / 2;
    ph[0] = c; rel[0] = 1; gl[0] = 1; this.dly[0] = 0; this.sgn[0] = 0;
    // the stage: higher notes a little left, lower a little right (the room does the rest)
    { const pg = panLR(clamp((60 - p) / 30, -1, 1) * 0.3); this.pan0 = pg[0]; this.pan1 = pg[1]; }
    for (let q = 0; q < 2; q++) {
      const ty = TYPES[cast[q + 1]], cents = (q ? 9 : 5) * (0.8 + 0.2 * (r() + 1)), g = 0.1 + 0.15 * (r() + 1);
      // (each pair's lateness is drawn but never applied: dly and sgn stay 0, so the pairs breathe with the lead and
      // their vibrato is still. Applying them would move the sound and its golden hash.)
      const late = Math.round((q ? 0.012 : 0.006) * (1 + 0.5 * (r() + 1)) * sr);
      for (let s = 0; s < 2; s++) {
        const j = 1 + 2 * q + s, d = s ? 1 : -1;
        rel[j] = Math.pow(2, d * cents / 1200);
        ph[j] = c + d * g; ph[j] -= Math.floor(ph[j]);
        gl[j] = (q ? 0.13 : 0.19) * ty.g / TYPES[lead].g;   // under the lead, so a pair's beat swells it, never hollows it
        pw[j] = ty.pw;
      }
    }
    pw[0] = TYPES[lead].pw;
    for (let j = 0; j < NP; j++) { this.env[j] = 0; this.de[j] = 0; this.et[j] = 0; }
    const ty = TYPES[lead];
    // the breath: rise time by velocity (harder is faster), the blat (overshoot) on a hard attack
    const atk = P.attack * (1.5 - 0.9 * v);
    this.ka = 1 - coef(Math.max(0.002, atk) / 2.2, sr * 1 / 16);
    this.over = 0.35 * v * v * (0.4 + P.bite); this.ko = coef(0.07, sr / 16);
    // brightness: harmonics at full pressure (velocity first, then BITE), by horn
    this.hmax = (3 + 28 * P.bite * P.bite + 8 * P.bite) * (0.04 + 0.96 * Math.pow(v, 1.8)) * ty.br;
    // the scoop: cents below, settling in 30-80 ms (more and slower when soft)
    this.scoop = -(25 + 65 * P.scoop) * (1.3 - 0.6 * v) * ty.sc; this.ks = coef(0.03 + 0.015 * (1 - v), sr / 16);
    // vibrato: 5-6 Hz, in after the attack
    this.vph = (r() + 1) / 2; this.vdt = (5 + 0.6 * (r() + 1) / 2) * 16 / sr; this.vib = 0;
    this.growl = pw[0] > 0 ? 0.18 * v * v : 0; this.gph = 0; this.gdt = 27 / sr;
    this.chiff = P.breath * (0.05 + 0.1 * v); this.kc = coef(0.035, sr); this.ny = 0;
    // level: velocity is mostly colour (the brightness adds loudness); a gentle tilt evens the register
    const keyG = Math.pow(2, -clamp(p - 60, 0, 30) / 22);
    this.og = 0.62 * (0.2 + 0.8 * v) * keyG * ty.g / (1 + 0.5 * 3 * Math.pow(v, 1.6) * (0.4 + P.bite));   // the tilt is loudness too
    this.tv = 3 * Math.pow(v, 1.6);
    this.s1 = this.s2 = this.s3 = this.s4 = 0;
    this.tl = 0; this.ta = 1 - Math.exp(-TAU * 2.2 * f0 / sr);
  }
  release(P) { this.gate = false; this.kr = coef(Math.max(0.01, P.release) / 4.6, this.sr / 16); }
  render(L, R, n, P, t2) {
    const bend = t2 && t2.bend ? t2.bend : 0, mod = t2 && t2.mod > 0 ? t2.mod : 0;
    const bth = P.breath, bite = P.bite, vibK = P.vibrato * 22 + mod * 40;
    const sr = this.sr, gate = this.gate, np = this.np, f0 = this.f0, vel = this.vel;
    const ph = this.ph, dt = this.dt, rel = this.rel, pw = this.pw, gl = this.gl, env = this.env, de = this.de, et = this.et, dly = this.dly, sgn = this.sgn;
    const ka = this.ka, kr = this.kr, ko = this.ko, ks = this.ks, vdt = this.vdt, hmax = this.hmax, og = this.og, growl = this.growl, gdt = this.gdt;
    const kc = this.kc, ta = this.ta, tv = this.tv, pan0 = this.pan0, pan1 = this.pan1;
    let t = this.t, cnt = this.cnt, e = this.e, over = this.over, scoop = this.scoop, vph = this.vph, vib = this.vib, base = this.base, tilt = this.tilt;
    let alive = this.alive, gph = this.gph, chiff = this.chiff, ny = this.ny, ns = this.ns, tl = this.tl;
    let s1 = this.s1, s2 = this.s2, s3 = this.s3, s4 = this.s4, lfc = this.fc, G = this.G, c1 = this.c1, c2 = this.c2, c3 = this.c3, c4 = this.c4, cx = this.cx;
    for (let c0 = 0; c0 < n;) {
      if ((cnt & 15) === 0) {
        // the breath, the blat, the scoop, the vibrato: every 16 samples
        if (gate) { e += (1 + over - e) * ka; over *= ko; } else e *= kr;
        scoop *= ks;
        const secs = t / sr, va = (gate ? clamp((secs - 0.3) / 0.5, 0, 1) : 1) * vibK;
        vib += (va - vib) * 0.05;
        vph += vdt; if (vph >= 1) vph -= 1;
        const sv = sinT(vph);
        const cents = scoop + bend * 100, fb = f0 * Math.pow(2, cents / 1200);
        let top = 1;
        for (let j = 0; j < np; j++) {
          const x = (vib * (j ? 0.8 * sgn[j] : 1) * sv) / 1200, fv = rel[j] * (x === 0 ? 1 : Math.pow(2, x));
          dt[j] = fb * fv / sr; if (fv > top) top = fv;
          // each player's own breath: the lead's (dly 0: see start)
          if (t >= dly[j]) et[j] += (e - et[j]) * 0.5;
          de[j] = (et[j] - env[j]) / 16;
        }
        base = wtBase(SAW, fb * top * 1.03 / sr);
        const pe = env[0];
        // brightness follows the pressure (the Risset rule): cutoff in harmonics
        const fc = Math.min(13000, f0 * (1.1 + hmax * Math.pow(pe, 1.6)));
        if (fc !== lfc) {
          // tables.js's ladder.set(fc, 0.35), op for op
          lfc = fc;
          const g = Math.tan(Math.PI * clamp(fc, 10, sr * 0.45) / sr);
          G = g / (1 + g); const gi = 1 / (1 + g), G4 = G * G * G * G, den = 1 / (1 + 0.35 * G4);
          c1 = G * G * G * gi * den; c2 = G * G * gi * den; c3 = G * gi * den; c4 = gi * den; cx = G4 * (1 + 0.5 * 0.35) * den;
        }
        // a loud horn's harmonics grow faster than its fundamental (the bell and the steepening wave): above
        // the 2nd harmonic the spectrum tilts up with the pressure
        tilt = tv * pe * (0.4 + bite);
        alive = e;
      }
      const len = Math.min(16 - (cnt & 15), n - c0), end = c0 + len;
      const dr = 0.25 + 1.4 * vel * env[0] * (0.25 + bite);
      const di = 1 / (dr * 0.85 + 0.15);
      const bn = (chiff + bth * 0.012 * env[0]) * (0.4 + 0.6 * vel);
      for (let i = c0; i < end; i++) {
        // the players, side by side; the section is blown and filtered as one (its spread is in pitch)
        let sm = 0;
        for (let j = 0; j < np; j++) {
          let q = ph[j] + dt[j]; if (q >= 1) q -= 1; ph[j] = q;
          const ev = env[j] + de[j]; env[j] = ev;
          const W = pw[j] ? TP : T, xq = q * WT_N, iq = xq | 0, a = W[base + iq];
          sm += (a + (W[base + iq + 1] - a) * (xq - iq)) * ev * gl[j];
        }
        if (growl) { gph += gdt; if (gph >= 1) gph -= 1; sm *= 1 - growl * env[0] * (0.5 + 0.5 * sinT(gph)); }
        // air: white noise, a little low-passed, through the same lips and bell
        ns = (Math.imul(ns, 1664525) + 1013904223) | 0; const w = ns * 4.656612873077393e-10; ny += (w - ny) * 0.5;
        const air = ny * bn; chiff *= kc;
        // the ladder (tables.js's tick)
        const x = sm * 0.3 + air;
        const y4 = cx * x + c1 * s1 + c2 * s2 + c3 * s3 + c4 * s4;
        const u0 = x * (1 + 0.5 * 0.35) - 0.35 * y4, u = u0 <= -3 ? -1 : u0 >= 3 ? 1 : (u0 * (27 + u0 * u0)) / (27 + 9 * u0 * u0);
        let v = (u - s1) * G; const y1 = v + s1; s1 = y1 + v;
        v = (y1 - s2) * G; const y2 = v + s2; s2 = y2 + v;
        v = (y2 - s3) * G; const y3 = v + s3; s3 = y3 + v;
        v = (y3 - s4) * G; let y = v + s4; s4 = y + v;
        tl += (y - tl) * ta; y += (y - tl) * tilt;
        // the brassy edge: the pressure drives a soft clip
        y = sat(y * dr) * di * og;
        L[i] += y * pan0; R[i] += y * pan1;
      }
      cnt += len; t += len; c0 = end;
    }
    this.t = t; this.cnt = cnt; this.e = e; this.over = over; this.scoop = scoop; this.vph = vph; this.vib = vib; this.base = base; this.tilt = tilt;
    this.alive = alive; this.gph = gph; this.chiff = chiff; this.ny = ny; this.ns = ns; this.tl = tl;
    this.s1 = s1; this.s2 = s2; this.s3 = s3; this.s4 = s4; this.fc = lfc; this.G = G; this.c1 = c1; this.c2 = c2; this.c3 = c3; this.c4 = c4; this.cx = cx;
    return gate || alive > 2e-4;
  }
  stop() { this.gate = false; this.e = 0; this.alive = 0; this.env.fill(0); this.et.fill(0); this.de.fill(0); }
}
// the bells: lib's svf() EQ coefficients (bell and shelfHi, op for op), so process() can run the three stages in locals
function bellEq(sr, fc, q, dbGain, hi) {
  const A = Math.pow(10, dbGain / 40);
  const g = hi ? Math.tan(Math.PI * clamp(fc, 5, sr * 0.49) / sr) * Math.sqrt(A) : Math.tan(Math.PI * clamp(fc, 5, sr * 0.49) / sr);
  const k = 1 / Math.max(0.05, hi ? q : q * A), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  return hi ? [a1, a2, a3, A * A, k * (1 - A) * A, 1 - A * A] : [a1, a2, a3, 1, k * (A * A - 1), 0];
}
return {
  poly: 16,
  create({ sr, seed }) {
    // the bells (a shared EQ, set per HORN) and a small room
    const BELL = [[700, 0.8, 3, 1500, 1.2, 3, 5500, -6], [1300, 1, 4, 2500, 1.2, 2, 6500, -6], [550, 0.9, 4, 1200, 1, 2, 4000, -8], [500, 1, 3, 1600, 1.6, 4, 5500, -6]];
    const EQ = new Float64Array(18), ST = new Float64Array(12);   // three stages' [a1 a2 a3 m0 m1 m2]; L then R [ic1 ic2] x3
    let eqFor = -1;
    // the room: its first reflections (a tapped delay, darkened), a few on each side (lib's delayLine, onepole and
    // dcblock, inline)
    let size = 1; while (size < Math.ceil(0.04 * sr) + 4) size <<= 1;
    const buf = new Float32Array(size), mask = size - 1, aLp = Math.exp(-TAU * clamp(4500, 1, sr * 0.49) / sr), RD = Math.exp(-TAU * 10 / sr);
    const TL = [0.0071, 0.0113, 0.0179, 0.0235, 0.0317].map((s) => s * sr), TR = [0.0083, 0.0131, 0.0194, 0.0272, 0.0359].map((s) => s * sr);
    const TG = [0.42, -0.33, 0.27, -0.2, 0.15];
    const RS = new Float64Array(5);   // the room's low-pass, then each side's dc blocker [x1 y1]
    let w = 0;
    const tap = (d) => { const r = w - d, i = Math.floor(r), f = r - i, b = buf[i & mask]; return b + (buf[(i + 1) & mask] - b) * f; };
    return {
      voice(vi) { return new Horn(sr, seed, vi); },
      process(L, R, n, P) {
        const horn = P.horn | 0;
        if (horn !== eqFor) {
          eqFor = horn; const b = BELL[horn];
          EQ.set(bellEq(sr, b[0], b[1], b[2], false), 0); EQ.set(bellEq(sr, b[3], b[4], b[5], false), 6); EQ.set(bellEq(sr, b[6], 0.7, b[7], true), 12);
        }
        let la1 = ST[0], la2 = ST[1], lb1 = ST[2], lb2 = ST[3], lc1 = ST[4], lc2 = ST[5], ra1 = ST[6], ra2 = ST[7], rb1 = ST[8], rb2 = ST[9], rc1 = ST[10], rc2 = ST[11];
        let lp = RS[0], xl = RS[1], yl = RS[2], xr = RS[3], yr = RS[4];
        const A1 = EQ[0], A2 = EQ[1], A3 = EQ[2], A4 = EQ[3], A5 = EQ[4], A6 = EQ[5], B1 = EQ[6], B2 = EQ[7], B3 = EQ[8], B4 = EQ[9], B5 = EQ[10], B6 = EQ[11];
        const C1 = EQ[12], C2 = EQ[13], C3 = EQ[14], C4 = EQ[15], C5 = EQ[16], C6 = EQ[17];
        for (let i = 0; i < n; i++) {
          let l = L[i], r = R[i], v3, v1, v2;
          // lib's svf().eq(), three stages a side
          v3 = l - la2; v1 = A1 * la1 + A2 * v3; v2 = la2 + A2 * la1 + A3 * v3; la1 = 2 * v1 - la1; la2 = 2 * v2 - la2; l = A4 * l + A5 * v1 + A6 * v2;
          v3 = r - ra2; v1 = A1 * ra1 + A2 * v3; v2 = ra2 + A2 * ra1 + A3 * v3; ra1 = 2 * v1 - ra1; ra2 = 2 * v2 - ra2; r = A4 * r + A5 * v1 + A6 * v2;
          v3 = l - lb2; v1 = B1 * lb1 + B2 * v3; v2 = lb2 + B2 * lb1 + B3 * v3; lb1 = 2 * v1 - lb1; lb2 = 2 * v2 - lb2; l = B4 * l + B5 * v1 + B6 * v2;
          v3 = r - rb2; v1 = B1 * rb1 + B2 * v3; v2 = rb2 + B2 * rb1 + B3 * v3; rb1 = 2 * v1 - rb1; rb2 = 2 * v2 - rb2; r = B4 * r + B5 * v1 + B6 * v2;
          v3 = l - lc2; v1 = C1 * lc1 + C2 * v3; v2 = lc2 + C2 * lc1 + C3 * v3; lc1 = 2 * v1 - lc1; lc2 = 2 * v2 - lc2; l = C4 * l + C5 * v1 + C6 * v2;
          v3 = r - rc2; v1 = C1 * rc1 + C2 * v3; v2 = rc2 + C2 * rc1 + C3 * v3; rc1 = 2 * v1 - rc1; rc2 = 2 * v2 - rc2; r = C4 * r + C5 * v1 + C6 * v2;
          const m = 0.5 * (l + r);
          buf[w] = (lp = m + (lp - m) * aLp); w = (w + 1) & mask;
          let el = 0, ej = 0;
          for (let k = 0; k < 5; k++) { el += tap(TL[k]) * TG[k]; ej += tap(TR[k]) * TG[k]; }
          const OUT = 0.9;
          const zl = (l + el * 0.45) * OUT, ol = zl - xl + RD * yl; xl = zl; yl = ol;
          const zr = (r + ej * 0.45) * OUT, or = zr - xr + RD * yr; xr = zr; yr = or;
          L[i] = knee(ol);
          R[i] = knee(or);
        }
        ST[0] = la1; ST[1] = la2; ST[2] = lb1; ST[3] = lb2; ST[4] = lc1; ST[5] = lc2; ST[6] = ra1; ST[7] = ra2; ST[8] = rb1; ST[9] = rb2; ST[10] = rc1; ST[11] = rc2;
        RS[0] = lp; RS[1] = xl; RS[2] = yl; RS[3] = xr; RS[4] = yr;
      },
    };
  },
};
`),
});
