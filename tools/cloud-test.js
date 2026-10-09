// Claude on Overdub credits, the studio's side (agent/cloud.js, cloud-kind.js, cloud-panel.js, the 'cloud' provider in
// claude.js), against a fake of the service in this file (node:http): the public repo never depends on the private one.
// Off without a site config; the three sign-in states and the code; the balance in the head; the price on screen before
// any ask opens (typed, a suggestion, the tour, a direct send); a Claude of your own first; an ask streaming tool calls
// that run here, signed Claude; Stop, retries, out of credits, credits back on undo; free moves; nothing secret kept in
// the browser; the prompt bundle's version; back from a checkout (/app/?plus=done, /app/?plus=cancel). Browsers run muted (tools/pw.js
// QUIET). Screenshots: tools/.out/cloud-*.png.
//
//   node tools/cloud-test.js
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { open, tally } from './pw.js';

const t = tally('cloud');
const realErrors = (errs) => errs.filter((e) => !/Failed to load resource|favicon|fonts\.g/.test(e));
const ready = (page) => page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(100); } };

/* ------------------------------------------------------------------ the fake service */
// Made-up numbers throughout: the real rate card, plans and packs are the service's, never this repo's.
const RATE = [
  { kind: 'quick_change', label: 'A quick change', credits: 2 },
  { kind: 'question', label: 'A question', credits: 2 },
  { kind: 'new_part', label: 'A new part', credits: 7 },
  { kind: 'new_instrument', label: 'A new instrument or effect', credits: 11 },
];
const ev = (type, o = {}) => ({ type, ...o });
export const reply = (text, { stop = 'end_turn' } = {}) => [
  ev('message_start', { message: { id: 'm', model: 'standard', usage: { input_tokens: 3 } } }),
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
  ev('content_block_stop', { index: 0 }),
  ev('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: 5 } }),
  ev('message_stop'),
];
const toolCall = (text, id, name, input) => [
  ev('message_start', { message: { id: 'm', model: 'standard', usage: { input_tokens: 3 } } }),
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
  ev('content_block_stop', { index: 0 }),
  ev('content_block_start', { index: 1, content_block: { type: 'tool_use', id, name, input: {} } }),
  ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }),
  ev('content_block_stop', { index: 1 }),
  ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }),
  ev('message_stop'),
];

function fakeCloud() {
  const users = new Map();        // email -> { email, balance, trial }
  const sessions = new Map();     // token -> email
  const pending = new Map();      // od_pending value -> { email, code }
  const actions = new Map();
  const log = [];                 // every request: { method, path, body, headers }
  const script = [];              // what the next calls answer: SSE events, { status, error }, or { hang: true }
  const studio = /^http:\/\/localhost:\d+$/;   // the studio origins it answers (a local studio on any port)
  let paused = false;
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));
  const userOf = (req) => { const e = sessions.get(cookies(req).od_session); return e ? users.get(e) : null; };
  const balance = (u) => ({ total: u.balance, monthly: 0, trial: 0, packs: u.balance, other: 0, held: 0, debt: 0, nextExpiry: null });
  const me = (u) => ({ user: { id: 'usr_' + u.email.length, email: u.email, createdAt: 1 }, balance: balance(u), asksHint: Math.round(u.balance / 3.5), plan: null, trial: { eligible: !!u.trialEligible, claimed: false },
    creditBack: { budget: 9, left: 9, periodEnd: 1 }, limits: { dailyCreditsLeft: 99 }, notice: u.notice || null });
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const err = (res, status, code, message, details = {}) => send(res, status, { error: { code, message, ...details } });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = '';
    for await (const c of req) raw += c;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    log.push({ method: req.method, path: url.pathname, body, headers: req.headers });
    const origin = req.headers.origin;
    const allowed = !!origin && studio.test(origin);
    if (allowed) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('access-control-expose-headers', 'retry-after');
      res.setHeader('vary', 'Origin');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, allowed ? { 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'content-type, idempotency-key' } : {}); return res.end(); }
    if (req.method !== 'GET' && !allowed && !url.pathname.startsWith('/dev/')) return err(res, 403, 'forbidden_origin', 'That came from a page Overdub doesn’t know.');
    const p = url.pathname;
    if (p === '/v1/config') return send(res, 200, { rateCard: RATE, moreTime: { multiplier: 2, kinds: [] }, plans: [{ sku: 'plus_x', label: 'Overdub Plus, monthly', usd: 1.23, interval: 'month', monthlyCredits: 123 }], packs: [{ sku: 'pack_x', label: '40 credits', usd: 0.45, credits: 40 }], trial: { credits: 6 }, botCheck: { kind: 'stub' }, promptVersions: [], hosted: { enabled: true } });
    if (p === '/v1/auth/email') {
      if (body?.botToken !== 'dev-ok') return err(res, 400, 'bot_check_failed', 'We couldn’t check you’re a person. Try again.');
      const pend = cookies(req).od_pending || randomUUID();
      pending.set(pend, { email: String(body.email).toLowerCase(), code: '042917' });
      return send(res, 202, { sent: true }, { 'set-cookie': `od_pending=${pend}; HttpOnly; SameSite=Lax; Path=/` });
    }
    const signIn = (email) => { const tok = randomUUID(); if (!users.has(email)) users.set(email, { email, balance: 30 }); sessions.set(tok, email); return `od_session=${tok}; HttpOnly; SameSite=Strict; Path=/`; };
    if (p === '/v1/auth/code') {
      const pd = pending.get(cookies(req).od_pending);
      if (!pd || pd.email !== String(body?.email).toLowerCase() || pd.code !== body?.code) return err(res, 400, 'bad_code', 'That code didn’t match. Check the email and try again.', { attemptsLeft: 4 });
      pending.delete(cookies(req).od_pending);
      return send(res, 200, { signedIn: true }, { 'set-cookie': signIn(pd.email) });
    }
    // the link, opened in the same browser (the real one has a confirm page and a form post)
    if (p === '/dev/verify') {
      const pd = pending.get(cookies(req).od_pending);
      if (!pd) { res.writeHead(400); return res.end('expired'); }
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': signIn(pd.email) });
      return res.end('<p>You’re signed in. Go back to your Overdub tab.</p>');
    }
    if (p === '/dev/checkout') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<p>Fake checkout</p>'); }
    const u = userOf(req);
    if (!u) return err(res, 401, 'not_signed_in', 'Sign in to use Claude on Overdub credits.');
    if (p === '/v1/me' && req.method === 'GET') return send(res, 200, me(u));
    if (p === '/v1/me' && req.method === 'DELETE') { sessions.delete(cookies(req).od_session); users.delete(u.email); return send(res, 204); }
    if (p === '/v1/me/activity') return send(res, 200, { items: [...actions.values()].filter((a) => a.email === u.email && a.charged).map((a) => ({ at: a.at, kind: 'spend', credits: -a.credits, label: RATE.find((r) => r.kind === a.kind).label, actionId: a.id })) });
    if (p === '/v1/auth/logout') { sessions.delete(cookies(req).od_session); return send(res, 204, undefined, { 'set-cookie': 'od_session=; Max-Age=0; Path=/' }); }
    if (p === '/v1/trial/claim') { u.balance += 6; u.trialEligible = false; return send(res, 200, me(u)); }
    if (p === '/v1/billing/checkout') return send(res, 200, { url: `http://localhost:${server.address().port}/dev/checkout`, checkoutRef: 'chk_1' });
    // chk_late: a checkout the provider hasn't marked paid yet (nothing granted, and the answer says so)
    if (p === '/v1/billing/sync') { if (body?.checkoutRef === 'chk_late') return send(res, 200, { ...me(u), checkoutPaid: false }); u.balance += 40; return send(res, 200, { ...me(u), checkoutPaid: true }); }
    if (p === '/v1/agent/actions' && req.method === 'POST') {
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(req.headers['idempotency-key'] || '')) return err(res, 400, 'validation_failed', 'The studio sent something the agent can’t take. Reload and try again.', { field: 'idempotency-key' });
      if (paused) return err(res, 503, 'hosted_paused', 'Claude on Overdub credits is paused right now. Your own Claude, Claude Code and the demo still work.');
      const openOne = [...actions.values()].find((a) => a.email === u.email && a.status === 'open');
      if (openOne) return err(res, 409, 'action_in_flight', 'The agent is still working on your last ask.', { actionId: openOne.id });
      const row = RATE.find((r) => r.kind === body?.kind);
      if (!row) return err(res, 400, 'validation_failed', 'The studio sent something the agent can’t take. Reload and try again.', { field: 'kind' });
      if (u.balance < row.credits) return err(res, 402, 'insufficient_credits', 'You’re out of credits for this one.', { needed: row.credits, balance: u.balance });
      u.balance -= row.credits;
      const a = { id: 'act_' + randomUUID().slice(0, 8), email: u.email, kind: row.kind, credits: row.credits, status: 'open', calls: [], delivered: 0, at: Date.now(), promptVersion: body.promptVersion };
      actions.set(a.id, a);
      return send(res, 201, { actionId: a.id, kind: a.kind, credits: a.credits, tier: 'standard', maxCalls: 12, balance: balance(u) });
    }
    const m = /^\/v1\/agent\/actions\/([^/]+)\/(calls|wait|finish|credit-back)$/.exec(p);
    const a = m && actions.get(m[1]);
    if (m && (!a || a.email !== u.email)) return err(res, 404, 'action_not_found', 'That ask isn’t here any more.');
    if (m && m[2] === 'calls') {
      if (a.status !== 'open') return err(res, 409, 'action_closed', 'That ask is already finished.');
      a.calls.push(body);
      const next = script.shift() || reply('Done.');
      if (next.status) { res.writeHead(next.status, { 'content-type': 'application/json', ...(next.retryAfter != null ? { 'retry-after': String(next.retryAfter) } : {}) }); return res.end(JSON.stringify({ error: next.error })); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      if (next.hang) { res.write(`event: message_start\ndata: ${JSON.stringify(ev('message_start', { message: { usage: {} } }))}\n\n`); a.delivered++; req.on('close', () => {}); return; }
      for (const e of next) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      a.delivered++;
      res.write(`event: overdub\ndata: ${JSON.stringify({ type: 'overdub', callsUsed: a.calls.length, callsLeft: 12 - a.calls.length, lastCall: false })}\n\n`);
      return res.end();
    }
    if (m && m[2] === 'wait') return send(res, 200, { ok: true });
    if (m && m[2] === 'finish') {
      if (a.settlement) return send(res, 200, a.settlement);
      a.status = body?.outcome === 'stopped' ? 'stopped' : body?.outcome === 'error' ? 'error' : 'done';
      a.finish = body;
      const charge = a.delivered > 0 && body?.outcome !== 'error';
      if (!charge) u.balance += a.credits;
      a.charged = charge;
      a.settlement = { charged: charge ? a.credits : 0, released: charge ? 0 : a.credits, reason: charge ? 'delivered' : 'nothing_delivered', balance: balance(u), creditBackUntil: charge ? Date.now() + 120000 : null };
      return send(res, 200, a.settlement);
    }
    if (m && m[2] === 'credit-back') {
      if (!a.charged) return err(res, 409, 'not_charged', 'That ask wasn’t charged.');
      if (a.back) return err(res, 409, 'already_credited_back', 'Those credits are back already.');
      a.back = body?.reason; u.balance += a.credits;
      return send(res, 200, { creditedBack: a.credits, creditBackLeft: 9 - a.credits, balance: balance(u) });
    }
    return err(res, 404, 'not_found', 'That isn’t here.');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const origin = `http://localhost:${server.address().port}`;
    resolve({
      origin, log, script, users, actions,
      pause(on) { paused = on; },
      user(email) { return users.get(email); },
      grant(email, n) { if (!users.has(email)) users.set(email, { email, balance: 0 }); users.get(email).balance = n; },
      reqs(path) { return log.filter((r) => r.path === path || (path instanceof RegExp && path.test(r.path))); },
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    });
  }));
}

/* ------------------------------------------------------------------ the studio, pointed at it */
async function studio(fake, { config = 'env', key = false, query = '' } = {}) {
  if (config === 'env') process.env.OVERDUB_CLOUD_ORIGIN = fake.origin; else delete process.env.OVERDUB_CLOUD_ORIGIN;
  if (key) process.env.OVERDUB_ANTHROPIC_KEY = 'sk-ant-test-key'; else delete process.env.OVERDUB_ANTHROPIC_KEY;
  const q = [query, config === 'query' ? `cloud=${encodeURIComponent(fake.origin)}` : ''].filter(Boolean).join('&');
  const s = await open('/app/', { query: q });
  await ready(s.page);
  await s.page.evaluate(() => { localStorage.setItem('overdub:welcomed', '1'); });
  await s.page.reload({ waitUntil: 'load' });
  await ready(s.page);
  return s;
}
// turn the hosted agent on, as the person would from Agent settings (its ask chip is the panel's own)
async function chooseCloud(page) {
  await page.waitForFunction(() => !!window.overdub.agent.cloud?.config, null, { timeout: 10000 });
  await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); e.agent.useCloud(true); });
  await page.waitForFunction(() => window.overdub.agent.provider === 'cloud', null, { timeout: 5000 });
}
async function signInByCode(page, fake, email = 'jess@example.com') {
  await page.waitForSelector('.ag-cl-signin .ag-cl-email', { timeout: 5000 });
  await page.fill('.ag-cl-signin .ag-cl-email', email);
  await page.click('.ag-cl-signin .btn-go');
  await page.waitForSelector('.ag-cl-signin[data-state="check-inbox"] .ag-cl-code', { timeout: 5000 });
  await page.fill('.ag-cl-code', '042917');
  await page.click('.ag-cl-signin .ag-cl-field .btn');
  await page.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-in', null, { timeout: 5000 });
}
const typeAsk = async (page, text) => { await page.fill('.ag-input', text); };
const actionsOpened = (fake) => fake.reqs('/v1/agent/actions').filter((r) => r.method === 'POST');

/* ------------------------------------------------------------------ 0. in Node: the open rules and the canonical form */
{
  const { classify, freeMove, KINDS } = await import('../app/src/agent/cloud-kind.js');
  const k = (text, hint) => classify({ text, hint }).kind;
  const cases = [
    ['Make this warmer', 'quick_change'], ['More space', 'quick_change'], ['Make the hats busier', 'quick_change'],
    ['Write a counter-melody', 'new_part'], ['add a bassline under the chorus', 'new_part'], ['Give me a bass part', 'new_part'], ['Give me three takes on the hook', 'new_part'],
    ['Build me a pedal like this, but darker', 'new_instrument'], ['make a synth that sounds like glass', 'new_instrument'], ['Use the reverb on the keys', 'quick_change'], ['find a fuzz pedal', 'quick_change'],
    ['What would you change?', 'question'], ['why is the bass so loud', 'question'], ['Can you write a bass part?', 'new_part'],
  ];
  const wrong = cases.filter(([s, want]) => k(s) !== want).map(([s, want]) => `"${s}": ${k(s)}, not ${want}`);
  t.ok(!wrong.length, `node: the kind of an ask, by the open rules (${cases.length} asks)${wrong.length ? ': ' + wrong.join('; ') : ''}`);
  t.ok(k('Make this warmer', 'new_part') === 'new_part' && k('x', 'not_a_kind') === 'quick_change' && classify({ text: 'x' }).alternatives.join() === KINDS.join(), 'node: a picked kind wins; an unknown one is ignored; all four kinds are the alternatives');
  const devices = [{ id: 'core.verb', name: 'Reverb', kind: 'effect' }, { id: 'core.pad', name: 'Pad', kind: 'instrument' }];
  const fm = (s, hasTrack = true) => freeMove(s, { devices, hasTrack });
  t.ok(fm('warmer')?.tool === 'adjust' && fm('Make it brighter.')?.input.axis === 'brighter' && fm('less muddy')?.tool === 'adjust', 'node: one lexicon word, or "make it <word>", on a selected track is a free move');
  t.ok(fm('use reverb')?.device === 'core.verb' && fm('add a pad', false)?.device === 'core.pad' && !fm('use reverb', false), 'node: "use / add <device>" by its exact name is a free move (an effect needs a track)');
  t.ok(!fm('warmer', false) && !fm('make it warmer and add a bassline') && !fm('use the cathedral reverb') && !fm('warm the bass up a bit') && !fm(''), 'node: anything looser is an ask, not a free move');

  const { canonicalJson, canonicalBundle, bundleVersion, maskEmail, safeUrl } = await import('../app/src/agent/cloud.js');
  const vec = canonicalBundle('You are a test agent.', [{ name: 'b_tool', description: 'B.', input_schema: { type: 'object', properties: {} } }, { name: 'a_tool', description: 'A.', input_schema: { type: 'object' } }]);
  const want = '{"system":"You are a test agent.","tools":[{"description":"A.","input_schema":{"type":"object"},"name":"a_tool"},{"description":"B.","input_schema":{"properties":{},"type":"object"},"name":"b_tool"}]}';
  const v = await bundleVersion(vec);
  t.ok(canonicalJson(vec) === want && v === 'sha256:4e39ca426d1be9ae', `node: the prompt bundle's canonical form and version match the service's test vector (${v})`);
  t.ok(canonicalBundle('s', [{ name: 'x', description: 'd', input_schema: {}, annotations: { title: 'X' }, eager_input_streaming: true }]).tools[0].annotations === undefined, 'node: a bundle tool is only name, description and input schema');
  t.ok(maskEmail('jess@example.com') === 'j•••@example.com' && safeUrl('javascript:alert(1)') === null && safeUrl('http://evil.example/x') === null && !!safeUrl('https://pay.example/x'), 'node: an address is shown masked; only an https (or local) checkout URL is opened');

  const { cloudOrigin, cloudOverride } = await import('../app/src/site-config.js');
  t.ok(cloudOrigin('https://api.example.com/x') === 'https://api.example.com' && cloudOrigin('http://localhost:8787') === 'http://localhost:8787' && !cloudOrigin('http://api.example.com') && !cloudOrigin('javascript:x') && !cloudOrigin('https://u:p@api.example.com'), 'node: a cloud origin is https, or http on this machine');
  t.ok(cloudOverride('?cloud=http://localhost:8787', 'localhost') === 'http://localhost:8787' && !cloudOverride('?cloud=https://api.example.com', 'localhost') && !cloudOverride('?cloud=http://localhost:8787', 'overdubstudio.com'),
    'node: ?cloud= only points a studio on this machine at a service on this machine (a link can\'t send a song elsewhere)');
}

const fake = await fakeCloud();

/* ------------------------------------------------------------------ 1. off without a site config */
{
  const { page, errors, close } = await studio(fake, { config: 'none' });
  const before = fake.log.length;
  await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); document.querySelector('.ag-hbtns .ag-hbtn:last-child')?.click(); });
  await sleep(600);
  const out = await page.evaluate(() => ({ cloud: window.overdub.agent.cloud, row: !!document.querySelector('.ag-kc-cloud'), chip: !document.querySelector('.ag-price')?.hidden }));
  out.config = await page.evaluate(() => fetch('site-config.json').then((r) => r.json()));
  t.ok(out.cloud === null && !out.row && !out.chip && JSON.stringify(out.config) === '{}', `with no site config the hosted agent is off: no account, no row in settings, no price (site-config.json ${JSON.stringify(out.config)})`);
  t.ok(fake.log.length === before, `and the studio asks no cloud origin anything (${fake.log.length - before} requests)`);
  t.ok(realErrors(errors).length === 0, 'no page errors (off)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 2. sign in: three states, the link, the code */
{
  const { page, context, errors, close, shot } = await studio(fake, { config: 'query' });
  await page.waitForFunction(() => !!window.overdub.agent.cloud?.config, null, { timeout: 10000 }).catch(() => {});
  const setup = await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); document.querySelector('.ag-hbtns .ag-hbtn:last-child')?.click(); return { row: document.querySelector('.ag-kc-cloud')?.textContent || '', provider: e.agent.provider }; });
  t.ok(/Claude on Overdub credits/.test(setup.row) && /No set-up, uses credits/.test(setup.row) && setup.provider !== 'cloud', `?cloud=<a local service> on a local studio: settings offer Claude on Overdub credits, not on until chosen ("${setup.row.slice(0, 90)}")`);
  await page.click('.ag-kc-cloud .btn:not(.btn-txt)');
  await page.waitForSelector('.ag-cl-signin', { timeout: 5000 });
  await sleep(200);
  const s1 = await page.evaluate(() => ({ text: document.querySelector('.ag-cl-signin').textContent, live: document.querySelector('.ag-cl-signin [aria-live="polite"]')?.textContent, provider: window.overdub.agent.provider, settings: !!document.querySelector('.ag-keycard'), focus: document.activeElement?.textContent }));
  t.ok(s1.provider === 'cloud' && !s1.settings && /Sign in with your email/.test(s1.live) && /Send link/.test(s1.text) && /the studio needs no account/.test(s1.text) && s1.focus === 'Claude on Overdub credits',
    'chosen in settings while signed out: settings close, the sign-in sheet comes up with its heading focused, one field ("Sign in with your email"), announced politely');
  await shot('cloud-signin');
  await page.fill('.ag-cl-email', 'Jess@Example.com');
  await page.click('.ag-cl-signin .btn-go');
  await page.waitForSelector('.ag-cl-signin[data-state="check-inbox"]', { timeout: 5000 });
  const s2 = await page.evaluate(() => document.querySelector('.ag-cl-signin').textContent);
  const asked = fake.reqs('/v1/auth/email').pop();
  t.ok(/Check your inbox\. We sent a link to J•••@Example\.com\. It works once, for 15 minutes\./.test(s2) && /6-digit code/.test(s2) && /Use a different email/.test(s2), 'Send link: "Check your inbox", the address masked, the code field and "Use a different email"');
  t.ok(asked && asked.body.botToken === 'dev-ok' && asked.body.email === 'Jess@Example.com' && /^http:\/\/localhost:\d+\/app\//.test(asked.body.returnTo || ''), `the request carries the bot check's token and where to come back to (${asked?.body?.returnTo})`);
  await shot('cloud-inbox');
  // the code field keeps its words while the tab polls (the sheet isn't redrawn under the keyboard)
  await page.fill('.ag-cl-code', '04');
  await page.focus('.ag-cl-code');
  await sleep(5600);
  const kept = await page.evaluate(() => ({ v: document.querySelector('.ag-cl-code')?.value, focus: document.activeElement?.classList.contains('ag-cl-code'), polls: 0 }));
  const polls = fake.reqs('/v1/me').length;
  t.ok(kept.v === '04' && kept.focus && polls >= 2, `while it waits it asks /v1/me every few seconds (${polls}), and the code field keeps its words and focus`);
  // the link, opened in this browser: the waiting tab notices on its own
  const tab = await context.newPage();
  await tab.goto(fake.origin + '/dev/verify');
  await tab.close();
  const inByLink = await until(() => page.evaluate(() => window.overdub.agent.cloud?.state === 'signed-in'), 8000);
  const s3 = await page.evaluate(() => ({ sheet: !!document.querySelector('.ag-cl-signin'), head: document.querySelector('.ag-who')?.textContent || '' }));
  t.ok(inByLink && !s3.sheet && /on credits, 30 left/.test(s3.head), `the link opened in the same browser signs the waiting tab in; the head says "Claude · on credits, 30 left" (${s3.head.trim()})`);
  // the account sheet: signed in as, the balance, sign out
  await page.click('.ag-pill-cloud');
  await page.waitForSelector('.ag-cl-account', { timeout: 5000 });
  const acc = await page.evaluate(() => document.querySelector('.ag-cl-account').textContent);
  t.ok(/Signed in as jess@example\.com/.test(acc) && /Sign out/.test(acc) && /30, about 9 asks/.test(acc) && /Where your credits went/.test(acc), 'the head opens the account sheet: "Signed in as", the credits in asks, where they went, sign out');
  await shot('cloud-account');
  await page.click('.ag-cl-account .ag-cl-who .ag-link');
  await page.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-out', null, { timeout: 5000 });
  // and by the code, in a second browser (the link opened on a phone)
  await signInByCode(page, fake, 'jess@example.com');
  t.ok(true, 'the 6-digit code signs in a tab whose link was opened elsewhere');
  const wrong = await page.evaluate(async () => { try { await window.overdub.agent.cloud.enterCode('jess@example.com', '000000'); return null; } catch (e) { return { code: e.code, left: e.details.attemptsLeft }; } });
  t.ok(wrong && wrong.code === 'bad_code' && wrong.left === 4, 'a wrong code is the service\'s bad_code, with the tries left');
  t.ok(realErrors(errors).length === 0, 'no page errors (sign in)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 3. the price before any ask, and an ask end to end */
{
  fake.grant('jess@example.com', 30);
  const { page, errors, close, shot } = await studio(fake);
  await chooseCloud(page);
  await signInByCode(page, fake);
  const opened0 = actionsOpened(fake).length;
  // a direct send with no price on screen opens nothing: the panel is asked to show it
  const direct = await page.evaluate(async () => { const e = window.overdub; let quoted = null; const off = e.agent.on('quote', (q) => { quoted = q; }); const r = await e.agent.send('Add a bassline'); off(); return { r, quoted, box: document.querySelector('.ag-input').value, chip: document.querySelector('.ag-price')?.textContent }; });
  await sleep(300);
  t.ok(direct.r === false && direct.quoted?.kind === 'new_part' && direct.box === 'Add a bassline' && /A new part.· 7 credits/.test(direct.chip) && actionsOpened(fake).length === opened0,
    `a send with no price on screen opens nothing: the ask goes in the box with its price ("${direct.chip}")`);
  await page.fill('.ag-input', '');
  // a suggestion, and the tour's "ask for a take": into the box with the price, nothing sent
  await page.evaluate(() => { const e = window.overdub; e.ui.emit('agent:compose', { text: 'Play a take over my part.', send: true }); });
  await sleep(300);
  const tour = await page.evaluate(() => ({ box: document.querySelector('.ag-input').value, chip: document.querySelector('.ag-price:not([hidden])')?.textContent || '', say: document.querySelector('.ag-price-say')?.textContent }));
  await page.fill('.ag-input', '');
  await page.evaluate(() => document.querySelector('.ag-sugs .ag-sug:not([data-x])')?.click());
  await sleep(300);
  const sug = await page.evaluate(() => ({ box: document.querySelector('.ag-input').value, chip: document.querySelector('.ag-price:not([hidden])')?.textContent || '' }));
  t.ok(tour.box === 'Play a take over my part.' && /credits?/.test(tour.chip) && tour.say === 'Press Send to ask.' && (!sug.box || /credits?|free/.test(sug.chip)) && actionsOpened(fake).length === opened0,
    `the tour's ask and a suggestion button land in the box with their price, and nothing opens (tour: "${tour.chip}"; suggestion "${sug.box}": "${sug.chip}")`);
  // typed: the price follows the words, and the ▾ lists every kind
  await typeAsk(page, 'Write a counter-melody');
  const c1 = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  await typeAsk(page, 'Build me a fuzz pedal');
  const c2 = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  await typeAsk(page, 'What is the bass doing?');
  const c3 = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  t.ok(/A new part.· 7 credits/.test(c1) && /A new instrument or effect.· 11 credits/.test(c2) && /A question.· 2 credits/.test(c3), `the price follows what's typed, from the service's rate card ("${c1}", "${c2}", "${c3}")`);
  await page.click('.ag-price');
  const menu = await page.evaluate(() => [...document.querySelectorAll('.ag-price-k')].map((b) => b.textContent));
  await page.click('.ag-price-k[data-kind="quick_change"]');
  const c4 = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  t.ok(menu.length === 4 && menu.some((x) => /A new part7 credits/.test(x)) && /A quick change.· 2 credits/.test(c4) && !(await page.evaluate(() => !!document.querySelector('.ag-price-more'))), `▾ lists the four kinds with their prices; picking one changes the price; no "take more time" when the card doesn't offer it (${menu.join(' / ')})`);
  await shot('cloud-chip');

  // the ask, end to end: a tool call that runs here, signed Claude; the first call sends messages, the next only results
  fake.script.push(toolCall('Adding a bass. ', 'toolu_1', 'apply_ops', { label: 'walking bass', reason: 'you asked', ops: [{ type: 'track.add', ref: 'b', track: { name: 'Cloud Bass', instrument: { device: 'core.bass' } } }, { type: 'clip.add', track: '$b', clip: { start: 0, length: 4, notes: 'A1@0:1 C2@1:1 E2@2:1 G2@3:1' } }] }));
  fake.script.push(reply('Take 1 is in: a walking bass under your keys. Keep it?'));
  await typeAsk(page, 'Add a walking bassline');
  await page.press('.ag-input', 'Enter');
  await page.waitForFunction(() => !window.overdub.agent.busy && /walking bass under your keys/.test(document.querySelector('.ag-feed').textContent), null, { timeout: 10000 }).catch(async (e) => { console.log('DEBUG', await page.evaluate(() => ({ feed: document.querySelector('.ag-feed').textContent.slice(-600), busy: window.overdub.agent.busy, box: document.querySelector('.ag-input').value })), fake.log.slice(-6).map((r) => r.method + ' ' + r.path + ' ' + JSON.stringify(r.body).slice(0, 200)), errors); throw e; });
  const a = [...fake.actions.values()].pop();
  const open1 = actionsOpened(fake).pop();
  const done = await page.evaluate(() => {
    const e = window.overdub;
    const tr = e.store.get().tracks.find((x) => x.name === 'Cloud Bass');
    const h = e.store.history.filter((x) => x.label === 'walking bass');
    return { by: tr?.by, clipBy: tr?.clips[0]?.by, notesBy: [...new Set(tr?.clips[0]?.notes.map((n) => n.by))], hist: h.map((x) => x.by), speaker: [...document.querySelectorAll('.ag-msg.ag-agent')].pop()?.dataset.by, head: document.querySelector('.ag-who').textContent, recap: e.agent.recap };
  });
  t.ok(open1.body.kind === 'new_part' && open1.body.moreTime === false && /^sha256:[0-9a-f]{16}$/.test(open1.body.promptVersion) && /^[A-Za-z0-9-]{8,}$/.test(open1.headers['idempotency-key'] || '') && open1.headers.cookie,
    `Send opens one ask: its kind, the prompt version, an Idempotency-Key, the session cookie (${open1.body.kind}, ${open1.body.promptVersion})`);
  const first = a.calls[0], second = a.calls[1];
  t.ok(Object.keys(first).join() === 'messages' && first.messages.length === 1 && first.messages[0].role === 'user' && first.messages[0].content.every((b) => b.type === 'text') && /Add a walking bassline/.test(first.messages[0].content[0].text),
    'the first call sends the opening message only (text blocks), no system prompt, tools or model');
  t.ok(second && Object.keys(second).join() === 'toolResults' && second.toolResults.length === 1 && second.toolResults[0].tool_use_id === 'toolu_1' && second.toolResults[0].type === 'tool_result',
    'the next call sends only the tool results, for exactly the tool calls asked');
  t.ok(done.by === 'claude' && done.clipBy === 'claude' && done.notesBy.join() === 'claude' && done.hist.join() === 'claude' && done.speaker === 'claude', `the hosted agent's work is signed Claude: the track, the clip, the notes, History, the log (${done.hist.join()})`);
  t.ok(a.finish?.outcome === 'done' && a.finish.cardPending === false && /on credits, 23 left/.test(done.head), `finish says done; the head shows the balance after it (${done.head.trim()})`);
  // credits back: undo everything the ask did, inside the window
  await page.evaluate(() => { const e = window.overdub; while (e.store.history.some((x) => x.label === 'walking bass')) e.store.undo(); });
  const posted = () => fake.reqs(/credit-back$/).filter((x) => x.method === 'POST');
  await until(() => posted().length > 0, 4000);
  const back = posted().pop();
  await sleep(300);
  const backNote = await page.evaluate(() => document.querySelector('.ag-feed').textContent);
  t.ok(back?.body?.reason === 'undo' && /Credits back: 7\. You undid everything that ask did\./.test(backNote) && /^[A-Za-z0-9-]{8,}$/.test(back.headers['idempotency-key'] || ''), 'undo every change of an ask inside the window: credits back ("Credits back: 7")');
  // a second ask carries a text-only recap of the first
  fake.script.push(reply('It walks root to fifth.'));
  await typeAsk(page, 'What is the bass doing?');
  await page.press('.ag-input', 'Enter');
  await page.waitForFunction(() => !window.overdub.agent.busy && /root to fifth/.test(document.querySelector('.ag-feed').textContent), null, { timeout: 10000 });
  const r = [...fake.actions.values()].pop().calls[0].messages;
  const blocks = r.flatMap((m) => (typeof m.content === 'string' ? [{ type: 'text' }] : m.content));
  t.ok(r.length === 3 && r[0].role === 'user' && r[1].role === 'assistant' && r[2].role === 'user' && blocks.every((b) => b.type === 'text') && /walking bass under your keys/.test(JSON.stringify(r[1])),
    `a new ask carries a short recap of the last one, text only: no tool calls or results (${r.length} messages)`);
  // Stop: the ask finishes as stopped
  fake.script.push({ hang: true });
  await typeAsk(page, 'Make the hats busier');
  await page.press('.ag-input', 'Enter');
  await sleep(700);
  await page.evaluate(() => window.overdub.agent.stop());
  await page.waitForFunction(() => !window.overdub.agent.busy, null, { timeout: 5000 });
  await sleep(300);
  t.ok([...fake.actions.values()].pop().finish?.outcome === 'stopped', 'Stop mid-answer finishes the ask as stopped');
  // nothing secret stays in the browser: no address, no session, nothing from /v1/me
  const stored = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o['session:' + k] = sessionStorage.getItem(k); } return { all: JSON.stringify(o), keys: Object.keys(o).filter((k) => /cloud|provider/.test(k)), cookie: document.cookie }; });
  t.ok(!/jess@|example\.com|od_session|od_pending|042917|usr_|balance/i.test(stored.all) && !stored.cookie, `nothing secret in the browser's storage after a session: no address, session, code or balance (cloud keys: ${stored.keys.join(', ')})`);
  t.ok(stored.keys.every((k) => k === 'overdub:agent-provider' || k === 'overdub:cloud:takes' || k.startsWith('overdub:cloud:notice-80:')), 'the only hosted-agent keys are the choice, the ask-to-takes map and the 80% notice');
  // the 80% notice: once, not on every look at the account
  fake.user('jess@example.com').notice = 'eighty_percent';
  await page.evaluate(async () => { await window.overdub.agent.cloud.refresh(); await window.overdub.agent.cloud.refresh(); });
  await sleep(500);
  const count = () => page.evaluate(() => (document.querySelector('.ag-feed').textContent.match(/You’ve used most of this month’s credits/g) || []).length);
  const once = await count();
  await page.evaluate(() => { localStorage.removeItem('overdub:agent:feed:' + window.overdub.store.get().id); });
  await page.reload({ waitUntil: 'load' }); await ready(page);
  await page.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-in', null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const again = await count();
  t.ok(once === 1 && again === 0, `the 80% notice shows once, and not again after a reload (${once}, then ${again})`);
  fake.user('jess@example.com').notice = null;
  // signing out drops the ask-to-takes map (the service's action ids) from this browser
  const hadTakes = await page.evaluate(() => !!localStorage.getItem('overdub:cloud:takes'));
  await page.evaluate(() => window.overdub.agent.cloud.signOut());
  const keptTakes = await page.evaluate(() => localStorage.getItem('overdub:cloud:takes'));
  t.ok(hadTakes && keptTakes === null, `sign out forgets the ask-to-takes map (had it: ${hadTakes}, after: ${keptTakes})`);
  t.ok(realErrors(errors).length === 0, 'no page errors (asks)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 4. retries, out of credits, paused, the stale ask */
{
  fake.grant('jess@example.com', 30);
  const { page, errors, close, shot } = await studio(fake);
  await chooseCloud(page);
  await signInByCode(page, fake);
  const ask = async (text) => { await typeAsk(page, text); await page.press('.ag-input', 'Enter'); await page.waitForFunction(() => !window.overdub.agent.busy, null, { timeout: 15000 }); await sleep(200); };
  // busy, then busy, then an answer: two retries
  fake.script.push({ status: 503, retryAfter: 0, error: { code: 'upstream_busy', message: 'Claude is busy. Trying again shortly.', retryAfter: 0 } }, { status: 503, retryAfter: 0, error: { code: 'upstream_busy', message: 'Claude is busy. Trying again shortly.', retryAfter: 0 } }, reply('Brighter now.'));
  await ask('Make the keys sparkle');
  const a1 = [...fake.actions.values()].pop();
  t.ok(a1.calls.length === 3 && JSON.stringify(a1.calls[0]) === JSON.stringify(a1.calls[2]) && a1.finish?.outcome === 'done', `503 upstream_busy is retried with the same body, at most twice (${a1.calls.length} calls)`);
  fake.script.push(...Array.from({ length: 3 }, () => ({ status: 503, retryAfter: 0, error: { code: 'upstream_busy', message: 'Claude is busy. Trying again shortly.', retryAfter: 0 } })));
  await ask('Make the keys sparkle again');
  const a2 = [...fake.actions.values()].pop();
  t.ok(a2.calls.length === 3 && a2.finish?.outcome === 'error', `a third busy answer isn't retried: the ask finishes as an error (${a2.calls.length} calls)`);
  fake.script.push({ status: 502, error: { code: 'upstream_error', message: 'The agent hit a snag on our side. You weren’t charged for it.', retryable: false } });
  await ask('Tidy the drums');
  const a3 = [...fake.actions.values()].pop();
  const note3 = await page.evaluate(() => [...document.querySelectorAll('.ag-note-bad')].pop()?.textContent || '');
  t.ok(a3.calls.length === 1 && /hit a snag on our side/.test(note3), `502 that isn't retryable isn't retried, and the service's words are shown ("${note3}")`);
  // a stale ask on the service: finished as stopped, then this one opens
  const u = fake.user('jess@example.com');
  fake.actions.set('act_stale', { id: 'act_stale', email: u.email, kind: 'question', credits: 2, status: 'open', calls: [], delivered: 0, at: Date.now() });
  fake.script.push(reply('Done, after the stale one.'));
  await ask('Make it punchier please');
  t.ok(fake.actions.get('act_stale').finish?.outcome === 'stopped' && /after the stale one/.test(await page.evaluate(() => document.querySelector('.ag-feed').textContent)), '409 action_in_flight: the stale ask is finished as stopped, then the new one opens');
  // out of credits: both buttons, the same size, and the ask back in the box
  fake.grant('jess@example.com', 1);
  await ask('Add a bassline');
  await page.waitForSelector('.ag-cl-out', { timeout: 5000 });
  const out = await page.evaluate(() => { const b = [...document.querySelectorAll('.ag-cl-out .ag-cl-two .btn')]; const r = b.map((x) => x.getBoundingClientRect()); return { text: document.querySelector('.ag-cl-out').textContent, buttons: b.map((x) => x.textContent), same: r.length === 2 && Math.abs(r[0].width - r[1].width) < 1 && Math.abs(r[0].height - r[1].height) < 1, box: document.querySelector('.ag-input').value }; });
  t.ok(/You’re out of credits\. Top up, or keep going with your own Claude \(free\)\./.test(out.text) && out.buttons.join() === 'Top up,Use your own Claude' && out.same && out.box === 'Add a bassline',
    `402: out of credits, [Top up] and [Use your own Claude] the same size, the ask back in the box (${out.buttons.join(' | ')})`);
  t.ok(/Overdub doesn’t charge for it; your Claude plan’s limits apply/.test(out.text), 'the free path keeps its qualifier: "your Claude plan’s limits apply"');
  await shot('cloud-out');
  await page.click('.ag-cl-out .ag-cl-two .btn:first-child');
  await page.waitForSelector('.ag-cl-topup', { timeout: 5000 });
  const top = await page.evaluate(() => [...document.querySelectorAll('.ag-cl-topup .ag-cl-row')].map((x) => x.textContent));
  t.ok(top.some((x) => /Overdub Plus, monthly/.test(x) && /\$1\.23/.test(x)) && top.some((x) => /40 credits/.test(x) && /\$0\.45/.test(x)), `Top up lists the plans and packs the service names, at its prices (${top.join(' | ')})`);
  // the checkout opens in a new tab; "I've paid" syncs
  const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await page.click('.ag-cl-topup [data-sku="pack_x"] .btn');
  const pop = await popup;
  t.ok(pop && /\/dev\/checkout$/.test(pop.url()), `Buy opens the service's checkout in a new tab (${pop?.url()})`);
  await pop?.close();
  await page.waitForSelector('.ag-cl-topup .ag-kc-acts .btn:not(.btn-txt)', { timeout: 5000 });
  await page.click('.ag-cl-topup .ag-kc-acts .btn:not(.btn-txt)');
  await page.waitForFunction(() => window.overdub.agent.cloud.me?.balance?.total === 41, null, { timeout: 5000 }).catch(() => {});
  t.ok(await page.evaluate(() => window.overdub.agent.cloud.me?.balance?.total === 41), 'after paying, "I’ve paid" asks the service and the balance updates');
  // paused
  fake.pause(true);
  await ask('Rework the outro');
  await page.waitForSelector('.ag-cl-paused', { timeout: 5000 });
  const paused = await page.evaluate(() => document.querySelector('.ag-cl-paused').textContent);
  t.ok(/paused right now\. Your own Claude, Claude Code and the demo still work\./.test(paused) && /Try the demo agent/.test(paused), 'paused: the free paths are offered');
  fake.pause(false);
  t.ok(realErrors(errors).length === 0, 'no page errors (limits)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 5. a Claude of your own first; free moves; the bundle */
{
  fake.grant('jess@example.com', 30);
  const { page, close } = await studio(fake, { key: true });
  await page.waitForFunction(() => !!window.overdub.agent.cloud?.config && window.overdub.agent.local, null, { timeout: 10000 });
  await page.evaluate(() => { window.overdub.agent.useMock(false); window.overdub.agent.useCloud(true); });
  const prov = await page.evaluate(() => ({ p: window.overdub.agent.provider, chosen: window.overdub.agent.cloudChosen }));
  t.ok(prov.p === 'claude' && prov.chosen, `a key on the local server beats credits, even when credits were chosen (${prov.p})`);
  await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); document.querySelector('.ag-hbtns .ag-hbtn:last-child')?.click(); });
  await sleep(300);
  const row = await page.evaluate(() => document.querySelector('.ag-kc-cloud')?.textContent || '');
  t.ok(/Your own Claude is on here, so it answers first/.test(row), 'and settings say so');
  await close();
  delete process.env.OVERDUB_ANTHROPIC_KEY;
}
{
  fake.grant('jess@example.com', 30);
  const { page, errors, close } = await studio(fake, { query: 'demo' });
  await chooseCloud(page);
  await signInByCode(page, fake);
  const n0 = actionsOpened(fake).length;
  // a free move: one word on the selected track, run here, signed you, never sent
  await page.evaluate(() => { const e = window.overdub; const tr = e.store.get().tracks.find((x) => x.instrument && x.kind !== 'audio'); e.ui.select({ track: tr.id }); });
  await typeAsk(page, 'brighter');
  const chip = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  const h0 = await page.evaluate(() => window.overdub.store.history.length);
  await page.press('.ag-input', 'Enter');
  await page.waitForFunction(() => /free \(no credits\)|didn’t go in|readings/.test([...document.querySelectorAll('.ag-note')].pop()?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  const fm = await page.evaluate((h0) => ({ by: window.overdub.store.history.slice(h0).map((x) => x.by), note: [...document.querySelectorAll('.ag-note')].pop()?.textContent || '' }), h0);
  t.ok(/A quick move.· free/.test(chip) && fm.by.length && fm.by.every((b) => b === 'you') && actionsOpened(fake).length === n0 && /free \(no credits\)/.test(fm.note), `"brighter" on a selected track is a free move: the chip says so, it runs here signed you, and nothing is sent ("${fm.note}")`);
  // the prompt bundle: the export and the page agree, and a changed description changes the version
  const { bundleFrom } = await import('./agent-bundle.js');
  const b = await bundleFrom(page);
  const moved = await page.evaluate(async () => { const e = window.overdub; const tool = e.tools.TOOLS.find((x) => x.name === 'highlight'); const was = tool.description; tool.description = was + ' (changed)'; const v = await e.agent.promptVersion(); tool.description = was; return { v, back: await e.agent.promptVersion() }; });
  t.ok(b.version === b.pageVersion && /^sha256:[0-9a-f]{16}$/.test(b.version) && b.tools.every((x) => Object.keys(x).join() === 'name,description,input_schema') && b.tools.map((x) => x.name).join() === b.tools.map((x) => x.name).sort().join(),
    `the exported bundle's version is the one the page sends (${b.version}; ${b.tools.length} tools, sorted, name/description/schema only)`);
  t.ok(moved.v !== b.version && moved.back === b.version, 'a changed tool description changes the version');
  t.ok(realErrors(errors).length === 0, 'no page errors (free moves)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 6. back from a checkout: /app/?plus=done, /app/?plus=cancel */
{
  const { page, errors, close, shot } = await studio(fake);
  // the address-bar part, on its own: plus and ref leave, the rest of the query and the #hash stay
  const strip = await page.evaluate(async () => {
    const { takeCheckoutReturn: takePaidReturn } = await import('/app/src/agent/cloud-panel.js');
    const at = (u) => { const url = new URL(u); let now = u; return { win: { location: url, history: { state: null, replaceState: (_s, _t, to) => { now = new URL(to, url).href; } } }, now: () => now }; };
    const a = at('http://localhost/app/?demo&plus=done&ref=chk_9#s=abc'); const ra = takePaidReturn(a.win);
    const b = at('http://localhost/app/?plus=done&ref=../../x'); const rb = takePaidReturn(b.win);
    const c = at('http://localhost/app/?demo&plus=cancel#s=abc'); const rc = takePaidReturn(c.win);
    const d = at('http://localhost/app/?plus=other'); const rd = takePaidReturn(d.win);
    return { ra, a: a.now(), rb, b: b.now(), rc, c: c.now(), rd, d: d.now() };
  });
  t.ok(strip.ra?.ref === 'chk_9' && strip.a === 'http://localhost/app/?demo#s=abc' && strip.rb?.ref === null && strip.b === 'http://localhost/app/',
    `?plus=done&ref= is read once and leaves the address bar; the rest of the query and the hash stay; a bad ref is dropped (${strip.a} | ${strip.b})`);
  t.ok(strip.rc?.cancelled === true && !('ref' in strip.rc) && strip.c === 'http://localhost/app/?demo#s=abc' && strip.rd === null && strip.d === 'http://localhost/app/?plus=other',
    `?plus=cancel is read once and leaves the address bar the same way; any other plus= is left alone (${strip.c} | ${strip.d})`);
  await chooseCloud(page);
  await signInByCode(page, fake, 'pat@example.com');
  fake.grant('pat@example.com', 30);
  // the checkout's success URL lands here, in a fresh load of the studio, with the Agent panel closed
  await page.evaluate(() => window.overdub.ui.setOpen('right', false));
  const syncs0 = fake.reqs('/v1/billing/sync').filter((r) => r.method === 'POST').length;
  await page.goto(new URL('/app/?plus=done&ref=chk_1', page.url()).href, { waitUntil: 'load' });
  await ready(page);
  await page.waitForSelector('.ag-cl-account .ag-cl-status', { timeout: 10000 }).catch(() => {});
  await sleep(700);
  const back = await page.evaluate(() => ({
    search: location.search, path: location.pathname, status: document.querySelector('.ag-cl-account .ag-cl-status')?.textContent || '',
    open: window.overdub.ui.isOpen?.('right'), visible: !!document.querySelector('.ag-cl-account')?.getClientRects().length,
    total: window.overdub.agent.cloud?.me?.balance?.total, credits: document.querySelector('.ag-cl-account .ag-cl-dl dd')?.textContent || '',
    focus: document.activeElement?.textContent,
  }));
  const posts = () => fake.reqs('/v1/billing/sync').filter((r) => r.method === 'POST');
  const synced = posts().slice(syncs0);
  t.ok(synced.length === 1 && synced[0].body?.checkoutRef === 'chk_1' && back.total === 70 && /^70/.test(back.credits), `back from paying, the studio asks the service for that checkout and the balance updates (${back.credits}; ${JSON.stringify({ syncs: synced.map((x) => x.body), total: back.total })})`);
  t.ok(back.status === 'Paid. Your credits are in.' && back.open && back.visible && back.focus === 'Claude on Overdub credits', `the Agent panel opens on the account sheet with a plain note ("${back.status}"), its heading focused (${JSON.stringify({ open: back.open, visible: back.visible, focus: back.focus })})`);
  t.ok(back.path === '/app/' && back.search === '', `and the query leaves the address bar (${back.path}${back.search})`);
  await shot('cloud-paid');
  // a reload doesn't ask again
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await sleep(800);
  t.ok(posts().length === syncs0 + 1 && !(await page.evaluate(() => document.querySelector('.ag-cl-status')?.textContent || '')).includes('Paid'), `a reload after that doesn't sync or say it again (${posts().length - syncs0} syncs)`);
  // a payment the provider hasn't marked paid yet: no "your credits are in"; Top up with "I've paid" to press later
  await page.goto(new URL('/app/?plus=done&ref=chk_late', page.url()).href, { waitUntil: 'load' });
  await ready(page);
  await page.waitForSelector('.ag-cl-topup', { timeout: 10000 }).catch(() => {});
  const late = await page.evaluate(() => ({ text: document.querySelector('.ag-cl-topup')?.textContent || '', btn: [...document.querySelectorAll('.ag-cl-topup .ag-kc-acts .btn:not(.btn-txt)')].map((b) => b.textContent), total: window.overdub.agent.cloud?.me?.balance?.total, search: location.search }));
  t.ok(/The payment hasn’t reached us yet\. Give it a minute, then press I’ve paid\./.test(late.text) && !/credits are in/.test(late.text) && late.btn.includes('I’ve paid: update my credits') && late.total === 70 && late.search === '',
    `a payment that hasn't landed yet: no "credits are in", and "I've paid" is there to press later (${late.btn.join(' | ')})`);
  // a cancelled checkout lands here too: Top up again with one plain line, and nothing asked of the service
  await page.evaluate(() => window.overdub.ui.setOpen('right', false));
  const billing0 = fake.reqs(/^\/v1\/billing\//).filter((r) => r.method === 'POST').length;
  await page.goto(new URL('/app/?plus=cancel', page.url()).href, { waitUntil: 'load' });
  await ready(page);
  await page.waitForSelector('.ag-cl-topup .ag-cl-status', { timeout: 10000 }).catch(() => {});
  await sleep(500);
  const cx = await page.evaluate(() => ({
    status: document.querySelector('.ag-cl-topup .ag-cl-status')?.textContent || '', search: location.search, path: location.pathname,
    open: window.overdub.ui.isOpen?.('right'), visible: !!document.querySelector('.ag-cl-topup')?.getClientRects().length,
    paid: [...document.querySelectorAll('.ag-cl-topup .btn')].some((b) => /I’ve paid/.test(b.textContent)), total: window.overdub.agent.cloud?.me?.balance?.total,
  }));
  const billingPosts = fake.reqs(/^\/v1\/billing\//).filter((r) => r.method === 'POST').length - billing0;
  t.ok(cx.status === 'Nothing was bought.' && cx.open && cx.visible && !cx.paid && cx.total === 70, `back from a cancelled checkout, the Top up sheet opens again with "${cx.status}" and no "I've paid" (${JSON.stringify(cx)})`);
  t.ok(billingPosts === 0, `a cancelled checkout charges and syncs nothing (${billingPosts} billing calls)`);
  t.ok(cx.path === '/app/' && cx.search === '', `and plus=cancel leaves the address bar (${cx.path}${cx.search})`);
  await shot('cloud-cancelled');
  t.ok(realErrors(errors).length === 0, 'no page errors (back from a checkout)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

delete process.env.OVERDUB_CLOUD_ORIGIN;
await fake.close();
t.done();
process.exit(process.exitCode || 0);
