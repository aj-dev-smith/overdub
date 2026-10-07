// The in-app agent: Claude on the Messages API, streaming, with the tool loop over agent/tools.js.
// Also a scripted MOCK provider (?agent=mock, or "Try the demo agent") that plays a realistic session against the
// real tools, for demos and tests.
//
//   const agent = createAgent(app);          // app.agent
//   agent.send(text, { context })            -> Promise (resolves when the turn, tool calls included, is over)
//   agent.stop()                             aborts instantly: the stream, waiting tools, retries
//   agent.busy / agent.provider ('claude' | 'local' | 'cloud' | 'mock' | null) / agent.model / agent.status
//   agent.setModel(id) / useMock(on) / useLocal(on) / useCloud(on)
//   agent.local -> { available, version, key } | null   (is Claude Code on this computer? does its server hold an API
//                  key? probed once, on a local server)
//   agent.keyRetired / retiredSeen()   a key this browser kept before the in-browser key was removed was just deleted:
//                  the panel says so once
//   agent.plan  -> { five_hour: { used, resetsAt }, seven_day: { used, resetsAt }, limited, at } | null   the person's
//                  Claude plan as Claude Code last reported it (used 0..1, resetsAt in ms); emits 'plan'
//   agent.reset()                            a fresh conversation for this song
//   agent.on(type, fn) -> off   types: busy, user, start, text, update, end, error, status, reset, provider, cloud,
//                                       quote, settled, creditback
//   agent.cloud -> the hosted agent's account (agent/cloud.js) | null    only when the deploy names its origin
//   agent.quote(text, { hint, moreTime }) -> { text, kind, label, credits, moreTime, alternatives } | null
//   agent.shown(quote)                       the panel showed this price on this exact text (the send gate, below)
//
// Local ('local'): Claude Code on this computer answers instead, signed in with the person's Claude plan (no key here).
// The turn goes to server/local-claude.js, which runs `claude -p` with only the studio's tools and streams its events
// back; its tool calls come back through the bridge (agent/bridge.js -> localCall) and run here, signed 'claude'. The
// conversation is Claude Code's session, resumed per song.
//
// Server key ('claude'): a self-hoster's own API key, set on the local server (OVERDUB_ANTHROPIC_KEY) and never sent to
// the page. The request goes to server/local-claude.js (/local/messages), which adds the key and streams the answer
// back. The page keeps no key: the in-browser key field is gone, and a key saved by an older version is deleted on
// load (RETIRED_KEY below).
//
// Claude on Overdub credits ('cloud'): the hosted agent (agent/cloud.js), off unless the deploy names its service
// (app/src/site-config.js), and used only when the person chose it: a Claude of their own (Claude Code, a server key)
// always comes first. The service owns the model, the system prompt and the tools (by prompt version); the page sends
// the ask and its tool results, runs the tools here, signed 'claude' like every in-app Claude, and settles each ask.
// The send gate: an ask opens only once the panel has shown its price on that exact text (agent.shown); otherwise
// send() emits 'quote' and waits for a second press. The service holds the conversation of an ask; across asks the
// page sends a short text-only recap (the last two exchanges, in memory only).
//
// API notes (from the claude-api skill): adaptive thinking (Opus/Sonnet 5.5 can't disable it), effort set explicitly,
// progress updates between tool calls via thinking display "updates", server-side refusal fallbacks ("default"),
// eager input streaming on every client tool (so we parse and validate tool input ourselves), prompt caching on the
// tools + frozen system prompt + the conversation, an append-only history (thinking blocks are echoed back unchanged;
// they are only stripped once, at a trim boundary or as the documented recovery).

import { buildSystemPrompt } from './prompt.js';
import { runTool, schemas, cancelRequest, IN_APP_DESCRIPTIONS } from './tools.js';
import { runMock } from './mock.js';
import { isLocalHost } from './bridge.js';
import { loadSiteConfig } from '../site-config.js';
import { createCloud, canonicalBundle, bundleVersion, newKey, HOSTED_NAME } from './cloud.js';
import { classify } from './cloud-kind.js';

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', blurb: 'the deepest thinker (default)' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', blurb: 'quick and very capable' },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', blurb: 'the quickest, for small moves' },
];
const API = '/local/messages';   // the local server, which holds the key (server/local-claude.js)
// The in-browser key's old home. Deleted on load and noted once (RETIRED_NOTE) so the panel can say so; keep this shim
// for two releases after the removal, then delete it (and RETIRED_NOTE with it).
const RETIRED_KEY = 'overdub:anthropic-key';
const RETIRED_NOTE = 'overdub:agent:key-retired';
const MODEL_KEY = 'overdub:agent-model';
const CONV_KEY = 'overdub:agent:conv:';
const LOCAL_KEY = 'overdub:agent-local';
const SESSION_KEY = 'overdub:agent:local-session:';
const PLAN_KEY = 'overdub:agent:local-plan';
const PROVIDER_KEY = 'overdub:agent-provider';     // 'cloud' when the person chose Claude on Overdub credits
const TAKES_KEY = 'overdub:cloud:takes';           // ask id -> the History entries it made, for credits back
const RECAP_PAIRS = 2;                             // earlier exchanges sent with a new ask, text only
const RECAP_CHARS = 4000;
const HEARTBEAT_MS = 5 * 60 * 1000;                // while an ask waits on the person: the service keeps it open
const CLOUD_RETRIES = 2;
// The system prompt names the tools bare; Claude Code lists them with the MCP server's prefix
const LOCAL_NOTE = '\n\nYou are running inside Claude Code on the human\'s computer, answering them in the studio\'s Agent panel. Your studio tools are listed as mcp__overdub__<name>: get_project here means mcp__overdub__get_project. You have no other tools. Write to the human in your reply, as in the panel; say is for when they may not be reading it. The Overdub server\'s instructions and get_guide\'s description tell outside agents to read get_guide "etiquette" first: those are the rules above, so you can skip that topic.';
const MAX_ITERS = 30;
const TRIM_AT = 700000;        // characters of JSON history before trimming (~175k tokens)
const TRIM_TO = 260000;

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } },
};
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(abortErr()); }, { once: true });
});
const abortErr = () => Object.assign(new Error('stopped'), { name: 'AbortError' });

// The selection rides in the person's turn inside <context>…</context>, and it names things a song brought (a track,
// a clip, a device, their ids): anyone's text. With <, > and & escaped, a name can't close the wrapper (</context>) and
// go on as if the person had said it.
const escContext = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const contextBlock = (context, text) => `<context>\n${escContext(context)}\n</context>\n\n${text}`;

export function createAgent(app) {
  const fns = new Map();
  const emit = (type, d) => { for (const fn of fns.get(type) || []) { try { fn(d); } catch (e) { console.error('agent listener', type, e); } } };
  const params = new URLSearchParams(location.search);
  let provider = null;
  let mockOn = params.get('agent') === 'mock' || sessionStorageGet('overdub:agent-mock') === '1';
  let localOn = ls.get(LOCAL_KEY) === '1';
  let cloudOn = ls.get(PROVIDER_KEY) === 'cloud';
  let cloud = null;            // the hosted agent's account, once site-config.json names it
  let shownQuote = null;       // the price the panel showed, and on which text
  let recap = [];              // [{ user, assistant }] the last exchanges with the hosted agent, for this song
  let local = null;            // { available, version } once probed
  let localTurn = '';
  let plan = null;             // the plan's usage windows, from Claude Code's rate_limit_event
  try { plan = JSON.parse(ls.get(PLAN_KEY) || 'null'); } catch (e) { plan = null; }          // the running Claude Code turn's token (its bridge calls carry it)
  let model = ls.get(MODEL_KEY) || MODELS[0].id;
  if (!MODELS.some((m) => m.id === model)) model = MODELS[0].id;
  let messages = [];
  let projectId = app.store.get().id;
  let controller = null;
  let busy = false;
  let lite = false;            // drop optional betas after an API rejects them
  let system = null;           // frozen per conversation
  let status = '';
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  if (ls.get(RETIRED_KEY) != null) { ls.set(RETIRED_KEY, null); ls.set(RETIRED_NOTE, '1'); }

  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function decide() {
    const prev = provider;
    provider = mockOn ? 'mock' : localOn && local?.available ? 'local' : local?.key ? 'claude' : cloudOn && cloud?.enabled ? 'cloud' : null;
    if (prev !== provider) emit('provider', provider);
  }
  function setStatus(text) { status = text || ''; emit('status', status); app.presence?.status(status, 'claude'); }
  function setBusy(b) { busy = b; emit('busy', b); if (!b) setStatus(''); }

  /* ------------------------------------------------------------------ conversation persistence (per song) */
  function load() {
    projectId = app.store.get().id;
    messages = [];
    try { const s = ls.get(CONV_KEY + projectId); if (s) messages = sanitize(JSON.parse(s)); } catch (e) { messages = []; }
    system = null; // a reloaded conversation starts a new cache prefix anyway
  }
  function save() {
    const slim = messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map((b) => {
      if (b.type === 'tool_result' && Array.isArray(b.content)) return { ...b, content: b.content.map((c) => (c.type === 'image' ? { type: 'text', text: '[image omitted]' } : c)) };
      return b;
    }) }));
    let s = JSON.stringify(slim);
    if (s.length > 1500000) s = JSON.stringify(trimmed(slim, 600000));
    ls.set(CONV_KEY + projectId, s);
  }
  // A restored conversation: thinking blocks dropped (a one-time boundary), and it must end on a complete turn.
  function sanitize(list) {
    const out = stripThinking(Array.isArray(list) ? list : []);
    while (out.length && (out[out.length - 1].role !== 'assistant' || out[out.length - 1].content.some?.((b) => b.type === 'tool_use'))) out.pop();
    return out;
  }
  app.store.on('change', (e) => { if (e.kind === 'load' && app.store.get().id !== projectId) { stop(); load(); recap = []; emit('reset', { reason: 'song' }); } });
  load();
  decide();
  // Claude Code is only reachable through a local server (server/serve.js); the public site has none
  if (isLocalHost()) {
    fetch('/local/status').then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : { available: false }))
      .catch(() => ({ available: false }))
      .then((j) => { local = { available: !!j.available, version: j.version || '', key: !!j.key }; const was = provider; decide(); if (was === provider) emit('provider', provider); });
  }
  // Claude on Overdub credits: only when the deploy names its service (forks and self-hosted copies never ask one)
  loadSiteConfig().then((cfg) => {
    if (!cfg.cloud) return;
    cloud = createCloud({ api: cfg.cloud.api });
    for (const ev of ['state', 'me', 'config']) cloud.on(ev, () => emit('cloud', { type: ev }));
    decide(); emit('provider', provider); emit('cloud', { type: 'on' });
    cloud.load();
  }).catch(() => {});

  /* ------------------------------------------------------------------ the request */
  const isFive = () => /-5-5$/.test(model);
  function body(tools) {
    const b = {
      model, max_tokens: isFive() ? 32000 : 16000, stream: true,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
      cache_control: { type: 'ephemeral' },   // automatic caching of the growing conversation
    };
    if (isFive()) {
      b.thinking = lite ? { type: 'adaptive' } : { type: 'adaptive', display: 'updates' };
      b.output_config = { effort: 'medium' };
      if (!lite) b.fallbacks = 'default';
    }
    return b;
  }
  // no key and no version here: the local server adds both (server/local-claude.js)
  function headers() {
    const h = { 'content-type': 'application/json' };
    if (isFive() && !lite) h['anthropic-beta'] = 'server-side-fallback-2026-07-01,thinking-display-updates-2026-08-18';
    return h;
  }
  function toolDefs() {
    // only the fields the Messages API takes on a tool: the catalog's MCP annotations would be refused (a 400)
    // (IN_APP_DESCRIPTIONS: a few say less here, where the system prompt already says it)
    const list = schemas().map(({ name, description, input_schema }) => ({ name, description: IN_APP_DESCRIPTIONS[name] || description, input_schema, eager_input_streaming: true }));
    list[list.length - 1] = { ...list[list.length - 1], cache_control: { type: 'ephemeral' } };
    return list;
  }

  // One streamed request -> the assistant message { content, stop_reason, stop_details }.
  // request: () => Response, the server key's by default (the hosted agent passes its own call)
  async function stream(signal, turn, request = null) {
    let res;
    try { res = request ? await request() : await fetch(API, { method: 'POST', headers: headers(), body: JSON.stringify(body(toolDefs())), signal }); } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (e.name === 'CloudError') throw e;
      throw Object.assign(new Error('Could not reach the local server (is node server/serve.js still running?)'), { retry: true });
    }
    if (!res.ok) {
      let detail = '', err = null;
      try { const j = await res.json(); err = j?.error || null; detail = j?.error?.message || JSON.stringify(j); } catch (e) { detail = res.statusText; }
      const retryAfter = Number(err?.retryAfter) || Number(res.headers.get('retry-after')) || 0;
      const { code = null, message, ...details } = err || {};
      throw Object.assign(new Error(detail || `HTTP ${res.status}`), { status: res.status, retry: [408, 409, 429, 500, 502, 503, 504, 529].includes(res.status), retryAfter, code, details });
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const msg = { content: [], stop_reason: null, stop_details: null, usage: {} };
    const blocks = msg.content;
    const partial = new Map();   // index -> accumulated partial_json
    const handle = (ev) => {
      switch (ev.type) {
        case 'message_start': Object.assign(msg.usage, ev.message?.usage || {}); break;
        case 'content_block_start': {
          const b = { ...ev.content_block };
          if (b.type === 'text') b.text = b.text || '';
          if (b.type === 'thinking') { b.thinking = b.thinking || ''; }
          if (b.type === 'tool_use') { partial.set(ev.index, ''); emit('toolstream', { turn, name: b.name, id: b.id }); setStatus(statusFor(b.name)); }
          blocks[ev.index] = b;
          break;
        }
        case 'content_block_delta': {
          const b = blocks[ev.index], d = ev.delta || {};
          if (!b) break;
          if (d.type === 'text_delta') { b.text += d.text; emit('text', { turn, delta: d.text }); if (!status.startsWith('Claude is writing')) setStatus('Claude is writing…'); }
          else if (d.type === 'thinking_delta') { b.thinking += d.thinking; if (d.thinking) emit('update', { turn, delta: d.thinking }); }
          else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
          else if (d.type === 'input_json_delta') partial.set(ev.index, (partial.get(ev.index) || '') + d.partial_json);
          break;
        }
        case 'content_block_stop': {
          const b = blocks[ev.index];
          if (b?.type === 'tool_use') {
            const raw = partial.get(ev.index) || '';
            try { b.input = raw.trim() ? JSON.parse(raw) : {}; } catch (e) { b.input = {}; b._invalid = raw; }
          }
          if (b?.type === 'thinking' && b.thinking) emit('update', { turn, done: true });
          break;
        }
        case 'message_delta': if (ev.delta?.stop_reason) msg.stop_reason = ev.delta.stop_reason; if (ev.delta?.stop_details) msg.stop_details = ev.delta.stop_details; Object.assign(msg.usage, ev.usage || {}); break;
        case 'error': throw Object.assign(new Error(ev.error?.message || 'stream error'), { retry: /overloaded|api_error|rate|overdub_timeout/.test(ev.error?.type || ''), status: ev.error?.type === 'overloaded_error' ? 529 : 500, midStream: true });
        case 'overdub': msg.overdub = ev; break;   // the hosted agent's own last event: calls used and left
        default: break;
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
        handle(ev);
      }
    }
    usage.input += msg.usage.input_tokens || 0; usage.output += msg.usage.output_tokens || 0;
    usage.cacheRead += msg.usage.cache_read_input_tokens || 0; usage.cacheWrite += msg.usage.cache_creation_input_tokens || 0;
    msg.content = blocks.filter(Boolean);
    return msg;
  }

  async function streamWithRetry(signal, turn) {
    let attempt = 0, recovered = false;
    for (;;) {
      try { return await stream(signal, turn); } catch (e) {
        if (e.name === 'AbortError' || signal.aborted) throw abortErr();
        const m = String(e.message || '');
        if (e.status === 400 && !recovered && /bound to a different conversation|Invalid `signature`/.test(m)) { messages = stripThinking(messages); recovered = true; continue; }
        if (e.status === 400 && !lite && /beta|fallback|display|Extra inputs|not supported|unknown/i.test(m)) { lite = true; continue; }
        if (e.retry && attempt < 4) {
          const wait = e.retryAfter ? e.retryAfter * 1000 : 1200 * Math.pow(2, attempt);
          attempt++;
          setStatus(`${e.status === 429 ? 'Rate limited' : e.status === 529 ? 'Claude is busy' : 'Connection hiccup'}: retrying in ${Math.round(wait / 1000)} s…`);
          emit('error', { message: m, retrying: true, in: wait });
          await sleep(wait, signal);
          continue;
        }
        throw e;
      }
    }
  }

  /* ------------------------------------------------------------------ the tool loop */
  async function runTools(blocks, signal, made = null) {
    const uses = blocks.filter((b) => b.type === 'tool_use');
    return Promise.all(uses.map(async (b) => {
      if (b._invalid != null) return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: JSON.stringify({ INVALID_JSON: b._invalid.slice(0, 2000) }) };
      if (signal.aborted) return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'Stopped: the human pressed Stop before this ran.' };
      setStatus(statusFor(b.name, b.input));
      const r = await runTool(b.name, b.input, { by: 'claude', app, signal, call: b.id });
      if (made && b.name === 'define_device') made.devices.push({ ok: !!(r && r.ok && !r.refused), offered: !!r?.offered });
      return toResult(b.id, r);
    }));
  }

  async function turnClaude(userContent, signal) {
    if (!system) system = await buildSystemPrompt({ name: 'Claude' });
    messages.push({ role: 'user', content: userContent });
    const turn = { id: Date.now() };
    emit('start', { turn });
    for (let iter = 0; iter < MAX_ITERS; iter++) {
      maybeTrim();
      setStatus(iter ? 'Claude is thinking…' : 'Claude is listening…');
      const msg = await streamWithRetry(signal, turn);
      const content = msg.content.filter((b) => !(b.type === 'text' && !b.text));
      const clean = content.map((b) => { if (b.type === 'tool_use') { const { _invalid, ...rest } = b; return rest; } return b; });
      if (!clean.length) { if (msg.stop_reason === 'refusal') emit('text', { turn, delta: refusalNote(msg) }); break; }
      messages.push({ role: 'assistant', content: clean });
      if (msg.stop_reason === 'refusal') { emit('text', { turn, delta: '\n\n' + refusalNote(msg) }); break; }
      const uses = content.filter((b) => b.type === 'tool_use');
      if (msg.stop_reason === 'pause_turn') continue;
      if (!uses.length) break;
      const results = await runTools(content, signal);
      messages.push({ role: 'user', content: results });
      if (signal.aborted) throw abortErr();
      if (msg.stop_reason === 'max_tokens' && !uses.length) break;
    }
    emit('end', { turn });
  }


  /* ------------------------------------------------------------------ Claude on Overdub credits */
  // The price on an ask, from the service's rate card (GET /v1/config) and the open rules in cloud-kind.js
  function quote(text, { hint = null, moreTime = false } = {}) {
    text = String(text || '').trim();
    const card = cloud?.rateCard() || [];
    if (!text || !card.length) return null;
    const { kind } = classify({ text, hint });
    const row = card.find((r) => r.kind === kind) || card[0];
    const mt = cloud.config?.moreTime || {};
    const more = !!moreTime && Array.isArray(mt.kinds) && mt.kinds.includes(row.kind);
    const times = more ? Number(mt.multiplier) || 1 : 1;
    return { text, kind: row.kind, label: row.label + (more ? ' · takes more time' : ''), credits: row.credits * times, moreTime: more, hint: hint && card.some((r) => r.kind === hint) ? hint : null,
      moreTimeOffered: Array.isArray(mt.kinds) && mt.kinds.includes(row.kind), alternatives: card.map((r) => ({ kind: r.kind, label: r.label, credits: r.credits })) };
  }
  let bundleCache = null;
  async function promptVersion() {
    const sys = await buildSystemPrompt({ name: 'Claude' });
    // the tools as the in-app agent sends them (toolDefs: IN_APP_DESCRIPTIONS where the system prompt already says it)
    const tools = schemas().map((t) => ({ ...t, description: IN_APP_DESCRIPTIONS[t.name] || t.description }));
    const key = sys.length + ':' + tools.map((t) => t.name + t.description.length).join();
    if (bundleCache?.key !== key) bundleCache = { key, version: await bundleVersion(canonicalBundle(sys, tools)) };
    return bundleCache.version;
  }

  // One ask: open (the service holds its price), then one call per step of the tool loop, then finish (charged or
  // released by the service's rules). The first call sends the recap and the opening message; each later call only the
  // tool results. The tools run here, signed 'claude'.
  async function turnCloud(text, context, q, signal) {
    if (!cloud?.me) throw Object.assign(new Error(`Sign in to use ${HOSTED_NAME}.`), { code: 'not_signed_in', status: 401 });
    const turn = { id: Date.now() };
    const key = newKey();
    setStatus('Opening the ask…');
    const pv = await promptVersion();
    const args = { kind: q.kind, moreTime: q.moreTime, promptVersion: pv };
    let opened;
    try { opened = await cloud.open(args, key); } catch (e) {
      // the last ask is still open on the service (a closed tab, a lost answer): finish it as stopped, then open once more
      if (e.code !== 'action_in_flight' || !e.details?.actionId) throw e;
      await cloud.finish(e.details.actionId, { outcome: 'stopped' }).catch(() => {});
      opened = await cloud.open(args, newKey());
    }
    const actionId = opened.actionId;
    if (opened.balance) cloud.setBalance(opened.balance);
    const made = { txns: [], cards: [], devices: [] };
    const offStore = app.store.on('change', (e) => { if (e.kind === 'do' && e.by === 'claude' && e.txn?.id) made.txns.push(e.txn.id); });
    const offReq = app.ui?.on?.('agent:request', ({ id, req } = {}) => { if (req?.by === 'claude' && req.keep && !made.cards.includes(id)) made.cards.push(id); }) || null;
    emit('start', { turn });
    const opening = { role: 'user', content: [{ type: 'text', text: context ? contextBlock(context, text) : text }] };
    let body = { messages: [...recap.flatMap((r) => [{ role: 'user', content: r.user }, { role: 'assistant', content: r.assistant }]), opening] };
    let outcome = 'done', said = '';
    try {
      for (let iter = 0; iter < MAX_ITERS; iter++) {
        setStatus(iter ? 'Claude is thinking…' : 'Claude is listening…');
        const msg = await cloudStream(actionId, body, signal, turn);
        const content = msg.content.filter((b) => !(b.type === 'text' && !b.text));
        said = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n') || said;
        if (msg.stop_reason === 'refusal') { emit('text', { turn, delta: (content.length ? '\n\n' : '') + refusalNote(msg) }); break; }
        const uses = content.filter((b) => b.type === 'tool_use');
        if (msg.stop_reason !== 'tool_use' || !uses.length) break;
        if (msg.overdub && msg.overdub.callsLeft === 0) break;
        const results = await withHeartbeat(actionId, () => runTools(content, signal, made));
        if (signal.aborted) throw abortErr();
        body = { toolResults: results };
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal.aborted) outcome = 'stopped';
      else if (e.code === 'action_call_limit' || e.code === 'action_cost_limit') { outcome = 'done'; emit('text', { turn, delta: `\n\n_${e.message}_` }); }
      else outcome = 'error';
      if (outcome !== 'done') { offStore(); offReq?.(); await settle(actionId, outcome, made); throw e; }
    }
    offStore(); offReq?.();
    await settle(actionId, outcome, made);
    if (said) { recap.push({ user: text.slice(0, RECAP_CHARS), assistant: said.slice(0, RECAP_CHARS) }); recap = recap.slice(-RECAP_PAIRS); }
    emit('end', { turn });
  }
  async function cloudStream(actionId, body, signal, turn) {
    for (let attempt = 0; ; attempt++) {
      try { return await stream(signal, turn, () => cloud.call(actionId, body, signal)); } catch (e) {
        if (e.name === 'AbortError' || signal.aborted) throw abortErr();
        // only answers the service marks as worth another go; the same body again, the partial answer thrown away
        const again = (e.status === 503 && e.code === 'upstream_busy') || (e.status === 502 && e.code === 'upstream_error' && e.details?.retryable === true) || (e.midStream && e.retry) || (e.status === 409 && e.code === 'call_in_flight');
        if (!again || attempt >= CLOUD_RETRIES) throw e;
        const ra = Number(e.retryAfter || e.details?.retryAfter) || 0;
        const wait = ra ? ra * 1000 : 1200 * Math.pow(2, attempt);
        setStatus(`${e.code === 'upstream_error' || e.midStream ? 'A hiccup on the way' : 'Claude is busy'}: trying again in ${Math.max(1, Math.round(wait / 1000))} s…`);
        emit('error', { message: e.message, retrying: true, in: wait });
        await sleep(wait, signal);
      }
    }
  }
  // while the tools run (a card or a question can wait on the person for minutes), the ask is kept open
  async function withHeartbeat(actionId, fn) {
    const t = setInterval(() => { cloud.wait(actionId).catch(() => {}); }, HEARTBEAT_MS);
    try { return await fn(); } finally { clearInterval(t); }
  }
  async function settle(actionId, outcome, made) {
    let cardPending = false;
    for (const id of made.cards) if (app.tools?.requests?.get(id)?.status === 'pending') cardPending = true;
    const deviceWritten = made.devices.some((d) => d.ok);
    let st = null;
    try { st = await cloud.finish(actionId, { outcome, cardPending, deviceWritten }); } catch (e) { st = null; }
    if (st?.charged > 0 && st.creditBackUntil) {
      const failed = made.devices.length >= 2 && !made.devices[made.devices.length - 1].ok;
      takes.put(actionId, { txns: made.txns, cards: made.cards, until: st.creditBackUntil, credits: st.charged, failed });
      if (failed) creditBack(actionId, 'device_failed_check');
      else watchTakes();
    }
    emit('settled', { actionId, settlement: st, outcome });
  }

  // Credits back: an ask whose every change was undone (or whose card was declined) inside the window the service
  // gave at finish. The page keeps which History entries each ask made (TAKES_KEY), so the service never stores a take.
  const takes = {
    all() { try { const j = JSON.parse(ls.get(TAKES_KEY) || '{}'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } },
    put(id, v) { const all = takes.all(); all[id] = v; const ids = Object.keys(all).sort((a, b) => (all[a].until || 0) - (all[b].until || 0)); for (const k of ids.slice(0, Math.max(0, ids.length - 50))) delete all[k]; ls.set(TAKES_KEY, JSON.stringify(all)); },
  };
  const backing = new Set();
  async function creditBack(actionId, reason) {
    if (backing.has(actionId)) return;
    backing.add(actionId);
    const all = takes.all(), e = all[actionId];
    try {
      const r = await cloud.creditBack(actionId, reason, newKey());
      if (e) { e.back = r?.creditedBack || e.credits; takes.put(actionId, e); }
      emit('creditback', { actionId, reason, credits: r?.creditedBack ?? e?.credits ?? 0, left: r?.creditBackLeft });
    } catch (err) {
      if (e) { e.back = 0; e.until = 0; takes.put(actionId, e); }
      emit('creditback', { actionId, reason, error: err.message, code: err.code });
    }
  }
  function watchTakes() {
    if (!cloud) return;
    const now = Date.now(), all = takes.all();
    const live = new Set((app.store.history || []).map((x) => x.id));
    for (const [id, e] of Object.entries(all)) {
      if (e.back != null || !(e.until > now) || backing.has(id)) continue;
      const undone = e.txns?.length > 0 && e.txns.every((t) => !live.has(t));
      const cards = (e.cards || []).map((c) => app.tools?.requests?.get(c)).filter(Boolean);
      const declined = cards.length > 0 && cards.every((r) => r.status === 'done' && r.result?.kept === false && !r.result?.refused) && (e.txns || []).every((t) => !live.has(t));
      if (undone) creditBack(id, 'undo');
      else if (declined) creditBack(id, 'declined');
    }
  }
  app.store.on('change', (e) => { if (e.kind === 'undo' || e.kind === 'redo') watchTakes(); });
  app.ui?.on?.('agent:request', ({ req } = {}) => { if (req?.keep && req.status === 'done') watchTakes(); });

  /* ------------------------------------------------------------------ Claude Code on this computer */
  const sessionKey = () => SESSION_KEY + projectId;
  const bare = (name) => String(name || '').replace(/^mcp__overdub__/, '');
  async function turnLocal(text, signal) {
    if (app.bridge?.state !== 'on') throw new Error('The studio isn’t connected to the local server yet: wait a moment, or reload the page.');
    if (!system) system = (await buildSystemPrompt({ name: 'Claude' })) + LOCAL_NOTE;
    const turn = { id: Date.now() };
    emit('start', { turn });
    setStatus('Claude is listening…');
    let res;
    try {
      res = await fetch('/local/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ page: app.bridge.page, text, model, system, session: ls.get(sessionKey()) || '' }) });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('Could not reach the local server (is node server/serve.js still running?)');
    }
    if (!res.ok) { let m = `HTTP ${res.status}`; try { m = (await res.json()).error || m; } catch (e) { /* plain */ } throw new Error(m); }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', result = null, exit = null, said = false;
    const handle = (ev) => {
      if (ev.type === 'turn') { localTurn = ev.token; return; }
      if (ev.type === 'exit') { exit = ev; return; }
      if (ev.session_id && ev.type === 'system' && ev.subtype === 'init') ls.set(sessionKey(), ev.session_id);
      if (ev.type === 'result') { result = ev; if (ev.session_id) ls.set(sessionKey(), ev.session_id); return; }
      if (ev.type === 'rate_limit_event') { notePlan(ev.rate_limit_info); return; }
      if (ev.type !== 'stream_event' || ev.parent_tool_use_id) return;
      const e = ev.event || {};
      if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') { emit('toolstream', { turn, name: bare(e.content_block.name), id: e.content_block.id }); setStatus(statusFor(bare(e.content_block.name))); }
      else if (e.type === 'content_block_start' && e.content_block?.type === 'text' && said) emit('text', { turn, delta: '\n\n' });
      else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) { said = true; emit('text', { turn, delta: e.delta.text }); if (!status.startsWith('Claude is writing')) setStatus('Claude is writing…'); }
      else if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta' && e.delta.thinking) emit('update', { turn, delta: e.delta.thinking });
      else if (e.type === 'content_block_stop') emit('update', { turn, done: true });
      else if (e.type === 'message_delta' && e.usage) { usage.input += e.usage.input_tokens || 0; usage.output += e.usage.output_tokens || 0; usage.cacheRead += e.usage.cache_read_input_tokens || 0; usage.cacheWrite += e.usage.cache_creation_input_tokens || 0; }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!l) continue;
          let ev; try { ev = JSON.parse(l); } catch (e) { continue; }
          handle(ev);
        }
      }
    } finally { localTurn = ''; }
    if (result?.is_error) {
      const m = String(result.result || result.subtype || 'error');
      // a resumed session Claude Code no longer has: start the song's conversation over next time
      if (/No conversation found/i.test(m)) ls.set(sessionKey(), null);
      throw new Error(`Claude Code: ${m}`);
    }
    if (!result && exit?.code) {
      const why = String(exit.stderr || '').split('\n').filter(Boolean).pop() || `exit ${exit.code}`;
      if (/No conversation found/i.test(why)) ls.set(sessionKey(), null);
      throw new Error(/log ?in|auth|credential/i.test(why) ? 'Claude Code isn’t signed in: run claude once in a terminal and log in with your Claude account.' : `Claude Code stopped: ${why}`);
    }
    emit('end', { turn });
  }
  // How much of the person's plan is used: Claude Code says after each request (utilization 0..1, resetsAt in seconds)
  function notePlan(info) {
    if (!info || typeof info !== 'object') return;
    const win = (w) => (w && Number.isFinite(Number(w.utilization)) ? { used: Math.max(0, Number(w.utilization)), resetsAt: Number(w.resetsAt) * 1000 || 0 } : null);
    const u = info.unifiedWindows || {};
    plan = { five_hour: win(u.five_hour), seven_day: win(u.seven_day), limited: info.status === 'rejected', resetsAt: Number(info.resetsAt) * 1000 || 0, at: Date.now() };
    ls.set(PLAN_KEY, JSON.stringify(plan));
    if (plan.limited) setStatus('Your Claude plan’s limit is reached for now');
    emit('plan', plan);
  }
  // A tool call from the running Claude Code turn (agent/bridge.js): run here, signed 'claude', like the in-app agent's
  async function localCall(ev) {
    if (!busy || !localTurn || ev.turn !== localTurn) return { error: 'That Claude Code turn is over (the human pressed Stop, or it ended).' };
    const name = bare(ev.tool), input = ev.input || {};
    setStatus(statusFor(name, input));
    return runTool(name, input, { by: 'claude', app, signal: controller?.signal, call: ev.id });
  }

  /* ------------------------------------------------------------------ public */
  async function send(text, { context = null, scope = '' } = {}) {
    text = String(text || '').trim();
    if (!text || busy) return false;
    decide();
    if (!provider) { emit('error', { message: 'No agent is on yet: try the demo agent, or use your own Claude.', code: 'noagent' }); return false; }
    // the send gate: nothing opens an ask on credits until its price was shown on this exact text
    let q = null;
    if (provider === 'cloud') {
      if (!shownQuote || shownQuote.text !== text) { emit('quote', quote(text)); return false; }
      q = shownQuote; shownQuote = null;
    }
    controller = new AbortController();
    const signal = controller.signal;
    setBusy(true);
    emit('user', { text, context, scope });
    const userContent = context ? [{ type: 'text', text: contextBlock(context, text) }] : text;
    try {
      if (provider === 'local') await turnLocal(context ? contextBlock(context, text) : text, signal);
      else if (provider === 'mock') await runMock(app, text, { signal, emit, setStatus, context, fast: params.has('fast') || params.has('agentfast') });
      else if (provider === 'cloud') await turnCloud(text, context, q, signal);
      else await turnClaude(userContent, signal);
    } catch (e) {
      if (e.name === 'AbortError' || signal.aborted) {
        repair();
        emit('end', { stopped: true });
      } else if (provider === 'cloud') {
        emit('error', { message: cloudMessage(e), status: e.status, code: e.code || null, details: e.details || {}, cloud: true });
        emit('end', { error: true });
      } else {
        repair();
        const nice = e.status === 401 ? 'The API key on your local server was rejected (401). Check OVERDUB_ANTHROPIC_KEY and restart the server.' : e.status === 403 ? 'The server’s key cannot use that model (403).' : e.status === 404 ? `The model ${model} is not available to the server’s key (404): try another model.` : e.status === 400 ? `The API refused the request: ${e.message}` : e.message;
        emit('error', { message: nice, status: e.status, code: e.code || (e.status === 401 ? 'badkey' : null) });
        emit('end', { error: true });
      }
    } finally {
      if (provider === 'claude') save();
      controller = null;
      setBusy(false);
    }
    return true;
  }
  // After a stop or an error: the history must end on a complete turn (every tool_use answered).
  function repair() {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use')) {
      messages.push({ role: 'user', content: last.content.filter((b) => b.type === 'tool_use').map((b) => ({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'Stopped: the human pressed Stop.' })) });
      messages.push({ role: 'assistant', content: [{ type: 'text', text: '(stopped)' }] });
    } else if (last.role === 'user') {
      if (Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) messages.push({ role: 'assistant', content: [{ type: 'text', text: '(stopped)' }] });
      else messages.pop(); // the human's message never got an answer: drop it so the next one starts clean
    }
  }
  function stop() {
    if (controller) controller.abort();
    app.presence?.clear('claude');
    // anything an agent is waiting on from the human is withdrawn
    for (const req of app.tools?.requests?.values?.() || []) if (req.status === 'pending' && req.by === 'claude') cancelRequest(app, req.id, 'stopped');
  }
  function maybeTrim() {
    const size = JSON.stringify(messages).length;
    if (size < TRIM_AT) return;
    messages = trimmed(messages, TRIM_TO);
  }

  const agent = {
    MODELS,
    get busy() { return busy; },
    get provider() { decide(); return provider; },
    get model() { return model; },
    get status() { return status; },
    get messages() { return messages; },
    get usage() { return { ...usage }; },
    on(type, fn) { if (!fns.has(type)) fns.set(type, new Set()); fns.get(type).add(fn); return () => fns.get(type).delete(fn); },
    send, stop,
    reset() { stop(); messages = []; system = null; recap = []; ls.set(CONV_KEY + projectId, null); ls.set(SESSION_KEY + projectId, null); emit('reset', { reason: 'new' }); },
    get local() { return local; },
    get cloud() { return cloud; },
    get cloudChosen() { return cloudOn && !!cloud?.enabled; },
    useCloud(on = true) {
      cloudOn = !!on; ls.set(PROVIDER_KEY, on ? 'cloud' : null);
      if (on) { mockOn = false; try { sessionStorage.removeItem('overdub:agent-mock'); } catch (e) { /* ok */ } if (localOn) { localOn = false; ls.set(LOCAL_KEY, null); } }
      system = null; decide(); emit('provider', provider);
    },
    quote,
    shown(q) { shownQuote = q && typeof q.text === 'string' ? { ...q } : null; },
    promptVersion,
    get recap() { return recap.map((r) => ({ ...r })); },
    get plan() { return plan && plan.at ? plan : null; },
    localCall,
    useLocal(on = true) { localOn = !!on; ls.set(LOCAL_KEY, on ? '1' : null); if (on) { mockOn = false; try { sessionStorage.removeItem('overdub:agent-mock'); } catch (e) { /* ok */ } } system = null; decide(); emit('provider', provider); },
    get keyRetired() { return ls.get(RETIRED_NOTE) === '1'; },
    retiredSeen() { ls.set(RETIRED_NOTE, null); },
    setModel(id) { if (!MODELS.some((m) => m.id === id)) return false; model = id; ls.set(MODEL_KEY, id); lite = false; emit('provider', provider); return true; },
    useMock(on = true) { mockOn = !!on; try { if (on) sessionStorage.setItem('overdub:agent-mock', '1'); else sessionStorage.removeItem('overdub:agent-mock'); } catch (e) { /* ok */ } decide(); },
    // for the panel: what the in-app agent is doing, as a phrase
    statusFor,
  };
  return agent;
}

/* ------------------------------------------------------------------ helpers */
// What the panel says for an answer from Claude on Overdub credits: the service's own words (they're written for a
// musician), and the studio's where the page knows more
function cloudMessage(e) {
  const at = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  switch (e.code) {
    case 'action_closed': return 'That ask timed out while it was waiting. Ask again to carry on.';
    case 'prompt_version_unknown': return `${HOSTED_NAME} is updating. Try again in a few minutes.`;
    case 'rate_limited': return `${e.message}${e.details?.retryAfter ? ` (in ${Math.ceil(e.details.retryAfter)} s)` : ''}`;
    case 'daily_limit': return `${e.message}${e.details?.resetsAt ? ` That’s ${at(e.details.resetsAt)} here.` : ''}`;
    case 'unreachable': return `Couldn’t reach ${HOSTED_NAME}. Check your connection and try again.`;
    case 'upstream_busy': return 'Claude is busy right now. Try again in a minute.';   // (after the retries)
    default: return e.message || `${HOSTED_NAME} didn’t answer that one. Try again in a moment.`;
  }
}
function refusalNote(msg) {
  const cat = msg.stop_details?.category;
  return `(Claude declined this one${cat ? ` — ${cat}` : ''}. Try rephrasing what you want to hear.)`;
}
function toResult(id, r) {
  let image = null;
  if (r && typeof r === 'object' && typeof r.image === 'string' && r.image.startsWith('data:image/')) { image = r.image; r = { ...r }; delete r.image; r.image_attached = true; }
  let text = JSON.stringify(r);
  if (text.length > 60000) text = text.slice(0, 60000) + ' …(truncated)';
  const isErr = !!(r && r.error);
  if (!image) return { type: 'tool_result', tool_use_id: id, content: text, ...(isErr ? { is_error: true } : {}) };
  const [head, data] = image.split(',');
  const media = /image\/(png|jpeg|webp|gif)/.exec(head)?.[0] || 'image/png';
  return { type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: media, data } }] };
}
function stripThinking(list) {
  return list.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') } : m))
    .filter((m) => !(Array.isArray(m.content) && m.content.length === 0));
}
// Keep the most recent whole turns under `limit` characters. Cuts only at a human message (not a tool result), drops
// thinking (a one-time cache boundary) and replaces older images with a note.
function trimmed(list, limit) {
  let out = stripThinking(list).map((m, i, a) => (i < a.length - 4 && Array.isArray(m.content) ? { ...m, content: m.content.map((b) => (b.type === 'tool_result' && Array.isArray(b.content) ? { ...b, content: b.content.map((c) => (c.type === 'image' ? { type: 'text', text: '[image omitted]' } : c)) } : b)) } : m));
  const isHuman = (m) => m.role === 'user' && (typeof m.content === 'string' || m.content.every((b) => b.type !== 'tool_result'));
  while (JSON.stringify(out).length > limit) {
    let cut = -1;
    for (let i = 1; i < out.length; i++) if (isHuman(out[i])) { cut = i; break; }
    if (cut < 0) break;
    out = out.slice(cut);
  }
  if (out.length && !isHuman(out[0])) out = [];
  if (out.length) out[0] = { role: 'user', content: [{ type: 'text', text: '(Earlier conversation trimmed to save room. get_history shows what happened in the song.)' }, ...(typeof out[0].content === 'string' ? [{ type: 'text', text: out[0].content }] : out[0].content)] };
  return out;
}
export function statusFor(name, input = {}) {
  const S = {
    get_project: 'Claude is reading the song…', get_selection: 'Claude is looking at your selection…', get_history: 'Claude is reading the history…',
    apply_ops: `Claude is writing${input.label ? ` ${input.label}` : ''}…`, list_devices: 'Claude is browsing devices…', get_device: 'Claude is reading a device…',
    define_device: `Claude is building ${input.device?.name || 'a device'}…`, render_and_measure: 'Claude is listening (rendering)…', adjust: `Claude is adjusting ${input.axis || ''}…`,
    play: 'Claude is playing it for you…', highlight: 'Claude is pointing…', propose_variations: 'Waiting for your pick…', get_variation_result: 'Waiting for your pick…',
    get_capture: 'Claude is reading what you played…', ask_human: 'Waiting for your answer…', undo: 'Claude is undoing…', revert_my_changes: 'Claude is reverting its changes…',
  };
  return S[name] || 'Claude is working…';
}
