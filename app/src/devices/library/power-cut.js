// @ts-check
// claude.power-cut: Power Cut. The tape stop: the last LENGTH beats of every cycle (one, two or four bars of four),
// the output is read from a buffer at a speed that falls from 1 to 0 (CURVE: a long slow wind-down or a sudden
// brake), so the pitch and the level sink together; the next cycle starts live again with a short crossfade. NOW
// pulls the plug and keeps it pulled (automate it). It follows the song's beat while playing.
export default {
  id: 'claude.power-cut', name: 'Power Cut', kind: 'effect', cat: 'glitch', by: 'claude', version: 1,
  blurb: 'A tape stop at the end of every few bars',
  nod: 'pulling the plug on a reel-to-reel mid-song',
  request: 'Can the track do a tape-stop at the end of every few bars, like someone pulled the plug?',
  params: [
    { key: 'when', label: 'WHEN', opts: ['OFF', 'EVERY BAR', 'EVERY 2', 'EVERY 4', 'NOW'], def: 3, role: 'rate', desc: 'how often it stops (bars of four), or now' },
    { key: 'length', label: 'BEATS', min: 0.25, max: 4, def: 1, curve: 'log', role: 'time', desc: 'how many beats the stop takes' },
    { key: 'curve', label: 'CURVE', min: 0, max: 1, def: 0.4, role: 'shape', desc: 'a long slow wind-down (0) or a sudden brake (1)' },
  ],
  look: { color: '#c23b22', ink: '#fff2e6', shape: 'mini', finish: 'hammer', knob: 'chicken', label: 'stencil', led: '#ffe14d' },
  tail: 0.1,
  demo: { params: { when: 1 } },
  kernel: `({
  create({ sr, seed, dsp }) {
    const MAX = Math.round(sr * 8);
    const bl = dsp.delay(MAX), br = dsp.delay(MAX);
    const CYCLE = [0, 4, 8, 16, -1];                      // beats per cycle; -1: now, and stay stopped
    const XF = 1 / (0.004 * sr);
    let pos = 0, d = 2, xf = 0, was = false, held = 0;
    return {
      process(L, R, n, p, t) {
        const bpm = t && t.bpm > 0 ? t.bpm : 120;
        if (t && t.playing) pos = t.beat;
        const inc = bpm / 60 / sr, cyc = CYCLE[p.when | 0];
        const len = cyc > 0 ? Math.min(p.length, cyc * 0.75) : p.length;
        const ex = 0.5 + 2.5 * p.curve, lenS = (len * 60 / bpm) * sr;
        for (let i = 0; i < n; i++) {
          let braking = false, pr = 0;
          if (cyc > 0) {
            const local = pos - Math.floor(pos / cyc) * cyc, st = cyc - len;
            if (local >= st) { braking = true; pr = (local - st) / len; }
            held = 0;
          } else if (cyc < 0) { braking = true; held += 1 / lenS; pr = held < 1 ? held : 1; }
          else held = 0;
          if (braking && !was) d = 2;                       // a new stop starts from the live tape
          was = braking;
          const rate = braking ? Math.pow(1 - (pr < 1 ? pr : 1), ex) : 1;
          const tgt = braking ? 1 : 0;
          xf += tgt > xf ? Math.min(XF, tgt - xf) : -Math.min(XF, xf - tgt);
          const xl = L[i], xr = R[i];
          let yl = xl, yr = xr;
          if (xf > 0) {
            const dd = d < MAX - 8 ? d : MAX - 8;
            const lvl = dsp.sstep(Math.min(1, rate * 2.5));   // the level sinks with the motor
            const tl = bl.cubic(dd) * lvl, tr = br.cubic(dd) * lvl;
            yl = xl + (tl - xl) * xf; yr = xr + (tr - xr) * xf;
          }
          bl.write(xl); br.write(xr);
          if (braking) d += 1 - rate;
          L[i] = yl; R[i] = yr;
          pos += inc;
        }
      },
    };
  },
})`,
};
