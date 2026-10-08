// @ts-check
// core.strings: Music Stands. A bowed string section, sample-free. Every note is four players:
//   BOWS      a bowed string moves in a sawtooth (the Helmholtz motion), so each player is a band-limited saw, a few
//             cents from the others (ENSEMBLE), each with its own vibrato that only arrives once the note has settled
//             (rate 4.6-6.2 Hz, about +-10 cents at the default VIBRATO, its own phase and wander), its own slow pitch
//             drift and its own bow: the players don't start together, so the section's attack is soft and thick. A
//             little rosin noise on the bow, more as it bites. Four detuned saws beat, so a held note would swell and
//             sag 6-9 dB about once a second; a leveller holds each note's power to what its players add up to on
//             their own (a big section's many bows average the beating out), so a held note moves 1-3 dB.
//   BOW      how hard and where they bow (BRIGHT): a low-pass that follows the bow's level, so a swell gets brighter
//             as it gets louder, and velocity is both louder and nearer the bridge. Harder notes also speak faster.
//   BODY      the instrument's wood: a hollow around 280 Hz, the main wood resonance near 500 Hz and the bridge hill
//             around 2.8 kHz, the same shared body for the whole section.
//   SEATING   orchestral seating: violins on the left, violas, cellos and basses to the right, and the four players
//             of each note spread across their desk (WIDTH). Then a hall (HALL).
// About -16 LUFS on the test phrase at defaults. tools/instruments-test.js and tools/timbre-test.js measure the rest.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.strings',
  name: 'Music Stands',
  kind: 'instrument',
  cat: 'synth',
  by: 'overdub',
  blurb: 'A string section: slow bows, vibrato, a hall around it',
  nod: 'an orchestral string section, bowed',
  params: [
    {
      key: 'attack',
      label: 'ATTACK',
      min: 0.01,
      max: 3,
      def: 0.22,
      curve: 'log',
      unit: 's',
      role: 'attack',
      desc: 'how slowly the bows come in (harder notes come in faster)',
    },
    {
      key: 'release',
      label: 'RELEASE',
      min: 0.05,
      max: 4,
      def: 0.5,
      curve: 'log',
      unit: 's',
      role: 'release',
      desc: 'how long the bows take to leave the string',
    },
    {
      key: 'bright',
      label: 'BRIGHT',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'tone',
      desc: 'over the fingerboard (soft) to near the bridge (glassy)',
    },
    {
      key: 'vibrato',
      label: 'VIBRATO',
      min: 0,
      max: 1,
      def: 0.45,
      role: 'depth',
      desc: "how much the players' left hands move",
    },
    {
      key: 'ensemble',
      label: 'ENSEMBLE',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'depth',
      desc: 'a tight chamber group to a big, loose section',
    },
    {
      key: 'width',
      label: 'WIDTH',
      min: 0,
      max: 1,
      def: 0.6,
      role: 'width',
      desc: 'mono to orchestral seating: violins left, cellos right',
    },
    { key: 'hall', label: 'HALL', min: 0, max: 1, def: 0.3, role: 'mix', desc: 'how much of the hall you hear' },
  ],
  presets: [
    { name: 'Warm section', params: {} },
    { name: 'Swell', params: { attack: 1.5, release: 1.2 } },
    { name: 'Solo-ish', params: { ensemble: 0, width: 0.3 } },
    { name: 'Stabs', params: { attack: 0.01, release: 0.1, bright: 0.8 } },
  ],
  look: {
    color: '#6b3a22',
    ink: '#f7e7cf',
    shape: 'wide',
    finish: 'stripe',
    knob: 'cream',
    label: 'script',
    led: '#ffcf8a',
  },
  tail: 6,
  kernel: kernel(String.raw`
const NP = 4;                                  // players per note (render() plays the four side by side)
const SPREAD = [-1, -0.3, 0.4, 0.95];          // where each player sits on the desk, and which way they detune
return {
  poly: 16,
  create({ sr, seed }) {
    // the body (shared), as EQ: a hollow, the wood, the bridge hill, a soft top
    const bodyL = [svf(sr), svf(sr), svf(sr), svf(sr)], bodyR = [svf(sr), svf(sr), svf(sr), svf(sr)];
    const setBody = (b) => { b[0].bell(280, 1.4, -2.5); b[1].bell(520, 1.1, 3.5); b[2].bell(2800, 0.9, 4); b[3].shelfHi(7500, 0.7, -6); };
    setBody(bodyL); setBody(bodyR);
    const hall = fdn(sr, seed ^ 0x57a6), pre = delayLine(Math.ceil(0.03 * sr)), preR = delayLine(Math.ceil(0.03 * sr));
    hall.set(0.78, 2.4, 0.55);
    const hlS = glide(40, sr);
    const dcl = dcblock(sr), dcr = dcblock(sr);
    return {
      voice(vi) {
        const r = rng((seed ^ 0x3b0e) + vi * 6151);
        const ph = new Float64Array(NP), dt = new Float64Array(NP), det = new Float64Array(NP), vph = new Float64Array(NP), vdt = new Float64Array(NP);
        const drift = new Float64Array(NP), driftT = new Float64Array(NP), gl = new Float64Array(NP), gr = new Float64Array(NP);
        const env = new Float64Array(NP), ka = new Float64Array(NP), kr = new Float64Array(NP), dly = new Int32Array(NP);
        const na = Math.exp(-TAU * 3000 / sr);
        let f0 = 261, vel = 0.7, t = 0, rel = false, cnt = 0, vibAmt = 0, amp = 0.5, ny = 0, ns = (seed ^ 0x6b1d) + vi * 977;
        // the bow filter (a state-variable low-pass per side, inline) and the section's leveller
        let l1 = 0, l2 = 0, r1 = 0, r2 = 0, fa1 = 1, fa2 = 0, fa3 = 0, ga1 = 1, ga2 = 0, ga3 = 0, pc = 0, pi = 0, lg = 1, dg = 0, nzA = 0;
        let gl0 = 1, gl1 = 1, gl2 = 1, gl3 = 1, gr0 = 1, gr1 = 1, gr2 = 1, gr3 = 1, wm0 = 1, wm1 = 1, wm2 = 1, wm3 = 1, ws0 = 0, ws1 = 0, ws2 = 0, ws3 = 0;
        let ps = 0, qs = 0, ls = 1, ds = 0;   // the side's leveller
        // a saw (rising, -1..1) from its first K partials
        let K = 0;
        const saws = (q) => { let y = 0; for (let k = 1; k <= K; k++) { const x = k * q; y -= sinT(x - Math.floor(x)) / k; } return y * 0.6366197723675814; };
        // a player's envelope len samples on: rising toward 1 once its bow is on the string, or falling once let go
        // (kaN and krN are the factors for a whole 16-sample stretch)
        const kaN = new Float64Array(NP), krN = new Float64Array(NP);
        const envTo = (j, e, len) => {
          if (rel) return e * (len === 16 ? krN[j] : Math.pow(kr[j], len));
          const on = t + len - dly[j];
          if (on <= 0) return e;
          return on >= len ? 1 - (1 - e) * (len === 16 ? kaN[j] : Math.pow(1 - ka[j], len)) : 1 - (1 - e) * Math.pow(1 - ka[j], on);
        };
        // the right side's cutoff sits 3% above the left's, so the two sides don't move as one
        const fset = (fc) => {
          const k = 1 / 0.62;
          let g = Math.tan(Math.PI * fc / sr);
          fa1 = 1 / (1 + g * (g + k)); fa2 = g * fa1; fa3 = g * fa2;
          g *= 1.03;
          ga1 = 1 / (1 + g * (g + k)); ga2 = g * ga1; ga3 = g * ga2;
        };
        return {
          start(p, v, P) {
            f0 = mtof(p); vel = v; t = 0; rel = false; cnt = 0; vibAmt = 0;
            // above about F6 a polyBLEP saw's aliases come back into the band 50 dB down: the players there are summed
            // from the saw's own partials up to 12 kHz instead (eight or fewer)
            K = f0 > 1400 ? Math.max(1, Math.floor(Math.min(12000, sr * 0.45) / (f0 * 1.02))) : 0;
            const ens = P.ensemble, w = P.width;
            const seat = clamp((60 - p) / 26, -1, 1) * 0.7 * w;           // low notes right, high notes left
            const atk = P.attack * (1.6 - 1.3 * v);
            amp = 0.3 + 0.7 * v;
            for (let j = 0; j < NP; j++) {
              det[j] = SPREAD[j] * (1.5 + 6 * ens) * (0.7 + 0.3 * (r() + 1)) + r() * 0.8;
              vph[j] = (r() + 1) / 2; vdt[j] = (4.6 + 0.8 * (r() + 1)) / sr;
              drift[j] = r() * 2; driftT[j] = r() * 3;
              ph[j] = (r() + 1) / 2;
              const pn = clamp(seat + SPREAD[j] * (0.8 + 0.8 * ens) * w, -1, 1);
              const g = panLR(pn); gl[j] = g[0]; gr[j] = g[1];
              // the players don't start together (and a held voice restarting swells from where it is)
              dly[j] = Math.round((j === 0 ? 0 : (r() + 1) / 2) * (0.01 + 0.05 * ens) * sr * (1.2 - 0.8 * v));
              ka[j] = 1 - coef(Math.max(0.006, atk * (0.85 + 0.3 * (r() + 1) / 2)) / 2.2, sr);
              kr[j] = coef(Math.max(0.03, P.release) * (0.85 + 0.3 * (r() + 1) / 2) / 6.91, sr);
              kaN[j] = Math.pow(1 - ka[j], 16); krN[j] = Math.pow(kr[j], 16);
            }
            pc = 0; pi = 0; lg = 1; dg = 0; ps = 0; qs = 0; ls = 1; ds = 0;
            gl0 = gl[0]; gl1 = gl[1]; gl2 = gl[2]; gl3 = gl[3]; gr0 = gr[0]; gr1 = gr[1]; gr2 = gr[2]; gr3 = gr[3];
            // each player's share of the mid and the side, as power
            wm0 = ((gl0 + gr0) / 2) ** 2; wm1 = ((gl1 + gr1) / 2) ** 2; wm2 = ((gl2 + gr2) / 2) ** 2; wm3 = ((gl3 + gr3) / 2) ** 2;
            ws0 = ((gl0 - gr0) / 2) ** 2; ws1 = ((gl1 - gr1) / 2) ** 2; ws2 = ((gl2 - gr2) / 2) ** 2; ws3 = ((gl3 - gr3) / 2) ** 2;
          },
          release(P) {
            rel = true;
            for (let j = 0; j < NP; j++) { kr[j] = coef(Math.max(0.03, P.release) * (0.85 + 0.15 * j) / 6.91, sr); krN[j] = Math.pow(kr[j], 16); }
          },
          render(L, R, n, P) {
            const vibD = P.vibrato, br = P.bright;
            const og = amp * 0.088;
            let sc = 0, sq = 0, sc2 = 0, sq2 = 0;
            // in stretches of up to 16 samples between control updates (pitch, vibrato, drift, the bow), the four players
            // side by side
            for (let c0 = 0; c0 < n;) {
              if ((cnt & 15) === 0) {
                // vibrato arrives after ~0.3 s and grows over ~0.6 s; pitches, drift and the bow filter move every 16 samples
                const secs = t / sr;
                const va = (0.3 + 0.7 * clamp((secs - 0.25) / 0.6, 0, 1)) * vibD * (rel ? 0.6 : 1);
                vibAmt += (va - vibAmt) * 0.05;
                let e = 0;
                for (let j = 0; j < NP; j++) {
                  vph[j] += vdt[j] * 16; if (vph[j] >= 1) vph[j] -= 1;
                  if ((cnt & 8191) === 0) driftT[j] = r() * 3;
                  drift[j] += (driftT[j] - drift[j]) * 0.004;
                  const x = (det[j] + drift[j] + vibAmt * 22 * sinT(vph[j])) * 5.776226504666211e-4;   // cents -> ln (VIBRATO 1: +-22)
                  dt[j] = f0 * (1 + x * (1 + x * (0.5 + x * 0.16666666666666666))) / sr;
                  e += env[j];
                }
                e /= NP;
                const harm = 2 + (16 * br + 4) * (0.08 + 0.92 * vel) * Math.sqrt(e + 1e-4);
                fset(clamp(f0 * harm, 250, 12000));
                nzA = (0.012 + 0.05 * br) * e * (1.4 - e) * vel;
              }
              const len = Math.min(16 - (cnt & 15), n - c0), end = c0 + len;
              let e0 = env[0], e1 = env[1], e2 = env[2], e3 = env[3], q0 = ph[0], q1 = ph[1], q2 = ph[2], q3 = ph[3];
              const d0 = dt[0], d1 = dt[1], d2 = dt[2], d3 = dt[3], h0 = 1 - d0, h1 = 1 - d1, h2 = 1 - d2, h3 = 1 - d3;
              // the envelopes: each player's bow comes in from its own moment, or all of them leave together. They are
              // worked out exactly for the stretch's end and ramped across it.
              const s0 = (envTo(0, e0, len) - e0) / len, s1 = (envTo(1, e1, len) - e1) / len;
              const s2 = (envTo(2, e2, len) - e2) / len, s3 = (envTo(3, e3, len) - e3) / len;
              for (let i = c0; i < end; i++) {
                e0 += s0; e1 += s1; e2 += s2; e3 += s3;
                q0 += d0; if (q0 >= 1) q0 -= 1;
                q1 += d1; if (q1 >= 1) q1 -= 1;
                q2 += d2; if (q2 >= 1) q2 -= 1;
                q3 += d3; if (q3 >= 1) q3 -= 1;
                // band-limited saws: polyBLEP (only near each wrap), or for the top notes the saw's own few partials
                let y0 = 2 * q0 - 1, y1 = 2 * q1 - 1, y2 = 2 * q2 - 1, y3 = 2 * q3 - 1;
                if (K) { y0 = saws(q0); y1 = saws(q1); y2 = saws(q2); y3 = saws(q3); }
                else {
                  if (q0 < d0 || q0 > h0) y0 -= blep(q0, d0);
                  if (q1 < d1 || q1 > h1) y1 -= blep(q1, d1);
                  if (q2 < d2 || q2 > h2) y2 -= blep(q2, d2);
                  if (q3 < d3 || q3 > h3) y3 -= blep(q3, d3);
                }
                y0 *= e0; y1 *= e1; y2 *= e2; y3 *= e3;
                const sl = y0 * gl0 + y1 * gl1 + y2 * gl2 + y3 * gl3, sr2 = y0 * gr0 + y1 * gr1 + y2 * gr2 + y3 * gr3;
                const mid = (sl + sr2) * 0.5, side = (sl - sr2) * 0.5;
                if (i & 1) {   // the leveller's powers, every other sample
                  const p0 = y0 * y0, p1 = y1 * y1, p2 = y2 * y2, p3 = y3 * y3;
                  sc += mid * mid; sq += p0 * wm0 + p1 * wm1 + p2 * wm2 + p3 * wm3;
                  sc2 += side * side; sq2 += p0 * ws0 + p1 * ws1 + p2 * ws2 + p3 * ws3;
                }
                const ml = mid * lg, sd = side * ls;
                // rosin: noise on the bow, strongest while the bow is biting in; then the bow filter, per side
                ns = (Math.imul(ns, 1664525) + 1013904223) | 0;
                const x0 = ns * 4.656612873077393e-10; ny = x0 + (ny - x0) * na; const z = (x0 - ny) * nzA;
                let v0 = ml + sd + z, v3 = v0 - l2, v1 = fa1 * l1 + fa2 * v3, v2 = l2 + fa2 * l1 + fa3 * v3;
                l1 = 2 * v1 - l1; l2 = 2 * v2 - l2;
                const ol = v2;
                v0 = ml - sd + z; v3 = v0 - r2; v1 = ga1 * r1 + ga2 * v3; v2 = r2 + ga2 * r1 + ga3 * v3;
                r1 = 2 * v1 - r1; r2 = 2 * v2 - r2;
                L[i] += ol * og; R[i] += v2 * og;
                lg += dg; ls += ds;
              }
              env[0] = e0; env[1] = e1; env[2] = e2; env[3] = e3; ph[0] = q0; ph[1] = q1; ph[2] = q2; ph[3] = q3;
              cnt += len; t += len; c0 = end;
            }
            // the leveller: four detuned players beat, and alone the section would swell and sag about once a second
            // (6-9 dB); a real section's many bows don't. The mid's power and the side's are each held to what the
            // players add up to on their own (within 8 dB, over about 35 ms), steering the next block from this one,
            // so the section is steady in mono and in stereo.
            if (n > 0) {
              const al = 1 - Math.exp(-n / (0.035 * sr));
              if (pc === 0 && pi === 0) { pc = sc / n; pi = sq / n; ps = sc2 / n; qs = sq2 / n; }
              else { pc += (sc / n - pc) * al; pi += (sq / n - pi) * al; ps += (sc2 / n - ps) * al; qs += (sq2 / n - qs) * al; }
              let tg = pc > 1e-12 ? Math.sqrt(pi / pc) : 1, ts = ps > 1e-12 && qs > 1e-12 ? Math.sqrt(qs / ps) : 1;
              tg = tg < 0.4 ? 0.4 : tg > 2.5 ? 2.5 : tg; ts = ts < 0.4 ? 0.4 : ts > 2.5 ? 2.5 : ts;
              dg = (tg - lg) / 128; ds = (ts - ls) / 128;
            }
            let e = 0; for (let j = 0; j < NP; j++) e += env[j];
            return !(rel && e / NP < 1e-4);
          },
          stop() { env.fill(0); },
        };
      },
      process(L, R, n, P) {
        for (let i = 0; i < n; i++) {
          let l = L[i], r = R[i];
          for (let k = 0; k < 4; k++) { l = bodyL[k].eq(l); r = bodyR[k].eq(r); }
          const h = hlS.next(P.hall);
          pre.write(l); preR.write(r);
          hall.tick(pre.read(0.022 * sr), preR.read(0.022 * sr));
          const OUT = 0.78, wet = h * h * 0.1 + h * 0.32;
          const wl = hall.l * 0.8 + hall.r * 0.2, wr = hall.r * 0.8 + hall.l * 0.2;
          L[i] = knee(dcl((l * (1 - 0.3 * h) + wl * wet) * OUT));
          R[i] = knee(dcr((r * (1 - 0.3 * h) + wr * wet) * OUT));
        }
      },
    };
  },
};
`),
});
