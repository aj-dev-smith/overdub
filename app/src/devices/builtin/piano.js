// @ts-check
// core.piano: Baby Grand. An acoustic grand, additive and sample-free, built from what a piano string does:
//   PARTIALS  up to 48 per note (to 10 kHz) at f_k = k f0 sqrt(1 + B k^2): stiff strings, so the overtones run sharp.
//             B follows the register (3.4e-4 at A0, lowest, 1.3e-4, at C3, rising to about 7e-3 at the top), and
//             the scale is stretch-tuned a little (flat bass, sharp treble), as a tuner sets a real one.
//   STRINGS   one string per note in the low bass, two through the tenor, three from about A2 up, each a fraction of a
//             cent apart (UNISON; the first six partials carry every string), so the low partials beat slowly and the
//             decay comes in two stages: a prompt sound that falls fast, then a long, quiet aftersound.
//   HAMMER    where it strikes (about 1/8.5 of the string: the 8th and 17th partials are weak) and how hard: harder
//             is shorter contact, so more and brighter partials (velocity sets brightness as well as level). A felt
//             thump and a soundboard knock with each strike.
//   DECAY     T60 by register (about 30 s at the bottom of the aftersound to about a second at the top), higher
//             partials dying sooner, at the rates measured on real grands (Cheng, Dixon & Mauch 2015). Dampers stop a
//             note when the key lets go, more slowly in the bass, and the top octave and a half has no dampers at all,
//             as on a real grand.
//   BODY      the soundboard radiates the bass fundamentals weakly (so low notes are wood and overtones, not sub),
//             then the lid's early reflections and a small room, with the keyboard spread from the player's seat.
// Each partial is a two-multiply sine oscillator whose amplitude moves once a block, and a partial 80 dB under the
// note's loudest is dropped, so 16 held notes cost about what Lamp Tines' GRAND does (tools/timbre-test.js times it).
// About -16.5 LUFS on the test phrase at defaults. tools/instruments-test.js and tools/timbre-test.js measure the rest.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.piano', name: 'Baby Grand', kind: 'instrument', cat: 'keys', by: 'overdub',
  blurb: 'An acoustic grand: felt hammers, three strings a note',
  nod: 'an acoustic grand piano, modelled string by string',
  params: [
    { key: 'tone', label: 'TONE', min: 0, max: 1, def: 0.5, role: 'tone', desc: 'soft felt to hard, bright hammers' },
    { key: 'touch', label: 'TOUCH', min: 0, max: 1, def: 0.5, role: 'sens', desc: 'how much your velocity changes level and brightness' },
    { key: 'decay', label: 'DECAY', min: 0.3, max: 2, def: 1, unit: 'x', role: 'decay', desc: 'how long the strings ring' },
    { key: 'damper', label: 'DAMPER', min: 0.04, max: 2, def: 0.16, curve: 'log', unit: 's', role: 'release', desc: 'how fast a note stops when you let go' },
    { key: 'hammer', label: 'HAMMER', min: 0, max: 1, def: 0.4, role: 'shape', desc: 'the felt thump and knock of each strike' },
    { key: 'unison', label: 'UNISON', min: 0, max: 1, def: 0.2, role: 'depth', desc: 'freshly tuned to an old upright gone honky-tonk' },
    { key: 'width', label: 'WIDTH', min: 0, max: 1, def: 0.6, role: 'width', desc: 'mono to the player\'s seat: low notes left, high right' },
    { key: 'room', label: 'ROOM', min: 0, max: 1, def: 0.25, role: 'mix', desc: 'lid and room around the strings' },
  ],
  presets: [
    { name: 'Concert', params: {} },
    { name: 'Felt', params: { tone: 0.15, hammer: 0.7, room: 0.4, decay: 0.8 } },
    { name: 'Bright pop', params: { tone: 0.8, touch: 0.35, room: 0.15 } },
  ],
  look: { color: '#1d1b1a', ink: '#efe6d4', shape: 'wide', finish: 'flat', knob: 'chrome', label: 'script', led: '#ffd27a' },
  tail: 10,
  kernel: kernel(String.raw`
return {
  poly: 16,
  create({ sr, seed }) {
    const NY = sr * 0.45;
    // the lid: a few early reflections per side (ms, gain), different left and right; then a small room
    const ER = [[3.1, 0.42], [5.3, -0.3], [7.9, 0.26], [11.7, -0.2], [16.3, 0.14]], ERR = [[3.7, 0.4], [6.1, -0.28], [8.8, 0.24], [12.9, -0.19], [17.9, 0.13]];
    const eL = delayLine(Math.ceil(0.02 * sr)), eR = delayLine(Math.ceil(0.02 * sr));
    const erL = ER.map(([ms, g]) => [ms * sr / 1000, g]), erR = ERR.map(([ms, g]) => [ms * sr / 1000, g]);
    const elp = onepole(sr).set(5200), erp = onepole(sr).set(5200);
    const room = fdn(sr, seed ^ 0x5a17);
    room.set(0.38, 1.1, 0.55);
    const rmS = glide(40, sr), wdS = glide(40, sr);
    const MAXP = 96, B = 128;
    return {
      voice(vi) {
        const r = rng((seed ^ 0x51ab) + vi * 7919);
        // the partials as 2-pole sine oscillators (y = c y1 - y2, exact and two operations a sample), each with a prompt
        // and an aftersound amplitude that decay at their own rates; the amplitudes move once a block, ramped per sample
        const c2 = new Float64Array(MAXP), y1 = new Float64Array(MAXP), y2 = new Float64Array(MAXP);
        const af = new Float64Array(MAXP), as = new Float64Array(MAXP), kf = new Float64Array(MAXP), ks = new Float64Array(MAXP);
        const kfB = new Float64Array(MAXP), ksB = new Float64Array(MAXP);   // the decays over a whole block (B samples)
        const buf = new Float64Array(B);
        let np = 0, rel = false, kd = 1, kdB = 1, gain = 0, atk = 1, env = 0, pan = [1, 1], pitch = 60, cut = 0;
        // the strike: felt noise and the soundboard's knock
        const thump = svf(sr), felt = svf(sr);
        let nAmt = 0, nK = 0, fAmt = 0, fK = 0;
        return {
          start(p, v, P) {
            pitch = p; rel = false; kd = 1; kdB = 1;
            const touch = P.touch, tone = P.tone;
            // velocity: level (a 20 to 44 dB range with TOUCH) and how hard the felt is
            const gam = 1.1 + 2.1 * touch;
            gain = 0.03 + 0.97 * Math.pow(clamp(v, 0, 1), gam);
            const hard = clamp((0.25 + 0.75 * v) * (0.5 + 0.35 * touch) + 0.55 * tone - 0.25, 0.02, 1.4);
            // stretch tuning (cents): flat in the bass (about -8 at E1, -11 at A0), sharp in the treble (+12 at C8), as a
            // tuner sets a grand to its own stiff strings (a big grand measures about -22 at A0 and +46 at C8)
            const st = p > 60 ? 0.0052 * (p - 60) * (p - 60) : -0.0075 * (60 - p) * (60 - p);
            const f0 = mtof(p + st / 100);
            const B2 = p >= 48 ? 1.3e-4 * Math.pow(2, (p - 48) / 12 * 1.15) : 1.3e-4 * Math.pow(2, (48 - p) / 12 * 0.62);
            // the prompt sound's T60 (the fundamental's; higher partials die faster, below). Long in the bass, then nearly
            // level through the treble, where the f^2 air and string losses take over, and short only in the top fifth
            // octave. Measured, a held note then falls at about -4 dB/s at A1, -8 at C4, -10 at C6, -14 at E6, -26 at C7
            // and -80 at C8: Cheng, Dixon & Mauch 2015 put partials under 1 kHz at -3 to -10 dB/s, around 2.6 kHz at
            // -20 to -40 and above 4 kHz at -60 to -100.
            const T1 = clamp(p <= 52 ? 7.5 * Math.pow(2, -(p - 40) / 17) : p <= 88 ? 4.92 : 4.92 * Math.pow(2, -(p - 88) / 9), 0.35, 13) * P.decay;
            const aft = 3.4 - clamp((p - 88) / 12, 0, 1);   // the aftersound's slower decay, less marked in the top fifth
            const nStr = p < 31 ? 1 : p < 45 ? 2 : 3;
            // unison spread, cents; held to a near-constant beat rate in Hz above C5 (a tuner sets the treble unisons
            // tighter, or the three strings fall out of phase within a second or two and the note seems to die early)
            const uc = (0.12 + 1.6 * P.unison * P.unison + 9 * Math.pow(P.unison, 4)) * Math.min(1, Math.sqrt(523 / f0));
            // the hammer's low-pass: soft felt ~600 Hz, hard ~8 kHz, smaller and harder hammers up the keyboard
            const fh = 420 * Math.pow(2, 4.4 * hard) * Math.pow(2, (p - 60) / 40);
            const beta = 1 / 8.5;
            const fmax = Math.min(NY, 10000);
            // the loudest partial first, so the quiet ones can be left out (more than 60 dB under it: inaudible)
            let amax = 0;
            for (let k = 1; k <= 48; k++) {
              const f = f0 * k * Math.sqrt(1 + B2 * k * k);
              if (f > fmax) break;
              const hx = f / fh, rx = f / 95;
              const a = (Math.abs(Math.sin(Math.PI * k * beta)) * 0.92 + 0.08) / (1 + hx * hx) * (rx * rx) / (1 + rx * rx) / Math.pow(k, 0.55);
              if (a > amax) amax = a;
            }
            np = 0;
            for (let k = 1; k <= 48 && np < MAXP - 3; k++) {
              const f = f0 * k * Math.sqrt(1 + B2 * k * k);
              if (f > fmax) break;
              const hx = f / fh, hamm = 1 / (1 + hx * hx);
              const comb = Math.abs(Math.sin(Math.PI * k * beta)) * 0.92 + 0.08;
              const rx = f / 95, rad = (rx * rx) / (1 + rx * rx);                   // soundboard radiation (weak bass)
              const a = comb * hamm * rad / Math.pow(k, 0.55);
              if (a < amax * 1e-3 && k > 4) continue;
              // decay: faster for higher partials (air and string losses)
              const rate = (1 + 0.06 * (k - 1)) / T1 + (f / 1000) * (f / 1000) * 0.035;
              const Tp = 1 / rate, Ta = Tp * aft;
              const ns = k <= 6 ? nStr : 1;
              for (let s = 0; s < ns && np < MAXP; s++) {
                const dc = s === 0 ? 0 : (s === 1 ? 1 : -0.85) * uc * (0.6 + 0.4 * (r() + 1)) ;
                const w = TAU * f * Math.pow(2, dc / 1200) / sr;
                c2[np] = 2 * Math.cos(w); y1[np] = 0; y2[np] = -Math.sin(w);      // sin(n w) from the first sample on
                const share = a / ns;
                af[np] = share * 0.8; as[np] = share * 0.2;
                kf[np] = coef(Tp / 6.91, sr); ks[np] = coef(Ta / 6.91, sr);
                kfB[np] = Math.pow(kf[np], B); ksB[np] = Math.pow(ks[np], B);
                np++;
              }
            }
            // a partial is done once it is 80 dB under the strike's loudest, or under -110 dBFS out
            cut = Math.max(amax * 1e-4, 1e-5 / gain);
            // the strike: a felt thump (low, short) and a little high felt noise, more with HAMMER and velocity
            const hm = P.hammer;
            thump.set(clamp(90 + f0 * 0.9, 90, 900), 1.2); felt.set(clamp(2400 + 3000 * hard, 1500, 9000), 0.8);
            nAmt = hm * 0.5 * (0.2 + 0.8 * v); nK = coef(0.012 / 6.91 * 2.5, sr);
            fAmt = hm * 0.07 * v * v; fK = coef(0.004, sr);
            atk = 1 / (sr * (0.0028 - 0.0022 * clamp(hard, 0, 1)));
            env = 0;
            pan = panLR(clamp((p - 64) / 36, -1, 1) * 0.75 * P.width);
          },
          release(P) {
            rel = true;
            // no dampers on the top strings; slower dampers in the bass
            if (pitch >= 89) { kd = 1; kdB = 1; return; }
            const tdm = P.damper * (1 + 2.2 * clamp((60 - pitch) / 36, 0, 1));
            kd = coef(tdm / 6.91, sr); kdB = Math.pow(kd, B);
          },
          render(L, R, n, P) {
            for (let o = 0; o < n; o += B) {
              const m = n - o < B ? n - o : B;
              // the partials, one at a time over the whole block (the damper folds into the decays)
              const full = m === B, dk = !rel ? 1 : full ? kdB : Math.pow(kd, m);
              for (let i = 0; i < m; i++) buf[i] = 0;
              // two partials a pass (half the trips through the block buffer)
              for (let j = 0; j < np; j += 2) {
                const k = j + 1 < np ? j + 1 : -1;
                const c = c2[j];
                let a = y1[j], b = y2[j], g = af[j] + as[j];
                const f1 = af[j] * (full ? kfB[j] : Math.pow(kf[j], m)) * dk, s1 = as[j] * (full ? ksB[j] : Math.pow(ks[j], m)) * dk;
                af[j] = f1; as[j] = s1;
                const dg = (f1 + s1 - g) / m;
                if (k < 0) {
                  for (let i = 0; i < m; i++) { const y = c * a - b; b = a; a = y; g += dg; buf[i] += y * g; }
                } else {
                  const cc = c2[k];
                  let aa = y1[k], bb = y2[k], gg = af[k] + as[k];
                  const f2 = af[k] * (full ? kfB[k] : Math.pow(kf[k], m)) * dk, s2 = as[k] * (full ? ksB[k] : Math.pow(ks[k], m)) * dk;
                  af[k] = f2; as[k] = s2;
                  const dgg = (f2 + s2 - gg) / m;
                  for (let i = 0; i < m; i++) {
                    const y = c * a - b; b = a; a = y; g += dg;
                    const z = cc * aa - bb; bb = aa; aa = z; gg += dgg;
                    buf[i] += y * g + z * gg;
                  }
                  y1[k] = aa; y2[k] = bb;
                }
                y1[j] = a; y2[j] = b;
              }
              const g0 = gain * 0.37, pl = pan[0] * g0, pr = pan[1] * g0;
              for (let i = 0; i < m; i++) {
                let x = buf[i];
                if (env < 1) { env += atk; if (env > 1) env = 1; x *= env; }
                if (nAmt > 1e-6) { const z = r(); thump.tick(z); felt.tick(z); x += thump.bp * nAmt * env + felt.bp * fAmt; nAmt *= nK * (rel ? kd : 1); fAmt *= fK; }
                L[o + i] += x * pl; R[o + i] += x * pr;
              }
            }
            // drop the partials that have died away: 80 dB under the strike's loudest partial or under the loudest
            // one still ringing (the treble partials die long before the fundamental), or under -110 dBFS out
            let top = 0;
            for (let j = 0; j < np; j++) { const a = af[j] + as[j]; if (a > top) top = a; }
            const cutNow = Math.max(cut, top * 1e-4);
            for (let j = 0; j < np; j++) {
              if (af[j] + as[j] < cutNow) { np--; c2[j] = c2[np]; y1[j] = y1[np]; y2[j] = y2[np]; af[j] = af[np]; as[j] = as[np]; kf[j] = kf[np]; ks[j] = ks[np]; kfB[j] = kfB[np]; ksB[j] = ksB[np]; j--; }
            }
            return np > 0 || nAmt > 1e-5;
          },
          stop() { np = 0; nAmt = 0; },
        };
      },
      // the lid's reflections and the room, then a safety knee
      process(L, R, n, P) {
        const wd = P.width, rm = P.room;
        for (let i = 0; i < n; i++) {
          const w = wdS.next(wd), m = rmS.next(rm);
          const xl = L[i], xr = R[i];
          // narrow toward mono with WIDTH (the voices' pan already follows it)
          eL.write(xl); eR.write(xr);
          let el = 0, er = 0;
          for (let k = 0; k < 5; k++) { el += eR.read(erL[k][0]) * erL[k][1]; er += eL.read(erR[k][0]) * erR[k][1]; }
          el = elp.lp(el); er = erp.lp(er);
          const dl = xl + el * (0.25 + 0.35 * w), dr = xr + er * (0.25 + 0.35 * w);
          room.tick(dl, dr);
          const OUT = 0.82;
          L[i] = knee((dl + room.l * m * 0.55) * OUT);
          R[i] = knee((dr + room.r * m * 0.55) * OUT);
        }
      },
    };
  },
};
`),
});
