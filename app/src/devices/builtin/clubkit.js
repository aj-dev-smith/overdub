// core.clubkit: Sandbag. A synthesized drum kit for bass music (dubstep, riddim, drum and bass, melodic bass): a kick
// with a tuned sub tail and a click, a big layered snare (a body of two modes, a noise crack, a clap, a short room),
// hats of two struck plates, toms, a crash and a ride, a riser and an impact. A sandbag is what holds a stand down on a
// loud stage. GM drum map, with the riser on note 34 and the impact on 33 (under the map).
//
// It follows the drum research's three rules (docs/research/CLUBKIT.md): every hit peaks within a few milliseconds; a
// voice ends when it has fallen quiet (80 dB under its start), never at a fixed length; and ring time falls with
// frequency.
//   KICK     a sine whose pitch falls from about five times KICK NOTE into the note itself within 60 ms (a two-stage
//            fall, so the tail is on the note within a few cents), its level held a moment then falling at the kit's
//            decay; DRIVE saturates it (harmonics a small speaker can play); CLICK adds a short high-passed noise tick
//            and a 2-3 kHz blip on top.
//   SNARE    two membrane modes (the body, 150-300 Hz, its pitch gliding down a little), a noise crack (high-passed,
//            its ring falling: T60 about 0.2 s), a clap (CLAP: three bursts 9-11 ms apart and a tail, band-passed), and
//            a short room (ROOM: four damped combs and two allpasses, the highs dying first).
//   HATS     the research's H2: two plates of 48 modes, 120 Hz to 17 kHz (the second 7% higher), each mode's ring
//            T60 = T(h) (f/4k)^-0.1, a stick whose contact time sets the bright edge, a chatter of band-passed noise
//            following the plates, and each mode heard by the two mics with its own gains (wide). Closed (42), pedal
//            (44) and open (46) are one hat: a closed or pedal stroke chokes an open one. T(h) runs 0.38 s closed to
//            2.4 s open.
//   TOMS     sines with a falling pitch and two membrane modes. CYMBALS: the crash and ride models of metal.js (the FDN).
//   RISER    (34) noise and a band-pass sweeping up for the note's length (up to 8 s). IMPACT (33) a sub boom falling
//            an octave, a noise burst and a long dark tail.
// KIT picks each piece's character (DUBSTEP, RIDDIM, DNB, MELODIC). TUNE moves everything but the kick (KICK NOTE does
// that), DECAY every ring, WIDTH the hats and cymbals, and CLIP (on by default) is a 2x oversampled soft clipper on the
// whole kit at a level that keeps the kick's and the snare's crest inside the targets; under 120 Hz the kit is mono
// (club systems sum it). LEVEL is the kit's.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';
import { metalSource } from './metal.js';

export const KITS = ['DUBSTEP', 'RIDDIM', 'DNB', 'MELODIC'];
export const KICK_NOTES = ['C1', 'C#1', 'D1', 'D#1', 'E1', 'F1', 'F#1', 'G1', 'G#1', 'A1', 'A#1', 'B1'];
// the notes it plays, by name (get_device lists them)
export const NOTES = { 33: 'Impact', 34: 'Riser', 35: 'Kick', 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 40: 'Snare (rimshot)',
  41: 'Floor tom', 42: 'Hat', 43: 'Low tom', 44: 'Pedal hat', 45: 'Mid tom', 46: 'Open hat', 47: 'Mid tom 2', 48: 'High tom', 49: 'Crash',
  50: 'High tom 2', 51: 'Ride', 52: 'China', 53: 'Ride bell', 55: 'Splash', 57: 'Crash 2', 59: 'Ride 2' };

export const PRESETS = [
  { name: 'Dubstep', tags: ['bass-music', 'dubstep', 'drums'], blurb: 'Half-time weight: a long tuned kick, a huge roomy snare and clap', params: { kit: 'DUBSTEP' } },
  { name: 'Riddim', tags: ['bass-music', 'riddim', 'drums'], blurb: 'Tight and loud: a short punchy kick, a dry cracking snare, clipped harder', params: { kit: 'RIDDIM', room: 0.15, click: 0.7, drive: 0.4 } },
  { name: 'Drum and bass', tags: ['bass-music', 'dnb', 'drums'], blurb: 'Fast and bright: a tight kick, a high snare that cracks, quick hats', params: { kit: 'DNB', kick_note: 'A1', room: 0.25, clap: 0.35 } },
  { name: 'Melodic', tags: ['bass-music', 'melodic', 'drums'], blurb: 'Round and wide: a soft-edged kick, a snare with a big room, open hats', params: { kit: 'MELODIC', room: 0.55, clap: 0.7, width: 0.8 } },
];

export default defineDevice({
  id: 'core.clubkit', name: 'Sandbag', kind: 'instrument', cat: 'drums', by: 'overdub',
  blurb: 'A synthesized club kit for bass music: tuned sub kick, huge snare',
  nod: 'the layered, tuned drum kits of dubstep, riddim and drum and bass (GM drum map)',
  notes: NOTES,
  params: [
    { key: 'kit', label: 'KIT', opts: KITS, def: 0, role: 'shape', desc: 'the kit: DUBSTEP (long tuned kick, huge roomy snare), RIDDIM (short punchy kick, dry snare), DNB (tight kick, high cracking snare, quick hats), MELODIC (round and wide)' },
    { key: 'kick_note', label: 'KICK NOTE', opts: KICK_NOTES, def: 5, role: 'pitch', desc: 'the note the kick\'s sub tail rings at: tune it to the song\'s root (F1 is 44 Hz)' },
    { key: 'tune', label: 'TUNE', min: -12, max: 12, def: 0, unit: 'st', role: 'pitch', desc: 'every drum but the kick up or down' },
    { key: 'decay', label: 'DECAY', min: 0.4, max: 2, def: 1, unit: 'x', role: 'decay', desc: 'every ring shorter (tight) or longer: the kick\'s tail, the snare, the hats and cymbals' },
    { key: 'click', label: 'CLICK', min: 0, max: 1, def: 0.5, role: 'tone', desc: 'the kick\'s click on top: none (all sub) to a sharp tick that cuts through a growl' },
    { key: 'clap', label: 'CLAP', min: 0, max: 1, def: 0.6, role: 'mix', desc: 'the clap layered into the snare' },
    { key: 'room', label: 'ROOM', min: 0, max: 1, def: 0.35, role: 'mix', desc: 'the short room around the snare and clap: dry to big' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.3, role: 'drive', desc: 'saturation on the kick and the snare\'s body: harmonics a small speaker can play' },
    { key: 'width', label: 'WIDTH', min: 0, max: 1, def: 0.6, role: 'width', desc: 'how wide the hats and cymbals are (the kick and snare stay in the middle)' },
    { key: 'clip', label: 'CLIP', opts: ['OFF', 'ON'], def: 1, role: 'shape', desc: 'a soft clipper on the whole kit, 2x oversampled, set per kit to take the peaks\' first milliseconds and keep their punch' },
    { key: 'level', label: 'LEVEL', min: -24, max: 6, def: 0, unit: 'dB', role: 'level', desc: 'the kit\'s level' },
  ],
  presets: PRESETS,
  // a sandbag on a stand: canvas, a stencilled number
  look: { color: '#5b5440', ink: '#efe6cc', shape: 'wide', finish: 'flat', knob: 'black', label: 'stencil', led: '#ffcf4a' },
  poly: 24,
  tail: 4,
  kernel: kernel(metalSource() + String.raw`
const KICK = 0, SNARE = 1, CLAP = 2, RIM = 3, HAT = 4, TOM = 5, CYM = 6, RISER = 7, IMPACT = 8;
const PIECE = { 33: IMPACT, 34: RISER, 35: KICK, 36: KICK, 37: RIM, 38: SNARE, 39: CLAP, 40: SNARE, 41: TOM, 42: HAT, 43: TOM, 44: HAT, 45: TOM,
  46: HAT, 47: TOM, 48: TOM, 49: CYM, 50: TOM, 51: CYM, 52: CYM, 53: CYM, 55: CYM, 57: CYM, 59: CYM };
const TOMHZ = { 41: 62, 43: 74, 45: 88, 47: 104, 48: 124, 50: 148 };
// each kit: the kick (from: how many times its note the pitch starts at; t1, t2 ms: the two falls; hold ms; t60 s: the
// tail; clickHz), the snare (hz; t60 of the body; crack t60 and its high pass; clap Hz), the hats' T(0) and stick
// (contact ms at full velocity), the clipper's drive (dB), and the pieces' levels (kick, snare, clap, hat, tom, cym, rim)
const KIT = [
  { from: 5.2, t1: 3.2, t2: 11, hold: 2, knock: 16, sus: 0.2, t60: 0.62, clickHz: 2600, sHz: 190, sT: 0.32, cT: 0.18, cHp: 1500, clapHz: 1150, hatT: 0.36, tc: 0.16, clip: 3, lv: [0.395, 0.282, 0.207, 0.094, 0.169, 0.132, 0.132] },
  { from: 6, t1: 2.6, t2: 9, hold: 2, knock: 16, sus: 0.28, t60: 0.38, clickHz: 3200, sHz: 205, sT: 0.24, cT: 0.16, cHp: 1800, clapHz: 1300, hatT: 0.3, tc: 0.15, clip: 4.5, lv: [0.353, 0.26, 0.168, 0.084, 0.151, 0.109, 0.126] },
  { from: 5, t1: 2.8, t2: 9.5, hold: 2, knock: 15, sus: 0.28, t60: 0.3, clickHz: 3600, sHz: 235, sT: 0.22, cT: 0.16, cHp: 2200, clapHz: 1400, hatT: 0.28, tc: 0.14, clip: 3.5, lv: [0.336, 0.277, 0.151, 0.101, 0.151, 0.118, 0.126] },
  { from: 4.6, t1: 3.6, t2: 13, hold: 2, knock: 16, sus: 0.17, t60: 0.72, clickHz: 2200, sHz: 182, sT: 0.36, cT: 0.2, cHp: 1300, clapHz: 1100, hatT: 0.42, tc: 0.18, clip: 2, lv: [0.425, 0.294, 0.243, 0.101, 0.182, 0.152, 0.131] },
];
const MEM = [1, 1.594, 2.136, 2.296];
const LN1000 = 6.907755278982137;
// a decay coefficient per sample for a T60 of t seconds
const dk = (t, sr) => Math.exp(-LN1000 / (Math.max(0.002, t) * sr));

// The short room: four damped combs a side (lengths from the seed's draw, left and right apart) into two allpasses.
// Its T60 falls with frequency (a one-pole in each loop), so the snare's highs die first.
class Room {
  constructor(sr, seed) {
    const R = rng(seed ^ 0x51ab), k = sr / 48000;
    this.n = []; this.b = []; this.w = new Int32Array(8); this.lp = new Float64Array(8); this.g = new Float64Array(8);
    const base = [1117, 1283, 1427, 1601];
    for (let c = 0; c < 8; c++) { const n = Math.round((base[c & 3] + (c >> 2) * 37 + 23 * R()) * k); this.n.push(n); this.b.push(new Float32Array(n)); }
    this.ap = [new Float32Array(Math.round(225 * k)), new Float32Array(Math.round(341 * k)), new Float32Array(Math.round(229 * k)), new Float32Array(Math.round(349 * k))];
    this.aw = new Int32Array(4); this.t60 = -1; this.damp = 0.78; this.l = 0; this.r = 0;
  }
  set(t60, sr) {
    if (t60 === this.t60) return;
    this.t60 = t60;
    for (let c = 0; c < 8; c++) this.g[c] = Math.pow(10, -3 * this.n[c] / (t60 * sr));
  }
  tick(x) {
    let l = 0, r = 0;
    for (let c = 0; c < 8; c++) {
      const b = this.b[c], w = this.w[c], y = b[w];
      this.lp[c] = y + (this.lp[c] - y) * this.damp;
      b[w] = x + this.lp[c] * this.g[c];
      this.w[c] = w + 1 === this.n[c] ? 0 : w + 1;
      if (c < 4) l += y; else r += y;
    }
    for (let a = 0; a < 4; a++) {
      const b = this.ap[a], w = this.aw[a], d = b[w], v = (a < 2 ? l : r) + 0.6 * d;
      b[w] = v; this.aw[a] = w + 1 === b.length ? 0 : w + 1;
      if (a < 2) l = d - 0.6 * v; else r = d - 0.6 * v;
    }
    this.l = l * 0.25; this.r = r * 0.25;
  }
  clear() { for (const b of this.b) b.fill(0); for (const b of this.ap) b.fill(0); this.lp.fill(0); }
}

return {
  create({ sr, seed }) {
    const R0 = rng(seed ^ 0x7c1b);
    // ---- the hats: two plates of 48 modes (one bank of 96), the chatter, the openness, the strokes waiting for process()
    const HN = 96, hat = new MBank(HN);
    hat.n = HN;
    for (let k = 0; k < HN; k++) {
      const plate = k < 48 ? 0 : 1, j = k % 48, u = (j + 0.5 + 0.8 * (R0() * 0.5)) / 48;
      const f = 120 * Math.pow(17000 / 120, u) * (plate ? 1.07 : 1);
      hat.f[k] = f;
      hat.t[k] = Math.min(2, Math.pow(f / 4000, -0.0985) * (0.7 + 0.3 * (R0() + 1)));
      hat.amp[k] = (0.4 + 0.3 * (R0() + 1)) * Math.pow(f / 1000, -0.046) / Math.sqrt(48);
      const a = Math.PI / 4 + (Math.PI / 2) * R0();
      hat.ml[k] = Math.cos(a) * Math.SQRT2; hat.mr[k] = Math.sin(a) * Math.SQRT2 * (R0() < 0 ? -1 : 1);
    }
    const hatBP = svf(sr), hatHP = svf(sr), hatBP2 = svf(sr), hatHP2 = svf(sr), hatN = rng(seed ^ 0x4a7), hatN2 = rng(seed ^ 0x5b8);
    let hatF = 0, hatLive = false;
    const HL = new Float64Array(4096), HR = new Float64Array(4096);
    // ---- the cymbals (metal.js's FDN): 0 crash (49), 1 crash 2 (57), 2 ride (51, 53, 59), 3 china (52), 4 splash (55)
    const CY = [new Metal(sr, seed ^ 0x1001, 0, 1), new Metal(sr, seed ^ 0x1002, 0, 1), new Metal(sr, seed ^ 0x1003, 1, 1), new Metal(sr, seed ^ 0x1004, 2, 1), new Metal(sr, seed ^ 0x1005, 3, 1)];
    const CYPAN = [-0.45, 0.45, 0.35, -0.6, 0.6];
    // strokes for the shared models, waiting for process(): { rec, p, v } (rec.pfr: the frames its voice has rendered
    // since it started, so the stroke lands n - pfr into the block)
    const pend = []; for (let i = 0; i < 32; i++) pend.push({ rec: null, p: 0, v: 0, at: 0 });
    let np = 0;
    // ---- the bus: the clipper (2x), the level
    let clipOn = 1, clipG = 1, clipMk = 1;
    const ocl = os2((x) => sat(x * clipG) * clipMk), ocr = os2((x) => sat(x * clipG) * clipMk);
    const dL = delayLine(64), dR = delayLine(64);
    const lvS = glide(20, sr, 1);
    // the low end in the middle: the side under about 250 Hz taken out (the snare's body and room in the middle too): the side through a 4th-order high pass at 250 Hz
    const mb1 = svf(sr).set(250, 0.7071), mb2 = svf(sr).set(250, 0.7071);
    let P0 = null;

    function voice(i) {
      const R = rng(((seed ^ 0x3c6e) + i * 7919) >>> 0), room = new Room(sr, seed + i * 131);
      const hp1 = svf(sr), hp2 = svf(sr), lp1 = svf(sr), bp1 = svf(sr), bp2 = svf(sr), lp2 = svf(sr);
      const rec = { pfr: 0, done: true };
      const v = {
        piece: -1, p: 0, vel: 0, t: 0, ph: 0, ph2: 0, ph3: 0, a: 0, f0: 0, K: null, rel: false, env: 0, peak: 0, quiet: 0, len: 0,
        m1: 0, m2: 0, d1: 1, d2: 1, ce: 0, cdk: 1, clapE: 0, rv: 0, tail: 0, kd: 1, pan: 0, dur: 0, rise: 0,
        start(p, vel, P) {
          P0 = P;
          const K = KIT[P.kit | 0], pc = PIECE[p];
          v.piece = pc === undefined ? -1 : pc; v.p = p; v.vel = vel; v.t = 0; v.K = K; v.rel = false; v.quiet = 0; v.peak = 0;
          v.ph = 0; v.ph2 = 0; v.ph3 = 0;
          const dec = P.decay, tn = Math.pow(2, P.tune / 12);
          // velocity: about 13 dB over the whole range (the timbre carries the rest)
          v.a = Math.pow(Math.max(0.02, vel), 0.75);
          if (v.piece === KICK) {
            v.f0 = 440 * Math.pow(2, ((P.kick_note | 0) + 24 - 69) / 12);
            v.kd = dk(K.t60 * dec, sr);
            room.clear();
          } else if (v.piece === SNARE || v.piece === CLAP || v.piece === RIM) {
            v.f0 = (p === 37 ? 1750 : K.sHz) * tn;
            v.d1 = dk(K.sT * dec, sr); v.d2 = dk(K.sT * 0.7 * dec, sr);
            v.cdk = dk(K.cT * dec, sr); v.ce = 1;
            hp1.set(K.cHp * (0.7 + 0.6 * vel), 0.6); hp2.set(K.cHp * 0.8, 0.6); lp1.set(3500 + 10500 * vel * vel, 0.5);
            bp1.set(K.clapHz * tn, 1.4); bp2.set(K.clapHz * 1.9 * tn, 1.6);
            room.set(0.18 + 0.25 * P.room * dec, sr);
            v.clapE = 0; v.tail = 0;
          } else if (v.piece === TOM) {
            v.f0 = (TOMHZ[p] || 90) * tn; v.d1 = dk(0.45 * dec, sr); v.d2 = dk(0.18 * dec, sr);
          } else if (v.piece === HAT || v.piece === CYM) {
            // a stroke on a shared model: process() places it, this voice only counts frames until it has
            rec.pfr = 0; rec.done = false;
            if (np < pend.length) { const e = pend[np++]; e.rec = rec; e.p = p; e.v = vel; } else rec.done = true;
          } else if (v.piece === RISER) {
            v.dur = 0; v.rise = 0; hp1.set(300, 0.7); room.clear(); room.set(1.2, sr);
          } else if (v.piece === IMPACT) {
            v.f0 = 82; room.clear(); room.set(1.6 * dec, sr); lp1.set(2500, 0.6); hp1.set(40, 0.6);
          }
        },
        release() { v.rel = true; },
        render(L, Rr, n, P, T) {
          const pc = v.piece;
          if (pc < 0) return false;
          if (pc === HAT || pc === CYM) { if (rec.done) return false; rec.pfr += n; return true; }
          const K = v.K, a = v.a, dr = P.drive;
          let pk = 0;
          if (pc === KICK) {
            const f0 = v.f0, from = K.from - 1, k1 = 1 / (K.t1 * 0.001 * sr), k2 = 1 / (K.t2 * 0.001 * sr), hold = K.hold * 0.001 * sr;
            const ck = P.click, g = 1 + 2.2 * dr, mk = 1 / sat(g), cH = K.clickHz / sr, kn = 1 / (K.knock * 0.001 * sr), sus = K.sus;
            hp1.set(3000, 0.7);
            for (let i = 0; i < n; i++) {
              const t = v.t++;
              // the pitch: two falls (a fast one for the knock, a slower one into the note), on the note within cents by 60 ms
              const fr = f0 * (1 + from * (0.62 * Math.exp(-t * k1) + 0.38 * Math.exp(-t * k2)));
              v.ph += fr / sr; if (v.ph >= 1) v.ph -= 1;
              // the level: the knock (falling from 1 to the tail's level over its own time), then the tail, held a
              // moment and falling at the kit's T60; a 0.4 ms rise
              let e = (t < hold ? 1 : Math.pow(v.kd, t - hold)) * (sus + (1 - sus) * Math.exp(-t * kn));
              if (t < 0.0004 * sr) e *= t / (0.0004 * sr);
              let y = sat(g * sinT(v.ph) * e) * mk;
              // the click: a high-passed noise tick (1.2 ms) and a blip at clickHz (4 ms)
              if (t < 0.02 * sr) {
                const nz = hp1.tick(R()) * Math.exp(-t / (0.0012 * sr)), bl = sinT((v.ph2 += cH) % 1) * Math.exp(-t / (0.004 * sr));
                y += ck * (0.55 * nz + 0.35 * bl);
              }
              y *= a * K.lv[0];
              L[i] += y; Rr[i] += y;
              const ay = y < 0 ? -y : y; if (ay > pk) pk = ay;
            }
            if (v.t > hold + 0.05 * sr && Math.pow(v.kd, v.t - hold) < 1e-4) return false;
            return true;
          }
          if (pc === SNARE || pc === CLAP || pc === RIM) {
            const rim = pc === RIM, clapOnly = pc === CLAP, f0 = v.f0, rmx = P.room, cl = clapOnly ? 1 : P.clap;
            const g = 1 + 1.5 * dr, mk = 1 / sat(g);
            const gap = [0, 0.0095, 0.0205], gl = rim ? 0 : (clapOnly ? 1 : 0.55);
            for (let i = 0; i < n; i++) {
              const t = v.t++, ts = t / sr;
              // the body: two modes, the first gliding down a few percent in its first 20 ms
              const glide = 1 + 0.05 * v.vel * v.vel * Math.exp(-ts / 0.018);
              v.ph += f0 * glide / sr; if (v.ph >= 1) v.ph -= 1;
              v.ph2 += f0 * MEM[1] / sr; if (v.ph2 >= 1) v.ph2 -= 1;
              // (a harder stroke excites the higher mode more: brighter)
              v.m1 = (t === 0 ? 1 : v.m1 * v.d1); v.m2 = (t === 0 ? 0.1 + 0.85 * v.vel * v.vel : v.m2 * v.d2);
              let body = rim ? 0 : clapOnly ? 0 : sat(g * (v.m1 * sinT(v.ph) + v.m2 * sinT(v.ph2))) * mk;
              // the crack: noise high-passed and darkened, its ring falling; a stick at the front (0.6 ms)
              v.ce *= v.cdk;
              const nz = R();
              let crack = clapOnly ? 0 : lp1.tick(hp2.tick(hp1.tick(nz))) * v.ce * (rim ? 0.6 : 1.1) * Math.pow(v.vel, 2.5);
              if (t < 0.0008 * sr) crack += 3.4 * v.vel * v.vel * nz * (1 - t / (0.0008 * sr));
              if (rim) { body = 0.6 * sinT((v.ph3 += 1750 / sr) % 1) * Math.exp(-ts / 0.025) + 0.4 * sinT((v.ph2) % 1) * Math.exp(-ts / 0.012); }
              // the clap: three bursts and a tail, band-passed
              let ce = 0;
              for (let b = 0; b < 3; b++) { const d = ts - gap[b]; if (d >= 0 && d < 0.03) ce += Math.exp(-d / 0.0032) * (b === 2 ? 1 : 0.8); }
              const ctail = ts >= gap[2] ? Math.exp(-(ts - gap[2]) / (0.045 * v.K.cT / 0.2)) * 0.5 : 0;
              const cz = bp1.tick(nz) * 0.75 + bp2.tick(nz) * 0.35;
              const clap = cl * gl * cz * (ce + ctail) * 2.2 * Math.pow(v.vel, 1.5);
              let dry = (body * (clapOnly ? 0 : 0.9) + crack * 0.62 + clap) * a;
              // the room
              room.tick(dry);
              const wl = dry + room.l * rmx * 1.6, wr = dry + room.r * rmx * 1.6;
              const lv = K.lv[rim ? 6 : clapOnly ? 2 : 1];
              L[i] += wl * lv; Rr[i] += wr * lv;
              const ay = Math.abs(wl * lv) + Math.abs(wr * lv); if (ay > pk) pk = ay;
            }
            if (v.t > 0.05 * sr) { if (pk < 2e-5) { v.quiet += n; if (v.quiet > 0.08 * sr) return false; } else v.quiet = 0; }
            return true;
          }
          if (pc === TOM) {
            const f0 = v.f0, g = 1 + 2 * dr, mk = 1 / sat(g), lvl = K.lv[4] * a;
            const pan = (v.p - 45) / 10 * P.width * 0.6, glL = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, glR = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
            for (let i = 0; i < n; i++) {
              const t = v.t++, ts = t / sr;
              const fr = f0 * (1 + 0.6 * Math.exp(-ts / 0.012) + 0.08 * Math.exp(-ts / 0.08));
              v.ph += fr / sr; if (v.ph >= 1) v.ph -= 1;
              v.ph2 += fr * MEM[1] / sr; if (v.ph2 >= 1) v.ph2 -= 1;
              v.m1 = t === 0 ? 1 : v.m1 * v.d1; v.m2 = t === 0 ? 0.35 : v.m2 * v.d2;
              let y = sat(g * (v.m1 * sinT(v.ph) + v.m2 * sinT(v.ph2))) * mk;
              if (t < 0.0008 * sr) y += 0.3 * R() * (1 - t / (0.0008 * sr));
              y *= lvl;
              L[i] += y * glL; Rr[i] += y * glR;
            }
            return v.m1 > 1e-4 || v.t < 0.05 * sr;
          }
          if (pc === RISER) {
            // noise through a band-pass sweeping 300 Hz to 9 kHz over four bars at the song's tempo, louder as it goes,
            // into a room; let go, it fades over a quarter of a second
            const span = 16 * 60 / (T && T.bpm > 0 ? T.bpm : 140) * sr;
            for (let i = 0; i < n; i++) {
              const t = v.t++;
              if (!v.rel) v.dur = t;
              const u = Math.min(1, t / span), fc = 300 * Math.pow(30, u);
              if ((t & 31) === 0) bp1.set(fc, 2.2);
              const env = v.rel ? Math.exp(-(t - v.dur) / (0.25 * sr)) : Math.min(1, t / (0.5 * sr)) * (0.25 + 0.75 * u);
              const x = bp1.tick(R()) * env * 0.9 * a;
              room.tick(x);
              L[i] += x * 0.8 + room.l * 0.9; Rr[i] += x * 0.8 + room.r * 0.9;
              const ay = Math.abs(x) + Math.abs(room.l); if (ay > pk) pk = ay;
            }
            if (v.rel) { if (pk < 2e-5) { v.quiet += n; if (v.quiet > 0.1 * sr) return false; } else v.quiet = 0; }
            return true;
          }
          if (pc === IMPACT) {
            // a sub boom falling an octave, a dark noise burst, a long room
            for (let i = 0; i < n; i++) {
              const t = v.t++, ts = t / sr;
              const fr = 41 + 41 * Math.exp(-ts / 0.35);
              v.ph += fr / sr; if (v.ph >= 1) v.ph -= 1;
              const boom = sinT(v.ph) * Math.exp(-ts / 0.7) * Math.min(1, t / (0.001 * sr));
              const burst = lp1.tick(hp1.tick(R())) * Math.exp(-ts / 0.09);
              const x = (0.8 * boom + 0.5 * burst) * a * 0.9;
              room.tick(burst * a * 0.6);
              L[i] += x + room.l * 1.4; Rr[i] += x + room.r * 1.4;
              const ay = Math.abs(x) + Math.abs(room.l); if (ay > pk) pk = ay;
            }
            if (v.t > 0.2 * sr) { if (pk < 2e-5) { v.quiet += n; if (v.quiet > 0.1 * sr) return false; } else v.quiet = 0; }
            return true;
          }
          return false;
        },
        stop() { v.piece = -1; },
      };
      return v;
    }

    return {
      voice,
      process(L, R, n, P) {
        const K = KIT[P.kit | 0], tn = Math.pow(2, P.tune / 12), dec = P.decay, W = P.width;
        if (HL.length < n) return;
        // ---- the strokes on the shared models, at their frames (a hat's waits for the hats' run below)
        let nh = 0;
        for (let h = 0; h < np; h++) {
          const e = pend[h], at = Math.max(0, Math.min(n - 1, n - e.rec.pfr)), p = e.p, vel = e.v;
          e.rec.done = true; e.at = at;
          if (PIECE[p] === HAT) { if (h !== nh) { const x = pend[nh]; pend[nh] = e; pend[h] = x; } nh++; }
          else {
            const ci = p === 49 ? 0 : p === 57 ? 1 : p === 52 ? 3 : p === 55 ? 4 : 2, m = CY[ci];
            if (m.nev < m.ev.length) {
              const ev = m.ev[m.nev++];
              ev.at = at; ev.art = p === 53 ? 1 : p === 59 ? 2 : 0; ev.F = Math.pow(Math.max(0.01, vel), 1.15); ev.w = Math.pow(Math.max(0.01, vel), 0.25);
              ev.r = 0.3; ev.tc = 0.15 + 0.45 * Math.pow(1 - vel, 1.3);
            }
          }
        }
        np = 0;
        // ---- the hats: the bank run up to each stroke's frame, the stroke (the openness: closed 0, pedal a hair, open
        // 1, a closed or pedal stroke choking what rings), on to the next; then the chatter and the mics
        if (nh) {
          // (in frame order)
          for (let i = 1; i < nh; i++) for (let j = i; j > 0 && pend[j - 1].at > pend[j].at; j--) { const x = pend[j]; pend[j] = pend[j - 1]; pend[j - 1] = x; }
          hatLive = true;
        }
        if (hatLive) {
          HL.fill(0, 0, n); HR.fill(0, 0, n);
          let pos = 0;
          for (let h = 0; h < nh; h++) {
            const e = pend[h], p = e.p, vel = e.v;
            if (e.at > pos) { hat.run(HL, HR, pos, e.at); pos = e.at; }
            const h0 = p === 46 ? 1 : p === 44 ? 0.04 : 0;
            const Th = K.hatT * Math.pow(2.4 / K.hatT, Math.pow(h0, 0.7)) * dec;
            hat.set(sr, tn, Th);
            const tc = (K.tc + (0.3 - K.tc) * (1 - vel)) * 0.001, fc = 1.4 / tc, A = Math.pow(Math.max(0.02, vel), 0.7) * (p === 44 ? 0.5 : 1);
            for (let k = 0; k < hat.n; k++) { const f = hat.f[k] * tn; hat.strike(k, A / Math.sqrt(1 + Math.pow(f / fc, 4))); }
          }
          hat.run(HL, HR, pos, n);
          const live = hat.prune();
          hatBP.set(7040 * tn, 0.5); hatHP.set(1800, 0.7); hatBP2.set(7040 * tn, 0.5); hatHP2.set(1800, 0.7);
          const fk = Math.exp(-TAU * 40 / sr), lv = K.lv[3] * 2.2, side = W * 1.2;
          let pk = 0;
          for (let i = 0; i < n; i++) {
            let l = HL[i], r = HR[i];
            const s = (l < 0 ? -l : l) + (r < 0 ? -r : r);
            hatF = s + (hatF - s) * fk;
            const cg = hatF * 2.9 * 0.5;
            l += hatHP.tick(hatBP.tick(hatN())) * cg; r += hatHP2.tick(hatBP2.tick(hatN2())) * cg;
            const m = 0.5 * (l + r), sd = 0.5 * (l - r) * side;
            l = (m + sd) * lv; r = (m - sd) * lv;
            L[i] += l; R[i] += r;
            const a = Math.abs(l) + Math.abs(r); if (a > pk) pk = a;
          }
          if (!live && pk < 1e-6) { hatLive = false; hatF = 0; }
        }
        // ---- the cymbals
        for (let k = 0; k < 5; k++) {
          const m = CY[k];
          if (!m.on && !m.nev) continue;
          m.tm = tn; m.dm = dec;
          m.render(n);
          const pan = CYPAN[k] * W, a = (pan + 1) * Math.PI / 4, g = K.lv[5];
          const gl = Math.cos(a) * Math.SQRT2 * g, gr = Math.sin(a) * Math.SQRT2 * g, fl = m.far, fr = m.farR;
          for (let i = 0; i < n; i++) { const mm = 0.5 * (fl[i] + fr[i]), ss = 0.5 * (fl[i] - fr[i]) * W; L[i] += (mm + ss) * gl; R[i] += (mm - ss) * gr; }
        }
        // ---- the clipper (the dry path delayed to match when it's off, so switching never moves the kit in time)
        clipOn = P.clip | 0;
        clipG = Math.pow(10, K.clip / 20) * 1.1; clipMk = 1 / 1.1 * 0.86;
        const lvT = dbg(P.level);
        for (let i = 0; i < n; i++) {
          const g = lvS.next(lvT), m0 = 0.5 * (L[i] + R[i]), s0 = 0.5 * (L[i] - R[i]), sl = (mb1.tick(s0), mb2.tick(mb1.hp), mb2.hp), x = m0 + sl, y = m0 - sl;
          const cl = ocl(x), cr = ocr(y), xl = dL.tap(15), xr = dR.tap(15);
          dL.write(x); dR.write(y);
          L[i] = (clipOn ? cl : xl) * g; R[i] = (clipOn ? cr : xr) * g;
        }
      },
    };
  },
};
`),
});
