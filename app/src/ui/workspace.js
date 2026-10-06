// The workspace: which of the studio's features are on screen. Two views: the full studio (everything, as it always
// was) and the simple view (every feature below put away until someone adds it). Simple is the same studio with parts
// hidden: one studio, one undo, one set of panels.
//
// Hiding is by tag: a part carries data-feature="<id>" (several ids, space-separated), a panel maps to its feature
// here (FEATURES[].panels), and the root element carries .ws-simple or .ws-full plus .ws-off-<id> for each put-away
// feature; one generated stylesheet hides [data-feature~="<id>"] under .ws-off-<id> (display: none, so a hidden control
// leaves the tab order and the accessibility tree). An untagged part is always shown.
//
// Things appear only when someone reaches for them: More (by hand), a key, a panel shown (ui.show), or an agent's
// workspace tool; every appearance is signed (by: 'you' or an agent id) and says so in the note slot.
//
// Layout is never a song op: not in the store, not undone by ⌘Z, never in a share link (ui/workspace-view.js keeps it
// in localStorage 'overdub:workspace'). Put away is how an add is undone.
//
// Other modules never import this file: they tag parts with data-feature and call app.ui.workspace?.… so each works
// with or without it. installWorkspace(ui, app, decision) is called by main.js straight after createShell.

import { h, css, byline, authorOf } from './dom.js';
import { WORKSPACE_KEY, VIEWS, readSaved } from './workspace-view.js';

// The registry. Ids are forever. Copy is final (docs/BRAND.md voice): the purpose is what More says, in a musician's
// words. the: the note says "the Mixer". panels: panel ids (their region in region). where: where it is on screen,
// in a line (an agent says it). quiet: reaching for it says nothing (the killswitch stays silent).
export const GROUPS = ['Make', 'Sound', 'Balance', 'Song', 'Recording', 'Agent', 'Files', 'Layout'];
export const FEATURES = [
  { id: 'notes', group: 'Make', title: 'Notes', purpose: 'Edit a part’s notes one by one.', panels: ['pianoroll'], region: 'bottom', where: 'the Notes tab, under the song', aliases: ['piano roll', 'midi', 'melody', 'edit notes'] },
  { id: 'beat', group: 'Make', title: 'Beat grid', the: true, purpose: 'Click a drum pattern in, square by square.', panels: ['drumgrid'], region: 'bottom', where: 'the Beat tab, under the song', aliases: ['drum grid', 'steps', 'sequencer', 'drums'] },
  { id: 'grooves', group: 'Make', title: 'Grooves', purpose: 'Drum patterns by style, ready to drop in.', panels: ['grooves'], region: 'bottom', where: 'the Grooves tab, under the song', aliases: ['genre', 'patterns', 'loops'] },
  { id: 'jam', group: 'Make', title: 'Guitar', purpose: 'The Jam room: play guitar over the song, with tab and amps.', panels: ['jam'], region: 'center', where: 'the Jam tab, beside Arrange', aliases: ['jam', 'guitar', 'tab', 'fretboard', 'amp'] },
  { id: 'devices', group: 'Sound', title: 'Sound', purpose: 'The instrument and effects on a track, and their knobs.', panels: ['rack'], region: 'bottom', where: 'the Devices tab, under the song', aliases: ['rack', 'devices', 'effects', 'knobs', 'preset'] },
  { id: 'browser', group: 'Sound', title: 'Instruments and effects', purpose: 'Every instrument, effect and guitar rig, to try or add.', panels: ['browser'], region: 'left', where: 'the Browser, left of the song', aliases: ['browser', 'library', 'reverb', 'delay', 'synth', 'rigs'] },
  { id: 'mixer', group: 'Balance', title: 'Mixer', the: true, purpose: 'How loud each part is, and where it sits left to right.', panels: ['mixer'], region: 'bottom', where: 'the Mixer tab, under the song', aliases: ['levels', 'volume', 'faders', 'pan', 'mix'] },
  { id: 'compare', group: 'Balance', title: 'Compare', purpose: 'Hold your mix up against a track you like.', panels: ['reference'], region: 'bottom', where: 'the Reference tab, under the song', aliases: ['reference', 'loudness', 'lufs', 'match'] },
  { id: 'meters', group: 'Balance', title: 'Level meter', the: true, quiet: true, purpose: 'How loud the whole song is playing, and All off.', panels: [], where: 'the top bar, right of the transport', aliases: ['meter', 'panic', 'all off', 'loud'] },
  { id: 'loop', group: 'Song', title: 'Loop', purpose: 'Play a few bars round and round.', panels: [], where: 'the Loop button in the top bar, and the loop strip on the ruler', aliases: ['loop', 'cycle', 'repeat'] },
  { id: 'position', group: 'Song', title: 'Where you are', purpose: 'Bar and beat of the playhead, and the beat lights.', panels: [], where: 'the top bar, beside Play', aliases: ['position', 'counter', 'bar', 'beat'] },
  { id: 'song-settings', group: 'Song', title: 'Song settings', purpose: 'Beats per bar, tap the tempo, the click.', panels: [], where: 'the top bar, beside the tempo', aliases: ['meter', 'time signature', 'tap tempo', 'click', 'metronome'] },
  { id: 'tracks', group: 'Song', title: 'Track tools', purpose: 'Add tracks, snap, zoom, and colours.', panels: [], where: 'the bar over the tracks', aliases: ['add track', 'snap', 'zoom', 'fit', 'follow', 'colour', 'sections'] },
  { id: 'redo', group: 'Song', title: 'Redo', purpose: 'Put back what Undo took away.', panels: [], where: 'the top bar, beside Undo', aliases: ['redo'] },
  { id: 'record-options', group: 'Recording', title: 'Recording options', purpose: 'Count-in, layering takes and timing.', panels: [], where: 'Sketch, and each track’s header', aliases: ['count-in', 'arm', 'layer', 'quantise', 'timing'] },
  { id: 'history', group: 'Agent', title: 'History', purpose: 'Everything that changed, who changed it, and how to take it back.', panels: ['history'], region: 'right', where: 'the History tab, beside the agent', aliases: ['history', 'changes', 'revert', 'log'] },
  { id: 'details', group: 'Agent', title: 'Details', purpose: 'Exact values for whatever is selected.', panels: ['inspector'], region: 'left', where: 'the Inspector tab, left of the song', aliases: ['inspector', 'properties'] },
  { id: 'agent-setup', group: 'Agent', title: 'Connect your own agent', purpose: 'Use your own Claude, or Claude Code on this computer.', panels: [], where: 'the agent pane', aliases: ['claude code', 'mcp', 'api key', 'model', 'connect'] },
  { id: 'files', group: 'Files', title: 'Files and reports', purpose: 'Import MIDI, audio and devices; export stems, MIDI and DAWproject; who-made-what reports.', panels: [], where: 'the Song menu', aliases: ['import', 'export', 'stems', 'midi', 'dawproject', 'provenance'] },
  { id: 'panes', group: 'Layout', title: 'Pane buttons', purpose: 'Buttons to show and hide the side and bottom panes.', panels: [], where: 'the right end of the top bar', aliases: ['panes', 'sidebar'] },
];
const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));
const OF_PANEL = new Map(FEATURES.flatMap((f) => f.panels.map((p) => [p, f.id])));

// the copy (docs/BRAND.md; spec section 6)
const T = {
  full: 'Full studio', fullTitle: 'Show every panel and control. Your song stays as it is.',
  simple: 'Simple view', simpleTitle: 'Hide what you’re not using. Nothing is removed; add anything back from More.',
  more: 'More', moreTitle: 'Everything that’s put away, and how to add it',
  find: 'Find something: mixer, piano roll, loop…',
  none: 'Nothing called that. Ask your agent where it is.',
  add: 'Add', put: 'Put away',
  toFull: 'Show the full studio', toSimple: 'Back to the simple view', hides: 'Simple view hides these. Nothing is removed.',
};
const NOTE_MS = 6000, PUT_MS = 3000;

// Search: the whole query against titles and aliases first, then every word somewhere. Lower rank is better; null is
// no match.
export function rank(f, query) {
  const q = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return 0;
  const title = f.title.toLowerCase(), aliases = f.aliases.map((a) => a.toLowerCase()), purpose = f.purpose.toLowerCase();
  const words = (s) => s.split(/[^a-z0-9]+/).filter(Boolean);
  if (title === q || title.startsWith(q)) return 0;
  if (words(title).some((w) => w.startsWith(q))) return 1;
  if (aliases.some((a) => a === q || a.startsWith(q))) return 2;
  if (aliases.some((a) => words(a).some((w) => w.startsWith(q)))) return 3;
  if (title.includes(q) || aliases.some((a) => a.includes(q))) return 4;
  const hay = [title, ...aliases, purpose, f.id].join(' ');
  const qs = words(q);
  if (qs.length && qs.every((w) => words(hay).some((x) => x.startsWith(w)))) return 5;
  return null;
}

// "Mixer", "Mixer and Notes", "Mixer, Notes and Loop"; the: "the Mixer"
function names(ids, { the = false, bold = true } = {}) {
  const parts = ids.map((id) => { const f = BY_ID.get(id); return [the && f.the ? 'the ' : '', bold ? h('b', f.title) : f.title]; });
  const out = [];
  parts.forEach((p, i) => { if (i) out.push(i === parts.length - 1 ? ' and ' : ', '); out.push(...p); });
  return out;
}

export function installWorkspace(ui, app, decision = { view: 'full' }) {
  const html = document.documentElement;
  let storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  const saved = readSaved(storage);
  let view = VIEWS.includes(decision?.view) ? decision.view : 'full';
  if (decision?.persist) saved.view = view;
  const added = { ...saved.added };   // { featureId: by }; unknown ids are kept (a later version's), never shown
  const persist = () => {
    const out = { v: 1, added };
    if (saved.view) out.view = saved.view;
    try { storage?.setItem(WORKSPACE_KEY, JSON.stringify(out)); } catch (e) { /* private mode: this visit only */ }
  };
  if (decision?.persist) persist();

  const known = (id) => BY_ID.has(id);
  const has = (id) => view === 'full' || !known(id) || added[id] != null;
  const hidden = () => (view === 'full' ? [] : FEATURES.filter((f) => added[f.id] == null).map((f) => f.id));

  // the one generated stylesheet, and the root's classes
  css('workspace-off', FEATURES.map((f) => `.ws-off-${f.id} [data-feature~="${f.id}"] { display: none !important; }`).join('\n'));
  css('workspace', WS_CSS);
  function apply() {
    for (const c of [...html.classList]) if (c.startsWith('ws-')) html.classList.remove(c);
    html.classList.add(view === 'full' ? 'ws-full' : 'ws-simple');
    for (const id of hidden()) html.classList.add('ws-off-' + id);
    placeButtons();
    viewBtn.textContent = view === 'full' ? T.simple : T.full;
    viewBtn.title = view === 'full' ? T.simpleTitle : T.fullTitle;
  }
  // The simple view's top bar holds More and Full studio. The full studio's top bar is full (at 1280 px the two
  // buttons push out the title, Loop, the meter and Redo), so while the agent pane is open on a wide screen they sit at
  // the end of its tab row (ui.wsSide). With that pane closed on a wide screen they come back to the top bar, so the
  // way back to the simple view is never out of sight. Under 900 px the top bar has no room, and the agent is a sheet:
  // they stay in its tab row, and the Song menu offers Simple view too (ui/export.js).
  const NARROW = window.matchMedia?.('(max-width: 900px)');
  function placeButtons() {
    const side = view === 'full' && ui.wsSide && (ui.isOpen?.('right') || NARROW?.matches);
    const host = side ? ui.wsSide : box;
    box.classList.toggle('ws-here', host === box);
    if (moreBtn.parentNode !== host) {
      const had = document.activeElement === viewBtn ? viewBtn : document.activeElement === moreBtn ? moreBtn : null;
      host.append(moreBtn, viewBtn);
      had?.focus({ preventScroll: true });
      return true;
    }
    return false;
  }
  ui.on?.('resize', () => { if (placeButtons()) ui.fitTop?.(true); });
  function changed() {
    apply();
    ui.emit('workspace', { view, hidden: hidden() });
    if (moreOpen) renderMore();
    ui.fitTop?.(true);
  }

  /* ------------------------------------------------ the top bar's corner: the note slot, More, the view switch */
  const note = h('div.ws-note', { role: 'status', 'aria-live': 'polite' });
  const moreBtn = h('button.btn.ws-more-btn', { type: 'button', title: T.moreTitle, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => (moreOpen ? closeMore() : openMore()) }, T.more);
  const viewBtn = h('button.btn.ws-view', { type: 'button', onclick: () => setView(view === 'full' ? 'simple' : 'full') });
  const box = ui.wsBox || h('div.ew-ws');
  box.append(note, moreBtn, viewBtn);
  const topBar = box.closest('.ew-top');

  let noteT = 0;
  function say(kids, ms, put = null) {
    clearTimeout(noteT);
    const t = h('span.ws-note-t', kids);
    if (put) note.replaceChildren(t, h('button.btn.btn-txt.ws-note-put', { type: 'button', onclick: () => api.putAway(put, { by: 'you' }) }, T.put));
    else note.replaceChildren(t);   // replaceChildren(t, null) would print the word null
    topBar?.classList.add('ws-noting');
    noteT = setTimeout(clearNote, ms);
  }
  function clearNote() {
    clearTimeout(noteT);
    // focus on its Put away goes back to More rather than out of the page
    if (note.contains(document.activeElement)) moreBtn.focus({ preventScroll: true });
    note.replaceChildren();
    topBar?.classList.remove('ws-noting');
  }

  /* ------------------------------------------------ the API */
  function add(ids, { by = 'you', note: withNote = true } = {}) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(known))];
    const now = [], already = [];
    for (const id of list) { if (added[id] != null || view === 'full') { if (added[id] == null) added[id] = by; already.push(id); } else { added[id] = by; now.push(id); } }
    if (!list.length) return { added: now, already };
    persist();
    changed();
    const loud = now.filter((id) => !BY_ID.get(id).quiet);
    if (withNote && view === 'simple' && loud.length) {
      const who = String(by || 'you');
      if (authorOf(who, app).kind === 'agent') say([byline(who, { app }), ' added ', ...names(loud, { the: true }), '.'], NOTE_MS, loud);
      else say([...names(loud), loud.length > 1 ? ' are' : ' is', ' in your studio now.'], NOTE_MS, loud);
    }
    return { added: now, already };
  }
  const agentBy = (by) => by != null && by !== 'you' && authorOf(String(by), app).kind === 'agent';
  function putAway(ids, { by = 'you' } = {}) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(known))].filter((id) => added[id] != null);
    for (const id of list) delete added[id];
    if (!list.length) return { put: [] };
    persist();
    changed();
    if (view === 'simple') say(agentBy(by) ? [byline(String(by), { app }), ' put away ', ...names(list, { the: true }), '. It’s in More.'] : ['Put away ', ...names(list), '. It’s in More.'], PUT_MS);
    return { put: list };
  }
  function setView(v, { by = 'you' } = {}) {
    if (!VIEWS.includes(v) || v === view) return view;
    const bottomGoes = v === 'simple' && ui.active?.('bottom') && OF_PANEL.has(ui.active('bottom')) && added[OF_PANEL.get(ui.active('bottom'))] == null;
    view = v; saved.view = v;
    persist();
    // ?view= was for that load: off the address, so a reload opens the view chosen now
    try { const u = new URL(location.href); if (u.searchParams.has('view')) { u.searchParams.delete('view'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } } catch (e) { /* fine */ }
    clearNote();
    // an agent's switch is signed (the person asked it to); theirs needs no note, the screen is the answer
    if (agentBy(by)) say([byline(String(by), { app }), ' switched to the ', v === 'full' ? 'full studio' : 'simple view', '.'], PUT_MS);
    if (v === 'simple') {
      ui.setOpen?.('left', false);
      if (bottomGoes) ui.setOpen?.('bottom', false);
      changed();
    } else {
      changed();
      // the full studio opens its panes (today's default; a phone's side panes stay sheets you open)
      const narrow = window.matchMedia?.('(max-width: 900px)').matches;
      for (const r of narrow ? ['bottom'] : ['left', 'bottom', 'right']) if (!ui.isOpen?.(r)) ui.setOpen?.(r, true);
    }
    return view;
  }
  const api = {
    FEATURES,
    GROUPS,
    view: () => view,
    setView,
    has: (id) => has(id),
    panelShown: (panelId) => { const f = OF_PANEL.get(panelId); return !f || has(f); },
    featureOfPanel: (panelId) => OF_PANEL.get(panelId) || null,
    add,
    putAway,
    // reaching for something put away brings it in, with a note (unless it's quiet); shown already: nothing happens
    reach(id, by = 'you') { if (!known(id) || has(id)) return { added: [], already: known(id) ? [id] : [] }; return add([id], { by: by || 'you', note: true }); },
    list: () => FEATURES.map((f) => ({ id: f.id, group: f.group, title: f.title, purpose: f.purpose, shown: has(f.id), addedBy: added[f.id] ?? null })),
    hidden,
    addedBy: (id) => added[id] ?? null,
    where: (id) => BY_ID.get(id)?.where || null,
    openMore: (o) => openMore(o),
    closeMore: () => closeMore(),
  };
  ui.workspace = api;
  apply();

  // the first screen in simple: no side panes and no detail pane until something opens them (a door, D, a reach).
  // Only on a browser with no layout of its own yet; a returning person's panes stay as they left them (one left with
  // nothing shown in it closes at 'ready', ui/shell.js).
  if (view === 'simple') {
    let fresh = true;
    try { fresh = storage?.getItem('overdub:layout') == null; } catch (e) { /* fresh */ }
    if (fresh) for (const r of ['left', 'bottom']) { if (ui.isOpen?.(r)) ui.setOpen?.(r, false, { save: false }); }
  }

  /* ------------------------------------------------ More: a popover on a wide screen, a bottom sheet on a phone */
  let moreOpen = null;   // { el, find, list, away }
  const PHONE = window.matchMedia('(max-width: 640px)');
  const hiddenEl = (el) => !!el && el.getClientRects().length === 0;
  function openMore({ query = '' } = {}) {
    if (moreOpen) { moreOpen.find.value = query || moreOpen.find.value; renderMore(); moreOpen.find.focus({ preventScroll: true }); return api; }
    const find = h('input.ws-find', { type: 'search', placeholder: T.find, 'aria-label': 'Find something', autocomplete: 'off', spellcheck: false, value: query || '' });
    find.addEventListener('input', () => renderMore());
    const quick = h('div.ws-quick');
    const list = h('div.ws-list');
    const foot = h('div.ws-foot');
    const el = h('div.ew-pop.ws-more', { role: 'dialog', 'aria-label': 'More' }, quick, h('div.ws-findrow', find), list, foot);
    document.body.append(el);
    const back = document.activeElement && document.activeElement !== document.body ? document.activeElement : moreBtn;
    const away = (e) => {
      if (el.contains(e.target) || moreBtn.contains(e.target)) return;
      closeMore({ refocus: false });
      // a phone's sheet covers the song: the tap that puts it away goes no further (it never moves the playhead or
      // drops the selection under it); the top bar's buttons still act on the first tap
      if (PHONE.matches && !e.target?.closest?.('.ew-top')) {
        e.preventDefault(); e.stopPropagation();
        const eat = (c) => { c.preventDefault(); c.stopPropagation(); };
        window.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', eat, true), 500);
      }
    };
    setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    // focus that leaves it (Tab past its last row, Shift+Tab out of the search) puts it away too
    el.addEventListener('focusout', (e) => { const to = e.relatedTarget; if (to && !el.contains(to) && !moreBtn.contains(to)) closeMore({ refocus: false }); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); closeMore(); } });
    window.addEventListener('resize', place);
    moreOpen = { el, find, list, quick, foot, away, back };
    moreBtn.setAttribute('aria-expanded', 'true');
    renderMore();
    place();
    find.focus({ preventScroll: true });
    return api;
  }
  function place() {
    if (!moreOpen) return;
    const { el } = moreOpen;
    if (PHONE.matches) { el.style.left = ''; el.style.top = ''; return; }
    const r = moreBtn.getBoundingClientRect(), w = el.offsetWidth;
    el.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    el.style.top = (r.bottom + 6) + 'px';
  }
  function closeMore({ refocus = true } = {}) {
    if (!moreOpen) return;
    const { el, away } = moreOpen;
    window.removeEventListener('pointerdown', away, true);
    window.removeEventListener('resize', place);
    const had = el.contains(document.activeElement);
    el.remove();
    moreOpen = null;
    moreBtn.setAttribute('aria-expanded', 'false');
    if (refocus || had) moreBtn.focus({ preventScroll: true });
  }
  // the phone's first rows: what the top row gave up (the view switch, and whichever of Song, Tempo and Key the top
  // bar has put out of sight on a narrow screen)
  function renderQuick() {
    const { quick } = moreOpen;
    const kids = [];
    if (hiddenEl(viewBtn)) kids.push(h('button.ws-q.ws-q-view', { type: 'button', onclick: () => { closeMore(); setView(view === 'full' ? 'simple' : 'full'); } }, h('b', view === 'full' ? T.simple : T.full), h('small', view === 'full' ? T.simpleTitle : T.fullTitle)));
    const songB = document.querySelector('.ew-region-top .sm-btn');
    if (songB && hiddenEl(songB)) kids.push(h('button.ws-q', { type: 'button', onclick: () => { closeMore({ refocus: false }); if (app.exporter?.openMenu) app.exporter.openMenu(moreBtn); else songB.click(); } }, h('b', 'Song'), h('small', 'New, open, save, share, export')));
    const tempoEl = document.querySelector('.ew-region-top .tp-tempo');
    if (tempoEl && hiddenEl(tempoEl)) {
      const s = app.store.get();
      const inp = h('input.ws-q-in', { type: 'text', inputmode: 'decimal', value: String(s.tempo), 'aria-label': 'Tempo in BPM' });
      const commit = () => {
        const v = Number(inp.value.replace(',', '.'));
        if (!Number.isFinite(v)) { inp.value = String(app.store.get().tempo); return; }
        if (app.transport?.locked?.()) { ui.toast('The tempo waits until the take is in.'); inp.value = String(app.store.get().tempo); return; }
        const t = Math.min(400, Math.max(20, Math.round(v * 100) / 100));
        if (t !== app.store.get().tempo) app.store.dispatch({ type: 'project.set', patch: { tempo: t } }, { by: 'you', label: `tempo ${t}` });
        if (t !== v) ui.toast('Tempo goes from 20 to 400 BPM');
        inp.value = String(t);
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); inp.select(); } if (e.key === 'Escape') { e.preventDefault(); closeMore(); } });
      kids.push(h('label.ws-q', h('b', 'Tempo'), h('span.ws-q-v', inp, h('small', 'BPM'))));
    }
    const keyEl = document.querySelector('.ew-region-top .tp-key');
    if (keyEl && hiddenEl(keyEl)) {
      const k = app.store.get().key;
      kids.push(h('button.ws-q', { type: 'button', onclick: () => { closeMore({ refocus: false }); if (app.transport?.openKey) app.transport.openKey(moreBtn); else keyEl.click(); } }, h('b', 'Key'), h('small', k ? `${k.root} ${k.scale}` : 'none')));
    }
    quick.replaceChildren(...kids);
    quick.hidden = !kids.length;
  }
  function row(f) {
    const by = added[f.id];
    const agentAdded = by != null && authorOf(by, app).kind === 'agent';
    const isAdded = by != null;
    const b = h('button.btn.ws-row-b', { type: 'button', dataset: { ws: f.id }, 'aria-label': `${isAdded ? T.put : T.add}: ${f.title}`, onclick: () => {
      if (added[f.id] != null) { putAway([f.id], { by: 'you' }); return; }
      add([f.id], { by: 'you' });
      // a feature with a panel opens on it, so the add is seen
      if (f.panels[0] && ui.panels?.has(f.panels[0])) ui.show(f.panels[0], { by: 'you' });
    } }, isAdded ? T.put : T.add);
    // in the full studio everything is on screen: the rows say what each thing is, with nothing to add or put away
    return h('div.ws-row', { dataset: { ws: f.id } },
      h('div.ws-row-w', h('b.ws-row-t', f.title), agentAdded ? h('small.ws-row-by', 'added by ', byline(by, { app })) : null, h('span.ws-row-p', f.purpose)),
      view === 'full' ? null : b);
  }
  function renderMore() {
    if (!moreOpen) return;
    const { list, foot, find } = moreOpen;
    const focusId = document.activeElement?.closest?.('.ws-row')?.dataset.ws || null;
    renderQuick();
    const q = find.value.trim();
    const kids = [];
    if (q) {
      const hits = FEATURES.map((f, i) => ({ f, r: rank(f, q), i })).filter((x) => x.r != null).sort((a, b) => a.r - b.r || a.i - b.i);
      if (!hits.length) kids.push(h('p.ws-none', T.none));
      for (const { f } of hits) kids.push(row(f));
    } else {
      for (const g of GROUPS) {
        const fs = FEATURES.filter((f) => f.group === g);
        if (!fs.length) continue;
        kids.push(h('div.ws-group', { role: 'group', 'aria-label': g }, h('div.ws-head', { 'aria-hidden': 'true' }, g), fs.map(row)));
      }
    }
    list.replaceChildren(...kids);
    foot.replaceChildren(
      h('button.btn.btn-txt.ws-foot-b', { type: 'button', onclick: () => { closeMore(); setView(view === 'full' ? 'simple' : 'full'); } }, view === 'full' ? T.toSimple : T.toFull),
      view === 'full' ? null : h('small.ws-foot-s', T.hides));
    if (focusId) list.querySelector(`.ws-row[data-ws="${focusId}"] .ws-row-b`)?.focus({ preventScroll: true });
    place();
  }

  return api;
}

const WS_CSS = `
.ew-ws-side .btn { height: 28px; }
@media (max-width: 900px) { .ew-ws-side .btn { height: 40px; } }
/* the top bar's corner: the note slot (empty until something is added or put away), More, the view switch */
.ew-ws .btn { height: 30px; }
.ws-note { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 380px; overflow: hidden; white-space: nowrap; font-size: 12.5px; color: var(--text-2); }
/* empty, it stays in the accessibility tree (a live region that appears with its message is often not read) */
.ws-note:empty { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); }
.ws-note-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ws-note b { color: var(--text); font-weight: 600; }
.ws-note .by { font-weight: 600; }
.ws-note-put { flex: none; }
/* More: typographic rows in the liner-notes style, the type of the tabs; no stripes, no pills */
.ew-pop.ws-more { position: fixed; z-index: 900; width: 380px; max-width: calc(100vw - 16px); max-height: min(72vh, 620px); overflow: auto; padding: 0;
  background: var(--bg-3); border: var(--rule-2); border-radius: 0; box-shadow: var(--shadow-2); animation: ew-in .16s var(--ease, ease) both; }
.ws-findrow { position: sticky; top: 0; z-index: 1; padding: 10px 12px; background: var(--bg-3); border-bottom: var(--rule); }
.ws-find { width: 100%; height: 32px; padding: 0 10px; border: var(--rule-2); border-radius: var(--r-press); background: var(--bg); color: var(--text); font: inherit; font-size: 13px; }
.ws-find:focus { outline: 2px solid var(--accent-2); outline-offset: -1px; }
.ws-list { padding: 0 12px; }
.ws-head { padding: 14px 0 4px; color: var(--text-3); font-size: 13px; font-weight: 600; }
.ws-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: var(--rule); }
.ws-group > .ws-row:last-child, .ws-list > .ws-row:last-child { border-bottom: 0; }
.ws-row-w { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ws-row-t { font-size: 13px; font-weight: 600; color: var(--text); }
.ws-row-by { font-size: 12px; color: var(--text-3); }
.ws-row-p { font-size: 12px; line-height: 1.4; color: var(--text-2); }
.ws-row-b { flex: none; min-width: 72px; }
.ws-none { margin: 0; padding: 18px 0; color: var(--text-2); font-size: 13px; }
.ws-foot { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; border-top: var(--rule); }
.ws-foot-s { font-size: 12px; color: var(--text-3); }
.ws-quick[hidden] { display: none; }
.ws-quick { padding: 4px 12px; border-bottom: var(--rule); }
.ws-q { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 6px 0; border: 0; border-bottom: var(--rule); background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.ws-q:last-child { border-bottom: 0; }
.ws-q b { font-size: 13px; font-weight: 600; }
.ws-q small { font-size: 12px; color: var(--text-2); text-align: right; }
.ws-q-v { display: inline-flex; align-items: center; gap: 6px; }
.ws-q-in { width: 72px; height: 36px; padding: 0 8px; border: var(--rule-2); border-radius: var(--r-press); background: var(--bg); color: var(--text); font: 600 14px var(--font-mono); text-align: right; }
.ws-q-in:focus { outline: 2px solid var(--accent-2); outline-offset: -1px; }
.ws-q:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
/* a phone: the view switch moves into More (its first row), More opens as a bottom sheet at up to 70% of the height,
   and the note is a slim line along the foot of the top bar, inside its height */
@media (max-width: 640px) {
  .ew-ws { margin-left: 0; padding-left: 0; border-left: 0; height: auto; }
  .ew-shell .ew-top > .ew-ws { order: 12; margin-left: 4px; }   /* the end of the transport's row (app/style/app.css) */
  .ew-ws .ws-view { display: none; }
  .ew-ws .btn { height: 40px; }
  .ew-top { position: relative; }
  .ew-top.ws-noting { padding-bottom: 26px; }
  .ws-note { position: absolute; left: 0; right: 0; bottom: 0; height: 26px; max-width: none; padding: 0 max(12px, env(safe-area-inset-left)); border-top: var(--rule); background: var(--bg); font-size: 12px; }
  .ws-note .btn-txt { min-height: 26px; }
  .ew-pop.ws-more { left: 0; right: 0; top: auto; bottom: 0; width: 100%; max-width: none; max-height: 70vh; max-height: 70dvh; border: 0; border-top: var(--rule-heavy);
    box-shadow: 0 -12px 30px -12px #000; padding-bottom: env(safe-area-inset-bottom); animation: ew-sheet-up .22s var(--ease, ease) both; }
  .ws-row { min-height: 52px; }
  .ws-row-b { min-height: 40px; }
  .ws-foot-b { min-height: 40px; }
  .ws-find { height: 40px; font-size: 16px; }
}
`;
