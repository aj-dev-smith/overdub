// Device windows: any instrument or effect opened big, over the studio, to be played with like a real plugin
// (docs/ARCHITECTURE.md, "Device windows"). The rack's faces are right for a chain; a deep instrument needs room.
//
//   app.plugin = {
//     open({ track, slot }, { focus = true, by = 'you' }) -> { ok, error? }   slot: 'instrument' or an insert id;
//                                    track: an id or 'master'. One window at a time: opening another replaces it.
//     close() -> boolean ; current -> { track, slot, device, name, editor } | null
//     editorFor(def) -> the custom editor's name, or null (the generic editor)
//   }
//
// The window. Desktop: a window over the studio, not modal (the transport, the keys and musical typing still work, so
// you play the instrument you're shaping), dragged by its head, sized from its corner; Esc (with the window in use) or
// × closes it; its place and size last the session (ui.state.pluginWin). Under 900 px: a full-height sheet. Its head is
// the device's nameplate in its own colours (def.look) and lamp, the track it's on and who made it ("made by Claude,
// via Jo's link": core/share.js); the bar under it holds the presets (the rack's: app.rack.presetOf, the registry's
// presetParams), A/B (two snapshots of the params; each flip is one undo step, and an undo of a flip flips it back),
// On for an effect (bypass), Code for a kernel (app.rack.openCode), Ask (the agent), what an agent just changed, and a
// live scope and spectrum of the device's output; an instrument has a keyboard along the bottom. The window joins the
// shell's loop through a top-region panel with no face (id 'plugin': the top region is always "visible", so its
// frame(now) runs every frame and does nothing while no window is open). No engine change: the scope taps
// engine.instance(track, slot).output with an AnalyserNode of its own, as engine.voices() does.
//
// ---------------------------------------------------------------------------------------------- custom editors
// A device the studio ships names its editor: def.editor = 'wavetable' loads ui/editors/wavetable.js. Only devices
// whose source is the studio's ('builtin', the Guitar Studio's 'clawd-o-matic', the house shelf's 'library') may name
// one; a song's device (source 'project': a song, a link, a device file, an agent's define_device) gets the generic
// editor whatever it says, so code from a song never decides what UI code runs on the page (docs/SECURITY.md). The
// name is /^[a-z][a-z0-9-]{0,39}$/; an editor that fails to load or to mount falls back to the generic one.
//
//   export function mount(el, ctx) -> { update(evt), frame(now), unmount() }
//     el     the window's body: empty, sized by the window (it scrolls when the editor is taller)
//     ctx = {
//       app, def,                      the app and the device's (normalised) def
//       addr: { track, slot, insert }  where it is (insert = slot, as the auto ops name a lane)
//       params() -> { key: value }     what the device plays now: its params (defaults merged), and on a param whose
//                                      lane plays, the lane's value at the playhead
//       stored() -> { key: value }     its own params, without the lanes
//       set(patch, { gesture, label?, fresh? })   change params, signed you, through the generic controls' own path:
//                                      a hand on a param whose lane plays holds the lane (rack.js controlOps) and the
//                                      first hold says so; while R records, a one-param move is written into its lane
//                                      (input/autorec.js). gesture: 'move' while a drag goes on, 'end' (the default)
//                                      when it lets go: calls on the same params merge into one undo step (the
//                                      store's coalesce), so a drag is one step. fresh: true for a discrete move (a
//                                      patch made or cleared) that is always its own undo step, however soon it follows
//                                      one on the same params; label: what History calls it. -> the dispatch result
//       on(fn) -> off                  fn({ params, keys, by, kind }) on any change to what it plays: yours, an
//                                      agent's, an undo ('undo'), a preset or A/B flip, automation playing ('lane')
//       control(key, { size, kind, label, orient, length }) -> el   a ready control for one param (a knob, a segmented
//                                      switch, a select or a tap key; kind 'slider' for a slider, orient 'v' for a
//                                      fader, length its px): bound to set/on, with the rack's
//                                      automation (right-click: Automate, Back to the lane; "auto" and "held"), and
//                                      flashed when an agent turns it. The generic editor is built from these.
//       param(key) -> spec ; text(key, v) -> '2.4 kHz' ; lane(key) -> { lane, held, note } | null
//       menu(key, anchor)              the control menu, for a custom widget
//       flash(key | el)                the agent-change frame on a control (controls made by control() get it already)
//       isAgent(by) ; byline(by)       for a widget that wants to sign something
//       kit                            ui/plugin-kit.js: knob, slider, toggle, segmented, select, tap, xy, envelope,
//                                      lfo, canvas, meter, keys, menuOn; kit canvases draw from the window's frame
//       keyboard                       the keyboard strip: { el, shown, show(on), range, setRange(lo, hi),
//                                      on(fn({ p, v, on })) -> off, held() }; instruments show it, effects don't
//       meter                          the device's output: { node() -> AnalyserNode | null, level() -> { peak, rms }
//                                      dBFS, scope(Float32Array) -> bool, spectrum(Float32Array) -> bool, sampleRate,
//                                      tap('input' | 'output', { fftSize = 2048, smoothing = 0.7 }) -> AnalyserNode |
//                                      null: one of the editor's own, on the device's input (an effect's) or output, at
//                                      the size it asks; call it each frame (it follows the instance; let go on close) }
//       status(text)                   a line in the window's bar; statusText() what it says now (an editor keeps a
//                                      line of its own up to date only while it is still the one showing)
//     }
//     update(evt)  the same events on() gets, plus { type: 'on', on } (bypass) and { type: 'lanes' } (a lane came, went
//                  or was held); frame(now) once a frame while the window is open and the page visible; unmount() on
//                  close, on another device replacing it, and before a rebuild (a new version of the device).
//     said(keys, by) (optional) what an agent's change to these params did, in words ("drew the volume shape: 3
//                  points"), for the window's line ("Claude drew…"); null leaves the line to the window ("Claude set
//                  Depth to 80%"). For params with no control of their own, like Scribble Strip's points.
//
// ---------------------------------------------------------------------------------------------- agents
// show_device { track, slot, close } opens a device's window for the person (the agent points at what it's changing;
// the window shows its changes live, each control it turns flashed in its colour). It changes nothing in the song.
// Its schema is SHOW_DEVICE_SCHEMA in agent/extra-schemas.js (so Node lists it before a tab connects).

import { h, css, icon, clamp, byline, authorOf, tok } from './dom.js';
import { popover, popoverOpen, controlOps, laneFor, laneNow, laneNote, controlMenu, heldNote, heldSay, backToLane, automate, sentence, quotedName, presetNow, gestureLabel, relabel } from './rack.js';
import { colorsOf } from './faces.js';
import { paramValues, presetParams } from '../devices/registry.js';
import * as kit from './plugin-kit.js';
import * as generic from './editors/generic.js';
import { SHOW_DEVICE_SCHEMA, capText } from '../agent/extra-schemas.js';
import { installTools } from '../agent/tools.js';

export const EDITOR_SOURCES = Object.freeze(['builtin', 'clawd-o-matic', 'library']);
const EDITOR_NAME = /^[a-z][a-z0-9-]{0,39}$/;
// The custom editor a device names, or null for the generic one: only the studio's own devices may name one.
export function editorFor(def) {
  if (!def || typeof def.editor !== 'string' || !EDITOR_NAME.test(def.editor)) return null;
  if (!EDITOR_SOURCES.includes(def.source)) return null;
  return def.editor;
}
const editorCache = new Map();   // name -> Promise<module | null>
function loadEditor(name) {
  if (!editorCache.has(name)) editorCache.set(name, import(`./editors/${name}.js`).then((m) => (m && typeof m.mount === 'function' ? m : null)).catch((e) => { console.warn(`plugin: the ${name} editor did not load (${e.message}); using the generic one`); editorCache.delete(name); return null; }));
  return editorCache.get(name);
}

const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c);
const lumOf = (c) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})/i.exec(c || ''); if (!m) return 0.5;
  let x = m[1]; if (x.length === 3) x = x.split('').map((ch) => ch + ch).join('');
  const [r, g, b] = [0, 2, 4].map((i) => { const v = parseInt(x.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const db = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
const fmtDbShort = (d) => (d <= -90 ? 'silent' : `${d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)} dB`);
let windows = 0;   // (each window's name gets an id of its own, for aria-labelledby)

export default function (app) {
  const { store, ui } = app;
  css('plugin-window', CSS);
  const PHONE = window.matchMedia('(max-width: 900px)');
  const SHORT = window.matchMedia('(max-height: 500px)');
  const phone = () => PHONE.matches;
  let win = null;          // the open window
  let lastOpener = null;   // what had focus when it opened (focus goes back there on close)

  /* ---------------------------------------------------------------- where a device is */
  const findTrack = (ref) => {
    if (ref === 'master') return 'master';
    const p = store.get();
    const t = p.tracks.find((x) => x.id === ref) || p.tracks.find((x) => x.name === ref) || p.tracks.find((x) => String(x.name).toLowerCase() === String(ref || '').toLowerCase());
    return t ? t.id : null;
  };
  function slotOf(track, slot) {
    const p = store.get();
    const t = track === 'master' ? null : p.tracks.find((x) => x.id === track);
    if (track !== 'master' && !t) return null;
    let host = null, index = -1, count = 0;
    if (slot === 'instrument') { if (!t || t.kind !== 'instrument' || !t.instrument) return null; host = t.instrument; }
    else { const list = track === 'master' ? p.master.inserts || [] : t.inserts || []; index = list.findIndex((x) => x.id === slot); host = list[index] || null; count = list.length; if (!host) return null; }
    const devId = host.device;
    return { t, host, devId, index, count, def: app.devices.getDevice(devId), held: app.devices.heldDevice?.(devId) || null, trackName: t ? t.name : 'the master' };
  }

  /* ---------------------------------------------------------------- the loop: a top panel with no face */
  ui.panel({
    id: 'plugin', region: 'top', title: 'Device window',
    mount(el) {
      el.hidden = true;                        // (nothing to draw in the bar: it's here for frame() and update())
      el.setAttribute('aria-hidden', 'true');
      return {
        update(evt) { if (win) { try { win.update(evt); } catch (e) { console.error('plugin: update', e); } } },
        frame(now) {
          if (document.hidden) return;
          if (win) { try { win.frame(now); } catch (e) { console.error('plugin: frame', e); } }
          kit.pump(now);
        },
      };
    },
  });

  /* ---------------------------------------------------------------- open, close */
  function open({ track, slot = 'instrument' } = {}, { focus = true, by = 'you' } = {}) {
    const tId = findTrack(track ?? ui.state.selection.track);
    if (!tId) return { ok: false, error: track == null ? 'no track is selected' : `no track "${track}"` };
    const s = slotOf(tId, slot || 'instrument');
    if (!s) return { ok: false, error: slot === 'instrument' ? 'that track has no instrument' : `no insert "${slot}" on that track` };
    if (s.held) return { ok: false, error: `${s.held.name} is kept off on this computer`, held: true };
    if (!s.def) return { ok: false, error: `${s.devId} isn't loaded here` };
    const same = win && win.addr.track === tId && win.addr.slot === slot && win.def === s.def;
    if (same) { if (focus) win.focus(); return { ok: true, same: true }; }
    if (!win && focus) lastOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    if (win) win.destroy();
    win = makeWindow({ track: tId, slot: slot || 'instrument' }, s, { by });
    // a person opening it is working on that track: musical typing plays it (input.target follows the selection)
    if (by === 'you' && tId !== 'master') ui.select({ track: tId, insert: slot === 'instrument' ? null : slot });
    if (focus) win.focus();
    ui.emit('plugin', { open: true, track: tId, slot, device: s.devId });
    return { ok: true };
  }
  function close({ restore = true } = {}) {
    if (!win) return false;
    const w = win;
    const had = w.el.contains(document.activeElement);
    win = null;
    w.destroy();
    ui.emit('plugin', { open: false });
    if (restore && had) {
      const back = lastOpener && lastOpener.isConnected && lastOpener.getClientRects().length ? lastOpener : null;
      back?.focus({ preventScroll: true });
    }
    lastOpener = null;
    return true;
  }
  app.plugin = {
    open, close, editorFor,
    get current() { return win ? { track: win.addr.track, slot: win.addr.slot, device: win.def.id, name: win.def.name, editor: win.editorName || 'generic' } : null; },
    get el() { return win ? win.el : null; },
  };

  // Esc closes the window while it's what you're using (focus in it; on a phone, whenever it's up), unless something
  // that Esc closes first is open over it (a menu, a popover, the code, the keys sheet), the agent is at work (Esc
  // stops it) or a hum is going. Ahead of musical typing's Esc: the window is the nearer thing.
  const escOk = () => !!win && !app.agent?.busy && !app.input?.hum?.active && !popoverOpen()
    && !document.querySelector('.ek-pop, .ew-pop, .sk-menu, [role=menu], .rk-sheet, .tpk, .snd-card:focus-within, .snd-sheet, [aria-modal=true]:not(.ew-region)')
    && (phone() || ui.state.focus === 'plugin' || win.el.contains(document.activeElement));
  ui.keys.add({ key: 'Escape', first: true, global: true, when: escOk, run: () => close(), label: 'Close the device window', group: 'Devices' });

  // the device it shows changed under it: a new version rebuilds the window, a device gone (or kept off) closes it
  app.devices.onDevices?.(() => {
    if (!win) return;
    const s = slotOf(win.addr.track, win.addr.slot);
    if (!s || !s.def || s.held) { close({ restore: false }); return; }
    if (s.def !== win.def) rebuild();
  });
  function rebuild() {
    if (!win) return;
    const addr = { ...win.addr }, had = win.el.contains(document.activeElement);
    win.destroy();
    win = null;
    const s = slotOf(addr.track, addr.slot);
    if (!s || !s.def || s.held) return;
    win = makeWindow(addr, s, { by: 'you' });
    if (had) win.focus();
  }
  window.addEventListener('resize', () => win?.place());
  PHONE.addEventListener?.('change', () => win?.place());
  SHORT.addEventListener?.('change', () => win?.place());
  ui.on('presence', (list) => win?.presence(list || []));
  // the keys lit by what's played on the track from elsewhere (MIDI, musical typing); input/index.js starts first in
  // MODULES, and again once the studio is up in case it didn't
  let notesHooked = false;
  const hookNotes = () => { if (notesHooked || !app.input?.on) return; notesHooked = true; app.input.on('note', (n) => win?.liveNote(n)); };
  hookNotes();
  ui.on('ready', hookNotes);

  /* ---------------------------------------------------------------- the agent's tool */
  const TOOL = {
    ...SHOW_DEVICE_SCHEMA,
    run: (input, ctx) => showDevice(input || {}, ctx || {}),
  };
  try { installTools(app).register(TOOL); } catch (e) { console.warn('show_device tool', e.message); }
  async function showDevice(input, ctx) {
    if (input.close) {
      const was = win ? `${win.def.name} on ${slotOf(win.addr.track, win.addr.slot)?.trackName || 'its track'}` : null;
      close({ restore: false });
      return was ? { ok: true, closed: was } : { ok: true, closed: null, note: 'No device window was open.' };
    }
    const rec = app.input?.recorder;
    if (rec && rec.state && rec.state !== 'idle') return { error: 'recording', hint: 'the human is recording: show it after the take (get_recording waits for it)' };
    const p = store.get();
    const sel = ui.state.selection || {};
    const ref = input.track ?? sel.track ?? null;
    if (ref == null) return { error: 'which track?', hint: `name a track (id or exact name) or "master": ${p.tracks.map((t) => `${t.id} "${capText(t.name, 60)}"`).join(', ') || 'no tracks yet'}` };
    const tId = findTrack(ref);
    if (!tId) return { error: `no track "${capText(String(ref), 80)}"`, hint: `tracks: ${p.tracks.map((t) => `${t.id} "${capText(t.name, 60)}"`).join(', ') || 'none'}, or "master"` };
    const t = tId === 'master' ? null : store.track(tId);
    const list = tId === 'master' ? p.master.inserts || [] : t.inserts || [];
    const listed = list.map((fx) => `${fx.id} (${capText(app.devices.getDevice(fx.device)?.name || fx.device, 60)})`).join(', ');
    let slot = input.slot ?? input.insert ?? null;
    if (slot == null) slot = input.track == null && sel.insert && list.some((x) => x.id === sel.insert) ? sel.insert : (t && t.kind === 'instrument' && t.instrument ? 'instrument' : list[0]?.id || 'instrument');
    const tn = t ? capText(t.name, 80) : 'the master';
    if (slot === 'instrument' && !(t && t.kind === 'instrument' && t.instrument)) return { error: `${tn} has no instrument${t?.kind === 'audio' ? ' (an audio track)' : ''}`, hint: list.length ? `show one of its effects: ${listed}` : 'it has no effects either' };
    if (slot !== 'instrument' && !list.some((x) => x.id === slot)) return { error: `no insert "${capText(String(slot), 40)}" on ${tn}`, hint: `its inserts: ${listed || 'none'}${t?.instrument ? ', or "instrument"' : ''}` };
    const r = open({ track: tId, slot }, { focus: false, by: ctx.by || 'claude' });
    if (!r.ok) return { error: r.error, hint: r.held ? 'only the person can let a kept-off device play (Play it, in the Devices tab)' : 'get_project lists each track\'s devices' };
    const w = win, def = w.def;
    // (a custom editor loads after the window opens: its sections are read once it's up, a second at the most)
    if (w.editorName) await Promise.race([w.ready, new Promise((r) => setTimeout(r, 1000))]);
    const out = { ok: true, showing: `${def.name} on ${tn}`, track: tId, slot, device: def.id, editor: w.editorName || 'generic' };
    // the sections the window shows, by the names the human sees, with their param keys (a custom editor's too; the
    // params it has no control on screen for come last, by the device's groups, marked shown: false)
    try { out.sections = w.sections(); } catch { out.sections = generic.layout(def).map((sx) => ({ name: sx.name || 'Controls', params: sx.keys })); }
    out.note = 'Its window is open in front of the human. Each control an agent changes flashes there in that agent\'s colour, and the window says what moved.';
    return out;
  }

  /* ================================================================ the window */
  function makeWindow(addr, s0, { by = 'you' } = {}) {
    const { track, slot } = addr;
    const def = s0.def, devId = s0.devId;
    const isInst = slot === 'instrument';
    const name = def.name || devId;
    const specs = new Map((def.params || []).map((p) => [p.key, kit.spec(p)]));
    const editorName = editorFor(def);
    const listeners = new Set();
    const controls = new Map();            // key -> [{ w, kind }]
    let stored = {}, shown = {}, follow = [], marks = new Map(), statusT = 0, alive = true, editor = null, editorKind = 'generic';
    let statusFor = null;   // what the bar's line is about while it shows ('ab': the A/B line, which a change makes stale)
    const laneAddr = (k) => ({ track, insert: slot, param: k });
    const slotNow = () => slotOf(track, slot);
    const storedNow = () => { const s = slotNow(); return s && s.def ? paramValues(def, s.host.params || {}) : stored; };
    // a hand on the controls of an instrument being tried keeps it first (the sound card's "Kept … to change it")
    const keepTrial = () => { if (isInst) { try { app.sounds?.keepIfTrying?.(track, { why: 'control' }); } catch (e) { console.error('plugin: keep the trial', e); } } };

    /* ---- the frame of it */
    const { color, ink } = colorsOf(def);
    const led = isHex(def.look?.led) ? def.look.led : lumOf(color) > 0.5 ? ink : color;
    const el = h('section.pw', { role: 'dialog', 'aria-modal': 'false', tabindex: -1, dataset: { panel: 'plugin', device: devId, track, slot, editor: editorName || 'generic' } });
    el.style.setProperty('--pw-pc', color); el.style.setProperty('--pw-pi', ink); el.style.setProperty('--pw-led', led);
    const nameId = 'pw-name-' + (++windows);
    el.setAttribute('aria-labelledby', nameId);
    const kindWord = def.kindLabel || (def.cat ? String(def.cat) : def.kind);
    const plate = h('div.pw-plate', h('i.pw-led', { 'aria-hidden': 'true' }), h('span.pw-plate-t', h('b.pw-name', { id: nameId }, name), h('small.pw-kind', String(kindWord).toUpperCase())));
    const credit = h('div.pw-credit');
    const playKey = h('button.pw-ib.pw-play', { type: 'button', 'aria-label': 'Play the song', title: 'Play or stop the song (Space)', onclick: () => { try { app.transport?.playStop?.(); } catch { /* no transport */ } } }, icon('play', { size: 18 }));
    const shut = h('button.pw-ib.pw-x', { type: 'button', 'aria-label': `Close ${name} (Esc)`, title: 'Close (Esc)', onclick: () => close() }, icon('x', { size: 18 }));
    const head = h('header.pw-head', plate, credit, playKey, shut);
    const bar = h('div.pw-bar');
    const body = h('div.pw-body');
    const grip = h('button.pw-grip', { type: 'button', 'aria-label': 'Window size: arrow keys make it bigger or smaller', title: 'Drag to resize' });
    grip.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M11 4L4 11M11 8L8 11" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
    el.append(head, bar, body);
    const keysBox = h('div.pw-keys');
    el.append(keysBox, grip);
    (document.querySelector('.ew-shell') || document.body).append(el);

    /* ---- credits: where it is and who made it */
    let creditSig = '';
    function renderCredit() {
      const s = slotNow();
      if (!s) return;
      const where = isInst ? `On ${s.trackName}` : `On ${s.trackName}, effect ${s.index + 1} of ${s.count}`;
      const src = store.get().devices?.[devId];
      const maker = src?.by || def.by, via = src?.via || def.via;
      const sig = JSON.stringify([where, maker, via, maker ? app.store.author?.(maker)?.name : null]);
      if (sig === creditSig) return;
      creditSig = sig;
      const who = [];
      if (maker === 'clawd') who.push('from the Guitar Studio');
      else if (maker && authorOf(maker, app).kind !== 'house') {
        who.push('made by ', byline(maker, { app }));
        if (via && via !== maker) who.push(', via ', byline(via, { app }), '’s link');
      }
      // (what it is, in plain words, for an instrument: "What is Light Table?" answered where it opens)
      const what = isInst && def.blurb ? h('span.pw-what', def.blurb) : null;
      credit.replaceChildren(...[h('span.pw-where', where), what, who.length ? h('span.pw-who', ...who) : null].filter(Boolean));
      credit.title = [def.blurb, def.nod ? `Tips its hat to ${def.nod}.` : ''].filter(Boolean).join(' ');
    }
    renderCredit();

    /* ---- place: where it sits and how big (the session remembers) */
    // Until the person sizes it, the window takes its device's own size (a four-knob pedal small, a deep synth big,
    // as plugin windows do), up to the room there is; once they drag its corner, that size stays for the session.
    const geo = () => (ui.state.pluginWin ||= { x: null, y: 84, w: null, h: null, auto: true });
    // A phone on its side (under 500 px tall): the head is one row, the name, the preset, A and B, On, Code, Ask, play
    // and close; who made it and the scope give way, and the bar under it holds only a line when there's one to say.
    // The device's controls get the rest (Studio A's kit had 133 of 390 px under a head and bar of 257).
    let barItems = null;
    function arrange() {
      if (!barItems) return;
      const short = phone() && SHORT.matches;
      el.classList.toggle('pw-short', short);
      if (short && barItems[0].parentNode !== head) for (const x of barItems) head.insertBefore(x, playKey);
      else if (!short && barItems[0].parentNode !== bar) bar.prepend(...barItems);
    }
    // Until it is dragged somewhere, a window opening keeps clear of the selected track's lane, so you see the take
    // you're shaping and the knobs at once: over the lower half of the arranger when the lane is in the upper half,
    // else the upper. -> { lo, hi, at(height) -> y } or null (no lane on screen, or no room either side: the usual place)
    let spareMax = null;
    function spare() {
      if (track === 'master') return null;
      const row = [...document.querySelectorAll('.ar-head[data-track]')].find((x) => x.dataset.track === track);
      const arr = row?.closest('.ar-main') || document.querySelector('.ar-main');
      if (!row || !arr || !row.getClientRects().length) return null;
      const r = row.getBoundingClientRect(), a = arr.getBoundingClientRect(), vh = window.innerHeight;
      if (r.bottom < a.top || r.top > a.bottom) return null;
      const top = (document.querySelector('.ew-top')?.getBoundingClientRect().bottom || 0) + 8;
      const mid = a.top + a.height / 2;
      // (the room below the lane, or above it: lo..hi; the window goes as near the arranger's middle as it fits)
      if (r.top + r.height / 2 < mid) { const lo = Math.round(r.bottom + 8), hi = vh - 12; return hi - lo >= 240 ? { lo, hi, at: (n) => Math.max(lo, Math.min(Math.round(mid), hi - n)) } : null; }
      const lo = Math.round(top), hi = Math.round(r.top - 8);
      return hi - lo >= 240 ? { lo, hi, at: () => lo } : null;
    }
    function place({ fit = false } = {}) {
      if (!alive) return;
      el.classList.toggle('pw-phone', phone());
      arrange();
      if (phone()) { for (const k of ['left', 'top', 'width', 'height', 'min-width', 'max-width', 'max-height']) el.style.removeProperty(k); return; }
      const g = geo(), vw = window.innerWidth, vh = window.innerHeight;
      // (only when the whole window fits beside the lane: a deep synth that needs the screen takes its usual place)
      let sp = null;
      if (fit && !g.placed) { spareMax = null; sp = g.auto ? spare() : null; if (!sp) g.y = 84; }
      g.y = clamp(g.y ?? 84, 0, Math.max(0, vh - 56));
      if (g.auto) {
        Object.assign(el.style, { width: 'max-content', minWidth: Math.min(680, vw - 16) + 'px', maxWidth: Math.min(1120, vw - 16) + 'px', height: 'auto', maxHeight: Math.max(240, Math.min(spareMax ?? Infinity, vh - g.y - 12)) + 'px' });
      } else {
        g.w = clamp(g.w, Math.min(520, vw - 16), vw - 16); g.h = clamp(g.h, Math.min(300, vh - 16), vh - 16);
        Object.assign(el.style, { width: g.w + 'px', height: g.h + 'px', minWidth: '', maxWidth: '', maxHeight: '' });
      }
      if (sp) { const n = el.scrollHeight; if (n <= sp.hi - sp.lo) { g.y = sp.at(n); spareMax = sp.hi - g.y; el.style.top = g.y + 'px'; el.style.maxHeight = spareMax + 'px'; } }
      const w = el.offsetWidth || g.w || 680;
      if (g.x == null) g.x = Math.round((vw - w) / 2);
      // a window just opened (or rebuilt) is all on screen when it fits; one being dragged keeps 160 px in view
      if (fit && w <= vw - 16) g.x = clamp(g.x, 8, vw - w - 8);
      g.x = clamp(g.x, -(w - 160), vw - 160);
      el.style.left = g.x + 'px'; el.style.top = g.y + 'px';
    }
    place();
    // its size, taken over by hand (the corner, or the arrow keys on it)
    const own = () => { const g = geo(); if (g.auto) { g.auto = false; g.w = el.offsetWidth; g.h = el.offsetHeight; } return g; };
    // drag by the head (not its buttons), from anywhere on it
    head.addEventListener('pointerdown', (e) => {
      if (phone() || e.button !== 0 || e.target.closest('button, a, input, select')) return;
      const g = geo(), x0 = e.clientX, y0 = e.clientY, gx = g.x, gy = g.y;
      head.setPointerCapture(e.pointerId); head.classList.add('pw-dragging');
      const mv = (ev) => { g.x = gx + ev.clientX - x0; g.y = gy + ev.clientY - y0; g.placed = true; spareMax = null; place(); };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); head.classList.remove('pw-dragging'); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    grip.addEventListener('pointerdown', (e) => {
      if (phone() || e.button !== 0) return;
      const g = own(), x0 = e.clientX, y0 = e.clientY, w0 = g.w, h0 = g.h;
      grip.setPointerCapture(e.pointerId);
      const mv = (ev) => { g.w = w0 + ev.clientX - x0; g.h = h0 + ev.clientY - y0; place(); };
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      e.preventDefault(); e.stopPropagation();
    });
    grip.addEventListener('keydown', (e) => {
      const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      const g = own(), st = e.shiftKey ? 64 : 16;
      g.w += d[0] * st; g.h += d[1] * st; place();
    });
    // in use: the shell's ui.state.focus follows the pointer and focus into the window (data-panel), and a person's
    // first touch selects its track, so musical typing plays what's on screen
    const touch = () => { if (track !== 'master' && ui.state.selection.track !== track) ui.select({ track }); };
    el.addEventListener('pointerdown', touch, true);
    el.addEventListener('focusin', () => { if (ui.state.focus !== 'plugin') { ui.state.focus = 'plugin'; ui.emit('focus', 'plugin'); } });
    // a phone's sheet keeps Tab inside it
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !phone()) return;
      const f = [...el.querySelectorAll('button:not([disabled]), select, [tabindex="0"], [href]')].filter((x) => x.getClientRects().length);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });

    /* ---- params: what it plays (lanes over the knobs), and who hears about a change */
    stored = storedNow();
    function effective() {
      const out = { ...stored };
      for (const f of follow) { const v = laneNow(app, f.addr, f.l); if (fin(v)) out[f.key] = v; }
      return out;
    }
    shown = effective();
    const emit = (evt) => {
      for (const fn of [...listeners]) { try { fn(evt); } catch (e) { console.error('plugin: a listener failed', e); } }
      try { editor?.update?.(evt); } catch (e) { console.error('plugin: the editor failed to update', e); }
    };
    function pushValues(keys, by, kind) {
      for (const k of keys) for (const c of controls.get(k) || []) c.w.set(shown[k]);
      if (keys.length) emit({ type: 'params', params: { ...shown }, keys, by, kind });
    }
    // which params follow a playing lane, and which controls say "auto" or "held"
    let lanesSig = null;
    function lanes({ force = false } = {}) {
      const s = slotNow();
      const auto = s?.host?.auto || {};
      follow = [];
      const now = new Map();
      for (const k of Object.keys(auto)) {
        const lane = auto[k];
        if (!lane?.points?.length || !specs.has(k)) continue;
        const held = !!lane.off;
        now.set(k, held ? 'held' : 'auto');
        if (!held) follow.push({ key: k, addr: laneAddr(k), l: laneFor(app, laneAddr(k)) });
      }
      const changed = now.size !== marks.size || [...now].some(([k, v]) => marks.get(k) !== v);
      marks = now;
      // (a control's mark says which bars its lane covers: re-marked when a lane comes, goes, is held or is redrawn)
      const sig = JSON.stringify(Object.keys(auto).map((k) => [k, auto[k]?.off ? 1 : 0, auto[k]?.points?.length || 0, auto[k]?.points?.[0]?.t, auto[k]?.points?.at?.(-1)?.t]));
      if (sig !== lanesSig || force) { lanesSig = sig; for (const [k, list] of controls) for (const c of list) markControl(k, c); }
      return changed;
    }
    function markControl(k, c) {
      const st = marks.get(k) || null, p = specs.get(k);
      if (!c.w.mark) return;
      if (!st) { c.w.mark(null); return; }
      const addr = laneAddr(k), nm = p.label;
      c.w.mark(st, {
        note: laneNote(app, addr, nm),
        title: st === 'held' ? `${sentence(nm)} is held. Click: back to the lane` : `${laneNote(app, addr, nm)}. Click: show the lane`,
        label: st === 'held' ? `${sentence(nm)} is held: back to the lane` : `${sentence(nm)} follows its lane: show it`,
        onClick: () => (st === 'held' ? backToLane(app, addr, nm) : automate(app, addr, nm)),
      });
    }
    lanes();
    shown = effective();

    // A hand on one param or several: one op through the rack's path. One param: its lane (if one plays) is held in
    // the same step (controlOps), the coalesce key is the rack's own ('instrument:<track>:<key>', 'insert:<id>:<key>'),
    // so autorec writes it into its lane while R records and a drag is one undo step. Several: one op, each playing
    // lane held, coalesced under the set of keys.
    function setParams(patch = {}, { gesture = 'end', label = null, fresh = false } = {}) {
      const keys = Object.keys(patch).filter((k) => specs.has(k) && fin(+patch[k]));
      if (!keys.length) return { ok: false, error: `no such param (${Object.keys(patch).join(', ') || 'none given'}); this device has ${[...specs.keys()].join(', ')}` };
      keepTrial();
      const params = {};
      for (const k of keys) params[k] = kit.snap(specs.get(k), +patch[k]);
      const op = isInst ? { type: 'instrument.set', track, params } : { type: 'insert.set', track, insert: slot, patch: { params } };
      let ops;
      if (keys.length === 1) ops = controlOps(app, laneAddr(keys[0]), op);
      else { ops = [op]; if (!app.engine?.recording) for (const k of keys) { const l = laneFor(app, laneAddr(k)); if (l && !l.held) ops.push({ type: 'auto.set', ...laneAddr(k), patch: { off: true } }); } }
      const coalesce = fresh ? null : (isInst ? 'instrument:' + track : 'insert:' + slot) + ':' + keys.slice().sort().join('+');
      // History: the control in words and where it was left ("Light Table: A pos 0.53"), the gesture's one entry
      // relabelled with each move, so it says where the drag ended
      const said = typeof label === 'string' && label ? label.slice(0, 120) : gestureLabel(name, keys.map((k) => ({ label: specs.get(k).label, text: kit.text(specs.get(k), params[k]) })));
      relabel(app, coalesce, said);
      const r = store.dispatch(ops, { by: 'you', coalesce, label: said });
      const k0 = keys[0], p0 = specs.get(k0), v0 = kit.text(p0, params[k0]);
      if (r.ok && ops.length > 1) heldNote(app, laneAddr(k0), p0.label, v0, { later: gesture !== 'end' });
      else if (gesture === 'end') heldSay(app, v0);
      return r;
    }

    /* ---- a control for one param, bound */
    function control(key, { size = 52, kind = null, label = null, orient = 'h', length = 160 } = {}) {
      const p = specs.get(key);
      if (!p || p.hidden) return null;
      const onInput = (v, { commit }) => setParams({ [key]: v }, { gesture: commit ? 'end' : 'move' });
      const onMenu = (anchor) => controlMenu(app, anchor, laneAddr(key), { name: p.label, can: p.auto !== false });
      const segFits = p.opts && p.opts.length <= 5 && p.opts.join('').length <= 26;
      const k = kind || (p.opts ? (segFits ? 'segmented' : 'select') : p.tap ? 'tap' : 'knob');
      const v = shown[key] ?? p.def;
      let w;
      if (k === 'knob') w = kit.knob(p, { value: v, size, name, label, onInput, onMenu });
      else if (k === 'slider') w = kit.slider(p, { value: v, name, label, onInput, onMenu, orient, length });
      else if (k === 'segmented') w = kit.segmented(p, { value: v, name, label, onChange: (i) => setParams({ [key]: i }) });
      else if (k === 'select') w = kit.select(p, { value: v, name, label, onChange: (i) => setParams({ [key]: i }) });
      else if (k === 'tap') w = kit.tap(p, { value: v, name, onInput: (x) => setParams({ [key]: x }) });
      else return null;
      if (w.menuTarget) kit.menuOn(w.menuTarget, (anchor, e) => onMenu(e && e.clientX != null ? e : anchor));
      w.el.dataset.key = key;
      const c = { w, kind: k };
      if (!controls.has(key)) controls.set(key, []);
      controls.get(key).push(c);
      markControl(key, c);
      return w.el;
    }

    /* ---- the agent's change: the control flashes in its ink, the bar says what moved */
    let flashes = [];
    function flash(target) {
      const els = typeof target === 'string' ? (controls.get(target) || []).map((c) => c.w.el) : target ? [target] : [];
      for (const x of els) { x.classList.remove('pk-flash'); void x.offsetWidth; x.classList.add('pk-flash'); flashes.push({ el: x, until: performance.now() + 1700 }); }
    }
    function status(words, { ms = 6000, about = null } = {}) {
      clearTimeout(statusT);
      statusFor = about;
      statusEl.replaceChildren(...(Array.isArray(words) ? words : [words]).filter((x) => x != null && x !== ''));
      statusEl.classList.toggle('on', !!statusEl.childNodes.length);
      if (ms) statusT = setTimeout(() => { statusEl.replaceChildren(); statusEl.classList.remove('on'); statusFor = null; }, ms);
    }
    function agentSaid(by, keys) {
      const nm = (k) => sentence(specs.get(k).label);
      if (keys.length === 1) status([byline(by, { app, cap: true }), ` set ${nm(keys[0])} to ${kit.text(specs.get(keys[0]), shown[keys[0]])}.`]);
      else status([byline(by, { app, cap: true }), ` moved ${keys.length} controls: ${keys.slice(0, 4).map(nm).join(', ')}${keys.length > 4 ? '…' : ''}.`]);
    }

    /* ---- the bar: presets, A/B, on, code, ask, what changed, the output */
    const preBtn = h('button.pw-pre-n', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openPresets() });
    const prev = h('button.pw-key', { type: 'button', 'aria-label': 'Previous preset', title: 'Previous preset', onclick: () => stepPreset(-1) }, icon('chevron', { size: 14 }));
    const next = h('button.pw-key', { type: 'button', 'aria-label': 'Next preset', title: 'Next preset', onclick: () => stepPreset(1) }, icon('chevron', { size: 14 }));
    prev.querySelector('svg').style.transform = 'scaleX(-1)';
    const presets = h('div.pw-pre', { role: 'group', 'aria-label': `${name} presets` }, h('span.pw-lbl', 'Preset'), prev, preBtn, next);
    const abA = h('button.pw-key.pw-ab-b', { type: 'button', 'aria-pressed': 'true', onclick: () => flip('A') }, 'A');
    const abB = h('button.pw-key.pw-ab-b', { type: 'button', 'aria-pressed': 'false', onclick: () => flip('B') }, 'B');
    const abCopy = h('button.btn.btn-txt.pw-ab-copy', { type: 'button', onclick: () => copyAB() }, 'Copy A to B');
    const ab = h('div.pw-ab', { role: 'group', 'aria-label': 'Compare A and B' }, abA, abB, abCopy);
    const onTog = isInst ? null : kit.toggle({ label: 'On', name, title: 'On, or bypassed (the sound passes through)', onChange: (on) => { const r = store.dispatch({ type: 'insert.set', track, insert: slot, patch: { on } }, { by: 'you', label: `${name} ${on ? 'on' : 'off'}` }); if (!r.ok) ui.toast(r.error, { kind: 'bad' }); } });
    const codeBtn = typeof def.kernel === 'string' ? h('button.btn.btn-txt.pw-code', { type: 'button', title: 'Its kernel source, read-only', onclick: () => app.rack?.openCode?.(devId) }, 'Code') : null;
    const askBtn = h('button.btn.ew-btn-agent.pw-ask', { type: 'button', title: 'Describe a sound; the agent tunes this device', onclick: () => { const s = slotNow(); ui.emit('agent:compose', { text: `${quotedName(name)} on ${quotedName(s?.trackName || 'the master')}: `, attach: { track, device: devId } }); } }, icon('agent', { size: 14 }), 'Ask');
    // the sound card for this track (trying another instrument rebuilds this window onto it: what you see is what you
    // hear), and the effects after it, in the Devices tab
    const soundsBtn = isInst && track !== 'master' && app.sounds ? h('button.btn.btn-txt.pw-sounds', { type: 'button', title: 'Hear this track on other instruments', onclick: (e) => app.sounds?.offer?.({ track, from: 'window', anchor: e.currentTarget }) }, 'Sounds') : null;
    const fxBtn = track !== 'master' ? h('button.btn.btn-txt.pw-fx', { type: 'button', title: `The effects on ${s0.trackName}, in the Devices tab`, onclick: () => { ui.select({ track, insert: isInst ? null : slot }); ui.show('rack'); } }, 'Effects') : null;
    // a keyed device (def.key: Dim Switch): which track it hears beside its own input (its key, insert.set { key })
    const keyPick = !isInst && def.key === true && track !== 'master'
      ? h('select.pw-keypick', { 'aria-label': `${name}: the track it ducks under (its key)`, title: 'The track it listens to: it ducks under that track\'s sound', onchange: (e) => setKey(e.currentTarget.value) })
      : null;
    const keyBox = keyPick ? h('label.pw-key-to', h('span.pw-lbl', 'Key'), keyPick) : null;
    let keySig = '';
    function syncKey() {
      if (!keyPick) return;
      const p = store.get(), me = (p.tracks || []).find((t) => t.id === track), fx = me && me.inserts.find((x) => x.id === slot);
      const cur = fx && fx.key ? fx.key.track : '';
      const others = (p.tracks || []).filter((t) => t.id !== track);
      const gone = cur && !others.some((t) => t.id === cur);
      const sig = cur + '|' + others.map((t) => t.id + ':' + t.name).join(',');
      if (sig === keySig) return;
      keySig = sig;
      keyPick.replaceChildren(h('option', { value: '' }, 'No key'), ...others.map((t) => h('option', { value: t.id }, t.name)), ...(gone ? [h('option', { value: cur }, 'Key track missing')] : []));
      keyPick.value = cur;
    }
    function setKey(id) {
      const r = store.dispatch({ type: 'insert.set', track, insert: slot, patch: { key: id ? { track: id } : null } }, { by: 'you', label: `${name}: key` });
      if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); keySig = ''; syncKey(); return; }
      const t = id && (store.get().tracks || []).find((x) => x.id === id);
      ui.announce?.(t ? `${name} ducks under ${t.name}` : `${name} has no key`);
    }
    const statusEl = h('p.pw-status');
    const peakEl = h('span.pw-peak', { 'aria-hidden': 'true' }, 'silent');
    const scopeCv = kit.canvas({ className: 'pw-scope', label: `${name}'s output: scope and spectrum` });
    const live = h('div.pw-live', { title: 'What it sends out: the spectrum, with the wave over it' }, h('span.pw-lbl', 'Output'), scopeCv.el, peakEl);
    // the studio's notes while the window is open, when there's no room for them beside it (ui.dockToasts: a phone's
    // window always): a line of the bar, so a note never sits over the controls
    const toastBox = h('div.pw-toasts', { role: 'status', 'aria-live': 'polite' });
    barItems = [presets, ab, ...[onTog?.el, keyBox, codeBtn, askBtn, soundsBtn, fxBtn].filter(Boolean)];
    bar.append(...barItems, statusEl, toastBox);
    head.insertBefore(live, playKey);
    arrange();

    // presets: the rack's names (rack.js presetNow: "Felt", "Felt, edited", the nearest preset a sound is plainly a
    // version of, "Default" at the defaults, else "Custom"), the registry's params
    function presetState() {
      return presetNow(app, track, slot) || { name: null, label: 'Custom', edited: false };
    }
    let preSig = '';
    function syncPresets() {
      const st = presetState(), sig = `${st.label}|${st.edited}`;
      const has = !!def.presets?.length;
      prev.disabled = next.disabled = !has;
      if (sig === preSig) return;
      preSig = sig;
      preBtn.replaceChildren(...[h('span.pw-pre-l', st.label), st.edited ? h('span.pw-pre-e', ', edited') : null, icon('down', { size: 12 })].filter(Boolean));
      preBtn.dataset.preset = st.name || '';
      preBtn.dataset.edited = st.edited ? '1' : '';
      preBtn.setAttribute('aria-label', `${name} preset: ${st.label}${st.edited ? ', edited' : ''}. Choose a preset`);
    }
    function applyPreset(pname) {
      keepTrial();
      const params = pname === null ? Object.fromEntries((def.params || []).map((p) => [p.key, p.def])) : presetParams(def, pname);
      if (!params) return { ok: false };
      const op = isInst ? { type: 'instrument.set', track, params } : { type: 'insert.set', track, insert: slot, patch: { params } };
      const r = store.dispatch(op, { by: 'you', label: pname === null ? `${name}: defaults` : `${name}: ${pname}` });
      if (!r.ok) ui.toast(r.error, { kind: 'bad' }); else ui.announce?.(pname === null ? `${name}: every control at its default` : `${name}: ${pname}`);
      return r;
    }
    function stepPreset(d) {
      const list = def.presets || [];
      if (!list.length) return;
      const st = presetState();
      const i = list.findIndex((x) => x.name === st.name);
      const j = i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length;
      if (i === j && !st.edited) return;
      applyPreset(list[j].name);
    }
    let prePop = null;
    function openPresets() {
      if (prePop) { prePop.close(); return; }
      const st = presetState();
      const rows = (def.presets || []).map((pr) => {
        const on = st.name === pr.name;
        return h('button.rk-pi' + (on ? '.sel-print' : ''), { type: 'button', role: 'menuitemradio', 'aria-checked': on && !st.edited ? 'true' : 'false', dataset: { preset: pr.name }, onclick: () => { prePop?.close(); applyPreset(pr.name); } },
          h('span', pr.name), on && st.edited ? h('small', 'edited: pick it to go back to it') : pr.blurb ? h('small', pr.blurb) : null);
      });
      rows.push(h('button.rk-pi.pw-pi-def', { type: 'button', role: 'menuitem', onclick: () => { prePop?.close(); applyPreset(null); } }, h('span', 'Defaults'), h('small', 'every control back to where it starts')));
      const menu = h('div.rk-presets', { role: 'menu', 'aria-label': `${name} presets` }, h('div.rk-pcat', def.presets?.length ? `${name} presets` : `${name} has no presets`), rows);
      menu.addEventListener('keydown', (e) => {
        const i = rows.indexOf(document.activeElement);
        const j = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : e.key === 'ArrowUp' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : null;
        if (j == null) return;
        e.preventDefault(); e.stopPropagation(); rows[j].focus();
      });
      preBtn.setAttribute('aria-expanded', 'true');
      prePop = popover(preBtn, menu, { label: `${name} presets`, onClose: () => { preBtn.setAttribute('aria-expanded', 'false'); prePop = null; } });
      (rows.find((r) => r.classList.contains('sel-print')) || rows[0])?.focus({ preventScroll: true });
    }

    // A/B: two snapshots of the params, in the session (ui.state.pluginAB, per device on its slot). The side you're on
    // is the song; the other is kept here. A flip puts the other side's params in, one undo step (B's first visit
    // starts as a copy of A: nothing changes); an undo or redo of a flip flips the letter with it.
    const abKey = `${track}:${slot}:${devId}`;
    const AB = () => ((ui.state.pluginAB ||= {})[abKey] ||= { on: 'A', A: null, B: null, flips: [] });
    const syncAB = () => {
      const st = AB();
      for (const [b, k] of [[abA, 'A'], [abB, 'B']]) { const on = st.on === k; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('sel-print', on); b.setAttribute('aria-label', on ? `${k}: playing now` : `${k}: ${st[k] ? 'hear it' : 'start it as a copy of ' + st.on}`); }
      abCopy.textContent = `Copy ${st.on} to ${st.on === 'A' ? 'B' : 'A'}`;
    };
    // (how many controls A and B set apart: what the line says after a flip)
    const differ = (a = {}, b = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => specs.has(k) && Math.abs((a[k] ?? specs.get(k).def) - (b[k] ?? specs.get(k).def)) > 1e-9).length;
    function flip(to) {
      const st = AB();
      if (st.on === to) return;
      keepTrial();
      const from = st.on;
      st[from] = { ...stored };
      if (!st[to]) { st[to] = { ...stored }; st.on = to; syncAB(); status(`${to} starts as a copy of ${from}. Change it, then flip back to compare.`, { about: 'ab' }); return; }
      const params = { ...st[to] };
      const same = Object.keys(params).every((k) => Math.abs((params[k] ?? 0) - (stored[k] ?? 0)) <= 1e-9);
      st.on = to;
      if (!same) {
        const op = isInst ? { type: 'instrument.set', track, params } : { type: 'insert.set', track, insert: slot, patch: { params } };
        const r = store.dispatch(op, { by: 'you', label: `${name}: ${to}` });
        if (!r.ok) { st.on = from; ui.toast(r.error, { kind: 'bad' }); }
        else st.flips.push({ txn: r.txn?.id, from, to });
        if (st.flips.length > 64) st.flips.splice(0, st.flips.length - 64);
      }
      syncAB();
      // the line says where the flip landed, and how far apart the two are now (the copy's line said it before any change)
      const n = differ(st.A, st.B);
      if (st.on === to) status(n ? `${to} now: ${n} control${n === 1 ? ' differs' : 's differ'} from ${from}.` : `${to} now: the same as ${from} so far.`, { about: 'ab' });
      ui.announce?.(`${name}: ${st.on}`);
    }
    function copyAB() {
      const st = AB(), other = st.on === 'A' ? 'B' : 'A';
      st[other] = { ...stored };
      syncAB();
      status(`${other} is now a copy of ${st.on}.`, { about: 'ab' });
    }
    function abFollow(evt) {
      const st = ui.state.pluginAB?.[abKey];
      if (!st?.flips?.length) return;
      if (evt.kind === 'undo') {
        const gone = new Set([evt.txn?.id, ...(evt.reverted || []).map((x) => x.id)].filter(Boolean));
        for (let i = st.flips.length - 1; i >= 0; i--) if (gone.has(st.flips[i].txn)) { st.on = st.flips[i].from; st.flips[i].undone = true; }
      } else if (evt.kind === 'redo') {
        const f = st.flips.find((x) => x.txn === evt.txn?.id && x.undone);
        if (f) { st.on = f.to; f.undone = false; }
      }
      syncAB();
    }
    syncAB();

    /* ---- the output: a scope over a spectrum, and the level, from the device's own output */
    const tapS = { inst: null, an: null, t: null, f: null, level: { peak: -120, rms: -120 }, at: -1, quietSince: 0 };
    function analyser() {
      const ac = app.engine?.ctx;
      if (!ac || !alive) return null;
      let inst = null;
      try { inst = app.engine.instance?.(track, slot) || null; } catch { inst = null; }
      if (inst !== tapS.inst) {
        if (tapS.inst && tapS.an) { try { tapS.inst.output.disconnect(tapS.an); } catch { /* gone */ } }
        tapS.inst = null;
        if (inst?.output) {
          if (!tapS.an || tapS.an.context !== ac) { tapS.an = ac.createAnalyser(); tapS.an.fftSize = 2048; tapS.an.smoothingTimeConstant = 0.7; tapS.t = new Float32Array(2048); tapS.f = new Float32Array(1024); }
          try { inst.output.connect(tapS.an); tapS.inst = inst; } catch { tapS.inst = null; }
        }
      }
      return tapS.inst ? tapS.an : null;
    }
    function readLevel(now) {
      if (tapS.at === now) return tapS.level;
      tapS.at = now;
      const an = analyser();
      if (!an) { tapS.level = { peak: -120, rms: -120 }; return tapS.level; }
      an.getFloatTimeDomainData(tapS.t);
      let pk = 0, sq = 0;
      for (let i = 0; i < tapS.t.length; i++) { const v = tapS.t[i], a = v < 0 ? -v : v; if (a > pk) pk = a; sq += v * v; }
      tapS.level = { peak: db(pk), rms: db(Math.sqrt(sq / tapS.t.length)) };
      return tapS.level;
    }
    // an editor's own taps (meter.tap): the device's input (an effect's) or its output, at the FFT size it needs;
    // reconnected when the instance changes, let go of on close
    const taps = new Map();
    function tap(which = 'output', { fftSize = 2048, smoothing = 0.7 } = {}) {
      const ac = app.engine?.ctx;
      if (!ac || !alive) return null;
      let inst = null;
      try { inst = app.engine.instance?.(track, slot) || null; } catch { inst = null; }
      const node = (inst && (which === 'input' ? inst.input : inst.output)) || null;
      const key = `${which}:${fftSize}:${smoothing}`;
      let t = taps.get(key);
      if (!t) { t = { an: null, node: null }; taps.set(key, t); }
      if (t.node && t.node !== node) { try { t.node.disconnect(t.an); } catch { /* gone */ } t.node = null; }
      if (!node) return null;
      if (!t.an || t.an.context !== ac) { t.an = ac.createAnalyser(); t.an.fftSize = fftSize; t.an.smoothingTimeConstant = smoothing; }
      if (t.node !== node) { try { node.connect(t.an); t.node = node; } catch { return null; } }
      return t.an;
    }
    const meterApi = {
      node: () => analyser(),
      level: () => readLevel(performance.now()),
      scope(buf) { const an = analyser(); if (!an) { buf.fill(0); return false; } an.getFloatTimeDomainData(buf); return true; },
      spectrum(buf) { const an = analyser(); if (!an) { buf.fill(-120); return false; } an.getFloatFrequencyData(buf); return true; },
      tap: (which, o) => tap(which, o),
      get sampleRate() { return app.engine?.ctx?.sampleRate || 48000; },
    };
    const inks = { text: tok('--text') || '#f4ead6', t3: tok('--text-3') || '#9a8f7c', line: tok('--line') || '#2f2b25', line2: tok('--line-2') || '#46413a' };
    let liveOn = false;
    scopeCv.set({
      animate: () => liveOn,
      draw: (g, { w, h: hh }) => {
        const an = analyser();
        g.strokeStyle = inks.line2; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(hh / 2) + 0.5); g.lineTo(w, Math.round(hh / 2) + 0.5); g.stroke();
        if (!an) return;
        // the spectrum, 30 Hz to 18 kHz on a log axis, as a pencil fill
        an.getFloatFrequencyData(tapS.f);
        const sr = an.context.sampleRate, n = tapS.f.length, lo = Math.log(30), hi = Math.log(18000);
        g.fillStyle = inks.line2; g.beginPath(); g.moveTo(0, hh);
        for (let x = 0; x <= w; x += 2) {
          const f = Math.exp(lo + (hi - lo) * (x / w)), bin = clamp(Math.round((f / (sr / 2)) * n), 1, n - 1);
          const y = hh - clamp((tapS.f[bin] + 100) / 80, 0, 1) * hh;
          g.lineTo(x, y);
        }
        g.lineTo(w, hh); g.closePath(); g.fill();
        // the wave over it, from a rising zero crossing so it stands still
        an.getFloatTimeDomainData(tapS.t);
        let z = 0; for (let i = 1; i < tapS.t.length / 2; i++) if (tapS.t[i - 1] < 0 && tapS.t[i] >= 0) { z = i; break; }
        const span = Math.min(tapS.t.length - z, 1024);
        g.strokeStyle = inks.text; g.lineWidth = 1.25; g.beginPath();
        for (let x = 0; x <= w; x++) { const v = tapS.t[z + Math.floor((x / w) * (span - 1))] || 0; const y = hh / 2 - clamp(v, -1, 1) * (hh / 2 - 1); if (x) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      },
    });

    /* ---- the keyboard (instruments) */
    const kbListeners = new Set();
    let kb = null, kbShown = false, oct = phone() ? 60 : 48;
    const octLabel = h('span.pw-oct-l');
    const octDown = h('button.pw-key', { type: 'button', 'aria-label': 'Octave down', title: 'Octave down', onclick: () => shiftOct(-12) }, icon('chevron', { size: 14 }));
    octDown.querySelector('svg').style.transform = 'scaleX(-1)';
    const octUp = h('button.pw-key', { type: 'button', 'aria-label': 'Octave up', title: 'Octave up', onclick: () => shiftOct(12) }, icon('chevron', { size: 14 }));
    // musical typing, from here: the home row plays this track (` does the same anywhere); a lamp, lit while it's on
    const qwBtn = h('button.tog.pw-qw', { type: 'button', title: 'Play it from the computer keys: A S D F… (` turns it on or off anywhere)', onclick: () => { try { if (ui.state.selection.track !== track && track !== 'master') ui.select({ track }); app.input?.qwerty?.toggle?.(); } catch (e) { console.error(e); } paintQw(); } }, 'Computer keys');
    const paintQw = () => qwBtn.setAttribute('aria-pressed', String(!!app.input?.qwerty?.on));
    paintQw();
    const offQw = app.input?.on?.('qwerty', paintQw) || null;
    const offMode = app.input?.on?.('mode', paintQw) || null;
    const octBox = h('div.pw-oct', octDown, octLabel, octUp);
    const span = () => (phone() ? 12 : body.clientWidth > 900 ? 48 : body.clientWidth > 640 ? 36 : 24);
    function setKbRange() {
      if (!kb) return;
      const n = span();
      oct = clamp(oct, 12, 127 - n);
      kb.setRange(oct, oct + n);
      octLabel.textContent = `${kit.noteName(oct)} to ${kit.noteName(oct + n)}`;
      octDown.disabled = oct <= 12; octUp.disabled = oct + n >= 120;
    }
    function shiftOct(d) { oct += d; setKbRange(); }
    const s0t = s0.t;
    const keyboard = {
      get el() { return keysBox; },
      get shown() { return kbShown; },
      show(on = true) {
        on = !!on && !!s0t && s0t.kind === 'instrument' && !!s0t.instrument;
        if (on === kbShown) return;
        kbShown = on;
        if (on && !kb) {
          kb = kit.keys({ lo: oct, hi: oct + span(), label: `Keyboard: plays ${name} on ${s0.trackName}. Click or drag; lower on a key is louder`, onNote: (p, v, isOn) => {
            try { if (isOn) app.engine.liveNoteOn(track, p, v); else app.engine.liveNoteOff(track, p); } catch { /* no audio yet */ }
            for (const fn of [...kbListeners]) { try { fn({ p, v, on: isOn }); } catch (e) { console.error(e); } }
          } });
          // (the lamp at the keyboard's right end: beside it, so the window grows no taller)
          keysBox.replaceChildren(octBox, kb.el, qwBtn);
          setKbRange();
        }
        if (!on && kb) kb.clear();
        keysBox.hidden = !on;
        el.classList.toggle('pw-has-keys', on);
      },
      get range() { return kb ? kb.range : { lo: oct, hi: oct + span() }; },
      setRange(lo, hi) { if (!kb) return; oct = lo; kb.setRange(lo, hi); octLabel.textContent = `${kit.noteName(lo)} to ${kit.noteName(hi)}`; },
      on(fn) { kbListeners.add(fn); return () => kbListeners.delete(fn); },
      held: () => (kb ? kb.held() : []),
    };
    keysBox.hidden = true;
    keyboard.show(isInst);
    const kbRo = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (kb && kb.range.hi - kb.range.lo !== span()) setKbRange(); }) : null;
    kbRo?.observe(body);

    /* ---- the editor */
    const ctx = {
      app, def, addr: { track, slot, insert: slot },
      params: () => ({ ...shown }),
      stored: () => ({ ...stored }),
      set: (patch, o) => setParams(patch, o),
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      control,
      param: (k) => specs.get(k) || null,
      text: (k, v) => (specs.has(k) ? kit.text(specs.get(k), v ?? shown[k]) : String(v)),
      lane: (k) => { const l = laneFor(app, laneAddr(k)); return l ? { lane: l.lane, held: l.held, note: laneNote(app, laneAddr(k), specs.get(k)?.label || k) } : null; },
      menu: (k, anchor) => controlMenu(app, anchor, laneAddr(k), { name: specs.get(k)?.label || k, can: specs.get(k)?.auto !== false }),
      flash,
      isAgent: (b) => !!store.isAgent?.(b),
      byline: (b) => byline(b, { app }),
      kit,
      keyboard,
      meter: meterApi,
      status: (t) => status(t),
      statusText: () => statusEl.textContent,
    };
    function mountEditor(mod, kind) {
      body.replaceChildren();
      controls.clear();
      try {
        editor = mod.mount(body, ctx) || {};
        editorKind = kind;
      } catch (e) {
        console.warn(`plugin: the ${kind} editor failed to mount (${e.message}); using the generic one`);
        if (mod !== generic) { mountEditor(generic, 'generic'); return; }
        editor = {};
        body.append(h('div.empty', h('p', `This device's controls failed to draw: ${e.message}`)));
      }
      el.dataset.editor = editorKind;
      lanes({ force: true });
      place({ fit: true });
    }
    mountEditor(generic, 'generic');
    let ready = Promise.resolve();
    if (editorName) {
      el.dataset.editor = 'loading';
      ready = loadEditor(editorName).then((mod) => {
        if (!alive) return;
        if (mod) { try { editor?.unmount?.(); } catch (e) { console.error(e); } mountEditor(mod, editorName); }
        else el.dataset.editor = 'generic';
      });
    }
    // What the window shows, for an agent (show_device): sections with their param keys. The generic editor's are its
    // layout; a custom editor's are read from the window itself (each control's nearest named section: Light Table's
    // "Mod matrix", Studio A's mic mix), and any param it has no control on screen for follows, by the device's groups.
    const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // a section's name as a screen reader hears it: its aria-label, what aria-labelledby points at, or its heading
    const nameOf = (a) => {
      const l = (a.getAttribute('aria-label') || '').trim();
      if (l) return l;
      const ids = a.getAttribute('aria-labelledby');
      const by = ids ? ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim() : '';
      return by || (a.querySelector(':scope > :is(h2, h3, h4), :scope > header :is(h2, h3, h4)')?.textContent || '').trim();
    };
    function sections() {
      const gen = generic.layout(def).map((sx) => ({ name: sx.name || 'Controls', params: sx.keys }));
      if (editorKind === 'generic') return gen;
      const genOf = new Map(gen.flatMap((s) => s.params.map((k) => [k, s.name])));
      const own = new RegExp(`^${escRe(name)}[:,]?\\s+`, 'i');
      const by = new Map(), seen = new Set();
      for (const c of body.querySelectorAll('[data-key]')) {
        const k = c.dataset.key;
        if (!specs.has(k) || seen.has(k)) continue;
        seen.add(k);
        let sec = null;
        for (let a = c.parentElement; a && a !== body && !sec; a = a.parentElement) {
          if (a.matches('.pk-ctl') || !a.matches('section, fieldset, [role=region], [role=group], [role=tabpanel]')) continue;
          const lab = nameOf(a);
          if (lab) sec = lab.replace(own, '').replace(/^./, (x) => x.toUpperCase());
        }
        sec = sec || genOf.get(k) || 'Controls';
        if (!by.has(sec)) by.set(sec, []);
        by.get(sec).push(k);
      }
      const rest = gen.map((s) => ({ name: s.name, params: s.params.filter((k) => !seen.has(k)) })).filter((s) => s.params.length);
      return [...[...by].map(([n, params]) => ({ name: n, params })), ...rest.map((s) => ({ ...s, shown: false }))];
    }

    /* ---- the on switch, presets, credits: in step with the song */
    function syncOn() {
      const s = slotNow();
      const on = isInst ? true : s?.host?.on !== false;
      onTog?.set(on);
      el.classList.toggle('pw-off', !on);
      return on;
    }
    let wasOn = syncOn();
    syncPresets();
    syncKey();
    // toasts keep clear of the window while it's open (ui/shell.js): beside it, or in its bar
    const undock = ui.dockToasts?.({ el, box: toastBox }) || null;

    /* ---- presence: an agent pointing at this device */
    let presEl = null;
    function presence(list) {
      presEl?.remove(); presEl = null;
      const pr = (list || []).find((x) => x.track === track && (x.insert === slot || (isInst && x.instrument)));
      if (!pr) return;
      presEl = h('div.crop.pw-pres', h('i'), h('i'), h('i'), h('i'), h('span', `${app.store.author?.(pr.by)?.name || pr.by}${pr.note ? ': ' + pr.note : ''}`));
      plate.append(presEl);
    }
    presence(ui.state.presence || []);

    /* ---- the window's own lifecycle */
    function update(evt) {
      if (!alive) return;
      if (evt.kind === 'load') { close({ restore: false }); return; }
      app.rack?.notePresets?.(evt);   // (what each slot was last on, before the preset line reads it: once per change)
      const s = slotNow();
      if (!s || s.devId !== devId) {
        if (!s) { close({ restore: false }); ui.announce?.(`${name} is gone; its window closed`); return; }
        // (rebuilt once the task is over: a sound on trial let go and kept in one task leaves the window as it was,
        // and a knob being turned keeps its drag)
        if (!swapSoon) { swapSoon = true; queueMicrotask(() => { swapSoon = false; if (!alive) return; const s2 = slotNow(); if (!s2) { close({ restore: false }); return; } if (s2.devId !== devId) rebuild(); else update(evt); }); }
        return;
      }
      if (!s.def || s.held) { close({ restore: false }); return; }
      if (s.def !== def) { rebuild(); return; }
      if (evt.kind === 'undo' || evt.kind === 'redo') abFollow(evt);
      const lanesMoved = lanes();
      const before = stored;
      stored = paramValues(def, s.host.params || {});
      const next = effective();
      const keys = Object.keys(next).filter((k) => next[k] !== shown[k] || stored[k] !== before[k]);
      shown = next;
      // (the A/B line was about the sides before this change: it goes, and the next flip says where things stand)
      if (statusFor === 'ab' && keys.some((k) => stored[k] !== before[k])) status('');
      pushValues(keys, evt.by, evt.kind);
      if (lanesMoved) emit({ type: 'lanes' });
      const on = syncOn();
      if (on !== wasOn) { wasOn = on; emit({ type: 'on', on }); }
      syncPresets();
      syncKey();
      renderCredit();
      if (evt.kind === 'do' && store.isAgent?.(evt.by)) {
        const changed = keys.filter((k) => stored[k] !== before[k]);
        for (const k of changed) flash(k);
        let words = null;
        if (changed.length && typeof editor?.said === 'function') { try { words = editor.said(changed, evt.by); } catch { words = null; } }
        if (typeof words === 'string' && words) status([byline(evt.by, { app, cap: true }), ` ${words}`]);
        else if (changed.length) agentSaid(evt.by, changed);
        if (!isInst && (evt.ops || []).some((o) => o.type === 'insert.set' && o.insert === slot && o.patch && 'on' in o.patch) && onTog) { flash(onTog.el); status([byline(evt.by, { app, cap: true }), on ? ' switched it on.' : ' bypassed it.']); }
      }
    }
    let lastLv = -1, liveAt = 0, swapSoon = false;
    function frame(now) {
      if (!alive) return;
      if (flashes.length) flashes = flashes.filter((f) => { if (now > f.until) { f.el.classList.remove('pk-flash'); return false; } return true; });
      // knobs on playing lanes turn with the song
      if (follow.length) {
        const keys = [];
        for (const f of follow) { const v = laneNow(app, f.addr, f.l); if (fin(v) && v !== shown[f.key]) { shown[f.key] = v; keys.push(f.key); } }
        if (keys.length) pushValues(keys, null, 'lane');
      }
      // the output: read at ~30 Hz; the scope animates while there's sound or the song plays
      if (now - liveAt > 33) {
        liveAt = now;
        const lv = readLevel(now);
        const playing = !!app.engine?.playing;
        if (lv.peak > -90) tapS.quietSince = now;
        liveOn = playing || now - tapS.quietSince < 600;
        const x = clamp((lv.rms + 54) / 54, 0, 1);
        if (Math.abs(x - lastLv) > 0.02) { lastLv = x; el.style.setProperty('--pw-lv', x.toFixed(2)); }
        const txt = fmtDbShort(lv.peak);
        if (peakEl.textContent !== txt) peakEl.textContent = txt;
        playKey.setAttribute('aria-pressed', String(playing));
        playKey.classList.toggle('on', playing);
      }
      try { editor?.frame?.(now); } catch (e) { console.error('plugin: the editor failed to draw', e); editor.frame = null; }
    }
    function liveNote(n) {
      if (!kb || !n || n.track !== track) return;
      kb.light(n.p, !!n.on);
    }
    function destroy() {
      if (!alive) return;
      alive = false;
      clearTimeout(statusT);
      prePop?.close();
      try { editor?.unmount?.(); } catch (e) { console.error('plugin: the editor failed to unmount', e); }
      editor = null;
      kb?.destroy();
      kbRo?.disconnect();
      try { offQw?.(); offMode?.(); } catch { /* ok */ }
      scopeCv.destroy();
      if (tapS.inst && tapS.an) { try { tapS.inst.output.disconnect(tapS.an); } catch { /* gone */ } }
      for (const t of taps.values()) if (t.node && t.an) { try { t.node.disconnect(t.an); } catch { /* gone */ } }
      taps.clear();
      listeners.clear(); kbListeners.clear();
      try { undock?.(); } catch { /* the shell's own */ }
      el.remove();
    }
    return {
      el, addr, def, editorName, ready, sections,
      get editorKind() { return editorKind; },
      update, frame, destroy, place, presence, liveNote,
      focus() { el.focus({ preventScroll: true }); if (ui.state.focus !== 'plugin') { ui.state.focus = 'plugin'; ui.emit('focus', 'plugin'); } },
      ctx,
    };
  }
}

/* ================================================================ styles */
const CSS = `
/* the device window (ui/plugin.js): a floating sheet on the second ground, square, one shadow (it floats) */
.pw { position: fixed; z-index: 700; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--panel); color: var(--text); border: var(--rule-2); border-radius: 0; box-shadow: var(--shadow-2); outline: none; animation: pw-in .16s var(--ease) both; }
@keyframes pw-in { from { opacity: 0; transform: translateY(6px); } }
.pw-head { flex: none; display: flex; align-items: center; gap: 14px; min-width: 0; padding: 10px 10px 10px 12px; border-bottom: var(--rule); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; contain: inline-size; }
.pw-head.pw-dragging { cursor: grabbing; }
/* the nameplate: the device's own colours and its lamp, the name in the display face, the kind in mono beneath */
.pw-plate { position: relative; flex: none; display: inline-flex; align-items: center; gap: 10px; max-width: min(46%, 380px); min-height: 46px; padding: 6px 16px 6px 12px; background: var(--pw-pc); color: var(--pw-pi); }
.pw-plate-t { display: grid; min-width: 0; }
.pw-name { font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 112%; font-variation-settings: 'wdth' 112; font-size: 21px; line-height: 1.05; letter-spacing: -.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pw-kind { font: 600 9.5px/1.3 var(--font-mono); letter-spacing: .06em; opacity: .78; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pw-led { flex: none; width: 9px; height: 9px; border-radius: 50%; background: color-mix(in srgb, var(--pw-led) 22%, #121110); box-shadow: inset 0 1px 1px rgba(0,0,0,.5); }
.pw:not(.pw-off) .pw-led { background: var(--pw-led); box-shadow: 0 0 calc(2px + 9px * var(--pw-lv, 0)) color-mix(in srgb, var(--pw-led) 70%, transparent); }
/* (who made it keeps its room: the scope beside it gives way first) */
.pw-credit { flex: 1 0 auto; display: grid; gap: 1px; min-width: 0; max-width: 360px; font-size: 12.5px; line-height: 1.35; color: var(--text-2); }
.pw-where, .pw-who, .pw-what { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pw-what { color: var(--text-2); }
.pw-who { color: var(--text-3); }
.pw-ib { display: inline-grid; place-items: center; flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: var(--r-press); background: transparent; color: var(--text-3); cursor: pointer; }
.pw-ib:hover { background: var(--bg-3); color: var(--text); }
.pw-ib:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.pw-play { display: none; }
.pw-play.on { color: var(--accent); }
/* the bar: presets, A/B, on, code, ask, what changed, the output */
/* (the head, the bar and the keys take the window's width; only the editor sizes it) */
.pw-bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; min-width: 0; padding: 8px 12px; border-bottom: var(--rule); contain: inline-size; }
.pw-lbl { margin-right: 6px; font-size: 12px; color: var(--text-3); }
.pw-pre, .pw-ab, .pw-oct { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.pw-key { display: inline-grid; place-items: center; min-width: 28px; height: 28px; padding: 0 6px; border: var(--rule-2); border-radius: var(--r-press); background: none; color: var(--text-2); font: 700 12.5px/1 var(--font-mono); cursor: pointer; }
.pw-key:hover:not(:disabled) { border-color: var(--text-3); color: var(--text); }
.pw-key:disabled { color: var(--line-2); border-color: var(--line); cursor: default; }
.pw-key:focus-visible, .pw-pre-n:focus-visible, .pw-grip:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.pw-key.sel-print, .pw-key.sel-print:hover:not(:disabled) { background: var(--text); border-color: var(--text); color: var(--bg); }
.pw-pre-n { display: inline-flex; align-items: center; gap: 0; min-width: 0; max-width: 240px; height: 28px; padding: 0 4px; border: 0; background: none; color: var(--text); font: 600 13px/1 var(--font-ui); cursor: pointer; }
.pw-pre-l { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; }
.pw-pre-n:hover .pw-pre-l, .pw-pre-n[aria-expanded="true"] .pw-pre-l { text-decoration-color: var(--text); }
.pw-pre-e { flex: none; color: var(--text-3); font-weight: 400; white-space: nowrap; }
.pw-pre-n .ico { margin-left: 4px; color: var(--text-3); }
.pw-ab-copy { font-size: 12px; }
.pw-key-to { display: inline-flex; align-items: center; min-width: 0; }
.pw-keypick { max-width: 180px; height: 28px; padding: 0 6px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--bg); color: var(--text); font: 600 13px/1 var(--font-ui); }
.pw-keypick:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.pw-sounds, .pw-fx { font-size: 12px; }
.pw-status { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 12.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the studio's notes, when there's no room for them beside the window (ui/shell.js keeps them clear of it): a ruled
   line of the bar, its action an underlined word, never over a control */
.pw-toasts { flex: 1 1 100%; order: 20; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pw-toasts:empty { display: none; }
.pw .pw-toasts .ew-toast { min-height: 0; padding: 6px 0 0; border: 0; border-top: var(--rule); border-radius: 0; background: none; box-shadow: none; font-size: 12.5px; animation: none; }
.pw .pw-toasts .ew-toast-act { min-height: 24px; }
.pw-live { flex: 0 1 300px; display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; margin-left: auto; cursor: default; }
.pw-live .pw-scope { flex: 0 1 184px; width: 184px; min-width: 48px; height: 30px; }
.pw-peak { min-width: 58px; font: 400 11.5px/1 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-3); text-align: right; white-space: nowrap; }
.pw-off .pw-scope { opacity: .45; }
.pw-body { position: relative; flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.pw-off .pw-body { filter: saturate(.6); }
/* the keyboard along the bottom */
.pw-keys { flex: none; display: flex; align-items: stretch; gap: 10px; padding: 10px 12px 12px; border-top: var(--rule); contain: inline-size; }
.pw-keys[hidden] { display: none; }
.pw-keys .pk-keys { flex: 1; height: 68px; }
/* the octave: ‹ › over the range it plays */
.pw-oct { display: grid; grid-template-columns: auto auto; align-content: center; gap: 6px 4px; }
.pw-oct-l { grid-column: 1 / -1; grid-row: 2; font: 400 11px/1.2 var(--font-mono); color: var(--text-3); white-space: nowrap; text-align: center; }
.pw-qw { flex: none; align-self: center; white-space: nowrap; font-size: 11.5px; }
.pw-phone .pw-qw, .pw-short .pw-qw { display: none; }
@media (pointer: coarse) { .pw-qw { display: none; } }
.pw-grip { position: absolute; right: 0; bottom: 0; display: grid; place-items: end; width: 18px; height: 18px; padding: 0 2px 2px 0; border: 0; background: none; color: var(--text-3); cursor: nwse-resize; }
.pw-grip svg { display: block; }
.pw-pres { inset: -3px; }
.pw-pres > span { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
/* the rack's way in: Open on a device's caption */
.rk-open { flex: none; height: 20px; padding: 0 3px; border: 0; background: none; color: var(--text-2); font: 600 11.5px/1 var(--font-ui); text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; cursor: pointer; }
.rk-open:hover { color: var(--text); text-decoration-color: var(--text-3); }
.rk-open:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
@media (pointer: coarse) { .ew-shell .rk-open { min-width: 44px; min-height: 44px; } }
@media (max-width: 900px) { .ew-shell .rk-open { font-size: 12px; } }
/* a phone (under 900 px): a full-height sheet; 44 px keys, 12 px text at the least */
.pw.pw-phone { inset: 0; width: auto; height: auto; border: 0; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); animation: pw-up .22s var(--ease) both; }
@keyframes pw-up { from { opacity: 0; transform: translateY(24px); } }
.pw-phone .pw-head { cursor: default; flex-wrap: wrap; gap: 8px 10px; padding: 8px 8px 8px 12px; }
.pw-phone .pw-plate { max-width: calc(100% - 100px); }
.pw-phone .pw-credit { order: 5; flex-basis: 100%; max-width: none; font-size: 12.5px; }
.pw-phone .pw-play { margin-left: auto; }
.pw-phone .pw-ib { width: 44px; height: 44px; }
.pw-phone .pw-play { display: inline-grid; }
.pw-phone .pw-kind { font-size: 12px; letter-spacing: .03em; }
.pw-phone .pw-bar { gap: 8px 10px; padding: 8px 12px; }
.pw-phone .pw-key { min-width: 44px; height: 44px; font-size: 13px; }
.pw-phone .pw-pre { flex: 1 1 100%; }
.pw-phone .pw-pre-n { flex: 1; max-width: none; height: 44px; justify-content: center; font-size: 14px; }
.pw-phone .pw-lbl { display: none; }
.pw-phone .btn, .pw-phone .tog { height: 44px; min-height: 44px; min-width: 44px; font-size: 13px; }
.pw-phone .pw-ab-copy { min-height: 44px; font-size: 12.5px; }
.pw-phone .pw-status { flex-basis: 100%; order: 9; font-size: 12.5px; }
.pw-phone .pw-live { order: 6; flex: 1 1 100%; margin: 0; }
.pw-phone .pw-live .pw-scope { flex: 1 1 auto; width: auto; min-width: 0; height: 36px; }
.pw-phone .pw-peak { font-size: 12px; min-width: 64px; }
.pw-phone .pw-keys { flex-direction: column; gap: 8px; padding: 8px 12px 12px; }
.pw-phone .pw-keys .pk-keys { flex: none; height: 96px; }
.pw-phone .pw-oct { display: flex; flex-direction: row; justify-content: space-between; }
.pw-phone .pw-oct-l { font-size: 12px; }
.pw-phone .pk-key-w { min-width: 44px; }
.pw-phone .pw-grip { display: none; }
.pw-phone .pk-dial { width: max(var(--pk-size, 52px), 60px); height: max(var(--pk-size, 52px), 60px); }
.pw-phone .pk-l, .pw-phone .pk-v, .pw-phone .pk-am, .pw-phone .pk-key-n { font-size: 12px; }
.pw-phone .pk-am { min-height: 44px; min-width: 44px; }
/* a phone on its side (arrange(): under 500 px tall): the head is one row (the name, the preset, A and B, On, Code,
   Ask, play, close); who made it and the scope give way; the bar shows only a line there is to say */
.pw-short .pw-head { flex-wrap: nowrap; gap: 8px; padding: 4px 8px 4px 10px; }
.pw-short .pw-plate { flex: 0 1 auto; max-width: 28%; min-height: 40px; padding: 4px 12px 4px 10px; }
.pw-short .pw-name { font-size: 17px; }
.pw-short .pw-kind, .pw-short .pw-credit, .pw-short .pw-live, .pw-short .pw-pre > .pw-key, .pw-short .pw-ab-copy { display: none; }
.pw-short .pw-pre { flex: 0 1 auto; min-width: 0; }
.pw-short .pw-pre-n { flex: 0 1 auto; max-width: 200px; }
.pw-short .pw-head > .btn, .pw-short .pw-head > .tog { flex: none; }
.pw-short .pw-play { margin-left: auto; }
.pw-short .pw-bar { padding: 4px 12px; }
.pw-short .pw-bar:not(:has(.pw-status.on, .pw-toasts > *)) { display: none; }
/* (and the keyboard is one row: the octave keys beside a shorter strip of keys, so the device keeps the height) */
.pw-short .pw-keys { flex-direction: row; align-items: stretch; gap: 8px; padding: 4px 10px 6px; }
.pw-short .pw-keys .pk-keys { flex: 1 1 auto; height: 60px; }
.pw-short .pw-oct { flex: none; flex-direction: row; align-items: center; }
.pw-short .pw-oct-l { display: none; }
`;
