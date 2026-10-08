// The rack: the selected track's chain, left to right, on a softly lit board. The instrument (or the input, or the
// sum of every track on the master), each insert as its face (ui/faces.js), cables between them, an Add slot, and
// the way out to the mixer. Knobs dispatch insert.set / instrument.set (one gesture = one undo step); an agent's
// changes flash in --agent and the knob it turned glows; presence labels sit on whatever an agent is working on.
//
// Also the small shared kit of the ui-mix panels (mixer, browser, inspector, export import these):
//   authorKind(app, by) -> 'human' | 'agent' | 'house'
//   currentTrack(app)   -> the selected track id, 'master', or the first track's id (or null)
//   addDevice(app, id, { track, index, toast }) -> dispatch result (instrument -> instrument.set, effect -> insert.add)
//   isMismatch(def, track, project) -> true when putting instrument def on that track would play its notes on the wrong
//                         kind of sound: a melodic instrument on a drum track, or a kit on a pitched track that has
//                         notes (the browser's click asks first, a drop on a lane makes a new track instead)
//   applyRig(app, rig, { track, replace, index }) -> dispatch result (a guitar rig's whole chain, one undo step)
//   guitar()            -> Promise<{ RIGS, RIG_BANKS, rigOps } | null>   (devices/guitar/index.js, if it's there)
//   popover(anchor, content, { onClose, align }) -> { el, close() }   a non-modal floating card (Esc / outside closes)
//   devicePicker(app, anchor, { kind, track, onPick(def), only(def) }) -> the popover: Add an effect's search (the Jam
//                         room's Add a pedal opens it too)
//   miniKnob({ value, min, max, def, label, fmt, onInput(v, commit) }) -> el with .set(v)
//   swatchOf(def) -> { color, ink }
//   automation on the controls (docs/research/AUTOMATION.md 3.6; the rack's knobs and the mixer's faders and pans):
//   laneFor(app, addr) -> { lane, spec, held } | null      addr = { track, insert?, param } as the auto ops name a lane
//   laneNow(app, addr, l?) -> the playing lane's value at the playhead (stopped: the marker), or null (none, or held)
//   laneNote(app, addr, name) -> "Follows its lane (Cutoff, bars 9–16)" / "Held: its lane (bars 9–16) is off"
//   controlOps(app, addr, op) -> [op] or [op, auto.set off]: a hand on an automated control holds its lane (one undo
//                                step with the move, under the control's coalesce key); never while R records
//   heldNote(app, addr, name, valueText, { later }) / heldSay(app, valueText): the first hold's toast, said when the
//   gesture ends; backToLane(app, addr, name), automate(app, addr, name)
//   controlMenu(app, anchor, addr, { name, can }) -> the right-click menu: Automate, Back to the lane (a master lane:
//                                       Clear its lane, as the arranger has no row for it; clearMasterLane)
//
// app.rack = { refresh(), focusInsert(insertId), openCode(deviceId), presetOf(track, slot), keptOff(), showKeptOff(),
//              isMismatch(def, track, project) }
//   (openCode: the read-only kernel sheet; presetOf: what a face's preset line says, { name, label, edited }, slot
//   'instrument' or an insert id; keptOff: the ids of the tracks, in song order, with a device whose code is kept off
//   here, devices/trust.js; showKeptOff: Devices on the first of them, for the ask's "The Devices tab can play them")
// Kept off: the track picker says "kept off" beside each such track, and Devices opened with no track chosen yet shows
// the first of them rather than the song's first track.
//
// Presets: a device with def.presets gets a line under its caption, "Preset  Felt", that opens the short list. The
// name is the preset the params are exactly (presetOf in the registry, which get_project also tells agents, so the
// rack and an agent name the same sound); after a knob moves off it, "Felt, edited". With no preset matched this
// session, the nearest one names it when the sound is plainly that preset moved a little ("Sprocket, edited": a song
// built from it, as Vacancy's parts are); at the defaults it says "Default" (or the preset that is the defaults), near
// them "Default, edited"; else "Custom". The window's preset line is the same (presetNow). Picking one is one
// instrument.set (or insert.set) with its whole params: one undo step. What it was last on lives in ui.state.presets
// (the session, per slot), and an undo of the change that put it there takes it back.
//   presetNow(app, track, slot) -> { name, label, edited } | null      nearestPreset(def, params) -> { name, d } | null
// Near is measured in knob travel (core/automation.js toPos, so a log knob's octave counts as much at 100 Hz as at
// 10 kHz), a switch on another option counting a whole travel: the nearest of the presets and the defaults is named
// when the sound is less than half as far from it as from the next nearest, and less than half way to the nearest
// other sound.

import { h, css, icon, drag, clamp, fmtDb, byline } from './dom.js';
import {
  DEVICE_CATS,
  paramValues,
  presetParams,
  presetOf,
  normParam,
  getDevice,
  heldDevice,
} from '../devices/registry.js';
import { popFocus, popLabel, menu as kitMenu, songColor, isHexColor, touchFirst } from './arrange-kit.js';
import { laneAt, specFor, valueAt, toPos } from '../core/automation.js';
import { dataState, onData } from '../kernel/data.js';

let faces = null; // ui/faces.js (renderFace); FALLBACK below until/unless it loads
const facesReady = import('./faces.js')
  .then((m) => {
    faces = m;
    return m;
  })
  .catch((e) => {
    console.warn('rack: faces.js did not load, using plain faces', e.message);
    return null;
  });
let guitarMod;
export function guitar() {
  if (guitarMod === undefined) guitarMod = import('../devices/guitar/index.js').catch(() => null);
  return guitarMod;
}

/* ================================================================ shared helpers */
export function authorKind(app, by) {
  if (!by) return 'house';
  const a = app.store.author ? app.store.author(by) : null;
  if (!a) return by === 'you' ? 'human' : 'agent';
  return a.kind === 'agent' ? 'agent' : a.kind === 'house' ? 'house' : 'human';
}
export const authorVar = (kind) =>
  kind === 'agent' ? 'var(--agent)' : kind === 'human' ? 'var(--human)' : 'var(--line-2)';
export function authorName(app, by) {
  try {
    return app.store.author(by).name;
  } catch (e) {
    return String(by || '');
  }
}

export function currentTrack(app) {
  const sel = app.ui.state.selection.track;
  const p = app.store.get();
  if (sel === 'master') return 'master';
  if (sel && p.tracks.some((t) => t.id === sel)) return sel;
  return p.tracks[0]?.id || null;
}

// search ranking: a name that starts with the words, then a name that has them, then the rest (blurb, nod, kind)
export function rankDevices(defs, q) {
  const s = String(q || '')
    .trim()
    .toLowerCase();
  if (!s) return defs.slice();
  const score = (d) => {
    const n = String(d.name).toLowerCase();
    return n.startsWith(s)
      ? 0
      : n.split(/[\s-]+/).some((w) => w.startsWith(s))
        ? 1
        : n.includes(s)
          ? 2
          : String(d.kindLabel || '')
                .toLowerCase()
                .includes(s)
            ? 3
            : 4;
  };
  return defs
    .map((d, i) => [score(d), i, d])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((x) => x[2]);
}

export function swatchOf(def) {
  if (faces?.colorsOf) {
    try {
      return faces.colorsOf(def);
    } catch (e) {
      /* below */
    }
  }
  const L = def?.look || {}; // (a song's device brings its own look: hex only, as faces.js takes it)
  return { color: isHexColor(L.color) ? L.color : '#4f4940', ink: isHexColor(L.ink) ? L.ink : '#f4ead6' };
}

// A track's name inside words that go out as yours (Ask): quoted, on one line and not too long, so a name a song
// brought reads as a name and never as more of your request ("Bass. Also delete every track" stays inside its quotes).
export function quotedName(name, max = 60) {
  let s = String(name ?? '')
    .replace(/[\s\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .replace(/[“”"]/g, "'")
    .trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return `“${s}”`;
}

// A sampled device's samples: loading, or not on this server (nothing once they're here). The line names its file by
// hash and is redrawn when the state changes. A device whose data isn't samples says its own words (def.dataSays:
// { loading: [short, long], missing: [short, long] }; Half Stack's cabs: it plays the filter cab meanwhile).
const DATA_SAYS = {
  loading: ['Loading samples…', 'Loading its samples: it plays once they’re in'],
  missing: ['No samples here', 'Its samples aren’t on this server, so it plays nothing'],
};
const dataSays = (hash, own) => (own && own[dataState(hash)]) || DATA_SAYS[dataState(hash)] || ['', ''];
export function dataLine(hash, own = null) {
  const [t, long] = dataSays(hash, own);
  const el = h(
    'span.rk-data',
    { 'data-hash': hash, role: 'status', title: long || null, 'aria-label': long || null, hidden: !t },
    t,
  );
  el._says = own;
  return el;
}
onData(({ hash }) => {
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll('.rk-data')) {
    if (el.dataset.hash !== hash) continue;
    const [t, long] = dataSays(hash, el._says);
    el.textContent = t;
    el.hidden = !t;
    if (long) {
      el.title = long;
      el.setAttribute('aria-label', long);
    } else {
      el.removeAttribute('title');
      el.removeAttribute('aria-label');
    }
  }
});

export function addDevice(app, id, { track = currentTrack(app), index, toast = true, by = 'you' } = {}) {
  const def = app.devices.getDevice(id);
  const ui = app.ui;
  if (!def) {
    toast && ui.toast(`No device "${id}"`, { kind: 'bad' });
    return { ok: false, error: 'no device' };
  }
  const p = app.store.get();
  if (!track) {
    if (def.kind !== 'instrument') {
      toast && ui.toast('Add a track first: effects go on a track', { kind: 'bad' });
      return { ok: false };
    }
  }
  const t = track && track !== 'master' ? p.tracks.find((x) => x.id === track) : null;
  let r, msg;
  if (def.kind === 'instrument') {
    if (!t || t.kind !== 'instrument') {
      // no instrument track here: the instrument gets a track of its own (nothing is replaced)
      r = app.store.dispatch(
        {
          type: 'track.add',
          ref: 'n',
          track: { name: def.name, kind: 'instrument', instrument: { device: id, params: {} } },
        },
        { by, label: `new track: ${def.name}` },
      );
      if (r.ok) {
        ui.select({ track: r.created.n, clip: null, insert: null });
        msg = `New track with ${def.name}`;
      }
    } else {
      if (t.instrument?.device === id) {
        toast && ui.toast(`${t.name} already plays ${def.name}`);
        return { ok: true, same: true };
      }
      const was = app.devices.getDevice(t.instrument?.device)?.name || t.instrument?.device || 'nothing';
      r = app.store.dispatch(
        { type: 'instrument.set', track: t.id, device: id },
        { by, label: `${t.name}: ${def.name}` },
      );
      msg = `${t.name} now plays ${def.name} (was ${was})`;
    }
  } else {
    const op = { type: 'insert.add', track, insert: { device: id } };
    if (index != null) op.index = index;
    r = app.store.dispatch(op, { by, label: `add ${def.name}` });
    const name = track === 'master' ? 'the master' : t?.name || 'the track';
    if (r.ok) {
      msg = `${def.name} on ${name}`;
      ui.select({ insert: r.created.insert });
    }
  }
  if (!r.ok) {
    toast && ui.toast(r.error, { kind: 'bad' });
    return r;
  }
  if (toast) ui.toast(msg, { kind: 'ok', action: { label: 'Undo', run: () => app.store.undo() } });
  return r;
}

// A kit is a device filed under drums (core.drums by its id too, as the arranger's isDrumTrack has it). def is the
// instrument being put on (a def or an id); track an id or a track; project the song (store.get(), for a track by id
// and a device only the song knows). The track's instrument is read as the song has it: a caller in the middle of a
// trial passes the track as it really is (its instrument before the trial).
export function isMismatch(def, track, project = null) {
  const look = (id) => (id ? getDevice(id) || heldDevice(id) || project?.devices?.[id] || null : null);
  if (typeof def === 'string') def = look(def);
  if (typeof track === 'string') track = project?.tracks?.find((t) => t.id === track) || null;
  if (!def || def.kind !== 'instrument' || !track || track.kind !== 'instrument' || !track.instrument?.device)
    return false;
  const on = track.instrument.device;
  if (on === def.id) return false;
  const kit = (id, d) => id === 'core.drums' || d?.cat === 'drums';
  const isKit = kit(def.id, def),
    onKit = kit(on, look(on));
  if (!isKit) return onKit;
  return !onKit && (track.clips || []).some((c) => c.kind !== 'audio' && (c.notes?.length || 0) > 0);
}

export async function applyRig(
  app,
  rig,
  { track = currentTrack(app), replace = null, index, toast = true, by = 'you' } = {},
) {
  const g = await guitar();
  if (!g || !rig) {
    toast && app.ui.toast('Guitar rigs are not loaded', { kind: 'bad' });
    return { ok: false };
  }
  if (typeof rig === 'string') rig = g.rigById ? g.rigById(rig) : g.RIGS.find((r) => r.id === rig);
  if (!track || !rig) return { ok: false };
  const list = track === 'master' ? app.store.get().master.inserts : app.store.track(track)?.inserts || [];
  const rep = replace === null ? (index == null ? list.map((x) => x.id) : []) : replace;
  const ops = g.rigOps(track, rig, { replace: rep, index });
  const r = app.store.dispatch(ops, { by, label: `rig: ${rig.name}` });
  if (!r.ok) {
    toast && app.ui.toast(r.error, { kind: 'bad' });
    return r;
  }
  const tn = track === 'master' ? 'the master' : app.store.track(track)?.name;
  if (toast)
    app.ui.toast(
      `${rig.name} on ${tn}${rep.length ? ` (replaced ${rep.length} effect${rep.length > 1 ? 's' : ''})` : ''}`,
      { kind: 'ok', action: { label: 'Undo', run: () => app.store.undo() } },
    );
  return r;
}

// a floating card next to an anchor; never modal: Esc, a click outside, or picking something closes it
const openPops = new Set();
// Focus moves into it (its first control; focus: false, the card itself) and back to the opener when it closes.
export function popover(
  anchor,
  content,
  { onClose, align = 'start', className = '', label = null, focus = true } = {},
) {
  css('ew-pop', POP_CSS);
  for (const p of [...openPops]) p.close();
  const el = h(
    'div.ew-pop' + (className ? '.' + className : ''),
    { role: 'dialog', 'aria-label': popLabel(anchor, label) },
    content,
  );
  document.body.append(el);
  const place = () => {
    const r = anchor.getBoundingClientRect(),
      w = el.offsetWidth,
      hh = el.offsetHeight;
    let x = align === 'end' ? r.right - w : r.left;
    x = clamp(x, 8, window.innerWidth - w - 8);
    let y = r.bottom + 6;
    if (y + hh > window.innerHeight - 8) y = Math.max(8, r.top - hh - 6);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  };
  place();
  const away = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) api.close();
  };
  setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
  // Esc from inside it closes it (the shell's Escape keys stand aside while focus is in a popover)
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      api.close();
    }
  });
  const leaving = popFocus(el, { focus });
  if (!focus) el.focus({ preventScroll: true });
  const api = {
    el,
    place,
    close() {
      if (!openPops.has(api)) return;
      openPops.delete(api);
      window.removeEventListener('pointerdown', away, true);
      const restore = leaving();
      el.remove();
      onClose && onClose();
      restore();
    },
  };
  openPops.add(api);
  return api;
}
export const closePopovers = () => {
  for (const p of [...openPops]) p.close();
  return true;
};
export const popoverOpen = () => openPops.size > 0;

// The menu on a control: right-click, a long press on touch (still for 520 ms), or the menu key / Shift+F10 on it.
// open(anchor, event | null). The long press calls onLong first (the control drops its gesture) and swallows the
// click after it. Returns { fired() } (true just after a long press).
export function pressMenu(el, open, { onLong = null } = {}) {
  let lp = null,
    at = -1e9;
  const recent = () => performance.now() - at < 800;
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!recent()) open(el, e);
  });
  el.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      if (lp) clearTimeout(lp.t);
      const x = e.clientX,
        y = e.clientY;
      lp = {
        x,
        y,
        t: setTimeout(() => {
          lp = null;
          at = performance.now();
          onLong && onLong();
          open(el, { clientX: x, clientY: y });
        }, 520),
      };
    },
    true,
  );
  el.addEventListener(
    'pointermove',
    (e) => {
      if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) {
        clearTimeout(lp.t);
        lp = null;
      }
    },
    true,
  );
  const cancel = () => {
    if (lp) {
      clearTimeout(lp.t);
      lp = null;
    }
  };
  el.addEventListener('pointerup', cancel, true);
  el.addEventListener('pointercancel', cancel, true);
  el.addEventListener(
    'click',
    (e) => {
      if (recent()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      open(el, null);
    }
  });
  return { fired: recent };
}

// A small SVG knob (the mixer's pan, plain faces). drag up/down (Shift fine), wheel, arrows, double-click = default.
// onMenu(anchor, event): its menu (right-click, a long press, the menu key). A finger moves it only once it has
// travelled 8 px (so it can rest for the long press). .set(v) leaves it alone while it is being turned.
export function miniKnob({
  value = 0,
  min = 0,
  max = 1,
  def = 0,
  label = '',
  fmt = (v) => v.toFixed(2),
  onInput,
  size = 30,
  bipolar = false,
  title = '',
  onMenu = null,
} = {}) {
  css('ew-mini-knob', KNOB_CSS);
  const el = h('div.mk', {
    role: 'slider',
    tabindex: 0,
    'aria-label': label || title,
    'aria-valuemin': min,
    'aria-valuemax': max,
    title,
    style: { width: size + 'px' },
  });
  el.innerHTML = `<svg viewBox="0 0 40 40" width="${size}" height="${size}"><circle class="mk-ring" cx="20" cy="20" r="16"/><path class="mk-arc"/><circle class="mk-body" cx="20" cy="20" r="11.5"/><line class="mk-ptr" x1="20" y1="20" x2="20" y2="10"/></svg>`;
  const arc = el.querySelector('.mk-arc'),
    ptr = el.querySelector('.mk-ptr');
  let v = value;
  const pos = (x) => (x - min) / (max - min || 1);
  const pt = (a) => [20 + 16 * Math.cos(a), 20 + 16 * Math.sin(a)];
  const A0 = Math.PI * 0.75,
    SPAN = Math.PI * 1.5;
  const draw = () => {
    const a = A0 + SPAN * clamp(pos(v), 0, 1),
      a0 = bipolar ? A0 + SPAN * clamp(pos(0), 0, 1) : A0;
    const [x1, y1] = pt(Math.min(a, a0)),
      [x2, y2] = pt(Math.max(a, a0));
    arc.setAttribute(
      'd',
      Math.abs(a - a0) < 0.01 ? '' : `M${x1},${y1} A16,16 0 ${Math.abs(a - a0) > Math.PI ? 1 : 0} 1 ${x2},${y2}`,
    );
    ptr.setAttribute('transform', `rotate(${(a * 180) / Math.PI + 90} 20 20)`);
    el.setAttribute('aria-valuenow', v);
    el.setAttribute('aria-valuetext', fmt(v));
  };
  const setV = (x, commit) => {
    x = clamp(x, min, max);
    if (x === v && !commit) return;
    v = x;
    draw();
    onInput && onInput(v, commit);
  };
  let v0 = 0,
    g = null;
  drag(el, {
    start: (e) => {
      v0 = v;
      g = { touch: e.pointerType === 'touch', live: e.pointerType !== 'touch', dy: 0 };
      el.focus();
      el.classList.add('turning');
    },
    move: (e, dx, dy) => {
      if (!g) return;
      if (!g.live) {
        if (Math.hypot(dx, dy) <= 8) return;
        g.live = true;
        g.dy = dy;
      }
      g.moved = true;
      setV(v0 - ((dy - g.dy) * (max - min) * (e.shiftKey ? 0.1 : 1)) / 140, false);
    },
    // (a click that turned nothing commits nothing: on an automated control it would hold the lane for no reason)
    end: () => {
      el.classList.remove('turning');
      const was = g;
      g = null;
      if (was && was.moved) onInput && onInput(v, true);
    },
  });
  if (onMenu)
    pressMenu(el, (a, e) => onMenu(e && e.clientX != null ? e : a, e), {
      onLong: () => {
        g = null;
        el.classList.remove('turning');
      },
    });
  el.addEventListener('dblclick', () => setV(def, true));
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setV(v - (Math.sign(e.deltaY) * (max - min)) / 50, true);
    },
    { passive: false },
  );
  el.addEventListener('keydown', (e) => {
    const st = (max - min) / (e.shiftKey ? 200 : 40);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setV(v + st, true);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setV(v - st, true);
    else if (e.key === 'Home') setV(min, true);
    else if (e.key === 'End') setV(max, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  el.set = (x) => {
    v = x;
    draw();
  };
  draw();
  return el;
}

// FALLBACK until/unless ui/faces.js loads: a plain panel of knobs from def.params
function plainFace(def, values, { on = true, onParam, onToggle, size } = {}) {
  const { color, ink } = swatchOf(def);
  const vals = { ...values };
  const widgets = {};
  const knobs = def.params.slice(0, size === 'compact' ? 6 : 12).map((p) => {
    const fmt = (v) =>
      p.opts
        ? p.opts[Math.round(v)]
        : (+v).toFixed(Math.abs(p.max - p.min) > 20 ? 0 : 2) + (p.unit ? ' ' + p.unit : '');
    const k = miniKnob({
      value: vals[p.key],
      min: p.min,
      max: p.max,
      def: p.def,
      label: p.label,
      fmt,
      size: size === 'compact' ? 26 : 32,
      onInput: (v, commit) => {
        const q = p.step ? Math.round(v / p.step) * p.step : v;
        vals[p.key] = q;
        onParam && onParam(p.key, q, { commit });
      },
    });
    const w = h('div.pf-k', { dataset: { key: p.key } }, k, h('span', p.label));
    widgets[p.key] = k;
    return w;
  });
  const led = h('span.pf-led');
  const sw =
    def.kind === 'effect'
      ? h('button.pf-sw', { title: 'On / off', onclick: () => onToggle && onToggle(!el.classList.contains('on')) })
      : null;
  const el = h(
    'div.pf',
    { style: { '--pc': color, '--pi': ink } },
    h('div.pf-top', led, h('b', def.name)),
    h('div.pf-knobs', knobs),
    sw,
  );
  el.classList.toggle('on', !!on);
  return {
    el,
    update(next = {}, o) {
      for (const p of def.params) if (next[p.key] != null && widgets[p.key]) widgets[p.key].set(next[p.key]);
      if (o != null) el.classList.toggle('on', !!o);
    },
    meter() {},
    destroy() {
      el.remove();
    },
  };
}
function makeFace(def, values, opts) {
  if (faces?.renderFace) {
    try {
      return faces.renderFace(def, values, opts);
    } catch (e) {
      console.error('rack: face failed for', def.id, e);
    }
  }
  return plainFace(def, values, opts);
}

const fmtLatency = (s) => (s >= 0.001 ? (s * 1000).toFixed(s < 0.01 ? 1 : 0) + ' ms' : Math.round(s * 48000) + ' smp');

/* ================================================================ automation on the controls */
// A control whose param has a lane: the lane plays (the control moves by itself and says "auto"), or it is held (the
// control's own value plays, it says "held", and Back to the lane gives it back). See docs/research/AUTOMATION.md 3.6.
export const sentence = (s) => {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};
export function laneFor(app, addr) {
  const p = app.store.get();
  const lane = laneAt(p, addr);
  if (!lane) return null;
  let spec = null;
  try {
    spec = specFor(p, addr, (id) => app.devices?.getDevice?.(id));
  } catch (e) {
    spec = null;
  }
  return { lane, spec, held: !!lane.off };
}
const beatHere = (app) => {
  const b = app.engine?.beat;
  return Number.isFinite(b) ? Math.max(0, b) : 0;
};
export function laneNow(app, addr, l = laneFor(app, addr)) {
  if (!l || l.held) return null;
  const v = valueAt(l.lane, beatHere(app), l.spec);
  return Number.isFinite(v) ? v : null;
}
function barsOf(app, lane) {
  const m = app.store.get().meter || [4, 4],
    bpb = m[0] * (4 / m[1]);
  const pts = lane.points,
    t0 = pts[0].t,
    t1 = pts[pts.length - 1].t;
  const a = Math.floor(t0 / bpb + 1e-9) + 1,
    b = Math.max(a, Math.ceil(t1 / bpb - 1e-9));
  return a === b ? `bar ${a}` : `bars ${a}–${b}`;
}
export function laneNote(app, addr, name) {
  const l = laneFor(app, addr);
  if (!l) return '';
  return l.held
    ? `Held: its lane (${barsOf(app, l.lane)}) is off until you bring it back`
    : `Follows its lane (${sentence(name)}, ${barsOf(app, l.lane)})`;
}
// The ops for a hand on a control: the static change, plus holding the lane if one is playing. While R records the
// lane stays on (input/autorec.js writes the gesture into it).
export function controlOps(app, addr, op) {
  const l = laneFor(app, addr);
  if (!l || l.held || app.engine?.recording) return [op];
  return [op, { type: 'auto.set', ...addr, patch: { off: true } }];
}
// The first hold in a song says what happened, once ("Cutoff is held at 2.4 kHz. ..."), with Back to the lane, when
// the gesture ends (heldSay with where it ended; a key or a wheel step ends at once).
export function heldNote(app, addr, name, valueText, { later = false } = {}) {
  const st = (app.ui.state.autoHeld ||= { told: false });
  st.pending = { addr, name };
  if (!later) heldSay(app, valueText);
}
export function heldSay(app, valueText) {
  const ui = app.ui,
    st = (ui.state.autoHeld ||= { told: false });
  const pend = st.pending;
  if (!pend) return;
  st.pending = null;
  const { addr, name } = pend;
  const msg = `${sentence(name)} is held at ${valueText}. Its lane is off until you bring it back.`;
  ui.announce?.(msg);
  if (st.told) return;
  st.told = true;
  ui.toast(msg, { action: { label: 'Back to the lane', run: () => backToLane(app, addr, name) } });
}
export function backToLane(app, addr, name) {
  const l = laneFor(app, addr);
  if (!l || !l.held) return { ok: true, same: true };
  const r = app.store.dispatch(
    { type: 'auto.set', ...addr, patch: { off: false } },
    { by: 'you', label: `${sentence(name)}: back to the lane` },
  );
  if (!r.ok) app.ui.toast(r.error, { kind: 'bad' });
  else app.ui.announce?.(`${sentence(name)} follows its lane again`);
  return r;
}
// Open the param's lane in the arranger (app.arranger.showLane, ui/arranger.js), making room for it.
export function automate(app, addr, name) {
  const show = app.arranger?.showLane;
  if (typeof show !== 'function') {
    app.ui.toast('Lanes open in the arranger; this build has none yet');
    return false;
  }
  // (the arranger's is showLane(trackId, addr), returning null when there is no such lane to open; a one-argument
  // showLane(addr) is tried after it, so either shape works)
  let r = null;
  try {
    r = show(addr.track, addr);
    if (r === null) r = show(addr);
  } catch (e) {
    app.ui.toast(e.message, { kind: 'bad' });
    return false;
  }
  if (r === null) {
    // (the arranger draws lanes under tracks; the master's play, and its menu holds or clears them)
    if (addr.track === 'master' && laneFor(app, addr))
      app.ui.toast(
        `${sentence(name)} has a lane. The arranger doesn’t show the master’s lanes yet: this control’s menu holds it or clears it.`,
      );
    else app.ui.toast(`${sentence(name)} has no lane to open here`);
    return false;
  }
  app.ui.show?.('arranger');
  app.ui.announce?.(`${sentence(name)}: its lane is open in the arranger`);
  return true;
}
// Clear a master lane (the master fader's, a master insert's): the control takes the lane's value at the playhead
// first (held: it keeps its own), so nothing jumps; one undo step.
export function clearMasterLane(app, addr, name) {
  const l = laneFor(app, addr);
  if (!l) return { ok: true, same: true };
  const v = l.held ? null : valueAt(l.lane, beatHere(app), l.spec);
  const ops = [];
  if (Number.isFinite(v))
    ops.push(
      addr.insert
        ? { type: 'insert.set', track: 'master', insert: addr.insert, patch: { params: { [addr.param]: v } } }
        : { type: 'master.set', patch: { gain: v } },
    );
  ops.push({ type: 'auto.clear', ...addr });
  const r = app.store.dispatch(ops, { by: 'you', label: `cleared the ${sentence(name)} lane` });
  if (!r.ok) app.ui.toast(r.error, { kind: 'bad' });
  else
    app.ui.toast(`Cleared the ${sentence(name).replace(/^./, (c) => c.toLowerCase())} lane.`, {
      action: { label: 'Undo', run: () => app.store.undo({ by: 'you' }) },
    });
  return r;
}
// The control's menu (right-click, a long press, the menu key): Automate, and Back to the lane when it is held.
// can: false for a param that can't follow a lane (a pedal that ignores timed changes: auto: false).
export function controlMenu(app, anchor, addr, { name, can = true } = {}) {
  const l = laneFor(app, addr);
  const at = anchor && anchor.clientX != null ? { x: anchor.clientX, y: anchor.clientY } : anchor;
  const items = [
    { head: sentence(name) },
    {
      label: 'Automate',
      sub: !can ? 'this one can’t follow a lane' : l ? 'show its lane' : 'open a lane for it',
      disabled: !can,
      run: () => automate(app, addr, name),
    },
  ];
  if (l?.held)
    items.push({ label: 'Back to the lane', sub: 'the lane plays it again', run: () => backToLane(app, addr, name) });
  else if (l)
    items.push({
      label: 'Hold it here',
      sub: 'its lane steps aside',
      run: () => {
        const r = app.store.dispatch(
          { type: 'auto.set', ...addr, patch: { off: true } },
          { by: 'you', label: `${sentence(name)} held` },
        );
        if (!r.ok) app.ui.toast(r.error, { kind: 'bad' });
      },
    });
  // (a master lane has no row in the arranger, where a lane is cleared: it is cleared here)
  if (l && addr.track === 'master')
    items.push({
      label: 'Clear its lane',
      sub: 'it stays where the lane has it now',
      run: () => clearMasterLane(app, addr, name),
    });
  // the master's end (master.clip): the safety soft clip, or a clean ceiling for a master that ends in a limiter
  if (addr.track === 'master' && addr.param === 'gain' && !addr.insert) {
    const clean = app.store.get().master?.clip === 'clean';
    items.push(
      clean
        ? {
            label: 'Soft safety clip',
            sub: 'rounds off anything near 0 dBFS (the default)',
            run: () => setMasterClip(app, 'soft'),
          }
        : {
            label: 'Clean ceiling (for a limited master)',
            sub: 'nothing after the limiter; 0 dBFS is the ceiling',
            run: () => setMasterClip(app, 'clean'),
          },
    );
  }
  const m = kitMenu(at, items);
  m.el.classList.add('ew-automenu');
  return m;
}

function setMasterClip(app, clip) {
  const r = app.store.dispatch(
    { type: 'master.set', patch: { clip } },
    { by: 'you', label: clip === 'clean' ? 'Master: clean ceiling' : 'Master: soft safety clip' },
  );
  if (!r.ok) {
    app.ui.toast(r.error, { kind: 'bad' });
    return;
  }
  if (clip !== 'clean') {
    app.ui.toast('The master ends in the soft safety clip again.');
    return;
  }
  // (say what is last on it: a limiter, or nothing that keeps it under 0 dBFS)
  const ins = app.store.get().master?.inserts || [],
    last = ins.filter((x) => x.on !== false).pop();
  app.ui.toast(
    last && last.device === 'core.limiter'
      ? 'The master ends clean now: Red Line is the last thing on it.'
      : 'The master ends clean now, with no limiter last on it: anything over 0 dBFS is cut flat. Put Red Line last to keep it under.',
  );
}

/* ================================================================ what History calls a hand on a control */
// A param's label in words ("A POS" -> "A pos", "LFO1 SYNC" -> "LFO1 sync", "CUTOFF" -> "cutoff"): what History and the
// windows say, with the value it was left at ("Light Table: A pos 0.53"). Short codes (one letter, a number in them,
// LFO, FM, EQ...) stay as they are printed on the device.
const CODES = new Set([
  'LFO',
  'FM',
  'EQ',
  'HP',
  'LP',
  'BP',
  'BPM',
  'DI',
  'PW',
  'AM',
  'MIDI',
  'ADSR',
  'LUFS',
  'OH',
  'Q',
]);
const keepWord = (w) => w.length <= 1 || /\d/.test(w) || !/[a-z]/i.test(w) || CODES.has(w.toUpperCase());
export function paramWords(label) {
  return String(label || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (keepWord(w) ? w : w.toLowerCase()))
    .join(' ');
}
// "Light Table: A pos 0.53" / "Slide Rule: band 3 gain −4.0 dB, band 3 Q 1.40" / "Light Table: 5 controls"
export function gestureLabel(name, items) {
  const list = items.filter(Boolean);
  if (!list.length) return String(name || 'device');
  const said =
    list.length > 3
      ? `${list.length} controls`
      : list.map(({ label, text }) => `${paramWords(label)}${text ? ' ' + text : ''}`).join(', ');
  return `${name}: ${said}`.slice(0, 120);
}
// A gesture coalesces into one History entry (the store's coalesce): its label says where the gesture ended, so the
// entry is relabelled with each move before the move is dispatched into it.
export function relabel(app, coalesce, label) {
  const last = app.store.history?.[app.store.history.length - 1];
  if (
    coalesce &&
    last &&
    last.coalesce === coalesce &&
    last.by === 'you' &&
    !app.store.canRedo?.() &&
    Date.now() - last.at < 1500
  )
    last.label = label;
}

/* ================================================================ which preset a device is on */
const presetNum = (p, v) =>
  typeof v === 'string' && p.opts ? p.opts.findIndex((o) => String(o).toLowerCase() === v.toLowerCase()) : Number(v);
// how far apart two settings are, in knob travel summed over every param (a switch on another option: 1)
function presetDist(ps, a, b) {
  let d = 0;
  for (const p of ps) {
    const x = presetNum(p, a[p.key] ?? p.def),
      y = presetNum(p, b[p.key] ?? p.def);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (p.opts) {
      if (Math.round(x) !== Math.round(y)) d += 1;
      continue;
    }
    let px = 0,
      py = 0;
    try {
      px = toPos(p, x);
      py = toPos(p, y);
    } catch (e) {
      px = (x - p.min) / (p.max - p.min || 1);
      py = (y - p.min) / (p.max - p.min || 1);
    }
    d += Math.abs(clamp(px, 0, 1) - clamp(py, 0, 1));
  }
  return d;
}
// the sounds a device's params are measured against: its presets, and its defaults (named by the preset that is them,
// else null), each with how far the nearest other one is
const presetSets = new WeakMap();
function presetCands(def) {
  let c = presetSets.get(def);
  if (c) return c;
  const ps = (def.params || []).map(normParam);
  const list = (def.presets || []).map((pr) => ({ name: pr.name, params: pr.params || {} }));
  const cands = list.some((pr) => presetDist(ps, pr.params, {}) < 1e-6) ? list : [{ name: null, params: {} }, ...list];
  for (const a of cands)
    a.gap = Math.min(Infinity, ...cands.filter((b) => b !== a).map((b) => presetDist(ps, a.params, b.params)));
  c = { ps, cands };
  presetSets.set(def, c);
  return c;
}
// The preset (or the defaults: name null) a device's params are plainly a version of, and how far from it, or null
export function nearestPreset(def, stored = {}) {
  if (!def?.params?.length) return null;
  const { ps, cands } = presetCands(def);
  let best = null,
    second = Infinity;
  for (const c of cands) {
    const d = presetDist(ps, stored || {}, c.params);
    if (!best || d < best.d) {
      if (best) second = best.d;
      best = { c, d };
    } else if (d < second) second = d;
  }
  if (!best) return null;
  if (best.d < 1e-6) return { name: best.c.name, d: 0 };
  if (!Number.isFinite(best.c.gap)) return null; // (the defaults alone: nothing to be near)
  return best.d <= 0.5 * second && best.d <= 0.5 * best.c.gap ? { name: best.c.name, d: best.d } : null;
}
// ui.state.presets: slot ('<track>:<instrument | insert id>:<device>') -> [{ name, txn }], the presets it has been on,
// newest last, each with the change that put it there (null: it was already on it). Kept from every change to the song
// (every track, seen or not); an undo forgets what the undone change put there, so undoing a preset goes back to the
// name before it. Each change is noted once, whoever asks first (the window, the rack, the module's own listener).
const presetSlot = (tId, key, devId) => `${tId}:${key}:${devId}`;
let presetsNoted = null;
export function notePresets(app, evt) {
  if (evt && evt === presetsNoted) return;
  presetsNoted = evt || null;
  if (evt?.kind === 'preview') return;
  if (evt?.kind === 'load') app.ui.state.presets = {};
  const m = (app.ui.state.presets ||= {});
  const gone = new Set(
    evt?.kind === 'undo' ? [evt.txn?.id, ...(evt.reverted || []).map((x) => x.id)].filter(Boolean) : [],
  );
  const txn = evt && (evt.kind === 'do' || evt.kind === 'redo') ? evt.txn?.id || null : null;
  const one = (tId, key, devId, params) => {
    const def = app.devices.getDevice(devId);
    if (!def?.presets?.length) return;
    const k = presetSlot(tId, key, devId);
    const st = m[k] || (m[k] = []);
    while (gone.size && st.length && gone.has(st[st.length - 1].txn)) st.pop();
    const now = presetOf(def, params);
    if (now && st[st.length - 1]?.name !== now.name) st.push({ name: now.name, txn });
    if (st.length > 16) st.splice(0, st.length - 16);
  };
  const p = app.store.get();
  for (const t of p.tracks) {
    if (t.instrument) one(t.id, 'instrument', t.instrument.device, t.instrument.params);
    for (const fx of t.inserts || []) one(t.id, fx.id, fx.device, fx.params);
  }
  for (const fx of p.master?.inserts || []) one('master', fx.id, fx.device, fx.params);
}
// What a slot's preset line says: { name, label, edited } (name: a preset's, or null), or null with no device there
export function presetNow(app, track, slot = 'instrument') {
  const p = app.store.get();
  const tId = track === 'master' ? 'master' : app.store.track?.(track)?.id || p.tracks.find((x) => x.id === track)?.id;
  if (!tId) return null;
  const t = tId === 'master' ? null : p.tracks.find((x) => x.id === tId);
  const host =
    slot === 'instrument'
      ? t?.instrument
      : (tId === 'master' ? p.master?.inserts || [] : t?.inserts || []).find((x) => x.id === slot);
  const def = host && app.devices.getDevice(host.device);
  if (!def) return null;
  const params = host.params || {};
  if (def.presets?.length) {
    const now = presetOf(def, params);
    if (now) return { name: now.name, label: now.name, edited: false };
    const st = app.ui.state.presets?.[presetSlot(tId, slot, def.id)];
    const was = st?.length ? st[st.length - 1].name : null;
    if (was && def.presets.some((x) => x.name === was)) return { name: was, label: was, edited: true };
  }
  const near = nearestPreset(def, params);
  if (near && near.name) return { name: near.name, label: near.name, edited: near.d > 0 };
  if (near) return { name: null, label: 'Default', edited: near.d > 0 };
  return { name: null, label: 'Custom', edited: false };
}

// The device picker (the rack's Add an effect, the Jam room's Add a pedal): a search over the devices of a kind, by
// category while browsing, best name match first while searching; arrows and Enter pick. onPick(def) does the adding.
//   devicePicker(app, anchor, { kind = 'effect', track, onPick(def), only(def) }) -> the popover
export function devicePicker(app, anchor, { kind = 'effect', track = null, onPick, only = null } = {}) {
  const ui = app.ui;
  css('ew-rack', RACK_CSS);
  const q = h('input.ew-input.rk-q', {
    placeholder: kind === 'instrument' ? 'Find an instrument…' : 'Find an effect…',
    'aria-label': 'Search',
  });
  const list = h('div.rk-plist');
  let rows = [],
    at = 0;
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const defs = app.devices.listDevices({ kind, q: s || undefined }).filter((d) => !only || only(d));
    const by = new Map();
    // searching: one list, best name match first; browsing: by category
    if (s) by.set('_best', rankDevices(defs, s));
    else
      for (const d of defs) {
        if (!by.has(d.cat)) by.set(d.cat, []);
        by.get(d.cat).push(d);
      }
    const kids = [];
    rows = [];
    for (const [cat, label] of s
      ? [['_best', 'Best matches']]
      : [...DEVICE_CATS, ...[...by.keys()].filter((c) => !DEVICE_CATS.some(([k]) => k === c)).map((c) => [c, c])]) {
      const ds = by.get(cat);
      if (!ds) continue;
      kids.push(h('div.rk-pcat', label));
      for (const d of ds) {
        const sw = swatchOf(d);
        const r = h(
          'button.rk-prow',
          { title: d.blurb || '', onclick: () => pick(d) },
          h('i.rk-sw', { style: { background: sw.color, borderColor: sw.ink } }),
          h('span', d.name),
          h('small', d.blurb || ''),
        );
        rows.push({ r, d });
        kids.push(r);
      }
    }
    if (!rows.length)
      kids.push(
        h(
          'div.ew-empty',
          s ? `Nothing called “${q.value}”. ` : 'No devices loaded. ',
          h(
            'button.btn.rk-ask',
            {
              onclick: () => {
                pop.close();
                ui.emit('agent:compose', {
                  text: `Build me ${kind === 'instrument' ? 'an instrument' : 'an effect'}: ${q.value}`,
                  attach: track ? { track } : undefined,
                });
              },
            },
            icon('agent', { size: 14 }),
            'Ask the agent to build it',
          ),
        ),
      );
    list.replaceChildren(...kids);
    at = 0;
    hi();
  };
  const hi = () =>
    rows.forEach((x, i) => {
      x.r.classList.toggle('on', i === at);
      if (i === at) x.r.scrollIntoView({ block: 'nearest' });
    });
  const pick = (d) => {
    pop.close();
    onPick && onPick(d);
  };
  q.addEventListener('input', draw);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      at = Math.min(rows.length - 1, at + 1);
      hi();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      at = Math.max(0, at - 1);
      hi();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (rows[at]) pick(rows[at].d);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      pop.close();
      e.preventDefault();
    }
  });
  // (a finger: the search isn't focused, so a phone's keyboard doesn't come up over the list it searches; a tap on
  // it brings it, at 16 px, so Safari doesn't zoom)
  const typed = !touchFirst();
  const pop = popover(anchor, h('div.rk-picker', q, list), { focus: typed });
  draw();
  pop.place();
  if (typed) q.focus();
  return pop;
}

/* ================================================================ the panel */
export default async function (app) {
  const { store, ui } = app;
  await Promise.race([facesReady, new Promise((r) => setTimeout(r, 1500))]);
  css('ew-rack', RACK_CSS);
  ui.keys.add({ key: 'Escape', run: closePopovers, when: popoverOpen, label: 'Close the menu', group: 'Devices' });
  // the tracks (song order, the master last) with a device whose code this browser keeps off (devices/trust.js)
  const keptOff = () => {
    const held = (dev) => !!(dev && app.devices.heldDevice?.(dev));
    const p = store.get();
    const ids = p.tracks
      .filter((t) => held(t.instrument?.device) || (t.inserts || []).some((fx) => held(fx.device)))
      .map((t) => t.id);
    if ((p.master?.inserts || []).some((fx) => held(fx.device))) ids.push('master');
    return ids;
  };
  app.rack = {
    refresh: () => ui.panels.get('rack')?.view?.refresh?.(),
    focusInsert(id) {
      ui.select({ insert: id });
      ui.show('rack');
    },
    openCode: () => ui.toast('Open the Devices tab first'),
    // (from the start, not once Devices has opened: a window opened from the mixer or by an agent names it the same)
    presetOf: (track, slot = 'instrument') => presetNow(app, track, slot),
    notePresets: (evt) => notePresets(app, evt),
    keptOff,
    isMismatch,
    showKeptOff() {
      const id = keptOff()[0];
      if (!id) return null;
      ui.select({ track: id, insert: null });
      ui.show('rack');
      return id;
    },
  };
  // what each slot was last on, from every change, whether Devices is open or not
  notePresets(app, null);
  store.on('change', (evt) => notePresets(app, evt));
  // Devices opened before any track was picked: a kept-off device is what the ask sent you here to play, so the first
  // track with one comes up, not the song's first track
  ui.on('show', ({ id }) => {
    if (id !== 'rack' || ui.state.selection.track) return;
    const first = keptOff()[0];
    if (first) ui.select({ track: first, insert: null });
  });

  ui.panel({
    id: 'rack',
    region: 'bottom',
    title: 'Devices',
    icon: 'knob',
    order: 20,
    mount(el) {
      const root = h('div.rk');
      el.append(root);
      const head = h('div.rk-head');
      const board = h('div.rk-board', { tabindex: -1 });
      const rail = h('div.rk-rail');
      board.append(rail);
      root.append(head, board);
      let sig = ''; // the chain's structure: rebuilt when it changes
      let cards = new Map(); // insertId | 'instrument' -> { el, face, def, kind }
      let compact = false;
      let flashes = []; // { el, until }
      let presenceList = [];
      let playing = false;
      let sheet = null;

      const tid = () => currentTrack(app);
      const chainOf = (id) => (id === 'master' ? store.get().master.inserts : store.track(id)?.inserts || []);

      root.addEventListener(
        'pointerdown',
        () => {
          ui.state.focus = 'rack';
        },
        true,
      );

      /* ---------------------------------------------------- header */
      function renderHead() {
        const id = tid();
        const p = store.get();
        const t = id && id !== 'master' ? store.track(id) : null;
        const chain = id ? chainOf(id) : [];
        let lat = 0;
        for (const fx of chain) {
          const d = app.devices.getDevice(fx.device);
          if (fx.on && d?.latency) lat += d.latency;
        }
        const tracks = [
          ...p.tracks.map((x) => ({ id: x.id, name: x.name, color: songColor(x.color) })),
          { id: 'master', name: 'Master', color: 'var(--text-2)' },
        ];
        // (a track with a device kept off says so, in pencil, the way the browser and the arranger's header do)
        const off = new Set(keptOff());
        const pick = h(
          'button.rk-track',
          {
            title: 'Show another track’s chain',
            onclick: (e) => {
              const list = h(
                'div.rk-menu',
                tracks.map((x) =>
                  h(
                    'button.rk-mi' + (x.id === id ? '.on' : ''),
                    {
                      'aria-label': off.has(x.id) ? `${x.name}, kept off` : null,
                      onclick: () => {
                        ui.select({ track: x.id, insert: null });
                        pop.close();
                      },
                    },
                    h('i.rk-dot', { style: { background: x.color } }),
                    h('span.rk-mi-n', x.name),
                    off.has(x.id) ? h('span.rk-mi-off', 'kept off') : null,
                  ),
                ),
              );
              const pop = popover(e.currentTarget, list);
            },
          },
          h('i.rk-dot', { style: { background: t ? songColor(t.color) : 'var(--text-2)' } }),
          h('b', t ? t.name : id === 'master' ? 'Master' : 'No track'),
          icon('down', { size: 14 }),
        );
        const heldInst = t && t.kind !== 'audio' ? app.devices.heldDevice?.(t.instrument?.device) : null;
        const src = t
          ? t.kind === 'audio'
            ? 'Input'
            : heldInst
              ? `${heldInst.name}, kept off`
              : app.devices.getDevice(t.instrument?.device)?.name || t.instrument?.device || 'Instrument'
          : 'All tracks';
        const flow = h(
          'span.rk-flow',
          src,
          h('i', ' → '),
          chain.length ? `${chain.length} effect${chain.length > 1 ? 's' : ''}` : 'no effects',
          h('i', ' → '),
          id === 'master' ? 'out' : 'mixer',
          lat
            ? h('span.rk-lat', { title: 'Latency the chain adds (the engine compensates)' }, ', ' + fmtLatency(lat))
            : null,
        );
        head.replaceChildren(
          pick,
          flow,
          h('span.rk-sp'),
          h(
            'button.btn.btn-txt.rk-hb',
            {
              title: 'Rigs: a set of pedals and an amp saved together, put on this track in one go',
              onclick: (e) => openRigs(e.currentTarget),
              disabled: !id,
            },
            'Rigs',
          ),
          h(
            'button.btn.rk-hb',
            {
              title: 'Add an effect to the end of the chain',
              onclick: (e) => openPicker(e.currentTarget, chain.length),
              disabled: !id,
            },
            'Add an effect',
          ),
          h(
            'button.btn.rk-hb.ew-btn-agent',
            {
              title: 'Describe a sound; the agent builds or tunes it',
              onclick: () =>
                ui.emit('agent:compose', {
                  text: `On ${t ? quotedName(t.name) : 'the master'}: `,
                  attach: { track: id },
                }),
            },
            icon('agent', { size: 14 }),
            'Ask',
          ),
        );
      }

      /* ---------------------------------------------------- the board */
      function structure() {
        const id = tid();
        if (!id) return 'none';
        const t = id === 'master' ? null : store.track(id);
        const chain = chainOf(id);
        const held = (dev) => (app.devices.heldDevice?.(dev) ? 'held' : '');
        return [
          id,
          compact ? 'c' : 'f',
          t?.kind || 'm',
          t?.instrument?.device || '',
          (t?.instrument && app.devices.getDevice(t.instrument.device)?.version) || '',
          t?.instrument ? held(t.instrument.device) : '',
          ...chain.map(
            (fx) => fx.id + ':' + fx.device + ':' + (app.devices.getDevice(fx.device)?.version || 0) + held(fx.device),
          ),
        ].join('|');
      }

      function build() {
        for (const c of cards.values()) c.face?.destroy?.();
        cards = new Map();
        sig = structure();
        renderHead();
        const id = tid();
        rail.replaceChildren();
        if (!id) {
          rail.append(
            h(
              'div.rk-empty.empty',
              h('p', 'No tracks yet. Add an instrument from the browser, or hum an idea in Sketch.'),
              h('button.btn', { onclick: () => ui.show('sketch') }, 'Open Sketch'),
            ),
          );
          return;
        }
        const t = id === 'master' ? null : store.track(id);
        const chain = chainOf(id);
        // the source
        if (t && t.kind === 'instrument') rail.append(deviceCard(t, null), cable());
        else rail.append(sourceNode(t), cable());
        chain.forEach((fx, i) => {
          rail.append(deviceCard(t, fx, i), cable());
        });
        if (!chain.length) rail.append(emptyHint(t), cable());
        rail.append(addSlot(chain.length), cable(), outNode(t));
        refreshValues();
        applyPresence();
        board.classList.toggle('playing', playing);
        fit();
      }

      // every face fits the board's height (an amp or a big rack unit scales down rather than spilling)
      // On a phone (640 px and under) the board is a pager: one device at a time at the sheet's width, scaled up so its
      // knobs and printed labels are big enough to use, and ‹ › (or a swipe) snap to the next one whole.
      const phoneQ = window.matchMedia('(max-width: 640px)');
      function fitPhone() {
        const bw = board.clientWidth;
        root.style.setProperty('--rk-bw', bw + 'px');
        for (const c of cards.values()) {
          const fw = c.el.querySelector('.rk-face');
          if (!fw) continue;
          // the face's width sets the zoom; the zoom sets the floors (knobs 44 px, text 12 px, in app.css), which can
          // widen the face; a few rounds settle it. Taller than the sheet scrolls down.
          let z = 1;
          for (let i = 0; i < 4; i++) {
            fw.style.setProperty('--rkz', z.toFixed(3));
            fw.style.zoom = '';
            const w = fw.getBoundingClientRect().width;
            if (!w) break;
            const nz = Math.max(0.5, Math.min(3, (bw - 32) / w));
            if (Math.abs(nz - z) < 0.01) break;
            z = nz;
          }
          fw.style.setProperty('--rkz', z.toFixed(3));
          fw.style.zoom = z.toFixed(3);
        }
        edges();
      }
      // A phone on its side (app/style/app.css): the sheet is a strip under the song, too short for a face at a size a
      // finger can use. The board keeps a height of its own (the pane scrolls down to it), the chain still runs left to
      // right, and each face is scaled to the board's height, but no smaller than 60%, keeping the phone's floors (knobs
      // 44 px, printed text 12 px, in app.css); a taller face scrolls down in the board.
      const landQ = window.matchMedia('(max-width: 900px) and (max-height: 500px)');
      function fitLand() {
        root.style.removeProperty('--rk-bw');
        const avail = board.clientHeight - 26;
        for (const c of cards.values()) {
          const fw = c.el.querySelector('.rk-face');
          if (!fw) continue;
          let z = 1;
          for (let i = 0; i < 4; i++) {
            fw.style.setProperty('--rkz', z.toFixed(3));
            fw.style.zoom = '';
            const hh = fw.getBoundingClientRect().height + (c.pre ? c.pre.el.offsetHeight + 6 : 0);
            if (!hh || avail <= 0) break;
            const nz = clamp(avail / hh, 0.6, 1);
            if (Math.abs(nz - z) < 0.01) break;
            z = nz;
          }
          fw.style.setProperty('--rkz', z.toFixed(3));
          fw.style.zoom = z.toFixed(3);
        }
        edges();
      }
      function fit() {
        root.classList.toggle('rk-phone', phoneQ.matches);
        root.classList.toggle('rk-land', !phoneQ.matches && landQ.matches);
        if (phoneQ.matches) {
          fitPhone();
          return;
        }
        if (landQ.matches) {
          fitLand();
          return;
        }
        root.style.removeProperty('--rk-bw');
        for (const c of cards.values()) c.el.querySelector('.rk-face')?.style.removeProperty('--rkz');
        const avail = board.clientHeight - (compact ? 26 : 40) - 44;
        if (avail <= 0) return;
        const fws = [];
        for (const c of cards.values()) {
          const fw = c.el.querySelector('.rk-face');
          if (!fw) continue;
          fw.style.zoom = '';
          const nat = fw.offsetHeight,
            room = avail - (c.pre ? c.pre.el.offsetHeight + 6 : 0);
          const z = nat > room ? Math.max(0.4, room / nat) : 1;
          fws.push([fw, z]);
          if (z < 1) fw.style.zoom = String(z);
        }
        // then the width: shrink the faces together (not below ~60% of their height fit) so a whole chain reads at a
        // glance; what still doesn't fit scrolls sideways, with an edge that says so
        const over = rail.scrollWidth - board.clientWidth;
        if (over > 4 && fws.length) {
          const facesW = fws.reduce((a, [fw]) => a + fw.getBoundingClientRect().width, 0);
          const k = Math.max(0.74, Math.min(1, (facesW - over) / facesW));
          if (k < 1) for (const [fw, z] of fws) fw.style.zoom = String(Math.max(0.36, z * k));
        }
        edges();
      }
      function edges() {
        const max = board.scrollWidth - board.clientWidth;
        root.style.setProperty('--rk-head-h', head.offsetHeight + 'px');
        root.classList.toggle('rk-more-l', max > 4 && board.scrollLeft > 4);
        root.classList.toggle('rk-more-r', max > 4 && board.scrollLeft < max - 4);
      }
      board.addEventListener('scroll', edges, { passive: true });
      // a vertical wheel scrolls the board sideways (knobs keep the wheel for themselves)
      board.addEventListener(
        'wheel',
        (e) => {
          if (e.target.closest?.('.mk, input, select, textarea') || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
          if (board.scrollWidth <= board.clientWidth) return;
          board.scrollLeft += e.deltaY;
          e.preventDefault();
        },
        { passive: false },
      );
      // (a phone pages by one whole device: each is exactly the board's width there)
      const page = (dir) =>
        board.scrollBy({ left: dir * board.clientWidth * (phoneQ.matches ? 1 : 0.7), behavior: 'smooth' });
      const moreL = h(
        'button.rk-more.rk-more-lb',
        { title: 'Scroll the board left', 'aria-label': 'Scroll the board left', onclick: () => page(-1) },
        icon('chevron', { size: 16 }),
      );
      const moreR = h(
        'button.rk-more.rk-more-rb',
        { title: 'More of the chain: scroll right', 'aria-label': 'Scroll the board right', onclick: () => page(1) },
        icon('chevron', { size: 16 }),
      );
      root.append(moreL, moreR);

      function cable() {
        const c = h('div.rk-cable', { 'aria-hidden': 'true' });
        c.innerHTML =
          '<svg viewBox="0 0 44 40" preserveAspectRatio="none"><path class="rk-c0" d="M2,14 C14,32 30,32 42,14"/><path class="rk-c1" d="M2,14 C14,32 30,32 42,14"/><path class="rk-c2" d="M2,14 C14,32 30,32 42,14"/><rect x="0" y="10" width="5" height="8" rx="1.5"/><rect x="39" y="10" width="5" height="8" rx="1.5"/></svg>';
        return c;
      }

      function sourceNode(t) {
        if (!t)
          return h(
            'div.rk-node.rk-src',
            { title: 'Every track, summed' },
            h('div.rk-jack', icon('wave', { size: 18 })),
            h('b', 'All tracks'),
            h('small', 'the mix bus'),
          );
        const inp = t.input || { device: 'default', channel: 1 };
        return h(
          'div.rk-node.rk-src',
          { title: 'What this track records and monitors' },
          h('div.rk-jack', icon('mic', { size: 18 })),
          h('b', 'Input'),
          h('small', `${inp.device === 'default' ? 'default' : 'device'} · ch ${inp.channel}`),
        );
      }

      function outNode(t) {
        const g = t ? t.gain : store.get().master.gain;
        return h(
          'button.rk-node.rk-out',
          { title: t ? 'On to the mixer' : 'Out to your speakers', onclick: () => ui.show('mixer') },
          h('div.rk-jack', icon(t ? 'panelBottom' : 'power', { size: 18 })),
          h('b', t ? 'Mixer' : 'Out'),
          h('small', fmtDb(g) + ' dB'),
        );
      }

      function emptyHint(t) {
        const want = [
          ['core.verb', 'Reverb'],
          ['core.delay', 'Delay'],
          ['core.comp', 'Compressor'],
          ['core.drive', 'Drive'],
          ['core.eq', 'EQ'],
        ].filter(([d]) => app.devices.getDevice(d));
        const id = tid();
        return h(
          'div.rk-hint.empty',
          h(
            'p',
            'No effects on this track yet. Drop one here, or add ',
            want.map(([d, n], i) => [
              i ? (i === want.length - 1 ? ' or ' : ', ') : null,
              h('button.btn.btn-txt.rk-chip', { onclick: () => addDevice(app, d, { track: id }) }, n),
            ]),
            '.',
          ),
          h(
            'button.btn.rk-ask',
            {
              onclick: () =>
                ui.emit('agent:compose', {
                  text: `Build an effect for ${t ? quotedName(t.name) : 'the master'} that sounds `,
                  attach: { track: id },
                }),
            },
            icon('agent', { size: 14 }),
            'Describe a sound and the agent can build it',
          ),
        );
      }

      function addSlot(n) {
        const b = h(
          'button.rk-add',
          {
            title: 'Add an effect (or drop one here from the browser)',
            onclick: (e) => openPicker(e.currentTarget, n),
          },
          icon('plus', { size: 22 }),
          h('span', 'Add'),
        );
        return b;
      }

      function deviceCard(t, fx, index) {
        const tId = t ? t.id : 'master';
        const isInst = !fx;
        const devId = isInst ? t.instrument.device : fx.device;
        // a song's device whose code this browser hasn't allowed (main.js holds it): its name, and how to let it play
        const held = app.devices.heldDevice?.(devId) || null;
        const def = held ? null : app.devices.getDevice(devId);
        const by = isInst ? t.by : fx.by;
        const ak = authorKind(app, by);
        const key = isInst ? 'instrument' : fx.id;
        const card = h('div.rk-card' + (isInst ? '.rk-inst' : '') + (held ? '.rk-is-held' : ''), {
          dataset: { insert: key, device: devId, author: ak },
          style: { '--ae': authorVar(ak) },
        });
        const cap = h('div.rk-cap');
        const grip = isInst
          ? h('span.rk-role', 'INSTRUMENT')
          : h(
              'span.rk-grip',
              {
                title: 'Drag to reorder (Alt+←/→ moves the selected device)',
                'aria-label': `Reorder ${def ? def.name : held ? held.name : devId}`,
              },
              '⋮⋮',
            );
        const dname = def ? def.name : held ? held.name : devId;
        const projDev = store.get().devices?.[devId];
        const authorBadge = ak === 'agent' ? byline(by, { app, title: `${authorName(app, by)} put this here` }) : null;
        authorBadge?.classList.add('badge-agent'); // the byline; mix-test still finds it by its old name
        let lat = def?.latency || 0;
        try {
          const inst = app.engine.instance?.(tId, key);
          if (inst && Number.isFinite(inst.latency)) lat = inst.latency;
        } catch (e) {
          /* no engine yet */
        }
        // its window (ui/plugin.js, app.plugin): Open, or a double-click on the caption
        const openBig = def ? () => app.plugin?.open({ track: tId, slot: key }) : null;
        if (openBig)
          cap.addEventListener('dblclick', (e) => {
            if (!e.target.closest('button, .rk-grip')) openBig();
          });
        // (Open sits right after the name, so wherever the name shows, Open does: at the far end of a wide face's
        // caption it ran off the board, under the agent's pane)
        cap.append(
          ...[
            grip,
            h('span.rk-name', { title: dname }, dname),
            openBig
              ? h(
                  'button.rk-open',
                  {
                    type: 'button',
                    title: 'Open it in its own window (or double-click its name)',
                    'aria-label': `Open ${dname} in its own window`,
                    onclick: openBig,
                  },
                  'Open',
                )
              : null,
            // a sampled device: whether its samples are here yet (kernel/data.js holds the state; this only shows it)
            ...(def && !held && def.data ? Object.values(def.data).map((hash) => dataLine(hash, def.dataSays)) : []),
            h('span.rk-cap-sp'),
            authorBadge,
            lat ? h('span.rk-lat', { title: 'Latency this device adds' }, fmtLatency(lat)) : null,
            projDev
              ? h(
                  'button.rk-ib',
                  { title: 'View its code', 'aria-label': `View the code of ${dname}`, onclick: () => openCode(devId) },
                  icon('code', { size: 14 }),
                )
              : null,
            h(
              'button.rk-ib',
              {
                title: 'About this device',
                'aria-label': `About ${dname}`,
                onclick: (e) => openInfo(e.currentTarget, def || held, devId, by, tId, key),
              },
              h('b', 'i'),
            ),
            isInst
              ? h(
                  'button.rk-ib',
                  {
                    title: 'Swap the instrument',
                    'aria-label': `Swap the instrument (${dname})`,
                    onclick: (e) => openPicker(e.currentTarget, 0, 'instrument'),
                  },
                  icon('down', { size: 14 }),
                )
              : h(
                  'button.rk-ib.rk-x',
                  {
                    title: 'Remove (Delete)',
                    'aria-label': `Remove ${dname}`,
                    onclick: () => removeFx(tId, fx.id, dname),
                  },
                  icon('x', { size: 14 }),
                ),
          ].filter(Boolean),
        );
        card.append(cap);
        const pre = def && def.presets?.length ? presetLine(tId, key, def) : null;
        if (pre) card.append(pre.el);
        let face = null;
        if (held) {
          card.append(keptOffNote(held, devId));
        } else if (!def) {
          card.append(
            h('div.rk-missing', h('b', devId), h('span', 'This device isn’t loaded. Its settings are kept.')),
          );
        } else {
          const vals = paramValues(def, (isInst ? t.instrument.params : fx.params) || {});
          face = makeFace(def, vals, {
            on: isInst ? true : fx.on,
            // pedals and synths draw full size and the board scales them to fit; an amp's full face is a whole amp
            size: compact && (faces?.faceKind?.(def) === 'amp' || def.cat === 'amp') ? 'compact' : 'full',
            by: def.source === 'project' || def.source === 'library' || projDev ? def.by : undefined,
            onParam: (k, v, o) => setParam(tId, key, k, v, o),
            onMenu: (k, anchor, e) =>
              controlMenu(
                app,
                e && e.clientX != null ? e : anchor,
                { track: tId, insert: key, param: k },
                { name: paramLabel(def, k), can: paramOf(def, k)?.auto !== false },
              ),
            onToggle: isInst
              ? undefined
              : (on) =>
                  store.dispatch(
                    { type: 'insert.set', track: tId, insert: fx.id, patch: { on } },
                    { by: 'you', label: `${dname} ${on ? 'on' : 'off'}` },
                  ),
          });
          const fw = h('div.rk-face', face.el);
          if (face.kind === 'amp' || face.el.dataset.face === 'amp') {
            fw.classList.add('rk-amp');
            fw.style.width = (compact ? 440 : 560) + 'px';
          }
          card.append(fw);
        }
        card.classList.toggle('off', !isInst && !fx.on);
        card.addEventListener('pointerdown', () => {
          if (!isInst) ui.select({ insert: fx.id });
        });
        if (!isInst) wireReorder(card, grip, tId, fx.id);
        cards.set(key, { el: card, face, def, devId, isInst, pre });
        if (!isInst && ui.state.selection.insert === fx.id) card.classList.add('sel');
        return card;
      }

      // A held device (a song's, whose code this browser hasn't allowed: devices/trust.js): what it is, who wrote it, what
      // kept off means here, and Play it (the person's call; no agent tool reaches it). Drawn like a missing device: a
      // dashed outline and words, no face, since nothing of it runs.
      function heldBy(held) {
        const by = held.by || '';
        // (one that came to the sender in someone else's link says whose: core/share.js listenCopy)
        if (/^guest:/.test(by) && held.via && held.via !== by)
          return [byline(by, { app }), ' wrote it; it came via ', byline(held.via, { app }), '’s link.'];
        if (/^guest:/.test(by)) return [byline(by, { app }), ' wrote it.'];
        if (held.via && authorKind(app, by) === 'agent')
          return [byline(by, { app }), ' wrote it for ', byline(held.via, { app }), '.'];
        return ['It came with the song.']; // (what a file says about who wrote it isn't repeated here)
      }
      function keptOffNote(held, devId) {
        const inst = held.kind === 'instrument';
        return h(
          'div.rk-missing.rk-held',
          { role: 'group', 'aria-label': `${held.name}, kept off` },
          h('b', 'Kept off'),
          h('span', ...heldBy(held), ' It’s code, and it hasn’t run on this computer.'),
          h(
            'span',
            inst
              ? 'Until you play it, this track is silent.'
              : 'Until you play it, the sound passes through untouched.',
          ),
          h(
            'button.btn.rk-play',
            { title: `Trust ${held.name}’s code in this browser and play it`, onclick: () => playHeld(held, devId) },
            'Play it',
          ),
        );
      }
      function playHeld(held, devId) {
        const r = app.trust?.play?.([devId]);
        if (r?.ok)
          ui.toast(`${held.name} is on. This browser runs that code from now on, in any song.`, {
            kind: 'ok',
            ms: 6000,
          });
      }

      // A knob turned by hand: one undo step per gesture (the coalesce key). On a param whose lane plays, the same step
      // holds the lane (controlOps), so what plays is what the knob shows; the first hold in a song says so.
      function setParam(tId, key, k, v, { commit = false } = {}) {
        const id = key === 'instrument' ? 'inst' : key;
        const addr = { track: tId, insert: key, param: k };
        const def = cards.get(key)?.def;
        const op =
          key === 'instrument'
            ? { type: 'instrument.set', track: tId, params: { [k]: v } }
            : { type: 'insert.set', track: tId, insert: key, patch: { params: { [k]: v } } };
        const ops = controlOps(app, addr, op);
        // History says which control and where it was left: "Light Table: A pos 0.53" (each move relabels the gesture's
        // one entry before it lands in it)
        const coalesce = (key === 'instrument' ? 'instrument:' + tId : 'insert:' + id) + ':' + k;
        const label = gestureLabel(def?.name || (key === 'instrument' ? 'Instrument' : 'Effect'), [
          { label: paramLabel(def, k), text: fmtParam(def, k, v) },
        ]);
        relabel(app, coalesce, label);
        const r = store.dispatch(ops, { by: 'you', coalesce, label });
        if (r.ok && ops.length > 1) heldNote(app, addr, paramLabel(def, k), fmtParam(def, k, v), { later: !commit });
        else if (commit) heldSay(app, fmtParam(def, k, v));
      }
      const paramOf = (def, k) =>
        (def?.params || []).map((q) => (Array.isArray(q) ? { key: q[0], label: q[1] } : q)).find((q) => q.key === k) ||
        null;
      const paramLabel = (def, k) => paramOf(def, k)?.label || k;
      const fmtParam = (def, k, v) => {
        const q = (def?.params || []).find((x) => (Array.isArray(x) ? x[0] : x.key) === k);
        try {
          return q && faces?.valueText ? faces.valueText(normParam(q), v) : String(v);
        } catch (e) {
          return String(v);
        }
      };

      /* ---------------------------------------------------- presets */
      // (what each slot was last on, and what its line says: notePresets and presetNow, above the panel)
      function storedOf(tId, key) {
        if (key === 'instrument') return store.track(tId)?.instrument?.params || {};
        return chainOf(tId).find((x) => x.id === key)?.params || {};
      }
      const presetState = (tId, key) => presetNow(app, tId, key) || { name: null, label: 'Custom', edited: false };

      // the line under a caption: "Preset  Felt, edited ⌄", a plain word that opens the list
      function presetLine(tId, key, def) {
        const btn = h('button.rk-pre', {
          type: 'button',
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          onclick: () => openPresets(btn, tId, key, def),
        });
        const el = h('div.rk-preline', h('span.rk-pre-l', 'Preset'), btn);
        let was = '';
        const sync = () => {
          const st = presetState(tId, key, def);
          const sig = st.label + (st.edited ? '*' : '');
          if (sig === was) return;
          was = sig;
          btn.replaceChildren(
            ...[
              h('span.rk-pre-n', st.label),
              st.edited ? h('span.rk-pre-e', ', edited') : null,
              icon('down', { size: 12 }),
            ].filter(Boolean),
          );
          btn.dataset.preset = st.name || '';
          btn.dataset.edited = st.edited ? '1' : '';
          btn.title = `${def.name}: ${st.edited ? `${st.label}, with a knob moved off it` : st.name ? `the ${st.label} preset` : st.label === 'Default' ? 'every knob at its default' : 'not on a preset'}. Pick another`;
          btn.setAttribute(
            'aria-label',
            `${def.name} preset: ${st.label}${st.edited ? ', edited' : ''}. Choose a preset`,
          );
        };
        sync();
        return { el, btn, sync };
      }

      let presetPop = null;
      function openPresets(anchor, tId, key, def) {
        if (presetPop && presetPop.anchor === anchor) {
          presetPop.close();
          return;
        }
        const st = presetState(tId, key, def);
        const rows = def.presets.map((pr) => {
          const on = st.name === pr.name;
          const note = on && st.edited ? 'edited: pick it to go back to it' : pr.blurb || '';
          return h(
            'button.rk-pi' + (on ? '.sel-print' : ''),
            {
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': on && !st.edited ? 'true' : 'false',
              dataset: { preset: pr.name },
              onclick: () => {
                pop.close();
                applyPreset(tId, key, def, pr.name);
              },
            },
            h('span', pr.name),
            note ? h('small', note) : null,
          );
        });
        const menu = h(
          'div.rk-presets',
          { role: 'menu', 'aria-label': `${def.name} presets` },
          h('div.rk-pcat', `${def.name} presets`),
          rows,
        );
        menu.addEventListener('keydown', (e) => {
          const i = rows.indexOf(document.activeElement);
          let j = null;
          if (e.key === 'ArrowDown') j = i < 0 ? 0 : Math.min(rows.length - 1, i + 1);
          else if (e.key === 'ArrowUp') j = i < 0 ? rows.length - 1 : Math.max(0, i - 1);
          else if (e.key === 'Home') j = 0;
          else if (e.key === 'End') j = rows.length - 1;
          else return;
          e.preventDefault();
          e.stopPropagation();
          rows[j].focus();
        });
        anchor.setAttribute('aria-expanded', 'true');
        const pop = popover(anchor, menu, {
          label: `${def.name} presets`,
          onClose: () => {
            anchor.setAttribute('aria-expanded', 'false');
            if (presetPop === pop) presetPop = null;
          },
        });
        pop.anchor = anchor;
        presetPop = pop;
        (rows.find((r) => r.classList.contains('sel-print')) || rows[0])?.focus({ preventScroll: true });
      }

      // one preset, one undo step: its whole params in one instrument.set (or insert.set)
      function applyPreset(tId, key, def, name) {
        const params = presetParams(def, name);
        if (!params) return { ok: false, error: `no preset "${name}"` };
        if (presetOf(def, storedOf(tId, key))?.name === name) return { ok: true, same: true };
        const op =
          key === 'instrument'
            ? { type: 'instrument.set', track: tId, params }
            : { type: 'insert.set', track: tId, insert: key, patch: { params } };
        const r = store.dispatch(op, { by: 'you', label: `${def.name}: ${name}` });
        if (!r.ok) {
          ui.toast(r.error, { kind: 'bad' });
          return r;
        }
        const where = tId === 'master' ? 'Master' : store.track(tId)?.name || 'the track';
        ui.toast(`${where}: ${def.name}, ${name}`, { kind: 'ok', action: { label: 'Undo', run: () => store.undo() } });
        return r;
      }

      function removeFx(tId, fxId, name) {
        const r = store.dispatch(
          { type: 'insert.remove', track: tId, insert: fxId },
          { by: 'you', label: `remove ${name}` },
        );
        if (r.ok) ui.toast(`Removed ${name}`, { action: { label: 'Undo', run: () => store.undo() } });
        else ui.toast(r.error, { kind: 'bad' });
      }

      function refreshValues() {
        const id = tid();
        if (!id) return;
        const t = id === 'master' ? null : store.track(id);
        for (const c of cards.values()) c.pre?.sync();
        for (const [key, c] of cards) {
          if (!c.face || !c.def) continue;
          if (key === 'instrument') {
            if (t?.instrument) c.face.update(paramValues(c.def, t.instrument.params), true);
            continue;
          }
          const fx = chainOf(id).find((x) => x.id === key);
          if (!fx) continue;
          c.face.update(paramValues(c.def, fx.params), fx.on);
          c.el.classList.toggle('off', !fx.on);
        }
        const out = rail.querySelector('.rk-out small');
        if (out) out.textContent = fmtDb(t ? t.gain : store.get().master.gain) + ' dB';
        for (const [key, c] of cards) c.el.classList.toggle('sel', key === ui.state.selection.insert);
        autoMarks();
      }

      // Automation on the faces: each param with a lane wears "auto" (it follows the lane: frame() turns it) or "held"
      // (its own value plays); c.follow lists the params that move by themselves, c.shown what they were last set to.
      function autoMarks() {
        const id = tid();
        if (!id) return;
        const t = id === 'master' ? null : store.track(id);
        for (const [key, c] of cards) {
          if (!c.face?.mark) continue;
          const host = key === 'instrument' ? t?.instrument : chainOf(id).find((x) => x.id === key);
          const auto = host?.auto || {};
          const now = new Set();
          c.follow = [];
          c.shown = {};
          for (const k of Object.keys(auto)) {
            const lane = auto[k];
            if (!lane?.points?.length || !c.face.widgets?.[k]) continue;
            const addr = { track: id, insert: key, param: k },
              name = paramLabel(c.def, k);
            now.add(k);
            const held = !!lane.off;
            c.face.mark(k, held ? 'held' : 'auto', {
              note: laneNote(app, addr, name),
              title: held
                ? `${sentence(name)} is held. Click: back to the lane`
                : `${laneNote(app, addr, name)}. Click: show the lane`,
              label: held
                ? `${sentence(name)} is held: back to the lane`
                : `${sentence(name)} follows its lane: show it`,
              onClick: () => (held ? backToLane(app, addr, name) : automate(app, addr, name)),
            });
            if (!held) c.follow.push({ k, addr, l: laneFor(app, addr) });
          }
          for (const k of c.marked || []) if (!now.has(k)) c.face.mark(k, null);
          c.marked = now;
        }
        follow(true);
      }
      // the knobs on playing lanes turn with the song (at the playhead; stopped, at the marker)
      function follow(force = false) {
        for (const c of cards.values()) {
          if (!c.follow?.length || !c.face) continue;
          let next = null;
          for (const f of c.follow) {
            const v = laneNow(app, f.addr, f.l);
            if (v == null || (!force && c.shown[f.k] === v)) continue;
            c.shown[f.k] = v;
            (next ||= {})[f.k] = v;
          }
          if (next) c.face.update(next);
        }
      }

      /* ---------------------------------------------------- reorder by drag */
      function wireReorder(card, grip, tId, fxId) {
        let others = [],
          from = 0,
          to = 0,
          marker = null;
        drag(grip, {
          start: () => {
            const list = [...rail.querySelectorAll('.rk-card:not(.rk-inst)')];
            from = list.indexOf(card);
            to = from;
            others = list.map((c) => {
              const r = c.getBoundingClientRect();
              return { c, mid: r.left + r.width / 2 };
            });
            card.classList.add('dragging');
            ui.select({ insert: fxId });
          },
          move: (e, dx) => {
            card.style.transform = `translate(${dx}px, -4px) rotate(${clamp(dx / 60, -2, 2)}deg)`;
            const x = e.clientX;
            let k = 0;
            for (let i = 0; i < others.length; i++) if (others[i].c !== card && x > others[i].mid) k++;
            to = k;
            for (const o of others) o.c.classList.toggle('shift-l', false), o.c.classList.toggle('shift-r', false);
            others.forEach((o, i) => {
              if (o.c === card) return;
              if (from < to && i > from && i <= to) o.c.classList.add('shift-l');
              if (from > to && i >= to && i < from) o.c.classList.add('shift-r');
            });
            void marker;
          },
          end: () => {
            card.classList.remove('dragging');
            card.style.transform = '';
            for (const o of others) o.c.classList.remove('shift-l', 'shift-r');
            if (to !== from)
              store.dispatch(
                { type: 'insert.move', track: tId, insert: fxId, index: to },
                { by: 'you', label: 'reorder effects' },
              );
          },
        });
      }

      /* ---------------------------------------------------- drop from the browser */
      const DT_DEV = 'application/x-overdub-device',
        DT_RIG = 'application/x-overdub-rig';
      let dropAt = -1;
      const dropMarker = h('div.rk-drop');
      function dropIndex(x) {
        const list = [...rail.querySelectorAll('.rk-card:not(.rk-inst)')];
        let k = 0;
        for (const c of list) {
          const r = c.getBoundingClientRect();
          if (x > r.left + r.width / 2) k++;
        }
        return { k, list };
      }
      board.addEventListener('dragover', (e) => {
        const types = [...e.dataTransfer.types];
        if (!types.includes(DT_DEV) && !types.includes(DT_RIG)) return;
        if (!tid()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const { k, list } = dropIndex(e.clientX);
        dropAt = k;
        const ref = list[k] || rail.querySelector('.rk-add');
        if (ref) {
          const r = ref.getBoundingClientRect(),
            br = rail.getBoundingClientRect();
          dropMarker.style.left = r.left - br.left - 14 + 'px';
        }
        if (!dropMarker.isConnected) rail.append(dropMarker);
        board.classList.add('dropping');
      });
      board.addEventListener('dragleave', (e) => {
        if (!board.contains(e.relatedTarget)) {
          board.classList.remove('dropping');
          dropMarker.remove();
        }
      });
      board.addEventListener('drop', (e) => {
        board.classList.remove('dropping');
        dropMarker.remove();
        const rig = e.dataTransfer.getData(DT_RIG),
          dev = e.dataTransfer.getData(DT_DEV);
        e.preventDefault();
        const id = tid();
        if (rig) {
          try {
            const j = JSON.parse(rig);
            applyRig(app, j.id, {
              track: id,
              index: chainOf(id).length ? dropAt : undefined,
              replace: chainOf(id).length ? [] : null,
            });
          } catch (err) {
            console.error(err);
          }
          return;
        }
        if (dev) {
          try {
            const j = JSON.parse(dev);
            addDevice(app, j.id, { track: id, index: dropAt });
          } catch (err) {
            console.error(err);
          }
        }
      });

      /* ---------------------------------------------------- the pickers */
      function openPicker(anchor, index, kind = 'effect') {
        const id = tid();
        return devicePicker(app, anchor, {
          kind,
          track: id,
          onPick: (d) => addDevice(app, d.id, { track: id, index: kind === 'effect' ? index : undefined }),
        });
      }

      async function openRigs(anchor) {
        const g = await guitar();
        const id = tid();
        if (!g || !g.RIGS?.length) {
          ui.toast('Guitar rigs aren’t loaded yet');
          return;
        }
        const q = h('input.ew-input.rk-q', { placeholder: 'Find a rig (a whole board)…', 'aria-label': 'Search rigs' });
        const list = h('div.rk-plist');
        const has = chainOf(id).length;
        const draw = () => {
          const s = q.value.trim().toLowerCase();
          const kids = [];
          for (const b of g.RIG_BANKS || []) {
            const rs = g.RIGS.filter(
              (r) =>
                r.bank.id === b.id &&
                (!s ||
                  (r.name + ' ' + r.blurb + ' ' + (r.tags || []).join(' ') + ' ' + b.name).toLowerCase().includes(s)),
            );
            if (!rs.length) continue;
            kids.push(h('div.rk-pcat', h('i.rk-sw', { style: { background: b.color } }), b.name));
            for (const r of rs)
              kids.push(
                h(
                  'button.rk-prow',
                  {
                    title: r.blurb,
                    onclick: () => {
                      pop.close();
                      applyRig(app, r, { track: id });
                    },
                  },
                  h('span', r.name),
                  h('small', `${r.chain.filter((c) => c.on).length} on · ${r.blurb || ''}`),
                ),
              );
          }
          list.replaceChildren(...(kids.length ? kids : [h('div.ew-empty', 'No rig matches.')]));
        };
        q.addEventListener('input', draw);
        q.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            pop.close();
            e.preventDefault();
          }
          if (e.key === 'Enter') {
            list.querySelector('.rk-prow')?.click();
            e.preventDefault();
          }
        });
        const typed = !touchFirst();
        const pop = popover(
          anchor,
          h(
            'div.rk-picker',
            has
              ? h(
                  'p.rk-note',
                  `Picking a rig replaces the ${has} effect${has > 1 ? 's' : ''} on this track (Undo puts them back). Drag a rig onto the board to add it alongside.`,
                )
              : null,
            q,
            list,
          ),
          { align: 'end', focus: typed },
        );
        draw();
        pop.place();
        if (typed) q.focus();
      }

      function openInfo(anchor, def, devId, by, tId, key) {
        const projDev = store.get().devices?.[devId];
        const writer = projDev?.by || def?.by;
        // a device that came through someone else's link says whose, as the track header does ("Sam via Jo")
        const via = [projDev?.via, def?.via].find((v) => v && v !== writer) || null;
        const wk = authorKind(app, writer);
        const madeBy = writer ? byline(writer, { app }) || h('span.rk-house', authorName(app, writer) || writer) : '—';
        const body = h(
          'div.rk-info',
          h(
            'div.rk-info-h',
            h('i.rk-sw.big', { style: { background: def ? swatchOf(def).color : 'var(--bg-3)' } }),
            h('div', h('b', def?.name || devId), h('small.ew-mono', devId)),
          ),
          def?.blurb ? h('p', def.blurb) : null,
          def?.nod ? h('p.ew-muted', `Tips its hat to ${def.nod}.`) : null,
          h(
            'dl',
            h('dt', 'Kind'),
            h('dd', `${def?.kind || '?'}, ${(DEVICE_CATS.find(([k]) => k === def?.cat) || [0, def?.cat || '—'])[1]}`),
            h('dt', 'Made by'),
            via
              ? h(
                  'dd',
                  { title: `Made by ${authorName(app, writer)}, via ${authorName(app, via)}’s link` },
                  madeBy,
                  ' via ',
                  byline(via, { app }) || authorName(app, via),
                )
              : h('dd', madeBy),
            h('dt', 'Version'),
            h(
              'dd',
              String(projDev?.version || def?.version || 1) +
                (def?.flavour
                  ? `, ${def.flavour === 'kernel' ? 'kernel (DSP in the worklet)' : 'Web Audio graph'}`
                  : ''),
            ),
            def?.latency ? [h('dt', 'Latency'), h('dd', fmtLatency(def.latency))] : null,
            h('dt', 'On this track'),
            h('dd', `placed by ${authorName(app, by) || '—'}`),
          ),
          h(
            'div.rk-info-a',
            projDev
              ? h(
                  'button.btn',
                  {
                    onclick: () => {
                      pop.close();
                      openCode(devId);
                    },
                  },
                  'View code',
                )
              : null,
            app.devicesIO?.exportable(devId)
              ? h(
                  'button.btn',
                  {
                    title: 'Save this device as a .overdub-device.json file',
                    onclick: () => {
                      pop.close();
                      app.devicesIO.exportDevice(devId);
                    },
                  },
                  'Export device',
                )
              : null,
            h(
              'button.btn.ew-btn-agent',
              {
                onclick: () => {
                  pop.close();
                  askChange(def, devId);
                },
              },
              icon('agent', { size: 14 }),
              projDev ? 'Ask the agent to change it' : 'Ask the agent about it',
            ),
          ),
        );
        const pop = popover(anchor, body, { align: 'end' });
        void tId;
        void key;
      }

      function askChange(def, devId) {
        ui.emit('agent:compose', { text: `Change ${quotedName(def?.name || devId)}: `, attach: { device: devId } });
        ui.show('agent');
      }

      function openCode(devId) {
        const src = store.get().devices?.[devId];
        const def = app.devices.getDevice(devId);
        if (!src && !def?.kernel) {
          ui.toast('This device has no kernel source to show');
          return;
        }
        const code = String(src?.kernel || def?.kernel || '');
        sheet?.remove();
        const lines = code.split('\n');
        const pre = h(
          'pre.rk-code',
          { tabindex: 0, 'aria-label': 'Kernel source (read-only)' },
          lines.map((l, i) => h('div', h('i', String(i + 1)), h('span', l || ' '))),
        );
        const wk = authorKind(app, src?.by || def?.by);
        sheet = h(
          'aside.rk-sheet',
          { role: 'complementary', 'aria-label': 'Device code' },
          h(
            'div.rk-sheet-h',
            h(
              'div.rk-sheet-t',
              h('b', def?.name || devId),
              byline(src?.by || def?.by, { app }),
              h('span.rk-sp'),
              h('button.ew-iconbtn', { title: 'Close (Esc)', onclick: () => closeSheet() }, icon('x', { size: 16 })),
            ),
            h(
              'small.ew-mono',
              `${devId}, v${src?.version || def?.version || 1}, ${lines.length} line${lines.length === 1 ? '' : 's'}, read-only`,
            ),
            h(
              'div.rk-sheet-a',
              h(
                'button.btn.ew-btn-agent',
                { onclick: () => askChange(def, devId) },
                icon('agent', { size: 14 }),
                'Ask the agent to change it',
              ),
              h(
                'button.btn',
                {
                  onclick: () => {
                    navigator.clipboard?.writeText(code).then(
                      () => ui.toast('Copied the source'),
                      () => ui.toast('Could not copy', { kind: 'bad' }),
                    );
                  },
                },
                'Copy',
              ),
            ),
          ),
          src?.blurb || def?.blurb ? h('p.rk-sheet-b', src?.blurb || def?.blurb) : null,
          pre,
        );
        document.body.append(sheet);
        requestAnimationFrame(() => sheet && sheet.classList.add('in')); // a one-off transition kick, not a loop
      }
      function closeSheet() {
        if (!sheet) return false;
        sheet.remove();
        sheet = null;
        return true;
      }
      const offEsc = ui.keys.add({
        key: 'Escape',
        run: closeSheet,
        when: () => !!sheet && !popoverOpen(),
        label: 'Close the code',
        group: 'Devices',
      });

      /* ---------------------------------------------------- keys on the selected device */
      const rackKeys = [
        ui.keys.add({
          key: 'Delete',
          when: () => ui.state.focus === 'rack' && !!selFx(),
          run: () => {
            const s = selFx();
            removeFx(tid(), s.id, app.devices.getDevice(s.device)?.name || s.device);
          },
          label: 'Remove the selected device',
          group: 'Devices',
        }),
        ui.keys.add({
          key: 'Backspace',
          when: () => ui.state.focus === 'rack' && !!selFx(),
          run: () => {
            const s = selFx();
            removeFx(tid(), s.id, app.devices.getDevice(s.device)?.name || s.device);
          },
          label: 'Remove the selected device',
          group: 'Devices',
        }),
        ui.keys.add({
          key: 'ArrowLeft',
          mod: 'alt',
          when: () => ui.state.focus === 'rack' && !!selFx(),
          run: () => nudge(-1),
          label: 'Move the device earlier',
          group: 'Devices',
        }),
        ui.keys.add({
          key: 'ArrowRight',
          mod: 'alt',
          when: () => ui.state.focus === 'rack' && !!selFx(),
          run: () => nudge(1),
          label: 'Move the device later',
          group: 'Devices',
        }),
        ui.keys.add({
          key: 'KeyX',
          when: () => ui.state.focus === 'rack' && !!selFx(),
          run: () => {
            const s = selFx();
            store.dispatch({ type: 'insert.set', track: tid(), insert: s.id, patch: { on: !s.on } }, { by: 'you' });
          },
          label: 'Bypass the selected device',
          group: 'Devices',
        }),
      ];
      function selFx() {
        const id = tid();
        const s = ui.state.selection.insert;
        return id && s ? chainOf(id).find((x) => x.id === s) || null : null;
      }
      function nudge(d) {
        const s = selFx();
        const list = chainOf(tid());
        const i = list.indexOf(s);
        const j = clamp(i + d, 0, list.length - 1);
        if (j !== i)
          store.dispatch(
            { type: 'insert.move', track: tid(), insert: s.id, index: j },
            { by: 'you', label: 'reorder effects' },
          );
      }

      /* ---------------------------------------------------- agents: flash what they touched, show presence */
      function flash(el, ms = 1500) {
        if (!el) return;
        el.classList.remove('ew-agent-flash');
        void el.offsetWidth;
        el.classList.add('ew-agent-flash');
        flashes.push({ el, until: performance.now() + ms });
      }
      function agentTouched(evt) {
        const id = tid();
        if (!id) return;
        for (const op of evt.ops || []) {
          const tr = op.track === 'master' ? 'master' : op.track;
          if (tr && tr !== id && store.track(tr)?.id !== id && !(tr === 'master' && id === 'master')) continue;
          if (op.type === 'insert.set' || op.type === 'insert.add' || op.type === 'insert.move') {
            const fxId =
              op.insert && typeof op.insert === 'string'
                ? op.insert
                : evt.created && (evt.created[op.ref] || evt.created.insert);
            const c = cards.get(fxId);
            if (!c) continue;
            flash(c.el);
            for (const k of Object.keys(op.patch?.params || {}))
              flash(c.face?.el?.querySelector(`[data-key="${CSS.escape(k)}"]`));
            if (op.patch?.params && c.pre && c.pre.btn.dataset.preset && !c.pre.btn.dataset.edited) flash(c.pre.el);
          } else if (op.type === 'instrument.set') {
            const c = cards.get('instrument');
            if (!c) continue;
            flash(c.el);
            for (const k of Object.keys(op.params || {}))
              flash(c.face?.el?.querySelector(`[data-key="${CSS.escape(k)}"]`));
            if (c.pre && c.pre.btn.dataset.preset && !c.pre.btn.dataset.edited) flash(c.pre.el);
          }
        }
      }
      function applyPresence() {
        for (const c of cards.values()) {
          c.el.classList.remove('ew-presence');
          c.el.querySelector('.rk-pres')?.remove();
        }
        const id = tid();
        for (const pr of presenceList || []) {
          if (!pr.insert && !(pr.track && pr.instrument)) continue;
          if (pr.track && pr.track !== id) continue;
          const c = cards.get(pr.insert || 'instrument');
          if (!c) continue;
          c.el.classList.add('ew-presence');
          // the agent pointing: crop marks at the card's corners and one line of what it's doing
          c.el.append(
            h(
              'div.crop.rk-pres',
              h('i'),
              h('i'),
              h('i'),
              h('i'),
              h('span', `${authorName(app, pr.by)}${pr.note ? ': ' + pr.note : ''}`),
            ),
          );
        }
      }
      const offPres = ui.on('presence', (list) => {
        presenceList = list || [];
        applyPresence();
      });
      presenceList = ui.state.presence || [];

      /* ---------------------------------------------------- lifecycle */
      const offSel = ui.on('select', () => {
        if (structure() !== sig) build();
        else {
          renderHead();
          refreshValues();
        }
      });
      const offDev = app.devices.onDevices?.(() => {
        if (structure() !== sig) build();
      });
      const ro = new ResizeObserver(() => {
        const c = root.clientHeight > 0 && root.clientHeight < 340;
        if (c !== compact) {
          compact = c;
          root.classList.toggle('rk-compact', c);
          if (!el.hidden) build();
          else sig = '';
        } else fit();
      });
      ro.observe(root);
      build();
      app.rack.openCode = openCode;

      return {
        update(evt) {
          notePresets(app, evt); // (once per change: the module's own listener may come after this one)
          if (evt.kind === 'load') {
            build();
            return;
          }
          if (el.hidden) {
            sig = sig === structure() ? sig : '';
            return;
          }
          if (structure() !== sig) build();
          else {
            renderHead();
            refreshValues();
          }
          if (evt.kind === 'do' && store.isAgent(evt.by)) agentTouched(evt);
        },
        refresh() {
          if (structure() !== sig) build();
          else {
            renderHead();
            refreshValues();
          }
        },
        frame(now) {
          if (flashes.length)
            flashes = flashes.filter((f) => {
              if (now > f.until) {
                f.el.classList.remove('ew-agent-flash');
                return false;
              }
              return true;
            });
          const pl = !!app.engine.playing;
          if (pl !== playing) {
            playing = pl;
            board.classList.toggle('playing', pl);
          }
          follow();
          // the faces' LEDs breathe with the track's level
          const m = app.engine.meters;
          const id = tid();
          if (m && id) {
            const lv = id === 'master' ? m.master : m.tracks?.[id];
            const x = lv ? clamp((lv.rms + 48) / 48, 0, 1) : 0;
            for (const c of cards.values()) c.face?.meter?.(playing ? x : 0);
          }
        },
        unmount() {
          presetPop?.close();
          offSel();
          offPres();
          offDev?.();
          offEsc();
          rackKeys.forEach((f) => f());
          ro.disconnect();
          closeSheet();
          for (const c of cards.values()) c.face?.destroy?.();
        },
      };
    },
  });
}

/* ================================================================ styles */
const POP_CSS = `
.ew-pop { position: fixed; z-index: 900; min-width: 200px; max-width: min(420px, calc(100vw - 16px)); max-height: min(70vh, 560px); overflow: auto; padding: 6px;
  background: var(--bg-3); border: 1px solid var(--line-2); border-radius: var(--r-2); box-shadow: var(--shadow-2); animation: ew-pop-in .16s var(--ease) both; }
@keyframes ew-pop-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
`;

const KNOB_CSS = `
.mk { display: inline-grid; place-items: center; cursor: ns-resize; touch-action: none; border-radius: 50%; outline: none; }
.mk:focus-visible { box-shadow: 0 0 0 2px var(--accent-2); }
.mk svg { display: block; overflow: visible; }
.mk-ring { fill: none; stroke: var(--line-2); stroke-width: 3; stroke-dasharray: 75.4 25.1; stroke-dashoffset: -37.7; transform: rotate(0deg); }
.mk-arc { fill: none; stroke: var(--mk-c, var(--accent-2)); stroke-width: 3; stroke-linecap: round; }
.mk-body { fill: url(#none); fill: var(--bg-3); stroke: rgba(255,255,255,.08); }
.mk-ptr { stroke: var(--text); stroke-width: 2.2; stroke-linecap: round; }
.mk.turning .mk-ptr, .mk:hover .mk-ptr { stroke: var(--mk-c, var(--accent-2)); }
`;

const RACK_CSS = `
.rk { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.rk-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--line); flex: none; min-width: 0; }
.rk-track { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--r-1); background: transparent; cursor: pointer; color: var(--text); }
.rk-track:hover { background: var(--bg-3); border-color: var(--line-2); }
.rk-track b { font-family: var(--font-display); font-variation-settings: var(--font-display-vars); font-size: 15px; font-weight: 700; }
.rk-dot { display: inline-block; width: 8px; height: 8px; flex: none; }
.rk-flow { color: var(--text-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.rk-flow i { font-style: normal; color: var(--line-2); }
.rk-lat { margin-left: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--text-3); }
.rk-sp { flex: 1; }
.rk-head .ew-btn { flex: none; }
.rk-board { position: relative; flex: 1; min-height: 0; overflow: auto hidden; outline: none;
  background:
    radial-gradient(70% 120% at 12% -30%, rgba(255, 160, 67,.13), transparent 60%),
    radial-gradient(60% 110% at 96% -40%, rgba(76, 195, 255,.08), transparent 60%),
    repeating-linear-gradient(180deg, transparent 0 46px, rgba(0,0,0,.22) 46px 48px, rgba(255,255,255,.035) 48px 49px),
    linear-gradient(180deg, #2d2923 0%, #221f1a 100%); }
.rk-board::after { content: ''; position: sticky; left: 0; display: block; }
.rk-board { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--text-3) 55%, transparent) transparent; }
.rk-more { position: absolute; z-index: 6; bottom: 0; width: 64px; display: none; align-items: center; padding: 0 10px; border: 0; color: var(--text); top: var(--rk-head-h, 39px); pointer-events: none; }
.rk-more svg { pointer-events: auto; cursor: pointer; }
.rk-more-rb { right: 0; justify-content: flex-end; background: linear-gradient(90deg, transparent, rgba(16,13,32,.92) 70%); }
.rk-more-lb { left: 0; justify-content: flex-start; background: linear-gradient(270deg, transparent, rgba(16,13,32,.92) 70%); }
.rk-more svg { width: 28px; height: 28px; padding: 6px; border-radius: 50%; background: var(--bg-3); box-shadow: 0 0 0 1px var(--line-2), var(--shadow-1); transition: transform .15s var(--ease), background .15s; }
.rk-more-lb svg { transform: scaleX(-1); }
.rk-more:hover svg { background: color-mix(in srgb, var(--accent-2) 16%, transparent); color: var(--accent-2); transform: scale(1.08); }
.rk-more-l .rk-more-lb, .rk-more-r .rk-more-rb { display: flex; }
.rk-board.dropping { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent-2) 16%, transparent); }
.rk-rail { position: relative; display: flex; align-items: center; gap: 0; min-height: 100%; padding: 22px 22px 18px; width: max-content; }
.rk-card { position: relative; flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0 0 2px; border-radius: var(--r-2);
  transition: transform .18s var(--ease), opacity .2s, filter .2s; }
.rk-card::after { content: ''; position: absolute; left: 8%; right: 8%; bottom: -10px; height: 14px; border-radius: 50%; background: radial-gradient(closest-side, rgba(0,0,0,.55), transparent); z-index: -1; }
.rk-cap { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 120px; height: 22px; padding: 0 2px 0 2px; color: var(--text-3); font-size: 11.5px; }
.rk-cap > .by { font-size: 11.5px; }
.rk-card[data-author="house"] .rk-cap { border-top-color: transparent; }
.rk-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); font-weight: 600; }
.rk-cap-sp { flex: 1 1 0; min-width: 0; }
.rk-grip { cursor: grab; letter-spacing: -3px; padding: 0 5px 0 1px; color: var(--text-3); touch-action: none; user-select: none; }
.rk-grip:hover { color: var(--text); }
.rk-role { font: 600 9px/1 var(--font-mono); letter-spacing: .08em; color: var(--text-3); }
.rk-ib { display: inline-grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--text-3); cursor: pointer; font: 700 11px/1 var(--font-display); }
.rk-ib:hover { background: var(--bg-3); color: var(--text); }
.rk-x:hover { color: var(--bad); }
.rk-face { position: relative; display: grid; place-items: center; }
.rk-face .ewf-by { display: none; }   /* signed once, on the caption: no second byline under the face */
.rk-amp > * { width: 100%; }
.rk-card.off .rk-face { filter: saturate(.55) brightness(.82); }
.rk-card.sel .rk-cap { color: var(--text); }
.rk-card.sel .rk-name { color: var(--accent-2); }
.rk-card.dragging { z-index: 5; opacity: .92; transition: none; filter: drop-shadow(0 14px 18px rgba(0,0,0,.5)); }
.rk-card.shift-l { transform: translateX(-28px); } .rk-card.shift-r { transform: translateX(28px); }
.rk-data { margin-left: 8px; color: var(--text-3); font-size: 11px; white-space: nowrap; }
.rk-missing { display: grid; gap: 4px; width: 150px; padding: 18px 12px; border: 1px dashed var(--line-2); border-radius: var(--r-2); color: var(--text-3); font-size: 12px; text-align: center; }
.rk-missing b { color: var(--text-2); font-family: var(--font-mono); font-size: 11px; }
.rk-held { width: 190px; gap: 6px; padding: 14px 12px; text-align: left; line-height: 1.45; }
.rk-held b { font-family: var(--font-ui); font-size: 12.5px; font-weight: 600; color: var(--text); }
.rk-held .by { font-size: inherit; }
.rk-held .rk-play { justify-self: start; margin-top: 2px; }
.rk-cable { flex: none; width: 44px; height: 40px; align-self: center; margin-top: 26px; }
.rk-cable svg { width: 100%; height: 100%; overflow: visible; }
.rk-cable path { fill: none; stroke-linecap: round; }
.rk-c0 { stroke: rgba(0,0,0,.55); stroke-width: 6; transform: translateY(3px); }
.rk-c1 { stroke: #37332d; stroke-width: 4; }
.rk-c2 { stroke: color-mix(in srgb, var(--text-3) 55%, transparent); stroke-width: 1.2; stroke-dasharray: 2 7; }
.rk-cable rect { fill: #9e9a94; }
.rk-board.playing .rk-c2 { stroke: var(--accent); stroke-dasharray: 3 9; animation: rk-flow .9s linear infinite; }
@keyframes rk-flow { to { stroke-dashoffset: -12; } }
.rk-node { flex: none; display: grid; justify-items: center; gap: 3px; width: 104px; padding: 12px 6px; margin-top: 26px; border-radius: var(--r-2); border: 1px solid var(--line-2);
  background: linear-gradient(180deg, #3c372f, #2b2822); color: var(--text-2); box-shadow: var(--shadow-1); text-align: center; font: inherit; }
.rk-node b { font-size: 12px; color: var(--text); } .rk-node small { font-size: 10px; color: var(--text-3); font-family: var(--font-mono); }
.rk-jack { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #5b564e, #23201a 70%); box-shadow: inset 0 0 0 3px #13120f, 0 0 0 1px var(--line-2); color: var(--text-2); }
.rk-out { cursor: pointer; } .rk-out:hover { border-color: var(--text-3); }
.rk-add { flex: none; display: grid; place-items: center; gap: 4px; width: 92px; height: 132px; margin-top: 26px; border: 1.5px dashed var(--line-2); border-radius: var(--r-2);
  background: rgba(255,255,255,.015); color: var(--text-3); cursor: pointer; font: 600 12px var(--font-ui); transition: border-color .15s, color .15s, background .15s; }
.rk-add:hover, .rk-board.dropping .rk-add { border-color: var(--accent-2); color: var(--accent-2); background: color-mix(in srgb, var(--accent-2) 16%, transparent); }
.rk-drop { position: absolute; top: 18px; bottom: 14px; width: 3px; border-radius: 3px; background: var(--accent-2); box-shadow: 0 0 12px var(--accent-2); pointer-events: none; }
.rk-hint { flex: none; width: 270px; margin-top: 26px; padding: 4px 16px; color: var(--text-2); font-size: 13px; line-height: 1.5; }
.rk-hint p { margin: 0; color: var(--text-2); }
.rk-chip { display: inline; min-height: 0; height: auto; padding: 0 1px; font-size: inherit; color: var(--text); vertical-align: baseline; }
.rk-ask { justify-self: start; }
/* the hint's agent key wraps inside the hint rather than running out over the cable and the Add slot */
.rk-hint .rk-ask { max-width: 100%; height: auto; min-height: 28px; padding: 5px 11px; white-space: normal; line-height: 1.3; text-align: left; }
.ew-btn-agent.btn, .rk-ask { background: none; border: var(--rule-2); color: var(--text); }
.ew-btn-agent.btn svg, .rk-ask svg { color: var(--agent); }
.rk-empty { padding: 24px; }
/* agents */
.ew-agent-flash { animation: ew-agent-flash 1.5s var(--ease) both; }
.rk-card.ew-agent-flash { animation: rk-agent-card 1.5s var(--ease) both; }
/* an agent's change: a grease-pencil frame that fades (no glow) */
@keyframes ew-agent-flash { 0%, 30% { outline: 1.5px solid var(--accent-2); outline-offset: 2px; } 100% { outline: 1.5px solid transparent; outline-offset: 2px; } }
@keyframes rk-agent-card { 0%, 25% { outline: 1.5px solid var(--accent-2); outline-offset: 3px; } 100% { outline: 1.5px solid transparent; outline-offset: 3px; } }
/* the agent pointing at a card: crop marks (.crop, app.css) and its one-line label above the top right */
.rk-pres { z-index: 4; inset: -2px; }
.rk-pres > span { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
/* the plain face (FALLBACK) */
.pf { position: relative; display: grid; gap: 8px; min-width: 120px; padding: 10px 12px 12px; border-radius: 10px; color: var(--pi); background: linear-gradient(170deg, #ffffff22, transparent 40%, #00000030), var(--pc); box-shadow: inset 0 1px 0 #fff3, 0 4px 0 #0008, 0 10px 18px #0007; }
.pf-top { display: flex; align-items: center; gap: 7px; font-family: var(--font-display); font-size: 15px; }
.pf-led { width: 8px; height: 8px; border-radius: 50%; background: #3a1420; } .pf.on .pf-led { background: #ff5c7a; box-shadow: 0 0 8px #ff5c7a; }
.pf-knobs { display: grid; grid-template-columns: repeat(4, auto); gap: 6px 10px; }
.pf-k { display: grid; justify-items: center; gap: 2px; font: 600 8px/1 var(--font-mono); letter-spacing: .05em; --mk-c: var(--pi); }
.pf-sw { justify-self: center; width: 30px; height: 30px; border-radius: 50%; border: 0; background: radial-gradient(circle at 40% 35%, #eee, #888 60%, #444); cursor: pointer; box-shadow: 0 2px 0 #0008; }
/* pickers and info */
.rk-menu { display: grid; gap: 1px; min-width: 180px; }
.rk-mi { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 0; border-radius: var(--r-1); background: transparent; text-align: left; cursor: pointer; color: var(--text-2); }
.rk-mi:hover, .rk-mi.on { background: var(--bg-2); color: var(--text); }
.rk-mi:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.rk-mi-n { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rk-mi-off { margin-left: auto; padding-left: 12px; color: var(--text-3); font-size: 12px; white-space: nowrap; }
.rk-picker { display: grid; gap: 6px; width: 340px; max-width: calc(100vw - 32px); }
.rk-q { width: 100%; }
@media (pointer: coarse) { .rk-q { height: 44px; font-size: 16px; } }
.rk-plist { display: grid; gap: 1px; max-height: 380px; overflow: auto; }
.rk-pcat { display: flex; align-items: center; gap: 6px; padding: 10px 8px 4px; font: 600 12px/1 var(--font-ui); color: var(--text-3); border-bottom: var(--rule); }
.rk-prow { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center; padding: 6px 8px; border: 0; border-radius: var(--r-1); background: transparent; text-align: left; cursor: pointer; color: var(--text); }
.rk-prow .rk-sw { grid-row: span 2; }
.rk-prow > span { font-weight: 600; font-size: 12px; }
/* a device's description wraps (two lines at most, cut at a word) rather than stopping mid-word */
.rk-prow small { grid-column: 2; color: var(--text-3); font-size: 11px; line-height: 1.35; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: break-word; }
.rk-prow:not(:has(.rk-sw)) small { grid-column: 1 / -1; }
.rk-prow:not(:has(.rk-sw)) { grid-template-columns: 1fr; }
.rk-prow:hover { background: var(--bg-2); }
.rk-prow.on { background: var(--text); color: var(--bg); }
.rk-prow.on small { color: var(--bg); }
.rk-sw { display: inline-block; width: 14px; height: 14px; border-radius: 4px; border: 2px solid transparent; box-shadow: 0 0 0 1px rgba(0,0,0,.4); flex: none; }
.rk-sw.big { width: 28px; height: 28px; border-radius: 7px; }
.rk-note { margin: 2px 4px 4px; color: var(--text-3); font-size: 11px; line-height: 1.4; }
.rk-info { display: grid; gap: 8px; width: 300px; padding: 8px; font-size: 12px; color: var(--text-2); line-height: 1.45; }
.rk-info p { margin: 0; }
.rk-info-h { display: flex; gap: 10px; align-items: center; }
.rk-info-h b { display: block; font-family: var(--font-display); font-variation-settings: var(--font-display-vars); font-size: 18px; color: var(--text); }
.rk-info-h small { color: var(--text-3); font-size: 10px; }
.rk-info dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
.rk-info dt { color: var(--text-3); } .rk-info dd { margin: 0; color: var(--text); }
.rk-info-a { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 4px; }
.rk-house { color: var(--text-2); }
.rk-sheet { position: fixed; top: 60px; right: 8px; bottom: 8px; width: min(600px, calc(100vw - 16px)); z-index: 800; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line-2); border-radius: var(--r-3);
  box-shadow: var(--shadow-2); transform: translateX(16px); opacity: 0; transition: transform .22s var(--ease), opacity .22s; overflow: hidden; }
.rk-sheet.in { transform: none; opacity: 1; }
.rk-sheet-h { display: grid; gap: 6px; padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--line); }
.rk-sheet-t { display: flex; align-items: center; gap: 8px; }
.rk-sheet-a { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 4px; }
.rk-sheet-h b { font-family: var(--font-display); font-variation-settings: var(--font-display-vars); font-size: 18px; }
.rk-sheet-h small { color: var(--text-3); }
.rk-sheet-b { margin: 0; padding: 10px 16px; color: var(--text-2); font-size: 12px; border-bottom: 1px solid var(--line); }
.rk-code { flex: 1; margin: 0; overflow: auto; padding: 10px 0; font: 12px/1.55 var(--font-mono); color: var(--text); background: var(--bg); outline: none; }
.rk-code div { display: flex; white-space: pre-wrap; word-break: break-word; }
.rk-code span { min-width: 0; padding-right: 14px; }
.rk-code i { flex: none; width: 44px; padding-right: 12px; text-align: right; color: var(--text-3); font-style: normal; user-select: none; }
/* presets: a plain word under the caption that opens a short list; the one it's on in reverse print */
.rk-preline { display: flex; align-items: baseline; gap: 7px; width: 100%; min-width: 0; margin-top: -4px; padding: 0 2px; font-size: 11.5px; line-height: 18px; color: var(--text-3); }
.rk-pre-l { flex: none; }
.rk-pre { display: inline-flex; align-items: baseline; gap: 0; min-width: 0; max-width: 100%; padding: 0; border: 0; background: none; color: var(--text); font: 600 11.5px/18px var(--font-ui); cursor: pointer; text-align: left; }
.rk-pre-n { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; }
.rk-pre:hover .rk-pre-n, .rk-pre[aria-expanded="true"] .rk-pre-n { text-decoration-color: var(--text); }
.rk-pre-e { flex: none; color: var(--text-3); font-weight: 400; }
.rk-pre svg { flex: none; align-self: center; margin-left: 4px; color: var(--text-3); }
.rk-pre:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.rk-presets { display: grid; min-width: 200px; max-width: 300px; }
.rk-presets .rk-pcat { padding: 4px 8px 6px; }
.rk-pi { display: grid; gap: 1px; padding: 6px 8px; border: 0; border-bottom: var(--rule); border-radius: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; font: 600 12.5px/1.35 var(--font-ui); }
.rk-pi:last-child { border-bottom: 0; }
.rk-pi small { color: var(--text-3); font-weight: 400; font-size: 11px; }
.rk-pi:hover { background: var(--bg-2); }
.rk-pi.sel-print, .rk-pi.sel-print:hover { background: var(--text); color: var(--bg); }
.rk-pi.sel-print small { color: var(--bg); }
.rk-pi:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
/* a phone: the face stays at the top of the board, the preset line goes under it */
.rk-phone .rk-preline { order: 3; margin-top: 0; font-size: 12px; }
.rk-phone .rk-pre { font-size: 12px; }
@media (max-width: 900px) { .rk-pre { min-height: 40px; align-items: center; } .rk-preline { align-items: center; } .rk-pi { min-height: 40px; } }
/* compact */
.rk-compact .rk-rail { padding: 14px 14px 12px; }
.rk-compact .rk-add { height: 92px; width: 72px; }
.rk-compact .rk-node { width: 76px; padding: 8px 4px; }
.rk-compact .rk-hint { width: 230px; padding: 4px 12px; font-size: 12.5px; }
@media (max-width: 900px) { .rk-flow { display: none; } .rk-head .ew-btn span { display: none; } }
`;
