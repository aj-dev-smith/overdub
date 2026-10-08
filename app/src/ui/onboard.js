// "Take one": the first-run coach. It gets a newcomer from the door to a real overdub in about two minutes:
//   hear it (Space) -> make take one (hum it, tap a beat, or play the computer keys) -> keep it -> ask the agent for a
//   take over it (the demo agent when no agent is on) -> keep one of its takes -> "That's an overdub."
// Every step waits for the real thing (the transport, the capture log, the store, the agent), not a Next button.
// The first minute (docs/research/RECORDING-UX.md 3.3) is the "take one" step's first door, Tap a beat (and the first
// door of a New song's blank sheet, app.onboard.firstMinute()): the song gets a Drums track if it has none, a 2-bar
// loop at the marker, the click, Sketch on Tap, and the loop starts, so the beat is on screen (the ball in the top bar)
// before a sound is made. R records, F J K L tap, each pass layers into one clip, Space and it's in the song. Then
// "Your beat is in the song" offers keys over it (a pitched track, musical typing, the same loop: each pass a new take)
// and the agent. The card follows the recorder (counting in, recording, the pass) in place.
// Your part never goes over the song's own: in a song with parts that aren't yours (a demo), the beat and the keys
// each get a track of their own (Taps, Tune) rather than layering into the song's drums or taking over its chords.
// When a step sets the loop, the playhead goes to the loop's start (a song left playing past it would run on).
// Make your own (app.onboard.ownSong(), the welcome's main action): a new song, then the first minute on it.
// The last card counts what you played: the hits and the notes, the beat and the keys together.
// It never blocks the studio (a small card over the arranger's quiet corner; clicks elsewhere go where they always
// go), it can be skipped a step at a time or closed for good, and it remembers where you were. It never starts
// under navigator.webdriver (the checks), unless forced: ?coach in the URL or app.onboard.start({ force: true }).
// Nor by itself in the simple view (ui/workspace.js): there a door (Tap a beat), Song → Take one or ?coach starts it.
// It never runs on someone else's song by itself: a tour left half-way doesn't resume on a link, and a link opened
// mid-tour sends it aside until a song of yours is back. Closing it gives back the loop it set only on the song it set
// it on, only if nobody has changed that loop since, signed by the house (it's tidying up, not an edit of yours).
//
// app.onboard = { start({ force?, restart? }), stop(), skip(), done(), ask(), firstMinute(kind = 'tap'), keysOver(),
//   humOver(), ownSong(), played() -> { hits, notes }, step, index, steps, active, state, take }
// (humOver works with the tour off too: Tap it's "Hum a tune over it?" uses it)
// ui events: 'onboard' { step, index, state }

import { h, css, icon } from './dom.js';
import { isDrumTrack, leanWords } from '../input/recorder.js';
import { beatsPerBar } from '../core/music.js';

const KEY = 'overdub:onboard';
const STEPS = ['listen', 'take', 'keep', 'ask', 'pick', 'done'];
const ls = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch (e) {
      /* storage blocked: it just won't remember */
    }
  },
};
const SRC_WORD = {
  hum: 'hummed',
  tap: 'tapped',
  beatbox: 'beatboxed',
  midi: 'played',
  qwerty: 'played on the keys',
  touch: 'played',
  rec: 'recorded',
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// Hum over it says "Headphones keep the drums out of your hum." once a session (this page's life)
let headphonesSaid = false;
// where the agent's thread is: the Agent tab in the full studio; the simple view's agent pane has no tab strip
const agentAt = (app) => (app.ui?.workspace?.view?.() === 'simple' ? 'the agent pane' : 'the Agent tab');
// the agent's takes, counted and lettered as the Agent tab letters them: "three versions, A, B and C"
const TAKE_N = ['no', 'one', 'two', 'three', 'four', 'five'];
const takesWord = (n) => {
  if (!(n > 0)) return 'a few versions';
  if (n === 1) return 'one version, A,';
  const L = 'ABCDE'.slice(0, Math.min(n, 5)).split('');
  return `${TAKE_N[n] || n} versions, ${L.slice(0, -1).join(', ')} and ${L[L.length - 1]},`;
};

export default function (app) {
  const { store, ui, engine } = app;
  css('onboard', CSS);
  const params = new URLSearchParams(location.search);
  const firstVisit = (() => {
    try {
      return localStorage.getItem('overdub:project') == null;
    } catch (e) {
      return false;
    }
  })();

  let idx = -1; // the current step (index into STEPS), -1 when the coach is off
  let card = null;
  const offs = [];
  const take = { phrase: null, track: null, clip: null, notes: 0, drums: false, rec: null, keys: null }; // what the newcomer made
  const two = { by: null, label: null, takes: 0 }; // what the agent played over it (takes: how many it offered)
  let note = ''; // a one-line aside for the current step
  let fm = null; // the first minute: null | 'tap' | 'keys' | 'hum'
  let lent = null; // what the first minute set, to put back: { loop, was, song, touched, typing, click, tap }
  let settingLoop = false; // the tour's own loop change is going in (not the person's)
  let paused = false; // stepped aside for someone else's song (a link), to pick up on yours
  // someone else's song is on screen (a link that isn't one of yours): the tour never runs on it by itself
  const elsewhere = () => !!app.share?.listening && !app.share?.incoming?.own;
  let unfolded = false; // a phone's strip opened out to the whole card (until the next step)
  let said = null; // a toast said in the phone's strip instead: { parts, action, el, timer }

  const step = () => STEPS[idx] || null;
  const save = (state) =>
    ls.set({
      state,
      step: step(),
      at: Date.now(),
      take: {
        track: take.track,
        clip: take.clip,
        notes: take.notes,
        drums: take.drums,
        recN: take.rec ? { notes: take.rec.notes, drums: take.rec.drums } : take.recN || null,
        keys: take.keys || null,
      },
      lent:
        lent && (lent.loop || lent.click || lent.tap)
          ? {
              loop: lent.loop,
              was: lent.was,
              song: lent.song,
              touched: lent.touched || undefined,
              click: lent.click,
              tap: lent.tap,
            }
          : undefined,
    });
  // a tapped beat is hits, a hummed or played line is notes
  const word = () => (take.drums ? 'hit' : 'note');
  // what you played, all of it: take one (a beat is hits, a line notes; recorded with R, the recorder's own count, which
  // is every hit you played, the ones that landed on a hit already there too) and the keys over it
  function played() {
    const out = { hits: 0, notes: 0 };
    const r = take.rec || take.recN; // (recN: the count kept over a reload)
    const one = r ? { n: r.notes || 0, drums: !!r.drums } : { n: take.notes || 0, drums: !!take.drums };
    out[one.drums ? 'hits' : 'notes'] += one.n;
    if (take.keys) out.notes += take.keys.notes || 0;
    return out;
  }
  const playedText = ({ hits, notes }) =>
    [hits ? plural(hits, 'hit') : '', notes ? plural(notes, 'note') : ''].filter(Boolean).join(' and ') ||
    'nothing yet';

  /* ---------------------------------------------------------------- starting and stopping */
  function start({ force = false, restart = false } = {}) {
    if (!force && navigator.webdriver) return false;
    paused = false;
    const was = ls.get();
    if (!force && was && (was.state === 'done' || was.state === 'dismissed')) return false;
    let at = 0;
    if (!restart && was && was.state === 'on' && STEPS.includes(was.step)) {
      at = STEPS.indexOf(was.step);
      if (was.take) Object.assign(take, was.take);
      if (was.lent && !lent) lent = was.lent; // (a reload mid-tour still gives the loop back at the end)
      if (take.clip && !store.findClip(take.clip)) {
        take.clip = null;
        take.track = null;
      }
      if (at > 2 && at < STEPS.indexOf('done') && !take.clip) at = 1; // nothing of yours to play over: back to take one
    } else
      Object.assign(take, {
        phrase: null,
        track: null,
        clip: null,
        notes: 0,
        drums: false,
        rec: null,
        recN: null,
        keys: null,
      });
    listen();
    app.welcome?.close?.(); // the arranger's one-line welcome says the same thing as step 1
    go(at);
    return true;
  }
  function stop(state = 'dismissed') {
    if (idx < 0) return;
    giveBack();
    save(state);
    idx = -1;
    fm = null;
    for (const o of offs.splice(0)) {
      try {
        o();
      } catch (e) {
        /* ok */
      }
    }
    clearInterval(pollT);
    if (said) {
      clearTimeout(said.timer);
      said = null;
    }
    unfolded = false;
    if (card) {
      const c = card;
      card = null;
      live = null;
      lastSaid = '';
      // focus leaves with the card: back to the arrangement, not the top of the page
      if (c.contains(document.activeElement)) document.querySelector('.ar-scroll')?.focus({ preventScroll: true });
      c.classList.add('out');
      setTimeout(() => c.remove(), 200);
    }
    ui.emit('onboard', { step: null, index: -1, state });
  }
  function go(i) {
    idx = Math.max(0, Math.min(STEPS.length - 1, i));
    note = '';
    unfolded = false;
    // nothing to hear: the first step has nothing to do
    if (step() === 'listen' && !store.get().tracks.some((t) => t.clips.length)) {
      idx = 1;
    }
    if (step() !== 'listen') clearInterval(pollT);
    if (step() === 'done') giveBack();
    save(step() === 'done' ? 'done' : 'on');
    paint({ moved: true });
    ui.emit('onboard', { step: step(), index: idx, state: step() === 'done' ? 'done' : 'on' });
  }
  const advance = (to) => {
    if (idx >= 0 && STEPS.indexOf(to) > idx) go(STEPS.indexOf(to));
  };

  /* ---------------------------------------------------------------- the real actions */
  let pollT = 0;
  function listen() {
    for (const o of offs.splice(0)) {
      try {
        o();
      } catch (e) {
        /* ok */
      }
    }
    // 1. hear it: the transport starts (Space, the play button, anything)
    if (engine?.on)
      offs.push(
        engine.on('transport', (e) => {
          if (e?.playing && step() === 'listen') advance('take');
        }),
      );
    clearInterval(pollT);
    pollT = setInterval(() => {
      if (step() === 'listen' && engine?.playing) advance('take');
    }, 400);
    // 2. take one: anything lands in the capture log (a hum, a tapped beat, a phrase on the keys or a MIDI keyboard)
    if (app.input?.on)
      offs.push(
        app.input.on('capture', ({ what, phrase } = {}) => {
          if (what !== 'add' || !phrase || phrase.kind === 'audio') return; // (a recording is kept as audio: the tour is about notes)
          if (phrase.rec) return; // a take recorded with R is in the song already
          if (idx >= 0 && idx <= 2) {
            take.phrase = phrase;
            if (step() === 'keep') paint();
            else advance('keep');
          }
        }),
      );
    // 3. keep it: a clip of yours with notes in it lands on a track (Keep in Sketch, or drawn in the piano roll)
    // 4/5. an agent's take: a request on screen, or an agent's notes in the song
    offs.push(
      store.on('change', (e) => {
        // another song (Undo of Make your own, New song, a demo, a Recent song): what the tour knew was the last song's.
        // Someone else's (a link): the tour steps aside until one of yours is back
        if (idx >= 0 && e.kind === 'load') {
          if (elsewhere()) pause();
          else songLoaded();
          return;
        }
        // the loop the tour set, changed by anyone but the tour (a drag, L, Loop this clip, an undo): it's theirs now, and
        // Close leaves it as it is
        if (lent?.loop && !lent.touched && !settingLoop && !sameLoop(store.get().loop, lent.loop)) {
          lent.touched = true;
          save('on');
        }
        if (idx < 0 || e.kind !== 'do' || e.txn?.audition) return;
        const s = step();
        if (e.by === 'you' && (s === 'listen' || s === 'take' || s === 'keep')) {
          const c = keptClip(e);
          if (c) {
            Object.assign(take, c, { rec: null, recN: null });
            select(c);
            advance('ask');
            // a take recorded with R: the recorder names it once its commit is done (just after this change)
            setTimeout(() => {
              const r = recorded(e);
              if (r && idx >= 0) {
                take.rec = r;
                take.drums = take.drums || r.drums;
                save('on');
                if (step() === 'ask') paint();
              }
            }, 0);
          }
          return;
        }
        // more of your notes in take one's clip (squares still being drawn in the Beat tab): the card counts them
        if (e.by === 'you' && s === 'ask' && take.clip && !take.rec && e.ops.some((o) => o.clip === take.clip)) {
          const f = store.findClip(take.clip);
          if (f) {
            take.notes = f.clip.notes.filter((n) => (n.by || f.clip.by) === 'you').length;
            save('on');
            paint();
          }
          return;
        }
        // keys or a hum over the beat (the first minute): the take is in; next, the agent. (A hum kept from Sketch rather
        // than recorded with R is a clip of yours on a pitched track.)
        if (e.by === 'you' && s === 'ask' && (fm === 'keys' || fm === 'hum')) {
          const kc = fm === 'hum' && !take.keys && e.ops.some((o) => o.type === 'clip.add') ? keptClip(e) : null;
          setTimeout(() => {
            const k = kc && !kc.drums ? store.track(kc.track) : null;
            const r =
              recorded(e) ||
              (k
                ? {
                    track: kc.track,
                    clip: kc.clip,
                    notes: kc.notes,
                    drums: false,
                    summary: `Your hum is in: ${plural(kc.notes, 'note')} on ${k.name}.`,
                  }
                : null);
            // (the card's head and body say it now: a note under them saying it again was one too many)
            if (r && !r.drums && idx >= 0) {
              take.keys = { track: r.track, clip: r.clip, notes: r.notes || 0 };
              save('on');
              note = '';
              announce(`${r.summary} Now hand it to the agent.`);
              paint();
            }
          }, 0);
          return;
        }
        if (store.isAgent(e.by) && (s === 'ask' || s === 'pick') && e.ops.some((o) => /^(notes|clip)\./.test(o.type))) {
          two.by = e.by;
          two.label = e.txn?.label || '';
          advance('done');
        }
      }),
    );
    offs.push(
      ui.on('agent:request', ({ req } = {}) => {
        if (!req || req.kind !== 'variations') return;
        if (req.status === 'pending' && step() === 'ask') {
          two.by = req.by;
          two.takes = (req.cards || []).filter((c) => !c.original).length;
          advance('pick');
          return;
        }
        if (req.status === 'done' && (step() === 'pick' || step() === 'ask')) {
          if (req.picked != null && req.picked >= 0 && req.result?.picked !== 'original') {
            two.by = req.by;
            two.label = req.result?.picked || '';
            advance('done');
          } else {
            note = 'You kept yours as it was. Ask again for another take, or skip this step.';
            if (step() === 'pick') go(STEPS.indexOf('ask'));
            paintNote();
          }
        }
      }),
    );
    // the first minute's card follows the recorder: counting in, recording, each pass
    const rec = app.input?.recorder;
    if (rec?.on) {
      offs.push(
        rec.on('state', () => {
          if (fm && (step() === 'take' || step() === 'ask')) paint();
        }),
      );
      offs.push(
        rec.on('pass', () => {
          if (fm && (step() === 'take' || step() === 'ask')) paint();
        }),
      );
    }
    if (app.agent?.on)
      offs.push(
        app.agent.on('user', () => {
          if (step() === 'ask') {
            note = `It’s listening to your part. Its takes show up in ${agentAt(app)}.`;
            paintNote();
          }
        }),
      );
    if (app.agent?.on)
      offs.push(
        app.agent.on('error', (e) => {
          if (step() === 'ask' && e?.code === 'noagent') {
            note = 'No agent is on yet: press the button to use the demo agent.';
            paintNote();
          }
        }),
      );
  }
  function keptClip(e) {
    const ids = new Set(Object.values(e.created || {}));
    for (const o of e.ops) if (o.type === 'notes.add' || o.type === 'notes.replace') ids.add(o.clip);
    for (const id of ids) {
      const f = store.findClip(id);
      if (
        f &&
        f.clip.kind === 'notes' &&
        f.clip.notes.length &&
        f.clip.notes.some((n) => (n.by || f.clip.by) === 'you')
      ) {
        const drums = take.phrase?.kind === 'drums' || f.track.instrument?.device === 'core.drums';
        // (your notes: not the house beat you tapped into)
        return {
          track: f.track.id,
          clip: f.clip.id,
          notes: f.clip.notes.filter((n) => (n.by || f.clip.by) === 'you').length,
          drums,
        };
      }
    }
    return null;
  }
  // the recorder's commit behind a change (input/recorder.js): { track, clip, name, bars, notes, drums, summary } or null
  function recorded(e) {
    const last = app.input?.recorder?.last;
    if (!last || !last.ok || !last.txn || last.txn !== e.txn?.id) return null;
    const pt = last.parts?.[0];
    if (!pt) return null;
    const tr = store.track(pt.track);
    const drums = pt.mode === 'layer' && !!tr && isDrumTrack(tr);
    // (a steady lean taken out: the card says so, with the number, so "in the song" is never said over a take that came
    // out wrong without a word; input/recorder.js leanWords)
    const lean = last.lean
      ? leanWords({ lean: last.lean.beats, ms: last.lean.ms, opening: last.lean.opening, kind: drums ? 'hit' : 'note' })
      : '';
    return {
      track: pt.track,
      clip: pt.clips?.[pt.clips.length - 1] || null,
      name: pt.name,
      bars: pt.bars,
      notes: pt.notes,
      drums,
      summary: last.summary || '',
      lean,
    };
  }
  function select(c) {
    try {
      ui.select({ track: c.track, clip: c.clip, notes: [] });
    } catch (e) {
      /* ok */
    }
  }

  /* ---------------------------------------------------------------- doing it from the card (the same real actions) */
  const inp = () => app.input;
  // Hum it: Sketch on Hum it and a take into the song (a bar of count-in with the click, then sing; Stop keeps it), the
  // same as its big Hum button; a hum already going (H) stops
  const doHum = async () => {
    const i = inp();
    if (!i) return;
    if (i.hum?.active && i.recorder?.state === 'idle') {
      i.hum.stop();
      return;
    }
    ui.show?.('sketch');
    if (!ui.isOpen?.('bottom')) ui.setOpen?.('bottom', true);
    i.emit?.('sketch:mode', 'hum');
    try {
      if (i.recorder?.state === 'idle') await i.recorder.record({ hum: true });
    } catch (e) {
      ui.toast(e.message, { kind: 'bad' });
    }
  };
  const doPlay = () => {
    ui.show?.('sketch');
    inp()?.emit?.('sketch:mode', 'play');
    if (!inp()?.qwerty?.on) inp()?.qwerty?.toggle?.(true);
  };
  // Show the Keep button: open Sketch, bring the button into view (the detail pane scrolls; on a phone it sits below
  // the fold), move focus to it so Enter keeps the take, then light it up. The first one that is on screen: the hum
  // panel's Keep sits in a hidden row unless a hum is live.
  const seen = (b) =>
    (typeof b.checkVisibility === 'function' ? b.checkVisibility() : !!b.offsetParent) && b.getClientRects().length > 0;
  const overlap = (a, b) => {
    const r = a.getBoundingClientRect(),
      q = b.getBoundingClientRect();
    return r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom;
  };
  const showKeep = () => {
    ui.show?.('sketch');
    if (!ui.isOpen?.('bottom')) ui.setOpen?.('bottom', true);
    setTimeout(() => {
      const b = [...document.querySelectorAll('.sk-acts .ew-btn-primary, .sk-keep')].find(seen);
      if (!b) return;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // musical typing's strip floats over the bottom of the screen; the take is in, so if the strip covers Keep it
      // steps aside (` brings it back)
      const qw = inp()?.qwerty,
        strip = document.querySelector('.ew-qw');
      const typing = !!(qw?.on && strip && !strip.hidden);
      b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: still || typing ? 'auto' : 'smooth' });
      if (typing && overlap(strip, b)) {
        qw.toggle?.(false);
        note = 'Musical typing is off so it doesn’t cover Keep: ` turns it back on.';
        paintNote();
      }
      b.focus({ preventScroll: true });
      b.classList.add('ob-glow');
      setTimeout(() => b.classList.remove('ob-glow'), 2400);
    }, 60);
  };
  // The first minute: a 2-bar loop at the marker with the click, the pads on, the loop running before a sound is made
  const bpbNow = () => beatsPerBar(store.get().meter);
  function loopAtMarker() {
    const p = store.get(),
      bpb = bpbNow();
    const lp = p.loop || {};
    const at = Math.floor((app.transport?.marker?.beat || 0) / bpb + 1e-9) * bpb;
    // a loop of two bars or less that is on stays as it is; otherwise two bars from the marker's bar
    if (lp.on && lp.end - lp.start > 0 && lp.end - lp.start <= 2 * bpb + 1e-9) return lp.start;
    const loop = { on: true, start: at, end: at + 2 * bpb },
      was = p.loop ? { ...p.loop } : null; // (copied first: the store changes it in place)
    settingLoop = true;
    let ok = false;
    try {
      ok = store.dispatch(
        { type: 'project.set', patch: { loop } },
        { by: 'you', label: 'loop 2 bars to record over' },
      ).ok;
    } finally {
      settingLoop = false;
    }
    if (ok) {
      // what it gives back is what was there before the tour first set a loop; once you've changed the loop yourself,
      // what was there is yours (so a loop the tour sets over it gives yours back)
      lent = {
        ...(lent || {}),
        loop: { ...loop },
        was: lent?.loop && !lent.touched ? lent.was : was,
        song: p.id || null,
        touched: false,
      };
      save('on');
    }
    return at;
  }
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const sameLoop = (a, b) => !!a && !!b && !!a.on === !!b.on && near(a.start, b.start) && near(a.end, b.end);
  // The tour's work is over (That's an overdub, Done, Close): it puts back what it lent the first minute. The loop it
  // set goes (the song's own loop comes back, or none) only on the song it set it on, only as it left it, and only if
  // nobody has changed it since; that is the house tidying up, signed so, never you. Musical typing goes off if the
  // tour turned it on. (Left on, the loop made Space ignore the marker and typing ate the L key.)
  function giveBack() {
    giveClickBack();
    const l = lent;
    lent = null;
    if (!l) return;
    const p = store.get(),
      cur = p.loop;
    if (l.loop && !l.touched && l.song != null && l.song === p.id && !elsewhere() && sameLoop(cur, l.loop)) {
      const back = l.was ? { ...l.was } : { on: false, start: cur.start, end: cur.end };
      store.dispatch(
        { type: 'project.set', patch: { loop: back } },
        { by: 'overdub', label: 'the loop as it was before the tour' },
      );
    }
    if (l.typing && app.input?.qwerty?.on) app.input.qwerty.toggle?.(false);
    lendBack(l);
  }
  // the click and the pads are the studio's, not the song's: the click goes off if the tour turned it on (it is kept in
  // this browser, so left on it clicked in every song after), and so does Tap if the tour turned it on (it keeps L, the
  // loop key, and the home row)
  function lendBack(l) {
    if (l.click && engine?.metronome) {
      try {
        app.transport?.click?.set?.({ on: false });
      } catch (e) {
        /* ok */
      }
      if (engine.metronome) engine.metronome = false;
    }
    const tp = l.tap,
      inq = app.input;
    if (tp && inq) {
      if (tp.sketch && tp.sketch !== 'tap' && inq.sketchMode === 'tap') inq.emit?.('sketch:mode', tp.sketch);
      if (tp.mode !== 'tap' && inq.mode === 'tap') inq.setMode?.(tp.mode === 'qwerty' ? null : tp.mode);
    }
  }
  // Another song came in mid-tour (Undo of Make your own, New song, a demo, a Recent song): the take, the agent's and
  // the loop the tour set were the last song's, so the tour starts over on this one (the loop isn't touched: it's this
  // song's own now); the click and Tap go back as they were
  function songLoaded() {
    const l = lent;
    lent = null;
    if (l) {
      if (l.typing && app.input?.qwerty?.on) app.input.qwerty.toggle?.(false);
      lendBack(l);
    }
    Object.assign(take, {
      phrase: null,
      track: null,
      clip: null,
      notes: 0,
      drums: false,
      rec: null,
      recN: null,
      keys: null,
    });
    Object.assign(two, { by: null, label: null });
    fm = null;
    go(0);
  }
  // Someone else's song came in mid-tour (a link): the tour isn't theirs to run on, so it steps aside (the card goes,
  // the click and Tap go back as they were, where it was is kept) and picks up again when a song of yours is back on
  // screen (Back to my song, New song, a reload). The loop it set stays with your song, as it does for any other song.
  function pause() {
    if (idx < 0) return;
    const l = lent;
    lent = null;
    if (l) {
      if (l.typing && app.input?.qwerty?.on) app.input.qwerty.toggle?.(false);
      lendBack(l);
    }
    save('on');
    idx = -1;
    fm = null;
    paused = true;
    for (const o of offs.splice(0)) {
      try {
        o();
      } catch (e) {
        /* ok */
      }
    }
    clearInterval(pollT);
    if (said) {
      clearTimeout(said.timer);
      said = null;
    }
    unfolded = false;
    if (card) {
      const c = card;
      card = null;
      live = null;
      lastSaid = '';
      c.classList.add('out');
      setTimeout(() => c.remove(), 200);
    }
    ui.emit('onboard', { step: null, index: -1, state: 'paused' });
  }
  // The loop plays: started at its start, or, when the song is already playing somewhere outside it (listened to past
  // bar 2, say), the playhead goes to its start. (It used to run on past the loop while the card said it was looping.)
  async function rolling(from) {
    if (engine && !engine.metronome) {
      lent = { ...(lent || {}), click: true };
      save('on');
    }
    try {
      app.transport?.click?.set?.({ on: true });
    } catch (e) {
      if (engine) engine.metronome = true;
    }
    if (!engine) return;
    if (engine.playing) {
      const lp = store.get().loop,
        b = engine.beat;
      if (lp?.on && !(b >= lp.start - 1e-6 && b < lp.end)) {
        try {
          engine.seek(lp.start);
        } catch (e) {
          /* ok */
        }
      }
      return;
    }
    try {
      await engine.start?.();
      await engine.play(from);
    } catch (e) {
      ui.toast('Could not play: ' + e.message, { kind: 'bad' });
    }
  }
  // A track of your own to record onto: one whose clips are all yours (or that has none). In a song with parts by
  // someone else (a demo) the beat and the keys never go over theirs: they get a new track.
  const yours = (t) => t.clips.every((c) => (c.by || t.by) === 'you');
  function disarmOthers(t) {
    // (selecting arms it; an older arm elsewhere would take the take, so it goes)
    const armed = store.get().tracks.filter((x) => x.arm && x.id !== t.id);
    if (armed.length)
      store.dispatch(
        armed.map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } })),
        { by: 'you', label: 'disarm' },
      );
  }
  async function firstMinute(kind = 'tap') {
    if (kind === 'keys') return keysOver();
    const p = store.get();
    const drums = (x) => isDrumTrack(x) && yours(x);
    let t = p.tracks.find((x) => x.id === ui.state.selection.track && drums(x)) || p.tracks.find(drums);
    // (the loop first, then the track: the track's adding is the newest change when the take comes, so the take and
    // the track it made are one undo step, input/recorder.js)
    const from = loopAtMarker();
    if (!t) {
      // the song's own drums stay theirs: your beat gets its own track beside them
      const name = p.tracks.some(isDrumTrack) ? 'Taps' : 'Drums';
      const r = store.dispatch(
        {
          type: 'track.add',
          ref: 'd',
          track: { name, kind: 'instrument', instrument: { device: 'core.drums', params: {} } },
        },
        { by: 'you', label: `add ${name} to tap a beat on` },
      );
      if (!r.ok) {
        ui.toast('Could not add a drum track: ' + r.error, { kind: 'bad' });
        return false;
      }
      t = store.track(r.created.d);
    }
    try {
      ui.select({ track: t.id, clip: null, notes: [] });
    } catch (e) {
      /* ok */
    }
    disarmOthers(t);
    ui.show?.('sketch');
    if (!ui.isOpen?.('bottom')) ui.setOpen?.('bottom', true);
    // (what the pads and Sketch's tab were before: Sketch on Tap it keeps the pads live, so it goes back too)
    if (inp() && !lent?.tap && (inp().mode !== 'tap' || inp().sketchMode !== 'tap'))
      lent = { ...(lent || {}), tap: { mode: inp().mode || null, sketch: inp().sketchMode || null } };
    inp()?.emit?.('sketch:mode', 'tap');
    inp()?.setMode?.('tap');
    if (idx < 0) start({ force: true, restart: true });
    fm = 'tap';
    if (step() !== 'take') go(STEPS.indexOf('take'));
    note = '';
    paint();
    await rolling(from);
    paint();
    return true;
  }
  // Keys over it: a pitched track (Keys if there is none), musical typing, the same loop playing
  async function keysOver() {
    const p = store.get();
    const anyPitched = (x) => x.kind === 'instrument' && !isDrumTrack(x);
    // (a pitched track of yours: the song's own chords are never taken over, or muted under a take)
    const pitched = (x) => anyPitched(x) && yours(x);
    const had = take.keys?.track && store.track(take.keys.track);
    let t =
      (had && pitched(had) ? had : null) ||
      p.tracks.find((x) => x.id === ui.state.selection.track && pitched(x)) ||
      p.tracks.find(
        (x) => pitched(x) && /key|piano|organ|rhodes|synth/i.test(`${x.name} ${x.instrument?.device || ''}`),
      ) ||
      p.tracks.find(pitched);
    if (!t) {
      const name = p.tracks.some(anyPitched) ? 'Tune' : 'Keys';
      const r = store.dispatch(
        {
          type: 'track.add',
          ref: 'k',
          track: { name, kind: 'instrument', instrument: { device: 'core.keys', params: {} } },
        },
        { by: 'you', label: `add ${name} to play over the beat` },
      );
      if (!r.ok) {
        ui.toast('Could not add a track: ' + r.error, { kind: 'bad' });
        return false;
      }
      t = store.track(r.created.k);
    }
    try {
      ui.select({ track: t.id, clip: null, notes: [] });
    } catch (e) {
      /* ok */
    }
    disarmOthers(t);
    ui.show?.('sketch');
    inp()?.emit?.('sketch:mode', 'play');
    if (!inp()?.qwerty?.on) {
      inp()?.qwerty?.toggle?.(true);
      lent = { ...(lent || {}), typing: true };
    }
    fm = 'keys';
    note = '';
    const from = loopAtMarker();
    if (idx >= 0) paint();
    await rolling(from);
    if (idx >= 0) paint();
    return true;
  }
  // Hum over it (the beat's card, and Tap it's take line: ui/sketch.js): Sketch on Hum it, and the tune given room before
  // anything records. A short beat runs 8 bars (Make it 8 bars, app.song.longer: one undo step by you, the loop growing
  // with it), so a hum is one take over up to 8 bars, not four 2-bar takes in a folder. The click goes off while you hum
  // (its ticks would bleed into the mic, and a take would borrow it: so the take's click goes too) and comes back after
  // the hum's take. The first time this session Sketch's line says headphones keep the drums out of the hum (the browser
  // can't tell whether they're in). No Onto choice is set: a hum goes onto a new track by the aim's own rule.
  let clickBack = null,
    clickHooked = false,
    sawRec = false;
  function giveClickBack() {
    const c = clickBack;
    clickBack = null;
    sawRec = false;
    if (!c) return;
    try {
      app.transport?.click?.set?.(c);
    } catch (e) {
      if (engine) engine.metronome = !!c.on;
    }
  }
  function hookClickBack() {
    if (clickHooked || !inp()) return;
    clickHooked = true;
    // (the click's settings are kept in this browser: a page left mid-hum gives it back first)
    addEventListener('pagehide', () => giveClickBack());
    store.on('change', (e) => {
      if (e?.kind === 'load') giveClickBack();
    });
    // (after the hum's take: a take recorded with R ends, or a hum in Sketch comes back as a take)
    inp().recorder?.on?.('state', (e) => {
      if (!clickBack) return;
      if (e?.state === 'rec') sawRec = true;
      else if (e?.state === 'idle' && sawRec) giveClickBack();
    });
    inp().hum?.on?.('take', (tk) => {
      if (clickBack && tk && inp().recorder?.state === 'idle') giveClickBack();
    });
  }
  async function humOver() {
    const lines = [];
    if (app.song?.longerPlan?.({ bars: 8 })?.ok) {
      const r = app.song.longer({ bars: 8, toast: false, cover: true });
      if (r?.ok) lines.push('The beat runs 8 bars now, so a tune has room.');
    }
    hookClickBack();
    const ck = app.transport?.click?.get?.();
    if (ck && (ck.on || ck.takes)) {
      if (!clickBack) clickBack = { on: !!ck.on, takes: !!ck.takes };
      app.transport.click.set({ on: false, takes: false });
    } else if (!ck && engine?.metronome) {
      if (!clickBack) clickBack = { on: true };
      engine.metronome = false;
    }
    if (!headphonesSaid) {
      headphonesSaid = true;
      lines.push('Headphones keep the drums out of your hum.');
    }
    ui.show?.('sketch');
    if (!ui.isOpen?.('bottom')) ui.setOpen?.('bottom', true);
    if (inp()?.qwerty?.on) inp().qwerty.toggle?.(false);
    inp()?.emit?.('sketch:mode', 'hum');
    if (inp()?.mode === 'tap') inp().setMode?.(null);
    app.sketch?.say?.(lines.join(' ') || null);
    if (idx >= 0) {
      fm = 'hum';
      note = lines[0] || '';
      if (step() === 'ask') paint();
    }
    return true;
  }
  // Make your own (the welcome's main action, the Song menu's too): a new song (the one on screen goes to Recent songs,
  // the toast's Undo brings it back), then the first minute on it: a beat, then a tune over it
  async function ownSong() {
    const ex = app.exporter;
    if (!ex?.newSong) {
      ui.toast('The Song menu is still loading.');
      return false;
    }
    await ex.newSong();
    if (store.get().tracks.length) return false; // (it didn't go: the song on screen stays)
    // a fresh start: nothing from a tour on the last song carries over (its take, the agent's, the loop it lent)
    Object.assign(take, {
      phrase: null,
      track: null,
      clip: null,
      notes: 0,
      drums: false,
      rec: null,
      recN: null,
      keys: null,
    });
    Object.assign(two, { by: null, label: null });
    lent = null;
    return firstMinute('tap');
  }
  function askAgent() {
    const ag = app.agent;
    if (!ag) {
      ui.toast('The agent isn’t loaded in this tab.', { kind: 'bad' });
      return;
    }
    if (!ag.provider) ag.useMock(true);
    if (take.keys?.clip && store.findClip(take.keys.clip)) select(take.keys);
    else if (take.clip && store.findClip(take.clip)) select(take);
    if (ag.busy) {
      ui.show?.('agent');
      return;
    }
    ui.emit('agent:compose', { text: 'Play a take over my part.', send: true });
  }

  /* ---------------------------------------------------------------- the card */
  function title(name) {
    return h('div.ob-t#ob-title', { tabindex: -1 }, name);
  }
  // one live region for the card's whole life (a fresh node each step is never read out): each step's title and first
  // line go in it, and the asides (notes) after them
  let live = null,
    lastSaid = '';
  function announce(text) {
    if (!live || !text || text === lastSaid) return;
    lastSaid = text;
    live.textContent = '';
    setTimeout(() => {
      if (live) live.textContent = text;
    }, 40);
  }
  function paintNote() {
    const n = card?.querySelector('.ob-note');
    if (n) {
      n.textContent = note;
      n.hidden = !note;
    }
    if (note) announce(note);
  }
  // touch: there's no Space bar or letter keys to point at
  const touch = () => {
    try {
      return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
    } catch (e) {
      return false;
    }
  };
  // A phone (docs/FRESH-EYES-4.md, the beginner's problem 2): the card is a one-line strip at the foot of the arranger,
  // right above the sheet, so the song (and your clip landing in it) stays in sight at every step: the step in a line,
  // its main button and Close; a tap on the line opens the whole card (Fold puts it back). While it is up, no toast
  // covers the song or the card: what a toast would say (and its Undo) is the strip's line for as long as it would show.
  // (any screen that narrow, touch or not: the whole card there covered every track's header)
  const phoneStrip = () => {
    try {
      return matchMedia('(max-width: 640px)').matches;
    } catch (e) {
      return false;
    }
  };
  const toast0 = ui.toast;
  if (typeof toast0 === 'function') {
    ui.toast = (text, o = {}) => {
      if (!(card && idx >= 0 && phoneStrip())) return toast0(text, o);
      if (said) clearTimeout(said.timer);
      const el = h('div.ew-toast.ob-diverted');
      el.remove = () => {
        if (said?.el === el) {
          clearTimeout(said.timer);
          said = null;
          paint();
        }
      };
      const parts = (Array.isArray(text) ? text : [text])
        .map((x) => (typeof x === 'string' ? x.replace(/`([^`\n]{1,12})`/g, '$1') : x))
        .filter((x) => x != null && x !== '');
      const ms = o.action ? Math.max(o.ms || 3200, 10000) : o.ms || 3200;
      said = { parts, action: o.action || null, kind: o.kind || 'info', el };
      said.timer = setTimeout(() => {
        if (said?.el === el) {
          said = null;
          paint();
        }
      }, ms);
      announce(parts.map((x) => (typeof x === 'string' ? x : x?.textContent || '')).join(''));
      paint();
      return el;
    };
  }
  // the first minute's card: what to press, then what is happening (the recorder's state and pass)
  function firstMinuteBody(coarse, kbd) {
    const r = app.input?.recorder,
      st = r?.state || 'idle',
      lp = store.get().loop,
      bpb = bpbNow();
    const bars = lp?.on ? `bars ${Math.round(lp.start / bpb) + 1}–${Math.round(lp.end / bpb)}` : 'the loop';
    const pads = coarse ? ['the pads'] : [kbd('F'), ' ', kbd('J'), ' ', kbd('K'), ' ', kbd('L')];
    // (the numbers count the bar in, 1 2 3 4, with the lamps: you come in on the next 1)
    const last = Math.ceil(bpb - 1e-9);
    if (st === 'count')
      return [
        title('Get ready.'),
        h(
          'p',
          `Counting in: watch the numbers ${coarse ? 'over the pads' : 'over the beat in Sketch'} count 1 to ${last}, and come in right after the ${last}.`,
        ),
      ];
    if (st === 'rec') {
      const pass = (r.live?.()?.pass || 0) + 1;
      return [
        title('Tap along.'),
        h(
          'p',
          `Recording, time ${pass} round the loop. Each time round layers on the last, so add a little more every time. `,
          ...(coarse ? ['Tap ■'] : ['Press ', kbd('Space')]),
          ' when it sounds right: it’s in the song.',
        ),
        h('p.ob-small', 'Tap on ', ...pads, '.'),
      ];
    }
    return [
      title('Tap a beat.'),
      h(
        'p',
        `The loop is playing ${bars} over and over with a click, and the lamps ${coarse ? 'over the pads' : 'in Sketch'} light on every beat. `,
        ...(coarse
          ? ['Tap ● (top): a bar counts in, then tap the pads along with it.']
          : ['Press R (or ●, top): a bar counts in, then tap along on ', ...pads, '.']),
      ),
      h(
        'p.ob-small',
        `Each time round the loop layers on the last, and a hit you play again replaces the one you missed. Nothing records until you ${coarse ? 'tap ●' : 'press R'}.`,
      ),
    ];
  }
  // On a phone, while a take counts in or records, the card is one line at the foot of the arranger, so the hits
  // landing in the lane and the beat stay in sight: what is happening and how to stop. null when the card is whole.
  function miniLine(coarse) {
    const r = app.input?.recorder,
      st = r?.state || 'idle',
      s = step();
    if (!coarse || !fm || (st !== 'rec' && st !== 'count') || (s !== 'take' && s !== 'ask')) return null;
    if (st === 'count') return `Counting in: come in right after the ${Math.ceil(bpbNow() - 1e-9)}.`;
    const pass = (r.live?.()?.pass || 0) + 1;
    if (fm === 'hum' && s === 'ask') return 'Recording your hum. ■ keeps it.';
    // (one line at 390 px: "■ keeps it" must not be the part that's cut off)
    return fm === 'keys' && s === 'ask'
      ? `Time ${pass} round, each a new take. ■ keeps it.`
      : `Time ${pass} round, layering on. ■ keeps it.`;
  }
  // the strip's line for a step (a phone): what to do, in a few words
  function stripLine(s, coarse) {
    const r = take.rec;
    if (s === 'listen') return 'Tap ▶ (top) to hear it first.';
    if (s === 'take' && fm === 'tap')
      return coarse ? 'Tap a beat: tap ● (top), then the pads.' : 'Tap a beat: R, then F J K L.';
    if (s === 'take') return 'Take one is yours: tap, hum or play it.';
    if (s === 'ask' && r && take.keys)
      return `${fm === 'hum' ? 'Your hum is in' : 'Your keys are in'}: ${plural(take.keys.notes || 0, 'note')}. Next, the agent.`;
    if (s === 'ask' && r && fm === 'keys' && !take.keys)
      return 'Your beat is in. Tap ● (top) and play the keys over it.';
    if (s === 'ask' && r && fm === 'hum' && !take.keys) return 'Your beat is in. Tap ● (top) and hum over it.';
    if (s === 'ask' && r)
      return r.drums
        ? `Your beat is in: ${plural(r.notes || 0, 'hit')}, ${r.bars}.`
        : `Your part is in: ${plural(r.notes || 0, 'note')}, ${r.bars}.`;
    if (s === 'done')
      return two.by ? `${store.author(two.by).name} played over you.` : `In the song: your ${playedText(played())}.`;
    return '';
  }
  // "Make it 8 bars" (the last card): the song repeats to 8 bars (ui/sketch.js app.song.longer), the card stays
  function makeLonger() {
    const r = app.song?.longer?.({ bars: 8 });
    if (r?.ok) {
      note = r.summary;
      paint();
    }
  }
  function paint({ moved = false } = {}) {
    if (idx < 0) return;
    const s = step();
    const p = store.get();
    const listening = !!app.share?.listening;
    const coarse = touch();
    const kbd = (k) => h('kbd', k);
    // buttons are words on a key; only the agent's carries a mark (its stroke)
    const btn = (label, run, cls = '', ic = null) =>
      h(
        'button.btn.ew-btn.ew-btn-small' + cls,
        { type: 'button', onclick: run },
        ic === 'agent' ? icon(ic, { size: 13 }) : null,
        label,
      );
    let body = [];
    let longer = false;
    const mini = miniLine(coarse);
    if (mini) {
      body = [h('p.ob-line', mini)];
    } else if (s === 'listen') {
      body = [
        title('Hear it first.'),
        h(
          'p',
          ...(coarse ? ['Tap ▶ (top) '] : ['Press ', kbd('Space'), ' (or ▶, top) ']),
          `to hear “${p.title}”. Every part is signed by who played it: a person in warm ink, like `,
          h('span.by.by-human.ob-warm', 'you'),
          ', an agent in cool, like ',
          h('span.by.by-agent.ob-cool', 'Claude'),
          '.',
        ),
      ];
    } else if (s === 'take' && fm === 'tap') {
      body = firstMinuteBody(coarse, kbd);
    } else if (s === 'take') {
      body = [
        title('Take one is yours.'),
        h(
          'p',
          'Tap a beat, hum a tune or play the computer keys. Everything you play is kept, even before you press record.',
        ),
        h(
          'div.ob-acts',
          btn('Tap a beat', () => firstMinute('tap'), '.ew-btn-primary', 'tap'),
          btn('Hum it', doHum, '', 'hum'),
          btn('Play the keys', doPlay, '', 'keys'),
        ),
        coarse
          ? null
          : h(
              'p.ob-small',
              kbd('H'),
              ' hums (again to stop), ',
              kbd('T'),
              ' then ',
              kbd('F'),
              kbd('J'),
              kbd('K'),
              kbd('L'),
              ' taps, ',
              kbd('`'),
              ' then ',
              kbd('A'),
              kbd('S'),
              kbd('D'),
              '… plays',
            ),
      ];
    } else if (s === 'keep') {
      const ph = take.phrase;
      const n = ph?.notes?.length || 0;
      body = [
        title(
          ph
            ? `Take one is in: ${plural(n, ph.kind === 'drums' ? 'hit' : 'note')}, ${SRC_WORD[ph.src] || 'captured'}.`
            : 'Keep it.',
        ),
        h('p', 'Press Keep (in Sketch, below) and it goes into the song on a track, signed by you.'),
        h('div.ob-acts', btn('Show me', showKeep, '', 'check')),
      ];
    } else if (s === 'ask' && take.rec) {
      const mock = !app.agent?.provider || app.agent.provider === 'mock';
      const r = take.rec,
        st = app.input?.recorder?.state || 'idle';
      const what = `${plural(r.notes || 0, r.drums ? 'hit' : 'note')} on ${r.name}, ${r.bars}.`;
      const countLine = () => h('p', `Counting in: come in right after the ${Math.ceil(bpbNow() - 1e-9)}.`);
      const keysLine =
        fm === 'hum'
          ? st === 'count'
            ? countLine()
            : st === 'rec'
              ? h('p', 'Recording your hum. ', ...(coarse ? ['■ '] : [kbd('Space'), ' ']), 'keeps it.')
              : take.keys
                ? null
                : h(
                    'p',
                    ...(coarse ? ['Tap ● and hum: '] : [kbd('R'), ', then hum: ']),
                    'the tune goes onto a track of its own, and ',
                    ...(coarse ? ['■'] : [kbd('Space')]),
                    ' keeps it.',
                  )
          : fm !== 'keys'
            ? null
            : st === 'count'
              ? countLine()
              : st === 'rec'
                ? h(
                    'p',
                    `Recording, time ${(app.input.recorder.live?.()?.pass || 0) + 1} round. Each time round is a new take; `,
                    ...(coarse ? ['● '] : [kbd('Space'), ' ']),
                    'keeps the last, the others wait underneath.',
                  )
                : h(
                    'p',
                    ...(coarse
                      ? ['Tap ● and play the keys: ']
                      : [kbd('R'), ', then play ', kbd('A'), kbd('S'), kbd('D'), kbd('F'), '…: ']),
                    'each time round the loop is a new take, and ',
                    ...(coarse ? ['■'] : [kbd('Space')]),
                    ' keeps it.',
                  );
      const over = fm === 'keys' || fm === 'hum';
      // (the tune over the beat is in: the card says so, and what's next, rather than still announcing the beat)
      const over2 = take.keys && store.track(take.keys.track);
      body = [
        title(
          over2
            ? fm === 'hum'
              ? 'Your hum is in the song.'
              : 'Your keys are in the song.'
            : r.drums
              ? 'Your beat is in the song.'
              : 'Your part is in the song.',
        ),
        over2
          ? h(
              'p',
              `${plural(take.keys.notes || 0, 'note')} on ${over2.name}, over ${plural(r.notes || 0, r.drums ? 'hit' : 'note')} on ${r.name}. Hand both to the agent: it plays a part over them, signed, and you keep it or not.`,
            )
          : h(
              'p',
              what,
              r.lean ? ` ${r.lean}` : '',
              fm === 'keys'
                ? ' Play a tune over it on its own track, then hand both to the agent.'
                : fm === 'hum'
                  ? ' Hum a tune over it on its own track, then hand both to the agent.'
                  : ' Next, hum a tune over it, play the keys, or let the agent play a part over it.',
            ),
        keysLine,
        h(
          'div.ob-acts',
          over ? null : btn('Hum over it', () => humOver(), '', 'hum'),
          over ? null : btn('Play keys over it', () => keysOver(), '', 'keys'),
          btn(mock ? 'Ask the demo agent' : 'Ask for a take', askAgent, '.ew-btn-agent', 'agent'),
        ),
      ];
    } else if (s === 'ask') {
      const mock = !app.agent?.provider || app.agent.provider === 'mock';
      body = [
        title('Your part is in the song.'),
        h(
          'p',
          `Your ${plural(take.notes || 0, word())} ${take.notes === 1 ? 'is' : 'are'} on a track, signed `,
          h('span.by.by-human.ob-warm', 'you'),
          `. Next, let the agent play a part over ${take.notes === 1 ? 'it' : 'them'}.`,
        ),
        h('div.ob-acts', btn(mock ? 'Ask the demo agent' : 'Ask for a take', askAgent, '.ew-btn-agent', 'agent')),
        mock
          ? h(
              'p.ob-small',
              'No key needed: the demo agent is scripted, but it uses the real tools. Everything it does is signed, and undoable.',
            )
          : h('p.ob-small', `Or type your own ask in ${agentAt(app)}`, ...(coarse ? ['.'] : [' (', kbd('⌘/'), ').'])),
      ];
    } else if (s === 'pick') {
      body = [
        title('Pick the one you like.'),
        h(
          'p',
          `The agent played ${takesWord(two.takes)} over yours in ${agentAt(app)}. Hold one to hear it with your part, then Keep the one you like.`,
        ),
        h(
          'div.ob-acts',
          btn('Show me', () => ui.show?.('agent'), '', 'agent'),
        ),
      ];
    } else if (s === 'done') {
      const who = two.by ? store.author(two.by).name : 'The agent';
      // a short song (the first minute's two bars): it repeats to 8 bars from here, in one undo step
      longer = !!app.song?.longerPlan?.({ bars: 8 })?.ok;
      // what you played, counted whole: the beat's hits and the keys' notes
      const mine = played();
      // (skipped to the end with no agent's take: it says so, rather than crediting one that isn't there)
      body = two.by
        ? [
            title(`${who} played over you.`),
            h(
              'p',
              'First you: ',
              h('span.by.by-human.ob-warm', `your ${playedText(mine)}`),
              '. Then ',
              h('span.by.by-agent.ob-cool', `${who}’s${two.label ? ` (${two.label.replace(/^take:\s*/, '')})` : ''}`),
              ', over it. Both are signed in History, and either comes back out with one click.',
            ),
            h('p.ob-small', 'Playing over what’s already there is called an overdub.'),
          ]
        : [
            title('Your part is in the song.'),
            h(
              'p',
              'In the song: ',
              h('span.by.by-human.ob-warm', `your ${playedText(mine)}`),
              `, signed in History. When you want a part over it, ask the agent (${agentAt(app)}).`,
            ),
            h('p.ob-small', 'Playing over what’s already there is called an overdub.'),
          ];
      body.push(
        listening
          ? h('p.ob-small', 'This song came from a link and isn’t saved yet: Make it yours (top) keeps it.')
          : null,
        h(
          'div.ob-acts',
          btn('Done', () => stop('done'), '.ew-btn-primary'),
          longer ? btn('Make it 8 bars', makeLonger, '.ob-longer') : null,
          btn('History', () => ui.show?.('history'), '.btn-txt'),
          app.share?.copy ? btn('Share it', () => app.share.copy(), '.btn-txt') : null,
        ),
      );
    }
    const total = STEPS.length - 1;
    // the head: "Take one", which step in mono, a square per step (done ones filled), and Close as a word
    const dots = h(
      'div.ob-dots',
      { 'aria-hidden': 'true' },
      STEPS.slice(0, total).map((_, i) => h('i' + (i < idx ? '.on' : i === idx ? '.cur' : ''))),
    );
    const head = h(
      'div.ob-head',
      h('span.ob-slate', 'Take one'),
      h('span.ob-step', s === 'done' ? 'done' : `${idx + 1} of ${total}`),
      dots,
      h(
        'button.ob-x',
        {
          type: 'button',
          title: 'Close the tour (it won’t come back; the Song menu has it)',
          'aria-label': 'Close the tour',
          onclick: () => stop('dismissed'),
        },
        'Close',
      ),
    );
    const foot =
      s === 'done'
        ? null
        : h('div.ob-foot', h('button.ob-skip', { type: 'button', onclick: () => go(idx + 1) }, 'Skip this step'));
    // (the one-line card: the line and Close, nothing else)
    const closeX = () =>
      h(
        'button.ob-x',
        {
          type: 'button',
          title: 'Close the tour (it won’t come back; the Song menu has it)',
          'aria-label': 'Close the tour',
          onclick: () => stop('dismissed'),
        },
        'Close',
      );
    // a phone: the strip (or, unfolded, the whole card with Fold in its head); a toast said in the strip takes its line
    const strip = !mini && phoneStrip() && !unfolded;
    const fold =
      !mini && phoneStrip() && unfolded
        ? h(
            'button.ob-x.ob-fold',
            {
              type: 'button',
              'aria-label': 'Fold the tour to one line',
              onclick: () => {
                unfolded = false;
                paint();
              },
            },
            'Fold',
          )
        : null;
    if (fold) head.insertBefore(fold, head.querySelector('.ob-x'));
    let content;
    // (a button in the toast's words, "Make it 8 bars", is a button of the strip's own)
    const isBtn = (x) => x && x.nodeType === 1 && x.tagName === 'BUTTON';
    // (built once per toast: a paint mid-tap keeps the same buttons, so the tap still lands)
    // (a button gone stale since, "Make it 8 bars" once the beat is 8 bars, stays gone: x._gone)
    const saidRow = () =>
      (
        said.row ||
        (said.row = [
          h('p.ob-said' + (said.kind === 'bad' ? '.bad' : ''), ...said.parts.filter((x) => !isBtn(x))),
          ...said.parts.filter(isBtn).map((b) => {
            b.className = 'btn ew-btn ew-btn-small ob-said-act';
            return b;
          }),
          said.action
            ? h(
                'button.btn.ew-btn.ew-btn-small.ob-said-act',
                {
                  type: 'button',
                  onclick: () => {
                    const a = said?.action;
                    if (said) {
                      clearTimeout(said.timer);
                      said = null;
                    }
                    a?.run?.();
                    paint();
                  },
                },
                said.action.label,
              )
            : null,
        ])
      ).filter((x) => !x || !x._gone);
    if (mini) content = [h('div.ob-mini-row', ...(said && phoneStrip() ? saidRow() : body), closeX())];
    else if (strip) {
      // the step in one line (it is the step's title, so focus lands on it as on the card's), its main button, Close
      const t0 = body.find((x) => x && x.classList?.contains('ob-t'));
      const line = note || stripLine(s, coarse) || t0?.textContent || '';
      const lineEl = h(
        'div.ob-t#ob-title',
        {
          tabindex: -1,
          title: 'Tap for the whole card',
          onclick: () => {
            unfolded = true;
            paint();
          },
        },
        line,
      );
      const acts = body.flatMap((x) => (x && x.classList?.contains('ob-acts') ? [...x.children] : []));
      const main =
        s === 'done'
          ? acts.find((b) => /Make it 8 bars/.test(b.textContent))
          : acts.find((b) => !b.classList.contains('btn-txt'));
      const end =
        s === 'done'
          ? h(
              'button.ob-x',
              {
                type: 'button',
                title: 'Done with the tour (the Song menu has it)',
                'aria-label': 'Done with the tour',
                onclick: () => stop('done'),
              },
              'Done',
            )
          : closeX();
      // (a toast said here takes the line, its words a line of their own over its buttons, the step's and Close)
      content = [
        h(
          'div.ob-mini-row' + (said ? '.ob-saying' : ''),
          ...(said ? [h('span.sr-only', lineEl)] : []),
          ...(said ? saidRow() : [lineEl]),
          main || null,
          end,
        ),
      ];
    } else content = [head, ...body, h('p.ob-note', { hidden: !note }, note), foot];
    if (!card) {
      card = h('aside.ob.paper', {
        role: 'complementary',
        'aria-label': 'Take one: a two-minute tour',
        dataset: { step: s },
      });
      live = h('p.ob-live.sr-only', { 'aria-live': 'polite', 'aria-atomic': 'true' });
      card.append(h('div.ob-body'), live);
      (ui.regions?.center || document.body).append(card);
    }
    // if focus was in the card (the button just pressed is about to go), it moves to the new step's title; so it does
    // when a new step finds focus lost (the Keep that moved it on was taken out of the page under the keyboard)
    const had = card.contains(document.activeElement);
    const lost = () => !document.activeElement || document.activeElement === document.body;
    // on a phone the agent sheet covers the card: the last step closes it, so "That's an overdub" is seen, and focus
    // (which was on the agent's Keep, in the sheet) comes to the card rather than to the sheet's toggle
    const drawer = s === 'done' && window.innerWidth < 900 && !!ui.isOpen?.('right');
    if (drawer) ui.setOpen?.('right', false);
    card.dataset.step = s;
    card.classList.toggle('ob-mini', !!mini);
    card.classList.toggle('ob-strip', !!strip);
    card.querySelector('.ob-body').replaceChildren(...content.flat().filter(Boolean));
    if (mini && had && !card.contains(document.activeElement))
      card.querySelector('.ob-x')?.focus({ preventScroll: true });
    const t = card.querySelector('.ob-t');
    const first = body.find((x) => x && x.tagName === 'P');
    announce(`${t ? t.textContent : ''} ${first ? first.textContent : ''}`.trim());
    if (t && (had || drawer || (moved && lost()))) t.focus({ preventScroll: true });
    else if (t && moved) {
      // the control that moved it on may go a frame later (a card redrawn by its panel): look again then
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (card && step() === s && lost()) card.querySelector('.ob-t')?.focus({ preventScroll: true });
        }),
      );
    }
  }
  // ⌘⌥T (Ctrl+Alt+T) takes focus to the tour card, wherever focus is
  ui.keys?.add?.({
    key: 'KeyT',
    mod: 'mod+alt',
    when: () => !!card && idx >= 0,
    run: () => {
      const t = card.querySelector('.ob-t');
      if (t) t.focus();
    },
    label: 'Go to the tour card',
    group: 'View',
    global: true,
  });

  app.onboard = {
    start,
    stop: () => stop('dismissed'),
    skip: () => {
      if (idx >= 0) go(idx + 1);
    },
    done: () => stop('done'),
    // the 'ask' step's button (the demo agent when no agent is on): Sketch's "Hand it to the agent" uses it mid-tour
    ask: () => askAgent(),
    // the first minute (Tap a beat: a New song's first door too) and keys over it
    firstMinute: (kind) => firstMinute(kind),
    keysOver: () => keysOver(),
    humOver: () => humOver(),
    ownSong: () => ownSong(),
    played: () => played(),
    get step() {
      return step();
    },
    get index() {
      return idx;
    },
    get active() {
      return idx >= 0;
    },
    steps: STEPS.slice(),
    get state() {
      return ls.get();
    },
    get take() {
      return { ...take };
    },
    get minute() {
      return fm;
    },
    reset() {
      stop('reset');
      try {
        localStorage.removeItem(KEY);
      } catch (e) {
        /* ok */
      }
    },
  };

  // first run (or a tour left half-way), never under webdriver unless ?coach. On a first visit the arranger's welcome is
  // the door when it's up: its main action is Make your own (which starts the first minute), and the tour is a link on
  // it. Starting the tour here closed the welcome before it was seen, and it never comes back.
  const was = ls.get();
  const forced = params.has('coach');
  const welcomeUp = () => !!app.welcome?.el?.isConnected && !app.welcome.el.classList.contains('out');
  // (never on someone else's song: a link opened with a tour left half-way, or on a first visit, waits for a song of
  // yours)
  // The simple view never starts it by itself (its first screen is the blank sheet, and each door is its own start):
  // it runs from Tap a beat (the first minute), Song → Take one, and ?coach. (A tour left half-way waits there too.)
  const simple = ui.workspace?.view?.() === 'simple';
  if (forced) start({ force: true, restart: true });
  else if (simple) {
    /* not by itself */
  } else if (!navigator.webdriver && elsewhere() && ((was && was.state === 'on') || (!was && firstVisit)))
    paused = true;
  else if (
    !navigator.webdriver &&
    !elsewhere() &&
    ((was && was.state === 'on') || (!was && firstVisit && !welcomeUp()))
  )
    start();
  // a tour that stepped aside for a link picks up when a song of yours is on screen again; not when the link's song is
  // made yours (that song is the one it stepped aside for: it waits for the next)
  let forking = false;
  ui.on?.('share:fork', () => {
    forking = true;
    setTimeout(() => {
      forking = false;
    }, 0);
  });
  store.on('change', (e) => {
    if (e.kind !== 'load' || !paused || idx >= 0 || ui.workspace?.view?.() === 'simple') return;
    setTimeout(() => {
      if (paused && idx < 0 && !forking && !elsewhere()) {
        paused = false;
        start();
      }
    }, 0);
  });
}

// The card is printed (.paper, the welcome insert's stock): ink on cream, square, the one shadow, because it floats.
const CSS = `
.ob { position: absolute; right: 16px; bottom: 16px; z-index: 30; width: min(360px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow: auto;
  display: grid; gap: 8px; padding: 13px 18px 12px; border-radius: 0; background: var(--paper); color: var(--ink-2); box-shadow: var(--shadow-2);
  font-size: 13px; line-height: 1.45; animation: ew-in .16s var(--ease, ease) both; }
.ob.out { opacity: 0; transition: opacity .16s var(--ease, ease); }
.ob p { margin: 0; color: var(--ink-2); }
.ob-body { display: grid; gap: 9px; }
.ob-t:focus { outline: none; }
.ob-t:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.ob-head { display: flex; align-items: baseline; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--paper-rule); }
.ob-slate { font-size: 13px; font-weight: 600; color: var(--ink); }
.ob-step { font: 11.5px var(--font-mono); color: var(--ink-3); }
.ob-dots { display: flex; gap: 3px; margin-left: auto; align-self: center; }
.ob-dots i { width: 9px; height: 9px; border: 1px solid var(--ink-3); }
.ob-dots i.on { background: var(--ink-3); } .ob-dots i.cur { background: var(--ink); border-color: var(--ink); }
.ob-x { align-self: center; height: 24px; padding: 0 2px; margin-left: 6px; border: 0; background: none; color: var(--ink-2); font: 600 12px var(--font-ui); cursor: pointer; text-decoration: underline; text-decoration-color: var(--paper-rule); text-underline-offset: 3px; }
.ob-x:hover { color: var(--ink); text-decoration-color: var(--ink-3); }
.ob-x:focus-visible, .ob-skip:focus-visible, .ob .btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.ob-t { font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 125%; font-variation-settings: var(--font-display-vars, normal); font-size: 21px; letter-spacing: -.012em; color: var(--ink); line-height: 1.1; padding-top: 2px; }
.ob-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ob .ew-btn { height: 28px; padding: 0 11px; background: none; border: 1px solid var(--ink); border-radius: var(--r-press); color: var(--ink); font-size: 12.5px; }
.ob .ew-btn:hover { background: rgba(22, 19, 15, .06); }
.ob .ew-btn:active { background: var(--ink); color: var(--paper); }
.ob .ew-btn-primary { background: var(--ink); color: var(--paper); }
.ob .ew-btn-primary:hover { background: var(--ink); filter: none; }
.ob .ew-btn-agent .ico { color: var(--ink-agent); }
.ob .ew-btn.btn-txt { border-color: transparent; padding: 0 2px; text-decoration: underline; text-decoration-color: var(--paper-rule); text-underline-offset: 3px; }
.ob-small { font-size: 12px; color: var(--ink-3) !important; }
.ob-small kbd, .ob p kbd { font-size: 10.5px; color: var(--ink); border-color: var(--paper-rule); }
.ob .ob-warm { color: var(--ink-human); font-weight: 600; } .ob .ob-cool { color: var(--ink-agent); font-weight: 600; }
.ob-note { font-size: 12.5px; font-style: italic; color: var(--ink) !important; }
.ob-note[hidden] { display: none; }
.ob-foot { display: flex; justify-content: flex-end; padding-top: 2px; }
.ob-skip { border: 0; background: none; padding: 2px 0; color: var(--ink-2); font-size: 12px; cursor: pointer; text-decoration: underline; text-decoration-color: var(--paper-rule); text-underline-offset: 3px; }
.ob-skip:hover { color: var(--ink); }
/* "Show me": the control it points at gets the agent's grease-pencil frame for a moment (a mark, not a glow) */
.ob-glow { outline: 2px solid var(--accent-2) !important; outline-offset: 3px; }
@media (max-width: 700px) { .ob { right: 8px; bottom: 8px; width: calc(100% - 16px); padding: 11px 14px 10px; } }
/* a phone, recording: one line at the foot of the arranger (the lanes and the beat stay in sight) */
.ob.ob-mini { padding: 6px 12px; gap: 0; }
.ob-mini-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ob-mini .ob-line { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink); font-weight: 600; }
.ob-mini .ob-x { margin-left: 0; flex: none; }
@media (max-width: 900px) { .ob-mini .ob-x { height: 40px; } }
/* a phone, between takes: the strip, one line over the sheet (the line opens the whole card) */
.ob.ob-strip { padding: 6px 10px 6px 12px; gap: 0; max-height: none; overflow: visible; }
.ob-strip .ob-t { flex: 1 1 auto; min-width: 0; font-size: 14px; padding: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
/* (the step's button keeps its whole label, "Ask the demo agent"; the line gives way with an ellipsis) */
.ob-strip .ob-mini-row > .ew-btn { flex: none; white-space: nowrap; }
.ob-said { flex: 1 1 auto; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; line-height: 1.3; color: var(--ink) !important; }
.ob-said-act { flex: none; }
.ob-saying { flex-wrap: wrap; row-gap: 6px; justify-content: flex-end; }
.ob-saying > .ob-said { flex: 1 0 100%; }
.ob-fold { margin-left: auto; }
@media (max-width: 900px) { .ob-strip .ob-x, .ob-mini .ob-x, .ob .ob-fold { height: 40px; min-width: 44px; } }
@media (max-width: 900px) { .ew-shell .ob .ew-btn { height: 40px; padding: 0 14px; font-size: 13px; } .ew-shell .ob-step, .ew-shell .ob-small kbd, .ew-shell .ob p kbd { font-size: 12px; } }
@media (prefers-reduced-motion: reduce) { .ob { animation: none; } .ob.out { transition: none; } }
`;
