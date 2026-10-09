// Engine checks: offline renders (length, determinism, timing, mix, solo, fader, audio clips, soft clip) and the live
// transport (loop wrap scheduling, tempo, seek, stop, live notes, reconcile while playing), in real Chromium.
//   node tools/engine-test.js
import { open, tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { CLICK } from '../app/src/engine/click.js';

const T = tally('engine');
const { page, errors, close } = await open('/tools/engine-test.html');

// Shared page helpers
await page.evaluate(async () => {
  const E = await import('/app/src/engine/engine.js');
  const S = await import('/app/src/core/store.js');
  const R = await import('/app/src/devices/registry.js');
  const U = await import('/app/src/engine/util.js');
  let M = null;
  try { M = await import('/app/src/audio/measure.js'); } catch { M = null; }
  const ch = (b, i) => b.getChannelData(Math.min(i, b.numberOfChannels - 1));
  const stat = (b, from = 0, to = b.duration) => {
    const a = Math.floor(from * b.sampleRate), z = Math.min(b.length, Math.floor(to * b.sampleRate));
    let pk = 0, sq = 0, n = 0;
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = a; i < z; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; sq += v * v; n++; } }
    const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
    return { peak: pk, rms: Math.sqrt(sq / Math.max(1, n)), peakDb: db(pk), rmsDb: db(Math.sqrt(sq / Math.max(1, n))) };
  };
  const onset = (b, thr = 1e-3, from = 0) => { const d = ch(b, 0), d2 = ch(b, 1); for (let i = Math.floor(from * b.sampleRate); i < b.length; i++) if (Math.abs(d[i]) > thr || Math.abs(d2[i]) > thr) return i / b.sampleRate; return null; };
  const same = (a, b) => { if (a.length !== b.length || a.numberOfChannels !== b.numberOfChannels) return false; for (let c = 0; c < a.numberOfChannels; c++) { const x = a.getChannelData(c), y = b.getChannelData(c); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; } return true; };
  const proj = (patch = {}) => ({ format: 'overdub/0', id: 'p_test01', title: 'T', tempo: 120, meter: [4, 4], key: null, loop: { on: false, start: 0, end: 16 }, tracks: [], sections: [], devices: {}, assets: {}, master: { gain: 0, inserts: [] }, meta: {}, ...patch });
  const track = (id, notes, extra = {}) => ({ id, name: id, kind: 'instrument', instrument: { device: 'test.missing-synth', params: {} }, inserts: [], clips: notes ? [{ id: 'c_' + id, kind: 'notes', start: 0, length: 8, notes: notes.map((n, i) => ({ id: 'n' + i, v: 0.8, ...n })) }] : [], gain: 0, pan: 0, mute: false, solo: false, ...extra });
  const errs = [];
  // Record what a live node sends (both channels, with the audio time of each block) until stop().
  const capture = async (ctx, node) => {
    if (!ctx.__cap) {
      const src = `registerProcessor('cap2', class extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = () => { this.on = false; this.port.postMessage('end'); }; } process(i) { const x = i[0]; if (this.on && x && x[0]) this.port.postMessage([x[0].slice(), (x[1] || x[0]).slice(), currentTime]); return this.on; } });`;
      ctx.__cap = ctx.audioWorklet.addModule('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));
    }
    await ctx.__cap;
    const cap = new AudioWorkletNode(ctx, 'cap2', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    const chunks = [];
    let done = null;
    cap.port.onmessage = (e) => { if (e.data === 'end') done && done(); else chunks.push(e.data); };
    const z = ctx.createGain(); z.gain.value = 0; cap.connect(z); z.connect(ctx.destination);
    node.connect(cap);
    return {
      stop: () => new Promise((res) => {
        done = () => {
          try { node.disconnect(cap); } catch { /* ok */ }
          cap.disconnect(); z.disconnect();
          const n = chunks.reduce((a, c) => a + c[0].length, 0), L = new Float32Array(n), Rr = new Float32Array(n);
          let w = 0; const at = []; for (const [l, r, t] of chunks) { at.push([w, t]); L.set(l, w); Rr.set(r, w); w += l.length; }
          // (at: each block's first sample and its audio time; blocks with no input are skipped, so only `at` is exact)
          res({ L, R: Rr, t0: chunks.length ? chunks[0][2] : 0, sr: ctx.sampleRate, at });
        };
        cap.port.postMessage('stop');
      }),
    };
  };
  // peak of a capture between audio times a and b; the first sample over thr (as an index, or -1)
  // (each block by its own time: on a loaded machine a capture has gaps, so t0 + i / sr drifts after the first one)
  const blocks = (c) => (c.at && c.at.length ? c.at : [[0, c.t0]]).map(([w, t], k, at) => ({ w, t, end: k + 1 < at.length ? at[k + 1][0] : c.L.length }));
  const capPeak = (c, a, b) => { let pk = 0; for (const { w, t, end } of blocks(c)) { const i0 = Math.max(w, w + Math.floor((a - t) * c.sr)), i1 = Math.min(end, w + Math.ceil((b - t) * c.sr)); for (let i = i0; i < i1; i++) pk = Math.max(pk, Math.abs(c.L[i]), Math.abs(c.R[i])); } return pk; };
  // the index of the first sample at or after audio time t
  const capIndex = (c, t) => { for (const { w, t: bt, end } of blocks(c)) if (bt + (end - w) / c.sr > t) return Math.max(w, w + Math.round((t - bt) * c.sr)); return c.L.length; };
  const firstOver = (d, thr = 1e-3) => { for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > thr) return i; return -1; };
  window.T = { E, S, R, U, M, stat, onset, same, proj, track, errs, capture, capPeak, capIndex, firstOver, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
  window.mk = (p) => { const store = S.createStore(p); const engine = E.createEngine(store); engine.on('error', (e) => errs.push(e)); return { store, engine }; };
});

// ---------------------------------------------------------------------------------------------- offline
{
  const r = await page.evaluate(async () => {
    const { proj, track, stat, same } = T;
    const notes = [];
    for (let b = 0; b < 8; b++) notes.push({ p: [48, 55, 60, 63, 67, 70, 72, 75][b], t: b, d: 0.9 });
    notes.push({ p: 60, t: 4, d: 4 }, { p: 63, t: 4, d: 4 }, { p: 67, t: 4, d: 4 });
    const { engine } = mk(proj({ tracks: [track('t_a', notes)] }));
    const a = await engine.render({ from: 0, to: 8, tail: 1 });
    const b = await engine.render({ from: 0, to: 8, tail: 1 });
    const s = stat(a);
    return { len: a.length, sr: a.sampleRate, ch: a.numberOfChannels, same: same(a, b), peak: s.peakDb, rms: s.rmsDb, end: engine.songEnd(), errs: T.errs.length, lufs: T.M ? T.M.measure(a).lufs : null };
  });
  T.ok(r.len === Math.ceil((4 + 1) * 48000) && r.ch === 2 && r.sr === 48000, `2-bar render is 5.0 s stereo at 48 kHz (${r.len} frames)`);
  T.ok(r.rms > -40 && r.peak > -20, `fallback synth is audible: peak ${r.peak.toFixed(1)} dBFS, rms ${r.rms.toFixed(1)} dBFS, ${r.lufs} LUFS`);
  T.ok(r.peak < -1, `a plain 2-bar line is under the soft clip knee: peak ${r.peak.toFixed(1)} dBFS`);
  T.ok(r.same, 'two renders of the same project are sample-identical');
  T.ok(r.errs > 0, `a missing instrument reports an 'error' event and plays the fallback (${r.errs} reports)`);
}

{
  const r = await page.evaluate(async () => {
    const { proj, track, onset } = T;
    const { engine } = mk(proj({ tracks: [track('t_a', [{ p: 69, t: 1, d: 0.5 }])] }));
    const b = await engine.render({ from: 0, to: 4, tail: 0.5 });
    const b2 = await engine.render({ from: 0.5, to: 4, tail: 0.5 });
    return { on: onset(b, 1e-3), on2: onset(b2, 1e-3), pre: T.stat(b, 0, 0.49).peak };
  });
  T.ok(r.on != null && Math.abs(r.on - 0.5) < 0.002, `note at beat 1 @120 bpm sounds at ${r.on && r.on.toFixed(5)} s (want 0.5 +- 2 ms)`);
  T.ok(r.pre === 0, 'nothing before the note');
  T.ok(r.on2 != null && Math.abs(r.on2 - 0.25) < 0.002, `render from beat 0.5: the note lands at ${r.on2 && r.on2.toFixed(5)} s (want 0.25)`);
}

{
  // mix: mute, solo, fader, pan
  const r = await page.evaluate(async () => {
    const { proj, track, stat } = T;
    const A = [{ p: 60, t: 0, d: 4 }], B = [{ p: 72, t: 0, d: 4 }];
    const go = async (pa = {}, pb = {}, opts = {}) => { const { engine } = mk(proj({ tracks: [track('t_a', A, pa), track('t_b', B, pb)] })); const buf = await engine.render({ from: 0, to: 4, tail: 0, ...opts }); return { s: stat(buf, 0.1, 1.9), buf }; };
    const both = await go(), a0 = await go({}, { mute: true }), b0 = await go({ mute: true }, {});
    const soloA = await go({ solo: true }, {}), soloB = await go({}, { solo: true });
    const aMinus6 = await go({ gain: -6 }, { mute: true });
    const aPlus3 = await go({ gain: 3 }, { mute: true });
    const onlyB = await go({}, {}, { tracks: ['t_b'] });
    const left = await go({ pan: -1 }, { mute: true });
    const L = stat({ ...left.buf, numberOfChannels: 1, getChannelData: () => left.buf.getChannelData(0), sampleRate: 48000, length: left.buf.length, duration: left.buf.duration }, 0.1, 1.9);
    const Rr = stat({ ...left.buf, numberOfChannels: 1, getChannelData: () => left.buf.getChannelData(1), sampleRate: 48000, length: left.buf.length, duration: left.buf.duration }, 0.1, 1.9);
    return { both: both.s.rmsDb, a: a0.s.rmsDb, b: b0.s.rmsDb, soloA: soloA.s.rmsDb, soloB: soloB.s.rmsDb, m6: aMinus6.s.rmsDb, p3: aPlus3.s.rmsDb, onlyB: onlyB.s.rmsDb, L: L.rmsDb, R: Rr.rmsDb };
  });
  T.ok(r.both > r.a && r.both > r.b, `two tracks sum louder than either (${r.both.toFixed(2)} vs ${r.a.toFixed(2)} / ${r.b.toFixed(2)} dB)`);
  T.ok(Math.abs(r.soloA - r.a) < 0.01 && Math.abs(r.soloB - r.b) < 0.01, `solo A == mute B (${r.soloA.toFixed(2)} / ${r.a.toFixed(2)}); solo B == mute A (${r.soloB.toFixed(2)} / ${r.b.toFixed(2)})`);
  T.ok(Math.abs((r.a - r.m6) - 6) < 0.05, `fader -6 dB measures ${(r.m6 - r.a).toFixed(3)} dB`);
  T.ok(Math.abs((r.p3 - r.a) - 3) < 0.05, `fader +3 dB measures +${(r.p3 - r.a).toFixed(3)} dB`);
  T.ok(Math.abs(r.onlyB - r.b) < 0.01, `render({ tracks: ['t_b'] }) is track B alone (${r.onlyB.toFixed(2)} dB)`);
  T.ok(r.R < -100 && r.L > -40, `hard-left pan: L ${r.L.toFixed(1)} dB, R ${r.R.toFixed(1)} dB`);
}

{
  // audio clips from an asset
  const r = await page.evaluate(async () => {
    const { proj, stat, onset } = T;
    const sr = 44100, n = sr * 2, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
    const { engine } = mk(proj({ tracks: [{ id: 't_au', name: 'au', kind: 'audio', instrument: null, inserts: [], gain: 0, pan: 0, mute: false, solo: false,
      clips: [{ id: 'c_au', kind: 'audio', start: 2, length: 2, asset: 'a_sine01', offset: 0, gain: 0 }] }] }));
    const info = await engine.assets.put('a_sine01', { sr, channels: [x] });
    const back = await engine.assets.get('a_sine01');
    const buf = await engine.render({ from: 0, to: 6, tail: 0 });
    const mid = stat(buf, 1.2, 1.8), before = stat(buf, 0, 0.99), after = stat(buf, 2.01, 3);
    const on = onset(buf, 1e-3);
    // a clip half in range, with an offset into the sample
    const { engine: e2 } = mk(proj({ tracks: [{ id: 't_au', name: 'au', kind: 'audio', instrument: null, inserts: [], gain: -6, pan: 0, mute: false, solo: false,
      clips: [{ id: 'c_au', kind: 'audio', start: 0, length: 3, asset: 'a_sine01', offset: 0.25, gain: 0 }] }] }));
    const b2 = await e2.render({ from: 1, to: 4, tail: 0 });
    const s2 = stat(b2, 0.05, 0.95), tailS = stat(b2, 1.001, 1.5);
    return { info, backLen: back && back.length, mid: mid.rmsDb, midPk: mid.peak, before: before.peak, after: after.peak, on, s2: s2.rmsDb, tail2: tailS.peak };
  });
  T.ok(r.backLen === 88200 && Math.abs(r.info.duration - 2) < 1e-6, `assets.put/get round-trips a 2 s sine (${r.backLen} frames)`);
  T.ok(r.on != null && Math.abs(r.on - 1.0) < 0.002, `audio clip at beat 2 starts at ${r.on && r.on.toFixed(5)} s`);
  T.ok(Math.abs(r.mid - (20 * Math.log10(0.5 / Math.SQRT2))) < 0.1 && Math.abs(r.midPk - 0.5) < 0.01, `clip plays at unity: rms ${r.mid.toFixed(2)} dB (want ${(20 * Math.log10(0.5 / Math.SQRT2)).toFixed(2)}), peak ${r.midPk.toFixed(4)}`);
  T.ok(r.before === 0 && r.after === 0, 'silent before the clip and after its 2 beats');
  T.ok(Math.abs(r.s2 - (20 * Math.log10(0.5 / Math.SQRT2) - 6)) < 0.15 && r.tail2 === 0, `a clip already sounding at the render start plays from its middle at -6 dB (${r.s2.toFixed(2)} dB) and stops at its end`);
}

{
  // the safety soft clip
  const r = await page.evaluate(async () => {
    const { proj, track, stat } = T;
    const chord = [36, 48, 55, 60, 63, 67, 70, 72].map((p) => ({ p, t: 0, d: 4, v: 1 }));
    const tracks = [];
    for (let i = 0; i < 6; i++) tracks.push(track('t_h' + i, chord, { gain: 12 }));
    const { engine } = mk(proj({ tracks }));
    const buf = await engine.render({ from: 0, to: 4, tail: 0.5 });
    const s = stat(buf);
    // the same mix, measured before the clip (master gain way down, scaled back up)
    const { engine: e2 } = mk(proj({ tracks, master: { gain: -40, inserts: [] } }));
    const pre = stat(await e2.render({ from: 0, to: 4, tail: 0.5 }));
    // transparency: a -6 dBFS sine passes untouched
    const sr = 48000, x = new Float32Array(sr);
    for (let i = 0; i < sr; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
    await engine.assets.put('a_sine1k', { sr, channels: [x, x] });
    const { engine: e3 } = mk(proj({ tracks: [{ id: 't_s', name: 's', kind: 'audio', instrument: null, inserts: [], gain: 0, pan: 0, mute: false, solo: false, clips: [{ id: 'c_s', kind: 'audio', start: 0, length: 2, asset: 'a_sine1k', offset: 0, gain: 0 }] }] }));
    const b3 = await e3.render({ from: 0, to: 2, tail: 0 });
    let maxErr = 0; const d = b3.getChannelData(0);
    for (let i = 4800; i < 40000; i++) maxErr = Math.max(maxErr, Math.abs(d[i] - x[i]));
    const tp = T.M ? T.M.measure(buf).truePeak : null;
    return { peak: s.peak, peakDb: s.peakDb, preDb: pre.peakDb + 40, maxErr, tp };
  });
  T.ok(r.preDb > 6, `the hot mix would peak at +${r.preDb.toFixed(1)} dBFS without the clip`);
  T.ok(r.peak < 1, `the soft clip holds it to ${r.peakDb.toFixed(2)} dBFS sample peak${r.tp != null ? `, ${r.tp} dBTP true peak` : ''}`);
  T.ok(r.maxErr < 1e-5, `a -6 dBFS sine passes the soft clip untouched (max error ${r.maxErr.toExponential(2)})`);
}

{
  // a real graph effect from the registry, offline: an insert changes the level by what it says
  const r = await page.evaluate(async () => {
    const { proj, track, stat, R } = T;
    R.defineDevice({ id: 'test.halfgain', name: 'Half', kind: 'effect', params: [{ key: 'db', min: -24, max: 0, def: -6 }],
      build(c) { const g = c.createGain(); return { input: g, output: g, set(v) { g.gain.value = Math.pow(10, v.db / 20); } }; } });
    const A = [{ p: 60, t: 0, d: 4 }];
    const dry = stat(await mk(proj({ tracks: [track('t_a', A)] })).engine.render({ from: 0, to: 4, tail: 0 }), 0.2, 1.8).rmsDb;
    const wet = stat(await mk(proj({ tracks: [track('t_a', A, { inserts: [{ id: 'fx_h1', device: 'test.halfgain', on: true, params: {} }] })] })).engine.render({ from: 0, to: 4, tail: 0 }), 0.2, 1.8).rmsDb;
    const wet12 = stat(await mk(proj({ tracks: [track('t_a', A, { inserts: [{ id: 'fx_h1', device: 'test.halfgain', on: true, params: { db: -12 } }] })] })).engine.render({ from: 0, to: 4, tail: 0 }), 0.2, 1.8).rmsDb;
    const off = stat(await mk(proj({ tracks: [track('t_a', A, { inserts: [{ id: 'fx_h1', device: 'test.halfgain', on: false, params: {} }] })] })).engine.render({ from: 0, to: 4, tail: 0 }), 0.2, 1.8).rmsDb;
    const missing = stat(await mk(proj({ tracks: [track('t_a', A, { inserts: [{ id: 'fx_m1', device: 'test.nope', on: true, params: {} }] })] })).engine.render({ from: 0, to: 4, tail: 0 }), 0.2, 1.8).rmsDb;
    return { dry, wet, wet12, off, missing };
  });
  T.ok(Math.abs(r.wet - r.dry + 6) < 0.05, `a graph insert at its default (-6 dB) measures ${(r.wet - r.dry).toFixed(3)} dB`);
  T.ok(Math.abs(r.wet12 - r.dry + 12) < 0.05, `its params reach it (-12 dB measures ${(r.wet12 - r.dry).toFixed(3)} dB)`);
  T.ok(Math.abs(r.off - r.dry) < 0.05, `bypassed (on: false) it is the dry signal (${(r.off - r.dry).toFixed(3)} dB)`);
  T.ok(Math.abs(r.missing - r.dry) < 0.01, `a missing effect is a pass-through (${(r.missing - r.dry).toFixed(3)} dB)`);
}

{
  // determinism with many tracks, chords and pans (tracks sum through a chain, voices through slots)
  const r = await page.evaluate(async () => {
    const { proj, track, same } = T;
    const tracks = [];
    for (let k = 0; k < 5; k++) {
      const notes = [];
      for (let b = 0; b < 8; b++) for (const iv of [0, 3, 7, 10]) notes.push({ p: 40 + k * 5 + iv, t: b, d: 1.5, v: 0.5 + 0.1 * (b % 4) });
      tracks.push(track('t_d' + k, notes, { pan: -0.8 + k * 0.4, gain: -3 }));
    }
    const { engine } = mk(proj({ tracks }));
    const a = await engine.render({ from: 0, to: 8, tail: 1 }), b = await engine.render({ from: 0, to: 8, tail: 1 }), c = await engine.render({ from: 0, to: 8, tail: 1 });
    return same(a, b) && same(a, c);
  });
  T.ok(r, 'five tracks of overlapping chords render sample-identical three times');
}

// ---------------------------------------------------------------------------------------------- live
{
  // loop wrap: a 2-beat loop, notes at 0 and 1; spy on the instrument's noteOn times
  const r = await page.evaluate(async () => {
    const { proj, track, sleep } = T;
    const { engine } = mk(proj({ tempo: 120, loop: { on: true, start: 0, end: 2 }, tracks: [track('t_a', [{ p: 60, t: 0, d: 0.25 }, { p: 64, t: 1, d: 0.25 }, { p: 67, t: 2, d: 0.25 }])] }));
    await engine.start();
    const inst = engine.instance('t_a', 'instrument');
    const ons = [], offs = [];
    const on0 = inst.noteOn, off0 = inst.noteOff;
    inst.noteOn = (p, v, t) => { ons.push([p, t]); return on0(p, v, t); };
    inst.noteOff = (p, t) => { offs.push([p, t]); return off0(p, t); };
    const tr = [];
    engine.on('transport', (e) => tr.push(e.why));
    await engine.play(0);
    { const c0 = engine.ctx.currentTime, w0 = performance.now(); while (engine.ctx.currentTime < c0 + 2.6 && performance.now() - w0 < 15000) await sleep(10); }   // (2.6 s on the audio clock: a loaded machine starts it late)
    const beatMid = engine.beat, gridMid = engine.gridBeat;
    const playing = engine.playing;
    engine.stop();
    const gridStopped = engine.gridBeat;
    const afterStop = ons.length;
    await sleep(300);
    const m = engine.meters.master.peak;
    await engine.dispose();
    return { ons, offs, tr, beatMid, gridMid, gridStopped, playing, afterStop, onsAfter: ons.length, m, ctxState: engine.ctx.state };
  });
  const ons = r.ons;
  const t0 = ons[0] && ons[0][1];
  const want = [];
  for (let k = 0; k < ons.length; k++) want.push([k % 2 ? 64 : 60, t0 + k * 0.5]);
  const exact = ons.every(([p, t], k) => p === want[k][0] && Math.abs(t - want[k][1]) < 1 / 48000 + 1e-9);
  T.ok(ons.length >= 5 && ons.length <= 7, `about 2.6 s of a 1 s loop scheduled ${ons.length} notes`);
  T.ok(exact, `loop wraps are sample-accurate: notes alternate C/E every 0.5 s exactly (${ons.map((x) => x[0] + '@' + (x[1] - t0).toFixed(4)).join(' ')})`);
  T.ok(!ons.some(([p]) => p === 67), 'the note at the loop end (beat 2) never plays');
  T.ok(r.offs.length >= r.ons.length - 1, `every note gets its note-off (${r.offs.length} offs for ${r.ons.length} ons)`);
  T.ok(r.tr.includes('play') && r.tr.includes('loop') && r.tr.includes('stop'), `transport events: ${[...new Set(r.tr)].join(', ')}`);
  T.ok(r.beatMid >= 0 && r.beatMid < 2, `engine.beat wraps inside the loop (${r.beatMid.toFixed(3)})`);
  const wrapsDone = Math.floor(r.gridMid / 2);
  T.ok(r.gridMid > 4 && Math.abs(r.gridMid - wrapsDone * 2 - r.beatMid) < 0.05 && r.gridStopped === null, `engine.gridBeat keeps counting through the wraps (${r.gridMid.toFixed(3)}: ${wrapsDone} loops + ${r.beatMid.toFixed(3)}), null when stopped`);
  T.ok(r.playing && r.onsAfter === r.afterStop, 'stop schedules nothing more');
  T.ok(r.m < -90, `silence 300 ms after stop (master ${r.m} dBFS)`);
}

{
  // live play, meters, mute/solo live, reconcile while playing (insert add / move / remove), tempo change, seek
  const r = await page.evaluate(async () => {
    const { proj, track, sleep, R } = T;
    const notes = []; for (let b = 0; b < 32; b++) notes.push({ p: 48 + (b % 8) * 2, t: b * 0.5, d: 0.45 });
    const { engine, store } = mk(proj({ tracks: [track('t_a', notes), track('t_b', [{ p: 72, t: 0, d: 32 }]), { id: 't_au', name: 'au', kind: 'audio', instrument: null, inserts: [], clips: [], gain: 0, pan: 0, mute: false, solo: false }] }));
    store.get().tracks[0].clips[0].length = 32;
    store.get().tracks[1].clips[0].length = 32;
    const out = {};
    await engine.start();
    // live notes with the transport stopped
    engine.liveNoteOn('t_a', 60, 0.9);
    await sleep(250);
    out.liveMeter = engine.meters.tracks.t_a && engine.meters.tracks.t_a.peak;
    engine.liveNoteOff('t_a', 60);
    await sleep(600);
    out.liveAfter = engine.meters.tracks.t_a.peak;
    engine.audition('t_a', 64, 0.8, 0.25);
    await sleep(80);
    out.audMeter = engine.meters.tracks.t_a.peak;
    await sleep(700);
    out.audAfter = engine.meters.tracks.t_a.peak;
    // input monitoring node
    const inN = engine.inputNode('t_au');
    const osc = engine.ctx.createOscillator(); osc.connect(inN); osc.start();
    await sleep(150);
    out.inputMeter = engine.meters.tracks.t_au.peak;
    osc.stop(); osc.disconnect();
    // play; mute / solo while playing
    await engine.play(0);
    await sleep(300);
    out.aPlaying = engine.meters.tracks.t_a.peak;
    store.dispatch({ type: 'track.set', track: 't_a', patch: { mute: true } });
    await sleep(200);
    out.aMuted = engine.meters.tracks.t_a.peak; out.bWhileAMuted = engine.meters.tracks.t_b.peak;
    store.dispatch({ type: 'track.set', track: 't_a', patch: { mute: false } });
    store.dispatch({ type: 'track.set', track: 't_a', patch: { solo: true } });
    await sleep(200);
    out.bSoloA = engine.meters.tracks.t_b.peak; out.aSolo = engine.meters.tracks.t_a.peak;
    store.dispatch({ type: 'track.set', track: 't_a', patch: { solo: false } });
    // fader live: a steady sine into the audio track's input, then -12 dB on its fader
    const o2 = engine.ctx.createOscillator(); o2.frequency.value = 500; const og = engine.ctx.createGain(); og.gain.value = 0.25;
    o2.connect(og); og.connect(engine.inputNode('t_au')); o2.start();
    await sleep(150);
    const avg = async () => { let s = 0; for (let i = 0; i < 5; i++) { await sleep(40); s += engine.meters.tracks.t_au.rms; } return s / 5; };
    const before = await avg();
    store.dispatch({ type: 'track.set', track: 't_au', patch: { gain: -12 } });
    await sleep(120);
    out.faderDelta = (await avg()) - before; out.faderDbg = before;
    o2.stop(); o2.disconnect(); og.disconnect();
    // reconcile while playing: add a graph insert, a missing one, move, remove
    if (!R.getDevice('test.halfgain')) R.defineDevice({ id: 'test.halfgain', name: 'Half', kind: 'effect', params: [{ key: 'db', min: -24, max: 0, def: -6 }], build(c) { const g = c.createGain(); return { input: g, output: g, set(v) { g.gain.value = Math.pow(10, v.db / 20); } }; } });
    const graphEv = []; engine.on('graph', (e) => graphEv.push(e.kind));
    const a1 = store.dispatch({ type: 'insert.add', track: 't_a', insert: { device: 'test.halfgain' } });
    const a2 = store.dispatch({ type: 'insert.add', track: 't_a', insert: { device: 'test.not-there' } });
    await engine.settled();
    const fx1 = a1.created.insert, fx2 = a2.created.insert;
    out.inst1 = !!engine.instance('t_a', fx1) && !engine.instance('t_a', fx1).fallback;
    out.inst2fallback = !!(engine.instance('t_a', fx2) && engine.instance('t_a', fx2).fallback);
    store.dispatch({ type: 'insert.set', track: 't_a', insert: fx1, patch: { params: { db: -18 } } });
    store.dispatch({ type: 'insert.move', track: 't_a', insert: fx2, index: 0 });
    await engine.settled();
    out.order = engine.instance('t_a', fx2) && engine.instance('t_a', fx1) ? 'both' : 'lost';
    await sleep(150);
    out.aWithFx = engine.meters.tracks.t_a.peak;
    store.dispatch({ type: 'insert.remove', track: 't_a', insert: fx1 });
    store.dispatch({ type: 'insert.remove', track: 't_a', insert: fx2 });
    store.dispatch({ type: 'insert.add', track: 'master', insert: { device: 'test.halfgain' } });
    await engine.settled();
    out.gone = engine.instance('t_a', fx1) === null && engine.instance('t_a', fx2) === null;
    out.masterFx = !!engine.instance('master', store.get().master.inserts[0].id);
    out.graphEv = graphEv;
    // instrument swap while playing (A has a note every half beat)
    store.dispatch({ type: 'instrument.set', track: 't_a', device: 'test.other-missing' });
    await engine.settled();
    out.swapped = engine.instance('t_a', 'instrument').missing === 'test.other-missing';
    const sw = []; for (let i = 0; i < 6; i++) { await sleep(60); sw.push(engine.meters.tracks.t_a.peak); }
    out.bAfterSwap = Math.max(...sw); out.swDbg = [sw, engine.beat, engine.playing];
    // tempo change while playing: notes keep coming, spacing follows
    const inst = engine.instance('t_a', 'instrument');
    const ons = []; const on0 = inst.noteOn; inst.noteOn = (p, v, t) => { ons.push(t); return on0(p, v, t); };
    await sleep(800);
    store.dispatch({ type: 'project.set', patch: { tempo: 60 } });
    await sleep(1600);
    const gaps = []; for (let i = 1; i < ons.length; i++) gaps.push(+(ons[i] - ons[i - 1]).toFixed(4));
    out.gaps = gaps;
    // notes added just ahead of the playhead (inside the scheduled window) still play, once
    const b = engine.beat;
    ons.length = 0;
    const clipStartBeat = 0;
    const at = Math.ceil((b + 0.06 - clipStartBeat) * 100) / 100; // ~60 ms ahead at 60 bpm
    store.dispatch({ type: 'notes.add', track: 't_a', clip: 'c_t_a', notes: [{ p: 90, t: at, d: 0.1, v: 0.5 }] });
    const pitches = []; inst.noteOn = (p, v, t) => { pitches.push(p); ons.push(t); return on0(p, v, t); };
    await sleep(500);
    out.addedPlayed = pitches.filter((p) => p === 90).length;
    // seek while playing
    engine.seek(8);
    await sleep(200);
    out.afterSeek = engine.beat;
    out.playing = engine.playing;
    // (the click is a buffer of engine/click.js's knock, 60 ms long)
    const mk0 = engine.ctx.createBufferSource.bind(engine.ctx); let oscs = 0;
    engine.ctx.createBufferSource = () => { const o = mk0(); const st = o.start.bind(o); o.start = (t, ...r) => { if (o.buffer && Math.abs(o.buffer.duration - 0.06) < 0.002) oscs++; return st(t, ...r); }; return o; };
    store.dispatch({ type: 'track.set', track: 't_a', patch: { mute: true } });
    store.dispatch({ type: 'track.set', track: 't_b', patch: { mute: true } });
    const mt = []; engine.on('transport', (e) => mt.push(e.why));
    engine.metronome = true;
    await sleep(1300);
    engine.metronome = false;
    out.clicks = oscs; out.metEv = mt.includes('metronome');
    delete engine.ctx.createBufferSource;
    engine.stop();
    await sleep(400);
    out.stopped = engine.meters.master.peak;
    out.cursor = engine.beat;
    await engine.play();
    await sleep(100);
    out.resumedFrom = engine.beat;
    engine.stop();
    out.errs = T.errs.map((e) => e.message);
    await engine.dispose();
    return out;
  });
  T.ok(r.liveMeter > -40, `liveNoteOn sounds (track meter ${r.liveMeter} dBFS)`);
  T.ok(r.liveAfter < -80, `liveNoteOff releases it (${r.liveAfter} dBFS)`);
  T.ok(r.audMeter > -40 && r.audAfter < -80, `audition plays a short note and lets it go (${r.audMeter} -> ${r.audAfter} dBFS)`);
  T.ok(r.inputMeter > -12, `inputNode feeds the audio track's strip (${r.inputMeter} dBFS)`);
  T.ok(r.aPlaying > -40, `playing: track A meters ${r.aPlaying} dBFS`);
  T.ok(r.aMuted < -100 && r.bWhileAMuted > -40, `mute while playing: A ${r.aMuted}, B ${r.bWhileAMuted} dBFS`);
  T.ok(r.bSoloA < -100 && r.aSolo > -40, `solo A while playing: B ${r.bSoloA}, A ${r.aSolo} dBFS`);
  T.ok(Math.abs(r.faderDelta + 12) < 0.1, `fader -12 dB while playing: a steady input's rms moved ${r.faderDelta.toFixed(3)} dB (from ${r.faderDbg.toFixed(2)} dBFS)`);
  T.ok(r.inst1 && r.inst2fallback, 'inserts added while playing: the graph device is live, the missing one is a pass-through');
  T.ok(r.order === 'both' && r.gone && r.masterFx, 'insert move / remove / master insert reconcile');
  T.ok(r.aWithFx > -60, `track still sounds through its inserts (${r.aWithFx} dBFS)`);
  T.ok(r.graphEv.includes('inserts'), `'graph' events on rewires (${[...new Set(r.graphEv)].join(', ')})`);
  T.ok(r.swapped && r.bAfterSwap > -60, `instrument swapped while playing keeps sounding (${r.bAfterSwap} dBFS)`);
  const g = r.gaps;
  T.ok(g.length >= 4 && g.includes(0.25) && g.includes(0.5) && g.every((x) => x >= 0.25 - 1e-3 && x <= 0.5 + 1e-3), `tempo 120 -> 60 while playing: eighth notes go from 0.25 s to 0.5 s apart (${g.join(' ')})`);
  T.ok(r.addedPlayed === 1, `a note added inside the scheduled window plays exactly once (${r.addedPlayed})`);
  T.ok(r.playing && r.afterSeek >= 8 && r.afterSeek < 8.5, `seek(8) while playing: beat ${r.afterSeek.toFixed(3)}`);
  T.ok(r.clicks >= 1 && r.clicks <= 3 && r.metEv, `metronome: ${r.clicks} clicks in 1.3 s at 60 bpm, 'transport' event on toggle`);
  T.ok(r.stopped < -90, `stop leaves silence (master ${r.stopped} dBFS)`);
  T.ok(Math.abs(r.resumedFrom - r.cursor) < 0.3, `play() resumes from where it stopped (${r.cursor.toFixed(2)} -> ${r.resumedFrom.toFixed(2)})`);
  T.note('engine errors reported: ' + [...new Set(r.errs)].join(' | '));
}

{
  // audio clips live: play from the start, and seek into the middle of one
  const r = await page.evaluate(async () => {
    const { proj, sleep } = T;
    const sr = 48000, x = new Float32Array(sr * 4);
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / sr);
    const { engine } = mk(proj({ tracks: [{ id: 't_au', name: 'au', kind: 'audio', instrument: null, inserts: [], gain: 0, pan: 0, mute: false, solo: false,
      clips: [{ id: 'c_au', kind: 'audio', start: 1, length: 6, asset: 'a_live01', offset: 0, gain: 0 }] }] }));
    await engine.assets.put('a_live01', { sr, channels: [x] });
    await engine.start();
    await engine.play(0);
    await sleep(250);
    const before = engine.meters.tracks.t_au.peak; // beat < 1: silent
    await sleep(500);
    const during = engine.meters.tracks.t_au.peak;
    engine.seek(4);
    await sleep(250);
    const afterSeek = engine.meters.tracks.t_au.peak;
    engine.stop();
    await sleep(200);
    const stopped = engine.meters.tracks.t_au.peak;
    await engine.play(8);
    await sleep(250);
    const pastEnd = engine.meters.tracks.t_au.peak;
    engine.stop();
    await engine.dispose();
    return { before, during, afterSeek, stopped, pastEnd };
  });
  T.ok(r.before < -100 && r.during > -9, `live audio clip starts on its beat (${r.before} -> ${r.during} dBFS; the sine peaks at -6)`);
  T.ok(r.afterSeek > -9, `seek into the middle of a clip picks it up mid-way (${r.afterSeek} dBFS)`);
  T.ok(r.stopped < -100 && r.pastEnd < -100, `stop fades it out; nothing past its end (${r.stopped} / ${r.pastEnd} dBFS)`);
}

{
  // click-free: a steady sine into an audio track, captured after the soft clip (masterTap), while the engine
  // rewires inserts, moves the fader, mutes, pans and swaps things under it
  const r = await page.evaluate(async () => {
    const { proj, sleep, R } = T;
    if (!R.getDevice('test.halfgain')) R.defineDevice({ id: 'test.halfgain', name: 'Half', kind: 'effect', params: [{ key: 'db', min: -24, max: 0, def: -6 }], build(c) { const g = c.createGain(); return { input: g, output: g, set(v) { g.gain.value = Math.pow(10, v.db / 20); } }; } });
    const { engine, store } = mk(proj({ tracks: [{ id: 't_x', name: 'x', kind: 'audio', instrument: null, inserts: [], clips: [], gain: 0, pan: 0, mute: false, solo: false }] }));
    await engine.start();
    const ctx = engine.ctx;
    const src = `registerProcessor('cap', class extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = () => { this.on = false; }; } process(i) { const x = i[0]; if (x && x[0]) this.port.postMessage([x[0].slice(), currentTime]); return this.on; } });`;
    await ctx.audioWorklet.addModule('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));
    const cap = new AudioWorkletNode(ctx, 'cap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    const chunks = []; cap.port.onmessage = (e) => chunks.push(e.data);
    const z = ctx.createGain(); z.gain.value = 0; cap.connect(z); z.connect(ctx.destination);
    engine.masterTap.connect(cap);
    const o = ctx.createOscillator(); o.frequency.value = 300; const g = ctx.createGain(); g.gain.value = 0.3;
    o.connect(g); g.connect(engine.inputNode('t_x'));
    o.start();
    await sleep(200);
    const steps = [];
    const act = async (name, fn) => { steps.push([name, +ctx.currentTime.toFixed(3)]); fn(); await engine.settled(); await sleep(90); };
    let fx1, fx2;
    await act('insert.add', () => { fx1 = store.dispatch({ type: 'insert.add', track: 't_x', insert: { device: 'test.halfgain' } }).created.insert; });
    await act('insert.add missing', () => { fx2 = store.dispatch({ type: 'insert.add', track: 't_x', insert: { device: 'test.gone' } }).created.insert; });
    await act('insert.move', () => store.dispatch({ type: 'insert.move', track: 't_x', insert: fx2, index: 0 }));
    await act('fader', () => store.dispatch({ type: 'track.set', track: 't_x', patch: { gain: -9 } }));
    await act('pan', () => store.dispatch({ type: 'track.set', track: 't_x', patch: { pan: 0.7 } }));
    await act('mute', () => store.dispatch({ type: 'track.set', track: 't_x', patch: { mute: true } }));
    await act('unmute', () => store.dispatch({ type: 'track.set', track: 't_x', patch: { mute: false } }));
    await act('master gain', () => store.dispatch({ type: 'project.set', patch: {} }) && store.dispatch({ type: 'track.set', track: 't_x', patch: { gain: 0 } }));
    await act('master insert', () => store.dispatch({ type: 'insert.add', track: 'master', insert: { device: 'test.halfgain' } }));
    await act('insert.remove', () => store.dispatch({ type: 'insert.remove', track: 't_x', insert: fx1 }));
    await act('insert.remove 2', () => store.dispatch({ type: 'insert.remove', track: 't_x', insert: fx2 }));
    await act('track.add', () => store.dispatch({ type: 'track.add', track: { id: 't_y', name: 'y', kind: 'instrument', instrument: { device: 'test.none' } } }));
    await act('track.remove', () => store.dispatch({ type: 'track.remove', track: 't_y' }));
    g.gain.setTargetAtTime(0, ctx.currentTime + 0.03, 0.005); // (the test's own sine fades out: not a click of ours)
    await sleep(150);
    cap.port.postMessage('stop');
    o.stop();
    await sleep(50);
    // the largest second difference (a click is a kink or a step; a 300 Hz sine at 0.3 has at most ~0.0012)
    let worst = 0, at = 0, n = 0, prev2 = null, prev1 = null, peak = 0;
    const t0 = steps[0][1] - 0.1; // from 100 ms before the first change (the sine's own start is not ours)
    const bad = [];
    for (const [L, ct] of chunks) for (let i = 0; i < L.length; i++, n++) {
      const y = L[i]; peak = Math.max(peak, Math.abs(y));
      const t = ct + i / ctx.sampleRate;
      if (prev2 !== null && t > t0) { const d = Math.abs(y - 2 * prev1 + prev2); if (d > worst) { worst = d; at = t; } if (d > 0.01 && bad.length < 20) bad.push([+t.toFixed(4), +d.toFixed(3)]); }
      prev2 = prev1; prev1 = y;
    }
    await engine.dispose();
    return { worst, at, secs: n / ctx.sampleRate, peak, steps: steps.length, stepList: steps, bad };
  });
  T.ok(r.secs > 1, `captured ${r.secs.toFixed(2)} s of masterTap across ${r.steps} live changes (peak ${r.peak.toFixed(3)})`);
  T.ok(r.worst < 0.01, `no clicks: largest second difference ${r.worst.toExponential(2)} (at ${r.at.toFixed(3)} s; a 300 Hz sine alone is ~1.2e-3)`) || T.note(JSON.stringify({ steps: r.stepList, bad: r.bad }));
}

{
  // with the real devices (when the DSP / guitar areas have landed): a kernel instrument and kernel effects through
  // the engine, offline and live
  const r = await page.evaluate(async () => {
    const { proj, track, stat, onset, same, R, sleep } = T;
    for (const m of ['poly', 'drums', 'bass', 'keys', 'pluck', 'pad', 'verb', 'delay', 'chorus']) { try { await import(`/app/src/devices/builtin/${m}.js`); } catch { /* not there yet */ } }
    if (!R.getDevice('core.poly')) return { skip: true };
    const out = { have: R.listDevices().map((d) => d.id) };
    const notes = [{ p: 69, t: 1, d: 0.5, v: 0.8 }];
    const t1 = track('t_k', notes); t1.instrument.device = 'core.poly';
    const { engine } = mk(proj({ tracks: [t1] }));
    const a = await engine.render({ from: 0, to: 4, tail: 1 });
    const b = await engine.render({ from: 0, to: 4, tail: 1 });
    out.on = onset(a, 1e-3); out.same = same(a, b); out.peak = stat(a).peakDb; out.pre = stat(a, 0, 0.49).peak;
    // a chord progression through core.poly + a reverb insert, measured
    const chords = []; [[48, 55, 60, 63], [44, 51, 56, 60], [46, 53, 58, 62], [43, 50, 55, 59]].forEach((c, i) => c.forEach((p) => chords.push({ p, t: i * 2, d: 1.9, v: 0.75 })));
    const t2 = track('t_c', chords); t2.instrument.device = 'core.poly';
    const fxIds = R.listDevices({ kind: 'effect' }).map((d) => d.id);
    const verb = fxIds.find((id) => /verb/.test(id));
    if (verb) t2.inserts = [{ id: 'fx_v1', device: verb, on: true, params: {} }];
    const { engine: e2 } = mk(proj({ tracks: [t2] }));
    const c1 = await e2.render({ from: 0, to: 8, tail: 2 }), c2 = await e2.render({ from: 0, to: 8, tail: 2 });
    out.verb = verb || null; out.chordSame = same(c1, c2); out.chord = T.M ? T.M.measure(c1) : stat(c1);
    // live: play it and read the meters
    await e2.start();
    await e2.play(0);
    await sleep(600);
    out.liveMeter = e2.meters.tracks.t_c.peak; out.liveMaster = e2.meters.master.peak;
    out.instOk = !!e2.instance('t_c', 'instrument') && !e2.instance('t_c', 'instrument').fallback;
    e2.stop();
    await sleep(verb ? 50 : 600);
    e2.liveNoteOn('t_c', 60, 0.9); await sleep(200); out.liveNote = e2.meters.tracks.t_c.peak; e2.liveNoteOff('t_c', 60);
    await e2.dispose();
    out.errs = T.errs.filter((e) => !/no device "test\./.test(e.message)).map((e) => e.message);
    return out;
  });
  if (r.skip) T.note('built-in devices not there yet: skipped the real-device checks');
  else {
    T.note(`devices registered: ${r.have.length}`);
    T.ok(r.on != null && Math.abs(r.on - 0.5) < 0.002, `core.poly (kernel): note at beat 1 sounds at ${r.on && r.on.toFixed(5)} s, peak ${r.peak.toFixed(1)} dBFS, silent before: ${r.pre === 0}`);
    T.ok(r.same, 'core.poly renders sample-identical twice');
    T.ok(r.chordSame, `core.poly chords${r.verb ? ' through ' + r.verb : ''} render sample-identical twice`);
    const m = r.chord;
    T.ok(m && (m.lufs ?? m.rmsDb) > -40 && (m.truePeak ?? m.peakDb) < 0, `chord progression measures ${m.lufs != null ? m.lufs + ' LUFS, ' + m.truePeak + ' dBTP' : m.rmsDb.toFixed(1) + ' dB rms'}`);
    T.ok(r.instOk && r.liveMeter > -50 && r.liveMaster > -50, `live through the real devices: track ${r.liveMeter}, master ${r.liveMaster} dBFS`);
    T.ok(r.liveNote > -50, `liveNoteOn on a kernel instrument sounds (${r.liveNote} dBFS)`);
    T.ok(r.errs.length === 0, `no engine errors with the real devices${r.errs.length ? ': ' + r.errs.slice(0, 3).join(' | ') : ''}`);
  }
}

// ---------------------------------------------------------------------------------------------- the known gaps, closed
{
  // plugin delay compensation: an impulse on two tracks, one through Red Line (core.limiter, 88 samples of look-ahead),
  // panned apart so each channel is one track. Offline (browser and the canonical Node render) and live.
  const r = await page.evaluate(async () => {
    const { proj, firstOver, capture, sleep } = T;
    await import('/app/src/devices/builtin/index.js');
    const sr = 48000, x = new Float32Array(sr); x[480] = 0.25; // (10 ms in: past the clip's 3 ms fade-in)
    const { engine } = mk(proj());
    await engine.assets.put('a_imp001', { sr, channels: [x] });
    const tr = (id, pan, inserts) => ({ id, name: id, kind: 'audio', instrument: null, inserts, gain: 0, pan, mute: false, solo: false, clips: [{ id: 'c_' + id, kind: 'audio', start: 1, length: 2, asset: 'a_imp001', offset: 0, gain: 0 }] });
    const p = proj({ assets: { a_imp001: { kind: 'audio', name: 'impulse', sr, channels: 1, duration: 1 } },
      tracks: [tr('t_lim', 1, [{ id: 'fx_lim001', device: 'core.limiter', on: true, params: {} }]), tr('t_dry', -1, [])] });
    const e = mk(p).engine;
    const both = await e.render({ from: 0, to: 4, tail: 0.5 });
    const lim = await e.render({ from: 0, to: 4, tail: 0.5, tracks: ['t_lim'] });
    const dry = await e.render({ from: 0, to: 4, tail: 0.5, tracks: ['t_dry'] });
    // stems: each track alone, lined up to the whole set's latency (what export does), lands where it does in the mix
    const probe = await e.probeLatency({ tracks: ['t_lim', 't_dry'], withMix: true });
    const limStem = await e.render({ from: 0, to: 4, tail: 0.5, tracks: ['t_lim'], latencyMax: probe.max });
    const dryStem = await e.render({ from: 0, to: 4, tail: 0.5, tracks: ['t_dry'], latencyMax: probe.max });
    const out = { p, L: firstOver(both.getChannelData(0)), R: firstOver(both.getChannelData(1)), lat: both.latency,
      limAlone: firstOver(lim.getChannelData(1)), dryAlone: firstOver(dry.getChannelData(0)),
      probeMax: probe.max, limStem: firstOver(limStem.getChannelData(1)), dryStem: firstOver(dryStem.getChannelData(0)), dryStemComp: dryStem.latency.comp,
      pkL: T.stat({ ...both, numberOfChannels: 1, getChannelData: () => both.getChannelData(0), sampleRate: sr, length: both.length, duration: both.duration }).peak,
      pkR: T.stat({ ...both, numberOfChannels: 1, getChannelData: () => both.getChannelData(1), sampleRate: sr, length: both.length, duration: both.duration }).peak };
    // bypassed, a kernel still delays its dry path by its declared latency: the comp holds
    const pOff = structuredClone(p); pOff.tracks[0].inserts[0].on = false;
    const off = await mk(pOff).engine.render({ from: 0, to: 4, tail: 0.5 });
    out.offL = firstOver(off.getChannelData(0)); out.offR = firstOver(off.getChannelData(1));
    // live: the same song through the speakers' tap
    const live = mk(p).engine;
    await live.start();
    out.liveLat = live.latency; out.liveSr = live.ctx.sampleRate;
    const cap = await capture(live.ctx, live.masterTap);
    await live.play(0);
    await sleep(1100);
    live.stop();
    const c = await cap.stop();
    out.liveL = firstOver(c.L); out.liveR = firstOver(c.R);
    await live.dispose();
    return out;
  });
  const want = 24000 + 480 + 88; // beat 1 at 120 bpm, the impulse 10 ms into the clip, then the limiter's look-ahead
  T.ok(r.dryAlone === 24480 && r.limAlone === want, `uncompensated, the limiter's track lands ${r.limAlone - r.dryAlone} samples after the dry one (each rendered alone: ${r.limAlone} vs ${r.dryAlone})`);
  T.ok(Math.round(r.probeMax * 48000) === 88 && r.limStem === want && r.dryStem === want && r.dryStemComp.t_dry === 88, `stems line up: probeLatency finds the mix's ${Math.round(r.probeMax * 48000)} samples, and each track rendered alone with it lands where it does in the mix (${r.limStem} / ${r.dryStem}, want ${want})`);
  T.ok(r.L === want && r.R === want && Math.abs(r.pkL - 0.25) < 1e-6 && Math.abs(r.pkR - 0.25) < 1e-6, `engine.render lines them up at the master: both impulses at sample ${r.L} / ${r.R} (want ${want}), unchanged (${r.pkL.toFixed(4)} / ${r.pkR.toFixed(4)})`);
  T.ok(r.lat && r.lat.comp.t_dry === 88 && r.lat.comp.t_lim === 0 && Math.abs(r.lat.total * 48000 - 88) < 1e-6, `render reports the latency: comp ${JSON.stringify(r.lat && r.lat.comp)}, total ${(r.lat.total * 1000).toFixed(3)} ms`);
  T.ok(r.offL === want && r.offR === want, `bypassed, the limiter's dry path keeps its delay and the comp still lines up (${r.offL} / ${r.offR})`);
  const n = renderSong(r.p, { from: 0, to: 4, tail: 0.5, assets: { a_imp001: { sr: 48000, channels: [Float32Array.from({ length: 48000 }, (_, i) => (i === 480 ? 0.25 : 0))] } } });
  const fo = (d) => d.findIndex((v) => Math.abs(v) > 1e-3);
  T.ok(fo(n.channels[0]) === want && fo(n.channels[1]) === want && n.latency.comp.t_dry === 88, `the canonical Node render agrees: ${fo(n.channels[0])} / ${fo(n.channels[1])}, comp ${JSON.stringify(n.latency.comp)}`);
  const imp = { a_imp001: { sr: 48000, channels: [Float32Array.from({ length: 48000 }, (_, i) => (i === 480 ? 0.25 : 0))] } };
  const nStem = renderSong(r.p, { from: 0, to: 4, tail: 0.5, tracks: ['t_dry'], latencyMax: r.probeMax, assets: imp });
  T.ok(fo(nStem.channels[0]) === want, `…and its dry stem, given the mix's latency, lands there too (${fo(nStem.channels[0])})`);
  T.ok(r.liveL > 0 && r.liveL === r.liveR, `live, through masterTap: both impulses on the same sample (L ${r.liveL}, R ${r.liveR} into the capture)`);
  const lsr = r.liveSr, lsmp = r.liveLat && Math.round(r.liveLat.total * lsr);
  T.ok(r.liveLat && r.liveLat.comp.t_dry === lsmp && lsmp > 70 && r.liveLat.comp.t_lim === 0, `engine.latency reports it live: total ${r.liveLat && (r.liveLat.total * 1000).toFixed(3)} ms (${lsmp} samples at ${lsr} Hz), comp ${JSON.stringify(r.liveLat && r.liveLat.comp)}`);
}

{
  // edits inside the lookahead: a note already handed to the instrument (it is ~120 ms ahead) is deleted or moved
  const r = await page.evaluate(async () => {
    const { proj, track, capture, capPeak, sleep } = T;
    await import('/app/src/devices/builtin/index.js');
    const run = async (device, act, note = { p: 72, t: 2, d: 0.5, v: 0.9 }, waitSounding = 0) => {
      const tr = track('t_n', [note]); tr.instrument.device = device;
      const { engine, store } = mk(proj({ tracks: [tr] }));
      await engine.start();
      const ctx = engine.ctx, cap = await capture(ctx, engine.masterTap);
      const inst = engine.instance('t_n', 'instrument');
      const ons = []; const on0 = inst.noteOn;
      inst.noteOn = (p, v, t) => { ons.push({ p, t, at: ctx.currentTime }); return on0(p, v, t); };
      await engine.play(0);
      while (!ons.length) await sleep(1);
      const h = ons[0];
      if (waitSounding) { while (ctx.currentTime < h.t + waitSounding) await sleep(2); }
      const lead = h.t - ctx.currentTime, at = ctx.currentTime;
      act(store);
      await sleep(waitSounding ? 1500 : 900);
      engine.stop();
      const c = await cap.stop();
      await engine.dispose();
      return { lead, at, h, ons: ons.length, old: capPeak(c, h.t - 0.005, h.t + 0.24), later: capPeak(c, h.t + 0.25, h.t + 0.5), after: capPeak(c, at + 1.0, at + 1.3), all: capPeak(c, 0, 1e9) };
    };
    const del = (st) => st.dispatch({ type: 'notes.remove', track: 't_n', clip: 'c_t_n', ids: ['n0'] });
    const move = (st) => st.dispatch({ type: 'notes.set', track: 't_n', clip: 'c_t_n', notes: [{ id: 'n0', t: 2.5 }] });
    const keep = () => {};
    return {
      keep: await run('core.poly', keep), del: await run('core.poly', del), move: await run('core.poly', move),
      delFallback: await run('test.missing-synth', del),
      keepLong: await run('test.missing-synth', keep, { p: 60, t: 0.5, d: 4, v: 0.9 }, 0.3),
      delLong: await run('test.missing-synth', del, { p: 60, t: 0.5, d: 4, v: 0.9 }, 0.3),
      delLongK: await run('core.poly', del, { p: 60, t: 0.5, d: 4, v: 0.9 }, 0.3),
    };
  });
  const ms = (x) => (x * 1000).toFixed(0);
  T.ok(r.keep.old > 0.02, `control: a note at beat 2 sounds (peak ${r.keep.old.toFixed(3)}) once handed over ${ms(r.keep.lead)} ms ahead`);
  T.ok(r.del.all === 0, `deleted ${ms(r.del.lead)} ms before it was due (already handed to core.poly), it never sounds (peak ${r.del.all})`);
  T.ok(r.delFallback.all === 0, `the same with the fallback synth (deleted ${ms(r.delFallback.lead)} ms ahead): silent (peak ${r.delFallback.all})`);
  T.ok(r.move.old === 0 && r.move.later > 0.02 && r.move.ons === 2, `moved half a beat later ${ms(r.move.lead)} ms before it was due: nothing at the old time (${r.move.old}), it plays at the new one (${r.move.later.toFixed(3)}), handed over twice, heard once`);
  T.ok(r.keepLong.after > 0.01 && r.delLong.after < 1e-4 && r.delLongK.after < 1e-4, `a sounding note that is deleted is released (1 s later: ${r.delLong.after.toExponential(1)} fallback, ${r.delLongK.after.toExponential(1)} core.poly; kept: ${r.keepLong.after.toFixed(3)})`);
}

{
  // the metronome: through the speakers' soft clip, never in masterTap or a render
  const r = await page.evaluate(async () => {
    const { proj, track, same, capture, sleep } = T;
    const out = {};
    // a render is the same with the metronome on, even while the transport plays with it on
    const notes = [{ p: 60, t: 0, d: 1 }, { p: 64, t: 1, d: 1 }];
    const { engine } = mk(proj({ tracks: [track('t_a', notes)] }));
    const a = await engine.render({ from: 0, to: 4, tail: 0.2 });
    await engine.start();
    engine.metronome = true;
    await engine.play(0);
    const b = await engine.render({ from: 0, to: 4, tail: 0.2 });
    engine.stop(); engine.metronome = false;
    await engine.dispose();
    out.renderSame = same(a, b);
    // an empty song, metronome on: the speakers get clicks, masterTap nothing
    const e2 = mk(proj()).engine;
    await e2.start();
    out.hasMonitor = !!e2._monitor;
    const tap = await capture(e2.ctx, e2.masterTap), mon = await capture(e2.ctx, e2._monitor);
    e2.metronome = true;
    await e2.play(0);
    await sleep(1200);
    e2.stop();
    const ct = await tap.stop(), cm = await mon.stop();
    const pk = (...xs) => { let m = 0; for (const x of xs) for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
    out.tapPeak = pk(ct.L, ct.R);
    out.monPeak = pk(cm.L);
    await e2.dispose();
    // a hot mix (the soft clip test's: +18 dBFS into the clip) with the metronome on: the speakers stay under 0 dBFS
    const chord = [36, 48, 55, 60, 63, 67, 70, 72].map((p) => ({ p, t: 0, d: 8, v: 1 }));
    const tracks = []; for (let i = 0; i < 6; i++) tracks.push(track('t_h' + i, chord, { gain: 12 }));
    const e3 = mk(proj({ tracks })).engine;
    await e3.start();
    const tap3 = await capture(e3.ctx, e3.masterTap), mon3 = await capture(e3.ctx, e3._monitor);
    e3.metronome = true;
    await e3.play(0);
    await sleep(1600);
    e3.stop();
    const t3 = await tap3.stop(), m3 = await mon3.stop();
    out.hotTap = pk(t3.L);
    out.hotMon = pk(m3.L, m3.R);
    await e3.dispose();
    return out;
  });
  T.ok(r.renderSame, 'engine.render is sample-identical with the metronome on (and the transport playing it)');
  T.ok(r.hasMonitor && r.tapPeak === 0 && r.monPeak > 0.1, `metronome on an empty song: the speakers get clicks (peak ${r.monPeak.toFixed(3)}), masterTap gets nothing (${r.tapPeak})`);
  T.ok(r.hotMon < 0.95, `a mix in the soft clip (${r.hotTap.toFixed(3)} at the tap) plus the click: the speakers peak at ${r.hotMon.toFixed(3)} (the clicks used to sum after the clip: up to ${(r.hotTap + 0.32).toFixed(3)})`);
}

{
  // the master's meter reads the mix before the safety clip (engine/strip.js), so a mix that goes over reads over. It
  // read after the clip, which never passes about -0.5 dBFS: a mix summing to +2.4 dBFS read "-0.7" and never showed
  // red (docs/FRESH-EYES-6.md, the producer's Broken 2). The clip still holds what's heard (masterTap) under 0 dBFS.
  // A steady 1 kHz sine at -6.0 dBFS, so the level is known: its track at +12 dB puts +6.0 dBFS into the master.
  const r = await page.evaluate(async () => {
    const { proj, capture, sleep } = T;
    const sr = 48000, x = new Float32Array(sr * 2);
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
    const live = async (gain) => {
      const e = mk(proj({ tracks: [{ id: 't_s', name: 's', kind: 'audio', instrument: null, inserts: [], gain, pan: 0, mute: false, solo: false, clips: [{ id: 'c_s', kind: 'audio', start: 0, length: 4, asset: 'a_meter1k', offset: 0, gain: 0 }] }] })).engine;
      await e.assets.put('a_meter1k', { sr, channels: [x, x] });
      await e.start();
      const tap = await capture(e.ctx, e.masterTap);
      await e.play(0);
      const seen = [];
      for (let i = 0; i < 25; i++) { await sleep(40); seen.push([e.meters.master.peak, e.meters.tracks.t_s?.peak ?? -200]); }
      e.stop();
      const c = await tap.stop();
      await e.dispose();
      let pk = 0; for (const ch of [c.L, c.R]) for (let i = 0; i < ch.length; i++) pk = Math.max(pk, Math.abs(ch[i]));
      return { master: Math.max(...seen.map((s) => s[0])), track: Math.max(...seen.map((s) => s[1])), tap: pk };
    };
    return { hot: await live(12), quiet: await live(0) };
  });
  const sg = (x) => (x > 0 ? '+' : '') + x.toFixed(1);
  T.ok(Math.abs(r.hot.master - 6) < 0.15, `a mix peaking at +6.0 dBFS reads ${sg(r.hot.master)} on the master's meter, before the safety clip (after it, it read about -0.5)`);
  T.ok(r.hot.tap < 1, `while the clip still holds what's heard under 0 dBFS (masterTap peaks at ${r.hot.tap.toFixed(3)})`);
  T.ok(Math.abs(r.quiet.master + 6) < 0.15 && Math.abs(r.quiet.master - r.quiet.track) < 0.15, `a mix peaking at -6.0 dBFS reads ${sg(r.quiet.master)}, as its one track does (${sg(r.quiet.track)})`);
}

{
  // chase: one rule live and offline. A held note (beat 0, 8 beats long), played and rendered from beat 4.
  const r = await page.evaluate(async () => {
    const { proj, track, onset, sleep } = T;
    const p = proj({ tracks: [track('t_c', [{ p: 64, t: 0, d: 8, v: 0.8 }])] });
    const { engine } = mk(p);
    const off = await engine.render({ from: 4, to: 8, tail: 0.2 });
    await engine.start();
    const inst = engine.instance('t_c', 'instrument');
    const ons = []; const on0 = inst.noteOn; inst.noteOn = (q, v, t) => { ons.push({ q, t }); return on0(q, v, t); };
    const t0 = engine.ctx.currentTime;
    await engine.play(4);
    await sleep(250);
    const meter = engine.meters.tracks.t_c.peak;
    engine.stop();
    // a loop wrap chases too: loop 2..4, the note held across beat 2
    const e2 = mk(proj({ loop: { on: true, start: 2, end: 4 }, tracks: [track('t_c', [{ p: 64, t: 1, d: 4, v: 0.8 }])] })).engine;
    await e2.start();
    const i2 = e2.instance('t_c', 'instrument');
    const ons2 = []; const o2 = i2.noteOn; i2.noteOn = (q, v, t) => { ons2.push(t); return o2(q, v, t); };
    await e2.play(0);
    await sleep(3300);
    e2.stop();
    await engine.dispose(); await e2.dispose();
    return { offOn: onset(off, 1e-3), liveOn: ons.length ? ons[0].t - t0 : null, n: ons.length, meter, wraps: ons2.map((t) => +(t - ons2[0]).toFixed(4)) };
  });
  T.ok(r.offOn != null && r.offOn < 0.01, `offline from beat 4: the held note sounds from the start (${r.offOn && (r.offOn * 1000).toFixed(1)} ms)`);
  T.ok(r.n === 1 && r.liveOn != null && r.liveOn < 0.1 && r.meter > -40, `live from beat 4: the held note starts with the transport (${r.liveOn && (r.liveOn * 1000).toFixed(0)} ms after play(), meter ${r.meter} dBFS)`);
  T.ok(r.wraps.length >= 3 && r.wraps.slice(1).every((t, i) => Math.abs(t - (1.5 + i)) < 1e-4), `loop 2..4 with the note held across beat 2: it starts at beat 1, then at every wrap (${r.wraps.join(' ')} s)`);
}

{
  // silence costs nothing (live): a kernel with nothing coming in dozes once its output has been quiet for its hold,
  // and wakes on the first block something arrives
  const r = await page.evaluate(async () => {
    const { proj, track, sleep, R, capture, capPeak } = T;
    await import('/app/src/devices/builtin/index.js');
    R.defineDevice({ id: 'test.beep', name: 'Beep', kind: 'instrument', tail: 0.1, params: [],
      kernel: `({ create({ sr }) { return { voice() { let ph = 0, on = false, g = 0; return { start() { on = true; }, release() { on = false; }, render(L, R, n) { for (let i = 0; i < n; i++) { g += ((on ? 0.3 : 0) - g) * 0.01; ph += 440 / sr; const y = Math.sin(2 * Math.PI * ph) * g; L[i] += y; R[i] += y; } return on || g > 1e-6; } }; } }; } })` });
    const tr = track('t_z', [], { inserts: [{ id: 'fx_eq001', device: 'core.eq', on: true, params: {} }] }); tr.instrument.device = 'test.beep';
    const { engine } = mk(proj({ tracks: [tr] }));
    await engine.start();
    const inst = engine.instance('t_z', 'instrument'), eq = engine.instance('t_z', 'fx_eq001');
    engine.liveNoteOn('t_z', 69, 0.8); await sleep(150); engine.liveNoteOff('t_z', 69);
    const busy = [await inst.stats(), await eq.stats()].map((s) => s && s.dozing);
    await sleep(1500);
    const dozed = [await inst.stats(), await eq.stats()].map((s) => s && s.dozing);
    const cap = await capture(engine.ctx, engine.masterTap);
    const t = engine.ctx.currentTime + 0.05;
    inst.noteOn(69, 0.8, t);
    await sleep(300);
    const woke = [await inst.stats(), await eq.stats()].map((s) => s && s.dozing);
    const c = await cap.stop();
    // the first sample after the note-on (the attack is a one-pole: its first sample is 0.003 of full scale)
    const i0 = Math.round((t - c.t0) * c.sr);
    let first = -1; for (let i = Math.max(0, i0 - 256); i < c.L.length; i++) if (Math.abs(c.L[i]) > 0) { first = i - i0; break; }
    await engine.dispose();
    return { busy, dozed, woke, first, pk: capPeak(c, t + 0.1, t + 0.25) };
  });
  T.ok(r.busy.every((x) => x === false) && r.dozed.every((x) => x === true), `stopped and silent, the instrument and its EQ doze after their hold (playing: ${r.busy.join('/')}, 1.5 s later: ${r.dozed.join('/')})`);
  T.ok(r.woke.every((x) => x === false) && r.first === 0 && r.pk > 0.1, `a note wakes them on its own sample (first sound ${r.first} samples from the note-on, peak ${r.pk.toFixed(3)})`);
}

// ---------------------------------------------------------------------------------------------- recording (A1)
// docs/research/RECORDING-UX.md 3.5, 3.6, 3.12, 3.16: the count-in, the click's options, beatAt, recording past the
// song's end, a clip muted while it plays.
await page.evaluate(() => {
  // onsets in a capture: where it rises over thr after gap seconds under it; each { t (audio time), pk (next 30 ms) }
  T.onsets = (c, thr = 0.02, gap = 0.1) => {
    const out = [], g = Math.round(gap * c.sr), w = Math.round(0.03 * c.sr);
    let quiet = g;
    for (let i = 0; i < c.L.length; i++) {
      const v = Math.max(Math.abs(c.L[i]), Math.abs(c.R[i]));
      if (v > thr) {
        if (quiet >= g) { let pk = 0; for (let j = i; j < Math.min(c.L.length, i + w); j++) pk = Math.max(pk, Math.abs(c.L[j]), Math.abs(c.R[j])); out.push({ t: T.timeOf(c, i), pk }); }
        quiet = 0;
      } else quiet++;
    }
    return out;
  };
  // wait for a condition (polled), or for the audio clock to move s seconds (a loaded machine's clock can lag the wall)
  T.until = async (fn, ms = 15000) => { const t0 = performance.now(); while (!fn() && performance.now() - t0 < ms) await T.sleep(5); };
  T.waitCtx = (ctx, s) => { const end = ctx.currentTime + s; return T.until(() => ctx.currentTime >= end); };
  // the audio time of sample i of a capture, from its block's own time
  T.timeOf = (c, i) => { let lo = 0, hi = c.at.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c.at[m][0] <= i) lo = m; else hi = m - 1; } return c.at.length ? c.at[lo][1] + (i - c.at[lo][0]) / c.sr : c.t0 + i / c.sr; };
  T.spy = (engine, id) => {
    const inst = engine.instance(id, 'instrument'), ons = [], on0 = inst.noteOn;
    inst.noteOn = (p, v, t, x) => { ons.push({ p, t, at: engine.ctx.currentTime }); return on0.call(inst, p, v, t, x); };
    return ons;
  };
});

{
  // count-in from bar 1: the transport starts a bar early, below 0 only clicks (the click is off), the song after
  const r = await page.evaluate(async () => {
    const { proj, track, capture, onsets, spy } = T;
    const { engine } = mk(proj({ tempo: 120, tracks: [track('t_a', [{ p: 69, t: 2, d: 0.5 }])] }));
    await engine.start();
    const ctx = engine.ctx, ons = spy(engine, 't_a');
    const mon = await capture(ctx, engine._monitor), tap = await capture(ctx, engine.masterTap);
    const tr = [];
    engine.on('transport', (e) => tr.push({ why: e.why, at: ctx.currentTime, beat: engine.beat, counting: e.counting, ev: e }));
    await engine.play(0, { countIn: { beats: 4 } });
    const startC = engine.counting;
    await T.waitCtx(engine.ctx, 0.3);
    const early = { beat: engine.beat, grid: engine.gridBeat, counting: engine.counting };
    await T.until(() => engine.beat > 2.3);
    const late = { beat: engine.beat, counting: engine.counting };
    engine.stop();
    const cm = await mon.stop(), ct = await tap.stop();
    const lat = (ctx.outputLatency || ctx.baseLatency || 0) + engine.latency.total;
    // stop in the middle of a count: the playhead goes back to where the count was going
    await engine.play(8, { countIn: { beats: 4 } });
    await T.waitCtx(engine.ctx, 0.4);
    const midBeat = engine.beat;
    engine.stop();
    const cursor = engine.beat;
    await engine.dispose();
    const end = tr.find((x) => x.why === 'countin-end');
    const clicks = onsets(cm).filter((o) => o.t < startC.time - 0.01);
    const tapBefore = (() => { let pk = 0; for (let i = 0; i < ct.L.length; i++) { const t = ct.t0 + i / ct.sr; if (t >= startC.time - lat - 0.002) break; pk = Math.max(pk, Math.abs(ct.L[i])); } return pk; })();
    const monAfter = (() => { let pk = 0; for (let i = 0; i < cm.L.length; i++) { const t = cm.t0 + i / cm.sr; if (t >= startC.time - lat - 0.005 && t < startC.time - lat + 0.95) pk = Math.max(pk, Math.abs(cm.L[i]), Math.abs(cm.R[i])); } return pk; })();
    return { startC, early, late, end: end && { at: end.at, beat: end.beat, counting: end.counting, until: end.ev.until }, nEnd: tr.filter((x) => x.why === 'countin-end').length,
      clicks, tapBefore, monAfter, note: ons.find((o) => o.p === 69 && o.at < startC.time + 2), lat, midBeat, cursor };
  });
  const c = r.startC;
  T.ok(c && c.from === -4 && c.until === 0 && c.beats === 4 && c.preroll === true, `play(0, { countIn: { beats: 4 } }): engine.counting ${JSON.stringify(c && { from: c.from, until: c.until, beats: c.beats, preroll: c.preroll })}`);
  T.ok(r.early.beat < -2.5 && r.early.beat > -4.01 && r.early.counting && Math.abs(r.early.grid - r.early.beat) < 0.05, `engine.beat runs negative in the count (${r.early.beat.toFixed(3)} at 300 ms; gridBeat ${r.early.grid.toFixed(3)})`);
  const gaps = r.clicks.slice(1).map((o, i) => o.t - r.clicks[i].t);
  T.ok(r.clicks.length === 4 && gaps.every((g) => Math.abs(g - 0.5) < 0.0005), `the count is 4 clicks 0.5 s apart with the metronome off (${r.clicks.length}: ${gaps.map((g) => g.toFixed(4)).join(' ')})`);
  T.ok(r.clicks.length === 4 && r.clicks[0].pk > 0.65 && r.clicks.slice(1).every((o) => o.pk < 0.55 && o.pk > 0.45), `accent on the bar: ${r.clicks.map((o) => o.pk.toFixed(3)).join(' ')}`);
  T.ok(r.tapBefore === 0 && r.monAfter === 0, `below beat 0 only clicks (the mix is silent: ${r.tapBefore}); after the count the click stays off (${r.monAfter})`);
  T.ok(r.end && r.nEnd === 1 && Math.abs(r.end.at - r.early.counting.time) < 0.06 && Math.abs(r.end.beat) < 0.1 && r.end.until === 0 && r.end.counting === null, `'countin-end' once, at the audible downbeat (${r.end && ((r.end.at - r.early.counting.time) * 1000).toFixed(1)} ms from counting.time, engine.beat ${r.end && r.end.beat.toFixed(3)})`);
  T.ok(r.late.counting === null && r.late.beat > 1.8, `after the count engine.counting is null and the song runs (beat ${r.late.beat.toFixed(3)})`);
  const noteAfter = r.note && r.clicks.length ? r.note.t - r.clicks[0].t : null;   // (the first click is beat -4)
  T.ok(noteAfter != null && Math.abs(noteAfter - 3) < 2e-4, `the note at beat 2 lands 3.000 s after the count's first click (${noteAfter != null ? noteAfter.toFixed(5) : 'none'} s)`);
  T.ok(r.midBeat > 4 && r.midBeat < 8 && r.cursor === 8, `stopped in the count (at beat ${r.midBeat.toFixed(2)}), the playhead goes back to where it was going (${r.cursor})`);
}

{
  // pre-roll: from bar 3 the song plays the bar before; preroll: false is clicks alone, then the song chased at `from`;
  // a count inside a loop never counts again at the wrap; one that runs past the loop's end reaches `from`
  const r = await page.evaluate(async () => {
    const { proj, track, capture, onsets, spy } = T;
    const notes = [{ p: 60, t: 4, d: 8 }, { p: 64, t: 6, d: 0.5 }, { p: 67, t: 9, d: 0.5 }];
    const tr = track('t_a', notes); tr.clips[0].length = 16;
    const run = async (preroll) => {
      const { engine } = mk(proj({ tempo: 120, tracks: [tr] }));
      await engine.start();
      const ons = spy(engine, 't_a'), ctx = engine.ctx;
      await engine.play(8, { countIn: { beats: 4, preroll } });
      await T.waitCtx(engine.ctx, 0.25);
      // the latency counting.time allowed for, read in the same breath: the output latency can move while it plays, and
      // a reading at the end measured that instead of the pre-roll (-2.003 s on a CI runner)
      const c = engine.counting, beat = engine.beat, lat = (ctx.outputLatency || ctx.baseLatency || 0) + engine.latency.total;
      await T.until(() => engine.beat > 9.6);
      engine.stop();
      await engine.dispose();
      const t60 = (ons.find((o) => o.p === 60) || {}).t;
      return { c, beat, down: t60 + lat - c.time, ons: ons.map((o) => ({ p: o.p, rel: +(o.t - t60).toFixed(5) })) };
    };
    const loopRun = async (from, ms) => {
      const { engine } = mk(proj({ tempo: 120, loop: { on: true, start: 8, end: 12 } }));
      await engine.start();
      const mon = await capture(engine.ctx, engine._monitor);
      const loops = [];
      // (wall: the wrap's own audio time, on the tempo map; pass.time adds the output latency as read at that wrap,
      // which a runner's device moved by 1 ms between two wraps)
      engine.on('transport', (e) => { if (e.why === 'loop') loops.push({ ...e.pass, at: engine.ctx.currentTime, wrap: engine.clock.barTime(e.pass.grid / 4) }); });
      await engine.play(from, { countIn: { beats: 4 } });
      const c = engine.counting;
      await T.waitCtx(engine.ctx, ms / 1000);
      const beat = engine.beat;
      engine.stop();
      const cm = await mon.stop();
      await engine.dispose();
      return { c, beat, loops, clicks: onsets(cm).length };
    };
    return { pre: await run(true), quiet: await run(false), inLoop: await loopRun(10, 5600), pastLoop: await loopRun(13, 2600) };
  });
  const near = (x, y) => Math.abs(x - y) < 2 / 48000;
  const on = (k, p) => r[k].ons.filter((o) => o.p === p).map((o) => o.rel);
  T.ok(r.pre.c.from === 4 && r.pre.beat > 4 && r.pre.beat < 5, `pre-roll from beat 8: the transport starts at beat 4 (engine.beat ${r.pre.beat.toFixed(3)} at 250 ms)`);
  T.ok(on('pre', 60).length === 1 && near(on('pre', 64)[0], 1) && near(on('pre', 67)[0], 2.5) && Math.abs(r.pre.down + 2) < 0.002, `the bar before plays: beat 4's note ${r.pre.down.toFixed(3)} s from the downbeat, then beat 6's and beat 9's ${on('pre', 64).join('/')} and ${on('pre', 67).join('/')} s after it`);
  T.ok(r.quiet.c.preroll === false && on('quiet', 64).length === 0 && on('quiet', 60).length === 1 && near(on('quiet', 67)[0], 0.5) && Math.abs(r.quiet.down) < 0.002, `preroll: false: clicks alone, then the held note chased on the downbeat (${(r.quiet.down * 1000).toFixed(1)} ms), beat 9's ${on('quiet', 67).join('/')} s after it, nothing from the count's bar (${on('quiet', 64).length})`);
  T.ok(r.inLoop.clicks === 4 && r.inLoop.loops.length >= 2, `count from beat 10 in a loop 8..12: 4 clicks in 5.6 s, none at the wraps back below 10 (${r.inLoop.clicks} clicks, ${r.inLoop.loops.length} wraps)`);
  const L = r.inLoop.loops;
  T.ok(L.length >= 2 && L[0].n === 2 && L[1].n === 3 && L[0].start === 8 && L[0].end === 12 && L[0].grid === 12 && L[1].grid === 16 && Math.abs(L[1].wrap - L[0].wrap - 2) < 1e-6 && Math.abs(L[0].at - L[0].time) < 0.06,
    `the loop event carries the pass: ${JSON.stringify(L.map((x) => ({ n: x.n, start: x.start, end: x.end, grid: x.grid })))}, the wraps ${L.length > 1 ? (L[1].wrap - L[0].wrap).toFixed(6) : '?'} s apart (heard ${L.length > 1 ? (L[1].time - L[0].time).toFixed(4) : '?'} s apart), fired ${L.length ? ((L[0].at - L[0].time) * 1000).toFixed(0) : '?'} ms from when it is heard`);
  T.ok(r.pastLoop.loops.length === 0 && r.pastLoop.beat > 13.5 && r.pastLoop.beat < 15, `a count from beat 13 runs past the loop's end (12) and reaches it (beat ${r.pastLoop.beat.toFixed(3)}, ${r.pastLoop.loops.length} wraps)`);
}

{
  // the loop event waits for the audio clock, not the wall's: with the audio thread held up after the wrap is scheduled
  // (a busy machine's; here a suspended context) it fired when the wall clock got there, before the wrap was heard
  // (-71 ms here, -97 ms on a CI runner)
  const r = await page.evaluate(async () => {
    const { engine } = mk(T.proj({ tempo: 120, loop: { on: true, start: 8, end: 12 } }));
    await engine.start();
    const loops = [];
    engine.on('transport', (e) => { if (e.why === 'loop') loops.push({ time: e.pass.time, at: engine.ctx.currentTime }); });
    await engine.play(8);
    await T.until(() => engine.beat > 11.85);   // (the wrap at 12 is inside the lookahead, and not heard yet)
    const early = loops.length;
    await engine.ctx.suspend(); await T.sleep(300); await engine.ctx.resume();
    await T.until(() => loops.length > early);
    engine.stop();
    await engine.dispose();
    return { early, loop: loops[early] };
  });
  T.ok(r.early === 0 && r.loop && Math.abs(r.loop.at - r.loop.time) < 0.06, `with the audio clock held up 300 ms, the loop event still fires when the wrap is heard (${r.loop ? ((r.loop.at - r.loop.time) * 1000).toFixed(0) : '?'} ms from it)`);
}

{
  // the click's options: whileRecording, level; engine.metronome is click.on
  const r = await page.evaluate(async () => {
    const { proj, capture, onsets } = T;
    const { engine } = mk(proj({ tempo: 120 }));
    await engine.start();
    const ctx = engine.ctx, ev = [];
    engine.on('transport', (e) => ev.push({ why: e.why, recording: e.recording, click: e.click }));
    engine.click = { on: true, whileRecording: true };
    const alias = engine.metronome;
    let mon = await capture(ctx, engine._monitor);
    await engine.play(0);
    await T.waitCtx(ctx, 1.1);
    const off = onsets(await mon.stop()).length;
    mon = await capture(ctx, engine._monitor);
    engine.recording = true;
    await T.waitCtx(ctx, 1.1);
    const rec = onsets(await mon.stop());
    engine.click = { level: -12 };
    await T.waitCtx(ctx, 0.1);
    mon = await capture(ctx, engine._monitor);
    await T.waitCtx(ctx, 2.1);
    const quiet = onsets(await mon.stop(), 0.005);
    engine.stop();
    const after = engine.recording;
    engine.metronome = false;
    const click = engine.click;
    await engine.dispose();
    return { alias, off, rec: rec.map((o) => o.pk), quiet: quiet.map((o) => o.pk), after, click, stopEv: ev.find((e) => e.why === 'stop'), recEv: ev.filter((e) => e.why === 'recording').length, metEv: ev.filter((e) => e.why === 'metronome').length };
  });
  T.ok(r.alias === true && r.click.on === false && r.click.whileRecording === true && r.click.level === -12, `engine.metronome reads and sets click.on (${JSON.stringify(r.click)})`);
  T.ok(r.off === 0 && r.rec.length >= 2, `click "only while recording": ${r.off} clicks while playing, ${r.rec.length} once engine.recording is set`);
  const hi = Math.max(...r.quiet), db = 20 * Math.log10(hi / CLICK.bar);
  T.ok(Math.abs(db + 12) < 0.25, `click level -12 dB: the accent peaks at ${hi.toFixed(4)} (${db.toFixed(2)} dB from ${CLICK.bar})`);
  T.ok(r.stopEv && r.stopEv.recording === true && r.after === false && r.recEv === 1 && r.metEv >= 3, `stop() ends the take: its 'stop' event says recording (${r.stopEv && r.stopEv.recording}), then engine.recording is ${r.after}; 'recording' and 'metronome' events fire`);
}

{
  // beatAt: an input event's timeStamp onto the audible beat; it agrees with engine.beat, and corrects for main-thread lag
  const r = await page.evaluate(async () => {
    const { proj, sleep } = T;
    const { engine } = mk(proj({ tempo: 120, loop: { on: true, start: 0, end: 4 } }));
    await engine.start();
    const stopped = engine.beatAt(performance.now());
    await engine.play(0, { countIn: { beats: 4 } });
    await T.waitCtx(engine.ctx, 0.2);
    const inCount = [engine.beatAt(performance.now()), engine.beat];
    await T.until(() => engine.beat > 0.3);
    const d = [];
    for (let i = 0; i < 60; i++) { const b = engine.beat, a = engine.beatAt(performance.now()); if (a > b - 1 && a < b + 1) d.push((a - b) * 500); await sleep(7); }
    // main-thread lag: the event happened at p, the handler runs 80 ms later
    while (engine.beat < 1 || engine.beat > 2.5) await sleep(5);
    const p = performance.now(), b0 = engine.beat;
    const until = performance.now() + 80; while (performance.now() < until) { /* busy */ }
    const lag = { at: engine.beatAt(p), b0, b1: engine.beat };
    // across a wrap: an event just before it, read after it
    while (engine.beat < 3.75 || engine.beat > 3.9) await sleep(2);
    const p2 = performance.now(), w0 = engine.beat;
    await T.until(() => engine.beat < 1);
    const wrap = { at: engine.beatAt(p2), w0, w1: engine.beat };
    engine.stop();
    await engine.dispose();
    return { stopped, inCount, d, lag, wrap };
  });
  const mean = r.d.reduce((a, x) => a + x, 0) / r.d.length, worst = Math.max(...r.d.map(Math.abs));
  T.ok(r.stopped === 0 && r.inCount[0] < -3 && Math.abs(r.inCount[0] - r.inCount[1]) < 0.06, `beatAt when stopped is the cursor (${r.stopped}); in the count it runs negative with engine.beat (${r.inCount.map((x) => x.toFixed(3)).join(' / ')})`);
  T.ok(r.d.length >= 50 && Math.abs(mean) < 15 && worst < 40, `beatAt(now) agrees with engine.beat: ${mean.toFixed(1)} ms on average, ${worst.toFixed(1)} ms at worst over ${r.d.length} reads`);
  T.ok(Math.abs(r.lag.at - r.lag.b0) < 0.04 && r.lag.b1 - r.lag.b0 > 0.05, `an event read 80 ms late lands where it happened (beatAt ${r.lag.at.toFixed(3)}, engine.beat then ${r.lag.b0.toFixed(3)}, now ${r.lag.b1.toFixed(3)})`);
  T.ok(Math.abs(r.wrap.at - r.wrap.w0) < 0.04 && r.wrap.w1 < 1, `an event before a loop wrap, read after it, keeps its beat (${r.wrap.at.toFixed(3)} vs ${r.wrap.w0.toFixed(3)}; now ${r.wrap.w1.toFixed(3)})`);
}

{
  // recording past the song's end: the transport runs on, the click with it, and a clip added out there plays
  const r = await page.evaluate(async () => {
    const { proj, track, capture, onsets, spy } = T;
    const { engine, store } = mk(proj({ tempo: 240, tracks: [track('t_a', [{ p: 60, t: 0, d: 0.5 }])] }));
    store.dispatch({ type: 'clip.set', track: 't_a', clip: 'c_t_a', patch: { length: 4 } });
    const end = engine.songEnd();
    await engine.start();
    const ons = spy(engine, 't_a');
    engine.click = { on: true, whileRecording: true };
    engine.recording = true;
    await engine.play(0);
    const mon = await capture(engine.ctx, engine._monitor);
    await T.until(() => engine.beat > 7);
    const b1 = engine.beat;
    const at = Math.ceil(b1) + 2;
    store.dispatch({ type: 'clip.add', track: 't_a', clip: { id: 'c_late1', kind: 'notes', start: at, length: 4, notes: [{ p: 72, t: 0, d: 0.5 }] } });
    await T.until(() => engine.beat > at + 1.5);
    const b2 = engine.beat, playing = engine.playing;
    const clicks = onsets(await mon.stop(), 0.02, 0.05).length;
    engine.stop();
    engine.click = { on: false, whileRecording: false };
    await engine.dispose();
    return { end, b1, b2, at, playing, late: ons.filter((o) => o.p === 72).length, clicks };
  });
  T.ok(r.playing && r.b2 > r.end + 4, `recording runs past the song's end (beat ${r.b2.toFixed(2)}, the song ends at ${r.end})`);
  T.ok(r.late === 1, `a clip added out there (beat ${r.at}) while recording plays (${r.late} note)`);
  T.ok(r.clicks >= Math.floor(r.b2) - 1 && r.clicks <= Math.ceil(r.b2) + 1, `the click keeps time past the end (${r.clicks} clicks over beats 0 to ${r.b2.toFixed(2)})`);
}

{
  // mute while playing (RECORDING-UX 3.12): inside the lookahead, like a delete; audio fades over 10 ms and comes back
  // mid-way when unmuted
  const r = await page.evaluate(async () => {
    const { proj, track, capture, capPeak, sleep, spy } = T;
    const out = {};
    {
      const { engine, store } = mk(proj({ tempo: 120, tracks: [track('t_a', [{ p: 60, t: 0, d: 8, v: 0.9 }, { p: 72, t: 2, d: 4, v: 0.9 }])] }));
      await engine.start();
      const ctx = engine.ctx, ons = spy(engine, 't_a'), cap = await capture(ctx, engine.masterTap);
      await engine.play(0);
      while (!ons.some((o) => o.p === 72)) await sleep(1);
      const h = ons.find((o) => o.p === 72), lead = h.t - ctx.currentTime, tm = ctx.currentTime;
      store.dispatch({ type: 'clip.set', track: 't_a', clip: 'c_t_a', patch: { mute: true } });
      await T.waitCtx(ctx, 1.5);
      engine.stop();
      const c = await cap.stop();
      await engine.dispose();
      out.notes = { lead, sounding: capPeak(c, tm - 0.2, tm - 0.05), after: capPeak(c, tm + 1.0, tm + 1.4) };
    }
    {
      const sr = 48000, n = sr * 4, x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
      const { engine, store } = mk(proj({ tempo: 120, tracks: [{ id: 't_s', name: 's', kind: 'audio', instrument: null, inserts: [], gain: 0, pan: 0, mute: false, solo: false, clips: [{ id: 'c_s', kind: 'audio', start: 0, length: 8, asset: 'a_sine1k4', offset: 0, gain: 0 }] }] }));
      await engine.assets.put('a_sine1k4', { sr, channels: [x, x] });
      await engine.start();
      const ctx = engine.ctx, cap = await capture(ctx, engine.masterTap);
      await engine.play(0);
      await T.waitCtx(ctx, 0.7);
      const tm = ctx.currentTime;
      store.dispatch({ type: 'clip.set', track: 't_s', clip: 'c_s', patch: { mute: true } });
      await T.waitCtx(ctx, 0.4);
      const tu = ctx.currentTime;
      store.dispatch({ type: 'clip.set', track: 't_s', clip: 'c_s', patch: { mute: false } });
      await T.waitCtx(ctx, 0.4);
      engine.stop();
      const c = await cap.stop();
      await engine.dispose();
      // the fade: where the 1 kHz cycle's peak first drops under 0.45 after the mute
      const i0 = T.capIndex(c, tm), per = 48;
      let fs = -1;
      for (let i = i0; i + per < c.L.length; i += per) { let pk = 0; for (let j = i; j < i + per; j++) pk = Math.max(pk, Math.abs(c.L[j])); if (pk < 0.45) { fs = i; break; } }
      const ts = T.timeOf(c, fs);
      let d2 = 0; for (let i = Math.max(1, fs - 480); i < Math.min(c.L.length - 1, fs + 2400); i++) d2 = Math.max(d2, Math.abs(c.L[i - 1] - 2 * c.L[i] + c.L[i + 1]));
      out.audio = { found: fs >= 0, react: ts - tm, at10: capPeak(c, ts + 0.009, ts + 0.012), at20: capPeak(c, ts + 0.019, ts + 0.022), gone: capPeak(c, ts + 0.04, tu), d2, back: capPeak(c, tu + 0.08, tu + 0.3) };
    }
    return out;
  });
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180).toFixed(1);
  T.ok(r.notes.sounding > 0.02 && r.notes.lead > 0.03 && r.notes.after === 0, `a notes clip muted while it plays: its held note is released and the note handed over ${(r.notes.lead * 1000).toFixed(0)} ms ahead never sounds (peak ${r.notes.after} 1.0-1.4 s after the mute; ${r.notes.sounding.toFixed(3)} before)`);
  const a = r.audio;
  T.ok(a.found && a.react > 0 && a.react < 0.06, `an audio clip muted while it plays starts fading ${(a.react * 1000).toFixed(1)} ms after the edit`);
  T.ok(a.at10 < 0.5 * Math.pow(10, -28 / 20) && a.at20 < 0.5 * Math.pow(10, -60 / 20) && a.gone === 0, `…over 10 ms: ${db(a.at10 / 0.5)} dB at 10 ms, ${db(a.at20 / 0.5)} dB at 20 ms, then nothing (${a.gone})`);
  T.ok(a.d2 < 0.02, `…without a click (largest second difference ${a.d2.toExponential(2)}; the 1 kHz sine alone is ~8.6e-3)`);
  T.ok(a.back > 0.45, `unmuted, it picks up mid-way at once (peak ${a.back.toFixed(3)} from 80 ms after)`);
}

// ---------------------------------------------------------------------------------------------- automation (wave A2)
// docs/research/AUTOMATION.md 3.5 / 3.14: the probe kernel (tools/probe-kernel.js) outputs its params as DC, so a lane
// can be read sample by sample: offline in the browser and in Node (equal), and live (shape, loop wrap, edits while
// playing, stop at the cursor). The store here is a bare stand-in, so lanes reach the engine whatever the core keeps.
{
  const { PROBE } = await import('./probe-kernel.js');
  const lanes = {
    v: { points: [{ t: 0.5, v: 0.1 }, { t: 2, v: 0.6, c: 0.5 }, { t: 3, v: 0.6 }, { t: 3, v: 0.2 }, { t: 3.5, v: 0.35, c: 'step' }, { t: 3.75, v: 0.15 }] },
    f: { points: [{ t: 0, v: 100 }, { t: 4, v: 10000 }] },
  };
  const song = (o = {}) => ({ format: 'overdub/0', id: 'p_auto01', title: 'A', tempo: 120, meter: [4, 4], key: null, loop: { on: false, start: 0, end: 4 }, sections: [], devices: {}, assets: {}, meta: {},
    master: { gain: 0, inserts: [] },
    tracks: [
      { id: 't_probe', name: 'probe', kind: 'audio', instrument: null, inserts: [{ id: 'fx_probe', device: 'test.probe', on: true, params: { v: 0.5, f: 1000 }, auto: lanes }], clips: [], gain: 0, pan: 0, mute: false, solo: false },
      { id: 't_pad', name: 'pad', kind: 'instrument', instrument: { device: 'core.pad', params: {} }, inserts: [], gain: -6, pan: 0, mute: false, solo: false,
        clips: [{ id: 'c_pad', kind: 'notes', start: 0, length: 8, notes: [{ id: 'n1', p: 57, t: 0, d: 8, v: 0.8 }, { id: 'n2', p: 64, t: 0, d: 8, v: 0.7 }] }],
        auto: { gain: { points: [{ t: 0, v: -40 }, { t: 3, v: -3, c: -0.4 }, { t: 6, v: -12 }] }, pan: { points: [{ t: 1, v: -1 }, { t: 5, v: 0.8 }] } } },
    ], ...o });
  const { defineDevice } = await import('../app/src/devices/registry.js');
  defineDevice(PROBE, { replace: true });
  const { laneValue } = await import('../app/src/engine/schedule.js');
  const r = await page.evaluate(async ({ PROBE, p }) => {
    T.R.defineDevice(PROBE, { replace: true });
    await import('/app/src/devices/builtin/index.js');
    // a store that keeps the song exactly as given (and can be edited under the engine)
    window.bareStore = (doc) => { const fns = new Set(); return { get: () => doc, on: (t, fn) => { if (t === 'change') fns.add(fn); return () => fns.delete(fn); }, set(d, ops) { doc = d; for (const fn of fns) fn({ ops }); } }; };
    const eng = (d) => T.E.createEngine(bareStore(d));
    const out = {};
    for (const [name, opts] of [['whole', { from: 0, to: 8, tail: 0.2 }], ['mid', { from: 2.5, to: 8, tail: 0.2 }], ['probe', { from: 0, to: 4, tail: 0, tracks: ['t_probe'] }]]) {
      const b = await eng(p).render(opts);
      out[name] = [Array.from(b.getChannelData(0)), Array.from(b.getChannelData(1))];
    }
    return out;
  }, { PROBE, p: song() });
  const { renderSong } = await import('../app/src/engine/node/render.js');
  const diff = (a, n) => { let d = 0; for (let c = 0; c < 2; c++) { const x = a[c], y = n.channels[c]; const m = Math.min(x.length, y.length); for (let i = 0; i < m; i++) d = Math.max(d, Math.abs(x[i] - y[i])); } return d; };
  const dbs = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const nWhole = renderSong(song(), { from: 0, to: 8, tail: 0.2 }), nMid = renderSong(song(), { from: 2.5, to: 8, tail: 0.2 }), nProbe = renderSong(song(), { from: 0, to: 4, tail: 0, tracks: ['t_probe'] });
  T.ok(diff(r.probe, nProbe) === 0, `a kernel's lanes render bit for bit the same in the browser and in Node (probe: max difference ${diff(r.probe, nProbe)})`);
  T.ok(dbs(diff(r.whole, nWhole)) < -90 && dbs(diff(r.mid, nMid)) < -90, `with a gain fade and a pan sweep, the browser and Node agree within -90 dBFS (from 0: ${dbs(diff(r.whole, nWhole)).toFixed(1)} dB, from beat 2.5: ${dbs(diff(r.mid, nMid)).toFixed(1)} dB)`);
  // the probe follows its lane per block, through the 10 ms smoothing, in both channels' units
  const SR = 48000, spb = 0.5, a = 1 - Math.exp(-128 / (0.01 * SR));
  let pv = laneValue(lanes.v, 0, PROBE.params[0]), pf = laneValue(lanes.f, 0, PROBE.params[1]), worst = 0, worstF = 0;
  for (let F = 0; F < nProbe.length; F += 128) {
    const beat = F / SR / spb, tv = laneValue(lanes.v, beat, PROBE.params[0]), tf = laneValue(lanes.f, beat, PROBE.params[1]);
    pv = pv + a * (tv - pv); pf = pf * Math.pow(tf / pf, a);
    worst = Math.max(worst, Math.abs(nProbe.channels[0][F] - pv)); worstF = Math.max(worstF, Math.abs(nProbe.channels[1][F] - pf / 20000));
  }
  T.ok(worst < 1e-5 && worstF < 1e-5, `the probe reads its lanes per 128-frame block through the smoothing: a bent ramp, a jump and a step (worst ${worst.toExponential(1)}), a log sweep (worst ${worstF.toExponential(1)})`);
  // from mid-song: every device starts at its lanes' value there
  const v0 = nMid.channels[0][0], want0 = laneValue(lanes.v, 2.5, PROBE.params[0]);
  T.ok(Math.abs(v0 - want0) < 1e-6, `a render from beat 2.5 starts at the lane's value there (${v0.toFixed(4)}, want ${want0.toFixed(4)})`);
  // the gain fade: per-beat level rises over beats 0-3 then falls
  const lvl = (chs, b) => { let s = 0; const i0 = Math.round(b * spb * SR), i1 = Math.round((b + 1) * spb * SR); for (const ch of chs) for (let i = i0; i < i1; i++) s += ch[i] * ch[i]; return 10 * Math.log10(s / (i1 - i0) + 1e-20); };
  const padOnly = renderSong(song(), { from: 0, to: 8, tail: 0, tracks: ['t_pad'] });
  const rise = [0, 1, 2].map((b) => lvl(padOnly.channels, b));
  T.ok(rise[0] < rise[1] && rise[1] < rise[2], `a gain lane fades the pad in: beats 1-3 at ${rise.map((x) => x.toFixed(1)).join(', ')} dB`);
}

{
  // live: the same lanes through the studio's transport (loop 0-4), captured off the master
  const { PROBE } = await import('./probe-kernel.js');
  const r = await page.evaluate(async ({ PROBE }) => {
    const { capture } = T;
    T.R.defineDevice(PROBE, { replace: true });
    const S = await import('/app/src/engine/schedule.js');
    const lane = { points: [{ t: 0, v: 0.1 }, { t: 2, v: 0.6 }, { t: 3, v: 0.6 }, { t: 3, v: 0.2 }, { t: 4, v: 0.2 }] };
    const mkp = (L) => ({ format: 'overdub/0', id: 'p_auto02', title: 'A', tempo: 120, meter: [4, 4], key: null, loop: { on: true, start: 0, end: 4 }, sections: [], devices: {}, assets: {}, meta: {}, master: { gain: 0, inserts: [] },
      tracks: [{ id: 't_probe', name: 'probe', kind: 'audio', instrument: null, inserts: [{ id: 'fx_probe', device: 'test.probe', on: true, params: { v: 0.5, f: 1000 }, auto: { v: L } }], clips: [], gain: 0, pan: 0, mute: false, solo: false }] });
    const store = bareStore(mkp(lane));
    const engine = T.E.createEngine(store);
    await engine.start();
    await engine.settled();
    const ctx = engine.ctx;
    const out = {};
    // stopped at the cursor (beat 1): the lane's value there, not the static 0.5
    engine.seek(1);
    await T.waitCtx(ctx, 0.15);
    let cap = await capture(ctx, engine.masterTap);
    await T.waitCtx(ctx, 0.05);
    let c = await cap.stop();
    out.stopped = c.L[c.L.length - 1];
    out.want1 = S.laneValue(lane, 1, PROBE.params[0]);
    cap = await capture(ctx, engine.masterTap);
    await engine.play(0);
    await T.waitCtx(ctx, 4.6); // through the wrap at 2 s and into the second pass
    // an edit while playing: the hold at beats 2-3 goes from 0.6 to 0.3 (and the ramp ends there)
    const lane2 = { points: [{ t: 0, v: 0.1 }, { t: 2, v: 0.3 }, { t: 3, v: 0.3 }, { t: 3, v: 0.2 }, { t: 4, v: 0.2 }] };
    const tEdit = ctx.currentTime;
    store.set(mkp(lane2), [{ type: 'auto.write' }]);
    await T.waitCtx(ctx, 1.6);
    engine.stop();
    engine.seek(3.5);
    await T.waitCtx(ctx, 0.2);
    c = await cap.stop();
    out.after = c.L[c.L.length - 1];
    out.want35 = S.laneValue(lane2, 3.5, PROBE.params[0]);
    // the shape: where the ramp crosses 0.35 (beat 1) and where the jump at beat 3 drops it under 0.4, each pass
    const cross = [], drops = [];
    for (let i = 1; i < c.L.length; i++) {
      const t = T.timeOf(c, i);
      if (c.L[i - 1] < 0.35 && c.L[i] >= 0.35) cross.push(t);
      if (c.L[i - 1] >= 0.4 && c.L[i] < 0.4) drops.push(t);
    }
    // after the edit: the hold reads 0.3 (the second pass's beats 2-3 after tEdit + a tick)
    let held = null;
    if (cross.length >= 2) { const t = cross[cross.length - 1] + 1.5 * 0.5 + 0.03; const i = Math.round((t - c.t0) * c.sr); held = c.L[i]; }
    Object.assign(out, { cross, drops, held, tEdit, errs: T.errs.length });
    await engine.dispose();
    return out;
  }, { PROBE });
  T.ok(Math.abs(r.stopped - r.want1) < 1e-3, `stopped, an automated param sits at its lane's value at the cursor (${r.stopped.toFixed(4)}, want ${r.want1.toFixed(4)} at beat 1)`);
  const span = r.drops.length && r.cross.length ? r.drops[0] - r.cross[0] : NaN, pass = r.cross.length >= 2 ? r.cross[1] - r.cross[0] : NaN;
  T.ok(Math.abs(span - 1.0) < 0.006, `live, the lane plays on its beats: the ramp's midpoint (beat 1) to the jump (beat 3) is ${(span * 1000).toFixed(1)} ms (want 1000 +- 6)`);
  T.ok(Math.abs(pass - 2.0) < 0.006, `…and again after the loop wraps: one pass later by ${(pass * 1000).toFixed(1)} ms (want 2000 +- 6)`);
  T.ok(r.held != null && Math.abs(r.held - 0.3) < 0.01, `a lane edited while playing is heard on the next pass (the hold reads ${r.held == null ? '?' : r.held.toFixed(4)}, want 0.3)`);
  T.ok(Math.abs(r.after - r.want35) < 2e-3, `stopped and moved to beat 3.5, the param follows the cursor (${r.after.toFixed(4)}, want ${r.want35.toFixed(4)})`);
}


{
  // a graph pedal's lane: set(values, { at }) every 20 ms in the browser render (the Node renderer bypasses pedals)
  const r = await page.evaluate(async () => {
    await import('/app/src/devices/guitar/index.js');
    const d = T.R.getDevice('pedal.drive'), prm = d && d.params.find((p) => p.key === 'level');
    if (!prm) return { skip: 'no pedal.drive level' };
    const sr = 48000, n = sr * 4, sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / sr);
    const doc = { format: 'overdub/0', id: 'p_auto03', title: 'g', tempo: 120, meter: [4, 4], key: null, loop: { on: false, start: 0, end: 8 }, sections: [], devices: {}, assets: { a_sine04: { kind: 'audio', sr, channels: 1, duration: 4 } }, meta: {}, master: { gain: 0, inserts: [] },
      tracks: [{ id: 't_g', name: 'g', kind: 'audio', instrument: null, gain: 0, pan: 0, mute: false, solo: false, clips: [{ id: 'c_s', kind: 'audio', start: 0, length: 8, asset: 'a_sine04', offset: 0, gain: 0 }],
        inserts: [{ id: 'fx_g', device: 'pedal.drive', on: true, params: {}, auto: { level: { points: [{ t: 0, v: prm.min }, { t: 8, v: prm.max }] } } }] }] };
    const eng = T.E.createEngine(bareStore(doc));
    await eng.assets.put('a_sine04', { sr, channels: [sig] });
    const b = await eng.render({ from: 0, to: 8, tail: 0 });
    const rms = (a, z) => { const x = b.getChannelData(0); let q = 0; for (let i = a * sr; i < z * sr; i++) q += x[i] * x[i]; return 10 * Math.log10(q / ((z - a) * sr) + 1e-20); };
    return { early: rms(0.2, 0.7), late: rms(3.3, 3.8) };
  });
  if (r.skip) T.note(r.skip);
  else T.ok(r.late - r.early > 6, `a graph pedal follows its lane in a render (Drive's level swept up: ${r.early.toFixed(1)} dB at the start, ${r.late.toFixed(1)} dB at the end)`);
}

const pageErrors = errors.filter((e) => !/overdub engine:/.test(e));
T.ok(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.slice(0, 5).join(' | ') : ''}`);
await close();
T.done();
