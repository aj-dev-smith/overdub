// Tap it: rhythm in. Tap keys (F kick, J snare, K hat, L open hat while Tap is on), the on-screen pads, or beatbox
// into the mic; the hits become a quantised drum part (General MIDI notes, readable as an x..o grid).
//
// Pure core (Node and the browser):
//   ROWS                                   the pads: { id, key, label, p (GM note), hint }
//   onsets(samples, sr, opts)              -> [{ i, t, db }]          (energy flux, debounced: no double triggers)
//   features(samples, sr, i)               -> { centroid, zcr, low, high, db }   of the 60 ms after an onset
//   classify(f, trained?)                  -> 'kick' | 'snare' | 'hat'           (rules, or the nearest trained class)
//   beatbox(samples, sr, opts)             -> [{ t, row, v, f }]
//   toDrums(hits, { tempo, grid, origin, originBeat, meter }) -> { notes, grid, bars }   hits: [{ t (s), row, v }]
//
// Live (browser): createTap(app, input) -> tap = { hit(row, v), take, flush(), startBeatbox(), stopBeatbox(),
//   beatboxing, recording, train(row, f), on(type, fn) }   events: 'hit' { row, v, t, rec? }, 'take' (a phrase kept to
//   capture). While R records (input/recorder.js) a hit goes into the take (quantized on input, its raw time kept) and a
//   beatbox started then hands its hits to the take at its stop, each at its place on the transport's grid.

import { fft, rms, dbOf, median } from './pitch.js';
import { formatGrid, beatsPerBar } from '../core/music.js';

export const ROWS = [
  { id: 'kick', key: 'KeyF', label: 'Kick', p: 36, hint: 'F', say: '“b” / “boom”' },
  { id: 'snare', key: 'KeyJ', label: 'Snare', p: 38, hint: 'J', say: '“k” / “psh”' },
  { id: 'hat', key: 'KeyK', label: 'Hat', p: 42, hint: 'K', say: '“ts” / “t”' },
  { id: 'open', key: 'KeyL', label: 'Open hat', short: 'Open', p: 46, hint: 'L', say: '“tss”' },
];
export const ROW = Object.fromEntries(ROWS.map((r) => [r.id, r]));

// Onsets by energy flux in 5 ms frames: a frame well over the recent level and over the gate. A refractory time
// (70 ms) debounces double triggers, the main annoyance in beatbox tools.
export function onsets(x, sr, { frame = 0.005, gateDb = null, ratio = 4, refractory = 0.07 } = {}) {
  const W = Math.max(16, Math.round(frame * sr)), nF = Math.floor(x.length / W);
  const E = new Float64Array(nF);
  for (let f = 0; f < nF; f++) { let s = 0; for (let i = f * W, e = i + W; i < e; i++) s += x[i] * x[i]; E[f] = s / W; }
  const peak = Math.max(1e-12, ...E);
  const gate = Math.pow(10, (gateDb ?? Math.max(-55, dbOf(Math.sqrt(peak)) - 30)) / 10);
  const out = [];
  let last = -1e9;
  for (let f = 3; f < nF; f++) {
    if (E[f] < gate) continue;
    let pre = 0; for (let g = f - 3; g < f; g++) pre += E[g]; pre /= 3;
    if (E[f] > ratio * pre + 1e-12 && (f - last) * W / sr >= refractory) {
      // the peak of this hit (within 30 ms) gives its loudness
      let pk = 0; for (let g = f; g < Math.min(nF, f + Math.round(0.03 / frame)); g++) pk = Math.max(pk, E[g]);
      out.push({ i: f * W, t: (f * W) / sr, db: 10 * Math.log10(pk + 1e-12) });
      last = f;
    }
  }
  return out;
}

export function features(x, sr, i, { dur = 0.06 } = {}) {
  const n = 1024, len = Math.min(n, Math.round(dur * sr), x.length - i);
  const re = new Float64Array(n), im = new Float64Array(n);
  let zc = 0;
  for (let k = 0; k < len; k++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / Math.max(1, len - 1)); re[k] = x[i + k] * w; if (k && (x[i + k] >= 0) !== (x[i + k - 1] >= 0)) zc++; }
  fft(re, im);
  let tot = 0, wsum = 0, lo = 0, hi = 0;
  const bin = sr / n;
  for (let k = 1; k < n / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k], f = k * bin;
    tot += p; wsum += p * f;
    if (f < 300) lo += p;
    if (f > 6000) hi += p;
  }
  return { centroid: tot > 0 ? wsum / tot : 0, zcr: zc / Math.max(1, len), low: tot > 0 ? lo / tot : 0, high: tot > 0 ? hi / tot : 0, db: dbOf(rms(x, i, i + len)) };
}

const vec = (f) => [Math.log2(Math.max(50, f.centroid) / 1000), f.zcr * 8, f.low * 3, f.high * 3];
export function classify(f, trained = null) {
  if (trained) {
    const classes = Object.entries(trained).filter(([, ex]) => ex && ex.length);
    if (classes.length >= 2) {
      const v = vec(f);
      let best = null, bd = Infinity;
      for (const [row, ex] of classes) {
        const c = [0, 1, 2, 3].map((j) => ex.reduce((s, e) => s + vec(e)[j], 0) / ex.length);
        const d = c.reduce((s, cj, j) => s + (cj - v[j]) ** 2, 0);
        if (d < bd) { bd = d; best = row; }
      }
      return best;
    }
  }
  // a kick is nearly all low thump; a hat nearly all hiss over 6 kHz; a snare is the noisy middle (body + crack)
  if (f.centroid < 1000 || (f.low > 0.65 && f.centroid < 2000)) return 'kick';
  if (f.high > 0.5 || f.centroid > 7000 || f.zcr > 0.45) return 'hat';
  return 'snare';
}

export function beatbox(x, sr, { trained = null, ...o } = {}) {
  const on = onsets(x, sr, o);
  if (!on.length) return [];
  const loud = Math.max(...on.map((h) => h.db));
  return on.map((h) => { const f = features(x, sr, h.i); return { t: h.t, row: classify(f, trained), v: velOf(h.db, loud), f }; });
}
const velOf = (db, loud) => Math.round(Math.max(0.3, Math.min(1, 0.85 + (db - loud) / 30)) * 100) / 100;

// Hits (seconds) -> drum notes on the grid at the song's tempo. origin: the second that is beat originBeat (default: the
// first hit, on the downbeat). Two hits of one row on one step merge (the louder wins).
export function toDrums(hits, { tempo = 120, grid = 0.25, origin = null, originBeat = 0, meter = [4, 4], keepTiming = false } = {}) {
  if (!hits.length) return { notes: [], grid: null, bars: 1 };
  const spb = 60 / tempo, o = origin ?? hits[0].t;
  const seen = new Map();
  for (const h of hits) {
    const b = originBeat + (h.t - o) / spb;
    const t = keepTiming ? Math.round(b * 64) / 64 : Math.round(b / grid) * grid;
    if (t < 0) continue;
    const p = ROW[h.row] ? ROW[h.row].p : Number(h.p) || 36;
    const k = p + '@' + t;
    const v = Math.max(0.05, Math.min(1, h.v ?? 0.8));
    if (!seen.has(k) || seen.get(k).v < v) seen.set(k, { p, t: Math.round(t * 10000) / 10000, d: grid, v: Math.round(v * 100) / 100 });
  }
  const notes = [...seen.values()].sort((a, b) => a.t - b.t || a.p - b.p);
  const bpb = beatsPerBar(meter);
  const end = notes.length ? notes[notes.length - 1].t + grid : grid;
  const bars = Math.max(1, Math.ceil(end / bpb - 1e-9));
  return { notes, grid: formatGrid(notes, { steps: Math.round((bars * bpb) / grid), step: grid }), bars };
}

/* ---------------------------------------------------------------- live */
const TRAIN_KEY = 'overdub:beatbox-train';
export function createTap(app, input) {
  const fns = new Map();
  const emit = (t, d) => { for (const fn of fns.get(t) || []) { try { fn(d); } catch (e) { console.error('tap listener', e); } } };
  let trained = {};
  try { trained = JSON.parse(localStorage.getItem(TRAIN_KEY) || '{}') || {}; } catch (e) { trained = {}; }
  let cur = null, idle = 0, bb = null;
  const GAP = 2.5; // seconds of silence end a take

  // the drum track the pads play: an armed one, the selected one, the first (recorder.targetFor('pads'))
  const drumTrack = () => {
    if (input.recorder) return input.recorder.targetFor('pads');
    const p = app.store.get(), sel = app.ui?.state?.selection?.track;
    const isDrums = (t) => t && t.kind === 'instrument' && /drum|kit|beat/i.test((t.instrument?.device || '') + ' ' + t.name);
    return p.tracks.find((t) => t.arm && isDrums(t)) || p.tracks.find((t) => t.id === sel && isDrums(t)) || p.tracks.find(isDrums) || null;
  };
  const recording = () => !!(input.recorder && input.recorder.state !== 'idle');

  const tap = {
    rows: ROWS,
    get take() { return cur; },
    get beatboxing() { return !!bb; },
    get recording() { return !!(bb && bb.rec); },
    trained,
    drumTrack,
    on(t, fn) { if (!fns.has(t)) fns.set(t, new Set()); fns.get(t).add(fn); return () => fns.get(t).delete(fn); },
    // One hit from a key or a pad (it sounds on the drum track now, and joins the take)
    hit(row, v = 0.8) {
      const r = ROW[row];
      if (!r) return;
      const now = performance.now() / 1000, eng = app.engine;
      const dt = drumTrack();
      if (dt) { try { eng.liveNoteOn(dt.id, r.p, v); setTimeout(() => { try { eng.liveNoteOff(dt.id, r.p); } catch (e) { /* ok */ } }, 160); } catch (e) { /* silent engine */ } }
      // recording: into the take (it goes to capture pass by pass)
      if (recording()) { const n = input.recorder.hit(row, v); emit('hit', { row, v, t: now, rec: true, beat: n ? n.t : null }); return; }
      if (!cur) cur = { hits: [], t0: now, playing: !!eng.playing, track: dt ? dt.id : null };
      cur.hits.push({ t: now, row, v, beat: eng.playing ? eng.beat : null });
      emit('hit', { row, v, t: now });
      clearTimeout(idle);
      idle = setTimeout(() => tap.flush(), GAP * 1000);
    },
    // End the current take: into the capture log as a drum phrase
    flush() {
      clearTimeout(idle);
      const tk = cur;
      cur = null;
      if (!tk || !tk.hits.length) return null;
      const p = app.store.get();
      let res, beat = null;
      if (tk.playing && tk.hits.every((h) => h.beat != null)) {
        // played along: each hit at its song beat (keys and pads are near enough instant)
        const bpb = beatsPerBar(p.meter), first = Math.min(...tk.hits.map((h) => h.beat));
        beat = Math.max(0, Math.floor((first + 0.25) / bpb) * bpb);
        res = toDrums(tk.hits.map((h) => ({ ...h, t: h.beat })), { tempo: 60, origin: beat, meter: p.meter, grid: app.input?.options?.grid || 0.25 });
      } else res = toDrums(tk.hits, { tempo: p.tempo, meter: p.meter, grid: app.input?.options?.grid || 0.25 });
      const c = input.capture.add({ src: 'tap', kind: 'drums', notes: res.notes, tempo: p.tempo, beat, track: tk.track, grid: res.grid });
      emit('take', c);
      return c;
    },
    // Beatbox into the mic: listen until stopBeatbox(), then find the hits and classify them
    async startBeatbox() {
      if (bb) return;
      await input.audio.ensureOpen();
      const s = bb = { chunks: [], len: 0, sr: input.audio.ctx.sampleRate, f0: null, playing: !!app.engine.playing || recording(), snap: null, rec: recording() };
      s.off = input.audio.listen((blk) => {
        if (bb !== s) return;
        if (s.f0 == null) s.f0 = blk.f;
        s.chunks.push(blk.d[0]); s.len += blk.d[0].length;
        if (s.playing && app.engine.playing && !s.snap) { const b = app.engine.beat; if (s.b0 == null) s.b0 = b; else if (Math.abs(b - s.b0) > 0.02) s.snap = { ctxT: input.audio.ctx.currentTime, beat: s.rec ? input.recorder.gridNow(true) : b }; }
        // live: the newest hits as they come (a cheap look at the last half second)
        const tail = Math.min(s.len, Math.round(s.sr * 0.5));
        if (tail > s.sr * 0.1) {
          const x = new Float32Array(tail); let w = tail;
          for (let i = s.chunks.length - 1; i >= 0 && w > 0; i--) { const c = s.chunks[i], n = Math.min(w, c.length); x.set(c.subarray(c.length - n), w - n); w -= n; }
          const hs = onsets(x, s.sr, { gateDb: -45 });
          const h = hs[hs.length - 1];
          const abs = s.len - tail + (h ? h.i : 0);
          if (h && abs > (s.lastHit || 0) + s.sr * 0.07 && h.i > tail - blk.d[0].length - s.sr * 0.03) { s.lastHit = abs; const f = features(x, s.sr, h.i); emit('hit', { row: classify(f, trained), v: 0.8, live: true }); }
        }
      });
      input.emit('beatbox', { active: true });
    },
    async stopBeatbox() {
      const s = bb;
      if (!s) return null;
      bb = null;
      s.off && s.off();
      input.emit('beatbox', { active: false });
      const x = new Float32Array(s.len); let w = 0; for (const c of s.chunks) { x.set(c, w); w += c.length; }
      const hits = beatbox(x, s.sr, { trained });
      if (!hits.length) { app.ui?.toast?.('No hits heard. Get closer to the mic and punch the sounds.'); return null; }
      const p = app.store.get();
      let res, beat = null;
      if (s.rec && s.snap && input.recorder.state !== 'idle') {
        // into the take: each hit at its grid beat (the recorder quantizes and places it in its pass)
        const L = input.audio.latency.get(), out = input.audio.outLatency(), spb = 60 / p.tempo;
        const g0 = s.snap.beat + (s.f0 / s.sr - L + out - s.snap.ctxT) / spb;
        const k = input.recorder.addNotes(hits.map((h) => ({ row: h.row, v: h.v, g: g0 + h.t / spb })), { src: 'beatbox' });
        emit('take', null);
        return { rec: true, hits: k };
      }
      if (s.playing && s.snap) {
        const L = input.audio.latency.get(), out = input.audio.outLatency(), spb = 60 / p.tempo;
        const b0 = s.snap.beat + (s.f0 / s.sr - L + out - s.snap.ctxT) / spb;
        const bpb = beatsPerBar(p.meter), first = b0 + hits[0].t / spb;
        beat = Math.max(0, Math.floor((first + 0.25) / bpb) * bpb);
        res = toDrums(hits, { tempo: p.tempo, origin: 0, originBeat: b0 - beat, meter: p.meter });
      } else res = toDrums(hits, { tempo: p.tempo, meter: p.meter });
      const c = input.capture.add({ src: 'beatbox', kind: 'drums', notes: res.notes, tempo: p.tempo, beat, grid: res.grid, track: drumTrack()?.id || null });
      emit('take', c);
      return c;
    },
    // Teach it your sounds: f from features() of one of your hits
    train(row, f) {
      (trained[row] = trained[row] || []).push({ centroid: f.centroid, zcr: f.zcr, low: f.low, high: f.high });
      if (trained[row].length > 12) trained[row].shift();
      try { localStorage.setItem(TRAIN_KEY, JSON.stringify(trained)); } catch (e) { /* private mode */ }
    },
    untrain() { for (const k of Object.keys(trained)) delete trained[k]; try { localStorage.removeItem(TRAIN_KEY); } catch (e) { /* ok */ } },
  };
  return tap;
}
export { median };
