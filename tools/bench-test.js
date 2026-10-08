// Checks for OverdubBench (tools/bench/, docs/BENCH.md): the scorers discriminate and repeat.
//   node tools/bench-test.js
// Every task has a hand-made solution (tools/bench/oracles/<task>.json) that scores at least 0.9, the do-nothing
// baseline scores under 0.5, the near misses (oracles/near-misses/) score under 0.5, a run replayed from an MCP
// tool-call log scores what its ops score, and every score comes out the same twice: fresh renders, fresh random ids.
import fs from 'node:fs';
import path from 'node:path';
import {
  loadTask,
  listTasks,
  startSong,
  applyOps,
  scoreTask,
  transactionsOf,
  CHECK_KINDS,
  HERE,
} from './bench/score.js';
import { tally } from './pw.js';

const T = tally('bench');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const strip = (s) => JSON.stringify({ ...s, checks: s.checks.map(({ label, ...c }) => c) });
const run = (task, input, opts) => {
  const start = startSong(task);
  const r = applyOps(start, input);
  if (!r.ok) return { error: r.error };
  return scoreTask(task, r.song, { start, ...opts });
};

/* ================================================================== the tasks */
const ids = listTasks();
T.ok(ids.length >= 12 && ids.length <= 16, `${ids.length} tasks (12-16)`);
const fams = {};
for (const id of ids) {
  const t = loadTask(id);
  fams[t.family] = (fams[t.family] || 0) + 1;
}
T.ok(
  ['mix', 'writing', 'device', 'editing'].every((f) => fams[f] >= 2),
  `every family has tasks (${Object.entries(fams)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')})`,
);
for (const id of ids) {
  const t = loadTask(id);
  const problems = [];
  if (t.id !== id) problems.push(`id "${t.id}" is not the file name`);
  if (!t.instruction || t.instruction.length < 40) problems.push('no instruction');
  if (!t.checks.some((c) => !c.gate)) problems.push('no scored check');
  const cids = new Set();
  for (const c of t.checks) {
    if (cids.has(c.id)) problems.push(`duplicate check id ${c.id}`);
    cids.add(c.id);
    if (!CHECK_KINDS.includes(c.kind)) problems.push(`unknown kind ${c.kind}`);
    if (!Array.isArray(c.target) || c.target.length !== 2) problems.push(`check ${c.id} has no [lo, hi] target`);
    if (!c.label) problems.push(`check ${c.id} has no label`);
  }
  let song = null;
  try {
    song = startSong(t);
  } catch (e) {
    problems.push(e.message);
  }
  // graph devices can't run in the canonical render: a task may only need kernels
  if (song)
    for (const tr of song.tracks)
      for (const x of [tr.instrument, ...tr.inserts].filter(Boolean))
        if (/^(pedal|amp)\./.test(x.device)) problems.push(`${tr.name} uses graph device ${x.device}`);
  if (!fs.existsSync(path.join(HERE, 'oracles', id + '.json'))) problems.push('no oracle');
  T.ok(
    !problems.length,
    `${id}: well formed, starting song builds, kernel devices only, has an oracle${problems.length ? ' — ' + problems.join('; ') : ''}`,
  );
}

/* ================================================================== oracles, baselines, near misses */
const first = {};
for (const id of ids) {
  const task = loadTask(id);
  const oracle = run(task, read(path.join(HERE, 'oracles', id + '.json')));
  const base = run(task, []);
  first[id] = oracle;
  T.ok(
    !oracle.error && oracle.score >= 0.9,
    `${id}: the oracle scores ${oracle.error ? 'nothing (' + oracle.error + ')' : oracle.score.toFixed(3)} (≥ 0.9)`,
  );
  T.ok(!base.error && base.score < 0.5, `${id}: doing nothing scores ${base.score?.toFixed(3)} (< 0.5)`);
}
const nearDir = path.join(HERE, 'oracles', 'near-misses');
for (const f of fs
  .readdirSync(nearDir)
  .filter((x) => x.endsWith('.json'))
  .sort()) {
  const near = read(path.join(nearDir, f));
  const s = run(loadTask(near.task), near);
  T.ok(!s.error && s.score < 0.5, `near miss ${f}: ${s.score?.toFixed(3)} (< 0.5): ${near.why}`);
}

/* ================================================================== an MCP run, replayed */
{
  const o = read(path.join(HERE, 'oracles', 'device-dotted-echo.json'));
  const calls = {
    calls: [
      { tool: 'get_project', input: { detail: 'full' } },
      { tool: 'define_device', input: { device: o.ops[0].device, use_on: { track: 'Snaps' }, label: 'dotted echo' } },
      { tool: 'render_and_measure', input: { tracks: ['Snaps'] } },
    ],
  };
  T.ok(transactionsOf(calls).length === 1, 'a tool-call log replays apply_ops and define_device and skips the rest');
  const s = run(loadTask('device-dotted-echo'), calls);
  T.ok(
    !s.error && s.score === first['device-dotted-echo'].score,
    `define_device with use_on scores what its ops score (${s.score})`,
  );
  const bad = applyOps(startSong(loadTask('mix-bass-under-kick')), [
    { type: 'track.set', track: 'Nobody', patch: { gain: -3 } },
  ]);
  T.ok(
    !bad.ok && /no track "Nobody"/.test(bad.error),
    `ops that fail are reported, not scored (${bad.error?.slice(0, 60)}…)`,
  );
}

/* ================================================================== a submission's kernels run sandboxed */
// Scoring an ops log runs its kernels in Node. run.js scores a file from outside in a sandbox (tools/node-permissions.js): the
// oracle scores the same there, and a kernel that reaches for `process` to write a file or start a program can't.
{
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overdub-bench-'));
  const runJs = path.join(HERE, 'run.js');
  const score = (file) => {
    const r = spawnSync(process.execPath, [runJs, 'device-rumble-filter', file, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, OVERDUB_TRUST_KERNELS: '' },
    });
    try {
      return JSON.parse(r.stdout.trim().split('\n').pop());
    } catch (e) {
      return { error: (r.stderr || r.stdout || '').slice(0, 200) };
    }
  };
  const o = read(path.join(HERE, 'oracles', 'device-rumble-filter.json'));
  const okFile = path.join(tmp, 'oracle-copy.json');
  fs.writeFileSync(okFile, JSON.stringify(o));
  const fine = score(okFile);
  T.ok(
    !fine.error && fine.score === first['device-rumble-filter'].score,
    `an ops log from outside is scored in the sandbox, and scores what it scores in-process (${fine.score})`,
  );
  const pwned = path.join(tmp, 'pwned.txt'),
    ran = path.join(tmp, 'ran.txt');
  const evil = JSON.parse(JSON.stringify(o));
  const grab =
    `try { [].constructor.constructor("return process")().getBuiltinModule("fs").writeFileSync(${JSON.stringify(pwned)}, "pwned"); } catch (e) {} ` +
    `try { [].constructor.constructor("return process")().getBuiltinModule("child_process").execFileSync("/usr/bin/touch", [${JSON.stringify(ran)}]); } catch (e) {} `;
  evil.ops[0].device.kernel = evil.ops[0].device.kernel.replace(
    'create({ sr, dsp }) {',
    'create({ sr, dsp }) { ' + grab,
  );
  const evilFile = path.join(tmp, 'evil.json');
  fs.writeFileSync(evilFile, JSON.stringify(evil));
  const res = score(evilFile);
  T.ok(
    evil.ops[0].device.kernel.includes('getBuiltinModule') &&
      !fs.existsSync(pwned) &&
      !fs.existsSync(ran) &&
      !res.error,
    `a kernel that tries to write a file and start a program does neither (scored ${res.score?.toFixed?.(3)})`,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ================================================================== a rendered song's kernels read only what rendering needs */
// `node tools/render.js their-song.json` ran the song's kernels with the whole checkout readable: .git, deploy/,
// .claude/ and the rest. Now the sandbox reads app/, the script and the song. The kernel says what it could read on
// stderr; app/ is the control (it ran, and what rendering needs is still there).
{
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const REPO = path.resolve(HERE, '../..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overdub-render-'));
  const git = path.join(REPO, '.git');
  const outside = [
    fs.existsSync(git) && fs.statSync(git).isDirectory() ? path.join(git, 'HEAD') : git,
    path.join(REPO, 'CLAUDE.md'),
    path.join(REPO, 'deploy/deploy.sh'),
    path.join(REPO, 'tools/golden.json'),
  ].filter((f) => fs.existsSync(f));
  const inside = path.join(REPO, 'app/index.html');
  const kernel = `({ create() { const P = [].constructor.constructor("return process")(), fs = P.getBuiltinModule("fs"); for (const f of ${JSON.stringify([...outside, inside])}) { let r; try { r = "read " + fs.readFileSync(f).length; } catch (e) { r = "denied " + (e.code || e.name); } P.stderr.write("probe " + f + " " + r + "\\n"); } return { voice() { return { start() {}, release() {}, render() { return false; } }; } }; } })`;
  const song = {
    title: 'Reach',
    tempo: 120,
    meter: [4, 4],
    sections: [],
    master: { inserts: [] },
    devices: {
      'guest.reach': { id: 'guest.reach', name: 'Reach', kind: 'instrument', by: 'guest:x', params: [], kernel },
    },
    tracks: [
      {
        id: 't1',
        name: 'Reach',
        kind: 'instrument',
        instrument: { device: 'guest.reach', params: {} },
        inserts: [],
        clips: [{ id: 'c1', start: 0, length: 4, notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8 }] }],
      },
    ],
  };
  const file = path.join(tmp, 'their-song.json');
  fs.writeFileSync(file, JSON.stringify(song));
  const r = spawnSync(
    process.execPath,
    [path.join(REPO, 'tools/render.js'), file, '--to', '4', '--tail', '0.1', '--json'],
    { encoding: 'utf8', env: { ...process.env, OVERDUB_TRUST_KERNELS: '' } },
  );
  const said = Object.fromEntries(
    (r.stderr || '')
      .split('\n')
      .filter((l) => l.startsWith('probe '))
      .map((l) => {
        const m = /^probe (.+) (read \d+|denied \S+)$/.exec(l);
        return m ? [m[1], m[2]] : [l, '?'];
      }),
  );
  const leaked = outside.filter((f) => !/^denied/.test(said[f] || ''));
  T.ok(
    r.status === 0 &&
      fs.existsSync(path.join(tmp, 'their-song.wav')) &&
      /^read/.test(said[inside] || '') &&
      outside.length >= 3 &&
      !leaked.length,
    `a kernel in a rendered song reads app/ (${said[inside] || 'never ran'}) and none of ${outside.map((f) => path.relative(REPO, f)).join(', ')}${leaked.length ? `; it read ${leaked.map((f) => path.relative(REPO, f)).join(', ')}` : ''} (exit ${r.status})`,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ================================================================== determinism */
let same = 0,
  differ = [];
for (const id of ids) {
  const again = run(loadTask(id), read(path.join(HERE, 'oracles', id + '.json')), { cache: false });
  if (strip(again) === strip(first[id])) same++;
  else differ.push(id);
}
T.ok(
  same === ids.length,
  `every oracle scores the same twice, check by check, with fresh renders and fresh ids (${same}/${ids.length}${differ.length ? '; differ: ' + differ.join(', ') : ''})`,
);

T.done();
