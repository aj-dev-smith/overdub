// @ts-check
// Inputs: meet the musician where they are. Hum it, tap it, play it, record it, and never lose an idea.
// Builds app.input = { pitch, audio, hum, tap, midi, qwerty, capture, recorder } (docs/ARCHITECTURE.md, "Capture") plus:
//   input.on(type, fn) -> off ; input.emit(type, detail)
//     'audio' (input state) 'take' (an audio take landed) 'hum' 'beatbox' 'qwerty' 'midi' 'mode' 'capture' 'note'
//     'record' (the recorder's state) 'devices' (an input was plugged in or out)
//   input.target(kind = 'keys')    the track live notes play and record onto: the aim (recorder.targetFor), or null
//                                  when that is a new track. The keys are heard where they'll be recorded: aimed at a
//                                  new track, it is made when they start (musical typing on, a touch key, the first
//                                  MIDI note: recorder.keysTrack), never a stand-in track that the take won't land on
//   input.noteOn(src, p, v, kind) / noteOff(src, p, kind)   live notes (engine) + capture; MIDI and typing use these
//   input.expr(src, { bend?, mod?, sustain? }, kind)    the channel's expression on the target's instrument (midi.js)
//   input.mode                     null | 'qwerty' | 'tap' (which keys the home row plays); input.setMode(mode)
//   input.options                  { grid, snapKey, keepTiming } for hum and tap
// Keys: ` musical typing; H hum (start/stop; with the song when it's playing, into the take while one records, and a
// hum going when R starts joins that take; in Hum it, R itself records the hum into the song: input/recorder.js); T tap
// (F J K L play the pads while Tap is on); Esc stops a hum or leaves Tap; Space while recording stops and keeps the take;
// Shift+R puts what you just played in the song (recorder.capture); ⌘Z while a take runs takes its last finished pass
// out (recorder.undoPass), never an earlier take. R itself is the transport's (ui/transport.js).

import * as pitch from './pitch.js';
import { createAudioIn } from './audioin.js';
import { createHum } from './hum.js';
import { createTap, ROWS } from './tap.js';
import { createMidi } from './midi.js';
import { createQwerty } from './qwerty.js';
import { createCapture } from './capture.js';
import { createRecorder } from './recorder.js';

export default function (app) {
  if (app.input) return app.input; // (ui/sketch.js may have started it first)
  const fns = new Map();
  const input = {
    pitch,
    mode: null,
    options: { grid: 0.25, snapKey: true, keepTiming: false },
    on(t, fn) { if (!fns.has(t)) fns.set(t, new Set()); fns.get(t).add(fn); return () => fns.get(t).delete(fn); },
    emit(t, d) { for (const fn of fns.get(t) || []) { try { fn(d); } catch (e) { console.error('input listener', t, e); } } },
    target(kind = 'keys') {
      return input.recorder ? input.recorder.targetFor(kind) : null;
    },
    setMode(m) {
      if (m === 'qwerty') return input.qwerty.toggle(true);
      if (input.mode === 'qwerty' && m !== 'qwerty') input.qwerty.toggle(false);
      if (input.mode === 'tap' && m !== 'tap') input.tap.flush();
      input.mode = m || null;
      input.emit('mode', input.mode);
      return input.mode;
    },
  };
  const live = new Map(); // src:p -> track id (the note-off goes where the note-on went)
  input.noteOn = (src, p, v = 0.8, kind = 'midi') => {
    // (the keys aimed at a new track: the first note makes it, so it sounds where it will be recorded)
    const t = input.target() || input.recorder?.keysTrack?.() || null;
    const k = src + ':' + p;
    if (live.has(k)) input.noteOff(src, p, kind);
    if (t) { live.set(k, t.id); try { app.engine.liveNoteOn(t.id, p, v); } catch (e) { console.warn('live note', e); } }
    input.capture.noteOn(kind, p, v, { track: t ? t.id : null });
    if (t) input.recorder.noteOn(src, p, v, t.id, kind);
    input.emit('note', { src, kind, p, v, on: true, track: t ? t.id : null });
  };
  input.noteOff = (src, p, kind = 'midi') => {
    const k = src + ':' + p, tid = live.get(k);
    live.delete(k);
    if (tid) { try { app.engine.liveNoteOff(tid, p); } catch (e) { /* ok */ } }
    input.capture.noteOff(kind, p);
    input.recorder.noteOff(src, p);
    input.emit('note', { src, kind, p, on: false, track: tid || null });
  };
  input.held = () => [...live.keys()].map((k) => +k.slice(k.lastIndexOf(':') + 1));
  // the channel's expression (input/midi.js: bend in semitones, mod 0..1, sustain) on the target track's instrument
  // A control away from rest (the pedal down, a bend, the mod wheel up) stays with the track it was sent to: when the
  // target changes while it is, its return to rest (the pedal's lift, the wheel back, CC 121) goes there too, so the
  // notes it held are let go where they sound (the note-offs follow the notes: `live`).
  const away = new Map(); // track id -> { sustain?, bend?, mod? } (only the ones away from rest; rest is false or 0)
  const sendExpr = (id, x) => { try { app.engine.liveExpr?.(id, x); } catch (e) { /* ok */ } };
  input.expr = (src, x, kind = 'midi') => {
    const t = input.target();
    for (const [id, held] of away) {
      if (t && id === t.id) continue;
      const back = {};
      for (const k of Object.keys(x)) if (k in held && !x[k]) { back[k] = x[k]; delete held[k]; }
      if (Object.keys(back).length) sendExpr(id, back);
      if (!Object.keys(held).length) away.delete(id);
    }
    if (t) {
      sendExpr(t.id, x);
      const held = away.get(t.id) || {};
      for (const [k, v] of Object.entries(x)) { if (v) held[k] = v; else delete held[k]; }
      if (Object.keys(held).length) away.set(t.id, held); else away.delete(t.id);
    }
    input.emit('expr', { src, kind, ...x, track: t ? t.id : null });
  };

  app.input = input;
  input.capture = createCapture(app, input);
  input.recorder = createRecorder(app, input);
  input.audio = createAudioIn(app, input);
  input.hum = createHum(app, input);
  input.hum.options = input.options;
  input.tap = createTap(app, input);
  input.midi = createMidi(app, input);
  input.qwerty = createQwerty(app, input);
  // musical typing turned on with the keys aimed at a new track: the track is made first, so the strip names it and
  // the first key sounds there
  const qtoggle = input.qwerty.toggle;
  input.qwerty.toggle = (on = !input.qwerty.on) => { if (on && !input.qwerty.on && !input.target()) input.recorder.keysTrack(); return qtoggle(on); };

  // the tap pads on the home row, while Tap is on (and the Sketch pane shows it)
  const tapOn = () => input.mode === 'tap' && (!app.ui.visible || !app.ui.panels?.has('sketch') || app.ui.visible('sketch'));
  for (const r of ROWS) app.ui.keys.add({ key: r.key, when: tapOn, run: (e) => { if (!e.repeat) input.tap.hit(r.id, e.shiftKey ? 1 : 0.8); }, label: `Tap: ${r.label}`, group: 'Tap' });
  app.ui.keys.add({ key: 'Escape', when: tapOn, run: () => input.setMode(null), label: 'Leave Tap', group: 'Tap' });
  app.ui.keys.add({ key: 'KeyH', run: () => toggleHum(), label: 'Hum it (start / stop)', group: 'Sketch' });
  app.ui.keys.add({ key: 'KeyT', run: () => { app.ui.show?.('sketch'); input.emit('sketch:mode', 'tap'); input.setMode('tap'); }, label: 'Tap it (F J K L play the pads)', group: 'Sketch' });
  app.ui.keys.add({ key: 'Escape', when: () => input.hum.active, run: () => input.hum.stop(), label: 'Stop humming', group: 'Sketch' });
  // while a take records (or counts in), Space stops it and keeps it; Shift+R puts the last phrase in the song
  const rec = input.recorder;
  app.ui.keys.add({ key: 'Space', when: () => rec.state !== 'idle', run: () => (rec.state === 'count' ? rec.cancel() : rec.stop()), label: 'Stop and keep the take', group: 'Transport' });
  app.ui.keys.add({ key: 'KeyR', mod: 'shift', run: () => rec.capture(), label: 'Put what you just played in the song', group: 'Transport' });
  // ⌘Z while a take runs is the take's: the last completed loop pass comes out (capture keeps it). The song's own undo
  // waits for the stop, so it never takes back an earlier take while this one records over it
  app.ui.keys.add({ key: 'KeyZ', mod: 'mod', when: () => rec.state !== 'idle', run: () => undoPass(), label: 'While recording: take the last pass out', group: 'Transport' });
  function undoPass() {
    const u = rec.state === 'rec' ? rec.undoPass() : null;
    const say = (text) => { app.ui.toast?.(text, { ms: 3200 }); app.ui.announce?.(text); };
    const z = /Mac|iP(hone|ad|od)/.test(globalThis.navigator?.platform || '') ? '⌘Z' : 'Ctrl+Z';
    if (!u) return say(rec.state === 'count' ? 'Nothing recorded yet. R calls the count-in off.' : `No finished pass to take out yet. Space keeps the take; ${z} after that undoes it.`);
    const what = [u.notes ? `${u.notes} ${u.notes === 1 ? 'note' : 'notes'}` : '', u.moves ? `${u.moves} knob ${u.moves === 1 ? 'move' : 'moves'}` : ''].filter(Boolean).join(' and ');
    say(`Pass ${u.pass + 1} is out of the take${what ? ` (${what})` : ''}. Sketch keeps it.`);
  }

  // H: the hum goes where the song is. With the song playing (or With song on, which starts it) the notes land on the
  // beats they were sung against; while a take records, the hum is a source of that take.
  async function toggleHum() {
    if (input.hum.active) return input.hum.stop();
    try {
      app.ui.show?.('sketch'); input.emit('sketch:mode', 'hum');
      await input.hum.start({ withSong: !!input.options.withSong, rec: rec.state !== 'idle' });
    } catch (e) { app.ui.toast(e.message, { kind: 'bad' }); }
    return null;
  }
  input.toggleHum = toggleHum;
  return input;
}
