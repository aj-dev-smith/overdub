// claude.leading-edge: Leading Edge. A transient shaper, no threshold to set: two pairs of envelope followers on the
// signal. A fast-attack and a slow-attack follower differ only at the start of a hit (ATTACK turns that difference
// into gain: more snap, or less); a long-release and a short-release follower differ only while a note rings out
// (SUSTAIN turns that into gain: more ring, or less). A 1.5 ms look-ahead lets the gain land on the hit itself, and a
// soft ceiling keeps the extra snap from clipping.
export default {
  id: 'claude.leading-edge', name: 'Leading Edge', kind: 'effect', cat: 'dynamics', by: 'claude', version: 1,
  blurb: 'More snap on every hit, less ring after it',
  nod: 'the differential-envelope transient designer',
  request: 'The drums need more snap on the hits but less ring after.',
  params: [
    { key: 'attack', label: 'ATTACK', min: -100, max: 100, def: 50, unit: '%', role: 'attack', desc: 'more snap at the start of each hit (or softer, below 0)' },
    { key: 'sustain', label: 'SUSTAIN', min: -100, max: 100, def: -35, unit: '%', role: 'release', desc: 'more ring after each hit (or tighter, below 0)' },
    { key: 'output', label: 'OUTPUT', min: -12, max: 6, def: 0, unit: 'dB', role: 'level', desc: 'the level out' },
  ],
  look: { color: '#e9e4d8', ink: '#2a2620', shape: 'mini', finish: 'flat', knob: 'black', label: 'block', led: '#ff6a3d' },
  tail: 0.1,
  kernel: `({
  create({ sr, seed, dsp }) {
    const LA = Math.round(sr * 0.0015);
    const dl = dsp.delay(LA + 8), dr = dsp.delay(LA + 8);
    const fA = dsp.follower(0.2, 70), sA = dsp.follower(20, 70);    // differ at onsets
    const fS = dsp.follower(0.2, 400), sS = dsp.follower(0.2, 45);  // differ in the decays
    const gs = dsp.slew(0.6, 8, 1), out = dsp.smooth(20, 1);
    const DB = 20 / Math.LN10, LN = Math.LN10 / 20;
    const knee = (x) => { const a = x < 0 ? -x : x; if (a <= 0.5) return x; const y = 0.5 + 0.3 * dsp.tanh((a - 0.5) / 0.3); return x < 0 ? -y : y; };
    return {
      latency: LA,
      process(L, R, n, p) {
        const att = p.attack / 100, sus = p.sustain / 100;
        // auto gain: what the shaping adds or takes in loudness (measured on the DI strum), given back, so on and
        // bypassed compare at the same level and OUTPUT is only for taste
        const auto = -((att > 0 ? 7.2 : 6.1) * att + (sus > 0 ? 2.9 : 1.7) * sus);
        const o = dsp.dB(p.output + auto);
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          const a = (xl < 0 ? -xl : xl) > (xr < 0 ? -xr : xr) ? xl : xr;
          const e1 = fA.tick(a), e2 = sA.tick(a), e3 = fS.tick(a), e4 = sS.tick(a);
          const dA = DB * Math.log((e1 + 1e-5) / (e2 + 1e-5)), dS = DB * Math.log((e3 + 1e-5) / (e4 + 1e-5));
          let gdb = att * 0.9 * dsp.clamp(dA, 0, 16) + sus * 0.8 * dsp.clamp(dS, 0, 20);
          gdb = gdb < -18 ? -18 : gdb > 14 ? 14 : gdb;
          const gn = gs.tick(Math.exp(gdb * LN)) * out.tick(o);
          const yl = dl.read(LA), yr = dr.read(LA);
          dl.write(xl); dr.write(xr);
          L[i] = knee(yl * gn); R[i] = knee(yr * gn);
        }
      },
    };
  },
})`,
};
