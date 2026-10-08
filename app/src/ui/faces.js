// Device faces: the UI of any device, drawn from its def, so nobody writes UI to make a pedal. The Guitar Studio's
// procedural pedal faces (clawd-o-matic's pedalboard.js) and its amps (ampui.js), vendored verbatim (looks.gen.js) and
// drawn here for ANY def: the ported pedals and amps, Overdub's own devices, and ones an agent wrote with a partial
// look or none (the gaps are picked from a hash of the id, so two devices don't look alike).
//
//   renderFace(def, values, { on, onParam(key, value, { commit }), onToggle(on), onMenu(key, anchor, event), size:
//     'full' | 'compact', by }) -> { el, widgets, update(values, on), mark(key, 'auto' | 'held' | null, { note, title,
//     label, onClick }), meter(level 0..1), destroy() }
//   Automation (docs/research/AUTOMATION.md 3.6): onMenu opens a control's menu on right-click, a long press on touch
//   or the menu key; mark() writes "auto" or "held" beside a control (a button: onClick) and puts note in its title.
//
//   effects      a stompbox: shape box | wide | mini | round | wah | rack, finish flat | sparkle | brushed | hammer |
//                stripe | check, knobs black | chicken | cream | chrome | small, label script | block | plate | stencil,
//                an LED, a footswitch (onToggle), a treadle (look.treadle), a second footswitch (look.foot2)
//   cat 'amp'    an amp: its look (look.amp, else its style's, else one picked by hash), its knobs on the panel, the
//                power switch (onToggle); params with group 'cab' (cab and mics) in a strip under it
//   instruments  a synth panel: wood cheeks, the name, knobs and switches, a little keyboard
// Knobs: drag up/down (Shift: fine), wheel, arrow keys / PageUp / PageDown / Home / End, double-click resets to the
// default; an ARIA slider whose valuetext is the param's fmt (or its unit); log travel for curve: 'log'; the value pops
// up on hover and while turning. onParam fires with { commit: false } while dragging and { commit: true } when a gesture
// ends (pointer up, a key, a reset, the wheel settling). Switches are levers (2-3 options) or a little menu (more).
// A finger (ui/touch.js): a drag that starts on a knob scrolls whatever the face sits in (the rack, the Jam room); the
// knob turns only once it has been held still for a moment. A lever is a button: a swipe from it scrolls as any does.
// A device written by someone other than Overdub or clawd-o-matic wears a badge with its author (an agent's in --agent).
// A param with face: false stays off the face (it lives in the device's window). A studio device may draw a screen on
// its stompbox or rack: def.screen(ctx2d, { w, h, ink, dim }, values), a function, so never a song's (JSON) device's.
import { evaluate as evalLooks } from '../devices/guitar/looks.gen.js';
import { normParam } from '../devices/registry.js';
import { toPos, fromPos } from '../core/automation.js';
import { holdToMove } from './touch.js';

let dom = null;
try {
  dom = await import('./dom.js');
} catch (e) {
  dom = null;
} // FALLBACK until ui/dom.js lands: inject <style> here

const FONTS = { dirt: '"Rubik Dirt", Impact, "Arial Black", sans-serif', pixel: 'Silkscreen, ui-monospace, monospace' };
const LOOKS = evalLooks({ FONTS, PLUG_AMPS: {} });
export const FACE_LOOKS = LOOKS.PEDAL_LOOKS;
export const AMP_LOOK_IDS = Object.keys(LOOKS.AMP_LOOKS).filter((k) => k !== 'generic');

/* ---- small helpers */
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch],
  );
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function hashId(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
const hex = (h, s, l) => {
  s /= 100;
  l /= 100;
  const f = (n) => {
    const k = (n + h / 30) % 12,
      a = s * Math.min(l, 1 - l),
      c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
};
const lum = (c) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})/i.exec(c || '');
  if (!m) return 0.5;
  let x = m[1];
  if (x.length === 3)
    x = x
      .split('')
      .map((ch) => ch + ch)
      .join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(x.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const isHex = (c) => /^#[0-9a-f]{3,8}$/i.test(c || '');
// An enclosure colour and its ink for a def that didn't pick: from a hash of its id (an agent's pedal still has charm)
export function colorsOf(def) {
  const L = def.look || {},
    h = hashId(def.id || def.name || 'device');
  const color = isHex(L.color)
    ? L.color
    : isHex(def.color)
      ? def.color
      : hex(h % 360, 48 + ((h >>> 9) % 30), 34 + ((h >>> 15) % 26));
  const ink = isHex(L.ink) ? L.ink : isHex(def.ink) ? def.ink : lum(color) > 0.28 ? '#16141a' : '#fbf6ec';
  return { color, ink };
}
const AUTHORS = { you: 'You', claude: 'Claude' };
export function authorName(by) {
  if (!by) return '';
  if (AUTHORS[by]) return AUTHORS[by];
  if (by.startsWith('mcp:')) return by.slice(4);
  return by;
}

/* ---- params: normalised, with a readout */
// (face: false keeps a param off the face: a device with more controls than a face holds plays them in its window)
function params(def) {
  return (def.params || def.knobs || []).map(normParam).filter((p) => !p.hidden && p.face !== false);
}
const kindOfParam = (p) => (p.opts ? 'switch' : p.tap ? 'tap' : 'knob');
const decimals = (q) => (q >= 1 ? 0 : q >= 0.1 ? 1 : q >= 0.01 ? 2 : 3);
const quantum = (p) => p.step || (Math.abs(p.max - p.min) >= 5 ? 0.1 : Math.abs(p.max - p.min) / 200);
export function valueText(p, v) {
  if (p.opts) return String(p.opts[clamp(Math.round(v), 0, p.opts.length - 1)] ?? '');
  if (typeof p.fmt === 'function') {
    try {
      const s = p.fmt(v);
      if (s != null) return String(s);
    } catch (e) {
      /* its own business */
    }
  }
  const d = decimals(quantum(p)),
    n = (x, k = d) => (+x).toFixed(k);
  switch (p.unit) {
    case 'Hz':
      return v >= 1000 ? n(v / 1000, v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
    case 'dB':
      return (v > 0 ? '+' : '') + n(v, 1) + ' dB';
    case 'ms':
      return v >= 1000 ? n(v / 1000, 2) + ' s' : Math.round(v) + ' ms';
    case 's':
      return n(v, v < 10 ? 2 : 1) + ' s';
    case '%':
      return Math.round(v) + '%';
    case 'st':
      return (v > 0 ? '+' : v < 0 ? '−' : '') + n(Math.abs(v), d) + ' st';
    case 'x':
      return n(v, 2) + '×';
    case 'note': {
      const N = ['1/16', '1/8', '1/8.', '1/4', '1/4.', '1/2'];
      return N[clamp(Math.round(v), 0, N.length - 1)];
    }
    default:
      return n(v);
  }
}
// knob travel 0..1 <-> value: core/automation.js's (log for curve: 'log' over a positive range), the same travel a
// lane is drawn and played in, so a straight line on a lane is a straight turn of the knob
const logOk = (p) => p.curve === 'log' && p.min > 0 && p.max > p.min;
function snap(p, v) {
  v = clamp(v, Math.min(p.min, p.max), Math.max(p.min, p.max));
  if (p.step) return Math.round((v - p.min) / p.step) * p.step + p.min;
  if (logOk(p)) {
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, v))) - 2);
    return Math.round(v / mag) * mag;
  }
  const q = quantum(p);
  return +(Math.round(v / q) * q).toFixed(6);
}

// the most characters a knob's readout shows anywhere on its travel (its ends, its default and 32 steps between): the
// room its column keeps, so a readout never runs into the next knob's
export function widestReadout(p) {
  let n = 0;
  const see = (v) => {
    if (Number.isFinite(v)) n = Math.max(n, valueText(p, snap(p, v)).length);
  };
  see(p.min);
  see(p.max);
  see(p.def);
  for (let i = 0; i <= 32; i++) see(fromPos(p, i / 32));
  return n;
}

/* ---- automation on a control (docs/research/AUTOMATION.md 3.6): a mark beside it and a menu on it */
// The mark: "auto" in pencil while a lane moves the param, "held" in grease pencil while its lane is held. Both are
// words on the room's ground (they have to read on any enclosure), square, no glow; each is a button (auto: show the
// lane; held: back to the lane). setMark(w, null) takes it off.
function setMark(w, state, { title = '', label = '', onClick = null } = {}) {
  let m = w.querySelector(':scope > .ewf-am');
  if (!state) {
    if (m) m.remove();
    delete w.dataset.auto;
    w.classList.remove('ewf-marked');
    return;
  }
  if (!m) {
    m = document.createElement('button');
    m.type = 'button';
    m.className = 'ewf-am';
    m.addEventListener('pointerdown', (e) => e.stopPropagation());
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      m._click && m._click(e);
    });
    w.appendChild(m);
  }
  w.classList.add('ewf-marked');
  w.dataset.auto = state;
  m.dataset.mark = state;
  m.textContent = state;
  m.title = title;
  m.setAttribute('aria-label', label || title || state);
  m._click = onClick;
}
// The menu on a control: right-click, a long press on touch (held still for LONG_MS), or the context-menu key /
// Shift+F10 while it has focus. A long press ends the control's own gesture first (the 'ewf-longpress' event), and
// the click that follows the finger lifting is swallowed.
const LONG_MS = 520;
function wireMenu(w, target, open) {
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
        w.dispatchEvent(new CustomEvent('ewf-longpress'));
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

/* ---- the knob (clawd-o-matic's plugKnob, the same markup, so the vendored styles dress it) */
function makeKnob(p, value, { name, onInput }) {
  const w = document.createElement('div');
  w.className = 'kn';
  w.dataset.key = p.key;
  w.innerHTML = `<div class="kn-dial" role="slider" tabindex="0" aria-label="${esc((name ? name + ' ' : '') + p.label.toLowerCase())}" aria-valuemin="${p.min}" aria-valuemax="${p.max}"><div class="kn-cap"><i></i></div></div><span class="kn-l">${esc(p.label)}</span><output class="kn-v"></output><span class="kn-tip" aria-hidden="true"></span>`;
  const dial = w.firstChild,
    cap = dial.firstChild,
    out = w.querySelector('.kn-v'),
    tip = w.querySelector('.kn-tip');
  w.style.setProperty('--kvn', String(widestReadout(p))); // (the room its readout keeps: see the faces' CSS)
  const baseTitle =
    (p.desc ? p.desc + '. ' : '') +
    'Drag up or down (Shift: fine), scroll, or use the arrow keys. Double-click: back to ' +
    valueText(p, p.def);
  dial.title = baseTitle;
  let v = snap(p, value);
  // (automation: w.dataset.auto is 'auto' or 'held'; w.autoNote what the dial's title adds)
  const draw = () => {
    const x = clamp(toPos(p, v), 0, 1),
      t = valueText(p, v),
      a = w.dataset.auto;
    cap.style.transform = `rotate(${(-135 + 270 * x).toFixed(1)}deg)`;
    w.style.setProperty('--kv', x.toFixed(3));
    dial.setAttribute('aria-valuenow', +v.toFixed(6));
    dial.setAttribute('aria-valuetext', a === 'auto' ? `${t}, follows its lane` : a === 'held' ? `${t}, held` : t);
    out.textContent = t;
    tip.textContent = a ? `${t} · ${a}` : t;
  };
  const put = (x, commit) => {
    x = snap(p, x);
    if (x === v) {
      if (commit) onInput(v, true);
      return;
    }
    v = x;
    draw();
    onInput(v, commit);
  };
  let drag = null,
    wheelT = 0;
  dial.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = {
      x: e.clientX,
      y: e.clientY,
      pos: toPos(p, v),
      fine: e.shiftKey,
      moved: false,
      touch: e.pointerType === 'touch',
    };
    dial.setPointerCapture(e.pointerId);
    dial.focus({ preventScroll: true });
    w.classList.add('drag');
    e.preventDefault();
  });
  dial.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (e.shiftKey !== drag.fine)
      drag = { x: e.clientX, y: e.clientY, pos: toPos(p, v), fine: e.shiftKey, moved: drag.moved, touch: drag.touch }; // (Shift mid-drag: fine from here, no jump)
    // a finger travels half as far per pixel as a mouse: 300 px sweeps the range by touch, 150 by mouse
    let px = e.clientX - drag.x - (e.clientY - drag.y);
    // a finger rests still for a long press (the menu): nothing turns until it has moved 8 px, then from there
    if (drag.touch && !drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= 8) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      px = 0;
    }
    const span = (drag.fine ? 600 : 150) * (drag.touch ? 2 : 1);
    if (Math.abs(px) > 1 || drag.touch) drag.moved = true;
    if (!drag.moved || !px) return; // (a click's 1 px of jitter turns nothing, and so holds no lane)
    put(fromPos(p, drag.pos + px / span), false);
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    w.classList.remove('drag');
    if (moved) onInput(v, true);
  };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener('lostpointercapture', end);
  w.addEventListener('ewf-longpress', () => {
    drag = null;
    w.classList.remove('drag');
  });
  holdToMove(dial, { name: 'knob' });
  dial.addEventListener('dblclick', () => put(p.def, true));
  dial.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = -(e.deltaY || e.deltaX) / (e.shiftKey ? 2400 : 600);
      put(
        p.step && Math.abs(fromPos(p, toPos(p, v) + d) - v) < p.step
          ? v + Math.sign(d) * p.step
          : fromPos(p, toPos(p, v) + d),
        false,
      );
      clearTimeout(wheelT);
      wheelT = setTimeout(() => onInput(v, true), 280);
    },
    { passive: false },
  );
  dial.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const big = { PageUp: 1, PageDown: -1 }[e.key],
      small = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (small != null || big != null) {
      e.preventDefault();
      if (p.step && (p.max - p.min) / p.step <= 40)
        put(v + (small || big * Math.max(1, Math.round((p.max - p.min) / p.step / 10))) * p.step, true);
      else put(fromPos(p, toPos(p, v) + (small != null ? small * (e.shiftKey ? 0.002 : 0.01) : big * 0.1)), true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      put(p.min, true);
    } else if (e.key === 'End') {
      e.preventDefault();
      put(p.max, true);
    }
  });
  draw();
  w.setValue = (x) => {
    if (drag) return;
    v = snap(p, x);
    draw();
  };
  w.redraw = () => {
    dial.title = w.autoNote ? `${w.autoNote}. ${baseTitle}` : baseTitle;
    draw();
  };
  w.menuTarget = dial;
  return w;
}

/* ---- a switch: a bat lever for 2-3 options (clawd-o-matic's), a little menu for more */
function makeSwitch(p, value, { name, onInput }) {
  const w = document.createElement('div');
  const n = p.opts.length;
  if (n > 3) {
    w.className = 'ms ewf-menu';
    w.dataset.key = p.key;
    w.innerHTML = `<span class="ms-l">${esc(p.label)}</span><select aria-label="${esc((name ? name + ' ' : '') + p.label.toLowerCase())}">${p.opts.map((o, i) => `<option value="${i}">${esc(o)}</option>`).join('')}</select>`;
    const s = w.querySelector('select');
    s.value = String(Math.round(value));
    s.addEventListener('change', () => onInput(+s.value, true));
    w.setValue = (x) => {
      s.value = String(clamp(Math.round(x), 0, n - 1));
    };
    w.menuTarget = s;
    return w;
  }
  w.className = 'ms';
  w.dataset.key = p.key;
  w.innerHTML = `<span class="ms-l">${esc(p.label)}</span><button type="button" class="ms-b" role="slider" aria-label="${esc((name ? name + ' ' : '') + p.label.toLowerCase())}" aria-valuemin="0" aria-valuemax="${n - 1}"><i></i></button><span class="ms-o"></span>`;
  const b = w.querySelector('.ms-b'),
    o = w.querySelector('.ms-o');
  let v = clamp(Math.round(value), 0, n - 1);
  const draw = () => {
    const a = n < 2 ? 0 : -32 + (64 * v) / (n - 1);
    w.style.setProperty('--ma', a + 'deg');
    b.setAttribute('aria-valuenow', v);
    b.setAttribute('aria-valuetext', p.opts[v]);
    o.textContent = p.opts[v];
  };
  const put = (x) => {
    x = clamp(x, 0, n - 1);
    if (x === v) return;
    v = x;
    draw();
    onInput(v, true);
  };
  b.addEventListener('click', () => put(v >= n - 1 ? 0 : v + 1));
  b.addEventListener('keydown', (e) => {
    if (e.altKey) return;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d != null) {
      e.preventDefault();
      put(v + d);
    } else if (e.key === 'Home') {
      e.preventDefault();
      put(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      put(n - 1);
    }
  });
  draw();
  w.setValue = (x) => {
    v = clamp(Math.round(x), 0, n - 1);
    draw();
  };
  w.cycle = () => put(v >= n - 1 ? 0 : v + 1);
  w.menuTarget = b;
  return w;
}

/* ---- a tap-tempo button (clawd-o-matic's pedalTap): tap in time; its value is that tempo, 0 follows the song */
function makeTap(p, value, { name, onInput }) {
  const w = document.createElement('div');
  w.className = 'tp';
  w.dataset.key = p.key;
  w.innerHTML = `<button type="button" class="tp-b" aria-label="${esc((name ? name + ' ' : '') + 'tap tempo')}">${esc(p.label)}</button><button type="button" class="tp-r" title="Tapped: click to follow the song's tempo again"></button>`;
  const b = w.firstChild,
    r = w.lastChild;
  let v = +value || 0,
    taps = [];
  const draw = () => {
    const on = v >= 40;
    r.textContent = on ? Math.round(v) + ' BPM' : 'SONG';
    r.disabled = !on;
    w.classList.toggle('on', on);
    r.setAttribute('aria-label', on ? `tapped ${Math.round(v)} bpm: follow the song instead` : 'following the song');
  };
  b.addEventListener('pointerdown', (e) => {
    const now = e.timeStamp || performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    if (taps.length > 5) taps.shift();
    w.classList.remove('hit');
    void w.offsetWidth;
    w.classList.add('hit');
    if (taps.length < 2) return;
    const gap = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    v = clamp(Math.round(600000 / gap) / 10, 40, 300);
    draw();
    onInput(v, true);
  });
  b.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
  });
  r.addEventListener('click', () => {
    if (v < 40) return;
    v = 0;
    taps = [];
    draw();
    onInput(0, true);
  });
  draw();
  w.setValue = (x) => {
    v = +x || 0;
    draw();
  };
  w.menuTarget = b;
  return w;
}

function makeControl(p, value, ctx) {
  const k = kindOfParam(p);
  return k === 'switch' ? makeSwitch(p, value, ctx) : k === 'tap' ? makeTap(p, value, ctx) : makeKnob(p, value, ctx);
}

/* ---- the author's byline: "by Claude" under the face, the name in cool (an agent) or warm (a person) ink, no
   pill, no glow (design/LINER-NOTES-KIT.md). The house (and clawd-o-matic's vendored pedals) is unsigned. */
function badge(by) {
  if (!by || by === 'overdub' || by === 'clawd') return null;
  const id = String(by),
    a = dom && dom.authorOf ? dom.authorOf(id) : null;
  const human = a ? a.kind !== 'agent' : id === 'you' || id.startsWith('guest:');
  const name = id === 'you' ? 'you' : a ? a.name : authorName(id);
  const b = document.createElement('p');
  b.className = 'ewf-by';
  const n = document.createElement('span');
  n.className = 'ewf-by-name ' + (human ? 'ewf-by-human' : 'ewf-by-agent'); // (not .by: a card that signs its own name line counts one .by)
  n.dataset.by = id;
  n.textContent = name;
  b.append('by ', n);
  b.title = id === 'you' ? 'You made this device' : `Written by ${name}${human ? '' : ' (an agent)'}`;
  return b;
}

/* ---- which face */
export function faceKind(def) {
  const L = def.look || {};
  if (def.cat === 'amp' || L.amp || L.face === 'amp') return 'amp';
  if (def.kind === 'instrument') return 'synth';
  return 'pedal';
}

// The stompbox look for any effect: the def's look with the gaps filled (clawd-o-matic's pedalLook, then Overdub's
// rules for devices with more knobs than a stompbox holds)
export function pedalLookOf(def, ps = params(def)) {
  const shim = {
    id: def.id || 'device',
    look: def.look || {},
    knobs: ps.map((p) => ({ key: p.key, type: kindOfParam(p) })),
  };
  const L = LOOKS.pedalLook(shim);
  if (ps.length > 6 && L.shape !== 'rack') L.shape = 'rack';
  return L;
}

/* ---- a stompbox */
function pedalFace(def, vals, o, ps) {
  const L = pedalLookOf(def, ps),
    { color, ink } = colorsOf(def),
    name = def.name || def.id;
  const root = document.createElement('div');
  root.className = 'ewf ewf-pedal' + (o.size === 'compact' ? ' ewf-compact' : '');
  const d = document.createElement('div');
  d.className = `pd pd-${L.shape} fin-${L.finish} ks-${L.knob} lb-${L.label}`;
  d.dataset.device = def.id;
  d.style.setProperty('--pc', color);
  d.style.setProperty('--pi', ink);
  d.style.setProperty('--led', L.led);
  const knobs = ps.filter((p) => p.key !== L.treadle);
  const kind = def.kindLabel || def.kind_label || (def.cat ? String(def.cat).toUpperCase() : 'EFFECT');
  d.innerHTML =
    `<span class="pd-led" aria-hidden="true"></span>${L.treadle ? '<div class="pd-tread"></div>' : ''}<div class="pd-knobs" data-n="${knobs.length}"></div>` +
    `<div class="pd-name"><b>${esc(name)}</b><small>${esc(kind)}</small></div>` +
    `<div class="pd-feet"><button type="button" class="pd-sw" title="Stomp: on / off"></button></div>`;
  // (a rack unit is as wide as its knobs' columns need, its readouts' room included, and never narrower than it was)
  if (knobs.length > 6) {
    const cols = Math.min(6, Math.ceil(knobs.length / 2));
    const box = d.querySelector('.pd-knobs');
    box.style.setProperty('--kc', cols);
    box.style.setProperty('--kb', '28px');
    d.style.width = 'max-content';
    d.style.minWidth = 150 + cols * 46 + 'px';
  }
  root.appendChild(d);
  const widgets = {};
  for (const p of ps) {
    const el = makeControl(p, vals[p.key], {
      name,
      onInput: (v, commit) => {
        vals[p.key] = v;
        o.onParam && o.onParam(p.key, v, { commit });
      },
    });
    if (p.key === L.treadle) {
      el.classList.add('kn-tread');
      d.querySelector('.pd-tread').appendChild(el);
    } else d.querySelector('.pd-knobs').appendChild(el);
    widgets[p.key] = el;
  }
  // a studio device that draws its own screen (def.screen, a function: never a song's, which is JSON) shows it over its
  // knobs: def.screen(ctx2d, { w, h, ink, dim }, values) with every param's value, redrawn when they change
  let screen = null;
  if (typeof def.screen === 'function') {
    const cv = document.createElement('canvas');
    cv.className = 'pd-screen';
    cv.setAttribute('aria-hidden', 'true');
    d.classList.add('pd-has-screen');
    d.insertBefore(cv, d.firstChild);
    const all = { ...(o.values || vals) };
    const draw = () => {
      const w = cv.clientWidth,
        hh = cv.clientHeight;
      if (!w || !hh) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(hh * dpr);
      }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hh);
      try {
        def.screen(g, { w, h: hh, ink: color, dim: 'rgba(244, 234, 214, 0.14)' }, all);
      } catch (e) {
        console.error('faces: a screen failed to draw', def.id, e);
      }
    };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
    ro?.observe(cv);
    screen = {
      draw: (next) => {
        if (next) Object.assign(all, next);
        draw();
      },
      stop: () => ro?.disconnect(),
    };
  }
  const sw = d.querySelector('.pd-sw');
  if (L.foot2 && widgets[L.foot2]) {
    const p = ps.find((q) => q.key === L.foot2),
      b = document.createElement('button');
    b.type = 'button';
    b.className = 'pd-sw pd-sw2';
    b.title = p.label;
    b.innerHTML = `<small>${esc(p.label)}</small>`;
    b.setAttribute('aria-label', `${name} ${p.label.toLowerCase()}: next`);
    b.addEventListener('click', () => widgets[L.foot2].cycle && widgets[L.foot2].cycle());
    d.querySelector('.pd-feet').appendChild(b);
  }
  const kindWord = String(kind)
    .toLowerCase()
    .replace(/ · .*$/, '');
  sw.addEventListener('click', () => o.onToggle && o.onToggle(!state.on));
  if (!o.onToggle) {
    sw.disabled = true;
    sw.title = '';
  }
  const state = { on: true };
  const setOn = (on) => {
    state.on = !!on;
    d.classList.toggle('on', state.on);
    sw.setAttribute('aria-pressed', state.on);
    sw.setAttribute('aria-label', `${name} (${kindWord}) ${state.on ? 'on' : 'off'}`);
  };
  setOn(o.on !== false);
  const by = badge(o.by || def.by);
  if (by) root.appendChild(by);
  root.title = [def.blurb, def.nod ? `Tips its hat to ${def.nod}.` : ''].filter(Boolean).join(' ');
  return {
    el: root,
    widgets,
    setOn,
    screen,
    meter(l) {
      d.style.setProperty('--lv', clamp(+l || 0, 0, 1).toFixed(2));
    },
  };
}

/* ---- an amp */
function ampLookId(def) {
  const L = def.look || {},
    A = LOOKS.AMP_LOOKS;
  if (L.amp && A[L.amp]) return L.amp;
  if (def.amp && A[def.amp]) return def.amp;
  const st = L.style || def.style;
  if (st && LOOKS.AMP_STYLE_LOOK[st]) return LOOKS.AMP_STYLE_LOOK[st];
  return AMP_LOOK_IDS[hashId(def.id || 'amp') % AMP_LOOK_IDS.length];
}
function ampFace(def, vals, o, ps) {
  const name = def.name || def.id,
    look = ampLookId(def);
  const root = document.createElement('div');
  root.className = 'ewf ewf-ampface' + (o.size === 'compact' ? ' ewf-compact' : '');
  const maker = def.by === 'clawd' ? 'CLAWD-O-TONE' : 'OVERDUB';
  root.innerHTML = `<div class="amps"><div class="amp">
      <i class="amp-handle" aria-hidden="true"></i>
      <div class="amp-top">
        <div class="amp-strip" aria-hidden="true"><span class="amp-lgw"><span class="amp-lg"></span></span></div>
        <div class="amp-panel">
          <span class="amp-jacks" aria-hidden="true"><i></i><i></i><small>INPUT</small></span>
          <div class="amp-knobs" role="group" aria-label="${esc(name)} controls"></div>
          <span class="amp-vu" aria-hidden="true"><span class="amp-vu-face"><i class="amp-vu-n"></i></span><small>DRIVE</small></span>
          <span class="amp-jewel" aria-hidden="true"></span>
          <button class="amp-pwr" type="button" aria-pressed="false" title="Power: in the chain or bypassed"><i></i><small>POWER</small></button>
        </div>
      </div>
      <div class="amp-cab" aria-hidden="true">
        <div class="amp-grille"><i class="amp-glow"></i><span class="amp-cones"><i></i><i></i><i></i><i></i></span><i class="amp-face"><i class="af-a"></i><i class="af-b"></i></i><span class="amp-lgw"><span class="amp-lg"></span></span><span class="amp-maker">${maker}</span><i class="amp-stk"></i></div>
      </div>
      <i class="amp-feet" aria-hidden="true"></i>
    </div></div>`;
  const amps = root.firstChild,
    amp = amps.firstChild;
  LOOKS.ampPaint(amp, look);
  for (const el of amp.querySelectorAll('.amp-lg')) el.textContent = name;
  const panel = ps.filter((p) => p.group !== 'cab'),
    rest = ps.filter((p) => p.group === 'cab');
  const widgets = {};
  const onInput = (p) => (v, commit) => {
    vals[p.key] = v;
    if (p.key === 'gain' || p.role === 'drive') dial();
    o.onParam && o.onParam(p.key, v, { commit });
  };
  const knobsEl = amp.querySelector('.amp-knobs');
  for (const p of panel) {
    const el = makeControl(p, vals[p.key], { name, onInput: onInput(p) });
    if (el.classList.contains('kn')) el.querySelector('.kn-l').dataset.picto = LOOKS.AMP_PICTO[p.key] || '';
    knobsEl.appendChild(el);
    widgets[p.key] = el;
  }
  const drive = panel.find((p) => p.key === 'gain') || panel.find((p) => p.role === 'drive');
  const dial = () => {
    if (drive) amp.style.setProperty('--dial', (6 + 88 * clamp(toPos(drive, vals[drive.key]), 0, 1)).toFixed(1) + '%');
  };
  dial();
  // the cab and mics: a strip under the amp, in Overdub's chrome
  if (rest.length && o.size !== 'compact') {
    const strip = document.createElement('div');
    strip.className = 'ewf-cabstrip';
    strip.innerHTML = `<span class="ewf-cabstrip-h">Cab &amp; mics</span><div class="ewf-cabstrip-k ks-small"></div>`;
    for (const p of rest) {
      const el = makeControl(p, vals[p.key], { name, onInput: onInput(p) });
      strip.lastChild.appendChild(el);
      widgets[p.key] = el;
    }
    root.appendChild(strip);
  }
  const pwr = amp.querySelector('.amp-pwr'),
    jewel = amp.querySelector('.amp-jewel'),
    needle = amp.querySelector('.amp-vu-n');
  pwr.addEventListener('click', () => o.onToggle && o.onToggle(!state.on));
  if (!o.onToggle) pwr.disabled = true;
  const state = { on: true, lvl: null };
  const meter = (l) => {
    state.lvl = l == null ? null : clamp(+l || 0, 0, 1);
    const lv = state.lvl == null ? (drive ? 0.35 + 0.5 * clamp(toPos(drive, vals[drive.key]), 0, 1) : 0.6) : state.lvl;
    jewel.style.setProperty('--lv', (state.on ? 0.35 + 0.65 * lv : 0).toFixed(2));
    needle.style.transform = `rotate(${state.on ? Math.round((-48 + 96 * Math.min(1, lv * 1.1)) * 2) / 2 : -48}deg)`;
  };
  const setOn = (on) => {
    state.on = !!on;
    amps.classList.toggle('on', state.on);
    pwr.setAttribute('aria-pressed', state.on);
    pwr.setAttribute('aria-label', `${name}: ${state.on ? 'on (bypass it)' : 'bypassed (switch it on)'}`);
    meter(state.lvl);
  };
  setOn(o.on !== false);
  const by = badge(o.by || def.by);
  if (by) root.appendChild(by);
  root.title = [def.blurb, def.nod ? `In the spirit of ${def.nod}.` : ''].filter(Boolean).join(' ');
  return {
    el: root,
    widgets,
    setOn,
    meter,
    after: () => {
      dial();
      meter(state.lvl);
    },
  };
}

/* ---- an instrument: a synth panel */
function synthFace(def, vals, o, ps) {
  const name = def.name || def.id,
    { color, ink } = colorsOf(def),
    L = def.look || {},
    h = hashId(def.id || name);
  const knob = FACE_LOOKS.knob.includes(L.knob) ? L.knob : ['chrome', 'black', 'cream', 'chicken'][(h >>> 5) % 4];
  const wood = ['#7a4a2a', '#5a3620', '#8f5b33', '#3b2a1f'][(h >>> 11) % 4];
  const root = document.createElement('div');
  root.className = 'ewf ewf-synth' + (o.size === 'compact' ? ' ewf-compact' : '');
  const kind = def.kindLabel || (def.cat ? String(def.cat).toUpperCase() : 'INSTRUMENT');
  root.innerHTML = `<div class="sy ks-${knob}" style="--pc:${color};--pi:${ink};--wood:${wood};--led:${isHex(L.led) ? L.led : '#7dffb8'}">
    <div class="sy-head"><span class="sy-led" aria-hidden="true"></span><b class="sy-name">${esc(name)}</b><small class="sy-kind">${esc(kind)}</small></div>
    <div class="sy-knobs pd-knobs" data-n="${Math.min(ps.length, 6)}"></div>
    <div class="sy-keys" aria-hidden="true">${'<i></i>'.repeat(15)}</div></div>`;
  const sy = root.firstChild,
    box = sy.querySelector('.sy-knobs');
  const cols = ps.length <= 4 ? Math.max(1, ps.length) : ps.length <= 8 ? 4 : Math.min(8, Math.ceil(ps.length / 2));
  sy.style.setProperty('--kc', cols);
  const widgets = {};
  for (const p of ps) {
    const el = makeControl(p, vals[p.key], {
      name,
      onInput: (v, commit) => {
        vals[p.key] = v;
        o.onParam && o.onParam(p.key, v, { commit });
      },
    });
    box.appendChild(el);
    widgets[p.key] = el;
  }
  const by = badge(o.by || def.by);
  if (by) root.appendChild(by);
  const state = { on: true };
  const setOn = (on) => {
    state.on = on !== false;
    sy.classList.toggle('on', state.on);
  };
  setOn(o.on);
  root.title = [def.blurb, def.nod ? `Tips its hat to ${def.nod}.` : ''].filter(Boolean).join(' ');
  return {
    el: root,
    widgets,
    setOn,
    meter(l) {
      sy.style.setProperty('--lv', clamp(+l || 0, 0, 1).toFixed(2));
    },
  };
}

/* ---- the face */
export function renderFace(def, values = {}, opts = {}) {
  ensureCss();
  const ps = params(def);
  const vals = {};
  for (const p of ps) vals[p.key] = values[p.key] != null && Number.isFinite(+values[p.key]) ? +values[p.key] : p.def;
  const kind = faceKind(def);
  const f =
    kind === 'amp'
      ? ampFace(def, vals, opts, ps)
      : kind === 'synth'
        ? synthFace(def, vals, opts, ps)
        : pedalFace(def, vals, { ...opts, values }, ps);
  f.el.dataset.face = kind;
  f.el.dataset.device = def.id || '';
  if (f.after) f.after();
  // automation: the menu on every control (opts.onMenu(key, anchor, event)), marks via mark()
  if (opts.onMenu)
    for (const [k, w] of Object.entries(f.widgets))
      wireMenu(w, w.menuTarget || w, (anchor, e) => opts.onMenu(k, anchor, e));
  let alive = true;
  return {
    el: f.el,
    kind,
    widgets: f.widgets,
    // mark(key, 'auto' | 'held' | null, { note, title, label, onClick }): the word beside the control; note goes in
    // front of the dial's title ("Follows its lane (Cutoff, bars 9-16)")
    mark(key, state, o = {}) {
      const w = f.widgets[key];
      if (!alive || !w) return;
      setMark(w, state, o);
      w.autoNote = state ? o.note || '' : '';
      if (w.redraw) w.redraw();
    },
    update(next = {}, on) {
      if (!alive) return;
      for (const p of ps) {
        if (next[p.key] == null || !Number.isFinite(+next[p.key])) continue;
        vals[p.key] = +next[p.key];
        if (f.widgets[p.key] && f.widgets[p.key].setValue) f.widgets[p.key].setValue(vals[p.key]);
      }
      if (on != null) f.setOn(on);
      if (f.after) f.after();
      if (f.screen) f.screen.draw(next);
    },
    meter(level) {
      if (alive && f.meter) f.meter(level);
    },
    destroy() {
      alive = false;
      f.screen?.stop();
      f.el.remove();
    },
  };
}

/* ---- the styles: clawd-o-matic's (vendored, scoped under .ewf), and Overdub's around them */
// Prefix every rule's selectors with `scope ` (inside @media / @supports / @container too); @keyframes as they are.
export function scopeCss(css, scope, { drop } = {}) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  const n = css.length;
  const block = () => {
    // from just after a '{' to its matching '}' (returned without the closing brace)
    let depth = 1,
      j = i;
    while (j < n && depth) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const s = css.slice(i, j - 1);
    i = j;
    return s;
  };
  const splitSel = (s) => {
    const out = [];
    let d = 0,
      cur = '';
    for (const ch of s) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && !d) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  let out = '';
  while (i < n) {
    const k = css.indexOf('{', i);
    if (k < 0) break;
    const pre = css.slice(i, k).trim();
    i = k + 1;
    const body = block();
    if (!pre) continue;
    if (/^@(media|supports|container)/.test(pre)) {
      if (drop && drop(pre)) continue;
      out += `${pre} {\n${scopeCss(body, scope, { drop })}\n}\n`;
    } else if (pre.startsWith('@')) out += `${pre} {${body}}\n`;
    else
      out +=
        splitSel(pre)
          .map((s) => (/^(:root|html|body)\b/.test(s) ? s.replace(/^(:root|html|body)/, scope) : `${scope} ${s}`))
          .join(', ') + ` {${body}}\n`;
  }
  return out;
}

const OWN_CSS = `
.ewf { --f-px: Silkscreen, var(--font-mono, ui-monospace), monospace; --f-mono: var(--font-mono, ui-monospace, Menlo, monospace); --f-ui: var(--font-ui, system-ui, sans-serif);
  --focus: var(--accent, #ff6f61); --paper: var(--text, #f1ece4); --ink: var(--bg, #0e0d12); --line2: var(--line-2, #3a3645); --panel2: var(--bg-3, #1d1b25);
  --dim: var(--text-2, #b9b1a6); --faint: var(--text-3, #7d766e); --r: #d77757;
  position: relative; display: inline-block; vertical-align: top; color: var(--paper); font-family: var(--f-ui); line-height: 1.2; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
.ewf button { font: inherit; color: inherit; }
.ewf .pd { box-sizing: border-box; margin: 0; }
.ewf .pd-sw:disabled { cursor: default; }
.ewf .kn:hover .kn-tip { opacity: 1; transform: translate(-50%, 0); }
.ewf .kn-tip { z-index: 5; }
.ewf .pd .kn-v { min-height: 9px; }
/* A knob's column holds its longest readout ("2.62 kHz" under a 26 px dial ran into the next one: "2.62 kH0.250"):
   --kvn is the most characters its readout ever shows (makeKnob samples its travel), the readout keeps that much room in
   its own mono figures, and the cell sizes to what it holds (never narrower than it was: the label keeps the dial's
   width and a little). A rack unit widens to hold its columns (pedalFace). */
.ewf .pd .kn:not(.kn-tread) { width: auto; min-width: auto; }
.ewf .pd .kn:not(.kn-tread) > .kn-l { min-width: calc(var(--ks, 32px) + 4px); text-align: center; }
.ewf .pd .kn-v { min-width: calc(var(--kvn, 0) * 0.632em); text-align: center; }
.ewf .pd-box .pd-knobs { column-gap: 4px; }   /* (readouts keep their own room now: Hot Print's three columns fit its box) */
.ewf-menu select { max-width: 92px; height: 20px; margin: calc((var(--ks, 32px) - 20px) / 2) 0; padding: 0 2px; border: 1px solid #0006; border-radius: 4px;
  background: linear-gradient(#2c2832, #18151b); color: #f4f0e6; font: 700 9px/1 var(--f-mono); box-shadow: 0 2px 0 #0008; cursor: pointer; }
.ewf-menu select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
/* the author's byline under the face: "by" in pencil, the name in its ink at the same size; no pill, no glow */
.ewf-by { display: block; margin: 8px 0 0; padding: 0; text-align: right; font: 400 12px/1.3 var(--font-ui, system-ui, sans-serif);
  color: var(--text-3, #8a8274); white-space: nowrap; }
.ewf-by-name { font-weight: 600; }
.ewf-by-agent { color: var(--agent, #4cc3ff); }
.ewf-by-human { color: var(--human, #ffa043); }
/* automation (docs/research/AUTOMATION.md 3.6): "auto" in pencil, "held" in grease pencil, written beside the dial on
   the room's ground so it reads on any enclosure; square, no glow, no outline colour on the knob itself */
.ewf .ewf-marked { position: relative; }
.ewf .ewf-am { position: absolute; z-index: 3; left: 50%; top: -4px; transform: translateX(calc(var(--ks, 32px) / 2 - 6px)); margin: 0; padding: 1px 3px 2px;
  border: 0; border-radius: 0; background: var(--bg, #0e0d12); color: var(--text-2, #b9b1a6); font: italic 500 9px/1 var(--font-ui, system-ui, sans-serif);
  letter-spacing: 0; text-transform: none; cursor: pointer; white-space: nowrap; }
.ewf .ewf-am[data-mark="held"] { color: var(--accent-2, #e8b04b); text-decoration: underline; text-underline-offset: 2px; }
.ewf .ewf-am:hover { color: var(--text, #f1ece4); }
.ewf .ewf-am:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.ewf .ms.ewf-marked .ewf-am, .ewf .tp.ewf-marked .ewf-am { left: auto; right: -6px; transform: none; }
/* a screen (def.screen): a dark display across the top of the unit, the name and the switch under it at the left */
.ewf .pd-rack.pd-has-screen { width: 320px; grid-template-rows: auto auto 1fr; }
.ewf .pd-rack.pd-has-screen .pd-screen { grid-column: 1 / -1; grid-row: 1; display: block; width: 100%; height: 72px; margin: 0 0 10px; border-radius: 2px; background: #12100e; box-shadow: inset 0 1px 3px #000c; }
.ewf .pd-rack.pd-has-screen .pd-name { grid-row: 2; }
.ewf .pd-rack.pd-has-screen .pd-feet { grid-row: 3; }
.ewf .pd-rack.pd-has-screen .pd-knobs { grid-row: 2 / 4; }
/* compact: the same faces, smaller (a device chain, a strip) */
.ewf-pedal.ewf-compact .pd { zoom: 0.7; }
/* a finger (a coarse pointer): a lever and a little menu are 44 px targets, the face's zoom allowed for (the rack's
   phone pager scales a face by --rkz; Studio A's KIT menu was 42 x 14 there and its VIEW lever 15 x 15). The lever's
   reach is a transparent square around it; the menu is drawn that tall. */
@media (pointer: coarse) {
  .ewf .ms-b { z-index: 1; }   /* (its reach is over its own label and readout, which a tap there means anyway) */
  .ewf .ms-b::before { content: ''; position: absolute; left: 50%; top: 50%; width: calc(44px / var(--rkz, 1)); height: calc(44px / var(--rkz, 1)); transform: translate(-50%, -50%); }
  .ewf .ewf-menu select { height: max(20px, calc(44px / var(--rkz, 1))); margin: 0; font-size: max(9px, calc(12.5px / var(--rkz, 1))); }
}

/* the amp */
.ewf-ampface { container: ewfamp / inline-size; display: block; width: min(100%, 700px); }
.ewf-ampface .amps { display: block; padding-top: 14px; }
.ewf-ampface .amp, .ewf-ampface .amp :is(div, span, i, b) { box-sizing: content-box; }
.ewf-ampface .amp.small { margin: 0 auto; }
.ewf-ampface .amp-pwr:disabled { cursor: default; }
.ewf-ampface .amp-knobs .ms .ms-l, .ewf-ampface .amp-knobs .ms-o { color: var(--pn-ink); }
.ewf-ampface.ewf-compact { width: min(100%, 470px); }
.ewf-ampface.ewf-compact .amps { padding-top: 0; }
.ewf-ampface.ewf-compact .amp { --kw: 30px; filter: drop-shadow(0 5px 8px #0008); }
.ewf-ampface.ewf-compact .amp-cab, .ewf-ampface.ewf-compact .amp-handle, .ewf-ampface.ewf-compact .amp-feet, .ewf-ampface.ewf-compact .amp-jacks, .ewf-ampface.ewf-compact .amp-vu { display: none; }
.ewf-ampface.ewf-compact .amp-top { border-radius: var(--round); margin: 0; padding: 6px 8px; }
.ewf-ampface.ewf-compact .amp-strip { display: grid; place-items: center; height: 26px; margin-bottom: 6px; border-radius: 3px; background: var(--gr); box-shadow: 0 0 0 2px var(--pipe), inset 0 0 12px #000a; }
.ewf-ampface.ewf-compact .amp-strip .amp-lgw { font-size: 17px; }
.ewf-ampface.ewf-compact .amp-panel { padding: 8px 10px 6px; gap: 8px; }
.ewf-ampface.ewf-compact .amp-jewel { width: 14px; height: 14px; }
.ewf-ampface.ewf-compact .amp-pwr { min-height: 36px; min-width: 28px; }
.ewf-ampface.ewf-compact .amp-pwr i { width: 12px; height: 20px; }
.ewf-ampface.ewf-compact .amp-pwr i::after { height: 8px; }
.ewf-ampface.ewf-compact .amp-pwr[aria-pressed="true"] i::after { top: 9px; }
.ewf-ampface.ewf-compact .amp .kn { width: calc(var(--kw) + 10px); }
.ewf-ampface.ewf-compact .amp .kn-l { font-size: 6px; }
.ewf-cabstrip { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; margin-top: 12px; padding: 10px 12px; border: 1px solid var(--line, #2a2733); border-radius: var(--r-2, 8px);
  background: var(--bg-2, #15141b); color: var(--text-2, #b9b1a6); }
.ewf-cabstrip-h { font: 600 11px/1 var(--f-ui); letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3, #7d766e); }
.ewf-cabstrip-k { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px 10px; --ks: 28px; }
.ewf-cabstrip .kn-dial { background: radial-gradient(circle at 45% 35%, #4a4550, #151218 70%); }
.ewf-cabstrip .kn-l, .ewf-cabstrip .ms-l { font-size: 6px; color: var(--text-2, #b9b1a6); }
.ewf-cabstrip .kn-v, .ewf-cabstrip .ms-o { font-size: 9px; color: var(--text, #f1ece4); }
.ewf-cabstrip .ewf-menu select { max-width: 150px; }
.ewf .ewf-menu { width: auto; }
.ewf-cabstrip .kn { width: auto; min-width: 54px; }
.ewf-ampface .amp.small { width: min(100%, 600px); --kw: 38px; }
.ewf-ampface.ewf-compact .amp.small { width: 100%; --kw: 30px; }
.ewf-ampface.ewf-compact .amp-panel { flex-wrap: nowrap; justify-content: flex-start; }
.ewf-ampface.ewf-compact .amp-knobs { flex: 1 1 auto; order: 0; gap: 2px; }
.ewf-synth .kn { width: calc(var(--ks, 32px) + 16px); }
.ewf-synth .kn-v { font-size: 8px; }

/* the synth panel (instruments) */
.ewf-synth .sy { position: relative; display: grid; gap: 10px; min-width: 220px; max-width: 560px; padding: 12px 26px 12px; border-radius: 6px; color: var(--pi);
  background: linear-gradient(90deg, var(--wood) 0 14px, transparent 14px calc(100% - 14px), var(--wood) calc(100% - 14px)),
    linear-gradient(170deg, #ffffff22, transparent 35%, #00000030), var(--pc);
  box-shadow: inset 14px 0 0 -12px #0006, inset -14px 0 0 -12px #0006, inset 0 1px 0 #fff4, 0 4px 0 #0008, 0 10px 18px #0007; }
.ewf-synth .sy::before, .ewf-synth .sy::after { content: ''; position: absolute; top: 0; bottom: 0; width: 14px; pointer-events: none;
  background: repeating-linear-gradient(180deg, #ffffff10 0 2px, transparent 2px 7px, #00000022 7px 9px); }
.ewf-synth .sy::before { left: 0; border-radius: 6px 0 0 6px; } .ewf-synth .sy::after { right: 0; border-radius: 0 6px 6px 0; }
.ewf-synth .sy-head { display: flex; align-items: baseline; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid color-mix(in srgb, var(--pi) 30%, transparent); }
.ewf-synth .sy-led { width: 8px; height: 8px; border-radius: 50%; align-self: center; background: color-mix(in srgb, var(--led) 25%, #111); box-shadow: inset 0 1px 1px #0008; }
.ewf-synth .sy.on .sy-led { background: var(--led); box-shadow: 0 0 calc(4px + 8px * var(--lv, 0)) 2px color-mix(in srgb, var(--led) 65%, transparent); }
.ewf-synth .sy-name { font: 400 22px/1 "Rubik Dirt", Impact, sans-serif; letter-spacing: 0.01em; }
.ewf-synth .sy-kind { font: 400 7px var(--f-px); letter-spacing: 0.12em; opacity: 0.75; margin-left: auto; }
.ewf-synth { max-width: 100%; }
.ewf-synth .sy { width: calc(var(--kc, 4) * 58px + 52px); max-width: 100%; }
.ewf-synth .sy-knobs { display: flex; flex-wrap: wrap; justify-content: start; --kb: 34px; gap: 6px 8px; }
.ewf-synth .sy-keys { display: grid; grid-template-columns: repeat(15, 1fr); gap: 2px; height: 22px; padding: 3px; border-radius: 3px; background: #0c0b0e; }
.ewf-synth .sy-keys i { border-radius: 0 0 2px 2px; background: linear-gradient(#f4f0e6, #d9d2c3); position: relative; }
.ewf-synth .sy-keys i:nth-child(7n+1)::after, .ewf-synth .sy-keys i:nth-child(7n+2)::after, .ewf-synth .sy-keys i:nth-child(7n+4)::after, .ewf-synth .sy-keys i:nth-child(7n+5)::after, .ewf-synth .sy-keys i:nth-child(7n+6)::after {
  content: ''; position: absolute; right: -35%; top: 0; width: 70%; height: 58%; z-index: 1; border-radius: 0 0 2px 2px; background: #141217; }
.ewf-synth .sy-keys i:last-child::after { display: none; }
.ewf-synth.ewf-compact .sy { zoom: 0.78; }
.ewf-synth.ewf-compact .sy-keys { display: none; }
`;

const AMP_CSS_FIXED = () =>
  LOOKS.AMP_CSS.replace(/@media \(max-width: 700px\)/g, '@container ewfamp (max-width: 600px)');
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  // (pedalboard.js's phone rules lay out its board and library, not a face: left out)
  const text =
    scopeCss(LOOKS.PEDAL_CSS, '.ewf', { drop: (pre) => /max-width:\s*(480|560)px/.test(pre) }) +
    scopeCss(AMP_CSS_FIXED(), '.ewf') +
    OWN_CSS;
  if (dom && typeof dom.css === 'function') dom.css('ewf-faces', text);
  else if (!document.getElementById('ewf-faces')) {
    const s = document.createElement('style');
    s.id = 'ewf-faces';
    s.textContent = text;
    document.head.appendChild(s);
  }
  // the faces' own lettering (clawd-o-matic's): Rubik Dirt for names, Silkscreen for the small print. style/fonts.css
  // declares them, from this site (tokens.css imports it, so a page with the tokens has them already); a page without
  // it gets that file, never another host's
  if (!fontDeclared('Rubik Dirt') && !document.querySelector('link[data-ewf-fonts]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../../style/fonts.css', import.meta.url).href;
    l.dataset.ewfFonts = '';
    document.head.appendChild(l);
  }
}
function fontDeclared(family) {
  try {
    for (const f of document.fonts) if (String(f.family).replace(/^["']|["']$/g, '') === family) return true;
  } catch (e) {
    /* no FontFaceSet */
  }
  return false;
}
export { ensureCss as injectFaceCss };
