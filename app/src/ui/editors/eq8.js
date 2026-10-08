// Slide Rule's window (core.eq8, devices/builtin/eq8.js): an EQ you shape by dragging its bands over the live
// spectrum. Built only from the window's ctx (ui/plugin.js), like every editor.
//
//   The plot   frequency (20 Hz to 20 kHz, log) across, gain down, on a hairline grid. Behind: the spectrum of what
//              comes in (filled) and what goes out (a line), from the window's taps on the device (ctx.meter.tap).
//              On it: each band's own curve, faint, and the whole EQ's in the device's colour, worked out by the same
//              functions the kernel filters with (devices/builtin/eq8-curve.js), so the line is the sound.
//   Nodes      one square per band in use, numbered. Drag: frequency and gain (on a cut: its corner's bump; Shift:
//              fine). Alt-drag, the wheel or two fingers: Q. Double-click a node: back to 0 dB and Q 1. Double-click
//              the plot: a band there (the free one parked nearest). Right-click, a long press or the menu key: the
//              band's menu (shape, on, solo, reset, remove, automate). A drag is one undo step, signed you.
//              From the keyboard: Tab between bands, arrows move (left and right: frequency; up and down: gain, or
//              the bump on a cut; Alt or Page Up and Down: Q; Shift: fine), Enter turns it on or off, Delete
//              removes it. A node's outline is in the ink of whoever set it last (warm a person, cool an agent),
//              and it flashes cool when an agent moves it.
//   The row    the eight bands as a ledger (pick one), then the picked band's controls (bound: ctx.control, so its
//              lane, its menu and an agent's flash work as everywhere), its solo, and the output.
//   Solo       plays only the band's region of the input, on the live device only (never in the song): the window
//              holds the kernel's `solo` param with an automation segment (inst.auto), and lets go of it on close.
//
// Under 900 px the plot takes the width and the picked band's controls sit under it, 44 px to a target.

import { h, css, clamp } from '../dom.js';
import { automate, backToLane } from '../rack.js';
import { popover, closePopover, menuKeys } from '../arrange-kit.js';
import {
  EQ_BANDS,
  EQ_PARK,
  EQ_SHAPES,
  EQ_SLOPES,
  EQ_STRIDE,
  shapeOf,
  slopeOf,
  usesGain,
  isCorner,
  eqSections,
  eqSoloSections,
  eqBandPow,
  bandOf,
  autoGainFor,
} from '../../devices/builtin/eq8-curve.js';

const F_LO = 20,
  F_HI = 20000,
  LN_LO = Math.log(F_LO),
  LN_HI = Math.log(F_HI);
const RANGES = [12, 24];
const FFT = 8192;
const GLYPH = {
  bell: 'M2 13C8 13 9.5 3 14 3S20 13 26 13',
  lowshelf: 'M2 4H8C12 4 14 13 18 13H26',
  highshelf: 'M2 13H10C14 13 16 4 20 4H26',
  lowcut: 'M3 15C6 7 9 4 13 4H26',
  highcut: 'M2 4H15C19 4 22 7 25 15',
  notch: 'M2 4H11C12.5 4 13.2 15 14 15S15.5 4 17 4H26',
  bandpass: 'M3 15C8 15 10.5 3.5 14 3.5S20 15 25 15',
};
const glyph = (id, size = 28) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 28 17');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(Math.round((size * 17) / 28)));
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('eq8-gl');
  s.innerHTML = `<path d="${GLYPH[id] || GLYPH.bell}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
};
// words: a type for people ("low cut, 24 dB per octave"), a number for speech ("plus 3 dB", "2.4 kHz")
const typeWords = (t) => {
  const sh = shapeOf(t),
    sl = slopeOf(t);
  return sh.label.toLowerCase() + (sl ? `, ${sl} dB per octave` : '');
};
const typeShort = (t) => {
  const sh = shapeOf(t),
    sl = slopeOf(t);
  return sh.label + (sl ? ` ${sl}` : '');
};
const trim = (s) => s.replace(/(\.\d*?)0+(?=\D|$)/, '$1').replace(/\.(?=\D|$)/, '');
const hzWords = (f) => (f >= 1000 ? trim((f / 1000).toFixed(f >= 10000 ? 1 : 2)) + ' kHz' : Math.round(f) + ' Hz');
const dbWords = (g) => {
  const a = trim(Math.abs(g).toFixed(1));
  return Math.abs(g) < 0.05 ? '0 dB' : `${g > 0 ? 'plus' : 'minus'} ${a} dB`;
};
const qText = (q) => (q < 10 ? q.toFixed(2) : q.toFixed(1));
const hzText = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : Math.round(f) + ' Hz');
const dbText = (g) => (Math.abs(g) < 0.05 ? '0.0 dB' : `${g > 0 ? '+' : '−'}${Math.abs(g).toFixed(1)} dB`);

export function mount(el, ctx) {
  css('plugin-eq8', CSS);
  const { app, def } = ctx;
  const ui = app.ui;
  const NB = EQ_BANDS;
  const K = (n, k) => `b${n}_${k}`;
  const parked = (n) => ({
    [K(n, 'on')]: 0,
    [K(n, 'type')]: 0,
    [K(n, 'freq')]: EQ_PARK[n - 1],
    [K(n, 'gain')]: 0,
    [K(n, 'q')]: 1,
  });
  const color = def.look?.color || '#d4b16a';
  const sr = () => ctx.meter.sampleRate || 48000;
  const phone = () => !!el.closest('.pw-phone');
  // session state: the band picked and the scale, per device on its slot
  const memo = ((ui.state.eq8 ||= {})[`${ctx.addr.track}:${ctx.addr.slot}`] ||= { sel: 0, range: 12 });
  let solo = 0,
    soloInst = null; // the band soloed on the live device (0: none), and the instance holding it

  /* ---------------------------------------------------------------- what it plays */
  let vals = ctx.params();
  const band = (n) => bandOf(vals, n);
  const isFree = (n) => {
    const b = band(n);
    return (
      !b.on &&
      b.type === 0 &&
      Math.abs(b.freq - EQ_PARK[n - 1]) < 0.5 &&
      Math.abs(b.gain) < 1e-9 &&
      Math.abs(b.q - 1) < 1e-9
    );
  };
  const placed = (n) => !isFree(n);
  // the coefficients, worked out as the kernel works them (one band per EQ_STRIDE)
  let coef = new Float64Array(NB * EQ_STRIDE),
    nsec = new Int32Array(NB),
    curvesDirty = true;
  function computeCoefs() {
    for (let n = 1; n <= NB; n++) {
      const b = band(n);
      nsec[n - 1] = eqSections(b.type, b.freq, b.gain, b.q, sr(), coef, (n - 1) * EQ_STRIDE);
    }
  }
  computeCoefs();
  const bandDbAt = (n, f) => {
    const w = (2 * Math.PI * f) / sr();
    return (
      10 *
      Math.log10(
        Math.max(
          1e-30,
          eqBandPow(coef, (n - 1) * EQ_STRIDE, nsec[n - 1], Math.cos(w), Math.cos(2 * w), Math.sin(w), Math.sin(2 * w)),
        ),
      )
    );
  };

  // who set each band last: from the history at first, then from each change as it comes (warm a person, cool an agent)
  const authors = new Array(NB + 1).fill(null);
  function authorsFromHistory() {
    authors.fill(null);
    const t = app.store.get().tracks.find((x) => x.id === ctx.addr.track);
    const names = new Set([ctx.addr.track, t?.name].filter(Boolean));
    const hist = app.store.history || [];
    let left = NB;
    for (let i = hist.length - 1; i >= 0 && left > 0; i--) {
      const tx = hist[i];
      for (const op of tx.ops || []) {
        if (op.type !== 'insert.set' || !names.has(op.track) || op.insert !== ctx.addr.slot || !op.patch?.params)
          continue;
        for (const k of Object.keys(op.patch.params)) {
          const m = /^b(\d+)_/.exec(k);
          if (m && authors[+m[1]] === null) {
            authors[+m[1]] = tx.by || null;
            left--;
          }
        }
      }
    }
    // (a band set when the insert was added, a preset picked with it, is the insert's author's)
    const ins = app.store.insert?.(ctx.addr.track, ctx.addr.slot);
    for (let n = 1; n <= NB; n++) if (authors[n] === null && ins?.by && placed(n)) authors[n] = ins.by;
  }
  authorsFromHistory();
  const inkOf = (by) => (!by || by === 'overdub' ? null : ctx.isAgent(by) ? 'agent' : 'human');

  /* ---------------------------------------------------------------- the frame of it */
  const root = h('div.eq8');
  root.style.setProperty('--eq-c', color);
  const strut = h('div.eq8-strut', { 'aria-hidden': 'true' });
  const hint = h('p.eq8-hint', { 'aria-hidden': 'true' });
  const read = h('div.eq8-read', { 'aria-hidden': 'true' });
  read.hidden = true;
  const plot = h('div.eq8-plot', {
    role: 'group',
    'aria-label': `${def.name}: the bands on a frequency plot. Tab to a band; arrows move it; Enter turns it on or off`,
  });
  const cv = ctx.kit.canvas({
    label: `${def.name}: the EQ curve over the spectrum of what comes in and goes out`,
    className: 'eq8-cv',
  });
  plot.append(cv.el, hint, read);
  const nodes = [];
  for (let n = 1; n <= NB; n++) {
    const nd = h(
      'div.eq8-node',
      {
        role: 'slider',
        tabindex: 0,
        dataset: { band: String(n) },
        'aria-roledescription': 'EQ band',
        'aria-valuemin': F_LO,
        'aria-valuemax': F_HI,
      },
      h('span', String(n)),
    );
    nodes[n] = nd;
    plot.append(nd);
  }

  /* ---- the ledger: the eight bands, one to pick */
  const ledger = h('div.eq8-ledger', { role: 'radiogroup', 'aria-label': 'Bands' });
  const cells = [];
  for (let n = 1; n <= NB; n++) {
    const c = h('button.eq8-cell', {
      type: 'button',
      role: 'radio',
      'aria-checked': 'false',
      tabindex: -1,
      dataset: { band: String(n) },
      onclick: () => pick(n, { focusCell: false }),
    });
    cells[n] = c;
    ledger.append(c);
  }
  ledger.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d == null) return;
    e.preventDefault();
    e.stopPropagation();
    pick(((memo.sel - 1 + d + NB) % NB) + 1, { focusCell: true });
  });

  /* ---- one panel of controls per band (only the picked one shows); all bound, so every param has its control */
  const panels = [];
  const shapePick = [];
  const soloTog = [];
  for (let n = 1; n <= NB; n++) {
    const head = h('div.eq8-ph', h('b.eq8-pn', `Band ${n}`), h('span.eq8-pby'));
    // the shape: seven glyphs; a cut's slope beside it (both are this band's type param)
    const shapeBtns = EQ_SHAPES.map((sh) =>
      h(
        'button.eq8-sh',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          tabindex: -1,
          title: sh.label,
          'aria-label': sh.label,
          dataset: { shape: sh.id },
          onclick: () => setShape(n, sh.id),
        },
        glyph(sh.id),
      ),
    );
    const shapeRow = h('div.eq8-shrow', { role: 'radiogroup', 'aria-label': `Band ${n} shape` }, shapeBtns);
    const slopeBtns = EQ_SLOPES.map((s) =>
      h(
        'button.eq8-sl',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          tabindex: -1,
          'aria-label': `${s} dB per octave`,
          dataset: { slope: String(s) },
          onclick: () => setSlope(n, s),
        },
        String(s),
      ),
    );
    const slopeRow = h(
      'div.eq8-slrow',
      { role: 'radiogroup', 'aria-label': `Band ${n} slope, dB per octave` },
      slopeBtns,
    );
    const shapeCtl = h(
      'div.pk-ctl.eq8-shape',
      { dataset: { key: K(n, 'type') } },
      h('span.pk-l', h('span.pk-l-t', 'Shape')),
      h('div.eq8-shbox', shapeRow, slopeRow),
    );
    for (const row of [shapeRow, slopeRow]) {
      row.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (d == null) return;
        e.preventDefault();
        e.stopPropagation();
        const btns = [...row.querySelectorAll('button')].filter((b) => !b.disabled);
        const i = btns.indexOf(document.activeElement);
        const to = btns[(Math.max(0, i) + d + btns.length) % btns.length];
        to.click();
        to.focus();
      });
    }
    ctx.kit.menuOn(shapeRow, (anchor, e) => ctx.menu(K(n, 'type'), e && e.clientX != null ? e : anchor));
    shapePick[n] = { shapeBtns, slopeBtns, slopeRow, el: shapeCtl };
    const onCtl = ctx.control(K(n, 'on'), { label: 'Band' });
    const fCtl = ctx.control(K(n, 'freq'), { size: 56, label: 'Freq' });
    const gCtl = ctx.control(K(n, 'gain'), { size: 56, label: 'Gain' });
    const qCtl = ctx.control(K(n, 'q'), { size: 56, label: 'Q' });
    gCtl.classList.add('eq8-gain');
    const solo = ctx.kit.toggle({
      label: 'Solo',
      name: `Band ${n}`,
      title: 'Hear only the region this band works on, from what comes in (the song is not changed)',
      onChange: (on) => setSolo(on ? n : 0),
    });
    soloTog[n] = solo;
    const remove = h('button.btn.btn-txt.eq8-rm', { type: 'button', onclick: () => removeBand(n) }, 'Remove band');
    const note = h('p.eq8-pnote');
    const p = h(
      'section.eq8-panel',
      { 'aria-label': `Band ${n}`, hidden: true, dataset: { band: String(n) } },
      head,
      h('div.eq8-pctl', shapeCtl, onCtl, fCtl, gCtl, qCtl, h('div.eq8-pact', solo.el, remove)),
      note,
    );
    panels[n] = p;
  }
  /* ---- the output */
  const outCtl = ctx.control('out_gain', { size: 56, label: 'Output' });
  const autoCtl = ctx.control('out_auto', { label: 'Auto gain' });
  const autoNote = h('p.eq8-auto', { 'aria-live': 'off' });
  const scaleRow = h(
    'div.eq8-scale',
    { role: 'radiogroup', 'aria-label': 'Plot scale' },
    RANGES.map((r) =>
      h(
        'button.eq8-sc',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          dataset: { range: String(r) },
          onclick: () => {
            memo.range = r;
            syncScale();
            layoutNodes();
            cv.dirty();
          },
        },
        `±${r}`,
      ),
    ),
  );
  const outSec = h(
    'section.eq8-out',
    { 'aria-label': 'Output' },
    h('div.eq8-oc', outCtl, h('div.eq8-ac', autoCtl, autoNote)),
    h('div.eq8-sc-w', h('span.pk-l', h('span.pk-l-t', 'Scale')), scaleRow),
  );
  const legend = h(
    'p.eq8-legend',
    { 'aria-hidden': 'true' },
    h('i.eq8-lg-in'),
    'what comes in',
    h('i.eq8-lg-out'),
    'what goes out',
    h('i.eq8-lg-eq'),
    'the EQ',
  );
  const about = h('p.eq8-about', `${def.blurb}. Tips its hat to ${def.nod}.`);
  root.append(
    strut,
    plot,
    h('div.eq8-bar', ledger, legend),
    h('div.eq8-low', h('div.eq8-panels', panels.slice(1)), outSec),
    about,
  );
  el.append(root);

  /* ---------------------------------------------------------------- geometry */
  let W = 0,
    H = 0;
  const geo = () => {
    const ph = phone();
    return { l: ph ? 30 : 40, r: W - (ph ? 8 : 12), t: 16, b: H - (ph ? 24 : 26) };
  };
  const xOf = (f, g = geo()) => g.l + ((Math.log(clamp(f, F_LO, F_HI)) - LN_LO) / (LN_HI - LN_LO)) * (g.r - g.l);
  const fOf = (x, g = geo()) => Math.exp(LN_LO + clamp((x - g.l) / Math.max(1, g.r - g.l), 0, 1) * (LN_HI - LN_LO));
  const yOf = (db, g = geo()) =>
    g.t + ((memo.range - clamp(db, -memo.range, memo.range)) / (2 * memo.range)) * (g.b - g.t);
  // (a curve may run off the plot: it is drawn unclamped, and the plot clips it)
  const yRaw = (db, g) =>
    g.t + ((memo.range - clamp(db, -4 * memo.range, 4 * memo.range)) / (2 * memo.range)) * (g.b - g.t);
  const dbOf = (y, g = geo()) => memo.range - ((y - g.t) / Math.max(1, g.b - g.t)) * 2 * memo.range;
  // where a band's node sits: a bell's and a shelf's gain; a cut on its curve at the corner; a notch and a band pass at 0 dB
  const nodeDb = (n) => {
    const b = band(n);
    return usesGain(b.type) ? b.gain : b.type >= 3 && b.type <= 8 ? bandDbAt(n, b.freq) : 0;
  };

  /* ---------------------------------------------------------------- the nodes, the ledger, the panels: in step */
  function layoutNodes() {
    if (!W || !H) return;
    const g = geo();
    for (let n = 1; n <= NB; n++) {
      const nd = nodes[n],
        b = band(n),
        show = placed(n);
      nd.hidden = !show;
      if (!show) continue;
      const y = yOf(nodeDb(n), g),
        x = xOf(b.freq, g);
      nd.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      nd.dataset.edge = y <= g.t + 1 ? 'top' : y >= g.b - 1 ? 'bottom' : '';
    }
    if (drag) placeRead(drag.n);
  }
  function syncNodes() {
    for (let n = 1; n <= NB; n++) {
      const nd = nodes[n],
        b = band(n);
      const label = `Band ${n}, ${typeWords(b.type)}, ${hzWords(b.freq)}${usesGain(b.type) ? ', ' + dbWords(b.gain) : ''}${b.on ? '' : ', off'}`;
      if (nd.getAttribute('aria-label') !== label) nd.setAttribute('aria-label', label);
      nd.setAttribute('aria-valuenow', String(Math.round(b.freq)));
      nd.setAttribute(
        'aria-valuetext',
        `${hzWords(b.freq)}${usesGain(b.type) ? ', ' + dbWords(b.gain) : ''}, Q ${trim(qText(b.q))}`,
      );
      nd.classList.toggle('sel', memo.sel === n);
      nd.classList.toggle('off', !b.on);
      const ink = inkOf(authors[n]);
      nd.dataset.ink = ink || '';
      nd.title = `Band ${n}: drag to move${isCorner(b.type) && !usesGain(b.type) ? " (up and down: its corner's bump)" : ''}, Alt-drag or scroll for Q, double-click for 0 dB, right-click for more`;
    }
    nodes.forEach((nd, n) => {
      if (nd) nd.tabIndex = placed(n) ? 0 : -1;
    });
  }
  function syncLedger() {
    for (let n = 1; n <= NB; n++) {
      const c = cells[n],
        b = band(n),
        free = isFree(n),
        on = memo.sel === n;
      c.setAttribute('aria-checked', String(on));
      c.tabIndex = on ? 0 : -1;
      c.classList.toggle('sel-print', on);
      c.classList.toggle('free', free);
      c.classList.toggle('off', !free && !b.on);
      const ink = inkOf(authors[n]);
      const sig = JSON.stringify([b, free, ink]);
      if (c.dataset.sig === sig) continue;
      c.dataset.sig = sig;
      const words = free ? h('span.eq8-cw', 'free') : h('span.eq8-cw', typeShort(b.type));
      c.replaceChildren(
        ...[
          h('b.eq8-cn', String(n)),
          free ? null : glyph(shapeOf(b.type).id, 22),
          words,
          free ? null : h('span.eq8-cv', hzText(b.freq)),
          free || !usesGain(b.type) ? null : h('span.eq8-cv', dbText(b.gain)),
        ].filter(Boolean),
      );
      c.setAttribute(
        'aria-label',
        free
          ? `Band ${n}, free`
          : `Band ${n}, ${typeWords(b.type)}, ${hzWords(b.freq)}${usesGain(b.type) ? ', ' + dbWords(b.gain) : ''}${b.on ? '' : ', off'}`,
      );
      c.dataset.ink = ink || '';
    }
  }
  function syncPanel() {
    for (let n = 1; n <= NB; n++) panels[n].hidden = memo.sel !== n;
    const n = memo.sel;
    if (!n) return;
    const b = band(n),
      sh = shapeOf(b.type),
      sl = slopeOf(b.type),
      sp = shapePick[n];
    for (const btn of sp.shapeBtns) {
      const on = btn.dataset.shape === sh.id;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
      btn.classList.toggle('sel-print', on);
    }
    sp.slopeRow.hidden = !sl;
    for (const btn of sp.slopeBtns) {
      const on = +btn.dataset.slope === sl;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
      btn.classList.toggle('sel-print', on);
    }
    const p = panels[n];
    p.querySelector('.eq8-gain')?.classList.toggle('unused', !usesGain(b.type));
    const by = p.querySelector('.eq8-pby');
    const who = authors[n] && authors[n] !== 'overdub' ? ctx.byline(authors[n]) : null;
    by.replaceChildren(...(who ? ['set by ', who] : []));
    p.querySelector('.eq8-pnote').textContent = isFree(n)
      ? `Band ${n} is free: double-click the plot to place a band, or switch it on here (a bell at ${hzText(EQ_PARK[n - 1])}, 0 dB).`
      : !usesGain(b.type)
        ? `A ${sh.label.toLowerCase()} doesn't use gain${isCorner(b.type) ? ': drag its node up for a bump at the corner' : ''}.`
        : '';
    soloTog[n].set(solo === n);
  }
  function syncScale() {
    for (const b of scaleRow.children) {
      const on = +b.dataset.range === memo.range;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('sel-print', on);
      b.tabIndex = on ? 0 : -1;
    }
  }
  function syncAuto() {
    const on = vals.out_auto >= 0.5;
    autoNote.textContent = on
      ? `First guess ${dbText(autoGainFor(vals, sr()))}, then matched to what plays`
      : 'Off: the output gain alone';
  }
  function syncHint() {
    const any = Array.from({ length: NB }, (_, i) => placed(i + 1)).some(Boolean);
    hint.textContent = any
      ? ''
      : `${matchMedia('(pointer: coarse)').matches ? 'Double-tap' : 'Double-click'} the line to place a band`;
    hint.hidden = any;
  }
  function syncAll() {
    syncNodes();
    layoutNodes();
    syncLedger();
    syncPanel();
    syncAuto();
    syncHint();
    cv.dirty();
  }

  /* ---------------------------------------------------------------- picking, and the edits */
  function pick(n, { focusCell = false, focusNode = false } = {}) {
    memo.sel = n;
    syncNodes();
    syncLedger();
    syncPanel();
    cv.dirty();
    if (focusCell) cells[n].focus({ preventScroll: true });
    if (focusNode && placed(n)) nodes[n].focus({ preventScroll: true });
  }
  if (!memo.sel || memo.sel > NB) memo.sel = Array.from({ length: NB }, (_, i) => i + 1).find(placed) || 1;
  const set = (patch, gesture = 'end') => ctx.set(patch, { gesture });
  function setShape(n, id) {
    const sh = EQ_SHAPES.find((s) => s.id === id),
      b = band(n);
    const keep = slopeOf(b.type),
      i = keep ? EQ_SLOPES.indexOf(keep) : 1;
    const type = sh.types.length > 1 ? sh.types[i] : sh.types[0];
    if (type === b.type) return;
    const patch = { [K(n, 'type')]: type };
    if (!b.on && isFree(n)) patch[K(n, 'on')] = 1;
    set(patch);
    ui.announce?.(`Band ${n}: ${typeWords(type)}`);
  }
  function setSlope(n, s) {
    const b = band(n),
      sh = shapeOf(b.type);
    if (sh.types.length < 2) return;
    set({ [K(n, 'type')]: sh.types[EQ_SLOPES.indexOf(s)] });
  }
  // The bar's line about a band (one just placed, or reset) follows the band while it is the line showing: a band
  // placed at 0 dB and dragged to +2.2 dB says +2.2 dB, not what it was when it was placed.
  let bandSaid = null; // { n, text }: the line this editor last wrote about band n
  const bandLine = (n) => {
    const b = band(n),
      sl = slopeOf(b.type);
    return `Band ${n}: a ${shapeOf(b.type).label.toLowerCase()} at ${hzText(b.freq)}${sl ? `, ${sl} dB per octave` : ''}${usesGain(b.type) ? `, ${dbText(b.gain)}` : ''}${b.on ? '' : ', off'}.`;
  };
  function sayBand(n, text = bandLine(n)) {
    ctx.status(text);
    bandSaid = { n, text };
  }
  function resetBand(n) {
    set({ [K(n, 'gain')]: 0, [K(n, 'q')]: 1 });
    sayBand(n, `Band ${n} back to 0 dB and Q 1.`);
  }
  function removeBand(n) {
    if (solo === n) setSolo(0);
    set(parked(n));
    ctx.status(`Band ${n} is free again.`);
    ui.announce?.(`Band ${n} removed`);
    nodes[n].blur();
  }
  function toggleOn(n) {
    const b = band(n);
    set({ [K(n, 'on')]: b.on ? 0 : 1 });
    ui.announce?.(`Band ${n} ${b.on ? 'off' : 'on'}`);
  }
  // a band where the person double-clicked: the free band parked nearest that frequency
  function addAt(f, db) {
    const free = Array.from({ length: NB }, (_, i) => i + 1).filter(isFree);
    if (!free.length) {
      ctx.status(
        `All eight bands are in use: remove one first (${matchMedia('(pointer: coarse)').matches ? 'hold it' : 'right-click it'}, then Remove).`,
      );
      return null;
    }
    const n = free.sort((a, b) => Math.abs(Math.log(EQ_PARK[a - 1] / f)) - Math.abs(Math.log(EQ_PARK[b - 1] / f)))[0];
    const g = Math.abs(db) < 0.5 ? 0 : clamp(Math.round(db * 10) / 10, -24, 24);
    set({ [K(n, 'on')]: 1, [K(n, 'type')]: 0, [K(n, 'freq')]: f, [K(n, 'gain')]: g, [K(n, 'q')]: 1 });
    memo.sel = n;
    vals = ctx.params();
    syncAll();
    nodes[n].focus({ preventScroll: true });
    sayBand(n);
    return n;
  }

  /* ---------------------------------------------------------------- solo: the live device only */
  const liveInst = () => {
    try {
      return app.engine?.instance?.(ctx.addr.track, ctx.addr.slot) || null;
    } catch {
      return null;
    }
  };
  function pushSolo() {
    const inst = liveInst(),
      ac = app.engine?.ctx,
      now = ac ? ac.currentTime : 0;
    if (soloInst && soloInst !== inst) {
      try {
        soloInst.autoClear?.('solo', now, true);
      } catch {
        /* gone */
      }
      soloInst = null;
    }
    if (!inst || typeof inst.auto !== 'function' || !ac) return false;
    if (solo) {
      const pos = solo / NB;
      inst.auto({ key: 'solo', time: now, end: now, a: pos, b: pos, c: 'step' });
      soloInst = inst;
    } else if (soloInst) {
      try {
        soloInst.autoClear('solo', now, true);
      } catch {
        /* gone */
      }
      soloInst = null;
    }
    return true;
  }
  function setSolo(n) {
    solo = n;
    pushSolo();
    for (let i = 1; i <= NB; i++) soloTog[i].set(solo === i);
    plot.classList.toggle('soloing', !!solo);
    if (solo) {
      ctx.status(
        `Solo: band ${solo}'s region of what comes in, ${regionWords(solo)}. The song isn't changed; Solo again to stop.`,
      );
      ui.announce?.(`Soloing band ${solo}`);
    } else ctx.status('');
    cv.dirty();
  }
  const regionWords = (n) => {
    const b = band(n);
    if (b.type === 1 || (b.type >= 3 && b.type <= 5)) return `below ${hzText(b.freq)}`;
    if (b.type === 2 || (b.type >= 6 && b.type <= 8)) return `above ${hzText(b.freq)}`;
    const q = Math.max(0.3, b.q),
      half = Math.asinh(1 / (2 * q)) / Math.log(2); // the band pass's half-power edges
    return `${hzText(b.freq * Math.pow(2, -half))} to ${hzText(b.freq * Math.pow(2, half))}`;
  };
  const offTransport =
    app.engine?.on?.('transport', () => {
      if (solo) setTimeout(pushSolo, 0);
    }) || null;

  /* ---------------------------------------------------------------- the band's menu */
  // its shape (and a cut's slope), on, solo, reset, remove, and its lanes: right-click, a long press or the menu key
  let menuPop = null;
  function bandMenu(n, at) {
    closeMenu();
    const b = band(n);
    const item = (label, run, o = {}) =>
      h(
        'button.ek-item.eq8-mi',
        {
          type: 'button',
          role: o.role || 'menuitem',
          ...(o.checked != null ? { 'aria-checked': String(!!o.checked) } : {}),
          dataset: o.data || {},
          onclick: () => {
            closeMenu();
            run();
          },
        },
        o.glyph ? glyph(o.glyph, 22) : h('span.eq8-mi-g'),
        h('span', label),
        o.sub ? h('span.ek-sub', o.sub) : null,
      );
    const shapes = EQ_SHAPES.map((sh) =>
      item(sh.label, () => setShape(n, sh.id), {
        role: 'menuitemradio',
        checked: shapeOf(b.type).id === sh.id,
        glyph: sh.id,
        data: { shape: sh.id },
      }),
    );
    const slopes = slopeOf(b.type)
      ? EQ_SLOPES.map((s) =>
          item(`${s} dB per octave`, () => setSlope(n, s), {
            role: 'menuitemradio',
            checked: slopeOf(b.type) === s,
            data: { slope: String(s) },
          }),
        )
      : [];
    const lane = (k, word) => {
      const addr = { track: ctx.addr.track, insert: ctx.addr.slot, param: K(n, k) },
        l = ctx.lane(K(n, k));
      if (l?.held)
        return item(`Back to the ${word} lane`, () => backToLane(app, addr, `Band ${n} ${word}`), {
          sub: 'it is held',
        });
      return item(`Automate ${word}`, () => automate(app, addr, `Band ${n} ${word}`), {
        sub: l ? 'show its lane' : 'open a lane for it',
      });
    };
    const rows = [
      h('div.ek-head', { role: 'presentation' }, `Band ${n}`),
      ...shapes,
      ...(slopes.length ? [h('div.ek-sep', { role: 'separator' }), ...slopes] : []),
      h('div.ek-sep', { role: 'separator' }),
      item('On', () => toggleOn(n), { role: 'menuitemcheckbox', checked: b.on, data: { act: 'on' } }),
      item('Solo', () => setSolo(solo === n ? 0 : n), {
        role: 'menuitemcheckbox',
        checked: solo === n,
        sub: 'hear only its region',
        data: { act: 'solo' },
      }),
      item('Reset', () => resetBand(n), { sub: '0 dB, Q 1', data: { act: 'reset' } }),
      item('Remove', () => removeBand(n), { sub: 'free the band', data: { act: 'remove' } }),
      h('div.ek-sep', { role: 'separator' }),
      lane('freq', 'frequency'),
      ...(usesGain(b.type) ? [lane('gain', 'gain')] : []),
      lane('q', 'Q'),
    ];
    const box = h('div.eq8-menu', { role: 'menu', 'aria-label': `Band ${n}` }, rows);
    menuPop = popover(at ? { x: at.clientX, y: at.clientY } : nodes[n], box, {
      label: `Band ${n}`,
      cls: 'eq8-pop',
      onClose: () => {
        menuPop = null;
      },
    });
    menuKeys(box);
    (box.querySelector('.ek-item[aria-checked="true"]') || box.querySelector('.ek-item'))?.focus({
      preventScroll: true,
    });
  }
  const closeMenu = () => {
    if (menuPop) closePopover();
  };

  /* ---------------------------------------------------------------- pointer: nodes and the plot */
  let drag = null,
    pinch = null,
    wheelT = 0,
    tapAt = null;
  const flashes = new Map(); // band -> until
  function placeRead(n) {
    const b = band(n),
      g = geo();
    read.replaceChildren(
      ...[
        h('b', `Band ${n}`),
        h('span', hzText(b.freq)),
        usesGain(b.type) ? h('span', dbText(b.gain)) : null,
        h('span', `Q ${qText(b.q)}`),
      ].filter(Boolean),
    );
    read.hidden = false;
    const x = xOf(b.freq, g),
      y = yOf(nodeDb(n), g),
      rw = read.offsetWidth || 80,
      rh = read.offsetHeight || 60;
    const left = x + 18 + rw > g.r ? x - 18 - rw : x + 18;
    read.style.transform = `translate(${Math.round(clamp(left, 2, W - rw - 2))}px, ${Math.round(clamp(y - rh / 2, 2, H - rh - 2))}px)`;
  }
  const local = (e) => {
    const r = plot.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function dragTo(e) {
    const d = drag,
      b = band(d.n),
      g = geo(),
      p = local(e);
    // Shift: fine, from where it is now (no jump when it goes down mid-drag)
    if (e.shiftKey !== d.fine) {
      d.fine = e.shiftKey;
      d.ax = p.x;
      d.ay = p.y;
      d.f0 = b.freq;
      d.v0 = d.vMode === 'q' ? b.q : nodeDb(d.n);
      d.q0 = b.q;
    }
    const k = d.fine ? 0.2 : 1;
    const mode = e.altKey ? 'q' : d.baseMode;
    if (mode !== d.vMode) {
      d.vMode = mode;
      d.ay = p.y;
      d.v0 = mode === 'q' ? b.q : nodeDb(d.n);
      d.q0 = b.q;
      d.ax = p.x;
      d.f0 = b.freq;
    }
    const dx = (p.x - d.ax) * k,
      dy = (p.y - d.ay) * k;
    const f = clamp(fOf(xOf(d.f0, g) + dx, g), F_LO, F_HI);
    const patch = { [K(d.n, 'freq')]: f, [K(d.n, 'gain')]: b.gain, [K(d.n, 'q')]: b.q };
    if (mode === 'q') patch[K(d.n, 'q')] = clamp(d.q0 * Math.pow(2, -dy / 60), 0.1, 24);
    else if (mode === 'gain') patch[K(d.n, 'gain')] = clamp(dbOf(yOf(d.v0, g) + dy, g), -24, 24);
    else if (mode === 'corner') {
      // a cut's node rides its curve at the corner: up is a bump there (Q is the bump: 1 none, up to 4), down softer
      const lvl = dbOf(yOf(d.v0, g) + dy, g);
      patch[K(d.n, 'q')] = clamp(Math.pow(10, (lvl + 3.0103) / 20), 0.1, 4);
    }
    set(patch, 'move');
  }
  // the drag starts again from here (a pinch let go, a modifier changed)
  function reanchor() {
    if (!drag) return;
    const b = band(drag.n),
      p = drag.lastX != null ? local({ clientX: drag.lastX, clientY: drag.lastY }) : { x: drag.ax, y: drag.ay };
    drag.ax = p.x;
    drag.ay = p.y;
    drag.f0 = b.freq;
    drag.q0 = b.q;
    drag.v0 = drag.vMode === 'q' ? b.q : nodeDb(drag.n);
  }
  function endDrag(commit = true) {
    if (!drag) return;
    const d = drag;
    drag = null;
    pinch = null;
    nodes[d.n].classList.remove('drag');
    read.hidden = true;
    if (commit && d.moved) {
      const b = band(d.n);
      set({ [K(d.n, 'freq')]: b.freq, [K(d.n, 'gain')]: b.gain, [K(d.n, 'q')]: b.q }, 'end');
    }
  }
  for (let n = 1; n <= NB; n++) {
    const nd = nodes[n];
    nd.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // a second finger while one drags: two fingers set Q
      if (drag && e.pointerType === 'touch' && drag.id !== e.pointerId) {
        startPinch(e);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const b = band(n),
        p = local(e);
      try {
        nd.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
      if (memo.sel !== n) pick(n);
      nd.focus({ preventScroll: true });
      const baseMode = usesGain(b.type) ? 'gain' : b.type >= 3 && b.type <= 8 ? 'corner' : 'none';
      drag = {
        n,
        id: e.pointerId,
        ax: p.x,
        ay: p.y,
        f0: b.freq,
        v0: nodeDb(n),
        q0: b.q,
        fine: e.shiftKey,
        baseMode,
        vMode: baseMode,
        moved: false,
        touch: e.pointerType === 'touch',
        sx: e.clientX,
        sy: e.clientY,
      };
      if (e.altKey) {
        drag.vMode = 'q';
        drag.v0 = b.q;
      }
      nd.classList.add('drag');
    });
    nd.addEventListener('pointermove', (e) => {
      if (!drag || drag.n !== n || e.pointerId !== drag.id) return;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (pinch) {
        pinchMove(e);
        return;
      }
      if (!drag.moved) {
        const dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
        if (dist < (drag.touch ? 8 : 2)) return;
        drag.moved = true;
        const p = local(e);
        drag.ax = p.x;
        drag.ay = p.y; // (from here: the jitter before it moved moves nothing)
      }
      dragTo(e);
      placeRead(n);
    });
    const up = (e) => {
      if (drag && drag.n === n && e.pointerId === drag.id) endDrag(true);
    };
    nd.addEventListener('pointerup', up);
    nd.addEventListener('pointercancel', up);
    nd.addEventListener('lostpointercapture', (e) => {
      if (drag && drag.n === n && e.pointerId === drag.id) endDrag(true);
    });
    nd.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetBand(n);
    });
    nd.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const b = band(n),
          d = -(e.deltaY || -e.deltaX);
        const q = clamp(b.q * Math.pow(2, d / (e.shiftKey ? 2400 : 600)), 0.1, 24);
        set({ [K(n, 'q')]: q }, 'move');
        if (memo.sel !== n) pick(n);
        if (!drag) placeRead(n);
        clearTimeout(wheelT);
        wheelT = setTimeout(() => {
          set({ [K(n, 'q')]: band(n).q }, 'end');
          if (!drag) read.hidden = true;
        }, 300);
      },
      { passive: false },
    );
    ctx.kit.menuOn(
      nd,
      (anchor, e) => {
        if (memo.sel !== n) pick(n);
        bandMenu(n, e && e.clientX != null ? e : null);
      },
      () => endDrag(false),
    );
    nd.addEventListener('keydown', (e) => nodeKey(n, e));
    nd.addEventListener('focus', () => {
      if (memo.sel !== n) pick(n);
    });
  }
  // two fingers: the distance between them sets Q (apart: wider, together: narrower)
  function startPinch(e) {
    const a = drag;
    pinch = {
      id: e.pointerId,
      ax: a.lastX ?? a.sx,
      ay: a.lastY ?? a.sy,
      bx: e.clientX,
      by: e.clientY,
      q0: band(a.n).q,
    };
    pinch.d0 = Math.max(12, Math.hypot(pinch.bx - pinch.ax, pinch.by - pinch.ay));
    try {
      plot.setPointerCapture(e.pointerId);
    } catch {
      /* gone */
    }
    drag.moved = true;
  }
  function pinchMove(e) {
    if (!pinch || !drag) return;
    if (e.pointerId === pinch.id) {
      pinch.bx = e.clientX;
      pinch.by = e.clientY;
    } else if (e.pointerId === drag.id) {
      pinch.ax = e.clientX;
      pinch.ay = e.clientY;
    }
    const d = Math.max(12, Math.hypot(pinch.bx - pinch.ax, pinch.by - pinch.ay));
    const n = drag.n,
      b = band(n);
    set(
      { [K(n, 'freq')]: b.freq, [K(n, 'gain')]: b.gain, [K(n, 'q')]: clamp((pinch.q0 * pinch.d0) / d, 0.1, 24) },
      'move',
    );
    placeRead(n);
  }
  plot.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.eq8-node')) return;
    if (drag && e.pointerType === 'touch') {
      startPinch(e);
      e.preventDefault();
      return;
    }
    // a double tap on touch (a double-click is the mouse's)
    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (tapAt && now - tapAt.t < 350 && Math.hypot(e.clientX - tapAt.x, e.clientY - tapAt.y) < 24) {
        tapAt = null;
        const p = local(e);
        addAt(fOf(p.x), dbOf(p.y));
        e.preventDefault();
        return;
      }
      tapAt = { t: now, x: e.clientX, y: e.clientY };
    }
  });
  plot.addEventListener('pointermove', (e) => {
    if (pinch && e.pointerId === pinch.id) pinchMove(e);
  });
  const pinchUp = (e) => {
    if (pinch && e.pointerId === pinch.id) {
      pinch = null;
      reanchor();
    }
  };
  plot.addEventListener('pointerup', pinchUp);
  plot.addEventListener('pointercancel', pinchUp);
  plot.addEventListener('dblclick', (e) => {
    if (e.target.closest('.eq8-node')) return;
    const p = local(e),
      g = geo();
    if (p.x < g.l || p.x > g.r || p.y < g.t - 4 || p.y > g.b + 4) return;
    addAt(fOf(p.x), dbOf(p.y));
  });

  /* ---------------------------------------------------------------- keys on a node */
  function nodeKey(n, e) {
    const b = band(n);
    const fine = e.shiftKey;
    const q = (dir) => set({ [K(n, 'q')]: clamp(b.q * Math.pow(2, dir * (fine ? 1 / 24 : 1 / 6)), 0.1, 24) });
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      if (e.altKey) q(dir);
      else if (usesGain(b.type))
        set({ [K(n, 'gain')]: clamp(Math.round((b.gain + dir * (fine ? 0.1 : 0.5)) * 10) / 10, -24, 24) });
      else if (b.type >= 3 && b.type <= 8)
        set({ [K(n, 'q')]: clamp(b.q * Math.pow(2, dir * (fine ? 1 / 24 : 1 / 6)), 0.35, 4) });
      else q(dir);
      showRead(n);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      set({ [K(n, 'freq')]: clamp(b.freq * Math.pow(2, dir * (fine ? 1 / 48 : 1 / 12)), F_LO, F_HI) });
      showRead(n);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      e.stopPropagation();
      q(e.key === 'PageUp' ? 1 : -1);
      showRead(n);
    } else if (e.key === 'Enter' && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      toggleOn(n);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const next = Array.from({ length: NB }, (_, i) => i + 1).find((m) => m !== n && placed(m));
      removeBand(n);
      if (next) pick(next, { focusNode: true });
      else cells[n].focus({ preventScroll: true });
    }
  }
  let readT = 0;
  function showRead(n) {
    clearTimeout(readT);
    requestPlace(n);
    readT = setTimeout(() => {
      if (!drag) read.hidden = true;
    }, 1400);
  }
  let placeFor = 0;
  const requestPlace = (n) => {
    placeFor = n;
  };

  /* ---------------------------------------------------------------- the drawing */
  // per-pixel-column tables (made when the size changes): each column's frequency and angle
  let cols = null,
    colSig = '',
    bandPow = [],
    sumDb = null,
    spec = { pre: null, post: null, buf: new Float32Array(FFT / 2) };
  function ensureCols(g) {
    const sig = `${W}x${H}:${sr()}:${g.l}:${g.r}`;
    if (sig === colSig && cols) return;
    colSig = sig;
    const n = Math.max(2, Math.ceil((g.r - g.l) / 2) + 1);
    cols = {
      n,
      x: new Float64Array(n),
      f: new Float64Array(n),
      cw: new Float64Array(n),
      c2w: new Float64Array(n),
      sw: new Float64Array(n),
      s2w: new Float64Array(n),
    };
    for (let i = 0; i < n; i++) {
      const x = Math.min(g.r, g.l + i * 2),
        f = fOf(x, g),
        w = (2 * Math.PI * f) / sr();
      cols.x[i] = x;
      cols.f[i] = f;
      cols.cw[i] = Math.cos(w);
      cols.c2w[i] = Math.cos(2 * w);
      cols.sw[i] = Math.sin(w);
      cols.s2w[i] = Math.sin(2 * w);
    }
    bandPow = Array.from({ length: NB }, () => new Float64Array(n));
    sumDb = new Float64Array(n);
    curvesDirty = true;
  }
  function computeCurves() {
    if (!curvesDirty || !cols) return;
    curvesDirty = false;
    sumDb.fill(0);
    for (let b = 0; b < NB; b++) {
      const on = band(b + 1).on,
        P = bandPow[b],
        o = b * EQ_STRIDE,
        ns = nsec[b];
      for (let i = 0; i < cols.n; i++) {
        P[i] =
          10 * Math.log10(Math.max(1e-30, eqBandPow(coef, o, ns, cols.cw[i], cols.c2w[i], cols.sw[i], cols.s2w[i])));
        if (on) sumDb[i] += P[i];
      }
    }
  }
  // the spectrum: an 8192-point FFT per side, drawn per 2 px column (the loudest bin in the column, or between bins
  // where a column is narrower than a bin), tilted 4.5 dB per octave about 1 kHz so a typical mix reads level
  const specY = (v, f, g) => {
    const t = v + 4.5 * Math.log2(f / 1000);
    return g.b - clamp((t + 84) / 72, 0, 1) * (g.b - g.t);
  };
  function specPath(an, g) {
    if (!an) return null;
    if (an.frequencyBinCount !== spec.buf.length) spec.buf = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(spec.buf);
    const B = spec.buf,
      nb = B.length,
      hz = an.context.sampleRate / (2 * nb),
      out = new Float64Array(cols.n);
    for (let i = 0; i < cols.n; i++) {
      const f0 = i ? Math.sqrt(cols.f[i - 1] * cols.f[i]) : cols.f[0],
        f1 = i < cols.n - 1 ? Math.sqrt(cols.f[i] * cols.f[i + 1]) : cols.f[i];
      const k0 = f0 / hz,
        k1 = f1 / hz;
      let v;
      if (k1 - k0 < 1) {
        const k = cols.f[i] / hz,
          j = Math.floor(k),
          t = k - j;
        v = (B[clamp(j, 1, nb - 1)] ?? -140) * (1 - t) + (B[clamp(j + 1, 1, nb - 1)] ?? -140) * t;
      } else {
        v = -200;
        for (let j = Math.max(1, Math.floor(k0)); j <= Math.min(nb - 1, Math.ceil(k1)); j++) if (B[j] > v) v = B[j];
      }
      out[i] = Number.isFinite(v) ? v : -200;
    }
    return out;
  }
  let liveUntil = 0;
  const live = () => !!app.engine?.playing || performance.now() < liveUntil;
  const ink = {};
  function readInks() {
    const s = getComputedStyle(root);
    for (const k of [
      '--text',
      '--text-2',
      '--text-3',
      '--line',
      '--line-2',
      '--bg',
      '--bg-2',
      '--panel',
      '--agent',
      '--human',
      '--accent-2',
    ])
      ink[k] = s.getPropertyValue(k).trim();
  }
  readInks();
  cv.set({
    // (the spectrum moves while the song plays or anything sounds: musical typing, a take, a preview)
    animate: () => {
      const lv = ctx.meter.level();
      if (lv && lv.peak > -90) liveUntil = performance.now() + 600;
      return live() || flashes.size > 0;
    },
    draw: (g2, { w, h: hh, now }) => {
      if (w !== W || hh !== H) {
        W = w;
        H = hh;
        layoutNodes();
      }
      const g = geo();
      ensureCols(g);
      computeCurves();
      if (placeFor) {
        const n = placeFor;
        placeFor = 0;
        placeRead(n);
      }
      // the ground and the grid: decades heavier, the 0 dB line heavier still
      g2.fillStyle = ink['--bg'] || '#141210';
      g2.fillRect(0, 0, w, hh);
      g2.lineWidth = 1;
      for (let dec = 10; dec <= 10000; dec *= 10)
        for (let m = 1; m <= 9; m++) {
          const f = dec * m;
          if (f < F_LO || f > F_HI) continue;
          const x = Math.round(xOf(f, g)) + 0.5;
          g2.strokeStyle = m === 1 ? ink['--line-2'] : ink['--line'];
          g2.beginPath();
          g2.moveTo(x, g.t);
          g2.lineTo(x, g.b);
          g2.stroke();
        }
      const step = memo.range === 12 ? 3 : 6;
      for (let d = -memo.range; d <= memo.range; d += step) {
        const y = Math.round(yOf(d, g)) + 0.5;
        g2.strokeStyle = d === 0 ? ink['--line-2'] : ink['--line'];
        if (d === 0) g2.lineWidth = 1.5;
        g2.beginPath();
        g2.moveTo(g.l, y);
        g2.lineTo(g.r, y);
        g2.stroke();
        g2.lineWidth = 1;
      }
      // the labels: Hz under the plot, dB at its left, in the mono face
      const ph = phone();
      g2.font = `${ph ? 12 : 11}px ${getComputedStyle(root).getPropertyValue('--font-mono') || 'monospace'}`;
      g2.fillStyle = ink['--text-3'];
      g2.textBaseline = 'top';
      g2.textAlign = 'center';
      for (const [f, t] of ph
        ? [
            [50, '50'],
            [200, '200'],
            [1000, '1k'],
            [5000, '5k'],
            [20000, '20k'],
          ]
        : [
            [20, '20'],
            [50, '50'],
            [100, '100'],
            [200, '200'],
            [500, '500'],
            [1000, '1k'],
            [2000, '2k'],
            [5000, '5k'],
            [10000, '10k'],
            [20000, '20k'],
          ]) {
        const x = clamp(xOf(f, g), g.l + 10, g.r - 12);
        g2.fillText(t, x, g.b + 6);
      }
      g2.textAlign = 'right';
      g2.textBaseline = 'middle';
      for (let d = -memo.range; d <= memo.range; d += memo.range / 2)
        g2.fillText(d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0', g.l - 6, yOf(d, g));
      // the spectrum: what comes in, filled; what goes out, a line
      g2.save();
      g2.beginPath();
      g2.rect(g.l, g.t, g.r - g.l, g.b - g.t);
      g2.clip();
      if (live()) {
        const pre = specPath(ctx.meter.tap?.('input', { fftSize: FFT, smoothing: 0.8 }), g);
        const post = specPath(ctx.meter.tap?.('output', { fftSize: FFT, smoothing: 0.8 }), g);
        if (pre) {
          g2.fillStyle = ink['--line-2'];
          g2.globalAlpha = 0.55;
          g2.beginPath();
          g2.moveTo(g.l, g.b);
          for (let i = 0; i < cols.n; i++) g2.lineTo(cols.x[i], specY(pre[i], cols.f[i], g));
          g2.lineTo(g.r, g.b);
          g2.closePath();
          g2.fill();
          g2.globalAlpha = 1;
        }
        if (post) {
          g2.strokeStyle = ink['--text-3'];
          g2.lineWidth = 1;
          g2.beginPath();
          for (let i = 0; i < cols.n; i++) {
            const y = specY(post[i], cols.f[i], g);
            if (i) g2.lineTo(cols.x[i], y);
            else g2.moveTo(cols.x[i], y);
          }
          g2.stroke();
        }
        let loud = false;
        if (post)
          for (let i = 0; i < cols.n; i++)
            if (post[i] > -110) {
              loud = true;
              break;
            }
        if (loud) liveUntil = now + 600;
      }
      // the soloed band's region, shaded in the device's colour
      if (solo) {
        const sc = new Float64Array(20),
          sn = (() => {
            const b = band(solo);
            return eqSoloSections(b.type, b.freq, b.q, sr(), sc, 0);
          })();
        g2.fillStyle = color;
        g2.globalAlpha = 0.1;
        g2.beginPath();
        g2.moveTo(cols.x[0], g.b);
        for (let i = 0; i < cols.n; i++) {
          const p = eqBandPow(sc, 0, sn, cols.cw[i], cols.c2w[i], cols.sw[i], cols.s2w[i]);
          g2.lineTo(cols.x[i], g.b - clamp(1 + Math.log10(Math.max(p, 1e-9)) / 1.2, 0, 1) * (g.b - g.t));
        }
        g2.lineTo(cols.x[cols.n - 1], g.b);
        g2.closePath();
        g2.fill();
        g2.globalAlpha = 1;
      }
      // each band's own curve, faint; the picked one's filled to the line
      const zero = yOf(0, g);
      for (let b = 1; b <= NB; b++) {
        if (!placed(b)) continue;
        const P = bandPow[b - 1],
          on = band(b).on,
          picked = memo.sel === b;
        if (picked && on) {
          g2.fillStyle = color;
          g2.globalAlpha = 0.13;
          g2.beginPath();
          g2.moveTo(cols.x[0], zero);
          for (let i = 0; i < cols.n; i++) g2.lineTo(cols.x[i], yRaw(P[i], g));
          g2.lineTo(cols.x[cols.n - 1], zero);
          g2.closePath();
          g2.fill();
          g2.globalAlpha = 1;
        }
        g2.strokeStyle = picked ? ink['--text-2'] : ink['--text-3'];
        g2.globalAlpha = picked ? 0.75 : on ? 0.45 : 0.3;
        g2.lineWidth = 1;
        if (!on) g2.setLineDash([3, 3]);
        g2.beginPath();
        for (let i = 0; i < cols.n; i++) {
          const y = yRaw(P[i], g);
          if (i) g2.lineTo(cols.x[i], y);
          else g2.moveTo(cols.x[i], y);
        }
        g2.stroke();
        g2.setLineDash([]);
        g2.globalAlpha = 1;
      }
      // the whole EQ, in the device's colour
      g2.strokeStyle = color;
      g2.lineWidth = 2;
      g2.lineJoin = 'round';
      g2.beginPath();
      for (let i = 0; i < cols.n; i++) {
        const y = yRaw(sumDb[i], g);
        if (i) g2.lineTo(cols.x[i], y);
        else g2.moveTo(cols.x[i], y);
      }
      g2.stroke();
      g2.restore();
      // the flashes run out
      for (const [n, until] of flashes)
        if (now > until) {
          flashes.delete(n);
          nodes[n].classList.remove('eq8-flash');
        }
    },
  });

  /* ---------------------------------------------------------------- changes: anyone's */
  function flashBand(n) {
    const nd = nodes[n];
    nd.classList.remove('eq8-flash');
    void nd.offsetWidth;
    nd.classList.add('eq8-flash');
    flashes.set(n, performance.now() + 1700);
    cv.dirty();
  }
  const off = ctx.on((evt) => {
    vals = evt.params || ctx.params();
    const bandsTouched = new Set();
    for (const k of evt.keys || []) {
      const m = /^b(\d+)_/.exec(k);
      if (m) bandsTouched.add(+m[1]);
    }
    if (evt.kind === 'undo' || evt.kind === 'redo' || evt.kind === 'load') authorsFromHistory();
    else if (evt.by && evt.kind !== 'lane') for (const n of bandsTouched) authors[n] = evt.by;
    if (evt.by && ctx.isAgent(evt.by) && evt.kind === 'do') for (const n of bandsTouched) flashBand(n);
    computeCoefs();
    curvesDirty = true;
    syncAll();
    if (drag) placeRead(drag.n);
    // the line about a band moved since it was written says where the band is now (an agent's change gets the
    // window's own line, after this one)
    if (bandSaid && bandsTouched.has(bandSaid.n) && ctx.statusText?.() === bandSaid.text) sayBand(bandSaid.n);
  });

  syncScale();
  syncAll();
  pick(memo.sel);
  // (for the checks, tools/eq-test.js: where a frequency and a gain are on the screen, and back)
  root.eq8Map = {
    xy(f, db) {
      const r = plot.getBoundingClientRect();
      return { x: r.left + xOf(f), y: r.top + yOf(db) };
    },
    at(x, y) {
      const r = plot.getBoundingClientRect();
      return { f: fOf(x - r.left), db: dbOf(y - r.top) };
    },
  };

  return {
    update(evt) {
      if (evt?.type === 'on') cv.dirty();
      if (evt?.type === 'lanes') syncPanel();
    },
    frame(now) {
      // the solo follows the live instance (a rebuilt device, a stop that let go of every automated key)
      if (solo && liveInst() !== soloInst) pushSolo();
      void now;
    },
    unmount() {
      off();
      offTransport?.();
      clearTimeout(wheelT);
      clearTimeout(readT);
      if (solo) {
        solo = 0;
        pushSolo();
      }
      closeMenu();
      cv.destroy();
      root.remove();
    },
  };
}

const CSS = `
/* Slide Rule's window (ui/editors/eq8.js): a measuring instrument. A hairline grid on the room's ground, labels in the
   mono face, square numbered nodes, the curve in the device's colour; the picked band in reverse print */
.eq8 { display: flex; flex-direction: column; min-height: 100%; }
.eq8-strut { width: 920px; max-width: 100%; height: 0; }
.eq8-plot { position: relative; flex: 1 1 340px; min-height: 280px; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; background: var(--bg); border-bottom: var(--rule); }
.eq8-plot .eq8-cv { position: absolute; inset: 0; width: 100%; height: 100%; }
.eq8-hint { position: absolute; left: 50%; top: 42%; margin: 0; transform: translateX(-50%); font-size: 13px; color: var(--text-3); pointer-events: none; white-space: nowrap; }
/* a node: a square you press, its band's number in it; outlined in the ink of whoever set it (cream for the house) */
.eq8-node { position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 22px; height: 22px; margin: -11px 0 0 -11px; box-sizing: border-box; background: var(--panel); border: 1.5px solid var(--text-2); border-radius: var(--r-press); color: var(--text); font: 600 11px/1 var(--font-mono); cursor: grab; touch-action: none; outline: none; z-index: 1; will-change: transform; }
.eq8-node[hidden] { display: none; }
.eq8-node[data-ink="human"] { border-color: var(--human); }
.eq8-node[data-ink="agent"] { border-color: var(--agent); }
.eq8-node.off { border-style: dashed; color: var(--text-3); background: var(--bg); }
.eq8-node.sel { background: var(--text); color: var(--bg); z-index: 2; }
.eq8-node.sel.off { background: var(--bg-3); color: var(--text); }
.eq8-node.drag { cursor: grabbing; }
.eq8-node:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.eq8-node[data-edge="top"]::after, .eq8-node[data-edge="bottom"]::after { content: ''; position: absolute; left: 50%; width: 0; height: 0; margin-left: -4px; border: 4px solid transparent; }
.eq8-node[data-edge="top"]::after { top: -10px; border-bottom-color: var(--text-2); }
.eq8-node[data-edge="bottom"]::after { bottom: -10px; border-top-color: var(--text-2); }
/* an agent's move: a cool frame that fades (no glow) */
.eq8-node.eq8-flash { animation: eq8-flash 1.6s var(--ease) both; }
@keyframes eq8-flash { 0%, 35% { box-shadow: 0 0 0 3px var(--bg), 0 0 0 4.5px var(--agent); } 100% { box-shadow: 0 0 0 3px transparent, 0 0 0 4.5px transparent; } }
@media (prefers-reduced-motion: reduce) { .eq8-node.eq8-flash { animation-duration: 1.6s; animation-timing-function: steps(1, end); } }
/* the values beside a node while it moves */
.eq8-read { position: absolute; left: 0; top: 0; display: grid; gap: 1px; padding: 5px 8px; background: var(--bg); border: var(--rule-2); font: 400 11.5px/1.35 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text); white-space: nowrap; pointer-events: none; z-index: 3; }
.eq8-read[hidden] { display: none; }
.eq8-read b { font: 600 11px/1.35 var(--font-ui); color: var(--text-2); }
/* the ledger: the eight bands in a row of hairline columns; the picked one in reverse print */
.eq8-bar { display: flex; align-items: stretch; gap: 0 16px; border-bottom: var(--rule); }
.eq8-ledger { flex: 1 1 auto; display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); min-width: 0; }
.eq8-cell { display: grid; grid-template-columns: auto 1fr; grid-auto-rows: auto; align-content: start; gap: 1px 6px; min-width: 0; padding: 8px 8px 9px; margin: 0; border: 0; border-left: var(--rule); border-radius: 0; background: none; color: var(--text); text-align: left; cursor: pointer; }
.eq8-cell:first-child { border-left: 0; }
.eq8-cell:hover { background: var(--bg-3); }
.eq8-cell:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.eq8-cn { grid-row: span 2; font: italic 800 20px/1 var(--font-display); font-variation-settings: var(--font-display-vars); color: var(--text-2); }
.eq8-cell[data-ink="human"] .eq8-cn { color: var(--human); }
.eq8-cell[data-ink="agent"] .eq8-cn { color: var(--agent); }
.eq8-cell .eq8-gl { justify-self: start; color: var(--text-2); }
.eq8-cw { grid-column: 1 / -1; font: 600 11.5px/1.3 var(--font-ui); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.eq8-cv { grid-column: 1 / -1; font: 400 11px/1.3 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-2); white-space: nowrap; }
.eq8-cell.free .eq8-cw { color: var(--text-3); font-weight: 400; }
.eq8-cell.off .eq8-cw, .eq8-cell.off .eq8-cv { color: var(--text-3); text-decoration: line-through; text-decoration-color: var(--line-2); }
.eq8-cell.sel-print, .eq8-cell.sel-print:hover { background: var(--text); color: var(--bg); }
.eq8-cell.sel-print .eq8-cn, .eq8-cell.sel-print .eq8-cv, .eq8-cell.sel-print .eq8-gl, .eq8-cell.sel-print .eq8-cw { color: var(--bg); }
.eq8-legend { flex: none; display: flex; align-items: center; gap: 6px; margin: 0; padding: 0 14px 0 0; font-size: 11.5px; color: var(--text-3); white-space: nowrap; }
.eq8-legend i { display: inline-block; width: 14px; height: 8px; margin-left: 8px; }
.eq8-lg-in { background: var(--line-2); }
.eq8-legend .eq8-lg-out { height: 1px; background: var(--text-3); }
.eq8-legend .eq8-lg-eq { height: 2px; background: var(--eq-c); }
/* the picked band's controls, then the output */
.eq8-low { display: flex; flex-wrap: wrap; align-items: flex-start; }
.eq8-panels { flex: 1 1 560px; min-width: 0; }
.eq8-panel { padding: 12px 18px 14px; }
.eq8-panel[hidden] { display: none; }
.eq8-ph { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; font-size: 13px; color: var(--text-2); }
.eq8-pn { font: 600 13px/1.2 var(--font-ui); color: var(--text); }
.eq8-pby { font-size: 12.5px; }
.eq8-pctl { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 14px 18px; }
.eq8-shape { justify-items: start; }
.eq8-shbox { display: grid; gap: 6px; }
.eq8-shrow, .eq8-slrow { display: inline-flex; }
.eq8-slrow[hidden] { display: none; }
.eq8-sh, .eq8-sl { display: inline-grid; place-items: center; min-width: 36px; height: 30px; padding: 0 4px; margin-left: -1px; border: var(--rule-2); border-radius: 0; background: none; color: var(--text-2); font: 600 11.5px/1 var(--font-mono); cursor: pointer; }
.eq8-sh:first-child, .eq8-sl:first-child { margin-left: 0; border-radius: var(--r-press) 0 0 var(--r-press); }
.eq8-sh:last-child, .eq8-sl:last-child { border-radius: 0 var(--r-press) var(--r-press) 0; }
.eq8-sh:hover, .eq8-sl:hover { color: var(--text); }
.eq8-sh.sel-print, .eq8-sl.sel-print { position: relative; z-index: 1; background: var(--text); border-color: var(--text); color: var(--bg); }
.eq8-sh:focus-visible, .eq8-sl:focus-visible { position: relative; z-index: 2; outline: 2px solid var(--accent-2); outline-offset: 1px; }
.eq8-gain.unused { opacity: .45; }
.eq8-pact { display: grid; justify-items: start; gap: 8px; padding-top: 18px; }
.eq8-rm { font-size: 12px; }
.eq8-pnote { margin: 10px 0 0; font-size: 12.5px; color: var(--text-3); }
.eq8-pnote:empty { display: none; }
.eq8-out { flex: 0 0 auto; display: grid; gap: 12px; padding: 12px 18px 14px; border-left: var(--rule); }
.eq8-oc { display: flex; align-items: flex-start; gap: 16px; }
.eq8-ac { display: grid; gap: 6px; justify-items: start; }
.eq8-auto { max-width: 180px; margin: 0; font-size: 12px; line-height: 1.4; color: var(--text-3); }
.eq8-sc-w { display: flex; align-items: center; gap: 8px; }
.eq8-scale { display: inline-flex; }
.eq8-sc { min-width: 40px; height: 24px; margin-left: -1px; border: var(--rule-2); border-radius: 0; background: none; color: var(--text-2); font: 400 11px/1 var(--font-mono); cursor: pointer; }
.eq8-sc:first-child { margin-left: 0; border-radius: var(--r-press) 0 0 var(--r-press); }
.eq8-sc:last-child { border-radius: 0 var(--r-press) var(--r-press) 0; }
.eq8-sc.sel-print { position: relative; background: var(--text); border-color: var(--text); color: var(--bg); }
.eq8-sc:focus-visible { position: relative; outline: 2px solid var(--accent-2); outline-offset: 1px; }
.eq8-about { margin: 0; padding: 10px 18px 14px; border-top: var(--rule); font-size: 12.5px; line-height: 1.5; color: var(--text-3); }
/* the band menu */
.eq8-menu { display: grid; min-width: 220px; }
.eq8-mi { display: flex; align-items: center; gap: 8px; }
.eq8-mi .eq8-gl, .eq8-mi-g { flex: none; width: 22px; color: var(--text-2); }
.eq8-mi[aria-checked="true"] { background: var(--text); color: var(--bg); }
.eq8-mi[aria-checked="true"] .eq8-gl, .eq8-mi[aria-checked="true"] .ek-sub { color: var(--bg); }
/* a phone: the plot takes the width; the picked band's controls under it, 44 px to a target */
.pw-phone .eq8-strut { display: none; }
.pw-phone .eq8-plot { flex: none; height: min(46vh, 300px); min-height: 220px; }
.pw-phone .eq8-node { width: 26px; height: 26px; margin: -13px 0 0 -13px; font-size: 12px; }
.pw-phone .eq8-node::before { content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
.pw-phone .eq8-bar { display: block; }
.pw-phone .eq8-legend { display: none; }
.pw-phone .eq8-cell { min-height: 48px; padding: 6px 4px; grid-template-columns: 1fr; justify-items: center; }
.pw-phone .eq8-cell .eq8-cw, .pw-phone .eq8-cell .eq8-cv { display: none; }
.pw-phone .eq8-cn { grid-row: auto; font-size: 18px; }
.pw-phone .eq8-cell .eq8-gl { justify-self: center; }
.pw-phone .eq8-panel { padding: 12px 12px 14px; }
.pw-phone .eq8-panels { flex-basis: 100%; }
.pw-phone .eq8-sh, .pw-phone .eq8-sl, .pw-phone .eq8-sc { min-width: 44px; height: 44px; font-size: 12.5px; }
.pw-phone .eq8-shrow { flex-wrap: wrap; }
.pw-phone .eq8-out { flex-basis: 100%; border-left: 0; border-top: var(--rule); padding: 12px; }
.pw-phone .eq8-rm { min-height: 44px; }
.pw-phone .eq8-pact { padding-top: 0; }
.pw-phone .eq8-read { font-size: 12px; }
.pw-phone .eq8-read b { font-size: 12px; }
.pw-phone .eq8-auto, .pw-phone .eq8-pnote, .pw-phone .eq8-about, .pw-phone .eq8-hint { font-size: 12.5px; }
`;
