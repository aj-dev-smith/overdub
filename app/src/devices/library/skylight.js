// @ts-check
// claude.skylight: Skylight. A shimmer reverb: a large modulated room (an 8-line FDN) whose wet signal is pitched up
// an octave (or a fifth) by a two-tap delay-line shifter and fed back into the room, so each echo climbs and the tail
// glows above the note. The loop is high-passed, darkened and soft-limited, so it climbs, fades, and never runs away.
export default {
  id: 'claude.skylight', name: 'Skylight', kind: 'effect', cat: 'ambient', by: 'claude', version: 1,
  blurb: 'A huge reverb whose tail glows an octave up',
  nod: 'the octave-up shimmer reverbs of ambient guitar',
  request: 'A huge reverb with that shimmery octave-up glow, like light coming in from above.',
  params: [
    { key: 'shimmer', label: 'SHIMMER', min: 0, max: 1, def: 0.45, role: 'depth', desc: 'how much of the tail climbs up' },
    { key: 'interval', label: 'UP', opts: ['OCTAVE', 'FIFTH'], def: 0, role: 'pitch', desc: 'what the shimmer climbs by' },
    { key: 'decay', label: 'DECAY', min: 1, max: 12, def: 5, curve: 'log', unit: 's', role: 'decay', desc: 'how long the room rings' },
    { key: 'tone', label: 'TONE', min: 0, max: 1, def: 0.55, role: 'tone', desc: 'dark and soft to bright and airy' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 0.35, role: 'mix', desc: 'how much of the room you hear' },
  ],
  look: { color: '#dfe8f2', ink: '#24324a', shape: 'wide', finish: 'sparkle', knob: 'chrome', label: 'plate', led: '#8fd3ff' },
  tail: 10,
  trails: true,
  kernel: `({
  create({ sr, seed, dsp }) {
    const verb = dsp.fdn(0.85, 5, 0.45, seed);
    const W = Math.round(sr * 0.05);                       // the shifter's window
    const psL = dsp.delay(W + 16), psR = dsp.delay(W + 16);
    const PRE = Math.round(sr * 0.025), preL = dsp.delay(PRE + 8), preR = dsp.delay(PRE + 8);
    const loL = dsp.onepole(300), loR = dsp.onepole(300), hiL = dsp.svf(), hiR = dsp.svf(), wetL = dsp.svf(), wetR = dsp.svf();
    const sh = dsp.smooth(40, 0.45), gw = dsp.smooth(40, 0.35);
    let ph = 0, fbL = 0, fbR = 0, decay = -1, tone = -1;
    return {
      process(L, R, n, p) {
        if (p.decay !== decay || p.tone !== tone) {
          decay = p.decay; tone = p.tone;
          verb.set(0.9, decay, 0.7 - 0.5 * tone);
          const fc = 2500 * Math.pow(4, tone);
          hiL.set(fc, 0.6); hiR.set(fc, 0.6);
          wetL.set(fc * 1.6, 0.6); wetR.set(fc * 1.6, 0.6);
        }
        const step = ((p.interval | 0) === 1 ? 0.5 : 1) / W;   // the read head runs 1.5x or 2x as fast as the tape
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          const s = sh.tick(p.shimmer), w = gw.tick(p.mix);
          const al = preL.read(PRE), ar = preR.read(PRE);
          preL.write(xl); preR.write(xr);
          verb.tick(al + fbL, ar + fbR);
          const vl = verb.l, vr = verb.r;
          // the shifter: two taps half a window apart, each faded in and out with a raised cosine
          ph += step; if (ph >= 1) ph -= 1;
          const ph2 = ph < 0.5 ? ph + 0.5 : ph - 0.5;
          const w1 = 0.5 - 0.5 * Math.cos(dsp.TAU * ph), w2 = 1 - w1;
          const d1 = 2 + W * (1 - ph), d2 = 2 + W * (1 - ph2);
          const ul = psL.read(d1) * w1 + psL.read(d2) * w2, ur = psR.read(d1) * w1 + psR.read(d2) * w2;
          psL.write(vl); psR.write(vr);
          fbL = dsp.tanh(hiL.lp(loL.hp(ul)) * 0.55 * s);
          fbR = dsp.tanh(hiR.lp(loR.hp(ur)) * 0.55 * s);
          const yl = wetL.lp(vl + 0.6 * s * ul), yr = wetR.lp(vr + 0.6 * s * ur);
          L[i] = xl * (1 - 0.35 * w) + yl * 1.15 * w;
          R[i] = xr * (1 - 0.35 * w) + yr * 1.15 * w;
        }
      },
    };
  },
})`,
};
