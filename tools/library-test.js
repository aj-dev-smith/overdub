// The device library (app/src/devices/library/), device files in and out (app/src/ui/devices-io.js), and the library
// page (app/library.html).
//
//   node tools/library-test.js            the checks
//   WRITE=1 node tools/library-test.js    also re-measure every device on the page (built-ins, showcase, library) and
//                                         write app/src/devices/library/reports.js, the summaries the page shows
//   WRITE=1 ONLY=core.drumkit,... node tools/library-test.js
//                                         re-measure only those (and the library's own checks) and rewrite their
//                                         lines, each dated (`measured`); every other line stays as it was
//
// 1. Every library device passes checkDevice (full) at house levels: instruments -14..-18 LUFS on the test phrase,
//    effects within 1.5 LU of bypass, true peak <= -1 dBTP, tails that die, bit-exact renders; signed by claude,
//    with a request, semantic params and a look; names that collide with nothing else in the studio.
// 2. Export -> import round trip; a failing device is refused with its report; ?new&device=<id> puts it on a track
//    (and the Node renderer can render that song).
// 3. library.html: every face, no page errors, at 1440 and 390 (no sideways scroll), and its ▶ makes sound.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, tally } from './pw.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const t = tally('library');
const WRITE = !!process.env.WRITE;
const ONLY = WRITE && process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()).filter(Boolean) : null;
const pageErrors = (errors) => errors.filter((e) => !/Failed to load resource|favicon/.test(e));

/* ------------------------------------------------------------------------------------------ 1. the devices */
{
  const { page, errors, close } = await open('/app/library.html', { width: 1440, height: 900 });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const res = await page.evaluate(async ({ all, only }) => {
    const reg = await import('/app/src/devices/registry.js');
    const { checkDevice } = await import('/app/src/kernel/check.js');
    const { LIBRARY_DEFS, LIBRARY } = await import('/app/src/devices/library/index.js');
    await import('/app/src/devices/guitar/index.js');
    const { BUILTINS } = await import('/app/src/devices/builtin/index.js');
    const { SHOWCASE } = await import('/app/src/devices/showcase.js');
    let REPORTS = {};
    try { REPORTS = (await import('/app/src/devices/library/reports.js')).REPORTS; } catch (e) { /* none yet */ }
    const shelf = [...BUILTINS, ...SHOWCASE.map((s) => reg.getDevice(s.id)), ...LIBRARY_DEFS];
    const names = new Map();
    for (const d of reg.listDevices()) { const k = d.name.toLowerCase(); names.set(k, (names.get(k) || []).concat(d.id)); }
    const rows = [];
    const missingOnly = only ? only.filter((id) => !shelf.some((d) => d.id === id)) : [];
    for (const d of all ? (only ? shelf.filter((x) => only.includes(x.id) || LIBRARY_DEFS.includes(x)) : shelf) : LIBRARY_DEFS) {
      const r = await checkDevice(d);
      rows.push({ id: d.id, hash: d.hash, kind: d.kind, ok: r.ok, lufs: r.level?.lufs, deltaLU: r.level?.deltaLU, truePeak: r.truePeak, cpu: r.cpu?.pct, tail: r.tail?.seconds, decays: r.tail?.decays, deterministic: r.deterministic, errors: r.errors, warnings: r.warnings, worst: r.extremes?.worstPeak });
    }
    const meta = LIBRARY.map((d) => ({
      id: d.id, kind: d.kind, by: d.by, name: d.name, request: d.request, look: !!d.look && !!d.look.color, blurb: (d.blurb || '').length,
      params: d.params.map((p) => ({ key: p.key, role: !!p.role, desc: !!p.desc, opts: !!p.opts, unit: p.unit, curve: p.curve, min: p.min, max: p.max })),
      collide: names.get(d.name.toLowerCase()).filter((id) => id !== d.id),
    }));
    const stale = shelf.filter((d) => !REPORTS[d.id] || REPORTS[d.id].hash !== d.hash).map((d) => d.id);
    return { rows, meta, stale, shelf: shelf.map((d) => d.id), missingOnly };
  }, { all: WRITE, only: ONLY });

  const lib = new Set(res.meta.map((m) => m.id));
  for (const r of res.rows.filter((x) => lib.has(x.id))) {
    t.note(`${r.id}: ${r.kind === 'effect' ? `${r.deltaLU} LU vs bypass` : `${r.lufs} LUFS`}, ${r.truePeak} dBTP, tail ${r.tail} s, cpu ${r.cpu}%${r.warnings.length ? ' | warn: ' + r.warnings.join(' | ') : ''}`);
    t.ok(r.ok, `${r.id} passes checkDevice${r.ok ? '' : ': ' + r.errors.join(' | ')}`);
    if (r.kind === 'instrument') t.ok(r.lufs >= -18 && r.lufs <= -14, `${r.id} plays the test phrase at ${r.lufs} LUFS (house: -14..-18)`);
    else t.ok(Math.abs(r.deltaLU) <= 1.5, `${r.id} sits ${r.deltaLU} LU from bypass at defaults (within 1.5)`);
    t.ok(r.truePeak <= -1, `${r.id} true peak ${r.truePeak} dBTP <= -1`);
    t.ok(r.decays !== false, `${r.id} tail dies (${r.tail} s)`);
    t.ok(r.deterministic, `${r.id} renders bit-exact twice`);
    t.ok(!r.warnings.length, `${r.id} has no check warnings`);
  }
  const insts = res.meta.filter((m) => m.kind === 'instrument').length, fx = res.meta.filter((m) => m.kind === 'effect').length;
  t.ok(res.meta.length >= 10 && insts >= 4 && fx >= 5, `the library has ${res.meta.length} devices: ${insts} instruments, ${fx} effects`);
  for (const m of res.meta) {
    const ok = m.by === 'claude' && /^claude\.[a-z0-9-]+$/.test(m.id) && m.request && m.request.length > 10 && m.look && m.blurb > 0 && m.blurb <= 60
      && m.params.length >= 3 && m.params.every((p) => p.role && p.desc) && m.params.every((p) => p.opts || p.curve !== 'log' || p.min > 0);
    t.ok(ok, `${m.id} is signed by claude, carries its request, a look and ${m.params.length} params with roles and meanings`);
    t.ok(!m.collide.length, `${m.name} (${m.id}) shares its name with no other device${m.collide.length ? ': ' + m.collide.join(', ') : ''}`);
  }

  if (WRITE) {
    const day = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
    const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
    const line = (r) => ({ hash: r.hash, kind: r.kind, ok: r.ok, lufs: r1(r.lufs), deltaLU: r1(r.deltaLU), truePeak: r1(r.truePeak), cpu: r1(r.cpu), tail: r1(r.tail), warnings: r.warnings.length });
    let entries = res.rows.map((r) => [r.id, line(r)]), measured = day;
    if (ONLY) {
      // only the named devices are re-measured (each line dated); the rest keep their lines and the file keeps its date
      t.ok(!res.missingOnly.length, `ONLY names devices on the shelf${res.missingOnly.length ? ' (not: ' + res.missingOnly.join(', ') + ')' : ''}`);
      const old = await import('../app/src/devices/library/reports.js');
      const fresh = new Map(res.rows.filter((r) => ONLY.includes(r.id)).map((r) => [r.id, { ...line(r), measured: day }]));
      entries = res.shelf.filter((id) => fresh.has(id) || old.REPORTS[id]).map((id) => [id, fresh.get(id) || old.REPORTS[id]]);
      measured = old.MEASURED;
    }
    const lines = entries.map(([id, e]) => `  ${JSON.stringify(id)}: ${JSON.stringify(e)},`);
    const src = `// The device-check summaries the library page (app/library.html) shows, one per device on the shelf. GENERATED by
// \`WRITE=1 node tools/library-test.js\` (kernel/check.js, full mode, in headless Chromium); don't edit by hand. A
// summary counts only while its hash matches the device's kernel (registry def.hash); the page offers a live check
// otherwise. CPU is that machine's render time for 4 s of audio, as a share of real time. MEASURED is the day of the
// last full run; a line with its own \`measured\` was re-measured alone that day (WRITE=1 ONLY=<id,...>).
export const MEASURED = ${JSON.stringify(measured)};
export const REPORTS = {
${lines.join('\n')}
};
`;
    fs.writeFileSync(path.join(HERE, '../app/src/devices/library/reports.js'), src);
    t.note(`wrote app/src/devices/library/reports.js (${ONLY ? 're-measured ' + ONLY.join(', ') + '; ' : ''}${entries.length} devices)`);
  } else {
    // the library's own summaries must be current; a built-in changed by its owner just shows "press Check" on the page
    const staleLib = res.stale.filter((id) => lib.has(id)), staleOther = res.stale.filter((id) => !lib.has(id));
    t.ok(!staleLib.length, `the page's check summaries are current for the library${staleLib.length ? ` (stale: ${staleLib.join(', ')}; run WRITE=1 node tools/library-test.js)` : ''}`);
    if (staleOther.length) t.note(`stale summaries (the page offers a live check; WRITE=1 node tools/library-test.js refreshes them): ${staleOther.join(', ')}`);
  }
  t.ok(!pageErrors(errors).length, 'no page errors while checking ' + pageErrors(errors).join(' | '));
  await close();
}

/* ------------------------------------------------------------------------------------------ 2. files in and out */
{
  const { page, errors, close } = await open('/app/', { query: 'new' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForFunction(() => !!window.overdub?.devicesIO, null, { timeout: 10000 });
  const r = await page.evaluate(async () => {
    const app = window.overdub;
    const io = await import('/app/src/ui/devices-io.js');
    const { SHOWCASE } = await import('/app/src/devices/showcase.js');
    const out = {};
    // a device from elsewhere (the demo song's Firefly) comes in from its file and lands in this song
    const firefly = SHOWCASE.find((d) => d.id === 'claude.firefly');
    const fileText = JSON.stringify(io.toDeviceFile(firefly));
    const before = app.store.history.length;
    const imp = await app.devicesIO.importText(fileText, 'firefly.overdub-device.json');
    const last = app.store.history[app.store.history.length - 1];
    out.import = { ok: imp.ok, reportOk: imp.report?.ok, inSong: !!app.store.get().devices['claude.firefly'], by: last?.by, label: last?.label, steps: app.store.history.length - before, registered: app.devices.getDevice('claude.firefly')?.source };
    // ...and goes back out the same
    const back = app.devicesIO.deviceFile('claude.firefly');
    out.roundtrip = { format: back.format, kernel: back.device.kernel === firefly.kernel, params: JSON.stringify(back.device.params.map((p) => [p.key, p.min, p.max, p.def, p.opts || null])) === JSON.stringify(firefly.params.map((p) => [p.key, p.min, p.max, p.def, p.opts || null])),
      name: back.device.name === firefly.name, request: back.device.request === firefly.request, look: JSON.stringify(back.device.look) === JSON.stringify(firefly.look) };
    // a library device, exported, renamed and imported, can be placed on a track
    const sky = app.devicesIO.deviceFile('claude.skylight');
    sky.device.id = 'you.skylight-copy';
    const imp2 = await app.devicesIO.importDevice(sky, { name: 'copy' });
    const tr = app.store.dispatch([{ type: 'track.add', ref: 't', track: { name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys' } } }, { type: 'insert.add', track: '$t', insert: { device: 'you.skylight-copy' } }], { by: 'you' });
    out.copy = { ok: imp2.ok, placed: tr.ok };
    // the same file twice: nothing new
    const again = await app.devicesIO.importText(fileText, 'firefly again');
    out.again = { ok: again.ok, already: !!again.already };
    // a device that makes NaN is refused, with the report, and nothing changes
    const nan = { format: io.FORMAT, device: { id: 'you.broken', name: 'Broken', kind: 'effect', params: [], kernel: '({ create() { return { process(L, R, n) { for (let i = 0; i < n; i++) { L[i] = 0 / 0; R[i] = L[i]; } } }; } })' } };
    const h0 = app.store.history.length;
    const bad = await app.devicesIO.importText(JSON.stringify(nan), 'broken.overdub-device.json');
    out.refused = { ok: bad.ok, refused: bad.refused, reason: bad.reason, reportOk: bad.report?.ok, errors: bad.report?.errors?.length || 0, nan: bad.report?.nan, inSong: !!app.store.get().devices['you.broken'], registered: !!app.devices.getDevice('you.broken'), steps: app.store.history.length - h0 };
    out.toast = [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' / ');
    // a syntax error is refused too, with its line
    const syn = await app.devicesIO.importText(JSON.stringify({ format: io.FORMAT, device: { id: 'you.typo', name: 'Typo', kind: 'effect', params: [], kernel: '({ create() { return { process(L, R, n) { for (let i = 0; i < n; i++ { } } }; } })' } }), 'typo');
    out.syntax = { refused: syn.refused, reason: syn.reason };
    // a device file is untrusted: importing one never runs its kernel on the page (only in the worklet, which has no
    // DOM and no localStorage), whether the check then refuses it or not
    localStorage.setItem('overdub:probe-secret', 'sk-ant-FAKE');
    delete window.__pwned; delete window.__pwnedGuarded;
    const grab = (name, guard) => `([].constructor.constructor("${guard ? "if (typeof document !== 'undefined') " : ''}window.${name} = { where: typeof document, secret: localStorage.getItem('overdub:probe-secret') }")(), ({ create() { return { process() {} }; } }))`;
    const g1 = await app.devicesIO.importText(JSON.stringify({ format: io.FORMAT, device: { id: 'you.grab', name: 'Grab', kind: 'effect', params: [], kernel: grab('__pwned', false) } }), 'grab.overdub-device.json');
    const g2 = await app.devicesIO.importText(JSON.stringify({ format: io.FORMAT, device: { id: 'you.grab-quiet', name: 'Grab quietly', kind: 'effect', params: [], kernel: grab('__pwnedGuarded', true) } }), 'grab-quiet.overdub-device.json');
    out.grab = { pwned: window.__pwned ?? null, guarded: window.__pwnedGuarded ?? null, refused: !!g1.refused, reason: g1.reason, quietOk: g2.ok };
    localStorage.removeItem('overdub:probe-secret');
    // not a device at all
    const junk = await app.devicesIO.importText('{"hello": 1}', 'junk.json');
    out.junk = { refused: junk.refused, reason: junk.reason };
    // a built-in's id can't be taken over: it comes in as your copy
    const verb = app.devicesIO.deviceFile('core.verb');
    verb.device.kernel = verb.device.kernel.replace('return {', 'return {\n');
    const imp3 = await app.devicesIO.importDevice(verb, { name: 'verb' });
    out.builtin = { ok: imp3.ok, id: imp3.id, coreIntact: app.devices.getDevice('core.verb').source };
    // nor can the house shelf's: the shelf's own file is already here, a different kernel under its id is your copy
    const shelf = app.devicesIO.deviceFile('claude.skylight');
    const same = await app.devicesIO.importDevice(JSON.parse(JSON.stringify(shelf)), { name: 'skylight' });
    shelf.device.kernel = shelf.device.kernel.replace('return {', 'return {\n');
    const other = await app.devicesIO.importDevice(shelf, { name: 'skylight, changed' });
    out.shelf = { already: !!same.already, ok: other.ok, id: other.id, intact: app.devices.getDevice('claude.skylight').source, kernelIntact: app.devices.getDevice('claude.skylight').kernel !== shelf.device.kernel };
    // a kernel past 256 KB is refused before anything compiles it
    const huge = await app.devicesIO.importText(JSON.stringify({ format: io.FORMAT, device: { id: 'you.huge', name: 'Huge', kind: 'effect', params: [], kernel: '/*' + 'a: 1,\n'.repeat(60000) + '*/({ create() { return { process() {} }; } })' } }), 'huge.overdub-device.json');
    out.huge = { refused: huge.refused, reason: huge.reason };
    // a song file can't do it either: its core.keys and claude.skylight open as yours, and the tracks follow
    const song = JSON.parse(JSON.stringify(app.store.get()));
    song.title = 'From a file';
    song.devices['core.keys'] = { id: 'core.keys', name: 'Keys', kind: 'instrument', params: [], kernel: '({ create() { return { process() {} }; } })', by: 'overdub' };
    song.tracks.push({ id: 't_file01', name: 'File keys', kind: 'instrument', instrument: { device: 'core.keys', params: {} }, inserts: [], clips: [], gain: 0, pan: 0 });
    app.exporter.loadText(JSON.stringify(song), 'from-a-file.overdub.json');
    await new Promise((r) => setTimeout(r, 100));
    const p = app.store.get();
    out.file = { title: p.title, ids: Object.keys(p.devices), track: p.tracks.find((t) => t.id === 't_file01')?.instrument.device, core: app.devices.getDevice('core.keys').source };
    // an imported device file is trusted here (the person chose it); the song file's own device isn't, so it's held
    out.trust = { verb: !!app.trust?.trusts?.(p.devices['you.verb']?.kernel), held: (app.trust?.held?.() || []).map((d) => d.id) };
    return out;
  });
  await page.waitForTimeout(900);   // (autosave)
  await page.reload();
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const re = await page.evaluate(() => ({ title: window.overdub.store.get().title, verb: window.overdub.devices.getDevice('you.verb')?.source || null, held: (window.overdub.trust?.held?.() || []).map((d) => d.id), stored: (JSON.parse(localStorage.getItem('overdub:trusted-kernels') || '{}').sha256 || []).length }));
  t.ok(r.trust?.verb && JSON.stringify(r.trust.held) === '["you.keys"]' && re.title === 'From a file' && re.verb === 'project' && JSON.stringify(re.held) === '["you.keys"]' && re.stored >= 2,
    `an imported device file is trusted: after a reload you.verb plays (${re.verb}) while the song file's own you.keys is held (${re.held.join(', ') || 'nothing'}); ${re.stored} kernels stored`);
  t.note(JSON.stringify(r));
  t.ok(r.import.ok && r.import.reportOk && r.import.inSong && r.import.by === 'you' && r.import.steps === 1 && r.import.registered === 'project', `import: Firefly passes the check and becomes a project device in one step signed by you ("${r.import.label}")`);
  t.ok(r.roundtrip.format === 'overdub-device/0' && r.roundtrip.kernel && r.roundtrip.params && r.roundtrip.name && r.roundtrip.request && r.roundtrip.look, 'export after import gives back the same def and kernel (params, name, request, look)');
  t.ok(r.copy.ok && r.copy.placed, 'a library device exported under a new id imports and goes on a track');
  t.ok(r.again.ok && r.again.already, 'importing the same file again changes nothing');
  t.ok(!r.refused.ok && r.refused.refused && r.refused.reportOk === false && r.refused.errors > 0 && r.refused.nan && !r.refused.inSong && !r.refused.registered && r.refused.steps === 0, `a device that makes NaN is refused with its report: "${r.refused.reason}"`);
  t.ok(/Refused Broken/.test(r.toast), 'the refusal is said in a toast');
  t.ok(r.syntax.refused && /compile/.test(r.syntax.reason || ''), `a kernel that doesn't compile is refused: "${r.syntax.reason}"`);
  t.ok(r.grab.pwned === null && r.grab.guarded === null && r.grab.refused, `importing a device file never runs its kernel on the page: no DOM or localStorage reached (the unguarded one is refused: "${r.grab.reason}"; the guarded one ${r.grab.quietOk ? 'imports, inert' : 'is refused'})`);
  t.ok(r.junk.refused, `a file with no device is refused: "${r.junk.reason}"`);
  t.ok(r.builtin.ok && r.builtin.id === 'you.verb' && r.builtin.coreIntact === 'builtin', 'a built-in device file comes in as your copy (you.verb), and core.verb stays built in');
  t.ok(r.shelf.already && r.shelf.ok && r.shelf.id === 'you.claude-skylight' && r.shelf.intact === 'library' && r.shelf.kernelIntact, `a shelf device's own file is "already here"; a changed one comes in as ${r.shelf.id}, and claude.skylight stays the shelf's`);
  t.ok(r.huge.refused && /too large/.test(r.huge.reason || ''), `a kernel past 256 KB is refused: "${r.huge.reason}"`);
  t.ok(r.file.title === 'From a file' && !r.file.ids.includes('core.keys') && r.file.ids.includes('you.keys') && r.file.track === 'you.keys' && r.file.core === 'builtin', `a song file's core.keys opens as you.keys, its track follows, and core.keys stays built in (${r.file.ids.join(', ')})`);
  t.ok(!pageErrors(errors).length, 'no page errors in the studio ' + pageErrors(errors).join(' | '));
  await close();
}

/* ------------------------------------------------------------------------------------------ ?new&device= */
{
  const cases = [['claude.biscuit-tin', 'instrument'], ['claude.say-ahh', 'effect'], ['claude.tidal-cathedral', 'effect']];
  for (const [id, kind] of cases) {
    const { page, errors, close } = await open('/app/', { query: `new&device=${id}` });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await page.waitForFunction(() => (window.overdub?.store.get().tracks || []).some((t) => t.clips.length), null, { timeout: 10000 }).catch(() => {});
    const r = await page.evaluate((id) => {
      const p = window.overdub.store.get();
      const t = p.tracks.find((x) => x.instrument?.device === id || x.inserts.some((f) => f.device === id));
      return { tracks: p.tracks.length, has: !!t, inst: t?.instrument?.device, fx: t?.inserts.map((f) => f.device), clips: t?.clips.length, notes: t?.clips[0]?.notes.length, url: location.search, defined: !!p.devices[id], project: JSON.parse(JSON.stringify(p)) };
    }, id);
    t.ok(r.has && r.tracks === 1 && r.clips === 1 && r.notes > 0, `?new&device=${id}: a new song with one track ${kind === 'instrument' ? 'playing' : 'through'} it, and ${r.notes} notes to hear it with`);
    t.ok(!/device=/.test(r.url), `the ?device param is gone after (a reload keeps the song): "${r.url}"`);
    if (id === 'claude.tidal-cathedral') t.ok(r.defined, 'a showcase device is defined in the new song');
    if (id === 'claude.biscuit-tin') {
      // the canonical renderer knows the library too
      const { renderSong } = await import('../app/src/engine/node/render.js');
      const { lufs } = await import('../app/src/audio/measure.js');
      const out = renderSong(r.project, { from: 0, to: 8, tail: 1 });
      const L = lufs({ sr: out.sr || 48000, channels: out.channels });
      t.ok(L > -40 && !(out.warnings || []).some((w) => /missing|unknown|no device/i.test(w)), `the Node renderer plays that song: ${L.toFixed(1)} LUFS over 2 bars`);
    }
    t.ok(!pageErrors(errors).length, `no page errors (${id}) ` + pageErrors(errors).join(' | '));
    await close();
  }
}

/* ------------------------------------------------------------------------------------------ 3. the page */
for (const [width, height] of [[1440, 900], [390, 844]]) {
  const { page, errors, close, shot } = await open('/app/library.html', { width, height });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.lb-card')];
    const L = window.__library;
    return {
      cards: cards.length, faces: cards.filter((c) => c.querySelector('.lb-face [data-face]')).length, expected: L.ALL.length,
      agentReq: cards.filter((c) => c.dataset.by === 'agent').every((c) => c.querySelector('.lb-req q')?.textContent.length > 10),
      agents: cards.filter((c) => c.dataset.by === 'agent').length,
      stats: cards.filter((c) => c.querySelectorAll('.lb-stats li').length >= 4).length,
      uses: cards.filter((c) => /\?new&device=/.test(c.querySelector('.lb-use')?.getAttribute('href') || '')).length,
      kinds: [...document.querySelectorAll('.lb-sec')].map((s) => s.dataset.kind + ':' + s.querySelectorAll('.lb-card').length),
      sideways: document.documentElement.scrollWidth - window.innerWidth,
      overflowing: cards.filter((c) => c.getBoundingClientRect().right > window.innerWidth + 1).map((c) => c.dataset.id),
    };
  });
  t.note(JSON.stringify(r));
  t.ok(r.cards === r.expected && r.expected >= 29 && r.faces === r.cards, `${width}px: ${r.faces} faces for ${r.expected} devices (${r.kinds.join(', ')})`);
  t.ok(r.agentReq && r.agents >= 13, `${width}px: all ${r.agents} agent-built devices show their request`);
  t.ok(r.stats === r.cards, `${width}px: every card shows its check summary (${r.stats}/${r.cards})`);
  t.ok(r.uses === r.cards, `${width}px: every card links to a new song with it`);
  // liner notes (design/LINER-NOTES-KIT.md): an agent's card is signed once, on its name line, in cool ink; the house
  // is unsigned; no card carries a stripe, a pill or a glow; "Asked for" is a quote, not a tinted callout; the check
  // is a ledger of measure and number
  const ln = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.lb-card')], cs = (e, p) => (e ? getComputedStyle(e, p) : null);
    const agent = cards.filter((c) => c.dataset.by === 'agent'), house = cards.filter((c) => c.dataset.by === 'house');
    return {
      signed: agent.filter((c) => c.querySelectorAll('.by').length === 1 && cs(c.querySelector('.lb-name .by.by-agent'))?.color === 'rgb(76, 195, 255)').length, agents: agent.length,
      unsigned: house.every((c) => !c.querySelector('.by')),
      faceBadges: cards.filter((c) => [...c.querySelectorAll('.ewf-by')].some((b) => b.getClientRects().length)).length,
      edged: cards.filter((c) => { const a = cs(c), b = cs(c, '::before'); return parseFloat(a.borderLeftWidth) > 1 || (b.content !== 'none' && b.content !== 'normal') || a.backgroundColor !== 'rgba(0, 0, 0, 0)'; }).length,
      req: [...document.querySelectorAll('.lb-req')].filter((q) => { const s = cs(q); return parseFloat(s.borderLeftWidth) > 0 || s.backgroundColor !== 'rgba(0, 0, 0, 0)'; }).length,
      pills: [...document.querySelectorAll('.lb-seg, .lb-seg button, .lb-who, .lb-stats li, .lb-btn')].filter((e) => parseFloat(cs(e).borderTopLeftRadius) > 2).length,
      ledger: cards.filter((c) => [...c.querySelectorAll('.lb-stats li')].every((li) => li.querySelector('small') && li.querySelector('span'))).length,
    };
  });
  t.ok(ln.signed === ln.agents && ln.unsigned && !ln.faceBadges, `${width}px: each of the ${ln.agents} agent-built devices is signed once, in cool, on its name line; the house is unsigned (${ln.signed} signed, ${ln.faceBadges} second badges)`);
  t.ok(!ln.edged && !ln.req && !ln.pills, `${width}px: no card, stripe, tinted callout or pill (${ln.edged} edged cards, ${ln.req} boxed requests, ${ln.pills} pills)`);
  t.ok(ln.ledger === r.cards, `${width}px: every check summary is a ledger of measure and number (${ln.ledger}/${r.cards})`);
  t.ok(r.sideways <= 0 && !r.overflowing.length, `${width}px: no sideways scroll (${r.sideways}px${r.overflowing.length ? '; ' + r.overflowing.join(', ') : ''})`);
  // the ▶: an instrument and an effect
  for (const id of width === 1440 ? ['claude.choir-loft', 'claude.charity-shop', 'core.drums'] : ['claude.biscuit-tin']) {
    await page.locator(`.lb-card[data-id="${id}"] .lb-play`).scrollIntoViewIfNeeded();
    await page.click(`.lb-card[data-id="${id}"] .lb-play`);
    await page.waitForFunction((id) => ['playing', 'ready', 'error'].includes(document.querySelector(`.lb-card[data-id="${id}"]`).dataset.state), id, { timeout: 30000 });
    const s = await page.evaluate((id) => { const c = document.querySelector(`.lb-card[data-id="${id}"]`); return { state: c.dataset.state, lufs: +c.dataset.lufs, tp: +c.dataset.tp, hint: c.querySelector('.lb-hint').textContent }; }, id);
    t.ok(s.state === 'playing' && s.lufs > -40 && s.tp < 0, `${width}px: ▶ on ${id} renders and plays it: ${s.lufs} LUFS, ${s.tp} dBTP ("${s.hint}")`);
  }
  // the footswitch of an effect gives the dry signal for A/B
  if (width === 1440) {
    const ab = await page.evaluate(async () => {
      const c = window.__library.cards.find((x) => x.dataset.id === 'claude.say-ahh');
      const M = await import('/app/src/audio/measure.js');
      const wet = await window.__library.renderDemo(c.def, c.vals, true), dry = await window.__library.renderDemo(c.def, c.vals, false);
      const a = M.measure(wet), b = M.measure(dry);
      return { wet: a.centroid, dry: b.centroid, wetL: a.lufs, dryL: b.lufs };
    });
    t.ok(Math.abs(ab.wet - ab.dry) > 50 && Math.abs(ab.wetL - ab.dryL) < 3, `an effect's demo differs from its dry take (centroid ${Math.round(ab.dry)} → ${Math.round(ab.wet)} Hz) at about the same level (${ab.dryL.toFixed(1)} → ${ab.wetL.toFixed(1)} LUFS)`);
  }
  await page.evaluate(() => window.__library.stop());
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(`library-${width}`);
  t.ok(!pageErrors(errors).length, `${width}px: no page errors ` + pageErrors(errors).join(' | '));
  await close();
}

t.done();
