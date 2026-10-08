// The demo song end to end: every device it names resolves, it renders offline through the real engine, and the
// mix lands where a finished demo should (measured, not guessed). Also per-track levels, so a mix change is visible.
import { open, tally } from './pw.js';

const t = tally('song');
const { page, errors, close } = await open('/app/', { query: 'demo&autostart' });
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
const r = await page.evaluate(async () => {
  const app = window.overdub;
  const p = app.store.get();
  const missing = [];
  for (const tr of p.tracks) {
    if (tr.instrument && !app.devices.getDevice(tr.instrument.device)) missing.push(tr.instrument.device);
    for (const fx of tr.inserts) if (!app.devices.getDevice(fx.device)) missing.push(fx.device);
  }
  const M = await import('/app/src/audio/measure.js');
  const t0 = performance.now();
  const buf = await app.engine.render({ from: 0, to: 32 });
  const ms = performance.now() - t0;
  const mix = M.measure(buf);
  const tracks = {};
  for (const tr of p.tracks) {
    if (!tr.clips.length) continue;
    const b = await app.engine.render({ from: 0, to: 32, tracks: [tr.id] });
    const m = M.measure(b);
    tracks[tr.name] = { lufs: +m.lufs.toFixed(1), tp: +m.truePeak.toFixed(1) };
  }
  return {
    missing,
    secs: buf.duration,
    ms: Math.round(ms),
    lufs: +mix.lufs.toFixed(1),
    tp: +mix.truePeak.toFixed(1),
    lra: +(mix.lra ?? 0).toFixed(1),
    bands: mix.bands,
    key: mix.key,
    tracks,
  };
});
console.log('  ..   ' + JSON.stringify(r));
t.ok(r.missing.length === 0, 'every device in the demo resolves ' + r.missing.join(', '));
t.ok(r.secs > 20, `renders ${r.secs.toFixed(1)} s in ${r.ms} ms`);
t.ok(r.lufs >= -12 && r.lufs <= -9.5, `the mix is ${r.lufs} LUFS (-12..-9.5)`);
for (const [name, m] of Object.entries(r.tracks))
  if (name !== 'Fireflies') t.ok(m.lufs >= -19 && m.lufs <= -13, `${name} sits at ${m.lufs} LUFS (-19..-13)`);
t.ok(r.tp <= -1, `true peak ${r.tp} dBTP <= -1`);
// A minor and C major share every note; either reading (or its alternative) is right
const keys = [r.key, r.key && r.key.alt].filter(Boolean).map((k) => k.root + ' ' + k.scale);
t.ok(
  keys.some((k) => k === 'A minor' || k === 'C major'),
  `key reads ${keys.join(' / ')}`,
);
t.ok(
  !errors.filter((e) => !/Failed to load resource/.test(e)).length,
  'no page errors ' + errors.slice(0, 3).join(' | '),
);
await close();
t.done();
