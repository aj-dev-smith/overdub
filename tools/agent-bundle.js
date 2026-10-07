// The in-app agent's prompt bundle, for Claude on Overdub credits: the service owns the system prompt and the tools
// and takes them by version, so each studio release that changes either is exported here and imported there
// (overdub-cloud: node bin/admin.js import-prompt <file>) before the studio that uses it is deployed.
//
//   node tools/agent-bundle.js [out.json]      -> { version, source, system, tools } (stdout without a file)
//
// It reads them from a running studio, not from Node: the tool list depends on which page modules registered tools at
// boot. The canonical form and the version are agent/cloud.js's (canonicalBundle, bundleVersion), the same the page
// sends when it opens an ask. The browser runs muted (tools/pw.js QUIET).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open } from './pw.js';

// in an open studio page: the bundle, and the version the page itself would send
export async function bundleFrom(page) {
  return page.evaluate(async () => {
    const { buildSystemPrompt } = await import('/app/src/agent/prompt.js');
    const { canonicalBundle, bundleVersion } = await import('/app/src/agent/cloud.js');
    const { IN_APP_DESCRIPTIONS } = await import('/app/src/agent/tools.js');
    const tools = window.overdub.tools.schemas().map((t) => ({ ...t, description: IN_APP_DESCRIPTIONS[t.name] || t.description }));
    const b = canonicalBundle(await buildSystemPrompt({ name: 'Claude' }), tools);
    return { version: await bundleVersion(b), pageVersion: await window.overdub.agent.promptVersion(), ...b };
  });
}

export async function exportBundle() {
  const { page, close } = await open('/app/');
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const { pageVersion, ...b } = await bundleFrom(page);
    let sha = 'unknown';
    try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (e) { /* not a checkout */ }
    let branch = '';
    try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (e) { /* not a checkout */ }
    return { version: b.version, source: `overdub@${sha}${branch ? ` (${branch})` : ''}`, system: b.system, tools: b.tools, pageVersion };
  } finally { await close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { pageVersion, ...out } = await exportBundle();
  if (pageVersion !== out.version) { console.error(`the page computes ${pageVersion}, the export ${out.version}: they must match`); process.exit(1); }
  const json = JSON.stringify(out, null, 2) + '\n';
  if (process.argv[2]) { fs.writeFileSync(process.argv[2], json); console.error(`${out.version}: ${out.tools.length} tools, ${out.system.length} chars of system prompt -> ${process.argv[2]}`); }
  else process.stdout.write(json);
}
