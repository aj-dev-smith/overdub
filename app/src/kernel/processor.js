// @ts-check
// The kernel worklet's module. kernel/host.js (ensureKernelWorklet) loads this file into each audio context's
// AudioWorkletGlobalScope, where it registers the one processor that hosts every kernel ('overdub-kernel'). Like every
// worklet module the studio loads, it is a file on the page's own origin: the pages' policy refuses data: and blob:
// scripts (app/index.html says why). It runs the very code the Node renderer imports, the dsp stdlib (dsp.js) and
// kernelCompiler and KernelCore (worklet.js), so a kernel renders the same on either side.
import { overdubDsp } from './dsp.js';
import { overdubKernelWorklet, kernelCompiler, kernelCore } from './worklet.js';

overdubKernelWorklet(overdubDsp, kernelCompiler, kernelCore);
