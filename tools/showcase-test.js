// The showcase devices (app/src/devices/showcase.js): they compile, render without NaN, sit at sane levels, let
// their tails die, and render the same twice. Uses kernel/check.js's checkDevice when it exists; otherwise renders
// them itself through the kernel host on an OfflineAudioContext.
import { open, tally } from './pw.js';

const t = tally('showcase');
const { page, errors, close } = await open('/app/', { query: 'demo' });
await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });

const rows = await page.evaluate(async () => {
  const { SHOWCASE } = await import('/app/src/devices/showcase.js');
  const reg = await import('/app/src/devices/registry.js');
  const host = await import('/app/src/kernel/host.js');
  const M = await import('/app/src/audio/measure.js');
  const T = await import('/app/src/audio/testsignals.js');
  let check = null;
  try { check = (await import('/app/src/kernel/check.js')).checkDevice; } catch { /* not yet */ }
  const out = [];
  for (const src of SHOWCASE) {
    const row = { id: src.id };
    const comp = host.compileKernel(src.kernel, src.kind);
    row.compile = comp.ok ? 'ok' : comp.error;
    if (!comp.ok) { out.push(row); continue; }
    const def = reg.getDevice(src.id) || reg.defineDevice({ ...src, source: 'project' }, { replace: true });
    if (check) {
      try { const rep = await check(def, { quick: true }); row.report = { ok: rep.ok, errors: rep.errors, warnings: rep.warnings, lufs: rep.level?.lufs, deltaLU: rep.level?.deltaLU, truePeak: rep.truePeak, tail: rep.tail, cpu: rep.cpu, deterministic: rep.deterministic }; }
      catch (e) { row.report = { error: String(e && e.message || e) }; }
    }
    // our own render, either way: 6 s of signal, then 4 s (effects) of silence
    const sr = 48000, secs = 10;
    const render = async () => {
      const c = new OfflineAudioContext(2, sr * secs, sr);
      const inst = await reg.instantiate(c, def, { uid: src.id + '-t', seed: 7, params: reg.paramValues(def) });
      await inst.ready;
      inst.set(reg.paramValues(def), { bpm: 92, first: true });
      inst.output.connect(c.destination);
      let dry = null;
      if (def.kind === 'effect') {
        const strum = T.diStrum(6, sr);
        const buf = c.createBuffer(2, strum.length, sr); buf.copyToChannel(strum, 0); buf.copyToChannel(strum, 1);
        const s = c.createBufferSource(); s.buffer = buf; s.connect(inst.input); s.start(0);
        dry = { sr, channels: [strum, strum] };
      } else {
        const notes = [[72, 0], [76, 0.5], [79, 1], [83, 1.5], [84, 2], [79, 2.5], [76, 3], [72, 3.5], [69, 4], [72, 4], [76, 4]];
        for (const [p, at] of notes) { inst.noteOn(p, 0.8, at); inst.noteOff(p, at + 0.4); }
      }
      const b = await c.startRendering();
      inst.dispose?.();
      return { b, dry };
    };
    const a = await render(), b2 = await render();
    const L = a.b.getChannelData(0), R = a.b.getChannelData(1);
    let nan = false, same = true;
    for (let i = 0; i < L.length; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) { nan = true; break; } }
    const L2 = b2.b.getChannelData(0);
    for (let i = 0; i < L.length; i += 7) if (L[i] !== L2[i]) { same = false; break; }
    const m = M.measure(a.b, { to: 6 });
    row.lufs = +m.lufs.toFixed(1); row.truePeak = +m.truePeak.toFixed(1); row.nan = nan; row.deterministic = same;
    if (a.dry) row.dryLufs = +M.lufs({ sr, channels: a.dry.channels }).toFixed(1);
    let tailPeak = 0; for (let i = Math.floor(sr * (secs - 0.5)); i < L.length; i++) tailPeak = Math.max(tailPeak, Math.abs(L[i]));
    row.tailDb = +(20 * Math.log10(tailPeak + 1e-12)).toFixed(1);
    out.push(row);
  }
  return out;
});

for (const r of rows) {
  console.log('  ..   ' + JSON.stringify(r));
  t.ok(r.compile === 'ok', `${r.id} compiles`);
  if (r.compile !== 'ok') continue;
  t.ok(!r.nan, `${r.id} renders without NaN`);
  t.ok(r.deterministic, `${r.id} renders the same twice`);
  t.ok(r.truePeak <= -1, `${r.id} true peak ${r.truePeak} dBTP <= -1`);
  if (r.dryLufs != null) t.ok(Math.abs(r.lufs - r.dryLufs) <= 1.5, `${r.id} level ${r.lufs} LUFS vs dry ${r.dryLufs} (within 1.5 LU)`);
  else t.ok(r.lufs >= -22 && r.lufs <= -12, `${r.id} level ${r.lufs} LUFS (-22..-12)`);
  if (r.report && !r.report.error) t.ok(r.report.ok, `${r.id} passes checkDevice ${r.report.ok ? '' : JSON.stringify(r.report.errors)}`);
}
t.ok(!errors.filter((e) => !/Failed to load resource/.test(e)).length, 'no page errors ' + errors.join(' | '));
await close();
t.done();
