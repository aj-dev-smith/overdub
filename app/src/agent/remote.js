// Connect to Claude (claude.ai): the page side of the hosted relay (server/relay.js, docs/REMOTE-MCP.md). Claude on
// the web and in the Claude apps adds this studio as a custom connector and plays in this tab.
//
// Two keys, kept per browser. The tab secret (32 random bytes, localStorage 'overdub:remote-secret') never leaves this
// browser except in the x-overdub-tab-secret header of requests to the relay: never in a URL, never in a log. The
// connector token is made from it one way (tokenFor: SHA-256, the same as the relay's), and the connector URL
// <relay>/s/<token>/mcp is what the person pastes into claude.ai. Holding the URL lets Claude drive this tab; only the
// secret lets a tab take the calls and answer them, so the URL can't be used to pose as this studio. With Connect on
// ('overdub:remote-on'), the tab says hello, listens for calls on an event stream (fetch, so the secret can go in a
// header, which EventSource can't send) and posts each result back:
//
//   POST <relay>/s/<token>/hello { tab } ; GET <relay>/s/<token>/events?tab=… ; POST <relay>/s/<token>/result
//
// A browser that kept a token from before the secret ('overdub:remote-token', which unlocked both sides) gets a new
// pair; the old key is removed and the Connect tab says once that the link changed ('overdub:remote-notice').
//
// Calls run with by = 'claude.ai' (an agent author: cool, signed, undoable on its own). The UI is the right-region tab
// "Connect" (order 15). The relay is RELAY below; ?relay=http://localhost:<port> overrides it for tests and local dev,
// and only when the studio itself is on localhost (relayOverride): on the live site a link with ?relay= would show the
// hidden Connect tab and, for someone who had Connect on, point this tab at whatever answers on that port.
//
// app.remote = { state, enabled, agent, url, token, relay, notice, enable(), disable(), rotate(), copy() }
// Emits ui 'remote:state' { state: 'off' | 'connecting' | 'on' | 'reconnecting', agent: bool }.

import { h, css, icon } from '../ui/dom.js';
import { installPresence } from './presence.js';
import { installTools } from './tools.js';

export const RELAY = 'https://overdub-relay.ajsmithhq.com';
// The hosted relay is built and tested (tools/relay-test.js) but not deployed yet: standing up an internet-facing
// endpoint that drives people's studio tabs is AJ's call (deploy/relay/setup.sh, ~$7.40/month, docs/REMOTE-MCP.md).
// Until then the Connect tab only appears on a local studio with ?relay=<a local relay> (node server/relay.js). Flip
// this after deploying (the page's policy already allows RELAY in connect-src: app/index.html).
export const RELAY_LIVE = false;
export const BY = 'claude.ai';
export const SECRET_HEADER = 'x-overdub-tab-secret';
export const TOKEN_PREFIX = 'overdub-relay-token/v1:';   // the relay's too (server/relay.js tokenFor)
const SECRET_KEY = 'overdub:remote-secret';
const OLD_TOKEN_KEY = 'overdub:remote-token';   // before the secret: read once, then removed
const NOTICE_KEY = 'overdub:remote-notice';
const ON_KEY = 'overdub:remote-on';
const MAX_RESULT = 950 * 1024;   // the relay takes 1 MB bodies
const STALL_MS = 45000;          // the relay pings every 15 s: three missed and the stream is dead, so reconnect
const MAX_EVENT = 4 * 1024 * 1024;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
// The relay a ?relay= asks for: its origin when the studio itself is on this machine and it's an http(s) URL, else
// null (the live site ignores it).
export function relayOverride(search = location.search, host = location.hostname) {
  if (!LOCAL_HOST.test(host)) return null;
  const q = new URLSearchParams(search).get('relay');
  if (!q) return null;
  try {
    const u = new URL(q);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch (e) { return null; /* not a URL */ }
}
const relayBase = () => relayOverride() || RELAY;
// While the hosted relay is on trial (deployed, and AJ hasn't yet decided to keep it), the live site shows Connect only
// to a browser that asks: /app/?connect=1 turns the preview on here (remembered), ?connect=0 turns it off. It reveals
// the Connect tab for RELAY above and nothing else: it can't point the tab anywhere (that's ?relay=, local only).
const PREVIEW_KEY = 'overdub:remote-preview';
export function relayPreview(search = location.search) {
  const q = new URLSearchParams(search).get('connect');
  if (q === '1') put(PREVIEW_KEY, '1');
  else if (q === '0') put(PREVIEW_KEY, null);
  return get(PREVIEW_KEY) === '1';
}
function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const newSecret = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
// The connector token for a tab secret: the first 22 characters of base64url(SHA-256(prefix + secret)).
export async function tokenFor(secret) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN_PREFIX + secret)))).slice(0, 22);
}
const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked: this session only */ } };

// This browser's pair. A missing or malformed secret gets a new one; a token kept from before the secret is dropped
// (it opened both sides, so its URL is retired) and the Connect tab says once that the link changed.
async function loadKeys() {
  let secret = get(SECRET_KEY);
  const old = get(OLD_TOKEN_KEY);
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret || '')) {
    secret = newSecret(); put(SECRET_KEY, secret);
    if (old != null) put(NOTICE_KEY, '1');
  }
  if (old != null) put(OLD_TOKEN_KEY, null);
  return { secret, token: await tokenFor(secret), notice: get(NOTICE_KEY) === '1' };
}

export default async function (app) {
  installPresence(app);
  installTools(app);
  if (app.remote) return;
  if (!RELAY_LIVE && !relayOverride() && !relayPreview()) return; // (see RELAY_LIVE and relayPreview)
  if (!globalThis.crypto?.subtle) return;      // only in a secure context (the live site and localhost are)
  const { ui, store } = app;
  if (!store.authors[BY]) store.addAuthor(BY, { kind: 'agent', name: 'claude.ai' });

  const base = relayBase();
  let keys = await loadKeys();
  const tab = 'tab_' + b64url(crypto.getRandomValues(new Uint8Array(9)));
  let stream = null, timer = 0, backoff = 1000, epoch = 0;
  const running = new Map();   // call id -> AbortController

  const R = {
    state: 'off', agent: false, relay: base, tab, notice: keys.notice,
    get enabled() { return get(ON_KEY) === '1' || R._on; },
    get token() { return keys.token; },
    get url() { return `${base}/s/${keys.token}/mcp`; },
    enable, disable, rotate, copy, seen,
    _on: false,
  };
  app.remote = R;
  const route = (r) => `${base}/s/${keys.token}/${r}`;
  const headers = (more = {}) => ({ [SECRET_HEADER]: keys.secret, ...more });   // the secret goes in a header, never the URL
  const emit = () => ui.emit('remote:state', { state: R.state, agent: R.agent });
  const set = (state) => { if (R.state !== state) { R.state = state; emit(); } };
  const waitOf = (r) => Math.max(0, Math.min(300, Number(r?.headers?.get('retry-after')) || 0)) * 1000;

  async function hello() {
    try {
      const r = await fetch(route('hello'), { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ tab }) });
      if (!r.ok) return { ok: false, wait: waitOf(r) };
      const j = await r.json();
      agentState(!!j.agent);
      return { ok: true };
    } catch (e) { return { ok: false }; }
  }

  function agentState(on) {
    if (on === R.agent) return;
    R.agent = on;
    if (on) { app.presence.join(BY, { name: 'claude.ai', source: 'mcp' }); ui.toast?.('claude.ai is connected to this studio.', { kind: 'agent' }); }
    else app.presence.leave(BY);
    emit();
  }

  async function onCall(ev) {
    app.presence.join(BY, { name: 'claude.ai', source: 'mcp' });
    app.presence.status(statusLine(ev.tool), BY);
    const ac = new AbortController();
    running.set(ev.id, ac);
    let body;
    try {
      const result = await app.tools.run(ev.tool, ev.input || {}, { by: BY, signal: ac.signal });
      body = { id: ev.id, result };
      let text = JSON.stringify(body);
      if (text.length > MAX_RESULT && result && typeof result === 'object' && result.image) {
        body = { id: ev.id, result: { ...result, image: undefined, image_dropped: 'the spectrogram was too large to send; ask for a shorter range' } };
        text = JSON.stringify(body);
      }
      if (text.length > MAX_RESULT) body = { id: ev.id, error: 'the result is too large to send', hint: 'ask for less: a summary, one track, a shorter range' };
    } catch (e) { body = { id: ev.id, error: String(e && e.message || e) }; }
    running.delete(ev.id);
    app.presence.status('', BY);
    try { await fetch(route('result'), { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body) }); } catch (e) { console.warn('overdub remote: could not return a result'); }
  }

  function onEvent(data) {
    let ev; try { ev = JSON.parse(data); } catch (e) { return; }
    if (ev.type === 'call') onCall(ev);
    else if (ev.type === 'cancel') running.get(ev.id)?.abort();
    else if (ev.type === 'agent') agentState(ev.state === 'join');
    else if (ev.type === 'ready') agentState((ev.sessions || 0) > 0);
  }

  // The event stream: Server-Sent Events read with fetch, so the request can carry the secret in a header.
  async function listen(my) {
    const ac = new AbortController();
    stream = ac;
    let res = null;
    try { res = await fetch(`${route('events')}?tab=${tab}`, { headers: headers({ accept: 'text/event-stream' }), signal: ac.signal, cache: 'no-store' }); } catch (e) { /* offline, refused, aborted */ }
    if (my !== epoch) { ac.abort(); return; }
    if (!res || !res.ok || !res.body) { if (stream === ac) stream = null; return retry(waitOf(res)); }
    backoff = 1000; set('on');
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', last = Date.now();
    const watch = setInterval(() => { if (Date.now() - last > STALL_MS) ac.abort(); }, 5000);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || my !== epoch) break;
        last = Date.now();
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
          if (data) onEvent(data);
        }
        if (buf.length > MAX_EVENT) break;   // a runaway event: drop the stream and connect again
      }
    } catch (e) { /* aborted, or the connection dropped */ }
    clearInterval(watch);
    ac.abort();
    if (stream === ac) stream = null;
    if (my === epoch) retry();
  }

  async function connect() {
    const my = epoch;
    if (!R.enabled) return;
    clearTimeout(timer);
    set(R.state === 'on' || R.state === 'reconnecting' ? 'reconnecting' : 'connecting');
    const hi = await hello();
    if (my !== epoch || !R.enabled) return;
    if (!hi.ok) return retry(hi.wait);
    listen(my);
  }
  function retry(wait = 0) {
    set('reconnecting');
    clearTimeout(timer);
    const my = epoch, ms = Math.max(wait, backoff + Math.round(backoff * 0.2 * Math.random()));
    timer = setTimeout(() => { if (my === epoch) connect(); }, ms);
    backoff = Math.min(30000, backoff * 2);
  }
  function stop() {
    epoch++;
    clearTimeout(timer);
    stream?.abort(); stream = null;
    for (const ac of running.values()) ac.abort();
    running.clear();
    agentState(false);
    backoff = 1000;
  }

  function enable() { R._on = true; put(ON_KEY, '1'); stop(); set('connecting'); connect(); }
  function disable() { R._on = false; put(ON_KEY, null); stop(); set('off'); }
  async function rotate() {
    const secret = newSecret();
    keys = { secret, token: await tokenFor(secret) };
    put(SECRET_KEY, secret);
    seen(); R.notice = false;
    emit();
    if (R.enabled) { stop(); set('connecting'); connect(); }
    return R.url;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(R.url); return true; } catch (e) { return false; }
  }
  // The person has seen the Connect tab since the link changed: the note stays for this visit, not the next.
  function seen() { if (get(NOTICE_KEY) != null) put(NOTICE_KEY, null); }

  // the tab you're looking at is the one Claude drives (two tabs on one link: the latest focused wins)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && R.state === 'on') hello(); });
  window.addEventListener('pagehide', () => { stream?.abort(); });

  ui.panel({ id: 'connect', region: 'right', title: 'Connect', icon: 'bolt', order: 15, mount: (el) => mountCard(el, app, R) });
  if (R.enabled) { R._on = true; connect(); }
}

/* ------------------------------------------------------------------------------------------------ the card */
function mountCard(el, app, R) {
  css('remote', CSS);
  const { ui } = app;
  let copied = 0;
  const STATE = {
    off: ['off', 'Off'],
    connecting: ['busy', 'Connecting to the relay…'],
    reconnecting: ['busy', 'Reconnecting…'],
    on: ['ready', 'On: waiting for Claude'],
  };
  function render() {
    if (R.notice && ui.visible?.('connect')) R.seen();   // shown on screen once: gone on the next visit
    const [cls, text] = R.agent && R.state === 'on' ? ['live', 'claude.ai is connected'] : STATE[R.state] || STATE.off;
    const url = h('input.ew-input.rc-url', { value: R.url, readonly: true, 'aria-label': 'Connector URL', onfocus: (e) => e.target.select() });
    const copyBtn = h('button.ew-btn.rc-copy', { onclick: async () => {
      if (await R.copy()) { copied = Date.now(); render(); setTimeout(render, 1600); } else { url.focus(); url.select(); ui.toast('Select the link and copy it (the clipboard is blocked here)'); }
    } }, icon(Date.now() - copied < 1500 ? 'check' : 'copy', { size: 14 }), Date.now() - copied < 1500 ? 'Copied' : 'Copy');
    el.replaceChildren(h('div.rc-wrap', h('div.rc-card',
      h('div.rc-title', h('span.rc-orb', icon('bolt', { size: 18 })), h('div', h('b', 'Connect to Claude'), h('span', 'claude.ai on the web, and the Claude apps'))),
      R.notice ? h('p.rc-note.rc-changed', { role: 'status' }, icon('bolt', { size: 12 }), h('span', h('b', 'This studio has a new link. '), 'Connect now keeps a second key in this browser, so the old URL no longer reaches the studio. Copy the one below into claude.ai (Settings → Connectors) in place of the old one.')) : null,
      h('p.rc-p', 'Add this studio to Claude as a custom connector. Claude then plays in this tab: it reads the song, makes takes you can hear, and signs every edit.'),
      h('div.rc-row',
        h(`button.ew-btn.rc-toggle${R.enabled ? '.on' : '.ew-btn-agent'}`, { onclick: () => (R.enabled ? R.disable() : R.enable()), 'aria-pressed': String(R.enabled) }, icon('power', { size: 14 }), R.enabled ? 'Turn off' : 'Turn on'),
        h(`span.rc-state.${cls}`, { role: 'status' }, h('span.rc-dot'), text)),
      h('div.rc-label', 'Connector URL'),
      h('div.rc-row', url, copyBtn),
      h('ol.rc-steps',
        h('li', 'In claude.ai, open ', h('b', 'Settings → Connectors'), '.'),
        h('li', 'Choose ', h('b', 'Add custom connector'), ', name it Overdub and paste the URL.'),
        h('li', 'In a chat, turn Overdub on in the tools menu and ask Claude to look at your song. Keep this tab open.')),
      h('p.rc-p', 'claude.ai will say this connector has no sign-in. That\'s expected: the link is your key, and ', h('b', 'New link'), ' swaps it for a fresh one, so the old one stops reaching this tab.'),
      h('p.rc-note', icon('bolt', { size: 12 }), h('span', h('b', 'Anyone with this link can edit the song in this tab while Connect is on. '), 'Keep it to yourself. A new link turns the old one off.')),
      h('div.rc-row.rc-foot',
        h('button.rc-rotate', { onclick: async () => { await R.rotate(); ui.toast('New link made. Paste it into claude.ai: the old one no longer reaches this studio.'); } }, 'New link'),
        h('span.rc-small', `Relay: ${R.relay.replace(/^https?:\/\//, '')}`)),
    )));
  }
  render();
  const off = ui.on('remote:state', render);
  return { refresh: render, update() {}, unmount() { off?.(); } };
}

function statusLine(tool) {
  return ({ get_project: 'reading the song', get_selection: 'looking at your selection', apply_ops: 'editing the song', render_and_measure: 'listening (rendering)', define_device: 'building a device', adjust: 'adjusting a sound', propose_variations: 'waiting for your pick', ask_human: 'waiting for your answer', list_devices: 'browsing devices', play: 'playing it for you', highlight: 'pointing' })[tool] || 'working';
}

const CSS = `
.rc-wrap { padding: 12px; overflow: auto; height: 100%; }
.rc-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: var(--r-3); background: var(--bg-2); border: 1px solid var(--line); }
.rc-title { display: flex; align-items: center; gap: 10px; }
.rc-title b { display: block; font-family: var(--font-display); font-variation-settings: var(--font-display-vars, normal); font-style: italic; font-size: 18px; font-weight: 800; letter-spacing: -.01em; }
.rc-title span { font-size: 12px; color: var(--text-3); }
.rc-orb { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; color: var(--agent); background: var(--agent-wash); box-shadow: 0 0 0 1px color-mix(in srgb, var(--agent) 40%, transparent); flex: none; }
.rc-p { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-2); }
.rc-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.rc-url { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 11.5px; color: var(--text-2); }
.rc-copy { flex: none; }
.rc-toggle.on { color: var(--text); }
.rc-state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); min-width: 0; }
.rc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-2); flex: none; }
.rc-state.busy .rc-dot { background: var(--warn); } .rc-state.ready .rc-dot { background: var(--ok); }
.rc-state.live { color: var(--agent); } .rc-state.live .rc-dot { background: var(--agent); box-shadow: 0 0 8px var(--agent); }
.rc-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); margin-top: 2px; }
.rc-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.rc-steps b { color: var(--text); font-weight: 600; }
.rc-note { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 9px 10px; border-radius: var(--r-2); background: var(--bg-3); font-size: 11.5px; line-height: 1.45; color: var(--text-2); }
.rc-note .ico { color: var(--warn); margin-top: 2px; flex: none; } .rc-note b { color: var(--text); font-weight: 600; }
.rc-foot { justify-content: space-between; }
.rc-rotate { background: none; border: 0; padding: 0; color: var(--text-2); text-decoration: underline; cursor: pointer; font: inherit; font-size: 12px; }
.rc-rotate:hover { color: var(--text); }
.rc-small { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
