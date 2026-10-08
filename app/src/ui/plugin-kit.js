// The plugin kit: the widgets a device's window is built from (ui/plugin.js), for the generic editor and every custom
// editor (ui/editors/<name>.js), so they share one feel. Each is drawn in the studio's tokens (liner notes: cream ink
// on graphite, hairlines, 2 px corners on what you press, no glow), works from the keyboard and is labelled for a
// screen reader. Nothing here runs its own requestAnimationFrame: canvases draw from pump(now), which the window's
// host calls from the shell's loop once a frame, and only while each canvas is on screen.
//
// A param spec is a device's param (devices/registry.js normParam): { key, label, min, max, def, step, curve, unit,
// opts?, fmt?, quantum? }. Values travel the way lanes and the faces do (core/automation.js toPos/fromPos: log for curve
// 'log'), snap the way the faces snap (to 1/200 of a short range, or a param's own `quantum`: Scribble Strip's points
// sit on a grid finer than that), and read out in the faces' formats (ui/faces.js valueText).
//
//   knob(spec, { value, size = 52, label, name, readout = true, bipolar, onInput(v, { commit }), onMenu(anchor, e) })
//     -> { el, dial, set(v), get(), setMod(amount | null), mark('auto' | 'held' | null, { title, label, onClick }),
//          busy(), destroy() }
//        drag up or down (Shift: fine; a finger rests 8 px still first, for the long press), the wheel, arrow keys,
//        Page Up/Down, Home/End, double-click for the default. role=slider, aria values, valuetext in the param's units.
//        setMod(amount): the modulation ring, amount in knob travel (-1..1) from the value, in grease pencil.
//   slider(spec, { value, orient: 'h' | 'v', length, label, onInput, onMenu }) -> the knob's shape
//        A mouse's click jumps the cap to the pointer; a finger never does: it moves the cap from where it is.
//   A finger on a knob or a slider (ui/touch.js): a drag scrolls the window, and the control moves only once it has
//   been held still for a moment (so a thumb reaching for Studio A's mics scrolls past the strips and moves none).
//   toggle({ label, on, onChange(on), title }) -> { el, set(on), get() }          a .tog: a square lamp beside a word
//   segmented(spec | { label, opts }, { value, onChange(i), name }) -> { el, set(i), get() }   radio group, reverse print
//   select(spec | { label, opts }, { value, onChange(i), name }) -> { el, set(i), get() }      for longer lists
//   tap(spec, { value, onInput(bpm) }) -> { el, set(v) }           tap tempo (0 follows the song)
//   xy({ label, x: spec, y: spec, value: [x, y], onInput([x, y], { commit }) }) -> { el, set([x, y]), destroy() }
//   envelope({ label, showLabel = true, readout = true, attack, decay, sustain, release, curves?: { attack?, decay?,
//              release? }, value: { ... }, width, height, onInput(patch, { commit }) }) -> { el, get(), set(value), destroy() }
//        each of attack/decay/sustain/release (and the curves, -1..1 params) is a spec; patch names the specs' keys.
//        The points drag (the decay point up and down too: the sustain), each a labelled slider for the keyboard.
//   lfo({ label, shape: 'sine' | 'tri' | 'saw' | 'ramp' | 'square' | 'sh' | fn(phase) -> -1..1, depth?: () => 0..1,
//         rate?: () => Hz, phase?: () => 0..1 }) -> { el, set({ shape, ... }), destroy() }      (SHAPES: the shapes)
//   canvas({ label, className, draw(g, { w, h, dpr, now }), animate?: bool | () => bool }) -> { el, g, dirty(),
//          set({ draw, animate }), destroy() }   sized to device pixels (2x at most) by a ResizeObserver
//   meter({ label, read() -> { peak, rms } (dBFS), orient: 'h' | 'v', floor = -60 }) -> { el, destroy() }
//   keys({ lo, hi, label, onNote(p, v, on) }) -> { el, setRange(lo, hi), light(p, on), clear(), destroy() }
//        a piano strip: click or drag to play (each pointer its own note, so a touch screen plays chords), the
//        height you press at is the velocity; arrow keys walk it, Enter or Space plays the focused key.
//   menuOn(target, open(anchor, event), onLong?)   a control's menu: right-click, a long press, the menu key
//                                     (the window's ctx.menu(key, anchor) is the rack's controlMenu, to open from it)
//   pump(now)                         the host's once-a-frame call: canvases that are on screen and dirty (or
//                                     animating) draw
//   spec(p) / text(spec, v) / snap(spec, v) / pos(spec, v) / val(spec, x) / noteName(p)

import { h, css, clamp } from './dom.js';
import { normParam } from '../devices/registry.js';
import { toPos, fromPos } from '../core/automation.js';
import { valueText, widestReadout } from './faces.js';
import { holdToMove } from './touch.js';

/* ================================================================ specs and values */
export function spec(p) {
  const q = normParam(p || {});
  if (q.opts) q.opts = q.opts.map((o) => String(o));
  q.label = String(q.label || q.key || '');
  return q;
}
export const text = (p, v) => {
  try {
    return valueText(p, v);
  } catch (e) {
    return String(v);
  }
};
const logOk = (p) => p.curve === 'log' && p.min > 0 && p.max > p.min;
const quantum = (p) =>
  p.step || (p.quantum > 0 ? p.quantum : Math.abs(p.max - p.min) >= 5 ? 0.1 : Math.abs(p.max - p.min) / 200);
// the faces' snap (ui/faces.js), so a value set here is one a face would have set
export function snap(p, v) {
  if (!Number.isFinite(+v)) v = p.def;
  v = clamp(+v, Math.min(p.min, p.max), Math.max(p.min, p.max));
  if (p.step) return Math.round((v - p.min) / p.step) * p.step + p.min;
  if (logOk(p)) {
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, v))) - 2);
    return Math.round(v / mag) * mag;
  }
  const q = quantum(p);
  return +(Math.round(v / q) * q).toFixed(6);
}
export const pos = (p, v) => clamp(toPos(p, v), 0, 1);
export const val = (p, x) => fromPos(p, clamp(x, 0, 1));
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SPOKEN = ['C', 'C sharp', 'D', 'E flat', 'E', 'F', 'F sharp', 'G', 'A flat', 'A', 'B flat', 'B'];
export const noteName = (p) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`; // 60 = C4 (core/music.js)
const spokenName = (p) => `${SPOKEN[((p % 12) + 12) % 12]} ${Math.floor(p / 12) - 1}`;
const capWord = (s) => {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

/* ================================================================ the pump: canvases draw from the host's frame */
const live = new Set();
const byEl = new WeakMap();
let io = null;
function watch(c) {
  if (!io && typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((es) => {
      for (const e of es) {
        const x = byEl.get(e.target);
        if (x) {
          x.visible = e.isIntersecting;
          if (x.visible) x.dirty = true;
        }
      }
    });
  }
  io?.observe(c.el);
}
export function pump(now = performance.now()) {
  if (!live.size || (typeof document !== 'undefined' && document.hidden)) return;
  for (const c of live) {
    if (!c.el.isConnected) {
      if (c.seen) drop(c);
      continue;
    }
    c.seen = true;
    if (!c.visible || !c.w || !c.h) continue;
    const anim = typeof c.animate === 'function' ? !!c.animate() : !!c.animate;
    if (!c.dirty && !anim) continue;
    c.dirty = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.el.width !== Math.round(c.w * dpr) || c.el.height !== Math.round(c.h * dpr) || c.dpr !== dpr) {
      c.dpr = dpr;
      c.el.width = Math.round(c.w * dpr);
      c.el.height = Math.round(c.h * dpr);
    }
    c.g.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    c.g.clearRect(0, 0, c.w, c.h);
    try {
      c.draw && c.draw(c.g, { w: c.w, h: c.h, dpr: c.dpr, now });
    } catch (e) {
      console.error('plugin kit: a canvas failed to draw', e);
      c.draw = null;
    }
  }
}
function drop(c) {
  live.delete(c);
  c.ro?.disconnect();
  io?.unobserve(c.el);
}

export function canvas({ label = '', className = '', draw = null, animate = false } = {}) {
  ensureCss();
  const el = h(
    'canvas.pk-cv' + (className ? '.' + className : ''),
    label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' },
  );
  const c = {
    el,
    g: el.getContext('2d'),
    draw,
    animate,
    w: 0,
    h: 0,
    dpr: 1,
    dirty: true,
    visible: true,
    seen: false,
    ro: null,
  };
  if (typeof ResizeObserver === 'function') {
    c.ro = new ResizeObserver((es) => {
      for (const e of es) {
        const r = e.contentRect;
        c.w = Math.max(0, Math.round(r.width));
        c.h = Math.max(0, Math.round(r.height));
        c.dirty = true;
      }
    });
    c.ro.observe(el);
  }
  live.add(c);
  byEl.set(el, c);
  watch(c);
  return {
    el,
    g: c.g,
    dirty() {
      c.dirty = true;
    },
    set(o = {}) {
      if ('draw' in o) c.draw = o.draw;
      if ('animate' in o) c.animate = o.animate;
      if ('label' in o && o.label) el.setAttribute('aria-label', o.label);
      c.dirty = true;
    },
    get size() {
      return { w: c.w, h: c.h, dpr: c.dpr };
    },
    destroy() {
      drop(c);
    },
  };
}

/* ================================================================ the menu on a control (right-click, long press, the menu key) */
// menuOn(target, open(anchor, event | null), onLong?): right-click, a long press on touch (still for 520 ms; onLong
// first, so the control drops its gesture), or the menu key / Shift+F10 on it. The click after a long press is eaten.
const LONG_MS = 520;
export function menuOn(target, open, onLong) {
  wireMenu(target, open, onLong);
}
function wireMenu(target, open, onLong) {
  let lp = null,
    fired = -1e9;
  const recent = () => performance.now() - fired < 800;
  target.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!recent()) open(target, e);
  });
  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (lp) clearTimeout(lp.t);
    const x = e.clientX,
      y = e.clientY;
    lp = {
      x,
      y,
      t: setTimeout(() => {
        lp = null;
        fired = performance.now();
        onLong && onLong();
        open(target, { clientX: x, clientY: y });
      }, LONG_MS),
    };
  });
  target.addEventListener('pointermove', (e) => {
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) {
      clearTimeout(lp.t);
      lp = null;
    }
  });
  const cancel = () => {
    if (lp) {
      clearTimeout(lp.t);
      lp = null;
    }
  };
  target.addEventListener('pointerup', cancel);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener(
    'click',
    (e) => {
      if (recent()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  target.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      open(target, null);
    }
  });
}

/* ================================================================ the mark: "auto" / "held" beside a control's label */
function makeMark(host) {
  let m = null;
  return (state, { title = '', label = '', onClick = null } = {}) => {
    if (!state) {
      m?.remove();
      m = null;
      host.closest('.pk-ctl')?.removeAttribute('data-auto');
      return;
    }
    if (!m) {
      m = h('button.pk-am', {
        type: 'button',
        onpointerdown: (e) => e.stopPropagation(),
        onclick: (e) => {
          e.stopPropagation();
          m._click && m._click(e);
        },
      });
      host.append(m);
    }
    host.closest('.pk-ctl')?.setAttribute('data-auto', state);
    m.dataset.mark = state;
    m.textContent = state;
    m.title = title;
    m.setAttribute('aria-label', label || title || state);
    m._click = onClick;
  };
}

/* ================================================================ a continuous control (knob and slider share it) */
// The gesture, the keys, the wheel and the value: everything but the drawing.
function continuous(p, { value, onInput, dial, draw, axis = 'v', length = 180 }) {
  let v = snap(p, value ?? p.def),
    g = null,
    wheelT = 0,
    auto = null;
  const put = (x, commit) => {
    x = snap(p, x);
    if (x === v) {
      if (commit) onInput && onInput(v, { commit: true });
      return;
    }
    v = x;
    draw();
    onInput && onInput(v, { commit });
  };
  dial.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    g = {
      x: e.clientX,
      y: e.clientY,
      pos: pos(p, v),
      fine: e.shiftKey,
      moved: false,
      touch: e.pointerType === 'touch',
      id: e.pointerId,
    };
    try {
      dial.setPointerCapture(e.pointerId);
    } catch (err) {
      /* gone */
    }
    dial.focus({ preventScroll: true });
    dial.classList.add('pk-turning');
    e.preventDefault();
    // a slider jumps to where a mouse presses (a knob doesn't: it turns from where it is; a finger moves a slider's cap
    // from where it is, picked up where it sits)
    if ((axis !== 'v' || dial.dataset.kind === 'slider') && !g.touch) jump(e);
  });
  holdToMove(dial, { name: dial.dataset.kind !== 'slider' ? 'knob' : axis === 'v' ? 'fader' : 'slider' });
  const jump = (e) => {
    if (dial.dataset.kind !== 'slider') return;
    const r = dial.getBoundingClientRect();
    const x = axis === 'h' ? (e.clientX - r.left) / r.width : 1 - (e.clientY - r.top) / r.height;
    g.pos = clamp(x, 0, 1);
    g.x = e.clientX;
    g.y = e.clientY;
    g.moved = true;
    put(val(p, g.pos), false);
  };
  dial.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (e.shiftKey !== g.fine) g = { ...g, x: e.clientX, y: e.clientY, pos: pos(p, v), fine: e.shiftKey }; // (Shift mid-drag: fine from here, no jump)
    const d = axis === 'h' ? e.clientX - g.x : g.y - e.clientY;
    // a finger rests for the long press (the menu): nothing turns until it has moved 8 px, then from there
    if (g.touch && !g.moved) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 8) return;
      g.x = e.clientX;
      g.y = e.clientY;
      g.moved = true;
      return;
    }
    if (!g.moved && Math.abs(d) < 2) return; // (a click's jitter turns nothing, and so holds no lane)
    g.moved = true;
    // a knob sweeps its range in `length` px of travel; a slider in its own length (the cap stays under the finger)
    const span = length * (g.fine ? 4 : 1) * (g.touch && dial.dataset.kind !== 'slider' ? 2 : 1);
    put(val(p, g.pos + d / span), false);
  });
  const end = (e) => {
    if (!g || (e && e.pointerId != null && e.pointerId !== g.id)) return;
    const moved = g.moved;
    g = null;
    dial.classList.remove('pk-turning');
    if (moved) onInput && onInput(v, { commit: true });
  };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener('lostpointercapture', end);
  dial.addEventListener('dblclick', () => put(p.def, true));
  dial.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = -(e.deltaY || -e.deltaX) / (e.shiftKey ? 2400 : 600);
      const next = val(p, pos(p, v) + d);
      put(p.step && Math.abs(next - v) < p.step ? v + Math.sign(d) * p.step : next, false);
      clearTimeout(wheelT);
      wheelT = setTimeout(() => onInput && onInput(v, { commit: true }), 280);
    },
    { passive: false },
  );
  dial.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const small = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key],
      big = { PageUp: 1, PageDown: -1 }[e.key];
    if (small != null || big != null) {
      e.preventDefault();
      e.stopPropagation();
      const steps = p.step ? Math.abs(p.max - p.min) / p.step : Infinity;
      if (p.step && steps <= 40) put(v + (small || big * Math.max(1, Math.round(steps / 10))) * p.step, true);
      else put(val(p, pos(p, v) + (small != null ? small * (e.shiftKey ? 0.002 : 0.01) : big * 0.1)), true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      put(p.min, true);
    } else if (e.key === 'End') {
      e.preventDefault();
      put(p.max, true);
    }
  });
  // the long press on touch drops the gesture (the menu opens instead)
  const cancelGesture = () => {
    g = null;
    dial.classList.remove('pk-turning');
  };
  return {
    get: () => v,
    set(x) {
      if (g) return;
      const nx = snap(p, x);
      if (nx === v) return;
      v = nx;
      draw();
    },
    busy: () => !!g,
    cancelGesture,
    aria(extra) {
      auto = extra;
    },
    auto: () => auto,
  };
}

/* ================================================================ knob */
const A0 = Math.PI * 0.75,
  SPAN = Math.PI * 1.5;
const pt = (r, a) => [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
const arc = (r, a, b) => {
  if (Math.abs(b - a) < 0.004) return '';
  const lo = Math.min(a, b),
    hi = Math.max(a, b),
    [x1, y1] = pt(r, lo),
    [x2, y2] = pt(r, hi);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${hi - lo > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
};
let uid = 0;
export function knob(
  p0,
  { value, size = 52, label = null, name = '', readout = true, bipolar = null, onInput = null, onMenu = null } = {},
) {
  ensureCss();
  const p = spec(p0);
  const id = 'pk' + ++uid;
  const lab = label === false ? null : (label ?? p.label);
  const bi = bipolar ?? (p.min < 0 && p.max > 0);
  const el = h('div.pk-ctl.pk-knob', { dataset: { key: p.key || '' } });
  el.style.setProperty('--pk-size', size + 'px');
  el.style.setProperty('--pk-vn', String(Math.max(4, widestReadout(p))));
  const head = lab ? h('span.pk-l', { id: id + '-l' }, h('span.pk-l-t', lab)) : null;
  const dial = h('div.pk-dial', {
    role: 'slider',
    tabindex: 0,
    'aria-label': `${name ? name + ' ' : ''}${capWord(lab || p.key)}`,
    'aria-valuemin': p.min,
    'aria-valuemax': p.max,
  });
  dial.innerHTML =
    '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="pk-trk"/><path class="pk-mod"/><path class="pk-val"/><line class="pk-def"/><circle class="pk-body" cx="50" cy="50" r="27"/><line class="pk-ptr" x1="50" y1="50" x2="50" y2="26"/></svg>';
  const [trk, mod, vArc, defT, , ptr] = dial.firstChild.children;
  trk.setAttribute('d', arc(40, A0, A0 + SPAN));
  {
    const a = A0 + SPAN * pos(p, p.def),
      [x1, y1] = pt(35, a),
      [x2, y2] = pt(45, a);
    defT.setAttribute('x1', x1);
    defT.setAttribute('y1', y1);
    defT.setAttribute('x2', x2);
    defT.setAttribute('y2', y2);
  }
  const out = readout ? h('output.pk-v', { 'aria-hidden': 'true' }) : null;
  el.append(...[head, dial, out].filter(Boolean));
  const baseTitle =
    (p.desc ? String(p.desc) + '. ' : '') +
    `Drag up or down (Shift: fine), scroll, or use the arrow keys. Double-click: back to ${text(p, p.def)}`;
  dial.title = baseTitle;
  let modAmt = null;
  const draw = () => {
    const v = c.get(),
      x = pos(p, v),
      a = A0 + SPAN * x,
      a0 = bi ? A0 + SPAN * pos(p, 0) : A0;
    vArc.setAttribute('d', arc(40, a0, a));
    ptr.setAttribute('transform', `rotate(${((a * 180) / Math.PI + 90).toFixed(2)} 50 50)`);
    mod.setAttribute('d', modAmt == null || !modAmt ? '' : arc(47, a, A0 + SPAN * clamp(x + modAmt, 0, 1)));
    const t = text(p, v),
      au = c.auto();
    dial.setAttribute('aria-valuenow', String(+(+v).toFixed(6)));
    dial.setAttribute('aria-valuetext', au === 'auto' ? `${t}, follows its lane` : au === 'held' ? `${t}, held` : t);
    if (out) out.textContent = t;
    el.style.setProperty('--pk-x', x.toFixed(3));
  };
  const c = continuous(p, { value, onInput, dial, draw, axis: 'v', length: 180 });
  if (onMenu)
    wireMenu(
      dial,
      (anchor, e) => onMenu(e && e.clientX != null ? e : anchor, e),
      () => c.cancelGesture(),
    );
  const mark = makeMark(head || el);
  draw();
  return {
    el,
    dial,
    get: c.get,
    set(v) {
      c.set(v);
    },
    busy: c.busy,
    setMod(amount) {
      modAmt = Number.isFinite(amount) ? clamp(amount, -1, 1) : null;
      draw();
    },
    mark(state, o = {}) {
      mark(state, o);
      c.aria(state);
      dial.title = (state && o.note ? o.note + '. ' : '') + baseTitle;
      draw();
    },
    redraw: draw,
    destroy() {
      el.remove();
    },
  };
}

/* ================================================================ slider (a fader cap on a hairline) */
export function slider(
  p0,
  { value, orient = 'h', length = 160, label = null, name = '', readout = true, onInput = null, onMenu = null } = {},
) {
  ensureCss();
  const p = spec(p0);
  const lab = label === false ? null : (label ?? p.label);
  const el = h(`div.pk-ctl.pk-slider.pk-slider-${orient}`, {
    dataset: { key: p.key || '' },
    style: { [orient === 'h' ? 'width' : 'height']: length + 'px' },
  });
  const head = lab ? h('span.pk-l', h('span.pk-l-t', lab)) : null;
  const fill = h('i.pk-sl-fill'),
    cap = h('i.pk-sl-cap');
  const dial = h(
    'div.pk-sl',
    {
      role: 'slider',
      tabindex: 0,
      'aria-label': `${name ? name + ' ' : ''}${capWord(lab || p.key)}`,
      'aria-orientation': orient === 'h' ? 'horizontal' : 'vertical',
      'aria-valuemin': p.min,
      'aria-valuemax': p.max,
      dataset: { kind: 'slider' },
    },
    h('i.pk-sl-trk'),
    fill,
    cap,
  );
  const out = readout ? h('output.pk-v', { 'aria-hidden': 'true' }) : null;
  el.append(...[head, dial, out].filter(Boolean));
  const draw = () => {
    const v = c.get(),
      x = pos(p, v),
      t = text(p, v),
      au = c.auto();
    el.style.setProperty('--pk-x', x.toFixed(4));
    dial.setAttribute('aria-valuenow', String(+(+v).toFixed(6)));
    dial.setAttribute('aria-valuetext', au === 'auto' ? `${t}, follows its lane` : au === 'held' ? `${t}, held` : t);
    if (out) out.textContent = t;
  };
  const c = continuous(p, { value, onInput, dial, draw, axis: orient, length });
  if (onMenu)
    wireMenu(
      dial,
      (anchor, e) => onMenu(e && e.clientX != null ? e : anchor, e),
      () => c.cancelGesture(),
    );
  const mark = makeMark(head || el);
  draw();
  return {
    el,
    dial,
    get: c.get,
    set(v) {
      c.set(v);
    },
    busy: c.busy,
    setMod() {},
    mark(state, o = {}) {
      mark(state, o);
      c.aria(state);
      draw();
    },
    redraw: draw,
    destroy() {
      el.remove();
    },
  };
}

/* ================================================================ toggle: the kit's .tog (a square lamp beside a word) */
export function toggle({ label = '', on = false, onChange = null, title = '', name = '' } = {}) {
  ensureCss();
  let v = !!on;
  const el = h(
    'button.tog.pk-tog',
    {
      type: 'button',
      title: title || null,
      'aria-label': name ? `${name} ${label}`.trim() : null,
      'aria-pressed': String(v),
      onclick: () => {
        v = !v;
        draw();
        onChange && onChange(v);
      },
    },
    label,
  );
  const draw = () => el.setAttribute('aria-pressed', String(v));
  return {
    el,
    get: () => v,
    set(x) {
      v = !!x;
      draw();
    },
  };
}

/* ================================================================ segmented: a ruled row of words, the one picked in reverse print */
export function segmented(p0, { value, onChange = null, name = '', label = null } = {}) {
  ensureCss();
  const p = spec(p0);
  const opts = p.opts || [];
  const lab = label === false ? null : (label ?? p.label);
  let v = clamp(Math.round(value ?? p.def ?? 0), 0, Math.max(0, opts.length - 1));
  const head = lab ? h('span.pk-l', h('span.pk-l-t', lab)) : null;
  const btns = opts.map((o, i) =>
    h(
      'button.pk-seg-b',
      { type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: -1, onclick: () => pick(i, true) },
      o,
    ),
  );
  const row = h(
    'div.pk-seg-row',
    { role: 'radiogroup', 'aria-label': `${name ? name + ' ' : ''}${capWord(lab || p.key)}` },
    btns,
  );
  const el = h('div.pk-ctl.pk-seg', { dataset: { key: p.key || '' } }, head, row);
  row.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let to = null;
    if (d != null) to = (v + d + opts.length) % opts.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = opts.length - 1;
    if (to == null) return;
    e.preventDefault();
    e.stopPropagation();
    pick(to, true);
    btns[to].focus();
  });
  const draw = () =>
    btns.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === v));
      b.tabIndex = i === v ? 0 : -1;
      b.classList.toggle('sel-print', i === v);
    });
  const pick = (i, user) => {
    i = clamp(i, 0, opts.length - 1);
    if (i === v) return;
    v = i;
    draw();
    if (user && onChange) onChange(v);
  };
  draw();
  const mark = makeMark(head || el);
  return {
    el,
    row,
    menuTarget: row,
    get: () => v,
    set(i) {
      v = clamp(Math.round(i), 0, Math.max(0, opts.length - 1));
      draw();
    },
    mark(state, o = {}) {
      mark(state, o);
    },
    destroy() {
      el.remove();
    },
  };
}

/* ================================================================ select: a ruled field for a long list */
export function select(p0, { value, onChange = null, name = '', label = null } = {}) {
  ensureCss();
  const p = spec(p0);
  const lab = label === false ? null : (label ?? p.label);
  const s = h(
    'select.pk-select',
    {
      'aria-label': `${name ? name + ' ' : ''}${capWord(lab || p.key)}`,
      onchange: () => onChange && onChange(+s.value),
    },
    (p.opts || []).map((o, i) => h('option', { value: String(i) }, o)),
  );
  s.value = String(clamp(Math.round(value ?? p.def ?? 0), 0, Math.max(0, (p.opts || []).length - 1)));
  const head = lab ? h('span.pk-l', h('span.pk-l-t', lab)) : null;
  const el = h('div.pk-ctl.pk-sel', { dataset: { key: p.key || '' } }, head, s);
  const mark = makeMark(head || el);
  return {
    el,
    menuTarget: s,
    get: () => +s.value,
    set(i) {
      s.value = String(clamp(Math.round(i), 0, Math.max(0, (p.opts || []).length - 1)));
    },
    mark(state, o = {}) {
      mark(state, o);
    },
    destroy() {
      el.remove();
    },
  };
}

/* ================================================================ tap tempo: tap in time; 0 follows the song */
export function tap(p0, { value = 0, onInput = null, name = '' } = {}) {
  ensureCss();
  const p = spec(p0);
  let v = +value || 0,
    taps = [];
  const b = h(
    'button.btn.pk-tap-b',
    { type: 'button', 'aria-label': `${name ? name + ' ' : ''}tap tempo` },
    capWord(p.label || 'Tap'),
  );
  const r = h('button.btn.btn-txt.pk-tap-r', { type: 'button' });
  const el = h(
    'div.pk-ctl.pk-tap',
    { dataset: { key: p.key || '' } },
    h('span.pk-l', h('span.pk-l-t', p.label || 'TAP')),
    b,
    r,
  );
  const draw = () => {
    const on = v >= 40;
    r.textContent = on ? `${Math.round(v)} BPM` : 'Song tempo';
    r.disabled = !on;
    r.title = on ? 'Follow the song’s tempo again' : '';
    r.setAttribute(
      'aria-label',
      on ? `Tapped ${Math.round(v)} BPM: follow the song instead` : 'Following the song’s tempo',
    );
  };
  b.addEventListener('pointerdown', (e) => {
    const now = e.timeStamp || performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length < 2) return;
    const gap = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    v = clamp(Math.round(600000 / gap) / 10, 40, 300);
    draw();
    onInput && onInput(v, { commit: true });
  });
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
  });
  r.addEventListener('click', () => {
    if (v < 40) return;
    v = 0;
    taps = [];
    draw();
    onInput && onInput(0, { commit: true });
  });
  draw();
  return {
    el,
    menuTarget: b,
    get: () => v,
    set(x) {
      v = +x || 0;
      draw();
    },
    mark() {},
    destroy() {
      el.remove();
    },
  };
}

/* ================================================================ XY pad: two params on one square */
export function xy({ label = '', x: px, y: py, value = null, size = 160, onInput = null, name = '' } = {}) {
  ensureCss();
  const X = spec(px),
    Y = spec(py);
  let vx = snap(X, value?.[0] ?? X.def),
    vy = snap(Y, value?.[1] ?? Y.def),
    g = null;
  const puck = h('div.pk-xy-puck', {
    role: 'slider',
    tabindex: 0,
    'aria-label': `${name ? name + ' ' : ''}${label || `${capWord(X.label)} and ${capWord(Y.label)}`}`,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    title: 'Drag, or use the arrow keys: left and right for one, up and down for the other',
  });
  const hx = h('i.pk-xy-hx'),
    hy = h('i.pk-xy-hy');
  const pad = h('div.pk-xy-pad', { style: { width: size + 'px', height: size + 'px' } }, hx, hy, puck);
  const out = h('output.pk-v.pk-xy-v', { 'aria-hidden': 'true' });
  const el = h(
    'div.pk-ctl.pk-xy',
    { role: 'group', 'aria-label': label || `${capWord(X.label)} and ${capWord(Y.label)}` },
    label ? h('span.pk-l', h('span.pk-l-t', label)) : null,
    pad,
    out,
  );
  const draw = () => {
    const ax = pos(X, vx),
      ay = pos(Y, vy);
    pad.style.setProperty('--pk-px', ax.toFixed(4));
    pad.style.setProperty('--pk-py', ay.toFixed(4));
    const t = `${capWord(X.label)} ${text(X, vx)}, ${capWord(Y.label)} ${text(Y, vy)}`;
    puck.setAttribute('aria-valuenow', String(Math.round(ax * 100)));
    puck.setAttribute('aria-valuetext', t);
    out.textContent = `${text(X, vx)}  ${text(Y, vy)}`;
  };
  const put = (nx, ny, commit) => {
    nx = snap(X, nx);
    ny = snap(Y, ny);
    if (nx === vx && ny === vy) {
      if (commit) onInput && onInput([vx, vy], { commit: true });
      return;
    }
    vx = nx;
    vy = ny;
    draw();
    onInput && onInput([vx, vy], { commit });
  };
  const at = (e) => {
    const r = pad.getBoundingClientRect();
    return [val(X, (e.clientX - r.left) / r.width), val(Y, 1 - (e.clientY - r.top) / r.height)];
  };
  pad.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    g = { id: e.pointerId };
    try {
      pad.setPointerCapture(e.pointerId);
    } catch (err) {
      /* gone */
    }
    puck.focus({ preventScroll: true });
    const [a, b] = at(e);
    put(a, b, false);
    e.preventDefault();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!g || g.id !== e.pointerId) return;
    const [a, b] = at(e);
    put(a, b, false);
  });
  const end = (e) => {
    if (!g || (e && e.pointerId !== g.id)) return;
    g = null;
    onInput && onInput([vx, vy], { commit: true });
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  puck.addEventListener('keydown', (e) => {
    const st = e.shiftKey ? 0.002 : 0.01;
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    put(val(X, pos(X, vx) + d[0]), val(Y, pos(Y, vy) + d[1]), true);
  });
  draw();
  return {
    el,
    puck,
    get: () => [vx, vy],
    set(v) {
      if (g || !v) return;
      vx = snap(X, v[0]);
      vy = snap(Y, v[1]);
      draw();
    },
    destroy() {
      el.remove();
    },
  };
}

/* ================================================================ envelope: ADSR with draggable points and curve handles */
// Each segment takes up to a quarter of the width, by its knob's travel (so a long release doesn't squash the
// attack), and the sustain holds for the last quarter. The attack, decay and release points drag sideways (the decay
// point also up and down: the sustain level); a curve handle on a segment drags up and down to bend it.
export function envelope({
  label = 'Envelope',
  showLabel = true,
  readout = true,
  attack,
  decay,
  sustain,
  release,
  curves = {},
  value = {},
  width = 280,
  height = 112,
  onInput = null,
  name = '',
} = {}) {
  ensureCss();
  const S = {
    attack: attack && spec(attack),
    decay: decay && spec(decay),
    sustain: sustain && spec(sustain),
    release: release && spec(release),
  };
  const C = {
    attack: curves.attack && spec(curves.attack),
    decay: curves.decay && spec(curves.decay),
    release: curves.release && spec(curves.release),
  };
  const cur = {};
  const keyOf = (sp) => sp?.key;
  const all = [...Object.values(S), ...Object.values(C)].filter(Boolean);
  for (const sp of all) cur[sp.key] = snap(sp, value[sp.key] ?? sp.def);
  const W = width,
    H = height,
    PAD = 8,
    Q = (W - 2 * PAD) / 4,
    TOP = PAD,
    BOT = H - PAD;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path class="pk-env-fill"/><path class="pk-env-line"/><line class="pk-env-base" x1="${PAD}" x2="${W - PAD}" y1="${BOT}" y2="${BOT}"/>`;
  const fillP = svg.children[0],
    lineP = svg.children[1];
  const field = h('div.pk-env-field', { style: { width: W + 'px', height: H + 'px' } }, svg);
  const handles = [];
  const out = h('output.pk-v.pk-env-v', { 'aria-hidden': 'true' });
  const el = h(
    'div.pk-ctl.pk-env',
    { role: 'group', 'aria-label': `${name ? name + ' ' : ''}${label}` },
    showLabel ? h('span.pk-l', h('span.pk-l-t', label)) : null,
    field,
    readout ? out : null,
  );
  const sustainLevel = () => (S.sustain ? pos(S.sustain, cur[S.sustain.key]) : 1);
  const segW = (sp) => (sp ? Math.max(4, pos(sp, cur[sp.key]) * Q) : Q * 0.5);
  const geo = () => {
    const xa = PAD + segW(S.attack),
      xd = xa + segW(S.decay),
      xs = PAD + 3 * Q,
      xr = xs + segW(S.release);
    const ys = BOT - (BOT - TOP) * sustainLevel();
    return { x0: PAD, xa, xd: Math.min(xd, xs), xs, xr, ys };
  };
  const curveOf = (k) => (C[k] ? pos(C[k], cur[C[k].key]) * 2 - 1 : 0);
  const bendPath = (x0, y0, x1, y1, c) => {
    // a quadratic bend: the control point leans toward the start (c > 0: slow then fast) or the end
    const cx = x0 + (x1 - x0) * (0.5 - 0.45 * c),
      cy = y0 + (y1 - y0) * (0.5 + 0.45 * c);
    return `Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  };
  const draw = () => {
    const q = geo();
    const d = `M${q.x0},${BOT} ${bendPath(q.x0, BOT, q.xa, TOP, curveOf('attack'))} ${bendPath(q.xa, TOP, q.xd, q.ys, curveOf('decay'))} L${q.xs},${q.ys} ${bendPath(q.xs, q.ys, q.xr, BOT, curveOf('release'))}`;
    lineP.setAttribute('d', d);
    fillP.setAttribute('d', d + ` L${q.x0},${BOT} Z`);
    for (const hd of handles) hd.place(q);
    out.textContent = ['attack', 'decay', 'sustain', 'release']
      .filter((k) => S[k])
      .map((k) => `${k[0].toUpperCase()} ${text(S[k], cur[S[k].key])}`)
      .join('  ');
  };
  const send = (patch, commit) => {
    for (const [k, v] of Object.entries(patch)) cur[k] = v;
    draw();
    onInput && onInput(patch, { commit });
  };
  // a handle: a small square you press; role=slider for its main value (the decay point's up and down is the sustain)
  const handle = (kind, sp, place, move, keys) => {
    if (!sp) return;
    const el2 = h('div.pk-env-h' + (kind.endsWith('curve') ? '.pk-env-c' : ''), {
      role: 'slider',
      tabindex: 0,
      'aria-label': `${name ? name + ' ' : ''}${capWord(kind.replace('curve', ' curve'))}`,
      'aria-valuemin': sp.min,
      'aria-valuemax': sp.max,
      title: kind.endsWith('curve')
        ? 'Drag up or down to bend it'
        : kind === 'decay'
          ? 'Drag: left and right the decay, up and down the sustain'
          : 'Drag sideways',
    });
    field.append(el2);
    let g = null;
    el2.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, at: { ...cur }, moved: false };
      try {
        el2.setPointerCapture(e.pointerId);
      } catch (err) {
        /* gone */
      }
      el2.focus({ preventScroll: true });
      e.preventDefault();
    });
    el2.addEventListener('pointermove', (e) => {
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.x,
        dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < 2) return;
      g.moved = true;
      const patch = move(dx, dy, g.at, e.shiftKey ? 0.25 : 1);
      if (patch) send(patch, false);
    });
    const end = (e) => {
      if (!g || (e && e.pointerId !== g.id)) return;
      const was = g;
      g = null;
      if (was.moved) {
        const patch = {};
        for (const k of Object.keys(cur)) if (cur[k] !== was.at[k]) patch[k] = cur[k];
        if (Object.keys(patch).length) onInput && onInput(patch, { commit: true });
      }
    };
    el2.addEventListener('pointerup', end);
    el2.addEventListener('pointercancel', end);
    el2.addEventListener('dblclick', () => {
      const patch = { [sp.key]: sp.def };
      send(patch, true);
    });
    el2.addEventListener('keydown', (e) => {
      const patch = keys(e);
      if (!patch) return;
      e.preventDefault();
      e.stopPropagation();
      send(patch, true);
    });
    handles.push({
      el: el2,
      place: (q) => {
        const [x, y] = place(q);
        el2.style.left = x + 'px';
        el2.style.top = y + 'px';
        el2.setAttribute('aria-valuenow', String(+(+cur[sp.key]).toFixed(6)));
        el2.setAttribute(
          'aria-valuetext',
          kind === 'decay' && S.sustain
            ? `${text(sp, cur[sp.key])}, sustain ${text(S.sustain, cur[S.sustain.key])}`
            : text(sp, cur[sp.key]),
        );
      },
    });
  };
  const nudgeX = (sp, at, dx, f) => snap(sp, val(sp, pos(sp, at[sp.key]) + (dx / Q) * f));
  const stepOf = (e) => (e.shiftKey ? 0.002 : 0.02);
  const dir = (e) => ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 })[e.key];
  handle(
    'attack',
    S.attack,
    (q) => [q.xa, TOP],
    (dx, dy, at, f) => ({ [S.attack.key]: nudgeX(S.attack, at, dx, f) }),
    (e) =>
      dir(e)
        ? { [S.attack.key]: snap(S.attack, val(S.attack, pos(S.attack, cur[S.attack.key]) + dir(e) * stepOf(e))) }
        : null,
  );
  handle(
    'decay',
    S.decay,
    (q) => [q.xd, q.ys],
    (dx, dy, at, f) => {
      const patch = { [S.decay.key]: nudgeX(S.decay, at, dx, f) };
      if (S.sustain)
        patch[S.sustain.key] = snap(
          S.sustain,
          val(S.sustain, pos(S.sustain, at[S.sustain.key]) - (dy / (BOT - TOP)) * f),
        );
      return patch;
    },
    (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        return { [S.decay.key]: snap(S.decay, val(S.decay, pos(S.decay, cur[S.decay.key]) + dir(e) * stepOf(e))) };
      if (S.sustain && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))
        return {
          [S.sustain.key]: snap(S.sustain, val(S.sustain, pos(S.sustain, cur[S.sustain.key]) + dir(e) * stepOf(e))),
        };
      return null;
    },
  );
  if (!S.decay && S.sustain)
    handle(
      'sustain',
      S.sustain,
      (q) => [(q.xa + q.xs) / 2, q.ys],
      (dx, dy, at, f) => ({
        [S.sustain.key]: snap(S.sustain, val(S.sustain, pos(S.sustain, at[S.sustain.key]) - (dy / (BOT - TOP)) * f)),
      }),
      (e) =>
        dir(e)
          ? {
              [S.sustain.key]: snap(S.sustain, val(S.sustain, pos(S.sustain, cur[S.sustain.key]) + dir(e) * stepOf(e))),
            }
          : null,
    );
  handle(
    'release',
    S.release,
    (q) => [q.xr, BOT],
    (dx, dy, at, f) => ({ [S.release.key]: nudgeX(S.release, at, dx, f) }),
    (e) =>
      dir(e)
        ? { [S.release.key]: snap(S.release, val(S.release, pos(S.release, cur[S.release.key]) + dir(e) * stepOf(e))) }
        : null,
  );
  const mid = (a, b) => (a + b) / 2;
  for (const [k, place] of [
    ['attack', (q) => [mid(q.x0, q.xa), mid(BOT, TOP)]],
    ['decay', (q) => [mid(q.xa, q.xd), mid(TOP, q.ys)]],
    ['release', (q) => [mid(q.xs, q.xr), mid(q.ys, BOT)]],
  ]) {
    const sp = C[k];
    if (!sp) continue;
    handle(
      k + 'curve',
      sp,
      place,
      (dx, dy, at, f) => ({ [sp.key]: snap(sp, val(sp, pos(sp, at[sp.key]) - (dy / (BOT - TOP)) * f)) }),
      (e) =>
        e.key === 'ArrowUp' || e.key === 'ArrowDown'
          ? { [sp.key]: snap(sp, val(sp, pos(sp, cur[sp.key]) + dir(e) * stepOf(e))) }
          : null,
    );
  }
  draw();
  void keyOf;
  return {
    el,
    get: () => ({ ...cur }),
    set(v = {}) {
      for (const sp of all) if (v[sp.key] != null && Number.isFinite(+v[sp.key])) cur[sp.key] = snap(sp, v[sp.key]);
      draw();
    },
    destroy() {
      el.remove();
    },
  };
}

/* ================================================================ LFO: the shape over two cycles, with where it is now */
const hash01 = (n) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return (x >>> 8) / 16777216;
};
export const SHAPES = {
  sine: (ph) => Math.sin(2 * Math.PI * ph),
  tri: (ph) => 1 - 4 * Math.abs(((ph + 0.25) % 1) - 0.5),
  saw: (ph) => 2 * (ph % 1) - 1,
  ramp: (ph) => 1 - 2 * (ph % 1),
  square: (ph) => (ph % 1 < 0.5 ? 1 : -1),
  sh: (ph) => hash01(Math.floor(ph * 4)) * 2 - 1, // sample and hold: four steps a cycle, the same every time
};
export function lfo({
  label = 'LFO',
  shape = 'sine',
  depth = null,
  rate = null,
  phase = null,
  width = 200,
  height = 64,
} = {}) {
  ensureCss();
  let o = { shape, depth, rate, phase };
  const fn = () => (typeof o.shape === 'function' ? o.shape : SHAPES[o.shape] || SHAPES.sine);
  let t0 = performance.now();
  const cv = canvas({
    label: `${label}: ${typeof o.shape === 'string' ? o.shape : 'custom'} shape`,
    className: 'pk-lfo-cv',
    animate: () => !!o.rate || !!o.phase,
  });
  cv.set({
    draw: (g, { w, h: hh, now }) => {
      const css2 = getComputedStyle(cv.el);
      const ink = css2.getPropertyValue('--text').trim() || '#f4ead6',
        line = css2.getPropertyValue('--line-2').trim() || '#46413a',
        mark = css2.getPropertyValue('--accent-2').trim() || '#f1dc8a';
      const d = o.depth ? clamp(+o.depth() || 0, 0, 1) : 1,
        f = fn(),
        mid = hh / 2,
        amp = (hh / 2 - 4) * d;
      g.strokeStyle = line;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, mid + 0.5);
      g.lineTo(w, mid + 0.5);
      g.stroke();
      g.strokeStyle = ink;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const y = mid - f((x / w) * 2) * amp;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
      let ph = null;
      if (o.phase) ph = (((+o.phase() || 0) % 1) + 1) % 1;
      else if (o.rate) ph = (((now - t0) / 1000) * (+o.rate() || 0)) % 1;
      if (ph != null) {
        const x = ph * (w / 2),
          y = mid - f(ph) * amp;
        g.fillStyle = mark;
        g.fillRect(x - 3, y - 3, 6, 6);
      }
    },
  });
  const el = h('div.pk-ctl.pk-lfo', h('span.pk-l', h('span.pk-l-t', label)), cv.el);
  el.style.setProperty('--pk-w', width + 'px');
  el.style.setProperty('--pk-h', height + 'px');
  return {
    el,
    set(x = {}) {
      o = { ...o, ...x };
      if ('rate' in x) t0 = performance.now();
      cv.dirty();
    },
    destroy() {
      cv.destroy();
      el.remove();
    },
  };
}

/* ================================================================ meter: a level bar with its peak held a moment */
export function meter({ label = 'Level', read = null, orient = 'h', floor = -60, length = 120 } = {}) {
  ensureCss();
  const st = { peak: floor, rms: floor, hold: floor, holdAt: 0, ariaAt: 0 };
  const el = h(`div.pk-meter.pk-meter-${orient}`, {
    role: 'meter',
    'aria-label': label,
    'aria-valuemin': floor,
    'aria-valuemax': 0,
    'aria-valuenow': floor,
    'aria-valuetext': 'silent',
    style: { [orient === 'h' ? 'width' : 'height']: length + 'px' },
  });
  const cv = canvas({ className: 'pk-meter-cv', animate: true });
  el.append(cv.el);
  const norm = (db) => clamp((db - floor) / -floor, 0, 1);
  cv.set({
    draw: (g, { w, h: hh, now }) => {
      const r = read ? read() : null;
      if (r) {
        st.peak = Number.isFinite(r.peak) ? r.peak : floor;
        st.rms = Number.isFinite(r.rms) ? r.rms : floor;
      }
      if (st.peak >= st.hold || now - st.holdAt > 1200) {
        st.hold = st.peak;
        st.holdAt = now;
      }
      const css2 = getComputedStyle(el),
        ink = css2.getPropertyValue('--text-2').trim() || '#cbc0aa',
        line = css2.getPropertyValue('--line').trim() || '#2f2b25',
        hot = css2.getPropertyValue('--rec').trim() || '#ff4d4d';
      const H = orient === 'h';
      const len = H ? w : hh,
        th = H ? hh : w;
      g.fillStyle = line;
      if (H) g.fillRect(0, 0, w, hh);
      else g.fillRect(0, 0, w, hh);
      const fillTo = (x, color, a = 1) => {
        g.globalAlpha = a;
        g.fillStyle = color;
        if (H) g.fillRect(0, 0, x * len, th);
        else g.fillRect(0, hh - x * len, th, x * len);
        g.globalAlpha = 1;
      };
      fillTo(norm(st.peak), ink, 0.45);
      fillTo(norm(st.rms), ink, 1);
      const hx = norm(st.hold) * len;
      g.fillStyle = st.hold > -0.5 ? hot : ink;
      if (H) g.fillRect(Math.max(0, hx - 2), 0, 2, th);
      else g.fillRect(0, hh - hx, th, 2);
      if (now - st.ariaAt > 500) {
        st.ariaAt = now;
        el.setAttribute('aria-valuenow', String(Math.round(Math.max(floor, st.peak))));
        el.setAttribute('aria-valuetext', st.peak <= floor ? 'silent' : `${Math.round(st.peak)} dB peak`);
      }
    },
  });
  return {
    el,
    destroy() {
      cv.destroy();
      el.remove();
    },
  };
}

/* ================================================================ keys: a piano strip */
const BLACK = new Set([1, 3, 6, 8, 10]);
export function keys({ lo = 48, hi = 84, label = 'Keyboard', onNote = null } = {}) {
  ensureCss();
  const el = h('div.pk-keys', { role: 'group', 'aria-label': label });
  const held = new Map(); // pointerId | 'kb:<p>' -> pitch
  const lit = new Set(); // pitches lit from elsewhere (MIDI, musical typing)
  let focusP = null;
  const keyEl = (p) => el.querySelector(`[data-p="${p}"]`);
  const paint = (p) => {
    const k = keyEl(p);
    if (k) k.classList.toggle('on', [...held.values()].includes(p) || lit.has(p));
  };
  const velOf = (k, y) => {
    const r = k.getBoundingClientRect();
    return clamp(0.3 + 0.7 * ((y - r.top) / Math.max(1, r.height)), 0.2, 1);
  };
  const on = (who, p, v) => {
    const was = held.get(who);
    if (was === p) return;
    if (was != null) off(who);
    held.set(who, p);
    paint(p);
    onNote && onNote(p, v, true);
  };
  const off = (who) => {
    const p = held.get(who);
    if (p == null) return;
    held.delete(who);
    paint(p);
    if (![...held.values()].includes(p)) onNote && onNote(p, 0, false);
  };
  const keyAt = (x, y) => {
    const t = document.elementFromPoint(x, y);
    const k = t && t.closest ? t.closest('.pk-key') : null;
    return k && el.contains(k) ? k : null;
  };
  el.addEventListener('pointerdown', (e) => {
    const k = e.target.closest?.('.pk-key');
    if (!k || e.button > 0) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {
      /* gone */
    }
    on(e.pointerId, +k.dataset.p, velOf(k, e.clientY));
  });
  el.addEventListener('pointermove', (e) => {
    if (!held.has(e.pointerId)) return;
    const k = keyAt(e.clientX, e.clientY);
    if (k && +k.dataset.p !== held.get(e.pointerId)) on(e.pointerId, +k.dataset.p, velOf(k, e.clientY));
  });
  const up = (e) => off(e.pointerId);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  // the keyboard: arrows walk the keys, Enter or Space plays the focused one for as long as it is held
  el.addEventListener('keydown', (e) => {
    const k = e.target.closest?.('.pk-key');
    if (!k) return;
    const p = +k.dataset.p;
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 12, ArrowDown: -12 }[e.key];
    if (d != null) {
      e.preventDefault();
      e.stopPropagation();
      const n = keyEl(clamp(p + d, range.lo, range.hi));
      if (n) {
        setFocus(+n.dataset.p);
        n.focus();
      }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      on('kb:' + p, p, 0.8);
    }
  });
  el.addEventListener('keyup', (e) => {
    const k = e.target.closest?.('.pk-key');
    if (k && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      off('kb:' + k.dataset.p);
    }
  });
  el.addEventListener('focusout', (e) => {
    if (!el.contains(e.relatedTarget)) for (const who of [...held.keys()]) if (String(who).startsWith('kb:')) off(who);
  });
  const setFocus = (p) => {
    focusP = p;
    for (const k of el.querySelectorAll('.pk-key')) k.tabIndex = +k.dataset.p === p ? 0 : -1;
  };
  const range = { lo, hi };
  const build = () => {
    for (const who of [...held.keys()]) off(who);
    const whites = [],
      blacks = [];
    let wi = 0;
    for (let p = range.lo; p <= range.hi; p++) {
      const b = BLACK.has(p % 12);
      const k = h(
        'button.pk-key' + (b ? '.pk-key-b' : '.pk-key-w'),
        { type: 'button', tabindex: -1, dataset: { p: String(p) }, 'aria-label': spokenName(p) },
        !b && p % 12 === 0 ? h('span.pk-key-n', { 'aria-hidden': 'true' }, noteName(p)) : null,
      );
      if (b) {
        k.style.setProperty('--pk-wi', String(wi));
        blacks.push(k);
      } else {
        whites.push(k);
        wi++;
      }
    }
    el.style.setProperty('--pk-whites', String(whites.length));
    el.replaceChildren(h('div.pk-keys-w', whites), ...blacks);
    for (const p of lit) paint(p);
    setFocus(
      focusP != null && focusP >= range.lo && focusP <= range.hi
        ? focusP
        : Math.ceil(range.lo / 12) * 12 + 12 <= range.hi
          ? Math.ceil(range.lo / 12) * 12 + 12
          : range.lo,
    );
  };
  build();
  return {
    el,
    get range() {
      return { ...range };
    },
    setRange(a, b) {
      a = clamp(Math.round(a), 0, 127);
      b = clamp(Math.round(b), a + 11, 127);
      if (a === range.lo && b === range.hi) return;
      range.lo = a;
      range.hi = b;
      build();
    },
    light(p, onOff) {
      if (onOff) lit.add(p);
      else lit.delete(p);
      paint(p);
    },
    clear() {
      for (const who of [...held.keys()]) off(who);
      for (const p of [...lit]) {
        lit.delete(p);
        paint(p);
      }
    },
    held: () => [...new Set(held.values())],
    destroy() {
      for (const who of [...held.keys()]) off(who);
      el.remove();
    },
  };
}

/* ================================================================ styles */
let cssDone = false;
function ensureCss() {
  if (cssDone) return;
  cssDone = true;
  css('plugin-kit', KIT_CSS);
}
const KIT_CSS = `
/* the plugin kit (ui/plugin-kit.js): every control is a column, label over the thing over its readout */
.pk-ctl { position: relative; display: inline-grid; justify-items: center; align-content: start; gap: 5px; min-width: 0; }
.pk-l { display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; font: 600 11px/1.25 var(--font-ui); color: var(--text-2); white-space: nowrap; }
.pk-l-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pk-v { display: block; min-width: calc(var(--pk-vn, 6) * 0.62em); font: 400 12px/1.2 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text); text-align: center; white-space: nowrap; }
.pk-knob { min-width: calc(var(--pk-size, 52px) + 14px); }
.pk-dial { width: var(--pk-size, 52px); height: var(--pk-size, 52px); border-radius: 50%; cursor: ns-resize; touch-action: none; outline: none; }
.pk-dial svg { display: block; width: 100%; height: 100%; overflow: visible; }
.pk-dial:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.pk-trk { fill: none; stroke: var(--line-2); stroke-width: 5; stroke-linecap: butt; }
.pk-val { fill: none; stroke: var(--text); stroke-width: 5; stroke-linecap: butt; }
.pk-mod { fill: none; stroke: var(--accent-2); stroke-width: 3; }
.pk-def { stroke: var(--text-3); stroke-width: 1.5; }
.pk-body { fill: var(--bg-2); stroke: var(--line-2); stroke-width: 1.5; }
.pk-ptr { stroke: var(--text); stroke-width: 4; stroke-linecap: round; }
.pk-turning .pk-body, .pk-dial:hover .pk-body { fill: var(--bg-3); }
/* "auto" in pencil while a lane moves it, "held" in grease pencil while its lane is held: a word, a button */
.pk-am { margin: 0; padding: 0 1px; border: 0; background: none; color: var(--text-3); font: italic 500 10.5px/1.25 var(--font-ui); cursor: pointer; }
.pk-am[data-mark="held"] { color: var(--accent-2); text-decoration: underline; text-underline-offset: 2px; }
.pk-am:hover { color: var(--text); }
.pk-am:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
/* an agent's change: a cool-ink frame that fades (no glow) */
.pk-flash { animation: pk-flash 1.6s var(--ease) both; }
@keyframes pk-flash { 0%, 35% { outline: 1.5px solid var(--agent); outline-offset: 4px; } 100% { outline: 1.5px solid transparent; outline-offset: 4px; } }
/* slider: a hairline track, the filled part in cream, a square cap */
.pk-sl { position: relative; touch-action: none; cursor: ew-resize; outline: none; }
.pk-slider-h .pk-sl { width: 100%; height: 24px; }
.pk-slider-v { grid-template-rows: auto 1fr auto; }
.pk-slider-v .pk-sl { width: 24px; height: 100%; min-height: 80px; cursor: ns-resize; }
.pk-sl-trk { position: absolute; background: var(--line-2); }
.pk-slider-h .pk-sl-trk { left: 0; right: 0; top: 11px; height: 2px; }
.pk-slider-v .pk-sl-trk { top: 0; bottom: 0; left: 11px; width: 2px; }
.pk-sl-fill { position: absolute; background: var(--text); }
.pk-slider-h .pk-sl-fill { left: 0; top: 11px; height: 2px; width: calc(var(--pk-x, 0) * 100%); }
.pk-slider-v .pk-sl-fill { bottom: 0; left: 11px; width: 2px; height: calc(var(--pk-x, 0) * 100%); }
.pk-sl-cap { position: absolute; background: var(--text); border-radius: var(--r-press); }
.pk-slider-h .pk-sl-cap { top: 4px; width: 10px; height: 16px; left: calc(var(--pk-x, 0) * (100% - 10px)); }
.pk-slider-v .pk-sl-cap { left: 4px; width: 16px; height: 10px; bottom: calc(var(--pk-x, 0) * (100% - 10px)); }
.pk-sl:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
/* segmented: a ruled row of words; the one picked in reverse print */
.pk-seg-row { display: inline-flex; flex-wrap: nowrap; }
.pk-seg-b { min-width: 34px; height: 28px; padding: 0 9px; margin-left: -1px; border: var(--rule-2); border-radius: 0; background: none; color: var(--text-2); font: 600 11.5px/1 var(--font-ui); white-space: nowrap; cursor: pointer; }
.pk-seg-b:first-child { margin-left: 0; border-radius: var(--r-press) 0 0 var(--r-press); }
.pk-seg-b:last-child { border-radius: 0 var(--r-press) var(--r-press) 0; }
.pk-seg-b:hover { color: var(--text); }
.pk-seg-b.sel-print, .pk-seg-b.sel-print:hover { position: relative; z-index: 1; background: var(--text); border-color: var(--text); color: var(--bg); }
.pk-seg-b:focus-visible { position: relative; z-index: 2; outline: 2px solid var(--accent-2); outline-offset: 1px; }
.pk-select { height: 28px; max-width: 180px; padding: 0 8px; border: var(--rule-2); border-radius: var(--r-press); background: var(--bg); color: var(--text); font: 600 12px var(--font-ui); cursor: pointer; }
.pk-select:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.pk-tap { grid-template-columns: auto; }
.pk-tap-b { min-width: 56px; }
.pk-tap-r { min-height: 20px; font-size: 11.5px; }
/* XY pad: a ruled square, a cross where it is, a square puck */
.pk-xy-pad { position: relative; border: var(--rule-2); background: var(--bg); touch-action: none; cursor: crosshair; }
.pk-xy-hx, .pk-xy-hy { position: absolute; background: var(--line); pointer-events: none; }
.pk-xy-hx { left: 0; right: 0; height: 1px; top: calc((1 - var(--pk-py, .5)) * 100%); }
.pk-xy-hy { top: 0; bottom: 0; width: 1px; left: calc(var(--pk-px, .5) * 100%); }
.pk-xy-puck { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; left: calc(var(--pk-px, .5) * 100%); top: calc((1 - var(--pk-py, .5)) * 100%); background: var(--text); border-radius: var(--r-press); outline: none; }
.pk-xy-puck:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
/* envelope: the shape in cream over a pencil fill, square handles */
.pk-env-field { position: relative; }
.pk-env-field svg { display: block; overflow: visible; }
.pk-env-line { fill: none; stroke: var(--text); stroke-width: 1.75; }
.pk-env-fill { fill: color-mix(in srgb, var(--text) 8%, transparent); stroke: none; }
.pk-env-base { stroke: var(--line-2); stroke-width: 1; }
.pk-env-h { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; background: var(--text); border-radius: var(--r-press); cursor: grab; touch-action: none; outline: none; }
.pk-env-h.pk-env-c { width: 10px; height: 10px; margin: -5px 0 0 -5px; background: var(--bg); border: 1.5px solid var(--text-2); cursor: ns-resize; }
.pk-env-h:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.pk-env-v { min-width: 0; font-size: 11.5px; color: var(--text-2); }
.pk-cv { display: block; width: 100%; height: 100%; }
.pk-lfo .pk-cv { width: var(--pk-w, 200px); height: var(--pk-h, 64px); }
.pk-meter { display: block; }
.pk-meter-h { height: 6px; }
.pk-meter-v { width: 6px; }
/* keys: white keys in a row, black keys over the joins; pressed is lit cream */
.pk-keys { position: relative; height: 64px; touch-action: none; user-select: none; -webkit-user-select: none; }
.pk-keys-w { display: grid; grid-template-columns: repeat(var(--pk-whites, 22), 1fr); height: 100%; }
.pk-key { margin: 0; padding: 0; border: 0; cursor: pointer; }
.pk-key-w { position: relative; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 4px; background: #d9d0bd; border-right: 1px solid #8f8778; border-radius: 0 0 var(--r-press) var(--r-press); }
.pk-key-w:last-child { border-right: 0; }
.pk-key-b { position: absolute; z-index: 1; top: 0; height: 60%; width: calc(100% / var(--pk-whites, 22) * .62); left: calc(100% / var(--pk-whites, 22) * var(--pk-wi, 0) - 100% / var(--pk-whites, 22) * .31); background: #1c1a16; border: 1px solid #000; border-top: 0; border-radius: 0 0 var(--r-press) var(--r-press); }
.pk-key.on { background: var(--text); }
.pk-key-b.on { background: var(--text-2); }
.pk-key:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; z-index: 2; }
.pk-key-n { font: 600 10px/1 var(--font-mono); color: #4c4336; pointer-events: none; }
.pk-key.on .pk-key-n { color: var(--bg); }
@media (max-width: 900px), (pointer: coarse) {
  .pk-env-h::before, .pk-xy-puck::before { content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
  .pk-key-b { width: calc(100% / var(--pk-whites, 22) * .7); left: calc(100% / var(--pk-whites, 22) * var(--pk-wi, 0) - 100% / var(--pk-whites, 22) * .35); }
}
@media (max-width: 900px) {
  .pk-l, .pk-v, .pk-am, .pk-key-n, .pk-env-v { font-size: 12px; }
  .pk-seg-b { min-height: 44px; min-width: 44px; font-size: 12.5px; }
  .pk-select { height: 44px; font-size: 16px; }
  .pk-tap-b { min-height: 44px; }
  .pk-am { min-height: 24px; }
}
`;
