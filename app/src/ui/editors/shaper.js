// Scribble Strip's window (devices/builtin/shaper.js names it: editor 'shaper'). The selected lane's shape fills a big
// canvas: one pass of it over the beat grid, the passes either side in pencil, and while the song plays a leader-green
// dot rides the line at the transport's beat, with what the lane applies there (−6.0 dB, 1.2 kHz, L 40%) beside it.
//
// Drawing. Points mode: a click on the canvas adds a point (and a drag carries it on); drag a point to move it (it
// snaps to the grid; Shift: free; it stays between its neighbours); drag the small square on a line to bend it
// (double-click it: straight); right-click a point (a long press, the menu key) for step or line, straighten, add one
// after it, or delete it; double-click a point to delete it. Pencil mode: drag across the grid to paint steps. Snap
// sets the grid in steps a pass. Every gesture is one undo step signed you, through ctx.set (a drag is the same keys
// throughout, so the store coalesces it). Keys on a focused point: arrows move it (a grid step sideways, 5% up and down;
// Shift: fine), Alt with up or down bends the line after it, Enter turns it into a step or back, Delete removes it.
//
// Lanes are tabs (volume, filter, pan), each with its shape drawn small, a lamp when it's on and its rate. The presets
// are the device's own (def.presets: each the whole sound), drawn as a row of small shapes; the one the params are
// exactly is printed in reverse. The knobs (on, depth, rate, cutoff, reso, smooth, mix) are ctx.control(key), so
// automation, the menu and the agent's flash come with them. An agent's change to a shape flashes the canvas and the
// lane's tab in cool ink, draws the line cool for a moment, and the window's line says what it drew (said()); a
// person's drag is drawn in warm ink while it lasts. Under 900 px it stacks, with 44 px targets.
//
// What it keeps for the session (ui.state.shaperWin, per track and slot): the lane shown, points or pencil, the snap.
import { h, css, clamp, tok } from '../dom.js';
import { menu } from '../arrange-kit.js';
import { presetOf } from '../../devices/registry.js';
import { LANES, RATES, RATE_BEATS, NP, laneOf, pkey, slotDefault, pointsOf, valueAt, segmentAt, applied, lanePatch, shapeText, presetLane } from '../../devices/builtin/shaper.js';

const SNAPS = [0, 2, 3, 4, 6, 8, 12, 16, 24, 32];         // steps a pass (0: off)
const FINE = 1 / 192;                                     // a nudge with Shift, or with the snap off
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const r4 = (x) => Math.round(x * 10000) / 10000;
const frac = (x) => x - Math.floor(x);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dbText = (g) => (g <= 0.0005 ? '−∞ dB' : (() => { const d = 20 * Math.log10(g); return `${d < -0.05 ? '−' : ''}${Math.abs(d).toFixed(1)} dB`; })());
const hzText = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`);
const hzShort = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
const panText = (v) => (Math.abs(v) < 0.005 ? 'centre' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}%`);
// a pass's grid step as a note value, when it is one ("1/16 notes", "1/16 triplets", "1/8 dotted"), else null
function noteOf(beats) {
  const names = [[4, '1 bar'], [2, '1/2'], [1, '1/4'], [0.5, '1/8'], [0.25, '1/16'], [0.125, '1/32'], [0.0625, '1/64'], [1 / 32, '1/128']];
  for (const [b, n] of names) {
    if (Math.abs(beats - b) < 1e-6) return n + (n === '1 bar' ? '' : ' notes');
    if (Math.abs(beats - b * 2 / 3) < 1e-6) return n + ' triplets';
    if (Math.abs(beats - b * 1.5) < 1e-6) return n + ' dotted';
  }
  return null;
}

let uid = 0;
export function mount(el, ctx) {
  css('plugin-shaper', CSS);
  const { app, def } = ctx;
  const ui = app.ui;
  const id = `sh${++uid}`;
  const sessKey = `${ctx.addr.track}:${ctx.addr.slot}`;
  const seen = !!ui.state.shaperWin?.[sessKey];
  const sess = ((ui.state.shaperWin ||= {})[sessKey] ||= { lane: 'vol', mode: 'points', snap: 16 });
  // the first time it opens here, it shows the lane that's doing something (a wobble opens on the filter)
  if (!seen) sess.lane = presetLane({ params: ctx.params() });
  if (!laneOf(sess.lane)) sess.lane = 'vol';
  if (!SNAPS.includes(sess.snap)) sess.snap = 16;

  // the room's inks and the device's own colour (its tape)
  const ink = {
    text: tok('--text') || '#f4ead6', t2: tok('--text-2') || '#cbc0aa', t3: tok('--text-3') || '#9a8f7c', line: tok('--line') || '#2f2b25',
    line2: tok('--line-2') || '#46413a', accent: tok('--accent') || '#d9f36a', human: tok('--human') || '#ffa043', agent: tok('--agent') || '#4cc3ff',
    bg: tok('--bg') || '#141210', mono: tok('--font-mono') || 'monospace',
  };
  const tape = /^#[0-9a-f]{6}$/i.test(def.look?.color || '') ? def.look.color : ink.text;

  /* ---------------------------------------------------------------- what it plays now */
  let P = ctx.params();
  let L = laneOf(sess.lane), pts = pointsOf(P, L.id);
  const rateOf = (lane) => clamp(Math.round(P[`${lane}_rate`] ?? laneOf(lane).rate), 0, RATES.length - 1);
  const cycOf = (lane) => RATE_BEATS[rateOf(lane)];
  const onOf = (lane) => (P[`${lane}_on`] ?? laneOf(lane).on) >= 0.5;
  const bpm = () => +app.store.get().tempo || 120;
  const levelText = (lane, y) => (lane === 'vol' ? dbText(applied(P, 'vol', y)) : lane === 'flt' ? hzText(applied(P, 'flt', y)) : panText(applied(P, 'pan', y)));
  const placeText = (ph) => {
    const cyc = cycOf(L.id);
    if (cyc >= 1) return `beat ${(1 + ph * cyc).toFixed(2)}`;
    return `${Math.round(ph * 100)}% through the ${RATES[rateOf(L.id)]}`;
  };

  /* ---------------------------------------------------------------- the frame of it */
  const root = h('div.sh', { dataset: { lane: L.id } });
  const tabs = h('div.sh-tabs', { role: 'tablist', 'aria-label': `${def.name} lanes` });
  const tabEls = new Map();
  for (const lane of LANES) {
    const mini = h('span.sh-mini', { 'aria-hidden': 'true' });
    const meta = h('small.sh-tab-m');
    const t = h('button.sh-tab', { type: 'button', role: 'tab', id: `${id}-tab-${lane.id}`, 'aria-controls': `${id}-stage`, dataset: { lane: lane.id }, onclick: () => pickLane(lane.id) },
      mini, h('span.sh-tab-t', h('b.sh-tab-n', h('i.sh-lamp', { 'aria-hidden': 'true' }), lane.name), meta));
    tabEls.set(lane.id, { el: t, mini, meta });
    tabs.append(t);
  }
  tabs.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (e.key !== 'Home' && e.key !== 'End' && d == null) return;
    e.preventDefault(); e.stopPropagation();
    const i = LANES.findIndex((x) => x.id === L.id);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? LANES.length - 1 : (i + d + LANES.length) % LANES.length;
    pickLane(LANES[j].id); tabEls.get(LANES[j].id).el.focus();
  });
  const sum = h('p.sh-sum');
  const head = h('div.sh-head', tabs, sum);

  const cv = ctx.kit.canvas({ className: 'sh-cv', label: 'shape' });
  const field = h('div.sh-field', cv.el);
  const stage = h('div.sh-stage', { role: 'tabpanel', id: `${id}-stage` }, field);

  // the tools: points or pencil, the snap, what it applies now, and a line on how to draw
  const mode = ctx.kit.segmented({ key: 'mode', label: 'DRAW', opts: ['POINTS', 'PENCIL'] }, { value: sess.mode === 'pencil' ? 1 : 0, name: def.name, onChange: (i) => { sess.mode = i ? 'pencil' : 'points'; root.dataset.mode = sess.mode; hint(); } });
  const snap = ctx.kit.select({ key: 'snap', label: 'SNAP', opts: SNAPS.map((s) => (s ? `${s} steps` : 'Off')) }, { value: SNAPS.indexOf(sess.snap), name: def.name, onChange: (i) => { sess.snap = SNAPS[i]; snapNote(); cv.dirty(); } });
  const snapSay = h('span.sh-snap-n');
  const nowEl = h('output.sh-now', { 'aria-hidden': 'true' });
  const hintEl = h('p.sh-hint');
  const tools = h('div.sh-tools', mode.el, h('div.sh-snap', snap.el, snapSay), nowEl, hintEl);

  // the presets: the device's own, each drawn
  const preEls = [];
  const presets = h('div.sh-pre', { role: 'group', 'aria-label': `${def.name} presets` });
  for (const pr of def.presets || []) {
    const lane = presetLane(pr);
    const b = h('button.sh-pre-b', { type: 'button', 'aria-pressed': 'false', dataset: { preset: pr.name, lane }, title: pr.blurb || pr.name, 'aria-label': `${pr.name}${pr.blurb ? `: ${pr.blurb}` : ''}`, onclick: () => applyPreset(pr) },
      h('span.sh-pre-d', { 'aria-hidden': 'true' }, drawing(pointsOf(pr.params, lane), lane, 88, 30, 2)), h('span.sh-pre-n', pr.name));
    preEls.push({ el: b, pr });
    presets.append(b);
  }

  // the knobs: each lane's (its on, depth and rate, the filter's cutoff and reso), then the two for every lane
  const groups = new Map();
  const knobs = h('div.sh-ctl');
  for (const lane of LANES) {
    const g = h('section.sh-grp', { dataset: { lane: lane.id }, 'aria-label': `${lane.name} lane` },
      h('h3.sh-gh', `${lane.name} lane`),
      h('div.sh-row', ctx.control(`${lane.id}_on`, { label: false }), ctx.control(`${lane.id}_depth`, { label: 'DEPTH', size: 54 }), ctx.control(`${lane.id}_rate`, { label: 'RATE' }),
        lane.id === 'flt' ? ctx.control('flt_cut', { size: 54 }) : null, lane.id === 'flt' ? ctx.control('flt_res', { size: 54 }) : null));
    groups.set(lane.id, g);
    knobs.append(g);
  }
  knobs.append(h('section.sh-grp.sh-all', { 'aria-label': 'All lanes' }, h('h3.sh-gh', 'All lanes'), h('div.sh-row', ctx.control('smooth', { size: 54 }), ctx.control('mix', { size: 54 }))));

  root.append(head, stage, tools, presets, knobs);
  root.dataset.mode = sess.mode;
  el.append(root);

  /* ---------------------------------------------------------------- the geometry: a pass, with room either side */
  const geo = (w, hh) => {
    const side = clamp(Math.round(w * 0.075), 22, 72);
    const top = 14, bottom = hh - 24;
    return { w, h: hh, side, x0: side, x1: w - side, cw: Math.max(1, w - 2 * side), top, bottom, ch: Math.max(1, bottom - top) };
  };
  const fieldGeo = () => geo(field.clientWidth || 600, field.clientHeight || 260);
  const X = (G, ph) => G.x0 + ph * G.cw;
  const Y = (G, y) => G.bottom - y * G.ch;
  const at = (e) => {
    const r = field.getBoundingClientRect(), G = fieldGeo();
    return { G, ph: (e.clientX - r.left - G.x0) / G.cw, y: (G.bottom - (e.clientY - r.top)) / G.ch };
  };
  const snapX = (x, free) => (free || !sess.snap ? clamp(x, 0, 1) : clamp(Math.round(x * sess.snap) / sess.snap, 0, 1));
  // a level, held a moment at the top, the bottom and (pan) the middle
  const magnet = (y, free) => {
    y = clamp(y, 0, 1);
    if (free) return y;
    for (const m of L.id === 'pan' ? [0, 0.5, 1] : [0, 1]) if (Math.abs(y - m) < 0.015) return m;
    return y;
  };

  /* ---------------------------------------------------------------- the points and bend handles (DOM, over the canvas) */
  const handles = [], benders = [];
  for (let i = 1; i <= NP; i++) {
    const pt = h('div.sh-pt', { role: 'slider', tabindex: 0, hidden: true, dataset: { i: String(i) }, 'aria-valuemin': 0, 'aria-valuemax': 100 });
    pt.addEventListener('pointerdown', (e) => pointDown(e, i));
    pt.addEventListener('keydown', (e) => pointKey(e, i));
    pt.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); remove(i); });
    pt.addEventListener('focus', () => { focusSlot = i; showBend(); });
    pt.addEventListener('blur', () => { if (focusSlot === i) focusSlot = 0; showBend(); });
    ctx.kit.menuOn(pt, (anchor, e) => pointMenu(i, e && e.clientX != null ? { x: e.clientX, y: e.clientY } : pt), () => drag?.stop?.());
    handles.push(pt);
    const bd = h('div.sh-bend', { hidden: true, 'aria-hidden': 'true', title: 'Drag up or down to bend this line. Double-click: straight', dataset: { i: String(i) } });
    bd.addEventListener('pointerdown', (e) => bendDown(e, i));
    bd.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); setShape({ [pkey(L.id, i, 'c')]: 0 }, 'end', `straightened a ${L.word} line`); });
    benders.push(bd);
  }
  field.append(...benders, ...handles);
  let focusSlot = 0, hoverSlot = 0, order = '';
  const segOf = (i) => {
    // the line leaving slot i: from it to the next point (across the loop for the last)
    const k = pts.findIndex((p) => p.i === i);
    if (k < 0) return null;
    const a = pts[k], b = pts[(k + 1) % pts.length], x1 = k === pts.length - 1 ? b.x + 1 : b.x;
    return { a, b, x0: a.x, x1, len: x1 - a.x, rising: b.y > a.y, flat: Math.abs(b.y - a.y) < 0.02 };
  };
  function placeHandles() {
    const G = fieldGeo();
    const n = pts.length;
    const sig = pts.map((p) => p.i).join(',');
    if (sig !== order) {
      order = sig;
      const had = document.activeElement;
      for (const p of pts) field.append(handles[p.i - 1]);
      if (had && field.contains(had) && document.activeElement !== had) had.focus({ preventScroll: true });
    }
    for (let i = 1; i <= NP; i++) {
      const pt = handles[i - 1], k = pts.findIndex((p) => p.i === i);
      if (k < 0) { pt.hidden = true; benders[i - 1].hidden = true; continue; }
      const p = pts[k];
      pt.hidden = false;
      pt.style.left = X(G, p.x) + 'px'; pt.style.top = Y(G, p.y) + 'px';
      pt.dataset.step = p.s ? '1' : '';
      pt.setAttribute('aria-label', `${L.name} point ${k + 1} of ${n}`);
      pt.setAttribute('aria-valuenow', String(Math.round(p.y * 100)));
      pt.setAttribute('aria-valuetext', `${placeText(p.x)}, ${levelText(L.id, p.y)}, ${p.s ? 'a step' : p.c ? (p.c > 0 ? 'the line after it starts slow' : 'the line after it starts fast') : 'a straight line after it'}`);
      pt.title = 'Drag to move (Shift: off the grid). Right-click: step, line or delete. Arrow keys move it; Alt+up or down bends the line after it; Enter: step or line; Delete removes it';
      const s = segOf(i), bd = benders[i - 1];
      if (!s || p.s || s.flat || s.len < 0.01) { bd.hidden = true; continue; }
      let mid = (s.x0 + s.x1) / 2;
      if (mid >= 1) mid -= 1;
      bd.hidden = false;
      bd.style.left = X(G, mid) + 'px'; bd.style.top = Y(G, valueAt(pts, mid)) + 'px';
    }
    showBend();
  }
  function showBend() {
    for (let i = 1; i <= NP; i++) benders[i - 1].classList.toggle('on', i === focusSlot || i === hoverSlot || (drag && drag.i === i));
  }
  field.addEventListener('pointermove', (e) => {
    if (drag || e.pointerType === 'touch') return;
    const t = e.target.closest?.('.sh-pt, .sh-bend');
    const i = t ? +t.dataset.i : 0;
    if (i !== hoverSlot) { hoverSlot = i; showBend(); }
  });
  field.addEventListener('pointerleave', () => { if (hoverSlot) { hoverSlot = 0; showBend(); } });

  /* ---------------------------------------------------------------- writing: every gesture through ctx.set, signed you */
  let drag = null, warmUntil = 0;
  function setShape(patch, gesture = 'end', what = `changed the ${L.word} shape`) {
    const r = ctx.set(patch, { gesture, label: `${def.name}: ${what}` });
    if (r && r.ok === false && r.error) ctx.status(r.error);
    return r;
  }
  const slotPatch = (lane, i, p) => ({ [pkey(lane, i, 'x')]: r4(p.x), [pkey(lane, i, 'y')]: r4(p.y), [pkey(lane, i, 'c')]: p.s ? 0 : r4(p.c || 0), [pkey(lane, i, 's')]: p.s ? 1 : 0 });
  const neighbours = (i) => {
    const k = pts.findIndex((p) => p.i === i);
    return { lo: k > 0 ? pts[k - 1].x : 0, hi: k < pts.length - 1 ? pts[k + 1].x : 1 };
  };
  function addAt(x, y) {
    if (pts.length >= NP) { ctx.status(`A shape holds ${NP} points: delete one to add another.`); return 0; }
    const i = pts.length + 1;
    const p = { x, y, c: 0, s: 0 };
    setShape({ [`${L.id}_n`]: i, ...slotPatch(L.id, i, p) }, 'end', `added a ${L.word} point`);
    ui.announce?.(`Added a ${L.word} point: ${placeText(x)}, ${levelText(L.id, y)}`);
    return i;
  }
  function remove(i) {
    const n = pts.length;
    if (n <= 1) { ctx.status('A shape keeps at least one point.'); return; }
    const k = pts.findIndex((p) => p.i === i);
    if (k < 0) return;
    const patch = { [`${L.id}_n`]: n - 1 };
    // the last slot moves into the freed one, and its own goes back to its defaults
    if (i !== n) { const last = pointsOf(P, L.id).find((p) => p.i === n); Object.assign(patch, slotPatch(L.id, i, last)); }
    Object.assign(patch, slotPatch(L.id, n, slotDefault(L.id, n)));
    const was = pts[k];
    setShape(patch, 'end', `deleted a ${L.word} point`);
    ui.announce?.(`Deleted the ${L.word} point at ${placeText(was.x)}`);
    // focus: the point before it, else the first
    const next = pts[Math.max(0, k - 1)];
    if (next && root.contains(document.activeElement) && document.activeElement?.classList.contains('sh-pt')) handles[next.i - 1]?.focus({ preventScroll: true });
  }
  function toggleStep(i) {
    const p = pts.find((q) => q.i === i);
    if (!p) return;
    setShape({ [pkey(L.id, i, 's')]: p.s ? 0 : 1, [pkey(L.id, i, 'c')]: 0 }, 'end', p.s ? `made a ${L.word} point a line` : `made a ${L.word} point a step`);
    ui.announce?.(p.s ? 'A line again' : 'A step: it holds, then jumps at the next point');
  }

  // One pointer gesture on `target`: move(ev) while it lasts, then end() once; its listeners go either way. -> stop(),
  // which ends it now (a long press that opens the menu instead)
  const EVTS = ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'];
  function gesture(target, e, move, end) {
    try { target.setPointerCapture(e.pointerId); } catch { /* gone */ }
    const id = e.pointerId;
    let over = false;
    const on = (ev) => {
      if (over || (ev.pointerId != null && ev.pointerId !== id)) return;
      if (ev.type === 'pointermove') { move(ev); return; }
      stop();
    };
    const stop = () => {
      if (over) return;
      over = true;
      for (const t of EVTS) target.removeEventListener(t, on);
      end();
    };
    for (const t of EVTS) target.addEventListener(t, on);
    return stop;
  }
  // a point: drag to move it (between its neighbours; snapped unless Shift)
  function pointDown(e, i) {
    if (e.button !== 0 || sess.mode === 'pencil') return;
    e.preventDefault(); e.stopPropagation();
    const pt = handles[i - 1];
    pt.focus({ preventScroll: true });
    const d = drag = { kind: 'move', i, x0: e.clientX, y0: e.clientY, touch: e.pointerType === 'touch', moved: false, last: null };
    d.stop = gesture(pt, e, (ev) => {
      // (a finger rests a moment for the long press: nothing moves until it has gone 8 px)
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < (d.touch ? 8 : 2)) return;
      d.moved = true;
      const q = at(ev), nb = neighbours(i);
      const x = clamp(snapX(q.ph, ev.shiftKey), nb.lo, nb.hi), y = magnet(q.y, ev.shiftKey);
      d.last = { [pkey(L.id, i, 'x')]: r4(x), [pkey(L.id, i, 'y')]: r4(y) };
      warmUntil = performance.now() + 600;
      setShape(d.last, 'move', `moved a ${L.word} point`);
    }, () => {
      if (drag === d) drag = null;
      if (d.moved && d.last) setShape(d.last, 'end', `moved a ${L.word} point`);
      showBend(); cv.dirty();
    });
  }
  // a line's bend handle: drag up to bow the line up, down to bow it down
  function bendDown(e, i) {
    if (e.button !== 0 || sess.mode === 'pencil') return;
    e.preventDefault(); e.stopPropagation();
    const s = segOf(i);
    if (!s) return;
    const d = drag = { kind: 'bend', i, y0: e.clientY, c0: s.a.c, rising: s.rising, moved: false, last: null };
    d.stop = gesture(benders[i - 1], e, (ev) => {
      if (!d.moved && Math.abs(d.y0 - ev.clientY) < 2) return;
      d.moved = true;
      const up = (d.y0 - ev.clientY) / 80;
      d.last = { [pkey(L.id, i, 'c')]: Math.round(clamp(d.c0 + (d.rising ? -up : up), -1, 1) * 1000) / 1000 };
      warmUntil = performance.now() + 600;
      setShape(d.last, 'move', `bent a ${L.word} line`);
    }, () => {
      if (drag === d) drag = null;
      if (d.moved && d.last) setShape(d.last, 'end', `bent a ${L.word} line`);
      showBend(); cv.dirty();
    });
  }
  // the canvas: a click adds a point (and a drag carries it, in the same step); in pencil mode a drag paints steps
  field.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.sh-pt, .sh-bend')) return;
    const q = at(e);
    if (q.ph < -0.02 || q.ph > 1.02) return;   // (the faint passes either side are to look at)
    e.preventDefault();
    if (sess.mode === 'pencil') { paintDown(e, q); return; }
    const i = addAt(snapX(q.ph, e.shiftKey), magnet(q.y, e.shiftKey));
    if (!i) return;
    warmUntil = performance.now() + 600;
    // the drag that follows writes the same keys as the add, so the store keeps it the one step
    const d = drag = { kind: 'add', i, x0: e.clientX, y0: e.clientY, moved: false, last: null };
    d.stop = gesture(field, e, (ev) => {
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 3) return;
      d.moved = true;
      const q2 = at(ev), nb = neighbours(i);
      d.last = { [`${L.id}_n`]: pts.length, ...slotPatch(L.id, i, { x: clamp(snapX(q2.ph, ev.shiftKey), nb.lo, nb.hi), y: magnet(q2.y, ev.shiftKey), c: 0, s: 0 }) };
      warmUntil = performance.now() + 600;
      setShape(d.last, 'move', `added a ${L.word} point`);
    }, () => {
      if (drag === d) drag = null;
      if (d.moved && d.last) setShape(d.last, 'end', `added a ${L.word} point`);
      handles[i - 1]?.focus({ preventScroll: true });
      cv.dirty();
    });
  });

  // pencil: each grid cell the stroke crosses becomes a step at the pen's level; where a painted run ends, the shape
  // that was there picks up again. The whole lane is written on every move (the same keys: one undo step).
  function paintDown(e, q0) {
    const S = sess.snap || 16;
    const base = pts.map((p) => ({ ...p }));
    const cells = new Map();
    let lastCell = null, full = false;
    const cellOf = (ph) => clamp(Math.floor(clamp(ph, 0, 0.999999) * S), 0, S - 1);
    const paint = (q, free) => {
      // (a gate is mostly on or off: near the top or the bottom the pen lands there, unless Shift)
      const raw = clamp(q.y, 0, 1), c = cellOf(q.ph), y = free ? r4(raw) : raw > 0.94 ? 1 : raw < 0.06 ? 0 : r4(raw);
      // (a quick stroke skips cells: the ones it passed over since the last take this level too, not the last itself)
      const dir = lastCell == null || c === lastCell ? 0 : c > lastCell ? 1 : -1;
      const lo = dir > 0 ? lastCell + 1 : c, hi = dir < 0 ? lastCell - 1 : c;
      let changed = false;
      for (let k = lo; k <= hi; k++) {
        if (cells.get(k) === y) continue;
        const had = cells.has(k), prev = cells.get(k);
        cells.set(k, y);
        if (!painted(base, cells, S)) { if (had) cells.set(k, prev); else cells.delete(k); full = true; continue; }
        changed = true;
      }
      lastCell = c;
      if (!changed) return;
      d.last = lanePatch(L.id, painted(base, cells, S));
      warmUntil = performance.now() + 600;
      setShape(d.last, 'move', `painted the ${L.word} shape`);
    };
    const d = drag = { kind: 'paint', last: null };
    paint(q0, e.shiftKey);
    d.stop = gesture(field, e, (ev) => paint(at(ev), ev.shiftKey), () => {
      if (drag === d) drag = null;
      if (d.last) setShape(d.last, 'end', `painted the ${L.word} shape`);
      if (full) ctx.status(`A shape holds ${NP} points, so some steps didn't take: paint fewer changes, or a coarser snap.`);
      cv.dirty();
    });
  }
  // the points a stroke leaves: null when they'd be more than a shape holds
  function painted(base, cells, S) {
    const inPainted = (x) => cells.has(Math.min(S - 1, Math.floor(x * S + 1e-9)));
    const out = base.filter((p) => !inPainted(p.x)).map((p) => ({ x: p.x, y: p.y, c: p.c, s: p.s }));
    for (const [c, y] of cells) {
      out.push({ x: r4(c / S), y, c: 0, s: 1 });
      const endC = (c + 1) % S, end = endC / S;
      if (cells.has(endC)) continue;
      if (out.some((p) => Math.abs(p.x - end) < 1e-6) || base.some((p) => Math.abs(p.x - end) < 1e-6)) continue;
      // the shape that was there carries on from the end of the run
      const g = segmentAt(base, end), a = base[g.j0];
      out.push({ x: r4(end), y: r4(valueAt(base, end)), c: a.s ? 0 : a.c, s: a.s });
    }
    out.sort((a, b) => a.x - b.x);
    // a step that repeats the level before it adds nothing
    const lean = out.filter((p, k) => !(k > 0 && p.s && out[k - 1].s && Math.abs(out[k - 1].y - p.y) < 1e-6));
    return lean.length <= NP ? lean : null;
  }

  // keys on a focused point
  function pointKey(e, i) {
    if (e.metaKey || e.ctrlKey) return;
    const p = pts.find((q) => q.i === i);
    if (!p) return;
    const nb = neighbours(i);
    const stepX = e.shiftKey || !sess.snap ? FINE : 1 / sess.snap, stepY = e.shiftKey ? 0.01 : 0.05;
    let patch = null, what = `moved a ${L.word} point`;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const s = segOf(i);
      if (!s || p.s) return;
      const up = e.key === 'ArrowUp' ? 0.1 : -0.1;
      patch = { [pkey(L.id, i, 'c')]: Math.round(clamp(p.c + (s.rising ? -up : up), -1, 1) * 1000) / 1000 };
      what = `bent a ${L.word} line`;
    } else if (e.altKey) return;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const d = e.key === 'ArrowRight' ? 1 : -1;
      const x = clamp(e.shiftKey || !sess.snap ? p.x + d * stepX : (Math.round(p.x / stepX) + d) * stepX, nb.lo, nb.hi);
      patch = { [pkey(L.id, i, 'x')]: r4(x) };
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      patch = { [pkey(L.id, i, 'y')]: r4(clamp(p.y + (e.key === 'ArrowUp' ? stepY : -stepY), 0, 1)) };
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      patch = { [pkey(L.id, i, 'y')]: r4(clamp(p.y + (e.key === 'PageUp' ? 0.25 : -0.25), 0, 1)) };
    } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(i); return; }
    else if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); e.stopPropagation(); toggleStep(i); return; }
    else return;
    e.preventDefault(); e.stopPropagation();
    if (patch) setShape(patch, 'end', what);
  }
  // a point's menu: right-click, a long press, the menu key
  function pointMenu(i, anchor) {
    const p = pts.find((q) => q.i === i);
    if (!p) return;
    const k = pts.indexOf(p), n = pts.length;
    menu(anchor, [
      { head: `${L.name} point ${k + 1} of ${n}` },
      p.s ? { label: 'Make it a line', sub: 'a line to the next point', run: () => toggleStep(i) } : { label: 'Make it a step', sub: 'holds, then jumps at the next', kbd: 'Enter', run: () => toggleStep(i) },
      { label: 'Straighten the line after it', disabled: p.s || !p.c, run: () => setShape({ [pkey(L.id, i, 'c')]: 0 }, 'end', `straightened a ${L.word} line`) },
      { label: 'Add a point after it', sub: 'halfway to the next', disabled: n >= NP, run: () => {
        const s = segOf(i);
        let mid = (s.x0 + s.x1) / 2; if (mid >= 1) mid -= 1;
        const j = addAt(r4(mid), r4(valueAt(pts, mid)));
        // (the store tells the window at once, so the new point's handle is already in place)
        if (j) setTimeout(() => handles[j - 1]?.focus({ preventScroll: true }), 0);
      } },
      '-',
      { label: 'Delete it', kbd: 'Delete', danger: true, disabled: n <= 1, run: () => remove(i) },
    ]);
  }

  /* ---------------------------------------------------------------- the lanes, the presets */
  function pickLane(lane) {
    if (!laneOf(lane)) return;
    sess.lane = lane;
    L = laneOf(lane);
    root.dataset.lane = lane;
    order = '';
    render();
  }
  function applyPreset(pr) {
    const params = { ...pr.params };
    const op = ctx.addr.slot === 'instrument' ? { type: 'instrument.set', track: ctx.addr.track, params } : { type: 'insert.set', track: ctx.addr.track, insert: ctx.addr.slot, patch: { params } };
    const r = app.store.dispatch(op, { by: 'you', label: `${def.name}: ${pr.name}` });
    if (!r.ok) { ui.toast?.(r.error, { kind: 'bad' }); return; }
    ui.announce?.(`${def.name}: ${pr.name}`);
    const lane = presetLane(pr);
    if (lane !== L.id) pickLane(lane);
  }

  /* ---------------------------------------------------------------- reading it back out */
  function snapNote() {
    const cyc = cycOf(L.id), S = sess.snap;
    if (!S) { snapSay.textContent = 'free'; return; }
    const nm = noteOf(cyc / S);
    snapSay.textContent = nm || `${Math.round((cyc / S) * 60000 / bpm())} ms each`;
  }
  function hint() {
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    hintEl.textContent = sess.mode === 'pencil'
      ? 'Drag across the grid to paint steps at the pen\'s height.'
      : `${touch ? 'Tap' : 'Click'} to add a point. Drag a point to move it, or the square on a line to bend it. ${touch ? 'Hold' : 'Right-click'} a point for more.`;
  }
  // the words: each tab's lamp and rate, the line over the canvas, what the canvas is called, the snap's note value
  function labels() {
    for (const lane of LANES) {
      const t = tabEls.get(lane.id), on = onOf(lane.id), sel = lane.id === L.id;
      t.el.setAttribute('aria-selected', String(sel));
      t.el.tabIndex = sel ? 0 : -1;
      t.el.dataset.on = on ? '1' : '';
      t.el.setAttribute('aria-label', `${lane.name} lane, ${on ? `on, every ${RATES[rateOf(lane.id)]}` : 'off'}`);
      const meta = on ? `every ${RATES[rateOf(lane.id)]}` : 'off';
      if (t.meta.textContent !== meta) t.meta.textContent = meta;
      groups.get(lane.id).hidden = !sel;
    }
    stage.setAttribute('aria-labelledby', `${id}-tab-${L.id}`);
    const cyc = cycOf(L.id), ms = Math.round(cyc * 60000 / bpm());
    const said = `${plural(pts.length, 'point')}, every ${RATES[rateOf(L.id)]}, ${ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`} at ${+bpm().toFixed(2)} bpm${onOf(L.id) ? '' : ', lane off'}`;
    if (sum.textContent !== said) sum.textContent = said;
    cv.set({ label: `${L.name} shape, every ${RATES[rateOf(L.id)]}${onOf(L.id) ? '' : ' (off)'}: ${shapeText(pts)}` });
    snapNote();
  }
  function render() {
    P = ctx.params();
    pts = pointsOf(P, L.id);
    for (const lane of LANES) tabEls.get(lane.id).mini.replaceChildren(drawing(pointsOf(P, lane.id), lane.id, 54, 20, 1));
    labels();
    const now = presetOf(def, ctx.stored());
    for (const { el: b, pr } of preEls) { const on = !!now && now.name === pr.name; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('sel-print', on); }
    placeHandles();
    cv.dirty();
  }

  /* ---------------------------------------------------------------- the canvas */
  const live = { playing: false, ph: 0, at: 0, nowAt: 0 };
  let coolUntil = 0;
  const shapeKeys = (lane) => (k) => k === `${lane}_n` || new RegExp(`^${lane}\\d+_[xycs]$`).test(k);
  cv.set({
    // (while it plays, while an agent's or a hand's ink is up, and one frame after, to put the cream back)
    animate: () => live.playing || !!drag || performance.now() < coolUntil || performance.now() < warmUntil || !!root.dataset.ink,
    draw: (g, { w, h: hh, now }) => {
      const G = geo(w, hh), cyc = cycOf(L.id), on = onOf(L.id);
      g.font = `400 10.5px ${ink.mono}`;
      // the strip: a pass of it, faintly in the device's own colour
      g.globalAlpha = 0.045; g.fillStyle = tape; g.fillRect(G.x0, G.top - 6, G.cw, G.ch + 12); g.globalAlpha = 1;
      // levels: the top and bottom, quarters between (the middle stronger on pan)
      g.lineWidth = 1;
      for (const y of [0, 0.25, 0.5, 0.75, 1]) {
        const strong = y === 0 || y === 1 || (L.id === 'pan' && y === 0.5);
        g.globalAlpha = strong ? 1 : 0.5; g.strokeStyle = ink.line2;
        g.beginPath(); g.moveTo(0, Math.round(Y(G, y)) + 0.5); g.lineTo(w, Math.round(Y(G, y)) + 0.5); g.stroke();
      }
      g.globalAlpha = 1;
      // the grid: the snap's steps in hairline, beats stronger, the pass's edges strongest; the beats numbered
      const S = sess.snap;
      const vline = (ph, color, alpha = 1) => { const x = Math.round(X(G, ph)) + 0.5; g.globalAlpha = alpha; g.strokeStyle = color; g.beginPath(); g.moveTo(x, G.top - 6); g.lineTo(x, G.bottom + 6); g.stroke(); g.globalAlpha = 1; };
      if (S) for (let k = -1; k <= 1; k++) for (let j = 1; j < S; j++) { const ph = k + j / S; if (ph > -G.x0 / G.cw && ph < 1 + G.side / G.cw) vline(ph, ink.line2, k ? 0.3 : 0.55); }
      if (cyc > 1) for (let k = -1; k <= 1; k++) for (let b = 1; b < cyc; b++) { const ph = k + b / cyc; if (ph > -G.x0 / G.cw && ph < 1 + G.side / G.cw) vline(ph, ink.line2, k ? 0.6 : 1); }
      vline(0, ink.t3); vline(1, ink.t3);
      g.fillStyle = ink.t3; g.textBaseline = 'top';
      if (cyc >= 1) { for (let b = 0; b < cyc; b++) g.fillText(String(b + 1), X(G, b / cyc) + 4, G.bottom + 8); }
      else g.fillText('1', X(G, 0) + 4, G.bottom + 8);
      const ms = Math.round(cyc * 60000 / bpm());
      const passTxt = `${RATES[rateOf(L.id)]}, ${ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`}`;
      g.textAlign = 'right'; g.fillText(passTxt, X(G, 1) - 4, G.bottom + 8); g.textAlign = 'left';
      // what the top, middle and bottom mean, at the far left, just over their lines
      g.textBaseline = 'bottom';
      const lab = (y, t) => { g.fillStyle = ink.t3; g.fillText(t, 4, Math.max(G.top + 8, Y(G, y) - 3)); };
      if (G.side >= 40) {
        if (L.id === 'pan') { lab(1, 'R'); lab(0.5, 'C'); lab(0, 'L'); }
        else { lab(1, L.id === 'vol' ? '0 dB' : hzShort(applied(P, 'flt', 1))); lab(0, L.id === 'vol' ? dbText(applied(P, 'vol', 0)) : hzShort(applied(P, 'flt', 0))); }
      }
      // the shape: the passes either side in pencil, this one in cream (an agent's change cool for a moment, a
      // person's hand warm while it draws), filled under like a level
      const tNow = performance.now();
      const who = tNow < coolUntil ? 'agent' : tNow < warmUntil || drag ? 'you' : '';
      const lineInk = who === 'agent' ? ink.agent : who === 'you' ? ink.human : ink.text;
      if (root.dataset.ink !== who) root.dataset.ink = who;
      const trace = (from, to) => {
        // the line from phase `from` to `to`, a vertex a pixel, with the jumps at the points drawn upright
        const x0 = X(G, from), x1 = X(G, to), path = [];
        const jumps = [];
        for (let k = Math.floor(from) - 1; k <= Math.ceil(to); k++) for (const p of pts) { const ph = p.x + k; if (ph > from && ph < to) jumps.push(ph); }
        jumps.sort((a, b) => a - b);
        let ji = 0;
        for (let x = x0; x <= x1 + 0.001; x += 1) {
          const ph = from + (x - x0) / G.cw;
          while (ji < jumps.length && jumps[ji] <= ph) { const jp = jumps[ji++]; path.push([X(G, jp), Y(G, valueAt(pts, jp - 1e-7))], [X(G, jp), Y(G, valueAt(pts, jp))]); }
          path.push([x, Y(G, valueAt(pts, Math.min(ph, to)))]);
        }
        return path;
      };
      const stroke = (path, color, alpha, width) => { g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.beginPath(); path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.globalAlpha = 1; };
      const left = trace(-G.x0 / G.cw, 0), right = trace(1, 1 + G.side / G.cw), main = trace(0, 1);
      stroke(left, ink.t3, 0.55, 1.25); stroke(right, ink.t3, 0.55, 1.25);
      // the fill: down to the bottom (pan: to the middle)
      const base = L.id === 'pan' ? Y(G, 0.5) : Y(G, 0);
      g.globalAlpha = on ? 0.09 : 0.04; g.fillStyle = lineInk;
      g.beginPath(); g.moveTo(main[0][0], base); for (const [x, y] of main) g.lineTo(x, y); g.lineTo(main[main.length - 1][0], base); g.closePath(); g.fill(); g.globalAlpha = 1;
      if (!on) g.setLineDash([5, 4]);
      stroke(main, lineInk, on ? 1 : 0.7, 2);
      g.setLineDash([]);
      // the playhead: a hairline at the beat and a dot on the line, with what the lane applies there
      if (live.playing) {
        const x = X(G, live.ph), y = Y(G, valueAt(pts, live.ph));
        g.strokeStyle = ink.accent; g.globalAlpha = 0.55; g.lineWidth = 1;
        g.beginPath(); g.moveTo(Math.round(x) + 0.5, G.top - 6); g.lineTo(Math.round(x) + 0.5, G.bottom + 6); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = ink.accent; g.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
        const t = on ? levelText(L.id, valueAt(pts, live.ph)) : 'off';
        g.font = `600 11px ${ink.mono}`; g.textBaseline = 'bottom';
        const tw = g.measureText(t).width, tx = x + 10 + tw > G.x1 ? x - 10 - tw : x + 10, ty = y - 8 < G.top + 12 ? y + 22 : y - 8;
        g.fillStyle = ink.bg; g.globalAlpha = 0.8; g.fillRect(tx - 3, ty - 14, tw + 6, 16); g.globalAlpha = 1;
        g.fillStyle = ink.text; g.fillText(t, tx, ty);
      }
      void now;
    },
  });

  /* ---------------------------------------------------------------- keeping up: params, the transport, agents */
  const off = ctx.on((evt) => {
    // a lane moving a knob while the song plays (depth, rate, on: never the points) comes every frame: the words and
    // the canvas follow it, the rest is as it was
    if (evt.kind === 'lane') { P = ctx.params(); labels(); cv.dirty(); return; }
    render();
    if (evt.kind === 'do' && evt.by && ctx.isAgent(evt.by)) {
      const touched = LANES.filter((lane) => (evt.keys || []).some(shapeKeys(lane.id)));
      for (const lane of touched) ctx.flash(tabEls.get(lane.id).el);
      if (touched.some((lane) => lane.id === L.id)) { ctx.flash(field); coolUntil = performance.now() + 1700; }
    }
  });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeHandles()) : null;
  ro?.observe(field);

  hint();
  render();

  let nowAt = 0;
  return {
    update(evt) { if (evt && evt.type === 'on') cv.dirty(); },
    frame(now) {
      const eng = app.engine;
      const playing = !!eng?.playing && fin(eng.beat);
      if (playing) {
        const ph = frac(eng.beat / cycOf(L.id));
        live.ph = ph;
        if (now - nowAt > 80) {
          nowAt = now;
          nowEl.textContent = onOf(L.id) ? `Now ${levelText(L.id, valueAt(pts, ph))}` : 'Lane off';
          root.dataset.phase = ph.toFixed(4);
        }
      } else if (live.playing) { nowEl.textContent = ''; root.dataset.phase = ''; cv.dirty(); }
      live.playing = playing;
    },
    // what an agent's change to the points did, for the window's line ("Claude drew the volume shape: 3 points")
    said(keys, by) {
      void by;
      const lanes = LANES.filter((lane) => keys.some(shapeKeys(lane.id)));
      if (!lanes.length) return null;
      if (lanes.length > 1) return `drew the ${lanes.map((l) => l.word).join(' and ')} shapes.`;
      const lane = lanes[0], n = pointsOf(ctx.params(), lane.id).length;
      return `drew the ${lane.word} shape: ${plural(n, 'point')}${onOf(lane.id) ? `, every ${RATES[rateOf(lane.id)]}` : ', with its lane off'}.`;
    },
    unmount() { off(); ro?.disconnect(); cv.destroy(); root.remove(); },
  };
}

/* ---------------------------------------------------------------- a shape drawn small (tabs, presets): an SVG */
const SVGNS = 'http://www.w3.org/2000/svg';
function drawing(pts, lane, w, hh, passes = 1) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${hh}`); s.setAttribute('width', w); s.setAttribute('height', hh);
  const pad = 2, ih = hh - 2 * pad, d = [];
  const N = w * 2;
  let prev = null;
  for (let k = 0; k <= N; k++) {
    const ph = (k / N) * passes, v = valueAt(pts, ph % 1 === 0 && k === N ? 0.999999 : ph);
    const x = (k / N) * w, y = pad + (1 - v) * ih;
    if (prev != null && Math.abs(prev - y) > ih * 0.3) d.push(`L${x.toFixed(1)},${prev.toFixed(1)}`);
    d.push(`${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
    prev = y;
  }
  const base = lane === 'pan' ? pad + ih / 2 : hh - pad;
  const fill = document.createElementNS(SVGNS, 'path');
  fill.setAttribute('d', `${d.join('')}L${w},${base}L0,${base}Z`); fill.setAttribute('class', 'sh-dr-f');
  const line = document.createElementNS(SVGNS, 'path');
  line.setAttribute('d', d.join('')); line.setAttribute('class', 'sh-dr-l');
  s.append(fill, line);
  return s;
}

const CSS = `
/* Scribble Strip's window (ui/editors/shaper.js): the lane tabs over a big canvas, the tools, the presets drawn, then
   the knobs. Hairlines between regions, no boxes; things you press have the one 2 px corner. */
.sh { width: 880px; max-width: 100%; min-width: 0; display: flex; flex-direction: column; }
.sh-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 6px 20px; padding: 12px 20px 0; border-bottom: var(--rule); }
.sh-tabs { display: flex; gap: 2px; min-width: 0; }
.sh-tab { position: relative; display: inline-flex; align-items: center; gap: 10px; min-width: 0; margin-bottom: -1px; padding: 6px 12px 10px 8px; border: 0; border-bottom: 2px solid transparent; border-radius: var(--r-press) var(--r-press) 0 0; background: none; color: var(--text-3); cursor: pointer; text-align: left; }
.sh-tab:hover { color: var(--text-2); background: var(--bg-3); }
.sh-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--text); background: none; }
.sh-tab:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.sh-tab-t { display: grid; gap: 3px; }
.sh-tab-n { font: italic 800 17px/1 var(--font-display); font-stretch: 112%; font-variation-settings: 'wdth' 112; letter-spacing: -.005em; white-space: nowrap; }
.sh-tab-m { font: 400 11px/1.2 var(--font-mono); color: var(--text-3); white-space: nowrap; }
.sh-tab[aria-selected="true"] .sh-tab-m { color: var(--text-2); }
.sh-mini svg { display: block; }
/* (the lane's lamp, a .tog's: lit while the lane is on) */
.sh-lamp { display: inline-block; width: 6px; height: 6px; margin: 0 8px 0 1px; vertical-align: 0.22em; background: var(--line-2); }
.sh-tab[data-on="1"] .sh-lamp { background: var(--accent-2); box-shadow: 0 0 5px color-mix(in srgb, var(--accent-2) 60%, transparent); }
.sh-dr-l { fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linejoin: round; }
.sh-dr-f { fill: currentColor; opacity: .1; stroke: none; }
.sh-tab:not([data-on="1"]) .sh-mini { opacity: .55; }
.sh-sum { margin: 0 0 10px; font: 400 11.5px/1.3 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-3); white-space: nowrap; }
/* the canvas: a pass of the shape, the points and bend squares over it */
.sh-stage { position: relative; padding: 12px 0 4px; border-bottom: var(--rule); }
.sh-field { position: relative; height: 256px; touch-action: none; user-select: none; -webkit-user-select: none; cursor: crosshair; outline: none; }
.sh[data-mode="pencil"] .sh-field { cursor: cell; }
.sh-cv { position: absolute; inset: 0; width: 100%; height: 100%; }
.sh-pt { position: absolute; z-index: 2; width: 12px; height: 12px; margin: -6px 0 0 -6px; background: var(--text); border: 2px solid var(--panel); border-radius: var(--r-press); box-sizing: border-box; cursor: grab; touch-action: none; outline: none; }
.sh-pt[data-step="1"] { background: var(--panel); border: 2px solid var(--text); }
.sh-pt:hover { transform: scale(1.2); }
.sh-pt:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.sh-pt:active { cursor: grabbing; border-color: var(--human); }
.sh[data-mode="pencil"] .sh-pt, .sh[data-mode="pencil"] .sh-bend { pointer-events: none; }
.sh[data-mode="pencil"] .sh-pt { opacity: .5; }
.sh-bend { position: absolute; z-index: 1; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border: 1.5px solid var(--text-3); border-radius: var(--r-press); background: var(--panel); box-sizing: border-box; cursor: ns-resize; opacity: .55; touch-action: none; }
.sh-bend.on, .sh-bend:hover { opacity: 1; border-color: var(--text); }
.sh-pt[hidden], .sh-bend[hidden] { display: none; }
/* the tools: points or pencil, the snap, what it applies now, how to draw */
.sh-tools { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 22px; padding: 12px 20px 14px; border-bottom: var(--rule); }
.sh-snap { display: inline-flex; align-items: flex-end; gap: 8px; }
.sh-snap-n, .sh-now { font: 400 11.5px/28px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-3); white-space: nowrap; }
.sh-now { min-width: 104px; color: var(--text); }
.sh-hint { flex: 1 1 220px; min-width: 0; margin: 0; font-size: 12px; line-height: 1.4; color: var(--text-3); }
/* the presets, drawn: the one the params are is printed in reverse */
.sh-pre { display: grid; grid-template-columns: repeat(auto-fill, minmax(98px, 1fr)); gap: 2px; padding: 10px 14px; border-bottom: var(--rule); }
.sh-pre-b { display: grid; justify-items: center; align-content: start; gap: 5px; min-width: 0; padding: 8px 4px 7px; border: 0; border-radius: var(--r-press); background: none; color: var(--text-2); cursor: pointer; }
.sh-pre-b:hover { background: var(--bg-3); color: var(--text); }
.sh-pre-b:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.sh-pre-b.sel-print, .sh-pre-b.sel-print:hover { background: var(--text); color: var(--bg); }
.sh-pre-d svg { display: block; }
.sh-pre-n { max-width: 100%; font: 600 11.5px/1.25 var(--font-ui); text-align: center; }
/* the knobs: this lane's, then the two for every lane */
.sh-ctl { display: flex; flex-wrap: wrap; align-items: flex-start; }
.sh-grp { flex: 1 1 auto; min-width: 0; margin: -1px 0 0 -1px; padding: 14px 20px 16px; border-top: var(--rule); border-left: var(--rule); }
.sh-grp[hidden] { display: none; }
.sh-all { flex: 0 1 auto; }
.sh-gh { margin: 0 0 12px; font: 600 13px/1.2 var(--font-ui); color: var(--text-2); }
.sh-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 14px 18px; }
/* a phone: everything stacks, 44 px to press */
.pw-phone .sh-head { padding: 8px 12px 0; }
.pw-phone .sh-tabs { width: 100%; }
.pw-phone .sh-tab { flex: 1 1 0; justify-content: center; min-height: 52px; padding: 6px 6px 8px; gap: 6px; }
.pw-phone .sh-mini { display: none; }
.pw-phone .sh-tab-n { font-size: 16px; }
.pw-phone .sh-tab-m, .pw-phone .sh-sum, .pw-phone .sh-snap-n, .pw-phone .sh-now, .pw-phone .sh-pre-n, .pw-phone .sh-hint { font-size: 12px; }
.pw-phone .sh-sum { white-space: normal; margin: 8px 0; }
.pw-phone .sh-field { height: 220px; }
.pw-phone .sh-pt::before, .pw-phone .sh-bend::before { content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
.pw-phone .sh-tools { padding: 10px 12px 12px; gap: 10px 14px; }
.pw-phone .sh-pre { grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 8px 6px; }
.pw-phone .sh-pre-b { min-height: 64px; padding: 6px 2px; }
.pw-phone .sh-pre-d svg { width: 100%; max-width: 72px; height: auto; }
.pw-phone .sh-grp { flex-basis: 100%; padding: 12px 12px 14px; }
@media (pointer: coarse) { .sh-pt::before, .sh-bend::before { content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); } }
`;
