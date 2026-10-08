// Small DOM helpers shared by every panel. No framework: h() builds elements, css() injects a stylesheet once,
// icon() draws a line icon, byline() signs a thing with its author's name, drag() handles pointer drags with capture.

// Markup for h's `html` attribute: h('div', { html: rawHtml(md(text)) }). Only a rawHtml() is ever parsed as markup,
// never a string: a song's text (a title, a device's blurb) is anyone's JSON, and a value that isn't text lands in h's
// attrs position as a plain object. JSON can't make a rawHtml, an event handler (a function) or a non-string
// property, so data there can at worst set a harmless attribute: no markup, inline handler, innerHTML or
// javascript: URL comes from attrs.
class RawHtml {
  constructor(s) {
    this.s = String(s);
  }
}
export const rawHtml = (s) => new RawHtml(s);
const UNSAFE_KEY = /^on[a-z]|html$|^srcdoc$/i;
const URL_KEY = /^(href|src|action|formaction|xlink:href|data)$/i;
const scriptUrl = (v) => /^javascript:/i.test(String(v).replace(/[\u0000-\u0020]/g, ''));

// h('div.row#main', { onclick, style: {...}, dataset: {...}, aria-label }, child, [children], 'text')
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    kids.unshift(attrs);
    attrs = {};
  }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') {
      if (v instanceof RawHtml) el.innerHTML = v.s;
    } else if (UNSAFE_KEY.test(k) || (URL_KEY.test(k) && scriptUrl(v))) continue;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const injected = new Set();
// Inject a stylesheet once per id. Use the tokens (var(--bg) …) from app/style/tokens.css.
export function css(id, text) {
  if (injected.has(id) || typeof document === 'undefined') return;
  injected.add(id);
  const s = document.createElement('style');
  s.dataset.css = id;
  s.textContent = text;
  document.head.append(s);
}

// Line icons, 20x20 viewBox, stroke currentColor. icon('play', { size: 16, title })
const P = {
  play: '<path d="M6 4.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 4.5v11M13.5 4.5v11" stroke-width="2.4"/>',
  // back to the start: a bar and a triangle pointing at it (the transport's first key, beside play's stop)
  back: '<path d="M5.5 5v10" stroke-width="2.2"/><path d="M15 5v10l-7.5-5z" fill="currentColor" stroke="none"/>',
  record: '<circle cx="10" cy="10" r="5.2" fill="currentColor" stroke="none"/>',
  loop: '<path d="M4 9a5 5 0 0 1 5-5h6m-2.5-2.5L15 4l-2.5 2.5M16 11a5 5 0 0 1-5 5H5m2.5 2.5L5 16l2.5-2.5"/>',
  metronome: '<path d="M7 17h6l-2.2-13h-1.6zM10 12l4.5-6.5"/>',
  undo: '<path d="M7 5L3.5 8.5 7 12M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9"/>',
  redo: '<path d="M13 5l3.5 3.5L13 12M16 8.5H8.5a4.5 4.5 0 0 0 0 9H11"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  minus: '<path d="M4 10h12"/>',
  x: '<path d="M5 5l10 10M15 5L5 15"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  mic: '<rect x="7.5" y="3" width="5" height="9" rx="2.5"/><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17"/>',
  // The agent's mark: a short straight stroke in cool ink, the Weave's exact strand (no sparkle, no face). 'sparkle'
  // is kept as a name so older callers draw the stroke until they move to 'agent' or to a byline.
  sparkle: '<path d="M3.5 13.5L16.5 6.5" stroke-width="2.2" style="stroke:var(--agent)"/>',
  wave: '<path d="M2 10h2l1.5-4 2 8 2-11 2 13 2-9 1.5 5 1-2h2"/>',
  keys: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M7 4v7M10 4v7M13 4v7M7 11v5M10 11v5M13 11v5"/>',
  drum: '<ellipse cx="10" cy="7" rx="6.5" ry="2.5"/><path d="M3.5 7v6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V7M5 3l3 4M15 3l-3 4"/>',
  guitar:
    '<path d="M12.5 7.5l4-4M15 2.5l2.5 2.5M11 9a3.2 3.2 0 0 0-4.6-1.2c-.8.6-.7 1.6-1.8 2C3.4 10.3 2.5 11 2.5 12.6c0 2.4 2.5 4.9 4.9 4.9 1.6 0 2.3-.9 2.8-2.1.4-1.1 1.4-1 2-1.8A3.2 3.2 0 0 0 11 9z"/><circle cx="7.5" cy="12.5" r="1.2"/>',
  knob: '<circle cx="10" cy="10" r="6"/><path d="M10 10l3-3.5"/>',
  chat: '<path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 16 14H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 12.5V6A1.5 1.5 0 0 1 4 4.5z"/>',
  history: '<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3v3h3M10 6.5V10l2.5 2"/>',
  search: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.5 12.5l4.5 4.5"/>',
  gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6"/>',
  chevron: '<path d="M7.5 5l5 5-5 5"/>',
  down: '<path d="M5 7.5l5 5 5-5"/>',
  panelLeft: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M7.5 3.5v13"/>',
  panelRight: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M12.5 3.5v13"/>',
  panelBottom: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M2.5 11.5h15"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/>',
  copy: '<rect x="6.5" y="6.5" width="9" height="10" rx="1.5"/><path d="M4.5 13.5v-9a1.5 1.5 0 0 1 1.5-1.5h7"/>',
  power: '<path d="M10 3v6.5M6 5.5a6 6 0 1 0 8 0"/>',
  agent: '<path d="M3.5 13.5L16.5 6.5" stroke-width="2.2" style="stroke:var(--agent)"/>',
  // A person's mark: the same stroke with a breath in it, in warm ink (the Weave's played strand).
  you: '<path d="M3.5 13.5C6 12.6 6.8 9.6 9.6 10.1 12.2 10.6 13.2 7.2 16.5 6.5" stroke-width="2.2" style="stroke:var(--human)"/>',
  person: '<circle cx="10" cy="6.5" r="3"/><path d="M4 17c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/>',
  hum: '<path d="M3 12c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0"/><circle cx="16.5" cy="5" r="1.2" fill="currentColor"/>',
  tap: '<path d="M8 10V4.5a1.5 1.5 0 0 1 3 0V9l3.6.7a2 2 0 0 1 1.6 2.3l-.8 4.5H9.2L5.5 12a1.4 1.4 0 0 1 2.1-1.9z"/>',
  pencil: '<path d="M13.5 3.5l3 3L7 16H4v-3z"/>',
  scissors: '<circle cx="5.5" cy="6" r="2"/><circle cx="5.5" cy="14" r="2"/><path d="M7.2 7.2L16 15M7.2 12.8L16 5"/>',
  magnet: '<path d="M5 3.5v6a5 5 0 0 0 10 0v-6h-3v6a2 2 0 0 1-4 0v-6zM5 6.5h3M12 6.5h3"/>',
  code: '<path d="M7 6l-4 4 4 4M13 6l4 4-4 4"/>',
  spiral:
    '<path d="M10 10.2c0-.5.5-.9 1-.8.9.2 1.2 1.2.8 2-.6 1.2-2.2 1.4-3.2.6-1.4-1.1-1.3-3.2 0-4.3 1.8-1.5 4.6-1 5.8.9 1.5 2.3.6 5.4-1.7 6.7-2.9 1.6-6.5.4-7.9-2.5"/>',
  dot: '<circle cx="10" cy="10" r="3" fill="currentColor" stroke="none"/>',
  send: '<path d="M3.5 10l13-6-4.5 13-2.5-5z"/>',
  bolt: '<path d="M11 2.5L4.5 11H10l-1 6.5L15.5 9H10z"/>',
  // open it big: a square with an arrow out of its corner (the track header's instrument, at 12 px)
  open: '<path d="M9 4.5H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11M12 4.5h3.5V8M15.5 4.5L9.5 10.5"/>',
};
export function icon(name, { size = 18, title = '' } = {}) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.dot}</svg>`;
  if (title) span.title = title;
  return span;
}
export const ICONS = Object.keys(P);

// Pointer drag with capture. drag(el, { start(e) -> false to cancel, move(e, dx, dy), end(e, dx, dy) })
export function drag(el, { start, move, end, button = 0 } = {}) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== button) return;
    if (start && start(e) === false) return;
    const x0 = e.clientX,
      y0 = e.clientY;
    el.setPointerCapture(e.pointerId);
    const mv = (ev) => move && move(ev, ev.clientX - x0, ev.clientY - y0);
    const up = (ev) => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch (_) {
        /* gone */
      }
      end && end(ev, ev.clientX - x0, ev.clientY - y0);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    e.preventDefault();
  });
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const fmtDb = (db) => (db <= -60 ? '−∞' : (db > 0 ? '+' : db < 0 ? '−' : '') + Math.abs(db).toFixed(1));
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// A device pixel ratio-aware canvas sized to its CSS box. Returns { cv, g, w, h, dpr, fit() }.
export function canvas(cls = '') {
  const cv = document.createElement('canvas');
  if (cls) cv.className = cls;
  const g = cv.getContext('2d');
  const o = {
    cv,
    g,
    w: 0,
    h: 0,
    dpr: 1,
    fit() {
      const r = cv.getBoundingClientRect(),
        dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width)),
        hh = Math.max(1, Math.round(r.height));
      if (w !== o.w || hh !== o.h || dpr !== o.dpr) {
        o.w = w;
        o.h = hh;
        o.dpr = dpr;
        cv.width = w * dpr;
        cv.height = hh * dpr;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
      }
      return false;
    },
  };
  return o;
}
// Read a CSS custom property (resolved) from :root, e.g. tok('--accent').
export function tok(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
// The colour of an author (warm for people, cool for agents).
export function authorColor(app, by) {
  return app && app.store && app.store.isAgent && app.store.isAgent(by) ? 'var(--agent)' : 'var(--human)';
}

// Who an author id is: { kind: 'human' | 'agent' | 'house', name }. Asks the store when there is one (it knows guests
// and MCP clients by name); without one, reads the id ('you', 'claude', 'claude.ai', 'mcp:<name>', 'overdub',
// 'guest:<name>-<browser>'). Nobody (null) is the house.
export function authorOf(by, app = null) {
  if (by == null || by === '' || by === 'overdub' || by === 'house') return { kind: 'house', name: 'the house' };
  // display only (the community shelf's credit: ui/community.js), never an op's by: 'author:<handle>' is a person,
  // 'agent:<name>' the agent that wrote it
  if (typeof by === 'string' && /^author:./.test(by)) return { kind: 'human', name: by.slice(7) };
  if (typeof by === 'string' && /^agent:./.test(by)) return { kind: 'agent', name: by.slice(6) };
  let a = null;
  try {
    a = app && app.store && app.store.author ? app.store.author(by) : null;
  } catch {
    a = null;
  }
  if (a && a.kind)
    return {
      kind: a.kind === 'agent' ? 'agent' : a.kind === 'house' ? 'house' : 'human',
      name: a.kind === 'house' ? 'the house' : a.name || String(by),
    };
  const id = String(by);
  if (id === 'you') return { kind: 'human', name: 'You' };
  if (id === 'claude' || id === 'claude.ai') return { kind: 'agent', name: 'Claude' };
  if (id.startsWith('mcp:')) return { kind: 'agent', name: id.slice(4) || 'Agent' };
  if (id.startsWith('guest:')) return { kind: 'human', name: id.slice(6).replace(/-[^-]*$/, '') || 'Guest' };
  return { kind: 'human', name: id };
}

// A byline: the author's name in their ink, at the size of the text it signs ("tapped by you", "Firefly, by Claude").
// Authorship in Overdub is a signature, never a stripe, a tint or a fill (design/LINER-NOTES-KIT.md). People sign in
// warm ink (.by-human), agents in cool (.by-agent); the house is unsigned, so it returns null (h() skips it).
//   byline('claude')                       -> <span class="by by-agent" data-by="claude">Claude</span>
//   byline('you')                          -> "you" (lower case: a byline reads mid-phrase); { cap: true } -> "You"
//   byline(c.by, { app })                  -> asks the store (guests, MCP clients by name)
//   byline(by, { name: 'Claude (remote)' }) -> your own wording, same ink
// On paper (inside .paper) the inks deepen to --ink-human / --ink-agent by CSS, so the same call works there.
export function byline(by, { app = null, name = null, cap = false, title = null, tag = 'span' } = {}) {
  const a = authorOf(by, app);
  if (a.kind === 'house') return null;
  let text = name != null ? String(name) : a.name;
  if (name == null && by === 'you' && !cap) text = 'you';
  const kind = a.kind === 'agent' ? 'agent' : 'human';
  return h(`${tag}.by.by-${kind}`, { dataset: { by: String(by) }, title: title || null }, text);
}
