// The studio's Overdub account, for Connect: sign in by email (a code or a link), get a short tab ticket for the relay,
// list and disconnect the apps the account has allowed. It is the sign-in part of the cloud-credits branch's cloud.js
// (config, me, the bot check frame, signIn, enterCode, signOut) plus ticket(), grants() and disconnect(id); when that
// branch lands, cloud.js imports this instead of keeping its own copy.
//
//   const acct = createAccount({ api })          api: the account service's origin (none: the account is off)
//   acct.state  'signed-out' | 'sending' | 'check-inbox' | 'signed-in'      acct.me (GET /v1/me) / acct.email / acct.error
//   acct.load() / acct.refresh() / acct.signIn(email, { frameHost }) / acct.enterCode(email, code) / acct.signOut()
//   acct.ticket() -> { ticket, expiresAt, relay }   POST /v1/relay/ticket: five minutes, kept in memory only
//   acct.grants() -> [Grant] / acct.disconnect(id)  GET /v1/oauth/grants, DELETE /v1/oauth/grants/:id
//   acct.disconnectAll()                            DELETE /v1/oauth/grants
//   acct.signOutEverywhere()                        POST /v1/auth/logout-all: every browser of the account, this one
//                                                   too, and the apps allowed from other browsers (docs/OAUTH.md 6.2)
//   acct.on('state' | 'me', fn) -> off
//
// Every request carries the session cookie (credentials: 'include'), which is HttpOnly on the service's origin: this
// page never holds it. The ticket never goes in a URL or in storage.

const POLL_MS = 5000;
const POLL_FOR_MS = 15 * 60 * 1000;

export class AccountError extends Error {
  constructor(status, body = {}) {
    const e = (body && body.error) || {};
    super(e.message || (status ? `The account service answered ${status}.` : 'Couldn’t reach Overdub. Check your connection and try again.'));
    this.name = 'AccountError';
    this.status = status;
    this.code = e.code || (status ? 'http_' + status : 'unreachable');
  }
}

// An address shown back to its owner with the middle kept out of sight: jess@example.com -> j•••@example.com
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  return domain ? `${user.slice(0, 1)}•••@${domain}` : '';
}

export function createAccount({ api = null, fetch: f = (...a) => globalThis.fetch(...a), win = globalThis } = {}) {
  const fns = new Map();
  const emit = (type, d) => { for (const fn of fns.get(type) || []) { try { fn(d); } catch (e) { console.error('account listener', type, e); } } };
  let state = 'signed-out', me = null, config = null, pendingEmail = '', error = null;
  let pollT = 0, pollUntil = 0;

  function setState(s, err = null) { state = s; error = err; emit('state', s); }
  function setMe(m) {
    me = m || null;
    if (me && state !== 'signed-in') { stopPoll(); pendingEmail = ''; setState('signed-in'); } else if (!me && state === 'signed-in') setState('signed-out');
    emit('me', me);
  }

  async function req(method, path, body) {
    if (!api) throw new AccountError(0, { error: { code: 'off', message: 'Overdub accounts aren’t on in this studio.' } });
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try { res = await f(api + path, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); } catch { throw new AccountError(0); }
    if (res.status === 204) return null;
    let j = null;
    try { j = await res.json(); } catch { j = null; }
    if (!res.ok) {
      if (res.status === 401 && me) setMe(null);
      throw new AccountError(res.status, j);
    }
    return j;
  }

  async function load() {
    try { config = await req('GET', '/v1/config'); } catch { config = null; }
    await refresh().catch(() => null);
    return config;
  }
  async function refresh() {
    try { setMe(await req('GET', '/v1/me')); } catch (e) { if (e.status === 401) { setMe(null); return null; } throw e; }
    return me;
  }
  // The bot check: none on a local service (BOT_CHECK=stub); otherwise the service's own small page in a frame, which
  // posts its token back to this exact origin. The studio never loads a third-party script itself.
  function botToken(frameHost) {
    const kind = config?.botCheck?.kind || 'stub';
    if (kind === 'stub') return Promise.resolve('dev-ok');
    const failed = () => new AccountError(400, { error: { code: 'bot_check_failed', message: 'We couldn’t check you’re a person. Try again.' } });
    return new Promise((resolve, reject) => {
      if (!frameHost) { reject(failed()); return; }
      const frame = win.document.createElement('iframe');
      frame.className = 'rc-bot';
      frame.title = 'A quick check that you’re a person';
      frame.src = api + '/v1/auth/botcheck-frame';
      const done = (fn, v) => { win.removeEventListener('message', onMsg); clearTimeout(t); frame.remove(); fn(v); };
      const onMsg = (ev) => { if (ev.origin === api && ev.data && ev.data.type === 'overdub:botcheck' && typeof ev.data.token === 'string') done(resolve, ev.data.token); };
      const t = setTimeout(() => done(reject, failed()), 120000);
      win.addEventListener('message', onMsg);
      frame.addEventListener('load', () => { try { frame.contentWindow.postMessage({ type: 'overdub:botcheck-hello' }, api); } catch { /* the frame says hello again */ } });
      frameHost.replaceChildren(frame);
    });
  }
  async function signIn(email, { frameHost = null } = {}) {
    email = String(email || '').trim();
    setState('sending');
    try {
      const bot = await botToken(frameHost);
      const at = win.location ? win.location.origin + win.location.pathname : undefined;
      await req('POST', '/v1/auth/email', { email, botToken: bot, ...(at ? { returnTo: at } : {}) });
      pendingEmail = email;
      setState('check-inbox');
      startPoll();
    } catch (e) { setState('signed-out', e); throw e; }
  }
  async function enterCode(email, code) {
    try {
      await req('POST', '/v1/auth/code', { email: String(email || pendingEmail).trim(), code: String(code || '').replace(/\s+/g, '') });
    } catch (e) { error = e; emit('state', state); throw e; }
    return refresh();
  }
  function cancelSignIn() { stopPoll(); pendingEmail = ''; setState('signed-out'); }
  async function signOut() {
    try { await req('POST', '/v1/auth/logout', {}); } catch (e) { if (e.status !== 401) throw e; }
    setMe(null); setState('signed-out');
  }
  async function signOutEverywhere() {
    try { await req('POST', '/v1/auth/logout-all', {}); } catch (e) { if (e.status !== 401) throw e; }
    setMe(null); setState('signed-out');
  }
  // "Check your inbox": the link opened in this browser signs this tab in too, so /v1/me is asked every 5 s while the
  // tab is visible, for up to 15 minutes
  function startPoll() { pollUntil = Date.now() + POLL_FOR_MS; schedule(); }
  function stopPoll() { clearTimeout(pollT); pollT = 0; }
  function schedule() {
    clearTimeout(pollT);
    pollT = setTimeout(async () => {
      if (state !== 'check-inbox') return;
      if (Date.now() > pollUntil) { stopPoll(); return; }
      if (win.document?.visibilityState !== 'hidden') await refresh().catch(() => {});
      if (state === 'check-inbox') schedule();
    }, POLL_MS);
  }

  const ticket = () => req('POST', '/v1/relay/ticket', {});
  async function grants() { const r = await req('GET', '/v1/oauth/grants'); return Array.isArray(r?.grants) ? r.grants : []; }
  const disconnect = (id) => req('DELETE', `/v1/oauth/grants/${encodeURIComponent(id)}`);
  const disconnectAll = () => req('DELETE', '/v1/oauth/grants');

  return {
    get enabled() { return !!api; },
    api,
    get state() { return state; },
    get me() { return me; },
    get email() { return me?.user?.email || ''; },
    get pendingEmail() { return pendingEmail; },
    get error() { return error; },
    load, refresh, signIn, enterCode, cancelSignIn, signOut, signOutEverywhere, ticket, grants, disconnect, disconnectAll,
    on(type, fn) { if (!fns.has(type)) fns.set(type, new Set()); fns.get(type).add(fn); return () => fns.get(type)?.delete(fn); },
  };
}
