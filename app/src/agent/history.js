// The History tab (region 'right', order 20): the song's edit story, newest first, set as a track sheet
// (design/LINER-NOTES-KIT.md): one signed line per change, the time in the margin, the player's name in their ink
// (warm for you, cool for an agent; the house is unsigned), what changed, why (an agent's reason, in italic) and where
// (in mono). Click a line to see what it touched; undo one author's latest change; revert everything one agent did
// while keeping your edits. Above the lines, who wrote the notes, as a labelled strip of tape.
//
// Reasons: tools.js stores an agent's reason on the transaction (txn.reason), so History can show "why".

import { h, css, byline } from '../ui/dom.js';
import { opsSummary, targetsOf } from './diff.js';

export default function (app) {
  css('agent-history', CSS);
  app.ui.panel({ id: 'history', region: 'right', title: 'History', icon: 'history', order: 20, mount: (el) => mount(el, app) });
}

// The share of the notes in the song by author, in tape order: people, then agents, then the house (unsigned).
// -> { total, parts: [{ by, kind, name, n, pct }] }   (pure: tools/agent-test.js checks it in Node)
export function noteShares(project, author) {
  const per = new Map();
  let total = 0;
  for (const t of project.tracks || []) for (const c of t.clips || []) for (const n of c.notes || []) {
    const by = n.by || c.by || 'you';
    per.set(by, (per.get(by) || 0) + 1);
    total++;
  }
  const rank = { human: 0, agent: 1, house: 2 };
  const parts = [...per].map(([by, n]) => { const a = author(by); return { by, kind: a.kind === 'agent' ? 'agent' : a.kind === 'house' ? 'house' : 'human', name: a.name, n }; });
  // the house's ids (the demo, Band) are one share: it's unsigned, so it reads as one strip of pencil
  const house = parts.filter((p) => p.kind === 'house');
  const merged = [...parts.filter((p) => p.kind !== 'house'), ...(house.length ? [{ by: house[0].by, kind: 'house', name: 'Overdub', n: house.reduce((s, p) => s + p.n, 0) }] : [])];
  if (!merged.some((p) => p.by === 'you')) merged.push({ by: 'you', kind: 'human', name: author('you').name, n: 0 });
  merged.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.by === 'you' ? -1 : b.by === 'you' ? 1 : b.n - a.n));
  for (const p of merged) p.pct = total ? Math.round((100 * p.n) / total) : 0;
  return { total, parts: merged };
}

function mount(el, app) {
  const { store, ui } = app;
  el.classList.add('hi');
  let filter = 'all';
  let dirty = true;
  let lastLen = -1;

  const share = h('div.hi-share');
  const filters = h('div.hi-filters', { role: 'tablist', 'aria-label': 'Filter by author' });
  const actions = h('div.hi-actions');
  const list = h('ol.hi-list.ledger', { 'aria-label': 'Changes, newest first' });
  const empty = h('div.hi-empty.empty', h('p', 'Nothing on tape yet. Every change lands here, signed with who made it and why.'),
    h('button.btn', { type: 'button', onclick: () => ui.show?.('sketch') }, 'Open Sketch'));
  el.append(h('div.hi-top', share, h('div.hi-frow', filters, actions)), list, empty);

  const kindOf = (by) => store.author(by).kind;     // human | agent | house
  const authorsIn = () => {
    const seen = new Map();
    for (const t of store.history) if (!t.audition) seen.set(t.by, (seen.get(t.by) || 0) + 1);
    return seen;
  };
  // a name in its ink; the house signs nothing, so its lines carry a pencil "Overdub" for the eye and nothing more
  const sign = (by, opts = {}) => byline(by, { app, cap: true, ...opts }) || h('span.hi-house', store.author(by).name || 'Overdub');

  function render() {
    dirty = false;
    const hist = store.history.filter((t) => !t.audition);
    lastLen = store.history.length;
    // who wrote the notes: a strip of tape (the inks laid end to end, pencil for the house), labelled underneath
    const { total, parts } = noteShares(store.get(), (by) => store.author(by));
    const shown = parts.filter((p) => p.n > 0);
    share.replaceChildren(
      h('header.sheet-head.hi-share-h', h('h3', 'Who wrote the notes'), h('span.aside.mono', `${total} note${total === 1 ? '' : 's'}`)),
      h('div.hi-bar', { role: 'img', 'aria-label': total ? shown.map((p) => `${p.name} ${p.pct}%`).join(', ') : 'No notes yet' },
        total ? shown.map((p) => h(`i.hi-b-${p.kind}`, { style: { flexGrow: p.n }, title: `${p.name}: ${p.n} note${p.n === 1 ? '' : 's'}` })) : h('i.hi-b-none')),
      h('div.hi-legend', parts.filter((p) => p.n > 0 || p.by === 'you').map((p) => h('span.hi-lg', p.kind === 'house' ? h('span.hi-house', p.name) : sign(p.by), ' ', h('span.mono', `${p.pct}%`)))),
      forkLine(store.get().meta?.forkedFrom, app) || ''); // (replaceChildren prints a null as the text "null")

    // filters: underlined words with their counts
    const auth = authorsIn();
    const chips = [['all', 'All', hist.length]];
    for (const [by, n] of auth) chips.push([by, store.author(by).name, n]);
    if (filter !== 'all' && !auth.has(filter)) filter = 'all';
    filters.replaceChildren(...chips.map(([id, name, n]) => h(`button.hi-filter${filter === id ? '.on' : ''}${id !== 'all' ? '.k-' + kindOf(id) : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(filter === id), onclick: () => { filter = id; render(); } }, name, h('span.mono', String(n)))));

    // revert, one for each agent with changes
    const agents = [...auth.keys()].filter((by) => store.isAgent(by));
    actions.replaceChildren(...agents.map((by) => h('button.btn.btn-txt.hi-revert', { type: 'button', title: `Undo everything ${store.author(by).name} changed, keeping every edit you made in between`, onclick: () => revertAll(by) }, `Revert all ${store.author(by).name}'s changes (keep mine)`)));

    const rows = hist.slice().reverse().filter((t) => filter === 'all' || t.by === filter).slice(0, 300);
    list.replaceChildren(...rows.map(row));
    empty.hidden = rows.length > 0;
  }

  function row(t) {
    const k = kindOf(t.by);
    const latestOfAuthor = [...store.history].reverse().find((x) => x.by === t.by && !x.audition) === t;
    const summary = opsSummary(t.ops, store.get(), { getDevice: app.devices?.getDevice });   // lane edits read in words: "wrote Keyhole cutoff, bars 9–12: 600 Hz → 4.5 kHz"
    const undoBtn = h('button.btn.btn-txt.hi-undo', { type: 'button', title: latestOfAuthor ? `Undo this (${store.author(t.by).name}'s latest change)` : 'Undo works newest-first per author', onclick: (e) => { e.stopPropagation(); undoOne(t, latestOfAuthor); } }, 'Undo');
    if (!latestOfAuthor) undoBtn.classList.add('dim');
    return h(`li.hi-row.ledger-row.k-${k}`, { tabIndex: 0, title: 'Show what this touched', onclick: () => point(t), onkeydown: (e) => { if (e.key === 'Enter') point(t); } },
      h('span.when.hi-time', { title: new Date(t.at).toLocaleString() }, clock(t.at)),
      h('span.hi-who', sign(t.by)),
      h('span.what.hi-label', t.label || '(change)', t.pickedBy ? h('span.hi-picked', ', picked by ', byline(t.pickedBy, { app }) || 'you') : t.keptBy ? h('span.hi-picked', ', kept by ', byline(t.keptBy, { app }) || 'you') : null,
        t.reason ? h('span.why.hi-reason', t.reason) : null,
        summary ? h('span.where.hi-sum', summary.replace(/ · /g, ', ')) : null),
      undoBtn);
  }

  function point(t) {
    const tg = targetsOf(t.ops, store.get(), {}, t.inverse);
    const track = tg.tracks.find((id) => store.track(id)) || null;
    const clip = tg.clips.find((id) => store.findClip(id)) || null;
    if (!track && !clip) { ui.toast('That change has no track or clip to show (it was undone, or it is song-wide)'); return; }
    ui.select({ track: track || store.findClip(clip)?.track.id || null, clip, notes: [] });
    app.presence?.highlight({ track, clip }, t.label, t.by, 2500);
  }
  // A revert from here is an undo, so it can be redone: ⌘⇧Z, or Redo on the toast (which redoes this one only, while
  // it is still the next redo)
  const redoAction = () => {
    const top = store.redoable[store.redoable.length - 1];
    return { label: 'Redo', run: () => {
      if (store.redoable[store.redoable.length - 1] !== top) { ui.toast('That can’t be redone now: the song changed since.'); return; }
      const r = store.redo();
      if (!r.ok) ui.toast(r.error, { kind: 'bad' });
    } };
  };
  function undoOne(t, latest) {
    if (!latest) { ui.toast(`Undo goes newest-first for each author: undo ${store.author(t.by).name}'s later changes first, or use Revert all.`); return; }
    const r = store.undo({ by: t.by });
    ui.toast(r.ok ? `Undid "${r.txn.label}"` : `Couldn't undo it: ${r.error.replace(/^could not undo: /, '')}. A later edit builds on it.`, { kind: r.ok ? 'info' : 'bad', ...(r.ok ? { action: redoAction() } : {}) });
  }
  function revertAll(by) {
    const name = store.author(by).name;
    const r = store.revertAuthor(by);
    if (!r.reverted && !r.skipped.length) { ui.toast(`${name} has no changes to revert`); return; }
    ui.toast(`Reverted ${r.reverted} of ${name}'s change${r.reverted === 1 ? '' : 's'}; yours are untouched.${r.skipped.length ? ` ${r.skipped.length} couldn't be reverted (later edits build on them).` : ''}`, { kind: r.skipped.length ? 'bad' : 'agent', ms: 4500, ...(r.reverted ? { action: redoAction() } : {}) });
  }

  const offs = [ui.on('history:annotate', () => { dirty = true; })];
  let tick = 0;
  return {
    update() { dirty = true; },
    frame(now) { if (dirty || store.history.length !== lastLen || now - tick > 15000) { tick = now; render(); } },
    refresh() { render(); },
    unmount() { for (const o of offs) o(); },
  };
}

// A forked song (ui/share.js, "Make it yours") says where it came from: the original's title and who played on it,
// each signed in their ink.
function forkLine(f, app) {
  if (!f) return null;
  const people = (f.authors || []).filter((a) => a.kind !== 'house');
  const list = people.length ? people : f.authors || [];
  const who = [];
  list.slice(0, 4).forEach((a, i) => {
    if (i) who.push(i === Math.min(list.length, 4) - 1 ? ' and ' : ', ');
    who.push(a.kind === 'house' ? h('span.hi-house', a.name) : h(`span.by.by-${a.kind === 'agent' ? 'agent' : 'human'}`, { dataset: { by: a.id || '' } }, a.name));
  });
  const when = f.at ? new Date(f.at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return h('p.hi-fork', { title: 'Parts from the original keep their authors. The list below starts at the fork.' },
    'Forked from “', f.title || 'Untitled', '”', who.length ? [' by ', ...who] : null, when ? `, ${when}` : '');
}

function clock(at) {
  try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; }
}

const CSS = `
.hi { display: flex; flex-direction: column; background: var(--bg-2); }
.hi-top { padding: 16px 18px 0; display: flex; flex-direction: column; position: sticky; top: 0; background: var(--bg-2); z-index: 1; }
.hi-share-h > h3 { font-size: 17px; }
.hi-share-h .aside { font-size: 11px; }
/* the tape: the inks laid end to end, pencil for the house; a hairline of the ground between authors */
.hi-bar { display: flex; height: 8px; margin-top: 12px; gap: 1px; background: var(--bg-2); }
.hi-bar i { display: block; min-width: 2px; flex-basis: 0; }
.hi-b-human { background: var(--human); } .hi-b-agent { background: var(--agent); } .hi-b-house { background: var(--line-2); } .hi-b-none { flex: 1; background: var(--line); }
.hi-legend { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-top: 8px; font-size: 12.5px; color: var(--text-2); }
.hi-lg { white-space: nowrap; }
.hi-lg .by { font-size: 12.5px; }
.hi-lg .mono { color: var(--text-2); }
.hi-house { color: var(--text-3); font-weight: 400; }
.hi-fork { margin: 10px 0 0; font-size: 12px; color: var(--text-2); line-height: 1.45; }
.hi-fork .by { font-size: 12px; }
/* filters are underlined words; the revert is one more, on the right */
.hi-frow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; margin-top: 14px; padding-bottom: 8px; border-bottom: var(--rule); }
.hi-filters { display: flex; gap: 16px; overflow-x: auto; scrollbar-width: none; }
.hi-filter { display: inline-flex; align-items: baseline; gap: 4px; height: 26px; padding: 0; border: 0; background: none; color: var(--text-3); font: 600 12.5px var(--font-ui); cursor: pointer; white-space: nowrap; }
.hi-filter .mono { font-size: 11px; color: var(--text-3); font-weight: 400; }
.hi-filter:hover { color: var(--text-2); }
.hi-filter.on { color: var(--text); text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 6px; }
.hi-filter:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.hi-actions { display: flex; flex-wrap: wrap; gap: 2px 14px; margin-left: auto; } .hi-actions:empty { display: none; }
.hi-revert { font-size: 12px; font-weight: 400; }
/* the ledger: time, who, what (why, where) and Undo, one hairline under each */
.hi-list { --ledger-cols: 40px 62px minmax(0, 1fr) auto; padding: 0 18px 18px; }
.hi-list > li.hi-row { cursor: pointer; padding-inline: 18px; margin-inline: -18px; }
.hi-row:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.hi-who { min-width: 0; font-size: 12px; line-height: 1.35; }
.hi-who .by { font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
.hi-label { min-width: 0; line-height: 1.4; overflow-wrap: anywhere; }
.hi-picked { color: var(--text-3); font-size: 12px; }
.hi-picked .by { font-size: 12px; }
.hi-sum { display: block; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hi-undo { font-size: 12px; opacity: 0; }
.hi-row:hover .hi-undo, .hi-row:focus-within .hi-undo, .hi-row:focus .hi-undo { opacity: 1; }
.hi-undo.dim { opacity: 0; color: var(--text-3); } .hi-row:hover .hi-undo.dim { opacity: .6; }
@media (hover: none) { .hi-undo { opacity: 1; } }
.hi-empty { padding: 18px; }
.hi-empty[hidden] { display: none; }
@media (max-width: 900px) {
  .hi-top { position: static; }
  .ew-shell .hi-share-h .aside, .ew-shell .hi-legend .mono, .ew-shell .hi-filter .mono, .ew-shell .hi-list .when, .ew-shell .hi-list .where { font-size: 12px; }
}
@media (max-width: 900px) { .hi-top { padding: 14px 16px 0; } .hi-list { padding: 0 16px 16px; } .hi-list > li.hi-row { padding-inline: 16px; margin-inline: -16px; } }
`;
