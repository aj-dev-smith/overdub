#!/usr/bin/env node
// Checks the integrations the way a client would use them: `node integrations/check.js`.
//
//  1. The plugin manifests parse, and every path they name exists (with ${CLAUDE_PLUGIN_ROOT} resolved the way
//     Claude Code resolves it: the repo root for the marketplace entry, integrations/claude-code for --plugin-dir).
//  2. The skill has frontmatter Claude Code accepts (name, description within the 1,536-character budget).
//  3. Every ```json snippet in integrations/README.md parses, and every MCP server it configures (with
//     /path/to/overdub replaced by this repo) answers initialize + tools/list over stdio with the full tool catalog, and
//     answers a tools/call with the "no studio tab" error and its hint while no studio is open.
//
// The servers run on a private port (OVERDUB_PORT=3297) with OVERDUB_NO_OPEN=1, so nothing opens a browser and a
// studio you have open on :3279 is untouched. Prints ok/FAIL per check and exits 1 on any failure.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = process.env.CHECK_PORT || '3297';
// the full catalog an MCP client sees before a studio tab connects (the static tools + the page-registered ones)
const TOOL_COUNT = (await (await import('../app/src/agent/tools.js')).catalogSchemas()).length;
let fails = 0,
  passes = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) passes++;
  else fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}${extra ? ' (' + extra + ')' : ''}`);
  return cond;
};
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// ---------------------------------------------------------------------------------------------- manifests
const pluginDir = path.join(HERE, 'claude-code');
const plugin = readJSON(path.join(pluginDir, '.claude-plugin/plugin.json'));
ok(plugin.name === 'overdub', 'plugin.json: name is "overdub"');
// biome-ignore lint/suspicious/noTemplateCurlyInString: the plugin manifest's literal placeholder
const pdArgs = plugin.mcpServers?.overdub?.args?.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir)) || [];
ok(
  pdArgs.length && fs.existsSync(pdArgs[0]),
  'plugin.json: the MCP server path resolves from integrations/claude-code',
  pdArgs[0] && path.relative(ROOT, pdArgs[0]),
);
ok(
  fs.existsSync(path.join(pluginDir, 'skills/overdub/SKILL.md')),
  'plugin.json: skills/overdub/SKILL.md is in the default skills/ folder',
);

// The marketplace file lives at <repo>/.claude-plugin/marketplace.json once moved; until then, at its staging copy.
const mpPaths = [
  path.join(ROOT, '.claude-plugin/marketplace.json'),
  path.join(HERE, 'repo-root/.claude-plugin/marketplace.json'),
];
const mpFile = mpPaths.find((f) => fs.existsSync(f));
const mp = readJSON(mpFile);
ok(true, `marketplace.json parses`, path.relative(ROOT, mpFile));
const entry = mp.plugins.find((p) => p.name === 'overdub');
ok(entry && (entry.source === './' || entry.source === '.'), 'marketplace entry "overdub": source is the repo root');
for (const s of [].concat(entry.skills || []))
  ok(
    fs.existsSync(path.join(ROOT, s, 'overdub/SKILL.md')),
    `marketplace entry: skills path ${s} holds overdub/SKILL.md`,
  );
// biome-ignore lint/suspicious/noTemplateCurlyInString: the plugin manifest's literal placeholder
const mpArgs = entry.mcpServers?.overdub?.args?.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT)) || [];
ok(
  mpArgs.length && fs.existsSync(mpArgs[0]),
  'marketplace entry: the MCP server path resolves from the repo root',
  mpArgs[0] && path.relative(ROOT, mpArgs[0]),
);
ok(
  !fs.existsSync(path.join(ROOT, '.claude-plugin/plugin.json')),
  "no root plugin.json (it would override the entry's mcpServers)",
);

// ---------------------------------------------------------------------------------------------- skill
const skill = fs.readFileSync(path.join(pluginDir, 'skills/overdub/SKILL.md'), 'utf8');
const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
ok(!!fm, 'SKILL.md: frontmatter is on the first line');
const field = (k) => {
  const m = new RegExp(`^${k}: (.*)$`, 'm').exec(fm?.[1] || '');
  return m ? m[1].replace(/^'(.*)'$/, '$1') : '';
};
ok(field('name') === 'overdub', 'SKILL.md: name is "overdub"');
const budget = (field('description') + field('when_to_use')).length;
ok(
  budget > 0 && budget <= 1536,
  'SKILL.md: description + when_to_use fit the 1,536-character budget',
  `${budget} chars`,
);
const allowed = field('allowed-tools').split(/\s+/).filter(Boolean);
ok(
  allowed.every((t) => /^mcp__(overdub|plugin_overdub_overdub)__[a-z_]+$/.test(t)),
  'SKILL.md: allowed-tools only name Overdub tools, in both naming forms',
);

// ---------------------------------------------------------------------------------------------- README snippets
const readme = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
const servers = [];
blocks.forEach((b, i) => {
  let j;
  try {
    j = JSON.parse(b);
  } catch (e) {
    return ok(false, `README json block ${i + 1} parses`, e.message);
  }
  ok(true, `README json block ${i + 1} parses`);
  const map = j.mcpServers || j.servers || (j.command ? { inline: j } : null);
  for (const [name, cfg] of Object.entries(map || {}))
    if (cfg.command) servers.push({ where: `README json block ${i + 1} (${name})`, cfg });
});
ok(servers.length >= 3, "README configures the server in at least three clients' formats", `${servers.length} found`);

// ---------------------------------------------------------------------------------------------- stdio
function probe(command, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(command, args, {
      env: { ...process.env, ...env, OVERDUB_NO_OPEN: '1', OVERDUB_PORT: PORT, OVERDUB_OPEN_WAIT: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const res = {};
    const waiters = new Map();
    let buf = '';
    const kill = setTimeout(() => {
      p.kill();
      resolve({ ...res, timeout: true });
    }, 30000);
    p.on('error', (e) => {
      clearTimeout(kill);
      resolve({ spawnError: e.message });
    });
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (l.trim()) {
          try {
            const m = JSON.parse(l);
            waiters.get(m.id)?.(m);
          } catch {
            res.badLine = l.slice(0, 120);
          }
        }
      }
    });
    const call = (id, method, params) =>
      new Promise((r) => {
        waiters.set(id, r);
        p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    (async () => {
      res.init = await call(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'overdub-integrations-check', version: '1' },
      });
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      res.list = await call(2, 'tools/list', {});
      res.call = await call(3, 'tools/call', { name: 'get_selection', arguments: {} });
      p.stdin.end();
      p.on('exit', (code) => {
        clearTimeout(kill);
        resolve({ ...res, code });
      });
    })();
  });
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: the plugin manifest's literal placeholder
const sub = (s) => String(s).replaceAll('/path/to/overdub', ROOT).replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT);
const runs = [
  {
    where: 'marketplace entry (CLAUDE_PLUGIN_ROOT = repo root)',
    command: entry.mcpServers.overdub.command,
    args: mpArgs,
  },
  {
    where: 'plugin.json (--plugin-dir integrations/claude-code)',
    command: plugin.mcpServers.overdub.command,
    args: pdArgs,
  },
  ...servers.map((s) => ({
    where: s.where,
    command: sub(s.cfg.command),
    args: (s.cfg.args || []).map(sub),
    env: Object.fromEntries(
      Object.entries(s.cfg.env || {}).filter(([k]) => k !== 'OVERDUB_PORT' && k !== 'OVERDUB_URL'),
    ),
  })),
];
for (const r of runs) {
  const res = await probe(r.command, r.args, r.env);
  if (
    !ok(
      !res.spawnError && !res.timeout && res.init?.result,
      `${r.where}: initialize`,
      res.spawnError || (res.timeout ? 'timed out' : res.init?.result?.serverInfo?.title),
    )
  )
    continue;
  const names = res.list?.result?.tools?.map((t) => t.name) || [];
  ok(names.length === TOOL_COUNT, `${r.where}: tools/list returns ${TOOL_COUNT} tools`, `${names.length}`);
  const text = res.call?.result?.content?.[0]?.text || '';
  ok(
    res.call?.result?.isError && /No Overdub studio tab is connected/.test(text) && text.includes(`:${PORT}/app/`),
    `${r.where}: with no studio open, a tool call says so and names the URL to open`,
  );
  ok(!res.badLine, `${r.where}: stdout carries only JSON-RPC`, res.badLine);
  ok(res.code === 0, `${r.where}: exits cleanly when stdin closes`, `code ${res.code}`);
}

console.log(`\n${passes} ok, ${fails} failed`);
process.exit(fails ? 1 : 0);
