// @ts-check
// core.bassguitar: Flatwound. An electric bass, played and heard the way it is recorded: a string, a pickup, an amp.
//   STRING    a waveguide (a delay loop one period long, read with cubic interpolation, a one-zero loss filter in the
//             loop) rings for a few seconds, the low strings longest. The pluck sets the string's shape where the
//             finger or pick lets go, and a hard pluck stretches the string so the note starts a few cents sharp
//             and settles (the twang of a real attack). Playing harder is brighter as well as louder: a soft finger
//             rounds the shape off past the 4th or 5th harmonic, a hard one leaves 30 and the string flicks off the
//             fingertip with a snap of its own (the onset's centroid rises about 1.4x from velocity 0.3 to 1).
//   STYLE     FINGER (round and thick: the soft pad of a finger over the neck), PICK (nearer the bridge, sharper, a
//             plectrum's click) or MUTED (a palm or foam mute: short, thumpy, the old-records sound).
//   PICKUP    where the pickup sits on the string: by the neck is deep and round, by the bridge thin and nasal (a comb
//             filter at the pickup's position, as on the real instrument).
//   LETTING GO  lifting the finger stops the string over MUTE, with a soft touch of fret noise.
//   AMP       a valve DI (DRIVE, 2x oversampled), a passive TONE control and a little low-mid weight. The bass stays in
//             the centre, as engineers put it.
// About -16 LUFS on the test phrase at defaults. tools/instruments-test.js measures the rest.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.bassguitar', name: 'Flatwound', kind: 'instrument', cat: 'bass', by: 'overdub',
  blurb: 'An electric bass: fingers, a pick or a palm mute',
  nod: 'a physically modelled electric bass guitar through a valve DI',
  params: [
    { key: 'style', label: 'STYLE', opts: ['FINGER', 'PICK', 'MUTED'], def: 0, role: 'shape', desc: 'how it is played: fingers, a pick, or palm-muted' },
    { key: 'tone', label: 'TONE', min: 0, max: 1, def: 0.45, role: 'tone', desc: 'the tone knob: dark and round to bright and growly' },
    { key: 'pickup', label: 'PICKUP', min: 0, max: 1, def: 0.35, role: 'tone', desc: 'neck (deep, round) to bridge (thin, punchy)' },
    { key: 'sustain', label: 'SUSTAIN', min: 0.3, max: 3, def: 1, curve: 'log', unit: 'x', role: 'decay', desc: 'how long a held note rings' },
    { key: 'mute', label: 'MUTE', min: 0.02, max: 1.5, def: 0.08, curve: 'log', unit: 's', role: 'release', desc: 'how fast the note stops when you let go' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.2, role: 'drive', desc: 'the valve DI: clean to grinding' },
  ],
  presets: [
    { name: 'Motown', params: { style: 'FINGER', tone: 0.3, pickup: 0.2 } },
    { name: 'Punk pick', params: { style: 'PICK', drive: 0.5 } },
    { name: 'Muted 60s', params: { style: 'MUTED' } },
    { name: 'Funk', params: { style: 'PICK', pickup: 0.8 } },
  ],
  look: { color: '#2b3a4a', ink: '#f0e9da', shape: 'wide', finish: 'sparkle', knob: 'chrome', label: 'block', led: '#ffd166' },
  tail: 3,
  kernel: kernel(String.raw`
return {
  poly: 6,
  create({ sr, seed }) {
    const MAX = Math.ceil(sr / 20) + 16;
    // the amp: valve DI, tone, low-mid weight, a 30 Hz high-pass
    let drv = 1, dn = 1;
    const shape = os2((x) => sat(x * drv) / dn);
    const tone = svf(sr), body = svf(sr), hp = svf(sr), mid = svf(sr);
    hp.set(32, 0.7);
    const dc = dcblock(sr);
    const outS = glide(30, sr);
    return {
      voice(vi) {
        const r = rng((seed ^ 0xba55) + vi * 2971);
        const dl = delayLine(MAX), hist = delayLine(MAX);
        const exc = new Float32Array(MAX);
        let D = 100, D0 = 100, b = 0.3, g = 0.999, gMute = 0.9, gNow = 0.999, s1 = 0, rel = false, t = 0, quiet = 0, la = 0, lz = 0;
        let twang = 0, twK = 1, puM = 20, atk = 1, atkK = 1, nAmt = 0, nK = 0, style = 0, fret = 0, fretK = 0;
        const fretF = svf(sr);
        return {
          start(p, v, P) {
            style = P.style | 0;
            const f = mtof(p), per = sr / f;
            const tn = P.tone;
            // loop loss: darker strings for flatwounds, darker still when muted
            b = style === 2 ? 0.48 : style === 1 ? 0.3 - 0.12 * tn : 0.4 - 0.12 * tn;
            // and a one-pole low-pass in the loop, set per pitch so the overtones die faster than the note: about
            // 25 dB/s more at 1 kHz than at the fundamental (a flatwound's thump: bright for a moment, then round),
            // rising as f^2 (so 6 dB/s more at 500 Hz, 100 at 2 kHz)
            const xs = (style === 2 ? 60 : style === 1 ? 16 : 25) * (1.2 - 0.4 * tn), w1 = TAU * 1000 / sr;
            const cq = 2 * (xs / 8.686) / (f * w1 * w1);
            la = clamp(((2 * cq + 1) - Math.sqrt(4 * cq + 1)) / (2 * cq), 0, 0.95);
            const w0 = TAU * f / sr, lpd = Math.atan2(la * Math.sin(w0), 1 - la * Math.cos(w0)) / w0;   // its delay at the note
            D0 = Math.max(4, per - b - lpd);
            const T60 = (style === 2 ? 0.45 : 7 * Math.pow(2, -(p - 28) / 30)) * P.sustain;
            g = Math.pow(10, -3 / (T60 * f));
            gNow = g; rel = false; t = 0; quiet = 0;
            // the pluck: the string's shape as it is let go (a rounded triangle at the pluck point) with a little
            // scrape for a pick, low-passed by how soft the finger or pick is
            const N = Math.max(4, Math.floor(D0));
            const at = style === 1 ? 0.09 : 0.15;
            const pk = Math.max(1, Math.round(at * N));
            // how sharp the string's shape is when it's let go, in harmonics of the note: a soft finger rounds it off
            // past the 4th or 5th harmonic (round, thumpy), a hard one leaves 30 (growl); a pick 8 to 80; a muted string
            // 2 to 12. So playing harder is brighter at every pitch, not only louder.
            const vv = Math.pow(clamp(v, 0, 1), 1.5);
            const H = style === 1 ? 8 * Math.pow(10, vv) : style === 2 ? 2 * Math.pow(6, vv) : 3.5 * Math.pow(30 / 3.5, vv);
            const lp = 1 - Math.exp(-TAU * Math.min(f * H, 0.4 * sr) / sr);
            const nA = style === 1 ? 0.18 : 0.03;
            // and the snap: a hard pluck doesn't let go from rest, the string flicks off the fingertip (or the pick) with
            // a speed of its own, a step at the pluck point whose overtones fall as 1/k rather than the shape's 1/k^2
            const sn = (style === 1 ? 1.1 : style === 2 ? 0.2 : 0.6) * vv, sq = -pk / (N - pk);
            let y = 0, y2 = 0, m = 0, u = 0, u2 = 0, mu = 0, umax = -1e9, umin = 1e9;
            // twice round the string, keeping the second lap, so the smoothing is periodic (no step where the loop joins).
            // The level is set by the shape alone (u), so the snap adds to it: harder is louder as well as brighter.
            for (let i = 0; i < 2 * N; i++) {
              const j = i < N ? i : i - N, tri = j < pk ? j / pk : (N - j) / (N - pk);
              const z = i < N ? 0 : nA * r();
              y += ((1 - nA) * (tri + sn * (j < pk ? 1 : sq)) + z - y) * lp; y2 += (y - y2) * lp;
              u += ((1 - nA) * tri + z - u) * lp; u2 += (u - u2) * lp;
              if (i >= N) { exc[j] = y2; m += y2; mu += u2; if (u2 > umax) umax = u2; if (u2 < umin) umin = u2; }
            }
            m /= N; mu /= N;
            for (let i = 0; i < N; i++) exc[i] -= m;
            const pkAbs = Math.max(1e-9, umax - mu, mu - umin);
            const amp = (0.2 + 0.8 * v) / pkAbs * (style === 2 ? 2.2 : 1) * (1 + 0.55 * P.pickup);
            // into the loop (a re-plucked string keeps a little of what it was doing)
            for (let i = 0; i < N; i++) dl.write(dl.read(N) * 0.25 + exc[i] * amp);
            hist.clear();
            // the twang: a hard pluck starts sharp and settles over ~70 ms
            twang = 0.0045 * v * v * (style === 1 ? 1.3 : 1); twK = coef(0.07, sr);
            puM = Math.max(1, (0.08 + 0.13 * (1 - P.pickup)) * per);
            atk = 0; atkK = 1 / (sr * (style === 1 ? 0.0006 + 0.002 * (1 - v) : 0.001 + 0.007 * (1 - v)));   // a soft finger speaks softly
            // the attack's thump (muted) or click (pick)
            nAmt = style === 1 ? 0.25 * v : style === 2 ? 0.02 * v : 0.05 * v * v; nK = coef(style === 1 ? 0.002 : 0.006, sr);
            fretF.set(style === 1 ? 2600 : 180, 1.1);
            fret = 0;
          },
          release(P) {
            rel = true;
            gMute = Math.pow(10, -3 / (Math.max(0.02, P.mute) * 110));
            // the finger coming off: a soft, low, short noise
            fret = 0.03; fretK = coef(0.012, sr);
          },
          render(L, R, n, P, T) {
            let pk = 0;
            const target = rel ? Math.min(g, gMute) : g;
            const bR = T && T.bend ? Math.pow(2, T.bend / 12) : 1;   // the bend wheel stretches the string
            for (let i = 0; i < n; i++, t++) {
              gNow += (target - gNow) * 0.003;
              twang *= twK;
              const d = bR !== 1 ? D0 / (1 + twang) / bR : D0 / (1 + twang);
              const s = dl.cubic(Math.max(2, d));
              const y = gNow * ((1 - b) * s + b * s1); s1 = s;
              lz = y + (lz - y) * la;
              dl.write(lz);
              if (atk < 1) atk = Math.min(1, atk + atkK);
              const sa = s * atk;
              hist.write(sa);
              // the pickup: the string as seen from one point (a comb at the pickup's distance from the bridge)
              let o = sa - 0.85 * hist.read(puM);
              if (nAmt > 1e-5 || fret > 1e-5) { const z = r(); fretF.tick(z); o += fretF.bp * (nAmt + fret); nAmt *= nK; fret *= fretK; }
              o *= 0.5;
              L[i] += o; R[i] += o;
              const ao = o < 0 ? -o : o; if (ao > pk) pk = ao;
            }
            if (pk < 3e-5) quiet += n; else quiet = 0;
            return quiet < sr * 0.05;
          },
          stop() { dl.clear(); hist.clear(); s1 = 0; lz = 0; },
        };
      },
      process(L, R, n, P) {
        const d = P.drive;
        drv = 1 + 7 * d * d; dn = Math.tanh(Math.min(3, drv * 0.5)) / 0.5 || 1;
        const mk = Math.pow(10, -4 * Math.pow(d, 1.6) / 20);
        tone.set(500 * Math.pow(2, 4.2 * P.tone), 0.6);
        body.bell(110, 0.9, 2.5);
        mid.bell(800, 1.0, 1.5 * P.pickup);
        for (let i = 0; i < n; i++) {
          hp.tick(L[i]); let x = hp.hp;
          x = shape(x);
          x = tone.tick(x);
          x = mid.eq(body.eq(x));
          const y = knee(dc(x) * mk * 0.46);
          L[i] = y; R[i] = y;
        }
      },
    };
  },
};
`),
});
