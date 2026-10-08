// CPU of candidate synthesis methods at 16 voices, as % of real time on one core in Node (docs/research/INSTRUMENTS.md).
// Usage: node docs/research/synth-bench.mjs
const SR = 48000,
  SECS = 4,
  N = SR * SECS;
function time(name, fn) {
  fn(4800);
  const t0 = performance.now();
  fn(N);
  const ms = performance.now() - t0;
  console.log(name.padEnd(58), ((ms / (SECS * 1000)) * 100).toFixed(2) + '% of real time (Node, 1 core)');
}
// modal partials as rotating phasors with per-partial decay, V voices x K partials
function modal(V, K) {
  return (n) => {
    const px = new Float64Array(V * K).fill(0),
      py = new Float64Array(V * K).fill(1),
      c = new Float64Array(V * K),
      s = new Float64Array(V * K),
      a = new Float64Array(V * K),
      d = new Float64Array(V * K);
    for (let i = 0; i < V * K; i++) {
      const w = 0.01 + i * 1e-4;
      c[i] = Math.cos(w);
      s[i] = Math.sin(w);
      a[i] = 1 / (1 + (i % K));
      d[i] = 0.99999;
    }
    const out = new Float32Array(128);
    let acc = 0;
    for (let b = 0; b < n; b += 128) {
      for (let v = 0; v < V; v++) {
        const o = v * K;
        for (let i = 0; i < 128; i++) {
          let x = 0;
          for (let j = o; j < o + K; j++) {
            const nx = px[j] * c[j] + py[j] * s[j];
            py[j] = py[j] * c[j] - px[j] * s[j];
            px[j] = nx;
            a[j] *= d[j];
            x += nx * a[j];
          }
          out[i] += x;
        }
      }
      acc += out[5];
      out.fill(0);
    }
    return acc;
  };
}
// biquad resonator bank (2-pole), V voices x K modes
function reson(V, K) {
  return (n) => {
    const y1 = new Float64Array(V * K),
      y2 = new Float64Array(V * K),
      c1 = new Float64Array(V * K).fill(1.99),
      c2 = new Float64Array(V * K).fill(0.9999);
    y1.fill(0.1);
    let acc = 0;
    const out = new Float32Array(128);
    for (let b = 0; b < n; b += 128) {
      for (let v = 0; v < V; v++) {
        const o = v * K;
        for (let i = 0; i < 128; i++) {
          let x = 0;
          for (let j = o; j < o + K; j++) {
            const y = c1[j] * y1[j] - c2[j] * y2[j];
            y2[j] = y1[j];
            y1[j] = y;
            x += y;
          }
          out[i] += x;
        }
      }
      acc += out[3];
      out.fill(0);
    }
    return acc;
  };
}
// waveguide string: delay + one-pole loss + allpass tune (+ 4 allpass dispersion), V voices
function wg(V, disp) {
  return (n) => {
    const L = 400,
      bufs = Array.from({ length: V }, () => new Float32Array(L).map((_, i) => Math.sin(i)));
    const w = new Int32Array(V),
      s1 = new Float64Array(V),
      x1 = new Float64Array(V),
      y1 = new Float64Array(V),
      dx = new Float64Array(V * 4),
      dy = new Float64Array(V * 4);
    let acc = 0;
    const out = new Float32Array(128);
    for (let b = 0; b < n; b += 128) {
      for (let v = 0; v < V; v++) {
        const buf = bufs[v];
        let p = w[v];
        for (let i = 0; i < 128; i++) {
          const s = buf[p];
          let lp = 0.996 * (0.7 * s + 0.3 * s1[v]);
          s1[v] = s;
          if (disp)
            for (let k = 0; k < 4; k++) {
              const j = v * 4 + k,
                y = -0.5 * lp + dx[j] + 0.5 * dy[j];
              dx[j] = lp;
              dy[j] = y;
              lp = y;
            }
          const y = 0.3 * lp + x1[v] - 0.3 * y1[v];
          x1[v] = lp;
          y1[v] = y;
          buf[p] = y;
          if (++p >= 300) p = 0;
          out[i] += s;
        }
        w[v] = p;
      }
      acc += out[1];
      out.fill(0);
    }
    return acc;
  };
}
// polyBLEP saws through an SVF: V voices x O oscillators
function va(V, O) {
  return (n) => {
    const ph = new Float64Array(V * O),
      dt = new Float64Array(V * O).map((_, i) => 0.002 + i * 1e-5);
    const ic1 = new Float64Array(V),
      ic2 = new Float64Array(V);
    const g = Math.tan((Math.PI * 2000) / SR),
      k = 1,
      a1 = 1 / (1 + g * (g + k)),
      a2 = g * a1,
      a3 = g * a2;
    let acc = 0;
    const out = new Float32Array(128);
    const blep = (t, d) => {
      if (t < d) {
        t /= d;
        return t + t - t * t - 1;
      }
      if (t > 1 - d) {
        t = (t - 1) / d;
        return t * t + t + t + 1;
      }
      return 0;
    };
    for (let b = 0; b < n; b += 128) {
      for (let v = 0; v < V; v++)
        for (let i = 0; i < 128; i++) {
          let x = 0;
          for (let o = v * O; o < v * O + O; o++) {
            let p = ph[o] + dt[o];
            if (p >= 1) p -= 1;
            ph[o] = p;
            x += 2 * p - 1 - blep(p, dt[o]);
          }
          const v3 = x - ic2[v],
            v1 = a1 * ic1[v] + a2 * v3,
            v2 = ic2[v] + a2 * ic1[v] + a3 * v3;
          ic1[v] = 2 * v1 - ic1[v];
          ic2[v] = 2 * v2 - ic2[v];
          out[i] += v2;
        }
      acc += out[2];
      out.fill(0);
    }
    return acc;
  };
}
// shared tonewheel bank: 91 sines from a table, each key sums 9 drawbars (table lookup) -> V keys
function organ(V) {
  return (n) => {
    const T = new Float32Array(4097).map((_, i) => Math.sin((2 * Math.PI * i) / 4096));
    const ph = new Float64Array(91),
      dt = new Float64Array(91).map((_, i) => (32.7 * Math.pow(2, i / 12)) / SR);
    const tw = new Float32Array(91);
    const keys = Array.from({ length: V }, (_, v) =>
      [0, 12, 19, 24, 31, 36, 40, 43, 48].map((h) => Math.min(90, 12 + v + h)),
    );
    let acc = 0;
    const out = new Float32Array(128);
    for (let b = 0; b < n; b += 128)
      for (let i = 0; i < 128; i++) {
        for (let w = 0; w < 91; w++) {
          let p = ph[w] + dt[w];
          if (p >= 1) p -= 1;
          ph[w] = p;
          const x = p * 4096,
            j = x | 0;
          tw[w] = T[j] + (T[j + 1] - T[j]) * (x - j);
        }
        let s = 0;
        for (let v = 0; v < V; v++) {
          const kk = keys[v];
          for (let d = 0; d < 9; d++) s += tw[kk[d]] * 0.5;
        }
        out[i] = s;
        acc += s;
      }
    return acc;
  };
}
time("modal: 16 voices x 16 partials (today's GRAND)", modal(16, 16));
time('modal: 16 voices x 48 partials', modal(16, 48));
time('modal: 16 voices x 96 partials', modal(16, 96));
time('2-pole resonator bank: 16 voices x 32 modes', reson(16, 32));
time('waveguide string: 16 voices (KS + tuning allpass)', wg(16, false));
time('waveguide string: 16 voices + 4 dispersion allpasses', wg(16, true));
time('VA: 16 voices x 2 saws + SVF', va(16, 2));
time('VA: 16 voices x 7 saws + SVF (supersaw)', va(16, 7));
time('organ: shared 91 tonewheels + 16 keys x 9 drawbars', organ(16));
