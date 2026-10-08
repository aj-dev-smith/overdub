// The agent bridge: lets outside agents (Claude Code / Claude Desktop over MCP, via server/mcp.js) drive the studio
// tab that is open in a browser. The tab runs every tool itself (the song lives there), so this is only a relay.
//
//   page  -> POST /bridge/hello  { page, tools, title }      announce a studio tab (and its tool catalog)
//   page  <- GET  /bridge/events?page=…  (SSE)                { type: 'call', id, tool, input, agent } | { type: 'agent', agent, state }
//   page  -> POST /bridge/result { id, result | error }       answer a call
//   agent -> POST /bridge/call   { tool, input, agent, turn?, page? }   waits for the page; -> { result, tab? } | { error, hint }
//                                                              turn + page: a Claude Code turn the panel started
//                                                              (server/local-claude.js), sent to that tab only
//                                                              tab: { changed: true, title } when the call went to another
//                                                              tab than this agent's last one (mcp.js tells the agent)
//   agent -> POST /bridge/agent  { agent, state: 'join' | 'leave' }   presence (the tab shows who is connected)
//   any   -> GET  /bridge/tools  -> { tools, source: 'page' | 'catalog' }   tools: [{ name, description, input_schema,
//                                                               annotations }], the tab's or (no tab) catalogSchemas()
//   any   -> GET  /bridge/status -> { pages, agents, root, url }
//
// Safety: the server only listens on 127.0.0.1, any request carrying a browser Origin from another site is refused, and
// so is any request whose Host isn't a loopback name (a DNS-rebound site has an Origin that matches its own Host), so a
// web page can't drive your studio through this relay. A browser's GET for an image or a script carries no Origin,
// so a request whose Sec-Fetch-Site says another site (or a sibling port) made it is refused too, and an event stream
// only opens for a page that said hello first (a POST, which browsers send with its Origin): otherwise any page could
// become the live page with an <img> and take the agent's calls into a stream nobody reads. Call ids are random, so a
// result can only answer a call whose event the page received.

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = new Map(); // page id -> { res, tools, title, at, connected }
const pending = new Map(); // call id -> { resolve, timer, page }
const agents = new Map(); // agent name -> { at, calls }
let seq = 0;
let catalog = null;

async function staticTools() {
  if (catalog) return catalog;
  // no tab yet: the whole catalog, including the tools page modules register at boot (agent/extra-schemas.js)
  try {
    const m = await import('../app/src/agent/tools.js');
    catalog = m.catalogSchemas ? await m.catalogSchemas() : m.schemas();
  } catch {
    catalog = [];
  }
  return catalog;
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
  return true;
}
// The largest bodies it carries, measured: a song at the format's limits (50,000 notes in 4,096 clips) read in full is
// about 0.8 MB, a render with its spectrogram about 0.45 MB, a tab's tool catalog about 40 KB; an agent's call is held
// to the same song limits (and a kernel to 256 KB). 8 MB leaves room; 40 MB only let a stray body hold the server.
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => {
      try {
        const s = Buffer.concat(parts).toString('utf8');
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}
// DNS rebinding: a site can point its own name at 127.0.0.1, and then its Origin matches its Host. Only requests made
// to a loopback name get through.
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i;
export function foreignHost(req) {
  return !LOOPBACK.test(String(req.headers.host || ''));
}
export function foreignOrigin(req) {
  const o = req.headers.origin;
  if (!o) return false;
  if (o === 'null') return true;
  try {
    return new URL(o).host !== req.headers.host;
  } catch {
    return true;
  }
}
// Browsers say who made a request: same-origin (the studio's own page), none (a person typing the URL), or
// same-site / cross-site. Node clients like mcp.js send no Sec-Fetch-Site at all.
export function foreignSite(req) {
  const s = req.headers['sec-fetch-site'];
  return s != null && s !== 'same-origin' && s !== 'none';
}
function send(page, obj) {
  if (!page?.res || !page.connected) return false;
  try {
    page.res.write(`data: ${JSON.stringify(obj)}\n\n`);
    return true;
  } catch {
    return false;
  }
}
function livePage() {
  let best = null;
  for (const p of pages.values()) if (p.connected && (!best || p.at > best.at)) best = p;
  return best;
}
function broadcast(obj) {
  for (const p of pages.values()) send(p, obj);
}
// How long a call may take before the bridge gives up on the page: a tool that waits on the human (wait_seconds) gets
// its wait on top of the time it needs, so a documented wait never comes back as "the studio did not answer".
export function timeoutFor(tool, input = {}) {
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      input = {};
    }
  }
  const w = Number(input && input.wait_seconds);
  const wait = (def, max = Infinity) => Math.max(0, Math.min(max, Number.isFinite(w) ? w : def));
  if (tool === 'propose_variations') return (wait(90) + 30) * 1000;
  if (tool === 'ask_human') return (wait(120) + 30) * 1000;
  if (tool === 'get_variation_result') return (wait(0) + 30) * 1000;
  if (tool === 'get_recording') return Math.max(45, wait(0, 120) + 30) * 1000; // the page clamps its wait to 120
  // adjust renders before and after, and a word people disagree on waits for the human's pick (default 90) first
  if (tool === 'adjust') return (wait(90) + 120) * 1000;
  if (tool === 'render_and_measure' || tool === 'define_device') return 120000;
  return 45000;
}

export function status(host = 'localhost:3279') {
  return {
    pages: [...pages.values()].filter((p) => p.connected).length,
    titles: [...pages.values()].filter((p) => p.connected).map((p) => p.title),
    agents: [...agents.entries()].map(([name, a]) => ({ name, connected: !a.gone, calls: a.calls })),
    root: ROOT,
    url: `http://${host}/app/`,
  };
}

export function register({ addRoute }) {
  addRoute('/bridge/', async (req, res, url) => {
    if (foreignHost(req) || foreignOrigin(req) || foreignSite(req))
      return json(res, 403, { error: 'the bridge only talks to the studio on this machine' });
    const route = url.pathname.slice('/bridge/'.length);
    const host = req.headers.host || 'localhost:3279';
    try {
      if (route === 'status' && req.method === 'GET') return json(res, 200, status(host));

      if (route === 'tools' && req.method === 'GET') {
        const p = livePage();
        if (p?.tools?.length) return json(res, 200, { tools: p.tools, source: 'page' });
        return json(res, 200, { tools: await staticTools(), source: 'catalog' });
      }

      if (route === 'hello' && req.method === 'POST') {
        const b = await readBody(req);
        const id = String(b.page || 'pg' + ++seq);
        const p = pages.get(id) || { res: null, connected: false };
        Object.assign(p, {
          tools: Array.isArray(b.tools) ? b.tools : p.tools || [],
          title: b.title || p.title || 'Untitled',
          at: Date.now(),
        });
        pages.set(id, p);
        return json(res, 200, {
          ok: true,
          page: id,
          agents: [...agents.entries()].filter(([, a]) => !a.gone).map(([name]) => name),
          root: ROOT,
        });
      }

      if (route === 'events' && req.method === 'GET') {
        const id = url.searchParams.get('page');
        const p = id && pages.get(id);
        if (!p) return json(res, 404, { error: 'no such page: POST /bridge/hello { page } first' });
        if (p.res && p.res !== res) {
          try {
            p.res.end();
          } catch {
            /* gone */
          }
        }
        Object.assign(p, { res, connected: true, at: Date.now() });
        pages.set(id, p);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write(`retry: 2000\n: overdub bridge\n\n`);
        for (const [name, a] of agents) if (!a.gone) send(p, { type: 'agent', agent: name, state: 'join' });
        const ping = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            /* closed */
          }
        }, 15000);
        req.on('close', () => {
          clearInterval(ping);
          if (p.res === res) {
            p.connected = false;
            p.res = null;
          }
          for (const [cid, c] of pending)
            if (c.page === id) {
              clearTimeout(c.timer);
              pending.delete(cid);
              c.resolve({
                error: 'the studio tab closed or reloaded while the tool was running',
                hint: 'open the studio again and retry',
              });
            }
          setTimeout(() => {
            if (!p.connected) pages.delete(id);
          }, 60000).unref?.(); // (unref: a test's process can exit)
        });
        return true;
      }

      if (route === 'result' && req.method === 'POST') {
        const b = await readBody(req);
        const c = pending.get(b.id);
        if (!c) return json(res, 404, { error: 'no such call (it timed out?)' });
        clearTimeout(c.timer);
        pending.delete(b.id);
        c.resolve(b.error ? { error: String(b.error), hint: b.hint } : { result: b.result });
        return json(res, 200, { ok: true });
      }

      if (route === 'agent' && req.method === 'POST') {
        const b = await readBody(req);
        const name = String(b.agent || 'Agent').slice(0, 40);
        const a = agents.get(name) || { calls: 0 };
        a.at = Date.now();
        a.gone = b.state === 'leave';
        agents.set(name, a);
        broadcast({ type: 'agent', agent: name, state: a.gone ? 'leave' : 'join' });
        return json(res, 200, { ok: true, pages: status(host).pages });
      }

      if (route === 'call' && req.method === 'POST') {
        const b = await readBody(req);
        const tool = String(b.tool || '');
        const agent = String(b.agent || 'Agent').slice(0, 40);
        if (!tool) return json(res, 400, { error: 'tool is required' });
        // a call from a Claude Code turn the panel started (server/local-claude.js): it goes to that tab, which signs it
        // 'claude' if the token is its running turn's; it is the panel's agent, not another one in the room
        const turn = typeof b.turn === 'string' ? b.turn.slice(0, 80) : '';
        if (turn) {
          const pageId = String(b.page || '');
          const page = pages.get(pageId);
          if (!page?.connected)
            return json(res, 503, {
              error: 'The studio tab that started this turn is gone.',
              hint: 'the human closed or reloaded it: stop here',
            });
          const id = randomUUID();
          const out = await new Promise((resolve) => {
            const timer = setTimeout(
              () => {
                pending.delete(id);
                resolve({
                  error: `the studio did not answer within ${Math.round(timeoutFor(tool, b.input) / 1000)} s`,
                  hint: 'is the tab in the background or busy? retry once',
                });
              },
              timeoutFor(tool, b.input),
            );
            pending.set(id, { resolve, timer, page: pageId });
            if (!send(page, { type: 'call', id, tool, input: b.input || {}, turn })) {
              clearTimeout(timer);
              pending.delete(id);
              resolve({ error: 'could not reach the studio tab' });
            }
          });
          return json(res, out.error ? 502 : 200, out);
        }
        const page = livePage();
        if (!page)
          return json(res, 503, {
            error: 'No Overdub studio is open.',
            hint: `Open http://${host}/app/ in a browser (and keep the tab open), then try again.`,
          });
        const a = agents.get(agent) || { calls: 0 };
        a.at = Date.now();
        a.calls++;
        if (a.gone !== false) {
          a.gone = false;
          broadcast({ type: 'agent', agent, state: 'join' });
        }
        agents.set(agent, a);
        const id = randomUUID();
        const pageId = [...pages.entries()].find(([, p]) => p === page)[0];
        // the newest tab gets the calls: when that isn't the one this agent's last call went to (a second tab opened, the
        // tab reloaded), its ids may not apply, so the answer says so
        const moved = a.page && a.page !== pageId;
        a.page = pageId;
        const out = await new Promise((resolve) => {
          const timer = setTimeout(
            () => {
              pending.delete(id);
              resolve({
                error: `the studio did not answer within ${Math.round(timeoutFor(tool, b.input) / 1000)} s`,
                hint: 'is the tab in the background or busy? bring it to the front and retry',
              });
            },
            timeoutFor(tool, b.input),
          );
          pending.set(id, { resolve, timer, page: pageId });
          if (!send(page, { type: 'call', id, tool, input: b.input || {}, agent })) {
            clearTimeout(timer);
            pending.delete(id);
            resolve({ error: 'could not reach the studio tab', hint: `reload http://${host}/app/` });
          }
        });
        return json(
          res,
          out.error ? 502 : 200,
          moved && 'result' in out
            ? { ...out, tab: { changed: true, title: String(page.title || '').slice(0, 100) } }
            : out,
        );
      }

      return json(res, 404, { error: `no bridge route ${req.method} /bridge/${route}` });
    } catch (e) {
      return json(res, 400, { error: String((e && e.message) || e) });
    }
  });
}
