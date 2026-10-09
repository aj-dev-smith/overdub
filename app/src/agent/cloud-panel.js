// @ts-check
// The Agent panel's side of Claude on Overdub credits (agent/cloud.js): the sign-in sheet, the balance in the head, the
// price on an ask before it's sent, out of credits, paused, top up, where the credits went, credits back. Only when the
// deploy names the service (app/src/site-config.js); otherwise nothing here draws. No prices live in this file: the
// rate card, plans and packs come from the service (GET /v1/config).
//
//   const cu = cloudPanel({ app, agent, h, byline, input, grow, push, renderAll, renderHead, openOwn, useDemo, closeSettings })
//   cu.enabled                 the deploy has a service
//   cu.sheet() -> Node | null  the sheet at the top of the log (sign in, out of credits, paused, top up, account)
//   cu.setupRow(first) -> Node | null   the row in Agent settings (and a quiet line on the first look)
//   cu.head() -> { words, title } | null   the presence line's words while the hosted agent is the one on
//   cu.chip / cu.update()      the price next to Send, for the text in the box (and the send gate's "shown")
//   cu.gate(text) -> 'go' | 'held'      before a send: runs a free move, asks for sign-in, or puts the price up first
//   cu.onError(e) -> boolean   an error the sheet answers (sign in, out of credits, paused)
//   cu.show(view)              'signin' | 'account' | 'out' | 'topup' | 'paused' | null
//
// Back from a checkout: the service sends a payment back to <studio>/app/?plus=done&ref=<checkout>. On load the query
// leaves the address bar at once; when the account is known, the payment is asked for by its ref (so it counts even
// before the provider's webhook lands), the Agent panel opens on the account sheet and says "Paid. Your credits are in."
// "I've paid" in the tab that opened the checkout stays as the fallback. A cancelled checkout comes back to
// <studio>/app/?plus=cancel: the query leaves the address bar, and the Top up sheet opens again with "Nothing was
// bought." Nothing is asked of the service for it (no sync, no refresh).
//
// The look is the liner notes' (design/LINER-NOTES-KIT.md): a sheet head on a rule, hairlines between rows, numbers in
// mono, the price as a word beside Send. Nothing here signs anything: the hosted agent's work is signed Claude.

import { css } from '../ui/dom.js';
import { HOSTED_NAME, maskEmail } from './cloud.js';
import { freeMove } from './cloud-kind.js';
import { listDevices } from '../devices/registry.js';

const NOTICE_KEY = 'overdub:cloud:notice-80:';
const REF = /^[A-Za-z0-9_-]{4,128}$/;

// ?plus=done[&ref=] -> { ref }; ?plus=cancel -> { cancelled: true } (and plus and ref leave the address bar, the rest
// of the query and the #hash stay); else null
export function takeCheckoutReturn(win = globalThis) {
  const loc = win.location;
  if (!loc?.search) return null;
  const q = new URLSearchParams(loc.search);
  const plus = q.get('plus');
  if (plus !== 'done' && plus !== 'cancel') return null;
  const ref = q.get('ref');
  // the other parts exactly as they were (?demo stays ?demo)
  const rest = loc.search.slice(1).split('&').filter((part) => part && !/^(plus|ref)(=|$)/.test(part)).join('&');
  try { win.history?.replaceState(win.history.state, '', loc.pathname + (rest ? '?' + rest : '') + (loc.hash || '')); } catch { /* a sandboxed frame */ }
  if (plus === 'cancel') return { cancelled: true };
  return { ref: ref && REF.test(ref) ? ref : null };
}
const NOT_YET = 'The payment hasn’t reached us yet. Give it a minute, then press I’ve paid.';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const money = (usd) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(usd) ? 0 : 2 }).format(usd); } catch { return '$' + usd; } };
const day = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* full */ } } };

export function cloudPanel({ app, agent, h, byline, input, grow, push, renderAll, renderHead, openOwn, useDemo, closeSettings = () => {} }) {
  css('agent-cloud', CSS);
  const { ui, store } = app;
  const cloud = () => agent.cloud;
  let view = null;              // the sheet asked for: 'signin' | 'account' | 'out' | 'topup' | 'paused'
  let hint = null, hintOn = '', moreTime = false, menuOpen = false;   // hintOn: the words a kind was picked for
  let email = '', code = '', busyWord = '', said = '';   // the fields' words survive a redraw; said: the sheet's last line
  let checkoutRef = null, activity = null, del = null;
  let cached = { sig: '', node: null };

  /* ---------------------------------------------------------------- the price, next to Send */
  const chip = h('button.ag-price', { type: 'button', hidden: true, 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => { menuOpen = !menuOpen; update(); } });
  const menu = h('div.ag-price-menu', { role: 'group', 'aria-label': 'What kind of ask', hidden: true });
  const nudge = h('span.ag-price-say', { role: 'status', 'aria-live': 'polite' });   // "Press Send to ask." after a held press
  const row = h('div.ag-pricerow', h('div.ag-price-line', nudge, chip), menu);
  let nudgeFor = '';
  let current = null;           // what the chip shows: a quote, or { free }
  function freeFor(text) {
    let devices = [];
    try { devices = listDevices(); } catch { devices = []; }
    return freeMove(text, { devices, hasTrack: !!ui.state.selection?.track });
  }
  function update() {
    const text = input.value.trim();
    const on = agent.provider === 'cloud' && !!text && !agent.busy;
    if (nudge.textContent && text !== nudgeFor) nudge.textContent = '';
    if (!on) { if (!text) { hint = null; moreTime = false; } menuOpen = false; current = null; chip.hidden = true; menu.hidden = true; agent.shown(null); return; }
    // a kind picked from the ▾ holds while the person goes on typing that ask, not for a different one
    if (hint && !text.startsWith(hintOn)) { hint = null; moreTime = false; }
    const fm = freeFor(text);
    if (fm) {
      current = { free: fm, text };
      agent.shown(null);
      chip.replaceChildren(h('span', 'A quick move'), h('span.ag-price-n', '\u00a0· free'));
      chip.title = 'Run here, free: it isn’t sent to Claude';
      chip.setAttribute('aria-expanded', 'false'); chip.disabled = true;
      chip.hidden = false; menu.hidden = true;
      return;
    }
    const q = agent.quote(text, { hint, moreTime });
    if (!q) { current = null; chip.hidden = true; menu.hidden = true; agent.shown(null); return; }
    current = q;
    agent.shown(q);             // the send gate: this exact text has had its price on screen
    chip.disabled = false;
    chip.title = 'What kind of ask this is, and its price. Pick another kind if this is wrong.';
    chip.replaceChildren(h('span', q.label), h('span.ag-price-n', `\u00a0· ${plural(q.credits, 'credit')}`), h('span.ag-price-v', { 'aria-hidden': 'true' }, '\u00a0▾'));
    chip.setAttribute('aria-label', `${q.label}, ${plural(q.credits, 'credit')}. Change the kind of ask`);
    chip.setAttribute('aria-expanded', String(menuOpen));
    chip.hidden = false;
    menu.hidden = !menuOpen;
    if (menuOpen) {
      menu.replaceChildren(
        ...q.alternatives.map((a) => h(`button.ag-price-k${a.kind === q.kind ? '.on' : ''}`, { type: 'button', role: 'menuitemradio', 'aria-checked': String(a.kind === q.kind), dataset: { kind: a.kind }, onclick: () => { hint = a.kind; hintOn = input.value.trim(); menuOpen = false; update(); input.focus(); } },
          h('span', a.label), h('span.ag-price-n', plural(a.credits, 'credit')))),
        q.moreTimeOffered ? h(`button.ag-price-more${q.moreTime ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(q.moreTime), onclick: () => { moreTime = !moreTime; update(); } }, h('span.ag-lamp-sq'), 'Take more time (costs more)') : null);
    }
  }

  /* ---------------------------------------------------------------- the gate before a send */
  function gate(text) {
    const c = cloud();
    const typed = input.value.trim();
    const fm = freeFor(text);
    if (fm) { runFree(text, fm); return 'held'; }
    if (!c?.me) {
      if (!typed) { input.value = text; grow(); }
      show('signin');
      return 'held';
    }
    // a suggestion, the tour's ask, a move offered in the log: into the box with its price, and a second press sends it
    if (text !== typed || !current || current.text !== text || current.free) {
      input.value = text; grow(); update();
      nudgeFor = text;
      nudge.textContent = current && !current.free ? 'Press Send to ask.' : `${HOSTED_NAME} isn’t answering right now.`;
      input.focus();
      return 'held';
    }
    return 'go';
  }
  // a quick move typed as a word runs here, free, signed as you'd sign it (you asked for it; nothing thought about it)
  async function runFree(text, fm) {
    input.value = ''; grow(); update();
    push({ k: 'user', by: 'you', text });
    const sel = ui.state.selection || {};
    let what = '';
    if (fm.tool === 'adjust') {
      const r = await app.tools.run('adjust', fm.input, { by: 'you' });
      what = r?.error ? `That didn’t go in: ${r.error}` : r?.status === 'pending' ? `Two readings of “${fm.input.axis}” are up: hold one to hear it, then pick. Free: no credits.` : `${cap(fm.input.axis)}: done on the selected track, free (no credits). Undo takes it out.`;
    } else if (fm.device) {
      const t = store.get().tracks.find((x) => x.id === sel.track);
      const ops = fm.kind === 'instrument' ? [{ type: 'track.add', track: { name: fm.name, instrument: { device: fm.device } } }] : [{ type: 'insert.add', track: t?.id, insert: { device: fm.device } }];
      const r = store.dispatch(ops, { by: 'you', label: `${fm.name}` });
      what = r.ok ? (fm.kind === 'instrument' ? `${fm.name} is on a new track, free (no credits).` : `${fm.name} is on ${t?.name || 'the track'}, free (no credits).`) : `That didn’t go in: ${r.error}`;
    }
    push({ k: 'note', kind: 'ok', text: what });
  }
  const cap = (s) => String(s).slice(0, 1).toUpperCase() + String(s).slice(1);

  /* ---------------------------------------------------------------- errors the sheet answers */
  function onError(e) {
    if (!e?.cloud && !e?.code) return false;
    if (e.code === 'not_signed_in') { show('signin'); return true; }
    if (e.code === 'insufficient_credits') { cloud()?.refresh().catch(() => {}); show('out'); return true; }
    if (e.code === 'hosted_paused' || e.code === 'trial_paused') { said = e.message; show('paused'); return true; }
    if (e.code === 'account_frozen') { said = e.message; show('account'); return false; }
    return false;
  }
  // a sheet asked for comes into view at the top of the log, its heading focused (a screen reader hears where it is)
  function show(v) {
    view = v; if (v === 'account') loadActivity(); cached.sig = '';
    if (v) closeSettings();
    renderAll();
    if (v) requestAnimationFrame(() => { const n = cached.node; if (!n?.isConnected) return; n.scrollIntoView?.({ block: 'start' }); n.querySelector('h3')?.focus({ preventScroll: true }); });
  }

  /* ---------------------------------------------------------------- the presence line */
  function head() {
    const c = cloud();
    if (!c?.enabled || agent.provider !== 'cloud') return null;
    const me = c.me, b = me?.balance;
    const title = 'Claude, run by Overdub on your credits.';
    if (!me) return { words: 'on credits, not signed in', title };
    const n = Number(b?.total) || 0;
    const busy = agent.busy ? (app.presence?.waiting?.('claude') ? ', waiting for you' : ', working') : '';
    return { words: `on credits, ${n} left${busy}`, title };
  }

  /* ---------------------------------------------------------------- the sheet */
  function sheet() {
    const c = cloud();
    if (!c?.enabled) return null;
    let v = view;
    if (agent.provider === 'cloud' && c.checked && !c.me && !v) v = 'signin';
    if (v === 'signin' && c.me) v = view = null;
    if (!v) { cached = { sig: '', node: null }; return null; }
    const me = c.me;
    const sig = [v, c.state, me?.user?.email, me?.balance?.total, me?.plan?.status, me?.trial?.eligible, c.config ? 1 : 0, busyWord, said, checkoutRef, activity ? activity.length : -1, del && JSON.stringify(del)].join('|');
    if (cached.sig === sig && cached.node) return cached.node;
    const node = v === 'signin' ? signInSheet(c) : v === 'out' ? outSheet() : v === 'paused' ? pausedSheet() : v === 'topup' ? topUpSheet(c) : accountSheet(c);
    cached = { sig, node };
    return node;
  }
  const sheetHead = (t) => h('header.sheet-head', h('h3', { tabindex: '-1' }, t));
  const closeBtn = (label = 'Close') => h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => { view = null; said = ''; del = null; cached.sig = ''; renderAll(); input.focus(); } }, label);

  function signInSheet(c) {
    const st = c.state;
    const status = h('p.ag-cl-status', { 'aria-live': 'polite', role: 'status' });
    const frameHost = h('div.ag-cl-frame');
    if (st === 'check-inbox') {
      status.append(`Check your inbox. We sent a link to ${maskEmail(c.pendingEmail)}. It works once, for 15 minutes.`);
      const codeIn = h('input.ag-cl-in.ag-cl-code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', 'aria-label': 'The 6-digit code from the email', placeholder: '6-digit code', value: code, oninput: (e) => { code = e.target.value; } });
      const use = async () => {
        busyWord = 'code'; said = ''; cached.sig = ''; renderAll();
        try { await c.enterCode(c.pendingEmail, code); code = ''; said = ''; } catch (e) { said = e.message + (e.details?.attemptsLeft != null ? ` ${plural(e.details.attemptsLeft, 'try')} left.` : ''); }
        busyWord = ''; cached.sig = ''; renderAll();
      };
      codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); use(); } });
      return h('div.ag-cl.ag-cl-signin', { dataset: { state: st } }, sheetHead(HOSTED_NAME), status,
        h('p.ag-kc-small', 'Opening it on another device? Type the 6-digit code here instead.'),
        h('div.ag-cl-field', codeIn, h('button.btn', { type: 'button', disabled: busyWord === 'code', onclick: use }, busyWord === 'code' ? 'Checking…' : 'Use code')),
        said ? h('p.ag-cl-err', said) : null,
        h('div.ag-kc-acts', h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => { c.cancelSignIn(); said = ''; cached.sig = ''; renderAll(); } }, 'Use a different email')));
    }
    const sending = st === 'sending';
    status.append(sending ? 'Sending the link…' : 'Sign in with your email');
    const emailIn = h('input.ag-cl-in.ag-cl-email', { type: 'email', autocomplete: 'email', 'aria-label': 'Your email', placeholder: 'you@example.com', value: email, oninput: (e) => { email = e.target.value; } });
    const go = async () => {
      if (!email.trim()) { emailIn.focus(); return; }
      said = '';
      try { await c.signIn(email, { frameHost }); } catch (e) { said = e.message; cached.sig = ''; renderAll(); }
    };
    emailIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const err = said || (c.error ? c.error.message : '');
    return h('div.ag-cl.ag-cl-signin', { dataset: { state: st } }, sheetHead(HOSTED_NAME),
      h('p.ag-kc-p', 'Claude, run by Overdub: no set-up, and each ask shows its price in credits before you send it. Signing in is only for this; the studio needs no account.'),
      status,
      h('div.ag-cl-field', emailIn, h('button.btn.btn-go', { type: 'button', disabled: sending, onclick: go }, sending ? 'Sending…' : 'Send link')),
      frameHost,
      err ? h('p.ag-cl-err', err) : null,
      h('p.ag-kc-small', 'No password: the email has a link that signs you in, and a code for another device.'),
      h('div.ag-kc-acts',
        h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => ownClaude() }, 'Use your own Claude instead (free)'),
        agent.provider === 'cloud' ? h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => { agent.useCloud(false); view = null; renderAll(); } }, `Turn ${HOSTED_NAME} off`) : closeBtn()));
  }

  function outSheet() {
    return h('div.ag-cl.ag-cl-out', sheetHead('Out of credits'),
      h('p.ag-kc-p', 'You’re out of credits. Top up, or keep going with your own Claude (free).'),
      h('div.ag-cl-two',
        h('button.btn', { type: 'button', onclick: () => show('topup') }, 'Top up'),
        h('button.btn', { type: 'button', onclick: () => ownClaude() }, 'Use your own Claude')),
      h('p.ag-kc-small', 'Your own Claude: Overdub doesn’t charge for it; your Claude plan’s limits apply. Your ask is still in the box.'),
      h('div.ag-kc-acts', closeBtn()));
  }

  function pausedSheet() {
    return h('div.ag-cl.ag-cl-paused', sheetHead('Paused'),
      h('p.ag-kc-p', said || `${HOSTED_NAME} is paused right now. Your own Claude, Claude Code and the demo still work.`),
      h('div.ag-cl-two',
        h('button.btn', { type: 'button', onclick: () => ownClaude() }, 'Use your own Claude'),
        h('button.btn', { type: 'button', onclick: () => { view = null; said = ''; useDemo(); } }, 'Try the demo agent')),
      h('div.ag-kc-acts', closeBtn()));
  }

  // GET /v1/config lists plans and packs as [{ sku, label, usd, … }] (overdub-cloud SPEC §8.1); a map keyed by sku is
  // read too. Either way: [[sku, item]], only items with a sku and a price.
  function skuList(v) {
    const pairs = Array.isArray(v) ? v.map((p) => [p && p.sku, p]) : Object.entries(v || {});
    return pairs.filter(([sku, p]) => typeof sku === 'string' && /^[a-z0-9_]{1,40}$/.test(sku) && p && Number.isFinite(p.usd));
  }

  function topUpSheet(c) {
    const cfg = c.config || {};
    const packs = skuList(cfg.packs);
    const plans = skuList(cfg.plans);
    const subscribed = c.me?.plan && /active|trialing|past_due/.test(c.me.plan.status || '');
    const buy = async (sku) => {
      busyWord = sku; said = ''; cached.sig = ''; renderAll();
      try { const r = await c.checkout(sku); checkoutRef = r.checkoutRef || null; said = r.url ? 'The checkout is open in a new tab. When it’s done, come back here.' : 'The checkout didn’t open. Try again in a moment.'; } catch (e) { said = e.message; }
      busyWord = ''; cached.sig = ''; renderAll();
    };
    const line = (sku, title, price, sub, act) => h('li.ag-cl-row', { dataset: { sku } }, h('span.ag-cl-row-t', h('b', title), sub ? h('span.t3', sub) : null), h('span.ag-cl-row-n', price), act);
    return h('div.ag-cl.ag-cl-topup', sheetHead('Top up'),
      h('p.ag-kc-small', 'Prices are in US dollars. Credits you buy never expire.'),
      h('ul.ag-cl-list',
        ...plans.map(([sku, p]) => line(sku, p.label, money(p.usd), `${p.monthlyCredits ? `${p.monthlyCredits} credits a month, ` : ''}a ${p.interval === 'year' ? 'year' : 'month'}`, subscribed ? h('span.t3', 'on') : h('button.btn', { type: 'button', disabled: !!busyWord, onclick: () => buy(sku) }, busyWord === sku ? 'Opening…' : 'Choose'))),
        ...packs.map(([sku, p]) => line(sku, p.label, money(p.usd), '', h('button.btn', { type: 'button', disabled: !!busyWord, onclick: () => buy(sku) }, busyWord === sku ? 'Opening…' : 'Buy')))),
      !plans.length && !packs.length ? h('p.ag-kc-small', 'Nothing to buy right now.') : null,
      said ? h('p.ag-cl-status', { role: 'status' }, said) : null,
      checkoutRef ? h('div.ag-kc-acts', h('button.btn', { type: 'button', onclick: async () => { try { const r = await c.sync(checkoutRef); if (r.paid) { checkoutRef = null; said = 'Done: your credits are in.'; } else said = NOT_YET; } catch (e) { said = e.message; } cached.sig = ''; renderAll(); } }, 'I’ve paid: update my credits')) : null,
      h('div.ag-kc-acts', closeBtn()));
  }

  function accountSheet(c) {
    const me = c.me;
    if (!me) return signInSheet(c);
    const b = me.balance || {};
    const plan = me.plan;
    const tookSomething = (store.history || []).some((x) => x.by === 'you');
    const items = (activity || []).map((it) => h('li.ag-cl-row', h('span.ag-cl-row-t', h('b', it.label || it.kind), h('span.t3', `${day(it.at)}${takeWords(it.actionId)}`)), h('span.ag-cl-row-n', `${it.credits > 0 ? '+' : ''}${it.credits}`)));
    return h('div.ag-cl.ag-cl-account', sheetHead(HOSTED_NAME),
      h('div.ag-cl-who', h('p.ag-kc-p', 'Signed in as ', h('b', me.user?.email || '')), h('button.btn.btn-txt.ag-link', { type: 'button', onclick: async () => { try { await c.signOut(); } catch (e) { said = e.message; } view = null; cached.sig = ''; renderAll(); } }, 'Sign out')),
      h('dl.ag-cl-dl',
        h('dt', 'Credits'), h('dd', h('span.mono', String(b.total ?? 0)), me.asksHint != null ? `, about ${me.asksHint} asks` : '', b.held ? ` (${b.held} on the ask that’s running)` : ''),
        b.nextExpiry?.credits ? [h('dt', 'Next to go'), h('dd', h('span.mono', String(b.nextExpiry.credits)), ` on ${day(b.nextExpiry.at)}`)] : null,
        plan ? [h('dt', 'Plan'), h('dd', `${plan.label}${plan.monthlyCredits ? `, ${plan.monthlyCredits} credits a month` : ''}${plan.endsAt ? `, ends ${day(plan.endsAt)}` : plan.renewsAt ? `, renews ${day(plan.renewsAt)}` : ''}`)] : null,
        me.creditBack ? [h('dt', 'Credits back'), h('dd', `${me.creditBack.left} of ${me.creditBack.budget} left this month: undo all of an ask soon after, and its credits come back`)] : null),
      me.trial?.eligible ? h('div.ag-cl-trial', h('p.ag-kc-small', tookSomething ? 'There’s a free trial on this account, once.' : 'There’s a free trial on this account, once. It unlocks after your first saved take.'),
        h('button.btn', { type: 'button', disabled: !tookSomething, onclick: async () => { try { await c.claimTrial(); said = 'The trial credits are in.'; } catch (e) { said = e.message; } cached.sig = ''; renderAll(); } }, 'Claim the trial')) : null,
      h('div.ag-kc-acts', h('button.btn', { type: 'button', onclick: () => show('topup') }, 'Top up')),
      said ? h('p.ag-cl-status', { role: 'status' }, said) : null,
      h('div.ag-kc-label', 'Where your credits went'),
      activity == null ? h('p.ag-kc-small', 'Reading…') : items.length ? h('ul.ag-cl-list', items) : h('p.ag-kc-small', 'Nothing yet.'),
      deleteRow(c),
      h('div.ag-kc-acts', closeBtn()));
  }
  // an ask's takes, from this browser's own map (the service never keeps a take): the History labels it made
  function takeWords(actionId) {
    if (!actionId) return '';
    let all = {};
    try { all = JSON.parse(ls.get('overdub:cloud:takes') || '{}') || {}; } catch { all = {}; }
    const txns = all[actionId]?.txns || [];
    const labels = (store.history || []).filter((x) => txns.includes(x.id)).map((x) => x.label).filter(Boolean);
    return labels.length ? ` · ${labels.slice(0, 2).join(', ')}` : '';
  }
  async function loadActivity() {
    const c = cloud();
    activity = null;
    try { const r = await c.activity(); activity = Array.isArray(r?.items) ? r.items : []; } catch { activity = []; }
    cached.sig = ''; if (view === 'account') renderAll();
  }
  function deleteRow(c) {
    if (!del) return h('div.ag-kc-acts', h('button.btn.btn-txt.ag-link.ag-cl-del', { type: 'button', onclick: () => { del = { step: 'ask' }; cached.sig = ''; renderAll(); } }, 'Delete my account'));
    const run = async (opts) => {
      try { await c.deleteAccount(opts); del = null; view = null; said = ''; push({ k: 'note', kind: 'ok', text: 'Your account is deleted. Your songs are in this browser, as they were.' }); }
      catch (e) {
        if (e.code === 'subscription_active') del = { step: 'plan', opts };
        else if (e.code === 'paid_credits_left') del = { step: 'credits', credits: e.details?.credits, opts };
        else del = { step: 'error', message: e.message };
      }
      cached.sig = ''; renderAll();
    };
    const opts = del.opts || {};
    const words = del.step === 'plan' ? 'You have Overdub Plus on this account. Deleting it cancels the plan now, and no more payments are taken.'
      : del.step === 'credits' ? `You have ${plural(del.credits || 0, 'paid credit')} left. Deleting the account gives them up.`
        : del.step === 'error' ? del.message
          : 'Deleting your account signs you out everywhere and removes your email from Overdub. Our records of payments and of what each ask cost stay, without your address; the payment provider keeps its own receipts, as tax law asks. Your songs aren’t on the account: they stay in this browser.';
    const next = del.step === 'plan' ? () => run({ ...opts, cancelPlan: true }) : del.step === 'credits' ? () => run({ ...opts, forfeitCredits: true }) : () => run(opts);
    return h('div.ag-cl-delete', h('p.ag-kc-small', words),
      h('div.ag-kc-acts',
        del.step === 'error' ? null : h('button.btn', { type: 'button', onclick: next }, del.step === 'plan' ? 'Cancel the plan and delete' : del.step === 'credits' ? 'Give them up and delete' : 'Delete my account'),
        h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => { del = null; cached.sig = ''; renderAll(); } }, 'Keep it')));
  }

  // "Use your own Claude": the Connect tab when it's here (claude.ai), otherwise the set-up sheet (Claude Code)
  function ownClaude() {
    view = null; said = ''; cached.sig = '';
    if (app.remote && ui.show) { renderAll(); ui.show('connect'); return; }
    openOwn();
  }

  /* ---------------------------------------------------------------- Agent settings */
  function setupRow(first = false) {
    const c = cloud();
    if (!c?.enabled) return null;
    const on = agent.provider === 'cloud';
    if (first) {
      return h('div.ag-kc-own.ag-kc-cloud',
        h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => { agent.useCloud(true); closeSettings(); if (!c.me) show('signin'); else renderAll(); } }, HOSTED_NAME),
        h('p.ag-kc-small', 'No set-up: Claude, run by Overdub, on credits.'));
    }
    const own = agent.cloudChosen && !on;   // chosen, but a Claude of their own is on, which comes first
    return h('div.ag-kc-sec.ag-kc-cloud',
      h('p.head', HOSTED_NAME),
      h('p.ag-kc-small', on ? `On: Claude, run by Overdub on your credits. Each ask shows its price before you send it.${c.me ? ` ${plural(Number(c.me.balance?.total) || 0, 'credit')} left.` : ''}`
        : own ? 'Your own Claude is on here, so it answers first. Turn it off to use credits.'
          : 'No set-up, uses credits: Claude, run by Overdub. Each ask shows its price before you send it.'),
      h('div.ag-kc-acts',
        h('button.btn', { type: 'button', onclick: () => { if (on || own) { agent.useCloud(false); renderAll(); return; } agent.useCloud(true); closeSettings(); if (!c.me) show('signin'); else { push({ k: 'note', kind: 'agent', text: `${HOSTED_NAME} is on: each ask shows its price before you send it.` }); renderAll(); } } }, on || own ? 'Turn it off' : `Use ${HOSTED_NAME}`),
        c.me ? h('button.btn.btn-txt.ag-link', { type: 'button', onclick: () => show('account') }, 'Account') : null));
  }

  /* ---------------------------------------------------------------- notes the hosted agent leaves in the log */
  agent.on('creditback', ({ credits, reason, error }) => {
    if (error) { push({ k: 'note', kind: 'info', text: error }); return; }
    const why = reason === 'undo' ? 'You undid everything that ask did.' : reason === 'declined' ? 'You kept the song as it was.' : 'The device still fails its check.';
    push({ k: 'note', kind: 'ok', text: `Credits back: ${credits}. ${why}` });
  });
  agent.on('quote', (q) => {
    if (!q) { push({ k: 'note', kind: 'info', text: `${HOSTED_NAME} isn’t answering right now. Try again in a moment, or use your own Claude.` }); return; }
    if (!input.value.trim()) { input.value = q.text; grow(); }
    update();
  });
  let lastNotice = '';
  agent.on('cloud', () => {
    const me = cloud()?.me;
    if (me?.notice === 'eighty_percent') {
      const end = me.creditBack?.periodEnd || me.plan?.renewsAt || 0;
      const k = NOTICE_KEY + end;
      if (ls.get(k) !== '1' && lastNotice !== k) {
        lastNotice = k; ls.set(k, '1');
        push({ k: 'note', kind: 'info', text: `You’ve used most of this month’s credits: ${plural(Number(me.balance?.total) || 0, 'credit')} left${end ? `, until ${day(end)}` : ''}.` });
      }
    }
    renderAll();
  });
  agent.on('busy', () => update());

  /* ---------------------------------------------------------------- back from a checkout (paid or cancelled) */
  let landing = takeCheckoutReturn();
  async function land() {
    const c = cloud();
    if (!landing || !c?.enabled || !c.checked) return;   // once the service has said who this is
    const { ref, cancelled } = landing;
    landing = null;
    if (cancelled) {
      // nothing was bought: no sync, no refresh. Back on Top up, one plain line.
      try { ui.setOpen?.('right', true); ui.show?.('agent'); } catch { /* no right pane on this layout */ }
      checkoutRef = null;
      if (!c.me) { said = ''; show('signin'); return; }
      said = 'Nothing was bought.';
      show('topup');
      return;
    }
    let paid = true;
    try { if (c.me && ref) paid = (await c.sync(ref)).paid; else await c.refresh(); } catch { paid = !ref; await c.refresh().catch(() => {}); }
    try { ui.setOpen?.('right', true); ui.show?.('agent'); } catch { /* no right pane on this layout */ }
    if (!c.me) { said = 'Sign in with the email you paid with to see your credits.'; show('signin'); return; }
    if (!paid) { checkoutRef = ref; said = NOT_YET; show('topup'); return; }
    said = 'Paid. Your credits are in.';
    show('account');
    // the page is still settling from its load (the pane opening, the studio taking focus): the heading again, once
    setTimeout(() => { const d = globalThis.document, n = cached.node; if (n?.isConnected && (!d.activeElement || d.activeElement === d.body)) n.querySelector('h3')?.focus({ preventScroll: true }); }, 500);
  }
  if (landing) { agent.on('cloud', () => { land(); }); land(); }

  return {
    get enabled() { return !!cloud()?.enabled; },
    get view() { return view; },
    chip, row, update, gate, onError, head, sheet, setupRow, show,
    sent() { hint = null; moreTime = false; menuOpen = false; said = ''; update(); },
  };
}

const CSS = `
/* Claude on Overdub credits: a plain sheet like Agent settings, the price as words beside Send */
.ag-cl { display: flex; flex-direction: column; gap: 10px; padding: 16px 0 14px; }
.ag-cl .sheet-head > h3 { font-size: 19px; }
.ag-cl .sheet-head > h3:focus { outline: none; }
.ag-cl-status { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text); }
.ag-cl-err { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--bad); }
.ag-cl-field { display: flex; align-items: flex-end; gap: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--text-3); }
.ag-cl-field:focus-within { border-bottom-color: var(--text); }
.ag-cl-in { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: 13.5px/1.45 var(--font-ui); padding: 4px 0; }
.ag-cl-code { font-family: var(--font-mono); letter-spacing: .12em; }
.ag-cl-in::placeholder { color: var(--text-3); letter-spacing: 0; }
.ag-cl-frame:empty { display: none; }
.ag-cl-frame iframe { width: 100%; height: 72px; border: 0; }
.ag-cl-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ag-cl-two .btn { justify-content: center; text-align: center; white-space: normal; height: auto; min-height: 32px; }
.ag-cl-who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.ag-cl-who .ag-link { margin-left: 0; }
.ag-cl-dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; padding: 8px 0; border-top: var(--rule); border-bottom: var(--rule); font-size: 12.5px; line-height: 1.45; }
.ag-cl-dl dt { color: var(--text-3); }
.ag-cl-dl dd { margin: 0; color: var(--text-2); }
.ag-cl-dl .mono, .ag-cl-row-n { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text); }
.ag-cl-list { list-style: none; margin: 0; padding: 0; border-top: var(--rule); }
.ag-cl-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 2px 12px; padding: 8px 0; border-bottom: var(--rule); font-size: 12.5px; }
.ag-cl-row-t { display: flex; flex-direction: column; min-width: 0; }
.ag-cl-row-t b { font-weight: 600; color: var(--text); }
.ag-cl-row-t .t3 { font-size: 12px; }
.ag-cl-row-n { font-size: 12px; }
.ag-cl-row .btn { padding-left: 10px; padding-right: 10px; }
.ag-cl-trial { display: flex; flex-direction: column; gap: 6px; }
.ag-cl-trial .btn { align-self: flex-start; }
.ag-cl-delete { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: var(--rule); }
.ag-kc-cloud .ag-link { margin-left: 0; align-self: flex-start; }
/* the price, a word beside Send: a real button, its ▾ lists the other kinds */
.ag-pricerow { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.ag-pricerow:has(.ag-price[hidden]) { display: none; }
.ag-price-line { display: flex; align-items: baseline; gap: 10px; }
.ag-price-say { font-size: 12px; color: var(--text); }
.ag-price-say:empty { display: none; }
.ag-price[hidden] { display: none; }
.ag-price { display: inline-flex; align-items: baseline; gap: 0; padding: 2px 0; border: 0; background: none; color: var(--text-2); font: 12px var(--font-ui); cursor: pointer; }
.ag-price:hover:not(:disabled) > span:first-child { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
.ag-price:disabled { cursor: default; }
.ag-price-n { font-variant-numeric: tabular-nums; }
.ag-price-v { color: var(--text-3); }
.ag-price:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.ag-price-menu { display: flex; flex-direction: column; align-self: stretch; border-top: var(--rule); }
.ag-price-menu[hidden] { display: none; }
.ag-price-k, .ag-price-more { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border: 0; border-bottom: var(--rule); background: none; color: var(--text-2); font: 12.5px var(--font-ui); text-align: left; cursor: pointer; }
.ag-price-k.on { color: var(--text); }
.ag-price-k.on > span:first-child { text-decoration: underline; text-underline-offset: 3px; }
.ag-price-k:hover, .ag-price-more:hover { color: var(--text); }
.ag-price-more { justify-content: flex-start; align-items: center; gap: 8px; }
.ag-lamp-sq { width: 8px; height: 8px; flex: none; border: 1px solid var(--text-3); }
.ag-price-more.on .ag-lamp-sq { background: var(--accent-2); border-color: var(--accent-2); }
`;
