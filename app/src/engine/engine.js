// The engine: the AudioContext, the transport, the lookahead scheduler, the tracks' strips and the mixer, kept in
// step with the project document. docs/ARCHITECTURE.md ("The engine") is the contract.
//
//   const engine = createEngine(store);
//   await engine.start();                       // from a user gesture
//   engine.play(fromBeat?, { countIn: { beats, preroll } }?) / stop({ live }?) / seek(beat) / toggle(); engine.playing; engine.beat
//   engine.starting (a play() waiting for the engine or a renew: stop() cancels it) ; engine.gen (counts transport
//     starts: play, seek, play from elsewhere; a loop wrap is the same run)
//   engine.gridBeat (the playhead on the unwrapped grid: it doesn't jump back at a loop wrap; null when stopped)
//   engine.counting ({ from, until, beats, preroll, time } while a count-in is heard) ; engine.beatAt(perfMs)
//   engine.click = { on, whileRecording, level } (engine.metronome = click.on) ; engine.recording = true | false
//   engine.rate = 0.25..2 (practice speed: the transport at rate × the song's tempo, the song unchanged; audio clips sit
//     out while it isn't 1; the Jam room's slow-down)
//   engine.hush(clipIds | null) -> the ids (practice: clips the live transport leaves out, the riff you are learning in
//     the Jam room's tab lane; never in a render, the song or History) ; engine.hushed (a copy of the set)
//   engine.band(db, { keep: trackIds }) -> { db, keep } (practice: every track but `keep` turned down by db, -60..0, the
//     Jam room's Band fader; live only, never in a render, the song or History) ; engine.bandLevel ({ db, keep })
//   engine.on('transport' | 'meters' | 'error' | 'graph' | 'kitwait', fn) -> off ('kitwait' { track, pitch }: a key
//                          waits for its sampled instrument's samples, liveNoteOn below)
//   engine.liveNoteOn(trackId, pitch, vel) / liveNoteOff(trackId, pitch) / audition(trackId, pitch, vel, beats)
//   engine.inputNode(trackId) / instance(trackId, insertId | 'instrument') / masterTap / clock / meters
//   engine.render({ from, to, tracks, sr, tail, latencyMax }) -> AudioBuffer ; songEnd() ; beatToSec(b) ; secToBeat(s) ; assets
//   engine.probeLatency({ tracks, withMix }) -> { tracks, max } (what render's delay compensation would line up to; stems use it)
//   engine.settled() -> Promise (every strip matches the document) ; engine.dispose()
//   engine.silence() -> Promise (the killswitch: see below) ; engine.silencing ; engine.on('silence', fn)
//   engine.voices() -> Promise<{ [trackId]: { device, voices, held, peak, stuck } }> (debug: what each instrument is
//     sounding: voices alive, voices whose note is still down, its output's peak in dBFS over the last ~40 ms, and
//     how many voices the kernel host's watchdog has let go; tools/stuck-test.js)
//
// Time. While playing, the transport runs on "u": beats since play() (continuous, unwrapped). Anchors map u to audio
// time (a tempo change adds an anchor where the scheduler has reached, so nothing already scheduled moves); segments
// map u to the song's beats (a loop wrap starts a new segment at loop.start). The scheduler walks u forward every
// 25 ms to 120 ms past now, reading the document fresh each tick, so edits are heard on the next tick.
//
// Edits inside the lookahead. What was handed to an instrument is remembered (T.scheduled). After every edit while
// playing, revise() compares it with what the document now says for the scheduled window: a note deleted or moved
// that hasn't started is taken back (Instance.cancel: it never sounds) and the moved one scheduled where it now is; a
// sounding note that was deleted or changed pitch is released; a sounding note whose end moved is released at the
// new end; an audio clip deleted, moved or re-trimmed while scheduled or playing fades out (and picks up mid-way
// where it now is, if it still covers the playhead).
//
// Chase: one rule, live and offline. When the transport starts somewhere (play, seek, a loop wrap) or a render
// starts at `from`, notes that began before that point and are still held there sound from it, for the rest of their
// length, the same way audio clips already did. A render of bars 5-8 and pressing play at bar 5 sound the same.
//
// Plugin delay compensation. Tracks whose devices add latency (a look-ahead limiter, oversampled kernels, pitch
// pedals) would be late against the rest. Every track is held back by (the latest track's latency - its own), whole
// samples: its notes and audio clips are scheduled that much later, which is sample-exact (no delay line to
// interpolate, nothing to rewire when it changes: what is already scheduled keeps its time, the next notes take the
// new one). Both renderers do the same, so all tracks line up at the master live and offline; the master's own
// inserts delay everything alike. engine.latency reports it: { base, output, tracks, comp, max, master, total }
// (seconds; comp in samples). engine.beat (the playhead) is what is heard, so it allows for the total too, and
// recordings land where they were played. Live input monitoring and live notes are not held back (they are live).
//
// Automation (docs/research/AUTOMATION.md 3.5). Lanes play by the rules notes play by. Kernel params: each lane
// segment that starts in the stretch being scheduled goes to its instance once (Instance.auto, keyed like notes), at
// its time plus the track's compensation; play, seek and a loop wrap chase the segment covering the start. Graph
// device params: one merged set(values, { at }) per device every 20 ms of audio time inside the lookahead (the
// device glides between). Gain and pan: linear ramps through control points on the audio clock's 128-frame grid,
// added each tick for the window (the browser render and the Node renderer use the same points). An edit to a lane
// while playing clears what was handed over from now and sends it again (kernels), re-sends the control points
// (graph), or cancels and re-ramps from the next grid point (gain, pan). Stopped, every automated param sits at its
// lane's value at the cursor (the marker): stop releases the kernels' lanes and the strips are given the values
// there (trackSpec / mixAt at T.cursor), so a knob, a measurement and what you hear agree.
//
// The metronome goes to the speakers through the master's monitor soft clip (strip.js), never into masterTap or a
// render. It clicks the whole beats counted from each bar line, accenting the bar line, so a bar of 7/8 (3.5 beats)
// clicks 0, 1, 2, 3 and the next bar starts on a click, half a beat later.
//
// Count-in (docs/research/RECORDING-UX.md 3.5). play(from, { countIn: { beats, preroll = true } }) starts the
// transport `beats` before `from` (u = 0 is from - beats, so engine.beat is negative below bar 1). What is a count is
// decided on u (u < beats), never on the song beat, so a loop that wraps back below `from` doesn't count again. In the
// count the click always sounds; below beat 0 nothing else can; with preroll the song plays from from - beats, without
// it the count is a quiet segment and the song starts at `from` as a fresh one (held notes chased). No loop wraps
// inside the count (a count that runs past the loop's end must reach `from`). 'transport' why 'countin-end' fires at
// the audible downbeat; stopping in the count puts the playhead back at `from`.
//
// Recording. engine.recording is the recorder's flag: it rides on 'transport' events, makes click.whileRecording
// sound, and is cleared by stop() and silence() after their 'stop' event. A loop wrap's 'transport' 'loop' event
// carries the pass boundary (pass).
//
// The song's end. When the loop won't wrap, the transport stops itself a bar after the song's last sound (the bar the
// last note or audio clip ends in, then one more: schedule.js lastSound), with a 'transport' 'stop' that says end:
// true, so the playhead goes back to the marker like any stop (ui/transport.js). Not while recording (a take can run
// past the end), and not when play started at or past it (you are there to play or record something new).
//
// Stop (and seek, and play from elsewhere) let every note go, and nothing the lookahead already handed over may
// sound after it. Each instrument is flushed first (Instance.flush(t): kernels drop every note-on and note-off queued
// at or after t, so a note due in the next 120 ms never starts, and no note-off for it can go missing), then
// released with its own release (allOff(t): not a hard cut, the killswitch is that). An instrument with no flush has
// each such note taken back (cancel) or released just after its start, never at the same frame: offs go before ons at
// one time, so an off sent for a note's own start would come first and leave the note on for good (the cause of the
// stuck notes in wave 10, tools/stuck-test.js). The kernel host keeps a watchdog for anything that still gets through.
// The keys the musician is holding (liveNoteOn) are theirs: a stop they didn't press (the song's end, an agent's
// stop({ live: false })), a seek or a play from elsewhere lets the transport's notes go, one by one, on an instrument
// they are playing, and their held notes sound on until they let go. Their own Stop (stop()) and the killswitch let
// everything go.
//
// The polite stop. Tails ring on after Stop as they would on any desk, but not for ever (a long delay or a pad's
// release, heard by a newcomer, is a note that never stops). RING seconds after a stop (still stopped), every strip
// still over CALM_DB fades out over CALM_FADE (Strip.calmDown, a gain only the live strips have) and is renewed
// (Strip.renew: fresh devices, so nothing rings on behind the fade), then comes back up; the master too, when it has
// inserts and nothing live is going through it. Live playing is left alone: a strip that took a live note or an
// audition since the stop, or hears its input (a monitored mic or guitar), keeps ringing; input that starts during the
// fade (listened for every 20 ms) brings its strip straight back, unrenewed. Play during the fade brings the strips
// straight back; play during the renew waits for it (a few hundred ms at most), and a stop or the killswitch meanwhile
// cancels the waiting play. tools/stopping-test.js
// holds every demo song to silence (-60 dBFS) 3.5 s after Stop. The killswitch is the instant version.
//
// The killswitch: engine.silence(). One function every panic path calls (the transport's button and Shift+Esc, an
// agent, a test). It stops the transport (a 'transport' stop, so A/B and recording end the usual way), takes the
// speakers' feed (`kill`, the last gain before the destination) to zero over 6 ms starting at soon(), releases every
// note (scheduled, held, auditioned), stops clips and clicks, and emits 'silence' so previews elsewhere stop too.
// Then, with the speakers at zero, every strip builds fresh instances of its devices (Strip.renew): held voices and
// reverb and delay tails are gone with the old ones, so nothing can come back when the feed opens again, and nothing
// can stay stuck. The feed opens once the strips are rebuilt (or after 1.5 s, whatever is slow). play() waits for it.

import { songEnd as projectSongEnd } from '../core/project.js';
import { onDevices } from '../devices/registry.js';
import { Strip, trackSpec, masterSpec, audibility, mixAt } from './strip.js';
import { createClock } from './clock.js';
import { notesIn, audioIn, lastSound, playBuffer, autoIn, lanesOf, lanePos, laneValue, travel, mixGain, panGains, GRID } from './schedule.js';
import { noteExpr } from '../kernel/expr.js';
import { renderProject, probeLatency } from './render.js';
import { assets as sharedAssets } from './assets.js';
import { emitter, frame, beatsPerBarOf, sleep, soon, afterAudio, ramp, dbToGain } from './util.js';
import { clickSamples } from './click.js';

const TICK_MS = 25;
const AHEAD = 0.12;        // seconds scheduled ahead of the audio clock
const START_DELAY = 0.06;  // play() starts this far after now, so the first notes land exactly
const METER_MS = 33;
const RING = 2;            // the polite stop: seconds a tail rings on after Stop before it is faded (see the header)
const CALM_FADE = 1;       // ... the fade's length
const CALM_DB = -50;       // ... a strip over this (peak, dBFS) is faded and renewed

// A timer that keeps time in background tabs: a Worker's setInterval (main-thread timers are throttled there).
function ticker(fn, ms) {
  let w = null, iv = null;
  try {
    const src = `let id = null; onmessage = (e) => { clearInterval(id); id = e.data > 0 ? setInterval(() => postMessage(0), e.data) : null; };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = () => fn();
    w.onerror = () => { try { w.terminate(); } catch (e) { /* ok */ } w = null; if (!iv) iv = setInterval(fn, ms); };
    w.postMessage(ms);
  } catch (e) { w = null; iv = setInterval(fn, ms); }
  return () => { if (w) { w.postMessage(0); w.terminate(); } if (iv) clearInterval(iv); };
}

export function createEngine(store, { assets = sharedAssets } = {}) {
  const ev = emitter();
  const P = () => store.get();
  let ctx = null, starting = null, disposed = false;
  const offs = [];                   // listeners to let go on dispose
  let master = null;
  const strips = new Map();          // track id -> Strip
  let stopTick = null, meterIv = null;
  let lastTempo = null;
  const click = { on: false, whileRecording: false, level: 0 };   // the click's options (level: dB)
  let recording = false, clickBus = null;                          // a take is running (the recorder sets it)
  const clickOn = () => click.on && (!click.whileRecording || recording);   // (the count-in's clicks ignore it)
  let kill = null, renewing = null, hush = 0; // the speakers' feed (the killswitch's gain); a silence in progress; silences so far
  const pdc = { tracks: {}, comp: {}, max: 0, master: 0, total: 0 };   // plugin delay compensation (seconds; comp: samples)
  const clicks = new Set();          // scheduled metronome oscillators
  const sources = new Set();         // playing audio clip handles
  let pendingOffs = [];              // [{ t, inst, p, onT, track, kind: 'sched' | 'live' }]
  const liveHeld = new Map();        // `${track}:${pitch}` -> inst (what liveNoteOff releases)
  const waitingAudio = [];           // audio clips whose samples were not loaded when their time came
  const meters = { tracks: {}, master: { peak: -120, rms: -120 } };
  // automation (see the header): the lanes that play, what was handed over, how far each control grid has been laid
  const AU = { doc: null, lanes: [], byId: new Map(), sigs: new Map(), sent: new Set(), insts: new Set(), mix: new Map(), graph: new Map() };
  let calm = null;                   // the polite stop under way: { stopT, strips: Set<Strip>, fading, renewing, job }
  const lastLive = new Map();        // track id -> audio time of its last live note or audition
  let lastEnd = null;                // the song's last sound (schedule.js lastSound), cached until the song changes

  // ---- transport state
  const T = {
    playing: false,
    cursor: 0,          // song beat when stopped (where play() starts)
    anchors: [],        // [{ t, u, spb }] u -> time; latest last
    segs: [],           // [{ u0, s0, fresh }] u -> song beat; latest last
    schedU: 0,          // u scheduled up to (exclusive)
    scheduled: new Map(), // `${key}@${seg}` -> what was handed over (never double-schedule; revise() checks it)
    startT: 0,
    count: null,        // the count-in of this play(): { from, until, beats, preroll, time, ended }, or null
    wraps: 0,           // loop wraps scheduled since play() (the pass a wrap starts is wraps + 1)
  };
  // Practice speed (engine.rate, the Jam room's): the transport plays the song at rate × its tempo, never changing the
  // song. Everything the transport times (notes, the click, the count-in, synced devices) follows it; the song's own
  // tempo is the song's (beatToSec, renders, exports). Audio clips can't stretch in tune, so they sit out while rate ≠ 1.
  let rate = 1;
  const bpmNow = () => (+P().tempo || 120) * rate;
  const spbNow = () => 60 / bpmNow();
  const spbSong = () => 60 / (+P().tempo || 120);
  const bpbNow = () => beatsPerBarOf(P().meter);
  // Practice (the Jam room's tab lane, ui/tabs.js): clips the live transport leaves out, so the part someone is learning
  // is theirs to play. Live only: renders build their own schedule and never see it. A change while playing takes back
  // what was handed over from them (revise). (engine.hush; `hush` inside is the killswitch's count.)
  const hushed = new Set();
  function setHushed(ids) {
    hushed.clear();
    for (const id of Array.isArray(ids) ? ids : ids ? [ids] : []) hushed.add(String(id));
    if (ctx && T.playing) revise();
    return [...hushed];
  }

  // The practice Band level (engine.band, the Jam room's Band fader): every track but the ones kept (the room's guitars)
  // is turned down by `db` at its strip's mute stage, after its fader and any gain lane. Live only: renders build their
  // own strips and never see it, and the song's faders are untouched.
  let band = { db: 0, keep: new Set() };
  function setBand(db, { keep } = {}) {
    const d = Math.max(-60, Math.min(0, Number.isFinite(+db) ? +db : 0));
    band = { db: d > -0.05 ? 0 : Math.round(d * 10) / 10, keep: new Set((Array.isArray(keep) ? keep : keep ? [keep] : [...band.keep]).map(String)) };
    reconcile();
    return bandNow();
  }
  const bandNow = () => ({ db: band.db, keep: [...band.keep] });
  const trimOf = (id) => (band.db && !band.keep.has(id) ? band.db : 0);

  function anchorFor(u) { for (let i = T.anchors.length - 1; i >= 0; i--) if (T.anchors[i].u <= u + 1e-9) return T.anchors[i]; return T.anchors[0]; }
  function anchorAtTime(t) { for (let i = T.anchors.length - 1; i >= 0; i--) if (T.anchors[i].t <= t + 1e-9) return T.anchors[i]; return T.anchors[0]; }
  const uToTime = (u) => { const a = anchorFor(u); return a.t + (u - a.u) * a.spb; };
  const timeToU = (t) => { const a = anchorAtTime(t); return a.u + (t - a.t) / a.spb; };
  function segFor(u) { for (let i = T.segs.length - 1; i >= 0; i--) if (T.segs[i].u0 <= u + 1e-9) return { seg: T.segs[i], i: T.segs[i].i }; return { seg: T.segs[0], i: T.segs[0].i }; }
  const uToSong = (u) => { const { seg } = segFor(u); return seg.s0 + (u - seg.u0); };
  const outLatency = () => (ctx ? (ctx.outputLatency || ctx.baseLatency || 0) : 0);

  // The audible song position (what the playhead shows).
  function beatNow() {
    if (!T.playing || !ctx) return T.cursor;
    const t = ctx.currentTime - outLatency() - pdc.total;
    if (t <= T.startT) return T.s0;
    return uToSong(timeToU(t));
  }
  // The same moment on the continuous grid: beats since play began (from where it began), never jumping back at a
  // loop wrap. Capture measures a phrase played across a wrap with it. null when stopped.
  function gridNow() {
    if (!T.playing || !ctx) return null;
    const t = ctx.currentTime - outLatency() - pdc.total;
    return t <= T.startT ? T.s0 : T.s0 + timeToU(t);
  }
  // The count-in while it is heard (u below its length), else null.
  function countingNow() {
    const k = T.count;
    if (!k || k.ended || !T.playing || !ctx) return null;
    if (gridNow() - T.s0 >= k.beats - 1e-9) return null;
    // (time read now: the tempo map and the output latency it allows for can move after play())
    return { from: k.from, until: k.until, beats: k.beats, preroll: k.preroll, time: uToTime(k.beats) + outLatency() + pdc.total };
  }

  // The audio clock against performance.now(), for beatAt (an input event's timeStamp). currentTime moves in steps
  // (one per audio callback) while performance.now() is continuous, so currentTime - perf/1000 falls between callbacks
  // and jumps back up at each: its highest value over the last second is the clock's leading edge. A stall (a
  // suspended context, a throttled tab) drops it for good, so a fresh reading far under the kept one starts over.
  let clockPairs = [];
  function ctxTimeAt(perfMs) {
    const pn = performance.now(), off = ctx.currentTime - pn / 1000;
    if (clockPairs.length && off < clockPairs.reduce((m, x) => Math.max(m, x[1]), -Infinity) - 0.05) clockPairs = [];
    clockPairs.push([pn, off]);
    while (clockPairs.length > 1 && clockPairs[0][0] < pn - 1000) clockPairs.shift();
    if (clockPairs.length > 400) clockPairs.splice(0, clockPairs.length - 400);
    let best = -Infinity;
    for (const x of clockPairs) if (x[1] > best) best = x[1];
    return perfMs / 1000 + best;
  }
  // The audible song beat at a performance.now() time (event.timeStamp), on the same map as engine.beat.
  function beatAt(perfMs) {
    if (!T.playing || !ctx) return T.cursor;
    const pn = performance.now();
    const p = Number.isFinite(perfMs) && Math.abs(perfMs - pn) < 60000 ? perfMs : pn; // (an epoch timeStamp: use now)
    const t = ctxTimeAt(p) - outLatency() - pdc.total;
    if (t <= T.startT) return T.s0;
    return uToSong(timeToU(t));
  }

  // ---- the device clock (live): a continuous grid while playing, a free grid from time 0 when stopped
  const clock = createClock({
    now: () => (ctx ? ctx.currentTime : 0),
    playing: () => T.playing,
    bpm: bpmNow,
    beatsPerBar: bpbNow,
    gridAt: (t) => (T.playing ? T.s0 + timeToU(t) : t / spbNow()),
    timeAtGrid: (g) => (T.playing ? uToTime(g - T.s0) : g * spbNow()),
    songBeatAt: (t) => (T.playing ? (t <= T.startT ? T.s0 : uToSong(timeToU(t))) : T.cursor),
  });

  const report = (err) => {
    const e = { ...err, at: Date.now() };
    console.warn('overdub engine:', e.message);
    ev.emit('error', e);
  };
  const transportEvt = (why, extra = null) => ev.emit('transport', { why, playing: T.playing, beat: beatNow(), tempo: +P().tempo || 120, rate, loop: { ...(P().loop || {}) }, metronome: click.on, click: { ...click }, recording, counting: countingNow(), ...extra });

  // ------------------------------------------------------------------------------------------- the graph
  const stripOpts = (id, extra = {}) => ({ id, clock, bpm: bpmNow, report, onGraph: (e) => ev.emit('graph', e), meters: true, ...extra });

  let reconcileQueued = false;
  function queueReconcile() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    queueMicrotask(() => { if (!reconcileQueued) return; reconcileQueued = false; reconcile(); });
  }

  // Bring the graph in line with the document. Cheap things (mix, params) happen now; structural things (devices
  // built, chains rewired) run as per-strip jobs, click-free.
  function reconcile() {
    if (!ctx || disposed) return;
    const p = P();
    // tempo: re-anchor where the scheduler has reached
    const bpm = bpmNow();
    if (lastTempo !== null && bpm !== lastTempo && T.playing) {
      const t = uToTime(T.schedU);
      T.anchors.push({ t, u: T.schedU, spb: 60 / bpm });
      if (T.anchors.length > 16) T.anchors.splice(0, T.anchors.length - 16);
    }
    const tempoMoved = lastTempo !== null && bpm !== lastTempo;
    lastTempo = bpm;

    refreshLanes(p);
    const auto = (track) => ({ gain: T.playing && AU.byId.has(track + '/mix/gain'), pan: T.playing && AU.byId.has(track + '/mix/pan') });
    master.setMix({ gain: mixAt(p.master || {}, T.cursor).gain, auto: auto('master') });
    master.sync(masterSpec(p, { at: T.cursor })).catch((e) => report({ kind: 'graph', track: 'master', message: e.message })).then(queuePdc);
    const heard = audibility(p);
    const seen = new Set();
    for (const t of p.tracks || []) {
      seen.add(t.id);
      let s = strips.get(t.id);
      if (!s) {
        s = new Strip(ctx, stripOpts(t.id, { dest: master.head }));
        strips.set(t.id, s);
        ev.emit('graph', { kind: 'track', track: t.id, added: true });
      }
      const mx = mixAt(t, T.cursor);
      s.setMix({ gain: mx.gain, pan: mx.pan, audible: !!heard[t.id], auto: auto(t.id), trim: trimOf(t.id) });
      s.sync(trackSpec(t, { at: T.cursor })).catch((e) => report({ kind: 'graph', track: t.id, message: e.message })).then(queuePdc);
    }
    for (const [id, s] of strips) {
      if (seen.has(id)) continue;
      strips.delete(id);
      s.dispose();
      delete meters.tracks[id];
      ev.emit('graph', { kind: 'track', track: id, removed: true });
    }
    updatePdc();
    rescan();
    if (tempoMoved) {
      // synced devices hear the new tempo (applyParams compares params + bpm)
      transportEvt('tempo');
    }
    assets.prefetch(p).catch(() => {});
  }

  // resume() stays pending until the page has had a user gesture; never let that hang the engine
  const wakeCtx = (c) => Promise.race([c.resume().catch(() => {}), sleep(250)]);

  async function start() {
    if (disposed) throw new Error('engine: disposed');
    if (starting) { await starting; if (ctx.state !== 'running') await wakeCtx(ctx); return api; }
    starting = (async () => {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      const c = new AC({ latencyHint: 'interactive' });
      ctx = c;
      // the master's tap (masterTap) is the mix; the speakers get the mix plus the metronome through its monitor clip
      kill = c.createGain(); kill.gain.value = 1; kill.connect(c.destination);
      master = new Strip(c, { ...stripOpts('master', { dest: null, monitor: kill }), master: true });
      clickBus = c.createGain(); clickBus.gain.value = dbToGain(click.level); clickBus.connect(master.monIn);
      lastTempo = bpmNow();
      reconcile();
      offs.push(store.on('change', (evt) => { lastEnd = null; if (touchesNotes(evt)) needRevise = true; queueReconcile(); }));
      offs.push(onDevices(() => queueReconcile())); // a device defined (or re-defined) late: swap the stand-ins for it
      stopTick = ticker(tick, TICK_MS);
      meterIv = setInterval(readMeters, METER_MS);
      await wakeCtx(c); // (suspended until a gesture: play() and live notes try again)
      c.addEventListener('statechange', () => { clockPairs = []; transportEvt('context'); });
      await settled();
      return api;
    })();
    return starting;
  }

  function settled() {
    if (reconcileQueued) { reconcileQueued = false; reconcile(); }
    const jobs = [];
    if (master && master.job) jobs.push(master.job);
    for (const s of strips.values()) if (s.job) jobs.push(s.job);
    if (!jobs.length) return Promise.resolve();
    return Promise.all(jobs.map((j) => j.catch(() => {}))).then(() => sleep(0)).then(() => settled());
  }

  // ------------------------------------------------------------------------------------------- latency
  // Plugin delay compensation: each strip's comp delay makes every track as late as the latest one.
  let pdcQueued = false;
  function queuePdc() {
    if (pdcQueued || disposed) return;
    pdcQueued = true;
    queueMicrotask(() => { pdcQueued = false; updatePdc(); });
  }
  function updatePdc() {
    if (!ctx || disposed || !master) return;
    const sr = ctx.sampleRate, lat = {}, comp = {};
    let max = 0;
    for (const [id, s] of strips) { const l = s.latency(); lat[id] = l; if (l > max) max = l; }
    for (const id of strips.keys()) comp[id] = Math.max(0, Math.round((max - lat[id]) * sr));
    const m = master.latency(), total = max + m;
    const moved = Math.abs(total - pdc.total) > 0.5 / sr;
    Object.assign(pdc, { tracks: lat, comp, max, master: m, total });
    if (moved) ev.emit('latency', latencyReport());
  }
  const compOf = (track) => (pdc.comp[track] || 0) / ctx.sampleRate; // seconds a track's events are held back
  function latencyReport() {
    return {
      base: ctx ? ctx.baseLatency || 0 : 0, output: ctx ? ctx.outputLatency || 0 : 0,
      tracks: { ...pdc.tracks }, comp: { ...pdc.comp }, max: pdc.max, master: pdc.master, total: pdc.total,
    };
  }

  // ------------------------------------------------------------------------------------------- scheduler
  function tick() {
    if (!ctx || disposed) return;
    const now = ctx.currentTime, H = now + AHEAD;
    const events = [];
    if (T.playing) { scheduleUntil(H, events); ctxTimeAt(0); autoControl(H); } // (and a clock reading for beatAt)
    if (T.playing && atSongEnd()) { stop({ end: true }); return; }
    // note-offs that fall due inside the horizon
    if (pendingOffs.length) {
      const keep = [];
      for (const o of pendingOffs) { if (o.t < H) { events.push({ ...o, off: true }); if (o.entry) o.entry.offSent = true; } else keep.push(o); }
      pendingOffs = keep;
    }
    dispatch(events);
    retryWaitingAudio();
    // forget what has finished
    if (T.scheduled.size > 2000 || (T.scheduled.size && (tick.n = (tick.n || 0) + 1) % 40 === 0)) {
      for (const [k, e] of T.scheduled) if (e.end < now - 1) T.scheduled.delete(k);
    }
  }

  // events: { t, off?: true, inst, p, v }. Offs before ons at equal times.
  function dispatch(events) {
    if (!events.length) return;
    events.sort((a, b) => a.t - b.t || (a.off ? 0 : 1) - (b.off ? 0 : 1));
    for (const e of events) {
      try {
        if (e.off) e.inst.noteOff(e.p, e.t);
        else if (e.x) e.inst.noteOn(e.p, e.v, e.t, e.x);
        else e.inst.noteOn(e.p, e.v, e.t);
      } catch (err) { report({ kind: 'note', track: e.track, message: err.message }); }
    }
  }

  // The beat notes are cut at from song beat s (u since play): the loop's end while the loop will wrap there, else
  // none (a count-in that runs past the loop's end plays through it).
  function loopCut(s, u) {
    const lp = P().loop || {};
    if (!(lp.on && lp.end - lp.start >= 1 / 64 && s < lp.end - 1e-9)) return Infinity;
    if (T.count && u < T.count.beats - 1e-9 && T.count.until >= lp.end - 1e-9) return Infinity;
    return lp.end;
  }

  function scheduleUntil(H, events) {
    const uH = timeToU(H);
    let guard = 0;
    while (T.schedU < uH - 1e-9 && guard++ < 256) {
      const { seg, i: segIndex } = segFor(T.schedU);
      const s = seg.s0 + (T.schedU - seg.u0);
      const lp = P().loop || {};
      let len = uH - T.schedU, wrap = false;
      // (a count-in never wraps, and a segment laid out ahead, the count's quiet one, ends where the next begins)
      const inCount = !!T.count && T.schedU < T.count.beats - 1e-9;
      const next = T.segs.find((g) => g.u0 > T.schedU + 1e-9);
      if (next && T.schedU + len > next.u0) len = next.u0 - T.schedU;
      if (inCount && T.schedU + len > T.count.beats) len = T.count.beats - T.schedU;
      const cut = loopCut(s, T.schedU), looping = !inCount && cut !== Infinity;
      if (looping && s + len >= lp.end - 1e-9) { len = lp.end - s; wrap = true; }
      const fresh = seg.fresh && Math.abs(T.schedU - seg.u0) < 1e-9;
      scheduleRange(s, s + len, T.schedU, segIndex, { fresh, chase: fresh, cut, click: true, song: !seg.quiet }, events);
      // (a wrap lands exactly where the pass began plus its length: summing the lookahead's slices drifts, 16 → 15.999999999999998)
      T.schedU = wrap ? seg.u0 + (lp.end - seg.s0) : T.schedU + len;
      if (wrap) {
        const i = Math.max(...T.segs.map((g) => g.i)) + 1;
        T.segs.push({ u0: T.schedU, s0: lp.start, fresh: true, i });
        if (T.segs.length > 64) T.segs.splice(0, T.segs.length - 64);
        T.wraps++;
        const at = uToTime(T.schedU), gen = T.gen, heard = at + outLatency() + pdc.total;
        const pass = { n: T.wraps + 1, start: lp.start, end: lp.end, grid: T.s0 + T.schedU, time: heard };
        // (re-armed if the timer fires early: it counts wall time, and the audio clock can fall behind it)
        const fire = () => {
          if (!T.playing || T.gen !== gen) return;
          if (ctx.currentTime < heard - 0.005) { setTimeout(fire, (heard - ctx.currentTime) * 1000); return; }
          transportEvt('loop', { pass });
        };
        setTimeout(fire, Math.max(0, (heard - ctx.currentTime) * 1000));
      }
    }
  }

  // Schedule the song range [sA, sB), which starts at u = uA in segment segIndex. chase: also the notes held at sA
  // (a fresh segment: after play, a seek or a loop wrap), started at sA.
  function scheduleRange(sA, sB, uA, segIndex, { fresh = false, chase = false, cut = Infinity, click = false, audio = true, song = true } = {}, events) {
    const p = P();
    const time = (beat) => frame(ctx, uToTime(uA + (beat - sA)));
    const now = ctx.currentTime;
    if (click) clicksIn(sA, sB, uA, time, now);
    if (!song) return;
    if (AU.lanes.length) autoSegments(sA, sB, segIndex, { cut, chase }, time);
    for (const n of notesIn(p, sA, sB, { cut, chase })) {
      if (hushed.size && hushed.has(n.clip)) continue;
      const k = n.key + '@' + segIndex;
      if (T.scheduled.has(k)) continue;
      const s = strips.get(n.track);
      const inst = s && s.instance('instrument');
      if (!inst) continue;
      const c = compOf(n.track), t = time(n.at) + c;
      if (t < now) continue; // too late to play it (an edit inside the window that is already past)
      const v = velOf(n.note);
      const off = { t: Math.max(t + 0.001, time(n.off) + c), inst, p: n.note.p, onT: t, track: n.track, kind: 'sched', entry: null };
      const e = { note: true, t, c, inst, p: n.note.p, v, track: n.track, off, offSent: false, get end() { return this.off.t; } };
      off.entry = e;
      T.scheduled.set(k, e);
      events.push({ t, inst, p: n.note.p, v, track: n.track, x: noteExpr(n.note, spbNow(), n.into) });
      pendingOffs.push(off);
    }
    if (audio && rate === 1) {   // (at a practice speed audio clips sit out: they can't follow in tune)
      for (const a of audioIn(p, sA, sB, { cut, fresh })) {
        const k = a.key + '@' + segIndex;
        if (T.scheduled.has(k)) continue;
        const c = compOf(a.track), t0 = time(a.at) + c, t1 = time(a.end) + c;
        T.scheduled.set(k, startAudio(a, t0, t1, a.into * spbNow(), null, c));
      }
    }
  }

  // ---- automation
  const isKernel = (inst) => !!(inst && typeof inst.auto === 'function');
  const instOf = (track, insert) => {
    if (track === 'master') return master ? master.instance(insert) : null;
    const s = strips.get(track);
    return s ? s.instance(insert) : null;
  };
  const autoComp = (track) => (track === 'master' ? 0 : compOf(track));
  // The lanes that play now (lanesOf), and, while playing, what an edit changed (see the header).
  function refreshLanes(p) {
    // (the store edits the song in place, so the same document can hold new lanes: what changed is told by the lane
    // objects, which every auto op, undo and load replaces)
    const lanes = lanesOf(p);
    if (AU.doc === p && lanes.length === AU.lanes.length && lanes.every((L, i) => L.id === AU.lanes[i].id && L.lane === AU.lanes[i].lane)) return;
    AU.doc = p;
    const was = AU.byId;
    AU.lanes = lanes;
    AU.byId = new Map(AU.lanes.map((L) => [L.id, L]));
    const sigs = new Map(AU.lanes.map((L) => [L.id, JSON.stringify(L.lane.points)]));
    if (T.playing && ctx) {
      for (const [id, L] of was) if (!AU.byId.has(id)) laneGone(L);
      for (const L of AU.lanes) if (AU.sigs.get(L.id) !== sigs.get(L.id)) laneMoved(L, was.has(L.id));
    }
    AU.sigs = sigs;
  }
  // a lane that no longer plays (cleared, held, its device gone): its param goes back to the static value
  function laneGone(L) {
    for (const k of AU.sent) if (k.startsWith(L.id + '/')) AU.sent.delete(k);
    if (L.kind === 'mix') { AU.mix.delete(L.id); return; }
    const inst = instOf(L.track, L.insert);
    if (!inst) return;
    if (isKernel(inst)) { try { inst.autoClear(L.param, ctx.currentTime, true); } catch (e) { /* gone */ } }
    else if (inst.__auto) { delete inst.__auto[L.param]; inst.__sig = null; const g = AU.graph.get(inst); if (g) g.t = 0; }
  }
  // a lane edited (or new) while playing: what was handed over from now is taken back and sent again
  function laneMoved(L, had) {
    for (const k of AU.sent) if (k.startsWith(L.id + '/')) AU.sent.delete(k);
    if (L.kind === 'mix') {
      const m = AU.mix.get(L.id);
      if (m) {
        const F = Math.ceil(soon(ctx) * ctx.sampleRate / GRID) * GRID;
        for (const prm of mixParams(L)) { try { prm.cancelScheduledValues(F / ctx.sampleRate); } catch (e) { /* closed */ } }
        m.F = F - GRID;
      }
      return;
    }
    const inst = instOf(L.track, L.insert);
    if (!inst) return;
    if (!isKernel(inst)) { const g = AU.graph.get(inst); if (g) g.t = 0; return; }
    if (had) { try { inst.autoClear(L.param, ctx.currentTime); } catch (e) { /* gone */ } }
    let first = true;
    eachScheduled((sA, sB, ua, i, cut) => {
      const time = (beat) => frame(ctx, uToTime(ua + (beat - sA)));
      sendSegments(autoIn(P(), sA, sB, { cut, chase: first, lanes: [L] }), i, time);
      first = false;
    });
  }
  // kernel segments starting in [sA, sB) (chase: and the one playing at sA)
  function autoSegments(sA, sB, segIndex, { cut, chase }, time) {
    const lanes = AU.lanes.filter((L) => L.kind === 'device');
    if (lanes.length) sendSegments(autoIn(P(), sA, sB, { cut, chase, lanes }), segIndex, time);
  }
  function sendSegments(list, segIndex, time) {
    for (const g of list) {
      const k = g.key + '@' + segIndex + (g.start !== g.at ? '/' + g.start : '');
      if (AU.sent.has(k)) continue;
      const inst = instOf(g.track, g.insert);
      if (!isKernel(inst)) continue;
      AU.sent.add(k);
      const c = autoComp(g.track);
      try { inst.auto({ key: g.param, time: time(g.at) + c, end: time(g.end) + c, a: g.a, b: g.b, c: g.c, start: time(g.start) + c }); AU.insts.add(inst); } catch (e) { /* gone */ }
    }
    if (AU.sent.size > 20000) AU.sent.clear(); // (a re-sent segment is harmless: the latest-starting one plays)
  }
  const mixParams = (L) => {
    const s = L.track === 'master' ? master : strips.get(L.track);
    if (!s) return [];
    return L.param === 'gain' ? [s.fader.gain] : s.panL ? [s.panL.gain, s.panR.gain] : [];
  };
  // the song beat a track plays at audio time t (its compensation allowed for), on the transport's map
  const songAt = (t, c) => { const tt = t - c; return uToSong(tt <= T.startT ? 0 : Math.max(0, timeToU(tt))); };
  // Gain and pan control points and graph device sets, up to audio time H (each tick, while playing).
  const GRAPH_STEP = 0.02;
  function autoControl(H) {
    if (!AU.lanes.length) return;
    const sr = ctx.sampleRate, FH = Math.floor(H * sr / GRID) * GRID;
    const graph = new Map();
    for (const L of AU.lanes) {
      if (L.kind === 'device') {
        const inst = instOf(L.track, L.insert);
        if (inst && !isKernel(inst) && inst.set) { if (!graph.has(inst)) graph.set(inst, []); graph.get(inst).push(L); }
        continue;
      }
      const prm = mixParams(L);
      if (!prm.length) continue;
      const c = autoComp(L.track), tr = travel(L.spec);
      let m = AU.mix.get(L.id);
      if (!m) {
        // taking over: from where the param is now, then the grid
        const t0 = soon(ctx), F0 = Math.ceil(t0 * sr / GRID) * GRID;
        for (const q of prm) { try { q.cancelScheduledValues(t0); q.setValueAtTime(q.value, t0); } catch (e) { /* closed */ } }
        m = { F: F0 - GRID };
        AU.mix.set(L.id, m);
      }
      for (let F = m.F + GRID; F <= FH; F += GRID) {
        const pos = lanePos(L.lane, songAt(F / sr, c), L.spec, tr), t = F / sr;
        if (pos == null) continue;
        try {
          if (L.param === 'gain') prm[0].linearRampToValueAtTime(mixGain(pos), t);
          else { const [l, r] = panGains(pos); prm[0].linearRampToValueAtTime(l, t); prm[1].linearRampToValueAtTime(r, t); }
        } catch (e) { /* closed */ }
        m.F = F;
      }
    }
    for (const [inst, list] of graph) {
      let g = AU.graph.get(inst);
      if (!g) { g = { t: 0 }; AU.graph.set(inst, g); }
      const L0 = list[0], c = autoComp(L0.track);
      const spec = L0.track === 'master' ? masterSpec(P(), { at: T.cursor }) : trackSpec((P().tracks || []).find((x) => x.id === L0.track) || {}, { at: T.cursor });
      const base = L0.insert === 'instrument' ? (spec.instrument && spec.instrument.params) : ((spec.inserts.find((x) => x.id === L0.insert) || {}).params);
      let t = Math.max(g.t + GRAPH_STEP, soon(ctx));
      for (; t <= H; t += GRAPH_STEP) {
        const beat = songAt(t, c), over = {};
        for (const L of list) { const v = laneValue(L.lane, beat, L.spec); if (v != null) over[L.param] = v; }
        inst.__auto = over;
        try { inst.set({ ...(base || {}), ...over }, { at: t }); } catch (e) { /* a device that can't */ }
        g.t = t;
      }
    }
  }
  // The transport stopped (release: the lanes let go of every param) or jumped (seek: what was queued is dropped).
  function autoHalt(release) {
    for (const inst of AU.insts) {
      try { if (release) inst.autoStop(); else inst.autoClear(null, ctx.currentTime); } catch (e) { /* gone */ }
    }
    if (release) AU.insts.clear();
    AU.sent.clear();
    AU.mix.clear();
    for (const inst of AU.graph.keys()) { if (release) { inst.__auto = null; inst.__sig = null; } }
    AU.graph.clear();
  }

  // The clicks on the beats of [sA, sB) (u from uA): every one inside the count-in, the rest when the click is on.
  // The beats are counted from each bar line, so every bar starts on an (accented) click: in 7/8 (3.5 beats) a bar
  // clicks at 0, 1, 2 and 3, the last beat an eighth long, and the next bar line, at 3.5, clicks again.
  // (fill: only the clicks the click's being on adds, for the stretch already handed over when it turned on)
  function clicksIn(sA, sB, uA, time, now, fill = false) {
    const cnt = T.count, inCount = (b) => !!cnt && uA + (b - sA) < cnt.beats - 1e-9;
    const on = clickOn();
    const bpb = bpbNow(), beats = [];
    for (let bar = Math.floor(sA / bpb + 1e-9) - 1; bar * bpb < sB - 1e-9; bar++) {
      for (let j = 0; j < bpb - 1e-9; j++) { const b = bar * bpb + j; if (b >= sA - 1e-9 && b < sB - 1e-9) beats.push([b, j === 0]); }
    }
    if (!on && (fill || !beats.length || !inCount(beats[0][0]))) return;
    for (const [b, accent] of beats) {
      const counting = inCount(b);
      if (counting ? fill : !on) continue;
      const t = time(b);
      if (t >= now) clickAt(frame(ctx, t + pdc.total), accent, counting);
    }
  }

  const velOf = (note) => (Number.isFinite(note.v) ? Math.max(0, Math.min(1, note.v)) : 0.8);

  // The stretch of the song the scheduler has already handed over and that hasn't been heard yet: for each segment
  // overlapping [now - back, schedU), fn(sA, sB, ua, seg index, cut).
  function eachScheduled(fn, back = 0) {
    const uNow = Math.max(0, timeToU(ctx.currentTime - back));
    if (uNow >= T.schedU) return;
    for (let j = 0; j < T.segs.length; j++) {
      const seg = T.segs[j], end = j + 1 < T.segs.length ? T.segs[j + 1].u0 : T.schedU;
      const ua = Math.max(uNow, seg.u0), ub = Math.min(end, T.schedU);
      if (ub - ua <= 1e-9) continue;
      const sA = seg.s0 + (ua - seg.u0), sB = sA + (ub - ua);
      const cut = j + 1 < T.segs.length ? sB : loopCut(sA, ua);
      if (!seg.quiet) fn(sA, sB, ua, seg.i, cut);   // (a count-in's quiet segment holds nothing of the song)
    }
  }

  // Which edits can move what is already scheduled (a knob turn can't: no need to look)
  let needRevise = false;
  const NOTE_OPS = /^(notes\.|clip\.|track\.(remove|move|add)|project\.|instrument\.|asset\.|time\.|section\.duplicate)/;   // (time.* and section.duplicate move clips: core/arrangement.js)
  const touchesNotes = (evt) => !evt || !Array.isArray(evt.ops) || !evt.ops.length || evt.ops.some((o) => !o || NOTE_OPS.test(String(o.type || '')));

  // An edit while playing: first take back what no longer matches the document (revise), then schedule notes (and
  // clips) that now start inside the window the scheduler has already passed, if their time hasn't come yet. Keys make
  // sure nothing plays twice.
  function rescan() {
    if (!T.playing || !ctx) return;
    if (needRevise) { needRevise = false; revise(); }
    const events = [];
    eachScheduled((sA, sB, ua, i, cut) => scheduleRange(sA, sB, ua, i, { cut }, events));
    dispatch(events);
    pickUpAudio();
  }

  // An audio clip that covers the playhead but isn't playing (just unmuted, the take swapped in, moved under the
  // playhead): it starts mid-way at soon(), on its track's held-back time, as revise() does for a re-trimmed one.
  function pickUpAudio() {
    if (rate !== 1) return;
    const p = P(), safe = soon(ctx);
    eachScheduled((sA, sB, ua, i, cut) => {
      for (const t of p.tracks || []) {
        if (!(t.clips || []).some((c) => c.kind === 'audio' && !c.mute)) continue;
        const c = compOf(t.id), at = sA + (timeToU(safe - c) - ua);
        if (at < sA - 1e-9 || at >= sB - 1e-9) continue;
        for (const a of audioIn(p, at, at + 1e-6, { cut, fresh: true, tracks: [t.id] })) {
          const k = a.key + '@' + i;
          if (!(a.into > 1e-6) || T.scheduled.has(k)) continue;
          const t1 = frame(ctx, uToTime(ua + (a.end - sA))) + c;
          if (t1 - safe > 0.005) T.scheduled.set(k, startAudio(a, safe, t1, a.into * spbNow(), null, c));
        }
      }
    }, pdc.max);
  }

  // Compare what was handed over with what the document says now (see the header). Runs on every edit while playing.
  function revise() {
    if (!T.scheduled.size) return;
    const p = P(), eps = 1.5 / ctx.sampleRate, safe = soon(ctx); // (a frame either way is rounding, not an edit)
    const notes = new Map(), clips = new Map();
    eachScheduled((sA, sB, ua, i, cut) => {
      const time = (beat) => frame(ctx, uToTime(ua + (beat - sA)));
      for (const n of notesIn(p, sA, sB, { cut, chase: true })) if (!hushed.has(n.clip)) notes.set(n.key + '@' + i, { n, on: time(n.at), off: time(n.off) });
      for (const a of audioIn(p, sA, sB, { cut, fresh: true })) clips.set(a.key + '@' + i, { a, t1: time(a.end), sA, ua });
    }, pdc.max); // (a held-back track is still playing what the song passed up to pdc.max ago)
    for (const [k, e] of T.scheduled) {
      if (e.end <= safe) continue; // over (or about to be) anyway
      if (e.note) {
        // (times compared with the comp the entry was scheduled with: a latency change alone moves nothing)
        const w = notes.get(k), started = e.t <= safe;
        if (!w || w.n.note.p !== e.p || (!started && (Math.abs(w.on + e.c - e.t) > eps || velOf(w.n.note) !== e.v))) { takeBack(k, e, started); continue; }
        const off = Math.max(e.t + 0.001, w.off + e.c);
        if (Math.abs(off - e.off.t) > eps) moveRelease(e, started ? Math.max(off, safe) : off);
        continue;
      }
      if (e.audio) {
        const w = clips.get(k);
        if (w && w.a.clip.asset === e.asset && (+w.a.clip.offset || 0) === e.offset && Math.abs(w.t1 + e.c - e.end) <= eps) continue;
        if (e.h) e.h.fadeOut(e.t > safe ? e.t : safe);
        e.dropped = true;
        T.scheduled.delete(k);
        // still covering the playhead: pick it up mid-way where it now is (one that starts later is rescheduled)
        if (w && e.t <= safe && rate === 1) {
          const at = w.sA + (timeToU(safe - e.c) - w.ua); // the song beat this track plays at `safe`
          const into = w.a.into + (at - w.a.at), t1 = w.t1 + e.c;
          if (into >= 0 && t1 - safe > 0.005) T.scheduled.set(k, startAudio(w.a, safe, t1, into * spbNow(), null, e.c));
        }
      }
    }
  }

  // A note handed over that the document no longer has (or has elsewhere): not started, it never sounds; sounding,
  // it is released now.
  function takeBack(k, e, started) {
    T.scheduled.delete(k);
    if (!e.offSent) pendingOffs = pendingOffs.filter((o) => o !== e.off);
    const safe = soon(ctx);
    try {
      if (e.inst.cancel) e.inst.cancel(e.p, e.t, e.offSent ? e.off.t : null);
      else e.inst.noteOff(e.p, started ? safe : e.t); // (an instrument that can't take a note back: release it at once)
    } catch (err) { /* a disposed instrument */ }
  }

  // A sounding note whose end moved.
  function moveRelease(e, to) {
    if (!e.offSent) { e.off.t = to; return; }
    try {
      if (e.inst.cancel) { e.inst.cancel(e.p, e.t, e.off.t, to); e.off.t = to; }
      else if (to < e.off.t) { e.inst.noteOff(e.p, to); e.off.t = to; }
    } catch (err) { /* a disposed instrument */ }
  }

  // Play an audio clip from t0 to t1 (intoSec into it). Returns its scheduled entry ({ audio, t, end, h, ... }); h, the
  // playing handle, comes later if the samples are still loading.
  function startAudio(a, t0, t1, intoSec, entry = null, c = 0) {
    const e = entry || { audio: true, t: t0, end: t1, c, h: null, asset: a.clip.asset, offset: +a.clip.offset || 0, track: a.track };
    const s = strips.get(a.track);
    if (!s) return e;
    const buf = assets.peek(a.clip.asset);
    if (!buf) {
      waitingAudio.push({ a, t0, t1, intoSec, gen: T.gen, entry: e });
      assets.get(a.clip.asset).then((b) => { if (!b) report({ kind: 'asset', track: a.track, asset: a.clip.asset, message: `audio asset "${a.clip.asset}" is missing` }); });
      return e;
    }
    const h = playBuffer(ctx, buf, s.head, { t0, offset: (+a.clip.offset || 0) + intoSec, t1, gainDb: +a.clip.gain || 0 });
    if (h) { sources.add(h); h.src.addEventListener('ended', () => sources.delete(h)); }
    e.h = h;
    return e;
  }

  // A clip whose samples arrived late starts mid-way, if it is still meant to be sounding.
  function retryWaitingAudio() {
    if (!waitingAudio.length) return;
    const now = ctx.currentTime;
    for (let i = waitingAudio.length - 1; i >= 0; i--) {
      const w = waitingAudio[i];
      if (w.gen !== T.gen || now >= w.t1 || !T.playing) { waitingAudio.splice(i, 1); continue; }
      if (!assets.peek(w.a.clip.asset)) continue;
      waitingAudio.splice(i, 1);
      const t0 = Math.max(w.t0, now + 0.01);
      if (w.entry.dropped) continue;
      startAudio(w.a, t0, w.t1, w.intoSec + (t0 - w.t0), w.entry);
    }
  }

  // The metronome: a short synthesized click (higher and louder on the bar), to the speakers through the master's
  // monitor soft clip (summed with the mix after the master fader: never in masterTap or a render). It is held back
  // by the plugin latency so it lands with the beat you hear.
  // (the sound is engine/click.js's, made once per context: a wood-block knock that cuts through a drum kit)
  let clickBufs = null;
  function clickAt(t, accent, count = false) {
    if (!clickBufs || clickBufs.ctx !== ctx) {
      const mk = (a) => { const x = clickSamples(ctx.sampleRate, a), b = ctx.createBuffer(1, x.length, ctx.sampleRate); b.getChannelData(0).set(x); return b; };
      clickBufs = { ctx, beat: mk(false), bar: mk(true) };
    }
    const o = ctx.createBufferSource();
    o.buffer = accent ? clickBufs.bar : clickBufs.beat;
    o.connect(clickBus);
    o.start(t);
    o.count = count;
    clicks.add(o);
    o.onended = () => { clicks.delete(o); try { o.disconnect(); } catch (e) { /* ok */ } };
  }

  // The click turned off (or a whileRecording click whose take ended): the clicks already handed over stop, except
  // the count-in's.
  function trimClicks() {
    if (!ctx || clickOn()) return;
    const t = soon(ctx);
    for (const o of clicks) { if (o.count) continue; try { o.stop(t); } catch (e) { /* ok */ } clicks.delete(o); }
  }
  // The click turned on mid-play: the beats the scheduler has already passed get theirs too.
  function fillClicks() {
    if (!ctx || !T.playing || !clickOn()) return;
    const now = soon(ctx);
    eachScheduled((sA, sB, ua) => clicksIn(sA, sB, ua, (beat) => frame(ctx, uToTime(ua + (beat - sA))), now, true));
  }
  function setClick(v) {
    if (!v || typeof v !== 'object') return;
    const was = clickOn();
    if ('on' in v) click.on = !!v.on;
    if ('whileRecording' in v) click.whileRecording = !!v.whileRecording;
    if ('level' in v && Number.isFinite(+v.level)) {
      click.level = Math.max(-60, Math.min(6, +v.level));
      if (clickBus) ramp(ctx, clickBus.gain, dbToGain(click.level), 0.02);
    }
    trimClicks();
    if (!was) fillClicks();
    transportEvt('metronome');
  }

  // ------------------------------------------------------------------------------------------- transport
  // Silence what the transport started: notes released, clips faded, clicks cancelled. live: the keys the musician is
  // holding go too (their own Stop and the killswitch); otherwise an instrument they are playing keeps their notes,
  // and only the transport's are let go on it (each one by its own off: allOff would take theirs with it).
  function halt(at = null, release = true, live = true) {
    const now = at == null ? soon(ctx) : at;
    autoHalt(release);
    // the transport's notes still to come (their offs not sent yet), and every instrument they went to
    const offs = pendingOffs.filter((o) => o.kind === 'sched');
    pendingOffs = pendingOffs.filter((o) => o.kind !== 'sched');
    const insts = new Set();
    if (master) for (const s of strips.values()) { const i = s.instance('instrument'); if (i) insts.add(i); }
    for (const o of offs) insts.add(o.inst);
    const playedLive = new Set(live ? [] : liveHeld.values());
    const step = ctx ? 1 / ctx.sampleRate : 0;
    // (see "Stop" in the header: flushed, then released)
    for (const i of insts) {
      try { if (i.flush) i.flush(now); } catch (e) { /* ok */ }
      if (!playedLive.has(i)) { try { i.allOff(now); } catch (e) { /* ok */ } continue; }
      if (!i.flush) continue;   // (its pending offs below; an off already sent was handed over with its own time)
      // started before `now` and not over by then: its off (if it had gone) went with the flush, so one goes now
      const seen = new Set();
      const started = [...[...T.scheduled.values()].filter((e) => e.note && e.inst === i && e.off.t >= now).map((e) => e.off), ...offs.filter((o) => o.inst === i)];
      for (const o of started) {
        if (o.onT >= now || seen.has(o)) continue;
        seen.add(o);
        try { i.noteOff(o.p, Math.max(now, o.onT + step)); } catch (e) { /* ok */ }
      }
    }
    offs.sort((a, b) => a.onT - b.onT);
    for (const o of offs) {
      if (o.inst.flush) continue; // (its queued notes went with the flush; what had started, allOff (or its off) released)
      try {
        if (o.onT >= now && o.inst.cancel) o.inst.cancel(o.p, o.onT, null);
        else o.inst.noteOff(o.p, Math.max(now, o.onT + step));
      } catch (e) { /* ok */ }
    }
    for (const h of sources) h.fadeOut(now);
    sources.clear();
    for (const o of clicks) { try { o.stop(now); } catch (e) { /* ok */ } }
    clicks.clear();
    waitingAudio.length = 0;
    if (live) liveHeld.clear();
    T.scheduled.clear();
  }

  // Start the transport at song beat `from`, or `count.beats` before it with a count-in (see the header).
  function begin(from, count = null) {
    T.gen = (T.gen || 0) + 1;
    const now = ctx.currentTime;
    T.startT = frame(ctx, now + START_DELAY);
    T.anchors = [{ t: T.startT, u: 0, spb: spbNow() }];
    const s0 = count ? from - count.beats : from;
    T.segs = [{ u0: 0, s0, fresh: true, i: 0, quiet: !!count && !count.preroll }];
    if (count && !count.preroll) T.segs.push({ u0: count.beats, s0: from, fresh: true, i: 1 });
    T.s0 = s0;
    T.from = from;
    T.schedU = 0;
    T.wraps = 0;
    T.count = count ? { from: s0, until: from, beats: count.beats, preroll: !!count.preroll, ended: false } : null;
    T.playing = true;
    const events = [];
    scheduleUntil(ctx.currentTime + AHEAD, events);
    dispatch(events);
    if (T.count) armCountEnd(T.gen);
  }

  // 'countin-end' at the audible downbeat (re-armed if the timer fires early or the tempo moved the downbeat).
  function armCountEnd(gen) {
    const k = T.count;
    const left = Math.max(0, (uToTime(k.beats) + outLatency() + pdc.total - ctx.currentTime) * 1000);
    setTimeout(() => {
      if (!T.playing || T.gen !== gen || T.count !== k || k.ended) return;
      if (gridNow() - T.s0 < k.beats - 1e-3) { armCountEnd(gen); return; }
      k.ended = true;
      transportEvt('countin-end', { until: k.until });
    }, left);
  }

  // A count-in: { beats (> 0, at most 4 bars), preroll (default true) }, or null.
  function countOf(o) {
    const c = o && o.countIn;
    if (!c || c === true) return c === true ? { beats: bpbNow(), preroll: true } : null;
    const beats = +c.beats;
    if (!(beats > 0)) return null;
    return { beats: Math.min(beats, 4 * bpbNow()), preroll: c.preroll !== false };
  }

  // A play that has to wait (the engine starting, a renew under way) is still the transport's: stop(), the killswitch
  // or a newer play() in the meantime wins, and it never starts (engine.starting says one is waiting).
  let playReq = 0, waitReq = -1;
  async function play(fromBeat, opts = null) {
    const req = ++playReq, h0 = hush;
    waitReq = req;
    try {
      await start();
      if (renewing) await renewing;
      if (calm && calm.renewing) await calm.job;
      if (ctx.state !== 'running' && req === playReq && h0 === hush) await wakeCtx(ctx);
    } finally { if (waitReq === req) waitReq = -1; }
    if (req !== playReq || h0 !== hush || disposed) return api;
    calmCancel();
    const from = Math.max(0, Number.isFinite(fromBeat) ? fromBeat : T.cursor);
    if (T.playing) halt(null, false, false);   // (the keys the musician holds play on)
    T.cursor = from;
    begin(from, countOf(opts));
    if (AU.lanes.length) reconcile();
    transportEvt('play');
    return api;
  }

  // Where the playhead rests after a stop: where it is, or (stopped in a count-in) where the count was going.
  const restAt = () => (countingNow() ? T.count.until : Math.max(0, beatNow()));
  // (the 'stop' event still says recording: true; then the take is over)
  function endTake() { if (recording) { recording = false; trimClicks(); } }

  // extra: { end } (the song's end), { live: false } (a stop the musician didn't press: an agent's, the song's end;
  // the keys they hold play on). Stopped already, a stop still cancels a play that is waiting.
  function stop(extra = null) {
    playReq++;
    if (!ctx) return;
    const was = T.playing;
    if (was) T.cursor = restAt();
    T.playing = false;
    halt(null, true, !(extra && (extra.live === false || extra.end)));
    if (AU.lanes.length) reconcile(); // (every automated param to its lane's value at the cursor)
    transportEvt('stop', extra && extra.end ? { end: true } : null);
    T.count = null;
    endTake();
    if (was) politeStop();
  }

  // The song's end (see the header): true when the transport should stop itself now.
  function atSongEnd() {
    if (recording) return false;
    if (lastEnd == null) lastEnd = lastSound(P());
    if (!(lastEnd > 0)) return false;
    const bpb = bpbNow(), end = Math.ceil(lastEnd / bpb - 1e-9) * bpb + bpb;
    if (!(T.from < end - 1e-9)) return false;       // (played from at or past the end: it runs on)
    const b = beatNow();
    return b >= end - 1e-9 && loopCut(b, Infinity) === Infinity;
  }

  // ---- the polite stop (see the header)
  function politeStop() {
    calmCancel();
    if (!ctx || disposed || ctx.state !== 'running') return;
    const c = { stopT: ctx.currentTime, strips: new Set(), fading: false, renewing: false, job: null };
    calm = c;
    afterAudio(ctx, c.stopT + RING, () => calmTails(c));
  }
  const liveOn = (id) => { for (const k of liveHeld.keys()) if (k.startsWith(id + ':')) return true; return false; };
  function calmTails(c) {
    if (calm !== c) return;
    if (T.playing || disposed || renewing || ctx.state !== 'running') { calm = null; return; }
    let busy = false;
    for (const [id, s] of strips) {
      if ((lastLive.get(id) ?? -1) >= c.stopT || liveOn(id) || s.hearsInput()) { busy = true; continue; }
      const m = s.read();
      if (m && m.peak > CALM_DB) c.strips.add(s);
    }
    if (!busy && master.fx.length) { const m = master.read(); if (m && m.peak > CALM_DB) c.strips.add(master); }
    if (!c.strips.size) { calm = null; return; }
    // (the master's fade covers the tracks behind it: fading both would fade them twice as fast)
    const t = soon(ctx);
    for (const s of c.strips) if (!c.strips.has(master) || s === master) s.calmDown(t, CALM_FADE);
    c.fading = true;
    // a monitored mic or guitar that starts again during the fade is live playing: its strip (or the master's whole
    // fade, when it goes through a fading master) comes straight back and isn't renewed under the player
    const listen = () => {
      if (calm !== c || !c.fading || c.renewing || disposed) return;
      for (const [id, s] of strips) if (s.hearsInput()) liveTouch(id);
      if (calm === c && !c.renewing) setTimeout(listen, 20);
    };
    listen();
    c.job = new Promise((res) => afterAudio(ctx, t + CALM_FADE + 0.03, res)).then(async () => {
      if (calm !== c || disposed) return;
      c.renewing = true;
      const list = [...c.strips];
      if (!list.length) { calm = null; return; }
      await Promise.race([Promise.all(list.map((s) => s.renew().catch(() => {}))), sleep(1500)]);
      for (const s of list) s.calmUp();
      if (calm === c) calm = null;
      updatePdc();
    });
  }
  // Play, the killswitch or a live note on a fading strip: the fade lets go (a renew under way finishes on its own).
  function calmCancel(only = null) {
    const c = calm;
    if (!c || c.renewing) { if (!only) calm = null; return; }
    // (a live note behind a fading master: the whole fade lets go, since the note is heard through the master)
    if (only && !c.strips.has(master)) { if (c.fading && c.strips.delete(only)) only.calmUp(); return; }
    calm = null;
    if (c.fading) for (const s of c.strips) s.calmUp();
  }
  function liveTouch(trackId) {
    if (!ctx) return;
    lastLive.set(trackId, ctx.currentTime);
    const s = strips.get(trackId);
    if (s && calm) calmCancel(s);
  }

  function seek(beat) {
    const b = Math.max(0, Number(beat) || 0);
    T.cursor = b;
    if (T.playing && ctx) { halt(null, false, false); begin(b); }
    if (ctx && AU.lanes.length) reconcile();
    transportEvt('seek');
  }

  function toggle() { return T.playing || api.starting ? (stop(), Promise.resolve(api)) : play(); }

  // Practice speed (see `rate` above): 0.25..2, 1 the song's own tempo. A change while playing re-anchors the transport
  // where the scheduler has reached, as a tempo change does, so nothing already handed over moves; audio clips fade out
  // as it leaves 1 and are picked up mid-way when it comes back. 'transport' why 'rate'.
  function setRate(v) {
    const r = Math.max(0.25, Math.min(2, Number.isFinite(+v) && +v > 0 ? +v : 1));
    if (Math.abs(r - rate) < 1e-9) return;
    const was = rate;
    rate = r;
    if (ctx && T.playing && was === 1 && r !== 1) {
      const t = soon(ctx);
      for (const h of sources) h.fadeOut(t);
      sources.clear();
      for (const [k, e] of T.scheduled) if (e.audio) { e.dropped = true; T.scheduled.delete(k); }
      waitingAudio.length = 0;
    }
    reconcile();
    if (ctx && T.playing && r === 1) pickUpAudio();
    transportEvt('rate');
  }

  // The killswitch (see the header). Resolves when the speakers are open again, with fresh devices behind them.
  const KILL_FADE = 0.006;
  function silence() {
    hush++; playReq++;
    if (!ctx) { ev.emit('silence', { at: 0 }); return Promise.resolve(api); }
    const t0 = soon(ctx), t1 = t0 + KILL_FADE;
    try {
      kill.gain.cancelScheduledValues(t0);
      kill.gain.setValueAtTime(renewing ? 0 : kill.gain.value, t0);
      kill.gain.linearRampToValueAtTime(0, t1);
    } catch (e) { /* closed */ }
    if (T.playing) { T.cursor = restAt(); T.playing = false; }
    calmCancel();
    halt(t1);
    // auditions and live notes: their offs are moot (every instrument is renewed), and nothing may fire later
    pendingOffs = [];
    T.scheduled.clear();
    transportEvt('stop');
    T.count = null;
    endTake();
    ev.emit('silence', { at: t1 });
    const mine = hush;
    const job = (async () => {
      await new Promise((res) => afterAudio(ctx, t1 + 0.004, res));
      if (disposed) return;
      const all = [...strips.values(), master].filter(Boolean);
      await Promise.race([Promise.all(all.map((s) => s.renew().catch(() => {}))), sleep(1500)]);
      if (disposed || mine !== hush) return; // a newer silence opens the feed itself
      for (const s of all) s.calmUp(true);   // (a polite stop's fade it cut short: open with the feed)
      try {
        const t = soon(ctx);
        kill.gain.cancelScheduledValues(t);
        kill.gain.setValueAtTime(0, t);
        kill.gain.linearRampToValueAtTime(1, t + 0.01);
      } catch (e) { /* closed */ }
      updatePdc();
    })();
    const done = renewing = job.finally(() => { if (renewing === done) renewing = null; });
    return done.then(() => api);
  }

  // ------------------------------------------------------------------------------------------- live play
  function liveInst(trackId) { const s = strips.get(trackId); return s ? s.instance('instrument') : null; }
  // a key pressed before the engine was up plays once it is, unless it was let go meanwhile (its off came first); so
  // does one pressed while the track's samples are loading
  const liveWait = new Map();        // `${track}:${pitch}` -> token
  function liveNoteOn(trackId, pitch, vel = 0.8) {
    if (!ctx) {
      const h0 = hush, k = trackId + ':' + pitch, tok = {};
      liveWait.set(k, tok);
      start().then(() => { if (liveWait.get(k) !== tok) return; liveWait.delete(k); if (h0 === hush) liveNoteOn(trackId, pitch, vel); });
      return;
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    liveTouch(trackId);
    const inst = liveInst(trackId);
    if (!inst) return;
    const k = trackId + ':' + pitch;
    // a sampled instrument whose samples are still on their way: the key waits for them and sounds once they're in,
    // if it is still down (as a key pressed before the engine was up does). The track's header says they're loading;
    // 'kitwait' tells anyone listening that a note is waiting
    if (inst.data && inst.data.state === 'loading' && typeof inst.on === 'function') {
      const h0 = hush, tok = {};
      liveWait.set(k, tok);
      const off = inst.on('data', () => { off(); if (liveWait.get(k) !== tok) return; liveWait.delete(k); if (h0 === hush) liveNoteOn(trackId, pitch, vel); });
      ev.emit('kitwait', { track: trackId, pitch });
      return;
    }
    if (liveHeld.has(k)) { try { liveHeld.get(k).noteOff(pitch, ctx.currentTime); } catch (e) { /* ok */ } }
    liveHeld.set(k, inst);
    try { inst.noteOn(pitch, Math.max(0, Math.min(1, vel)), ctx.currentTime); } catch (e) { report({ kind: 'note', track: trackId, message: e.message }); }
  }
  // the channel's expression (pitch bend, mod wheel, sustain pedal: input/midi.js) on a track's instrument, now
  function liveExpr(trackId, x) {
    if (!ctx) return;
    const inst = liveInst(trackId);
    if (inst && inst.expr) { try { inst.expr(x, ctx.currentTime); } catch (e) { /* ok */ } }
  }
  function liveNoteOff(trackId, pitch) {
    const k = trackId + ':' + pitch;
    liveWait.delete(k);
    if (!ctx) return;
    const inst = liveHeld.get(k) || liveInst(trackId);
    liveHeld.delete(k);
    if (inst) { try { inst.noteOff(pitch, ctx.currentTime); } catch (e) { /* ok */ } }
  }
  async function audition(trackId, pitch, vel = 0.8, beats = 0.5) {
    const h0 = hush;
    if (!ctx) await start();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    await settled();
    if (h0 !== hush || renewing) return; // the killswitch went in the meantime
    liveTouch(trackId);
    if (calm && calm.renewing) await calm.job;
    let inst = liveInst(trackId);
    if (!inst) return;
    // (a sampled instrument still loading: the audition waits for its samples, up to 30 s, and then sounds)
    if (inst.data && inst.data.state === 'loading' && typeof inst.on === 'function') {
      await new Promise((resolve) => { const off = inst.on('data', () => { off(); clearTimeout(tm); resolve(); }); const tm = setTimeout(() => { off(); resolve(); }, 30000); });
      if (h0 !== hush) return;
      inst = liveInst(trackId);
      if (!inst) return;
    }
    const t = ctx.currentTime;
    try { inst.noteOn(pitch, Math.max(0, Math.min(1, vel)), t); } catch (e) { return; }
    pendingOffs.push({ t: t + Math.max(0.03, beats * spbNow()), inst, p: pitch, onT: t, track: trackId, kind: 'live' });
  }

  // ------------------------------------------------------------------------------------------- debug: voices
  const voiceTaps = new WeakMap();   // instance -> an analyser on its output
  async function voices() {
    const out = {};
    if (!ctx) return out;
    let fresh = false;
    const list = [];
    for (const [id, s] of strips) {
      const inst = s.instance('instrument');
      if (!inst) continue;
      let a = voiceTaps.get(inst);
      if (!a && inst.output) { a = ctx.createAnalyser(); a.fftSize = 2048; try { inst.output.connect(a); } catch (e) { a = null; } if (a) { voiceTaps.set(inst, a); fresh = true; } }
      list.push([id, inst, a]);
    }
    if (fresh) await sleep(60); // (a new tap has heard nothing yet)
    const buf = new Float32Array(2048);
    await Promise.all(list.map(async ([id, inst, a]) => {
      let st = null;
      try { st = inst.stats ? await inst.stats() : null; } catch (e) { st = null; }
      let pk = 0;
      if (a) { a.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) { const v = buf[i] < 0 ? -buf[i] : buf[i]; if (v > pk) pk = v; } }
      out[id] = {
        device: inst.def ? inst.def.id : null,
        voices: st ? st.voices | 0 : null, held: st ? (st.held == null ? null : st.held | 0) : null,
        peak: pk > 1e-9 ? Math.round(200 * Math.log10(pk)) / 10 : -180, stuck: +inst.stuck || (st && st.stuck) || 0,
      };
    }));
    return out;
  }

  // ------------------------------------------------------------------------------------------- meters
  let meterN = 0;
  function readMeters() {
    if (!ctx || ctx.state !== 'running') return;
    if (++meterN % 15 === 0) updatePdc(); // (a pedal's latency can move with its params or bypass)
    for (const [id, s] of strips) { const m = s.read(); if (m) meters.tracks[id] = m; }
    const m = master.read();
    if (m) meters.master = m;
    if (ev.has('meters')) ev.emit('meters', meters);
  }

  // ------------------------------------------------------------------------------------------- render
  function songEnd() {
    const p = P();
    let end;
    try { end = projectSongEnd(p); } catch (e) { end = 0; for (const t of p.tracks || []) for (const c of t.clips || []) end = Math.max(end, c.start + c.length); }
    const bpb = bpbNow();
    return Math.max(bpb, Math.ceil(end / bpb - 1e-9) * bpb);
  }

  function render({ from = 0, to, tracks = null, sr = 48000, tail = 2, latencyMax = 0 } = {}) {
    const p = structuredClone(P());
    return renderProject(p, { from, to: to == null ? songEnd() : to, tracks, sr, tail, assets, report, latencyMax });
  }
  // what render() would hold tracks back to (tracks: ids, default the ones heard): stems pass its max as latencyMax
  function latencyOf({ tracks = null, withMix = false, sr = 48000 } = {}) {
    return probeLatency(structuredClone(P()), { tracks, withMix, sr, report });
  }

  // ------------------------------------------------------------------------------------------- the API
  const api = {
    get ctx() { return ctx; },
    start,
    play, stop: (o) => stop(o && o.live === false ? { live: false } : null), seek, toggle, silence, voices,
    get silencing() { return !!renewing; },
    get playing() { return T.playing; },
    get starting() { return !T.playing && waitReq === playReq; },
    get gen() { return T.gen || 0; },
    get beat() { return beatNow(); },
    get gridBeat() { return gridNow(); },
    get counting() { return countingNow(); },
    beatAt,
    get click() { return { ...click }; },
    set click(v) { setClick(v); },
    get metronome() { return click.on; },
    set metronome(v) { setClick({ on: v }); },
    get rate() { return rate; },
    set rate(v) { setRate(v); },
    hush: setHushed,
    get hushed() { return [...hushed]; },
    band: setBand,
    get bandLevel() { return bandNow(); },
    get recording() { return recording; },
    set recording(v) {
      if (recording === !!v) return;
      const was = clickOn();
      recording = !!v;
      trimClicks();
      if (!was) fillClicks();
      transportEvt('recording');
    },
    on: ev.on,
    get meters() { return meters; },
    liveNoteOn, liveNoteOff, liveExpr, audition,
    inputNode(trackId) {
      if (!ctx) return null;
      if (trackId === 'master') return master.input;
      if (!strips.has(trackId)) reconcile();
      const s = strips.get(trackId);
      if (s) s.watchInput(); // (the polite stop leaves a strip alone while its input is live)
      return s ? s.input : null;
    },
    instance(trackId, which = 'instrument') {
      if (trackId === 'master') return master ? master.instance(which) : null;
      const s = strips.get(trackId);
      return s ? s.instance(which) : null;
    },
    get masterTap() { return master ? master.out : null; },
    clock,
    render, songEnd, probeLatency: latencyOf,
    beatToSec: (b) => b * spbSong(),
    secToBeat: (s) => s / spbSong(),
    assets,
    settled,
    // { base, output } (the context's), and the plugins': tracks (each track's devices), comp (samples each track is
    // held back), max (the latest track), master (its inserts), total (max + master: how late the mix is). Seconds.
    get latency() { return ctx ? latencyReport() : null; },
    async dispose() {
      disposed = true;
      calm = null;
      if (ctx && T.playing) stop();
      if (stopTick) stopTick();
      for (const off of offs) { try { if (typeof off === 'function') off(); } catch (e) { /* ok */ } }
      clearInterval(meterIv);
      for (const s of strips.values()) s.dispose();
      strips.clear();
      if (master) master.dispose();
      if (clickBus) { try { clickBus.disconnect(); } catch (e) { /* ok */ } }
      if (kill) { try { kill.disconnect(); } catch (e) { /* ok */ } }
      if (ctx) { try { await ctx.close(); } catch (e) { /* ok */ } }
    },
  };
  // engine.reconcile is internal; tests may want to force one
  Object.defineProperty(api, '_reconcile', { value: reconcile });
  // (tests, and the reference A/B: what the speakers get, after the monitor soft clip and the killswitch: the mix plus
  // the metronome. It is the node wired to the destination.)
  Object.defineProperty(api, '_monitor', { get: () => (master && master.mon ? kill : null) });
  return api;
}
