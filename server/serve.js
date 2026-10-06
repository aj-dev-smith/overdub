// Overdub's local server: the landing page at /, the studio at /app/, and (later) the agent bridge at /bridge/*.
// Zero dependencies. `node server/serve.js` (PORT=3279 by default: E-A-R-W on a phone keypad).
// Tests import startServer() and listen on port 0 so parallel runs never collide.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'video/webm',
  '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

// Routes other modules can add (the agent bridge registers /bridge/* here). handler(req, res, url) returns true if it
// handled the request.
const routes = [];
export function addRoute(prefix, handler) { routes.push({ prefix, handler }); }

// DNS rebinding: a site can point its own name at this machine and then read what this server sends as its own. Only a
// request made to an address (localhost, or an IP) is served, never one made to another name (server/bridge.js too).
const ADDRESS = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

export function resolvePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/site/index.html';
  else if (p === '/llms.txt') p = '/site/llms.txt';
  else if (p === '/app' || p === '/app/') p = '/app/index.html';
  else if (!path.extname(p) && !p.endsWith('/')) {
    // /site/foo -> /site/foo/index.html when it is a directory
    const dir = path.join(ROOT, p);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) p += '/index.html';
  } else if (p.endsWith('/')) p += 'index.html';
  const abs = path.normalize(path.join(ROOT, p));
  // no escaping the repo (a sibling folder whose name begins with the repo's is outside it too), and nothing under a
  // dot name: .git, .claude and tools/.out are the checkout's, not the site's
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  if (path.relative(ROOT, abs).split(path.sep).some((s) => s.startsWith('.'))) return null;
  return abs;
}

// A single "bytes=a-b" range (or "a-", or "-n" for the last n bytes) → [start, end] inclusive; null when there is no
// usable Range header (serve the whole file, as RFC 9110 allows for multiple ranges); false when it can't be satisfied.
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { const n = Number(m[2]); if (!n) return false; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return false;
  return [start, end];
}

export function startServer({ port = Number(process.env.PORT) || 3279, host = '127.0.0.1', quiet = false } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (!ADDRESS.test(String(req.headers.host || ''))) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        return res.end('forbidden: ask for localhost');
      }
      const url = new URL(req.url, 'http://localhost');
      for (const r of routes) if (url.pathname.startsWith(r.prefix) && (await r.handler(req, res, url))) return;
      const abs = resolvePath(url.pathname);
      if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found: ' + url.pathname);
      }
      const size = fs.statSync(abs).size;
      // (no CORS header: another site never reads what this server sends; it was '*', which let any page read the
      // checkout while the server ran)
      const head = {
        'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      };
      // Range requests (206): Safari won't play a <video> from a server that can't answer them.
      const range = byteRange(req.headers.range, size);
      if (range === false) {
        res.writeHead(416, { ...head, 'content-range': `bytes */${size}` });
        return res.end();
      }
      const [start, end] = range || [0, size - 1];
      res.writeHead(range ? 206 : 200, {
        ...head,
        'content-length': String(Math.max(0, end - start + 1)),
        ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
      });
      if (req.method === 'HEAD' || size === 0) return res.end();
      fs.createReadStream(abs, { start, end }).pipe(res);
    } catch (e) {
      // the stack goes to this terminal, not to whoever asked
      console.error('overdub: ' + String(e && e.stack || e));
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('server error');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const { port: p } = server.address();
      if (!quiet) console.log(`overdub: http://localhost:${p}/  (studio: http://localhost:${p}/app/)`);
      resolve({ server, port: p, url: `http://localhost:${p}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// Optional extras register themselves here when present (the agent bridge, Claude Code behind the panel). Missing files are fine.
async function loadExtras() {
  for (const f of ['bridge.js', 'local-claude.js']) {
    const abs = path.join(path.dirname(fileURLToPath(import.meta.url)), f);
    if (fs.existsSync(abs)) {
      try { const m = await import(pathToFileURL(abs).href); if (m.register) m.register({ addRoute }); } catch (e) { console.error('overdub: could not load', f, e); }
    }
  }
}
export const ready = loadExtras();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ready.then(() => startServer());
}
