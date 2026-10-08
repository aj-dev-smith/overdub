// A finger on a control in a place that scrolls (docs/ARCHITECTURE.md, "Phones"): a drag scrolls, and the control moves
// only once it has been held still. The mixer's faders had it first; the faces' knobs (the rack, the Jam room's pedals),
// the device windows' knobs and sliders (Studio A's mic strips) have it too, so a thumb that scrolls never turns a knob.
//
//   holdToMove(el, { name = 'knob', pick(target) -> el, scroller, heldClass = 'ew-held', hintKey })  -> off()
//     el         a control (its own pointer handlers stay as they are: a mouse and a pen never meet this)
//     name       what it is, in the words that say how ("Holding a fader picks it up…")
//     pick       where the touch goes once the control is picked up (the mixer's fader: its cap, so it is picked up where
//                it is and never jumps to the finger); the touched element by default
//     scroller   the box a drag scrolls (both ways); by default the nearest box that scrolls the way the finger goes
//     hintKey    the storage key that says the first hold was explained (once per browser)
//
// How it goes: one listener for the page, in the capture phase, ahead of every control's own. A touch that lands on a
// control never reaches it at once. If it travels 8 px, the box under it scrolls with the finger (by hand: a control's
// touch-action is none) and the control never hears of it; a swipe that scrolled nothing says how to pick the control
// up (not every time). If it stays put for HOLD ms, the control is picked up (outlined in warm ink, a buzz; the first time
// in a browser a toast says what holding does) and gets the touch's pointerdown then, where the finger is, so its own
// drag runs from there (and, held on, its long-press menu).
import { css } from './dom.js';

export const HOLD = 350;
const SLOP = 8;
const HINT = 'overdub:touch-hold-hint';
const gated = new WeakMap(); // control -> options
let gate = null,
  passing = false,
  installed = false,
  toldAt = -1e9;
const ui = () => (typeof window !== 'undefined' ? window.overdub?.ui : null) || null;

export function holdToMove(el, opts = {}) {
  if (!el) return () => {};
  gated.set(el, opts);
  install();
  return () => {
    if (gated.get(el) === opts) gated.delete(el);
  };
}

// the nearest box over el that scrolls along an axis ('x' or 'y') and has somewhere to go
export function scrollerOf(el, axis) {
  for (let p = el?.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (!/(auto|scroll)/.test(axis === 'y' ? cs.overflowY : cs.overflowX)) continue;
    if (axis === 'y' ? p.scrollHeight > p.clientHeight + 1 : p.scrollWidth > p.clientWidth + 1) return p;
  }
  return null;
}

function controlOf(t) {
  for (let n = t; n && n.nodeType === 1; n = n.parentElement) if (gated.has(n)) return n;
  return null;
}
function drop() {
  if (!gate) return;
  clearTimeout(gate.timer);
  gate.ctl.classList.remove(gate.o.heldClass || 'ew-held');
  gate = null;
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  css('ew-touch', CSS);
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (passing || e.pointerType !== 'touch') return;
      const ctl = controlOf(e.target);
      if (!ctl) return;
      // (the control never hears this touch: it gets one when the hold lands)
      e.stopPropagation();
      e.preventDefault();
      drop();
      const o = gated.get(ctl) || {};
      const g = (gate = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        target: e.target,
        ctl,
        o,
        pan: false,
        held: false,
      });
      g.timer = setTimeout(() => {
        if (gate !== g || g.pan || !ctl.isConnected) return;
        g.held = true;
        ctl.classList.add(o.heldClass || 'ew-held');
        try {
          navigator.vibrate?.(12);
        } catch {
          /* no buzz */
        }
        const name = o.name || 'knob',
          key = o.hintKey || HINT;
        let first = false;
        try {
          first = localStorage.getItem(key) !== '1';
          if (first) localStorage.setItem(key, '1');
        } catch {
          first = false;
        }
        if (first)
          ui()?.toast(
            `Holding a ${name} picks it up: keep holding and drag to move it. A drag without holding scrolls.`,
            { ms: 7000 },
          );
        else ui()?.announce?.(`Holding the ${name}: drag to move it.`);
        const to = (typeof o.pick === 'function' && o.pick(g.target)) || g.target;
        passing = true;
        try {
          to.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: g.id,
              pointerType: 'touch',
              isPrimary: true,
              clientX: g.x,
              clientY: g.y,
              button: 0,
              buttons: 1,
            }),
          );
        } finally {
          passing = false;
        }
      }, HOLD);
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      const g = gate;
      if (!g || e.pointerId !== g.id || g.held) return;
      const dx = e.clientX - g.x,
        dy = e.clientY - g.y;
      if (!g.pan && Math.hypot(dx, dy) <= SLOP) return;
      if (!g.pan) {
        g.pan = true;
        clearTimeout(g.timer);
        g.sx = g.o.scroller || scrollerOf(g.ctl, 'x');
        g.sy = g.o.scroller || scrollerOf(g.ctl, 'y');
        g.sl = g.sx ? g.sx.scrollLeft : 0;
        g.st = g.sy ? g.sy.scrollTop : 0;
      }
      e.stopPropagation();
      if (g.sx) g.sx.scrollLeft = g.sl - dx;
      if (g.sy) g.sy.scrollTop = g.st - dy;
    },
    true,
  );
  // a swipe that scrolled nothing was a reach for the control: say how to pick it up (not every time)
  const lift = (e) => {
    const g = gate;
    if (!g || e.pointerId !== g.id) return;
    drop();
    if (g.held || !g.pan || e.type !== 'pointerup') return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) < 16) return;
    const moved = (g.sx && Math.abs(g.sx.scrollLeft - g.sl) > 2) || (g.sy && Math.abs(g.sy.scrollTop - g.st) > 2);
    if (moved) return;
    const now = performance.now();
    if (now - toldAt < 6000) return;
    toldAt = now;
    ui()?.toast(`Hold the ${g.o.name || 'knob'} still for a moment to pick it up, then drag.`, { ms: 4500 });
  };
  window.addEventListener('pointerup', lift, true);
  window.addEventListener('pointercancel', lift, true);
}

const CSS = `
/* a control a finger has picked up (ui/touch.js): outlined in warm ink, the hand's colour, while it is held */
.ew-held { outline: 2px solid var(--human); outline-offset: 2px; }
`;
