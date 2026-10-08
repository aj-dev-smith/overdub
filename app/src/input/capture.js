// Never lose an idea. Capture is ALWAYS on and retroactive: every note played on a MIDI keyboard or the computer keys
// is kept (you never press record first), split into phrases by silence, and every hum, tap, beatbox and audio take
// lands here too. Phrases live in memory and in IndexedDB ('overdub-capture'), so a reload doesn't lose them.
// "Keep" turns one into a clip, by 'you'; the agent's get_capture tool reads latest().
//
//   capture.noteOn(src, p, v, { track }) / noteOff(src, p)     the performance stream (midi.js, qwerty.js)
//   capture.add(entry) -> phrase                                 a finished take (hum.js, tap.js, audioin.js)
//   capture.update(id, patch) ; capture.hide(id) (still kept)    capture.get(id)
//   capture.latest({ kind?, src? }) ; capture.list({ since?, all? })   newest first; list() is the last 30 minutes
//   capture.phraseNotes(id, { grid? }) -> { notes, text, grid?, tempo, tempoGuess, bars, beat, kind, src }
//   capture.keep(id, { track?, newTrack?: { device?, name? }, at?, tempo?, join?, label? }) -> { ok, track, clip } | { ok: false, error }
//                                                           a new track's name and first instrument come from
//                                                           core/sounds.js newPartFor (Melody, Keys, Drums); the track
//                                                           it lands on is selected and is that kind's aim from then on
//                                                           (recorder.took)
//     tempo: the song's tempo set in the same step (a free take on a song with nothing in it: the tempo you played);
//     join: a transaction the keep is one undo step with (store.dispatch join: the track made for the take)
//   capture.live() -> the phrase being played now (ghost notes) or null ; capture.on('change', fn) -> off
//
// A phrase: { id, src: 'midi'|'qwerty'|'hum'|'tap'|'beatbox'|'rec', kind: 'notes'|'drums'|'audio', at (epoch ms),
//   label, notes: [{ p, t, d, v }] (beats from the phrase's start), tempo (the song's when captured), tempoGuess,
//   beat (the song beat it starts on when played along with the song, else null), track, audio (asset id), key,
//   moved, low, grid, kept: [{ track, clip, at }] }; a pass of a take recorded with R (input/recorder.js) also has
//   { take (its take group), pass (0-based), rec: true }: it is in the song already. A phrase from the performance stream
//   whose every note went into a take recorded with R is that take's copy: { inTake, hidden: true } (kept, not listed).
//
// Pure helpers (Node too), shared with the recorder:
//   placePhrase(notes, { bpb, spb }) -> { beat, notes }   where notes played along with the song sit in it (closeCur)
//   passOf(g, span) -> { pass, beat, from, to, g0, g1 }  where a moment on the transport's unwrapped grid falls in a
//                                                         recording: its loop pass and song beat
//   passGrid(n, span) -> [g0, g1)                         the grid a pass covers

import { formatNotes, formatGrid, beatsPerBar, quantize } from '../core/music.js';
import { guessTempo } from './hum.js';
import { newPartFor } from '../core/sounds.js';

// Where notes played along with the song sit in it (each { t: seconds from the first, d, b: song beat at note-on,
// be: at note-off, g / ge: the same on the engine's unwrapped grid }): from the bar the first one started in. Where each
// note falls is measured on the unwrapped grid: after a loop wrap the song beat jumps back to loop.start but the grid
// doesn't, so a phrase played across the wrap keeps every note, in the order played. Without the grid, from the song
// beats; if those run backwards (a wrap, a seek), from the seconds at the song's tempo. Every note played is kept,
// whichever way it's measured. -> { beat, notes: [{ p, t, d, v }] } (t, d in beats from `beat`)
export function placePhrase(notes, { bpb = 4, spb = 0.5 } = {}) {
  const fin = (x) => typeof x === 'number' && Number.isFinite(x),
    r4 = (x) => Math.round(x * 10000) / 10000;
  const f = notes[0];
  const beat = Math.max(0, Math.floor((f.b + 0.1) / bpb) * bpb);
  const lead = f.b - beat; // (a hair early on the downbeat is a little negative: it lands on the bar)
  const ways = [
    notes.every((n) => fin(n.g)) && ((n) => [n.g - f.g, fin(n.ge) && n.ge > n.g ? n.ge - n.g : n.d / spb]),
    (n) => [n.b - f.b, n.be != null && n.be > n.b ? n.be - n.b : n.d / spb],
    (n) => [(n.t - f.t) / spb, n.d / spb],
  ].filter(Boolean);
  const at = ways.find((w) => notes.every((n) => lead + w(n)[0] > -0.11)) || ways[ways.length - 1];
  return {
    beat,
    notes: notes.map((n) => {
      const [t, d] = at(n);
      return { p: n.p, t: r4(Math.max(0, lead + t)), d: r4(Math.max(1 / 32, d)), v: r4(n.v) };
    }),
  };
}

// A recording's passes. span: { g0, b0 } (the grid and song beat recording starts at) and, while it records in a loop,
// loop: { start, end } with wrap: the grid of the first wrap after g0 (g0 + loop.end - b0). Pass 0 runs from g0 to the
// first wrap (to the stop, loop off); pass n >= 1 is the loop's n-th time round, song beats [loop.start, loop.end).
export function passOf(g, span) {
  const lp = span.loop;
  if (!lp || g < span.wrap - 1e-9)
    return {
      pass: 0,
      beat: span.b0 + (g - span.g0),
      from: span.b0,
      to: lp ? lp.end : Infinity,
      g0: span.g0,
      g1: lp ? span.wrap : Infinity,
    };
  const len = lp.end - lp.start,
    k = Math.max(0, Math.floor((g - span.wrap) / len + 1e-9)),
    g0 = span.wrap + k * len;
  return { pass: k + 1, beat: lp.start + (g - g0), from: lp.start, to: lp.end, g0, g1: g0 + len };
}
export function passGrid(n, span) {
  const lp = span.loop;
  if (!n) return [span.g0, lp ? span.wrap : Infinity];
  const len = lp.end - lp.start,
    g0 = span.wrap + (n - 1) * len;
  return [g0, g0 + len];
}

const DB = 'overdub-capture',
  STORE = 'phrases',
  WINDOW_MS = 30 * 60 * 1000,
  KEEP_MAX = 400,
  GAP = 2.5;
const SRC_LABEL = {
  midi: 'Played',
  qwerty: 'Typed',
  touch: 'Played',
  hum: 'Hummed',
  tap: 'Tapped',
  beatbox: 'Beatboxed',
  rec: 'Recorded',
};

function openDB() {
  return new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => {
        if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch {
      res(null);
    }
  });
}

export function createCapture(app, input) {
  const store = app.store;
  const phrases = []; // oldest first
  const fns = new Set();
  let seq = 0,
    cur = null,
    closeT = 0,
    dbP = openDB();
  const emit = (what, ph) => {
    for (const fn of fns) {
      try {
        fn({ what, phrase: ph });
      } catch (e) {
        console.error('capture listener', e);
      }
    }
    input.emit('capture', { what, phrase: ph });
  };
  const newId = () => 'cap_' + Date.now().toString(36) + (++seq).toString(36);
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const timeLabel = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  async function persist(ph) {
    const db = await dbP;
    if (!db) return;
    try {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(JSON.parse(JSON.stringify(ph)));
    } catch {
      /* quota: memory still has it */
    }
  }
  async function prune() {
    const db = await dbP;
    if (!db || phrases.length <= KEEP_MAX) return;
    const drop = phrases.slice(0, phrases.length - KEEP_MAX).filter((p) => !(p.kept && p.kept.length));
    try {
      const t = db.transaction(STORE, 'readwrite');
      for (const p of drop) t.objectStore(STORE).delete(p.id);
    } catch {
      /* ok */
    }
  }
  // load what earlier sessions kept
  const loaded = dbP.then(
    (db) =>
      new Promise((res) => {
        if (!db) return res();
        try {
          const rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
          rq.onsuccess = () => {
            const have = new Set(phrases.map((p) => p.id));
            for (const p of rq.result || []) if (!have.has(p.id)) phrases.push(p);
            phrases.sort((a, b) => a.at - b.at);
            emit('load', null);
            res();
          };
          rq.onerror = () => res();
        } catch {
          res();
        }
      }),
  );

  function finish(ph) {
    ph.label = ph.label || `${SRC_LABEL[ph.src] || 'Idea'} ${timeLabel(ph.at)}`;
    ph.kept = ph.kept || [];
    phrases.push(ph);
    persist(ph);
    prune();
    emit('add', ph);
    return ph;
  }

  /* ---- the performance stream: phrases by silence */
  function closeCur() {
    clearTimeout(closeT);
    const c = cur;
    cur = null;
    if (!c) return null;
    const on = c.playing && app.engine.playing;
    for (const [p, h] of c.held)
      c.notes.push({
        p,
        t: h.t,
        d: Math.max(0.05, now() - c.t0 - h.t),
        v: h.v,
        b: h.b,
        be: on ? app.engine.beat : null,
        g: h.g,
        ge: on ? gridOf(app.engine) : null,
        tk: h.tk,
      });
    c.held.clear();
    if (!c.notes.length) return null;
    // every note of it went into one take recorded with R: the take's passes are here already (rec: true, in the song),
    // so this copy is kept but not listed (hidden), never a second card offering to put it in the song
    const tk = c.notes[0].tk;
    const inTake = !!tk && c.notes.every((n) => n.tk === tk);
    const p = store.get(),
      spb = 60 / p.tempo,
      bpb = beatsPerBar(p.meter);
    c.notes.sort((a, b) => a.t - b.t);
    const onsets = c.notes.map((n) => n.t);
    const ph = {
      id: c.id,
      src: c.src,
      kind: 'notes',
      at: c.at,
      track: c.track,
      tempo: p.tempo,
      tempoGuess: guessTempo(onsets, p.tempo),
      beat: null,
      secs: c.notes.map((n) => ({ p: n.p, t: r4(n.t), d: r4(n.d), v: r4(n.v) })),
      ...(inTake ? { inTake: tk, hidden: true } : {}),
    };
    if (c.notes.every((n) => n.b != null)) {
      // played along with the song: the notes stay where they were in the song (placePhrase)
      const pl = placePhrase(c.notes, { bpb, spb });
      ph.beat = pl.beat;
      ph.notes = pl.notes;
    } else {
      // free time: at the song's tempo, from the first note (your timing kept; quantise when you keep it if you like)
      const t0 = c.notes[0].t;
      ph.notes = c.notes.map((n) => ({
        p: n.p,
        t: r4((n.t - t0) / spb),
        d: r4(Math.max(1 / 32, n.d / spb)),
        v: r4(n.v),
      }));
    }
    return finish(ph);
  }
  const now = () => performance.now() / 1000;
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const gridOf = (eng) => (fin(eng.gridBeat) ? eng.gridBeat : null); // (engine.gridBeat: the unwrapped playhead)
  function arm() {
    clearTimeout(closeT);
    if (cur && !cur.held.size) closeT = setTimeout(closeCur, GAP * 1000);
  }

  const capture = {
    get phrases() {
      return phrases;
    },
    loaded,
    on(t, fn) {
      if (typeof t === 'function') {
        fn = t;
      }
      fns.add(fn);
      return () => fns.delete(fn);
    },
    noteOn(src, p, v = 0.8, { track = null } = {}) {
      const t = now(),
        eng = app.engine;
      if (cur && cur.src !== src) closeCur();
      if (!cur)
        cur = { id: newId(), src, at: Date.now(), t0: t, notes: [], held: new Map(), track, playing: !!eng.playing };
      if (cur.held.has(p)) capture.noteOff(src, p);
      const on = cur.playing && eng.playing;
      // (tk: the take recorded with R this note goes into, if one does: input/recorder.js takeNow)
      let tk = null;
      try {
        tk = track ? input.recorder?.takeNow?.() || null : null;
      } catch {
        tk = null;
      }
      cur.held.set(p, { t: t - cur.t0, v, b: on ? eng.beat : null, g: on ? gridOf(eng) : null, tk });
      clearTimeout(closeT);
      emit('live', cur);
    },
    noteOff(src, p) {
      if (!cur || cur.src !== src) return;
      const h = cur.held.get(p);
      if (!h) return;
      cur.held.delete(p);
      const eng = app.engine;
      const on = h.b != null && eng.playing;
      cur.notes.push({
        p,
        t: h.t,
        d: Math.max(0.03, now() - cur.t0 - h.t),
        v: h.v,
        b: h.b,
        be: on ? eng.beat : null,
        g: h.g,
        ge: on ? gridOf(eng) : null,
        tk: h.tk,
      });
      arm();
      emit('live', cur);
    },
    // the phrase being played now, in seconds from its first note (ghost notes); null when nothing is going on
    live() {
      if (!cur) return null;
      const t = now() - cur.t0;
      return {
        id: cur.id,
        src: cur.src,
        at: cur.at,
        notes: [
          ...cur.notes,
          ...[...cur.held].map(([p, h]) => ({ p, t: h.t, d: Math.max(0.03, t - h.t), v: h.v, held: true })),
        ],
        now: t,
      };
    },
    flush: () => closeCur(),

    add(entry) {
      // (a pass of a take recorded with R lands at each time round the loop: the phrase being played runs on, so it
      // isn't cut there into two)
      if ((entry.src === 'midi' || entry.src === 'qwerty') && !entry.rec) closeCur();
      const ph = { id: newId(), at: Date.now(), beat: null, track: null, ...entry };
      ph.notes = (ph.notes || []).map((n) => ({ ...n, t: r4(n.t), d: r4(n.d) }));
      return finish(ph);
    },
    update(id, patch) {
      const ph = capture.get(id);
      if (!ph) return null;
      Object.assign(ph, patch);
      persist(ph);
      emit('update', ph);
      return ph;
    },
    hide(id) {
      return capture.update(id, { hidden: true });
    },
    get: (id) => phrases.find((p) => p.id === id) || null,
    latest({ kind = null, src = null } = {}) {
      for (let i = phrases.length - 1; i >= 0; i--) {
        const p = phrases[i];
        if (!p.hidden && (!kind || p.kind === kind) && (!src || p.src === src)) return capture.view(p);
      }
      return null;
    },
    list({ since = Date.now() - WINDOW_MS, all = false } = {}) {
      return phrases
        .filter((p) => !p.hidden && (all || p.at >= since))
        .slice()
        .reverse();
    },
    // the agent's view of a phrase (compact; notes in the text format)
    view(p) {
      if (!p) return null;
      const pn = capture.phraseNotes(p.id);
      return {
        id: p.id,
        src: p.src,
        kind: p.kind,
        label: p.label,
        at: new Date(p.at).toISOString(),
        notes: pn.text,
        grid: pn.grid || undefined,
        count: pn.notes.length,
        bars: pn.bars,
        tempo: pn.tempo,
        tempoGuess: pn.tempoGuess,
        beat: p.beat,
        key: p.key || undefined,
        track: p.track || undefined,
        audio: p.audio || undefined,
        moved: p.moved || 0,
        unsure: p.low || 0,
        ...(p.rec ? { in_song: true, take: p.take, pass: (p.pass || 0) + 1 } : {}),
      };
    },
    // (grid: snap to it; a phrase from the keys carries its own while On the grid is on, p.snap: input/qwerty.js)
    phraseNotes(id, { grid = null } = {}) {
      const p = capture.get(id);
      if (!p) return { notes: [], text: '', tempo: store.get().tempo, bars: 0 };
      if (grid == null) grid = p.snap || 0;
      const meter = store.get().meter,
        bpb = beatsPerBar(meter);
      let notes = (p.notes || []).map(({ p: pitch, t, d, v }) => ({ p: pitch, t, d, v }));
      if (grid > 0)
        notes = notes.map((n) => {
          const t = Math.max(0, r4(quantize(n.t, grid))),
            e = Math.max(t + grid, r4(quantize(n.t + n.d, grid)));
          return { ...n, t, d: r4(e - t) };
        });
      const end = notes.length
        ? Math.max(...notes.map((n) => n.t + n.d))
        : p.seconds
          ? (p.seconds * p.tempo) / 60
          : bpb;
      const bars = Math.max(1, Math.ceil(end / bpb - 1e-6));
      const out = {
        notes,
        text: formatNotes(notes),
        tempo: p.tempo,
        tempoGuess: p.tempoGuess || p.tempo,
        bars,
        beat: p.beat,
        kind: p.kind,
        src: p.src,
      };
      if (p.kind === 'drums') out.grid = formatGrid(notes, { steps: Math.round((bars * bpb) / 0.25), step: 0.25 });
      return out;
    },

    // Put a phrase on a track as a clip, by you. track: an instrument track id; newTrack: { device, name } makes one.
    keep(id, { track = null, newTrack = null, at = null, grid = null, tempo = null, join = null, label = null } = {}) {
      const p = capture.get(id);
      if (!p) return { ok: false, error: `no captured idea "${id}"` };
      const doc = store.get(),
        bpb = beatsPerBar(doc.meter),
        spb = 60 / doc.tempo;
      const playhead = Math.max(0, Math.floor(((app.engine.beat || 0) + 1e-6) / bpb) * bpb);
      // where a take with no place of its own goes: on a track with nothing on it yet (or a new one) that's the top of
      // the song (the loop's start while the loop is on), not wherever the playhead was left; on a track with clips,
      // the bar under the playhead. A take played along with the song keeps the beat it was played on.
      const home = doc.loop?.on && Number.isFinite(+doc.loop.start) ? Math.max(0, +doc.loop.start) : 0;
      const placeOn = (tid) => {
        const t = tid && tid !== '$t' ? store.track(tid) : null;
        return !t || !t.clips.length ? home : playhead;
      };
      const name =
        p.kind === 'drums'
          ? p.src === 'beatbox'
            ? 'Beatboxed beat'
            : 'Tapped beat'
          : p.src === 'hum'
            ? 'Hummed idea'
            : p.kind === 'audio'
              ? 'Take'
              : 'Played idea';
      if (p.kind === 'audio') {
        const t = track || p.track;
        if (!t || !store.track(t)) return { ok: false, error: 'pick an audio track' };
        const r = store.dispatch(
          {
            type: 'clip.add',
            track: t,
            ref: 'c',
            clip: {
              kind: 'audio',
              asset: p.audio,
              start: at ?? p.beat ?? placeOn(t),
              length: Math.max(0.25, (p.seconds || 1) / spb),
              name,
            },
          },
          { by: 'you', label: 'keep a take' },
        );
        return r.ok ? done(p, t, r.created.c) : { ok: false, error: r.error };
      }
      const pn = capture.phraseNotes(id, { grid });
      if (!pn.notes.length) return { ok: false, error: 'that idea has no notes' };
      const length = pn.bars * bpb;
      const ops = [];
      let tid = track;
      if (newTrack || !tid) {
        const np = newPartFor(aimOf(p), doc);
        const dev = pickDevice((newTrack && newTrack.device) || np.device, p.kind);
        ops.push({
          type: 'track.add',
          ref: 't',
          track: {
            name: (newTrack && newTrack.name) || np.name,
            kind: 'instrument',
            instrument: { device: dev, params: (newTrack && dev === newTrack.device && newTrack.params) || {} },
          },
        });
        tid = '$t';
      } else {
        const t = store.track(tid);
        if (!t) return { ok: false, error: `no track "${tid}"` };
        if (t.kind !== 'instrument')
          return { ok: false, error: `${t.name} is an audio track; notes go on an instrument track` };
      }
      const start = at ?? (p.beat != null ? p.beat : placeOn(tid));
      if (Number.isFinite(tempo) && tempo > 0 && tempo !== doc.tempo)
        ops.unshift({ type: 'project.set', patch: { tempo } });
      ops.push({
        type: 'clip.add',
        track: tid,
        ref: 'c',
        clip: { kind: 'notes', start, length, name, notes: pn.notes },
      });
      const r = store.dispatch(ops, { by: 'you', label: label || `keep ${name.toLowerCase()}`, join });
      if (!r.ok) return { ok: false, error: r.error };
      return done(p, tid === '$t' ? r.created.t : tid, r.created.c);
    },
  };
  // the aim a phrase speaks for: a hum, the pads (tapped, beatboxed) or the keys
  const aimOf = (p) => (p.kind === 'drums' ? 'pads' : p.src === 'hum' ? 'hum' : 'keys');
  function done(p, track, clip) {
    p.kept = [...(p.kept || []), { track, clip, at: Date.now() }];
    persist(p);
    emit('update', p);
    const rec = input.recorder;
    try {
      if (rec?.select) rec.select({ track, clip, notes: [] });
      else app.ui?.select?.({ track, clip, notes: [] });
    } catch {
      /* ok */
    }
    try {
      if (p.kind !== 'audio') rec?.took?.(aimOf(p), track);
    } catch {
      /* ok */
    }
    try {
      app.arranger?.show?.([clip], 'you');
    } catch {
      /* no arranger (Node) */
    } // where it landed, flashed warm
    return { ok: true, track, clip };
  }
  function pickDevice(want, kind) {
    const has = (id) => {
      try {
        return !!app.devices.getDevice(id);
      } catch {
        return false;
      }
    };
    if (want && has(want)) return want;
    const prefs = kind === 'drums' ? ['core.drums'] : ['core.keys', 'core.pluck', 'core.poly'];
    return prefs.find(has) || want || prefs[0];
  }
  // leaving the page closes the phrase in progress (it is saved)
  try {
    window.addEventListener('pagehide', () => closeCur());
  } catch {
    /* node */
  }
  return capture;
}
