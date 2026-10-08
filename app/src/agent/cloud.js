// The hosted agent's account side: "Claude on Overdub credits", a service run by Overdub that lets someone without
// their own Claude set-up use the real agent, paid for with credits. It is OFF unless the deploy names its origin
// (app/src/site-config.js); forks and self-hosted copies never see it. The open studio holds no prices: the rate card,
// plans and packs come from the service's GET /v1/config at runtime.
//
//   const cloud = createCloud({ api, fetch })
//   cloud.enabled / cloud.api / cloud.state ('signed-out' | 'sending' | 'check-inbox' | 'signed-in' | 'error')
//   cloud.me (GET /v1/me, or null) / cloud.config (GET /v1/config, or null) / cloud.pendingEmail / cloud.error
//   cloud.load()                         -> config, then me (both quietly: a service that's down leaves cloud.config null)
//   cloud.refresh() -> me | null         401: signed out
//   cloud.signIn(email, { frameHost })   the bot check, POST /v1/auth/email -> 'check-inbox'; then polls /v1/me
//   cloud.enterCode(email, code) -> me   POST /v1/auth/code (the code from the email, for a link opened elsewhere)
//   cloud.cancelSignIn() / cloud.signOut()      signing out (and deleting) also drops this browser's ask-to-takes map
//   cloud.open({ kind, moreTime, promptVersion }, key) -> ActionOpened      key: one Idempotency-Key per Send press
//   cloud.call(actionId, body, signal) -> Response                         the raw event stream (or a JSON error)
//   cloud.wait(actionId) / cloud.finish(actionId, { outcome, cardPending, deviceWritten }) -> Settlement
//   cloud.creditBack(actionId, reason, key) -> { creditedBack, creditBackLeft, balance }
//   cloud.claimTrial() -> me / cloud.checkout(sku) -> { url, checkoutRef }
//   cloud.sync(checkoutRef) -> { me, paid }   paid: the service says that checkout is paid (so its credits are in)
//   cloud.activity({ before }) -> { items, next } / cloud.deleteAccount({ cancelPlan, forfeitCredits })
//   cloud.rateCard() -> [{ kind, label, credits }] / cloud.setBalance(balance)
//   cloud.on(type, fn) -> off            'state', 'me', 'config'
//
// Every request carries the session cookie (credentials: 'include'); the cookie is httpOnly on the service's origin, so
// this page never holds a token. Nothing from /v1/me is stored in the browser. Errors are CloudError
// { status, code, message, details }, the message written for a musician by the service.

export const HOSTED_NAME = 'Claude on Overdub credits';
const POLL_MS = 5000;
const POLL_FOR_MS = 15 * 60 * 1000;

export class CloudError extends Error {
  constructor(status, body = {}) {
    const e = (body && body.error) || {};
    super(
      e.message ||
        (status
          ? `The service answered ${status}.`
          : 'Couldn’t reach Claude on Overdub credits. Check your connection and try again.'),
    );
    this.name = 'CloudError';
    this.status = status;
    this.code = e.code || (status ? 'http_' + status : 'unreachable');
    const { code, message, ...details } = e;
    this.details = details;
  }
}

// An address shown back to its owner with the middle kept out of sight: jess@example.com -> j•••@example.com
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  return domain ? `${user.slice(0, 1)}•••@${domain}` : '';
}

// A URL the service hands back to open in a new tab (a checkout): https, or http on this machine, else nothing
export function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname))
      ? x.href
      : null;
  } catch (e) {
    return null;
  }
}

export function createCloud({ api = null, fetch: f = (...a) => globalThis.fetch(...a), win = globalThis } = {}) {
  const fns = new Map();
  const emit = (type, d) => {
    for (const fn of fns.get(type) || []) {
      try {
        fn(d);
      } catch (e) {
        console.error('cloud listener', type, e);
      }
    }
  };
  let state = 'signed-out',
    me = null,
    config = null,
    pendingEmail = '',
    error = null,
    checked = false;
  let pollT = 0,
    pollUntil = 0;

  function setState(s, err = null) {
    state = s;
    error = err;
    emit('state', s);
  }
  function setMe(m) {
    me = m || null;
    checked = true;
    if (me && state !== 'signed-in') {
      stopPoll();
      pendingEmail = '';
      setState('signed-in');
    } else if (!me && state === 'signed-in') setState('signed-out');
    emit('me', me);
  }

  async function req(method, path, body, { key = null, signal = null, raw = false } = {}) {
    if (!api)
      throw new CloudError(0, {
        error: { code: 'off', message: 'Claude on Overdub credits isn’t on in this studio.' },
      });
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    let res;
    try {
      res = await f(api + path, {
        method,
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        cache: 'no-store',
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new CloudError(0);
    }
    if (raw && res.ok) return res;
    if (res.status === 204) return null;
    let j = null;
    try {
      j = await res.json();
    } catch (e) {
      j = null;
    }
    if (!res.ok) {
      const err = new CloudError(res.status, j);
      if (!err.details.retryAfter && res.headers.get('retry-after'))
        err.details.retryAfter = Number(res.headers.get('retry-after')) || 0;
      if (res.status === 401 && me) setMe(null);
      throw err;
    }
    return j;
  }

  /* ------------------------------------------------------------------ account */
  async function load() {
    try {
      config = await req('GET', '/v1/config');
      emit('config', config);
    } catch (e) {
      config = null;
    }
    await refresh().catch(() => null);
    return config;
  }
  async function refresh() {
    try {
      setMe(await req('GET', '/v1/me'));
    } catch (e) {
      if (e.status === 401) {
        checked = true;
        setMe(null);
        return null;
      }
      throw e;
    }
    return me;
  }
  // The bot check: none on a local service (BOT_CHECK=stub); otherwise the service's own small page in a frame, which
  // posts its token back to this exact origin. The studio never loads a third-party script itself.
  function botToken(frameHost) {
    const kind = config?.botCheck?.kind || 'stub';
    if (kind === 'stub') return Promise.resolve('dev-ok');
    return new Promise((resolve, reject) => {
      if (!frameHost) {
        reject(
          new CloudError(400, {
            error: { code: 'bot_check_failed', message: 'We couldn’t check you’re a person. Try again.' },
          }),
        );
        return;
      }
      const frame = win.document.createElement('iframe');
      frame.className = 'ag-cl-bot';
      frame.title = 'A quick check that you’re a person';
      frame.src = api + '/v1/auth/botcheck-frame';
      const done = (fn, v) => {
        win.removeEventListener('message', onMsg);
        clearTimeout(t);
        frame.remove();
        fn(v);
      };
      const onMsg = (ev) => {
        if (ev.origin === api && ev.data && ev.data.type === 'overdub:botcheck' && typeof ev.data.token === 'string')
          done(resolve, ev.data.token);
      };
      const t = setTimeout(
        () =>
          done(
            reject,
            new CloudError(400, {
              error: { code: 'bot_check_failed', message: 'We couldn’t check you’re a person. Try again.' },
            }),
          ),
        120000,
      );
      win.addEventListener('message', onMsg);
      frame.addEventListener('load', () => {
        try {
          frame.contentWindow.postMessage({ type: 'overdub:botcheck-hello' }, api);
        } catch (e) {
          /* the frame says hello again */
        }
      });
      frameHost.replaceChildren(frame);
    });
  }
  async function signIn(email, { frameHost = null } = {}) {
    email = String(email || '').trim();
    setState('sending');
    try {
      const botTok = await botToken(frameHost);
      const at = win.location ? win.location.origin + win.location.pathname : undefined;
      await req('POST', '/v1/auth/email', { email, botToken: botTok, ...(at ? { returnTo: at } : {}) });
      pendingEmail = email;
      setState('check-inbox');
      startPoll();
    } catch (e) {
      setState('signed-out', e);
      throw e;
    }
  }
  async function enterCode(email, code) {
    await req('POST', '/v1/auth/code', {
      email: String(email || pendingEmail).trim(),
      code: String(code || '').replace(/\s+/g, ''),
    });
    return refresh();
  }
  function cancelSignIn() {
    stopPoll();
    pendingEmail = '';
    setState('signed-out');
  }
  async function signOut() {
    try {
      await req('POST', '/v1/auth/logout', {});
    } catch (e) {
      if (e.status !== 401) throw e;
    }
    forgetLocal();
    setMe(null);
    setState('signed-out');
  }
  // The ask-to-takes map (for credits back on undo) holds the service's action ids, which point at its usage records:
  // it goes when the account does, or is signed out of, on this browser
  function forgetLocal() {
    try {
      win.localStorage?.removeItem('overdub:cloud:takes');
    } catch (e) {
      /* storage blocked */
    }
  }

  // "Check your inbox": the link opened in this browser signs this tab in too, so /v1/me is asked every 5 s while the
  // tab is visible (and when it comes back into view), for up to 15 minutes
  function startPoll() {
    pollUntil = Date.now() + POLL_FOR_MS;
    schedule();
    win.addEventListener?.('focus', onFocus);
  }
  function stopPoll() {
    clearTimeout(pollT);
    pollT = 0;
    win.removeEventListener?.('focus', onFocus);
  }
  function onFocus() {
    if (state === 'check-inbox') refresh().catch(() => {});
  }
  function schedule() {
    clearTimeout(pollT);
    pollT = setTimeout(async () => {
      if (state !== 'check-inbox') return;
      if (Date.now() > pollUntil) {
        stopPoll();
        return;
      }
      if (win.document?.visibilityState !== 'hidden') await refresh().catch(() => {});
      if (state === 'check-inbox') schedule();
    }, POLL_MS);
  }

  /* ------------------------------------------------------------------ actions */
  const open = ({ kind, moreTime = false, promptVersion }, key) =>
    req('POST', '/v1/agent/actions', { kind, moreTime: !!moreTime, promptVersion }, { key });
  const call = (actionId, body, signal) =>
    req('POST', `/v1/agent/actions/${encodeURIComponent(actionId)}/calls`, body, { signal, raw: true });
  const wait = (actionId) => req('POST', `/v1/agent/actions/${encodeURIComponent(actionId)}/wait`, {});
  async function finish(actionId, { outcome = 'done', cardPending = false, deviceWritten = false } = {}) {
    const s = await req('POST', `/v1/agent/actions/${encodeURIComponent(actionId)}/finish`, {
      outcome,
      cardPending: !!cardPending,
      deviceWritten: !!deviceWritten,
    });
    if (s?.balance) setBalance(s.balance);
    return s;
  }
  async function creditBack(actionId, reason, key) {
    const r = await req('POST', `/v1/agent/actions/${encodeURIComponent(actionId)}/credit-back`, { reason }, { key });
    if (r?.balance) setBalance(r.balance);
    return r;
  }
  function setBalance(balance) {
    if (me && balance) {
      me = { ...me, balance };
      emit('me', me);
    }
  }

  /* ------------------------------------------------------------------ credits */
  async function claimTrial() {
    setMe(await req('POST', '/v1/trial/claim', { takeSaved: true }));
    return me;
  }
  async function checkout(sku) {
    const r = await req('POST', '/v1/billing/checkout', { sku }, { key: newKey() });
    const url = safeUrl(r?.url);
    if (url) win.open?.(url, '_blank', 'noopener');
    return { ...r, url };
  }
  async function sync(checkoutRef) {
    const { checkoutPaid, ...m } = (await req('POST', '/v1/billing/sync', { checkoutRef })) || {};
    setMe(m);
    return { me, paid: checkoutPaid !== false };
  }
  const activity = ({ before = null, limit = 20 } = {}) =>
    req('GET', `/v1/me/activity?limit=${limit}${before ? '&before=' + encodeURIComponent(before) : ''}`);
  async function deleteAccount({ cancelPlan = false, forfeitCredits = false } = {}) {
    await req('DELETE', '/v1/me', { confirm: 'delete', cancelPlan: !!cancelPlan, forfeitCredits: !!forfeitCredits });
    forgetLocal();
    setMe(null);
    setState('signed-out');
  }
  const rateCard = () =>
    Array.isArray(config?.rateCard)
      ? config.rateCard.filter((r) => r && typeof r.kind === 'string' && Number.isFinite(r.credits))
      : [];

  return {
    get enabled() {
      return !!api;
    },
    api,
    get state() {
      return state;
    },
    get me() {
      return me;
    },
    get config() {
      return config;
    },
    get checked() {
      return checked;
    },
    get pendingEmail() {
      return pendingEmail;
    },
    get error() {
      return error;
    },
    load,
    refresh,
    signIn,
    enterCode,
    cancelSignIn,
    signOut,
    open,
    call,
    wait,
    finish,
    creditBack,
    claimTrial,
    checkout,
    sync,
    activity,
    deleteAccount,
    rateCard,
    setBalance,
    on(type, fn) {
      if (!fns.has(type)) fns.set(type, new Set());
      fns.get(type).add(fn);
      return () => fns.get(type).delete(fn);
    },
  };
}

export const newKey = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(
        '',
      );

/* ------------------------------------------------------------------ the prompt bundle's version */
// The service owns the system prompt and the tools (by version, overdub-cloud SPEC §5.3): the studio sends only which
// version it was built with. The canonical form is the same on both sides: each tool exactly { name, description,
// input_schema }, sorted by name in code-unit order; canonicalJson sorts keys at every level, no whitespace, arrays in
// order, undefined dropped. version = 'sha256:' + the first 16 hex of sha256(canonicalJson({ system, tools })).
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',') + ']';
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
export function canonicalBundle(system, tools) {
  const list = (tools || [])
    .map(({ name, description, input_schema }) => ({ name, description, input_schema }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { system: String(system), tools: list };
}
export async function bundleVersion(bundle) {
  const bytes = new TextEncoder().encode(canonicalJson(bundle));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return 'sha256:' + Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
