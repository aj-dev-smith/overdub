// @ts-check
// core.mallets: Mallet Bag. Tuned bars, struck. Each note is four modes of a bar (two-pole resonators at the bar's
// own ratios) hit by a mallet:
//   BARS     MARIMBA  rosewood, the first overtone tuned two octaves up (1 : 4 : 9.9), a tube under each bar
//            VIBES    aluminium, tuned the same way but rings for seconds; the motor turns discs in the tubes, which
//                     pulses the fundamental (MOTOR sets how fast; 0 stops it)
//            XYLO     rosewood tuned to the twelfth (1 : 3 : 6.2): short, woody, bright
//            GLOCK    steel bars, untuned overtones of the free bar (1 : 2.76 : 5.40 : 8.93), rings long
//            CELESTA  steel plates over wooden boxes, felt hammers: mostly fundamental, a soft glassy top
//   MALLET   the contact time is a fraction of the bar's period, as on a real bar: a soft yarn mallet stays on the
//            bar for about a period (its spectrum's first null sits near the 2nd mode, so the overtones barely
//            sound), a hard one for a tenth of one (every mode rings). Velocity hardens the hit too, so harder is
//            brighter, not only louder. Tying contact to the period keeps every register equally bright and equally
//            loud (Biscuit Tin's fixed-length mallet loses 20 dB from C4 to C6).
//   DECAY    the bar's T60 by register (long in the bass, short at the top), upper modes dying sooner (0.1 to 0.5 of
//            the fundamental's), so the note darkens as it rings.
//   DAMP     how long a bar rings after you let go (the vibes' damper pedal; the others just ring out sooner).
//   ROOM     a small room, and the bars laid out low to high across the stereo field (WIDTH).
// About -16 LUFS on the test phrase at defaults. tools/instruments2-test.js holds it to the roadmap's numbers
// (docs/research/INSTRUMENTS.md, 2.6).
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.mallets',
  name: 'Mallet Bag',
  kind: 'instrument',
  cat: 'keys',
  by: 'overdub',
  blurb: 'Marimba, vibes, xylophone, glock and celesta',
  nod: 'tuned percussion: marimba, vibraphone with its motor, xylophone, glockenspiel and celesta, modelled bar by bar',
  params: [
    {
      key: 'bar',
      label: 'BAR',
      opts: ['MARIMBA', 'VIBES', 'XYLO', 'GLOCK', 'CELESTA'],
      def: 0,
      role: 'shape',
      desc: 'which instrument: rosewood, aluminium or steel bars',
    },
    {
      key: 'mallet',
      label: 'MALLET',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'tone',
      desc: 'soft yarn to hard plastic: how many overtones each hit wakes',
    },
    {
      key: 'decay',
      label: 'DECAY',
      min: 0.3,
      max: 2.5,
      def: 1,
      unit: 'x',
      role: 'decay',
      desc: 'how long the bars ring',
    },
    {
      key: 'damp',
      label: 'DAMP',
      min: 0.05,
      max: 8,
      def: 1.2,
      curve: 'log',
      unit: 's',
      role: 'release',
      desc: 'how long a bar rings on after you let go',
    },
    {
      key: 'motor',
      label: 'MOTOR',
      min: 0,
      max: 8,
      def: 4.5,
      unit: 'Hz',
      role: 'rate',
      desc: 'the vibes motor: how fast the tone pulses (0 is off; VIBES only)',
    },
    {
      key: 'width',
      label: 'WIDTH',
      min: 0,
      max: 1,
      def: 0.5,
      role: 'width',
      desc: 'mono to the bars laid out low to high, left to right',
    },
    { key: 'room', label: 'ROOM', min: 0, max: 1, def: 0.25, role: 'mix', desc: 'the room around the instrument' },
  ],
  presets: [
    { name: 'Marimba', params: { bar: 0 } },
    { name: 'Vibes', params: { bar: 1, mallet: 0.4, damp: 0.6 } },
    { name: 'Vibes, motor off', params: { bar: 1, mallet: 0.4, motor: 0, damp: 1.2 } },
    { name: 'Xylophone', params: { bar: 2, mallet: 0.75, room: 0.3 } },
    { name: 'Glockenspiel', params: { bar: 3, mallet: 0.7, damp: 3 } },
    { name: 'Celesta', params: { bar: 4, room: 0.35 } },
    { name: 'Soft yarn', params: { bar: 0, mallet: 0.1, decay: 1.3 } },
  ],
  look: {
    color: '#6b3420',
    ink: '#f5e2c3',
    shape: 'wide',
    finish: 'flat',
    knob: 'cream',
    label: 'script',
    led: '#ffc75a',
  },
  tail: 8,
  kernel: kernel(String.raw`
// per bar: mode ratios, mode gains, each mode's T60 as a share of the fundamental's, the fundamental's T60 at C4 (s),
// semitones per halving of T60 up the keyboard, and the mallet's hardness bias
const BARS = [
  { r: [1, 3.99, 9.9, 17.2], g: [1, 1.5, 0.9, 0.4], d: [1, 0.3, 0.12, 0.06], t: 1.3, half: 18, hard: 0, lv: 0.85 },
  { r: [1, 4.0, 10.0, 17.6], g: [1, 0.6, 0.35, 0.15], d: [1, 0.45, 0.2, 0.1], t: 6, half: 24, hard: 0.05, lv: 0.7 },
  { r: [1, 3.0, 6.2, 10.6], g: [1, 0.9, 0.6, 0.35], d: [1, 0.5, 0.3, 0.15], t: 0.9, half: 18, hard: 0.1, lv: 0.9 },
  { r: [1, 2.756, 5.404, 8.933], g: [1, 0.7, 0.5, 0.3], d: [1, 0.5, 0.3, 0.18], t: 5, half: 30, hard: 0.25, lv: 0.5 },
  { r: [1, 2.756, 5.404, 8.933], g: [1, 0.35, 0.15, 0.06], d: [1, 0.35, 0.2, 0.1], t: 2, half: 24, hard: -0.1, lv: 0.85 },
];
const K = 4;
return {
  poly: 16,
  create({ sr, seed }) {
    const NY = sr * 0.45;
    const room = fdn(sr, seed ^ 0x3a11);
    const rmS = glide(40, sr), rl = svf(sr), rr = svf(sr);
    // the vibes motor: one shaft turns every disc, so every note pulses together
    let mph = 0, mdt = 0, mdep = 0;
    return {
      voice(vi) {
        const r = rng((seed ^ 0x6a11e7) + vi * 7919);
        const nz = rng((seed ^ 0x51c) + vi * 104729);
        const c1 = new Float64Array(K), c2 = new Float64Array(K), y1 = new Float64Array(K), y2 = new Float64Array(K), b = new Float64Array(K), dk = new Float64Array(K);
        let n0 = 0, t = 0, plen = 1, pk = 0, rel = false, rk = 1, kr = 1, env = 0, ek = 1, pan = [1, 1], gain = 1, motor = 0, tick = 0, tk = 1, tb = svf(sr);
        return {
          start(p, v, P) {
            const B = BARS[P.bar | 0] || BARS[0], f0 = mtof(p);
            t = 0; rel = false; rk = 1;
            kr = coef(Math.max(0.02, P.damp) / 6.91, sr);
            // the mallet: harder with MALLET and with velocity; its contact time a fraction of the bar's period
            const h = clamp(0.55 * P.mallet + 0.7 * Math.pow(v, 1.2) - 0.25 + B.hard + 0.03 * r(), 0, 1);
            const m = Math.pow(0.07, h);
            plen = Math.max(3, Math.min(Math.round(0.03 * sr), Math.round(m * sr / f0)));
            pk = 0;
            const reg = Math.pow(2, -(p - 60) / B.half), t60 = clamp(B.t * reg * P.decay, 0.08, 30);
            n0 = 0;
            for (let k = 0; k < K; k++) {
              const f = f0 * B.r[k];
              if (f > NY) continue;
              const w = TAU * f / sr, rad = Math.exp(-6.9078 / (Math.max(0.02, t60 * B.d[k]) * sr));
              c1[n0] = 2 * rad * Math.cos(w); c2[n0] = rad * rad; y1[n0] = 0; y2[n0] = 0;
              b[n0] = B.g[k] * Math.sin(w);
              dk[n0] = rad;
              n0++;
            }
            // level: the same peak at every register and every bar for a given hit (the mallet's spectrum rides on it)
            gain = 0.42 * B.lv * (0.2 + 0.8 * Math.pow(v, 1.3)) * (1 + 0.04 * r());
            env = 1; ek = dk[0] || 0.9;
            pan = panLR(clamp((p - 66) / 30, -1, 1) * P.width * 0.8);
            motor = B === BARS[1] ? 1 : 0;
            // the mallet's own tock: a short burst, louder for hard mallets
            tick = 0.08 * h * h * (0.4 + 0.6 * v); tk = coef(0.0015, sr); tb.set(Math.min(NY, f0 * 3.2), 1.2);
          },
          release() { rel = true; },
          render(L, R, n, P) {
            let ph = mph;
            const dep = motor * mdep, dt = mdt;
            for (let i = 0; i < n; i++, t++) {
              let x = 0;
              if (t < plen) { const u = (t + 0.5) / plen; x = (1 - Math.cos(TAU * u)) / plen; }
              let y = 0, f1 = 0;
              for (let k = 0; k < n0; k++) {
                const v = c1[k] * y1[k] - c2[k] * y2[k] + b[k] * x;
                y2[k] = y1[k]; y1[k] = v;
                if (k === 0) f1 = v; else y += v;
              }
              if (dep) { ph += dt; if (ph >= 1) ph -= 1; f1 *= (1 - dep * (0.5 - 0.5 * sinT(ph))) * (1 + 0.35 * dep); }
              y += f1;
              if (tick) { y += tb.tick(nz()) * tick; tick *= tk; if (tick < 1e-6) tick = 0; }
              y *= gain;
              if (rel) { rk *= kr; y *= rk; }
              L[i] += y * pan[0]; R[i] += y * pan[1];
            }
            env *= Math.pow(ek, n);
            return !((env * rk < 2e-4 && t > plen) || (rk < 1e-4));
          },
        };
      },
      process(L, R, n, P) {
        // the motor's shaft (VIBES): a smooth depth so 0 Hz fades the pulse out rather than freezing it
        mdt = P.motor / sr; mdep = 0.85 * clamp(P.motor / 0.6, 0, 1);
        mph += mdt * n; mph -= Math.floor(mph);
        room.set(0.32, 1.1, 0.5); rl.set(220, 0.6); rr.set(220, 0.6);
        for (let i = 0; i < n; i++) {
          const rm = rmS.next(P.room) * 0.7;
          room.tick(L[i], R[i]); rl.tick(room.l); rr.tick(room.r);
          L[i] = knee((L[i] + rl.hp * rm) * 0.86); R[i] = knee((R[i] + rr.hp * rm) * 0.86);
        }
      },
    };
  },
};
`),
});
