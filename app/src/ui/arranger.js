// The arranger [ui-arrange]: the song laid out in time. Track headers (DOM), a ruler with sections and the loop, and
// clip lanes on one canvas. Everything it changes goes through store.dispatch(..., { by: 'you' }); a drag is one
// transaction, committed on release. It is set in the Liner notes look (design/LINER-NOTES-KIT.md): a clip is a
// track-colour fill with a label line (its name, and the byline of whoever played it: you, or the agent; the house is
// unsigned); selected prints the label in reverse inside a cream frame; muted is a dashed outline with the name struck
// and "muted" where the byline was; an agent pointing (ui.state.presence) gets grease-pencil crop marks with its note,
// and a part just arriving gets crop marks in its author's ink. No stripes, no glows.
//
//   click a clip: select (shift: add)       drag: move (alt: copy; across tracks too)     edges: resize
//   double-click a lane: new 4-bar clip     double-click a clip: open it in Notes / Beat  drag empty: select bars
//   a dropped clip (moved or copied) takes the beats it covers on its track: what lies under it there is cut away, in
//   the same undo step (core/arrangement.js planDropTrim; a take folder under it is cut across all its takes). A take
//   folder moves whole (every take in it goes along); on a comped folder a drag across the body selects bars and the
//   label line moves it
//   Delete: remove · mod+D: duplicate after (a selected section: it and its clips) · S: split the selected clip at the
//   playhead · 0: mute / unmute the selected clips (a muted clip stays, in outline with its name struck, and plays
//   nowhere: live, render, export; the first mute says so in a toast with the key) · mod+wheel / pinch: zoom · alt+wheel: track height
//   the start marker (app.transport.marker): click a bar on the ruler or in a lane (shift: on the snap grid, or free)
//   and Space plays from there; selecting bars puts it at the first one. Drag the ruler to scrub. It is drawn on the
//   ruler as its bar number printed in reverse, apart from the playhead (leader green). Stopping with Follow on brings
//   the view back to it
//   the loop strip: a drag draws a new loop, the loop's middle (its grip, the thicker stretch) moves it, its ends resize
//   it, a click turns it on or off; L with bars selected loops them (L alone: the transport's loop on / off)
//   a finger: a drag on anything in the lanes or the headers scrolls; a hold on a clip or a track opens its menu (Mute,
//   Split, Trim...) and picks it up, so a drag from there moves it (the first hold says so)
//   a song opens at the top, fitted (4 bars at least); a take that grows the song is shown whole
//   a clip's menu also trims it (or the selection) to the loop; its edges trim it by hand (they light up on hover)
//   recording (input/recorder.js, live()): the take's region grows in record ink on the lanes it records onto, with
//   what lands in it drawn as it lands (notes, hits in four drum rows, the mic's peaks, the hum's trace); the count-in
//   numeral over the target lane; the punch line on the ruler's loop. Clicking a track header selects and arms it (the
//   recorder's target; its R lit without track.arm); ⌘-click (or ⌘ on R) arms one more; R alone arms on purpose.
//   The armed header shows its input along its bottom edge. Take folders (clip.take): what plays is drawn with a
//   "3 takes" badge, the muted takes are hidden; ⌘↑ / ⌘↓ switch the take in the selected stretch; the clip menu's
//   Takes… lists them (flatten, delete). The badge (or ⌥T) opens the folder: a lane per take under the clip, and a
//   drag across a take's lane plays that take there (comping: core/arrangement.js planTakeComp, one undo step), a
//   click plays it in the stretch under the pointer; the folder's own row is the comp. ⌘E splits every take in it
//   right-click, or touch and hold: the clip / track / section menu (repeat, split; duplicate, insert or delete bars:
//   core/arrangement.js, one undo step each)
//   keyboard (the lanes focused): ←/→ the previous / next clip on the track, ↑/↓ the track above / below, Enter opens
//   it, F2 renames it, Shift+F10 or the menu key opens its menu (and the section under it); each move is announced
//   keyboard (the section strip focused, the Tab stop over the lanes): ←/→ the previous / next section (Home, End the
//   first and last) and its bars selected, F2 renames it, Shift+F10 or the menu key opens its menu (duplicate, insert
//   bars after, delete these bars), mod+D duplicates it, Delete removes the section (not its clips)
//   automation lanes (lanes.js; docs/research/AUTOMATION.md 3.7): under their track, one row per automated param.
//   E (or the header's A key) shows or hides the selected track's lanes; the track menu's Automation… lists them and
//   adds one (Level, Pan, any knob). The rows are one layout (rows(): a track's row, then its open lanes) that drawing,
//   hit-testing, the headers, locate() and presence all read. Moving, Alt-copying or duplicating clips takes the lanes
//   under them along (core/arrangement.js followClips; "Lanes follow clips" in the Automation menu, overdub:arrange)
//
// Others can call app.arranger = { reveal(beat), zoomTo(from, to), selectedClips(), locate(clientX, clientY), takes(clip),
// useTake(clip), stepTake(dir), flattenTakes(clip), deleteTake(clip), takeLanes(clip, on?), takeRows(), comp(clip, from, to),
// armed(), recView(),
// showLane(trackId, { insert?, param }) (a knob's Automate), toggleLanes(trackId, on?), hideLane(trackId, addr),
// laneRows(), laneY(key, value), laneSel(), selectLaneRange(...), laneShape(trackId, addr, shape, from, to), shapes(),
// lanesFollow(on?), recLanes([{ track, insert?, param, from, to }]) (the lanes being written, in record ink; while R
// records the arranger also reads app.input.autorec.writes()) }.

import { h, css, icon, canvas, clamp, byline } from './dom.js';
import {
  palette, resolveColor, rgba, authorKind, authorName, authorColor, isDrumTrack, deviceName, touched, flasher,
  presenceList, drawCrop, drawLabel, bylineOf, displayFont, snapTo, floorTo, SNAPS, snapLabel, menu, popover, closePopover, MOD, showAgent, touchFirst,
} from './arrange-kit.js';
import {
  planSectionDuplicate, planTimeInsert, planTimeRemove, planClipRepeat, planClipSplit, planClipTrim, spanLabel, whereLabel, followClips, takeFolders, takeNumber,
  planTakeComp, planTakeLaneDelete, planTakesFlatten, retake, barBeat, barBeatSpan, planDropTrim,
} from '../core/arrangement.js';
import { laneKey, laneAt, lanesOf, valueAt, toPos, laneView } from '../core/automation.js';
import { DEVICE_CATS } from '../devices/registry.js';
import * as rackKit from './rack.js';
import { newPartFor } from '../core/sounds.js';
import {
  LANE_H, LANE_H_PHONE, laneState, trackLanes, shownLanes, laneParams, laneInfo, staticValue, fmtValue, drawLaneRow, laneHead,
  laneEditor, laneKeysOn, SHAPES, laneHeight, setLaneHeight, heightsSig, masterTrack, tipHide, laneSigners,
} from './lanes.js';

const HEAD_W = 244;
const RULER_H = 50;          // sections 0..20, loop 20..32, bars 32..50
const SEC_Y = 0, SEC_H = 20, LOOP_Y = 20, LOOP_H = 12, BAR_Y = 32;
const SECTION_NAMES = ['Intro', 'Verse', 'Chorus', 'Verse 2', 'Chorus 2', 'Bridge', 'Chorus 3', 'Outro', 'Coda'];
const DEVICE_MIME = 'application/x-overdub-device';

export default function (app) {
  css('arranger', CSS);
  app.ui.panel({ id: 'arranger', region: 'center', title: 'Arrange', icon: 'panelBottom', order: 0, mount: (el) => mountArranger(el, app) });
}

// Touch and hold: fire(pt) after `ms` with the finger still (within `slop` px). iOS Safari never sends contextmenu
// for a long press on ordinary elements, so the menus need their own; where the platform does send one (Android,
// Chromium) whichever comes first wins and the other is swallowed.

export function longPress(el, fire, { ms = 500, slop = 8, filter = null } = {}) {
  let timer = 0, x0 = 0, y0 = 0, id = null, firedAt = -1e9;
  const clear = () => { clearTimeout(timer); timer = 0; };
  el.addEventListener('pointerdown', (e) => {
    clear();
    if (e.pointerType !== 'touch' || (filter && !filter(e))) return;
    x0 = e.clientX; y0 = e.clientY; id = e.pointerId;
    const target = e.target;
    timer = setTimeout(() => { timer = 0; firedAt = performance.now(); fire({ clientX: x0, clientY: y0, pointerId: id, target }); }, ms);
  }, true);
  el.addEventListener('pointermove', (e) => { if (timer && e.pointerId === id && Math.hypot(e.clientX - x0, e.clientY - y0) > slop) clear(); }, true);
  el.addEventListener('pointerup', (e) => { if (e.pointerId === id) clear(); }, true);
  el.addEventListener('pointercancel', (e) => { if (e.pointerId === id) clear(); }, true);
  el.addEventListener('contextmenu', (e) => {
    if (timer) { clear(); return; }                                           // the platform's came first: it opens
    if (performance.now() - firedAt < 1500) { e.preventDefault(); e.stopImmediatePropagation(); }   // ours already did
  }, true);
}

function nextSectionName(p) {
  const used = new Set(p.sections.map((s) => s.name.toLowerCase()));
  return SECTION_NAMES.find((n) => !used.has(n.toLowerCase())) || `Part ${p.sections.length + 1}`;
}

// The welcome's credits, from the song: [what, by] rows. The house's parts come first and are unsigned (by null);
// then each person's who isn't you (whoever sent a link: their parts, and a device they made, "and the Tape Organ
// itself"), the sender first; then each agent's parts (and a device it built, "and the Firefly itself"), signed; then
// yours, in Sketch. A song from someone else's link always names who sent it, parts or none.
function credits(pr, app) {
  const list = (names) => (names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} more`] : names).reduce((s, n, i, a) => s + (i ? (i === a.length - 1 ? ' and ' : ', ') : '') + n, '');
  const kindOf = (by) => authorKind(app, by);
  const guest = (by) => !!by && by !== 'you' && kindOf(by) === 'human';
  const house = [], people = new Map(), agents = new Map();
  const row = (m, by) => { if (!m.has(by)) m.set(by, { tracks: [], devices: [] }); return m.get(by); };
  for (const t of pr.tracks) {
    if (!t.clips.length) continue;
    const by = t.clips.find((c) => kindOf(c.by) === 'agent')?.by || (kindOf(t.by) === 'agent' && t.clips.every((c) => kindOf(c.by) !== 'human') ? t.by : null);
    if (by) row(agents, by).tracks.push(t.name);
    else if (t.clips.every((c) => kindOf(c.by) === 'house')) house.push(t.name);
    else {
      // a part someone else played (a link's sender, an earlier guest): whoever played most of its clips
      const n = new Map();
      for (const c of t.clips) { const b = c.by || t.by; if (guest(b)) n.set(b, (n.get(b) || 0) + 1); }
      const top = [...n].sort((a, b) => b[1] - a[1])[0];
      if (top) row(people, top[0]).tracks.push(t.name);
    }
    // (a device kept off on this computer isn't registered: its name is the song's)
    const dev = t.instrument?.device, def = dev && (app.devices?.getDevice?.(dev) || app.devices?.heldDevice?.(dev));
    if (def && (kindOf(def.by) === 'agent' || guest(def.by))) {
      const ds = row(kindOf(def.by) === 'agent' ? agents : people, def.by).devices;
      if (!ds.includes(def.name)) ds.push(def.name);
    }
  }
  const line = (a) => {
    const parts = a.tracks.length ? list(a.tracks) : '';
    const devs = a.devices.length ? `${parts ? ', and ' : ''}the ${list(a.devices)} ${a.devices.length === 1 ? 'itself' : 'themselves'}` : '';
    return `${parts}${devs}`;
  };
  const rows = [];
  if (house.length) rows.push([`${list(house)} came with the song.`, null]);
  // whoever sent the link first, named even with no part of their own in it
  const sender = app.share?.listening && !app.share.incoming?.own ? app.share.incoming?.guest : null;
  if (sender && !people.has(sender)) rows.push(['Sent you the song', sender]);
  for (const [by, a] of [...people].sort((x, y) => (y[0] === sender) - (x[0] === sender))) rows.push([line(a), by]);
  for (const [by, a] of agents) rows.push([line(a), by]);
  if (!agents.size) rows.push(['What you ask the agent for', 'claude']);
  rows.push(['Your takes, in Sketch', 'you', 'sketch']);
  return rows;
}

function mountArranger(el, app) {
  const { store, engine, ui, music } = app;
  const P = () => store.get();
  const bpbOf = () => music.beatsPerBar(P().meter);
  const zoom = ui.state.zoom;
  zoom.pxPerBeat = zoom.pxPerBeat || 28;
  zoom.trackH = zoom.trackH || 64;

  /* ======================================================= DOM */
  // the tools are words (underlined, like a credit you can press), Follow is a toggle lamp, zoom is two glyphs
  const addBtn = h('button.btn.btn-txt.ar-tool.ar-add', { title: 'Add a track: an instrument, drums or audio', onclick: () => addTrackMenu(addBtn) }, 'Add a track');
  const snapBtn = h('button.btn.btn-txt.ar-tool', { title: 'Snap: where clips and notes land (hold shift while dragging to ignore it)', onclick: () => menu(snapBtn, [{ head: 'Snap to' }, ...SNAPS.map(([v, l]) => ({ label: l, sub: Math.abs(ui.state.snap - v) < 1e-6 ? '●' : '', run: () => { ui.state.snap = v; ui.emit('snap', v); syncBar(); } }))]) });
  const zoomOut = h('button.ar-tool.ar-ico', { title: `Zoom out (${MOD}scroll or pinch)`, onclick: () => zoomBy(1 / 1.4) }, icon('minus', { size: 14 }));
  const zoomIn = h('button.ar-tool.ar-ico', { title: `Zoom in (${MOD}scroll or pinch)`, onclick: () => zoomBy(1.4) }, icon('plus', { size: 14 }));
  const fitBtn = h('button.btn.btn-txt.ar-tool', { title: 'Fit the whole song in view', onclick: () => fitSong() }, 'Fit');
  const followBtn = h('button.tog.ar-tool.ar-follow', { title: 'Follow the playhead while playing', onclick: () => { follow = !follow; syncBar(); } }, 'Follow');
  const hint = h('div.ar-hint');
  // (the simple view puts the whole toolbar away, as Track tools: ui/workspace.js)
  const bar = h('div.ar-bar', { dataset: { feature: 'tracks' } }, addBtn, h('div.ar-sep'), snapBtn, h('div.ar-zoom', zoomOut, zoomIn), fitBtn, followBtn, h('div.ar-flex'), hint);

  const secAdd = h('button.ar-secadd', { dataset: { feature: 'tracks' }, title: 'Add a section (Verse, Chorus…) after the last one', onclick: () => addSection() }, icon('plus', { size: 12 }));
  const corner = h('div.ar-corner',
    h('div.ar-corner-row.ar-c-sec', h('span', 'Sections'), secAdd),
    h('div.ar-corner-row.ar-c-loop', h('span', { dataset: { feature: 'loop' } }, 'Loop')),
    h('div.ar-corner-row.ar-c-bar', h('span', 'Bars')));
  const ruler = canvas('ar-ruler');
  // the section strip is a Tab stop: arrows pick a section (keys below), so a keyboard reaches what a click on it does
  const rulerWrap = h('div.ar-rulerwrap', { tabindex: 0, role: 'application', 'aria-roledescription': 'section strip',
    'aria-label': `Sections. Left and right arrows pick one and select its bars, F2 renames it, Shift+F10 opens its menu, ${MOD}D duplicates it.` }, ruler.cv);
  const headsInner = h('div.ar-heads-inner');
  const heads = h('div.ar-heads', headsInner);
  const lanes = canvas('ar-lanes');
  const spacer = h('div.ar-spacer');
  const scroller = h('div.ar-scroll', { tabindex: 0, role: 'application', 'aria-roledescription': 'arrangement', 'aria-label': 'Arrangement: clips on tracks over time. Arrow keys move between clips, Enter opens one, F2 renames it, Shift+F10 opens its menu (and the section under it). The section strip above takes the arrow keys too.' }, spacer);
  const said = h('p.sr-only', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  const playhead = h('div.ar-playhead');
  const dropHi = h('div.ar-drop', { hidden: true });
  // the ghost lane: where R's take goes when it makes a new track (or the new track a take's sound card previews), a
  // dashed frame at the foot of the tracks; not a track, nothing selects it
  const ghostLane = h('div.ar-ghostlane', { hidden: true, 'aria-hidden': 'true' });
  const empty = h('div.ar-empty', { hidden: true });
  const laneWrap = h('div.ar-lanewrap', lanes.cv, scroller, playhead, ghostLane, dropHi, empty);
  const main = h('div.ar-main', corner, rulerWrap, heads, laneWrap);
  const root = h('div.ar', bar, main, said);
  el.append(root);

  /* a one-time welcome on a first visit, over the quiet corner of the lanes (clicks pass through it): a printed insert
     slipped into the sleeve. It names the song and gives the credits as a dot-leader list: the house's parts unsigned,
     each agent's parts over its byline in cool ink, your takes over yours in warm. Its main action is Make your own (a
     new song of yours and the first minute on it: a beat, then a tune, app.onboard.ownSong); hearing this one stays one
     click (or Space) away, beside the tour and the agent. It stays up while the song plays (so Make your own is still
     there after a listen); the first take you keep or the first edit puts it away, as does another song. */
  (function welcome() {
    const KEY = 'overdub:welcomed';
    // (never in the simple view: its first screen is the blank sheet, and Night Shift is one link on it. Marked as
    // seen all the same: a song switched to the full studio later isn't introduced as if it were the demo)
    try { if (localStorage.getItem(KEY) === '1') return; localStorage.setItem(KEY, '1'); } catch (e) { return; }
    if (app.ui.workspace?.view?.() === 'simple') return;
    const pr = app.store.get();
    if (!pr.tracks.length) return;
    const offs = [];
    const close = () => { for (const o of offs.splice(0)) { try { o?.(); } catch (e) { /* ok */ } } if (!card.isConnected || card.classList.contains('out')) return; card.classList.add('out'); setTimeout(() => card.remove(), 220); };
    const tour = () => { close(); if (!app.onboard?.start?.({ force: true, restart: true })) app.ui.toast('The tour is still loading'); };
    // the main action: the first minute (docs/research/RECORDING-UX.md 3.3) as Take one's first steps.
    // app.onboard.firstMinute('tap') owns the flow (a Drums track, a 2-bar loop, the click, Sketch on Tap it, the loop
    // running, "Press R and tap along"); without it, the tour starts on its take step with the drums selected (armed)
    // and Tap it open.
    const tapIn = () => {
      close();
      const ob = app.onboard;
      if (typeof ob?.firstMinute === 'function') { ob.firstMinute('tap'); return; }
      if (!ob?.start?.({ force: true, restart: true })) { app.ui.toast('The tour is still loading'); return; }
      if (ob.step === 'listen') ob.skip?.();
      const drums = app.store.get().tracks.find((t) => isDrumTrack(app, t));
      if (drums) app.ui.select({ track: drums.id, clip: null, notes: [] });
      if (app.ui.panels.has('sketch')) { app.ui.show('sketch'); app.input?.emit?.('sketch:mode', 'tap'); }
    };
    const own = () => { close(); if (typeof app.onboard?.ownSong === 'function') app.onboard.ownSong(); else tapIn(); };
    const hear = async () => { const en = app.engine || engine; if (!en || en.playing) return; try { await en.start?.(); await en.play(app.transport?.marker?.beat || 0); } catch (e) { app.ui.toast('Could not play: ' + e.message, { kind: 'bad' }); } };
    void tapIn;
    const agent = () => { if (!showAgent(app.ui)) app.ui.toast('The agent panel is loading'); };
    const sketch = () => { if (app.ui.panels.has('sketch')) app.ui.show('sketch'); else app.ui.toast('Sketch is still loading'); };
    // a guitarist's way in: the Jam room, beside Arrange (ui/jam.js)
    const jam = () => { if (!app.ui.panels.has('jam')) { app.ui.toast('The Jam room is still loading'); return; } close(); app.ui.show('jam'); };
    const card = h('div.ar-welcome.paper', { role: 'note', 'aria-label': 'Welcome' },
      // (first in the card: a first tap on "the first button" puts it away)
      h('button.btn.btn-txt.ar-welcome-x', { type: 'button', title: 'Put this away', onclick: close }, 'Got it'),
      h('h3.ar-welcome-h.disp', 'This is ', pr.title || 'your song', '.'),
      h('ul.ar-credits', credits(pr, app).map(([what, by, link]) => (by
        ? h('li', h('span.ar-cr-what', link === 'sketch' ? ['Your takes, in ', h('button.ar-link', { type: 'button', onclick: sketch }, 'Sketch')] : what),
          h('span.ar-cr-lead', { 'aria-hidden': 'true' }), byline(by, { app }))
        : h('li.ar-cr-house', what)))),
      h('div.ar-welcome-acts',
        h('button.btn.ar-welcome-own', { type: 'button', onclick: own, title: `A new song of your own: a beat, then a tune over it. “${pr.title || 'This song'}” goes to Recent songs.` }, 'Make your own'),
        h('span.ar-welcome-own-s', 'a beat and a tune in two minutes')),
      h('div.ar-welcome-acts.ar-welcome-more',
        // hearing this one: one click (a finger has no Space bar, so a touch-first screen says tap)
        h('button.ar-link.ar-welcome-hear', { type: 'button', onclick: hear }, ...(touchFirst() ? ['Tap to play it'] : [h('kbd', 'Space'), ' plays it'])),
        h('button.ar-link.ar-link-tour.ar-welcome-tour', { type: 'button', onclick: tour }, 'the tour'),
        h('button.ar-link.ar-link-agent', { type: 'button', onclick: agent }, 'ask the agent')),
      h('p.ar-welcome-jam', 'Play guitar? ', h('button.ar-link.ar-welcome-jamlink', { type: 'button', onclick: jam }, 'The Jam room'), ' puts the chords on a neck.'));
    laneWrap.append(card);
    app.welcome = { el: card, close };
    // it introduces this song: when another song is loaded (or this one is cleared), it goes; so does your first move
    // (an edit, a kept take, an undo; the house setting itself up doesn't count)
    // switched to the simple view: it goes (the simple view never shows it)
    offs.push(app.ui.on?.('workspace', (w) => { if (w?.view === 'simple') close(); }));
    offs.push(app.store.on('change', (e) => {
      if (e.kind === 'load' || !app.store.get().tracks.length) return close();
      if ((e.kind === 'do' || e.kind === 'undo' || e.kind === 'redo') && e.by !== 'overdub') close();
    }));
    // (the first Play leaves it up: Make your own is still one click away after a listen)
  })();
  // A phone: app.css fixes the card to the screen over the lanes (they're too short to hold it above the sheet); it sits
  // under the arranger's top row, the one with Arrange | Jam in it (it covered that row, so the Jam room's tab wasn't
  // there to see until the card was put away), and is never taller than the room under it. Kept so from the frame.
  function placeWelcome() {
    const c = app.welcome?.el;
    if (!c || !c.isConnected || c.classList.contains('out')) return;
    if (!isPhone()) { if (c._top != null) { c._top = null; c.style.top = ''; c.style.maxHeight = ''; } return; }
    const top = Math.round(bar.getBoundingClientRect().bottom + 6);
    if (c._top === top) return;
    c._top = top;
    c.style.top = top + 'px';
    c.style.maxHeight = Math.max(160, window.innerHeight - top - 12) + 'px';
  }

  /* ======================================================= state */
  let dirty = true, rulerDirty = true;
  let follow = true, followPauseUntil = 0;
  let selClips = new Set();      // clip ids (the primary one is ui.state.selection.clip)
  let selSection = null;
  let drag = null;               // the gesture in progress
  let hover = null;              // { clip, zone }
  let lastPointer = null;
  const flash = flasher(1500);
  const flashCol = new Map();    // id -> the ink an arrival's crop marks draw in (an agent's edits: cool; show(): the author's)
  const trackFlash = new Map();
  const preview = new Map();     // clipId -> stats for the mini piano roll
  const signers = new Map();     // clipId -> who signs it (signersOf)
  const waves = new Map();       // assetId -> { state, peaks, n, dur }
  let headSig = '';
  let presenceSig = '';
  let takeInfo = new Map();      // clip id -> { group: [clips, oldest first], k (1-based), n, hidden, playing, folder, lanes, first, fs, fe }
  const takesOpen = new Set();   // the take folders shown open, one lane per take under the clip (this session's view)
  let takesVer = 0;
  const badges = new Map();      // clip id -> the "3 takes" badge's rect this frame (view coordinates), for clicks
  const labels = new Map();      // clip id -> what its label line printed at the right last time it was drawn (a byline,
                                 // "muted", "kept off", or null), for the checks and anyone asking what's on screen
  // a track whose instrument is held (a song's code this browser hasn't allowed, devices/trust.js): it plays silence
  const keptOffTrack = (t) => !!(t && t.kind !== 'audio' && t.instrument && app.devices?.heldDevice?.(t.instrument.device));
  let rec = { take: null, peaks: [], trace: [], lastTrace: null, view: null };   // what the take in progress drew

  const ppb = () => zoom.pxPerBeat;
  const th = () => zoom.trackH;
  const tracks = () => P().tracks;

  /* ======================================================= rows: each track's row, then its open lanes */
  // One layout for drawing, hit-testing, the headers, locate() and presence: every track is a row zoom.trackH tall,
  // followed by its open automation lanes (40 px, 48 on a phone; lanes.js). Cached until the song, the lanes shown or
  // the track height change. With no lanes open it is exactly i * trackH, as it always was.
  const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  const laneH = () => (isPhone() ? LANE_H_PHONE : LANE_H);
  let lay = null, layDirty = true;
  function rows() {
    const p = P(), TH = th(), LH = laneH(), ph = isPhone();
    const hs = heightsSig();
    if (lay && !layDirty && lay.p === p && lay.TH === TH && lay.LH === LH && lay.n === p.tracks.length && lay.ph === ph && lay.hs === hs && lay.tv === takesVer) return lay;
    const KH = takeRowH();
    const out = { p, TH, LH, ph, hs, tv: takesVer, n: p.tracks.length, rows: [], tops: [], ends: [], lanes: new Map(), total: 0, end: 0 };
    let y = 0;
    p.tracks.forEach((t, i) => {
      out.tops.push(y);
      out.rows.push({ kind: 'track', i, t, y, h: TH });
      y += TH;
      // an open take folder: one row per take under the track (the comp is the track's own row)
      const open = takesOpen.size ? takeFolders(t).filter((f) => takesOpen.has(f.id) && f.lanes.length > 1) : [];
      for (let k = 0, nk = Math.max(0, ...open.map((f) => f.lanes.length)); k < nk; k++) { out.rows.push({ kind: 'take', i, t, y, h: KH, k, folders: open }); y += KH; }
      for (const l of shownLanes(app, p, t, { narrow: ph })) {
        const hh = laneHeight(l.key, ph);
        const r = { kind: 'lane', i, t, y, h: hh, addr: l.addr, key: l.key };
        out.rows.push(r); out.lanes.set(l.key, r);
        y += hh;
      }
      out.ends.push(y);
    });
    out.total = y;
    // the master's lanes (lanes.js masterTrack): a block of their own under the last track, a head row then the lanes
    const mt = masterTrack(p), ml = shownLanes(app, p, mt, { narrow: ph });
    if (ml.length) {
      out.mtop = y;
      out.rows.push({ kind: 'mhead', i: out.n, t: mt, y, h: 26 });
      y += 26;
      for (const l of ml) {
        const hh = laneHeight(l.key, ph);
        const r = { kind: 'lane', i: out.n, t: mt, y, h: hh, addr: l.addr, key: l.key };
        out.rows.push(r); out.lanes.set(l.key, r);
        y += hh;
      }
    }
    out.end = y;
    lay = out; layDirty = false;
    return out;
  }
  // the top of track i's row (content y); past the last track, rows of trackH carry on
  const trackTop = (i) => { const L = rows(); return i < 0 ? i * L.TH : i < L.n ? L.tops[i] : L.total + (i - L.n) * L.TH; };
  // the track whose block (its row and its lanes) holds content y; negative above, n and more below the last
  function trackAtY(y) {
    const L = rows();
    if (y < 0) return Math.floor(y / L.TH);
    if (y >= L.total) return L.n + Math.floor((y - L.total) / L.TH);
    let lo = 0, hi = L.n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (L.ends[m] > y) hi = m; else lo = m + 1; }
    return lo;
  }
  // a take row's height: a little over half a track's, so a take's label and notes still read
  function takeRowH() { return Math.round(clamp(th() * 0.62, 28, 40)); }
  // the take row at content y, or null
  function takeRowAtY(y) {
    const L = rows(), i = trackAtY(y);
    if (i < 0 || i >= L.n || y < L.tops[i] + L.TH) return null;
    return L.rows.find((r) => r.kind === 'take' && r.i === i && y >= r.y && y < r.y + r.h) || null;
  }
  // the lane row at content y, or null
  function laneRowAtY(y) {
    const L = rows();
    if (L.mtop != null && y >= L.mtop && y < L.end) return L.rows.find((r) => r.kind === 'lane' && r.i === L.n && y >= r.y && y < r.y + r.h) || null;
    const i = trackAtY(y);
    if (i < 0 || i >= L.n || y < L.tops[i] + L.TH) return null;
    return L.rows.find((r) => r.kind === 'lane' && r.i === i && y >= r.y && y < r.y + r.h) || null;
  }
  // where a dragged header lands: before the first track whose block's middle is below y
  function insertAtY(y) {
    const L = rows();
    let k = 0;
    for (let i = 0; i < L.n; i++) if (L.tops[i] + (L.ends[i] - L.tops[i]) / 2 <= y) k = i + 1;
    return clamp(k, 0, L.n);
  }
  const snapGrid = (e) => {
    if (e?.shiftKey) return 0;
    const s = ui.state.snap || 0;
    if (!s) return 0;
    let g = s;
    while (g * ppb() < 6 && g < bpbOf()) g *= 2;
    return g;
  };
  const contentBeats = () => {
    const bpb = bpbOf();
    const end = Math.max(app.engine.songEnd?.() || 0, ...P().tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)), ...P().sections.map((s) => s.start + s.length), P().loop?.end || 0, engine.playing ? engine.beat || 0 : 0);
    const view = (scroller.clientWidth || 800) / ppb();
    return Math.ceil(Math.max(end + bpb * 16, view + bpb * 2) / bpb) * bpb;
  };
  function layoutSpacer() {
    spacer.style.width = Math.round(contentBeats() * ppb()) + 'px';
    spacer.style.height = Math.round(Math.max(rows().total, rows().end || 0) + 96) + 'px';
  }

  /* ======================================================= take stacks */
  // Clips that share a take group (clip.take, a recording's passes over one range: core/arrangement.js takeFolders,
  // the same folder order and "Take N" numbers the recorder names them by) draw as one clip: the playing one
  // (unmuted), with a "3 takes" badge; the muted ones are kept in the song but not drawn in the lane. A stack with
  // every take muted shows its newest one, muted. One stack per range: a piece of an older folder over other bars
  // (songs recorded before folders were one range) is a stack of its own, never a take of this one.
  const EPS_T = 1e-3;
  function buildTakes() {
    const out = new Map();
    for (const t of tracks()) {
      for (const f of takeFolders(t)) {
        const byRange = new Map();
        for (const c of f.clips) {
          const k = `${Math.round(c.start / EPS_T)}:${Math.round((c.start + c.length) / EPS_T)}`;
          if (!byRange.has(k)) byRange.set(k, []);
          byRange.get(k).push(c);
        }
        // (a comped folder is a stack per stretch: the badge goes on the longest, where it has room)
        const groups = [...byRange.values()].filter((g) => g.length >= 2).sort((x, y) => x[0].start - y[0].start);
        const host = groups.reduce((m, g, gi) => (g[0].length > groups[m][0].length + EPS_T ? gi : m), 0);
        groups.forEach((group, gi) => {
          const live = group.filter((c) => !c.mute);
          const shown = live.length ? new Set(live.map((c) => c.id)) : new Set([group[group.length - 1].id]);
          group.forEach((c, k) => out.set(c.id, { group, k: k + 1, n: group.length, hidden: !shown.has(c.id), playing: !c.mute, track: t, folder: f.id, lanes: f.lanes.length, first: gi === host, fs: f.start, fe: f.end }));
        });
      }
    }
    takeInfo = out;
  }
  // a take that would leave its range silent: a notes clip with nothing in its window
  const silentTake = (c) => c.kind === 'notes' && !c.notes.some((n) => n.t < c.length - EPS_T && n.t + n.d > EPS_T);
  const hiddenTake = (c) => !!takeInfo.get(c.id)?.hidden;
  const shownClips = (t) => t.clips.filter((c) => !hiddenTake(c));
  // the stack a clip belongs to (the selected one by default), or null when it has no other takes
  function stackOf(clipId = ui.state.selection.clip) {
    const ti = clipId ? takeInfo.get(clipId) : null;
    return ti ? { ...ti, track: store.track(ti.track.id) || ti.track } : null;
  }
  // the folder's piece that plays at a beat (a comp joins and cuts pieces, so the clip picked may not be there now)
  const playingAt = (t, take, beat) => (store.track(t.id) || t).clips.find((c) => c.take === take && !c.mute && c.start <= beat + EPS_T && c.start + c.length > beat + EPS_T) || null;
  // where a stretch of a folder is, as a DAW counts it: "5.1–6.1" (core/arrangement.js barBeat), everywhere takes are
  const takeBars = (a, b) => barBeatSpan(P(), a, b);
  // One toast at a time about a folder: a later swipe, switch, flatten or delete takes the last one's place, so no line
  // (or Undo) on screen describes a comp that has since changed
  let takeToastEl = null;
  function takeToast(text, o = {}) {
    if (takeToastEl) takeToastEl.remove();
    takeToastEl = ui.toast(text, o);
    return takeToastEl;
  }
  // Comping (core/arrangement.js planTakeComp): a take plays over [a, b) of its folder, the others are muted there; the
  // folder is cut where the take changes and joined up where it no longer does. One dispatch, one undo step, by you.
  function compTake(t, take, lane, a, b, { quiet = false, label = null } = {}) {
    let plan;
    try { plan = planTakeComp(P(), { track: t.id, take, lane, start: a, end: b }); } catch (e) { takeToast(e.message, { kind: 'bad' }); return null; }
    if (!plan.ops.length) { say(plan.summary); return { ok: true, ops: 0, plan }; }
    const r = store.dispatch(plan.ops, { by: 'you', label: label || `comp: ${plan.summary.replace(/\.$/, '')}` });
    if (!r.ok) { takeToast(r.error, { kind: 'bad' }); return r; }
    r.plan = plan;
    if (!quiet) takeToast(plan.summary, { ms: 3200, action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    return r;
  }
  // which take plays in a clip's stretch of its folder (a comp of just that stretch): one undo step
  function useTake(t, c, { quiet = false } = {}) {
    const ti = takeInfo.get(c.id);
    if (!ti) return null;
    const name = c.name || t.name;
    const r = compTake(t, c.take, c.id, c.start, c.start + c.length, { quiet: true, label: `play ${name} on ${t.name}` });
    if (!r || !r.ok || r.ops === 0) return r;
    const now = playingAt(t, c.take, c.start) || c;
    selClips = new Set([now.id]);
    ui.select({ track: t.id, clip: now.id, notes: [], range: null });
    const whole = ti.lanes === ti.n && Math.abs(c.start - ti.fs) < EPS_T && Math.abs(c.start + c.length - ti.fe) < EPS_T;
    const line = `${name} plays on ${t.name}${whole ? '' : `, ${takeBars(c.start, c.start + c.length)}`}, ${ti.k} of ${ti.n}.`;
    if (quiet) { say(line); ui.announce?.(line); } else takeToast([line, ...(touchFirst() ? [] : [' ', h('kbd', `${MOD}↑`), ' ', h('kbd', `${MOD}↓`), ' to switch.'])], { ms: 3200, action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    return r;
  }
  // ⌘↑ / ⌘↓: the previous / next take of the selected clip's stack
  function stepTake(dir) {
    const st = stackOf();
    if (!st) return null;
    const cur = st.group.find((x) => !x.mute && x.id === ui.state.selection.clip) || st.group.find((x) => !x.mute) || st.group[st.k - 1];
    const i = st.group.indexOf(cur);
    // (a take with nothing in it is passed over: switching never leaves the bars silent)
    let j = i + dir;
    while (j >= 0 && j < st.group.length && silentTake(st.group[j])) j += dir;
    if (j < 0 || j >= st.group.length) { say(`${cur.name || st.track.name} is the ${dir < 0 ? 'first' : 'last'} take.`); return null; }
    return useTake(st.track, st.group[j], { quiet: true });
  }
  // The take lanes (the badge, ⌥T, the takes menu): one row per take under the folder; a drag across a row plays that
  // take there (compTake), a click plays it in the stretch under the pointer
  function toggleTakes(t, c, on = null) {
    const id = c && c.take;
    if (!id) return false;
    const open = on == null ? !takesOpen.has(id) : !!on;
    if (open === takesOpen.has(id)) return open;
    if (open) takesOpen.add(id); else takesOpen.delete(id);
    takesVer++;
    relayout();
    const f = takeFolders(t).find((x) => x.id === id);
    if (open && f) {
      const line = `${f.lanes.length} takes on ${t.name}, a lane each: drag across one to play it there.`;
      takeToast(touchFirst() ? line : [line, ' ', h('kbd', '⌥T'), ' closes them.'], { ms: 3200 });
    } else say(`The take lanes on ${t.name} are closed.`);
    return open;
  }
  // the badge's menu: each take (the playing one marked), the take lanes, then delete or flatten
  function takeMenu(at, t, c) {
    const st = stackOf(c.id);
    if (!st) return;
    const playing = st.group.find((x) => !x.mute) || null;
    const open = takesOpen.has(c.take);
    // a comped folder: each take says where it plays in the whole comp (as its lane's head does), not just in this
    // piece; a click plays it in this piece's stretch
    const f = takeFolders(t).find((x) => x.id === c.take);
    const comped = !!f && f.comp.length > 1 && new Set(f.comp.map((x) => x.lane)).size > 1;
    const here = takeBars(st.group[0].start, st.group[0].start + st.group[0].length);
    const whereOf = (x) => {
      if (!comped) return x === playing ? 'playing' : silentTake(x) ? 'muted, nothing in it' : bylineOf(app, x.by) ? 'muted' : 'muted, as it was';
      const k = f.lanes.findIndex((l) => l.clips.includes(x)), w = k < 0 ? 'not playing' : compWhere(f, k);
      return x !== playing && silentTake(x) ? `${w}; nothing in ${here}` : w === 'not playing' && !bylineOf(app, x.by) ? 'not playing, as it was' : w;
    };
    menu(at, [
      { head: comped ? `${st.n} takes on ${t.name}, comped: a click plays one in ${here}` : `${st.n} takes on ${t.name}` },
      ...st.group.map((x) => ({ label: x.name || t.name, sub: whereOf(x), disabled: x !== playing && silentTake(x), title: comped ? `Play ${x.name || t.name} in ${here} and mute the others there` : `Play ${x.name || t.name} and mute the others`, run: () => useTake(t, x) })),
      '-',
      { label: open ? 'Hide the take lanes' : 'Show the take lanes', kbd: '⌥T', sub: 'drag across one to comp', run: () => toggleTakes(t, c) },
      { label: 'Previous take', kbd: `${MOD}↑`, disabled: !playing || !st.group.slice(0, st.group.indexOf(playing)).some((x) => !silentTake(x)), run: () => { selClips = new Set([playing.id]); ui.select({ track: t.id, clip: playing.id }); stepTake(-1); } },
      { label: 'Next take', kbd: `${MOD}↓`, disabled: !playing || !st.group.slice(st.group.indexOf(playing) + 1).some((x) => !silentTake(x)), run: () => { selClips = new Set([playing.id]); ui.select({ track: t.id, clip: playing.id }); stepTake(1); } },
      '-',
      { label: (takeFolders(t).find((f) => f.id === c.take)?.comp.filter((x) => x.lane >= 0).length || 0) > 1 ? 'Flatten the comp' : `Flatten to ${(playing || c).name || t.name}`, sub: 'one clip of what plays', title: 'Merge what plays into one ordinary clip and delete the rest of the takes', run: () => flattenTakes(t, playing || c) },
      { label: `Delete ${(playing || c).name || t.name}`, danger: true, sub: 'the take before it plays', run: () => deleteTake(t, playing || c) },
    ]);
  }
  // a take goes from the whole folder (its lane); where it played, the newest take left plays
  function deleteTake(t, c) {
    let plan;
    try { plan = planTakeLaneDelete(P(), { track: t.id, clip: c.id }); } catch (e) { ui.toast(e.message, { kind: 'bad' }); return null; }
    const r = store.dispatch(plan.ops, { by: 'you', label: `delete ${c.name || t.name} on ${t.name}` });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return r; }
    const now = playingAt(t, c.take, c.start);
    if (now) { selClips = new Set([now.id]); ui.select({ track: t.id, clip: now.id, notes: [] }); }
    takeToast(`${plan.summary} ${MOD}Z brings it back.`, { action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    return r;
  }
  // what plays stays, merged into one ordinary clip (a comp: every piece where it played); the rest goes
  function flattenTakes(t, c) {
    let plan;
    try { plan = planTakesFlatten(P(), { track: t.id, clip: c.id }); } catch (e) { takeToast(e.message, { kind: 'bad' }); return null; }
    const r = store.dispatch(plan.ops, { by: 'you', label: `flatten the takes on ${t.name}` });
    if (!r.ok) { takeToast(r.error, { kind: 'bad' }); return r; }
    takesOpen.delete(c.take);
    selClips = new Set(plan.clips);
    ui.select({ track: t.id, clip: plan.clips[0], notes: [] });
    takeToast(`${plan.summary} ${MOD}Z brings them back.`, { action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    return r;
  }

  /* ======================================================= arming */
  // Selecting a track makes it the record target (auto-arm: the recorder's target is an armed track, else the selected
  // one), so its R lights without track.arm being set. The R key (track.arm) arms on purpose and on its own; with ⌘
  // (Ctrl), or ⌘-clicking a header, it arms one more, keeping the one selection armed.
  const recorder = () => app.input?.recorder || null;
  function armedIds() {
    const p = P(), set = new Set(p.tracks.filter((t) => t.arm).map((t) => t.id));
    if (!set.size) { const tg = recorder()?.target; if (tg) set.add(tg); }
    return set;
  }
  function armMore(t) {
    const ops = [];
    const on = !t.arm;
    // (nothing armed on purpose yet: the selected track, armed by selection, stays armed alongside)
    if (on && !P().tracks.some((x) => x.arm)) for (const id of armedIds()) if (id !== t.id) ops.push({ type: 'track.set', track: id, patch: { arm: true } });
    ops.push({ type: 'track.set', track: t.id, patch: { arm: on } });
    const r = store.dispatch(ops, { by: 'you', label: `${on ? 'arm' : 'disarm'} ${t.name}` });
    if (r.ok) say(`${t.name} ${on ? 'armed' : 'disarmed'}. Armed: ${[...armedIds()].map((id) => store.track(id)?.name).filter(Boolean).join(', ') || 'none'}.`);
    return r;
  }
  // the R key, no modifier: this track alone, on purpose (again: off)
  function armOnly(t) {
    const others = P().tracks.filter((x) => x.arm && x.id !== t.id);
    const on = !t.arm;
    const ops = [...others.map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } })), { type: 'track.set', track: t.id, patch: { arm: on } }];
    return store.dispatch(ops, { by: 'you', label: `${on ? 'arm' : 'disarm'} ${t.name}` });
  }
  // a plain click on a header: the track is selected, and so armed; arms set on other tracks give way to it
  function selectTrackArm(t) {
    ui.select({ track: t.id });
    if (t.arm) return;
    const others = P().tracks.filter((x) => x.arm && x.id !== t.id);
    if (others.length) store.dispatch(others.map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } })), { by: 'you', label: `arm ${t.name}`, coalesce: 'arm-select' });
  }

  /* ======================================================= automation lanes */
  // Which lanes show is ui.state.lanes (lanes.js); the song holds the lanes themselves. E (or a header's A key) shows
  // or hides a track's lanes, Add a lane and app.arranger.showLane (a knob's Automate) open one. Lanes play hidden too.
  const getDevice = (id) => app.devices?.getDevice?.(id) || null;
  const laneEd = laneEditor(app, {
    P, ppb, bpb: bpbOf, snapGrid,
    sx: () => scroller.scrollLeft, sy: () => scroller.scrollTop,
    scrollTo: (l, t) => { scroller.scrollLeft = l; scroller.scrollTop = t; dirty = true; },
    beat: () => (app.engine || engine)?.beat || 0,
    dirty: () => { dirty = true; },
    refresh: () => relayout(),
    say: (text) => { say(text); },
    row: (key) => rows().lanes.get(key) || null,
    box: () => lanes.cv.getBoundingClientRect(),
    show: (tid, addr) => showLane(tid, addr),
  });
  const laneFlash = flasher(1400);
  let laneRec = null;           // what app.arranger.recLanes() set: [{ track, insert?, param, from, to }] being written
  function relayout() { layDirty = true; headSig = ''; layoutSpacer(); buildHeads(); dirty = true; }
  const findTrack = (id) => (id && id !== 'master' ? store.track(id) || tracks().find((t) => t.name === id || String(t.name).toLowerCase() === String(id).toLowerCase()) || null : null);
  // a track, or the master's block (lanes.js masterTrack) for 'master'
  const laneTrack = (id) => (id === 'master' ? masterTrack(P()) : findTrack(id));
  // a lane row's new height (its header's lower edge dragged): the layout follows as it moves, the headers when it lands
  function resizeLane(key, px, done) {
    setLaneHeight(key, px, { save: done });
    layDirty = true; layoutSpacer(); dirty = true;
    const r = rows().lanes.get(key), el = [...headsInner.children].find((x) => x._lane === key);
    if (el && r) el.style.height = r.h + 'px';
    if (done) { relayout(); if (r) say(`Lane height ${r.h} px.`); }
  }
  // show (or hide) a track's lanes; with none at all, E opens its Level lane (volume first: the simplest thing)
  function toggleLanes(trackId, on = null) {
    const t = laneTrack(trackId);
    if (!t) return null;
    const st = trackLanes(ui, t.id);
    st.open = on == null ? !st.open : !!on;
    if (st.open && !shownLanes(app, P(), t).length) {
      st.hide = st.hide.filter((k) => k !== laneKey({ track: t.id, param: 'gain' }));
      if (!shownLanes(app, P(), t).length) st.extra.push({ track: t.id, param: 'gain' });
    }
    relayout();
    const n = shownLanes(app, P(), t).length;
    say(st.open ? `${t.name}: ${n} lane${n === 1 ? '' : 's'} shown.` : `${t.name}: lanes hidden. They still play.`);
    if (st.open && t.id !== 'master') requestAnimationFrame(() => revealTrack(t.id));
    return st.open;
  }
  // open one param's lane under its track and bring it into view: the knob's Automate, Add a lane, the agent
  function showLane(trackId, addr = {}) {
    const t = laneTrack(trackId ?? addr.track);
    if (!t) return null;
    const a = addr.insert && addr.insert !== '' ? { track: t.id, insert: addr.insert, param: addr.param } : { track: t.id, param: addr.param || 'gain' };
    if (a.insert && a.insert !== 'instrument' && !t.inserts.some((x) => x.id === a.insert)) return null;
    if (a.insert === 'instrument' && !t.instrument) return null;
    if (t.id === 'master' && !a.insert && a.param !== 'gain') return null;
    const key = laneKey(a);
    if (!laneParams(app, P(), t).some((q) => q.key === key) && !laneAt(P(), a)) return null;
    const st = trackLanes(ui, t.id);
    st.open = true;
    st.hide = st.hide.filter((k) => k !== key);
    if (!st.extra.some((x) => laneKey(x) === key)) st.extra.push(a);
    st.focus = key;
    if (ui.panels?.has?.('arranger') && !ui.visible?.('arranger')) ui.show('arranger');
    relayout();
    revealLane(key);
    requestAnimationFrame(() => revealLane(key));
    const info = laneInfo(app, P(), a);
    say(`${info.name}${info.device ? `, ${info.device}` : ''} lane open on ${t.name}.`);
    return { key, track: t.id, insert: a.insert || null, param: a.param };
  }
  function hideLane(key) {
    const r = rows().lanes.get(key);
    if (!r) return;
    const st = trackLanes(ui, r.t.id);
    st.extra = st.extra.filter((x) => laneKey(x) !== key);
    if (!st.hide.includes(key)) st.hide.push(key);
    if (laneEd.sel?.key === key) laneEd.sel = null;
    if (laneState(ui).draw === key) laneState(ui).draw = null;
    if (!shownLanes(app, P(), r.t).length) { st.open = false; st.hide = []; }
    relayout();
  }
  function revealLane(key) {
    const r = rows().lanes.get(key);
    if (!r) return;
    const top = trackTop(r.i);
    if (r.y + r.h > scroller.scrollTop + scroller.clientHeight || top < scroller.scrollTop) {
      programmatic = true;
      scroller.scrollTop = Math.max(0, Math.min(top, r.y + r.h - scroller.clientHeight + 8));
    }
    dirty = true;
  }
  // Lanes follow clips (on by default, per browser): moving, copying or duplicating clips takes the lanes under them
  const FOLLOW_KEY = 'overdub:arrange';
  function lanesFollow(on) {
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem(FOLLOW_KEY) || '{}') || {}; } catch (e) { cfg = {}; }
    if (on === undefined) return cfg.followLanes !== false;
    cfg.followLanes = !!on;
    try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(cfg)); } catch (e) { /* private mode */ }
    return cfg.followLanes;
  }
  // the auto.writes that carry the lanes under these clips to where they land (core/arrangement.js followClips)
  function followOps(moves) {
    if (!lanesFollow() || !moves.length || !lanesOf(P()).length) return [];
    try { return followClips(P(), moves, { getDevice }).ops; } catch (e) { console.warn('lanes follow clips', e); return []; }
  }
  // the track's Automation menu: its lanes (shown or not), Add a lane, Lanes follow clips
  function automationMenu(at, t) {
    const p = P();
    const st = trackLanes(ui, t.id);
    const have = laneKeysOn(p, t);
    const params = laneParams(app, p, t);
    const shown = new Set(shownLanes(app, p, t).map((x) => x.key));
    const follow = lanesFollow();
    menu(at, [
      { head: `Automation on ${t.name}` },
      { label: st.open ? 'Hide the lanes' : 'Show the lanes', kbd: 'E', sub: have.length ? `${have.length} with points` : 'none yet', run: () => { ui.select({ track: t.id }); toggleLanes(t.id); } },
      ...params.filter((q) => have.includes(q.key)).map((q) => ({ label: q.name, sub: shown.has(q.key) ? 'shown' : q.device || 'mixer', run: () => showLane(t.id, q.addr) })),
      '-',
      { label: 'Add a lane…', sub: 'Level, Pan, any knob', run: () => addLaneMenu(at, t) },
      { label: 'Lanes follow clips', sub: follow ? 'on' : 'off', title: 'Moving, copying or duplicating clips takes the automation under them along', run: () => { const on = lanesFollow(!follow); ui.toast(on ? 'Lanes follow clips: moving a clip takes its automation along.' : 'Lanes stay put when clips move.'); } },
    ]);
  }
  // Add a lane: a ledger of what the track can automate, the mixer first, then each device's knobs by label
  function addLaneMenu(at, t) {
    const p = P();
    const have = new Set(laneKeysOn(p, t));
    const items = [{ head: `Add a lane on ${t.name}` }];
    let dev = null;
    for (const q of laneParams(app, p, t)) {
      if (q.device !== dev && q.device) { items.push('-', { head: q.device }); }
      dev = q.device;
      items.push({ label: q.name, sub: have.has(q.key) ? 'has a lane' : q.device ? '' : 'mixer', run: () => showLane(t.id, q.addr) });
    }
    // (the master's lanes: its level and its inserts' knobs, in a block under the last track)
    if (t.id !== 'master') {
      const mt = masterTrack(p), mh = new Set(laneKeysOn(p, mt));
      items.push('-', { head: 'Master' });
      for (const q of laneParams(app, p, mt)) items.push({ label: q.name === 'Level' ? 'Master level' : q.name, sub: mh.has(q.key) ? 'has a lane' : q.device || 'master', run: () => showLane('master', q.addr) });
    }
    menu(at, items);
  }
  // what the lane menu adds below the editor's own items
  const laneMenuMore = (r) => ['-', { label: 'Hide this lane', sub: 'it still plays', run: () => hideLane(r.key) }, { label: 'Add a lane…', run: () => addLaneMenu({ x: 40, y: 120 }, r.t) }];
  // the lanes being written: recLanes()'s list, else while R records with input/autorec.js, the stretches its take
  // has written so far (autorec.writes(): auto.writes with from and to) and, for each control held now
  // (autorec.touching()), the stretch from where the hand took it to the playhead (round the loop: to its end, then
  // from its start)
  const touchFrom = new Map();   // lane key -> the beat a held control was first seen at, this take
  function recList() {
    if (laneRec) return laneRec;
    const ar = app.input?.autorec;
    if (!ar?.recording) { touchFrom.clear(); return null; }
    let w = [], held = [];
    try { w = ar.writes?.() || []; } catch (e) { w = []; }
    try { held = (ar.touching?.() || []).filter((x) => !x.mode || x.mode === 'rec'); } catch (e) { held = []; }
    const out = w.filter((op) => op && op.param && Number.isFinite(op.from) && Number.isFinite(op.to));
    const now = (app.engine || engine)?.beat || 0, lp = P().loop, seen = new Set();
    for (const x of held) {
      const t = findTrack(x.track);
      if (!t || !x.param) continue;
      const key = laneKey({ track: t.id, insert: x.insert || null, param: x.param });
      seen.add(key);
      if (!touchFrom.has(key)) touchFrom.set(key, now);
      const from = touchFrom.get(key);
      if (now >= from) out.push({ track: t.id, insert: x.insert || null, param: x.param, from, to: Math.max(now, from + 0.01), held: true });
      else if (lp?.on) {
        out.push({ track: t.id, insert: x.insert || null, param: x.param, from, to: lp.end, held: true });
        out.push({ track: t.id, insert: x.insert || null, param: x.param, from: lp.start, to: Math.max(now, lp.start + 0.01), held: true });
      }
    }
    for (const k of [...touchFrom.keys()]) if (!seen.has(k)) touchFrom.delete(k);
    return out;
  }
  // every stretch being written on this lane
  function recOf(key, list) {
    if (!list || !list.length) return null;
    const out = [];
    for (const x of list) {
      if (!x || !x.param) continue;
      const t = findTrack(x.track);
      if (t && laneKey({ track: t.id, insert: x.insert || null, param: x.param }) === key && x.to > x.from) out.push({ from: x.from, to: x.to });
    }
    return out.length ? out : null;
  }
  function drawLaneRows(g, now, L) {
    const p = P(), pal = palette(), W = lanes.w, H = lanes.h, sx = scroller.scrollLeft, sy = scroller.scrollTop, pb = ppb();
    const recs = L.lanes.size ? recList() : null;
    for (const r of L.rows) {
      if (r.kind !== 'lane') continue;
      const y = r.y - sy;
      if (y > H || y + r.h < 0) continue;
      const lane = laneAt(p, r.addr);
      const info = laneInfo(app, p, r.addr);
      if (!info.spec) {
        g.font = `400 11px ${pal.ui}`; g.fillStyle = pal.text3; g.textBaseline = 'middle';
        g.fillText(`${info.name}: its device has no such param any more, so this lane does nothing.`, 10, y + r.h / 2);
        continue;
      }
      const v = laneEd.view(r.key, lane ? lane.points : []);
      const quiet = r.t.mute || (p.tracks.some((t) => t.solo) && !r.t.solo);
      g.save();
      if (quiet) g.globalAlpha = 0.55;
      drawLaneRow(g, {
        y, h: r.h, W, sx, pb, t: r.t, spec: info.spec, pts: v.pts, held: !!lane?.off, stat: staticValue(p, r.addr, info.spec),
        sel: v.sel, selPts: v.selPts, rec: recOf(r.key, recs), empty: v.pts.length ? null : 'Not automated yet. Click the line to add a point.',
      });
      g.restore();
      // an agent's lane arriving: crop marks in its ink over what it wrote, then gone
      const fl = laneFlash.level(r.key, now);
      if (fl > 0 && v.pts.length) {
        const x0 = Math.max(2, v.pts[0].t * pb - sx), x1 = Math.min(W - 2, v.pts[v.pts.length - 1].t * pb - sx);
        if (x1 > x0) arrivals.push({ x: x0, y: y + 4, w: Math.max(8, x1 - x0), h: r.h - 9, color: lane?.by ? (authorKind(app, lane.by) === 'agent' ? pal.agent : pal.human) : pal.agent, a: Math.min(1, fl * 4) });
      }
    }
  }
  // the lane headers' values at the playhead, ~10 Hz
  let laneValT = 0;
  function syncLaneValues(now) {
    if (now - laneValT < 100) return;
    laneValT = now;
    const p = P(), beat = (app.engine || engine)?.beat || 0;
    for (const row of headsInner.children) {
      if (!row._lane) continue;
      const r = rows().lanes.get(row._lane);
      if (!r) continue;
      const info = laneInfo(app, p, r.addr);
      const lane = laneAt(p, r.addr);
      const v = lane && !lane.off ? valueAt(lane.points, beat, info.spec) : staticValue(p, r.addr, info.spec);
      const text = fmtValue(info.spec, v);
      if (row._val.textContent !== text) row._val.textContent = text;
    }
  }

  /* ======================================================= toolbar */
  function syncBar() {
    snapBtn.replaceChildren(h('span', `Snap ${snapLabel(ui.state.snap || 0)}`));
    followBtn.classList.toggle('on', follow);
    followBtn.setAttribute('aria-pressed', String(follow));
    const n = selClips.size;
    const sec = !n && selSection ? P().sections.find((x) => x.id === selSection) : null;
    const st = n === 1 ? takeInfo.get([...selClips][0]) : null;
    const ls = laneEd.sel && rows().lanes.get(laneEd.sel.key);
    if (ls) { hint.textContent = `${laneInfo(app, P(), ls.addr).name}: click adds a point, Alt-drag bends, double-click deletes, right-click for shapes`; return; }
    hint.textContent = sec ? `${sec.name}: ${MOD}D duplicates it with its clips, Shift+F10 or a right-click for more` : st ? `${(st.group[st.k - 1].name || st.track.name)}, ${st.k} of ${st.n} takes: ${MOD}↑ ${MOD}↓ switch takes, ⌥T or the badge opens the take lanes` : n > 1 ? `${n} clips: Delete removes them, ${MOD}D duplicates, 0 mutes` : n === 1 ? `Double-click to edit, Alt-drag to copy, 0 mutes it` : 'Double-click a lane for a new clip, or drag across bars to select them for your agent';
  }

  /* ======================================================= headers */
  function buildHeads() {
    const p = P();
    const L = rows(), ls = laneState(ui);
    const laneSig = L.rows.filter((r) => r.kind === 'lane').map((r) => { const l = laneAt(p, r.addr), inf = laneInfo(app, p, r.addr); return [r.key, r.h, l?.by, l ? laneSigners(app, l).join() : '', !!l?.off, ls.draw === r.key, inf.name, inf.device, !!inf.spec]; });
    const takeSig = L.rows.filter((r) => r.kind === 'take').map((r) => [r.i, r.k, r.h, r.folders.map((f) => (f.lanes[r.k] ? [f.lanes[r.k].name, f.lanes[r.k].clips[0].by, f.comp.map((x) => `${x.lane}@${x.start}-${x.end}`).join()] : null))]);
    const heldOn = keptOffTrack;
    // the sound card's state: the trial (its track shows "Light Table, trying"), the tracks whose Sounds is pending,
    // and the ghost lane (a new track R's take would make, or the one a take's card previews)
    const tried = app.sounds?.trying?.() || null, gh = ghostInfo();
    const sig = JSON.stringify([th(), p.tracks.map((t) => [t.id, t.name, t.color, t.kind, t.mute, t.solo, t.arm, t.by, t.instrument?.device, t.inserts.length, t.inserts.length ? t.inserts.slice(0, 3).map((x) => x.device).join() : '', laneKeysOn(p, t).length > 0, !!ls.tracks[t.id]?.open, heldOn(t), deviceName(app, t.instrument?.device), ((d) => d && [d.by, d.via])(app.devices?.getDevice?.(t.instrument?.device) || app.devices?.heldDevice?.(t.instrument?.device)), !!app.sounds?.pending?.(t.id)]), laneSig, takeSig, !!app.sounds, tried && [tried.track, tried.device, tried.newTrack], gh && [gh.track, gh.name]]);
    if (sig === headSig) { syncHeadSel(); return; }
    headSig = sig;
    const anySolo = p.tracks.some((t) => t.solo);
    const heads0 = p.tracks.map((t, i) => {
      const color = resolveColor(t.color);
      const ak = authorKind(app, t.by);
      // (M and S are also the keys, for the selected track: ui/mixer.js)
      const flag = (k, label, title, key = null) => h(`button.ar-hb.ar-hb-${k}` + (t[k] ? '.on' : ''), {
        ...(k === 'arm' ? { dataset: { feature: 'record-options' } } : {}),
        title: key ? `${title} (${key})` : title, 'aria-label': `${title}: ${t.name}`, 'aria-pressed': String(!!t[k]),
        onclick: (e) => {
          e.stopPropagation();
          if (k === 'arm') { if (e.metaKey || e.ctrlKey) armMore(t); else armOnly(t); return; }
          store.dispatch({ type: 'track.set', track: t.id, patch: { [k]: !t[k] } }, { by: 'you', label: `${t[k] ? 'un' : ''}${k} ${t.name}` });
        },
      }, label);
      const name = h('span.ar-hname' + (t.mute ? '.struck' : ''), { title: 'Double-click to rename' }, t.name);
      const meterFill = h('div.ar-hmeter-fill');
      const inFill = h('i.ar-hin-fill');
      const dev = t.kind === 'audio' ? (t.inserts.length ? t.inserts.map((x) => deviceName(app, x.device)).slice(0, 2).join(', ') + (t.inserts.length > 2 ? ' …' : '') : 'Audio in') : deviceName(app, t.instrument?.device);
      // the byline: whoever built the device ("Firefly, by Claude"), else an agent or a guest who wrote the part; the
      // house and you are unsigned here (your parts are signed on their clips). A held instrument (its code hasn't been
      // allowed on this computer) says "kept off" where the byline goes, the way a muted part says "muted"
      const held = heldOn(t);
      const devDef = t.kind === 'instrument' ? app.devices?.getDevice?.(t.instrument?.device) || app.devices?.heldDevice?.(t.instrument?.device) || null : null;
      const devBy = devDef?.by || null;
      const signer = held ? null : [devBy, t.by].find((b) => b && b !== 'you' && authorKind(app, b) !== 'house') || null;
      // a device that came through someone else's link says whose ("Tape Organ, by Sam via Jo"; in full on its title)
      const devVia = devDef?.via && devDef.via !== devBy && signer === devBy ? devDef.via : null;
      const devCredit = devBy && authorKind(app, devBy) !== 'house' ? `${dev}, made by ${devBy === 'you' ? 'you' : authorName(app, devBy)}${devVia ? `, via ${authorName(app, devVia)}’s link` : ''}` : '';
      // (the simple view puts away the swatch (Track tools), R (Recording options) and the devices button (Sound): the
      // header keeps the name, the byline, the instrument (its name, which opens it big), M and S; ui/workspace.js)
      const swatch = h('button.ar-swatch', { dataset: { feature: 'tracks' }, title: 'Track colour', 'aria-label': `Colour of ${t.name}`, onclick: (e) => { e.stopPropagation(); colorMenu(e.currentTarget, t); } });
      const tall = th() >= 46;
      // the previewed new track of a take's sound card is drawn as the ghost lane, not as a track
      if (gh && gh.track === t.id) return ghostHead(gh);
      const isInst = t.kind === 'instrument' && !!t.instrument;
      const trying = tried && !tried.newTrack && tried.track === t.id;
      const pending = !!app.sounds?.pending?.(t.id);
      // The instrument as a button: the name opens it big (the device window, app.plugin); a held one opens the Devices
      // tab, where Play it lives. Only the name and its glyph open: the swatch and the header's space select.
      const inst = isInst ? h('button.ar-hinst' + (trying ? '.trying' : ''), {
        type: 'button',
        title: held ? 'Kept off: its code hasn’t run on this computer. Open its devices to play it' : `Open ${dev} big: its sound, presets and a keyboard`,
        'aria-label': `Open ${dev}, the instrument on ${t.name}${held ? ', kept off' : ''}`,
        onclick: (e) => { e.stopPropagation(); openInstrument(t); },
      }, h('span.ar-hinst-n', trying ? `${dev}, trying` : dev || 'No device'), icon('open', { size: 12 })) : null;
      // the devices button (Sound, put away in the simple view): an instrument track's effects, one click away
      const devBtn = h('button.ar-hdev' + (isInst ? '.ar-hdev-fx' : ''), {
        type: 'button', dataset: { feature: 'devices' },
        title: (devCredit ? devCredit + '. ' : '') + (held ? 'Kept off: its code hasn’t run on this computer. Open its devices to play it' : isInst ? `Open its devices: ${t.inserts.length ? t.inserts.map((x) => deviceName(app, x.device)).join(', ') : 'no effects yet'}` : 'Open its devices'),
        'aria-label': `Devices on ${t.name}: ${devCredit || dev || 'none'}${held ? ', kept off' : ''}`,
        onclick: (e) => {
          e.stopPropagation();
          const had = e.currentTarget === document.activeElement;
          ui.select({ track: t.id }); if (ui.panels.has('rack')) ui.show('rack');
          // (selecting redraws the header: focus goes to the same button on the new one, not to the page)
          if (had) requestAnimationFrame(() => { if (document.activeElement && document.activeElement !== document.body) return; headsInner.querySelector(`.ar-head[data-track="${t.id}"] .ar-hdev`)?.focus({ preventScroll: true }); });
        },
      }, isInst ? icon('knob', { size: 13 }) : dev || 'No device');
      // Sounds: on the selected track, on one the pointer is over or focus is in (CSS, over the name's end, so the
      // header never shifts), and pending on a new track until its card has been opened once
      const sounds = isInst && app.sounds ? h('button.btn.btn-txt.ar-hsounds', {
        type: 'button', title: `Hear ${t.name} on other instruments`, 'aria-label': `Sounds for ${t.name}`,
        onclick: (e) => { e.stopPropagation(); if (ui.state.selection.track !== t.id) selectTrackArm(t); app.sounds.offer({ track: t.id, from: 'header', anchor: e.currentTarget }); },
      }, 'Sounds') : null;
      const row = h('div.ar-head' + (ui.state.selection.track === t.id ? '.sel' : '') + (t.mute || (anySolo && !t.solo) ? '.quiet' : '') + (pending ? '.pending' : '') + (tall ? '' : '.short'), {
        dataset: { track: t.id, author: ak }, style: { height: th() + 'px' },
        title: ak === 'house' ? t.name : `${t.name}, by ${authorName(app, t.by)}`,
      },
      // the header's own target, under its words and keys: a tap anywhere that isn't a key lands here and selects the
      // track. (A finger beside the name landed on S: the browser takes a tap to the nearest thing that can be pressed,
      // and the header's empty space wasn't one. A click listener makes it one; the row's pointer handlers select.)
      h('div.ar-htap', { 'aria-hidden': 'true', onclick: () => {} }),
      h('span.ar-hnum.num', { 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
      h('div.ar-hmain',
        h('div.ar-hrow', tall ? h('i.ar-hsw', { 'aria-hidden': 'true' }) : [h('i.ar-hsw.ar-hsw-off', { 'aria-hidden': 'true' }), swatch], name, sounds),
        tall ? h('div.ar-hsub', swatch, inst,
          isInst ? null : devBtn,
          held ? h('span.ar-hby.ar-hheld', ', kept off') : signer ? h('span.ar-hby', ', by ', byline(signer, { app }), ...(devVia ? [' via ', byline(devVia, { app })] : [])) : null,
          isInst ? devBtn : null) : null),
      h('div.ar-hbtns', flag('mute', 'M', 'Mute', 'M'), flag('solo', 'S', 'Solo', 'S'), flag('arm', 'R', `${t.kind === 'audio' ? 'Arm to record audio' : 'Arm to record what you play'} (a selected track is armed; ${MOD}click arms one more)`),
        // the simple view's R: a lamp on the track R records onto, not a button (Onto, in Sketch, picks another)
        h('span.ar-hlamp', { role: 'img', 'aria-label': `R records onto ${t.name}`, title: `R records onto ${t.name}. Onto in Sketch picks another.` }, 'R'),
        autoKey(t)),
      h('div.ar-hmeter', meterFill),
      // the armed track's input: a 2 px meter along the header's bottom edge
      h('div.ar-hin', { 'aria-hidden': 'true' }, inFill));
      row.style.setProperty('--tc', color);   // (a custom property only takes through setProperty)
      row._fill = meterFill;
      row._in = inFill;
      row._arm = row.querySelector('.ar-hb-arm');
      row._track = t.id;
      headDrag(row, t, i);
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (row._touch) { if (!row._lift) liftHead(row, t, e); return; } trackMenu({ x: e.clientX, y: e.clientY }, t); });
      longPress(row, (pt) => liftHead(row, t, pt), { slop: 8, filter: (e) => !e.target.closest('button,input') });
      return row;
    });
    // each track's open lanes, under its header: the lane's name (a param chooser), its device, who wrote it, its
    // value, Draw, Hide, "+ lane" on the last; the lower edge drags its height. Then the master's block, if open.
    const all = [];
    const laneHeads = (t, i) => {
      const mine = L.rows.filter((r) => r.kind === 'lane' && r.i === i);
      mine.forEach((r, k) => {
        const lane = laneAt(p, r.addr);
        all.push(laneHead(app, {
          t, addr: r.addr, key: r.key, lane, info: laneInfo(app, p, r.addr), height: r.h, draw: ls.draw === r.key, last: k === mine.length - 1,
          onDraw: () => { ls.draw = ls.draw === r.key ? null : r.key; headSig = ''; buildHeads(); say(ls.draw ? 'Draw is on: drag across the lane to paint it.' : 'Draw is off.'); },
          onBack: () => laneEd.back(r.addr),
          onHide: () => hideLane(r.key),
          onMenu: (pt) => laneEd.openMenu(pt, r, null, laneMenuMore(r)),
          onPick: () => { ui.state.focus = 'arranger'; if (laneEd.pick(r.addr)) scroller.focus({ preventScroll: true }); },
          onChoose: (pt) => laneEd.paramMenu(pt, t, r),
          onAdd: (pt) => laneEd.paramMenu(pt, t, null),
          onResize: (px, done) => resizeLane(r.key, px, done),
        }));
      });
    };
    p.tracks.forEach((t, i) => { all.push(heads0[i]); for (const r of L.rows) if (r.kind === 'take' && r.i === i) all.push(takeHead(t, r)); laneHeads(t, i); });
    const mrow = L.rows.find((r) => r.kind === 'mhead');
    if (mrow) {
      all.push(h('div.ar-mhead', { style: { height: mrow.h + 'px' }, dataset: { master: '1' } },
        h('span.ar-mname', 'Master'),
        h('button.btn.btn-txt.ar-lhide', { type: 'button', title: 'Hide the master\'s lanes (they still play)', onclick: (e) => { e.stopPropagation(); toggleLanes('master', false); } }, 'Hide')));
      laneHeads(mrow.t, L.n);
    }
    const addRow = h('button.ar-addrow', { dataset: { feature: 'tracks' }, style: { height: Math.max(40, Math.min(56, th())) + 'px' }, onclick: (e) => addTrackMenu(e.currentTarget) }, h('span', 'Add a track'));
    // the ghost lane's head at the foot, when R would make a new track (a previewed one took its own track's place)
    const ghostRow = gh && !gh.track ? ghostHead(gh) : null;
    headsInner.replaceChildren(...all, ...(ghostRow ? [ghostRow] : []), addRow);
    ghostAt = gh ? (gh.track ? Math.max(0, p.tracks.findIndex((t) => t.id === gh.track)) : p.tracks.length) : -1;
    syncGhost();
    laneValT = 0;
    presenceSig = '';
    armSig = ''; syncArm();
  }
  // Where a lane of a folder plays in its comp, in bar.beat: "plays" (all of it), "plays 5.1–6.1", "plays 5.1–5.3,
  // 6.1–6.2", "not playing" (the take lanes' heads and the takes menu say the same)
  function compWhere(f, k) {
    const mine = [];
    for (const x of f.comp) { const l = mine[mine.length - 1]; if (x.lane !== k) continue; if (l && Math.abs(l.end - x.start) < EPS_T) l.end = x.end; else mine.push({ start: x.start, end: x.end }); }
    if (!mine.length) return 'not playing';
    if (f.comp.every((x) => x.lane === k)) return 'plays';
    return `plays ${mine.map((x) => takeBars(x.start, x.end)).join(', ')}`;
  }
  // A take lane's header: the take's name (a click plays it over the whole folder), who played it, and where it plays
  // in the comp ("plays 9.1–11.1", "plays", "not playing")
  function takeHead(t, r) {
    const f = r.folders.find((x) => x.lanes[r.k]), lane = f.lanes[r.k];
    const name = lane.name || t.name;
    const where = compWhere(f, r.k);
    const by = lane.clips[0].by, signed = by && authorKind(app, by) !== 'house';
    return h('div.ar-takehead' + (where !== 'not playing' ? '.on' : ''), { style: { height: r.h + 'px' }, title: `${name}: ${where}`, dataset: { takeLane: String(r.k), takeTrack: t.id } },
      h('button.ar-tkname', { type: 'button', title: `Play ${name} over the whole folder`, onclick: (e) => { e.stopPropagation(); compTake(t, f.id, r.k, f.start, f.end); } }, name),
      signed ? h('span.ar-tkby', byline(by, { app })) : null,
      h('span.ar-tkwhere', where));
  }
  // the A key beside M S R: on a track with lanes (or with its lanes open); lit while they show
  function autoKey(t) {
    const p = P(), open = !!laneState(ui).tracks[t.id]?.open;
    if (!open && !laneKeysOn(p, t).length) return null;
    return h('button.ar-hb.ar-hb-auto' + (open ? '.on' : ''), {
      title: 'Automation lanes: show or hide them (E)', 'aria-label': `Automation lanes: ${t.name}`, 'aria-pressed': String(open),
      onclick: (e) => { e.stopPropagation(); toggleLanes(t.id); },
    }, 'A');
  }
  function syncHeadSel() {
    for (const row of headsInner.children) if (row._track) row.classList.toggle('sel', row._track === ui.state.selection.track);
    syncArm();
  }
  // the R keys: lit on every armed track (on purpose, or the selected one by selection)
  let armSig = '';
  function syncArm() {
    const lit = armedIds(), aim = aimId();
    const sig = [...lit].join(',') + '|' + (aim || '');
    if (sig === armSig) return;
    armSig = sig;
    for (const row of headsInner.children) {
      if (!row._track) continue;
      const on = lit.has(row._track);
      row.classList.toggle('aimed', aim === row._track);
      row.classList.toggle('armed', on);
      if (row._arm) { row._arm.classList.toggle('on', on); row._arm.setAttribute('aria-pressed', String(on)); }
      if (!on && row._in) row._in.style.clipPath = 'inset(0 100% 0 0)';
    }
  }
  // Where R goes, shown: in the simple view the aimed track's R is a lamp (its arm button is put away); the ghost lane
  // at the foot says "A new track, Lamp Tines" while R's take would make one (Sketch open, or a take counting in or
  // recording), or while a take's sound card previews the track its Keep would make.
  function aimId() {
    const R = recorder();
    if (!R || typeof R.lands !== 'function') return null;
    try { return R.lands()?.id || null; } catch (e) { return null; }
  }
  function ghostInfo() {
    const tr = app.sounds?.trying?.();
    if (tr?.newTrack && tr.track && store.track(tr.track)) return { track: tr.track, name: `A new track, ${tr.name || deviceName(app, store.track(tr.track)?.instrument?.device)}` };
    if (!tracks().length) return null;
    const R = recorder();
    if (!R || typeof R.lands !== 'function') return null;
    const busy = R.state && R.state !== 'idle';
    if (!busy && !ui.visible?.('sketch')) return null;
    let lands;
    try { lands = R.lands(); } catch (e) { return null; }
    if (lands !== null) return null;
    let hum = false;
    try { hum = !!R.humming?.(); } catch (e) { hum = false; }
    const kind = hum ? 'hum' : app.input?.mode === 'tap' ? 'pads' : 'keys';
    const part = app.sounds?.newPart?.(kind) || { device: kind === 'pads' ? 'core.drums' : 'core.keys' };
    return { track: null, name: `A new track, ${deviceName(app, part.device)}` };
  }
  function ghostHead(gh) {
    return h('div.ar-ghost', { style: { height: th() + 'px' }, dataset: { ghost: gh.track ? 'preview' : 'aim' }, title: gh.name },
      h('span.ar-hnum.num', { 'aria-hidden': 'true' }, ''),
      h('div.ar-hmain', h('span.ar-gname', gh.name)),
      h('div.ar-hbtns', h('span.ar-hlamp.on', { role: 'img', 'aria-label': 'R records onto a new track', title: 'R records onto a new track' }, 'R')));
  }
  let ghostAt = -1, ghostSig = '', ghostPos = '', aimT = 0;
  function syncGhost() {
    if (ghostAt < 0) { if (!ghostLane.hidden) { ghostLane.hidden = true; ghostPos = ''; } return; }
    const pos = `top:${Math.round(trackTop(ghostAt) - scroller.scrollTop)}px;left:0;right:0;height:${th()}px`;
    if (pos === ghostPos && !ghostLane.hidden) return;
    ghostPos = pos;
    ghostLane.hidden = false;
    ghostLane.style.cssText = pos;
  }
  // ~10 Hz: the aim and the ghost follow Sketch's mode, the selection and the recorder without a redraw of their own
  function syncAim(now) {
    if (now - aimT < 100) return;
    aimT = now;
    const gh = ghostInfo();
    const sig = gh ? `${gh.track}|${gh.name}` : '';
    if (sig !== ghostSig) { ghostSig = sig; headSig = ''; buildHeads(); dirty = true; }
    else syncGhost();
    syncArm();
  }
  // the instrument opened big; a held one (kept off here) opens the Devices tab instead, where Play it is
  function openInstrument(t) {
    selectTrackArm(t);
    if (keptOffTrack(t)) { ui.show('rack'); return; }
    const r = app.plugin?.open?.({ track: t.id, slot: 'instrument' });
    if (r && !r.ok) { if (r.held) ui.show('rack'); else ui.toast(r.error, { kind: 'bad' }); }
  }
  function renameTrack(t, nameEl) {
    const inp = h('input.ar-hinput', { value: t.name, 'aria-label': 'Track name', maxlength: 40 });
    nameEl.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const fin = (ok) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (ok && v && v !== t.name) store.dispatch({ type: 'track.set', track: t.id, patch: { name: v } }, { by: 'you', label: `rename track to ${v}` });
      headSig = ''; buildHeads();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
    inp.addEventListener('blur', () => fin(true));
    inp.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  function colorMenu(anchor, t) {
    const cols = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--c-${i})`);
    const grid = h('div.ar-colors', cols.map((c) => h('button.ar-color' + (t.color === c ? '.on' : ''), {
      style: { background: c }, 'aria-label': 'colour ' + c, onclick: () => { closePopover(); store.dispatch({ type: 'track.set', track: t.id, patch: { color: c } }, { by: 'you', label: `colour ${t.name}` }); },
    })));
    popover(anchor, [h('div.ek-head', 'Track colour'), grid]);
  }
  function trackMenu(at, t) {
    const i = tracks().indexOf(t);
    menu(at, [
      { head: t.name },
      { label: 'Rename', run: () => { const n = headsInner.querySelector(`[data-track="${t.id}"] .ar-hname`); if (n) renameTrack(t, n); } },
      { label: 'Colour…', run: () => colorMenu(headsInner.querySelector(`[data-track="${t.id}"] .ar-swatch`) || at, t) },
      ...(t.kind === 'instrument' && t.instrument ? [
        { label: `Open ${deviceName(app, t.instrument.device)}`, sub: keptOffTrack(t) ? 'kept off: its devices' : 'its sound, presets and a keyboard', run: () => openInstrument(t) },
        ...(app.sounds ? [{ label: 'Sounds', sub: 'hear it on other instruments', run: () => { if (ui.state.selection.track !== t.id) selectTrackArm(t); app.sounds.offer({ track: t.id, from: 'header', anchor: headsInner.querySelector(`[data-track="${t.id}"]`) || null }); } }] : []),
      ] : []),
      { label: `Devices on ${t.name}`, run: () => { ui.select({ track: t.id }); ui.show('rack'); } },
      { label: 'Automation…', kbd: 'E', sub: 'lanes under the track', run: () => automationMenu(at, t) },
      { label: 'Duplicate track', run: () => duplicateTrack(t) },
      { label: 'Move up', disabled: i <= 0, run: () => store.dispatch({ type: 'track.move', track: t.id, index: i - 1 }, { by: 'you', label: `move ${t.name}` }) },
      { label: 'Move down', disabled: i >= tracks().length - 1, run: () => store.dispatch({ type: 'track.move', track: t.id, index: i + 1 }, { by: 'you', label: `move ${t.name}` }) },
      ...sectionItem(at, sectionAt((app.engine || engine)?.beat || 0)),
      '-',
      { label: 'Delete track', danger: true, run: () => deleteTrack(t) },
    ]);
  }
  function deleteTrack(t) {
    const r = store.dispatch({ type: 'track.remove', track: t.id }, { by: 'you', label: `delete track ${t.name}` });
    if (r.ok) ui.toast(`Deleted ${t.name}. ${MOD}Z brings it back.`, { action: { label: 'Undo', run: () => store.undo() } });
    else ui.toast(r.error, { kind: 'bad' });
    return r;
  }
  function duplicateTrack(t) {
    const copy = JSON.parse(JSON.stringify(t));
    delete copy.id; delete copy.by;
    copy.name = t.name + ' 2';
    copy.clips = copy.clips.map((c) => { delete c.id; return c; });
    copy.inserts = copy.inserts.map((x) => { delete x.id; return x; });
    const r = store.dispatch({ type: 'track.add', track: copy, index: tracks().indexOf(t) + 1 }, { by: 'you', label: `duplicate ${t.name}` });
    if (!r.ok) ui.toast(r.error, { kind: 'bad' });
  }
  // drag a header to reorder; a click selects. A finger: a drag scrolls the tracks (one finger always does); held
  // still, the header is picked up (the long press in buildHeads): then a drag reorders, and letting go where it was
  // opens the track's menu
  function headDrag(row, t) {
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button,input')) return;
      ui.state.focus = 'arranger';
      const y0 = e.clientY, st0 = scroller.scrollTop, touch = e.pointerType === 'touch';
      let moving = false, panning = false, to = -1;
      row._lift = false; row._touch = touch;
      const from = tracks().indexOf(t);
      try { row.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer: the events still come here */ }
      const mv = (ev) => {
        const dy = ev.clientY - y0;
        if (touch && !row._lift) {
          if (!panning && Math.abs(dy) > 8) panning = true;
          if (panning) scroller.scrollTop = Math.max(0, st0 - dy);
          return;
        }
        if (!moving && Math.abs(dy) > (row._lift ? 8 : 4)) { moving = true; row.classList.add('dragging'); if (row._lift) closePopover(); }
        if (!moving) return;
        row.style.transform = `translateY(${dy - (scroller.scrollTop - st0)}px)`;
        const r = heads.getBoundingClientRect();
        const y = ev.clientY - r.top + scroller.scrollTop;
        to = insertAtY(y);
        dropHi.hidden = false;
        dropHi.className = 'ar-drop ar-drop-line';
        dropHi.style.cssText = `top:${trackTop(to) - scroller.scrollTop - 1}px;left:0;right:0;height:2px`;
        laneWrap.append(dropHi);
      };
      const up = (ev) => {
        row.removeEventListener('pointermove', mv); row.removeEventListener('pointerup', up); row.removeEventListener('pointercancel', up);
        row.classList.remove('dragging'); row.style.transform = '';
        dropHi.hidden = true;
        const lifted = row._lift;
        row._lift = false; row._touch = false;
        if (panning) return;
        if (lifted && !moving) return;   // picked up and let go where it was: its menu stays open
        if (!moving) {
          if (ev.type === 'pointercancel') return;
          const now = performance.now();
          const dbl = row._lastClick != null && now - row._lastClick < 400;   // (performance.now() starts at the page load)
          row._lastClick = now;
          if (dbl && e.target.closest('.ar-hname')) { renameTrack(t, row.querySelector('.ar-hname')); return; }
          // selecting a track arms it; ⌘-click arms one more
          if (e.metaKey || e.ctrlKey) armMore(t); else selectTrackArm(t);
          return;
        }
        const idx = to > from ? to - 1 : to;
        if (idx >= 0 && idx !== from) store.dispatch({ type: 'track.move', track: t.id, index: idx }, { by: 'you', label: `move ${t.name}` });
        else { headSig = ''; buildHeads(); }
      };
      row.addEventListener('pointermove', mv); row.addEventListener('pointerup', up); row.addEventListener('pointercancel', up);
    });
  }
  // a finger held on a header picks the track up: its menu opens, and a drag from there moves it (the first time, a
  // toast says so)
  const HEAD_LIFT_HINT = 'overdub:track-lift-hint';
  function liftHead(row, t, pt = null) {
    row._lift = true;
    row.classList.add('dragging');
    const r = row.getBoundingClientRect();
    trackMenu({ x: pt?.clientX ?? r.left + 20, y: pt?.clientY ?? r.top + r.height / 2 }, t);
    try { navigator.vibrate?.(12); } catch (e) { /* no buzz */ }
    let first = false;
    try { first = localStorage.getItem(HEAD_LIFT_HINT) !== '1'; if (first) localStorage.setItem(HEAD_LIFT_HINT, '1'); } catch (e) { first = false; }
    if (first) ui.toast(`Holding ${t.name} opens its menu; keep holding and drag up or down to move it. M mutes it; a drag without holding scrolls.`, { ms: 7000 });
    else say(`${t.name}: its menu. Keep holding and drag to move it.`);
  }

  /* ======================================================= adding tracks */
  function addTrack(spec, { select = true } = {}) {
    const p = P();
    const i = p.tracks.length;
    const track = { color: `var(--c-${(i % 8) + 1})`, ...spec };
    const r = store.dispatch({ type: 'track.add', track, ref: 'new' }, { by: 'you', label: `add track ${track.name || ''}`.trim() });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return null; }
    const id = r.created.new || r.created.track;
    if (select) ui.select({ track: id, clip: null, notes: [] });
    requestAnimationFrame(() => revealTrack(id));
    return id;
  }
  // a blurb on one line of a menu: cut at a word, with an ellipsis (a cut at 34 characters read "…vowels from t"); the
  // whole of it is the item's title
  const cutWords = (s, n = 34) => {
    s = String(s).trim();
    if (s.length <= n) return s;
    const head = s.slice(0, n + 1), at = head.lastIndexOf(' ');
    return (at > 0 ? head.slice(0, at) : s.slice(0, n)).replace(/[\s,;:.–—-]+$/, '') + '…';
  };
  // Every instrument the studio has (the built-ins, the house shelf, this song's own), by kind: Synths, Keys, Drums,
  // Bass, Plucked... as the browser groups them, in a menu that scrolls. (It listed the first 14, so Light Table, Suitcase,
  // Mallet Bag, Step Ladder, Brass Rail and Risers were never there.) A drum kit's track opens a clip at the playhead.
  function addTrackMenu(anchor) {
    const inst = app.devices.listDevices({ kind: 'instrument' });
    const by = new Map();
    for (const d of inst) { if (!by.has(d.cat)) by.set(d.cat, []); by.get(d.cat).push(d); }
    if (!by.has('drums')) by.set('drums', [{ id: 'core.drums', name: 'Drums', blurb: 'a drum kit', cat: 'drums' }]);
    const cats = [...DEVICE_CATS, ...[...by.keys()].filter((c) => !DEVICE_CATS.some(([k]) => k === c)).map((c) => [c, c ? c[0].toUpperCase() + c.slice(1) : 'Other'])];
    const items = [];
    for (const [cat, label] of cats) {
      const ds = by.get(cat);
      if (!ds?.length) continue;
      if (items.length) items.push('-');
      items.push({ head: label });
      for (const d of ds) {
        const spec = { kind: 'instrument', name: d.name, instrument: { device: d.id, params: {} } };
        items.push(cat === 'drums'
          ? { label: d.name, sub: d.blurb ? cutWords(d.blurb) : 'drum grid', title: d.blurb, run: () => { const id = addTrack(spec); if (id) newClipAt(id, floorTo(Math.max(0, engine.beat || 0), bpbOf()), { open: true }); } }
          : { label: d.name, sub: d.blurb ? cutWords(d.blurb) : d.cat, title: d.blurb, run: () => addTrack(spec) });
      }
    }
    if (!inst.length) items.unshift({ head: 'Synths' }, { label: 'Synth', sub: 'core.poly', run: () => addTrack({ kind: 'instrument', name: 'Synth', instrument: { device: 'core.poly', params: {} } }) }, '-');
    items.push('-', { head: 'Audio' }, { label: 'Audio track', sub: 'mic, guitar, a file', run: () => addTrack({ kind: 'audio', name: 'Audio', instrument: null }) });
    menu(anchor, items, { label: 'Add a track' });
  }

  /* ======================================================= sections */
  function addSection() {
    const p = P(), bpb = bpbOf();
    const end = p.sections.reduce((m, s) => Math.max(m, s.start + s.length), 0);
    const name = nextSectionName(p);
    const r = store.dispatch({ type: 'section.add', section: { name, start: end, length: bpb * 4 }, ref: 'sec' }, { by: 'you', label: `add section ${name}` });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return; }
    const id = r.created.sec || r.created.section;
    selSection = id;
    reveal(end);
    requestAnimationFrame(() => renameSection(id));
  }
  function renameSection(id) {
    const s = P().sections.find((x) => x.id === id);
    if (!s) return;
    const x = s.start * ppb() - scroller.scrollLeft;
    const w = Math.max(90, s.length * ppb());
    const inp = h('input.ar-secinput', { value: s.name, maxlength: 32, 'aria-label': 'Section name', style: { left: Math.max(0, x) + 'px', width: Math.min(w, 220) + 'px' } });
    const back = focusBack();
    rulerWrap.append(inp);
    inp.focus(); inp.select();
    let done = false;
    const fin = (ok, keyed = false) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      inp.remove();
      if (keyed) back();
      if (ok && v && v !== s.name) store.dispatch({ type: 'section.set', section: id, patch: { name: v } }, { by: 'you', label: `rename section to ${v}` });
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true, true); if (e.key === 'Escape') fin(false, true); });
    inp.addEventListener('blur', () => fin(true));
  }
  // a rename field that came from the keyboard (the lanes or the section strip, or a menu opened from them) hands focus
  // back there when it closes, not to <body>
  function focusBack() {
    const from = document.activeElement;
    const to = from === rulerWrap || from === scroller ? from : null;
    return () => { if (to && to.isConnected && (!document.activeElement || document.activeElement === document.body)) to.focus({ preventScroll: true }); };
  }
  function sectionMenu(at, s) {
    menu(at, [
      { head: s.name },
      { label: 'Rename', run: () => renameSection(s.id) },
      { label: 'Select its bars', sub: 'for you or your agent', run: () => { selSection = s.id; ui.select({ range: { from: s.start, to: s.start + s.length } }); } },
      { label: 'Loop it', run: () => store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: s.start, end: s.start + s.length } } }, { by: 'you', label: `loop ${s.name}` }) },
      '-',
      { label: 'Duplicate', kbd: `${MOD}D`, sub: 'with its clips', title: 'Copy the section and its clips right after it; what comes after moves right', run: () => duplicateSection(s) },
      { label: 'Insert bars after', sub: '1, 2, 4 or 8', run: () => menu(at, [{ head: `Insert after ${s.name}` }, ...[1, 2, 4, 8].map((n) => ({ label: spanLabel(P(), n * bpbOf()), run: () => insertBars(s.start + s.length, n) }))]) },
      '-',
      { label: 'Delete section', danger: true, sub: 'keeps the clips', run: () => store.dispatch({ type: 'section.remove', section: s.id }, { by: 'you', label: `delete section ${s.name}` }) },
      { label: 'Delete these bars', danger: true, sub: 'and what’s in them', run: () => deleteBars(s) },
    ]);
  }

  /* ======================================================= arrangement (core/arrangement.js) */
  // Plan from the song as it is, then one undo step by you; a plan that can't be made says why.
  function arrange(plan, args, label) {
    let pl;
    try { pl = plan(P(), args); } catch (e) { ui.toast(e.message, { kind: 'bad' }); return null; }
    if (!pl.ops.length) return pl;
    const r = store.dispatch(pl.ops, { by: 'you', label });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return null; }
    dirty = true; rulerDirty = true;
    return pl;
  }
  // (an undo refuses when someone has since written into a clip it would rewrite or remove: say so, don't go quiet)
  const undoToast = (text) => ui.toast(text, { action: { label: 'Undo', run: () => {
    const u = store.undo({ by: 'you' });
    if (!u.ok) ui.toast(`Couldn't undo it: ${u.error.replace(/^could not undo: (op \d+ of \d+ \([^)]*\) failed: )?/, '').replace(/ — nothing was changed.*$/, '')}.`, { kind: 'bad' });
  } } });
  function duplicateSection(s) {
    const r = arrange(planSectionDuplicate, { section: s.id, push: true }, `duplicate ${s.name}`);
    if (!r) return null;
    selSection = r.section; selClips.clear();
    ui.select({ clip: null, range: { from: r.to, to: r.to + r.length } });
    reveal(r.to + r.length / 2);
    undoToast(r.summary);
    return r;
  }
  function insertBars(at, bars) {
    const r = arrange(planTimeInsert, { at, length: bars * bpbOf() }, `insert ${spanLabel(P(), bars * bpbOf())} at ${whereLabel(P(), at)}`);
    if (r && !r.ops.length) ui.toast(`Nothing comes after ${whereLabel(P(), at)}, so there was nothing to move.`);
    else if (r) undoToast(r.summary);
    return r;
  }
  function deleteBars(s) {
    const a = Math.floor(s.start / bpbOf() + 1e-9) + 1, b = Math.ceil((s.start + s.length) / bpbOf() - 1e-9);
    const what = `${s.name} (${a === b ? `bar ${a}` : `bars ${a}–${b}`})`;
    const r = arrange(planTimeRemove, { at: s.start, length: s.length }, `delete the bars of ${s.name}`);
    if (!r) return null;
    selSection = null; selClips.clear();
    ui.select({ clip: null, range: null });
    undoToast(`${r.summary.replace(/^Deleted [^:.]*/, `Deleted ${what}`)} ${MOD}Z brings them back.`);
    return r;
  }
  function repeatClip(t, c, times) {
    const r = arrange(planClipRepeat, { track: t.id, clip: c.id, times }, `repeat ${c.name || t.name} ×${times}`);
    if (!r) return null;
    selClips = new Set([c.id, ...r.clips]);
    // the view stays where it was, on the clip you repeated (the copies run on to the right; the toast says how far).
    // Only a clip that wasn't in view (a repeat from the inspector or an agent's call) is brought into it.
    if (c.start * ppb() + 8 > scroller.scrollLeft + scroller.clientWidth || (c.start + c.length) * ppb() < scroller.scrollLeft + 8) reveal(c.start);
    undoToast(r.summary);
    return r;
  }
  // At the playhead (at == null) the cut lands on the snap grid, as a drag would: a stopped playhead is almost never on
  // it, and an off-grid edge gets carried along by every later move and loop. An explicit beat is cut where it says.
  const playheadBeat = () => (app.engine || engine)?.beat || 0;
  // note: a line the toast ends with (⌘E's first press says the key moved)
  function splitClip(t, c, at = null, { note = '' } = {}) {
    const name = c.name || t.name;
    const raw = at == null ? playheadBeat() : at;
    const ms = note ? 6000 : undefined;
    if (!(raw > c.start && raw < c.start + c.length)) {
      ui.toast(`The playhead isn’t over ${name}. Click the ruler where the cut goes, then split.${note}`, { ms });
      return null;
    }
    const g = at == null ? ui.state.snap || 0 : 0;
    at = g > 0 ? snapTo(raw, g) : raw;
    if (!(at > c.start + 1e-6 && at < c.start + c.length - 1e-6)) {
      ui.toast(`On the ${snapLabel(g)} grid the playhead sits on the edge of ${name}, so there’s nothing to cut. Move it in, or set snap off.${note}`, { ms });
      return null;
    }
    const r = arrange(planClipSplit, { track: t.id, clip: c.id, at }, `split ${name}`);
    if (!r) return null;
    // a take folder split in two: both halves are folders, open if it was
    if (r.side && takesOpen.has(c.take)) { takesOpen.add(r.side); takesVer++; relayout(); }
    selClips = new Set([r.clip]);
    ui.select({ track: t.id, clip: r.clip, notes: [] });
    ui.toast(r.summary.replace(` at ${whereLabel(P(), at)}`, ` at ${barBeat(at)}`) + note, { ms });
    return r;
  }
  // "bar 3" on a bar line, else "bar 1, beat 3.25" (beats counted from 1 within the bar)
  function barBeat(beat) {
    const bpb = bpbOf(), bar = Math.floor(beat / bpb + 1e-9), inBar = beat - bar * bpb;
    if (Math.abs(inBar) < 1e-6) return `bar ${bar + 1}`;
    return `bar ${bar + 1}, beat ${Math.round((inBar + 1) * 1000) / 1000}`;
  }
  // ⌘E (Ctrl+E; Live's key: Logic's ⌘T is a browser's new tab): the selected clip; with several selected, the one under
  // the playhead (Repeat leaves two selected). Until 2 October 2026 it was S (S solos now); its first press says so.
  function splitSelected({ note = '' } = {}) {
    const list = selectedList();
    if (list.length === 1) return splitClip(list[0].t, list[0].c, null, { note });
    const b = playheadBeat();
    const under = list.filter(({ c }) => b > c.start && b < c.start + c.length);
    if (under.length === 1) return splitClip(under[0].t, under[0].c, null, { note });
    ui.toast((under.length ? `${under.length} of the selected clips are under the playhead. Select one to split it.` : `None of the ${list.length} selected clips is under the playhead. Select one, or click the ruler where the cut goes.`) + note, { ms: note ? 6000 : undefined });
    return null;
  }
  const splitKey = () => splitSelected({ note: ui.keys.firstPress?.('mod+KeyE') ? ` \`${MOD}E\` splits now, as in Ableton Live; \`S\` solos.` : '' });

  /* ======================================================= clips */
  function newClipAt(trackId, beat, { open = false } = {}) {
    const t = store.track(trackId);
    if (!t) return null;
    if (t.kind === 'audio') { ui.toast(`${t.name} is an audio track: arm it (●) and record, or drop a sound on it.`); return null; }
    const bpb = bpbOf();
    const start = Math.max(0, floorTo(beat, bpb));
    const r = store.dispatch({ type: 'clip.add', track: trackId, clip: { kind: 'notes', start, length: bpb * 4, notes: [] }, ref: 'clip' }, { by: 'you', label: `new clip on ${t.name}` });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return null; }
    const id = r.created.clip;
    selClips = new Set([id]);
    ui.select({ track: trackId, clip: id, notes: [], range: null });
    if (open) editClip(trackId, id);
    return id;
  }
  function editClip(trackId, clipId) {
    const detail = { track: trackId, clip: clipId, handled: false };
    ui.emit('edit-clip', detail);
    if (!detail.handled) {
      const t = store.track(trackId);
      const want = isDrumTrack(app, t) && ui.panels.has('drumgrid') ? 'drumgrid' : 'pianoroll';
      if (ui.panels.has(want)) ui.show(want);
    }
  }
  function selectedList() {
    const out = [];
    for (const t of tracks()) for (const c of t.clips) if (selClips.has(c.id)) out.push({ t, c });
    return out;
  }
  // A take folder moves whole: a drag of any of its clips takes every take in it along (the comp and the takes under
  // it), so a drag never pulls a take out of its folder (or leaves the folder's muted takes behind). -> the drag's items
  function moveItems(list) {
    const out = [], seen = new Set();
    const add = (t, c) => { if (seen.has(c.id)) return; seen.add(c.id); out.push({ t, c, row: tracks().indexOf(t), start: c.start }); };
    for (const { t, c } of list) {
      add(t, c);
      if (c.take) for (const x of t.clips) if (x.take === c.take) add(t, x);
    }
    return out;
  }
  // a piece of a comped folder (its takes cut into stretches by comping): not a clip to drag on its own
  const compedPiece = (t, c) => !!c.take && (takeFolders(t).find((f) => f.id === c.take)?.comp.length || 0) > 1;
  function deleteSelected() {
    if (selSection && !selClips.size) {
      const s = P().sections.find((x) => x.id === selSection);
      if (s) store.dispatch({ type: 'section.remove', section: s.id }, { by: 'you', label: `delete section ${s.name}` });
      selSection = null;
      return true;
    }
    const list = selectedList();
    if (!list.length) return false;
    const ops = list.map(({ t, c }) => ({ type: 'clip.remove', track: t.id, clip: c.id }));
    // a take that was playing goes: the newest take left in its stack plays, as the badge's Delete does (else the
    // bars go silent under muted takes). Same undo step.
    const gone = new Set(list.map(({ c }) => c.id)), seen = new Set(), plays = [];
    for (const { c } of list) {
      const st = stackOf(c.id);
      if (!st || seen.has(st.group[0].id)) continue;
      seen.add(st.group[0].id);
      const rest = st.group.filter((x) => !gone.has(x.id));
      if (!rest.length || rest.some((x) => !x.mute) || !st.group.some((x) => gone.has(x.id) && !x.mute)) continue;
      const next = rest[rest.length - 1];
      ops.push({ type: 'clip.set', track: st.track.id, clip: next.id, patch: { mute: false } });
      plays.push(next.name || st.track.name);
    }
    const r = store.dispatch(ops, { by: 'you', label: list.length > 1 ? `delete ${list.length} clips` : `delete clip ${list[0].c.name || ''}`.trim() });
    if (r.ok) { selClips.clear(); ui.select({ clip: null, notes: [] }); if (plays.length) say(`${plays.join(', ')} ${plays.length > 1 ? 'play' : 'plays'} in ${plays.length > 1 ? 'their' : 'its'} place.`); }
    else ui.toast(r.error, { kind: 'bad' });
    return true;
  }
  function copyOf(c, start, keepName = true) {
    const x = JSON.parse(JSON.stringify(c));
    delete x.id; delete x.by;
    x.start = Math.max(0, start);
    if (!keepName) delete x.name;
    return x;
  }
  function duplicateSelected() {
    const list = selectedList();
    if (!list.length) return;
    const from = Math.min(...list.map(({ c }) => c.start));
    const to = Math.max(...list.map(({ c }) => c.start + c.length));
    const span = to - from;
    const adds = list.map(({ t, c }, i) => ({ type: 'clip.add', track: t.id, clip: copyOf(c, c.start + span), ref: 'd' + i }));
    retake(adds.map((o) => o.clip));   // (copies of takes never join the source's folder)
    const ops = adds
      .concat(followOps(list.map(({ t, c }) => ({ track: t.id, clip: c.id, start: c.start + span, copy: true }))));
    const r = store.dispatch(ops, { by: 'you', label: list.length > 1 ? `duplicate ${list.length} clips` : 'duplicate clip' });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return; }
    selClips = new Set(list.map((_, i) => r.created['d' + i]).filter(Boolean));
    const first = list[0];
    ui.select({ track: first.t.id, clip: r.created.d0, notes: [] });
    reveal(to + span * 0.5);
  }
  // The clips a menu acts on: the selection when the clip is in it, else that clip alone.
  function targetsFor(t, c) {
    const list = selectedList();
    return list.some((x) => x.c.id === c.id) ? list : [{ t, c }];
  }
  // Mute (or unmute) clips: one undo step. A muted clip stays where it is and plays nowhere.
  function muteClips(list, mute) {
    const todo = list.filter(({ c }) => !!c.mute !== mute);
    if (!todo.length) return null;
    const ops = todo.map(({ t, c }) => ({ type: 'clip.set', track: t.id, clip: c.id, patch: { mute } }));
    const what = todo.length > 1 ? `${todo.length} clips` : `clip ${todo[0].c.name || todo[0].t.name}`;
    const r = store.dispatch(ops, { by: 'you', label: `${mute ? 'mute' : 'unmute'} ${what}` });
    if (!r.ok) ui.toast(r.error, { kind: 'bad' });
    else muteToast(todo, mute);
    return r;
  }
  // What a mute did, with Undo. The first one in this browser says how to get the clip back, with the key (the hint has
  // to be findable: DECISION.md, amendment 6); after that, one line.
  const MUTE_HINT = 'overdub:clip-mute-hint';
  function muteToast(list, mute) {
    const one = list.length === 1, c = list[0].c, name = one ? c.name || list[0].t.name : `${list.length} clips`;
    const where = one ? `, ${barsOf(c)}` : '';
    let first = false;
    try { first = mute && localStorage.getItem(MUTE_HINT) !== '1'; if (first) localStorage.setItem(MUTE_HINT, '1'); } catch (e) { first = false; }
    const key = touchFirst() ? null : h('kbd', '0');
    const them = one ? 'it' : 'them';
    const text = !mute ? [`${name} ${one ? 'plays' : 'play'} again${where}.`]
      : first ? [`${name} muted${where}. ${one ? 'It stays' : 'They stay'} in the song, silent; `, ...(key ? ['press ', key, ` on ${them} to hear ${them} again.`] : [`hold ${them} and pick Unmute to hear ${them} again.`])]
      : [`${name} muted${where}.`, ...(key ? [' ', key, ' brings ', them, ' back.'] : [])];
    ui.toast(text, { ms: first ? 7000 : 3200, action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
  }
  function toggleMuteSelected() {
    const list = selectedList();
    if (!list.length) return;
    muteClips(list, !list.every(({ c }) => c.mute));
  }
  // The ops that cut a clip's window to [start, end) (core/arrangement.js planClipTrim): notes stay where they sound
  // in the song (the ones before the new start go); an audio clip's offset moves with its start; trimming the playing
  // take of a folder gives back what it no longer covers (what played there before plays again). Shared by the edge
  // drags and "Trim to the loop". -> { ops, uncovered } (ops empty when it can't be planned: the toast says why)
  function trimPlan(t, c, start, end) {
    try { return planClipTrim(P(), { track: t.id, clip: c.id, start, end }); } catch (e) { ui.toast(e.message, { kind: 'bad' }); return { ops: [], uncovered: [] }; }
  }
  // What "Trim to the loop" would do to these clips: [{ t, c, start, end }] for the ones it changes.
  function loopTrims(list) {
    const l = P().loop || {};
    const out = [];
    if (!(l.end > l.start)) return out;
    for (const { t, c } of list) {
      const s = Math.max(c.start, l.start), e = Math.min(c.start + c.length, l.end);
      if (e - s < 0.25 - 1e-9) continue;   // outside the loop (or a sliver of it): left alone
      if (Math.abs(s - c.start) < 1e-9 && Math.abs(e - (c.start + c.length)) < 1e-9) continue;
      out.push({ t, c, start: s, end: e });
    }
    return out;
  }
  // "bars 5–8" (whole bars) or "beats 3–7.5"
  function loopSpan() {
    const l = P().loop, bpb = bpbOf(), a = l.start / bpb, b = l.end / bpb, r = (x) => Math.round(x * 1000) / 1000;
    const whole = Math.abs(a - Math.round(a)) < 1e-6 && Math.abs(b - Math.round(b)) < 1e-6;
    return whole ? (b - a === 1 ? `bar ${b}` : `bars ${Math.round(a) + 1}–${Math.round(b)}`) : `beats ${r(l.start)}–${r(l.end)}`;
  }
  function trimToLoop(list) {
    const todo = loopTrims(list);
    if (!todo.length) { ui.toast('Nothing to trim: the clip is already inside the loop, or outside it.'); return null; }
    const plans = todo.map(({ t, c, start, end }) => trimPlan(t, c, start, end));
    const ops = plans.flatMap((x) => x.ops);
    if (!ops.length) return null;
    const r = store.dispatch(ops, { by: 'you', label: todo.length > 1 ? `trim ${todo.length} clips to the loop` : 'trim clip to the loop' });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return r; }
    const back = plans.some((x) => x.uncovered.length) ? ' What played under it plays again around it.' : '';
    ui.toast(`Trimmed ${todo.length > 1 ? `${todo.length} clips` : 'the clip'} to the loop (${loopSpan()}).${back} ${MOD}Z puts ${todo.length > 1 ? 'them' : 'it'} back.`);
    return r;
  }
  function clipMenu(at, t, c) {
    const list = targetsFor(t, c);
    const allMuted = list.every((x) => x.c.mute);
    const many = list.length > 1 ? ` ${list.length} clips` : '';
    const trims = loopTrims(list);
    menu(at, [
      { head: c.name || t.name },
      { label: 'Open in editor', kbd: 'dbl-click', sub: 'or double-tap it', run: () => editClip(t.id, c.id) },
      { label: 'Rename', run: () => renameClip(t, c) },
      { label: 'Duplicate after', kbd: `${MOD}D`, sub: 'right after it', run: () => duplicateSelected() },
      { label: 'Repeat ×2', sub: 'once more after it', run: () => repeatClip(t, c, 2) },
      { label: 'Repeat ×4', sub: 'three more', run: () => repeatClip(t, c, 4) },
      { label: 'Split at playhead', kbd: `${MOD}E`, sub: 'on the snap grid', run: () => splitClip(t, c) },
      { label: 'Loop this clip', run: () => store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: c.start, end: c.start + c.length } } }, { by: 'you', label: 'loop clip' }) },
      { label: (allMuted ? 'Unmute' : 'Mute') + many, kbd: '0', sub: allMuted ? 'play it again' : 'keep it, silent', run: () => muteClips(list, !allMuted) },
      { label: 'Trim to the loop' + many, disabled: !trims.length, sub: loopSpan(), title: 'Cut the clip down to the loop’s bars: a long take keeps just the part you looped', run: () => trimToLoop(list) },
      { label: 'Select its bars', sub: 'for your agent', run: () => ui.select({ track: t.id, clip: c.id, range: { from: c.start, to: c.start + c.length } }) },
      ...(takeInfo.has(c.id) ? [{ label: `Takes (${takeInfo.get(c.id).n})…`, kbd: `${MOD}↑ ${MOD}↓`, sub: 'pick, flatten or delete', run: () => takeMenu(at, t, c) }] : []),
      ...sectionItem(at, sectionAt(c.start)),
      '-',
      { label: 'Delete', kbd: '⌫', danger: true, run: () => deleteSelected() },
    ]);
  }
  function renameClip(t, c) {
    const r = clipRect(t, c);
    if (!r) return;
    const inp = h('input.ar-clipinput', { value: c.name || '', placeholder: t.name, maxlength: 40, 'aria-label': 'Clip name', style: { left: Math.max(0, r.x + 4) + 'px', top: r.y + 1 + 'px', width: clamp(r.w - 8, 80, 220) + 'px' } });
    const back = focusBack();
    laneWrap.append(inp);
    inp.focus(); inp.select();
    let done = false;
    const fin = (ok, keyed = false) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      inp.remove();
      if (keyed) back();
      if (ok && v !== (c.name || '')) store.dispatch({ type: 'clip.set', track: t.id, clip: c.id, patch: { name: v || null } }, { by: 'you', label: v ? `name clip ${v}` : 'unname clip' });
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true, true); if (e.key === 'Escape') fin(false, true); });
    inp.addEventListener('blur', () => fin(true));
  }

  /* ======================================================= geometry */
  function clipRect(t, c, start = c.start, length = c.length, row = tracks().indexOf(t)) {
    if (row < 0) return null;
    const x = start * ppb() - scroller.scrollLeft;
    const y = trackTop(row) - scroller.scrollTop + 3;
    return { x, y, w: Math.max(3, length * ppb()), h: th() - 6 };
  }
  function at(e) {
    const r = scroller.getBoundingClientRect();
    const x = e.clientX - r.left + scroller.scrollLeft, y = e.clientY - r.top + scroller.scrollTop;
    return { x, y, beat: x / ppb(), row: trackAtY(y), lane: laneRowAtY(y), take: takeRowAtY(y), vx: e.clientX - r.left, vy: e.clientY - r.top, touch: e.pointerType === 'touch' };
  }
  function hit(pt) {
    if (pt.lane && pt.lane.t.id === 'master') return { t: pt.lane.t, c: null, lane: pt.lane };
    const t = tracks()[pt.row];
    if (!t) return null;
    if (pt.lane) return { t, c: null, lane: pt.lane };
    if (pt.take) return { t, c: null, take: pt.take };
    const y0 = trackTop(pt.row) + 3, y1 = trackTop(pt.row) + th() - 3;
    if (pt.y < y0 || pt.y > y1) return { t, c: null };
    for (let i = t.clips.length - 1; i >= 0; i--) {
      const c = t.clips[i];
      if (hiddenTake(c)) continue;   // a muted take under the playing one: reached through its stack's badge
      const x0 = c.start * ppb(), x1 = (c.start + c.length) * ppb();
      if (pt.x < x0 - 1 || pt.x > x1 + 1) continue;
      const bd = badges.get(c.id);
      // (a finger gets a 40 px target: the badge is a 16 px label)
      const px = pt.touch ? Math.max(2, (40 - bd?.w) / 2) : 2, py = pt.touch ? Math.max(2, (40 - bd?.h) / 2) : 2;
      if (bd && pt.vx != null && pt.vx >= bd.x - px && pt.vx <= bd.x + bd.w + px && pt.vy >= bd.y - py && pt.vy <= bd.y + bd.h + py) return { t, c, zone: 'takes' };
      const edge = Math.min(8, (x1 - x0) / 4);
      // (a comp's inner edges aren't trim handles: they are where the take changes; the take lanes move them)
      const ti = takeInfo.get(c.id), lOk = !ti || c.start <= ti.fs + EPS_T, rOk = !ti || c.start + c.length >= ti.fe - EPS_T;
      const zone = pt.x > x1 - edge && rOk ? 'r' : pt.x < x0 + edge && lOk ? 'l' : (pt.y < y0 + 16 ? 'head' : 'body');
      return { t, c, zone };
    }
    return { t, c: null };
  }

  /* ======================================================= lane gestures */
  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== scroller && e.target !== spacer) return;
    // the scrollbars
    if (e.clientX - scroller.getBoundingClientRect().left > scroller.clientWidth || e.clientY - scroller.getBoundingClientRect().top > scroller.clientHeight) return;
    ui.state.focus = 'arranger';
    closePopover();
    const pt = at(e);
    const hi = hit(pt);
    const clicks = clickCount(e);
    lastPointer = e;
    if (hi?.lane) {
      // an automation lane (lanes.js): a point, the line, a bend, freehand, or a stretch of bars
      selClips.clear(); selSection = null;
      if (hi.t.id !== 'master' && (ui.state.selection.track !== hi.t.id || ui.state.selection.clip || ui.state.selection.range)) ui.select({ track: hi.t.id, clip: null, notes: [], range: null });
      laneEd.down(e, pt, hi.lane, clicks);
      drag = { mode: 'lane', pt0: pt, moved: false, lane: hi.lane };
      scroller.setPointerCapture(e.pointerId);
      e.preventDefault();
      scroller.focus({ preventScroll: true });
      dirty = true;
      return;
    }
    if (laneEd.sel) laneEd.sel = null;
    if (hi?.take) {
      // a take lane of an open folder: a drag across it plays that take there (a comp); a click, in the stretch under
      // it. A finger's drag scrolls; its tap is the click.
      const f = hi.take.folders.find((x) => x.lanes[hi.take.k] && pt.beat >= x.start - EPS_T && pt.beat < x.end + EPS_T) || null;
      selSection = null;
      const pan = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop } : null;
      drag = { mode: 'comp', clicks, pt0: pt, t: hi.t, f, row: hi.take, moved: false, range: null, pan };
      scroller.setPointerCapture(e.pointerId);
      e.preventDefault();
      scroller.focus({ preventScroll: true });
      dirty = true;
      return;
    }
    if (hi?.c && hi.zone === 'takes' && e.pointerType !== 'touch') {
      // the "3 takes" badge: the take lanes open (or close) under the folder
      selClips = new Set([hi.c.id]); selSection = null;
      ui.select({ track: hi.t.id, clip: hi.c.id, notes: [], range: null });
      e.preventDefault();
      toggleTakes(hi.t, hi.c);
      dirty = true;
      return;
    }
    if (hi?.c && e.pointerType === 'touch') {
      // a finger on a clip: a drag scrolls (one finger always does); a tap selects it, a double tap opens it; held still,
      // it picks the clip up (lift(), from the long press below): then a drag moves it (or its edge trims it) and
      // letting go without one opens its menu (Mute, Split, Trim to the loop...). On the "3 takes" badge a tap opens
      // the take lanes (on the tap, not the touch: a scroll can start there too)
      drag = { mode: 'touchclip', clicks, pt0: pt, t: hi.t, c: hi.c, zone: hi.zone, moved: false, pan: { x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop } };
    } else if (hi?.c) {
      const { t, c } = hi;
      if (e.shiftKey) { if (selClips.has(c.id)) selClips.delete(c.id); else selClips.add(c.id); }
      else if (!selClips.has(c.id)) selClips = new Set([c.id]);
      ui.select({ track: t.id, clip: selClips.has(c.id) ? c.id : [...selClips][0] || null, notes: [], range: null });
      selSection = null;
      if (hi.zone === 'body' && compedPiece(t, c)) {
        // a piece of a comp isn't a clip of its own (its edges are where the take changes): a drag across its body
        // selects those bars, as on an empty lane; its label line moves the whole folder. A click selects it.
        drag = { mode: 'range', clicks, pt0: pt, moved: false, row: pt.row, t, pan: null, onClip: { t, c } };
      } else {
        const mode = hi.zone === 'r' ? 'resize-r' : hi.zone === 'l' ? 'resize-l' : 'move';
        const items = mode === 'move' ? moveItems(selectedList()) : [{ t, c, row: tracks().indexOf(t), start: c.start }];
        drag = { mode, clicks, pt0: pt, items, t, c, copy: e.altKey, moved: false, dBeat: 0, dRow: 0, len: c.length, start: c.start };
      }
    } else if (hi?.t || pt.row >= 0) {
      selSection = null;
      // touch: a tap on a lane is a click (select, double-tap for a new clip); a finger drag scrolls (there is no wheel)
      const pan = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop } : null;
      drag = { mode: 'range', clicks, pt0: pt, moved: false, row: pt.row, t: hi?.t || null, pan };
    } else return;
    scroller.setPointerCapture(e.pointerId);
    e.preventDefault();
    scroller.focus({ preventScroll: true });
    dirty = true;
  });
  scroller.addEventListener('pointermove', (e) => {
    lastPointer = e;
    if (!drag) { hoverAt(e); return; }
    moveDrag(e);
  });
  function moveDrag(e) {
    const d = drag;
    if (d.mode === 'lane') { laneEd.move(e, at(e)); return; }
    if (d.pan) {
      const dx = e.clientX - d.pan.x, dy = e.clientY - d.pan.y;
      if (!d.moved && Math.hypot(dx, dy) < 8) return;
      d.moved = true; d.mode = 'pan';
      scroller.scrollLeft = d.pan.sl - dx; scroller.scrollTop = d.pan.st - dy;
      dirty = true;
      return;
    }
    const pt = at(e);
    const dx = pt.x - d.pt0.x, dy = pt.y - d.pt0.y;
    if (!d.moved && Math.hypot(dx, dy) < (d.lifted ? 8 : 4)) return;
    if (!d.moved && d.lifted) closePopover();   // (held, then dragged: the menu goes, the clip moves)
    d.moved = true;
    const g = snapGrid(e);
    const bpb = bpbOf();
    if (d.mode === 'move') {
      const lead = d.c;
      let ns = lead.start + dx / ppb();
      ns = g ? snapTo(ns, g) : ns;
      const minStart = Math.min(...d.items.map((it) => it.start));
      d.dBeat = Math.max(ns - lead.start, -minStart);
      const n = tracks().length;
      const rws = d.items.map((it) => it.row);
      // the track under the grabbed row's middle, moved by the drag (its lanes count as part of its block)
      const target = trackAtY(trackTop(d.pt0.row) + th() / 2 + dy) - d.pt0.row;
      d.dRow = clamp(target, -Math.min(...rws), n - 1 - Math.max(...rws));
      d.copy = e.altKey;
      d.bad = d.items.some((it) => { const to = tracks()[it.row + d.dRow]; return !to || to.kind !== it.t.kind; });
    } else if (d.mode === 'resize-r') {
      let end = d.c.start + d.c.length + dx / ppb();
      end = g ? snapTo(end, g) : end;
      d.len = Math.max(g || 0.25, end - d.c.start);
    } else if (d.mode === 'resize-l') {
      const end = d.c.start + d.c.length;
      let s = d.c.start + dx / ppb();
      s = g ? snapTo(s, g) : s;
      // (an audio clip opens no earlier than its recording starts: past that the file would slide off the beat)
      const lo = d.c.kind === 'audio' ? Math.max(0, d.c.start - (+d.c.offset || 0) * P().tempo / 60) : 0;
      s = clamp(s, Math.min(lo, end - (g || 0.25)), end - (g || 0.25));
      d.start = s; d.len = end - s;
    } else if (d.mode === 'comp') {
      if (!d.f) return;
      d.range = compRange(d, pt, g);
    } else if (d.mode === 'range') {
      const a = Math.max(0, Math.min(d.pt0.beat, pt.beat)), b = Math.max(d.pt0.beat, pt.beat);
      const gg = g || 0;
      const from = gg ? floorTo(a, Math.max(gg, 1)) : a;
      const to = gg ? Math.ceil(b / Math.max(gg, 1) - 1e-9) * Math.max(gg, 1) : b;
      d.range = { from, to: Math.max(to, from + (gg || 0.25)) };
      d.rows = [clamp(Math.min(d.pt0.row, pt.row), 0, tracks().length - 1), clamp(Math.max(d.pt0.row, pt.row), 0, tracks().length - 1)];
    }
    void bpb;
    scroller.style.cursor = d.mode === 'move' ? (d.bad ? 'not-allowed' : d.copy ? 'copy' : 'grabbing') : d.mode === 'range' || d.mode === 'comp' ? 'text' : 'ew-resize';
    dirty = true;
  }
  // A comp drag's stretch: each edge on the snap grid line nearest where the pointer went down and where it is now (or
  // let go), never pushed outward to the next line, inside the folder; at least one grid step
  function compRange(d, pt, g) {
    const a = Math.min(d.pt0.beat, pt.beat), b = Math.max(d.pt0.beat, pt.beat);
    let from = g ? snapTo(a, g) : a, to = g ? snapTo(b, g) : b;
    from = Math.max(d.f.start, from); to = Math.min(d.f.end, to);
    if (to - from < (g || 0.25) - EPS_T) { if (from + (g || 0.25) <= d.f.end + EPS_T) to = from + (g || 0.25); else from = to - (g || 0.25); }
    return { from, to };
  }
  scroller.addEventListener('pointerup', (e) => endDrag(e));
  scroller.addEventListener('pointercancel', () => { if (drag?.mode === 'lane') laneEd.cancel(); drag = null; dirty = true; });
  scroller.addEventListener('lostpointercapture', () => { if (drag) { if (drag.mode === 'lane') laneEd.cancel(); drag = null; dirty = true; } });
  function endDrag(e) {
    const d = drag;
    drag = null;
    dirty = true;
    if (!d) return;
    try { scroller.releasePointerCapture(e.pointerId); } catch (_) { /* gone */ }
    if (d.mode === 'lane') { laneEd.up(e, at(e)); syncBar(); return; }
    if (d.mode === 'pan') { syncBar(); return; }
    if (d.mode === 'comp') {
      if (!d.f) return;
      // (where it was let go: a last move may not have come before the release)
      if (d.moved) d.range = compRange(d, at(e), snapGrid(e));
      const lane = d.f.lanes[d.row.k];
      // a click: the stretch of the folder under it (between two cuts of the comp)
      const s0 = d.f.comp.find((x) => d.pt0.beat >= x.start - EPS_T && d.pt0.beat < x.end) || d.f.comp[d.f.comp.length - 1];
      const rg = d.moved && d.range ? d.range : { from: s0.start, to: s0.end };
      if (!lane.clips.some((c) => c.start < rg.to - EPS_T && c.start + c.length > rg.from + EPS_T)) { say(`${lane.name || d.t.name} has nothing there.`); return; }
      compTake(d.t, d.f.id, d.row.k, rg.from, rg.to);
      syncBar();
      return;
    }
    if (d.mode === 'touchclip') {
      // a tap: select the clip (a double tap opens it); on the badge, the take lanes
      selClips = new Set([d.c.id]); selSection = null;
      ui.select({ track: d.t.id, clip: d.c.id, notes: [], range: null });
      if (d.zone === 'takes') { toggleTakes(d.t, d.c); syncBar(); return; }
      if (d.clicks >= 2) editClip(d.t.id, d.c.id);
      syncBar();
      return;
    }
    if (d.lifted && !d.moved) { syncBar(); return; }   // picked up and let go where it was: its menu stays open
    if (!d.moved) {
      if (d.mode === 'range' && d.onClip) {
        // a click on a comp's piece: it stays selected, as any clip does; a double-click opens it
        if (d.clicks >= 2) editClip(d.onClip.t.id, d.onClip.c.id);
      } else if (d.mode === 'range') {
        selClips.clear();
        ui.select({ track: d.t?.id ?? null, clip: null, notes: [], range: null });
        // a click in a lane puts the start marker on its bar (shift: the snap grid); playing, the song plays on
        if (d.clicks < 2) app.transport?.marker?.set(e.shiftKey ? floorTo(d.pt0.beat, snapGrid() || 0) : floorTo(d.pt0.beat, bpbOf()), { announce: true });
        if (d.clicks >= 2 && d.t) newClipAt(d.t.id, d.pt0.beat);
      } else if (d.clicks >= 2 && d.c) {
        if (d.items?.length === 1 && hit(d.pt0)?.zone === 'head') renameClip(d.t, d.c); else editClip(d.t.id, d.c.id);
      }
      syncBar();
      return;
    }
    if (d.mode === 'move') {
      if (d.bad) { ui.toast('Notes clips live on instrument tracks, audio clips on audio tracks.'); return; }
      if (!d.dBeat && !d.dRow && !d.copy) return;
      let ops = d.items.map((it, i) => {
        const to = tracks()[it.row + d.dRow];
        const start = Math.max(0, it.start + d.dBeat);
        if (d.copy) return { type: 'clip.add', track: to.id, clip: copyOf(it.c, start), ref: 'k' + i };
        return { type: 'clip.move', track: it.t.id, clip: it.c.id, ...(to !== it.t ? { toTrack: to.id } : {}), start };
      });
      if (d.copy) retake(ops.map((o) => o.clip));   // (copies of takes never join the source's folder)
      // the lanes under the clips go with them (Lanes follow clips), in the same undo step
      ops = ops.concat(followOps(d.items.map((it) => { const to = tracks()[it.row + d.dRow]; return { track: it.t.id, clip: it.c.id, ...(to !== it.t ? { toTrack: to.id } : {}), start: Math.max(0, it.start + d.dBeat), copy: !!d.copy }; })));
      // what lies under them where they land is cut away there (core/arrangement.js planDropTrim), same undo step: a
      // dropped clip takes those beats, as in Live, so nothing under it plays along
      let trim = null;
      try {
        trim = planDropTrim(P(), d.items.map((it) => { const s = Math.max(0, it.start + d.dBeat); return { track: tracks()[it.row + d.dRow].id, start: s, end: s + it.c.length }; }), { keep: d.copy ? [] : d.items.map((it) => it.c.id) });
      } catch (err) { console.warn('drop trim', err); trim = null; }
      if (trim?.ops.length) ops = ops.concat(trim.ops);
      const nc = d.items.length;
      const r = store.dispatch(ops, { by: 'you', label: d.copy ? (nc > 1 ? `copy ${nc} clips` : 'copy clip') : (nc > 1 ? `move ${nc} clips` : `move clip ${d.c.name || ''}`.trim()) });
      if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return; }
      if (d.copy) {
        selClips = new Set(d.items.map((_, i) => r.created['k' + i]).filter(Boolean));
        ui.select({ track: tracks()[d.items[0].row + d.dRow].id, clip: r.created.k0 || null, notes: [] });
      } else if (d.dRow) ui.select({ track: tracks()[d.items[0].row + d.dRow]?.id });
      if (trim?.summary) {
        // (a folder it cut in two: the part after opens as the folder was). What it cut is in plain sight, and the
        // move's one undo step puts it back: it's said, not toasted, as Live says nothing either
        for (const [take, ids] of Object.entries(trim.sides || {})) if (takesOpen.has(take)) { for (const id of ids) takesOpen.add(id); takesVer++; relayout(); }
        say(`${trim.summary} ${MOD}Z undoes the ${d.copy ? 'copy' : 'move'} and puts ${trim.cut + trim.removed === 1 ? 'it' : 'them'} back.`);
      }
    } else if (d.mode === 'resize-r') {
      if (Math.abs(d.len - d.c.length) < 1e-6) return;
      const ops = trimPlan(d.t, d.c, d.c.start, d.c.start + d.len).ops;   // (a shortened take gives back what it covered)
      const r = ops.length ? store.dispatch(ops, { by: 'you', label: d.len > d.c.length ? 'lengthen clip' : 'shorten clip' }) : null;
      if (r && !r.ok) ui.toast(r.error, { kind: 'bad' });
    } else if (d.mode === 'resize-l') {
      const delta = d.start - d.c.start;
      if (Math.abs(delta) < 1e-6) return;
      const ops = trimPlan(d.t, d.c, d.start, d.start + d.len).ops;   // notes stay where they sound in the song; the window moves
      const r = ops.length ? store.dispatch(ops, { by: 'you', label: delta > 0 ? 'trim clip start' : 'extend clip start' }) : null;
      if (r && !r.ok) ui.toast(r.error, { kind: 'bad' });
    } else if (d.mode === 'range' && d.range) {
      selClips.clear();
      const t = tracks()[d.rows[0]];
      ui.select({ track: d.rows[0] === d.rows[1] ? t?.id ?? null : null, clip: null, notes: [], range: d.range });
      rangeRows = d.rows;
    }
    syncBar();
  }
  let rangeRows = null;
  // click counting (pointer events don't count clicks reliably)
  let lastDown = { t: 0, x: 0, y: 0, n: 0 };
  function clickCount(e) {
    const now = performance.now();
    const tol = e.pointerType === 'touch' ? 14 : 6; // a finger lands a little apart each time
    const near = Math.abs(e.clientX - lastDown.x) < tol && Math.abs(e.clientY - lastDown.y) < tol;
    lastDown = { t: now, x: e.clientX, y: e.clientY, n: near && now - lastDown.t < 380 ? lastDown.n + 1 : 1 };
    return lastDown.n;
  }
  function hoverAt(e) {
    const pt = at(e);
    const hi = hit(pt);
    const key = hi?.c ? hi.c.id + hi.zone : '';
    if (key !== (hover?.key || '')) { hover = hi?.c ? { key, clip: hi.c.id, zone: hi.zone } : null; dirty = true; }
    scroller.style.cursor = hi?.lane ? 'crosshair' : hi?.c ? (hi.zone === 'r' || hi.zone === 'l' ? 'ew-resize' : hi.zone === 'body' && compedPiece(hi.t, hi.c) ? 'text' : 'grab') : 'default';
    laneEd.hover(e, pt, hi?.lane || null);
  }
  scroller.addEventListener('pointerleave', () => { tipHide(); if (hover) { hover = null; dirty = true; } });
  scroller.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // (a platform's own long press on a clip: it picks the clip up, as ours does)
    if (drag?.mode === 'touchclip' && !drag.moved) { lift(drag); return; }
    if (drag?.lifted) return;
    if (liftPoint(e)) return;
    laneMenu(e);
  });
  // iOS sends no contextmenu on a long press: a touch held still for half a second opens the same menu
  longPress(scroller, (pt) => {
    if (drag?.mode === 'touchclip' && !drag.moved) { lift(drag); return; }
    if (liftPoint(pt)) return;
    drag = null; dirty = true;
    try { scroller.releasePointerCapture(pt.pointerId); } catch (_) { /* gone */ }
    laneMenu(pt);
  }, { filter: (e) => e.target === scroller || e.target === spacer });
  // A held finger picks the clip up: selected, its menu open (Mute, Split, Trim to the loop...), and a drag from there
  // closes the menu and moves it (its edge: trims it). The first time, a toast says what holding does, and where Mute is.
  const LIFT_HINT = 'overdub:clip-lift-hint';
  function lift(d) {
    const { t, c } = d;
    if (!selClips.has(c.id)) selClips = new Set([c.id]);
    ui.select({ track: t.id, clip: c.id, notes: [], range: null });
    selSection = null;
    const mode = d.zone === 'r' ? 'resize-r' : d.zone === 'l' ? 'resize-l' : 'move';
    const items = mode === 'move' ? moveItems(selectedList()) : [{ t, c, row: tracks().indexOf(t), start: c.start }];
    Object.assign(d, { mode, items, copy: false, moved: false, dBeat: 0, dRow: 0, len: c.length, start: c.start, lifted: true });
    delete d.pan;
    try { navigator.vibrate?.(12); } catch (e) { /* no buzz */ }
    // its menu opens while it is held (a drag from here closes it and moves the clip)
    clipMenu({ x: d.pt0.vx + scroller.getBoundingClientRect().left, y: d.pt0.vy + scroller.getBoundingClientRect().top }, t, c);
    let first = false;
    try { first = localStorage.getItem(LIFT_HINT) !== '1'; if (first) localStorage.setItem(LIFT_HINT, '1'); } catch (e) { first = false; }
    const name = c.name || t.name;
    if (first) ui.toast(`Holding ${name} opens its menu (Mute is in it); keep holding and drag to move it. A drag without holding scrolls.`, { ms: 7000 });
    else say(`${name}: its menu. Keep holding and drag to move it.`);
    dirty = true;
    syncBar();
  }
  // a finger held still on a lane's point picks it up (lanes.js lift()): its menu opens while it is held, and a drag
  // from there closes it and moves the point, as a held clip does
  // Shift+F10 with a lane's point selected: the lane's menu at the point (its curve, the shapes, a point at the playhead)
  function laneKeyMenu() {
    const r = rows().lanes.get(laneEd.sel.key);
    if (!r) return;
    const b = scroller.getBoundingClientRect();
    const x = clamp(laneEd.sel.from * ppb() - scroller.scrollLeft, 0, scroller.clientWidth - 1) + b.left;
    const y = clamp(r.y + r.h - scroller.scrollTop, 0, scroller.clientHeight - 1) + b.top;
    laneEd.openMenu({ x, y }, r, null, laneMenuMore(r));
  }
  function liftPoint(e) {
    if (drag?.mode !== 'lane' || !laneEd.lift()) return false;
    const row = drag.lane;
    laneEd.openMenu({ x: e.clientX, y: e.clientY }, row, { ...drag.pt0, touch: true }, laneMenuMore(row));
    say('The point: its menu. Keep holding and drag to move it.');
    dirty = true;
    return true;
  }
  function laneMenu(e) {
    const pt = at(e);
    const hi = hit(pt);
    if (hi?.lane) {
      laneEd.cancel();
      if (drag?.mode === 'lane') drag = null;
      laneEd.openMenu({ x: e.clientX, y: e.clientY }, hi.lane, { ...pt, touch: e.pointerType === 'touch' || pt.touch }, laneMenuMore(hi.lane));
      return;
    }
    if (hi?.c) {
      if (!selClips.has(hi.c.id)) { selClips = new Set([hi.c.id]); ui.select({ track: hi.t.id, clip: hi.c.id, notes: [] }); }
      clipMenu({ x: e.clientX, y: e.clientY }, hi.t, hi.c);
    } else if (hi?.t) {
      const beat = at(e).beat;
      menu({ x: e.clientX, y: e.clientY }, [{ head: hi.t.name },
        { label: 'New clip here', kbd: 'dbl-click', disabled: hi.t.kind === 'audio', run: () => newClipAt(hi.t.id, beat) },
        { label: 'Paste nothing yet', disabled: true },
        { label: 'Automation…', kbd: 'E', sub: 'lanes under the track', run: () => automationMenu({ x: e.clientX, y: e.clientY }, hi.t) },
        { label: 'Track options…', run: () => trackMenu({ x: e.clientX, y: e.clientY }, hi.t) }].filter((x) => !x.disabled || x.label !== 'Paste nothing yet'));
    }
  }

  /* ======================================================= scroll and zoom */
  scroller.addEventListener('scroll', () => {
    ui.state.scrollX = scroller.scrollLeft;
    ui.state.scrollY = scroller.scrollTop;
    headsInner.style.transform = `translateY(${-scroller.scrollTop}px)`;
    dirty = true; rulerDirty = true;
    if (engine.playing && !programmatic) followPauseUntil = performance.now() + 2500;
    programmatic = false;
  }, { passive: true });
  let programmatic = false;
  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = scroller.getBoundingClientRect();
      const px = e.clientX - r.left;
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 30 ? 0.02 : 0.004)), px);
    } else if (e.altKey) {
      e.preventDefault();
      zoom.trackH = clamp(Math.round(th() * Math.exp(-e.deltaY * 0.004)), 34, 160);
      layDirty = true; headSig = ''; layoutSpacer(); buildHeads(); dirty = true;
    } else if (e.currentTarget !== scroller) {
      e.preventDefault();
      scroller.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX;
      scroller.scrollTop += e.shiftKey ? 0 : e.deltaY;
    }
  };
  scroller.addEventListener('wheel', onWheel, { passive: false });
  rulerWrap.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) return onWheel(e); e.preventDefault(); scroller.scrollLeft += e.deltaX || e.deltaY; }, { passive: false });
  heads.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey || e.altKey) return onWheel(e); e.preventDefault(); scroller.scrollTop += e.deltaY; }, { passive: false });
  function zoomBy(f, px = scroller.clientWidth / 2) {
    const beat = (scroller.scrollLeft + px) / ppb();
    zoom.pxPerBeat = clamp(ppb() * f, 3, 320);
    layoutSpacer();
    programmatic = true;
    scroller.scrollLeft = Math.max(0, beat * ppb() - px);
    dirty = true; rulerDirty = true;
    ui.emit('zoom', zoom);
  }
  // the song: where its last clip ends (a section past every clip is just a name on the ruler), 4 bars at least, and
  // the loop when it runs past them
  function songSpan() {
    const p = P(), bpb = bpbOf();
    const clipEnd = Math.max(0, ...p.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)));
    const secEnd = clipEnd ? 0 : Math.max(0, ...p.sections.map((s) => s.start + s.length));
    const loopEnd = p.loop?.on ? p.loop.end || 0 : 0;
    return Math.ceil(Math.max(bpb * 4, clipEnd, secEnd, loopEnd) / bpb - 1e-9) * bpb;
  }
  function fitSong() { zoomTo(0, songSpan()); }
  // (the lanes not laid out yet, a hidden pane or a phone's other tab: the zoom waits for a width to fit, or a 2-bar
  // song fitted into a 200 px guess shows 17 bars once the pane opens)
  let pendingZoom = null;
  function zoomTo(from, to) {
    if (scroller.clientWidth < 80) { pendingZoom = [from, to]; return; }
    pendingZoom = null;
    const w = Math.max(200, scroller.clientWidth - 24);
    zoom.pxPerBeat = clamp(w / Math.max(1, to - from), 3, 320);
    layoutSpacer();
    programmatic = true;
    scroller.scrollLeft = Math.max(0, from * ppb() - 8);
    dirty = true; rulerDirty = true;
  }
  function reveal(beat) {
    const x = beat * ppb();
    if (x < scroller.scrollLeft + 20 || x > scroller.scrollLeft + scroller.clientWidth - 40) { programmatic = true; scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.25); }
  }
  // New clips (a kept take, a band): scroll them into view and mark them once with crop marks in their author's ink
  // (the house's in cream: it has no ink of its own). Next frame, once the lanes are laid out for them.
  function showClips(ids, by) {
    const found = (ids || []).map((id) => store.findClip(id)).filter(Boolean);
    if (!found.length) return;
    const pal = palette(), k = authorKind(app, by ?? found[0].clip.by);
    const col = k === 'house' ? pal.text : authorColor(app, by ?? found[0].clip.by);
    const now = performance.now();
    for (const f of found) { flash.mark(f.clip.id, now); flashCol.set(f.clip.id, col); }
    dirty = true;
    const rows = tracks().map((t) => t.id);
    const top = found.slice().sort((a, b) => rows.indexOf(a.track.id) - rows.indexOf(b.track.id))[0];
    const from = Math.min(...found.map((f) => f.clip.start)), to = Math.max(...found.map((f) => f.clip.start + f.clip.length));
    // a take that grew the song (it ran past the last clip's end): its end stays in view, zoomed out to it if need be
    const idSet = new Set(found.map((f) => f.clip.id));
    const before = Math.max(0, ...tracks().flatMap((t) => t.clips.filter((c) => !idSet.has(c.id)).map((c) => c.start + c.length)));
    const grew = to > before + 1e-6;
    requestAnimationFrame(() => {
      layoutSpacer();
      if (grew && (to - from) * ppb() > scroller.clientWidth - 56) zoomTo(Math.max(0, from - bpbOf() / 2), to + bpbOf() / 2);
      const x0 = from * ppb(), x1 = to * ppb(), vw = scroller.clientWidth;
      // the start in view; the whole span when it fits
      if (x0 < scroller.scrollLeft + 8 || Math.min(x1, x0 + vw - 48) > scroller.scrollLeft + vw - 8) { programmatic = true; scroller.scrollLeft = Math.max(0, x0 - Math.min(vw * 0.15, 48)); }
      // the top new row in view (a phone's lanes can be a single row tall: then that row at the top)
      const ri = tracks().findIndex((t) => t.id === top.track.id), ry = ri < 0 ? -1 : trackTop(ri), ch = scroller.clientHeight;
      if (ry >= 0 && (ry < scroller.scrollTop || ry + th() > scroller.scrollTop + ch)) { programmatic = true; scroller.scrollTop = Math.max(0, ch >= 2 * th() ? ry - th() : ry); }
      for (const f of found) flash.mark(f.clip.id, performance.now());
      dirty = true;
    });
  }
  function revealTrack(id) {
    const i = tracks().findIndex((t) => t.id === id);
    if (i < 0) return;
    const y = trackTop(i);
    if (y < scroller.scrollTop || y + th() > scroller.scrollTop + scroller.clientHeight) { programmatic = true; scroller.scrollTop = Math.max(0, y - th()); }
  }

  /* ======================================================= ruler gestures */
  rulerWrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.tagName === 'INPUT') return;
    ui.state.focus = 'arranger';
    const r = rulerWrap.getBoundingClientRect();
    const y = e.clientY - r.top, x = e.clientX - r.left + scroller.scrollLeft;
    const beat = Math.max(0, x / ppb());
    const bpb = bpbOf();
    const p = P();
    const clicks = clickCount(e);
    let d = null;
    if (y < SEC_Y + SEC_H) {
      const s = [...p.sections].reverse().find((s) => beat >= s.start && beat <= s.start + s.length);
      if (s) {
        const x0 = s.start * ppb(), x1 = (s.start + s.length) * ppb();
        const zone = x > x1 - 6 ? 'r' : x < x0 + 6 && s.start > 0 ? 'l' : 'body';
        selSection = s.id; selClips.clear();
        ui.select({ clip: null, range: { from: s.start, to: s.start + s.length } });
        rulerWrap.focus({ preventScroll: true });
        d = { kind: 'section', s, zone, x0: x, start: s.start, length: s.length };
      } else {
        selSection = null;
        if (clicks >= 2) {
          const start = floorTo(beat, bpb);
          const next = p.sections.find((q) => q.start > start);
          const length = next ? Math.min(bpb * 4, next.start - start) : bpb * 4;
          const name = nextSectionName(p);
          const rr = store.dispatch({ type: 'section.add', section: { name, start, length }, ref: 'sec' }, { by: 'you', label: `add section ${name}` });
          if (rr.ok) { selSection = rr.created.sec; requestAnimationFrame(() => renameSection(rr.created.sec)); }
        }
        rulerDirty = true; dirty = true;
        return;
      }
    } else if (y < LOOP_Y + LOOP_H && loopShown()) {
      const l = p.loop;
      d = { kind: 'loop', zone: loopZone(x, e.pointerType === 'touch'), x0: x, start: l.start, end: l.end, beat0: beat, on: l.on };
    } else {
      // the start marker: the bar clicked (shift: the snap grid, or free); playing, the song jumps there too
      d = { kind: 'seek', x0: x };
      placeMarker(e.shiftKey ? floorTo(beat, snapGrid() || 0) : floorTo(beat, bpb));
    }
    rulerDrag = { ...d, clicks, moved: false };
    rulerWrap.setPointerCapture(e.pointerId);
    e.preventDefault();
    rulerDirty = true; dirty = true;
  });
  let rulerDrag = null;
  // the loop strip is Loop's (ui/workspace.js): put away in the simple view, its row of the ruler is the bars' (a click
  // there places the marker) and it's drawn only while a loop plays, to say what's going round (L brings it back)
  const loopShown = () => app.ui.workspace?.has?.('loop') !== false;
  // The loop strip: its ends resize it (7 px either side, more to a finger), its middle (the grip, the thicker stretch
  // of the line) moves it, and a drag anywhere else draws a new loop there. A click without a drag turns it on or off.
  function loopGrip() {
    const l = P().loop, x0 = l.start * ppb(), x1 = l.end * ppb(), w = x1 - x0;
    const half = w < 48 ? w / 2 : clamp(w / 6, 12, 40);
    return { x0, x1, a: (x0 + x1) / 2 - half, b: (x0 + x1) / 2 + half };
  }
  function loopZone(x, touch = false) {
    const gp = loopGrip(), e = touch ? 12 : 7;
    if (Math.abs(x - gp.x1) < e) return 'r';
    if (Math.abs(x - gp.x0) < e) return 'l';
    return x >= gp.a && x <= gp.b ? 'body' : 'new';
  }
  // put the start marker at beat (stopped, the playhead goes with it); playing, the song jumps there
  function placeMarker(b) {
    const m = app.transport?.marker;
    if (m) m.set(b);
    if (!m || engine.playing) engine.seek(b);
  }
  rulerWrap.addEventListener('pointermove', (e) => {
    const r = rulerWrap.getBoundingClientRect();
    const x = e.clientX - r.left + scroller.scrollLeft;
    const beat = Math.max(0, x / ppb());
    if (!rulerDrag) {
      const y = e.clientY - r.top;
      const p = P();
      let cur = 'default';
      if (y < SEC_H) { const s = p.sections.find((s) => beat >= s.start && beat <= s.start + s.length); if (s) cur = (Math.abs(x - (s.start + s.length) * ppb()) < 6 || (Math.abs(x - s.start * ppb()) < 6 && s.start > 0)) ? 'ew-resize' : 'grab'; }
      else if (y < LOOP_Y + LOOP_H && loopShown()) { const z = loopZone(x); cur = z === 'r' || z === 'l' ? 'ew-resize' : z === 'body' ? 'grab' : 'col-resize'; }
      else cur = 'pointer';
      rulerWrap.style.cursor = cur;
      return;
    }
    const d = rulerDrag;
    const dx = x - d.x0;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    const bpb = bpbOf();
    const g = e.shiftKey ? 1 : bpb;
    const lg = snapGrid(e) || 0;
    if (d.kind === 'seek') placeMarker(snapTo(beat, lg));
    else if (d.kind === 'section') {
      const db = snapTo(dx / ppb(), g);
      if (d.zone === 'body') d.nStart = Math.max(0, d.start + db), d.nLength = d.length;
      else if (d.zone === 'r') d.nStart = d.start, d.nLength = Math.max(g, d.length + db);
      else { const end = d.start + d.length; d.nStart = clamp(d.start + db, 0, end - g); d.nLength = end - d.nStart; }
    } else if (d.kind === 'loop') {
      const lgrid = e.shiftKey ? (lg || 0.25) : Math.max(1, lg);
      const b = snapTo(beat, lgrid);
      if (d.zone === 'body') { const len = d.end - d.start; const s = Math.max(0, snapTo(d.start + dx / ppb(), lgrid)); d.nStart = s; d.nEnd = s + len; }
      else if (d.zone === 'r') { d.nStart = d.start; d.nEnd = Math.max(d.start + lgrid, b); }
      else if (d.zone === 'l') { d.nEnd = d.end; d.nStart = Math.min(d.end - lgrid, b); }
      else { const a = snapTo(d.beat0, lgrid); d.nStart = Math.min(a, b); d.nEnd = Math.max(a, b); if (d.nEnd - d.nStart < lgrid) d.nEnd = d.nStart + lgrid; }
    }
    rulerDirty = true; dirty = true;
  });
  const rulerUp = (e) => {
    const d = rulerDrag;
    rulerDrag = null;
    if (!d) return;
    rulerDirty = true; dirty = true;
    if (d.kind === 'seek') { app.transport?.marker?.set(app.transport.marker.beat, { announce: true }); return; }
    if (d.kind === 'section') {
      if (!d.moved) { if (d.clicks >= 2) renameSection(d.s.id); return; }
      if (d.nStart == null) return;
      const patch = {};
      if (d.nStart !== d.s.start) patch.start = d.nStart;
      if (d.nLength !== d.s.length) patch.length = d.nLength;
      if (Object.keys(patch).length) {
        store.dispatch({ type: 'section.set', section: d.s.id, patch }, { by: 'you', label: `${patch.length != null && patch.start == null ? 'resize' : 'move'} ${d.s.name}` });
        ui.select({ range: { from: d.nStart, to: d.nStart + d.nLength } });
      }
    } else if (d.kind === 'loop') {
      if (!d.moved) { app.transport?.toggleLoop ? app.transport.toggleLoop() : store.dispatch({ type: 'project.set', patch: { loop: { on: !P().loop.on } } }, { by: 'you', label: 'loop' }); return; }
      if (d.nStart == null || d.nEnd <= d.nStart) return;
      store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: d.nStart, end: d.nEnd } } }, { by: 'you', label: 'set loop' });
    }
  };
  rulerWrap.addEventListener('pointerup', rulerUp);
  rulerWrap.addEventListener('pointercancel', () => { rulerDrag = null; rulerDirty = true; });
  const rulerMenu = (e) => {
    const r = rulerWrap.getBoundingClientRect();
    const beat = (e.clientX - r.left + scroller.scrollLeft) / ppb();
    const s = P().sections.find((s) => beat >= s.start && beat <= s.start + s.length);
    if (s && e.clientY - r.top < SEC_H) sectionMenu({ x: e.clientX, y: e.clientY }, s);
  };
  rulerWrap.addEventListener('contextmenu', (e) => { e.preventDefault(); rulerMenu(e); });
  longPress(rulerWrap, (pt) => { rulerDrag = null; rulerDirty = true; try { rulerWrap.releasePointerCapture(pt.pointerId); } catch (_) { /* gone */ } rulerMenu(pt); },
    { filter: (e) => e.target.tagName !== 'INPUT' && e.clientY - rulerWrap.getBoundingClientRect().top < SEC_H });

  /* ======================================================= device drops */
  const dropTarget = (e) => {
    const r = laneWrap.getBoundingClientRect();
    const y = e.clientY - r.top + scroller.scrollTop;
    const row = trackAtY(y);
    return { row, track: tracks()[row] || null };
  };
  const hasDevice = (e) => [...(e.dataTransfer?.types || [])].includes(DEVICE_MIME);
  // (a drag's data can't be read until the drop, so the device being dragged is noted as the drag starts: the lane's
  // line can say a melodic instrument over a drum lane makes a new track)
  let dragDev = null;
  const onDragStart = (e) => { const id = e.target?.closest?.('[data-device]')?.dataset?.device; dragDev = id ? app.devices.getDevice(id) || null : null; };
  const onDragEnd = () => { dragDev = null; };
  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragend', onDragEnd, true);
  const offDrag = () => { document.removeEventListener('dragstart', onDragStart, true); document.removeEventListener('dragend', onDragEnd, true); };
  for (const zone of [laneWrap, heads]) {
    zone.addEventListener('dragover', (e) => {
      if (!hasDevice(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const { row, track } = dropTarget(e);
      const split = !!(track && dragDev && dragDev.kind === 'instrument' && mismatch(dragDev, track));
      dropHi.hidden = false;
      dropHi.className = 'ar-drop' + (track && !split ? '' : ' ar-drop-new');
      const top = trackTop(track ? row : tracks().length) - scroller.scrollTop;
      dropHi.style.cssText = `top:${top}px;left:0;right:0;height:${track ? th() : 44}px`;
      dropHi.textContent = split ? `Drop for a new track with ${dragDev.name}` : track ? `Drop on ${track.name}` : 'Drop for a new track';
    });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) dropHi.hidden = true; });
    zone.addEventListener('drop', (e) => {
      if (!hasDevice(e)) return;
      e.preventDefault();
      dropHi.hidden = true;
      let info;
      try { info = JSON.parse(e.dataTransfer.getData(DEVICE_MIME)); } catch (_) { return; }
      dropDevice(info, dropTarget(e).track);
    });
  }
  // A melodic instrument on a drum track, or a kit on a pitched track with notes: a drop there makes a new track rather
  // than turning the hits into notes (rack.js isMismatch when the browser's package has it; the same rule here)
  function mismatch(def, t) {
    if (typeof rackKit.isMismatch === 'function') { try { return !!rackKit.isMismatch(def, t, P()); } catch (e) { /* the rule below */ } }
    if (!def || def.kind !== 'instrument' || !t || t.kind !== 'instrument') return false;
    const kit = def.cat === 'drums', drums = isDrumTrack(app, t);
    if (!kit && drums) return true;
    return kit && !drums && t.clips.some((c) => c.kind === 'notes' && c.notes?.length);
  }
  // A drop is a deliberate act: kept at once, one undo step signed you, with a toast and Undo (only a click in the
  // browser is a trial). A track still named after its old instrument takes the new one's name in the same step.
  function dropDevice(info, track) {
    const def = app.devices.getDevice(info?.id);
    if (!def) { ui.toast(`No device "${info?.id}"`, { kind: 'bad' }); return; }
    const kind = info.kind || def.kind;
    if (track && kind === 'instrument' && track.kind === 'instrument' && mismatch(def, track)) {
      const id = addTrack({ kind: 'instrument', name: def.name, instrument: { device: def.id, params: {} } });
      if (id) ui.toast(`New track with ${def.name}; ${track.name} keeps ${deviceName(app, track.instrument?.device)}.`, { kind: 'ok', action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    } else if (track && kind === 'instrument' && track.kind === 'instrument') {
      const was = deviceName(app, track.instrument?.device);
      if (track.instrument?.device === def.id) { ui.toast(`${track.name} plays ${def.name} already.`); ui.select({ track: track.id }); return; }
      // (a sound being tried on that track gives way to the one dropped: Back, quietly, then the drop)
      const tr = app.sounds?.trying?.();
      if (tr && !tr.newTrack && tr.track === track.id) app.sounds.back({ quiet: true });
      const name = track.name;
      const ops = [{ type: 'instrument.set', track: track.id, device: def.id }];
      if (name === was && def.name !== name) ops.push({ type: 'track.set', track: track.id, patch: { name: def.name } });
      const r = store.dispatch(ops, { by: 'you', label: `${name}: ${def.name} (was ${was})` });
      if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return; }
      ui.select({ track: track.id });
      ui.toast(`${name} plays ${def.name} now (was ${was}).`, { kind: 'ok', action: { label: 'Undo', run: () => store.undo({ id: r.txn?.id }) } });
    } else if (track && kind === 'effect') {
      store.dispatch({ type: 'insert.add', track: track.id, insert: { device: def.id } }, { by: 'you', label: `add ${def.name} to ${track.name}` });
      ui.select({ track: track.id });
    } else if (kind === 'instrument') {
      addTrack({ kind: 'instrument', name: def.name, instrument: { device: def.id, params: {} } });
    } else {
      addTrack({ kind: 'audio', name: def.name, instrument: null, inserts: [{ device: def.id }] });
    }
    flashTrackSoon = true;
  }
  let flashTrackSoon = false;

  /* ======================================================= keyboard: a clip cursor */
  // The selected clip is the cursor. Arrows walk it along a track and between tracks; every move is announced.
  const lanesFocused = () => document.activeElement === scroller;
  const bySt = (t) => shownClips(t).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  function cursor() {
    const sel = ui.state.selection;
    const f = sel.clip ? store.findClip(sel.clip) : null;
    if (f) return { t: f.track, c: f.clip };
    const t = sel.track && sel.track !== 'master' ? store.track(sel.track) : null;
    return t ? { t, c: null } : null;
  }
  function say(text) { said.textContent = ''; setTimeout(() => { said.textContent = text; }, 30); }
  function describe(t, c) {
    const bpb = bpbOf();
    if (!c) return `Track ${t.name}, ${t.clips.length ? `${t.clips.length} clip${t.clips.length === 1 ? '' : 's'}` : 'no clips'}.`;
    const b0 = Math.floor(c.start / bpb + 1e-9) + 1, b1 = Math.max(b0, Math.ceil((c.start + c.length) / bpb - 1e-9));
    const what = c.kind === 'notes' ? `${c.notes.length} note${c.notes.length === 1 ? '' : 's'}` : 'audio';
    const by = signersOf(c).length ? { text: signedText(signersOf(c)) } : null;   // (the house is unsigned, read aloud too)
    return `Track ${t.name}, clip ${c.name || t.name}, ${b0 === b1 ? `bar ${b0}` : `bars ${b0}–${b1}`}, ${what}${takeInfo.has(c.id) ? `, take ${takeInfo.get(c.id).k} of ${takeInfo.get(c.id).n}` : ''}${c.mute ? ', muted' : keptOffTrack(t) ? ', kept off: its instrument is silent until you play it' : ''}${by ? `, by ${by.text}` : ''}.`;
  }
  function moveTo(t, c) {
    if (c) { selClips = new Set([c.id]); ui.select({ track: t.id, clip: c.id, notes: [], range: null }); reveal(c.start); }
    else { selClips.clear(); ui.select({ track: t.id, clip: null, notes: [], range: null }); }
    revealTrack(t.id);
    dirty = true;
    say(describe(t, c));
  }
  function stepClip(dir) {
    const cur = cursor();
    const t = cur?.t || tracks().find((x) => x.clips.length) || tracks()[0];
    if (!t) return;
    const list = bySt(t);
    if (!list.length) { moveTo(t, null); return; }
    let i = cur?.c ? list.findIndex((x) => x.id === cur.c.id) : -1;
    if (i < 0) {
      const b = engine.beat || 0;
      i = dir > 0 ? Math.max(0, list.findIndex((x) => x.start + x.length > b)) : Math.max(0, list.length - 1 - list.slice().reverse().findIndex((x) => x.start <= b));
    } else i = clamp(i + dir, 0, list.length - 1);
    moveTo(t, list[i]);
  }
  function stepTrack(dir) {
    const cur = cursor();
    const all = tracks();
    if (!all.length) return;
    const i = cur ? all.indexOf(cur.t) : -1;
    const t = all[clamp(i < 0 ? 0 : i + dir, 0, all.length - 1)];
    const at0 = cur?.c ? cur.c.start : (engine.beat || 0);
    // the clip on the new track that sounds at the same time, else the nearest one
    const list = bySt(t);
    const c = list.find((x) => x.start <= at0 + 1e-6 && x.start + x.length > at0) || list.slice().sort((a, b) => Math.abs(a.start - at0) - Math.abs(b.start - at0))[0] || null;
    moveTo(t, c);
  }
  function cursorMenu() {
    const cur = cursor();
    if (!cur) return;
    const r = cur.c ? clipRect(cur.t, cur.c) : null;
    const box = scroller.getBoundingClientRect();
    const i = tracks().indexOf(cur.t);
    const pt = r ? { x: box.left + clamp(r.x + 12, 0, box.width - 20), y: box.top + clamp(r.y + 18, 0, box.height - 10) } : { x: box.left + 20, y: box.top + clamp(trackTop(i) - scroller.scrollTop + 18, 0, box.height - 10) };
    if (cur.c) clipMenu(pt, cur.t, cur.c); else trackMenu(pt, cur.t);
  }

  /* ======================================================= keyboard: the section strip */
  // The selected section is the cursor here. ←/→ walk the sections in time order and select each one's bars (what a
  // click on it does), so mod+D, Delete and the menu act on it; every move is announced.
  const rulerFocused = () => document.activeElement === rulerWrap;
  const sectionsInOrder = () => P().sections.slice().sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const curSection = () => P().sections.find((x) => x.id === selSection) || null;
  function barsOf(s) {
    const bpb = bpbOf();
    const a = Math.floor(s.start / bpb + 1e-9) + 1, b = Math.max(a, Math.ceil((s.start + s.length) / bpb - 1e-9));
    return a === b ? `bar ${a}` : `bars ${a}–${b}`;
  }
  function pickSection(s) {
    selSection = s.id; selClips.clear();
    ui.select({ clip: null, notes: [], range: { from: s.start, to: s.start + s.length } });
    reveal(s.start);
    rulerDirty = true; dirty = true;
    syncBar();
    const list = sectionsInOrder();
    say(`Section ${s.name}, ${barsOf(s)}, ${list.indexOf(s) + 1} of ${list.length}.`);
  }
  function stepSection(dir) {
    const list = sectionsInOrder();
    if (!list.length) { say('No sections yet. The plus beside Sections adds one.'); return; }
    let i = list.findIndex((x) => x.id === selSection);
    if (dir === -Infinity) i = 0;
    else if (dir === Infinity) i = list.length - 1;
    else if (i < 0) {
      // nothing picked yet: start from the playhead, as a cursor (on a section's first beat, ← is the one before it)
      const b = engine.beat || 0;
      i = dir > 0 ? list.findIndex((x) => x.start + x.length > b) : list.length - 1 - list.slice().reverse().findIndex((x) => x.start < b - 1e-9);
      if (i < 0 || i >= list.length) i = dir > 0 ? list.length - 1 : 0;
    } else i = clamp(i + dir, 0, list.length - 1);
    pickSection(list[i]);
  }
  // where a section's menu opens from the keyboard: under its name on the strip
  function sectionPoint(s) {
    const r = rulerWrap.getBoundingClientRect();
    return { x: r.left + clamp(s.start * ppb() - scroller.scrollLeft + 12, 0, Math.max(0, r.width - 20)), y: r.top + SEC_H };
  }
  function sectionKeyMenu() {
    let s = curSection();
    if (!s) { stepSection(1); s = curSection(); }
    if (s) sectionMenu(sectionPoint(s), s);
  }
  // the section a clip starts in, or the one under the playhead (for the clip and track menus)
  const sectionAt = (beat) => sectionsInOrder().find((x) => beat >= x.start - 1e-6 && beat < x.start + x.length - 1e-6) || null;
  const sectionItem = (at, s) => (s ? ['-', { label: `Section ${s.name}…`, sub: 'duplicate, insert or delete bars', title: `${s.name}, ${barsOf(s)}: duplicate it, insert bars after it, or delete its bars`, run: () => sectionMenu(at, s) }] : []);

  /* ======================================================= keys */
  const mine = () => !ui.state.focus || ui.state.focus === 'arranger';
  // the selected bars, when L would loop something new: a range that isn't already the loop playing
  function loopableRange() {
    const r = ui.state.selection.range, l = P().loop;
    if (!r || !(r.to - r.from >= 0.25 - 1e-9)) return null;
    if (l?.on && Math.abs(l.start - r.from) < 1e-6 && Math.abs(l.end - r.to) < 1e-6) return null;
    return r;
  }
  function loopSelection() {
    const r = loopableRange();
    if (!r) return null;
    const res = store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: r.from, end: r.to } } }, { by: 'you', label: 'loop the selected bars' });
    if (!res.ok) { ui.toast(res.error, { kind: 'bad' }); return res; }
    ui.toast([`Looping ${loopSpan()}. `, ...(touchFirst() ? [] : [h('kbd', 'L'), ' again turns the loop off.'])], { ms: 2600 });
    rulerDirty = true; dirty = true;
    return res;
  }
  // a lane point selected (lanes.js): these come first, so they win over the clip keys while it is
  const laneSel = () => !!laneEd.sel && rows().lanes.has(laneEd.sel.key);
  const selTrack = () => { const id = ui.state.selection.track; return id && id !== 'master' ? store.track(id) : null; };
  const offs = [
    ui.keys.add({ key: 'KeyE', when: () => mine() && !app.input?.qwerty?.on, run: () => { if (selTrack()) toggleLanes(selTrack().id); else ui.toast('Select a track first: E shows its automation lanes.', { ms: 2400 }); }, label: 'Show or hide the selected track’s automation lanes', group: 'Arrange' }),
    ui.keys.add({ key: 'KeyC', mod: 'mod', when: () => mine() && laneSel(), run: () => laneEd.copy(), label: 'Copy the selected lane points', group: 'Arrange' }),
    ui.keys.add({ key: 'KeyV', mod: 'mod', when: () => mine() && laneEd.canPaste() && (laneSel() || rows().lanes.size > 0), run: () => laneEd.paste(), label: 'Paste lane points at the playhead', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowRight', when: () => lanesFocused() && laneSel(), run: () => laneEd.stepPoint(1), label: 'The next point on the lane', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowLeft', when: () => lanesFocused() && laneSel(), run: () => laneEd.stepPoint(-1), label: 'The previous point on the lane', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowUp', when: () => lanesFocused() && laneSel(), run: () => laneEd.nudge(1, false), label: 'Raise the selected points', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowDown', when: () => lanesFocused() && laneSel(), run: () => laneEd.nudge(-1, false), label: 'Lower the selected points', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowUp', mod: 'shift', when: () => lanesFocused() && laneSel(), run: () => laneEd.nudge(1, true), label: 'Raise the selected points a lot', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'ArrowDown', mod: 'shift', when: () => lanesFocused() && laneSel(), run: () => laneEd.nudge(-1, true), label: 'Lower the selected points a lot', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'Delete', when: () => mine() && laneSel(), run: () => laneEd.deleteSelected(), label: 'Delete the selected lane points', group: 'Arrange' }),
    ui.keys.add({ key: 'Backspace', when: () => mine() && laneSel(), run: () => laneEd.deleteSelected(), label: 'Delete the selected lane points', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'Escape', when: () => mine() && laneSel(), run: () => { laneEd.sel = null; }, label: 'Clear the lane selection', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'ArrowRight', when: lanesFocused, run: () => stepClip(1), label: 'The next clip on the track', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowLeft', when: lanesFocused, run: () => stepClip(-1), label: 'The previous clip on the track', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowDown', when: lanesFocused, run: () => stepTrack(1), label: 'The track below', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowUp', when: lanesFocused, run: () => stepTrack(-1), label: 'The track above', group: 'Arrange' }),
    ui.keys.add({ key: 'Enter', when: () => lanesFocused() && !!cursor()?.c, run: () => { const c = cursor(); editClip(c.t.id, c.c.id); }, label: 'Open the clip in its editor', group: 'Arrange' }),
    ui.keys.add({ key: 'F2', when: () => lanesFocused() && !!cursor(), run: () => { const c = cursor(); if (c.c) renameClip(c.t, c.c); else { const n = headsInner.querySelector(`[data-track="${c.t.id}"] .ar-hname`); if (n) renameTrack(c.t, n); } }, label: 'Rename the clip (or track)', group: 'Arrange' }),
    ui.keys.add({ key: 'F10', mod: 'shift', when: () => lanesFocused() && laneSel(), run: laneKeyMenu, label: 'The lane point’s menu: its curve, shapes', group: 'Arrange' }),
    ui.keys.add({ key: 'ContextMenu', when: () => lanesFocused() && laneSel(), run: laneKeyMenu, label: 'The lane point’s menu', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'F10', mod: 'shift', when: () => lanesFocused() && !!cursor(), run: cursorMenu, label: 'The clip’s menu', group: 'Arrange' }),
    ui.keys.add({ key: 'ContextMenu', when: () => lanesFocused() && !!cursor(), run: cursorMenu, label: 'The clip’s menu', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'ArrowRight', when: rulerFocused, run: () => stepSection(1), label: 'The next section (the section strip focused)', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowLeft', when: rulerFocused, run: () => stepSection(-1), label: 'The previous section', group: 'Arrange' }),
    ui.keys.add({ key: 'Home', when: rulerFocused, run: () => stepSection(-Infinity), label: 'The first section', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'End', when: rulerFocused, run: () => stepSection(Infinity), label: 'The last section', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'F2', when: () => rulerFocused() && !!curSection(), run: () => renameSection(selSection), label: 'Rename the section', group: 'Arrange' }),
    ui.keys.add({ key: 'F10', mod: 'shift', when: rulerFocused, run: sectionKeyMenu, label: 'The section’s menu: duplicate, insert or delete bars', group: 'Arrange' }),
    ui.keys.add({ key: 'ContextMenu', when: rulerFocused, run: sectionKeyMenu, label: 'The section’s menu', group: 'Arrange', hidden: true }),
    ui.keys.add({ key: 'Delete', when: () => mine() && (selClips.size > 0 || !!selSection), run: deleteSelected, label: 'Delete the selected clips', group: 'Arrange' }),
    ui.keys.add({ key: 'Backspace', when: () => mine() && (selClips.size > 0 || !!selSection), run: deleteSelected, label: 'Delete the selected clips', group: 'Arrange' }),
    ui.keys.add({ key: 'KeyD', mod: 'mod', when: () => mine() && selClips.size > 0, run: duplicateSelected, label: 'Duplicate the selected clips after themselves', group: 'Arrange' }),
    ui.keys.add({ key: 'KeyD', mod: 'mod', when: () => mine() && !selClips.size && P().sections.some((x) => x.id === selSection), run: () => duplicateSection(P().sections.find((x) => x.id === selSection)), label: 'Duplicate the selected section and its clips', group: 'Arrange' }),
    // ⌘E splits from any panel: nothing else uses it, and the selected clips are the arrangement's (no clip selected,
    // the shell says what it would split)
    ui.keys.add({ key: 'KeyE', mod: 'mod', when: () => selectedList().length > 0, run: splitKey, label: 'Split the selected clips at the playhead (on the snap grid)', group: 'Arrange' }),
    ui.keys.add({ key: 'Digit0', when: () => mine() && selClips.size > 0, run: toggleMuteSelected, label: 'Mute / unmute the selected clips', group: 'Arrange' }),
    ui.keys.add({ key: 'KeyA', mod: 'mod', when: mine, run: () => { selClips = new Set(tracks().flatMap((t) => t.clips.map((c) => c.id))); dirty = true; syncBar(); }, label: 'Select every clip', group: 'Arrange' }),
    ui.keys.add({ key: 'Escape', when: () => mine() && (selClips.size > 0 || !!ui.state.selection.range || !!selSection), run: () => { selClips.clear(); selSection = null; ui.select({ clip: null, range: null, notes: [] }); dirty = true; syncBar(); }, label: 'Clear the selection', group: 'Arrange' }),
    // a take stack: the selected clip's previous / next take (free in every panel: Notes uses plain, Shift and Alt arrows)
    ui.keys.add({ key: 'ArrowUp', mod: 'mod', when: () => !!stackOf(), run: () => stepTake(-1), label: 'The previous take of the selected clip', group: 'Arrange' }),
    ui.keys.add({ key: 'ArrowDown', mod: 'mod', when: () => !!stackOf(), run: () => stepTake(1), label: 'The next take of the selected clip', group: 'Arrange' }),
    // its take lanes, one per take under it: drag across one to comp
    // (with no take selected it closes any that are open)
    ui.keys.add({ key: 'KeyT', mod: 'alt', when: () => !!stackOf() || takesOpen.size > 0, run: () => {
      const st = stackOf(), f = st && store.findClip(ui.state.selection.clip);
      if (f) { toggleTakes(st.track, f.clip); return; }
      takesOpen.clear(); takesVer++; relayout(); say('The take lanes are closed.');
    }, label: 'Show or hide the take lanes of the selected clip', group: 'Arrange' }),
    // L with bars selected loops them (L alone, or on the bars already looping, is the transport's: the loop on / off;
    // while the home row plays notes or pads, or a take runs, L is theirs)
    ui.keys.add({ key: 'KeyL', when: () => !!loopableRange() && !app.input?.mode && !app.input?.qwerty?.on && !app.transport?.locked?.(), run: loopSelection, label: 'Loop the selected bars', group: 'Arrange', feature: 'loop' }),
    ui.keys.add({ key: 'Equal', mod: 'mod', when: mine, run: () => zoomBy(1.4), label: 'Zoom in', group: 'Arrange' }),
    ui.keys.add({ key: 'Minus', mod: 'mod', when: mine, run: () => zoomBy(1 / 1.4), label: 'Zoom out', group: 'Arrange' }),
  ];

  /* ======================================================= empty state */
  // A take counting in or recording onto the blank sheet (a hum from Sketch makes its Melody at the stop): the sheet says
  // so, in place of the ways in, which would start another take over it
  let emptyTake = '';
  const takeNote = h('div.ar-empty-take', { role: 'status', 'aria-live': 'polite', hidden: true });
  function syncEmptyTake(live) {
    const st = live ? live.state : '', name = live && !live.track ? newPartFor(app.input?.recorder?.humming?.() ? 'hum' : 'keys', store.get()).name : '';
    const key = `${st}:${name}`;
    if (key === emptyTake) return;
    emptyTake = key;
    const card = empty.querySelector('.ar-empty-card');
    if (card) card.hidden = !!st;
    takeNote.hidden = !st;
    if (!st) return;
    const bpb = Math.ceil(bpbOf() - 1e-9);
    takeNote.replaceChildren(h('h2.ar-empty-title.disp', st === 'count' ? 'Counting in.' : 'Recording.'),
      h('p.ar-empty-text', st === 'count' ? `Come in right after the ${bpb}.` : `The take lands here${name ? ` on a new track, ${name},` : ''} when you stop.`));
  }
  function syncEmpty() {
    const isEmpty = tracks().length === 0;
    empty.hidden = !isEmpty;
    root.classList.toggle('ar-isempty', isEmpty);
    if (!isEmpty) emptyTake = '';
    if (!isEmpty || empty.childElementCount) return;
    empty.append(takeNote);
    const sketch = () => (ui.panels.has('sketch') ? ui.show('sketch') : ui.toast('Sketch is still loading. It listens while you hum, tap or play.'));
    const pr = store.get();
    // the blank sheet before the first take: a head, a sentence, one primary (Tap a beat: the first minute is built
    // around it, and a beat gives a hum a tempo and a grid), the other ways in as plain buttons
    empty.append(h('div.ar-empty-card',
      h('h2.ar-empty-title.disp', 'Take 1 is yours.'),
      h('p.ar-empty-text', `Hum it, tap it, play it, or ask your agent. Every take is kept and signed with who played it, at ${pr.tempo || 120} BPM until you change it.`),
      h('div.ar-empty-actions',
        // Tap a beat is the first minute (app.onboard.firstMinute: Drums, a 2-bar loop with the click, R and tap)
        h('button.btn.btn-go', { type: 'button', onclick: () => (typeof app.onboard?.firstMinute === 'function' ? app.onboard.firstMinute('tap') : sketch()) }, 'Tap a beat'),
        // (no playing in time: a beat clicked in square by square, in the Beat tab: ui/drumgrid.js app.beat.draw)
        h('button.btn', { type: 'button', title: 'Click squares in the Beat tab: nothing to play in time', onclick: () => (app.beat?.draw ? app.beat.draw() : ui.show('drumgrid')) }, 'Draw a beat'),
        h('button.btn', { type: 'button', onclick: sketch }, 'Hum it'),
        h('button.btn', { type: 'button', onclick: () => addTrack({ kind: 'instrument', name: 'Keys', instrument: { device: app.devices.getDevice('core.keys') ? 'core.keys' : 'core.poly', params: {} } }) }, 'Play it'),
        h('button.btn.ar-empty-agent', { type: 'button', onclick: () => { if (!showAgent(ui)) ui.toast('The agent panel is loading'); } }, icon('agent', { size: 15 }), 'Ask your agent')),
      // the foot: a finished song to hear; "add a track" is Track tools, so the simple view reads "Or hear a finished
      // one: Night Shift." and the full studio "Or add a track yourself, or hear a finished one: Night Shift."
      h('p.ar-empty-foot', 'Or ', h('span', { dataset: { feature: 'tracks' } }, h('button.ar-link', { type: 'button', onclick: (e) => addTrackMenu(e.currentTarget) }, 'add a track'), ' yourself, or '), 'hear a finished one: ', h('button.ar-link.ar-empty-demo', { type: 'button', onclick: async () => { if (app.exporter?.openDemo) { app.exporter.openDemo(); return; } const m = await import('../core/demo.js'); store.load(m.demoProject(), { by: 'overdub' }); } }, 'Night Shift'), '.')));
  }

  /* ======================================================= drawing */
  // Who signs a clip: whoever made it, then whoever wrote notes in it (a note keeps its own author: the agent's notes
  // kept into your clip are the agent's), the house left out. [{ by, kind, text }]
  function signersOf(c) {
    let list = signers.get(c.id);
    if (list) return list;
    list = [];
    const add = (by) => { if (!by || list.some((x) => x.by === by)) return; const b = bylineOf(app, by); if (b) list.push({ by, ...b }); };
    add(c.by);
    if (c.kind === 'notes') for (const n of c.notes) add(n.by);
    signers.set(c.id, list);
    return list;
  }
  // "you", "you and Claude", "you, Claude and Ana"
  const signedText = (list) => (list.length < 2 ? list.map((x) => x.text).join('') : `${list.slice(0, -1).map((x) => x.text).join(', ')} and ${list[list.length - 1].text}`);
  function statsOf(c) {
    let s = preview.get(c.id);
    if (s) return s;
    const ps = [...new Set(c.notes.map((n) => n.p))].sort((a, b) => b - a);
    if (ps.length <= 16 && ps.length) {
      const idx = new Map(ps.map((p, i) => [p, i]));
      s = { rows: Math.max(ps.length, 4), row: (p) => idx.get(p) + Math.max(0, (4 - ps.length) / 2) };
    } else if (ps.length) {
      const hi = ps[0] + 1, lo = ps[ps.length - 1] - 1;
      s = { rows: hi - lo + 1, row: (p) => hi - p };
    } else s = { rows: 1, row: () => 0 };
    preview.set(c.id, s);
    return s;
  }
  function wave(asset) {
    let w = waves.get(asset);
    if (w) return w;
    w = { state: 'loading' };
    waves.set(asset, w);
    Promise.resolve(engine.assets?.get?.(asset)).then((buf) => {
      if (!buf || !buf.length) { w.state = 'missing'; dirty = true; return; }
      const n = Math.min(200000, Math.max(256, Math.round(buf.duration * 300)));
      const peaks = new Float32Array(n * 2);
      const chs = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
      const per = buf.length / n;
      for (let i = 0; i < n; i++) {
        let mn = 0, mx = 0;
        const a = Math.floor(i * per), b = Math.min(buf.length, Math.floor((i + 1) * per));
        const step = Math.max(1, Math.floor((b - a) / 64));
        for (let j = a; j < b; j += step) for (const ch of chs) { const v = ch[j]; if (v < mn) mn = v; if (v > mx) mx = v; }
        peaks[i * 2] = mn; peaks[i * 2 + 1] = mx;
      }
      Object.assign(w, { state: 'ready', peaks, n, dur: buf.duration });
      dirty = true;
    }).catch(() => { w.state = 'missing'; dirty = true; });
    return w;
  }

  // phones: a clip's label shows no byline unless the clip is selected (design/LINER-NOTES-KIT.md, bylines)
  const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  let arrivals = [];             // crop marks to draw over the clips this frame: { x, y, w, h, color, a }

  function drawLanes(now) {
    const { g, w: W, h: H } = lanes;
    const pal = palette();
    const p = P();
    const bpb = bpbOf();
    const sx = scroller.scrollLeft, sy = scroller.scrollTop;
    const pb = ppb(), TH = th();
    g.clearRect(0, 0, W, H);
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, W, H);
    const b0 = Math.max(0, Math.floor(sx / pb)), b1 = Math.ceil((sx + W) / pb);
    const anySolo = p.tracks.some((t) => t.solo);
    const sel = ui.state.selection;
    const L = rows();
    const rowsEnd = Math.max(L.total, L.end || 0) - sy;
    arrivals = [];
    badges.clear();

    // the grid: bar lines in the bar rule, beats in the hairline (no zebra rows, no washes: the room and its rules)
    const beatLines = pb >= 10;
    for (let b = b0; b <= b1; b++) {
      const x = Math.round(b * pb - sx) + 0.5;
      const isBar = b % bpb === 0;
      if (!isBar && !beatLines) continue;
      if (isBar && pb * bpb < 14 && (b / bpb) % 4) continue;
      g.fillStyle = isBar ? rgba(pal.line2, (b / bpb) % 4 === 0 ? 1 : 0.7) : rgba(pal.line, 0.6);
      g.fillRect(x - 0.5, 0, 1, Math.max(0, rowsEnd));
    }
    // a hairline under each track (and each of its open lanes)
    for (const r of L.rows) {
      const y = r.y + r.h - sy - 1;
      if (y < -1 || y > H) continue;
      g.fillStyle = pal.line; g.fillRect(0, y, W, 1);
    }
    // section starts: a pencil hairline down through the lanes
    for (const s of p.sections) {
      const x = Math.round(s.start * pb - sx);
      if (x < -2 || x > W) continue;
      g.fillStyle = rgba(pal.text3, 0.4);
      g.fillRect(x, 0, 1, Math.max(0, rowsEnd));
    }
    // the loop's two ends, dotted in grease pencil (the loop itself is the line on the ruler)
    if (p.loop?.on) {
      g.save();
      g.strokeStyle = rgba(pal.accent2, 0.5); g.lineWidth = 1; g.setLineDash([2, 3]);
      for (const b of [p.loop.start, p.loop.end]) {
        const x = Math.round(b * pb - sx) + 0.5;
        if (x < -1 || x > W + 1) continue;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, Math.max(0, rowsEnd)); g.stroke();
      }
      g.restore();
    }
    // the selected bars: a cream hairline frame around them
    if (sel.range) {
      const x0 = sel.range.from * pb - sx, x1 = sel.range.to * pb - sx;
      const rows = sel.track ? [p.tracks.findIndex((t) => t.id === sel.track)] : rangeRows && !selSection ? rangeRows : [0, p.tracks.length - 1];
      const r0 = Math.max(0, rows[0]), r1 = Math.max(r0, rows[1] ?? rows[0]);
      const y0 = trackTop(r0) - sy, y1 = trackTop(r1) + TH - sy;
      g.fillStyle = rgba(pal.text, 0.035);
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = rgba(pal.text, 0.5); g.lineWidth = 1;
      g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0) - 1, Math.round(y1 - y0) - 1);
    }

    // clips
    const d = drag;
    const moving = d && d.mode === 'move' && d.moved;
    const movingIds = moving ? new Set(d.items.map((it) => it.c.id)) : null;
    p.tracks.forEach((t, i) => {
      const y = trackTop(i) - sy;
      if (y > H || y + TH < 0) return;
      const quiet = t.mute || (anySolo && !t.solo);
      for (const c of t.clips) {
        if (hiddenTake(c)) continue;
        let start = c.start, length = c.length;
        if (d && d.moved && d.c === c && d.mode === 'resize-r') length = d.len;
        if (d && d.moved && d.c === c && d.mode === 'resize-l') { start = d.start; length = d.len; }
        const x = start * pb - sx, w = length * pb;
        if (x > W || x + w < 0) continue;
        const ghost = moving && movingIds.has(c.id) && !d.copy;
        drawClip(g, t, c, x, y + 4, w, TH - 8, { quiet, ghost, now, start, length, trimL: d && d.moved && d.c === c && d.mode === 'resize-l' ? d.start - c.start : 0 });
      }
    });
    // the clips being moved, at their new place (they float, so they cast the one shadow)
    if (moving) {
      for (const it of d.items) {
        if (hiddenTake(it.c)) continue;   // (a folder's muted takes go along unseen, as they sit unseen)
        const row = it.row + d.dRow;
        const x = (it.start + d.dBeat) * pb - sx, y = trackTop(row) - sy + 4;
        g.save();
        g.globalAlpha = d.bad ? 0.4 : 0.94;
        drawClip(g, it.t, it.c, x, y, it.c.length * pb, TH - 8, { lifted: true, now, start: it.start, length: it.c.length });
        g.restore();
        if (d.bad) { g.strokeStyle = pal.rec; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeRect(Math.round(x) + 0.75, y + 0.75, Math.round(it.c.length * pb) - 1.5, TH - 9.5); g.setLineDash([]); }
      }
    }
    // the bars being dragged across
    if (d && d.mode === 'range' && d.moved && d.range) {
      const x0 = d.range.from * pb - sx, x1 = d.range.to * pb - sx;
      const y0 = trackTop(d.rows[0]) - sy, y1 = trackTop(d.rows[1]) + TH - sy;
      g.fillStyle = rgba(pal.text, 0.06); g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = rgba(pal.text, 0.8); g.lineWidth = 1; g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0) - 1, Math.round(y1 - y0) - 1);
    }
    // an open take folder's lanes under its track
    drawTakeRows(g, now, L);
    // the automation lanes under their tracks (lanes.js)
    drawLaneRows(g, now, L);
    // the take being written: its region in record ink, what lands in it, the count-in numeral
    drawRecording(g, now);
    // parts just arriving: crop marks in their author's ink, then gone
    for (const a of arrivals) { g.save(); g.globalAlpha = a.a; drawCrop(g, a.x, a.y, a.w, a.h, { color: a.color }); g.restore(); }
    // what an agent is pointing at: grease-pencil crop marks and its note
    drawPresence(g);
  }

  // The take lanes of an open folder: each take's clips in a row of its own, the pieces that play (the comp) printed
  // as clips are, the rest in outline; the stretch being dragged across in a cream frame
  function drawTakeRows(g, now, L) {
    const W = lanes.w, H = lanes.h, sx = scroller.scrollLeft, sy = scroller.scrollTop, pb = ppb(), pal = palette();
    const anySolo = P().tracks.some((t) => t.solo), d = drag;
    for (const r of L.rows) {
      if (r.kind !== 'take') continue;
      const y = r.y - sy;
      if (y > H || y + r.h < 0) continue;
      const quiet = r.t.mute || (anySolo && !r.t.solo);
      for (const f of r.folders) {
        const lane = f.lanes[r.k];
        if (!lane) continue;
        for (const c of lane.clips) {
          const x = c.start * pb - sx, w = c.length * pb;
          if (x > W || x + w < 0) continue;
          drawClip(g, r.t, c, x, y + 2, w, r.h - 4, { quiet, now, inLane: true });
        }
      }
      if (d && d.mode === 'comp' && d.moved && d.range && d.row.t === r.t && d.row.k === r.k) {
        const x0 = d.range.from * pb - sx, x1 = d.range.to * pb - sx;
        g.fillStyle = rgba(pal.text, 0.08); g.fillRect(x0, y + 1, x1 - x0, r.h - 2);
        g.strokeStyle = pal.text; g.lineWidth = 1.5; g.strokeRect(Math.round(x0) + 0.75, Math.round(y) + 1.75, Math.round(x1 - x0) - 1.5, r.h - 3.5);
      }
    }
  }

  // A clip, printed: the track's colour at 13% with a 42% hairline, a label line (the name in the track's colour, the
  // byline at the right end), the notes or the wave. Selected: a 1.5 px cream frame and the label in reverse. Muted:
  // no fill, a dashed frame, hollow pencil notes, the name struck and "muted" where the byline was. On a track whose
  // instrument is kept off (a song's code this browser hasn't allowed: it plays silence) the clip is silent too: drawn
  // as a muted one is, but its name not struck (nobody muted it) and "kept off" where the byline was.
  function drawClip(g, t, c, x, y, w, hh, o = {}) {
    const pal = palette();
    const off = !c.mute && !o.inLane && keptOffTrack(t);
    const muted = !!c.mute || off;
    const col = resolveColor(c.color || t.color);
    const sel = selClips.has(c.id);
    const hov = hover?.clip === c.id;
    const by = bylineOf(app, c.by);
    // whole pixels, so the hairlines are crisp
    const X = Math.round(x);
    w = Math.max(3, Math.round(x + w) - X); x = X; y = Math.round(y);
    g.save();
    if (o.ghost) g.globalAlpha = 0.28;
    else if (o.quiet) g.globalAlpha = 0.45;
    if (o.lifted) {
      // it floats: the room under it (opaque, so it reads over the lanes) casts the shadow, nothing else does
      g.save(); g.shadowColor = 'rgba(8, 7, 5, .6)'; g.shadowBlur = 14; g.shadowOffsetY = 4;
      g.fillStyle = pal.bg; g.fillRect(x, y, w, hh); g.restore();
    }
    if (!muted) { g.fillStyle = rgba(col, hov && !sel ? 0.17 : 0.13); g.fillRect(x, y, w, hh); }
    g.save();
    g.beginPath(); g.rect(x, y, w, hh); g.clip();
    // (a piece in a take lane has no label line: the lane's head names the take and signs it, and a comp's every cut
    // would otherwise print "Tak…" and a byline again on each piece)
    const HH = o.inLane ? 0 : Math.min(16, Math.max(0, Math.floor(hh * 0.4)));
    if (sel && HH >= 8) { g.fillStyle = pal.text; g.fillRect(x, y, w, HH); }
    const top = y + HH + 2, bot = y + hh - 3;
    if (c.kind === 'notes') drawNotesPreview(g, c, x, top, w, bot - top, col, { ...o, muted, by });
    else drawWave(g, c, x, top, w, bot - top, muted ? pal.text3 : col, muted);
    if (w > 18 && HH >= 11) drawClipLabel(g, t, c, x, y, w, HH, { sel, muted, off, by, col, inLane: !!o.inLane });
    else if (!o.inLane) labels.set(c.id, null);
    g.restore();
    // the frame
    if (sel) {
      g.strokeStyle = pal.text; g.lineWidth = 1.5;
      if (muted) g.setLineDash([4, 3]);
      g.strokeRect(x + 0.75, y + 0.75, w - 1.5, hh - 1.5);
      g.setLineDash([]);
    } else if (muted) {
      g.strokeStyle = hov ? pal.text3 : pal.line2; g.lineWidth = 1; g.setLineDash([4, 3]);
      g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
      g.setLineDash([]);
    } else {
      g.strokeStyle = rgba(col, hov ? 0.7 : 0.42); g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
    }
    // the edge under the pointer: a trim handle (drag it to cut a long take down)
    if (hov && (hover.zone === 'l' || hover.zone === 'r') && !drag) {
      g.fillStyle = pal.text;
      g.fillRect(hover.zone === 'l' ? x + 2 : x + w - 4, y + 3, 2, hh - 6);
    }
    g.restore();
    // arriving (an agent's edit, a kept take, a band): crop marks in the author's ink, drawn once the lanes are done
    const fl = Math.max(flash.level(c.id, o.now), flash.level(t.id, o.now));
    if (fl > 0 && !o.lifted && !o.ghost) arrivals.push({ x, y, w, h: hh, color: flashCol.get(c.id) || pal.agent, a: Math.min(1, fl * 4) });
  }

  // The label line: the name at the left, the byline (or "muted") at the right. Crowded, the byline drops first;
  // "muted" holds on until the name would be cut to a stub, since it's the state and the byline is the credit.
  function drawClipLabel(g, t, c, x, y, w, HH, { sel, muted, off = false, by, col, inLane = false }) {
    const pal = palette();
    const mid = y + HH / 2 + 1;
    const pad = w > 40 ? 6 : 3;
    g.textBaseline = 'middle';
    let right = null;
    // (in a take lane a take that doesn't play there is drawn in outline: that is the comp, not a mute to undo)
    if (off) right = { text: 'kept off', color: sel ? pal.bg : pal.text3, font: `400 11px ${pal.ui}` };
    else if (muted && !inLane) right = { text: 'muted', color: sel ? pal.bg : pal.text3, font: `400 11px ${pal.ui}` };
    else if (by && (sel || !narrow())) {
      // signed by everyone who wrote in it: "you and Claude", each name in its own ink, the joins in pencil
      const list = signersOf(c).length ? signersOf(c) : [{ ...by }];
      const ink = (x) => (sel ? pal.bg : x.kind === 'agent' ? pal.agent : pal.human);
      const segs = [];
      list.forEach((x, i) => { if (i) segs.push({ text: i === list.length - 1 ? ' and ' : ', ', color: sel ? pal.bg : pal.text3, join: true }); segs.push({ text: x.text, color: ink(x) }); });
      right = { text: signedText(list), segs, color: ink(list[0]), font: `600 11px ${pal.ui}` };
    }
    const nameFont = `600 11.5px ${pal.ui}`;
    let name = c.name || t.name;
    g.font = nameFont;
    const nw = g.measureText(name).width;
    let rw = 0;
    if (right) { g.font = right.font; rw = right.segs ? right.segs.reduce((m, sg) => { g.font = sg.join ? `400 11px ${pal.ui}` : right.font; return m + g.measureText(sg.text).width; }, 0) : g.measureText(right.text).width; }
    let room = w - pad * 2;
    // a take stack: "3 takes" in mono before the byline (the byline drops first, then this)
    const st = inLane ? null : takeInfo.get(c.id);
    // (a piece of a comp is named whole or not at all: side by side, "Tak…" next to "Cha…" says nothing)
    const whole = !!st || (!inLane && !!c.take);
    const stub = whole ? 0 : Math.min(nw, 14);
    const badge = st && st.first ? { text: `${st.lanes} takes`, font: `400 10.5px ${pal.mono}` } : null;
    let bw = 0;
    if (badge) { g.font = badge.font; bw = Math.ceil(g.measureText(badge.text).width); }
    if (right && nw + 10 + rw + (badge ? bw + 10 : 0) > room && (!muted || room - rw - 10 - (badge ? bw + 10 : 0) < Math.min(nw, 26))) right = null;
    if (!inLane) labels.set(c.id, right ? right.text : null);
    if (right) {
      g.font = right.font;
      if (right.segs) {
        let rx = x + w - pad - rw;
        for (const sg of right.segs) { g.font = sg.join ? `400 11px ${pal.ui}` : right.font; g.fillStyle = sg.color; g.fillText(sg.text, rx, mid); rx += g.measureText(sg.text).width; }
      } else { g.fillStyle = right.color; g.fillText(right.text, x + w - pad - rw, mid); }
      room -= rw + 10;
    }
    if (badge && room - bw - (stub ? 10 : 0) >= stub) {
      // (on a clip longer than the view, it stays in sight at the view's right edge)
      const bx = Math.max(x + pad + (stub ? stub + 10 : 0), Math.min(x + pad + room - bw, lanes.w - pad - bw - (right ? rw + 10 : 0)));
      g.font = badge.font; g.fillStyle = sel ? pal.bg : pal.text2;
      g.fillText(badge.text, bx, mid);
      // (underlined, like a word you can press: it opens the stack's menu)
      g.fillRect(bx, Math.round(mid + 6), bw, 1);
      badges.set(c.id, { x: bx, y: y, w: bw, h: HH });
      room -= bw + 10;
    }
    g.font = nameFont;
    if (nw > room && whole) name = '';
    else if (nw > room) {
      while (name.length > 1 && g.measureText(name + '…').width > room) name = name.slice(0, -1);
      name = name.length > 1 && g.measureText(name + '…').width <= room ? name + '…' : '';
    }
    if (!name) return;
    g.fillStyle = sel ? pal.bg : muted ? pal.text3 : col;
    g.fillText(name, x + pad, mid);
    if (muted && !off && !inLane) g.fillRect(x + pad, Math.round(mid), Math.ceil(g.measureText(name).width), 1);
  }

  // the notes in the clip's own colour: who played them is the byline on the label line. A clip more than one author
  // wrote in (the agent's notes kept into yours) keeps each note's own ink as an outline round the notes that aren't
  // its maker's, cool for an agent, warm for a person, so they still read at this zoom (CLAUDE.md: notes keep a warm
  // or cool outline). Muted: hollow pencil outlines.
  function drawNotesPreview(g, c, x, y, w, hh, col, o) {
    if (hh < 4 || !c.notes.length) return;
    const pal = palette();
    const s = statsOf(c);
    const pb = ppb();
    const rowH = hh / s.rows;
    const nh = clamp(rowH - 1, 1.5, 5);
    const trim = o.trimL || 0;
    const len = o.length ?? c.length;
    const base = o.ghost ? 0.28 : o.quiet ? 0.45 : 1;
    // x is already in view coordinates (scroll taken off), so the first visible beat of the clip is just -x / pb
    const left = Math.max(0, -x / pb) + trim, right = left + (lanes.w + 4) / pb;
    g.lineWidth = 1;
    if (o.muted) g.strokeStyle = pal.text3; else g.fillStyle = col;
    const mixed = !o.muted && !o.ghost && signersOf(c).length > 1;
    const inkOf = (by) => { const k = by && by !== c.by ? authorKind(app, by) : 'house'; return k === 'agent' ? pal.agent : k === 'human' ? pal.human : null; };
    for (const n of c.notes) {
      const t = n.t - trim;
      if (t >= len || t + n.d <= 0 || n.t + n.d < left || n.t > right + len) continue;
      const nx = x + Math.max(0, t) * pb, nw = Math.max(1.5, Math.min(n.d, len - t) * pb - (pb > 8 ? 1 : 0));
      const ny = y + s.row(n.p) * rowH + (rowH - nh) / 2;
      if (o.muted) {
        g.globalAlpha = base * 0.75;
        g.strokeRect(Math.round(nx) + 0.5, Math.round(ny) + 0.5, Math.max(1, Math.round(nw) - 1), Math.max(1, Math.round(nh) - 1));
      } else {
        g.globalAlpha = base * (0.55 + 0.45 * n.v);
        g.fillRect(nx, ny, nw, nh);
        const ink = mixed ? inkOf(n.by) : null;
        if (ink) {
          g.globalAlpha = base; g.strokeStyle = ink;
          g.strokeRect(Math.round(nx) - 0.5, Math.round(ny) - 0.5, Math.max(1, Math.round(nw)) + 1, Math.max(1, Math.round(nh)) + 1);
        }
      }
    }
    g.globalAlpha = base;
  }

  function drawWave(g, c, x, y, w, hh, col, muted = false) {
    const pal = palette();
    const wv = c.asset ? wave(c.asset) : { state: 'missing' };
    const mid = y + hh / 2;
    if (wv.state !== 'ready') {
      g.fillStyle = rgba(col, 0.5);
      g.fillRect(x + 4, mid, w - 8, 1);
      if (w > 80) { g.font = `400 11px ${pal.ui}`; g.fillStyle = pal.text3; g.textBaseline = 'alphabetic'; g.fillText(wv.state === 'loading' ? 'loading the audio' : 'audio not found', x + 6, mid - 5); }
      return;
    }
    const spb = 60 / P().tempo;
    const pb = ppb();
    const xs = Math.max(x, 0), xe = Math.min(x + w, lanes.w);
    g.fillStyle = muted ? rgba(col, 0.55) : col;
    const amp = hh / 2;
    for (let px = Math.floor(xs); px < xe; px++) {
      const sec0 = (c.offset || 0) + ((px - x) / pb) * spb, sec1 = (c.offset || 0) + ((px + 1 - x) / pb) * spb;
      if (sec0 >= wv.dur) break;
      const i0 = Math.floor((sec0 / wv.dur) * wv.n), i1 = Math.max(i0 + 1, Math.floor((sec1 / wv.dur) * wv.n));
      let mn = 0, mx = 0;
      for (let i = i0; i < i1 && i < wv.n; i++) { if (wv.peaks[i * 2] < mn) mn = wv.peaks[i * 2]; if (wv.peaks[i * 2 + 1] > mx) mx = wv.peaks[i * 2 + 1]; }
      const gain = Math.pow(10, (c.gain || 0) / 20);
      g.fillRect(px, mid - clamp(mx * gain, 0, 1) * amp, 1, Math.max(1, (clamp(mx * gain, 0, 1) - clamp(mn * gain, -1, 0)) * amp));
    }
  }

  function presenceRects(pr) {
    const p = P(), pb = ppb(), sx = scroller.scrollLeft, sy = scroller.scrollTop, TH = th();
    const W = lanes.w;
    const rowOf = (id) => p.tracks.findIndex((t) => t.id === id || t.name === id);
    if (pr.clip) {
      const f = store.findClip(pr.clip);
      if (f) { const i = p.tracks.indexOf(f.track); return { x: f.clip.start * pb - sx, y: trackTop(i) - sy + 4, w: f.clip.length * pb, h: TH - 8 }; }
    }
    const range = pr.range || (pr.bars ? { from: (pr.bars[0] - 1) * bpbOf(), to: pr.bars[1] * bpbOf() } : null);
    if (pr.track && pr.track !== 'master') {
      const i = rowOf(pr.track);
      if (i < 0) return null;
      // pointing at a lane ({ track, insert?, param }): its row when it's open
      const lr = pr.param ? rows().lanes.get(laneKey({ track: p.tracks[i].id, insert: pr.insert || null, param: pr.param })) : null;
      const y = lr ? lr.y - sy + 3 : trackTop(i) - sy + 4, hh = lr ? lr.h - 6 : TH - 8;
      if (range) return { x: range.from * pb - sx, y, w: (range.to - range.from) * pb, h: hh };
      return { x: 4, y, w: W - 8, h: hh };
    }
    if (range) return { x: range.from * pb - sx, y: 4, w: (range.to - range.from) * pb, h: Math.max(TH, rows().total - sy) - 8 };
    return null;
  }
  // The take being written (docs/research/RECORDING-UX.md 3.11, 3.14), from recorder.live(): on each track it records
  // onto, a band in record ink from the punch-in to the playhead (10% fill, a 1 px line top and bottom, none at the
  // sides) growing with the playhead; what lands in it, drawn as it lands: notes as bars that grow while held, hits as
  // short blocks in four drum rows, in the track's colour (earlier loop passes at 45%); the mic's peaks and the hum's
  // pitch trace in --text-2. During the count-in, the numeral (4 3 2 1) over the target lane at the playhead. When the
  // take goes in, the band fades over 200 ms into the clip (arranger.show marks the clip).
  const DRUM_ROWS = [46, 42, 38, 36];   // open hat at the top, kick at the bottom (input/tap.js ROWS)
  const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function drawRecording(g, now) {
    const live = rec.live;
    const pal = palette(), p = P(), pb = ppb(), sx = scroller.scrollLeft, sy = scroller.scrollTop, TH = th(), W = lanes.w;
    const rowOf = (id) => p.tracks.findIndex((t) => t.id === id);
    if (!live) {
      // the band fading into the committed clip
      const f = rec.fade;
      if (f) {
        const a = 1 - (now - f.at) / 200;
        if (a <= 0 || reducedMotion()) rec.fade = null;
        else for (const b of f.bands) { g.fillStyle = rgba(pal.rec, 0.1 * a); g.fillRect(b.x0, b.y, b.x1 - b.x0, b.h); g.fillStyle = rgba(pal.rec, a); g.fillRect(b.x0, b.y, b.x1 - b.x0, 1); g.fillRect(b.x0, b.y + b.h - 1, b.x1 - b.x0, 1); }
      }
      return;
    }
    const view = { state: live.state, take: live.take, track: live.track, bands: [], marks: 0, held: 0, count: null, peaks: 0, trace: 0, punch: !!live.loop };
    const nowB = Number.isFinite(live.now) ? live.now : engine.beat || 0;
    const ids = [...new Set([live.track, ...(live.tracks || [])].filter(Boolean))];
    if (live.state === 'rec') {
      const lp = live.loop;
      const from = live.pass > 0 && lp ? lp.start : live.from;
      for (const id of ids) {
        const i = rowOf(id);
        if (i < 0) continue;
        const t = p.tracks[i];
        const y = trackTop(i) - sy + 4, hh = TH - 8;
        if (y > lanes.h || y + hh < 0) continue;
        const x0 = Math.round(from * pb - sx), x1 = Math.max(x0, Math.round(nowB * pb - sx));
        const passes = live.passes.filter((ps) => ps.track === id);
        // what played here before is set back under the band, so what you play reads as it lands: a new take
        // replaces it (the room over it, nearly opaque); layered hits sit on top of it (half the room over it)
        const layer = passes.length ? passes.every((ps) => ps.mode === 'layer') : (recorder()?.modeFor?.(id) || (isDrumTrack(app, t) ? 'layer' : 'take')) === 'layer';
        g.fillStyle = rgba(pal.bg, layer ? 0.55 : 0.86); g.fillRect(x0, y, x1 - x0, hh);
        g.fillStyle = rgba(pal.rec, 0.1); g.fillRect(x0, y, x1 - x0, hh);
        g.fillStyle = pal.rec; g.fillRect(x0, y, x1 - x0, 1); g.fillRect(x0, y + hh - 1, x1 - x0, 1);
        view.bands.push({ track: id, from, to: nowB, x0, x1, y, h: hh });
        const col = resolveColor(t.color);
        const held = (live.held || []).filter((n) => n.track === id);
        const drums = passes.some((ps) => ps.drums) || isDrumTrack(app, t);
        const all = [...passes.flatMap((ps) => ps.notes), ...held];
        // rows: the four pads (and any other drum a MIDI kit sent), or the pitches so far, an octave at least
        let rowsN, rowOfP;
        if (drums) {
          const ps = [...new Set([...DRUM_ROWS, ...all.map((n) => n.p)])].sort((a, b) => b - a);
          rowsN = ps.length; rowOfP = (q) => ps.indexOf(q);
        } else {
          const lo0 = Math.min(...all.map((n) => n.p), 127), hi0 = Math.max(...all.map((n) => n.p), 0);
          const mid = all.length ? (lo0 + hi0) / 2 : 60, span = Math.max(12, (all.length ? hi0 - lo0 : 0) + 2);
          const hi = Math.round(mid + span / 2);
          rowsN = span + 1; rowOfP = (q) => hi - q;
        }
        const top = y + 3, ih = hh - 6, rh = ih / rowsN, nh = clamp(rh - 1, 2, drums ? 8 : 5);
        g.save();
        g.beginPath(); g.rect(0, y, W, hh); g.clip();
        // your notes: the track's colour with a warm outline (the kit: notes keep their colour, the outline says who)
        g.lineWidth = 1; g.strokeStyle = pal.human;
        const mark = (n, a, isHeld) => {
          const nx = n.t * pb - sx;
          if (nx > W || nx < -200) return;
          const nw = drums ? clamp(0.25 * pb - 1, 3, 8) : Math.max(2, n.d * pb - (pb > 8 ? 1 : 0));
          const ny = top + rowOfP(n.p) * rh + (rh - nh) / 2;
          g.globalAlpha = a;
          g.fillStyle = col;
          g.fillRect(nx, ny, nw, nh);
          if (nh >= 3 && nw >= 3) g.strokeRect(Math.round(nx) + 0.5, Math.round(ny) + 0.5, Math.max(1, Math.round(nw) - 1), Math.max(1, Math.round(nh) - 1));
          view.marks++;
          if (isHeld) view.held++;
          if (a === 1) view.at = { b: n.t, p: n.p, x: Math.round(nx + Math.min(nw, 6) / 2), y: Math.round(ny + nh / 2) };
        };
        for (const ps of passes) for (const n of ps.notes) mark(n, ps.n === live.pass ? 1 : 0.45, false);
        for (const n of held) mark(n, 1, true);
        g.globalAlpha = 1;
        // the mic: one column per frame's input peak, at the beat it came in
        if (t.kind === 'audio' && rec.peaks.length) {
          g.fillStyle = pal.text2;
          const mid = y + hh / 2;
          for (const pk of rec.peaks) {
            const px = Math.round(pk.b * pb - sx);
            if (px < -2 || px > W) continue;
            const a = Math.max(1, Math.min(1, pk.v) * (hh / 2 - 3));
            g.globalAlpha = pk.pass === live.pass ? 1 : 0.45;
            g.fillRect(px, mid - a, Math.max(1, Math.ceil(pb / 40)), a * 2);
            view.peaks++;
          }
          g.globalAlpha = 1;
        }
        // the hum: its pitch trace, a 1.5 px line, broken where the voice stops
        if (t.kind !== 'audio' && !drums && rec.trace.length && id === recorder()?.targetFor?.('hum')?.id) {
          const ms = rec.trace.filter((x) => x.midi > 0).map((x) => x.midi);
          const lo = Math.min(...ms), hi = Math.max(...ms), span = Math.max(12, hi - lo + 2), hiY = (lo + hi) / 2 + span / 2;
          g.strokeStyle = pal.text2; g.lineWidth = 1.5; g.lineJoin = 'round';
          g.beginPath();
          let pen = false, lastB = null;
          for (const tr of rec.trace) {
            if (!(tr.midi > 0) || tr.pass !== live.pass) { pen = false; continue; }
            if (lastB != null && Math.abs(tr.b - lastB) > 0.5) pen = false;
            const px = tr.b * pb - sx, py = top + (hiY - tr.midi) / span * ih;
            if (pen) g.lineTo(px, py); else g.moveTo(px, py);
            pen = true; lastB = tr.b; view.trace++;
          }
          g.stroke();
        }
        g.restore();
      }
    }
    // the count-in: 4 3 2 1 (the beats left in the bar before the downbeat), over the target lane at the playhead,
    // fading over each beat (reduced motion: still). The one big numeral: the top bar's position reads -1.4 ... -1.1.
    // The transport's countdown when there is one (the whole count from the moment R is pressed, in the meter's beats)
    if (live.counting) {
      const cd = app.transport?.countdown?.();
      const left = live.counting.beats;
      const k = cd ? cd.n : Math.ceil(left - 1e-3);
      // (a take that makes a new track counts in over the ghost lane, where that track will be)
      const onGhost = !live.track && ghostAt >= 0;
      const i = onGhost ? ghostAt : rowOf(live.track || ids[0]);
      // (only the count's last bar: R while the loop plays can wait for the loop's top, and 1 4 3 2 1 4 3 2 1 read as
      // two counts)
      const lastBar = cd ? cd.bar <= 1 : left <= bpbOf() + 1e-6;
      if (k >= 1 && i >= 0 && lastBar) {
        view.countOn = onGhost ? 'new' : p.tracks[i]?.id || null;
        const phase = cd ? cd.frac : clamp(k - left, 0, 1);
        const cx = clamp(Math.round(nowB * pb - sx) + 10, 10, Math.max(10, W - 70));
        const cy = trackTop(i) - sy + TH / 2;
        // in cream on a room-coloured halo, so it reads over a busy part (it fades a little over each beat, never out)
        g.save();
        displayFont(g, 48);
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        // (Sketch's beat band counts in, in Tap it and Hum it: one count in view, not two; ui/sketch.js bandShown)
        g.globalAlpha = app.sketch?.bandShown?.() ? 0 : reducedMotion() ? 1 : 1 - 0.35 * phase;
        g.strokeStyle = pal.bg; g.lineWidth = 8;
        g.strokeText(String(k), cx, cy + 2);
        g.fillStyle = pal.text;
        g.fillText(String(k), cx, cy + 2);
        g.restore();
        view.count = k;
        view.countAt = { x: cx, y: cy + 2, w: Math.ceil((displayFont(g, 48), g.measureText(String(k)).width)) };
      }
    }
    rec.view = view;
  }

  // Still marks, no pulse: they stay while the agent points (ui.state.presence) and go when it stops. Its note is
  // written over the part of the target that's in view (a highlight on bars 1-4 with bars 1-3 in view had its note past
  // the edge); a target wholly out of view gets a marker on the edge it lies past, naming it, with an arrow that way.
  // The view never scrolls for it: the person is looking where they're looking. (What was drawn: presenceMarks().)
  let presMarks = [];
  function drawPresence(g) {
    const pal = palette(), W = lanes.w, H = lanes.h;
    const textW = (t) => { g.save(); g.font = `600 10.5px ${pal.ui}`; const w = Math.min(260, g.measureText(t).width) + 6; g.restore(); return Math.ceil(w); };
    presMarks = [];
    for (const pr of presenceList(ui)) {
      const r = presenceRects(pr);
      if (!r) continue;
      const who = authorName(app, pr.by || 'claude');
      const label = pr.note ? `${who}: ${pr.note}` : who;
      const vx0 = Math.max(r.x, 0), vx1 = Math.min(r.x + r.w, W), vy0 = Math.max(r.y, 0), vy1 = Math.min(r.y + r.h, H);
      if (vx1 - vx0 > 1 && vy1 - vy0 > 1) {
        drawCrop(g, r.x, r.y, r.w, r.h, { color: pal.accent2 });
        // the note over the top right of what's in view, as drawCrop places it over the whole
        const tw = textW(label), x1 = Math.round(vx1) + 3, y0 = Math.round(vy0) - 3;
        const lx = clamp(Math.max(Math.round(vx0) - 3, x1 - 2 - tw), 2, Math.max(2, W - tw - 2)), ly = y0 - 15 >= 0 ? y0 - 15 : Math.max(0, y0) + 4;
        drawLabel(g, lx, ly, label, { color: pal.accent2 });
        presMarks.push({ id: pr.id || null, text: label, x: lx, y: ly, w: tw, edge: null });
        continue;
      }
      // wholly out of view: on the edge it lies past
      const edge = r.x >= W ? 'right' : r.x + r.w <= 0 ? 'left' : r.y >= H ? 'below' : 'above';
      const arrow = { right: '→', left: '←', below: '↓', above: '↑' }[edge];
      const text = edge === 'left' || edge === 'above' ? `${arrow} ${label}` : `${label} ${arrow}`;
      const tw = textW(text);
      const midY = clamp(r.y + r.h / 2 - 7, 2, Math.max(2, H - 16)), midX = clamp(r.x + r.w / 2 - tw / 2, 4, Math.max(4, W - tw - 4));
      const x = edge === 'right' ? W - tw - 4 : edge === 'left' ? 4 : midX, y = edge === 'below' ? H - 18 : edge === 'above' ? 4 : midY;
      g.fillStyle = pal.accent2;
      if (edge === 'right') g.fillRect(W - 2, y - 3, 2, 20); else if (edge === 'left') g.fillRect(0, y - 3, 2, 20);
      else if (edge === 'below') g.fillRect(x - 3, H - 2, tw + 6, 2); else g.fillRect(x - 3, 0, tw + 6, 2);
      drawLabel(g, x, y, text, { color: pal.accent2 });
      presMarks.push({ id: pr.id || null, text, x, y, w: tw, edge });
    }
  }

  // The ruler, set like the sleeve's credits: section names in display italic after a pencil tick (the selected one
  // printed in reverse), the loop as a grease-pencil line, bar numbers as display numerals, the playhead in leader green.
  function drawRuler(now) {
    const { g, w: W, h: H } = ruler;
    const pal = palette();
    const p = P();
    const bpb = bpbOf();
    const pb = ppb(), sx = scroller.scrollLeft;
    g.clearRect(0, 0, W, H);
    g.fillStyle = pal.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = pal.line; g.fillRect(0, H - 1, W, 1);

    // sections
    const rd = rulerDrag;
    p.sections.forEach((s) => {
      let start = s.start, length = s.length;
      if (rd && rd.kind === 'section' && rd.s.id === s.id && rd.nStart != null) { start = rd.nStart; length = rd.nLength; }
      const x = Math.round(start * pb - sx), w = Math.round(length * pb);
      if (x > W || x + w < 0) return;
      const isSel = selSection === s.id;
      const fl = flash.level(s.id, now);
      g.save();
      g.beginPath(); g.rect(x, 0, Math.max(0, w - 2), SEC_H); g.clip();
      displayFont(g, 13, { stretch: 'semi-expanded' });
      g.textBaseline = 'alphabetic';
      const tw = Math.ceil(g.measureText(s.name).width);
      const lx = Math.max(x, Math.min(0, x + w - tw - 16));   // the name stays in view while its section is
      if (isSel) {
        g.fillStyle = pal.text; g.fillRect(lx, 2, Math.min(tw + 12, w), SEC_H - 4);
        g.fillRect(x, SEC_H - 2, w, 1);
      } else { g.fillStyle = pal.text3; g.fillRect(x, 4, 1, SEC_H - 7); }
      if (w > 18) { g.fillStyle = isSel ? pal.bg : fl ? pal.agent : pal.text; g.fillText(s.name, lx + 6, SEC_H - 6); }
      g.restore();
    });

    // the loop: a grease-pencil line with its ends turned down (when off: a dotted one, to say where it would be)
    let ls = p.loop.start, le = p.loop.end;
    if (rd && rd.kind === 'loop' && rd.nStart != null) { ls = rd.nStart; le = rd.nEnd; }
    const lx0 = Math.round(ls * pb - sx), lx1 = Math.round(le * pb - sx);
    const on = p.loop.on || (rd && rd.kind === 'loop' && rd.moved);
    const ly = LOOP_Y + 4;
    if (on) {
      g.fillStyle = pal.accent2;
      g.fillRect(lx0, ly, Math.max(2, lx1 - lx0), 3);
      g.fillRect(lx0, ly, 2, 7); g.fillRect(lx1 - 2, ly, 2, 7);
      // the grip: the middle stretch, thicker (drag it to move the loop; elsewhere a drag draws a new one)
      if (lx1 - lx0 >= 48) { const mid = (lx0 + lx1) / 2, half = clamp((lx1 - lx0) / 6, 12, 40); g.fillRect(Math.round(mid - half), ly - 1, Math.round(half * 2), 5); }
    } else if (loopShown()) {
      g.fillStyle = rgba(pal.accent2, 0.5);
      for (let x = lx0; x < lx1; x += 5) g.fillRect(x, ly + 1, 2, 1);
      g.fillRect(lx0, ly, 1, 6); g.fillRect(lx1 - 1, ly, 1, 6);
    }

    // the punch: while a take records with the loop on, the loop is the punch range, a record-ink line over it
    const rl = rec.live;
    if (rl && rl.loop) {
      const a = Math.round(rl.loop.start * pb - sx), b = Math.round(rl.loop.end * pb - sx);
      g.fillStyle = pal.rec; g.fillRect(a, ly - 3, Math.max(2, b - a), 2);
    }

    // bars and beats
    const barPx = pb * bpb;
    const every = barPx >= 34 ? 1 : barPx >= 16 ? 2 : barPx >= 8 ? 4 : 8;
    const firstBar = Math.max(0, Math.floor(sx / barPx));
    // (a bar under a pixel wide only comes from a meter nothing should have let in: draw no bars rather than a billion)
    const lastBar = barPx >= 1 ? Math.min(Math.ceil((sx + W) / barPx), firstBar + 4096) : -1;
    const here = Math.floor((engine.beat || 0) / bpb + 1e-9);
    displayFont(g, 14);
    g.textBaseline = 'alphabetic';
    for (let b = firstBar; b <= lastBar; b++) {
      const x = Math.round(b * barPx - sx);
      if (b % every === 0) {
        g.fillStyle = pal.line2; g.fillRect(x, H - 10, 1, 9);
        g.fillStyle = b === here ? pal.text : pal.text2; g.fillText(String(b + 1), x + 5, H - 4);
      } else { g.fillStyle = pal.line2; g.fillRect(x, H - 6, 1, 5); }
      if (barPx >= 40) for (let k = 1; k < bpb; k++) { const bx = Math.round(x + k * pb); g.fillStyle = pal.line; g.fillRect(bx, H - 4, 1, 3); }
    }
    // the selected bars
    const sel = ui.state.selection.range;
    if (sel) { g.fillStyle = rgba(pal.text, 0.08); g.fillRect(sel.from * pb - sx, BAR_Y, (sel.to - sel.from) * pb, H - BAR_Y); g.fillStyle = rgba(pal.text, 0.6); g.fillRect(sel.from * pb - sx, H - 2, (sel.to - sel.from) * pb, 1); }
    // the start marker: its bar number printed in reverse (a cream tab from the bar line), apart from the playhead
    const mk = app.transport?.marker?.beat;
    if (Number.isFinite(mk)) {
      const mx = Math.round(mk * pb - sx);
      const bar = Math.floor(mk / bpb + 1e-9), inBar = mk - bar * bpb;
      const lab = inBar < 1e-6 ? String(bar + 1) : `${bar + 1}.${Math.floor(inBar + 1e-9) + 1}`;
      displayFont(g, 14);
      const tw = Math.ceil(g.measureText(lab).width) + 10;
      if (mx > -tw && mx < W) {
        g.fillStyle = pal.bg; g.fillRect(mx - 1, BAR_Y, tw + 2, H - BAR_Y - 1);
        g.fillStyle = pal.text; g.fillRect(mx, BAR_Y + 1, tw, H - BAR_Y - 2);
        g.fillStyle = pal.bg; g.fillText(lab, mx + 5, H - 4);
      }
    }
    // playhead
    const px = (engine.beat || 0) * pb - sx;
    if (px > -8 && px < W + 8) {
      g.fillStyle = pal.accent;
      g.beginPath(); g.moveTo(px - 5, BAR_Y); g.lineTo(px + 5, BAR_Y); g.lineTo(px, BAR_Y + 7); g.closePath(); g.fill();
      g.fillRect(Math.round(px) - 0.5, BAR_Y + 6, 1.5, H - BAR_Y - 6);
    }
  }

  /* ======================================================= events */
  const offSel = ui.on('select', (s) => {
    if (s.clip && !selClips.has(s.clip)) selClips = new Set([s.clip]);
    if (!s.clip && selClips.size === 1) selClips.clear();
    if (s.range == null) rangeRows = null;
    buildHeads(); dirty = true; rulerDirty = true;
    syncBar();
  });
  const offPres = ui.on('presence', () => { dirty = true; presenceSig = ''; });
  const offResize = ui.on('resize', () => { dirty = true; rulerDirty = true; layDirty = true; });
  const offSnap = ui.on('snap', () => syncBar());
  const offTr = engine.on?.('transport', () => { rulerDirty = true; }) || (() => {});
  // the workspace changed (Loop added or put away): the ruler's loop row is drawn again
  const offWs = ui.on?.('workspace', () => { rulerDirty = true; dirty = true; }) || (() => {});
  // the sound card (ui/sounds.js): a trial, a pending Sounds, the previewed new track
  const offSounds = ui.on?.('sounds', () => { buildHeads(); dirty = true; }) || (() => {});
  // the registry changed (a held device let play, a device defined, removed or put back): the headers name devices, and
  // a held one's clips say "kept off", so both redraw once it has all landed. Play it holds the set first and defines
  // the device after (main.js syncProjectDevices), so a redraw on the held event alone printed the device's id
  // ("tape-organ") until something else redrew: the microtask waits for the define.
  let headsSoon = false;
  const offDevs = app.devices?.onDevices?.(() => {
    if (headsSoon) return;
    headsSoon = true;
    queueMicrotask(() => { headsSoon = false; buildHeads(); dirty = true; });
  }) || (() => {});

  function onChange(evt) {
    preview.clear(); signers.clear();
    buildTakes();
    if (evt.kind === 'load') { selClips.clear(); selSection = null; waves.clear(); labels.clear(); empty.replaceChildren(); openedSong = true; }
    // drop selections that no longer exist
    const ids = new Set(tracks().flatMap((t) => t.clips.map((c) => c.id)));
    for (const id of [...selClips]) if (!ids.has(id)) selClips.delete(id);
    if (selSection && !P().sections.some((s) => s.id === selSection)) selSection = null;
    if (store.isAgent?.(evt.by) && (evt.kind === 'do' || evt.kind === 'redo')) {
      const now = performance.now();
      const tch = touched(evt);
      for (const c of tch.clips) { flash.mark(c, now); flashCol.delete(c); }
      for (const t of tch.tracks) { flash.mark(t, now); trackFlash.set(t, now); }
      for (const s of tch.sections) flash.mark(s, now);
    }
    if (flashTrackSoon) flashTrackSoon = false;
    // an agent's lane edits: crop marks on the lane in its ink as it lands (when the lane is open)
    if (store.isAgent?.(evt.by) && (evt.kind === 'do' || evt.kind === 'redo')) {
      const now = performance.now();
      for (const op of evt.ops || []) {
        if (!/^auto\./.test(op.type || '')) continue;
        const t = findTrack(op.track);
        if (t) laneFlash.mark(laneKey({ track: t.id, insert: op.insert || null, param: op.param }), now);
      }
    }
    if (laneEd.sel && !laneAt(P(), laneEd.sel.addr)) laneEd.sel = null;
    layDirty = true;
    layoutSpacer();
    buildHeads();
    syncEmpty();
    syncBar();
    dirty = true; rulerDirty = true;
    // another song: it opens at the top (its first track in view), fitted, with 4 bars at least
    if (openedSong) { openedSong = false; openView(); }
  }
  let openedSong = false;
  function openView() {
    programmatic = true;
    scroller.scrollTop = 0;
    ui.state.scrollY = 0;
    headsInner.style.transform = 'translateY(0px)';
    fitSong();
    requestAnimationFrame(() => { if (scroller.scrollTop) { programmatic = true; scroller.scrollTop = 0; } fitSong(); });
  }

  // header flashes and presence (DOM): a track an agent just changed has its number in cool ink for a moment; one it
  // points at, in grease pencil while it points. No glow, no pulse.
  function syncHeadExtras(now) {
    for (const [id, t0] of trackFlash) {
      const row = headsInner.querySelector(`[data-track="${id}"]`);
      if (row) { row.classList.add('flash'); clearTimeout(row._flashT); row._flashT = setTimeout(() => row.classList.remove('flash'), 1500); }
      trackFlash.delete(id);
      void t0;
    }
    const list = presenceList(ui);
    const sig = list.map((p) => p.track || store.findClip(p.clip || '')?.track.id || '').join(',');
    if (sig !== presenceSig) {
      presenceSig = sig;
      const on = new Set(sig.split(',').filter(Boolean));
      for (const row of headsInner.children) if (row._track) row.classList.toggle('presence', on.has(row._track) || on.has(store.track(row._track)?.name));
    }
    void now;
  }

  /* ======================================================= the loop */
  let meterT = 0, lastPres = '';
  let wasPlaying = false, stopRevealUntil = 0;
  // what a take in progress lands, at the beat it landed: the mic's level and the hum's pitch, once a frame
  function sampleTake(now, inLv) {
    const R = recorder();
    const live = R && R.state !== 'idle' && typeof R.live === 'function' ? R.live() : null;
    if (!empty.hidden) syncEmptyTake(live);
    if (!live) {
      if (rec.live && rec.view?.bands?.length) rec.fade = { at: now, bands: rec.view.bands };
      if (rec.live) { rec.live = null; rec.view = null; rec.take = null; rec.peaks = []; rec.trace = []; rec.lastTrace = null; dirty = true; }
      return;
    }
    if (live.take !== rec.take) { rec.take = live.take; rec.peaks = []; rec.trace = []; rec.lastTrace = null; rec.fade = null; }
    rec.live = live;
    if (live.state !== 'rec') return;
    const b = Number.isFinite(live.now) ? live.now : engine.beat || 0;
    if (inLv && (live.tracks || []).concat(live.track).some((id) => store.track(id)?.kind === 'audio')) {
      rec.peaks.push({ b, v: inLv.peak, pass: live.pass });
      if (rec.peaks.length > 6000) rec.peaks.splice(0, 1000);
    }
    const hum = app.input?.hum;
    if (hum?.active) {
      const tr = hum.trace?.() || [];
      const last = tr[tr.length - 1];
      if (last && last !== rec.lastTrace) {
        rec.lastTrace = last;
        rec.trace.push({ b, midi: last.conf == null || last.conf > 0.3 ? last.midi : null, pass: live.pass });
        if (rec.trace.length > 6000) rec.trace.splice(0, 1000);
      }
    }
  }
  // A control held while R records writes its lane: the lane opens under its track (once a take, quietly, no scroll),
  // so the stretch being written can be seen
  const autoOpened = new Set();
  function openHeldLanes() {
    const ar = app.input?.autorec;
    if (!ar?.recording) { if (autoOpened.size) autoOpened.clear(); return; }
    let held = [];
    try { held = ar.touching?.() || []; } catch (e) { held = []; }
    let changed = false;
    for (const x of held) {
      if (x.mode && x.mode !== 'rec') continue;
      const t = findTrack(x.track);
      if (!t || !x.param) continue;
      const a = x.insert ? { track: t.id, insert: x.insert, param: x.param } : { track: t.id, param: x.param };
      const key = laneKey(a);
      if (autoOpened.has(key) || rows().lanes.has(key)) continue;
      autoOpened.add(key);
      if (!laneParams(app, P(), t).some((q) => q.key === key)) continue;
      const st = trackLanes(ui, t.id);
      st.open = true;
      st.hide = st.hide.filter((k) => k !== key);
      if (!st.extra.some((e) => laneKey(e) === key)) st.extra.push(a);
      changed = true;
    }
    if (changed) relayout();
  }
  function frame(now) {
    placeWelcome();
    if (lanes.fit()) { dirty = true; layoutSpacer(); }
    if (pendingZoom && scroller.clientWidth >= 80) zoomTo(...pendingZoom);
    if (ruler.fit()) rulerDirty = true;
    // follow the playhead (page flips)
    const beat = engine.beat || 0;
    if (engine.playing && follow && !drag && now > followPauseUntil) {
      // (a take running past the song's end: the sheet grows ahead of the playhead, so it can follow)
      if ((beat + bpbOf() * 2) * ppb() > spacer.offsetWidth) layoutSpacer();
      const x = beat * ppb() - scroller.scrollLeft;
      // while the loop plays (a take looping over it too) and it fits, the loop stays in view: a page flip at its end
      // would show the bars after it, where nothing plays, and flip back at once (docs/FRESH-EYES-3.md)
      const lp = P().loop, cw = scroller.clientWidth, pb = ppb();
      const inLoop = lp?.on && lp.end > lp.start && beat >= lp.start - 1e-6 && beat <= lp.end + 1e-6 && (lp.end - lp.start) * pb <= cw - 70;
      if (inLoop) {
        const lo = lp.end * pb - (cw - 30), hi = lp.start * pb - 40;   // the scroll positions that show all of it
        if (scroller.scrollLeft < lo - 1 || scroller.scrollLeft > hi + 1) { programmatic = true; scroller.scrollLeft = Math.max(0, Math.min(hi, Math.max(lo, scroller.scrollLeft))); }
      } else if (x > cw - 30 || x < 0) { programmatic = true; scroller.scrollLeft = Math.max(0, beat * pb - 40); }
    }
    // stopping with Follow on: the playhead goes back to the marker, and the view goes with it (a few frames, while
    // the transport puts it there)
    if (wasPlaying && !engine.playing) stopRevealUntil = now + 400;
    wasPlaying = !!engine.playing;
    if (!engine.playing && follow && !drag && now < stopRevealUntil) reveal(beat);
    // autoscroll while dragging near an edge
    if (drag && drag.moved && lastPointer) {
      const r = scroller.getBoundingClientRect();
      const ex = lastPointer.clientX - r.left;
      const step = ex > r.width - 30 ? 12 : ex < 30 && scroller.scrollLeft > 0 ? -12 : 0;
      if (step) { programmatic = true; scroller.scrollLeft += step; moveDrag(lastPointer); }
    }
    // (presence marks are still: redraw when the list changes or one expires, not every frame)
    const pl = presenceList(ui), pk = pl.map((x) => x.id || x.track || x.clip).join(',');
    if (pk !== lastPres) { lastPres = pk; dirty = true; }
    // a take in progress: the lanes redraw every frame while it grows
    const lit = armedIds();
    const A = app.input?.audio;
    const inLv = A?.state?.open && [...lit].some((id) => store.track(id)?.kind === 'audio') ? A.level() : null;
    sampleTake(now, inLv);
    openHeldLanes();
    if (rec.live || rec.fade) dirty = true;
    if (lay && lay.ph !== isPhone()) relayout();
    if (dirty || flash.active() || laneFlash.active() || ((laneRec || app.input?.autorec?.recording) && lay?.lanes.size)) { drawLanes(now); dirty = false; }
    syncLaneValues(now);
    drawRuler(now);
    rulerDirty = false;
    // playhead line
    const px = beat * ppb() - scroller.scrollLeft;
    playhead.style.transform = `translateX(${Math.round(px)}px)`;
    playhead.style.opacity = px < -2 || px > lanes.w ? '0' : '1';
    playhead.classList.toggle('playing', !!engine.playing);
    syncHeadExtras(now);
    syncAim(now);
    syncGhost();
    // mini meters (~30 Hz)
    if (now - meterT > 33) {
      meterT = now;
      const m = engine.meters?.tracks || {};
      syncArm();
      for (const row of headsInner.children) {
        if (!row._fill) continue;
        const mm = m[row._track];
        const v = mm ? clamp((mm.peak + 60) / 60, 0, 1) : 0;
        row._fill.style.transform = `scaleY(${v})`;
        row._fill.classList.toggle('hot', !!mm && mm.peak > -1);
        // the armed track's input: the interface for an audio track, what you play (its own level) for an instrument
        if (row._in && lit.has(row._track)) {
          const kind = store.track(row._track)?.kind;
          const db = kind === 'audio' ? (inLv ? inLv.db : -120) : mm ? mm.peak : -120;
          row._in.style.clipPath = `inset(0 ${Math.round((1 - clamp((db + 60) / 60, 0, 1)) * 1000) / 10}% 0 0)`;
        }
      }
    }
  }

  /* ======================================================= go */
  // the canvas sets its labels in the page's faces: draw again once they have loaded
  const refont = () => { dirty = true; rulerDirty = true; };
  document.fonts?.ready?.then(refont);
  document.fonts?.addEventListener?.('loadingdone', refont);
  layoutSpacer();
  buildTakes();
  buildHeads();
  syncEmpty();
  syncBar();
  if (ui.state.scrollX) { programmatic = true; scroller.scrollLeft = ui.state.scrollX; }
  // a first view that shows the song
  requestAnimationFrame(() => {
    const end = Math.max(...tracks().flatMap((t) => t.clips.map((c) => c.start + c.length)), 0);
    const w = scroller.clientWidth - 24;
    if (end && !ui.state.scrollX && (end * ppb() < w * 0.5 || (end * ppb() > w && w / end >= 12))) fitSong();
  });

  app.arranger = {
    reveal, zoomTo, fitSong,
    // new clips into view, marked once in their author's ink: capture.keep, the Band picker
    show: (ids, by) => showClips(ids, by),
    // tests: the ink a clip's arrival marks are drawn in now (null once they're gone)
    flashing: (id) => (flash.level(id) > 0 ? flashCol.get(id) || palette().agent : null),
    // where a point on screen lands in the lanes: { track (null below the last), beat, grid } or null (file drops: input/importers.js)
    locate(clientX, clientY) {
      const r = laneWrap.getBoundingClientRect();
      if (!(clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom)) return null;
      const a = at({ clientX, clientY });
      return { track: tracks()[a.row]?.id || null, beat: Math.max(0, a.beat), grid: snapGrid() };
    },
    // where a beat is on screen (clientX), and a track's row (clientY of its middle): the ruler and the lanes share x
    xOf: (beat) => scroller.getBoundingClientRect().left + beat * ppb() - scroller.scrollLeft,
    yOf: (trackId) => { const i = tracks().findIndex((t) => t.id === trackId); return i < 0 ? null : laneWrap.getBoundingClientRect().top + trackTop(i) + th() / 2 - scroller.scrollTop; },
    selectedClips: () => selectedList().map(({ t, c }) => ({ track: t.id, clip: c.id })),
    selectClips(ids) { selClips = new Set(ids); dirty = true; syncBar(); },
    // the same paths as the menus and keys, for buttons that don't depend on a gesture (the inspector's)
    duplicateClip(clipId) { if (!store.findClip(clipId)) return; selClips = new Set([clipId]); duplicateSelected(); },
    // arrangement (core/arrangement.js): the same paths as the section and clip menus and keys
    repeatClip(clipId, times = 2) { const f = store.findClip(clipId); return f ? repeatClip(f.track, f.clip, times) : null; },
    // no beat: at the playhead, on the snap grid (the inspector's button); a beat: there exactly
    splitClip(clipId, at) { const f = store.findClip(clipId); return f ? splitClip(f.track, f.clip, at ?? null) : null; },
    duplicateSection(id) { const s = P().sections.find((x) => x.id === id || x.name === id); return s ? duplicateSection(s) : null; },
    insertBars(at, bars) { return insertBars(at, bars); },
    deleteBars(id) { const s = P().sections.find((x) => x.id === id || x.name === id); return s ? deleteBars(s) : null; },
    deleteClip(clipId) {
      const f = store.findClip(clipId);
      if (!f) return;
      selClips = new Set([clipId]); selSection = null;
      const name = f.clip.name || f.track.name;
      if (deleteSelected()) ui.toast(`Deleted the clip ${name}. ${MOD}Z brings it back.`, { action: { label: 'Undo', run: () => store.undo() } });
    },
    // take stacks: a clip's stack ({ takes: [{ clip, name, playing, hidden }], k, n } or null), which take plays (one
    // clip.set mute pair, one undo step), ⌘↑ / ⌘↓, the badge's menu actions
    takes(clipId) { const st = stackOf(clipId); return st ? { k: st.k, n: st.n, track: st.track.id, takes: st.group.map((c) => ({ clip: c.id, name: c.name || st.track.name, playing: !c.mute, hidden: hiddenTake(c) })) } : null; },
    useTake(clipId) { const f = store.findClip(clipId); return f ? useTake(f.track, f.clip) : null; },
    // the take lanes (comping): open or close a clip's folder (on: true / false, or toggle); the take rows on screen
    // [{ track, k, name, top, bottom, mid (clientY) }]; comp(clipId of a take, from, to): that take plays there
    takeLanes(clipId, on = null) { const f = store.findClip(clipId); return f ? toggleTakes(f.track, f.clip, on) : false; },
    takeRows() {
      const r = laneWrap.getBoundingClientRect();
      return rows().rows.filter((x) => x.kind === 'take').map((x) => ({ track: x.t.id, k: x.k, name: x.folders.find((f) => f.lanes[x.k])?.lanes[x.k].name || null, top: r.top + x.y - scroller.scrollTop, bottom: r.top + x.y + x.h - scroller.scrollTop, mid: r.top + x.y + x.h / 2 - scroller.scrollTop }));
    },
    comp(clipId, from, to) { const f = store.findClip(clipId); return f && f.clip.take ? compTake(f.track, f.clip.take, f.clip.id, from, to) : null; },
    stepTake: (dir) => stepTake(dir),
    // who signs a clip's label line ("you and Claude": its maker, then whoever wrote notes in it), or '' (the house)
    signedBy(clipId) { const f = store.findClip(clipId); return f ? signedText(signersOf(f.clip)) : null; },
    // what a clip's label line printed at its right end when it was last drawn: a byline, "muted", "kept off" (its
    // track's instrument is held, so it plays silence), or null (nothing, or not drawn); undefined: never drawn
    clipLabel: (clipId) => (labels.has(clipId) ? labels.get(clipId) : undefined),
    flattenTakes(clipId) { const f = store.findClip(clipId); return f ? flattenTakes(f.track, f.clip) : null; },
    deleteTake(clipId) { const f = store.findClip(clipId); return f ? deleteTake(f.track, f.clip) : null; },
    // where the badge of a clip's stack is on screen (clientX, clientY of its middle), or null when it isn't drawn
    badgeAt(clipId) { const b = badges.get(clipId), r = scroller.getBoundingClientRect(); return b ? { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 } : null; },
    // the record targets lit on the headers (armed on purpose, or by selection)
    armed: () => [...armedIds()],
    // tests: what the take in progress drew last frame ({ state, bands: [{ track, from, to, x0, x1, y, h }], marks,
    // held, count, peaks, trace, punch }), or null
    recView: () => (rec.view ? JSON.parse(JSON.stringify(rec.view)) : null),
    duplicateTrack(trackId) { const t = store.track(trackId); if (t) duplicateTrack(t); },
    deleteTrack(trackId) { const t = store.track(trackId); if (t) deleteTrack(t); },
    // automation lanes (lanes.js). showLane(trackId, { insert?, param }): open that param's lane under its track and
    // scroll to it (a knob's Automate calls this; insert: an insert id or 'instrument', none for the mixer's 'gain' or
    // 'pan'); { key, track, insert, param } or null when the track or param isn't there
    showLane: (trackId, addr) => showLane(trackId, addr || {}),
    // show / hide a track's lanes (E); on: true / false, or toggle
    toggleLanes: (trackId, on = null) => toggleLanes(trackId, on),
    hideLane: (trackId, addr) => { const t = findTrack(trackId); if (t) hideLane(laneKey({ track: t.id, insert: addr?.insert || null, param: addr?.param })); },
    // the lane rows on screen: [{ key, track, insert, param, top, bottom, mid (clientY), y (content) }]
    laneRows() {
      const r = laneWrap.getBoundingClientRect();
      return rows().rows.filter((x) => x.kind === 'lane').map((x) => ({ key: x.key, track: x.t.id, insert: x.addr.insert || null, param: x.addr.param, y: x.y, h: x.h, top: r.top + x.y - scroller.scrollTop, bottom: r.top + x.y + x.h - scroller.scrollTop, mid: r.top + x.y + x.h / 2 - scroller.scrollTop }));
    },
    // where a value sits on a lane row on screen (clientY), for the checks and other panels
    laneY(key, v) {
      const x = rows().lanes.get(key);
      if (!x) return null;
      const info = laneInfo(app, P(), x.addr);
      const pos = info.spec ? Math.min(1, Math.max(0, toPos(laneView(info.spec), v))) : 0.5;
      const top = laneWrap.getBoundingClientRect().top + x.y - scroller.scrollTop + 6, bh = Math.max(4, x.h - 13);
      return top + (1 - pos) * bh;
    },
    // the lane selection ({ key, from, to } or null), a shape on bars of a lane (the menu's), lanes follow clips
    laneSel: () => (laneEd.sel ? { key: laneEd.sel.key, from: laneEd.sel.from, to: laneEd.sel.to } : null),
    selectLaneRange(trackId, addr, from, to) { const t = laneTrack(trackId); if (!t) return; const a = addr.insert ? { track: t.id, insert: addr.insert, param: addr.param } : { track: t.id, param: addr.param }; laneEd.sel = { key: laneKey(a), addr: a, from, to }; },
    laneShape(trackId, addr, shape, from, to) { const t = findTrack(trackId); if (!t) return null; const a = addr.insert ? { track: t.id, insert: addr.insert, param: addr.param } : { track: t.id, param: addr.param }; return laneEd.applyShape(a, shape, from, to); },
    shapes: () => SHAPES.map(([id, label]) => ({ id, label })),
    lanesFollow: (on) => lanesFollow(on),
    // tests: is a lane wearing an agent's arrival crop marks now
    laneFlashing: (key) => laneFlash.level(key) > 0,
    // what an agent's pointing drew last: [{ id, text, x, y, w, edge }] (view coordinates; edge: the side its target
    // lies past, or null when it's in view)
    presenceMarks: () => presMarks.map((m) => ({ ...m })),
    // tests: how long one full draw of the lanes canvas takes now (ms)
    drawMs: () => { const t0 = performance.now(); drawLanes(performance.now()); return performance.now() - t0; },
    // the lanes being written, drawn in record ink: [{ track, insert?, param, from, to }] (input/autorec.js can use this
    // or offer live()); null clears it
    recLanes(list) { laneRec = list && list.length ? list : null; dirty = true; },
  };

  return {
    update: onChange,
    frame,
    refresh() { dirty = true; rulerDirty = true; headSig = ''; buildHeads(); },
    unmount() { offSel(); offPres(); offResize(); offSnap(); offTr(); offWs(); offSounds(); offDrag(); offDevs(); offs.forEach((f) => f()); document.fonts?.removeEventListener?.('loadingdone', refont); },
  };
}

const CSS = `
.ar { display: grid; grid-template-rows: 38px 1fr; height: 100%; min-height: 0; background: var(--bg); }
/* the toolbar put away (the simple view: Track tools, ui/workspace.js): the song takes its row too */
.ws-off-tracks .ar { grid-template-rows: minmax(0, 1fr); }
/* the tools: words on the room, separated by a hairline from the sheet below */
.ar-bar { display: flex; align-items: center; gap: 14px; padding: 0 14px 0 18px; border-bottom: var(--rule); background: var(--bg); min-width: 0; overflow: hidden; }
.ar-bar .btn-txt { font-size: 12px; }
.ar-sep { width: 1px; align-self: stretch; margin: 9px 0; background: var(--line); flex: none; }
.ar-flex { flex: 1; }
.ar-tool { flex: none; }
.ar-tool.tog { height: 26px; padding: 0 4px; font-size: 12px; }
.ar-ico { display: inline-grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--r-press); background: none; color: var(--text-3); cursor: pointer; }
.ar-ico:hover { color: var(--text); background: var(--bg-3); }
.ar-tool:focus-visible, .ar-hb:focus-visible, .ar-swatch:focus-visible, .ar-hdev:focus-visible, .ar-link:focus-visible, .ar-addrow:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.ar-zoom { display: flex; gap: 2px; flex: none; }
.ar-hint { color: var(--text-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.ar-main { position: relative; display: grid; grid-template-columns: ${HEAD_W}px 1fr; grid-template-rows: ${RULER_H}px 1fr; min-height: 0; min-width: 0; }
/* the corner: what each strip of the ruler is, as small pencil labels (sentence case, no tracking) */
.ar-corner { border-right: var(--rule); border-bottom: var(--rule); background: var(--bg); display: grid; grid-template-rows: ${SEC_H}px ${LOOP_H}px 1fr; }
.ar-corner-row { display: flex; align-items: center; justify-content: space-between; padding: 0 10px 0 18px; font-size: 10.5px; line-height: 1; color: var(--text-3); }
.ar-secadd { display: inline-grid; place-items: center; width: 18px; height: 16px; border: 0; border-radius: var(--r-press); background: transparent; color: var(--text-3); cursor: pointer; }
.ar-secadd:hover { background: var(--bg-3); color: var(--text); }
.ar-rulerwrap { position: relative; border-bottom: var(--rule); overflow: hidden; touch-action: none; outline: none; }
.ar-rulerwrap:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.ar-ruler { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.ar-secinput, .ar-clipinput { position: absolute; top: 1px; height: 18px; z-index: 3; padding: 0 6px; border: 1px solid var(--accent-2); border-radius: var(--r-press); background: var(--bg); color: var(--text); font: 600 11.5px var(--font-ui); outline: none; }
.ar-clipinput { height: 17px; font-size: 11.5px; }
/* track headers: the number, the name, a square swatch and the device (signed when an agent built it), M S R */
.ar-heads { position: relative; overflow: hidden; border-right: var(--rule); background: var(--bg); touch-action: none; }
.ar-heads-inner { will-change: transform; }
.ar-head { position: relative; display: grid; grid-template-columns: 34px minmax(0, 1fr) auto 3px; align-items: center; border-bottom: var(--rule); cursor: grab; user-select: none; background: var(--bg); padding-left: 14px; }
.ar-head:hover { background: color-mix(in srgb, var(--bg-3) 50%, var(--bg)); }
.ar-head.sel { background: var(--bg-3); }
.ar-head.quiet .ar-hmain, .ar-head.quiet .ar-hnum { opacity: .55; }
.ar-head.dragging { z-index: 5; box-shadow: var(--shadow-2); cursor: grabbing; background: var(--bg-3); }
/* the header's empty space is a target of its own (.ar-htap, under everything): the words let a tap through to it, the
   keys and the name take their own; so a tap beside the name selects the track, and only a tap on S soloes it */
.ar-htap { position: absolute; inset: 0; }
.ar-head > .ar-hnum, .ar-head > .ar-hmain, .ar-head > .ar-hbtns { position: relative; pointer-events: none; }
.ar-head button, .ar-head input, .ar-head .ar-hname { pointer-events: auto; }
.ar-hnum { font-size: 17px; color: var(--text-3); }
.ar-head.flash .ar-hnum { color: var(--agent); }
.ar-head.presence .ar-hnum { color: var(--accent-2); }
.ar-hmain { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding-right: 6px; }
.ar-hrow { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ar-hname { font-weight: 600; font-size: 13.5px; line-height: 1.2; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.ar-hname.struck { color: var(--text-3); }
.ar-hinput { width: 100%; min-width: 0; height: 22px; padding: 0 6px; border: 1px solid var(--accent-2); border-radius: var(--r-press); background: var(--bg); color: var(--text); font: 600 13px var(--font-ui); outline: none; }
.ar-hsub { display: flex; align-items: center; gap: 0; min-width: 0; font-size: 11.5px; color: var(--text-3); white-space: nowrap; }
/* the swatch: the track's colour as an 8 px square (a DAW's own idiom, kept, but not a bar); its button is bigger */
.ar-swatch { position: relative; flex: none; width: 14px; height: 14px; margin: 0 2px 0 -3px; padding: 0; border: 0; border-radius: var(--r-press); background: none; cursor: pointer; }
.ar-swatch::before, .ar-hsw { content: ''; display: block; width: 8px; height: 8px; margin: 3px; background: var(--tc); }
.ar-swatch:hover::before { outline: 1px solid var(--text-3); outline-offset: 1px; }
.ar-hsw { display: none; flex: none; margin: 0; }
.ar-hdev { flex: none; min-width: 0; max-width: 100%; padding: 1px 0; border: 0; background: transparent; color: var(--text-3); font: inherit; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.ar-hdev:hover { color: var(--text-2); }
/* an instrument track's devices button is a small knob glyph after the instrument (the effects, one click away) */
.ar-hdev.ar-hdev-fx { display: inline-grid; place-items: center; flex: none; width: 18px; height: 18px; margin-left: 4px; padding: 0; border-radius: var(--r-press); }
.ar-hdev.ar-hdev-fx:hover { background: var(--bg-3); color: var(--text); }
/* the instrument: its name in the second ink and the open glyph, at rest; underlined on hover and focus, no box. Only
   the name and the glyph open it */
.ar-hinst { flex: 0 1 auto; display: inline-flex; align-items: center; gap: 3px; min-width: 0; padding: 1px 0; border: 0; background: transparent; color: var(--text-2); font: inherit; text-align: left; cursor: pointer; }
.ar-hinst-n { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 2px; }
.ar-hinst:hover .ar-hinst-n, .ar-hinst:focus-visible .ar-hinst-n { color: var(--text); text-decoration-color: var(--text-3); }
.ar-hinst .ico { flex: none; color: var(--text-3); }
.ar-hinst:hover .ico { color: var(--text-2); }
.ar-hinst:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
/* a sound on trial (ui/sounds.js): "Light Table, trying", in pencil italic */
.ar-hinst.trying .ar-hinst-n { font-style: italic; color: var(--text-3); }
/* Sounds: over the end of the name row, so showing it never moves the header; on the selected track, on one the
   pointer is over or focus is in, and on a new track until its card has been opened (in cream, not pencil) */
.ar-head { --hbg: var(--bg); }
.ar-head:hover { --hbg: color-mix(in srgb, var(--bg-3) 50%, var(--bg)); }
.ar-head.sel { --hbg: var(--bg-3); }
.ar-hrow { position: relative; }
.ar-hsounds { position: absolute; right: 0; top: 50%; transform: translateY(-50%); visibility: hidden; height: auto; min-height: 0; padding: 0 0 0 10px; border: 0; background: linear-gradient(to right, transparent, var(--hbg) 8px); font-size: 12px; line-height: 1.4; }
.ar-head.sel .ar-hsounds, .ar-head.pending .ar-hsounds, .ar-head:focus-within .ar-hsounds { visibility: visible; }
@media (hover: hover) and (pointer: fine) { .ar-head:hover .ar-hsounds { visibility: visible; } }
.ar-head.pending .ar-hsounds { color: var(--text); text-decoration-color: var(--text-3); }
@media (min-width: 701px) { .ar-head.short .ar-hsounds { display: none; } }
/* (while Sounds shows, the name ends before it, with an ellipsis, rather than running under it: "Light Tab… Sounds") */
@media (min-width: 701px) {
  .ar-head.sel:not(.short) .ar-hname, .ar-head.pending:not(.short) .ar-hname, .ar-head:not(.short):focus-within .ar-hname { max-width: calc(100% - 58px); }
}
@media (min-width: 701px) and (hover: hover) and (pointer: fine) { .ar-head:not(.short):hover .ar-hname { max-width: calc(100% - 58px); } }
/* the simple view's R: a lamp on the track R records onto (its arm button is put away there), not a button */
.ar-hlamp { display: none; place-items: center; width: 19px; height: 19px; border: 1px solid var(--rec); border-radius: var(--r-press); background: var(--rec); color: var(--bg); font: 600 10px/1 var(--font-mono); }
/* (its room is kept on every header, so the keys line up whichever track is aimed) */
.ws-off-record-options .ar-head .ar-hlamp { display: inline-grid; visibility: hidden; }
.ws-off-record-options .ar-head.aimed .ar-hlamp, .ar-ghost .ar-hlamp { display: inline-grid; visibility: visible; }
/* the ghost lane: where a new track would go, in pencil italic with a lit R, framed dashed like a muted clip */
.ar-ghost { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto 3px; align-items: center; padding-left: 14px; border-bottom: var(--rule); background: var(--bg); pointer-events: none; user-select: none; }
.ar-ghost .ar-hmain { padding-right: 6px; }
.ar-gname { min-width: 0; font-size: 13px; font-style: italic; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ar-ghostlane { position: absolute; z-index: 1; box-sizing: border-box; border: 1px dashed var(--line-2); pointer-events: none; }
/* the simple view: the swatch put away leaves the track's colour as a plain square */
.ar-hsw.ar-hsw-off { display: none; }
.ws-off-tracks .ar-hsw.ar-hsw-off { display: block; }
/* (the device's name is fitted first; the byline gives way to it, "Firefly, by Cla…", never "Fir…, by Claude") */
.ar-hby { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* a held instrument: "kept off" always shows; its name gives way first */
.ar-hby.ar-hheld { flex: none; }
.ar-hsub:has(.ar-hheld) .ar-hinst { flex: 0 1 auto; }
/* a take lane of an open folder: the take's name (a click plays it everywhere), its byline, where it plays */
.ar-takehead { display: flex; align-items: center; gap: 8px; padding: 0 10px 0 48px; border-bottom: var(--rule); background: var(--bg); white-space: nowrap; overflow: hidden; user-select: none; min-width: 0; font-size: 11.5px; }
.ar-tkname { flex: none; padding: 0; border: 0; background: none; font: 600 12px/1.2 var(--font-ui); color: var(--text-3); cursor: pointer; }
.ar-takehead.on .ar-tkname { color: var(--text); }
.ar-tkname:hover { color: var(--text); text-decoration: underline; text-underline-offset: 2px; }
.ar-tkname:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.ar-tkby { flex: none; }
.ar-tkwhere { min-width: 0; overflow: hidden; text-overflow: ellipsis; margin-left: auto; color: var(--text-3); font: 400 10.5px var(--font-mono); }
.ar-hbtns { flex: none; display: flex; align-items: center; gap: 2px; padding: 0 10px 0 2px; }
.ar-hb { display: inline-grid; place-items: center; width: 19px; height: 19px; border: var(--rule-2); border-radius: var(--r-press); background: transparent; color: var(--text-3); font: 600 10px/1 var(--font-mono); cursor: pointer; padding: 0; }
.ar-hb:hover { color: var(--text); border-color: var(--text-3); }
.ar-hb-arm { color: var(--rec); }
/* a key that is on is lit: mute in grease pencil, solo in cream, arm in record red */
.ar-hb-mute.on { background: var(--accent-2); border-color: var(--accent-2); color: var(--bg); }
.ar-hb-solo.on { background: var(--text); border-color: var(--text); color: var(--bg); }
.ar-hb-arm.on { background: var(--rec); border-color: var(--rec); color: var(--bg); }
.ar-hmeter { align-self: stretch; width: 3px; margin: 10px 0; background: transparent; overflow: hidden; display: flex; align-items: flex-end; }
.ar-hmeter-fill { width: 100%; height: 100%; background: linear-gradient(to top, var(--ok) 70%, var(--warn) 90%, var(--rec)); transform-origin: bottom; transform: scaleY(0); }
/* the A key: a track's automation lanes, lit (a grease-pencil lamp) while they show */
.ar-hb-auto.on { color: var(--text); border-color: var(--accent-2); }
/* a lane's header, indented under the track's: the param, its device in pencil, a byline when someone else wrote it;
   the value at the playhead in mono, Draw (a lamp), Back to the lane when held, Hide */
.ar-lhead { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 0 10px 0 48px; border-bottom: var(--rule); background: var(--bg); user-select: none; min-width: 0; overflow: hidden; }
.ar-lrow { display: flex; align-items: baseline; gap: 6px; min-width: 0; white-space: nowrap; }
.ar-lname { flex: none; max-width: 60%; overflow: hidden; text-overflow: ellipsis; padding: 0; border: 0; background: none; font: 600 12px/1.2 var(--font-ui); color: var(--text-2); text-align: left; cursor: pointer; }
.ar-lname:hover { color: var(--text); }
.ar-lname.struck { color: var(--text-3); }
.ar-lname:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.ar-ldev { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11px; color: var(--text-3); }
.ar-lby, .ar-lheld { flex: none; font-size: 11px; }
.ar-lheld { color: var(--accent-2); }
.ar-lacts { align-items: center; gap: 8px; }
.ar-lval { min-width: 54px; font-size: 11px; color: var(--text-2); }
.ar .ar-lhead .tog, .ar .ar-lhead .btn { height: 18px; min-height: 0; padding: 0 2px; font-size: 11px; }
.ar .ar-lhead .tog { gap: 5px; }
.ar-lhead .ar-lhide { margin-left: auto; }
.ar-lacts > button { flex: none; }
.ar-lhead.held .ar-lval { min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
/* the armed track's input meter: 2 px along the header's bottom edge, ok to warn over the last 6 dB, then bad */
.ar-hin { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; display: none; pointer-events: none; }
.ar-head.armed .ar-hin { display: block; }
.ar-hin-fill { display: block; width: 100%; height: 100%; background: linear-gradient(to right, var(--ok) 0 90%, var(--warn) 90% 98%, var(--bad) 98%); clip-path: inset(0 100% 0 0); }
.ar-addrow { display: flex; align-items: center; width: 100%; padding: 0 14px 0 48px; border: 0; background: transparent; color: var(--text-3); font: 600 12px var(--font-ui); cursor: pointer; }
.ar-addrow span { text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; }
.ar-addrow:hover { color: var(--text); }
.ar-lanewrap { position: relative; overflow: hidden; min-width: 0; min-height: 0; }
.ar-lanes { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.ar-scroll { position: absolute; inset: 0; overflow: auto; outline: none; touch-action: none; }
.ar-scroll:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.ar-spacer { pointer-events: none; }
.ar-playhead { position: absolute; top: 0; bottom: 0; left: 0; width: 1.5px; background: var(--accent); pointer-events: none; opacity: .8; z-index: 2; }
.ar-playhead.playing { opacity: 1; }
.ar-drop { position: absolute; z-index: 4; pointer-events: none; display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--bg) 70%, transparent); outline: 1px dashed var(--accent-2); outline-offset: -1px; color: var(--text); font-size: 12px; font-weight: 600; }
.ar-drop[hidden] { display: none; }
.ar-drop-line { background: var(--accent-2); outline: 0; }
/* the empty song: a head, a sentence, the ways in */
.ar-empty { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: 20px; background: var(--bg); }
.ar-empty[hidden] { display: none; }
.ar-isempty .ar-main { grid-template-columns: 0 1fr; }
.ar-isempty .ar-corner, .ar-isempty .ar-heads { visibility: hidden; }
.ar-empty-card { max-width: 500px; padding-top: 10px; border-top: var(--rule-heavy); animation: ar-in .16s var(--ease, ease) both; }
.ar-empty-take { max-width: 500px; padding-top: 10px; border-top: var(--rule-heavy); }
.ar-empty-take[hidden], .ar-empty-card[hidden] { display: none; }
.ar-empty-title { margin: 0 0 8px; font-size: clamp(26px, 4vw, 36px); color: var(--text); }
.ar-empty-text { margin: 0 0 16px; max-width: 46ch; color: var(--text-2); line-height: 1.5; font-size: 13.5px; }
.ar-empty-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ar-empty-agent svg { color: var(--agent); }
.ar-empty-foot { margin: 14px 0 0; color: var(--text-3); font-size: 12px; }
/* a phone in the simple view: the five doors stacked full width (the blank sheet is the whole first screen) */
@media (max-width: 700px) { .ws-simple .ar-empty-actions { flex-direction: column; align-items: stretch; } .ws-simple .ar-empty-actions .btn { justify-content: center; } }
/* the welcome: a printed insert slipped into the sleeve (.paper: cream, ink, square, the one shadow) */
.ar-welcome { position: absolute; left: 16px; bottom: 16px; z-index: 8; width: min(408px, calc(100% - 32px)); padding: 15px 18px 13px; pointer-events: none;
  font-size: 13px; line-height: 1.45; animation: ar-in .16s .3s var(--ease, ease) both; }
.ar-welcome.out { animation: ar-out .16s var(--ease, ease) both; }
@keyframes ar-in { from { opacity: 0; transform: translateY(4px); } }
@keyframes ar-out { to { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .ar-welcome, .ar-welcome.out, .ar-empty-card { animation: none; } }
.ar-welcome button { pointer-events: auto; }
.ar-welcome-h { margin: 0 64px 10px 0; font-size: 23px; color: var(--ink); }
.ar-credits { margin: 0 0 10px; padding: 6px 0 0; border-top: 2px solid var(--ink); list-style: none; }
.ar-credits li { display: flex; align-items: baseline; gap: 6px; padding: 1px 0; font-size: 12.5px; color: var(--ink); }
.ar-credits li.ar-cr-house { color: var(--ink-2); }
.ar-cr-what { min-width: 0; }
.ar-cr-lead { flex: 1; min-width: 12px; border-bottom: 1px dotted var(--ink-3); transform: translateY(-4px); }
.ar-welcome-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding-top: 9px; border-top: 1px solid var(--paper-rule); }
.ar-welcome .ar-link, .ar-welcome .ar-link.ar-link-agent { color: var(--ink); text-decoration-color: var(--paper-rule); }
.ar-welcome-acts .ar-link { font-weight: 600; }
.ar-welcome .ar-link:hover { text-decoration-color: var(--ink); }
.ar-welcome .ar-welcome-own { background: var(--ink); border-color: var(--ink); color: var(--paper); font-weight: 600; }
.ar-welcome .ar-welcome-own:hover { filter: none; background: var(--ink); }
.ar-welcome .ar-welcome-own:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.ar-welcome-own-s { font-size: 12.5px; color: var(--ink-2); }
.ar-welcome-more { padding-top: 7px; border-top: 0; gap: 4px 14px; }
.ar-welcome .ar-welcome-hear { font-weight: 400; color: var(--ink-2); }
.ar-welcome-hear kbd { margin-right: 4px; color: var(--ink); border-color: var(--paper-rule); }
.ar-welcome-x { position: absolute; top: 12px; right: 14px; min-height: 24px; color: var(--ink-2); font-size: 12px; }
.ar-welcome-x:hover { color: var(--ink); }
.ar-link { border: 0; padding: 0; background: none; color: var(--text-2); font: inherit; cursor: pointer; text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; }
.ar-link:hover { color: var(--text); }
.ar-link.ar-link-agent { color: var(--text); }
/* On the card's paper a link stays in ink whatever the pointer does to it: hovered, pressed, focused, or still
   "hovered" after a tap (iOS keeps :hover): the room's .ar-link:hover is cream, the paper's own colour, so "the tour"
   and "Tap to play it" vanished under a pointer. Focus rings and a pressed key are ink too. */
.ar-welcome .ar-link:is(:hover, :active, :focus, :focus-visible) { color: var(--ink); text-decoration-color: var(--ink); }
.ar-welcome :is(.ar-link, .btn):focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.ar-welcome .btn.ar-welcome-own:active:not(:disabled) { background: var(--ink-2); border-color: var(--ink-2); color: var(--paper); }
.ar-welcome .btn.ar-welcome-x:is(:hover, :active, :focus) { color: var(--ink); }
/* a guitarist's way in, one line under the rest */
.ar-welcome-jam { margin: 0; padding-top: 7px; font-size: 12.5px; color: var(--ink-2); }
.ar-welcome-jam .ar-link { font-weight: 600; }
/* (a finger: the link is drawn 44 px tall in its line, as the row above's are, so neither one's reach is the other's) */
@media (pointer: coarse) { .ar-welcome .ar-welcome-jamlink { display: inline-flex; align-items: center; min-height: 44px; vertical-align: middle; } }
.ar-colors { display: grid; grid-template-columns: repeat(4, 28px); gap: 6px; padding: 4px 6px 6px; }
.ar-color { width: 28px; height: 28px; border-radius: var(--r-press); border: 2px solid transparent; cursor: pointer; }
.ar-color.on, .ar-color:hover { border-color: var(--text); }
@media (max-width: 700px) { .ar-welcome { left: 8px; bottom: 8px; width: calc(100% - 16px); padding: 12px 14px 10px; } .ar-welcome-h { font-size: 20px; } }
/* FALLBACK until the shell fixes it: under 900 px the closed side panels leave the grid, which pushed the main area
   into a 0 px column. Pin it to the middle column. */
@media (max-width: 900px) { .ew-shell .ew-body { grid-template-columns: 0 0 1fr 0 0; } .ew-shell .ew-body > .ew-main { grid-column: 3; } }
/* phones: no track numbers (the header shows M instead, DECISION.md amendment 4), no device line, the swatch before
   the name */
@media (max-width: 700px) {
  .ar-main { grid-template-columns: 124px 1fr; }
  .ar-bar { gap: 8px; padding: 0 6px 0 10px; }
  .ar-hnum, .ar-hsub, .ar-hbtns .ar-hb-arm, .ar-hbtns .ar-hb-solo, .ar-hint, .ar-zoom, .ar-sep { display: none; }
  .ar-lhead { padding-left: 10px; } .ar-ldev, .ar-lby, .ar .ar-lhead .tog, .ar .ar-lhead .btn { display: none; } .ar-lname { max-width: 100%; font-size: 12px; } .ar-lname::after { content: ''; position: absolute; inset: 0; } .ar-lval { font-size: 12px; }
  .ar-head, .ar-ghost { grid-template-columns: minmax(0, 1fr) auto 3px; padding-left: 10px; }
  /* (no sub row here: Sounds takes a line of its own under the name, never over it) */
  .ar-hrow { flex-wrap: wrap; row-gap: 0; }
  .ew-shell .ar-hsounds { position: static; transform: none; flex-basis: 100%; min-height: 24px; padding: 0; background: none; text-align: left; font-size: 12px; }
  /* (one line under the name: the instrument, whose name opens it big as on a computer, and whose window has Sounds;
     on a new track whose sound nobody has picked yet, Sounds in its place) */
  .ar-head .ar-hsub { display: flex; font-size: 12px; }
  .ar-head .ar-hsub > :not(.ar-hinst) { display: none; }
  .ar-head .ar-hinst { min-height: 24px; }
  .ew-shell .ar-head:not(.pending) .ar-hsounds { display: none; }
  .ar-head.pending .ar-hsub { display: none; }
  .ar-hsw { display: block; }
  .ar-hbtns { padding: 0 3px; gap: 2px; } .ar-hb { width: 19px; }
  .ar-corner-row { padding: 0 4px 0 10px; }
  .ar-welcome-x { min-width: 44px; min-height: 40px; top: 4px; right: 6px; }
  .ar-welcome-h { margin-right: 52px; }
}
`;
