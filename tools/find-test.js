// One studio and Find anything [find] (app/src/ui/workspace.js, the registry and ui.workspace; app/src/ui/workspace-view.js,
// which view a load opens in). Nothing is put away by default: everyone gets the full studio, and Find (⌘K) reaches
// any panel, any key's action, any sound and the guide's pages.
//   - decideView in Node: the full studio for everyone and nothing written down; ?view=simple and ?view=round for that
//     load only; a saved simple view is read as full ("merged"); a storage that throws is survived
//   - the registry: its ids, groups, titles and purposes are the ones in the spec, word for word (Find's Go to index)
//   - a person's browser (no webdriver), clean: the full studio, no .ws-off-* class and no hiding stylesheet, Find in
//     view and no Simple view, More or Full studio button; the Browser and the Inspector wait behind B
//   - someone who had the simple view saved: the full studio, and one line saying so, once
//   - Find: ⌘K, the empty map of the studio, "piano" goes to Notes, Do runs a key's action (L, the loop), a sound row,
//     Go to points at a control, no match says so and offers Ask (⌘Enter composes to the agent), Esc gives focus
//     back; none of it is an undo step
//   - the agent: no workspace tool (nothing is hidden, so there's nothing to add), get_selection says nothing of the
//     layout, and the demo agent answers "where is the mixer" in one line and shows it
//   - ?view=simple, kept for one release: reach-to-reveal (L brings the Loop in with a note), Full studio is one
//     click and is remembered, the URL is cleaned
//   - a phone: no sideways scroll; the Song menu has Find anything
//   - the keys that moved on 2 October say so once, in one line, for all of them
//   node tools/find-test.js      (screenshots: tools/.out/find-*.png)
import fs from 'node:fs';
import path from 'node:path';
import { open, tally, OUTDIR } from './pw.js';

const T = tally('find');
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
  ['Recording', 'record-options', 'Recording options', 'Count-in, layering takes and timing.'],
  ['Agent', 'history', 'History', 'Everything that changed, who changed it, and how to take it back.'],
  ['Agent', 'details', 'Details', 'Exact values for whatever is selected.'],
  ['Agent', 'agent-setup', 'Connect your own agent', 'Use your own Claude, or Claude Code on this computer.'],
  ['Files', 'files', 'Files and reports', 'Import MIDI, audio and devices; export stems, MIDI and DAWproject; who-made-what reports.'],
  ['Layout', 'panes', 'Pane buttons', 'Buttons to show and hide the side and bottom panes.'],
];
const PANEL_OF = { notes: 'pianoroll', beat: 'drumgrid', grooves: 'grooves', jam: 'jam', devices: 'rack', browser: 'browser', mixer: 'mixer', compare: 'reference', history: 'history', details: 'inspector' };
const curly = (s) => s.replace(/'/g, '’');   // the studio sets apostrophes curly
const same = (a, b) => a === b || a === curly(b);

/* ======================================================================== in the page */
// the workspace's buttons, by their words, wherever they sit (the top bar, or the end of the agent pane's tab row)
const wsBits = () => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  const btns = [...document.querySelectorAll('button')].filter(vis);
  const by = (re) => btns.find((b) => re.test(b.textContent.trim()));
  const find = [...document.querySelectorAll('.ws-find-btn')].find(vis);
  const note = document.querySelector('.ew-ws [role=status]') || document.querySelector('.ew-top [role=status]');
  return { find: !!find, findText: find ? find.textContent.trim().replace(/\s+/g, ' ') : null, more: !!by(/^More$/), full: !!by(/^Full studio$/), simple: !!by(/^Simple view$/),
    note: note ? note.textContent.trim().replace(/\s+/g, ' ') : null, noteBtn: !!note?.querySelector('button'), view: window.overdub.ui.workspace?.view?.() || null,
    root: document.documentElement.classList.contains('ws-simple') ? 'simple' : document.documentElement.classList.contains('ws-full') ? 'full' : null,
    off: [...document.documentElement.classList].filter((c) => c.startsWith('ws-off-')), sheet: !!document.querySelector('style[data-css="workspace-off"]') };
};
const visTabs = () => [...document.querySelectorAll('.ew-tab')].filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').map((e) => e.id.replace('ew-tab-', ''));
// Find's popover: its rows (kind, title, key), the hint or no-match line, and where focus is
const findInfo = () => {
  const inp = [...document.querySelectorAll('input[role=combobox]')].find((i) => i.getClientRects().length);
  if (!inp) return null;
  const box = inp.closest('[role=dialog]');
  const r = box.getBoundingClientRect();
  return { text: box.innerText, value: inp.value, focusIn: box.contains(document.activeElement), r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
    heads: [...box.querySelectorAll('.ws-head')].map((x) => x.textContent.trim()), none: box.querySelector('.ws-none')?.textContent.trim() || null,
    rows: [...box.querySelectorAll('[role=option]')].map((x) => ({ kind: x.dataset.kind, ws: x.dataset.ws, title: x.querySelector('.ws-row-t')?.textContent.trim(), key: x.querySelector('.ws-row-key')?.textContent.trim() || null, on: x.getAttribute('aria-selected') === 'true' })) };
};

/* ======================================================================== decideView, in Node */
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
  const dv = (search, storage, webdriver) => decideView({ search, storage, webdriver });
  const clean = dv('', mem(), false), cleanWd = dv('', mem(), true);
  T.ok(clean.view === 'full' && !clean.persist && cleanWd.view === 'full', `a clean browser opens the full studio, with or without webdriver, and nothing is written down (${JSON.stringify(clean)})`);
  for (const k of ['overdub:layout', 'overdub:welcomed', 'overdub:project']) {
    const r = dv('', mem({ [k]: k === 'overdub:welcomed' ? '1' : '{}' }), false);
    T.ok(r.view === 'full', `a browser with ${k} opens the full studio (${r.view})`);
  }
  const merged = dv('', mem({ [KEY]: { v: 1, view: 'simple', added: { mixer: 'you' } } }), false);
  T.ok(merged.view === 'full' && merged.from === 'merged' && !merged.persist, `a saved simple view is read as full, from "merged" (${JSON.stringify(merged)})`);
  const savedFull = dv('', mem({ [KEY]: { v: 1, view: 'full', added: {} } }), false);
  T.ok(savedFull.view === 'full', 'a saved full is kept');
  const url = dv('?view=simple', mem({ [KEY]: { v: 1, view: 'full' } }), false);
  T.ok(url.view === 'simple' && !url.persist && url.from === 'url', `?view=simple opens the simple view for that load only, for one release (${JSON.stringify(url)})`);
  const round = dv('?view=round', mem(), false);
  T.ok(round.view === 'simple' && round.round === true && !round.persist, `?view=round is the Round prototype over the simple view, for that load only (${JSON.stringify(round)})`);
  const odd = dv('?view=wide', mem(), false);
  T.ok(odd.view === 'full', `an unknown ?view is ignored (${odd.view})`);
  let v7 = null, threw = null;
  try { v7 = dv('', mem({ [KEY]: 'not json' }), false).view; } catch (e) { threw = e.message; }
  T.ok(!threw && v7 === 'full', `an unreadable saved layout doesn't throw (${threw || v7})`);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {}, key: () => null, length: 0 };
  let v8 = null, threw8 = null;
  try { v8 = dv('', broken, false).view; } catch (e) { threw8 = e.message; }
  T.ok(!threw8 && v8 === 'full', `storage that throws (a private window, blocked site data) doesn't throw (${threw8 || v8})`);
});

/* ======================================================================== the studio */
const s = await open('/app/', { width: 1440, height: 900 });
const pages = [];
const hideWebdriver = () => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }); };
// a fresh browser context (clean storage) on the same server
async function fresh({ w = 1440, h = 900, query = '', mobile = false, init = null } = {}) {
  const ctx = await s.browser.newContext({ viewport: { width: w, height: h }, permissions: ['microphone'], ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}) });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const go = async (q = query) => { await page.goto(s.base + '/app/' + (q ? '?' + q : ''), { waitUntil: 'load' }); await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 }); await sleep(600); };
  await go();
  const P = { page, ctx, errors, go, E: (fn, a) => page.evaluate(fn, a), shot: (n) => page.screenshot({ path: path.join(OUTDIR, `find-${n}.png`) }).catch(() => {}) };
  pages.push(P);
  return P;
}
const neutral = (P) => P.E(() => { document.activeElement?.blur?.(); const a = document.querySelector('.ar-scroll'); if (a) a.focus({ preventScroll: true }); });
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

try {
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(700);
  const S = { page: s.page, errors: s.errors, E: (fn, a) => s.page.evaluate(fn, a) };

  /* ---------------------------------------------------------------- the registry */
  await section('registry', async () => {
    const F = await S.E(() => (window.overdub.ui.workspace?.FEATURES || []).map((f) => ({ id: f.id, group: f.group, title: f.title, purpose: f.purpose, the: !!f.the, aliases: f.aliases || [], panels: f.panels || [], where: f.where || '' })));
    T.ok(F.length === SPEC.length, `the registry has the spec's ${SPEC.length} features (${F.length}: ${F.map((f) => f.id).join(', ')})`);
    const off = SPEC.filter(([g, id, t, p]) => { const f = F.find((x) => x.id === id); return !f || f.group !== g || !same(f.title, t) || !same(f.purpose, p); }).map(([, id]) => id);
    T.ok(!off.length, `each feature's id, group, title and purpose are the spec's, word for word${off.length ? ' (not: ' + off.join(', ') + ')' : ''}`);
    const panelsOff = Object.entries(PANEL_OF).filter(([id, panel]) => !F.find((x) => x.id === id)?.panels.includes(panel)).map(([id, panel]) => `${id} → ${panel}`);
    T.ok(!panelsOff.length, `the panel features map to their panels${panelsOff.length ? ' (not: ' + panelsOff.join(', ') + ')' : ''}`);
    T.ok(F.every((f) => f.aliases.length && f.where.length > 6), 'every feature has search words and says where it is');
    const missing = await S.E((ids) => ids.filter((id) => !window.overdub.ui.panels?.has?.(id)), Object.values(PANEL_OF));
    T.ok(!missing.length, `every mapped panel is a panel the studio registers${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
  });

  /* ---------------------------------------------------------------- one studio: a person's clean browser */
  await section('one studio', async () => {
    const P = await fresh({ init: hideWebdriver });
    const w = await P.E(wsBits);
    T.ok(w.view === 'full' && w.root === 'full', `a clean browser (no webdriver) opens the full studio (view ${w.view}, root .ws-${w.root})`);
    T.ok(!w.off.length && !w.sheet, `nothing is put away: no .ws-off-* class and no hiding stylesheet (${w.off.join(' ') || 'none'}; sheet ${w.sheet})`);
    T.ok(w.find && /^Find anything/.test(w.findText) && /K$/.test(w.findText), `Find anything ⌘K is in view ("${w.findText}")`);
    T.ok(!w.more && !w.full && !w.simple, `no More, Full studio or Simple view button (${JSON.stringify({ more: w.more, full: w.full, simple: w.simple })})`);
    const st = await P.E(() => ({ panes: ['left', 'right', 'bottom'].map((r) => window.overdub.ui.isOpen(r)), saved: localStorage.getItem('overdub:workspace'), ball: [...document.querySelectorAll('.tp-beats')].some((e) => e.getClientRects().length > 0) }));
    T.ok(!st.panes[0] && st.panes[1] && st.panes[2], `the agent and the bottom pane open, the Browser and the Inspector behind B (left ${st.panes[0]}, right ${st.panes[1]}, bottom ${st.panes[2]})`);
    T.ok(st.saved == null, `no view is written down (${st.saved})`);
    T.ok(st.ball, 'the beat lights are in the top bar');
    const tabs = await P.E(visTabs);
    T.ok(tabs.length >= 12 && ['mixer', 'pianoroll', 'drumgrid', 'history'].every((t) => tabs.includes(t)), `every tab is showing (${tabs.length}: ${tabs.join(', ')})`);
    // a track header: its instrument (opens big), M, S and R (docs/INSTRUMENTS-UX.md 2.3)
    const hd = await P.E(() => { const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; const h = [...document.querySelectorAll('.ar-head')].find(vis); return h ? { inst: vis(h.querySelector('.ar-hinst')), m: vis(h.querySelector('.ar-hb-mute')), s: vis(h.querySelector('.ar-hb-solo')) } : null; });
    T.ok(hd && hd.inst && hd.m && hd.s, `a track header shows its instrument, M and S (${JSON.stringify(hd)})`);
    // B brings the Browser
    await neutral(P);
    await P.page.keyboard.press('KeyB');
    await sleep(400);
    const bb = await P.E(() => ({ open: window.overdub.ui.isOpen('left'), active: window.overdub.ui.active('left') }));
    T.ok(bb.open && bb.active === 'browser', `B opens the Browser (${JSON.stringify(bb)})`);
    await P.shot('desktop');
  });

  /* ---------------------------------------------------------------- had the simple view saved */
  await section('merged', async () => {
    const seed = () => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('overdub:workspace', JSON.stringify({ v: 1, view: 'simple', added: { mixer: 'you' } })); } } catch (e) { /* ok */ } };
    const P = await fresh({ init: seed });
    await sleep(400);
    const a = await P.E(() => ({ view: window.overdub.ui.workspace.view(), saved: JSON.parse(localStorage.getItem('overdub:workspace') || 'null'), said: localStorage.getItem('overdub:start.merged'), toasts: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent.trim()) }));
    T.ok(a.view === 'full' && a.saved?.view === 'full', `a browser that had the simple view saved opens the full studio, and remembers it (${a.view}; saved ${JSON.stringify(a.saved)})`);
    T.ok(a.toasts.some((t) => /^One studio now: everything.s on screen, and Find \(⌘K\) gets you anywhere\./.test(t)) && a.said === '1', `... and says so once: "${a.toasts.join(' | ')}" (overdub:start.merged ${a.said})`);
    await P.E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
    await P.go();
    const b = await P.E(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent.trim()).filter((t) => /One studio now/.test(t)));
    T.ok(!b.length, `reloaded, it doesn't say it again (${b.join(' | ') || 'quiet'})`);
  });

  /* ---------------------------------------------------------------- Find */
  await section('Find', async () => {
    const P = await fresh();
    const h0 = await P.E(() => window.overdub.store.history.length);
    await neutral(P);
    await P.page.keyboard.press(`${MOD}+KeyK`);
    await sleep(300);
    const e0 = await P.E(findInfo);
    T.ok(e0 && e0.focusIn, `${MOD === 'Meta' ? '⌘' : 'Ctrl+'}K opens Find, its field focused (${!!e0})`);
    T.ok(e0 && /^Every panel is here\. Type what you.re after: mixer, loop, tempo, piano roll\.$/.test(e0.none || ''), `empty, it says "Every panel is here. Type what you’re after…" ("${e0?.none}")`);
    T.ok(e0 && e0.heads.join() === 'Make,Sound,Balance,Song,Recording,Agent,Files,Layout' && e0.rows.length === SPEC.length && e0.rows.every((r) => r.kind === 'go'), `... and maps the studio: ${SPEC.length} Go to rows under ${e0?.heads.join(', ')}`);
    T.ok(e0 && e0.r[0] >= 0 && e0.r[2] <= 1440 && e0.r[1] >= 0 && e0.r[3] <= 900, `it's whole on screen (${e0?.r.join(',')})`);
    // "piano": Go to Notes first; Enter shows the Notes tab and closes Find
    await P.page.keyboard.type('piano');
    await sleep(200);
    const e1 = await P.E(findInfo);
    T.ok(e1 && e1.rows[0]?.kind === 'go' && e1.rows[0]?.ws === 'notes' && e1.rows[0].on, `"piano" finds Go to Notes first, chosen (${e1?.rows.slice(0, 3).map((r) => `${r.kind}:${r.title}`).join(', ')})`);
    T.ok(e1 && e1.rows.at(-1)?.kind === 'ask' && /^Ask Claude: “piano”$/.test(e1.rows.at(-1).title), `the last row asks Claude ("${e1?.rows.at(-1)?.title}")`);
    await P.page.keyboard.press('Enter');
    await sleep(400);
    const g1 = await P.E(() => ({ open: !!document.querySelector('input[role=combobox]'), active: window.overdub.ui.active('bottom'), bottom: window.overdub.ui.isOpen('bottom') }));
    T.ok(!g1.open && g1.bottom && g1.active === 'pianoroll', `Enter goes to Notes: the Notes tab shows, Find closes (${JSON.stringify(g1)})`);
    // "loop": a Go to row and a Do row with its key; Do runs the key's action
    await P.E(() => window.overdub.find.open({ query: 'loop' }));
    await sleep(250);
    const e2 = await P.E(findInfo);
    const doRow = e2?.rows.findIndex((r) => r.kind === 'do' && /^Loop/.test(r.title));
    T.ok(e2 && e2.rows.some((r) => r.kind === 'go' && r.ws === 'loop') && doRow >= 0 && e2.rows[doRow].key === 'L', `"loop" finds Go to Loop and Do ${e2?.rows[doRow]?.title} (key ${e2?.rows[doRow]?.key})`);
    const l0 = await P.E(() => !!window.overdub.store.get().loop?.on);
    for (let i = 0; i < doRow; i++) await P.page.keyboard.press('ArrowDown');
    await P.page.keyboard.press('Enter');
    await sleep(300);
    const l1 = await P.E(() => !!window.overdub.store.get().loop?.on);
    T.ok(l1 !== l0, `Do runs it: the loop turns ${l1 ? 'on' : 'off'}`);
    // Go to a part outside a panel (the Loop button): pointed at for a moment
    await P.E(() => window.overdub.find.open({ query: 'loop' }));
    await sleep(200);
    await P.E(() => document.querySelector('.ws-findpop [role=option][data-ws="loop"]')?.click());
    await sleep(200);
    const pt = await P.E(() => { const el = document.querySelector('.ws-pointed'); return el ? (el.dataset.feature || el.closest('[data-feature]')?.dataset.feature || '') : null; });
    T.ok(pt != null && /\bloop\b/.test(pt), `Go to Loop points at it, a pencil outline on [data-feature~=loop] (${pt})`);
    // a sound: an instrument by its name is a Sound row
    const snd = await P.E(() => { const d = window.overdub.devices.listDevices().find((x) => x.kind === 'instrument' && x.name && x.name.length > 4); return { name: d?.name, rows: window.overdub.find.search(d?.name || '').map((r) => r.kind + ':' + r.title) }; });
    T.ok(snd.rows.some((r) => r === `sound:${snd.name}`), `"${snd.name}" finds its Sound row (${snd.rows.slice(0, 4).join(', ')})`);
    // no match: says so, and the only row asks Claude; ⌘Enter composes it to the agent
    await P.E(() => { window.__composed = null; window.overdub.ui.on('agent:compose', (d) => { window.__composed = d; }); window.overdub.find.open({ query: '' }); });
    await sleep(150);
    await P.page.keyboard.type('zzqx');
    await sleep(200);
    const e3 = await P.E(findInfo);
    T.ok(e3 && e3.none === 'Nothing called that. Ask Claude where it is.' && e3.rows.length === 1 && e3.rows[0].kind === 'ask', `no match: "${e3?.none}", and the one row asks Claude`);
    await P.page.keyboard.press(`${MOD}+Enter`);
    await sleep(300);
    const comp = await P.E(() => ({ c: window.__composed, open: !!document.querySelector('input[role=combobox]') }));
    T.ok(comp.c?.text === 'zzqx' && comp.c?.send === true && !comp.open, `${MOD === 'Meta' ? '⌘' : 'Ctrl+'}Enter asks Claude: the words go to the agent, Find closes (${JSON.stringify(comp.c)})`);
    // Esc gives focus back to the Find button
    await P.E(() => [...document.querySelectorAll('.ws-find-btn')].find((x) => x.getClientRects().length)?.click());
    await sleep(250);
    await P.page.keyboard.press('Escape');
    await sleep(250);
    const esc = await P.E(() => ({ open: !!document.querySelector('input[role=combobox]'), focus: document.activeElement?.classList.contains('ws-find-btn') }));
    T.ok(!esc.open && esc.focus, `Esc closes Find and focus goes back to its button (${JSON.stringify(esc)})`);
    // More's names stay as aliases (ids forever), and none of it was an undo step but the loop
    const al = await P.E(() => typeof window.overdub.ui.workspace.openMore === 'function' && typeof window.overdub.ui.workspace.openFind === 'function');
    T.ok(al, 'ui.workspace.openMore stays, an alias of Find');
    const h1 = await P.E(() => window.overdub.store.history.length);
    T.ok(h1 - h0 === 1, `Find itself is never an undo step: only the loop it toggled is (${h1 - h0} new step)`);
    await P.shot('find');
  });

  /* ---------------------------------------------------------------- a Sound row, run with the Browser closed */
  await section('Find a sound', async () => {
    const P = await fresh();
    // (the Browser is closed on a first visit: a trial started from Find must not be the Browser's, which ends when
    // its pane isn't showing)
    const pick = await P.E(() => {
      const o = window.overdub;
      o.ui.setOpen?.('left', false);
      const t = o.store.get().tracks.find((x) => x.kind === 'instrument');
      const d = o.devices.listDevices().find((x) => x.kind === 'instrument' && x.name && x.id !== t?.instrument?.device);
      o.ui.select({ track: t.id });
      return { track: t.id, device: d.id, name: d.name, left: o.ui.isOpen('left') };
    });
    await neutral(P);
    await P.E((q) => window.overdub.find.open({ query: q }), pick.name);
    await sleep(250);
    const e = await P.E(findInfo);
    const at = e ? e.rows.findIndex((r) => r.kind === 'sound' && r.title === pick.name) : -1;
    T.ok(!pick.left && at >= 0, `with the Browser closed, "${pick.name}" finds its Sound row (row ${at})`);
    for (let i = 0; i < at; i++) await P.page.keyboard.press('ArrowDown');
    await P.page.keyboard.press('Enter');
    await sleep(600);
    const tr = await P.E(() => ({ trying: window.overdub.sounds.trying(), toasts: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent.trim()) }));
    T.ok(tr.trying && tr.trying.track === pick.track && tr.trying.device === pick.device && !tr.toasts.some((t) => /wasn.t kept/.test(t)), `Enter tries it on the track, and the trial stays with the Browser closed (${JSON.stringify(tr.trying)}${tr.toasts.length ? '; ' + tr.toasts.join(' | ') : ''})`);
  });

  /* ---------------------------------------------------------------- a narrow window: Find's button leaves All off clear */
  await section('narrow top bar', async () => {
    const P = await fresh({ w: 660, h: 800 });
    for (const w of [641, 660, 684, 700, 760, 800, 801, 830, 899]) {
      await P.page.setViewportSize({ width: w, height: 800 });
      await sleep(200);
      const r = await P.E(() => {
        const R = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        const kill = document.querySelector('.tp-kill');
        if (!kill || !kill.getClientRects().length) return null;
        const k = R(kill);
        const hit = [...document.querySelectorAll('.ew-top button, .ew-top input, .ew-top a')].filter((e) => e !== kill && !kill.contains(e) && e.getClientRects().length)
          .filter((e) => { const b = R(e); return b.l < k.r - 0.5 && k.l < b.r - 0.5 && b.t < k.b - 0.5 && k.t < b.b - 0.5; }).map((e) => e.textContent.trim().slice(0, 20) || e.className);
        return { k: [Math.round(k.l), Math.round(k.r)], hit };
      });
      T.ok(r && !r.hit.length, `${w} px wide, All off (${r?.k.join('–')}) meets nothing in the top bar${r?.hit.length ? ' (under ' + r.hit.join(', ') + ')' : ''}`);
    }
  });

  /* ---------------------------------------------------------------- the copy */
  await section('copy', async () => {
    const ws = fs.readFileSync(new URL('../app/src/ui/workspace.js', import.meta.url), 'utf8');
    const want = ['Find anything', 'Every panel is here. Type what you’re after: mixer, loop, tempo, piano roll.', 'Nothing called that. Ask Claude where it is.', 'One studio now: everything’s on screen, and Find (⌘K) gets you anywhere.', 'Go to', 'Ask Claude: “', 'Full studio'];
    const miss = want.filter((w) => !ws.includes(w));
    T.ok(!miss.length, `workspace.js carries the spec's words${miss.length ? ' (missing: ' + miss.map((m) => `"${m}"`).join(', ') + ')' : ''}`);
    T.ok(!/✨|sparkle|border-left:\s*[2-9]px|inset\s+\d+px\s+0\s+0|border-radius:\s*(99|50%|\d{2,}px)/.test(ws), 'Find draws no sparkles, no coloured left border and no pills');
  });

  /* ---------------------------------------------------------------- the agent */
  await section('agent', async () => {
    const P = await fresh({ query: 'agent=mock&fast' });
    const r = await P.E(async () => {
      const o = window.overdub;
      const sel = await o.tools.run('get_selection', {}, { by: 'claude' });
      const ws = await o.tools.run('workspace', { action: 'list' }, { by: 'claude' });
      return { listed: o.tools.list().includes('workspace'), studio: sel?.studio ?? null, ws };
    });
    T.ok(!r.listed && /unknown tool/.test(r.ws?.error || ''), `there is no workspace tool: nothing is put away, so there's nothing for an agent to add (${r.ws?.error})`);
    T.ok(r.studio == null, `get_selection says nothing of the layout in the full studio (${JSON.stringify(r.studio)})`);
    // the demo agent: "where is the mixer" shows it and says where, in one line
    await P.E(() => { window.__said = ''; window.overdub.agent?.on?.('text', (e) => { window.__said += e?.delta || ''; }); });
    await P.page.fill('.ag-input', 'where is the mixer');
    await P.page.press('.ag-input', 'Enter');
    await P.page.waitForFunction(() => window.overdub.ui.active('bottom') === 'mixer', null, { timeout: 10000 }).catch(() => {});
    await sleep(800);
    const d = await P.E(() => { const msgs = [...document.querySelectorAll('.ag-msg.ag-agent')]; return { active: window.overdub.ui.active('bottom'), said: (window.__said || msgs.at(-1)?.innerText || '').trim() }; });
    T.ok(d.active === 'mixer', `"where is the mixer" shows the Mixer tab (${d.active})`);
    T.ok(/Mixer/.test(d.said) && /under the song/.test(d.said) && !/\n/.test(d.said) && d.said.length < 160, `... and the demo agent says where in one line ("${d.said}")`);
  });

  /* ---------------------------------------------------------------- ?view=simple, for one release */
  await section('?view=simple', async () => {
    const P = await fresh({ query: 'view=simple' });
    const w = await P.E(wsBits);
    T.ok(w.view === 'simple' && w.root === 'simple' && w.off.length > 0 && w.sheet, `?view=simple still opens the simple view (${w.off.length} features put away)`);
    T.ok(w.find && w.full, `its top bar has Find and Full studio (${JSON.stringify({ find: w.find, full: w.full })})`);
    await neutral(P);
    await P.page.keyboard.press('KeyL');
    await sleep(300);
    const n1 = await P.E(wsBits);
    const loop = await P.E(() => ({ has: window.overdub.ui.workspace.has('loop'), shown: [...document.querySelectorAll('.tp-loop')].some((e) => e.getClientRects().length > 0) }));
    T.ok(loop.has && loop.shown && /^Loop is in your studio now\./.test(n1.note || '') && n1.noteBtn, `reach is reveal: L brings the Loop in, with a note and Put away ("${n1.note}")`);
    const h0 = await P.E(() => window.overdub.store.history.length);
    await P.E(() => [...document.querySelectorAll('button')].find((b) => b.getClientRects().length && b.textContent.trim() === 'Full studio')?.click());
    await sleep(500);
    const a = await P.E(() => ({ view: window.overdub.ui.workspace.view(), saved: JSON.parse(localStorage.getItem('overdub:workspace') || 'null'), q: location.search, hist: window.overdub.store.history.length, off: [...document.documentElement.classList].filter((c) => c.startsWith('ws-off-')).length }));
    T.ok(a.view === 'full' && !a.off && a.saved?.view === 'full' && !/view=/.test(a.q) && a.hist === h0, `Full studio is one click: everything shows, it's remembered, the URL loses ?view, and it isn't an undo step (${JSON.stringify(a)})`);
    await P.go('');
    const b = await P.E(() => window.overdub.ui.workspace.view());
    T.ok(b === 'full', `reloaded, it's the full studio (${b})`);
  });

  /* ---------------------------------------------------------------- a phone */
  await section('phone', async () => {
    const P = await fresh({ w: 390, h: 844, mobile: true });
    const wide = await P.E(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth }));
    T.ok(wide.doc <= wide.vw, `phone: no sideways page scroll (${wide.doc} px in ${wide.vw})`);
    const top = await P.E(() => ['.tp-title', '.tp-play', '.tp-rec', '.sm-btn'].map((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return sel + ' missing'; const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 ? '' : sel + ' off screen'; }).filter(Boolean));
    T.ok(!top.length, `phone: the title, Play, Record and Song are on screen (${top.join(', ') || 'all there'})`);
    await P.E(() => [...document.querySelectorAll('.ew-region-top .sm-btn')].find((x) => x.getClientRects().length)?.click());
    await sleep(400);
    const row = await P.E(() => !![...document.querySelectorAll('.sm-i')].find((x) => x.getClientRects().length && /Find anything/.test(x.textContent)));
    T.ok(row, 'phone: the Song menu has Find anything');
    await P.shot('phone');
  });

  /* ---------------------------------------------------------------- the keys that moved */
  await section('moved keys', async () => {
    const P = await fresh();
    const r = await P.E(() => { const k = window.overdub.ui.keys; return { note: k.movedNote, first: k.firstPress('KeyM'), second: k.firstPress('KeyK'), saved: JSON.parse(localStorage.getItem('overdub:keys-moved') || '{}') }; });
    T.ok(/^Keys changed on 2 October: `M` mutes, `S` solos, `K` is the click\. `\?` lists them all\.$/.test(r.note || ''), `one line for every moved key ("${r.note}")`);
    T.ok(r.first === true && r.second === false && ['KeyM', 'KeyS', 'KeyK', 'shift+KeyK', 'mod+KeyE'].every((k) => r.saved[k]), `said once, for all of them: the first press says it, the next moved key doesn't (${r.first}, ${r.second})`);
  });

  const all = [...s.errors, ...pages.flatMap((p) => p.errors)].filter((e) => !ignorable(e));
  T.ok(!all.length, `no page or console errors${all.length ? ': ' + all.slice(0, 3).join(' | ') : ''}`);
} finally {
  await s.close();
}
T.done();
