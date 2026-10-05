// The in-app agent: Claude on the Messages API, bring-your-own-key, streaming, with the tool loop over agent/tools.js.
// Also a scripted MOCK provider (?agent=mock, or "Try the demo agent") that plays a realistic session against the
// real tools, for demos and tests.
//
//   const agent = createAgent(app);          // app.agent
//   agent.send(text, { context })            -> Promise (resolves when the turn, tool calls included, is over)
//   agent.stop()                             aborts instantly: the stream, waiting tools, retries
//   agent.busy / agent.provider ('claude' | 'local' | 'mock' | null) / agent.model / agent.status
//   agent.setKey(key) / clearKey() / hasKey() / setModel(id) / useMock(on) / useLocal(on)
//   agent.local -> { available, version } | null   (is Claude Code on this computer? probed once, on a local server)
//   agent.plan  -> { five_hour: { used, resetsAt }, seven_day: { used, resetsAt }, limited, at } | null   the person's
//                  Claude plan as Claude Code last reported it (used 0..1, resetsAt in ms); emits 'plan'
//   agent.reset()                            a fresh conversation for this song
//   agent.on(type, fn) -> off   types: busy, user, start, text, update, end, error, status, reset, provider
//
// Local ('local'): Claude Code on this computer answers instead, signed in with the person's Claude plan (no key here).
// The turn goes to server/local-claude.js, which runs `claude -p` with only the studio's tools and streams its events
// back; its tool calls come back through the bridge (agent/bridge.js -> localCall) and run here, signed 'claude'. The
// conversation is Claude Code's session, resumed per song.
//
// BYOK: the key lives only in this browser's localStorage and is sent only to api.anthropic.com (the browser talks to
// the API directly; that is what the anthropic-dangerous-direct-browser-access header acknowledges).
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

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', blurb: 'the deepest thinker (default)' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', blurb: 'quick and very capable' },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', blurb: 'the quickest, for small moves' },
];
const API = 'https://api.anthropic.com/v1/messages';
const KEY_KEY = 'overdub:anthropic-key';
const MODEL_KEY = 'overdub:agent-model';
const CONV_KEY = 'overdub:agent:conv:';
const LOCAL_KEY = 'overdub:agent-local';
const SESSION_KEY = 'overdub:agent:local-session:';
const PLAN_KEY = 'overdub:agent:local-plan';
// The system prompt names the tools bare; Claude Code lists them with the MCP server's prefix
const LOCAL_NOTE = '\n\nYou are running inside Claude Code on the human\'s computer, answering them in the studio\'s Agent panel. Your studio tools are listed as mcp__overdub__<name>: get_project here means mcp__overdub__get_project. You have no other tools. Write to the human in your reply, as in the panel; say is for when they may not be reading it.';
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

  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function decide() {
    const prev = provider;
    provider = mockOn ? 'mock' : localOn && local?.available ? 'local' : ls.get(KEY_KEY) ? 'claude' : null;
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
  app.store.on('change', (e) => { if (e.kind === 'load' && app.store.get().id !== projectId) { stop(); load(); emit('reset', { reason: 'song' }); } });
  load();
  decide();
  // Claude Code is only reachable through a local server (server/serve.js); the public site has none
  if (isLocalHost()) {
    fetch('/local/status').then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : { available: false }))
      .catch(() => ({ available: false }))
      .then((j) => { local = { available: !!j.available, version: j.version || '' }; const was = provider; decide(); if (was === provider) emit('provider', provider); });
  }

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
  function headers(key) {
    const h = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
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
  async function stream(signal, turn) {
    const key = ls.get(KEY_KEY);
    if (!key) throw Object.assign(new Error('No API key yet'), { code: 'nokey' });
    let res;
    try { res = await fetch(API, { method: 'POST', headers: headers(key), body: JSON.stringify(body(toolDefs())), signal }); } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw Object.assign(new Error('Could not reach api.anthropic.com (offline, or blocked by an extension?)'), { retry: true });
    }
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j?.error?.message || JSON.stringify(j); } catch (e) { detail = res.statusText; }
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      throw Object.assign(new Error(detail || `HTTP ${res.status}`), { status: res.status, retry: [408, 409, 429, 500, 502, 503, 504, 529].includes(res.status), retryAfter });
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
        case 'error': throw Object.assign(new Error(ev.error?.message || 'stream error'), { retry: /overloaded|api_error|rate/.test(ev.error?.type || ''), status: ev.error?.type === 'overloaded_error' ? 529 : 500 });
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
  async function runTools(blocks, signal) {
    const uses = blocks.filter((b) => b.type === 'tool_use');
    return Promise.all(uses.map(async (b) => {
      if (b._invalid != null) return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: JSON.stringify({ INVALID_JSON: b._invalid.slice(0, 2000) }) };
      if (signal.aborted) return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'Stopped: the human pressed Stop before this ran.' };
      setStatus(statusFor(b.name, b.input));
      const r = await runTool(b.name, b.input, { by: 'claude', app, signal, call: b.id });
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
    if (!provider) { emit('error', { message: 'Add an API key or try the demo agent first.', code: 'nokey' }); return false; }
    controller = new AbortController();
    const signal = controller.signal;
    setBusy(true);
    emit('user', { text, context, scope });
    const userContent = context ? [{ type: 'text', text: contextBlock(context, text) }] : text;
    try {
      if (provider === 'local') await turnLocal(context ? contextBlock(context, text) : text, signal);
      else if (provider === 'mock') await runMock(app, text, { signal, emit, setStatus, context, fast: params.has('fast') || params.has('agentfast') });
      else await turnClaude(userContent, signal);
    } catch (e) {
      if (e.name === 'AbortError' || signal.aborted) {
        repair();
        emit('end', { stopped: true });
      } else {
        repair();
        const nice = e.code === 'nokey' ? 'Add an API key first.' : e.status === 401 ? 'That API key was rejected (401). Check it, or paste a new one.' : e.status === 403 ? 'This key cannot use that model (403).' : e.status === 404 ? `The model ${model} is not available to this key (404): try another model.` : e.status === 400 ? `The API refused the request: ${e.message}` : e.message;
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
    reset() { stop(); messages = []; system = null; ls.set(CONV_KEY + projectId, null); ls.set(SESSION_KEY + projectId, null); emit('reset', { reason: 'new' }); },
    get local() { return local; },
    get plan() { return plan && plan.at ? plan : null; },
    localCall,
    useLocal(on = true) { localOn = !!on; ls.set(LOCAL_KEY, on ? '1' : null); if (on) { mockOn = false; try { sessionStorage.removeItem('overdub:agent-mock'); } catch (e) { /* ok */ } } system = null; decide(); emit('provider', provider); },
    hasKey: () => !!ls.get(KEY_KEY),
    keyHint: () => { const k = ls.get(KEY_KEY); return k ? `${k.slice(0, 7)}…${k.slice(-4)}` : ''; },
    setKey(k) { k = String(k || '').trim(); if (!k) return false; ls.set(KEY_KEY, k); mockOn = false; localOn = false; ls.set(LOCAL_KEY, null); try { sessionStorage.removeItem('overdub:agent-mock'); } catch (e) { /* ok */ } decide(); return true; },
    clearKey() { ls.set(KEY_KEY, null); decide(); },
    setModel(id) { if (!MODELS.some((m) => m.id === id)) return false; model = id; ls.set(MODEL_KEY, id); lite = false; emit('provider', provider); return true; },
    useMock(on = true) { mockOn = !!on; try { if (on) sessionStorage.setItem('overdub:agent-mock', '1'); else sessionStorage.removeItem('overdub:agent-mock'); } catch (e) { /* ok */ } decide(); },
    // for the panel: what the in-app agent is doing, as a phrase
    statusFor,
  };
  return agent;
}

/* ------------------------------------------------------------------ helpers */
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
