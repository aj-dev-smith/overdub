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
// Accounts (off unless configured: ACCOUNT_LIVE below, or locally ?relay= and ?cloud=, both on localhost). The person
// signs in to their Overdub account here and in Claude, and every Claude client uses one fixed URL, <relay>/mcp. This tab
// trades its account session (a cookie on the account service, account.js) for a 5-minute tab ticket and talks to
// <relay>/tab/hello|events|result with Authorization: Bearer <ticket>, renewed every 2 minutes. The relay sends each
// call to the account's live tab (the one the person last had in front of them) and tells each tab whether it's live.
// Calls carry who signs them (claude.ai, mcp:claude-code, …: the agent the person allowed). The private link above is
// still there, one press away ('overdub:remote-mode': 'account' | 'link').
//
// The mode a browser starts in is written down the first time ('overdub:remote-mode'), so turning Connect on in account
// mode ('overdub:remote-on') never reads, on the next load, as a private link left on from before accounts.
// If the live tab keeps moving away from this one (three times in two minutes), or another connection takes this tab's
// place at the relay, the Connect tab says so and offers Sign out everywhere: a ticket that leaked is the likely cause.
//
// app.remote = { state, enabled, agent, agents, live, mode, url, token, relay, notice, account, connectError, moving,
//   enable(), disable(), rotate(), copy(), setMode(), playHere(), grants, loadGrants(), disconnectGrant(),
//   disconnectAll(), signOutEverywhere() }
// Emits ui 'remote:state' { state: 'off' | 'connecting' | 'on' | 'reconnecting', agent: bool }.

import { h, css, icon } from '../ui/dom.js';
import { installPresence } from './presence.js';
import { installTools } from './tools.js';
import { createAccount } from './account.js';

export const RELAY = 'https://overdub-relay.ajsmithhq.com';
// The hosted relay is live (deploy/relay/setup.sh, docs/REMOTE-MCP.md; tools/relay-test.js), so every studio shows the
// Connect tab. Setting this false hides it again everywhere but a local studio with ?relay=<a local relay> (node
// server/relay.js) or a browser that opened /app/?connect=1 (relayPreview). The page's policy allows RELAY in
// connect-src (app/index.html).
export const RELAY_LIVE = true;
// Sign in with Overdub: built and tested (tools/relay-test.js), not deployed. Until it is, account mode exists only on a
// local studio with both ?relay=<a local relay> and ?cloud=<a local account service> (docs/REMOTE-MCP.md, "Accounts").
export const ACCOUNT_LIVE = false;
export const ACCOUNT_RELAY = 'https://relay.overdubstudio.com';
export const ACCOUNT_API = 'https://api.overdubstudio.com';
export const BY = 'claude.ai';
// who may sign a call that came through an account (the relay sends the agent the person allowed)
export const AGENT_RE = /^(claude\.ai|mcp:[a-z0-9-]{1,32})$/;
const MODE_KEY = 'overdub:remote-mode';
const RENEW_MS = 2 * 60e3; // a new tab ticket this often (each lives 5 minutes)
const MOVED_MS = 2 * 60e3,
  MOVED_TIMES = 3; // live lost this often in this long: say so, and offer Sign out everywhere
const GRANTS_EVERY_MS = 5000; // Connected apps is asked for again at most this often (focus, an agent joining, the sheet)
export const SECRET_HEADER = 'x-overdub-tab-secret';
export const TOKEN_PREFIX = 'overdub-relay-token/v1:'; // the relay's too (server/relay.js tokenFor)
const SECRET_KEY = 'overdub:remote-secret';
const OLD_TOKEN_KEY = 'overdub:remote-token'; // before the secret: read once, then removed
const NOTICE_KEY = 'overdub:remote-notice';
const ON_KEY = 'overdub:remote-on';
const MAX_RESULT = 950 * 1024; // the relay takes 1 MB bodies
const STALL_MS = 45000; // the relay pings every 15 s: three missed and the stream is dead, so reconnect
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
  } catch {
    return null; /* not a URL */
  }
}
const relayBase = () => relayOverride() || RELAY;
// The account service a ?cloud= asks for: the same rules as ?relay= (a studio on this machine, an http(s) origin).
export function cloudOverride(search = location.search, host = location.hostname) {
  if (!LOCAL_HOST.test(host)) return null;
  const q = new URLSearchParams(search).get('cloud');
  if (!q) return null;
  try {
    const u = new URL(q);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null; /* not a URL */
  }
}
// The account service, when account mode is on here: locally both ?relay= and ?cloud=; live, ACCOUNT_LIVE. Else null.
export function accountApi(search = location.search, host = location.hostname) {
  const relay = relayOverride(search, host),
    cloud = cloudOverride(search, host);
  if (relay && cloud) return cloud;
  return ACCOUNT_LIVE ? ACCOUNT_API : null;
}
// The preview switch from the relay's trial, which matters only if RELAY_LIVE is ever turned off again: then the live
// site shows Connect only to a browser that asks: /app/?connect=1 turns the preview on here (remembered), ?connect=0
// turns it off. It reveals the Connect tab for RELAY above and nothing else: it can't point the tab anywhere (that's
// ?relay=, local only).
const PREVIEW_KEY = 'overdub:remote-preview';
export function relayPreview(search = location.search) {
  const q = new URLSearchParams(search).get('connect');
  if (q === '1') put(PREVIEW_KEY, '1');
  else if (q === '0') put(PREVIEW_KEY, null);
  return get(PREVIEW_KEY) === '1';
}
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
const newSecret = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
// The connector token for a tab secret: the first 22 characters of base64url(SHA-256(prefix + secret)).
export async function tokenFor(secret) {
  return b64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN_PREFIX + secret))),
  ).slice(0, 22);
}
const get = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked: this session only */
  }
};

// This browser's pair. A missing or malformed secret gets a new one; a token kept from before the secret is dropped
// (it opened both sides, so its URL is retired) and the Connect tab says once that the link changed.
async function loadKeys() {
  let secret = get(SECRET_KEY);
  const old = get(OLD_TOKEN_KEY);
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret || '')) {
    secret = newSecret();
    put(SECRET_KEY, secret);
    if (old != null) put(NOTICE_KEY, '1');
  }
  if (old != null) put(OLD_TOKEN_KEY, null);
  return { secret, token: await tokenFor(secret), notice: get(NOTICE_KEY) === '1' };
}

export default async function (app) {
  installPresence(app);
  installTools(app);
  if (app.remote) return;
  if (!RELAY_LIVE && !ACCOUNT_LIVE && !relayOverride() && !relayPreview()) return; // (see RELAY_LIVE and relayPreview)
  if (!globalThis.crypto?.subtle) return; // only in a secure context (the live site and localhost are)
  const { ui, store } = app;
  if (!store.authors[BY]) store.addAuthor(BY, { kind: 'agent', name: 'claude.ai' });

  const base = relayBase();
  const api = accountApi();
  const accountBase = relayOverride() || ACCOUNT_RELAY;
  const acct = api ? createAccount({ api }) : null;
  let keys = await loadKeys();
  const newTab = () => 'tab_' + b64url(crypto.getRandomValues(new Uint8Array(9)));
  let tab = newTab();
  let moved = [],
    grantsAt = 0; // when this tab lost live lately; when Connected apps was last asked for
  let stream = null,
    timer = 0,
    backoff = 1000,
    epoch = 0,
    renewer = 0;
  let ticket = null; // { ticket, expiresAt }: in memory only, never in a URL or storage
  const running = new Map(); // call id -> AbortController
  // Which way this browser connects. With accounts available, a browser that already had a private link on keeps it
  // until the person switches; everyone else starts with the account.
  // It's written down the first time, so the next load reads it back rather than guessing from 'overdub:remote-on' (which
  // account mode sets too: a reload used to turn a signed-in account tab into a private link, review 2026-10-05).
  const startMode = () => {
    if (!acct) return 'link';
    const kept = get(MODE_KEY);
    if (kept === 'link' || kept === 'account') return kept;
    const m = get(ON_KEY) === '1' ? 'link' : 'account';
    put(MODE_KEY, m);
    return m;
  };

  const R = {
    state: 'off',
    agent: false,
    agents: new Map(),
    live: true,
    relay: base,
    tab,
    notice: keys.notice,
    mode: startMode(),
    account: acct,
    grants: null,
    connectError: '',
    moving: false,
    get enabled() {
      return get(ON_KEY) === '1' || R._on;
    },
    get token() {
      return keys.token;
    },
    get url() {
      return R.mode === 'account' ? `${accountBase}/mcp` : `${base}/s/${keys.token}/mcp`;
    },
    get accountRelay() {
      return accountBase;
    },
    enable,
    disable,
    rotate,
    copy,
    seen,
    setMode,
    playHere,
    loadGrants,
    disconnectGrant,
    disconnectAll,
    signOutEverywhere,
    _on: false,
  };
  app.remote = R;
  const account = () => R.mode === 'account';
  const route = (r) => (account() ? `${accountBase}/tab/${r}` : `${base}/s/${keys.token}/${r}`);
  // the secret (or the ticket) goes in a header, never the URL
  const headers = (more = {}) =>
    account()
      ? { authorization: `Bearer ${ticket?.ticket || ''}`, ...more }
      : { [SECRET_HEADER]: keys.secret, ...more };
  const emit = () => ui.emit('remote:state', { state: R.state, agent: R.agent });
  const set = (state) => {
    if (R.state !== state) {
      R.state = state;
      emit();
    }
  };
  const waitOf = (r) => Math.max(0, Math.min(300, Number(r?.headers?.get('retry-after')) || 0)) * 1000;

  // A ticket for the relay, from the account service: a fresh one when there's none or it runs out within a minute.
  async function getTicket(force = false) {
    if (!force && ticket && ticket.expiresAt - Date.now() > 60e3) return true;
    try {
      const t = await acct.ticket();
      if (!t || typeof t.ticket !== 'string') return false;
      // expiresAt is ms since the epoch (seconds are read as such too, in case)
      const at = Number(t.expiresAt) || 0;
      ticket = { ticket: t.ticket, expiresAt: at > 1e12 ? at : at > 0 ? at * 1000 : Date.now() + 300e3 };
      if (R.connectError) {
        R.connectError = '';
        emit();
      }
      return true;
    } catch (e) {
      ticket = null;
      // said in the Connect tab, not only retried: the tab would sit at "Reconnecting…" with no reason given
      const why =
        e.status === 429
          ? 'Too many studio tabs are connecting from this browser. Close a few, or wait a few minutes.'
          : '';
      if (why !== R.connectError) {
        R.connectError = why;
        emit();
      }
      return false;
    }
  }

  // focus: this hello is for being in front of the person (load, visible, focused, Play here); a renewal isn't
  // recheck: a grant just disconnected here, for the relay to ask the service about now (account mode)
  async function hello({ focus = true, recheck = null } = {}) {
    try {
      if (account() && !(await getTicket())) return { ok: false };
      const body = account() ? { tab, ...(focus ? {} : { renew: true }), ...(recheck ? { recheck } : {}) } : { tab };
      let r = await fetch(route('hello'), {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (r.status === 401 && account() && (await getTicket(true)))
        r = await fetch(route('hello'), {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          body: JSON.stringify(body),
        });
      if (!r.ok) return { ok: false, wait: waitOf(r) };
      const j = await r.json();
      if (account()) {
        agentsAre(Array.isArray(j.agents) ? j.agents : []);
        if (typeof j.live === 'boolean') liveIs(j.live);
      } else agentState(!!j.agent);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // Who is connected. A private link only ever has claude.ai; an account may have several (claude.ai and Claude Code,
  // say), each shown by name.
  const nameOf = (agent, name) =>
    String(name || (agent === BY ? 'claude.ai' : agent.replace(/^mcp:/, ''))).slice(0, 40);
  function authorFor(agent, name) {
    if (!store.authors[agent]) store.addAuthor(agent, { kind: 'agent', name: nameOf(agent, name) });
  }
  function join(agent, name) {
    if (!AGENT_RE.test(agent) || R.agents.has(agent)) return;
    name = nameOf(agent, name);
    authorFor(agent, name);
    R.agents.set(agent, name);
    R.agent = true;
    app.presence.join(agent, { name, source: 'mcp' });
    // (the status line says Claude for claude.ai; the toast says the same. A private link keeps its own words)
    ui.toast?.(`${account() && agent === BY ? 'Claude' : name} is connected to this studio.`, { kind: 'agent' });
    // a new agent here usually means someone just pressed Allow: Connected apps catches up, with its Disconnect
    if (account()) loadGrants();
    emit();
  }
  function leave(agent) {
    if (!R.agents.delete(agent)) return;
    R.agent = R.agents.size > 0;
    app.presence.leave(agent);
    emit();
  }
  function agentState(on) {
    // (a private link: claude.ai or no one)
    if (on) join(BY, 'claude.ai');
    else for (const a of [...R.agents.keys()]) leave(a);
  }
  function agentsAre(list) {
    const now = new Map(
      list.filter((x) => x && typeof x.agent === 'string' && AGENT_RE.test(x.agent)).map((x) => [x.agent, x.agentName]),
    );
    for (const a of [...R.agents.keys()]) if (!now.has(a)) leave(a);
    for (const [a, n] of now) join(a, n);
  }
  // This tab is (or stops being) the one Claude plays in. Losing it says so once.
  function liveIs(live) {
    if (live === R.live) return;
    R.live = live;
    if (!live) {
      ui.toast?.('Claude moved to another tab.', {
        kind: 'agent',
        ms: 6000,
        action: { label: 'Play here', run: () => playHere() },
      });
      movedAway();
    }
    emit();
  }
  // Three moves away in two minutes is more than a person switching tabs: someone else may hold this account's
  // session. Said once in a toast, and in the Connect tab with Sign out everywhere, until it calms down.
  function movedAway() {
    const t = Date.now();
    moved = [...moved.filter((x) => t - x < MOVED_MS), t];
    const was = R.moving;
    R.moving = moved.length >= MOVED_TIMES;
    if (R.moving && !was)
      ui.toast?.('Claude keeps moving to another tab. If you didn’t open one, open Connect.', {
        kind: 'agent',
        ms: 10000,
        action: { label: 'Open Connect', run: () => ui.show?.('connect') },
      });
  }
  function playHere() {
    return R.state === 'on' ? hello({ focus: true }) : null;
  }

  async function onCall(ev) {
    // who signs it: a private link's calls are claude.ai's; an account's carry the agent the person allowed, and a call
    // signed by anything else edits nothing
    const by = account() ? ev.agent : BY;
    if (typeof by !== 'string' || !AGENT_RE.test(by)) {
      try {
        await fetch(route('result'), {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({
            id: ev.id,
            error: 'this call’s author couldn’t be read, so the studio didn’t run it',
          }),
        });
      } catch {
        /* the call times out */
      }
      return;
    }
    const name = nameOf(by, ev.agentName || R.agents.get(by));
    authorFor(by, name);
    app.presence.join(by, { name, source: 'mcp' });
    app.presence.status(statusLine(ev.tool), by);
    const ac = new AbortController();
    running.set(ev.id, ac);
    let body;
    try {
      const result = await app.tools.run(ev.tool, ev.input || {}, { by, signal: ac.signal });
      body = { id: ev.id, result };
      let text = JSON.stringify(body);
      if (text.length > MAX_RESULT && result && typeof result === 'object' && result.image) {
        body = {
          id: ev.id,
          result: {
            ...result,
            image: undefined,
            image_dropped: 'the spectrogram was too large to send; ask for a shorter range',
          },
        };
        text = JSON.stringify(body);
      }
      if (text.length > MAX_RESULT)
        body = {
          id: ev.id,
          error: 'the result is too large to send',
          hint: 'ask for less: a summary, one track, a shorter range',
        };
    } catch (e) {
      body = { id: ev.id, error: String((e && e.message) || e) };
    }
    running.delete(ev.id);
    app.presence.status('', by);
    try {
      await fetch(route('result'), {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
    } catch {
      console.warn('overdub remote: could not return a result');
    }
  }

  function onEvent(data) {
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.type === 'call') onCall(ev);
    else if (ev.type === 'cancel') running.get(ev.id)?.abort();
    else if (ev.type === 'agent' && account()) {
      if (ev.state === 'join') join(String(ev.agent || ''), ev.agentName);
      else leave(String(ev.agent || ''));
    } else if (ev.type === 'agent') agentState(ev.state === 'join');
    else if (ev.type === 'ready' && account()) {
      if (!ev.sessions) agentState(false);
      if (typeof ev.live === 'boolean') liveIs(ev.live);
    } else if (ev.type === 'ready') agentState((ev.sessions || 0) > 0);
    else if (ev.type === 'live') liveIs(!!ev.live);
    else if (ev.type === 'replaced' && account()) {
      // another connection took this tab's id at the relay (it was in this tab's requests): take a new id, which
      // reconnects as a new tab, and count it as a move away
      tab = newTab();
      R.tab = tab;
      if (R.live) liveIs(false);
      else movedAway();
      emit();
    }
  }

  // The event stream: Server-Sent Events read with fetch, so the request can carry the secret in a header.
  async function listen(my) {
    const ac = new AbortController();
    stream = ac;
    let res = null;
    try {
      res = await fetch(`${route('events')}?tab=${tab}`, {
        headers: headers({ accept: 'text/event-stream' }),
        signal: ac.signal,
        cache: 'no-store',
      });
    } catch {
      /* offline, refused, aborted */
    }
    if (my !== epoch) {
      ac.abort();
      return;
    }
    if (res && res.status === 401 && account()) ticket = null; // a new ticket on the next try
    // every one of the account's tab slots at the relay is connected: say so here, and keep trying
    if (res && res.status === 409 && account()) {
      let why = '';
      try {
        why = String((await res.json())?.error || '').slice(0, 200);
      } catch {
        /* no body */
      }
      if (why && why !== R.connectError) {
        R.connectError = why;
        emit();
      }
    } else if (res && res.ok && R.connectError) {
      R.connectError = '';
      emit();
    }
    if (!res || !res.ok || !res.body) {
      if (stream === ac) stream = null;
      return retry(waitOf(res));
    }
    backoff = 1000;
    set('on');
    const reader = res.body.getReader(),
      dec = new TextDecoder();
    let buf = '',
      last = Date.now();
    const watch = setInterval(() => {
      if (Date.now() - last > STALL_MS) ac.abort();
    }, 5000);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || my !== epoch) break;
        last = Date.now();
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
            .join('\n');
          if (data) onEvent(data);
        }
        if (buf.length > MAX_EVENT) break; // a runaway event: drop the stream and connect again
      }
    } catch {
      /* aborted, or the connection dropped */
    }
    clearInterval(watch);
    ac.abort();
    if (stream === ac) stream = null;
    if (my === epoch) retry();
  }

  async function connect() {
    const my = epoch;
    if (!R.enabled) return;
    if (account() && acct.state !== 'signed-in') {
      set('off');
      return;
    } // signing in connects (below)
    clearTimeout(timer);
    set(R.state === 'on' || R.state === 'reconnecting' ? 'reconnecting' : 'connecting');
    const hi = await hello();
    if (my !== epoch || !R.enabled) return;
    if (!hi.ok) return retry(hi.wait);
    if (account()) {
      clearInterval(renewer);
      renewer = setInterval(async () => {
        if (my === epoch && (await getTicket(true))) hello({ focus: false });
      }, RENEW_MS);
    }
    listen(my);
  }
  function retry(wait = 0) {
    set('reconnecting');
    clearTimeout(timer);
    const my = epoch,
      ms = Math.max(wait, backoff + Math.round(backoff * 0.2 * Math.random()));
    timer = setTimeout(() => {
      if (my === epoch) connect();
    }, ms);
    backoff = Math.min(30000, backoff * 2);
  }
  function stop() {
    epoch++;
    clearTimeout(timer);
    clearInterval(renewer);
    stream?.abort();
    stream = null;
    for (const ac of running.values()) ac.abort();
    running.clear();
    agentState(false);
    backoff = 1000;
  }

  function enable() {
    R._on = true;
    put(ON_KEY, '1');
    stop();
    set('connecting');
    connect();
  }
  function disable() {
    R._on = false;
    put(ON_KEY, null);
    stop();
    set('off');
  }
  async function rotate() {
    const secret = newSecret();
    keys = { secret, token: await tokenFor(secret) };
    put(SECRET_KEY, secret);
    seen();
    R.notice = false;
    emit();
    if (R.enabled) {
      stop();
      set('connecting');
      connect();
    }
    return R.url;
  }
  async function copy(text = R.url) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  // Account or private link. Switching drops this tab's connection and makes it again the other way, if Connect is on.
  function setMode(mode) {
    if (!acct || (mode !== 'account' && mode !== 'link') || mode === R.mode) return;
    stop();
    R.mode = mode;
    put(MODE_KEY, mode);
    ticket = null;
    R.live = true;
    set('off');
    emit();
    if (R.enabled) {
      set('connecting');
      connect();
    }
  }
  // The apps this account has allowed (claude.ai, Claude Code, …), for the Connect tab, and Disconnect. Asked for on
  // sign-in, when the Connect tab is shown, when this tab gets focus and when an agent joins (soon: at most every 5 s).
  async function loadGrants({ soon = false } = {}) {
    if (!acct || acct.state !== 'signed-in') {
      R.grants = null;
      return null;
    }
    if (soon && Date.now() - grantsAt < GRANTS_EVERY_MS) return R.grants;
    grantsAt = Date.now();
    try {
      R.grants = await acct.grants();
    } catch {
      R.grants = R.grants || [];
    }
    emit();
    return R.grants;
  }
  // Disconnect: the service revokes the grant, then the relay is asked to check it now, so its calls stop and its
  // presence goes here within seconds rather than at the relay's next minute check.
  async function afterDisconnect(gone) {
    if (account() && R.state === 'on') {
      for (const g of gone) await hello({ focus: false, recheck: g.id });
    } else for (const g of gone) if (!(R.grants || []).some((x) => x.agent === g.agent)) leave(g.agent);
  }
  async function disconnectGrant(id) {
    const g = (R.grants || []).find((x) => x.id === id);
    await acct.disconnect(id);
    R.grants = (R.grants || []).filter((x) => x.id !== id);
    emit();
    if (g) await afterDisconnect([g]);
  }
  async function disconnectAll() {
    const gone = R.grants || [];
    await acct.disconnectAll();
    R.grants = [];
    emit();
    await afterDisconnect(gone);
  }
  async function signOutEverywhere() {
    await acct.signOutEverywhere();
    moved = [];
    R.moving = false;
    emit();
  }
  // The person has seen the Connect tab since the link changed: the note stays for this visit, not the next.
  function seen() {
    if (get(NOTICE_KEY) != null) put(NOTICE_KEY, null);
  }

  // the tab you're looking at is the one Claude drives (two tabs on one link: the latest focused wins)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (R.state === 'on') hello();
    if (account()) loadGrants({ soon: true });
  });
  window.addEventListener('pagehide', () => {
    stream?.abort();
  });
  if (acct) {
    window.addEventListener('focus', () => {
      if (account() && R.state === 'on') hello();
      if (account()) loadGrants({ soon: true });
    });
    ui.on?.('show', (e) => {
      if (e?.id === 'connect' && account()) loadGrants({ soon: true });
    });
    // signing in (here, or by the link in another tab of this browser) connects; signing out stops at once
    acct.on('state', (st) => {
      if (st === 'signed-in') {
        if (account() && R.enabled && R.state === 'off') {
          stop();
          set('connecting');
          connect();
        }
        loadGrants();
      } else if (st === 'signed-out' && account()) {
        stop();
        ticket = null;
        R.grants = null;
        set('off');
      }
      emit();
    });
    acct.load().then(() => {
      if (acct.state === 'signed-in') loadGrants();
      emit();
    });
  }

  ui.panel({
    id: 'connect',
    region: 'right',
    title: 'Connect',
    icon: 'bolt',
    order: 15,
    mount: (el) => mountCard(el, app, R),
  });
  if (R.enabled) {
    R._on = true;
    connect();
  }
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
  const A = { email: '', code: '', busy: false, error: '', confirm: null, copied: 0, copiedCmd: 0, older: false }; // the account card's own state
  function render() {
    if (R.mode === 'account') return renderAccount();
    if (R.notice && ui.visible?.('connect')) R.seen(); // shown on screen once: gone on the next visit
    const [cls, text] = R.agent && R.state === 'on' ? ['live', 'claude.ai is connected'] : STATE[R.state] || STATE.off;
    const url = h('input.ew-input.rc-url', {
      value: R.url,
      readonly: true,
      'aria-label': 'Connector URL',
      onfocus: (e) => e.target.select(),
    });
    const copyBtn = h(
      'button.ew-btn.rc-copy',
      {
        onclick: async () => {
          if (await R.copy()) {
            copied = Date.now();
            render();
            setTimeout(render, 1600);
          } else {
            url.focus();
            url.select();
            ui.toast('Select the link and copy it (the clipboard is blocked here)');
          }
        },
      },
      icon(Date.now() - copied < 1500 ? 'check' : 'copy', { size: 14 }),
      Date.now() - copied < 1500 ? 'Copied' : 'Copy',
    );
    el.replaceChildren(
      h(
        'div.rc-wrap',
        h(
          'div.rc-card',
          h(
            'div.rc-title',
            h('span.rc-orb', icon('bolt', { size: 18 })),
            h('div', h('b', 'Connect to Claude'), h('span', 'claude.ai on the web, and the Claude apps')),
          ),
          R.notice
            ? h(
                'p.rc-note.rc-changed',
                { role: 'status' },
                icon('bolt', { size: 12 }),
                h(
                  'span',
                  h('b', 'This studio has a new link. '),
                  'Connect now keeps a second key in this browser, so the old URL no longer reaches the studio. Copy the one below into claude.ai (Settings → Connectors) in place of the old one.',
                ),
              )
            : null,
          h(
            'p.rc-p',
            'Add this studio to Claude as a custom connector. Claude then plays in this tab: it reads the song, makes takes you can hear, and signs every edit.',
          ),
          h(
            'div.rc-row',
            h(
              `button.ew-btn.rc-toggle${R.enabled ? '.on' : '.ew-btn-agent'}`,
              { onclick: () => (R.enabled ? R.disable() : R.enable()), 'aria-pressed': String(R.enabled) },
              icon('power', { size: 14 }),
              R.enabled ? 'Turn off' : 'Turn on',
            ),
            h(`span.rc-state.${cls}`, { role: 'status' }, h('span.rc-dot'), text),
          ),
          h('div.rc-label', 'Connector URL'),
          h('div.rc-row', url, copyBtn),
          h(
            'ol.rc-steps',
            h('li', 'In claude.ai, open ', h('b', 'Settings → Connectors'), '.'),
            h('li', 'Choose ', h('b', 'Add custom connector'), ', name it Overdub and paste the URL.'),
            h(
              'li',
              'In a chat, turn Overdub on in the tools menu and ask Claude to look at your song. Keep this tab open.',
            ),
          ),
          h(
            'p.rc-p',
            "claude.ai will say this connector has no sign-in. That's expected: the link is your key, and ",
            h('b', 'New link'),
            ' swaps it for a fresh one, so the old one stops reaching this tab.',
          ),
          h(
            'p.rc-note',
            icon('bolt', { size: 12 }),
            h(
              'span',
              h('b', 'Anyone with this link can edit the song in this tab while Connect is on. '),
              'Keep it to yourself. A new link turns the old one off.',
            ),
          ),
          h(
            'div.rc-row.rc-foot',
            h(
              'button.rc-rotate',
              {
                onclick: async () => {
                  await R.rotate();
                  ui.toast('New link made. Paste it into claude.ai: the old one no longer reaches this studio.');
                },
              },
              'New link',
            ),
            h('span.rc-small', `Relay: ${R.relay.replace(/^https?:\/\//, '')}`),
          ),
          R.account
            ? h(
                'div.rc-row.rc-foot',
                h(
                  'button.rc-rotate.rc-to-account',
                  { onclick: () => R.setMode('account') },
                  'Use your Overdub account instead',
                ),
              )
            : null,
        ),
      ),
    );
  }

  // Account mode: sign in (email, then the code), then one URL for every Claude app.
  function renderAccount() {
    const acct = R.account;
    const head = (sub) =>
      h(
        'div.rc-title',
        h('span.rc-orb', icon('bolt', { size: 18 })),
        h('div', h('b', 'Connect to Claude'), h('span', sub)),
      );
    const why = A.error || acct.error?.message || R.connectError;
    const err = why ? h('p.rc-err', { role: 'alert' }, why) : null;
    const linkInstead = h(
      'button.rc-rotate.rc-to-link',
      { onclick: () => R.setMode('link') },
      'Use a private link instead (no account)',
    );
    if (acct.state !== 'signed-in') {
      const inbox = acct.state === 'check-inbox';
      const email = h('input.ew-input.rc-email', {
        type: 'email',
        placeholder: 'you@example.com',
        autocomplete: 'email',
        'aria-label': 'Email',
        value: A.email,
        disabled: inbox || A.busy,
        oninput: (e) => {
          A.email = e.target.value;
        },
      });
      const code = h('input.ew-input.rc-code', {
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        placeholder: '6-digit code',
        'aria-label': 'Code from the email',
        value: A.code,
        maxlength: 12,
        oninput: (e) => {
          A.code = e.target.value;
        },
      });
      const send = async () => {
        A.error = '';
        A.busy = true;
        render();
        try {
          await acct.signIn(A.email, { frameHost: el.querySelector('.rc-bot-host') });
        } catch (e) {
          A.error = e.message;
        }
        A.busy = false;
        render();
        el.querySelector('.rc-code')?.focus();
      };
      const enter = async () => {
        A.error = '';
        A.busy = true;
        render();
        try {
          await acct.enterCode(A.email, A.code);
          A.code = '';
        } catch (e) {
          A.error = e.message;
        }
        A.busy = false;
        render();
      };
      el.replaceChildren(
        h(
          'div.rc-wrap',
          h(
            'div.rc-card',
            head('claude.ai, the Claude apps and Claude Code'),
            h(
              'p.rc-p',
              'Sign in to connect. A free Overdub account lets Claude find this studio from any Claude app. No card, no credits.',
            ),
            h(
              'form.rc-row',
              {
                onsubmit: (e) => {
                  e.preventDefault();
                  if (!inbox) send();
                },
              },
              email,
              inbox
                ? null
                : h(
                    'button.ew-btn.ew-btn-agent.rc-send',
                    { type: 'submit', disabled: A.busy },
                    A.busy ? 'Sending…' : 'Send code',
                  ),
            ),
            h('div.rc-bot-host'),
            inbox
              ? h(
                  'p.rc-p.rc-inbox',
                  { role: 'status' },
                  `Check your inbox: a code is on its way to ${A.email || acct.pendingEmail}. Type it here, or open the link in this browser.`,
                )
              : null,
            inbox
              ? h(
                  'form.rc-row',
                  {
                    onsubmit: (e) => {
                      e.preventDefault();
                      enter();
                    },
                  },
                  code,
                  h('button.ew-btn.ew-btn-agent.rc-enter', { type: 'submit', disabled: A.busy }, 'Sign in'),
                )
              : null,
            inbox
              ? h(
                  'button.rc-rotate',
                  {
                    onclick: () => {
                      acct.cancelSignIn();
                      A.code = '';
                      render();
                    },
                  },
                  'Use a different email',
                )
              : null,
            err,
            h('div.rc-row.rc-foot', linkInstead),
          ),
        ),
      );
      return;
    }
    const names = [...R.agents.values()].map((n) => (n === 'claude.ai' ? 'Claude' : n));
    const STATE = {
      off: ['off', 'Off'],
      connecting: ['busy', 'Connecting to the relay…'],
      reconnecting: ['busy', 'Reconnecting…'],
      on: ['ready', 'On: waiting for Claude'],
    };
    const [cls, text] =
      R.agent && R.state === 'on'
        ? ['live', `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} connected`]
        : STATE[R.state] || STATE.off;
    const cmd = `claude mcp add --transport http overdub ${R.url}`;
    const url = h('input.ew-input.rc-url', {
      value: R.url,
      readonly: true,
      'aria-label': 'Connector URL',
      onfocus: (e) => e.target.select(),
    });
    const copyBtn = (what, key, field) =>
      h(
        'button.ew-btn.rc-copy',
        {
          onclick: async () => {
            if (await R.copy(what)) {
              A[key] = Date.now();
              render();
              setTimeout(render, 1600);
            } else {
              field?.focus();
              field?.select?.();
              ui.toast('Select it and copy it (the clipboard is blocked here)');
            }
          },
        },
        icon(Date.now() - A[key] < 1500 ? 'check' : 'copy', { size: 14 }),
        Date.now() - A[key] < 1500 ? 'Copied' : 'Copy',
      );
    const cmdField = h('code.rc-cmd', cmd);
    el.replaceChildren(
      h(
        'div.rc-wrap',
        h(
          'div.rc-card',
          head(acct.email || 'Signed in'),
          h(
            'div.rc-row',
            h(
              `button.ew-btn.rc-toggle${R.enabled ? '.on' : '.ew-btn-agent'}`,
              { onclick: () => (R.enabled ? R.disable() : R.enable()), 'aria-pressed': String(R.enabled) },
              icon('power', { size: 14 }),
              R.enabled ? 'Turn off' : 'Turn on',
            ),
            h(`span.rc-state.${cls}`, { role: 'status' }, h('span.rc-dot'), text),
          ),
          R.state === 'on' && !R.live
            ? h(
                'p.rc-note.rc-elsewhere',
                { role: 'status' },
                icon('bolt', { size: 12 }),
                h('span', 'Claude is playing in another tab. '),
                h('button.rc-rotate.rc-play-here', { onclick: () => R.playHere() }, 'Play here'),
              )
            : null,
          R.moving ? movingNote() : null,
          h('div.rc-label', 'Connector URL'),
          h('div.rc-row', url, copyBtn(R.url, 'copied', url)),
          h(
            'p.rc-p',
            h('b', 'claude.ai and the Claude apps: '),
            'Customize → Connectors → Add custom connector. Paste the URL and add it, then press Connect and allow Overdub.',
          ),
          h('p.rc-p', h('b', 'Claude Code: '), 'run this, then ', h('b', '/mcp'), ' to sign in.'),
          h('div.rc-row', cmdField, copyBtn(cmd, 'copiedCmd', null)),
          h('p.rc-p', 'Claude plays in the tab you last had in front of you. Keep it open.'),
          h('div.rc-label', 'Connected apps'),
          grantList(),
          h('p.rc-small.rc-signout-note', 'Signing out of this studio leaves them connected. Disconnect them here.'),
          err,
          h(
            'div.rc-row.rc-foot',
            linkInstead,
            h(
              'button.rc-rotate.rc-signout',
              {
                onclick: async () => {
                  try {
                    await acct.signOut();
                  } catch (e) {
                    A.error = e.message;
                    render();
                  }
                },
              },
              'Sign out',
            ),
          ),
        ),
      ),
    );
  }
  // Claude keeps leaving this tab: likely someone else holds this account's session (a leaked tab ticket, say).
  function movingNote() {
    if (A.confirm === 'everywhere') {
      return h(
        'div.rc-note.rc-moving',
        { role: 'alert' },
        icon('bolt', { size: 12 }),
        h(
          'div',
          h(
            'span',
            'Sign out everywhere? Every browser signed in as you is signed out, this one too, and apps allowed from other browsers are disconnected. Then sign in again here.',
          ),
          h(
            'div.rc-row',
            h(
              'button.ew-btn.rc-everywhere-yes',
              {
                onclick: async () => {
                  A.confirm = null;
                  try {
                    await R.signOutEverywhere();
                  } catch (e) {
                    A.error = e.message;
                  }
                  render();
                },
              },
              'Sign out everywhere',
            ),
            h(
              'button.rc-rotate',
              {
                onclick: () => {
                  A.confirm = null;
                  render();
                },
              },
              'Keep',
            ),
          ),
        ),
      );
    }
    return h(
      'div.rc-note.rc-moving',
      { role: 'alert' },
      icon('bolt', { size: 12 }),
      h(
        'div',
        h(
          'span',
          h('b', 'Claude keeps moving to another tab. '),
          'If you didn’t open one, someone else may be signed in as you.',
        ),
        h(
          'button.rc-rotate.rc-everywhere',
          {
            onclick: () => {
              A.confirm = 'everywhere';
              render();
            },
          },
          'Sign out everywhere',
        ),
      ),
    );
  }
  function grantList() {
    const list = R.grants;
    if (!list) return h('p.rc-small', 'Looking…');
    if (!list.length) return h('p.rc-p.rc-apps-none', `Nothing is connected. Add ${R.url} in Claude to connect it.`);
    // label is what the consent page showed ("Claude · claude.ai", "Claude Code · this computer"): it carries the host
    const label = (g) => String(g.label || g.agentName || 'An app').slice(0, 60);
    const ms = (v) => (typeof v === 'number' && v < 1e12 ? v * 1000 : Number(v));
    // how long ago, never a date: the same words as the service's own list, in any time zone
    const ago = (v) => {
      const m = Math.floor((Date.now() - ms(v)) / 60e3);
      const n = (k, u) => `${k} ${u}${k === 1 ? '' : 's'} ago`;
      return !Number.isFinite(m)
        ? ''
        : m < 1
          ? 'just now'
          : m < 60
            ? n(m, 'minute')
            : m < 48 * 60
              ? n(Math.floor(m / 60), 'hour')
              : n(Math.floor(m / 1440), 'day');
    };
    const row = (g) => {
      const name = label(g),
        host = name.includes(' · ') ? '' : String(g.clientHost || '').slice(0, 60);
      const asking = A.confirm === g.id;
      return h(
        'li.rc-app',
        { 'data-grant': g.id },
        h(
          'div.rc-app-name',
          h('b', name),
          host ? h('span', ` · ${host}`) : null,
          h(
            'span.rc-small',
            [g.createdAt ? `connected ${ago(g.createdAt)}` : '', g.lastUsedAt ? `last used ${ago(g.lastUsedAt)}` : '']
              .filter(Boolean)
              .join(' · '),
          ),
        ),
        asking
          ? h(
              'div.rc-app-ask',
              h(
                'span',
                `Disconnect ${g.agentName === 'claude.ai' ? 'Claude' : String(g.agentName || name).slice(0, 40)}? It loses access to your studio, usually within a minute. You can connect it again from Claude.`,
              ),
              h(
                'button.ew-btn.rc-app-yes',
                {
                  onclick: async () => {
                    A.confirm = null;
                    try {
                      await R.disconnectGrant(g.id);
                    } catch (e) {
                      A.error = e.message;
                    }
                    render();
                  },
                },
                'Disconnect',
              ),
              h(
                'button.rc-rotate',
                {
                  onclick: () => {
                    A.confirm = null;
                    render();
                  },
                },
                'Keep',
              ),
            )
          : h(
              'button.rc-rotate.rc-app-off',
              {
                onclick: () => {
                  A.confirm = g.id;
                  render();
                },
              },
              'Disconnect',
            ),
      );
    };
    // rows unused for two weeks fold under Older (each Allow is its own row, so dead ones pile up): docs/OAUTH.md 6.2
    const idle = (g) => Date.now() - ms(g.lastUsedAt || g.createdAt) > 14 * 86400e3;
    const recent = list.filter((g) => !idle(g)),
      older = list.filter(idle);
    const all =
      A.confirm === 'all'
        ? h(
            'div.rc-app-ask.rc-all-ask',
            h(
              'span',
              'Disconnect every app? They lose access to your studio, usually within a minute. You can connect them again from Claude.',
            ),
            h(
              'button.ew-btn.rc-all-yes',
              {
                onclick: async () => {
                  A.confirm = null;
                  try {
                    await R.disconnectAll();
                  } catch (e) {
                    A.error = e.message;
                  }
                  render();
                },
              },
              'Disconnect all',
            ),
            h(
              'button.rc-rotate',
              {
                onclick: () => {
                  A.confirm = null;
                  render();
                },
              },
              'Keep',
            ),
          )
        : h(
            'button.rc-rotate.rc-all',
            {
              onclick: () => {
                A.confirm = 'all';
                render();
              },
            },
            'Disconnect all',
          );
    return h(
      'div.rc-apps-wrap',
      recent.length ? h('ul.rc-apps', ...recent.map(row)) : null,
      older.length
        ? h(
            'button.rc-rotate.rc-older',
            {
              onclick: () => {
                A.older = !A.older;
                render();
              },
              'aria-expanded': String(A.older),
            },
            `Older (${older.length})`,
          )
        : null,
      older.length && A.older ? h('ul.rc-apps.rc-apps-older', ...older.map(row)) : null,
      all,
    );
  }
  render();
  if (R.mode === 'account' && R.account?.state === 'signed-in') R.loadGrants({ soon: true });
  const off = ui.on('remote:state', render);
  return {
    refresh: render,
    update() {},
    unmount() {
      off?.();
    },
  };
}

function statusLine(tool) {
  return (
    {
      get_project: 'reading the song',
      get_selection: 'looking at your selection',
      apply_ops: 'editing the song',
      render_and_measure: 'listening (rendering)',
      define_device: 'building a device',
      adjust: 'adjusting a sound',
      propose_variations: 'waiting for your pick',
      ask_human: 'waiting for your answer',
      list_devices: 'browsing devices',
      play: 'playing it for you',
      highlight: 'pointing',
    }[tool] || 'working'
  );
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
.rc-label { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); margin-top: 2px; }
.rc-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.rc-steps b { color: var(--text); font-weight: 600; }
.rc-note { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 9px 10px; border-radius: var(--r-2); background: var(--bg-3); font-size: 12px; line-height: 1.45; color: var(--text-2); }
.rc-note .ico { color: var(--warn); margin-top: 2px; flex: none; } .rc-note b { color: var(--text); font-weight: 600; }
.rc-foot { justify-content: space-between; }
.rc-rotate { background: none; border: 0; padding: 0; color: var(--text-2); text-decoration: underline; cursor: pointer; font: inherit; font-size: 12px; }
.rc-rotate:hover { color: var(--text); }
.rc-small { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-email, .rc-code { flex: 1; min-width: 0; }
.rc-cmd { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-2); padding: 6px 8px; border-radius: var(--r-2); background: var(--bg-3); overflow-x: auto; white-space: nowrap; }
.rc-err { margin: 0; font-size: 12px; color: var(--bad, var(--warn)); }
.rc-bot-host:empty { display: none; }
.rc-bot-host iframe { width: 100%; height: 72px; border: 0; }
.rc-apps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.rc-app { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; font-size: 12.5px; color: var(--text-2); }
.rc-app-name { min-width: 0; } .rc-app-name b { color: var(--text); font-weight: 600; } .rc-app-name .rc-small { display: block; white-space: normal; }
.rc-app-ask { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; max-width: 60%; font-size: 12px; text-align: right; }
.rc-elsewhere { align-items: center; }
.rc-apps-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; } .rc-apps-wrap .rc-apps { align-self: stretch; }
.rc-moving > div { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.rc-signout-note { white-space: normal; }
`;
