// claude.charity-shop: Charity Shop. A record that has been loved too much: the signal is narrowed toward mono, its
// band shrunk (WEAR: the low end thins and the top rolls off, with a little mid honk and soft saturation), warped by
// the slow once-per-turn pitch sway of a dished disc (WARP, 33 rpm), and laid over the needle's crackle and surface
// hiss (DUST, seeded, so the same pops land in the same places every render). The dry path is delayed to match.
export default {
  id: 'claude.charity-shop', name: 'Charity Shop', kind: 'effect', cat: 'mod', by: 'claude', version: 1,
  blurb: 'A dusty, warped record from the bargain bin',
  nod: 'a well-worn vinyl record on a cheap turntable',
  request: 'Make the whole beat sound like a dusty old record I found in a charity shop.',
  params: [
    { key: 'dust', label: 'DUST', min: 0, max: 1, def: 0.4, role: 'mix', desc: 'crackle and surface noise from the needle' },
    { key: 'wear', label: 'WEAR', min: 0, max: 1, def: 0.5, role: 'tone', desc: 'how worn the groove is: thinner and duller' },
    { key: 'warp', label: 'WARP', min: 0, max: 1, def: 0.3, role: 'depth', desc: 'the slow pitch sway of a warped disc' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 1, role: 'mix', desc: 'how much of the record you hear' },
  ],
  look: { color: '#5b4636', ink: '#ffe6c7', shape: 'round', finish: 'check', knob: 'cream', label: 'script', led: '#ff8f5a' },
  tail: 1.5,
  kernel: `({
  create({ sr, seed, dsp }) {
    const BASE = Math.round(sr * 0.003);
    const dl = dsp.delay(BASE * 2 + 16), dr = dsp.delay(BASE * 2 + 16);
    const warp = dsp.lfo('sine', 0.556, seed), wobble = dsp.lfo('drift', 0.9, seed + 1);
    const hpL = dsp.svf(), hpR = dsp.svf(), lpL = dsp.svf(), lpR = dsp.svf(), midL = dsp.svf(), midR = dsp.svf();
    const r = dsp.rng(seed + 2), hissL = dsp.noise(seed + 3, 'pink'), hissR = dsp.noise(seed + 4, 'pink');
    const popF = dsp.svf().set(2400, 0.6);
    const gm = dsp.smooth(30, 1), spin = dsp.smooth(400, 0);   // the platter comes up to speed
    const lvl = dsp.follower(5, 250);                           // the needle noise follows the music, so it stops when the music does
    let wear = -1, mk = 1, pop = 0, pan = 0, nz = 0;
    return {
      latency: BASE,
      process(L, R, n, p) {
        if (p.wear !== wear) {
          wear = p.wear;
          const lo = 30 + 140 * wear * wear, hi = 16000 * Math.pow(2800 / 16000, wear);
          hpL.set(lo, 0.6); hpR.set(lo, 0.6); lpL.set(hi, 0.75); lpR.set(hi, 0.75);
          midL.set(1300, 0.7, 3 * wear); midR.set(1300, 0.7, 3 * wear);
          mk = dsp.dB(1.6 * wear);
        }
        const A = sr * 0.0011 * p.warp, dens = (1.5 + 40 * p.dust * p.dust) / sr, popAmt = 0.6 * p.dust, hiss = 0.006 * p.dust;
        const narrow = 1 - 0.7 * wear;
        for (let i = 0; i < n; i++) {
          const d = BASE + A * spin.tick(1) * (warp.next() + 0.25 * wobble.next());
          const xl = L[i], xr = R[i];
          const e = lvl.tick(xl + xr);
          if ((i & 15) === 0) nz = dsp.clamp((dsp.toDb(e + 1e-9) + 60) / 25, 0, 1);
          const yl0 = dl.cubic(d), yr0 = dr.cubic(d), dxl = dl.read(BASE), dxr = dr.read(BASE);
          dl.write(xl); dr.write(xr);
          const m = 0.5 * (yl0 + yr0), s = 0.5 * (yl0 - yr0) * narrow;
          let yl = lpL.lp(hpL.hp(midL.bell(m + s))), yr = lpR.lp(hpR.hp(midR.bell(m - s)));
          yl = dsp.tanh(yl * 1.5) / 1.5; yr = dsp.tanh(yr * 1.5) / 1.5;
          // the needle
          if (r() < dens * nz) { pop = (r() < 0.5 ? -1 : 1) * popAmt * (0.15 + 0.85 * r() * r()); pan = 0.35 * r.bi(); }
          const c = popF.bp(pop); pop *= 0.35;
          const g = gm.tick(p.mix);
          L[i] = dxl + ((yl * mk + c * (1 - pan) + hissL.next() * hiss * nz) - dxl) * g;
          R[i] = dxr + ((yr * mk + c * (1 + pan) + hissR.next() * hiss * nz) - dxr) * g;
        }
      },
    };
  },
})`,
};
