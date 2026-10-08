// Kernels from outside, run in Node. A song file or an agent's ops log can carry kernel source (project.devices,
// define_device), and the canonical renderer evaluates it in this process: the worklet's shadowed names are not a
// boundary ([].constructor.constructor reaches `process`), and Node has no AudioWorkletGlobalScope to keep it in.
// So the CLIs that render someone else's song (tools/render.js, tools/bench/run.js) run themselves again under Node's
// permission model whenever a file from outside the checkout is named:
//
//   reads    app/ (the engine, the devices and the house shelf), this file, the script itself and, for a runner with a
//            folder of its own (tools/bench/: its scorer, tasks and songs), that folder; and the files named on the
//            command line. Not the rest of the checkout: .git, deploy/, .claude/ and the other tools stay out of reach
//   writes   only the output files named (or defaulted) on the command line
//   never    child processes, worker threads, native addons, WASI, the inspector
//
// Node 24's permission model has no network permission (no --allow-net), so a kernel can still fetch(); but all it
// can read is the code that renders and its own input. OVERDUB_TRUST_KERNELS=1 runs in-process, with your user's
// privileges, for files you'd run as code anyway.
//
//   await sandboxed(import.meta.url, { reads: [file, dir], writes: [out] })   -> returns in the sandboxed process (or
//                                                                                when trusted); exits the parent with
//                                                                                the child's code
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const isSandboxed = () => !!process.permission;

export async function sandboxed(scriptUrl, { reads = [], writes = [] } = {}) {
  if (isSandboxed() || process.env.OVERDUB_TRUST_KERNELS === '1') return;
  if (!process.allowedNodeEnvironmentFlags.has('--permission')) {
    console.error(
      `This Node (${process.version}) has no --permission flag, so a song's kernels would run with your user's privileges. Use Node 22 or later, or set OVERDUB_TRUST_KERNELS=1 for a file you'd run as code.`,
    );
    process.exit(1);
  }
  const abs = (p) => path.resolve(String(p));
  // tools/ itself holds every suite and its output (tools/.out): a script directly in it reads only itself
  const script = fileURLToPath(scriptUrl),
    own = path.dirname(script);
  const code = [
    path.join(REPO, 'app'),
    fileURLToPath(import.meta.url),
    own === path.join(REPO, 'tools') ? script : own,
  ];
  const flags = ['--permission', ...code.map((p) => `--allow-fs-read=${p}`)];
  for (const r of reads.filter(Boolean)) flags.push(`--allow-fs-read=${abs(r)}`);
  for (const w of writes.filter(Boolean)) flags.push(`--allow-fs-write=${abs(w)}`);
  const r = spawnSync(process.execPath, [...flags, script, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (r.error) {
    console.error(`could not start the sandboxed render: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}
