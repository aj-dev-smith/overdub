// @ts-check
// The kit room: a small live room for a drum kit, as kernel source that a kit and a drum bus interpolate into their
// own kernels (Rusty Sticks sends each piece into it; Drum Riser puts the whole kit through it in parallel). It is not
// a `dsp` name, so it can be tuned without touching the forever list; a change to it moves both devices' sound (and
// their golden scenes), as any device change does.
//
//   kitRoom(sr, seed)   -> { set(size), tick(x), l, r }   mono in, stereo out (.l, .r after each tick)
//
// What it is: a high-pass at 150 Hz (two one-poles: a kit's lows stay dry and centred), two allpass diffusers, eight
// early reflections spread left and right (5 to 32 ms, the walls of a room about 5 by 7 metres), then an 8-line
// feedback delay network in Stairwell's family (Householder mixing, a damping low-pass in every loop, line lengths
// that scale with the room). SIZE (0 to 1) runs the room from a tight booth to a big live room: the lines from 0.7x
// to 1.5x and the decay (T60) from 0.5 s to 1.4 s, the damping from 7 kHz down to 4 kHz. The size glides over about
// 80 ms (the lines are read with linear interpolation), so turning it never clicks. The output is mono below 150 Hz:
// its side is high-passed there. Plain arithmetic, allocation-free per sample, and deterministic.
export const KITROOM = String.raw`
function kitRoom(sr, seed) {
  const k = sr / 48000;
  const BASE = [601, 683, 787, 863, 971, 1063, 1181, 1291];
  const ER = [[5.3, 0.62, 0], [7.9, 0.55, 1], [11.2, 0.47, 0], [13.7, 0.43, 1], [17.9, 0.35, 0], [21.4, 0.31, 1], [26.1, 0.25, 0], [31.7, 0.21, 1]];
  let N = 1; while (N < Math.ceil(1291 * 1.5 * k) + 8) N <<= 1;
  const M = N - 1, D = new Float64Array(8 * N);
  let EN = 1; while (EN < Math.ceil(0.033 * sr) + 4) EN <<= 1;
  const EM = EN - 1, EB = new Float64Array(EN), ET = ER.map(([ms]) => Math.round(ms * 0.001 * sr));
  const AL = [Math.round(113 * k), Math.round(337 * k)], AB = [new Float64Array(AL[0]), new Float64Array(AL[1])], AI = [0, 0];
  const z = new Float64Array(8), g = new Float64Array(8), vv = new Float64Array(8);
  const aH = 1 - Math.exp(-2 * Math.PI * 150 / sr);
  let w = 0, e = 0, h1 = 0, h2 = 0, s1 = 0, s2 = 0, scale = 1, target = 1, da = 0.5;
  const sg = 1 - Math.exp(-1 / (0.08 * sr));
  const self = {
    l: 0, r: 0,
    set(size) {
      const s = size < 0 ? 0 : size > 1 ? 1 : size, t60 = 0.5 + 0.9 * s;
      target = 0.7 + 0.8 * s;
      for (let i = 0; i < 8; i++) g[i] = Math.pow(10, -3 * BASE[i] * k * target / (t60 * sr));
      da = 1 - Math.exp(-2 * Math.PI * (7000 - 3000 * s) / sr);
      return self;
    },
    tick(x) {
      scale += (target - scale) * sg;
      // the lows out (they stay dry), then the diffusers
      h1 += aH * (x - h1); const y1 = x - h1; h2 += aH * (y1 - h2); let u = y1 - h2;
      for (let j = 0; j < 2; j++) { const b = AB[j], i = AI[j], d = b[i], v = u + 0.6 * d; b[i] = v; u = d - 0.6 * v; AI[j] = i + 1 >= AL[j] ? 0 : i + 1; }
      // the early reflections
      EB[e & EM] = u;
      let el = 0, er = 0;
      for (let j = 0; j < 8; j++) { const v = EB[(e - ET[j]) & EM] * ER[j][1]; if (ER[j][2]) er += v; else el += v; }
      e++;
      // the network
      let sum = 0, yl = 0, yr = 0;
      for (let i = 0; i < 8; i++) {
        const p = w - BASE[i] * k * scale, ip = Math.floor(p), f = p - ip, o = i * N;
        const a = D[o + (ip & M)], b = D[o + ((ip + 1) & M)], y = a + (b - a) * f;
        if (i & 1) yr += (i & 2 ? -y : y); else yl += (i & 4 ? -y : y);
        z[i] += da * (y - z[i]);
        const v = z[i] * g[i]; vv[i] = v; sum += v;
      }
      sum *= 0.25;
      const fi = (el + er) * 0.5 + u * 0.3;
      for (let i = 0; i < 8; i++) D[i * N + (w & M)] = vv[i] - sum + (i & 1 ? -fi : fi);
      w++;
      // mono under 150 Hz: the side high-passed there
      const L = el + yl * 0.5, R = er + yr * 0.5, m = (L + R) * 0.5;
      let sd = (L - R) * 0.5; s1 += aH * (sd - s1); sd -= s1; s2 += aH * (sd - s2); sd -= s2;
      self.l = m + sd; self.r = m - sd;
      return self.l;
    },
  };
  return self.set(0.5);
}
`;
