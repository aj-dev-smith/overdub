// The tab lane [jam]: the Jam room's tab, under the stage. A page of tab with a moving cursor: six hairline strings, the
// fret numbers where the notes fall in time (each one's length drawn after it along its string, from the note's real
// length), the bars numbered and the chords named over them, the playhead moving through. The note sounding now is in
// reverse print; the ones ahead are plain ink; the ones behind go pencil, or carry what you did: warm where you hit it,
// a warm ring when you were early or late (a tick on the side you were), plain when it went by unheard. A quiet line
// after each pass says how it went ("11 of 14, the bend in bar 10 is late").
//
// What it shows: a riff take you're auditioning (the house riff writer's, core/riff.js, or an agent's, from
// suggest_riff or write_tab), else a clip on the room's Guitar track (the one under the playhead, else the next), else
// nothing yet (a sentence and Suggest a riff). Notes carry their place (s, f) or are fingered (core/fretboard.js
// placeNotes); the clip's tuning and capo, else the room's tuning.
//
// Practice: Loop the riff (the song's loop, an op by you, as the room's Loop is), Play from its first bar with a bar of
// count-in, the room's practice speed (engine.rate), Learn it (the transport waits on each note until you play it, then
// moves on: the riff's own clip is hushed meanwhile, engine.hush, so it's yours to play), Hear the riff (off: its clip is
// hushed while you play along). Copy tab puts it on the clipboard as text (fretboard.js tabText).
//
// Feedback comes from what you play: the guitar through the interface (input/onsets.js finds each note's onset and
// pitch in the raw input, then the calibrated round trip, audio.latency, comes off before it is placed on the song's
// beat), musical typing, a MIDI keyboard or a tap on the neck (app.input 'note' events, placed with engine.beatAt).
// core/playalong.js judges: pitch and onset, a chord by its strike and its lowest note only (the pitch tracker hears one
// note at a time, and the lane says so under a part with chords).
//
//   installTabs(app, room) -> app.tabs = { mount() -> { el, frame(now), changed(evt), refresh(), unmount() },
//     part(), state, suggest({ style, difficulty, seed, agent }), hold(i, on), keep(i), another(), dismiss(),
//     show({ track, clip } | null), hear({ p, ps?, beat?, src }), learn(on), hearRiff(on), loopRiff(), play(),
//     text(), copy(), describe(), passes, leave(), enter(), follow, learning, geometry (the mounted lane's) }
//   room (ui/jam.js): { J, timeline, where, playhead, guitars, ensureKeysGuitar, guitarOp, levelGuitar, setSpeed, speed,
//     visible }

import { h, css, icon, byline, canvas, clamp } from './dom.js';
import { placeNotes, tabText, tuningOf, capoOf, stringNumber } from '../core/fretboard.js';
import { riffTakes, RIFF_STYLES, RIFF_STYLE_IDS, DIFFICULTIES, riffStyleFor } from '../core/riff.js';
import { groupsOf, createFollow, passLine, learnStep, describeGroup } from '../core/playalong.js';
import { chordAt } from '../core/jam.js';
import { beatsPerBar, noteName, spellPc } from '../core/music.js';
import { createNoteFinder } from '../input/onsets.js';
import { readInks, staffShape, paintStaff } from './tabstaff.js';
import { installTabTools, riffOps } from '../agent/tabs-tool.js';

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const barsWord = (a, b) => (b > a ? `bars ${a}–${b}` : `bar ${a}`);
const STRING_WORD = ['low E', 'A', 'D', 'G', 'B', 'high e'];
const phone = () => matchMedia('(max-width: 640px)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;
const put = (el, ...kids) => {
  const out = [];
  const add = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else out.push(k instanceof Node ? k : String(k));
  };
  kids.forEach(add);
  el.replaceChildren(...out);
};

export function installTabs(app, room) {
  if (app.tabs) return app.tabs;
  const { store, engine, ui } = app;
  const J = room.J;
  css('tabs', TABS_CSS);
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('overdub:tabs') || '{}') || {};
  } catch (e) {
    saved = {};
  }
  const TB = (ui.state.tabs = {
    src: null, // what the lane shows: { kind: 'clip', clip } | { kind: 'take' } | null (pick one)
    takes: null, // riffs being auditioned: { id, from: 'house' | 'agent', by, req, span, style, level, seed, items: [{ letter, label, text, riff, index }], sel }
    style: RIFF_STYLES[saved.style] ? saved.style : null, // null: the song's
    level: DIFFICULTIES.includes(saved.level) ? saved.level : 'medium',
    learn: false,
    hear: true,
    line: '',
    lineKind: '',
  });
  const savePrefs = () => {
    try {
      localStorage.setItem('overdub:tabs', JSON.stringify({ style: TB.style, level: TB.level }));
    } catch (e) {
      /* private mode */
    }
  };
  const passes = []; // every pass's summary, newest last (for whoever wants them: tools/tabs-test.js)
  let ver = 0,
    view = null,
    takeSeq = 0,
    mounted = null;
  store.on('change', () => {
    ver++;
    partCache = null;
  });
  const visible = () => !!room.visible?.();
  const agentOn = () => !!app.agent?.provider;

  /* ----------------------------------------------------------------------------------------- the part */
  // { kind, start, end, bars: [a, b], notes (t from start, with s, f), groups, tuning, capo, title, by, clipId, trackId,
  //   kept, chords: [{ t (song beat), name }], error? }
  let partCache = null,
    partKey = '';
  function autoClip() {
    const g = room.guitars().keys;
    const clips = g ? g.clips.filter((c) => c.kind === 'notes' && !c.mute && c.notes.length) : [];
    if (!clips.length) return null;
    const at = room.playhead();
    const c =
      clips.find((x) => at >= x.start - EPS && at < x.start + x.length - EPS) ||
      clips.find((x) => x.start >= at - EPS) ||
      clips[clips.length - 1];
    return c ? c.id : null;
  }
  function currentSrc() {
    if (TB.takes && TB.takes.items[TB.takes.sel]) return { kind: 'take' };
    if (TB.src?.kind === 'clip' && store.findClip(TB.src.clip)) return TB.src;
    const id = autoClip();
    return id ? { kind: 'clip', clip: id, auto: true } : null;
  }
  function part() {
    const src = currentSrc();
    const key = `${ver}|${J.tuning}|${src ? (src.kind === 'take' ? `take:${TB.takes.id}:${TB.takes.sel}` : `clip:${src.clip}`) : ''}`;
    if (partCache && key === partKey) return partCache;
    partKey = key;
    partCache = src ? buildPart(src) : null;
    return partCache;
  }
  function buildPart(src) {
    const p = store.get(),
      bpb = beatsPerBar(p.meter),
      tl = room.timeline();
    let out;
    if (src.kind === 'take') {
      const it = TB.takes.items[TB.takes.sel],
        r = it.riff;
      out = {
        kind: 'take',
        start: r.start,
        end: r.start + r.bars * bpb,
        notes: r.notes.map((n) => ({ ...n })),
        tuning: r.tuning || J.tuning,
        capo: capoOf(r.capo),
        title: `Take ${it.letter}: ${it.label}`,
        by: TB.takes.by,
        kept: false,
        item: it,
      };
    } else {
      const f = store.findClip(src.clip);
      if (!f || f.clip.kind !== 'notes') return null;
      const c = f.clip,
        tuning = c.tuning || J.tuning,
        capo = capoOf(c.capo);
      const rel = c.notes.filter((n) => n.t < c.length - EPS && n.t >= 0);
      const pl = placeNotes(rel, { tuning, capo, open: 0.3 });
      out = {
        kind: 'clip',
        start: c.start,
        end: c.start + c.length,
        notes: pl.error ? [] : pl.notes,
        tuning,
        capo,
        title: `${f.track.name}${c.name ? `, ${c.name}` : ''}`,
        by: c.by,
        kept: true,
        clipId: c.id,
        trackId: f.track.id,
        error: pl.error ? `${pl.error}: this part can't be played as it is on a guitar.` : null,
        auto: !!src.auto,
      };
    }
    const a = Math.floor(out.start / bpb + EPS) + 1,
      b = Math.max(a, Math.ceil(out.end / bpb - EPS));
    out.bars = [a, b];
    out.bpb = bpb;
    out.groups = groupsOf(out.notes, { start: out.start, bpb });
    out.chordNotes = out.groups.some((g) => g.n > 1);
    // the chords over it, where they change
    const ch = [];
    if (out.item?.riff?.under) for (const u of out.item.riff.under) ch.push({ t: out.start + u.t, name: u.name });
    else
      for (let x = out.start; x < out.end - EPS; x += 0.5) {
        const c = chordAt(tl, x + 0.01).chord;
        if (c && (!ch.length || ch[ch.length - 1].name !== c.name)) ch.push({ t: x, name: c.name });
      }
    out.chords = ch;
    return out;
  }

  /* ----------------------------------------------------------------------------------------- following what you play */
  let follow = null,
    followKey = '',
    prevMarks = new Map(),
    passOn = false,
    lastBeat = null,
    passStart = null;
  const msPerBeat = () => 60000 / ((store.get().tempo || 120) * (engine.rate || 1));
  function followFor(pt) {
    const k = pt ? `${partKey}` : '';
    if (k !== followKey) {
      followKey = k;
      follow = pt ? createFollow(pt.groups, { msPerBeat: msPerBeat() }) : null;
      prevMarks = new Map();
      passOn = false;
    }
    if (follow) follow.msPerBeat = msPerBeat();
    return follow;
  }
  function hear({ p, ps = null, beat = null, src = 'keys' } = {}) {
    const pt = part();
    if (!pt || !pt.groups.length || !Number.isFinite(+p)) return null;
    if (TB.learn && learn.waiting) return learnHear(pt, +p, ps, src);
    const b = beat != null ? beat : engine.playing ? engine.beatAt(performance.now()) : null;
    if (b == null || !Number.isFinite(b)) return null;
    const f = followFor(pt);
    if (!f) return null;
    const r = f.hear({ p: +p, ps, beat: b, src });
    if (r) {
      passOn = true;
      dirty();
    }
    return r;
  }
  function endPass(why, upTo = Infinity) {
    const pt = part();
    if (!passOn || !follow || !pt) {
      passOn = false;
      return null;
    }
    passOn = false;
    const gs = pt.groups.filter((g) => g.t < upTo - EPS);
    if (!gs.length) return null;
    const heard = gs.some((g) => follow.marks.has(g.i) && follow.marks.get(g.i).mark !== 'missed');
    // a pass nobody played over says nothing, unless a guitar is plugged in (then "nothing heard" is worth knowing)
    if (!heard && !app.input?.audio?.state?.open && !follow.wrongs.length) {
      prevMarks = new Map();
      follow.reset();
      dirty();
      return null;
    }
    const s = { ...follow.summary({ key: store.get().key }), why };
    if (why === 'stop' && gs.length < pt.groups.length) {
      s.line = `${passLine(gs, follow.marks, follow.wrongs, { key: store.get().key }).replace(/\.$/, '')}, so far.`;
      s.total = gs.length;
    }
    if (heard || why !== 'stop') {
      TB.line = s.line;
      TB.lineKind = 'pass';
      passes.push({ ...s, at: Date.now(), marks: [...follow.marks].map(([i, m]) => ({ i, ...m })) });
      if (passes.length > 50) passes.shift();
    }
    prevMarks = new Map(follow.marks);
    follow.reset();
    view?.line();
    dirty();
    return s;
  }
  app.input?.on?.('note', (e) => {
    if (!e || !e.on || !visible()) return;
    hear({ p: e.p, src: e.kind === 'touch' ? 'touch' : 'keys' });
  });
  // the guitar: its raw input, listened to while the room shows a part and the input is open
  let listenOff = null,
    finder = null;
  function syncListen() {
    const a = app.input?.audio;
    const want = !!(a?.state?.open && visible() && part());
    if (want && !listenOff) {
      finder = createNoteFinder({ sr: a.state.sr || engine.ctx?.sampleRate || 48000 });
      listenOff = a.listen((blk) => {
        if (!blk || !blk.d || !blk.d[0]) return;
        const sr = finder.sr;
        for (const ev of finder.push(blk.d[0], blk.f)) {
          if (!engine.playing && !(TB.learn && learn.waiting)) continue;
          // the round trip comes off: a note played in time with what you heard reaches the page that much later
          const lat = (a.latency?.get?.() || 0) + (engine.latency?.total || 0);
          const beat = engine.playing ? engine.clock.beatAt(ev.f / sr - lat) : null;
          hear({ p: ev.p, ps: ev.ps, beat, src: 'guitar' });
        }
      });
    } else if (!want && listenOff) {
      listenOff();
      listenOff = null;
      finder = null;
    }
  }
  app.input?.on?.('audio', () => syncListen());

  /* ----------------------------------------------------------------------------------------- learn it */
  const learn = { i: 0, waiting: false, from: -Infinity, wrong: 0, at: null };
  function learnFrom(beat) {
    const pt = part();
    learn.i = pt
      ? Math.max(
          0,
          pt.groups.findIndex((g) => g.t >= beat - 0.01),
        )
      : 0;
    if (pt && learn.i < 0) learn.i = 0;
  }
  function placeWords(pt, g) {
    const n =
      pt.notes.find((x) => Math.abs(pt.start + x.t - g.t) < 0.02 && Math.round(x.p) === g.p) ||
      pt.notes.find((x) => Math.abs(pt.start + x.t - g.t) < 0.02);
    const name = spellPc(((g.p % 12) + 12) % 12, store.get().key);
    if (!n || !Number.isInteger(n.s)) return `the ${name}`;
    const fr = n.f - pt.capo,
      sw = tuningOf(pt.tuning).id === 'standard' ? `${STRING_WORD[n.s]} string` : `${ORD(stringNumber(n.s))} string`;
    return g.n > 1
      ? `the chord on beat ${Math.floor(g.beat)} of bar ${g.bar} (its lowest note, ${name}: ${fr ? `${ORD(fr)} fret` : 'open'}, ${sw})`
      : `the ${name}: ${fr ? `${ORD(fr)} fret` : 'open'}, ${sw}`;
  }
  function learnFrame(pt, beat) {
    if (!engine.playing || learn.waiting || !pt.groups.length) return;
    if (lastBeat != null && beat < lastBeat - 0.25) learnFrom(beat);
    const g = pt.groups[learn.i];
    if (!g) return;
    if (g.t > learn.from + 0.005 && beat >= g.t - 0.03 && beat < g.t + 0.5) {
      learn.waiting = true;
      learn.at = g.t;
      try {
        engine.stop({ live: false });
      } catch (e) {
        /* no audio */
      }
      setTimeout(() => {
        try {
          app.transport?.marker?.set?.(g.t, { seek: true });
        } catch (e) {
          /* ok */
        }
      }, 0);
      TB.line = `Waiting on ${placeWords(pt, g)}.`;
      TB.lineKind = 'learn';
      view?.line();
      dirty();
    }
  }
  function learnHear(pt, p, ps, src) {
    const g = pt.groups[learn.i];
    if (!g) return null;
    if (learnStep(pt.groups, learn.i, p, src, ps)) {
      followFor(pt)?.marks.set(g.i, { mark: 'hit', ms: 0, p });
      learn.i++;
      learn.waiting = false;
      learn.from = g.t;
      if (learn.i >= pt.groups.length) {
        TB.line = `Learned it: all ${pt.groups.length} notes${learn.wrong ? `, ${learn.wrong} wrong on the way` : ''}. It starts over from the top.`;
        learn.i = 0;
        learn.wrong = 0;
        learn.from = -Infinity;
      } else TB.line = `Yes. Next: ${placeWords(pt, pt.groups[learn.i])}.`;
      TB.lineKind = 'learn';
      try {
        engine.play(g.t);
      } catch (e) {
        /* no audio */
      }
      view?.line();
      dirty();
      return { i: g.i, mark: 'hit', ms: 0 };
    }
    learn.wrong++;
    TB.line = `That was ${spellPc(((Math.round(p) % 12) + 12) % 12, store.get().key)}. Waiting on ${placeWords(pt, g)}.`;
    view?.line();
    return { wrong: true, i: g.i, p };
  }
  function setLearn(on) {
    TB.learn = !!on;
    learn.waiting = false;
    learn.wrong = 0;
    learn.from = -Infinity;
    learnFrom(engine.playing ? engine.beat : room.playhead());
    if (TB.learn) {
      TB.line = 'Learn it: press Play, and the song waits on each note until you play it.';
      TB.lineKind = 'learn';
    } else if (TB.lineKind === 'learn') TB.line = '';
    syncHush();
    view?.practice();
    view?.line();
    dirty();
    return TB.learn;
  }
  // the riff's own clip is silent while you learn it, or when Hear the riff is off (practice only: engine.hush)
  function syncHush() {
    const pt = part();
    const ids = pt?.clipId && visible() && (TB.learn || !TB.hear) ? [pt.clipId] : [];
    try {
      engine.hush?.(ids);
    } catch (e) {
      /* the silent engine */
    }
  }
  function setHear(on) {
    TB.hear = !!on;
    syncHush();
    view?.practice();
    return TB.hear;
  }

  /* ----------------------------------------------------------------------------------------- takes */
  const styleLabel = (id) => RIFF_STYLES[id]?.label || id;
  function sectionNow() {
    const p = store.get(),
      at = room.playhead();
    return (p.sections || []).find((s) => at >= s.start - EPS && at < s.start + s.length - EPS) || null;
  }
  // the house writer's riffs for the section at the playhead (or the takes' own span, for Another)
  function suggest({ style = TB.style, difficulty = TB.level, seed = 1, span = null, agent = null } = {}) {
    if ((agent ?? agentOn()) && !span) return askAgent({ style, difficulty });
    const p = store.get(),
      tl = room.timeline();
    const r = riffTakes(
      p,
      {
        timeline: tl,
        at: room.playhead(),
        bars: span ? span : null,
        style: style || null,
        difficulty,
        seed,
        tuning: J.tuning,
      },
      3,
    );
    if (r.error) {
      TB.line = `${r.error}. ${r.hint ? r.hint[0].toUpperCase() + r.hint.slice(1) + '.' : ''}`;
      TB.lineKind = 'error';
      view?.line();
      return r;
    }
    room.ensureKeysGuitar?.({ select: false }); // (so a take held to hear plays through the rig at once)
    const sid = r.takes[0].style;
    TB.takes = {
      id: `h${++takeSeq}`,
      from: 'house',
      by: 'overdub',
      req: null,
      span: r.takes[0].span,
      style: sid,
      level: r.takes[0].difficulty,
      seed,
      items: r.takes.map((x, i) => ({ letter: 'ABCD'[i], label: x.label, text: x.text, riff: x, index: i })),
      sel: 0,
    };
    TB.line = `${r.takes.length} riffs from the house riff writer, ${styleLabel(sid).toLowerCase()}, ${r.takes[0].difficulty}. Hold one to hear it; Keep puts it on the Guitar track.`;
    TB.lineKind = 'takes';
    partCache = null;
    view?.takes();
    view?.line();
    view?.head();
    dirty();
    return { ok: true, takes: TB.takes.items.length };
  }
  function askAgent({ style, difficulty }) {
    const sec = sectionNow();
    const where = sec ? `the ${sec.name.toLowerCase()}` : 'this section';
    const text = `Give me a riff for ${where} as tab${style ? `, ${styleLabel(style).toLowerCase()}` : ''}${difficulty && difficulty !== 'medium' ? `, ${difficulty}` : ''}`;
    ui.emit('agent:compose', { text, send: true });
    TB.line = `Asked ${app.agent?.provider === 'mock' ? 'the demo agent' : 'Claude'}: "${text}". Its takes show here.`;
    TB.lineKind = 'takes';
    view?.line();
    return { ok: true, asked: text };
  }
  // an agent's takes (suggest_riff, write_tab): the request agent/tabs-tool.js made, its riffs on req.riff
  function adopt(req) {
    if (!req?.riff || req.status !== 'pending') return;
    // (lettered as the Agent tab letters them: the takes in their shuffled order, A first; the original isn't one)
    const items = req.cards
      .filter((c) => !c.original)
      .map((c, i) => ({
        letter: 'ABCDE'[i] || c.letter,
        label: c.label,
        text: req.riff.takes[c.index]?.text || c.why || '',
        riff: req.riff.takes[c.index],
        index: c.index,
      }))
      .filter((x) => x.riff);
    if (!items.length) return;
    TB.takes = {
      id: req.id,
      from: 'agent',
      by: req.by,
      req: req.id,
      span: req.riff.span,
      style: items[0].riff.style || null,
      level: items[0].riff.difficulty || null,
      seed: items[0].riff.seed || 1,
      items,
      sel: 0,
    };
    partCache = null;
    view?.takes();
    view?.head();
    dirty();
  }
  ui.on('agent:request', ({ id, req } = {}) => {
    if (!req?.riff) return;
    if (req.status === 'pending') {
      adopt(req);
      return;
    }
    if (TB.takes?.req !== id) return;
    const created = req.result?.created || null;
    const clip = created?.riff || null;
    if (req.result?.kept !== false && clip && store.findClip(clip)) TB.src = { kind: 'clip', clip };
    TB.takes = null;
    partCache = null;
    view?.takes();
    view?.head();
    dirty();
  });
  const takeItem = (i) => TB.takes?.items[i ?? TB.takes.sel] || null;
  let held = null;
  function hold(i, on) {
    const it = takeItem(i);
    if (!it) return { ok: false };
    if (TB.takes.from === 'agent') {
      const r = app.tools.audition(TB.takes.req, it.index, on);
      view?.takes();
      return r;
    }
    if (!on) {
      if (!held) return { ok: true };
      const hd = held;
      held = null;
      hd.handle?.release?.();
      // (a quick tap can let go before the transport has started: it stops once it has, unless another take is held)
      if (hd.started) {
        if (engine.playing) engine.stop({ live: false });
        else
          hd.play?.then(() => {
            if (!held && engine.playing) engine.stop({ live: false });
          });
      }
      view?.takes();
      return { ok: true };
    }
    if (held) hold(held.i, false);
    if (TB.takes.sel !== i) select(i);
    const plan = opsFor(it);
    if (plan.error) return plan;
    const handle = store.preview(plan.ops, { by: 'overdub' });
    if (!handle.ok) {
      ui.toast(`Can't play that take: ${handle.error}`, { kind: 'bad' });
      return { ok: false, error: handle.error };
    }
    held = { i, handle, started: false, play: null };
    if (!engine.playing) {
      try {
        held.play = Promise.resolve(engine.play(it.riff.start)).catch(() => {});
        held.started = true;
      } catch (e) {
        /* no audio */
      }
    }
    view?.takes();
    return { ok: true };
  }
  function opsFor(it) {
    const bpb = beatsPerBar(store.get().meter),
      r = it.riff;
    return riffOps(app, toolRoom, {
      notes: r.notes,
      start: r.start,
      length: r.bars * bpb,
      tuning: r.tuning,
      capo: r.capo,
      name: `Riff, ${styleLabel(r.style || TB.takes.style)}`,
    });
  }
  function keep(i) {
    const it = takeItem(i);
    if (!it) return { ok: false };
    if (held) hold(held.i, false);
    if (TB.takes.from === 'agent') {
      const r = app.tools.answer(TB.takes.req, it.index);
      return r;
    }
    const plan = opsFor(it);
    if (plan.error) {
      ui.toast(plan.error, { kind: 'bad' });
      return plan;
    }
    const res = store.dispatch(plan.ops, { by: 'overdub', label: `Riff: ${it.label}`.slice(0, 80) });
    if (!res.ok) {
      ui.toast(res.error, { kind: 'bad' });
      return res;
    }
    if (res.txn) {
      res.txn.reason = it.text;
      res.txn.keptBy = 'you';
      ui.emit('history:annotate', { txn: res.txn });
    }
    const clip = res.created.riff;
    if (plan.newTrack && res.created.g) room.levelGuitar?.(res.created.g, { by: 'overdub' });
    TB.takes = null;
    TB.src = clip ? { kind: 'clip', clip } : null;
    TB.line = `Take ${it.letter} is on the Guitar track, ${barsWord(it.riff.span[0], it.riff.span[1])}. Undo takes it out.`;
    TB.lineKind = 'kept';
    partCache = null;
    ui.toast(`Riff kept: ${it.label}, ${barsWord(it.riff.span[0], it.riff.span[1])} on the Guitar track.`, {
      kind: 'ok',
      action: { label: 'Undo', run: () => store.undo() },
    });
    view?.takes();
    view?.head();
    view?.line();
    syncHush();
    dirty();
    return { ok: true, clip, txn: res.txn?.id };
  }
  function another() {
    const T0 = TB.takes;
    if (!T0) return suggest({ agent: false });
    if (held) hold(held.i, false);
    if (T0.from === 'agent') app.tools.answer(T0.req, -1);
    return suggest({
      style: T0.style,
      difficulty: T0.level || TB.level,
      seed: (T0.seed || 1) + T0.items.length,
      span: T0.span,
      agent: false,
    });
  }
  function dismiss() {
    const T0 = TB.takes;
    if (!T0) return { ok: true };
    if (held) hold(held.i, false);
    if (T0.from === 'agent') app.tools.answer(T0.req, -1);
    TB.takes = null;
    partCache = null;
    if (TB.lineKind === 'takes') TB.line = '';
    view?.takes();
    view?.head();
    view?.line();
    dirty();
    return { ok: true };
  }
  function select(i) {
    if (!TB.takes || !TB.takes.items[i]) return;
    TB.takes.sel = i;
    partCache = null;
    view?.takes();
    view?.head();
    dirty();
  }
  function show(target) {
    if (!target) {
      TB.src = null;
      partCache = null;
      dirty();
      return null;
    }
    const f = target.clip ? store.findClip(target.clip) : null;
    if (!f) return null;
    TB.src = { kind: 'clip', clip: f.clip.id };
    partCache = null;
    view?.head();
    dirty();
    return { track: f.track.id, clip: f.clip.id };
  }

  /* ----------------------------------------------------------------------------------------- practice */
  function loopRiff() {
    const pt = part();
    if (!pt) return null;
    if (app.transport?.locked?.()) {
      ui.toast('The loop waits for the take to stop.');
      return null;
    }
    const lp = store.get().loop || {};
    const a = (pt.bars[0] - 1) * pt.bpb,
      b = pt.bars[1] * pt.bpb;
    if (lp.on && Math.abs(lp.start - a) < EPS && Math.abs(lp.end - b) < EPS) {
      store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you', label: 'loop off' });
      view?.practice();
      return { on: false };
    }
    const r = store.dispatch(
      { type: 'project.set', patch: { loop: { on: true, start: a, end: b } } },
      { by: 'you', label: `loop the riff, ${barsWord(pt.bars[0], pt.bars[1])}` },
    );
    if (r.ok && !engine.playing) app.transport?.marker?.set?.(a, { seek: true });
    view?.practice();
    return { on: true, start: a, end: b };
  }
  function play() {
    const pt = part();
    if (engine.playing || engine.starting) {
      engine.stop();
      return { playing: false };
    }
    if (!pt) return { playing: false };
    const from = (pt.bars[0] - 1) * pt.bpb;
    learnFrom(from);
    learn.waiting = false;
    learn.from = -Infinity;
    syncHush();
    try {
      Promise.resolve(engine.play(from, { countIn: { beats: pt.bpb, preroll: false } })).catch(() => {});
    } catch (e) {
      /* no audio yet */
    }
    return { playing: true, from };
  }

  /* ----------------------------------------------------------------------------------------- text */
  function text() {
    const pt = part();
    if (!pt || !pt.notes.length) return '';
    const p = store.get();
    return tabText(pt.notes, {
      tuning: pt.tuning,
      capo: pt.capo,
      meter: p.meter,
      bars: pt.bars[1] - pt.bars[0] + 1,
      title: `${pt.kind === 'take' ? `Riff (take ${pt.item.letter}, not kept yet)` : pt.title}, ${barsWord(pt.bars[0], pt.bars[1])}`,
      tempo: p.tempo,
    });
  }
  async function copy() {
    const t = text();
    if (!t) return { ok: false };
    let ok = false;
    try {
      await navigator.clipboard.writeText(t);
      ok = true;
    } catch (e) {
      try {
        const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
        ta.value = t;
        document.body.append(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (e2) {
        ok = false;
      }
    }
    const pt = part();
    ui.toast(
      ok
        ? `Tab copied: ${barsWord(pt.bars[0], pt.bars[1])}, ${tuningOf(pt.tuning).name} tuning${pt.capo ? `, capo ${pt.capo}` : ''}, with how to read it.`
        : 'The browser kept the clipboard closed: select the tab text from get_jam or tab_for instead.',
      { kind: ok ? 'ok' : 'bad' },
    );
    return { ok, text: t };
  }
  function describe() {
    const pt = part();
    return {
      shows: pt
        ? pt.kind === 'take'
          ? `${pt.title} (not kept yet)`
          : `${pt.title}, ${barsWord(pt.bars[0], pt.bars[1])}`
        : null,
      ...(pt
        ? { bars: pt.bars, notes: pt.notes.length, tuning: tuningOf(pt.tuning).name, capo: pt.capo, by: pt.by }
        : {}),
      takes: TB.takes ? TB.takes.items.length : 0,
      learn: TB.learn,
      last_pass: passes.length ? passes[passes.length - 1].line : null,
    };
  }

  /* ----------------------------------------------------------------------------------------- the agents' tools */
  const toolRoom = {
    tuning: () => J.tuning,
    guitars: () => room.guitars(),
    guitarOp: (ref) => room.guitarOp(ref),
    levelGuitar: (id, o) => room.levelGuitar?.(id, o),
    playhead: () => room.playhead(),
    timeline: () => room.timeline(),
    visible,
    offered: (req) => adopt(req),
    landed: (track, clip) => {
      TB.src = { kind: 'clip', clip };
      TB.takes = TB.takes && TB.takes.from === 'house' ? null : TB.takes;
      partCache = null;
      view?.head();
      dirty();
    },
  };
  installTabTools(app, toolRoom);

  /* ----------------------------------------------------------------------------------------- the lane */
  let dirtyFlag = true;
  function dirty() {
    dirtyFlag = true;
  }
  function mount() {
    const title = h('span.tb-title');
    const state = h('span.tb-state.t3');
    const styleSel = h(
      'select.ew-input.tb-style',
      {
        'aria-label': 'Riff style',
        onchange: (e) => {
          TB.style = e.target.value || null;
          savePrefs();
        },
      },
      h('option', { value: '' }, 'The song’s style'),
      RIFF_STYLE_IDS.map((id) => h('option', { value: id, selected: TB.style === id }, RIFF_STYLES[id].label)),
    );
    const levelSel = h(
      'select.ew-input.tb-level',
      {
        'aria-label': 'Difficulty',
        onchange: (e) => {
          TB.level = e.target.value;
          savePrefs();
        },
      },
      DIFFICULTIES.map((d) => h('option', { value: d, selected: TB.level === d }, d[0].toUpperCase() + d.slice(1))),
    );
    const suggestBtn = h('button.btn.tb-suggest', { type: 'button', onclick: () => suggest() });
    const houseBtn = h(
      'button.btn.btn-txt.tb-house',
      { type: 'button', hidden: true, onclick: () => suggest({ agent: false }) },
      'or the house writer’s',
    );
    const copyBtn = h('button.btn.btn-txt.tb-copy', { type: 'button', onclick: () => copy() }, 'Copy tab');
    const head = h(
      'div.tb-head',
      h('div.tb-what', h('span.jm-lab', 'Tab'), title, state),
      h('div.tb-tools', styleSel, levelSel, suggestBtn, houseBtn, copyBtn),
    );
    const takesList = h('ol.ledger.tb-takes', { 'aria-label': 'Riff takes', hidden: true });
    const cv = canvas('tb-cv');
    const scroller = h(
      'div.tb-scroll',
      { tabindex: 0, role: 'img', 'aria-roledescription': 'tab', 'aria-label': 'Tab' },
      cv.cv,
    );
    const empty = h('div.empty.tb-empty', { hidden: true });
    const loopBtn = h('button.tog.tb-loop', { type: 'button', onclick: () => loopRiff() });
    const playBtn = h('button.btn.tb-play', { type: 'button', onclick: () => play() });
    const learnBtn = h(
      'button.tog.tb-learn',
      { type: 'button', title: 'The song waits on each note until you play it', onclick: () => setLearn(!TB.learn) },
      'Learn it',
    );
    const hearBtn = h(
      'button.tog.tb-hear',
      {
        type: 'button',
        title: 'Off: the riff is silent so you play it (practice only)',
        onclick: () => setHear(!TB.hear),
      },
      'Hear the riff',
    );
    const slower = h(
      'button.btn.btn-txt.tb-slower',
      {
        type: 'button',
        'aria-label': 'Slower',
        onclick: () => {
          room.setSpeed?.((room.speed?.() || 100) - 5);
          view.practice();
        },
      },
      '−',
    );
    const faster = h(
      'button.btn.btn-txt.tb-faster',
      {
        type: 'button',
        'aria-label': 'Faster',
        onclick: () => {
          room.setSpeed?.((room.speed?.() || 100) + 5);
          view.practice();
        },
      },
      '+',
    );
    const speedVal = h('span.tb-speed-v.mono');
    const practice = h(
      'div.tb-practice',
      loopBtn,
      playBtn,
      learnBtn,
      hearBtn,
      h('span.tb-speed', h('span.jm-lab', 'Speed'), slower, speedVal, faster),
    );
    const line = h('p.tb-line', { 'aria-live': 'polite' });
    const chordsNote = h(
      'p.jm-note.tb-chords',
      { hidden: true },
      'Chords count by when you strike them and their lowest note: the pitch tracker hears one note at a time.',
    );
    const el = h('section.tb', { 'aria-label': 'Tab' }, head, takesList, scroller, empty, practice, line, chordsNote);
    let G = null,
      inks = null,
      userScrollAt = 0,
      page = 0,
      lastDraw = '';
    scroller.addEventListener(
      'scroll',
      () => {
        if (!scroller._auto) userScrollAt = performance.now();
        scroller._auto = false;
      },
      { passive: true },
    );
    // a tap on the staff puts the marker (stopped) or the playhead (playing) there
    scroller.addEventListener('pointerdown', (e) => {
      const pt = part();
      if (!pt || !G) return;
      const rect = cv.cv.getBoundingClientRect(),
        x = e.clientX - rect.left;
      const beat = G.beatAt(x);
      if (beat == null) return;
      const b = clamp(Math.round(beat * 4) / 4, pt.start, pt.end);
      if (engine.playing) {
        try {
          engine.seek(b);
        } catch (err) {
          /* ok */
        }
      } else app.transport?.marker?.set?.(b, { seek: true });
      dirty();
    });

    // the layout: on a desktop a page of up to four bars across the width (the cursor moves, the page turns); on a phone
    // the whole part at a finger's width per sixteenth, scrolled to follow the playhead
    function layout(pt) {
      const ph = phone();
      G = staffShape(pt, { vw: Math.max(260, scroller.clientWidth || 600), whole: ph, ph, pageOf: () => page });
      cv.cv.style.width = `${G.W}px`;
      cv.cv.style.height = `${G.H}px`;
      scroller.style.height = `${G.H + (ph ? 6 : 2)}px`;
    }
    function draw(now, pt, beat, playing) {
      if (!G) layout(pt);
      cv.fit();
      const marks = follow?.marks || new Map();
      const waitAt = TB.learn && learn.waiting ? learn.at : null;
      const at = waitAt != null ? waitAt : playing ? beat : null;
      const groupOf = (t0) => pt.groups.find((gg) => Math.abs(gg.t - t0) < 0.031);
      const tabNow = paintStaff(cv, G, inks, pt, {
        at,
        loop: store.get().loop,
        noteState(nn, t0) {
          const isNow = at != null && at >= t0 - 0.02 && at < t0 + Math.max(0.12, nn.d) - 0.01;
          const gr = groupOf(t0),
            m = gr ? marks.get(gr.i) : null;
          const passed = (playing ? beat : -Infinity) > t0 + 0.05;
          const pm = !m && !passed && gr ? prevMarks.get(gr.i) : null; // last pass's, on notes still ahead
          const mark = (m || pm)?.mark;
          return {
            box: isNow,
            ink: mark === 'hit' ? 'human' : passed && !m ? 'dim' : 'text',
            ring: mark === 'early' || mark === 'late' ? mark : null,
            alpha: pm && !isNow ? 0.6 : 1,
          };
        },
      });
      // the neck shows the note now (the room's: J.tabNow)
      const nowKey = tabNow.map((x) => `${x.s}:${x.f}`).join(',');
      if (nowKey !== (J.tabNowKey || '')) {
        J.tabNowKey = nowKey;
        J.tabNow = tabNow.length ? tabNow.map((x) => ({ s: x.s, f: x.f, capo: pt.capo })) : null;
        room.neckDirty?.();
      }
    }

    view = {
      head() {
        const pt = part();
        const agent = agentOn();
        put(
          suggestBtn,
          agent ? `Ask ${app.agent?.provider === 'mock' ? 'the demo agent' : 'Claude'} for a riff` : 'Suggest a riff',
        );
        suggestBtn.title = agent
          ? 'Your agent writes takes (it may use the house riff writer); they show here'
          : 'The house riff writer: three riffs for the section you’re in';
        houseBtn.hidden = !agent;
        copyBtn.hidden = !pt || !pt.notes.length;
        // nothing to show: the lane is this one line, so the neck under it keeps its place
        if (!pt) {
          const sec = sectionNow();
          put(
            title,
            h(
              'span.t3',
              'No tab yet',
              h(
                'span.tb-blank-more',
                `: suggest a riff for ${sec ? `the ${sec.name}` : 'these bars'}, or record one${coarse() ? '' : ' with R'}.`,
              ),
            ),
          );
          put(state);
          return;
        }
        put(
          title,
          pt.kind === 'take' ? `Take ${pt.item.letter}: ${pt.item.label}` : pt.title,
          ' ',
          pt.by ? byline(pt.by, { app }) : null,
        );
        put(
          state,
          `${barsWord(pt.bars[0], pt.bars[1])}${tuningOf(pt.tuning).id !== 'standard' ? `, ${tuningOf(pt.tuning).name}` : ''}${pt.capo ? `, capo ${pt.capo}` : ''}${pt.kind === 'take' ? ', not kept yet' : ''}`,
        );
      },
      takes() {
        const TK = TB.takes;
        takesList.hidden = !TK;
        if (!TK) {
          put(takesList);
          return;
        }
        const holding = (i) =>
          TK.from === 'agent'
            ? app._agentTools?.audition?.id === TK.req && app._agentTools.audition.index === TK.items[i].index
            : held?.i === i;
        const rows = TK.items.map((it, i) => {
          const sel = i === TK.sel;
          const holdBtn = h('button.btn.tb-hold', {
            type: 'button',
            'aria-pressed': String(holding(i)),
            class: holding(i) ? 'btn-held' : null,
          });
          holdBtn.textContent = holding(i) ? `Hearing ${it.letter}` : 'Hold to hear';
          const stop = () => hold(i, false);
          // (the release is listened for on the window: holding a take selects it, and the row redraws under the finger)
          const start = (e) => {
            if (e.button) return;
            e.preventDefault();
            hold(i, true);
            const up = () => {
              window.removeEventListener('pointerup', up, true);
              window.removeEventListener('pointercancel', up, true);
              stop();
            };
            window.addEventListener('pointerup', up, true);
            window.addEventListener('pointercancel', up, true);
          };
          holdBtn.addEventListener('pointerdown', start);
          holdBtn.addEventListener('keydown', (e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault();
              hold(i, true);
            }
          });
          holdBtn.addEventListener('keyup', (e) => {
            if (e.key === ' ' || e.key === 'Enter') stop();
          });
          return h(
            'li.tb-take',
            { dataset: { i: String(i), from: TK.from }, class: sel ? 'sel' : null },
            h(
              'button.tb-take-pick',
              {
                type: 'button',
                'aria-pressed': String(sel),
                class: sel ? 'sel-print' : null,
                title: it.text,
                onclick: () => select(i),
              },
              h('span.num.tb-letter', it.letter),
              h('b.tb-take-label', it.label),
            ),
            h(
              'span.tb-take-acts',
              holdBtn,
              sel ? h('button.btn.btn-go.tb-keep', { type: 'button', onclick: () => keep(i) }, 'Keep') : null,
            ),
          );
        });
        const cur = TK.items[TK.sel];
        rows.push(
          h(
            'li.tb-takes-foot',
            h(
              'span.tb-take-text',
              cur ? cur.text : '',
              ' ',
              h(
                'span.t3',
                TK.from === 'agent'
                  ? ['Offered by ', byline(TK.by, { app }), '.']
                  : 'From the house riff writer: seeded, so Another is the next seed.',
              ),
            ),
            h(
              'span.tb-take-acts',
              h('button.btn.btn-txt.tb-another', { type: 'button', onclick: () => another() }, 'Another'),
              h('button.btn.btn-txt.tb-none', { type: 'button', onclick: () => dismiss() }, 'None of these'),
            ),
          ),
        );
        put(takesList, rows);
      },
      practice() {
        const pt = part(),
          lp = store.get().loop || {};
        const on = !!(
          pt &&
          lp.on &&
          Math.abs(lp.start - (pt.bars[0] - 1) * pt.bpb) < EPS &&
          Math.abs(lp.end - pt.bars[1] * pt.bpb) < EPS
        );
        put(loopBtn, pt ? `Loop ${barsWord(pt.bars[0], pt.bars[1])}` : 'Loop the riff');
        loopBtn.setAttribute('aria-pressed', String(on));
        loopBtn.disabled = !pt;
        put(
          playBtn,
          icon(engine.playing ? 'stop' : 'play', { size: 14 }),
          engine.playing ? 'Stop' : pt ? `Play from bar ${pt.bars[0]}` : 'Play',
        );
        playBtn.title = 'With a bar of count-in';
        playBtn.disabled = !pt && !engine.playing;
        learnBtn.setAttribute('aria-pressed', String(TB.learn));
        learnBtn.disabled = !pt;
        hearBtn.hidden = !(pt && pt.clipId);
        hearBtn.setAttribute('aria-pressed', String(TB.hear));
        speedVal.textContent = `${room.speed?.() || 100}%`;
      },
      line() {
        const pt = part();
        put(
          line,
          TB.line
            ? TB.line
            : pt
              ? h('span.t3', 'Play along: each note goes warm when you hit it, a ring when you’re early or late.')
              : null,
        );
        line.dataset.kind = TB.lineKind || '';
        chordsNote.hidden = !pt?.chordNotes;
      },
      // with no part the lane is one line (the head says it, and Suggest a riff is in it); a part that can't be played on a
      // guitar says why, under the head
      empty() {
        const pt = part();
        el.classList.toggle('tb-blank', !pt);
        empty.hidden = !pt || !pt.error;
        scroller.hidden = !pt || !!pt.error;
        if (pt?.error)
          put(
            empty,
            h('p', pt.error),
            h('button.btn.tb-empty-go', { type: 'button', onclick: () => suggest() }, 'Suggest a riff instead'),
          );
        else put(empty);
      },
    };
    view.head();
    view.takes();
    view.practice();
    view.line();
    view.empty();
    let lastPart = null,
      lastPlaying = false;
    return (mounted = {
      el,
      frame(now) {
        const pt = part();
        if (pt !== lastPart) {
          lastPart = pt;
          G = null;
          page = 0;
          view.head();
          view.practice();
          view.line();
          view.empty();
          syncHush();
          syncListen();
        }
        if (!inks) inks = readInks();
        const playing = !!engine.playing;
        const beat = playing ? engine.beat : room.playhead();
        if (playing !== lastPlaying) {
          lastPlaying = playing;
          view.practice();
        }
        if (pt) {
          // passes: the playhead coming round (a loop) or past the part's end closes one; a stop closes it too
          if (!TB.learn) {
            followFor(pt);
            if (playing) {
              if (lastBeat != null && beat < lastBeat - 0.25) endPass('wrap');
              if (beat >= pt.start - 0.05 && beat < pt.end + 0.25) {
                if (!passOn && follow) passOn = true;
              }
              if (passOn && follow) {
                if (follow.passed(beat).length) dirty();
                if (beat >= pt.end + 0.3) endPass('end');
              }
            } else if (lastBeat != null && passOn) endPass('stop', lastBeat);
          } else learnFrame(pt, beat);
          lastBeat = playing ? beat : null;
          if (!G) layout(pt);
          // the page turns with the playhead (a desktop); a phone's lane scrolls to keep it a third of the way in
          if (G.pages > 1) {
            const k = clamp(Math.floor((beat - G.a0) / (G.pageBars * G.bpb) + EPS), 0, G.pages - 1);
            if (k !== page && (playing || TB.learn)) {
              page = k;
              dirty();
            }
          }
          if (G.ph && (playing || (TB.learn && learn.waiting)) && now - userScrollAt > 2500) {
            const at = TB.learn && learn.waiting ? learn.at : beat;
            const want = clamp(G.xOf(at) - scroller.clientWidth * 0.3, 0, Math.max(0, G.W - scroller.clientWidth));
            if (Math.abs(scroller.scrollLeft - want) > 2) {
              scroller._auto = true;
              scroller.scrollLeft = want;
            }
          }
          const sig = `${playing ? Math.round(beat * 64) : 'x' + Math.round(beat * 4)}|${follow?.marks.size || 0}|${passes.length}|${learn.waiting}|${page}|${partKey}`;
          if (dirtyFlag || sig !== lastDraw) {
            lastDraw = sig;
            dirtyFlag = false;
            draw(now, pt, beat, playing);
          }
        } else if (J.tabNow) {
          J.tabNow = null;
          J.tabNowKey = '';
          room.neckDirty?.();
        }
      },
      changed(e) {
        partCache = null;
        if (e?.kind === 'load') {
          TB.src = null;
          TB.takes = null;
          TB.line = '';
          learn.waiting = false;
          if (TB.learn) setLearn(false);
        }
        view.head();
        view.practice();
        view.line();
        view.empty();
        dirty();
      },
      refresh() {
        G = null;
        inks = null;
        view.head();
        view.takes();
        view.practice();
        view.line();
        view.empty();
        dirty();
        syncListen();
      },
      unmount() {
        view = null;
        mounted = null;
      },
      get geometry() {
        return G;
      },
      at(t, s) {
        return G ? { x: G.xOf(t), y: G.yOf(s) } : null;
      },
      canvas: cv.cv,
    });
  }
  // leaving the room: the riff is heard again, Learn it stops waiting, the guitar isn't listened to
  function leave() {
    learn.waiting = false;
    try {
      engine.hush?.([]);
    } catch (e) {
      /* ok */
    }
    syncListen();
    if (J.tabNow) {
      J.tabNow = null;
      J.tabNowKey = '';
    }
  }
  function enter() {
    syncHush();
    syncListen();
    dirty();
  }

  const api = {
    get state() {
      return TB;
    },
    part,
    passes,
    mount,
    suggest,
    hold,
    keep,
    another,
    dismiss,
    select,
    show,
    hear,
    learn: setLearn,
    hearRiff: setHear,
    loopRiff,
    play,
    text,
    copy,
    describe,
    leave,
    enter,
    get follow() {
      return follow;
    },
    get learning() {
      return { ...learn };
    },
    get geometry() {
      return mounted?.geometry || null;
    },
  };
  app.tabs = api;
  return api;
}

const TABS_CSS = `
/* The tab lane: a page of tab under the stage. Hairline strings on the canvas; the controls are words and toggles. */
.tb { padding: 10px 0 12px; border-bottom: var(--rule); }
.tb-head { display: flex; align-items: center; justify-content: space-between; gap: 6px 16px; flex-wrap: wrap; margin-bottom: 4px; }
.tb-what { display: flex; align-items: baseline; gap: 4px 10px; min-width: 0; flex-wrap: wrap; }
.tb-what .jm-lab { display: inline; font-size: 12px; font-weight: 600; color: var(--text-2); }
.tb-title { font: 600 13.5px/1.3 var(--font-ui); color: var(--text); min-width: 0; }
.tb-state { font-size: 12px; }
.tb-tools { display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; }
.tb-style, .tb-level { height: 28px; font-size: 12.5px; padding: 0 8px; }
.tb-takes { margin: 6px 0 8px; border-top: var(--rule); --ledger-cols: 1fr auto; }
.tb-takes > li { align-items: center; padding: 3px 0; }
.tb-take-pick { display: inline-flex; align-items: baseline; gap: 10px; justify-self: start; max-width: 100%; min-width: 0; padding: 3px 10px 3px 4px; border: 0; border-radius: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.tb-take-pick:hover:not(.sel-print) { background: var(--bg-3); }
.tb-take-pick.sel-print { background: var(--text); color: var(--bg); }
.tb-take-pick:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.tb-letter { font-size: 20px; min-width: 1ch; color: var(--agent); }
.tb-take[data-from="house"] .tb-letter, .tb-take-pick.sel-print .tb-letter { color: inherit; }
.tb-take-label { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-take-text { font-size: 12px; color: var(--text-2); line-height: 1.45; max-width: 92ch; }
.tb-take-acts { display: inline-flex; align-items: center; gap: 8px; }
.tb-takes-foot { align-items: start !important; padding: 6px 0 8px !important; }
.tb-takes-foot .t3 { font-size: 12px; }
.tb [hidden] { display: none !important; }
.tb-scroll { position: relative; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; outline: none; touch-action: pan-x; }
.tb-scroll:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.tb-scroll[hidden], .tb-empty[hidden], .tb-takes[hidden], .tb-chords[hidden] { display: none; }
.tb-cv { display: block; cursor: pointer; }
.tb-empty { padding: 10px 0 4px; max-width: none; }
.tb-empty p { margin: 0 0 8px; font-size: 13px; color: var(--text-2); max-width: 70ch; }
.tb-practice { display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap; margin: 6px 0 0 -9px; }
.tb-play { gap: 6px; }
.tb-speed { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; }
.tb-speed .jm-lab { display: inline; margin-right: 2px; }
.tb-speed .btn-txt { min-width: 22px; font-size: 15px; text-decoration: none; }
.tb-speed-v { min-width: 4ch; text-align: center; }
.tb-line { margin: 6px 0 0; font-size: 13px; color: var(--text-2); min-height: 18px; }
.tb-line[data-kind="pass"] { color: var(--text); }
.tb-chords { margin-top: 2px; }
/* no riff and no tab part: one line (the label, what to do, Suggest a riff), so the neck keeps its place under it */
.tb.tb-blank { padding: 6px 0; }
.tb.tb-blank .tb-head { margin-bottom: 0; flex-wrap: nowrap; }
.tb.tb-blank .tb-what { flex-wrap: nowrap; min-width: 0; flex: 1 1 auto; }
.tb.tb-blank .tb-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-weight: 400; }
.tb.tb-blank .tb-tools { flex-wrap: nowrap; flex: none; }
.tb.tb-blank .tb-practice, .tb.tb-blank .tb-line, .tb.tb-blank .tb-chords { display: none; }
.tb-blank-more { color: var(--text-3); }
@media (max-width: 900px) {
  .ew-shell .tb-title, .ew-shell .tb-state, .ew-shell .tb-take-text, .ew-shell .tb-takes-foot .t3, .ew-shell .tb-line, .ew-shell .tb-speed-v { font-size: 12px; }
  .ew-shell .tb-title { font-size: 13px; }
  .ew-shell .tb-style, .ew-shell .tb-level { height: 44px; font-size: 16px; }
  .ew-shell .tb-suggest, .ew-shell .tb-play, .ew-shell .tb-hold, .ew-shell .tb-keep, .ew-shell .tb-empty-go { min-height: 44px; }
  .ew-shell .tb-copy, .ew-shell .tb-house, .ew-shell .tb-another, .ew-shell .tb-none, .ew-shell .tb-speed .btn-txt { min-height: 44px; min-width: 44px; }
  .ew-shell .tb-practice .tog { min-height: 44px; }
  .ew-shell .tb-take-pick { min-height: 44px; }
}
@media (max-width: 640px) {
  .ew-shell .tb-head { align-items: flex-start; }
  .ew-shell .tb-tools { width: 100%; }
  .ew-shell .tb-style, .ew-shell .tb-level { flex: 1 1 140px; min-width: 0; }
  .ew-shell .tb-takes > li { grid-template-columns: 1fr !important; gap: 6px; }
  .ew-shell .tb-take-acts { justify-content: flex-start; }
  /* a phone's one line: the label, "No tab yet", and Suggest a riff (the style and the level come with the takes) */
  .ew-shell .tb.tb-blank .tb-head { align-items: center; }
  .ew-shell .tb.tb-blank .tb-tools { width: auto; }
  .ew-shell .tb.tb-blank .tb-style, .ew-shell .tb.tb-blank .tb-level, .ew-shell .tb.tb-blank .tb-blank-more { display: none; }
}
/* a phone on its side keeps the tab lane's empty line to one line too */
@media (max-height: 500px) and (pointer: coarse) {
  .ew-shell .tb.tb-blank .tb-blank-more { display: none; }
}
`;
