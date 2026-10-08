// Shared bits for the timeline views (transport, arranger, piano roll, beat grid) [ui-arrange]:
// colours on canvas, authorship, agent flashes and presence, small popovers and menus. No state of its own beyond caches.

import { h, css, tok, clamp } from './dom.js';
import { kitNotes } from '../core/music.js';

/* ---------------------------------------------------------------- colour */
// A song's colours (a track's, a clip's) are anyone's JSON, and they end up in CSS: --tc, a swatch's background. A
// url(...) there is fetched as soon as the page draws it, so a shared link could tell its sender when and from where it
// was opened. A song colour is therefore a token by name (var(--c-3); the master's var(--text-2)), whose value is our
// stylesheet's, or a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa), else the fallback, as ui/provenance.js ink() and
// ui/faces.js already do. Whatever puts a song colour into CSS goes through songColor() or resolveColor().
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const TOKEN = /^var\((--[\w-]+)\)$/;
export const isHexColor = (c) => typeof c === 'string' && HEX.test(c);
// for CSS: the colour as given (a token stays a token), or the fallback
export function songColor(c, fallback = '#b190f2') {
  const s = typeof c === 'string' ? c.trim() : '';
  return HEX.test(s) || TOKEN.test(s) ? s : fallback;
}
const colorCache = new Map();
// for canvas, which can't read custom properties: 'var(--c-5)' -> '#a2a6c6'; a hex colour passes; anything else is the
// fallback
export function resolveColor(c, fallback = '#b190f2') {
  if (colorCache.has(c)) return colorCache.get(c); // (only colours that passed are remembered)
  const s = songColor(c, '');
  if (!s) return fallback;
  const m = TOKEN.exec(s);
  const out = m ? tok(m[1]) : s;
  if (!out) return fallback; // the token isn't there yet (stylesheet still loading): don't remember the miss
  colorCache.set(c, out);
  return out;
}
export function rgbOf(c) {
  // (shade() hands back rgb() strings of its own making: those are numbers already)
  let m = typeof c === 'string' && c.startsWith('rgb') ? /^rgba?\(([^)]+)\)$/.exec(c) : null;
  if (m)
    return m[1]
      .split(/[\s,/]+/)
      .slice(0, 3)
      .map(Number);
  c = resolveColor(c);
  m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let x = m[1];
    if (x.length <= 4) x = [...x].map((ch) => ch + ch).join('');
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  m = /rgba?\(([^)]+)\)/.exec(c);
  if (m)
    return m[1]
      .split(/[\s,/]+/)
      .slice(0, 3)
      .map(Number);
  return [177, 144, 242];
}
// a colour with alpha, for canvas
export function rgba(c, a) {
  const [r, g, b] = rgbOf(c);
  return `rgba(${r},${g},${b},${a})`;
}
// mix toward white (t>0) or black (t<0)
export function shade(c, t) {
  const [r, g, b] = rgbOf(c),
    k = Math.abs(t),
    to = t > 0 ? 255 : 0;
  return `rgb(${Math.round(r + (to - r) * k)},${Math.round(g + (to - g) * k)},${Math.round(b + (to - b) * k)})`;
}
// The palette the canvases use, read from the tokens once (and again if the theme changes).
let pal = null;
export function palette() {
  if (pal) return pal;
  const t = (n, d) => tok(n) || d;
  if (!tok('--bg')) return palOf(t); // tokens not applied yet: answer with the defaults, read again next time
  return (pal = palOf(t));
}
function palOf(t) {
  return {
    bg: t('--bg', '#141210'),
    bg2: t('--bg-2', '#1a1815'),
    bg3: t('--bg-3', '#24211c'),
    panel: t('--panel', '#1d1b17'),
    line: t('--line', '#2f2b25'),
    line2: t('--line-2', '#46413a'),
    text: t('--text', '#f4ead6'),
    text2: t('--text-2', '#cbc0aa'),
    text3: t('--text-3', '#9a8f7c'),
    accent: t('--accent', '#d9f36a'),
    accent2: t('--accent-2', '#f1dc8a'),
    human: t('--human', '#ffa043'),
    agent: t('--agent', '#4cc3ff'),
    rec: t('--rec', '#ff4d4d'),
    ok: t('--ok', '#8fdca0'),
    mono: t('--font-mono', 'ui-monospace, monospace'),
    ui: t('--font-ui', 'system-ui, sans-serif'),
    display: t('--font-display', "'Arial Black', sans-serif"),
  };
}

/* ---------------------------------------------------------------- authorship */
// 'agent' | 'human' | 'house' (dom.js authorOf() says the same in words; the house is unsigned)
export function authorKind(app, by) {
  if (!by) return 'house';
  const a = app.store.author ? app.store.author(by) : null;
  if (a?.kind === 'agent' || app.store.isAgent?.(by)) return 'agent';
  if (a?.kind === 'house' || by === 'overdub') return 'house';
  return 'human';
}
export function authorName(app, by) {
  return app.store.author ? app.store.author(by)?.name || by : by;
}
export function authorColor(app, by) {
  const p = palette(),
    k = authorKind(app, by);
  return k === 'agent' ? p.agent : k === 'human' ? p.human : p.line2;
}

/* ---------------------------------------------------------------- tracks and devices */
export function isDrumTrack(app, t) {
  if (!t || t.kind !== 'instrument' || !t.instrument) return false;
  if (t.instrument.device === 'core.drums') return true;
  const d = app.devices?.getDevice?.(t.instrument.device);
  return d?.cat === 'drums';
}
// A drum track's names for its notes: its kit's own (core/music.js kitNotes), or null (General MIDI's, via drumName)
export function trackNotes(app, t) {
  if (!t || t.kind !== 'instrument' || !t.instrument) return null;
  const id = t.instrument.device;
  return kitNotes(app.devices?.getDevice?.(id) || { id });
}
export function trackIcon(app, t) {
  if (!t) return 'dot';
  if (t.kind === 'audio') return t.inserts?.some((x) => /^amp\./.test(x.device)) ? 'guitar' : 'wave';
  if (isDrumTrack(app, t)) return 'drum';
  const cat = app.devices?.getDevice?.(t.instrument?.device)?.cat;
  if (cat === 'keys') return 'keys';
  if (cat === 'pluck') return 'guitar';
  return 'knob';
}
// (a held device, a song's whose code hasn't been allowed here, isn't registered: its name is the song's)
export function deviceName(app, id) {
  return (
    app.devices?.heldDevice?.(id)?.name || app.devices?.getDevice?.(id)?.name || (id ? id.replace(/^[a-z]+\./, '') : '')
  );
}

/* ---------------------------------------------------------------- agent flashes */
// What a transaction touched: { tracks:Set, clips:Set, notes: Map<clipId, Set<noteId> | 'all'>, sections:Set, loop }
export function touched(evt) {
  const out = { tracks: new Set(), clips: new Set(), notes: new Map(), sections: new Set(), loop: false };
  const created = evt.created || {};
  const ref = (id) => (typeof id === 'string' && id.startsWith('$') ? created[id.slice(1)] : id);
  const addNotes = (clip, ids) => {
    if (!clip) return;
    const cur = out.notes.get(clip);
    if (cur === 'all') return;
    if (ids === 'all') {
      out.notes.set(clip, 'all');
      return;
    }
    const s = cur || new Set();
    for (const i of ids || []) s.add(i);
    out.notes.set(clip, s);
  };
  let seen = false;
  for (const op of evt.ops || []) {
    const tr = ref(op.track),
      cl = ref(op.clip);
    switch (op.type) {
      case 'track.add':
        out.tracks.add(created[op.ref || 'track'] || op.track?.id);
        break;
      case 'track.set':
      case 'instrument.set':
      case 'insert.add':
      case 'insert.set':
      case 'insert.remove':
      case 'track.move':
        out.tracks.add(tr);
        break;
      case 'clip.add': {
        const id = created[op.ref || 'clip'] || op.clip?.id;
        out.clips.add(id);
        addNotes(id, 'all');
        break;
      }
      case 'clip.set':
      case 'clip.move':
        out.clips.add(cl);
        break;
      case 'notes.add':
        out.clips.add(cl);
        addNotes(cl, created.notes || 'all');
        break;
      case 'notes.set':
        out.clips.add(cl);
        addNotes(
          cl,
          (op.notes || []).map((n) => n.id),
        );
        break;
      case 'notes.replace':
      case 'notes.restore':
        out.clips.add(cl);
        addNotes(cl, 'all');
        break;
      case 'notes.remove':
        out.clips.add(cl);
        break;
      case 'section.add':
      case 'section.set':
        out.sections.add(typeof op.section === 'object' ? op.section?.id : ref(op.section));
        break;
      case 'project.set':
        if (op.patch && 'loop' in op.patch) out.loop = true;
        break;
      // arrangement ops plan from the song as they apply: the txn's inverse names what moved (clip.remove = made here)
      case 'section.duplicate':
      case 'time.insert':
      case 'time.remove':
      case 'clip.repeat':
      case 'clip.split':
        if (!seen) {
          seen = true;
          for (const o of evt.txn?.inverse || []) inverseTouch(o);
        }
        break;
      default:
        break;
    }
  }
  return out;
  function inverseTouch(o) {
    const sec = typeof o.section === 'object' ? o.section?.id : o.section;
    switch (o.type) {
      case 'clip.remove':
        out.clips.add(o.clip);
        addNotes(o.clip, 'all');
        break;
      case 'clip.set':
      case 'clip.move':
      case 'notes.replace':
      case 'notes.restore':
      case 'notes.set':
      case 'notes.add':
      case 'notes.remove':
        out.clips.add(o.clip);
        break;
      case 'section.remove':
      case 'section.set':
        out.sections.add(sec);
        break;
      case 'project.set':
        if (o.patch && 'loop' in o.patch) out.loop = true;
        break;
      default:
        break;
    }
  }
}

// Flash memory: mark ids, read a 0..1 glow that fades over `ms`.
export function flasher(ms = 1400) {
  const m = new Map();
  return {
    mark(id, now = performance.now()) {
      if (id) m.set(id, now);
    },
    level(id, now = performance.now()) {
      const t0 = m.get(id);
      if (t0 == null) return 0;
      const x = (now - t0) / ms;
      if (x >= 1) {
        m.delete(id);
        return 0;
      }
      return 1 - x * x;
    },
    active() {
      return m.size > 0;
    },
    clear() {
      m.clear();
    },
  };
}

// The live presence list (agent pointers), with expired ones dropped.
export function presenceList(ui) {
  const now = Date.now();
  return (ui.state.presence || []).filter((p) => !p.until || p.until > now);
}

// A pointer's one-line label on canvas ("Claude: 2 takes, bars 1–4"): flat type on a room-coloured backing, no pill,
// no glow (design/LINER-NOTES-KIT.md, state marks). Returns its width.
export function drawLabel(g, x, y, text, { color, max = 260 } = {}) {
  const p = palette();
  g.save();
  g.font = `600 10.5px ${p.ui}`;
  let s = String(text || '');
  while (s.length > 3 && g.measureText(s).width > max) s = s.slice(0, -2);
  if (s !== String(text || '')) s = s.replace(/.$/, '…');
  const w = Math.ceil(g.measureText(s).width) + 6;
  g.fillStyle = p.bg;
  g.fillRect(x, y, w, 14);
  g.fillStyle = color || p.accent2;
  g.textBaseline = 'middle';
  g.fillText(s, x + 3, y + 7.5);
  g.restore();
  return w;
}

// Crop marks: four L-shaped corner marks, 2 px, 10 px long, set 3 px outside the box, as a printer marks a crop. The
// agent pointing at something (grease pencil), or a part just arriving (its author's ink). An optional one-line label
// sits above the top right corner (below it when there's no room above).
export function drawCrop(g, x, y, w, hh, { color, label = null, len = 10, out = 3 } = {}) {
  const p = palette();
  const c = color || p.accent2;
  const L = Math.min(len, Math.max(4, w / 2), Math.max(4, hh / 2));
  const x0 = Math.round(x) - out,
    y0 = Math.round(y) - out,
    x1 = Math.round(x + w) + out,
    y1 = Math.round(y + hh) + out;
  g.save();
  g.fillStyle = c;
  g.fillRect(x0, y0, L, 2);
  g.fillRect(x0, y0, 2, L);
  g.fillRect(x1 - L, y0, L, 2);
  g.fillRect(x1 - 2, y0, 2, L);
  g.fillRect(x0, y1 - 2, L, 2);
  g.fillRect(x0, y1 - L, 2, L);
  g.fillRect(x1 - L, y1 - 2, L, 2);
  g.fillRect(x1 - 2, y1 - L, 2, L);
  g.restore();
  if (label) {
    g.save();
    g.font = `600 10.5px ${p.ui}`;
    const tw = Math.min(260, g.measureText(label).width) + 6;
    g.restore();
    const lx = Math.max(x0, x1 - 2 - tw);
    const ly = y0 - 15 >= 0 ? y0 - 15 : y0 + 4;
    drawLabel(g, lx, ly, label, { color: c });
  }
}

// Automation on canvas (ui/lanes.js, and any timeline that draws a lane): a point is a 5 px square outlined in the
// track's ink on the room (no circles: kit rule 5); selected, reverse print (filled cream). A held lane is the muted
// look: its line dashed in pencil.
export const HELD_DASH = [4, 3];
export function drawPointSquare(g, x, y, { color, on = false, size = 5 } = {}) {
  const p = palette(),
    r = size / 2;
  const X = Math.round(x) - r,
    Y = Math.round(y) - r;
  g.fillStyle = on ? p.text : p.bg;
  g.fillRect(X, Y, size, size);
  g.strokeStyle = on ? p.text : color || p.text3;
  g.lineWidth = 1;
  g.strokeRect(X, Y, size, size);
}

// A byline for canvas: { kind: 'human' | 'agent', text } or null for the house (unsigned), in the same words byline()
// writes in the DOM ("you" lower case, mid-phrase; agents and guests by name).
export function bylineOf(app, by) {
  const k = authorKind(app, by);
  if (k === 'house') return null;
  return { kind: k, text: by === 'you' ? 'you' : authorName(app, by) };
}

// The display face on canvas: Archivo at its widest (wdth 125), ExtraBold Italic, the way .num and .disp set it.
export function displayFont(g, px, { stretch = 'expanded' } = {}) {
  const p = palette();
  g.font = `italic 800 ${stretch} ${px}px ${p.display}`;
  if ('fontStretch' in g) {
    try {
      g.fontStretch = stretch;
    } catch (e) {
      /* older canvas */
    }
  }
}

export function roundRect(g, x, y, w, hh, r) {
  r = Math.max(0, Math.min(r, w / 2, hh / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hh, r);
  g.arcTo(x + w, y + hh, x, y + hh, r);
  g.arcTo(x, y + hh, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ---------------------------------------------------------------- time */
export function fmtClock(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60),
    s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
export const snapTo = (b, grid) => (grid > 0 ? Math.round(b / grid) * grid : b);
export const floorTo = (b, grid) => (grid > 0 ? Math.floor(b / grid + 1e-9) * grid : b);
export const SNAPS = [
  [0, 'Off'],
  [1 / 8, '1/32'],
  [1 / 4, '1/16'],
  [1 / 3, '1/8T'],
  [1 / 2, '1/8'],
  [1, 'Beat'],
  [4, 'Bar'],
];
export const snapLabel = (s) => (SNAPS.find(([v]) => Math.abs(v - s) < 1e-6) || [s, `${s}`])[1];

/* ---------------------------------------------------------------- popovers and menus */
css(
  'arrange-kit',
  `
.ek-pop { position: fixed; z-index: 900; min-width: 160px; max-width: min(360px, calc(100vw - 16px)); max-height: min(70vh, 520px); overflow: auto;
  padding: 6px; border-radius: 0; background: var(--bg-3); border: 1px solid var(--line-2); box-shadow: var(--shadow-2);
  animation: ek-pop .16s var(--ease, ease) both; font-size: 12px; }
@keyframes ek-pop { from { opacity: 0; transform: translateY(-4px); } }
@media (prefers-reduced-motion: reduce) { .ek-pop { animation: none; } }
.ek-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--r-press, 2px); background: transparent;
  color: var(--text); cursor: pointer; text-align: left; font-size: 12px; }
.ek-item:hover, .ek-item:focus-visible { background: color-mix(in srgb, var(--text) 8%, transparent); outline: none; }
.ek-item .ek-sub { margin-left: auto; color: var(--text-3); font-size: 11px; }
.ek-item .ek-kbd { margin-left: auto; color: var(--text-3); font: 11px var(--font-mono); }
.ek-item[disabled] { opacity: .45; cursor: default; }
.ek-item.danger { color: var(--bad); }
.ek-sep { height: 1px; margin: 5px 4px; background: var(--line-2); }
.ek-head { padding: 6px 10px 4px; color: var(--text-3); font-size: 11px; font-weight: 600; }
.ek-dot { width: 8px; height: 8px; flex: none; }
`,
);
let openPop = null;
export function closePopover() {
  if (openPop) {
    const p = openPop;
    openPop = null;
    p.close();
  }
}
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
// What a popover is called, for a screen reader: opts.label, else the anchor's own name.
export function popLabel(anchor, label) {
  if (label) return label;
  if (!(anchor instanceof Element)) return null;
  return (
    anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent.trim().slice(0, 60) || null
  );
}
// Keyboard focus for a popover: it moves in (the first control, or the card itself) on open and goes back to where it
// came from on close, if it was still inside (or nowhere).
export function popFocus(el, { focus = true } = {}) {
  const back = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  if (focus) (el.querySelector(FOCUSABLE) || el).focus({ preventScroll: true });
  return () => {
    const a = document.activeElement;
    const lost = !a || a === document.body || el.contains(a);
    return () => {
      if (lost && back && back.isConnected && (!document.activeElement || document.activeElement === document.body))
        back.focus({ preventScroll: true });
    };
  };
}
// A non-modal popover near an anchor element (or a { x, y } point). Closes on outside click, Escape, or close().
// Focus moves into it and comes back to the opener when it closes.
export function popover(anchor, content, { onClose, align = 'left', cls = '', label = null, focus = true } = {}) {
  closePopover();
  const el = h(
    'div.ek-pop' + (cls ? '.' + cls : ''),
    { role: 'dialog', 'aria-label': popLabel(anchor, label) },
    content,
  );
  document.body.append(el);
  const place = () => {
    const r =
      anchor instanceof Element
        ? anchor.getBoundingClientRect()
        : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const w = el.offsetWidth,
      hh = el.offsetHeight;
    let x = align === 'right' ? r.right - w : r.left;
    let y = r.bottom + 6;
    if (y + hh > window.innerHeight - 8) y = Math.max(8, r.top - hh - 6);
    x = clamp(x, 8, window.innerWidth - w - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  };
  place();
  let closed = false;
  const away = (e) => {
    if (closed) return;
    if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) closePopover();
  };
  const esc = (e) => {
    if (!closed && e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
    }
  };
  setTimeout(() => {
    if (!closed) window.addEventListener('pointerdown', away, true);
  }, 0);
  window.addEventListener('keydown', esc, true);
  const leaving = popFocus(el, { focus });
  const rec = {
    el,
    close() {
      closed = true;
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
      const restore = leaving();
      el.remove();
      onClose && onClose();
      restore();
    },
    place,
  };
  openPop = rec;
  return rec;
}
// Arrow keys, Home and End move between a menu's items (focus stays on an enabled one).
export function menuKeys(el, sel = '.ek-item') {
  el.addEventListener('keydown', (e) => {
    const items = [...el.querySelectorAll(sel)].filter((b) => !b.disabled && b.offsetParent !== null);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let to = -1;
    if (e.key === 'ArrowDown') to = i < 0 ? 0 : (i + 1) % items.length;
    else if (e.key === 'ArrowUp') to = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = items.length - 1;
    else return;
    e.preventDefault();
    items[to].focus({ preventScroll: false });
  });
}
// A touch-first screen (a phone or tablet, no fine pointer): there's no keyboard to press a shortcut on.
export const touchFirst = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(pointer: coarse)').matches &&
  !matchMedia('(any-pointer: fine)').matches;
// items: [{ label, run, icon?, sub?, kbd?, danger?, disabled?, dot? } | '-' | { head }]
// An item shows its key (kbd) or else its sub-line; on a touch-first screen keys don't apply, so it shows the sub-line.
export function menu(anchor, items, opts = {}) {
  const keys = !touchFirst();
  const els = items.map((it) => {
    if (it === '-') return h('div.ek-sep', { role: 'separator' });
    if (it.head) return h('div.ek-head', { role: 'presentation' }, it.head);
    return h(
      'button.ek-item' + (it.danger ? '.danger' : ''),
      {
        role: 'menuitem',
        disabled: !!it.disabled,
        title: it.title || null,
        onclick: () => {
          closePopover();
          it.run && it.run();
        },
      },
      it.dot ? h('span.ek-dot', { style: { background: it.dot } }) : null,
      h('span', it.label),
      it.kbd && keys ? h('span.ek-kbd', it.kbd) : it.sub ? h('span.ek-sub', it.sub) : null,
    );
  });
  const head = items.find((it) => it && it.head)?.head;
  const p = popover(anchor, els, { label: head || null, ...opts });
  p.el.setAttribute('role', 'menu');
  p.el.querySelector('.ek-item:not([disabled])')?.focus({ preventScroll: true });
  menuKeys(p.el);
  return p;
}

// The modifier word for this platform, for tooltips.
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';

// Open the agent's tab (whatever the agent layer called it), so an empty state can say "ask the agent".
export function showAgent(ui) {
  const recs = [...ui.panels.values()]
    .filter((p) => p.region === 'right')
    .sort((a, b) => (a.def.order ?? 50) - (b.def.order ?? 50));
  const rec = ui.panels.get('agent') || recs[0];
  if (rec) {
    ui.show(rec.def.id);
    return true;
  }
  return false;
}
