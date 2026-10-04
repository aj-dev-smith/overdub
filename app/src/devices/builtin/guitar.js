// core.guitar: DI Box. A guitar played from the keys, heard the way it leaves the guitar: a clean DI, ready for the
// Guitar Studio's amps and pedals (put amp.jangle or amp.crunch after it), or as it is.
//   STRING    a waveguide (a delay loop one period long, read with cubic interpolation) with a loss filter designed
//             for each pitch (Bank & Välimäki 2003): the loop is given its decay at the fundamental and at 3 kHz (6 kHz
//             on the electric), net of the cubic read's own loss, so a high string stays as bright as a low one instead
//             of going dull, and every note rings for its own time.
//             Measured (tools/timbre-test.js): E5's 10th partial within 40 dB of the fundamental, E2 to E6 within 6 dB.
//             Wound strings get a touch of stiffness (a dispersion allpass: the upper partials run a little sharp).
//   PICK      where the pick (or the thumb, on nylon) strikes: by the bridge is thin and snappy, toward the neck round
//             and soft. The string's shape at that point leaves a notch in the harmonics, as on the real thing.
//   PICKUP    ELECTRIC only: a magnetic pickup at a position on the string (a comb), bridge to neck.
//   BODY      ELECTRIC (a solid body: long sustain, the pickup's colour), NYLON (a classical: fingers, short and warm,
//             a wooden body) or STEEL (a dreadnought: bright, a big low body, mic'd).
//   STRUM     notes that start within 30 ms of each other are a chord: they are strummed, each string STRUM ms after
//             the last, down (low to high) then up (high to low, a little lighter), alternating chord by chord.
//   MUTE      OFF, SOFT (notes under velocity 0.35 are palm-muted: play harder to open them) or ALL (palm-muted).
//   Letting go of a key damps the string (a finger lifting off the fret). The pitch bend wheel bends the string and
//   the mod wheel adds finger vibrato (t.bend and t.mod: docs/DEVICES.md, "Expression").
// The DI is mono, in the centre, at house level (about -16 LUFS on the test phrase). The amps are Web Audio graph
// devices, so the canonical Node render (tools/render.js) bypasses them and plays this DI clean: a song with an amped
// guitar renders its DI there, and sounds amped in the studio and its browser renders.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.guitar', name: 'DI Box', kind: 'instrument', cat: 'pluck', by: 'overdub',
  blurb: 'A guitar from the keys: strummed chords, palm mutes, bends',
  nod: 'a physically modelled guitar string through a clean DI, for the amps',
  params: [
    { key: 'body', label: 'BODY', opts: ['ELECTRIC', 'NYLON', 'STEEL'], def: 0, role: 'shape', desc: 'solid-body electric, nylon-string classical, or steel-string acoustic' },
    { key: 'pick', label: 'PICK', min: 0, max: 1, def: 0.3, role: 'tone', desc: 'where the string is struck: by the bridge (snappy) to toward the neck (round)' },
    { key: 'pickup', label: 'PICKUP', min: 0, max: 1, def: 0.25, role: 'tone', desc: 'ELECTRIC: the pickup by the bridge (thin, biting) to by the neck (warm, full)' },
    { key: 'tone', label: 'TONE', min: 0, max: 1, def: 0.6, role: 'tone', desc: 'old dark strings to new bright ones' },
    { key: 'decay', label: 'DECAY', min: 0.3, max: 3, def: 1, curve: 'log', unit: 'x', role: 'decay', desc: 'how long a held note rings' },
    { key: 'strum', label: 'STRUM', min: 0, max: 40, def: 12, unit: 'ms', role: 'time', desc: 'the time between strings when a chord is strummed (0: all at once)' },
    { key: 'mute', label: 'MUTE', opts: ['OFF', 'SOFT', 'ALL'], def: 0, role: 'shape', desc: 'palm mute: off, on the soft notes (under velocity 0.35), or on every note' },
  ],
  presets: [
    { name: 'Clean single-coil', blurb: 'into amp.jangle (Coral Chime)', params: { body: 'ELECTRIC', pick: 0.3, pickup: 0.55, tone: 0.65, strum: 10, mute: 'OFF' } },
    { name: 'Crunch rhythm', blurb: 'into amp.crunch (Crab Shack)', params: { body: 'ELECTRIC', pick: 0.15, pickup: 0, tone: 0.7, decay: 1.2, strum: 7, mute: 'SOFT' } },
    { name: 'Nylon', blurb: 'a classical, fingerpicked', params: { body: 'NYLON', pick: 0.55, tone: 0.4, decay: 1, strum: 22, mute: 'OFF' } },
    { name: 'Dreadnought', blurb: 'a steel-string acoustic, strummed', params: { body: 'STEEL', pick: 0.35, tone: 0.65, decay: 1, strum: 14, mute: 'OFF' } },
    { name: 'Funk muted', blurb: 'chicken-scratch: into amp.clean (Sea Glass)', params: { body: 'ELECTRIC', pick: 0.1, pickup: 0.4, tone: 0.75, strum: 8, mute: 'ALL' } },
  ],
  look: { color: '#5a2e22', ink: '#f6e7d0', shape: 'wide', finish: 'sparkle', knob: 'cream', label: 'script', led: '#ff9f43' },
  tail: 4,
  kernel: kernel(String.raw`
return {
  poly: 10,
  create({ sr, seed }) {
    const MAX = Math.ceil(sr / 20) + 16;
    const F_HI = 3000, F_HI_SOLID = 6000;      // the loss filter's second design point (Hz): wooden bodies, the solid body
    const GROUP = Math.round(0.03 * sr);       // notes this close together are one chord
    // the strum: notes starting within 30 ms are one group; now counts samples at the start of each block
    let now = 0, gStart = -1e9, gDir = 1, gN = 0;
    const grp = new Array(32);
    // the shared end of the DI: the body (acoustics), a tone pot (electric), a DC blocker and a safety knee
    const b1 = svf(sr), b2 = svf(sr), b3 = svf(sr), pot = svf(sr), dc = dcblock(sr);
    let bodyNow = -1;
    // the per-period gain for a T60 at f0 (a loop of one period loses this much each time round)
    const perPass = (t60, f0) => Math.pow(10, -3 / (Math.max(0.01, t60) * f0));
    // a first-order allpass's phase delay (samples) at w
    // the cubic read's own gain at w for a delay of d samples (Catmull-Rom loses a little at the top every lap)
    const cubicGain = (d, w) => {
      const f = Math.ceil(d) - d, a = -0.5 * f + f * f - 0.5 * f * f * f, b = 1 - 2.5 * f * f + 1.5 * f * f * f, e = 0.5 * f + 2 * f * f - 1.5 * f * f * f, h = -0.5 * f * f + 0.5 * f * f * f;
      const re = a + b * Math.cos(w) + e * Math.cos(2 * w) + h * Math.cos(3 * w), im = b * Math.sin(w) + e * Math.sin(2 * w) + h * Math.sin(3 * w);
      return Math.sqrt(re * re + im * im);
    };
    const apDelay = (c, w) => { const ph = Math.atan2(-Math.sin(w), c + Math.cos(w)) - Math.atan2(-c * Math.sin(w), 1 + c * Math.cos(w)); return -ph / w; };
    // re-rank a strum group: each string waits (its place in the chord) x STRUM, from its own note-on
    function restrum(ms) {
      const step = ms * sr / 1000;
      for (let i = 0; i < gN; i++) {
        const a = grp[i];
        if (a.plucked) continue;
        let k = 0;
        for (let j = 0; j < gN; j++) { const b = grp[j]; if (b !== a && (gDir > 0 ? b.p < a.p || (b.p === a.p && j < i) : b.p > a.p || (b.p === a.p && j < i))) k++; }
        a.wait = Math.max(0, Math.round(k * step) - a.age);
        a.up = gDir < 0 && gN > 1;
      }
    }
    return {
      voice(vi) {
        const r = rng((seed ^ 0x6a17) + vi * 7919);
        const dl = delayLine(MAX), hist = delayLine(MAX), exc = new Float32Array(MAX);
        const st = { p: 60, age: 0, wait: 0, plucked: true, up: false };
        let f0 = 220, D0 = 100, Dn = 100, gl = 0.5, al = 0.5, lz = 0, apc = 0, ax1 = 0, ay1 = 0, bx1 = 0, by1 = 0;
        let gm = 1, gmT = 1, gmK = 0, vel = 0.8, body = 0, muted = false, puM = 20, puK = 0, quiet = 0, alive = false;
        let tw = 0, twK = 1, click = 0, clickK = 0, vph = 0, P0 = null, sPrev = 0, vNorm = 1, first = true;
        const clickF = svf(sr);
        // fill the loop: the string's shape where the pick lets go (a rounded triangle with its apex at the pick
        // point, so the harmonics at multiples of 1/beta go missing), softened by how hard it was struck
        function pluck() {
          const P = P0, up = st.up;
          const v = vel * (up ? 0.85 : 1);
          const beta = (body === 1 ? 0.12 : 0.06) + 0.24 * P.pick;
          // the excitation's low-pass: a nylon thumb is soft, a steel pick hard; harder is brighter. It is set for E3
          // and above that follows the note (the smoothing is of the string's shape, so it scales with the string):
          // held in hertz, it would leave a high note with two partials
          const hard = body === 1 ? 0.01 + 0.45 * v * v : 0.02 + 0.6 * v * v;
          const lp3 = clamp(hard * (0.55 + 0.6 * P.tone) * (muted ? 0.45 : 1) * (up ? 1.15 : 1), 0.01, 0.95);
          const lp = Math.min(0.95, 1 - Math.pow(1 - lp3, Math.max(1, f0 / 165)));
          const nA = body === 1 ? 0.005 + 0.03 * v * v : 0.01 + 0.05 * v * v;
          // a hard pick starts a few cents sharp and settles: the loop starts that much shorter (Dp)
          tw = 0.004 * v * v * (body === 1 ? 0.5 : 1); twK = coef(0.06, sr);
          const Dp = D0 / (1 + tw);
          // the shape is periodic in the loop's own (fractional) length, and a few samples more than one period go
          // in, so the interpolated read never meets a seam where the first lap hands over to the string's own
          // motion; twice round, keeping the second lap, so the smoothing has settled where the loop joins
          const M = Math.min(MAX - 4, Math.ceil(Dp) + 3), N = Math.floor(Dp);
          let y = 0, y2 = 0, m = 0, pkAbs = 1e-9;
          for (let i = 0; i < 2 * M; i++) {
            const u = (i % Dp) / Dp, tri = u < beta ? u / beta : (1 - u) / (1 - beta);
            y += ((1 - nA) * tri + (i < M ? 0 : nA * r()) - y) * lp; y2 += (y - y2) * lp;
            if (i >= M) exc[i - M] = y2;
          }
          for (let i = M - N; i < M; i++) m += exc[i];
          m /= N;
          // the shape as it is after one trip round the loop (the loss filter at unity gain, warmed on the period
          // before): otherwise the first period is the raw shape and the second the filtered one, and where they
          // meet (one period in) a heavily damped string, palm-muted or low, would click
          let z = 0;
          for (let i = M - N; i < M; i++) z = (1 - al) * (exc[i] - m) + al * z;
          for (let i = 0; i < M; i++) { z = (1 - al) * (exc[i] - m) + al * z; exc[i] = z; }
          for (let i = 0; i < M; i++) { const a = exc[i] < 0 ? -exc[i] : exc[i]; if (a > pkAbs) pkAbs = a; }
          const amp = (0.12 + 0.88 * v) / pkAbs * (muted ? 1.2 : 1);
          dl.clear(); hist.clear();
          // and decaying across the period as the loop would have written it (older samples louder by the loop's gain
          // per pass), so the first lap hands over to the string's own motion without a step, however damped it is
          const gP = gl / Math.max(1e-6, 1 - al), gStep = Math.pow(gP, 1 / Dp);
          let e = Math.pow(gP, 1 - M / Dp);
          for (let i = 0; i < M; i++) { dl.write(exc[i] * amp * e); e *= gStep; }
          // warm the loop's filters on the period before the first read, as if the string had been ringing: started
          // from rest they would write a seam into the loop that circulates as a click every period
          lz = 0; ax1 = ay1 = bx1 = by1 = 0; first = true;
          const u0 = M - Dp;
          for (let j = N; j >= 1; j--) {
            let u = u0 - j; if (u < 0) u += Dp;
            const i0 = Math.floor(u), fu = u - i0, xin = (exc[i0] + (exc[i0 + 1] - exc[i0]) * fu) * amp * Math.pow(gP, 1 - (M - u0 + j) / Dp);
            lz = gl * xin + al * lz;
            if (apc) { const a1 = apc * lz + ax1 - apc * ay1; ax1 = lz; ay1 = a1; const a2 = apc * a1 + bx1 - apc * by1; bx1 = a1; by1 = a2; }
          }
          // a plectrum clicks
          click = body === 1 ? 0 : 0.05 * v * v * (0.5 + P.tone); clickK = coef(0.0015, sr);
          clickF.set(body === 2 ? 3800 : 2600, 0.9);
          st.plucked = true; quiet = 0;
        }
        return {
          start(p, v, P) {
            P0 = P; vel = v; body = P.body | 0;
            const mm = P.mute | 0;
            muted = mm === 2 || (mm === 1 && v < 0.35);
            f0 = clamp(mtof(p), 30, 2400);
            const per = sr / f0, w0 = TAU * f0 / sr, w1 = TAU * Math.max(body === 0 ? F_HI_SOLID : F_HI, 2.5 * f0) / sr;
            // decay at the fundamental and at the design point, by body and register (low strings ring longest). The
            // wooden bodies are set at 3 kHz; the electric at 6 kHz, since a one-pole's loss climbs as f^2 past its
            // design point, and set at 3 kHz it left E5's 10th partial 87 dB down (a solid body adds almost no
            // resonance of its own: Paté, Le Carrou & Fabre 2014)
            const reg = Math.pow(2, -(p - 40) / 24);
            let T0 = (body === 0 ? 7 : body === 1 ? 3.2 : 4.5) * reg * P.decay;
            let Thi = (body === 0 ? 0.5 : body === 1 ? 0.24 : 0.4) * (0.35 + 1.3 * P.tone) * (0.6 + 0.4 * P.decay);
            if (muted) { T0 = Math.min(T0, 0.12 + 0.1 * reg); Thi = Math.min(Thi, 0.025); }
            Thi = Math.min(Thi, T0 * 0.9);
            // stiffness on the wound strings (steel and electric below G3)
            apc = body === 1 || p >= 55 ? 0 : -0.12 - 0.1 * clamp((55 - p) / 15, 0, 1);
            const disp = apc ? 2 * apDelay(apc, w0) : 0;
            // the one-pole loss filter through both points (Bank & Välimäki 2003): DC gain g, pole a. The cubic read
            // loses a little every lap too (most on a short, high string), so the filter is designed for the rest:
            // twice, since the read's fraction depends on the filter's own delay
            const g = perPass(T0, f0), G1 = perPass(Thi, f0);
            let lossDelay = 0;
            for (let k = 0; k < 2; k++) {
              const d = Math.max(3, per - lossDelay - disp), c0 = cubicGain(d, w0), c1 = cubicGain(d, w1);
              const gd = Math.min(0.99999, g / c0), rr = Math.min(0.9999, G1 / c1 / gd), r2 = rr * rr, c = Math.cos(w1);
              const qa = (1 - r2 * c), qd = Math.sqrt(Math.max(0, qa * qa - (1 - r2) * (1 - r2)));
              al = clamp((qa - qd) / Math.max(1e-9, 1 - r2), 0, 0.98);
              gl = gd * (1 - al);
              lossDelay = Math.atan2(al * Math.sin(w0), 1 - al * Math.cos(w0)) / w0;
            }
            D0 = Math.max(3, per - lossDelay - disp); Dn = D0;
            // the pickup (electric): a comb at its distance from the bridge
            puM = Math.max(1, (0.07 + 0.2 * P.pickup) * per); puK = body === 0 ? 0.8 : 0;
            // what is heard is the string's velocity (a magnetic pickup, or the force on the bridge): its harmonics
            // fall as 1/n, not 1/n^2. Normalised at the fundamental, so every register leaves at the same level.
            vNorm = 1 / (2 * Math.sin(Math.PI * f0 / sr)); sPrev = 0;
            gm = 1; gmT = 1; gmK = 0; vph = 0; alive = true;
            // the strum
            st.p = p; st.age = 0; st.plucked = false; st.wait = 0; st.up = false;
            if (now - gStart > GROUP || gN >= grp.length) { if (gN > 1) gDir = -gDir; gStart = now; gN = 0; }
            let inG = false; for (let i = 0; i < gN; i++) if (grp[i] === st) inG = true;
            if (!inG) grp[gN++] = st;
            restrum(P.strum); // (the pluck itself waits for render: a later note of this chord may come first)
          },
          release(P) {
            // a finger lifting off the string damps it (a little faster when it was already palm-muted)
            gmT = Math.min(1, perPass(muted ? 0.05 : 0.11, f0) / Math.max(1e-6, gl / (1 - al))); gmK = 0.004;
          },
          render(L, R, n, P, t) {
            if (!alive) return false;
            // expression: the bend wheel and finger vibrato (the mod wheel), per block
            let semis = t && t.bend ? t.bend : 0;
            if (t && t.mod > 0) { vph += n * 5.3 / sr; if (vph >= 1) vph -= 1; semis += t.mod * 0.4 * sinT(vph); }
            const Dt = semis !== 0 ? D0 / Math.pow(2, semis / 12) : D0;
            let pk = 0;
            for (let i = 0; i < n; i++) {
              st.age++;
              if (!st.plucked) { if (st.wait > 0) { st.wait--; continue; } pluck(); }
              Dn += (Dt - Dn) * 0.02;
              tw *= twK;
              const s = dl.cubic(Math.max(2, Dn / (1 + tw)));
              // the loop: loss (one pole), stiffness (two allpasses), the damping finger
              lz = gl * s + al * lz;
              let y = lz;
              if (apc) { const a1 = apc * y + ax1 - apc * ay1; ax1 = y; ay1 = a1; const a2 = apc * a1 + bx1 - apc * by1; bx1 = a1; by1 = a2; y = a2; }
              gm += (gmT - gm) * gmK;
              dl.write(y * (gm < 1 ? gm : 1));
              if (first) { sPrev = s; first = false; } // (from silence: no step into the first sample)
              const sv = (s - sPrev) * vNorm; sPrev = s;
              hist.write(sv);
              let o = sv - puK * hist.read(puM);
              if (click > 1e-5) { clickF.tick(r()); o += clickF.bp * click; click *= clickK; }
              o *= 0.42;
              L[i] += o; R[i] += o;
              const ao = o < 0 ? -o : o; if (ao > pk) pk = ao;
            }
            if (!st.plucked) return true;
            if (pk < 2e-5) quiet += n; else quiet = 0;
            alive = quiet < sr * 0.05;
            return alive;
          },
          stop() { dl.clear(); hist.clear(); lz = 0; alive = false; st.plucked = true; },
        };
      },
      process(L, R, n, P) {
        now += n;
        const body = P.body | 0;
        if (body !== bodyNow) {
          bodyNow = body;
          // the wooden bodies: the air (about 100 Hz), the top (about 200 Hz) and a little wood above;
          // the electric is a plank: its colour is the pickup and the tone pot
          if (body === 1) { b1.bell(98, 1.4, 5); b2.bell(205, 1.6, 3.5); b3.bell(2800, 0.8, -3); }
          else if (body === 2) { b1.bell(104, 1.3, 5.5); b2.bell(215, 1.4, 3); b3.bell(3600, 0.7, 2); }
          else { b1.bell(100, 1, 0); b2.bell(200, 1, 0); b3.bell(1000, 1, 0); }
        }
        pot.set(body === 0 ? 2500 + 14000 * P.tone * P.tone : 18000, 0.7);
        for (let i = 0; i < n; i++) {
          let x = L[i];
          if (body) x = b3.eq(b2.eq(b1.eq(x))) * (body === 1 ? 0.64 : 0.41);
          else x = pot.tick(x) * 0.33; // (the brighter top is louder: trimmed back to the DI's -16 LUFS)
          const y = knee(dc(x));
          L[i] = y; R[i] = y;
        }
      },
    };
  },
};
`),
});
