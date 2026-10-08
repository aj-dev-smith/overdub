// The piano roll [ui-arrange]: the "Notes" tab. Edits the selected notes clip. Every edit is a notes.* op by 'you';
// a drag is previewed locally and committed as one transaction on release (one undo step).
//
//   draw tool: click/drag on empty draws (mod-drag: marquee)   select tool: drag on empty = marquee
//   drag a note: move (shift: no snap, alt: copy) · its right edge: resize · double-click: delete
//   Delete · ↑/↓ transpose (shift: octave; scale-aware when Scale lock is on) · ←/→ nudge · Q quantize · mod+A/C/V/D
//   the keyboard auditions; the velocity lane below sets how hard each note is played.
// Scale lock is the one Sketch's keys use (input.qwerty.scaleLock: on until you turn it off, wherever you turn it off):
// with the song in a key, notes you draw, move and transpose land in it, and the rows outside it are shaded. Drum clips
// ignore it. Every C and the key's root are named on the keyboard; at the default 16 px rows, every note in the key is.

import { h, css, canvas, clamp, byline } from './dom.js';
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
  drawLabel,
  roundRect,
  snapTo,
  floorTo,
  SNAPS,
  snapLabel,
  menu,
  popover,
  closePopover,
  MOD,
  touchFirst,
} from './arrange-kit.js';
import { TRANSFORMS, findTransform, runTransform } from '../core/transforms.js';
import { mountRollTab } from './tabstaff.js';

// the agent pointing: four 10 px L-shaped grease-pencil marks at the corners (the kit's .crop, drawn)
function cropMarks(g, x, y, w, hh, color) {
  const k = Math.min(10, w / 3, hh / 3);
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.lineCap = 'square';
  g.beginPath();
  g.moveTo(x, y + k);
  g.lineTo(x, y);
  g.lineTo(x + k, y);
  g.moveTo(x + w - k, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + k);
  g.moveTo(x, y + hh - k);
  g.lineTo(x, y + hh);
  g.lineTo(x + k, y + hh);
  g.moveTo(x + w - k, y + hh);
  g.lineTo(x + w, y + hh);
  g.lineTo(x + w, y + hh - k);
  g.stroke();
  g.restore();
}

const KEYS_W = 60,
  RULER_H = 22,
  VEL_H = 68;
const ROW_H = 16; // a row at the default zoom: a click lands on the note you aimed at, and its name fits
const BLACK = new Set([1, 3, 6, 8, 10]);

export default function (app) {
  css('pianoroll', CSS);
  app.ui.panel({
    id: 'pianoroll',
    region: 'bottom',
    title: 'Notes',
    icon: 'keys',
    order: 10,
    mount: (el) => mountRoll(el, app),
  });
  // open melodic clips here (the beat grid opens drum clips)
  app.ui.on('edit-clip', (d) => {
    if (d.handled) return;
    const f = app.store.findClip(d.clip);
    if (!f || f.clip.kind !== 'notes') return;
    if (isDrumTrack(app, f.track) && app.ui.panels.has('drumgrid')) return;
    app.ui.select({ track: f.track.id, clip: f.clip.id });
    app.ui.show('pianoroll');
    d.handled = true;
  });
}

function mountRoll(el, app) {
  const { store, engine, ui, music } = app;
  const st = ui.state;
  if (st.prGhosts == null) st.prGhosts = true;
  if (!st.quantize) st.quantize = { strength: 100, swing: 0 };
  let tool = 'draw';

  /* ======================================================= DOM */
  const clipLabel = h('div.pr-clip');
  // The toolbar in the kit's words (design/LINER-NOTES-KIT.md): the tool, Scale and Ghosts stay on, so they are
  // toggles with a lamp; Grid, Quantize and Transform open something, so they are underlined words. No icons: a
  // newcomer reads "Grid 1/16" where a magnet said nothing.
  const toolSel = h(
    'button.tog.pr-tool',
    {
      type: 'button',
      'aria-pressed': 'false',
      title: 'Select tool (1): drag on empty space to select',
      onclick: () => setTool('select'),
    },
    'Select',
  );
  const toolDraw = h(
    'button.tog.pr-tool',
    {
      type: 'button',
      'aria-pressed': 'false',
      title: `Draw tool (2): click to add a note, drag for its length (${MOD}drag selects)`,
      onclick: () => setTool('draw'),
    },
    'Draw',
  );
  const snapBtn = h('button.btn.btn-txt.pr-tool.pr-snap', {
    type: 'button',
    'aria-haspopup': 'menu',
    title: 'Grid: where notes land (shift while dragging ignores it)',
    onclick: () =>
      menu(snapBtn, [
        { head: 'Grid' },
        ...SNAPS.map(([v, l]) => ({
          label: l,
          sub: Math.abs(st.snap - v) < 1e-6 ? '●' : '',
          run: () => {
            st.snap = v;
            ui.emit('snap', v);
            syncBar();
            dirty = true;
          },
        })),
      ]),
  });
  const scaleBtn = h(
    'button.tog.pr-tool.pr-lock',
    { type: 'button', 'aria-pressed': 'false', onclick: () => setLocked(!locked()) },
    'Scale lock',
  );
  const ghostBtn = h(
    'button.tog.pr-tool.pr-ghost',
    {
      type: 'button',
      'aria-pressed': 'false',
      title: 'Ghosts: the other tracks’ notes, drawn faintly behind this clip, so you can see what yours play against',
      onclick: () => {
        st.prGhosts = !st.prGhosts;
        syncBar();
        dirty = true;
      },
    },
    'Ghosts',
  );
  const qBtn = h(
    'button.btn.btn-txt.pr-tool',
    {
      type: 'button',
      'aria-haspopup': 'dialog',
      title: 'Quantize (Q): pull notes toward the grid, with strength and swing',
      onclick: () => openQuantize(),
    },
    'Quantize',
  );
  const txBtn = h(
    'button.btn.btn-txt.pr-tool',
    {
      type: 'button',
      'aria-haspopup': 'dialog',
      title:
        'Transform: reshape the selected notes, or the whole clip: humanize, strum, invert, double, write more. One undo each.',
      onclick: () => openTransform(),
    },
    'Transform',
  );
  // Tab: a pitched clip as guitar tab (ui/tabstaff.js), the same notes; a part written as tab opens that way
  const tabBtn = h(
    'button.tog.pr-tool.pr-tabbtn',
    {
      type: 'button',
      'aria-pressed': 'false',
      title: 'Tab: this clip as guitar tab, frets on strings. The same notes: an edit in either is an edit in both.',
      onclick: () => setTab(!tabOn()),
    },
    'Tab',
  );
  const chord = h('div.pr-chord', { title: 'The chord the selected notes make' });
  const count = h('div.pr-count');
  const bar = h(
    'div.pr-bar',
    clipLabel,
    h('div.pr-sep'),
    h('div.pr-seg', { role: 'group', 'aria-label': 'Tool' }, toolSel, toolDraw),
    h('div.pr-sep'),
    snapBtn,
    scaleBtn,
    qBtn,
    txBtn,
    ghostBtn,
    tabBtn,
    h('div.pr-flex'),
    chord,
    count,
  );

  const ruler = canvas('pr-ruler');
  const keys = canvas('pr-keys');
  const grid = canvas('pr-grid');
  const vel = canvas('pr-vel');
  const spacer = h('div.pr-spacer');
  const scroller = h(
    'div.pr-scroll',
    {
      tabindex: 0,
      role: 'application',
      'aria-roledescription': 'piano roll',
      'aria-label':
        'Notes of the selected clip. Alt+arrows pick a note (Shift adds), arrows move it, Delete removes it.',
    },
    spacer,
  );
  const said = h('p.sr-only', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  const gridWrap = h('div.pr-gridwrap', grid.cv, scroller);
  const velWrap = h('div.pr-velwrap', vel.cv);
  const main = h(
    'div.pr-main',
    h('div.pr-corner'),
    h('div.pr-rulerwrap', ruler.cv),
    h('div.pr-keyswrap', keys.cv),
    gridWrap,
    h(
      'div.pr-velcorner',
      { title: 'Velocity: how hard each note is played. Drag a stalk up for louder, down for softer.' },
      h('span', 'VEL'),
    ),
    velWrap,
  );
  const empty = h('div.pr-empty');
  const root = h('div.pr', bar, main, empty, said);
  el.append(root);
  const tabView = mountRollTab(app, {
    cur: () => cur,
    active: () => mine() && tabOn(),
    sel: () => sel(),
    setSel: (ids) => setSel(ids),
    lockOn: () => lockOn(),
    nameOf: (p) => nameOf(p),
    say: (t) => {
      said.textContent = '';
      setTimeout(() => {
        said.textContent = t;
      }, 30);
    },
  });
  root.append(tabView.el);
  const hasTab = (c) => !!c.tuning || c.notes.some((n) => Number.isInteger(n.s));
  const tabOn = () => !!cur && !isDrumTrack(app, cur.t) && (st.prTab != null ? !!st.prTab : hasTab(cur.c));
  function setTab(v) {
    st.prTab = !!v;
    syncBar();
    dirty = true;
  }

  /* ======================================================= state */
  let cur = null; // { t: track, c: clip }
  let ppb = 60,
    rowH = ROW_H;
  let userRowH = null; // the row height you zoomed to (alt+wheel), kept from clip to clip
  let dirty = true,
    viewFor = null;
  let drag = null; // gesture
  let pv = null; // Map noteId -> { p, t, d, v } preview overrides
  let adds = null; // preview of notes being added [{ p, t, d, v }]
  let marquee = null;
  let lastLen = 0.5,
    lastVel = 0.8;
  let clipboard = null;
  let heldKey = null;
  let hoverNote = null;
  const flash = flasher(1400);
  const sel = () => st.selection.notes || new Set();

  const findCur = () => {
    const id = st.selection.clip;
    if (!id) return null;
    const f = store.findClip(id);
    return f && f.clip.kind === 'notes' ? { t: f.track, c: f.clip } : null;
  };
  const bpb = () => music.beatsPerBar(store.get().meter);
  const grid0 = (e) => (e?.shiftKey ? 0 : st.snap || 0);
  const contentBeats = () => (cur ? Math.ceil((cur.c.length + bpb() * 2) / bpb()) * bpb() : 16);
  function layout() {
    spacer.style.width = Math.round(Math.max(contentBeats() * ppb, scroller.clientWidth)) + 'px';
    spacer.style.height = 128 * rowH + 'px';
  }
  // Scale lock: the one Sketch's keys use, so Notes and the keys keep the same rule (st.scaleSnap without an input layer)
  const qwerty = () => app.input?.qwerty || null;
  const locked = () => {
    const q = qwerty();
    return q ? q.scaleLock !== false : st.scaleSnap !== false;
  };
  function setLocked(v) {
    const q = qwerty();
    if (q?.setScaleLock) q.setScaleLock(v);
    else st.scaleSnap = !!v;
    syncBar();
    dirty = true;
  }
  // it holds when the song has a key and the clip is pitched (a drum clip's rows are drums, not notes)
  const keyOf = () => store.get().key || null;
  const lockOn = () => locked() && !!keyOf() && !!cur && !isDrumTrack(app, cur.t);
  // a note's name, spelled for the song's key (Eb in C minor, never D#); a drum clip's rows are plain
  const nameOf = (p) => {
    const key = cur && !isDrumTrack(app, cur.t) ? keyOf() : null;
    return key ? music.spellNote(p, key) : music.noteName(p);
  };
  // what a row is, for the keyboard and the grid: in the key or not, the root, every C, and the name it shows
  function rowInfo(q) {
    const key = cur && !isDrumTrack(app, cur.t) ? keyOf() : null;
    const pc = ((q % 12) + 12) % 12;
    const inKey = key ? music.inScale(q, key) : !BLACK.has(pc);
    const root = !!key && music.parsePc(key.root) === pc;
    const name = nameOf(q);
    const label = pc === 0 || root || (rowH >= 15 && (key ? inKey : true)) ? name : '';
    return { p: q, inKey, root, c: pc === 0, label, shaded: !!key && !inKey };
  }
  function setTool(t) {
    tool = t;
    syncBar();
    scroller.style.cursor = t === 'draw' ? 'crosshair' : 'default';
  }

  function syncBar() {
    const lamp = (b, on) => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    };
    lamp(toolSel, tool === 'select');
    lamp(toolDraw, tool === 'draw');
    snapBtn.textContent = 'Grid ' + snapLabel(st.snap || 0);
    lamp(scaleBtn, locked());
    const key = keyOf();
    scaleBtn.title =
      cur && isDrumTrack(app, cur.t)
        ? 'Scale lock: for pitched parts; a drum clip’s rows are drums, so it leaves them alone'
        : key
          ? `Scale lock: notes you draw, move and transpose land only in ${music.keyLabel(key)}, so no note sounds wrong`
          : 'Scale lock: the song has no key yet, so every note is allowed; set one in Key at the top';
    lamp(ghostBtn, !!st.prGhosts);
    tabBtn.hidden = !cur || isDrumTrack(app, cur.t);
    lamp(tabBtn, tabOn());
    root.classList.toggle('pr-istab', tabOn());
    if (tabOn()) tabView.sync();
    if (cur) {
      // the clip's name, its track, and who wrote it (a byline; the house is unsigned)
      clipLabel.replaceChildren(
        h('span.pr-dot', { style: { background: resolveColor(cur.c.color || cur.t.color) } }),
        h('b', cur.c.name || cur.t.name),
        ...(cur.c.name && cur.c.name !== cur.t.name ? [h('span.pr-on', `on ${cur.t.name}`)] : []),
        ...(byline(cur.c.by, { app }) ? [h('span.pr-by', ' by ', byline(cur.c.by, { app }))] : []),
      );
      const s = [...sel()];
      const notes = cur.c.notes.filter((n) => sel().has(n.id));
      const name =
        notes.length >= 2
          ? music.chordName(
              notes.map((n) => n.p),
              app.store.get().key,
            )
          : notes.length === 1
            ? nameOf(notes[0].p)
            : '';
      chord.textContent = name;
      chord.hidden = !name;
      count.textContent = s.length
        ? `${s.length} of ${cur.c.notes.length} selected`
        : `${cur.c.notes.length} note${cur.c.notes.length === 1 ? '' : 's'}`;
    }
  }

  /* ======================================================= empty states */
  function syncEmpty() {
    const id = st.selection.clip;
    const f = id ? store.findClip(id) : null;
    root.classList.toggle('pr-isempty', !cur);
    if (cur) {
      empty.replaceChildren();
      return;
    }
    // a sentence that says what to do, and a button (a second way in, if there is one, is an underlined word)
    let msg,
      actions = [];
    if (f && f.clip.kind === 'audio') {
      msg =
        'This is an audio clip, and Notes edits notes. Ask your agent to turn it into notes, or hum the line into Sketch.';
      if (ui.panels.has('sketch')) actions.push(h('button.btn', { onclick: () => ui.show('sketch') }, 'Open Sketch'));
    } else {
      const t = store.track(st.selection.track);
      // (a touch screen taps: the arranger opens a clip on a double tap and makes one on a double tap in an empty lane)
      msg = touchFirst()
        ? 'Pick a clip to see its notes. Tap one in the arranger, or double-tap an empty lane to start one.'
        : 'Pick a clip to see its notes. Click one in the arranger, or double-click an empty lane to start one.';
      if (t && t.kind === 'instrument')
        actions.push(h('button.btn', { onclick: () => newClip(t) }, `New clip on ${t.name}`));
      if (ui.panels.has('sketch'))
        actions.push(
          h(
            'button.btn' + (actions.length ? '.btn-txt' : ''),
            { onclick: () => ui.show('sketch') },
            'Hum or play it into Sketch',
          ),
        );
    }
    empty.replaceChildren(
      h('div.pr-empty-card.empty', h('p', msg), actions.length ? h('div.pr-empty-actions', actions) : null),
    );
  }
  function newClip(t) {
    const b = bpb();
    const start = floorTo(Math.max(0, engine.beat || 0), b);
    const r = store.dispatch(
      { type: 'clip.add', track: t.id, clip: { kind: 'notes', start, length: b * 4, notes: [] }, ref: 'c' },
      { by: 'you', label: `new clip on ${t.name}` },
    );
    if (r.ok) ui.select({ track: t.id, clip: r.created.c, notes: [] });
  }

  /* ======================================================= view */
  function resetView() {
    if (!cur) return;
    const W = Math.max(200, scroller.clientWidth || gridWrap.clientWidth || 600);
    ppb = clamp((W - 24) / Math.max(1, cur.c.length), 6, 400);
    layout();
    // rows stay 16 px (or what you zoomed to): a wide clip scrolls rather than shrinking every row to a sliver
    rowH = userRowH || ROW_H;
    layout();
    const ps = cur.c.notes.map((n) => n.p);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : isDrumTrack(app, cur.t) ? 42 : 62;
    const H = scroller.clientHeight || 200;
    scroller.scrollLeft = 0;
    scroller.scrollTop = Math.max(0, (127 - mid) * rowH - H / 2);
    viewFor = cur.c.id;
    dirty = true;
  }
  const xOf = (t) => t * ppb - scroller.scrollLeft;
  const yOf = (p) => (127 - p) * rowH - scroller.scrollTop;
  function at(e) {
    const r = scroller.getBoundingClientRect();
    const x = e.clientX - r.left + scroller.scrollLeft,
      y = e.clientY - r.top + scroller.scrollTop;
    return { x, y, t: x / ppb, p: 127 - Math.floor(y / rowH) };
  }
  const val = (n) => (pv && pv.get(n.id)) || n;
  function hitNote(pt) {
    if (!cur) return null;
    const ns = cur.c.notes;
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = val(ns[i]);
      if (n.p !== pt.p) continue;
      const x0 = n.t * ppb,
        x1 = (n.t + n.d) * ppb;
      if (pt.x >= x0 && pt.x <= x1 + 1) {
        const edge = Math.min(8, (x1 - x0) * 0.35);
        return { n: ns[i], zone: pt.x > x1 - edge ? 'r' : 'body' };
      }
    }
    return null;
  }
  // p may be fractional (where in the row the pointer is): an out-of-key row's top half lands on the note above
  const scaleP = (p) => (lockOn() ? music.snapToScale(p, keyOf()) : Math.round(p));
  const audition = (p, v = 0.8) => {
    if (cur) {
      try {
        engine.audition?.(cur.t.id, p, v, 0.35);
      } catch (_) {
        /* no sound yet */
      }
    }
  };
  const setSel = (ids) => {
    ui.select({ notes: [...ids] });
  };

  /* ======================================================= grid gestures */
  let lastDown = { t: 0, x: 0, y: 0, n: 0 };
  const clickCount = (e) => {
    const now = performance.now();
    const tol = e.pointerType === 'touch' ? 14 : 5; // a finger lands a little apart each time
    const near = Math.abs(e.clientX - lastDown.x) < tol && Math.abs(e.clientY - lastDown.y) < tol;
    lastDown = { t: now, x: e.clientX, y: e.clientY, n: near && now - lastDown.t < 380 ? lastDown.n + 1 : 1 };
    return lastDown.n;
  };
  let lastHit = null;
  // touch: a finger on a note moves it; on empty grid a tap is the tool's tap and a drag scrolls (there is no wheel)
  const touchPan = (e) =>
    e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop } : null;
  const fingerHit = (e, pt) =>
    hitNote(pt) ||
    (e.pointerType === 'touch' && rowH < 14
      ? hitNote({ ...pt, p: pt.p + 1 }) || hitNote({ ...pt, p: pt.p - 1 })
      : null);
  scroller.addEventListener('pointerdown', (e) => {
    if (!cur || e.button !== 0) return;
    const r = scroller.getBoundingClientRect();
    if (e.clientX - r.left > scroller.clientWidth || e.clientY - r.top > scroller.clientHeight) return;
    st.focus = 'pianoroll';
    closePopover();
    const pt = at(e);
    const clicks = clickCount(e);
    const hit = fingerHit(e, pt);
    const prevHit = lastHit;
    lastHit = hit ? hit.n.id : null;
    if (hit) {
      const n = hit.n;
      if (clicks >= 2 && !e.shiftKey && prevHit === n.id) {
        // (a double click on the note itself, not draw-then-grab)
        const ids = sel().has(n.id) ? [...sel()] : [n.id];
        store.dispatch(
          { type: 'notes.remove', track: cur.t.id, clip: cur.c.id, ids },
          { by: 'you', label: ids.length > 1 ? `delete ${ids.length} notes` : 'delete note' },
        );
        setSel([]);
        return;
      }
      let ids = new Set(sel());
      if (e.shiftKey) {
        if (ids.has(n.id)) ids.delete(n.id);
        else ids.add(n.id);
      } else if (!ids.has(n.id)) ids = new Set([n.id]);
      setSel(ids);
      if (!ids.has(n.id)) return;
      audition(n.p, n.v);
      lastLen = n.d;
      lastVel = n.v;
      const items = cur.c.notes.filter((x) => ids.has(x.id)).map((x) => ({ ...x }));
      drag = {
        mode: hit.zone === 'r' ? 'resize' : 'move',
        pt0: pt,
        lead: { ...n },
        items,
        moved: false,
        copy: e.altKey,
      };
    } else if (tool === 'draw' && !(e.metaKey || e.ctrlKey)) {
      const g = grid0(e);
      const t = Math.max(0, g ? floorTo(pt.t, g) : pt.t);
      const p = clamp(lockOn() ? scaleP(clamp(127.5 - pt.y / rowH, 0, 127)) : pt.p, 0, 127);
      adds = [{ p, t, d: lastLen, v: lastVel }];
      drag = { mode: 'draw', pt0: pt, t0: t, p, moved: false, pan: touchPan(e) };
      if (!e.shiftKey) setSel([]);
      audition(p, lastVel);
    } else {
      marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y, add: e.shiftKey, base: new Set(e.shiftKey ? sel() : []) };
      drag = { mode: 'marquee', pt0: pt, moved: false, pan: touchPan(e) };
    }
    scroller.setPointerCapture(e.pointerId);
    e.preventDefault();
    scroller.focus({ preventScroll: true });
    dirty = true;
  });
  let lastPointer = null;
  scroller.addEventListener('pointermove', (e) => {
    lastPointer = e;
    if (!drag) {
      if (!cur) return;
      const hit = hitNote(at(e));
      const hid = hit ? hit.n.id : null;
      if (hid !== hoverNote) {
        hoverNote = hid;
        dirty = true;
      }
      scroller.style.cursor = hit
        ? hit.zone === 'r'
          ? 'ew-resize'
          : 'grab'
        : tool === 'draw'
          ? 'crosshair'
          : 'default';
      return;
    }
    moveDrag(e);
  });
  function moveDrag(e) {
    const d = drag;
    if (d.pan) {
      const dx = e.clientX - d.pan.x,
        dy = e.clientY - d.pan.y;
      if (!d.moved && Math.hypot(dx, dy) < 8) return;
      if (d.mode !== 'pan') {
        d.mode = 'pan';
        d.moved = true;
        adds = null;
        marquee = null;
      }
      scroller.scrollLeft = d.pan.sl - dx;
      scroller.scrollTop = d.pan.st - dy;
      dirty = true;
      return;
    }
    const pt = at(e);
    const dx = pt.x - d.pt0.x,
      dy = pt.y - d.pt0.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    const g = grid0(e);
    if (d.mode === 'move') {
      let nt = d.lead.t + dx / ppb;
      nt = g ? snapTo(nt, g) : nt;
      const minT = Math.min(...d.items.map((n) => n.t));
      const dt = Math.max(nt - d.lead.t, -minT);
      const dp = Math.round(-dy / rowH);
      d.copy = e.altKey;
      pv = new Map();
      let leadP = d.lead.p;
      for (const n of d.items) {
        const p = dp ? clamp(scaleP(n.p + dp), 0, 127) : n.p; // moved only in time, a note keeps its pitch
        if (n.id === d.lead.id) leadP = p;
        pv.set(n.id, { ...n, t: Math.max(0, n.t + dt), p });
      }
      if (leadP !== d.lastP) {
        d.lastP = leadP;
        if (dp !== 0 || d.lastP != null) audition(leadP, d.lead.v);
      }
      if (d.copy) {
        adds = [...pv.values()].map((n) => ({ p: n.p, t: n.t, d: n.d, v: n.v }));
        pv = null;
      } else adds = null;
      scroller.style.cursor = d.copy ? 'copy' : 'grabbing';
    } else if (d.mode === 'resize') {
      let end = d.lead.t + d.lead.d + dx / ppb;
      end = g ? snapTo(end, g) : end;
      const dd = end - (d.lead.t + d.lead.d);
      pv = new Map();
      for (const n of d.items) pv.set(n.id, { ...n, d: Math.max(g || 1 / 32, n.d + dd) });
      lastLen = Math.max(g || 1 / 32, d.lead.d + dd);
    } else if (d.mode === 'draw') {
      const end = g ? Math.max(d.t0 + g, snapTo(pt.t, g)) : Math.max(d.t0 + 1 / 32, pt.t);
      adds = [{ ...adds[0], d: end - d.t0 }];
      lastLen = end - d.t0;
    } else if (d.mode === 'marquee') {
      marquee.x1 = pt.x;
      marquee.y1 = pt.y;
      const tA = Math.min(marquee.x0, marquee.x1) / ppb,
        tB = Math.max(marquee.x0, marquee.x1) / ppb;
      const pA = 127 - Math.floor(Math.max(marquee.y0, marquee.y1) / rowH),
        pB = 127 - Math.floor(Math.min(marquee.y0, marquee.y1) / rowH);
      const ids = new Set(marquee.base);
      for (const n of cur.c.notes) if (n.p >= pA && n.p <= pB && n.t < tB && n.t + n.d > tA) ids.add(n.id);
      st.selection.notes = ids;
      d.ids = ids;
    }
    dirty = true;
  }
  scroller.addEventListener('pointerup', (e) => endDrag(e));
  scroller.addEventListener('pointercancel', () => {
    drag = null;
    pv = null;
    adds = null;
    marquee = null;
    dirty = true;
  });
  function endDrag(e) {
    const d = drag;
    drag = null;
    dirty = true;
    try {
      scroller.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* gone */
    }
    if (!d || !cur) {
      pv = null;
      adds = null;
      marquee = null;
      return;
    }
    const T = cur.t.id,
      C = cur.c.id;
    if (d.mode === 'draw') {
      const n = adds[0];
      adds = null;
      const ops = [{ type: 'notes.add', track: T, clip: C, notes: [n] }];
      const end = n.t + n.d;
      if (end > cur.c.length)
        ops.unshift({ type: 'clip.set', track: T, clip: C, patch: { length: Math.ceil(end / bpb()) * bpb() } });
      const r = store.dispatch(ops, { by: 'you', label: `add ${nameOf(n.p)}` });
      if (r.ok) setSel(r.created.notes || []);
      else ui.toast(r.error, { kind: 'bad' });
    } else if (d.mode === 'move' && d.moved) {
      if (d.copy && adds) {
        const notes = adds;
        adds = null;
        pv = null;
        const r = store.dispatch(
          { type: 'notes.add', track: T, clip: C, notes },
          { by: 'you', label: notes.length > 1 ? `copy ${notes.length} notes` : 'copy note' },
        );
        if (r.ok) setSel(r.created.notes || []);
      } else if (pv) {
        const patch = [...pv.values()]
          .filter((n) => {
            const o = cur.c.notes.find((x) => x.id === n.id);
            return o && (o.t !== n.t || o.p !== n.p);
          })
          .map((n) => ({ id: n.id, t: n.t, p: n.p }));
        pv = null;
        if (patch.length)
          store.dispatch(
            { type: 'notes.set', track: T, clip: C, notes: patch },
            { by: 'you', label: patch.length > 1 ? `move ${patch.length} notes` : 'move note' },
          );
      }
    } else if (d.mode === 'resize' && d.moved && pv) {
      const patch = [...pv.values()].map((n) => ({ id: n.id, d: n.d }));
      pv = null;
      store.dispatch(
        { type: 'notes.set', track: T, clip: C, notes: patch },
        { by: 'you', label: patch.length > 1 ? `resize ${patch.length} notes` : 'resize note' },
      );
    } else if (d.mode === 'marquee') {
      marquee = null;
      if (d.moved) setSel(d.ids || []);
      else if (!e.shiftKey) setSel([]);
    }
    pv = null;
    adds = null;
    syncBar();
  }
  scroller.addEventListener('pointerleave', () => {
    if (hoverNote) {
      hoverNote = null;
      dirty = true;
    }
  });

  /* ======================================================= velocity lane */
  velWrap.addEventListener('pointerdown', (e) => {
    if (!cur || e.button !== 0) return;
    st.focus = 'pianoroll';
    const r = velWrap.getBoundingClientRect();
    const x = e.clientX - r.left + scroller.scrollLeft;
    const vOf = (cy) => clamp(1 - (cy - r.top - 6) / (r.height - 12), 0.01, 1);
    // the nearest note (selected ones first)
    let best = null,
      bd = 9;
    for (const n of cur.c.notes) {
      const dd = Math.abs(n.t * ppb - x) - (sel().has(n.id) ? 2 : 0);
      if (dd < bd) {
        bd = dd;
        best = n;
      }
    }
    pv = new Map();
    if (best) {
      const group = sel().has(best.id) ? cur.c.notes.filter((n) => sel().has(n.id)) : [best];
      const v0 = vOf(e.clientY);
      drag = { mode: 'vel', group, lead: best, v0: best.v, y0: e.clientY };
      for (const n of group) pv.set(n.id, { ...n, v: n === best ? v0 : n.v });
      if (group.length === 1) pv.set(best.id, { ...best, v: v0 });
    } else {
      drag = { mode: 'velpaint', lastX: x, lastV: vOf(e.clientY) };
    }
    velWrap.setPointerCapture(e.pointerId);
    e.preventDefault();
    dirty = true;
    velMove(e);
  });
  function velMove(e) {
    const d = drag;
    if (!d || (d.mode !== 'vel' && d.mode !== 'velpaint')) return;
    const r = velWrap.getBoundingClientRect();
    const v = clamp(1 - (e.clientY - r.top - 6) / (r.height - 12), 0.01, 1);
    if (d.mode === 'vel') {
      if (d.group.length === 1) pv.set(d.lead.id, { ...d.lead, v: Math.round(v * 100) / 100 });
      else {
        const dv = v - d.v0;
        for (const n of d.group) pv.set(n.id, { ...n, v: clamp(Math.round((n.v + dv) * 100) / 100, 0.01, 1) });
      }
    } else {
      const x = e.clientX - r.left + scroller.scrollLeft;
      const a = Math.min(x, d.lastX),
        b = Math.max(x, d.lastX);
      for (const n of cur.c.notes) {
        const nx = n.t * ppb;
        if (nx >= a - 2 && nx <= b + 2) {
          const k = b > a ? (nx - d.lastX) / (x - d.lastX || 1) : 1;
          pv.set(n.id, { ...n, v: Math.round(clamp(d.lastV + (v - d.lastV) * clamp(k, 0, 1), 0.01, 1) * 100) / 100 });
        }
      }
      d.lastX = x;
      d.lastV = v;
    }
    dirty = true;
  }
  velWrap.addEventListener('pointermove', (e) => {
    if (drag) velMove(e);
    else if (cur) velWrap.style.cursor = 'ns-resize';
  });
  velWrap.addEventListener('pointerup', () => {
    const d = drag;
    drag = null;
    if (!d || !cur || !pv) {
      pv = null;
      return;
    }
    const patch = [...pv.values()]
      .filter((n) => {
        const o = cur.c.notes.find((x) => x.id === n.id);
        return o && Math.abs(o.v - n.v) > 1e-4;
      })
      .map((n) => ({ id: n.id, v: n.v }));
    pv = null;
    dirty = true;
    if (patch.length) {
      store.dispatch(
        { type: 'notes.set', track: cur.t.id, clip: cur.c.id, notes: patch },
        { by: 'you', label: patch.length > 1 ? `velocity of ${patch.length} notes` : 'velocity' },
      );
      lastVel = patch[patch.length - 1].v;
    }
  });

  /* ======================================================= keyboard column */
  const keysWrap = keys.cv.parentElement;
  keysWrap.addEventListener('pointerdown', (e) => {
    if (!cur || e.button !== 0) return;
    st.focus = 'pianoroll';
    const r = keysWrap.getBoundingClientRect();
    const p = 127 - Math.floor((e.clientY - r.top + scroller.scrollTop) / rowH);
    heldKey = p;
    try {
      engine.liveNoteOn?.(cur.t.id, p, 0.8);
    } catch (_) {
      /* no sound */
    }
    keysWrap.setPointerCapture(e.pointerId);
    dirty = true;
  });
  keysWrap.addEventListener('pointermove', (e) => {
    if (heldKey == null || !cur) return;
    const r = keysWrap.getBoundingClientRect();
    const p = 127 - Math.floor((e.clientY - r.top + scroller.scrollTop) / rowH);
    if (p !== heldKey) {
      try {
        engine.liveNoteOff?.(cur.t.id, heldKey);
        engine.liveNoteOn?.(cur.t.id, p, 0.8);
      } catch (_) {
        /* ok */
      }
      heldKey = p;
      dirty = true;
    }
  });
  const keyUp = () => {
    if (heldKey != null && cur) {
      try {
        engine.liveNoteOff?.(cur.t.id, heldKey);
      } catch (_) {
        /* ok */
      }
    }
    heldKey = null;
    dirty = true;
  };
  keysWrap.addEventListener('pointerup', keyUp);
  keysWrap.addEventListener('pointercancel', keyUp);
  keysWrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      scroller.scrollTop += e.deltaY;
    },
    { passive: false },
  );

  /* ======================================================= ruler: seek, and the clip's end */
  const rulerWrap = ruler.cv.parentElement;
  let rdrag = null;
  rulerWrap.addEventListener('pointerdown', (e) => {
    if (!cur || e.button !== 0) return;
    st.focus = 'pianoroll';
    const r = rulerWrap.getBoundingClientRect();
    const x = e.clientX - r.left + scroller.scrollLeft;
    if (Math.abs(x - cur.c.length * ppb) < 7) rdrag = { mode: 'end', len: cur.c.length };
    else {
      rdrag = { mode: 'seek' };
      engine.seek(cur.c.start + Math.max(0, snapTo(x / ppb, grid0(e))));
    }
    rulerWrap.setPointerCapture(e.pointerId);
  });
  rulerWrap.addEventListener('pointermove', (e) => {
    const r = rulerWrap.getBoundingClientRect();
    const x = e.clientX - r.left + scroller.scrollLeft;
    if (!rdrag) {
      rulerWrap.style.cursor = cur && Math.abs(x - cur.c.length * ppb) < 7 ? 'ew-resize' : 'pointer';
      return;
    }
    if (rdrag.mode === 'seek') engine.seek(cur.c.start + Math.max(0, snapTo(x / ppb, grid0(e))));
    else {
      rdrag.len = Math.max(1, snapTo(x / ppb, e.shiftKey ? 0.25 : 1));
      dirty = true;
    }
  });
  rulerWrap.addEventListener('pointerup', () => {
    const d = rdrag;
    rdrag = null;
    if (d?.mode === 'end' && cur && Math.abs(d.len - cur.c.length) > 1e-6)
      store.dispatch(
        { type: 'clip.set', track: cur.t.id, clip: cur.c.id, patch: { length: d.len } },
        { by: 'you', label: d.len > cur.c.length ? 'lengthen clip' : 'shorten clip' },
      );
    dirty = true;
  });

  /* ======================================================= scroll and zoom */
  scroller.addEventListener(
    'scroll',
    () => {
      dirty = true;
    },
    { passive: true },
  );
  scroller.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = scroller.getBoundingClientRect();
        const px = e.clientX - r.left;
        const t = (scroller.scrollLeft + px) / ppb;
        ppb = clamp(ppb * Math.exp(-e.deltaY * (Math.abs(e.deltaY) < 30 ? 0.02 : 0.004)), 6, 600);
        layout();
        scroller.scrollLeft = Math.max(0, t * ppb - px);
        dirty = true;
      } else if (e.altKey) {
        e.preventDefault();
        const r = scroller.getBoundingClientRect();
        const py = e.clientY - r.top;
        const p = (scroller.scrollTop + py) / rowH;
        rowH = userRowH = clamp(Math.round(rowH * Math.exp(-e.deltaY * 0.004)), 6, 30);
        layout();
        scroller.scrollTop = Math.max(0, p * rowH - py);
        dirty = true;
      }
    },
    { passive: false },
  );
  for (const wrap of [rulerWrap, velWrap])
    wrap.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        scroller.scrollLeft += e.deltaX || e.deltaY;
      },
      { passive: false },
    );

  /* ======================================================= commands */
  const selected = () => (cur ? cur.c.notes.filter((n) => sel().has(n.id)) : []);
  const target = () => {
    const s = selected();
    return s.length ? s : cur ? cur.c.notes : [];
  };
  function del() {
    const ids = [...sel()].filter((id) => cur.c.notes.some((n) => n.id === id));
    if (!ids.length) return;
    store.dispatch(
      { type: 'notes.remove', track: cur.t.id, clip: cur.c.id, ids },
      { by: 'you', label: ids.length > 1 ? `delete ${ids.length} notes` : 'delete note' },
    );
    setSel([]);
  }
  function transpose(dir, octave) {
    const ns = selected();
    if (!ns.length) return;
    const key = keyOf(),
      inKey = lockOn();
    const patch = ns.map((n) => {
      let p = n.p;
      if (octave) p += 12 * dir;
      else if (inKey) {
        do {
          p += dir;
        } while (p > 0 && p < 127 && !music.inScale(p, key));
      } else p += dir;
      return { id: n.id, p: clamp(p, 0, 127) };
    });
    store.dispatch(
      { type: 'notes.set', track: cur.t.id, clip: cur.c.id, notes: patch },
      {
        by: 'you',
        label: octave ? `octave ${dir > 0 ? 'up' : 'down'}` : `transpose ${dir > 0 ? 'up' : 'down'}`,
        coalesce: 'transpose:' + cur.c.id,
      },
    );
    if (patch.length <= 4) audition(patch[0].p);
    else audition(Math.max(...patch.map((x) => x.p)));
  }
  function nudge(dir, big) {
    const ns = selected();
    if (!ns.length) return;
    const g = big ? bpb() : st.snap || 0.25;
    const minT = Math.min(...ns.map((n) => n.t));
    const dt = Math.max(dir * g, -minT);
    if (!dt) return;
    store.dispatch(
      { type: 'notes.set', track: cur.t.id, clip: cur.c.id, notes: ns.map((n) => ({ id: n.id, t: n.t + dt })) },
      { by: 'you', label: 'nudge notes', coalesce: 'nudge:' + cur.c.id },
    );
  }
  function quantize() {
    const ns = target();
    if (!ns.length) return;
    const g = st.snap || 0.25;
    const { strength, swing } = st.quantize;
    const patch = ns
      .map((n) => ({
        id: n.id,
        t: Math.max(0, Math.round(music.quantize(n.t, g, strength / 100, swing / 100) * 10000) / 10000),
      }))
      .filter((x, i) => Math.abs(x.t - ns[i].t) > 1e-5);
    if (!patch.length) {
      ui.toast('Already on the grid');
      return;
    }
    store.dispatch(
      { type: 'notes.set', track: cur.t.id, clip: cur.c.id, notes: patch },
      {
        by: 'you',
        label: `quantize ${patch.length} note${patch.length > 1 ? 's' : ''} to ${snapLabel(g)}${strength < 100 ? ` at ${strength}%` : ''}${swing ? `, swing ${swing}%` : ''}`,
      },
    );
  }
  function openQuantize() {
    const q = st.quantize;
    const row = (label, key, max) => {
      const out = h('span.pr-qval', q[key] + '%');
      const inp = h('input', {
        type: 'range',
        min: 0,
        max,
        step: 1,
        value: q[key],
        'aria-label': label,
        oninput: (e) => {
          q[key] = Number(e.target.value);
          out.textContent = q[key] + '%';
        },
      });
      return h('label.pr-qrow', h('span', label), inp, out);
    };
    popover(
      qBtn,
      [
        h('div.ek-head', `Quantize to ${snapLabel(st.snap || 0.25)}`),
        row('Strength', 'strength', 100),
        row('Swing', 'swing', 100),
        h('div.pr-qhint', 'Q applies these. Works on the selected notes, or the whole clip.'),
        h(
          'div.pr-qact',
          h(
            'button.ew-btn.ew-btn-primary.ew-btn-small',
            {
              onclick: () => {
                quantize();
                closePopover();
              },
            },
            'Quantize',
          ),
        ),
      ],
      { cls: 'pr-qpop' },
    );
  }
  // Transforms (core/transforms.js): the same ones agents call with the `transform` tool. Seeded ones get a fresh seed
  // each time, so pressing again gives another take; each run is one notes.* transaction by 'you'.
  if (!st.trPreset) st.trPreset = {};
  function applyTransform(name, params = {}) {
    if (!cur) return null;
    const t = findTransform(name);
    if (!t) return null;
    const ids = sel().size ? [...sel()].filter((id) => cur.c.notes.some((n) => n.id === id)) : null;
    const p = { ...params };
    if ('seed' in t.params && p.seed == null) p.seed = st.trSeed = (st.trSeed || 0) + 1;
    const r = runTransform(store, {
      track: cur.t.id,
      clip: cur.c.id,
      ids: ids && ids.length ? ids : null,
      name: t.name,
      params: p,
      by: 'you',
      drums: isDrumTrack(app, cur.t),
    });
    if (!r.ok) {
      ui.toast(`${r.error[0].toUpperCase()}${r.error.slice(1)}${r.hint ? `: ${r.hint}` : ''}.`, {
        kind: r.nothing ? undefined : 'bad',
      });
      return r;
    }
    if (ids && ids.length) {
      const live = new Set((store.findClip(cur.c.id)?.clip.notes || []).map((n) => n.id));
      setSel([...ids.filter((id) => live.has(id)), ...(r.created?.notes || [])]);
    }
    ui.toast(`${r.summary[0].toUpperCase()}${r.summary.slice(1)}.`);
    return r;
  }
  function openTransform() {
    if (!cur) return;
    const n = [...sel()].filter((id) => cur.c.notes.some((x) => x.id === id)).length;
    const drums = isDrumTrack(app, cur.t);
    const kids = [
      h('div.ek-head', n ? `Transform ${n} selected note${n === 1 ? '' : 's'}` : 'Transform the whole clip'),
    ];
    let group = '';
    for (const t of TRANSFORMS) {
      if (t.name === 'quantize') continue; // it has its own button (Q)
      if (t.group !== group) {
        group = t.group;
        kids.push(h('div.pr-txgroup', group));
      }
      const off = drums && !t.drums;
      const presets = t.presets;
      const i0 = Math.min(presets.length - 1, st.trPreset[t.name] || 0);
      const pick =
        presets.length > 1
          ? h(
              'select.pr-txsel',
              {
                'aria-label': `${t.label} setting`,
                disabled: off,
                onchange: (e) => {
                  st.trPreset[t.name] = Number(e.target.value);
                },
              },
              presets.map((pr, i) =>
                h(
                  'option',
                  { value: i, selected: i === i0 },
                  t.describe({ ...Object.fromEntries(Object.entries(t.params).map(([k, sp]) => [k, sp.def])), ...pr }),
                ),
              ),
            )
          : h('span');
      const go = h(
        'button.pr-txgo',
        {
          disabled: off,
          title: off ? 'For pitched parts, not drums' : `${t.blurb[0].toUpperCase()}${t.blurb.slice(1)}`,
          'data-transform': t.name,
          onclick: () => {
            closePopover();
            applyTransform(t.name, presets[st.trPreset[t.name] || 0] || {});
          },
        },
        t.label,
      );
      kids.push(h('div.pr-txrow', go, pick));
    }
    kids.push(h('div.pr-qhint', 'One undo step each. Agents have the same ones.'));
    popover(txBtn, kids, { cls: 'pr-txpop' });
  }
  function copy() {
    const ns = selected();
    if (!ns.length) return false;
    const t0 = Math.min(...ns.map((n) => n.t));
    clipboard = {
      notes: ns.map((n) => ({ p: n.p, t: n.t - t0, d: n.d, v: n.v })),
      span: Math.max(...ns.map((n) => n.t + n.d)) - t0,
      end: Math.max(...ns.map((n) => n.t + n.d)),
    };
    try {
      navigator.clipboard?.writeText(music.formatNotes(clipboard.notes)).catch(() => {});
    } catch (_) {
      /* fine */
    }
    ui.toast(`Copied ${ns.length} note${ns.length > 1 ? 's' : ''} (also as text, to paste to your agent)`);
    return true;
  }
  function paste() {
    if (!clipboard || !cur) return;
    const rel = (engine.beat || 0) - cur.c.start;
    const at0 =
      rel >= 0 && rel < cur.c.length
        ? floorTo(rel, st.snap || 0.25)
        : Math.min(clipboard.end, cur.c.length - clipboard.span);
    const notes = clipboard.notes.map((n) => ({ ...n, t: Math.max(0, at0) + n.t }));
    const r = store.dispatch(
      { type: 'notes.add', track: cur.t.id, clip: cur.c.id, notes },
      { by: 'you', label: `paste ${notes.length} note${notes.length > 1 ? 's' : ''}` },
    );
    if (r.ok) setSel(r.created.notes || []);
  }
  function duplicate() {
    const ns = selected();
    if (!ns.length) return;
    const t0 = Math.min(...ns.map((n) => n.t)),
      t1 = Math.max(...ns.map((n) => n.t + n.d));
    const span = Math.ceil((t1 - t0) / (st.snap || 0.25) - 1e-9) * (st.snap || 0.25);
    const r = store.dispatch(
      {
        type: 'notes.add',
        track: cur.t.id,
        clip: cur.c.id,
        notes: ns.map((n) => ({ p: n.p, t: n.t + span, d: n.d, v: n.v })),
      },
      { by: 'you', label: 'duplicate notes' },
    );
    if (r.ok) setSel(r.created.notes || []);
  }

  // a note cursor for the keyboard: Alt+←/→ picks the previous / next note in time (Shift keeps the others selected),
  // Alt+↑/↓ the one above / below in the same chord or nearest in time; the arrows then move it as usual
  function pickNote(dir, axis, add) {
    if (!cur || !cur.c.notes.length) return;
    const ns = cur.c.notes.slice().sort((a, b) => a.t - b.t || a.p - b.p);
    const ids = sel();
    const focus =
      ns.find((n) => n.id === lastPick && ids.has(n.id)) || ns.filter((n) => ids.has(n.id)).at(dir > 0 ? -1 : 0);
    let next;
    if (!focus) next = dir > 0 ? ns.find((n) => n.t >= (engine.beat || 0) - cur.c.start) || ns[0] : ns[ns.length - 1];
    else if (axis === 't') next = ns[Math.max(0, Math.min(ns.length - 1, ns.indexOf(focus) + dir))];
    else {
      const others = ns.filter((n) => (dir > 0 ? n.p > focus.p : n.p < focus.p));
      next =
        others.sort(
          (a, b) =>
            Math.abs(a.t - focus.t) - Math.abs(b.t - focus.t) || Math.abs(a.p - focus.p) - Math.abs(b.p - focus.p),
        )[0] || focus;
    }
    lastPick = next.id;
    setSel(add ? [...ids, next.id] : [next.id]);
    revealNote(next);
    const vv = Math.round((next.v ?? 0.8) * 127);
    said.textContent = '';
    setTimeout(() => {
      said.textContent = `${nameOf(next.p)}, beat ${+(next.t + 1).toFixed(2)}, ${+next.d.toFixed(2)} beat${next.d === 1 ? '' : 's'} long, velocity ${vv}${add ? `, ${sel().size} selected` : ''}.`;
    }, 30);
  }
  let lastPick = null;
  function revealNote(n) {
    const x = n.t * ppb,
      y = (127 - n.p) * rowH;
    if (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 40)
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 3);
    if (y < scroller.scrollTop || y > scroller.scrollTop + scroller.clientHeight - rowH)
      scroller.scrollTop = Math.max(0, y - scroller.clientHeight / 2);
    dirty = true;
  }

  const mine = () => st.focus === 'pianoroll' && !!cur && ui.visible('pianoroll');
  const offs = [
    ui.keys.add({
      key: 'ArrowRight',
      mod: 'alt',
      when: mine,
      run: () => pickNote(1, 't', false),
      label: 'Pick the next note',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowLeft',
      mod: 'alt',
      when: mine,
      run: () => pickNote(-1, 't', false),
      label: 'Pick the previous note',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowUp',
      mod: 'alt',
      when: mine,
      run: () => pickNote(1, 'p', false),
      label: 'Pick the note above',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowDown',
      mod: 'alt',
      when: mine,
      run: () => pickNote(-1, 'p', false),
      label: 'Pick the note below',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowRight',
      mod: 'shift+alt',
      when: mine,
      run: () => pickNote(1, 't', true),
      label: 'Add the next note',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowLeft',
      mod: 'shift+alt',
      when: mine,
      run: () => pickNote(-1, 't', true),
      label: 'Add the previous note',
      group: 'Notes',
    }),
    ui.keys.add({ key: 'Delete', when: mine, run: del, label: 'Delete the selected notes', group: 'Notes' }),
    ui.keys.add({ key: 'Backspace', when: mine, run: del, label: 'Delete the selected notes', group: 'Notes' }),
    ui.keys.add({ key: 'ArrowUp', when: mine, run: () => transpose(1, false), label: 'Transpose up', group: 'Notes' }),
    ui.keys.add({
      key: 'ArrowDown',
      when: mine,
      run: () => transpose(-1, false),
      label: 'Transpose down',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowUp',
      mod: 'shift',
      when: mine,
      run: () => transpose(1, true),
      label: 'Up an octave',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowDown',
      mod: 'shift',
      when: mine,
      run: () => transpose(-1, true),
      label: 'Down an octave',
      group: 'Notes',
    }),
    ui.keys.add({ key: 'ArrowRight', when: mine, run: () => nudge(1), label: 'Nudge later', group: 'Notes' }),
    ui.keys.add({ key: 'ArrowLeft', when: mine, run: () => nudge(-1), label: 'Nudge earlier', group: 'Notes' }),
    ui.keys.add({
      key: 'ArrowRight',
      mod: 'shift',
      when: mine,
      run: () => nudge(1, true),
      label: 'Nudge a bar later',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowLeft',
      mod: 'shift',
      when: mine,
      run: () => nudge(-1, true),
      label: 'Nudge a bar earlier',
      group: 'Notes',
    }),
    ui.keys.add({ key: 'KeyQ', when: mine, run: quantize, label: 'Quantize', group: 'Notes' }),
    ui.keys.add({
      key: 'KeyA',
      mod: 'mod',
      when: mine,
      run: () => setSel(cur.c.notes.map((n) => n.id)),
      label: 'Select every note',
      group: 'Notes',
    }),
    ui.keys.add({ key: 'KeyC', mod: 'mod', when: mine, run: copy, label: 'Copy notes', group: 'Notes' }),
    ui.keys.add({
      key: 'KeyV',
      mod: 'mod',
      when: () => mine() && !!clipboard,
      run: paste,
      label: 'Paste notes at the playhead',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'KeyD',
      mod: 'mod',
      when: mine,
      run: duplicate,
      label: 'Duplicate notes after themselves',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'Escape',
      when: () => mine() && sel().size > 0,
      run: () => setSel([]),
      label: 'Clear the note selection',
      group: 'Notes',
    }),
    ui.keys.add({ key: 'Digit1', when: mine, run: () => setTool('select'), label: 'Select tool', group: 'Notes' }),
    ui.keys.add({ key: 'Digit2', when: mine, run: () => setTool('draw'), label: 'Draw tool', group: 'Notes' }),
  ];

  /* ======================================================= drawing */
  function drawGrid(now) {
    const { g, w: W, h: H } = grid;
    const pal = palette();
    g.clearRect(0, 0, W, H);
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, W, H);
    if (!cur) return;
    const p = store.get();
    const pLo = Math.max(0, 127 - Math.ceil((scroller.scrollTop + H) / rowH)),
      pHi = Math.min(127, 127 - Math.floor(scroller.scrollTop / rowH));
    // rows: the key's notes lit, the rest shaded (darker still while Scale lock keeps notes out of them), the root tinted
    const lockedNow = lockOn();
    for (let q = pLo; q <= pHi; q++) {
      const y = yOf(q),
        r = rowInfo(q);
      g.fillStyle = r.inKey ? rgba(pal.bg3, 0.62) : r.shaded && lockedNow ? 'rgba(0, 0, 0, .34)' : rgba(pal.bg2, 0.35);
      g.fillRect(0, y, W, rowH);
      if (r.root) {
        g.fillStyle = rgba(pal.accent2, 0.09);
        g.fillRect(0, y, W, rowH);
      }
      g.fillStyle = r.c ? rgba(pal.line2, 0.95) : rgba(pal.line, 0.5);
      g.fillRect(0, Math.round(y + rowH) - 1, W, 1);
    }
    // vertical grid
    const b = bpb();
    const sub = st.snap && st.snap * ppb >= 7 ? st.snap : ppb >= 28 ? 0.25 : ppb >= 14 ? 0.5 : 1;
    const t0 = Math.floor(scroller.scrollLeft / ppb / sub) * sub,
      t1 = (scroller.scrollLeft + W) / ppb;
    for (let t = t0; t <= t1; t += sub) {
      const x = Math.round(xOf(t)) + 0.5;
      const isBar = Math.abs((t + cur.c.start) / b - Math.round((t + cur.c.start) / b)) < 1e-6;
      const isBeat = Math.abs(t - Math.round(t)) < 1e-6;
      g.fillStyle = isBar ? rgba(pal.line2, 1) : isBeat ? rgba(pal.line2, 0.45) : rgba(pal.line, 0.45);
      g.fillRect(x - 0.5, 0, 1, H);
    }
    // past the clip's end
    const len = rdrag?.mode === 'end' ? rdrag.len : cur.c.length;
    const ex = xOf(len);
    if (ex < W) {
      g.fillStyle = 'rgba(10, 9, 7,.42)';
      g.fillRect(Math.max(0, ex), 0, W - Math.max(0, ex), H);
      g.fillStyle = rgba(pal.text3, 0.7);
      g.fillRect(Math.round(ex), 0, 1.5, H);
    }
    // ghosts: the other tracks around this clip
    if (st.prGhosts) {
      const from = cur.c.start,
        to = cur.c.start + contentBeats();
      for (const t of p.tracks) {
        if (t.id === cur.t.id || t.kind !== 'instrument' || isDrumTrack(app, t)) continue;
        const col = resolveColor(t.color);
        g.strokeStyle = rgba(col, 0.32);
        g.lineWidth = 1;
        g.fillStyle = rgba(col, 0.07);
        for (const c of t.clips) {
          if (c.kind !== 'notes' || c.start > to || c.start + c.length < from) continue;
          for (const n of c.notes) {
            if (n.t >= c.length) continue;
            const tt = c.start + n.t - from;
            if (n.p < pLo || n.p > pHi) continue;
            const x = xOf(tt),
              w = Math.max(2, n.d * ppb - 1);
            if (x > W || x + w < 0) continue;
            const y = yOf(n.p);
            g.fillRect(x, y + 1.5, w, rowH - 3);
            g.strokeRect(x + 0.5, y + 2, w - 1, rowH - 4);
          }
        }
      }
    }
    // notes
    const col = resolveColor(cur.c.color || cur.t.color);
    const S = sel();
    const copying = drag?.mode === 'move' && drag.copy;
    const fill = shade(col, 0.08),
      fillSel = shade(col, 0.45);
    g.font = `700 ${Math.min(10, rowH - 3)}px ${pal.ui}`;
    g.textBaseline = 'middle';
    const presIds = new Set();
    for (const pr of presenceList(ui)) if (pr.clip === cur.c.id && pr.notes) for (const id of pr.notes) presIds.add(id);
    const drawNote = (n, { selected, ghost, id }) => {
      if (n.p < pLo - 1 || n.p > pHi + 1) return;
      const x = xOf(n.t),
        w = Math.max(3, n.d * ppb - 1);
      if (x > W || x + w < 0) return;
      const y = yOf(n.p) + 1,
        hh = rowH - 2;
      const past = n.t >= len;
      g.globalAlpha = (ghost ? 0.35 : 1) * (past ? 0.35 : 1) * (0.42 + 0.58 * n.v);
      roundRect(g, x + 0.5, y, w, hh, Math.min(3, hh / 2));
      g.fillStyle = selected ? fillSel : fill;
      g.fill();
      g.globalAlpha = (ghost ? 0.35 : 1) * (past ? 0.4 : 1);
      // the outline says who wrote it: warm a person, cool an agent, the track's own shade the house; selected is a cream frame
      const ak = authorKind(app, n.by || cur.c.by);
      if (selected) {
        g.strokeStyle = pal.text;
        g.lineWidth = 1.5;
        g.stroke();
      } else {
        g.strokeStyle = ak === 'agent' ? pal.agent : ak === 'human' ? pal.human : rgba(shade(col, -0.45), 0.9);
        g.lineWidth = 1;
        g.stroke();
      }
      if (hoverNote === id && !selected) {
        g.strokeStyle = rgba(pal.text, 0.6);
        g.stroke();
      }
      // name
      if (w > 30 && rowH >= 11) {
        g.fillStyle = 'rgba(20,12,34,.85)';
        g.fillText(nameOf(n.p), x + 5, y + hh / 2 + 0.5);
      }
      // flash / presence
      const fl = id ? flash.level(cur.c.id + ':' + id, now) : 0;
      const pres = id && presIds.has(id);
      if (fl > 0 || pres) {
        // an agent's change: a grease-pencil frame that fades; pointed at: crop marks (no glow, no pulse)
        g.save();
        if (pres) cropMarks(g, x - 2, y - 2, w + 5, hh + 4, pal.accent2);
        else {
          g.globalAlpha = fl;
          g.strokeStyle = pal.accent2;
          g.lineWidth = 1.5;
          g.strokeRect(x - 1, y - 1.5, w + 3, hh + 3);
        }
        g.restore();
      }
      g.globalAlpha = 1;
    };
    for (const n of cur.c.notes) {
      const v = pv && pv.get(n.id);
      drawNote(v || n, { selected: S.has(n.id) && !copying, id: n.id });
    }
    if (adds) for (const n of adds) drawNote({ ...n, by: 'you' }, { selected: true });
    // presence on the whole clip / a range
    for (const pr of presenceList(ui)) {
      if (pr.clip !== cur.c.id && !(pr.track === cur.t.id && pr.range)) continue;
      if (pr.notes?.length) {
        if (pr.note) {
          const n = cur.c.notes.find((x) => x.id === pr.notes[0]);
          if (n)
            drawLabel(
              g,
              Math.max(4, xOf(n.t)),
              Math.max(4, yOf(n.p) - 22),
              `${authorName(app, pr.by || 'claude')}: ${pr.note}`,
              { color: pal.accent2 },
            );
        }
        continue;
      }
      const a = pr.range ? pr.range.from - cur.c.start : 0,
        z = pr.range ? pr.range.to - cur.c.start : cur.c.length;
      cropMarks(g, xOf(a) + 2, 2, (z - a) * ppb - 4, H - 4, pal.accent2);
      drawLabel(g, Math.max(4, xOf(a) + 14), 6, `${authorName(app, pr.by || 'claude')}: ${pr.note || 'looking here'}`, {
        color: pal.accent2,
      });
    }
    // marquee
    if (marquee && drag?.moved) {
      const x0 = Math.min(marquee.x0, marquee.x1) - scroller.scrollLeft,
        y0 = Math.min(marquee.y0, marquee.y1) - scroller.scrollTop;
      const w = Math.abs(marquee.x1 - marquee.x0),
        hh = Math.abs(marquee.y1 - marquee.y0);
      g.fillStyle = rgba(pal.accent2, 0.1);
      g.fillRect(x0, y0, w, hh);
      g.strokeStyle = rgba(pal.accent2, 0.85);
      g.lineWidth = 1;
      g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, w, hh);
    }
    // playhead
    const ph = (engine.beat || 0) - cur.c.start;
    if (ph >= 0 && ph <= contentBeats()) {
      const x = Math.round(xOf(ph));
      g.fillStyle = pal.accent;
      g.globalAlpha = engine.playing ? 1 : 0.6;
      g.fillRect(x, 0, 1.5, H);
      g.globalAlpha = 1;
    }
  }

  function drawKeys() {
    const { g, w: W, h: H } = keys;
    const pal = palette();
    g.clearRect(0, 0, W, H);
    g.fillStyle = pal.bg2;
    g.fillRect(0, 0, W, H);
    if (!cur) return;
    const drums = isDrumTrack(app, cur.t);
    // a drum clip's rows are named by its kit (its own names, or General MIDI's for a kit that names none)
    const kn = drums ? trackNotes(app, cur.t) : null;
    const drumRow = (q) => (kn ? kn[q] || null : music.GM_DRUMS[q] || null);
    const lockedNow = lockOn();
    const pLo = Math.max(0, 127 - Math.ceil((scroller.scrollTop + H) / rowH)),
      pHi = Math.min(127, 127 - Math.floor(scroller.scrollTop / rowH));
    // what's sounding at the playhead
    const ph = (engine.beat || 0) - cur.c.start;
    const on = new Set();
    if (engine.playing) for (const n of cur.c.notes) if (ph >= n.t && ph < n.t + n.d) on.add(n.p);
    if (heldKey != null) on.add(heldKey);
    const col = resolveColor(cur.t.color);
    const fs = Math.min(10, rowH - 2);
    g.textBaseline = 'middle';
    for (let q = pLo; q <= pHi; q++) {
      const y = yOf(q),
        pc = q % 12,
        black = BLACK.has(pc);
      const lit = on.has(q);
      const r = rowInfo(q);
      if (drums) {
        g.fillStyle = lit ? col : drumRow(q) ? rgba(pal.bg3, 1) : pal.bg2;
        g.fillRect(0, y, W, rowH - 1);
      } else {
        g.fillStyle = lit ? col : black ? '#37332d' : '#ddd5c8';
        g.fillRect(0, y, black ? W * 0.62 : W - 1, rowH - 1);
        if (black && !lit) {
          g.fillStyle = '#ddd5c8';
          g.fillRect(W * 0.62, y, W * 0.38 - 1, rowH - 1);
        }
        // out of the key: the key is greyed, as Sketch's keys are while the lock is on
        if (r.shaded && !lit && lockedNow) {
          g.fillStyle = 'rgba(20, 18, 16, .55)';
          g.fillRect(0, y, W - 1, rowH - 1);
        }
        // the key's notes carry a tick at the edge; the root's is solid and wider
        if (!r.shaded && keyOf() && !lit) {
          g.fillStyle = rgba(pal.accent2, r.root ? 0.95 : 0.35);
          g.fillRect(W - (r.root ? 6 : 4), y + 1, r.root ? 5 : 3, rowH - 3);
        }
      }
      const label = drums ? drumRow(q) : r.label;
      if (label && rowH >= 8) {
        g.font = `${r.c || r.root ? 700 : 600} ${fs}px ${pal.mono}`;
        g.fillStyle = lit ? '#141210' : drums || black ? pal.text2 : r.shaded && lockedNow ? '#141210' : '#2c2924';
        g.fillText(label, drums ? 6 : 4, y + rowH / 2);
      }
    }
  }

  function drawRuler() {
    const { g, w: W, h: H } = ruler;
    const pal = palette();
    g.clearRect(0, 0, W, H);
    g.fillStyle = pal.bg2;
    g.fillRect(0, 0, W, H);
    g.fillStyle = pal.line;
    g.fillRect(0, H - 1, W, 1);
    if (!cur) return;
    const b = bpb();
    const len = rdrag?.mode === 'end' ? rdrag.len : cur.c.length;
    // the clip's span
    g.fillStyle = rgba(resolveColor(cur.c.color || cur.t.color), 0.22);
    g.fillRect(xOf(0), 0, len * ppb, H);
    g.font = `600 10px ${pal.mono}`;
    g.textBaseline = 'middle';
    const tStart = Math.floor(scroller.scrollLeft / ppb),
      tEnd = (scroller.scrollLeft + W) / ppb;
    for (let t = tStart; t <= tEnd; t++) {
      const song = cur.c.start + t;
      const x = Math.round(xOf(t)) + 0.5;
      if (Math.abs(song / b - Math.round(song / b)) < 1e-6) {
        g.fillStyle = pal.text3;
        g.fillRect(x - 0.5, 4, 1, H - 4);
        g.fillStyle = pal.text2;
        g.fillText(String(Math.round(song / b) + 1), x + 4, H / 2);
      } else if (ppb >= 18) {
        g.fillStyle = pal.line2;
        g.fillRect(x - 0.5, H - 6, 1, 5);
        if (ppb >= 50) {
          g.fillStyle = pal.text3;
          g.fillText(`${Math.floor(song / b) + 1}.${(song % b) + 1}`, x + 3, H / 2);
        }
      }
    }
    // end handle
    const ex = xOf(len);
    g.fillStyle = pal.text2;
    g.fillRect(Math.round(ex) - 1, 0, 2, H);
    g.beginPath();
    g.moveTo(ex - 6, 0);
    g.lineTo(ex, 0);
    g.lineTo(ex, 8);
    g.closePath();
    g.fill();
    // playhead
    const ph = (engine.beat || 0) - cur.c.start;
    const px = xOf(ph);
    if (px > -6 && px < W + 6) {
      g.fillStyle = pal.accent;
      g.beginPath();
      g.moveTo(px - 5, 2);
      g.lineTo(px + 5, 2);
      g.lineTo(px, 9);
      g.closePath();
      g.fill();
    }
  }

  function drawVel() {
    const { g, w: W, h: H } = vel;
    const pal = palette();
    g.clearRect(0, 0, W, H);
    g.fillStyle = pal.bg2;
    g.fillRect(0, 0, W, H);
    g.fillStyle = pal.line;
    g.fillRect(0, 0, W, 1);
    if (!cur) return;
    for (const v of [0.25, 0.5, 0.75]) {
      g.fillStyle = rgba(pal.line, 0.6);
      g.fillRect(0, Math.round(6 + (1 - v) * (H - 12)), W, 1);
    }
    const col = resolveColor(cur.c.color || cur.t.color);
    const S = sel();
    const list = cur.c.notes.map((n) => val(n));
    // unselected first, so selected stalks sit on top
    list.sort((a, b) => (S.has(a.id) ? 1 : 0) - (S.has(b.id) ? 1 : 0));
    for (const n of list) {
      const x = Math.round(xOf(n.t)) + 0.5;
      if (x < -4 || x > W + 4) continue;
      const y = 6 + (1 - n.v) * (H - 12);
      const on = S.has(n.id);
      g.fillStyle = on ? shade(col, 0.4) : rgba(col, 0.55);
      g.fillRect(x - 0.5, y, on ? 2 : 1.5, H - y);
      g.beginPath();
      g.arc(x + 0.25, y, on ? 3.5 : 2.6, 0, Math.PI * 2);
      g.fill();
      if (on) {
        g.strokeStyle = pal.text;
        g.lineWidth = 1;
        g.stroke();
      }
    }
  }

  /* ======================================================= events */
  function pick() {
    const was = cur?.c.id;
    cur = findCur();
    if (cur && cur.c.id !== was) {
      st.focus = st.focus === 'pianoroll' ? 'pianoroll' : st.focus;
    }
    if (cur && viewFor !== cur.c.id && ui.visible('pianoroll')) resetView();
    syncEmpty();
    syncBar();
    dirty = true;
  }
  const offSel = ui.on('select', () => pick());
  const offPres = ui.on('presence', () => {
    dirty = true;
  });
  const offSnap = ui.on('snap', () => {
    syncBar();
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
        const list = ids === 'all' ? f.clip.notes.map((n) => n.id) : ids;
        for (const id of list) flash.mark(clip + ':' + id, now);
      }
    }
    // drop selected notes that are gone
    if (cur) {
      const ids = new Set((store.findClip(cur.c.id)?.clip.notes || []).map((n) => n.id));
      const S = sel();
      if ([...S].some((id) => !ids.has(id))) st.selection.notes = new Set([...S].filter((id) => ids.has(id)));
    }
    tabView.changed();
    pick();
    if (cur) layout();
  }

  let lockSeen = null;
  function frame(now) {
    // Sketch's keys share the switch: when it flips there, the lamp and the shading follow here
    if (locked() !== lockSeen) {
      lockSeen = locked();
      syncBar();
      dirty = true;
    }
    if (tabOn()) {
      tabView.frame(now);
      return;
    }
    const r1 = grid.fit(),
      r2 = keys.fit(),
      r3 = ruler.fit(),
      r4 = vel.fit();
    if (r1 || r2 || r3 || r4) {
      dirty = true;
      layout();
    }
    if (cur && viewFor !== cur.c.id && grid.w > 10) resetView();
    if (drag && drag.moved && lastPointer && drag.mode !== 'vel' && drag.mode !== 'velpaint') {
      const r = scroller.getBoundingClientRect();
      const ex = lastPointer.clientX - r.left,
        ey = lastPointer.clientY - r.top;
      const sx = ex > r.width - 24 ? 10 : ex < 20 && scroller.scrollLeft > 0 ? -10 : 0;
      const sy = ey > r.height - 20 ? 8 : ey < 16 && scroller.scrollTop > 0 ? -8 : 0;
      if (sx || sy) {
        scroller.scrollLeft += sx;
        scroller.scrollTop += sy;
        moveDrag(lastPointer);
      }
    }
    const live = engine.playing || flash.active() || presenceList(ui).length > 0 || heldKey != null;
    if (!dirty && !live) return;
    // follow while playing (page flips)
    if (engine.playing && cur && !drag) {
      const ph = (engine.beat || 0) - cur.c.start;
      const x = xOf(ph);
      if (ph >= 0 && ph <= cur.c.length && (x > grid.w - 20 || x < 0)) scroller.scrollLeft = Math.max(0, ph * ppb - 20);
    }
    drawGrid(now);
    drawKeys();
    drawRuler();
    drawVel();
    dirty = false;
  }

  scroller.addEventListener('scroll', () => {
    dirty = true;
  });
  root.addEventListener(
    'pointerdown',
    () => {
      st.focus = 'pianoroll';
    },
    true,
  );
  setTool('draw');
  pick();

  // rows(): what each row on screen shows (the keyboard's names, in key or not, the root), for checks and agents' eyes
  const rows = () => {
    if (!cur) return [];
    const H = scroller.clientHeight,
      out = [];
    const pLo = Math.max(0, 127 - Math.ceil((scroller.scrollTop + H) / rowH)),
      pHi = Math.min(127, 127 - Math.floor(scroller.scrollTop / rowH));
    for (let q = pHi; q >= pLo; q--) out.push({ ...rowInfo(q), y: yOf(q), h: rowH });
    return out;
  };
  app.pianoroll = {
    setTool,
    quantize,
    transpose: (dir, oct) => transpose(dir, oct),
    resetView,
    transform: applyTransform,
    openTransform,
    rows,
    locked: () => lockOn(),
    tab: tabView,
    tabOn: () => tabOn(),
    setTab,
  };
  return {
    update: onChange,
    frame,
    refresh() {
      dirty = true;
      if (cur && viewFor !== cur.c.id) resetView();
    },
    unmount() {
      offSel();
      offPres();
      offSnap();
      offResize();
      offs.forEach((f) => f());
      tabView.unmount();
    },
  };
}

const CSS = `
.pr { position: relative; display: grid; grid-template-rows: 36px 1fr; height: 100%; min-height: 0; background: var(--panel); }
.pr-bar { display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--line); min-width: 0; overflow: hidden; }
.pr-clip { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; flex: 0 1 auto; }
.pr-clip b { font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; min-width: 3ch; flex: 0 1 auto; }
/* squeezed, the track's name gives way first and the byline never does */
.pr-on { color: var(--text-3); overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1000 auto; }
.pr-dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.pr-sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; flex: none; }
.pr-flex { flex: 1; min-width: 4px; }
.pr-seg { display: flex; gap: 2px; flex: none; }
.pr-tool { flex: none; }
.pr-bar .btn-txt { padding: 0 4px; }
.pr-chord { font-family: var(--font-display); font-variation-settings: var(--font-display-vars, normal); font-weight: 700; font-size: 16px; color: var(--accent-2); padding: 0 8px; flex: none; }
.pr-chord[hidden] { display: none; }
.pr-count { color: var(--text-3); font-size: 11.5px; white-space: nowrap; flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pr-main { display: grid; grid-template-columns: ${KEYS_W}px 1fr; grid-template-rows: ${RULER_H}px 1fr ${VEL_H}px; min-height: 0; min-width: 0; }
.pr-corner, .pr-velcorner { background: var(--bg-2); border-right: 1px solid var(--line); }
.pr-corner { border-bottom: 1px solid var(--line); }
.pr-velcorner { cursor: help; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: center; font-size: 9.5px; font-weight: 700; letter-spacing: .1em; color: var(--text-3); }
.pr-rulerwrap, .pr-keyswrap, .pr-gridwrap, .pr-velwrap { position: relative; overflow: hidden; min-width: 0; min-height: 0; touch-action: none; }
.pr-keyswrap { border-right: 1px solid var(--line); cursor: pointer; }
.pr-ruler, .pr-keys, .pr-grid, .pr-vel { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.pr-scroll { position: absolute; inset: 0; overflow: auto; outline: none; touch-action: none; }
.pr-scroll:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.pr-spacer { pointer-events: none; }
.pr-empty { position: absolute; inset: 36px 0 0 0; display: none; place-items: center; padding: 20px; background: var(--panel); }
.pr-isempty .pr-empty { display: grid; }
.pr-isempty .pr-bar > :not(.pr-clip) { visibility: hidden; }
/* the Tab view (ui/tabstaff.js) draws over the roll; the roll's drawing tools wait */
.pr-istab .pr-seg, .pr-istab .pr-seg + .pr-sep, .pr-istab .pr-snap, .pr-istab .pr-ghost { display: none; }
.pr-tabbtn[hidden] { display: none; }
.pr-empty-card { max-width: 46ch; }
.pr-empty-actions { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.pr-by { color: var(--text-3); font-size: 12px; flex: none; white-space: pre; }
.pr-qpop { width: 260px; }
.pr-qrow { display: grid; grid-template-columns: 64px 1fr 40px; align-items: center; gap: 8px; padding: 6px 10px; color: var(--text-2); }
.pr-qrow input { accent-color: var(--accent-2); width: 100%; }
.pr-qval { font: 600 11px var(--font-mono); color: var(--text); text-align: right; }
.pr-qhint { padding: 4px 10px; color: var(--text-3); font-size: 11px; line-height: 1.4; }
.pr-qact { display: flex; justify-content: flex-end; padding: 6px 8px 4px; }
.pr-txpop { width: 290px; max-height: min(560px, calc(100vh - 24px)); overflow-y: auto; }
.pr-txgroup { padding: 8px 10px 2px; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
.pr-txrow { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 6px; padding: 1px 6px 1px 4px; }
.pr-txgo { height: 26px; padding: 0 8px; border: 0; border-radius: var(--r-1); background: transparent; color: var(--text); font-size: 12px; font-weight: 600; text-align: left; cursor: pointer; }
.pr-txgo:hover:not([disabled]), .pr-txgo:focus-visible { background: var(--bg-3); outline: none; }
.pr-txgo[disabled] { color: var(--text-3); cursor: default; }
.pr-txsel { height: 24px; max-width: 130px; padding: 0 4px; border: 1px solid var(--line); border-radius: var(--r-1); background: var(--bg); color: var(--text-2); font-size: 11px; }
/* phones: 40 px targets, so the bar is 44 px and its words scroll sideways rather than shrink to icons */
@media (max-width: 900px) {
  .ew-shell .pr { grid-template-rows: 44px 1fr; }
  .ew-shell .pr-empty { inset: 44px 0 0 0; }
  .ew-shell .pr-bar { overflow-x: auto; scrollbar-width: none; gap: 4px; }
  .ew-shell .pr-bar::-webkit-scrollbar { display: none; }
  .ew-shell .pr-clip { flex: none; max-width: 42vw; }
}
@media (max-width: 700px) {
  .pr-main { grid-template-columns: 44px 1fr; }
  .pr-on, .pr-count, .pr-sep { display: none; }
  .pr-ghost { display: none; }
  .pr-tool.tog { padding: 0 6px; }
}
`;
