// Sign in with Overdub, the relay's half: how the relay checks an access token (from Claude) or a tab ticket (from the
// studio) that the Overdub account service signed. Zero dependencies. server/relay.js is the HTTP side; this file holds
// the rules, so they read in one place. It is used only when the relay starts with OAuth config (RELAY_OAUTH_ISSUER);
// without it the relay is exactly the private-link relay. docs/REMOTE-MCP.md ("Accounts") is the design.
//
//   oauthConfig(opts) -> config | throws          checks the config at boot: canonical resource, https URLs
//   createAuth(config, { log, fetch }) -> auth
//     auth.verify(token, 'access' | 'ticket')     -> { ok, claims } | { ok: false, kind }   (signature and claims)
//     auth.checkGrant(token, claims)              -> { active, reason? }                     (introspection, cached 60 s;
//                                                   a 429 keeps the last answer another 60 s instead of asking again)
//     auth.forget(gid) / auth.checkedAt(gid)      drop a grant's cached answer (Disconnect in the studio) / when asked
//     auth.checkSession(token, claims)            -> { active }                              (the ticket's sid, the same)
//     auth.challenge(kind) / auth.body(kind)      the WWW-Authenticate value and the JSON body of a 401 or 403
//     auth.metadata                               the protected resource metadata (RFC 9728)
//     auth.stats                                  counts: grant checks ok / revoked / unreachable, and failures by kind
//
// Tokens are JWS compact, EdDSA (Ed25519), checked with node:crypto against the service's JWKS. An access token is
// typ "at+jwt", aud the resource (…/mcp); a tab ticket is typ "overdub-tab+jwt", aud <relay origin>/tab. Neither can
// stand in for the other. The relay never logs a token, a sub or a grant id, only counts by kind.

import crypto from 'node:crypto';

export const SCOPE = 'studio';
export const TYPES = { access: 'at+jwt', ticket: 'overdub-tab+jwt' };
const SKEW_S = 30;                 // exp may be this far behind the relay's clock
const IAT_AHEAD_S = 60;            // iat may be this far ahead of it
const CHECK_MS = 60e3;             // a grant's or a session's answer is kept this long
const REVOKED_MS = 15 * 60e3 + SKEW_S * 1000;   // a grant seen revoked stays refused until its longest token is dead
const JWKS_MS = 3600e3;            // the service's keys are fetched again after this
const JWKS_RETRY_MS = 60e3;        // an unknown kid fetches them again, at most this often
const MAX_CACHE = 5000;            // grants and sessions remembered (the oldest go first)
const AGENT_RE = /^(claude\.ai|mcp:[a-z0-9-]{1,32})$/;

// The header descriptions are plain ASCII (RFC 6750 section 3: no quote, no backslash, nothing past 0x7e); the body's
// copy is the friendlier sentence.
export const FAILURES = {
  missing: { status: 401, header: null, body: 'Sign in to Overdub to let Claude use your studio.' },
  expired: { status: 401, header: 'Sign-in expired', body: 'This sign-in has expired.' },
  revoked: { status: 401, header: 'Disconnected in Overdub', body: 'This connection was disconnected in Overdub.' },
  audience: { status: 401, header: 'Token is for another server', body: 'This token isn’t for this server.' },
  unreadable: { status: 401, header: 'Token could not be read', body: 'This token couldn’t be read.' },
  scope: { status: 403, header: 'The studio scope is needed', body: 'This sign-in doesn’t include the studio. Connect again.' },
};

// The canonical form of a resource URL as clients compare it: lowercase scheme and host, no default port, no trailing
// slash, no query or fragment.
export function canonicalResource(s) {
  const u = new URL(s);
  const port = u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) ? ':' + u.port : '';
  const p = u.pathname.replace(/\/+$/, '');
  return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${port}${p}`;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1)$/;
function checkUrl(name, s, dev) {
  let u;
  try { u = new URL(s); } catch { throw new Error(`${name} is not a URL`); }
  if (u.protocol === 'https:') return u.href.replace(/\/$/, '');
  if (u.protocol === 'http:' && dev && LOOPBACK.test(u.hostname)) return u.href.replace(/\/$/, '');
  throw new Error(`${name} must be https:// (http://localhost and http://127.0.0.1 only with RELAY_OAUTH_DEV=1)`);
}

// The relay's OAuth config, checked: it refuses to start on a resource that isn't already canonical (the string in the
// metadata, the 401 and the aud it compares must all match what the client canonicalises) or on plain-http URLs.
export function oauthConfig(o) {
  if (!o || !o.issuer) return null;
  const dev = !!o.dev;
  const issuer = String(o.issuer).replace(/\/$/, '');
  checkUrl('RELAY_OAUTH_ISSUER', issuer, dev);
  if (!o.resource) throw new Error('RELAY_OAUTH_RESOURCE is required with RELAY_OAUTH_ISSUER');
  let canon;
  try { canon = canonicalResource(o.resource); } catch { throw new Error('RELAY_OAUTH_RESOURCE is not a URL'); }
  if (canon !== o.resource) throw new Error(`RELAY_OAUTH_RESOURCE must be canonical: ${canon}`);
  checkUrl('RELAY_OAUTH_RESOURCE', o.resource, dev);
  if (!/\/mcp$/.test(new URL(o.resource).pathname)) throw new Error('RELAY_OAUTH_RESOURCE must end in /mcp (the relay serves MCP there)');
  const jwksUrl = o.jwks ? null : checkUrl('RELAY_OAUTH_JWKS_URL', o.jwksUrl || issuer + '/oauth/jwks', dev);
  const introspectUrl = checkUrl('RELAY_OAUTH_INTROSPECT_URL', o.introspectUrl || issuer + '/oauth/introspect', dev);
  if (!o.introspectSecret) throw new Error('RELAY_INTROSPECT_SECRET is required with RELAY_OAUTH_ISSUER (the service prints a dev one at start)');
  const origin = new URL(o.resource).origin;
  return {
    issuer, resource: o.resource, origin, ticketAudience: origin + '/tab',
    hosts: (o.hosts || []).map((h) => String(h).toLowerCase()).filter(Boolean),
    jwks: o.jwks ? (typeof o.jwks === 'string' ? JSON.parse(o.jwks) : o.jwks) : null, jwksUrl, introspectUrl,
    introspectSecret: String(o.introspectSecret || ''),
    metadataUrl: origin + '/.well-known/oauth-protected-resource' + new URL(o.resource).pathname,
    documentation: o.documentation || 'https://overdubstudio.com/docs/remote-mcp/',
    checkMs: Number(o.checkMs) > 0 ? Number(o.checkMs) : CHECK_MS,   // (tests shorten it)
  };
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
const ascii = (s) => /^[\x20-\x21\x23-\x5B\x5D-\x7E]*$/.test(s);

export function createAuth(cfg, { log = () => {}, fetch: f = globalThis.fetch, now = Date.now } = {}) {
  const stats = { grantOk: 0, grantRevoked: 0, grantUnreachable: 0, grantThrottled: 0, reuseRevoked: 0, sessionOk: 0, sessionEnded: 0, sessionUnreachable: 0, failures: {} };
  let keys = new Map(), keysAt = 0, keysTried = 0, keysLoading = null, warnedPrivate = false, warnedSecret = false;

  /* ---------------- keys */
  function loadKeys(set) {
    const out = new Map();
    const list = Array.isArray(set?.keys) ? set.keys : [];
    if (list.some((k) => k && typeof k === 'object' && 'd' in k)) {
      if (!warnedPrivate) { log('oauth: the JWKS carries a private key part: refused whole'); warnedPrivate = true; }
      return out;
    }
    for (const k of list) {
      if (!k || k.kty !== 'OKP' || k.crv !== 'Ed25519' || typeof k.kid !== 'string' || !k.kid || typeof k.x !== 'string') continue;
      try { out.set(k.kid, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: k.x }, format: 'jwk' })); } catch { /* not a key */ }
    }
    return out;
  }
  async function fetchKeys() {
    if (cfg.jwks) { keys = loadKeys(cfg.jwks); keysAt = now(); return; }
    if (keysLoading) return keysLoading;
    keysTried = now();
    keysLoading = (async () => {
      try {
        const r = await f(cfg.jwksUrl, { signal: AbortSignal.timeout(3000), headers: { accept: 'application/json' } });
        if (r.ok) { keys = loadKeys(await r.json()); keysAt = now(); } else log('oauth: JWKS fetch answered', r.status);
      } catch (e) { log('oauth: JWKS fetch failed', e?.name || 'Error'); }
      finally { keysLoading = null; }
    })();
    return keysLoading;
  }
  async function keyFor(kid) {
    if (!keysAt || now() - keysAt > JWKS_MS) await fetchKeys();
    if (!keys.has(kid) && now() - keysTried >= JWKS_RETRY_MS) await fetchKeys();   // a new key, after a rotation
    return keys.get(kid) || null;
  }

  /* ---------------- tokens */
  const fail = (kind) => { stats.failures[kind] = (stats.failures[kind] || 0) + 1; return { ok: false, kind }; };
  // The signature and the claims. Never throws; a failure is one of FAILURES' kinds.
  async function verify(token, use) {
    if (typeof token !== 'string' || token.length > 8192) return fail('unreadable');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]*$/.test(p))) return fail('unreadable');
    let head, claims;
    try { head = b64json(parts[0]); claims = b64json(parts[1]); } catch { return fail('unreadable'); }
    if (!head || typeof head !== 'object' || !claims || typeof claims !== 'object') return fail('unreadable');
    if (head.alg !== 'EdDSA' || 'crit' in head || typeof head.kid !== 'string') return fail('unreadable');
    // jku, jwk, x5u and x5c are never used: keys come only from the configured JWKS
    if (head.typ !== TYPES[use]) return fail('audience');
    const key = await keyFor(head.kid);
    if (!key) return fail('unreadable');
    let good = false;
    try { good = crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url')); } catch { good = false; }
    if (!good) return fail('unreadable');
    const t = now() / 1000;
    const aud = use === 'access' ? cfg.resource : cfg.ticketAudience;
    if (claims.iss !== cfg.issuer || typeof claims.aud !== 'string' || claims.aud !== aud) return fail('audience');
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= t) return fail('expired');
    if (typeof claims.iat === 'number' && claims.iat > t + IAT_AHEAD_S) return fail('unreadable');
    if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claims.sub)) return fail('unreadable');
    if (use === 'access') {
      if (typeof claims.gid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claims.gid)) return fail('unreadable');
      if (!String(claims.scope || '').split(' ').includes(SCOPE)) return fail('scope');
    } else if (typeof claims.sid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claims.sid)) return fail('unreadable');
    return { ok: true, claims };
  }

  /* ---------------- the grant and session checks */
  const grants = new Map();    // gid -> { active, at, reason, wait }
  const sessions = new Map();  // sid -> { active, at, wait }
  const revoked = new Map();   // gid -> until (never evicted early)
  function remember(map, k, v) { map.delete(k); map.set(k, v); while (map.size > MAX_CACHE) map.delete(map.keys().next().value); }
  async function introspect(token, hint) {
    const body = new URLSearchParams({ token, ...(hint ? { token_type_hint: hint } : {}) });
    const auth = 'Basic ' + Buffer.from('overdub-relay:' + cfg.introspectSecret).toString('base64');
    let r;
    try { r = await f(cfg.introspectUrl, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(2000) }); } catch { return null; }
    // 401 or 403: the service refused the relay's own secret. That's a misconfiguration, not an outage, so it fails
    // closed (nothing is cached: the next check asks again) and is logged once.
    if (r.status === 401 || r.status === 403) { if (!warnedSecret) { log('oauth: the introspection endpoint refused the relay secret'); warnedSecret = true; } return { refused: true }; }
    // 429: the service is up and asks the relay to slow down. The last answer is kept for another check window rather
    // than asked again on every request (which kept a full bucket full), and it's counted on its own
    if (r.status === 429) return { throttled: true };
    if (!r.ok) return null;   // 5xx: unreachable, as far as the fail-open rule goes
    try { const j = await r.json(); return j && typeof j === 'object' ? j : null; } catch { return null; }
  }
  // Is the grant behind this access token still live? Asked at most once a minute per grant (concurrent asks share
  // one call). The service unreachable: the signature stands until exp, for a grant never seen revoked here.
  async function checkGrant(token, claims) {
    const gid = claims.gid;
    const until = revoked.get(gid);
    if (until) { if (until > now()) return { active: false, reason: 'revoked' }; revoked.delete(gid); }
    const c = grants.get(gid);
    if (c && c.wait) return c.wait;
    if (c && now() - c.at < cfg.checkMs) return { active: c.active, reason: c.reason };
    const wait = (async () => {
      const j = await introspect(token, null);
      if (j?.throttled) {
        stats.grantThrottled++;
        // the last answer stands for another window; a grant never checked fails open as for an outage, and that too is
        // remembered for a window, so a throttled relay asks once a minute per grant, not once a request
        const last = c && typeof c.active === 'boolean' ? { active: c.active, reason: c.reason } : { active: true };
        remember(grants, gid, { ...last, at: now() });
        return { ...last, ...(last.active ? { unreachable: true } : {}) };
      }
      if (!j) { stats.grantUnreachable++; grants.delete(gid); return { active: true, unreachable: true }; }
      if (j.refused) { grants.delete(gid); return { active: false, reason: 'refused' }; }
      const active = j.active === true && j.sub === claims.sub && (j.gid === undefined || j.gid === gid);
      if (active) stats.grantOk++;
      else {
        stats.grantRevoked++;
        revoked.set(gid, now() + REVOKED_MS);
        if (j.revoke_reason === 'reuse' || j.revoke_reason === 'code_reuse') stats.reuseRevoked++;
      }
      remember(grants, gid, { active, at: now(), reason: active ? undefined : String(j.revoke_reason || 'revoked').slice(0, 20) });
      return { active, reason: active ? undefined : 'revoked' };
    })();
    remember(grants, gid, { ...(c || {}), wait });
    return wait;
  }
  // Is the studio session behind this tab ticket still live? The same rules, per sid.
  async function checkSession(token, claims) {
    const sid = claims.sid;
    const c = sessions.get(sid);
    if (c && c.wait) return c.wait;
    if (c && now() - c.at < cfg.checkMs) return { active: c.active };
    if (c && c.active === false) return { active: false };   // an ended session never comes back
    const wait = (async () => {
      const j = await introspect(token, 'tab_ticket');
      if (j?.throttled) {
        stats.sessionUnreachable++;
        const last = c && typeof c.active === 'boolean' ? c.active : true;
        remember(sessions, sid, { active: last, at: now() });
        return { active: last, unreachable: last };
      }
      if (!j) { stats.sessionUnreachable++; sessions.delete(sid); return { active: true, unreachable: true }; }
      if (j.refused) { sessions.delete(sid); return { active: false }; }
      const active = j.active === true && j.sub === claims.sub && (j.sid === undefined || j.sid === sid);
      if (active) stats.sessionOk++; else stats.sessionEnded++;
      remember(sessions, sid, { active, at: now() });
      return { active };
    })();
    remember(sessions, sid, { ...(c || {}), wait });
    return wait;
  }
  const isRevoked = (gid) => (revoked.get(gid) || 0) > now();
  // The person just disconnected a grant in the studio: drop what the relay remembers about it, so the next check
  // asks the service now instead of up to a minute later. (It can only make the relay ask sooner, never trust more.)
  const forget = (gid) => { const c = grants.get(gid); if (c && !c.wait) grants.delete(gid); };
  // When this grant was last asked about (0: never, or forgotten)
  const checkedAt = (gid) => grants.get(gid)?.at || 0;

  /* ---------------- answers */
  const params = (kind) => {
    const F = FAILURES[kind] || FAILURES.unreadable;
    const p = [];
    if (kind === 'scope') p.push('error="insufficient_scope"', `error_description="${F.header}"`);
    else if (F.header) p.push('error="invalid_token"', `error_description="${F.header}"`);
    p.push(`resource_metadata="${cfg.metadataUrl}"`, `scope="${SCOPE}"`);
    return p;
  };
  function challenge(kind) {
    const p = params(kind);
    // each quoted value plain ASCII without a quote or a backslash (the quotes themselves are the syntax)
    if (!p.every((x) => ascii(x.slice(x.indexOf('"') + 1, -1)))) throw new Error('a WWW-Authenticate value outside plain ASCII');
    return 'Bearer ' + p.join(', ');
  }
  function body(kind) {
    const F = FAILURES[kind] || FAILURES.unreadable;
    if (kind === 'missing') return { error_description: F.body };
    return { error: kind === 'scope' ? 'insufficient_scope' : 'invalid_token', error_description: F.body };
  }
  const metadata = {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Overdub studio',
    resource_documentation: cfg.documentation,
  };

  return { cfg, verify, checkGrant, checkSession, isRevoked, forget, checkedAt, challenge, body, metadata, stats, status: (kind) => (FAILURES[kind] || FAILURES.unreadable).status,
    caches: () => ({ grants: grants.size, sessions: sessions.size, revoked: revoked.size, keys: keys.size }) };
}

// Who an access token says the agent is (the service decided it at consent), and a display name. The studio accepts
// only ids of the form AGENT_RE and refuses a call signed by anything else, so a bad claim is passed on as it is.
export const AGENT_ID = AGENT_RE;
export function agentOf(claims) {
  const agent = typeof claims.agent === 'string' ? claims.agent.slice(0, 64) : '';
  const named = typeof claims.agent_name === 'string' && claims.agent_name.trim() ? claims.agent_name.trim().slice(0, 40) : '';
  const name = named || (agent === 'claude.ai' ? 'claude.ai' : agent === 'mcp:claude-code' ? 'Claude Code' : agent.replace(/^mcp:/, '') || 'an agent');
  return { agent, name };
}
