// Claude Code behind the Agent panel: the panel's own chat, answered by `claude -p` on this machine, signed in with the
// person's Claude plan (no API key in the browser, no API bill). The tab sends a turn here; this runs Claude Code
// headless with only the studio's tools (server/mcp.js, pointed back at this server's bridge) and streams its events
// back. The tools still run in the tab, through the bridge, signed 'claude' like the in-app agent's own calls.
//
//   GET  /local/status -> { available, version }        is `claude` on this machine's PATH?
//   POST /local/turn { page, text, model, system, session? }   -> NDJSON: { type: 'turn', token } first, then Claude
//        Code's stream-json events as they come, then { type: 'exit', code, stderr? }. Closing the request (Stop in
//        the panel) kills the process.
//
// The turn token goes to mcp.js (OVERDUB_TURN) and rides on each of its bridge calls; the tab signs a call 'claude'
// only when the token is the one of the turn it is running. Claude Code's built-in tools (Bash, Read, Edit…) are off
// and only the overdub MCP server is loaded: the song's text reaches the model, and the model reaches only the studio.
// ANTHROPIC_API_KEY is dropped from the child's environment so it uses the plan login, never a key that happens to be
// set in the shell.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { foreignHost, foreignOrigin, foreignSite } from './bridge.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const claude = () => process.env.OVERDUB_CLAUDE || 'claude';   // read late, so a test can set it after importing
// Claude Code keeps its sessions by working directory: one of its own, so the studio's never mix with a project's
const CWD = path.join(os.tmpdir(), 'overdub-claude-code');
const MODEL = /^claude-[a-z0-9.-]{1,60}$/;
const SESSION = /^[0-9a-f-]{36}$/i;

let probe = null;
export function claudeStatus() {
  if (probe) return probe;
  try {
    const r = spawnSync(claude(), ['--version'], { encoding: 'utf8', timeout: 8000 });
    probe = r.status === 0 ? { available: true, version: String(r.stdout || '').trim().split(/\s/)[0] } : { available: false };
  } catch (e) { probe = { available: false }; }
  return probe;
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
  return true;
}
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { const s = Buffer.concat(parts).toString('utf8'); resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new Error('body is not JSON')); } });
    req.on('error', reject);
  });
}

export function turnArgs({ model, system, session, mcpConfig }) {
  const args = ['-p', '--input-format', 'text', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', mcpConfig,
    '--allowedTools', 'mcp__overdub', '--permission-mode', 'dontAsk', '--effort', 'medium'];
  if (model) args.push('--model', model);
  if (system) args.push('--system-prompt', system);
  if (session) args.push('--resume', session);
  return args;
}

export function register({ addRoute }) {
  addRoute('/local/', async (req, res, url) => {
    if (foreignHost(req) || foreignOrigin(req) || foreignSite(req)) return json(res, 403, { error: 'Claude Code only answers the studio on this machine' });
    const route = url.pathname.slice('/local/'.length);
    if (route === 'status' && req.method === 'GET') return json(res, 200, claudeStatus());
    if (route !== 'turn' || req.method !== 'POST') return json(res, 404, { error: `no route ${req.method} /local/${route}` });

    let b;
    try { b = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    if (!claudeStatus().available) return json(res, 503, { error: 'Claude Code is not installed on this computer (no `claude` on the PATH).' });
    const text = String(b.text || '').trim();
    const page = String(b.page || '');
    if (!text) return json(res, 400, { error: 'text is required' });
    if (!page) return json(res, 400, { error: 'page is required (the studio tab says hello to the bridge first)' });
    const model = MODEL.test(String(b.model || '')) ? b.model : '';
    const session = SESSION.test(String(b.session || '')) ? b.session : '';
    const system = typeof b.system === 'string' ? b.system.slice(0, 200000) : '';

    const token = randomUUID();
    const port = req.socket.localPort;
    const mcpConfig = JSON.stringify({ mcpServers: { overdub: { command: process.execPath, args: [path.join(HERE, 'mcp.js')],
      env: { OVERDUB_URL: `http://localhost:${port}`, OVERDUB_TURN: token, OVERDUB_PAGE: page, OVERDUB_NO_OPEN: '1' } } } });
    const env = { ...process.env, MCP_TOOL_TIMEOUT: String(15 * 60 * 1000) };
    delete env.ANTHROPIC_API_KEY;
    fs.mkdirSync(CWD, { recursive: true });

    let child;
    try { child = spawn(claude(), turnArgs({ model, system, session, mcpConfig }), { cwd: CWD, env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) {
      return json(res, 500, { error: 'could not start Claude Code: ' + e.message });
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    const line = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch (e) { /* gone */ } };
    line({ type: 'turn', token });

    let out = '', err = '', done = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      out += c;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const l = out.slice(0, i).trim(); out = out.slice(i + 1);
        if (l.startsWith('{')) { try { res.write(l + '\n'); } catch (e) { /* gone */ } }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { err = (err + c).slice(-4000); });
    const finish = (code) => {
      if (done) return; done = true;
      line({ type: 'exit', code, ...(code ? { stderr: err.trim().slice(-1500) } : {}) });
      res.end();
    };
    child.on('error', (e) => { err += e.message; finish(127); });
    child.on('close', (code) => finish(code ?? 0));
    // Stop in the panel aborts the fetch: the request closes before the turn is over, and the process goes with it
    res.on('close', () => { if (!done) { done = true; child.kill('SIGTERM'); } });
    child.stdin.end(text);
    return true;
  });
}
