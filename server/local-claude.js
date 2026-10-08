// Claude Code behind the Agent panel: the panel's own chat, answered by `claude -p` on this machine, signed in with the
// person's Claude plan (no API key in the browser, no API bill). The tab sends a turn here; this runs Claude Code
// headless with only the studio's tools (server/mcp.js, pointed back at this server's bridge) and streams its events
// back. The tools still run in the tab, through the bridge, signed 'claude' like the in-app agent's own calls.
//
//   GET  /local/status -> { available, version, key }   is `claude` on this machine's PATH? is a key set (below)?
//   POST /local/turn { page, text, model, system, session? }   -> NDJSON: { type: 'turn', token } first, then Claude
//        Code's stream-json events as they come, then { type: 'exit', code, stderr? }. Closing the request (Stop in
//        the panel) kills the process.
//
// The turn token goes to mcp.js (OVERDUB_TURN) and rides on each of its bridge calls; the tab signs a call 'claude'
// only when the token is the one of the turn it is running. Claude Code's built-in tools (Bash, Read, Edit…) are off
// and only the overdub MCP server is loaded: the song's text reaches the model, and the model reaches only the studio.
// ANTHROPIC_API_KEY is dropped from the child's environment so it uses the plan login, never a key that happens to be
// set in the shell.
//
// A self-hoster's own API key, on the server: start it with OVERDUB_ANTHROPIC_KEY=sk-ant-… and the panel's in-app
// agent posts its Messages API requests here, and this adds the key and passes them on. The key never reaches the
// page (the studio keeps no key of its own: docs/SECURITY.md). It is its own variable, not ANTHROPIC_API_KEY, so a key
// that happens to be set in the shell is never spent unasked. The server binds to 127.0.0.1; put it on a public
// address and anyone who reaches it spends your key.
//
//   POST /local/messages { …a Messages API body }  -> the API's answer, streamed through as it comes

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { foreignHost, foreignOrigin, foreignSite } from './bridge.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const claude = () => process.env.OVERDUB_CLAUDE || 'claude'; // read late, so a test can set it after importing
// Claude Code keeps its sessions by working directory: one of its own, so the studio's never mix with a project's
const CWD = path.join(os.tmpdir(), 'overdub-claude-code');
const MODEL = /^claude-[a-z0-9.-]{1,60}$/;
const SESSION = /^[0-9a-f-]{36}$/i;

// read late, like claude(), so a test can set them after importing
const apiKey = () => String(process.env.OVERDUB_ANTHROPIC_KEY || '').trim();
const apiUrl = () => process.env.OVERDUB_ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages';
const BETA = /^[a-z0-9-]+(,[a-z0-9-]+)*$/;

let probe = null;
export function claudeStatus() {
  if (probe) return probe;
  try {
    const r = spawnSync(claude(), ['--version'], { encoding: 'utf8', timeout: 8000 });
    probe =
      r.status === 0
        ? {
            available: true,
            version: String(r.stdout || '')
              .trim()
              .split(/\s/)[0],
          }
        : { available: false };
  } catch (e) {
    probe = { available: false };
  }
  return probe;
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
  return true;
}
function readBody(req, limit = 2 * 1024 * 1024) {
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
      } catch (e) {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function turnArgs({ model, system, session, mcpConfig }) {
  const args = [
    '-p',
    '--input-format',
    'text',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfig,
    '--allowedTools',
    'mcp__overdub',
    '--permission-mode',
    'dontAsk',
    '--effort',
    'medium',
  ];
  if (model) args.push('--model', model);
  if (system) args.push('--system-prompt', system);
  if (session) args.push('--resume', session);
  return args;
}

export function register({ addRoute }) {
  addRoute('/local/', async (req, res, url) => {
    if (foreignHost(req) || foreignOrigin(req) || foreignSite(req))
      return json(res, 403, { error: 'Claude Code only answers the studio on this machine' });
    const route = url.pathname.slice('/local/'.length);
    if (route === 'status' && req.method === 'GET') return json(res, 200, { ...claudeStatus(), key: !!apiKey() });
    if (route === 'messages' && req.method === 'POST') return messages(req, res);
    if (route !== 'turn' || req.method !== 'POST')
      return json(res, 404, { error: `no route ${req.method} /local/${route}` });

    let b;
    try {
      b = await readBody(req);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
    if (!claudeStatus().available)
      return json(res, 503, { error: 'Claude Code is not installed on this computer (no `claude` on the PATH).' });
    const text = String(b.text || '').trim();
    const page = String(b.page || '');
    if (!text) return json(res, 400, { error: 'text is required' });
    if (!page) return json(res, 400, { error: 'page is required (the studio tab says hello to the bridge first)' });
    const model = MODEL.test(String(b.model || '')) ? b.model : '';
    const session = SESSION.test(String(b.session || '')) ? b.session : '';
    const system = typeof b.system === 'string' ? b.system.slice(0, 200000) : '';

    const token = randomUUID();
    const port = req.socket.localPort;
    const mcpConfig = JSON.stringify({
      mcpServers: {
        overdub: {
          command: process.execPath,
          args: [path.join(HERE, 'mcp.js')],
          env: {
            OVERDUB_URL: `http://localhost:${port}`,
            OVERDUB_TURN: token,
            OVERDUB_PAGE: page,
            OVERDUB_NO_OPEN: '1',
          },
        },
      },
    });
    const env = { ...process.env, MCP_TOOL_TIMEOUT: String(15 * 60 * 1000) };
    delete env.ANTHROPIC_API_KEY;
    delete env.OVERDUB_ANTHROPIC_KEY; // the self-hoster's key is for /local/messages only; Claude Code runs on the plan login
    delete env.OVERDUB_ANTHROPIC_URL;
    fs.mkdirSync(CWD, { recursive: true });

    let child;
    try {
      child = spawn(claude(), turnArgs({ model, system, session, mcpConfig }), {
        cwd: CWD,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return json(res, 500, { error: 'could not start Claude Code: ' + e.message });
    }
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });
    const line = (obj) => {
      try {
        res.write(JSON.stringify(obj) + '\n');
      } catch (e) {
        /* gone */
      }
    };
    line({ type: 'turn', token });

    let out = '',
      err = '',
      done = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      out += c;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const l = out.slice(0, i).trim();
        out = out.slice(i + 1);
        if (l.startsWith('{')) {
          try {
            res.write(l + '\n');
          } catch (e) {
            /* gone */
          }
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      err = (err + c).slice(-4000);
    });
    const finish = (code) => {
      if (done) return;
      done = true;
      line({ type: 'exit', code, ...(code ? { stderr: err.trim().slice(-1500) } : {}) });
      res.end();
    };
    child.on('error', (e) => {
      err += e.message;
      finish(127);
    });
    child.on('close', (code) => finish(code ?? 0));
    // Stop in the panel aborts the fetch: the request closes before the turn is over, and the process goes with it
    res.on('close', () => {
      if (!done) {
        done = true;
        child.kill('SIGTERM');
      }
    });
    child.stdin.end(text);
    return true;
  });
}

// The in-app agent's request, with the server's key added (see the top). Only the API's own headers go on; the answer
// streams back as it comes, and closing the request (Stop in the panel) aborts it.
async function messages(req, res) {
  const key = apiKey();
  if (!key)
    return json(res, 503, {
      error: {
        type: 'no_key',
        message: 'No API key on this server: start it with OVERDUB_ANTHROPIC_KEY set (the guide says how).',
      },
    });
  let b;
  try {
    b = await readBody(req, 24 * 1024 * 1024);
  } catch (e) {
    return json(res, 400, { error: { type: 'invalid_request_error', message: e.message } });
  }
  if (!MODEL.test(String(b.model || '')))
    return json(res, 400, { error: { type: 'invalid_request_error', message: 'model is required' } });
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  const beta = String(req.headers['anthropic-beta'] || '');
  if (beta && BETA.test(beta)) headers['anthropic-beta'] = beta;
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let up;
  try {
    up = await fetch(apiUrl(), { method: 'POST', headers, body: JSON.stringify(b), signal: ac.signal });
  } catch (e) {
    if (ac.signal.aborted) return true;
    return json(res, 502, {
      error: { type: 'api_error', message: 'Could not reach the Messages API from this server: ' + e.message },
    });
  }
  const head = {
    'content-type': up.headers.get('content-type') || 'application/json',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  };
  const ra = up.headers.get('retry-after');
  if (ra) head['retry-after'] = ra;
  res.writeHead(up.status, head);
  try {
    if (up.body) for await (const c of up.body) res.write(c);
  } catch (e) {
    /* stopped, or the API went away mid-stream */
  }
  res.end();
  return true;
}
