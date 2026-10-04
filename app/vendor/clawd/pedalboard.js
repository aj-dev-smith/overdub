// vendored verbatim from clawd-o-matic/web/pedalboard.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ================================================================ Claw'd-o-Matic: the pedalboard and the library (plug in) */
// Concatenated after pedals.js and the pedal packs (pedals/*.js). What you see of the pedal platform: the board (the
// pedals on it in signal order, the amp's chip where the amp is, an Add slot), a chain strip over it, and the library
// (a sheet of every registered pedal, by category, with search) to add from. Faces are drawn from each def's look.
//   Reorder: drag a pedal (by its grip on touch; anywhere but its controls with a mouse), or its grip's arrows / menu,
//   or Alt+arrows anywhere on it. Remove: its ×, Delete on its grip, or the menu (with an Undo).

// A def's look, the gaps filled from a hash of its id (so fifty pedals don't all look the same)
const PEDAL_LOOKS = { shape: ['box', 'wide', 'mini', 'round', 'wah', 'rack'], finish: ['flat', 'sparkle', 'brushed', 'hammer', 'stripe', 'check'],
  knob: ['black', 'chicken', 'cream', 'chrome', 'small'], label: ['script', 'block', 'plate', 'stencil'] };
function pedalLook(def) {
  let h = 2166136261;
  for (const ch of def.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pick = (list, n) => list[(h >>> n) % list.length];
  const L = Object.assign({}, def.look || {});
  const n = def.knobs.length;
  if (!PEDAL_LOOKS.shape.includes(L.shape)) L.shape = n >= 5 ? 'wide' : 'box';
  if (L.shape === 'round' && n > 3) L.shape = 'box';
  if (L.shape === 'mini' && n > 2) L.shape = 'box';
  if (L.shape === 'wah' && !def.knobs.some((k) => k.key === L.treadle && k.type === 'knob')) L.treadle = (def.knobs.find((k) => k.type === 'knob') || {}).key;
  if (L.shape === 'wah' && !L.treadle) L.shape = 'box';
  if (L.shape !== 'wah') L.treadle = null;
  if (!PEDAL_LOOKS.finish.includes(L.finish)) L.finish = pick(['flat', 'flat', 'sparkle', 'brushed', 'hammer', 'stripe', 'check'], 3);
  if (!PEDAL_LOOKS.knob.includes(L.knob)) L.knob = pick(['black', 'black', 'chicken', 'cream', 'chrome'], 7);
  if (!PEDAL_LOOKS.label.includes(L.label)) L.label = pick(['script', 'script', 'block', 'plate', 'stencil'], 11);
  if (!(L.foot2 && def.knobs.some((k) => k.key === L.foot2 && k.type === 'switch'))) L.foot2 = null;
  if (L.foot2 && L.shape !== 'wide' && L.shape !== 'rack') L.shape = 'wide';
  L.led = /^#[0-9a-f]{3,8}$/i.test(L.led || '') ? L.led : '#ff3b3b';
  return L;
}
const pedalEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const pedalKindWord = (def) => def.kind.toLowerCase().replace(/ · .*$/, '');

/* ---- a mini switch (a toggle lever between 2-3 positions, a knob of type 'switch'): click cycles, arrows set */
function pedalSwitch({ label, opts, value, onInput, name }) {
  const w = document.createElement('div');
  w.className = 'ms';
  w.innerHTML = `<span class="ms-l">${pedalEsc(label)}</span><button type="button" class="ms-b" role="slider" aria-label="${pedalEsc((name ? name + ' ' : '') + label.toLowerCase())}" aria-valuemin="0" aria-valuemax="${opts.length - 1}"><i></i></button><span class="ms-o"></span>`;
  const b = w.querySelector('.ms-b'), o = w.querySelector('.ms-o');
  let v = Math.round(value);
  const draw = () => {
    const a = opts.length < 2 ? 0 : -32 + (64 * v) / (opts.length - 1);
    w.style.setProperty('--ma', a + 'deg');
    b.setAttribute('aria-valuenow', v); b.setAttribute('aria-valuetext', opts[v]); o.textContent = opts[v];
  };
  const put = (x) => { x = Math.max(0, Math.min(opts.length - 1, x)); if (x === v) return; v = x; draw(); onInput(v); };
  b.addEventListener('click', () => put(v >= opts.length - 1 ? 0 : v + 1));
  b.addEventListener('keydown', (e) => {
    if (e.altKey) return;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d != null) { e.preventDefault(); put(v + d); } else if (e.key === 'Home') { e.preventDefault(); put(0); } else if (e.key === 'End') { e.preventDefault(); put(opts.length - 1); }
  });
  draw();
  w.setValue = (x) => { v = Math.max(0, Math.min(opts.length - 1, Math.round(x))); draw(); };
  return w;
}

/* ---- a pedal's face, from its def. live: working knobs and switches (the board); else a still picture (the library).
   opts: { entry (its settings), onKnob(key, v), onStomp(), onFoot2() } */
/* ---- a tap-tempo button: tap it in time (2 taps or more; a pause of 2 s starts over) and its value is that tempo in
   bpm; the readout under it says SONG while the pedal follows the song's tempo, and clicking it goes back to that */
function pedalTap({ label, value, onInput, name }) {
  const w = document.createElement('div');
  w.className = 'tp';
  w.innerHTML = `<button type="button" class="tp-b" aria-label="${pedalEsc((name ? name + ' ' : '') + 'tap tempo')}">${pedalEsc(label)}</button><button type="button" class="tp-r" title="Tapped: click to follow the song's tempo again"></button>`;
  const b = w.firstChild, r = w.lastChild;
  let v = value || 0, taps = [];
  const draw = () => { const on = v >= 40; r.textContent = on ? Math.round(v) + ' BPM' : 'SONG'; r.disabled = !on; w.classList.toggle('on', on); r.setAttribute('aria-label', on ? `tapped ${Math.round(v)} bpm: follow the song instead` : 'following the song'); };
  b.addEventListener('pointerdown', (e) => {
    const now = e.timeStamp || performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now); if (taps.length > 5) taps.shift();
    w.classList.remove('hit'); void w.offsetWidth; w.classList.add('hit');
    if (taps.length < 2) return;
    const gap = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    v = Math.max(40, Math.min(300, Math.round(600000 / gap) / 10)); draw(); onInput(v);
  });
  b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } });
  r.addEventListener('click', () => { if (v < 40) return; v = 0; taps = []; draw(); onInput(0); });
  draw();
  w.setValue = (x) => { v = +x || 0; draw(); };
  return w;
}

function pedalFace(def, opts) {
  const L = pedalLook(def), e = opts.entry || boardEntry(def.id), live = !!opts.live;
  const d = document.createElement('div');
  d.className = `pd pd-${L.shape} fin-${L.finish} ks-${L.knob} lb-${L.label}`;
  d.dataset.pedal = def.id;
  d.style.setProperty('--pc', def.color); d.style.setProperty('--pi', def.ink); d.style.setProperty('--led', L.led);
  const knobs = def.knobs.filter((k) => k.key !== L.treadle);
  d.innerHTML = `<span class="pd-led" aria-hidden="true"></span>${L.treadle ? '<div class="pd-tread"></div>' : ''}<div class="pd-knobs" data-n="${knobs.length}"></div>`
    + `<div class="pd-name"><b>${pedalEsc(def.name)}</b><small>${pedalEsc(def.kind)}</small></div>`
    + `<div class="pd-feet"><button type="button" class="pd-sw" title="Stomp"${live ? '' : ' tabindex="-1" aria-hidden="true"'}></button></div>`;
  const box = d.querySelector('.pd-knobs'), widgets = {};
  const put = (k, el) => { widgets[k.key] = el; (k.key === L.treadle ? d.querySelector('.pd-tread') : box).appendChild(el); };
  for (const k of def.knobs) {
    const fmt = k.fmt || undefined;
    if (!live) {
      const s = document.createElement('div'), frac = (e[k.key] - k.min) / (k.max - k.min);
      if (k.type === 'tap') { s.className = 'tp' + (e[k.key] >= 40 ? ' on' : ''); s.innerHTML = `<span class="tp-b">${pedalEsc(k.label)}</span><span class="tp-r">${pedalEsc(k.fmt(e[k.key]))}</span>`; put(k, s); continue; }
      s.className = k.type === 'switch' ? 'ms' : 'kn';
      s.style.setProperty('--kv', frac.toFixed(3));
      s.innerHTML = k.type === 'switch' ? `<span class="ms-l">${pedalEsc(k.label)}</span><span class="ms-b"><i></i></span>`
        : `<div class="kn-dial"><div class="kn-cap" style="transform: rotate(${(-135 + 270 * frac).toFixed(1)}deg)"><i></i></div></div><span class="kn-l">${pedalEsc(k.label)}</span>`;
      if (k.type === 'switch') s.style.setProperty('--ma', (k.opts.length < 2 ? 0 : -32 + (64 * e[k.key]) / (k.opts.length - 1)) + 'deg');
      put(k, s);
      continue;
    }
    const el = k.type === 'tap' ? pedalTap({ label: k.label, value: e[k.key], name: def.name, onInput: (v) => opts.onKnob(k.key, v) }) : k.type === 'switch'
      ? pedalSwitch({ label: k.label, opts: k.opts, value: e[k.key], name: def.name, onInput: (v) => opts.onKnob(k.key, v) })
      : plugKnob({ label: k.label, min: k.min, max: k.max, step: k.step, def: k.def, fmt, value: e[k.key], name: def.name, onInput: (v) => opts.onKnob(k.key, v) });
    if (k.key === L.treadle) el.classList.add('kn-tread');
    put(k, el);
  }
  if (L.foot2) {
    const k = def.knobs.find((q) => q.key === L.foot2), b = document.createElement('button');
    b.type = 'button'; b.className = 'pd-sw pd-sw2'; b.title = k.label;
    b.innerHTML = `<small>${pedalEsc(k.label)}</small>`;
    if (live) { b.setAttribute('aria-label', `${def.name} ${k.label.toLowerCase()}: next`); b.addEventListener('click', () => opts.onFoot2(k)); } else { b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
    d.querySelector('.pd-feet').appendChild(b);
  }
  if (live) {
    const sw = d.querySelector('.pd-sw');
    sw.setAttribute('aria-label', `${def.name} (${pedalKindWord(def)}) on`);
    sw.addEventListener('click', () => opts.onStomp());
  }
  d.classList.toggle('on', !!e.on);
  d.widgets = widgets;
  return d;
}

/* ---- the board. opts: { P (P.board is the list; this replaces it or changes it in place), onChange() (the sound and the
   save), ampChip (ampui.js's button) }. Returns { root, refresh() (P.board changed under it: a preset), api (tests) } */
function plugBoard({ P, onChange, ampChip }) {
  const root = document.createElement('div');
  root.className = 'pb';
  root.innerHTML = `<div class="pb-bar"><div class="pb-strip" role="list" aria-label="Signal chain"></div><span class="pb-cpu" hidden></span><span class="pb-n"></span><button type="button" class="pb-lib">+ Add pedal</button></div>
    <div class="board" role="group" aria-label="Pedalboard, in signal order"><i class="pb-drop" aria-hidden="true" hidden></i></div>
    <p class="pb-say" role="status" aria-live="polite"><span></span><button type="button" class="pb-undo" hidden>Undo</button></p>`;
  const $ = (s) => root.querySelector(s);
  const board = $('.board'), strip = $('.pb-strip'), drop = $('.pb-drop');
  const els = new Map(); // uid -> the pedal's element
  const entry = (uid) => P.board.find((e) => e.uid === uid);
  const defOf = (e) => PEDAL_DEFS[e.id];
  const addSlot = document.createElement('button');
  addSlot.type = 'button'; addSlot.className = 'pb-add';
  addSlot.innerHTML = '<b aria-hidden="true">+</b><span>Add pedal</span>';
  let undo = null, sayT = 0;
  function say(t, canUndo) {
    clearTimeout(sayT);
    $('.pb-say span').textContent = t;
    $('.pb-undo').hidden = !canUndo;
    if (!canUndo) undo = null;
    sayT = setTimeout(() => { $('.pb-say span').textContent = ''; $('.pb-undo').hidden = true; undo = null; }, canUndo ? 9000 : 5000);
  }
  const changed = () => { render(); onChange(); };

  // one pedal on the board
  function make(e) {
    const def = defOf(e);
    const d = pedalFace(def, { live: true, entry: e,
      onKnob: (k, v) => { const x = entry(d.dataset.uid); if (x) { x[k] = v; onChange(); } },
      onStomp: () => { const x = entry(d.dataset.uid); if (!x) return; x.on = !x.on; paint(d, x); onChange(); strips(); },
      onFoot2: (k) => { const x = entry(d.dataset.uid); if (!x) return; x[k.key] = x[k.key] >= k.max ? 0 : x[k.key] + 1; d.widgets[k.key].setValue(x[k.key]); onChange(); } });
    d.dataset.uid = e.uid;
    d.setAttribute('role', 'group'); d.setAttribute('aria-label', `${def.name}, ${pedalKindWord(def)}`);
    d.insertAdjacentHTML('afterbegin', `<button type="button" class="pd-grip" aria-haspopup="menu" aria-label="${pedalEsc(def.name)}: move or remove" title="Drag to move · arrows move it · Delete removes it"><i></i></button><button type="button" class="pd-x" tabindex="-1" aria-label="Remove ${pedalEsc(def.name)}" title="Remove">×</button>`);
    d.title = `${def.name}: ${def.blurb}${def.nod ? ' (tips its hat to ' + def.nod + ')' : ''}`;
    return d;
  }
  function paint(d, e) {
    const def = defOf(e);
    d.classList.toggle('on', !!e.on);
    d.querySelector('.pd-sw').setAttribute('aria-pressed', !!e.on);
    for (const k of def.knobs) if (d.widgets[k.key]) d.widgets[k.key].setValue(e[k.key]);
  }
  // draw the board from P.board: reuse each pedal's element while it stays, in the list's order
  function render() {
    const keep = document.activeElement && board.contains(document.activeElement) ? document.activeElement : null;
    const want = [];
    for (const e of P.board) {
      if (e.id === 'amp') { if (ampChip) want.push(ampChip); continue; }
      let d = els.get(e.uid);
      if (d && d.dataset.pedal !== e.id) { d.remove(); d = null; }
      if (!d) { d = make(e); els.set(e.uid, d); }
      paint(d, e);
      want.push(d);
    }
    for (const [uid, d] of els) if (!want.includes(d)) { d.remove(); els.delete(uid); }
    want.push(addSlot);
    // (only move what's out of place, so focus and a drag in progress stay put)
    let at = drop.nextSibling;
    for (const el of want) { if (el !== at) board.insertBefore(el, at); else at = at.nextSibling; at = el.nextSibling; }
    if (keep && keep !== document.activeElement && keep.isConnected) keep.focus({ preventScroll: true });
    const n = boardCount(P.board);
    $('.pb-n').textContent = `${n} / ${BOARD_MAX}`;
    addSlot.disabled = $('.pb-lib').disabled = n >= BOARD_MAX;
    addSlot.title = n >= BOARD_MAX ? `The board’s full (${BOARD_MAX}). Take one off first.` : 'Add a pedal from the library';
    strips();
  }
  // What the board costs this device (pedalLoad: a quarter second rendered offline and timed), measured a moment after
  // it settles, while it's on the page and the tab's in view. Quiet when it's light; a word when a slow device may crackle.
  // Lazy: nothing is rendered until the board has first been on screen (the Plug in tab or the studio opened), so a
  // page that never touches the guitar never pays for an offline render or the worklets it loads.
  let loadT = 0, loadKey = '', loadSeen = typeof IntersectionObserver === 'undefined';
  if (!loadSeen) {
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { loadSeen = true; io.disconnect(); load(); } });
    io.observe(root);
  }
  function load() {
    clearTimeout(loadT);
    if (!loadSeen) return;
    loadT = setTimeout(async () => {
      const key = JSON.stringify(P.board.map((e) => [e.id, e.on]));
      if (!root.isConnected || document.hidden || key === loadKey) return;
      loadKey = key;
      const pc = boardCount(P.board) ? await pedalLoad({ ...P, board: JSON.parse(JSON.stringify(P.board)) }) : 0;
      if (key !== loadKey) return; // (it changed meanwhile: the next one says)
      const el = $('.pb-cpu');
      el.hidden = pc == null;
      if (pc == null) return;
      const lvl = pc >= 60 ? 'hot' : pc >= 35 ? 'warm' : '';
      el.className = 'pb-cpu' + (lvl ? ' ' + lvl : '');
      el.textContent = `CPU ${Math.max(1, Math.round(pc))}%` + (lvl === 'hot' ? ' · HEAVY' : '');
      el.title = `The board takes about ${pc.toFixed(0)}% of one core on this device (the amp and the pedals that are on).`
        + (lvl ? ' If you hear crackles, switch off or take off what you’re not using: delays, reverbs and pitch pedals cost the most.' : '');
    }, 1500);
  }
  // the chain strip: a block per pedal (lit when on) and the amp, in order; a click goes to it
  function strips() {
    load();
    strip.textContent = '';
    for (const e of P.board) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pb-si'; b.setAttribute('role', 'listitem');
      if (e.id === 'amp') { b.classList.add('amp'); b.textContent = 'AMP'; b.setAttribute('aria-label', 'The amp: go to it'); b.dataset.uid = 'amp'; }
      else {
        const def = defOf(e);
        b.style.setProperty('--c', def.color); b.classList.toggle('on', !!e.on); b.dataset.uid = e.uid;
        b.title = def.name + (e.on ? '' : ' (off)');
        b.setAttribute('aria-label', `${def.name}, ${e.on ? 'on' : 'off'}: go to it`);
      }
      strip.appendChild(b);
    }
  }
  strip.addEventListener('click', (ev) => {
    const b = ev.target.closest('.pb-si');
    if (!b) return;
    const el = b.dataset.uid === 'amp' ? ampChip : els.get(b.dataset.uid);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
    (el.querySelector('.pd-grip') || el).focus({ preventScroll: true });
    flash(el);
  });
  const flash = (el) => { if (REDUCED) return; el.classList.remove('pd-flash'); void el.offsetWidth; el.classList.add('pd-flash'); };

  // ---- changes to the list
  function add(id, at) {
    if (!PEDAL_DEFS[id] || boardCount(P.board) >= BOARD_MAX) return null;
    const e = boardEntry(id, boardUid(P.board, id), true);
    P.board.splice(at != null ? Math.max(0, Math.min(P.board.length, at)) : boardPlace(P.board, id), 0, e);
    changed();
    const d = els.get(e.uid);
    if (d && !REDUCED) d.classList.add('pd-new');
    say(`Added ${PEDAL_DEFS[id].name}${where(e.uid)}.`);
    return e.uid;
  }
  function remove(uid) {
    const i = P.board.findIndex((e) => e.uid === uid);
    if (i < 0) return;
    const [e] = P.board.splice(i, 1), next = P.board[i] || P.board[i - 1];
    changed();
    undo = { e, i };
    say(`Removed ${defOf(e).name}.`, true);
    const f = next && (next.id === 'amp' ? ampChip : els.get(next.uid) && els.get(next.uid).querySelector('.pd-grip'));
    if (f) f.focus({ preventScroll: true });
  }
  function move(uid, to) {
    const i = P.board.findIndex((e) => e.uid === uid);
    if (i < 0) return;
    to = Math.max(0, Math.min(P.board.length - 1, to));
    if (to === i) return;
    const [e] = P.board.splice(i, 1);
    P.board.splice(to, 0, e);
    changed();
    say(`${defOf(e).name}: ${to + 1} of ${P.board.length}${where(uid)}.`);
  }
  // "before the amp" / "after the amp", for what's said
  const where = (uid) => { const i = P.board.findIndex((e) => e.uid === uid), a = P.board.findIndex((e) => e.id === 'amp'); return i < a ? ', before the amp' : ', after the amp'; };
  $('.pb-undo').addEventListener('click', () => {
    if (!undo || boardCount(P.board) >= BOARD_MAX) return;
    const { e, i } = undo;
    if (P.board.some((x) => x.uid === e.uid)) e.uid = boardUid(P.board, e.id);
    P.board.splice(Math.min(i, P.board.length), 0, e);
    changed(); say(`${defOf(e).name} is back.`);
    const d = els.get(e.uid); if (d) d.querySelector('.pd-grip').focus({ preventScroll: true });
  });

  // ---- the keyboard: arrows on a grip move its pedal (Alt+arrows from anywhere on it), Delete removes
  board.addEventListener('keydown', (ev) => {
    const d = ev.target.closest && ev.target.closest('.pd');
    if (!d || !d.dataset.uid || ev.target.closest('.pd-menu')) return;
    const onGrip = ev.target.classList.contains('pd-grip');
    const i = P.board.findIndex((e) => e.uid === d.dataset.uid);
    const k = ev.key, step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[k];
    if (step && (ev.altKey || onGrip)) { ev.preventDefault(); ev.stopPropagation(); move(d.dataset.uid, i + step); regrip(d); }
    else if (onGrip && (k === 'Home' || k === 'End')) { ev.preventDefault(); move(d.dataset.uid, k === 'Home' ? 0 : P.board.length - 1); regrip(d); }
    else if (onGrip && (k === 'Delete' || k === 'Backspace')) { ev.preventDefault(); remove(d.dataset.uid); }
  }, true);
  const regrip = (d) => { const g = d.querySelector('.pd-grip'); if (document.activeElement !== g) g.focus({ preventScroll: true }); d.scrollIntoView({ block: 'nearest', inline: 'nearest' }); };

  // ---- the grip's menu
  let menu = null;
  function closeMenu(back) { if (!menu) return; const g = menu.parentNode.querySelector('.pd-grip'); menu.remove(); menu = null; g.setAttribute('aria-expanded', 'false'); if (back) g.focus({ preventScroll: true }); }
  function openMenu(d) {
    closeMenu();
    const uid = d.dataset.uid, i = P.board.findIndex((e) => e.uid === uid), e = P.board[i], def = defOf(e);
    menu = document.createElement('div');
    menu.className = 'pd-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', def.name);
    const items = [['left', '◀ Move earlier', i > 0], ['right', 'Move later ▶', i < P.board.length - 1], ['dup', 'Add another', boardCount(P.board) < BOARD_MAX], ['reset', 'Reset knobs', true], ['del', 'Remove', true]];
    menu.innerHTML = items.map(([a, t, ok]) => `<button type="button" role="menuitem" data-a="${a}"${ok ? '' : ' disabled'}>${t}</button>`).join('');
    d.appendChild(menu);
    d.querySelector('.pd-grip').setAttribute('aria-expanded', 'true');
    menu.querySelector('button:not([disabled])').focus({ preventScroll: true });
    menu.addEventListener('keydown', (ev) => {
      const bs = [...menu.querySelectorAll('button:not([disabled])')], j = bs.indexOf(document.activeElement);
      if (ev.key === 'Escape' || ev.key === 'Tab') { ev.preventDefault(); closeMenu(true); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); bs[(j + (ev.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus(); }
    });
    menu.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-a]');
      if (!b) return;
      const a = b.dataset.a, at = P.board.findIndex((x) => x.uid === uid);
      closeMenu();
      if (a === 'left' || a === 'right') { move(uid, at + (a === 'left' ? -1 : 1)); regrip(d); }
      else if (a === 'dup') { const nu = add(e.id, at + 1); const n = nu && els.get(nu); if (n) n.querySelector('.pd-grip').focus({ preventScroll: true }); }
      else if (a === 'reset') { const x = entry(uid); for (const k of def.knobs) x[k.key] = k.def; paint(d, x); onChange(); say(`${def.name}: knobs back to where they started.`); d.querySelector('.pd-grip').focus({ preventScroll: true }); }
      else if (a === 'del') remove(uid);
    });
  }
  document.addEventListener('pointerdown', (ev) => { if (menu && !menu.contains(ev.target) && !ev.target.closest('.pd-grip')) closeMenu(); });
  board.addEventListener('click', (ev) => {
    if (dragged) { dragged = false; return; }
    const g = ev.target.closest('.pd-grip'), x = ev.target.closest('.pd-x');
    if (g) { const d = g.closest('.pd'); if (menu && menu.parentNode === d) closeMenu(true); else openMenu(d); }
    else if (x) remove(x.closest('.pd').dataset.uid);
    else if (ev.target.closest('.pb-add')) lib.open();
  });
  $('.pb-lib').addEventListener('click', () => lib.open());

  // ---- dragging: pick a pedal up (after a few pixels), a gap shows where it'll land, drop it there; Escape cancels
  let drag = null, dragged = false;
  board.addEventListener('pointerdown', (ev) => {
    const d = ev.target.closest('.pd');
    if (!d || !d.dataset.uid || ev.button !== 0) return;
    const grip = ev.target.closest('.pd-grip');
    if (!grip && (ev.pointerType !== 'mouse' || ev.target.closest('.kn, .ms, .pd-sw, .pd-x, .pd-menu, button'))) return;
    drag = { d, id: ev.pointerId, x: ev.clientX, y: ev.clientY, on: false, to: -1 };
  });
  board.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.on) {
      if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) return;
      closeMenu();
      drag.on = true;
      try { board.setPointerCapture(ev.pointerId); } catch (e) { /* fine */ }
      const r = drag.d.getBoundingClientRect(), g = drag.d.cloneNode(true);
      g.classList.add('pd-ghost'); g.removeAttribute('data-uid'); g.setAttribute('aria-hidden', 'true');
      Object.assign(g.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
      document.body.appendChild(g);
      drag.g = g; drag.ox = drag.x - r.left; drag.oy = drag.y - r.top;
      drag.d.classList.add('pd-lift'); root.classList.add('dragging');
    }
    ev.preventDefault();
    drag.g.style.left = ev.clientX - drag.ox + 'px'; drag.g.style.top = ev.clientY - drag.oy + 'px';
    if (ev.clientY < 60) scrollBy(0, -14); else if (ev.clientY > innerHeight - 60) scrollBy(0, 14);
    aim(ev.clientX, ev.clientY);
  });
  // where it'd land: before or after the item under (or nearest) the pointer, in the list without the one moving
  function aim(x, y) {
    const items = [...board.children].filter((el) => (el.classList.contains('pd') || el === ampChip) && el !== drag.d);
    if (!items.length) return;
    let best = null, bd = Infinity;
    for (const el of items) {
      const r = el.getBoundingClientRect(), inRow = y >= r.top - 8 && y <= r.bottom + 8;
      const dist = (inRow ? 0 : 1e5) + Math.abs(x - (r.left + r.width / 2)) + (inRow ? 0 : Math.abs(y - (r.top + r.height / 2)));
      if (dist < bd) { bd = dist; best = { el, r }; }
    }
    const after = x > best.r.left + best.r.width / 2, k = items.indexOf(best.el) + (after ? 1 : 0);
    drag.to = k;
    const br = board.getBoundingClientRect();
    drop.hidden = false;
    drop.style.left = (after ? best.r.right + 5 : best.r.left - 5) - br.left - 2 + 'px';
    drop.style.top = best.r.top - br.top + 'px'; drop.style.height = best.r.height + 'px';
  }
  function endDrag(commit) {
    if (!drag) return;
    const D = drag;
    drag = null;
    if (!D.on) return;
    dragged = true; setTimeout(() => (dragged = false), 0);
    D.g.remove(); D.d.classList.remove('pd-lift'); root.classList.remove('dragging'); drop.hidden = true;
    if (commit && D.to >= 0) move(D.d.dataset.uid, D.to);
  }
  board.addEventListener('pointerup', () => endDrag(true));
  board.addEventListener('pointercancel', () => endDrag(false));
  document.addEventListener('keydown', (ev) => { if (drag && drag.on && ev.key === 'Escape') { ev.preventDefault(); endDrag(false); } });

  // ---- the library
  const lib = pedalLibrary({ board: () => P.board, add: (id) => { const uid = add(id); const d = uid && els.get(uid); if (d) { d.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' }); d.querySelector('.pd-grip').focus({ preventScroll: true }); } return uid; } });

  render();
  return { root, refresh: render, lib,
    api: { add, remove, move, list: () => JSON.parse(JSON.stringify(P.board)), el: board, open: () => lib.open(), close: () => lib.close() } };
}

/* ---- the library: every registered pedal by category, with search; pick one to add it to the board.
   opts: { board() (the list now), add(id) } */
function pedalLibrary({ board, add }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'lib'; dlg.setAttribute('aria-labelledby', 'lib-h');
  dlg.innerHTML = `<div class="lib-in">
    <header class="lib-head"><h3 id="lib-h">Pedal library</h3><small class="lib-n"></small><button type="button" class="lib-x" aria-label="Close the library">×</button></header>
    <input type="search" class="lib-q" placeholder="Search: fuzz, octave, shimmer, crab…" aria-label="Search pedals" autocomplete="off" spellcheck="false">
    <div class="lib-cats" role="group" aria-label="Category"></div>
    <div class="lib-grid" role="list" aria-label="Pedals"></div>
    <p class="lib-none" hidden>No pedal matches that. Try a sound (“octave”), a kind (“delay”) or a creature.</p>
  </div>`;
  document.body.appendChild(dlg);
  const $ = (s) => dlg.querySelector(s);
  const grid = $('.lib-grid'), q = $('.lib-q');
  let cat = 'all', built = 0;
  const cards = {};
  const sorted = () => PEDAL_CATS.flatMap(([c]) => PEDAL_LIST.filter((d) => d.cat === c));
  const onBoard = (id) => board().filter((e) => e.id === id).length;
  const hay = (d) => [d.id, d.name, d.kind, d.blurb, d.nod, d.cat, (PEDAL_CATS.find((x) => x[0] === d.cat) || [])[1]].join(' ').toLowerCase();
  // the cards (once per new pedal registered: packs can load late)
  function build() {
    if (built === PEDAL_LIST.length) return;
    grid.textContent = '';
    for (const d of sorted()) {
      const c = document.createElement('div');
      c.className = 'lc'; c.setAttribute('role', 'listitem'); c.dataset.pedal = d.id; c.dataset.cat = d.cat;
      c.style.setProperty('--pc', d.color);
      const face = document.createElement('div');
      face.className = 'lc-face'; face.setAttribute('aria-hidden', 'true');
      face.appendChild(pedalFace(d, { live: false }));
      c.appendChild(face);
      c.insertAdjacentHTML('beforeend', `<div class="lc-t"><b>${pedalEsc(d.name)}</b><small>${pedalEsc(d.kind)}</small><span class="lc-b">${pedalEsc(d.blurb)}</span>${d.nod ? `<span class="lc-nod">Tips its hat to ${pedalEsc(d.nod)}</span>` : ''}</div><span class="lc-on" hidden></span><button type="button" class="lc-add" aria-label="Add ${pedalEsc(d.name)} (${pedalEsc(pedalKindWord(d))}): ${pedalEsc(d.blurb)}"></button>`);
      c.title = `${d.name}: ${d.blurb}${d.nod ? '. Tips its hat to ' + d.nod + '.' : ''}`;
      c.hay = hay(d);
      grid.appendChild(c); cards[d.id] = c;
    }
    built = PEDAL_LIST.length;
  }
  function draw() {
    build();
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean), full = boardCount(board()) >= BOARD_MAX;
    const hit = (d) => words.every((w) => cards[d.id].hay.includes(w));
    const counts = { all: 0, board: 0 };
    for (const d of PEDAL_LIST) if (hit(d)) { counts.all++; counts[d.cat] = (counts[d.cat] || 0) + 1; if (onBoard(d.id)) counts.board++; }
    const tabs = [['all', 'All'], ...PEDAL_CATS.filter(([c]) => PEDAL_LIST.some((d) => d.cat === c)), ['board', 'On your board']];
    $('.lib-cats').innerHTML = tabs.map(([c, t]) => `<button type="button" class="lib-cat" data-cat="${c}" aria-pressed="${c === cat}"${counts[c] ? '' : ' data-empty'}>${t} <i>${counts[c] || 0}</i></button>`).join('');
    let shown = 0;
    for (const d of PEDAL_LIST) {
      const c = cards[d.id], n = onBoard(d.id), ok = hit(d) && (cat === 'all' || (cat === 'board' ? n > 0 : d.cat === cat));
      c.hidden = !ok; if (ok) shown++;
      c.classList.toggle('has', n > 0);
      const on = c.querySelector('.lc-on'); on.hidden = !n; on.textContent = n > 1 ? `ON BOARD ×${n}` : 'ON BOARD';
      c.querySelector('.lc-add').disabled = full;
    }
    $('.lib-none').hidden = shown > 0;
    $('.lib-n').textContent = `${PEDAL_LIST.length} pedals · ${boardCount(board())} of ${BOARD_MAX} on your board${full ? ' (full: take one off to add another)' : ''}`;
  }
  $('.lib-cats').addEventListener('click', (e) => { const b = e.target.closest('.lib-cat'); if (b) { cat = b.dataset.cat; draw(); } });
  q.addEventListener('input', () => { if (cat !== 'all' && q.value) cat = 'all'; draw(); });
  const visible = () => [...grid.querySelectorAll('.lc:not([hidden]) .lc-add')];
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const b = visible()[0]; if (b && !b.disabled) pick(b.closest('.lc').dataset.pedal); }
    else if (e.key === 'ArrowDown') { const b = visible()[0]; if (b) { e.preventDefault(); b.focus(); } }
  });
  // arrows around the grid (by rows, as it's laid out)
  grid.addEventListener('keydown', (e) => {
    const bs = visible(), i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    let to = null;
    if (e.key === 'ArrowRight') to = i + 1; else if (e.key === 'ArrowLeft') to = i - 1; else if (e.key === 'Home') to = 0; else if (e.key === 'End') to = bs.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const r = bs[i].getBoundingClientRect(), dn = e.key === 'ArrowDown';
      const row = bs.filter((b) => { const s = b.getBoundingClientRect(); return dn ? s.top > r.top + 4 : s.top < r.top - 4; });
      if (!row.length) { if (!dn) { e.preventDefault(); q.focus(); } return; }
      const y = dn ? Math.min(...row.map((b) => b.getBoundingClientRect().top)) : Math.max(...row.map((b) => b.getBoundingClientRect().top));
      const line = row.filter((b) => Math.abs(b.getBoundingClientRect().top - y) < 4);
      to = bs.indexOf(line.reduce((a, b) => (Math.abs(b.getBoundingClientRect().left - r.left) < Math.abs(a.getBoundingClientRect().left - r.left) ? b : a)));
    }
    if (to == null) return;
    e.preventDefault();
    bs[Math.max(0, Math.min(bs.length - 1, to))].focus();
  });
  grid.addEventListener('click', (e) => { const b = e.target.closest('.lc-add'); if (b && !b.disabled) pick(b.closest('.lc').dataset.pedal); });
  function pick(id) { close(); add(id); }
  function open() {
    draw();
    if (!dlg.open) dlg.showModal();
    q.focus(); q.select();
  }
  function close() { if (dlg.open) dlg.close(); }
  $('.lib-x').addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // (the backdrop)
  return { open, close, draw, el: dlg };
}

const PEDAL_CSS = `
  .pb { display: grid; gap: 8px; min-width: 0; }
  .pb-bar { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .pb-strip { flex: 1 1 auto; display: flex; align-items: center; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 4px 2px; }
  .pb-si { position: relative; flex: 0 0 auto; width: 16px; height: 18px; margin-right: 8px; padding: 0; border: 0; border-radius: 3px; cursor: pointer;
    background: var(--c); opacity: 0.4; box-shadow: inset 0 -2px 0 #0005, 0 0 0 1px #0008; }
  .pb-si::after { content: ''; position: absolute; left: 100%; top: 50%; width: 8px; height: 2px; margin-top: -1px; background: var(--line2); }
  .pb-si:last-child { margin-right: 0; } .pb-si:last-child::after { display: none; }
  .pb-si.on { opacity: 1; box-shadow: inset 0 -2px 0 #0005, 0 0 0 1px #0008, 0 0 8px var(--c); }
  .pb-si.amp { width: auto; padding: 0 6px; opacity: 1; background: linear-gradient(#3d3843, #25212a); color: var(--paper); font: 400 7px/18px var(--f-px); letter-spacing: 0.1em; }
  .pb-si:hover { transform: translateY(-1px); }
  .pb-si:focus-visible, .pb-lib:focus-visible, .pb-add:focus-visible, .pb-undo:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .pb-n { flex: 0 0 auto; font: 400 8px var(--f-px); letter-spacing: 0.08em; color: var(--faint); }
  .pb-cpu { flex: 0 0 auto; font: 400 8px var(--f-px); letter-spacing: 0.08em; color: var(--faint); cursor: help; white-space: nowrap; }
  .pb-cpu[hidden] { display: none; } .pb-cpu.warm { color: #ffc15a; } .pb-cpu.hot { color: #ff8a7a; }
  .pb-lib { flex: 0 0 auto; min-height: 32px; padding: 0 12px; border: 1px solid var(--line2); border-radius: 999px; background: transparent; color: var(--paper); cursor: pointer;
    font: 400 9px var(--f-px); letter-spacing: 0.08em; text-transform: uppercase; }
  .pb-lib:hover:not(:disabled) { border-color: var(--focus); color: var(--focus); }
  .pb-lib:disabled, .pb-add:disabled { opacity: 0.4; cursor: not-allowed; }
  .pb-say { margin: 0; min-height: 18px; display: flex; align-items: center; gap: 10px; color: var(--dim); font-size: 13px; }
  .pb-undo { padding: 2px 10px; border: 1px solid var(--line2); border-radius: 999px; background: transparent; color: var(--focus); cursor: pointer; font: 400 8px var(--f-px); letter-spacing: 0.08em; text-transform: uppercase; }
  .pb-undo[hidden] { display: none; }
  .board { position: relative; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 10px; padding: 14px 12px 12px; border: 1px solid var(--line);
    background: repeating-linear-gradient(0deg, #141117 0 18px, #0e0c10 18px 22px), #141117; box-shadow: inset 0 2px 10px #0008; }
  .board > * { box-sizing: border-box; }
  .pb-drop { position: absolute; z-index: 4; width: 4px; border-radius: 2px; background: var(--focus); box-shadow: 0 0 10px var(--focus); pointer-events: none; transition: left 0.08s, top 0.08s; }
  .pb-drop[hidden] { display: none; }
  .pb-add { flex: 0 0 auto; width: 132px; min-height: 196px; display: grid; place-content: center; justify-items: center; gap: 8px; border: 2px dashed var(--line2); border-radius: 9px;
    background: #ffffff05; color: var(--dim); cursor: pointer; font: 400 8px var(--f-px); letter-spacing: 0.08em; text-transform: uppercase; }
  .pb-add b { font: 400 34px/1 ${FONTS.dirt}; color: var(--faint); }
  .pb-add:hover:not(:disabled) { border-color: var(--focus); color: var(--focus); } .pb-add:hover:not(:disabled) b { color: var(--focus); }

  /* a pedal: the box, its screws, a gloss, the finish over its colour */
  .pd { position: relative; flex: 0 0 auto; width: 132px; min-height: 196px; display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 22px 8px 10px; color: var(--pi); border-radius: 9px; --scr: #0006;
    background: radial-gradient(circle at 8px 8px, var(--scr) 2px, transparent 3px), radial-gradient(circle at calc(100% - 8px) 8px, var(--scr) 2px, transparent 3px),
      radial-gradient(circle at 8px calc(100% - 8px), var(--scr) 2px, transparent 3px), radial-gradient(circle at calc(100% - 8px) calc(100% - 8px), var(--scr) 2px, transparent 3px),
      linear-gradient(160deg, #ffffff2a, transparent 40%, #0000002a), var(--fin, linear-gradient(transparent, transparent)), var(--pc);
    box-shadow: inset 0 1px 0 #fff5, inset 0 -3px 0 #0004, 0 4px 0 #0008, 0 8px 14px #0006; }
  .fin-sparkle { --fin: radial-gradient(circle at 30% 40%, #ffffffb0 0 0.6px, transparent 1.2px) 0 0 / 7px 9px, radial-gradient(circle at 70% 20%, #ffffff80 0 0.5px, transparent 1px) 0 0 / 11px 7px, radial-gradient(circle at 50% 80%, #0000004a 0 0.7px, transparent 1.3px) 0 0 / 5px 6px; }
  .fin-brushed { --fin: repeating-linear-gradient(90deg, #ffffff12 0 1px, transparent 1px 2px, #0000000f 2px 3px, transparent 3px 5px); }
  .fin-hammer { --fin: radial-gradient(circle at 30% 35%, #ffffff26, transparent 45%) 0 0 / 17px 15px, radial-gradient(circle at 70% 70%, #00000026, transparent 45%) 0 0 / 15px 19px; }
  .fin-stripe { --fin: linear-gradient(90deg, transparent 0 35%, color-mix(in srgb, var(--pi) 32%, transparent) 35% 44%, transparent 44% 56%, color-mix(in srgb, var(--pi) 32%, transparent) 56% 65%, transparent 65%); }
  .fin-check { --fin: conic-gradient(#0000002a 25%, transparent 0 50%, #0000002a 0 75%, transparent 0) 0 0 / 14px 14px; }
  .pd-led { position: absolute; top: 9px; left: 50%; width: 9px; height: 9px; margin-left: -4px; border-radius: 50%; background: color-mix(in srgb, var(--led) 25%, #111); box-shadow: inset 0 1px 1px #0008; }
  .pd.on .pd-led { background: var(--led); box-shadow: 0 0 6px 2px color-mix(in srgb, var(--led) 65%, transparent), 0 0 1px #fff inset; }
  .pd-knobs { display: grid; grid-template-columns: repeat(var(--kc, 3), auto); justify-content: center; gap: 4px 6px; --ks: calc(var(--kb, 32px) * var(--kz, 1)); }
  .pd-knobs[data-n="0"] { display: none; }
  .pd-knobs[data-n="1"] { --kc: 1; --kb: 42px; } .pd-knobs[data-n="2"] { --kc: 2; --kb: 36px; } .pd-knobs[data-n="4"] { --kc: 2; }
  .pd-knobs[data-n="5"], .pd-knobs[data-n="6"] { --kc: 3; --kb: 28px; }
  .pd-name { text-align: center; margin-top: auto; line-height: 1; max-width: 100%; }
  .pd-name b { display: block; font: 400 17px/1 ${FONTS.dirt}; letter-spacing: 0.01em; overflow-wrap: anywhere; }
  .pd-name small { font: 400 7px var(--f-px); letter-spacing: 0.1em; opacity: 0.75; }
  .lb-block .pd-name b { font: 700 12px/1.1 var(--f-px); text-transform: uppercase; letter-spacing: 0.04em; }
  .lb-plate .pd-name b { font-size: 15px; padding: 3px 7px 2px; margin-bottom: 3px; border-radius: 2px; color: #16151a; background: linear-gradient(#f1f1f4, #a9a9b2); box-shadow: 0 1px 0 #0008, inset 0 1px 0 #fff; }
  .lb-stencil .pd-name b { font-size: 19px; color: transparent; -webkit-text-stroke: 1px var(--pi); }
  .pd-feet { display: flex; gap: 12px; align-items: center; }
  .pd-sw { width: 34px; height: 34px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
    background: radial-gradient(circle at 40% 35%, #f4f4f4, #9a9aa2 45%, #55555d 70%, #2a2a30); box-shadow: 0 0 0 4px #0003, 0 3px 0 #0008; }
  .pd-sw:active { transform: translateY(2px); box-shadow: 0 0 0 4px #0003, 0 1px 0 #0008; }
  .pd-sw:focus-visible, .pd-grip:focus-visible, .ms-b:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
  .pd-sw2 { position: relative; width: 28px; height: 28px; }
  .pd-sw2 small { position: absolute; top: calc(100% + 3px); left: 50%; transform: translateX(-50%); font: 400 5px var(--f-px); letter-spacing: 0.06em; color: var(--pi); white-space: nowrap; }
  /* the grip (top left: drag it, arrows move it, click for the menu) and the × (top right) */
  .pd-grip, .pd-x { position: absolute; top: 3px; z-index: 2; width: 22px; height: 20px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--pi); cursor: grab; opacity: 0.55; }
  .pd-grip { left: 15px; touch-action: none; }
  .pd-grip i { display: block; width: 10px; height: 10px; margin: auto; background: radial-gradient(circle, currentColor 1.1px, transparent 1.6px) 0 0 / 5px 5px; }
  .pd-x { right: 15px; cursor: pointer; font: 700 15px/20px var(--f-mono); opacity: 0; }
  .pd:hover .pd-grip, .pd-grip:focus-visible, .pd-grip[aria-expanded="true"] { opacity: 1; background: #0002; }
  .pd:hover .pd-x { opacity: 0.8; } .pd-x:hover { opacity: 1; background: #0003; }
  @media (hover: none) { .pd-x { opacity: 0.6; } .pd-grip { opacity: 0.8; } }
  .pd-menu { position: absolute; top: 26px; left: 8px; z-index: 6; display: grid; min-width: 150px; padding: 4px; border: 1px solid var(--line2); border-radius: 6px; background: var(--panel2); box-shadow: 0 8px 24px #000a; }
  .pd-menu button { min-height: 32px; padding: 0 10px; text-align: left; border: 0; border-radius: 4px; background: transparent; color: var(--paper); cursor: pointer; font: 400 13px var(--f-ui, inherit); white-space: nowrap; }
  .pd-menu button:hover:not(:disabled), .pd-menu button:focus-visible { background: var(--line); outline: none; color: var(--focus); }
  .pd-menu button:disabled { opacity: 0.35; cursor: default; }
  .pd-menu [data-a="del"] { color: #ff8a7a; }
  .pd-lift { opacity: 0.25; filter: grayscale(0.6); }
  .pd-ghost { position: fixed; z-index: 1000; margin: 0; pointer-events: none; transform: rotate(-3deg) scale(1.04); box-shadow: 0 18px 40px #000c, inset 0 1px 0 #fff5; opacity: 0.95; }
  .pb.dragging, .pb.dragging * { cursor: grabbing !important; }
  @media (prefers-reduced-motion: no-preference) {
    .pd-new { animation: pd-in 0.32s cubic-bezier(0.2, 1.4, 0.4, 1); }
    .pd-flash { animation: pd-fl 0.7s; }
  }
  @keyframes pd-in { from { transform: translateY(-26px) scale(0.9); opacity: 0; } }
  @keyframes pd-fl { 30% { box-shadow: 0 0 0 3px var(--focus), 0 0 24px var(--focus); } }

  /* shapes */
  .pd-wide { width: 196px; }
  .pd-wide .pd-knobs { --kb: 34px; } .pd-wide .pd-knobs[data-n="3"], .pd-wide .pd-knobs[data-n="4"] { --kc: 4; --kb: 34px; }
  .pd-wide .pd-knobs[data-n="5"], .pd-wide .pd-knobs[data-n="6"] { --kc: 3; --kb: 32px; }
  .pd-mini { width: 100px; min-height: 176px; padding-left: 6px; padding-right: 6px; }
  .pd-mini .pd-knobs { --kz: 0.82; } .pd-mini .pd-name b { font-size: 14px; } .pd-mini .pd-grip { left: 11px; } .pd-mini .pd-x { right: 11px; }
  .pd-round { width: 184px; min-height: 0; height: 184px; border-radius: 50%; padding: 30px 26px 16px; gap: 5px; --scr: transparent; }
  .pd-round .pd-grip { left: 42px; top: 20px; } .pd-round .pd-x { right: 42px; top: 20px; } .pd-round .pd-led { top: 16px; }
  .pd-round .pd-knobs { --kz: 0.9; } .pd-round .pd-name { margin-top: 0; }
  .pd-wah { width: 138px; min-height: 250px; border-radius: 12px 12px 9px 9px; }
  .pd-tread { width: 100%; }
  .kn-tread { width: 100%; } .kn-tread .kn-dial { width: 100%; height: 96px; border-radius: 7px; cursor: ns-resize;
    background: repeating-linear-gradient(0deg, #2a262e 0 5px, #151218 5px 8px); box-shadow: 0 3px 0 #0009, inset 0 0 0 2px #0006;
    transform: perspective(160px) rotateX(calc((0.5 - var(--kv, 0.5)) * 26deg)); transform-origin: 50% 100%; transition: transform 0.05s; }
  .kn-tread .kn-cap { display: none; }
  .pd-rack { width: 300px; min-height: 128px; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto 1fr; align-items: center; column-gap: 12px;
    padding: 24px 32px 12px; border-radius: 3px; --scr: transparent;
    background: radial-gradient(circle at 10px 20px, #09080a 0 2.5px, #6a6470 3px, transparent 4px), radial-gradient(circle at 10px calc(100% - 20px), #09080a 0 2.5px, #6a6470 3px, transparent 4px),
      radial-gradient(circle at calc(100% - 10px) 20px, #09080a 0 2.5px, #6a6470 3px, transparent 4px), radial-gradient(circle at calc(100% - 10px) calc(100% - 20px), #09080a 0 2.5px, #6a6470 3px, transparent 4px),
      linear-gradient(90deg, #0000 0 20px, #0007 20px 22px, #0000 22px calc(100% - 22px), #0007 calc(100% - 22px) calc(100% - 20px), #0000 0),
      linear-gradient(#ffffff22, transparent 30%, #00000030), var(--fin, linear-gradient(transparent, transparent)), var(--pc); }
  .pd-rack .pd-knobs { grid-column: 2; grid-row: 1 / 3; --kc: 3; --kb: 30px; justify-content: end; }
  .pd-rack .pd-knobs[data-n="4"] { --kc: 4; } .pd-rack .pd-knobs[data-n="5"], .pd-rack .pd-knobs[data-n="6"] { --kc: 3; --kb: 26px; }
  .pd-rack .pd-knobs[data-n="1"], .pd-rack .pd-knobs[data-n="2"] { --kc: 2; }
  .pd-rack .pd-name { grid-column: 1; grid-row: 1; margin: 0; text-align: left; } .pd-rack .pd-feet { grid-column: 1; grid-row: 2; }
  .pd-rack .pd-grip { left: 26px; } .pd-rack .pd-x { right: 26px; } .pd-rack .pd-led { left: auto; right: 54px; top: 8px; }

  /* the knob, and its styles */
  .kn { position: relative; display: grid; justify-items: center; gap: 2px; width: calc(var(--ks, 32px) + 4px); }
  .kn-dial { width: var(--ks, 32px); height: var(--ks, 32px); border-radius: 50%; cursor: ns-resize; touch-action: none;
    background: radial-gradient(circle at 45% 35%, #4a4550, #151218 70%); box-shadow: 0 2px 0 #0009, 0 0 0 2px #0004; }
  .kn-dial:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .kn-cap { position: relative; width: 100%; height: 100%; }
  .kn-cap i { position: absolute; left: 50%; top: 9%; width: 3px; height: 31%; margin-left: -1.5px; border-radius: 2px; background: #f4f0e6; }
  .ks-cream .kn-dial { background: radial-gradient(circle at 42% 32%, #fffaf0, #e2d7bd 55%, #a69a80); box-shadow: 0 2px 0 #0009, 0 0 0 2px #0003; }
  .ks-cream .kn-cap i { background: #2a2226; }
  .ks-chrome .kn-dial { background: radial-gradient(circle at 38% 30%, #ffffff, #cfd2d8 30%, #7c8088 62%, #3a3c42); box-shadow: 0 2px 0 #0009, 0 0 0 2px #0005; }
  .ks-chrome .kn-cap i { background: #16151a; width: 2px; margin-left: -1px; }
  .ks-chicken .kn-dial { background: radial-gradient(circle at 45% 35%, #3a3540, #0d0b0f 72%); }
  .ks-chicken .kn-cap i { top: -6%; width: 34%; height: 62%; margin-left: -17%; border-radius: 50% 50% 22% 22% / 64% 64% 36% 36%; background: linear-gradient(#f6eedc, #c9bd9d); box-shadow: 0 1px 2px #000a; }
  .ks-small .pd-knobs { --kz: 0.78; }
  .kn-tip { position: absolute; left: 50%; bottom: calc(100% + 4px); z-index: 3; transform: translate(-50%, 4px); padding: 3px 6px; border-radius: 3px; pointer-events: none;
    font: 700 11px/1 var(--f-mono); color: var(--ink); background: var(--focus); box-shadow: 0 2px 0 #0008; white-space: nowrap; opacity: 0; transition: opacity 0.1s, transform 0.1s; }
  .kn-tip::after { content: ''; position: absolute; left: 50%; top: 100%; margin-left: -4px; border: 4px solid transparent; border-top-color: var(--focus); }
  .kn.drag .kn-tip, .kn:has(.kn-dial:focus-visible) .kn-tip { opacity: 1; transform: translate(-50%, 0); }
  .kn-l { font: 400 6px/1.2 var(--f-px); letter-spacing: 0.06em; white-space: nowrap; }
  .kn-v { font: 700 9px/1 var(--f-mono); opacity: 0.8; white-space: nowrap; }
  /* the mini switch: a bat lever on a nut, its setting under it */
  .ms { display: grid; justify-items: center; gap: 2px; width: calc(var(--ks, 32px) + 4px); }
  .ms-l { font: 400 6px/1.2 var(--f-px); letter-spacing: 0.06em; white-space: nowrap; }
  .tp { display: grid; justify-items: center; gap: 3px; min-width: 40px; }
  .tp-b { min-width: 38px; height: 22px; margin-top: calc((var(--ks, 32px) - 22px) / 2); padding: 0 6px; border: 0; border-radius: 4px; cursor: pointer;
    font: 400 7px var(--f-px); letter-spacing: 0.08em; color: #f4f0e6; background: linear-gradient(#3a3540, #1a171d); box-shadow: 0 2px 0 #0009, inset 0 1px 0 #ffffff22; }
  .tp-b:active, .tp.hit .tp-b { transform: translateY(1px); background: linear-gradient(#ff5a3c, #b0301c); }
  .tp-b:focus-visible, .tp-r:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .tp-r { padding: 0 3px; border: 0; background: none; color: inherit; font: 700 9px/1 var(--f-mono); opacity: 0.75; white-space: nowrap; cursor: pointer; }
  .tp-r:disabled { cursor: default; }
  .tp.on .tp-r { opacity: 1; text-decoration: underline dotted; }
  .ms-b { position: relative; width: 22px; height: 22px; margin: calc((var(--ks, 32px) - 22px) / 2) 0; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
    background: radial-gradient(circle, #d8d8de 0 4px, #6d6d75 4.5px 6px, #2a2a30 6.5px); box-shadow: 0 2px 0 #0008; }
  .ms-b i { position: absolute; left: 50%; bottom: 50%; width: 5px; height: 15px; margin-left: -2.5px; border-radius: 3px 3px 2px 2px; background: linear-gradient(90deg, #8a8a92, #f4f4f6 45%, #9a9aa2);
    transform: rotate(var(--ma, 0deg)); transform-origin: 50% 100%; transition: transform 0.08s; box-shadow: 0 1px 1px #0008; }
  .ms-o { font: 700 8px/1 var(--f-mono); opacity: 0.85; white-space: nowrap; }

  /* the library */
  .lib { width: min(1060px, calc(100vw - 32px)); max-width: none; max-height: min(88vh, 940px); padding: 0; border: 1px solid var(--line2); border-radius: 10px; color: var(--paper);
    background: linear-gradient(#221e27, #19161d); box-shadow: 0 30px 80px #000c; overflow: hidden; }
  .lib::backdrop { background: #07060acc; }
  .lib[open] { display: flex; }
  @media (prefers-reduced-motion: no-preference) { .lib[open] { animation: lib-in 0.18s ease-out; } }
  @keyframes lib-in { from { transform: translateY(14px); opacity: 0; } }
  .lib-in { flex: 1 1 auto; display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; gap: 10px; min-width: 0; min-height: 0; max-height: inherit; padding: 16px 18px 0; box-sizing: border-box; }
  .lib-head { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .lib-head h3 { margin: 0; font: 400 26px/1 ${FONTS.dirt}; }
  .lib-n { flex: 1 1 auto; color: var(--faint); font-size: 13px; }
  .lib-x { flex: 0 0 auto; align-self: center; width: 36px; height: 36px; border: 1px solid var(--line2); border-radius: 50%; background: transparent; color: var(--paper); cursor: pointer; font: 400 20px/1 var(--f-mono); }
  .lib-x:hover { border-color: var(--focus); color: var(--focus); }
  .lib-q { min-height: 40px; padding: 0 12px; border: 1px solid var(--line2); border-radius: 6px; background: #0e0c10; color: var(--paper); font: 400 16px var(--f-ui, inherit); }
  .lib-q:focus { outline: 2px solid var(--focus); outline-offset: 1px; }
  .lib-cats { display: flex; flex-wrap: wrap; gap: 6px; }
  .lib-cat { min-height: 30px; padding: 0 11px; border: 1px solid var(--line2); border-radius: 999px; background: transparent; color: var(--dim); cursor: pointer;
    font: 400 9px var(--f-px); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
  .lib-cat i { font-style: normal; opacity: 0.6; }
  .lib-cat[data-empty] { opacity: 0.4; }
  .lib-cat:hover { color: var(--paper); border-color: var(--faint); }
  .lib-cat[aria-pressed="true"] { background: var(--focus); border-color: var(--focus); color: var(--ink); opacity: 1; }
  .lib-x:focus-visible, .lib-cat:focus-visible, .lc-add:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); align-content: start; gap: 10px; min-height: 0; overflow-y: auto; padding: 2px 2px 18px; margin: 0 -2px; overscroll-behavior: contain; }
  .lc { position: relative; display: grid; grid-template-columns: 78px minmax(0, 1fr); align-items: center; gap: 12px; min-height: 118px; padding: 12px 12px 12px 10px; border: 1px solid var(--line); border-radius: 8px;
    background: radial-gradient(ellipse at 0 50%, color-mix(in srgb, var(--pc) 16%, transparent), transparent 60%), #1c1920; transition: border-color 0.1s, transform 0.1s; }
  .lc[hidden] { display: none; }
  .lc:hover { border-color: var(--pc); transform: translateY(-1px); }
  .lc-face { display: grid; place-items: center; height: 112px; overflow: hidden; pointer-events: none; }
  .lc-face .pd { zoom: 0.46; flex: none; box-shadow: 0 4px 0 #0008; }
  .lc-face .pd-wide, .lc-face .pd-round { zoom: 0.38; } .lc-face .pd-rack { zoom: 0.25; } .lc-face .pd-wah { zoom: 0.4; }
  .lc-t { display: grid; gap: 3px; min-width: 0; }
  .lc-t b { font: 400 18px/1.05 ${FONTS.dirt}; }
  .lc-t small { font: 400 7px var(--f-px); letter-spacing: 0.1em; color: var(--dim); }
  .lc-b { font-size: 13px; line-height: 1.3; color: var(--paper); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
  /* (clamped so a long nod can't run out of the card; the whole of it is the card's title) */
  .lc-nod { font-size: 11.5px; line-height: 1.3; color: var(--faint); font-style: italic; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .lc-on { position: absolute; top: 6px; left: 6px; z-index: 1; padding: 2px 5px; border-radius: 3px; font: 400 6px var(--f-px); letter-spacing: 0.08em; color: var(--ink); background: var(--s); }
  .lc-on[hidden] { display: none; }
  .lc-add { position: absolute; inset: 0; width: 100%; border: 0; border-radius: 8px; background: transparent; cursor: copy; }
  .lc-add:disabled { cursor: not-allowed; }
  .lc:has(.lc-add:disabled) { opacity: 0.55; }
  .lib-none { margin: 0; color: var(--dim); }
  .lib-none[hidden] { display: none; }

  @media (max-width: 480px) {
    .board { gap: 12px 8px; padding: 10px 8px; justify-content: center; }
    .pd, .pb-add, .bd-amp { width: calc(50% - 4px); }
    .bd-amp { min-height: 0; }
    .pd-wide, .pd-rack { width: 100%; }
    .pd-round { width: calc(50% - 4px); height: auto; min-height: 0; aspect-ratio: 1; padding: 22px 12px 10px; gap: 2px; }
    .pd-round .pd-knobs { --kz: 0.78; } .pd-round .pd-name b { font-size: 15px; } .pd-round .pd-sw { width: 30px; height: 30px; }
    .pd-round .pd-grip { left: 22%; } .pd-round .pd-x { right: 22%; }
    /* (a disc half a phone wide: the values and the kind line would sit on the name and the switch; a knob's value
       still pops up while it's turned) */
    .pd-round { padding-top: 26px; align-self: center; } .pd-round .kn-v, .pd-round .pd-name small { display: none; } .pd-round .pd-led { top: 12px; }
    /* rows as even as the faces allow: a row's pedals share its height, and the wah's treadle is shorter */
    .board { align-items: stretch; }
    .pd-wah { min-height: 196px; } .kn-tread .kn-dial { height: 64px; }
    /* (the library's little faces keep their desktop widths: they're zoomed, not laid out in the board's two columns) */
    .lc-face .pd { width: 132px; } .lc-face .pd-wide { width: 196px; } .lc-face .pd-mini { width: 100px; } .lc-face .pd-rack { width: 300px; } .lc-face .pd-wah { width: 138px; }
    .lc-face .pd-round { width: 184px; height: 184px; aspect-ratio: auto; }
    .pd-mini { width: calc(50% - 4px); }
    .pb-add { min-height: 120px; }
    .pb-n { display: none; } .pb-cpu:not(.warm):not(.hot) { display: none; }
  }
  @media (max-width: 560px) {
    .lib { width: 100vw; max-width: 100vw; margin: auto 0 0; max-height: 90vh; border-radius: 14px 14px 0 0; border-bottom: 0; }
    @media (prefers-reduced-motion: no-preference) { .lib[open] { animation: lib-up 0.22s ease-out; } }
    .lib-in { padding: 12px 12px 0; }
    .lib-head h3 { font-size: 22px; }
    .lib-n { font-size: 11px; }
    .lib-cats { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 -12px; padding: 0 12px; }
    .lib-cat { flex: 0 0 auto; }
    .lib-grid { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .lc { min-height: 104px; grid-template-columns: 64px minmax(0, 1fr); }
    .lc-face { height: 96px; } .lc-face .pd { zoom: 0.4; } .lc-face .pd-wide, .lc-face .pd-round, .lc-face .pd-wah { zoom: 0.33; } .lc-face .pd-rack { zoom: 0.2; }
  }
  @keyframes lib-up { from { transform: translateY(40%); } }`;
