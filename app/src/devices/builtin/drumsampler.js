// The sampled drum kit kernel, for kits after Virtuosity Kit: drumSamplerKernel(opts) -> kernel source. It plays an
// .odk whose samples carry { piece, layer, rr, vel, start, loop? } (tools/fetch-kits.js builds them from a recipe in
// tools/kits/). It is Virtuosity Kit's kernel (drumkit.js) with the kit's shape passed in, so the next kit is a recipe,
// a note map and a level per piece; drumkit.js keeps its own copy, as its measured report and golden scene pin it.
//
//   pieces    the pieces the kit file names
//   levelOf   piece -> the level param it answers to (`<name>_level`)
//   note      MIDI note -> piece; any other note plays nothing
//   choke     piece -> [group, ms]: a note of that piece fades whatever of its group is ringing within ms (a hi-hat's
//             closed note stops its open one)
//   metal     piece -> 1: its velocity layers crossfade at equal power (cymbals, hats and brushes are noise to each
//             other); the rest crossfade linearly (two strokes of one drum add at the attack)
//   held      piece -> [attack ms, release ms]: it rings while its note is held (looping where the kit file loops it:
//             a brush stir), fading in over the attack and out over the release once the note ends
//   makeup    the linear gain that brings the kit to the house's level, measured
//   offset    piece -> dB: a piece's level against the others under one knob (a quiet shaker beside a tambourine)
//   even      true: each stroke plays at its layer's level (its own measured level, not the layer's mean), for a source
//             whose strokes of one layer were recorded several dB apart
//
// Velocity picks the layer and crossfades across each boundary (within 0.06 of it); the level follows a curve through
// each layer's measured level (the RMS of its first 150 ms; a held piece's first second), so the level doesn't jump
// where the timbre changes. Which stroke of a layer plays is drawn from the instance's seed in the order notes arrive.
// A piece keeps at most three strokes ringing. Params: tune, decay, tone, level and each `<name>_level` (drumkit.js has
// the words for them). The output runs through Studio A's stereo-linked true-peak limiter (-1.5 dBTP, 1.5 ms ahead).
import { kernel } from './lib.js';

export function drumSamplerKernel({ pieces, levelOf, note, choke = {}, metal = {}, held = {}, makeup = 1, poly = 24, even = false, offset = null }) {
  return kernel(String.raw`
const PIECES = ${JSON.stringify(pieces)};
const LEVEL_OF = ${JSON.stringify(levelOf)};
const NOTE = ${JSON.stringify(note)};
const CHOKE = ${JSON.stringify(choke)};    // piece -> [group, ms]
const METAL = ${JSON.stringify(metal)};    // cymbals and hats: velocity layers crossfade at equal power
const HELD = ${JSON.stringify(held)};      // piece -> [attack ms, release ms]: rings while held
const XF = 0.06;            // the crossfade half-width around a layer boundary (velocity, 0..1)
const MAKEUP = ${makeup};${offset ? `
const OFFSET = ${JSON.stringify(offset)};   // piece -> dB` : ''}
const KN = 1 / 32768;       // 16-bit to float, exactly
const dbx = (d) => (d <= -39.9 ? 0 : Math.pow(10, d / 20));
const ceil = (x) => { const a = x < 0 ? -x : x; if (a <= 0.89) return x; const y = 0.89 + 0.1 * Math.tanh((a - 0.89) / 0.1); return x < 0 ? -y : y; };
const herm = (x, i, f, n) => {
  const x0 = i < n ? x[i] : 0;
  if (f === 0) return x0;
  const xm = i > 0 && i - 1 < n ? x[i - 1] : 0, x1 = i + 1 < n ? x[i + 1] : 0, x2 = i + 2 < n ? x[i + 2] : 0;
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
};

return {
  poly: ${poly},
  create({ sr, seed, data }) {
    const kit = data && data.kit;
    if (!kit || !kit.samples || !kit.samples.length) return { voice() { return { start() {}, release() {}, render() { return false; } }; } };
    const RATE = kit.sr / sr;
    const K = {};
    for (const s of kit.samples) {
      const k = K[s.piece] || (K[s.piece] = []);
      const l = k[s.layer] || (k[s.layer] = { top: s.vel / 127, rr: [], peak: 0 });
      const at = Number.isInteger(s.start) && s.start > 0 ? Math.min(s.start, s.frames) : 0;
      const lp = s.loop && Number.isInteger(s.loop.s) && Number.isInteger(s.loop.e) && s.loop.e > s.loop.s && s.loop.e <= s.frames ? s.loop : null;
      l.rr[s.rr] = { L: s.ch[0], R: s.ch[1] || s.ch[0], n: s.frames, at, ls: lp ? lp.s : 0, le: lp ? lp.e : 0 };
    }
    for (const p in K) for (const l of K[p]) {
      let sum = 0;
      const win = HELD[p] ? 1 : 0.15;
      for (const r of l.rr) { let e = 1; const m = Math.min(r.n - r.at, Math.round(win * kit.sr)); for (let i = r.at; i < r.at + m; i++) e += r.L[i] * r.L[i] + r.R[i] * r.R[i]; sum += 10 * Math.log10(e / (2 * m)) + 20 * Math.log10(KN);${even ? ' r.lv = 10 * Math.log10(e / (2 * m)) + 20 * Math.log10(KN);' : ''} }
      l.peak = sum / l.rr.length;
    }
    const FI = Math.round(0.001 * sr);
    const levelAt = (L, v) => {
      if (v <= L[0].top) return L[0].peak + 20 * Math.log10(Math.max(0.02, v) / L[0].top);
      for (let i = 1; i < L.length; i++) if (v <= L[i].top) { const u = (v - L[i - 1].top) / (L[i].top - L[i - 1].top); return L[i - 1].peak + (L[i].peak - L[i - 1].peak) * u; }
      return L[L.length - 1].peak;
    };
    const RR = new Uint32Array(1); RR[0] = (seed ^ 0x5eed) >>> 0 || 7;
    const draw = () => (RR[0] = (Math.imul(RR[0], 1664525) + 1013904223) >>> 0) / 4294967296;
    const last = {};
    const ringing = [];
    let lpL = 0, lpR = 0;
    const aLP = 1 - Math.exp(-2 * Math.PI * 900 / sr);
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
      const rd = [{ r: null, g: 0, pos: 0, fi: 0 }, { r: null, g: 0, pos: 0, fi: 0 }];
      let nr = 0, piece = '', rate = 1, env = 1, hold = 0, k = 1, fade = 0, fadeN = 0, on = false, t = 0, FIn = FI;
      const self = {
        piece: '',
        choke(ms) { if (!on) return; const n = Math.max(1, Math.round(ms * 0.001 * sr)); if (!fadeN || n < fade) { fade = n; fadeN = n; } },
        start(pitch, vel, p) {
          piece = NOTE[pitch] || ''; self.piece = piece; on = false; nr = 0; fade = 0; fadeN = 0; t = 0; env = 1;
          const i = ringing.indexOf(self); if (i >= 0) ringing.splice(i, 1);
          const L = K[piece];
          if (!L) return;
          const v = vel < 0 ? 0 : vel > 1 ? 1 : vel;
          let lo = L.length - 1;
          for (let j = 0; j < L.length; j++) if (v <= L[j].top) { lo = j; break; }
          const picks = [];
          const xf = METAL[piece] ? Math.sqrt : (x) => x;
          if (lo > 0 && v < L[lo - 1].top + XF) { const u = (v - (L[lo - 1].top - XF)) / (2 * XF); picks.push([lo - 1, xf(1 - u)], [lo, xf(u)]); }
          else if (lo < L.length - 1 && v > L[lo].top - XF) { const u = (v - (L[lo].top - XF)) / (2 * XF); picks.push([lo, xf(1 - u)], [lo + 1, xf(u)]); }
          else picks.push([lo, 1]);
          const want = levelAt(L, v)${offset ? ' + (OFFSET[piece] || 0)' : ''};
          const r = draw();
          for (const [li, w] of picks) {
            const lay = L[li], key = piece + ':' + li, n = lay.rr.length;
            let q = last[key] == null ? (r < 0.5 ? 0 : 1) % n : (r < 0.75 ? (last[key] + 1) % n : last[key]);
            last[key] = q;
            const R = rd[nr++];
            R.r = lay.rr[q]; R.g = w * Math.pow(10, (want - ${even ? 'R.r.lv' : 'lay.peak'}) / 20); R.pos = R.r.at; R.fi = 0;
          }
          rate = RATE * Math.pow(2, p.tune / 12);
          FIn = HELD[piece] ? Math.max(FI, Math.round(HELD[piece][0] * 0.001 * sr)) : FI;
          const d = p.decay / 100;
          if (d >= 0.999) { hold = Infinity; k = 1; }
          else {
            const len = (rd[0].r.le ? Math.max(rd[0].r.le, 2 * kit.sr) : rd[0].r.n) / kit.sr;
            hold = Math.round(d * d * len * 0.5 * sr);
            const tau = 0.004 + d * d * len * 0.15;
            k = Math.exp(-1 / (tau * sr));
          }
          const hc = CHOKE[piece];
          let same = 0;
          for (let j = ringing.length - 1; j >= 0; j--) {
            const o = ringing[j], oc = CHOKE[o.piece];
            if (hc && oc && oc[0] === hc[0]) o.choke(hc[1]);
            else if (o.piece === piece && ++same >= 3) o.choke(50);
          }
          ringing.push(self);
          on = true;
        },
        // a drum rings out; a held piece (a stir) fades over its release
        release() { if (on && HELD[piece]) self.choke(HELD[piece][1]); },
        stop() { on = false; const i = ringing.indexOf(self); if (i >= 0) ringing.splice(i, 1); },
        render(Lo, Ro, n, p) {
          if (!on) return false;
          const g = MAKEUP * dbx(p[LEVEL_OF[piece] + '_level']) * dbx(p.level) * KN;
          let alive = false;
          for (let j = 0; j < nr; j++) {
            const R = rd[j], x = R.r, gj = R.g * g, xn = x.n, le = x.le, ll = x.le - x.ls;
            let pos = R.pos, e = env, h = hold - t, f = fade, fi = R.fi;
            for (let i = 0; i < n; i++) {
              if (le && pos >= le) pos -= ll;
              if (pos >= xn) break;
              let a = gj;
              if (fi < FIn) { a *= fi / FIn; fi++; }
              if (h <= 0) { e *= k; a *= e; } else h--;
              if (fadeN) { if (f <= 0) { a = 0; } else { a *= f / fadeN; f--; } }
              let l, r;
              if (rate === 1) { l = x.L[pos]; r = x.R[pos]; pos += 1; }
              else { const ip = Math.floor(pos), fr = pos - ip; l = herm(x.L, ip, fr, xn); r = herm(x.R, ip, fr, xn); pos += rate; }
              Lo[i] += l * a; Ro[i] += r * a;
            }
            R.pos = pos; R.fi = fi;
            if (le || pos < xn) alive = true;
          }
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
`);
}

// a piece's level knob, as drumkit.js has them
export const pieceLevel = (key, what, def = 0) => ({ key: key + '_level', label: key.toUpperCase(), min: -40, max: 12, def, unit: 'dB', role: 'level', group: 'levels', desc: `${what} (-40 is off)` });
// the four kit-wide knobs, as drumkit.js has them
export const KIT_PARAMS = [
  { key: 'tune', label: 'TUNE', min: -12, max: 12, def: 0, unit: 'st', role: 'pitch', group: 'kit', desc: 'every piece up or down, semitones (by resampling: lower is longer)' },
  { key: 'decay', label: 'DECAY', min: 5, max: 100, def: 100, unit: '%', role: 'decay', group: 'kit', desc: 'how long each stroke rings: 100% is the recording, lower gates it shorter' },
  { key: 'tone', label: 'TONE', min: -100, max: 100, def: 0, unit: '%', role: 'tone', group: 'kit', desc: 'a tilt around 900 Hz: below 0 darker, above 0 brighter (up to 6 dB each way at the ends); 0 is the recording' },
  { key: 'level', label: 'LEVEL', min: -24, max: 6, def: 0, unit: 'dB', role: 'level', group: 'kit', desc: 'the whole kit' },
];
