// @ts-check
// core.verb: Stairwell. An algorithmic reverb: a pre-delay, four allpass diffusers per side (the early smear), then an
// 8-line feedback delay network with Householder mixing, a damping low-pass in every loop and slowly wandering line
// lengths (so long tails stay smooth instead of ringing metallic). A low cut keeps the wash out of the bass. Wet and dry
// cross over at equal power, so the default MIX sits the sound in a room without making it louder.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.verb',
  name: 'Stairwell',
  kind: 'effect',
  cat: 'ambient',
  by: 'overdub',
  blurb: 'Rooms to stairwells to halls: smooth, never metallic',
  nod: 'a studio algorithmic hall / plate reverb',
  params: [
    { key: 'size', label: 'SIZE', min: 0, max: 1, def: 0.55, role: 'size', desc: 'small room to cathedral' },
    {
      key: 'decay',
      label: 'DECAY',
      min: 0.2,
      max: 20,
      def: 2.4,
      curve: 'log',
      unit: 's',
      role: 'decay',
      desc: 'how long the tail lasts (to -60 dB)',
    },
    {
      key: 'damp',
      label: 'DAMP',
      min: 0,
      max: 1,
      def: 0.45,
      role: 'tone',
      desc: 'bright plate (0) to dark velvet (1)',
    },
    {
      key: 'predelay',
      label: 'PRE',
      min: 0,
      max: 250,
      def: 14,
      unit: 'ms',
      role: 'time',
      desc: 'a gap before the room answers: keeps the dry clear',
    },
    {
      key: 'lowcut',
      label: 'LOW CUT',
      min: 20,
      max: 1000,
      def: 140,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'keeps the wash out of the bass',
    },
    { key: 'width', label: 'WIDTH', min: 0, max: 1, def: 1, role: 'width', desc: 'mono to wide' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 0.22, role: 'mix', desc: 'dry to all room' },
  ],
  look: {
    color: '#e9dfc8',
    ink: '#1d1a16',
    shape: 'wide',
    finish: 'sparkle',
    knob: 'black',
    label: 'script',
    led: '#ff4d4d',
  },
  trails: true,
  tail: 12,
  kernel: kernel(String.raw`
// THE COST. A verb sits on most tracks of most songs, so this one is written for speed: every sample is the same
// arithmetic, in the same order, that lib.js's delayLine, allpass, fdn, svf and glide do (so it sounds bit for bit as
// it did: tools/golden.json, fx:core.verb and the demo songs), but in locals and flat typed arrays, written back
// once a block, instead of closures whose numbers are boxed on the heap at every store. The equal-power mix is worked
// out again only when MIX moves (a cos and a sin a sample, otherwise).
return {
  create({ sr, seed }) {
    const k = sr / 48000, maxPre = Math.ceil(0.26 * sr) + 4;
    const ring = (max) => { let n = 1; while (n < max + 4) n <<= 1; return n; };
    // the pre-delay: two rings sharing a write head
    const PN = ring(maxPre), PM = PN - 1, preL = new Float32Array(PN), preR = new Float32Array(PN);
    // the diffusers: four allpasses a side
    const AP = [142, 107, 379, 277], APR = [151, 113, 397, 263], AG = [0.72, 0.72, 0.64, 0.64];
    const mk = (n) => new Float32Array(Math.max(1, Math.round(n * k) | 0));
    const l0 = mk(AP[0]), l1 = mk(AP[1]), l2 = mk(AP[2]), l3 = mk(AP[3]), r0 = mk(APR[0]), r1 = mk(APR[1]), r2 = mk(APR[2]), r3 = mk(APR[3]);
    const g0 = AG[0], g1 = AG[1], g2 = AG[2], g3 = AG[3];
    const ai = new Int32Array(8);
    // the network: 8 lines in one buffer (line i at i * LN), one write head
    const N = 8, BASE = [1031, 1327, 1523, 1801, 2111, 2437, 2741, 3089];
    const rr = rng(seed ^ 0xf00d);
    const LN = ring(Math.ceil(BASE[N - 1] * 1.8 * k) + 64), LM = LN - 1, lines = new Float32Array(N * LN);
    const len = new Float64Array(N), g = new Float64Array(N), lp = new Float64Array(N), x = new Float64Array(N), mph = new Float64Array(N), mdt = new Float64Array(N);
    for (let i = 0; i < N; i++) { mph[i] = (rr() + 1) / 2; mdt[i] = (0.07 + 0.11 * i / N + 0.03 * rr()) / sr; }
    let da = 0, depth = 6 * k, lastS = -1, lastT = -1, lastD = -1;
    // the low cut and the top (svf, one coefficient set each: both sides are set the same)
    let hk = 1, ha1 = 1, ha2 = 0, ha3 = 0, ta1 = 1, ta2 = 0, ta3 = 0, lastCut = NaN, topSet = false;
    const S = new Float64Array(8); // hl ic1 ic2, hr ic1 ic2, tl ic1 ic2, tr ic1 ic2
    const svfSet = (fc, q) => { const gg = Math.tan(Math.PI * clamp(fc, 5, sr * 0.49) / sr), kk = 1 / Math.max(0.05, q), a1 = 1 / (1 + gg * (gg + kk)), a2 = gg * a1; return [kk, a1, a2, gg * a2]; };
    // the glides (lib.js glide: 30, 60, 30 ms)
    const mA = coef(30 / 1000, sr), pA = coef(60 / 1000, sr), wA = coef(30 / 1000, sr);
    let mY = 0, mF = true, pY = 0, pF = true, wY = 0, wF = true;
    let pw = 0, lw = 0, lastMx = NaN, dry = 1, wet = 0;
    const WET = 0.88;
    return {
      process(L, R, n, P) {
        // fdn.set
        { const size = P.size, t60 = P.decay, damp = P.damp;
          if (!(size === lastS && t60 === lastT && damp === lastD)) {
            lastS = size; lastT = t60; lastD = damp;
            const sc = (0.3 + 1.45 * clamp(size, 0, 1)) * k;
            for (let i = 0; i < N; i++) { len[i] = BASE[i] * sc; g[i] = Math.pow(10, -3 * len[i] / (Math.max(0.05, t60) * sr)); }
            da = Math.exp(-TAU * (16000 * Math.pow(0.05, clamp(damp, 0, 1))) / sr);
            depth = (3 + 9 * clamp(size, 0, 1)) * k;
          } }
        if (P.lowcut !== lastCut) { const c = svfSet(P.lowcut, 0.6); hk = c[0]; ha1 = c[1]; ha2 = c[2]; ha3 = c[3]; lastCut = P.lowcut; }
        if (!topSet) { const c = svfSet(16000, 0.6); ta1 = c[1]; ta2 = c[2]; ta3 = c[3]; topSet = true; }
        const preT = P.predelay * sr / 1000, widT = P.width, mixT = P.mix;
        let hl1 = S[0], hl2 = S[1], hr1 = S[2], hr2 = S[3], tl1 = S[4], tl2 = S[5], tr1 = S[6], tr2 = S[7];
        let i0 = ai[0], i1 = ai[1], i2 = ai[2], i3 = ai[3], j0 = ai[4], j1 = ai[5], j2 = ai[6], j3 = ai[7];
        const n0 = l0.length, n1 = l1.length, n2 = l2.length, n3 = l3.length, m0 = r0.length, m1 = r1.length, m2 = r2.length, m3 = r3.length;
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          if (pF) { pY = preT; pF = false; }
          pY = preT + (pY - preT) * pA;
          const pd = Math.max(1, pY);
          let a = xl, b = xr;
          if (pd > 1) {
            const r = pw - pd, q = Math.floor(r), f = r - q, u = q & PM, v = (q + 1) & PM;
            const ba = preL[u], bb = preR[u];
            a = ba + (preL[v] - ba) * f; b = bb + (preR[v] - bb) * f;
          }
          preL[pw] = xl; preR[pw] = xr; pw = (pw + 1) & PM;
          // the diffusers
          let sl = a, sr2 = b, d, y;
          d = l0[i0]; y = sl + g0 * d; l0[i0] = y; i0++; if (i0 >= n0) i0 = 0; sl = d - g0 * y;
          d = r0[j0]; y = sr2 + g0 * d; r0[j0] = y; j0++; if (j0 >= m0) j0 = 0; sr2 = d - g0 * y;
          d = l1[i1]; y = sl + g1 * d; l1[i1] = y; i1++; if (i1 >= n1) i1 = 0; sl = d - g1 * y;
          d = r1[j1]; y = sr2 + g1 * d; r1[j1] = y; j1++; if (j1 >= m1) j1 = 0; sr2 = d - g1 * y;
          d = l2[i2]; y = sl + g2 * d; l2[i2] = y; i2++; if (i2 >= n2) i2 = 0; sl = d - g2 * y;
          d = r2[j2]; y = sr2 + g2 * d; r2[j2] = y; j2++; if (j2 >= m2) j2 = 0; sr2 = d - g2 * y;
          d = l3[i3]; y = sl + g3 * d; l3[i3] = y; i3++; if (i3 >= n3) i3 = 0; sl = d - g3 * y;
          d = r3[j3]; y = sr2 + g3 * d; r3[j3] = y; j3++; if (j3 >= m3) j3 = 0; sr2 = d - g3 * y;
          // the network (fdn.tick)
          const inL = sl * 0.5, inR = sr2 * 0.5;
          let sum = 0;
          for (let li = 0; li < N; li++) {
            let p = mph[li] + mdt[li]; if (p >= 1) p -= 1; mph[li] = p;
            const r = lw - (len[li] + depth * (1 + sinT(p))), q = Math.floor(r), f = r - q, o = li * LN;
            const y0 = lines[o + ((q - 1) & LM)], y1 = lines[o + (q & LM)], y2 = lines[o + ((q + 1) & LM)], y3 = lines[o + ((q + 2) & LM)];
            const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            const v = ((c3 * f + c2) * f + c1) * f + y1;
            const l = v + (lp[li] - v) * da; lp[li] = l;
            const xv = l * g[li]; x[li] = xv; sum += xv;
          }
          sum *= 2 / N;
          for (let li = 0; li < N; li++) lines[li * LN + lw] = x[li] - sum + ((li & 1) ? inR : inL);
          lw = (lw + 1) & LM;
          const nl = x[0] - x[2] + x[4] - x[6] + 0.5 * (x[1] - x[5]);
          const nr = x[1] - x[3] + x[5] - x[7] + 0.5 * (x[2] - x[6]);
          // the low cut (its high pass), then the top (its low pass)
          let v3 = nl - hl2, v1 = ha1 * hl1 + ha2 * v3, v2 = hl2 + ha2 * hl1 + ha3 * v3;
          hl1 = 2 * v1 - hl1; hl2 = 2 * v2 - hl2;
          const hpl = nl - hk * v1 - v2;
          v3 = nr - hr2; v1 = ha1 * hr1 + ha2 * v3; v2 = hr2 + ha2 * hr1 + ha3 * v3;
          hr1 = 2 * v1 - hr1; hr2 = 2 * v2 - hr2;
          const hpr = nr - hk * v1 - v2;
          v3 = hpl - tl2; v1 = ta1 * tl1 + ta2 * v3; v2 = tl2 + ta2 * tl1 + ta3 * v3;
          tl1 = 2 * v1 - tl1; tl2 = 2 * v2 - tl2;
          let wl = v2;
          v3 = hpr - tr2; v1 = ta1 * tr1 + ta2 * v3; v2 = tr2 + ta2 * tr1 + ta3 * v3;
          tr1 = 2 * v1 - tr1; tr2 = 2 * v2 - tr2;
          let wr = v2;
          if (wF) { wY = widT; wF = false; }
          const w = (wY = widT + (wY - widT) * wA), m = 0.5 * (wl + wr), s = 0.5 * (wl - wr) * w;
          wl = m + s; wr = m - s;
          if (mF) { mY = mixT; mF = false; }
          const mx = (mY = mixT + (mY - mixT) * mA);
          if (mx !== lastMx) { lastMx = mx; dry = Math.cos(mx * Math.PI / 2); wet = Math.sin(mx * Math.PI / 2) * WET; }
          L[i] = xl * dry + wl * wet; R[i] = xr * dry + wr * wet;
        }
        S[0] = hl1; S[1] = hl2; S[2] = hr1; S[3] = hr2; S[4] = tl1; S[5] = tl2; S[6] = tr1; S[7] = tr2;
        ai[0] = i0; ai[1] = i1; ai[2] = i2; ai[3] = i3; ai[4] = j0; ai[5] = j1; ai[6] = j2; ai[7] = j3;
      },
    };
  },
};
`),
});
