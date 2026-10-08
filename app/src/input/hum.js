// Hum it: sing or hum into the mic, get notes. Record, then transcribe ("repair and confirm", not a promise of perfect
// transcription): the raw pitch trace and the notes it became are both kept and shown, the notes snapped into the
// project's key are counted ("I moved 3 notes into A minor"), and notes the tracker isn't sure of are dimmed.
//
// Pure core (Node and the browser):
//   hear(samples, sr, opts)        -> { frames, segs, cost }     pYIN + Viterbi frames, then the note tracker (pitch.js);
//                                     cost: ms spent tracking, decoding and segmenting
//   transcribe(segs, opts)         -> { notes, moved, low, text, bars, key, keyGuess, tempo }   beats, ready for a clip
//       opts: { tempo, key, grid = 0.25 (0: off), snapKey = true, keepTiming = false, origin (s of beat originBeat),
//               originBeat = 0, peakDb, gentle (an eighth when near one, else a sixteenth, else as sung: a take against
//               the click), place ((seg, i) -> { t, e, tr }: the caller counted the notes, free time), clampStart = true }
//       each note also has tr: the beat it began on, as sung (before any snapping): the take's "As played"
//   A hum in free time (start({ free: true }): no click, nothing playing) is counted on its own pulse (input/timing.js
//   fitSegs): take.free = { bpm, fit, drift }, its notes on the hummer's beats, take.result.tempo the hummer's tempo.
//   hum.live() -> the notes so far, on the take's grid (Sketch draws them as they are sung), or []
//   guessKey(notes) -> { root, scale, confidence } (the root spelled the usual way: Eb minor, Db major, G# minor)
//   guessTempo(onsetsSec, prior) -> bpm
//   keyChosen(song, history?) -> bool   the song's key counts once a person set it (or it isn't a blank song's default)
//                                     or the song has a pitched part; a tapped beat says nothing about a key, so a hum
//                                     over the first minute's drums keeps the notes you sang and its key is heard from
//                                     the hum instead (take.opts.heard)
// A hum snapped into the song's key says so where it can be seen: "Moved 3 notes into C minor, the song's key." with
// Undo, which puts the notes back as sung (Snap off: the next hum keeps its notes too, until Snap is on again). A hum
// recorded into a take with R says the same once the take is in, counting the moved notes that went into it, and its
// Undo puts those back as sung in the song (one undo step of its own: the take stays), Snap off the same way.
//
// Live (browser): createHum(app, input) -> hum = { start(opts), stop(), cancel(), active, recording, trace(), segs(),
//   take, retranscribe(opts), on(type, fn) }  events: 'frame' (live pitch), 'segs' (ghost notes so far), 'take' (final).
//   start({ withSong }): play the song first, so the notes land on its beats (a playing song always counts);
//   start({ rec: true }) (H while R records): the hum is a source of the take: its notes go to the recorder on the
//   transport's unwrapped grid (each into its loop pass) instead of to capture on their own. hum.join(): a hum already
//   going when R starts becomes that take's (input/recorder.js). Sung with the song playing, the notes keep the beats
//   they were sung on (from the last reading of the playhead if it never seemed to move), never the marker's.

import { createPitchTracker, segment, median } from './pitch.js';
import { snapGentle, fitSegs } from './timing.js';
import { snapToScale, formatNotes, parsePc, beatsPerBar, keyLabel } from '../core/music.js';

export function hear(samples, sr, { hop = 0.01, win = 2048, lo = 65, hi = 1300, seg = {} } = {}) {
  const t0 = now();
  const tr = createPitchTracker({ sr, hop, win, lo, hi });
  tr.push(samples);
  const t1 = now(),
    fr = tr.decode(),
    t2 = now(),
    segs = segment(fr, seg),
    t3 = now();
  return { frames: fr, segs, cost: { track: t1 - t0, decode: t2 - t1, segment: t3 - t2, frames: fr.length } };
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function transcribe(
  segs,
  {
    tempo = 120,
    key = null,
    grid = 0.25,
    snapKey = true,
    keepTiming = false,
    origin = null,
    originBeat = 0,
    peakDb = null,
    meter = [4, 4],
    gentle = false,
    place = null,
    clampStart = true,
  } = {},
) {
  const spb = 60 / tempo;
  const o = origin ?? (segs.length ? segs[0].t0 : 0);
  const peak = peakDb ?? Math.max(-60, ...segs.map((s) => s.db));
  const g = keepTiming ? 0 : grid;
  // gentle (a take against the click, or in free time): an eighth when the note is near one, else a sixteenth when near
  // that, else as sung (input/timing.js); its end the same, a little looser
  const q = (b) => (g > 0 ? Math.round(b / g) * g : Math.round(b * 64) / 64);
  const qs = gentle && g > 0 ? (b) => snapGentle(b, { coarse: Math.max(g, 0.5), fine: g, tol: 0.35, fineTol: 0.3 }) : q;
  const qe = gentle && g > 0 ? (b) => snapGentle(b, { coarse: Math.max(g, 0.5), fine: g, tol: 0.4, fineTol: 0.5 }) : q;
  const notes = [];
  segs.forEach((s, i) => {
    // (place: where each note starts and ends, in beats, when the caller has counted them itself: free time)
    const pl = place ? place(s, i) : null;
    const tr = pl ? pl.tr : originBeat + (s.t0 - o) / spb;
    let t = pl ? pl.t : qs(tr),
      e = pl ? pl.e : qe(originBeat + (s.t1 - o) / spb);
    const minD = gentle ? 1 / 8 : g > 0 ? g : 1 / 16;
    if (e - t < minD) e = t + minD;
    const raw = Math.round(s.midi);
    const p = snapKey && key ? snapToScale(s.midi, key) : raw;
    // (clampStart false: a note sung before the take's first beat keeps its place there, so the recorder can leave it out)
    const n = {
      p,
      t: clampStart ? Math.max(0, t) : t,
      d: e - t,
      v: clamp(0.8 + (s.db - peak) / 36, 0.35, 0.95),
      conf: s.conf,
      raw: s.midi,
      cents: s.cents,
      low: s.conf < 0.45,
      seg: s,
      tr: Math.round(tr * 10000) / 10000,
    };
    if (p !== raw) n.moved = raw;
    notes.push(n);
  });
  // two notes on one grid step: the stronger keeps it, the other moves on a step if there is room (nothing is lost)
  notes.sort((a, b) => a.t - b.t);
  const out = [];
  for (const n of notes) {
    const prev = out[out.length - 1];
    if (prev && n.t <= prev.t + 1e-9) {
      const step = g > 0 ? g : 1 / 16;
      if (n.t + step < n.t + n.d - 1e-9) {
        n.d -= step;
        n.t += step;
      } else if (n.conf > prev.conf) {
        out[out.length - 1] = n;
        continue;
      } else continue;
    }
    if (prev && prev.t + prev.d > n.t) prev.d = Math.max(1 / 32, n.t - prev.t);
    // (gentle: a gap under a sixteenth between two sung notes is legato, so the first runs on to the second)
    if (gentle && prev && n.t - (prev.t + prev.d) > 0 && n.t - (prev.t + prev.d) < 0.25 - 1e-9) prev.d = n.t - prev.t;
    out.push(n);
  }
  for (const n of out) {
    n.t = r4(n.t);
    n.d = r4(n.d);
    n.v = r4(n.v);
  }
  // what was moved into the key, counted among the notes it became (a note that gave its step to a stronger one isn't
  // one of them: "13 moved" over 9 notes said more than happened)
  const moved = out.filter((n) => n.moved != null).map((n) => ({ from: n.moved, to: n.p, t: n.t }));
  const end = out.length ? Math.max(...out.map((n) => n.t + n.d)) : 0;
  const bpb = beatsPerBar(meter);
  return {
    notes: out,
    moved,
    low: out.filter((n) => n.low).length,
    text: formatNotes(out.map(({ p, t, d, v }) => ({ p, t, d, v }))),
    bars: Math.max(1, Math.ceil(end / bpb - 1e-9)),
    key,
    keyGuess: guessKey(out.map((n) => ({ p: Math.round(n.raw), d: n.d }))),
    tempo,
  };
}
const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Is the song's key one somebody meant? A blank song comes in C minor by default: snapping a first hum into that would
// move right notes into wrong ones. It counts once a person set a key (in this session's history, or any key but the
// default) or the song has a pitched part: notes on a track that isn't drums. Drum hits (the first minute's tapped
// beat) and audio say nothing about a key, so they don't count.
const drumTrack = (t) =>
  !!t && t.kind === 'instrument' && /drum|kit|beat/i.test(`${t.instrument?.device || ''} ${t.name || ''}`);
export function keyChosen(song, history = []) {
  if (!song || !song.key) return false;
  if (
    (history || []).some((x) => (x.ops || []).some((o) => o && o.type === 'project.set' && o.patch && 'key' in o.patch))
  )
    return true;
  if (!(song.key.root === 'C' && song.key.scale === 'minor')) return true;
  return (song.tracks || []).some(
    (t) =>
      t.kind === 'instrument' &&
      !drumTrack(t) &&
      (t.clips || []).some((c) => c.kind !== 'audio' && c.notes && c.notes.length),
  );
}
// The key a take is snapped and labelled with: the song's when it's chosen, else the one heard in the hum (snapped
// into only when asked: snapHeard)
const effKey = (o) => o.key || (o.snapHeard && o.heard) || null;
const heardOf = (r) => (r && r.keyGuess ? { root: r.keyGuess.root, scale: r.keyGuess.scale } : null);

/* ---------------------------------------------------------------- key and tempo guesses */
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function corr(a, b) {
  const ma = a.reduce((s, x) => s + x, 0) / 12,
    mb = b.reduce((s, x) => s + x, 0) / 12;
  let n = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db + 1e-12);
}
// Krumhansl–Schmuckler on a duration-weighted pitch-class histogram. The root is spelled the way the key is written
// (Eb minor, not D# minor; Db major, not C# major), so the notes in it are spelled from it too (music.js keySpelling).
const ROOTS = {
  major: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  minor: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
};
export function guessKey(notes) {
  const h = new Array(12).fill(0);
  for (const n of notes) h[((Math.round(n.p) % 12) + 12) % 12] += n.d || 0.25;
  if (h.every((x) => x === 0)) return null;
  let best = null;
  for (let r = 0; r < 12; r++) {
    for (const [scale, prof] of [
      ['major', KS_MAJ],
      ['minor', KS_MIN],
    ]) {
      const rot = prof.map((_, i) => prof[(i - r + 12) % 12]);
      const c = corr(h, rot);
      if (!best || c > best.confidence) best = { root: ROOTS[scale][r], scale, confidence: Math.round(c * 100) / 100 };
    }
  }
  return best;
}
// The tempo that puts the onsets nearest an eighth-note grid, near the prior (the song's tempo).
export function guessTempo(onsets, prior = 120) {
  if (onsets.length < 4) return prior;
  const t0 = onsets[0];
  let best = prior,
    be = Infinity;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const g = 30 / bpm; // an eighth, in seconds
    let e = 0;
    for (const t of onsets) {
      const x = (t - t0) / g;
      e += (x - Math.round(x)) ** 2;
    }
    e = e / onsets.length + 0.002 * Math.abs(Math.log2(bpm / prior)) * 12;
    if (e < be) {
      be = e;
      best = bpm;
    }
  }
  return best;
}

/* ---------------------------------------------------------------- live */
export function createHum(app, input) {
  const fns = new Map();
  const emit = (t, d) => {
    for (const fn of fns.get(t) || []) {
      try {
        fn(d);
      } catch (e) {
        console.error('hum listener', e);
      }
    }
  };
  let sess = null;
  const hum = {
    take: null, // the last finished take: { capture, frames, segs, result, opts, audio }
    get active() {
      return !!sess;
    },
    on(t, fn) {
      if (!fns.has(t)) fns.set(t, new Set());
      fns.get(t).add(fn);
      return () => fns.get(t).delete(fn);
    },
    trace: () => (sess ? sess.frames : hum.take ? hum.take.frames : []),
    segs: () => (sess ? sess.segs : hum.take ? hum.take.segs : []),
    get recording() {
      return !!(sess && sess.rec);
    },
    // Start listening (opens the mic if it isn't). opts: { withSong: play along so notes land on the song's beats,
    // rec: into the take the recorder is making }
    async start(opts = {}) {
      if (sess) return;
      const audio = input.audio;
      await audio.ensureOpen();
      const ctx = audio.ctx,
        sr = ctx.sampleRate;
      const tr = createPitchTracker({ sr, hop: 0.01, win: 2048, lo: 65, hi: 1300 });
      const recr = input.recorder;
      const s = (sess = {
        sr,
        tr,
        chunks: [],
        len: 0,
        frames: tr.frames,
        segs: [],
        f0: null,
        opts,
        startBeat: null,
        snap: null,
        t0: performance.now(),
        rec: !!(opts.rec && recr && recr.state !== 'idle'),
      });
      const engine = app.engine;
      if (opts.withSong && !engine.playing && !s.rec) {
        try {
          await engine.play();
        } catch (e) {
          /* silent engine */
        }
      }
      s.playing = !!engine.playing || s.rec;
      s.off = audio.listen((blk) => {
        if (sess !== s) return;
        if (s.f0 == null) s.f0 = blk.f;
        s.chunks.push(blk.d[0]);
        s.len += blk.d[0].length;
        s.tr.push(blk.d[0]);
        // a (ctx time, beat) pair once the playhead moves; in a take, the beat on the recorder's unwrapped grid (a hum
        // across a loop wrap keeps its order) and the song beat otherwise
        if (s.playing && engine.playing && !s.snap) {
          const b = engine.beat,
            pair = { ctxT: ctx.currentTime, beat: s.rec ? recr.gridNow(true) : b };
          if (s.b0 == null) s.b0 = b;
          else if (Math.abs(b - s.b0) > 0.02) s.snap = pair;
          if (Number.isFinite(pair.beat)) s.last = pair; // (if the playhead never seemed to move: the last reading)
        }
        analyse(s, false);
      });
      emit('state', { active: true });
      input.emit('hum', { active: true });
    },
    async stop() {
      const s = sess;
      if (!s) return null;
      sess = null;
      s.off && s.off();
      analyse(s, true);
      emit('state', { active: false });
      input.emit('hum', { active: false });
      return finishTake(s, concat(s.chunks, s.len));
    },
    // A recording you already have (a voice memo, a test signal): the same pipeline as a live hum
    async fromSamples(samples, sr, opts = {}) {
      const { frames: fr, segs } = hear(samples, sr);
      return finishTake({ sr, frames: fr, segs, opts, playing: false, f0: 0 }, samples);
    },
    // H, then R: the hum already going becomes a source of the take R started (placed on the take's grid from here)
    join() {
      const s = sess,
        recr = input.recorder;
      if (!s || s.rec || !recr || recr.state === 'idle') return false;
      s.rec = true;
      s.playing = true;
      s.snap = null;
      s.b0 = null;
      s.pairs = [];
      return true;
    },
    // the notes so far, on the grid the take will place them on (a take with R: the recorder's grid; along with the
    // song: its beats), each { p, t, d, low }; free time or nothing placed yet: []
    live() {
      const s = sess;
      if (!s || !s.segs.length || !(s.playing || s.rec)) return [];
      const o = takeOpts(s, { peek: true });
      if (o.originBeat == null) return [];
      try {
        return transcribe(s.segs, { ...o, key: effKey(o) }).notes.map((n) => ({
          p: n.p,
          t: n.t,
          d: n.d,
          low: n.low,
          tr: n.tr,
        }));
      } catch (e) {
        return [];
      }
    },
    cancel() {
      if (sess) {
        sess.off && sess.off();
        sess = null;
        emit('state', { active: false });
        input.emit('hum', { active: false });
      }
    },
    // the take it joined was called off in its count-in: the hum is yours again (H stops it into Sketch), in free time
    // unless the song plays on (its beats from here)
    leave() {
      const s = sess;
      if (!s || !s.rec) return false;
      s.rec = false;
      s.snap = null;
      s.last = null;
      s.b0 = null;
      s.playing = !!app.engine.playing;
      return true;
    },
  };
  async function finishTake(s, samples) {
    // nothing heard: Sketch's take line says so ("Heard nothing."); a toast when Sketch isn't on screen, or while the
    // song plays (the take line gives way to the following roll then, ui/sketch.js)
    if (!s.segs.length) {
      if (!(app.ui?.visible ? app.ui.visible('sketch') : false) || app.engine?.playing)
        app.ui?.toast?.('Heard nothing. Hum a little louder, or closer to the mic.');
      hum.take = { frames: s.frames, segs: [], result: null, opts: s.opts };
      emit('take', hum.take);
      return null;
    }
    const opts = takeOpts(s);
    // free time (nothing playing, no take): the notes are counted on the hummer's own pulse, at the hummer's own tempo
    // (the grid follows them; it used to be 16ths at a tempo nobody heard, from the first note)
    if (!s.playing && !s.rec) {
      const fit = fitSegs(s.segs);
      if (fit) {
        opts.tempo = fit.bpm;
        opts.free = { bpm: fit.bpm, fit: fit.fit, drift: fit.drift };
        opts.place = (sg, i) => ({ t: fit.starts[i], e: fit.ends[i], tr: fit.raws[i] });
      }
    }
    let result = transcribe(s.segs, { ...opts, key: effKey(opts) });
    if (!opts.key) {
      opts.heard = heardOf(result);
      if (opts.snapHeard && opts.heard) result = transcribe(s.segs, { ...opts, key: effKey(opts) });
    }
    // keep the hummed audio with the notes (A/B what you meant); IndexedDB through the engine's assets
    let audioId = null;
    try {
      audioId = 'a_hum' + Date.now().toString(36);
      await app.engine.assets.put(audioId, { sr: s.sr, channels: [samples] });
    } catch (e) {
      audioId = null;
    }
    // in a take: the notes go to the recorder, each at its grid beat (it places them in their passes), a note moved into
    // the key with what it was sung as (`was`), so the take's commit can say so and put it back (below)
    if (s.rec && opts.originBeat != null) {
      const left = [],
        recTake = input.recorder.live?.()?.take || null;
      const n = input.recorder.addNotes(
        result.notes.map((x) => ({
          p: x.p,
          v: x.v,
          g: x.t,
          d: x.d,
          conf: x.conf,
          graw: x.tr,
          ...(x.moved != null ? { was: x.moved } : {}),
        })),
        { src: 'hum', left },
      );
      // what the take didn't take (hummed before R: H, then R; or the take is gone) stays an idea in Sketch, with
      // the hummed audio, at the beats it was sung on
      let cap = null;
      if (left.length) {
        const placed = left.every((x) => Number.isFinite(x.beat) && x.beat >= 0); // (before bar 1: free time)
        const bpb = beatsPerBar(opts.meter);
        const beat = placed ? Math.max(0, Math.floor((Math.min(...left.map((x) => x.beat)) + 0.1) / bpb) * bpb) : null;
        const g0 = Math.min(...left.map((x) => x.g));
        const notes = left
          .map((x) => ({
            p: x.p,
            t: Math.round((placed ? x.beat - beat : x.g - g0) * 10000) / 10000,
            d: x.d,
            v: x.v,
            conf: x.conf,
          }))
          .filter((x) => x.t >= 0);
        cap = input.capture.add({
          src: 'hum',
          kind: 'notes',
          notes,
          tempo: opts.tempo,
          beat,
          audio: audioId,
          key: opts.key || opts.heard,
          keyFrom: opts.key ? 'song' : opts.heard ? 'hum' : undefined,
        });
      }
      hum.take = {
        capture: cap ? cap.id : null,
        frames: s.frames,
        segs: s.segs,
        result,
        opts,
        audio: audioId,
        beat: null,
        rec: true,
        notes: n,
        kept: left.length,
        recTake,
      };
      emit('take', hum.take);
      return hum.take;
    }
    // sung along with the song: the notes keep their place, from the bar they start in
    let beat = null;
    if (s.playing && opts.originBeat != null && result.notes.length) {
      const bpb = beatsPerBar(opts.meter);
      beat = Math.max(0, Math.floor((result.notes[0].t + 0.1) / bpb) * bpb);
      for (const n of result.notes) n.t = Math.round((n.t - beat) * 10000) / 10000;
      result.text = formatNotes(result.notes.map(({ p, t, d, v }) => ({ p, t, d, v })));
    }
    const cap = input.capture.add({
      src: 'hum',
      kind: 'notes',
      notes: result.notes.map(({ p, t, d, v, conf }) => ({ p, t, d, v, conf })),
      tempo: opts.tempo,
      beat,
      audio: audioId,
      ...(opts.free ? { free: opts.free } : {}),
      key: opts.key || opts.heard,
      keyFrom: opts.key ? 'song' : opts.heard ? 'hum' : undefined,
      moved: result.moved.length,
      low: result.low,
      raw: s.segs.map((g) => ({ t0: g.t0, t1: g.t1, midi: g.midi, conf: g.conf, db: g.db })),
    });
    const tk = (hum.take = {
      capture: cap ? cap.id : null,
      frames: s.frames,
      segs: s.segs,
      result,
      opts,
      audio: audioId,
      beat,
      ...(opts.free ? { free: opts.free } : {}),
    });
    emit('take', hum.take);
    sayMoved(tk);
    return hum.take;
  }
  // Notes moved into the song's key are said where they can be seen (a toast, whichever pane is open), with Undo: the
  // notes back as you sang them, and Snap off for the hums after (Sketch's Snap chip turns it back on). A take's hum
  // (sung): the moved notes that went into the song, and the ops that put them back there (recorder commit's `sung`)
  function sayMoved(tk, sung = null) {
    const r = tk && tk.result,
      k = tk && effKey(tk.opts),
      n = sung ? sung.notes : r ? r.moved.length : 0;
    if (!k || !n) return;
    const text = `Moved ${n} ${n === 1 ? 'note' : 'notes'} into ${keyLabel(k)}${tk.opts.key ? ', the song’s key' : ', the key you hummed in'}.`;
    try {
      app.ui?.toast?.(text, {
        kind: 'info',
        action: { label: 'Undo', run: () => (sung ? backInSong(tk, sung) : backAsSung(tk)) },
      });
    } catch (e) {
      /* no shell (Node) */
    }
  }
  function backAsSung(tk) {
    if (hum.take !== tk || sess) return;
    hum.options.snapKey = false;
    hum.retranscribe({ snapKey: false });
    app.ui?.announce?.(
      `Back as you sang it: ${tk.result.notes.length} ${tk.result.notes.length === 1 ? 'note' : 'notes'}, none moved.`,
    );
  }
  // the take's moved notes back as sung, in the song: one undo step by you (the take itself stays in); Snap off after,
  // and the take's hum in Sketch reads as sung too
  function backInSong(tk, sung) {
    const n = sung.notes,
      notes = `${n} hummed ${n === 1 ? 'note' : 'notes'}`;
    const d = app.store.dispatch(sung.ops, { by: 'you', label: `${notes} back as sung` });
    if (!d.ok) {
      app.ui?.toast?.(`Couldn’t put the ${notes} back as you sang ${n === 1 ? 'it' : 'them'}: ${d.error}`, {
        kind: 'bad',
      });
      return;
    }
    hum.options.snapKey = false;
    if (hum.take === tk && !sess && tk.segs.length) {
      tk.opts = { ...tk.opts, snapKey: false };
      tk.result = transcribe(tk.segs, { ...tk.opts, key: effKey(tk.opts) });
      emit('take', tk);
    }
    app.ui?.announce?.(`Back as you sang it: ${notes} in the take, none moved.`);
  }
  // a hum recorded into a take with R: once the take is in, it says what it moved, as a hum on its own does
  try {
    input.recorder?.on?.('commit', (res) => {
      const tk = hum.take;
      if (tk && tk.rec && tk.recTake && res && res.ok && res.take === tk.recTake && res.sung) sayMoved(tk, res.sung);
    });
  } catch (e) {
    /* no recorder */
  }
  Object.assign(hum, {
    // re-run the quantise/snap on the last take with new options (snap, grid, keep my timing) and update its capture
    retranscribe(patch = {}) {
      const tk = hum.take;
      if (!tk || !tk.segs.length) return null;
      tk.opts = { ...tk.opts, ...patch };
      tk.result = transcribe(tk.segs, { ...tk.opts, key: effKey(tk.opts) });
      if (tk.beat != null) {
        for (const n of tk.result.notes) n.t = Math.round((n.t - tk.beat) * 10000) / 10000;
        tk.result.notes = tk.result.notes.filter((n) => n.t >= 0);
        tk.result.text = formatNotes(tk.result.notes.map(({ p, t, d, v }) => ({ p, t, d, v })));
      }
      if (tk.capture)
        input.capture.update(tk.capture, {
          notes: tk.result.notes.map(({ p, t, d, v, conf }) => ({ p, t, d, v, conf })),
          moved: tk.result.moved.length,
          low: tk.result.low,
          key: tk.opts.key || tk.opts.heard,
        });
      emit('take', tk);
      return tk;
    },
    options: { snapKey: true, grid: 0.25, keepTiming: false },
  });

  // the key a hum snaps to: the song's, once it's one somebody meant (keyChosen); null on a blank song
  function songKey() {
    const p = app.store.get();
    return keyChosen(p, app.store.history) ? p.key : null;
  }
  hum.songKey = songKey;
  // another song: the last take was that song's, not this one's
  try {
    app.store.on('change', (e) => {
      if (e && e.kind === 'load' && hum.take && !sess) {
        hum.take = null;
        emit('take', null);
      }
    });
  } catch (e) {
    /* no store */
  }

  // A hum onto a new track, in a song whose key nobody chose, is put in tune: into the key heard in it (snapHeard), said
  // and undoable as the song-key snap is; Undo (or Snap off) keeps the next hums as sung (options.snapKey). With nothing
  // to play in time with (no clip in the song, the click off, no take running), it keeps its own timing rather than a
  // grid at a tempo it never heard (docs/INSTRUMENTS-UX.md 1.4); in free time the take is then counted on the hummer's
  // own pulse (fitSegs, above), so the grid follows them
  function takeOpts(s, { peek = false } = {}) {
    const p = app.store.get(),
      key = songKey();
    let toNew = false;
    try {
      toNew = !!input.recorder && !input.recorder.targetFor('hum');
    } catch (e) {
      toNew = false;
    }
    const alone = !s.rec && !(p.tracks || []).some((t) => (t.clips || []).length) && !app.engine?.metronome;
    const o = {
      tempo: p.tempo,
      meter: p.meter,
      ...hum.options,
      key,
      heard: null,
      snapHeard: !key && toNew && hum.options.snapKey !== false,
    };
    if (alone) o.keepTiming = true;
    // against the click (a take, the song playing) or in free time: gently, so a sloppy start is still on its beat; a
    // take's notes sung before its first beat keep their place there (the recorder leaves them out: no chord on beat 1)
    o.gentle = !o.keepTiming && (!!s.rec || !!s.playing || !!s.opts?.free);
    if (s.rec) o.clampStart = false;
    if (s.playing && !s.snap && s.last) {
      if (peek) s = { ...s, snap: s.last };
      else s.snap = s.last;
    } // sung with the song: never at the marker instead
    if (s.playing && s.snap) {
      // the song was playing: put each note on the beat it was sung against (the round trip taken off)
      const L = input.audio.latency.get(),
        out = input.audio.outLatency(),
        spb = 60 / p.tempo;
      // input sample at ctx time T was sung to what was scheduled at T - L, heard at T - L + out
      const t0 = s.f0 / s.sr; // ctx time of the first captured sample; segs' t are seconds from it
      o.origin = 0;
      o.originBeat = s.snap.beat + (t0 - L + out - s.snap.ctxT) / spb;
    }
    return o;
  }

  // The tracker has already taken each block (pYIN, a Viterbi step a frame): the live trace gets the new frames' own
  // guesses and the live pitch the last one; a few times a second the path is decoded (the trace settles) and the
  // notes so far are re-segmented
  function analyse(s, final) {
    const n0 = s.frames.length;
    s.tr.trace();
    if (s.frames.length > n0) emit('frame', { ...s.frames[s.frames.length - 1], now: performance.now() });
    const at = performance.now();
    if (final || at - (s.segAt || 0) > 240) {
      s.segAt = at;
      s.tr.decode();
      s.segs = segment(s.frames);
      emit('segs', s.segs);
    }
  }
  return hum;
}

function concat(chunks, len) {
  const o = new Float32Array(len);
  let w = 0;
  for (const c of chunks) {
    o.set(c, w);
    w += c.length;
  }
  return o;
}
export { median, parsePc };
