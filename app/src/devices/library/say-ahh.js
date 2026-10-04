// claude.say-ahh: Say Ahh. A vowel filter: three formant band-passes per side, morphing through ooh, oh, aah, eh and
// ee. VOWEL sets where the mouth rests; TALK lets your playing open it (an envelope follower: louder notes say more);
// SWAY moves it in time with the song. Makeup follows the vowel, so every vowel sits at about the same level.
export default {
  id: 'claude.say-ahh', name: 'Say Ahh', kind: 'effect', cat: 'filter', by: 'claude', version: 1,
  blurb: 'Makes anything talk: vowels from ooh to ee',
  nod: 'a talk box and a formant filter',
  request: "Make my synth sound like it's talking: wah-wah vowels, 'ooh' to 'aah'.",
  params: [
    { key: 'vowel', label: 'VOWEL', min: 0, max: 1, def: 0.35, role: 'tone', desc: 'where the mouth rests: ooh, oh, aah, eh, ee' },
    { key: 'talk', label: 'TALK', min: 0, max: 1, def: 0.6, role: 'sens', desc: 'how much your playing opens the mouth' },
    { key: 'sway', label: 'SWAY', min: 0, max: 1, def: 0, role: 'depth', desc: 'the vowel moving in time with the song' },
    { key: 'time', label: 'TIME', opts: ['1 BEAT', '2 BEATS', '1 BAR', '2 BARS'], def: 2, role: 'rate', desc: 'one sway, there and back' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', desc: 'how much of the mouth you hear' },
  ],
  look: { color: '#d94f70', ink: '#fff0f3', shape: 'wah', finish: 'sparkle', knob: 'cream', label: 'script', led: '#ffd1dc' },
  tail: 0.2,
  kernel: `({
  create({ sr, seed, dsp }) {
    const VF = [[300, 870, 2240], [570, 840, 2410], [730, 1090, 2440], [530, 1840, 2480], [290, 2200, 3000]];
    const VG = [[1, 0.5, 0.2], [1, 0.6, 0.22], [1, 0.62, 0.3], [1, 0.55, 0.32], [1, 0.45, 0.3]];
    const BW = [90, 120, 170];
    const MK = [7.4, 6.2, 6.05, 6.4, 7.5];               // makeup per vowel, measured on the DI strum
    const fl = [dsp.svf(), dsp.svf(), dsp.svf()], fr = [dsp.svf(), dsp.svf(), dsp.svf()];
    const g = new Float64Array(3);
    const env = dsp.follower(4, 180), sway = dsp.lfo('tri', 1, seed), gm = dsp.smooth(20, 1), mks = dsp.smooth(20, 6);
    const BEATS = [1, 2, 4, 8];
    const knee = (x) => { const a = x < 0 ? -x : x; if (a <= 0.5) return x; const y = 0.5 + 0.3 * dsp.tanh((a - 0.5) / 0.3); return x < 0 ? -y : y; };
    let sv = 0, mk = 6;
    return {
      process(L, R, n, p, t) {
        sway.sync(BEATS[p.time | 0], t);
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          const e = env.tick((xl < 0 ? -xl : xl) > (xr < 0 ? -xr : xr) ? xl : xr);
          sv = sway.next();
          if ((i & 15) === 0) {
            const open = dsp.clamp((dsp.toDb(e + 1e-6) + 42) / 30, 0, 1);   // -42 dBFS: shut .. -12 dBFS: wide open
            const pos = dsp.clamp(p.vowel + p.talk * (open - 0.4) * 0.9 + p.sway * 0.5 * sv, 0, 1) * 4;
            const i0 = pos >= 4 ? 3 : Math.floor(pos), f = pos - i0;
            for (let k = 0; k < 3; k++) {
              const fc = VF[i0][k] * Math.pow(VF[i0 + 1][k] / VF[i0][k], f);
              fl[k].set(fc, fc / BW[k]); fr[k].set(fc, fc / BW[k]);
              g[k] = VG[i0][k] + (VG[i0 + 1][k] - VG[i0][k]) * f;
            }
            mk = MK[i0] + (MK[i0 + 1] - MK[i0]) * f;
          }
          const m = mks.tick(mk), w = gm.tick(p.mix);
          let yl = 0, yr = 0;
          for (let k = 0; k < 3; k++) { yl += g[k] * fl[k].bp(xl); yr += g[k] * fr[k].bp(xr); }
          L[i] = knee(xl + (yl * m - xl) * w);
          R[i] = knee(xr + (yr * m - xr) * w);
        }
      },
    };
  },
})`,
};
