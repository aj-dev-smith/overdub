// The simple view [simple]: the same studio with what you're not using put away, and everything one reach away
// (app/src/ui/workspace.js, the registry and ui.workspace; app/src/ui/workspace-view.js, which view a load opens in).
// Clean storage and ?view=simple (the checks run under navigator.webdriver, which otherwise keeps the full studio):
//   - decideView in Node: the URL beats what's saved, saved beats webdriver, webdriver gives full, a browser that has
//     used the studio gets full, a clean one simple (those two written down); a storage that throws is survived
//   - the registry: its ids, groups, titles and purposes are the ones in the spec, word for word
//   - the first screen at 1440x900: 30 or fewer controls on screen, no jargon (API key, MCP, LUFS, −∞, Inspector,
//     Reference), "Take 1 is yours." on a blank song, nothing playing, no tab strip, no welcome card, no coach
//   - a phone (390x844): 18 or fewer controls, the blank sheet's doors full width and nothing over them
//   - Full studio and back: 13 tabs, the choice survives a reload (and beats webdriver), the song never changes
//   - reach is reveal: L brings the Loop in with a note, ui.show('mixer') the Mixer, both signed by you and kept over a
//     reload; B on an empty left pane brings the Browser; a layout change is never an undo step
//   - More: search finds Notes for "piano", Add and Put away, no region left on a put-away panel, Esc gives focus back
//   - the workspace tool: signed notes, refusals (their adds, their view, while they record, an unknown id), list,
//     get_selection's studio, a no-op in full; a ui.show inside a tool run is the agent's, not yours
//   - hidden means gone: tabbing the top bar never lands on a put-away part
//   - the demo agent: "where is the mixer" brings the Mixer in, signed by the agent, in one line
//   - a person's browser (no webdriver): a clean one opens simple and writes it down; one that has used the studio full
//   node tools/simple-test.js      (screenshots: tools/.out/simple-*.png)
import fs from 'node:fs';
import path from 'node:path';
import { open, tally, OUTDIR } from './pw.js';

const T = tally('simple');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) => /favicon|ERR_CONNECTION|net::|AudioContext was not allowed|fonts\.g|Failed to load resource|getUserMedia|NotAllowedError|NotFoundError/i.test(e);
const KEY = 'overdub:workspace';
// a section that throws is a failure with its reason, and the rest still run
const section = async (name, fn) => { try { await fn(); } catch (e) { T.ok(false, `${name}: ran to the end (${String(e && e.stack || e).split('\n').slice(0, 3).join(' ')})`); } };

/* ======================================================================== the spec's registry, word for word */
const SPEC = [
  ['Make', 'notes', 'Notes', 'Edit a part\'s notes one by one.'],
  ['Make', 'beat', 'Beat grid', 'Click a drum pattern in, square by square.'],
  ['Make', 'grooves', 'Grooves', 'Drum patterns by style, ready to drop in.'],
  ['Make', 'jam', 'Guitar', 'The Jam room: play guitar over the song, with tab and amps.'],
  ['Sound', 'devices', 'Sound', 'The instrument and effects on a track, and their knobs.'],
  ['Sound', 'browser', 'Instruments and effects', 'Every instrument, effect and guitar rig, to try or add.'],
  ['Balance', 'mixer', 'Mixer', 'How loud each part is, and where it sits left to right.'],
  ['Balance', 'compare', 'Compare', 'Hold your mix up against a track you like.'],
  ['Balance', 'meters', 'Level meter', 'How loud the whole song is playing, and All off.'],
  ['Song', 'loop', 'Loop', 'Play a few bars round and round.'],
  ['Song', 'position', 'Where you are', 'Bar and beat of the playhead, and the beat lights.'],
  ['Song', 'song-settings', 'Song settings', 'Beats per bar, tap the tempo, the click.'],
  ['Song', 'tracks', 'Track tools', 'Add tracks, snap, zoom, and colours.'],
  ['Song', 'redo', 'Redo', 'Put back what Undo took away.'],
  ['Recording', 'record-options', 'Recording options', 'Count-in, layering takes, timing, and which track you record onto.'],
  ['Agent', 'history', 'History', 'Everything that changed, who changed it, and how to take it back.'],
  ['Agent', 'details', 'Details', 'Exact values for whatever is selected.'],
  ['Agent', 'agent-setup', 'Connect your own agent', 'Use your own Claude, or Claude Code on this computer.'],
  ['Files', 'files', 'Files and reports', 'Import MIDI, audio and devices; export stems, MIDI and DAWproject; who-made-what reports.'],
  ['Layout', 'panes', 'Pane buttons', 'Buttons to show and hide the side and bottom panes.'],
];
const PANEL_OF = { notes: 'pianoroll', beat: 'drumgrid', grooves: 'grooves', jam: 'jam', devices: 'rack', browser: 'browser', mixer: 'mixer', compare: 'reference', history: 'history', details: 'inspector' };
const curly = (s) => s.replace(/'/g, '’');   // the studio may set apostrophes curly
const same = (a, b) => a === b || a === curly(b);

/* ======================================================================== in the page */
// The controls a person sees: the inventory probe's rule (visible button, a, input, select, textarea and the
// button-like roles, in the viewport)
const controls = () => {
  const vis = (e) => {
    if (!e.getClientRects().length || e.closest('[inert]')) return false;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
  };
  return [...document.querySelectorAll('button, a[href], a[role], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [role=spinbutton]')].filter(vis)
    .map((e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || e.className || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 24));
};
// Words on screen (text nodes drawn in the viewport)
const screenText = () => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const t = n.textContent.trim(), el = n.parentElement;
    if (!t || !el || el.closest('script, style, [aria-hidden="true"], .sr-only, .ew-announce')) continue;
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    out.push(t);
  }
  return out;
};
// The workspace's top-bar buttons and its note, found by their words (workspace.js builds them in .ew-ws)
const wsBits = () => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  // the simple view's top bar, or, in the full studio with the agent pane open, the end of its tab row
  const btn = (re) => [...document.querySelectorAll('.ew-ws button, .ew-ws-side button')].find((b) => vis(b) && re.test(b.textContent.trim()));
  const more = btn(/^More$/), full = btn(/^Full studio$/), simple = btn(/^Simple view$/);
  const note = document.querySelector('.ew-ws [role=status]') || document.querySelector('.ew-top [role=status]');
  const x = (e) => (e ? Math.round(e.getBoundingClientRect().left) : null);
  return { ws: !!document.querySelector('.ew-ws'), more: !!more, full: !!full, simple: !!simple, moreX: x(more), switchX: x(full || simple), note: note ? note.textContent.trim().replace(/\s+/g, ' ') : null, noteAgent: note ? [...note.querySelectorAll('.by-agent')].map((b) => b.textContent) : [], noteBtn: !!note?.querySelector('button'), view: window.overdub.ui.workspace?.view?.() || null, root: [...document.querySelectorAll('.ws-simple, .ws-full')].map((e) => e.className.match(/ws-(simple|full)/)[1])[0] || null };
};
const visible = (sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0);
const visTabs = () => [...document.querySelectorAll('.ew-tab')].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').map((e) => e.id.replace('ew-tab-', ''));
// The More popover / sheet: the box around its search field (its nearest dialog, fixed or absolute ancestor), and
// what it says. (Self-contained: page.evaluate takes each function on its own.)
const moreInfo = () => {
  const inp = [...document.querySelectorAll('input')].find((i) => /^Find something/.test(i.placeholder || '') && i.getClientRects().length);
  if (!inp) return null;
  let b = inp.parentElement;
  while (b && b !== document.body && !(b.getAttribute('role') === 'dialog' || ['fixed', 'absolute'].includes(getComputedStyle(b).position))) b = b.parentElement;
  const r = b.getBoundingClientRect();
  return { text: b.innerText, r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], h: Math.round(r.height), focusIn: b.contains(document.activeElement),
    groups: ['Make', 'Sound', 'Balance', 'Song', 'Recording', 'Agent', 'Files', 'Layout'].filter((g) => new RegExp('(^|\\n)' + g + '(\\n|$)').test(b.innerText)),
    adds: [...b.querySelectorAll('button')].filter((x) => x.textContent.trim() === 'Add').length, agent: [...b.querySelectorAll('.by-agent')].map((x) => x.textContent) };
};
const clickTop = (re) => {   // a workspace button in the top bar, by its words
  const b = [...document.querySelectorAll('.ew-ws button, .ew-ws-side button')].find((x) => x.getClientRects().length && re.test(x.textContent.trim()));
  b?.click();
  return !!b;
};

/* ======================================================================== 10. decideView, in Node */
await section('decideView', async () => {
  let mod = null;
  try { mod = await import('../app/src/ui/workspace-view.js'); } catch (e) { T.ok(false, `app/src/ui/workspace-view.js loads in Node (${e.message})`); }
  const decideView = mod?.decideView;
  T.ok(typeof decideView === 'function', 'workspace-view.js exports decideView, a pure function Node can call');
  if (typeof decideView !== 'function') return;
  const mem = (init = {}) => {
    const data = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); }, key: (i) => [...data.keys()][i] ?? null, get length() { return data.size; } };
  };
  // every spelling of the inputs a pure decideView might take: it reads the ones it uses
  const dv = (search, storage, webdriver) => {
    const r = decideView({ search, params: new URLSearchParams(search), url: 'http://localhost/app/' + search, location: { search }, storage, localStorage: storage, webdriver, navigator: { webdriver } });
    // decideView is pure: it says whether to write the choice down (persist), and the boot writes it, as main.js does
    if (r && typeof r === 'object' && r.persist) {
      try { const cur = JSON.parse(storage.getItem(KEY) || 'null'); storage.setItem(KEY, JSON.stringify({ ...(cur && typeof cur === 'object' ? cur : {}), v: 1, view: r.view })); } catch (e) { /* blocked storage */ }
    }
    return typeof r === 'string' ? r : r?.view;
  };
  const saved = (s) => { try { return JSON.parse(s.getItem(KEY) || 'null'); } catch (e) { return 'unreadable'; } };

  const s1 = mem({ [KEY]: { v: 1, view: 'full', added: {} } });
  T.ok(dv('?view=simple', s1, false) === 'simple' && saved(s1).view === 'full', `?view=simple beats a saved full, and isn't written down (saved: ${JSON.stringify(saved(s1))})`);
  const s1b = mem({ [KEY]: { v: 1, view: 'simple', added: {} } });
  T.ok(dv('?view=full', s1b, true) === 'full' && saved(s1b).view === 'simple', '?view=full beats a saved simple, and isn\'t written down');
  const s2 = mem({ [KEY]: { v: 1, view: 'simple', added: { mixer: 'you' } } });
  T.ok(dv('', s2, true) === 'simple', 'a saved simple beats webdriver');
  const s2b = mem({ [KEY]: { v: 1, view: 'full', added: {} }, 'overdub:layout': '{}' });
  T.ok(dv('', s2b, false) === 'full', 'a saved full is kept');
  const s3 = mem();
  T.ok(dv('', s3, true) === 'full', 'under webdriver, with nothing saved: full (the other suites keep the full studio)');
  for (const k of ['overdub:layout', 'overdub:welcomed', 'overdub:project']) {
    const s = mem({ [k]: k === 'overdub:welcomed' ? '1' : '{}' });
    const v = dv('', s, false);
    T.ok(v === 'full' && saved(s)?.view === 'full', `a browser with ${k} (someone who has used the studio) gets full, written down (${v}; saved ${JSON.stringify(saved(s))})`);
  }
  const s5 = mem();
  const v5 = dv('', s5, false), w5 = saved(s5);
  T.ok(v5 === 'simple' && w5?.view === 'simple' && w5?.v === 1, `a clean browser gets simple, written down as { v: 1, view: 'simple' } (${v5}; saved ${JSON.stringify(w5)})`);
  const s6 = mem();
  T.ok(dv('?view=round', s6, false) === 'simple', 'an unknown ?view is ignored (a clean browser still gets simple)');
  const s7 = mem({ [KEY]: 'not json' });
  let v7 = null, threw = null;
  try { v7 = dv('', s7, false); } catch (e) { threw = e.message; }
  T.ok(!threw && (v7 === 'simple' || v7 === 'full'), `an unreadable saved layout doesn't throw (${threw || v7})`);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {}, key: () => null, length: 0 };
  let v8 = null, threw8 = null;
  try { v8 = dv('', broken, false); } catch (e) { threw8 = e.message; }
  T.ok(!threw8 && (v8 === 'simple' || v8 === 'full'), `storage that throws (a private window, blocked site data) doesn't throw (${threw8 || v8})`);
});

/* ======================================================================== the studio */
const s = await open('/app/', { query: 'view=simple', width: 1440, height: 900 });
const pages = [];
// a fresh browser context (clean storage) on the same server
async function fresh({ w = 1440, h = 900, query = 'view=simple', mobile = false, init = null } = {}) {
  const ctx = await s.browser.newContext({ viewport: { width: w, height: h }, permissions: ['microphone'], ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}) });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const go = async (q = query) => { await page.goto(s.base + '/app/' + (q ? '?' + q : ''), { waitUntil: 'load' }); await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 }); await sleep(600); };
  await go();
  const P = { page, ctx, errors, go, E: (fn, a) => page.evaluate(fn, a), shot: (n) => page.screenshot({ path: path.join(OUTDIR, `simple-${n}.png`) }).catch(() => {}) };
  pages.push(P);
  return P;
}
const neutral = (P) => P.E(() => { document.activeElement?.blur?.(); const a = document.querySelector('.ar-scroll'); if (a) a.focus({ preventScroll: true }); });

try {
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(700);
  const S = { page: s.page, errors: s.errors, E: (fn, a) => s.page.evaluate(fn, a), shot: (n) => s.shot('simple-' + n) };

  /* ---------------------------------------------------------------- the registry */
  await section('registry', async () => {
    const F = await S.E(() => (window.overdub.ui.workspace?.FEATURES || []).map((f) => ({ id: f.id, group: f.group, title: f.title, purpose: f.purpose, the: !!f.the, aliases: f.aliases || [], panels: f.panels || [] })));
    T.ok(F.length === SPEC.length, `the registry has the spec's ${SPEC.length} features (${F.length}: ${F.map((f) => f.id).join(', ')})`);
    const off = SPEC.filter(([g, id, t, p]) => { const f = F.find((x) => x.id === id); return !f || f.group !== g || !same(f.title, t) || !same(f.purpose, p); }).map(([, id]) => id);
    T.ok(!off.length, `each feature's id, group, title and purpose are the spec's, word for word${off.length ? ' (not: ' + off.join(', ') + ')' : ''}`);
    const panelsOff = Object.entries(PANEL_OF).filter(([id, panel]) => !F.find((x) => x.id === id)?.panels.includes(panel)).map(([id, panel]) => `${id} → ${panel}`);
    T.ok(!panelsOff.length, `the panel features map to their panels${panelsOff.length ? ' (not: ' + panelsOff.join(', ') + ')' : ''}`);
    const thes = F.filter((f) => f.the).map((f) => f.id).sort().join();
    T.ok(thes === 'beat,meters,mixer', `"the" goes with the Mixer, the Beat grid and the Level meter only (${thes})`);
    const ali = F.find((f) => f.id === 'notes')?.aliases || [];
    T.ok(ali.includes('piano roll') && F.every((f) => f.aliases.length), `every feature has search words; Notes answers to "piano roll" (${ali.join(', ')})`);
    // the panels' tabs are mapped centrally: every mapped panel id is a panel the studio has
    const missing = await S.E((ids) => ids.filter((id) => !window.overdub.ui.panels?.has?.(id)), Object.values(PANEL_OF));
    T.ok(!missing.length, `every mapped panel is a panel the studio registers${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
  });

  /* ---------------------------------------------------------------- 1. the first screen, desktop */
  await section('first screen', async () => {
    const w = await S.E(wsBits);
    T.ok(w.view === 'simple' && w.root === 'simple', `?view=simple opens the simple view (ui.workspace.view() ${w.view}, root .ws-${w.root})`);
    T.ok(w.more && w.full && w.moreX < w.switchX, `the top bar has More, then Full studio to its right (More at ${w.moreX}, Full studio at ${w.switchX})`);
    T.ok(w.note === '', `the note slot is there and empty at load ("${w.note}")`);
    const c = await S.E(controls);
    T.ok(c.length <= 30, `30 or fewer controls on the first screen (${c.length}: ${c.join(' | ')})`);
    const words = await S.E(screenText);
    const jargon = words.filter((t) => /API key|MCP|LUFS|−∞|Inspector|Reference/.test(t));
    T.ok(!jargon.length, `no jargon on the first screen: no API key, MCP, LUFS, −∞, Inspector or Reference${jargon.length ? ' (' + jargon.slice(0, 6).join(' | ') + ')' : ''}`);
    const st = await S.E(() => {
      const o = window.overdub, t = document.querySelector('.ar-empty-title');
      return { title: t && t.getClientRects().length ? t.textContent.trim() : null, tracks: o.store.get().tracks.length, opened: o.opened, playing: !!o.engine.playing, welcome: !!document.querySelector('.ar-welcome') && document.querySelector('.ar-welcome').getClientRects().length > 0, coach: !!o.onboard?.active, left: o.ui.isOpen('left'), bottom: o.ui.isOpen('bottom'), right: o.ui.isOpen('right'), foot: document.querySelector('.ar-empty-foot')?.innerText.trim().replace(/\s+/g, ' ') };
    });
    T.ok(st.title === 'Take 1 is yours.' && st.tracks === 0 && st.opened === 'new', `a blank song on "Take 1 is yours." (${st.title}; ${st.tracks} tracks; opened ${st.opened})`);
    T.ok(!st.playing, 'nothing plays on load');
    T.ok(!st.welcome && !st.coach, `no welcome card and no coach in the simple view (welcome ${st.welcome}, coach ${st.coach})`);
    T.ok(!st.left && !st.bottom && st.right, `the left and bottom panes are closed, the agent open (left ${st.left}, bottom ${st.bottom}, right ${st.right})`);
    T.ok(/^Or hear a finished one: Night Shift\.?$/.test(st.foot || ''), `the blank sheet's foot line offers Night Shift ("${st.foot}")`);
    const tabs = await S.E(visTabs);
    T.ok(!tabs.length, `no tab strip anywhere (${tabs.join(', ') || 'none'})`);
    const hid = await S.E((v) => ['.tp-loop', '.tp-kill', '.tp-meterbox', '.tp-pos-bar', '.tp-met', '.tp-beats', '.ew-t-panelLeft', '.ew-t-panelBottom', '.ew-t-panelRight', '#ag-keyin'].filter((sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')), null);
    T.ok(!hid.length, `put away on the first screen: Loop, All off, the meter, the position, the click, the beat lights, the pane buttons, the key field${hid.length ? ' (still showing: ' + hid.join(', ') + ')' : ''}`);
    const kept = await S.E(() => ['.tp-play', '.tp-rec', '.tp-title', '.sm-btn'].map((sel) => [sel, [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0)]));
    T.ok(kept.every(([, v]) => v), `Play, Record, the title and the Song menu stay (${kept.filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all there'})`);
    const ag = await S.E(() => { const r = document.querySelector('.ew-region-right'); const txt = r ? r.innerText : ''; return { demo: /Your agent · demo, free/.test(txt), box: !!r?.querySelector('.ag-input') && r.querySelector('.ag-input').getClientRects().length > 0, keycard: !!r?.querySelector('.ag-keycard') && r.querySelector('.ag-keycard').getClientRects().length > 0 }; });
    T.ok(ag.demo && ag.box && !ag.keycard, `the agent opens on the demo agent: "Your agent · demo, free", the ask box, no key card (${JSON.stringify(ag)})`);
    await S.shot('desktop');
  });

  /* ---------------------------------------------------------------- a song with tracks: M and S per header; Sketch */
  await section('tracks and Sketch', async () => {
    const hd = await S.E(async () => {
      const o = window.overdub;
      o.store.dispatch([{ type: 'track.add', ref: 'a', track: { name: 'Keys', instrument: { device: 'core.keys' } } }, { type: 'track.add', ref: 'b', track: { name: 'Bass', instrument: { device: 'core.bass' } } }], { by: 'you', label: 'simple test: two tracks' });
      await new Promise((r) => setTimeout(r, 300));
      const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
      const heads = [...document.querySelectorAll('.ar-head')].filter(vis);
      return heads.map((h) => ({ n: [...h.querySelectorAll('button, input, select, a[href], [role=button], [role=slider]')].filter(vis).map((b) => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 14)), m: !!h.querySelector('.ar-hb-mute') && vis(h.querySelector('.ar-hb-mute')), s: !!h.querySelector('.ar-hb-solo') && vis(h.querySelector('.ar-hb-solo')) }));
    });
    T.ok(hd.length === 2 && hd.every((h) => h.m && h.s && h.n.length <= 2), `each track header shows M and S and no other control (${hd.map((h) => h.n.join(' ')).join(' / ')})`);
    const sk = await S.E(async () => {
      const o = window.overdub;
      o.ui.show('sketch');
      await new Promise((r) => setTimeout(r, 400));
      const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const p = document.querySelector('[data-panel="sketch"]');
      const tagged = p ? [...p.querySelectorAll('[data-feature~="record-options"]')] : [];
      const strip = document.querySelector('.ew-region-bottom > .ew-tabs');
      return { open: o.ui.isOpen('bottom') && o.ui.active('bottom') === 'sketch', tagged: tagged.length, shown: tagged.filter(vis).length, strip: !!strip && vis(strip), text: p ? p.innerText : '' };
    });
    T.ok(sk.open && !sk.strip, `Sketch opens alone in the bottom pane, no tab strip (open ${sk.open}, strip ${sk.strip})`);
    T.ok(sk.tagged > 0 && sk.shown === 0, `Sketch's recording options are tagged record-options and put away (${sk.tagged} tagged, ${sk.shown} showing)`);
    T.ok(/Hum it/.test(sk.text) && /Keep|Takes|Record/.test(sk.text), 'Sketch keeps its modes, the Hum and Record buttons and the takes');
    await S.E(() => { const o = window.overdub; o.ui.setOpen('bottom', false); o.store.undo(); });
    const src = fs.readFileSync(new URL('../app/src/ui/sketch.js', import.meta.url), 'utf8');
    T.ok(/Heard nothing\./.test(src) && /Hum a little louder, or closer to the mic\./.test(src), 'an empty hum says "Heard nothing. Hum a little louder, or closer to the mic."');
  });

  /* ---------------------------------------------------------------- the copy (spec section 6) */
  await section('copy', async () => {
    let ws = '';
    try { ws = fs.readFileSync(new URL('../app/src/ui/workspace.js', import.meta.url), 'utf8'); } catch (e) { /* reported below */ }
    const want = ['Full studio', 'Simple view', 'Show every panel and control. Your song stays as it is.', 'Hide what you\'re not using. Nothing is removed; add anything back from More.', 'Everything that\'s put away, and how to add it', 'Find something: mixer, piano roll, loop…', 'Nothing called that. Ask your agent where it is.', 'Show the full studio', 'Simple view hides these. Nothing is removed.', 'Back to the simple view', 'in your studio now.', 'It\'s in More.', 'Put away', 'added by'];
    const miss = want.filter((w) => !ws.includes(w) && !ws.includes(curly(w)));
    T.ok(ws && !miss.length, `workspace.js carries the spec's words${miss.length ? ' (missing: ' + miss.map((m) => `"${m}"`).join(', ') + ')' : ''}`);
    T.ok(!/✨|sparkle|border-left:\s*[2-9]px|inset\s+\d+px\s+0\s+0|border-radius:\s*(99|50%|\d{2,}px)/.test(ws), 'More draws no sparkles, no coloured left border and no pills');
  });

  /* ---------------------------------------------------------------- 8. hidden means gone */
  await section('tab order', async () => {
    await S.E(() => document.querySelector('.ew-brand')?.focus());
    const seen = [];
    for (let i = 0; i < 40; i++) {
      await S.page.keyboard.press('Tab');
      const f = await S.E(() => {
        const a = document.activeElement, ws = window.overdub.ui.workspace;
        if (!a || !a.closest('.ew-top')) return null;
        const feats = []; for (let e = a; e; e = e.parentElement) if (e.dataset?.feature) feats.push(...e.dataset.feature.split(/\s+/));
        return { name: (a.getAttribute('aria-label') || a.textContent || a.className).trim().slice(0, 20), vis: a.getClientRects().length > 0, hidden: feats.filter((id) => ws && !ws.has(id)) };
      });
      if (!f) break;
      seen.push(f);
    }
    const bad = seen.filter((f) => !f.vis || f.hidden.length);
    T.ok(seen.length >= 4 && seen.some((f) => f.name === 'More') && !bad.length, `tabbing the top bar lands only on what's shown, More among them (${seen.map((f) => f.name).join(' → ')})${bad.length ? '; landed on put-away: ' + bad.map((f) => `${f.name} [${f.hidden.join(' ')}]`).join(', ') : ''}`);
  });

  /* ---------------------------------------------------------------- 2. a phone */
  await section('phone', async () => {
    const P = await fresh({ w: 390, h: 844, mobile: true });
    const c = await P.E(controls);
    T.ok(c.length <= 18, `phone: 18 or fewer controls on the first screen (${c.length}: ${c.join(' | ')})`);
    const wide = await P.E(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth }));
    T.ok(wide.doc <= wide.vw, `phone: no sideways page scroll (${wide.doc} px in ${wide.vw})`);
    const sheet = await P.E(() => {
      const card = document.querySelector('.ar-empty-card');
      if (!card || !card.getClientRects().length) return null;
      const cr = card.getBoundingClientRect();
      const targets = [document.querySelector('.ar-empty-title'), ...card.querySelectorAll('button')].filter((e) => e && e.getClientRects().length);
      const covered = targets.filter((e) => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; if (y < 0 || y > innerHeight) return false; const hit = document.elementFromPoint(x, y); return !hit || !(hit === e || e.contains(hit) || hit.contains(e)); }).map((e) => e.textContent.trim().slice(0, 16));
      const doors = [...card.querySelectorAll('.ar-empty-actions button')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), t: Math.round(r.top) }; });
      return { covered, doors, cw: Math.round(cr.width), ws: !!document.querySelector('.ws-simple') };
    });
    T.ok(sheet && sheet.ws && !sheet.covered.length, `phone: nothing lies over the blank sheet's title and doors${sheet?.covered.length ? ' (covered: ' + sheet.covered.join(', ') + ')' : ''}`);
    T.ok(sheet && sheet.doors.length === 5 && sheet.doors.every((d) => d.w >= sheet.cw - 2) && new Set(sheet.doors.map((d) => d.t)).size === 5, `phone: the five doors are stacked full width (${sheet?.doors.map((d) => `${d.w}@${d.t}`).join(', ')} in ${sheet?.cw})`);
    const top = await P.E(() => ['.tp-title', '.tp-play', '.tp-rec'].map((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return sel + ' missing'; const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 ? '' : sel + ' off screen'; }).filter(Boolean));
    const w = await P.E(wsBits);
    T.ok(!top.length && w.more, `phone: the title, Play, Record and More are on the top row (${[...top, w.more ? '' : 'More missing'].filter(Boolean).join(', ') || 'all there'})`);
    await P.shot('phone');
  });

  /* ---------------------------------------------------------------- 3. Full studio and back */
  await section('full studio round trip', async () => {
    const P = await fresh();
    await P.E(() => window.overdub.store.dispatch({ type: 'project.set', patch: { title: 'Round trip' } }, { by: 'you', label: 'title' }));
    await sleep(900);   // autosave
    const j0 = await P.E(() => JSON.stringify(window.overdub.store.get()));
    const h0 = await P.E(() => window.overdub.store.history.length);
    T.ok(await P.E(clickTop, /^Full studio$/), 'Full studio is one click');
    await sleep(500);
    const a = await P.E(() => ({ tabs: [...document.querySelectorAll('.ew-tab')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().width > 0).length, view: window.overdub.ui.workspace?.view(), panes: ['left', 'right', 'bottom'].map((r) => window.overdub.ui.isOpen(r)), json: JSON.stringify(window.overdub.store.get()), hist: window.overdub.store.history.length, saved: JSON.parse(localStorage.getItem('overdub:workspace') || 'null') }));
    const wa = await P.E(wsBits);
    T.ok(a.view === 'full' && a.tabs === 13 && a.panes.every(Boolean), `full: 13 tabs and the three panes open, no reload (${a.view}, ${a.tabs} tabs, panes ${a.panes.join(' ')})`);
    T.ok(wa.simple && !wa.full, 'in full the switch reads Simple view');
    T.ok(a.saved?.view === 'full' && a.saved?.v === 1, `the choice is written down (${JSON.stringify(a.saved)})`);
    T.ok(a.json === j0 && a.hist === h0, `the switch leaves the song as it was, and isn't an undo step (${a.hist - h0} new steps)`);
    await P.go('');
    const b = await P.E(() => ({ view: window.overdub.ui.workspace?.view(), tabs: [...document.querySelectorAll('.ew-tab')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().width > 0).length, title: window.overdub.store.get().title }));
    T.ok(b.view === 'full' && b.tabs === 13 && b.title === 'Round trip', `reloaded, it's still full (${b.view}, ${b.tabs} tabs, "${b.title}")`);
    const j1 = await P.E(() => JSON.stringify(window.overdub.store.get()));
    T.ok(await P.E(clickTop, /^Simple view$/), 'Simple view is one click');
    await sleep(500);
    const c = await P.E(() => ({ view: window.overdub.ui.workspace?.view(), root: document.querySelector('.ws-simple') ? 'simple' : 'full', left: window.overdub.ui.isOpen('left'), json: JSON.stringify(window.overdub.store.get()), saved: JSON.parse(localStorage.getItem('overdub:workspace') || 'null') }));
    const regions = await P.E(() => ['left', 'center', 'right', 'bottom'].map((r) => [r, window.overdub.ui.active(r)]).filter(([r, id]) => id && (r === 'center' || window.overdub.ui.isOpen(r)) && !window.overdub.ui.workspace.panelShown(id)).map(([r, id]) => `${r}: ${id}`));
    T.ok(c.view === 'simple' && c.root === 'simple' && !c.left && c.saved?.view === 'simple', `simple again: the left pane closes, the choice is written down (${JSON.stringify({ view: c.view, left: c.left, saved: c.saved?.view })})`);
    T.ok(!regions.length, `no open region is left on a put-away panel${regions.length ? ' (' + regions.join(', ') + ')' : ''}`);
    T.ok(c.json === j1, 'switching back leaves the song as it was');
    await P.go('');
    const d = await P.E(() => ({ view: window.overdub.ui.workspace?.view(), title: window.overdub.store.get().title, tabs: [...document.querySelectorAll('.ew-tab')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().width > 0).length }));
    T.ok(d.view === 'simple' && d.title === 'Round trip' && d.tabs === 0, `reloaded, it stays simple: a saved simple beats webdriver (${d.view}, "${d.title}", ${d.tabs} tabs)`);
  });

  /* ---------------------------------------------------------------- 4. reach is reveal */
  await section('reach', async () => {
    const P = await fresh();
    await neutral(P);
    const before = await P.E(() => ({ loop: !!window.overdub.store.get().loop?.on, shown: [...document.querySelectorAll('.tp-loop')].some((e) => e.getClientRects().length > 0) }));
    await P.page.keyboard.press('KeyL');
    await sleep(300);
    const after = await P.E(() => ({ loop: !!window.overdub.store.get().loop?.on, shown: [...document.querySelectorAll('.tp-loop')].some((e) => e.getClientRects().length > 0), has: window.overdub.ui.workspace?.has('loop') }));
    const n1 = await P.E(wsBits);
    T.ok(!before.shown && after.shown && after.has, `L brings the Loop key in (shown ${before.shown} → ${after.shown})`);
    T.ok(after.loop !== before.loop, `... and the key still does its job: the loop turns ${after.loop ? 'on' : 'off'}`);
    T.ok(/^Loop is in your studio now\./.test(n1.note || '') && n1.noteBtn && /Put away/.test(n1.note), `the note reads "Loop is in your studio now." with Put away ("${n1.note}")`);
    const h0 = await P.E(() => window.overdub.store.history.length);
    await P.E(() => window.overdub.ui.show('mixer'));
    await sleep(400);
    const mx = await P.E(() => { const o = window.overdub, l = o.ui.workspace?.list() || []; const t = document.getElementById('ew-tab-mixer'); return { tab: !!t && t.getClientRects().length > 0, by: l.find((f) => f.id === 'mixer')?.addedBy, loopBy: l.find((f) => f.id === 'loop')?.addedBy, active: o.ui.active('bottom'), hist: o.store.history.length };
    });
    const n2 = await P.E(wsBits);
    T.ok(mx.tab && mx.active === 'mixer' && mx.by === 'you' && mx.loopBy === 'you', `ui.show('mixer') brings the Mixer in, its tab showing, added by you (${JSON.stringify(mx)})`);
    T.ok(/^Mixer is in your studio now\./.test(n2.note || ''), `the note says so ("${n2.note}")`);
    T.ok(mx.hist === h0, `adding to the studio is never an undo step (${mx.hist - h0} new steps)`);
    await P.go();
    const rl = await P.E(() => { const ws = window.overdub.ui.workspace; return { loop: ws?.has('loop'), mixer: ws?.has('mixer'), key: [...document.querySelectorAll('.tp-loop')].some((e) => e.getClientRects().length > 0), by: (ws?.list() || []).filter((f) => f.addedBy).map((f) => `${f.id}:${f.addedBy}`).join(' ') }; });
    T.ok(rl.loop && rl.mixer && rl.key, `reloaded, the Loop and the Mixer are still in (${rl.by})`);
    // the note's Put away puts it back in More: away and in again (a fresh note), then its button
    await P.E(() => { window.overdub.ui.workspace.putAway(['mixer']); window.overdub.ui.show('mixer'); });
    await sleep(200);
    await P.E(() => (document.querySelector('.ew-ws [role=status] button') || document.querySelector('.ew-top [role=status] button'))?.click());
    await sleep(200);
    const pa = await P.E(wsBits);
    const gone = await P.E(() => ({ has: window.overdub.ui.workspace.has('mixer'), tab: (() => { const t = document.getElementById('ew-tab-mixer'); return !!t && t.getClientRects().length > 0; })(), active: window.overdub.ui.active('bottom') }));
    T.ok(!gone.has && !gone.tab && gone.active !== 'mixer', `Put away takes the Mixer off screen, and the bottom pane moves off it (${JSON.stringify(gone)})`);
    T.ok(/^Put away Mixer\. It.s in More\.$/.test(pa.note || '') && !pa.noteBtn, `the note: "Put away Mixer. It's in More." with no button ("${pa.note}")`);
    // B on a left pane with nothing shown brings the Browser in
    await neutral(P);
    await P.page.keyboard.press('KeyB');
    await sleep(400);
    const bb = await P.E(() => ({ open: window.overdub.ui.isOpen('left'), has: window.overdub.ui.workspace.has('browser'), active: window.overdub.ui.active('left') }));
    T.ok(bb.open && bb.has && bb.active === 'browser', `B on the empty left pane brings the Browser in (${JSON.stringify(bb)})`);
    // the welcome / empty sheet's Draw a beat (a reach for a put-away panel) adds the Beat grid, signed by you
    await P.E(() => [...document.querySelectorAll('.ar-empty-actions button')].find((b) => b.textContent.trim() === 'Draw a beat')?.click());
    await sleep(500);
    const db = await P.E(() => ({ has: window.overdub.ui.workspace.has('beat'), by: window.overdub.ui.workspace.list().find((f) => f.id === 'beat')?.addedBy, active: window.overdub.ui.active('bottom') }));
    T.ok(db.has && db.by === 'you' && db.active === 'drumgrid', `Draw a beat brings the Beat grid in, signed by you (${JSON.stringify(db)})`);
    await P.shot('reach');
  });

  /* ---------------------------------------------------------------- 5. More */
  await section('More', async () => {
    const P = await fresh();
    T.ok(await P.E(clickTop, /^More$/), 'More opens with a click');
    await sleep(300);
    const info = await P.E(moreInfo);
    T.ok(info && info.groups.length === 8, `More lists the features under Make, Sound, Balance, Song, Recording, Agent, Files and Layout (${info?.groups.join(', ')})`);
    T.ok(info && info.adds >= SPEC.length - 2, `each put-away feature has an Add (${info?.adds})`);
    T.ok(info && /Show the full studio/.test(info.text) && /Simple view hides these\. Nothing is removed\./.test(info.text), 'its foot: Show the full studio, and "Simple view hides these. Nothing is removed."');
    T.ok(info && info.r[0] >= 0 && info.r[2] <= 1440 && info.r[1] >= 0 && info.r[3] <= 900, `it's whole on screen (${info?.r.join(',')})`);
    // search: "piano" finds Notes first
    await P.page.fill('input[placeholder^="Find something"]', 'piano');
    await sleep(200);
    const first = await P.E((titles) => { const inp = document.querySelector('input[placeholder^="Find something"]'); let b = inp.parentElement; while (b && b !== document.body && !(b.getAttribute('role') === 'dialog' || ['fixed', 'absolute'].includes(getComputedStyle(b).position))) b = b.parentElement; const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) { const t = n.textContent.trim(), el = n.parentElement; if (titles.includes(t) && el.getClientRects().length) return t; } return null; }, SPEC.map((x) => x[2]));
    T.ok(first === 'Notes', `"piano" finds Notes first, with no tokens spent (${first})`);
    // Add on the Notes row
    const rowBtn = (title, words) => P.E(([title, words]) => {
      const inp = document.querySelector('input[placeholder^="Find something"]'); let b = inp.parentElement; while (b && b !== document.body && !(b.getAttribute('role') === 'dialog' || ['fixed', 'absolute'].includes(getComputedStyle(b).position))) b = b.parentElement;
      const el = [...b.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === title && e.getClientRects().length);
      for (let r = el; r && r !== b; r = r.parentElement) { const btn = [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === words); if (btn) { btn.click(); return true; } }
      return false;
    }, [title, words]);
    T.ok(await rowBtn('Notes', 'Add'), 'the Notes row has an Add');
    await sleep(300);
    const added = await P.E(() => { const o = window.overdub; o.ui.setOpen('bottom', true); o.ui.show('pianoroll'); const t = document.getElementById('ew-tab-pianoroll'); return { has: o.ui.workspace.has('notes'), shown: o.ui.workspace.panelShown('pianoroll'), tab: !!t && t.getClientRects().length > 0, by: o.ui.workspace.list().find((f) => f.id === 'notes')?.addedBy }; });
    T.ok(added.has && added.shown && added.tab && added.by === 'you', `Add brings Notes in, its tab showing, added by you (${JSON.stringify(added)})`);
    const still = await P.E(() => !!document.querySelector('input[placeholder^="Find something"]')?.getClientRects().length);
    if (!still) { await P.E(clickTop, /^More$/); await sleep(300); await P.page.fill('input[placeholder^="Find something"]', 'piano'); await sleep(200); }
    T.ok(await rowBtn('Notes', 'Put away'), 'the Notes row now says Put away');
    await sleep(300);
    const away = await P.E(() => { const o = window.overdub, t = document.getElementById('ew-tab-pianoroll'); return { has: o.ui.workspace.has('notes'), tab: !!t && t.getClientRects().length > 0, stale: ['left', 'center', 'right', 'bottom'].map((r) => [r, o.ui.active(r)]).filter(([r, id]) => id && (r === 'center' || o.ui.isOpen(r)) && !o.ui.workspace.panelShown(id)).map(([r, id]) => `${r}: ${id}`) }; });
    T.ok(!away.has && !away.tab && !away.stale.length, `Put away takes the Notes tab away, and no region is left showing a put-away panel (${JSON.stringify(away)})`);
    // no match
    await P.page.fill('input[placeholder^="Find something"]', 'zzqx');
    await sleep(200);
    const none = (await P.E(moreInfo))?.text || '';
    T.ok(/Nothing called that\. Ask your agent where it is\./.test(none), 'a search with no match: "Nothing called that. Ask your agent where it is."');
    // Esc closes it and focus goes back to More
    await P.page.focus('input[placeholder^="Find something"]');
    await P.page.keyboard.press('Escape');
    await sleep(250);
    const esc = await P.E(() => ({ open: !!document.querySelector('input[placeholder^="Find something"]')?.getClientRects().length, focus: document.activeElement?.textContent?.trim() }));
    T.ok(!esc.open && esc.focus === 'More', `Esc closes More and focus goes back to its button (open ${esc.open}, focus "${esc.focus}")`);
    // in full, the foot offers the way back
    await P.E(() => window.overdub.ui.workspace.setView('full'));
    await P.E(clickTop, /^More$/);
    await sleep(300);
    const fullFoot = (await P.E(moreInfo))?.text || '';
    T.ok(/Back to the simple view/.test(fullFoot), 'in full, More\'s foot says "Back to the simple view"');
    await P.page.keyboard.press('Escape');
    await P.E(() => window.overdub.ui.workspace.setView('simple'));
  });

  /* ---------------------------------------------------------------- 6. the workspace tool, 7. a show inside a tool run */
  await section('workspace tool', async () => {
    const P = await fresh();
    const r = await P.E(async () => {
      const o = window.overdub, run = (input, by = 'claude') => o.tools.run('workspace', input, { by });
      const note = () => { const n = document.querySelector('.ew-ws [role=status]') || document.querySelector('.ew-top [role=status]'); return { text: n?.textContent.trim().replace(/\s+/g, ' ') || '', agent: [...(n?.querySelectorAll('.by-agent') || [])].map((b) => b.textContent) }; };
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const out = { h0: o.store.history.length, listed: o.tools.list().includes('workspace') };
      const l = await run({ action: 'list' });
      out.list = { view: l.view, n: l.features?.length, keys: l.features ? Object.keys(l.features[0]).sort().join() : '', history: l.features?.find((f) => f.id === 'history') };
      out.add = await run({ action: 'add', features: ['mixer'] });
      await wait(150);
      out.addNote = note();
      out.addedBy = o.ui.workspace.list().find((f) => f.id === 'mixer')?.addedBy;
      out.again = await run({ action: 'add', features: ['mixer'] });
      out.mine = await run({ action: 'put_away', features: ['mixer'] });
      await wait(150);
      out.mineNote = note();
      out.mixerAfter = o.ui.workspace.has('mixer');
      o.ui.workspace.add(['loop'], { by: 'you', note: false });
      out.theirs = await run({ action: 'put_away', features: ['loop'] });
      out.loopKept = o.ui.workspace.has('loop');
      out.asked = await run({ action: 'put_away', features: ['loop'], asked: true });
      out.loopAfter = o.ui.workspace.has('loop');
      out.view = await run({ action: 'view', view: 'full' });
      out.viewAfter = o.ui.workspace.view();
      out.unknown = await run({ action: 'add', features: ['x'] });
      out.open = await run({ action: 'open', feature: 'history' });
      await wait(200);
      out.openShown = { has: o.ui.workspace.has('history'), active: o.ui.active('right'), open: o.ui.isOpen('right') };
      o.ui.workspace.putAway(['history'], { by: 'you' });
      // while they record: everything but list waits
      const rec = o.input?.recorder, desc = rec && Object.getOwnPropertyDescriptor(rec, 'state'), had = o.input && Object.getOwnPropertyDescriptor(o.input, 'recording');
      if (rec) Object.defineProperty(rec, 'state', { get: () => 'rec', configurable: true });
      if (o.input) Object.defineProperty(o.input, 'recording', { value: true, configurable: true, writable: true });
      try {
        out.recAdd = await run({ action: 'add', features: ['mixer'] });
        out.recList = await run({ action: 'list' });
      } finally {
        if (rec) { if (desc) Object.defineProperty(rec, 'state', desc); else delete rec.state; }
        if (o.input) { if (had) Object.defineProperty(o.input, 'recording', had); else delete o.input.recording; }
      }
      out.recMixer = o.ui.workspace.has('mixer');
      const sel = await o.tools.run('get_selection', {}, { by: 'claude' });
      out.sel = sel?.studio;
      o.ui.workspace.setView('full');
      out.fullNoop = await run({ action: 'add', features: ['mixer'] });
      o.ui.workspace.setView('simple');
      out.actor = o.ui.state.actor ?? null;
      out.h1 = o.store.history.length;
      return out;
    });
    T.ok(r.listed, 'workspace is in tools.list()');
    T.ok(r.list.view === 'simple' && r.list.n === SPEC.length && /added_by/.test(r.list.keys) && /shown/.test(r.list.keys) && r.list.history && !r.list.history.shown, `list: the view and every feature, shown or not, with who added it (${r.list.n} features; ${r.list.keys})`);
    T.ok(JSON.stringify(r.add.added) === '["mixer"]' && typeof r.add.where === 'string' && r.add.where.length > 3 && r.add.view === 'simple', `add: { view, added, already, where } (${JSON.stringify(r.add)})`);
    T.ok(/^Claude added the Mixer\./.test(r.addNote.text) && r.addNote.agent.includes('Claude') && r.addedBy === 'claude', `an agent's add is signed: "${r.addNote.text}" (Claude in agent ink: ${r.addNote.agent.join()}), added by ${r.addedBy}`);
    T.ok(JSON.stringify(r.again.already) === '["mixer"]' && !r.again.added?.length, `adding what's there says it already is (${JSON.stringify(r.again)})`);
    T.ok(JSON.stringify(r.mine.put_away) === '["mixer"]' && !r.mixerAfter && /^Claude put away the Mixer\. It.s in More\./.test(r.mineNote.text), `the agent puts away what it added ("${r.mineNote.text}")`);
    T.ok(/they added that/.test(r.theirs.error || '') && /only when they ask/.test(r.theirs.hint || '') && r.loopKept, `it can't put away what you added unless you asked (${JSON.stringify(r.theirs)})`);
    T.ok(JSON.stringify(r.asked.put_away) === '["loop"]' && !r.loopAfter, 'asked: true, it can');
    T.ok(/that.s their choice/.test(r.view.error || '') && /only when they ask/.test(r.view.hint || '') && r.viewAfter === 'simple', `it can't switch the view unless they asked (${JSON.stringify(r.view)})`);
    T.ok(r.unknown.error === 'no feature "x"' && /^features: /.test(r.unknown.hint || '') && /mixer/.test(r.unknown.hint), `an unknown id: the error and the ids (${r.unknown.error}; ${String(r.unknown.hint).slice(0, 60)}…)`);
    T.ok(JSON.stringify(r.open.added) === '["history"]' && r.openShown.has && r.openShown.open && r.openShown.active === 'history', `open: adds History and shows its panel (${JSON.stringify(r.openShown)})`);
    T.ok(r.recAdd.error === 'the person is recording' && /get_recording/.test(r.recAdd.hint || '') && !r.recMixer && r.recList.view === 'simple', `while they record it only lists (${JSON.stringify(r.recAdd)})`);
    T.ok(r.sel?.view === 'simple' && Array.isArray(r.sel.hidden) && r.sel.hidden.includes('history'), `get_selection says what's put away (studio: ${JSON.stringify(r.sel)})`);
    T.ok(r.fullNoop.view === 'full' && r.fullNoop.note === 'everything is already on screen' && !r.fullNoop.error, `in full it's a no-op (${JSON.stringify(r.fullNoop)})`);
    T.ok(!r.actor, `the tool run's actor is cleared when it settles (${r.actor})`);
    T.ok(r.h1 === r.h0, `none of it is an undo step: layout is never the song (${r.h1 - r.h0} new steps)`);

    // 7. a tool that calls ui.show inside its run (drumgrid's Draw a beat, as an agent does it): the agent's reveal
    const sg = await P.E(async () => {
      const o = window.overdub;
      o.tools.register({ name: 'probe_show_beat', annotations: { title: 'Probe show', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, description: 'test probe', input_schema: { type: 'object', properties: {} }, run: () => { o.beat.draw(); return { ok: true }; } });
      const was = o.ui.workspace.has('beat');
      await o.tools.run('probe_show_beat', {}, { by: 'claude' });
      await new Promise((res) => setTimeout(res, 300));
      const n = document.querySelector('.ew-ws [role=status]') || document.querySelector('.ew-top [role=status]');
      const out = { was, has: o.ui.workspace.has('beat'), by: o.ui.workspace.list().find((f) => f.id === 'beat')?.addedBy, note: n?.textContent.trim().replace(/\s+/g, ' '), actor: o.ui.state.actor ?? null };
      // and the same show outside a run is yours
      o.ui.workspace.putAway(['mixer'], { by: 'you' });
      o.ui.show('mixer');
      out.mine = o.ui.workspace.list().find((f) => f.id === 'mixer')?.addedBy;
      return out;
    });
    T.ok(!sg.was && sg.has && sg.by === 'claude' && /^Claude added the Beat grid\./.test(sg.note || '') && !sg.actor, `a ui.show inside an agent's tool run is signed as the agent's ("${sg.note}", added by ${sg.by})`);
    T.ok(sg.mine === 'you', `outside a run the same reach is yours (${sg.mine})`);
    // what the person reaches for by hand while an agent's tool is still running (adjust waits a minute on a pick, a
    // render measures) is theirs: a key is never the agent's
    await P.E(() => {
      const o = window.overdub;
      o.ui.workspace.putAway(['loop'], { by: 'you' });
      o.tools.register({ name: 'probe_slow', annotations: { title: 'Probe slow', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: 'test probe', input_schema: { type: 'object', properties: {} }, run: () => new Promise((res) => setTimeout(() => res({ ok: true }), 1500)) });
      window.__slow = o.tools.run('probe_slow', {}, { by: 'claude' });
      document.activeElement?.blur?.();
    });
    await sleep(150);
    const during = await P.E(() => window.overdub.ui.state.actor ?? null);
    await P.page.keyboard.press('KeyL');
    await sleep(150);
    const hand = await P.E(async () => { const o = window.overdub; const by = o.ui.workspace.addedBy('loop'); await window.__slow; return { by, actor: o.ui.state.actor ?? null }; });
    T.ok(during === 'claude' && hand.by === 'you' && !hand.actor, `L pressed while an agent's tool runs brings the Loop in as yours, not the agent's (actor ${during}; added by ${hand.by})`);
    // More shows who added it
    await P.E(() => { const o = window.overdub; o.ui.workspace.putAway(['mixer'], { by: 'you' }); return o.tools.run('workspace', { action: 'add', features: ['mixer'] }, { by: 'claude' }); });
    await P.E(clickTop, /^More$/);
    await sleep(300);
    await P.page.fill('input[placeholder^="Find something"]', 'mixer');
    await sleep(200);
    const row = (await P.E(moreInfo)) || { text: '', agent: [] };
    T.ok(/added by Claude/.test(row.text) && row.agent.includes('Claude'), `More's Mixer row says "added by Claude", Claude in agent ink (${row.agent.join()})`);
    await P.page.keyboard.press('Escape');
  });

  /* ---------------------------------------------------------------- 9. the demo agent */
  await section('demo agent', async () => {
    const P = await fresh();
    await P.E(() => { window.__said = ''; window.overdub.agent?.on?.('text', (e) => { window.__said += e?.delta || ''; }); });
    await P.page.fill('.ag-input', 'where is the mixer');
    await P.page.press('.ag-input', 'Enter');
    await P.page.waitForFunction(() => window.overdub.ui.workspace?.has('mixer'), null, { timeout: 10000 }).catch(() => {});
    await sleep(800);
    const d = await P.E(() => { const o = window.overdub, f = o.ui.workspace?.list().find((x) => x.id === 'mixer'); const n = document.querySelector('.ew-ws [role=status]') || document.querySelector('.ew-top [role=status]'); const msgs = [...document.querySelectorAll('.ag-msg.ag-agent')]; return { has: o.ui.workspace?.has('mixer'), by: f?.addedBy, note: n?.textContent.trim().replace(/\s+/g, ' '), agentInk: n ? n.querySelectorAll('.by-agent').length : 0, said: (window.__said || msgs.at(-1)?.innerText || '').trim(), keycard: !!document.querySelector('.ag-keycard') && document.querySelector('.ag-keycard').getClientRects().length > 0 }; });
    T.ok(d.has && d.by && d.by !== 'you' && d.agentInk > 0, `"where is the mixer" brings the Mixer in, signed by the agent (added by ${d.by}; note "${d.note}")`);
    T.ok(/Mixer/.test(d.said) && !/\n/.test(d.said) && d.said.length < 160, `... and the demo agent says where in one line ("${d.said}")`);
    T.ok(!d.keycard, 'sending with no key never opens the key screen');
  });

  /* ---------------------------------------------------------------- a full-studio browser, opened simple */
  await section('over a saved layout', async () => {
    // someone who uses the full studio, with the Browser pane open and remembered, opens ?view=simple: the left pane
    // has nothing it may show, so it closes rather than stand open and empty
    const P = await fresh({ init: () => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('overdub:layout', JSON.stringify({ leftW: 236, rightW: 380, bottomH: 300, open: { left: true, right: true, bottom: true }, tabs: { left: 'browser' } })); } } catch (e) { /* ok */ } } });
    const a = await P.E(() => ({ view: window.overdub.ui.workspace.view(), left: window.overdub.ui.isOpen('left'), active: window.overdub.ui.active?.('left') ?? null }));
    T.ok(a.view === 'simple' && !a.left && !a.active, `over a saved layout with the left pane open, the simple view closes it (it would stand empty) (${JSON.stringify(a)})`);
    // the full studio with the agent pane closed: More and Simple view come back to the top bar
    await P.E(() => window.overdub.ui.workspace.setView('full'));
    await sleep(200);
    await P.E(() => window.overdub.ui.setOpen('right', false));
    await sleep(300);
    const b = await P.E(() => { const vis = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0; const top = document.querySelector('.ew-top'); const sv = [...top.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Simple view'); const more = [...top.querySelectorAll('button')].find((x) => x.textContent.trim() === 'More'); return { simple: vis(sv), more: vis(more) }; });
    T.ok(b.simple && b.more, `in the full studio with the agent pane closed, Simple view and More are in the top bar (${JSON.stringify(b)})`);
    await P.E(() => window.overdub.ui.setOpen('right', true));
    await sleep(300);
    const c = await P.E(() => { const sv = [...document.querySelectorAll('.ew-ws-side button')].find((x) => x.textContent.trim() === 'Simple view'); return !!sv && sv.getClientRects().length > 0; });
    T.ok(c, 'with the agent pane open again, they go back to the end of its tab row');
  });

  /* ---------------------------------------------------------------- a person's browser: no webdriver */
  await section('a person\'s browser', async () => {
    const hide = () => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }); };
    const P = await fresh({ query: '', init: hide });
    const a = await P.E(() => ({ wd: navigator.webdriver, view: window.overdub.ui.workspace?.view(), saved: JSON.parse(localStorage.getItem('overdub:workspace') || 'null'), tracks: window.overdub.store.get().tracks.length, welcome: !!document.querySelector('.ar-welcome') && document.querySelector('.ar-welcome').getClientRects().length > 0, coach: !!window.overdub.onboard?.active, playing: !!window.overdub.engine.playing }));
    T.ok(a.wd === false && a.view === 'simple' && a.saved?.view === 'simple', `a clean browser opens simple and writes it down (${a.view}; saved ${JSON.stringify(a.saved)})`);
    T.ok(a.tracks === 0 && !a.welcome && !a.coach && !a.playing, `... on a blank song: no welcome card, no coach, no sound (${JSON.stringify(a)})`);
    const Q = await fresh({ query: '', init: () => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }); try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('overdub:welcomed', '1'); } } catch (e) { /* ok */ } } });
    const b = await Q.E(() => ({ view: window.overdub.ui.workspace?.view(), saved: JSON.parse(localStorage.getItem('overdub:workspace') || 'null') }));
    T.ok(b.view === 'full' && b.saved?.view === 'full', `a browser that has used the studio keeps the full studio, written down (${b.view}; saved ${JSON.stringify(b.saved)})`);
  });

  const all = [...s.errors, ...pages.flatMap((p) => p.errors)].filter((e) => !ignorable(e));
  T.ok(!all.length, `no page errors${all.length ? ': ' + all.slice(0, 3).join(' | ') : ''}`);
} finally {
  for (const p of pages) await p.ctx.close().catch(() => {});
  await s.close();
}
T.done();
