// Run OverdubBench: apply an agent's ops (or take its exported song) to a task's starting song and score it.
//
//   node tools/bench/run.js                                   every task: its oracle and the do-nothing baseline
//   node tools/bench/run.js <task> [ops.json]                 score ops on a task (no file: the do-nothing baseline)
//   node tools/bench/run.js <task> --oracle                   score the task's hand-made solution
//   node tools/bench/run.js <task> --song final.json          score a song exported from the studio (.overdub.json)
//   node tools/bench/run.js <task> --start [--out start.json] write the song the agent is handed (to load in the studio)
//   node tools/bench/run.js --list                            the tasks and their instructions
//   flags: --json (one JSON result per line), --by mcp:<name> (who the ops are signed by)
//
// ops.json: [op, ...] | { ops: [...] } | [{ ops }, ...] (one transaction each) | { calls: [{ tool, input }] } (a log of
// MCP tool calls: apply_ops and define_device are replayed, the rest ignored). Exit code 1 if ops fail to apply.
//
// Scoring runs the submission's kernels (define_device, the song's devices). An ops log or a song from outside the
// checkout is scored under Node's permission model (tools/node-permissions.js: it reads app/, this folder and that file,
// writes nothing, spawns nothing; Node 24's model doesn't cover the network). Only score submissions you'd run as code;
// OVERDUB_TRUST_KERNELS=1 skips it.
import fs from 'node:fs';
import path from 'node:path';
import { loadTask, listTasks, startSong, applyOps, scoreTask, report, HERE } from './score.js';
import { readSong } from '../../app/src/engine/node/io.js';
import { sandboxed } from '../node-permissions.js';

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      o._.push(a);
      continue;
    }
    const k = a.slice(2);
    if (['json', 'oracle', 'list', 'start', 'help'].includes(k)) o[k] = true;
    else o[k] = argv[++i];
  }
  return o;
}
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const oracleFile = (id) => path.join(HERE, 'oracles', id + '.json');

function scoreOne(task, input, o) {
  const start = startSong(task);
  let song;
  if (o.song) song = readSong(path.resolve(o.song));
  else {
    const r = applyOps(start, input, { by: o.by || 'mcp:bench' });
    if (!r.ok) return { error: r.error };
    song = r.song;
  }
  return scoreTask(task, song, { start });
}

function print(res, o, tag = '') {
  if (res.error) {
    console.log(o.json ? JSON.stringify({ error: res.error }) : `${tag}ops failed: ${res.error}`);
    return;
  }
  if (o.json) console.log(JSON.stringify(tag ? { run: tag.trim(), ...res } : res));
  else console.log((tag ? tag : '') + report(res));
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.help) {
    console.log(
      fs
        .readFileSync(new URL(import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('//'))
        .map((l) => l.slice(3))
        .join('\n'),
    );
    return;
  }
  if (o.list) {
    for (const id of listTasks()) {
      const t = loadTask(id);
      console.log(`${id}  [${t.family}]\n  ${t.instruction}\n`);
    }
    return;
  }
  if (!o._.length) {
    const rows = [];
    for (const id of listTasks()) {
      const task = loadTask(id),
        t0 = Date.now();
      const oracle = scoreOne(task, readJSON(oracleFile(id)), o),
        base = scoreOne(task, [], o);
      rows.push({
        id,
        oracle: oracle.error ? NaN : oracle.score,
        baseline: base.error ? NaN : base.score,
        secs: (Date.now() - t0) / 1000,
      });
      if (o.json) console.log(JSON.stringify({ task: id, oracle, baseline: base }));
      else
        console.log(
          `${id.padEnd(28)} oracle ${oracle.error ? 'FAILED ' + oracle.error : oracle.score.toFixed(3)}  baseline ${base.score.toFixed(3)}  ${rows.at(-1).secs.toFixed(1)}s`,
        );
    }
    if (!o.json) {
      const mean = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
      console.log(
        `\n${rows.length} tasks: oracle mean ${mean('oracle').toFixed(3)}, baseline mean ${mean('baseline').toFixed(3)}`,
      );
    }
    return;
  }
  // an agent's ops log or exported song carries its kernels: score it in the sandbox
  if ((o._[1] && !o.oracle && !o.start) || o.song)
    await sandboxed(import.meta.url, { reads: [o._[0], o._[1], o.song] });
  const task = loadTask(o._[0]);
  if (o.start) {
    const song = startSong(task);
    const text = JSON.stringify(song, null, 2);
    if (o.out) {
      fs.writeFileSync(o.out, text + '\n');
      console.log(`wrote ${o.out}: "${song.title}" for ${task.id}\n${task.instruction}`);
    } else console.log(text);
    return;
  }
  const input = o.oracle ? readJSON(oracleFile(task.id)) : o._[1] ? readJSON(o._[1]) : [];
  const res = scoreOne(task, input, o);
  print(res, o);
  if (res.error) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
