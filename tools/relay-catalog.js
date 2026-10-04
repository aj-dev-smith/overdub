// Write server/relay-catalog.json: the tools the hosted relay lists to claude.ai and the only names it will pass on to
// a studio tab (server/relay.js, docs/REMOTE-MCP.md). The relay never takes a tool list from a tab, so this file is the
// whole of what claude.ai sees. It is the studio's own catalog, generated, never edited by hand: tools.js's
// catalogSchemas() (the static tools plus the ones page modules register at boot, whose schemas are in
// agent/extra-schemas.js), as { name, description, input_schema, annotations }, in that order. Every tool needs its
// annotations (a title and readOnlyHint, destructiveHint, idempotentHint, openWorldHint: claude.ai decides what to ask
// the person before a call by them): a tool without them is named, with where to add them, and nothing is written.
//
//   node tools/relay-catalog.js            write server/relay-catalog.json
//   node tools/relay-catalog.js --check    write nothing; exit 1 if it is missing or out of date
//
// Re-run it after changing a tool's name, description, schema or annotations in app/src/agent/ (tools/relay-test.js
// runs --check, so a stale catalog fails the checks, and deploy/relay/deploy.sh won't ship one). Same catalog in, same
// bytes out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'server/relay-catalog.json');

export async function catalogText() {
  const { catalogSchemas, annotationGaps } = await import('../app/src/agent/tools.js');
  const extra = await import('../app/src/agent/extra-schemas.js');
  const all = await catalogSchemas();
  const gaps = annotationGaps(all, extra);
  if (gaps.length) throw Object.assign(new Error(`${gaps.length === 1 ? 'a tool has' : `${gaps.length} tools have`} no annotations yet, so the relay can't list ${gaps.length === 1 ? 'it' : 'them'}:\n  ${gaps.join('\n  ')}`), { gaps });
  const list = all.map(({ name, description, input_schema, annotations }) => ({ name, description, input_schema, annotations }));
  return JSON.stringify(list, null, 1) + '\n';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let want;
  try { want = await catalogText(); } catch (e) {
    if (!e.gaps) throw e;
    console.log(`relay-catalog: ${e.message}`);
    process.exit(1);
  }
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  const n = JSON.parse(want).length;
  if (process.argv.includes('--check')) {
    if (have === want) console.log(`relay-catalog: server/relay-catalog.json is up to date (${n} tools)`);
    else {
      const old = have ? JSON.parse(have).map((t) => t.name) : [], now = JSON.parse(want).map((t) => t.name);
      const added = now.filter((x) => !old.includes(x)), gone = old.filter((x) => !now.includes(x));
      console.log(`relay-catalog: server/relay-catalog.json is ${have === null ? 'missing' : 'out of date'}${added.length ? `; new: ${added.join(', ')}` : ''}${gone.length ? `; gone: ${gone.join(', ')}` : ''}${have && !added.length && !gone.length ? '; a description, schema or annotation changed' : ''}: run node tools/relay-catalog.js`);
      process.exitCode = 1;
    }
  } else if (have === want) console.log(`  same  server/relay-catalog.json (${n} tools)`);
  else { fs.writeFileSync(OUT, want); console.log(`  wrote server/relay-catalog.json (${n} tools, ${(want.length / 1024).toFixed(1)} KB)`); }
}
