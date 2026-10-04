// core.wavetable: Light Table, Overdub's wavetable synth. (A light table is where you lay out film frames to look at
// them; a wavetable is a strip of single-cycle frames.) docs/research/LIGHT-TABLE.md is the design note: the engine,
// the param map an editor and an agent work from, the tables, the CPU numbers and what the editor wave builds.
//
//   OSC A, OSC B  a table from wavetables.js (14, built in code: the kernel and the page share lightTables), POS
//                 morphing between its 49 frames, a WARP (SYNC, BEND, PW, MIRROR, FM from the other oscillator) with
//                 its amount, UNISON 1-8 with DETUNE, BLEND and SPREAD, OCT / SEMI / FINE, LEVEL and PAN. Each frame
//                 is held at 11 band limits and the oscillator reads the one whose top harmonic stays under the
//                 sample rate at its pitch (warps count: a sync at 4x reads a table four times thinner), so a C8 is
//                 as clean as a C2; hard sync's reset is smoothed with a polyBLEP.
//   SUB, NOISE    a sine, triangle or square one or two octaves down; seeded stereo noise with a colour.
//   FILTER        LP12, LP24 (a zero-delay ladder), HP, BP, NOTCH, COMB (tuned to the cutoff), FORMANT (vowels
//                 swept by the cutoff); CUTOFF, RESO, DRIVE, KEY TRACK, FLT ENV (envelope 2), FLT VEL (harder notes
//                 brighter) and which sources go through it (the rest pass it by).
//   ENV1-3        ENV1 is the amp; 2 and 3 modulate (2 is also FLT ENV's). Attack, decay, sustain, release, and a
//                 CURVE from linear (-1) through analogue (0) to snappy (1).
//   LFO1-4        seven shapes, a rate or a tempo SYNC, and FREE (one phase for every voice, locked to the song
//                 while it plays), RETRIG (each note from 0) or ENV (one cycle, then hold).
//   M1-M8         the mod matrix: SOURCE, DEST, AMOUNT (-1..1, in the destination knob's travel). A slot can
//                 target another slot's amount (MOD WHEEL -> M1 AMT: a vibrato depth on the wheel).
//   MACRO 1-4     four knobs that do nothing until a slot uses them.
//   FX            drive (2x oversampled), chorus, a ping-pong delay synced to the song, a small room, each with a mix.
//   VOICES        POLY (8), MONO (retriggers), LEGATO (overlapping notes slide without retriggering); GLIDE.
// The mod wheel adds vibrato (up to 35 cents at 5.5 Hz) while no slot uses it; the bend wheel bends.
// Every change ramps: switches crossfade (tables over 30 ms, filter types and routings over 10 ms, a warp mode by
// taking its amount to zero first), so nothing clicks. About -16 LUFS on the test phrase at defaults and on every
// preset. tools/wavetable-test.js holds it to all of this.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { lightTables, TABLE_NAMES } from './wavetables.js';

// Switch options. Songs store indexes: append new options at the end, never reorder.
export const WARPS = ['OFF', 'SYNC', 'BEND', 'PW', 'MIRROR', 'FM'];
export const FILTERS = ['LP12', 'LP24', 'HP', 'BP', 'NOTCH', 'COMB', 'FORMANT'];
export const LFO_SHAPES = ['SINE', 'TRI', 'SAW UP', 'SAW DN', 'SQUARE', 'S&H', 'DRIFT'];
export const LFO_SYNCS = ['OFF', '1/32', '1/16T', '1/16', '1/16D', '1/8T', '1/8', '1/8D', '1/4T', '1/4', '1/4D', '1/2', '1/2D', '1 BAR', '2 BARS', '4 BARS'];
export const LFO_MODES = ['FREE', 'RETRIG', 'ENV'];
export const DELAY_TIMES = ['1/16', '1/8T', '1/8', '1/8D', '1/4T', '1/4', '1/4D', '1/2'];
export const VOICE_MODES = ['POLY', 'MONO', 'LEGATO'];
export const SOURCES = ['OFF', 'ENV1', 'ENV2', 'ENV3', 'LFO1', 'LFO2', 'LFO3', 'LFO4', 'VELOCITY', 'NOTE', 'MOD WHEEL', 'MACRO 1', 'MACRO 2', 'MACRO 3', 'MACRO 4', 'RANDOM'];
export const DESTS = ['OFF', 'A POS', 'A WARP', 'A PITCH', 'A LEVEL', 'A PAN', 'A DETUNE', 'B POS', 'B WARP', 'B PITCH', 'B LEVEL', 'B PAN', 'B DETUNE',
  'SUB LEVEL', 'NOISE LEVEL', 'CUTOFF', 'RESO', 'FLT DRIVE', 'PITCH', 'FINE', 'AMP', 'PAN', 'LFO1 RATE', 'LFO2 RATE', 'LFO3 RATE', 'LFO4 RATE',
  'M1 AMT', 'M2 AMT', 'M3 AMT', 'M4 AMT', 'M5 AMT', 'M6 AMT', 'M7 AMT', 'M8 AMT', 'DRIVE', 'CHORUS MIX', 'DELAY MIX', 'VERB MIX'];
// What an amount of 1 does at each destination (the editor draws it as an arc on the knob; agents read it here):
// a param's own destination moves it its knob's whole travel (CUTOFF: 10 octaves); PITCH and A/B PITCH 24 semitones;
// FINE 1 semitone; AMP multiplies the voice by 1 + amount x source (0..2); Mn AMT adds to slot n's amount.
export const DEST_SCALE = {
  'A POS': 'the whole table (1 = POS 0 to 1)', 'A WARP': 'the warp amount\'s travel', 'A PITCH': '24 semitones', 'A LEVEL': 'the level\'s travel',
  'A PAN': 'the pan\'s travel (0.5 = centre to one side)', 'A DETUNE': 'the detune\'s travel', 'SUB LEVEL': 'the level\'s travel', 'NOISE LEVEL': 'the level\'s travel',
  CUTOFF: 'the cutoff knob\'s travel, 10 octaves (0.1 = an octave)', RESO: 'the resonance\'s travel', 'FLT DRIVE': 'the drive\'s travel',
  PITCH: '24 semitones on every oscillator', FINE: '1 semitone on every oscillator (0.2 x an LFO = a 20-cent vibrato)', AMP: 'the voice\'s level times 1 + amount x source (0 to 2)',
  PAN: 'the voice\'s pan travel', 'LFO1 RATE': 'the rate knob\'s travel (11 octaves; RETRIG and ENV modes)', 'M1 AMT': 'added to slot 1\'s amount',
  DRIVE: 'the drive\'s travel (global: the newest note\'s value)', 'CHORUS MIX': 'the mix\'s travel (global)', 'DELAY MIX': 'the mix\'s travel (global)', 'VERB MIX': 'the mix\'s travel (global)',
};

/* ------------------------------------------------------------------------------------------------ the params */
const P = [];
const sw = (key, label, opts, def, role, desc) => P.push({ key, label, opts, def, role, desc });
const kn = (key, label, min, max, def, role, desc, x = {}) => P.push({ key, label, min, max, def, role, desc, ...x });
function osc(o, d) {
  const O = o.toUpperCase(), K = o + '_';
  sw(K + 'table', `${O} TABLE`, TABLE_NAMES, d.table, 'shape', `osc ${O}'s wavetable: ${TABLE_NAMES.join(', ')} (what each sounds like: docs/research/LIGHT-TABLE.md)`);
  kn(K + 'pos', `${O} POS`, 0, 1, d.pos, 'shape', 'where in the table: 0 is the first frame, 1 the last; it morphs smoothly between');
  sw(K + 'warp', `${O} WARP`, WARPS, 0, 'shape', `bends the wave: SYNC (hard sync up to 8x), BEND (the cycle pushed to its middle), PW (squeezed into a shorter pulse), MIRROR (played forward then back), FM (phase-modulated by osc ${O === 'A' ? 'B' : 'A'}, even at its level 0)`);
  kn(K + 'warp_amt', `${O} WARP AMT`, 0, 1, 0, 'depth', 'how far the warp bends it (0 is the plain wave)');
  kn(K + 'unison', `${O} UNISON`, 1, 8, d.unison, 'width', 'voices per note: 1 is one oscillator; up to 8 detuned copies', { step: 1 });
  kn(K + 'detune', `${O} DETUNE`, 0, 1, d.detune, 'width', 'how far the unison voices spread in pitch: 0.3 is about 9 cents at the edges, 1 a whole semitone');
  kn(K + 'blend', `${O} BLEND`, 0, 1, 0.75, 'mix', 'the detuned voices against the centre one: 0 is the centre alone, 1 all equal');
  kn(K + 'spread', `${O} SPREAD`, 0, 1, 0.6, 'width', 'the unison voices across the stereo field: 0 mono, 1 wide');
  kn(K + 'oct', `${O} OCT`, -3, 3, d.oct, 'pitch', 'octaves up or down', { step: 1 });
  kn(K + 'semi', `${O} SEMI`, -12, 12, 0, 'pitch', 'semitones up or down', { step: 1, unit: 'st' });
  kn(K + 'fine', `${O} FINE`, -100, 100, 0, 'pitch', 'cents up or down', { unit: 'ct' });
  kn(K + 'level', `${O} LEVEL`, 0, 1, d.level, 'level', `osc ${O}'s level (0 is off; it still drives an FM warp)`);
  kn(K + 'pan', `${O} PAN`, -1, 1, 0, 'width', 'left (-1) to right (1)');
}
osc('a', { table: 0, pos: 0.62, unison: 3, detune: 0.22, oct: 0, level: 0.8 });
osc('b', { table: 0, pos: 1 / 3, unison: 1, detune: 0.2, oct: -1, level: 0 });
sw('sub_shape', 'SUB WAVE', ['SINE', 'TRI', 'SQUARE'], 0, 'shape', 'the sub oscillator\'s wave');
sw('sub_oct', 'SUB OCT', ['-1', '-2'], 0, 'pitch', 'one or two octaves under the note');
kn('sub_level', 'SUB LEVEL', 0, 1, 0, 'level', 'the sub oscillator: weight under the note (0 is off)');
kn('noise_level', 'NOISE', 0, 1, 0, 'level', 'seeded stereo noise (0 is off): breath, air, the scrape of an attack');
kn('noise_color', 'NOISE COLOR', 0, 1, 0.6, 'tone', 'dark rumble at 0, white hiss at 1');
sw('flt_type', 'FILTER', FILTERS, 1, 'shape', 'LP12 / LP24 low-pass (LP24 a ladder that sings at full resonance), HP high-pass, BP band-pass, NOTCH, COMB (peaks at the cutoff and its multiples), FORMANT (vowels: the cutoff sweeps U O A E I)');
kn('flt_cutoff', 'CUTOFF', 20, 20000, 2200, 'tone', 'where the filter works: brighter as it opens (low-pass)', { curve: 'log', unit: 'Hz' });
kn('flt_res', 'RESO', 0, 1, 0.15, 'tone', 'resonance: a peak at the cutoff, ringing toward the top');
kn('flt_drive', 'FLT DRIVE', 0, 1, 0, 'drive', 'saturation into the filter: warmth, then grit');
kn('flt_key', 'KEY TRACK', 0, 1, 0.4, 'tone', 'how far the cutoff follows the keys: 1 is an octave per octave');
kn('flt_env', 'FLT ENV', -1, 1, 0.3, 'depth', 'how far envelope 2 moves the cutoff: 1 is 6 octaves up, -1 down; harder notes move it a little further');
kn('flt_vel', 'FLT VEL', 0, 1, 0.8, 'sens', 'velocity on the cutoff: harder notes open the filter, softer ones close it (0 off; at 1 a soft note is an octave darker than a medium one)');
for (const [k, l, n] of [['flt_a', 'A > FLT', 'osc A'], ['flt_b', 'B > FLT', 'osc B'], ['flt_sub', 'SUB > FLT', 'the sub'], ['flt_noise', 'NOISE > FLT', 'the noise']]) sw(k, l, ['OFF', 'ON'], 1, 'shape', `whether ${n} goes through the filter (OFF: around it, straight to the amp)`);
function env(n, d) {
  const K = `env${n}_`, L = n === 1 ? 'AMP ' : `ENV${n} `, what = n === 1 ? 'the amp envelope' : `envelope ${n}`;
  kn(K + 'attack', L + 'ATTACK', 0.001, 8, d[0], 'attack', `${what}: time to rise`, { curve: 'log', unit: 's' });
  kn(K + 'decay', L + 'DECAY', 0.005, 10, d[1], 'decay', `${what}: time to fall to the sustain level`, { curve: 'log', unit: 's' });
  kn(K + 'sustain', L + 'SUSTAIN', 0, 1, d[2], 'level', `${what}: the level held while the key is down`);
  kn(K + 'release', L + 'RELEASE', 0.005, 12, d[3], 'release', `${what}: time to fall after the key lets go`, { curve: 'log', unit: 's' });
  kn(K + 'curve', L + 'CURVE', -1, 1, d[4], 'shape', `${what}'s segments: -1 linear (a slow-starting swell), 0 analogue, 1 snappy (a fast rise, fast falls)`);
}
env(1, [0.004, 0.6, 0.8, 0.35, 0]);
kn('env1_vel', 'AMP VEL', 0, 1, 0.5, 'sens', 'how much softer a soft note plays: 0 every note the same, 1 fully by velocity');
env(2, [0.003, 0.45, 0.25, 0.4, 0.3]);
env(3, [0.002, 0.3, 0, 0.3, 0]);
const lfoDef = [[0, 2], [1, 0.5], [3, 4], [5, 3]];
for (let n = 1; n <= 4; n++) {
  const K = `lfo${n}_`, L = `LFO${n} `;
  sw(K + 'shape', L + 'SHAPE', LFO_SHAPES, lfoDef[n - 1][0], 'shape', `LFO ${n}'s wave (-1..1): S&H steps to a new random value each cycle, DRIFT wanders smoothly`);
  kn(K + 'rate', L + 'RATE', 0.02, 40, lfoDef[n - 1][1], 'rate', `LFO ${n}'s speed when SYNC is OFF`, { curve: 'log', unit: 'Hz' });
  sw(K + 'sync', L + 'SYNC', LFO_SYNCS, 0, 'time', `one cycle per note value at the song's tempo (OFF: RATE); in FREE mode it is locked to the song's beat while it plays`);
  sw(K + 'mode', L + 'MODE', LFO_MODES, 1, 'shape', 'FREE: one phase for every voice (locked to the song when synced); RETRIG: each note starts it from 0; ENV: one cycle from each note, then it holds');
}
for (let n = 1; n <= 8; n++) {
  const K = `m${n}_`, L = `M${n} `;
  sw(K + 'src', L + 'SOURCE', SOURCES, 0, 'shape', `mod slot ${n}'s source: envelopes and macros 0..1, LFOs, NOTE (C4 = 0, 4 octaves = 1) and RANDOM (a new value each note) -1..1`);
  sw(K + 'dst', L + 'DEST', DESTS, 0, 'shape', `what slot ${n} moves (an amount of 1 moves a knob its whole travel: CUTOFF 10 octaves, PITCH 24 semitones, FINE 1 semitone)`);
  kn(K + 'amt', L + 'AMOUNT', -1, 1, 0, 'depth', `slot ${n}'s amount: how far, and which way, the source moves its destination`);
}
for (let n = 1; n <= 4; n++) kn(`macro${n}`, `MACRO ${n}`, 0, 1, 0, 'depth', `macro ${n}: a knob for one or several mod slots (MACRO ${n} as their source); it does nothing until a slot uses it`);
kn('fx_drive', 'DRIVE', 0, 1, 0, 'drive', 'the output drive, oversampled: warmth to crunch');
kn('fx_drive_mix', 'DRIVE MIX', 0, 1, 1, 'mix', 'how much of the drive is heard against the clean sound');
kn('fx_chorus_depth', 'CHORUS', 0, 1, 0.5, 'depth', 'the chorus\'s sweep: a gentle double to a wide wobble');
kn('fx_chorus_mix', 'CHORUS MIX', 0, 1, 0, 'mix', 'how much chorus (0 is off)');
sw('fx_delay_time', 'DELAY TIME', DELAY_TIMES, 3, 'time', 'the echo\'s note value at the song\'s tempo (ping-pong: left, then right)');
kn('fx_delay_fb', 'DELAY FB', 0, 0.9, 0.35, 'feedback', 'how many repeats');
kn('fx_delay_mix', 'DELAY MIX', 0, 1, 0, 'mix', 'how loud the echoes are (0 is off)');
kn('fx_verb_size', 'VERB SIZE', 0, 1, 0.45, 'size', 'the room: a small booth to a long hall');
kn('fx_verb_mix', 'VERB MIX', 0, 1, 0.12, 'mix', 'how much room (0 is off)');
sw('voice_mode', 'VOICES', VOICE_MODES, 0, 'shape', 'POLY plays 8 notes; MONO one at a time, retriggering; LEGATO one, sliding between overlapping notes');
kn('voice_glide', 'GLIDE', 0, 1000, 0, 'time', 'slide time to each new note (MONO always, LEGATO between overlapping notes, POLY from the last note)', { unit: 'ms' });
kn('voice_level', 'VOLUME', -24, 6, 0, 'level', 'the output level', { unit: 'dB' });
export const PARAMS = P;

/* ------------------------------------------------------------------------------------------------ the kernel */
// The host's params object holds 114 keys and changes only between blocks: the kernel copies it once a block into
// an object of fixed shape (a literal, generated here from PARAMS), so the voices' hundreds of reads a block are fast.
const Q_LIT = '{ ' + P.map((q) => `${q.key}: ${q.def}`).join(', ') + ' }';
const Q_LOAD = P.map((q) => `Q.${q.key} = P.${q.key};`).join(' ');

const BODY = String.raw`
const LT = (${lightTables})();
const F = LT.F, FS = LT.FS, MN = LT.MN, MO = LT.MO, TB = LT.TABLES;
const CR = 16;                            // modulation and coefficients every 16 samples, ramped between
const SYNC_BEATS = [0, 0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2, 3, 4, 8, 16];
const DELAY_BEATS = [0.25, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2];
const CUT_OCT = Math.log2(1000), RATE_OCT = Math.log2(2000), LG = Math.LN2 / 12, SQ2 = Math.SQRT2, QP = Math.PI / 4, I2P = 1 / TAU;
// the params, copied once a block (see Q_LIT above)
const Q = ${Q_LIT};
function loadQ(P) { ${Q_LOAD} }
// the FORMANT filter's vowels, U O A E I: F1 F2 F3 (Hz) then their levels (dB), a bass voice (the Csound table)
const FV = [350, 600, 2400, 0, -20, -32, 400, 750, 2400, 0, -11, -21, 600, 1040, 2250, 0, -7, -9, 400, 1620, 2400, 0, -12, -9, 250, 1750, 2600, 0, -30, -16];
function kx(m, tau, sr) { return 1 - Math.exp(-m / (tau * sr)); }
// NOTE ON SPEED. Nothing below allocates once it is running (tools/wavetable-test.js counts the garbage collections of
// a long render: none). V8 boxes a number passed into or returned from a call it didn't inline, so the hot paths
// pass numbers through fields and typed arrays, and the per-sample helpers (a table read, a sine, the saturator, the
// envelope) are written out where they are used.

// An envelope: attack, decay, sustain, release, each segment exactly its time long, its curvature from CURVE. A
// segment runs s from 0 to 1 by s' = I - (I - s) E (E = e^(-k/n), I = 1 / (1 - e^-k)): k > 0 a fast start
// (analogue), k < 0 a slow one (a swell), k near 0 a straight line. A retrigger starts the attack from where it is.
class Env {
  constructor(sr) {
    this.sr = sr; this.st = 0; this.v = 0; this.s = 0; this.v0 = 0; this.vr = 0; this.S = 1;
    this.ka = -1; this.kd = -1; this.kr = -1; this.c = 9;
    this.Ea = 1; this.Ia = 0; this.La = 0; this.Ed = 1; this.Id = 0; this.Er = 1; this.Ir = 0; this.Ea16 = 1; this.Ed16 = 1; this.Er16 = 1;
  }
  // e: [attack, decay, sustain, release, curve]
  set(e) {
    const a = e[0], d = e[1], r = e[3], c = e[4];
    this.S = e[2];
    if (a === this.ka && d === this.kd && r === this.kr && c === this.c) return;
    this.ka = a; this.kd = d; this.kr = r; this.c = c;
    const sr = this.sr, ca = c >= 0 ? 1.5 + 4.5 * c : 1.5 + 5.5 * c, cd = c >= 0 ? 5 + 5 * c : 5 + 4.99 * c;
    let n = a * sr < 1 ? 1 : a * sr;
    if (ca > -1e-3 && ca < 1e-3) { this.La = 1 / n; this.Ea = 1; this.Ia = 0; } else { this.La = 0; this.Ea = Math.exp(-ca / n); this.Ia = 1 / (1 - Math.exp(-ca)); }
    const I = 1 / (1 - Math.exp(-cd));
    n = d * sr < 1 ? 1 : d * sr; this.Ed = Math.exp(-cd / n); this.Id = I;
    n = r * sr < 1 ? 1 : r * sr; this.Er = Math.exp(-cd / n); this.Ir = I;
    this.Ea16 = Math.pow(this.Ea, CR); this.Ed16 = Math.pow(this.Ed, CR); this.Er16 = Math.pow(this.Er, CR);
  }
  on() { this.st = 1; this.s = 0; this.v0 = this.v; }
  off() { if (this.st && this.st !== 4) { this.st = 4; this.s = 0; this.vr = this.v; } }
  kill() { this.st = 0; this.v = 0; this.s = 0; }
  // m samples at once (the modulation envelopes, a control step at a time): the same segments in closed form
  adv(m) {
    const full = m === CR;
    switch (this.st) {
      case 1: {
        const s = this.La ? this.s + this.La * m : this.Ia - (this.Ia - this.s) * (full ? this.Ea16 : Math.pow(this.Ea, m));
        if (s >= 1) { this.v = 1; this.st = 2; this.s = 0; } else { this.s = s; this.v = this.v0 + (1 - this.v0) * s; }
        break;
      }
      case 2: {
        const s = this.Id - (this.Id - this.s) * (full ? this.Ed16 : Math.pow(this.Ed, m));
        if (s >= 1) { this.v = this.S; this.st = 3; } else { this.s = s; this.v = 1 - (1 - this.S) * s; }
        break;
      }
      case 3: { const d = this.S - this.v; this.v = d < 1e-7 && d > -1e-7 ? this.S : this.v + d * (full ? 0.03153 : 1 - Math.pow(0.998, m)); break; }
      case 4: {
        const s = this.Ir - (this.Ir - this.s) * (full ? this.Er16 : Math.pow(this.Er, m));
        if (s >= 1 || this.vr < 1e-6) { this.v = 0; this.st = 0; } else { this.s = s; this.v = this.vr * (1 - s); }
        break;
      }
      default: break;
    }
  }
  // m samples, one at a time, into buf (the amp envelope)
  fill(buf, m) {
    let st = this.st, v = this.v, s = this.s;
    const S = this.S;
    for (let i = 0; i < m; i++) {
      if (st === 1) { s = this.La ? s + this.La : this.Ia - (this.Ia - s) * this.Ea; if (s >= 1) { v = 1; st = 2; s = 0; } else v = this.v0 + (1 - this.v0) * s; }
      else if (st === 2) { s = this.Id - (this.Id - s) * this.Ed; if (s >= 1) { v = S; st = 3; } else v = 1 - (1 - S) * s; }
      else if (st === 3) { const d = S - v; v = d < 1e-7 && d > -1e-7 ? S : v + d * 0.002; }
      else if (st === 4) { s = this.Ir - (this.Ir - s) * this.Er; if (s >= 1 || this.vr < 1e-6) { v = 0; st = 0; } else v = this.vr * (1 - s); }
      buf[i] = v;
    }
    this.st = st; this.v = v; this.s = s;
  }
}

// An LFO's state in one voice (RETRIG and ENV keep their own phase; FREE reads the shared one). Square and S&H edges
// are slewed over 2 ms and any change of shape, sync or mode glides out over 4 ms, so a gate or a switch never clicks.
class Lfo {
  constructor() { this.ph = 0; this.n = 0; this.y = 0; this.out = 0; this.salt = 0; this.cfg = -1; this.xo = 0; }
}

// One oscillator of one voice: up to 8 unison phases, each a note-cycle phase (0..1) and a cycle count (mod 4), so a
// table of 1, 2 or 4 note cycles reads the right part and a crossfade between two such tables stays in step.
class Osc {
  constructor(sr, r) {
    this.sr = sr;
    this.ph = new Float64Array(8); this.cy = new Int32Array(8); this.inc = new Float64Array(8); this.x = new Float64Array(8);
    this.gl = new Float64Array(8); this.gr = new Float64Array(8); this.dl = new Float64Array(8); this.dr = new Float64Array(8);
    this.tl = new Float64Array(8); this.tr = new Float64Array(8); this.ql = new Float64Array(8); this.qr = new Float64Array(8);
    this.wn = new Float64Array(8); this.hs = new Float64Array(8); this.hk = new Float64Array(8); this.jit = new Float64Array(8);
    for (let j = 0; j < 8; j++) this.jit[j] = r();
    // the control step's inputs (the engine writes them): warp amount, detune, blend, spread, pan, level, pitch, pos, smoothing
    this.v = new Float64Array(9);
    this.pos = 0; this.dpos = 0; this.mode = 0; this.amt = 0; this.wv = 0; this.dwv = 0; this.U = 1; this.N = 1; this.dmax = 0;
    this.m0 = 0; this.m1 = 0; this.n0 = 0; this.n1 = 0; this.first = true; this.live = false; this.xw = 0; this.dxw = 0;
    this.cP = NaN; this.cN = -1; this.cD = NaN; this.cB = NaN; this.cS = NaN; this.cPan = NaN; this.cL = NaN; this.cW = NaN; this.cDm = NaN; this.cT0 = -1; this.cT1 = -1;
    this.hT = null; this.hA = 0; this.hB = 0; this.hn = 0; this.hu0 = 0; this.hu1 = 0; this.hfw = 0; this.hh = 0; this.hkk = 0;
  }
  start(rnd, uni) {
    for (let j = 0; j < 8; j++) { this.ph[j] = uni > 1 ? (rnd() + 1) / 2 : 0; this.cy[j] = 0; this.hs[j] = 0; this.hk[j] = 0; this.x[j] = 0; }
    // the unison pairs start in mirror image about a centre phase (the centre voice on it), so with their mirrored
    // detune each pair beats in level but never leans sharp or flat: the stack stays on pitch
    if (uni > 1) {
      const n = uni > 8 ? 8 : uni, c = (rnd() + 1) / 2;
      for (let j = 0; j < n >> 1; j++) { let q = 2 * c - this.ph[j]; q -= Math.floor(q); this.ph[n - 1 - j] = q; }
      if (n & 1) this.ph[(n - 1) >> 1] = c;
    }
    this.first = true; this.cP = NaN; this.cN = -1; this.cL = NaN;
  }
  // Per control step: targets for the next m samples, from this.v. run: 1 renders when heard, 2 always (an FM source)
  ctrl(sh, o, mode, uni, m, run) {
    const v = this.v, amt = v[0], det = v[1], blend = v[2], spread = v[3], pan = v[4], level = v[5], pitch = v[6], pos = v[7], ks = v[8];
    const sr = this.sr, first = this.first;
    if (first) { this.pos = pos; this.mode = mode; this.amt = mode ? amt : 0; this.wv = this.warpVal(this.mode, this.amt); }
    this.dpos = (pos - this.pos) / m;
    // the warp: a new mode takes the old one's amount to 0 first (every mode at 0 is the plain wave), then rises
    let tgt = mode ? amt : 0;
    if (mode !== this.mode) { tgt = 0; if (this.amt < 2e-3) { this.mode = mode; this.amt = 0; this.wv = this.warpVal(mode, 0); tgt = mode ? amt : 0; } }
    const lim = m / (0.004 * sr); let da = tgt - this.amt; da = da > lim ? lim : da < -lim ? -lim : da;
    this.amt += da;
    // unison: the voices' places and their pitch
    const N = uni < 1 ? 1 : uni > 8 ? 8 : uni, D = det * det;
    if (N !== this.cN || blend !== this.cB || pitch !== this.cP || D !== this.cD) {
      let ws = 0;
      const edge = N > 1 ? 1 / (N - 1) + 1e-9 : 1;
      const h = (N - 1) / 2;
      for (let j = 0; j < N; j++) {
        // places -1..1, each pair a mirror image (a little seeded jitter, so no two pairs beat alike)
        const x0 = N > 1 ? -1 + 2 * j / (N - 1) : 0;
        this.x[j] = N === 1 || j === h ? 0 : j < h ? x0 + 0.06 * this.jit[j] : x0 - 0.06 * this.jit[N - 1 - j];
        const w = (x0 < 0 ? -x0 : x0) <= edge ? 1 : blend; this.wn[j] = w; ws += w * w;
      }
      const gn = ws > 1e-12 ? 1 / Math.sqrt(ws) : 0;
      for (let j = 0; j < 8; j++) this.wn[j] = j < N ? this.wn[j] * gn : 0;
      let dmax = 0;
      for (let j = 0; j < 8; j++) { const inc = 440 * Math.exp((pitch + this.x[j] * D - 69) * LG) / sr; this.inc[j] = inc; if (j < N && inc > dmax) dmax = inc; }
      this.dmax = dmax; this.cP = pitch; this.cB = blend; this.cD = D;
      this.cL = NaN;   // (the gains follow the weights)
    }
    // their gains: level, the blend's weight, pan and spread, equal power; targets smoothed 5 ms, ramped per sample
    if (N !== this.cN || level !== this.cL || spread !== this.cS || pan !== this.cPan) {
      for (let j = 0; j < 8; j++) {
        let L = 0, R = 0;
        if (j < N) {
          let p = pan + this.x[j] * spread; p = p < -1 ? -1 : p > 1 ? 1 : p;
          const a = (p + 1) * QP, g = level * this.wn[j] * SQ2;
          L = g * Math.cos(a); R = g * Math.sin(a);
        }
        this.ql[j] = L; this.qr[j] = R;
      }
      this.cN = N; this.cL = level; this.cS = spread; this.cPan = pan;
    }
    let U = 0;
    for (let j = 0; j < 8; j++) {
      if (first) { this.tl[j] = this.ql[j]; this.tr[j] = this.qr[j]; this.gl[j] = this.tl[j]; this.gr[j] = this.tr[j]; }
      else { this.tl[j] += (this.ql[j] - this.tl[j]) * ks; this.tr[j] += (this.qr[j] - this.tr[j]) * ks; }
      this.dl[j] = (this.tl[j] - this.gl[j]) / m; this.dr[j] = (this.tr[j] - this.gr[j]) / m;
      if (j < N || this.tl[j] > 1e-7 || this.tr[j] > 1e-7 || this.gl[j] > 1e-7 || this.gr[j] > 1e-7) U = j + 1;
    }
    this.U = U; this.N = N; this.first = false;
    this.live = run === 2 || (run === 1 && (level > 1e-7 || this.gl[0] > 1e-7 || this.tl[0] > 1e-7 || this.gr[0] > 1e-7 || U > N));
    // the warp's working value at the end of the step; a warp may not push the wave past the band limit (SYNC's ratio
    // and PW's squeeze give way at the top of the keys)
    let w1 = this.warpVal(this.mode, this.amt);
    if (this.mode === 1) { const r = 0.9 * sh.flim / (this.dmax > 1e-9 ? this.dmax : 1e-9); if (w1 > r) w1 = r < 1 ? 1 : r; }
    else if (this.mode === 3) { const w = 4.5 * this.dmax / sh.flim; if (w1 < w) w1 = w > 1 ? 1 : w; }
    this.dwv = (w1 - this.wv) / m;
    // the band limit: the mip whose top harmonic stays under the limit at this pitch, the warp counted
    const wv = this.wv > w1 ? this.wv : w1, wmin = this.wv < w1 ? this.wv : w1, md = this.mode;
    const wf = md === 1 ? wv : md === 2 ? 1 + wv : md === 3 ? 3.2 / (wmin < 0.05 ? 0.05 : wmin) : md === 4 && wv > 0 ? 4.5 : md === 5 ? 1 + 4 * wv : 1;
    const x = sh.osc[o], s0 = sh.stores[x.cur], s1 = x.nxt >= 0 ? sh.stores[x.nxt] : s0;
    const t0 = s0.table, t1 = s1.table;
    if (wf !== this.cW || this.dmax !== this.cDm || t0 !== this.cT0 || t1 !== this.cT1) {
      // (MIRROR reads twice: the plain wave at its own mip, the mirrored one at the warp's)
      const c0 = TB[t0].cycles, c1 = TB[t1].cycles, wd = md === 4 ? 1 : wf;
      sh.mt = this.dmax * wd / c0; this.m0 = sh.mip(); sh.mt = this.dmax * wd / c1; this.m1 = sh.mip();
      if (md === 4) { sh.mt = this.dmax * wf / c0; this.n0 = sh.mip(); sh.mt = this.dmax * wf / c1; this.n1 = sh.mip(); } else { this.n0 = this.m0; this.n1 = this.m1; }
      this.cW = wf; this.cDm = this.dmax; this.cT0 = t0; this.cT1 = t1;
    }
  }
  // the warp's working value for an amount: SYNC its ratio (1..8), BEND its depth, PW the pulse's width (1..0.05),
  // MIRROR its mix, FM its depth in cycles
  warpVal(mode, a) {
    if (mode === 1) return Math.pow(2, 3 * a);
    if (mode === 2) return 0.95 * a;
    if (mode === 3) return 1 - 0.95 * a;
    if (mode === 4) return a;
    if (mode === 5) return 1.2 * a * a;
    return 0;
  }
  // SYNC's reset, a sample ahead: the step (hh) and the change of slope (hkk) between table phases hu1 (where the
  // next cycle starts) and hu0 (where this one ends), read from hT at offsets hA / hB (n samples, frame weight hfw)
  syncStep() {
    const T = this.hT, oa = this.hA, ob = this.hB, n = this.hn, fw = this.hfw, e = 1 / n;
    let h = 0, k = 0;
    for (let q = 0; q < 2; q++) {
      const u = q ? this.hu0 : this.hu1, sg = q ? -1 : 1;
      for (let t = -1; t <= 1; t++) {
        let w = u + t * e; if (w >= 1) w -= 1; if (w < 0) w += 1;
        const xx = w * n, kk = xx | 0, fr = xx - kk;
        let a = T[oa + kk], b = T[ob + kk]; a += (T[oa + kk + 1] - a) * fr; b += (T[ob + kk + 1] - b) * fr;
        const y = a + (b - a) * fw;
        if (t === 0) h += sg * y; else k += sg * t * y * n * 0.5;
      }
    }
    this.hh = h; this.hkk = k;
  }
  // m samples into L, R (stereo, after level and pan) and M (the voices' sum before level and pan: an FM source)
  run(sh, o, m, L, R, M, fm) {
    if (!this.live) { for (let i = 0; i < m; i++) { L[i] = 0; R[i] = 0; M[i] = 0; } return; }
    const os = sh.osc[o], S0 = sh.stores[os.cur], T0 = S0.T, N0 = S0.near, cm0 = TB[S0.table].cycles - 1, ic0 = 1 / (cm0 + 1);
    const xf = os.nxt >= 0, S1 = xf ? sh.stores[os.nxt] : S0, T1 = S1.T, N1 = S1.near, cm1 = TB[S1.table].cycles - 1, ic1 = 1 / (cm1 + 1);
    const mo0 = MO[this.m0], mo1 = MO[this.m1], nn0 = MN[this.m0], nn1 = MN[this.m1], mm0 = MO[this.n0], mm1 = MO[this.n1], nm0 = MN[this.n0], nm1 = MN[this.n1];
    const mode = this.mode, U = this.U, ph = this.ph, cy = this.cy, inc = this.inc, gl = this.gl, gr = this.gr, dl = this.dl, dr = this.dr, wn = this.wn, hs = this.hs, hk = this.hk;
    let pos = this.pos, wv = this.wv, xw = this.xw;
    const dpos = this.dpos, dwv = this.dwv, dxw = this.dxw;
    for (let i = 0; i < m; i++) {
      pos += dpos; wv += dwv;
      const fp = (pos < 0 ? 0 : pos > 1 ? 1 : pos) * (F - 1);
      let f = fp | 0; if (f > F - 2) f = F - 2;
      const fw = fp - f;
      const a0 = N0[f] * FS, a1 = N0[f + 1] * FS, b0 = N1[f] * FS, b1 = N1[f + 1] * FS;
      const oA = a0 + mo0, oB = a1 + mo0, oC = b0 + mo1, oD = b1 + mo1;
      const fmv = mode === 5 && fm !== null ? fm[i] * wv : 0;
      let sl = 0, sr = 0, sm = 0;
      for (let j = 0; j < U; j++) {
        let p = ph[j] + inc[j], c = cy[j];
        if (p >= 1) { p -= 1; c = (c + 1) & 3; cy[j] = c; }
        ph[j] = p;
        // the warp: a map of the phase
        let q = p;
        if (mode === 1) { const t = p * wv; q = t - Math.floor(t); }
        else if (mode === 2) { const sx = p * 4096, si = sx | 0, sj = si & 4095; q = p - wv * I2P * (SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si)); }
        else if (mode === 3) { const xx = p < wv ? p / wv : 1, sx = xx * 4096, si = sx | 0, sj = si & 4095; q = xx - I2P * (SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si)); }
        else if (mode === 5) q = p + fmv;
        // the table: linear along the cycle and between frames (and between two tables while one fades in)
        let u = ((c & cm0) + q) * ic0; if (u >= 1 || u < 0) u -= Math.floor(u);
        let xx = u * nn0, k = xx | 0, fr = xx - k;
        let ra = T0[oA + k], rb = T0[oB + k]; ra += (T0[oA + k + 1] - ra) * fr; rb += (T0[oB + k + 1] - rb) * fr;
        let y = ra + (rb - ra) * fw;
        if (xf) {
          let u1 = ((c & cm1) + q) * ic1; if (u1 >= 1 || u1 < 0) u1 -= Math.floor(u1);
          xx = u1 * nn1; k = xx | 0; fr = xx - k;
          ra = T1[oC + k]; rb = T1[oD + k]; ra += (T1[oC + k + 1] - ra) * fr; rb += (T1[oD + k + 1] - rb) * fr;
          y += (ra + (rb - ra) * fw - y) * xw;
        }
        // The warps are smooth maps of the phase (BEND, PW, MIRROR: no corners, so nothing to alias beyond the faster
        // reading the mip allows for), except SYNC, whose reset is a step and a corner: a polyBLEP and a polyBLAMP
        // smooth them, scaled by the step and the change of slope read from the table a sample ahead.
        const d = inc[j];
        if (mode === 3) {
          // PW's first eighth of travel fades in from the plain wave (every warp at 0 is the plain wave)
          const mp = (1 - wv) * 8.421052631578947;
          if (mp < 1) {
            let w = ((c & cm0) + p) * ic0; if (w >= 1) w -= Math.floor(w);
            xx = w * nn0; k = xx | 0; fr = xx - k;
            ra = T0[oA + k]; rb = T0[oB + k]; ra += (T0[oA + k + 1] - ra) * fr; rb += (T0[oB + k + 1] - rb) * fr;
            const y0 = ra + (rb - ra) * fw;
            y = y0 + (y - y0) * mp;
          }
        } else if (mode === 4) {
          if (wv > 0) {
            // MIRROR: the cycle read forward then back, slowing to a stop at each turn (0.5 - 0.5 cos)
            const pp = p + 0.25 >= 1 ? p - 0.75 : p + 0.25, sx = pp * 4096, si = sx | 0, sj = si & 4095;
            const qm = 0.5 - 0.5 * (SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si));
            let um = ((c & cm0) + qm) * ic0; if (um >= 1) um -= Math.floor(um);
            const e0 = a0 + mm0, e1 = a1 + mm0;
            xx = um * nm0; k = xx | 0; fr = xx - k;
            ra = T0[e0 + k]; rb = T0[e1 + k]; ra += (T0[e0 + k + 1] - ra) * fr; rb += (T0[e1 + k + 1] - rb) * fr;
            let ym = ra + (rb - ra) * fw;
            if (xf) {
              let w = ((c & cm1) + qm) * ic1; if (w >= 1) w -= Math.floor(w);
              const g0 = b0 + mm1, g1 = b1 + mm1;
              xx = w * nm1; k = xx | 0; fr = xx - k;
              ra = T1[g0 + k]; rb = T1[g1 + k]; ra += (T1[g0 + k + 1] - ra) * fr; rb += (T1[g1 + k + 1] - rb) * fr;
              ym += (ra + (rb - ra) * fw - ym) * xw;
            }
            y += (ym - y) * wv;
          }
        } else if (mode === 1) {
          if (p > 1 - d) {
            const fq = wv - Math.floor(wv);
            let ub = ((c & cm0) + (fq < 1e-9 ? 1 : fq)) * ic0; if (ub >= 1) ub -= Math.floor(ub);
            this.hT = T0; this.hA = oA; this.hB = oB; this.hn = nn0; this.hfw = fw; this.hu1 = ((c + 1) & cm0) * ic0; this.hu0 = ub;
            this.syncStep();
            hs[j] = this.hh; hk[j] = this.hkk * wv * ic0;
          }
          if (p > 1 - d) { const t = (p - 1) / d, bl = t * t + t + t + 1, bm = (1 + t) * (1 + t) * (1 + t) / 6; y += 0.5 * hs[j] * bl + hk[j] * d * bm; }
          else if (p < d) { const t = p / d, bl = t + t - t * t - 1, bm = (1 - t) * (1 - t) * (1 - t) / 6; y += 0.5 * hs[j] * bl + hk[j] * d * bm; }
        }
        sl += y * gl[j]; sr += y * gr[j]; sm += y * wn[j];
        gl[j] += dl[j]; gr[j] += dr[j];
      }
      L[i] = sl; R[i] = sr; M[i] = sm;
      xw += dxw; if (xw > 1) xw = 1;
    }
    this.pos = pos; this.wv = wv;
  }
}

// One voice's whole engine: two oscillators, the sub and the noise, the filter, three envelopes, four LFOs, the mod
// matrix. Everything it needs is allocated here, once.
class Engine {
  constructor(sr, sh, r, idx) {
    this.sr = sr; this.sh = sh; this.idx = idx;
    this.oa = new Osc(sr, r); this.ob = new Osc(sr, r);
    this.e1 = new Env(sr); this.e2 = new Env(sr); this.e3 = new Env(sr);
    this.ev = new Float64Array(5);                                   // an envelope's five params, for its set()
    this.lf = [new Lfo(), new Lfo(), new Lfo(), new Lfo()];
    this.src = new Float64Array(16); this.dst = new Float64Array(38); this.am = new Float64Array(8);
    this.cs = new Int32Array(8); this.cdst = new Int32Array(8); this.ps = new Int32Array(8); this.pd = new Int32Array(8); this.fd = new Float64Array(8);
    this.aL = new Float32Array(CR); this.aR = new Float32Array(CR); this.aM = new Float32Array(CR);
    this.bL = new Float32Array(CR); this.bR = new Float32Array(CR); this.bM = new Float32Array(CR);
    this.su = new Float32Array(CR); this.nL = new Float32Array(CR); this.nR = new Float32Array(CR); this.eb = new Float32Array(CR);
    this.iL = new Float32Array(CR); this.iR = new Float32Array(CR); this.oL = new Float32Array(CR); this.oR = new Float32Array(CR);
    this.qL = new Float32Array(CR); this.qR = new Float32Array(CR); this.dL = new Float32Array(CR); this.dR = new Float32Array(CR);
    this.cb = new Float32Array(8192); this.cbUsed = false;            // COMB: two 4096-sample lines (L, then R)
    this.fz = new Float64Array(12);                                  // FORMANT: three SVFs a side
    this.fvk = new Float64Array(3); this.fva1 = new Float64Array(3); this.fva2 = new Float64Array(3); this.fva3 = new Float64Array(3); this.fvg = new Float64Array(3);
    this.k = new Float64Array(20);                                   // knobs, smoothed
    this.rnd = r;
    this.ns1 = ((r() + 1) * 1e9) >>> 0 || 1; this.ns2 = ((r() + 1) * 7e8) >>> 0 || 7;
    this.lr = 0; this.lm = 0; this.fcN = 1000; this.resN = 0;
    this.reset();
  }
  reset() {
    this.p = 60; this.vel = 0.8; this.vq = 0; this.rv = 0; this.gFrom = 60; this.gTo = 60; this.gT = 1; this.gD = 0; this.pitch = 60;
    this.subPh = 0; this.nl = 0; this.nr = 0; this.subLev = 0; this.noiseLev = 0; this.subInc = 0; this.na = 0; this.ng = 0; this.nc = -1;
    this.s1 = 0; this.s2 = 0; this.t1 = 0; this.t2 = 0;
    this.l1 = 0; this.l2 = 0; this.l3 = 0; this.l4 = 0; this.r1 = 0; this.r2 = 0; this.r3 = 0; this.r4 = 0;
    this.fz.fill(0);
    if (this.cbUsed) { this.cb.fill(0); this.cbUsed = false; }
    this.cw = 0; this.cz = 0; this.cz2 = 0;
    this.ft = -1; this.fp = -1; this.fx = 0; this.fmOrder = 0; this.drv = 0; this.res = 0;
    this.ra = 1; this.rb = 1; this.rs = 1; this.rn = 1;
    this.amp = 1; this.pl = 1; this.pr = 1; this.dAmp = 0; this.dpl = 0; this.dpr = 0; this.vph = 0;
    this.e1.kill(); this.e2.kill(); this.e3.kill();
    for (let l = 0; l < 4; l++) { const L = this.lf[l]; L.cfg = -1; L.xo = 0; L.y = 0; L.out = 0; L.ph = 0; L.n = 0; }
    this.dst.fill(0);
    this.cut0 = NaN; this.cutO = 0; this.csp = NaN; this.cpn = NaN; this.qpl = 1; this.qpr = 1; this.cfc = NaN; this.cres = NaN; this.ct = -9; this.cu = -9;
    this.blk = -1; this.off = 0; this.first = true;
  }
  // a note: fresh (poly, or a silent mono engine), a retrigger, or (legato) only a new pitch
  trigger(p, v, P, from, legato) {
    const sh = this.sh;
    this.p = p;
    const g = P.voice_glide;
    if (from >= 0 && g > 0) { this.gFrom = from; this.gTo = p; this.gT = 0; this.gD = 1 / Math.max(1, g / 1000 * this.sr); }
    else { this.gFrom = p; this.gTo = p; this.gT = 1; }
    if (this.blk !== sh.blk) { this.blk = sh.blk; this.off = sh.pos; }
    if (legato) return;
    this.vel = v; this.vq = 1 - Math.pow(v, 1.4); this.rv = this.rnd();
    const fresh = this.e1.st === 0;
    this.e1.on(); this.e2.on(); this.e3.on();
    for (let l = 0; l < 4; l++) { const L = this.lf[l]; L.ph = 0; L.n = 0; L.salt = ((this.rnd() + 1) * 50000) | 0; }
    if (fresh) { this.oa.start(this.rnd, P.a_unison); this.ob.start(this.rnd, P.b_unison); this.subPh = 0; this.first = true; }
  }
  pitchNow() { const t = this.gT >= 1 ? 1 : this.gT * this.gT * (3 - 2 * this.gT); return this.gFrom + (this.gTo - this.gFrom) * t; }
  release() { this.e1.off(); this.e2.off(); this.e3.off(); }
  active() { return this.e1.st !== 0; }

  // a mod slot's (source, destination) now; a change crossfades over 10 ms
  route(j, s, d, m) {
    if (this.first) { this.cs[j] = s; this.cdst[j] = d; this.fd[j] = 1; return; }
    if (s !== this.cs[j] || d !== this.cdst[j]) { this.ps[j] = this.cs[j]; this.pd[j] = this.cdst[j]; this.cs[j] = s; this.cdst[j] = d; this.fd[j] = 0; }
    else if (this.fd[j] < 1) { this.fd[j] += m / (0.01 * this.sr); if (this.fd[j] > 1) this.fd[j] = 1; }
  }

  render(L, R, n, P, T) {
    const sh = this.sh;
    if (this.blk !== sh.blk) { this.blk = sh.blk; this.off = 0; }
    for (let s = 0; s < n; s += CR) {
      const m = n - s < CR ? n - s : CR;
      this.ctrl(P, T, m);
      this.audio(L, R, s, m, P);
      this.off += m;
    }
    if (this.off > sh.pos) sh.pos = this.off;
    return this.e1.st !== 0;
  }

  ctrl(P, T, m) {
    const sh = this.sh, sr = this.sr, k = this.k, first = this.first, full = m === CR;
    const ks = first ? 1 : full ? sh.k3 : kx(m, 0.003, sr);
    const ev = this.ev;
    ev[0] = P.env1_attack; ev[1] = P.env1_decay; ev[2] = P.env1_sustain; ev[3] = P.env1_release; ev[4] = P.env1_curve; this.e1.set(ev);
    ev[0] = P.env2_attack; ev[1] = P.env2_decay; ev[2] = P.env2_sustain; ev[3] = P.env2_release; ev[4] = P.env2_curve; this.e2.set(ev);
    ev[0] = P.env3_attack; ev[1] = P.env3_decay; ev[2] = P.env3_sustain; ev[3] = P.env3_release; ev[4] = P.env3_curve; this.e3.set(ev);
    // the sources, as they stand at the start of this step
    const S = this.src, D = this.dst;
    S[0] = 0; S[1] = this.e1.v; S[2] = this.e2.v; S[3] = this.e3.v;
    this.e2.adv(m); this.e3.adv(m);
    const wheel = T && T.mod > 0 ? T.mod : 0;
    S[8] = this.vel; S[9] = (this.p - 60) / 48; S[10] = wheel;
    S[11] = P.macro1; S[12] = P.macro2; S[13] = P.macro3; S[14] = P.macro4; S[15] = this.rv;
    // the matrix's routes, then the LFOs a slot uses (their rates read the previous step's destinations: a step's lag
    // nobody hears), then the matrix: slots aimed at other slots' amounts first, then the rest
    this.route(0, P.m1_src | 0, P.m1_dst | 0, m); this.route(1, P.m2_src | 0, P.m2_dst | 0, m); this.route(2, P.m3_src | 0, P.m3_dst | 0, m); this.route(3, P.m4_src | 0, P.m4_dst | 0, m);
    this.route(4, P.m5_src | 0, P.m5_dst | 0, m); this.route(5, P.m6_src | 0, P.m6_dst | 0, m); this.route(6, P.m7_src | 0, P.m7_dst | 0, m); this.route(7, P.m8_src | 0, P.m8_dst | 0, m);
    const A = this.am, cs = this.cs, cd = this.cdst, ps = this.ps, pd = this.pd, fd = this.fd;
    let used = 0;
    for (let j = 0; j < 8; j++) { if (cd[j] > 0) used |= 1 << cs[j]; if (fd[j] < 1 && pd[j] > 0) used |= 1 << ps[j]; }
    if (used & 16) { this.lr = P.lfo1_rate; this.lm = D[22]; this.lfo(0, P.lfo1_shape | 0, P.lfo1_sync | 0, P.lfo1_mode | 0, m, T); } else S[4] = 0;
    if (used & 32) { this.lr = P.lfo2_rate; this.lm = D[23]; this.lfo(1, P.lfo2_shape | 0, P.lfo2_sync | 0, P.lfo2_mode | 0, m, T); } else S[5] = 0;
    if (used & 64) { this.lr = P.lfo3_rate; this.lm = D[24]; this.lfo(2, P.lfo3_shape | 0, P.lfo3_sync | 0, P.lfo3_mode | 0, m, T); } else S[6] = 0;
    if (used & 128) { this.lr = P.lfo4_rate; this.lm = D[25]; this.lfo(3, P.lfo4_shape | 0, P.lfo4_sync | 0, P.lfo4_mode | 0, m, T); } else S[7] = 0;
    A[0] = P.m1_amt; A[1] = P.m2_amt; A[2] = P.m3_amt; A[3] = P.m4_amt; A[4] = P.m5_amt; A[5] = P.m6_amt; A[6] = P.m7_amt; A[7] = P.m8_amt;
    for (let i = 0; i < 38; i++) D[i] = 0;
    let usesWheel = false;
    for (let j = 0; j < 8; j++) {
      const d = cd[j]; if (d >= 26 && d <= 33) A[d - 26] += A[j] * S[cs[j]] * fd[j];
      const q = pd[j]; if (fd[j] < 1 && q >= 26 && q <= 33) A[q - 26] += A[j] * S[ps[j]] * (1 - fd[j]);
    }
    for (let j = 0; j < 8; j++) {
      const a = A[j] < -1 ? -1 : A[j] > 1 ? 1 : A[j], d = cd[j], s = cs[j];
      if (d > 0 && d < 26) D[d] += a * S[s] * fd[j];
      if (fd[j] < 1) { const q = pd[j]; if (q > 0 && q < 26) D[q] += a * S[ps[j]] * (1 - fd[j]); }
      if (s === 10 && d > 0) usesWheel = true;
    }
    if (sh.newest === this) for (let i = 0; i < 16; i++) sh.vsrc[i] = S[i];
    // pitch: glide, bend, PITCH and FINE, and the wheel's vibrato while no slot uses the wheel
    if (this.gT < 1) { this.gT += m * this.gD; if (this.gT > 1) this.gT = 1; }
    const gt = this.gT >= 1 ? 1 : this.gT * this.gT * (3 - 2 * this.gT);
    let pitch = this.gFrom + (this.gTo - this.gFrom) * gt + (T && T.bend ? T.bend : 0) + 24 * D[18] + D[19];
    if (wheel > 0 && !usesWheel) {
      this.vph += m * 5.5 / sr; if (this.vph >= 1) this.vph -= 1;
      const sx = this.vph * 4096, si = sx | 0, sj = si & 4095;
      pitch += wheel * 0.35 * (SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si));
    }
    this.pitch = pitch;
    // the knobs, smoothed (3 ms)
    k[0] += (P.a_warp_amt - k[0]) * ks; k[1] += (P.a_detune - k[1]) * ks; k[2] += (P.a_blend - k[2]) * ks; k[3] += (P.a_spread - k[3]) * ks;
    k[4] += (P.a_pan - k[4]) * ks; k[5] += (P.a_level - k[5]) * ks; k[6] += (P.a_pos - k[6]) * ks;
    k[7] += (P.b_warp_amt - k[7]) * ks; k[8] += (P.b_detune - k[8]) * ks; k[9] += (P.b_blend - k[9]) * ks; k[10] += (P.b_spread - k[10]) * ks;
    k[11] += (P.b_pan - k[11]) * ks; k[12] += (P.b_level - k[12]) * ks; k[13] += (P.b_pos - k[13]) * ks;
    k[14] += (P.sub_level - k[14]) * ks; k[15] += (P.noise_level - k[15]) * ks; k[17] += (P.flt_res - k[17]) * ks; k[18] += (P.flt_drive - k[18]) * ks;
    // the oscillators (an FM warp's source renders even at level 0)
    const ks5 = first ? 1 : full ? sh.k5 : kx(m, 0.005, sr);
    const aw = P.a_warp | 0, bw = P.b_warp | 0, fmA = aw === 5, fmB = bw === 5;
    let x;
    const va = this.oa.v;
    x = k[0] + D[2]; va[0] = x < 0 ? 0 : x > 1 ? 1 : x;
    x = k[1] + D[6]; va[1] = x < 0 ? 0 : x > 1 ? 1 : x;
    va[2] = k[2]; va[3] = k[3];
    x = k[4] + 2 * D[5]; va[4] = x < -1 ? -1 : x > 1 ? 1 : x;
    x = k[5] + D[4]; va[5] = x < 0 ? 0 : x > 1 ? 1 : x;
    va[6] = pitch + 12 * P.a_oct + P.a_semi + P.a_fine / 100 + 24 * D[3];
    x = k[6] + D[1]; va[7] = x < 0 ? 0 : x > 1 ? 1 : x;
    va[8] = ks5;
    this.oa.ctrl(sh, 0, aw, P.a_unison | 0, m, fmB ? 2 : 1);
    const vb = this.ob.v;
    x = k[7] + D[8]; vb[0] = x < 0 ? 0 : x > 1 ? 1 : x;
    x = k[8] + D[12]; vb[1] = x < 0 ? 0 : x > 1 ? 1 : x;
    vb[2] = k[9]; vb[3] = k[10];
    x = k[11] + 2 * D[11]; vb[4] = x < -1 ? -1 : x > 1 ? 1 : x;
    x = k[12] + D[10]; vb[5] = x < 0 ? 0 : x > 1 ? 1 : x;
    vb[6] = pitch + 12 * P.b_oct + P.b_semi + P.b_fine / 100 + 24 * D[9];
    x = k[13] + D[7]; vb[7] = x < 0 ? 0 : x > 1 ? 1 : x;
    vb[8] = ks5;
    this.ob.ctrl(sh, 1, bw, P.b_unison | 0, m, fmA ? 2 : 1);
    this.fmOrder = fmA ? 1 : 0;
    // the sub and the noise
    x = k[14] + D[13]; this.subLev = x < 0 ? 0 : x > 1 ? 1 : x;
    x = k[15] + D[14]; this.noiseLev = x < 0 ? 0 : x > 1 ? 1 : x;
    const sp = pitch - 12 * (1 + (P.sub_oct | 0));
    if (sp !== this.csp) { this.csp = sp; this.subInc = 440 * Math.exp((sp - 69) * LG) / sr; }
    if (P.noise_color !== this.nc) {
      const nf = 150 * Math.pow(20000 / 150, P.noise_color), na = 1 - Math.exp(-6.283185307179586 * Math.min(nf, 0.45 * sr) / sr);
      this.na = na; this.ng = Math.min(8, Math.sqrt((2 - na) / na)) * 0.6; this.nc = P.noise_color;
    }
    // routings: a switch glides over 10 ms
    const kr = first ? 1 : full ? sh.k10 : kx(m, 0.01, sr);
    this.ra += ((P.flt_a | 0) - this.ra) * kr; this.rb += ((P.flt_b | 0) - this.rb) * kr; this.rs += ((P.flt_sub | 0) - this.rs) * kr; this.rn += ((P.flt_noise | 0) - this.rn) * kr;
    // the filter: the knob, the keys, envelope 2 (harder notes a little further) and the matrix
    const ft = P.flt_type | 0;
    if (this.ft < 0) { this.ft = ft; this.fx = 0; this.clearFilter(ft); }
    else if (ft !== this.ft) { this.fp = this.ft; this.ft = ft; this.fx = 1; this.clearFilter(ft); }
    if (P.flt_cutoff !== this.cut0) { this.cut0 = P.flt_cutoff; this.cutO = Math.log2(P.flt_cutoff / 20) / CUT_OCT; }
    k[16] += (this.cutO - k[16]) * ks;
    x = k[16] + D[15];
    const oct = x < 0 ? 0 : x > 1 ? 1 : x;
    let fc = 20 * Math.exp(oct * 6.907755278982137 + 0.6931471805599453 * (P.flt_key * (this.p - 60) / 12 + 6 * P.flt_env * this.e2.v * (0.6 + 0.5 * this.vel) + 2 * P.flt_vel * (this.vel - 0.8)));
    fc = fc < 16 ? 16 : fc > 0.47 * sr ? 0.47 * sr : fc;
    x = k[17] + D[16]; this.res = x < 0 ? 0 : x > 1 ? 1 : x;
    x = k[18] + D[17]; this.drv = x < 0 ? 0 : x > 1 ? 1 : x;
    this.fcN = fc; this.resN = this.res;
    this.coef(this.ft, this.fx > 0 ? this.fp : -1);
    // the amp: velocity, AMP and PAN from the matrix, ramped over the step
    const amp = (D[20] < -1 ? 0 : D[20] > 1 ? 2 : 1 + D[20]) * (1 - P.env1_vel * this.vq);
    x = D[21] * 2;
    const pn = x < -1 ? -1 : x > 1 ? 1 : x;
    if (pn !== this.cpn) { this.cpn = pn; const ang = (pn + 1) * QP; this.qpl = Math.cos(ang) * SQ2; this.qpr = Math.sin(ang) * SQ2; }
    const pl = this.qpl, pr = this.qpr;
    if (first) { this.amp = amp; this.pl = pl; this.pr = pr; }
    this.dAmp = (amp - this.amp) / m; this.dpl = (pl - this.pl) / m; this.dpr = (pr - this.pr) / m;
    this.first = false;
  }

  // LFO l's value for this step (FREE: the shared phase, locked to the song's beat while it plays). Its rate and the
  // rate's modulation arrive in this.lr and this.lm
  lfo(l, shape, sync, mode, m, T) {
    const sh = this.sh, sr = this.sr, L = this.lf[l], rate = this.lr;
    const cfg = shape + 8 * sync + 256 * mode, bpm = T && T.bpm > 0 ? T.bpm : 120;
    let ph, n;
    if (mode === 0) {
      let b;
      if (sync) b = T && T.playing ? (T.beat + this.off * bpm / 60 / sr) / SYNC_BEATS[sync] : (sh.clock + this.off) * bpm / 60 / sr / SYNC_BEATS[sync];
      else b = sh.lacc[l] + this.off * rate / sr;
      n = Math.floor(b); ph = b - n; n = (n | 0) + 977 * (l + 1);
    } else {
      ph = L.ph; n = L.n + L.salt;
      if (mode === 2 && L.n >= 1) { ph = 0.999999; n = L.salt; }
      const hz = sync ? bpm / 60 / SYNC_BEATS[sync] : this.lm !== 0 ? rate * Math.pow(2, this.lm * RATE_OCT) : rate;
      L.ph += m * hz / sr;
      if (L.ph >= 1) { const w = Math.floor(L.ph); L.ph -= w; L.n += w; }
    }
    let v;
    if (shape === 0) { const sx = ph * 4096, si = sx | 0, sj = si & 4095; v = SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si); }
    else if (shape === 1) v = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
    else if (shape === 2) v = 2 * ph - 1;
    else if (shape === 3) v = 1 - 2 * ph;
    else if (shape === 4) v = ph < 0.5 ? 1 : -1;
    else {
      // S&H and DRIFT: a value in -1..1 for each cycle n (a hash: the same in every render), DRIFT eased between two
      let h = (n | 0) ^ 0x2545f491; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
      const a = (h >>> 0) / 2147483648 - 1;
      if (shape === 5) v = a;
      else {
        let h2 = ((n + 1) | 0) ^ 0x2545f491; h2 = Math.imul(h2 ^ (h2 >>> 16), 0x85ebca6b); h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35); h2 ^= h2 >>> 16;
        v = a + ((h2 >>> 0) / 2147483648 - 1 - a) * ph * ph * (3 - 2 * ph);
      }
    }
    if (shape === 4 || shape === 5) { if (L.cfg < 0) L.y = v; L.y += (v - L.y) * (m === CR ? sh.k2 : kx(m, 0.002, sr)); v = L.y; } else L.y = v;
    if (L.cfg >= 0 && cfg !== L.cfg) L.xo = L.out - v;
    L.cfg = cfg;
    if (L.xo !== 0) { v += L.xo; L.xo *= m === CR ? sh.x4 : 1 - kx(m, 0.004, sr); if (L.xo < 1e-4 && L.xo > -1e-4) L.xo = 0; }
    L.out = v;
    this.src[4 + l] = v;
  }

  // filter coefficients for this step, from this.fcN and this.resN: the state-variable family always (cheap), the
  // ladder, the comb and the formant bank only when one of them is playing (t, or u fading out)
  coef(t, u) {
    const fc = this.fcN, res = this.resN;
    if (fc === this.cfc && res === this.cres && t === this.ct && u === this.cu) return;
    this.cfc = fc; this.cres = res; this.ct = t; this.cu = u;
    const sr = this.sr, g = Math.tan(Math.PI * fc / sr), kk = 1 / (0.55 * Math.pow(40, res));
    this.fk = kk; this.fa1 = 1 / (1 + g * (g + kk)); this.fa2 = g * this.fa1; this.fa3 = g * this.fa2;
    if (t === 1 || u === 1) { const G = g / (1 + g), G4 = G * G * G * G; this.lG = G; this.lk = 3.9 * res; this.lc = 1 + 0.5 * this.lk; this.lden = 1 / (1 + this.lk * G4); this.lgi = 1 / (1 + g); }
    if (t === 5 || u === 5) { const d = sr / fc; this.cdl = d < 2 ? 2 : d > 4000 ? 4000 : d; this.cg = 0.35 + 0.62 * res; }
    if (t === 6 || u === 6) {
      // the vowel: the cutoff's place between 150 Hz and 6 kHz picks it (U O A E I)
      let v = Math.log2(fc / 150) / Math.log2(40); v = v < 0 ? 0 : v > 1 ? 1 : v;
      const s = v * 4 >= 4 ? 3 : Math.floor(v * 4), w = v * 4 - s, o0 = s * 6, o1 = o0 + 6, k2 = 1 / (2 + 14 * res);
      for (let i = 0; i < 3; i++) {
        const f = Math.exp(Math.log(FV[o0 + i]) * (1 - w) + Math.log(FV[o1 + i]) * w), db = FV[o0 + 3 + i] * (1 - w) + FV[o1 + 3 + i] * w;
        const gg = Math.tan(Math.PI * Math.min(f, 0.45 * sr) / sr), a1 = 1 / (1 + gg * (gg + k2));
        this.fvk[i] = k2; this.fva1[i] = a1; this.fva2[i] = gg * a1; this.fva3[i] = gg * gg * a1; this.fvg[i] = Math.pow(10, db / 20);
      }
    }
  }
  clearFilter(t) {
    if (t === 1) { this.l1 = this.l2 = this.l3 = this.l4 = 0; this.r1 = this.r2 = this.r3 = this.r4 = 0; }
    else if (t === 5) { if (this.cbUsed) this.cb.fill(0); this.cz = 0; this.cz2 = 0; }
    else if (t === 6) this.fz.fill(0);
  }
  // m samples of filter type t from (iL, iR) into (oL, oR). DRIVE saturates the input (the ladder through its own
  // stage), with lib.js's rational tanh written out
  filter(t, iL, iR, oL, oR, m) {
    const drv = this.drv, dg = 1 + 14 * drv * drv, pre = drv > 1e-3, dmk = 2 * 4 / (1 + 3 * Math.sqrt(dg)), dh = dg * 0.5;
    if (t === 1) {
      const G = this.lG, k = this.lk, c = this.lc, den = this.lden, gi = this.lgi, G2 = G * G, G3 = G2 * G, G4 = G3 * G, gin = 0.12 * dg, gout = 1 / gin / (1 + 0.6 * drv);
      let a1 = this.l1, a2 = this.l2, a3 = this.l3, a4 = this.l4, b1 = this.r1, b2 = this.r2, b3 = this.r3, b4 = this.r4;
      for (let i = 0; i < m; i++) {
        let x = iL[i] * gin;
        let y4 = (G4 * c * x + G3 * gi * a1 + G2 * gi * a2 + G * gi * a3 + gi * a4) * den;
        let z = x * c - k * y4;
        let uu = z <= -3 ? -1 : z >= 3 ? 1 : (z * (27 + z * z)) / (27 + 9 * z * z);
        let v = (uu - a1) * G; let y1 = v + a1; a1 = y1 + v;
        v = (y1 - a2) * G; let y2 = v + a2; a2 = y2 + v;
        v = (y2 - a3) * G; let y3 = v + a3; a3 = y3 + v;
        v = (y3 - a4) * G; let y = v + a4; a4 = y + v;
        oL[i] = y * gout;
        x = iR[i] * gin;
        y4 = (G4 * c * x + G3 * gi * b1 + G2 * gi * b2 + G * gi * b3 + gi * b4) * den;
        z = x * c - k * y4;
        uu = z <= -3 ? -1 : z >= 3 ? 1 : (z * (27 + z * z)) / (27 + 9 * z * z);
        v = (uu - b1) * G; y1 = v + b1; b1 = y1 + v;
        v = (y1 - b2) * G; y2 = v + b2; b2 = y2 + v;
        v = (y2 - b3) * G; y3 = v + b3; b3 = y3 + v;
        v = (y3 - b4) * G; y = v + b4; b4 = y + v;
        oR[i] = y * gout;
      }
      this.l1 = a1; this.l2 = a2; this.l3 = a3; this.l4 = a4; this.r1 = b1; this.r2 = b2; this.r3 = b3; this.r4 = b4;
      return;
    }
    if (t === 5) {
      const cb = this.cb, D = this.cdl, g = this.cg, nrm = (1 - g) * 1.6 + 0.08, di = D | 0, df = D - di;
      let w = this.cw, z = this.cz, z2 = this.cz2;
      this.cbUsed = true;
      for (let i = 0; i < m; i++) {
        let xl = iL[i], xr = iR[i];
        if (pre) {
          let q = xl * dh; xl = (q <= -3 ? -1 : q >= 3 ? 1 : (q * (27 + q * q)) / (27 + 9 * q * q)) * dmk;
          q = xr * dh; xr = (q <= -3 ? -1 : q >= 3 ? 1 : (q * (27 + q * q)) / (27 + 9 * q * q)) * dmk;
        }
        const r0 = (w - di) & 4095, r1 = (w - di - 1) & 4095;
        const yl = cb[r0] + (cb[r1] - cb[r0]) * df, yr = cb[4096 + r0] + (cb[4096 + r1] - cb[4096 + r0]) * df;
        z += (yl - z) * 0.55; z2 += (yr - z2) * 0.55;
        const vl = xl + g * z, vr = xr + g * z2;
        cb[w] = vl; cb[4096 + w] = vr; w = (w + 1) & 4095;
        oL[i] = vl * nrm; oR[i] = vr * nrm;
      }
      this.cw = w; this.cz = z; this.cz2 = z2;
      return;
    }
    if (t === 6) {
      const z = this.fz, K = this.fvk, A1 = this.fva1, A2 = this.fva2, A3 = this.fva3, GN = this.fvg;
      for (let i = 0; i < m; i++) {
        let xl = iL[i], xr = iR[i];
        if (pre) {
          let q = xl * dh; xl = (q <= -3 ? -1 : q >= 3 ? 1 : (q * (27 + q * q)) / (27 + 9 * q * q)) * dmk;
          q = xr * dh; xr = (q <= -3 ? -1 : q >= 3 ? 1 : (q * (27 + q * q)) / (27 + 9 * q * q)) * dmk;
        }
        let yl = 0, yr = 0;
        for (let b = 0; b < 3; b++) {
          const o = b * 4, k = K[b], a1 = A1[b], a2 = A2[b], a3 = A3[b];
          let v3 = xl - z[o + 1], v1 = a1 * z[o] + a2 * v3, v2 = z[o + 1] + a2 * z[o] + a3 * v3;
          z[o] = 2 * v1 - z[o]; z[o + 1] = 2 * v2 - z[o + 1]; yl += k * v1 * GN[b];
          v3 = xr - z[o + 3]; v1 = a1 * z[o + 2] + a2 * v3; v2 = z[o + 3] + a2 * z[o + 2] + a3 * v3;
          z[o + 2] = 2 * v1 - z[o + 2]; z[o + 3] = 2 * v2 - z[o + 3]; yr += k * v1 * GN[b];
        }
        oL[i] = yl * 1.6; oR[i] = yr * 1.6;
      }
      return;
    }
    // the state-variable family: LP12 (0), HP (2), BP (3), NOTCH (4)
    const k = this.fk, a1 = this.fa1, a2 = this.fa2, a3 = this.fa3;
    let s1 = this.s1, s2 = this.s2, t1 = this.t1, t2 = this.t2;
    for (let i = 0; i < m; i++) {
      let xl = iL[i], xr = iR[i];
      if (pre) {
        let q = xl * dh; xl = (q <= -3 ? -1 : q >= 3 ? 1 : (q * (27 + q * q)) / (27 + 9 * q * q)) * dmk;
        q = xr * dh; xr = (q <= -3 ? -1 : q >= 3 ? 1 : (q * (27 + q * q)) / (27 + 9 * q * q)) * dmk;
      }
      let v3 = xl - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
      s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
      oL[i] = t === 0 ? v2 : t === 2 ? xl - k * v1 - v2 : t === 3 ? k * v1 : xl - k * v1;
      v3 = xr - t2; v1 = a1 * t1 + a2 * v3; v2 = t2 + a2 * t1 + a3 * v3;
      t1 = 2 * v1 - t1; t2 = 2 * v2 - t2;
      oR[i] = t === 0 ? v2 : t === 2 ? xr - k * v1 - v2 : t === 3 ? k * v1 : xr - k * v1;
    }
    this.s1 = s1; this.s2 = s2; this.t1 = t1; this.t2 = t2;
  }

  audio(L, R, s, m, P) {
    const sh = this.sh;
    // the oscillators: an FM target after its source (B first when A is FM'd); a table fading in weighs xw
    const xa = sh.osc[0], xb = sh.osc[1], off = this.off, oa = this.oa, ob = this.ob;
    oa.xw = xa.nxt >= 0 ? xa.xw + off * xa.dx : 0; oa.dxw = xa.dx; ob.xw = xb.nxt >= 0 ? xb.xw + off * xb.dx : 0; ob.dxw = xb.dx;
    if (this.fmOrder) { ob.run(sh, 1, m, this.bL, this.bR, this.bM, this.aM); oa.run(sh, 0, m, this.aL, this.aR, this.aM, this.bM); }
    else { oa.run(sh, 0, m, this.aL, this.aR, this.aM, this.bM); ob.run(sh, 1, m, this.bL, this.bR, this.bM, this.aM); }
    // the sub: a sine, a polyBLAMP triangle or a polyBLEP square
    const su = this.su, sl = this.subLev, sinc = this.subInc, shp = P.sub_shape | 0;
    if (sl > 1e-6) {
      let ph = this.subPh;
      for (let i = 0; i < m; i++) {
        ph += sinc; if (ph >= 1) ph -= 1;
        let y;
        if (shp === 0) { const sx = ph * 4096, si = sx | 0, sj = si & 4095; y = SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si); }
        else if (shp === 1) {
          y = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
          // the corners at a quarter (+ to -) and three quarters (- to +) of the cycle
          let t = ph + 0.75; if (t >= 1) t -= 1;
          if (t < sinc) { const w = 1 - t / sinc; y -= 4 * sinc * w * w * w / 6 * 2; } else if (t > 1 - sinc) { const w = 1 + (t - 1) / sinc; y -= 4 * sinc * w * w * w / 6 * 2; }
          t = ph + 0.25; if (t >= 1) t -= 1;
          if (t < sinc) { const w = 1 - t / sinc; y += 4 * sinc * w * w * w / 6 * 2; } else if (t > 1 - sinc) { const w = 1 + (t - 1) / sinc; y += 4 * sinc * w * w * w / 6 * 2; }
        } else {
          y = ph < 0.5 ? 1 : -1;
          if (ph < sinc) { const t = ph / sinc; y += t + t - t * t - 1; } else if (ph > 1 - sinc) { const t = (ph - 1) / sinc; y += t * t + t + t + 1; }
          let t2 = ph + 0.5; if (t2 >= 1) t2 -= 1;
          if (t2 < sinc) { const t = t2 / sinc; y -= t + t - t * t - 1; } else if (t2 > 1 - sinc) { const t = (t2 - 1) / sinc; y -= t * t + t + t + 1; }
          y *= 0.8;
        }
        su[i] = y * sl;
      }
      this.subPh = ph;
    } else for (let i = 0; i < m; i++) su[i] = 0;
    // noise: two seeded generators through a one-pole (its level held as the colour darkens)
    const nL = this.nL, nR = this.nR, nl = this.noiseLev;
    if (nl > 1e-6) {
      let a = this.ns1, b = this.ns2, zl = this.nl, zr = this.nr;
      const na = this.na, g = this.ng * nl;
      for (let i = 0; i < m; i++) {
        a = (Math.imul(a, 1664525) + 1013904223) >>> 0; b = (Math.imul(b, 22695477) + 1) >>> 0;
        zl += (a / 2147483648 - 1 - zl) * na; zr += (b / 2147483648 - 1 - zr) * na;
        nL[i] = zl * g; nR[i] = zr * g;
      }
      this.ns1 = a; this.ns2 = b; this.nl = zl; this.nr = zr;
    } else for (let i = 0; i < m; i++) { nL[i] = 0; nR[i] = 0; }
    // the filter's input, and what passes it by
    const ra = this.ra, rb = this.rb, rs = this.rs, rn = this.rn;
    const iL = this.iL, iR = this.iR, dL = this.dL, dR = this.dR, aL = this.aL, aR = this.aR, bL = this.bL, bR = this.bR;
    for (let i = 0; i < m; i++) {
      const s0 = su[i], tl = aL[i] + bL[i] + s0 + nL[i], tr = aR[i] + bR[i] + s0 + nR[i];
      iL[i] = aL[i] * ra + bL[i] * rb + s0 * rs + nL[i] * rn; iR[i] = aR[i] * ra + bR[i] * rb + s0 * rs + nR[i] * rn;
      dL[i] = tl - iL[i]; dR[i] = tr - iR[i];
    }
    const oL = this.oL, oR = this.oR;
    if (ra + rb + rs + rn > 1e-6 || this.fx > 0) {
      this.filter(this.ft, iL, iR, oL, oR, m);
      if (this.fx > 0) {
        // a new filter type crossfades in over 10 ms
        this.filter(this.fp, iL, iR, this.qL, this.qR, m);
        const qL = this.qL, qR = this.qR, d = 1 / (0.01 * this.sr);
        let x = this.fx;
        for (let i = 0; i < m; i++) { oL[i] += (qL[i] - oL[i]) * x; oR[i] += (qR[i] - oR[i]) * x; x -= d; if (x < 0) x = 0; }
        this.fx = x;
      }
    } else for (let i = 0; i < m; i++) { oL[i] = 0; oR[i] = 0; }
    // the amp
    const eb = this.eb;
    this.e1.fill(eb, m);
    let amp = this.amp, pl = this.pl, pr = this.pr;
    const da = this.dAmp, dpl = this.dpl, dpr = this.dpr;
    for (let i = 0; i < m; i++) {
      const e = eb[i] * amp * 0.3;
      L[s + i] += (oL[i] + dL[i]) * e * pl; R[s + i] += (oR[i] + dR[i]) * e * pr;
      amp += da; pl += dpl; pr += dpr;
    }
    this.amp = amp; this.pl = pl; this.pr = pr;
  }
}

// The room: lib.js's 8-line feedback delay network (Householder mixing, damping in every loop, a slowly wandering
// read in each line) as a class, its lines in one buffer, its input and output in fields.
class Room {
  constructor(sr, seed) {
    const N = 8, BASE = [1031, 1327, 1523, 1801, 2111, 2437, 2741, 3089], k = sr / 48000, rr = rng(seed ^ 0xf00d);
    this.k = k; this.sr = sr; this.BASE = Float64Array.from(BASE);
    let n = 1; while (n < Math.ceil(BASE[N - 1] * 1.8 * k) + 64 + 4) n <<= 1;
    this.LN = n; this.LM = n - 1; this.buf = new Float32Array(N * n); this.w = 0;
    this.len = new Float64Array(N); this.g = new Float64Array(N); this.lp = new Float64Array(N); this.x = new Float64Array(N);
    this.mph = new Float64Array(N); this.mdt = new Float64Array(N);
    for (let i = 0; i < N; i++) { this.mph[i] = (rr() + 1) / 2; this.mdt[i] = (0.07 + 0.11 * i / N + 0.03 * rr()) / sr; }
    this.a = 0; this.depth = 6 * k; this.lastS = -1; this.lastT = -1; this.lastD = -1;
    this.size = 0.5; this.t60 = 2; this.damp = 0.45; this.inL = 0; this.inR = 0; this.l = 0; this.r = 0;
  }
  // from this.size, this.t60 and this.damp
  set() {
    const size = this.size, t60 = this.t60, damp = this.damp;
    if (size === this.lastS && t60 === this.lastT && damp === this.lastD) return;
    this.lastS = size; this.lastT = t60; this.lastD = damp;
    const k = this.k, sr = this.sr, sc = (0.3 + 1.45 * (size < 0 ? 0 : size > 1 ? 1 : size)) * k;
    for (let i = 0; i < 8; i++) { this.len[i] = this.BASE[i] * sc; this.g[i] = Math.pow(10, -3 * this.len[i] / (Math.max(0.05, t60) * sr)); }
    this.a = Math.exp(-TAU * (16000 * Math.pow(0.05, damp < 0 ? 0 : damp > 1 ? 1 : damp)) / sr);
    this.depth = (3 + 9 * (size < 0 ? 0 : size > 1 ? 1 : size)) * k;
  }
  // one sample: this.inL / inR in, the wet this.l / r out
  tick() {
    const buf = this.buf, LN = this.LN, LM = this.LM, len = this.len, g = this.g, lp = this.lp, x = this.x, mph = this.mph, mdt = this.mdt, a = this.a, depth = this.depth, w = this.w;
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      let p = mph[i] + mdt[i]; if (p >= 1) p -= 1; mph[i] = p;
      const sx = p * 4096, si = sx | 0, sj = si & 4095;
      const rd = w - (len[i] + depth * (1 + SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si))), q = Math.floor(rd), f = rd - q, o = i * LN;
      const y0 = buf[o + ((q - 1) & LM)], y1 = buf[o + (q & LM)], y2 = buf[o + ((q + 1) & LM)], y3 = buf[o + ((q + 2) & LM)];
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      const v = ((c3 * f + c2) * f + c1) * f + y1;
      lp[i] = v + (lp[i] - v) * a;
      x[i] = lp[i] * g[i]; sum += x[i];
    }
    sum *= 0.25;
    const inL = this.inL, inR = this.inR;
    for (let i = 0; i < 8; i++) buf[i * LN + w] = x[i] - sum + ((i & 1) ? inR : inL);
    this.w = (w + 1) & LM;
    this.l = x[0] - x[2] + x[4] - x[6] + 0.5 * (x[1] - x[5]);
    this.r = x[1] - x[3] + x[5] - x[7] + 0.5 * (x[2] - x[6]);
  }
  clear() { this.buf.fill(0); this.lp.fill(0); }
}

// The FX after the voices: drive (lib.js's 2x half-band oversampler, written out; the dry path always 15 samples late,
// the oversampler's delay, so turning it on never jumps), chorus, a ping-pong delay synced to the song, the room; then
// the level, a DC blocker and lib.js's knee. Each effect sleeps (costs nothing) while its mix is at 0.
class Fx {
  constructor(sr, seed) {
    this.sr = sr;
    this.oxL = new Float64Array(16); this.ouL = new Float64Array(32); this.oxR = new Float64Array(16); this.ouR = new Float64Array(32); this.oxi = 0; this.oui = 0;
    this.dryL = new Float32Array(32); this.dryR = new Float32Array(32); this.dw = 0;
    let cn = 1; while (cn < Math.ceil(0.04 * sr) + 4) cn <<= 1;
    this.cN = cn; this.cM = cn - 1; this.chL = new Float32Array(cn); this.chR = new Float32Array(cn); this.cw = 0; this.cph = 0;
    let dn = 1; while (dn < Math.ceil(3.2 * sr) + 4) dn <<= 1;
    this.dM = dn - 1; this.dlL = new Float32Array(dn); this.dlR = new Float32Array(dn); this.dwi = 0;
    this.room = new Room(sr, seed ^ 0x51ab);
    const k = (ms) => Math.exp(-1 / (ms / 1000 * sr)), op = (hz) => Math.exp(-TAU * hz / sr);
    this.a30 = k(30); this.a40 = k(40); this.a60 = k(60); this.a160 = k(160);
    this.aLp = op(5200); this.aHp = op(140); this.aRh = op(160); this.aDc = Math.exp(-TAU * 10 / sr);
    this.gDrv = 0; this.gDm = 1; this.gCh = 0; this.gChD = 0.5; this.gDl = 0; this.gFb = 0.35; this.gVb = 0; this.gLv = 1; this.gT = 0.375 * sr;
    this.lp1 = 0; this.lp2 = 0; this.hp1 = 0; this.hp2 = 0; this.rh1 = 0; this.rh2 = 0; this.dcx1 = 0; this.dcy1 = 0; this.dcx2 = 0; this.dcy2 = 0;
    this.drvLive = false; this.chLive = false; this.dlLive = false; this.vbLive = false; this.first = true;
  }
  run(L, R, n, P, T, fxm) {
    const sr = this.sr;
    const bpm = T && T.bpm > 0 ? T.bpm : 120, dt0 = DELAY_BEATS[P.fx_delay_time | 0] * 60 / bpm * sr, dt = dt0 < 3.1 * sr ? dt0 : 3.1 * sr;
    let x;
    x = P.fx_drive + fxm[0]; const tDrv = x < 0 ? 0 : x > 1 ? 1 : x;
    x = P.fx_chorus_mix + fxm[1]; const tCh = x < 0 ? 0 : x > 1 ? 1 : x;
    x = P.fx_delay_mix + fxm[2]; const tDl = x < 0 ? 0 : x > 1 ? 1 : x;
    x = P.fx_verb_mix + fxm[3]; const tVb = x < 0 ? 0 : x > 1 ? 1 : x;
    const cDepth = P.fx_chorus_depth, fb = P.fx_delay_fb, dmT = P.fx_drive_mix, lv = Math.pow(10, P.voice_level / 20);
    if (this.first) { this.gDrv = tDrv; this.gDm = dmT; this.gCh = tCh; this.gChD = cDepth; this.gDl = tDl; this.gFb = fb; this.gVb = tVb; this.gLv = lv; this.gT = dt; this.first = false; }
    const room = this.room;
    room.size = 0.15 + 0.85 * P.fx_verb_size; room.t60 = 0.5 + 4.5 * P.fx_verb_size * P.fx_verb_size; room.damp = 0.45; room.set();
    if (tDrv > 0 && dmT > 0) this.drvLive = true;
    if (tCh > 0 && !this.chLive) { this.chL.fill(0); this.chR.fill(0); this.chLive = true; }
    if (tDl > 0 && !this.dlLive) { this.dlL.fill(0); this.dlR.fill(0); this.lp1 = this.lp2 = this.hp1 = this.hp2 = 0; this.dlLive = true; }
    if (tVb > 0 && !this.vbLive) { room.clear(); this.rh1 = this.rh2 = 0; this.vbLive = true; }
    const a30 = this.a30, a40 = this.a40, a60 = this.a60, a160 = this.a160, aLp = this.aLp, aHp = this.aHp, aRh = this.aRh, aDc = this.aDc;
    const dryL = this.dryL, dryR = this.dryR, oxL = this.oxL, ouL = this.ouL, oxR = this.oxR, ouR = this.ouR;
    const chL = this.chL, chR = this.chR, cM = this.cM, dlL = this.dlL, dlR = this.dlR, dM = this.dM;
    let dw = this.dw, cph = this.cph, cw = this.cw, dwi = this.dwi, oxi = this.oxi, oui = this.oui;
    let gDrv = this.gDrv, gDm = this.gDm, gCh = this.gCh, gChD = this.gChD, gDl = this.gDl, gFb = this.gFb, gVb = this.gVb, gLv = this.gLv, gT = this.gT;
    let lp1 = this.lp1, lp2 = this.lp2, hp1 = this.hp1, hp2 = this.hp2, rh1 = this.rh1, rh2 = this.rh2, dcx1 = this.dcx1, dcy1 = this.dcy1, dcx2 = this.dcx2, dcy2 = this.dcy2;
    let drvLive = this.drvLive, chLive = this.chLive, dlLive = this.dlLive, vbLive = this.vbLive;
    for (let i = 0; i < n; i++) {
      let l = L[i], r = R[i];
      // drive
      const pl = dryL[(dw - 15) & 31], pr = dryR[(dw - 15) & 31];
      dryL[dw] = l; dryR[dw] = r; dw = (dw + 1) & 31;
      gDrv = tDrv + (gDrv - tDrv) * a30; gDm = dmT + (gDm - dmT) * a30;
      if (drvLive) {
        const g = 1 + 24 * gDrv * gDrv, mk = 2 / (1 + 1.2 * gDrv), mx = gDrv < 0.05 ? gDm * gDrv * 20 : gDm;
        // 2x: up (the zero-stuffed input through the half-band, even taps then odd), the saturator twice, down
        oxL[oxi] = l * g * 0.5; oxR[oxi] = r * g * 0.5;
        const xs = oxi; oxi = (oxi + 1) & 15;
        let ua = 0, ub = 0, va = 0, vb = 0;
        for (let q = 0; q < 16; q++) { const h0 = HB[2 * q], h1 = 2 * q + 1 < 31 ? HB[2 * q + 1] : 0, xl = oxL[(xs - q) & 15], xr = oxR[(xs - q) & 15]; ua += h0 * xl; ub += h1 * xl; va += h0 * xr; vb += h1 * xr; }
        let z = 2 * ua; const yl0 = z <= -3 ? -1 : z >= 3 ? 1 : (z * (27 + z * z)) / (27 + 9 * z * z);
        z = 2 * ub; const yl1 = z <= -3 ? -1 : z >= 3 ? 1 : (z * (27 + z * z)) / (27 + 9 * z * z);
        z = 2 * va; const yr0 = z <= -3 ? -1 : z >= 3 ? 1 : (z * (27 + z * z)) / (27 + 9 * z * z);
        z = 2 * vb; const yr1 = z <= -3 ? -1 : z >= 3 ? 1 : (z * (27 + z * z)) / (27 + 9 * z * z);
        ouL[oui] = yl0; ouR[oui] = yr0;
        let wl = 0, wr = 0;
        for (let q = 0; q < 31; q++) { wl += HB[q] * ouL[(oui - q) & 31]; wr += HB[q] * ouR[(oui - q) & 31]; }
        ouL[(oui + 1) & 31] = yl1; ouR[(oui + 1) & 31] = yr1; oui = (oui + 2) & 31;
        wl *= mk; wr *= mk;
        l = pl + (wl - pl) * mx; r = pr + (wr - pr) * mx;
        if (gDrv < 1e-5 && tDrv === 0) drvLive = false;
      } else { l = pl; r = pr; }
      // chorus: two taps in quadrature, read cubic
      gCh = tCh + (gCh - tCh) * a30; gChD = cDepth + (gChD - cDepth) * a60;
      if (chLive) {
        cph += (0.25 + 0.6 * gChD) / sr; if (cph >= 1) cph -= 1;
        const c = 0.009 * sr, a = (0.0008 + 0.0042 * gChD) * sr, c2 = cph + 0.25 >= 1 ? cph - 0.75 : cph + 0.25;
        let sx = cph * 4096, si = sx | 0, sj = si & 4095;
        let rr = cw - (c + a * (SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si))), q = Math.floor(rr), f = rr - q;
        let y0 = chL[(q - 1) & cM], y1 = chL[q & cM], y2 = chL[(q + 1) & cM], y3 = chL[(q + 2) & cM];
        const yl = ((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f) + y1;
        sx = c2 * 4096; si = sx | 0; sj = si & 4095;
        rr = cw - (c + a * (SIN[sj] + (SIN[sj + 1] - SIN[sj]) * (sx - si))); q = Math.floor(rr); f = rr - q;
        y0 = chR[(q - 1) & cM]; y1 = chR[q & cM]; y2 = chR[(q + 1) & cM]; y3 = chR[(q + 2) & cM];
        const yr = ((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f) + y1;
        chL[cw] = l; chR[cw] = r; cw = (cw + 1) & cM;
        l = l * (1 - 0.3 * gCh) + yl * 0.75 * gCh; r = r * (1 - 0.3 * gCh) + yr * 0.75 * gCh;
        if (gCh < 1e-5 && tCh === 0) chLive = false;
      }
      // delay: ping-pong, each repeat darker (5.2 kHz) and thinner (140 Hz); read linear, before the write
      gDl = tDl + (gDl - tDl) * a30;
      if (dlLive) {
        gT = dt + (gT - dt) * a160; gFb = fb + (gFb - fb) * a40;
        const rr = dwi - gT, q = Math.floor(rr), f = rr - q;
        let ya = dlL[q & dM]; const yl = ya + (dlL[(q + 1) & dM] - ya) * f;
        ya = dlR[q & dM]; const yr = ya + (dlR[(q + 1) & dM] - ya) * f;
        const inl = 0.5 * (l + r) + yr * gFb, inr = yl * gFb;
        lp1 = inl + (lp1 - inl) * aLp; lp2 = inr + (lp2 - inr) * aLp;
        hp1 = lp1 + (hp1 - lp1) * aHp; hp2 = lp2 + (hp2 - lp2) * aHp;
        dlL[dwi] = lp1 - hp1; dlR[dwi] = lp2 - hp2; dwi = (dwi + 1) & dM;
        l += yl * gDl; r += yr * gDl;
        if (gDl < 1e-5 && tDl === 0) dlLive = false;
      }
      // the room (a little thinned below 160 Hz going in)
      gVb = tVb + (gVb - tVb) * a30;
      if (vbLive) {
        rh1 = l + (rh1 - l) * aRh; rh2 = r + (rh2 - r) * aRh;
        room.inL = (l - rh1) * 0.5; room.inR = (r - rh2) * 0.5; room.tick();
        l = l * (1 - 0.25 * gVb) + room.l * gVb * 0.55; r = r * (1 - 0.25 * gVb) + room.r * gVb * 0.55;
        if (gVb < 1e-5 && tVb === 0) vbLive = false;
      }
      // the level, the DC blocker, lib.js's knee (linear to 0.6, never past 0.88)
      gLv = lv + (gLv - lv) * a30;
      const ol = l * gLv, or = r * gLv;
      dcy1 = ol - dcx1 + aDc * dcy1; dcx1 = ol; dcy2 = or - dcx2 + aDc * dcy2; dcx2 = or;
      let o = dcy1, ab = o < 0 ? -o : o;
      L[i] = ab <= 0.6 ? o : (o < 0 ? -1 : 1) * (0.6 + 0.28 * Math.tanh((ab - 0.6) / 0.28));
      o = dcy2; ab = o < 0 ? -o : o;
      R[i] = ab <= 0.6 ? o : (o < 0 ? -1 : 1) * (0.6 + 0.28 * Math.tanh((ab - 0.6) / 0.28));
    }
    this.dw = dw; this.cph = cph; this.cw = cw; this.dwi = dwi; this.oxi = oxi; this.oui = oui;
    this.gDrv = gDrv; this.gDm = gDm; this.gCh = gCh; this.gChD = gChD; this.gDl = gDl; this.gFb = gFb; this.gVb = gVb; this.gLv = gLv; this.gT = gT;
    this.lp1 = lp1; this.lp2 = lp2; this.hp1 = hp1; this.hp2 = hp2; this.rh1 = rh1; this.rh2 = rh2; this.dcx1 = dcx1; this.dcy1 = dcy1; this.dcx2 = dcx2; this.dcy2 = dcy2;
    this.drvLive = drvLive; this.chLive = chLive; this.dlLive = dlLive; this.vbLive = vbLive;
  }
}

return {
  poly: 8,
  create({ sr, seed }) {
    const flim = Math.min(0.6, Math.max(0.45, (sr - 20000) / sr));
    const sh = {
      seed: seed >>> 0, sr, flim, blk: 0, pos: 0, clock: 0, newest: null, owner: null, lastPitch: -1, mt: 0,
      stores: [LT.store(), LT.store(), LT.store(), LT.store()],
      osc: [{ cur: 0, nxt: -1, xw: 0, dx: 1 / (0.03 * sr) }, { cur: 1, nxt: -1, xw: 0, dx: 1 / (0.03 * sr) }],
      sounded: false, lacc: new Float64Array(4), vsrc: new Float64Array(16), stack: new Int32Array(16), sn: 0,
      k2: kx(CR, 0.002, sr), k3: kx(CR, 0.003, sr), k5: kx(CR, 0.005, sr), k10: kx(CR, 0.01, sr), x4: 1 - kx(CR, 0.004, sr),
      // the mip for a phase increment (table cycles a sample, in sh.mt): its top harmonic under flim x sr
      mip() { const dt = sh.mt; if (!(dt > 0)) return 0; const x = Math.log2(1024 * dt / flim); return x <= 0 ? 0 : x >= 10 ? 10 : Math.ceil(x); },
    };
    // both oscillators start on BASIC, the frames nearest their positions built now, the rest four a block
    sh.stores[0].start(0, 0.62); sh.stores[1].start(0, 1 / 3);
    for (let i = 0; i < 2; i++) { sh.stores[0].step(); sh.stores[1].step(); }
    // which table each oscillator wants: a change builds the new table's nearest frames at once, then crossfades 30 ms
    // (before anything has sounded, it just switches); the frames at each oscillator's position are built first
    function sync(P) {
      for (let o = 0; o < 2; o++) {
        const x = sh.osc[o], want = (o ? P.b_table : P.a_table) | 0;
        if (sh.stores[x.cur].table === want || x.nxt >= 0) continue;
        let si = -1;
        for (let i = 0; i < 4; i++) if (sh.stores[i].table === want) { si = i; break; }
        if (si < 0) {
          for (let i = 0; i < 4 && si < 0; i++) if (sh.osc[0].cur !== i && sh.osc[0].nxt !== i && sh.osc[1].cur !== i && sh.osc[1].nxt !== i) si = i;
          if (si < 0) continue;
          sh.stores[si].start(want, o ? P.b_pos : P.a_pos);
          sh.stores[si].step(); sh.stores[si].step();
        }
        if (!sh.sounded) x.cur = si; else { x.nxt = si; x.xw = 0; }
      }
      for (let o = 0; o < 2; o++) {
        const x = sh.osc[o], st = sh.stores[x.cur];
        st.np = o ? P.b_pos : P.a_pos; st.need();
        if (x.nxt >= 0) { const s2 = sh.stores[x.nxt]; s2.np = st.np; s2.need(); }
      }
    }
    // the params for this block: copied once (the first call in a block), then read from Q
    let qb = -1;
    function fresh(P) { if (qb !== sh.blk) { loadQ(P); qb = sh.blk; } return Q; }
    const M = new Engine(sr, sh, rng((seed ^ 0x3333) >>> 0), 99);
    // the mono note stack: the newest held key sounds; letting it go returns to the one under it
    function push(p) { let j = 0; for (let i = 0; i < sh.sn; i++) if (sh.stack[i] !== p) sh.stack[j++] = sh.stack[i]; sh.sn = j; if (sh.sn < 16) sh.stack[sh.sn++] = p; }
    function drop(p) { let j = 0; for (let i = 0; i < sh.sn; i++) if (sh.stack[i] !== p) sh.stack[j++] = sh.stack[i]; sh.sn = j; }
    const fx = new Fx(sr, seed), fxm = new Float64Array(4), vs = sh.vsrc;

    return {
      voice(i) {
        const e = new Engine(sr, sh, rng(((seed ^ 0x7a11) + i * 104729) >>> 0), i);
        const slot = {
          e, mono: false, held: false, p: 60,
          start(p, v, P0) {
            const P = fresh(P0);
            sync(P);
            slot.p = p; slot.held = true;
            const mode = P.voice_mode | 0;
            if (mode === 0) {
              slot.mono = false;
              e.reset(); e.trigger(p, v, P, sh.lastPitch, false);
              sh.newest = e;
            } else {
              slot.mono = true;
              const was = sh.sn > 0, sounding = M.active() && sh.owner !== null;
              push(p);
              sh.owner = slot;
              if (!sounding) { M.reset(); M.trigger(p, v, P, mode === 1 ? sh.lastPitch : -1, false); }
              else M.trigger(p, v, P, mode === 2 && !was ? -1 : M.pitchNow(), mode === 2 && was);   // (LEGATO glides only between held notes)
              sh.newest = M;
            }
            sh.lastPitch = p; sh.sounded = true;
          },
          release(P0) {
            const P = fresh(P0);
            slot.held = false;
            if (!slot.mono) { e.release(); return; }
            drop(slot.p);
            if (sh.owner === null) return;
            if (!sh.sn) M.release();
            else if (M.gTo === slot.p) M.trigger(sh.stack[sh.sn - 1], M.vel, P, M.pitchNow(), true);
          },
          render(L, R, n, P0, T) {
            const P = fresh(P0);
            if (!slot.mono) return e.render(L, R, n, P, T);
            if (sh.owner !== slot) return slot.held;     // a mono key under the one sounding: silent, kept while held
            return M.render(L, R, n, P, T);
          },
          stop() {
            if (slot.mono) { if (sh.owner === slot) { sh.owner = null; M.reset(); sh.sn = 0; } else drop(slot.p); }
            else e.reset();
            slot.held = false;
          },
        };
        return slot;
      },
      process(L, R, n, P0, T) {
        const P = fresh(P0);
        sync(P);
        // FX destinations: the slots aimed at them, from the global sources and the newest note's own
        fxm[0] = 0; fxm[1] = 0; fxm[2] = 0; fxm[3] = 0;
        vs[10] = T && T.mod > 0 ? T.mod : 0; vs[11] = P.macro1; vs[12] = P.macro2; vs[13] = P.macro3; vs[14] = P.macro4;
        // (named reads, slot by slot: a read by a computed key boxes the number it returns)
        let d = P.m1_dst | 0; if (d >= 34) fxm[d - 34] += P.m1_amt * vs[P.m1_src | 0];
        d = P.m2_dst | 0; if (d >= 34) fxm[d - 34] += P.m2_amt * vs[P.m2_src | 0];
        d = P.m3_dst | 0; if (d >= 34) fxm[d - 34] += P.m3_amt * vs[P.m3_src | 0];
        d = P.m4_dst | 0; if (d >= 34) fxm[d - 34] += P.m4_amt * vs[P.m4_src | 0];
        d = P.m5_dst | 0; if (d >= 34) fxm[d - 34] += P.m5_amt * vs[P.m5_src | 0];
        d = P.m6_dst | 0; if (d >= 34) fxm[d - 34] += P.m6_amt * vs[P.m6_src | 0];
        d = P.m7_dst | 0; if (d >= 34) fxm[d - 34] += P.m7_amt * vs[P.m7_src | 0];
        d = P.m8_dst | 0; if (d >= 34) fxm[d - 34] += P.m8_amt * vs[P.m8_src | 0];
        fx.run(L, R, n, P, T, fxm);
        // the shared clock: table crossfades, FREE LFOs, the table builder (four frames a block while one builds)
        for (let o = 0; o < 2; o++) { const x = sh.osc[o]; if (x.nxt >= 0) { x.xw += n * x.dx; if (x.xw >= 1) { x.cur = x.nxt; x.nxt = -1; x.xw = 0; } } }
        sh.lacc[0] += n * P.lfo1_rate / sr; sh.lacc[1] += n * P.lfo2_rate / sr; sh.lacc[2] += n * P.lfo3_rate / sr; sh.lacc[3] += n * P.lfo4_rate / sr;
        for (let i = 0; i < 4; i++) if (sh.lacc[i] > 1e6) sh.lacc[i] -= 1e6;
        let budget = 4;
        for (let o = 0; o < 2 && budget > 0; o++) { const x = sh.osc[o], st = sh.stores[x.nxt >= 0 ? x.nxt : x.cur]; while (budget > 0 && !st.ready()) { st.step(); budget--; } }
        for (let o = 0; o < 2 && budget > 0; o++) { const st = sh.stores[sh.osc[o].cur]; while (budget > 0 && !st.ready()) { st.step(); budget--; } }
        sh.blk++; sh.clock += n; sh.pos = 0;
      },
    };
  },
};
`;

// The presets: whole sounds a newcomer (or an agent) picks by name, each blurb starting with its family. Every one is
// held near -16 LUFS on the test phrase (the basses on the bass phrase) with true peaks under -1 dBTP by
// tools/wavetable-test.js; VOLUME carries each one's trim. Switches are given by their labels.
// The basses keep their weight where it's heard. In a bass line's register (the bass phrase's roots are A1, F1, C2 and
// G1), a sub an octave down lands at 22-33 Hz: felt on a big system, gone on a laptop, and barely read by LUFS, so a
// loud sub levels the preset quiet everywhere else. Each holds under a tenth of its energy below 35 Hz, 30%
// or more in 100 Hz-2 kHz, and its 500 Hz-2 kHz band within 20 dB of its 0-60 Hz band (wavetable-test; the numbers,
// before and after, are in LIGHT-TABLE.md section 4).
const slot = (n, src, dst, amt) => ({ [`m${n}_src`]: src, [`m${n}_dst`]: dst, [`m${n}_amt`]: amt });
export const PRESETS = [
  { name: 'First Light', blurb: 'Poly: a warm three-voice saw through the ladder, a touch of room (the defaults)', params: {} },
  // bass
  { name: 'Low Key', blurb: 'Bass: deep and round, FM grit over a clean sine sub, legato slides', params: {
    a_table: 'FM', a_pos: 0.4, a_unison: 1, a_level: 0.75, b_table: 'BASIC', b_pos: 2 / 3, b_oct: 0, b_level: 0.4, sub_level: 0.15, flt_sub: 'OFF',
    flt_type: 'LP24', flt_cutoff: 650, flt_res: 0.2, flt_drive: 0.25, flt_key: 0.3, flt_env: 0.35,
    env1_attack: 0.002, env1_decay: 0.6, env1_sustain: 0.85, env1_release: 0.08, env1_curve: 0.3, env2_attack: 0.001, env2_decay: 0.22, env2_sustain: 0.1, env2_release: 0.1, env2_curve: 0.6,
    voice_mode: 'LEGATO', voice_glide: 35, fx_verb_mix: 0, fx_drive: 0.15, ...slot(1, 'VELOCITY', 'CUTOFF', 0.12), voice_level: 2.2 } },
  { name: 'Gate Weave', blurb: 'Bass: a Reese, two detuned saw pairs drifting against each other', params: {
    a_table: 'BASIC', a_pos: 2 / 3, a_unison: 2, a_detune: 0.35, a_blend: 1, a_spread: 0.3, a_level: 0.7,
    b_table: 'BASIC', b_pos: 2 / 3, b_oct: 0, b_fine: 11, b_unison: 2, b_detune: 0.35, b_blend: 1, b_level: 0.6, sub_level: 0.1, flt_sub: 'OFF',
    flt_type: 'LP24', flt_cutoff: 700, flt_res: 0.25, flt_drive: 0.4, flt_key: 0.3, flt_env: 0.2,
    env1_attack: 0.005, env1_decay: 1, env1_sustain: 1, env1_release: 0.15, voice_mode: 'LEGATO', voice_glide: 20, fx_verb_mix: 0, fx_drive: 0.2,
    lfo1_shape: 'SINE', lfo1_rate: 0.18, lfo1_mode: 'FREE', lfo2_shape: 'TRI', lfo2_rate: 0.11, lfo2_mode: 'FREE',
    ...slot(1, 'LFO1', 'A DETUNE', 0.15), ...slot(2, 'LFO2', 'CUTOFF', 0.06), voice_level: 3 } },
  { name: 'Solarized', blurb: 'Bass: a talking growl that wobbles in eighths over a clean sine, retriggered', params: {
    a_table: 'GROWL', a_pos: 0.3, a_unison: 2, a_detune: 0.15, a_spread: 0.2, a_level: 0.8, b_table: 'BASIC', b_pos: 0, b_oct: 0, b_level: 0.25, flt_b: 'OFF',
    flt_type: 'LP24', flt_cutoff: 1400, flt_res: 0.35, flt_drive: 0.45, flt_key: 0.2, flt_env: 0,
    env1_attack: 0.002, env1_decay: 0.4, env1_sustain: 0.9, env1_release: 0.1, voice_mode: 'MONO', voice_glide: 25, fx_verb_mix: 0, fx_drive: 0.25, fx_drive_mix: 0.6,
    lfo1_shape: 'SINE', lfo1_sync: '1/8', lfo1_mode: 'RETRIG', ...slot(1, 'LFO1', 'A POS', 0.55), ...slot(2, 'LFO1', 'CUTOFF', 0.25), voice_level: 3.7 } },
  { name: 'Safelight', blurb: 'Bass: an acid line, squelchy resonance and slides, with an echo', params: {
    a_table: 'BASIC', a_pos: 0.8, a_unison: 1, a_level: 0.8, flt_type: 'LP24', flt_cutoff: 320, flt_res: 0.78, flt_drive: 0.35, flt_key: 0.25, flt_env: 0.55,
    env1_attack: 0.002, env1_decay: 0.4, env1_sustain: 0.9, env1_release: 0.06, env2_attack: 0.001, env2_decay: 0.25, env2_sustain: 0.05, env2_release: 0.1, env2_curve: 0.5,
    voice_mode: 'LEGATO', voice_glide: 70, fx_verb_mix: 0, fx_drive: 0.3, fx_drive_mix: 0.8, fx_delay_time: '1/8D', fx_delay_fb: 0.3, fx_delay_mix: 0.15,
    ...slot(1, 'VELOCITY', 'CUTOFF', 0.15), voice_level: 0.8 } },
  { name: 'Sprocket', blurb: 'Bass: a clicky FM pluck over a sine an octave down', params: {
    a_table: 'FM', a_pos: 0.35, a_unison: 1, a_level: 0.8, b_table: 'BASIC', b_pos: 0, b_oct: -1, b_level: 0.2,
    flt_type: 'LP12', flt_cutoff: 2500, flt_res: 0.1, flt_env: 0.2, flt_key: 0.3,
    env1_attack: 0.001, env1_decay: 0.5, env1_sustain: 0.6, env1_release: 0.06, env1_curve: 0.5, env3_attack: 0.001, env3_decay: 0.18, env3_sustain: 0, env3_release: 0.1, env3_curve: 0.6,
    voice_mode: 'MONO', fx_verb_mix: 0, ...slot(1, 'ENV3', 'A POS', 0.6), voice_level: 5 } },
  // lead
  { name: 'Rack Focus', blurb: 'Lead: a hard-sync sweep on every note, legato glide; the wheel pulls it further', params: {
    a_table: 'BASIC', a_pos: 2 / 3, a_warp: 'SYNC', a_warp_amt: 0.35, a_unison: 3, a_detune: 0.18, a_level: 0.75, b_table: 'PULSE', b_pos: 0.35, b_oct: 0, b_fine: 7, b_level: 0.4,
    flt_type: 'LP24', flt_cutoff: 5200, flt_res: 0.2, flt_env: 0.15, flt_key: 0.5,
    env1_attack: 0.003, env1_decay: 0.6, env1_sustain: 0.85, env1_release: 0.25, env3_attack: 0.001, env3_decay: 0.6, env3_sustain: 0.2, env3_release: 0.3,
    voice_mode: 'LEGATO', voice_glide: 60, fx_delay_time: '1/8D', fx_delay_fb: 0.3, fx_delay_mix: 0.18, fx_verb_mix: 0.15, fx_verb_size: 0.4,
    ...slot(1, 'ENV3', 'A WARP', 0.4), ...slot(2, 'MOD WHEEL', 'A WARP', 0.3), voice_level: 2.9 } },
  { name: 'Lens Flare', blurb: 'Lead: a wide seven-saw stack with an octave on top, chorus and echoes', params: {
    a_table: 'BASIC', a_pos: 2 / 3, a_unison: 7, a_detune: 0.42, a_blend: 0.8, a_spread: 0.85, a_level: 0.75, b_table: 'BASIC', b_pos: 2 / 3, b_oct: 1, b_unison: 3, b_detune: 0.3, b_level: 0.3,
    flt_type: 'LP24', flt_cutoff: 6500, flt_res: 0.1, flt_env: 0.1, flt_key: 0.3,
    env1_attack: 0.003, env1_decay: 0.5, env1_sustain: 0.85, env1_release: 0.4,
    fx_chorus_mix: 0.3, fx_chorus_depth: 0.4, fx_delay_time: '1/4', fx_delay_fb: 0.35, fx_delay_mix: 0.15, fx_verb_mix: 0.2, fx_verb_size: 0.6, voice_level: 0.3 } },
  { name: 'Magic Lantern', blurb: 'Lead: a singing vowel line, its vowel drifting, the vibrato arriving late', params: {
    a_table: 'VOWEL', a_pos: 0.2, a_unison: 2, a_detune: 0.12, a_level: 0.8, b_table: 'VOWEL', b_pos: 0.7, b_oct: 0, b_fine: -8, b_level: 0.45,
    flt_type: 'LP12', flt_cutoff: 6000, flt_res: 0.1, flt_env: 0, flt_key: 0.3,
    env1_attack: 0.02, env1_decay: 0.8, env1_sustain: 0.9, env1_release: 0.3, env3_attack: 0.001, env3_decay: 0.7, env3_sustain: 0, env3_release: 0.3, env3_curve: -0.5,
    voice_mode: 'LEGATO', voice_glide: 90, fx_delay_time: '1/4D', fx_delay_fb: 0.25, fx_delay_mix: 0.12, fx_verb_mix: 0.25, fx_verb_size: 0.55,
    lfo1_shape: 'TRI', lfo1_rate: 0.35, lfo1_mode: 'RETRIG', lfo2_shape: 'SINE', lfo2_rate: 5.2, lfo2_mode: 'RETRIG',
    ...slot(1, 'LFO1', 'A POS', 0.6), ...slot(2, 'LFO2', 'FINE', 0.12), ...slot(3, 'ENV3', 'M2 AMT', -0.12), voice_level: 2.4 } },
  { name: 'Flip Book', blurb: 'Lead: an eight-bit pulse narrowing on each note, a stepped triangle under it', params: {
    a_table: 'CHIP', a_pos: 1 / 3, a_unison: 1, a_level: 0.7, b_table: 'CHIP', b_pos: 1, b_oct: -1, b_level: 0.3,
    flt_type: 'LP12', flt_cutoff: 12000, flt_res: 0, flt_env: 0, flt_key: 0,
    env1_attack: 0.001, env1_decay: 0.3, env1_sustain: 0.7, env1_release: 0.05, env1_curve: 1, env3_attack: 0.001, env3_decay: 0.25, env3_sustain: 0, env3_release: 0.1,
    voice_mode: 'MONO', fx_delay_time: '1/8', fx_delay_fb: 0.25, fx_delay_mix: 0.15, fx_verb_mix: 0.1, ...slot(1, 'ENV3', 'A POS', -0.33), voice_level: 4.2 } },
  // pad
  { name: 'Long Exposure', blurb: 'Pad: a slow, wide bloom of harmonics that keeps opening and closing', params: {
    a_table: 'HARMONICS', a_pos: 0.35, a_unison: 6, a_detune: 0.3, a_blend: 0.8, a_spread: 0.9, a_level: 0.75, b_table: 'BASIC', b_pos: 2 / 3, b_oct: -1, b_unison: 4, b_detune: 0.25, b_level: 0.35,
    flt_type: 'LP24', flt_cutoff: 2200, flt_res: 0.1, flt_env: 0.15, flt_key: 0.4,
    env1_attack: 0.9, env1_decay: 2, env1_sustain: 0.9, env1_release: 2.5, env1_curve: -0.3, env2_attack: 1.2, env2_decay: 2, env2_sustain: 0.6, env2_release: 2,
    lfo1_shape: 'SINE', lfo1_rate: 0.08, lfo1_mode: 'FREE', lfo2_shape: 'TRI', lfo2_rate: 0.13, lfo2_mode: 'FREE',
    fx_chorus_mix: 0.4, fx_chorus_depth: 0.5, fx_verb_mix: 0.35, fx_verb_size: 0.8, ...slot(1, 'LFO1', 'A POS', 0.25), ...slot(2, 'LFO2', 'B POS', 0.15), voice_level: 1.6 } },
  { name: 'Bokeh', blurb: 'Pad: soft glass, octaves and fifths shimmering in a big space', params: {
    a_table: 'GLASS', a_pos: 0.3, a_unison: 4, a_detune: 0.15, a_spread: 0.9, a_level: 0.8, b_table: 'GLASS', b_pos: 0.7, b_oct: 1, b_unison: 2, b_level: 0.3,
    flt_type: 'LP12', flt_cutoff: 9000, flt_res: 0, flt_env: 0, flt_key: 0.2,
    env1_attack: 0.6, env1_decay: 2, env1_sustain: 0.8, env1_release: 1.6, lfo1_shape: 'SINE', lfo1_rate: 0.15, lfo1_mode: 'FREE',
    fx_verb_mix: 0.45, fx_verb_size: 0.75, fx_delay_time: '1/4D', fx_delay_fb: 0.35, fx_delay_mix: 0.12, fx_chorus_mix: 0.2, ...slot(1, 'LFO1', 'A POS', 0.4), voice_level: -0.2 } },
  { name: 'Afterimage', blurb: 'Pad: a breathy choir of vowels slowly changing shape', params: {
    a_table: 'VOWEL', a_pos: 0, a_unison: 5, a_detune: 0.2, a_spread: 0.8, a_level: 0.75, b_table: 'VOWEL', b_pos: 0.75, b_oct: 0, b_unison: 3, b_level: 0.5,
    noise_level: 0.08, noise_color: 0.7, flt_type: 'LP12', flt_cutoff: 5000, flt_res: 0.05, flt_env: 0, flt_key: 0.2,
    env1_attack: 0.7, env1_decay: 1.5, env1_sustain: 0.85, env1_release: 2, lfo1_shape: 'TRI', lfo1_rate: 0.07, lfo1_mode: 'FREE', lfo2_shape: 'SINE', lfo2_rate: 0.05, lfo2_mode: 'FREE',
    fx_chorus_mix: 0.3, fx_verb_mix: 0.4, fx_verb_size: 0.85, ...slot(1, 'LFO1', 'A POS', 0.6), ...slot(2, 'LFO2', 'B POS', -0.4), voice_level: -0.3 } },
  { name: 'Zoetrope', blurb: 'Pad: string-machine pulses, their widths turning against each other', params: {
    a_table: 'PULSE', a_pos: 0.25, a_unison: 4, a_detune: 0.25, a_level: 0.75, b_table: 'PULSE', b_pos: 0.6, b_oct: 0, b_fine: 6, b_unison: 2, b_level: 0.6,
    flt_type: 'LP24', flt_cutoff: 3000, flt_res: 0.12, flt_env: 0.1, flt_key: 0.5,
    env1_attack: 0.3, env1_decay: 1, env1_sustain: 0.85, env1_release: 0.9, lfo1_shape: 'TRI', lfo1_rate: 0.6, lfo1_mode: 'FREE', lfo2_shape: 'SINE', lfo2_rate: 0.45, lfo2_mode: 'FREE',
    fx_chorus_mix: 0.6, fx_chorus_depth: 0.6, fx_verb_mix: 0.3, fx_verb_size: 0.65, ...slot(1, 'LFO1', 'A POS', 0.35), ...slot(2, 'LFO2', 'B POS', -0.3), voice_level: -2 } },
  // pluck
  { name: 'Shutter', blurb: 'Pluck: a bright snap of harmonics closing fast, echoed', params: {
    a_table: 'HARMONICS', a_pos: 0.2, a_unison: 3, a_detune: 0.15, a_spread: 0.6, a_level: 0.8, flt_type: 'LP24', flt_cutoff: 1800, flt_res: 0.2, flt_env: 0.4, flt_key: 0.4,
    env1_attack: 0.001, env1_decay: 1.4, env1_sustain: 0.2, env1_release: 0.4, env1_curve: 0.3, env2_attack: 0.001, env2_decay: 0.5, env2_sustain: 0.15, env2_release: 0.25, env2_curve: 0.5,
    env3_attack: 0.001, env3_decay: 0.15, env3_sustain: 0, env3_release: 0.1, fx_delay_time: '1/8D', fx_delay_fb: 0.3, fx_delay_mix: 0.15, fx_verb_mix: 0.2, ...slot(1, 'ENV3', 'A POS', 0.5), voice_level: 5.2 } },
  { name: 'Prism', blurb: 'Pluck: a struck bell, bright at the strike and mellowing as it rings', params: {
    a_table: 'BELL', a_pos: 0.75, a_unison: 1, a_level: 0.8, b_table: 'GLASS', b_pos: 0.2, b_oct: 1, b_level: 0.25, flt_type: 'LP12', flt_cutoff: 9000, flt_res: 0, flt_env: 0, flt_key: 0.2,
    env1_attack: 0.001, env1_decay: 2.2, env1_sustain: 0, env1_release: 1.2, env1_curve: 0.4, env3_attack: 0.001, env3_decay: 1.2, env3_sustain: 0, env3_release: 0.5,
    fx_verb_mix: 0.3, fx_verb_size: 0.75, fx_chorus_mix: 0.2, ...slot(1, 'ENV3', 'A POS', -0.5), voice_level: 4.1 } },
  { name: 'Splice', blurb: 'Pluck: a noise burst ringing a comb tuned to each note, string-like', params: {
    a_table: 'BASIC', a_pos: 2 / 3, a_unison: 1, a_level: 0.4, noise_level: 0, noise_color: 0.8, flt_type: 'COMB', flt_cutoff: 261.63, flt_res: 0.85, flt_key: 1, flt_env: 0, flt_vel: 0,
    env1_attack: 0.001, env1_decay: 1.5, env1_sustain: 0, env1_release: 0.4, env3_attack: 0.001, env3_decay: 0.02, env3_sustain: 0, env3_release: 0.02,
    fx_verb_mix: 0.2, ...slot(1, 'ENV3', 'NOISE LEVEL', 0.8), voice_level: 3.4 } },
  // keys
  { name: 'Intermission', blurb: 'Keys: a theatre organ, drawbars 888, a slow shimmer and warm valves', params: {
    a_table: 'ORGAN', a_pos: 0.25, a_unison: 1, a_level: 0.8, flt_type: 'LP12', flt_cutoff: 8000, flt_res: 0, flt_env: 0, flt_key: 0,
    env1_attack: 0.005, env1_decay: 0.1, env1_sustain: 1, env1_release: 0.08, lfo1_shape: 'SINE', lfo1_rate: 6.5, lfo1_mode: 'FREE',
    fx_chorus_mix: 0.5, fx_chorus_depth: 0.55, fx_verb_mix: 0.25, fx_verb_size: 0.6, fx_drive: 0.15, ...slot(1, 'LFO1', 'AMP', 0.08), voice_level: -3.7 } },
  { name: 'House Lights', blurb: 'Keys: a soft electric piano, a tine at the strike, a suitcase pan', params: {
    a_table: 'FM', a_pos: 0.12, a_unison: 1, a_level: 0.8, b_table: 'GLASS', b_pos: 0.1, b_oct: 2, b_level: 0, flt_type: 'LP12', flt_cutoff: 5000, flt_res: 0, flt_env: 0, flt_key: 0.4,
    env1_attack: 0.001, env1_decay: 2.5, env1_sustain: 0.25, env1_release: 0.5, env1_curve: 0.4, env3_attack: 0.001, env3_decay: 0.4, env3_sustain: 0, env3_release: 0.2,
    lfo1_shape: 'SINE', lfo1_rate: 4.5, lfo1_mode: 'FREE', fx_chorus_mix: 0.25, fx_verb_mix: 0.2,
    ...slot(1, 'ENV3', 'A POS', 0.18), ...slot(2, 'VELOCITY', 'A POS', 0.15), ...slot(3, 'ENV3', 'B LEVEL', 0.2), ...slot(4, 'LFO1', 'PAN', 0.25) } },
  { name: 'Clapperboard', blurb: 'Keys: a nasal, clacky reed clav that bites harder the harder you play', params: {
    a_table: 'REED', a_pos: 0.75, a_unison: 1, a_level: 0.8, flt_type: 'LP24', flt_cutoff: 1400, flt_res: 0.25, flt_env: 0.35, flt_key: 0.5,
    env1_attack: 0.001, env1_decay: 0.4, env1_sustain: 0.45, env1_release: 0.08, env1_curve: 0.5, env2_attack: 0.001, env2_decay: 0.2, env2_sustain: 0.2, env2_release: 0.1,
    fx_drive: 0.25, fx_chorus_mix: 0.15, fx_verb_mix: 0.1, ...slot(1, 'VELOCITY', 'CUTOFF', 0.15) } },
  // arp
  { name: 'Flicker', blurb: 'Arp: sync bursts gated in sixteenths, sweeping each beat, echoed', params: {
    a_table: 'SYNC', a_pos: 0.4, a_unison: 2, a_detune: 0.12, a_level: 0.8, flt_type: 'LP24', flt_cutoff: 2600, flt_res: 0.3, flt_env: 0.2, flt_key: 0.4,
    env1_attack: 0.003, env1_decay: 1, env1_sustain: 0.8, env1_release: 0.2, lfo1_shape: 'SQUARE', lfo1_sync: '1/16', lfo1_mode: 'FREE', lfo2_shape: 'SAW DN', lfo2_sync: '1/4', lfo2_mode: 'FREE',
    fx_delay_time: '1/8D', fx_delay_fb: 0.4, fx_delay_mix: 0.2, fx_verb_mix: 0.15, ...slot(1, 'LFO1', 'AMP', -0.9), ...slot(2, 'LFO2', 'A POS', 0.4), voice_level: -1.5 } },
  { name: 'Stop Motion', blurb: 'Arp: gritty stepped plucks, each note a slightly different frame', params: {
    a_table: 'GRIT', a_pos: 0.35, a_unison: 1, a_level: 0.8, b_table: 'CHIP', b_pos: 2 / 3, b_oct: -1, b_level: 0.3, flt_type: 'LP24', flt_cutoff: 2000, flt_res: 0.25, flt_env: 0.3, flt_key: 0.4,
    env1_attack: 0.001, env1_decay: 0.6, env1_sustain: 0.3, env1_release: 0.18, env1_curve: 0.3, env2_attack: 0.001, env2_decay: 0.25, env2_sustain: 0.15, env2_release: 0.1,
    env3_attack: 0.001, env3_decay: 0.15, env3_sustain: 0, env3_release: 0.1, fx_delay_time: '1/8D', fx_delay_fb: 0.45, fx_delay_mix: 0.22, fx_verb_mix: 0.15,
    ...slot(1, 'ENV3', 'A POS', 0.3), ...slot(2, 'RANDOM', 'A POS', 0.15), voice_level: 0.7 } },
  // fx
  { name: 'Reel Change', blurb: 'FX: a four-second riser, sync and noise sweeping up an octave', params: {
    a_table: 'SYNC', a_pos: 0.1, a_unison: 5, a_detune: 0.4, a_spread: 1, a_level: 0.7, noise_level: 0.35, noise_color: 0.9, flt_type: 'LP12', flt_cutoff: 600, flt_res: 0.4, flt_env: 0, flt_key: 0.3,
    env1_attack: 2, env1_decay: 1, env1_sustain: 1, env1_release: 2, env3_attack: 4, env3_decay: 1, env3_sustain: 1, env3_release: 2, env3_curve: -0.5,
    fx_verb_mix: 0.5, fx_verb_size: 1, fx_delay_time: '1/8', fx_delay_fb: 0.5, fx_delay_mix: 0.2,
    ...slot(1, 'ENV3', 'A POS', 0.9), ...slot(2, 'ENV3', 'PITCH', 0.5), ...slot(3, 'ENV3', 'CUTOFF', 0.4), voice_level: -1.8 } },
  { name: 'Light Leak', blurb: 'FX: a glitching texture, stepped random frames through a ringing comb', params: {
    a_table: 'GRIT', a_pos: 0.6, a_unison: 1, a_level: 0.8, b_table: 'FM', b_pos: 0.6, b_oct: 1, b_level: 0.25, flt_type: 'COMB', flt_cutoff: 900, flt_res: 0.6, flt_key: 0.5, flt_env: 0,
    env1_attack: 0.01, env1_decay: 1, env1_sustain: 0.8, env1_release: 0.4, lfo1_shape: 'S&H', lfo1_sync: '1/16', lfo1_mode: 'FREE', lfo2_shape: 'S&H', lfo2_sync: '1/8', lfo2_mode: 'FREE',
    fx_delay_time: '1/16', fx_delay_fb: 0.5, fx_delay_mix: 0.25, fx_verb_mix: 0.3,
    ...slot(1, 'LFO1', 'A POS', 0.5), ...slot(2, 'LFO1', 'CUTOFF', 0.3), ...slot(3, 'LFO2', 'PAN', 0.5), voice_level: -1.7 } },
];
// the bass presets are measured on the bass phrase (a mono bass plays chords as one line)
export const BASS_PRESETS = ['Low Key', 'Gate Weave', 'Solarized', 'Safelight', 'Sprocket'];

/* ------------------------------------------------------------------------------------------------ the page's maths */
// Light Table's editor (ui/editors/wavetable.js) draws with these: the warped frame, the filter's curve, the envelopes'
// segments, the LFOs, the unison voices and the matrix. They mirror the kernel's own maths (BODY, which keeps its inline
// copies, written for the audio thread: nothing here is in the kernel or changes a sample it plays), so keep the two
// in step. tools/wavetable-ui-test.js holds the warps and the filter curves to the kernel's renders.

// LFO SYNC and DELAY TIME in beats, as the kernel reads them (BODY's SYNC_BEATS and DELAY_BEATS)
export const SYNC_BEATS = Object.freeze([0, 0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2, 3, 4, 8, 16]);
export const DELAY_BEATS = Object.freeze([0.25, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2]);
// Which knob each destination moves, and how far an amount of 1 takes it, in that knob's travel (DEST_SCALE in
// numbers). PITCH, FINE, AMP and PAN move the whole voice and have no knob of their own (key null): their travel is
// around a centre (PITCH and FINE: 1 is half way, 24 and 1 semitones; AMP: 1 is twice the level; PAN: 0.5 is one side).
// A PITCH moves A SEMI's travel (24 semitones: 1 is the whole of it); Mn AMT adds to a -1..1 amount (1 is half its travel).
export const DEST_TARGETS = Object.freeze(DESTS.map((d) => {
  if (d === 'OFF') return null;
  const m = /^([AB]) (POS|WARP|PITCH|LEVEL|PAN|DETUNE)$/.exec(d);
  if (m) return { key: `${m[1].toLowerCase()}_${{ POS: 'pos', WARP: 'warp_amt', PITCH: 'semi', LEVEL: 'level', PAN: 'pan', DETUNE: 'detune' }[m[2]]}`, travel: 1 };
  const lr = /^LFO(\d) RATE$/.exec(d); if (lr) return { key: `lfo${lr[1]}_rate`, travel: 1 };
  const ma = /^M(\d) AMT$/.exec(d); if (ma) return { key: `m${ma[1]}_amt`, travel: 0.5 };
  const own = { 'SUB LEVEL': 'sub_level', 'NOISE LEVEL': 'noise_level', CUTOFF: 'flt_cutoff', RESO: 'flt_res', 'FLT DRIVE': 'flt_drive', DRIVE: 'fx_drive', 'CHORUS MIX': 'fx_chorus_mix', 'DELAY MIX': 'fx_delay_mix', 'VERB MIX': 'fx_verb_mix' };
  if (own[d]) return { key: own[d], travel: 1 };
  return { key: null, travel: d === 'PAN' ? 1 : 0.5 };
}));

const TAU_ = 2 * Math.PI;
// the warp's working value for an amount (Osc.warpVal): SYNC its ratio 1..8, BEND its depth, PW the pulse's width
// 1..0.05, MIRROR its mix, FM its depth in cycles
export function warpValue(mode, a) {
  if (mode === 1) return Math.pow(2, 3 * a);
  if (mode === 2) return 0.95 * a;
  if (mode === 3) return 1 - 0.95 * a;
  if (mode === 4) return a;
  if (mode === 5) return 1.2 * a * a;
  return 0;
}
// One table cycle read through a warp: src is the table's cycle at any number of points (all its note cycles: `cycles`
// of them, 1, 2 or 4), out gets m points. These are Osc.run's phase maps and blends, without its band limiting (SYNC's
// polyBLEP at the reset, and the caps that make SYNC and PW give way at the top of the keys). fm(t) is the other
// oscillator's sum before its level, t note cycles in (an FM warp; 0 without one).
export function warpCycle(src, mode, amt, { cycles = 1, out = null, fm = null } = {}) {
  const n = src.length, o = out || new Float32Array(n), m = o.length, wv = warpValue(mode, amt);
  const read = (u) => { u -= Math.floor(u); const x = u * n, k = Math.min(n - 1, x | 0), f = x - k; const a = src[k]; return a + (src[k + 1 < n ? k + 1 : 0] - a) * f; };
  for (let i = 0; i < m; i++) {
    const t = (i / m) * cycles, c = Math.floor(t), p = t - c;
    let q = p;
    if (mode === 1) { const x = p * wv; q = x - Math.floor(x); }
    else if (mode === 2) q = p - (wv * Math.sin(TAU_ * p)) / TAU_;
    else if (mode === 3) { const x = p < wv ? p / wv : 1; q = x - Math.sin(TAU_ * x) / TAU_; }
    else if (mode === 5 && fm) q = p + fm(c + p) * wv;
    let y = read((c + q) / cycles);
    if (mode === 3) { const mp = (1 - wv) * 8.421052631578947; if (mp < 1) { const y0 = read((c + p) / cycles); y = y0 + (y - y0) * mp; } }
    else if (mode === 4 && wv > 0) y += (read((c + 0.5 - 0.5 * Math.cos(TAU_ * p)) / cycles) - y) * wv;
    o[i] = y;
  }
  return o;
}

// The rational tanh every saturator in the kernel uses (lib.js sat)
const satR = (z) => (z <= -3 ? -1 : z >= 3 ? 1 : (z * (27 + z * z)) / (27 + 9 * z * z));
// the FORMANT filter's vowels, U O A E I: F1 F2 F3 (Hz) then their levels (dB) (BODY's FV)
const FV_ = [350, 600, 2400, 0, -20, -32, 400, 750, 2400, 0, -11, -21, 600, 1040, 2250, 0, -7, -9, 400, 1620, 2400, 0, -12, -9, 250, 1750, 2600, 0, -30, -16];
// The cutoff a note plays at (Hz): the knob, KEY TRACK, FLT ENV on envelope 2's level e2, FLT VEL and the matrix's
// CUTOFF (d, in the knob's travel), as Engine.ctrl sums them
export function cutoffAt(P, { p = 60, vel = 0.8, e2 = 0, d = 0, sr = 48000 } = {}) {
  let x = Math.log2(P.flt_cutoff / 20) / Math.log2(1000) + d;
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  const fc = 20 * Math.exp(x * 6.907755278982137 + 0.6931471805599453 * (P.flt_key * (p - 60) / 12 + 6 * P.flt_env * e2 * (0.6 + 0.5 * vel) + 2 * P.flt_vel * (vel - 0.8)));
  return fc < 16 ? 16 : fc > 0.47 * sr ? 0.47 * sr : fc;
}
// The filter's response in dB at each of freqs (Hz), for a type (FILTERS' index), a cutoff fc (Hz, as cutoffAt gives
// it) and RESO 0..1. It is the exact small-signal response of the kernel's filters, from the same coefficients
// (Engine.coef): each is a zero-delay, trapezoidal filter, so its response is its analogue prototype's at the prewarped
// frequency tan(pi f / sr) / tan(pi fc / sr). LP24 is the ladder with its feedback and level compensation (its
// saturator taken as straight); COMB the delay line with its damping and fractional read; FORMANT the three vowel
// bands summed. FLT DRIVE is a saturator in front of the filter (the ladder's is inside it): it has no frequency
// response, so it isn't in the curve (driveCurve is its shape).
export function filterResponse(type, fc, res, freqs, { sr = 48000, out = null } = {}) {
  const o = out || new Float64Array(freqs.length);
  fc = fc < 16 ? 16 : fc > 0.47 * sr ? 0.47 * sr : fc;
  const g = Math.tan(Math.PI * fc / sr), kk = 1 / (0.55 * Math.pow(40, res));
  const k = 3.9 * res, c = 1 + 0.5 * k;
  const D = Math.min(4000, Math.max(2, sr / fc)), cg = 0.35 + 0.62 * res, nrm = (1 - cg) * 1.6 + 0.08, di = Math.floor(D), df = D - di;
  let bands = null;
  if (type === 6) {
    let v = Math.log2(fc / 150) / Math.log2(40); v = v < 0 ? 0 : v > 1 ? 1 : v;
    const s = v * 4 >= 4 ? 3 : Math.floor(v * 4), w = v * 4 - s, o0 = s * 6, o1 = o0 + 6, k2 = 1 / (2 + 14 * res);
    bands = [0, 1, 2].map((i) => ({ g: Math.tan(Math.PI * Math.min(Math.exp(Math.log(FV_[o0 + i]) * (1 - w) + Math.log(FV_[o1 + i]) * w), 0.45 * sr) / sr), k: k2, gain: Math.pow(10, (FV_[o0 + 3 + i] * (1 - w) + FV_[o1 + 3 + i] * w) / 20) }));
  }
  for (let i = 0; i < freqs.length; i++) {
    const f = Math.min(freqs[i], 0.4999 * sr), t = Math.tan(Math.PI * f / sr);
    let re = 1, im = 0;
    if (type === 0 || type === 2 || type === 3 || type === 4) {
      const w = t / g, dr = 1 - w * w, dim = kk * w, dd = dr * dr + dim * dim;
      // numerator over (1 - w^2 + j kk w)
      const nr = type === 0 ? 1 : type === 2 ? -w * w : type === 3 ? 0 : 1 - w * w, ni = type === 3 ? kk * w : 0;
      re = (nr * dr + ni * dim) / dd; im = (ni * dr - nr * dim) / dd;
    } else if (type === 1) {
      // one stage L = 1 / (1 + j w); the loop c L^4 / (1 + k L^4)
      const w = t / g;
      let lr = 1 / (1 + w * w), li = -w / (1 + w * w);
      let r2 = lr * lr - li * li, i2 = 2 * lr * li;
      const r4 = r2 * r2 - i2 * i2, i4 = 2 * r2 * i2;
      const dr = 1 + k * r4, dim = k * i4, dd = dr * dr + dim * dim;
      re = c * (r4 * dr + i4 * dim) / dd; im = c * (i4 * dr - r4 * dim) / dd;
    } else if (type === 5) {
      // v = x + cg * Hlp * Hd * v: Hlp = 0.55 / (1 - 0.45 z^-1), Hd = (1 - df) z^-di + df z^-(di + 1)
      const wd = TAU_ * f / sr;
      const lr0 = 1 - 0.45 * Math.cos(wd), li0 = 0.45 * Math.sin(wd), ld = lr0 * lr0 + li0 * li0;
      const hr = 0.55 * lr0 / ld, hi = -0.55 * li0 / ld;
      const dR = (1 - df) * Math.cos(wd * di) + df * Math.cos(wd * (di + 1)), dI = -(1 - df) * Math.sin(wd * di) - df * Math.sin(wd * (di + 1));
      const pr = cg * (hr * dR - hi * dI), pi = cg * (hr * dI + hi * dR);
      const er = 1 - pr, ei = -pi, ed = er * er + ei * ei;
      re = nrm * er / ed; im = -nrm * ei / ed;
    } else if (type === 6) {
      re = 0; im = 0;
      for (const b of bands) {
        const w = t / b.g, dr = 1 - w * w, dim = b.k * w, dd = dr * dr + dim * dim;
        // k s / (s^2 + k s + 1), s = j w
        const nr = 0, ni = b.k * w;
        re += b.gain * (nr * dr + ni * dim) / dd; im += b.gain * (ni * dr - nr * dim) / dd;
      }
      re *= 1.6; im *= 1.6;
    }
    const mag = Math.sqrt(re * re + im * im);
    o[i] = 20 * Math.log10(mag > 1e-12 ? mag : 1e-12);
  }
  return o;
}
// FLT DRIVE's transfer: what the filter gets for an input x (the level a voice's sources sum to, about -1..1). In front
// of the state-variable filters, the comb and the formant bank: the rational tanh with the drive's gain and make-up
// (none at 0); the ladder saturates inside its loop (its input pushed by RESO's compensation too), so this is its curve
// with the feedback at rest.
export function driveCurve(type, drv, x, res = 0) {
  const dg = 1 + 14 * drv * drv;
  if (type === 1) { const gin = 0.12 * dg, c = 1 + 1.95 * res; return satR(x * gin * c) / gin / c / (1 + 0.6 * drv); }
  if (drv <= 1e-3) return x;
  return satR(x * dg * 0.5) * (8 / (1 + 3 * Math.sqrt(dg)));
}

// An envelope segment's shape: how far along it is (0..1) at t, a fraction of the segment's time. The kernel's law
// (Env), s = (1 - e^(-k t)) / (1 - e^-k), with k from CURVE c: an attack's 1.5 + 4.5c (1.5 + 5.5c below 0), a decay's
// and a release's 5 + 5c (5 + 4.99c); a straight line where k is 0
export function envSegment(kind, curve, t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const k = kind === 'attack' ? (curve >= 0 ? 1.5 + 4.5 * curve : 1.5 + 5.5 * curve) : curve >= 0 ? 5 + 5 * curve : 5 + 4.99 * curve;
  if (k > -1e-3 && k < 1e-3) return t;
  return (1 - Math.exp(-k * t)) / (1 - Math.exp(-k));
}
// An envelope's level t seconds into a note, let go at `off` seconds (null: still held), e = { attack, decay, sustain,
// release, curve } (seconds and 0..1), from 0 as a fresh note starts -> { v, seg, at } (seg: 'attack', 'decay',
// 'sustain', 'release' or 'done'; at: how far through it, 0..1)
export function envAt(e, t, off = null) {
  const held = (x) => {
    if (x < e.attack) { const s = envSegment('attack', e.curve, x / e.attack); return { v: s, seg: 'attack', at: x / e.attack }; }
    x -= e.attack;
    if (x < e.decay) { const s = envSegment('decay', e.curve, x / e.decay); return { v: 1 - (1 - e.sustain) * s, seg: 'decay', at: x / e.decay }; }
    return { v: e.sustain, seg: 'sustain', at: 0 };
  };
  if (off == null || t < off) return held(Math.max(0, t));
  const vr = held(off).v, x = (t - off) / e.release;
  if (x >= 1 || vr < 1e-6) return { v: 0, seg: 'done', at: 1 };
  return { v: vr * (1 - envSegment('release', e.curve, x)), seg: 'release', at: x };
}

// An LFO's value (-1..1) at phase ph of its cycle n: the kernel's shapes (Engine.lfo), S&H and DRIFT from the same
// hash of n (a sine where the kernel reads its table)
const lfoHash = (n) => { let h = (n | 0) ^ 0x2545f491; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 2147483648 - 1; };
export function lfoShape(shape, ph, n = 0) {
  if (shape === 0) return Math.sin(TAU_ * ph);
  if (shape === 1) return ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
  if (shape === 2) return 2 * ph - 1;
  if (shape === 3) return 1 - 2 * ph;
  if (shape === 4) return ph < 0.5 ? 1 : -1;
  const a = lfoHash(n);
  if (shape === 5) return a;
  return a + (lfoHash(n + 1) - a) * ph * ph * (3 - 2 * ph);
}
// A FREE, synced LFO (l: 0..3) at a song beat: its phase and cycle as the kernel numbers it -> { ph, n }
export function lfoFree(l, sync, beat) {
  const b = beat / SYNC_BEATS[sync], c = Math.floor(b);
  return { ph: b - c, n: (c | 0) + 977 * (l + 1) };
}
// An LFO's rate in Hz: its SYNC at the tempo, else RATE (with the matrix's LFOn RATE, d, in RETRIG and ENV modes)
export function lfoHz(P, l, bpm = 120, d = 0) {
  const n = l + 1, sync = P[`lfo${n}_sync`] | 0, rate = P[`lfo${n}_rate`];
  if (sync) return bpm / 60 / SYNC_BEATS[sync];
  return d !== 0 && (P[`lfo${n}_mode`] | 0) !== 0 ? rate * Math.pow(2, d * Math.log2(2000)) : rate;
}

// The unison voices as Osc.ctrl spreads them (without its seeded jitter): each voice's pitch offset in semitones, its
// pan (-1..1) and its weight (equal power: the weights' squares sum to 1) -> [{ st, pan, w }]
export function unisonVoices(n, detune, blend, spread, pan = 0) {
  const N = n < 1 ? 1 : n > 8 ? 8 : Math.round(n), D = detune * detune, edge = N > 1 ? 1 / (N - 1) + 1e-9 : 1, out = [];
  let ws = 0;
  for (let j = 0; j < N; j++) {
    const x0 = N > 1 ? -1 + 2 * j / (N - 1) : 0, x = N === 1 || j === (N - 1) / 2 ? 0 : x0, w = Math.abs(x0) <= edge ? 1 : blend;
    let p = pan + x * spread; p = p < -1 ? -1 : p > 1 ? 1 : p;
    out.push({ st: x * D, pan: p, w });
    ws += w * w;
  }
  const gn = ws > 1e-12 ? 1 / Math.sqrt(ws) : 0;
  for (const v of out) v.w *= gn;
  return out;
}

// The matrix as Engine.ctrl evaluates it: the slots aimed at other slots' amounts first, then the rest summed by
// destination, each amount clamped to -1..1. S: the 16 sources' values (SOURCES' order). -> D, by destination index
// (DESTS'); fx: DRIVE, CHORUS MIX, DELAY MIX and VERB MIX, which the kernel sums from the slots' own amounts and the
// newest note's sources (process()); A: each slot's amount after the slots aimed at it, clamped
export function modMatrix(P, S, D = new Float64Array(38), fx = new Float64Array(4)) {
  D.fill(0); fx.fill(0);
  const A = [], src = [], dst = [];
  for (let j = 0; j < 8; j++) { A.push(+P[`m${j + 1}_amt`] || 0); src.push(P[`m${j + 1}_src`] | 0); dst.push(P[`m${j + 1}_dst`] | 0); }
  for (let j = 0; j < 8; j++) { const d = dst[j]; if (d >= 26 && d <= 33) A[d - 26] += A[j] * S[src[j]]; }
  for (let j = 0; j < 8; j++) {
    A[j] = A[j] < -1 ? -1 : A[j] > 1 ? 1 : A[j];
    const d = dst[j];
    if (d > 0 && d < 26) D[d] += A[j] * S[src[j]];
    if (d >= 34) fx[d - 34] += (+P[`m${j + 1}_amt`] || 0) * S[src[j]];
  }
  return { D, fx, A };
}

export default defineDevice({
  id: 'core.wavetable', name: 'Light Table', kind: 'instrument', cat: 'synth', by: 'overdub',
  editor: 'wavetable',
  blurb: 'Wavetable synth: two morphing tables, a filter, mod matrix',
  nod: 'the modern software wavetable synth: two oscillators scanning tables of single-cycle frames, warped, stacked in unison and modulated freely',
  params: PARAMS,
  presets: PRESETS,
  look: { color: '#1d2a33', ink: '#ece6d6', shape: 'rack', finish: 'brushed', knob: 'black', label: 'plate', led: '#fff1cc' },
  tail: 8,
  kernel: kernel(BODY),
});
