// Sketch: where take 1 happens (bottom pane, the first tab). Lay the idea down the way it is in your head:
//   Hum it    the mic -> the spiral and live ghost notes -> a repair view (raw pitch + the notes it became, what was
//             snapped into the key, what it isn't sure of) -> Keep as a clip, or hand it to the agent
//   Tap it    pads, the F J K L keys, or beatbox into the mic -> a quantised drum part
//   Play it   a MIDI keyboard or musical typing (docked in the pane, so it never covers a take's buttons); on a touch
//             screen, a one-octave keyboard in the song's key. Capture is always on: what you just played is already kept
//   Record    an audio input (the Guitar Studio's way in): input, meter, tuner, monitor through the track's pedals and
//             amp, latency calibration, count-in, record to the armed audio track
// The Takes column is the capture log: every hum, tap, phrase and recording, newest first, never lost. Each take is
// tagged with the song it was made in: this song's come first, another song's are listed apart and say which song.
// On a phone (pointer: coarse) the Hum / Beatbox row is pinned to the bottom of the sheet, one row: the mode's button,
// Record and its track, which is Keep's too (one picker). What a take became and its Keep row sit in the sheet under
// the dial or the pads, and come into view when it lands; the line a take records onto sits over them; the sheet opens
// at its top, with the ways in (and, before the mic is allowed, "Allow the mic and hum") in view. The copy says tap, not
// Esc or ⌘Z. Note names are spelled for the key (C minor's Eb Ab Bb), as the piano roll spells them.
//
// The sheet (a computer): the ways in | the stage | Takes. The stage is the mode's options, the canvas and the footer;
// the footer runs under the ways in too and is two rows (the mode's buttons, then the record strip), pinned to the
// bottom of the pane. The canvas has a minimum height and its caption and pass line are lines of their own: a pane
// too short for that scrolls, it never draws labels over each other. Tap's pads are a row in the footer on a
// computer and big squares over the ruler on a touch screen, with the beat's lamps beside or over them. Leaving Play
// it turns musical typing off; a touch screen's keyboard starts in the playing track's own register, with Record
// right above it, and its Each pass / count-in / click are a row under the canvas.
//
// Recording in the song (docs/research/RECORDING-UX.md 3.6, 3.13): the stage's footer ends in the record strip, in
// every mode: Record (R; Stop while it records), the track it records onto, Each pass: Layer or New take, the count-in
// and the click. Whenever the song plays or a take records, the canvas is the beat ruler: the song's bars (the loop, or
// two bars at a time), a cursor sweeping them, and each tap or note drawn the moment it lands as a tick at its raw time
// plus the cell it snapped to; earlier passes dimmed, and a line after each pass ("Pass 2: 16 hits, 9 ms late on
// average"). A take card's first action is Put it in the song (Shift+R for the newest), which puts a take played along
// with the song at the beats where it was played; a take that is in the song says where ("in the song: Keys, bars
// 5–8") and that label shows it in the arranger. Record's input picker writes the record track's Input (track.input,
// the one the recorder opens), so there is one picker. On a phone the strip is pinned to the bottom of the sheet.
// Onto and the keep select beside a take's Keep say where a take goes (docs/INSTRUMENTS-UX.md 2.1): "A new track" first,
// then the tracks that fit, reading and setting the recorder's aim (aim / setAim); Onto shows in the simple view too.
// The sound card (ui/sounds.js) sits in the stage beside the take (app.sounds.setHost), and a take's Keep carries the
// sound on trial for its new track.
// app.sketch = { ruler(), geom(), inTune(), setInTune(on), say(text), host() } is what the tests and the card read
// (geom: the ruler while the song plays; the tap grid's, kind 'tap', when it doesn't).
//
// A beginner's route (docs/FRESH-EYES-3.md): Draw a beat, under the ways in, opens the Beat tab's squares (app.beat.draw,
// ui/drumgrid.js), for anyone who can't tap in time. Play it's keys are in key and on the grid until you say otherwise,
// the touch keys too, and the line over the keys says so ("Snapping to 1/16, in C minor": input/qwerty.js), a click on
// either part turning it off. After a take, Tap's grid shows the beat that went in, recorded with R or not, and on a
// computer the pass line is its caption, so its four rows keep their height.

import { h, css, icon, canvas, tok, clamp, byline } from './dom.js';
import { touchFirst, resolveColor } from './arrange-kit.js';
import { createSpiral, withA } from './spiral.js';
import initInput from '../input/index.js';
import { ROWS } from '../input/tap.js';
import { transcribe, keyChosen } from '../input/hum.js';
import { spellNote, keyLabel, scalePcs, parsePc, beatsPerBar, DRUM_MAP } from '../core/music.js';
import { barsOf, isDrumTrack as isDrumT, leanWords } from '../input/recorder.js';
import { snapGentle } from '../input/timing.js';
import { newPartFor } from '../core/sounds.js';

const MODES = [
  { id: 'hum', label: 'Hum it', icon: 'hum', kbd: 'H', title: 'Hum it.', blurb: 'Sing or hum the idea. It comes back as notes, with every fix shown.' },
  { id: 'tap', label: 'Tap it', icon: 'tap', kbd: 'T', title: 'Tap it.', blurb: 'Tap the beat on the pads or the keys, or beatbox it into the mic.' },
  { id: 'play', label: 'Play it', icon: 'keys', kbd: '`', title: 'Play it.', blurb: 'A MIDI keyboard or your computer keys. Capture is always on: nothing you play is lost.' },
  { id: 'rec', label: 'Record', icon: 'guitar', kbd: 'R', title: 'Record.', blurb: 'Plug in a guitar or a mic. Hear it through the track’s pedals and amp, then record.' },
];
// a touch screen has no computer keys to name
// (a phone's Hum it says it in a line, so the ways in, the dial and "Allow the mic and hum" are in view together)
const TOUCH_BLURB = { hum: 'Hum the idea. It comes back as notes, every fix shown.', tap: 'Tap the beat on the pads, or beatbox it into the mic.', play: 'Play the keys below, or a MIDI keyboard. Capture is always on: nothing you play is lost.' };
// the names a no-key dial or roll spells with: C major's, so the black keys read C# Eb F# Ab Bb (as the piano roll does)
const NO_KEY = { root: 'C', scale: 'major' };
// a take is signed with what you did: "tapped by you"
const SRC_VERB = { hum: 'hummed', tap: 'tapped', beatbox: 'beatboxed', midi: 'played', qwerty: 'played', touch: 'played', rec: 'recorded' };
const AGENT_TEXT = { hum: 'Here’s an idea I hummed — ', tap: 'Here’s a beat I tapped — ', beatbox: 'Here’s a beat I beatboxed — ', midi: 'Here’s something I played — ', qwerty: 'Here’s something I played — ', touch: 'Here’s something I played — ', rec: 'Here’s a take I recorded — ' };
const MODE_KEY = 'overdub:sketch-mode', MIC_OK = 'overdub:mic-ok';
// A new track's name and first instrument come from one place, core/sounds.js newPartFor (Melody, Keys or Drums, then
// "Melody 2"); the instrument is the sound card's to change (ui/sounds.js). Until that module is in the tree the same
// table stands in for it here.
// (asked for once the recorder has its aim, the same change that brings core/sounds.js: before that, asking would
// only be a 404 in the console)
let SOUNDS = null, SOUNDS_ASKED = false;
function loadSounds(app) {
  if (SOUNDS_ASKED || typeof app?.input?.recorder?.aim !== 'function') return;
  SOUNDS_ASKED = true;
  import('../core/sounds.js').then((m) => { SOUNDS = m; }).catch(() => { /* not in this tree: NEW_PART */ });
}
const NEW_PART = { hum: ['Melody', 'core.keys'], keys: ['Keys', 'core.keys'], pads: ['Drums', 'core.drums'] };
export function newPart(kind, project) {
  const k = kind === 'drums' || kind === 'beatbox' ? 'pads' : NEW_PART[kind] ? kind : 'keys';
  if (SOUNDS?.newPartFor) { try { const r = SOUNDS.newPartFor(k, project); if (r && r.name && r.device) return r; } catch (e) { /* the table */ } }
  const [base, device] = NEW_PART[k], names = new Set((project?.tracks || []).map((t) => t.name));
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base} ${i}`;
  return { name, device };
}
// the aim's kind for a take in Takes (a beat, a hum, or notes played)
const aimKindOf = (p) => (!p ? 'keys' : p.kind === 'drums' ? 'pads' : p.src === 'hum' ? 'hum' : 'keys');

export default function (app) {
  if (!app.input) initInput(app);
  loadSounds(app);
  css('sketch', CSS);
  // every take belongs to the song it was made in (whether or not the pane is open): a New song starts with none
  app.input.capture.on((e) => {
    const ph = e && e.phrase;
    if (e.what === 'add' && ph && !ph.song) { const p = app.store.get(); app.input.capture.update(ph.id, { song: p.id, songTitle: p.title }); }
  });
  app.ui.panel({ id: 'sketch', region: 'bottom', title: 'Sketch', icon: 'spiral', order: 5, mount });
  // Make it longer (docs/FRESH-EYES-4.md, the beginner's problem 4): a short song (a bar, two or four, the first
  // minute's) repeats what's there to 8 bars, every part together, in one undo step. The tour's last card and the toast
  // after a kept take offer it while the song is that short; the agent's "make it longer" is the same move.
  // app.song = { longer({ bars }) -> { ok, summary, bars, clips } | { ok: false, error }, longerPlan({ bars }), offer() -> button | null }
  app.song = Object.assign(app.song || {}, {
    longerPlan: (o) => longerPlan(app, o),
    longer: (o) => makeLonger(app, o),
    offer: (o) => longerOffer(app, o),
  });
}

// What a short song repeats to `bars`: the span from its first clip's bar to its last clip's end (the clips that play;
// a take's muted passes stay where they are). When that span divides `bars` (1, 2 or 4 bars into 8), each part that
// fills the span is repeated as one clip.repeat (its automation with it) and a shorter part is copied at the span's
// period, so the parts stay together. When it doesn't (a 3-bar hum over the first minute's 2-bar beat), each track
// loops at its own length rounded up to one that does (1, 2 or 4 bars, from the song's first bar; a longer part plays
// once), so the beat runs under all of it and the tune comes round on the next even phrase: still offered, the song
// still short. The loop, if it is on round that span (or from its start to inside it), grows with it.
// cover: the loop, if it is on and doesn't hold the 8 bars, is set round them (Hum over it: a hum over the beat records
// as one take over all of it, not a take a pass of the first minute's 2-bar loop)
export function longerPlan(app, { bars = 8, cover = false } = {}) {
  const p = app.store.get(), bpb = beatsPerBar(p.meter), EPS = 1e-6;
  const playing = p.tracks.flatMap((t) => t.clips.filter((c) => !c.mute).map((c) => ({ t, c })));
  if (!playing.length) return { ok: false, error: 'There’s nothing in the song yet to repeat: play or draw a part first.' };
  const a = Math.floor(Math.min(...playing.map(({ c }) => c.start)) / bpb + EPS) * bpb;
  const b = Math.ceil(Math.max(...playing.map(({ c }) => c.start + c.length)) / bpb - EPS) * bpb;
  const n = Math.round((b - a) / bpb), P = b - a;
  if (n >= bars) return { ok: false, error: `The song is ${n} bars already.` };
  const even = !(bars % n), times = even ? bars / n : null, ops = [], parts = new Map();   // track name -> times it plays
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const copy = (t, c, at) => {
    const x = JSON.parse(JSON.stringify(c));
    delete x.id; delete x.by; delete x.take;
    if (Array.isArray(x.notes)) for (const nt of x.notes) delete nt.id;
    x.start = r4(at);
    ops.push({ type: 'clip.add', track: t.id, clip: x });
  };
  if (even) {
    for (const { t, c } of playing) {
      parts.set(t.name, times);
      if (Math.abs(c.start - a) < EPS && Math.abs(c.length - P) < EPS) { ops.push({ type: 'clip.repeat', track: t.id, clip: c.id, times }); continue; }
      for (let k = 1; k < times; k++) copy(t, c, c.start + k * P);
    }
  } else {
    // each track's period: the bars from the song's first bar to its last clip's end, rounded up to divide `bars`
    for (const t of [...new Set(playing.map((x) => x.t))]) {
      const cs = playing.filter((x) => x.t === t).map((x) => x.c);
      const end = Math.max(1, Math.ceil(Math.max(...cs.map((c) => c.start + c.length - a)) / bpb - EPS));
      let per = end;
      while (bars % per) per++;
      const k = bars / per;
      parts.set(t.name, k);
      for (const c of cs) for (let i = 1; i < k; i++) copy(t, c, c.start + i * per * bpb);
    }
    if (!ops.length) return { ok: false, error: `${n} bars don’t repeat evenly to ${bars}.` };
  }
  const lp = p.loop;
  if (lp?.on && Math.abs(lp.start - a) < EPS && (even ? Math.abs(lp.end - b) < EPS : lp.end > a + EPS && lp.end <= b + EPS)) ops.push({ type: 'project.set', patch: { loop: { ...lp, end: a + bars * bpb } } });
  else if (cover && lp?.on && !(lp.start <= a + EPS && lp.end >= a + bars * bpb - EPS)) ops.push({ type: 'project.set', patch: { loop: { ...lp, start: a, end: a + bars * bpb } } });
  const names = [...parts.keys()];
  const from = Math.round(a / bpb) + 1;
  const often = (k) => (k === 1 ? 'once' : k === 2 ? 'twice' : `${k} times`);
  let what;
  if (even) what = `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} ${names.length > 1 ? 'play' : 'plays'} ${often(times)}`;
  else {
    // "Drums plays 4 times and Hum twice": the parts in the song's order, each with how often it plays
    const each = names.map((nm, i) => (i ? `${nm} ${often(parts.get(nm))}` : `${nm} plays ${often(parts.get(nm))}`));
    what = each.length > 1 ? `${each.slice(0, -1).join(', ')} and ${each[each.length - 1]}` : each[0];
  }
  return { ok: true, ops, times: times ?? Math.max(...parts.values()), bars, from, to: from + bars - 1, n,
    summary: `It’s ${bars} bars now: ${what}, bars ${from}–${from + bars - 1}.` };
}
export function makeLonger(app, { bars = 8, by = 'you', toast = true, cover = false } = {}) {
  const plan = longerPlan(app, { bars, cover });
  if (!plan.ok) { if (toast) app.ui.toast(plan.error, { kind: 'bad' }); return plan; }
  const r = app.store.dispatch(plan.ops, { by, label: `make it ${bars} bars` });
  if (!r.ok) { if (toast) app.ui.toast('Couldn’t make it longer: ' + r.error, { kind: 'bad' }); return r; }
  if (toast) app.ui.toast(`${plan.summary} Undo takes it back.`, { kind: 'ok', ms: 6000, action: { label: 'Undo', run: () => app.store.undo({ by }) } });
  return { ok: true, summary: plan.summary, bars, clips: r.created?.clips || [] };
}
// The offer, as a button for a card or a toast's line: only while the song is short enough to repeat to 8 bars
export function longerOffer(app, { bars = 8, after = null } = {}) {
  if (!longerPlan(app, { bars }).ok) return null;
  const b = h('button.btn.btn-txt.ew-toast-act.sk-longer', { type: 'button', onclick: (e) => { const r = makeLonger(app, { bars }); after?.(r); e.currentTarget.closest('.ew-toast')?.remove(); } }, `Make it ${bars} bars`);
  // (an offer that has come true some other way, Hum over it or an undo of the take, goes from the toast it's on)
  const off = app.store.on('change', () => {
    if (!b.isConnected && b._shown) { off(); return; }
    if (b.isConnected) b._shown = true;
    if (!longerPlan(app, { bars }).ok) { off(); b._gone = true; b.remove(); }
  });
  return b;
}

function mount(el, app) {
  const input = app.input, store = app.store, ui = app.ui;
  let mode = 'hum';
  try { mode = localStorage.getItem(MODE_KEY) || 'hum'; } catch (e) { /* ok */ }
  if (!MODES.some((m) => m.id === mode)) mode = 'hum';
  let view = null;       // the current mode's view: { body, foot, opts, frame(now), update(evt), destroy() }
  const offs = [];
  const listen = (off) => { offs.push(off); return off; };

  const touch = touchFirst();   // a touch-first screen: no keys to name, a thumb to reach
  // the ways in, as a list of words: the open one is set in display italic (it is the pane's heading)
  const rail = h('nav.sk-rail', { role: 'tablist', 'aria-label': 'Ways in' }, MODES.map((m) => h('button.sk-mode', { role: 'tab', dataset: { mode: m.id }, onclick: () => setMode(m.id), title: touch ? m.label : `${m.label} (${m.kbd})` },
    h('span.sk-mode-l', m.label))));
  const railNote = h('p.sk-railnote', touch ? 'Every take lands in Takes and stays there.' : ['Every take lands in Takes and stays there. Press ', h('kbd', '0'), ' on a clip to mute it.']);
  // one more way in, under Tap it: a beat drawn square by square in the Beat tab, with nothing to play in time
  const drawB = h('button.sk-draw', { type: 'button', title: 'Draw a beat in the Beat tab: click squares, nothing to play in time', onclick: () => (app.beat?.draw ? app.beat.draw() : ui.show('drumgrid')) }, 'Draw a beat');
  const modes = h('div.sk-modes', rail, drawB, railNote);
  const head = h('header.sk-head'), body = h('div.sk-body'), foot = h('footer.sk-foot');
  // the record strip: the end of the stage's footer, after the mode's own buttons (on a phone the footer is pinned to
  // the bottom of the sheet, so Record and Stop stay in reach)
  const strip = h('div.sk-strip', { role: 'group', 'aria-label': 'Record into the song' });
  const stage = h('section.sk-stage', head, body, foot);
  const ideasList = h('div.sk-ideas-list', { role: 'list' });
  const ideasCount = h('span.sk-count');
  const ideas = h('aside.sk-ideas', { 'aria-label': 'Takes (the capture log)' },
    h('header.sk-ideas-head.sheet-head', h('h3', 'Takes'), ideasCount, h('span.aside.sk-hint', { title: 'Every hum, tap, phrase and recording is kept here (and in this browser) until you keep it or let it go. Nothing is wiped silently.' }, 'this song, never wiped')),
    ideasList);
  const root = h('div.sk' + (touch ? '.touch' : ''), modes, stage, ideas);
  el.append(root);
  // A phone (a touch screen, the pane 640 px or under; docs/FRESH-EYES-4.md, the phone's problem 2): the footer (Hum or
  // Beatbox, Record) is a row of its own at the foot of the sheet and everything else scrolls above it, so it never
  // covers the pads or the hum dial (pinned over a scrolling pane, it hid their bottom 20 px and more).
  const scroll = h('div.sk-scroll');
  const isSplit = () => root.classList.contains('sk-split');
  let noteReady = false;   // (the record strip's line exists: placeNote)
  function placeFoot() {
    const split = touch && el.clientWidth > 0 && el.clientWidth <= 640;
    if (split === isSplit()) return;
    root.classList.toggle('sk-split', split);
    if (split) { scroll.append(modes, stage, ideas); root.replaceChildren(scroll, foot); }
    else { stage.append(foot); root.replaceChildren(modes, stage, ideas); }
    // (the mode's take row and the record line move between the pinned row and the sheet)
    view?.place?.();
    settle();
    if (split) requestAnimationFrame(revealStage);
  }
  // The sheet opens at its top, the ways in in view (it used to open scrolled down to the dial, the ways in under the
  // tabs); the mode's own instrument, the pads or the hum dial, comes whole into view above the pinned row, scrolled
  // only as far as it takes
  function revealStage() {
    if (!isSplit()) return;
    scroll.scrollTop = 0;
    const it = body.querySelector('.sk-padcol, .sk-spiral, .sk-tk-keys');
    if (!it || !it.getClientRects().length) return;
    const r = it.getBoundingClientRect(), v = scroll.getBoundingClientRect();
    if (r.bottom > v.bottom) scroll.scrollTop += Math.min(r.bottom - v.bottom + 6, Math.max(0, r.top - v.top - 4));
  }
  // the note under the ways in (a computer): only where the column has room for all of it, never cut off at the footer
  function fitRailNote() {
    railNote.hidden = false;
    if (isSplit() || !railNote.getClientRects().length) return;
    railNote.hidden = modes.scrollHeight > modes.clientHeight + 1;
  }
  placeFoot();
  const footRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestAnimationFrame(() => { placeFoot(); fitRailNote(); })) : null;
  footRO?.observe(el);

  /* ---------------------------------------------------------------- shared bits */
  const instrumentTracks = () => store.get().tracks.filter((t) => t.kind === 'instrument');
  const isDrumTrack = (t) => t && /drum/i.test(t.instrument?.device || '');
  // this song's takes (another song's are listed apart, never as this one's)
  const ofSong = (p) => !!p && !!p.song && p.song === store.get().id;
  const latestOf = (kind) => input.capture.list({ all: true }).find((p) => p.kind === kind && ofSong(p)) || null;
  // where a take is kept now: the last keep whose clip is still in the song (an undone keep doesn't count)
  const keptOn = (p) => (p?.kept || []).slice().reverse().find((k) => store.clip(k.track, k.clip)) || null;
  // the stage's Keep, once its take is kept: "Kept ✓", no longer the bright primary
  function setKept(btn, k) {
    const t = k && store.track(k.track);
    btn.classList.toggle('ew-btn-primary', !k); btn.classList.toggle('btn-go', !k); btn.classList.toggle('sk-kept', !!k);
    btn.disabled = !!k;
    btn.title = k ? `Kept on ${t ? t.name : 'a track'}. Keep on its card in Takes puts it somewhere else too.` : 'Keep it as a clip (by you)';
    btn.querySelector('.sk-wide').textContent = k ? 'Kept ✓' : 'Keep as a clip';
    btn.querySelector('.sk-narrow').textContent = k ? 'Kept ✓' : 'Keep';
  }
  // the keep-to select, drawn from this song's tracks; what you picked stays picked while it's still there
  function fillDest(dest, kind, prefer) {
    const was = dest.firstChild?.value, sel = destSelect(kind, prefer);
    if (was && [...sel.options].some((o) => o.value === was)) sel.value = was;
    dest.replaceChildren(sel);
  }
  // a take lands: on a phone its Keep row comes into view (the sheet scrolls), with the dial or the pads above it and
  // the take's line between when they fit
  const bringKeep = (acts, inst = null) => {
    if (!touch) return;
    requestAnimationFrame(() => {
      if (acts.hidden || !acts.isConnected) return;
      if (isSplit() && inst && inst.isConnected) {
        const v = scroll.getBoundingClientRect(), a = acts.getBoundingClientRect(), i = inst.getBoundingClientRect();
        if (a.bottom - i.top <= v.height - 8) { scroll.scrollTop += i.top - v.top - 4; return; }
      }
      acts.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
  // A phone's take row has one picker, Record's (the strip's): Keep goes where it says, and says where
  // ("Keep on Bass", "Keep on a new track"). kind: 'notes' | 'drums'
  const stripDest = () => { const t = stripTarget(); return t ? t.id : 'new'; };
  const isNewDest = (v) => !v || v === 'new' || v.startsWith('new:');
  function keepOnLabel(btn, value) {
    const t = !isNewDest(value) ? store.track(value) : null, text = t ? `Keep on ${t.name}` : 'Keep on a new track';
    for (const s of btn.querySelectorAll('.sk-wide, .sk-narrow')) s.textContent = text;
    btn.title = `${text}, as a clip, by you: the track Record’s picker shows (pick another there)`;
  }
  // a track's colour for the canvases, through the timeline views' allowlist (a token or a hex colour, else sage)
  const colorOf = (trackId) => { const t = trackId && store.track(trackId); return resolveColor(t ? t.color : 'var(--c-4)', '#5fd0b2'); };
  function chip(label, on, onclick, title) { return h('button.sk-chip' + (on ? '.on' : ''), { type: 'button', onclick, title: title || label, 'aria-pressed': String(!!on) }, label); }
  // a part the simple view can put away (ui/workspace.js hides [data-feature~=id] while that feature is put away)
  function tagged(el, feature) { el.dataset.feature = feature; return el; }
  function seg(opts, cur, onpick, label) {
    return h('div.sk-seg', { role: 'radiogroup', 'aria-label': label }, opts.map(([v, l]) => h('button' + (v === cur ? '.on' : ''), { role: 'radio', 'aria-checked': String(v === cur), onclick: () => onpick(v) }, l)));
  }
  // Where a kept take goes: "A new track" first, then the tracks that fit it ("On Melody", "On Keys"), the same list and
  // the same default as Onto (where R would put this kind of take: recorder.aim). The new track's instrument is the
  // sound card's to pick (ui/sounds.js), so there is no instrument in this list. kind: 'hum' | 'keys' | 'pads';
  // all: every instrument track (a card's Keep on…)
  const fitsKind = (t, kind) => t && t.kind === 'instrument' && (kind === 'pads' ? isDrumTrack(t) : kind === 'hum' ? !isDrumTrack(t) : true);
  function destSelect(kind, preferTrack, { all = false } = {}) {
    const sel = h('select.sk-select', { 'aria-label': 'Keep it on' });
    const tracks = instrumentTracks().filter((t) => all || fitsKind(t, kind));
    const pref = preferTrack && tracks.find((t) => t.id === preferTrack && fitsKind(t, kind));
    const aimed = aimOf(kind);
    const def = pref ? pref.id : aimed && tracks.some((t) => t.id === aimed.id) ? aimed.id : 'new';
    sel.append(h('option', { value: 'new' }, 'A new track'), ...tracks.map((t) => h('option', { value: t.id }, `On ${t.name}`)));
    sel.value = def;
    return sel;
  }
  // Keep a take. A new track is named for what it is (newPart: Melody for a hum) and plays the sound the card has on
  // trial for it, made in the keep's own transaction (track, clip and sound, one undo step); kept onto a track whose
  // sound is on trial, the sound is kept first. Then the card is offered for the track (it decides whether it opens).
  function keepTo(id, value, opts = {}) {
    const ph0 = input.capture.get(id), kind = aimKindOf(ph0), tr = app.sounds?.trying?.() || null;
    const toNew = isNewDest(value);
    let newTrack = null;
    // (the previewed new track goes before the real one is made, or before the take goes onto another track: takeNew
    // lets it go and says what sound was on trial for it)
    let handed = null;
    if (tr && tr.newTrack) {
      try { if (toNew && typeof app.sounds.takeNew === 'function') handed = app.sounds.takeNew(); } catch (e) { handed = null; }
      if (!handed) {
        try { app.sounds.back?.({ why: 'kept' }); } catch (e) { /* ok */ }
        if (!toNew) { try { app.sounds.close?.(); } catch (e) { /* ok */ } }
        else handed = { device: tr.device, preset: tr.preset || null };
      }
    }
    if (toNew) {
      const part = newPart(kind, store.get());
      newTrack = { name: part.name, device: part.device };
      if (handed?.device) { newTrack.device = handed.device; if (handed.preset) newTrack.preset = handed.preset; if (handed.params && Object.keys(handed.params).length) newTrack.params = handed.params; }
    }
    else if (tr && !toNew && tr.track === value) { try { app.sounds.keepIfTrying?.(value); } catch (e) { /* ok */ } }
    const first = toNew || !(store.track(value)?.clips || []).length;
    // a hum on a song with no key yet: the key heard in it becomes the song's, so the next hum snaps to it (not to a
    // default nobody chose)
    const ph = input.capture.get(id);
    let keyed = null;
    if (ph && ph.src === 'hum' && ph.keyFrom === 'hum' && ph.key && !keyChosen(store.get(), store.history)) {
      const k = { root: ph.key.root, scale: ph.key.scale };
      if (store.dispatch({ type: 'project.set', patch: { key: k } }, { by: 'you', label: `key ${keyLabel(k)}, heard in your hum` }).ok) keyed = k;
    }
    const r = toNew ? input.capture.keep(id, { newTrack, ...opts }) : input.capture.keep(id, { track: value, ...opts });
    if (r.ok) {
      const t = store.track(r.track), name = t ? t.name : 'a new track', also = keyed ? ` The song is in ${keyLabel(keyed)} now, from your hum.` : '';
      const steps = keyed ? 2 : 1;
      // (a short song: "Make it 8 bars" beside it)
      const more = longerOffer(app, { bars: 8 }), with8 = (t) => (more ? [t, ' ', more] : t);
      if (touch) ui.toast(with8(`Kept on ${name}.${also} It’s yours: tap Undo to take it back.`), { kind: 'ok', action: { label: 'Undo', run: () => { for (let i = 0; i < steps; i++) store.undo(); } } });
      else ui.toast(with8(`Kept on ${name}.${also} It’s yours: undo with ⌘Z${keyed ? ' (twice for the key)' : ''}.`), { kind: 'ok', ...(more ? { ms: 8000 } : {}) });
      try { app.sounds?.offer?.({ track: r.track, from: 'take', take: { capture: id, kind, src: ph0?.src || null, kept: true, first } }); } catch (e) { console.error(e); }
    } else { if (keyed) store.undo(); ui.toast(r.error, { kind: 'bad' }); }
    return r;
  }
  function toAgent(id) {
    // mid-tour, on "Now the overdub", with no key: this is the tour's ask (the demo agent plays over the kept take),
    // not the key card, which would be a dead end for a newcomer who followed Tab here
    const ob = app.onboard;
    if (ob?.active && ob.step === 'ask' && ob.ask && (!app.agent?.provider || app.agent.provider === 'mock')) { ob.ask(); return; }
    const p = input.capture.get(id);
    ui.emit('agent:compose', { text: AGENT_TEXT[p?.src] || 'Here’s an idea — ', attach: { capture: id } });
    try { ui.setOpen && ui.setOpen('right', true); } catch (e) { /* ok */ }
    ui.toast('Handed to the agent. Tell it what to play over it.', { kind: 'agent' });
  }
  // play a phrase's notes on a track (an audition, not the transport). One preview at a time: `preview.id` names the
  // take whose button shows Stop; the killswitch (engine 'silence') and a second press stop it.
  let preview = { id: null, timers: [], on: new Set(), track: null, src: null };
  // the raw taps behind each tapped take (this visit only): the tap grid draws each one as a tick over the cell it
  // snapped to, so you can see how far the grid moved you
  const rawOf = new Map();
  function hear(notes, trackId, { drums = false, id = null } = {}) {
    stopHear();
    // (no track given and the card is trying a sound for this take's new track: the take plays on that one)
    const tr = !trackId ? app.sounds?.trying?.() : null;
    const t = trackId && store.track(trackId) ? trackId : tr?.newTrack && store.track(tr.track) ? tr.track : drums ? instrumentTracks().find(isDrumTrack)?.id : input.target()?.id;
    if (!t || !notes.length) return;
    const spb = 60 / store.get().tempo, eng = app.engine, pv = preview;
    pv.id = id; pv.track = t;
    let end = 0;
    for (const n of notes) {
      const off = (n.t + Math.max(0.1, n.d * 0.95)) * spb * 1000 + 30;
      end = Math.max(end, off);
      pv.timers.push(setTimeout(() => { try { eng.liveNoteOn(t, n.p, n.v ?? 0.8); pv.on.add(n.p); } catch (e) { /* ok */ } }, n.t * spb * 1000 + 30));
      pv.timers.push(setTimeout(() => { try { eng.liveNoteOff(t, n.p); pv.on.delete(n.p); } catch (e) { /* ok */ } }, off));
    }
    pv.timers.push(setTimeout(() => { if (preview === pv) stopHear(); }, end + 60));
    markPreview();
  }
  function stopHear() {
    const pv = preview;
    preview = { id: null, timers: [], on: new Set(), track: null, src: null };
    for (const x of pv.timers) clearTimeout(x);
    for (const p of pv.on) { try { app.engine.liveNoteOff(pv.track, p); } catch (e) { /* ok */ } }
    if (pv.src) { try { pv.src.stop(); pv.src.disconnect(); } catch (e) { /* ended */ } }
    if (pv.id) markPreview();
  }
  async function hearAudio(asset, id = null) {
    stopHear();
    try {
      const b = await app.engine.assets.get(asset); const c = app.engine.ctx || input.audio.ctx;
      if (!b || !c) return;
      const s = c.createBufferSource(); s.buffer = b;
      // through the speakers' feed when the engine has one, so the killswitch cuts it with everything else
      s.connect((c === app.engine.ctx && app.engine._monitor) || c.destination); s.start();
      preview.src = s; preview.id = id;
      s.onended = () => { if (preview.src === s) stopHear(); };
      markPreview();
    } catch (e) { ui.toast('Couldn’t play the recording: ' + e.message, { kind: 'bad' }); }
  }
  // a take's Hear button: Stop while it plays
  // a take's Hear button is a word: Stop while it plays
  const hearIcon = (id, title) => (preview.id && preview.id === id ? 'Stop' : title === 'Hear what you hummed' ? 'Your hum' : 'Hear');
  function markPreview() {
    for (const b of ideasList.querySelectorAll('.sk-hear')) {
      const on = !!preview.id && b.dataset.id === preview.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Stop' : b.dataset.title;
      b.replaceChildren(hearIcon(b.dataset.id, b.dataset.title));
    }
  }
  const hearBtnFor = (id, title, run) => h('button.btn.sk-hear', { dataset: { id, title }, 'aria-pressed': String(preview.id === id), title: preview.id === id ? 'Stop' : title, onclick: () => (preview.id === id ? stopHear() : run()) }, hearIcon(id, title));
  listen(app.engine?.on?.('silence', () => stopHear()) || (() => {}));

  /* ---------------------------------------------------------------- the beat ruler: Sketch follows the song */
  // Whenever the song plays (or a take records), the canvas is the song: its bars (the loop, or two bars at a time
  // from where it started), a cursor sweeping them, and every tap or note drawn the moment it lands, as a tick at its
  // raw time and the cell it snapped to. Earlier passes are dimmed; after each pass, one line of how it sat against
  // the click (RECORDING-UX 3.6). A take's notes come from the recorder (live()); played along with no take running,
  // from the pads' and the keys' own events, placed at the audible beat of the event.
  const rec = input.recorder, eng = app.engine;
  const bpbNow = () => beatsPerBar(store.get().meter);
  const spbNow = () => 60 / (+store.get().tempo || 120);
  const gridQ = () => input.options.grid || 0.25;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  // (a free take, no click and nothing playing, has no song to follow: the tap grid and the hum's roll draw it)
  const following = () => !!(eng && eng.playing) || (rec.state !== 'idle' && !rec.free);
  const along = { marks: [], pass: 0, last: null, anchor: null, playing: false, open: new Map() };
  let recLive = null;           // the recorder's live() as of the last frame (a take in progress)
  let readout = null;           // the last pass's line: { pass, hits, ms, text }
  const readouts = [];
  let geom = null;              // where the ruler last drew (the tests read it)
  const readEl = h('div.sk-pass.mono', { role: 'status', 'aria-live': 'polite', hidden: true });
  // the audible beat of the event being handled (a key's timeStamp: main-thread lag mustn't draw a tap late)
  function evBeat() {
    let ts = null;
    try { const ev = globalThis.event; if (ev && ev.timeStamp > 0 && performance.now() - ev.timeStamp < 150) ts = ev.timeStamp; } catch (e) { /* ok */ }
    try { if (ts != null && typeof eng.beatAt === 'function') { const b = eng.beatAt(ts); if (Number.isFinite(b) && Math.abs(b - eng.beat) < 1) return b; } } catch (e) { /* ok */ }
    return eng.beat;
  }
  const rowOfP = (p) => (ROWS.find((r) => r.p === p || DRUM_MAP[r.id] === p) || null)?.id || null;
  // (a tap snaps to the grid; so does a note from musical typing or the touch keys while On the grid is on)
  const keysSnap = (src) => (src === 'qwerty' || /^touch/.test(src || '')) && !!input.qwerty?.quantize;
  // (a tap lands where the recorder would put it: an eighth when it's near one, else the grid's cell: input/timing.js)
  function mark(m) { const q = gridQ(); return { pass: along.pass, d: q, v: 0.8, held: false, ...m, t: m.kind === 'drums' ? snapGentle(m.raw, { coarse: Math.max(q, 0.5), fine: q }) : m.snap ? Math.round(m.raw / q) * q : m.raw }; }
  // the marks to draw: the take's passes (and held keys), or what was played along since the song started
  function marksOf(L) {
    const out = [];
    replacedIn = new Map((L.passes || []).map((ps) => [ps.n, ps.replaced || 0]));
    for (const ps of L.passes || []) {
      ps.notes.forEach((n, i) => out.push({ pass: ps.n, kind: ps.drums ? 'drums' : 'pitch', p: n.p, row: ps.drums ? rowOfP(n.p) : null, t: n.t, raw: ps.raw?.[i] ?? n.t, d: n.d, v: n.v, track: ps.track, held: false }));
    }
    for (const x of L.held || []) out.push({ pass: L.pass, kind: 'pitch', p: x.p, row: null, t: x.t, raw: x.t, d: x.d, v: x.v, track: x.track, held: true });
    return out;
  }
  const marksNow = () => (recLive ? { marks: marksOf(recLive), pass: recLive.pass } : { marks: along.marks, pass: along.pass });
  // after a pass: how it sat against the click, the engineer's number (no grade). Measured against where each one
  // landed (the cell the forgiving grid put it in, which is where it plays), so the number is honest: how far you
  // were from what went in, and how many were nudged into place (more than 20 ms) or replaced a miss from an
  // earlier pass (input/recorder.js settleMisses)
  let replacedIn = new Map();
  function setReadout(n, ms0) {
    const ms = ms0.filter((m) => !m.held);
    if (!ms.length) return;
    const spb = spbNow();
    // (a hit just before the loop came round lands on its downbeat: measured across the seam, not a loop's length)
    const lp = recLive?.loop || (store.get().loop?.on ? store.get().loop : null), len = lp ? lp.end - lp.start : 0;
    const offs = ms.map((m) => { let d = m.raw - m.t; if (len > 0 && Math.abs(d) > len / 2) d -= Math.sign(d) * len; return d * spb * 1000; });
    const mean = offs.reduce((a, b) => a + b, 0) / offs.length, abs = Math.round(Math.abs(mean));
    const noun = ms.every((m) => m.kind === 'drums') ? 'hit' : 'note';
    const moved = offs.filter((x) => Math.abs(x) > 20), most = moved.length ? Math.round(Math.max(...moved.map(Math.abs))) : 0;
    const rep = replacedIn.get(n) || 0;
    // (a steady lean, most of them late or most early by 40 ms or more: said as such, "behind the click", since the
    // take moved them onto the beat; input/timing.js leanOf)
    const side = mean > 0 ? offs.filter((x) => x > 20).length : offs.filter((x) => x < -20).length;
    const leaning = abs >= 40 && side >= 0.75 * offs.length;
    const text = `Pass ${n + 1}: ${ms.length} ${noun}${ms.length === 1 ? '' : 's'}, `
      + (leaning ? `about ${Math.round(abs / 10) * 10} ms ${mean > 0 ? 'behind' : 'ahead of'} the click; ${moved.length === ms.length ? 'all' : moved.length} moved onto the beat`
        : `${abs === 0 ? 'on the grid on average' : `${abs} ms ${mean > 0 ? 'late' : 'early'} on average`}${moved.length ? `; ${moved.length} nudged into place, ${most} ms at most` : ''}`)
      + (rep ? `; ${rep} replaced ${rep === 1 ? 'a miss' : 'misses'} from before` : '');
    readout = { pass: n + 1, hits: ms.length, ms: Math.round(mean * 10) / 10, nudged: moved.length, most, replaced: rep, leaning, text };
    readouts.push(readout); if (readouts.length > 16) readouts.shift();
    paintReadout();
  }
  function paintReadout() { readEl.textContent = readout ? readout.text : ''; readEl.title = readEl.textContent; readEl.hidden = !readout; }
  // played along with no take running: a pass ends when the playhead goes back (the loop's wrap) or the song stops
  function trackAlong() {
    const playing = !!(eng && eng.playing) && rec.state === 'idle';
    const bpb = bpbNow();
    if (playing && !along.playing) {
      along.marks = []; along.pass = 0; along.open.clear(); along.last = null;
      along.anchor = Math.floor(Math.max(0, eng.beat || 0) / bpb + 1e-9) * bpb;
      if (rec.state === 'idle' && !recLive) { readout = null; paintReadout(); }
    }
    if (!playing && along.playing) setReadout(along.pass, along.marks.filter((m) => m.pass === along.pass));
    along.playing = playing;
    if (!playing) return;
    const b = eng.beat;
    if (along.last != null && b < along.last - 0.5) { setReadout(along.pass, along.marks.filter((m) => m.pass === along.pass)); along.pass++; }
    along.last = b;
  }
  listen(input.tap.on('hit', (e) => {
    if (!e || e.rec || e.live || rec.state !== 'idle' || !eng.playing) return;
    along.marks.push(mark({ kind: 'drums', row: e.row, p: (ROWS.find((r) => r.id === e.row) || ROWS[0]).p, raw: evBeat(), v: e.v ?? 0.8, track: input.target('pads')?.id || null }));
    if (along.marks.length > 2000) along.marks.splice(0, 500);
  }));
  listen(input.on('note', (e) => {
    if (!e || rec.state !== 'idle' || !eng.playing) return;
    const k = e.src + ':' + e.p;
    if (e.on) { const m = mark({ kind: 'pitch', p: e.p, raw: evBeat(), d: 0, v: e.v ?? 0.8, track: e.track, held: true, snap: keysSnap(e.src) }); along.open.set(k, m); along.marks.push(m); }
    else { const m = along.open.get(k); if (m) { along.open.delete(k); m.held = false; m.d = Math.max(1 / 16, (eng.beat - m.raw) || 0); } }
  }));
  // a take's passes: the line after each one (the recorder's 'pass' says the next has begun), and the last at the stop
  listen(rec.on('pass', (e) => { const L = rec.live(); if (L) recLive = L; const n = (e && Number.isFinite(e.n) ? e.n : (L ? L.pass : 1)) - 1; if (L && n >= 0) setReadout(n, marksOf(L).filter((m) => m.pass === n)); }));
  listen(rec.on('note', () => { const L = rec.live(); if (L) recLive = L; }));
  listen(rec.on('state', (e) => {
    const s = e && e.state;
    if (s === 'idle' && recLive) { const L = recLive; recLive = null; setReadout(L.pass, marksOf(L).filter((m) => m.pass === L.pass)); along.playing = false; }
    else if (s && s !== 'idle' && !recLive) { recLive = rec.live(); readout = null; paintReadout(); }
    paintStrip(true);
  }));

  // the ruler's bars: a take's loop (or two bars at a time from the bar it began in), else the loop the playhead is in,
  // else two bars at a time from the bar the song started at
  function rulerWindow() {
    const p = store.get(), bpb = bpbNow(), page = 2 * bpb;
    const L = recLive, b = eng.beat || 0;
    if (L) {
      if (L.loop) return [L.loop.start, L.loop.end];
      const a = Math.floor(L.from / bpb + 1e-9) * bpb, k = Math.max(0, Math.floor((b - a) / page));
      return [a + k * page, a + (k + 1) * page];
    }
    const lp = p.loop;
    if (lp && lp.on && lp.end - lp.start >= 1 && b >= lp.start - 1e-6 && b < lp.end + 1e-6) return [lp.start, lp.end];
    const a = along.anchor ?? Math.floor(Math.max(0, b) / bpb + 1e-9) * bpb, k = Math.max(0, Math.floor((b - a) / page));
    return [a + k * page, a + (k + 1) * page];
  }
  // kind: 'drums' (the pads' four rows) or 'pitch' (a roll); extra.trace: the hum's pitch, drawn up to the cursor
  function drawRuler(c, kind, now, extra = {}) {
    c.fit();
    const g = c.g, w = c.w, H = c.h, cs = colorsOf();
    g.clearRect(0, 0, w, H);
    const bpb = bpbNow(), q = gridQ(), spb = spbNow(), drums = kind === 'drums';
    const [a, b] = rulerWindow(), span = Math.max(1e-6, b - a);
    const { marks, pass } = marksNow();
    const cur = eng.beat || 0;
    const shown = marks.filter((m) => (drums ? m.kind === 'drums' : m.kind === 'pitch') && m.t >= a - 1e-6 && m.t < b - 1e-6);
    let lo = 0, hi = 0;
    const trace = (extra.trace || []).filter((f) => f.midi > 0 && f.conf > 0.3);
    if (!drums) {
      const ps = [...shown.map((m) => m.p), ...trace.map((f) => Math.round(f.midi))];
      lo = ps.length ? Math.min(...ps) - 2 : 55; hi = ps.length ? Math.max(...ps) + 2 : 72;
      if (hi - lo < 12) { const c0 = (hi + lo) / 2; lo = Math.floor(c0 - 6); hi = lo + 12; }
    }
    const rows = drums ? ROWS.length : hi - lo + 1;
    // (the pass line and the caption are lines of their own, under and over the canvas: nothing is drawn under them;
    // a short pane tucks the bar numbers in)
    const L = drums ? 64 : 34, Rr = w - 8, T = H >= 80 ? 20 : 14, B = H - 3, rh = (B - T) / rows;
    c.cv.closest('.sk-rollwrap')?.classList.add('follow');
    const X = (x) => L + ((x - a) / span) * (Rr - L);
    const rowY = (m) => (drums ? T + Math.max(0, ROWS.findIndex((r) => r.id === m.row)) * rh : B - (m.p - lo + 1) * rh);
    geom = { kind, from: a, to: b, L, R: Rr, T, B, rh, w, h: H, rows: drums ? ROWS.map((r) => r.id) : [lo, hi] };
    const steps = Math.round(span / q), cw = (Rr - L) / Math.max(1, steps), perBeat = Math.round(1 / q);
    if (drums) {
      ROWS.forEach((r, i) => {
        const y = T + i * rh;
        // one label a row, never taller than its row (a short pane: they shrink, then step aside, rather than stack)
        if (rh >= 8) { g.fillStyle = cs.text2; g.font = `600 ${Math.min(11, Math.floor(rh - 1))}px ${cs.ui}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(r.label, 4, y + rh / 2); }
        for (let s = 0; s < steps; s++) { g.fillStyle = s % perBeat === 0 ? withA(cs.text, 0.05) : withA(cs.text, 0.022); g.fillRect(L + s * cw + 1, y + 3, cw - 2, rh - 6); }
        g.fillStyle = cs.line; g.fillRect(0, Math.round(y + rh) - 0.5, Rr, 1);
      });
    } else {
      for (let m = lo; m <= hi; m++) {
        const y = B - (m - lo + 1) * rh, pc = ((m % 12) + 12) % 12;
        if ([1, 3, 6, 8, 10].includes(pc)) { g.fillStyle = withA('#000000', 0.12); g.fillRect(L, y, Rr - L, rh); }
        if (pc === 0) { g.fillStyle = cs.text3; g.font = `600 9px ${cs.mono}`; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(spellNote(m, store.get().key), L - 5, y + rh / 2); }
      }
    }
    // beats and bars, numbered with the song's bars; a beat line brightens for 120 ms as the cursor crosses it
    for (let bt = Math.ceil(a - 1e-9); bt <= b + 1e-9; bt++) {
      const x = Math.round(X(bt)) - 0.5, bar = Math.abs(((bt % bpb) + bpb) % bpb) < 1e-6;
      const ago = (cur - bt) * spb * 1000, lit = following() && ago >= 0 && ago < 120;
      g.fillStyle = lit ? cs.text2 : bar ? cs.line2 : withA(cs.line2, 0.5);
      g.fillRect(x, bar ? T - 12 : T, lit ? 2 : 1, B - T + (bar ? 12 : 0));
      if (bar && bt < b - 1e-6) {
        g.fillStyle = cs.text3; g.font = `italic 800 ${T >= 20 ? 13 : 11}px ${cs.disp}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        if ('fontStretch' in g) g.fontStretch = 'expanded';
        g.fillText(String(Math.round(bt / bpb) + 1), x + 5, T - 3);
        if ('fontStretch' in g) g.fontStretch = 'normal';
      }
    }
    // the region being written: record ink along the top and bottom, from where the take began to the cursor
    if (recLive && recLive.state === 'rec') {
      const x0 = X(Math.max(a, recLive.loop ? a : recLive.from)), x1 = X(Math.min(b, cur));
      if (x1 > x0) { g.fillStyle = cs.rec; g.fillRect(x0, T - 2, x1 - x0, 2); g.fillRect(x0, B, x1 - x0, 2); }
    }
    // what you played: the cell it snapped to (the track's colour, a warm outline: yours), and a tick where it fell
    for (const m of shown) {
      const y = rowY(m), fill = colorOf(m.track);
      g.globalAlpha = m.pass === pass ? 1 : 0.45;
      if (drums) {
        const x = X(m.t);
        g.fillStyle = fill; g.fillRect(x + 1.5, y + 3.5, Math.max(2, cw - 3), Math.max(2, rh - 7));
        g.strokeStyle = withA(cs.human, 0.75); g.lineWidth = 1; g.strokeRect(x + 2, y + 4, Math.max(1, cw - 4), Math.max(1, rh - 8));
      } else {
        const d = m.held ? Math.max(1 / 32, cur - m.raw) : m.d, x = X(m.t), ww = Math.max(3, X(Math.min(b, m.t + d)) - x - 1), hh = Math.max(3, rh - 2);
        rr(g, x, y + 1, ww, hh, 1.5); g.fillStyle = fill; g.fill();
        g.strokeStyle = m.held ? cs.text : cs.human; g.lineWidth = 1; rr(g, x + 0.5, y + 1.5, ww - 1, hh - 1, 1.5); g.stroke();
      }
      if (m.raw >= a - 1e-6 && m.raw <= b + 1e-6) {
        const x = Math.round(X(m.raw)), y0 = drums ? y + 1 : y - 2, hh = drums ? rh - 2 : rh + 4;
        g.fillStyle = cs.bg; g.fillRect(x - 2, y0, 4, hh);
        g.fillStyle = cs.text; g.fillRect(x - 1, y0, 2, hh);
      }
      g.globalAlpha = 1;
    }
    // the notes as they are being sung (not in yet): the track's colour, faint, a dashed warm edge
    if (!drums) {
      for (const m of extra.sung || []) {
        if (m.t < a - 1e-6 || m.t >= b - 1e-6 || m.p < lo || m.p > hi) continue;
        const x = X(m.t), ww = Math.max(3, X(Math.min(b, m.t + m.d)) - x - 1), y = B - (m.p - lo + 1) * rh, hh = Math.max(3, rh - 2);
        g.globalAlpha = m.low ? 0.25 : 0.45; rr(g, x, y + 1, ww, hh, 1.5); g.fillStyle = colorOf(recLive?.track || null); g.fill(); g.globalAlpha = 1;
        g.setLineDash([3, 2]); g.strokeStyle = cs.human; g.lineWidth = 1; rr(g, x + 0.5, y + 1.5, ww - 1, hh - 1, 1.5); g.stroke(); g.setLineDash([]);
      }
    }
    // the hum, as sung, up to the cursor
    if (trace.length && !drums) {
      const tl = trace[trace.length - 1].t;
      g.strokeStyle = cs.text2; g.lineWidth = 1.5; g.lineJoin = 'round'; g.beginPath();
      let pen = false, prev = null;
      for (const f of trace) {
        const x = X(cur - (tl - f.t) / spb), y = B - (f.midi - lo + 0.5) * rh;
        if (x < L || (prev != null && f.t - prev > 0.12)) pen = false;
        prev = f.t;
        if (x < L) continue;
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    // the cursor: the playhead's leader green
    if (cur >= a - 1e-6 && cur <= b + 1e-6) { g.fillStyle = cs.accent; g.fillRect(Math.round(X(cur)) - 0.75, T - 12, 1.5, B - T + 12); }
    // the count-in over the ruler, counting up with the beat (1 2 3 4, then you're on); Tap it and Hum it count in their
    // band, so not here as well (one count in view, not two)
    const cnt = recLive && recLive.counting;
    if (cnt && cnt.beats > 1e-3 && cnt.beats <= bpb + 1e-6 && mode !== 'tap' && mode !== 'hum') {   // (the count's last bar only)
      const left = cnt.beats, n = Math.max(1, Math.ceil(left - 1e-6)), nb = Math.ceil(bpb - 1e-9), num = nb - ((n - 1) % nb);
      g.globalAlpha = reduced() ? 0.7 : 0.7 * Math.max(0.2, Math.min(1, left - (n - 1)));
      g.fillStyle = cs.text; g.font = `italic 800 ${Math.max(20, Math.min(46, Math.round((B - T) * 0.9)))}px ${cs.disp}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      if ('fontStretch' in g) g.fontStretch = 'expanded';
      g.fillText(String(num), (L + Rr) / 2, (T + B) / 2);
      if ('fontStretch' in g) g.fontStretch = 'normal';
      g.globalAlpha = 1;
    }
    if (!shown.length && !trace.length && !cnt) {
      g.fillStyle = cs.text3; g.font = `13px ${cs.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(rec.state === 'rec' ? 'Recording. What you play lands here on its beat.' : drums ? 'Tap along: each tap lands here on its beat.' : extra.hum ? 'Hum along: each note lands here on its beat.' : 'Play along: each note lands here on its beat.', (L + Rr) / 2, (T + B) / 2);
    }
  }

  /* ---------------------------------------------------------------- the record strip (the stage's footer, every mode) */
  const kindNow = () => (mode === 'tap' ? 'pads' : mode === 'rec' ? 'audio' : mode === 'hum' ? 'hum' : 'keys');
  function stripTracks(kind) {
    const ts = store.get().tracks;
    if (kind === 'audio') return ts.filter((t) => t.kind === 'audio');
    if (kind === 'pads') return ts.filter((t) => isDrumT(t));
    // (keys and MIDI play a drum track too when it's the one selected, so it's listed then; a hum is pitched)
    const sel = kind === 'keys' ? ui.state?.selection?.track : null;
    return ts.filter((t) => t.kind === 'instrument' && (!isDrumT(t) || t.id === sel));
  }
  // Where the next take of a kind goes (input/recorder.js aim: the track, or null for a new track). Onto, the keep
  // select's default, a phone's Keep and the record line all read it.
  const viewNow = () => ui.workspace?.view?.() || 'full';
  function aimOf(kind) {
    if (kind === 'audio') return rec.targetFor('audio') || input.audio.recordTrack?.() || null;
    const a = typeof rec.aim === 'function' ? rec.aim(kind) : null;
    if (a) return a.track ? store.track(a.track) || null : null;
    return rec.targetFor(kind);
  }
  const stripTarget = () => aimOf(kindNow());
  // a take onto this track would stack over an earlier one (its bars overlap a take there): Onto says "a new take"
  function stacks(t, kind) {
    if (!t) return false;
    if (typeof rec.stacks === 'function') { try { return !!rec.stacks(kind, t.id); } catch (e) { /* the guess below */ } }
    if (rec.modeFor(t) !== 'take') return false;
    const p = store.get(), bpb = bpbNow(), lp = p.loop;
    const a = lp && lp.on ? lp.start : Math.floor((app.transport?.marker?.beat ?? eng.beat ?? 0) / bpb + 1e-9) * bpb, b = lp && lp.on ? lp.end : a + bpb;
    return t.clips.some((c) => !c.mute && c.start < b - 1e-6 && c.start + c.length > a + 1e-6);
  }
  const recBtn = h('button.btn.sk-recbtn', { type: 'button', 'aria-pressed': 'false', onclick: () => recPress() }, h('span.sk-dot'), h('span.sk-recbtn-l', 'Record'), touch ? null : h('kbd', 'R'));
  const tgtSel = h('select.sk-select.sk-target', { 'aria-label': 'Record onto', onchange: () => pickTarget(tgtSel.value) });
  const passWrap = h('span.sk-each');
  const countB = h('button.sk-chip.sk-countin', { type: 'button', title: 'Count-in: clicks before the take, with the song’s previous bar under them. Click for 1 bar, 2 bars or none.', onclick: () => {
    const c = rec.countIn, n = c === 1 ? 2 : c === 2 ? 0 : 1;
    try { input.audio.setCountIn(n > 0); } catch (e) { /* ok */ }
    rec.setCountIn(n); paintStrip(true);
  } });
  const clickB = h('button.sk-chip.sk-click', { type: 'button', title: touch ? 'The click: a metronome to play along to' : 'The click: a metronome to play along to (K)', onclick: () => { eng.metronome = !eng.metronome; ui.emit('transport-ui'); paintStrip(true); } }, 'Click');
  const recNote = h('span.sk-recnote', { role: 'status', 'aria-live': 'polite' });
  // how a take records (Each pass, the count-in, the click): in the strip on a computer; on a touch screen a row of its
  // own under the canvas, so the pinned strip stays one row and these are still a tap away
  // (the simple view puts these away as Recording options, data-feature="record-options"; Onto beside Record stays)
  const recOpts = h('div.sk-recopts', { role: 'group', 'aria-label': 'How a take records', dataset: { feature: 'record-options' } }, h('span.sk-field.sk-each-f', h('small', 'Each pass'), passWrap), countB, clickB);
  // Onto: where R records, always shown (the simple view too): "A new track" first, then the tracks that fit
  strip.append(recBtn, h('label.sk-field.sk-onto', h('small', 'Onto'), tgtSel), ...(touch ? [] : [recOpts]), recNote);
  // The line saying what a take records onto ("Recording onto Drums, pass 1."): the strip's last word on a computer; on
  // a phone, above the pads (or the dial), so the pinned row stays one row (it wrapped to two and covered the pads'
  // bottom: a low tap on Kick hit Beatbox). Play it's strip is in the sheet already, over the keys: it stays there.
  function placeNote() {
    if (!noteReady) return;
    if (isSplit() && mode !== 'play') { if (body.firstChild !== recNote) body.prepend(recNote); }
    else if (recNote.parentNode !== strip) strip.append(recNote);
  }
  noteReady = true;
  // Record: the take into the song, from the marker (in Record, the mic onto the audio track); Stop keeps it
  function recPress() {
    const st = rec.state;
    if (st === 'count') return rec.cancel();
    if (st === 'rec') return rec.stop();
    if (mode === 'rec') return input.audio.record({ countIn: rec.countIn });
    return rec.record();
  }
  // Picking in Onto sets the aim for this kind of take (recorder.setAim). In the full studio the lit R agrees with it: a
  // track picked is selected and armed (an arm on another gives way), "A new track" disarms every track; the arming goes
  // first, so the recorder's "armed by hand clears the choice" doesn't undo the pick. In the simple view a pick only aims.
  function pickTarget(v) {
    const k = kindNow(), full = viewNow() !== 'simple' || typeof rec.setAim !== 'function';
    if (k === 'audio' || (v && v !== 'new')) {
      const t = store.track(v);
      if (!t) return;
      if (full || k === 'audio') {
        ui.select({ track: v, clip: null, notes: [] });
        if (stripTarget()?.id !== v || !t.arm) {
          const others = store.get().tracks.filter((x) => x.arm && x.id !== v && (k === 'audio' ? x.kind === 'audio' : x.kind === 'instrument'));
          store.dispatch([...others.map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } })), ...(t.arm ? [] : [{ type: 'track.set', track: v, patch: { arm: true } }])], { by: 'you', label: `arm ${t.name}` });
        }
      }
      if (k !== 'audio') rec.setAim?.(k, v);
    } else {
      const armed = store.get().tracks.filter((x) => x.arm && x.kind === 'instrument');
      if (viewNow() !== 'simple' && armed.length) store.dispatch(armed.map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } })), { by: 'you', label: 'record onto a new track' });
      rec.setAim?.(k, 'new');
    }
    paintStrip(true);
  }
  /* ---------------------------------------------------------------- the sound card's place (ui/sounds.js) */
  // ui/sounds.js alone decides when "What should this sound like?" opens; Sketch says where it goes (app.sounds.setHost):
  // beside the take's canvas on a computer (two columns, the card under the canvas in a narrow stage), under the take's
  // row on a phone. Sketch tells it when a take lands (offer), and its take line has Sounds, the door in both views.
  const cardHost = h('div.sk-cardhost');
  function placeHost() {
    cardHost.hidden = mode === 'rec';
    const into = (isSplit() && body.querySelector('.sk-take')) || body;
    if (cardHost.parentNode !== into || into.lastElementChild !== cardHost) into.append(cardHost);
  }
  let hostSet = null;   // (the app.sounds Sketch registered with: a new one, say a stand-in, is registered with too)
  // (only the phone's split sheet hosts it: on a computer Sketch's stage is a strip a few hundred pixels tall, where the
  // card's rows fell under the window's edge, so there it floats by the track's header, ui/sounds.js place())
  const hostFn = () => { if (!el.isConnected || mode === 'rec' || !isSplit() || (ui.visible && !ui.visible('sketch'))) return null; placeHost(); return cardHost; };
  function registerHost() { if (hostSet === app.sounds || typeof app.sounds?.setHost !== 'function') return; hostSet = app.sounds; try { app.sounds.setHost(hostFn); } catch (e) { console.error(e); } }
  // what the card is told about a take not yet kept (or just kept): where its Keep would put it, and whether that track
  // is empty (the card is offered on a track's first take)
  function takeInfo(id, kind, dest, extra = {}) {
    const ph = input.capture.get(id), track = isNewDest(dest) ? null : dest;
    return { capture: id, kind, src: ph?.src || null, notes: (ph?.notes || []).length, onto: track || 'new', first: !track || !(store.track(track)?.clips || []).length, ...extra };
  }
  const offered = new Set();   // (each take is offered once: a re-snap of the same hum isn't a new take)
  function offerTake(id, kind, dest) {
    if (!id || offered.has(id) || typeof app.sounds?.offer !== 'function') return;
    const ph = input.capture.get(id);
    if (!ph || ph.rec || !ofSong(ph) || !(ph.notes || []).length || keptOn(ph)) return;
    offered.add(id);
    try { app.sounds.offer({ track: isNewDest(dest) ? null : dest, from: 'take', take: takeInfo(id, kind, dest) }); } catch (e) { console.error(e); }
  }
  // the take line's Sounds (.btn-txt): opens the card for the take before it is kept
  function soundsBtn(getId, kind, getDest) {
    const b = h('button.btn.btn-txt.sk-sounds', { type: 'button', hidden: true, title: 'Hear this take on other instruments before you keep it', onclick: () => {
      const id = getId(), v = getDest();
      if (!id || typeof app.sounds?.offer !== 'function') return;
      offered.add(id);
      app.sounds.offer({ track: isNewDest(v) ? null : v, from: 'take', anchor: b, asked: true, take: takeInfo(id, kind, v) });
    } }, 'Sounds');
    return b;
  }
  // A phone, while a sound is on trial: the pinned row is Keep (the name is in the card's status line), Back and the
  // record lamp. Keep on a take not yet kept keeps the take with the sound; on a track, keeps the sound.
  const trialKeep = h('button.btn.btn-go.sk-tkeep', { type: 'button', onclick: () => keepTrial() }, 'Keep');
  const trialBack = h('button.btn.btn-txt.sk-tback', { type: 'button', onclick: () => { try { app.sounds?.back?.(); } catch (e) { console.error(e); } } }, 'Back');
  const trialRow = h('div.sk-trialrow', { role: 'group', 'aria-label': 'The sound being tried' }, trialKeep, trialBack);
  function keepTrial() {
    const tr = app.sounds?.trying?.();
    if (!tr) return;
    if (tr.newTrack) { const id = view?.takeId?.(); if (id) { keepTo(id, 'new'); view?.kept?.(); return; } }
    try { app.sounds.keep?.(); } catch (e) { console.error(e); }
  }
  const nameOf = (x) => (!x ? '' : typeof x === 'string' ? app.devices?.getDevice?.(x)?.name || x : x.name || app.devices?.getDevice?.(x.device)?.name || x.device || '');
  let trialSig = null;
  function syncTrial() {
    const tr = app.sounds?.trying?.() || null, sig = tr ? `${tr.track}|${tr.device}|${tr.preset || ''}|${tr.newTrack ? 1 : 0}` : '';
    // (in the page only on the phone's split layout, where it is pinned: elsewhere the card's own Keep is the primary)
    if (tr && isSplit()) { if (trialRow.parentNode !== foot) foot.prepend(trialRow); }
    else if (trialRow.parentNode) trialRow.remove();
    if (sig === trialSig) return;
    trialSig = sig;
    root.classList.toggle('sk-trying', !!tr);
    if (!tr) return;
    const name = `${nameOf(tr.device)}${tr.preset ? `, ${tr.preset}` : ''}`, was = nameOf(tr.was);
    trialKeep.title = `Keep ${name}`; trialKeep.setAttribute('aria-label', `Keep ${name}`);
    trialBack.title = was ? `Back to ${was}` : 'Back'; trialBack.setAttribute('aria-label', trialBack.title);
  }
  // In tune: a hum on a song whose key nobody chose, not yet kept, moved into the key heard in it. The card's In tune
  // lamp and the Snap chip are one state (app.sketch.inTune / setInTune; 'sketch:intune' says it changed).
  function inTuneNow() {
    const tk = input.hum.take;
    if (!tk || !tk.result || !tk.capture || !tk.opts || tk.opts.key || !tk.opts.heard) return null;
    if (keptOn(input.capture.get(tk.capture))) return null;
    return !!(tk.opts.snapHeard && input.options.snapKey !== false);
  }
  function setInTune(on) {
    const tk = input.hum.take;
    if (inTuneNow() == null) return false;
    input.options.snapKey = true;
    input.hum.retranscribe({ snapHeard: !!on, snapKey: true });
    ui.emit('sketch:intune', { on: !!on, capture: tk.capture });
    return true;
  }
  // a line of Sketch's own for the next hum (Hum over it: "The beat runs 8 bars now…"), until the hum starts
  let said = null;
  const say = (text) => { said = text || null; view?.said?.(); };
  // Hum over it (Tap it's take line; the coach's card has the same): ui/onboard.js humOver gives the tune room (8 bars, the
  // click off while you hum) and puts Sketch on Hum it; without it, Hum it
  const humOver = () => (typeof app.onboard?.humOver === 'function' ? app.onboard.humOver() : setMode('hum'));

  let stripKey = '';
  function paintStrip(force = false) {
    const st = rec.state, k = kindNow(), t = stripTarget(), list = stripTracks(k);
    const m = k === 'audio' ? 'take' : t ? rec.modeFor(t) : k === 'pads' ? 'layer' : 'take';
    const L = st !== 'idle' ? recLive : null;
    const stk = k !== 'audio' && stacks(t, k);
    const key = [st, k, t ? t.id : '', list.map((x) => x.id + ':' + x.name).join(','), m, rec.countIn, !!eng.metronome, input.mode, L ? L.pass : -1, rec.tracks.join(), stk].join('|');
    if (!force && key === stripKey) return;
    stripKey = key;
    view?.retarget?.();   // (a phone's Keep says the track this picker shows)
    recBtn.classList.toggle('on', st === 'rec'); recBtn.classList.toggle('counting', st === 'count');
    recBtn.setAttribute('aria-pressed', String(st !== 'idle'));
    recBtn.querySelector('.sk-recbtn-l').textContent = st === 'rec' ? 'Stop' : st === 'count' ? 'Cancel' : 'Record';
    recBtn.title = st === 'rec' ? (touch ? 'Stop and keep the take' : 'Stop and keep the take (Space)') : st === 'count' ? 'Cancel the count-in: nothing is recorded' : touch ? 'Record into the song from the marker' : 'Record into the song from the marker (R). Space stops and keeps it.';
    // ("A new track" first; the aimed track reads "Melody, a new take" when its take would stack over an earlier one)
    const shown = t && k !== 'audio' && !list.some((x) => x.id === t.id) ? [...list, t] : list;
    const opt = (x) => h('option', { value: x.id }, x.id === t?.id && stk ? `${x.name}, a new take` : x.name);
    if (k === 'audio') tgtSel.replaceChildren(...shown.map(opt), ...(t ? [] : [h('option', { value: '' }, 'A new track')]));
    else tgtSel.replaceChildren(h('option', { value: 'new' }, 'A new track'), ...shown.map(opt));
    tgtSel.value = t ? t.id : k === 'audio' ? '' : 'new';
    tgtSel.title = t ? `R records onto ${t.name}${stk ? ', a new take over the one there' : ''}` : 'R records onto a new track';
    tgtSel.disabled = st !== 'idle';
    const sg = seg([['layer', 'Layer'], ['take', 'New take']], m, (v) => { const tt = stripTarget(); if (tt && kindNow() !== 'audio') rec.setMode(tt, v); paintStrip(true); }, 'Each pass');
    sg.firstChild.title = 'Layer: each time the loop comes round, what you play is added to what’s there';
    sg.lastChild.title = 'New take: each time round is a take of its own, stacked; keep the one you like';
    if (k === 'audio') { sg.firstChild.disabled = true; sg.firstChild.title = 'An audio take always stacks as a new take'; }
    for (const b of sg.children) b.disabled = b.disabled || st !== 'idle';
    passWrap.replaceChildren(sg);
    const ci = rec.countIn;
    countB.textContent = `Count-in: ${ci ? `${ci} bar${ci === 1 ? '' : 's'}` : 'none'}`;
    countB.classList.toggle('on', ci > 0); countB.setAttribute('aria-pressed', String(ci > 0));
    clickB.classList.toggle('on', !!eng.metronome); clickB.setAttribute('aria-pressed', String(!!eng.metronome));
    const names = rec.tracks.map((id) => store.track(id)?.name).filter(Boolean).join(' and ') || t?.name || 'a new track';
    recNote.classList.toggle('rec', st === 'rec');
    // (a sound on trial on that track was kept first: "Recording keeps Light Table on Melody.", INSTRUMENTS-UX 1.3)
    const keeps = st !== 'idle' ? (((L && L.keeps) || rec.live()?.keeps) ? ` ${(L && L.keeps) || rec.live().keeps}` : '') : '';
    recNote.textContent = st === 'rec' ? `Recording onto ${names}${L && L.loop ? `, pass ${L.pass + 1}` : ''}.${keeps}`
      : st === 'count' ? `Counting in.${keeps}`
      : '';
  }
  listen(ui.on('select', () => paintStrip(true)));
  listen(rec.on('aim', () => paintStrip(true)));
  listen(ui.on('transport-ui', () => paintStrip(true)));
  listen(input.on('mode', () => paintStrip(true)));

  /* ---------------------------------------------------------------- the beat band: the click you can see */
  // Tap it and Hum it (the capture diagnosis, 2026-10-05: the only beat in view was four 18 x 12 px squares at the
  // foot of the window, and the card pointed at a top bar the simple view puts away). Over the canvas (over the pads on
  // a touch screen), where the eyes are: a lamp a beat, bar 1 wider, lit on the beat you hear (red-edged while it
  // records); the count-in's last bar counting down in big numerals; one line of what is happening (the tempo, the
  // loop's bars, the time round, what Space does); the click as a lamp (on for a take from here unless you turn it
  // off: then, over a song with nothing in it, a take is in your own time and the tempo comes from you); and after a
  // take, its timing: Tight (where the forgiving grid put each hit), Loose, As played.
  let lastCommit = null;
  listen(rec.on('commit', (res) => {
    lastCommit = res;
    // (a lean the stop took out: the line under the canvas says it for the whole take, the pass lines having been
    // measured as it went)
    if (res && res.ok && !res.empty && res.lean && res.lean.beats) {
      const ms = Math.abs(Math.round(res.lean.ms / 10) * 10);
      readout = { pass: 0, take: res.take, lean: res.lean.ms, text: `About ${ms} ms ${res.lean.ms > 0 ? 'behind' : 'ahead of'} the click; on the beat now` };
      readouts.push(readout); if (readouts.length > 16) readouts.shift();
      paintReadout();
    }
    for (const b of bands) b.paint(true);
  }));
  const bands = new Set();
  function toggleClick() {
    const on = !rec.captureClick;
    rec.setCaptureClick(on);
    // (on while the song plays: heard now, not only at the next take)
    if (on && (eng.playing || rec.state !== 'idle') && !eng.metronome) app.transport?.click?.set?.({ on: true });
    ui.emit('transport-ui');
    paintStrip(true);
    for (const b of bands) b.paint(true);
    ui.announce?.(on ? 'Click on.' : rec.wouldBeFree() ? 'Click off: play in your own time, and the tempo comes from you.' : 'Click off.');
  }
  function beatBand() {
    const lamps = h('div.sk-beats', { 'aria-hidden': 'true', title: 'The beat: the lamp the song is on' });
    const num = h('span.sk-counting', { 'aria-hidden': 'true' });
    const where = h('span.sk-where', { role: 'status', 'aria-live': 'polite' });
    const clickT = h('button.tog.sk-bclick', { type: 'button', onclick: () => toggleClick(), title: 'The click for a take from here. Off, over a song with nothing in it yet: play in your own time, and the tempo comes from you.' }, 'Click');
    const timing = h('span.sk-timing', { role: 'group', 'aria-label': 'Timing of the last take' });
    const el = h('div.sk-band', lamps, num, where, timing, clickT);
    let lampSig = '', whereText = '', timingSig = '';
    // (short: it is one line of the head; the whole of it is its title)
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    function words() {
      const st = rec.state, p = store.get(), bpb = bpbNow(), tempo = Math.round(+p.tempo || 120), L = recLive;
      const keep = touch ? 'Stop keeps it.' : 'Space keeps it.';
      if (st === 'rec' && rec.free) return `Your own time, no click. ${touch ? 'Stop' : 'Space'} when you’re done.`;
      // (the numerals count the bar in with the lamps, 1 to 4: you come in on the 1 after the 4. R while the loop plays
      // waits out the rest of a bar, or for the loop's top, first: those beats are counted too, dimmer)
      if (st === 'count') return L?.counting && L.counting.beats > bpb + 1e-6 ? (L.loop && Math.abs(L.from - L.loop.start) < 1e-6 ? 'Waiting for the loop’s top, then a bar counts you in.' : 'Waiting for the bar line, then a bar counts you in.') : `Count-in: come in right after the ${Math.ceil(bpb - 1e-9)}.`;
      if (st === 'rec' && L) {
        if (L.loop) return `${cap(barsOf(bpb, L.loop.start, L.loop.end))}, time ${(L.pass || 0) + 1} round. ${keep}`;
        return `Recording from ${barsOf(bpb, L.from, L.from + 1e-6)}. ${keep}`;
      }
      const lp = p.loop, b = eng.beat || 0;
      if (eng.playing) return lp?.on && b >= lp.start - 1e-6 && b < lp.end ? `${cap(barsOf(bpb, lp.start, lp.end))} round and round, ${tempo} BPM.` : `${tempo} BPM.`;
      if (lastCommit && lastCommit.ok && !lastCommit.empty && lastCommit.free && lastCommit.bpm) return lastCommit.tempo ? `${tempo} BPM, the tempo you played.` : `You played at ${Math.round(lastCommit.bpm)} BPM; the song is at ${tempo}.`;
      if (rec.wouldBeFree()) return 'No click: your own time, your tempo.';
      const how = mode === 'hum' ? 'Hum' : touch ? 'Record' : 'R';
      return `${tempo} BPM. ${how} counts in a bar${lp?.on ? `, then ${barsOf(bpb, lp.start, lp.end)} round and round` : ''}.`;
    }
    function paint(force = false) {
      const bpb = bpbNow(), st = rec.state, L = recLive;
      if (lamps.children.length !== Math.ceil(bpb - 1e-9)) { lamps.replaceChildren(...Array.from({ length: Math.ceil(bpb - 1e-9) }, (_, i) => h('i' + (i === 0 ? '.one' : ''), String(i + 1)))); lampSig = ''; }
      const on = !!eng.playing && (following() || st === 'count');
      const cur = on ? ((Math.floor((eng.beat || 0) + 1e-6) % Math.ceil(bpb - 1e-9)) + Math.ceil(bpb - 1e-9)) % Math.ceil(bpb - 1e-9) : -1;
      // the count, in numerals, counting up with the lamps: 1 2 3 4, then you're on. The count-in's own bar is bright;
      // what R while the loop plays waits out before it (the rest of a bar, or to the loop's top) is counted dimmer
      let n = '', wait = false;
      if (st === 'count' && L?.counting) {
        const left = L.counting.beats, nb = Math.ceil(bpb - 1e-9);
        if (left > 1e-3) { n = String(nb - ((Math.max(1, Math.ceil(left - 1e-6)) - 1) % nb)); wait = left > bpb + 1e-6; }
      }
      const sig = `${cur}:${st}:${n}:${wait}`;
      if (sig !== lampSig || force) {
        lampSig = sig;
        [...lamps.children].forEach((c, i) => c.classList.toggle('now', i === cur));
        lamps.classList.toggle('rec', st === 'rec' && !rec.free);
        lamps.classList.toggle('count', st === 'count');
        lamps.dataset.beat = String(cur);
        num.textContent = n;
        num.classList.toggle('wait', wait);
      }
      const w = words();
      if (w !== whereText || force) { whereText = w; where.textContent = w; where.title = w; el.title = w; }
      const cc = rec.captureClick;
      if (clickT.getAttribute('aria-pressed') !== String(cc)) { clickT.setAttribute('aria-pressed', String(cc)); clickT.classList.toggle('on', cc); }
      // (the take this way in made: a beat's in Tap it, a hum's in Hum it)
      const tm0 = st === 'idle' ? rec.timing : null, tm = tm0 && tm0.kind === (mode === 'hum' ? 'hum' : 'pads') ? tm0 : null, tsig = tm ? `${tm.level}:${tm.notes}` : '';
      if (tsig !== timingSig || force) {
        timingSig = tsig;
        if (!tm) timing.replaceChildren();
        else {
          const sg = seg([['tight', 'Tight'], ['loose', 'Loose'], ['played', 'As played']], tm.level, (lv) => {
            const d = rec.retime(lv);
            if (d && d.ok) ui.announce?.(lv === 'played' ? `As played: ${tm.notes} back where you played them.` : lv === 'loose' ? 'Loose: half way back to how you played it.' : 'Tight: on the grid.');
            else if (d && d.error) ui.toast(d.error, { kind: 'bad' });
            paint(true);
          }, 'Timing of the last take');
          sg.firstChild.title = 'Tight: each hit or note where the forgiving grid put it';
          sg.children[1].title = 'Loose: half way back to how you played it';
          sg.lastChild.title = 'As played: exactly where you played it';
          timing.replaceChildren(sg);
          timing.title = 'The last take’s timing: Tight, Loose or As played';
        }
        // (after a take its timing has the line's place: the line says the tempo, which the top bar says too)
        where.hidden = !!tm;
      }
    }
    const band = { el, paint, destroy: () => bands.delete(band) };
    bands.add(band);
    return band;
  }

  const sketchApi = app.sketch = {
    // what the ruler shows: its bars, the cursor, every mark (raw and snapped beats, its pass), the last pass's line
    ruler() {
      const [a, b] = rulerWindow(), { marks, pass } = marksNow();
      return { following: following(), from: a, to: b, cursor: eng.beat, pass, marks: marks.map((m) => ({ pass: m.pass, kind: m.kind, row: m.row, p: m.p, t: m.t, raw: m.raw, track: m.track })), readout, readouts: readouts.slice() };
    },
    geom: () => geom,
    // the card's In tune lamp (ui/sounds.js): null when it doesn't apply (no hum waiting, or the song has a key)
    inTune: () => inTuneNow(),
    setInTune: (on) => setInTune(on),
    // a line for the next hum (ui/onboard.js: Hum over it)
    say: (text) => say(text),
    host: () => cardHost,
    // the card on a take not kept yet (ui/sounds.js): the take plays on the track its Keep would make (previewed), by
    // hear(); hearing() is whether one is playing
    hearTake(id) {
      const ph = id ? input.capture.get(id) : null;
      if (!ph || ph.kind === 'audio') return false;
      const notes = input.capture.phraseNotes(id).notes;
      if (!notes.length) return false;
      hear(notes, null, { drums: ph.kind === 'drums', id });
      return !!preview.track;
    },
    hearing: () => !!preview.track,
    // the floating card's Keep on a take not kept yet: the take onto a new track, with the sound on trial (keepTo)
    keepTake() { const id = view?.takeId?.(); if (!id) return false; keepTo(id, 'new'); view?.kept?.(); return true; },
    stopHearing: () => stopHear(),
    // the beat band is on screen (Tap it or Hum it, Sketch showing): its numerals are the count-in, so the arranger's
    // lane doesn't draw a second one (ui/arranger.js)
    bandShown: () => (mode === 'tap' || mode === 'hum') && (!ui.visible || !!ui.visible('sketch')),
  };

  /* ---------------------------------------------------------------- modes */
  function setMode(m, { keep = true } = {}) {
    if (view) { try { view.destroy && view.destroy(); } catch (e) { console.error(e); } }
    // leaving Play it: musical typing goes off with it (left on, it ate the studio's single keys: L played a note)
    if (mode === 'play' && m !== 'play' && input.qwerty?.on) input.qwerty.toggle(false);
    // (the line after a pass belongs to the mode it was played in)
    if (m !== mode && rec.state === 'idle') { readout = null; paintReadout(); }
    mode = m;
    input.sketchMode = m;   // (in Hum it, R records the mic into the song: input/recorder.js)
    root.dataset.mode = m;
    if (keep) { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* ok */ } }
    for (const b of rail.children) { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.firstChild.classList.toggle('sk-title', on); }
    const def = MODES.find((x) => x.id === m);
    const blurb = (touch && TOUCH_BLURB[m]) || def.blurb;
    const blurbEl = h('p.sk-blurb', { title: blurb }, blurb);
    head.replaceChildren(blurbEl);
    body.replaceChildren(); foot.replaceChildren();
    body.dataset.mode = m;
    view = (m === 'hum' ? humView : m === 'tap' ? tapView : m === 'play' ? playView : recView)();
    // (Tap it and Hum it: the beat band is the head's line, the blurb's place)
    if (view.band) { blurbEl.replaceWith(view.band); view.band.title = blurb; }
    if (view.opts) head.append(view.opts);
    if (m !== 'tap' && input.mode === 'tap') input.setMode(null);
    // on a touch screen, Play it's strip sits right above the keys (it was under them, below the fold of a phone)
    if (touch && m === 'play') body.prepend(strip); else foot.append(strip);
    settle();
    placeHost();
    paintStrip(true);
    paintJam();
    requestAnimationFrame(revealStage);
  }
  // The Jam room open (the center region's other tab, ui/jam.js): it has its own Record (R in the room) and its own
  // input, the guitar, so there is one Record: Sketch's Hum it and Record ways in step back, and so does its record
  // strip, with a line saying where recording is. Play it (the keys: on a phone the way to play the neck) and Tap it
  // stay. A way in the room took away comes back with Arrange.
  const inJam = () => ui.active?.('center') === 'jam';
  const jamNote = h('p.sk-jamnote', { role: 'note' }, 'The Jam room records what you play onto the Guitar track: its own Record, or R there.');
  let jamWas = null;   // the way in Sketch had when the room took it away
  function syncJam() {
    const on = inJam();
    if (root.classList.contains('sk-jam') !== on) {
      root.classList.toggle('sk-jam', on);
      for (const b of rail.children) if (b.dataset.mode === 'hum' || b.dataset.mode === 'rec') b.hidden = on;
      if (on && (mode === 'hum' || mode === 'rec') && !input.hum.active && rec.state === 'idle') { jamWas = mode; setMode('play', { keep: false }); }
      else if (!on && jamWas) { const m = jamWas; jamWas = null; if (mode === 'play') setMode(m, { keep: false }); }
    }
    paintJam();
  }
  function paintJam() {
    if (root.classList.contains('sk-jam')) { if (jamNote.parentNode !== head) head.append(jamNote); }
    else jamNote.remove();
  }
  listen(ui.on('show', ({ region }) => { if (region === 'center') syncJam(); }));
  // what goes under the mode's own rows: on a touch screen, how a take records (Each pass, the count-in, the click),
  // under the canvas, a scroll away, so they never push the pads or the keys under the pinned row; and the record line
  function settle() {
    if (!noteReady) return;   // (the strip isn't built yet: the first placeFoot, at mount)
    if (touch) body.append(recOpts);
    placeNote();
  }
  listen(input.on('sketch:mode', (m) => { if (m !== mode) setMode(m); }));
  // musical typing turned on while Sketch is showing: Play it comes forward and the key strip docks in it
  listen(input.on('qwerty', (q) => { if (q.on && mode !== 'play' && !input.hum.active && el.isConnected && (!ui.visible || ui.visible('sketch'))) setMode('play'); }));

  /* ======================================================== HUM */
  // The mic's explainer sits over the roll, which a laptop's dock can make ~100 px tall: when it doesn't fit, the small
  // print goes and the type tightens; still too tall (a narrow roll), only "Hum something." stays over the button. What
  // goes is the button's title, so it is still there to read. Its primary button is never left under the record strip.
  function fitExplain(ex) {
    const btn = ex.querySelector('.btn'), more = [...ex.querySelectorAll('.sk-more, .sk-small')];
    if (btn) btn.title = more.map((x) => x.textContent.trim()).join(' ').replace(/^Hum something\. /, '');
    let ro = null, seen = false;
    const fit = () => {
      if (!ex.isConnected) { if (seen) ro?.disconnect(); return; }   // (the explainer went: the mic is open, or another mode)
      seen = true;
      if (!ex.clientHeight) return;
      ex.classList.remove('tight', 'tighter');
      if (ex.scrollHeight > ex.clientHeight + 1) ex.classList.add('tight');
      if (ex.scrollHeight > ex.clientHeight + 1) ex.classList.add('tighter');
    };
    // (its words, not only its box: a font arriving after the first fit wrapped the sentence to three lines in the same
    // box, and the button went under the bottom edge)
    try { ro = new ResizeObserver(fit); ro.observe(ex); for (const c of ex.children) ro.observe(c); } catch (e) { /* no ResizeObserver: it scrolls */ }
    try { document.fonts?.ready?.then(fit); } catch (e) { /* no font loading API */ }
    requestAnimationFrame(fit);
  }
  function humView() {
    const hum = input.hum, opts = input.options;
    // the dial's key: the song's once somebody meant it (hum.songKey), else the one heard in the last hum, else none
    // (a blank song's default C minor isn't drawn as if it were chosen)
    const dialKey = () => hum.songKey() || hum.take?.opts?.heard || null;
    const sp = createSpiral({ lo: 40, hi: 88, key: dialKey() });
    const spWrap = h('div.sk-spiral', sp.el);
    const roll = canvas('sk-roll');
    const rollWrap = h('div.sk-rollwrap', h('div.sk-cv', roll.cv));
    // (Sketch's own line for the next hum, Hum over it's, heads the explainer while it covers the take's line)
    const saidEl = h('p.sk-said', { hidden: true });
    // (over a song with parts, R is the way the tour and the record button point to: the explainer says what each of
    // the two does, and its own button is the quieter one, so one way in leads)
    const over = !touch && store.get().tracks.some((t) => t.clips.length);
    const explain = h('div.sk-explain', saidEl,
      over ? h('p.sk-more', h('b', 'Press R and hum'), ': it counts you in and records over the song, onto a track of its own. Hum (H) sketches it loose instead, to keep or not. The sound stays on this device; an agent you’ve connected can read the notes.')
        : h('p.sk-more', h('b', 'Hum something.'), ' Nothing is recorded until you press the button. The sound stays on this device; an agent you’ve connected can read the notes.'),
      h('p.sk-short', h('b', 'Hum something.')),
      h(over ? 'button.btn' : 'button.btn.btn-go', { onclick: () => go() }, 'Allow the mic and hum'),
      h('p.sk-small', 'The browser asks once. Its voice processing stays off, so Overdub hears your pitch, not a phone call.'));
    let micOk = false; try { micOk = localStorage.getItem(MIC_OK) === '1'; } catch (e) { /* ok */ }
    let explaining = !micOk && !input.audio.state.open;
    const unexplain = () => { explaining = false; explain.remove(); };
    const status = h('div.sk-status.sk-cap', { role: 'status', 'aria-live': 'polite' });
    // Hum: a take into the song, as R in Hum it: a bar of count-in with the click (unless it's off), then sing; Stop (or
    // Space) and it is in, on its own track (a new Melody), at the bars it was sung. With the click off over a song with
    // nothing in it, no count: hum in your own time and the tempo comes from you
    const btn = h('button.btn.sk-big.sk-hum', { onclick: () => go(), title: touch ? 'Hum it into the song: a bar of count-in, then sing. Tap again to stop.' : 'Hum it into the song: a bar of count-in, then sing (R). Space stops and keeps it.' }, h('span.sk-dot'), h('span.sk-big-l', 'Hum'), touch ? null : h('kbd', 'R'));
    const band = beatBand();
    const dest = h('span.sk-destwrap');
    const keepBtn = h('button.btn.btn-go.ew-btn-primary', { onclick: () => { const tk = hum.take; if (tk && tk.capture) { keepTo(tk.capture, keepDest()); paintKept(); } }, title: 'Keep it as a clip (by you)' }, h('span.sk-wide', 'Keep as a clip'), h('span.sk-narrow', 'Keep'));
    const agentBtn = h('button.btn.ew-btn-agent', { onclick: () => hum.take && hum.take.capture && toAgent(hum.take.capture), title: 'Hand it to the agent' }, icon('agent', { size: 15 }), h('span.sk-wide', 'Hand it to the agent'), h('span.sk-narrow', 'Agent'));
    const hearBtn = h('button.btn.btn-txt.sk-ic', { onclick: () => { const r = hum.take?.result; if (r) hear(r.notes, destTrack()); }, title: 'Hear the notes it became' }, h('span.sk-wide', 'Hear the notes'), h('span.sk-narrow', 'Notes'));
    const hearMe = h('button.btn.btn-txt.sk-ic', { onclick: () => hum.take?.audio && hearAudio(hum.take.audio), title: 'Hear what you hummed (A/B)' }, h('span.sk-wide', 'Hear your hum'), h('span.sk-narrow', 'Your hum'));
    const hSounds = soundsBtn(() => hum.take?.capture, 'hum', () => keepDest());
    const acts = h('div.sk-acts', dest, keepBtn, agentBtn, hSounds, hearBtn, hearMe);
    const listen2 = h('div.sk-listen');
    // (a phone: what the take is and its Keep row sit under the dial, in the sheet, not in the pinned row)
    const takeRow = h('div.sk-take');
    foot.append(btn);
    // Where things go: a computer (or a tablet) has the explainer over the roll, the take's line as the roll's caption
    // and its Keep row in the footer. A phone keeps its pinned row to one row (Hum, Record and its track): the
    // explainer sits beside the dial, so "Allow the mic and hum" is in view with the ways in above it, and the take's
    // line and Keep row go under the dial. Keep there goes where Record's picker says: one picker, not two.
    // (a touch screen: the band over the roll, under the dial and the mic's explainer, so they stay where a first look
    // finds them; a computer: the head's line)
    const rollCol = touch ? h('div.sk-rollcol', band.el, rollWrap) : rollWrap;
    function place() {
      if (isSplit()) {
        takeRow.replaceChildren(status, acts);
        explain.classList.add('beside');
        body.replaceChildren(spWrap, ...(explaining ? [explain] : []), takeRow, ...(touch ? [band.el] : []), rollWrap);
        rollWrap.append(readEl);
      } else {
        explain.classList.remove('beside');
        if (touch) rollCol.replaceChildren(band.el, rollWrap);
        body.replaceChildren(spWrap, rollCol);
        if (explaining) rollWrap.prepend(explain);
        rollWrap.append(status, readEl);
        foot.insertBefore(acts, btn.nextSibling);
      }
      if (explaining) fitExplain(explain);
      paintKept();
      placeHost();
    }
    // the take's Keep goes where the row's picker says (a phone: Record's picker, the strip's; else the one beside Keep)
    const keepDest = () => (isSplit() ? stripDest('notes') : dest.firstChild?.value);
    const destTrack = () => { const v = keepDest(); return isNewDest(v) ? null : v; };

    // (Snap, the grid and My timing: Recording options, put away in the simple view; the take line still says what moved)
    const optsEl = h('div.sk-opts', { dataset: { feature: 'record-options' } });
    function paintOpts() {
      // the song's key once it's one somebody meant (a part in a key, or a key was set); else the key heard in the take
      const key = hum.songKey(), tk = hum.take, heard = tk && tk.opts && !tk.opts.key ? tk.opts.heard : null;
      const snap = key ? chip(`Snap: ${keyLabel(key)}`, opts.snapKey, () => { opts.snapKey = !opts.snapKey; reapply(); }, 'Move notes that are between notes onto the song’s key (you’ll see which)')
        : heard ? chip(`Snap: ${keyLabel(heard)}`, !!tk.opts.snapHeard && opts.snapKey, () => { const on = !(tk.opts.snapHeard && opts.snapKey); if (!setInTune(on)) { opts.snapKey = true; hum.retranscribe({ snapHeard: on, snapKey: true }); } paintOpts(); dirty = true; paintFoot(); }, 'The song has no key yet (no part in a key, no key set). On: your notes move into the key heard in your hum (the sound card’s In tune). Off: as you sang them.')
        : h('button.sk-chip', { disabled: true, title: 'The song has no key yet (no part in a key, no key set): a hum keeps the notes you sang, and its key is heard from the hum.' }, 'Snap: no key yet');
      optsEl.replaceChildren(
        snap,
        seg([[0.25, '1/16'], [0.5, '1/8']], opts.keepTiming ? null : opts.grid, (g) => { opts.grid = g; opts.keepTiming = false; reapply(); }, 'Grid'),
        chip('My timing', opts.keepTiming, () => { opts.keepTiming = !opts.keepTiming; reapply(); }, 'Don’t move notes onto the grid'));
    }
    function reapply() { paintOpts(); if (!hum.active && hum.take) hum.retranscribe({ snapKey: opts.snapKey, grid: opts.grid, keepTiming: opts.keepTiming }); dirty = true; paintFoot(); }
    paintOpts();

    // a hum recorded with R is in the song already (the recorder's commit put it there): where, or null once undone
    function recIn(tk) {
      const L = tk && tk.rec ? rec.last : null;
      if (!L || !L.ok || L.empty) return null;
      const pt = (L.parts || []).find((x) => x.track && store.track(x.track) && !isDrumTrack(store.track(x.track)) && (x.clips || []).some((c) => store.clip(x.track, c)));
      return pt ? { track: pt.track, clip: pt.clips.find((c) => store.clip(pt.track, c)) } : null;
    }
    function paintKept() {
      const tk = hum.take, inSong = tk && tk.rec ? recIn(tk) : null;
      const k = inSong || (tk && tk.capture ? keptOn(input.capture.get(tk.capture)) : null);
      setKept(keepBtn, k);
      // (a take recorded with R and nothing left over has nothing for Keep or the keep-to list to do: "Kept ✓" says so)
      dest.hidden = !!k;
      keepBtn.hidden = !!(tk && tk.rec && !tk.capture && !k);
      hSounds.hidden = !!k || !tk?.result || !tk.capture || typeof app.sounds?.offer !== 'function';
      if (!k && isSplit()) keepOnLabel(keepBtn, keepDest());
    }
    // A hum recorded with R onto a song whose key nobody chose: the key heard in it becomes the song's, as a hum kept
    // from here does (keepTo), so the top bar's Key and the take line say the same key. Its own undo step, after the take.
    // (the hum's take and the recorder's commit come in either order: it waits for the commit, a few seconds at most)
    let keyFor = null;
    function adoptHeardKey() {
      const tk = keyFor;
      if (!tk) return;
      if (Date.now() - tk.at0 > 10000) { keyFor = null; return; }
      if (rec.state !== 'idle' || !recIn(tk)) return;
      keyFor = null;
      const heard = tk.opts && !tk.opts.key ? tk.opts.heard : null;
      // (asked of the song as it was when it was hummed, tk.opts.key unset: once the hum's notes are in, they count
      // as a part in a key; a key set by hand since still wins)
      const setByHand = store.history.some((x) => (x.ops || []).some((o) => o && o.type === 'project.set' && o.patch && 'key' in o.patch));
      if (heard && !setByHand) {
        const k = { root: heard.root, scale: heard.scale };
        if (store.dispatch({ type: 'project.set', patch: { key: k } }, { by: 'you', label: `key ${keyLabel(k)}, heard in your hum` }).ok) tk.keyed = k;
      }
      paintFoot();
    }
    const offKeyIdle = rec.on('state', (e) => { if (e?.state === 'idle' && keyFor) setTimeout(adoptHeardKey, 0); });
    const offKeyDo = store.on('change', (e) => { if (keyFor && e?.kind === 'do' && e.by === 'you') setTimeout(adoptHeardKey, 0); });
    // a take that went into the song by itself (with R, or in free time): its line is the recorder's
    const landed = () => { const tk = hum.take, c = lastCommit; return !!(tk && tk.result && c && c.ok && !c.empty && (c.free ? !!tk.capture && c.capture === tk.capture : !!tk.rec && c.take === tk.recTake)); };
    function paintFoot() {
      const st = rec.state, taking = st !== 'idle' && (rec.humming() || rec.free);
      const on = hum.active || taking, tk = hum.take, r = tk && tk.result, inSong = !on && landed();
      saidEl.textContent = said || ''; saidEl.hidden = !said;
      btn.classList.toggle('on', on);
      btn.classList.toggle('counting', st === 'count' && taking);
      btn.querySelector('.sk-big-l').textContent = st === 'count' && taking ? 'Cancel' : on ? 'Stop' : tk && tk.result ? 'Again' : 'Hum';
      acts.hidden = on || !r || inSong; listen2.hidden = acts.hidden;
      const kb = btn.querySelector('kbd'); if (kb) kb.hidden = !!(tk && tk.result) && !on;
      if (!on && r && !inSong) fillDest(dest, 'hum');
      paintKept();
      sp.setKey(dialKey());
      if (st === 'count' && taking) status.replaceChildren(h('span.sk-live.rec', 'Counting in'), ` Come in right after the ${Math.ceil(bpbNow() - 1e-9)}.`);
      else if (taking && rec.free) status.replaceChildren(h('span.sk-live.rec', 'Rolling'), ' Hum or sing in your own time. ', touch ? 'Tap Stop when you’re done.' : 'Stop (or Space) when you’re done.');
      else if (on) status.replaceChildren(h('span.sk-live.rec', 'Rolling'), touch ? ' Hum or sing. Tap Stop when you’re done.' : ' Hum or sing. Stop (or Space) when you’re done.');
      else if (said) status.replaceChildren(said);
      // (the lean is the line under the roll's to say: this one stays a line)
      else if (inSong) { const sum = lastCommit.summary || 'Your hum is in the song.', lw = lastCommit.lean?.words; status.replaceChildren(h('b', lw ? sum.replace(' ' + lw, '') : sum), ' Undo takes it back.'); }
      else if (r) {
        // the key it was snapped to (the song's), or the one heard in the hum (a song with no key yet); what was moved
        // into it, counted, as the toast says it ("Moved 3 notes into C minor")
        const fromHum = !tk.opts.key && !!tk.opts.heard, key = tk.opts.key || tk.opts.heard, n = r.notes.length, m = r.moved.length;
        const moved = m ? ` Moved ${m} ${m === 1 ? 'note' : 'notes'} into ${keyLabel(key)}.` : fromHum ? ' Heard in your hum; nothing moved.' : key && tk.opts.snapKey === false ? ' As you sang it: nothing moved.' : '';
        // (it is in the song only once it's kept, or when R recorded it: before that it's a take, heard)
        const ins = recIn(tk), it = ins && store.track(ins.track);
        const head = it ? `Your hum is in the song: ${n} note${n === 1 ? '' : 's'} on ${it.name}${key ? ', ' + keyLabel(key) : ''}.` : `Your hum: ${n} note${n === 1 ? '' : 's'}${key ? ', ' + keyLabel(key) : ''}.`;
        status.replaceChildren(h('b', head), moved, tk.keyed ? ` The song is in ${keyLabel(tk.keyed)} now, from your hum.` : '',
          r.low ? ` ${r.low} dimmed: not sure of ${r.low === 1 ? 'it' : 'them'}.` : '');
      } else if (tk && !tk.result && !(tk.segs && tk.segs.length)) status.replaceChildren(h('b', 'Heard nothing.'), ' Hum a little louder, or closer to the mic.');
      else status.replaceChildren(h('span.ew-muted', touch ? 'Tap Hum and sing. Whatever is snapped to the key or the grid is shown, never hidden.' : 'Press Hum and sing. Whatever is snapped to the key or the grid is shown, never hidden.'));
      status.title = status.textContent;
    }
    async function go() {
      const st = rec.state;
      // a take that is the hum's (this button's, or R's in Hum it): Cancel in the count, Stop keeps it
      if (st !== 'idle' && (rec.humming() || rec.free)) { if (st === 'count') rec.cancel(); else await rec.stop(); paintFoot(); dirty = true; return; }
      if (hum.active) { await hum.stop(); paintFoot(); dirty = true; return; }
      try {
        unexplain();
        // another take recording (keys, pads): the hum joins it; otherwise a take of its own, into the song
        if (st !== 'idle') await hum.start({ rec: true });
        else await rec.record({ hum: true });
        try { localStorage.setItem(MIC_OK, '1'); } catch (e) { /* ok */ }
      } catch (e) { ui.toast(e.message, { kind: 'bad' }); }
      paintFoot(); dirty = true;
    }
    const offF = hum.on('frame', (f) => { sp.push(f.hz > 0 && f.conf > 0.3 ? f.midi : null, { conf: f.conf }); dirty = true; });
    const offS = hum.on('segs', () => { dirty = true; });
    const offT = hum.on('take', () => {
      if (hum.take) said = null;
      if (hum.take?.rec) { keyFor = hum.take; keyFor.at0 = Date.now(); if (rec.state === 'idle') setTimeout(adoptHeardKey, 0); }
      unexplain(); dirty = true; paintOpts(); paintFoot();
      const r = hum.take?.result;
      if (r) { for (const n of r.notes.slice(-6)) sp.pulse(n.p); bringKeep(acts, spWrap); offerTake(hum.take.capture, 'hum', keepDest()); }
      ui.emit('sketch:intune', { on: inTuneNow(), capture: hum.take?.capture || null });
    });
    const offState = hum.on('state', () => { if (!hum.active) sp.push(null); else { unexplain(); said = null; } paintFoot(); dirty = true; });
    const offRec = rec.on('state', () => { paintFoot(); dirty = true; });
    // the notes so far, as they are sung, where they will land: a take's on its passes (the recorder's grid), along
    // with the song at its beats; drawn on the ruler with a dashed warm edge until the take is in
    function sungNow() {
      const ns = hum.live();
      if (!ns.length) return [];
      const L = recLive;
      return ns.map((n) => { const w = L && hum.recording ? rec.where(n.t) : null; return { p: n.p, t: w ? w.beat : n.t, d: n.d, pass: w ? w.pass : along.pass, low: n.low }; });
    }
    place();
    paintFoot();
    let dirty = true, wasF = false;

    function drawRoll(now) {
      // the song is playing: the ruler, with the hum's pitch drawn up to the cursor
      if (following()) { drawRuler(roll, 'pitch', now, { trace: hum.active ? hum.trace().slice(-400) : null, hum: true, sung: hum.active ? sungNow() : null }); return; }
      roll.fit();
      const g = roll.g, w = roll.w, H = roll.h;
      g.clearRect(0, 0, w, H);
      const p = store.get(), spb = 60 / p.tempo, bpb = beatsPerBar(p.meter);
      const live = hum.active, tk = hum.take;
      const frames = live ? hum.trace() : tk ? tk.frames : [];
      const segs = live ? hum.segs() : tk ? tk.segs : [];
      let notes = [], origin = 0, originBeat = 0, shift = 0;
      if (live) {
        if (segs.length) notes = transcribe(segs, { tempo: p.tempo, ...opts, key: hum.songKey(), meter: p.meter }).notes;
        origin = segs.length ? segs[0].t0 : (frames[0]?.t || 0);
      } else if (tk && tk.result) {
        notes = tk.result.notes; origin = tk.opts.origin ?? (segs[0]?.t0 || 0); originBeat = tk.opts.originBeat || 0; shift = tk.beat || 0;
      }
      const tb = (t) => originBeat + (t - origin) / spb - shift;
      const lastT = frames.length ? tb(frames[frames.length - 1].t) : 0;
      const end = Math.max(bpb, ...notes.map((n) => n.t + n.d), live ? lastT + 0.5 : 0);
      const span = Math.ceil(end / bpb) * bpb;
      // pitch range
      const ps = [...notes.map((n) => n.p), ...notes.map((n) => Math.round(n.raw ?? n.p)), ...frames.filter((f) => f.midi && f.conf > 0.3).map((f) => f.midi)];
      let lo = ps.length ? Math.floor(Math.min(...ps)) - 2 : 57, hi = ps.length ? Math.ceil(Math.max(...ps)) + 2 : 72;
      if (hi - lo < 12) { const c = (hi + lo) / 2; lo = Math.floor(c - 6); hi = lo + 12; }
      const gut = 30, L = gut, Rr = w - 8, T = 8, B = H - 16, rows = hi - lo + 1, rh = (B - T) / rows;
      const X = (b) => L + (b / span) * (Rr - L), Y = (m) => B - (m - lo + 0.5) * rh;
      const cs = colorsOf();
      const shownKey = !live && tk && tk.opts ? tk.opts.key || (tk.opts.snapHeard ? tk.opts.heard : null) : hum.songKey();
      // names spelled for the take's key (the song's, or the one heard in the hum), as the piano roll spells them
      const spellKey = (!live && tk && tk.opts ? tk.opts.key || tk.opts.heard : null) || hum.songKey() || NO_KEY;
      const pcs = shownKey ? new Set(scalePcs(shownKey)) : null;
      for (let m = lo; m <= hi; m++) {
        const y = B - (m - lo + 1) * rh, pc = ((m % 12) + 12) % 12;
        if (pcs && pcs.has(pc)) { g.fillStyle = withA(cs.text, 0.035); g.fillRect(L, y, Rr - L, rh); }
        if (pc === 0) { g.fillStyle = withA(cs.line2, 0.8); g.fillRect(L, y + rh - 0.5, Rr - L, 1); }
        if (pc === 0 || (shownKey && pc === pcsRoot(shownKey)) ) { g.fillStyle = cs.text3; g.font = `600 9px ${cs.mono}`; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(spellNote(m, spellKey), L - 5, y + rh / 2); }
      }
      for (let b = 0; b <= span; b += 0.25) {
        const x = Math.round(X(b)) + 0.5, bar = Math.abs(b % bpb) < 1e-6, beat = Math.abs(b % 1) < 1e-6;
        if (!beat && span > 16) continue;
        g.strokeStyle = bar ? cs.line2 : beat ? withA(cs.line2, 0.55) : withA(cs.line, 0.6);
        g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke();
        if (bar) { g.fillStyle = cs.text3; g.font = `600 9px ${cs.mono}`; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(String(b / bpb + 1), x + 3, B + 3); }
      }
      // the raw pitch: what you actually sang
      g.strokeStyle = withA(cs.text2, 0.55); g.lineWidth = 1.4; g.lineJoin = 'round';
      g.beginPath(); let pen = false;
      for (const f of frames) {
        if (!(f.midi > 0) || f.conf < 0.3) { pen = false; continue; }
        const x = X(tb(f.t)), y = Y(f.midi);
        if (x < L - 2) continue;
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
      // the notes it became: the keep-to track's colour, a warm edge (yours), dimmed when unsure; moved ones show where from
      const fill = colorOf(destTrack());
      for (const n of notes) {
        const x = X(n.t), x2 = X(n.t + n.d), y = Y(n.p) - rh / 2 + 1, hh = Math.max(3, rh - 2), ww = Math.max(3, x2 - x - 1);
        if (n.moved != null) {
          const yr = Y(n.moved);
          g.setLineDash([2, 3]); g.strokeStyle = withA(cs.text2, 0.6); g.lineWidth = 1;
          g.strokeRect(x + 0.5, yr - rh / 2 + 1.5, ww - 1, hh - 1); g.setLineDash([]);
          g.strokeStyle = withA(cs.human, 0.8); g.beginPath(); g.moveTo(x + 6, yr); g.lineTo(x + 6, Y(n.p) + (n.p > n.moved ? rh / 2 : -rh / 2)); g.stroke();
        }
        g.globalAlpha = n.low ? 0.38 : live ? 0.7 : 0.95;
        rr(g, x, y, ww, hh, 1.5); g.fillStyle = fill; g.fill();
        g.globalAlpha = 1;
        // a warm outline: yours (dashed when it isn't sure)
        if (n.low) g.setLineDash([3, 2]);
        g.strokeStyle = n.low ? withA(cs.human, 0.6) : cs.human; g.lineWidth = 1; rr(g, x + 0.5, y + 0.5, ww - 1, hh - 1, 1.5); g.stroke(); g.setLineDash([]);
        if (ww > 26 && hh >= 9) { g.fillStyle = '#211e1a'; g.font = `700 ${Math.min(10, hh - 2)}px ${cs.mono}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(spellNote(n.p, spellKey), x + 6, y + hh / 2 + 0.5); }
      }
      if (live) { const x = X(lastT); g.strokeStyle = cs.human; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke(); }
      if (!frames.length && !notes.length) { g.fillStyle = cs.text3; g.font = `13px ${cs.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Your notes land here.', (L + Rr) / 2, (T + B) / 2); }
    }
    return {
      opts: optsEl,
      band: touch ? null : band.el,   // (a computer: the stage's head, the line where the blurb was, so the roll keeps its height)
      place,
      frame(now) {
        sp.frame(now);
        band.paint();
        const f = following();
        if (dirty || hum.active || f || wasF) { dirty = false; drawRoll(now); }
        wasF = f;
      },
      update(evt) { sp.setKey(dialKey()); if (evt && evt.ops && evt.ops.some((o) => o.type === 'project.set' || o.type.startsWith('clip.'))) { paintOpts(); dirty = true; } if (!hum.active && hum.take && evt && evt.ops && evt.ops.some((o) => o.type.startsWith('track.'))) paintFoot(); paintKept(); },
      kept: () => paintKept(),
      retarget: () => paintKept(),
      takeId: () => (hum.take?.result ? hum.take.capture || null : null),
      said: () => paintFoot(),
      refresh() { dirty = true; },
      destroy() { offF(); offS(); offT(); offState(); offRec(); offKeyIdle(); offKeyDo(); band.destroy(); },
    };
  }

  /* ======================================================== TAP */
  function tapView() {
    const tap = input.tap;
    let keysOn = true;
    // (a touch-first screen has no F J K L to press: the pads are the way in, and the key hints stay off them)
    const pads = h('div.sk-pads', ROWS.map((r) => {
      const b = h('button.sk-pad', { dataset: { row: r.id }, title: touch ? `${r.label}. Beatbox: ${r.say}` : `${r.label} (${r.hint}). Beatbox: ${r.say}` }, h('span.sk-pad-l', r.short || r.label), touch ? null : h('kbd', r.hint), h('small', r.say));
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); const rc = b.getBoundingClientRect(); const v = clamp(1.05 - (e.clientY - rc.top) / rc.height * 0.6, 0.45, 1); tap.hit(r.id, Math.round(v * 100) / 100); });
      return b;
    }));
    const grid = canvas('sk-grid');
    const gridWrap = h('div.sk-rollwrap', h('div.sk-cv', grid.cv));
    // the beat where the eyes are (the band: its lamps, the count, what is recording, the click, the take's timing):
    // over the canvas on a computer, right over the pads on a touch screen, where the thumbs are
    const band = beatBand();
    // (a touch screen: the pads are big, over the ruler; a computer: a row in the footer, so the ruler has the stage's
    // whole width and height)
    const padCol = h('div.sk-padcol', ...(touch ? [band.el] : []), pads);
    if (touch) body.append(padCol, gridWrap); else body.append(gridWrap);
    const paintBeats = () => band.paint();
    const status = h('div.sk-status.sk-cap', { role: 'status', 'aria-live': 'polite' });
    const bbBtn = h('button.btn.sk-big.sk-bb', { onclick: async () => { try { if (tap.beatboxing) { await tap.stopBeatbox(); } else { await tap.startBeatbox(); try { localStorage.setItem(MIC_OK, '1'); } catch (e) { /* ok */ } } } catch (e) { ui.toast(e.message, { kind: 'bad' }); } paint(); }, title: 'Beatbox: the mic as drums. To hum a tune, use Hum it.' }, h('span.sk-dot'), h('span.sk-big-l', 'Beatbox'));
    const dest = h('span.sk-destwrap');
    // (a phone: Keep goes where Record's picker says, one picker for both)
    const keepDest = () => (isSplit() ? stripDest('drums') : dest.firstChild?.value);
    const keepBtn = h('button.btn.btn-go.ew-btn-primary', { onclick: () => { const l = lastTake(); if (l) { keepTo(l.id, keepDest()); paintKept(); } }, title: 'Keep it as a clip (by you)' }, h('span.sk-wide', 'Keep as a clip'), h('span.sk-narrow', 'Keep'));
    function paintKept() { const l = lastTake(), k = l ? keptOn(l) : null; setKept(keepBtn, k); tSounds.hidden = !l || !!k || typeof app.sounds?.offer !== 'function'; if (!k && isSplit()) keepOnLabel(keepBtn, keepDest()); }
    const agentBtn = h('button.btn.ew-btn-agent', { onclick: () => { const l = lastTake(); if (l) toAgent(l.id); }, title: 'Hand it to the agent' }, icon('agent', { size: 15 }), h('span.sk-wide', 'Hand it to the agent'), h('span.sk-narrow', 'Agent'));
    const hearBtn = h('button.btn.btn-txt.sk-ic', { onclick: () => { const l = lastTake(); if (l) hear(input.capture.phraseNotes(l.id).notes, l.track, { drums: true }); }, title: 'Hear the beat as it snapped' }, 'Hear it');
    const tSounds = soundsBtn(() => lastTake()?.id, 'pads', () => keepDest());
    const acts = h('div.sk-acts', dest, keepBtn, agentBtn, tSounds, hearBtn);
    // A beat in the song: the take line ends "Hum a tune over it?" (Hum over it: ui/onboard.js humOver, the coach's)
    const overEl = h('span.sk-over', { hidden: true }, 'Hum a tune over it? ', h('button.btn.btn-txt.sk-humover', { type: 'button', title: 'Sketch goes to Hum it, and a short beat runs 8 bars so a tune has room', onclick: () => humOver() }, 'Hum over it'));
    // The Beatbox catch: a beatbox that reads as a tune (input/tap.js 'tune') asks before anything changes. Keep the
    // beat is the default (focused: Enter presses it), because the person chose Beatbox; Make it a melody hears the same
    // sounds as a hum, in the key heard in it, on a new track (Melody), and the sound card follows. Takes keeps both.
    const catchEl = h('div.sk-catch', { role: 'group', 'aria-label': 'A tune in the beatbox', hidden: true });
    let tune = null;
    function melodyOf(segs) {
      const p = store.get(), o = { tempo: p.tempo, meter: p.meter, grid: input.options.grid || 0.25, keepTiming: false };
      let r = transcribe(segs, { ...o, key: input.hum.songKey?.() || null });
      const heard = !input.hum.songKey?.() && r.keyGuess ? { root: r.keyGuess.root, scale: r.keyGuess.scale } : null;
      if (heard) r = transcribe(segs, { ...o, key: heard, snapKey: true });
      return { notes: r.notes, moved: (r.moved || []).length, key: input.hum.songKey?.() || heard, heard: !!heard };
    }
    function showCatch(e) {
      if (!e || rec.state !== 'idle') return;
      const segs = e.segs || e.segments || [];
      const m = segs.length ? melodyOf(segs) : null;
      if (!m || !m.notes.length) return;
      tune = { ...m, capture: e.capture || e.id || lastTake()?.id || null };
      const keepB = h('button.btn.sk-keepbeat', { type: 'button', title: 'Keep it as a beat: it stays as it is', onclick: () => dropCatch() }, 'Keep the beat');
      const melB = h('button.btn.btn-txt.sk-melody', { type: 'button', title: 'Hear it as a hum: its notes, in the key heard in it, on a new track', onclick: () => makeMelody() }, 'Make it a melody');
      const n = m.notes.length;
      catchEl.replaceChildren(h('p.sk-catch-l', `That sounded like a tune: ${n} note${n === 1 ? '' : 's'}. Keep it as a melody?`), keepB, melB);
      catchEl.hidden = false;
      requestAnimationFrame(() => { if (!catchEl.hidden) keepB.focus({ preventScroll: true }); });
    }
    function dropCatch() {
      const had = catchEl.contains(document.activeElement);
      tune = null; catchEl.hidden = true; catchEl.replaceChildren();
      if (had) (acts.hidden ? null : keepBtn)?.focus({ preventScroll: true });
    }
    function makeMelody() {
      const tn = tune;
      if (!tn) return;
      const src = tn.capture ? input.capture.get(tn.capture) : null, p = store.get();
      const ph = input.capture.add({ src: 'hum', kind: 'notes', notes: tn.notes.map(({ p: pp, t, d, v }) => ({ p: pp, t, d, v: v ?? 0.8 })), tempo: p.tempo, beat: src?.beat ?? null, key: tn.key, keyFrom: tn.heard ? 'hum' : tn.key ? 'song' : undefined, moved: tn.moved, label: 'From the beatbox' });
      dropCatch();
      if (ph?.id) keepTo(ph.id, 'new');
    }
    const listen2 = h('div.sk-listen');
    // (a computer: the take's Keep row is the caption line over its grid, so the footer stays two rows; a touch screen
    // keeps it in the pinned footer, under the thumb)
    // (a computer: the pass line is the caption while there is one, so the grid keeps its rows: a line of its own under
    // it left four 5 px rows in a 900 px window)
    // (a phone: the pinned row is one row, Beatbox, Record and its track; what the take is goes beside the snap chips,
    // over the grid, and its Keep row under the pads, in the sheet)
    const takeRow = h('div.sk-take');
    function place() {
      if (!touch) return;
      // (a phone: the line, beside the snap chips (paintOpts), then the grid, over the pads, so what to tap and the beat
      // you tap are in view above them and the pads are nearest the thumb; under the pads, they sat under the pinned
      // row, below the fold)
      if (isSplit()) { takeRow.replaceChildren(catchEl, acts); body.replaceChildren(gridWrap, padCol, takeRow); gridWrap.append(overEl, readEl); }
      else { body.replaceChildren(padCol, catchEl, gridWrap); gridWrap.append(status, overEl, readEl); foot.insertBefore(acts, bbBtn.nextSibling); }
      paintOpts();
      paintKept();
      placeHost();
    }
    if (touch) foot.append(bbBtn);
    else { foot.append(bbBtn, padCol); gridWrap.append(catchEl, h('div.sk-capline', status, overEl, readEl, acts)); }
    const optsEl = h('div.sk-opts');
    // this song's last beat, not another song's (a pass recorded with R is in the song already: its card says where)
    const lastTake = () => input.capture.list({ all: true }).find((p) => p.kind === 'drums' && ofSong(p) && !p.rec) || null;
    // the beat the grid shows when nothing is going on: the last one tapped, kept or not, or recorded into the song with
    // R (every pass of that take, layered as it plays); a recorded one has no Keep row: it is in the song already
    function lastBeat() {
      const l = input.capture.list({ all: true }).find((p) => p.kind === 'drums' && ofSong(p)) || null;
      if (!l || !l.rec) return l ? { take: l, rec: false, notes: input.capture.phraseNotes(l.id).notes, raws: null } : null;
      const passes = input.capture.list({ all: true }).filter((p) => p.rec && p.take === l.take && p.kind === 'drums' && ofSong(p));
      const b0 = Math.min(...passes.map((p) => p.beat ?? 0)), bpb = bpbNow();
      const notes = [], raws = [];
      for (const p of passes) {
        const off = (p.beat ?? 0) - b0;
        (p.notes || []).forEach((n, i) => {
          notes.push({ p: n.p, t: n.t + off, d: n.d, v: n.v });
          const raw = p.raw?.[i], row = rowOfP(n.p);
          if (!Number.isFinite(raw) || !row) return;
          // where it fell against the cell it took (a hit just before the loop came round took the next pass's downbeat)
          let dv = raw - (p.beat ?? 0) - n.t;
          if (Math.abs(dv) > 1) { const m = ((dv % bpb) + bpb) % bpb; dv = m > bpb / 2 ? m - bpb : m; }
          raws.push({ row, b: n.t + off + dv });
        });
      }
      return { take: l, rec: true, notes, raws, from: b0, track: l.track };
    }
    function paintOpts() {
      optsEl.replaceChildren(...[
        touch ? null : chip(keysOn ? 'F J K L play pads: on' : 'F J K L play pads: off', keysOn, () => { keysOn = !keysOn; input.setMode(keysOn ? 'tap' : null); paintOpts(); }, keysOn ? 'F J K L play the pads (Shift for an accent), not the studio’s shortcuts. Click or Esc to turn them off.' : 'F J K L are the studio’s shortcuts again (L is loop). Click to make them play the pads.'),
        tagged(seg([[0.25, '1/16'], [0.5, '1/8']], input.options.grid, (g) => { input.options.grid = g; paintOpts(); }, 'Grid'), 'record-options'),
        // (a phone: the line sits beside the snap chips, over the grid, so it is in view with the pads and costs no row)
        touch && isSplit() ? status : null].filter(Boolean));
    }
    paintOpts();
    input.setMode('tap');
    const flash = new Map();
    let pending = null;   // the take's own hits, as tapped (performance.now seconds, and the song's beat if it played)
    const offHit = tap.on('hit', (e) => { flash.set(e.row, performance.now()); if (!e.rec && !e.live && tap.take) pending = { hits: tap.take.hits, playing: tap.take.playing }; dirty = true; });
    const offTake = tap.on('take', (c) => { if (c && c.id && pending) rawOf.set(c.id, { ...pending, tempo: c.tempo || store.get().tempo }); pending = null; if (tune && c && c.id !== tune.capture) dropCatch(); dirty = true; paint(); bringKeep(acts, isSplit() ? gridWrap : padCol); if (c && c.id) offerTake(c.id, 'pads', keepDest()); });
    const offTune = tap.on('tune', (e) => showCatch(e));
    const offMode = input.on('mode', (m) => { keysOn = m === 'tap'; paintOpts(); });
    let dirty = true;
    function paint() {
      const l = lastTake(), cur = tap.take, lb = lastBeat();
      bbBtn.classList.toggle('on', tap.beatboxing);
      bbBtn.querySelector('.sk-big-l').textContent = tap.beatboxing ? 'Stop' : 'Beatbox';
      // (while the song plays, the ruler has the room: the take's buttons come back when it stops)
      acts.hidden = !l || !!cur || tap.beatboxing || following() || !!lb?.rec; listen2.hidden = acts.hidden;
      // (a beat in the song: recorded with R, or kept)
      overEl.hidden = !lb || !!cur || tap.beatboxing || following() || !(lb.rec || keptOn(lb.take)) || !!tune;
      if (l && !cur) fillDest(dest, 'pads', l.track);
      paintKept();
      // the status is a live region and paint() runs every frame during a take: only touch it when what it says changes
      const fol = following() ? (rec.state !== 'idle' ? 'rec' : 'along') : '';
      const freeRec = rec.free && rec.state === 'rec';
      const key = tap.beatboxing ? 'bb' : freeRec ? `free:${cur ? cur.hits.length : 0}` : fol ? `follow:${fol}` : cur ? `take:${cur.hits.length}` : lb?.rec ? `rec:${lb.take.id}:${lb.notes.length}:${lastCommit?.take || ''}` : l ? `kept:${l.id}:${l.at || ''}:${rawOf.has(l.id)}` : `idle:${keysOn}`;
      if (key === statusKey) return;
      statusKey = key;
      if (tap.beatboxing) status.replaceChildren(h('span.sk-live.rec', 'Rolling'), ' “b” for kick, “k” for snare, “ts” for hat. Stop when you’re done.');
      else if (freeRec) status.replaceChildren(h('span.sk-live.rec', 'Recording'), cur ? ` ${cur.hits.length} hit${cur.hits.length === 1 ? '' : 's'}, in your own time. ` : ' In your own time: no click. ', touch ? 'Stop when you’re done.' : 'Space when you’re done.');
      else if (fol === 'rec') status.replaceChildren(h('span.sk-live.rec', 'Recording'), touch ? ' Each hit goes on the beat nearest it.' : ' The ticks are your taps; the cells are where they went in.');
      else if (fol) status.replaceChildren(h('span.ew-muted', touch ? 'Tap along. Record puts it in the song as you go; afterwards, Put it in the song.' : 'Tap along. R records into the song; Shift+R puts what you just tapped there.'));
      else if (cur) status.replaceChildren(h('b', `${cur.hits.length} hit${cur.hits.length === 1 ? '' : 's'}`), ' Keep going; stop for 2.5 s to finish the take.');
      else if (lb?.rec) {
        const bars = Math.max(1, Math.ceil(Math.max(...lb.notes.map((n) => n.t + n.d), 1e-6) / bpbNow() - 1e-6));
        // (the take's lean, taken out at the stop, said with its number; input/recorder.js leanWords)
        const c = lastCommit, lean = c && c.ok && c.take === lb.take?.take && c.lean ? leanWords({ lean: c.lean.beats, ms: c.lean.ms, opening: c.lean.opening, kind: 'hit' }) : '';
        status.replaceChildren(h('b', `Your beat is in the song: ${lb.notes.length} hits, ${barsOf(bpbNow(), lb.from, lb.from + bars * bpbNow())}.`), lean ? ` ${lean}` : touch ? '' : ' The ticks are your taps; the cells are where they went in.');
      }
      else if (l) { const pn = input.capture.phraseNotes(l.id); status.replaceChildren(h('b', `Your beat is in. ${pn.notes.length} hits, ${pn.bars} bar${pn.bars === 1 ? '' : 's'}.`), rawOf.has(l.id) && !touch ? ' The ticks are your taps; the cells are where they went in.' : ''); }
      else status.replaceChildren(h('span.ew-muted', touch ? 'Tap the pads: kick, snare, hat, open hat.' : keysOn ? 'Tap F (kick), J (snare), K (hat), L (open hat), or the pads.' : 'Tap the pads, or turn the keys on.'));
    }
    let statusKey = '', wasF = false;
    place();
    paint();
    // where each raw tap fell, in beats from the take's first beat (as flush() lines them up)
    function rawBeats(r, bpb) {
      const hs = r.hits;
      if (!hs.length) return [];
      if (r.playing && hs.every((x) => x.beat != null)) { const o = Math.max(0, Math.floor((Math.min(...hs.map((x) => x.beat)) + 0.25) / bpb) * bpb); return hs.map((x) => ({ row: x.row, b: x.beat - o })); }
      const spb = 60 / (r.tempo || store.get().tempo), t0 = hs[0].t;
      return hs.map((x) => ({ row: x.row, b: (x.t - t0) / spb }));
    }
    function drawGrid(now) {
      if (following()) { drawRuler(grid, 'drums', now); for (const b of pads.children) { const fl = flash.get(b.dataset.row); b.classList.toggle('hit', !!fl && now - fl < 110); } return; }
      grid.fit();
      const g = grid.g, w = grid.w, H = grid.h, cs = colorsOf();
      g.clearRect(0, 0, w, H);
      const p = store.get(), bpb = beatsPerBar(p.meter), step = input.options.grid || 0.25;
      let notes = [], raws = [], bar0 = 0;   // (bar0: a take in the song is numbered with the song's bars)
      const cur = tap.take;
      if (cur && cur.hits.length) {
        const spb = 60 / p.tempo, t0 = cur.hits[0].t;
        notes = cur.hits.map((x) => ({ p: (ROWS.find((r) => r.id === x.row) || ROWS[0]).p, t: Math.round(((x.t - t0) / spb) / step) * step, v: x.v }));
        raws = cur.hits.map((x) => ({ row: x.row, b: (x.t - t0) / spb }));
      } else {
        const lb = lastBeat();
        if (lb?.rec) { notes = lb.notes; raws = lb.raws; bar0 = Math.round(lb.from / bpb); }
        else if (lb) { notes = lb.notes; const r = rawOf.get(lb.take.id); if (r) raws = rawBeats(r, bpb); }
      }
      const end = Math.max(bpb, ...notes.map((n) => n.t + step), ...raws.map((x) => x.b + step)), span = Math.ceil(end / bpb) * bpb, steps = Math.round(span / step);
      // (the bar numbers in a band over the rows, as the ruler has them: a short pane keeps its rows)
      const L = 64, Rr = w - 8, T = H >= 80 ? 18 : 14, B = H - 3, rh = (B - T) / ROWS.length, cw = (Rr - L) / steps;
      geom = { kind: 'tap', from: 0, to: span, L, R: Rr, T, B, rh, w, h: H, rows: ROWS.map((r) => r.id), hits: notes.length };
      const fill = colorOf((cur && cur.track) || lastBeat()?.track || lastTake()?.track || instrumentTracks().find(isDrumTrack)?.id);
      const perBar = Math.round(bpb / step), perBeat = Math.round(1 / step);
      ROWS.forEach((r, i) => {
        const y = T + i * rh, fl = flash.get(r.id), fk = fl ? Math.max(0, 1 - (now - fl) / 300) : 0;
        g.fillStyle = fk > 0.3 ? cs.text : cs.text2; g.font = `600 ${Math.min(11, Math.floor(rh - 1))}px ${cs.ui}`; g.textAlign = 'left'; g.textBaseline = 'middle';
        if (rh >= 8) g.fillText(r.label, 4, y + rh / 2);
        // the cells: square, a shade lighter on the beat; a hairline under each row
        for (let s = 0; s < steps; s++) {
          const x = L + s * cw;
          g.fillStyle = s % perBeat === 0 ? withA(cs.text, 0.055) : withA(cs.text, 0.025);
          g.fillRect(x + 1, y + 3, cw - 2, rh - 6);
        }
        g.fillStyle = cs.line; g.fillRect(0, Math.round(y + rh) - 0.5, Rr, 1);
      });
      // bar lines and the bar numbers
      for (let s = 0; s <= steps; s += perBar) { const x = Math.round(L + s * cw) - 0.5; g.fillStyle = cs.line2; g.fillRect(x, T - 12, 1, B - T + 12); }
      g.fillStyle = cs.text3; g.font = `italic 800 ${T >= 18 ? 13 : 11}px ${cs.disp}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      if ('fontStretch' in g) g.fontStretch = 'expanded';
      for (let b = 0; b < span; b += bpb) g.fillText(String(bar0 + b / bpb + 1), L + (b / step) * cw + 5, T - 3);
      if ('fontStretch' in g) g.fontStretch = 'normal';
      // where each tap snapped: the track's colour, a warm outline (yours)
      for (const n of notes) {
        const i = ROWS.findIndex((r) => r.p === n.p || DRUM_MAP[r.id] === n.p);
        if (i < 0) continue;
        const x = L + Math.round(n.t / step) * cw, y = T + i * rh;
        g.globalAlpha = 0.5 + 0.5 * (n.v ?? 0.8);
        g.fillStyle = fill; g.fillRect(x + 1.5, y + 3.5, cw - 3, rh - 7);
        g.globalAlpha = 1;
        g.strokeStyle = withA(cs.human, 0.75); g.lineWidth = 1; g.strokeRect(x + 2, y + 4, cw - 4, rh - 8);
      }
      // your taps, as tapped: a tick each, over the cell it snapped to
      for (const x0 of raws) {
        const i = ROWS.findIndex((r) => r.id === x0.row);
        if (i < 0) continue;
        const x = Math.round(L + (x0.b / step + 0.5) * cw), y = T + i * rh;
        g.fillStyle = cs.bg; g.fillRect(x - 2, y + 1, 4, rh - 2);
        g.fillStyle = cs.text; g.fillRect(x - 1, y + 1, 2, rh - 2);
      }
      for (const b of pads.children) { const fl = flash.get(b.dataset.row); b.classList.toggle('hit', !!fl && now - fl < 110); }
    }
    return {
      opts: optsEl,
      band: touch ? null : band.el,   // (a computer: the stage's head, where the blurb was; a touch screen: over the pads)
      frame(now) { const f = following(); paintBeats(); if (dirty || f || wasF || tap.take || [...flash.values()].some((t) => now - t < 320)) { dirty = false; drawGrid(now); if (tap.take || f !== wasF) paint(); } if (rec.state !== 'idle' || statusKey.startsWith('free')) paint(); wasF = f; },
      update() { dirty = true; if (!tap.take) paint(); },
      kept() { paintKept(); paint(); },
      place,
      retarget: () => paintKept(),
      takeId: () => lastTake()?.id || null,
      refresh() { dirty = true; },
      destroy() { offHit(); offTake(); offTune(); offMode(); band.destroy(); if (input.mode === 'tap') input.setMode(null); },
    };
  }

  /* ======================================================== PLAY */
  function playView() {
    const sp = createSpiral({ lo: 36, hi: 96, key: store.get().key });
    const roll = canvas('sk-roll');
    // musical typing's key strip docks here (in place of the spiral) while it's on, so it covers nothing; a touch
    // screen gets its own keyboard instead
    const dock = h('div.sk-qwdock');
    const tk = touch ? touchKeys() : null;
    body.append(tk ? tk.el : h('div.sk-spiral', sp.el), dock, h('div.sk-rollwrap', h('div.sk-cv', roll.cv), readEl));
    if (!tk) input.qwerty.dock?.(dock);
    // the keys and Record above them, not the blurb, in view
    else requestAnimationFrame(() => { if (!tk.el.isConnected) return; if (strip.parentElement === body) strip.scrollIntoView({ block: 'start' }); else tk.el.scrollIntoView({ block: 'nearest' }); });
    const status = h('div.sk-status', { role: 'status', 'aria-live': 'polite' });
    const typeBtn = h('button.btn.sk-big.sk-type', { onclick: () => input.qwerty.toggle(), title: 'Musical typing (`)', hidden: touch, 'aria-pressed': 'false' }, h('span.sk-big-l', 'Musical typing'), h('kbd', '`'));
    const midiBtn = h('button.btn', { onclick: async () => { await input.midi.connect(); paint(); } }, 'Connect MIDI');
    const midiSel = h('select.sk-select', { 'aria-label': 'MIDI input', onchange: () => input.midi.setDevice(midiSel.value) });
    // what's in the way of a MIDI keyboard, said where the button would be (it used to hide with the button, and with
    // the status line while musical typing is on: in Safari there was no button and no reason)
    const midiNote = h('span.sk-midinote', { role: 'note' });
    foot.append(typeBtn, midiBtn, midiSel, midiNote, status);
    const optsEl = h('div.sk-opts');
    function paintOpts() {
      const tsel = h('select.sk-select', { 'aria-label': 'Play on', onchange: () => ui.select({ track: tsel.value, clip: null, notes: [] }) });
      const tgt = input.target();
      for (const t of instrumentTracks()) tsel.append(h('option', { value: t.id }, `Playing ${t.name}`));
      if (tgt) tsel.value = tgt.id;
      // (Scale lock and the grid, on until you turn them off, are the line over the keys: musical typing's strip, or the
      // touch keys' bar, where what you play is)
      optsEl.replaceChildren(tsel);
    }
    function paint() {
      const m = input.midi.state, q = input.qwerty;
      typeBtn.classList.toggle('on', q.on); typeBtn.setAttribute('aria-pressed', String(!!q.on));
      body.classList.toggle('typing', !tk && q.on);
      midiBtn.hidden = m.connected || !m.supported;
      midiSel.hidden = !m.connected || !m.inputs.length;
      midiSel.replaceChildren(h('option', { value: '' }, 'All MIDI inputs'), ...m.inputs.map((i) => h('option', { value: i.id }, i.name)));
      midiSel.value = m.device || '';
      const note = !m.supported ? (touch ? '' : 'To play a MIDI keyboard, open this page in Chrome, Edge or Firefox: this browser can’t use one.')
        : m.connected && !m.inputs.length ? 'No MIDI keyboard found. Plug one in (USB) and it shows up here.'
        : !m.connected && m.status ? m.status : '';
      midiNote.textContent = note; midiNote.hidden = !note;
      const live = input.capture.live();
      if (live) status.replaceChildren(h('span.sk-live.rec', 'Capturing'), ` ${live.notes.length} note${live.notes.length === 1 ? '' : 's'}… stop for 2.5 s and it’s kept.`);
      else status.replaceChildren(h('span.ew-muted', m.connected && m.inputs.length ? `${m.inputs.map((i) => i.name).join(', ')}: play anything. It’s kept.` : tk ? 'Lower on a key is louder. Everything you play is kept.' : q.on ? 'Type A–L to play. Z X octave, C V velocity.' : m.supported ? 'Turn on musical typing (`) or connect a MIDI keyboard. Everything you play is kept.' : 'Turn on musical typing (`) to play with your computer keys. Everything you play is kept.'));
      status.title = status.textContent;
    }
    paintOpts(); paint();
    const offs2 = [input.on('midi', paint), input.on('qwerty', () => { paint(); paintOpts(); tk?.keyed(); }), input.on('capture', () => { paint(); dirty = true; }),
      input.on('note', (e) => { sp.setHeld(input.held()); if (e.on) sp.pulse(e.p); dirty = true; }), ui.on('select', () => { paintOpts(); tk?.retarget(); })];
    let dirty = true, wasF = false;
    function drawRoll(now) {
      if (following()) { drawRuler(roll, 'pitch', now); return; }
      roll.fit();
      const g = roll.g, w = roll.w, H = roll.h, cs = colorsOf();
      g.clearRect(0, 0, w, H);
      const live = input.capture.live(), p = store.get(), spb = 60 / p.tempo, bpb = beatsPerBar(p.meter);
      let notes = [], title = '';
      if (live) { notes = live.notes.map((n) => ({ ...n, t: n.t / spb, d: n.d / spb })); title = 'now'; }
      else { const l = input.capture.list().find((x) => (x.src === 'midi' || x.src === 'qwerty' || x.src === 'touch') && ofSong(x)); if (l) { notes = l.notes; title = l.label; } }
      const end = Math.max(bpb, ...notes.map((n) => n.t + n.d), live ? live.now / spb : 0), span = Math.ceil(end / bpb) * bpb;
      const ps = notes.map((n) => n.p);
      let lo = ps.length ? Math.min(...ps) - 2 : 55, hi = ps.length ? Math.max(...ps) + 2 : 72;
      if (hi - lo < 12) { const c = (hi + lo) / 2; lo = Math.floor(c - 6); hi = lo + 12; }
      const L = 30, Rr = w - 8, T = title ? 16 : 8, B = H - 16, rh = (B - T) / (hi - lo + 1);
      const X = (b) => L + (b / span) * (Rr - L), Y = (m) => B - (m - lo + 1) * rh;
      for (let m = lo; m <= hi; m++) { if ([1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)) { g.fillStyle = withA('#000000', 0.12); g.fillRect(L, Y(m), Rr - L, rh); } if (m % 12 === 0) { g.fillStyle = cs.text3; g.font = `600 9px ${cs.mono}`; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(spellNote(m, p.key), L - 5, Y(m) + rh / 2); } }
      for (let b = 0; b <= span; b += 1) { const x = Math.round(X(b)) + 0.5; g.strokeStyle = b % bpb === 0 ? cs.line2 : withA(cs.line2, 0.45); g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke(); }
      const fill = colorOf(input.target()?.id);
      for (const n of notes) {
        const x = X(n.t), ww = Math.max(3, X(n.t + n.d) - x - 1), y = Y(n.p) + 1, hh = Math.max(3, rh - 2);
        g.globalAlpha = live ? (n.held ? 1 : 0.72) : 0.9;
        rr(g, x, y, ww, hh, 1.5); g.fillStyle = fill; g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = n.held ? cs.text : cs.human; g.lineWidth = n.held ? 1.5 : 1; rr(g, x + 0.5, y + 0.5, ww - 1, hh - 1, 1.5); g.stroke();
      }
      g.fillStyle = cs.text3; g.font = `600 10px ${cs.ui}`; g.textAlign = 'right'; g.textBaseline = 'top';
      if (title) g.fillText(live ? 'capturing…' : `last phrase, ${title}`, Rr, 2);
      if (!notes.length) { g.font = `13px ${cs.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Play something. Ghost notes appear here as you play.', (L + Rr) / 2, (T + B) / 2); }
    }
    return {
      opts: optsEl,
      frame(now) { sp.frame(now); const f = following(); if (dirty || f || wasF || input.capture.live()) { dirty = false; drawRoll(now); } wasF = f; },
      update() { sp.setKey(store.get().key); tk?.keyed(); paintOpts(); dirty = true; },
      refresh() { dirty = true; },
      destroy() { for (const o of offs2) o(); tk?.destroy(); if (!tk) input.qwerty.dock?.(null); },
    };
  }

  // A touch screen's keyboard: one octave of the song's key (C major when it has none), so nothing is out of key; with
  // Scale lock off (input.qwerty.scaleLock, shared with musical typing), all twelve notes, the ones out of the key dimmed.
  // Pointer events, a finger each (multi-touch); a finger slid onto the next key plays it; lower on a key is louder.
  // Notes play and are captured like musical typing (src 'touch'), snapped the same way: musical typing's line sits
  // over the keys ("Snapping to 1/16, in C minor", input/qwerty.js snapLine), each part a tap that turns its helper off
  // and on, so what the keys do to what you play is in view whenever they are, a take recording or not.
  // The register a track plays in: the middle of its notes (the median), or what its instrument is for; the keyboard
  // starts on the octave of the song's key that holds it (a bass part three octaves up was the A4 default's doing)
  function registerOf(t) {
    if (!t) return 62;
    const ps = [];
    for (const c of t.clips || []) if (!c.mute) for (const n of c.notes || []) ps.push(n.p);
    if (ps.length) { ps.sort((a, b) => a - b); return ps[Math.floor(ps.length / 2)]; }
    const what = `${t.name || ''} ${t.instrument?.device || ''}`;
    return /bass|sub\b|808/i.test(what) ? 40 : /pad|string|choir|organ/i.test(what) ? 60 : 62;
  }
  function touchKeys() {
    let octave = 4, sig = '', forTrack = null;
    const held = new Map();   // pointerId -> { p, k }
    const keysEl = h('div.sk-tk-keys', { role: 'group', 'aria-label': 'Keyboard: an octave in the song’s key' });
    const octL = h('span.sk-tk-oct');
    const snap = input.qwerty.snapLine({ touch: true });
    const step = (d) => { octave = clamp(octave + d, 0, 7); build(); };
    // the target track's own register: on first show and whenever the keys play another track (a picked octave stays
    // while the track does)
    function fitTrack() {
      const t = input.target();
      const id = t ? t.id : null;
      if (id === forTrack) return false;
      forTrack = id;
      const root = parsePc(keyOf().root), mid = registerOf(t);
      // the octave of the key (root .. root + 12) with the track's middle note nearest its centre
      octave = clamp(Math.round((mid - root - 6) / 12) - 1, 0, 7);
      return true;
    }
    const el = h('div.sk-tk',
      h('div.sk-tk-bar', h('button.btn.sk-tk-o', { onclick: () => step(-1), 'aria-label': 'Octave down' }, '−'), octL, h('button.btn.sk-tk-o', { onclick: () => step(1), 'aria-label': 'Octave up' }, '+'), snap.el),
      keysEl);
    const keyOf = () => store.get().key || { root: 'C', scale: 'major' };
    const locked = () => input.qwerty?.scaleLock !== false;
    function pitches() {
      const key = keyOf(), root = parsePc(key.root), base = (octave + 1) * 12 + root;
      if (!locked()) return Array.from({ length: 13 }, (_, i) => base + i);
      const deg = [...new Set(scalePcs(key).map((pc) => (pc - root + 12) % 12))].sort((a, b) => a - b);
      return [...deg.map((d) => base + d), base + 12];
    }
    function build() {
      releaseAll();
      const key = keyOf(); sig = `${key.root} ${key.scale} ${locked()}`;
      const ps = pitches(), pcs = new Set(scalePcs(key));
      // (each key spelled for the song's key: C minor's Eb, Ab, Bb, as the piano roll writes them; the line says the key)
      const nm = (p) => spellNote(p, key);
      octL.textContent = `${nm(ps[0])}–${nm(ps[ps.length - 1])}`;
      keysEl.setAttribute('aria-label', locked() ? `Keyboard: an octave of ${keyLabel(key)}` : 'Keyboard: an octave, every note');
      snap.paint();
      keysEl.replaceChildren(...ps.map((p, i) => h('button.sk-tk-k' + (i === 0 || i === ps.length - 1 ? '.root' : '') + (pcs.has(((p % 12) + 12) % 12) ? '' : '.out'), { dataset: { p: String(p) }, tabindex: '-1', 'aria-label': nm(p) },
        h('b', nm(p).replace(/-?\d+$/, '')), h('small', nm(p)))));
    }
    const vel = (k, y) => { const r = k.getBoundingClientRect(); return Math.round(clamp(0.4 + 0.6 * (y - r.top) / Math.max(1, r.height), 0.35, 1) * 100) / 100; };
    function down(id, k, y) { const p = Number(k.dataset.p); held.set(id, { p, k }); k.classList.add('on'); input.noteOn('touch' + id, p, vel(k, y), 'touch'); }
    function up(id) { const x = held.get(id); if (!x) return; held.delete(id); if (![...held.values()].some((o) => o.k === x.k)) x.k.classList.remove('on'); input.noteOff('touch' + id, x.p, 'touch'); }
    function releaseAll() { for (const id of [...held.keys()]) up(id); }
    keysEl.addEventListener('pointerdown', (e) => {
      const k = e.target.closest?.('.sk-tk-k'); if (!k) return;
      e.preventDefault();
      try { keysEl.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      up(e.pointerId); down(e.pointerId, k, e.clientY);
    });
    keysEl.addEventListener('pointermove', (e) => {
      const x = held.get(e.pointerId); if (!x) return;
      const k = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sk-tk-k');
      if (k && k !== x.k && keysEl.contains(k)) { up(e.pointerId); down(e.pointerId, k, e.clientY); }
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) keysEl.addEventListener(t, (e) => up(e.pointerId));
    keysEl.addEventListener('contextmenu', (e) => e.preventDefault());
    fitTrack();
    build();
    // (keyed: the song's key, Scale lock or the grid may have changed; the line says so either way)
    return { el, keyed() { const key = keyOf(); if (`${key.root} ${key.scale} ${locked()}` !== sig) { forTrack = null; fitTrack(); build(); } else snap.paint(); }, retarget() { if (fitTrack()) build(); }, destroy: releaseAll, get octave() { return octave; } };
  }

  /* ======================================================== RECORD */
  function recView() {
    const audio = input.audio;
    const sp = createSpiral({ lo: 28, hi: 88, key: store.get().key, tuner: true });
    const meter = h('div.sk-meter', h('i.sk-meter-fill'), h('i.sk-meter-peak'), h('span.sk-meter-clip', 'CLIP'));
    const side = h('div.sk-recside');
    body.append(h('div.sk-spiral', sp.el), side);
    // (Record itself is the strip's, below: the mic onto the audio track it names)
    const status = h('div.sk-status', { role: 'status', 'aria-live': 'polite' });
    const tEl = h('span.sk-rectime');
    foot.append(status, tEl);
    const optsEl = h('div.sk-opts');
    let devs = [], calib = null;
    async function loadDevs() { devs = await audio.devices(); paintOpts(); }
    // One picker: the device and channel are the record track's Input (track.input, the one the recorder opens and the
    // Inspector shows); with no audio track yet, they are the picker a new one starts from
    function setInput(patch) {
      const t = audio.recordTrack();
      const err = (e) => ui.toast(e.message, { kind: 'bad' });
      if (!t) { (patch.device != null ? audio.setDevice(patch.device) : audio.setChannel(patch.channel))?.catch?.(err); return; }
      const was = t.input || { device: 'default', channel: 1 };
      const next = { ...was };
      if (patch.device != null) next.device = patch.device || 'default';
      if (patch.channel != null) next.channel = /^\d+$/.test(String(patch.channel)) ? +patch.channel : String(patch.channel);
      const r = store.dispatch({ type: 'track.set', track: t.id, patch: { input: next } }, { by: 'you', label: `input for ${t.name}` });
      if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return; }
      if (audio.state.open) { try { audio.openFor(store.track(t.id))?.catch?.(err); } catch (e) { err(e); } }
      paintOpts();
    }
    function paintOpts() {
      const st = audio.state, t = audio.recordTrack();
      const cur = t && audio.inputOf ? audio.inputOf(t) : { device: st.deviceId, channel: st.channel };
      const of = t ? ` of ${t.name}` : '';
      const dsel = h('select.sk-select.sk-indev', { 'aria-label': `Input${of}`, title: t ? `${t.name} records from this input (its Input in the Inspector too)` : 'The input a new audio track records from', onchange: () => setInput({ device: dsel.value }) }, h('option', { value: '' }, 'Default input'), ...devs.filter((d) => d.id && d.id !== 'default').map((d) => h('option', { value: d.id }, d.label)));
      dsel.value = cur.device && devs.some((d) => d.id === cur.device) ? cur.device : '';
      const nCh = Math.min(32, Math.max(2, st.channels || 2, parseInt(cur.channel, 10) || 0));
      const csel = h('select.sk-select.sk-inch', { 'aria-label': `Channel${of}`, onchange: () => setInput({ channel: csel.value }) }, ...Array.from({ length: nCh }, (_, i) => h('option', { value: String(i + 1) }, `Input ${i + 1}`)), h('option', { value: 'both' }, 'Both (mono)'), h('option', { value: 'stereo' }, 'Stereo 1+2'));
      csel.value = String(cur.channel || '1');
      optsEl.replaceChildren(dsel, csel);
    }
    function paintSide() {
      const st = audio.state, t = audio.recordTrack(), lat = audio.latency, m = lat.measured;
      if (calib) { side.replaceChildren(calib.el); return; }
      if (!st.open) {
        side.replaceChildren(h('div.sk-explain.small',
          h('p', h('b', 'Plug in a guitar, a bass or a mic.'), ' The browser asks first. Overdub turns its voice processing off, so your instrument sounds like itself.'),
          h('button.btn.btn-go', { onclick: async () => { try { await audio.open(); try { localStorage.setItem(MIC_OK, '1'); } catch (e) { /* ok */ } loadDevs(); } catch (e) { ui.toast(e.message, { kind: 'bad' }); } } }, 'Open the input'),
          st.error ? h('p.sk-err', st.error) : null));
        return;
      }
      const fx = t ? t.inserts.map((i) => app.devices.getDevice?.(i.device)?.name || i.device.split('.').pop()) : [];
      side.replaceChildren(
        h('div.sk-row', h('span.sk-lbl', st.label || 'Input'), meter),
        h('div.sk-row', t ? h('span.sk-lbl', `Onto ${t.name}`) : h('span.ew-muted', 'No audio track yet: Record makes one.'), t ? h('span.sk-arm' + (t.arm ? '.on' : ''), { title: t.arm ? 'Armed' : 'Not armed' }, t.arm ? 'armed' : 'not armed') : null),
        t && fx.length ? h('div.sk-chain', { title: 'What you hear when monitoring: the track’s inserts, in order' }, h('span.t3', 'Through '), fx.map((n, i) => [i ? h('span.sk-arrow', i === fx.length - 1 ? ' and ' : ', ') : null, h('span.sk-fx', n)])) : '',   // (not null: the native replaceChildren would print "null")
        h('div.sk-row', chip(st.monitoring ? 'Monitoring' : 'Monitor', st.monitoring, () => audio.monitor(), 'Hear the input through the track’s pedals and amp. Use headphones with a mic.'),
          st.monitoring ? h('span.sk-hint', 'Use headphones with a mic.') : null),
        h('div.sk-row.sk-lat', h('span', m ? `Round trip ${fmtMs(m.ms)} ms, measured` : `Round trip ~${Math.round(lat.estimate() * 1000)} ms, the browser’s guess`),
          h('button.btn.btn-txt', { onclick: () => { calib = calibView(); paintSide(); } }, m ? 'Recalibrate' : 'Calibrate')));
    }
    function calibView() {
      const dots = h('div.sk-dots', Array.from({ length: 8 }, (_, i) => h('i' + (i < 2 ? '.w' : ''))));
      const res = h('p.sk-calres', 'Clap, tap or mute-strum on each click (the first two are a warm-up). Or loop an output back into the input and send chirps.');
      const use = h('button.btn.btn-go', { disabled: true, onclick: () => { if (last && last.ok) { audio.latency.set(Math.max(0, last.ms), { how: last.how, spread: last.spread ?? last.agree }); ui.toast(`Using ${fmtMs(Math.max(0, last.ms))} ms for ${audio.state.label || 'this input'}.`, { kind: 'ok' }); calib = null; paintSide(); } } }, 'Use this');
      let last = null, sig = null;
      const run = async (how) => {
        if (sig) { sig.stop = true; return; }
        sig = {}; last = null; use.disabled = true;
        for (const d of dots.children) d.className = d.className.replace(/ ?(lit|got|miss)/g, '');
        res.textContent = how === 'tap' ? 'Listen… then play on every click.' : 'Sending three chirps…';
        try {
          last = await audio.latency.measure({ how, sig, onStep: (s) => { const d = dots.children[s.i]; if (!d) return; if (s.click) d.classList.add('lit'); else d.classList.add(s.ms == null ? 'miss' : 'got'); } });
        } catch (e) { res.textContent = e.message; }
        sig = null;
        if (!last) { res.textContent = 'Stopped.'; return; }
        res.textContent = last.ok ? `${fmtMs(last.ms)} ms round trip${how === 'tap' ? ` (spread ${Math.round(last.spread)} ms over ${last.used} hits)` : ` (${last.found} of 3 chirps agree)`}. Use it?`
          : how === 'tap' ? `Only ${last.used || 0} clear hits${Number.isFinite(last.spread) ? `, ${Math.round(last.spread)} ms apart` : ''}. Try again, right on the click.` : 'The chirps weren’t found. Check the cable (or hold the mic at the speaker) and try again.';
        use.disabled = !last.ok;
      };
      const el = h('div.sk-calib', h('div.sk-row', h('b', 'Line up your timing'), h('button.btn.btn-txt', { style: { marginLeft: 'auto' }, onclick: () => { if (sig) sig.stop = true; calib = null; paintSide(); } }, 'Back')),
        h('div.sk-row', h('button.btn', { onclick: () => run('tap') }, 'Tap along'), h('button.btn', { onclick: () => run('loop') }, 'Loopback'), dots, use), res);
      return { el };
    }
    function paintFoot() {
      const st = audio.state;
      if (st.recording) status.replaceChildren(h('span.sk-live.rec', 'Recording'), ` to ${audio.recordTrack()?.name || 'the track'}.`);
      else if (st.open) status.replaceChildren(h('span.ew-muted', 'Records from the marker. The round trip is taken off, so it lands where you played it.'));
      else status.replaceChildren(h('span.ew-muted', 'Open the input to see the meter and tune up.'));
    }
    paintOpts(); paintSide(); paintFoot();
    if (audio.state.open) loadDevs();
    let recAt = 0;
    const offs3 = [input.on('devices', () => loadDevs()), input.on('audio', () => { if (audio.state.recording && !recAt) recAt = performance.now(); if (!audio.state.recording) recAt = 0; paintSide(); paintFoot(); paintOpts(); }), audio.latency.onChange(() => paintSide())];
    const fill = meter.querySelector('.sk-meter-fill'), peakEl = meter.querySelector('.sk-meter-peak'), clipEl = meter.querySelector('.sk-meter-clip');
    return {
      opts: optsEl,
      frame(now) {
        if (audio.state.open) {
          const l = audio.level();
          fill.style.transform = `scaleX(${l.lvl.toFixed(3)})`;
          peakEl.style.left = `${(l.lvl * 100).toFixed(1)}%`;
          clipEl.classList.toggle('on', l.clip);
          const tu = audio.tune();
          sp.push(tu ? tu.midi : null, { conf: tu ? tu.conf : 0 });
        }
        sp.frame(now);
        tEl.textContent = recAt ? fmtTime((now - recAt) / 1000) : '';
      },
      update(evt) { sp.setKey(store.get().key); if (!calib) paintSide(); if (!evt || !evt.ops || evt.ops.some((o) => o.type.startsWith('track.'))) paintOpts(); },
      refresh() {},
      destroy() { for (const o of offs3) o(); },
    };
  }

  /* ---------------------------------------------------------------- ideas (the capture log) */
  let ideasDirty = true;
  function paintIdeas() {
    ideasDirty = false;
    // this song's takes first (the last half hour, then earlier); another song's are kept, listed apart, and say whose
    const all = input.capture.list({ all: true }), since = Date.now() - 30 * 60 * 1000;
    const mine = all.filter(ofSong).slice(0, 60), others = all.filter((p) => !ofSong(p)).slice(0, Math.max(0, 60 - mine.length));
    const list = [...mine, ...others];
    const recent = mine.filter((p) => p.at >= since).length;
    ideasCount.textContent = mine.length ? String(mine.length) : '';
    ideasCount.title = `${mine.length} in this song${others.length ? `, ${others.length} from other songs` : ''}`;
    if (!list.length) {
      const next = mode === 'tap' ? ['hum', 'Hum a tune'] : ['tap', 'Tap a beat'];
      ideasList.replaceChildren(h('div.sk-ideas-empty.empty', h('p', 'No takes yet. Hum, tap or play, and every take lands here and stays.'), h('button.btn', { type: 'button', onclick: () => setMode(next[0]) }, next[1])));
      return;
    }
    // the list is drawn fresh: a focused button (Keep, Band, Agent) hands focus to the same one on its take's new card
    const a = document.activeElement, was = a && a !== ideasList && ideasList.contains(a) ? a.closest('.sk-idea') : null;
    const fid = was?.dataset.id, fcls = was ? ['sk-put', 'sk-keep', 'band-btn', 'ew-btn-agent'].find((c) => a.classList.contains(c)) : null;
    const fi = was ? [...was.querySelectorAll('button')].indexOf(a) : -1;
    // take numbers count up through the song (the first take is 1); another song's count through theirs
    const cards = [...mine.map((p, i) => ideaCard(p, mine.length - i, i === 0)), ...others.map((p, i) => ideaCard(p, others.length - i, false))];
    if (others.length) cards.splice(mine.length, 0, h('div.sk-older.sk-other-h', { title: 'Takes made in other songs: still kept, never wiped. Keep one to bring it into this song.' }, mine.length ? 'From other songs' : 'No takes in this song yet. From other songs'));
    if (recent < mine.length && recent > 0) cards.splice(recent, 0, h('div.sk-older', 'Earlier'));
    ideasList.replaceChildren(...cards);
    if (was && !ideasList.contains(document.activeElement)) {
      const c = cards.find((x) => x.dataset?.id === fid);
      const b = c && ((fcls && c.querySelector('.' + fcls)) || c.querySelectorAll('button')[fi] || c.querySelector('button'));
      b?.focus({ preventScroll: true });
    }
  }
  // A take is a row on the sheet: its number, big; who made it and how ("tapped by you"); a mini roll; what's in it;
  // Hear, Keep, Band (once kept) and Agent. The newest take of this song is set full; the rest step back to pencil.
  function ideaCard(p, n, newest) {
    const pn = input.capture.phraseNotes(p.id);
    const mini = canvas('sk-mini');
    const other = !ofSong(p);
    const kept = other ? null : keptOn(p);
    const keptT = kept && store.track(kept.track);
    const bits = p.kind === 'audio' ? [`${(p.seconds || 0).toFixed(1)} s`] : [`${pn.notes.length} ${p.kind === 'drums' ? 'hits' : 'notes'}`, `${pn.bars} bar${pn.bars === 1 ? '' : 's'}`];
    if (p.moved) bits.push(`${p.moved} snapped`);
    if (p.low) bits.push(`${p.low} unsure`);
    if (keptT) bits.push(`kept on ${keptT.name}`);
    // in the song (recorded with R, or kept): where, and a click shows it; else Put it in the song is its first action
    const ins = other ? null : inSongOf(p, pn);
    const canPut = !other && !ins && !p.rec && p.kind !== 'audio' && pn.notes.length > 0;
    const card = h('div.sk-idea' + (other ? '.sk-other' : '') + (newest ? '.sk-new' : ''), { role: 'listitem', dataset: { id: p.id }, title: p.label || null },
      h('span.sk-idea-n.num', { 'aria-hidden': 'true' }, String(n)),
      h('div.sk-idea-body',
        h('div.sk-idea-top', h('span.sk-idea-who', `${SRC_VERB[p.src] || 'made'} by `, byline(p.by || 'you', { app })), h('span.sk-ago.mono', ago(p.at))),
        mini.cv,
        h('div.sk-idea-meta.mono', bits.join(', ')),
        other ? h('div.sk-idea-from', p.songTitle ? `from “${p.songTitle}”` : 'from an earlier song') : null,
        ins ? h('button.btn.btn-txt.sk-insong', { type: 'button', title: 'Show it in the arranger', onclick: () => revealIn(ins) }, `in the song: ${ins.track.name}, ${ins.bars}`) : null),
      // (the actions run the card's whole width, under the numeral too: beside it, a 236 px column cut them off)
      h('div.sk-idea-act',
          canPut ? h('button.btn.sk-put', { type: 'button', onclick: () => putIn(p.id), title: p.beat != null ? 'Put it in the song at the beats where you played it' : 'Put it in the song at the marker’s bar' }, newest && !touch ? ['Put it in the song ', h('kbd', '⇧R')] : 'Put it in the song') : null,
          p.kind === 'audio' ? hearBtnFor(p.id, 'Hear it', () => hearAudio(p.audio, p.id)) : hearBtnFor(p.id, 'Hear it', () => hear(pn.notes, p.track, { drums: p.kind === 'drums', id: p.id })),
          p.audio && p.kind !== 'audio' ? hearBtnFor(p.id + ':me', 'Hear what you hummed', () => hearAudio(p.audio, p.id + ':me')) : null,
          p.kind === 'audio' ? null : h('button.btn.sk-keep', { type: 'button', onclick: (e) => keepMenu(e.currentTarget, p), title: 'Keep it as a clip on a track you pick', 'aria-haspopup': 'menu' }, 'Keep on…', icon('down', { size: 11 })),
          kept && p.kind !== 'audio' ? app.band?.button?.({ track: kept.track, clip: kept.clip }) : null, // "Build a band around it" (agent/arrange-tool.js)
          h('button.btn.ew-btn-agent', { type: 'button', onclick: () => toAgent(p.id), title: 'Hand it to the agent' }, icon('agent', { size: 13 }), 'Agent')));
    requestDraw.add(() => drawMini(mini, p, pn));
    return card;
  }
  // where a take is in the song: a take recorded with R (its clips in the take group, or the clip its hits layered
  // into), or one kept from here; null once undone
  function inSongOf(p, pn) {
    const bpb = bpbNow();
    if (p.rec && p.track) {
      const t = store.track(p.track);
      if (!t) return null;
      if (p.kind === 'audio') {
        const cs = t.clips.filter((c) => c.asset && c.asset === p.audio);
        if (!cs.length) return null;
        const c = cs.find((x) => !x.mute) || cs[0];
        return { track: t, clip: c, bars: barsOf(bpb, Math.min(...cs.map((x) => x.start)), Math.max(...cs.map((x) => x.start + x.length))) };
      }
      const s0 = p.beat ?? 0, e0 = s0 + Math.max(1, pn.bars || 1) * bpb;
      const cs = t.clips.filter((c) => c.start < e0 - 1e-6 && c.start + c.length > s0 + 1e-6);
      let c = cs.find((x) => x.take && x.take === p.take && !x.mute) || cs.find((x) => x.take && x.take === p.take);
      if (!c) {
        // layered: the clip that has this pass's first hit, signed by you
        const n0 = (p.notes || [])[0];
        c = n0 ? cs.find((x) => (x.notes || []).some((n) => n.p === n0.p && Math.abs(x.start + n.t - (s0 + n0.t)) < 1e-3)) : null;
      }
      return c ? { track: t, clip: c, bars: barsOf(bpb, s0, e0) } : null;
    }
    const k = keptOn(p);
    if (!k) return null;
    const t = store.track(k.track), c = store.clip(k.track, k.clip);
    return t && c ? { track: t, clip: c, bars: barsOf(bpb, c.start, c.start + c.length) } : null;
  }
  function revealIn(ins) {
    ui.select({ track: ins.track.id, clip: ins.clip.id, notes: [] });
    try { app.arranger?.reveal?.(ins.clip.start); } catch (e) { /* no arranger */ }
  }
  // Put it in the song (Shift+R for the newest): at the beats it was played on, or the marker's bar
  function putIn(id) {
    const r = rec.capture(id);
    if (r && r.ok) refocusKeep(id);
    return r;
  }
  // one primary per region: the newest take's Put is the go button unless the stage already shows one
  function syncGo() {
    const put = ideasList.querySelector('.sk-idea.sk-new .sk-put');
    if (!put) return;
    const acts = root.querySelector('.sk-acts');
    const stageGo = !!(acts && !acts.hidden && acts.querySelector('.btn-go:not([disabled])'));
    if (put.classList.contains('btn-go') === stageGo) put.classList.toggle('btn-go', !stageGo);
  }
  const requestDraw = new Set();
  function drawMini(mini, p, pn) {
    mini.fit();
    const g = mini.g, w = mini.w, H = mini.h, cs = colorsOf();
    g.clearRect(0, 0, w, H);
    g.fillStyle = withA(cs.text, 0.03); g.fillRect(0, 0, w, H);
    const notes = pn.notes, bpb = beatsPerBar(store.get().meter);
    if (p.kind === 'audio') { g.strokeStyle = withA(cs.human, 0.7); g.beginPath(); for (let x = 4; x < w - 4; x += 3) { const a = (Math.sin(x * 0.37) * Math.sin(x * 0.051) * 0.5 + 0.5) * (H / 2 - 4); g.moveTo(x, H / 2 - a); g.lineTo(x, H / 2 + a); } g.stroke(); return; }
    if (!notes.length) return;
    const span = Math.max(bpb, pn.bars * bpb), ps = notes.map((n) => n.p);
    const lo = Math.min(...ps) - 1, hi = Math.max(...ps) + 1, rh = Math.max(2, Math.min(5, (H - 6) / (hi - lo + 1)));
    const fill = colorOf(p.kept?.length ? p.kept[p.kept.length - 1].track : p.track);
    for (let b = bpb; b < span; b += bpb) { g.fillStyle = withA(cs.line2, 0.6); g.fillRect(4 + (b / span) * (w - 8), 3, 1, H - 6); }
    for (const n of notes) {
      const x = 4 + (n.t / span) * (w - 8), ww = Math.max(2, (n.d / span) * (w - 8) - 1);
      const y = p.kind === 'drums' ? 3 + (ROWS.findIndex((r) => r.p === n.p) + 0.5) * ((H - 6) / ROWS.length) - 1.5 : H / 2 + ((hi + lo) / 2 - n.p) * rh - rh / 2;
      g.fillStyle = fill; g.globalAlpha = 0.5 + 0.5 * (n.v ?? 0.8);
      g.fillRect(x, y, p.kind === 'drums' ? 3 : ww, p.kind === 'drums' ? 3 : rh - 0.5);
      g.globalAlpha = 1;
    }
  }
  let menu = null, menuBtn = null;
  function keepMenu(btn, p) {
    closeMenu();
    menuBtn = btn;
    const sel = destSelect(aimKindOf(p), p.track, { all: true });
    const opts = [...sel.querySelectorAll('option')];
    menu = h('div.sk-menu', { role: 'menu', 'aria-label': 'Keep it on' }, h('div.sk-menu-h', 'Keep it on'), opts.map((o) => h('button', { role: 'menuitem', class: o.value === sel.value ? 'def' : '', onclick: () => { closeMenu(); keepTo(p.id, o.value); refocusKeep(p.id); } }, o.textContent)));
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('button[role=menuitem]')], i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); items[e.key === 'Home' ? 0 : items.length - 1]?.focus(); }
      else if (e.key === 'Tab') closeMenu(true);
    });
    document.body.append(menu);
    const r = btn.getBoundingClientRect(), mh = menu.offsetHeight, mw = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw))}px`;
    menu.style.top = `${r.top - mh - 6 > 8 ? r.top - mh - 6 : r.bottom + 6}px`;
    (menu.querySelector('.def') || menu.querySelector('button[role=menuitem]'))?.focus();
    setTimeout(() => window.addEventListener('pointerdown', outside, true), 0);
  }
  const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); };
  // restore: focus goes back to the Keep that opened the menu (Escape, Tab), not to the top of the page
  function closeMenu(restore = false) {
    const had = menu && menu.contains(document.activeElement);
    if (menu) { menu.remove(); menu = null; }
    window.removeEventListener('pointerdown', outside, true);
    if (restore && had && menuBtn?.isConnected) menuBtn.focus({ preventScroll: true });
    menuBtn = null;
  }
  // After a keep the takes list is drawn again (the next frame), and the Keep that was pressed goes with it: focus
  // lands on the same take's new Keep, unless something else (the tour card) has taken it by then.
  function refocusKeep(id) {
    const lost = () => !document.activeElement || document.activeElement === document.body;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!lost()) return;
      const b = [...ideasList.querySelectorAll('.sk-idea')].find((c) => c.dataset.id === id)?.querySelector('.sk-keep');
      (b || document.querySelector('.ar-scroll'))?.focus({ preventScroll: true });
    }));
  }
  menuKeys();
  function menuKeys() { listen(() => closeMenu()); }

  listen(input.capture.on((e) => { if (e.what !== 'live') { ideasDirty = true; view?.kept?.(); } }));
  listen(input.on('take', () => { ideasDirty = true; }));

  setMode(mode);
  syncJam();
  let lastAgo = 0;
  return {
    frame(now) {
      registerHost();
      syncTrial();
      trackAlong();
      if (!following()) for (const x of root.querySelectorAll('.sk-rollwrap.follow')) x.classList.remove('follow');
      if (rec.state !== 'idle') { const L = rec.live(); if (L) recLive = L; }
      paintStrip();
      syncGo();
      if (ideasDirty) paintIdeas();
      if (requestDraw.size) { for (const f of requestDraw) f(); requestDraw.clear(); }
      if (now - lastAgo > 30000) { lastAgo = now; for (const c of ideasList.querySelectorAll('.sk-idea')) { const p = input.capture.get(c.dataset.id); const a = c.querySelector('.sk-ago'); if (p && a) a.textContent = ago(p.at); } }
      view && view.frame && view.frame(now);
    },
    update(evt) {
      // another song: Sketch is this one's, from its tracks (the "On <track>" targets) to its takes
      if (evt && evt.kind === 'load') { if (!input.hum.active) setMode(mode); ideasDirty = true; return; }
      view && view.update && view.update(evt); if (evt && evt.ops && evt.ops.some((o) => /^(track|clip)\./.test(o.type))) ideasDirty = true;
    },
    refresh() { view && view.refresh && view.refresh(); ideasDirty = true; },
    unmount() { if (hostSet && hostSet === app.sounds) { try { app.sounds?.setHost?.(null); } catch (e) { /* ok */ } } footRO?.disconnect(); input.sketchMode = null; view && view.destroy && view.destroy(); for (const o of offs) o(); closeMenu(); stopHear(); if (app.sketch && app.sketch.geom === sketchApi.geom) delete app.sketch; },
  };
}

/* ---------------------------------------------------------------- helpers */
let COLORS = null;
function colorsOf() {
  if (COLORS) return COLORS;
  COLORS = { bg: tok('--bg') || '#141210', disp: tok('--font-display') || 'sans-serif', text: tok('--text') || '#f4ead6', text2: tok('--text-2') || '#cbc0aa', text3: tok('--text-3') || '#9a8f7c', line: tok('--line') || '#2f2b25', line2: tok('--line-2') || '#46413a', human: tok('--human') || '#ffa043', accent: tok('--accent') || '#5fd08a', rec: tok('--rec') || '#e5484d', agent: tok('--agent') || '#4cc3ff', mono: tok('--font-mono') || 'monospace', ui: tok('--font-ui') || 'sans-serif' };
  return COLORS;
}
const pcsRoot = (key) => { const NAMES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }; return NAMES[key.root] ?? -1; };
function rr(g, x, y, w, h, r) { w = Math.max(0, w); h = Math.max(0, h); r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function ago(at) { const s = (Date.now() - at) / 1000; if (s < 50) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
const fmtMs = (ms) => (ms >= 100 ? String(Math.round(ms)) : ms.toFixed(1));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const CSS = `
.sk [hidden] { display: none !important; }
/* the record strip: the footer's last row, one line (it wraps only in a narrow pane); a touch screen's Each pass,
   count-in and click are a row of their own under the mode's options */
.sk-strip { display: flex; flex: 1 0 100%; align-items: center; gap: 8px 12px; min-width: 0; flex-wrap: wrap; }
/* its controls keep their width (shrunk, a field ran into the next: "Drums ⌄Layer New ta■Count-in" while recording);
   the line saying what it records onto is the one that gives way */
.sk-strip > *, .sk-strip .sk-recopts > * { flex: none; }
.sk-recopts { display: contents; }
.sk.touch .sk-recopts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; min-width: 0; }
.sk.touch .sk-recopts .sk-chip, .sk.touch .sk-recopts .sk-seg, .sk.touch .sk-recopts .sk-seg button { height: 40px; }
.sk.touch .sk-recopts .sk-field > small { font-size: 12px; }
@container sketch (min-width: 641px) { .sk.touch .sk-body { flex-wrap: wrap; } .sk.touch .sk-body > .sk-recopts { flex: 1 0 100%; } }
.sk-field { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.sk-field > small { font-size: 11px; line-height: 1.2; color: var(--text-3); white-space: nowrap; }
.sk-strip .sk-seg button, .sk-strip .sk-chip, .sk-acts .btn, .sk-foot .btn { white-space: nowrap; }
.sk-strip .sk-seg { flex: none; }
/* a pane under 1000 px: the strip's small labels go (the controls say it: aria-labels and titles carry them) */
@container sketch (max-width: 1000px) { .sk-strip .sk-field > small { display: none; } }
/* a narrow pane (1280 × 720 with the agent open): the strip keeps one line by leaving the count-in and the click to the
   top bar (they are there, a hand's width away), and a take's Keep goes where its select says without showing it
   (its card's Keep on… picks), so the footer stays two rows and the canvas keeps its room */
@container sketch (max-width: 760px) and (min-width: 641px) {
  .sk-strip .sk-countin, .sk-strip .sk-click { display: none; }
  .sk-idea-act .sk-put kbd { display: none; }
  .sk-acts .sk-destwrap { display: none; }
}
/* a computer's pads: a row in the footer, after Beatbox, the beat's lamps first */
.sk-foot .sk-padcol { flex-direction: row; align-items: center; width: auto; gap: 10px; }
.sk-foot .sk-beats { height: auto; align-items: center; }
.sk-foot .sk-pads { display: flex; gap: 6px; max-height: none; }
.sk-foot .sk-pad { height: 34px; flex-direction: row; align-items: center; gap: 8px; padding: 0 9px; }
.sk-foot .sk-pad kbd { position: static; }
.sk-foot .sk-pad small { display: none; }
.sk-strip .sk-seg { height: 28px; }
.sk-strip .sk-seg button:disabled { opacity: .45; cursor: default; }
.sk-target { max-width: 180px; min-width: 72px; flex: 0 1 auto; }
/* Onto takes the room there is ("Melody, a new take" is long): it lines up from 100 px and grows to 200, so a long
   name never pushes the click onto a row of its own */
.sk-strip > .sk-onto { flex: 1 1 100px; max-width: 200px; min-width: 0; }
.sk-strip > .sk-onto .sk-target { flex: 1 1 auto; width: 100%; min-width: 0; max-width: none; }
.sk-recbtn { position: relative; height: 34px; padding: 0 14px 0 12px; gap: 8px; font-size: 13px; flex: none; }
.sk-recbtn kbd { margin-left: 2px; }
.sk-recbtn.on, .sk-recbtn.counting { border-color: var(--rec); }
/* Hum it's big Hum button is its record button (R): the strip keeps Onto, not a second Record / Cancel / Stop */
.sk[data-mode="hum"] .sk-strip .sk-recbtn { display: none; }
.sk-recbtn.on .sk-dot { background: var(--rec); box-shadow: 0 0 6px color-mix(in srgb, var(--rec) 70%, transparent); }
.sk-recbtn.on .sk-recbtn-l { color: var(--rec); }
.sk-strip > .sk-recnote { flex: 1 1 0; min-width: 0; align-self: center; font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-recnote.rec { color: var(--rec); }
.sk-recnote:empty { display: none; }
/* the line after a pass: its own line under the canvas (nothing is drawn under it) */
.sk-rollwrap.follow .sk-cap { display: none; }
.sk-pass { flex: none; order: 2; padding: 2px 10px 3px; font-size: 11.5px; line-height: 15px; text-align: right; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-insong { display: inline-block; height: auto; min-height: 0; padding: 0; margin-top: 3px; font-size: 12px; text-align: left; color: var(--text-2); }
/* the sheet: the ways in | the stage (head, the canvas, the footer) | Takes. The footer runs under the ways in too, so
   the buttons and the record strip get the width (and a short pane keeps two rows of them, not four); the canvas row
   never goes under its minimum: a pane shorter than that scrolls rather than drawing labels over each other */
.sk { --sk-body-min: 104px; display: grid; grid-template-columns: 150px minmax(0, 1fr) 300px; grid-template-rows: auto minmax(var(--sk-body-min), 1fr) auto;
  grid-template-areas: "modes head ideas" "modes body ideas" "foot foot ideas"; min-height: 100%; }
.sk[data-mode="play"]:has(.sk-body.typing) { --sk-body-min: 112px; }
.sk-body.typing { padding-top: 4px; }
.sk-stage { display: contents; }
.sk-modes { grid-area: modes; }
.sk-head { grid-area: head; padding: 12px 20px 0; min-height: 40px; }
.sk-body { grid-area: body; padding: 10px 20px 0; }
.sk-foot { grid-area: foot; padding: 10px 20px 12px 18px; border-top: var(--rule); margin-top: 6px; }
/* (the footer stays at the bottom of the pane: in a pane too short for the minimum, the canvas scrolls under it, and
   Record is never off the bottom) */
@container sketch (min-width: 641px) {
  .sk-foot { position: sticky; bottom: 0; z-index: 4; background: var(--bg); }
  .sk-ideas { contain: size; }
  /* (the ways in never make the sheet taller: a pane too short for them scrolls them; fitRailNote() shows the note
     under them only in a column tall enough for all of it, never cut off at the footer) */
  .sk-modes { contain: size; }
  .sk-pad kbd { flex: none; }
}
@container sketch (max-width: 760px) and (min-width: 641px) { .sk-foot .sk-pad kbd { display: none; } .sk-foot .sk-pad { padding: 0 8px; } }
.sk-ideas { grid-area: ideas; }
[data-panel="sketch"] { container-type: inline-size; container-name: sketch; }
/* the ways in: a list of words; the open one is the pane's heading, in display italic */
.sk-modes { display: flex; flex-direction: column; min-height: 0; padding: 12px 12px 0 18px; border-right: var(--rule); overflow-y: auto; scrollbar-width: none; }
.sk-rail { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.sk-mode { display: block; padding: 3px 0; border: 0; background: none; color: var(--text-3); font: 600 14px/1.25 var(--font-ui); text-align: left; cursor: pointer; white-space: nowrap; }
.sk-mode:hover { color: var(--text-2); }
.sk-mode.on { color: var(--text); padding: 4px 0 5px; }
.sk-mode.on .sk-mode-l { font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 125%; font-variation-settings: var(--font-display-vars); font-size: 23px; line-height: 1; letter-spacing: -.02em; }
.sk-mode:focus-visible, .sk-draw:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
/* Draw a beat: another tab's way in, so an underlined word under the rail */
.sk-draw { align-self: flex-start; margin-top: 4px; padding: 2px 0; border: 0; background: none; color: var(--text-3); font: 600 13px/1.25 var(--font-ui); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--line-2); cursor: pointer; white-space: nowrap; }
.sk-draw:hover { color: var(--text-2); text-decoration-color: currentColor; }
.sk-railnote { margin: auto 0 0; padding: 12px 0 14px; font-size: 11.5px; line-height: 1.45; color: var(--text-3); }
.sk-head { display: flex; align-items: center; gap: 14px; min-width: 0; }
.sk-blurb { margin: 0; flex: 1 1 0; min-width: 0; color: var(--text-2); font-size: 13px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-opts { display: flex; align-items: center; gap: 4px 12px; flex-wrap: nowrap; flex: 0 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.sk-small { font-size: 11.5px !important; color: var(--text-3) !important; }
/* a toggle: a word with a square lamp before it (the lamp is ::after, ordered first, so a phone's ::before target stays free) */
.sk-chip { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 2px; border: 0; border-radius: var(--r-press); background: none; color: var(--text-3); font: 600 12.5px/1 var(--font-ui); white-space: nowrap; cursor: pointer; }
.sk-chip::after { content: ''; order: -1; flex: none; width: 6px; height: 6px; background: var(--line-2); }
.sk-chip:hover { color: var(--text-2); }
.sk-chip.on { color: var(--text); }
.sk-chip.on::after { background: var(--accent-2); box-shadow: 0 0 6px color-mix(in srgb, var(--accent-2) 50%, transparent); }
.sk-chip:disabled { cursor: default; color: var(--text-3); }
.sk-chip:focus-visible, .sk-seg button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
/* the grid: two words, the one in use underlined in cream */
.sk-seg { display: inline-flex; gap: 8px; height: 28px; align-items: center; }
.sk-seg button { height: 28px; border: 0; background: none; color: var(--text-3); font: 600 11.5px var(--font-mono); padding: 0 2px; cursor: pointer; border-radius: 0; text-underline-offset: 7px; text-decoration-thickness: 2px; }
.sk-seg button:hover { color: var(--text-2); }
.sk-seg button.on { color: var(--text); text-decoration-line: underline; text-decoration-color: var(--text); }
.sk-opts .sk-select { flex: 0 1 auto; min-width: 64px; }
.sk-select { height: 28px; padding: 0 8px; border-radius: var(--r-press); border: var(--rule-2); background: var(--bg); color: var(--text); font: 600 12px var(--font-ui); max-width: 220px; }
.sk-body { display: flex; gap: 16px; min-height: 0; min-width: 0; }
.sk-spiral { flex: none; aspect-ratio: 1; height: 100%; max-height: 260px; min-height: 0; background: var(--bg); }
.sk-rollwrap { position: relative; flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); border-top: var(--rule-2); border-bottom: var(--rule); overflow: hidden; }
.sk-cv { position: relative; flex: 1 1 auto; min-height: 0; order: 1; }
.sk-roll, .sk-grid { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.sk-explain { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; align-items: flex-start; justify-content: safe center; gap: 8px; padding: 10px 18px; overflow: auto; background: var(--bg); }
.sk-explain.small { position: static; background: none; padding: 4px 2px; }
.sk-explain p { margin: 0; max-width: 520px; line-height: 1.5; font-size: 13px; color: var(--text-2); }
.sk-explain p b { color: var(--text); font-weight: 600; }
.sk-explain .sk-said { color: var(--text); }
.sk-explain .btn { white-space: nowrap; flex: none; margin: 2px 0; }
.sk-explain.tight { padding: 6px 14px; gap: 6px; }
.sk-explain.tight p { font-size: 12px; line-height: 1.4; }
.sk-explain.tight .sk-small { display: none; }
.sk-explain .sk-short, .sk-explain.tighter .sk-more { display: none; }
.sk-explain.tighter .sk-short { display: block; }
.sk-err { color: var(--bad) !important; }
.sk-foot { display: flex; align-items: center; gap: 10px 12px; min-width: 0; flex-wrap: wrap; }
/* the take button: a square-cornered button with a record lamp; lit (red) while it takes */
.sk-big { position: relative; height: 34px; padding: 0 14px 0 12px; gap: 8px; font-size: 13px; flex: none; }
.sk-big kbd { margin-left: 2px; }
.sk-dot { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--rec) 55%, var(--line-2)); }
.sk-big.on { border-color: var(--rec); }
.sk-big.on .sk-dot { background: var(--rec); box-shadow: 0 0 6px color-mix(in srgb, var(--rec) 70%, transparent); }
.sk-rectime { font: 600 11px var(--font-mono); color: var(--text-2); min-width: 0; }
.sk-type.on { border-color: var(--text); }
.sk-type.on::before { content: ''; width: 6px; height: 6px; background: var(--accent-2); box-shadow: 0 0 6px color-mix(in srgb, var(--accent-2) 50%, transparent); }
.sk-status { flex: 1 1 200px; min-width: 0; font-size: 12.5px; color: var(--text-2); line-height: 1.4; }
.sk-status b { color: var(--text); font-weight: 600; }
/* Play it's line in the footer: one line (the whole of it is its title) */
.sk-foot > .sk-status { flex: 1 1 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-midinote { font-size: 12px; color: var(--text-2); line-height: 1.35; min-width: 0; }
.sk-live { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text); }
.sk-live::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--rec); box-shadow: 0 0 6px color-mix(in srgb, var(--rec) 70%, transparent); }
.sk-live.rec { color: var(--rec); }
.sk-acts { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }
.sk-acts .btn-go { min-width: 64px; }
.sk-cap { flex: none; order: 0; padding: 5px 10px 1px; font-size: 12px; line-height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Tap's caption line on a computer: what the take is, then its Keep row, on one line over the grid */
.sk-capline { flex: none; order: 0; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 10px 1px; }
.sk-capline .sk-cap { flex: 1 1 auto; min-width: 0; padding: 0; }
.sk-capline .sk-acts { flex: none; gap: 6px; }
.sk-capline .sk-acts .btn { height: 24px; padding: 0 9px; font-size: 12px; }
.sk-capline .sk-acts .btn-go { min-width: 0; }
.sk-capline .sk-destwrap { display: none; }
.sk-rollwrap.follow .sk-capline:not(:has(> .sk-pass:not([hidden]))) { display: none; }
/* Tap on a computer: the pass line is the caption while there is one (in place of what the take is: its card says it) */
.sk-capline .sk-pass { order: 0; flex: 1 1 auto; min-width: 0; padding: 0; line-height: 17px; text-align: left; }
.sk-capline:has(> .sk-pass:not([hidden])) > .sk-cap { display: none; }
.sk-ic { height: 24px; }
.sk-listen { position: absolute; right: 8px; top: 2px; z-index: 3; display: flex; gap: 10px; }
.sk-listen[hidden] { display: none; }
/* the first-visit explainer covers the roll; its caption waits underneath until the mic is open */
.sk-explain ~ .sk-cap { display: none; }
.sk-narrow { display: none; }
@container sketch (max-width: 1000px) { .sk-wide { display: none; } .sk-narrow { display: inline; } }
.sk-acts[hidden] { display: none; }
.sk-destwrap .sk-select { max-width: 160px; }
.sk-destwrap:empty { display: none; }
/* the agent's button: a plain button that carries the agent's stroke, not a wash */
.sk .btn.ew-btn-agent { background: none; border: var(--rule-2); color: var(--text); }
.sk .btn.ew-btn-agent:hover { border-color: var(--text-3); }
.sk .btn.ew-btn-agent svg { color: var(--agent); }
/* the pads: rule-edged keys with the letter that plays them */
.sk-padcol { flex: none; display: flex; flex-direction: column; gap: 8px; width: 220px; min-height: 0; }
.sk-pads { flex: 1 1 auto; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: minmax(36px, 1fr); gap: 8px; min-height: 0; max-height: 260px; }
/* the beat over the pads: the click's lamps */
.sk-beats { display: flex; align-items: flex-end; gap: 6px; height: 14px; flex: none; }
/* the beat band: the click you can see, over the canvas (over the pads on a touch screen). Lamps a beat (bar 1 wider)
   with their numbers, lit cream on the beat you hear, red-edged while a take records; the count-in's last bar in
   display numerals; one line of what is happening; the take's timing; the click's lamp */
.sk-band { flex: none; display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; min-width: 0; padding: 8px 10px 7px; border-bottom: var(--rule); }
.sk-band .sk-beats { height: auto; align-items: stretch; gap: 5px; }
.sk-band .sk-beats i { display: grid; place-items: center; width: 44px; height: 38px; border: 1px solid var(--line-2); color: var(--text-3); font: italic 800 16px/1 var(--font-display); font-variation-settings: var(--font-display-vars, normal); }
.sk-band .sk-beats i.one { width: 64px; }
.sk-band .sk-beats i.now { background: var(--text); border-color: var(--text); color: var(--bg); box-shadow: 0 0 8px color-mix(in srgb, var(--text) 35%, transparent); }
.sk-band .sk-beats.rec i.now { border-color: var(--rec); box-shadow: 0 0 0 2px var(--rec), 0 0 8px color-mix(in srgb, var(--rec) 45%, transparent); }
.sk-band .sk-counting { font: italic 800 38px/1 var(--font-display); font-variation-settings: var(--font-display-vars, normal); color: var(--text); min-width: 1.2ch; text-align: center; }
.sk-band .sk-counting:empty { display: none; }
/* (the beats waited out before the count-in's own bar: counted, dimmer) */
.sk-band .sk-counting.wait { color: var(--text-3); }
.sk-band .sk-where { flex: 1 1 220px; min-width: 0; font-size: 12.5px; line-height: 1.35; color: var(--text-2); }
.sk-band .sk-timing { display: inline-flex; align-items: center; gap: 7px; flex: none; }
.sk-band .sk-timing:empty { display: none; }
.sk-band .sk-timing small { font-size: 11px; color: var(--text-3); }
.sk-band .sk-bclick { flex: none; }
.sk.touch .sk-band { padding: 6px 0; border-bottom: 0; }
.sk-head > .sk-band { flex: 1 1 auto; min-width: auto; flex-wrap: nowrap; gap: 12px; padding: 0; border: 0; }
.sk-head > .sk-band .sk-beats i { width: 36px; height: 30px; }
.sk-head > .sk-band .sk-beats i.one { width: 50px; }
.sk-head > .sk-band .sk-counting { font-size: 30px; }
/* (the line takes what room is left and no more: its width doesn't hold the band open over the mode's options) */
.sk-head > .sk-band .sk-where { flex: 1 1 0; width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; line-height: 1.25; }
.sk-rollcol { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 6px; }
/* a narrow stage (the full studio with its panes open): the lamps and the click stay, the line goes to the band's title,
   and the strip leaves its Click to the band */
@container sketch (max-width: 1000px) {
  .sk-head > .sk-band { flex: 0 1 auto; gap: 10px; }
  .sk-head > .sk-band .sk-where { display: none; }
  .sk-head > .sk-band .sk-beats i { width: 30px; height: 28px; font-size: 14px; }
  .sk-head > .sk-band .sk-beats i.one { width: 42px; }
  .sk[data-mode="tap"]:not(.touch) .sk-strip .sk-click, .sk[data-mode="hum"]:not(.touch) .sk-strip .sk-click { display: none; }
}
/* a phone: the band is one short row (its sentence is the line beside the snap chips' to say), so what to tap, the
   grid and the pads all fit above the pinned row */
.sk.touch .sk-band { flex-wrap: nowrap; padding: 0; gap: 8px; }
.sk.touch .sk-band .sk-where { display: none; }
.sk.touch .sk-band .sk-beats i { width: 34px; height: 24px; font-size: 13px; }
.sk.touch .sk-band .sk-beats i.one { width: 46px; }
.sk.touch .sk-band .sk-bclick { min-height: 24px; }
@media (prefers-reduced-motion: reduce) { .sk-band .sk-beats i { transition: none; } }
.sk-beats i { width: 12px; height: 12px; border: 1px solid var(--line-2); }
.sk-beats i.one { width: 18px; }
.sk-beats i.now { background: var(--text); border-color: var(--text); }
.sk-beats.rec i.now { border-color: var(--rec); }
.sk-pad { position: relative; display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; min-height: 0; padding: 8px 10px; border-radius: var(--r-press); border: var(--rule-2); background: none; color: var(--text); cursor: pointer; touch-action: none; user-select: none; -webkit-tap-highlight-color: transparent; }
/* (a pressed pad lights in the room's own cream, never the browser's blue tap flash: cool ink is the agent's) */
.sk-pad:focus:not(:focus-visible) { outline: none; }
.sk-pad-l { font-weight: 600; font-size: 13px; }
.sk-pad kbd { position: absolute; top: 8px; right: 8px; }
.sk-pad small { color: var(--text-3); font-size: 11px; }
.sk-pad:hover { border-color: var(--text-3); }
.sk-pad.hit, .sk-pad:active { border-color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.sk-recside { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; justify-content: center; }
.sk-row { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; min-width: 0; }
.sk-lbl { font-size: 12px; font-weight: 600; color: var(--text-2); max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-meter { position: relative; flex: 1; min-width: 120px; height: 10px; background: var(--bg); border: var(--rule-2); overflow: hidden; }
.sk-meter-fill { position: absolute; inset: 0; transform-origin: left; transform: scaleX(0); background: linear-gradient(90deg, var(--ok) 0%, var(--ok) 70%, var(--warn) 86%, var(--bad) 100%); background-size: 100% 100%; }
.sk-meter-peak { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text); left: 0; opacity: .8; }
.sk-meter-clip { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); font: 700 8px var(--font-mono); color: var(--bad); opacity: 0; }
.sk-meter-clip.on { opacity: 1; }
.sk-arm { font-size: 12px; font-weight: 600; color: var(--text-3); }
.sk-arm.on { color: var(--rec); }
.sk-chain { font-size: 12.5px; color: var(--text-2); }
.sk-fx { color: var(--text); font-weight: 600; }
.sk-arrow { color: var(--text-3); }
.sk-lat { font-size: 12px; color: var(--text-2); }
.sk-hint { font-size: 11.5px; color: var(--text-3); }
.sk-calib { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-top: var(--rule-2); border-bottom: var(--rule); }
.sk-dots { display: inline-flex; gap: 5px; }
.sk-dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
.sk-dots i.w { opacity: .6; }
.sk-dots i.lit { background: var(--accent-2); }
.sk-dots i.got { background: var(--ok); }
.sk-dots i.miss { background: var(--bad); }
.sk-calres { margin: 0; font-size: 12px; color: var(--text-2); }
/* Takes: a sheet head, then ruled rows; each take's number is set big */
.sk-ideas { display: flex; flex-direction: column; min-height: 0; padding: 14px 18px 0 20px; border-left: var(--rule); }
.sk-ideas-head { flex: none; }
.sk-count { font: 600 11.5px var(--font-mono); color: var(--text-3); }
.sk-ideas-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; padding-bottom: 10px; scrollbar-width: thin; }
.sk-ideas-empty { padding: 14px 0; }
.sk-older { padding: 12px 0 2px; font-size: 12px; color: var(--text-3); border-bottom: var(--rule); }
.sk-idea { display: grid; grid-template-columns: minmax(46px, max-content) minmax(0, 1fr); gap: 0 10px; padding: 11px 0; border-bottom: var(--rule); }
.sk-idea-n { font-size: 30px; color: var(--text-3); padding-top: 1px; white-space: nowrap; }
.sk-idea.sk-new .sk-idea-n { font-size: 44px; color: var(--text); }
.sk-idea-body { min-width: 0; }
.sk-idea-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; min-width: 0; font-size: 12.5px; }
.sk-idea-who { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); }
.sk-ago { margin-left: auto; color: var(--text-3); white-space: nowrap; }
.sk-mini { display: block; width: 100%; height: 26px; margin: 6px 0 4px; }
.sk-idea-meta { color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-idea-act { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; min-width: 0; }
@media (min-width: 900px) { .sk-idea-act .btn, .sk-idea-act .band-btn { height: 26px; padding: 0 9px; } }
.sk-idea-act .band-btn { border: var(--rule-2); border-radius: var(--r-press); background: none; color: var(--text); font: 600 12.5px/1 var(--font-ui); }
.sk-idea-act .band-btn svg { display: none; }
.sk-hear.on { background: var(--text); border-color: var(--text); color: var(--bg); }
.sk-other .sk-idea-n, .sk-other .sk-idea-who { color: var(--text-3); }
.sk-idea-from { font-size: 12px; color: var(--text-3); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-acts .sk-kept { color: var(--text-2); background: none; border-color: var(--line-2); opacity: 1; cursor: default; }
/* musical typing's strip, docked in Play it (in place of the spiral): it covers nothing */
.sk-qwdock { display: none; }
.sk-body.typing .sk-qwdock { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; align-items: flex-start; }
.sk-body.typing .sk-spiral { display: none; }
/* docked here, the strip is a little shorter than floating, so a 300 px pane shows all of its keys */
.sk-qwdock .ew-qw.docked { padding: 6px 10px 8px; }
.sk-qwdock .ew-qw.docked .ew-qw-head { margin-bottom: 4px; }
.sk-qwdock .ew-qw.docked .ew-qw-k { height: 34px; }
.sk-qwdock .ew-qw.docked .ew-qw-k.blk { height: 30px; }
.sk:has(.sk-body.typing) .sk-foot .sk-status { display: none; }
@container sketch (max-width: 1100px) { .sk-body.typing .sk-rollwrap { display: none; } }
/* a narrow pane (1280 x 720 with the agent open): the strip's head keeps one line, the line over the keys ("Snapping
   to 1/16, in C minor"), and its key hints (Z X octave, C V velocity, in ? too) give way, so the keys stay in view */
@container sketch (max-width: 800px) { .sk-qwdock .ew-qw.docked .ew-qw-meta { display: none; } }
/* the touch keyboard: an octave of the song's key */
.sk-tk { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sk-tk-bar { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); }
/* the line over the touch keys (input/qwerty.js snapLine): the room beside the octave, wrapping between its parts when
   it runs out (no key set: "in C major," then "no key set"), so the keys never move down for it; each part reaches 40 px
   tall to a finger (a transparent ::before), the line drawn its own size */
.sk-tk-bar .ew-snap { flex: 1 1 0; margin-left: 6px; font-size: 13px; }
.sk-tk-bar .ew-snap-p { position: relative; }
.sk-tk-bar .ew-snap-p::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 44px; transform: translateY(-50%); }
.sk-tk-o { min-width: 40px; height: 36px; font-size: 16px; }
.sk-tk-oct { font: 600 12px var(--font-mono); color: var(--text); }
.sk-tk-keys { flex: 1 1 auto; display: flex; gap: 3px; min-height: 140px; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.sk-tk-k { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; padding: 0 0 10px; border: 1px solid var(--paper-rule); border-radius: 0 0 var(--r-press) var(--r-press); background: var(--paper); color: var(--ink); touch-action: none; cursor: pointer; }
.sk-tk-k b { font-size: 15px; font-weight: 700; }
.sk-tk-k small { font: 600 12px var(--font-mono); color: var(--ink-2); }
.sk-tk-k.root { border-bottom: 3px solid var(--ink-3); }
.sk-tk-k.out { background: var(--paper-rule); color: var(--ink-3); }
.sk-tk-k.out small { color: var(--ink-3); }
.sk-tk-k.on { background: var(--text-2); color: var(--ink); }
/* a touch screen: the Hum / Beatbox / Keep row is pinned to the bottom of the sheet, in reach of a thumb */
.sk.touch .sk-foot { position: sticky; bottom: 0; z-index: 6; padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px)); background: var(--bg); border-top: var(--rule); }
.sk.touch[data-mode="play"] .sk-foot { position: static; background: none; border-top: 0; }
/* a phone: the footer is the sheet's last row and the rest scrolls above it (placeFoot) */
.sk.sk-split { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.sk.sk-split > .sk-scroll { flex: 1 1 auto; min-height: 0; overflow: hidden auto; overscroll-behavior: contain; display: flex; flex-direction: column; }
.sk.sk-split > .sk-scroll > * { flex: none; }
.sk.sk-split > .sk-foot { flex: none; flex-wrap: wrap; gap: 8px; padding: 8px 14px calc(8px + env(safe-area-inset-bottom, 0px)); margin: 0; }
/* (one row, always: Beatbox or Hum beside Record and its track, the track's name the one to give way; what a take is,
   its Keep row and the line it records onto are the sheet's, above) */
.sk.sk-split > .sk-foot { flex-wrap: nowrap; }
.sk.sk-split > .sk-foot > .sk-strip { flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; }
.sk.sk-split > .sk-foot > .sk-strip > .sk-field { flex: 0 1 auto; min-width: 0; }
.sk.sk-split > .sk-foot > .sk-strip .sk-target { min-width: 64px; max-width: 100%; }
/* a phone's take row, in the sheet under the dial or the pads: what the take is (whole, wrapped), then Keep (on the
   track Record's picker shows: one picker), Agent and the rest, wrapped rather than run off the edge */
.sk-take { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.sk-take > .sk-cap { padding: 0; white-space: normal; overflow: visible; font-size: 13px; line-height: 1.4; }
.sk-take > .sk-acts { flex-wrap: wrap; }
.sk-take .sk-destwrap { display: none; }
.sk-take .sk-acts .btn-go { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
/* Tap it on a phone: the ways in, the line that says what to tap (and, while you tap, how many hits) beside the snap
   chips, the grid, the beat's lamps and the pads in one view above the pinned row (390x844, the sheet at its first
   height: 267 px over the pinned row; tools/phone-test.js checks each is in view). The blurb gives way (the line says
   what to tap), and so do the pads' beatbox syllables (Beatbox is in the pinned row, and the line says them while you
   beatbox); the snap row keeps its 44 px reach from its chips' own ::before */
.sk.sk-split[data-mode="tap"] .sk-stage { padding-top: 2px; gap: 4px; }
.sk.sk-split[data-mode="tap"] .sk-blurb { display: none; }
.sk.sk-split[data-mode="tap"] .sk-head { min-height: 0; }
.sk.sk-split[data-mode="tap"] .sk-opts { padding-block: 2px; }
.sk.sk-split[data-mode="tap"] .sk-body { gap: 2px; }
.sk.sk-split[data-mode="tap"] .sk-take { gap: 4px; }
.sk.sk-split[data-mode="tap"] .sk-opts > .sk-status { flex: 1 1 auto; min-width: 0; padding: 0; white-space: normal; overflow: visible; font-size: 12.5px; line-height: 17px; }
.sk.sk-split[data-mode="tap"] .sk-body > .sk-rollwrap { flex: none; min-height: 0; }
.sk.sk-split[data-mode="tap"] .sk-body > .sk-rollwrap > .sk-cv { flex: none; height: 76px; }   /* (four 14.75 px rows under a 14 px band of bar numbers; a pass's line goes under it) */
.sk.sk-split[data-mode="tap"] .sk-padcol { gap: 4px; }
.sk.sk-split[data-mode="tap"] .sk-pad { min-height: 48px; justify-content: center; }
.sk.sk-split[data-mode="tap"] .sk-pad small { display: none; }
/* the line a take records onto, on a phone: over the pads (or the dial), in record ink while it records */
.sk.sk-split .sk-body > .sk-recnote { flex: none; font-size: 13px; line-height: 1.35; color: var(--text-2); }
.sk.sk-split .sk-body > .sk-recnote.rec { color: var(--rec); }
/* Hum it on a phone: the dial and, before the mic is allowed, the explainer beside it, so the ways in, the explainer
   and "Allow the mic and hum" are in view when the sheet opens; the take's row and the roll under them */
.sk.sk-split .sk-body[data-mode="hum"] { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
.sk.sk-split .sk-body[data-mode="hum"] > * { flex: 1 0 100%; }
.sk.sk-split .sk-body[data-mode="hum"] > .sk-spiral { flex: none; height: 120px; margin: 0 auto; }
.sk.sk-split .sk-body[data-mode="hum"] > .sk-spiral:has(+ .sk-explain) { margin: 0; }
.sk.sk-split .sk-body[data-mode="hum"] > .sk-explain { flex: 1 1 150px; }
.sk-explain.beside { position: static; inset: auto; z-index: auto; padding: 0; background: none; overflow: visible; justify-content: center; gap: 8px; }
.sk-explain.beside p { font-size: 12.5px; line-height: 1.4; }
.sk-explain.beside .sk-small { display: none; }
.sk-explain.beside ~ .sk-take { display: none; }
.sk.sk-split > .sk-foot .sk-big { padding: 0 14px 0 12px; }
.sk.sk-split > .sk-foot .sk-recbtn { padding: 0 14px 0 12px; }
.sk.sk-split[data-mode="play"] > .sk-foot:not(:has(:not([hidden]))) { display: none; }
.sk.touch .sk-big { height: 48px; padding: 0 20px 0 16px; font-size: 15px; }
/* on a phone the footer (and Record in it) is pinned to the bottom of the sheet; the count-in, the click and Each pass
   are the transport's there (its record popover), so the pinned row stays one row over the pads */
.sk.touch .sk-recbtn { height: 48px; padding: 0 18px 0 14px; font-size: 15px; }
.sk.touch .sk-strip .sk-select { height: 40px; }
/* Play it on a touch screen: Record and its track sit right above the keys */
.sk.touch .sk-body[data-mode="play"] > .sk-strip { flex: none; }
@container (max-width: 640px) { .sk.touch .sk-strip .sk-field > small { display: none; } }
.sk.touch .sk-acts .btn { min-height: 40px; }
.sk.touch .sk-acts .sk-select { height: 40px; }
.sk.touch .sk-mode { min-height: 40px; }
/* Hum it's snap and grid chips under a finger: 44 px to the touch (app.css gives the studio's chips 40); the row's
   padding is the room the reach needs, as the row scrolls sideways */
@media (pointer: coarse) {
  .sk.touch .sk-opts :is(.sk-chip, .sk-seg button)::before { height: 44px; }
  .sk.touch .sk-opts { padding-block: 8px; }
}
/* the sound card's place (ui/sounds.js fills it, "What should this sound like?"): beside the take's canvas, the card
   300 px and the canvas 360 or more; in a narrow stage the dial steps aside, then the card goes under the canvas; on a
   phone, under the take's row */
.sk-cardhost:empty, .sk-cardhost[hidden] { display: none; }
.sk-body > .sk-cardhost { flex: 0 0 300px; min-width: 0; min-height: 0; overflow: auto; }
.sk-body:has(> .sk-cardhost:not(:empty)) > .sk-rollwrap { min-width: 360px; }
@container sketch (max-width: 1500px) and (min-width: 641px) { .sk-body:has(> .sk-cardhost:not(:empty)) > .sk-spiral { display: none; } }
@container sketch (max-width: 1200px) and (min-width: 641px) {
  .sk-body:has(> .sk-cardhost:not(:empty)) { flex-wrap: wrap; overflow: auto; }
  .sk-body:has(> .sk-cardhost:not(:empty)) > .sk-rollwrap { flex: 1 0 100%; min-width: 0; min-height: 140px; }
  .sk-body > .sk-cardhost { flex: 1 0 100%; overflow: visible; }
}
.sk-take > .sk-cardhost { flex: none; }
/* a phone, while a sound is on trial: the pinned row is Keep, Back and the record lamp */
.sk-trialrow { display: none; }
.sk.sk-split.sk-trying > .sk-foot > .sk-trialrow { display: flex; flex: 1 1 auto; align-items: center; gap: 8px; min-width: 0; }
.sk.sk-split.sk-trying .sk-tkeep { flex: 1 1 auto; min-width: 0; height: 48px; font-size: 15px; }
.sk.sk-split.sk-trying .sk-tback { flex: none; min-height: 40px; }
.sk.sk-split.sk-trying > .sk-foot > :not(.sk-trialrow, .sk-strip) { display: none; }
.sk.sk-split.sk-trying > .sk-foot > .sk-strip { flex: none; }
.sk.sk-split.sk-trying > .sk-foot > .sk-strip > :not(.sk-recbtn) { display: none; }
/* (one primary: the pinned Keep is the take's Keep while a sound is on trial) */
.sk.sk-split.sk-trying .sk-take .sk-acts .btn-go { display: none; }
/* Tap it, a beat in the song: "Hum a tune over it?" at the end of the take line */
.sk-over { flex: none; font-size: 12px; line-height: 17px; color: var(--text-2); white-space: nowrap; }
.sk-over .btn-txt { height: auto; min-height: 0; padding: 0; font-size: 12px; vertical-align: baseline; }
.sk-rollwrap > .sk-over { order: 0; padding: 0 10px 2px; }
.sk-take > .sk-over { font-size: 13px; white-space: normal; }
/* the Beatbox catch: a line and two buttons over the beat, Keep the beat first */
.sk-catch { flex: none; order: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 6px 10px; border-bottom: var(--rule); }
.sk-catch-l { margin: 0; flex: 1 1 220px; min-width: 0; font-size: 13px; line-height: 1.4; color: var(--text); }
.sk.touch .sk-catch .btn { min-height: 40px; }
/* the Jam room open: one Record, the room's (syncJam) */
.sk.sk-jam .sk-strip { display: none; }
.sk-jamnote { margin: 4px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--text-2); }
.sk-menu { position: fixed; z-index: 1001; min-width: 180px; padding: 4px 0; background: var(--bg-3); border: var(--rule-2); box-shadow: var(--shadow-2); display: flex; flex-direction: column; }
.sk-menu-h { padding: 5px 12px 4px; font-size: 12px; color: var(--text-3); }
.sk-menu button { text-align: left; border: 0; background: transparent; color: var(--text); padding: 7px 12px; cursor: pointer; font-size: 12.5px; }
.sk-menu button:hover, .sk-menu button:focus-visible { background: var(--text); color: var(--bg); outline: none; }
.sk-menu button.def { font-weight: 700; }
@container (max-width: 860px) {
  .sk { grid-template-columns: 120px minmax(0, 1fr) 236px; }
  .sk-blurb { visibility: hidden; }
  .sk-padcol { width: 190px; }
  .sk-railnote { display: none; }
}
@container sketch (max-width: 760px) and (min-width: 641px) {
  .sk { grid-template-columns: 104px minmax(0, 1fr) 200px; }
  .sk-explain { padding: 8px 12px; }
  .sk-explain p { font-size: 12px; }
  .sk-explain .sk-small { display: none; }
  .sk-mode.on .sk-mode-l { font-size: 19px; }
  .sk-ideas { padding: 12px 12px 0 14px; }
}
@container (max-width: 640px) {
  .sk { grid-template-columns: 1fr; grid-template-rows: auto auto auto; grid-template-areas: "modes" "stage" "ideas"; height: auto; min-height: 100%; }
  .sk-stage { grid-area: stage; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .sk-head, .sk-body { padding: 0; }
  .sk-head { min-height: 28px; }
  .sk-foot { padding: 0; margin: 0; border-top: 0; }
  .sk-modes { flex-direction: row; min-width: 0; padding: 4px 14px 0; border-right: 0; border-bottom: var(--rule); overflow-x: auto; }
  .sk-rail { flex-direction: row; align-items: baseline; gap: 16px; }
  .sk-draw { flex: none; align-self: center; margin: 0 0 0 16px; }
  .sk.touch .sk-draw { min-height: 40px; }
  .sk-mode { flex: none; display: flex; align-items: center; }
  .sk-mode.on .sk-mode-l { font-size: 20px; }
  .sk-railnote { display: none; }
  .sk-stage { padding: 10px 14px; }
  .sk-head { flex-direction: column; align-items: stretch; gap: 6px; }
  .sk-blurb { flex: none; visibility: visible; white-space: normal; }
  .sk-opts { justify-content: flex-start; }
  .sk-body { flex-direction: column; height: auto; }
  .sk-spiral { height: 200px; align-self: center; }
  .sk.touch .sk-spiral { height: 150px; }
  .sk-rollwrap { min-height: 170px; }
  .sk-padcol { width: 100%; }
  .sk-pads { grid-template-columns: repeat(4, 1fr); max-height: none; }
  /* a beat over each pad (four to the bar): a square centred over each */
  .sk-beats { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; justify-items: center; height: 18px; }
  .sk-beats i { width: 16px; height: 16px; }
  .sk-beats i.one { width: 24px; }
  .sk-pad { min-height: 64px; }
  .sk-ideas { border-left: 0; border-top: var(--rule); padding: 14px 14px 0; }
  .sk-ideas-list { max-height: none; }
}
`;
