// @ts-check
// core.bass: Capstan. One voice, played legato: a saw/square blend with a sine sub underneath, a 24 dB low-pass
// (two state-variable stages, Butterworth-spaced, resonance on the second) swept by its own envelope, then a 2x
// oversampled drive. Overlapping notes slide (GLIDE) without retriggering the envelopes, like a mono synth's legato
// mode; RETRIG plucks every note. About -16 LUFS on the bass test phrase at defaults.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.bass',
  name: 'Capstan',
  kind: 'instrument',
  cat: 'bass',
  by: 'overdub',
  blurb: 'Round mono bass that slides and growls',
  nod: 'a monophonic analog bass synth with a sub oscillator',
  params: [
    {
      key: 'wave',
      label: 'WAVE',
      min: 0,
      max: 1,
      def: 0.25,
      role: 'shape',
      desc: 'saw (0) to square (1): buzzy to hollow',
    },
    {
      key: 'sub',
      label: 'SUB',
      min: 0,
      max: 1,
      def: 0.55,
      role: 'level',
      desc: 'a sine an octave down: the part you feel',
    },
    {
      key: 'cutoff',
      label: 'CUTOFF',
      min: 40,
      max: 8000,
      def: 520,
      curve: 'log',
      unit: 'Hz',
      role: 'tone',
      desc: 'brighter as it opens',
    },
    { key: 'reso', label: 'RESO', min: 0, max: 1, def: 0.3, role: 'tone', desc: 'resonance: rubbery, then squelchy' },
    {
      key: 'envamt',
      label: 'ENV',
      min: 0,
      max: 1,
      def: 0.45,
      role: 'depth',
      desc: 'how far each note opens the filter',
    },
    {
      key: 'fdecay',
      label: 'F.DECAY',
      min: 0.02,
      max: 2,
      def: 0.25,
      curve: 'log',
      unit: 's',
      role: 'decay',
      desc: 'how fast it closes again: short = plucky',
    },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.25, role: 'drive', desc: 'warmth, then grit' },
    {
      key: 'glide',
      label: 'GLIDE',
      min: 0,
      max: 500,
      def: 45,
      unit: 'ms',
      role: 'time',
      desc: 'slide time between overlapping notes',
    },
    {
      key: 'release',
      label: 'RELEASE',
      min: 0.005,
      max: 2,
      def: 0.06,
      curve: 'log',
      unit: 's',
      role: 'release',
      desc: 'tail after the key lets go',
    },
    {
      key: 'mode',
      label: 'MODE',
      opts: ['LEGATO', 'RETRIG'],
      def: 0,
      role: 'shape',
      desc: 'legato slides held notes; retrig re-plucks each one',
    },
  ],
  look: {
    color: '#6a2f1b',
    ink: '#ffd9b0',
    shape: 'wide',
    finish: 'hammer',
    knob: 'chicken',
    label: 'stencil',
    led: '#ff8a3d',
  },
  tail: 2,
  kernel: kernel(String.raw`
return {
  poly: 1,
  create({ sr, seed }) {
    const r = rng(seed ^ 0xba55);
    // One mono engine shared by the voices: the host gives a new note a fresh voice (and fades the old one out), so
    // legato lives here, not in a voice. Only the voice that owns the engine renders it.
    let ph = (r() + 1) / 2, ph2 = (r() + 1) / 2, subPh = 0, dt = 0, subDt = 0;
    const amp = adsr(sr), f1 = svf(sr), f2 = svf(sr), shape = os2((x) => sat(x)), dc = dcblock(sr);
    let owner = null, held = false, vel = 0.8, pitch = 40, from = 40, cur = 40, gt = 1, gdur = 0.05, fenv = 0, cnt = 0, vph = 0;
    const lev = glide(20, sr, 1), kpS = glide(6, sr, 1);
    let kp = 1;
    function render(L, R, n, P, T) {
      amp.set(0.002, 0.3, 1, P.release);
      // expression: the bend wheel (semitones) and the mod wheel's vibrato (up to 35 cents at 5.5 Hz)
      let bx = 0;
      if (T && (T.bend || T.mod > 0)) { if (T.mod > 0) { vph += n * 5.5 / sr; if (vph >= 1) vph -= 1; } bx = T.bend + T.mod * 0.35 * sinT(vph); }

      const fk = coef(P.fdecay / 4, sr), w = P.wave, sub = P.sub, q2 = 1.31 + P.reso * P.reso * 9;
      const env = P.envamt * 6 * (0.5 + 0.5 * vel), g = 1 + P.drive * P.drive * 14;
      const comp = Math.pow(g, -0.42);
      for (let i = 0; i < n; i++) {
        if ((cnt++ & 7) === 0) {
          let m = pitch;
          if (gt < 1) { gt += 8 / sr / Math.max(1e-3, gdur); const s = gt >= 1 ? 1 : gt * gt * (3 - 2 * gt); m = from + (pitch - from) * s; }
          cur = m; dt = mtof(bx !== 0 ? m + bx : m) / sr; subDt = dt / 2;
          // it's a bass: up high it gets quieter and only a little brighter (a lead line up there doesn't jump out)
          kp = m <= 45 ? 1 : Math.max(0.3, Math.pow(2, -(m - 45) / 18));
          const fc = P.cutoff * Math.pow(2, env * fenv + (m - 40) / 48);
          f1.set(fc, 0.54); f2.set(fc, q2);
        }
        fenv *= fk;
        ph += dt; if (ph >= 1) ph -= 1;
        ph2 += dt * 1.0011; if (ph2 >= 1) ph2 -= 1;
        const saw = 2 * ph - 1 - blep(ph, dt);
        let p2 = ph + 0.5; if (p2 >= 1) p2 -= 1;
        const sq = (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep(p2, dt);
        const saw2 = 2 * ph2 - 1 - blep(ph2, dt * 1.0011);
        const x = (saw * 0.8 + saw2 * 0.2) * (1 - w) + sq * w * 0.85;
        subPh += subDt; if (subPh >= 1) subPh -= 1;
        const y = f2.tick(f1.tick(x)) + sinT(subPh) * sub * 1.1;
        const e = amp.next() * (0.55 + 0.45 * vel);
        const out = dc(shape(y * e * 0.7 * g * kpS.next(kp)) * comp) * lev.next(0.64);
        L[i] += out; R[i] += out;
      }
      return amp.active();
    }
    return {
      voice() {
        const me = {
          start(p, v, P) {
            const legato = held && (P.mode | 0) === 0 && amp.active();
            if (legato && P.glide > 0) { from = cur; gt = 0; gdur = P.glide / 1000; }
            else { from = p; gt = 1; }
            pitch = p; held = true; owner = me;
            if (!legato) { vel = v; fenv = 1; amp.set(0.002, 0.3, 1, P.release); amp.gate(true); }
          },
          release(P) { if (owner !== me) return; held = false; amp.set(0.002, 0.3, 1, P.release); amp.gate(false); },
          render(L, R, n, P, T) { return owner === me ? render(L, R, n, P, T) : false; },
          stop() { if (owner === me) { owner = null; held = false; } },
        };
        return me;
      },
    };
  },
};
`),
});
