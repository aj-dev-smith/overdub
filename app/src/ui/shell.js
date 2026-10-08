// The studio's frame: regions, tabs, the one animation loop, the one key handler, selection and toasts.
// Panels plug in with ui.panel({...}); see docs/ARCHITECTURE.md ("The UI").
//
//   top     transport bar            left    browser (tabs)        center  arranger
//   bottom  detail (tabs)            right   agent (tabs)
//
// Rules for panels: state lives in the store (the song) or ui.state (the session), never in the DOM; no
// requestAnimationFrame of your own (use frame(now), called only while you're visible); mount is cheap and
// repeatable; keys are declared with ui.keys.add, not bound.

import { h, css, icon, drag, clamp } from './dom.js';

const REGIONS = ['top', 'left', 'center', 'bottom', 'right'];
const STORE_KEY = 'overdub:layout';

export function createShell(root, app) {
  const listeners = new Map();
  const panels = new Map(); // id -> { def, region, el, tab, view, mounted }
  const active = {}; // region -> panel id
  const layout = loadLayout();
  // A phone (or a narrow window): the side panes become full-height sheets and the detail pane a bottom sheet.
  const PHONE = window.matchMedia('(max-width: 900px)');
  const phone = () => PHONE.matches;
  // a phone starts with both side sheets shut, before the first layout: opening one there (for a frame) and closing
  // it again would hand focus to its toggle, so a newcomer's first focus ring was on the Browser button
  if (phone() || window.innerWidth < 900) {
    layout.open.left = false;
    layout.open.right = false;
  }
  // the side sheet that is open as a dialog on a phone, and what had focus when it opened: { region, opener } (syncSheet)
  let sheet = null;
  const ui = {
    state: {
      selection: { track: null, clip: null, notes: new Set(), range: null, insert: null },
      zoom: { pxPerBeat: 28, trackH: phone() ? 72 : 64 },
      scrollX: 0,
      scrollY: 0,
      focus: null,
      tool: 'pointer',
      snap: 0.25,
    },
    panels,
    regions: {},
  };

  /* ---------------------------------------------------------------- events */
  ui.on = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  };
  ui.emit = (type, detail) => {
    for (const fn of listeners.get(type) || []) {
      try {
        fn(detail);
      } catch (e) {
        console.error('ui listener', type, e);
      }
    }
  };

  // Merge into the selection and tell everyone. sel: { track?, clip?, notes?: Iterable, range?, insert? }
  ui.select = (sel = {}) => {
    const s = ui.state.selection;
    if ('track' in sel) s.track = sel.track;
    if ('clip' in sel) s.clip = sel.clip;
    // another track selected on its own: a clip still selected on a different track goes (with its notes), so nothing
    // pairs one track's name with another track's clip (the agent's scope chip read "On Bass, Take 2" with Take 2 on Keys)
    else if ('track' in sel && s.clip && app?.store?.findClip?.(s.clip)?.track?.id !== sel.track) {
      s.clip = null;
      if (!('notes' in sel)) s.notes = new Set();
    }
    if ('notes' in sel) s.notes = new Set(sel.notes || []);
    if ('range' in sel) s.range = sel.range;
    if ('insert' in sel) s.insert = sel.insert;
    ui.emit('select', s);
  };

  /* ---------------------------------------------------------------- the frame */
  css('shell', SHELL_CSS);
  root.classList.add('ew-shell');
  const top = h(
    'header.ew-top',
    h(
      'a.ew-brand',
      { href: '../', title: 'Overdub: play over each other', 'aria-label': 'Overdub' },
      h('img.ew-mark', { src: './assets/logo.svg', alt: '', width: 26, height: 26 }),
      h('img.ew-word', { src: './assets/wordmark.svg', alt: 'Overdub', width: 107, height: 17 }),
    ),
    (ui.regions.top = h('div.ew-region.ew-region-top')),
    // the workspace's corner (ui/workspace.js fills it): the note slot, More, and Full studio / Simple view
    (ui.wsBox = h('div.ew-ws')),
    h(
      'div.ew-toggles',
      toggleBtn('panelLeft', 'Browser (B)', () => setOpen('left', !layout.open.left), { label: 'Browser' }),
      toggleBtn('panelBottom', 'Detail (D)', () => setOpen('bottom', !layout.open.bottom)),
      toggleBtn('panelRight', 'Agent (A)', () => setOpen('right', !layout.open.right), { label: 'Agent' }),
    ),
  );
  const left = regionBox('left');
  const center = regionBox('center');
  const bottom = regionBox('bottom');
  const right = regionBox('right');
  // A phone (640 px and under): the agent opens as a bottom sheet at about 70% of the height, so the song stays in view
  // above it while the agent plays over it. Its handle: drag up for the whole height, drag down to close; a tap (or
  // Enter) swaps 70% and full. The close button stays. (Wider, it's a full-height sheet or a pane: no handle.)
  const AGENT_PHONE = window.matchMedia('(max-width: 640px)');
  const agentGrip = h('button.ew-agent-grip', {
    type: 'button',
    'aria-label': 'Agent sheet: taller or shorter',
    onclick: (e) => {
      if (!e.detail) agentFull(!root.classList.contains('ew-agent-full'));
    },
  });
  right.box.prepend(agentGrip);
  // the full studio's place for More and Simple view (ui/workspace.js): the empty end of the agent pane's tab row, so
  // the full studio's top bar keeps every bit of its room
  ui.wsSide = h('div.ew-ws-side');
  right.box.append(ui.wsSide);
  const agentFull = (on) => {
    root.classList.toggle('ew-agent-full', !!on);
    right.box.style.removeProperty('height');
    ui.emit('resize');
  };
  drag(agentGrip, {
    start: () => {
      agentGrip._h = right.box.offsetHeight;
      agentGrip._moved = false;
    },
    move: (e, dx, dy) => {
      if (!AGENT_PHONE.matches) return;
      if (Math.abs(dy) > 4) agentGrip._moved = true;
      right.box.style.height = clamp(agentGrip._h - dy, 120, window.innerHeight) + 'px';
    },
    end: (e, dx, dy) => {
      if (!AGENT_PHONE.matches) return;
      if (!agentGrip._moved && Math.abs(dy) <= 4) {
        agentFull(!root.classList.contains('ew-agent-full'));
        return;
      }
      const hNow = agentGrip._h - dy,
        vh = window.innerHeight;
      if (hNow < vh * 0.45) {
        agentFull(false);
        setOpen('right', false);
      } else agentFull(hNow > vh * 0.8 || (dy < -40 && hNow > vh * 0.72));
    },
  });
  // on a phone the divider is the bottom sheet's handle: drag it to size the sheet, tap it to tuck the sheet away
  const grip = h('button.ew-grip', {
    type: 'button',
    'aria-label': 'Detail pane (D)',
    onclick: (e) => {
      if (!e.detail) setOpen('bottom', !layout.open.bottom);
    },
  }); // keys; a pointer's tap is handled in the drag below
  const splitV = h('div.ew-split.ew-split-v', { title: 'Drag to resize' }, grip);
  const splitL = h('div.ew-split.ew-split-l');
  const splitR = h('div.ew-split.ew-split-r');
  const main = h('div.ew-main', center.box, splitV, bottom.box);
  const body = h('div.ew-body', left.box, splitL, main, splitR, right.box);
  const toasts = h('div.ew-toasts', { role: 'status', 'aria-live': 'polite' });
  // ui.announce(text): one line for screen readers only (what an agent just did while its tab is out of sight)
  const announcer = h('div.ew-announce', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  root.append(top, body, toasts, announcer);
  applyLayout();

  // On a phone the two side-sheet toggles say what they open in words ("Agent" is the headline feature; two
  // look-alike pane icons hid it): the label shows and the pane icon gives way to it (app/style/app.css, under 640 px).
  function toggleBtn(ic, title, run, { label = null } = {}) {
    return h(
      'button.ew-iconbtn.ew-t-' + ic + (label ? '.ew-labelled' : ''),
      { title, 'aria-label': title, onclick: run, dataset: { feature: 'panes' } },
      h('span.ew-t-ico', icon(ic)),
      label
        ? h(
            'span.ew-t-label',
            { 'aria-hidden': 'true' },
            ic === 'panelRight' ? h('span.ew-t-mark', icon('agent', { size: 14 })) : null,
            label,
          )
        : null,
    );
  }
  function regionBox(region) {
    const tabs = h('div.ew-tabs', {
      role: 'tablist',
      'aria-label': { left: 'Browser', center: 'Arrange', bottom: 'Detail', right: 'Agent' }[region],
    });
    // arrow keys walk the tabs (and show each), Home and End jump to the ends
    tabs.addEventListener('keydown', (e) => {
      const list = [...tabs.querySelectorAll('[role=tab]')];
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const to =
        e.key === 'ArrowRight'
          ? (i + 1) % list.length
          : e.key === 'ArrowLeft'
            ? (i - 1 + list.length) % list.length
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? list.length - 1
                : -1;
      if (to < 0) return;
      e.preventDefault();
      list[to].focus();
      list[to].click();
    });
    // until a panel arrives here (the modules load after the frame), a quiet line says the studio is still coming up
    const content = h(
      'div.ew-content',
      h('div.ew-loading', region === 'center' ? { role: 'status' } : { 'aria-hidden': 'true' }, 'Setting up the room…'),
    );
    // a side pane on a phone is a full-height sheet: this closes it (hidden on a wide screen, where the toggles do)
    const shut =
      region === 'left' || region === 'right'
        ? h(
            'button.ew-sheet-x',
            {
              type: 'button',
              title: 'Close (Esc)',
              'aria-label': region === 'left' ? 'Close the browser' : 'Close the agent',
              onclick: () => setOpen(region, false),
            },
            icon('x', { size: 20 }),
          )
        : null;
    const box = h(`section.ew-region.ew-region-${region}`, { dataset: { region } }, tabs, shut, content);
    ui.regions[region] = content;
    return { box, tabs, content };
  }
  const boxes = { left, center, bottom, right };
  ui.on('ready', () => {
    for (const el of root.querySelectorAll('.ew-loading')) el.remove();
  });

  // resizers
  // the phone sheet runs from tucked away (just its tabs) to the whole height under the top bar
  const sheetMax = () => Math.max(160, main.clientHeight - splitV.offsetHeight);
  drag(splitV, {
    start: () => {
      splitV._h = !phone() || layout.open.bottom ? layout.bottomH : bottom.box.offsetHeight;
      splitV._keep = layout.bottomH;
      splitV._was = !!layout.open.bottom;
    },
    move: (e, dx, dy) => {
      if (!phone()) {
        layout.bottomH = clamp(splitV._h - dy, 120, window.innerHeight - 220);
        applyLayout();
        return;
      }
      if (Math.abs(dy) > 4) splitV._moved = true;
      const want = splitV._h - dy;
      layout.open.bottom = want > 120;
      if (layout.open.bottom) layout.bottomH = clamp(want, 140, sheetMax());
      applyLayout();
    },
    end: (e, dx, dy) => {
      // a tap (WebKit sends no click after a pointerdown the drag took) tucks the sheet away or brings it back
      const tapped = phone() && !splitV._moved && Math.abs(dy) <= 4;
      splitV._moved = false;
      if (tapped) {
        layout.bottomH = splitV._keep;
        setOpen('bottom', !splitV._was);
        return;
      }
      if (phone() && layout.open.bottom && layout.bottomH > sheetMax() - 56) {
        layout.bottomH = sheetMax();
        applyLayout();
      }
      // tucked away, it comes back at the size it had (not the sliver it passed through on the way down)
      if (phone() && !layout.open.bottom)
        layout.bottomH = Math.max(splitV._keep, Math.round(window.innerHeight * 0.36));
      saveLayout();
    },
  });
  drag(splitL, {
    start: () => {
      splitL._w = layout.leftW;
    },
    move: (e, dx) => {
      layout.leftW = clamp(splitL._w + dx, 180, 420);
      applyLayout();
    },
    end: saveLayout,
  });
  drag(splitR, {
    start: () => {
      splitR._w = layout.rightW;
    },
    move: (e, dx) => {
      layout.rightW = clamp(splitR._w - dx, 280, 640);
      applyLayout();
    },
    end: saveLayout,
  });

  function applyLayout() {
    root.style.setProperty('--left-w', layout.open.left ? layout.leftW + 'px' : '0px');
    root.style.setProperty('--right-w', layout.open.right ? layout.rightW + 'px' : '0px');
    root.style.setProperty('--bottom-h', layout.open.bottom ? layout.bottomH + 'px' : '0px');
    for (const r of ['left', 'right', 'bottom']) root.classList.toggle('ew-closed-' + r, !layout.open[r]);
    grip.setAttribute('aria-expanded', String(!!layout.open.bottom));
    for (const [r, ic] of [
      ['left', 'panelLeft'],
      ['bottom', 'panelBottom'],
      ['right', 'panelRight'],
    ])
      top.querySelector('.ew-t-' + ic)?.setAttribute('aria-expanded', String(!!layout.open[r]));
    // a closed detail pane on a wide screen is 0 px tall but still holds its controls: out of the tab order with it
    // (a phone's closed sheet hides its content; its open sheets make the rest inert, below)
    bottom.box.inert = !phone() && !layout.open.bottom;
    syncSheet();
    ui.emit('resize');
  }
  // On a phone (any window under 900 px) an open browser or agent covers the screen, so it is a dialog: it's named,
  // the rest of the studio is inert (no Tab or swipe into what's under it), focus goes into it and, when it closes,
  // back to what opened it (else to its toggle). Esc closes it (keys below). On a wide screen it's a pane again.
  function shown(el) {
    return !!el && el.isConnected && !el.closest('[inert]') && el.getClientRects().length > 0;
  }
  function syncSheet() {
    const want = phone() ? (layout.open.left ? 'left' : layout.open.right ? 'right' : null) : null;
    if ((sheet?.region || null) === want) return;
    const prev = sheet;
    const boxOf = (r) => (r === 'left' ? left : right).box;
    if (prev) {
      const b = boxOf(prev.region);
      b.removeAttribute('role');
      b.removeAttribute('aria-modal');
      b.removeAttribute('aria-label');
      top.inert = false;
      main.inert = false;
      left.box.inert = false;
      right.box.inert = false;
      sheet = null;
    }
    if (want) {
      const b = boxOf(want);
      b.setAttribute('role', 'dialog');
      b.setAttribute('aria-modal', 'true');
      b.setAttribute('aria-label', want === 'left' ? 'Browser' : 'Agent');
      top.inert = true;
      main.inert = true;
      boxOf(want === 'left' ? 'right' : 'left').inert = true;
      // one sheet swapped for the other keeps the first one's opener
      const a = document.activeElement;
      sheet = { region: want, opener: prev ? prev.opener : a && a !== document.body && !b.contains(a) ? a : null };
      if (!b.contains(document.activeElement)) {
        const tab = b.querySelector('.ew-tabs [role=tab][aria-selected=true]');
        (shown(tab) ? tab : b.querySelector('.ew-sheet-x'))?.focus({ preventScroll: true });
      }
      return;
    }
    // closed (or the window widened): focus that was in the sheet, or fell out of the page with it, goes back
    const a = document.activeElement,
      b = boxOf(prev.region);
    const lost = !a || a === document.body || (b.contains(a) && !shown(a));
    if (!lost) return;
    const toggle = top.querySelector(prev.region === 'left' ? '.ew-t-panelLeft' : '.ew-t-panelRight');
    const to = [prev.opener, toggle].find(shown);
    to?.focus({ preventScroll: true });
  }
  // narrowed into a phone's layout: the side panes close (as they start on one), so no sheet covers the studio unasked;
  // widened: the sheet's dialog state goes and it is a pane again
  PHONE.addEventListener?.('change', () => {
    if (phone()) {
      layout.open.left = false;
      layout.open.right = false;
    }
    applyLayout();
  });
  // a phone turned (or any window under 900 px made shorter): the sheet is never taller than the room it has now. Left
  // at its upright height, it drew clamped to the room while a drag of its handle started from the old height, so the
  // first drag after a turn moved nothing. (Not saved: it's the room's size, not a choice.)
  window.addEventListener('resize', () => {
    if (!phone()) return;
    const most = sheetMax();
    if (layout.bottomH > most) {
      layout.bottomH = most;
      applyLayout();
    }
  });
  // Who reached for a put-away part: an explicit by, else the agent whose tool is running (ui.state.actor), unless the
  // call comes straight from the person's own click, tap or key. A tool can run for a minute (adjust waits on a pick,
  // a render measures), and what the person reaches for meanwhile is theirs, not the agent's.
  const PERSON = /^(key|pointer|mouse|click|dblclick|auxclick|contextmenu|touch|input|change|submit|drop|wheel)/;
  const reacher = (by) => {
    if (by) return by;
    const e = globalThis.event;
    return e && e.isTrusted && PERSON.test(e.type) ? 'you' : ui.state.actor || 'you';
  };
  // save: false opens or closes it for now without remembering (the workspace tidying up after a view change)
  function setOpen(region, open, { save = true } = {}) {
    // an empty pane (every panel in it put away, in the simple view) opening by hand or by key brings back its first
    // panel: B opens the Browser, signed by whoever reached (reacher, above)
    if (open && !layout.open[region] && region !== 'top' && ui.workspace) {
      const here = [...panels.values()].filter((p) => p.region === region && p.tab).sort(byOrder);
      if (here.length && !here.some((p) => shownPanel(p.def.id)))
        ui.workspace.reach(ui.workspace.featureOfPanel(here[0].def.id), reacher());
    }
    layout.open[region] = open;
    // one full-height sheet at a time on a phone
    if (open && phone() && (region === 'left' || region === 'right'))
      layout.open[region === 'left' ? 'right' : 'left'] = false;
    if (region === 'right') {
      root.classList.remove('ew-agent-full');
      right.box.style.removeProperty('height');
    } // the agent sheet opens at 70% again
    applyLayout();
    if (save) saveLayout();
    if (open && active[region]) panels.get(active[region])?.view?.refresh?.();
  }
  ui.setOpen = setOpen;
  ui.isOpen = (region) => !!layout.open[region];
  function loadLayout() {
    // (a first visit: the song, its detail pane and the agent; the Browser and the Inspector wait behind B and their button)
    const def = { leftW: 236, rightW: 380, bottomH: 300, open: { left: false, right: true, bottom: true }, tabs: {} };
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s) return { ...def, ...s, open: { ...def.open, ...(s.open || {}) }, tabs: { ...(s.tabs || {}) } };
    } catch {
      /* fresh */
    }
    return def;
  }
  function saveLayout() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(layout));
    } catch {
      /* private mode */
    }
  }
  if (window.innerWidth < 900) {
    layout.open.left = false;
    layout.open.right = false;
    applyLayout();
  }
  // a phone's sheet starts just under half the screen, so the arrangement stays in view (drag it taller from there)
  if (phone()) {
    layout.bottomH = Math.round(window.innerHeight * (window.innerHeight < 720 ? 0.4 : 0.45));
    applyLayout();
  }

  /* ---------------------------------------------------------------- panels */
  const byOrder = (a, b) => (a.def.order ?? 50) - (b.def.order ?? 50);
  // a panel is shown unless the workspace (ui/workspace.js) has its feature put away in the simple view
  const shownPanel = (id) => !ui.workspace || ui.workspace.panelShown(id);
  // A region's tab strip: its shown panels' tabs in order; one or none and the strip goes (.ew-single). Runs on
  // registration and on every 'workspace' change.
  function retab(region) {
    const box = boxes[region];
    if (!box) return;
    const sibs = [...panels.values()].filter((p) => p.region === region && p.tab && shownPanel(p.def.id)).sort(byOrder);
    box.tabs.replaceChildren(...sibs.map((p) => p.tab));
    box.box.classList.toggle('ew-single', sibs.length < 2);
  }
  ui.retab = retab;
  // After the workspace changes (a view switch, a put away): a region showing a put-away panel falls back to its first
  // shown panel, by order, without remembering it (the full studio opens on the tab you left); a region with none
  // closes. A region with nothing open shows its first shown panel again.
  function reconcile() {
    for (const region of ['left', 'center', 'bottom', 'right']) {
      retab(region);
      const cur = active[region];
      if (cur && shownPanel(cur)) continue;
      const first = [...panels.values()]
        .filter((p) => p.region === region && p.tab && shownPanel(p.def.id))
        .sort(byOrder)[0];
      if (first) {
        ui.show(first.def.id, { save: false });
        continue;
      }
      if (cur) {
        const p = panels.get(cur);
        p.el.hidden = true;
        p.tab?.setAttribute('aria-selected', 'false');
        p.tab?.classList.remove('on');
        if (p.tab) p.tab.tabIndex = -1;
        active[region] = null;
      } else if (![...panels.values()].some((p) => p.region === region && p.tab)) continue;
      // every panel here is put away (even one that never became active, at load over a saved open pane): it closes
      if (layout.open[region]) setOpen(region, false, { save: false });
    }
  }
  ui.on('workspace', reconcile);
  ui.on('ready', reconcile);

  // def: { id, region, title, icon?, order?, mount(el, ctx) -> { update(evt), frame(now), refresh(), unmount() } }
  ui.panel = (def) => {
    if (!REGIONS.includes(def.region)) throw new Error(`panel ${def.id}: region must be one of ${REGIONS.join(', ')}`);
    if (panels.has(def.id)) {
      console.error(`panel ${def.id} is already registered`);
      return;
    }
    const el = h('div.ew-panel', {
      dataset: { panel: def.id },
      role: def.region === 'top' ? null : 'tabpanel',
      hidden: true,
    });
    const rec = { def, region: def.region, el, tab: null, view: null, mounted: false };
    panels.set(def.id, rec);
    if (def.region === 'top') {
      ui.regions.top.append(el);
      el.hidden = false;
      mount(rec);
      return rec;
    }
    const box = boxes[def.region];
    // a tab is a word (design/LINER-NOTES-KIT.md): the open one is underlined in cream, not boxed; def.icon is kept for
    // whoever lists panels, but not drawn here
    rec.tab = h(
      'button.ew-tab',
      { role: 'tab', 'aria-selected': 'false', tabindex: -1, onclick: () => ui.show(def.id), title: def.title },
      h('span', def.title),
    );
    rec.tab.id = 'ew-tab-' + def.id;
    el.setAttribute('aria-labelledby', rec.tab.id);
    // keep tabs in order (a put-away panel's tab is left out)
    box.content.append(el);
    retab(def.region);
    // registration never makes a put-away panel the active one, and a remembered tab that is put away counts as none
    if (!shownPanel(def.id)) return rec;
    let want = layout.tabs[def.region];
    if (want && ui.workspace && !ui.workspace.panelShown(want)) want = null;
    if (
      !active[def.region] ||
      want === def.id ||
      (!want && (def.order ?? 50) < (panels.get(active[def.region])?.def.order ?? 50))
    )
      ui.show(def.id, { save: false });
    return rec;
  };

  function mount(rec) {
    if (rec.mounted) return;
    rec.mounted = true;
    try {
      rec.view = rec.def.mount(rec.el, app) || {};
    } catch (e) {
      console.error('panel mount failed', rec.def.id, e);
      rec.view = {};
      rec.el.append(h('div.ew-panel-error', `This panel failed to load: ${e.message}`));
    }
  }

  // Showing a put-away panel (simple view) is reaching for it: its feature comes back, signed by `by`, else by
  // whoever reached (reacher: the person's own click or key, else an agent's running tool, else you). With save: false (a registration, a fallback) it never does.
  ui.show = (id, { save = true, by = null } = {}) => {
    const rec = panels.get(id);
    if (!rec || rec.region === 'top') return;
    if (!shownPanel(id)) {
      if (save === false) return;
      ui.workspace.reach(ui.workspace.featureOfPanel(id), reacher(by));
      if (!shownPanel(id)) return;
    }
    const prev = active[rec.region];
    if (prev && prev !== id) {
      const p = panels.get(prev);
      p.el.hidden = true;
      p.tab?.setAttribute('aria-selected', 'false');
      p.tab?.classList.remove('on');
      if (p.tab) p.tab.tabIndex = -1;
    }
    active[rec.region] = id;
    rec.el.hidden = false;
    rec.tab?.setAttribute('aria-selected', 'true');
    if (rec.tab) rec.tab.tabIndex = 0;
    rec.tab?.classList.add('on');
    mount(rec);
    if (!layout.open[rec.region] && save) setOpen(rec.region, true);
    if (save) {
      layout.tabs[rec.region] = id;
      saveLayout();
    }
    rec.view?.refresh?.();
    ui.emit('show', { id, region: rec.region });
  };
  ui.active = (region) => active[region] || null;
  ui.visible = (id) => {
    const r = panels.get(id);
    return !!r && (r.region === 'top' || (active[r.region] === id && (r.region === 'center' || layout.open[r.region])));
  };

  // store changes reach every mounted panel (hidden ones too: they decide whether to do work now)
  app.store.on('change', (evt) => {
    for (const rec of panels.values())
      if (rec.mounted && rec.view?.update) {
        try {
          rec.view.update(evt);
        } catch (e) {
          console.error('panel update', rec.def.id, e);
        }
      }
  });

  /* ---------------------------------------------------------------- the one loop */
  let raf = 0,
    chromeAt = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    // the chrome's own upkeep, a few times a second: toasts clear of the panel in use, the top bar's items in the bar
    if (now - chromeAt > 150) {
      chromeAt = now;
      placeToasts();
      fitTop();
    }
    for (const rec of panels.values()) {
      if (!rec.mounted || !rec.view?.frame || !ui.visible(rec.def.id)) continue;
      try {
        rec.view.frame(now);
      } catch (e) {
        console.error('frame', rec.def.id, e);
        rec.view.frame = null;
      }
    }
  }
  raf = requestAnimationFrame(loop);
  ui.stop = () => cancelAnimationFrame(raf);

  // ui.state.focus: the panel the pointer last went down in, or keyboard focus last moved into (Delete, arrows and
  // the like act there). Focus moving to something outside every panel (a popover, the body) leaves it alone.
  const focusFrom = (e) => {
    const el = e.target?.closest?.('[data-panel]');
    const id = el ? el.dataset.panel : null;
    if (id && id !== ui.state.focus) {
      ui.state.focus = id;
      ui.emit('focus', id);
    }
  };
  root.addEventListener('pointerdown', focusFrom, true);
  root.addEventListener('focusin', focusFrom, true);

  /* ---------------------------------------------------------------- keys */
  const keys = [];
  ui.keys = {
    // { key: e.code ('Space', 'KeyZ', 'Delete', 'ArrowLeft'...), mod: 'mod' (cmd/ctrl) | 'shift' | 'alt' | 'mod+shift' | null,
    //   run(e), when?() -> bool, label, group, global? (fires even while typing), first? (tried before the keys added
    //   earlier: a mode's Esc ahead of clearing a selection), feature? (the workspace feature its control belongs to:
    //   after it runs, a put-away feature comes back, ui.workspace.reach) }
    add(k) {
      const clash = keys.find((x) => x.key === k.key && (x.mod || null) === (k.mod || null) && !x.when && !k.when);
      if (clash)
        console.warn(`key ${k.mod ? k.mod + '+' : ''}${k.key} is taken by "${clash.label}"; "${k.label}" skipped`);
      else if (k.first) keys.unshift(k);
      else keys.push(k);
      return () => {
        const i = keys.indexOf(k);
        if (i >= 0) keys.splice(i, 1);
      };
    },
    list: () => keys.slice(),
  };
  // The keys moved to the layout of Logic and GarageBand on 2 October 2026: M mutes and S solos the selected track,
  // K is the click and ⇧K the count-in, ⌘E splits. The first press of any of them in a browser says so, once, for all
  // of them (one line, ui.keys.movedNote, after what the key did): ui.keys.firstPress(id) -> true that first time (and
  // remembers every moved key in overdub:keys-moved), false after. With storage blocked it is once a session.
  const MOVED_KEY = 'overdub:keys-moved',
    MOVED_IDS = ['KeyM', 'KeyS', 'KeyK', 'shift+KeyK', 'mod+KeyE'];
  let movedSaid = false;
  ui.keys.movedNote = 'Keys changed on 2 October: `M` mutes, `S` solos, `K` is the click. `?` lists them all.';
  ui.keys.firstPress = (id) => {
    if (movedSaid) return false;
    movedSaid = true;
    let seen = {};
    try {
      const v = JSON.parse(localStorage.getItem(MOVED_KEY) || '{}');
      if (v && typeof v === 'object' && !Array.isArray(v)) seen = v;
    } catch {
      /* blocked or unreadable: once a session */
    }
    if (Object.keys(seen).length) return false;
    try {
      localStorage.setItem(MOVED_KEY, JSON.stringify(Object.fromEntries([...MOVED_IDS, id].map((k) => [k, 1]))));
    } catch {
      /* private mode */
    }
    return true;
  };
  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  // Space and Enter belong to a focused button, link, tab or menu item (the browser clicks it); Enter also belongs to a
  // focused spin button or slider. Only global keys (Escape out of a dialog) take them there.
  const ACTIVATES =
    'button, a[href], summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=radio], [role=checkbox], [role=switch], [role=link]';
  const NAV = /^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/;
  // Space is the transport's key: a control keeps it only when it has keyboard focus (the :focus-visible kind: Tab,
  // arrows, a script moving focus for the keyboard). A button that took focus from a click or a tap (Fit, Loop, a
  // tab) doesn't, or Space after any click would press that button again instead of playing. Enter stays the
  // control's either way. (Tracked here rather than read from :focus-visible, which a key press itself can turn on.)
  let pointerDown = false,
    pointerFocus = null;
  window.addEventListener(
    'pointerdown',
    () => {
      pointerDown = true;
    },
    true,
  );
  for (const t of ['pointerup', 'pointercancel'])
    window.addEventListener(
      t,
      () => {
        setTimeout(() => {
          pointerDown = false;
        }, 0);
      },
      true,
    );
  window.addEventListener(
    'focusin',
    (e) => {
      pointerFocus = pointerDown ? e.target : null;
    },
    true,
  );
  const byPointer = (t) => !!t && pointerFocus === t;
  const activates = (t, code) => {
    if (!t?.closest || (code !== 'Space' && code !== 'Enter' && code !== 'NumpadEnter')) return false;
    const c = t.closest(ACTIVATES);
    if (c)
      return (
        code !== 'Space' ||
        !(byPointer(t) || byPointer(c)) ||
        !!c.closest('[role=menu], [role=listbox], .ek-pop, .ew-pop')
      );
    return code !== 'Space' && !!t.closest('[role=spinbutton], [role=slider]');
  };
  // a Space the transport took on a clicked button: its keyup mustn't press the button as well
  let spaceTaken = false;
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.code === 'Space' && spaceTaken) {
        spaceTaken = false;
        if (e.target?.closest?.(ACTIVATES)) e.preventDefault();
      }
    },
    true,
  );
  // Single-key shortcuts (a letter, digit or punctuation key with no modifier: R records, H opens the mic) can be
  // turned off in the "?" sheet, for speech input and anyone who types on a focused control (WCAG 2.1.4). Keys gated
  // by a when() stay: they only fire in a mode you turned on or a panel you're in.
  const SINGLE =
    /^(Key[A-Z]|Digit\d|Backquote|Slash|Backslash|Comma|Period|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal)$/;
  let singleKeys = true;
  try {
    singleKeys = JSON.parse(localStorage.getItem('overdub:keys') || '{}').single !== false;
  } catch {
    /* default on */
  }
  ui.keys.single = (on) => {
    if (on === undefined) return singleKeys;
    singleKeys = !!on;
    try {
      localStorage.setItem('overdub:keys', JSON.stringify({ single: singleKeys }));
    } catch {
      /* private mode */
    }
    ui.emit('keys:single', singleKeys);
    return singleKeys;
  };
  window.addEventListener(
    'keydown',
    (e) => {
      const mods =
        [(e.metaKey || e.ctrlKey) && 'mod', e.shiftKey && 'shift', e.altKey && 'alt'].filter(Boolean).join('+') || null;
      const inField = typing(e.target);
      const onControl = !mods && activates(e.target, e.code);
      // arrows in a menu, list or tab strip move between its items; behind a modal dialog nothing else listens
      // and Esc in a popover or menu closes that (it has its own listener), not the selection behind it
      const owned =
        (NAV.test(e.code) && !!e.target?.closest?.('[role=menu], [role=listbox], [role=tablist], [role=radiogroup]')) ||
        (e.code === 'Escape' && !!e.target?.closest?.('.ek-pop, .ew-pop, [role=menu]')) ||
        !!e.target?.closest?.('[aria-modal=true]:not(.ew-region)');
      // keys with a when() are modes (musical typing, a focused editor) and win over the always-on ones
      for (const k of [...keys.filter((x) => x.when), ...keys.filter((x) => !x.when)]) {
        if (k.key !== e.code) continue;
        if ((k.mod || null) !== mods) continue;
        if (inField && !k.global) continue;
        if ((onControl || owned) && !k.global) continue;
        if (!singleKeys && !mods && !k.when && !k.global && SINGLE.test(k.key)) continue;
        if (k.when && !k.when()) continue;
        e.preventDefault();
        if (e.code === 'Space') spaceTaken = true;
        try {
          k.run(e);
        } catch (err) {
          console.error('key', k.label, err);
        }
        // a key whose control is put away still works, and brings the control back (k.feature: a workspace feature id)
        // A key is always the person's; under a take the screen holds still, so a refused key reveals nothing either.
        if (k.feature && !app.transport?.locked?.()) {
          try {
            ui.workspace?.reach(k.feature, 'you');
          } catch (err) {
            console.error('key reach', k.label, err);
          }
        }
        return;
      }
      // nothing here took it: a key other DAWs use says what does that here
      if (mods === 'mod' && !inField && !owned && !e.repeat) elsewhere(e.code);
    },
    true,
  );
  // ⌘L, ⌘C and ⌘V on a clip do things in other DAWs and nothing here, so a press says what does (the browser still gets
  // the key: ⌘L goes on to the address bar); ⌘E with no clip selected says what it splits. Not while text is selected
  // (⌘C copies it) or a field has focus.
  const MODK = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
  const ALTK = MODK === '⌘' ? '⌥' : 'Alt';
  let elsewhereToast = null,
    elsewhereSaid = '';
  function elsewhere(code) {
    const s = ui.state.selection,
      inArranger = !ui.state.focus || ui.state.focus === 'arranger';
    const copy = `To copy a clip, \`${ALTK}\`-drag it, or \`${MODK}D\` puts a copy right after it.`;
    const texty = () => !!String(window.getSelection?.() || '').trim();
    const said = {
      KeyL: () =>
        s.range
          ? 'Here it’s `L` on its own: it loops the selected bars.'
          : 'Here it’s `L` on its own: it turns the loop on and off, and loops the bars you select.',
      KeyC: () => (inArranger && s.clip && !texty() ? copy : null),
      KeyV: () => (inArranger ? copy : null),
      KeyE: () => `Select a clip, then \`${MODK}E\` splits it at the playhead.`,
    };
    const say = said[code]?.() || null;
    if (!say || (say === elsewhereSaid && elsewhereToast?.isConnected)) return; // (it's still on screen: once is enough)
    elsewhereSaid = say;
    elsewhereToast = ui.toast(say, { ms: 4000 });
  }
  ui.keys.add({
    key: 'KeyB',
    run: () => setOpen('left', !layout.open.left),
    label: 'Toggle the browser',
    group: 'View',
  });
  ui.keys.add({
    key: 'KeyD',
    run: () => setOpen('bottom', !layout.open.bottom),
    label: 'Toggle the detail pane',
    group: 'View',
  });
  ui.keys.add({
    key: 'KeyA',
    run: () => setOpen('right', !layout.open.right),
    label: 'Toggle the agent',
    group: 'View',
  });
  // Esc closes a phone's side sheet (a field, a popover or a busy agent takes the first Esc: it's theirs)
  ui.keys.add({
    key: 'Escape',
    when: () =>
      !!sheet &&
      phone() &&
      !app.agent?.busy &&
      !document.querySelector('.ek-pop, .ew-pop, [aria-modal=true]:not(.ew-region)'),
    run: () => setOpen(sheet.region, false),
    label: 'Close the browser or agent sheet',
    group: 'View',
    hidden: true,
  });

  /* ---------------------------------------------------------------- the top bar's room */
  // The top bar's items never push each other off it. The transport is a row of fixed-width groups, and something new
  // on it (a held lane's "Back to the lanes", a take's mark) can make it wider than its share: when a panel in the top
  // region runs over, the shell gives it the wordmark's room (the mark stays, and so does the Overdub name for
  // assistive tech), and takes it back once the row fits without it. (Checked with the room taken back first, in one
  // task, so nothing flickers.)
  let tightAt = 0,
    tightW = 0;
  function fitTop(force = false) {
    const over = () =>
      [...ui.regions.top.children].some((el) => !el.hidden && el.scrollWidth > el.clientWidth + 1) ||
      ui.regions.top.scrollWidth > ui.regions.top.clientWidth + 1;
    const now = performance.now();
    if (!root.classList.contains('ew-top-tight')) {
      if (!over()) return;
      root.classList.add('ew-top-tight');
      tightAt = now;
      tightW = window.innerWidth;
      ui.emit('resize');
      return;
    }
    // given up: try taking the room back once a second, or as soon as the window changes width
    if (!force && window.innerWidth === tightW && now - tightAt < 1000) return;
    tightAt = now;
    tightW = window.innerWidth;
    root.classList.remove('ew-top-tight');
    if (over()) root.classList.add('ew-top-tight');
    else ui.emit('resize');
  }
  ui.fitTop = fitTop;

  /* ---------------------------------------------------------------- toasts */
  // Where toasts go: over the arrangement's foot, right, above the detail pane, so they never cover the panel you are
  // working in down there (Sketch's Takes and their Hear / Keep / Agent, the rack, the mixer), and stacked clear of a
  // card floating in the arrangement's corner (the tour's, the welcome), or beside it when above won't fit. With no
  // room over the arrangement (a short one, or a phone's sheet open over everything) they sit at the foot of the
  // window, as the stylesheet puts them.
  // A floating window (a device's, ui/plugin.js) is never under a toast: it registers itself while it is open
  // (ui.dockToasts({ el, box }) -> undock), and the toasts stand beside it where there's room for them, else in its own
  // line (box: a phone's full-screen window always), and go back to the stack when it closes.
  let dock = null;
  ui.dockToasts = (d) => {
    dock = d;
    placeToasts();
    return () => {
      if (dock !== d) return;
      dock = null;
      for (const t of [...d.box.children]) toasts.append(t);
      placeToasts();
    };
  };
  const toastsNow = () =>
    [...toasts.children, ...(dock ? dock.box.children : [])].filter((t) => t.classList.contains('ew-toast'));
  // the tour's card, moved up to make room for a toast (see below), goes back to its corner when the toasts have gone
  const unlift = () => {
    for (const card of root.querySelectorAll('.ob[data-lifted]')) {
      card.style.bottom = '';
      card.style.maxHeight = '';
      delete card.dataset.lifted;
    }
  };
  // The stack clear of the open window: beside it (its right, then its left) where a 260 px note fits, else in the
  // window's own line. Decided from the window's place alone, so a toast is moved once, not on every placing.
  function keepClear() {
    const w = dock.el.isConnected ? dock.el.getBoundingClientRect() : null;
    if (!w || !w.width) return;
    const vw = window.innerWidth,
      gap = 12,
      need = 260;
    const rightRoom = vw - w.right - 2 * gap,
      leftRoom = w.left - 2 * gap;
    const where = phone() ? 'in' : rightRoom >= need ? 'right' : leftRoom >= need ? 'left' : 'in';
    if (where === 'in') {
      for (const t of [...toasts.children]) dock.box.append(t);
      return;
    }
    for (const t of [...dock.box.children]) toasts.append(t);
    if (where === 'right') {
      toasts.style.right = gap + 'px';
      toasts.style.maxWidth = Math.min(600, rightRoom) + 'px';
    } else {
      toasts.style.right = vw - w.left + gap + 'px';
      toasts.style.maxWidth = Math.min(600, leftRoom) + 'px';
    }
  }
  function placeToasts() {
    if (!toastsNow().length) {
      unlift();
      return;
    }
    const vw = window.innerWidth,
      vh = window.innerHeight,
      c = center.box.getBoundingClientRect(),
      gap = phone() ? 12 : 22;
    const sheetOpen = phone() && (layout.open.left || layout.open.right);
    let right = null,
      bottom = null,
      lifted = false;
    if (!sheetOpen && c.height >= 140 && c.width >= 240) {
      right = Math.max(12, vw - c.right + gap);
      bottom = Math.max(12, vh - c.bottom + 14);
      // first where it would be, no wider than the arrangement (not out over the browser beside it), then out of the
      // way of a floating card
      toasts.style.right = phone() ? '' : right + 'px';
      toasts.style.bottom = bottom + 'px';
      toasts.style.maxWidth = phone() ? '' : `${Math.max(220, Math.min(600, c.width - 2 * gap))}px`;
      const t = toasts.getBoundingClientRect();
      for (const card of root.querySelectorAll('.ob:not(.out), .ar-welcome:not(.out)')) {
        if (card.dataset.lifted) {
          lifted = true;
          continue;
        }
        const r = card.getBoundingClientRect();
        if (!r.width || r.left >= t.right || r.right <= t.left || r.top >= t.bottom || r.bottom <= t.top) continue;
        const up = vh - r.top + 8;
        if (vh - up - t.height >= c.top + 8) {
          bottom = up;
          break;
        }
        // no room above it: beside it, on the left, if the arrangement is wide enough
        if (!phone() && r.left - c.left - t.width >= 20) {
          right = vw - r.left + 10;
          break;
        }
        // nor beside it (a short, narrow window: the card fills the arrangement): the tour's card moves up over the
        // toast and scrolls inside, so the toast covers neither its foot (Skip this step) nor the detail pane
        if (card.classList.contains('ob') && card.offsetParent) {
          const host = card.offsetParent.getBoundingClientRect();
          card.style.bottom = `${Math.max(8, host.bottom - t.top + 8)}px`;
          card.style.maxHeight = `${Math.max(96, t.top - 8 - Math.max(host.top, c.top) - 8)}px`;
          card.dataset.lifted = '1';
          lifted = true;
        }
      }
    }
    if (!lifted) unlift();
    toasts.style.right = right == null || phone() ? '' : right + 'px';
    toasts.style.bottom = bottom == null ? '' : bottom + 'px';
    if (right == null || phone()) toasts.style.maxWidth = '';
    if (dock) keepClear();
  }
  ui.placeToasts = () => {
    placeToasts();
  };

  // A toast with an action stays at least 10 s (time to reach its button from the keyboard), and its clock stops
  // while the pointer or focus is on it.
  // It is a plain ruled note (no pill, no glow): what happened, then its action as an underlined word past a hairline.
  // text: a string (a key in backticks, `0`, is drawn as a key), a node, or an array of both.
  // The same words again while they're still up (a monitor complaining on every change, a key pressed twice) don't
  // stack: the note there takes the newest's action and clock and counts them, "×3". A phone shows two at most (the
  // oldest goes for the newest), so they never pile over what you're using.
  ui.toast = (text, { kind = 'info', ms = 3200, action = null } = {}) => {
    const words = (Array.isArray(text) ? text : [text])
      .map((x) => (typeof x === 'string' ? x : x?.textContent || ''))
      .join('');
    const key = `${kind}|${words}|${action?.label || ''}`;
    const same = toastsNow().find((x) => x._key === key && !x.classList.contains('out'));
    if (same) {
      same._again(action, ms);
      return same;
    }
    let act = action;
    const t = h(
      `div.ew-toast.ew-toast-${kind}`,
      h('span.ew-toast-text', toastText(text)),
      action
        ? [
            h('i.ew-toast-sep', { 'aria-hidden': 'true' }),
            h(
              'button.btn.btn-txt.ew-toast-act',
              {
                type: 'button',
                onclick: () => {
                  act.run();
                  t.remove();
                },
              },
              action.label,
            ),
          ]
        : null,
    );
    t._key = key;
    toasts.append(t);
    if (phone()) {
      const up = toastsNow().filter((x) => !x.classList.contains('out'));
      for (const x of up.slice(0, Math.max(0, up.length - 2))) {
        x.classList.add('out');
        setTimeout(() => x.remove(), 300);
      }
    }
    placeToasts();
    let left = action ? Math.max(ms, 10000) : ms,
      since = performance.now(),
      timer = 0,
      held = 0,
      n = 1;
    const go = () => {
      since = performance.now();
      timer = setTimeout(() => {
        t.classList.add('out');
        setTimeout(() => t.remove(), 300);
      }, left);
    };
    const hold = () => {
      if (held++) return;
      clearTimeout(timer);
      left = Math.max(1500, left - (performance.now() - since));
    };
    const free = () => {
      if (held && !--held) go();
    };
    t._again = (a2, ms2) => {
      n++;
      if (a2) act = a2;
      let c = t.querySelector('.ew-toast-n');
      if (!c) {
        c = h('span.ew-toast-n', { 'aria-label': '' });
        t.querySelector('.ew-toast-text').after(c);
      }
      c.textContent = `×${n}`;
      c.setAttribute('aria-label', `${n} times`);
      left = a2 ? Math.max(ms2, 10000) : ms2;
      if (!held) {
        clearTimeout(timer);
        go();
      }
    };
    t.addEventListener('pointerenter', hold);
    t.addEventListener('pointerleave', free);
    t.addEventListener('focusin', hold);
    t.addEventListener('focusout', (e) => {
      if (!t.contains(e.relatedTarget)) free();
    });
    go();
    return t;
  };

  let annT = 0;
  ui.announce = (text) => {
    clearTimeout(annT);
    announcer.textContent = ''; // cleared first, so the same line twice is still read twice
    annT = setTimeout(() => {
      announcer.textContent = String(text || '');
    }, 60);
  };

  return ui;
}

// a toast's words: `X` in a string is a key (kbd); nodes and arrays pass through
function toastText(text) {
  if (Array.isArray(text)) return text.flatMap(toastText);
  if (text == null || typeof text !== 'string') return text == null ? [] : [text];
  return text
    .split(/`([^`\n]{1,12})`/)
    .map((x, i) => (i % 2 ? h('kbd', x) : x))
    .filter((x) => x !== '');
}

const SHELL_CSS = `
.ew-announce { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
html, body { height: 100%; margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-ui); font-size: 13px; }
body { overflow: hidden; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }
.ew-shell { display: grid; grid-template-rows: 64px 1fr; height: 100vh; }
/* the top bar: the room's ground and one hairline under it; its regions are split by hairlines (ui/transport.js) */
.ew-top { display: flex; align-items: center; gap: 0; padding: 0 10px 0 16px; background: var(--bg); border-bottom: var(--rule); min-width: 0; }
.ew-brand { display: flex; align-items: center; gap: 7px; padding-right: 12px; margin-right: 0; border-right: var(--rule); height: 40px; text-decoration: none; color: var(--text); flex: none; }
.ew-brand img { display: block; }
.ew-mark { width: 26px; height: 26px; }
.ew-word { width: auto; height: 17px; margin-top: 1px; }   /* the wordmark: Archivo Expanded ExtraBold Italic, set as outlines */
.ew-top-tight .ew-brand .ew-word { display: none; }   /* (a crowded bar: the mark alone, so nothing on the bar is pushed off) */
.ew-region-top { flex: 1; min-width: 0; align-self: stretch; display: flex; flex-direction: row; align-items: center; gap: 8px; background: transparent; overflow: visible; }
.ew-region-top > .ew-panel { flex: 1; min-width: 0; }
.ew-ws { display: flex; align-items: center; gap: 6px; flex: none; height: 40px; margin-left: 6px; padding-left: 8px; border-left: var(--rule); min-width: 0; }
.ew-ws:empty, .ws-full .ew-ws:not(.ws-here) { display: none; }
.ew-region-right { position: relative; }
.ew-ws-side { position: absolute; top: 0; right: 12px; z-index: 2; height: 40px; display: flex; align-items: center; gap: 4px; }
.ew-ws-side:empty, .ws-simple .ew-ws-side { display: none; }
@media (max-width: 900px) { .ew-ws-side { top: env(safe-area-inset-top); right: calc(env(safe-area-inset-right) + 58px); height: 52px; } }
@media (max-width: 640px) { .ew-ws-side { top: 20px; height: 44px; } }
/* the simple view puts the pane buttons away (data-feature="panes"), but a phone's Agent button is how its sheet opens */
@media (max-width: 900px) { .ws-off-panes .ew-toggles > .ew-t-panelRight { display: inline-grid !important; } }
@media (max-width: 640px) { .ws-off-panes .ew-toggles > .ew-t-panelRight { display: inline-flex !important; } }
.ew-toggles { display: flex; align-items: center; gap: 0; flex: none; height: 40px; margin-left: 6px; padding-left: 4px; border-left: var(--rule); }
.ew-iconbtn { display: inline-grid; place-items: center; width: 30px; height: 32px; border: 0; border-radius: var(--r-press); background: transparent; color: var(--text-3); cursor: pointer; }
.ew-iconbtn:hover { background: var(--bg-3); color: var(--text); }
.ew-iconbtn[aria-expanded="true"] { color: var(--text-2); }
.ew-t-mark { display: none; }
.ew-iconbtn:focus-visible, .ew-tab:focus-visible, .ew-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.ico { display: inline-grid; place-items: center; line-height: 0; }
.ew-t-ico { display: contents; }
.ew-t-label { display: none; }
.ew-body { display: grid; grid-template-columns: var(--left-w) 4px 1fr 4px var(--right-w); min-height: 0; }
.ew-closed-left .ew-split-l, .ew-closed-right .ew-split-r { pointer-events: none; }
.ew-main { display: grid; grid-template-rows: 1fr 4px var(--bottom-h); min-width: 0; min-height: 0; }
.ew-closed-bottom .ew-split-v { pointer-events: none; }
.ew-region { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg); }
/* two grounds: the room (the arranger, the browser, the dock) and the second plane (the agent and History) */
.ew-region-left, .ew-region-bottom { background: var(--bg); }
.ew-region-right { background: var(--panel); }
/* tabs are words; the open one is underlined in cream (2 px) and nothing is boxed */
.ew-tabs { display: flex; align-items: stretch; gap: 20px; height: 40px; padding: 0 16px; border-bottom: var(--rule); flex: none; overflow-x: auto; scrollbar-width: none; }
.ew-region-center > .ew-tabs, .ew-single > .ew-tabs { display: none; }
.ew-tab { display: flex; align-items: center; gap: 6px; padding: 0; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--text-3); cursor: pointer; white-space: nowrap; font-size: 13px; font-weight: 600; letter-spacing: 0; }
.ew-tab:hover { color: var(--text-2); }
.ew-shell .ew-tab.on, .ew-tab.on { color: var(--text); background: none; border-bottom-color: var(--text); box-shadow: none; }
.ew-content { position: relative; flex: 1; min-height: 0; min-width: 0; }
.ew-panel { position: absolute; inset: 0; overflow: auto; }
.ew-panel[hidden] { display: none; }
.ew-loading { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; color: var(--text-3); font-size: 12px; letter-spacing: .02em; }
.ew-content:has(> .ew-panel:not([hidden])) > .ew-loading { display: none; }
.ew-region-top .ew-panel { position: static; overflow: visible; }
/* the splits are hairlines (the 4 px column is the grab area) */
.ew-split { position: relative; z-index: 2; background: transparent; }
.ew-split-v { cursor: row-resize; background: linear-gradient(var(--line-2), var(--line-2)) center / 100% 1px no-repeat; }
.ew-split-l, .ew-split-r { cursor: col-resize; background: linear-gradient(var(--line), var(--line)) center / 1px 100% no-repeat; }
.ew-split-v:hover { background-image: linear-gradient(var(--text-3), var(--text-3)); }
.ew-split-l:hover, .ew-split-r:hover { background-image: linear-gradient(var(--line-2), var(--line-2)); }
.ew-panel-error { margin: 16px; padding: 12px; border: 1px solid var(--bad); border-radius: 0; color: var(--bad); }
/* a toast is a plain ruled note over the work, bottom right of the arrangement: what happened, a hairline, its action */
.ew-toasts { position: fixed; right: calc(var(--right-w, 0px) + 22px); bottom: 18px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; z-index: 1000; pointer-events: none; max-width: min(600px, calc(100vw - 32px)); }
.ew-toast { pointer-events: auto; display: flex; align-items: center; gap: 14px; min-height: 40px; padding: 8px 10px 8px 14px; border-radius: 0; background: var(--bg-3); border: var(--rule-2); box-shadow: var(--shadow-2); color: var(--text); font-size: 13px; line-height: 1.4; animation: ew-in .16s var(--ease, ease) both; }
.ew-toast:not(:has(.ew-toast-act)) { padding-right: 14px; }
.ew-toast-text kbd { margin: 0 1px; color: var(--text); }
/* the same note again while it's up: counted, not stacked */
.ew-toast-n { flex: none; margin-left: -6px; font: 600 12px/1 var(--font-mono); color: var(--text-3); }
.ew-toast-sep { flex: none; width: 1px; align-self: stretch; margin: -2px 0; background: var(--line-2); }
.ew-toast-act { flex: none; color: var(--text); }
.ew-toast-bad { border-color: color-mix(in srgb, var(--rec) 55%, var(--line-2)); }
.ew-toast.out { opacity: 0; transition: opacity .16s var(--ease, ease); }
/* on a touch screen there is no hover to pause a toast, and an action toast stays 10 s over whatever is under it
   (a phone's agent sheet, its take cards): the text lets a tap through, only the toast's own button takes one */
@media (pointer: coarse) { .ew-toast { pointer-events: none; } .ew-toast button { pointer-events: auto; } }
@keyframes ew-in { from { opacity: 0; transform: translateY(4px); } }
/* shared widgets: the older names draw as the kit's buttons (.btn): a rule edge, 2 px corners, no ground */
.ew-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: var(--r-press); border: var(--rule-2); background: none; color: var(--text); cursor: pointer; font-weight: 600; font-size: 12.5px; white-space: nowrap; }
.ew-btn:hover { border-color: var(--text-3); }
.ew-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.ew-btn-primary:hover { border-color: var(--accent); filter: brightness(1.06); }
/* an action that goes to the agent: a plain key with the agent's stroke on it, never a tinted box */
.ew-btn-agent { background: none; border: var(--rule-2); border-radius: var(--r-press); color: var(--text); box-shadow: none; }
.ew-btn-agent:hover { background: none; border-color: var(--text-3); }
.ew-btn-agent .ico, .ew-btn-agent svg { color: var(--agent); }
.ew-btn-small { height: 24px; padding: 0 8px; font-size: 11.5px; }
.ew-input { height: 30px; padding: 0 10px; border-radius: var(--r-press); border: var(--rule-2); background: var(--bg); color: var(--text); font: inherit; }
.ew-input:focus { outline: 2px solid var(--accent-2); outline-offset: -1px; }
.ew-muted { color: var(--text-3); }
.ew-mono { font-family: var(--font-mono); }
.ew-empty { padding: 28px 20px; color: var(--text-3); text-align: center; line-height: 1.5; }
::-webkit-scrollbar { width: 10px; height: 10px; } ::-webkit-scrollbar-thumb { background: var(--line-2); border-radius: 0; border: 3px solid transparent; background-clip: padding-box; } ::-webkit-scrollbar-track { background: transparent; }
.ew-sheet-x, .ew-grip { display: none; }
/* A phone (and any window under 900 px): the browser and the agent open as full-height sheets with a close button,
   the detail pane is a bottom sheet with a handle (drag it, or tap it to tuck the sheet down to its tabs), every
   control a finger uses is at least 40 px and no text is under 12 px. Under 640 px the top bar takes two rows: the
   song (title, menu, panes), then the transport. app/style/app.css carries the panels' side of it. */
@media (max-width: 900px) {
  .ew-shell { height: 100vh; height: 100dvh; grid-template-rows: auto minmax(0, 1fr); }
  .ew-top { min-height: 52px; padding: env(safe-area-inset-top) max(8px, env(safe-area-inset-right)) 0 max(8px, env(safe-area-inset-left)); }
  .ew-brand .ew-word { display: none; }
  .ew-iconbtn { width: 40px; height: 40px; }
  .ew-body { grid-template-columns: 0 0 minmax(0, 1fr) 0 0; }
  .ew-body > .ew-main { grid-column: 3; }
  .ew-split-l, .ew-split-r { display: none; }
  .ew-tabs { height: auto; }
  .ew-tab { min-height: 44px; padding: 0 2px; font-size: 13px; }
  /* the side sheets */
  .ew-region-left, .ew-region-right { position: fixed; top: 0; bottom: 0; width: min(100vw, 440px); z-index: 60; box-shadow: var(--shadow-2);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); animation: ew-sheet-in .22s var(--ease, ease) both; }
  .ew-region-left { left: 0; --ew-sheet-from: -24px; } .ew-region-right { right: 0; --ew-sheet-from: 24px; }
  .ew-closed-left .ew-region-left, .ew-closed-right .ew-region-right { display: none; }
  .ew-region-left > .ew-tabs, .ew-region-right > .ew-tabs { min-height: 52px; align-items: flex-end; padding: 4px 56px 0 8px; }
  .ew-region-left.ew-single > .ew-tabs, .ew-region-right.ew-single > .ew-tabs { display: flex; }
  .ew-sheet-x { display: grid; place-items: center; position: absolute; top: calc(env(safe-area-inset-top) + 4px); right: calc(env(safe-area-inset-right) + 6px); z-index: 3;
    width: 44px; height: 44px; border: var(--rule-2); border-radius: var(--r-press); background: var(--bg); color: var(--text); cursor: pointer; }
  .ew-sheet-x:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
  /* the bottom sheet: a handle, a row of tabs a thumb can hit, then the pane */
  .ew-main { grid-template-rows: minmax(0, 1fr) 22px var(--bottom-h); background: var(--bg); }
  .ew-closed-bottom .ew-main { grid-template-rows: minmax(0, 1fr) 22px auto; }
  .ew-closed-bottom .ew-split-v { pointer-events: auto; }
  .ew-closed-bottom .ew-region-bottom > .ew-content { display: none; }
  .ew-split-v { display: block; background: var(--bg); border-top: var(--rule-heavy); border-radius: 0; box-shadow: 0 -10px 24px -14px #000; touch-action: none; cursor: grab; }
  .ew-split-v:hover { background: var(--bg); }
  .ew-grip { display: block; position: relative; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: inherit; touch-action: none; }
  .ew-grip::before { content: ''; position: absolute; left: 50%; top: 8px; width: 36px; height: 3px; margin-left: -18px; border-radius: 0; background: var(--text-3); }
  .ew-grip::after { content: ''; position: absolute; left: 0; right: 0; top: -24px; bottom: 0; }   /* a 44 px target, most of it above the line */
  .ew-grip:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; border-radius: 0; }
  .ew-region-bottom { padding-bottom: env(safe-area-inset-bottom); }
  .ew-region-bottom > .ew-tabs { gap: 0; padding: 0 max(4px, env(safe-area-inset-right)) 0 max(4px, env(safe-area-inset-left)); overflow: hidden; }
  .ew-region-bottom .ew-tab { flex: 1 1 0; min-width: 0; height: 48px; justify-content: center; padding: 0 2px; font-size: 12.5px; letter-spacing: 0; }
  .ew-region-bottom .ew-tab > span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .ew-toasts { left: 12px; right: 12px; bottom: calc(84px + env(safe-area-inset-bottom)); max-width: none; align-items: stretch; }
  .ew-toast { max-width: 100%; }
  .ew-toast-act { min-height: 40px; padding: 0 6px; }
}
@keyframes ew-sheet-in { from { opacity: 0; transform: translateX(var(--ew-sheet-from, 0)); } }
@media (max-width: 640px) {
  .ew-region-left, .ew-region-right { width: 100%; }
  .ew-toggles { height: auto; margin-left: 0; padding-left: 0; border-left: 0; }
  .ew-iconbtn.ew-labelled { display: inline-flex; align-items: center; width: auto; padding: 0 9px; font-size: 13px; font-weight: 600; color: var(--text); border: var(--rule-2); height: 40px; margin-left: 4px; border-radius: var(--r-press); }
  .ew-iconbtn.ew-labelled .ew-t-ico { display: none; }
  .ew-iconbtn.ew-labelled .ew-t-label { display: inline-flex; align-items: center; gap: 6px; line-height: 1; }
  .ew-iconbtn.ew-labelled .ew-t-mark { display: inline-grid; color: var(--agent); }
  .ew-iconbtn.ew-labelled[aria-expanded=true] { background: var(--text); border-color: var(--text); color: var(--bg); }
}
/* the agent on a phone: a bottom sheet at about 70% of the height (less on a short screen: a lane stays in view) with a
   handle, the song in view above it
   (.ew-agent-full: the whole height). Wider than 640 px it stays a full-height sheet, with no handle. */
.ew-agent-grip { display: none; }
@media (max-width: 640px) {
  .ew-region-right { top: auto; left: 0; right: 0; height: min(70vh, calc(100vh - 264px)); height: min(70dvh, calc(100dvh - 264px)); border-radius: 0; border-top: var(--rule-heavy);
    box-shadow: 0 -12px 30px -12px #000; animation-name: ew-sheet-up; }
  .ew-agent-full .ew-region-right { height: 100vh; height: 100dvh; border-radius: 0; }
  .ew-agent-grip { display: block; position: absolute; top: 0; left: 0; right: 56px; height: 24px; z-index: 2; padding: 0; border: 0; background: transparent; cursor: grab; touch-action: none; }
  .ew-agent-grip::before { content: ''; position: absolute; left: calc(50% + 28px); top: 8px; width: 36px; height: 3px; margin-left: -18px; border-radius: 0; background: var(--text-3); }
  .ew-agent-grip:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
  .ew-region-right > .ew-tabs { padding-top: 20px; }
  /* the detail sheet steps aside under it, so the lanes (not the mixer) are what shows above the agent */
  .ew-shell:not(.ew-closed-right):not(.ew-agent-full) .ew-main { grid-template-rows: minmax(0, 1fr) 0 0; }
  .ew-shell:not(.ew-closed-right):not(.ew-agent-full) :is(.ew-split-v, .ew-region-bottom) { visibility: hidden; }
}
@keyframes ew-sheet-up { from { opacity: 0; transform: translateY(32px); } }
@media (max-width: 380px) { .ew-iconbtn.ew-labelled { padding: 0 7px; margin-left: 2px; font-size: 12.5px; } }
/* Less motion: every animation runs once, at once, and lands on its end state (never an infinite loop at frame rate,
   which strobes), pseudo-elements included. Status pulses hold still in their "on" look. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important; transition-duration: .001ms !important; transition-delay: 0s !important; scroll-behavior: auto !important; }
  .ag-typing i { opacity: .85; }                              /* the agent is typing: three lit dots */
}
`;
