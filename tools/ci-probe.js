// TEMPORARY (CI diagnosis): how long checkDevice takes for the heaviest devices, with the studio drawing beside it or not.
//   STILL=1 node tools/ci-probe.js   on a still page of the same origin instead of the studio
import { open } from './pw.js';

const { page, close, base } = await open('/app/');
if (process.env.STILL) await page.goto(base + '/app/src/kernel/check.js');
else await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
const fps = await page.evaluate(() => new Promise((res) => { const t0 = performance.now(); let n = 0; const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
console.log(`${process.env.STILL ? 'still page' : 'studio'} ${process.env.CHROMIUM_ARGS || ''}: ${fps} fps`);
if (process.env.FPS_ONLY !== '0') { await close(); process.exit(0); }
for (const id of ['core.wavetable', 'core.shaper', 'core.poly']) {
  const r = await page.evaluate(async (id) => {
    const { getDevice } = await import('/app/src/devices/registry.js');
    await import('/app/src/devices/builtin/index.js');
    const { checkDevice } = await import('/app/src/kernel/check.js');
    const rep = await checkDevice(getDevice(id), { timeout: 300000 });
    return { id, ms: rep.ms, ok: rep.ok };
  }, id);
  console.log('  ' + JSON.stringify(r));
}
await close();
