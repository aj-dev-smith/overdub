#!/usr/bin/env node
// A stand-in for `claude -p` (OVERDUB_CLAUDE=tools/fake-claude.js), for tools/mcp-e2e-test.js: it speaks Claude Code's
// stream-json on stdout and drives the studio through the MCP server named in --mcp-config, the way the real one does
// for the Agent panel (server/local-claude.js), without a model. `--version` answers like the real one.
// Each run appends { args, apiKey, prompt } to OVERDUB_FAKE_LOG so the test can see how it was started.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (Claude Code, fake)');
  process.exit(0);
}
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

let prompt = '';
for await (const c of process.stdin) prompt += c;
if (process.env.OVERDUB_FAKE_LOG)
  fs.appendFileSync(
    process.env.OVERDUB_FAKE_LOG,
    JSON.stringify({ args, apiKey: 'ANTHROPIC_API_KEY' in process.env, prompt }) + '\n',
  );

const session = flag('--resume') || randomUUID();
const ev = (event) => out({ type: 'stream_event', event, session_id: session, parent_tool_use_id: null });
const say = (i, text) => {
  ev({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
  ev({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text } });
  ev({ type: 'content_block_stop', index: i });
};

// the MCP server, as configured
const srv = JSON.parse(flag('--mcp-config')).mcpServers.overdub;
const mcp = spawn(srv.command, srv.args, { env: { ...process.env, ...srv.env }, stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map();
let buf = '',
  next = 1;
mcp.stdout.setEncoding('utf8');
mcp.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      const m = JSON.parse(l);
      waiting.get(m.id)?.(m);
    } catch {
      /* not ours */
    }
  }
});
const rpc = (method, params) =>
  new Promise((r) => {
    const id = next++;
    waiting.set(id, r);
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
const tool = async (i, name, input) => {
  ev({
    type: 'content_block_start',
    index: i,
    content_block: { type: 'tool_use', id: 'toolu_' + i, name: 'mcp__overdub__' + name, input: {} },
  });
  ev({ type: 'content_block_stop', index: i });
  const m = await rpc('tools/call', { name, arguments: input });
  return JSON.parse(m.result.content.find((c) => c.type === 'text').text);
};

await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'claude-code', version: '9.9.9' },
});
out({ type: 'system', subtype: 'init', session_id: session, tools: ['mcp__overdub__get_project'] });
ev({ type: 'message_start', message: { usage: { input_tokens: 1 } } });
say(0, 'Reading the song.');
const tempo = Number(/\d{2,3}/.exec(prompt)?.[0]) || 100;
await tool(1, 'get_project', { detail: 'summary' });
const r = await tool(2, 'apply_ops', {
  label: `Tempo ${tempo}`,
  reason: 'asked for it',
  ops: [{ type: 'project.set', patch: { tempo } }],
});
say(3, r.error ? `That didn't go in: ${r.error}` : `Tempo is ${tempo} now.`);
// the plan's windows, as the real one reports them after a request
const soon = Math.floor(Date.now() / 1000) + 3600;
out({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: soon,
    rateLimitType: 'five_hour',
    unifiedWindows: {
      five_hour: { utilization: 0.12, resetsAt: soon },
      seven_day: { utilization: 0.22, resetsAt: soon + 86400 * 3 },
    },
  },
  session_id: session,
});
out({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: session });
mcp.stdin.end();
process.exit(0);
