// The page side of the agent bridge: outside agents (Claude Code over MCP, via server/mcp.js and server/bridge.js)
// call this tab's tools. Calls run with by = 'mcp:<agent>' so their edits are signed, coloured cool, and undoable on
// their own; the agent shows up as a presence in the Agent panel.
//
//   POST /bridge/hello { page, tools, title } ; GET /bridge/events?page=… (SSE) ; POST /bridge/result { id, result }
//
// A call that carries a turn token is the panel's own Claude Code turn (agent/claude.js, provider 'local'): it goes to
// app.agent.localCall and is signed 'claude'.
//
// Emits ui 'bridge:state' { state: 'off' | 'connecting' | 'on' | 'reconnecting', root?, agent?, event? }.
// app.bridge = { state, page, agents() }.

import { installPresence } from './presence.js';
import { installTools } from './tools.js';

// The bridge is the local server's (server/serve.js): only a page served from this machine has one to say hello to.
// The Agent panel uses the same test to decide whether to offer the Claude Code command at all.
export const isLocalHost = (host = location.hostname) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);

const slug = (s) => String(s || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'agent';

export default function (app) {
  installPresence(app);
  installTools(app);
  if (app.bridge) return;
  const page = 'pg_' + Math.random().toString(36).slice(2, 10);
  const B = { state: 'off', page, root: '', agents: () => app.presence.agents().filter((a) => a.source === 'mcp') };
  app.bridge = B;
  let es = null, backoff = 1000, timer = 0, gone = false;
  const setState = (state, extra = {}) => { B.state = state; app.ui.emit('bridge:state', { state, root: B.root, ...extra }); };

  // The bridge is the local server's (server/serve.js): on the public site there is nothing to say hello to.
  const LOCAL = isLocalHost();
  async function hello() {
    if (!LOCAL) return 'absent';
    try {
      const r = await fetch('/bridge/hello', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page, tools: app.tools.schemas(), title: app.store.get().title }) });
      if (r.status === 404 || !(r.headers.get('content-type') || '').includes('json')) return 'absent';
      const j = await r.json();
      if (j.root) B.root = j.root;
      for (const name of j.agents || []) join(name);
      return 'ok';
    } catch (e) { return 'down'; }
  }

  function join(name) {
    const by = 'mcp:' + slug(name);
    const fresh = !app.presence.agents().some((a) => a.by === by && a.connected);
    app.presence.join(by, { name, source: 'mcp' });
    if (fresh) setState(B.state, { agent: name, event: 'join' });
    return by;
  }

  async function onCall(ev) {
    const by = join(ev.agent || 'Agent');
    let body;
    try {
      const result = await app.tools.run(ev.tool, ev.input || {}, { by });
      body = { id: ev.id, result };
    } catch (e) { body = { id: ev.id, error: String(e && e.message || e) }; }
    app.presence.status('', by);
    try { await fetch('/bridge/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch (e) { console.warn('overdub bridge: could not return a result', e); }
  }

  // A call from the Claude Code turn the panel is running (server/local-claude.js): the panel's agent runs it, signed
  // 'claude', only while that turn is the one in progress
  async function onTurnCall(ev) {
    let body;
    try {
      const result = app.agent?.localCall ? await app.agent.localCall(ev) : { error: 'no agent in this tab' };
      body = { id: ev.id, result };
    } catch (e) { body = { id: ev.id, error: String(e && e.message || e) }; }
    try { await fetch('/bridge/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch (e) { console.warn('overdub bridge: could not return a result', e); }
  }

  async function connect() {
    if (gone) return;
    clearTimeout(timer);
    setState(B.state === 'off' ? 'connecting' : 'reconnecting');
    const h = await hello();
    if (h === 'absent') { setState('off'); gone = true; return; }   // served without the bridge (a static host)
    if (h === 'down') return retry();
    es = new EventSource('/bridge/events?page=' + page);
    es.onopen = () => { backoff = 1000; setState('on'); hello(); };
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch (e) { return; }
      if (ev.type === 'call' && ev.turn) onTurnCall(ev);
      else if (ev.type === 'call') {
        app.presence.status(statusLine(ev.tool), 'mcp:' + slug(ev.agent));
        onCall(ev);
      } else if (ev.type === 'agent') {
        if (ev.state === 'leave') { const by = 'mcp:' + slug(ev.agent); app.presence.leave(by); setState(B.state, { agent: ev.agent, event: 'leave' }); }
        else join(ev.agent);
      }
    };
    es.onerror = () => { es.close(); es = null; retry(); };
  }
  function retry() {
    setState('reconnecting');
    timer = setTimeout(connect, backoff);
    backoff = Math.min(30000, backoff * 2);
  }
  // the tab you're looking at is the one agents drive (several tabs: the latest focused wins)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && B.state === 'on') hello(); });
  app.store.on('change', (e) => { if (e.kind === 'load' && B.state === 'on') hello(); });
  // a tool registered after the first hello (a module that loads late): send the catalog again
  let reHello = 0;
  app.ui.on?.('agent:tools', () => { if (B.state !== 'on') return; clearTimeout(reHello); reHello = setTimeout(hello, 50); });
  connect();
}

function statusLine(tool) {
  return ({ get_project: 'reading the song', get_selection: 'looking at your selection', apply_ops: 'editing the song', render_and_measure: 'listening (rendering)', define_device: 'building a device', adjust: 'adjusting a sound', propose_variations: 'waiting for your pick', ask_human: 'waiting for your answer', list_devices: 'browsing devices', play: 'playing it for you', highlight: 'pointing' })[tool] || 'working';
}
