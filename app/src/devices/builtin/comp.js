// @ts-check
// core.comp: Squeeze Box. A feed-forward stereo compressor: a linked peak/RMS detector (the bass high-passed out of the
// side-chain so the kick doesn't pump everything), a soft-knee gain computer, and gain smoothing in decibels with a
// program-dependent release (quick after a lone transient, slower once it has been working a while, so sustained
// material doesn't pump). AUTO makeup gives back, slowly, about what the compressor takes on average, so switching
// it in doesn't jump in level whatever goes in; MAKEUP adds on top. MIX blends in the dry signal (parallel compression).
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.comp',
  name: 'Squeeze Box',
  kind: 'effect',
  cat: 'dynamics',
  by: 'overdub',
  blurb: 'Smooth, musical compression: glue, punch, sustain',
  nod: 'a studio VCA bus compressor',
  params: [
    {
      key: 'threshold',
      label: 'THRESH',
      min: -60,
      max: 0,
      def: -20,
      unit: 'dB',
      role: 'level',
      desc: 'compression starts above this level',
    },
    {
      key: 'ratio',
      label: 'RATIO',
      min: 1,
      max: 20,
      def: 3,
      curve: 'log',
      unit: 'x',
      role: 'depth',
      desc: 'how hard it pushes back: 2 gentle, 4 firm, 10+ limiting',
    },
    {
      key: 'attack',
      label: 'ATTACK',
      min: 0.1,
      max: 100,
      def: 12,
      curve: 'log',
      unit: 'ms',
      role: 'attack',
      desc: 'slower lets the punch through',
    },
    {
      key: 'release',
      label: 'RELEASE',
      min: 20,
      max: 1500,
      def: 150,
      curve: 'log',
      unit: 'ms',
      role: 'release',
      desc: 'how fast it lets go: fast is lively, slow is smooth',
    },
    {
      key: 'knee',
      label: 'KNEE',
      min: 0,
      max: 18,
      def: 6,
      unit: 'dB',
      role: 'shape',
      desc: 'hard (0) to soft and invisible',
    },
    {
      key: 'auto',
      label: 'AUTO',
      opts: ['OFF', 'ON'],
      def: 1,
      role: 'level',
      desc: 'automatic makeup: on keeps the level about where it was',
    },
    {
      key: 'makeup',
      label: 'MAKEUP',
      min: -12,
      max: 24,
      def: 0,
      unit: 'dB',
      role: 'level',
      desc: 'level back after compressing (on top of AUTO)',
    },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', desc: 'parallel: dry under the squashed signal' },
  ],
  look: {
    color: '#24221f',
    ink: '#f1dc8a',
    shape: 'rack',
    finish: 'brushed',
    knob: 'chicken',
    label: 'block',
    led: '#f1dc8a',
  },
  tail: 0.3,
  kernel: kernel(String.raw`
const AUTO_K = 1.0;   // measured: the share of the average reduction that gives the level back (tools/sounds-test.js)
return {
  create({ sr }) {
    const scL = svf(sr).set(70, 0.6), scR = svf(sr).set(70, 0.6);
    let env = 0, gr = 0, busy = 0, avg = 0;
    const mS = glide(20, sr, 1), mixS = glide(20, sr, 1);
    const rmsA = coef(0.005, sr), busyA = coef(0.4, sr), avgA = coef(0.6, sr), autoS = glide(50, sr, 1);
    const out = { gr: 0 };
    return {
      meter() { return -gr; },
      process(L, R, n, P) {
        const th = P.threshold, ratio = P.ratio, knee = Math.max(0.01, P.knee), slope = 1 - 1 / ratio;
        const at = coef(P.attack / 1000, sr), relFast = coef(P.release / 1000, sr), relSlow = coef(P.release * 4 / 1000, sr);
        const mk = dbg(P.makeup);
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          scL.tick(xl); scR.tick(xr);
          const hl = scL.hp, hr = scR.hp;
          // detector: half peak, half RMS (5 ms), linked
          const pk = Math.max(hl < 0 ? -hl : hl, hr < 0 ? -hr : hr);
          env = (hl * hl + hr * hr) * 0.5 + (env - (hl * hl + hr * hr) * 0.5) * rmsA;
          const lev = 0.5 * pk + 0.5 * Math.sqrt(env * 2);
          const db = lev > 1e-6 ? 20 * Math.log10(lev) : -120;
          // soft-knee gain computer: dB of reduction wanted
          const o = db - th;
          let want = 0;
          if (2 * o > knee) want = o * slope;
          else if (2 * o > -knee) { const k = o + knee / 2; want = slope * k * k / (2 * knee); }
          // smoothing in dB: attack toward more reduction, a release that slows as the compressor stays busy
          if (want > gr) gr = want + (gr - want) * at;
          else { const rk = relFast + (relSlow - relFast) * busy; gr = want + (gr - want) * rk; }
          busy = (gr > 2 ? 1 : gr / 2) + (busy - (gr > 2 ? 1 : gr / 2)) * busyA;
          avg = gr + (avg - gr) * avgA;
          const au = autoS.next(P.auto | 0);
          const g = Math.pow(10, (au * avg * AUTO_K - gr) / 20) * mS.next(mk), mx = mixS.next(P.mix);
          L[i] = xl * (g * mx + (1 - mx)); R[i] = xr * (g * mx + (1 - mx));
        }
      },
    };
  },
};
`),
});
