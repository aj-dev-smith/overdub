// The workspace: the studio's features, by name, and Find. One studio: everything is on screen, for everyone, and
// Find anything (⌘K, the top bar) reaches any of it: a panel or control (Go to), anything a key does (Do), a sound to
// try on the selected track (Sound), a page of the guide (Help), or, last, the words asked of Claude (Ask).
//
// The feature registry (FEATURES) is Find's index of the studio's parts. A part carries data-feature="<id>" (several
// ids, space-separated) and a panel maps to its feature here (FEATURES[].panels), so Go to can show it and point at it.
//
// ?view=simple (one release, a URL only, never saved) is still the simple view: the root carries .ws-simple plus
// .ws-off-<id> for each feature put away, one generated stylesheet hides [data-feature~="<id>"] under .ws-off-<id>
// (display: none), and reaching for a part (Find, a key, a panel shown) brings it back, signed, with a note. ?view=round
// (ui/round.js) is drawn over it. Nothing is hidden anywhere else.
//
// Layout is never a song op: not in the store, not undone by ⌘Z, never in a share link (ui/workspace-view.js keeps what
// there is in localStorage 'overdub:workspace').
//
// Other modules never import this file: they tag parts with data-feature and call app.ui.workspace?.… so each works
// with or without it. installWorkspace(ui, app, decision) is called by main.js straight after createShell.

import { h, css, byline, authorOf } from './dom.js';
import { kitHashes, kitState, kitLine, prefetchKit } from './kitload.js';
import { WORKSPACE_KEY, VIEWS, readSaved } from './workspace-view.js';

// The registry. Ids are forever. Copy is final (docs/BRAND.md voice): the purpose is what More says, in a musician's
// words. the: the note says "the Mixer". panels: panel ids (their region in region). where: where it is on screen,
// in a line (an agent says it). quiet: reaching for it says nothing (the killswitch stays silent).
export const GROUPS = ['Make', 'Sound', 'Balance', 'Song', 'Recording', 'Agent', 'Files', 'Layout'];
export const FEATURES = [
  {
    id: 'notes',
    group: 'Make',
    title: 'Notes',
    purpose: 'Edit a part’s notes one by one.',
    panels: ['pianoroll'],
    region: 'bottom',
    where: 'the Notes tab, under the song',
    aliases: ['piano roll', 'midi', 'melody', 'edit notes'],
  },
  {
    id: 'beat',
    group: 'Make',
    title: 'Beat grid',
    the: true,
    purpose: 'Click a drum pattern in, square by square.',
    panels: ['drumgrid'],
    region: 'bottom',
    where: 'the Beat tab, under the song',
    aliases: ['drum grid', 'steps', 'sequencer', 'drums'],
  },
  {
    id: 'grooves',
    group: 'Make',
    title: 'Grooves',
    purpose: 'Drum patterns by style, ready to drop in.',
    panels: ['grooves'],
    region: 'bottom',
    where: 'the Grooves tab, under the song',
    aliases: ['genre', 'patterns', 'loops'],
  },
  {
    id: 'jam',
    group: 'Make',
    title: 'Guitar',
    purpose: 'The Jam room: play guitar over the song, with tab and amps.',
    panels: ['jam'],
    region: 'center',
    where: 'the Jam tab, beside Arrange',
    aliases: ['jam', 'guitar', 'tab', 'fretboard', 'amp'],
  },
  {
    id: 'devices',
    group: 'Sound',
    title: 'Sound',
    purpose: 'The instrument and effects on a track, and their knobs.',
    panels: ['rack'],
    region: 'bottom',
    where: 'the Devices tab, under the song',
    aliases: ['rack', 'devices', 'effects', 'knobs', 'preset'],
  },
  {
    id: 'browser',
    group: 'Sound',
    title: 'Instruments and effects',
    purpose: 'Every instrument, effect and guitar rig, to try or add.',
    panels: ['browser'],
    region: 'left',
    where: 'the Browser, left of the song',
    aliases: ['browser', 'library', 'reverb', 'delay', 'synth', 'rigs'],
  },
  {
    id: 'mixer',
    group: 'Balance',
    title: 'Mixer',
    the: true,
    purpose: 'How loud each part is, and where it sits left to right.',
    panels: ['mixer'],
    region: 'bottom',
    where: 'the Mixer tab, under the song',
    aliases: ['levels', 'volume', 'faders', 'pan', 'mix'],
  },
  {
    id: 'compare',
    group: 'Balance',
    title: 'Compare',
    purpose: 'Hold your mix up against a track you like.',
    panels: ['reference'],
    region: 'bottom',
    where: 'the Reference tab, under the song',
    aliases: ['reference', 'loudness', 'lufs', 'match'],
  },
  {
    id: 'meters',
    group: 'Balance',
    title: 'Level meter',
    the: true,
    quiet: true,
    purpose: 'How loud the whole song is playing, and All off.',
    panels: [],
    where: 'the top bar, right of the transport',
    aliases: ['meter', 'panic', 'all off', 'loud'],
  },
  {
    id: 'loop',
    group: 'Song',
    title: 'Loop',
    purpose: 'Play a few bars round and round.',
    panels: [],
    where: 'the Loop button in the top bar, and the loop strip on the ruler',
    aliases: ['loop', 'cycle', 'repeat'],
  },
  {
    id: 'position',
    group: 'Song',
    title: 'Where you are',
    purpose: 'Bar and beat of the playhead, and the beat lights.',
    panels: [],
    where: 'the top bar, beside Play',
    aliases: ['position', 'counter', 'bar', 'beat'],
  },
  {
    id: 'song-settings',
    group: 'Song',
    title: 'Song settings',
    purpose: 'Beats per bar, tap the tempo, the click.',
    panels: [],
    where: 'the top bar, beside the tempo',
    aliases: ['meter', 'time signature', 'tap tempo', 'click', 'metronome'],
  },
  {
    id: 'tracks',
    group: 'Song',
    title: 'Track tools',
    purpose: 'Add tracks, snap, zoom, and colours.',
    panels: [],
    where: 'the bar over the tracks',
    aliases: ['add track', 'snap', 'zoom', 'fit', 'follow', 'colour', 'sections'],
  },
  {
    id: 'redo',
    group: 'Song',
    title: 'Redo',
    purpose: 'Put back what Undo took away.',
    panels: [],
    where: 'the top bar, beside Undo',
    aliases: ['redo'],
  },
  {
    id: 'record-options',
    group: 'Recording',
    title: 'Recording options',
    purpose: 'Count-in, layering takes and timing.',
    panels: [],
    where: 'Sketch, and each track’s header',
    aliases: ['count-in', 'arm', 'layer', 'quantise', 'timing'],
  },
  {
    id: 'history',
    group: 'Agent',
    title: 'History',
    purpose: 'Everything that changed, who changed it, and how to take it back.',
    panels: ['history'],
    region: 'right',
    where: 'the History tab, beside the agent',
    aliases: ['history', 'changes', 'revert', 'log'],
  },
  {
    id: 'details',
    group: 'Agent',
    title: 'Details',
    purpose: 'Exact values for whatever is selected.',
    panels: ['inspector'],
    region: 'left',
    where: 'the Inspector tab, left of the song',
    aliases: ['inspector', 'properties'],
  },
  {
    id: 'agent-setup',
    group: 'Agent',
    title: 'Connect your own agent',
    purpose: 'Use your own Claude, or Claude Code on this computer.',
    panels: [],
    where: 'the agent pane',
    aliases: ['claude code', 'mcp', 'api key', 'model', 'connect'],
  },
  {
    id: 'files',
    group: 'Files',
    title: 'Files and reports',
    purpose: 'Import MIDI, audio and devices; export stems, MIDI and DAWproject; who-made-what reports.',
    panels: [],
    where: 'the Song menu',
    aliases: ['import', 'export', 'stems', 'midi', 'dawproject', 'provenance'],
  },
  {
    id: 'panes',
    group: 'Layout',
    title: 'Pane buttons',
    purpose: 'Buttons to show and hide the side and bottom panes.',
    panels: [],
    where: 'the right end of the top bar',
    aliases: ['panes', 'sidebar'],
  },
];
const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));
const OF_PANEL = new Map(FEATURES.flatMap((f) => f.panels.map((p) => [p, f.id])));

// the copy (docs/BRAND.md)
const T = {
  full: 'Full studio',
  fullTitle: 'Show every panel and control. Your song stays as it is.',
  find: 'Find anything',
  findTitle: 'Find anything: a panel, an action, a sound or help',
  field: 'Find anything: mixer, loop, a sound, a question…',
  empty: 'Every panel is here. Type what you’re after: mixer, loop, tempo, piano roll.',
  none: 'Nothing called that. Ask Claude where it is.',
  merged: 'One studio now: everything’s on screen, and Find (⌘K) gets you anywhere.',
  put: 'Put away',
  hides: 'The simple view, for this visit. Full studio shows everything.',
  kinds: { go: 'Go to', do: 'Do', sound: 'Sound', help: 'Help', ask: 'Ask' },
};
const NOTE_MS = 6000,
  PUT_MS = 3000;

// Search: the whole query against titles and aliases first, then every word somewhere. Lower rank is better; null is
// no match.
export function rank(f, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!q) return 0;
  const title = f.title.toLowerCase(),
    aliases = f.aliases.map((a) => a.toLowerCase()),
    purpose = f.purpose.toLowerCase();
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
  const parts = ids.map((id) => {
    const f = BY_ID.get(id);
    return [the && f.the ? 'the ' : '', bold ? h('b', f.title) : f.title];
  });
  const out = [];
  parts.forEach((p, i) => {
    if (i) out.push(i === parts.length - 1 ? ' and ' : ', ');
    out.push(...p);
  });
  return out;
}

// what a key is called on its button: ⌘K, ⇧K, Space, /
const MODK =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
    ? '⌘'
    : 'Ctrl+';
const KEYNAME = {
  Space: 'Space',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '−',
  Equal: '=',
  Backquote: '`',
  Escape: 'Esc',
  Enter: 'Enter',
  Delete: 'Delete',
  Backspace: '⌫',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Home: 'Home',
  End: 'End',
};
export function keyText(k) {
  const base =
    KEYNAME[k.key] ||
    String(k.key || '')
      .replace(/^Key/, '')
      .replace(/^Digit/, '');
  const mods = String(k.mod || '')
    .split('+')
    .filter(Boolean);
  return (
    (mods.includes('mod') ? MODK : '') + (mods.includes('alt') ? '⌥' : '') + (mods.includes('shift') ? '⇧' : '') + base
  );
}
const LIMIT = { go: 6, do: 6, sound: 6, help: 4 };
const KIND_ORDER = ['go', 'do', 'sound', 'help'];

export function installWorkspace(ui, app, decision = { view: 'full' }) {
  const html = document.documentElement;
  let storage = null;
  try {
    storage = window.localStorage;
  } catch (e) {
    storage = null;
  }
  const saved = readSaved(storage);
  let view = VIEWS.includes(decision?.view) ? decision.view : 'full';
  const added = { ...saved.added }; // { featureId: by }; unknown ids are kept (a later version's), never shown
  const persist = () => {
    const out = { v: 1, added };
    if (saved.view) out.view = saved.view;
    try {
      storage?.setItem(WORKSPACE_KEY, JSON.stringify(out));
    } catch (e) {
      /* private mode: this visit only */
    }
  };
  // a browser that had the simple view saved: the full studio now, said once (overdub:start.merged)
  if (decision?.from === 'merged') {
    saved.view = 'full';
    persist();
    let said = false;
    try {
      said = !!storage?.getItem('overdub:start.merged');
    } catch (e) {
      said = false;
    }
    if (!said) {
      try {
        storage?.setItem('overdub:start.merged', '1');
      } catch (e) {
        /* once a visit, then */
      }
      ui.on?.('ready', () => ui.toast?.(T.merged.replace('⌘K', `${MODK}K`), { ms: 8000 })); // (Ctrl+K off a Mac)
    }
  }

  const known = (id) => BY_ID.has(id);
  const has = (id) => view === 'full' || !known(id) || added[id] != null;
  const hidden = () => (view === 'full' ? [] : FEATURES.filter((f) => added[f.id] == null).map((f) => f.id));

  // the simple view's stylesheet (generated only once something opens it: ?view=simple, or setView) and the root's
  // classes
  css('workspace', WS_CSS);
  function apply() {
    if (view === 'simple')
      css(
        'workspace-off',
        FEATURES.map((f) => `.ws-off-${f.id} [data-feature~="${f.id}"] { display: none !important; }`).join('\n'),
      );
    for (const c of [...html.classList]) if (c.startsWith('ws-')) html.classList.remove(c);
    html.classList.add(view === 'full' ? 'ws-full' : 'ws-simple');
    for (const id of hidden()) html.classList.add('ws-off-' + id);
    viewBtn.hidden = view === 'full';
    placeButtons();
  }
  // Find sits at the end of the top bar. While the agent pane is open on a wide screen it sits at the end of that
  // pane's tab row (ui.wsSide) instead, so the top bar keeps its room (at 1280 px it pushes out the title, Loop, the
  // meter and Redo); with the pane closed it comes back to the top bar. From 641 to 900 px the agent is a sheet that
  // is mostly closed, so Find stays in the top bar. A phone's top bar, upright or on its side, has no room left (Find
  // would take a row of its own, or push Stop out): it is a row of the Song menu there, and sits at the end of the
  // agent sheet's tab row. The simple view keeps it, and Full studio, in the top bar.
  const NARROW = window.matchMedia?.('(max-width: 900px)'),
    PHONE_W = window.matchMedia?.('(max-width: 640px), (max-height: 500px) and (max-width: 900px)');
  function placeButtons() {
    const side = view === 'full' && ui.wsSide && (PHONE_W?.matches || (ui.isOpen?.('right') && !NARROW?.matches));
    const host = side ? ui.wsSide : box;
    box.classList.toggle('ws-here', host === box);
    if (findBtn.parentNode !== host) {
      const had = document.activeElement === viewBtn ? viewBtn : document.activeElement === findBtn ? findBtn : null;
      host.append(findBtn, viewBtn);
      had?.focus({ preventScroll: true });
      return true;
    }
    return false;
  }
  ui.on?.('resize', () => {
    if (placeButtons()) ui.fitTop?.(true);
  });
  function changed() {
    apply();
    ui.emit('workspace', { view, hidden: hidden() });
    if (findOpen) renderFind();
    ui.fitTop?.(true);
  }

  /* ------------------------------------------------ the top bar's corner: the note slot, Find, (simple) Full studio */
  const note = h('div.ws-note', { role: 'status', 'aria-live': 'polite' });
  const findBtn = h(
    'button.btn.ws-more-btn.ws-find-btn',
    {
      type: 'button',
      title: `${T.findTitle} (${MODK}K)`,
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-keyshortcuts': MODK === '⌘' ? 'Meta+K' : 'Control+K',
      onclick: () => (findOpen ? closeFind() : openFind()),
    },
    h('span.ws-find-l', 'Find', h('span.ws-find-x', ' anything')),
    h('kbd.ws-find-k', `${MODK}K`),
  );
  const viewBtn = h(
    'button.btn.ws-view',
    { type: 'button', title: T.fullTitle, onclick: () => setView('full') },
    T.full,
  );
  const box = ui.wsBox || h('div.ew-ws');
  box.append(note, findBtn, viewBtn);
  const topBar = box.closest('.ew-top');

  let noteT = 0;
  function say(kids, ms, put = null) {
    clearTimeout(noteT);
    const t = h('span.ws-note-t', kids);
    if (put)
      note.replaceChildren(
        t,
        h('button.btn.btn-txt.ws-note-put', { type: 'button', onclick: () => api.putAway(put, { by: 'you' }) }, T.put),
      );
    else note.replaceChildren(t); // replaceChildren(t, null) would print the word null
    topBar?.classList.add('ws-noting');
    noteT = setTimeout(clearNote, ms);
  }
  function clearNote() {
    clearTimeout(noteT);
    if (note.contains(document.activeElement)) findBtn.focus({ preventScroll: true });
    note.replaceChildren();
    topBar?.classList.remove('ws-noting');
  }

  /* ------------------------------------------------ the API */
  // (add and put away are the simple view's: in the full studio there is nothing to add)
  function add(ids, { by = 'you', note: withNote = true } = {}) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(known))];
    const now = [],
      already = [];
    for (const id of list) {
      if (added[id] != null || view === 'full') already.push(id);
      else {
        added[id] = by;
        now.push(id);
      }
    }
    if (!now.length) return { added: now, already };
    persist();
    changed();
    const loud = now.filter((id) => !BY_ID.get(id).quiet);
    if (withNote && loud.length) {
      const who = String(by || 'you');
      if (authorOf(who, app).kind === 'agent')
        say([byline(who, { app }), ' added ', ...names(loud, { the: true }), '.'], NOTE_MS, loud);
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
    if (view === 'simple')
      say(
        agentBy(by)
          ? [byline(String(by), { app }), ' put away ', ...names(list, { the: true }), '.']
          : ['Put away ', ...names(list), '.'],
        PUT_MS,
      );
    return { put: list };
  }
  // the simple view's way out (Full studio): the full studio, for good (the simple view is a URL only)
  function setView(v, { by = 'you' } = {}) {
    if (!VIEWS.includes(v) || v === view) return view;
    view = v;
    if (v === 'full') {
      saved.view = 'full';
      persist();
    }
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('view')) {
        u.searchParams.delete('view');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      }
    } catch (e) {
      /* fine */
    }
    clearNote();
    if (agentBy(by))
      say(
        [byline(String(by), { app }), ' switched to the ', v === 'full' ? 'full studio' : 'simple view', '.'],
        PUT_MS,
      );
    changed();
    if (v === 'full') {
      const narrow = window.matchMedia?.('(max-width: 900px)').matches;
      for (const r of narrow ? ['bottom'] : ['bottom', 'right']) if (!ui.isOpen?.(r)) ui.setOpen?.(r, true);
    } else {
      ui.setOpen?.('left', false);
    }
    return view;
  }
  // Go to: the feature in view (brought back first in the simple view), its panel shown, and the control pointed at
  // for two seconds: a pencil outline, unsigned when it's yours, in the agent's ink when an agent asked
  let pointT = 0,
    pointed = null;
  function go(id, { by = 'you', query = findOpen?.find.value.trim() || '' } = {}) {
    const f = BY_ID.get(id);
    if (!f) return false;
    api.reach(id, by);
    const panel = f.panels.find((p) => ui.panels?.has?.(p)) || null;
    try {
      if (panel) ui.show?.(panel, { by });
    } catch (e) {
      /* pointing is the answer */
    }
    const el = panel
      ? null
      : [...document.querySelectorAll(`[data-feature~="${id}"]`)].find((x) => x.getClientRects().length);
    if (el) {
      clearTimeout(pointT);
      pointed?.classList.remove('ws-pointed', 'ws-pointed-agent');
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      el.classList.add('ws-pointed');
      if (agentBy(by)) el.classList.add('ws-pointed-agent');
      pointed = el;
      pointT = setTimeout(() => {
        el.classList.remove('ws-pointed', 'ws-pointed-agent');
        pointed = null;
      }, 2000);
    }
    ui.emit('workspace:go', { id, query, by }); // (query: what Find was asked, so a shelf word opens the Browser on the shelf)
    return true;
  }
  const api = {
    FEATURES,
    GROUPS,
    view: () => view,
    setView,
    has: (id) => has(id),
    panelShown: (panelId) => {
      const f = OF_PANEL.get(panelId);
      return !f || has(f);
    },
    featureOfPanel: (panelId) => OF_PANEL.get(panelId) || null,
    add,
    putAway,
    go,
    // reaching for something put away brings it in, with a note (unless it's quiet); shown already: nothing happens
    reach(id, by = 'you') {
      if (!known(id) || has(id)) return { added: [], already: known(id) ? [id] : [] };
      return add([id], { by: by || 'you', note: true });
    },
    list: () =>
      FEATURES.map((f) => ({
        id: f.id,
        group: f.group,
        title: f.title,
        purpose: f.purpose,
        shown: has(f.id),
        addedBy: added[f.id] ?? null,
      })),
    hidden,
    addedBy: (id) => added[id] ?? null,
    where: (id) => BY_ID.get(id)?.where || null,
    // Find (More was its name in the simple view: openMore stays an alias)
    openFind: (o) => openFind(o),
    closeFind: () => closeFind(),
    openMore: (o) => openFind(o),
    closeMore: () => closeFind(),
    search: (q) => search(q),
  };
  ui.workspace = api;
  app.find = { open: (o) => openFind(o), close: () => closeFind(), search: (q) => search(q) };
  apply();
  // ⌘K anywhere, a field included: Find (again: its field)
  ui.keys?.add?.({
    key: 'KeyK',
    mod: 'mod',
    global: true,
    run: () => openFind(),
    label: 'Find anything',
    group: 'View',
  });

  // the simple view's first screen: no side panes and no detail pane until something opens them (a door, D, a reach).
  // Only on a browser with no layout of its own yet.
  if (view === 'simple') {
    let fresh = true;
    try {
      fresh = storage?.getItem('overdub:layout') == null;
    } catch (e) {
      /* fresh */
    }
    if (fresh)
      for (const r of ['left', 'bottom']) {
        if (ui.isOpen?.(r)) ui.setOpen?.(r, false, { save: false });
      }
  }

  /* ------------------------------------------------ the sources */
  // Do: every key the studio declares, by its label (modes, keys that only work inside something, are left out)
  function doItems() {
    const seen = new Set(),
      out = [];
    for (const k of ui.keys?.list?.() || []) {
      if (!k.label || k.when || seen.has(k.label)) continue;
      seen.add(k.label);
      out.push({
        kind: 'do',
        id: 'do:' + k.label,
        title: k.label,
        purpose: k.group || '',
        aliases: [k.group || ''].filter(Boolean),
        key: keyText(k),
        run: () => runKey(k),
      });
    }
    return out;
  }
  function runKey(k) {
    const ev = {
      code: k.key,
      key: '',
      shiftKey: /shift/.test(k.mod || ''),
      altKey: /alt/.test(k.mod || ''),
      metaKey: false,
      ctrlKey: false,
      repeat: false,
      target: document.body,
      preventDefault() {},
      stopPropagation() {},
    };
    try {
      k.run(ev);
    } catch (e) {
      console.error('find: key', k.label, e);
    }
    if (k.feature && !app.transport?.locked?.()) {
      try {
        api.reach(k.feature, 'you');
      } catch (e) {
        /* ok */
      }
    }
  }
  // Sound: every instrument and effect, and each preset by name; an instrument tries on the selected track (a trial,
  // with Keep and Back: never an overwrite), anything else opens the Browser on it
  function soundItems() {
    const out = [];
    let defs = [];
    try {
      defs = app.devices?.listDevices?.() || [];
    } catch (e) {
      defs = [];
    }
    for (const d of defs) {
      if (d.kind !== 'instrument' && d.kind !== 'effect') continue;
      const words = [d.kindLabel, d.cat, d.nod].filter(Boolean).map(String);
      out.push({
        kind: 'sound',
        id: 'sound:' + d.id,
        title: d.name,
        purpose: d.blurb || d.kindLabel || '',
        aliases: words,
        def: d,
        preset: null,
      });
      // (a preset's tags are words Find knows it by: "growl", "riddim", "bass music")
      for (const pr of d.presets || [])
        out.push({
          kind: 'sound',
          id: `sound:${d.id}:${pr.name}`,
          title: pr.name,
          purpose: `${d.name}${d.kindLabel ? ', ' + d.kindLabel : ''}`,
          aliases: [d.name, ...words, ...(pr.tags || []).map((x) => x.replace('-', ' '))],
          def: d,
          preset: pr.name,
        });
    }
    return out;
  }
  const selectedTrack = () => {
    try {
      const id = ui.state?.selection?.track;
      const t = id ? app.store.track(id) : null;
      return t && t.kind === 'instrument' ? t : null;
    } catch (e) {
      return null;
    }
  };
  function trySound(it) {
    const t = selectedTrack();
    if (it.def.kind === 'instrument' && t && app.sounds?.try) {
      try {
        app.sounds.offer?.({ track: t.id, from: 'find' });
      } catch (e) {
        /* the trial still plays */
      }
      const r = app.sounds.try(
        t.id,
        { device: it.def.id, ...(it.preset ? { preset: it.preset } : {}) },
        { from: 'find' },
      );
      if (r && r.ok === false && r.error) ui.toast?.(r.error, { kind: 'bad' });
      return;
    }
    app.browser?.search?.(it.def.name);
  }
  // Help: the guide's headings, read once from the site's guide page (no page, no Help rows)
  let helpRows = null,
    helpAsked = false;
  function loadHelp() {
    if (helpAsked) return;
    helpAsked = true;
    const url = new URL('/site/docs/guide.html', location.href); // (as the agent pane links it: the site's tree, here and live)
    fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => {
        if (!txt) {
          helpRows = [];
          return;
        }
        const doc = new DOMParser().parseFromString(txt, 'text/html');
        helpRows = [...doc.querySelectorAll('h2[id], h3[id]')].map((el) => ({
          kind: 'help',
          id: 'help:' + el.id,
          title: el.textContent.trim(),
          purpose: 'the guide',
          aliases: [],
          href: `${url.pathname}#${el.id}`,
        }));
        if (findOpen) renderFind();
      })
      .catch(() => {
        helpRows = [];
      });
  }
  // every source, ranked: the best match first, then Go to, Do, Sound, Help; a few of each
  function search(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const goes = FEATURES.map((f) => ({
      kind: 'go',
      id: 'go:' + f.id,
      title: f.title,
      purpose: f.purpose,
      aliases: f.aliases,
      f,
      key: null,
    }));
    const all = [...goes, ...doItems(), ...soundItems(), ...(helpRows || [])];
    const per = {};
    return all
      .map((it, i) => ({ it, r: rank(it, q), i }))
      .filter((x) => x.r != null)
      .sort((a, b) => a.r - b.r || KIND_ORDER.indexOf(a.it.kind) - KIND_ORDER.indexOf(b.it.kind) || a.i - b.i)
      .filter((x) => {
        per[x.it.kind] = (per[x.it.kind] || 0) + 1;
        return per[x.it.kind] <= LIMIT[x.it.kind];
      })
      .map((x) => x.it);
  }
  function run(it) {
    const q = findOpen?.find.value.trim() || '';
    if (it.kind === 'ask') {
      closeFind({ refocus: false });
      ui.emit('agent:compose', { text: q, send: true });
      return;
    }
    if (it.kind === 'go') {
      closeFind({ refocus: false });
      go(it.f.id, { by: 'you', query: q });
      return;
    }
    if (it.kind === 'do') {
      closeFind();
      it.run();
      return;
    }
    if (it.kind === 'sound') {
      closeFind({ refocus: false });
      trySound(it);
      return;
    }
    if (it.kind === 'help') {
      closeFind();
      try {
        window.open(it.href, '_blank', 'noopener');
      } catch (e) {
        location.href = it.href;
      }
    }
  }

  /* ------------------------------------------------ Find: a popover on a wide screen, a sheet on a phone */
  let findOpen = null; // { el, find, list, quick, foot, away, back, rows, at }
  const PHONE = window.matchMedia('(max-width: 640px)');
  const hiddenEl = (el) => !!el && el.getClientRects().length === 0;
  function openFind({ query = '' } = {}) {
    if (findOpen) {
      if (query) findOpen.find.value = query;
      renderFind();
      findOpen.find.focus({ preventScroll: true });
      findOpen.find.select();
      return api;
    }
    loadHelp();
    const find = h('input.ws-find', {
      type: 'search',
      placeholder: T.field,
      'aria-label': T.find,
      autocomplete: 'off',
      spellcheck: false,
      value: query || '',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'ws-find-list',
      'aria-autocomplete': 'list',
    });
    find.addEventListener('input', () => {
      if (findOpen) findOpen.at = 0;
      renderFind();
    });
    find.addEventListener('keydown', (e) => {
      if (!findOpen) return;
      const n = findOpen.rows.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (n) {
          findOpen.at = (findOpen.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
          paintActive();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const q = find.value.trim();
        if ((e.metaKey || e.ctrlKey) && q) {
          run({ kind: 'ask' });
          return;
        }
        const it = findOpen.rows[findOpen.at];
        if (it) run(it);
      }
    });
    const quick = h('div.ws-quick');
    const list = h('div.ws-list', { id: 'ws-find-list', role: 'listbox', 'aria-label': T.find });
    const foot = h('div.ws-foot');
    const el = h(
      'div.ew-pop.ws-more.ws-findpop',
      { role: 'dialog', 'aria-label': T.find },
      quick,
      h('div.ws-findrow', find),
      list,
      foot,
    );
    document.body.append(el);
    const back = document.activeElement && document.activeElement !== document.body ? document.activeElement : findBtn;
    const away = (e) => {
      if (el.contains(e.target) || findBtn.contains(e.target)) return;
      closeFind({ refocus: false });
      // a phone's sheet covers the song: the tap that puts it away goes no further
      if (PHONE.matches && !e.target?.closest?.('.ew-top')) {
        e.preventDefault();
        e.stopPropagation();
        const eat = (c) => {
          c.preventDefault();
          c.stopPropagation();
        };
        window.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', eat, true), 500);
      }
    };
    setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    el.addEventListener('focusout', (e) => {
      const to = e.relatedTarget;
      if (to && !el.contains(to) && !findBtn.contains(to)) closeFind({ refocus: false });
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        closeFind();
      }
    });
    window.addEventListener('resize', place);
    findOpen = { el, find, list, quick, foot, away, back, rows: [], at: 0 };
    findBtn.setAttribute('aria-expanded', 'true');
    renderFind();
    place();
    find.focus({ preventScroll: true });
    return api;
  }
  function place() {
    if (!findOpen) return;
    const { el } = findOpen;
    if (PHONE.matches) {
      el.style.left = '';
      el.style.top = '';
      return;
    }
    const r = findBtn.getBoundingClientRect(),
      w = el.offsetWidth;
    el.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    el.style.top = r.bottom + 6 + 'px';
  }
  function closeFind({ refocus = true } = {}) {
    if (!findOpen) return;
    const { el, away } = findOpen;
    window.removeEventListener('pointerdown', away, true);
    window.removeEventListener('resize', place);
    const had = el.contains(document.activeElement),
      back = findOpen.back;
    el.remove();
    findOpen = null;
    findBtn.setAttribute('aria-expanded', 'false');
    // focus goes back to Find's button; on a phone, where it waits in the agent sheet, to what opened Find (the Song
    // menu's row is gone with its menu: then the Song button)
    if (refocus || had) {
      const songB = [...document.querySelectorAll('.ew-region-top .sm-btn')].find((x) => !hiddenEl(x));
      const to = !hiddenEl(findBtn) ? findBtn : back?.isConnected && !hiddenEl(back) ? back : songB || findBtn;
      to.focus({ preventScroll: true });
    }
  }
  // the phone's first rows: what the top row gave up (Song, Tempo and Key, whichever the top bar put out of sight)
  function renderQuick() {
    const { quick } = findOpen;
    const kids = [];
    if (view === 'simple' && hiddenEl(viewBtn))
      kids.push(
        h(
          'button.ws-q.ws-q-view',
          {
            type: 'button',
            onclick: () => {
              closeFind();
              setView('full');
            },
          },
          h('b', T.full),
          h('small', T.fullTitle),
        ),
      );
    const songB = document.querySelector('.ew-region-top .sm-btn');
    if (songB && hiddenEl(songB))
      kids.push(
        h(
          'button.ws-q',
          {
            type: 'button',
            onclick: () => {
              closeFind({ refocus: false });
              if (app.exporter?.openMenu) app.exporter.openMenu(findBtn);
              else songB.click();
            },
          },
          h('b', 'Song'),
          h('small', 'New, open, save, share, export'),
        ),
      );
    const tempoEl = document.querySelector('.ew-region-top .tp-tempo');
    if (tempoEl && hiddenEl(tempoEl)) {
      const s = app.store.get();
      const inp = h('input.ws-q-in', {
        type: 'text',
        inputmode: 'decimal',
        value: String(s.tempo),
        'aria-label': 'Tempo in BPM',
      });
      const commit = () => {
        const v = Number(inp.value.replace(',', '.'));
        if (!Number.isFinite(v)) {
          inp.value = String(app.store.get().tempo);
          return;
        }
        if (app.transport?.locked?.()) {
          ui.toast('The tempo waits until the take is in.');
          inp.value = String(app.store.get().tempo);
          return;
        }
        const t = Math.min(400, Math.max(20, Math.round(v * 100) / 100));
        if (t !== app.store.get().tempo)
          app.store.dispatch({ type: 'project.set', patch: { tempo: t } }, { by: 'you', label: `tempo ${t}` });
        if (t !== v) ui.toast('Tempo goes from 20 to 400 BPM');
        inp.value = String(t);
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          inp.select();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        }
      });
      kids.push(h('label.ws-q', h('b', 'Tempo'), h('span.ws-q-v', inp, h('small', 'BPM'))));
    }
    const keyEl = document.querySelector('.ew-region-top .tp-key');
    if (keyEl && hiddenEl(keyEl)) {
      const k = app.store.get().key;
      kids.push(
        h(
          'button.ws-q',
          {
            type: 'button',
            onclick: () => {
              closeFind({ refocus: false });
              if (app.transport?.openKey) app.transport.openKey(findBtn);
              else keyEl.click();
            },
          },
          h('b', 'Key'),
          h('small', k ? `${k.root} ${k.scale}` : 'none'),
        ),
      );
    }
    quick.replaceChildren(...kids);
    quick.hidden = !kids.length;
  }
  // a row: what kind it is, its name and a line on what it is, and its key; the whole row is the button
  function row(it, i) {
    const by = it.kind === 'go' ? added[it.f.id] : null;
    const agentAdded = by != null && authorOf(by, app).kind === 'agent';
    const putB =
      view === 'simple' && it.kind === 'go' && by != null
        ? h(
            'button.btn.btn-txt.ws-row-put',
            {
              type: 'button',
              'aria-label': `${T.put}: ${it.title}`,
              onclick: (e) => {
                e.stopPropagation();
                putAway([it.f.id], { by: 'you' });
              },
            },
            T.put,
          )
        : null;
    const sel = i === findOpen.at;
    return h(
      'div.ws-row',
      {
        id: `ws-opt-${i}`,
        role: 'option',
        'aria-selected': String(sel),
        dataset: { ws: it.kind === 'go' ? it.f.id : it.id, kind: it.kind },
        class: sel ? 'on' : '',
        onclick: () => run(it),
        onpointermove: () => {
          if (findOpen && findOpen.at !== i) {
            findOpen.at = i;
            paintActive();
          }
        },
      },
      h('span.ws-row-k', T.kinds[it.kind]),
      h(
        'div.ws-row-w',
        h('b.ws-row-t', it.title),
        agentAdded ? h('small.ws-row-by', 'added by ', byline(by, { app })) : null,
        it.purpose ? h('span.ws-row-p', it.purpose) : null,
        it.f?.note ? h('span.ws-row-p.ws-row-note', it.f.note) : null,
        // (a sampled sound says how far along its samples are, until they're in: ui/kitload.js)
        it.kind === 'sound' && kitHashes(it.def).length && kitState(it.def) !== 'ready'
          ? kitLine(it.def, { short: true })
          : null,
      ),
      it.key ? h('kbd.ws-row-key', it.key) : null,
      putB,
    );
  }
  function paintActive() {
    if (!findOpen) return;
    const { list, find, at } = findOpen;
    for (const el of list.querySelectorAll('.ws-row')) {
      const on = el.id === `ws-opt-${at}`;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', String(on));
      if (on) el.scrollIntoView?.({ block: 'nearest' });
    }
    find.setAttribute('aria-activedescendant', `ws-opt-${at}`);
    early(findOpen.rows?.[at]);
  }
  // the sound the arrows or the pointer rest on: a sampled one's samples start coming, so trying it is heard at once
  function early(it) {
    if (
      it &&
      it.kind === 'sound' &&
      it.def.kind === 'instrument' &&
      kitHashes(it.def).length &&
      kitState(it.def) == null
    )
      prefetchKit(it.def);
  }
  function renderFind() {
    if (!findOpen) return;
    const { list, foot, find } = findOpen;
    renderQuick();
    const q = find.value.trim();
    const kids = [];
    let rows;
    if (q) {
      rows = [...search(q), { kind: 'ask', id: 'ask', title: `Ask Claude: “${q}”`, purpose: '', key: `${MODK}Enter` }];
      if (rows.length === 1) kids.push(h('p.ws-none', T.none));
    } else {
      // empty: every part of the studio by group, a map of what's here
      kids.push(h('p.ws-none.ws-hint', T.empty));
      rows = [];
      for (const g of GROUPS)
        for (const f of FEATURES.filter((x) => x.group === g))
          rows.push({
            kind: 'go',
            id: 'go:' + f.id,
            title: f.title,
            purpose: f.purpose,
            aliases: f.aliases,
            f,
            group: g,
          });
    }
    findOpen.rows = rows;
    if (findOpen.at >= rows.length) findOpen.at = 0;
    let lastG = null;
    rows.forEach((it, i) => {
      if (it.group && it.group !== lastG) {
        lastG = it.group;
        kids.push(h('div.ws-head', { 'aria-hidden': 'true' }, it.group));
      }
      kids.push(row(it, i));
    });
    list.replaceChildren(...kids);
    find.setAttribute('aria-activedescendant', rows.length ? `ws-opt-${findOpen.at}` : '');
    early(rows[findOpen.at]);
    foot.replaceChildren(
      view === 'simple'
        ? h('small.ws-foot-s', T.hides)
        : h('small.ws-foot-s', `↑ ↓ choose · Enter goes · ${MODK}Enter asks Claude · Esc closes`),
    );
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
/* Find: the button (its key beside it, quiet), then typographic rows in the liner-notes style; no stripes, no pills */
.ws-find-btn { display: inline-flex; align-items: center; gap: 8px; }
.ws-view[hidden] { display: none; }
.ws-find-k { font: 500 11px var(--font-mono); color: var(--text-3); border: 0; padding: 0; background: none; }
.ew-pop.ws-more { position: fixed; z-index: 900; width: 460px; max-width: calc(100vw - 16px); max-height: min(72vh, 620px); overflow: auto; padding: 0;
  background: var(--bg-3); border: var(--rule-2); border-radius: 0; box-shadow: var(--shadow-2); animation: ew-in .16s var(--ease, ease) both; }
.ws-findrow { position: sticky; top: 0; z-index: 1; padding: 10px 12px; background: var(--bg-3); border-bottom: var(--rule); }
.ws-find { width: 100%; height: 34px; padding: 0 10px; border: var(--rule-2); border-radius: var(--r-press); background: var(--bg); color: var(--text); font: inherit; font-size: 14px; }
.ws-find:focus { outline: 2px solid var(--accent-2); outline-offset: -1px; }
.ws-list { padding: 0 12px; }
.ws-head { padding: 14px 0 4px; color: var(--text-3); font-size: 13px; font-weight: 600; }
.ws-row { display: flex; align-items: baseline; gap: 12px; padding: 8px 0; border-bottom: var(--rule); cursor: pointer; }
.ws-list > .ws-row:last-child { border-bottom: 0; }
.ws-row.on .ws-row-t { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.ws-row.on .ws-row-k { color: var(--text); }
.ws-row-k { flex: none; width: 48px; font-size: 12px; color: var(--text-3); }
.ws-row-w { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ws-row-t { font-size: 13px; font-weight: 600; color: var(--text); }
.ws-row-by { font-size: 12px; color: var(--text-3); }
.ws-row-w > .kitload { display: grid; margin-top: 3px; width: max-content; }
.ws-row-p { font-size: 12px; line-height: 1.4; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ws-row-key { flex: none; font: 500 11px var(--font-mono); color: var(--text-3); }
.ws-row-put { flex: none; }
.ws-none { margin: 0; padding: 14px 0 6px; color: var(--text-2); font-size: 13px; }
.ws-foot { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 12px; border-top: var(--rule); }
.ws-foot-s { font-size: 12px; color: var(--text-3); }
/* Go to's finger: a pencil outline for two seconds (the agent's ink when an agent asked) */
.ws-pointed { outline: 1.5px dashed var(--text-2); outline-offset: 3px; }
.ws-pointed-agent { outline-color: var(--agent); }
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
/* a narrow window: the top bar is full, so Find says just "Find" (its key stays in the title), and Song stays clear of
   All off (find-test measures it) */
@media (min-width: 641px) and (max-width: 800px) { .ws-find-x, .ws-find-k { display: none; } }
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
  .ws-row { min-height: 52px; align-items: center; }
  .ws-row-key, .ws-find-k, .ws-find-x { display: none; }
  .ws-find { height: 40px; font-size: 16px; }
}
`;
