// The tab staff [ui-jam]: a part drawn as tab, for the Jam room's tab lane (ui/tabs.js) and the Notes panel's Tab view.
//
// paintStaff(cv, G, inks, part, opts) draws hairline strings named by their open notes, the bars numbered, a tick a
// beat, the chords where they change, each note's fret (counted from the capo) where it starts with its length after
// it along its string, bends as arrows, the loop in grease pencil and the playhead in leader green. staffShape(part,
// opts) is its geometry: a page of up to four bars across the width, or the whole part at a set width a beat, to scroll.
//
// The Tab view (mountRollTab) is the Notes panel's clip as tab: the same notes, so an edit in one is an edit in the
// other, and the outline round a fret number says who wrote it (warm a person, cool an agent, none the house), as a
// note's outline does in the roll. Click a fret number to pick its note (shift adds; the selection is the roll's).
// Type a fret and the picked notes move to it on their strings, the pitch going with them (Scale lock holds, as it
// does for a drawn note); ↑ and ↓ move them to the string above or below, the pitch staying. The clip's tuning and
// capo are set here (clip.set). Each edit is one notes.set by you, one undo (a two-digit fret is one). A place is a
// hint the pitch overrules: a note moved off its place (a transpose, another tuning) is fingered again where it's drawn.
//
//   mountRollTab(app, ctx) -> { el, frame(now), changed(), sync(), unmount(), part(), at(noteId) -> { x, y } }
//   ctx (ui/pianoroll.js): { cur() -> { t, c } | null, active() -> bool, sel() -> Set of note ids, setSel(ids),
//     say(text), lockOn() -> bool, nameOf(p) }

import { h, css, canvas, clamp } from './dom.js';
import { authorKind } from './arrange-kit.js';
import { placeNotes, tuningOf, capoOf, TUNINGS, TUNING_IDS, MAX_FRET } from '../core/fretboard.js';
import { beatsPerBar, inScale, keyLabel } from '../core/music.js';

const EPS = 1e-6;
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const STRING_WORD = ['low E', 'A', 'D', 'G', 'B', 'high e'];
export const bendTop = (b) =>
  typeof b === 'number' ? b : Array.isArray(b) ? b.reduce((m, x) => (Math.abs(x[1]) > Math.abs(m) ? x[1] : m), 0) : 0;

// The inks the staff is drawn in (the tokens, resolved: one computed style read)
export function readInks() {
  const cs = getComputedStyle(document.documentElement),
    t = (k) => cs.getPropertyValue(k).trim();
  return {
    text: t('--text'),
    text2: t('--text-2'),
    text3: t('--text-3'),
    bg: t('--bg'),
    line: t('--line'),
    line2: t('--line-2'),
    human: t('--human'),
    agent: t('--agent'),
    accent: t('--accent'),
    pencil: t('--accent-2'),
    mono: t('--font-mono'),
    ui: t('--font-ui'),
  };
}
// The staff's shape for a part: a page of up to four bars across vw (pageOf() says which), or (whole) the whole part at
// ppb pixels a beat, as wide as it needs, to scroll
export function staffShape(pt, { vw = 600, whole = false, ph = false, ppb: want = null, pageOf = () => 0 } = {}) {
  const bpb = pt.bpb,
    nBars = pt.bars[1] - pt.bars[0] + 1;
  const labelW = ph ? 28 : 26,
    padR = 14,
    top = ph ? 38 : 34,
    gap = ph ? 21 : 16,
    bottom = ph ? 18 : 14;
  let pageBars, ppb;
  if (whole) {
    pageBars = nBars;
    ppb = want || (ph ? 76 : 64);
  } else {
    pageBars = Math.min(nBars, 4);
    ppb = Math.max(34, (vw - labelW - padR) / (pageBars * bpb));
  }
  const W = whole ? Math.max(vw, Math.ceil(labelW + nBars * bpb * ppb + padR)) : vw;
  const n = tuningOf(pt.tuning).strings.length;
  const a0 = (pt.bars[0] - 1) * bpb;
  const G = {
    ph,
    bpb,
    labelW,
    top,
    gap,
    W,
    H: top + gap * (n - 1) + bottom,
    ppb,
    pageBars,
    pages: Math.max(1, Math.ceil(nBars / pageBars)),
    n,
    a0,
    pageStart: () => a0 + (whole ? 0 : pageOf()) * pageBars * bpb,
    xOf: (beat) => labelW + (beat - G.pageStart()) * ppb,
    yOf: (s) => top + (n - 1 - s) * gap,
    beatAt: (x) => (x < labelW - 4 ? null : G.pageStart() + (x - labelW) / ppb),
  };
  return G;
}
// Draw a part's tab. part: { notes (t from start, with s, f), start, end, bars, bpb, tuning, capo, chords? }.
// noteState(note, t0) -> { box (reverse print), ink ('text' | 'human' | 'dim' | 'text2'), ring ('early' | 'late'),
// outline ('human' | 'agent': who wrote it), alpha }. -> the notes drawn in reverse print
export function paintStaff(cv, G, inks, pt, { noteState, at = null, loop = null, chords = true } = {}) {
  const g = cv.g,
    { W, H, n, gap, top, labelW } = G;
  g.clearRect(0, 0, W, H);
  const pageA = G.pageStart(),
    pageB = Math.min(pt.end, pageA + G.pageBars * G.bpb);
  const names = tuningOf(pt.tuning).notes.split(' ');
  const fs = G.ph ? 14 : 13,
    small = G.ph ? 12 : 11;
  g.font = `500 ${small}px ${inks.mono}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (let s = 0; s < n; s++) {
    const y = Math.round(G.yOf(s)) + 0.5;
    g.fillStyle = inks.line2;
    g.fillRect(labelW, y - 0.5, W - labelW - 6, 1);
    g.fillStyle = inks.text3;
    g.fillText(s === n - 1 && /^E/.test(names[s] || '') ? 'e' : names[s] || '', 4, y);
  }
  // the loop, in grease pencil over the staff, where it covers this page
  if (loop?.on && loop.end > pageA && loop.start < pageB) {
    const x0 = Math.max(labelW, G.xOf(loop.start)),
      x1 = Math.min(W - 6, G.xOf(loop.end));
    g.fillStyle = inks.pencil;
    g.fillRect(x0, 4, Math.max(2, x1 - x0), 2);
  }
  // bars: a line and its number; beats: a tick over the top string; the chords where they change
  const bpb = G.bpb,
    ytop = G.yOf(n - 1),
    ybot = G.yOf(0);
  for (let b = Math.ceil(pageA / bpb - EPS); b * bpb <= pageB + EPS; b++) {
    const x = Math.round(G.xOf(b * bpb)) + 0.5;
    g.fillStyle = inks.line2;
    g.fillRect(x - 0.5, ytop, 1, ybot - ytop);
    if (b * bpb < pageB - EPS) {
      g.fillStyle = inks.text3;
      g.font = `600 ${small}px ${inks.mono}`;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillText(String(b + 1), x + 3, top - 20);
    }
  }
  g.fillStyle = inks.line2;
  for (let x = Math.ceil(pageA - EPS); x < pageB - EPS; x++)
    if (Math.abs(x / bpb - Math.round(x / bpb)) > EPS) g.fillRect(Math.round(G.xOf(x)), ytop - 6, 1, 4);
  if (chords) {
    g.font = `600 ${G.ph ? 13 : 12}px ${inks.ui}`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = inks.text2;
    for (const c of pt.chords || [])
      if (c.t >= pageA - EPS && c.t < pageB - EPS) g.fillText(c.name, G.xOf(c.t) + 3, top - 7);
  }
  // the notes: the fret where each starts, its length after it along the string, its state
  const boxed = [];
  for (const nn of pt.notes) {
    const t0 = pt.start + nn.t;
    if (t0 < pageA - EPS || t0 >= pageB - EPS || !Number.isInteger(nn.s)) continue;
    const x = G.xOf(t0),
      y = G.yOf(nn.s),
      label = String(nn.f - pt.capo);
    g.font = `700 ${fs}px ${inks.mono}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const bw = g.measureText(label).width + 6,
      bh = fs + 4;
    // its length, along its string (the note's own length, as played)
    const x1 = Math.min(G.xOf(Math.min(pt.end, t0 + (nn.d || 0.25))), W - 6);
    if (x1 > x + bw / 2 + 2) {
      g.fillStyle = inks.text3;
      g.globalAlpha = 0.55;
      g.fillRect(x + bw / 2 + 1, y - 1, x1 - x - bw / 2 - 2, 2);
      g.globalAlpha = 1;
    }
    const st = noteState ? noteState(nn, t0) : {};
    // a knockout behind the number, so the string breaks around it
    g.fillStyle = inks.bg;
    g.fillRect(x - bw / 2, y - bh / 2, bw, bh);
    if (st.box) {
      g.fillStyle = inks.text;
      g.fillRect(x - bw / 2, y - bh / 2, bw, bh);
      g.fillStyle = inks.bg;
      boxed.push(nn);
    } else
      g.fillStyle =
        st.ink === 'human' ? inks.human : st.ink === 'dim' ? inks.text3 : st.ink === 'text2' ? inks.text2 : inks.text;
    g.globalAlpha = st.alpha ?? 1;
    g.fillText(label, x, y + 0.5);
    // who wrote it: a hairline frame in their ink (the house's notes go without)
    if (!st.box && (st.outline === 'human' || st.outline === 'agent')) {
      g.strokeStyle = st.outline === 'agent' ? inks.agent : inks.human;
      g.lineWidth = 1;
      g.strokeRect(Math.round(x - bw / 2) + 0.5, Math.round(y - bh / 2) + 0.5, Math.round(bw) - 1, bh - 1);
    }
    if (!st.box && st.ring) {
      const rr = Math.max(bw, bh) / 2 + 2;
      g.strokeStyle = inks.human;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.stroke();
      // a tick on the side you were: before the note (early) or after it (late)
      const sx = st.ring === 'early' ? x - rr - 5 : x + rr + 1;
      g.fillStyle = inks.human;
      g.fillRect(sx, y - 0.75, 4, 1.5);
    }
    g.globalAlpha = 1;
    // a bend: an arrow up off the number, "full" or "½" over it
    const up = nn.bend ? Math.round(bendTop(nn.bend)) : 0;
    if (up) {
      const bx = x + bw / 2 + 1,
        by = y - 2,
        rise = Math.min(gap - 4, 12);
      g.strokeStyle = st.box ? inks.text : inks.text2;
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + 9, by, bx + 9, by - rise);
      g.stroke();
      g.beginPath();
      g.moveTo(bx + 6, by - rise + 4);
      g.lineTo(bx + 9, by - rise);
      g.lineTo(bx + 12, by - rise + 4);
      g.stroke();
      g.font = `600 ${small}px ${inks.ui}`;
      g.fillStyle = inks.text2;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillText(up >= 2 ? 'full' : '½', bx + 12, by - rise + 2);
    }
  }
  // the playhead (leader green), or where Learn it waits
  if (at != null && at >= pageA - 0.25 && at <= pageB + 0.05) {
    const x = Math.round(G.xOf(at));
    g.fillStyle = inks.accent;
    g.fillRect(x - 1, ytop - 10, 2, ybot - ytop + 18);
  }
  return boxed;
}

/* --------------------------------------------------------------------------------------------- the Notes panel's Tab view */
export function mountRollTab(app, ctx) {
  const { store, engine, ui } = app;
  css('tabstaff', CSS);
  const tuningSel = h(
    'select.ew-input.prt-tuning',
    {
      'aria-label': 'Tuning',
      onchange: (e) =>
        setClip({ tuning: e.target.value }, `tuning: ${TUNINGS[e.target.value]?.name || e.target.value}`),
    },
    TUNING_IDS.map((id) => h('option', { value: id }, TUNINGS[id].name)),
  );
  const capoSel = h(
    'select.ew-input.prt-capo',
    {
      'aria-label': 'Capo',
      onchange: (e) => {
        const n = +e.target.value;
        setClip({ capo: n || null }, n ? `capo at the ${ORD(n)} fret` : 'no capo');
      },
    },
    Array.from({ length: 13 }, (_, n) => h('option', { value: n }, n ? `Capo, ${ORD(n)} fret` : 'No capo')),
  );
  const pos = h('span.prt-pos');
  const cv = canvas('prt-cv');
  const scroller = h(
    'div.prt-scroll',
    {
      tabindex: 0,
      role: 'application',
      'aria-roledescription': 'tab',
      'aria-label':
        'The clip as tab. Click a fret number to pick its note; type a fret to move it along its string; up and down arrows move it to the next string at the same pitch.',
    },
    cv.cv,
  );
  const msg = h('p.prt-msg');
  const selLine = h('span.prt-sel');
  const lower = h(
    'button.btn.btn-txt.prt-lower',
    {
      type: 'button',
      title: 'The string below in the tab (lower-pitched), the same note: ↓',
      onclick: () => moveString(-1),
    },
    'Lower string',
  );
  const higher = h(
    'button.btn.btn-txt.prt-higher',
    {
      type: 'button',
      title: 'The string above in the tab (higher-pitched), the same note: ↑',
      onclick: () => moveString(1),
    },
    'Higher string',
  );
  const fretDown = h(
    'button.btn.btn-txt.prt-fdown',
    {
      type: 'button',
      title: 'A fret down on the same string: the note goes down a semitone (in the key, with Scale lock)',
      onclick: () => stepFret(-1),
    },
    'Fret −1',
  );
  const fretUp = h(
    'button.btn.btn-txt.prt-fup',
    {
      type: 'button',
      title: 'A fret up on the same string: the note goes up a semitone (in the key, with Scale lock)',
      onclick: () => stepFret(1),
    },
    'Fret +1',
  );
  const acts = h('div.prt-acts', lower, higher, fretDown, fretUp);
  const hint = h(
    'p.prt-hint',
    'Click a fret number to pick its note (shift adds). Type a fret to move it along its string, the pitch going with it; ↑ ↓ move it to the next string, the pitch staying.',
  );
  const el = h(
    'div.prt',
    h(
      'div.prt-head',
      h('label.prt-field', h('span.prt-lab', 'Tuning'), tuningSel),
      h('label.prt-field', h('span.prt-lab', 'Capo'), capoSel),
      pos,
    ),
    scroller,
    msg,
    h('div.prt-foot', selLine, acts),
    hint,
  );

  let dirty = true,
    G = null,
    pt = null,
    lastW = 0,
    typed = '',
    typedAt = 0,
    msgAt = 0;
  const changed = () => {
    pt = null;
    dirty = true;
  };
  const phone = () => matchMedia('(max-width: 640px)').matches;

  /* the part: the clip's notes, each on a string and a fret (its own place, or fingered) */
  function build(cur) {
    const p = store.get(),
      bpb = beatsPerBar(p.meter),
      c = cur.c;
    const tuning = tuningOf(c.tuning || ui.state.jam?.tuning || 'standard').id,
      capo = capoOf(c.capo);
    const rel = c.notes.filter((n) => n.t >= 0 && n.t < c.length - EPS);
    const pl = placeNotes(rel, { tuning, capo, open: 0.3 });
    const a = Math.floor(c.start / bpb + EPS) + 1,
      b = Math.max(a, Math.ceil((c.start + c.length) / bpb - EPS));
    return {
      clipId: c.id,
      start: c.start,
      end: c.start + c.length,
      bars: [a, b],
      bpb,
      tuning,
      capo,
      chords: [],
      notes: pl.error ? [] : pl.notes,
      n: rel.length,
      error: pl.error ? `${pl.error}${pl.hint ? `: ${pl.hint}` : ''}.` : null,
    };
  }
  function part() {
    const cur = ctx.cur();
    if (!cur) return null;
    if (!pt || pt.clipId !== cur.c.id) {
      const was = pt?.clipId;
      pt = build(cur);
      if (was !== pt.clipId) {
        G = null;
        scroller.scrollLeft = 0;
      } else G = null;
      sync();
    }
    return pt;
  }
  function layout() {
    const ph = phone(),
      vw = Math.max(240, scroller.clientWidth || 600);
    const beats = (pt.bars[1] - pt.bars[0] + 1) * pt.bpb;
    G = staffShape(pt, { vw, whole: true, ph, ppb: clamp((vw - 40) / beats, ph ? 56 : 40, ph ? 80 : 96) });
    cv.cv.style.width = `${G.W}px`;
    cv.cv.style.height = `${G.H}px`;
    lastW = vw;
  }

  /* the head and the foot: tuning, capo, where the hand sits; the picked note, and what moves it */
  const stringWord = (s) =>
    pt && pt.tuning === 'standard'
      ? `${STRING_WORD[s]} string`
      : `${ORD(tuningOf(pt?.tuning).strings.length - s)} string`;
  function sync() {
    const cur = ctx.cur();
    if (!cur) return;
    const P = pt || build(cur);
    tuningSel.value = P.tuning;
    capoSel.value = String(P.capo);
    // where on the neck it sits: open to the 7th fret, the 5th to the 8th
    const frs = P.notes.map((n) => n.f - P.capo),
      lo = frs.length ? Math.min(...frs) : 0,
      hi = frs.length ? Math.max(...frs) : 0;
    const span = !frs.length
      ? ''
      : hi === lo
        ? lo
          ? `, all at the ${ORD(lo)} fret`
          : ', all open strings'
        : `, ${lo ? `the ${ORD(lo)}` : 'open'} to the ${ORD(hi)} fret`;
    pos.textContent = P.error
      ? ''
      : P.n
        ? `${P.n} note${P.n === 1 ? '' : 's'}${span}`
        : 'No notes yet: draw some in the roll, or ask for a riff in the Jam room.';
    const S = ctx.sel(),
      picked = P.notes.filter((n) => S.has(n.id));
    if (picked.length === 1) {
      const n = picked[0],
        fr = n.f - P.capo;
      selLine.textContent = `${ctx.nameOf(n.p)}: ${fr ? `${ORD(fr)} fret` : 'open'}, ${stringWord(n.s)}.`;
    } else selLine.textContent = picked.length ? `${picked.length} notes picked.` : 'No note picked.';
    for (const b of [lower, higher, fretDown, fretUp]) b.disabled = !picked.length;
    if (P.error) {
      msg.textContent = P.error;
      msg.dataset.kind = 'error';
    } else if (msg.dataset.kind === 'error') {
      msg.textContent = '';
      msg.dataset.kind = '';
    }
    scroller.hidden = !!P.error;
    dirty = true;
  }
  function say(text) {
    msg.textContent = text;
    msg.dataset.kind = 'say';
    msgAt = performance.now();
    ctx.say?.(text);
  }

  /* picking a note: the fret number nearest the pointer, within a few pixels */
  function noteNear(e) {
    if (!pt || !G) return null;
    const r = cv.cv.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top;
    let best = null,
      bd = Infinity;
    for (const n of pt.notes) {
      const dx = Math.abs(x - G.xOf(pt.start + n.t)),
        dy = Math.abs(y - G.yOf(n.s));
      if (dx > 14 || dy > G.gap / 2 + 1) continue;
      const d = dx + dy * 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }
  cv.cv.addEventListener('pointerdown', (e) => {
    const n = noteNear(e);
    if (!n) {
      if (!e.shiftKey) ctx.setSel([]);
      return;
    }
    const ids = new Set(e.shiftKey ? ctx.sel() : []);
    if (e.shiftKey && ids.has(n.id)) ids.delete(n.id);
    else ids.add(n.id);
    ctx.setSel([...ids]);
    typed = '';
  });

  /* the edits: one notes.set by you each */
  const picked = () => {
    const P = part(),
      S = ctx.sel();
    return P ? P.notes.filter((n) => S.has(n.id)) : [];
  };
  function commit(rows, label, coalesce = null) {
    const cur = ctx.cur();
    if (!cur || !rows.length) return false;
    const r = store.dispatch(
      { type: 'notes.set', track: cur.t.id, clip: cur.c.id, notes: rows },
      { by: 'you', label, ...(coalesce ? { coalesce } : {}) },
    );
    if (!r.ok) {
      say(r.error || 'That didn’t take.');
      return false;
    }
    if (msg.dataset.kind === 'say') {
      msg.textContent = '';
      msg.dataset.kind = '';
    }
    return true;
  }
  // a string is taken when another note sounds on it at the same moment
  function clash(n, s, moving) {
    return pt.notes.find(
      (o) =>
        o.id !== n.id &&
        !moving.has(o.id) &&
        o.s === s &&
        o.t < n.t + Math.max(0.06, n.d) - EPS &&
        n.t < o.t + Math.max(0.06, o.d) - EPS,
    );
  }
  function moveString(dir) {
    const ns = picked();
    if (!ns.length) return say('Pick a note first: click its fret number.');
    const T = tuningOf(pt.tuning),
      moving = new Set(ns.map((n) => n.id)),
      rows = [],
      why = [];
    for (const n of ns) {
      const s2 = n.s + dir,
        f2 = s2 >= 0 && s2 < T.strings.length ? Math.round(n.p) - T.strings[s2] : null;
      const name = ctx.nameOf(n.p);
      if (f2 == null) {
        why.push(`there's no string ${dir > 0 ? 'above' : 'below'} the ${stringWord(n.s)}`);
        continue;
      }
      if (f2 < pt.capo) {
        why.push(`the ${stringWord(s2)} can't reach down to ${name}${pt.capo ? ' above the capo' : ''}`);
        continue;
      }
      if (f2 > MAX_FRET) {
        why.push(`${name} is past the ${ORD(MAX_FRET)} fret on the ${stringWord(s2)}`);
        continue;
      }
      const o = clash(n, s2, moving);
      if (o) {
        why.push(`the ${stringWord(s2)} is playing ${ctx.nameOf(o.p)} then`);
        continue;
      }
      rows.push({ id: n.id, s: s2, f: f2 });
    }
    if (!rows.length) return say(`It stays: ${why[0]}.`);
    const one = rows.length === 1 ? pt.notes.find((n) => n.id === rows[0].id) : null;
    if (
      commit(
        rows,
        one
          ? `${ctx.nameOf(one.p)} to the ${stringWord(rows[0].s)}`
          : `${rows.length} notes to the next string ${dir > 0 ? 'up' : 'down'}`,
      ) &&
      why.length
    )
      say(`${rows.length} moved; one stays: ${why[0]}.`);
  }
  function setFret(fr, { step = 0, typed = false } = {}) {
    const ns = picked();
    if (!ns.length) return say('Pick a note first: click its fret number.');
    const T = tuningOf(pt.tuning),
      key = store.get().key,
      lock = ctx.lockOn() && !!key,
      rows = [];
    for (const n of ns) {
      let f = step ? n.f + step : fr + pt.capo;
      // stepping with Scale lock on goes on to the next fret in the key
      if (step && lock) {
        let k = 0;
        while (k++ < 11 && f >= pt.capo && f <= MAX_FRET && !inScale(T.strings[n.s] + f, key)) f += Math.sign(step);
      }
      if (f < pt.capo)
        return say(
          pt.capo
            ? `That's under the capo (at the ${ORD(pt.capo)} fret).`
            : 'The open string is as low as that string goes.',
        );
      if (f > MAX_FRET) return say(`The neck stops at the ${ORD(MAX_FRET)} fret.`);
      const p = T.strings[n.s] + f;
      if (lock && !inScale(p, key))
        return say(
          `${ctx.nameOf(p)} is outside ${keyLabel(key)}, and Scale lock is on (Notes, at the top). Turn it off to play outside the key.`,
        );
      rows.push({ id: n.id, p, s: n.s, f });
    }
    const one = rows.length === 1 ? rows[0] : null;
    // (a typed fret's second digit joins the first's undo, so its label names no fret)
    if (typed)
      return commit(
        rows,
        one ? `a fret typed on the ${stringWord(one.s)}` : `frets typed on ${rows.length} notes`,
        `tabfret:${pt.clipId}:${rows.map((r) => r.id).join(',')}`,
      );
    commit(
      rows,
      one
        ? `${ctx.nameOf(one.p)}, ${one.f - pt.capo ? `${ORD(one.f - pt.capo)} fret` : 'open'} on the ${stringWord(one.s)}`
        : `${rows.length} notes a fret ${step > 0 ? 'up' : 'down'}`,
    );
  }
  const stepFret = (d) => setFret(null, { step: d });
  // a typed fret: a second digit soon after the first makes it two digits (1, 2: the 12th), one undo
  function typeDigit(d) {
    const now = performance.now();
    if (!picked().length) return;
    let v = now - typedAt < 900 && typed ? typed + d : d;
    if (+v + pt.capo > MAX_FRET) v = d;
    typed = v;
    typedAt = now;
    setFret(+v, { typed: true });
  }

  /* keys: in the Tab view, with a note picked, digits type a fret and ↑ ↓ change string (ahead of the roll's) */
  const on = () => ctx.active() && ctx.sel().size > 0;
  const offs = [
    ...Array.from({ length: 10 }, (_, d) =>
      ui.keys.add({
        key: `Digit${d}`,
        when: on,
        first: true,
        run: () => typeDigit(String(d)),
        label: 'Type a fret (Tab view)',
        group: 'Notes',
      }),
    ),
    ...Array.from({ length: 10 }, (_, d) =>
      ui.keys.add({
        key: `Numpad${d}`,
        when: on,
        first: true,
        hidden: true,
        run: () => typeDigit(String(d)),
        label: 'Type a fret (Tab view)',
        group: 'Notes',
      }),
    ),
    ui.keys.add({
      key: 'ArrowUp',
      when: on,
      first: true,
      run: () => moveString(1),
      label: 'The string above, same note (Tab view)',
      group: 'Notes',
    }),
    ui.keys.add({
      key: 'ArrowDown',
      when: on,
      first: true,
      run: () => moveString(-1),
      label: 'The string below, same note (Tab view)',
      group: 'Notes',
    }),
  ];

  function frame(now) {
    const P = part();
    if (!P) return;
    if (scroller.clientWidth && Math.abs(scroller.clientWidth - lastW) > 1) {
      G = null;
      dirty = true;
    }
    if (msg.dataset.kind === 'say' && now - msgAt > 6000) {
      msg.textContent = '';
      msg.dataset.kind = '';
    }
    const playing = !!engine.playing;
    if (!dirty && !playing) return;
    if (P.error) {
      dirty = false;
      return;
    }
    if (!G) layout();
    cv.fit();
    const at = playing ? engine.beat : null;
    // follow the playhead while it's in the clip and off screen
    if (playing && at != null && at >= P.start && at <= P.end) {
      const x = G.xOf(at);
      if (x < scroller.scrollLeft + 10 || x > scroller.scrollLeft + scroller.clientWidth - 30)
        scroller.scrollLeft = Math.max(0, x - 40);
    }
    const S = ctx.sel(),
      cur = ctx.cur();
    paintStaff(cv, G, readInks(), P, {
      at,
      loop: store.get().loop,
      chords: false,
      noteState: (n) => ({ box: S.has(n.id), outline: authorKind(app, n.by || cur?.c.by) }),
    });
    dirty = false;
  }
  function setClip(patch, label) {
    const cur = ctx.cur();
    if (!cur) return;
    const r = store.dispatch(
      { type: 'clip.set', track: cur.t.id, clip: cur.c.id, patch },
      { by: 'you', label: `${cur.c.name || cur.t.name}: ${label}` },
    );
    if (!r.ok) say(r.error || 'That didn’t take.');
  }
  return {
    el,
    frame,
    changed,
    sync() {
      pt = null;
      part();
    },
    unmount() {
      offs.forEach((f) => f());
    },
    // (for tools/tabs-test.js: the part as drawn, and where a note's number sits on the page)
    part: () => part(),
    at(id) {
      const n = pt?.notes.find((x) => x.id === id);
      if (!n || !G) return null;
      const r = cv.cv.getBoundingClientRect();
      return { x: r.left + G.xOf(pt.start + n.t), y: r.top + G.yOf(n.s) };
    },
  };
}

const CSS = `
/* The Notes panel's Tab view: the clip as tab, over the roll (the roll keeps its place underneath) */
.prt { position: absolute; inset: 36px 0 0 0; display: none; flex-direction: column; gap: 6px; padding: 8px 12px 10px; background: var(--panel); overflow: auto; }
.pr-istab .prt { display: flex; }
.pr-istab .pr-main { visibility: hidden; }
.prt [hidden] { display: none !important; }
.prt-head { display: flex; align-items: center; gap: 6px 16px; flex-wrap: wrap; }
.prt-field { display: inline-flex; align-items: center; gap: 8px; }
.prt-lab { font-size: 12px; font-weight: 600; color: var(--text-2); }
.prt-tuning, .prt-capo { height: 28px; font-size: 12.5px; padding: 0 8px; }
.prt-pos { font-size: 12px; color: var(--text-3); }
.prt-scroll { position: relative; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; outline: none; flex: none; touch-action: pan-x; }
.prt-scroll:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.prt-cv { display: block; cursor: pointer; }
.prt-msg { margin: 0; min-height: 18px; font-size: 12.5px; color: var(--text-2); }
.prt-msg[data-kind="error"] { color: var(--text); }
.prt-foot { display: flex; align-items: center; gap: 4px 14px; flex-wrap: wrap; }
.prt-sel { font-size: 13px; color: var(--text); min-width: 16ch; }
.prt-acts { display: inline-flex; align-items: center; gap: 4px 10px; flex-wrap: wrap; }
.prt-hint { margin: 0; font-size: 12px; color: var(--text-3); max-width: 90ch; }
@media (max-width: 900px) {
  .ew-shell .prt { inset: 44px 0 0 0; }
  .ew-shell .prt-tuning, .ew-shell .prt-capo { height: 44px; font-size: 16px; }
  .ew-shell .prt-acts .btn { min-height: 44px; min-width: 44px; }
  .ew-shell .prt-hint { display: none; }
}
`;
