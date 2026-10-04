// core.filter: Keyhole. A resonant multimode filter (low-pass, band-pass, high-pass, notch: one state-variable filter
// per side, stable at any setting) that moves on its own: an LFO locked to the song (note divisions from the transport,
// phase-aligned to the beat while it plays, or free in Hz) and an envelope follower, so it can wobble in time or open
// when you play harder (an auto-wah). A little drive before the filter makes resonance sing instead of whistle.
import { defineDevice } from '../registry.js';
import { kernel, DIV_LABELS } from './lib.js';

export default defineDevice({
  id: 'core.filter', name: 'Keyhole', kind: 'effect', cat: 'filter', by: 'overdub',
  blurb: 'Resonant filter that sweeps in time or wahs as you play',
  nod: 'an analog multimode filter with tempo-synced LFO and envelope follower',
  params: [
    { key: 'mode', label: 'MODE', opts: ['LOW', 'BAND', 'HIGH', 'NOTCH'], def: 0, role: 'shape', desc: 'what it lets through' },
    { key: 'cutoff', label: 'CUTOFF', min: 30, max: 18000, def: 5000, curve: 'log', unit: 'Hz', role: 'tone', desc: 'where it cuts' },
    { key: 'reso', label: 'RESO', min: 0, max: 1, def: 0.25, role: 'tone', desc: 'a singing peak at the cutoff' },
    { key: 'sync', label: 'LFO', opts: ['FREE', ...DIV_LABELS], def: 11, role: 'rate', desc: 'LFO cycle as a note length (FREE uses RATE)' },
    { key: 'rate', label: 'RATE', min: 0.02, max: 20, def: 0.5, curve: 'log', unit: 'Hz', role: 'rate', desc: 'LFO speed when FREE' },
    { key: 'lfo', label: 'LFO AMT', min: 0, max: 4, def: 0.6, unit: 'x', role: 'depth', desc: 'octaves the LFO sweeps' },
    { key: 'env', label: 'ENV AMT', min: -4, max: 4, def: 0, unit: 'x', role: 'depth', desc: 'octaves it opens (or closes) with your playing' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.1, role: 'drive', desc: 'warmth into the filter' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', desc: 'dry to all filter' },
  ],
  look: { color: '#4a3866', ink: '#efe4ff', shape: 'box', finish: 'hammer', knob: 'chicken', label: 'stencil', led: '#c79bff' },
  tail: 0.1,
  kernel: kernel(String.raw`
return {
  create({ sr }) {
    const fl = svf(sr), fr = svf(sr);
    let ph = 0, env = 0, cnt = 0;
    const atk = coef(0.004, sr), rel = coef(0.12, sr);
    const mixS = glide(20, sr, 1), dS = glide(20, sr, 0);
    // switching MODE crossfades (20 ms) from the old output to the new one: no click
    let mode = -1, prev = 0, xf = 0;
    const XF = 1 / (0.02 * sr);
    const pick = (f, m) => (m === 0 ? f.lp : m === 1 ? f.bp * 1.4 : m === 2 ? f.hp : f.lp + f.hp);
    return {
      process(L, R, n, P, t) {
        const sy = P.sync | 0, bpm = (t && t.bpm) || 120;
        // the LFO: cycles per sample; locked to the beat while the song plays
        let dt;
        if (sy === 0) dt = P.rate / sr;
        else {
          const beats = DIVS[sy - 1][1];
          dt = bpm / 60 / beats / sr;
          if (t && t.playing) { const want = (t.beat / beats) % 1; let d = want - ph; d -= Math.round(d); ph += d * 0.5; if (ph < 0) ph += 1; }
        }
        const want = P.mode | 0;
        if (mode < 0) mode = want;
        if (want !== mode) { prev = mode; mode = want; xf = 1; }
        const q = 0.55 + P.reso * P.reso * 14, lfoAmt = P.lfo, envAmt = P.env;
        for (let i = 0; i < n; i++) {
          ph += dt; if (ph >= 1) ph -= 1;
          const xl = L[i], xr = R[i];
          const a = Math.abs(xl) + Math.abs(xr);
          env = a + (env - a) * (a > env ? atk : rel);
          if ((cnt++ & 7) === 0) {
            const tri = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;            // triangle: even sweeps both ways
            const fc = P.cutoff * Math.pow(2, lfoAmt * tri * 0.5 + envAmt * Math.min(1.5, env * 2));
            fl.set(fc, q); fr.set(fc * 1.01, q);
          }
          const dg = 1 + dS.next(P.drive) * 5, inv = 1 / (dg > 1.2 ? Math.pow(dg, 0.7) : dg);
          const il = dg > 1.001 ? sat(xl * dg) * inv : xl, ir = dg > 1.001 ? sat(xr * dg) * inv : xr;
          fl.tick(il); fr.tick(ir);
          let yl = pick(fl, mode), yr = pick(fr, mode);
          if (xf > 0) { yl += (pick(fl, prev) - yl) * xf; yr += (pick(fr, prev) - yr) * xf; xf -= XF; }
          // resonance adds level: take some back
          const rc = 1 / (1 + P.reso * 0.6);
          const mx = mixS.next(P.mix);
          L[i] = xl + (yl * rc - xl) * mx; R[i] = xr + (yr * rc - xr) * mx;
        }
      },
    };
  },
};
`),
});
