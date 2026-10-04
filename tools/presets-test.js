// The preset menu [ui-mix] (app/src/ui/rack.js; presetOf in app/src/devices/registry.js; get_project's presets).
// Real clicks and keys: a face with presets has a line under its caption naming the preset it's on; a click opens the
// short list (the current one in reverse print); a pick is one instrument.set (or insert.set) with the whole sound, one
// undo step; a knob moved off it reads "edited", and picking it again goes back; undo walks the names back; the
// keyboard opens, moves and picks; an agent applying get_device's params lands on the same name, and get_project says
// the name the rack shows; an effect with presets gets the same line. The kit: no stripes, no pills, no glow.
//   node tools/presets-test.js      (screenshots: tools/.out/presets-menu.png, presets-edited.png)
import { open, tally } from './pw.js';

const T = tally('presets');
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g/.test(e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await open('/app/', { query: 'demo' });
const { page, errors, close, shot } = s;
const E = (fn, a) => page.evaluate(fn, a);
const run = (name, input, by = 'claude') => E(([n, i, b]) => window.overdub.tools.run(n, i, { by: b }), [name, input, by]);
try {
  await E(() => { localStorage.setItem('overdub:welcomed', '1'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(400);

  // the Keys track plays Baby Grand, shown in the Devices tab
  const keys = await E(() => {
    const o = window.overdub, t = o.store.get().tracks.find((x) => x.name === 'Keys');
    o.store.dispatch({ type: 'instrument.set', track: t.id, device: 'core.piano' }, { by: 'you', label: 'piano' });
    o.ui.select({ track: t.id, clip: null, insert: null }); o.ui.show('rack');
    return t.id;
  });
  await page.waitForSelector('.rk-inst .rk-pre', { timeout: 5000 });
  await sleep(200);
  const line = () => E(() => { const b = document.querySelector('.rk-inst .rk-pre'); return b ? { text: b.textContent.trim(), preset: b.dataset.preset, edited: b.dataset.edited === '1', expanded: b.getAttribute('aria-expanded'), label: b.getAttribute('aria-label') } : null; });
  const params = () => E((id) => ({ ...window.overdub.store.get().tracks.find((t) => t.id === id).instrument.params }), keys);
  const hist = () => E(() => window.overdub.store.history.length);
  const presetNames = await E(() => window.overdub.devices.getDevice('core.piano').presets.map((p) => p.name));

  let L = await line();
  T.ok(L && L.preset === 'Concert' && !L.edited && /^Concert/.test(L.text), `a fresh Baby Grand's face says it's on Concert, its defaults ("${L?.text}")`);
  T.ok(await E(() => /^Preset/.test(document.querySelector('.rk-inst .rk-preline')?.textContent || '')), 'the line reads "Preset" then the name, under the caption');
  T.ok(/Baby Grand preset: Concert/.test(L.label || ''), `the button says what it is to a screen reader ("${L.label}")`);

  /* ---- a click opens the short list: every preset, in the device's order, the current one in reverse print */
  await page.click('.rk-inst .rk-pre');
  await page.waitForSelector('.rk-presets', { timeout: 3000 });
  let menu = await E(() => {
    const rows = [...document.querySelectorAll('.rk-presets .rk-pi')];
    const sel = rows.filter((r) => r.classList.contains('sel-print'));
    const cs = sel[0] ? getComputedStyle(sel[0]) : null;
    return { names: rows.map((r) => r.dataset.preset), sel: sel.map((r) => r.dataset.preset), checked: rows.filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.dataset.preset), focus: document.activeElement?.dataset?.preset || null, bg: cs?.backgroundColor, text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(), role: document.querySelector('.rk-presets')?.getAttribute('role') };
  });
  T.ok(JSON.stringify(menu.names) === JSON.stringify(presetNames), `the list is the device's presets, in order (${menu.names.join(', ')})`);
  T.ok(menu.sel.length === 1 && menu.sel[0] === 'Concert' && menu.checked.join() === 'Concert', `the current one is in reverse print and checked (${menu.sel.join()})`);
  T.ok(menu.focus === 'Concert', `focus lands on the current one (${menu.focus})`);
  T.ok(menu.role === 'menu' && (await line()).expanded === 'true', 'it is a menu and the button says it is open');
  await shot('presets-menu');

  /* ---- pick Felt: the whole sound in one step */
  const h0 = await hist();
  await page.click('.rk-presets .rk-pi[data-preset="Felt"]');
  await sleep(250);
  const felt = await E(() => window.overdub.devices.getDevice('core.piano').presets.find((p) => p.name === 'Felt').params);
  let P = await params();
  T.ok(Object.keys(felt).every((k) => P[k] === felt[k]), `Felt is on: every param is the preset's (tone ${P.tone}, hammer ${P.hammer}, room ${P.room})`);
  T.ok((await hist()) === h0 + 1, `one pick is one undo step (${h0} -> ${await hist()})`);
  T.ok(await E(() => /Felt/.test(window.overdub.store.history.at(-1)?.label || '') && window.overdub.store.history.at(-1)?.by === 'you'), 'signed by you, labelled with the preset');
  L = await line();
  T.ok(L.preset === 'Felt' && !L.edited && !(await E(() => !!document.querySelector('.rk-presets'))), `the list closes and the face says Felt ("${L.text}")`);
  T.ok(await E(() => /Keys: Baby Grand, Felt/.test(document.querySelector('.ew-toast, [class*="toast"]')?.textContent || '')), 'the toast says what changed, with Undo');
  const fx = await E(() => document.querySelector('.rk-inst [data-key="tone"] .kn-dial')?.getAttribute('aria-valuenow'));
  T.ok(Math.abs(+fx - felt.tone) < 1e-6, `the face's knobs moved with it (tone dial at ${fx})`);

  /* ---- turn a knob: "Felt, edited"; pick Felt again to go back */
  const dial = await page.$('.rk-inst [data-key="tone"] .kn-dial');
  const bb = await dial.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  await sleep(250);
  P = await params();
  L = await line();
  T.ok(P.tone > felt.tone && L.preset === 'Felt' && L.edited && /Felt, edited/.test(L.text), `a knob turned off it reads "${L.text}" (tone ${felt.tone} -> ${P.tone.toFixed(3)})`);
  T.ok(/Felt, edited/.test(L.label), 'and says so to a screen reader');
  await shot('presets-edited');
  await page.click('.rk-inst .rk-pre');
  await page.waitForSelector('.rk-presets');
  menu = await E(() => { const r = document.querySelector('.rk-presets .rk-pi.sel-print'); return { sel: r?.dataset.preset, note: r?.querySelector('small')?.textContent || '', checked: r?.getAttribute('aria-checked') }; });
  T.ok(menu.sel === 'Felt' && /edited/.test(menu.note) && menu.checked === 'false', `the list marks Felt as edited ("${menu.note}")`);
  const h1 = await hist();
  await page.click('.rk-presets .rk-pi[data-preset="Felt"]');
  await sleep(200);
  P = await params();
  L = await line();
  T.ok(P.tone === felt.tone && L.preset === 'Felt' && !L.edited && (await hist()) === h1 + 1, `picking it again puts Felt back exactly, one step (tone ${P.tone})`);

  /* ---- undo walks it back, a name at a time */
  await E(() => window.overdub.store.undo());
  await sleep(120);
  L = await line();
  T.ok(L.preset === 'Felt' && L.edited, `undo: back to the turned knob, "${L.text}"`);
  await E(() => window.overdub.store.undo());
  await sleep(120);
  L = await line();
  T.ok(L.preset === 'Felt' && !L.edited, `undo: Felt as picked ("${L.text}")`);
  await E(() => window.overdub.store.undo());
  await sleep(120);
  L = await line();
  P = await params();
  T.ok(L.preset === 'Concert' && !L.edited && P.tone === undefined, `undo: the pick is gone and it reads Concert again ("${L.text}", tone stored: ${P.tone})`);
  await E(() => window.overdub.store.redo());
  await sleep(120);
  L = await line();
  T.ok(L.preset === 'Felt' && !L.edited, `redo: Felt again ("${L.text}")`);

  /* ---- the keyboard: Enter opens, arrows move, Enter picks, Escape closes back to the button */
  await page.focus('.rk-inst .rk-pre');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.rk-presets');
  T.ok(await E(() => document.activeElement?.dataset?.preset === 'Felt'), 'Enter opens it, on Felt');
  await page.keyboard.press('ArrowDown');
  const next = await E(() => document.activeElement?.dataset?.preset);
  await page.keyboard.press('Enter');
  await sleep(200);
  L = await line();
  T.ok(next === presetNames[presetNames.indexOf('Felt') + 1] && L.preset === next, `ArrowDown then Enter picks the next one (${next})`);
  await page.focus('.rk-inst .rk-pre');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.rk-presets');
  await page.keyboard.press('End');
  T.ok(await E((n) => document.activeElement?.dataset?.preset === n, presetNames.at(-1)), 'End goes to the last');
  await page.keyboard.press('Escape');
  await sleep(120);
  T.ok(await E(() => !document.querySelector('.rk-presets') && document.activeElement?.classList.contains('rk-pre')), 'Escape closes it and focus is back on the button');
  T.ok((await line()).preset === next, 'and nothing changed');
  // a second click on the button closes it too
  await page.click('.rk-inst .rk-pre');
  await page.waitForSelector('.rk-presets');
  await page.click('.rk-inst .rk-pre');
  await sleep(120);
  T.ok(await E(() => !document.querySelector('.rk-presets')), 'clicking the name again closes the list');

  /* ---- the agent: list_devices and get_device name the same presets; its instrument.set lands on the same name */
  const ld = await run('list_devices', { kind: 'instrument', query: 'Baby Grand', detail: 'brief' });
  const ldText = JSON.stringify(ld);
  T.ok(presetNames.every((n) => ldText.includes(n)), 'list_devices lists the names the rack does');
  const gd = await run('get_device', { id: 'core.piano' });
  T.ok(JSON.stringify(gd.presets.map((p) => p.name)) === JSON.stringify(presetNames), 'get_device has the same presets, in the same order');
  const bright = gd.presets.find((p) => p.name === 'Bright pop') || gd.presets[0];
  const ap = await run('apply_ops', { ops: [{ type: 'instrument.set', track: 'Keys', params: bright.params }], label: `${bright.name} on the keys` });
  T.ok(ap.ok !== false && !ap.error, 'an agent applies get_device\'s params with instrument.set' + (ap.error ? ': ' + ap.error : ''));
  await sleep(250);
  L = await line();
  T.ok(L.preset === bright.name && !L.edited, `the rack names what the agent picked ("${L.text}")`);
  const gp = await run('get_project', { track: 'Keys' });
  T.ok(Array.isArray(gp.presets) && gp.presets.includes(`Keys: Baby Grand, ${bright.name}`), `get_project tells the agent the name the rack shows (${JSON.stringify(gp.presets)})`);
  // the human edits it: the agent no longer reads it as that preset, and the rack says edited
  await E((id) => window.overdub.store.dispatch({ type: 'instrument.set', track: id, params: { room: 0.9 } }, { by: 'you' }), keys);
  await sleep(150);
  const gp2 = await run('get_project', { track: 'Keys' });
  L = await line();
  T.ok(!(gp2.presets || []).some((x) => x.startsWith('Keys:')) && L.edited, `once edited, get_project doesn't claim a preset and the face says "${L.text}"`);
  T.ok(await E(() => { const o = window.overdub, id = o.ui.state.selection.track; const st = o.rack.presetOf(id); return st && st.edited && st.name === document.querySelector('.rk-inst .rk-pre').dataset.preset; }), 'app.rack.presetOf agrees with the face');

  /* ---- an effect with presets: the same line, insert.set, one step */
  const KERNEL = `({ create({ sr }) { let z = 0; return { process(L, R, n, p) { const a = Math.exp(-2 * Math.PI * p.tone / sr); for (let i = 0; i < n; i++) { z = L[i] + (z - L[i]) * a; L[i] = z * p.level; R[i] = z * p.level; } } }; } })`;
  const dd = await run('define_device', { device: { id: 'claude.preset-tone', name: 'Preset Tone', kind: 'effect', cat: 'filter', blurb: 'a one-pole lowpass with presets', params: [{ key: 'tone', label: 'TONE', min: 200, max: 12000, def: 3000, curve: 'log', unit: 'Hz', role: 'tone' }, { key: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.8, role: 'level' }], presets: [{ name: 'Open', params: {} }, { name: 'Dark', params: { tone: 600 } }, { name: 'Quiet', params: { level: 0.3 } }], kernel: KERNEL }, use_on: { track: 'Keys' }, label: 'a filter with presets' });
  T.ok(dd.ok, 'an agent defines an effect with presets and puts it on Keys' + (dd.error ? ': ' + dd.error : ''));
  await sleep(500);
  const fxId = await E((id) => window.overdub.store.get().tracks.find((t) => t.id === id).inserts.find((f) => f.device === 'claude.preset-tone')?.id, keys);
  const fxSel = `.rk-card[data-insert="${fxId}"] .rk-pre`;
  await page.waitForSelector(fxSel, { timeout: 5000 });
  T.ok((await E((s) => document.querySelector(s).dataset.preset, fxSel)) === 'Open', 'its face says Open (its defaults)');
  const h2 = await hist();
  await page.click(fxSel);
  await page.waitForSelector('.rk-presets');
  await page.click('.rk-presets .rk-pi[data-preset="Dark"]');
  await sleep(200);
  const fxp = await E(([id, f]) => ({ ...window.overdub.store.get().tracks.find((t) => t.id === id).inserts.find((x) => x.id === f).params }), [keys, fxId]);
  T.ok(fxp.tone === 600 && fxp.level === 0.8 && (await hist()) === h2 + 1, `Dark is one insert.set with the whole sound (${JSON.stringify(fxp)})`);
  T.ok((await E((s) => document.querySelector(s).dataset.preset, fxSel)) === 'Dark', 'and the effect\'s face says Dark');
  const gp3 = await run('get_project', { track: 'Keys' });
  T.ok((gp3.presets || []).some((x) => x === `Keys (${fxId}): Preset Tone, Dark`), `get_project names the effect's preset too (${JSON.stringify(gp3.presets)})`);
  // a device with no presets has no line
  T.ok(await E(() => [...document.querySelectorAll('.rk-card')].some((c) => !c.querySelector('.rk-pre'))), 'a device with no presets has no preset line');

  /* ---- the kit: no stripe, no pill, no glow on the line or the list */
  await page.click('.rk-inst .rk-pre');
  await page.waitForSelector('.rk-presets');
  const kit = await E(() => {
    const els = [...document.querySelectorAll('.rk-preline, .rk-pre, .rk-presets, .rk-pi')];
    const bad = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (/inset/.test(cs.boxShadow)) bad.push('inset shadow on ' + el.className);
      if (parseFloat(cs.borderRadius) > 2) bad.push('radius ' + cs.borderRadius + ' on ' + el.className);
      if (cs.textShadow !== 'none') bad.push('text glow on ' + el.className);
      for (const side of ['Left', 'Top']) if (parseFloat(cs['border' + side + 'Width']) >= 2) bad.push('edge on ' + el.className);
    }
    return bad;
  });
  T.ok(kit.length === 0, 'no stripes, pills or glows on the line or the list' + (kit.length ? ': ' + kit.join('; ') : ''));
  const src = await (await import('node:fs')).promises.readFile(new URL('../app/src/ui/rack.js', import.meta.url), 'utf8');
  const presetCss = src.slice(src.indexOf('/* presets:'), src.indexOf('/* compact */'));
  T.ok(presetCss.length > 100 && !/inset \d+px 0 0|99px|50%|glow|text-shadow/.test(presetCss), 'the preset CSS has no stripe, pill or glow');
  await page.keyboard.press('Escape');

  /* ---- a phone: the line is a 40 px target */
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  await E(() => window.overdub.ui.show('rack'));
  await sleep(400);
  const ph = await E(() => { const b = document.querySelector('.rk-inst .rk-pre'); const r = b?.getBoundingClientRect(); return r ? { h: r.height, w: r.width } : null; });
  T.ok(ph && ph.h >= 40, `on a phone the preset name is a 40 px target (${ph ? ph.h.toFixed(0) : 'none'} px tall)`);

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} catch (e) {
  T.ok(false, 'threw: ' + (e.stack || e));
} finally {
  await close();
}
T.done();
