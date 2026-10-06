// core.drumkit: Virtuosity Kit. The studio's first sampled instrument: a real jazz-club kit (Virtuosity Drums, CC0),
// recorded through one stereo pair of overheads, played from samples instead of synthesized. docs/DEVICES.md "Kernel
// data" is how the samples reach the kernel; tools/fetch-kits.js builds them (tools/kits/virtuosity.js names every
// upstream file, pinned by commit and SHA-256).
//
// What it plays. Eleven articulations: kick, snare, the hi-hat closed, half open, open and pedal, ride and its bell,
// a crash and two toms. Each has three velocity layers of two strokes (round robins).
//   velocity   a note's velocity picks the layer, crossfading across each layer boundary (within 0.06 of it: drums
//              linearly, as two strokes of one drum add at the attack; cymbals and hats at equal power) and sets the
//              level along a curve through each layer's measured level (the RMS of its first 150 ms), so the level
//              doesn't jump where the timbre changes
//   strokes    which of the two strokes plays is drawn from the instance's seed, in the order notes arrive (a stroke
//              repeats one time in four), so a render repeats exactly
//   hi-hat     one instrument: a new hat note chokes what the hats were ringing (a closed or pedal note in 30 ms, an
//              open or half-open one in 80 ms, as the plates are struck again)
//   ringing    a piece keeps at most three strokes ringing; the oldest goes in 50 ms
// Params: TUNE (semitones, by resampling with a 4-point Hermite interpolator of our own, fixed at each stroke), DECAY
// (100% is the recording; below it each stroke is gated shorter), a level for each piece, TONE (a tilt around 900 Hz,
// at 0 exactly the recording) and LEVEL. At other sample rates the same interpolator converts from 48 kHz.
// A missing kit (the samples were never fetched, or a song names a kit this server doesn't have) plays nothing, and
// the studio says so; the kernel then makes silence and nothing else.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

// The kit this device plays: the SHA-256 of app/kits/<hex>.odk, built by tools/fetch-kits.js. A different kit is a new
// hash (and a new golden scene); songs carry only this.
export const KIT_HASH = 'sha256-902ab780bd60ccdc0fc23257d16007924469fed4f3a74a340aafe127bff54d72';

// The note map: [MIDI note, piece, name]. General MIDI, two toms for six, and Studio A's half-open hat notes.
export const NOTE_MAP = [
  [35, 'kick', 'Kick (35)'], [36, 'kick', 'Kick'],
  [38, 'snare', 'Snare'], [40, 'snare', 'Snare (40)'],
  [42, 'hat', 'Hat closed'], [22, 'hat', 'Hat closed (22)'],
  [44, 'hatpedal', 'Hat pedal'],
  [46, 'hatopen', 'Hat open'], [26, 'hatopen', 'Hat open (26)'],
  [24, 'hathalf', 'Hat 1/2 open'], [23, 'hathalf', 'Hat 1/2 open (23)'],
  [51, 'ride', 'Ride'], [59, 'ride', 'Ride (59)'], [53, 'bell', 'Ride bell'],
  [49, 'crash', 'Crash'], [57, 'crash', 'Crash (57)'],
  [50, 'tomhi', 'High tom'], [48, 'tomhi', 'High tom (48)'], [47, 'tomhi', 'High tom (47)'],
  [45, 'tomlo', 'Low tom'], [43, 'tomlo', 'Low tom (43)'], [41, 'tomlo', 'Low tom (41)'],
];
const NOTE_NAMES = Object.fromEntries([...NOTE_MAP.map(([n, , name]) => [n, name]), ['other', 'Not in this kit']]);
// the pieces as the kit file names them, and which level knob each answers to
export const PIECES = ['kick', 'snare', 'hat', 'hathalf', 'hatopen', 'hatpedal', 'ride', 'bell', 'crash', 'tomhi', 'tomlo'];
const LEVEL_OF = { kick: 'kick', snare: 'snare', hat: 'hat', hathalf: 'hat', hatopen: 'hat', hatpedal: 'hat', ride: 'ride', bell: 'ride', crash: 'crash', tomhi: 'toms', tomlo: 'toms' };
const lvl = (key, what, def = 0) => ({ key: key + '_level', label: key.toUpperCase(), min: -40, max: 12, def, unit: 'dB', role: 'level', group: 'levels', desc: `${what} (-40 is off)` });

export default defineDevice({
  id: 'core.drumkit', name: 'Virtuosity Kit', kind: 'instrument', cat: 'drums', by: 'overdub',
  blurb: 'A real jazz-club kit, sampled through the overheads',
  nod: 'Virtuosity Drums (Versilian Studios, CC0): a sampled kit, three velocity layers and two strokes per piece',
  notes: NOTE_NAMES,
  data: { kit: KIT_HASH },
  params: [
    { key: 'tune', label: 'TUNE', min: -12, max: 12, def: 0, unit: 'st', role: 'pitch', group: 'kit', desc: 'every piece up or down, semitones (by resampling: lower is longer)' },
    { key: 'decay', label: 'DECAY', min: 5, max: 100, def: 100, unit: '%', role: 'decay', group: 'kit', desc: 'how long each stroke rings: 100% is the recording, lower gates it shorter' },
    { key: 'tone', label: 'TONE', min: -100, max: 100, def: 0, unit: '%', role: 'tone', group: 'kit', desc: 'a tilt around 900 Hz: below 0 darker, above 0 brighter (up to 6 dB each way at the ends); 0 is the recording' },
    { key: 'level', label: 'LEVEL', min: -24, max: 6, def: 0, unit: 'dB', role: 'level', group: 'kit', desc: 'the whole kit' },
    lvl('kick', 'the kick', 8),
    lvl('snare', 'the snare', -5),
    lvl('hat', 'the hi-hat, every way it is played', -3),
    lvl('toms', 'both toms'),
    lvl('ride', 'the ride and its bell'),
    lvl('crash', 'the crash'),
  ],
  presets: [
    { name: 'Overheads', params: {}, blurb: 'the pair, the kick lifted, snare and hats eased back' },
    { name: 'As recorded', params: { kick_level: 0, snare_level: 0, hat_level: 0, level: -4 }, blurb: "the overhead pair's own balance" },
    { name: 'Tight', params: { decay: 45, kick_level: 8, crash_level: -3 }, blurb: 'every stroke gated shorter' },
    { name: 'Dark', params: { tone: -60, ride_level: -2, crash_level: -3 }, blurb: 'tilted down, the cymbals back' },
    { name: 'Bright', params: { tone: 50, hat_level: -2 }, blurb: 'tilted up, for a dense mix' },
    { name: 'Tuned down', params: { tune: -3, kick_level: 8 }, blurb: 'three semitones lower and longer' },
    { name: 'No cymbals', params: { ride_level: -40, crash_level: -40 }, blurb: 'drums and hats only, for layering' },
  ],
  look: { color: '#3a2f27', ink: '#efe3cc', shape: 'wide', finish: 'wood', knob: 'cream', label: 'plate', led: '#ffb347' },
  tail: 8,
  kernel: kernel(String.raw`
const PIECES = ${JSON.stringify(PIECES)};
const LEVEL_OF = ${JSON.stringify(LEVEL_OF)};
const NOTE = ${JSON.stringify(Object.fromEntries(NOTE_MAP.map(([n, piece]) => [n, piece])))};
const HATS = { hat: 1, hathalf: 2, hatopen: 2, hatpedal: 1 };
const METAL = { hat: 1, hathalf: 1, hatopen: 1, hatpedal: 1, ride: 1, bell: 1, crash: 1 };   // 1: closes the hats (30 ms), 2: strikes them again (80 ms)
const XF = 0.06;            // the crossfade half-width around a layer boundary (velocity, 0..1)
const MAKEUP = 2.66;        // +8.5 dB: the overheads brought to the house's level (-18 LUFS on the drum phrase, measured)
const KN = 1 / 32768;       // 16-bit to float, exactly
const dbx = (d) => (d <= -39.9 ? 0 : Math.pow(10, d / 20));
// the last safety, past the limiter's ceiling: linear to 0.89 (-1 dBFS), then a smooth knee
const ceil = (x) => { const a = x < 0 ? -x : x; if (a <= 0.89) return x; const y = 0.89 + 0.1 * Math.tanh((a - 0.89) / 0.1); return x < 0 ? -y : y; };
// a 4-point, third-order Hermite (Catmull-Rom) read of an Int16Array at position pos (exactly x[i] when pos is whole)
const herm = (x, i, f, n) => {
  const x0 = i < n ? x[i] : 0;
  if (f === 0) return x0;
  const xm = i > 0 && i - 1 < n ? x[i - 1] : 0, x1 = i + 1 < n ? x[i + 1] : 0, x2 = i + 2 < n ? x[i + 2] : 0;
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
};

return {
  poly: 24,
  create({ sr, seed, data }) {
    const kit = data && data.kit;
    // no kit: silence, and nothing else (the host says why)
    if (!kit || !kit.samples || !kit.samples.length) return { voice() { return { start() {}, release() {}, render() { return false; } }; } };
    const RATE = kit.sr / sr;
    // the kit by piece: layers in velocity order, each { top (0..1), peak (dB), rr: [{ L, R, n }] }
    const K = {};
    for (const s of kit.samples) {
      const k = K[s.piece] || (K[s.piece] = []);
      const l = k[s.layer] || (k[s.layer] = { top: s.vel / 127, rr: [], peak: 0 });
      // where the stroke starts: 2 ms before it first comes within 20 dB of its peak (the overheads' flight time and,
      // on the pedal, the foot's travel before the plates meet, are skipped, so every stroke lands on its note)
      const L0 = s.ch[0], R0 = s.ch[1] || s.ch[0];
      let pk = 0;
      for (let i = 0; i < s.frames; i++) { const a = Math.abs(L0[i]), b = Math.abs(R0[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
      let on = 0;
      while (on < s.frames && Math.abs(L0[on]) * 10 < pk && Math.abs(R0[on]) * 10 < pk) on++;
      l.rr[s.rr] = { L: L0, R: R0, n: s.frames, at: Math.max(0, on - Math.round(0.002 * kit.sr)) };
    }
    // each layer's level: the mean over its strokes of the RMS of their first 150 ms (dB), what the velocity curve
    // passes through
    for (const p in K) for (const l of K[p]) {
      let sum = 0;
      for (const r of l.rr) { let e = 1; const m = Math.min(r.n - r.at, Math.round(0.15 * kit.sr)); for (let i = r.at; i < r.at + m; i++) e += r.L[i] * r.L[i] + r.R[i] * r.R[i]; sum += 10 * Math.log10(e / (2 * m)) + 20 * Math.log10(KN); }
      l.peak = sum / l.rr.length;
    }
    const FI = Math.round(0.001 * sr);   // a 1 ms fade-in from the start point
    // the level a velocity plays at (dB): through each layer's peak at its top, linear in amplitude below the first
    const levelAt = (L, v) => {
      if (v <= L[0].top) return L[0].peak + 20 * Math.log10(Math.max(0.02, v) / L[0].top);
      for (let i = 1; i < L.length; i++) if (v <= L[i].top) { const u = (v - L[i - 1].top) / (L[i].top - L[i - 1].top); return L[i - 1].peak + (L[i].peak - L[i - 1].peak) * u; }
      return L[L.length - 1].peak;
    };
    const RR = new Uint32Array(1); RR[0] = (seed ^ 0x5eed) >>> 0 || 7;
    const draw = () => (RR[0] = (Math.imul(RR[0], 1664525) + 1013904223) >>> 0) / 4294967296;
    const last = {};          // the last stroke each layer played (piece:layer -> rr)
    const ringing = [];       // the voices sounding, oldest first: what choke and the three-stroke limit look through
    // The tone tilt: a one-pole low pass per side; out = low * gl + (x - low) * gh
    let lpL = 0, lpR = 0;
    const aLP = 1 - Math.exp(-2 * Math.PI * 900 / sr);
    // The output: Studio A's stereo-linked true-peak limiter (a 1.5 ms window plus its detector's 8 samples, declared as
    // latency): the overheads' snare peaks sit 18 dB over the kit's loudness, so the hardest strokes are eased under
    // -1.5 dBTP and the rest pass untouched. The gain is the lowest any point in the window asks for, averaged over the
    // window, released over 40 ms.
    const LA = Math.max(1, Math.round(0.0015 * sr)), TT = 8;
    let LN = 1; while (LN < LA + TT + 2) LN <<= 1;
    const LM = LN - 1, dlL = new Float64Array(LN), dlR = new Float64Array(LN), hb = new Float64Array(LN).fill(1);
    const dqV = new Float64Array(LN), dqI = new Float64Array(LN);
    let dqH = 0, dqT = 0, lw = 0, nAbs = 0, gLim = 1;
    const besselI0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / 2 / k) * (x / 2 / k); s += t; } return s; };
    const TPR = [];
    for (let ph = 1; ph < 4; ph++) {
      const f = ph / 4, row = new Float64Array(2 * TT); let sum = 0;
      for (let j = -TT + 1; j <= TT; j++) { const x = j - f, u = x / (TT + 0.5), w = Math.abs(u) >= 1 ? 0 : besselI0(8 * Math.sqrt(1 - u * u)) / besselI0(8), v = Math.sin(Math.PI * 0.94 * x) / (Math.PI * x); row[j + TT - 1] = v * w; sum += v * w; }
      for (let k = 0; k < row.length; k++) row[k] /= sum;
      TPR.push(row);
    }
    const ringL = new Float64Array(32), ringR = new Float64Array(32);
    let ti = 0;
    const THR = Math.pow(10, -1.5 / 20), limRel = Math.exp(-1 / (0.04 * sr)), boxN = LA + 1;

    function voice() {
      // up to two reads (a crossfade): { r, g, pos } ; g is that read's gain
      const rd = [{ r: null, g: 0, pos: 0, fi: 0 }, { r: null, g: 0, pos: 0, fi: 0 }];
      let nr = 0, piece = '', rate = 1, env = 1, hold = 0, k = 1, fade = 0, fadeN = 0, on = false, t = 0;
      const self = {
        piece: '',
        choke(ms) { if (!on) return; const n = Math.max(1, Math.round(ms * 0.001 * sr)); if (!fadeN || n < fade) { fade = n; fadeN = n; } },
        start(pitch, vel, p) {
          piece = NOTE[pitch] || ''; self.piece = piece; on = false; nr = 0; fade = 0; fadeN = 0; t = 0; env = 1;
          const i = ringing.indexOf(self); if (i >= 0) ringing.splice(i, 1);
          const L = K[piece];
          if (!L) return;
          const v = vel < 0 ? 0 : vel > 1 ? 1 : vel;
          // the layer (or the two across a boundary) and their weights
          let lo = L.length - 1;
          for (let j = 0; j < L.length; j++) if (v <= L[j].top) { lo = j; break; }
          const picks = [];
          // (drums crossfade linearly: two strokes of one drum are alike at the attack, so their amplitudes add; cymbals
          // and hats are noise to each other, so they crossfade at equal power)
          const xf = METAL[piece] ? Math.sqrt : (x) => x;
          if (lo > 0 && v < L[lo - 1].top + XF) { const u = (v - (L[lo - 1].top - XF)) / (2 * XF); picks.push([lo - 1, xf(1 - u)], [lo, xf(u)]); }
          else if (lo < L.length - 1 && v > L[lo].top - XF) { const u = (v - (L[lo].top - XF)) / (2 * XF); picks.push([lo, xf(1 - u)], [lo + 1, xf(u)]); }
          else picks.push([lo, 1]);
          const want = levelAt(L, v);
          const r = draw();
          for (const [li, w] of picks) {
            const lay = L[li], key = piece + ':' + li, n = lay.rr.length;
            // the stroke: the other one three times in four, from the seeded draw (one draw per note, in note order)
            let q = last[key] == null ? (r < 0.5 ? 0 : 1) % n : (r < 0.75 ? (last[key] + 1) % n : last[key]);
            last[key] = q;
            const R = rd[nr++];
            R.r = lay.rr[q]; R.g = w * Math.pow(10, (want - lay.peak) / 20); R.pos = R.r.at; R.fi = 0;
          }
          rate = RATE * Math.pow(2, p.tune / 12);
          // decay: 100% plays the recording out; lower holds part of it, then lets it go exponentially
          const d = p.decay / 100;
          if (d >= 0.999) { hold = Infinity; k = 1; }
          else {
            const len = rd[0].r.n / kit.sr;     // seconds of this stroke
            hold = Math.round(d * d * len * 0.5 * sr);
            const tau = 0.004 + d * d * len * 0.15;
            k = Math.exp(-1 / (tau * sr));
          }
          // the hats are one instrument: a new hat note chokes what they were ringing; any piece rings three strokes at most
          const hc = HATS[piece];
          let same = 0;
          for (let j = ringing.length - 1; j >= 0; j--) {
            const o = ringing[j];
            if (hc && HATS[o.piece]) o.choke(hc === 1 ? 30 : 80);
            else if (o.piece === piece && ++same >= 3) o.choke(50);
          }
          ringing.push(self);
          on = true;
        },
        release() {},     // a drum rings out: note-offs don't stop it
        stop() { on = false; const i = ringing.indexOf(self); if (i >= 0) ringing.splice(i, 1); },
        render(Lo, Ro, n, p) {
          if (!on) return false;
          const g = MAKEUP * dbx(p[LEVEL_OF[piece] + '_level']) * dbx(p.level) * KN;
          let alive = false;
          for (let j = 0; j < nr; j++) {
            const R = rd[j], x = R.r, gj = R.g * g, xn = x.n;
            let pos = R.pos, e = env, h = hold - t, f = fade, fi = R.fi;
            for (let i = 0; i < n; i++) {
              if (pos >= xn) break;
              let a = gj;
              if (fi < FI) { a *= fi / FI; fi++; }
              if (h <= 0) { e *= k; a *= e; } else h--;
              if (fadeN) { if (f <= 0) { a = 0; } else { a *= f / fadeN; f--; } }
              let l, r;
              if (rate === 1) { l = x.L[pos]; r = x.R[pos]; pos += 1; }
              else { const ip = Math.floor(pos), fr = pos - ip; l = herm(x.L, ip, fr, xn); r = herm(x.R, ip, fr, xn); pos += rate; }
              Lo[i] += l * a; Ro[i] += r * a;
            }
            R.pos = pos; R.fi = fi;
            if (pos < xn) alive = true;
          }
          // the shared state moves once per block, after every read has used it
          for (let i = 0; i < n; i++) { if (hold - t <= 0) env *= k; t++; if (fadeN) { if (fade > 0) fade--; } }
          if (fadeN && fade <= 0) alive = false;
          if (env < 1e-4) alive = false;
          if (!alive) self.stop();
          return alive;
        },
      };
      return self;
    }
    return {
      voice,
      latency: LA + TT,
      process(L, R, n, p) {
        const T = p.tone / 100;
        const gh = Math.pow(10, T * 6 / 20), gl = 1 / gh, flat = T > -1e-4 && T < 1e-4;
        let hsum = 0; for (let k = 0; k < boxN; k++) hsum += hb[(lw - k) & LM];
        for (let i = 0; i < n; i++) {
          let l = L[i], r = R[i];
          lpL += aLP * (l - lpL); lpR += aLP * (r - lpR);
          if (!flat) { l = lpL * gl + (l - lpL) * gh; r = lpR * gl + (r - lpR) * gh; }
          // the limiter's detector: the sample TT back and the three points after it (only near the ceiling)
          ringL[ti] = l; ringR[ti] = r;
          const cI = (ti - TT) & 31, cL = ringL[cI], cR = ringR[cI], nL = ringL[(cI + 1) & 31], nR = ringR[(cI + 1) & 31];
          let pk = Math.max(cL < 0 ? -cL : cL, cR < 0 ? -cR : cR);
          if (2 * Math.max(pk, nL < 0 ? -nL : nL, nR < 0 ? -nR : nR) > THR) {
            for (let r3 = 0; r3 < 3; r3++) {
              const row = TPR[r3]; let sl = 0, sr3 = 0;
              for (let j = 0; j < 16; j++) { const k = (cI - TT + 1 + j) & 31; sl += ringL[k] * row[j]; sr3 += ringR[k] * row[j]; }
              const a1 = sl < 0 ? -sl : sl, a2 = sr3 < 0 ? -sr3 : sr3; if (a1 > pk) pk = a1; if (a2 > pk) pk = a2;
            }
          }
          ti = (ti + 1) & 31;
          const gt = pk > THR ? THR / pk : 1;
          while (dqT > dqH && dqV[(dqT - 1) & LM] >= gt) dqT--;
          dqV[dqT & LM] = gt; dqI[dqT & LM] = nAbs; dqT++;
          while (dqI[dqH & LM] <= nAbs - boxN) dqH++;
          const h = dqV[dqH & LM];
          lw = (lw + 1) & LM;
          hsum += h - hb[(lw - boxN) & LM]; hb[lw] = h;
          const gb = hsum / boxN;
          gLim = gb < gLim ? gb : gLim + (gb - gLim) * (1 - limRel);
          dlL[lw] = l; dlR[lw] = r;
          const j2 = (lw - LA - TT) & LM;
          L[i] = ceil(dlL[j2] * gLim); R[i] = ceil(dlR[j2] * gLim);
          nAbs++;
        }
      },
    };
  },
};
`),
});
