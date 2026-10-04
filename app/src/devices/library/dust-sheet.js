// claude.dust-sheet: Dust Sheet. The string machine: every note is a sawtooth plus one an octave up (the 8' and 4'
// stops), summed in mono, thinned and softened, then through the ensemble: one bucket-brigade-style delay read by
// three taps 120 degrees apart, each swept by a slow and a fast sine at once. That swirl is the whole sound.
export default {
  id: 'claude.dust-sheet', name: 'Dust Sheet', kind: 'instrument', cat: 'synth', by: 'claude', version: 1,
  blurb: 'Wobbly seventies string-machine strings, ensemble and all',
  nod: 'a divide-down string ensemble keyboard with its three-phase chorus',
  request: 'Give me those cheesy seventies string-machine strings, the wobbly ensemble kind.',
  params: [
    { key: 'tone', label: 'TONE', min: 600, max: 12000, def: 3600, curve: 'log', unit: 'Hz', role: 'tone', desc: 'muffled under the dust sheet to bright and buzzy' },
    { key: 'ensemble', label: 'ENSEMBLE', min: 0, max: 1, def: 0.75, role: 'depth', desc: 'the swirl: one string to a whole section' },
    { key: 'octave', label: 'OCTAVE', min: 0, max: 1, def: 0.4, role: 'shape', desc: 'how much of the octave-up stop (violins over cellos)' },
    { key: 'attack', label: 'ATTACK', min: 0.005, max: 3, def: 0.15, curve: 'log', unit: 's', role: 'attack', desc: 'how slowly the bows come in' },
    { key: 'release', label: 'RELEASE', min: 0.05, max: 5, def: 0.9, curve: 'log', unit: 's', role: 'release', desc: 'how long they hang on' },
  ],
  look: { color: '#8c6b3f', ink: '#fff6e2', shape: 'wide', finish: 'stripe', knob: 'chicken', label: 'block', led: '#ffd27a' },
  tail: 6,
  kernel: `({
  poly: 12,
  create({ sr, seed, dsp }) {
    const MAXD = Math.ceil(sr * 0.02);
    const line = dsp.delay(MAXD + 8);
    const tone = dsp.svf(), body = dsp.svf(), lo = dsp.onepole(120);
    const base = sr * 0.0058, depS = sr * 0.0021, depF = sr * 0.00032;
    const dS = 0.63 / sr, dF = 5.8 / sr, TAU = dsp.TAU, THIRD = TAU / 3;
    let ps = 0, pf = 0.37;
    const em = dsp.smooth(30, 0.75);
    const OUT = 1.75;
    const knee = (x) => { const a = x < 0 ? -x : x; if (a <= 0.5) return x; const y = 0.5 + 0.3 * dsp.tanh((a - 0.5) / 0.3); return x < 0 ? -y : y; };
    return {
      voice(i) {
        const a = dsp.osc('saw'), b = dsp.osc('saw'), env = dsp.adsr(0.15, 0.3, 1, 0.9);
        let vel = 0.8;
        return {
          start(pitch, v, p) {
            a.freq(dsp.mtof(pitch)).reset((i * 0.31) % 1); b.freq(dsp.mtof(pitch + 12) * 1.0011).reset((i * 0.53) % 1);
            vel = v; env.set(p.attack, 0.3, 1, p.release); env.gate(true);
          },
          release(p) { env.set(p.attack, 0.3, 1, p.release); env.gate(false); },
          render(L, R, n, p) {
            env.set(p.attack, 0.3, 1, p.release);
            const g = 0.1 * (0.55 + 0.45 * vel), o = p.octave, ga = 1 - 0.55 * o, gb = 0.85 * o;
            for (let j = 0; j < n; j++) L[j] += (a.next() * ga + b.next() * gb) * env.next() * g;   // mono: the ensemble makes the stereo
            return env.active();
          },
        };
      },
      process(L, R, n, p) {
        tone.set(p.tone, 0.6);
        body.set(900, 0.8, 2.5);
        for (let j = 0; j < n; j++) {
          const x = body.bell(tone.lp(lo.hp(L[j])));
          const e = em.tick(p.ensemble);
          ps += dS; if (ps >= 1) ps -= 1;
          pf += dF; if (pf >= 1) pf -= 1;
          const as = TAU * ps, af = TAU * pf;
          const t0 = base + e * (depS * Math.sin(as) + depF * Math.sin(af));
          const t1 = base + e * (depS * Math.sin(as + THIRD) + depF * Math.sin(af + THIRD));
          const t2 = base + e * (depS * Math.sin(as + 2 * THIRD) + depF * Math.sin(af + 2 * THIRD));
          const y0 = line.cubic(t0), y1 = line.cubic(t1), y2 = line.cubic(t2);
          line.write(x);
          const dry = 1 - 0.75 * e;
          L[j] = knee(OUT * (x * dry + e * (0.85 * y0 + 0.5 * y1)));
          R[j] = knee(OUT * (x * dry + e * (0.85 * y2 + 0.5 * y1)));
        }
      },
    };
  },
})`,
};
