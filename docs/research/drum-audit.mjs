// Drum audit: every kit piece of core.drums (FIELD, MACHINE, DUST) at two velocities, through the canonical Node renderer.
// docs/research/INSTRUMENTS.md. Usage: node docs/research/drum-audit.mjs
const ROOT = new URL('../../app/src/', import.meta.url).href;
const { renderSong } = await import(ROOT + 'engine/node/render.js');
const { createProject } = await import(ROOT + 'core/project.js');
const SR = 48000, STAMP = '2026-09-30T00:00:00.000Z';
const song = (params, notes, beats) => ({ ...createProject(), id: 'p_d', tempo: 120, key: null, meta: { created: STAMP, modified: STAMP, authors: {} },
  tracks: [{ id: 't_d', name: 'D', kind: 'instrument', instrument: { device: 'core.drums', params }, inserts: [],
  clips: [{ id: 'c', kind: 'notes', start: 0, length: beats, notes: notes.map((n, i) => ({ id: 'n' + i, by: 'overdub', ...n })), by: 'overdub' }], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }] });
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const h = i + j + len / 2, ur = re[i + j], ui = im[i + j], vr = re[h] * cr - im[h] * ci, vi = re[h] * ci + im[h] * cr; re[i + j] = ur + vr; im[i + j] = ui + vi; re[h] = ur - vr; im[h] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
function spec(x, at, N) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = (x[at + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); fft(re, im); const m = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(re[k], im[k]); return m; }
const cent = (x, at, N = 2048) => { const m = spec(x, at, N); let a = 0, b = 0; for (let k = 1; k < m.length; k++) { const p = m[k] ** 2; a += k * SR / N * p; b += p; } return Math.round(a / (b || 1)); };
const peakHz = (x, at, N = 16384, lo = 25, hi = 400) => { const m = spec(x, at, N); let bi = Math.round(lo * N / SR); for (let k = bi; k < hi * N / SR; k++) if (m[k] > m[bi]) bi = k; return Math.round(bi * SR / N); };
const PIECES = { kick: 36, snare: 38, clap: 39, rim: 37, chh: 42, ohh: 46, lowtom: 45, hitom: 48, crash: 49, ride: 51 };
for (const [ki, kit] of ['FIELD', 'MACHINE', 'DUST'].entries()) {
  console.log('\n## ' + kit + '\npiece\tv\tpeak\tto-20ms\tto-40ms\tc(0-43ms)\tc(50ms+)\tf(lowest peak 20-150ms)');
  for (const [name, p] of Object.entries(PIECES)) for (const v of [0.4, 1]) {
    const r = renderSong(song({ kit: ki }, [{ p, t: 0, d: 0.5, v }], 8), { from: 0, to: 8, tail: 0, sr: SR });
    const [L, R] = r.channels, x = new Float32Array(L.length); for (let i = 0; i < x.length; i++) x[i] = 0.5 * (L[i] + R[i]);
    let pk = 0, pi = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > pk) { pk = Math.abs(x[i]); pi = i; }
    // envelope: 5 ms RMS
    const hop = 240, e = []; for (let i = 0; i + hop < x.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += x[i + j] ** 2; e.push(10 * Math.log10(s / hop + 1e-20)); }
    const em = Math.max(...e), ei = e.indexOf(em); let a = ei; while (a < e.length && e[a] > em - 20) a++; let b = ei; while (b < e.length && e[b] > em - 40) b++;
    const on = Math.max(0, ei * hop - 480);
    console.log([name, v, (20 * Math.log10(pk)).toFixed(1), Math.round((a - ei) * 5), Math.round((b - ei) * 5), cent(x, on), cent(x, on + 0.05 * SR), name.includes('kick') || name.includes('tom') || name === 'snare' ? peakHz(x, on + 0.02 * SR) : ''].join('\t'));
  }
}
