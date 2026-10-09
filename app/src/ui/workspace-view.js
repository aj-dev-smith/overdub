// @ts-check
// Which view a load opens in, and what this browser keeps about its layout. Pure (no DOM, no globals), so Node tests it
// with a fake storage (anything with getItem). ui/workspace.js holds the rest of the seam.
//
//   localStorage['overdub:workspace'] = { v: 1, view: 'simple' | 'full', added: { [featureId]: by } }
//
// The layout is never a song op: not in the store, not undone by ⌘Z, never in a share link. Put away undoes an add.

export const WORKSPACE_KEY = 'overdub:workspace';
export const VIEWS = ['simple', 'full'];

const get = (storage, key) => { try { return storage ? storage.getItem(key) : null; } catch { return null; } };

// What's kept, cleaned: a missing, unreadable or foreign value reads as nothing kept.
export function readSaved(storage) {
  const out = { v: 1, view: null, added: {} };
  let s = null;
  try { s = JSON.parse(get(storage, WORKSPACE_KEY) || 'null'); } catch { s = null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
  if (VIEWS.includes(s.view)) out.view = s.view;
  if (s.added && typeof s.added === 'object' && !Array.isArray(s.added)) {
    for (const [id, by] of Object.entries(s.added)) if (typeof id === 'string' && id && typeof by === 'string' && by) out.added[id] = by;
  }
  return out;
}

// The view this load opens in. One studio: the full one, everything on screen, for everyone. ?view=simple (this load
// only) still opens the simple view for one release, so its checks can retire in order; ?view=round (a prototype,
// ui/round.js) is the simple view with the song drawn as a circle on top: round: true, for this load only. Neither is
// written down. A browser that had the simple view saved opens the full studio too (from: 'merged': the studio says
// so once, ui/workspace.js). -> { view, persist, from, round? }
export function decideView({ search = '', storage = null, webdriver = false } = {}) {
  let q = null;
  try { q = new URLSearchParams(search || '').get('view'); } catch { q = null; }
  if (VIEWS.includes(q)) return { view: q, persist: false, from: 'url' };
  if (q === 'round') return { view: 'simple', persist: false, from: 'url', round: true };
  const saved = readSaved(storage);
  if (saved.view === 'simple') return { view: 'full', persist: false, from: 'merged' };
  if (saved.view) return { view: saved.view, persist: false, from: 'saved' };
  return { view: 'full', persist: false, from: webdriver ? 'webdriver' : 'default' };
}
