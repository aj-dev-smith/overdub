// Light Table's window (ui/editors/wavetable.js, docs/research/LIGHT-TABLE.md section 7). First, in Node, the page's
// maths against the kernel's own renders (wavetable.js warpCycle, filterResponse, envAt): what the window draws is what
// plays. Then the window in Chromium:
//   desktop   it opens with its own editor, a control for each of the 114 params, and fits a 1440 x 900 screen with
//             the window's presets, A/B and keyboard; the 3D table draws the current table and POS moves its lit frame;
//             the warp redraws the frame with the kernel's maths; the picker sets the table; an envelope drag is one
//             undo step; drag to modulate fills the first free slot, its ring drag sets the amount and right-clicking
//             it empties the slot (each one undo step, signed you); a click and Enter patch from the keyboard; "all 8
//             slots" says so; the matrix reads as sentences; an agent's slot shows its ring flashing in its ink; the LFO
//             dot, the ghost frame and the filter move while the song plays, inside a frame-time budget; every control
//             takes focus and the arrow keys; a ring and its square keep off the knob's name and value, the square an
//             18 px target; an envelope's point drags at a knob's rate, under the pointer; History names each change
//             in words with its value; no page errors
//   1280x800  the whole synth fits the window with nothing to scroll, all 8 slots in use too
//   touch     on a touch screen the window says tap and slide, never right-click, Alt, click or drag
//   phone     one section at a time under seven tabs, 44 px targets, 12 px text, nothing running out sideways; a patch
//             made across tabs
//   node tools/wavetable-ui-test.js        NODE_ONLY=1 skips the browser; screenshots: tools/.out/wavetable-ui-*.png
import { open, tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { createProject } from '../app/src/core/project.js';
import { getDevice } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import { lightTables, TABLE_NAMES } from '../app/src/devices/builtin/wavetables.js';
import { WARPS, FILTERS, SYNC_BEATS, DELAY_BEATS, warpCycle, warpValue, filterResponse, envAt } from '../app/src/devices/builtin/wavetable.js';

const t = tally('wavetable-ui');
const ok = t.ok;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const ID = 'core.wavetable', SR = 48000;
const def = getDevice(ID);
const LT = lightTables();
const ours = (errors) => errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext|getUserMedia/.test(e));

/* ======================================================================== Node: the page's maths, held to the kernel */
const vals = (params) => { const out = {}; for (const [k, v] of Object.entries(params)) { const p = def.params.find((q) => q.key === k); if (!p) throw new Error('no param ' + k); out[k] = typeof v === 'string' && p.opts ? p.opts.indexOf(v) : v; } return out; };
function play(p, params, secs = 1) {
  const beats = Math.ceil(secs * 2);
  const proj = { ...createProject(), id: 'p_ltui', title: 'lt ui', key: null, tempo: 120, meta: { created: '2026-10-03T00:00:00.000Z', modified: '2026-10-03T00:00:00.000Z', authors: {} },
    tracks: [{ id: 't1', name: 'LT', kind: 'instrument', instrument: { device: ID, params: vals(params) }, inserts: [], clips: [{ id: 'c1', kind: 'notes', start: 0, length: beats, notes: [{ id: 'n1', by: 'overdub', p, t: 0, d: secs * 2, v: 0.8 }], by: 'overdub' }], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub' }] };
  const r = renderSong(proj, { from: 0, to: beats, tail: 0 });
  if (r.warnings.length) throw new Error('render warnings: ' + JSON.stringify(r.warnings));
  const [L, R] = r.channels, m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (L[i] + R[i]);
  return m;
}
console.log('the page\'s maths against the kernel');
{
  // The warps: a held A1, one oscillator, around the filter, against warpCycle on the frame the kernel reads at that
  // pitch (its band limit, the spectrum cut there) and through the output's DC blocker; then the plain frame, which the
  // same check must tell apart
  const flim = Math.min(0.6, Math.max(0.45, (SR - 20000) / SR));
  const mipOf = (dt) => { const x = Math.log2(1024 * dt / flim); return x <= 0 ? 0 : x >= 10 ? 10 : Math.ceil(x); };
  const band = (ti, x, K, n = 2048) => { const sp = LT.spectrum(ti, x), g = LT.gain(ti, x), out = new Float32Array(n); for (let i = 0; i < n; i++) { const ph = 2 * Math.PI * i / n; let y = 0; for (let k = 1; k <= K; k++) y += sp.a[k] * Math.sin(k * ph) + sp.b[k] * Math.cos(k * ph); out[i] = y * g; } return out; };
  const read = (arr) => (ph) => { const xx = ph * arr.length, k = xx | 0, f = xx - k; return arr[k % arr.length] + (arr[(k + 1) % arr.length] - arr[k % arr.length]) * f; };
  function corrBest(x, at, n, f0, cyc) {
    const per = Math.ceil(SR / f0), N = at + n + per, e = new Float64Array(N), aDc = Math.exp(-2 * Math.PI * 10 / SR);
    let x1 = 0, y1 = 0;
    for (let i = 0; i < N; i++) { const tt = i * f0 / SR, v = cyc(tt - Math.floor(tt)); y1 = v - x1 + aDc * y1; x1 = v; e[i] = y1; }
    let best = -1;
    for (let lag = 0; lag < per; lag++) { let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const y = e[at + i + per - lag], v = x[at + i]; sxy += v * y; sxx += v * v; syy += y * y; } best = Math.max(best, sxy / Math.sqrt(sxx * syy + 1e-30)); }
    return best;
  }
  const CLEAN = { a_unison: 1, flt_a: 'OFF', fx_verb_mix: 0, env1_attack: 0.001, env1_sustain: 1, env1_vel: 0, b_level: 0 };
  const rows = [];
  for (const [tab, pos, warp, amt] of [['BASIC', 0, 'SYNC', 0.5], ['VOWEL', 0.375, 'BEND', 0.9], ['BASIC', 1 / 3, 'PW', 0.7], ['BASIC', 2 / 3, 'MIRROR', 0.8], ['BASIC', 2 / 3, 'FM', 0.6]]) {
    const ti = TABLE_NAMES.indexOf(tab), cycles = LT.TABLES[ti].cycles, note = 33, f0 = 440 * Math.pow(2, (note - 69) / 12), inc = f0 / SR;
    const mode = WARPS.indexOf(warp), wv = warpValue(mode, amt);
    const wf = mode === 1 ? wv : mode === 2 ? 1 + wv : mode === 3 ? 3.2 / Math.max(0.05, wv) : mode === 5 ? 1 + 4 * wv : 1;
    const src = band(ti, pos, LT.MK[mipOf(inc * (mode === 4 ? 1 : wf) / cycles)]);
    const fmSrc = mode === 5 ? LT.frame(0, 0, 2048) : null;
    let drawn = warpCycle(src, mode, amt, { cycles, out: new Float32Array(4096), fm: fmSrc ? read(fmSrc) : null });
    if (mode === 4) { const mir = warpCycle(band(ti, pos, LT.MK[mipOf(inc * 4.5 / cycles)]), 4, 1, { cycles, out: new Float32Array(4096) }); const plain = warpCycle(src, 0, 0, { cycles, out: new Float32Array(4096) }); drawn = plain.map((y, i) => y + (mir[i] - y) * amt); }
    const x = play(note, { ...CLEAN, a_table: tab, a_pos: pos, a_warp: warp, a_warp_amt: amt, ...(mode === 5 ? { b_table: 'BASIC', b_pos: 0, b_oct: 0 } : {}) });
    const at = Math.round(0.5 * SR), n = Math.round(4 * cycles * SR / f0);
    rows.push({ warp, tab, w: corrBest(x, at, n, f0 / cycles, read(drawn)), p: corrBest(x, at, n, f0 / cycles, read(src)) });
  }
  ok(rows.every((r) => r.w >= 0.998 && r.w > r.p + 0.005), `the warps draw what plays: a rendered cycle against the page's warpCycle, ${rows.map((r) => `${r.warp} on ${r.tab} ${fmt(r.w, 4)} (plain ${fmt(r.p, 3)})`).join(', ')} (want 0.998 or more, and above the plain frame)`);

  // The filters: seeded noise through each type and around it (the same noise), the ratio of the two averaged spectra in
  // third-octave bands against filterResponse, wherever the curve is above -40 dB
  const fft = (re, im) => { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let q = re[i]; re[i] = re[j]; re[j] = q; q = im[i]; im[i] = im[j]; im[j] = q; } } for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), hh = len >> 1; for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < hh; j++) { const k = i + j + hh, vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr; re[k] = re[i + j] - vr; im[k] = im[i + j] - vi; re[i + j] += vr; im[i + j] += vi; const q = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = q; } } } };
  const welch = (x, from, to, N = 4096) => { const P = new Float64Array(N / 2); let c = 0; for (let at = from; at + N <= to; at += N / 2) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = x[at + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); fft(re, im); for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; c++; } for (let k = 0; k < N / 2; k++) P[k] /= c; return P; };
  const NOISE = { a_level: 0, b_level: 0, noise_level: 1, noise_color: 1, flt_key: 0, flt_env: 0, flt_vel: 0, flt_drive: 0, fx_verb_mix: 0, env1_attack: 0.001, env1_sustain: 1, env1_vel: 0 };
  const errs = [];
  for (const [type, fc, res] of [['LP24', 1500, 0.7], ['BP', 1000, 0.5], ['NOTCH', 990, 0.2], ['COMB', 400, 0.6], ['FORMANT', 2500, 0.6]]) {
    const ty = FILTERS.indexOf(type), yes = play(60, { ...NOISE, flt_type: type, flt_cutoff: fc, flt_res: res, flt_noise: 'ON' }, 2), no = play(60, { ...NOISE, flt_type: type, flt_cutoff: fc, flt_res: res, flt_noise: 'OFF' }, 2);
    const a = Math.round(0.3 * SR), b = Math.round(1.9 * SR), Py = welch(yes, a, b), Pn = welch(no, a, b), bin = SR / 4096;
    let worst = 0;
    for (let f = 40; f <= 16000; f *= Math.pow(2, 1 / 3)) {
      const lo = Math.max(1, Math.floor(f / Math.pow(2, 1 / 6) / bin)), hi = Math.ceil(f * Math.pow(2, 1 / 6) / bin);
      let sy = 0, sn = 0; const freqs = [];
      for (let k = lo; k <= hi; k++) { sy += Py[k]; sn += Pn[k]; freqs.push(k * bin); }
      const want = 10 * Math.log10(filterResponse(ty, fc, res, freqs).reduce((s, d) => s + Math.pow(10, d / 10), 0) / freqs.length);
      if (want > -40) worst = Math.max(worst, Math.abs(10 * Math.log10(sy / sn) - want));
    }
    errs.push([type, worst]);
  }
  ok(errs.every(([, e]) => e <= 1), `the filter's curve is its response: noise through each type against filterResponse, worst third-octave error ${errs.map(([ty, e]) => `${ty} ${fmt(e, 2)}`).join(', ')} dB (want 1 dB or less)`);

  // The envelope: a 1 kHz sine with a slow, bent attack and a decay, its level every 10 ms against envAt
  const E = { attack: 0.3, decay: 0.25, sustain: 0.4, release: 0.3, curve: -0.6 };
  const x = play(83, { a_unison: 1, a_table: 'BASIC', a_pos: 0, flt_a: 'OFF', fx_verb_mix: 0, env1_vel: 0, env1_attack: E.attack, env1_decay: E.decay, env1_sustain: E.sustain, env1_release: E.release, env1_curve: E.curve }, 1.2);
  const level = (t0) => { const a = Math.round(t0 * SR) - 120, b = a + 240; let pk = 0; for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(x[i] || 0)); return pk; };
  const peak = level(E.attack);
  let worstEnv = 0;
  for (let tt = 0.03; tt < 0.8; tt += 0.01) worstEnv = Math.max(worstEnv, Math.abs(level(tt) / peak - envAt(E, tt).v));
  ok(worstEnv < 0.03, `the drawn envelope is the kernel's: a rendered attack (curve -0.6) and decay against envAt, worst ${fmt(worstEnv * 100, 1)}% off over 0.8 s (want under 3%)`);
  // and the page's constants are the kernel's own
  const lit = (name) => { const m = new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(def.kernel); return m ? new Function('return ' + m[1])() : null; };
  const near = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
  ok(near(lit('SYNC_BEATS'), SYNC_BEATS) && near(lit('DELAY_BEATS'), DELAY_BEATS), 'the page\'s SYNC_BEATS and DELAY_BEATS are the kernel\'s');
  ok(def.editor === 'wavetable' && def.source === 'builtin', `Light Table names its own window (editor: "${def.editor}")`);
}

if (process.env.NODE_ONLY) { t.done(); process.exit(); }

/* ======================================================================== Chromium: the window on a desktop */
async function openLT(page) {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(400);
  await page.evaluate(() => { document.querySelector('.ar-welcome-x')?.click(); const a = window.overdub; const tr = a.store.get().tracks.find((x) => x.instrument?.device === 'core.wavetable'); a.plugin.open({ track: tr.id, slot: 'instrument' }); });
  await page.waitForFunction(() => document.querySelector('.pw')?.dataset.editor === 'wavetable', null, { timeout: 15000 });
  await sleep(500);
  // (toasts float over the window: none in the way)
  await page.evaluate(() => { document.querySelectorAll('.ew-toast').forEach((x) => x.remove()); });
}
{
  const s = await open('/app/', { query: 'device=core.wavetable', width: 1440, height: 900 });
  const { page, errors, shot } = s;
  page.setDefaultTimeout(15000);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const at = (sel) => E((q) => { const e = document.querySelector(q); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);
  // the params as the device plays them (the defaults under what's set)
  const P = () => E(() => { const a = window.overdub, d = a.devices.getDevice('core.wavetable'); return a.devices.paramValues(d, a.store.track(a.plugin.current.track).instrument.params); });
  const hist = () => E(() => { const a = window.overdub, h = a.store.history, l = h[h.length - 1]; return { n: h.length, label: l?.label, by: l?.by }; });
  const set = (params, by = 'you') => E(({ params: pp, by: b }) => { const a = window.overdub; return a.store.dispatch({ type: 'instrument.set', track: a.plugin.current.track, params: pp }, { by: b, label: 'wavetable-ui test' }).ok; }, { params, by });
  try {
    await openLT(page);
    /* -------- it opens with its own editor */
    const o = await E(() => {
      const w = document.querySelector('.pw'), body = w.querySelector('.pw-body'), r = w.getBoundingClientRect();
      const keys = new Set([...body.querySelectorAll('.pk-ctl[data-key]')].map((x) => x.dataset.key));
      const want = window.overdub.devices.getDevice('core.wavetable').params.filter((p) => !p.hidden).map((p) => p.key);
      return { editor: w.dataset.editor, lt: !!body.querySelector('.lt'), generic: !!body.querySelector('.pg'), cur: window.overdub.plugin.current.editor, missing: want.filter((k) => !keys.has(k)), n: want.length,
        overflowX: body.scrollWidth - body.clientWidth, overflowY: body.scrollHeight - body.clientHeight, onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        bar: !!w.querySelector('.pw-bar .pw-pre') && !!w.querySelector('.pw-bar .pw-ab'), keys: !!w.querySelector('.pw-keys:not([hidden]) .pk-keys'), size: [Math.round(r.width), Math.round(r.height)] };
    });
    ok(o.editor === 'wavetable' && o.lt && !o.generic && o.cur === 'wavetable', `the window opens with Light Table's own editor, not the generic one (${o.editor}, app.plugin.current.editor ${o.cur})`);
    ok(!o.missing.length, `a control for each of its ${o.n} params${o.missing.length ? ': missing ' + o.missing.join(', ') : ''}`);
    ok(o.overflowX <= 1 && o.overflowY <= 1 && o.onScreen, `the whole synth fits a 1440 x 900 screen: nothing runs out sideways or below (${o.overflowX}, ${o.overflowY} px over; the window ${o.size.join(' x ')})`);
    ok(o.bar && o.keys, 'the window\'s own parts sit around it: the presets and A/B above, the keyboard below');
    await shot('wavetable-ui-desktop');

    /* -------- the 3D table: the current table, the lit frame where POS is */
    const draws = await E(async () => {
      const { lightTables } = await import('/app/src/devices/builtin/wavetables.js');
      const LTp = lightTables(), L = document.querySelector('.lt').__lt, st = L.osc('a');
      const fr = LTp.frames(st.table, 256), fp = st.pos * 48, f0 = Math.min(47, Math.floor(fp)), w = fp - f0;
      let worst = 0;
      for (let i = 0; i < 128; i++) { const want = fr[f0][2 * i] + (fr[f0 + 1][2 * i] - fr[f0][2 * i]) * w; worst = Math.max(worst, Math.abs(want - st.lit[i])); }
      const g = st.canvas.getContext('2d'), dpr = st.canvas.width / st.canvas.clientWidth;
      const ink = st.litPts.map(([x, y]) => { const d = g.getImageData(Math.round(x * dpr) - 1, Math.round(y * dpr) - 1, 3, 3).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i] + d[i + 1] + d[i + 2]); return m; });
      return { table: st.table, pos: st.pos, worst, ink, view: st.view };
    });
    ok(draws.view === '3d' && draws.worst < 1e-5, `the 3D view draws the current table: its lit frame is the table's own (${TABLE_NAMES[draws.table]}, POS ${draws.pos}) between its two nearest frames, off by ${draws.worst.toExponential(1)}`);
    ok(draws.ink.every((v) => v > 500), `…and it is drawn there, in the lit ink, at each of 8 points along it (brightness ${Math.min(...draws.ink)} at the dimmest)`);
    const sig0 = await E(() => document.querySelector('.lt').__lt.osc('a').layerSig);
    await page.focus('.lt-osc[data-sec="osca"] .lt-tv canvas');
    const hp0 = await hist();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
    await sleep(150);
    const moved = await E(() => { const L = document.querySelector('.lt').__lt.osc('a'); const g = L.canvas.getContext('2d'), dpr = L.canvas.width / L.canvas.clientWidth; return { pos: L.pos, sig: L.layerSig, pts: L.litPts, ink: L.litPts.map(([x, y]) => { const d = g.getImageData(Math.round(x * dpr) - 1, Math.round(y * dpr) - 1, 3, 3).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i] + d[i + 1] + d[i + 2]); return m; }), where: document.querySelector('.lt-osc[data-sec="osca"] .lt-where').textContent }; });
    const frameTo = (Math.round(draws.pos * 48) + 6) / 48;
    ok(Math.abs(moved.pos - frameTo) < 0.003 && moved.sig !== sig0 && moved.ink.every((v) => v > 500) && moved.where === `frame ${Math.round(frameTo * 48) + 1} of 49`, `POS moves the lit frame through the stack: six frames up the table with the arrow keys (POS ${draws.pos} → ${moved.pos}, "${moved.where}"), and it is drawn there (brightness ${Math.min(...moved.ink)} at the dimmest)`);
    const dv = await at('.lt-osc[data-sec="osca"] .lt-tv canvas');
    await sleep(1600);   // (a gesture on the same knob within 1.5 s joins the last undo step, as every control's does)
    const hp1 = await hist();
    await E(() => document.querySelector('.lt').__lt.resetStats());
    await page.mouse.move(dv.x, dv.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(dv.x, dv.y + i * 6); await sleep(20); }
    await page.mouse.up();
    await sleep(120);
    const dragPos = await P(), hp2 = await hist(), recut = await E(() => document.querySelector('.lt').__lt.parts()['lt-tv-cv']);
    ok(dragPos.a_pos < moved.pos && hp2.n - hp1.n === 1 && hp2.by === 'you', `dragging down the table takes POS back toward the front, one undo step (${moved.pos} → ${dragPos.a_pos}; ${hp2.n - hp1.n} step, ${hp2.by})`);
    ok(recut && recut.n >= 4 && recut.max < 8, `…re-cutting the stack as it goes in ${recut ? fmt(recut.max, 1) : '?'} ms at worst over ${recut?.n} draws (budget 8 ms)`);
    void hp0;

    /* -------- the warp redraws the frame with the kernel's maths */
    await page.click('.lt-osc[data-sec="osca"] .lt-warpw .pk-seg-b:nth-child(3)');   // BEND
    await set({ a_warp_amt: 0.6 });
    await sleep(150);
    const warped = await E(async () => {
      const { lightTables } = await import('/app/src/devices/builtin/wavetables.js');
      const W = await import('/app/src/devices/builtin/wavetable.js');
      const LTp = lightTables(), L = document.querySelector('.lt').__lt, st = L.osc('a');
      const fr = LTp.frames(st.table, 256), fp = st.pos * 48, f0 = Math.min(47, Math.floor(fp)), w = fp - f0;
      const src = fr[f0].map((v, i) => v + (fr[f0 + 1][i] - v) * w);
      const want = W.warpCycle(src, 2, 0.6, { cycles: LTp.TABLES[st.table].cycles, out: new Float32Array(128) });
      const plain = W.warpCycle(src, 0, 0, { out: new Float32Array(128) });
      const idx = [5, 21, 37, 53, 69, 85, 101, 117];
      const P = window.overdub.store.track(window.overdub.plugin.current.track).instrument.params;
      return { warp: P.a_warp, worst: Math.max(...idx.map((i) => Math.abs(want[i] - st.lit[i]))), moved: Math.max(...idx.map((i) => Math.abs(plain[i] - st.lit[i]))), pressed: document.querySelector('.lt-osc[data-sec="osca"] .lt-warpw .sel-print')?.textContent };
    });
    ok(warped.warp === 2 && warped.pressed === 'BEND' && warped.worst < 1e-6 && warped.moved > 0.02, `the warp reshapes the drawn frame by the kernel's phase map: BEND 0.6 at 8 points off by ${warped.worst.toExponential(1)} (the plain frame is ${fmt(warped.moved, 3)} away)`);
    await shot('wavetable-ui-warp');
    await set({ a_warp: 0, a_warp_amt: 0 });

    /* -------- the table picker */
    const hk0 = await hist();
    await page.click('.lt-osc[data-sec="osca"] .lt-pick');
    await page.waitForSelector('.lt-pop .lt-opt');
    await sleep(500);
    const pick = await E(() => ({ n: document.querySelectorAll('.lt-pop .lt-opt').length, words: [...document.querySelectorAll('.lt-pop .lt-opt small')].every((x) => x.textContent.trim().split(/\s+/).length >= 2), drawn: [...document.querySelectorAll('.lt-pop canvas')].filter((c) => c.width > 0).length, focus: document.activeElement?.dataset.t, sel: document.querySelector('.lt-pop [aria-selected="true"]')?.dataset.t }));
    await shot('wavetable-ui-picker');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await sleep(150);
    const picked = await P(), hk1 = await hist();
    const pickLabel = await E(() => document.querySelector('.lt-osc[data-sec="osca"] .lt-pick-n').textContent);
    ok(pick.n === 14 && pick.words && pick.drawn === 14 && pick.focus === pick.sel, `the picker shows all ${pick.n} tables, each drawn small (${pick.drawn}) with a few words on its sound, the current one focused`);
    ok(picked.a_table === 3 && pickLabel === 'VOWEL' && hk1.n - hk0.n === 1 && hk1.by === 'you', `the arrow keys and Enter pick one: a_table ${picked.a_table} (${pickLabel}), one undo step ("${hk1.label}")`);

    /* -------- an envelope drag is one undo step */
    const p0 = await P(), he0 = await hist();
    const dh = await at('.lt-env .lt-eh[data-kind="decay"]');
    await page.mouse.move(dh.x, dh.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(dh.x + i * 3, dh.y - i * 2);
    await page.mouse.up();
    await sleep(120);
    const p1 = await P(), he1 = await hist();
    await E(() => window.overdub.store.undo());
    await sleep(80);
    const p2 = await P();
    ok((p1.env1_decay ?? 0.6) > (p0.env1_decay ?? 0.6) && (p1.env1_sustain ?? 0.8) > (p0.env1_sustain ?? 0.8) && he1.n - he0.n === 1 && he1.by === 'you', `dragging the decay point (right and up) sets the decay and the sustain in one undo step (${fmt(p0.env1_decay ?? 0.6, 2)} s → ${fmt(p1.env1_decay, 2)} s, ${fmt(p0.env1_sustain ?? 0.8, 2)} → ${fmt(p1.env1_sustain, 2)}; ${he1.n - he0.n} step)`);
    ok((p2.env1_decay ?? 0.6) === (p0.env1_decay ?? 0.6) && (p2.env1_sustain ?? 0.8) === (p0.env1_sustain ?? 0.8), 'one undo takes both back');

    /* -------- drag to modulate */
    const hm0 = await hist();
    const jack = await at('.lt-lfo .lt-sock[data-src="5"]'), reso = await at('.pk-knob[data-key="flt_res"] .pk-dial');
    await page.mouse.move(jack.x, jack.y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(jack.x + (reso.x - jack.x) * i / 12, jack.y + (reso.y - jack.y) * i / 12);
    await sleep(120);
    const during = await E(() => ({ can: document.querySelectorAll('.lt-can').length, over: document.querySelector('.lt-over')?.dataset.key, cable: document.querySelector('.lt-cable.on .lt-cable-p')?.getAttribute('d')?.length > 10, fixed: [...document.querySelectorAll('.lt-can')].every((x) => x.dataset.ltTarget) }));
    await shot('wavetable-ui-drag');
    await page.mouse.up();
    await sleep(150);
    const made = await P(), hm1 = await hist();
    const after = await E(() => ({ can: document.querySelectorAll('.lt-can').length, rings: document.querySelector('.lt').__lt.rings('flt_res') }));
    ok(during.can >= 30 && during.fixed && during.over === 'flt_res' && during.cable, `while a cable is out, the ${during.can} knobs it can reach light up and the one under it is marked (${during.over})`);
    ok(made.m1_src === 5 && made.m1_dst === 16 && made.m1_amt === 0.25 && hm1.n - hm0.n === 1 && hm1.by === 'you' && after.can === 0, `dropping LFO 2 on RESO fills the first free slot: slot 1 = LFO 2 → RESO at +25%, one undo step signed you ("${hm1.label}")`);
    ok(after.rings.length === 1 && after.rings[0].slot === 1 && /A/.test(after.rings[0].d || ''), 'RESO wears a ring for it: its arc is the amount');
    const ringArc = await E(() => { const r = document.querySelector('.pk-knob[data-key="flt_res"] .lt-ring-arc'); return r.getTotalLength(); });
    const hd = await at('.pk-knob[data-key="flt_res"] .lt-ring-h');
    await page.mouse.move(hd.x, hd.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(hd.x, hd.y - i * 5);
    await page.mouse.up();
    await sleep(150);
    const dragged = await P(), hm2 = await hist();
    const ringArc2 = await E(() => document.querySelector('.pk-knob[data-key="flt_res"] .lt-ring-arc').getTotalLength());
    ok(Math.abs(dragged.m1_amt - 0.5) < 1e-9 && hm2.n - hm1.n === 1 && ringArc2 > ringArc * 1.5, `dragging the ring up 30 px sets the amount (+25% → ${Math.round(dragged.m1_amt * 100)}%), one undo step; the arc grows with it (${fmt(ringArc, 1)} → ${fmt(ringArc2, 1)} px)`);
    const hd2 = await at('.pk-knob[data-key="flt_res"] .lt-ring-h');
    await page.mouse.click(hd2.x, hd2.y, { button: 'right' });
    await sleep(150);
    const gone = await P(), hm3 = await hist();
    const ringsGone = await E(() => document.querySelector('.lt').__lt.rings('flt_res').length);
    ok(gone.m1_src === 0 && gone.m1_dst === 0 && gone.m1_amt === 0 && ringsGone === 0 && hm3.n - hm2.n === 1, `right-clicking the ring takes it off and empties the slot, one undo step ("${hm3.label}")`);
    await E(() => window.overdub.store.undo());
    await sleep(120);
    ok(await E(() => document.querySelector('.lt').__lt.rings('flt_res').length === 1), 'undo puts the slot and its ring back');
    // from the keyboard: Enter on a jack, Enter on a knob; Esc stops patching without closing the window
    await page.focus('.lt-env .lt-sock[data-src="3"]');
    await page.keyboard.press('Enter');
    const patching = await E(() => document.querySelector('.lt').__lt.patching());
    await page.focus('.pk-knob[data-key="flt_cutoff"] .pk-dial');
    await page.keyboard.press('Enter');
    await sleep(120);
    const kb = await P();
    await page.focus('.lt-lfo .lt-sock[data-src="4"]');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await sleep(80);
    const esc = await E(() => ({ patching: document.querySelector('.lt').__lt.patching(), open: !!window.overdub.plugin.current }));
    ok(patching && patching.src === 3 && kb.m2_src === 3 && kb.m2_dst === 15 && !esc.patching && esc.open, `from the keyboard: Enter on ENV 3's jack, then Enter on CUTOFF fills slot 2 (${kb.m2_src} → ${kb.m2_dst}); Esc stops a patch and leaves the window open`);

    /* -------- all 8 slots in use: it says so, and nothing changes */
    await set(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [[`m${n}_src`, 11], [`m${n}_dst`, n], [`m${n}_amt`, 0.1]])));
    await sleep(120);
    const hf0 = await hist();
    const j2 = await at('.lt-mac .lt-sock[data-src="12"]'), pan = await at('.pk-knob[data-key="a_pan"] .pk-dial');
    await page.mouse.move(j2.x, j2.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(j2.x + (pan.x - j2.x) * i / 10, j2.y + (pan.y - j2.y) * i / 10);
    await sleep(100);
    const full = await E(() => ({ status: document.querySelector('.pw .pw-status')?.textContent, label: document.querySelector('.lt-cable.on .lt-cable-say')?.textContent, can: document.querySelectorAll('.lt-can').length }));
    await page.mouse.up();
    await sleep(100);
    const hf1 = await hist();
    ok(/^All 8 mod slots are in use/.test(full.status || '') && full.label === 'All 8 slots are in use' && full.can === 0 && hf1.n === hf0.n, `with all 8 slots in use, it says so plainly, in the window's line ("${full.status}") and at the cable's end ("${full.label}"); it lights nothing and the drop changes nothing`);

    /* -------- the matrix reads as sentences */
    await set({ ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [[`m${n}_src`, 0], [`m${n}_dst`, 0], [`m${n}_amt`, 0]])), m1_src: 4, m1_dst: 1, m1_amt: 0.35, m2_src: 2, m2_dst: 15, m2_amt: 0.3, m3_src: 12, m3_dst: 26, m3_amt: -0.5 });
    await sleep(120);
    const mx = await E(() => ({ says: [...document.querySelectorAll('.lt-mx-row')].map((r) => r.dataset.say), aria: document.querySelector('.lt-mx-row')?.getAttribute('aria-label'), count: document.querySelector('.lt-count')?.textContent }));
    ok(mx.says[0] === 'LFO 1 → A POS, +35%' && mx.says[1] === 'ENV 2 → CUTOFF, +3.0 oct' && mx.says[2] === 'MACRO 2 → M1 amount, −50%' && mx.says.slice(3).every((x) => x === 'empty') && mx.count === '3 of 8', `the matrix reads right: "${mx.says.slice(0, 3).join('", "')}", the rest empty, ${mx.count}`);
    ok(/^Slot 1: LFO 1 to A POS, \+35%$/.test(mx.aria || ''), `…and says so to a screen reader ("${mx.aria}")`);

    /* -------- an agent's slot: the ring appears and flashes in its ink */
    const ag = await E(() => {
      const a = window.overdub, tr = a.plugin.current.track;
      a.store.dispatch({ type: 'instrument.set', track: tr, params: { m4_src: 6, m4_dst: 7, m4_amt: 0.4 } }, { by: 'claude', label: 'a slow sweep on B' });
      return new Promise((res) => setTimeout(() => {
        const L = document.querySelector('.lt').__lt, knob = document.querySelector('.pk-knob[data-key="b_pos"]');
        const arc = knob.querySelector('.lt-ring.lt-flash .lt-ring-arc');
        res({ rings: L.rings('b_pos'), knobFlash: knob.classList.contains('pk-flash'), stroke: arc ? getComputedStyle(arc).stroke : null, status: document.querySelector('.pw .pw-status')?.textContent, by: document.querySelector('.pw .pw-status .by')?.className, row: document.querySelector('.lt-mx-row[data-slot="4"]')?.dataset.say });
      }, 120));
    });
    ok(ag.rings.length === 1 && ag.rings[0].flash && ag.knobFlash && ag.stroke === 'rgb(76, 195, 255)', `an agent's instrument.set on slot 4 puts a ring on B POS that flashes in the agent's ink (${ag.stroke}), and the knob flashes`);
    ok(/Claude/.test(ag.status || '') && /by-agent/.test(ag.by || '') && ag.row === 'LFO 3 → B POS, +40%', `the window says who did it ("${ag.status}") and the matrix reads it ("${ag.row}")`);
    const agt = await E(() => {
      const a = window.overdub;
      a.store.dispatch({ type: 'instrument.set', track: a.plugin.current.track, params: { b_table: 10, flt_noise: 0 } }, { by: 'claude', label: 'glass on B' });
      const pick = document.querySelector('.lt-osc[data-sec="oscb"] .lt-pick'), route = document.querySelector('.lt-in .lt-route[data-key="flt_noise"]');
      return { flash: pick.classList.contains('pk-flash'), name: pick.querySelector('.lt-pick-n')?.textContent, route: route.classList.contains('pk-flash') && route.getAttribute('aria-pressed') === 'false' };
    });
    ok(agt.flash && agt.name === 'GLASS' && agt.route, `the controls bound by hand flash for an agent too: B's table name (now ${agt.name}) and the noise's route`);

    /* -------- while the song plays: the LFO's dot, the ghost frame, the filter, inside a frame budget */
    await set({ lfo1_mode: 0, lfo1_sync: 9, lfo1_shape: 0, flt_env: 0.5, env2_decay: 1.2, env2_sustain: 0.3 });
    await page.focus('.lt-lfo .lt-tab');
    await E(async () => { const a = window.overdub; await a.engine.start?.(); a.engine.play(0); });
    await sleep(700);
    const s1 = await E(() => { const L = document.querySelector('.lt').__lt; return { lfo: L.lfo().dot, ghost: L.osc('a').ghostPos, flt: L.filter().live, beat: window.overdub.engine.beat }; });
    await sleep(260);
    const s2 = await E(() => { const L = document.querySelector('.lt').__lt; return { lfo: L.lfo().dot, ghost: L.osc('a').ghostPos, flt: L.filter().live, beat: window.overdub.engine.beat, ticks: [...document.querySelectorAll('.lt-ring-tick')].filter((x) => !x.hasAttribute('display')).length }; });
    await shot('wavetable-ui-playing');
    ok(s1.lfo && s2.lfo && Math.abs(s2.lfo.x - s1.lfo.x) > 3 && s2.beat > s1.beat, `the LFO's dot runs along its shape with the song (beat ${fmt(s1.beat, 2)} → ${fmt(s2.beat, 2)}: x ${fmt(s1.lfo?.x)} → ${fmt(s2.lfo?.x)} px)`);
    ok(s1.ghost != null && s2.ghost != null && Math.abs(s2.ghost - s1.ghost) > 0.005 && s1.flt && s2.ticks >= 2, `the table shows where POS has gone (${fmt(s1.ghost, 3)} → ${fmt(s2.ghost, 3)}), the filter draws where its cutoff is now (${s1.flt ? fmt(s1.flt.fc, 0) + ' Hz' : 'none'}), and ${s2.ticks} rings carry a moving tick`);
    await E(() => document.querySelector('.lt').__lt.resetStats());
    await sleep(3000);
    const st = await E(() => ({ ...document.querySelector('.lt').__lt.stats(), parts: document.querySelector('.lt').__lt.parts() }));
    await E(() => window.overdub.engine.stop());
    const partsSay = (ps) => Object.entries(ps).map(([k, v]) => `${k.replace(/^lt-|-cv$/g, '')} ${fmt(v.mean, 3)}`).join(', ');
    ok(st.n >= 60 && st.p95 <= 2 && st.mean <= 1, `its frames stay cheap while the song plays: ${st.n} frames, ${fmt(st.mean, 2)} ms on average, ${fmt(st.p95, 2)} ms at the 95th percentile, ${fmt(st.max, 1)} ms at worst (the editor's frame() and its canvases; budget 2 ms p95, 1 ms mean; by part, ms a draw: ${partsSay(st.parts)})`);

    /* -------- the keyboard: every control takes focus; the arrows change values */
    const foc = await E(() => {
      const root = document.querySelector('.lt');
      // (an empty slot's amount knob is out of sight, visibility hidden, until the slot has a source)
      const els = [...root.querySelectorAll('button, select, [role=slider], [tabindex]')].filter((x) => x.getClientRects().length && !x.closest('.lt-stash') && !x.disabled && getComputedStyle(x).visibility !== 'hidden');
      const focusable = els.filter((x) => { x.focus(); return document.activeElement === x || x.closest('[role=radiogroup], [role=tablist]'); });
      const unnamed = els.filter((x) => !(x.getAttribute('aria-label') || x.textContent.trim() || x.getAttribute('aria-labelledby')));
      return { n: els.length, focusable: focusable.length, not: els.filter((x) => !focusable.includes(x)).map((x) => `${x.tagName}.${x.className} ${x.getAttribute('tabindex')}`).slice(0, 5), unnamed: unnamed.map((x) => x.className).slice(0, 5) };
    });
    ok(foc.n > 120 && foc.focusable === foc.n && !foc.unnamed.length, `every control takes focus and has a name (${foc.focusable} of ${foc.n})${foc.not.length ? ': not focusable ' + foc.not.join(', ') : ''}${foc.unnamed.length ? ': unnamed ' + foc.unnamed.join(', ') : ''}`);
    const keys = await E(async () => {
      const a = window.overdub, tr = a.plugin.current.track, d = a.devices.getDevice('core.wavetable'), P = () => a.devices.paramValues(d, a.store.track(tr).instrument.params);
      const press = (el, key, opt = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opt }));
      const wait = () => new Promise((r) => setTimeout(r, 40));
      const out = {};
      let el = document.querySelector('.pk-knob[data-key="flt_cutoff"] .pk-dial'); let v0 = P().flt_cutoff; press(el, 'ArrowUp'); await wait(); out.knob = P().flt_cutoff > v0;
      el = document.querySelector('.lt-osc[data-sec="oscb"] .lt-tv canvas'); v0 = P().b_pos; press(el, 'ArrowUp'); await wait(); out.table = P().b_pos > v0;
      el = document.querySelector('.lt-env .lt-eh[data-kind="attack"]'); v0 = P().env1_attack; press(el, 'ArrowRight'); await wait(); out.env = P().env1_attack > v0;
      el = document.querySelector('.lt-env .lt-eh[data-kind="curve"]'); v0 = P().env1_curve ?? 0; press(el, 'ArrowUp'); await wait(); out.curve = P().env1_curve > v0;
      el = document.querySelector('.pk-knob[data-key="a_pos"] .lt-ring-h'); v0 = P().m1_amt; press(el, 'ArrowUp'); await wait(); out.ring = P().m1_amt > v0;
      el = document.querySelector('.lt-fd canvas'); v0 = P().flt_cutoff; press(el, 'ArrowRight'); await wait(); const c1 = P().flt_cutoff; press(el, 'ArrowUp'); await wait(); out.filter = c1 > v0 && P().flt_res > 0.15;
      el = document.querySelector('.lt-osc[data-sec="osca"] .lt-warpw .sel-print'); v0 = P().a_warp | 0; press(el, 'ArrowRight'); await wait(); out.warp = (P().a_warp | 0) === v0 + 1;
      el = document.querySelector('.lt-osc[data-sec="osca"] .lt-views [aria-checked="true"]'); press(el, 'ArrowRight'); await wait(); out.view = document.querySelector('.lt').__lt.osc('a').view === 'wave';
      press(document.querySelector('.lt-osc[data-sec="osca"] .lt-views [aria-checked="true"]'), 'ArrowLeft'); await wait();
      el = document.querySelector('.lt-bot .lt-tab[aria-selected="true"]'); press(el, 'ArrowRight'); await wait(); out.tabs = document.querySelector('.lt-fx').classList.contains('on');
      press(document.querySelector('.lt-bot .lt-tab[aria-selected="true"]'), 'ArrowLeft'); await wait();
      return out;
    });
    ok(Object.values(keys).every(Boolean), `the arrow keys turn them: a knob, the table (POS), an envelope point and its curve, a ring's amount, the filter's curve (cutoff and reso), the warp switch, the view, the tabs (${Object.entries(keys).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all'})`);

    /* -------- a ring keeps off its knob's name and value, and its handle is a bigger target */
    // (the producer's case: LFO 1 on CUTOFF at +40% from 381 Hz put the handle on "CUTOFF" and "381 Hz"; here the tip
    // goes round from 12 to past 3 o'clock, then two rings, then a ring on a jack, whose name sits over its dial)
    const EMPTY = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [[`m${n}_src`, 0], [`m${n}_dst`, 0], [`m${n}_amt`, 0]]));
    const room = [];
    for (const [say_, key, slotsOn, tab] of [['+10%', 'flt_cutoff', [[4, 15, 0.1]]], ['+25%', 'flt_cutoff', [[4, 15, 0.25]]], ['+40%', 'flt_cutoff', [[4, 15, 0.4]]], ['+55%', 'flt_cutoff', [[4, 15, 0.55]]],
      ['two rings', 'flt_cutoff', [[4, 15, 0.4], [2, 15, 0.3]]], ['PITCH, LFO 2 at +20%', '@18', [[5, 18, 0.2]], 'voice'], ['PITCH, LFO 2 at −35%', '@18', [[5, 18, -0.35]], 'voice']]) {
      await set({ ...EMPTY, flt_cutoff: 381, ...Object.fromEntries(slotsOn.flatMap(([s_, d, a], i) => [[`m${i + 1}_src`, s_], [`m${i + 1}_dst`, d], [`m${i + 1}_amt`, a]])) });
      if (tab) await E(() => [...document.querySelectorAll('.lt-bot .lt-tab')].find((b) => b.textContent === 'Voice').click());
      await page.waitForFunction(([k, n]) => document.querySelectorAll(`.lt [data-lt-target="${k}"] .lt-ring-h`).length === n, [key, slotsOn.length]);
      await sleep(180);
      room.push(await E(([k, words]) => {
        const knob = document.querySelector(`.lt [data-lt-target="${k}"]`);
        knob.scrollIntoView({ block: 'center' });
        const text = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
        const L = text(knob.querySelector('.pk-l-t')), V = text(knob.querySelector('.pk-v'));
        const dr = knob.querySelector('.pk-dial').getBoundingClientRect(), dc = { x: dr.left + dr.width / 2, y: dr.top + dr.height / 2 };
        const hs = [...knob.querySelectorAll('.lt-ring-h')].map((x) => { const r = x.getBoundingClientRect(); return { el: x, r, x: r.left + r.width / 2, y: r.top + r.height / 2, d: parseFloat(getComputedStyle(x, '::before').width) || r.width }; });
        const arcs = [...knob.querySelectorAll('.lt-ring-arc, .lt-ring-trk')].map((a) => a.getBoundingClientRect());
        const boxes = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const over = [];
        for (const [what, T] of [['name', L], ['value', V]]) {
          if (arcs.some((a) => boxes(a, T))) over.push(`a ring on its ${what}`);
          if (hs.some((x) => boxes(x.r, T))) over.push(`a handle on its ${what}`);
          const at = document.elementFromPoint((T.left + T.right) / 2, (T.top + T.bottom) / 2);
          if (!at || at.closest('.lt-rings')) over.push(`its ${what} under a ring`);
        }
        // a press 7 px out from a handle's middle (away from the dial) takes the handle
        const reach = hs.every((x) => { const a = Math.atan2(x.y - dc.y, x.x - dc.x), e = document.elementFromPoint(x.x + 7 * Math.cos(a), x.y + 7 * Math.sin(a)); return e === x.el; });
        return { words, n: hs.length, over, reach, d: Math.min(...hs.map((x) => x.d)), label: knob.querySelector('.pk-l-t').textContent, value: knob.querySelector('.pk-v').textContent };
      }, [key, say_]));
      if (tab) await E(() => [...document.querySelectorAll('.lt-bot .lt-tab')].find((b) => b.textContent.startsWith('Mod matrix')).click());
    }
    await shot('wavetable-ui-ring-room');
    const roomBad = room.filter((x) => x.over.length || !x.n);
    ok(!roomBad.length, `a ring keeps off its knob's name and value: CUTOFF from 381 Hz with LFO 1 at ${room.slice(0, 4).map((x) => x.words).join(', ')} and two rings, and PITCH's jack with a ring both ways, each still reading its name and value whole ("${room[2]?.label} / ${room[2]?.value}")${roomBad.length ? ': ' + roomBad.map((x) => `${x.words}: ${x.over.join(', ') || 'no ring'}`).join('; ') : ''}`);
    ok(room.every((x) => x.d >= 18 && x.reach), `…and its handle takes a press across ${Math.min(...room.map((x) => x.d))} px (it was 7): a press 7 px out from its middle takes it${room.some((x) => !x.reach) ? ': not at ' + room.filter((x) => !x.reach).map((x) => x.words).join(', ') : ''}`);

    /* -------- an envelope's point moves at a knob's rate, under the pointer */
    // (a knob's drag sweeps its whole travel in 180 px; the decay point once did it in 67, so 20 px took 0.60 s to 0.065 s)
    const travel = (k) => E(async (key) => { const kit = await import('/app/src/ui/plugin-kit.js'); const a = window.overdub, d = a.devices.getDevice('core.wavetable'); return kit.pos(kit.spec(d.params.find((q) => q.key === key)), a.devices.paramValues(d, a.store.track(a.plugin.current.track).instrument.params)[key]); }, k);
    await E(() => document.querySelector('.lt-env .lt-tab').click());
    const ENV0 = { env1_attack: 0.004, env1_decay: 0.6, env1_sustain: 0.8, env1_release: 0.35, env1_curve: 0 };
    await set(ENV0);
    await sleep(200);
    const kd = await at('.lt-env .pk-knob[data-key="env1_decay"] .pk-dial'), k0 = await travel('env1_decay');
    await page.mouse.move(kd.x, kd.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(kd.x, kd.y - i * 2);
    await page.mouse.up();
    await sleep(150);
    const knobRate = (await travel('env1_decay')) - k0;
    const envDrag = async (kind, dx, params) => {
      await set(params);
      await sleep(250);
      const hd_ = await at(`.lt-env .lt-eh[data-kind="${kind}"]`), key = `env1_${kind}`, t0 = await travel(key);
      await page.mouse.move(hd_.x, hd_.y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(hd_.x + dx * i / 10, hd_.y);
      await sleep(200);
      const under = await E(([k, x]) => { const r = document.querySelector(`.lt-env .lt-eh[data-kind="${k}"]`).getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - x); }, [kind, hd_.x + dx]);
      await page.mouse.up();
      await sleep(300);
      return { rate: Math.abs((await travel(key)) - t0), under };
    };
    const short = await envDrag('decay', 20, ENV0), long = await envDrag('decay', -20, { env1_attack: 0.9, env1_decay: 2, env1_sustain: 0.9, env1_release: 2.5, env1_curve: -0.3 }), rel = await envDrag('release', -20, { env1_attack: 0.9, env1_decay: 2, env1_sustain: 0.9, env1_release: 2.5, env1_curve: -0.3 });
    const near = (x) => x.rate / knobRate >= 0.8 && x.rate / knobRate <= 1.25 && x.under <= 2;
    ok(knobRate > 0.09 && [short, long, rel].every(near), `an envelope's point moves at a knob's rate, under the pointer: 20 px of DECAY's knob is ${fmt(knobRate * 100, 1)}% of its travel; 20 px of the decay point ${fmt(short.rate * 100, 1)}% (the amp's defaults), of a long pad's decay point ${fmt(long.rate * 100, 1)}% and of its release point ${fmt(rel.rate * 100, 1)}% (want 0.8 to 1.25 times the knob's), the point within ${fmt(Math.max(short.under, long.under, rel.under), 1)} px of the pointer`);
    await set(ENV0);

    /* -------- History says what moved, in words and with the value */
    const labelled = [], readout = (k) => E((key) => document.querySelector(`.lt [data-key="${key}"] .pk-v`)?.textContent, k);
    const newest = () => E(() => window.overdub.store.history.at(-1).label);
    await set({ ...EMPTY, m1_src: 5, m1_dst: 16, m1_amt: 0.25, flt_cutoff: 1200, flt_res: 0.2 });
    await sleep(1600);
    // the table display (POS), dragged: one of the window's own gestures
    const tvA = await at('.lt-osc[data-sec="osca"] .lt-tv canvas');
    await page.mouse.move(tvA.x, tvA.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(tvA.x, tvA.y - i * 5);
    await page.mouse.up(); await sleep(150);
    labelled.push(['the table display', await newest(), `Light Table: osc A position ${await readout('a_pos')}`]);
    // a ring, dragged
    const rh = await at('.pk-knob[data-key="flt_res"] .lt-ring-h');
    await page.mouse.move(rh.x, rh.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(rh.x, rh.y - i * 5);
    await page.mouse.up(); await sleep(150);
    labelled.push(['a ring', await newest(), `Light Table: LFO 2 → Resonance, ${await E(() => { const P = window.overdub.store.track(window.overdub.plugin.current.track).instrument.params; return `${P.m1_amt > 0 ? '+' : '−'}${Math.round(Math.abs(P.m1_amt) * 100)}%`; })}`]);
    // the slot's amount knob in the matrix, and CUTOFF's knob: controls the window's frame makes
    for (const [what, sel, key] of [['the matrix\'s amount knob', '.lt-mx-row[data-slot="1"] .pk-knob[data-key="m1_amt"] .pk-dial', 'm1_amt'], ['CUTOFF\'s knob', '.pk-knob[data-key="flt_cutoff"] .pk-dial', 'flt_cutoff']]) {
      await sleep(1600);
      const kk = await at(sel);
      await page.mouse.move(kk.x, kk.y); await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(kk.x, kk.y - i * 3);
      await page.mouse.up(); await sleep(150);
      labelled.push([what, await newest(), key === 'm1_amt' ? `Light Table: LFO 2 → Resonance, ${await E(() => { const P = window.overdub.store.track(window.overdub.plugin.current.track).instrument.params; return `${P.m1_amt > 0 ? '+' : '−'}${Math.round(Math.abs(P.m1_amt) * 100)}%`; })}` : `Light Table: cutoff ${await readout('flt_cutoff')}`]);
    }
    // LFO 1's sync list
    await page.selectOption('.lt-lfo [data-key="lfo1_sync"] select', { index: 6 });
    await sleep(150);
    labelled.push(['LFO 1\'s sync list', await newest(), 'Light Table: LFO 1 sync 1/8']);
    // the decay point (two params), and the filter's curve (two more)
    const dp = await at('.lt-env .lt-eh[data-kind="decay"]');
    await page.mouse.move(dp.x, dp.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(dp.x + i * 2, dp.y - i * 2);
    await page.mouse.up(); await sleep(400);
    labelled.push(['the decay point', await newest(), `Light Table: amp decay ${await readout('env1_decay')}, sustain ${await readout('env1_sustain')}`]);
    await sleep(1600);
    const fc = await at('.lt-fd canvas');
    await page.mouse.move(fc.x, fc.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(fc.x + i * 4, fc.y - i * 2);
    await page.mouse.up(); await sleep(150);
    labelled.push(['the filter\'s curve', await newest(), `Light Table: cutoff ${await readout('flt_cutoff')}, resonance ${await readout('flt_res')}`]);
    const wrong = labelled.filter(([, got, want]) => got !== want || /^Light Table [a-z0-9]+[ ,]/.test(got));
    ok(!wrong.length, `History says what moved and where it ended, never a param's key: ${labelled.map(([what, got]) => `${what} "${got}"`).join('; ')}${wrong.length ? ' | WANT ' + wrong.map(([what, got, want]) => `${what} "${want}", not "${got}"`).join('; ') : ''}`);
    await set(EMPTY);
    ok(!ours(errors).length, `desktop: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'desktop run threw: ' + (e && e.stack || e));
  }
  await s.close();
}

/* ======================================================================== Chromium: a 2x screen, the frame time */
{
  const s = await open('/app/', { query: 'device=core.wavetable', width: 1440, height: 900 });
  const ctx2 = await s.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx2.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const E = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.goto(s.url, { waitUntil: 'load' });
    await openLT(page);
    await E(() => { const a = window.overdub; a.store.dispatch({ type: 'instrument.set', track: a.plugin.current.track, params: { m1_src: 4, m1_dst: 1, m1_amt: 0.4, m2_src: 2, m2_dst: 15, m2_amt: 0.3, m3_src: 5, m3_dst: 7, m3_amt: 0.3, b_level: 0.3, lfo1_rate: 1.5, b_table: 3, b_warp: 2, b_warp_amt: 0.5 } }, { by: 'you', label: 'wavetable-ui test' }); });
    await E(async () => { const a = window.overdub; await a.engine.start?.(); a.engine.play(0); });
    await sleep(800);
    await E(() => document.querySelector('.lt').__lt.resetStats());
    await sleep(3000);
    const st = await E(() => ({ ...document.querySelector('.lt').__lt.stats(), dpr: devicePixelRatio, w: document.querySelector('.lt-tv canvas').width }));
    await E(() => window.overdub.engine.stop());
    ok(st.dpr === 2 && st.n >= 60 && st.p95 <= 4 && st.mean <= 2, `on a 2x screen too (canvases ${st.w} px wide): ${fmt(st.mean, 2)} ms a frame on average, ${fmt(st.p95, 2)} ms at the 95th percentile, ${fmt(st.max, 1)} ms at worst, both tables and the filter moving (budget 4 ms p95, 2 ms mean)`);
    ok(!ours(errors).length, `2x: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, '2x run threw: ' + (e && e.stack || e));
  }
  await ctx2.close();
  await s.close();
}

/* ======================================================================== Chromium: a 1280 x 800 laptop */
// The window's frame takes what the screen has under its bar (here 499 px) and the keyboard below: the whole synth
// fits in that, the matrix and the macros too, with nothing to scroll, and still does with all 8 slots' rings on
{
  const s = await open('/app/', { query: 'device=core.wavetable', width: 1280, height: 800 });
  const { page, errors, shot } = s;
  page.setDefaultTimeout(15000);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const fits = () => E(() => {
    const w = document.querySelector('.pw'), body = w.querySelector('.pw-body'), r = w.getBoundingClientRect(), b = body.getBoundingClientRect();
    const inside = (q) => { const e = document.querySelector(q), x = e && e.getBoundingClientRect(); return !!x && x.height > 0 && x.top >= b.top - 1 && x.bottom <= b.bottom + 1 && x.bottom <= innerHeight; };
    return { overY: body.scrollHeight - body.clientHeight, overX: body.scrollWidth - body.clientWidth, onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      matrix: inside('.lt-mxs'), macros: inside('.lt-macros'), keys: inside('.pw-keys') || !!document.querySelector('.pw-keys:not([hidden]) .pk-keys'), body: Math.round(b.height), lt: Math.round(document.querySelector('.lt').getBoundingClientRect().height) };
  });
  try {
    await openLT(page);
    const f0 = await fits();
    await shot('wavetable-ui-1280');
    ok(f0.overY <= 1 && f0.overX <= 1 && f0.onScreen && f0.matrix && f0.macros, `at 1280 x 800 the whole synth fits the window, nothing to scroll: the editor is ${f0.lt} px in the ${f0.body} px under the window's bar (${f0.overY} px over), the mod matrix and the macros in view above the keyboard`);
    await E(() => { const a = window.overdub; a.store.dispatch({ type: 'instrument.set', track: a.plugin.current.track, params: { m1_src: 4, m1_dst: 15, m1_amt: 0.4, m2_src: 2, m2_dst: 15, m2_amt: 0.3, m3_src: 5, m3_dst: 1, m3_amt: 0.3, m4_src: 6, m4_dst: 7, m4_amt: -0.2, m5_src: 11, m5_dst: 13, m5_amt: 0.5, m6_src: 12, m6_dst: 14, m6_amt: 0.5, m7_src: 15, m7_dst: 16, m7_amt: 0.3, m8_src: 9, m8_dst: 22, m8_amt: 0.2, noise_level: 0.2 } }, { by: 'you', label: 'wavetable-ui test' }); });
    await page.waitForFunction(() => document.querySelectorAll('.lt .lt-ring-h').length === 8);
    await sleep(300);
    const f1 = await fits();
    await shot('wavetable-ui-1280-rings');
    ok(f1.overY <= 1 && f1.overX <= 1 && f1.matrix && f1.macros, `…and with all 8 slots in use, their rings on seven knobs (two on CUTOFF, the sub's and the noise's levels among them), it still fits (${f1.lt} px, ${f1.overY} px over, ${f1.overX} sideways)`);
    ok(!ours(errors).length, `1280 x 800: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, '1280 x 800 run threw: ' + (e && e.stack || e));
  }
  await s.close();
}

/* ======================================================================== Chromium: a touch screen's words */
// On a phone (touch, pointer: coarse) the window says tap, slide and the matrix's ×, never right-click, Alt, click or
// drag: in its line (patching, all 8 slots in use) and in every name and tip it writes. (The kit's own knob tips,
// ui/plugin-kit.js, are the kit's, and a touch screen never shows a tip.)
{
  const s = await open('/app/', { query: 'device=core.wavetable', width: 390, height: 844 });
  const ctx3 = await s.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx3.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.setDefaultTimeout(15000);
  const E = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.goto(s.url, { waitUntil: 'load' });
    await openLT(page);
    const said = [];
    const line = () => E(() => document.querySelector('.pw .pw-status')?.textContent || '');
    // patching: a tap on LFO 1's jack, then on POS
    await E(() => document.querySelectorAll('.lt-ptabs .lt-tab')[4].click());
    await sleep(150);
    await page.tap('.lt-lfo .lt-sock[data-src="4"]');
    await sleep(120);
    said.push(await line());
    await E(() => document.querySelectorAll('.lt-ptabs .lt-tab')[0].click());
    await sleep(150);
    await page.tap('.lt-osc[data-sec="osca"] .pk-knob[data-key="a_pos"] .pk-dial');
    await sleep(150);
    said.push(await line());
    // LFO 1 again, onto POS again: it says how to change it
    await E(() => document.querySelectorAll('.lt-ptabs .lt-tab')[4].click());
    await sleep(150);
    await page.tap('.lt-lfo .lt-sock[data-src="4"]');
    await E(() => document.querySelectorAll('.lt-ptabs .lt-tab')[0].click());
    await sleep(150);
    await page.tap('.lt-osc[data-sec="osca"] .pk-knob[data-key="a_pos"] .pk-dial');
    await sleep(150);
    said.push(await line());
    // all 8 in use: a tap on a jack says how to empty one
    await E(() => { const a = window.overdub; a.store.dispatch({ type: 'instrument.set', track: a.plugin.current.track, params: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [[`m${n}_src`, 11], [`m${n}_dst`, n], [`m${n}_amt`, 0.1]])) }, { by: 'you', label: 'wavetable-ui test' }); });
    await E(() => document.querySelectorAll('.lt-ptabs .lt-tab')[5].click());
    await sleep(200);
    await page.tap('.lt-mac .lt-sock[data-src="12"]');
    await sleep(120);
    said.push(await line());
    // every name and tip the window writes (not the kit's own knob tips, nor the frame's lane marks)
    const named = await E(() => [...document.querySelectorAll('.lt [title], .lt [aria-label]')].filter((x) => !x.matches('.pk-dial, .pk-am')).flatMap((x) => [x.getAttribute('title'), x.getAttribute('aria-label')]).filter(Boolean));
    const coarse = await E(() => matchMedia('(pointer: coarse)').matches);
    const MOUSE = /right[- ]click|\balt\b|\bclick|\bdrag/i;
    const bad = [...said, ...named].filter((x) => MOUSE.test(x));
    ok(coarse && said.every(Boolean) && !bad.length, `on a touch screen the window says tap and slide: "${said.join('" "')}", and none of its ${named.length} names and tips says right-click, Alt, click or drag${bad.length ? ': ' + [...new Set(bad)].slice(0, 4).map((x) => `"${x}"`).join(', ') : ''}`);
    ok(!ours(errors).length, `touch: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'touch run threw: ' + (e && e.stack || e));
  }
  await ctx3.close();
  await s.close();
}

/* ======================================================================== Chromium: a phone */
{
  const s = await open('/app/', { query: 'device=core.wavetable', width: 390, height: 844 });
  const { page, errors, shot } = s;
  page.setDefaultTimeout(15000);
  const E = (fn, arg) => page.evaluate(fn, arg);
  try {
    await openLT(page);
    const TABS = ['osca', 'oscb', 'filter', 'env', 'lfo', 'mod', 'fx'];
    const seen = [];
    for (const [i, tab] of TABS.entries()) {
      await E((j) => document.querySelectorAll('.lt-ptabs .lt-tab')[j].click(), i);
      await sleep(200);
      seen.push(await E((tb) => {
        const root = document.querySelector('.lt'), body = document.querySelector('.pw-body');
        const shown = [...root.querySelectorAll('.lt-sec')].filter((x) => x.getClientRects().length).map((x) => x.dataset.sec);
        const texts = [...root.querySelectorAll('*')].filter((x) => x.getClientRects().length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
        const small = texts.filter((x) => parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => `${x.className} "${x.textContent.trim().slice(0, 12)}"`);
        const ctl = [...root.querySelectorAll('button, select, [role=slider], .pk-dial')].filter((x) => x.getClientRects().length && !x.closest('.lt-stash'));
        // a target smaller than 44 px must reach 44 under a finger (a ::before around a handle)
        const reach = (x) => { const b = x.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2; const hit = (dx, dy) => { const e = document.elementFromPoint(cx + dx, cy + dy); return !!e && (e === x || x.contains(e)); }; return hit(-20, 0) && hit(20, 0) && hit(0, -20) && hit(0, 20); };
        // (a point on a drawing, an envelope's or a ring's, is a small square with a 44 px area of its own around it)
        const area = (x) => { const c = getComputedStyle(x, '::before'); return c.content !== 'none' && parseFloat(c.width) >= 44 && parseFloat(c.height) >= 44; };
        const tiny = ctl.filter((x) => { const b = x.getBoundingClientRect(); if (b.width >= 44 && b.height >= 44) return false; if (/lt-eh|lt-ring-h/.test(x.className) && area(x)) return false; x.scrollIntoView({ block: 'center' }); return !reach(x); }).map((x) => `${x.className || x.tagName} ${Math.round(x.getBoundingClientRect().width)}x${Math.round(x.getBoundingClientRect().height)}`);
        return { tb, shown, small, tiny, over: body.scrollWidth - body.clientWidth, n: ctl.length };
      }, tab));
      if (tab === 'osca' || tab === 'mod') await shot('wavetable-ui-phone-' + tab);
    }
    const want = { osca: ['osca'], oscb: ['oscb'], filter: ['filter', 'filter'], env: ['env'], lfo: ['lfo'], mod: ['mod fx', 'mod'], fx: ['mod fx'] };
    const tabs = await E(() => ({ n: document.querySelectorAll('.lt-ptabs .lt-tab').length, words: [...document.querySelectorAll('.lt-ptabs .lt-tab')].map((x) => x.textContent), h: Math.min(...[...document.querySelectorAll('.lt-ptabs .lt-tab')].map((x) => x.getBoundingClientRect().height)) }));
    ok(tabs.n === 7 && tabs.words.join(',') === 'Osc A,Osc B,Filter,Env,LFO,Mod,FX' && tabs.h >= 44, `phone: the sections are seven tabs (${tabs.words.join(', ')}), ${tabs.h} px tall`);
    ok(seen.every((x) => JSON.stringify(x.shown) === JSON.stringify(want[x.tb])), `phone: each tab shows its own section and nothing else (${seen.map((x) => `${x.tb}: ${x.shown.join('+')}`).join('; ')})`);
    ok(seen.every((x) => !x.small.length), `phone: no text under 12 px${seen.some((x) => x.small.length) ? ': ' + seen.flatMap((x) => x.small).slice(0, 4).join('; ') : ''}`);
    ok(seen.every((x) => !x.tiny.length) && seen.every((x) => x.n > 3), `phone: every control is a 44 px target (or reaches 44 px under a finger) on every tab${seen.some((x) => x.tiny.length) ? ': ' + seen.flatMap((x) => x.tiny).slice(0, 4).join('; ') : ''}`);
    ok(seen.every((x) => x.over <= 1), `phone: nothing runs out sideways (${seen.map((x) => x.over).join(', ')})`);
    // a patch across tabs: LFO 1's jack, then the Osc A tab, then POS
    await E(() => document.querySelectorAll('.lt-ptabs .lt-tab')[4].click());
    await sleep(150);
    await page.click('.lt-lfo .lt-sock[data-src="4"]');
    await E(() => document.querySelectorAll('.lt-ptabs .lt-tab')[0].click());
    await sleep(150);
    const still = await E(() => document.querySelector('.lt').__lt.patching());
    await page.click('.lt-osc[data-sec="osca"] .pk-knob[data-key="a_pos"] .pk-dial');
    await sleep(150);
    const pp = await E(() => { const a = window.overdub; const P = a.store.track(a.plugin.current.track).instrument.params; return [P.m1_src, P.m1_dst, P.m1_amt]; });
    ok(still && still.src === 4 && pp[0] === 4 && pp[1] === 1, `phone: a tap on LFO 1's jack, the Osc A tab and POS makes the patch (slot 1: ${pp.join(', ')})`);
    ok(!ours(errors).length, `phone: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'phone run threw: ' + (e && e.stack || e));
  }
  await s.close();
}
t.done();
