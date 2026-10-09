// The Agent tab (region 'right'): talk to the second player, see what every agent (in-app Claude or an outside
// one over MCP) is doing, audition and pick its takes, answer its questions. docs/UX-RESEARCH.md §5 is the brief.
//
// Also boots the agent layer: app.presence (presence.js), app.tools (tools.js), app.agent (claude.js).
//
// ui events it listens to:  'agent:compose' { text, send?, context? } prefill (and maybe send) the input
//                           'agent:tool' / 'agent:say' / 'agent:request' / 'presence:agents' / 'bridge:state'
// keys: '/' focuses the input; Esc stops the agent while it works; ⌘Z / ⇧⌘Z in the empty input are the song's undo / redo.

import { h, css, icon, esc, byline, rawHtml } from '../ui/dom.js';
import { createStore } from '../core/store.js';
import { installPresence } from './presence.js';
import { installTools, scopeLabel, isRecording, cancelRequest } from './tools.js';
import { itemsText, whoseIds } from './keep.js';
import { createAgent, MODELS } from './claude.js';
import { moveOn } from './mock.js';
import * as personal from './lexicon-personal.js';
import { isLocalHost } from './bridge.js';
import { cloudPanel } from './cloud-panel.js';
import { HOSTED_NAME } from './cloud.js';

const FEED_KEY = 'overdub:agent:feed:';
const FEED_MAX = 140;
// The Claude Code command names this checkout's path once the local bridge has reported it; until then a placeholder.
// Off localhost there is no bridge (bridge.js), so the card points at the guide instead of offering a command.
const MCP_CMD = (root) => `claude mcp add overdub -- node ${root || '<path-to-your-overdub-checkout>'}/server/mcp.js`;
const GUIDE_CLAUDE_CODE = '/site/docs/guide.html#bring-claude-code';
const GUIDE_SERVER_KEY = '/site/docs/guide.html#your-own-api-key-on-your-own-server';
let tapPreview = 0;     // the timer that lets go of a tapped take's two-second listen ("Hold to hear")

export default function (app) {
  installPresence(app);
  installTools(app);
  if (!app.agent) app.agent = createAgent(app);
  // The simple view (ui/workspace.js) starts on the demo agent: no key screen, no setup, the ask box and suggestions
  // straight away. Only when nothing else is on (no key, no Claude Code, no agent connected over MCP); the full studio
  // is as it was.
  // Claude Code is known only once its probe answers and an MCP agent once the bridge connects, both after this runs,
  // so the demo it turns on gives way to either when they turn up. It re-decides when the view switches to simple,
  // not on every add or put away (a person who turned the demo off keeps it off).
  demoByDefault(app);
  let lastView = app.ui.workspace?.view?.();
  app.ui.on?.('workspace', ({ view } = {}) => { if (view === 'simple' && lastView !== 'simple') demoByDefault(app); lastView = view; });
  app.agent?.on?.('provider', () => yieldDemo(app));
  app.presence?.on?.((e) => { if (e?.type === 'agents') yieldDemo(app); });
  css('agent-panel', CSS);
  app.ui.panel({ id: 'agent', region: 'right', title: 'Agent', icon: 'agent', order: 10, mount: (el) => mountPanel(el, app) });
}

const isSimple = (app) => app.ui?.workspace?.view?.() === 'simple';
const mcpHere = (app) => { try { return (app.presence?.agents?.() || []).some((a) => a.source === 'mcp' && a.connected !== false); } catch { return false; } };
let autoDemo = false;    // the demo agent is on because the simple view chose it, not the person
function demoByDefault(app) {
  const a = app.agent;
  if (!a || !isSimple(app) || a.provider || mcpHere(app)) return;
  a.useMock(true);
  autoDemo = true;
  // not remembered for the tab: the next load decides again, so Claude Code or a key set meanwhile wins
  try { sessionStorage.removeItem('overdub:agent-mock'); } catch { /* ok */ }
}
const localWanted = (app) => { try { return localStorage.getItem('overdub:agent-local') === '1' && !!app.agent?.local?.available; } catch { return false; } };
function yieldDemo(app) {
  const a = app.agent;
  if (!autoDemo || !a) return;
  if (a.provider !== 'mock') { autoDemo = false; return; }
  if (!mcpHere(app) && !localWanted(app)) return;
  autoDemo = false;
  a.useMock(false);
}

function mountPanel(el, app) {
  const { ui, store, agent } = app;
  el.classList.add('ag');
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* full */ } } };

  /* ---------------------------------------------------------------- state */
  let pid = store.get().id;
  let feed = loadFeed();
  let cur = null;                  // the agent entry being streamed (in-app)
  let showKey = false;
  let held = false;                // a message sent with no agent on: it waits in the box, with the choice under it
  let contextOff = false;
  const bridge = { state: 'off', agents: [] };
  let root = '';
  const nodes = new Map();         // entry -> element
  let dirty = new Set();
  let stickBottom = true;

  /* ---------------------------------------------------------------- frame */
  // The pane is a session log (design/LINER-NOTES-KIT.md): a presence line under the tabs, then who said what with the
  // speaker's name in a margin column, the agent's tool steps as mono lines, its takes as a ruled list; the composer is
  // an underlined field at the foot.
  const who = h('div.ag-who');
  const btnNew = h('button.btn.btn-txt.ag-hbtn', { type: 'button', title: 'Start a new conversation', 'aria-label': 'New conversation', dataset: { feature: 'agent-setup' }, onclick: () => { agent.reset(); feed = []; saveFeed(); renderAll(); } }, 'New');
  const btnKey = h('button.btn.btn-txt.ag-hbtn', { type: 'button', title: 'Agent settings: model, Claude Code, the demo agent', 'aria-label': 'Agent settings', dataset: { feature: 'agent-setup' }, onclick: () => { showKey = !showKey; renderAll(); } }, 'Settings');
  const head = h('div.ag-head', who, h('div.ag-hbtns', btnNew, btnKey));
  const feedEl = h('div.ag-feed', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with your agents' });
  const statusEl = h('div.ag-status', { 'aria-live': 'polite' });
  const ctxRow = h('div.ag-ctxrow');
  const sugRow = h('div.ag-sugs');
  const input = h('textarea.ag-input', { rows: 1, placeholder: 'Ask, or say how it should feel', 'aria-label': 'Message your agent', spellcheck: true });
  const sendBtn = h('button.btn.ag-send', { type: 'button', title: 'Send (Enter)', onclick: () => send() }, 'Send');
  const stopBtn = h('button.btn.btn-rec.ag-stop', { type: 'button', title: 'Stop (Esc)', 'aria-label': 'Stop the agent', onclick: () => agent.stop(), hidden: true }, icon('stop', { size: 12 }), h('span', 'Stop'));
  const hint = h('div.ag-hint', h('kbd', /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘/' : 'Ctrl /'), ' asks from anywhere, ', h('kbd', 'Enter'), ' sends, ', h('kbd', '⇧Enter'), ' new line');
  // Claude on Overdub credits (agent/cloud-panel.js): only when the deploy names its service
  const cu = cloudPanel({ app, agent, h, byline, input, grow, push, renderAll, renderHead, openOwn, useDemo, closeSettings: () => { showKey = false; held = false; } });
  const box = h('div.ag-box', ctxRow, h('div.ag-inrow', input, sendBtn, stopBtn), cu.row);
  const heldEl = h('div.ag-held', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const composer = h('div.ag-composer', statusEl, sugRow, heldEl, box, hint);
  el.append(head, feedEl, composer);
  let lastAsk = '';               // what was last sent, for the box to get it back when credits stop it (sign in, top up)

  feedEl.addEventListener('scroll', () => { stickBottom = feedEl.scrollTop + feedEl.clientHeight >= feedEl.scrollHeight - 30; });

  /* ---------------------------------------------------------------- feed persistence */
  function loadFeed() {
    let list = [];
    try { const s = ls.get(FEED_KEY + pid); list = s ? JSON.parse(s).filter((e) => e && e.k && e.action !== 'retired') : []; } catch { list = []; }
    // the retired-key note is never saved with a song: it rides at the end of whichever song is open until it is
    // dismissed, so opening another song first doesn't lose it
    if (agent.keyRetired) list.push({ k: 'note', kind: 'ok', action: 'retired', at: Date.now() });
    return list;
  }
  let saveT = 0;
  function saveFeed() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const list = feed.filter((e) => e.action !== 'retired').slice(-FEED_MAX).map((e) => (e.k === 'request' ? { ...e, live: false } : e));
      ls.set(FEED_KEY + pid, JSON.stringify(list));
    }, 300);
  }
  function push(entry) {
    entry.at = entry.at || Date.now();
    feed.push(entry);
    if (feed.length > FEED_MAX * 1.5) { for (const e of feed.splice(0, feed.length - FEED_MAX)) nodes.get(e)?.remove(); }
    mark(entry);
    saveFeed();
    return entry;
  }
  function mark(entry) { dirty.add(entry); }
  // a card redrawn under the keyboard (Keep on a take turns it into a done card): focus stays on it, not on <body>
  function keepFocusIn(el) {
    const f = el.querySelector('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])');
    if (f) { f.focus({ preventScroll: true }); return; }
    el.tabIndex = -1; el.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- render */
  // The feed is a role=log live region, so entries are patched in place (morph), never swapped: a screen reader then
  // hears what was added (a chip, the next words), not the whole turn again. Settings, a new provider or a bridge change
  // only add or remove the key card and the welcome; the entries stay the same nodes.
  function renderAll() {
    for (const x of [...feedEl.children]) if (x.matches('.ag-keycard, .ag-welcome')) x.remove();
    // the hosted agent's sheet stays the same node while nothing on it changed, so a field keeps its focus and words
    const cs = cu.sheet();
    for (const x of [...feedEl.children]) if (x.matches('.ag-cl') && x !== cs) x.remove();
    if (cs && feedEl.firstChild !== cs) feedEl.prepend(cs);
    const top = [];
    if (showKey || !agent.provider) top.push(keyCard());
    if (!feed.length && agent.provider && !showKey && !cs) top.push(welcome());
    if (cs) cs.after(...top); else feedEl.prepend(...top);
    const keep = new Set(feed);
    for (const [e, n] of nodes) if (!keep.has(e)) { n.remove(); nodes.delete(e); }
    for (const e of feed) {
      const old = nodes.get(e), n = renderEntry(e);
      if (!n) { old?.remove(); nodes.delete(e); continue; }
      if (old) nodes.set(e, patchEntry(old, n)); else { feedEl.append(n); nodes.set(e, n); }
    }
    dirty = new Set();
    renderHead(); renderComposer();
    requestScroll(true);
  }
  function flush() {
    if (!dirty.size) return;
    const list = [...dirty]; dirty = new Set();
    let added = false;
    for (const e of list) {
      const old = nodes.get(e);
      if (!feed.includes(e)) { old?.remove(); nodes.delete(e); continue; }
      const n = renderEntry(e);
      if (!n) { old?.remove(); nodes.delete(e); continue; }
      if (old) { const had = old.contains(document.activeElement); const nn = patchEntry(old, n); nodes.set(e, nn); if (had && !nn.contains(document.activeElement)) keepFocusIn(nn); }
      else { feedEl.querySelector('.ag-welcome')?.remove(); n.classList.add('ag-new'); feedEl.append(n); added = true; nodes.set(e, n); }
    }
    requestScroll(added);
  }
  function requestScroll(force) { if (force || stickBottom) requestAnimationFrame(() => { feedEl.scrollTop = feedEl.scrollHeight; }); }

  function nameOf(by) { return store.author(by).name; }
  function time(at) { const d = new Date(at); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  // the margin column of the session log: who is speaking, signed in their ink (the house is unsigned, so it leaves
  // the margin empty), and how they're here ("demo", "over MCP") in pencil under the name
  function speaker(by, at, via) {
    const name = byline(by, { app, cap: true, title: at ? time(at) : null });
    return h('div.ag-spk', name || h('span.t3', nameOf(by)), via ? h('span.ag-via', via) : null);
  }

  function renderEntry(e) {
    switch (e.k) {
      case 'user': return h('div.ag-msg.ag-user', { dataset: { k: 'user' } },
        speaker('you', e.at),
        h('div.ag-body', h('div.ag-text', { html: rawHtml(md(e.text)) }), e.context ? h('div.ag-ctx-sent', 'on ', h('span', e.context)) : null));
      case 'agent': case 'say': {
        // an agent turn reads as a story: text, what it did (steps), more text…, in the order it happened
        const parts = e.parts || [...((e.chips || []).length ? [{ t: 'chips', chips: e.chips }] : []), ...(e.text ? [{ t: 'text', text: e.text }] : [])];
        // text, then (the demo agent) its numbers as a quieter line under it, its moves, its tool steps
        const body = parts.map((p) => (p.t === 'text' ? (p.text.trim() ? h('div.ag-text', { html: rawHtml(md(p.text.trim())) }) : null) : p.t === 'fine' ? h('div.ag-fine', p.text) : p.t === 'moves' ? movesEl(p) : stepsEl(p.chips)));
        const upd = e.update && e.live ? h('div.ag-update', e.update) : null;
        const typing = e.live && !parts.some((p) => (p.t === 'text' || p.t === 'fine' ? p.text.trim() : p.t === 'moves' ? p.moves.length : p.chips.length)) ? h('div.ag-typing', 'thinking') : null;
        return h(`div.ag-msg.ag-agent${e.cont ? '.ag-cont' : ''}`, { dataset: { k: e.k, by: e.by }, 'aria-busy': e.live ? 'true' : null },
          e.cont ? h('div.ag-spk') : speaker(e.by, e.at, e.via),
          h('div.ag-body', body, upd, typing));
      }
      case 'activity': return h('div.ag-msg.ag-activity', { dataset: { k: 'activity', by: e.by } },
        speaker(e.by, e.at, /^mcp:|^claude\.ai$/.test(e.by || '') ? 'over MCP' : ''),
        h('div.ag-body', stepsEl(e.chips || [])));
      case 'note': return h(`div.ag-note.ag-note-${e.kind || 'info'}`, { dataset: e.action ? { action: e.action } : {} }, h('div.ag-spk'), h('div.ag-body', h('p', e.action === 'retired' ? retiredText() : e.text),
        e.action === 'key' ? h('button.btn', { type: 'button', onclick: () => { showKey = true; renderAll(); } }, 'Open settings') : null,
        e.action === 'retired' ? h('div.ag-kc-acts',
          app.remote ? h('button.btn', { type: 'button', onclick: () => ui.show('connect') }, 'Open Connect') : null,
          h('button.btn', { type: 'button', onclick: () => openOwn() }, 'Use your own Claude'),
          h('button.btn.btn-txt.ag-link.ag-note-x', { type: 'button', onclick: () => { agent.retiredSeen(); feed.splice(feed.indexOf(e), 1); mark(e); saveFeed(); flush(); input.focus(); } }, 'Dismiss')) : null));
      case 'request': return requestCard(e);
      default: return null;
    }
  }

  const seenChips = new WeakSet();
  // the demo agent's real moves, offered when an ask was past its script: each one sends itself; "Use a live agent"
  // opens the setup sheet (Claude Code, here or over MCP)
  function movesEl(p) {
    return h('div.ag-moves', { role: 'group', 'aria-label': p.live ? 'What the demo agent can do' : 'What the agent offers' },
      p.live ? h('span.t3', 'Try ') : null,
      ...(p.moves || []).map((m) => h('button.btn.btn-txt.ag-sug.ag-move', { type: 'button', onclick: () => send(m) }, m)),
      p.live ? h('button.btn.btn-txt.ag-link.ag-move-live', { type: 'button', onclick: () => { showKey = true; renderAll(); } }, 'Use a live agent') : null);
  }
  // Tool steps are mono lines: the verb in a column, then what it touched ("listened  Bass, bars 1–4"). Each still
  // points at what it touched when clicked.
  function stepsEl(chips) { return h('div.ag-chips', chips.map(chipEl)); }
  function chipEl(c) {
    const kind = (c.kind === 'error' ? '.ag-chip-err' : c.live ? '.ag-chip-live' : '') + (seenChips.has(c) ? '' : '.ag-new');
    seenChips.add(c);
    const [verb, rest] = splitStep(c.text, c.kind === 'error');
    const b = h(`button.ag-chip${kind}`, { type: 'button', title: c.full || c.text, onclick: () => pointAt(c) }, h('b.ag-chip-v', verb + ' '), h('span', rest + (c.live ? '…' : '')));
    b._key = c;
    return b;
  }
  function pointAt(c) {
    const tg = c.target;
    if (!tg) return;
    const track = tg.tracks?.[0], clip = tg.clips?.[0];
    if (track || clip) {
      ui.select({ track: track || null, clip: clip || null, notes: [] });
      app.presence.highlight({ track, clip }, c.text, c.by || 'claude', 3000);
    }
  }

  /* ---------------------------------------------------------------- cards */
  // the takes' letters on screen: A, B, C for the agent's takes in their shuffled order; the original goes last, as
  // "as it was" (the cards' own letters count the original among them)
  const takesOf = (req) => [...req.cards.filter((c) => !c.original), ...req.cards.filter((c) => c.original)];
  const letterOf = (req, c) => (c.original ? '' : 'ABCDE'[req.cards.filter((x) => !x.original).indexOf(c)] || c.letter);
  const plainTitle = (s) => String(s || '').replace(/ › | · /g, ', ');
  function requestCard(e) {
    const req = app.tools.requests.get(e.id);
    if (!req || req.status !== 'pending') {
      const r = req?.result || null;
      const text = e.summary || (req ? summarize(req) : 'Closed');
      return h('div.ag-card.ag-card-done', { dataset: { k: 'request' } }, h('div.ag-spk'),
        h('div.ag-body', h('span', text),
          r && r.txn && store.history.some((t) => t.id === r.txn) ? h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => { const u = store.undo({ by: req.by }); ui.toast(u.ok ? `Undid "${u.txn.label}"` : u.error); } }, 'Undo') : null));
    }
    // a card another module draws (the community shelf's suggestion: ui/community.js); its words and buttons are its own
    if (typeof req.render === 'function') { try { return req.render({ speaker }); } catch (err) { console.error('overdub: a card failed to draw', err); } }
    if (req.kind === 'question') {
      const waiting = isRecording(app);
      return h('div.ag-card.ag-q', { dataset: { k: 'request', id: req.id } },
        speaker(req.by, req.at),
        h('div.ag-body',
          h('p.ag-q-text', req.question),
          waiting ? h('p.ag-muted', 'I’ll wait until you stop recording.') : h('div.ag-q-opts', req.options.map((o, i) => h('button.ag-opt', { type: 'button', onclick: () => { app.tools.answer(req.id, i); } }, h('kbd', String(i + 1)), h('span', o)))),
          h('button.btn.btn-txt.ag-link.ag-dismiss', { type: 'button', onclick: () => cancelRequest(app, req.id, 'dismissed') }, 'Skip')));
    }
    if (req.keep) return keepCard(req);
    // variations: one ruled list under a sheet head, a big cool letter per take, the original last as "as it was"
    const list = h('ol.ag-takes');
    for (const c of takesOf(req)) {
      const L = letterOf(req, c);
      // the label says what you're hearing while it's held ("Hearing A"); CSS swaps the two words on .ag-take.on
      const { hold, tip } = holdButton(req, c, '.ag-take', `Hold to hear ${c.original ? 'the original' : `${L}, ${c.label}`}`, c.original ? 'Hearing it as it was' : `Hearing ${L}`);
      const keep = h('button.btn.ag-keep', { type: 'button', onclick: () => { app.tools.answer(req.id, c.index); } }, c.original ? 'Keep as it was' : 'Keep');
      const roll = c.original ? null : takeRoll(req, c);
      const card = h(`li.ag-take${c.original ? '.ag-take-orig' : ''}`, { dataset: { index: c.index } },
        c.original ? h('span.ag-letter.disp-s', { 'aria-hidden': 'true' }, 'as it', h('br'), 'was') : h('span.ag-letter.num', { 'aria-hidden': 'true' }, L),
        h('div.ag-take-body',
          h('div.ag-take-h', h('b', c.original ? 'Original' : c.label)),
          c.original ? null : c.why ? h('div.ag-take-why', c.why) : null,
          roll ? roll.svg : null,
          diffLine(c, roll),
          h('div.ag-take-btns', hold, keep, roll?.count ? h('span.mono.t3.ag-take-n', roll.count) : null), tip));
      list.append(card);
    }
    const [head, where] = String(req.title || '').split(' · ');
    const n = req.cards.length - 1;
    return h('section.ag-card.ag-vars', { dataset: { k: 'request', id: req.id }, 'aria-label': `${nameOf(req.by)}’s takes: ${plainTitle(req.title)}` },
      h('div.ag-card-h',
        h('header.sheet-head', h('h4.ag-card-t', plainTitle(head)), where ? h('span.aside.mono', where) : null),
        h('p.ag-offer', byline(req.by, { app, cap: true }) || nameOf(req.by), req.lexicon ? ' asks which you mean.' : ` offers ${['', 'one take', 'two takes', 'three takes', 'four takes'][n] || `${n} takes`}.`),
        req.reason ? h('p.ag-muted.ag-reason', req.reason) : null),
      list,
      h('div.ag-card-foot', h('span.ag-muted', 'Order is shuffled; none is recommended.'), h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => cancelRequest(app, req.id, 'dismissed') }, 'None of these')));
  }
  // Hold to hear a take: it plays while held. A finger's tap (let go inside 300 ms) plays two seconds of it, then lets go
  // by itself, and the card says to hold to keep listening. A mouse is as it always was: it plays while the button's
  // down. One take plays at a time, so there is one preview timer: starting any take cancels the last one's. rowSel: the
  // element that lights while held (CSS swaps "Hold to hear" for the hearing words on it).
  function holdButton(req, c, rowSel, aria, hearing) {
    let downAt = 0;
    // (the row is looked up from the button, not this render's element: the feed patches entries in place, so the
    // button on screen can belong to an earlier render's row)
    const row = () => hold.closest(rowSel);
    const heldOn = () => { clearTimeout(tapPreview); tapPreview = 0; document.querySelectorAll('.ag-take.on, .ag-asks.on').forEach((e) => e.classList.remove('on')); app.tools.audition(req.id, c.index, true); row()?.classList.add('on'); };
    const heldOff = () => { clearTimeout(tapPreview); tapPreview = 0; app.tools.audition(req.id, c.index, false); row()?.classList.remove('on'); };
    const tip = h('div.ag-take-tip', { 'aria-live': 'polite' });
    const hold = h('button.btn.ag-hold', { type: 'button', title: 'Hold to hear it; let go to go back', 'aria-label': aria }, icon('play', { size: 10 }),
      h('span.ag-hold-idle', 'Hold to hear'), h('span.ag-hold-on', hearing));
    hold.addEventListener('pointerdown', (ev) => { ev.preventDefault(); hold.setPointerCapture?.(ev.pointerId); downAt = ev.pointerType === 'mouse' ? 0 : performance.now(); heldOn(); });
    hold.addEventListener('pointerup', () => {
      if (downAt && performance.now() - downAt < 300) {
        downAt = 0;
        const t = row()?.querySelector('.ag-take-tip') || tip;
        t.textContent = 'That was two seconds. Hold to keep listening.';
        tapPreview = setTimeout(heldOff, 2000);
        return;
      }
      downAt = 0; heldOff();
    });
    for (const t of ['pointercancel', 'lostpointercapture']) hold.addEventListener(t, () => { if (!tapPreview) heldOff(); });
    hold.addEventListener('keydown', (ev) => { if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) { ev.preventDefault(); heldOn(); } });
    hold.addEventListener('keyup', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') heldOff(); });
    return { hold, tip };
  }
  // What a card to Keep takes away, as a sentence with its bylines: "delete Bass (Sam’s part) and replace the notes in
  // Hook on Keys (Sam’s)", every author in their ink (agent/keep.js items).
  function takesWords(items) {
    const seen = new Set(), list = [];
    for (const it of items || []) { const k = `${it.verb} ${it.what} ${whoseIds(it).join(',')}`; if (!seen.has(k)) { seen.add(k); list.push(it); } }
    const shown = list.slice(0, 3), out = [];
    shown.forEach((it, i) => {
      if (i) out.push(i === shown.length - 1 && list.length <= 3 ? ' and ' : ', ');
      out.push(`${it.verb} ${it.what}`);
      const ids = whoseIds(it);
      if (!ids.length) return;
      out.push(' (');
      ids.forEach((id, j) => {
        if (j) out.push(j === ids.length - 1 ? ' and ' : ', ');
        if (id === 'you') out.push(byline('you', { app, name: it.part ? 'your' : 'yours' }));
        else out.push(byline(id, { app }) || nameOf(id), '’s');
      });
      out.push(it.part ? ' part)' : ')');
    });
    if (list.length > 3) out.push(`, and ${list.length - 3} more`);
    return out;
  }
  // A card to Keep (a song from a link: agent/keep.js): what the agent wants to do, in one line with its bylines, its
  // take (the notes it would leave, hold to hear it), and Keep / Keep as it was. New code has no Hold to hear: hearing it
  // would run it, and Keep runs the device check first.
  function keepCard(req) {
    const take = req.cards.find((c) => !c.original), orig = req.cards.find((c) => c.original);
    const code = !!req.keep.code, busy = !!req.checking;
    const roll = code ? null : takeRoll(req, take);
    const { hold, tip } = code ? { hold: null, tip: null } : holdButton(req, take, '.ag-asks', `Hold to hear it ${take.label ? `(${take.label})` : ''}`.trim(), 'Hearing it');
    // (the mono diff only when the take does more than the sentence names: a track it adds, where a device goes)
    const more = take.ops.length > (req.keep.items || []).length;
    return h('section.ag-card.ag-asks', { dataset: { k: 'request', id: req.id }, 'aria-label': `${nameOf(req.by)} asks first: ${req.keep.words}`, 'aria-busy': busy ? 'true' : null },
      h('div.ag-spk'),
      h('div.ag-body',
        h('p.ag-asks-line', byline(req.by, { app, cap: true }) || nameOf(req.by), ' wants to ', ...takesWords(req.keep.items), '.'),
        req.reason ? h('p.ag-muted.ag-reason', req.reason) : null,
        roll ? roll.svg : null,
        more ? diffLine(take, roll) : null,
        hold ? h('div.ag-take-btns', hold, roll?.count ? h('span.mono.t3.ag-take-n', roll.count) : null) : null,
        tip,
        h('div.ag-take-btns',
          h('button.btn.ag-keep', { type: 'button', disabled: busy, onclick: () => { app.tools.answer(req.id, take.index); } }, busy ? 'Checking it…' : 'Keep'),
          h('button.btn.ag-keep.ag-keep-orig', { type: 'button', disabled: busy, onclick: () => { app.tools.answer(req.id, orig.index); } }, 'Keep as it was')),
        h('p.ag-asks-fine', code ? 'It’s new code: it runs on this computer once you keep it, after the device check.' : req.keep.fine || (app.share?.listening ? 'The song came from a link, so this waits for you.' : 'It was asked while the song came from a link. The song is yours now, and this still waits for you.'))));
  }
  // what a take changes, in mono; when the roll already shows its notes, only what the roll can't (a knob, a device).
  // A card's diff is in words (agent/diff.js: a param by its label and unit, a device by its name), since the person
  // reads it to decide (FRESH-EYES-6 agent builder #9: "Keys: + Snapper insert th -62 (default) → -80 dB").
  function diffLine(c, roll) {
    if (c.original || !c.diff?.length) return null;
    const lines = roll ? c.diff.filter((x) => !/\bnotes?\b/.test(x)) : c.diff;
    return lines.length ? h('div.ag-take-diff', lines.slice(0, 2).join(', ').replace(/ · /g, ', ')) : null;
  }
  // A take's preview roll: its notes in the part it changes, the ones already there in pencil and the agent's in cool
  // (the one place cool ink fills a note). Worked out once per take on a scratch copy of the song; a take that doesn't
  // touch notes (a knob, a device) has no roll.
  const rolls = new WeakMap();
  function takeRoll(req, c) {
    if (rolls.has(c)) return rolls.get(c);
    let out = null;
    try {
      const before = store.get();
      const scratch = createStore(JSON.parse(JSON.stringify(before)), { getDevice: app.devices?.getDevice });
      if (scratch.dispatch(c.ops || [], { by: req.by }).ok) {
        const old = new Map();
        for (const t of before.tracks) for (const k of t.clips) if (k.kind !== 'audio') old.set(k.id, k);
        for (const t of scratch.get().tracks) {
          for (const k of t.clips) {
            if (k.kind === 'audio' || !(k.notes || []).length) continue;
            const was = old.get(k.id);
            const seen = new Map((was?.notes || []).map((n) => [n.id, n]));
            const same = (n) => { const o = seen.get(n.id); return o && o.p === n.p && o.t === n.t && o.d === n.d; };
            const added = k.notes.filter((n) => !same(n)).length;
            const gone = was ? was.notes.filter((o) => !k.notes.some((n) => n.id === o.id)).length : 0;
            if (!added && !gone) continue;
            out = { svg: rollSvg(k, same), count: [added ? `+${added} note${added === 1 ? '' : 's'}` : '', gone ? `−${gone}` : ''].filter(Boolean).join(', ') };
            break;
          }
          if (out) break;
        }
      }
    } catch { out = null; }
    rolls.set(c, out);
    return out;
  }
  function rollSvg(k, same) {
    const len = Math.max(1, Number(k.length) || 4);
    const ps = k.notes.map((n) => n.p);
    const lo = Math.min(...ps) - 1, hi = Math.max(...ps) + 1, rows = Math.max(6, hi - lo + 1);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ag-roll');
    svg.setAttribute('viewBox', `0 0 ${len} ${rows}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const bpb = 4;
    for (let b = bpb; b < len; b += bpb) { const r = document.createElementNS(NS, 'rect'); r.setAttribute('class', 'bl'); r.setAttribute('x', b); r.setAttribute('y', 0); r.setAttribute('width', len / 400); r.setAttribute('height', rows); svg.append(r); }
    for (const n of k.notes) {
      if (!(n.t < len)) continue;
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', n.t); r.setAttribute('y', hi - n.p + 0.15);
      r.setAttribute('width', Math.max(len / 160, Math.min(n.d, len - n.t) * 0.92)); r.setAttribute('height', 0.7);
      if (!same(n)) r.setAttribute('class', 'x');
      svg.append(r);
    }
    return svg;
  }
  function summarize(req) {
    const r = req.result || {};
    if (typeof req.summarize === 'function') { try { return req.summarize(req); } catch { return 'Closed'; } }
    if (req.kind === 'question') return r.answer ? `${req.question} You said “${r.answer}”.` : `${req.question} Skipped.`;
    if (req.keep) {
      const who = nameOf(req.by), items = req.keep.items;
      if (r.kept) return `You kept it: ${who} ${itemsText(items, nameOf, { past: true })}.`;
      if (r.refused) return `It didn’t pass the device check (${r.reason}), so nothing changed.`;
      if (r.error) return `It couldn’t be kept (${r.error}).`;
      if (/closed/.test(r.note || '')) return `The song closed before you chose, so ${who} didn’t ${itemsText(items, nameOf)}.`;
      return `You kept it as it was: ${who} didn’t ${itemsText(items, nameOf)}.`;
    }
    if (r.index === -1 || r.picked === 'original') return `${plainTitle(req.title)}: you kept the original`;
    const c = req.cards.find((x) => x.index === r.index);
    return `${plainTitle(req.title)}: you kept ${c ? letterOf(req, c) + ', ' : ''}${r.picked}${r.error ? ` (it couldn't be applied: ${r.error})` : ''}${r.learned && req.lexicon ? `. Kept as your “${req.lexicon.word}”.` : ''}`;
  }

  // Bring your own Claude: a plain sheet. A head on a rule, how your own Claude gets in (the studio keeps no API key),
  // the models as a short list (a lamp on the one in use) when something here uses them, your words, then the ways in:
  // the demo agent, Claude Code, and on a local server a self-hoster's own key, held by the server.
  // The first look (no agent on yet, settings not asked for) puts the demo agent first, as the region's one primary: a
  // newcomer tries the agent before setting anything up. With an agent connected over MCP, that agent leads instead
  // and the demo agent is a plain button under it (FRESH-EYES-6 agent builder: Claude Code was here and the tab still
  // led with "Try the demo agent"). (The class keeps its old name, .ag-keycard: the checks and the styles find it so.)
  function keyCard() {
    const first = !agent.provider && !showKey;
    const live = bridge.agents.filter((a) => a.connected);
    const cc = agent.local?.available, serverKey = !!agent.local?.key;
    const lead = first && live.length > 0, firstDemo = first && !lead && !cc;
    const models = h('div.ag-models', { role: 'radiogroup', 'aria-label': 'Model' }, MODELS.map((m) => h(`button.ag-model${agent.model === m.id ? '.on' : ''}`, { type: 'button', role: 'radio', 'aria-checked': String(agent.model === m.id), onclick: () => { agent.setModel(m.id); renderAll(); } }, h('b', m.name), h('span', m.blurb))));
    const cmd = MCP_CMD(root);
    const copy = h('button.btn', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(cmd); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); } catch { ui.toast('Select the command and copy it (the clipboard is blocked here)'); } } }, 'Copy');
    // Claude Code on this computer, answering in this panel on the person's Claude plan (agent/claude.js, 'local')
    const ccBtn = h(first ? 'button.btn.btn-go.ag-cc-use' : 'button.btn.ag-cc-use', { type: 'button', onclick: () => useLocal(!(agent.provider === 'local')) }, agent.provider === 'local' ? 'Turn Claude Code off' : 'Use Claude Code here');
    // (an agent already connected over MCP leads instead: it's the one in the room)
    const ccLead = first && cc && !lead ? h('div.ag-kc-first.ag-kc-cc',
      h('header.sheet-head', h('h3', 'Claude Code is on this computer')),
      h('p.ag-kc-p', 'Talk to it here, in this panel: it runs on this computer, signed in with your Claude plan, so there is nothing to pay Overdub and no key to paste. It uses only the studio’s tools, and every move is signed in History and undoable.'),
      h('div.ag-kc-acts', ccBtn)) : null;
    const demo = h(firstDemo ? 'button.btn.btn-go.ag-demo' : 'button.btn.ag-demo', { type: 'button', onclick: () => useDemo() }, icon('agent', { size: 14 }), agent.provider === 'mock' ? 'Demo agent is on' : 'Try the demo agent (free)');
    const demoSec = firstDemo
      ? h('div.ag-kc-first',
        h('header.sheet-head', h('h3', 'Try the agent')),
        h('p.ag-kc-p', 'Ask, or say how it should feel. The demo agent plays along, signed and undoable.'),
        h('div.ag-kc-acts', demo))
      : h('div.ag-kc-sec',
        h('p.head', 'Demo agent'),
        h('p.ag-kc-small', 'A scripted session that uses the real tools on this song. Everything it does is real and undoable.'),
        h('div.ag-kc-acts', demo,
          agent.provider === 'mock' ? h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => { agent.useMock(false); renderAll(); } }, 'Turn the demo agent off') : null));
    // a connected agent first: who is here, and where to talk to it
    const one = live.length === 1, names = [];
    live.forEach((a, i) => { if (i) names.push(i === live.length - 1 ? ' and ' : ', '); names.push(byline(a.by || 'mcp:' + a.name, { app, name: a.name }) || a.name); });
    const mcpLead = lead ? h('div.ag-kc-first.ag-kc-mcp',
      h('header.sheet-head', h('h3', ...names, one ? ' is connected' : ' are connected')),
      h('p.ag-kc-p', `${one ? 'It works' : 'They work'} in this tab over MCP: talk to ${one ? 'it' : 'them'} where you run ${one ? 'it' : 'them'}. What ${one ? 'it does' : 'they do'} shows up here and in History, signed with ${one ? 'its name' : 'their names'}.`)) : null;
    // the first look is the demo agent alone (or a connected agent, then the demo agent); the models and Claude Code
    // fold behind one link (Settings and the link open the whole card)
    if (first) {
      return h('div.ag-keycard.ag-kc-firstlook', ccLead, mcpLead, demoSec,
        h('div.ag-kc-own',
          h('button.btn.btn-txt.ag-link.ag-kc-ownbtn', { type: 'button', dataset: { feature: 'agent-setup' }, onclick: () => openOwn() }, 'Use your own Claude'),
          h('p.ag-kc-small', { dataset: { feature: 'agent-setup' } }, `A live model that reads every word, on your Claude plan: ${app.remote ? 'claude.ai through the Connect tab, or ' : ''}Claude Code.`)),
        cu.setupRow(true));
    }
    // a self-hoster's own API key lives on the local server, never on this page (server/local-claude.js)
    const keySec = isLocalHost() ? h('div.ag-kc-sec.ag-kc-server',
      h('p.head', 'Your own API key'),
      h('p.ag-kc-small', serverKey
        ? (agent.provider === 'claude'
          ? 'On: this panel uses the API key set on your local server (OVERDUB_ANTHROPIC_KEY). The page never sees it, and Anthropic bills you for what you use. The model above is the one it uses.'
          : 'Your local server holds an API key (OVERDUB_ANTHROPIC_KEY). This panel uses it when Claude Code and the demo agent are off.')
        : ['Self-hosting with an API key? Start the server with OVERDUB_ANTHROPIC_KEY set and this panel uses it. The key stays on the server, never in the page. ', h('a', { href: GUIDE_SERVER_KEY, target: '_blank', rel: 'noopener' }, 'Your own API key'), ', in the guide, says how.'])) : null;
    return h('div.ag-keycard',
      h('header.sheet-head', h('h3', { tabindex: '-1' }, 'Bring your own Claude')),
      h('p.ag-kc-p', `Your own Claude works the studio from outside this page, on your Claude plan: ${app.remote ? 'claude.ai through the Connect tab, or ' : ''}Claude Code on your computer. The studio keeps no API key.`),
      cc || serverKey ? [h('div.ag-kc-label', 'Model'), models] : null,
      wordsList(),
      demoSec,
      cu.setupRow(),
      // claude.ai (the web and the Claude apps) through the hosted relay: the Connect tab has the link and the steps
      app.remote ? h('div.ag-kc-sec.ag-kc-remote',
        h('p.head', 'claude.ai'),
        h('p.ag-kc-small', 'Add this studio to claude.ai as a custom connector; Claude then plays in this tab. The Connect tab has the link and the three steps.'),
        h('div.ag-kc-acts', h('button.btn', { type: 'button', onclick: () => ui.show('connect') }, 'Open Connect'))) : null,
      h('div.ag-kc-sec',
        h('p.head', 'Claude Code'),
        ...(cc ? [
          h('p.ag-kc-small', agent.provider === 'local'
            ? `On: this panel talks to Claude Code ${agent.local.version ? `${agent.local.version} ` : ''}on this computer, on your Claude plan. The model above is the one it uses.${agent.plan ? ` ${planWindows(agent.plan).title}` : ''}`
            : 'Talk to Claude Code from this panel: it runs on this computer, signed in with your Claude plan, with only the studio’s tools.'),
          h('div.ag-kc-acts', ccBtn),
        ] : []),
        ...(isLocalHost() ? [
          h('p.ag-kc-small', cc ? 'Or drive it from your own Claude Code session (MCP). Run this once in a terminal:' : 'Or drive the studio from Claude Code (MCP). Run this once in a terminal:'),
          h('div.ag-cmd', h('code', cmd), copy),
          h('p.ag-kc-small', live.length ? `Connected: ${live.map((a) => a.name).join(', ')}.` : bridge.state === 'on' ? 'The bridge is up: run the command, then ask Claude Code to "open the overdub tools".' : 'Run the command once in a terminal; Claude Code then works in this tab (keep it open). Its moves show up here and in History.'),
        ] : [
          h('p.ag-kc-small.ag-cc-off', 'Claude Code drives a local copy of the studio, not this page. ', h('a', { href: GUIDE_CLAUDE_CODE, target: '_blank', rel: 'noopener' }, 'Bring Claude Code'), ', in the guide, says how.'),
        ])),
      keySec,
    );
  }
  const modelName = (id) => MODELS.find((m) => m.id === id)?.name || id;

  // Your words: what this person means by warm, fat, tight (agent/lexicon-personal.js), learned from their A/B picks.
  // Shown in settings; on the no-agent empty state only once there is something in it.
  function wordsList() {
    const words = personal.list();
    if (!words.length && !showKey) return null;
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    return h('div.ag-words', { role: 'group', 'aria-label': 'Your words' },
      h('div.ag-kc-label', 'Your words'),
      words.length ? h('ul.ag-wl', words.map((w) => h('li.ag-w', { dataset: { word: w.word } },
        h('b.ag-w-word', `“${w.word}”`),
        h('select.ag-w-sel', { 'aria-label': `What you mean by ${w.word}`, onchange: (ev) => { personal.setMeaning(w.word, ev.target.value); ui.toast(`Your “${w.word}” is now: ${ev.target.selectedOptions[0]?.textContent.toLowerCase()}.`); } },
          w.options.map((o) => h('option', { value: o.id, selected: o.id === w.reading }, o.label))),
        h('span.ag-w-n', w.edited ? 'set by hand' : `${plural(w.picks, 'pick')}, used ${w.uses}×`),
        h('button.btn.btn-txt.ag-link.ag-w-x', { type: 'button', 'aria-label': `Forget your ${w.word}`, onclick: () => { personal.forget(w.word); ui.toast(`Forgot your “${w.word}”. Next time it’s asked again.`); } }, 'Forget'))))
        : null,
      h('p.ag-kc-small', words.length ? 'Picked on the A/B cards, kept in this browser. Agents use these without asking, and say so.' : 'Warm, fat and tight mean different things to different people. The first time you ask for one, you hear two readings and pick; after that your pick is used without asking.'));
  }

  // The empty log: the agent's first line, set like the rest of the log (its name in the margin), and one thing to try.
  function welcome() {
    return h('div.ag-welcome',
      speaker('claude'),
      h('div.ag-body',
        h('p', 'I work on what you select. Lay down a take (hum it, tap it, play it) or say how it should feel, and I’ll play over it: notes, knobs and devices you can hear, see and undo.'),
        isSimple(app)
          ? h('p.t3', 'Every change is signed: ', byline('you'), ' in warm ink, ', byline('claude'), ' in cool. Ask me where anything is, too.')
          : h('p.t3', 'Every change is signed in History: ', byline('you'), ' in warm ink, ', byline('claude'), ' in cool.'),
        // (the simple view has it among the suggestions by the box already)
        isSimple(app) ? null : h('div', h('button.btn', { type: 'button', onclick: () => send('What would you change?') }, 'What would you change?'))));
  }

  /* ---------------------------------------------------------------- head, composer */
  // The presence line: who is in the room, each signed in their ink with what they're doing in words. A still dot means
  // connected (cool for an agent that's here, pencil for none yet); nothing pulses.
  function renderHead() {
    const pills = [];
    const p = agent.provider;
    const how = p === 'mock' ? 'demo agent' : p === 'local' ? `${modelName(agent.model)} in Claude Code` : p === 'cloud' ? 'on credits' : p ? modelName(agent.model) : 'no agent yet';
    const st = agent.busy ? `${how}, ${app.presence?.waiting?.('claude') ? 'waiting for you' : 'working'}` : how;
    // Claude on Overdub credits: the balance, in credits and in asks (no counter ticking during playback)
    const ch = cu.head();
    if (ch) {
      pills.push(h(`button.ag-pill.ag-pill-cloud${agent.busy ? '.busy' : ''}`, { type: 'button', title: ch.title, onclick: () => cu.show(cu.view === 'account' ? null : 'account') }, h('span.ag-pill-dot'), byline('claude', { cap: true }), h('span', ch.words)));
      for (const a of bridge.agents.filter((x) => x.connected)) pills.push(h(`span.ag-pill.mcp${a.status ? '.busy' : ''}`, { title: `${a.name} over MCP${a.status ? ': ' + a.status : ''}` }, h('span.ag-pill-dot'), byline(a.by || 'mcp:' + a.name, { app, name: a.name }), h('span', a.status ? (app.presence?.waiting?.(a.by) ? 'waiting for you' : 'working') : 'over MCP')));
      who.replaceChildren(...pills);
      return;
    }
    // the simple view: one plain status line, not a door to settings (those are put away as agent-setup)
    if (isSimple(app) && p) {
      const said = p === 'mock' ? `demo, ${agent.busy ? (app.presence?.waiting?.('claude') ? 'waiting for you' : 'working') : 'free'}` : st;
      pills.push(h(`span.ag-pill.ag-pill-plain${agent.busy ? '.busy' : ''}`, { title: p === 'mock' ? 'A scripted demo agent that uses the real tools. Everything it does is signed and undoable.' : `Claude in this tab (${how})` }, h('span.ag-pill-dot'), h('span', `Your agent · ${said}`)));
      if (p === 'local' && agent.plan) pills.push(planLine(agent.plan));
      for (const a of bridge.agents.filter((x) => x.connected)) pills.push(h(`span.ag-pill.mcp${a.status ? '.busy' : ''}`, { title: `${a.name} over MCP${a.status ? ': ' + a.status : ''}` }, h('span.ag-pill-dot'), byline(a.by || 'mcp:' + a.name, { app, name: a.name }), h('span', a.status ? (app.presence?.waiting?.(a.by) ? 'waiting for you' : 'working') : 'connected')));
      who.replaceChildren(...pills);
      return;
    }
    pills.push(h(`button.ag-pill${agent.busy ? '.busy' : ''}${p ? '' : '.off'}`, { type: 'button', title: p ? `Claude in this tab (${p === 'mock' ? 'scripted demo' : modelName(agent.model)}): settings` : 'Choose an agent to talk to here', onclick: () => { showKey = !showKey; renderAll(); } }, h('span.ag-pill-dot'), byline('claude', { cap: true }), h('span', st)));
    if (p === 'local' && agent.plan) pills.push(planLine(agent.plan));
    for (const a of bridge.agents.filter((x) => x.connected)) pills.push(h(`span.ag-pill.mcp${a.status ? '.busy' : ''}`, { title: `${a.name} over MCP${a.status ? ': ' + a.status : ''}` }, h('span.ag-pill-dot'), byline(a.by || 'mcp:' + a.name, { app, name: a.name }), h('span', a.status ? (app.presence?.waiting?.(a.by) ? 'waiting for you' : 'working') : 'over MCP')));
    if (bridge.state !== 'off' && !bridge.agents.some((x) => x.connected)) pills.push(h(`span.ag-bridge.${bridge.state}`, { dataset: { feature: 'agent-setup' }, title: bridge.state === 'on' ? 'The MCP bridge is listening: connect Claude Code (settings)' : 'Reconnecting to the MCP bridge…' }, bridge.state === 'on' ? 'MCP ready' : 'MCP reconnecting'));
    who.replaceChildren(...pills);
  }
  // The person's Claude plan, as Claude Code last reported it: the 5-hour window and the week, used so far. A window
  // whose reset time has passed reads 0% until the next turn says otherwise.
  function planWindows(plan) {
    const now = Date.now();
    const pct = (w) => (w ? `${w.resetsAt && w.resetsAt < now ? 0 : Math.round(w.used * 100)}%` : '–');
    const when = (ms) => { const d = new Date(ms); const day = d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString([], { weekday: 'short' }) + ' '; return day + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
    const limited = plan.limited && plan.resetsAt > now;
    return { five: pct(plan.five_hour), week: pct(plan.seven_day), limited, back: limited ? when(plan.resetsAt) : '',
      title: `Your Claude plan, as Claude Code last reported it: ${pct(plan.five_hour)} of the 5-hour window${plan.five_hour?.resetsAt > now ? ` (resets ${when(plan.five_hour.resetsAt)})` : ''}, ${pct(plan.seven_day)} of the week${plan.seven_day?.resetsAt > now ? ` (resets ${when(plan.seven_day.resetsAt)})` : ''}.` };
  }
  function planLine(plan) {
    const w = planWindows(plan);
    return h(`span.ag-plan${w.limited ? '.limited' : ''}`, { title: w.title }, w.limited ? `Plan limit reached: back at ${w.back}` : `Plan: 5 h ${w.five} · week ${w.week}`);
  }
  function suggestions() {
    const sel = ui.state.selection;
    const p = store.get();
    const f = sel.clip ? store.findClip(sel.clip) : null;
    const t = f?.track || (sel.track && p.tracks.find((x) => x.id === sel.track));
    let pool;
    if (sel.insert && t) pool = ['Make this warmer', 'What is this pedal doing?', 'Build me a pedal like this, but…', 'More space'];
    else if (t && /drum/.test(t.instrument?.device || '')) pool = ['Make the hats busier', 'Lazier snare', 'Give me a fill into the next section', 'Four on the floor', 'More space'];
    else if (t && /bass/i.test(t.name + ' ' + (t.instrument?.device || ''))) pool = ['Make this groove more', 'Double it an octave up', 'Write a counter-melody', 'Warmer', 'More space'];
    else if (t && t.kind === 'audio') pool = ['Build me a pedal for this', 'More space', 'Make it sit in the mix', 'Warmer'];
    else if (t) pool = ['Play over this', 'Make this groove more', 'Warmer', 'More space', 'Brighter'];
    else pool = ['Hum me an idea, I’ll arrange it', 'Build me a pedal…', 'What would you change?'];
    const done = justDone();
    return pool.filter((s) => !done(s)).slice(0, t && !sel.insert && t.kind !== 'audio' && !/drum|bass/i.test(t.name + ' ' + (t.instrument?.device || '')) ? 4 : 3);
  }
  // A suggestion for something the agent just did (you kept its "busier hats"; you just asked for exactly this) is
  // dropped: the agent's last few changes and your last few asks, matched on their words.
  const STOP = new Set(['make', 'this', 'that', 'more', 'with', 'into', 'over', 'the', 'next', 'give', 'take', 'your', 'mine', 'built', 'like', 'just', 'some', 'part']);
  const stems = (x) => new Set(String(x).toLowerCase().replace(/[^a-z\s-]+/g, ' ').split(/[\s-]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.replace(/(ier|er|s)$/, '')));
  function justDone() {
    const asked = feed.filter((e) => e.k === 'user').slice(-4).map((e) => String(e.text || '').trim().toLowerCase());
    const did = (store.history || []).slice(-6).filter((x) => store.isAgent?.(x.by) && !x.audition).map((x) => stems(x.label || ''));
    return (s) => {
      if (asked.includes(s.toLowerCase())) return true;
      const mine = stems(s);
      return mine.size > 0 && did.some((d) => [...mine].some((w) => d.has(w)));
    };
  }
  function renderComposer() {
    const busy = agent.busy;
    sendBtn.hidden = busy; stopBtn.hidden = !busy;
    input.disabled = false;
    const scope = scopeLabel(app);
    ctxRow.replaceChildren();
    if (scope && !contextOff) {
      ctxRow.append(h('span.ag-ctx-chip', { title: 'The agent works on this. It is attached to your next message.' }, h('span.t3', 'On '), h('span', scope.replace(/ › | · /g, ', ')),
        h('button.ag-ctx-x', { type: 'button', title: 'Don’t attach the selection', 'aria-label': 'Remove the selection context', onclick: () => { contextOff = true; renderComposer(); } }, icon('x', { size: 10 }))));
    }
    const sugs = busy || !agent.provider ? [] : suggestions();
    sugRow.replaceChildren(...(sugs.length ? [h('span.t3', 'Try ')] : []), ...sugs.map((s) => h('button.btn.btn-txt.ag-sug', { type: 'button', onclick: () => { if (s.endsWith('…')) { input.value = s.slice(0, -1) + ' '; input.focus(); grow(); } else send(s); } }, s)));
    const mcpStatus = bridge.agents.filter((a) => a.status).map((a) => `${a.name}: ${a.status}`)[0];
    const s = agent.status || mcpStatus || '';
    statusEl.replaceChildren(...(s ? [h('span.ag-lamp'), h('span', s)] : []));
    statusEl.classList.toggle('on', !!s);
    renderHeld();
    cu.update();
  }
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; }

  // A message sent with no agent on (FRESH-EYES-5: it swapped the panel for the key setup and was lost): it stays in
  // the box, and under it the demo agent is offered for it beside your own Claude, as a choice. Nothing is sent in the
  // person's name that they didn't type.
  function renderHeld() {
    const on = held && !agent.provider && !!input.value.trim();
    if (heldEl.hidden === !on && (!on || heldEl.childElementCount)) return;
    heldEl.hidden = !on;
    heldEl.replaceChildren(...(on ? [
      h('p.ag-held-t', 'Not sent: no agent is on yet.'),
      h('div.ag-held-acts',
        h('button.btn.ag-held-demo', { type: 'button', onclick: () => useDemo() }, icon('agent', { size: 12 }), 'Ask the demo agent'),
        h('button.btn.btn-txt.ag-link.ag-held-own', { type: 'button', dataset: { feature: 'agent-setup' }, onclick: () => openOwn() }, 'Use your own Claude')),
      h('p.ag-kc-small', `The demo agent is a script: it answers what it can, with the real tools. Your own Claude (${app.remote ? 'claude.ai through Connect, or ' : ''}Claude Code, on your Claude plan) reads every word.`),
    ] : []));
  }
  // the demo agent on, and what's in the box goes to it as typed; an empty box sends nothing
  function useDemo() {
    const was = agent.provider === 'mock', typed = !!input.value.trim();
    agent.useMock(true); showKey = false; held = false;
    if (!was) push({ k: 'note', text: `Demo agent on: a scripted session (not a live model) that uses the real tools. Everything it does is real and undoable.${typed ? '' : ' Ask it something, or pick a suggestion by the box.'}`, kind: 'agent' });
    renderAll(); input.focus();
    if (typed && !agent.busy) send();
  }
  // Claude Code on (or off); what's in the box goes to it as typed
  function useLocal(on) {
    agent.useLocal(on); showKey = false; held = false;
    push({ k: 'note', kind: on ? 'agent' : 'ok', text: on ? `Claude Code is on: ${modelName(agent.model)}, on this computer, on your Claude plan.${input.value.trim() ? '' : ' Ask it something.'}` : `Claude Code is off.${agent.provider === 'claude' ? ` Your server’s API key is back: ${modelName(agent.model)}.` : agent.provider === 'cloud' ? ` ${HOSTED_NAME} is back.` : ''}` });
    renderAll(); input.focus();
    if (on && input.value.trim() && !agent.busy) send();
  }
  // the model setup and Claude Code, opened on request; the words stay in the box
  function openOwn() { showKey = true; renderAll(); feedEl.querySelector('.ag-keycard h3')?.focus(); }

  async function send(text) {
    text = (text ?? input.value).trim();
    if (!text) return;
    // the demo agent waiting on your pick (its takes, a question) moves on to what you ask next: the takes stay on
    // screen to keep, a question it asked is set aside (FRESH-EYES-6 phone #3: a pending card blocked the next chip)
    if (agent.busy && agent.provider === 'mock' && moveOn(app)) await idle(5000);
    if (agent.busy) { ui.toast('The agent is still working: Stop it first, or wait a moment'); return; }
    if (!agent.provider && isSimple(app)) {
      // the simple view never opens the key screen: the demo agent answers (what it can't do, it says so)
      agent.useMock(true); showKey = false; held = false;
      if (!agent.provider) { ui.toast('The agent is still starting: try again in a moment'); return; }
    }
    if (!agent.provider) {
      if (!input.value.trim()) { input.value = text; grow(); }
      held = true; renderHeld(); input.focus();
      return;
    }
    // Claude on Overdub credits: a free move runs here; otherwise sign in first, and the price is on screen before it goes
    if (agent.provider === 'cloud' && cu.gate(text) !== 'go') return;
    const scope = contextOff ? '' : scopeLabel(app);
    const ctx = scope ? contextText(scope) : null;
    lastAsk = text;
    input.value = ''; grow();
    contextOff = false;
    const going = agent.send(text, { context: ctx, scope });   // (it takes the price shown before anything else)
    cu.sent();
    await going;
  }
  // until the agent's turn is over (or ms pass)
  function idle(ms) {
    return new Promise((res) => {
      if (!agent.busy) { res(); return; }
      let off = null;
      const t = setTimeout(() => { off?.(); res(); }, ms);
      off = agent.on('busy', (b) => { if (!b) { clearTimeout(t); off?.(); res(); } });
    });
  }
  function contextText(scope) {
    const sel = ui.state.selection;
    const bits = [`The human has selected: ${scope}.`];
    if (sel.track) bits.push(`track id ${sel.track}`);
    if (sel.clip) bits.push(`clip id ${sel.clip}`);
    if (sel.notes?.size) bits.push(`${sel.notes.size} selected note ids: ${[...sel.notes].slice(0, 40).join(' ')}`);
    if (sel.range && sel.range.to > sel.range.from) bits.push(`range beats ${sel.range.from}–${sel.range.to}`);
    if (sel.insert) bits.push(`insert ${sel.insert}`);
    bits.push(`playhead beat ${Math.round((app.engine?.beat || 0) * 100) / 100}${app.engine?.playing ? ' (playing)' : ''}`);
    return bits.join('; ');
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { if (agent.busy) agent.stop(); else input.blur(); }
    // ⌘Z (⇧⌘Z) from an empty box is the song's undo (redo), as a reply promises ("one undo takes out each move"): focus
    // stays here after a reply, and an empty text box has nothing of its own to undo (FRESH-EYES-4 producer #3)
    else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey) && !e.altKey && !input.value) {
      const k = ui.keys?.list?.().find((x) => x.key === 'KeyZ' && (x.mod || null) === (e.shiftKey ? 'mod+shift' : 'mod') && !x.when);
      if (k) { e.preventDefault(); e.stopPropagation(); k.run(e); }
    }
  });
  input.addEventListener('input', () => { grow(); renderHeld(); cu.update(); });

  // The in-browser API key is gone: agent/claude.js deleted one this browser had saved. loadFeed() adds the note to the
  // open song's feed until it is dismissed; its text is built when it draws, so the Connect tab (app.remote, set up after
  // this panel mounts) is named once it exists.
  function retiredText() {
    const guide = (href, label) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
    const cc = isLocalHost()
      ? ['Claude Code on this computer, on your Claude plan, in this panel or over MCP; your own API key, set on this server as OVERDUB_ANTHROPIC_KEY (', guide(GUIDE_SERVER_KEY, 'the guide says how'), ')']
      : ['Claude Code on this computer, on your Claude plan, with a local copy of the studio (', guide(GUIDE_CLAUDE_CODE, 'Bring Claude Code'), '); your own API key on your own local server (', guide(GUIDE_SERVER_KEY, 'the guide says how'), ')'];
    return ['Your saved API key is deleted from this browser: the studio no longer keeps a key on the page, so nothing on it can read one. You may want to revoke it in the Anthropic Console. Ways to keep an agent with no key on this page: ',
      app.remote ? 'claude.ai, through the Connect tab (on your Claude plan); ' : '', ...cc, '; or the demo agent, which is free.'];
  }
  /* ---------------------------------------------------------------- agent events (in-app) */
  const offs = [];
  offs.push(ui.on?.('remote:state', () => { const n = feed.find((x) => x.action === 'retired'); if (n) { mark(n); flush(); } }));
  offs.push(personal.onChange(() => { if (showKey || !agent.provider) renderAll(); }));
  offs.push(agent.on('user', ({ text, context, scope }) => { push({ k: 'user', by: 'you', text, context: context ? scope || '' : '' }); }));
  // the in-app turn: one agent entry, split in two around a card (variations, a question) so the story stays in order
  let turnLive = false;
  const turnEntry = () => {
    if (!cur) cur = push({ k: 'agent', by: 'claude', parts: [], live: true, cont: turnLive && feed.some((x) => x.k === 'agent' && x.turn === turnId), turn: turnId, via: agent.provider === 'mock' ? 'demo' : '' });
    return cur;
  };
  let turnId = 0;
  const addText = (en, text) => { const last = en.parts[en.parts.length - 1]; if (last && last.t === 'text') last.text += text; else en.parts.push({ t: 'text', text }); };
  const addChip = (en, chip) => { const last = en.parts[en.parts.length - 1]; if (last && last.t === 'chips') last.chips.push(chip); else en.parts.push({ t: 'chips', chips: [chip] }); };
  const closeCur = () => { if (!cur) return; cur.live = false; cur.update = ''; if (!cur.parts.some((x) => (x.t === 'text' || x.t === 'fine' ? x.text.trim() : x.t === 'moves' ? x.moves.length : x.chips.length))) { feed.splice(feed.indexOf(cur), 1); } mark(cur); cur = null; };
  offs.push(agent.on('start', () => { turnLive = true; turnId = Date.now(); cur = null; turnEntry(); }));
  offs.push(agent.on('text', ({ delta }) => { const en = turnEntry(); addText(en, delta); en.update = ''; mark(en); }));
  offs.push(agent.on('fine', ({ text }) => { const en = turnEntry(); if (text) en.parts.push({ t: 'fine', text: String(text) }); mark(en); }));
  offs.push(agent.on('moves', ({ moves, live }) => { const en = turnEntry(); en.parts.push({ t: 'moves', moves: (moves || []).slice(0, 5).map(String), live: !!live }); mark(en); }));
  offs.push(agent.on('update', ({ delta, done }) => { const en = cur || (turnLive ? turnEntry() : null); if (!en) return; if (done) en.update = ''; else en.update = ((en.update || '') + delta).slice(-140); mark(en); }));
  offs.push(agent.on('end', ({ stopped } = {}) => {
    if (stopped) { const en = turnEntry(); addText(en, ' _(stopped)_'); }
    // out of sight (another tab, the pane closed): read the turn's words out once, now that it's whole
    if (cur && !ui.visible?.('agent')) {
      const words = cur.parts.filter((p) => p.t === 'text').map((p) => p.text).join(' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
      if (words) ui.announce?.(`${nameOf(cur.by)}: ${words.length > 300 ? words.slice(0, 300) + '…' : words}`);
    }
    closeCur();
    turnLive = false;
    saveFeed();
  }));
  offs.push(agent.on('error', (e) => {
    const { message, retrying, code } = e;
    if (retrying) return;
    // Claude on Overdub credits: an ask stopped before it ran (sign in, out of credits, paused, a limit) goes back in
    // the box, and the sheet answers what it can
    if (e.cloud && ['not_signed_in', 'insufficient_credits', 'hosted_paused', 'trial_paused', 'daily_limit', 'rate_limited', 'prompt_version_unknown'].includes(code) && !input.value.trim() && lastAsk) { input.value = lastAsk; grow(); cu.update(); }
    if (cu.onError(e)) return;
    push({ k: 'note', text: message, kind: 'bad', action: code === 'noagent' || code === 'badkey' ? 'key' : null });
  }));
  offs.push(agent.on('status', () => renderComposer()));
  offs.push(agent.on('busy', () => { renderComposer(); renderHead(); }));
  offs.push(agent.on('provider', () => renderAll()));
  offs.push(agent.on('plan', () => renderHead()));
  offs.push(agent.on('reset', ({ reason }) => { if (reason === 'song') { pid = store.get().id; feed = loadFeed(); } renderAll(); }));

  /* ---------------------------------------------------------------- tool activity (everyone) */
  const liveChips = new Map(); // call id -> chip
  const jamFrom = new Map();   // call id -> the title of the song a jam track replaces
  offs.push(ui.on('agent:tool', (e) => {
    if (e.name === 'say') return;
    // A jam track replaces the song, and the conversation is the song's: the turn that made it closes with the old one.
    // The new song's log starts by saying what happened and where the old song went.
    if (e.name === 'make_jam_track') {
      if (e.phase === 'start') jamFrom.set(e.call, store.get().title || 'Untitled');
      else {
        const from = jamFrom.get(e.call), r = e.result || {};
        jamFrom.delete(e.call);
        if (r.ok && r.title) push({ k: 'note', kind: 'agent', text: `${nameOf(e.by)} made this jam track: ${r.title}, ${r.tempo} BPM, ${r.bars} bars, looping.${from ? ` “${from}” is in Recent songs (Song, then Recent songs).` : ''}` });
      }
    }
    const inApp = e.by === 'claude' && turnLive;
    if (e.phase === 'start') {
      const chip = { icon: '…', text: (agent.statusFor ? agent.statusFor(e.name, e.input) : e.name).replace(/^Claude is |…$/g, ''), live: true, by: e.by };
      liveChips.set(e.call, chip);
      if (inApp) { const en = turnEntry(); addChip(en, chip); mark(en); } else { const host = activityFor(e.by); host.chips.push(chip); mark(host); }
      return;
    }
    const chip = liveChips.get(e.call);
    liveChips.delete(e.call);
    if (!chip) return;
    if (!e.chip) { // nothing worth showing (say): drop the placeholder
      for (const en of feed) {
        if (en.chips?.includes(chip)) { en.chips.splice(en.chips.indexOf(chip), 1); mark(en); }
        for (const p of en.parts || []) if (p.t === 'chips' && p.chips.includes(chip)) { p.chips.splice(p.chips.indexOf(chip), 1); if (!p.chips.length) en.parts.splice(en.parts.indexOf(p), 1); mark(en); }
      }
      return;
    }
    Object.assign(chip, { icon: e.chip.icon, text: e.chip.text, kind: e.chip.kind, target: e.chip.target || targetFrom(e), live: false, full: e.result?.error ? `${e.result.error}${e.result.hint ? ' — ' + e.result.hint : ''}` : (e.result?.diff || e.result?.changed || [])?.join?.('\n') || '' });
    for (const en of feed) if (en.chips?.includes(chip) || (en.parts || []).some((p) => p.t === 'chips' && p.chips.includes(chip))) mark(en);
    saveFeed();
  }));
  function targetFrom(e) {
    const i = e.input || {};
    if (i.target?.track || i.target?.clip) return { tracks: i.target.track ? [i.target.track] : [], clips: i.target.clip ? [i.target.clip] : [] };
    if (i.tracks?.length) return { tracks: i.tracks, clips: [] };
    return null;
  }
  function activityFor(by) {
    const last = feed[feed.length - 1];
    if (last && last.k === 'activity' && last.by === by && Date.now() - last.at < 120000) return last;
    return push({ k: 'activity', by, chips: [] });
  }
  offs.push(ui.on('agent:say', ({ by, text }) => {
    if (by === 'claude' && turnLive) { const en = turnEntry(); addText(en, '\n\n' + text + '\n\n'); mark(en); return; }
    push({ k: 'say', by, text, via: by.startsWith('mcp:') ? 'over MCP' : '' });
  }));
  offs.push(ui.on('agent:request', ({ id, req }) => {
    let e = feed.find((x) => x.k === 'request' && x.id === id);
    if (!e) { if (req.by === 'claude' && turnLive) closeCur(); e = push({ k: 'request', id, kind: req.kind, by: req.by }); }
    if (req.status !== 'pending') { e.summary = summarize(req); saveFeed(); }
    mark(e);
    if (req.status === 'pending' && !req.checking && !ui.visible?.('agent')) ui.toast(`${store.author(req.by).name} ${req.kind === 'question' ? 'has a question' : req.kind === 'shelf' ? 'suggests a device from the community shelf' : req.keep ? `wants to ${req.keep.words}` : 'offers a few takes'}`, { kind: 'agent', action: { label: 'Show', run: () => ui.show('agent') } });
  }));
  // a hold that ended without a let-go (an agent started working on the song, the song was replaced): unlight the card
  offs.push(ui.on('agent:audition', ({ id, index, on } = {}) => {
    if (on) return;
    for (const c of feedEl.querySelectorAll('.ag-vars .ag-take.on')) if (c.closest('.ag-vars').dataset.id === String(id) && c.dataset.index === String(index)) c.classList.remove('on');
    for (const c of feedEl.querySelectorAll('.ag-asks.on')) if (c.dataset.id === String(id)) c.classList.remove('on');
  }));
  // (a connected agent leads the key card: redraw it when one comes or goes)
  const connected = () => bridge.agents.filter((a) => a.connected).map((a) => a.by).join();
  offs.push(ui.on('presence:agents', (list) => { const was = connected(); bridge.agents = list.filter((a) => a.source === 'mcp'); renderHead(); renderComposer(); if (connected() !== was && (showKey || !agent.provider)) renderAll(); }));
  // Make it yours: a card asked while the song came from a link says so, and that it still waits (FRESH-EYES-6 agent
  // builder, confused #3)
  // the head says it differently in each view (a plain line in simple, the Claude pill in full): redrawn on a switch
  offs.push(ui.on('workspace', () => renderHead()));
  offs.push(ui.on('share:fork', () => { for (const e of feed) if (e.k === 'request') mark(e); }));
  offs.push(ui.on('presence:status', ({ by }) => { if (by !== 'claude') { bridge.agents = app.presence.agents().filter((a) => a.source === 'mcp'); renderHead(); renderComposer(); } else renderHead(); }));   // 'claude': working / waiting for you
  offs.push(ui.on('bridge:state', (s) => {
    const was = bridge.state;
    bridge.state = s.state; if (s.root) root = s.root;
    if (s.agent && s.event === 'join') push({ k: 'note', text: `${s.agent} connected over MCP. Its moves show up here and in History, signed with its name.`, kind: 'agent' });
    if (s.agent && s.event === 'leave') push({ k: 'note', text: `${s.agent} disconnected.`, kind: 'info' });
    if (was !== bridge.state || s.agent) { renderHead(); if (showKey || !agent.provider) renderAll(); }
  }));
  offs.push(ui.on('select', () => { contextOff = false; renderComposer(); }));
  offs.push(ui.on('agent:compose', ({ text = '', send: go = false } = {}) => {
    ui.show('agent');
    if (go && text) { send(text); return; }
    input.value = text; grow(); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }));

  /* ---------------------------------------------------------------- keys */
  // '/' is shared with the browser's search (browser.js registers it first): the agent takes it whenever the browser
  // pane is closed, and ⌘/ (Ctrl+/) always asks the agent.
  const ask = () => { ui.show('agent'); input.focus(); };
  offs.push(ui.keys.add({ key: 'Slash', mod: 'mod', run: ask, label: 'Ask the agent', group: 'Agent' }));
  offs.push(ui.keys.add({ key: 'Slash', when: () => !ui.isOpen?.('left'), run: ask, label: 'Ask the agent (browser closed)', group: 'Agent' }));
  offs.push(ui.keys.add({ key: 'Escape', global: true, when: () => agent.busy, run: () => agent.stop(), label: 'Stop the agent', group: 'Agent' }));
  for (let i = 1; i <= 4; i++) offs.push(ui.keys.add({ key: 'Digit' + i, when: () => !!pendingQuestion() && ui.visible('agent'), run: () => { const q = pendingQuestion(); if (q && q.options[i - 1]) app.tools.answer(q.id, i - 1); }, label: `Answer option ${i}`, group: 'Agent' }));
  function pendingQuestion() { for (const r of app.tools.requests.values()) if (r.kind === 'question' && r.status === 'pending') return r; return null; }

  // project switches
  offs.push(store.on('change', (e) => { if (e.kind === 'load' && store.get().id !== pid) { pid = store.get().id; feed = loadFeed(); renderAll(); } }));

  renderAll();
  let lastRec = false;
  return {
    frame() {
      flush();
      const rec = isRecording(app);
      if (rec !== lastRec) { lastRec = rec; for (const e of feed) if (e.k === 'request') mark(e); }
    },
    refresh() { renderAll(); },
    update() { /* store changes: request cards' undo links */ },
    unmount() { for (const off of offs) off?.(); },
    focus() { input.focus(); },
  };
}

/* ---------------------------------------------------------------- patch in place */
// morph(old, fresh): make `old` look like `fresh`, keeping every node that is still the same thing (same tag, same
// classes, same _key), so a live region only reports what changed. Text that grew is appended, not replaced. Nodes that
// differ are swapped whole, so a button is never reused for something else (chips carry _key = their chip).
const TRANSIENT = new Set(['ag-new', 'on', 'ag-chip-live', 'ag-chip-err']);
const stableClass = (el) => [...el.classList].filter((c) => !TRANSIENT.has(c)).sort().join(' ');
function sameNode(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  return a.nodeType !== 1 || (a._key === b._key && stableClass(a) === stableClass(b));
}
function patchEntry(old, n) {
  try { return morph(old, n); } catch (err) { console.error('agent feed patch', err); if (old.isConnected) old.replaceWith(n); return n; }
}
export function morph(a, b) {
  if (!sameNode(a, b)) { a.replaceWith(b); return b; }
  if (a.nodeType === 3) {
    if (a.data !== b.data) { if (b.data.startsWith(a.data)) a.appendData(b.data.slice(a.data.length)); else a.data = b.data; }
    return a;
  }
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return a; }
  for (const { name } of [...a.attributes]) if (name !== 'class' && !b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (name !== 'class' && a.getAttribute(name) !== value) a.setAttribute(name, value);
  const wasNew = a.classList.contains('ag-new');   // (its entrance animation keeps running)
  const cls = b.getAttribute('class');            // (getAttribute: SVG icons have no settable className)
  if (a.getAttribute('class') !== cls) { if (cls == null) a.removeAttribute('class'); else a.setAttribute('class', cls); if (wasNew) a.classList.add('ag-new'); }
  const ak = [...a.childNodes], bk = [...b.childNodes];
  for (let i = 0; i < bk.length; i++) { if (i < ak.length) morph(ak[i], bk[i]); else a.appendChild(bk[i]); }
  for (let i = bk.length; i < ak.length; i++) ak[i].remove();
  return a;
}

/* ---------------------------------------------------------------- tool steps */
// "built Velvet Hush · +1.2 LU on Pad" -> ['built', 'Velvet Hush, +1.2 LU on Pad']: the verb goes in the step's first
// column, the rest beside it; middle dots read as commas. "you picked …" keeps both words as its verb; an error keeps
// what failed ("apply ops:").
export function splitStep(text, error = false) {
  const t = String(text || '').replace(/ · /g, ', ').trim();
  const m = error ? /^([^:]{1,24}:)\s*(.*)$/.exec(t) : /^((?:you )?\S+)\s+(.*)$/.exec(t);
  return m ? [m[1], m[2]] : [t, ''];
}

/* ---------------------------------------------------------------- light markdown */
function md(src) {
  let s = esc(String(src || ''));
  s = s.replace(/```([\s\S]*?)```/g, (m, c) => `<pre>${c.replace(/^\w*\n/, '')}</pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  const lines = s.split('\n');
  const out = [];
  let list = null;
  for (const ln of lines) {
    const m = /^\s*(?:[-•*]|\d+\.)\s+(.*)$/.exec(ln);
    if (m) { if (!list) { list = []; } list.push(`<li>${m[1]}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    out.push(ln);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('\n').replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>').replace(/<br>(<ul>|<pre>)/g, '$1').replace(/(<\/ul>|<\/pre>)<br>/g, '$1');
}

const CSS = `
/* The Agent pane, set as a session log (design/LINER-NOTES-KIT.md): no bubbles, no cards, no stripes, no pills. The
   speaker's name sits in a 54 px margin column in their ink; rules separate; the takes are a ruled list. */
.ag { display: flex; flex-direction: column; overflow: hidden !important; background: var(--bg-2); }
.ag-head { display: flex; align-items: center; gap: 10px; padding: 6px 12px 6px 18px; border-bottom: var(--rule); min-height: 40px; flex: none; }
.ag-who { display: flex; flex-wrap: wrap; align-items: center; gap: 0 16px; flex: 1; min-width: 0; }
.ag-hbtns { display: flex; gap: 10px; flex: none; }
.ag-head .ag-hbtn, .ew-shell .ag-head .ag-hbtn { width: auto; height: 28px; padding: 0 2px; font-size: 12px; }
.ag-pill { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0; border: 0; background: none; color: var(--text-2); font: 12.5px var(--font-ui); white-space: nowrap; cursor: pointer; flex: none; }
.ag-pill .by { font-size: 12.5px; }
.ag-pill:hover > span:last-child { color: var(--text); }
.ag-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--agent); flex: none; }
.ag-pill.off .ag-pill-dot { background: var(--text-3); }
.ag-pill.mcp { cursor: default; }
.ag-pill.ag-pill-plain { cursor: default; color: var(--text-2); }
.ag-pill.ag-pill-plain:hover > span:last-child { color: var(--text-2); }
/* the demo agent's finger on something outside the song (the blank sheet's first door): agent ink, no glow, no pulse */
.ag-pointed { outline: 2px solid var(--agent); outline-offset: 3px; }
.ag-plan { font-size: 12px; color: var(--text-3); white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }
.ag-plan.limited { color: var(--text-2); }
.ag-bridge { font-size: 12px; color: var(--text-3); white-space: nowrap; flex: none; }

.ag-feed { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 18px 14px; display: flex; flex-direction: column; scroll-behavior: auto; }
.ag-msg, .ag-note, .ag-card-done, .ag-q, .ag-asks, .ag-welcome { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 0 10px; padding: 11px 0; }
.ag-feed > * + * { border-top: var(--rule); }
.ag-feed > .ag-cont { border-top: 0; padding-top: 0; }
.ag-feed > .ag-vars { border-top: 0; }
/* a name longer than the margin ("Claude Code", a guest's) wraps between its words, and a long single word breaks,
   rather than running into the message beside it (bylines are nowrap everywhere else) */
.ag-spk { font-size: 12px; line-height: 1.6; min-width: 0; overflow-wrap: anywhere; }
.ag-spk .by { font-size: 12px; white-space: normal; }
.ag-via { display: block; font-size: 11px; color: var(--text-3); line-height: 1.3; }
.ag-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ag-new { animation: ew-in .16s var(--ease) both; }
.ag-text { color: var(--text); font-size: 13.5px; line-height: 1.5; word-wrap: break-word; }
.ag-text:empty { display: none; }
.ag-text code { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-2); }
.ag-text pre { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-2); border-top: var(--rule); border-bottom: var(--rule); padding: 6px 0; overflow-x: auto; white-space: pre-wrap; margin: 6px 0; }
.ag-text ul { margin: 4px 0; padding-left: 18px; } .ag-text li { margin: 2px 0; }
.ag-text b { color: var(--text); }
.ag-ctx-sent { font-family: var(--font-mono); font-size: 11px; color: var(--text-3); }
.ag-ctx-sent span { color: var(--text-2); }
.ag-fine { font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5; color: var(--text-3); word-wrap: break-word; margin-top: -2px; }
.ag-update { font-size: 12px; font-style: italic; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ag-typing { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-3); }
/* tool steps: mono lines, the verb in its own column */
.ag-chips { display: flex; flex-direction: column; align-items: flex-start; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.6; color: var(--text-3); }
.ag-chip { display: inline-flex; align-items: baseline; max-width: 100%; padding: 0; border: 0; background: none; color: var(--text-3); font: inherit; text-align: left; cursor: pointer; white-space: nowrap; }
.ag-chip-v { flex: none; min-width: 74px; padding-right: 8px; font-weight: 400; color: var(--text-2); }
.ag-chip > span { overflow: hidden; text-overflow: ellipsis; }
.ag-chip:hover > span, .ag-chip:hover .ag-chip-v { color: var(--text); }
.ag-chip:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.ag-chip-live, .ag-chip-live .ag-chip-v { color: var(--text-3); }
.ag-chip-err, .ag-chip-err .ag-chip-v { color: var(--bad); }
.ag-moves { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 12px; font-size: 12.5px; }
.ag-moves .btn-txt, .ag-sugs .btn-txt { font-size: 12.5px; min-height: 24px; }
.ag-note .ag-body p { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.ag-note-bad .ag-body p { color: var(--bad); }
.ag-note .ag-body .btn { align-self: flex-start; }

/* the agent's takes: a sheet head, one ruled row per take with a big cool letter, the original last ("as it was") */
.ag-vars { padding: 18px 0 0; }
.ag-vars.ag-new { animation: ew-in .3s var(--ease-wiggle) both; }
.ag-vars .sheet-head > h4 { font-size: 17px; }
.ag-vars .sheet-head .aside { font-size: 11.5px; }
.ag-card-h .ag-reason { margin-top: 2px; }
.ag-offer { margin: 8px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.ag-offer .by { font-size: 12.5px; }
.ag-takes { list-style: none; margin: 0; padding: 0; }
.ag-take { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 0 12px; padding: 12px 0; border-bottom: var(--rule); }
.ag-letter { color: var(--agent); }
.ag-letter.num { font-size: 40px; line-height: .9; padding-top: 2px; }
.ag-take-orig .ag-letter { color: var(--text-3); font-size: 13px; line-height: 1.2; padding-top: 1px; }
.ag-take-body { min-width: 0; }
.ag-take-h b { font-size: 13.5px; font-weight: 600; line-height: 1.3; }
.ag-take-why { margin: 2px 0 0; font-size: 12.5px; color: var(--text-2); line-height: 1.45; }
.ag-roll { display: block; width: 100%; height: 30px; margin-top: 8px; background: var(--bg); }
.ag-roll rect { fill: var(--text-3); } .ag-roll rect.x { fill: var(--agent); } .ag-roll rect.bl { fill: var(--line); }
.ag-take-diff { margin-top: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--text-3); line-height: 1.45; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ag-take-btns { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.ag-take-n { margin-left: auto; white-space: nowrap; }
.ag-hold { touch-action: none; user-select: none; -webkit-user-select: none; }
.ag-hold svg { width: 10px; height: 10px; }
.ag-hold-on { display: none; }
.ag-take.on .ag-hold-idle { display: none; } .ag-take.on .ag-hold-on { display: inline; }
.ag-take.on .ag-hold { background: var(--text); border-color: var(--text); color: var(--bg); }
.ag-take-tip { margin-top: 6px; font-size: 12px; color: var(--text-3); } .ag-take-tip:empty { display: none; }
.ag-card-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 9px 0 4px; font-size: 12px; }
.ag-muted { margin: 0; color: var(--text-3); font-size: 12px; line-height: 1.45; }
.ag-link { margin-left: auto; font-size: 12px; }
.ag-card-done .ag-body { flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 12.5px; color: var(--text-2); line-height: 1.45; }
.ag-card-done .ag-link { margin-left: 0; }
/* a question: the options are rows under a rule, each with its key */
.ag-q-text { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text); }
.ag-q-opts { display: flex; flex-direction: column; border-top: var(--rule); }
.ag-opt { display: flex; align-items: center; gap: 10px; padding: 8px 0; border: 0; border-bottom: var(--rule); background: none; color: var(--text); text-align: left; font: 13px var(--font-ui); cursor: pointer; }
.ag-opt:hover { background: var(--bg-3); }
.ag-opt:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.ag-dismiss { align-self: flex-start; margin-left: 0; }
/* a card to Keep (a song from a link): one line of what the agent wants to do, signed, its take, then the choice */
.ag-asks-line { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text); }
.ag-asks-line .by { font-size: 13.5px; }
.ag-asks .ag-take-btns { margin-top: 0; flex-wrap: wrap; }
.ag-asks-fine { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-3); }
.ag-asks.on .ag-hold-idle { display: none; } .ag-asks.on .ag-hold-on { display: inline; }
.ag-asks.on .ag-hold { background: var(--text); border-color: var(--text); color: var(--bg); }
.ag-asks .ag-keep:disabled { opacity: .55; cursor: default; }

/* bring your own key: a plain sheet */
.ag-keycard { display: flex; flex-direction: column; gap: 10px; padding: 16px 0 14px; }
.ag-keycard .sheet-head > h3 { font-size: 19px; }
.ag-kc-p { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-2); }
.ag-kc-label { display: block; margin-top: 4px; font-size: 11px; color: var(--text-3); }
.ag-models { display: flex; flex-direction: column; border-top: var(--rule); }
.ag-model { display: flex; align-items: baseline; gap: 10px; padding: 8px 0; border: 0; border-bottom: var(--rule); background: none; color: var(--text-2); text-align: left; cursor: pointer; font: 12.5px var(--font-ui); }
.ag-model::before { content: ''; flex: none; width: 6px; height: 6px; background: var(--line-2); align-self: center; }
.ag-model.on::before { background: var(--accent-2); box-shadow: 0 0 6px color-mix(in srgb, var(--accent-2) 50%, transparent); }
.ag-model b { flex: none; min-width: 84px; font-weight: 600; color: var(--text-2); }
.ag-model.on b { color: var(--text); }
.ag-model span { font-size: 12px; color: var(--text-3); line-height: 1.35; }
.ag-model:hover b { color: var(--text); }
.ag-model:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.ag-kc-sec { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; padding-top: 12px; border-top: var(--rule); }
/* the first look: the demo agent first (the region's one primary), then the key, under a hairline */
.ag-kc-first { display: flex; flex-direction: column; gap: 10px; padding-bottom: 14px; border-bottom: var(--rule); margin-bottom: 4px; }
.ag-kc-first .ag-kc-acts .btn-go { align-self: flex-start; }
.ag-kc-own { display: flex; flex-direction: column; gap: 2px; }
.ag-kc-own .ag-link { align-self: flex-start; margin-left: 0; }
.ag-kc-sec > .head { font-size: 13px; }
.ag-kc-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.ag-kc-acts .ag-link { margin-left: 0; }
.ag-demo { align-self: flex-start; }
.ag-cmd { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: var(--rule); border-bottom: var(--rule); }
.ag-cmd code { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-2); word-break: break-all; line-height: 1.45; }
.ag-kc-small { margin: 0; font-size: 12px; color: var(--text-3); line-height: 1.45; }
.ag-words { display: flex; flex-direction: column; gap: 6px; }
.ag-wl { list-style: none; margin: 0; padding: 0; border-top: var(--rule); }
.ag-w { display: grid; grid-template-columns: auto 1fr auto; grid-template-areas: 'word sel x' 'n n n'; align-items: center; gap: 2px 10px; padding: 7px 0; border-bottom: var(--rule); }
.ag-w-word { grid-area: word; font-size: 12.5px; }
.ag-w-sel { grid-area: sel; min-width: 0; font: inherit; font-size: 12px; color: var(--text); background: var(--bg); border: var(--rule-2); border-radius: var(--r-press); padding: 3px 6px; }
.ag-w-n { grid-area: n; font-family: var(--font-mono); font-size: 11px; color: var(--text-3); }
.ag-w-x { grid-area: x; margin-left: 0; }

/* the empty log: the agent's first line */
.ag-welcome { margin: auto 0 0; }
.ag-welcome .ag-body p { margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text); }
.ag-welcome .ag-body p.t3 { font-size: 12.5px; color: var(--text-3); }
.ag-welcome .ag-body .btn { margin-top: 2px; }

/* the composer: an underlined field, Send as a word */
.ag-composer { flex: none; padding: 10px 18px 12px; border-top: var(--rule-2); background: var(--bg-2); display: flex; flex-direction: column; gap: 8px; }
.ag-status { display: none; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); min-height: 18px; }
.ag-status.on { display: flex; }
.ag-status span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ag-lamp { width: 6px; height: 6px; flex: none; background: var(--agent); }
.ag-sugs { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 12px; font-size: 12.5px; }
.ag-sugs:empty { display: none; }
/* a message sent with no agent on: the choice for it, under a hairline, over the box that still holds it */
.ag-held { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: var(--rule); }
.ag-held[hidden] { display: none; }
.ag-held-t { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text); }
.ag-held-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.ag-held-acts .ag-link { margin-left: 0; }
.ag-held-demo svg { width: 12px; height: 12px; }
.ag-box { display: flex; flex-direction: column; gap: 6px; }
.ag-ctxrow { display: flex; } .ag-ctxrow:empty { display: none; }
.ag-ctx-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; font-size: 12px; color: var(--text-2); }
.ag-ctx-chip > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ag-ctx-x { display: grid; place-items: center; flex: none; width: 18px; height: 18px; margin-left: 2px; border: 0; border-radius: var(--r-press); background: none; color: var(--text-3); cursor: pointer; }
.ag-ctx-x:hover { color: var(--text); background: var(--bg-3); }
.ag-inrow { display: flex; align-items: flex-end; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--text-3); }
.ag-inrow:focus-within { border-bottom-color: var(--text); }
.ag-input { flex: 1; min-width: 0; resize: none; border: 0; outline: 0; background: transparent; color: var(--text); font: 13.5px/1.45 var(--font-ui); padding: 4px 0; max-height: 160px; }
.ag-input::placeholder { color: var(--text-3); }
.ag-send[hidden], .ag-stop[hidden] { display: none; }
.ag-stop svg { width: 10px; height: 10px; }
.ag-hint { font-size: 11px; color: var(--text-3); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
@media (max-width: 900px) {
  .ag-hint { display: none; } .ag-feed, .ag-composer { padding-left: 16px; padding-right: 16px; } .ag-head { padding-left: 16px; }
  .ew-shell .ag-head .ag-hbtn { min-width: 40px; height: 40px; }
  .ew-shell .ag-take-n, .ew-shell .ag-vars .sheet-head .aside, .ew-shell .ag-chips, .ew-shell .ag-via, .ew-shell .ag-ctx-sent, .ew-shell .ag-typing, .ew-shell .ag-w-n, .ew-shell .ag-kc-label { font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) { .ag-new, .ag-vars.ag-new { animation: none; } }
`;
