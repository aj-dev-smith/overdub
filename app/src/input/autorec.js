// @ts-check
// Recording automation: Touch, and Write it into the lane (docs/research/AUTOMATION.md 3.9, where it was "Keep that
// move"). There is no automation arm.
//
// While R records (the recorder's state 'rec'), holding a knob or a fader writes into its lane: the first move starts
// writing at the audible beat of the event (its timeStamp, on the take's grid, so loop passes and wraps land where they
// were heard), every move adds a point, and letting go hands control back to the lane with a 200 ms glide (Logic's
// ramp time), written as the last point. Only the touched span is replaced (Touch: later automation survives); on a
// param with no lane the last value holds after it (Touch and Latch agree on an empty lane). The points are thinned
// (core/automation.js thin, 0.5% of travel) and become auto.writes that the recorder dispatches with its take: one
// commit, one undo step, by you (input/recorder.js, commit). A held lane that was written is given back.
// While it records, a move is heard and not kept: the lanes written so far and the control being held are previews
// (store.preview: in the song, out of the history), so the next loop pass plays what the last one wrote.
// A move in the count-in (or while R waits for the bar) is the take's too: heard the same way, it starts writing at
// the downbeat, from wherever the hand is then; a move already going when the count began is cut there (the part
// before is a move the song played over, below) and goes on into the take. Cancel the count and it is let go.
//
// While the song just plays, every move is kept anyway (Ableton Note's capture; Overdub never loses an idea): when
// the gesture ends, a toast says what moved and that it stays where you left it ("Cutoff moved from 400 Hz to 6.2 kHz
// over bars 9–11. It stays where you left it.") and offers Write it into the lane, which writes it into the lane exactly
// as a recording would (and gives the lane back, and puts the knob's own value back where it was). Ignored, it expires
// with the toast and the move stays what it was. Stopped, a knob is just a knob.
//
// How a move is seen: the knobs (ui/rack.js through ui/faces.js), the mixer's faders and pans and the master fader
// dispatch their value with a coalesce key ('insert:<id>:<key>', 'instrument:<track>:<key>', 'track:<id>:gain|pan',
// 'master:gain'). autorec sits in front of store.dispatch and reads those (a knob's turn that holds its lane, ui/rack's
// [set, auto.set off], is read the same way); everything else goes straight through. While R records it takes them
// (the dispatch returns { ok: true, recorded: true } and the song's history doesn't change). A gesture ends when the
// pointer that made it lifts, after 400 ms without a move for the wheel and the keys, or when the transport stops.
//
//   autorec = app.input.autorec
//   autorec.recording                 a take is writing lanes (R, state 'rec')
//   autorec.touching()                the controls held now: [{ track, insert?, param, value }]
//   autorec.writes()                  this take's planned auto.writes so far
//   autorec.moves                     the moves the song played over, newest last (up to 8): { id, name, from, to,
//                                     bars, text, ops, kept }
//   autorec.keep(id?)                 Write it into the lane (the last move by default) -> dispatch result
//   autorec.finish(take, { cancel })  the recorder's hook: ends the take's gestures, releases the previews, and returns
//                                     { ops, label, summary, lanes } for the take's commit (cancel: drops them)
//   autorec.undoPass(n)               ⌘Z while recording (recorder.undoPass): pass n's moves come out of the take
//
// Pure (Node too): planMove({ addr, spec, pts, before, lane, glide }) -> [auto.write], gestureOf(ops, opts) -> addr
// and value of a control move, or null.

import { specFor, valueAt, thin, laneAt, laneKey } from '../core/automation.js';
import { beatsPerBar } from '../core/music.js';
import { passOf } from './capture.js';

export const GLIDE_S = 0.2;      // letting go: back to the lane over this long
export const THIN = 0.005;       // recorded points are thinned to 0.5% of the control's travel
const IDLE_MS = 400;             // a wheel or key gesture ends after this long without a move
const MOVES_MAX = 8;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/* ------------------------------------------------------------------------------------------------ pure */

// The control a dispatch moves: { addr: { track, insert?, param }, value } or null. A move is by you, carries a
// coalesce key, and sets one value of one control (plus, from a knob that holds its lane, that lane's auto.set).
export function gestureOf(opOrOps, { by = 'you', coalesce = null } = {}) {
  if (by !== 'you' || !coalesce || !/^(insert|instrument|track|master):/.test(String(coalesce))) return null;
  const ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
  let hit = null;
  for (const op of ops) {
    if (!op || typeof op !== 'object') return null;
    if (op.type === 'auto.set') continue;
    if (hit) return null;
    let addr = null, value;
    const one = (o) => { const k = o && typeof o === 'object' ? Object.keys(o) : []; return k.length === 1 ? k[0] : null; };
    if (op.type === 'insert.set' && op.patch && one(op.patch) === 'params') {
      const k = one(op.patch.params);
      if (k) { addr = { track: op.track, insert: op.insert, param: k }; value = op.patch.params[k]; }
    } else if (op.type === 'instrument.set' && !op.device && op.params) {
      const k = one(op.params);
      if (k && Object.keys(op).every((x) => x === 'type' || x === 'track' || x === 'params')) { addr = { track: op.track, insert: 'instrument', param: k }; value = op.params[k]; }
    } else if (op.type === 'track.set' && op.patch) {
      const k = one(op.patch);
      if (k === 'gain' || k === 'pan') { addr = { track: op.track, param: k }; value = op.patch[k]; }
    } else if (op.type === 'master.set' && op.patch && one(op.patch) === 'gain') {
      addr = { track: 'master', param: 'gain' }; value = op.patch.gain;
    }
    if (!addr || !fin(+value)) return null;
    hit = { addr, value: +value };
  }
  if (!hit) return null;
  // (an auto.set alongside must be on the same control)
  for (const op of ops) if (op.type === 'auto.set' && (op.param !== hit.addr.param || String(op.insert || '') !== String(hit.addr.insert || ''))) return null;
  return hit;
}

// One gesture as auto.writes. pts: [{ pass, beat, from, to, v }] in time order (passOf's places, the last one where
// it was let go); before: the value it moved from; lane: the lane's points when it was touched (null: none); glide:
// beats to hand back to that lane. Each loop pass it crossed is its own write (a pass held to the loop's end, the next
// one from the loop's start). Values are clamped to the control's travel and thinned in it.
export function planMove({ addr, spec = null, pts, before, lane = null, glide = 0, tol = THIN }) {
  const clampV = (v) => (spec && fin(spec.min) && fin(spec.max) ? clamp(v, Math.min(spec.min, spec.max), Math.max(spec.min, spec.max)) : v);
  const old = lane && lane.length ? lane : null;
  const segs = [];
  let cur = null, lastV = null;
  for (const q of pts || []) {
    if (!q || !fin(q.beat) || !fin(q.v)) continue;
    const v = clampV(q.v);
    if (cur && q.pass !== cur.pass) {
      // across a wrap: this pass holds to the loop's end, any pass held right through, then the loop's start
      if (fin(cur.to) && cur.to > cur.pts[cur.pts.length - 1].t) cur.pts.push({ t: cur.to, v: lastV });
      for (let k = cur.pass + 1; k < q.pass; k++) segs.push({ pass: k, pts: [{ t: q.from, v: lastV }, { t: q.to, v: lastV }], to: q.to });
      cur = { pass: q.pass, to: q.to, pts: [{ t: q.from, v: lastV }] };
      segs.push(cur);
    }
    if (!cur) {
      cur = { pass: q.pass, to: q.to, pts: [] };
      const b = fin(before) ? clampV(before) : v;
      if (b !== v) cur.pts.push({ t: q.beat, v: b });   // (a jump from where it was, at the touch)
      segs.push(cur);
    }
    cur.pts.push({ t: Math.max(q.beat, cur.pts.length ? cur.pts[cur.pts.length - 1].t : -Infinity), v });
    lastV = v;
  }
  if (!cur) return [];
  // let go: the lane takes over again
  const end = cur.pts[cur.pts.length - 1];
  if (old && glide > 0) {
    const t = fin(cur.to) ? Math.min(cur.to, end.t + glide) : end.t + glide;
    if (t > end.t) cur.pts.push({ t, v: clampV(valueAt(old, t, spec)) });
  }
  const out = [];
  for (const s of segs) {
    const points = thin(s.pts, tol, spec);
    if (!points.length) continue;
    const op = { type: 'auto.write', ...addr, from: points[0].t, to: points[points.length - 1].t, points };
    Object.defineProperty(op, 'pass', { value: s.pass, enumerable: false }); // (which loop pass: not part of the op)
    out.push(op);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ words */

const sentence = (s) => (/[a-z]/.test(s) ? s : s.charAt(0) + s.slice(1).toLowerCase());
export function nameOf(p, addr, spec) {
  const t = addr.track === 'master' ? null : (p.tracks || []).find((x) => x.id === addr.track);
  const who = t ? t.name : 'Master';
  if (!addr.insert) return `${who} ${addr.param === 'pan' ? 'pan' : 'level'}`;
  return sentence(String(spec?.label || addr.param));
}
export function valueWords(spec, v, addr = {}) {
  if (!addr.insert && addr.param === 'pan') return Math.abs(v) < 0.005 ? 'centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`;
  if (!addr.insert && addr.param === 'gain') return v <= -95.9 ? 'off' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dB`;
  if (spec?.opts) return String(spec.opts[clamp(Math.round(v), 0, spec.opts.length - 1)] ?? v);
  if (typeof spec?.fmt === 'function') { try { const s = spec.fmt(v); if (s != null) return String(s); } catch { /* its own business */ } }
  const r = (x, d) => (+x).toFixed(d);
  switch (spec?.unit) {
    case 'Hz': return v >= 1000 ? `${r(v / 1000, v >= 10000 ? 1 : 1)} kHz` : `${Math.round(v)} Hz`;
    case 'dB': return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dB`;
    case 'ms': return v >= 1000 ? `${r(v / 1000, 2)} s` : `${Math.round(v)} ms`;
    case 's': return `${r(v, 2)} s`;
    case '%': return `${Math.round(v)}%`;
    case 'st': return `${v > 0 ? '+' : v < 0 ? '−' : ''}${r(Math.abs(v), 1)} st`;
    default: {
      const span = spec && fin(spec.min) && fin(spec.max) ? Math.abs(spec.max - spec.min) : 10;
      return span <= 1.0001 && spec?.min >= 0 ? `${Math.round(v * 100)}%` : r(v, span >= 100 ? 0 : span >= 5 ? 1 : 2);
    }
  }
}
// "bars 9–11" for song beats [a, b] (a hand a hair either side of a bar line is on it)
function barsWords(bpb, a, b) {
  const e = 1 / 64;
  const x = Math.floor((a + e) / bpb) + 1, y = Math.max(x, Math.ceil((b - e) / bpb));
  return y > x ? `bars ${x}–${y}` : `bar ${x}`;
}

/* ------------------------------------------------------------------------------------------------ live */

export function createAutorec(app, input, rec) {
  const { store, engine } = app;
  const getDevice = (id) => { try { return app.devices?.getDevice?.(id) || null; } catch { return null; } };
  const P = () => store.get();
  const tempo = () => +P().tempo || 120;
  const bpbNow = () => beatsPerBar(P().meter);
  const toast = (text, o) => { try { app.ui?.toast?.(text, o); } catch { /* no ui */ } };

  const open = new Map();     // laneKey -> the gesture in progress
  const moves = [];           // the moves the song played over, each offered to write into its lane
  let take = null;            // { id, writes: [{ op, pass, key, name }], held: Map } while R records
  let pv = null;              // the one preview: the take's writes and the holds of the controls being touched
  let seq = 0;
  const down = new Set();     // pointers down now

  /* ---- reading a control */
  const keyOf = (addr) => laneKey({ track: addr.track, insert: addr.insert || null, param: addr.param });
  function resolve(addr) {
    if (addr.track === 'master') return { ...addr };
    const t = store.track(addr.track) || (P().tracks || []).find((x) => String(x.name).toLowerCase() === String(addr.track).toLowerCase());
    return t ? { ...addr, track: t.id } : null;
  }
  const clean = (addr) => (addr.insert ? { track: addr.track, insert: addr.insert, param: addr.param } : { track: addr.track, param: addr.param });
  function staticOf(addr, spec) {
    const p = P();
    if (addr.track === 'master') {
      if (!addr.insert) return +p.master.gain || 0;
      const fx = (p.master.inserts || []).find((x) => x.id === addr.insert);
      return fx?.params?.[addr.param] ?? spec?.def ?? null;
    }
    const t = store.track(addr.track);
    if (!t) return null;
    if (!addr.insert) return addr.param === 'pan' ? +t.pan || 0 : +t.gain || 0;
    if (addr.insert === 'instrument') return t.instrument?.params?.[addr.param] ?? spec?.def ?? null;
    const fx = (t.inserts || []).find((x) => x.id === addr.insert);
    return fx?.params?.[addr.param] ?? spec?.def ?? null;
  }
  function setOp(addr, v) {
    if (!addr.insert) return addr.track === 'master' ? { type: 'master.set', patch: { gain: v } } : { type: 'track.set', track: addr.track, patch: { [addr.param]: v } };
    if (addr.insert === 'instrument') return { type: 'instrument.set', track: addr.track, params: { [addr.param]: v } };
    return { type: 'insert.set', track: addr.track, insert: addr.insert, patch: { params: { [addr.param]: v } } };
  }

  /* ---- time */
  function eventTs() {
    try {
      const ev = globalThis.event, ts = ev && ev.timeStamp, now = performance.now();
      return fin(ts) && ts > 0 && now - ts >= 0 && now - ts < 150 ? ts : null;
    } catch { return null; }
  }
  // the transport's unwrapped grid at a performance.now() time (null: now; null when stopped)
  function gridAt(ts) {
    if (take) {
      const g = rec.gridNow();
      if (!fin(g)) return null;
      return fin(ts) ? g - Math.max(0, performance.now() - ts) / 1000 * tempo() / 60 : g;
    }
    if (!fin(ts)) ts = performance.now();
    if (!engine?.playing || !fin(engine.gridBeat)) return null;
    let g = engine.gridBeat;
    if (typeof engine.beatAt === 'function') {
      let d = engine.beatAt(ts) - engine.beat;
      const lp = P().loop, len = lp && lp.on ? lp.end - lp.start : 0;
      if (len > 0 && Math.abs(d) > len / 2) d -= Math.sign(d) * len;
      if (fin(d) && Math.abs(d) < 1) g += d;
    }
    return g;
  }
  // a span for a gesture the song just plays over (the recorder's shape: passOf places a grid beat on it)
  function playSpan(g, ts) {
    const b0 = typeof engine.beatAt === 'function' ? engine.beatAt(fin(ts) ? ts : performance.now()) : engine.beat;
    const lp = P().loop;
    const loop = lp && lp.on && lp.end - lp.start >= 1 / 64 && b0 < lp.end ? { start: +lp.start, end: +lp.end } : null;
    return { g0: g, b0, loop, wrap: loop ? g + (loop.end - b0) : Infinity };
  }

  /* ---- the preview: the take's writes, then a hold for each control being touched */
  function holdOps() {
    const ops = [];
    for (const G of open.values()) {
      if ((G.mode !== 'rec' && G.mode !== 'count') || G.last == null) continue;
      const lane = laneHere(G.addr);
      if (lane && !lane.off) ops.push({ type: 'auto.set', ...clean(G.addr), patch: { off: true } });
      ops.push(setOp(G.addr, G.last));
    }
    return ops;
  }
  // (with the writes so far in the song: what laneHere sees between the ops of one preview isn't needed)
  function laneHere(addr) { return laneAt(P(), clean(addr)); }
  // (a song loaded since: the preview went with the old one, and there is nothing to take back)
  function release() {
    if (!pv) return;
    const x = pv; pv = null;
    if (x.doc !== P()) return;
    try { x.release(); } catch { /* the commit puts it right */ }
  }
  function relayer() {
    release();
    const writes = take ? take.writes.map((x) => x.op) : [];
    if (writes.length) {
      const a = store.preview(writes, { by: 'you' });
      if (a.ok) pv = a; else console.warn('autorec: preview failed', a.error);
    }
    const holds = holdOps();
    if (holds.length) {
      const w = pv;
      const b = store.preview(holds, { by: 'you' });
      if (b.ok) pv = w ? { release() { b.release(); w.release(); } } : b;
    }
    if (pv) pv.doc = P();
  }

  /* ---- gestures */
  function begin(addr, value, ts) {
    const key = keyOf(addr);
    const spec = specFor(P(), clean(addr), getDevice);
    const mode = take && rec.state === 'rec' ? 'rec' : rec?.state === 'count' ? 'count' : engine?.playing ? 'play' : 'idle';
    const g = gridAt(ts);
    const lane = laneHere(addr);
    const t0 = mode === 'rec' ? rec.where(g)?.beat : mode === 'play' ? playSpan(g, ts).b0 : null;
    const G = {
      id: ++seq, key, addr, spec, mode, pointer: down.size > 0, pts: [], last: null, timer: 0,
      lane: lane ? lane.points.map((x) => ({ ...x })) : null, wasOff: !!(lane && lane.off),
      static0: staticOf(addr, spec), span: mode === 'play' && fin(g) ? playSpan(g, ts) : null,
    };
    G.before = lane && fin(t0) ? valueAt(lane, t0, spec) : G.static0;
    open.set(key, G);
    return G;
  }
  function where(G, g) {
    if (!fin(g)) return null;
    if (G.mode === 'rec') return take?.r ? passOf(g, take.r.span) : rec.where(g);
    return G.span ? passOf(g, G.span) : null;
  }
  function addPoint(G, v, ts) {
    G.last = v;
    if (G.mode === 'idle' || G.mode === 'count') return;
    const g = gridAt(ts);
    const w = where(G, g);
    if (!w) return;
    G.pts.push({ pass: w.pass, beat: w.beat, from: w.from, to: w.to, v, g });
  }
  function idleEnd(G) {
    clearTimeout(G.timer);
    // (a wheel or a key: it ended at its last step)
    if (!G.pointer && G.mode !== 'count') G.timer = setTimeout(() => end(G, null, G.pts.length ? G.pts[G.pts.length - 1].g : null), IDLE_MS);
  }
  // A move seen at the dispatch: true when R took it (nothing is dispatched)
  function onMove(hit) {
    const addr = resolve(hit.addr);
    if (!addr) return false;
    const ts = eventTs();
    let G = open.get(keyOf(addr));
    if (G && G.mode === 'rec' && !take) { end(G, ts); G = null; }
    // (a move the song was playing over when the count-in began: that part is a move to keep; the rest is the take's)
    if (G && G.mode === 'play' && rec?.state === 'count') { end(G, ts); G = null; }
    if (!G) G = begin(addr, hit.value, ts);
    addPoint(G, hit.value, ts);
    idleEnd(G);
    if ((G.mode === 'rec' && take) || G.mode === 'count') { relayer(); return true; }
    return false;
  }
  // Let go (or the transport stopped): the gesture becomes writes (R) or a move to keep (playing)
  function end(G, ts, g = null) {
    if (!open.has(G.key) || open.get(G.key) !== G) return;
    clearTimeout(G.timer);
    open.delete(G.key);
    if (G.mode === 'idle' || G.mode === 'count' || G.last == null) { if (G.mode === 'rec' || G.mode === 'count') relayer(); return; }
    // holding still counts: the last value runs to the moment it was let go
    const gg = g ?? gridAt(ts);
    const w = where(G, gg);
    const lastPt = G.pts[G.pts.length - 1];
    if (w && lastPt && (gg ?? -Infinity) > lastPt.g) G.pts.push({ pass: w.pass, beat: w.beat, from: w.from, to: w.to, v: G.last, g: gg });
    if (!G.pts.length) { if (G.mode === 'rec') relayer(); return; }
    const glide = GLIDE_S * tempo() / 60;
    const ops = planMove({ addr: clean(G.addr), spec: G.spec, pts: G.pts, before: G.before, lane: G.lane, glide });
    if (G.mode === 'rec') {
      if (take && ops.length) {
        const name = nameOf(P(), G.addr, G.spec);
        for (const op of ops) take.writes.push({ op, pass: op.pass, key: G.key, name, addr: clean(G.addr) });
        if (G.wasOff) take.held.set(G.key, clean(G.addr));
      }
      relayer();
      return;
    }
    offer(G, ops);
  }
  function endAll({ pointer = null, ts = performance.now(), mode = null } = {}) {
    for (const G of [...open.values()]) if ((pointer == null || G.pointer === pointer) && (!mode || G.mode === mode)) end(G, ts);
  }

  /* ---- Write it into the lane (a move the song played over) */
  function offer(G, writes) {
    if (!writes.length) return;
    const span = G.pts[G.pts.length - 1].g - G.pts[0].g;
    const vals = G.pts.map((x) => x.v);
    if (!(span >= 1 / 64) || (Math.max(...vals) === Math.min(...vals) && vals[0] === G.before)) return;
    const name = nameOf(P(), G.addr, G.spec);
    const from = Math.min(...writes.map((o) => o.from));
    const bars = barsWords(bpbNow(), from, Math.max(from, G.pts[G.pts.length - 1].beat));
    // (the move already stuck: the toast says the level stays where it was left, and offers to write the move into the
    // lane; "Keep that move" read as if the move would be taken back otherwise, docs/FRESH-EYES-5.md)
    const text = `${name} moved from ${valueWords(G.spec, G.before, G.addr)} to ${valueWords(G.spec, G.last, G.addr)} over ${bars}. It stays where you left it.`;
    const mv = { id: 'mv' + G.id, name, addr: clean(G.addr), from: G.before, to: G.last, bars, text, writes, static0: G.static0, kept: false, at: Date.now() };
    moves.push(mv);
    if (moves.length > MOVES_MAX) moves.shift();
    toast(text, { kind: 'info', ms: 10000, action: { label: 'Write it into the lane', run: () => keep(mv.id) } });
    try { input.emit('automove', { id: mv.id, text }); } catch { /* ok */ }
  }
  function keep(id = null) {
    const mv = id ? moves.find((x) => x.id === id) : moves[moves.length - 1];
    if (!mv) return { ok: false, error: 'no move to keep' };
    if (mv.kept) return { ok: false, error: 'already kept' };
    const addr = mv.addr, spec = specFor(P(), addr, getDevice);
    const ops = [];
    const now = staticOf(addr, spec);
    // exactly as a recording would: the knob's own value back where it was, the lane written and playing
    if (fin(mv.static0) && now !== mv.static0) ops.push(setOp(addr, mv.static0));
    ops.push(...mv.writes.map((o) => ({ ...o, points: o.points.map((x) => ({ ...x })) })));
    const lane = laneAt(P(), addr);
    if (lane && lane.off) ops.push({ type: 'auto.set', ...addr, patch: { off: false } });
    const r = raw(ops, { by: 'you', label: `${mv.name}, ${mv.bars} (kept)` });
    if (!r.ok) { toast(`That move could not go in: ${r.error}`, { kind: 'bad' }); return r; }
    mv.kept = true;
    toast(`Written into the lane: ${mv.name}, ${mv.bars}. It plays from the lane now.`, { kind: 'ok', action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    return r;
  }

  /* ---- the take (the recorder's state, and its commit hook) */
  try {
    rec.on('state', (d) => {
      if (d.state === 'rec' && !take) { take = { id: d.take, writes: [], held: new Map(), r: null }; downbeat(); }
      // (the count cancelled: what the hand held in it is let go, and the knob is as it was)
      else if (d.state === 'idle' && !take) dropCount();
    });
  } catch { /* no recorder */ }
  // The downbeat: a control held through the count-in starts writing here, at the value the hand is at (a jump in
  // from the lane, or from the knob's own value, as any touch is).
  function downbeat() {
    let any = false;
    for (const G of [...open.values()]) {
      if (G.mode !== 'count' && G.mode !== 'play') continue;
      if (G.mode === 'play') { end(G, performance.now()); continue; }  // (the song played over it: a move to keep)
      const g = rec.gridNow(), w = fin(g) ? rec.where(g) : null;
      if (!w || G.last == null) { open.delete(G.key); clearTimeout(G.timer); any = true; continue; }
      const beat = w.pass === 0 && fin(w.from) ? Math.max(w.beat, w.from) : w.beat;
      G.mode = 'rec';
      G.span = null;
      G.before = G.lane && G.lane.length ? valueAt(G.lane, beat, G.spec) : G.static0;
      G.pts = [{ pass: w.pass, beat, from: w.from, to: w.to, v: G.last, g }];
      idleEnd(G);
      any = true;
    }
    if (any) relayer();
  }
  function dropCount() {
    let any = false;
    for (const G of [...open.values()]) if (G.mode === 'count') { clearTimeout(G.timer); open.delete(G.key); any = true; }
    if (any) relayer();
  }
  function finish(r, { cancel = false } = {}) {
    if (!take) { dropCount(); return { ops: [], label: '', summary: '' }; }
    take.r = r || null;
    // a control still held when the take stops: it ends where the take did
    for (const G of [...open.values()]) if (G.mode === 'rec') end(G, performance.now(), r && fin(r.stopG ?? r.lastG) ? (r.stopG ?? r.lastG) : null);
    const t = take;
    take = null;
    release();
    if (cancel) return { ops: [], label: '', summary: '' };
    // (a held lane is given back only if something was written into it)
    const ops = [...t.writes.map((x) => x.op), ...[...t.held].filter(([k]) => t.writes.some((x) => x.key === k)).map(([, addr]) => ({ type: 'auto.set', ...addr, patch: { off: false } }))];
    const bpb = bpbNow();
    const names = new Map();
    for (const x of t.writes) {
      const nm = names.get(x.key) || { name: x.name, addr: x.addr, from: Infinity, to: -Infinity };
      nm.from = Math.min(nm.from, x.op.from); nm.to = Math.max(nm.to, x.op.to);
      names.set(x.key, nm);
    }
    const parts = [...names.values()].map((x) => `${x.name}, ${barsWords(bpb, x.from, x.to)}`);
    const label = parts.length ? `${parts.join('; ')} (recorded)` : '';
    const summary = parts.length ? `Recorded into ${parts.length === 1 ? 'its lane' : 'their lanes'}: ${parts.join('; ')}.` : '';
    return { ops, label, summary, lanes: [...names.values()].map((x) => ({ ...x.addr, from: x.from, to: x.to, name: x.name })) };
  }
  // ⌘Z while it records (recorder.undoPass): that loop pass's moves come out too
  function undoPass(n) {
    if (!take) return 0;
    const k = take.writes.length;
    take.writes = take.writes.filter((x) => x.pass !== n);
    if (take.writes.length !== k) relayer();
    return k - take.writes.length;
  }

  /* ---- in front of store.dispatch */
  const raw = store.dispatch;
  store.dispatch = function (ops, o = {}) {
    let hit = null;
    try { hit = gestureOf(ops, o || {}); } catch { hit = null; }
    if (hit) {
      let took = false;
      try { took = onMove(hit); } catch (e) { console.error('autorec', e); }
      if (took) return { ok: true, txn: null, created: {}, recorded: true };
    }
    return raw.call(this, ops, o);
  };

  /* ---- the pointer, the transport */
  try {
    globalThis.addEventListener('pointerdown', (e) => { down.add(e.pointerId); }, true);
    // (after the control's own pointerup: the commit it dispatches there is the last point of the gesture)
    const up = (e) => { down.delete(e.pointerId); const ts = e.timeStamp || performance.now(); if (!down.size) setTimeout(() => { if (!down.size) endAll({ pointer: true, ts }); }, 0); };
    globalThis.addEventListener('pointerup', up, true);
    globalThis.addEventListener('pointercancel', up, true);
    globalThis.addEventListener('blur', () => { down.clear(); endAll({ pointer: true }); });
  } catch { /* node */ }
  try {
    engine.on('transport', (e) => { if (e && !e.playing) endAll({ mode: 'play' }); });
  } catch { /* no engine */ }
  // a song loaded: nothing in progress carries over
  store.on('change', (e) => { if (e && e.kind === 'load') { for (const G of open.values()) clearTimeout(G.timer); open.clear(); moves.length = 0; } });

  return {
    get recording() { return !!take; },
    touching: () => [...open.values()].map((G) => ({ ...clean(G.addr), value: G.last, mode: G.mode })),
    writes: () => (take ? take.writes.map((x) => ({ ...x.op, pass: x.pass })) : []),
    get moves() { return moves.slice(); },
    keep,
    finish,
    undoPass,
  };
}
