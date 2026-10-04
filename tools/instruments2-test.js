// Batch 2 of the instrument roadmap (docs/research/INSTRUMENTS.md): core.ep (Suitcase), core.mallets (Mallet Bag)
// and core.drums' appended kits (808, 909, ACOUSTIC+). Nobody building this can listen, so each is held to its
// family's signatures from the roadmap, measured on the canonical Node render (app/src/engine/node/render.js):
//
//   all       the test phrase at house level (-18.5..-13.5 LUFS, true peak <= -1 dBTP) for every voice, bar and kit,
//             no NaN, no denormals, two renders bit-identical, 16 voices within the roadmap's CPU budget (6% of a
//             core on an idle machine, scaled by a reference measured alongside)
//   ep        (2.2) the bark: c0/f0 at C4 about 1.3-1.8 played softly and >= 3 hard (TINE); the 2nd harmonic rising
//             with VOICING from about -30 dB to about -6 dB; harder is brighter for REED and FM too; a two-stage
//             decay; the register balanced within +-4 dB; the tremolo at RATE (stereo for TINE, mono for REED); no
//             aliasing from the pickup
//   mallets   (2.6) the bar ratios within 1%; the register balanced within +-4 dB; harder is brighter (x1.5); the
//             overtones die first (c300 < c0); the mallet tied to the bar's period (the same colour at C4 and C6);
//             the vibes motor at MOTOR; DAMP stops a bar
//   drums     (2.9) FIELD, MACHINE and DUST bit-identical to before the options were appended; kicks at 45-60 Hz
//             after 50 ms, the 909's click and the 808's lack of one; ACOUSTIC+ kick and tom brighter when hit
//             harder (x1.5, x1.3: FIELD is x1.0); claps of three or more bursts; closed hats to -40 dB in 150-250 ms;
//             the open hat choked; each new kit at most 1.5x FIELD's cost on the drum phrase, in CPU time
//
// Then each passes checkDevice (kernel/check.js, full mode) in Chromium with no warnings, the drums once per new kit.
//   node tools/instruments2-test.js            NODE_ONLY=1 skips the browser
import crypto from 'node:crypto';
import { tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';
import { measure } from '../app/src/audio/measure.js';
import { phrase, drumPhrase, PHRASE_BEATS, DRUM_PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import { INSTRUMENTS } from '../app/src/devices/builtin/index.js';

const t = tally('instruments2');
const SR = 48000, BPM = 120, BEAT = 60 / BPM;
const STAMP = '2026-09-30T00:00:00.000Z';
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

function project(id, notes, params = {}, beats = PHRASE_BEATS) {
  return {
    ...createProject(), id: 'p_inst2', title: id, key: null, tempo: BPM, meta: { created: STAMP, modified: STAMP, authors: {} },
    tracks: [{ id: 't_inst2', name: 'Inst', kind: 'instrument', instrument: { device: id, params }, inserts: [],
      clips: [{ id: 'c_inst2', kind: 'notes', start: 0, length: beats, notes: notes.map((n, i) => ({ id: 'n' + (i + 1), by: 'overdub', ...n })), by: 'overdub' }],
      gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }],
  };
}
// notes in seconds -> a render
function play(id, notes, params = {}, secs = 4, tail = 0.5) {
  const beats = Math.ceil(secs / BEAT);
  const t0 = performance.now(), c0 = cpuNow();
  const r = renderSong(project(id, notes.map((n) => ({ p: n.p, v: n.v ?? 0.8, t: n.t / BEAT, d: n.d / BEAT })), params, beats), { from: 0, to: beats, tail });
  r.ms = performance.now() - t0;
  r.cpuMs = (cpuNow() - c0) / 1000;
  return r;
}
// CPU time spent rendering, in microseconds: this thread's where Node has it (24+: the render is synchronous, so it is
// the render's own cost without the collector's and compiler's helper threads), else the process's
const cpuNow = () => { const u = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage(); return u.user + u.system; };
const mono = (r) => { const [L, R] = r.channels, x = new Float32Array(L.length); for (let i = 0; i < x.length; i++) x[i] = 0.5 * (L[i] + R[i]); return x; };
const peak = (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
function rms(x, a, b) { let s = 0; const i0 = Math.round(a * SR), i1 = Math.round(b * SR); for (let i = i0; i < i1; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); }
function goertzel(x, a, len, f) {
  const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) { const s = (x[a + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1))) + c * s1 - s2; s2 = s1; s1 = s; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) * 4 / len;
}
function peakFreq(x, a, len, f, span = 0.02) {
  let best = 0, bf = f;
  for (let k = -80; k <= 80; k++) { const ff = f * (1 + span * k / 80), m = goertzel(x, a, len, ff); if (m > best) { best = m; bf = ff; } }
  const step = f * span / 80;
  for (let k = -20; k <= 20; k++) { const ff = bf + step * k / 20, m = goertzel(x, a, len, ff); if (m > best) { best = m; bf = ff; } }
  return bf;
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const h = i + j + len / 2, ur = re[i + j], ui = im[i + j], vr = re[h] * cr - im[h] * ci, vi = re[h] * ci + im[h] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[h] = ur - vr; im[h] = ui - vi;
        const tt = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = tt;
      }
    }
  }
}
// power spectrum (Hann) of x[a..a+N)
function power(x, a, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[a + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  fft(re, im);
  const p = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}
// the spectral centroid of x[a..a+N) (the roadmap's c0 is the first 4096 samples from the onset)
function centroid(x, a, N = 4096) { const p = power(x, a, N); let s = 0, w = 0; for (let k = 1; k < p.length; k++) { s += p[k] * k * SR / N; w += p[k]; } return w > 0 ? s / w : 0; }
// the drum audit's onset centroid (docs/research/drum-audit.mjs): 2048 samples from 10 ms before the loudest 5 ms
function drumC0(x) {
  const hop = 240, e = []; for (let i = 0; i + hop < x.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += x[i + j] * x[i + j]; e.push(s); }
  return centroid(x, Math.max(0, e.indexOf(Math.max(...e)) * hop - 480), 2048);
}
// the envelope in dB, `frame` s frames
function envelope(x, frame = 0.02) {
  const fl = Math.round(frame * SR), out = [];
  for (let a = 0; a + fl <= x.length; a += fl) { let s = 0; for (let i = a; i < a + fl; i++) s += x[i] * x[i]; out.push(10 * Math.log10(s / fl + 1e-24)); }
  return out;
}
// the strongest modulation rate (Hz) of x's amplitude between a and b seconds: the level in dB in 5 ms frames, less
// its own 0.6 s moving average (so the note's decay doesn't read as a slow wobble), then a DFT
function modRate(x, a, b, lo = 1, hi = 10) {
  const fl = 240, lv = [];
  for (let s = Math.round(a * SR); s + fl <= Math.round(b * SR); s += fl) { let q = 0; for (let i = s; i < s + fl; i++) q += x[i] * x[i]; lv.push(10 * Math.log10(q / fl + 1e-20)); }
  const W = 60, env = [];
  for (let i = W; i < lv.length - W; i++) { let m = 0; for (let j = i - W; j <= i + W; j++) m += lv[j]; env.push(lv[i] - m / (2 * W + 1)); }
  const e = env, fr = SR / fl;
  let best = 0, bf = 0;
  for (let f = lo; f <= hi; f += 0.01) { let re = 0, im = 0; for (let i = 0; i < e.length; i++) { re += e[i] * Math.cos(2 * Math.PI * f * i / fr); im += e[i] * Math.sin(2 * Math.PI * f * i / fr); } const m = re * re + im * im; if (m > best) { best = m; bf = f; } }
  return { hz: bf, env };
}
// envelope bursts in the first `ms`: 1 ms hops of a 2 ms RMS; a burst is a local maximum (over +-2 ms) at least 4 dB
// above the lowest point since the previous one, within 15 dB of the loudest
function bursts(x, ms = 40) {
  const e = []; for (let a = 0; a + 96 <= x.length && a < (ms + 4) * 48; a += 48) { let s = 0; for (let i = a; i < a + 96; i++) s += x[i] * x[i]; e.push(10 * Math.log10(s / 96 + 1e-20)); }
  const top = Math.max(...e); let n = 0, lo = Infinity;
  for (let i = 0; i < Math.min(ms, e.length - 2); i++) {
    lo = Math.min(lo, e[i]);
    const isMax = e[i] >= (e[i - 1] ?? -Infinity) && e[i] >= (e[i - 2] ?? -Infinity) && e[i] >= e[i + 1] && e[i] >= e[i + 2];
    if (isMax && e[i] > top - 15 && (n === 0 || e[i] - lo >= 4)) { n++; lo = e[i]; }
  }
  return n;
}
// energy above fc (a 4th-order high-pass) in samples [a, b)
function hfEnergy(x, a, b, fc = 3000) {
  const k = Math.exp(-2 * Math.PI * fc / SR), st = [0, 0, 0, 0], px = [0, 0, 0, 0]; let s = 0;
  for (let i = 0; i < b; i++) { let v = x[i]; for (let j = 0; j < 4; j++) { const o = k * (st[j] + v - px[j]); px[j] = v; st[j] = o; v = o; } if (i >= a) s += v * v; }
  return s;
}
const energy = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s; };
const sha = (r) => { const h = crypto.createHash('sha256'); for (const c of r.channels) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength)); return h.digest('hex').slice(0, 16); };

// CPU: wall time on a shared machine moves with everything else running, so each instrument is timed next to a
// reference (Lamp Tines' GRAND, 16 voices: 3.3% of real time on an idle Apple Silicon core) and reported as the share
// it would take on that idle machine. Best of three runs each. The roadmap's budget is 6% at 16 voices.
const REF_IDLE = 2.1, BUDGET = 6;   // it was 3.3% until the 2026-10-01 performance pass made GRAND about 44% cheaper, bit-exact; recalibrated to 2.1% measured on a quiet machine
const sixteen = (base = 36) => Array.from({ length: 16 }, (_, k) => ({ p: base + k * 3, v: 0.8, t: 0, d: 4 }));
function cpuPct(id, params, notes) { let best = Infinity; for (let i = 0; i < 3; i++) { const r = play(id, notes, params, 4, 0); best = Math.min(best, r.ms / (r.length / r.sr * 1000) * 100); } return best; }
const refPct = () => cpuPct('core.keys', { voice: 1 }, sixteen());
function idleCpu(id, params, notes = sixteen()) { const ref = refPct(), me = cpuPct(id, params, notes), ref2 = refPct(); const rf = Math.min(ref, ref2); return { idle: me * REF_IDLE / rf, raw: me, ref: rf }; }

// the house rules for one setting of one instrument
const table = [];
function houseRules(id, label, params, drums = false) {
  const ph = (drums ? drumPhrase() : phrase()).map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT }));
  const beats = drums ? DRUM_PHRASE_BEATS : PHRASE_BEATS;
  const a = play(id, ph, params, beats * BEAT, 2), b = play(id, ph, params, beats * BEAT, 2);
  const m = measure({ sr: a.sr, channels: a.channels });
  let nan = 0, den = 0, same = a.length === b.length;
  for (let c = 0; c < 2; c++) {
    const x = a.channels[c], y = b.channels[c];
    for (let i = 0; i < x.length; i++) { const v = x[i]; if (!Number.isFinite(v)) nan++; else if (v !== 0 && Math.abs(v) < 1.2e-38) den++; if (same && v !== y[i]) same = false; }
  }
  t.ok(m.lufs >= -18.5 && m.lufs <= -13.5 && m.truePeak <= -1, `${label}: the ${drums ? 'drum ' : ''}test phrase at ${m.lufs} LUFS, ${m.truePeak} dBTP (house: -18.5..-13.5 LUFS, <= -1 dBTP)`);
  t.ok(!nan && !den && same, `${label}: no NaN (${nan}), no denormals (${den}), two renders bit-identical (${same})`);
  return m;
}

const defs = Object.fromEntries(INSTRUMENTS.map((d) => [d.id, d]));
t.ok(defs['core.ep'] && defs['core.mallets'], 'builtin/index.js registers core.ep and core.mallets');
const kitOpts = defs['core.drums'] && defs['core.drums'].params.find((p) => p.key === 'kit').opts;
t.ok(kitOpts && kitOpts.slice(0, 3).join() === 'FIELD,MACHINE,DUST' && kitOpts.slice(3).join() === '808,909,ACOUSTIC+', `core.drums KIT keeps FIELD, MACHINE, DUST at 0-2 and appends ${kitOpts && kitOpts.slice(3).join(', ')}`);

// ------------------------------------------------------------------------------------------------ core.ep
console.log('core.ep (Suitcase): tines, reeds and the suitcase');
if (defs['core.ep']) {
  const ID = 'core.ep', VOICES = ['TINE', 'REED', 'FM'];
  for (let v = 0; v < 3; v++) {
    const m = houseRules(ID, `ep ${VOICES[v]}`, { voice: v });
    const cpu = idleCpu(ID, { voice: v });
    t.ok(cpu.idle <= BUDGET, `ep ${VOICES[v]}: 16 notes held for 4 s at ${fmt(cpu.idle)}% of an idle core (budget ${BUDGET}%; ${fmt(cpu.raw)}% now, reference ${fmt(cpu.ref)}%)`);
    // the register at equal velocity
    const reg = [36, 48, 60, 72, 84, 96].map((p) => dB(peak(mono(play(ID, [{ p, v: 0.7, t: 0, d: 1 }], { voice: v, trem: 0 }, 1.5, 0.2)))));
    const span = Math.max(...reg) - Math.min(...reg);
    t.ok(span <= 8, `ep ${VOICES[v]}: register balanced, peaks C2..C7 at velocity 0.7 within ${fmt(span)} dB (${reg.map((x) => fmt(x)).join(' ')}; want +-4)`);
    // velocity: c0/f0 at C4
    const c = [0.3, 0.6, 1].map((vel) => centroid(mono(play(ID, [{ p: 60, v: vel, t: 0, d: 2 }], { voice: v, trem: 0 }, 2, 0.2)), 0) / mtof(60));
    const lv = [0.3, 1].map((vel) => dB(peak(mono(play(ID, [{ p: 60, v: vel, t: 0, d: 1 }], { voice: v, trem: 0 }, 1.2, 0.2)))));
    if (v === 0) {
      t.ok(c[0] >= 1.25 && c[0] <= 1.9 && c[2] >= 3 && c[1] > c[0] && c[2] > c[1], `ep TINE: the bark comes with force: c0/f0 at C4 ${c.map((x) => fmt(x, 2)).join(' / ')} at velocity 0.3 / 0.6 / 1.0 (target ~1.3-1.8 soft, >= 3 hard)`);
    } else {
      const want = v === 1 ? 1.4 : 1.5;
      t.ok(c[2] / c[0] >= want && c[1] > c[0], `ep ${VOICES[v]}: harder is brighter: c0/f0 at C4 ${c.map((x) => fmt(x, 2)).join(' / ')} (x${fmt(c[2] / c[0], 2)}, want x${want})`);
    }
    t.ok(lv[1] - lv[0] >= 10, `ep ${VOICES[v]}: and louder: ${fmt(lv[1] - lv[0])} dB from velocity 0.3 to 1.0`);
    t.note(`ep ${VOICES[v]}: ${m.lufs} LUFS, centroid ${m.centroid} Hz, cpu ${fmt(cpu.idle)}% idle-equivalent`);
    table.push([ID, VOICES[v], m.lufs, m.truePeak, c.map((x) => fmt(x, 2)).join('/'), fmt(span), fmt(cpu.idle) + '%']);
  }
  // VOICING moves the 2nd harmonic (TINE, C4, velocity 0.8, 0.1-0.3 s)
  const h2 = [0, 0.25, 0.5, 0.75, 1].map((voicing) => { const x = mono(play(ID, [{ p: 60, v: 0.8, t: 0, d: 2 }], { voicing, trem: 0 }, 2, 0.2)), f0 = mtof(60); return dB(goertzel(x, 4800, 9600, 2 * f0)) - dB(goertzel(x, 4800, 9600, f0)); });
  t.ok(h2.every((x, i) => !i || x > h2[i - 1]) && h2[0] <= -24 && h2[4] >= -9, `ep TINE: VOICING moves the 2nd harmonic ${h2.map((x) => fmt(x)).join(' / ')} dB vs the fundamental at 0 / 0.25 / 0.5 / 0.75 / 1 (target about -30 round to -6 barky)`);
  // two-stage decay at C4
  const x = mono(play(ID, [{ p: 60, v: 0.7, t: 0, d: 8 }], { trem: 0 }, 8, 0.2));
  const l0 = dB(rms(x, 0.02, 0.07)), l1 = dB(rms(x, 1, 1.05)), l4 = dB(rms(x, 4, 4.05)), late = 60 / ((l1 - l4) / 3);
  t.ok(l0 - l1 >= 8 && l0 - l1 <= 16 && late >= 6 && late <= 14, `ep TINE: a two-stage decay at C4: ${fmt(l0 - l1)} dB in the first second (prompt), then T60 ${fmt(late)} s (aftersound; working targets 10-15 dB and 6-12 s)`);
  // RELEASE stops a note
  const rr = mono(play(ID, [{ p: 60, v: 0.8, t: 0, d: 1 }], { trem: 0 }, 2, 0.3));
  t.ok(dB(rms(rr, 0.8, 0.98)) - dB(rms(rr, 1.6, 1.8)) >= 40, `ep: let go and the damper stops the tine (${fmt(dB(rms(rr, 0.8, 0.98)) - dB(rms(rr, 1.6, 1.8)))} dB down 0.6 s later)`);
  // the tremolo: stereo for TINE (the sides alternate), in place for REED, at RATE
  const chord = [{ p: 60, t: 0, d: 6 }];   // one note: a chord's intervals beat faster than the tremolo
  for (const [voice, rate] of [[0, 4.5], [1, 5.5]]) {
    const r = play(ID, chord, { voice, trem: 0.6, rate, decay: 2.5 }, 6, 0);
    const L = modRate(r.channels[0], 1, 5), R = modRate(r.channels[1], 1, 5);
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < L.env.length; i++) { const a = L.env[i], b = R.env[i]; ab += a * b; aa += a * a; bb += b * b; }
    const corr = ab / Math.sqrt(aa * bb);
    t.ok(Math.abs(L.hz - rate) <= 0.1 && (voice === 0 ? corr < -0.5 : corr > 0.9), `ep ${VOICES[voice]}: the tremolo at ${fmt(L.hz, 2)} Hz (RATE ${rate}), ${voice === 0 ? 'side to side' : 'in place'}: L/R envelope correlation ${fmt(corr, 2)}`);
  }
  // no aliasing from the pickup: C6 at full bark, after the strike's ping has gone; energy away from the harmonics
  {
    const p = 84, f0 = mtof(p), N = 16384, x = mono(play(ID, [{ p, v: 1, t: 0, d: 1.2 }], { voicing: 1, bright: 1, drive: 0, trem: 0 }, 1.2, 0)), P = power(x, Math.round(0.25 * SR), N);
    let inH = 0, off = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N, h = f / f0, near = Math.abs(h - Math.round(h)) * f0 < 30 && Math.round(h) >= 1; if (near) inH += P[k]; else if (f > 40) off += P[k]; }
    const rel = 10 * Math.log10(off / inH);
    t.ok(rel <= -60, `ep TINE: no aliasing at C6 with VOICING and BRIGHT at max: energy between the harmonics ${fmt(rel)} dB (want <= -60)`);
  }
}

// ------------------------------------------------------------------------------------------------ core.mallets
console.log('core.mallets (Mallet Bag): bars and mallets');
if (defs['core.mallets']) {
  const ID = 'core.mallets', BARS = ['MARIMBA', 'VIBES', 'XYLO', 'GLOCK', 'CELESTA'];
  const RATIOS = [[1, 3.99, 9.9, 17.2], [1, 4, 10, 17.6], [1, 3, 6.2, 10.6], [1, 2.756, 5.404, 8.933], [1, 2.756, 5.404, 8.933]];
  for (let b = 0; b < 5; b++) {
    const m = houseRules(ID, `mallets ${BARS[b]}`, { bar: b });
    const reg = [36, 48, 60, 72, 84, 96].map((p) => dB(peak(mono(play(ID, [{ p, v: 0.7, t: 0, d: 1 }], { bar: b, room: 0 }, 1.5, 0.2)))));
    const span = Math.max(...reg) - Math.min(...reg);
    t.ok(span <= 8, `mallets ${BARS[b]}: register balanced, peaks C2..C7 within ${fmt(span)} dB (${reg.map((x) => fmt(x)).join(' ')}; want +-4; Biscuit Tin: 20 dB)`);
    // the ratios, hard mallet, motor off
    const p = b >= 3 ? 72 : 48, f0 = mtof(p), x = mono(play(ID, [{ p, v: 1, t: 0, d: 2 }], { bar: b, mallet: 1, room: 0, motor: 0 }, 2, 0.2));
    const f1 = peakFreq(x, 480, 16384, f0);
    const got = RATIOS[b].map((q) => peakFreq(x, 480, 8192, q * f0, 0.03) / f1);
    t.ok(got.every((g, k) => Math.abs(g / RATIOS[b][k] - 1) <= 0.01), `mallets ${BARS[b]}: modes at ${got.map((g) => fmt(g, 3)).join(' : ')} (designed ${RATIOS[b].join(' : ')}, within 1%)`);
    // velocity colour and the overtones dying first (C4, motor off)
    const c = [0.3, 1].map((v) => { const y = mono(play(ID, [{ p: 60, v, t: 0, d: 2 }], { bar: b, room: 0, motor: 0 }, 2, 0.2)); return [centroid(y, 0), centroid(y, Math.round(0.3 * SR))]; });
    const want = b === 4 ? 1.05 : 1.5;
    t.ok(c[1][0] / c[0][0] >= want, `mallets ${BARS[b]}: harder is brighter: c0 ${Math.round(c[0][0])} -> ${Math.round(c[1][0])} Hz (x${fmt(c[1][0] / c[0][0], 2)}, want x${want}${b === 4 ? ': felt hammers' : ''})`);
    t.ok(c[1][1] <= c[1][0] && c[0][1] <= c[0][0] + 1, `mallets ${BARS[b]}: the overtones die first: c300 ${Math.round(c[1][1])} <= c0 ${Math.round(c[1][0])} Hz (hard), ${Math.round(c[0][1])} <= ${Math.round(c[0][0])} (soft)`);
    if (b === 0) {
      const cpu = idleCpu(ID, { bar: 1 });
      t.ok(cpu.idle <= BUDGET, `mallets: 16 notes held for 4 s at ${fmt(cpu.idle)}% of an idle core (VIBES with its motor; budget ${BUDGET}%; ${fmt(cpu.raw)}% now)`);
      table.push([ID, '(cpu, VIBES)', '', '', '', '', fmt(cpu.idle) + '%']);
    }
    table.push([ID, BARS[b], m.lufs, m.truePeak, `${Math.round(c[0][0])}/${Math.round(c[1][0])}`, fmt(span), '']);
  }
  // the mallet is tied to the bar's period: the 2nd mode against the 1st, over the first 12 periods (long DECAY, so the
  // modes barely fall inside the window), is the same at C3, C4 and C6
  const m2 = [48, 60, 84].map((p) => { const f0 = mtof(p), x = mono(play(ID, [{ p, v: 0.8, t: 0, d: 1 }], { room: 0, decay: 2.5 }, 1.2, 0.1)), n = Math.round(12 * SR / f0); return dB(goertzel(x, 0, n, 3.99 * f0)) - dB(goertzel(x, 0, n, f0)); });
  t.ok(Math.max(...m2) - Math.min(...m2) <= 2, `mallets: the mallet's contact follows the bar's period: the 2nd mode sits ${m2.map((x) => fmt(x)).join(' / ')} dB under the 1st at C3 / C4 / C6 (within 2 dB)`);
  // the vibes motor
  for (const motor of [2.5, 6]) {
    const x = mono(play(ID, [{ p: 60, v: 0.8, t: 0, d: 6 }, { p: 64, v: 0.8, t: 0, d: 6 }], { bar: 1, motor, room: 0, damp: 4 }, 6, 0));
    const { hz } = modRate(x, 0.5, 4.5);
    t.ok(Math.abs(hz - motor) <= 0.1, `mallets VIBES: the motor pulses the tone at ${fmt(hz, 2)} Hz (MOTOR ${motor})`);
  }
  // DAMP stops a bar
  const held = mono(play(ID, [{ p: 60, v: 0.8, t: 0, d: 3 }], { bar: 1, damp: 0.1, room: 0, motor: 0 }, 3, 0.2)), let0 = mono(play(ID, [{ p: 60, v: 0.8, t: 0, d: 0.5 }], { bar: 1, damp: 0.1, room: 0, motor: 0 }, 3, 0.2));
  const dd = dB(rms(held, 1.1, 1.3)) - dB(rms(let0, 1.1, 1.3));
  t.ok(dd >= 30, `mallets: DAMP stops a ringing vibes bar (${fmt(dd)} dB quieter 0.6 s after letting go than held)`);
}

// ------------------------------------------------------------------------------------------------ core.drums
console.log('core.drums (Gobo Kit): 808, 909 and ACOUSTIC+');
if (defs['core.drums']) {
  const ID = 'core.drums', KITS = ['FIELD', 'MACHINE', 'DUST', '808', '909', 'ACOUSTIC+'];
  // the first three kits, bit-identical to their sound before 808, 909 and ACOUSTIC+ were appended (Node 24, arm64)
  const BEFORE = { 0: '6dc1cb909eb6da45', 1: 'f352797dfbb08c8a', 2: '4ba8caf6d282bd07' };
  const ph = drumPhrase().map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT }));
  const hashes = [0, 1, 2].map((kit) => sha(play(ID, ph, { kit, decay: 1.4, tone: 0.3, drive: 0.4 }, DRUM_PHRASE_BEATS * BEAT, 2)));
  const sameEngine = process.versions.node.split('.')[0] === '24' && process.arch === 'arm64';
  if (sameEngine) t.ok(hashes.every((h, k) => h === BEFORE[k]), `FIELD, MACHINE and DUST render exactly as before the new kits (${hashes.join(' ')})`);
  else t.note(`FIELD, MACHINE and DUST hashes ${hashes.join(' ')} (pinned on Node 24 arm64; this is ${process.versions.node} ${process.arch})`);
  // every kit on every piece the map knows (35-82, an open hat choked, the ride's stick and the cymbals' bloom past
  // their tails), off its defaults: bit-identical to its sound before the kit's CPU pass (block-wise modes and bus)
  const ALL = [];
  for (let p = 35; p <= 82; p++) ALL.push({ p, v: 0.3 + 0.7 * ((p * 37) % 11) / 10, t: (p - 35) * 0.15, d: 0.05 });
  ALL.push({ p: 46, v: 0.9, t: 7.3, d: 0.05 }, { p: 42, v: 0.5, t: 7.6, d: 0.05 });
  const PASS = { 0: '0179ddbc2b943477', 1: '74f05e6a5224ca25', 2: '32d9d176b013fc63', 3: '27c4afc7f482b406', 4: '291a433c5d31f605', 5: '89c9ab5a713e89dd' };
  const every = KITS.map((_, kit) => sha(play(ID, ALL, { kit, tune: 3, decay: 1.4, tone: 0.3, drive: 0.4, room: 0.5 }, 8, 3)));
  if (sameEngine) t.ok(every.every((h, k) => h === PASS[k]), `every kit plays every piece exactly as before the CPU pass (${every.join(' ')})`);
  else t.note(`every kit, every piece: ${every.join(' ')} (pinned on Node 24 arm64; this is ${process.versions.node} ${process.arch})`);
  const hit = (kit, p, v = 0.8, extra = {}) => mono(play(ID, [{ p, v, t: 0, d: 0.1 }], { kit, room: 0, drive: 0, ...extra }, 1.5, 0.3));
  for (const kit of [3, 4, 5]) {
    const m = houseRules(ID, `drums ${KITS[kit]}`, { kit }, true);
    // every param at its ends, with this kit
    let bad = 0, worst = -Infinity;
    for (const extra of [{ tune: -12, decay: 0.3, tone: -1, drive: 0, width: 0, room: 0 }, { tune: 12, decay: 2.5, tone: 1, drive: 1, width: 1, room: 1 }]) {
      const r = play(ID, ph, { kit, ...extra }, DRUM_PHRASE_BEATS * BEAT, 2);
      for (const c of r.channels) for (let i = 0; i < c.length; i++) { if (!Number.isFinite(c[i])) bad++; const a = Math.abs(c[i]); if (a > worst) worst = a; }
    }
    t.ok(!bad && dB(worst) <= 0, `drums ${KITS[kit]}: every param at min and at max renders (no NaN, peak ${fmt(dB(worst))} dBFS)`);
    const k = hit(kit, 36, 1), f = peakFreq(k, Math.round(0.05 * SR), 9600, 52, 0.25);
    t.ok(f >= 45 && f <= 60, `drums ${KITS[kit]}: the kick's fundamental after 50 ms is ${fmt(f)} Hz (45-60)`);
    const cp = bursts(hit(kit, 39, 0.9));
    t.ok(cp >= 3, `drums ${KITS[kit]}: the clap is ${cp} bursts in its first 40 ms (want 3 or more)`);
    const he = envelope(hit(kit, 42, 0.8), 0.002), hp = Math.max(...he), hi = he.indexOf(hp);
    let t40 = Infinity; for (let i = hi; i < he.length; i++) if (he[i] < hp - 40) { t40 = (i - hi) * 2; break; }
    t.ok(t40 >= 150 && t40 <= 250, `drums ${KITS[kit]}: the closed hat falls 40 dB in ${t40} ms (150-250)`);
    const choked = mono(play(ID, [{ p: 46, v: 0.8, t: 0, d: 0.1 }, { p: 42, v: 0.01, t: 0.2, d: 0.1 }], { kit, room: 0 }, 1.5, 0.3)), open = hit(kit, 46, 0.8);
    const drop = dB(rms(open, 0.215, 0.235)) - dB(rms(choked, 0.215, 0.235));
    t.ok(drop >= 10, `drums ${KITS[kit]}: a closed hat chokes the open one (${fmt(drop)} dB down 15-35 ms later)`);
    table.push([ID, KITS[kit], m.lufs, m.truePeak, `kick ${fmt(f)} Hz`, `hat ${t40} ms`, `clap x${cp}`]);
  }
  // the 808 kick has no click, the 909's has one, and TONE sets it
  const click = (kit, extra = {}) => { const x = hit(kit, 36, 1, extra); return 10 * Math.log10(hfEnergy(x, 0, Math.round(0.005 * SR)) / energy(x, 0, Math.round(0.05 * SR))); };
  const c8 = click(3), c9 = click(4), c9lo = click(4, { tone: -1 }), c9hi = click(4, { tone: 1 }), cF = click(0);
  t.ok(c8 <= -55, `drums 808: no click on the kick (energy above 3 kHz in the first 5 ms ${fmt(c8)} dB against the first 50 ms; FIELD ${fmt(cF)})`);
  t.ok(c9 >= -40 && c9 - c8 >= 25, `drums 909: the kick's click (${fmt(c9)} dB above 3 kHz in the first 5 ms, ${fmt(c9 - c8)} dB more than the 808)`);
  t.ok(c9hi - c9lo >= 6, `drums 909: TONE sets the click (${fmt(c9lo)} dB at -1, ${fmt(c9hi)} dB at +1)`);
  // the 808's DECAY is the resonance: a longer boom
  const boom = (decay) => { const e = envelope(hit(3, 36, 1, { decay }), 0.01), pk = Math.max(...e), ip = e.indexOf(pk); for (let i = ip; i < e.length; i++) if (e[i] < pk - 40) return (i - ip) * 0.01; return Infinity; };
  const b1 = boom(1), b2 = boom(1.8);
  t.ok(b2 >= 1.5 * b1 && b1 >= 0.4, `drums 808: DECAY lengthens the boom (-40 dB after ${fmt(b1, 2)} s at 1, ${fmt(b2, 2)} s at 1.8)`);
  // velocity colour: ACOUSTIC+'s beater and stick against FIELD's
  const vc = (kit, p) => drumC0(hit(kit, p, 1)) / drumC0(hit(kit, p, 0.4));
  const kF = vc(0, 36), kA = vc(5, 36), tF = vc(0, 45), tA = vc(5, 45);
  t.ok(kA >= 1.5, `drums ACOUSTIC+: a harder kick is brighter: onset centroid x${fmt(kA, 2)} from velocity 0.4 to 1.0 (want 1.5; FIELD x${fmt(kF, 2)})`);
  t.ok(tA >= 1.3, `drums ACOUSTIC+: so is a harder tom: x${fmt(tA, 2)} (want 1.3; FIELD x${fmt(tF, 2)})`);
  // CPU: the drum phrase per kit, against FIELD, at most 1.5x. Timed in CPU time, not wall time: under load a render's
  // wall time counts the time it waits for a core. Even CPU time moves about 2x with the core it lands on and the
  // load beside it, so the kits take turns (FIELD, 808, 909, ACOUSTIC+, rotated each round so none always follows
  // another) and each keeps its best, its cost on a quiet core. It stops once every best, FIELD's included, has held
  // (no kit 4% cheaper for two rounds), so a FIELD that never got a quiet core can't flatter the others; six rounds at
  // least, sixteen at most, and while a kit is over budget it keeps going (more turns only bring a best down to its
  // true cost, never below it).
  const DK = [0, 3, 4, 5], DRUM_BUDGET = 1.5, secs = DRUM_PHRASE_BEATS * BEAT + 2, best = {};
  for (const kit of DK) best[kit] = Infinity;
  let rounds = 0, still = 0;
  for (; rounds < 16; ) {
    let moved = false;
    for (let j = 0; j < DK.length; j++) {
      const kit = DK[(rounds + j) % DK.length], ms = play(ID, ph, { kit }, DRUM_PHRASE_BEATS * BEAT, 2).cpuMs;
      if (ms < best[kit] * 0.96) moved = true;
      best[kit] = Math.min(best[kit], ms);
    }
    rounds++;
    still = moved ? 0 : still + 1;
    if (rounds >= 6 && still >= 2 && [3, 4, 5].every((kit) => best[kit] <= best[0] * DRUM_BUDGET)) break;
  }
  const ratio = (kit) => best[kit] / best[0], pct = (ms) => ms / (secs * 1000) * 100;
  t.ok([3, 4, 5].every((kit) => ratio(kit) <= DRUM_BUDGET), `drums: the new kits cost about what FIELD does on the drum phrase (808, 909, ACOUSTIC+ at ${[3, 4, 5].map((kit) => fmt(ratio(kit), 2)).join(', ')} x FIELD's ${fmt(pct(best[0]))}% of a core in CPU time; budget ${DRUM_BUDGET}x; best of ${rounds} interleaved)`);
}
// ------------------------------------------------------------------------------------------------ presets
console.log('presets: a sound by name');
{
  const { getDevice } = await import('../app/src/devices/registry.js');
  const rows = [];
  for (const id of ['core.ep', 'core.mallets', 'core.drums']) {
    const d = getDevice(id), drums = id === 'core.drums';
    t.ok(d && d.presets && d.presets.length >= 4, `${id} carries ${d && d.presets ? d.presets.length : 0} presets (${d && d.presets ? d.presets.map((p) => p.name).join(', ') : ''})`);
    const ph = (drums ? drumPhrase() : phrase()).map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT }));
    for (const pr of (d && d.presets) || []) { const m = measure(play(id, ph, pr.params, (drums ? DRUM_PHRASE_BEATS : PHRASE_BEATS) * BEAT, 2)); rows.push([id, pr.name, m.lufs, m.truePeak]); }
  }
  const off = rows.filter(([, , l, tp]) => !(l >= -20 && l <= -12) || tp > -1);
  t.ok(!off.length, `every preset plays the test phrase at -20..-12 LUFS with true peaks at or under -1 dBTP (${rows.length} presets${off.length ? '; off: ' + off.map((r) => `${r[0]} "${r[1]}" ${r[2]} LUFS ${r[3]} dBTP`).join(', ') : ''})`);
  t.note(rows.map((r) => `${r[0]} "${r[1]}" ${r[2]} LUFS ${r[3]} dBTP`).join(' | '));
}
console.log('\n  ' + ['id', 'setting', 'LUFS', 'dBTP', 'colour', 'register / hat', 'cpu / clap'].join(' | ') + '\n' + table.map((r) => '  ' + r.join(' | ')).join('\n') + '\n');

// ------------------------------------------------------------------------------------------------ the device check, in Chromium
if (!process.env.NODE_ONLY) {
  console.log('checkDevice in Chromium (full mode)');
  const { open } = await import('./pw.js');
  const { page, errors, close } = await open('/app/');
  try {
    // the two new instruments, and the kit with each new option as its default (a def under a test id)
    for (const [id, kit] of [['core.ep'], ['core.mallets'], ['core.drums', 3], ['core.drums', 4], ['core.drums', 5]]) {
      const r = await page.evaluate(async ({ id, kit }) => {
        const { getDevice } = await import('/app/src/devices/registry.js');
        const { checkDevice, summarize } = await import('/app/src/kernel/check.js');
        await import('/app/src/devices/builtin/index.js');
        let def = getDevice(id);
        if (kit != null) def = { ...def, id: 'test.drums-' + kit, params: def.params.map((p) => (p.key === 'kit' ? { ...p, def: kit } : p)) };
        const rep = await checkDevice(def);
        return { ok: rep.ok, errors: rep.errors, warnings: rep.warnings, sum: summarize(rep), worst: rep.extremes && rep.extremes.worstPeak, failed: rep.extremes && rep.extremes.failed };
      }, { id, kit });
      const tag = kit != null ? `${id} (KIT ${['FIELD', 'MACHINE', 'DUST', '808', '909', 'ACOUSTIC+'][kit]})` : id;
      t.ok(r.ok, `${tag}: checkDevice ok: ${r.sum}${r.ok ? '' : ' | ' + r.errors.join(' | ')}`);
      t.ok(!r.warnings.length, `${tag}: no check warnings${r.warnings.length ? ': ' + r.warnings.join(' | ') : ''}`);
      t.ok(!(r.failed && r.failed.length), `${tag}: every param at min and max renders (worst raw peak ${r.worst} dBFS)`);
    }
    // the faces at phone width: a six-option KIT and a five-option BAR become menus, and nothing spills
    await page.setViewportSize({ width: 390, height: 844 });
    const faces = await page.evaluate(async () => {
      const { getDevice } = await import('/app/src/devices/registry.js');
      const { renderFace } = await import('/app/src/ui/faces.js');
      const out = {};
      for (const id of ['core.ep', 'core.mallets', 'core.drums']) {
        const f = renderFace(getDevice(id), {}, {}).el; document.body.appendChild(f);
        out[id] = { selects: [...f.querySelectorAll('select')].map((x) => x.options.length), spill: f.scrollWidth > f.clientWidth + 1 || f.getBoundingClientRect().right > innerWidth + 1 };
        f.remove();
      }
      return out;
    });
    t.ok(faces['core.drums'].selects.includes(6) && faces['core.mallets'].selects.includes(5) && Object.values(faces).every((f) => !f.spill), `the faces fit a 390 px phone: KIT is a menu of ${faces['core.drums'].selects.join(',')}, BAR of ${faces['core.mallets'].selects.join(',')}, nothing spills (${JSON.stringify(faces)})`);
    const mine = errors.filter((e) => /devices\/builtin\/(ep|mallets|drums)/.test(e));
    t.ok(!mine.length, `no page errors from these instruments${mine.length ? ': ' + mine.join(' | ') : ''}`);
  } finally { await close(); }
}
t.done();
