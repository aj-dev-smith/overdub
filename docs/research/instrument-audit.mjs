// Instrument audit: single notes across registers and velocities through the canonical Node renderer, then
// envelope / spectral measures (docs/research/INSTRUMENTS.md). Usage: node docs/research/instrument-audit.mjs [name filter]
const ROOT = new URL('../../app/src/', import.meta.url).href;
const { renderSong } = await import(ROOT + 'engine/node/render.js');
const { createProject } = await import(ROOT + 'core/project.js');
const { measure } = await import(ROOT + 'audio/measure.js');
const { SHOWCASE } = await import(ROOT + 'devices/showcase.js');
const { phrase, PHRASE_BEATS } = await import(ROOT + 'audio/testsignals.js');

// the four instruments of the day run's first batch (until they are in builtin/index.js)
for (const f of ['piano', 'organ', 'strings', 'bassguitar']) { try { await import(ROOT + 'devices/builtin/' + f + '.js'); } catch (e) { console.error(f + '.js: ' + e.message); } }
const SR = 48000;
const STAMP = '2026-09-30T00:00:00.000Z';
const firefly = SHOWCASE.find((d) => d.id === 'claude.firefly');

function song(device, params, notes, beats, devices = {}) {
  return { ...createProject(), id: 'p_audit', tempo: 120, key: null, devices,
    meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [{ id: 't_audit', name: 'A', kind: 'instrument', instrument: { device, params }, inserts: [],
      clips: [{ id: 'c_a', kind: 'notes', start: 0, length: beats, notes: notes.map((n, i) => ({ id: 'n' + i, by: 'overdub', ...n })), by: 'overdub' }],
      gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }] };
}
const devs = (id) => (id === 'claude.firefly' ? { [id]: { ...firefly, created: STAMP, modified: STAMP } } : {});

function render(id, params, notes, beats, tail = 2) {
  const r = renderSong(song(id, params, notes, beats, devs(id)), { from: 0, to: beats, tail, sr: SR });
  return r;
}
const mono = (r) => { const [L, R] = r.channels, x = new Float32Array(L.length); for (let i = 0; i < x.length; i++) x[i] = 0.5 * (L[i] + R[i]); return x; };

// FFT (radix 2, in place)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
      const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
      re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
function spectrum(x, at, N = 8192) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { const s = x[at + i] || 0; re[i] = s * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); }
  fft(re, im);
  const mag = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}
function centroid(x, at, N = 4096) {
  if (at + N > x.length) return null;
  const m = spectrum(x, at, N); let a = 0, b = 0;
  for (let k = 1; k < m.length; k++) { const f = k * SR / N, p = m[k] * m[k]; a += f * p; b += p; }
  return b > 1e-20 ? a / b : null;
}
// envelope: RMS in 5 ms frames, dB
function envelope(x, hop = 240) {
  const out = []; for (let i = 0; i + hop <= x.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += x[i + j] * x[i + j]; out.push(10 * Math.log10(s / hop + 1e-20)); }
  return out;
}
// attack: onset (-40 dB under peak) to within 3 dB of the peak, ms; T60 from the slope between -6 and -36 dB below peak
// (before note-off), extrapolated
function envStats(x, offAt) {
  const e = envelope(x), hop = 240; let pk = -200, pi = 0; for (let i = 0; i < e.length; i++) if (e[i] > pk) { pk = e[i]; pi = i; }
  let on = 0; while (on < e.length && e[on] < pk - 40) on++;
  let a3 = on; while (a3 < e.length && e[a3] < pk - 3) a3++;
  const offF = Math.floor(offAt * SR / hop);
  // slope fit between -6 and -36 dB below the peak, held portion
  const xs = [], ys = [];
  for (let i = pi; i < Math.min(e.length, offF); i++) { if (e[i] < pk - 6 && e[i] > pk - 36) { xs.push(i * hop / SR); ys.push(e[i]); } }
  let t60 = null;
  if (xs.length > 4) { const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } const sl = sxy / sxx; if (sl < 0) t60 = -60 / sl; }
  // level 1 s after the peak (relative), and level just before note off
  const at1 = e[Math.min(e.length - 1, pi + Math.round(SR / hop))] - pk;
  // release: time from note off to -60 dB under the level at note off
  const lo = e[Math.max(0, offF - 1)]; let rf = offF; while (rf < e.length && e[rf] > lo - 40) rf++;
  return { peakDb: +pk.toFixed(1), attackMs: +((a3 - on) * hop / SR * 1000).toFixed(1), t60: t60 && +t60.toFixed(2), at1s: +at1.toFixed(1), rel40ms: rf < e.length ? Math.round((rf - offF) * hop / SR * 1000) : null, onsetMs: on * hop / SR * 1000 };
}
// inharmonicity: find the partial peaks near k f0 sqrt(1 + B k^2); fit B by least squares on (fk/(k f0))^2 = 1 + B k^2
function partials(x, at, f0, K = 12, N = 16384) {
  const m = spectrum(x, at, N), bin = SR / N, out = [];
  const fEst = f0;
  for (let k = 1; k <= K; k++) {
    const target = k * fEst; if (target > SR * 0.45) break;
    const lo = Math.floor(target * 0.97 / bin), hi = Math.ceil(target * 1.03 / bin);
    let bi = lo; for (let i = lo; i <= hi; i++) if (m[i] > m[bi]) bi = i;
    const a = m[bi - 1], b = m[bi], c = m[bi + 1], d = 0.5 * (a - c) / (a - 2 * b + c || 1e-12);
    out.push({ k, f: (bi + d) * bin, db: 20 * Math.log10(b + 1e-20) });
  }
  // fit B
  let sxy = 0, sxx = 0; const f1 = out[0].f;
  for (const p of out) { const y = (p.f / (p.k * f1)) ** 2 - 1, xk = p.k * p.k - 1; sxy += xk * y; sxx += xk * xk; }
  const pk = Math.max(...out.map((p) => p.db));
  return { B: sxx ? sxy / sxx : 0, f1, centsOff: 1200 * Math.log2(f1 / f0), amps: out.map((p) => +(p.db - pk).toFixed(0)) };
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CASES = [
  { id: 'core.piano', name: 'Baby Grand', params: {}, pitches: [28, 40, 52, 64, 76, 88], hold: 5, inharm: true },
  { id: 'core.organ', name: 'Rotor Cabinet', params: {}, pitches: [36, 48, 60, 72, 84], hold: 2 },
  { id: 'core.strings', name: 'Music Stands', params: {}, pitches: [43, 55, 67, 79], hold: 3 },
  { id: 'core.bassguitar', name: 'Flatwound', params: {}, pitches: [28, 33, 40, 52], hold: 3, inharm: true },
  { id: 'core.keys', name: 'Lamp Tines TINES', params: { voice: 0 }, pitches: [36, 48, 60, 72, 84], hold: 4 },
  { id: 'core.keys', name: 'Lamp Tines GRAND', params: { voice: 1 }, pitches: [28, 40, 52, 64, 76, 88], hold: 5, inharm: true },
  { id: 'core.pluck', name: 'Pinch Roller', params: {}, pitches: [40, 52, 64, 76], hold: 4, inharm: true },
  { id: 'core.poly', name: 'Patch Bay', params: {}, pitches: [36, 48, 60, 72], hold: 1.5 },
  { id: 'core.bass', name: 'Capstan', params: { mode: 1 }, pitches: [28, 36, 43, 52], hold: 1.0 },
  { id: 'core.pad', name: 'Room Tone', params: {}, pitches: [48, 60, 72], hold: 3 },
  { id: 'claude.choir-loft', name: 'Choir Loft', params: {}, pitches: [48, 60, 72], hold: 3 },
  { id: 'claude.dust-sheet', name: 'Dust Sheet', params: {}, pitches: [48, 60, 72], hold: 3 },
  { id: 'claude.biscuit-tin', name: 'Biscuit Tin WOOD', params: { sound: 0 }, pitches: [48, 60, 72, 84], hold: 3, inharm: true },
  { id: 'claude.biscuit-tin', name: 'Biscuit Tin TINE', params: { sound: 1 }, pitches: [60, 72, 84], hold: 3 },
  { id: 'claude.sub-basement', name: 'Sub Basement', params: {}, pitches: [24, 31, 36, 43], hold: 2 },
  { id: 'claude.firefly', name: 'Firefly', params: {}, pitches: [72, 84, 96], hold: 3 },
];
const VELS = [0.3, 0.6, 1.0];
const filt = process.argv[2];
const results = {};
for (const c of CASES) {
  if (filt && !c.name.toLowerCase().includes(filt.toLowerCase())) continue;
  const rows = [];
  for (const p of c.pitches) for (const v of VELS) {
    const beats = c.hold * 2; // 120 bpm
    const r = render(c.id, c.params, [{ p, t: 0, d: beats, v }], beats, 2.5);
    const x = mono(r);
    const es = envStats(x, c.hold);
    const on = Math.round(es.onsetMs / 1000 * SR);
    const row = { p, v, ...es, c0: Math.round(centroid(x, on) || 0), c300: Math.round(centroid(x, on + 0.3 * SR) || 0), c1s: Math.round(centroid(x, on + 1 * SR) || 0) };
    if (c.inharm && v === 0.6) { try { const pa = partials(x, on + Math.round(0.08 * SR), mtof(p)); row.B = +pa.B.toExponential(2); row.cents = +pa.centsOff.toFixed(1); row.amps = pa.amps.join(' '); } catch { row.B = 'err'; } }
    rows.push(row);
  }
  // the test phrase measure
  const ph = render(c.id, c.params, phrase(), PHRASE_BEATS, 2);
  const m = measure({ sr: SR, channels: ph.channels });
  // cpu: 16 held notes for 4 s
  const chord = []; for (let k = 0; k < 16; k++) chord.push({ p: c.pitches[0] + 12 + k * 2, t: 0, d: 8, v: 0.8 });
  const t0 = performance.now(); render(c.id, c.params, chord, 8, 0); const ms = performance.now() - t0;
  results[c.name] = { rows, phrase: { lufs: m.lufs, truePeak: m.truePeak, centroid: m.centroid, bands: m.bands, correlation: m.correlation, crest: m.crest }, cpu16pct: +(ms / 4000 * 100).toFixed(1) };
  console.log('\n## ' + c.name, JSON.stringify(results[c.name].phrase), 'cpu16(Node, % of real time):', results[c.name].cpu16pct);
  console.log('p\tv\tpeak\tatkMs\tT60\t@1s\trel40\tc0\tc300\tc1s\tB\tcents\tpartials dB');
  for (const r of rows) console.log([r.p, r.v, r.peakDb, r.attackMs, r.t60, r.at1s, r.rel40ms, r.c0, r.c300, r.c1s, r.B ?? '', r.cents ?? '', r.amps ?? ''].join('\t'));
}
