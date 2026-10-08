// The beat grid [ui-arrange]: the "Beat" tab. A step sequencer for a clip on a drum track. Rows are the kit's voices,
// 16 steps per bar (in 4/4), bars paged to fit. Click toggles, drag paints or erases (a finger: tap toggles, a drag
// scrolls, hold then drag paints), shift-click cycles accent → hit →
// ghost. Every gesture is one transaction of notes.* ops by 'you'. Swing delays the off-beat 16ths (notes.set).
//
// Also routes drum clips here: selecting one shows this tab when the editor area is showing Notes (unless you picked
// Notes for that clip), and double-clicking one in the arranger opens it here.
//
// Drawing a beat is a way in of its own, for anyone who can't (or won't) tap in time: app.beat.draw() opens the beat on
// the song's drums, or makes a Drums track and a two-bar Beat clip, and shows it here, where a click on a square is a hit.
// The empty tab says so in a sentence and a button; Sketch's ways in and the blank song's card point here too.
//
// Rows are named by the track's kit (its device's note map: core/music.js kitNotes, drumName), so a row says what that
// kit plays there ("Rimshot" on Studio A, "Snare (40)" on Gobo Kit). More rows adds any other note the kit names (Studio
// A's half-open hats, ride bell and edge, rimshot, flams, chokes); the rows you add last the session (ui.state.beatRows).

import { h, css, icon, canvas, clamp, byline } from './dom.js';
import {
  palette,
  resolveColor,
  rgba,
  shade,
  authorKind,
  authorName,
  isDrumTrack,
  trackNotes,
  touched,
  flasher,
  presenceList,
  drawCrop,
  roundRect,
  menu,
} from './arrange-kit.js';

const STEP = 0.25;
const DEFAULT_ROWS = [36, 38, 39, 42, 46, 50, 47, 45, 49];
// rows in a kit's order: each piece with its articulations beside it (Studio A's beyond-GM notes next to their piece)
const ORDER = [
  36, 35, 38, 40, 37, 34, 31, 32, 33, 39, 42, 22, 44, 23, 24, 46, 26, 21, 50, 48, 47, 45, 43, 41, 49, 27, 57, 28, 51,
  53, 59, 25, 52, 29, 55, 30, 54, 56, 70, 69, 82,
];
// More rows lists a kit's notes by piece
const FAMILIES = [
  ['Kick', [36, 35]],
  ['Snare', [38, 40, 37, 34, 31, 32, 33]],
  ['Hats', [42, 22, 44, 23, 24, 46, 26, 21]],
  ['Toms', [50, 48, 47, 45, 43, 41]],
  ['Cymbals', [49, 27, 57, 28, 51, 53, 59, 25, 52, 29, 55, 30]],
  ['Percussion', [39, 54, 56, 70, 69, 82]],
];
const LEVELS = [1, 0.8, 0.45];
const LABEL_W = 132;
const ROW_TOUCH = 32; // a square's height under a finger (the grid scrolls when the rows don't fit)
const isDrumClip = (app, f) => !!f && f.clip.kind === 'notes' && isDrumTrack(app, f.track);

export default function (app) {
  css('drumgrid', CSS);
  const { ui, store } = app;
  ui.panel({
    id: 'drumgrid',
    region: 'bottom',
    title: 'Beat',
    icon: 'drum',
    order: 12,
    mount: (el) => mountGrid(el, app),
  });
  app.beat = { draw: (opts) => drawBeat(app, opts) };

  // routing: drum clips open here, melodic clips in Notes
  const prefersNotes = new Set();
  let auto = false;
  let lastClip = null;
  const show = (id) => {
    auto = true;
    try {
      ui.show(id, { save: false });
    } finally {
      auto = false;
    }
  };
  ui.on('select', (s) => {
    if (s.clip === lastClip) return;
    lastClip = s.clip;
    const f = s.clip ? store.findClip(s.clip) : null;
    if (!f || !ui.isOpen?.('bottom')) return;
    const active = ui.active('bottom');
    if (isDrumClip(app, f) && active === 'pianoroll' && !prefersNotes.has(f.clip.id)) show('drumgrid');
    else if (f.clip.kind === 'notes' && !isDrumClip(app, f) && active === 'drumgrid' && ui.panels.has('pianoroll'))
      show('pianoroll');
  });
  ui.on('show', ({ id }) => {
    if (auto) return;
    const c = ui.state.selection.clip;
    const f = c ? store.findClip(c) : null;
    if (!isDrumClip(app, f)) return;
    if (id === 'pianoroll') prefersNotes.add(c);
    if (id === 'drumgrid') prefersNotes.delete(c);
  });
  ui.on('edit-clip', (d) => {
    if (d.handled) return;
    const f = store.findClip(d.clip);
    if (!isDrumClip(app, f)) return;
    ui.select({ track: f.track.id, clip: f.clip.id });
    ui.show(prefersNotes.has(f.clip.id) && ui.panels.has('pianoroll') ? 'pianoroll' : 'drumgrid');
    d.handled = true;
  });
}

// Draw a beat: the beat on the song's drums (the selected drum track's clip under the playhead, or its first), or, with no
// drum clip yet, a Drums track if there is none and a two-bar Beat clip at the top of the song (the loop's start while
// the loop is on), selected and open in the Beat tab. fresh: a new clip even when there is one.
export function drawBeat(app, { fresh = false } = {}) {
  const { store, ui, engine } = app;
  const p = store.get(),
    bpb = app.music.beatsPerBar(p.meter);
  const drums = p.tracks.filter((t) => isDrumTrack(app, t));
  const sel = ui.state.selection.track;
  const t =
    drums.find((x) => x.id === sel) || drums.find((x) => x.clips.some((c) => c.kind === 'notes')) || drums[0] || null;
  const clips = t ? t.clips.filter((c) => c.kind === 'notes') : [];
  const show = (tid, cid) => {
    ui.select({ track: tid, clip: cid, notes: [] });
    try {
      if (!ui.isOpen?.('bottom')) ui.setOpen?.('bottom', true);
    } catch {
      /* ok */
    }
    ui.show('drumgrid');
    return { ok: true, track: tid, clip: cid };
  };
  if (t && clips.length && !fresh) {
    const b = engine.beat || 0;
    const c =
      clips.find((x) => b >= x.start && b < x.start + x.length) || clips.slice().sort((x, y) => x.start - y.start)[0];
    return show(t.id, c.id);
  }
  const home = p.loop?.on && Number.isFinite(+p.loop.start) ? Math.max(0, Math.floor(+p.loop.start / bpb) * bpb) : 0;
  const end = clips.reduce((m, c) => Math.max(m, c.start + c.length), 0);
  const start = clips.length ? Math.max(end, home) : home;
  const clip = { kind: 'notes', start, length: bpb * 2, name: 'Beat', notes: [] };
  const n = p.tracks.length;
  const ops = t
    ? [{ type: 'clip.add', track: t.id, clip, ref: 'c' }]
    : [
        {
          type: 'track.add',
          track: {
            kind: 'instrument',
            name: 'Drums',
            color: `var(--c-${(n % 8) + 1})`,
            instrument: { device: 'core.drums', params: {} },
          },
          ref: 'dr',
        },
        { type: 'clip.add', track: '$dr', clip, ref: 'c' },
      ];
  const r = store.dispatch(ops, { by: 'you', label: t ? `new beat on ${t.name}` : 'add Drums to draw a beat on' });
  if (!r.ok) {
    ui.toast(r.error, { kind: 'bad' });
    return r;
  }
  return show(t ? t.id : r.created.dr, r.created.c);
}

function mountGrid(el, app) {
  const { store, engine, ui, music } = app;

  /* ======================================================= DOM */
  const clipLabel = h('div.dg-clip');
  const swingOut = h('span.dg-swingval', '0%');
  const swing = h('input.dg-swing', {
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    value: 0,
    'aria-label': 'Swing',
    title: 'Swing: push the off-beat 16ths late, for a shuffle',
  });
  const pageLabel = h('span.dg-page');
  const prev = h(
    'button.dg-btn.dg-ico',
    { title: 'Earlier bars', onclick: () => setPage(page - 1) },
    h('span.dg-flip', icon('chevron', { size: 14 })),
  );
  const next = h(
    'button.dg-btn.dg-ico',
    { title: 'Later bars', onclick: () => setPage(page + 1) },
    icon('chevron', { size: 14 }),
  );
  const copyB = h(
    'button.dg-btn',
    { title: 'Copy the focused bar', onclick: () => copyBar() },
    icon('copy', { size: 13 }),
    h('span', 'Copy bar'),
  );
  const pasteB = h(
    'button.dg-btn',
    { title: 'Paste over the focused bar', onclick: () => pasteBar() },
    h('span', 'Paste'),
  );
  const fillB = h(
    'button.dg-btn',
    { title: 'Copy the focused bar into every bar after it', onclick: () => fillFrom() },
    h('span', 'Repeat →'),
  );
  const clearB = h(
    'button.dg-btn',
    { title: 'Clear the focused bar', onclick: () => clearBar() },
    icon('trash', { size: 13 }),
    h('span', 'Clear'),
  );
  // More rows sits over the row names it adds to (the head bar keeps its room for the clip's name and byline)
  const moreB = h(
    'button.dg-more',
    {
      type: 'button',
      title: 'More rows: add a row for another sound this kit plays',
      'aria-label': 'More rows',
      'aria-haspopup': 'menu',
      onclick: () => moreRows(),
    },
    '+ More',
  );
  const bar = h(
    'div.dg-bar',
    clipLabel,
    h('div.dg-sep'),
    h('label.dg-swingwrap', h('span.dg-lbl', 'Swing'), swing, swingOut),
    h('div.dg-sep'),
    h('div.dg-pager', prev, pageLabel, next),
    h('div.dg-flex'),
    copyB,
    pasteB,
    fillB,
    clearB,
  );
  const over = canvas('dg-over');
  // an empty clip says what to do, over the bars (it goes with the first hit)
  // (a touch screen: a square is at least ROW_TOUCH px tall and the grid scrolls; the hint says tap and hold)
  const coarse = () => {
    try {
      return matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  };
  const hint = h(
    'p.dg-hint',
    { hidden: true },
    coarse()
      ? 'Tap a square to add a hit; hold one, then drag along a row for more.'
      : 'Click a square to add a hit, drag along a row for more. Space plays it.',
  );
  const overWrap = h('div.dg-overwrap', over.cv, hint);
  const labels = h('div.dg-labels');
  const cells = canvas('dg-cells');
  const cellWrap = h('div.dg-cellwrap', cells.cv);
  const main = h('div.dg-main', labels, cellWrap);
  const empty = h('div.dg-empty');
  const root = h('div.dg', bar, overWrap, main, empty);
  el.append(root);

  /* ======================================================= state */
  let cur = null;
  let rows = [];
  let names = null; // the track's kit's names for its notes (null: General MIDI's)
  const rowName = (p) => music.drumName(p, names) || music.noteName(p);
  // the rows you added with More rows, per track, for the session
  const added = (tid) => ((ui.state.beatRows ||= {})[tid] ||= []);
  let index = new Map(); // 'p:i' -> note
  let page = 0,
    perPage = 2,
    focusBar = 0;
  let paint = null; // { mode: 'add'|'remove', v, cells: Map key -> {p,i} }
  let dirty = true,
    hover = null;
  let barClip = null;
  const flash = flasher(1300);
  const bpb = () => music.beatsPerBar(store.get().meter);
  const spb = () => Math.round(bpb() / STEP); // steps per bar
  const bars = () => (cur ? Math.max(1, Math.ceil(cur.c.length / bpb() - 1e-9)) : 1);
  // the clip's bar b (0 = its first) as the song numbers it: the grid, the strip over it, the header and the bar
  // actions all say the same number (a clip that starts at bar 3 is bars 3–4, never "1–2")
  const songBar = (b) => (cur ? Math.floor(cur.c.start / bpb()) : 0) + b + 1;
  const stepOf = (t) => Math.floor(t / STEP + 0.25);

  function pick() {
    const id = ui.state.selection.clip;
    const f = id ? store.findClip(id) : null;
    const was = cur?.c.id;
    cur = isDrumClip(app, f) ? { t: f.track, c: f.clip } : null;
    names = cur ? trackNotes(app, cur.t) : null;
    if (cur?.c.id !== was) {
      page = 0;
      focusBar = 0;
    }
    rebuild();
  }
  function rebuild() {
    index = new Map();
    if (cur) {
      for (const n of cur.c.notes) index.set(n.p + ':' + stepOf(n.t), n);
      const used = new Set(cur.c.notes.map((n) => n.p));
      const all = new Set([...DEFAULT_ROWS, ...used, ...added(cur.t.id)]);
      rows = [...all].sort((a, b) => {
        const ia = ORDER.indexOf(a),
          ib = ORDER.indexOf(b);
        return (ia < 0 ? 99 + a : ia) - (ib < 0 ? 99 + b : ib);
      });
      page = clamp(page, 0, Math.max(0, Math.ceil(bars() / perPage) - 1));
      focusBar = clamp(focusBar, 0, bars() - 1);
      syncSwing();
    }
    buildLabels();
    syncBar();
    syncEmpty();
    dirty = true;
  }

  /* ======================================================= labels (rows) */
  function buildLabels() {
    if (!cur) {
      labels.replaceChildren();
      return;
    }
    const col = resolveColor(cur.t.color);
    const counts = new Map();
    for (const n of cur.c.notes) counts.set(n.p, (counts.get(n.p) || 0) + 1);
    labels.replaceChildren(
      h('div.dg-lhead', h('span', 'Voices'), moreB),
      ...rows.map((p) =>
        h(
          'button.dg-row' + (counts.get(p) ? '.used' : ''),
          {
            title: `Hear the ${rowName(p)} (MIDI ${p})`,
            onpointerdown: (e) => {
              e.preventDefault();
              audition(p, 0.9);
            },
            style: { '--tc': col },
            dataset: { p: String(p) },
          },
          h('span.dg-rowdot'),
          h('span.dg-rowname', rowName(p)),
          counts.get(p) ? h('span.dg-rowcount', String(counts.get(p))) : null,
        ),
      ),
    );
  }
  function audition(p, v = 0.8) {
    if (cur) {
      try {
        engine.audition?.(cur.t.id, p, v, 0.25);
      } catch (_) {
        /* no sound yet */
      }
    }
  }
  // More rows: every other note the kit names (General MIDI's for a kit that names none), by piece; a pick adds its row
  function moreRows() {
    if (!cur) return;
    const tid = cur.t.id,
      shown = new Set(rows);
    const have = names
      ? Object.keys(names)
          .filter((k) => k !== 'other')
          .map(Number)
      : Object.keys(music.GM_DRUMS).map(Number);
    const left = new Set(have.filter((p) => !shown.has(p)));
    const items = [];
    const take = (head, ps) => {
      const list = ps.filter((p) => left.has(p));
      if (!list.length) return;
      items.push({ head });
      for (const p of list) {
        left.delete(p);
        items.push({ label: rowName(p), sub: String(p), run: () => addRow(tid, p) });
      }
    };
    for (const [head, ps] of FAMILIES) take(head, ps);
    take(
      'Other',
      [...left].sort((a, b) => a - b),
    );
    const empty = added(tid).filter((p) => !cur.c.notes.some((n) => n.p === p));
    if (empty.length) {
      if (items.length) items.push('-');
      items.push({
        label:
          empty.length === 1 ? `Hide the ${rowName(empty[0])} row` : `Hide the ${empty.length} empty rows you added`,
        run: () => {
          const keep = added(tid).filter((p) => !empty.includes(p));
          ui.state.beatRows[tid] = keep;
          rebuild();
        },
      });
    }
    if (!items.length) {
      ui.toast(`Every sound ${cur.t.name}'s kit has is a row already.`);
      return;
    }
    menu(moreB, items, { label: `More rows for ${cur.t.name}` });
  }
  function addRow(tid, p) {
    const list = added(tid);
    if (!list.includes(p)) list.push(p);
    if (cur && cur.t.id === tid) {
      rebuild();
      audition(p, 0.8);
      ui.announce?.(`${rowName(p)} is a row now`);
    }
  }

  /* ======================================================= toolbar */
  function syncBar() {
    if (!cur) return;
    // the clip's name, its track, and who wrote it (a byline; the house is unsigned)
    clipLabel.replaceChildren(
      h('span.dg-dot', { style: { background: resolveColor(cur.c.color || cur.t.color) } }),
      h('b', cur.c.name || cur.t.name),
      h('span.dg-on', `on ${cur.t.name}`),
      ...(byline(cur.c.by, { app }) ? [h('span.dg-by', ' by ', byline(cur.c.by, { app }))] : []),
    );
    // the bars on this page, in the song's numbers; when the clip runs to more pages than one, its whole span after
    // them ("Bars 5–6 of 3–10")
    const n = bars();
    const a = page * perPage,
      b = Math.min(n, a + perPage) - 1;
    const here = a === b ? `Bar ${songBar(a)}` : `Bars ${songBar(a)}–${songBar(b)}`;
    pageLabel.textContent = n > perPage ? `${here} of ${songBar(0)}–${songBar(n - 1)}` : here;
    prev.disabled = page <= 0;
    next.disabled = b >= n - 1;
    pasteB.disabled = !barClip;
    hint.hidden = cur.c.notes.length > 0;
    fillB.disabled = focusBar >= n - 1;
    for (const x of [copyB, pasteB, fillB, clearB])
      x.title = x.title.replace(/ \(bar \d+\)$/, '') + ` (bar ${songBar(focusBar)})`;
  }
  function setPage(p) {
    page = clamp(p, 0, Math.max(0, Math.ceil(bars() / perPage) - 1));
    focusBar = clamp(focusBar, page * perPage, Math.min(bars(), (page + 1) * perPage) - 1);
    syncBar();
    dirty = true;
  }

  /* ======================================================= swing */
  function currentSwing() {
    const offs = [];
    for (const n of cur.c.notes) {
      const i = stepOf(n.t);
      if (i % 2 === 1) offs.push((n.t - i * STEP) / (STEP * 0.5));
    }
    if (!offs.length) return 0;
    offs.sort((a, b) => a - b);
    return clamp(Math.round(offs[Math.floor(offs.length / 2)] * 100), 0, 100);
  }
  function syncSwing() {
    if (document.activeElement === swing) return;
    const s = currentSwing();
    swing.value = s;
    swingOut.textContent = s + '%';
  }
  swing.addEventListener('input', () => {
    if (!cur) return;
    const s = Number(swing.value) / 100;
    swingOut.textContent = swing.value + '%';
    const patch = [];
    for (const n of cur.c.notes) {
      const i = stepOf(n.t);
      if (i % 2 !== 1) continue;
      const t = Math.round((i * STEP + s * STEP * 0.5) * 10000) / 10000;
      if (Math.abs(t - n.t) > 1e-5) patch.push({ id: n.id, t });
    }
    if (patch.length)
      store.dispatch(
        { type: 'notes.set', track: cur.t.id, clip: cur.c.id, notes: patch },
        { by: 'you', label: `swing ${swing.value}%`, coalesce: 'swing:' + cur.c.id },
      );
  });
  swing.addEventListener('change', () => swing.blur());
  const swingDelay = () => (Number(swing.value) / 100) * STEP * 0.5;

  /* ======================================================= bar actions */
  const barNotes = (b) =>
    cur.c.notes.filter((n) => {
      const i = stepOf(n.t);
      return i >= b * spb() && i < (b + 1) * spb();
    });
  function copyBar() {
    if (!cur) return;
    const b0 = focusBar * bpb();
    barClip = barNotes(focusBar).map((n) => ({ p: n.p, t: n.t - b0, d: n.d, v: n.v }));
    ui.toast(`Copied bar ${songBar(focusBar)} (${barClip.length} hit${barClip.length === 1 ? '' : 's'})`);
    syncBar();
  }
  function replaceBar(b, notes, label) {
    const gone = barNotes(b).map((n) => n.id);
    const ops = [];
    if (gone.length) ops.push({ type: 'notes.remove', track: cur.t.id, clip: cur.c.id, ids: gone });
    if (notes.length)
      ops.push({
        type: 'notes.add',
        track: cur.t.id,
        clip: cur.c.id,
        notes: notes.map((n) => ({ ...n, t: n.t + b * bpb() })),
      });
    return ops;
  }
  function pasteBar() {
    if (!cur || !barClip) return;
    const ops = replaceBar(focusBar, barClip);
    if (ops.length) store.dispatch(ops, { by: 'you', label: `paste into bar ${songBar(focusBar)}` });
  }
  function fillFrom() {
    if (!cur) return;
    const b0 = focusBar * bpb();
    const src = barNotes(focusBar).map((n) => ({ p: n.p, t: n.t - b0, d: n.d, v: n.v }));
    const ops = [];
    for (let b = focusBar + 1; b < bars(); b++) ops.push(...replaceBar(b, src));
    if (ops.length) store.dispatch(ops, { by: 'you', label: `repeat bar ${songBar(focusBar)} to the end` });
  }
  function clearBar() {
    if (!cur) return;
    const ids = barNotes(focusBar).map((n) => n.id);
    if (ids.length)
      store.dispatch(
        { type: 'notes.remove', track: cur.t.id, clip: cur.c.id, ids },
        { by: 'you', label: `clear bar ${songBar(focusBar)}` },
      );
  }

  /* ======================================================= empty states */
  function syncEmpty() {
    root.classList.toggle('dg-isempty', !cur);
    if (cur) {
      empty.replaceChildren();
      return;
    }
    const id = ui.state.selection.clip;
    const f = id ? store.findClip(id) : null;
    const drumTrack = store.get().tracks.find((t) => isDrumTrack(app, t));
    // a sentence that says what to do, and a button (other ways in are underlined words)
    // no drum clip in the song yet: this is a way to make a beat with no playing in time, and it says so
    const drumClip = drumTrack && drumTrack.clips.some((c) => c.kind === 'notes');
    let msg;
    const actions = [];
    if (f) {
      msg = `Beat edits drum clips. “${f.clip.name || f.track.name}” is on ${f.track.name}, so it lives in Notes.`;
      if (ui.panels.has('pianoroll'))
        actions.push(h('button.btn', { onclick: () => ui.show('pianoroll') }, 'Open it in Notes'));
    } else if (!drumClip) {
      msg =
        'Make a beat by clicking squares: a row for each drum, a square for each sixteenth. Nothing to play in time.';
    } else {
      msg = `Pick a drum clip to change its beat, or open the one on ${drumTrack.name}.`;
    }
    const sec = () => (actions.length ? '.btn-txt' : '');
    if (drumClip)
      actions.push(
        h('button.btn' + sec(), { onclick: () => drawBeat(app) }, `Open the beat on ${drumTrack.name}`),
        h('button.btn.btn-txt', { onclick: () => newBeat(drumTrack) }, 'New beat'),
      );
    else actions.push(h('button.btn' + sec(), { onclick: () => drawBeat(app, { fresh: true }) }, 'Draw a beat'));
    if (ui.panels.has('sketch'))
      actions.push(
        h(
          'button.btn.btn-txt',
          {
            onclick: () => {
              ui.show('sketch');
              app.input?.emit?.('sketch:mode', 'tap');
            },
          },
          'Tap it in Sketch',
        ),
      );
    empty.replaceChildren(h('div.dg-empty-card.empty', h('p', msg), h('div.dg-empty-actions', actions)));
  }
  function newBeat(t) {
    const b = bpb();
    const end = t.clips.reduce((m, c) => Math.max(m, c.start + c.length), 0);
    const start = Math.max(end, Math.floor((engine.beat || 0) / b) * b);
    const r = store.dispatch(
      {
        type: 'clip.add',
        track: t.id,
        clip: { kind: 'notes', start, length: b * 4, name: 'Beat', notes: [] },
        ref: 'c',
      },
      { by: 'you', label: `new beat on ${t.name}` },
    );
    if (r.ok) ui.select({ track: t.id, clip: r.created.c, notes: [] });
  }

  /* ======================================================= geometry */
  function geo() {
    const W = cells.w,
      H = cells.h;
    const steps = spb();
    perPage = clamp(Math.floor((W + 12) / (steps * 18 + 12)), 1, 4);
    const nb = Math.min(perPage, bars() - page * perPage);
    const gap = 12;
    const cw = (W - gap * (perPage - 1)) / (perPage * steps);
    const head = 20;
    const rh = clamp(Math.floor((H - head - 4) / Math.max(1, rows.length)), coarse() ? ROW_TOUCH : 16, 34);
    return { W, H, steps, nb, gap, cw, head, rh, barW: cw * steps };
  }
  function cellAt(x, y) {
    const g = geo();
    if (y < g.head) {
      const k = Math.floor(x / (g.barW + g.gap));
      return { header: true, bar: page * perPage + k };
    }
    const r = Math.floor((y - g.head) / g.rh);
    if (r < 0 || r >= rows.length) return null;
    const k = Math.floor(x / (g.barW + g.gap));
    const xi = x - k * (g.barW + g.gap);
    if (k >= g.nb || xi > g.barW) return null;
    const s = Math.floor(xi / g.cw);
    return { p: rows[r], i: (page * perPage + k) * g.steps + s, bar: page * perPage + k };
  }

  /* ======================================================= gestures */
  // A finger (pointer: touch): a drag scrolls the grid (up and down; a sideways swipe flips the bars), a tap toggles
  // the square, and a finger held still on a square (HOLD ms) starts painting from it, so a drag from there adds (or
  // clears) hits along the way. The first hold says so once. A mouse paints at once, as before.
  const HOLD = 350,
    HOLD_HINT = 'overdub:beat-hold-hint';
  let touchG = null; // { id, x, y, st, c, timer, pan }
  const cancelHold = () => {
    if (touchG?.timer) {
      clearTimeout(touchG.timer);
      touchG.timer = 0;
    }
  };
  function holdStart(g) {
    g.timer = 0;
    const have = index.get(g.c.p + ':' + g.c.i);
    paint = { mode: have ? 'remove' : 'add', v: 0.8, cells: new Map([[g.c.p + ':' + g.c.i, g.c]]), held: true };
    if (!have) audition(g.c.p, 0.8);
    try {
      navigator.vibrate?.(12);
    } catch {
      /* no buzz */
    }
    let first = false;
    try {
      first = localStorage.getItem(HOLD_HINT) !== '1';
      if (first) localStorage.setItem(HOLD_HINT, '1');
    } catch {
      first = false;
    }
    const what = paint.mode === 'add' ? 'adds hits' : 'clears hits';
    if (first)
      ui.toast(
        `Holding a square starts painting: keep holding and drag along to add more. A drag without holding scrolls; a tap adds one hit.`,
        { ms: 7000 },
      );
    else ui.announce?.(`Painting: a drag ${what}.`);
    dirty = true;
  }
  cellWrap.addEventListener('pointerdown', (e) => {
    if (!cur || e.button !== 0) return;
    ui.state.focus = 'drumgrid';
    const r = cellWrap.getBoundingClientRect();
    const c = cellAt(e.clientX - r.left, e.clientY - r.top);
    if (!c) return;
    focusBar = clamp(c.bar, 0, bars() - 1);
    syncBar();
    if (c.header) {
      dirty = true;
      return;
    }
    if (e.pointerType === 'touch') {
      cancelHold();
      touchG = { id: e.pointerId, x: e.clientX, y: e.clientY, st: main.scrollTop, c, pan: false, timer: 0 };
      const g = touchG;
      g.timer = setTimeout(() => {
        if (touchG === g && !g.pan) holdStart(g);
      }, HOLD);
      cellWrap.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    const have = index.get(c.p + ':' + c.i);
    if (e.shiftKey) {
      // cycle accent -> hit -> ghost -> accent
      if (have) {
        const k = LEVELS.findIndex((v) => Math.abs(v - have.v) < 0.08);
        const v = LEVELS[(k + 1) % LEVELS.length];
        store.dispatch(
          { type: 'notes.set', track: cur.t.id, clip: cur.c.id, notes: [{ id: have.id, v }] },
          { by: 'you', label: `${v === 1 ? 'accent' : v === 0.8 ? 'hit' : 'ghost'} ${rowName(c.p)}` },
        );
        audition(c.p, v);
      } else commit({ mode: 'add', v: 1, cells: new Map([[c.p + ':' + c.i, c]]) });
      return;
    }
    paint = { mode: have ? 'remove' : 'add', v: 0.8, cells: new Map([[c.p + ':' + c.i, c]]) };
    if (!have) audition(c.p, 0.8);
    cellWrap.setPointerCapture(e.pointerId);
    e.preventDefault();
    dirty = true;
  });
  cellWrap.addEventListener('pointermove', (e) => {
    const g = touchG && e.pointerId === touchG.id ? touchG : null;
    if (g && !paint) {
      // a finger that moves before the hold: it scrolls, and paints nothing
      const dx = e.clientX - g.x,
        dy = e.clientY - g.y;
      if (!g.pan && Math.hypot(dx, dy) <= 8) return;
      if (!g.pan) {
        g.pan = true;
        cancelHold();
      }
      main.scrollTop = g.st - dy;
      return;
    }
    const r = cellWrap.getBoundingClientRect();
    const c = cur ? cellAt(e.clientX - r.left, e.clientY - r.top) : null;
    const hk = c && !c.header ? c.p + ':' + c.i : null;
    if (e.pointerType !== 'touch' && hk !== hover) {
      hover = hk;
      dirty = true;
    }
    cellWrap.style.cursor = c ? 'pointer' : 'default';
    if (!paint || !c || c.header) return;
    const key = c.p + ':' + c.i;
    if (paint.cells.has(key)) return;
    const have = index.has(key);
    if ((paint.mode === 'add' && !have) || (paint.mode === 'remove' && have)) {
      paint.cells.set(key, c);
      if (paint.mode === 'add') audition(c.p, 0.7);
      dirty = true;
    }
  });
  cellWrap.addEventListener('pointerleave', () => {
    if (hover) {
      hover = null;
      dirty = true;
    }
  });
  cellWrap.addEventListener('pointerup', (e) => {
    const g = touchG && e.pointerId === touchG.id ? touchG : null;
    if (g) {
      cancelHold();
      touchG = null;
      if (!paint && g.pan) {
        // a sideways swipe flips the bars (the grid only scrolls up and down)
        const dx = e.clientX - g.x,
          dy = e.clientY - g.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setPage(page + (dx < 0 ? 1 : -1));
        return;
      }
      if (!paint) {
        // a tap: that square on (or off)
        const have = index.get(g.c.p + ':' + g.c.i);
        if (!have) audition(g.c.p, 0.8);
        commit({ mode: have ? 'remove' : 'add', v: 0.8, cells: new Map([[g.c.p + ':' + g.c.i, g.c]]) });
        return;
      }
    }
    if (paint) {
      const p = paint;
      paint = null;
      commit(p);
    }
  });
  cellWrap.addEventListener('pointercancel', (e) => {
    if (touchG && e.pointerId === touchG.id) {
      cancelHold();
      touchG = null;
    }
    paint = null;
    dirty = true;
  });
  function commit(p) {
    if (!cur || !p.cells.size) return;
    const T = cur.t.id,
      C = cur.c.id;
    const len = cur.c.length;
    if (p.mode === 'add') {
      const notes = [...p.cells.values()]
        .filter((c) => !index.has(c.p + ':' + c.i) && c.i * STEP < len)
        .map((c) => ({
          p: c.p,
          t: Math.round((c.i * STEP + (c.i % 2 ? swingDelay() : 0)) * 10000) / 10000,
          d: STEP,
          v: p.v,
        }));
      if (notes.length)
        store.dispatch(
          { type: 'notes.add', track: T, clip: C, notes },
          { by: 'you', label: notes.length > 1 ? `add ${notes.length} hits` : `add ${rowName(notes[0].p)}` },
        );
    } else {
      const ids = [...p.cells.keys()].map((k) => index.get(k)?.id).filter(Boolean);
      if (ids.length)
        store.dispatch(
          { type: 'notes.remove', track: T, clip: C, ids },
          { by: 'you', label: ids.length > 1 ? `remove ${ids.length} hits` : 'remove hit' },
        );
    }
    dirty = true;
  }
  overWrap.addEventListener('pointerdown', (e) => {
    if (!cur) return;
    const r = overWrap.getBoundingClientRect();
    const b = Math.floor(((e.clientX - r.left) / r.width) * bars());
    focusBar = clamp(b, 0, bars() - 1);
    setPage(Math.floor(focusBar / perPage));
  });

  const mine = () => ui.state.focus === 'drumgrid' && !!cur && ui.visible('drumgrid');
  const offs = [
    ui.keys.add({ key: 'ArrowRight', when: mine, run: () => setPage(page + 1), label: 'Later bars', group: 'Beat' }),
    ui.keys.add({ key: 'ArrowLeft', when: mine, run: () => setPage(page - 1), label: 'Earlier bars', group: 'Beat' }),
    ui.keys.add({ key: 'KeyC', mod: 'mod', when: mine, run: copyBar, label: 'Copy the focused bar', group: 'Beat' }),
    ui.keys.add({
      key: 'KeyV',
      mod: 'mod',
      when: () => mine() && !!barClip,
      run: pasteBar,
      label: 'Paste over the focused bar',
      group: 'Beat',
    }),
    ui.keys.add({ key: 'Delete', when: mine, run: clearBar, label: 'Clear the focused bar', group: 'Beat' }),
    ui.keys.add({ key: 'Backspace', when: mine, run: clearBar, label: 'Clear the focused bar', group: 'Beat' }),
  ];

  /* ======================================================= drawing */
  function draw(now) {
    const { g } = cells;
    const pal = palette();
    const G = geo();
    g.clearRect(0, 0, G.W, G.H);
    g.fillStyle = pal.panel;
    g.fillRect(0, 0, G.W, G.H);
    if (!cur) return;
    const col = resolveColor(cur.c.color || cur.t.color);
    const playing = engine.playing;
    const ph = (engine.beat || 0) - cur.c.start;
    const phStep = ph >= 0 && ph < cur.c.length ? Math.floor(ph / STEP) : -1;
    const presence = presenceList(ui).filter((p) => p.clip === cur.c.id || (p.track === cur.t.id && p.range));
    const presIds = new Set(presence.flatMap((p) => p.notes || []));
    g.textBaseline = 'middle';
    for (let k = 0; k < G.nb; k++) {
      const b = page * perPage + k;
      const x0 = k * (G.barW + G.gap);
      // bar header
      const focused = b === focusBar;
      g.font = `700 10.5px ${pal.mono}`;
      g.fillStyle = focused ? pal.text : pal.text3;
      g.fillText(`${Math.floor(cur.c.start / bpb()) + b + 1}`, x0 + 2, 9);
      if (focused) {
        g.fillStyle = rgba(pal.accent2, 0.8);
        g.fillRect(x0 + 2, 16, G.barW - 4, 2);
      } else {
        g.fillStyle = pal.line;
        g.fillRect(x0 + 2, 16, G.barW - 4, 1);
      }
      for (let s = 0; s < G.steps; s++) {
        const i = b * G.steps + s;
        const x = x0 + s * G.cw;
        const beatGroup = Math.floor(s / 4) % 2;
        const past = i * STEP >= cur.c.length;
        // playhead column
        if (i === phStep && (playing || ph > 0)) {
          g.fillStyle = rgba(pal.accent, playing ? 0.16 : 0.07);
          g.fillRect(x, G.head - 2, G.cw, rows.length * G.rh + 2);
        }
        rows.forEach((p, r) => {
          const y = G.head + r * G.rh;
          const key = p + ':' + i;
          let n = index.get(key);
          if (paint && paint.cells.has(key)) n = paint.mode === 'add' ? { p, v: paint.v, by: 'you' } : null;
          const pad = Math.max(1.5, Math.min(3, G.cw * 0.1));
          const cx = x + pad,
            cy = y + pad,
            cw = G.cw - pad * 2,
            chh = G.rh - pad * 2;
          if (!n) {
            g.fillStyle = past ? rgba(pal.bg, 0.4) : beatGroup ? rgba(pal.bg3, 0.9) : rgba(pal.bg2, 1);
            roundRect(g, cx, cy, cw, chh, 2);
            g.fill();
            if (hover === key && !past) {
              g.strokeStyle = rgba(col, 0.7);
              g.lineWidth = 1;
              g.stroke();
            }
            return;
          }
          const v = n.v;
          const lvl = v >= 0.95 ? 2 : v >= 0.6 ? 1 : 0;
          g.fillStyle = lvl === 0 ? rgba(col, 0.42) : lvl === 1 ? rgba(col, 0.86) : shade(col, 0.18);
          if (lvl === 0) {
            const sh = chh * 0.5;
            roundRect(g, cx, cy + (chh - sh), cw, sh, 2);
          } else roundRect(g, cx, cy, cw, chh, 2);
          g.fill();
          if (lvl === 2) {
            g.fillStyle = 'rgba(255,255,255,.55)';
            g.fillRect(cx + 3, cy + 2.5, Math.max(2, cw - 6), 1.5);
          }
          if (past) {
            g.fillStyle = rgba(pal.bg, 0.55);
            roundRect(g, cx, cy, cw, chh, 2);
            g.fill();
          }
          // who wrote the hit: a warm (person) or cool (agent) outline; the house's hits have none
          const ak = authorKind(app, n.by || cur.c.by);
          if (ak !== 'house') {
            g.strokeStyle = ak === 'agent' ? pal.agent : pal.human;
            g.lineWidth = 1;
            roundRect(g, cx + 0.5, cy + 0.5, cw - 1, chh - 1, 1.5);
            g.stroke();
          }
          if (hover === key) {
            g.strokeStyle = pal.text;
            g.lineWidth = 1;
            roundRect(g, cx, cy, cw, chh, 2);
            g.stroke();
          }
          const fl = n.id ? flash.level(cur.c.id + ':' + n.id, now) : 0;
          if (fl > 0 || (n.id && presIds.has(n.id))) {
            // an agent's change: crop marks in its ink, then gone; pointed at: grease-pencil crop marks (no glow, no pulse)
            g.save();
            if (fl > 0) {
              g.globalAlpha = Math.min(1, fl * 4);
              drawCrop(g, cx, cy, cw, chh, { color: pal.agent, len: 6, out: 1 });
            } else drawCrop(g, cx, cy, cw, chh, { color: pal.accent2, len: 6, out: 1 });
            g.restore();
          }
        });
      }
    }
    // the agent pointing at this clip (or bars of it): crop marks round the grid and one line, "Claude: <note>", over
    // its top right corner, as the arranger draws it
    for (const pr of presence) {
      if (pr.notes?.length && !pr.note) continue;
      const who = authorName(app, pr.by || 'claude');
      drawCrop(g, 4, G.head, G.W - 8, rows.length * G.rh - 1, {
        color: pal.accent2,
        label: pr.note ? `${who}: ${pr.note}` : who,
      });
    }
  }
  function drawOver() {
    const { g, w: W, h: H } = over;
    const pal = palette();
    g.clearRect(0, 0, W, H);
    if (!cur) return;
    const n = bars();
    const bw = W / n;
    const col = resolveColor(cur.t.color);
    const counts = new Array(n).fill(0);
    for (const x of cur.c.notes) {
      const b = Math.floor(stepOf(x.t) / spb());
      if (b >= 0 && b < n) counts[b]++;
    }
    const max = Math.max(1, ...counts);
    for (let b = 0; b < n; b++) {
      const onPage = b >= page * perPage && b < (page + 1) * perPage;
      const x = b * bw;
      g.fillStyle = onPage ? rgba(col, 0.2) : rgba(pal.bg3, 0.8);
      roundRect(g, x + 1, 2, bw - 2, H - 4, 3);
      g.fill();
      if (onPage) {
        g.strokeStyle = rgba(col, 0.8);
        g.lineWidth = 1;
        g.stroke();
      }
      g.fillStyle = rgba(col, 0.75);
      const bh = (counts[b] / max) * (H - 10);
      g.fillRect(x + 4, H - 4 - bh, Math.max(2, bw - 8), bh);
      if (bw > 18) {
        g.font = `600 9px ${pal.mono}`;
        g.fillStyle = onPage ? pal.text : pal.text3;
        g.textBaseline = 'top';
        g.fillText(String(Math.floor(cur.c.start / bpb()) + b + 1), x + 4, 4);
      }
    }
    const ph = (engine.beat || 0) - cur.c.start;
    if (ph >= 0 && ph < cur.c.length) {
      g.fillStyle = pal.accent;
      g.fillRect((ph / (n * bpb())) * W, 0, 1.5, H);
    }
  }

  /* ======================================================= events */
  const offSel = ui.on('select', () => pick());
  const offPres = ui.on('presence', () => {
    dirty = true;
  });
  const offResize = ui.on('resize', () => {
    dirty = true;
  });
  function onChange(evt) {
    if (store.isAgent?.(evt.by) && (evt.kind === 'do' || evt.kind === 'redo')) {
      const tch = touched(evt);
      const now = performance.now();
      for (const [clip, ids] of tch.notes) {
        const f = store.findClip(clip);
        if (!f) continue;
        for (const id of ids === 'all' ? f.clip.notes.map((n) => n.id) : ids) flash.mark(clip + ':' + id, now);
      }
    }
    pick();
  }
  let lastPage = -1;
  function frame(now) {
    // under a finger the rows keep their height and the grid scrolls (up and down) rather than squeezing them
    const touchy = coarse();
    if (touchy !== root.classList.contains('dg-touch')) root.classList.toggle('dg-touch', touchy);
    if (touchy) {
      const need = 20 + 4 + Math.max(1, rows.length) * ROW_TOUCH + 'px';
      if (main.style.getPropertyValue('--dg-h') !== need) main.style.setProperty('--dg-h', need);
    }
    // more rows than fit at 16 px (a kit's strokes added with More rows): the grid scrolls up and down, as under a finger
    const tall = !touchy && !!cur && 24 + rows.length * 16 > main.clientHeight;
    if (tall !== root.classList.contains('dg-scroll')) {
      root.classList.toggle('dg-scroll', tall);
      dirty = true;
    }
    if (tall) {
      const need = 24 + rows.length * 16 + 'px';
      if (main.style.getPropertyValue('--dg-h') !== need) main.style.setProperty('--dg-h', need);
    }
    if (cells.fit() | over.fit()) {
      dirty = true;
      const pp = perPage;
      geo();
      if (pp !== perPage) setPage(Math.floor(focusBar / perPage));
    }
    // follow the playhead across pages
    if (cur && engine.playing && !paint) {
      const ph = (engine.beat || 0) - cur.c.start;
      if (ph >= 0 && ph < cur.c.length) {
        const pg = Math.floor(Math.floor(ph / bpb()) / perPage);
        if (pg !== page && pg !== lastPage) {
          lastPage = pg;
          setPage(pg);
        }
      }
    }
    if (!dirty && !engine.playing && !flash.active() && !presenceList(ui).length) return;
    // rows match the canvas
    const G = geo();
    labels.style.setProperty('--rh', G.rh + 'px');
    labels.style.setProperty('--head', G.head + 'px');
    draw(now);
    drawOver();
    dirty = false;
  }
  root.addEventListener(
    'pointerdown',
    () => {
      ui.state.focus = 'drumgrid';
    },
    true,
  );
  pick();
  app.drumgrid = {
    setPage,
    copyBar,
    pasteBar,
    clearBar,
    moreRows,
    addRow: (p) => cur && addRow(cur.t.id, p),
    rows: () => rows.map((p) => ({ p, name: rowName(p) })),
    page: () => page,
    perPage: () => perPage,
    rowH: () => geo().rh,
    scroller: () => main,
  };
  return {
    update: onChange,
    frame,
    refresh() {
      dirty = true;
      pick();
    },
    unmount() {
      offSel();
      offPres();
      offResize();
      offs.forEach((f) => f());
    },
  };
}

const CSS = `
.dg { position: relative; display: grid; grid-template-rows: 36px 26px 1fr; height: 100%; min-height: 0; background: var(--panel); container: dg / inline-size; }
.dg-bar { display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--line); min-width: 0; overflow: hidden; }
.dg-clip { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; flex: 0 1 auto; }
/* the clip's name gives way first, then "on Drums"; the byline is never cut ("by yo") */
.dg-clip b { flex: 0 1 auto; min-width: 2.5em; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
.dg-on { flex: 0 10 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-3); }
.dg-by, .dg-dot { flex: none; }
.dg-hint { position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center; padding: 0 8px; font-size: 12px; color: var(--text); background: color-mix(in srgb, var(--panel) 70%, transparent); pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dg-hint[hidden] { display: none; }
/* a pane under 900 px: the tools give the clip's name room (the slider shortens, Copy and Clear are their icons) */
@container dg (max-width: 900px) {
  .dg-swingwrap .dg-lbl { display: none; }
  .dg-swing { width: 64px; }
  .dg-btn > .ico + span { display: none; }
  .dg-on { display: none; }
}
.dg-dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.dg-sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; flex: none; }
.dg-flex { flex: 1; min-width: 4px; }
.dg-swingwrap { display: flex; align-items: center; gap: 8px; flex: none; }
.dg-lbl { font-size: 11.5px; font-weight: 600; color: var(--text-3); }
.dg-swing { width: 96px; accent-color: var(--accent-2); }
.dg-swingval { font: 600 11px var(--font-mono); color: var(--text); min-width: 32px; }
.dg-pager { display: flex; align-items: center; gap: 2px; flex: none; }
.dg-page { font: 600 11.5px var(--font-mono); color: var(--text-2); padding: 0 6px; white-space: nowrap; }
.dg-btn { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border: 0; border-radius: var(--r-1); background: transparent; color: var(--text-2); cursor: pointer; font-size: 12px; font-weight: 600; flex: none; }
.dg-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--text); }
.dg-btn:disabled { opacity: .35; cursor: default; }
.dg-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.dg-ico { width: 26px; padding: 0; justify-content: center; }
.dg-flip { display: inline-grid; transform: scaleX(-1); }
.dg-overwrap { position: relative; margin: 0 10px 0 ${LABEL_W + 10}px; cursor: pointer; }
.dg-over { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.dg-main { display: grid; grid-template-columns: ${LABEL_W}px 1fr; gap: 10px; padding: 4px 10px 10px; min-height: 0; }
.dg-labels { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.dg-lhead { height: var(--head, 20px); flex: none; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11px; font-weight: 600; color: var(--text-3); padding: 0 4px 0 8px; }
.dg-more { height: 18px; padding: 0 4px; border: 0; background: transparent; color: var(--text-2); font: inherit; font-weight: 600; cursor: pointer; border-radius: var(--r-1); white-space: nowrap; }
.dg-more:hover, .dg-more:focus-visible { color: var(--text); background: var(--bg-3); }
.dg-row { display: flex; align-items: center; gap: 8px; height: var(--rh, 26px); flex: none; padding: 0 8px; border: 0; border-radius: var(--r-1); background: transparent; color: var(--text-3); cursor: pointer; text-align: left; font-size: 12px; font-weight: 600; }
.dg-row:hover { background: var(--bg-3); color: var(--text); }
.dg-row:active { background: color-mix(in srgb, var(--tc) 30%, transparent); }
.dg-row.used { color: var(--text); }
.dg-rowdot { width: 7px; height: 7px; background: var(--line-2); flex: none; }
.dg-row.used .dg-rowdot { background: var(--tc); }
.dg-rowname { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dg-rowcount { font: 600 10px var(--font-mono); color: var(--text-3); }
.dg-cellwrap { position: relative; min-width: 0; min-height: 0; touch-action: none; }
.dg-cells { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
/* a touch screen: squares a finger can hit (ROW_TOUCH px), and the rows scroll under a drag */
.dg-touch .dg-main, .dg-scroll .dg-main { overflow: hidden auto; overscroll-behavior: contain; }
.dg-touch .dg-cellwrap, .dg-touch .dg-labels, .dg-scroll .dg-cellwrap, .dg-scroll .dg-labels { min-height: var(--dg-h, 0px); }
.dg-empty { position: absolute; inset: 0; display: none; place-items: center; padding: 20px; background: var(--panel); }
.dg-isempty .dg-empty { display: grid; }
.dg-empty-card { max-width: 46ch; }
.dg-empty-actions { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.dg-by { color: var(--text-3); font-size: 12px; }
@media (max-width: 760px) {
  .dg-main { grid-template-columns: 76px 1fr; gap: 6px; padding: 4px 6px 8px; }
  .dg-overwrap { margin-left: 88px; }
  .dg-on, .dg-btn > .ico + span, .dg-swing, .dg-sep, .dg-rowcount { display: none; }
  .dg-row { padding: 0 4px; gap: 5px; font-size: 11px; }
  /* a phone: the clip's name and byline are a line of their own over the tools */
  .dg { grid-template-rows: auto 26px 1fr; }
  .dg-bar { flex-wrap: wrap; row-gap: 0; padding: 4px 10px; }
  .dg-clip { flex: 1 0 100%; height: 28px; }
  .dg-swingwrap .dg-lbl { display: inline; }
  .dg-hint { font-size: 11px; }
}
`;
