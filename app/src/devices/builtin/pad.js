// @ts-check
// core.pad: Room Tone. Lush and slow: per voice three saws a few cents apart spread left / centre / right and a soft
// triangle an octave down, through a low-pass that breathes on its own slow, seeded wander (MOTION), under a slow
// attack and a long release. Then a stereo chorus and a built-in space (the same smooth feedback-delay-network room
// as Stairwell), so it is lush straight out of the box. About -17 LUFS on the test phrase at defaults.
import { defineDevice } from '../registry.js';
import { kernel } from './lib.js';

export default defineDevice({
  id: 'core.pad', name: 'Room Tone', kind: 'instrument', cat: 'synth', by: 'overdub',
  blurb: 'Slow, wide, warm pads that swell and breathe',
  nod: 'a classic string-machine / analog pad with ensemble chorus',
  params: [
    { key: 'tone', label: 'TONE', min: 200, max: 12000, def: 2200, curve: 'log', unit: 'Hz', role: 'tone', desc: 'dark and felted to airy' },
    { key: 'detune', label: 'DETUNE', min: 0, max: 40, def: 14, unit: 'ct', role: 'width', desc: 'how far apart the saws drift: thicker' },
    { key: 'motion', label: 'MOTION', min: 0, max: 1, def: 0.35, role: 'depth', desc: 'the filter breathing on its own' },
    { key: 'attack', label: 'ATTACK', min: 0.005, max: 6, def: 0.7, curve: 'log', unit: 's', role: 'attack', desc: 'how slowly it blooms' },
    { key: 'release', label: 'RELEASE', min: 0.05, max: 8, def: 1.8, curve: 'log', unit: 's', role: 'release', desc: 'how long it lingers' },
    { key: 'chorus', label: 'CHORUS', min: 0, max: 1, def: 0.5, role: 'depth', desc: 'ensemble shimmer' },
    { key: 'space', label: 'SPACE', min: 0, max: 1, def: 0.35, role: 'mix', desc: 'how much room around it' },
  ],
  look: { color: '#3c4f45', ink: '#e6f2e4', shape: 'wide', finish: 'brushed', knob: 'cream', label: 'script', led: '#a7e3b5' },
  tail: 10,
  kernel: kernel(String.raw`
// THE COST. A voice is a class (one render() V8 compiles once, where closures were a copy per voice) that works in
// locals, written back once a block: a number kept in a closure is boxed on the heap, a new box at every store, every
// sample. Its envelope and filters are lib.js's adsr and svf, op for op, inlined; the space is lib.js's fdn and svf the
// same way, and its equal-power mix is worked out again only when SPACE moves. Every sum and product is in its old
// order, so the sound is bit for bit what it was (tools/golden.json, inst:core.pad and the demo songs).
class Voice {
  constructor(sr, r) {
    this.sr = sr;
    this.dr0 = r() * 2; this.dr1 = r() * 2; this.dr2 = r() * 2;
    this.ph0 = (r() + 1) / 2; this.ph1 = (r() + 1) / 2; this.ph2 = (r() + 1) / 2; this.ph3 = (r() + 1) / 2;
    this.dt0 = 0; this.dt1 = 0; this.dt2 = 0; this.dt3 = 0;
    this.vph = 0; this.vel = 0.7; this.pitch = 60; this.cnt = 0; this.lph = (r() + 1) / 2; this.ldt = (0.07 + 0.05 * (r() + 1)) / sr; this.wob = 0; this.wobT = 0;
    this.ws = (((r() * 1e9) | 0) >>> 0) || 0x9e3779b9; // (lib.js rng, written out)
    // the envelope (lib.js adsr)
    this.st = 0; this.v = 0; this.ka = 0; this.kd = 0; this.kr = 0; this.s = 1; this.lastA = -1; this.lastD = -1; this.lastR = -1;
    // the filters (lib.js svf, q 0.8): state and coefficients, left and right
    this.l1 = 0; this.l2 = 0; this.la1 = 1; this.la2 = 0; this.la3 = 0;
    this.r1 = 0; this.r2 = 0; this.ra1 = 1; this.ra2 = 0; this.ra3 = 0;
  }
  aset(a, d, sus, r) {
    const sr = this.sr;
    if (a !== this.lastA) { this.ka = 1 - coef(Math.max(0.0005, a) / 1.2, sr); this.lastA = a; }
    if (d !== this.lastD) { this.kd = coef(Math.max(0.001, d) / 4, sr); this.lastD = d; }
    if (r !== this.lastR) { this.kr = coef(Math.max(0.002, r) / 4, sr); this.lastR = r; }
    this.s = sus;
  }
  start(p, v, P) { this.vel = v; this.pitch = p; this.aset(P.attack, 1.5, 0.82, P.release); this.st = 1; }
  release(P) { this.aset(P.attack, 1.5, 0.82, P.release); if (this.st) this.st = 4; }
  render(L, R, n, P, T) {
    this.aset(P.attack, 1.5, 0.82, P.release);
    const sr = this.sr, vel = this.vel, pitch = this.pitch;
    const det = P.detune / 100, mo = P.motion, g = 0.13 * (0.45 + 0.55 * vel), tone = P.tone;
    // expression: the bend wheel (semitones) and the mod wheel's vibrato (up to 35 cents at 5.5 Hz)
    let bx = 0;
    if (T && (T.bend || T.mod > 0)) { if (T.mod > 0) { this.vph += n * 5.5 / sr; if (this.vph >= 1) this.vph -= 1; } bx = T.bend + T.mod * 0.35 * sinT(this.vph); }
    const pb = bx !== 0 ? pitch + bx : pitch;
    const dr0 = this.dr0, dr1 = this.dr1, dr2 = this.dr2, ldt = this.ldt, ka = this.ka, kd = this.kd, kr = this.kr, sus = this.s;
    let ph0 = this.ph0, ph1 = this.ph1, ph2 = this.ph2, ph3 = this.ph3, dt0 = this.dt0, dt1 = this.dt1, dt2 = this.dt2, dt3 = this.dt3;
    let cnt = this.cnt, lph = this.lph, wob = this.wob, wobT = this.wobT, ws = this.ws, st = this.st, ev = this.v;
    let l1 = this.l1, l2 = this.l2, la1 = this.la1, la2 = this.la2, la3 = this.la3, r1 = this.r1, r2 = this.r2, ra1 = this.ra1, ra2 = this.ra2, ra3 = this.ra3;
    for (let i = 0; i < n; i++) {
      if ((cnt++ & 15) === 0) {
        dt0 = mtof(pb + (0 - 1) * det + dr0 * 0.02) / sr;
        dt1 = mtof(pb + (1 - 1) * det + dr1 * 0.02) / sr;
        dt2 = mtof(pb + (2 - 1) * det + dr2 * 0.02) / sr;
        dt3 = mtof(pb - 12) / sr;
        // the breath: a slow sine plus a seeded wander
        lph += ldt * 16; if (lph >= 1) lph -= 1;
        if ((cnt & 4095) < 16) { ws = (Math.imul(ws, 1664525) + 1013904223) >>> 0; wobT = (ws / 4294967296) * 2 - 1; }
        wob += (wobT - wob) * 0.002;
        const fc = tone * Math.pow(2, mo * (1.2 * sinT(lph) + 0.8 * wob) + (pitch - 60) / 36 + (vel - 0.7) * 0.8);
        let gg = Math.tan(Math.PI * clamp(fc, 5, sr * 0.49) / sr);
        la1 = 1 / (1 + gg * (gg + 1 / 0.8)); la2 = gg * la1; la3 = gg * la2;
        gg = Math.tan(Math.PI * clamp(fc * 1.04, 5, sr * 0.49) / sr);
        ra1 = 1 / (1 + gg * (gg + 1 / 0.8)); ra2 = gg * ra1; ra3 = gg * ra2;
      }
      let p = ph0 + dt0; if (p >= 1) p -= 1; ph0 = p;
      const s0 = 2 * p - 1 - blep(p, dt0);
      p = ph1 + dt1; if (p >= 1) p -= 1; ph1 = p;
      const s1 = 2 * p - 1 - blep(p, dt1);
      p = ph2 + dt2; if (p >= 1) p -= 1; ph2 = p;
      const s2 = 2 * p - 1 - blep(p, dt2);
      let q = ph3 + dt3; if (q >= 1) q -= 1; ph3 = q;
      const tri = (q < 0.5 ? 4 * q - 1 : 3 - 4 * q) * 0.55;
      if (st === 1) { ev += (1.3 - ev) * ka; if (ev >= 1) { ev = 1; st = 2; } }
      else if (st === 2) { ev = sus + (ev - sus) * kd; }
      else if (st === 4) { ev *= kr; if (ev < 1e-5) { ev = 0; st = 0; } }
      const e = ev * g;
      let x = s0 + 0.7 * s1 + tri, v3 = x - l2, v1 = la1 * l1 + la2 * v3, v2 = l2 + la2 * l1 + la3 * v3;
      l1 = 2 * v1 - l1; l2 = 2 * v2 - l2;
      const yl = v2;
      x = s2 + 0.7 * s1 + tri; v3 = x - r2; v1 = ra1 * r1 + ra2 * v3; v2 = r2 + ra2 * r1 + ra3 * v3;
      r1 = 2 * v1 - r1; r2 = 2 * v2 - r2;
      L[i] += yl * e; R[i] += v2 * e;
    }
    this.ph0 = ph0; this.ph1 = ph1; this.ph2 = ph2; this.ph3 = ph3; this.dt0 = dt0; this.dt1 = dt1; this.dt2 = dt2; this.dt3 = dt3;
    this.cnt = cnt; this.lph = lph; this.wob = wob; this.wobT = wobT; this.ws = ws; this.st = st; this.v = ev;
    this.l1 = l1; this.l2 = l2; this.la1 = la1; this.la2 = la2; this.la3 = la3; this.r1 = r1; this.r2 = r2; this.ra1 = ra1; this.ra2 = ra2; this.ra3 = ra3;
    return st !== 0;
  }
}
return {
  poly: 12,
  create({ sr, seed }) {
    const r = rng(seed ^ 0x10a3);
    // the chorus (two wandering taps per side): lib.js delayLine's cubic read, two rings sharing a write head
    let CN = 1; while (CN < Math.ceil(0.04 * sr) + 4) CN <<= 1;
    const CM = CN - 1, cl = new Float32Array(CN), cr = new Float32Array(CN);
    let cw = 0, cph = 0;
    const cubic = (buf, d) => {
      const rr = cw - d, i = Math.floor(rr), f = rr - i;
      const y0 = buf[(i - 1) & CM], y1 = buf[i & CM], y2 = buf[(i + 1) & CM], y3 = buf[(i + 2) & CM];
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      return ((c3 * f + c2) * f + c1) * f + y1;
    };
    // the space: lib.js fdn(sr, seed ^ 0x77) at size 0.75, 3.2 s, damp 0.55, its 8 lines in one buffer
    const N = 8, BASE = [1031, 1327, 1523, 1801, 2111, 2437, 2741, 3089], k = sr / 48000, rr = rng((seed ^ 0x77) ^ 0xf00d);
    let LN = 1; while (LN < Math.ceil(BASE[N - 1] * 1.8 * k) + 64 + 4) LN <<= 1;
    const LM = LN - 1, lines = new Float32Array(N * LN);
    const len = new Float64Array(N), gn = new Float64Array(N), lp = new Float64Array(N), x = new Float64Array(N), mph = new Float64Array(N), mdt = new Float64Array(N);
    for (let i = 0; i < N; i++) { mph[i] = (rr() + 1) / 2; mdt[i] = (0.07 + 0.11 * i / N + 0.03 * rr()) / sr; }
    let da, depth, lw = 0;
    { const size = 0.75, t60 = 3.2, damp = 0.55, sc = (0.3 + 1.45 * clamp(size, 0, 1)) * k;
      for (let i = 0; i < N; i++) { len[i] = BASE[i] * sc; gn[i] = Math.pow(10, -3 * len[i] / (Math.max(0.05, t60) * sr)); }
      da = Math.exp(-TAU * (16000 * Math.pow(0.05, clamp(damp, 0, 1))) / sr);
      depth = (3 + 9 * clamp(size, 0, 1)) * k; }
    // its low cut (lib.js svf at 180 Hz, q 0.6: the high pass), both sides
    const hg = Math.tan(Math.PI * clamp(180, 5, sr * 0.49) / sr), hk = 1 / Math.max(0.05, 0.6), ha1 = 1 / (1 + hg * (hg + hk)), ha2 = hg * ha1, ha3 = hg * ha2;
    let hl1 = 0, hl2 = 0, hr1 = 0, hr2 = 0;
    // the glides (lib.js glide, 40 ms)
    const gA = coef(40 / 1000, sr);
    let cY = 0, cF = true, sY = 0, sF = true, lastSp = NaN, dry = 1, wet = 0;
    return {
      voice() { return new Voice(sr, r); },
      process(L, R, n, P) {
        const base = 0.012 * sr, dep = 0.0035 * sr, chT = P.chorus, spT = P.space;
        for (let i = 0; i < n; i++) {
          const xl = L[i], xr = R[i];
          cph += 0.31 / sr; if (cph >= 1) cph -= 1;
          if (cF) { cY = chT; cF = false; }
          const c = (cY = chT + (cY - chT) * gA);
          const a = cubic(cl, base + dep * (1 + sinT(cph))), b = cubic(cr, base + dep * (1 + sinT((cph + 0.25) % 1)));
          const a2 = cubic(cr, base * 1.37 + dep * (1 + sinT((cph + 0.5) % 1))), b2 = cubic(cl, base * 1.29 + dep * (1 + sinT((cph + 0.75) % 1)));
          cl[cw] = xl; cr[cw] = xr; cw = (cw + 1) & CM;
          let l = xl * (1 - 0.3 * c) + (a + a2) * 0.42 * c, rt = xr * (1 - 0.3 * c) + (b + b2) * 0.42 * c;
          // the space (fdn.tick)
          const inL = l * 0.5, inR = rt * 0.5;
          let sum = 0;
          for (let li = 0; li < N; li++) {
            let p = mph[li] + mdt[li]; if (p >= 1) p -= 1; mph[li] = p;
            const rd = lw - (len[li] + depth * (1 + sinT(p))), q = Math.floor(rd), f = rd - q, o = li * LN;
            const y0 = lines[o + ((q - 1) & LM)], y1 = lines[o + (q & LM)], y2 = lines[o + ((q + 1) & LM)], y3 = lines[o + ((q + 2) & LM)];
            const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            const v = ((c3 * f + c2) * f + c1) * f + y1;
            const lv = v + (lp[li] - v) * da; lp[li] = lv;
            const xv = lv * gn[li]; x[li] = xv; sum += xv;
          }
          sum *= 2 / N;
          for (let li = 0; li < N; li++) lines[li * LN + lw] = x[li] - sum + ((li & 1) ? inR : inL);
          lw = (lw + 1) & LM;
          const nl = x[0] - x[2] + x[4] - x[6] + 0.5 * (x[1] - x[5]);
          const nr = x[1] - x[3] + x[5] - x[7] + 0.5 * (x[2] - x[6]);
          let v3 = nl - hl2, v1 = ha1 * hl1 + ha2 * v3, v2 = hl2 + ha2 * hl1 + ha3 * v3;
          hl1 = 2 * v1 - hl1; hl2 = 2 * v2 - hl2;
          const hpl = nl - hk * v1 - v2;
          v3 = nr - hr2; v1 = ha1 * hr1 + ha2 * v3; v2 = hr2 + ha2 * hr1 + ha3 * v3;
          hr1 = 2 * v1 - hr1; hr2 = 2 * v2 - hr2;
          const hpr = nr - hk * v1 - v2;
          if (sF) { sY = spT; sF = false; }
          const sp = (sY = spT + (sY - spT) * gA);
          if (sp !== lastSp) { lastSp = sp; dry = Math.cos(sp * Math.PI / 2 * 0.8); wet = Math.sin(sp * Math.PI / 2 * 0.8) * 0.9; }
          L[i] = knee((l * dry + hpl * wet) * 1.02); R[i] = knee((rt * dry + hpr * wet) * 1.02);
        }
      },
    };
  },
};
`),
});
