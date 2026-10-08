// Run every check in tools/ (each *-test.js prints ok/FAIL lines and exits 1 on failure) and summarise.
//   node tools/run-all.js            all of them, three at a time
//   node tools/run-all.js core mix   only those whose name contains one of the words
//   node tools/run-all.js round-test.js   a whole file name picks that file alone (not arrange-around-test.js)
//   LOCAL_ONLY=skip node tools/run-all.js   leaves out the suites tagged local-only (CI sets it; .github/workflows/ci.yml)
//
// A suite that only runs on a Mac says so in its header comment, one line: `// local-only: <why>`. Run on its own or
// by run-all, it runs as ever; under LOCAL_ONLY=skip, run-all prints it and its reason and runs the rest.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const tests = fs.readdirSync(HERE).filter((f) => /-test\.js$/.test(f)).filter((f) => !only.length || only.some((w) => (/-test\.js$/.test(w) ? f === w : f.includes(w)))).sort();
const PAR = Number(process.env.PAR || 3);

// The local-only line is read from the header: the comment lines the file starts with.
const localOnly = (f) => {
  const head = fs.readFileSync(path.join(HERE, f), 'utf8').match(/^(?:\/\/.*\n)*/)[0];
  const m = head.match(/^\/\/ local-only: (.+)$/m);
  return m && m[1].trim();
};
if (process.env.LOCAL_ONLY && process.env.LOCAL_ONLY !== 'skip') throw new Error(`LOCAL_ONLY=${process.env.LOCAL_ONLY}: the one setting is LOCAL_ONLY=skip`);
const skipped = process.env.LOCAL_ONLY === 'skip' ? tests.filter(localOnly).map((file) => ({ file, why: localOnly(file) })) : [];
for (const s of skipped) {
  console.log(`SKIP  ${s.file.padEnd(24)} local-only: ${s.why}`);
  tests.splice(tests.indexOf(s.file), 1);
}

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(HERE, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => {
      const fails = (out.match(/^\s*FAIL /gm) || []).length, oks = (out.match(/^\s*ok /gm) || []).length;
      resolve({ file, code, oks, fails, secs: ((Date.now() - t0) / 1000).toFixed(1), out });
    });
  });
}

const results = [];
const queue = tests.slice();
await Promise.all(Array.from({ length: Math.min(PAR, queue.length) }, async () => {
  while (queue.length) {
    const f = queue.shift();
    const r = await run(f);
    results.push(r);
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${f.padEnd(24)} ${String(r.oks).padStart(4)} ok ${String(r.fails).padStart(3)} failed  ${r.secs}s`);
    if (r.code !== 0) console.log(r.out.split('\n').filter((l) => /FAIL|Error|error/.test(l)).slice(0, 12).map((l) => '      ' + l).join('\n'));
  }
}));
const bad = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
if (skipped.length) console.log(`${skipped.length} local-only suites skipped (LOCAL_ONLY=skip): ${skipped.map((s) => s.file).join(', ')}`);
// A full run leaves its totals behind, so tools/pages-test.js can hold the quoted counts (deck, launch drafts) to them.
// A run that left suites out (named some, or skipped the local-only ones) isn't one.
if (!only.length && !skipped.length) {
  const oks = results.reduce((s, r) => s + r.oks, 0), fails = results.reduce((s, r) => s + r.fails, 0);
  try {
    fs.mkdirSync(path.join(HERE, '.out'), { recursive: true });
    fs.writeFileSync(path.join(HERE, '.out', 'run-all.json'), JSON.stringify({ at: new Date().toISOString(), suites: results.length, passed: results.length - bad.length, checks: oks + fails, oks, fails }, null, 2) + '\n');
  } catch (e) { /* the totals are a convenience */ }
  console.log(`${oks + fails} checks in ${results.length} suites (${fails} failed)`);
}
process.exitCode = bad.length ? 1 : 0;
