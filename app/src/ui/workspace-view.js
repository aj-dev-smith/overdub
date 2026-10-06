// Which view a load opens in, and what this browser keeps about its layout. Pure (no DOM, no globals), so Node tests it
// with a fake storage (anything with getItem). ui/workspace.js holds the rest of the seam.
//
//   localStorage['overdub:workspace'] = { v: 1, view: 'simple' | 'full', added: { [featureId]: by } }
//
// The layout is never a song op: not in the store, not undone by ⌘Z, never in a share link. Put away undoes an add.

export const WORKSPACE_KEY = 'overdub:workspace';
export const VIEWS = ['simple', 'full'];
// a browser that has used the studio before this seam existed: it keeps the full studio it knows
export const EXISTING_KEYS = ['overdub:layout', 'overdub:welcomed', 'overdub:project'];

const get = (storage, key) => { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } };

// What's kept, cleaned: a missing, unreadable or foreign value reads as nothing kept.
export function readSaved(storage) {
  const out = { v: 1, view: null, added: {} };
  let s = null;
  try { s = JSON.parse(get(storage, WORKSPACE_KEY) || 'null'); } catch (e) { s = null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
  if (VIEWS.includes(s.view)) out.view = s.view;
  if (s.added && typeof s.added === 'object' && !Array.isArray(s.added)) {
    for (const [id, by] of Object.entries(s.added)) if (typeof id === 'string' && id && typeof by === 'string' && by) out.added[id] = by;
  }
  return out;
}

// The view this load opens in, in order: ?view= (this load only), the saved view, full under a test browser
// (navigator.webdriver), full for an existing user, else simple. -> { view, persist, from, round? }
// persist: write the view to storage now (the last two: the choice is made once, then remembered).
// ?view=round (a prototype, ui/round.js) is the simple view with the song drawn as a circle on top: round: true, for
// this load only, never written down.
export function decideView({ search = '', storage = null, webdriver = false } = {}) {
  let q = null;
  try { q = new URLSearchParams(search || '').get('view'); } catch (e) { q = null; }
  if (VIEWS.includes(q)) return { view: q, persist: false, from: 'url' };
  if (q === 'round') return { view: 'simple', persist: false, from: 'url', round: true };
  const saved = readSaved(storage);
  if (saved.view) return { view: saved.view, persist: false, from: 'saved' };
  if (webdriver) return { view: 'full', persist: false, from: 'webdriver' };
  if (EXISTING_KEYS.some((k) => get(storage, k) != null)) return { view: 'full', persist: true, from: 'existing' };
  return { view: 'simple', persist: true, from: 'new' };
}
