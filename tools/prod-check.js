// Production smoke check: the live site serves, the studio boots, the demo song renders through the real engine,
// and nothing errors. Not part of run-all (it needs the network): node tools/prod-check.js [base-url]
import { openUrl, tally } from './pw.js';

const BASE = process.argv[2] || 'https://overdub.ajsmithhq.com';
const t = tally('prod');

for (const [route, type] of [['/', 'text/html'], ['/app/', 'text/html'], ['/app/src/main.js', 'text/javascript'], ['/llms.txt', 'text/plain'], ['/docs/AGENTS.md', 'text/markdown'], ['/app', null]]) {
  const r = await fetch(BASE + route, { redirect: 'manual' });
  if (type) t.ok(r.status === 200 && (r.headers.get('content-type') || '').startsWith(type), `${route} → ${r.status} ${r.headers.get('content-type')}`);
  else t.ok(r.status === 301 && r.headers.get('location') === '/app/', `${route} redirects to /app/ (${r.status} ${r.headers.get('location')})`);
}
const head = await fetch(BASE + '/', { method: 'HEAD' });
t.ok(/max-age=\d+/.test(head.headers.get('strict-transport-security') || ''), 'HSTS on');

{
  const { page, errors, close } = await openUrl(BASE + '/');
  await page.waitForTimeout(1500);
  const title = await page.title();
  t.ok(/overdub/i.test(title), `landing title: ${title}`);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  t.ok(sw <= 0, `landing: no horizontal scroll (${sw})`);
  t.ok(!errors.length, 'landing: no console errors ' + errors.slice(0, 3).join(' | '));
  await close();
}
{
  const { page, errors, close } = await openUrl(BASE + '/app/?demo&autostart');
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const app = window.overdub;
    const M = await import('./src/audio/measure.js');
    const buf = await app.engine.render({ from: 0, to: 32 });
    const m = M.measure(buf);
    const missing = [];
    for (const tr of app.store.get().tracks) {
      if (tr.instrument && !app.devices.getDevice(tr.instrument.device)) missing.push(tr.instrument.device);
      for (const fx of tr.inserts) if (!app.devices.getDevice(fx.device)) missing.push(fx.device);
    }
    return { lufs: +m.lufs.toFixed(1), tp: +m.truePeak.toFixed(1), missing, devices: app.devices.listDevices().length };
  });
  t.ok(r.missing.length === 0 && r.devices > 140, `studio: ${r.devices} devices, every device in the demo resolves ${r.missing.join(' ')}`);
  t.ok(r.lufs > -13 && r.lufs < -8 && r.tp <= -1, `studio: the demo renders at ${r.lufs} LUFS, ${r.tp} dBTP`);
  const real = errors.filter((e) => !/\/bridge\//.test(e));
  t.ok(!real.length, 'studio: no console errors (the local-only MCP bridge excepted) ' + real.slice(0, 3).join(' | '));
  await close();
}
t.done();
