// claude.choir-loft: Choir Loft. Each note is three sawtooth "singers" a few cents apart, with their own slow drift,
// a vibrato that arrives after the note settles, and a breath of noise. The summed voices go through one bank of four
// vowel formants (alto: ooh, oh, aah, eh, ee, morphed continuously), then a stone room at the back of the church.
// The formants are linear, so filtering the sum sounds the same as filtering each voice, for a tenth of the cost.
export default {
  id: 'claude.choir-loft', name: 'Choir Loft', kind: 'instrument', cat: 'synth', by: 'claude', version: 1,
  blurb: 'A soft choir singing vowels from the back of the church',
  nod: 'a vocal-ensemble pad: sawtooth singers through vowel formants',
  request: "Can I get a choir singing 'aah' softly under the chorus, like it's coming from the back of a church?",
  params: [
    { key: 'vowel', label: 'VOWEL', min: 0, max: 1, def: 0.5, role: 'shape', desc: 'what they sing: ooh, oh, aah (the middle), eh, ee' },
    { key: 'singers', label: 'SINGERS', min: 0, max: 1, def: 0.5, role: 'width', desc: 'one voice to a full loft: more detune and spread' },
    { key: 'breath', label: 'BREATH', min: 0, max: 1, def: 0.3, role: 'tone', desc: 'air in the voices' },
    { key: 'attack', label: 'SWELL', min: 0.01, max: 4, def: 0.4, curve: 'log', unit: 's', role: 'attack', desc: 'how slowly each note swells in' },
    { key: 'release', label: 'RELEASE', min: 0.05, max: 6, def: 1.4, curve: 'log', unit: 's', role: 'release', desc: 'how long a note hangs after you let go' },
    { key: 'space', label: 'LOFT', min: 0, max: 1, def: 0.4, role: 'mix', desc: 'how far back in the church they stand' },
  ],
  look: { color: '#3e3354', ink: '#f3e8ff', shape: 'wide', finish: 'brushed', knob: 'cream', label: 'script', led: '#cfb2ff' },
  tail: 8,
  kernel: `({
  poly: 10,
  create({ sr, seed, dsp }) {
    // ooh, oh, aah, eh, ee: four formants each (Hz), their levels (dB) and bandwidths (Hz)
    const VF = [[325, 700, 2530, 3500], [450, 800, 2830, 3500], [800, 1150, 2800, 3500], [400, 1600, 2700, 3300], [350, 1700, 2700, 3700]];
    const VG = [[0, -12, -26, -34], [0, -9, -16, -26], [0, -4, -18, -30], [0, -16, -22, -28], [0, -14, -22, -28]];
    const VB = [[50, 60, 170, 180], [70, 80, 100, 130], [80, 90, 120, 130], [60, 80, 120, 150], [50, 100, 120, 150]];
    const fL = [dsp.svf(), dsp.svf(), dsp.svf(), dsp.svf()], fR = [dsp.svf(), dsp.svf(), dsp.svf(), dsp.svf()];
    const g = new Float64Array(4);
    const room = dsp.fdn(0.8, 3.4, 0.55, seed);
    const hpL = dsp.onepole(180), hpR = dsp.onepole(180);
    const sp = dsp.smooth(40, 0.4);
    const OUT = 2.4;
    let vowel = -1;
    // a soft ceiling: exactly linear to -6 dBFS, never past -1.9 dBFS
    const knee = (x) => { const a = x < 0 ? -x : x; if (a <= 0.5) return x; const y = 0.5 + 0.3 * dsp.tanh((a - 0.5) / 0.3); return x < 0 ? -y : y; };
    return {
      voice(i) {
        const s0 = dsp.osc('saw'), s1 = dsp.osc('saw'), s2 = dsp.osc('saw');
        const d0 = dsp.lfo('drift', 0.41, seed + i * 13 + 1), d1 = dsp.lfo('drift', 0.33, seed + i * 13 + 2), d2 = dsp.lfo('drift', 0.47, seed + i * 13 + 3);
        const vib = dsp.lfo('sine', 5.1 + 0.07 * i, seed + i);
        const air = dsp.noise(seed + 101 + i, 'white');
        const env = dsp.adsr(0.4, 0.6, 0.9, 1.4);
        let f0 = 440, vel = 0.8, age = 0, cnt = 0, v0 = 0, v1 = 0, v2 = 0, vv = 0;
        return {
          start(pitch, v, p) {
            f0 = dsp.mtof(pitch); vel = v; age = 0; cnt = 0;
            s0.reset((i * 0.37) % 1); s1.reset((i * 0.37 + 0.29) % 1); s2.reset((i * 0.37 + 0.61) % 1);
            env.set(p.attack, 0.6, 0.9, p.release); env.gate(true);
          },
          release(p) { env.set(p.attack, 0.6, 0.9, p.release); env.gate(false); },
          render(L, R, n, p) {
            env.set(p.attack, 0.6, 0.9, p.release);
            const det = (3 + 21 * p.singers) / 1200, side = 1 - (0.15 + 0.85 * p.singers);
            const gv = 0.2 * (0.45 + 0.55 * vel), br = 0.7 * p.breath * p.breath;
            for (let j = 0; j < n; j++) {
              v0 = d0.next(); v1 = d1.next(); v2 = d2.next(); vv = vib.next();
              if ((cnt++ & 15) === 0) {
                // the vibrato arrives once the note has settled (over its first 0.7 s)
                const vd = Math.min(1, age / (0.7 * sr)) * 0.16 * vv / 12;
                s0.freq(f0 * Math.pow(2, -det + 0.0007 * v0 + vd));
                s1.freq(f0 * Math.pow(2, 0.0007 * v1 + vd));
                s2.freq(f0 * Math.pow(2, det + 0.0007 * v2 + vd));
              }
              const a = s0.next(), b = s1.next(), c = s2.next(), e = env.next() * gv;
              const h = air.next() * br;
              L[j] += (a + 0.7 * b + side * c + h) * e;
              R[j] += (c + 0.7 * b + side * a + h) * e;
            }
            age += n;
            return env.active();
          },
        };
      },
      process(L, R, n, p) {
        if (p.vowel !== vowel) {
          vowel = p.vowel;
          const pos = dsp.clamp(vowel, 0, 1) * 4, i0 = Math.min(3, Math.floor(pos)), fr = pos - i0;
          for (let k = 0; k < 4; k++) {
            const f = VF[i0][k] * Math.pow(VF[i0 + 1][k] / VF[i0][k], fr);
            const bw = 1.5 * dsp.lerp(VB[i0][k], VB[i0 + 1][k], fr);   // a loft of singers smears the formants
            fL[k].set(f, f / bw); fR[k].set(f, f / bw);
            g[k] = dsp.dB(dsp.lerp(VG[i0][k], VG[i0 + 1][k], fr));
          }
        }
        for (let j = 0; j < n; j++) {
          const xl = L[j], xr = R[j];
          let yl = 0, yr = 0;
          for (let k = 0; k < 4; k++) { yl += g[k] * fL[k].bp(xl); yr += g[k] * fR[k].bp(xr); }
          room.tick(hpL.hp(yl), hpR.hp(yr));
          const s = sp.tick(p.space), dry = 1 - 0.45 * s, wet = 1.1 * s;
          L[j] = knee(OUT * (yl * dry + room.l * wet));
          R[j] = knee(OUT * (yr * dry + room.r * wet));
        }
      },
    };
  },
})`,
};
