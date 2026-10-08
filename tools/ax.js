// AX dogfood harness: be the agent. Starts the studio on its own server (free port), opens it headless at /app/?demo
// so the tab connects to the local bridge, and lets you call tools exactly as an outside agent would.
//
//   node tools/ax.js up                      # start; prints the base URL, writes tools/.out/ax.json, runs until killed
//   node tools/ax.js call <tool> ['<json>']  # POST /bridge/call { tool, input, agent: 'dogfood' }; prints the reply
//   node tools/ax.js tools                   # GET /bridge/tools (names + description lengths)
//   node tools/ax.js human '<js>'            # the HUMAN's side: evaluate in the tab (to click what a person would)
//   node tools/ax.js shot [name]             # screenshot what the human sees -> tools/.out/<name>.png
//   node tools/ax.js down                    # stop a running harness
import fs from 'node:fs';
import path from 'node:path';
import { open, OUTDIR } from './pw.js';

const STATE = path.join(OUTDIR, 'ax.json');
const [cmd, ...rest] = process.argv.slice(2);

async function up() {
  const h = await open('/app/', { query: 'demo' });
  // wait for the page to say hello and connect its event stream
  for (let i = 0; i < 100; i++) {
    const s = await (await fetch(h.base + '/bridge/status')).json();
    if (s.pages > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  fs.writeFileSync(STATE, JSON.stringify({ base: h.base, pid: process.pid }));
  console.log('ax: up at ' + h.base + ' (pid ' + process.pid + ')');
  h.page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('page ' + m.type() + ': ' + m.text());
  });
  const stop = async () => {
    try {
      fs.unlinkSync(STATE);
    } catch {
      /* gone */
    }
    await h.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // the human's side (only for driving what a person would click; the agent side never uses it): a request file
  // tools/.out/ax-human.req holds { js } or { shot }; the answer lands in ax-human.res
  const REQ = path.join(OUTDIR, 'ax-human.req'),
    RES = path.join(OUTDIR, 'ax-human.res');
  setInterval(async () => {
    if (!fs.existsSync(REQ)) return;
    const q = JSON.parse(fs.readFileSync(REQ, 'utf8'));
    fs.unlinkSync(REQ);
    let out;
    try {
      if (q.shot) {
        await h.page.screenshot({ path: path.join(OUTDIR, q.shot + '.png') });
        out = { saved: path.join(OUTDIR, q.shot + '.png') };
      } else out = { value: await h.page.evaluate(q.js) };
    } catch (e) {
      out = { error: String((e && e.message) || e) };
    }
    fs.writeFileSync(RES, JSON.stringify(out));
  }, 200);
}

async function human(q) {
  const REQ = path.join(OUTDIR, 'ax-human.req'),
    RES = path.join(OUTDIR, 'ax-human.res');
  try {
    fs.unlinkSync(RES);
  } catch {
    /* none */
  }
  fs.writeFileSync(REQ, JSON.stringify(q));
  for (let i = 0; i < 300; i++) {
    if (fs.existsSync(RES)) {
      const r = fs.readFileSync(RES, 'utf8');
      fs.unlinkSync(RES);
      return console.log(r);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('no answer from the page');
}

function base() {
  return JSON.parse(fs.readFileSync(STATE, 'utf8')).base;
}

async function call(tool, json) {
  const input = json ? JSON.parse(json) : {};
  const t0 = Date.now();
  const r = await fetch(base() + '/bridge/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, input, agent: 'dogfood' }),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  let img = null;
  if (data?.result?.image) {
    img = path.join(OUTDIR, 'ax-' + tool + '-' + Date.now() + '.png');
    fs.writeFileSync(img, Buffer.from(data.result.image.split(',')[1], 'base64'));
    data.result.image = '<saved ' + img + '>';
  }
  // what an MCP client would see: server/mcp.js stringifies with indent 1
  const shown = JSON.stringify(data?.result ?? data, null, 1);
  console.log(`[HTTP ${r.status}, ${Date.now() - t0} ms, ${shown.length} chars as MCP text]`);
  console.log(shown);
}

if (cmd === 'up') await up();
else if (cmd === 'call') await call(rest[0], rest[1]);
else if (cmd === 'human') await human({ js: rest[0] });
else if (cmd === 'shot') await human({ shot: rest[0] || 'ax-shot' });
else if (cmd === 'tools') {
  const j = await (await fetch(base() + '/bridge/tools')).json();
  console.log('source:', j.source, 'count:', j.tools.length);
  for (const t of j.tools)
    console.log(`${t.name} (${t.description.length} + ${JSON.stringify(t.input_schema).length} chars)`);
} else if (cmd === 'down') {
  try {
    const { pid } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    process.kill(pid, 'SIGTERM');
    console.log('ax: stopped ' + pid);
  } catch {
    console.log('ax: not running');
  }
} else console.log('usage: node tools/ax.js up | call <tool> [json] | tools | down');
