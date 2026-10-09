// @ts-check
// claude.chopping-block: Chopping Block. A gate locked to the song: the bar is cut into steps (RATE), a 16-step
// PATTERN says which ones speak, LENGTH is how much of each step is open and SMOOTH rounds the edges (sharp chops to
// soft pulses). It follows the transport's beat while the song plays and keeps its own time while it doesn't. Makeup
// gain follows the pattern so on and bypassed sound about as loud.
export default {
  id: 'claude.chopping-block', name: 'Chopping Block', kind: 'effect', cat: 'glitch', by: 'claude', version: 1,
  blurb: 'Chops anything into a rhythmic gate, in time with the song',
  nod: 'the tempo-synced trance gate',
  request: 'Chop my pad into a rhythmic gate in time with the song, trance style.',
  params: [
    { key: 'rate', label: 'RATE', opts: ['1/8', '1/16', '1/32', '1/8T', '1/16T'], def: 1, role: 'rate', desc: 'how long each step is' },
    { key: 'pattern', label: 'PATTERN', opts: ['STRAIGHT', 'TRANCE', '3-3-2', 'OFFBEAT'], def: 0, role: 'shape', desc: 'which steps open' },
    { key: 'length', label: 'LENGTH', min: 10, max: 100, def: 60, unit: '%', role: 'gate', desc: 'how much of each step is open: staccato to legato' },
    { key: 'smooth', label: 'SMOOTH', min: 0.5, max: 40, def: 3, curve: 'log', unit: 'ms', role: 'attack', desc: 'sharp chops to soft pulses' },
    { key: 'depth', label: 'DEPTH', min: 0, max: 1, def: 1, role: 'depth', desc: 'how closed the gaps are' },
  ],
  look: { color: '#2b2f36', ink: '#e8f0ff', shape: 'box', finish: 'check', knob: 'black', label: 'block', led: '#ff5a5a' },
  tail: 0.1,
  kernel: `({
  create({ sr, seed, dsp }) {
    const STEP = [0.5, 0.25, 0.125, 1 / 3, 1 / 6];   // beats per step
    const PAT = [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
      [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    ];
    const ON = PAT.map((a) => a.reduce((s, x) => s + x, 0) / 16);
    const gate = dsp.slew(3, 4.5, 1), mk = dsp.smooth(80, 1);
    const knee = (x) => { const a = x < 0 ? -x : x; if (a <= 0.5) return x; const y = 0.5 + 0.3 * dsp.tanh((a - 0.5) / 0.3); return x < 0 ? -y : y; };
    let pos = 0;
    return {
      process(L, R, n, p, t) {
        const bpm = t && t.bpm > 0 ? t.bpm : 120;
        if (t && t.playing) pos = t.beat;
        const inc = bpm / 60 / sr;
        const st = STEP[p.rate | 0], pi = p.pattern | 0, pat = PAT[pi], duty = p.length / 100, floor = 1 - p.depth;
        gate.set(p.smooth, p.smooth * 1.5);
        // keep the loudness: the open fraction of the bar, and what leaks through the gaps
        const open = ON[pi] * duty, energy = open + (1 - open) * floor * floor;
        const makeup = Math.min(2, 1 / Math.sqrt(Math.max(0.25, energy)));
        for (let i = 0; i < n; i++) {
          const sp = pos / st, k = Math.floor(sp), f = sp - k;
          const g = gate.tick(pat[k & 15] && f < duty ? 1 : floor) * mk.tick(makeup);
          L[i] = knee(L[i] * g); R[i] = knee(R[i] * g);
          pos += inc;
        }
      },
    };
  },
})`,
};
