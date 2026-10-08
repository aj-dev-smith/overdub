// @ts-check
// The built-ins' shared DSP, as kernel source. Each built-in kernel is `kernel(body)`: this prelude followed by the
// device's own body, wrapped into one expression. Built-ins carry their DSP with them (rather than leaning on every
// corner of kernel/dsp.js) so they stay exactly as measured whatever the stdlib grows into, and so an agent reading
// one to learn from (or forking it into "claude.my-verb") gets something that runs on its own.
//
// Everything here is plain, allocation-free per sample, and deterministic: randomness comes from rng(seed).

export const LIB = String.raw`
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const dbg = (d) => Math.pow(10, d / 20);
// soft clip: a rational tanh (exact enough, cheap, flat to +-1 beyond +-3)
const sat = (x) => (x <= -3 ? -1 : x >= 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x));
// a transparent safety for instrument outputs: exactly linear below 0.6 (-4.4 dBFS), then a smooth knee that
// never passes 0.88 (-1.1 dBFS) (only the odd transient of a big chord ever reaches it)
const knee = (x) => { const a = x < 0 ? -x : x; if (a <= 0.6) return x; const y = 0.6 + 0.28 * Math.tanh((a - 0.6) / 0.28); return x < 0 ? -y : y; };
// a seeded generator, -1..1 (a linear congruential one: plenty for noise, and the same every render)
function rng(seed) { let s = (seed >>> 0) || 0x9e3779b9; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
// polyBLEP: the band-limiting step for saws and pulses
const blep = (t, dt) => { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; };
// a 4096-point sine table, linearly interpolated (phase 0..1)
const SIN = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) SIN[i] = Math.sin((TAU * i) / 4096);
const sinT = (ph) => { const x = ph * 4096, i = x | 0, f = x - i, j = i & 4095; return SIN[j] + (SIN[j + 1] - SIN[j]) * f; };
// one-pole coefficient for a time constant in seconds
const coef = (sec, sr) => (sec <= 0 ? 0 : Math.exp(-1 / (sec * sr)));

// A per-sample smoother for a value that arrives once a block (gains, mixes): no zipper.
function glide(ms, sr, v0 = 0) {
  const a = coef(ms / 1000, sr); let y = v0, first = true;
  return { next(x) { if (first) { y = x; first = false; } return (y = x + (y - x) * a); }, get v() { return y; }, snap(x) { y = x; first = false; } };
}

// Topology-preserving state-variable filter (Zavalishin / Simper, trapezoidal). Stable under fast modulation.
// set(fc, q) then tick(x): lp, bp, hp (and the EQ outputs, via the m0/m1/m2 mixes of shelf() / bell()).
function svf(sr) {
  let ic1 = 0, ic2 = 0, k = 1, a1 = 1, a2 = 0, a3 = 0, m0 = 0, m1 = 0, m2 = 1;
  const f = {
    lp: 0, bp: 0, hp: 0,
    set(fc, q) { const g = Math.tan(Math.PI * clamp(fc, 5, sr * 0.49) / sr); k = 1 / Math.max(0.05, q); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; return f; },
    setG(g, q) { k = 1 / Math.max(0.05, q); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; return f; },
    tick(v0) {
      const v3 = v0 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      f.lp = v2; f.bp = v1; f.hp = v0 - k * v1 - v2;
      return v2;
    },
    // EQ shapes (Simper): out = m0*x + m1*bp + m2*lp
    shelfLo(fc, q, dbGain) { const A = Math.pow(10, dbGain / 40); f.setG(Math.tan(Math.PI * clamp(fc, 5, sr * 0.49) / sr) / Math.sqrt(A), q); m0 = 1; m1 = k * (A - 1); m2 = A * A - 1; return f; },
    shelfHi(fc, q, dbGain) { const A = Math.pow(10, dbGain / 40); f.setG(Math.tan(Math.PI * clamp(fc, 5, sr * 0.49) / sr) * Math.sqrt(A), q); m0 = A * A; m1 = k * (1 - A) * A; m2 = 1 - A * A; return f; },
    bell(fc, q, dbGain) { const A = Math.pow(10, dbGain / 40); f.setG(Math.tan(Math.PI * clamp(fc, 5, sr * 0.49) / sr), q * A); m0 = 1; m1 = k * (A * A - 1); m2 = 0; return f; },
    eq(x) { f.tick(x); return m0 * x + m1 * f.bp + m2 * f.lp; },
    reset() { ic1 = ic2 = 0; },
  };
  return f;
}

// One-pole low / high pass.
function onepole(sr) {
  let a = 0, y = 0;
  return { set(fc) { a = Math.exp(-TAU * clamp(fc, 1, sr * 0.49) / sr); return this; }, lp(x) { return (y = x + (y - x) * a); }, hp(x) { y = x + (y - x) * a; return x - y; }, reset() { y = 0; } };
}
// DC blocker (~10 Hz)
function dcblock(sr) { const R = Math.exp(-TAU * 10 / sr); let x1 = 0, y1 = 0; return (x) => { const y = x - x1 + R * y1; x1 = x; y1 = y; return y; }; }

// ADSR with analog-style curves. Attack heads for 1.3 and stops at 1 (a fast, slightly convex rise); decay and
// release are exponential. Retriggering starts the attack from wherever it is (no click). times in seconds.
function adsr(sr) {
  let st = 0, v = 0, ka = 0, kd = 0, kr = 0, s = 1, lastA = -1, lastD = -1, lastR = -1;
  const e = {
    get v() { return v; }, get stage() { return st; },
    gate(on) { if (on) st = 1; else if (st) st = 4; },
    kill() { st = 4; kr = coef(0.004, sr); },
    set(a, d, sus, r) {
      if (a !== lastA) { ka = 1 - coef(Math.max(0.0005, a) / 1.2, sr); lastA = a; }
      if (d !== lastD) { kd = coef(Math.max(0.001, d) / 4, sr); lastD = d; }
      if (r !== lastR) { kr = coef(Math.max(0.002, r) / 4, sr); lastR = r; }
      s = sus;
    },
    next() {
      if (st === 1) { v += (1.3 - v) * ka; if (v >= 1) { v = 1; st = 2; } }
      else if (st === 2) { v = s + (v - s) * kd; }
      else if (st === 4) { v *= kr; if (v < 1e-5) { v = 0; st = 0; } }
      return v;
    },
    active() { return st !== 0; },
  };
  return e;
}

// A fractional delay line (power-of-two ring, linear or cubic read).
function delayLine(maxSamples) {
  let n = 1; while (n < maxSamples + 4) n <<= 1;
  const buf = new Float32Array(n), mask = n - 1; let w = 0;
  return {
    write(x) { buf[w] = x; w = (w + 1) & mask; },
    // d samples ago (d >= 1)
    read(d) { const r = w - d, i = Math.floor(r), f = r - i, b = buf[i & mask]; return b + (buf[(i + 1) & mask] - b) * f; },
    cubic(d) {
      const r = w - d, i = Math.floor(r), f = r - i;
      const y0 = buf[(i - 1) & mask], y1 = buf[i & mask], y2 = buf[(i + 1) & mask], y3 = buf[(i + 2) & mask];
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      return ((c3 * f + c2) * f + c1) * f + y1;
    },
    tap(d) { return buf[(w - d) & mask]; },
    clear() { buf.fill(0); },
  };
}

// 2x oversampled waveshaper: a 31-tap Kaiser halfband up, fn() at 2x, the same filter down. Latency: 15 samples
// (os.latency), so a dry path mixed back in must be delayed by that much.
const HB = (() => {
  const L = 31, c = 15, beta = 7, h = new Float64Array(L);
  const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 25; k++) { t *= (x / 2 / k) * (x / 2 / k); s += t; } return s; };
  let sum = 0;
  for (let j = 0; j < L; j++) { const t = j - c, u = t / c, w = i0(beta * Math.sqrt(Math.max(0, 1 - u * u))) / i0(beta); h[j] = (t === 0 ? 0.5 : Math.sin(Math.PI * t / 2) / (Math.PI * t)) * w; sum += h[j]; }
  for (let j = 0; j < L; j++) h[j] /= sum;
  return h;
})();
function os2(fn) {
  const L = 31, x = new Float64Array(16), u = new Float64Array(32);
  let xi = 0, ui = 0;
  const f = function (v) {
    x[xi] = v; const xs = xi; xi = (xi + 1) & 15;
    // up: the even 2x sample uses the even taps, the odd one the odd taps (zero-stuffed input, gain 2)
    let a = 0, b = 0;
    for (let k = 0; k < 16; k++) { const xv = x[(xs - k) & 15]; a += HB[2 * k] * xv; if (2 * k + 1 < L) b += HB[2 * k + 1] * xv; }
    const y0 = fn(2 * a), y1 = fn(2 * b);
    // down: filter the 2x stream at the even sample (keeps the delay a whole 15 samples), then queue the odd one
    u[ui] = y0;
    let s = 0;
    for (let j = 0; j < L; j++) s += HB[j] * u[(ui - j) & 31];
    u[(ui + 1) & 31] = y1; ui = (ui + 2) & 31;
    return s;
  };
  f.latency = 15;
  return f;
}

// Schroeder allpass (a diffuser): len in samples, g about 0.5..0.75.
function allpass(len, g) {
  const buf = new Float32Array(Math.max(1, len | 0)); let i = 0;
  return (x) => { const d = buf[i], v = x + g * d; buf[i] = v; i++; if (i >= buf.length) i = 0; return d - g * v; };
}

// An 8-line feedback delay network (Householder mixing, a damping low-pass and a slowly wandering read in every
// line, so the tail is dense and smooth rather than metallic). tick(l, r) leaves the WET signal in .l and .r.
// set(size 0..1, T60 seconds, damp 0..1). The line lengths are mutually prime-ish and scale with size.
function fdn(sr, seed) {
  const N = 8, BASE = [1031, 1327, 1523, 1801, 2111, 2437, 2741, 3089], k = sr / 48000;
  const rr = rng(seed ^ 0xf00d);
  const lines = [], len = new Float64Array(N), g = new Float64Array(N), lp = new Float64Array(N), x = new Float64Array(N);
  const mph = new Float64Array(N), mdt = new Float64Array(N);
  for (let i = 0; i < N; i++) { lines.push(delayLine(Math.ceil(BASE[N - 1] * 1.8 * k) + 64)); mph[i] = (rr() + 1) / 2; mdt[i] = (0.07 + 0.11 * i / N + 0.03 * rr()) / sr; }
  let a = 0, depth = 6 * k, lastS = -1, lastT = -1, lastD = -1;
  const o = {
    l: 0, r: 0,
    set(size, t60, damp) {
      if (size === lastS && t60 === lastT && damp === lastD) return o;
      lastS = size; lastT = t60; lastD = damp;
      const sc = (0.3 + 1.45 * clamp(size, 0, 1)) * k;
      for (let i = 0; i < N; i++) { len[i] = BASE[i] * sc; g[i] = Math.pow(10, -3 * len[i] / (Math.max(0.05, t60) * sr)); }
      a = Math.exp(-TAU * (16000 * Math.pow(0.05, clamp(damp, 0, 1))) / sr);
      depth = (3 + 9 * clamp(size, 0, 1)) * k;
      return o;
    },
    tick(inL, inR) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        let p = mph[i] + mdt[i]; if (p >= 1) p -= 1; mph[i] = p;
        const v = lines[i].cubic(len[i] + depth * (1 + sinT(p)));
        lp[i] = v + (lp[i] - v) * a;            // damping in the loop
        x[i] = lp[i] * g[i]; sum += x[i];
      }
      sum *= 2 / N;
      for (let i = 0; i < N; i++) lines[i].write(x[i] - sum + ((i & 1) ? inR : inL));
      o.l = x[0] - x[2] + x[4] - x[6] + 0.5 * (x[1] - x[5]);
      o.r = x[1] - x[3] + x[5] - x[7] + 0.5 * (x[2] - x[6]);
      return o.l;
    },
    clear() { for (const d of lines) d.clear(); lp.fill(0); },
  };
  return o;
}

// Equal-power pan, -1..1 -> [gl, gr] (unity in the middle on both sides: 0.7071 * sqrt2)
function panLR(p) { const a = (clamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; }
// Note divisions for tempo sync: label -> beats
const DIVS = [['1/32', 0.125], ['1/16T', 1 / 6], ['1/16', 0.25], ['1/16D', 0.375], ['1/8T', 1 / 3], ['1/8', 0.5], ['1/8D', 0.75], ['1/4T', 2 / 3], ['1/4', 1], ['1/4D', 1.5], ['1/2', 2], ['1/2D', 3], ['1 BAR', 4], ['2 BARS', 8]];
`;

export const DIV_LABELS = ['1/32', '1/16T', '1/16', '1/16D', '1/8T', '1/8', '1/8D', '1/4T', '1/4', '1/4D', '1/2', '1/2D', '1 BAR', '2 BARS'];

// The kernel source for a built-in: the prelude, then the device's body, which ends by returning the kernel object.
export const kernel = (body) => `(() => {\n${LIB}\n${body}\n})()`;
