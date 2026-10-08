// OverdubBench's scorer: a task's song after an agent's work, measured, not judged. Every check is a number read off
// the canonical Node render (app/src/engine/node/render.js) through the studio's ears (app/src/audio/measure.js), or
// off the notes themselves (key, clashes, range, timing), then held against the task's target. docs/BENCH.md is the
// guide; tools/bench-test.js holds the oracles above 0.9 and the do-nothing baselines below 0.5.
//
//   import { loadTask, listTasks, startSong, applyOps, scoreTask } from './score.js';
//   const task = loadTask('mix-bass-under-kick');          // a tools/bench/tasks/*.json, its song resolved
//   const start = startSong(task);                          // the song the agent is handed (setup applied)
//   const r = applyOps(start, ops);                         // { ok, song, error? }: the agent's ops, through the store
//   const s = scoreTask(task, r.song);                      // { score 0..1, checks: [{ id, label, value, target, score, weight }], ... }
//
// The score: the weighted mean of the checks' scores, times every gate's score (a gate is a must: "a device was
// written", "the song still renders clean"). A check scores 1 inside its target range and falls off linearly to 0
// over `soft` beyond either end (no `soft`: pass or fail).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSong, songEnd } from '../../app/src/engine/node/render.js';
import { measure } from '../../app/src/audio/measure.js';
import { createStore } from '../../app/src/core/store.js';
import { cleanProject } from '../../app/src/core/project.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { scalePcs, parsePc, chordPitches } from '../../app/src/core/music.js';
import { PROBE_DEVICES } from './probes.js';

export const BENCH = 'overdub-bench/0';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
const clone = (x) => JSON.parse(JSON.stringify(x));
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
const dB = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;

/* ============================================================================================== tasks and songs */
export function listTasks() {
  return fs
    .readdirSync(path.join(HERE, 'tasks'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function loadTask(idOrFile) {
  const file =
    fs.existsSync(idOrFile) && idOrFile.endsWith('.json')
      ? path.resolve(idOrFile)
      : path.join(HERE, 'tasks', idOrFile + '.json');
  const task = JSON.parse(fs.readFileSync(file, 'utf8'));
  task.file = file;
  if (typeof task.song === 'string') task.songFile = path.resolve(path.dirname(file), '..', task.song);
  return task;
}

const songCache = new Map();
function readSongFile(file) {
  if (!songCache.has(file)) songCache.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
  return clone(songCache.get(file));
}

// The song the agent is handed: the task's song with its setup ops applied by the house.
export function startSong(task) {
  const base = task.songFile ? readSongFile(task.songFile) : clone(task.song);
  if (!task.setup || !task.setup.length) return cleanProject(base);
  const store = createStore(base, { getDevice });
  const r = store.dispatch(task.setup, { by: 'overdub', label: 'bench setup' });
  if (!r.ok) throw new Error(`task ${task.id}: setup failed: ${r.error}`);
  return clone(store.get());
}

// What an agent did, as transactions of ops. Accepts: [op, ...] | { ops: [...] } | [{ ops, label? }, ...] |
// { calls: [{ tool: 'apply_ops' | 'define_device', input }] } (a log of MCP tool calls; other tools are ignored).
export function transactionsOf(input) {
  if (input == null) return [];
  if (Array.isArray(input)) {
    if (input.length && input.every((x) => x && Array.isArray(x.ops) && !x.type)) return input.map((x) => x.ops);
    return input.length ? [input] : [];
  }
  if (Array.isArray(input.calls)) {
    const out = [];
    for (const c of input.calls) {
      const tool = c.tool || c.name,
        a = c.input || c.arguments || {};
      if (tool === 'apply_ops') out.push(typeof a.ops === 'string' ? JSON.parse(a.ops) : a.ops || []);
      else if (tool === 'define_device') {
        const d = typeof a.device === 'string' ? JSON.parse(a.device) : a.device;
        const ops = [{ type: 'device.define', device: d }];
        if (a.use_on && a.use_on.track) {
          if (d.kind === 'instrument') ops.push({ type: 'instrument.set', track: a.use_on.track, device: d.id });
          else
            ops.push({
              type: 'insert.add',
              track: a.use_on.track,
              insert: { device: d.id, params: {} },
              ...(Number.isFinite(a.use_on.index) ? { index: a.use_on.index } : {}),
            });
        }
        out.push(ops);
      }
    }
    return out;
  }
  if (Array.isArray(input.ops)) return input.ops.length ? [input.ops] : [];
  throw new Error('ops: expected [op], { ops }, [{ ops }] or { calls: [{ tool, input }] }');
}

// Apply an agent's work to a song through the store (the same ops, checks and inverses the studio uses).
export function applyOps(song, input, { by = 'mcp:bench' } = {}) {
  const store = createStore(clone(song), { getDevice });
  store.addAuthor(by, { kind: 'agent', name: by.replace(/^mcp:/, '') });
  const txns = transactionsOf(input);
  for (let i = 0; i < txns.length; i++) {
    const r = store.dispatch(txns[i], { by, label: `bench ${i + 1}` });
    if (!r.ok) return { ok: false, error: `transaction ${i + 1}: ${r.error}`, song: clone(store.get()) };
  }
  return { ok: true, song: clone(store.get()), transactions: txns.length };
}

// New tracks, clips and inserts get random ids in the studio, and ids seed devices. For a score that repeats, every
// id the starting song didn't have is renamed by position before anything is rendered.
export function stableIds(song, start) {
  const p = clone(song);
  const known = new Set();
  for (const t of start.tracks) {
    known.add(t.id);
    for (const c of t.clips) known.add(c.id);
    for (const x of t.inserts) known.add(x.id);
  }
  for (const x of start.master.inserts) known.add(x.id);
  const n = { t: 0, c: 0, fx: 0 };
  const fresh = (pre) => `${pre}_nw${(n[pre]++).toString(36).padStart(4, '0')}`;
  for (const t of p.tracks) {
    if (!known.has(t.id)) t.id = fresh('t');
    for (const c of t.clips) if (!known.has(c.id)) c.id = fresh('c');
    for (const x of t.inserts) if (!known.has(x.id)) x.id = fresh('fx');
  }
  for (const x of p.master.inserts) if (!known.has(x.id)) x.id = fresh('fx');
  return p;
}

/* ============================================================================================== rendering */
const renders = new Map(); // key -> { r } | { m }: the process's memo (the same song and options render the same samples)
function keyOf(song, opts) {
  return JSON.stringify([song.tempo, song.meter, song.tracks, song.master, song.devices, opts]);
}

function render(ctx, song, opts) {
  const key = keyOf(song, opts);
  if (ctx.memo.has(key)) {
    const hit = ctx.memo.get(key);
    ctx.note(hit.r);
    return hit.r;
  }
  const r = renderSong(song, { sr: 48000, ...opts });
  let bad = 0;
  for (const ch of r.channels)
    for (let i = 0; i < ch.length; i += 7)
      if (!Number.isFinite(ch[i])) {
        bad++;
        break;
      }
  r.nan = bad > 0;
  ctx.note(r);
  if (ctx.memo === renders && renders.size > 120) renders.clear(); // a long run: keep memory in check
  ctx.memo.set(key, { r });
  return r;
}
export function clearCache() {
  renders.clear();
}

// Track names (or ids, or 'new') -> ids in this song. Names are looked up in the song first, then in the start song
// (by id), so a renamed track is still found.
function trackIds(ctx, song, tracks) {
  if (tracks == null || tracks === 'mix') return null;
  if (tracks === 'new') return newTracks(ctx, song).map((t) => t.id);
  const out = [];
  for (const name of [].concat(tracks)) {
    let t = song.tracks.find((x) => x.id === name) || song.tracks.find((x) => x.name === name);
    if (!t) {
      const s = ctx.start.tracks.find((x) => x.name === name);
      if (s) t = song.tracks.find((x) => x.id === s.id);
    }
    if (!t) throw new Error(`no track "${name}"`);
    out.push(t.id);
  }
  return out;
}
const newTracks = (ctx, song) => song.tracks.filter((t) => !ctx.start.tracks.some((s) => s.id === t.id));

// measure() over a scope: { tracks, from?, to? (beats), section? }. The whole song is rendered once per track set
// (with a tail) and sliced, so a section hears what spills into it, as a listener would.
function scopeMeasure(ctx, song, scope = {}) {
  const ids = trackIds(ctx, song, scope.tracks);
  if (ids && !ids.length) return null;
  const end = songEnd(song);
  const r = render(ctx, song, { from: 0, to: end, tracks: ids, tail: 1.5 });
  let { from, to } = scope;
  if (scope.section) {
    const s =
      (song.sections || []).find((x) => x.name === scope.section) ||
      ctx.start.sections.find((x) => x.name === scope.section);
    if (!s) throw new Error(`no section "${scope.section}"`);
    from = s.start;
    to = s.start + s.length;
  }
  const spb = 60 / song.tempo,
    lat = (r.latency && r.latency.total) || 0;
  const a = from == null ? 0 : from * spb + lat,
    b = to == null ? undefined : to * spb + lat;
  const mkey = keyOf(song, [ids, a, b, 'm']);
  if (ctx.memo.has(mkey)) return ctx.memo.get(mkey).m;
  const m = measure({ sr: r.sr, channels: r.channels }, { from: a, to: b });
  m._r = r;
  m._a = a;
  m._b = b;
  ctx.memo.set(mkey, { m });
  return m;
}

// A tiny RBJ biquad, for band-limited stereo measures.
function biquad(type, f, sr, q = 0.7071) {
  const w = (2 * Math.PI * f) / sr,
    cs = Math.cos(w),
    al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + al,
    a1 = -2 * cs,
    a2 = 1 - al;
  if (type === 'lp') {
    b0 = (1 - cs) / 2;
    b1 = 1 - cs;
    b2 = b0;
  } else {
    b0 = (1 + cs) / 2;
    b1 = -(1 + cs);
    b2 = b0;
  }
  const c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  return (x) => {
    const y = new Float64Array(x.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    return y;
  };
}
// Side energy against mid energy, in dB, between lo and hi Hz (two 2nd-order sections each side: 24 dB/oct).
function bandSide(m, lo, hi) {
  const { _r: r, _a: a, _b: b } = m;
  const s0 = Math.round(a * r.sr),
    s1 = b == null ? r.length : Math.min(r.length, Math.round(b * r.sr));
  const L = r.channels[0].subarray(s0, s1),
    R = r.channels[1].subarray(s0, s1);
  const mid = new Float64Array(L.length),
    side = new Float64Array(L.length);
  for (let i = 0; i < L.length; i++) {
    mid[i] = L[i] + R[i];
    side[i] = L[i] - R[i];
  }
  const filt = (x) => {
    let y = x;
    if (lo > 0) {
      y = biquad('hp', lo, r.sr)(y);
      y = biquad('hp', lo, r.sr)(y);
    }
    if (hi < r.sr / 2) {
      y = biquad('lp', hi, r.sr)(y);
      y = biquad('lp', hi, r.sr)(y);
    }
    return y;
  };
  const pw = (x) => {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return s;
  };
  const pm = pw(filt(mid)),
    ps = pw(filt(side));
  return pm > 0 ? Math.max(-120, 10 * Math.log10(ps / pm)) : -120;
}

function metricOf(m, metric) {
  if (!m) return -120;
  if (metric.startsWith('band.')) {
    // absolute: dB of the band's energy ('band.sub+low' sums bands)
    if (!m.bands) return -120;
    const p = metric
      .slice(5)
      .split('+')
      .reduce((a, b) => {
        if (!(b in m.bands)) throw new Error(`unknown band "${b}"`);
        return a + Math.pow(10, m.bands[b] / 10);
      }, 0);
    return m.rms + 10 * Math.log10(p);
  }
  if (metric.startsWith('bandRel.')) return m.bands ? m.bands[metric.slice(8)] : -120; // relative to the whole spectrum
  if (metric.startsWith('side.')) {
    const [lo, hi] = metric.slice(5).split('-').map(Number);
    return bandSide(m, lo, hi);
  }
  if (!(metric in m)) throw new Error(`unknown metric "${metric}"`);
  return m[metric];
}

/* ============================================================================================== notes */
// Notes on some tracks as absolute beats: { tracks: [names] | 'new', from?, to?, pitches? }. Notes past a clip's end
// don't sound and aren't counted; durations stop at the clip's end.
function notesOf(ctx, song, sel = {}) {
  const ids =
    sel.tracks == null
      ? song.tracks.map((t) => t.id)
      : sel.tracks === 'new'
        ? newTracks(ctx, song).map((t) => t.id)
        : (() => {
            try {
              return trackIds(ctx, song, sel.tracks);
            } catch {
              return [];
            }
          })();
  const out = [];
  for (const t of song.tracks) {
    if (!ids.includes(t.id)) continue;
    for (const c of t.clips) {
      if (c.kind !== 'notes') continue;
      for (const n of c.notes) {
        if (n.t >= c.length - 1e-9) continue;
        const at = c.start + n.t;
        if (sel.from != null && at < sel.from - 1e-6) continue;
        if (sel.to != null && at >= sel.to - 1e-6) continue;
        if (sel.pitches && !sel.pitches.includes(n.p)) continue;
        out.push({ p: n.p, t: at, d: Math.min(n.d, c.length - n.t), v: n.v, track: t.id, clip: c.id, id: n.id });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t || a.p - b.p);
}
const soundingAt = (notes, x) => notes.filter((n) => n.t <= x + 1e-6 && n.t + n.d > x + 1e-6);
const sameNote = (a, b, dp = 0) =>
  a.track === b.track &&
  a.p + dp === b.p &&
  Math.abs(a.t - b.t) < 1e-3 &&
  Math.abs(a.d - b.d) < 1e-3 &&
  Math.abs(a.v - b.v) < 1e-3;

// Swing: how late the odd sixteenths sit, as a fraction of a sixteenth; jitter: how far every note sits from the
// grid swung by `swing` (RMS, beats).
function grooveOf(notes, grid, swing) {
  let late = 0,
    odd = 0,
    sq = 0;
  for (const n of notes) {
    const k = Math.round(n.t / grid),
      off = n.t - k * grid;
    if (k % 2) {
      late += off;
      odd++;
    }
    const dev = n.t - (k * grid + (k % 2 ? swing * grid : 0));
    sq += dev * dev;
  }
  return { swing: odd ? late / odd / grid : 0, jitter: notes.length ? Math.sqrt(sq / notes.length) : Infinity };
}

/* ============================================================================================== probes */
// A probe song: one track built from the task's track (its inserts on a test source, or its instrument alone),
// playing `notes` at `tempo`. Master inserts are left out: the device is measured, not the mix.
function probeSong(ctx, song, { track, use, source, notes, tempo }) {
  const [id] = trackIds(ctx, song, [track]);
  const t = song.tracks.find((x) => x.id === id);
  const pt = {
    id: t.id,
    name: t.name,
    kind: 'instrument',
    gain: 0,
    pan: 0,
    mute: false,
    solo: false,
    arm: false,
    by: 'overdub',
    instrument: use === 'instrument' ? clone(t.instrument) : { device: source, params: {} },
    inserts: use === 'inserts' ? clone(t.inserts) : [],
    clips: [
      {
        id: 'c_probe1',
        kind: 'notes',
        start: 0,
        length: 64,
        by: 'overdub',
        notes: notes.map((n, i) => ({ id: 'n' + (i + 1), v: 1, ...n })),
      },
    ],
  };
  if (use === 'instrument' && !pt.instrument) throw new Error(`track "${track}" has no instrument`);
  return {
    ...clone(song),
    tempo: tempo || song.tempo,
    tracks: [pt],
    master: { gain: 0, inserts: [] },
    devices: { ...clone(song.devices || {}), ...PROBE_DEVICES },
  };
}
// Peak level per 1 ms frame, both channels.
function envelope(r, ms = 1) {
  const fl = Math.max(1, Math.round((r.sr * ms) / 1000)),
    nf = Math.ceil(r.length / fl),
    e = new Float64Array(nf);
  for (const ch of r.channels)
    for (let f = 0; f < nf; f++) {
      let m = e[f];
      for (let i = f * fl, end = Math.min(r.length, i + fl); i < end; i++) {
        const a = Math.abs(ch[i]);
        if (a > m) m = a;
      }
      e[f] = m;
    }
  return { e, ms };
}
const argmax = (e, a, b) => {
  let k = a,
    m = -1;
  for (let i = Math.max(0, a); i < Math.min(e.length, b); i++)
    if (e[i] > m) {
      m = e[i];
      k = i;
    }
  return { i: k, v: Math.max(0, m) };
};

// Echoes: a click through the track's inserts. The dry hit, then the loudest thing 40 ms - 2 s after it (the first
// repeat, for any feedback under 1): its delay in ms and its level against the dry hit.
function echoProbe(ctx, song, spec, tempo) {
  const r = render(
    ctx,
    probeSong(ctx, song, {
      track: spec.track,
      use: 'inserts',
      source: 'bench.click',
      notes: [{ p: 72, t: 0, d: 0.1 }],
      tempo,
    }),
    { from: 0, to: 8, tail: 1 },
  );
  const { e } = envelope(r);
  let top = 0;
  for (const v of e) top = Math.max(top, v);
  if (!(top > 1e-6)) return { delayMs: NaN, levelDb: -120, dryDb: -120 };
  let on = 0;
  while (on < e.length && e[on] < top * 1e-3) on++;
  const dry = argmax(e, on, on + 20),
    echo = argmax(e, dry.i + 40, dry.i + 2000);
  return { delayMs: echo.i - dry.i, levelDb: dB(echo.v) - dB(dry.v), dryDb: dB(dry.v) };
}
function bypassClick(ctx, song, spec) {
  const p = probeSong(ctx, song, {
    track: spec.track,
    use: 'inserts',
    source: 'bench.click',
    notes: [{ p: 72, t: 0, d: 0.1 }],
  });
  p.tracks[0].inserts = [];
  const { e } = envelope(render(ctx, p, { from: 0, to: 4, tail: 0.5 }));
  return dB(argmax(e, 0, e.length).v);
}

// Decay: each probe note on the track's instrument alone, 4 s apart at 120 bpm. For each: the peak, and the time from
// its onset until it last rises above `threshold` dBFS. The slowest note is the answer.
function decayProbe(ctx, song, spec) {
  const notes = spec.notes.map((n, i) => ({ p: n.p, d: n.d, v: n.v ?? 0.8, t: i * 8 }));
  const r = render(ctx, probeSong(ctx, song, { track: spec.track, use: 'instrument', notes, tempo: 120 }), {
    from: 0,
    to: notes.length * 8,
    tail: 0.5,
  });
  const { e } = envelope(r, 10);
  const th = Math.pow(10, (spec.threshold ?? -60) / 20);
  let worst = 0,
    quietest = 0,
    loudest = -120;
  notes.forEach((n, i) => {
    const a = i * 400,
      b = a + 400; // 4 s windows of 10 ms frames
    const pk = argmax(e, a, b);
    let on = a;
    while (on < b && e[on] < pk.v * 0.01) on++;
    let last = on;
    for (let f = on; f < b; f++) if (e[f] > th) last = f;
    const secs = last >= b - 1 ? 4 : (last - on + 1) / 100;
    worst = Math.max(worst, secs);
    loudest = Math.max(loudest, dB(pk.v));
    quietest = i === 0 ? dB(pk.v) : Math.min(quietest, dB(pk.v));
  });
  return { decay: worst, quietest, loudest };
}

// Response: test tones through the track's inserts, against the same tones with nothing in the way (RMS of a steady
// 0.5 s in the middle of each 1 s tone).
function toneProbe(ctx, song, spec) {
  const tones = spec.tones.map((x, i) => ({ p: x.midi, t: i * 4, d: 2 }));
  const p = probeSong(ctx, song, { track: spec.track, use: 'inserts', source: 'bench.sine', notes: tones, tempo: 120 });
  const dry = clone(p);
  dry.tracks[0].inserts = [];
  const rms = (r, i) => {
    const a = Math.round((i * 2 + 0.4) * r.sr),
      b = Math.round((i * 2 + 0.9) * r.sr);
    let s = 0;
    for (const ch of r.channels) for (let k = a; k < b; k++) s += ch[k] * ch[k];
    return dB(Math.sqrt(s / (2 * (b - a))));
  };
  const wet = render(ctx, p, { from: 0, to: tones.length * 4, tail: 0.5 }),
    ref = render(ctx, dry, { from: 0, to: tones.length * 4, tail: 0.5 });
  return spec.tones.map((x, i) => rms(wet, i) - rms(ref, i));
}

/* ============================================================================================== checks */
// Each kind: (ctx, final song, check spec) -> value. ctx.start is the starting song.
const KINDS = {
  // a number off measure(): metric over scope, minus another scope's (or the max over several tracks), relative to
  // the starting song if `relative`
  measure(ctx, song, c) {
    const one = (s) => {
      let v = metricOf(scopeMeasure(ctx, s, c.scope), c.metric);
      if (c.minus) {
        const metric = c.minus.metric || c.metric;
        if (c.minus.each) {
          const ids = trackIds(ctx, s, c.minus.scope.tracks);
          v -= Math.max(...ids.map((id) => metricOf(scopeMeasure(ctx, s, { ...c.minus.scope, tracks: [id] }), metric)));
        } else v -= metricOf(scopeMeasure(ctx, s, c.minus.scope), metric);
      }
      return v;
    };
    return c.relative ? one(song) - one(ctx.start) : one(song);
  },
  // the key measure() hears (chroma, Krumhansl): 1 if it is `expect` (or its relative, with relative: true)
  key(ctx, song, c) {
    const k = scopeMeasure(ctx, song, c.scope).key;
    if (!k) return 0;
    const want = parsePc(c.expect.root),
      got = parsePc(k.root);
    if (got === want && k.scale === c.expect.scale) return 1;
    if (c.relative) {
      const rel =
        c.expect.scale === 'minor' ? { pc: (want + 3) % 12, scale: 'major' } : { pc: (want + 9) % 12, scale: 'minor' };
      if (got === rel.pc && k.scale === rel.scale) return 1;
    }
    return 0;
  },
  count: (ctx, song, c) => notesOf(ctx, song, c.sel).length,
  // the share of notes in the song's key (the starting song's, or c.key)
  inKey(ctx, song, c) {
    const notes = notesOf(ctx, song, c.sel);
    if (!notes.length) return 0;
    const pcs = scalePcs(c.key || ctx.start.key);
    return notes.filter((n) => pcs.includes(pcOf(n.p))).length / notes.length;
  },
  // highest minus lowest pitch (semitones)
  span(ctx, song, c) {
    const ps = notesOf(ctx, song, c.sel).map((n) => n.p);
    return ps.length ? Math.max(...ps) - Math.min(...ps) : Infinity;
  },
  // the share of notes between lo and hi (MIDI)
  within(ctx, song, c) {
    const notes = notesOf(ctx, song, c.sel);
    return notes.length ? notes.filter((n) => n.p >= c.lo && n.p <= c.hi).length / notes.length : 0;
  },
  // strong beats (beats 1 and 3 of each bar) where sel and against sound a semitone apart (or a major 7th, or a
  // minor 9th...) at once
  clashes(ctx, song, c) {
    const a = notesOf(ctx, song, c.sel),
      b = notesOf(ctx, song, c.against);
    if (!a.length) return Infinity;
    const from = c.sel.from ?? 0,
      to = c.sel.to ?? songEnd(song);
    let n = 0;
    for (let x = Math.ceil(from / 2) * 2; x < to; x += 2) {
      const sa = soundingAt(a, x),
        sb = soundingAt(b, x);
      if (sa.some((p) => sb.some((q) => [1, 11].includes((((p.p - q.p) % 12) + 12) % 12)))) n++;
    }
    return n;
  },
  // the share of sel's notes that double `against` (same start, same pitch class): a counter-melody is its own line
  doubling(ctx, song, c) {
    const a = notesOf(ctx, song, c.sel),
      b = notesOf(ctx, song, c.against);
    if (!a.length) return 1;
    return a.filter((n) => b.some((m) => Math.abs(m.t - n.t) < 0.02 && pcOf(m.p) === pcOf(n.p))).length / a.length;
  },
  // the share of the starting song's notes in sel still exactly there (moved, added or removed notes all count)
  unchanged(ctx, song, c) {
    const was = notesOf(ctx, ctx.start, c.sel),
      now = notesOf(ctx, song, c.sel);
    if (!was.length && !now.length) return 1;
    return was.filter((n) => now.some((m) => sameNote(n, m))).length / Math.max(was.length, now.length);
  },
  // the share of the starting song's notes in sel now `semitones` away, at the same time and length
  transposed(ctx, song, c) {
    const was = notesOf(ctx, ctx.start, c.sel),
      now = notesOf(ctx, song, c.sel);
    if (!was.length) return 0;
    return was.filter((n) => now.some((m) => sameNote(n, m, c.semitones))).length / Math.max(was.length, now.length);
  },
  // the share of bars whose downbeat has a note on the chord's root (chords: one symbol per bar, repeating)
  roots(ctx, song, c) {
    const notes = notesOf(ctx, song, c.sel);
    const [b0, b1] = c.bars;
    let hit = 0;
    for (let bar = b0; bar < b1; bar++) {
      const root = pcOf(chordPitches(c.chords[(bar - b0) % c.chords.length])[0]);
      if (notes.some((n) => Math.abs(n.t - bar * 4) < 0.02 && pcOf(n.p) === root)) hit++;
    }
    return hit / (b1 - b0);
  },
  // the share of (bar, position) pairs with a hit: positions are beats within the bar
  pattern(ctx, song, c) {
    const notes = notesOf(ctx, song, c.sel);
    const [b0, b1] = c.bars;
    let hit = 0,
      all = 0;
    for (let bar = b0; bar < b1; bar++)
      for (const at of c.at) {
        all++;
        if (notes.some((n) => Math.abs(n.t - (bar * 4 + at)) < (c.tolerance ?? 0.03))) hit++;
      }
    return hit / all;
  },
  // 1 if bar b's notes differ from bar a's (positions within the bar and pitches), else 0
  differs(ctx, song, c) {
    const sig = (bar) =>
      notesOf(ctx, song, { ...c.sel, from: bar * 4, to: bar * 4 + 4 })
        .map((n) => `${n.p}@${(n.t - bar * 4).toFixed(2)}`)
        .sort()
        .join(' ');
    const a = sig(c.a),
      b = sig(c.b);
    return a && b && a !== b ? 1 : 0;
  },
  // the share of bars with a chord under the melody: at least `voices` pitch classes sounding at the downbeat and held
  // for `hold` beats, all in key, one of them the melody's note at that downbeat
  chordsUnder(ctx, song, c) {
    const notes = notesOf(ctx, song, c.sel),
      mel = notesOf(ctx, song, c.melody),
      pcs = scalePcs(ctx.start.key);
    const [b0, b1] = c.bars;
    let ok = 0;
    for (let bar = b0; bar < b1; bar++) {
      const x = bar * 4;
      const held = soundingAt(notes, x + 0.05).filter((n) => n.t + n.d >= x + (c.hold ?? 2) - 1e-6);
      const set = new Set(held.map((n) => pcOf(n.p)));
      const top = soundingAt(mel, x + 0.05).map((n) => pcOf(n.p));
      if (
        set.size >= (c.voices ?? 3) &&
        [...set].every((p) => pcs.includes(p)) &&
        (!top.length || top.some((p) => set.has(p)))
      )
        ok++;
    }
    return ok / (b1 - b0);
  },
  // how much the groove's swing moved, as a share of the starting swing
  swing(ctx, song, c) {
    const s0 = grooveOf(notesOf(ctx, ctx.start, c.sel), c.grid, 0).swing,
      s1 = grooveOf(notesOf(ctx, song, c.sel), c.grid, 0).swing;
    return s0 ? Math.abs(s1 - s0) / Math.abs(s0) : Math.abs(s1);
  },
  // RMS distance (beats) of every note from the grid, swung the way the starting groove swings
  jitter(ctx, song, c) {
    const s0 = grooveOf(notesOf(ctx, ctx.start, c.sel), c.grid, 0).swing;
    return grooveOf(notesOf(ctx, song, c.sel), c.grid, s0).jitter;
  },
  // 1 if the track's instrument (deviceKind 'instrument') or one of its inserts is a device written in this song
  // since the start (a new id, or a new version of one)
  defined(ctx, song, c) {
    const [id] = trackIds(ctx, song, [c.track]);
    const t = song.tracks.find((x) => x.id === id);
    const fresh = (dev) => {
      const d = song.devices?.[dev],
        s = ctx.start.devices?.[dev];
      return !!d && typeof d.kernel === 'string' && d.kind === c.deviceKind && (!s || s.kernel !== d.kernel);
    };
    if (c.deviceKind === 'instrument') return t.instrument && fresh(t.instrument.device) ? 1 : 0;
    return t.inserts.some((x) => x.on !== false && fresh(x.device)) ? 1 : 0;
  },
  // the first echo's delay, in ms off the tempo's value of `beats` (worst over `tempos`)
  echoTime(ctx, song, c) {
    let worst = 0;
    for (const tempo of c.tempos) {
      const want = (c.beats * 60000) / tempo,
        got = echoProbe(ctx, song, c, tempo).delayMs;
      worst = Math.max(worst, Number.isFinite(got) ? Math.abs(got - want) : Infinity);
    }
    return worst;
  },
  // the first echo's level against the dry hit (dB; the loudest over `tempos`)
  echoLevel(ctx, song, c) {
    return Math.max(...c.tempos.map((tempo) => echoProbe(ctx, song, c, tempo).levelDb));
  },
  // the dry hit's level through the inserts against no inserts at all (dB)
  dryKept(ctx, song, c) {
    return echoProbe(ctx, song, c, c.tempos[0]).dryDb - bypassClick(ctx, song, c);
  },
  decayTime: (ctx, song, c) => decayProbe(ctx, song, c).decay,
  decayPeak: (ctx, song, c) => {
    const d = decayProbe(ctx, song, c);
    return c.which === 'loudest' ? d.loudest : d.quietest;
  },
  // a test tone's gain through the inserts (dB): tones[c.tone]
  toneGain: (ctx, song, c) => toneProbe(ctx, song, c)[c.tone],
};
export const CHECK_KINDS = Object.keys(KINDS);

export function band(value, target, soft) {
  if (!Number.isFinite(value)) return 0;
  const lo = target[0] ?? -Infinity,
    hi = target[1] ?? Infinity;
  if (value >= lo && value <= hi) return 1;
  const d = value < lo ? lo - value : value - hi;
  return soft > 0 ? Math.max(0, 1 - d / soft) : 0;
}

/* ============================================================================================== score */
// Score a task's final song. opts.cache = false renders everything afresh, sharing nothing with earlier scores (the
// determinism check uses it); within one score each distinct render still happens once.
export function scoreTask(task, finalSong, { cache = true, start = null } = {}) {
  const start0 = start || startSong(task);
  const song = stableIds(cleanProject(clone(finalSong)), start0);
  const warnings = [];
  let unclean = 0;
  const seen = new Set();
  const ctx = {
    start: start0,
    memo: cache ? renders : new Map(),
    note(r) {
      if (r.nan) unclean++;
      for (const w of r.warnings) {
        if (w.kind === 'error' || w.kind === 'fault') unclean++;
        if (w.kind === 'id') continue;
        if (!seen.has(w.message)) {
          seen.add(w.message);
          warnings.push(w.message);
        }
      }
    },
  };
  const checks = [];
  for (const c of task.checks) {
    let value,
      error = null;
    try {
      value = KINDS[c.kind](ctx, song, c);
    } catch (e) {
      value = NaN;
      error = e.message;
    }
    const s = band(value, c.target, c.soft);
    checks.push({
      id: c.id,
      label: c.label,
      kind: c.kind,
      value: r3(value),
      unit: c.unit || '',
      target: c.target,
      soft: c.soft ?? 0,
      weight: c.gate ? 0 : (c.weight ?? 1),
      gate: !!c.gate,
      score: r3(s),
      ...(error ? { error } : {}),
    });
  }
  // the house gate: everything the scorer rendered rendered clean (no NaN, no device that failed to build or faulted)
  checks.push({
    id: 'clean',
    label: 'renders clean (no NaN, no failed or faulting device)',
    kind: 'clean',
    value: unclean,
    unit: 'problems',
    target: [0, 0],
    soft: 0,
    weight: 0,
    gate: true,
    score: unclean ? 0 : 1,
  });
  const weighted = checks.filter((c) => !c.gate);
  const W = weighted.reduce((a, c) => a + c.weight, 0);
  const mean = W ? weighted.reduce((a, c) => a + c.weight * c.score, 0) / W : 1;
  const gates = checks.filter((c) => c.gate).reduce((a, c) => a * c.score, 1);
  return {
    bench: BENCH,
    task: task.id,
    family: task.family,
    title: task.title,
    score: r3(mean * gates),
    mean: r3(mean),
    gates: r3(gates),
    checks,
    warnings,
  };
}

// One line per check, for people.
export function report(s) {
  const lines = [`${s.task}  ${s.score.toFixed(3)}  (${s.title})`];
  for (const c of s.checks) {
    const t = `[${c.target.map((x) => (x == null ? '…' : x)).join(', ')}]`;
    lines.push(
      `  ${c.score.toFixed(2)} ${c.gate ? 'gate' : 'w' + c.weight}  ${c.label}: ${c.value}${c.unit ? ' ' + c.unit : ''} (want ${t}${c.soft ? ' ±' + c.soft : ''})${c.error ? '  ! ' + c.error : ''}`,
    );
  }
  for (const w of s.warnings) lines.push('  warning: ' + w);
  return lines.join('\n');
}
