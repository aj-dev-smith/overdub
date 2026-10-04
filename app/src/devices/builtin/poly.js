// core.poly: Patch Bay, Overdub's everyday polysynth. Two band-limited oscillators a few cents apart (saw, square or
// pulse), a sine sub an octave down, a 12 dB state-variable low-pass per side with its own decay envelope, an
// analog-style ADSR, optional glide and a light unison. Every voice drifts a cent or two of its own (seeded), so
// chords breathe. Level: about -16 LUFS on the test phrase at defaults (tools/sounds-test.js measures it).
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.poly', name: 'Patch Bay', kind: 'instrument', cat: 'synth', by: 'overdub',
  blurb: 'Warm two-oscillator poly: chords, stabs, leads',
  nod: 'a classic two-oscillator analog polysynth',
  params: [
    { key: 'wave', label: 'WAVE', opts: ['SAW', 'SQUARE', 'PULSE'], def: 0, role: 'shape', desc: 'saw is bright and buzzy, square hollow, pulse nasal' },
    { key: 'pw', label: 'WIDTH', min: 0.05, max: 0.5, def: 0.28, role: 'shape', desc: 'pulse width (PULSE only): thinner as it closes' },
    { key: 'detune', label: 'DETUNE', min: 0, max: 40, def: 9, unit: 'ct', role: 'width', desc: 'cents between the two oscillators: thicker, then sour' },
    { key: 'sub', label: 'SUB', min: 0, max: 1, def: 0.25, role: 'level', desc: 'a sine an octave below: weight without mud' },
    { key: 'spread', label: 'SPREAD', min: 0, max: 1, def: 0.4, role: 'width', desc: 'oscillators apart in the stereo field' },
    { key: 'unison', label: 'UNISON', min: 0, max: 1, def: 0, role: 'width', desc: 'two more detuned oscillators fade in: supersaw-ish' },
    { key: 'cutoff', label: 'CUTOFF', min: 60, max: 16000, def: 2400, curve: 'log', unit: 'Hz', role: 'tone', desc: 'brighter as it opens' },
    { key: 'reso', label: 'RESO', min: 0, max: 1, def: 0.18, role: 'tone', desc: 'resonance: a vocal peak at the cutoff' },
    { key: 'envamt', label: 'ENV', min: -1, max: 1, def: 0.35, role: 'depth', desc: 'how far the filter envelope opens it (negative closes)' },
    { key: 'fdecay', label: 'F.DECAY', min: 0.02, max: 3, def: 0.4, curve: 'log', unit: 's', role: 'decay', desc: 'how fast the filter envelope falls back' },
    { key: 'attack', label: 'ATTACK', min: 0.001, max: 4, def: 0.004, curve: 'log', unit: 's', role: 'attack', desc: 'fade-in time: pluck to swell' },
    { key: 'decay', label: 'DECAY', min: 0.01, max: 4, def: 0.6, curve: 'log', unit: 's', role: 'decay', desc: 'time to fall to the sustain level' },
    { key: 'sustain', label: 'SUSTAIN', min: 0, max: 1, def: 0.7, role: 'level', desc: 'level while the key is held' },
    { key: 'release', label: 'RELEASE', min: 0.005, max: 6, def: 0.35, curve: 'log', unit: 's', role: 'release', desc: 'tail after the key lets go' },
    { key: 'glide', label: 'GLIDE', min: 0, max: 1000, def: 0, unit: 'ms', role: 'time', desc: 'slide from the previous note (0: off)' },
  ],
  look: { color: '#34503a', ink: '#eef3dc', shape: 'rack', finish: 'brushed', knob: 'cream', label: 'plate', led: '#b8e07a' },
  tail: 6,
  kernel: kernel(String.raw`
return {
  poly: 10,
  create({ sr, seed }) {
    const r = rng(seed ^ 0x51ed);
    let lastPitch = -1;
    const OUT = 0.25;
    return {
      voice() {
        // oscillators: [phase, dt]; 0/1 the pair, 2/3 the unison pair
        const ph = new Float64Array(4), dt = new Float64Array(4), drift = [r() * 1.6, r() * 1.6, r() * 2, r() * 2];
        for (let i = 0; i < 4; i++) ph[i] = (r() + 1) / 2;
        let subPh = 0, subDt = 0;
        const amp = adsr(sr), fl = svf(sr), fr = svf(sr);
        let fenv = 0, fk = 0, vel = 0.8, pitch = 60, from = 60, gt = 1, gdur = 0, cnt = 0, gainL = 1, gainR = 1, vph = 0;
        const shape = (p, d, wave, pw) => {
          if (wave === 0) return 2 * p - 1 - blep(p, d);
          let p2 = p + 1 - pw; if (p2 >= 1) p2 -= 1;
          return (p < pw ? 1 : -1) + blep(p, d) - blep(p2, d) + (wave === 2 ? (1 - 2 * pw) : 0); // (pulse DC removed)
        };
        // a WAVE change crossfades over 10 ms (the old shape out, the new one in, same phase)
        let wv = -1, wPrev = 0, xf = 0;
        const XF = 1 / (0.01 * sr);
        const osc = (i, wave, pw) => {
          let p = ph[i] + dt[i]; if (p >= 1) p -= 1; ph[i] = p; const d = dt[i];
          const y = shape(p, d, wave, pw);
          return xf > 0 ? y + (shape(p, d, wPrev, wPrev === 2 ? pw : 0.5) - y) * xf : y;
        };
        return {
          start(p, v, P) {
            vel = v; pitch = p;
            if (P.glide > 0 && lastPitch >= 0) { from = lastPitch; gt = 0; gdur = P.glide / 1000; } else { from = p; gt = 1; }
            lastPitch = p;
            amp.set(P.attack, P.decay, P.sustain, P.release); amp.gate(true);
            fenv = 1; fk = coef(P.fdecay / 4, sr); cnt = 0;
          },
          release(P) { amp.set(P.attack, P.decay, P.sustain, P.release); amp.gate(false); },
          render(L, R, n, P, T) {
            amp.set(P.attack, P.decay, P.sustain, P.release);
            fk = coef(P.fdecay / 4, sr);
            // expression: the bend wheel (semitones) and the mod wheel's vibrato (up to 35 cents at 5.5 Hz)
            let bx = 0;
            if (T && (T.bend || T.mod > 0)) { if (T.mod > 0) { vph += n * 5.5 / sr; if (vph >= 1) vph -= 1; } bx = T.bend + T.mod * 0.35 * sinT(vph); }
            const wave = P.wave | 0, pw = wave === 2 ? P.pw : 0.5, uni = P.unison, sub = P.sub;
            if (wv < 0) wv = wave;
            if (wave !== wv) { wPrev = wv; wv = wave; xf = 1; }
            const sp = P.spread * 0.7, ql = 0.5 + P.reso * P.reso * 14;
            const vamp = 0.3 + 0.7 * vel * vel, venv = (0.45 + 0.55 * vel) * P.envamt * 5;
            const keyTrack = (pitch - 60) / 24;
            for (let i = 0; i < n; i++) {
              if ((cnt++ & 7) === 0) {
                // slow part, every 8 samples: pitch (glide), oscillator steps, filter
                let m = pitch;
                if (gt < 1) { gt += 8 / sr / Math.max(1e-3, gdur); const s = gt >= 1 ? 1 : gt * gt * (3 - 2 * gt); m = from + (pitch - from) * s; }
                if (bx !== 0) m += bx;
                const det = P.detune / 100;
                dt[0] = mtof(m - det / 2 + drift[0] / 100) / sr; dt[1] = mtof(m + det / 2 + drift[1] / 100) / sr;
                dt[2] = mtof(m - det * 1.9 + drift[2] / 100) / sr; dt[3] = mtof(m + det * 2.3 + drift[3] / 100) / sr;
                subDt = mtof(m - 12) / sr;
                const fc = P.cutoff * Math.pow(2, venv * fenv + keyTrack);
                fl.set(fc, ql); fr.set(fc, ql);
              }
              fenv *= fk;
              const a = osc(0, wave, pw), b = osc(1, wave, pw);
              let xl = a * (1 - sp) + b * sp, xr = b * (1 - sp) + a * sp;
              if (uni > 0.001) { const c = osc(2, wave, pw) * uni, d = osc(3, wave, pw) * uni; xl += c * 0.8 + d * 0.3; xr += d * 0.8 + c * 0.3; }
              subPh += subDt; if (subPh >= 1) subPh -= 1;
              const s = sinT(subPh) * sub * 1.4;
              if (xf > 0) xf -= XF;
              const e = amp.next() * vamp;
              const yl = fl.tick(xl) + s, yr = fr.tick(xr) + s;
              L[i] += yl * e * OUT; R[i] += yr * e * OUT;
            }
            return amp.active();
          },
        };
      },
      // a safety on the sum: linear to -4.4 dBFS, then a soft knee (only a huge chord ever reaches it)
      process(L, R, n) { for (let i = 0; i < n; i++) { L[i] = knee(L[i]); R[i] = knee(R[i]); } },
    };
  },
};
`),
});
