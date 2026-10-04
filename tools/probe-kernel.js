// The probe: a kernel effect that outputs its params as DC, so a test can read an automation curve sample by sample
// (docs/research/AUTOMATION.md 3.14). Left is `v` (0..1, linear); right is `f` (20 Hz..20 kHz, log travel) / 20000.
// Its input is ignored. Used by tools/engine-test.js, tools/perf-check.js and the golden scene "automation".
//   import { PROBE } from './probe-kernel.js'; defineDevice(PROBE, { replace: true })
export const PROBE = {
  id: 'test.probe', name: 'Probe', kind: 'effect', cat: 'utility', version: 1,
  params: [
    { key: 'v', label: 'V', min: 0, max: 1, def: 0.5 },
    { key: 'f', label: 'F', min: 20, max: 20000, def: 1000, curve: 'log', unit: 'Hz' },
    { key: 'n', label: 'N', min: 0, max: 4, def: 0, step: 1 },
  ],
  kernel: `({ create() { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] = p.v; R[i] = p.f / 20000; } } }; } })`,
};
// 64 params for the cost check (k0..k63, 0..1): output their sum / 64
export const PROBE64 = {
  id: 'test.probe64', name: 'Probe 64', kind: 'effect', cat: 'utility', version: 1,
  params: Array.from({ length: 64 }, (_, i) => ({ key: 'k' + i, label: 'K' + i, min: 0, max: 1, def: 0.5, curve: i % 2 ? 'lin' : 'lin' })),
  kernel: `({ create() { return { process(L, R, n, p) { let s = 0; for (let k = 0; k < 64; k++) s += p['k' + k]; s /= 64; for (let i = 0; i < n; i++) { L[i] = s; R[i] = s; } } }; } })`,
};
