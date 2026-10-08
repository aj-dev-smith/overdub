// @ts-check
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

export function drumSamplerKernel({ pieces, levelOf, note, choke = {}, metal = {}, held = {}, makeup = 1, poly = 24, even = false, offset = null, rr = null, similar = 1, tight = null, trigger = null, room = null, onset = 0 }) {
  // (the options after `offset` are Rusty Sticks'; with none of them passed, the source is exactly what it was before
  // they existed, so every kit that doesn't ask keeps its sound and its golden hash: tools/metalkit-test.js checks it)
  const NR = rr === 'norepeat', SIM = NR && similar < 1, X = NR || !!tight || !!trigger || !!room || !!onset;
  return kernel(String.raw`
const PIECES = ${JSON.stringify(pieces)};
const LEVEL_OF = ${JSON.stringify(levelOf)};
const NOTE = ${JSON.stringify(note)};
const CHOKE = ${JSON.stringify(choke)};    // piece -> [group, ms]
const METAL = ${JSON.stringify(metal)};    // cymbals and hats: velocity layers crossfade at equal power
const HELD = ${JSON.stringify(held)};      // piece -> [attack ms, release ms]: rings while held
const XF = 0.06;            // the crossfade half-width around a layer boundary (velocity, 0..1)
const MAKEUP = ${makeup};${offset ? `
const OFFSET = ${JSON.stringify(offset)};   // piece -> dB` : ''}${X ? OPTIONS_SRC({ NR, SIM, similar, tight, trigger, room, onset }) : ''}
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
    if (!kit || !kit.samples || !kit.samples.length) return ${trigger ? 'trigOnly(sr, seed)' : '{ voice() { return { start() {}, release() {}, render() { return false; } }; } }'};
    const RATE = kit.sr / sr;
    const K = {};
    for (const s of kit.samples) {
      const k = K[s.piece] || (K[s.piece] = []);
      const l = k[s.layer] || (k[s.layer] = { top: s.vel / 127, rr: [], peak: 0 });
      const at = Number.isInteger(s.start) && s.start > 0 ? Math.min(s.start, s.frames) : 0;
      const lp = s.loop && Number.isInteger(s.loop.s) && Number.isInteger(s.loop.e) && s.loop.e > s.loop.s && s.loop.e <= s.frames ? s.loop : null;
      l.rr[s.rr] = { L: s.ch[0], R: s.ch[1] || s.ch[0], n: s.frames, at, ls: lp ? lp.s : 0, le: lp ? lp.e : 0${trigger ? ', pol: s.pol < 0 ? -1 : 1' : ''} };
    }
    for (const p in K) for (const l of K[p]) {
      let sum = 0;
      const win = HELD[p] ? 1 : 0.15;
      for (const r of l.rr) { let e = 1; const m = Math.min(r.n - r.at, Math.round(win * kit.sr)); for (let i = r.at; i < r.at + m; i++) e += r.L[i] * r.L[i] + r.R[i] * r.R[i]; sum += 10 * Math.log10(e / (2 * m)) + 20 * Math.log10(KN);${even || NR ? ' r.lv = 10 * Math.log10(e / (2 * m)) + 20 * Math.log10(KN);' : ''} }
      l.peak = sum / l.rr.length;
    }${SIM ? `
    // (norepeat) how alike each stroke is to the strokes of its own and the neighbouring layers: their first 30 ms (mono,
    // from the start) correlated. After a stroke the picker passes over those over SIMILAR while others remain, else
    // takes the least alike
    const NW = Math.round(0.03 * kit.sr), SEG = new Float64Array(NW);
    for (const p in K) {
      const Lp = K[p];
      for (let li = 0; li < Lp.length; li++) for (let q = 0; q < Lp[li].rr.length; q++) {
        const a = Lp[li].rr[q];
        if (!a) continue;
        a.nid = []; a.nc = [];
        let aa = 0;
        for (let i = 0; i < NW; i++) { const j = a.at + i; SEG[i] = j < a.n ? a.L[j] + a.R[j] : 0; aa += SEG[i] * SEG[i]; }
        for (let lj = Math.max(0, li - 1); lj <= Math.min(Lp.length - 1, li + 1); lj++) for (let q2 = 0; q2 < Lp[lj].rr.length; q2++) {
          const b = Lp[lj].rr[q2];
          if (!b || b === a) continue;
          let ab = 0, bb = 0;
          for (let i = 0; i < NW; i++) { const j = b.at + i, y = j < b.n ? b.L[j] + b.R[j] : 0; ab += SEG[i] * y; bb += y * y; }
          a.nid.push(lj * 64 + q2); a.nc.push(aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0);
        }
      }
    }` : ''}
    const FI = Math.round(0.001 * sr);
    const levelAt = (L, v) => {
      if (v <= L[0].top) return L[0].peak + 20 * Math.log10(Math.max(0.02, v) / L[0].top);
      for (let i = 1; i < L.length; i++) if (v <= L[i].top) { const u = (v - L[i - 1].top) / (L[i].top - L[i - 1].top); return L[i - 1].peak + (L[i].peak - L[i - 1].peak) * u; }
      return L[L.length - 1].peak;
    };
    const RR = new Uint32Array(1); RR[0] = (seed ^ 0x5eed) >>> 0 || 7;
    const draw = () => (RR[0] = (Math.imul(RR[0], 1664525) + 1013904223) >>> 0) / 4294967296;
    const last = {};
    const ringing = [];${X ? `
    const H1 = {}, H2 = {}, POOL = new Int32Array(256);   // each piece's last two strokes, and the draw's pool (norepeat)
    const PRE = Math.round(ONSET * sr);${trigger ? '\n    const CLK = clickTable(sr);' : ''}${room ? '\n    const ROOM = kitRoom(sr, seed), RIN = new Float64Array(1024), SENDERS = [];\n    let blk = 0, roomSize = -1;' : ''}` : ''}
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
      let nr = 0, piece = '', rate = 1, env = 1, hold = 0, k = 1, fade = 0, fadeN = 0, on = false, t = 0, FIn = FI;${X ? `
      let tgOn = false, tgH = 0, tgK = 1, tgE = 1;${trigger ? '\n      const trg = trigger(sr, CLK, PRE);' : ''}${room ? '\n      const SB = new Float64Array(1024);' : ''}` : ''}
      const self = {
        piece: '',${room ? `
        SB, b: -1, c: 0, st: -1,` : ''}
        choke(ms) { if (!on) return; const n = Math.max(1, Math.round(ms * 0.001 * sr)); if (!fadeN || n < fade) { fade = n; fadeN = n; }${trigger ? ' trg.choke(ms);' : ''} },
        start(pitch, vel, p) {
          piece = NOTE[pitch] || ''; self.piece = piece; on = false; nr = 0; fade = 0; fadeN = 0; t = 0; env = 1;
          const i = ringing.indexOf(self); if (i >= 0) ringing.splice(i, 1);${X ? `
          tgOn = false; tgE = 1;${trigger ? ' trg.stop();' : ''}${room ? `
          // (a voice taken for a new note mid-block: what it sent before goes into the room now, at the block's start)
          if (self.b === blk && self.c > 0) { for (let i2 = 0; i2 < self.c && i2 < 1024; i2++) RIN[i2] += SB[i2]; self.c = 0; }
          self.st = blk;` : ''}` : ''}
          const L = K[piece];
          if (!L) return;
          const v = vel < 0 ? 0 : vel > 1 ? 1 : vel;
          let lo = L.length - 1;
          for (let j = 0; j < L.length; j++) if (v <= L[j].top) { lo = j; break; }
${NR ? `          const want = levelAt(L, v)${offset ? ' + (OFFSET[piece] || 0)' : ''};
          // the stroke: one of this layer's or the nearer neighbour layer's, never either of the piece's last two (nor, with
          // SIMILAR, a near twin of the last), at
          // its own measured level brought to the curve's, then +-0.4 dB and +-4 cents of its own (all from the seed)
          const nb = L.length < 2 ? lo : lo === 0 ? 1 : lo === L.length - 1 ? lo - 1 : v > 0.5 * (L[lo - 1].top + L[lo].top) ? lo + 1 : lo - 1;
          const was = ${SIM ? 'H1[piece] === undefined ? null : L[H1[piece] >> 6].rr[H1[piece] & 63]' : 'null'};
          let cnt = 0, best = -1, bc = 2;
          for (let li = Math.min(lo, nb); li <= Math.max(lo, nb); li++) for (let q = 0; q < L[li].rr.length; q++) {
            const id = li * 64 + q;
            if (!L[li].rr[q] || id === H1[piece] || id === H2[piece]) continue;
            const k = was ? was.nid.indexOf(id) : -1, c = k >= 0 ? was.nc[k] : 0;
            if (c <= ${SIM ? 'SIMILAR' : '1'}) POOL[cnt++] = id; else if (c < bc) { bc = c; best = id; }
          }
          if (!cnt && best >= 0) POOL[cnt++] = best;
          if (!cnt) POOL[cnt++] = lo * 64;
          const id = POOL[Math.floor(draw() * cnt)];
          H2[piece] = H1[piece]; H1[piece] = id;
          const R = rd[nr++];
          R.r = L[id >> 6].rr[id & 63]; R.g = Math.pow(10, (want + 0.4 * (2 * draw() - 1) - R.r.lv) / 20); R.pos = R.r.at; R.fi = 0;
          rate = RATE * Math.pow(2, p.tune / 12 + 4 * (2 * draw() - 1) / 1200);${trigger ? `
          if (piece === TRIG.piece) trg.start(want - L[L.length - 1].peak, p, R.r.pol);` : ''}${tight ? `
          if (piece === TIGHT.piece) { const ms = p[TIGHT.key]; tgOn = true; tgH = Math.round(TIGHT.hold * ms * 0.001 * sr); tgK = Math.pow(10, -3 / (TIGHT.t60 * ms * 0.001 * sr)); }` : ''}
` : `          const picks = [];
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
`}          FIn = HELD[piece] ? Math.max(FI, Math.round(HELD[piece][0] * 0.001 * sr)) : FI;
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
            else if (o.piece === piece && ${tight ? '(piece === TIGHT.piece || ++same >= 3)) o.choke(piece === TIGHT.piece ? p[TIGHT.key] : 50);' : '++same >= 3) o.choke(50);'}
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
            let pos = R.pos, e = env, h = hold - t, f = fade, fi = R.fi;${tight ? ' let ge = tgE, gh = tgH - t;' : ''}
            for (let i = 0; i < n; i++) {
              if (le && pos >= le) pos -= ll;
              if (pos >= xn) break;
              let a = gj;
              if (fi < FIn) { a *= fi / FIn; fi++; }
              if (h <= 0) { e *= k; a *= e; } else h--;${tight ? `
              if (tgOn) { if (gh <= 0) ge *= tgK; else gh--; a *= ge; }` : ''}
              if (fadeN) { if (f <= 0) { a = 0; } else { a *= f / fadeN; f--; } }
              let l, r;
              if (rate === 1) { l = x.L[pos]; r = x.R[pos]; pos += 1; }
              else { const ip = Math.floor(pos), fr = pos - ip; l = herm(x.L, ip, fr, xn); r = herm(x.R, ip, fr, xn); pos += rate; }
              Lo[i] += l * a; Ro[i] += r * a;
            }
            R.pos = pos; R.fi = fi;
            if (le || pos < xn) alive = true;
          }
${trigger ? `          if (trg.on && trg.render(Lo, Ro, n, g / KN)) alive = true;
` : ''}          for (let i = 0; i < n; i++) { if (hold - t <= 0) env *= k;${tight ? ' if (tgOn) { if (tgH - t <= 0) tgE *= tgK; }' : ''} t++; if (fadeN) { if (fade > 0) fade--; } }
          if (fadeN && fade <= 0) alive = false;
          if (env < 1e-4${tight ? ' || tgE < 1e-4' : ''}) alive = false;${trigger ? '\n          if (trg.on) alive = true;' : ''}${room ? `
          const sd = ROOMSEND[piece] || 0;
          if (sd) {
            if (self.b !== blk) { self.b = blk; self.c = 0; SENDERS.push(self); }
            const c = self.c;
            for (let i = 0; i < n && c + i < 1024; i++) SB[c + i] = (Lo[i] + Ro[i]) * 0.5 * sd;
            self.c = c + n;
          }` : ''}
          if (!alive) self.stop();
          return alive;
        },
      };
      return self;
    }
    return {
      voice,
      latency: LA + TT${onset ? ' + PRE' : ''},
      process(L, R, n, p) {${room ? `
        // the room: each voice's send, where in the block it played (a voice that started in this block played its
        // last frames), through the kit room; culled while ROOM is off
        if (p.room_size !== roomSize) { roomSize = p.room_size; ROOM.set(roomSize); }
        for (let s = 0; s < SENDERS.length; s++) { const o = SENDERS[s], off = o.st === blk ? n - o.c : 0; for (let i = 0; i < o.c && off + i < n; i++) if (off + i >= 0) RIN[off + i] += o.SB[i]; }
        SENDERS.length = 0;
        const rl = dbx(p.room) * ROOM_GAIN;
        if (rl > 0) for (let i = 0; i < n; i++) { ROOM.tick(RIN[i]); L[i] += ROOM.l * rl; R[i] += ROOM.r * rl; }
        for (let i = 0; i < n; i++) RIN[i] = 0;
        blk++;` : ''}
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

// The options' kernel source (Rusty Sticks): the constants, the kit room (kitroom.js), and the trigger.
//   rr: 'norepeat'                   the stroke picker above
//   similar: 0..1                    (with norepeat) after a stroke, the picker passes over the strokes whose first 30 ms
//                                    correlate with its own over this, while any others are left (1, the default: off)
//   tight: { piece, key, hold, t60 } a new note of the piece fades the last over p[key] ms; each one's tail is held for
//                                    hold x that, then falls with a T60 of t60 x that
//   trigger: { piece, ref, ck, sk }  a synthesized click (2-6 kHz burst and a one-sample impulse, 4 ms) and sub (a sine at
//                                    p.sub_hz from an octave up, falling over 12 ms, decaying with p[tight.key]) at the
//                                    stroke's attack, the sub's polarity the stroke's own (`pol`, from the kit file);
//                                    params click, sub (dB re `ref`, -40 off), sub_hz and trig_vel (0: every hit the same,
//                                    1: following the velocity). With no kit file, the trigger still plays.
//   room: { send: { piece: amount }, gain, src }   per-piece sends into the room whose kernel text is src (kitroom.js's
//                                    KITROOM: the kit passes it in, so a kit without a room loads nothing more); params
//                                    room (dB, -40 off), room_size
//   onset                            seconds each stroke starts before its attack: added to the declared latency
function OPTIONS_SRC({ NR, SIM, similar, tight, trigger, room, onset }) {
  return `
// (the options)
const TIGHT = ${JSON.stringify(tight)};
const TRIG = ${JSON.stringify(trigger)};
const ROOMSEND = ${JSON.stringify(room ? room.send : null)}, ROOM_GAIN = ${room ? room.gain : 0};
const ONSET = ${onset};
${SIM ? `
const SIMILAR = ${similar};   // (norepeat) two strokes this alike over their first 30 ms aren't played one after the other` : ''}${room ? room.src : ''}${trigger ? TRIGGER_SRC : ''}`;
}
const TRIGGER_SRC = String.raw`
// the trigger's click: a burst of seeded noise, high-passed at 2 kHz and low-passed at 6 kHz (two one-poles each),
// 4 ms under a falling square-root envelope (a flatter burst: the most click for its peak), scaled to an RMS of 1, plus a one-sample impulse: the same every hit
function clickTable(sr) {
  const n = Math.round(0.004 * sr), c = new Float64Array(n), rnd = rng(0x6b1c);
  const ah = 1 - Math.exp(-2 * Math.PI * 2000 / sr), al = 1 - Math.exp(-2 * Math.PI * 6000 / sr);
  let h1 = 0, h2 = 0, l1 = 0, l2 = 0, e = 0;
  for (let i = 0; i < n; i++) {
    const x = rnd(); h1 += ah * (x - h1); let y = x - h1; h2 += ah * (y - h2); y -= h2;
    l1 += al * (y - l1); l2 += al * (l1 - l2);
    const u = 1 - i / n; c[i] = l2 * (Math.sin(Math.PI * (1 - u))); e += c[i] * c[i];
  }
  const m = 1 / Math.sqrt(e / n);
  for (let i = 0; i < n; i++) c[i] *= m;
  c[0] += TRIG.imp;
  return c;
}
// one voice's trigger: start(vd, p, pol) with vd the stroke's level in dB re the top layer's; render adds it in
function trigger(sr, CLK, PRE) {
  let ti = 0, cA = 0, sA = 0, sp = 0, gl = 0, gk = 1, se = 1, sk = 1, sh = 0, pol = 1, f0 = 52, fade = 0, fadeN = 0;
  const NC = CLK.length;
  const T = {
    on: false,
    start(vd, p, polarity) {
      const tv = p.trig_vel < 0 ? 0 : p.trig_vel > 1 ? 1 : p.trig_vel, lv = TRIG.ref + tv * vd;
      cA = p.click <= -39.9 ? 0 : Math.pow(10, (lv + p.click) / 20) * TRIG.ck;
      sA = p.sub <= -39.9 ? 0 : Math.pow(10, (lv + p.sub) / 20) * TRIG.sk;
      const ms = TIGHT ? p[TIGHT.key] : 18;
      sh = Math.round(2 * ms * 0.001 * sr); sk = Math.pow(10, -3 / (10 * ms * 0.001 * sr));
      f0 = p.sub_hz; gl = 1; gk = Math.exp(-1 / (0.004 * sr)); sp = 0; se = 1; pol = polarity < 0 ? -1 : 1;
      ti = 0; fade = 0; fadeN = 0; T.on = cA > 0 || sA > 0;
    },
    stop() { T.on = false; },
    choke(ms) { if (!T.on) return; const n = Math.max(1, Math.round(ms * 0.001 * sr)); if (!fadeN || n < fade) { fade = n; fadeN = n; } },
    render(Lo, Ro, n, g) {
      for (let i = 0; i < n; i++) {
        let fa = g;
        if (fadeN) { if (fade <= 0) { T.on = false; break; } fa *= fade / fadeN; fade--; }
        if (ti >= PRE) {
          const k2 = ti - PRE;
          let y = k2 < NC ? CLK[k2] * cA : 0;
          if (sA) {
            sp += f0 * (gl > 1e-6 ? Math.pow(2, gl) : 1) / sr; if (sp >= 1) sp -= 1; gl *= gk;
            if (k2 >= sh) se *= sk;
            y += sinT(sp) * sA * se * pol;
          }
          y *= fa; Lo[i] += y; Ro[i] += y;
        }
        ti++;
      }
      if (ti - PRE > NC && (!sA || se < 1e-4)) T.on = false;
      return T.on;
    },
  };
  return T;
}
// no kit file (never fetched, or a song naming a kit this server doesn't have): the trigger alone, so a missing
// download is heard as a click and a sub rather than as nothing
function trigOnly(sr, seed) {
  const CLK = clickTable(sr), PRE = Math.round(ONSET * sr);
  return {
    latency: PRE,
    voice() {
      const tg = trigger(sr, CLK, PRE);
      let piece = '';
      return {
        start(pitch, vel, p) { piece = NOTE[pitch] || ''; if (piece === TRIG.piece) tg.start(20 * Math.log10(Math.max(0.02, vel)), p, 1); else tg.stop(); },
        release() {},
        render(Lo, Ro, n, p) { return tg.on && tg.render(Lo, Ro, n, MAKEUP * dbx(p[LEVEL_OF[piece] + '_level']) * dbx(p.level)); },
      };
    },
  };
}
`;

// a piece's level knob, as drumkit.js has them
export const pieceLevel = (key, what, def = 0) => ({ key: key + '_level', label: key.toUpperCase(), min: -40, max: 12, def, unit: 'dB', role: 'level', group: 'levels', desc: `${what} (-40 is off)` });
// the four kit-wide knobs, as drumkit.js has them
export const KIT_PARAMS = [
  { key: 'tune', label: 'TUNE', min: -12, max: 12, def: 0, unit: 'st', role: 'pitch', group: 'kit', desc: 'every piece up or down, semitones (by resampling: lower is longer)' },
  { key: 'decay', label: 'DECAY', min: 5, max: 100, def: 100, unit: '%', role: 'decay', group: 'kit', desc: 'how long each stroke rings: 100% is the recording, lower gates it shorter' },
  { key: 'tone', label: 'TONE', min: -100, max: 100, def: 0, unit: '%', role: 'tone', group: 'kit', desc: 'a tilt around 900 Hz: below 0 darker, above 0 brighter (up to 6 dB each way at the ends); 0 is the recording' },
  { key: 'level', label: 'LEVEL', min: -24, max: 6, def: 0, unit: 'dB', role: 'level', group: 'kit', desc: 'the whole kit' },
];
