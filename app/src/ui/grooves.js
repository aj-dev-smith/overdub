// The Grooves tab [ui]: the groove library (core/grooves.js) as a drummer's book. Styles down the side, each style's
// grooves as small pictures of their hits (size is velocity, ghost notes hollow, swing and lay where they fall), Hear
// (alone, or in the song instead of its drums), Put it at bar N (or drag one onto the arranger), Tap to find (tap two
// bars or so on the pads, or F J K, and the closest five come back), and Build drums for the song (the song creator:
// the plan said first, then one undo step). Also registers the agents' tools (agent/grooves-tool.js) before the
// bridges load. No edit to drumgrid.js: this is a tab of its own beside Beat.
//
//   app.grooves = { select(id), style(id), hear(id?, { alone }), stop(), hearing(), put(id?, { bar, bars, track }),
//                   tap(voice, ms), find(), clearTaps(), taps(), results(), plan(), build(), view() }
//
// Hearing a groove is a preview (store.preview: never in History, never in the redo stack): a "Hearing" track with the
// groove on it, played from the Put bar. Alone, it is soloed; with the song, the song's drum tracks are muted for it.
// It ends at its last bar (or goes round the loop, when the loop is on and holds it), on Stop, on another tab, before an
// agent's tool call and before anything this tab puts in the song. The autosave can catch a preview, so while one plays
// overdub:grooves-hearing names it, and the next boot takes a leftover out (the tab closed mid-listen).

import { h, css, canvas, clamp, byline } from './dom.js';
import { palette, rgba, touched } from './arrange-kit.js';
import * as G from '../core/grooves.js';
import { beatsPerBar } from '../core/music.js';
import { installGrooveTools, putGroove, buildDrums, targetTrack, playheadBar, isDrum, studioA } from '../agent/grooves-tool.js';

const HEARING_KEY = 'overdub:grooves-hearing';
const PAD = [
  { voice: 'kick', label: 'Kick', key: 'KeyF', hint: 'F', p: 36 },
  { voice: 'snare', label: 'Snare', key: 'KeyJ', hint: 'J', p: 38 },
  { voice: 'hat', label: 'Hat', key: 'KeyK', hint: 'K', p: 42 },
];
const FIND_AFTER = 1400;    // ms of quiet after the last tap before the library is searched
const PART_ORDER = ['intro', 'verse', 'chorus', 'bridge', 'half', 'fill', 'ending'];
const PLAN_PARTS = ['intro', 'verse', 'chorus', 'bridge', 'half', 'outro'];
const PLAN_WORD = { intro: 'Intro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', half: 'Half-time', outro: 'Outro' };

export default function (app) {
  installGrooveTools(app);
  css('grooves', CSS);
  const { ui, store } = app;
  // (once the studio is up: the autosave listens from then on, so the healed song is saved)
  if (document.documentElement.dataset.ready === '1') healLeftover(app);
  else { const off = ui.on('ready', () => { off(); healLeftover(app); }); }
  ui.panel({ id: 'grooves', region: 'bottom', title: 'Grooves', icon: 'drum', order: 13, mount: (el) => mountGrooves(el, app) });
}

// A tab that closed while a groove was heard can leave its preview in the saved song: take it back out, as the release
// would have, with nothing in History (the song never had it).
function healLeftover(app) {
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem(HEARING_KEY) || 'null'); } catch (e) { rec = null; }
  if (!rec) return;
  try { localStorage.removeItem(HEARING_KEY); } catch (e) { /* storage blocked */ }
  const p = app.store.get();
  if (rec.song !== p.id) return;
  const t = p.tracks.find((x) => x.id === rec.track);
  if (!t || !/^Hearing /.test(t.name)) return;
  const ops = [{ type: 'track.remove', track: t.id }];
  for (const id of rec.muted || []) if (p.tracks.some((x) => x.id === id && x.mute)) ops.push({ type: 'track.set', track: id, patch: { mute: false } });
  for (const id of rec.soloed || []) if (p.tracks.some((x) => x.id === id && !x.solo)) ops.push({ type: 'track.set', track: id, patch: { solo: true } });
  const r = app.store.preview(ops, { by: 'overdub' });
  if (!r.ok) console.warn('overdub: a leftover audition track could not be taken out', r.error);
}

function mountGrooves(el, app) {
  const { ui, store, engine } = app;
  const lib = G.library();
  // session state (survives a remount): what's selected, the taps, the plan (parts and ending: what the person changed
  // in it; ending null is the default, none when the song loops round its end)
  const S = app._groovesUi || (app._groovesUi = { style: null, groove: null, view: 'style', taps: [], found: null, plan: null, parts: {}, ending: null, alone: true, bar: null, bars: null, armed: false, last: null });
  if (!S.style) S.style = G.styleForSong(store.get(), { isDrum: (t) => isDrum(app, t) }).style?.id || lib.styles[0].id;
  if (!S.groove || !G.getGroove(S.groove)) S.groove = (G.groovesFor(S.style, 'verse')[0] || lib.grooves.find((g) => g.style === S.style)).id;

  /* ======================================================= DOM */
  const title = h('b.gv-title.disp');
  const meta = h('span.gv-meta.mono');
  const hearB = h('button.tog.gv-hear', { type: 'button', 'aria-pressed': 'false', onclick: () => (A ? stopHearing('button') : hear()) }, 'Hear');
  const songB = h('button.tog.gv-withsong', { type: 'button', 'aria-pressed': String(!S.alone), title: 'Play it in the song, in place of its drums', onclick: () => { S.alone = !S.alone; syncBar(); if (A) hear(); } }, 'with the song');
  const barIn = h('input.gv-num', { type: 'number', min: 1, step: 1, inputmode: 'numeric', 'aria-label': 'Bar', title: 'The bar it starts at' });
  const barsIn = h('input.gv-num', { type: 'number', min: 1, max: 64, step: 1, inputmode: 'numeric', 'aria-label': 'Bars', title: 'How many bars it plays' });
  const putB = h('button.btn.btn-go.gv-put', { type: 'button', onclick: () => put() });
  const forBars = h('label.gv-for', h('span', 'for'), barsIn, h('span.gv-barsw', 'bars'));
  const onWhat = h('span.gv-on.t3');
  const bar = h('div.gv-bar', h('div.gv-head', title, meta), h('div.gv-acts', hearB, songB, h('div.gv-putwrap', putB, h('label.gv-at', h('span.sr-only', 'Bar'), barIn), forBars, onWhat)));
  const styles = h('div.gv-styles', { role: 'listbox', 'aria-label': 'Styles' });
  const list = h('div.gv-list');
  // the tap pad
  const strip = canvas('gv-strip');
  const tapSay = h('p.gv-tapsay.t3');
  const pads = h('div.gv-pads', PAD.map((pd) => h('button.gv-pad', { type: 'button', dataset: { voice: pd.voice }, 'aria-label': `${pd.label} pad (${pd.hint})`, onpointerdown: (e) => { e.preventDefault(); tap(pd.voice, e.timeStamp); } }, h('span.gv-padname', pd.label), h('kbd', pd.hint))));
  const findB = h('button.btn.gv-find', { type: 'button', onclick: () => find() }, 'Find');
  const clearB = h('button.btn.btn-txt.gv-clear', { type: 'button', onclick: () => clearTaps() }, 'Clear');
  const buildB = h('button.btn.gv-build', { type: 'button', onclick: () => showPlan() }, 'Build drums for the song');
  const buildSay = h('p.gv-buildsay.t3');
  const lastLine = h('p.gv-last.t3', { hidden: true });
  const side = h('div.gv-side',
    h('section.gv-tap', h('h3.head', 'Tap to find'), pads, h('div.gv-stripwrap', strip.cv), tapSay, h('div.gv-tapacts', findB, clearB)),
    h('section.gv-whole', h('h3.head', 'The whole song'), buildSay, buildB),
    lastLine);
  const body = h('div.gv-body', styles, list, side);
  const root = h('div.gv', bar, body);
  el.append(root);

  /* ======================================================= the styles */
  function renderStyles() {
    styles.replaceChildren(...lib.styles.map((s) => {
      const on = s.id === S.style && S.view === 'style';
      return h('button.gv-style' + (on ? '.sel' : ''), { type: 'button', role: 'option', 'aria-selected': String(on), dataset: { style: s.id }, onclick: () => pickStyle(s.id) },
        h('span.gv-sname', s.name), h('span.gv-stempo.mono', `${s.tempo[0]}–${s.tempo[1]}`));
    }));
    // the chosen style in view (its column scrolls on its own; the page never moves)
    const on = styles.querySelector('.gv-style.sel');
    if (on) {
      const r = on.getBoundingClientRect(), box = styles.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) styles.scrollTop += r.top - box.top - (box.height - r.height) / 2;
      if (r.left < box.left || r.right > box.right) styles.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
    }
  }
  function pickStyle(id) {
    S.style = id; S.view = 'style';
    const g = G.getGroove(S.groove);
    if (!g || g.style !== id) S.groove = (G.groovesFor(id, 'verse')[0] || lib.grooves.find((x) => x.style === id)).id;
    S.bars = null;
    renderStyles(); renderList(); syncBar(); syncBuild();
    if (A) hear();
  }

  /* ======================================================= the grooves */
  let pics = [];   // [{ c, g, sel }] to draw
  let dirty = true;
  function row(g, extra = null) {
    const sel = g.id === S.groove;
    const c = canvas('gv-pic');
    const r = h('button.gv-row.ledger-row' + (sel ? '.sel' : ''), {
      type: 'button', dataset: { groove: g.id }, 'aria-pressed': String(sel),
      'aria-label': `${g.styleName}, ${g.name}: ${G.PART_LABEL[g.part]}, ${G.lengthLabel(g)}, ${g.tempo[0]} to ${g.tempo[1]} BPM. ${G.describe(g)}${extra ? '. ' + extra : ''}`,
      onclick: () => selectGroove(g.id), ondblclick: () => hear(g.id),
    },
    h('span.gv-name', h('span.gv-gname', g.name), extra ? h('span.gv-why.t3', extra) : h('span.gv-feel.t3', `${G.PART_LABEL[g.part]}, ${G.lengthLabel(g)}`)),
    c.cv,
    h('span.gv-tempo.mono.t3', `${g.tempo[0]}–${g.tempo[1]}`));
    dragFrom(r, g);
    pics.push({ c, g, sel });
    return r;
  }
  function renderList() {
    pics = [];
    if (S.view === 'plan') return renderPlan();
    if (S.view === 'taps' && S.found) {
      const f = S.found;
      const song = store.get().tempo;
      list.replaceChildren(
        h('div.gv-listhead', h('span', 'Closest to your taps'), h('span.mono.t3', ` ${f.taps} taps at about ${Math.round(f.bpm)} BPM; they play at the song's ${song}`), h('button.btn.btn-txt', { type: 'button', onclick: () => { S.view = 'style'; renderStyles(); renderList(); } }, 'Back to the styles')),
        ...(f.results.length ? f.results.map((r) => row(r.groove, `${r.groove.styleName}, ${r.matched} of ${r.of} taps on its hits, score ${r.score.toFixed(2)}`)) : [h('div.empty', h('p', 'Nothing in the library is close to that. Tap two bars or so, kick and snare on their own pads.'))]),
      );
      dirty = true;
      return;
    }
    const s = lib.styles.find((x) => x.id === S.style);
    const out = [h('div.gv-listhead', h('span', s.name), h('span.t3', ` ${s.blurb}`))];
    for (const part of PART_ORDER) {
      const gs = s.grooves.filter((g) => g.part === part);
      if (!gs.length) continue;
      out.push(h('div.gv-part.t3', part === 'fill' ? 'Fills' : G.PART_LABEL[part]));
      for (const g of gs) out.push(row(g));
    }
    list.replaceChildren(...out);
    dirty = true;
  }
  function selectGroove(id, { quiet = false } = {}) {
    const g = G.getGroove(id);
    if (!g) return;
    const was = S.groove;
    S.groove = g.id;
    // the style follows the groove in every view, so Build drums plays the style of the groove picked (one found by
    // tapping too), and Back to the styles opens on it
    if (g.style !== S.style) { S.style = g.style; renderStyles(); syncBuild(); if (S.view === 'plan') replan(); }
    if (was !== g.id) S.bars = null;
    for (const r of list.querySelectorAll('.gv-row')) { const on = r.dataset.groove === g.id; r.classList.toggle('sel', on); r.setAttribute('aria-pressed', String(on)); }
    for (const p of pics) p.sel = p.g.id === g.id;
    dirty = true;
    syncBar();
    if (A && !quiet && was !== g.id) hear();
  }
  // arrows walk the rows (and select), as tabs and menus take them
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...list.querySelectorAll('.gv-row')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const to = rows[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1)];
    to.focus(); to.click();
  });

  /* ======================================================= the top bar */
  function putBar() { const v = Math.round(Number(barIn.value)); return v >= 1 ? v : playheadBar(app); }
  function putBars(g) { const v = Math.round(Number(barsIn.value)); return v >= 1 ? Math.min(64, v) : G.defaultBars(g); }
  function syncBar() {
    const g = G.getGroove(S.groove);
    if (!g) return;
    title.textContent = `${g.styleName}, ${g.name}`;
    meta.textContent = `${G.PART_LABEL[g.part].toLowerCase()}, ${G.lengthLabel(g)}, ${g.tempo[0]}–${g.tempo[1]} BPM, ${g.feel}`;
    const fill = g.length < 4 - 1e-6;
    forBars.hidden = fill;
    if (document.activeElement !== barsIn) barsIn.value = S.bars ?? G.defaultBars(g);
    if (document.activeElement !== barIn) barIn.value = S.bar ?? playheadBar(app);
    putB.textContent = fill ? 'Put it at the end of bar' : 'Put it at bar';
    const t = targetTrack(app);
    onWhat.textContent = t ? `on ${t.name}` : 'on a new Drums track';
    hearB.setAttribute('aria-pressed', String(!!A));
    hearB.textContent = A ? 'Hearing' : 'Hear';
    songB.setAttribute('aria-pressed', String(!S.alone));
    const meter = store.get().meter;
    const fits = meter[0] === 4 && meter[1] === 4;
    putB.disabled = !fits; hearB.disabled = !fits;
    // one primary in the pane: Put, unless a plan's Build it is on screen
    putB.classList.toggle('btn-go', S.view !== 'plan');
    putB.title = fits ? '' : `The library's grooves are in 4/4, and this song is in ${meter[0]}/${meter[1]}`;
  }
  barIn.addEventListener('change', () => { const v = Math.round(Number(barIn.value)); S.bar = v >= 1 ? v : null; syncBar(); });
  barsIn.addEventListener('change', () => { const v = Math.round(Number(barsIn.value)); S.bars = v >= 1 ? Math.min(64, v) : null; syncBar(); });
  for (const inp of [barIn, barsIn]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); put(); } });

  function put(id = S.groove, opts = {}) {
    const g = G.getGroove(id);
    if (!g) return null;
    stopHearing('put');
    const r = putGroove(app, { groove: g, track: opts.track, bar: opts.bar ?? putBar(), bars: opts.bars ?? putBars(g), by: 'you', under: 'cut' });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return r; }
    ui.toast(`${r.summary.replace(/ \(.*?\)\./, '.').replace(/\.$/, '')}.`, { action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    try { app.arranger?.show?.([r.clip], 'you'); } catch (e) { /* the arranger draws it anyway */ }
    return r;
  }

  /* ======================================================= hearing a groove */
  let A = null;   // { handle, track, start, end, loops, gen, groove }
  function passage(g, p, articulations = false) {
    const bpb = beatsPerBar(p.meter), tempo = p.tempo, seed = G.seedFrom('hear', g.id);
    const verse = G.groovesFor(g.style, 'verse')[0];
    const notes = [];
    const add = (gr, at, len, k, offset = 0) => { for (const n of G.realize(gr, { tempo, seed: seed + k, length: len, offset, articulations })) notes.push({ ...n, t: Math.round((n.t + at) * 10000) / 10000 }); };
    let len;
    if (g.part === 'fill') {
      // a bar and a half of the verse, the fill into the next downbeat, and the crash on it
      len = 2 * bpb + 1;
      const lead = 2 * bpb - g.length;
      if (verse) add(verse, 0, lead, 1);
      add(g, lead, g.length, 2);
      notes.push({ p: 49, t: 2 * bpb, d: 0.5, v: 0.96 }, { p: 36, t: 2 * bpb, d: 0.25, v: 0.9 });
    } else if (g.part === 'ending') {
      len = bpb + g.length;
      if (verse) add(verse, 0, bpb, 1);
      add(g, bpb, g.length, 2);
    } else {
      len = Math.max(g.part === 'intro' ? 2 * bpb : 4 * bpb, g.length * 2);
      add(g, 0, len, 1);
    }
    return { notes: notes.sort((a, b) => a.t - b.t || a.p - b.p), len };
  }
  async function hear(id = S.groove, { alone = S.alone } = {}) {
    const g = G.getGroove(id);
    if (!g) return { ok: false };
    if (id !== S.groove) selectGroove(id, { quiet: true });
    stopHearing('switch');
    const p = store.get();
    if (!(p.meter[0] === 4 && p.meter[1] === 4)) { ui.toast(`The library's grooves are in 4/4, and this song is in ${p.meter[0]}/${p.meter[1]}.`, { kind: 'bad' }); return { ok: false }; }
    if (!engine || engine.silent) { ui.toast('The audio engine isn\'t running in this browser, so nothing can play.', { kind: 'bad' }); return { ok: false }; }
    const bpb = beatsPerBar(p.meter);
    const start = (putBar() - 1) * bpb;
    // on the drum track it would go onto (its kit, its effects), else the kit that suits the style
    const t = targetTrack(app);
    const playable = (dev) => !!app.devices?.getDevice?.(dev) && !app.devices?.heldDevice?.(dev);
    const kit = G.kitFor(g.style, { studioA: studioA(app) });
    const instrument = t && playable(t.instrument.device) ? { device: t.instrument.device, params: { ...t.instrument.params } } : { device: kit.device, params: kit.params };
    const articulations = instrument.device === G.STUDIO_A;
    let { notes, len } = passage(g, p, articulations);
    // the loop, when it's on and the passage starts in it: the groove fills the loop and goes round until stopped
    const lp = p.loop;
    const inLoop = lp?.on && start >= lp.start - 1e-6 && start < lp.end - 1e-6 && G.MAIN_PARTS.includes(g.part);
    if (inLoop) { len = Math.min(16 * bpb, lp.end - start); notes = G.realize(g, { tempo: p.tempo, seed: G.seedFrom('hear', g.id), length: len, articulations }); }
    const inserts = t && playable(t.instrument.device) ? (t.inserts || []).filter((fx) => fx.on && playable(fx.device)).map((fx) => ({ device: fx.device, params: { ...fx.params }, on: true })) : [];
    const ops = [{ type: 'track.add', ref: 'hear', track: { name: `Hearing ${g.name}`.slice(0, 100), kind: 'instrument', color: t?.color || 'var(--c-1)', instrument, inserts, gain: t ? t.gain : 0, pan: t ? t.pan : 0, solo: !!alone, clips: [{ kind: 'notes', start, length: len, name: `${g.styleName}, ${g.name}`, notes }] } }];
    const muted = [], soloed = [];
    for (const x of p.tracks) {
      if (alone && x.solo) { ops.push({ type: 'track.set', track: x.id, patch: { solo: false } }); soloed.push(x.id); }
      if (!alone && isDrum(app, x) && !x.mute) { ops.push({ type: 'track.set', track: x.id, patch: { mute: true } }); muted.push(x.id); }
    }
    const handle = store.preview(ops, { by: 'you' });
    if (!handle.ok) { ui.toast(`Can't play that groove here: ${handle.error}`, { kind: 'bad' }); return { ok: false, error: handle.error }; }
    A = { handle, track: handle.created.hear, start, end: start + len, loops: inLoop, gen: null, groove: g.id, alone: !!alone, started: false };
    try { localStorage.setItem(HEARING_KEY, JSON.stringify({ song: p.id, track: A.track, muted, soloed, at: Date.now() })); } catch (e) { /* storage blocked: the release still happens */ }
    syncBar();
    const mine = A;
    try {
      await engine.start?.();
      await engine.settled?.();
      if (A !== mine) return { ok: false };
      await engine.play(start);
      mine.gen = engine.gen ?? null;
      mine.started = true;
    } catch (e) { ui.toast('Audio could not start: ' + e.message, { kind: 'bad' }); stopHearing('error'); return { ok: false }; }
    ui.announce?.(`Hearing ${g.styleName}, ${g.name}${alone ? ', alone' : ', in the song'}, from bar ${putBar()}.`);
    return { ok: true, track: mine.track, start, end: mine.end };
  }
  function stopHearing(why = null) {
    const a = A;
    if (!a) return;
    A = null;
    let rel = null;
    if (why !== 'load') rel = a.handle.release();
    if (rel && rel.ok === false) ui.toast('Part of that groove couldn\'t be taken back out: the song changed while it played.', { kind: 'bad' });
    if (a.started && engine?.playing && why !== 'stopped' && (a.gen == null || engine.gen == null || engine.gen === a.gen)) { try { engine.stop({ live: false }); } catch (e) { /* stopped already */ } }
    // the autosave writes the song half a second after a change: keep the record until the song it saves is clean
    if (why !== 'unload') setTimeout(() => { if (!A) { try { localStorage.removeItem(HEARING_KEY); } catch (e) { /* storage blocked */ } } }, 900);
    syncBar();
  }

  /* ======================================================= tap to find */
  let lastTap = 0, padFlash = new Map();
  function tap(voice, ms = performance.now()) {
    if (S.found && S.view === 'taps' && ms - lastTap > 4000) { S.taps = []; S.found = null; }
    if (ms - lastTap > 4000) S.taps = [];
    S.taps.push({ t: ms / 1000, voice });
    lastTap = ms;
    S.armed = true;
    padFlash.set(voice, performance.now());
    // the sound of the pad, on the drum track the groove would go onto (or the one being heard)
    const pd = PAD.find((x) => x.voice === voice);
    const tr = A?.track || targetTrack(app)?.id;
    if (tr && pd) { try { engine.audition?.(tr, pd.p, 0.85, 0.25); } catch (e) { /* no sound yet */ } }
    syncTaps();
  }
  function find() {
    if (S.taps.length < 3) { syncTaps('Tap at least three hits first: two bars or so is best.'); return null; }
    const m = G.matchTaps(S.taps, { limit: 5 });
    if (!m) { syncTaps('Those taps are too close together to read a tempo from. Tap two bars or so.'); return null; }
    S.found = m; S.view = 'taps';
    renderStyles(); renderList();
    if (m.results[0]) selectGroove(m.results[0].groove.id, { quiet: true });
    syncTaps();
    ui.announce?.(`${m.results.length} grooves close to your taps; the closest is ${m.results[0]?.groove.styleName}, ${m.results[0]?.groove.name}.`);
    return m;
  }
  function clearTaps() {
    S.taps = []; S.found = null; lastTap = 0;
    if (S.view === 'taps') { S.view = 'style'; renderStyles(); renderList(); }
    syncTaps();
  }
  function syncTaps(say = null) {
    const n = S.taps.length;
    const est = n >= 3 ? G.tempoFromTaps(S.taps.map((x) => x.t)) : null;
    tapSay.textContent = say || (S.found ? `${S.found.taps} taps at about ${Math.round(S.found.bpm)} BPM. Tap again to look for another.`
      : n ? `${n} tap${n === 1 ? '' : 's'}${est ? `, about ${Math.round(est.bpm)} BPM` : ''}. It looks once you stop.`
        : `Tap two bars or so: kick, snare and hat, or the keys F J K${S.armed ? '' : ' once a pad has been tapped'}.`);
    findB.disabled = n < 3;
    clearB.disabled = !n && !S.found;
    dirty = true;
  }
  function drawStrip() {
    if (!strip.w) return;
    const { g, w: W, h: H } = strip, pal = palette();
    g.clearRect(0, 0, W, H);
    g.fillStyle = pal.line; g.fillRect(0, H - 1, W, 1);
    const taps = S.taps;
    if (!taps.length) return;
    const t0 = taps[0].t;
    const est = taps.length >= 3 ? G.tempoFromTaps(taps.map((x) => x.t)) : null;
    const beat = est ? 60 / est.bpm : 0.5;
    const span = Math.max(8 * beat, taps[taps.length - 1].t - t0 + beat);
    if (est) { g.fillStyle = rgba(pal.text3, 0.35); for (let b = 0; b * beat <= span; b++) { const x = 4 + (b * beat / span) * (W - 8); g.fillRect(Math.round(x), b % 4 ? H - 6 : H - 10, 1, b % 4 ? 5 : 9); } }
    // the person's taps: warm ink, a row per pad
    const rowY = { hat: 4, snare: 10, kick: 16, other: 10 };
    g.fillStyle = pal.human;
    for (const x of taps) { const px = 4 + ((x.t - t0) / span) * (W - 8); g.fillRect(Math.round(px) - 1, rowY[x.voice] ?? 10, 3, 6); }
  }

  /* ======================================================= the whole song */
  // the drum tracks that keep playing beside a built one (core/grooves.js leaves them as they are)
  const otherKits = (but = null) => store.get().tracks.filter((t) => isDrum(app, t) && !t.mute && t.id !== but).map((t) => t.name);
  function syncBuild() {
    const s = lib.styles.find((x) => x.id === S.style);
    const p = store.get(), bpb = beatsPerBar(p.meter);
    const n = (p.sections || []).filter((x) => x.length >= bpb - 1e-6).length;
    const loops = G.songLoops(p);
    const end = S.ending === true || (S.ending == null && !loops) ? 'and an ending' : `and no ending${loops ? ', so the loop goes round' : ''}`;
    const onLoop = p.loop?.on && p.loop.end - p.loop.start >= bpb - 1e-6;
    buildSay.textContent = n >= 2 ? `A new drum track in ${s.name}, a clip for each of the ${n} sections: their grooves, fills where they change, a crash on each new one ${end}.`
      : n === 1 ? `A new drum track in ${s.name} for the song's one section: its groove, a crash on its downbeat ${end}.`
        : `A new drum track in ${s.name} over ${onLoop ? 'the loop' : 'the whole song'}, as one section, since the song has none yet: a groove ${end}.`;
    buildB.disabled = !(p.meter[0] === 4 && p.meter[1] === 4);
  }
  const planOpts = (dryRun) => ({ style: S.style, parts: S.parts, ending: S.ending, by: 'you', dryRun });
  function showPlan() {
    stopHearing('plan');
    const opening = S.view !== 'plan';
    const r = buildDrums(app, planOpts(true));
    S.plan = r; S.view = 'plan';
    renderStyles(); renderList(); syncBar();
    if (opening) planInView();
    return r;
  }
  function replan() { S.plan = buildDrums(app, planOpts(true)); renderList(); }
  // The plan opens with its first sentence at the top of what scrolls, under the pinned bar (Build is at the bottom
  // of a phone's column, so the plan would otherwise open above the screen). Only boxes inside the tab move.
  function planInView() {
    const el = list.querySelector('.gv-plan');
    for (let box = el?.parentElement; box; box = box === root ? null : box.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(box).overflowY) || box.scrollHeight <= box.clientHeight + 1) continue;
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    }
  }
  // How the drums end: the style's ending, or none so the loop goes round (the default when the song loops)
  function setEnding(on) { S.ending = !!on; replan(); syncBuild(); }
  function renderPlan() {
    const r = S.plan;
    if (!r || !r.ok) {
      list.replaceChildren(h('div.empty', h('p', r?.error ? `${r.error[0].toUpperCase()}${r.error.slice(1)}.` : 'Nothing to plan.'), h('button.btn', { type: 'button', onclick: () => { S.view = 'style'; renderStyles(); renderList(); syncBar(); } }, 'Back to the styles')));
      return;
    }
    const endName = G.groovesFor(r.plan.style, 'ending')[0]?.name, ends = !!r.plan.ending;
    const others = otherKits();
    const rows = r.plan.sections.map((sec) => h('li.gv-planrow',
      h('span.where', sec.bars[1] > sec.bars[0] ? `${sec.bars[0]}–${sec.bars[1]}` : `${sec.bars[0]}`),
      h('span.what', sec.name),
      h('button.btn.btn-txt.gv-partbtn', { type: 'button', title: 'Which part this section is (click for the next)', 'aria-label': `${sec.name} plays the ${PLAN_WORD[sec.part === 'outro' ? 'outro' : sec.plays] || sec.plays} groove; change it`, onclick: () => cyclePart(sec) }, `${PLAN_WORD[sec.part] || sec.plays}${sec.part !== sec.plays && sec.part !== 'outro' ? ` (${G.PART_LABEL[sec.plays].toLowerCase()})` : ''}`),
      h('span.gv-plangroove', sec.grooveName),
      h('span.where', [sec.fill ? `fill at ${sec.fill.bar}` : null, sec.ending ? `ending ${sec.ending.bars[1] > sec.ending.bars[0] ? `${sec.ending.bars[0]}–${sec.ending.bars[1]}` : sec.ending.bars[0]}` : null, sec.crash ? 'crash' : null].filter(Boolean).join(', '))));
    // the end of the song, after its sections: the style's ending, or none so the loop goes round
    const endChoice = endName ? h('div.gv-planend', { role: 'group', 'aria-label': 'How the drums end' },
      h('span.gv-planendhead', 'At the end'),
      h('button.tog.gv-end', { type: 'button', 'aria-pressed': String(ends), dataset: { end: 'ending' }, onclick: () => setEnding(true) }, `End with ${endName}`),
      h('button.tog.gv-end', { type: 'button', 'aria-pressed': String(!ends), dataset: { end: 'loop' }, onclick: () => setEnding(false) }, 'Loop it, no ending')) : null;
    // a second kit plays beside the first until one is muted (the summary says so): say how
    const kits = others.length ? h('p.gv-plannote.t3', others.length === 1 ? 'To hear one kit alone, press M on the other\'s track header.' : 'To hear one kit alone, press M on the other kits\' track headers.') : null;
    list.replaceChildren(h('div.gv-plan',
      h('p.gv-plansay', r.summary),
      kits,
      h('ol.ledger.gv-planrows', rows),
      endChoice,
      h('div.gv-planacts', h('button.btn.btn-go.gv-buildit', { type: 'button', onclick: () => build() }, 'Build it'), h('button.btn.btn-txt', { type: 'button', onclick: () => { S.view = 'style'; S.plan = null; renderStyles(); renderList(); syncBar(); } }, 'Not now'))));
  }
  function cyclePart(sec) {
    const cur = PLAN_PARTS.indexOf(sec.part);
    S.parts = { ...S.parts, [sec.id || sec.name]: PLAN_PARTS[(cur + 1) % PLAN_PARTS.length] };
    showPlan();
  }
  function build() {
    const r = buildDrums(app, planOpts(false));
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return r; }
    S.view = 'style'; S.plan = null;
    renderStyles(); renderList(); syncBar();
    const others = otherKits(r.track.id);
    const still = others.length === 1 ? ` ${others[0]} still plays: M on its header mutes it.` : others.length ? ` ${others.length} other kits still play: M on a track's header mutes it.` : '';
    ui.toast(`Drums for the song: ${lib.styles.find((s) => s.id === r.style)?.name || r.style} on ${r.track.name}, ${r.clips.length} clip${r.clips.length === 1 ? '' : 's'}, one per section${r.plan.ending ? '' : ', no ending'}.${still}`, { kind: 'ok', ms: 9000, action: { label: 'Undo', run: () => store.undo({ by: 'you' }) } });
    try { app.arranger?.show?.(r.clips.map((c) => c.clip), 'you'); } catch (e) { /* drawn anyway */ }
    return r;
  }

  /* ======================================================= dragging a groove onto the arranger */
  let drag = null;   // { g, id, x, y, on, ghost, timer, touch }
  function dragFrom(rowEl, g) {
    rowEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { g, id: e.pointerId, x: e.clientX, y: e.clientY, on: false, ghost: null, touch: e.pointerType === 'touch', held: false, timer: 0, el: rowEl };
      // a finger holds a moment first, so a drag can still scroll the list
      if (drag.touch) { const d = drag; d.timer = setTimeout(() => { if (drag === d) { d.held = true; try { navigator.vibrate?.(10); } catch (err) { /* no buzz */ } } }, 320); }
    });
    rowEl.addEventListener('pointermove', (e) => {
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6;
      if (!d.on) {
        if (!far) return;
        if (d.touch && !d.held) { clearTimeout(d.timer); drag = null; return; }   // a swipe: the list scrolls
        d.on = true;
        try { rowEl.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        d.ghost = h('div.gv-ghost', { role: 'presentation' }, `${g.styleName}, ${g.name}`);
        document.body.append(d.ghost);
      }
      e.preventDefault();
      const at = where(e.clientX, e.clientY);
      d.ghost.textContent = at ? `${g.styleName}, ${g.name}: bar ${at.bar}, ${at.trackName}` : `${g.styleName}, ${g.name}`;
      d.ghost.style.left = `${Math.min(window.innerWidth - 20, e.clientX + 12)}px`;
      d.ghost.style.top = `${Math.max(8, e.clientY - 30)}px`;
    });
    const end = (e) => {
      const d = drag;
      if (!d || e.pointerId !== d.id) return;
      clearTimeout(d.timer);
      drag = null;
      if (!d.on) return;
      d.ghost?.remove();
      if (e.type === 'pointercancel') return;
      const at = where(e.clientX, e.clientY);
      if (!at) return;
      // (the click that follows a drag isn't a selection)
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      rowEl.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => rowEl.removeEventListener('click', swallow, { capture: true }), 0);
      selectGroove(g.id, { quiet: true });
      put(g.id, { bar: at.bar, track: at.track || null });
    };
    rowEl.addEventListener('pointerup', end);
    rowEl.addEventListener('pointercancel', end);
  }
  // where a drop lands in the arranger: its bar, and the drum track there (a track that isn't drums, or none, is a new one)
  function where(x, y) {
    const at = app.arranger?.locate?.(x, y);
    if (!at) return null;
    const p = store.get(), bpb = beatsPerBar(p.meter);
    const t = p.tracks.find((tr) => tr.id === at.track);
    const drum = isDrum(app, t) ? t : null;
    return { bar: Math.floor(at.beat / bpb + 1e-6) + 1, track: drum ? drum.id : null, trackName: drum ? drum.name : 'a new Drums track' };
  }

  /* ======================================================= keys */
  const mine = () => ui.visible('grooves');
  const armed = () => mine() && S.armed && ui.state.focus === 'grooves';
  const offs = [
    ...PAD.map((pd) => ui.keys.add({ key: pd.key, when: armed, first: true, run: (e) => { if (!e.repeat) tap(pd.voice, e.timeStamp); }, label: `Tap to find: ${pd.label}`, group: 'Grooves' })),
    ui.keys.add({ key: 'Escape', when: () => !!A && mine(), first: true, run: () => stopHearing('key'), label: 'Stop hearing the groove', group: 'Grooves' }),
    // (F J K go back to what they do elsewhere: K is the click)
    ui.keys.add({ key: 'Escape', when: () => !A && armed(), first: true, run: () => { S.armed = false; syncTaps(); ui.announce?.('The pads are put down: F, J and K do what they do elsewhere again.'); }, label: 'Put the tap pads down', group: 'Grooves' }),
  ];

  /* ======================================================= events */
  const offEngine = engine?.on?.('transport', (e) => { if (A && e.why === 'stop') stopHearing('stopped'); }) || null;
  const offSilence = engine?.on?.('silence', () => { if (A) stopHearing('stopped'); }) || null;
  const offTool = ui.on('agent:tool', (e) => { if (e?.phase === 'start' && A) stopHearing('agent'); });
  const offShow = ui.on('show', ({ id, region }) => { if (region === 'bottom' && id !== 'grooves' && A) stopHearing('tab'); });
  const offSel = ui.on('select', () => syncBar());
  const offPlaced = ui.on('grooves:placed', (e) => { S.last = { ...e, kind: 'placed' }; syncLast(); });
  const offBuilt = ui.on('grooves:built', (e) => { S.last = { ...e, kind: 'built' }; syncLast(); });
  const onHide = () => { if (A) stopHearing('unload'); };
  window.addEventListener('pagehide', onHide);
  function syncLast() {
    const L = S.last;
    if (!L) { lastLine.hidden = true; return; }
    const g = L.groove ? G.getGroove(L.groove) : null;
    const what = L.kind === 'built' ? `Drums for the song, ${G.getStyle(L.style)?.name || L.style}` : g ? `${g.styleName}, ${g.name}${L.bars ? `, ${L.bars[1] > L.bars[0] ? `bars ${L.bars[0]}–${L.bars[1]}` : `bar ${L.bars[0]}`}` : ''}` : 'A groove';
    lastLine.replaceChildren('Last in the song: ', what, ', by ', byline(L.by, { app }) || 'the studio', '.');
    lastLine.hidden = false;
  }
  function onChange(evt) {
    // a new song: the plan and what the person changed in it were the old song's
    if (evt.kind === 'load') { if (A) stopHearing('load'); S.plan = null; S.parts = {}; S.ending = null; if (S.view === 'plan') S.view = 'style'; renderStyles(); renderList(); syncBar(); syncBuild(); return; }
    if (evt.kind === 'preview') return;
    // an edit to the track being heard (or a structural one) ends the hearing first, so its release stays exact
    if (A && (evt.kind === 'do' || evt.kind === 'undo' || evt.kind === 'redo')) {
      const tch = touched(evt);
      if (tch.tracks.has(A.track) || [...tch.clips].some((c) => store.findClip(c)?.track.id === A.track) || evt.ops?.some((o) => o.type === 'track.remove' || o.type === 'track.move')) stopHearing('edit');
    }
    if (S.view === 'plan') replan();
    syncBar(); syncBuild();
  }

  /* ======================================================= drawing */
  const picCache = new Map();
  function notesFor(g, tempo) {
    const k = `${g.id}@${tempo}`;
    if (!picCache.has(k)) { if (picCache.size > 400) picCache.clear(); picCache.set(k, G.realize(g, { tempo, human: 0 })); }
    return picCache.get(k);
  }
  function drawPic({ c, g, sel }) {
    c.fit();
    const { g: x, w: W, h: H } = c, pal = palette();
    x.clearRect(0, 0, W, H);
    if (W < 4) return;
    const ink = sel ? pal.bg : pal.text, pencil = sel ? rgba(pal.bg, 0.45) : rgba(pal.text3, 0.55), rule = sel ? rgba(pal.bg, 0.22) : rgba(pal.text3, 0.22);
    const L = g.length, x0 = 3;
    const ppb = (W - 6) / Math.max(4, L);   // a bar fills the picture (a two-bar groove fits in it); a one-beat fill is a quarter
    // hairlines: the three lanes (cymbals, snare and toms, kick) and a tick per beat, a taller one per bar
    const yC = H * 0.24, yS = H * 0.52, yK = H * 0.8;
    x.fillStyle = rule;
    for (const y of [yC, yS, yK]) x.fillRect(x0, Math.round(y), L * ppb, 1);
    for (let b = 0; b <= L + 1e-6; b++) { const bx = Math.round(x0 + b * ppb); x.fillStyle = b % 4 === 0 ? pencil : rule; x.fillRect(bx, b % 4 === 0 ? 2 : H * 0.18, 1, b % 4 === 0 ? H - 4 : H * 0.7); }
    const TOM_Y = { 50: 0.58, 48: 0.62, 47: 0.66, 45: 0.7, 43: 0.74, 41: 0.76 };
    for (const n of notesFor(g, store.get().tempo)) {
      const px = x0 + n.t * ppb, s = Math.min(ppb * 0.42, 3 + n.v * 6), ghost = n.v < 0.5, fam = G.familyOf(n.p);
      x.strokeStyle = ink; x.fillStyle = ink; x.lineWidth = 1.25;
      const sq = (y, hollow) => { const r = s / 2; if (hollow) { x.strokeRect(Math.round(px - r) + 0.5, Math.round(y - r) + 0.5, Math.max(2, Math.round(s) - 1), Math.max(2, Math.round(s) - 1)); } else x.fillRect(Math.round(px - r), Math.round(y - r), Math.max(2, Math.round(s)), Math.max(2, Math.round(s))); };
      const cross = (y, r) => { x.beginPath(); x.moveTo(px - r, y - r); x.lineTo(px + r, y + r); x.moveTo(px + r, y - r); x.lineTo(px - r, y + r); x.stroke(); };
      if (fam === 'kick') sq(yK, ghost);
      else if (n.p === 37) { x.beginPath(); x.moveTo(px - s / 2, yS + s / 2); x.lineTo(px + s / 2, yS - s / 2); x.stroke(); }
      else if (fam === 'snare') sq(yS, ghost);
      else if (fam === 'tom') sq(H * (TOM_Y[n.p] || 0.66), ghost);
      else if (n.p === 46) { cross(yC, s / 2.4); x.strokeRect(Math.round(px - 1.5) + 0.5, Math.round(yC - s / 2 - 4) + 0.5, 3, 3); }
      else if (fam === 'hat') cross(yC, s / 2.4);
      else if (n.p === 53) { x.beginPath(); x.moveTo(px, yC - s / 2); x.lineTo(px + s / 2, yC); x.lineTo(px, yC + s / 2); x.lineTo(px - s / 2, yC); x.closePath(); ghost ? x.stroke() : x.fill(); }
      else if (fam === 'ride') { x.beginPath(); x.moveTo(px - s / 2, yC); x.lineTo(px + s / 2, yC); x.moveTo(px, yC - s / 2); x.lineTo(px, yC + s / 2); x.stroke(); }
      else if (fam === 'cymbal') { cross(yC, s / 2); x.fillRect(Math.round(px - s / 2), Math.round(yC - s / 2 - 2), Math.round(s), 1.5); }
      else x.fillRect(Math.round(px - s / 2), Math.round(yC + 3), Math.max(2, Math.round(s)), 1.5);
    }
  }
  function frame(now) {
    const resized = strip.fit();
    // the pads light while they sound
    for (const pd of PAD) {
      const at = padFlash.get(pd.voice), on = at != null && now - at < 110;
      const b = pads.querySelector(`[data-voice="${pd.voice}"]`);
      if (b && b.classList.contains('hit') !== on) b.classList.toggle('hit', on);
      if (!on && at != null && now - at > 200) padFlash.delete(pd.voice);
    }
    // the taps stop: look them up
    if (S.taps.length >= 4 && !S.found && lastTap && performance.now() - lastTap > FIND_AFTER) find();
    // the heard passage ends at its last bar (unless the loop holds it)
    if (A && A.started && !A.loops && engine.playing && (engine.gen == null || A.gen == null || engine.gen === A.gen) && engine.beat > A.end + 0.25) stopHearing('end');
    if (A && A.started && !engine.playing) stopHearing('stopped');
    // the bar field follows the playhead until it's set by hand
    if (S.bar == null && document.activeElement !== barIn) { const b = String(playheadBar(app)); if (barIn.value !== b) barIn.value = b; }
    if (dirty || resized) { for (const p of pics) drawPic(p); drawStrip(); dirty = false; }
  }
  const offResize = ui.on('resize', () => { dirty = true; });

  renderStyles(); renderList(); syncBar(); syncTaps(); syncBuild(); syncLast();

  app.grooves = {
    select: (id) => selectGroove(id),
    style: (id) => pickStyle(id),
    hear: (id, opts) => hear(id ?? S.groove, opts),
    stop: () => stopHearing('api'),
    hearing: () => (A ? { track: A.track, groove: A.groove, start: A.start, end: A.end, alone: A.alone, loops: A.loops } : null),
    put: (id, opts) => put(id ?? S.groove, opts || {}),
    tap: (voice, ms) => tap(voice, ms),
    find, clearTaps,
    taps: () => S.taps.slice(),
    results: () => (S.found ? S.found.results.map((r) => ({ id: r.groove.id, score: r.score, matched: r.matched, of: r.of })) : null),
    plan: () => showPlan(), build,
    view: () => S.view,
    selected: () => S.groove,
  };
  return {
    update: onChange,
    frame,
    refresh() { dirty = true; syncBar(); syncBuild(); },
    unmount() {
      stopHearing('tab');
      offs.forEach((f) => f()); offEngine?.(); offSilence?.(); offTool(); offShow(); offSel(); offPlaced(); offBuilt(); offResize();
      window.removeEventListener('pagehide', onHide);
    },
  };
}

// One column that scrolls, the styles a row of words: a phone upright (the pane under 640 px wide), or any short touch
// screen (a phone on its side), which the width alone doesn't catch.
const ONE_COLUMN = `
  .gv-body { display: block; overflow: auto; overscroll-behavior: contain; }
  .gv-styles { display: flex; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: var(--rule); padding: 0 4px; scrollbar-width: none; }
  .gv-style { flex: none; width: auto; padding: 0 12px; align-items: center; }
  .gv-list { overflow: visible; padding: 0 10px 10px; }
  .gv-row { --ledger-cols: minmax(110px, 1fr) minmax(110px, 46%); min-height: 52px; }
  .gv-side { border-left: 0; border-top: var(--rule); overflow: visible; }
  .gv-pad { height: 60px; }
  .gv-meta { display: none; }
  .gv-planrows { --ledger-cols: 48px minmax(80px, 1fr) minmax(90px, auto); }
  .gv-plangroove, .gv-planrows > li > .where:last-child { grid-column: 2 / -1; }
`;
const CSS = `
.gv { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; min-height: 0; background: var(--panel); container: gv / inline-size; }
.gv-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 16px; padding: 6px 12px; border-bottom: var(--rule); min-width: 0; }
.gv-head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.gv-title { font-size: 19px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 6em; }
.gv-meta { color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 0; }
.gv-acts { display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap; justify-content: flex-end; }
.gv-putwrap { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.gv-at, .gv-for { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); }
.gv-for[hidden] { display: none; }
.gv-num { width: 52px; height: 28px; padding: 0 6px; border: var(--rule-2); border-radius: var(--r-press); background: none; color: var(--text); font: 600 12.5px var(--font-mono); }
.gv-num:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.gv-on { font-size: 12.5px; white-space: nowrap; }
.gv-body { display: grid; grid-template-columns: 176px minmax(0, 1fr) 296px; min-height: 0; }
.gv-styles { overflow: auto; border-right: var(--rule); padding: 4px 0; }
.gv-style { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; width: 100%; min-height: 30px; padding: 5px 12px; border: 0; border-radius: 0; background: none; color: var(--text-2); font: 600 13px var(--font-ui); text-align: left; cursor: pointer; }
.gv-style:hover { background: var(--bg-3); color: var(--text); }
.gv-style.sel { background: var(--text); color: var(--bg); }
.gv-style.sel .gv-stempo { color: var(--bg); }
.gv-stempo { font-size: 11px; color: var(--text-3); }
.gv-style:focus-visible, .gv-row:focus-visible, .gv-pad:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.gv-list { overflow: auto; padding: 0 14px 14px; min-width: 0; }
.gv-listhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; padding: 10px 0 6px; font-size: 13.5px; font-weight: 600; color: var(--text); }
.gv-listhead .t3 { font-weight: 400; font-size: 12.5px; }
.gv-listhead .btn-txt { margin-left: auto; }
.gv-part { padding: 12px 0 3px; font-size: 12px; font-weight: 600; border-bottom: var(--rule); }
.gv-row { --ledger-cols: minmax(120px, 1fr) minmax(140px, 300px) 64px; align-items: center; width: 100%; min-height: 40px; padding: 2px 6px; border: 0; border-bottom: var(--rule); border-radius: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.gv-name { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.gv-gname { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gv-feel { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gv-why { font-size: 11.5px; line-height: 1.35; overflow-wrap: anywhere; }   /* a found groove's score wraps, whole */
.gv-row.sel .gv-feel, .gv-row.sel .gv-why, .gv-row.sel .gv-tempo { color: var(--bg); }
.gv-pic { display: block; width: 100%; height: 38px; }
.gv-tempo { text-align: right; font-size: 11px; }
.gv-side { display: flex; flex-direction: column; gap: 14px; padding: 10px 14px 14px; border-left: var(--rule); overflow: auto; min-width: 0; }
.gv-side section { display: flex; flex-direction: column; gap: 8px; }
.gv-pads { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.gv-pad { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; height: 52px; border: var(--rule-2); border-radius: var(--r-press); background: none; color: var(--text); font: 600 13px var(--font-ui); cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.gv-pad:hover { border-color: var(--text-3); }
.gv-pad.hit { background: var(--text); color: var(--bg); border-color: var(--text); }
.gv-pad.hit kbd { color: var(--bg); border-color: var(--bg); }
.gv-stripwrap { position: relative; height: 24px; }
.gv-strip { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gv-tapsay, .gv-buildsay { margin: 0; font-size: 12.5px; line-height: 1.45; }
.gv-tapacts { display: flex; align-items: center; gap: 12px; }
.gv-last { margin: 0; font-size: 12px; line-height: 1.45; }
.gv-last[hidden] { display: none; }
.gv-plan { display: flex; flex-direction: column; gap: 10px; padding: 12px 0; max-width: 860px; }
.gv-plansay { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text); }
.gv-planrows { --ledger-cols: 56px minmax(80px, 1fr) minmax(100px, auto) minmax(110px, 1fr) minmax(80px, auto); }
.gv-planrows > li { align-items: center; padding: 4px 0; }
.gv-plangroove { font-size: 12.5px; color: var(--text-2); }
.gv-partbtn { justify-self: start; min-height: 30px; }
.gv-plannote { margin: 0; font-size: 12.5px; line-height: 1.45; }
.gv-planend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.gv-planendhead { font-size: 12.5px; color: var(--text-2); margin-right: 4px; }
.gv-planacts { display: flex; align-items: center; gap: 14px; }
.gv-ghost { position: fixed; z-index: 950; pointer-events: none; padding: 5px 9px; background: var(--bg-3); border: var(--rule-2); box-shadow: var(--shadow-2); color: var(--text); font: 600 12.5px var(--font-ui); white-space: nowrap; }
/* a pane under 1180 px: the title over the actions */
@container gv (max-width: 1180px) {
  .gv-bar { grid-template-columns: minmax(0, 1fr); }
  .gv-acts { justify-content: flex-start; }
}
/* under 1000 px: narrower columns either side of the list */
@container gv (max-width: 1000px) {
  .gv-body { grid-template-columns: 136px minmax(0, 1fr) 232px; }
  .gv-stempo, .gv-tempo { display: none; }
  .gv-row { --ledger-cols: minmax(110px, 1fr) minmax(130px, 240px); }
  .gv-pad { height: 48px; }
}
/* under 640 px (a phone): one column that scrolls; the styles are a row of words */
@container gv (max-width: 640px) {${ONE_COLUMN}}
/* a short touch screen (a phone on its side, where the sheet is about 150 px tall): the same one column, by height,
   and the whole tab scrolls, its bar too, since pinning the bar would leave the grooves a sliver */
@media (max-height: 500px) and (pointer: coarse) {${ONE_COLUMN}
  .gv { display: block; overflow-y: auto; overscroll-behavior: contain; }
  .gv-body { overflow: visible; }
}
/* FALLBACK until ui/shell.js takes it: on a phone the detail tabs share the width equally, and with this seventh tab
   that cut "Reference" to "Refere…". Sized by their words instead (never under 44 px), they all fit whole at 390 px. */
@media (max-width: 900px) {
  .ew-shell .ew-region-bottom > .ew-tabs > .ew-tab { flex: 1 1 auto; min-width: 44px; }
}
/* a phone or a tablet (the shell's breakpoint), or any short touch screen: 44 px targets, nothing under 12 px */
@media (max-width: 900px), (max-height: 500px) and (pointer: coarse) {
  .ew-shell .gv .btn, .ew-shell .gv .tog { height: 44px; }
  .ew-shell .gv .btn-txt { min-height: 44px; min-width: 44px; }
  .ew-shell .gv .where { font-size: 12px; }
  .ew-shell .gv .gv-num { height: 44px; width: 64px; font-size: 16px; }
  .ew-shell .gv .gv-style, .ew-shell .gv .gv-row, .ew-shell .gv .gv-partbtn { min-height: 44px; }
  .ew-shell .gv .gv-at, .ew-shell .gv .gv-for, .ew-shell .gv .gv-on, .ew-shell .gv .gv-tapsay, .ew-shell .gv .gv-buildsay, .ew-shell .gv .gv-last, .ew-shell .gv .gv-plannote, .ew-shell .gv .gv-planendhead { font-size: 13px; }
  .ew-shell .gv .gv-feel, .ew-shell .gv .gv-why, .ew-shell .gv .gv-stempo, .ew-shell .gv .gv-tempo, .ew-shell .gv .gv-meta, .ew-shell .gv kbd { font-size: 12px; }
  .ew-shell .gv .gv-title { font-size: 17px; }
}
`;
