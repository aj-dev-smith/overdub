// claude.sub-basement: Sub Basement. The 808 bass: a sine that starts DROP semitones sharp and falls to the note
// (exponentially, over FALL), so every hit has a knock before the boom. A long exponential DECAY while held, a quick
// fade when you let go, then a tanh drive (2x oversampled) for the harmonics that let it read on small speakers, and a
// low-pass to taste.
export default {
  id: 'claude.sub-basement', name: 'Sub Basement', kind: 'instrument', cat: 'bass', by: 'claude', version: 1,
  blurb: 'An 808 that drops in pitch and shakes the floor',
  nod: 'the classic drum-machine bass drum, played as a bass',
  request: 'I want an 808 that drops in pitch and shakes the floor.',
  params: [
    { key: 'drop', label: 'DROP', min: 0, max: 24, def: 7, unit: 'st', role: 'pitch', desc: 'how far above the note each hit starts' },
    { key: 'fall', label: 'FALL', min: 5, max: 500, def: 60, curve: 'log', unit: 'ms', role: 'time', desc: 'how fast it falls to the note: a knock or a swoop' },
    { key: 'decay', label: 'DECAY', min: 0.1, max: 8, def: 1.8, curve: 'log', unit: 's', role: 'decay', desc: 'how long the boom lasts while you hold it' },
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.35, role: 'drive', desc: 'clean sub to growling: harmonics you hear on phones' },
    { key: 'tone', label: 'TONE', min: 150, max: 8000, def: 1800, curve: 'log', unit: 'Hz', role: 'tone', desc: 'how much of the growl gets through' },
  ],
  look: { color: '#1f2a24', ink: '#c9ffd9', shape: 'box', finish: 'hammer', knob: 'black', label: 'stencil', led: '#53ff9a' },
  tail: 1,
  kernel: `({
  poly: 6,
  create({ sr, seed, dsp }) {
    const G = 0.36;
    const knee = (x) => { const a = x < 0 ? -x : x; if (a <= 0.5) return x; const y = 0.5 + 0.3 * dsp.tanh((a - 0.5) / 0.3); return x < 0 ? -y : y; };
    return {
      voice(i) {
        const os = dsp.oversample2x(), lp = dsp.svf();
        let drive = 1, comp = 1;
        const shape = (x) => dsp.tanh(x * drive) * comp;
        let ph = 0, f0 = 110, st = 0, fk = 0, amp = 0, ak = 1, rel = 1, rk = 1, on = false, vel = 0.8, atk = 0;
        const ATK = 1 / (0.0015 * sr), RK = Math.exp(-1 / (0.03 * sr));
        return {
          start(pitch, v, p) {
            f0 = dsp.mtof(pitch); st = p.drop; fk = Math.exp(-1 / (p.fall * 0.001 * sr));
            ph = 0; amp = 1; ak = Math.pow(10, -3 / (p.decay * sr)); rel = 1; on = true; vel = v; atk = 0;
          },
          release(p) { on = false; },
          render(L, R, n, p) {
            drive = 1 + 7 * p.drive; comp = 1 / Math.pow(drive, 0.62);
            lp.set(p.tone, 0.6);
            const g = G * (0.35 + 0.65 * vel);
            for (let j = 0; j < n; j++) {
              const f = st > 0.001 ? f0 * Math.pow(2, st / 12) : f0;
              st *= fk;
              ph += f / sr; if (ph >= 1) ph -= 1;
              if (atk < 1) atk = Math.min(1, atk + ATK);
              const e = amp * rel * atk;
              amp *= ak; if (!on) rel *= RK;
              const y = lp.lp(os.process(Math.sin(dsp.TAU * ph) * e, shape)) * g;
              L[j] += y; R[j] += y;
            }
            return amp * rel > 1e-4;
          },
        };
      },
      process(L, R, n) {
        for (let j = 0; j < n; j++) { L[j] = knee(L[j]); R[j] = knee(R[j]); }
      },
    };
  },
})`,
};
