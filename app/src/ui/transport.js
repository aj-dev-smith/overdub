// The transport bar [ui-arrange]: one row in the top region, set like a spec sheet (design/LINER-NOTES-KIT.md): the
// title with its credit line ("played by Claude and you", signed), stop/play/record, the position as a big numeral,
// Tempo (drag, type, tap), Meter and Key as labels over values, the click (a lamp toggle, a square per beat, count-in),
// loop, undo/redo that say what they'd undo and who did it, All off, and the output meter.
//
// Keys: Space play/stop · Shift+Space play on from where it stopped · Enter/Home the marker to bar 1 · R record ·
// L loop · K the click · Shift+K the count-in (1 bar, 2 bars, off) · Shift+Esc silence. (Space during a take stops it
// and keeps it, Shift+R puts what you just played in the song: input/index.js.) K and Shift+K are Logic's and
// GarageBand's; until 2 October 2026 they were M and Shift+M (M mutes the selected track now: ui/mixer.js), and the
// first press of each in a browser says so, once (ui.keys.firstPress).
//
// Recording (docs/research/RECORDING-UX.md 3.4-3.6, 3.14). R records from the marker into the song (the recorder,
// input/recorder.js): one bar of count-in by default, the song's previous bar pre-rolling with the click; R while the
// song plays starts recording at the next bar line, the rest of this bar counted (a quantized launch). The record
// key shows the recorder's state: a ring (nothing to record onto), the ring in record ink (armed: there is a target),
// its dot lit once a beat for 80 ms (counting in), a filled lamp with REC beside the position (recording), dimmed
// while the take goes into the song (committing). During the count the position reads -1.4 ... -1.1 in record ink from
// the moment R is pressed (the one big numeral, 4 3 2 1, is the arranger's, over the lane being recorded onto). Tempo,
// meter and the loop are dimmed and locked until the take stops. Beside the key, "Onto" over a track's name says where
// R records (recorder.lands(): the recorder's target, the armed track, else the last one selected, as the arranger's
// lit R; in Hum it, the track the hum really goes onto, which is never a drum track unless it's armed), in step with
// the key's title; a click on it picks another track.
//
// The ball (the metronome you can see): one cell per beat of the bar (the bar's first wider) beside the position, and
// a square that travels from cell to cell on a shallow arc, lowest exactly on the beat, drawn from engine.beat (the
// audible beat) in frame(), so the eye can see the next beat coming (Hove et al. 2013: a moving beat is nearly as good
// to play to as a click; a flash is not). Stopped, it rests on the first cell; less motion, it steps with no arc.
// app.transport.ball is what it last drew. The click's options sit in a popover on the Click toggle's caret: on, while
// recording (on by default: a take clicks even with the click off), the count-in, the level; kept in this browser
// (localStorage overdub:click, the count-in in overdub:record). The Click lamp is lit while the click sounds, the
// count-in's included.
//
// The start marker (app.transport.marker): where Space plays from and where the playhead goes back to when the song
// stops, so a part is worked on bar by bar (Ableton's insert marker, Pro Tools' return to insertion). Stopped, the
// playhead sits on it, so the position readout shows it and R records from it. It is set by clicking a bar on the
// ruler or in a lane, or by selecting bars (a selection starts at its first bar); any seek while stopped (the Notes
// ruler) moves it too. With the loop on, Space still plays from the marker, and the song cycles once the playhead
// enters the loop (a marker before the loop plays into it and round; past its end, it plays on), as Logic's cycle
// does. Shift+Space plays on from where the song last stopped. Home, Enter and the stop key while stopped put it at
// bar 1. It is per song and per browser (localStorage overdub:marker), never in the song: it is where you are, not
// what you made. An agent's play keeps playing the range it asked for; Space stopping it comes back to the marker.
//
// The killswitch (All off, a key printed in record red; Shift+Esc, from anywhere, even a text field): engine.silence() stops
// the transport and cuts every sound in about 20 ms (notes, held notes, reverb and delay tails, previews, the click,
// whatever an agent started), and input monitoring goes off. See engine.js.
//
// The simple view (ui/workspace.js) puts parts of the bar away by their data-feature: the position and the ball
// (position), Meter, Tap, the click and the count-in (song-settings), Loop (loop), Onto (record-options), Redo (redo),
// All off and the output meter (meters). Their keys still work, and a press brings the part back (ui.keys feature).
// app.transport.openKey(anchor) opens the key's popover under anchor (More's Key row, on a phone).

import { h, css, icon, clamp, byline, authorOf, tok } from './dom.js';
import { palette, popover, menu, closePopover, fmtClock, MOD } from './arrange-kit.js';
import { lanesOf } from '../core/automation.js';
import { songEnd } from '../core/project.js';
import { newPartFor } from '../core/sounds.js';

const METERS = [[4, 4], [3, 4], [6, 8], [2, 4], [5, 4], [7, 8], [12, 8]];
const SCALE_LIST = [['major', 'Major'], ['minor', 'Minor'], ['dorian', 'Dorian'], ['mixolydian', 'Mixolydian'], ['phrygian', 'Phrygian'],
  ['lydian', 'Lydian'], ['harmonicMinor', 'Harmonic minor'], ['minorPentatonic', 'Minor pentatonic'], ['majorPentatonic', 'Major pentatonic'], ['blues', 'Blues']];
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// A new track's name and first instrument: core/sounds.js newPartFor (Melody for a hum, Keys, Drums; then "Melody 2")
function newPart(kind, project) {
  return newPartFor(['hum', 'keys', 'pads'].includes(kind) ? kind : 'keys', project);
}
const SHORT = { major: 'maj', minor: 'min', dorian: 'dor', mixolydian: 'mix', phrygian: 'phr', lydian: 'lyd', locrian: 'loc', harmonicMinor: 'h.min', melodicMinor: 'm.min', minorPentatonic: 'min pent', majorPentatonic: 'maj pent', blues: 'blues', chromatic: 'chrom' };
// the output meter: what red means, and how long "Clipping 2.4 dB" holds after the mix was last that far over
const METER_TITLE = 'The mix, before the master’s safety clip: peak (upper bar, held 1.5 s), RMS (lower bar) and the held peak in dBFS. Red is clipping: the mix went over 0 dBFS by the amount shown, and the safety clip is shaving that off its peaks.';
const OVER_MS = 3000;

export default function (app) {
  css('transport', CSS);
  const { ui, store, engine } = app;
  const toggleLoop = () => { const l = store.get().loop; store.dispatch({ type: 'project.set', patch: { loop: { on: !l.on } } }, { by: 'you', label: l.on ? 'loop off' : 'loop on' }); };
  const marker = startMarker(app);
  const fail = (e) => ui.toast('Could not play: ' + e.message, { kind: 'bad' });
  const playStop = () => Promise.resolve(marker.playStop()).catch(fail);
  const playOn = () => Promise.resolve(marker.playOn()).catch(fail);
  ui.keys.add({ key: 'Space', run: playStop, label: 'Play from the marker / stop (back to the marker)', group: 'Transport' });
  ui.keys.add({ key: 'Space', mod: 'shift', run: playOn, label: 'Play on from where it stopped', group: 'Transport' });
  const home = () => marker.set(0, { announce: true });
  ui.keys.add({ key: 'Enter', run: home, label: 'The marker back to bar 1', group: 'Transport' });
  ui.keys.add({ key: 'Home', run: home, label: 'The marker back to bar 1', group: 'Transport' });
  const loopKey = () => { if (lockedSay(app, 'The loop')) return; toggleLoop(); };
  ui.keys.add({ key: 'KeyL', run: loopKey, label: 'Loop on/off', group: 'Transport', feature: 'loop' });
  const click = clickSettings(app);
  // the first press of each in a browser: what it did, and that the key moved (once; after that the announcement alone)
  const clickKey = () => {
    const on = !engine.metronome, first = ui.keys.firstPress?.('KeyK');
    click.set({ on }, { announce: !first });
    if (first) ui.toast(`Click ${on ? 'on' : 'off'}. \`K\` is the click now, as in Logic and GarageBand; \`M\` mutes.`, { ms: 6000 });
  };
  const countKey = () => {
    const first = ui.keys.firstPress?.('shift+KeyK');
    const n = click.cycleCountIn({ announce: !first });
    if (first && n != null) ui.toast(`Count-in: ${n ? `${n} bar${n > 1 ? 's' : ''}` : 'off'}. \`⇧K\` steps it now, beside the click on \`K\`.`, { ms: 6000 });
  };
  ui.keys.add({ key: 'KeyK', run: clickKey, label: 'The click (metronome) on/off', group: 'Transport', feature: 'song-settings' });
  ui.keys.add({ key: 'KeyK', mod: 'shift', run: countKey, label: 'Count-in: 1 bar, 2 bars, off', group: 'Transport', feature: 'record-options' });
  ui.keys.add({ key: 'KeyR', run: () => record(app), label: 'Record into the song from the marker (again: punch out)', group: 'Transport' });
  const silence = () => silenceAll(app);
  ui.keys.add({ key: 'Escape', mod: 'shift', global: true, run: silence, label: 'Silence everything (the killswitch)', group: 'Transport', feature: 'meters' });
  app.transport = { toggleLoop, record: () => record(app), silence, marker, playStop, playOn, home, click, ball: null, over: 0, countdown: () => countdown(app), locked: () => takeRunning(app) };
  // (the recorder loads after the transport: input/index.js)
  let heard = false;
  const hear = () => { if (heard || !app.input?.recorder) return; heard = true; recordAnnounce(app); ui.emit('transport-ui'); };
  ui.on('ready', hear);
  keysOverlay(app);
  app.ui.panel({ id: 'transport', region: 'top', title: 'Transport', mount: (el) => mountTransport(el, app) });
}

/* ---------------------------------------------------------------- "?" : every key, grouped */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY_NAMES = { Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Tab: 'Tab', Home: 'Home', End: 'End',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Slash: '/', Backquote: '`', Comma: ',', Period: '.', Minus: '−', Equal: '+',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', PageUp: 'PgUp', PageDown: 'PgDn' };
const GROUP_ORDER = ['Transport', 'Track', 'Edit', 'Song', 'Arrange', 'Notes', 'Beat', 'Sketch', 'Tap', 'Play', 'Input', 'Devices', 'Mixer', 'Browser', 'Agent', 'View'];
export function keyCaps(k) {
  const mods = (k.mod || '').split('+').filter(Boolean).map((m) => (m === 'mod' ? (IS_MAC ? '⌘' : 'Ctrl') : m === 'shift' ? '⇧' : m === 'alt' ? (IS_MAC ? '⌥' : 'Alt') : m));
  if (k.key === 'Slash' && k.mod === 'shift') return ['?'];
  const name = KEY_NAMES[k.key] || k.key.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
  return [...mods, name];
}
function keysOverlay(app) {
  const { ui } = app;
  let box = null, prevFocus = null;
  const close = () => { if (!box) return; const b = box; box = null; b.classList.add('out'); setTimeout(() => b.remove(), 160); prevFocus?.focus?.(); };
  function open() {
    if (box) return close();
    const groups = new Map();
    const seen = new Set();
    for (const k of ui.keys.list()) {
      if (!k.label || k.hidden) continue;
      const caps = keyCaps(k);
      const sig = caps.join(' ') + '|' + k.label;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const g = k.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ caps, label: k.label, mode: !!k.when });
    }
    const rank = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? 50 : i; };
    const cols = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([g, list]) => {
      // one row per action: keys that do the same thing share it (Enter / Home)
      const rows = new Map();
      for (const x of list) { const r = rows.get(x.label) || { label: x.label, keys: [], mode: x.mode }; r.keys.push(x.caps); rows.set(x.label, r); }
      return h('section.tpk-g', h('h3', g), h('dl', [...rows.values()].map((r) => [
        r.keys.length > 3
          // a whole row of keys for one action (musical typing): a keyboard strip, then the action
          ? [h('dt.tpk-strip', r.keys.map((caps) => caps.map((c) => h('kbd', c))).flat()), h('dd.tpk-strip-l', r.label)]
          : [h('dt', r.keys.map((caps, i) => [i ? h('span.tpk-or', 'or') : null, ...caps.map((c) => h('kbd', c))]).flat()), h('dd', r.label)]]).flat()));
    });
    prevFocus = document.activeElement;
    // single-letter keys (R records, H opens the mic) can be switched off, for speech input and anyone who'd rather not
    const single = h('input#tpk-single', { type: 'checkbox', checked: ui.keys.single?.() !== false, onchange: (e) => ui.keys.single?.(e.target.checked) });
    box = h('div.tpk', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tpk-title', onclick: (e) => { if (e.target === box) close(); } },
      h('div.tpk-card', { tabindex: -1 },
        h('header.tpk-head', h('h2#tpk-title', 'Every key'), h('p', 'Most of the studio is a key away. Keys only fire when you are not typing in a field.'),
          ui.keys.single ? h('label.tpk-single', { for: 'tpk-single' }, single, h('span', 'Single-key shortcuts', h('small', `R, H, T, L, M and the rest with no ${IS_MAC ? '⌘, ⇧ or ⌥' : 'Ctrl, Shift or Alt'}. Off, they do nothing, so dictation or a stray key can’t start a take or open the mic. Keys inside the panel you’re working in still work.`))) : null,
          h('button.tpk-x', { title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }, icon('x', { size: 16 }))),
        h('div.tpk-cols', cols)));
    // a modal: Tab and Shift+Tab go round inside it
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...box.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !box.contains(a) || a === box.querySelector('.tpk-card'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !box.contains(a))) { e.preventDefault(); first.focus(); }
    });
    document.body.append(box);
    box.querySelector('.tpk-card').focus();
  }
  ui.keys.add({ key: 'Slash', mod: 'shift', run: open, label: 'Show every key', group: 'View' });
  ui.keys.add({ key: 'Escape', when: () => !!box, run: close, label: 'Close', group: 'View', hidden: true, global: true });
  app.keysOverlay = { open: () => { if (!box) open(); }, close, get isOpen() { return !!box; } };
}

// The killswitch: every panic path in the studio comes here, and here goes to engine.silence().
function silenceAll(app) {
  const { engine, ui } = app;
  try { if (app.input?.audio?.state?.monitoring) app.input.audio.monitor(false); } catch (e) { /* ok */ }
  ui.emit('silence');
  if (!engine?.silence) { try { engine?.stop?.(); } catch (e) { /* ok */ } return Promise.resolve(); }
  return Promise.resolve(engine.silence()).catch((e) => ui.toast('Could not silence: ' + e.message, { kind: 'bad' }));
}

// A take is running (counting in, recording, or going into the song): time and the loop wait for it.
function takeRunning(app) { const r = app.input?.recorder; return !!r && r.state !== 'idle'; }
// say why a control didn't move, once per take: "Tempo changes after the take."
let lockedSaid = null;
function lockedSay(app, what) {
  if (!takeRunning(app)) return false;
  const r = app.input.recorder, key = what + '|' + (r.live?.()?.take || '');
  if (lockedSaid !== key) { lockedSaid = key; app.ui.toast(`${what} changes after the take. R or Space stops it.`, { kind: 'info', ms: 2400 }); } else app.ui.announce?.(`${what} changes after the take.`);
  return true;
}

// The count-in as it is heard: { n (the numeral: beats left in this bar of the count, 4 3 2 1), bar (bars left),
// cell (beats left, a whole number), frac (0..1 through the beat), label ('-1.4'), until } or null.
function countdown(app) {
  const { engine, store } = app;
  const k = engine.counting;
  const r = app.input?.recorder;
  if (!k && r?.state !== 'count') return null;
  const m = store.get().meter, cells = Math.max(1, m[0]), cellLen = 4 / m[1];
  const b = +engine.beat || 0;
  let left;
  if (k && Number.isFinite(k.until)) left = k.until - b;
  else if (!engine.playing) left = Math.max(1, r?.countIn || 1) * cells * cellLen;   // R pressed, the transport starting: the whole count
  else { const lv = r?.live?.(); left = lv?.counting ? lv.counting.beats : null; }
  if (left == null || !(left > 1e-6)) return null;
  const c = left / cellLen;                         // beats (cells) left
  const cell = Math.ceil(c - 1e-6);
  const bar = Math.ceil(cell / cells);
  const n = cell - (bar - 1) * cells;
  return { n, bar, cell, frac: Math.min(1, Math.max(0, cell - c)), label: `−${bar}.${n}`, until: k?.until ?? r?.live?.()?.from ?? null };
}

// The click's options, kept in this browser: { on, whileRecording, level } on the engine, the count-in on the recorder,
// and `takes`: the click while a take records, even with the click off (on unless turned off). A take that starts with
// the click off borrows it for the take (engine.click { on, whileRecording }: it sounds only while recording) and gives
// it back when the take ends; anything that sets the click meanwhile (K, Sketch, an agent) keeps what it set.
const CLICK_KEY = 'overdub:click';
function clickSettings(app) {
  const { engine, ui } = app;
  const has = () => !!engine && 'click' in engine;
  let takes = true, borrowed = null, self = false;
  const quiet = (fn) => { self = true; try { fn(); } finally { self = false; } };
  try {
    const v = JSON.parse(localStorage.getItem(CLICK_KEY) || 'null');
    if (v && typeof v === 'object') {
      if (typeof v.takes === 'boolean') takes = v.takes;
      const o = {};
      if (typeof v.on === 'boolean') o.on = v.on;
      if (typeof v.whileRecording === 'boolean') o.whileRecording = v.whileRecording;
      // (the old "only while recording": the click off, and on for takes)
      if (o.on && o.whileRecording && typeof v.takes !== 'boolean') { o.on = false; o.whileRecording = false; takes = true; }
      if (Number.isFinite(+v.level) && v.level !== null) o.level = Math.max(-24, Math.min(6, +v.level));
      if (has()) quiet(() => { engine.click = o; });
    }
  } catch (e) { /* storage blocked: the defaults */ }
  // what the person set (a borrowed click reads as off)
  const get = () => {
    const c = has() ? engine.click : { on: !!engine.metronome, whileRecording: false, level: 0 };
    return { ...c, ...(borrowed ? { on: false, whileRecording: borrowed.wr } : {}), takes, countIn: app.input?.recorder ? app.input.recorder.countIn : null };
  };
  const save = () => { try { const c = get(); localStorage.setItem(CLICK_KEY, JSON.stringify({ on: !!c.on, whileRecording: !!c.whileRecording, takes, level: Math.round((+c.level || 0) * 10) / 10 })); } catch (e) { /* ok */ } };
  // every change, from here or anywhere (Sketch, an agent), is kept; one made during a borrowed take is theirs to keep
  engine.on?.('transport', (e) => { if (e?.why !== 'metronome' || self) return; borrowed = null; save(); });
  function set(v, { announce = false } = {}) {
    if ('takes' in v) takes = !!v.takes;
    const eng = { ...v }; delete eng.takes;
    if ('on' in eng || 'whileRecording' in eng) borrowed = null;
    if (Object.keys(eng).length) { if (has()) quiet(() => { engine.click = eng; }); else if ('on' in eng) engine.metronome = !!eng.on; }
    save();
    ui.emit('transport-ui');
    if (announce && 'on' in v) ui.announce?.(`Click ${v.on ? 'on' : 'off'}${v.on && get().whileRecording ? ', only while recording' : !v.on && takes ? ', still on while a take records' : ''}`);
    else if (announce && 'takes' in v) ui.announce?.(takes ? 'The click sounds while a take records' : 'No click while a take records, unless the click is on');
    return get();
  }
  // a take starting (counting in or recording) with the click off: it clicks for the take; the take over, it goes back
  function onTake(st) {
    if (!has()) return;
    if ((st === 'count' || st === 'rec') && !borrowed && takes && !engine.click.on) {
      const wr = !!engine.click.whileRecording;
      quiet(() => { engine.click = { on: true, whileRecording: true }; });
      borrowed = { wr };
      ui.emit('transport-ui');
    } else if (st === 'idle' && borrowed) {
      const wr = borrowed.wr;
      borrowed = null;
      quiet(() => { engine.click = { on: false, whileRecording: wr }; });
      ui.emit('transport-ui');
    }
  }
  let hooked = false;
  const hook = () => { const r = app.input?.recorder; if (hooked || !r?.on) return; hooked = true; r.on('state', (e) => onTake(e?.state)); };
  hook();
  ui.on('ready', hook);
  function setCountIn(n, { announce = false } = {}) {
    const r = app.input?.recorder;
    if (!r?.setCountIn) return null;
    const v = r.setCountIn(n);
    if (announce) ui.announce?.(v ? `Count-in: ${v} bar${v > 1 ? 's' : ''}` : 'No count-in');
    ui.emit('transport-ui');
    return v;
  }
  // Shift+K and the count-in key: 1 bar, 2 bars, off, 1 bar
  const cycleCountIn = (o) => { const r = app.input?.recorder; if (!r) return null; const n = r.countIn || 0; return setCountIn(n === 1 ? 2 : n === 2 ? 0 : 1, o); };
  return { get, set, setCountIn, cycleCountIn, get borrowed() { return !!borrowed; } };
}

// What a screen reader hears of a take: the count-in starting, recording starting, the take going in.
function recordAnnounce(app) {
  const r = app.input?.recorder, { ui, store } = app;
  if (!r?.on) return;
  let was = 'idle';
  r.on('state', (e) => {
    const s = e?.state;
    if (!s || s === was) return;
    const prev = was; was = s;
    const lv = r.live?.() || {};
    const t = store.track(lv.track || r.target);
    const where = Number.isFinite(lv.from) ? app.transport?.marker?.label?.(lv.from) || '' : '';
    const on = t ? ` on ${t.name}` : '';
    const keeps = lv.keeps ? ` ${lv.keeps}` : '';   // (a sound on trial there, kept first: INSTRUMENTS-UX 1.3)
    if (s === 'count' && app.engine?.playing && !app.engine.counting) ui.announce?.(`Counting in. Recording${on} from ${where}.${keeps}`);   // R while playing: the rest of this bar
    else if (s === 'count') {
      const n = r.countIn || 0;
      ui.announce?.(`Counting in, ${n || 1} bar${n > 1 ? 's' : ''}. Recording${on} from ${where}.${keeps}`);
    } else if (s === 'rec' && prev === 'count') ui.announce?.(`Recording${on}.`);
    else if (s === 'rec') ui.announce?.(`Recording${on} from ${where}.`);
  });
  r.on('commit', (res) => {
    if (!res) return;
    if (res.empty) { ui.announce?.('Nothing played in that take.'); return; }
    if (res.ok && res.summary) ui.announce?.(`Take kept. ${res.summary}`);
  });
}

// The start marker (see the header). One per song, kept in this browser. set(beat) moves it (stopped, the playhead
// with it); playStop() is Space; playOn() is Shift+Space; from() is where Space would play from now.
const MARKER_KEY = 'overdub:marker';
function startMarker(app) {
  const { ui, store, engine } = app;
  let beat = 0, song = null, lastStop = null, saveT = 0, lastRange = null, offRec = null;
  const listeners = new Set();
  const stored = () => { try { const m = JSON.parse(localStorage.getItem(MARKER_KEY) || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch (e) { return {}; } };
  const save = () => {
    clearTimeout(saveT);
    const id = song, b = beat;
    saveT = setTimeout(() => {
      if (!id) return;
      try {
        const m = stored();
        delete m[id];
        if (b > 0) m[id] = b;
        const ks = Object.keys(m);   // the newest 24 songs
        for (const k of ks.slice(0, Math.max(0, ks.length - 24))) delete m[k];
        localStorage.setItem(MARKER_KEY, JSON.stringify(m));
      } catch (e) { /* storage blocked: it just won't remember */ }
    }, 200);
  };
  const meterOf = () => store.get().meter;
  const bpbOf = () => { const m = meterOf(); return Math.max(1, m[0] * (4 / m[1])); };
  const emit = () => { ui.state.marker = beat; for (const fn of listeners) { try { fn(beat); } catch (e) { console.error('marker listener', e); } } ui.emit('marker', beat); };
  const park = () => { if (!engine.playing && Math.abs((+engine.beat || 0) - beat) > 1e-6) { try { engine.seek(beat); } catch (e) { /* no audio yet */ } } };
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  function set(b, { announce = false, seek = true } = {}) {
    const v = Math.max(0, Number(b) || 0);
    const moved = !near(v, beat);
    beat = v;
    if (moved) { save(); emit(); }
    if (seek) park();
    if (announce) ui.announce?.(`Plays from ${label()}`);
    return beat;
  }
  // "bar 4", or "bar 4, beat 3" off the bar line
  function label(b = beat) {
    const bpb = bpbOf(), bar = Math.floor(b / bpb + 1e-9) + 1, inBar = b - (bar - 1) * bpb;
    if (inBar < 1e-6) return `bar ${bar}`;
    const bt = Math.floor(inBar + 1e-9) + 1, off = inBar - (bt - 1);
    return `bar ${bar}, beat ${bt}${off > 1e-6 ? `.${Math.floor(off * 4 + 1e-9) + 1}` : ''}`;
  }
  // where Space plays from: the marker, loop or no loop (the engine cycles once the playhead reaches the loop's end)
  function from() { return beat; }
  // (a play still waiting to start, behind the killswitch's or the polite stop's renew, counts as playing: Space stops it)
  function playStop() {
    if (engine.playing || engine.starting) { engine.stop(); return Promise.resolve(); }   // the stop brings the playhead back (below)
    return engine.play(from());
  }
  function playOn() {
    if (engine.playing || engine.starting) { engine.stop(); return Promise.resolve(); }
    return engine.play(lastStop ?? from());
  }
  // a song loaded (a reload, Open, a demo): its own marker, or bar 1
  function restore() {
    const id = store.get().id || null;
    if (id === song) return;
    song = id;
    const b = +stored()[id];
    beat = Number.isFinite(b) && b >= 0 ? b : 0;
    lastStop = null;
    emit();
    park();
  }
  // Every stop (Space, the stop key, the killswitch, a take ending, an agent's stop) comes back to the marker. While a
  // take is closing, after it has: the recorder reads a seek as a punch-out.
  function back() {
    const rec = app.input?.recorder;
    if (rec && rec.state !== 'idle' && rec.on) {
      offRec?.();
      const t = setTimeout(() => { offRec?.(); offRec = null; park(); }, 4000);
      const off = rec.on('state', (e) => { if (e?.state === 'idle') { clearTimeout(t); offRec?.(); offRec = null; setTimeout(park, 0); } });
      offRec = typeof off === 'function' ? off : null;
      return;
    }
    park();
  }
  engine.on?.('transport', (e) => {
    if (!e || e.playing) return;
    if (e.why === 'stop') { lastStop = Number.isFinite(e.beat) ? Math.max(0, e.beat) : null; queueMicrotask(back); }
    // a seek while stopped (the Notes ruler, a test, an agent) moves the marker: stopped, the playhead is the marker
    else if (e.why === 'seek' && Number.isFinite(e.beat) && !near(e.beat, beat)) set(e.beat, { seek: false });
  });
  store.on?.('change', (e) => { if (e?.kind === 'load') restore(); });
  // selecting bars (dragging over the lanes, a section, Select its bars) puts the marker at the first one
  ui.on('select', (s) => {
    const r = s?.range;
    if (r === lastRange) return;
    lastRange = r;
    if (r && Number.isFinite(r.from)) set(r.from);
  });
  restore();
  return {
    get beat() { return beat; },
    get lastStop() { return lastStop; },
    set, from, label, playStop, playOn,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

function recording(app) {
  if (app.input?.recorder) return app.input.recorder.state !== 'idle';
  const a = app.input?.audio;
  if (!a) return false;
  if (typeof a.isRecording === 'function') return !!a.isRecording();
  return !!(a.recording ?? a.state?.recording);
}

function record(app) {
  const { ui, store } = app;
  // one Record into the song (input/recorder.js): R records onto the armed or selected track, R again punches out
  // stopped, a take starts at the start marker (the recorder reads the playhead; the loop is still its punch range)
  if (app.input?.recorder && app.input.recorder.state === 'idle' && !app.engine?.playing) app.transport?.marker?.set(app.transport.marker.beat);
  if (app.input?.recorder?.state === 'rec') app.transport && (app.transport.punching = true);   // R again: the take goes in, the song plays on
  if (app.input?.recorder) { Promise.resolve(app.input.recorder.toggle()).catch((e) => ui.toast('Could not record: ' + e.message, { kind: 'bad' })); ui.emit('transport-ui'); return; }
  const armed = store.get().tracks.filter((t) => t.arm);
  const rec = app.input?.audio?.toggleRecord;
  if (!armed.length && !recording(app)) {
    const sel = store.track(ui.state.selection.track);
    const cand = sel || store.get().tracks.find((t) => t.kind === 'audio') || store.get().tracks[0];
    ui.toast('Nothing is armed. Arm a track (its ● button) to record onto it.', {
      kind: 'warn', ms: 5000,
      action: cand ? { label: `Arm ${cand.name}`, run: () => store.dispatch({ type: 'track.set', track: cand.id, patch: { arm: true } }, { by: 'you', label: `arm ${cand.name}` }) } : null,
    });
    return;
  }
  if (typeof rec !== 'function') { ui.toast('Recording arrives with the input module. Your idea is safe: Sketch keeps everything you play.', { kind: 'info' }); return; }
  try { rec.call(app.input.audio); } catch (e) { ui.toast('Could not record: ' + e.message, { kind: 'bad' }); }
  ui.emit('transport-ui');
}

function mountTransport(el, app) {
  const { store, engine, ui } = app;
  const p = () => store.get();

  /* ------------------------------------------------ title, and who played on it */
  const title = h('div.tp-title', { tabindex: 0, role: 'textbox', 'aria-label': 'Song title', title: 'The song’s name (click to rename)', spellcheck: false });
  title.addEventListener('focus', () => { if (title.contentEditable !== 'true') { title.contentEditable = 'true'; selectAll(title); } });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
    if (e.key === 'Escape') { title.textContent = p().title; title.blur(); }
    e.stopPropagation();
  });
  title.addEventListener('blur', () => {
    title.contentEditable = 'false';
    requestAnimationFrame(() => fitTitle());
    const v = title.textContent.trim().slice(0, 80);
    if (v && v !== p().title) store.dispatch({ type: 'project.set', patch: { title: v } }, { by: 'you', label: `rename song to "${v}"` });
    else title.textContent = p().title;
  });
  // the credit line under the title: "played by you and Claude", or "featuring Claude" when the house played most of
  // it (a demo); signed in each author's ink (the house is unsigned)
  const credits = h('div.tp-credits');

  /* ------------------------------------------------ buttons */
  const btn = (ic, label, run, cls = '') => h('button.tp-btn' + cls, { title: label, 'aria-label': label, onclick: run }, icon(ic, { size: 16 }));
  const mk = app.transport.marker;
  // the first key goes back: playing, it stops at the marker; stopped, it takes the marker to bar 1. It draws a bar and a
  // triangle, not a square, so the one square on screen is play's while the song plays (FRESH-EYES-5: two stop squares;
  // design/LINER-NOTES-KIT.md records it)
  const stopB = btn('back', 'Back: stop and go to the marker (Space). Stopped: the marker to bar 1 (Home)', () => { if (engine.playing || engine.starting) engine.stop(); else app.transport.home(); });
  const playB = h('button.tp-btn.tp-play', { title: 'Play from the marker (Space)', 'aria-label': 'Play (Space)', onclick: () => app.transport.playStop() },
    h('span.ico-play', icon('play', { size: 16 })), h('span.ico-stop', icon('stop', { size: 16 })));
  // the record key: a round lamp (the one round thing: it is a lamp), its state drawn in frame() (see the header)
  const recB = h('button.tp-btn.tp-rec', { type: 'button', title: 'Record into the song from the marker (R)', 'aria-label': 'Record (R)', 'aria-pressed': 'false', onclick: () => record(app) },
    recLamp());
  // where R records, beside it, as a spec-sheet label over its value ("Onto" over "Audio"): the recorder's target (the
  // armed track, else the one last selected: clearing the selection doesn't move it), the same one the arranger's lit
  // R and the key's title name. A click picks another track: selected, and any arm set on another gives way, as a
  // click on its header does
  const recToV = h('span.tp-val.tp-recto-v', '—');
  const recTo = h('button.tp-spec.tp-recto', { type: 'button', 'aria-haspopup': 'menu', dataset: { feature: 'record-options' }, onclick: () => pickRecTrack() }, h('small.tp-lab', 'Onto'), recToV);
  // The kind of take R would make now (Hum it: a hum; Tap it: the pads; else the keys), whose aim Onto shows
  const recKind = () => { const inp = app.input, r = inp?.recorder; return r?.humming?.() ? 'hum' : inp?.sketchMode === 'tap' || inp?.mode === 'tap' ? 'pads' : 'keys'; };
  const fullView = () => (ui.workspace?.view?.() || 'full') !== 'simple';
  function pickRecTrack() {
    if (takeRunning(app)) { lockedSay(app, 'The track a take records onto'); return; }
    // (where the take lands: in Hum it, the tracks a hum goes onto, the drums left out unless armed: recorder.lands, onto)
    const r = app.input?.recorder, hum = !!r?.humming?.(), kind = recKind();
    const cur = (r?.lands ? r.lands()?.id : r?.target) || null, ts = r?.onto ? r.onto() : p().tracks.filter((t) => t.kind === 'audio' || t.kind === 'instrument');
    const part = newPart(kind, p(), app);
    // "A new track" first (the full studio's lit R agrees: every arm goes, then the aim), then the tracks: a pick is
    // selected and the arms elsewhere give way, as a click on its header does, then aimed
    const toNew = () => {
      const armed = p().tracks.filter((x) => x.arm && x.kind === 'instrument');
      if (fullView() && armed.length) store.dispatch(armed.map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } })), { by: 'you', label: 'record onto a new track' });
      r?.setAim?.(kind, 'new');
      ui.announce?.(`R records onto a new track (${part.name})`);
      sync();
    };
    menu(recTo, [{ head: hum ? 'R records your hum onto' : 'R records onto' }, { label: 'A new track', sub: cur ? '' : '●', run: toNew }, ...ts.map((t) => ({ label: t.name, sub: t.id === cur ? '●' : '', run: () => {
      ui.select({ track: t.id, clip: null, notes: [] });
      const others = p().tracks.filter((x) => x.arm && x.id !== t.id);
      if (others.length) store.dispatch(others.map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } })), { by: 'you', label: `arm ${t.name}`, coalesce: 'arm-select' });
      if (t.kind === 'instrument') r?.setAim?.(kind, t.id);
      ui.announce?.(`R records onto ${t.name}`);
      sync();
    } }))]);
  }
  // the killswitch, as a key printed in record red: "All off"
  const killB = h('button.btn.btn-rec.tp-kill', { type: 'button', title: 'Stop, and cut every note, tail, preview and take, from anywhere (Shift+Esc)', 'aria-label': 'All off: silence everything',
    onclick: () => { flash(killB); app.transport.silence(); } },
  h('i.tp-kill-sq', { 'aria-hidden': 'true' }), h('span', 'All off'));
  // toggles are square lamps beside a word
  const tog = (label, title, run, cls) => h('button.tog.tp-tog' + cls, { type: 'button', title, 'aria-pressed': 'false', onclick: run }, label);
  const loopB = tog('Loop', 'Loop (L)', () => { if (!lockedSay(app, 'The loop')) app.transport.toggleLoop(); }, '.tp-loop');
  loopB.dataset.feature = 'loop';
  const ck = app.transport.click;
  const metB = tog('Click', 'The click: a metronome to play along to (K)', () => { ck.set({ on: !engine.metronome }); sync(); }, '.tp-met');
  // the click's options: a caret beside the toggle opens them
  const metMore = h('button.tp-caret', { type: 'button', title: 'The click’s options: while recording, count-in, level', 'aria-label': 'Click options', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => openClick() }, icon('down', { size: 12 }));
  // the ball: a cell per beat of the bar (the bar's first wider) and the square that travels between them
  const beats = h('span.tp-beats', { 'aria-hidden': 'true' });
  const dot = h('b.tp-ball-dot');
  const ball = h('span.tp-ball', { 'aria-hidden': 'true', title: 'The beat: the square lands on each beat as you hear it' }, beats, dot);
  // the take's mark beside the position: REC, then "keeping" while it goes in (the count is in the position itself)
  const recLab = h('span.tp-reclab.mono');
  const takeMark = h('span.tp-take', { 'aria-hidden': 'true' }, recLab);
  // count-in before a take (input/recorder.js): 1 bar, 2 bars or none; a click (or Shift+K) steps through them
  const countV = h('span.tp-val', '1 bar');
  // (More files the count-in under Recording options, so it comes back with them)
  const countB = h('button.tp-spec.tp-count', { type: 'button', dataset: { feature: 'record-options' }, title: 'Count-in: clicks (and the bar before, playing) before a take starts recording. Click or Shift+K for 1 bar, 2 bars or none.', onclick: () => { ck.cycleCountIn({ announce: true }); sync(); } }, h('small.tp-lab', 'Count-in'), countV);
  function openClick() {
    const paint = () => {
      const c = ck.get();
      const row = (label, on, run, title) => h('button.tog.tp-pop-tog' + (on ? '.on' : ''), { type: 'button', 'aria-pressed': String(!!on), title, onclick: () => { run(); paint(); sync(); } }, label);
      const ci = c.countIn;
      const counts = ci == null ? null : h('div.tp-pop-row', { role: 'radiogroup', 'aria-label': 'Count-in' },
        h('span.tp-pop-lab', 'Count-in'),
        ...[[1, '1 bar'], [2, '2 bars'], [0, 'Off']].map(([n, l]) => h('button.tp-pop-opt' + (ci === n ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(ci === n), onclick: () => { ck.setCountIn(n, { announce: true }); paint(); sync(); } }, l)));
      const lvl = h('input.tp-pop-level', { type: 'range', min: -24, max: 6, step: 1, value: String(Math.round(+c.level || 0)), 'aria-label': 'Click level in dB',
        oninput: (e) => { ck.set({ level: +e.target.value }); lvV.textContent = fmtDb(+e.target.value); } });
      const lvV = h('span.tp-pop-v.mono', fmtDb(+c.level || 0));
      // a redraw keeps keyboard focus on the control that was pressed
      const fi = [...body.querySelectorAll('button, input')].indexOf(document.activeElement);
      body.replaceChildren(
        h('div.tp-pop-head', 'The click'),
        row('Click', c.on, () => ck.set({ on: !ck.get().on }, { announce: true }), 'The click on or off (K)'),
        row('While recording', c.takes, () => ck.set({ takes: !ck.get().takes }, { announce: true }), 'The click sounds while a take records, even with the click off (on unless you turn it off)'),
        counts,
        h('label.tp-pop-row', h('span.tp-pop-lab', 'Level'), lvl, lvV),
        h('p.tp-pop-note', 'The count-in always clicks, even with the click off. The click never goes into the mix or a render.'));
      if (fi >= 0) body.querySelectorAll('button, input')[fi]?.focus({ preventScroll: true });
    };
    const body = h('div.tp-pop-body');
    paint();
    metMore.setAttribute('aria-expanded', 'true');
    popover(metMore, [body], { cls: 'tp-clickpop', label: 'The click', align: 'right', onClose: () => metMore.setAttribute('aria-expanded', 'false') });
  }

  /* ------------------------------------------------ position */
  const posBar = h('span.tp-pos-bar.num', '1.1.1');
  const posTime = h('span.tp-pos-time', '0:00.0');
  // stopped, the position is the start marker; beside the clock, where Space plays from (and stop comes back to)
  const posFrom = h('span.tp-pos-unit', 'from bar 1');
  const pos = h('button.tp-pos', { title: 'Position: bar, beat, sixteenth, and the time. Space plays from the marker; click to put it at bar 1 (Home).', onclick: () => app.transport.home() }, posBar, h('span.tp-pos-side.mono', posTime, posFrom));
  // bar.beat.sixteenth (a phone shows bar.beat: the sixteenth is in its own span). The numeral has a fixed width, set
  // for the song's bars (two digits at least, three for a song past bar 99), so nothing beside it moves as the song
  // plays past bar 9: the width only grows, and only if the playhead runs on past bar 99 into silence
  const setPos = (label) => {
    const parts = label.split('.');
    posBar.replaceChildren(...parts.flatMap((x, i) => (!i ? [x] : i === 2 ? [h('span.tp-pos-six', h('em', '.'), x)] : [h('em', '.'), x])));
    const n = parts[0].replace(/\D/g, '').length;
    if (n > posDigits) setDigits(n);
  };
  let posDigits = 0;
  // (tabular figures are 1ch each; the two dots are about .45em)
  function setDigits(n) { posDigits = n; posBar.style.setProperty('--tp-bar-digits', String(n)); posBar.dataset.digits = String(n); }
  function fitDigits() {
    const pr = p(), bpb = Math.max(1, pr.meter[0] * (4 / pr.meter[1]));
    const last = Math.max(songEnd(pr), +pr.loop?.end || 0, mk.beat + 1) / bpb;
    const n = Math.max(2, String(Math.ceil(last) + 1).length);
    if (n > posDigits || (n < posDigits && !engine.playing)) setDigits(n);
  }

  /* ------------------------------------------------ tempo */
  const tempoNum = h('span.tp-tempo-num.num', '120');
  const tempo = h('div.tp-tempo.tp-spec', { tabindex: 0, role: 'spinbutton', 'aria-label': 'Tempo', 'aria-valuemin': 20, 'aria-valuemax': 400, title: 'Tempo in BPM: drag up or down (Shift: fine), click to type, scroll to nudge' }, h('small.tp-lab', { 'aria-hidden': 'true' }, 'Tempo'), tempoNum);
  let tdrag = null;
  tempo.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || tempo.querySelector('input')) return;
    if (lockedSay(app, 'Tempo')) { e.preventDefault(); return; }
    tdrag = { y: e.clientY, v: p().tempo, moved: false };
    tempo.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  tempo.addEventListener('pointermove', (e) => {
    if (!tdrag) return;
    const dy = tdrag.y - e.clientY;
    if (Math.abs(dy) > 3) tdrag.moved = true;
    if (!tdrag.moved) return;
    const v = clamp(Math.round((tdrag.v + dy * (e.shiftKey ? 0.05 : 0.5)) * 10) / 10, 20, 400);
    if (v !== p().tempo) store.dispatch({ type: 'project.set', patch: { tempo: e.shiftKey ? v : Math.round(v) } }, { by: 'you', label: 'tempo', coalesce: 'tempo' });
  });
  tempo.addEventListener('pointerup', () => { if (tdrag && !tdrag.moved) editTempo(); tdrag = null; });
  tempo.addEventListener('dblclick', editTempo);
  tempo.addEventListener('wheel', (e) => { e.preventDefault(); if (takeRunning(app)) return; const v = clamp(Math.round(p().tempo) + (e.deltaY < 0 ? 1 : -1), 20, 400); store.dispatch({ type: 'project.set', patch: { tempo: v } }, { by: 'you', label: 'tempo', coalesce: 'tempo' }); }, { passive: false });
  tempo.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') && lockedSay(app, 'Tempo')) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); const v = clamp(Math.round(p().tempo) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), 20, 400); store.dispatch({ type: 'project.set', patch: { tempo: v } }, { by: 'you', label: 'tempo', coalesce: 'tempo' }); }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); editTempo(); }
  });
  function editTempo() {
    if (tempo.querySelector('input') || lockedSay(app, 'Tempo')) return;
    const inp = h('input.tp-tempo-input', { type: 'text', inputmode: 'decimal', value: String(p().tempo), 'aria-label': 'Tempo in BPM' });
    tempoNum.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      const v = Number(inp.value.replace(',', '.'));
      inp.replaceWith(tempoNum);
      if (ok && Number.isFinite(v)) {
        const t = clamp(Math.round(v * 100) / 100, 20, 400);
        if (t !== p().tempo) store.dispatch({ type: 'project.set', patch: { tempo: t } }, { by: 'you', label: `tempo ${t}` });
        if (t !== v) ui.toast('Tempo goes from 20 to 400 BPM');
      }
      sync();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
  }
  const taps = [];
  const tapB = h('button.tp-tap', { type: 'button', dataset: { feature: 'song-settings' }, title: 'Tap tempo: tap along to the beat in your head', onclick: () => {
    if (lockedSay(app, 'Tempo')) return;
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    flash(tapB);
    if (taps.length >= 2) {
      const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      const bpm = clamp(Math.round(60000 / iv), 20, 400);
      store.dispatch({ type: 'project.set', patch: { tempo: bpm } }, { by: 'you', label: `tap tempo ${bpm}`, coalesce: 'tap-tempo' });
    }
  } }, 'Tap');

  /* ------------------------------------------------ meter and key: spec-sheet labels over their values */
  const meterV = h('span.tp-val.num', '4/4');
  const meterB = h('button.tp-chip.tp-spec.tp-meter-sig', { type: 'button', dataset: { feature: 'song-settings' }, title: 'Time signature', onclick: () => !lockedSay(app, 'The meter') && menu(meterB, [{ head: 'Time signature' },
    ...METERS.map((m) => ({ label: m.join('/'), sub: m[0] === p().meter[0] && m[1] === p().meter[1] ? '●' : '', run: () => store.dispatch({ type: 'project.set', patch: { meter: m } }, { by: 'you', label: `meter ${m.join('/')}` }) }))]) },
  h('small.tp-lab', 'Meter'), meterV);
  const keyV = h('span.tp-val');
  const keyB = h('button.tp-chip.tp-key.tp-spec', { type: 'button', title: 'Key: what the piano roll, agents and devices follow', onclick: () => openKey() }, h('small.tp-lab', 'Key'), keyV);
  // (anchor: what it opens under; More's Key row on a phone, where the top bar has no room for the key)
  function openKey(anchor = keyB) {
    if (!anchor?.isConnected) anchor = keyB;
    const k = p().key;
    const set = (key) => store.dispatch({ type: 'project.set', patch: { key } }, { by: 'you', label: key ? `key ${key.root} ${key.scale}` : 'no key' });
    const roots = h('div.tp-roots', ROOTS.map((r) => h('button.tp-root' + (k && same(k.root, r) ? '.on' : '') + (r.length > 1 ? '.acc' : ''), { onclick: () => { set({ root: r, scale: k?.scale || 'minor' }); openKey(anchor); } }, r)));
    const scales = h('div.tp-scales', SCALE_LIST.map(([id, name]) => h('button.ek-item' + (k?.scale === id ? '.on' : ''), { onclick: () => { set({ root: k?.root || 'C', scale: id }); openKey(anchor); } }, h('span', name), k?.scale === id ? h('span.ek-sub', '●') : null)));
    popover(anchor, [h('div.ek-head', 'Key'), roots, h('div.ek-sep'), scales, h('div.ek-sep'), h('button.ek-item', { onclick: () => { set(null); closePopover(); } }, 'No key (atonal, nothing snaps)')], { cls: 'tp-keypop' });
  }
  app.transport.openKey = (anchor) => openKey(anchor || keyB);

  /* ------------------------------------------------ undo / redo */
  const undoB = btn('undo', 'Undo', () => {
    const r = store.undo();
    if (!r.ok) ui.toast(r.error); else ui.toast(`Undid “${r.txn.label}”${store.isAgent(r.txn.by) ? ` (by ${store.author(r.txn.by).name})` : ''}`);
  }, '.tp-undo');
  const redoB = btn('redo', 'Redo', () => { const r = store.redo(); if (!r.ok) ui.toast(r.error); }, '.tp-redo');
  redoB.dataset.feature = 'redo';

  /* ------------------------------------------------ the output meter: peak over RMS, and the held peak in dB */
  // It reads the mix before the master's safety clip (engine.meters.master; engine/strip.js): after the clip nothing
  // passes about −0.5 dBFS, so a mix that went over read "−0.7" in white (docs/FRESH-EYES-6.md, the producer's Broken
  // 2). Over 0 dBFS the bars go red and the number gives way to words, "Clipping 2.4 dB": how far over the mix went,
  // which is what the clip is shaving off. They hold OVER_MS after the mix was last that high, and while the pointer or
  // focus is on them. A press pulls the master down by that much, rounded up with half a dB to spare ("master down
  // 3 dB", one undo step; a master level lane that plays moves down with it, its shape kept). app.transport.over is
  // the dB the words say (0: none), worked out every frame, the meter on screen or not: the mixer's master strip says
  // the same.
  const mcv = document.createElement('canvas');
  mcv.className = 'tp-meter';
  // (the number, then its unit: a narrower bar keeps the number and lets the unit go, the meter's title says dBFS)
  const dbN = h('span', '−∞'), dbT = h('span.tp-db.mono', dbN, h('span.tp-db-u', ' dB'));
  // (the words take the number's place at its width, a label over its value as Tempo's is: nothing on the bar moves)
  const overV = h('span.tp-val'), overB = h('button.tp-spec.tp-over', { type: 'button', hidden: true, onclick: () => pullDown() }, h('small.tp-lab', 'Clipping'), ' ', overV);
  const meter = h('div.tp-meterbox', { title: METER_TITLE }, h('span.tp-meter-l', { 'aria-hidden': 'true' }, 'Out'), mcv, dbT, overB);
  const mg = mcv.getContext('2d');
  let hold = -120, holdT = 0, mw = 0, mh = 0, dbAt = 0, badC = '';
  // the mix past 0 dBFS: by how much (dB), and when (frame time) it was last that high; calm: until when the readings
  // are left alone after a press (the analysers still hold the last ~60 ms of the old level)
  const over = { db: 0, at: -1e9, calm: 0 };
  const bad = () => badC || (badC = tok('--bad')) || '#ff6b6b';   // (the state red, BRAND.md: --rec is for recording)
  // what the next step pulls the master down by, in whole dB: the over, rounded up with half a dB to spare
  const pullBy = (db) => Math.max(1, Math.ceil(db + 0.5));
  // the readings, every frame: the held peak (1.5 s) and the over, held OVER_MS (longer under the pointer or focus)
  function readMaster(now) {
    const m = engine.meters?.master || { peak: -120, rms: -120 };
    const fresh = now >= over.calm;
    if (fresh && (m.peak > hold || now - holdT > 1500)) { hold = m.peak; holdT = now; }
    // (a meter that has stopped reading, the audio asleep, keeps its last numbers: they aren't the mix going over now)
    if (fresh && m.peak > 0 && engine.ctx?.state === 'running' && (m.peak >= over.db || now - over.at > OVER_MS)) { over.db = m.peak; over.at = now; }
    if (over.db > 0 && now - over.at > OVER_MS && !overB.matches(':hover') && document.activeElement !== overB) over.db = 0;
    app.transport.over = over.db;
    return m;
  }
  function syncDb() {
    const t = hold > -60 ? `${hold < 0 ? '−' : '+'}${Math.abs(hold).toFixed(1)}` : '−∞';
    if (t !== last.db) { last.db = t; dbN.textContent = t; dbT.classList.toggle('clip', hold > 0); }
  }
  function syncOver() {
    if (!(over.db > 0)) {
      if (!overB.hidden) { overB.hidden = true; dbT.hidden = false; last.over = ''; }
      return;
    }
    const a = over.db.toFixed(1), n = pullBy(over.db);
    if (`${a}|${n}` !== last.over) {
      last.over = `${a}|${n}`;
      overV.textContent = `${a} dB`;
      overB.title = `The mix went ${a} dB over 0 dBFS, and the master’s safety clip is shaving that off its peaks. Click: pull the master down ${n} dB (one undo step).`;
      overB.setAttribute('aria-label', `Clipping ${a} dB. Pull the master down ${n} dB`);
    }
    if (overB.hidden) { overB.hidden = false; dbT.hidden = true; }
  }
  function pullDown() {
    if (!(over.db > 0)) return;
    const amt = over.db, n = pullBy(amt), pr = p();
    const g = Math.max(-96, Math.round(((+pr.master?.gain || 0) - n) * 10) / 10);
    const ops = [{ type: 'master.set', patch: { gain: g } }];
    // (the level a lane plays is what's heard, not the fader's own: a lane that plays moves down by as much)
    const ln = lanesOf(pr).find((l) => l.track === 'master' && !l.insert && l.param === 'gain' && !l.lane.off);
    if (ln) {
      const points = ln.lane.points.map((q) => ({ ...q, v: Math.max(-96, Math.round((q.v - n) * 100) / 100) }));
      ops.push({ type: 'auto.write', track: 'master', param: 'gain', points, from: points[0].t, to: points[points.length - 1].t });
    }
    const r = store.dispatch(ops, { by: 'you', label: `master down ${n} dB` });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return; }
    // (the held peak comes down with the master; the next readings are the new level's)
    const now = performance.now();
    over.db = 0; over.calm = now + 300; hold -= n; holdT = now; app.transport.over = 0;
    syncDb(); syncOver();
    ui.toast(`The mix went ${amt.toFixed(1)} dB over. Master down ${n} dB, to ${g < 0 ? '−' : g > 0 ? '+' : ''}${Math.abs(g).toFixed(1)} dB${ln ? ', its lane with it' : ''}.`, { action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
  }

  // (the keys lamp, below, takes the credit line's place under the title while the letter keys are taken)
  const holdB = h('button.tog.on.tp-hold', { type: 'button', 'aria-pressed': 'true', hidden: true, onclick: () => releaseKeys() });
  const left = h('div.tp-group.tp-g-title', h('div.tp-song', title, credits, holdB));
  const transport = h('div.tp-group.tp-g-play', stopB, playB, recB, recTo);
  // (data-feature: the parts the simple view puts away until someone adds them, ui/workspace.js; a group whose parts
  // are all put away goes with them, in CSS below)
  const timeG = h('div.tp-group.tp-g-pos', { dataset: { feature: 'position' } }, pos, ball, takeMark);
  const tempoG = h('div.tp-group.tp-g-tempo', tempo, tapB);
  const songG = h('div.tp-group.tp-g-song', meterB, keyB);
  const modeG = h('div.tp-group.tp-g-mode', h('span.tp-metwrap', { dataset: { feature: 'song-settings' } }, metB, metMore), countB, loopB);
  const editG = h('div.tp-group.tp-g-edit', undoB, redoB);
  const killG = h('div.tp-group.tp-g-kill', { dataset: { feature: 'meters' } }, killB);
  const meterG = h('div.tp-group.tp-g-meter', { dataset: { feature: 'meters' } }, meter);
  // back to the lanes: whenever a lane in the song is held (a knob or fader moved by hand), one word gives every held
  // lane back in one undo step; out of sight otherwise (docs/research/AUTOMATION.md 3.6)
  const heldB = h('button.btn.btn-txt.tp-held', { type: 'button', onclick: () => backToLanes() });
  const heldG = h('div.tp-group.tp-g-held', { hidden: true }, heldB);
  function backToLanes() {
    const held = lanesOf(p()).filter((l) => l.lane.off);
    if (!held.length) return;
    const ops = held.map((l) => ({ type: 'auto.set', track: l.track, ...(l.insert ? { insert: l.insert } : {}), param: l.param, patch: { off: false } }));
    const r = store.dispatch(ops, { by: 'you', label: `back to the lanes (${held.length})` });
    if (!r.ok) ui.toast(r.error, { kind: 'bad' }); else ui.announce?.(`${held.length === 1 ? 'The held lane plays' : `All ${held.length} held lanes play`} again`);
  }
  // The letter keys taken: while musical typing or Tap's pads hold the keyboard, the keys they play on are notes (S, K
  // and L in musical typing, K and L in Tap, not solo, the click and the loop), so the bar says so under the title,
  // where the credit line was ("Keys play Bass, Esc to stop"), a lit lamp; a press hands the keys back. (R still records
  // and M still mutes: neither plays a note.) It reads whole: under a short title ("Untitled") the title's group is as
  // wide as the line.
  // The keys play where they'll be recorded (the keys' aim, input/recorder.js): "Keys play Keys". When turning them on
  // made that track (a new track for the keys), it is said once, for a few seconds: "Keys play a new track, Keys (Lamp
  // Tines). Undo takes it away."
  let keysMade = null;
  store.on?.('change', (e) => {
    if (e?.kind !== 'do' || e.by !== 'you' || !e.ops?.some((o) => o.type === 'track.add')) return;
    const ids = new Set(Object.values(e.created || {}));
    setTimeout(() => {
      const inp = app.input;
      if (!inp?.qwerty?.on) return;
      const a = inp.recorder?.aim?.('keys'), tid = a?.track || inp.target?.('keys')?.id || null;
      if (!tid || !ids.has(tid)) return;
      keysMade = { id: tid, until: performance.now() + 8000 };
      const t = store.track(tid), dev = t?.instrument?.device ? app.devices?.getDevice?.(t.instrument.device)?.name || t.instrument.device : '';
      if (t) ui.announce?.(`Keys play a new track, ${t.name}${dev ? ` (${dev})` : ''}. Undo takes it away.`);
    }, 0);
  });
  function keysHeld() {
    const inp = app.input;
    if (!inp) return null;
    if (inp.qwerty?.on) {
      const a = inp.recorder?.aim?.('keys'), t = a ? (a.track ? store.track(a.track) : null) : inp.target?.();
      if (!t) return { kind: 'keys', what: 'Keys', name: 'a new track', stop: 'Esc' };
      const made = keysMade && keysMade.id === t.id && performance.now() < keysMade.until;
      const dev = made && t.instrument?.device ? app.devices?.getDevice?.(t.instrument.device)?.name || t.instrument.device : '';
      return { kind: 'keys', what: 'Keys', name: made ? `a new track, ${t.name}` : t.name, dev: made ? dev : '', made, stop: 'Esc' };
    }
    if (inp.mode === 'tap' && (!ui.panels?.has?.('sketch') || ui.visible?.('sketch'))) { const a = inp.recorder?.aim?.('pads'), t = a ? (a.track ? store.track(a.track) : null) : inp.recorder?.targetFor?.('pads'); return { kind: 'pads', what: 'Keys', name: t?.name || 'the pads', stop: 'Esc' }; }
    return null;
  }
  function releaseKeys() {
    const inp = app.input;
    if (inp?.qwerty?.on) inp.qwerty.toggle(false);
    else if (inp?.mode === 'tap') inp.setMode?.(null);
    syncHold();
  }
  function syncHold() {
    const k = keysHeld();
    const sig = k ? `${k.kind}|${k.name}|${k.made ? 1 : 0}` : '';
    if (sig === last.hold) return;
    last.hold = sig;
    holdB.hidden = !k;
    row.classList.toggle('tp-has-hold', !!k);
    requestAnimationFrame(refit);   // (the bar's room changed: the title fits again)
    if (!k) { holdB.replaceChildren(); return; }
    // (the sound and the undo line where the bar has room: the announcement said the whole line once)
    holdB.replaceChildren(h('span.tp-hold-l', `${k.what} play`, h('b.tp-hold-n', k.name), k.dev ? h('span.tp-hold-w', ` (${k.dev})`) : null, k.made ? h('span.tp-hold-w', '. Undo takes it away.') : null), h('span.tp-hold-s', h('kbd', k.stop), h('span.tp-hold-w', ' to stop')));
    holdB.title = k.kind === 'keys' ? `Musical typing is on: the home row and the row above it play ${k.name}${k.dev ? ` (${k.dev})` : ''}, so S, K and L are notes, not solo, the click and the loop. Click (or Esc, or \`) to hand the keys back.` : `Tap is on: F, J, K and L play the pads on ${k.name} (so K is the hat and L the open hat, not the click and the loop). Click (or Esc) to hand the keys back.`;
    holdB.setAttribute('aria-label', k.kind === 'keys' ? `Musical typing on: the letter keys play ${k.name}. Press to turn it off` : `Tap on: F J K L play ${k.name}. Press to leave Tap`);
  }
  const row = h('div.tp-row', left, transport, timeG, tempoG, songG, modeG, h('div.tp-spacer'), heldG, editG, killG, meterG);
  el.append(row);

  let last = {};
  // The title fits: a long one (or a tight bar) steps its type down, to 13 px, before it is cut; only then an ellipsis.
  // Fitted when it changes, when the window or a pane moves, and once the fonts are in.
  function fitTitle() {
    if (document.activeElement === title || !title.isConnected) return;
    title.style.fontSize = '';
    const base = parseFloat(getComputedStyle(title).fontSize) || 18;
    for (let fs = base; fs > 13 && title.scrollWidth > title.clientWidth + 1;) { fs -= 1; title.style.fontSize = fs + 'px'; }
  }
  const refit = () => { fitTitle(); fitCredits(); };
  window.addEventListener('resize', refit);
  const offFit = ui.on('resize', refit);
  try { document.fonts?.ready?.then(refit); document.fonts?.addEventListener?.('loadingdone', refit); } catch (e) { /* no font loading API */ }
  requestAnimationFrame(refit);
  function sync() {
    const pr = p();
    if (document.activeElement !== title && title.textContent !== pr.title) { title.textContent = pr.title; fitTitle(); }
    fitDigits();
    syncCredits(pr);
    if (!tempo.querySelector('input')) tempoNum.textContent = Number.isInteger(pr.tempo) ? String(pr.tempo) : pr.tempo.toFixed(1);
    tempo.setAttribute('aria-valuenow', String(pr.tempo));
    tempo.setAttribute('aria-valuetext', `${Number.isInteger(pr.tempo) ? pr.tempo : pr.tempo.toFixed(1)} BPM`);
    meterV.textContent = pr.meter.join('/');
    meterB.setAttribute('aria-label', `Meter ${pr.meter.join('/')}`);
    keyV.replaceChildren(...(pr.key ? [h('span.tp-key-l', `${pr.key.root} ${keyName(pr.key.scale)}`), h('span.tp-key-s', `${pr.key.root} ${SHORT[pr.key.scale] || keyName(pr.key.scale)}`)] : [h('span.tp-dim', 'none')]));
    keyB.setAttribute('aria-label', pr.key ? `Key ${pr.key.root} ${keyName(pr.key.scale)}` : 'Key: none');
    const lo = !!pr.loop?.on;
    loopB.classList.toggle('on', lo);
    loopB.setAttribute('aria-pressed', String(lo));
    const loopTitle = `Loop (L): ${lo ? 'on' : 'off'}, ${posLabel(pr.loop.start, pr.meter)} to ${posLabel(pr.loop.end, pr.meter)}`;
    if (loopB.classList.contains('tp-locked')) loopB.dataset.title = loopTitle; else loopB.title = loopTitle;
    metB.setAttribute('aria-pressed', String(!!engine.metronome));
    syncLamp();
    const ckNow = ck.get();
    metB.title = `The click: a metronome to play along to (K)${ckNow.on && ckNow.whileRecording ? ', only while recording' : !ckNow.on && ckNow.takes ? '. Off, it still clicks while a take records' : ''}`;
    const r0 = app.input?.recorder;
    countB.hidden = !r0?.setCountIn;
    if (r0) { const n = r0.countIn || 0; countV.textContent = n ? `${n} bar${n > 1 ? 's' : ''}` : 'none'; countB.setAttribute('aria-label', `Count-in: ${countV.textContent}. Shift+K changes it.`); }
    // the ball's cells: the meter's beats (6/8 shows 6)
    const cells = Math.max(1, Math.round(pr.meter[0]));
    if (beats.childElementCount !== cells) { beats.replaceChildren(...Array.from({ length: cells }, (_, i) => h('i' + (i ? '' : '.one')))); last.cx = null; last.beat = null; }
    // a take running: time and the loop wait for it (dimmed, and they say so)
    const lock = takeRunning(app);
    if (lock !== last.lock) {
      last.lock = lock;
      for (const [b, what] of [[tempo, 'Tempo'], [tapB, 'Tap tempo'], [meterB, 'Meter'], [loopB, 'Loop']]) {
        b.classList.toggle('tp-locked', lock);
        if (lock) { b.dataset.title = b.dataset.title || b.title; b.title = `${what}: after the take`; b.setAttribute('aria-disabled', 'true'); }
        else { if (b.dataset.title) { b.title = b.dataset.title; delete b.dataset.title; } b.removeAttribute('aria-disabled'); }
      }
    }
    const u = store.history[store.history.length - 1];
    undoB.disabled = !u;
    undoB.title = u ? `Undo: ${u.label} — ${store.author(u.by).name} (${MOD}Z)` : 'Nothing to undo';
    undoB.classList.toggle('agent', !!u && store.isAgent(u.by));
    const r = store.redoable?.[store.redoable.length - 1];
    redoB.disabled = !store.canRedo();
    redoB.title = r ? `Redo: ${r.label} — ${store.author(r.by).name} (${MOD}⇧Z)` : 'Nothing to redo';
    syncPlay();
    syncMarker();
    const nHeld = lanesOf(pr).filter((l) => l.lane.off).length;
    if (nHeld !== last.held) {
      last.held = nHeld;
      heldG.hidden = !nHeld;
      row.classList.toggle('tp-has-held', !!nHeld);
      requestAnimationFrame(refit);
      heldB.replaceChildren(h('span.tp-held-l', `Back to the lanes (${nHeld} held)`), h('span.tp-held-s', `${nHeld} held`));
      heldB.setAttribute('aria-label', `Back to the lanes (${nHeld} held)`);
      heldB.title = `${nHeld} lane${nHeld === 1 ? ' is' : 's are'} held: a knob or fader was moved by hand, so its own value plays. Click: every lane plays again`;
    }
  }
  // the Click lamp is lit while the click sounds: the click on, and the count-in (which always clicks)
  function syncLamp(cd = countdown(app)) {
    const lit = !!engine.metronome || !!cd;
    if (lit !== last.metLit) { last.metLit = lit; metB.classList.toggle('on', lit); }
  }
  function syncMarker() {
    const where = mk.label();
    if (where === last.marker) return;
    last.marker = where;
    posFrom.textContent = 'from ' + where.replace(', beat ', '.');
    pos.setAttribute('aria-label', `Position. Space plays from ${where}. Click to put the marker at bar 1.`);
  }
  // who played on it: every note's (or audio clip's) author, most first; the house is unsigned, so it isn't named
  function syncCredits(pr) {
    const n = new Map();
    for (const t of pr.tracks) for (const c of t.clips) {
      if (c.kind === 'notes' && c.notes?.length) { for (const x of c.notes) { const by = x.by || c.by; n.set(by, (n.get(by) || 0) + 1); } } else if (c.by) n.set(c.by, (n.get(c.by) || 0) + 4);
    }
    const ranked = [...n.entries()].sort((a, b) => b[1] - a[1]);
    const who = ranked.filter(([by]) => authorOf(by, app).kind !== 'house').map(([by]) => by);
    // the house is unsigned but still counted: when it played most of the song (a demo), the others are featured on
    // it ("featuring Claude"), not credited with all of it ("played by Claude" read as if Claude played everything)
    const houseLeads = ranked.length && authorOf(ranked[0][0], app).kind === 'house';
    const sig = (houseLeads ? 'f:' : 'p:') + who.join('|');
    if (sig === last.credits) return;
    last.credits = sig;
    if (!who.length) { credits.replaceChildren(); credits.hidden = true; credits.removeAttribute('title'); last.who = null; return; }
    credits.hidden = false;
    last.who = { who, lead: houseLeads ? 'featuring ' : 'played by ' };
    fitCredits();
  }
  // the credits run to two lines under the title, like a sleeve's, and name as many as fit there, then "and 2 more" (they
  // never widen the title, and never cut a name off: "featuring Claude, cursor and y…" was the old line); the whole
  // list is the line's title when some are left out
  function fitCredits() {
    const w = last.who;
    if (!w || credits.hidden) return;
    const line = (k) => {
      const names = w.who.slice(0, k), more = w.who.length - names.length, parts = [w.lead];
      names.forEach((by, i) => { if (i) parts.push(i === names.length - 1 && !more ? ' and ' : ', '); parts.push(byline(by, { app })); });
      if (more) parts.push(` and ${more} more`);
      credits.replaceChildren(...parts);
    };
    let k = Math.min(3, w.who.length);
    line(k);
    const over = () => credits.clientHeight > 0 && credits.scrollHeight > credits.clientHeight + 1;
    while (k > 1 && over()) line(--k);
    if (w.who.length > k) { const all = w.who.map((by) => byline(by, { app })?.textContent || authorOf(by, app).name); credits.title = w.lead + all.slice(0, -1).join(', ') + ' and ' + all.at(-1); }
    else credits.removeAttribute('title');
  }
  function syncPlay() {
    const playing = !!engine.playing;
    // playing, the key shows what a press does (stop, back to the marker), and says so
    if (last.playing !== playing) { last.playing = playing; playB.classList.toggle('on', playing); playB.title = playing ? `Stop, back to ${mk.label()} (Space)` : `Play from ${mk.label()} (Space)`; playB.setAttribute('aria-label', playing ? 'Stop (Space)' : 'Play (Space)'); }
    syncRec();
  }
  // The record key's state: idle (armed when there is a track to record onto), count, rec, keeping (the take going in)
  let keepingUntil = 0, prevRec = 'idle';
  function recState() {
    const r = app.input?.recorder;
    if (!r) return recording(app) ? 'rec' : 'idle';
    const st = r.state;
    if (st === 'rec' && (app.transport.punching || !engine.playing)) return 'keeping';
    if (st === 'idle' && performance.now() < keepingUntil) return 'keeping';
    return st;
  }
  function syncRec() {
    const r = app.input?.recorder;
    const st = recState();
    const armed = r ? !!r.target : p().tracks.some((t) => t.arm);
    // where it records: where the take lands (the recorder's target; in Hum it, the track the hum goes onto; a take
    // running: the tracks it records onto), by name. The key's title, its name for a screen reader and the "Onto" beside
    // it say the same, and change the moment the target does
    const hum = !!r?.humming?.(), at = r ? (r.lands ? r.lands()?.id : r.target) : null;
    const tn = at ? store.track(at)?.name || null : null;
    const onto = st !== 'idle' && r?.tracks?.length ? r.tracks.map((id) => store.track(id)?.name).filter(Boolean).join(' and ') : tn;
    const sig = [st, armed, tn, onto, hum, recKind(), p().tracks.length, fullView()].join('|');
    if (last.recSig === sig) return;
    last.recSig = sig;
    for (const k of ['counting', 'on', 'keeping']) recB.classList.remove(k);
    if (st === 'count') recB.classList.add('counting');
    if (st === 'rec') recB.classList.add('on');
    if (st === 'keeping') recB.classList.add('keeping');
    recB.classList.toggle('armed', armed);
    recB.setAttribute('aria-pressed', String(st !== 'idle'));
    const what = hum ? 'your hum ' : '';
    const part = newPart(recKind(), p(), app).name;
    const t = st === 'count' ? `Counting in${onto ? `, to record ${what}onto ${onto}` : ''}: R or Space cancels` : st === 'rec' ? `Recording${onto ? ` ${what}onto ${onto}` : ''}: R punches out and keeps playing, Space stops and keeps the take` : st === 'keeping' ? 'The take is going into the song' : tn ? `Record ${what}onto ${tn}, from the marker (R)` : `R records ${what}onto a new track (${part}), from the marker`;
    recB.title = t;
    recB.setAttribute('aria-label', st === 'idle' ? `Record (R)${tn ? `, ${what}onto ${tn}` : ''}` : st === 'count' ? 'Counting in. Press to cancel' : st === 'rec' ? 'Recording. Press to punch out' : 'Keeping the take');
    recToV.textContent = onto || 'a new track';
    recToV.classList.toggle('tp-dim', !onto);
    // (the hum's drum-track rule is the full studio's: there a hum goes onto a drum track only when it's armed)
    recTo.title = st === 'idle' ? (tn ? `R records ${what}onto ${tn}${hum && fullView() ? ' (a hum goes onto a drum track only when it’s armed)' : ''}. Click to pick another, or a new track.` : `R records ${what}onto a new track (${part}). Click to pick a track.`) : `Recording ${what}onto ${onto || 'a new track'}`;
    recTo.setAttribute('aria-label', st === 'idle' ? `R records ${what}onto ${tn || 'a new track'}. Pick another track` : `Recording ${what}onto ${onto || 'a new track'}`);
    recTo.classList.toggle('tp-rec-on', st === 'rec' || st === 'count');
    pos.classList.toggle('counting', st === 'count');
    takeMark.hidden = st === 'idle';
    if (st === 'idle') delete timeG.dataset.take; else timeG.dataset.take = st;   // the take's mark stands where the clock was
    takeMark.dataset.state = st;
    recLab.textContent = st === 'rec' ? 'REC' : st === 'keeping' ? 'keeping' : '';
    ball.classList.toggle('rec', st === 'count' || st === 'rec');
  }
  function onRecState(e) {
    const s = e?.state;
    if (s === 'idle' && prevRec !== 'idle' && prevRec !== 'count') keepingUntil = performance.now() + 700;
    if (s === 'idle' || s === 'count') app.transport.punching = false;
    if (s) prevRec = s;
    sync();
    drawPos();   // the count reads in the position from the moment R is pressed, not from the next frame
  }

  const offT = engine.on?.('transport', () => sync()) || (() => {});
  const offU = ui.on('transport-ui', sync);
  // the recorder loads after the transport (input/index.js): listen once it is there
  let offR = () => {};
  const hookRec = () => { const r = app.input?.recorder; if (!r?.on || hookRec.done) return; hookRec.done = true; offR = r.on('state', onRecState); sync(); };
  hookRec();
  const offReady = ui.on('ready', hookRec);
  const offM = mk.on(() => syncMarker());
  sync();

  function drawMeter(now) {
    const m = readMaster(now);
    const r = mcv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width), hh = Math.round(r.height);
    if (!w || !hh) return;
    if (w !== mw || hh !== mh) { mw = w; mh = hh; mcv.width = w * dpr; mcv.height = hh * dpr; mg.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const pal = palette();
    const x = (db) => clamp((db + 60) / 60, 0, 1) * w;
    mg.clearRect(0, 0, w, hh);
    // two hairline bars on the room's line colour: the peak above, the RMS below; the held peak is a 2 px tick. Red is
    // over 0 dBFS, before the safety clip: clipping.
    const bh = Math.max(3, Math.floor((hh - 3) / 2));
    const bar = (y, db) => {
      mg.fillStyle = pal.line || '#2f2b25'; mg.fillRect(0, y, w, bh);
      mg.fillStyle = db > 0 ? bad() : (pal.text2 || '#bdb2a0'); mg.fillRect(0, y, x(db), bh);
    };
    bar(0, m.peak); bar(hh - bh, m.rms);
    if (hold > -60) { mg.fillStyle = hold > 0 ? bad() : (pal.text || '#f2ead8'); mg.fillRect(Math.min(w - 2, x(hold)), 0, 2, bh); }
    if (now - dbAt > 160) { dbAt = now; syncDb(); syncOver(); }
  }
  // The ball, from engine.beat (the audible beat). Cell k is beat k of the bar; between beats the square travels
  // from cell k to the next on a parabola (ARC px high at the middle of the beat, on the cell exactly at the beat).
  const ARC = 5;
  let rmq = null;
  try { rmq = matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) { /* no media queries */ }
  const still = () => !!rmq?.matches;
  function centers() {
    if (last.cx && last.cxW === beats.offsetWidth) return last.cx;
    const kids = [...beats.children];
    if (!kids.length || !beats.offsetWidth) return null;
    last.cxW = beats.offsetWidth;
    last.cx = kids.map((el) => el.offsetLeft + el.offsetWidth / 2);
    return last.cx;
  }
  function drawBall(b, moving) {
    const pr = p();
    const cells = Math.max(1, Math.round(pr.meter[0])), cellLen = 4 / pr.meter[1], bpb = cells * cellLen;
    let k = 0, f = 0;
    if (moving) {
      const inBar = ((b % bpb) + bpb) % bpb;
      const ph = inBar / cellLen;
      k = Math.min(cells - 1, Math.floor(ph + 1e-9));
      f = Math.max(0, Math.min(1, ph - k));
    }
    const cx = centers();
    if (!cx) return;
    const calm = still();
    const next = (k + 1) % cells;
    const x = calm ? cx[k] : cx[k] + (cx[next] - cx[k]) * f;
    const y = calm || !moving ? 0 : -4 * ARC * f * (1 - f);
    const xr = Math.round(x * 10) / 10, yr = Math.round(y * 10) / 10;
    if (xr !== last.bx || yr !== last.by) { last.bx = xr; last.by = yr; dot.style.transform = `translate(${xr}px, ${yr}px)`; }
    const now = moving ? k : -1;
    if (now !== last.cell) { last.cell = now; [...beats.children].forEach((el, i) => el.classList.toggle('now', i === now)); }
    app.transport.ball = { beat: b, cell: k, f, x: xr, y: yr, cells, moving };
  }
  // the count-in: the position reads -1.4 ... -1.1 in record ink, and the record lamp's dot lights for 80 ms on each
  // beat (the big numeral is the arranger's, over the target lane)
  function drawCount(cd) {
    if (!cd) { if (last.count) { last.count = null; recB.classList.remove('beat'); } return false; }
    if (cd.label !== last.count) { last.count = cd.label; setPos(cd.label); }
    const spb = 60 / (+p().tempo || 120) * (4 / p().meter[1]);
    recB.classList.toggle('beat', cd.frac * spb < 0.08);
    return true;
  }
  // the position: the count while a take counts in, else bar.beat.sixteenth (from frame(), and at once when R is pressed)
  function drawPos() {
    const b = engine.beat || 0;
    const cd = countdown(app);
    if (!drawCount(cd)) {
      const bl = posLabel(Math.max(0, b), p().meter);
      if (bl !== last.pos) { last.pos = bl; setPos(bl); }
    } else last.pos = null;
    return cd;
  }
  return {
    update(evt) { if (evt.kind) sync(); },
    frame(now) {
      const b = engine.beat || 0;
      const pr = p();
      syncPlay();
      const cd = drawPos();
      syncLamp(cd);
      syncHold();
      const tl = fmtClock(engine.beatToSec ? engine.beatToSec(Math.max(0, b)) : (Math.max(0, b) * 60) / pr.tempo);
      if (tl !== last.time) { last.time = tl; posTime.textContent = tl; }
      drawMeter(now);
      drawBall(b, !!engine.playing || !!cd);
    },
    refresh: sync,
    unmount() { offT(); offU(); offR(); offM(); offReady(); offFit(); window.removeEventListener('resize', refit); try { document.fonts?.removeEventListener?.('loadingdone', refit); } catch (e) { /* ok */ } },
  };
}

const SCALE_NAMES = Object.fromEntries(SCALE_LIST.map(([id, name]) => [id, name.toLowerCase()]));
const keyName = (scale) => SCALE_NAMES[scale] || { locrian: 'locrian', melodicMinor: 'melodic minor', chromatic: 'chromatic' }[scale] || SHORT[scale] || scale;

function posLabel(beat, meter) {
  const bpb = meter ? meter[0] * (4 / meter[1]) : 4;
  const bar = Math.floor(beat / bpb + 1e-9) + 1, inBar = beat - (bar - 1) * bpb;
  const bt = Math.floor(inBar + 1e-9) + 1, six = Math.floor((inBar - Math.floor(inBar + 1e-9)) * 4 + 1e-9) + 1;
  return `${bar}.${bt}.${six}`;
}
// the record lamp: drawn as SVG circles (a lamp is the one round thing; no CSS radius)
function recLamp() {
  const el = h('span.tp-rec-lamp', { 'aria-hidden': 'true' });
  el.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18"><circle class="ring" cx="10" cy="10" r="7.3"/><circle class="core" cx="10" cy="10" r="3.6"/></svg>';
  return el;
}
// a key answering a press: it lights at once and goes back (its .hit comes off after a moment, so it never stays lit)
function flash(el, ms = 240) {
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  clearTimeout(el._hitT); el._hitT = setTimeout(() => el.classList.remove('hit'), ms);
}
function fmtDb(v) { return `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(0)} dB`; }
function same(a, b) { const n = { Db: 'C#', 'D#': 'Eb', Gb: 'F#', 'G#': 'Ab', 'A#': 'Bb' }; return (n[a] || a) === (n[b] || b); }
function selectAll(el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

const CSS = `
.tpk { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 24px 16px; background: rgba(10, 9, 7, .62); animation: tpk-in .16s var(--ease) both; }
.tpk.out { animation: tpk-out .16s var(--ease) both; }
@keyframes tpk-in { from { opacity: 0; } } @keyframes tpk-out { to { opacity: 0; } }
.tpk-card { position: relative; width: min(980px, 100%); max-height: min(720px, 100%); overflow: auto; padding: 22px 28px 24px; border-radius: 0; outline: none;
  background: var(--bg-2); border: var(--rule-2); box-shadow: var(--shadow-2); }
.tpk-head { padding-right: 60px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: var(--rule-heavy); }
.tpk-head h2 { margin: 0 0 6px; font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 125%; font-variation-settings: var(--font-display-vars, normal); font-size: 23px; letter-spacing: -.012em; color: var(--text); }
.tpk-head p { margin: 0; color: var(--text-3); font-size: 13px; }
.tpk-single { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; max-width: 560px; color: var(--text-2); font-size: 12.5px; cursor: pointer; }
.tpk-single input { margin: 2px 0 0; accent-color: var(--accent-2); }
.tpk-single small { display: block; color: var(--text-3); font-size: 11.5px; margin-top: 1px; }
.tpk-single input:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.tpk-x { position: absolute; top: 18px; right: 20px; height: 28px; padding: 0 4px; display: grid; place-items: center; border: 0; background: none; color: var(--text-2); cursor: pointer; }
.tpk-x:hover { color: var(--text); }
.tpk-x:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.tpk-cols { columns: 3 260px; column-gap: 32px; }
.tpk-g { break-inside: avoid; margin: 0 0 20px; }
.tpk-g h3 { margin: 0 0 6px; padding-bottom: 6px; border-bottom: var(--rule); font-size: 13.5px; font-weight: 600; color: var(--text); }
.tpk-g dl { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; align-items: center; }
.tpk-g dt { display: flex; gap: 3px; align-items: center; justify-content: flex-end; white-space: nowrap; }
.tpk-g dd { margin: 0; color: var(--text-2); font-size: 12.5px; line-height: 1.3; }
.tpk-g kbd { min-width: 20px; text-align: center; font-size: 11px; color: var(--text); }
.tpk-g dt.tpk-strip { grid-column: 1 / -1; justify-content: flex-start; flex-wrap: wrap; white-space: normal; gap: 3px; }
.tpk-g dd.tpk-strip-l { grid-column: 1 / -1; margin-top: -1px; margin-bottom: 4px; color: var(--text-3); font-size: 12px; }
.tpk-or { font-size: 10.5px; color: var(--text-3); margin: 0 2px; }
@media (max-width: 600px) { .tpk { padding: 10px; } .tpk-card { padding: 18px 16px; } .tpk-head h2 { font-size: 21px; } }

/* The top bar, set like a spec sheet: regions split by hairlines, never boxed. The song (title, then who played on it);
   the transport glyphs; the position as a big numeral; Tempo, Meter and Key as small labels over their values; the click
   and its beat lamps; All off; the output meter. */
[data-panel="transport"] { container-type: inline-size; container-name: tp; align-self: stretch; width: 100%; min-width: 0; }
.tp-row { display: flex; align-items: center; gap: 0; height: 100%; min-height: 52px; min-width: 0; }
.tp-group { display: flex; align-items: center; gap: 2px; flex: none; height: 40px; padding: 0 9px; border-left: var(--rule); }
.tp-g-title { border-left: 0; padding-left: 4px; }
.tp-g-edit, .tp-g-kill { border-left: 0; padding: 0 4px; }
.tp-spacer { flex: 1; min-width: 4px; }
.tp-g-title { flex: 0 1 auto; min-width: 140px; max-width: 240px; }
/* (the song fills its group: the line under the title gets the group's width, not just the title's) */
.tp-song { display: flex; flex-direction: column; justify-content: center; flex: 1 1 auto; min-width: 0; }
.tp-title { font-family: var(--font-display); font-weight: 800; font-stretch: 125%; font-variation-settings: var(--font-display-vars, normal); font-size: 18px; line-height: 1.1; letter-spacing: -.01em;
  padding: 1px 6px; margin-left: -6px; border-radius: var(--r-press); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; outline: none; color: var(--text); min-width: 40px; }
.tp-title:hover { background: var(--bg-3); }
.tp-title[contenteditable="true"] { background: var(--bg); box-shadow: 0 0 0 1.5px var(--accent-2); text-overflow: clip; }
.tp-credits { font-size: 11px; line-height: 1.2; color: var(--text-3); margin-top: 3px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; }
.tp-credits[hidden] { display: none; }
/* the credit line takes the title's width and never widens it: a take that adds a name to the credits moves nothing on
   the bar. The keys lamp in its place reads whole ("Keys play Bass  Esc"): the title's group widens to it when the
   title is shorter, up to the group's widest */
.tp-credits { contain: inline-size; }
.tp-btn { display: inline-grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: var(--r-press); background: transparent; color: var(--text-2); cursor: pointer; }
.tp-btn:hover { background: var(--bg-3); color: var(--text); }
.tp-btn:focus-visible, .tp-chip:focus-visible, .tp-tap:focus-visible, .tp-pos:focus-visible, .tp-tempo:focus-visible, .tp-count:focus-visible, .tp-kill:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.tp-btn:disabled { opacity: .35; cursor: default; background: transparent; }
.tp-btn .ico svg { width: 15px; height: 15px; }
.tp-g-play .tp-btn:first-child { color: var(--text-2); }
.tp-g-play .tp-btn:not(.tp-play) { width: 30px; }
/* Play is the top bar's one primary: leader green. Playing, it shows what a press does: stop (back to the marker) */
.tp-play { width: 44px; background: var(--accent); color: var(--bg); }
.tp-play:hover { background: var(--accent); color: var(--bg); filter: brightness(1.06); }
.tp-play .ico-stop { display: none; }
.tp-play.on .ico-play { display: none; } .tp-play.on .ico-stop { display: inline-grid; }
/* record: a round lamp (a lamp is the one round thing). A ring in --line-2 with a pencil dot; armed (a track to record
   onto), the dot in record ink; counting in, the ring in record ink and the dot lit for 80 ms on each beat; recording,
   the lamp filled and lit (steady, never a pulse); keeping (the take going in), filled at half strength */
.tp-rec-lamp { display: grid; place-items: center; line-height: 0; }
.tp-rec-lamp .ring { fill: none; stroke: var(--line-2); stroke-width: 1.5; }
.tp-rec-lamp .core { fill: var(--text-3); }
.tp-rec.armed .tp-rec-lamp .core { fill: var(--rec); }
.tp-rec.counting .tp-rec-lamp .ring { stroke: var(--rec); }
.tp-rec.counting .tp-rec-lamp .core { fill: color-mix(in srgb, var(--rec) 35%, transparent); }
.tp-rec.counting.beat .tp-rec-lamp .core { fill: var(--rec); }
.tp-rec.counting.beat .tp-rec-lamp, .tp-rec.on .tp-rec-lamp { filter: drop-shadow(0 0 4px color-mix(in srgb, var(--rec) 70%, transparent)); }
.tp-rec.on .tp-rec-lamp .ring { stroke: var(--rec); fill: var(--rec); }
.tp-rec.on .tp-rec-lamp .core { fill: var(--rec); }
.tp-rec.keeping .tp-rec-lamp .ring { stroke: var(--rec); fill: color-mix(in srgb, var(--rec) 45%, transparent); }
.tp-rec.keeping .tp-rec-lamp .core { fill: none; }
.tp-undo.agent { color: var(--agent); }
.tp-g-edit .tp-btn { width: 28px; color: var(--text-3); }
/* where R records, beside the record key: "Onto" over the track's name (record ink while a take records onto it) */
.tp-recto { flex: 0 1 auto; min-width: 0; max-width: 108px; padding: 0 4px 0 6px; }
.tp-recto .tp-val { max-width: 100%; font-size: 13px; overflow: hidden; text-overflow: ellipsis; }
.tp-recto .tp-val.tp-dim { font-weight: 600; }
.tp-recto.tp-rec-on .tp-val { color: var(--rec); }
.tp-recto:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
/* the position: a big display numeral (the dots in pencil), the clock and its unit in mono beside it */
.tp-pos { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 4px; border: 0; border-radius: var(--r-press); background: none; color: var(--text); cursor: pointer; text-align: left; }
.tp-pos:hover { background: var(--bg-3); }
.tp-pos-bar { font-size: 30px; }
.tp-pos-bar em { font-style: inherit; color: var(--text-3); margin: 0 .5px; }
.tp-pos-side { display: flex; flex-direction: column; color: var(--text-3); line-height: 1.25; }
.tp-pos-time { color: var(--text-2); }
/* the clock and the marker's words: a fixed column too (the clock passing 9:59, the marker moving, move nothing) */
.tp-pos-side { width: 12ch; }
.tp-pos-side > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* spec-sheet labels: a small pencil word over its value */
.tp-spec { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; height: 40px; padding: 0 8px; border: 0; border-radius: var(--r-press); background: none; color: var(--text); cursor: pointer; font: inherit; text-align: left; }
.tp-spec:hover { background: var(--bg-3); }
.tp-lab { font-size: 10.5px; line-height: 1; color: var(--text-3); margin-bottom: 4px; font-weight: 400; white-space: nowrap; }
.tp-val { font-weight: 600; font-size: 14px; line-height: 1; white-space: nowrap; }
.tp-val.num, .tp-tempo-num { font-size: 18px; font-weight: 800; }
.tp-tempo { cursor: ns-resize; user-select: none; touch-action: none; }
.tp-tempo-num { min-width: 2.6ch; }   /* three digits fit: the tap key beside it doesn't move as the tempo changes */
.tp-tempo-input { width: 56px; height: 20px; padding: 0 6px; border-radius: var(--r-press); border: 0; box-shadow: 0 0 0 1.5px var(--accent-2); background: var(--bg); color: var(--text); font: 600 14px var(--font-mono); outline: none; }
.tp-g-tempo, .tp-g-song { padding: 0 4px; }
.tp-tap { height: 20px; padding: 0 5px; margin: 14px 4px 0 0; border-radius: var(--r-press); border: var(--rule-2); background: transparent; color: var(--text-3); font: 600 10.5px var(--font-ui); cursor: pointer; }
.tp-tap:hover { color: var(--text); border-color: var(--text-3); }
.tp-tap.hit { background: var(--text); color: var(--bg); border-color: var(--text); transition: none; }
.tp-tap:not(.hit) { transition: background .2s, color .2s; }
.tp-chip { color: var(--text); }
.tp-dim { color: var(--text-3); font-weight: 400; }
.tp-key-s { display: none; }
/* the click: a toggle with a caret for its options; the count-in as a label over its value */
.tp-g-mode { gap: 6px; padding-right: 8px; }
.tp-tog { height: 32px; }
.tp-metwrap { display: inline-flex; align-items: center; }
.tp-caret { display: inline-grid; place-items: center; width: 18px; height: 32px; padding: 0; border: 0; border-radius: var(--r-press); background: none; color: var(--text-3); cursor: pointer; }
.tp-caret:hover, .tp-caret[aria-expanded="true"] { color: var(--text); background: var(--bg-3); }
.tp-caret:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.tp-count { padding: 0 6px; }
.tp-count .tp-val { font-size: 12px; font-weight: 600; color: var(--text-2); }
.tp-count[hidden] { display: none; }
/* the ball: outlined cells a beat apart (the bar's first larger) and a 6 px square that travels between them on a
   shallow arc. Cream; record ink while counting in and recording. The cell under it is lit while the song plays */
.tp-ball { position: relative; display: inline-flex; align-items: flex-end; height: 26px; padding: 0 2px 6px; margin-left: 8px; flex: none; }
.tp-beats { display: flex; align-items: flex-end; gap: 4px; }
.tp-beats i { width: 10px; height: 10px; border: 1px solid var(--line-2); }
.tp-beats i.one { width: 12px; height: 12px; }
.tp-beats i.now { border-color: var(--text-3); }
.tp-ball-dot { position: absolute; left: -1px; bottom: 8px; width: 6px; height: 6px; margin-left: -3px; background: var(--text); will-change: transform; }
.tp-ball.rec .tp-ball-dot { background: var(--rec); }
.tp-ball.rec .tp-beats i.now { border-color: var(--rec); }
/* a take's mark beside the position: the count-in's numeral, then REC, then "keeping" */
.tp-take { display: inline-flex; align-items: center; gap: 6px; min-width: 0; margin-left: 8px; }
.tp-take[hidden] { display: none; }
.tp-g-held[hidden] { display: none; }
.tp-hold[hidden] { display: none; }
.tp-has-hold .tp-credits { display: none; }
.tp-hold { height: auto; min-height: 0; max-width: 100%; margin-top: 3px; padding: 0; gap: 5px; font-size: 11px; line-height: 1.2; color: var(--text); overflow: hidden; }
.tp-hold::before { width: 5px; height: 5px; }
.tp-hold-l { white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tp-hold-n { font-weight: 600; margin-left: .3em; }
.tp-hold-s { flex: none; color: var(--text-3); font-weight: 400; white-space: nowrap; }
.tp-hold kbd { margin: 0 1px; font-size: 10.5px; }
@container tp (max-width: 1500px) { .tp-hold-w { display: none; } }
@container tp (max-width: 1330px) { .tp-has-hold .tp-group:not(.tp-g-title) { padding: 0 4px; } .tp-has-hold .tp-tap { display: none; } }
.tp-g-held { border-left: 0; padding: 0 2px 0 4px; }
/* (it never takes the output meter's number: the shell gives the bar the wordmark's room when it runs over) */
.tp-held { white-space: nowrap; color: var(--accent-2); }
.tp-held-s { display: none; }
@container tp (max-width: 1260px) { .tp-held-l { display: none; } .tp-held-s { display: inline; } }   /* (the words only where the dB keeps its room too) */
.tp-g-pos[data-take] .tp-pos-side { display: none; }
.tp-reclab { color: var(--rec); font-weight: 600; }
.tp-take[data-state="keeping"] .tp-reclab { color: var(--text-3); }
/* a fixed width: the song's bar digits (two at least), the beat and the sixteenth in tabular figures, and two dots; the
   count (-1.4) fits inside it. Nothing beside it moves at bar 10 (or at bar 100 of a long song) */
.tp-pos-bar { display: inline-block; width: calc((var(--tp-bar-digits, 2) + 2) * 1ch + .9em); white-space: nowrap; }
.tp-pos.counting .tp-pos-bar, .tp-pos.counting .tp-pos-bar em { color: var(--rec); }
/* a take running: tempo, meter and the loop wait for it */
.tp-locked { opacity: .38; cursor: not-allowed !important; }
.tp-locked:hover { background: none; }
/* the click's options */
.tp-clickpop { width: 260px; padding: 8px 10px 10px; }
/* (one column the popover's width: the level slider's own width once pushed the column past it, and "0 dB" read "0 dE") */
.tp-pop-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.tp-pop-row { min-width: 0; }
.tp-pop-head { font-weight: 600; font-size: 13px; color: var(--text); padding: 2px 0 6px; border-bottom: var(--rule); margin-bottom: 4px; }
.tp-pop-tog { justify-content: flex-start; width: 100%; height: 30px; }
.tp-pop-row { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 2px; }
.tp-pop-lab { font-size: 12px; color: var(--text-3); min-width: 56px; }
.tp-pop-opt { height: 26px; padding: 0 4px; border: 0; background: none; color: var(--text-3); font: 600 12.5px var(--font-ui); cursor: pointer; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 4px; }
.tp-pop-opt:hover { color: var(--text-2); }
.tp-pop-opt.on { color: var(--text); text-decoration-color: var(--text); text-decoration-thickness: 2px; }
.tp-pop-opt:focus-visible, .tp-pop-level:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.tp-pop-level { flex: 1 1 auto; width: 0; min-width: 0; accent-color: var(--accent-2); }
.tp-pop-v { flex: none; min-width: 6ch; text-align: right; color: var(--text-2); white-space: nowrap; }
.tp-pop-note { margin: 6px 0 0; font-size: 11.5px; line-height: 1.4; color: var(--text-3); }
/* All off: a key printed in record red, a red square before the words. It stops everything, from anywhere */
.tp-kill { height: 30px; gap: 7px; padding: 0 10px; color: var(--text); }
.tp-kill-sq { width: 9px; height: 9px; background: var(--rec); flex: none; }
.tp-kill:hover { border-color: var(--rec); }
.tp-kill.hit { background: var(--rec); border-color: var(--rec); color: var(--bg); }
.tp-kill.hit .tp-kill-sq { background: var(--bg); }
.tp-kill:not(.hit) { transition: background .4s var(--ease, ease), color .4s var(--ease, ease); }
/* the output meter: two hairline bars and the held peak, in mono */
.tp-g-meter { padding-right: 4px; }
.tp-meterbox { display: flex; align-items: center; gap: 8px; height: 28px; min-width: 104px; padding: 0 2px; }
.tp-meter-l { font-size: 10.5px; color: var(--text-3); }
.tp-meter { width: 48px; height: 11px; display: block; }
.tp-db { width: 8ch; flex: none; color: var(--text-2); text-align: right; white-space: nowrap; }   /* −12.3 dB fits: the bar never moves as the level does */
.tp-db.clip { color: var(--bad); }
/* clipping: "Clipping" over "2.4 dB" in the state red, in the number's place and at its width (the same mono ch) */
.tp-over { flex: none; width: 8ch; height: 28px; align-items: flex-end; font: 400 11.5px var(--font-mono); color: var(--bad); }
.tp-spec.tp-over { padding: 0; }   /* (over the narrower bar's .tp-spec padding, below: the words get the number's whole width) */
.tp-over[hidden] { display: none; }
.tp-over .tp-lab { margin-bottom: 3px; font-family: var(--font-ui); color: var(--bad); }
.tp-over .tp-val { font-size: 11px; font-weight: 600; }
.tp-over:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.tp-keypop { width: 248px; }
.tp-roots { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; padding: 2px 4px 6px; }
.tp-root { height: 28px; border-radius: var(--r-press); border: var(--rule-2); background: none; color: var(--text); cursor: pointer; font: 600 12px var(--font-mono); }
.tp-root.acc { color: var(--text-2); }
.tp-root:hover { border-color: var(--text-3); }
.tp-root.on { background: var(--text); border-color: var(--text); color: var(--bg); }
.tp-scales .ek-item.on { color: var(--text); }
/* Narrower, things give way in this order, so Loop, Undo and Redo, where R records and the output's number stay on the
   bar at 1280 and 1366 (a laptop with the panes open): the count-in (it is in the click's options too), the meter's
   label, the clock and the marker's words beside the position (the ruler shows the marker); the key's scale is
   shortened (A min); the number's unit (the meter's title says dBFS); the tap key and the credit line; the position's
   sixteenth (bar.beat, as on a phone); the spacing tightens and the numeral steps down. Then the output's number (its
   bars stay, and the number is in their title), and only then the meter, where R records, Undo and Redo, and Loop.
   While the bar carries a mark (the keys playing notes, a held lane), the number gives way first, at 1366 and under:
   the mark is what's happening now, and the line under the title reads whole ("Keys play Bass  Esc"). */
@container tp (max-width: 1330px) { .tp-count, .tp-meter-l, .tp-pos-side, .tp-key-l { display: none; } .tp-key-s { display: inline; } .tp-meter { width: 34px; } .tp-meterbox { min-width: 0; gap: 6px; } .tp-group { padding: 0 6px; } .tp-g-title { max-width: 220px; } .tp-tog { padding: 0 6px; } .tp-g-mode { gap: 3px; } .tp-spec { padding: 0 6px; } }
@container tp (max-width: 1160px) { .tp-g-title { min-width: 104px; } .tp-pos-bar { font-size: 28px; } .tp-ball, .tp-take { margin-left: 4px; } .tp-db-u { display: none; } .tp-db, .tp-over { width: 6ch; } }
@container tp (max-width: 1100px) { .tp-group { padding: 0 5px; } }
@container tp (max-width: 1060px) { .tp-tap, .tp-credits, .tp-has-hold .tp-db, .tp-has-held .tp-db, .tp-has-hold .tp-over, .tp-has-held .tp-over { display: none; } }
@container tp (max-width: 1040px) { .tp-group, .tp-has-hold .tp-group:not(.tp-g-title) { padding: 0 4px; } .tp-spec, .tp-tog { padding: 0 5px; } .tp-beats { gap: 3px; } .tp-beats i { width: 8px; height: 8px; } .tp-beats i.one { width: 10px; height: 10px; } .tp-ball-dot { bottom: 7px; } }
@container tp (max-width: 1000px) { .tp-pos-six { display: none; } .tp-pos-bar { width: calc((var(--tp-bar-digits, 2) + 1) * 1ch + .45em); } }
@container tp (max-width: 990px) { .tp-g-title { min-width: 96px; } }
@container tp (max-width: 960px) { .tp-pos-bar { font-size: 26px; } .tp-group, .tp-has-hold .tp-group:not(.tp-g-title) { padding: 0 3px; } .tp-spec, .tp-tog { padding: 0 4px; } .tp-kill { padding: 0 7px; gap: 6px; } .tp-caret { width: 15px; } .tp-meterbox { gap: 4px; } }
@container tp (max-width: 900px) { .tp-db, .tp-over { display: none; } }
@container tp (max-width: 880px) { .tp-g-meter { display: none; } }
@container tp (max-width: 860px) { .tp-g-title { max-width: 150px; min-width: 100px; } .tp-pos-bar { font-size: 24px; } .tp-recto { display: none; } }
@container tp (max-width: 840px) { .tp-g-edit { display: none; } }
@container tp (max-width: 825px) { .tp-loop { display: none; } }
@container tp (max-width: 810px) { .tp-g-title { display: none; } .tp-g-pos { border-left: 0; } }
@container tp (max-width: 690px) { .tp-g-song { display: none; } .tp-g-mode { display: none; } }
@container tp (max-width: 520px) { .tp-g-edit, .tp-g-mode { display: none; } }
@container tp (max-width: 440px) { .tp-kill span { display: none; } .tp-kill { padding: 0 9px; } .tp-g-play .tp-btn:first-child { display: none; } .tp-group { border-left: 0; padding: 0 4px; } }
/* On a phone (under 640 px) the top bar is two rows (app/style/app.css sets the order): the song, its menu and the panes;
   then stop, play, record, the position as a numeral, the tempo, and All off at the right edge. */
@media (max-width: 640px) {
  .ew-shell .tp-group { border-left: 0; padding: 0; height: auto; }
  .ew-shell .tp-g-title { order: 2; flex: 1 1 0; min-width: 0; max-width: none; padding-left: 4px; }
  .ew-shell .tp-title { padding: 2px 6px; font-size: 17px; }
  .ew-shell .tp-credits { display: -webkit-box; -webkit-line-clamp: 1; line-clamp: 1; font-size: 12px; margin-top: 1px; }
  .ew-shell .tp-credits[hidden] { display: none; }
  .ew-shell .tp-g-pos { order: 7; margin-left: 4px; }
  .ew-shell .tp-pos { height: 44px; min-width: 0; padding: 0 6px; }
  .ew-shell .tp-pos-bar { font-size: 25px; }
  .ew-shell .tp-pos-side, .ew-shell .tp-pos-time { display: none; }
  .ew-shell .tp-tempo { height: 44px; padding: 0 6px; align-items: flex-start; }
  .ew-shell .tp-lab { font-size: 12px; margin-bottom: 3px; }
  .ew-shell .tp-tempo-num { font-size: 17px; }
  .ew-shell .tp-g-kill { order: 11; padding: 0 0 0 4px; }
  .ew-shell .tp-g-edit { order: 12; }
  .ew-shell .tp-g-held { order: 10; padding: 0 4px; }
  .ew-shell .tp-kill { height: 40px; padding: 0 12px; font-size: 13px; }
  .ew-shell .tp-kill span { display: inline; }
  .ew-shell .tp-g-play .tp-btn:first-child { display: inline-grid; }
  .ew-shell .tp-g-play .tp-btn { width: 40px; height: 44px; } .ew-shell .tp-g-play .tp-play { width: 48px; }
  .ew-shell .tp-g-meter, .ew-shell .tp-tap, .ew-shell .tp-count, .ew-shell .tp-loop { display: none; }
  /* (where R records is Sketch's, on a phone: Onto beside Record in the row pinned under the thumb) */
  .ew-shell .tp-recto { display: none; }
  /* the ball beside the position on the second row; the count reads in the position itself (-1.4), REC is the lamp */
  .ew-shell .tp-g-pos { display: flex; align-items: center; }
  .ew-shell .tp-ball { margin-left: 0; padding: 0 0 8px; }
  .ew-shell .tp-beats { gap: 3px; } .ew-shell .tp-beats i { width: 8px; height: 8px; } .ew-shell .tp-beats i.one { width: 10px; height: 10px; }
  .ew-shell .tp-ball-dot { bottom: 9px; }
  .ew-shell .tp-pos-bar { width: calc((var(--tp-bar-digits, 2) + 1) * 1ch + .45em); }   /* bar.beat on a phone */
  .ew-shell .tp-pos-six { display: none; }
  .ew-shell .tp-pos-bar[data-digits="3"] { font-size: 21px; } .ew-shell .tp-pos-bar[data-digits="4"] { font-size: 17px; }
  .ew-shell .tp-take { display: none; }
  .ew-shell .tp-hold { display: none; } .ew-shell .tp-has-hold .tp-credits:not([hidden]) { display: -webkit-box; }   /* (a phone's keys are on screen) */
}
@media (max-width: 460px) {
  .ew-shell .tp-g-edit, .ew-shell .tp-g-tempo { display: none; }
}
/* a narrow phone: the stop key goes (play is stop while the song plays, and a tap on the position puts the marker on
   bar 1), so All off stays on the second row */
@media (max-width: 380px) {
  .ew-shell .tp-g-play .tp-btn:first-child { display: none; }
}
@media (prefers-reduced-motion: reduce) { .tp-kill:not(.hit), .tp-tap:not(.hit) { transition: none; } }
/* The simple view (ui/workspace.js puts .ws-off-<id> on the root for each feature put away, and hides its tagged
   parts): the click's group goes once the click and the loop are both away, so no hairline stands over nothing. On a
   phone its top bar is mark, title, Agent; then stop, play, record, Undo and More: the tempo and the key are More's first
   rows (the song menu is too: ui/export.js), and Undo stays on the bar at every width. */
.ws-off-song-settings.ws-off-loop .tp-g-mode { display: none; }
/* (the steps above are for the whole bar; the simple one is a third of it, so its title, key and Undo stay on a much
   narrower bar: a note beside More takes 200 px or more of it) */
@container tp (min-width: 480px) and (max-width: 840px) { .ws-simple .tp-g-edit { display: flex; } }
@container tp (min-width: 480px) and (max-width: 810px) { .ws-simple .tp-g-title { display: flex; min-width: 96px; max-width: 200px; } .ws-simple .tp-g-pos { border-left: var(--rule); } }
@container tp (min-width: 480px) and (max-width: 690px) { .ws-simple .tp-g-song { display: flex; } }
/* (and a part just added shows, the note beside More saying so: Loop, Onto and the meter give way later than on the whole bar) */
@container tp (min-width: 640px) and (max-width: 880px) { .ws-simple .tp-loop { display: inline-flex; } .ws-simple .tp-recto { display: flex; } .ws-simple .tp-g-meter { display: flex; } }
@media (max-width: 640px) {
  .ws-simple .ew-shell .tp-g-tempo, .ws-simple .ew-shell .tp-g-song { display: none; }
  .ws-simple .ew-shell .tp-g-edit { display: flex; }
}
`;
