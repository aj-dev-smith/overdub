// Run every check in tools/ (each *-test.js prints ok/FAIL lines and exits 1 on failure) and summarise.
//   node tools/run-all.js            all of them, three at a time
//   node tools/run-all.js core mix   only those whose name contains one of the words
//   node tools/run-all.js round-test.js   a whole file name picks that file alone (not arrange-around-test.js)
//
// These are the integration suites (browsers, servers, renders): run them locally before merging. CI runs the unit
// tests instead (node --test "test/unit/*.test.js").
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const tests = fs.readdirSync(HERE).filter((f) => /-test\.js$/.test(f)).filter((f) => !only.length || only.some((w) => (/-test\.js$/.test(w) ? f === w : f.includes(w)))).sort();
const PAR = Number(process.env.PAR || 3);

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(HERE, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code, signal) => {
      const fails = (out.match(/^\s*FAIL /gm) || []).length, oks = (out.match(/^\s*ok /gm) || []).length;
      resolve({ file, code, signal, oks, fails, secs: ((Date.now() - t0) / 1000).toFixed(1), out });
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
    // a suite that exits non-zero without a FAIL line crashed or was killed: its last lines say how
    if (r.code !== 0 && !r.fails) console.log(`      (exit ${r.code}${r.signal ? ', ' + r.signal : ''}, no FAIL line; its last lines:)\n` + r.out.trimEnd().split('\n').slice(-30).map((l) => '      | ' + l).join('\n'));
  }
}));
const bad = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
// A full run leaves its totals behind, so tools/pages-test.js can hold the quoted counts (deck, launch drafts) to them.
// A run that left suites out (named some) isn't one.
if (!only.length) {
  const oks = results.reduce((s, r) => s + r.oks, 0), fails = results.reduce((s, r) => s + r.fails, 0);
  try {
    fs.mkdirSync(path.join(HERE, '.out'), { recursive: true });
    fs.writeFileSync(path.join(HERE, '.out', 'run-all.json'), JSON.stringify({ at: new Date().toISOString(), suites: results.length, passed: results.length - bad.length, checks: oks + fails, oks, fails }, null, 2) + '\n');
  } catch { /* the totals are a convenience */ }
  console.log(`${oks + fails} checks in ${results.length} suites (${fails} failed)`);
}
process.exitCode = bad.length ? 1 : 0;
