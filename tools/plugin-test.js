// Device windows (ui/plugin.js, ui/plugin-kit.js, ui/editors/generic.js): every built-in, a guitar pedal, an amp and
// the house shelf open big; the rack's Open and a double-click on a caption; a knob drag is one op by you, one undo;
// an agent's change updates the window and flashes the control it turned; presets, A/B (each flip one undo step, and
// an undo flips the letter back), bypass, Code; Esc and × close it and focus goes back; the transport, musical typing
// and the keyboard strip play while it's open; it drags, sizes and remembers both; the phone sheet (44 px keys, 12 px
// text); a song's device that names an editor gets the generic one; the custom-editor contract with a tiny editor
// served to this page alone; the kit's widgets from the keyboard; the show_device tool; the liner-notes rules in its
// CSS; no page errors.
//   node tools/plugin-test.js      screenshots: tools/.out/plugin-*.png
import { open, tally } from './pw.js';
import { catalogSchemas } from '../app/src/agent/tools.js';

const T = tally('plugin');
const ok = T.ok;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ours = (errors) =>
  errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext|getUserMedia/.test(e));

// the tiny editors this page alone is served (page.route): one that keeps the contract, one that throws in mount,
// and one a song's device names (it must never be fetched)
const TEST_EDITOR = `
export function mount(el, ctx) {
  const log = window.__pk = { mounted: true, keys: Object.keys(ctx).sort(), updates: [], updated: 0, frames: 0, unmounted: false };
  const tone = ctx.param('tone');
  const k = ctx.kit.knob(tone, { value: ctx.params().tone, name: ctx.def.name, onInput: (v, o) => ctx.set({ tone: v }, { gesture: o.commit ? 'end' : 'move' }) });
  k.el.id = 'pk-test-knob';
  const ctl = ctx.control('decay');
  ctl.id = 'pk-test-ctl';
  el.append(k.el, ctl);
  const off = ctx.on((e) => { log.updates.push({ keys: e.keys, by: e.by, kind: e.kind }); if (e.keys && e.keys.includes('tone')) k.set(e.params.tone); });
  log.keyboard = !!(ctx.keyboard && ctx.keyboard.shown);
  log.meter = typeof ctx.meter.level === 'function' && typeof ctx.meter.scope === 'function';
  log.addr = ctx.addr;
  window.__pkDrag = () => { ctx.set({ tone: 0.21 }, { gesture: 'move' }); ctx.set({ tone: 0.31 }, { gesture: 'move' }); return ctx.set({ tone: 0.41 }, { gesture: 'end' }).ok; };
  return { update() { log.updated++; }, frame() { log.frames++; }, unmount() { log.unmounted = true; off(); } };
}`;
const BROKEN_EDITOR = 'export function mount() { throw new Error("this editor is broken on purpose"); }';
const hits = { 'pk-test': 0, 'pk-broken': 0, 'pk-trap': 0 };

/* ======================================================================== desktop */
const s = await open('/app/', { query: 'demo' });
const { page, errors, shot } = s;
page.setDefaultTimeout(15000);
for (const name of Object.keys(hits)) {
  await page.route(`**/src/ui/editors/${name}.js`, (route) => {
    hits[name]++;
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body:
        name === 'pk-test'
          ? TEST_EDITOR
          : name === 'pk-broken'
            ? BROKEN_EDITOR
            : 'export function mount(el) { el.textContent = "trap"; window.__trap = true; return {}; }',
    });
  });
}
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(400);
  const E = (fn, arg) => page.evaluate(fn, arg);
  await E(() => document.querySelector('.ar-welcome-x')?.click());
  const song = await E(() => {
    const p = window.overdub.store.get();
    const inst = p.tracks.find((t) => t.kind === 'instrument' && t.instrument?.device?.startsWith('core.'));
    const guitar = p.tracks.find((t) => t.inserts.some((x) => x.device.startsWith('pedal.')));
    return {
      inst: inst.id,
      instName: inst.name,
      guitar: guitar?.id,
      guitarName: guitar?.name,
      guitarFx: guitar?.inserts.map((x) => ({ id: x.id, device: x.device })) || [],
    };
  });

  /* -------- boot */
  ok(
    await E(
      () =>
        !!window.overdub.plugin &&
        typeof window.overdub.plugin.open === 'function' &&
        window.overdub.plugin.current === null,
    ),
    'app.plugin is there, with no window open',
  );
  ok(
    await E(() => window.overdub.tools.list().includes('show_device')),
    "the agents' catalog in the page has show_device",
  );
  ok(
    (await catalogSchemas()).some((x) => x.name === 'show_device'),
    'the catalog without a tab (Node: catalogSchemas) lists show_device too',
  );
  ok(
    await E(() => window.overdub.ui.panels.has('plugin') && window.overdub.ui.panels.get('plugin').el.hidden),
    "it joins the shell's loop as a top-region panel with nothing to draw",
  );

  /* -------- every built-in, a pedal, an amp, the house shelf */
  const opened = await E(async () => {
    const a = window.overdub,
      out = [];
    const t = a.store.get().tracks.find((x) => x.kind === 'instrument' && x.instrument?.device?.startsWith('core.'));
    const check = (d) => {
      const el = document.querySelector('.pw');
      if (!el) return { id: d.id, open: false };
      const body = el.querySelector('.pw-body');
      const keys = new Set([...body.querySelectorAll('.pk-ctl[data-key]')].map((x) => x.dataset.key).filter(Boolean));
      const want = d.params.filter((p) => !p.hidden).map((p) => p.key);
      const unnamed = [...el.querySelectorAll('button, [role=slider], [role=radio], select, [tabindex="0"]')].filter(
        (x) =>
          x.getClientRects().length &&
          !(x.getAttribute('aria-label') || x.textContent.trim() || x.getAttribute('aria-labelledby')),
      ).length;
      // (a built-in that names its own editor gets that one, and may hide the keyboard strip: Studio A's drawn kit)
      const wanted = a.plugin.editorFor(d) || 'generic';
      return {
        id: d.id,
        open: true,
        device: el.dataset.device,
        name: el.querySelector('.pw-name')?.textContent,
        def: d.name,
        editor: el.dataset.editor,
        wanted,
        every: want.every((k) => keys.has(k)),
        n: keys.size,
        of: want.length,
        unnamed,
        code: !!el.querySelector('.pw-code') === (typeof d.kernel === 'string'),
        kernel: typeof d.kernel === 'string',
        keys:
          wanted !== 'generic' || !!el.querySelector('.pw-keys:not([hidden]) .pk-keys') === (d.kind === 'instrument'),
        overflow: body.scrollWidth - body.clientWidth,
        onScreen: (() => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
        })(),
      };
    };
    // a built-in may name an editor of its own (Scribble Strip's): it loads after the generic one, so wait for it
    const settle = async (d) => {
      const want = a.plugin.editorFor(d) || 'generic';
      for (let i = 0; i < 80 && document.querySelector('.pw')?.dataset.editor !== want; i++)
        await new Promise((r) => setTimeout(r, 25));
    };
    const insts = a.devices
      .listDevices({ kind: 'instrument' })
      .filter((d) => d.source === 'builtin' && d.id.startsWith('core.'));
    const fx = a.devices
      .listDevices({ kind: 'effect' })
      .filter((d) => d.source === 'builtin' && d.id.startsWith('core.'));
    // (a built-in that names its own editor: wait for it to load, then hold it to the same checks)
    const loaded = async (d) => {
      if (!a.plugin.editorFor(d)) return;
      for (let i = 0; i < 60 && document.querySelector('.pw')?.dataset.editor === 'loading'; i++)
        await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 60));
    };
    for (const d of insts) {
      a.store.dispatch({ type: 'instrument.set', track: t.id, device: d.id }, { by: 'you', label: 'plugin test' });
      a.plugin.open({ track: t.id, slot: 'instrument' });
      await new Promise((r) => setTimeout(r, 30));
      await settle(d);
      out.push({ kind: 'instrument', ...check(d) });
      a.plugin.close();
      a.store.undo();
    }
    for (const d of [
      ...fx,
      a.devices.listDevices({ kind: 'effect' }).find((x) => x.id.startsWith('pedal.') && x.params.length >= 4) ||
        a.devices.listDevices({ kind: 'effect' }).find((x) => x.id.startsWith('pedal.')),
      a.devices.listDevices().find((x) => x.cat === 'amp'),
      ...a.devices
        .listDevices({ kind: 'instrument' })
        .filter((x) => x.source === 'library')
        .slice(0, 2),
      ...a.devices
        .listDevices({ kind: 'effect' })
        .filter((x) => x.source === 'library')
        .slice(0, 2),
    ].filter(Boolean)) {
      if (d.kind === 'instrument') {
        a.store.dispatch({ type: 'instrument.set', track: t.id, device: d.id }, { by: 'you', label: 'plugin test' });
        a.plugin.open({ track: t.id, slot: 'instrument' });
        await new Promise((r) => setTimeout(r, 30));
        out.push({ kind: 'library instrument', ...check(d) });
        a.plugin.close();
        a.store.undo();
        continue;
      }
      const r = a.store.dispatch(
        { type: 'insert.add', track: t.id, insert: { device: d.id }, ref: 'x' },
        { by: 'you', label: 'plugin test' },
      );
      a.plugin.open({ track: t.id, slot: r.created.x });
      await new Promise((rr) => setTimeout(rr, 30));
      await settle(d);
      out.push({
        kind: d.id.startsWith('pedal.')
          ? 'pedal'
          : d.cat === 'amp'
            ? 'amp'
            : d.source === 'library'
              ? 'library'
              : 'effect',
        ...check(d),
      });
      a.plugin.close();
      a.store.undo();
    }
    return out;
  });
  const bad = opened.filter(
    (x) => !x.open || x.device !== x.id || x.name !== x.def || !x.every || x.editor !== x.wanted,
  );
  const nInst = opened.filter((x) => x.kind === 'instrument').length,
    nFx = opened.filter((x) => x.kind === 'effect').length;
  const own = opened.filter((x) => x.wanted !== 'generic').map((x) => `${x.id}: ${x.editor}`);
  ok(
    nInst >= 16 && nFx >= 10 && !bad.length,
    `the window opens for every built-in (${nInst} instruments, ${nFx} effects), each with its name, its editor${own.length ? ` (its own for ${own.join(', ')})` : ''} and a control for every param${bad.length ? ': ' + bad.map((x) => `${x.id} ${x.open ? `${x.n}/${x.of} ${x.editor}` : 'did not open'}`).join(', ') : ''}`,
  );
  const ownEd = opened.filter((x) => x.wanted !== 'generic');
  ok(
    ownEd.length >= 1 && ownEd.every((x) => x.editor === x.wanted && x.every),
    `a built-in that names its own editor opens with it, a control for every param there too (${ownEd.map((x) => `${x.id}: ${x.editor}, ${x.n}/${x.of}`).join('; ')})`,
  );
  for (const k of ['pedal', 'amp', 'library']) {
    const x = opened.find((o) => o.kind === k || (k === 'library' && o.kind === 'library instrument'));
    ok(
      x && x.open && x.every && x.editor === 'generic',
      `…and a ${k === 'library' ? 'house-shelf device' : k === 'amp' ? 'Guitar Studio amp' : 'Guitar Studio pedal'} (${x ? `${x.id}: ${x.n} controls` : 'none found'})`,
    );
  }
  ok(
    opened.every((x) => x.overflow <= 1),
    `no window's controls run out sideways (${
      opened
        .filter((x) => x.overflow > 1)
        .map((x) => x.id)
        .join(', ') || 'none'
    })`,
  );
  ok(
    opened.every((x) => x.onScreen),
    `a new window is on screen whole (${
      opened
        .filter((x) => !x.onScreen)
        .map((x) => x.id)
        .join(', ') || 'all'
    })`,
  );
  ok(
    opened.every((x) => !x.unnamed),
    `every control in every window has a name for a screen reader (${
      opened
        .filter((x) => x.unnamed)
        .map((x) => `${x.id}: ${x.unnamed}`)
        .join(', ') || 'all named'
    })`,
  );
  ok(
    opened.every((x) => x.code) && opened.some((x) => x.kernel) && opened.some((x) => !x.kernel),
    `a kernel has a Code key and a graph device (a pedal, an amp) has none (${
      opened
        .filter((x) => !x.code)
        .map((x) => x.id)
        .join(', ') || 'all right'
    })`,
  );
  ok(
    opened.every((x) => x.keys),
    `instruments have the keyboard strip and effects don't (${
      opened
        .filter((x) => !x.keys)
        .map((x) => x.id)
        .join(', ') || 'all right'
    })`,
  );

  /* -------- the generic layout: sections by role, by prefix, by group */
  const lay = await E(async () => {
    const g = await import('/app/src/ui/editors/generic.js');
    const d = (id) => window.overdub.devices.getDevice(id);
    const fake = {
      id: 'x.wt',
      name: 'Fake Table',
      kind: 'instrument',
      params: [
        'a_pos',
        'a_warp',
        'b_pos',
        'b_warp',
        'flt_cut',
        'flt_res',
        'env1_a',
        'env1_d',
        'env1_s',
        'env1_r',
        'vol',
      ].map((key) => ({ key, label: key.toUpperCase(), min: 0, max: 1, def: 0.5 })),
    };
    const mods = {
      id: 'x.mods',
      name: 'Fake Mods',
      kind: 'instrument',
      params: ['m1_src', 'm1_dst', 'm1_amt', 'm2_src', 'm2_dst', 'm2_amt', 'macro1', 'vol'].map((key) => ({
        key,
        label: key.toUpperCase(),
        min: 0,
        max: 1,
        def: 0.5,
      })),
    };
    return {
      poly: g.layout(d('core.poly')).map((x) => x.name),
      small: g.layout(d('core.verb')).map((x) => x.name),
      amp: g
        .layout(window.overdub.devices.listDevices().find((x) => x.cat === 'amp' && x.id.startsWith('amp.')))
        .map((x) => x.name),
      fake: g.layout(fake).map((x) => `${x.name}:${x.keys.length}`),
      mods: g.layout(mods).map((x) => x.name),
    };
  });
  // m1_* are a mod slot's source, destination and amount: "Mod slot 1", not "Macros 1"
  ok(
    lay.mods[0] === 'Mod slot 1' && lay.mods[1] === 'Mod slot 2' && !lay.mods.some((x) => /Macros/.test(x)),
    `numbered mod slots are named as mod slots (${lay.mods.join(', ')})`,
  );
  ok(lay.small.length === 1 && lay.small[0] === null, 'a device of eight params or fewer is one row of controls');
  ok(
    lay.poly.length >= 3 && lay.poly.includes('Envelope') && lay.poly.includes('Tone'),
    `a deep one is grouped by role (Patch Bay: ${lay.poly.join(', ')})`,
  );
  ok(
    JSON.stringify(lay.fake) === JSON.stringify(['Osc A:2', 'Osc B:2', 'Filter:2', 'Envelope 1:4', 'Main:1']),
    `key prefixes make sections, in order, the rest in Main (${lay.fake.join(', ')})`,
  );
  ok(
    lay.amp[0] === 'Amp' && lay.amp.includes('Cab and mics'),
    `a param's group names its section (an amp: ${lay.amp.join(', ')})`,
  );

  /* -------- the rack's way in: Open on a face, a double-click on its caption */
  await E((id) => {
    const a = window.overdub;
    a.ui.select({ track: id, clip: null, insert: null });
    a.ui.show('rack');
  }, song.inst);
  await sleep(400);
  const openBtn = await E(() => {
    const b = document.querySelector('[data-panel="rack"] .rk-card.rk-inst .rk-open');
    if (!b) return null;
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return { label: b.getAttribute('aria-label'), text: b.textContent };
  });
  ok(
    !!openBtn && openBtn.text === 'Open' && /in its own window/.test(openBtn.label),
    `each face's caption has Open ("${openBtn?.label}")`,
  );
  await page.click('[data-panel="rack"] .rk-card.rk-inst .rk-open');
  await sleep(250);
  const viaOpen = await E(() => ({
    cur: window.overdub.plugin.current,
    focusIn: !!document.activeElement?.closest('.pw'),
    focus: window.overdub.ui.state.focus,
  }));
  ok(
    viaOpen.cur && viaOpen.cur.slot === 'instrument' && viaOpen.cur.track === song.inst,
    `Open opens its window (${viaOpen.cur?.name})`,
  );
  ok(
    viaOpen.focusIn && viaOpen.focus === 'plugin',
    'focus goes into the window, and the studio knows the window is in use (ui.state.focus)',
  );
  await shot('plugin-desktop');
  await page.keyboard.press('Escape');
  await sleep(150);
  const afterEsc = await E(() => ({
    open: !!window.overdub.plugin.current,
    back: !!document.activeElement?.classList.contains('rk-open'),
  }));
  ok(!afterEsc.open, 'Esc closes it');
  ok(afterEsc.back, 'and focus goes back to the Open it came from');
  const fxId = await E((id) => {
    const a = window.overdub;
    const r = a.store.dispatch(
      { type: 'insert.add', track: id, insert: { device: 'core.eq' }, ref: 'eq' },
      { by: 'you', label: 'plugin test eq' },
    );
    return r.created.eq;
  }, song.inst);
  await sleep(300);
  await E(
    (fx) =>
      document.querySelector(`[data-panel="rack"] .rk-card[data-insert="${fx}"]`)?.scrollIntoView({ inline: 'center' }),
    fxId,
  );
  await page.dblclick(`[data-panel="rack"] .rk-card[data-insert="${fxId}"] .rk-name`);
  await sleep(250);
  ok(
    await E((fx) => window.overdub.plugin.current?.slot === fx, fxId),
    "a double-click on a face's caption opens it too",
  );

  /* -------- bypass: On */
  const by0 = await E(() => window.overdub.store.history.length);
  await page.click('.pw .pk-tog');
  await sleep(120);
  const bypass = await E((fx) => {
    const a = window.overdub;
    const i = a.store.insert(a.plugin.current.track, fx);
    const last = a.store.history[a.store.history.length - 1];
    return {
      on: i.on,
      by: last.by,
      pressed: document.querySelector('.pw .pk-tog').getAttribute('aria-pressed'),
      off: document.querySelector('.pw').classList.contains('pw-off'),
      card: document.querySelector(`[data-panel="rack"] .rk-card[data-insert="${fx}"]`)?.classList.contains('off'),
    };
  }, fxId);
  ok(
    bypass.on === false && bypass.by === 'you' && bypass.pressed === 'false' && bypass.off,
    `On bypasses an effect: one insert.set by you, the lamp out (${JSON.stringify(bypass)})`,
  );
  ok(bypass.card === true, "the rack's face shows it bypassed too");
  await page.click('.pw .pk-tog');
  await sleep(80);
  ok(
    (await E((fx) => window.overdub.store.insert(window.overdub.plugin.current.track, fx).on === true, fxId)) &&
      (await E(() => window.overdub.store.history.length)) === by0 + 2,
    'and back on: two clicks, two steps',
  );
  await shot('plugin-effect');
  // Code: the kernel's source, read-only (the rack's sheet), and Esc closes that before the window
  await page.click('.pw .pw-code');
  await page.waitForSelector('.rk-sheet .rk-code');
  ok(
    await E(() => /process|create/.test(document.querySelector('.rk-sheet .rk-code').textContent)),
    "Code shows the kernel's source (the rack's read-only sheet)",
  );
  await page.keyboard.press('Escape');
  await sleep(120);
  ok(
    await E(() => !document.querySelector('.rk-sheet') && !!window.overdub.plugin.current),
    'Esc closes the code first, and the window stays',
  );
  await E(() => {
    window.overdub.plugin.close();
  });

  /* -------- a knob drag: one op, signed you, one undo */
  await E((id) => {
    const a = window.overdub;
    a.store.dispatch(
      { type: 'instrument.set', track: id, device: 'core.poly' },
      { by: 'you', label: 'plugin test poly' },
    );
    a.plugin.open({ track: id, slot: 'instrument' });
  }, song.inst);
  await sleep(300);
  const kn = await E(() => {
    const d = document.querySelector('.pw .pk-knob[data-key="cutoff"] .pk-dial');
    d.scrollIntoView({ block: 'nearest' });
    const r = d.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      h0: window.overdub.store.history.length,
      v0: window.overdub.store.track(window.overdub.plugin.current.track).instrument.params.cutoff ?? 2400,
    };
  });
  await page.mouse.move(kn.x, kn.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(kn.x, kn.y - i * 6);
  await page.mouse.up();
  await sleep(120);
  const drag = await E((k) => {
    const a = window.overdub,
      last = a.store.history[a.store.history.length - 1];
    return {
      n: a.store.history.length - k.h0,
      by: last.by,
      type: last.ops[0].type,
      label: last.label,
      name: a.plugin.current.name,
      v: a.store.track(a.plugin.current.track).instrument.params.cutoff,
      aria: +document.querySelector('.pw .pk-knob[data-key="cutoff"] .pk-dial').getAttribute('aria-valuenow'),
      text: document.querySelector('.pw .pk-knob[data-key="cutoff"] .pk-v').textContent,
    };
  }, kn);
  ok(
    drag.v > kn.v0 && drag.aria === drag.v,
    `dragging a knob up turns it up (cutoff ${kn.v0} → ${drag.v}, reads ${drag.text})`,
  );
  ok(
    drag.n === 1 && drag.by === 'you' && drag.type === 'instrument.set',
    `one drag is one op, an instrument.set by you (${drag.n} step, ${drag.by}, ${drag.type})`,
  );
  // History says it in words, with where the drag left it (it read "Light Table a pos", a raw name and no value)
  ok(
    drag.label === `${drag.name}: cutoff ${drag.text}`,
    `History names the control and where it was left ("${drag.label}")`,
  );
  await E(() => window.overdub.store.undo());
  await sleep(60);
  ok(
    await E(
      (v0) =>
        (window.overdub.store.track(window.overdub.plugin.current.track).instrument.params.cutoff ?? 2400) === v0 &&
        +document.querySelector('.pw .pk-knob[data-key="cutoff"] .pk-dial').getAttribute('aria-valuenow') === v0,
      kn.v0,
    ),
    'one undo takes it back, and the knob goes with it',
  );
  // the keys, the wheel and a double-click, like every knob in the studio
  await page.focus('.pw .pk-knob[data-key="reso"] .pk-dial');
  const r0 = await E(
    () => +document.querySelector('.pw .pk-knob[data-key="reso"] .pk-dial').getAttribute('aria-valuenow'),
  );
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const r1 = await E(
    () => +document.querySelector('.pw .pk-knob[data-key="reso"] .pk-dial').getAttribute('aria-valuenow'),
  );
  await page.dblclick('.pw .pk-knob[data-key="reso"] .pk-dial');
  const r2 = await E(() => ({
    v: +document.querySelector('.pw .pk-knob[data-key="reso"] .pk-dial').getAttribute('aria-valuenow'),
    def: window.overdub.devices.getDevice('core.poly').params.find((p) => p.key === 'reso').def,
  }));
  ok(
    r1 > r0 && r2.v === r2.def,
    `arrow keys turn a knob (${r0} → ${r1}) and a double-click puts it back to its default (${r2.v})`,
  );

  /* -------- an agent turns a knob: the window follows, the control flashes in its ink, the bar says what moved */
  const ag = await E(() => {
    const a = window.overdub,
      t = a.plugin.current.track;
    a.store.dispatch(
      { type: 'instrument.set', track: t, params: { reso: 0.62 } },
      { by: 'claude', label: 'more bite' },
    );
    const k = document.querySelector('.pw .pk-knob[data-key="reso"]');
    return {
      v: +k.querySelector('.pk-dial').getAttribute('aria-valuenow'),
      flash: k.classList.contains('pk-flash'),
      status: document.querySelector('.pw .pw-status').textContent,
      by: document.querySelector('.pw .pw-status .by')?.className,
    };
  });
  ok(ag.v === 0.62, `an agent's instrument.set updates the window (reso reads ${ag.v})`);
  ok(ag.flash, 'the knob it turned flashes');
  ok(
    /Claude set Reso to 0\.620/.test(ag.status) && /by-agent/.test(ag.by || ''),
    `the bar says who moved what, signed in cool ink ("${ag.status}")`,
  );
  ok(
    (await E(() => getComputedStyle(document.querySelector('.pw .pk-knob[data-key="reso"]')).outlineColor)) ===
      'rgb(76, 195, 255)',
    "the flash is a frame in the agent's ink",
  );
  await sleep(1900);
  ok(await E(() => !document.querySelector('.pw .pk-flash')), 'and fades');

  /* -------- automation: a knob follows its lane ("auto"), a hand holds the lane ("held"), the menu gives it back */
  const lane0 = await E(async () => {
    const a = window.overdub,
      t = a.plugin.current.track;
    a.transport?.marker?.set?.(0, { seek: true });
    a.engine.seek?.(0);
    a.store.dispatch(
      { type: 'auto.write', track: t, insert: 'instrument', param: 'cutoff', points: '0:500 16:8000' },
      { by: 'you', label: 'a cutoff lane' },
    );
    await new Promise((r) => setTimeout(r, 120));
    const k = document.querySelector('.pw .pk-knob[data-key="cutoff"]');
    return {
      mark: k.querySelector('.pk-am')?.dataset.mark,
      v: +k.querySelector('.pk-dial').getAttribute('aria-valuenow'),
      text: k.querySelector('.pk-dial').getAttribute('aria-valuetext'),
      title: k.querySelector('.pk-dial').title,
    };
  });
  ok(
    lane0.mark === 'auto' && /follows its lane/.test(lane0.text) && /Follows its lane/.test(lane0.title),
    `a knob with a lane says "auto", and its title and valuetext say it follows the lane ("${lane0.text}")`,
  );
  ok(Math.abs(lane0.v - 500) < 1, `it shows the lane's value where the song is, not its own (${lane0.v})`);
  await page.focus('.pw .pk-knob[data-key="cutoff"] .pk-dial');
  const hl0 = await E(() => window.overdub.store.history.length);
  await page.keyboard.press('ArrowUp');
  await sleep(100);
  const held = await E((h0) => {
    const a = window.overdub,
      t = a.plugin.current.track,
      last = a.store.history[a.store.history.length - 1];
    return {
      steps: a.store.history.length - h0,
      types: last.ops.map((o) => o.type).join(','),
      off: a.store.track(t).instrument.auto?.cutoff?.off === true,
      mark: document.querySelector('.pw .pk-knob[data-key="cutoff"] .pk-am')?.dataset.mark,
      toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '),
    };
  }, hl0);
  ok(
    held.steps === 1 && held.types === 'instrument.set,auto.set' && held.off && held.mark === 'held',
    `a hand on it holds the lane in the same step and it says "held" (${held.types})`,
  );
  ok(
    /is held at/.test(held.toast) && /Back to the lane/.test(held.toast),
    `the first hold says so, with Back to the lane ("${held.toast.slice(0, 90)}")`,
  );
  await page.click('.pw .pk-knob[data-key="cutoff"] .pk-dial', { button: 'right' });
  await page.waitForSelector('.ek-pop[role=menu]');
  const menu = await E(() => [...document.querySelectorAll('.ek-pop[role=menu] .ek-item')].map((b) => b.textContent));
  ok(
    menu.some((x) => /^Automate/.test(x)) && menu.some((x) => /^Back to the lane/.test(x)),
    `right-click: the control's menu, Automate and Back to the lane (${menu.map((x) => x.split(/[a-z](?=[A-Z])/)[0]).join(', ')})`,
  );
  await page.click('.ek-pop[role=menu] .ek-item:has-text("Back to the lane")');
  await sleep(100);
  ok(
    await E(() => {
      const a = window.overdub,
        t = a.plugin.current.track;
      return (
        a.store.track(t).instrument.auto?.cutoff?.off !== true &&
        document.querySelector('.pw .pk-knob[data-key="cutoff"] .pk-am')?.dataset.mark === 'auto'
      );
    }),
    'Back to the lane gives it back, and the mark says "auto" again',
  );
  await E(() => {
    const a = window.overdub;
    a.store.undo();
    a.store.undo();
    a.store.undo();
  });
  await sleep(80);
  ok(
    await E(() => !document.querySelector('.pw .pk-knob[data-key="cutoff"] .pk-am')),
    'a lane gone takes its mark with it',
  );

  /* -------- presets: the rack's names, ‹ ›, the list, "edited" */
  await E((id) => {
    const a = window.overdub;
    a.store.dispatch(
      { type: 'instrument.set', track: id, device: 'core.piano' },
      { by: 'you', label: 'plugin test piano' },
    );
    a.plugin.open({ track: id, slot: 'instrument' });
  }, song.inst);
  await sleep(250);
  const pre0 = await E(() => ({
    label: document.querySelector('.pw .pw-pre-n').textContent,
    names: window.overdub.devices.getDevice('core.piano').presets.map((p) => p.name),
  }));
  await page.click('.pw .pw-pre .pw-key[aria-label="Next preset"]');
  await sleep(80);
  const pre1 = await E((names) => {
    const a = window.overdub,
      t = a.plugin.current.track;
    const now = a.devices.presetOf('core.piano', a.store.track(t).instrument.params);
    return {
      label: document.querySelector('.pw .pw-pre-n').textContent,
      now: now?.name,
      last: a.store.history[a.store.history.length - 1].label,
      names,
    };
  }, pre0.names);
  ok(
    pre1.now && pre1.label.startsWith(pre1.now) && pre1.names.includes(pre1.now),
    `› steps to the next preset, one step ("${pre0.label}" → "${pre1.label}"; ${pre1.last})`,
  );
  await page.focus('.pw .pk-knob .pk-dial');
  await page.keyboard.press('ArrowUp');
  await sleep(60);
  ok(
    await E(() => /edited/.test(document.querySelector('.pw .pw-pre-n').textContent)),
    `a knob moved off it says so ("${await E(() => document.querySelector('.pw .pw-pre-n').textContent)}")`,
  );
  await page.click('.pw .pw-pre-n');
  await page.waitForSelector('.ew-pop .rk-pi');
  const pick = pre0.names[pre0.names.length - 1];
  await page.click(`.ew-pop .rk-pi[data-preset="${pick}"]`);
  await sleep(80);
  ok(
    await E(
      (pk) =>
        window.overdub.devices.presetOf(
          'core.piano',
          window.overdub.store.track(window.overdub.plugin.current.track).instrument.params,
        )?.name === pk && document.querySelector('.pw .pw-pre-n').textContent.startsWith(pk),
      pick,
    ),
    `the list picks one (${pick})`,
  );
  ok(
    await E(() => !!window.overdub.rack.presetOf(window.overdub.plugin.current.track, 'instrument')),
    'and the rack names the same preset (app.rack.presetOf)',
  );

  /* -------- A/B: two snapshots; each flip one undo step; an undo flips the letter back */
  const ab = await E(async () => {
    const a = window.overdub,
      t = a.plugin.current.track,
      w = () => document.querySelector('.pw');
    const tone = () => a.store.track(t).instrument.params.tone;
    const press = (k) => {
      [...w().querySelectorAll('.pw-ab-b')].find((b) => b.textContent === k).click();
    };
    const on = () =>
      [...w().querySelectorAll('.pw-ab-b')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;
    const line = () => w().querySelector('.pw-status').textContent;
    a.store.dispatch({ type: 'instrument.set', track: t, params: { tone: 0.3 } }, { by: 'you', label: 'A sound' });
    const h0 = a.store.history.length;
    press('B');
    const afterB = { on: on(), steps: a.store.history.length - h0, tone: tone() };
    const lines = { copy: line() };
    a.store.dispatch({ type: 'instrument.set', track: t, params: { tone: 0.8 } }, { by: 'you', label: 'B sound' });
    lines.changed = line();
    const h1 = a.store.history.length;
    press('A');
    lines.flipped = line();
    const backA = { on: on(), steps: a.store.history.length - h1, tone: tone() };
    a.store.undo();
    const undone = { on: on(), tone: tone() };
    a.store.redo();
    const redone = { on: on(), tone: tone() };
    press('B');
    const toB = { on: on(), tone: tone() };
    w().querySelector('.pw-ab-copy').click(); // B -> A
    press('A');
    const copied = { on: on(), tone: tone() };
    return { afterB, backA, undone, redone, toB, copied, lines };
  });
  // the line keeps up: B's "starts as a copy" goes once B is changed, and a flip says where it landed and how far apart
  // the two are (it said "B starts as a copy of A" after B had been changed and flipped twice)
  ok(
    /B starts as a copy of A/.test(ab.lines.copy) &&
      !/copy/.test(ab.lines.changed) &&
      /^A now: 1 control differs from B\./.test(ab.lines.flipped),
    `the A/B line keeps up ("${ab.lines.copy}" → "${ab.lines.changed}" → "${ab.lines.flipped}")`,
  );
  ok(
    ab.afterB.on === 'B' && ab.afterB.steps === 0 && ab.afterB.tone === 0.3,
    `B starts as a copy of A: nothing changes (${JSON.stringify(ab.afterB)})`,
  );
  ok(
    ab.backA.on === 'A' && ab.backA.steps === 1 && ab.backA.tone === 0.3,
    `flipping back to A puts A's params in, one undo step (${JSON.stringify(ab.backA)})`,
  );
  ok(
    ab.undone.on === 'B' && ab.undone.tone === 0.8,
    `an undo of the flip takes B's sound back and the letter with it (${JSON.stringify(ab.undone)})`,
  );
  ok(
    ab.redone.on === 'A' && ab.redone.tone === 0.3 && ab.toB.on === 'B' && ab.toB.tone === 0.8,
    `redo flips again, and B keeps its own (${JSON.stringify(ab.redone)}, ${JSON.stringify(ab.toB)})`,
  );
  ok(ab.copied.on === 'A' && ab.copied.tone === 0.8, `Copy B to A makes them the same (${JSON.stringify(ab.copied)})`);

  /* -------- what a producer found in the new windows (docs/FRESH-EYES-6.md) */
  // a fresh Slide Rule, Scribble Strip or Gaffer Tape is on its defaults: it says so (it said "Custom", which reads as
  // "you changed it"); a sound built from a preset and moved a little says which ("Sprocket, edited": all four of
  // Vacancy's Light Tables said Custom); one far from every preset is Custom
  const six = await E(async () => {
    const a = window.overdub,
      t = a.store.get().tracks.find((x) => x.kind === 'instrument'),
      wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fresh = {};
    for (const dev of ['core.eq8', 'core.shaper', 'core.multiband']) {
      const r = a.store.dispatch(
        { type: 'insert.add', track: t.id, insert: { device: dev }, ref: 'x' },
        { by: 'you', label: 'plugin test: fresh' },
      );
      a.plugin.open({ track: t.id, slot: r.created.x });
      await wait(250);
      fresh[a.devices.getDevice(dev).name] = {
        window: document.querySelector('.pw .pw-pre-n')?.textContent,
        rack: a.rack.presetOf(t.id, r.created.x)?.label,
      };
      a.plugin.close();
      a.store.undo();
    }
    const lt = (params, name) => {
      const r = a.store.dispatch(
        {
          type: 'track.add',
          ref: 'lt',
          track: { name, kind: 'instrument', instrument: { device: 'core.wavetable', params } },
        },
        { by: 'you', label: 'plugin test: ' + name },
      );
      return r.created.lt;
    };
    const near = lt({ ...a.devices.presetParams('core.wavetable', 'Sprocket'), flt_cutoff: 2000 }, 'From Sprocket');
    const far = lt(
      {
        a_table: 'GRIT',
        a_pos: 0.95,
        a_unison: 8,
        a_detune: 1,
        b_level: 1,
        b_table: 'CHIP',
        flt_type: 'NOTCH',
        flt_cutoff: 60,
        flt_res: 0.9,
        env1_attack: 6,
        env1_release: 9,
        lfo1_shape: 'S&H',
        fx_drive: 1,
        fx_delay_mix: 0.9,
        fx_verb_mix: 0.9,
        voice_mode: 'MONO',
        voice_glide: 900,
      },
      'Far from them all',
    );
    a.plugin.open({ track: near, slot: 'instrument' });
    await wait(400);
    const nearW = document.querySelector('.pw .pw-pre-n')?.textContent;
    a.plugin.close();
    return {
      fresh,
      near: { window: nearW, rack: a.rack.presetOf(near, 'instrument') },
      far: a.rack.presetOf(far, 'instrument'),
      ids: [near, far],
    };
  });
  ok(
    Object.values(six.fresh).every(
      (x) => /^Default/.test(x.window) && !/edited/.test(x.window) && x.rack === 'Default',
    ),
    `a fresh Slide Rule, Scribble Strip and Gaffer Tape say Default (${Object.entries(six.fresh)
      .map(([n, x]) => `${n}: "${x.window}"`)
      .join(', ')})`,
  );
  ok(
    /^Sprocket, edited/.test(six.near.window) && six.near.rack?.name === 'Sprocket' && six.near.rack.edited,
    `a Light Table built from Sprocket, its cutoff moved, says "${six.near.window}"`,
  );
  ok(six.far?.label === 'Custom' && !six.far.name, `one far from every preset says Custom (${six.far?.label})`);
  // show_device on a device with a window of its own says what's in it: its sections by the names the person sees,
  // with their params (it said only which editor)
  const sd = await E(async (id) => {
    const a = window.overdub;
    const r = await a.tools.run('show_device', { track: id }, { by: 'claude' });
    a.plugin.close();
    return {
      editor: r.editor,
      sections: (r.sections || []).map((x) => ({
        name: x.name,
        n: x.params.length,
        first: x.params[0],
        shown: x.shown !== false,
      })),
    };
  }, six.ids[0]);
  const mx = sd.sections.find((x) => x.name === 'Mod matrix'),
    all = sd.sections.reduce((n, x) => n + x.n, 0);
  ok(
    sd.editor === 'wavetable' &&
      mx &&
      mx.first === 'm1_src' &&
      mx.shown &&
      all >= 100 &&
      !sd.sections.some((x) => x.name === 'Controls'),
    `show_device on Light Table gives its window's sections with their params (${sd.sections.length} sections, ${all} params: ${sd.sections
      .slice(0, 6)
      .map((x) => x.name)
      .join(', ')}…)`,
  );
  // Slide Rule's line about a band follows the band (it said "0.0 dB" after the band was dragged to +2.2 dB)
  const eqId = await E((id) => {
    const a = window.overdub,
      r = a.store.dispatch(
        { type: 'insert.add', track: id, insert: { device: 'core.eq8' }, ref: 'eq' },
        { by: 'you', label: 'plugin test: Slide Rule' },
      );
    a.plugin.open({ track: id, slot: r.created.eq });
    return r.created.eq;
  }, six.ids[0]);
  await page
    .waitForFunction(
      () => document.querySelector('.pw')?.dataset.editor === 'eq8' && !!document.querySelector('.pw .eq8')?.eq8Map,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await sleep(300);
  const at = await E(() => document.querySelector('.pw .eq8').eq8Map.xy(1000, 0));
  await page.mouse.dblclick(at.x, at.y);
  await sleep(200);
  const band = await E(
    ([id, fx]) => {
      const a = window.overdub,
        line0 = document.querySelector('.pw .pw-status').textContent,
        n = +(/Band (\d)/.exec(line0)?.[1] || 0);
      a.store.dispatch(
        { type: 'insert.set', track: id, insert: fx, patch: { params: { [`b${n}_gain`]: 2.2 } } },
        { by: 'you', coalesce: 'probe', label: 'band up' },
      );
      return { line0, n, line1: document.querySelector('.pw .pw-status').textContent };
    },
    [six.ids[0], eqId],
  );
  ok(
    /a bell at .*0\.0 dB/.test(band.line0) &&
      new RegExp(`^Band ${band.n}: a bell at .*\\+2\\.2 dB\\.$`).test(band.line1),
    `Slide Rule's line follows the band it names ("${band.line0}" → "${band.line1}")`,
  );
  // a toast while a window is open never sits on it: beside it where there's room, else a line of its bar
  const tw = await E(async () => {
    const a = window.overdub,
      wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const where = async () => {
      a.ui.toast('Probe: a note while the window is open', { action: { label: 'Undo', run() {} } });
      await wait(400);
      const t = [...document.querySelectorAll('.ew-toast')].find((x) => /Probe: a note/.test(x.textContent)),
        r = t.getBoundingClientRect(),
        w = document.querySelector('.pw').getBoundingClientRect();
      const out = {
        inBar: !!t.closest('.pw .pw-bar'),
        over: !(r.right <= w.left || r.left >= w.right || r.bottom <= w.top || r.top >= w.bottom),
        w: Math.round(w.width),
      };
      t.remove();
      return out;
    };
    const wide = await where(); // (Light Table's window takes the width there is: no room beside it)
    a.plugin.close();
    const t = a.store.get().tracks.find((x) => x.kind === 'instrument'),
      r = a.store.dispatch(
        { type: 'insert.add', track: t.id, insert: { device: 'core.verb' }, ref: 'v' },
        { by: 'you', label: 'plugin test: small window' },
      );
    a.plugin.open({ track: t.id, slot: r.created.v });
    await wait(300);
    const small = await where();
    a.plugin.close();
    await wait(200);
    const after = !!document.querySelector('.pw-toasts');
    a.store.undo();
    return { wide, small, after };
  });
  ok(
    (tw.wide.inBar || !tw.wide.over) && !tw.small.over && !tw.small.inBar,
    `a toast keeps clear of an open window: in a wide window's bar (${tw.wide.inBar ? 'in its bar' : tw.wide.over ? 'over it' : 'beside it'}, ${tw.wide.w} px wide), beside a small one (${tw.small.over ? 'over it' : 'beside it'})`,
  );
  await E((ids) => {
    const a = window.overdub;
    for (const id of ids)
      if (a.store.track(id))
        a.store.dispatch({ type: 'track.remove', track: id }, { by: 'you', label: 'plugin test done' });
  }, six.ids);
  // (the piano's window again, as the A/B checks left it, for what follows)
  await E((id) => window.overdub.plugin.open({ track: id, slot: 'instrument' }), song.inst);
  await sleep(250);

  /* -------- the keyboard strip plays the track; the transport and musical typing still work */
  await E(() => {
    const a = window.overdub;
    window.__notes = [];
    const on = a.engine.liveNoteOn,
      off = a.engine.liveNoteOff;
    a.engine.liveNoteOn = (t, p, v) => {
      window.__notes.push(['on', t, p, +v.toFixed(2)]);
      return on.call(a.engine, t, p, v);
    };
    a.engine.liveNoteOff = (t, p) => {
      window.__notes.push(['off', t, p]);
      return off.call(a.engine, t, p);
    };
  });
  const key = await E(() => {
    const k = document.querySelector('.pw .pk-key-w[data-p="60"]') || document.querySelector('.pw .pk-key-w');
    const r = k.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.85, p: +k.dataset.p };
  });
  await page.mouse.move(key.x, key.y);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(60);
  const played = await E(() => window.__notes.slice());
  ok(
    played.length >= 2 &&
      played[0][0] === 'on' &&
      played[0][1] === song.inst &&
      played[0][2] === key.p &&
      played[0][3] > 0.8 &&
      played[1][0] === 'off',
    `a click on the keyboard strip plays the track, low on a key loud (${JSON.stringify(played.slice(0, 2))})`,
  );
  await E(() => {
    window.__notes.length = 0;
  });
  await page.focus(`.pw .pk-key[data-p="${key.p + 2}"]`).catch(() => {});
  await E((p) => document.querySelector(`.pw .pk-key[data-p="${p}"]`)?.focus(), key.p + 2);
  await page.keyboard.down('Enter');
  await sleep(40);
  await page.keyboard.up('Enter');
  ok(
    await E(
      (p) =>
        window.__notes.some((n) => n[0] === 'on' && n[2] === p) &&
        window.__notes.some((n) => n[0] === 'off' && n[2] === p),
      key.p + 2,
    ),
    "Enter on a focused key plays it for as long as it's held",
  );
  // Space on a knob plays the song (the knob is a slider; Space is the transport's)
  await page.focus('.pw .pk-knob .pk-dial');
  await page.keyboard.press('Space');
  await sleep(500);
  const playing = await E(() => !!(window.overdub.engine.playing || window.overdub.engine.starting));
  await page.keyboard.press('Space');
  await sleep(200);
  ok(
    playing && (await E(() => !window.overdub.engine.playing)),
    'Space plays and stops the song with a knob in the window focused',
  );
  await E(() => {
    window.__notes.length = 0;
  });
  await page.keyboard.press('Backquote');
  await sleep(80);
  await page.keyboard.down('KeyA');
  await sleep(60);
  await page.keyboard.up('KeyA');
  await sleep(60);
  const typed = await E(() => window.__notes.slice());
  await page.keyboard.press('Backquote');
  ok(
    typed.some((n) => n[0] === 'on' && n[1] === song.inst),
    `musical typing plays the device on screen while its window is open (${JSON.stringify(typed.slice(0, 2))})`,
  );
  ok(await E(() => !!window.overdub.plugin.current), 'and none of that closed the window');

  /* -------- Esc only when the window is what you're using; × closes it */
  await E(() => {
    const a = window.overdub;
    a.ui.state.focus = 'arranger';
    document.activeElement?.blur();
  });
  await page.keyboard.press('Escape');
  ok(await E(() => !!window.overdub.plugin.current), 'Esc with the arranger in use leaves the window open');
  await page.click('.pw .pw-x');
  ok(await E(() => !window.overdub.plugin.current && !document.querySelector('.pw')), '× closes it');

  /* -------- drag it, size it; it remembers both for the session */
  await E((id) => window.overdub.plugin.open({ track: id, slot: 'instrument' }), song.inst);
  await sleep(200);
  const g0 = await E(() => {
    const r = document.querySelector('.pw').getBoundingClientRect();
    const h = document.querySelector('.pw .pw-head').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, hx: h.left + h.width * 0.6, hy: h.top + h.height / 2 };
  });
  await page.mouse.move(g0.hx, g0.hy);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(g0.hx - i * 20, g0.hy + i * 6);
  await page.mouse.up();
  const g1 = await E(() => {
    const r = document.querySelector('.pw').getBoundingClientRect();
    const gr = document.querySelector('.pw .pw-grip').getBoundingClientRect();
    return { x: r.left, y: r.top, gx: gr.left + gr.width / 2, gy: gr.top + gr.height / 2 };
  });
  ok(
    Math.abs(g1.x - (g0.x - 100)) <= 1 && Math.abs(g1.y - (g0.y + 30)) <= 1,
    `it drags by its head (moved ${Math.round(g1.x - g0.x)}, ${Math.round(g1.y - g0.y)})`,
  );
  await page.mouse.move(g1.gx, g1.gy);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(g1.gx - i * 15, g1.gy - i * 10);
  await page.mouse.up();
  const g2 = await E(() => {
    const r = document.querySelector('.pw').getBoundingClientRect();
    return { w: r.width, h: r.height, auto: window.overdub.ui.state.pluginWin.auto };
  });
  ok(
    Math.abs(g2.w - (g0.w - 60)) <= 2 && Math.abs(g2.h - (g0.h - 40)) <= 2 && g2.auto === false,
    `it sizes from its corner (${Math.round(g0.w)}×${Math.round(g0.h)} → ${Math.round(g2.w)}×${Math.round(g2.h)})`,
  );
  await E(() => window.overdub.plugin.close());
  await E(
    (fx) =>
      window.overdub.plugin.open({
        track: window.overdub.store.get().tracks.find((t) => t.inserts.some((x) => x.id === fx)).id,
        slot: fx,
      }),
    fxId,
  );
  await sleep(150);
  const g3 = await E(() => {
    const r = document.querySelector('.pw').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  ok(
    Math.abs(g3.x - g1.x) <= 1 &&
      Math.abs(g3.y - g1.y) <= 1 &&
      Math.abs(g3.w - g2.w) <= 1 &&
      Math.abs(g3.h - g2.h) <= 1,
    'another device opens where the last one was, at the size it was given',
  );
  // one at a time: opening another replaces it
  await E((id) => window.overdub.plugin.open({ track: id, slot: 'instrument' }), song.inst);
  ok(
    await E(() => document.querySelectorAll('.pw').length === 1 && window.overdub.plugin.current.slot === 'instrument'),
    'one window at a time: opening another replaces it',
  );
  await E(() => window.overdub.plugin.close());

  /* -------- a song's device that names an editor gets the generic one */
  const trap = await E(async () => {
    const a = window.overdub,
      t = a.store.get().tracks.find((x) => x.kind === 'instrument');
    const src = {
      id: 'claude.pk-trap',
      name: 'Trap Door',
      kind: 'effect',
      cat: 'filter',
      editor: 'pk-trap',
      blurb: 'an effect that names an editor',
      params: [{ key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.5, role: 'drive' }],
      kernel:
        '({ create() { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * (1 + 3 * p.drive)); R[i] = Math.tanh(R[i] * (1 + 3 * p.drive)); } } }; } })',
    };
    const r0 = a.store.dispatch({ type: 'device.define', device: src }, { by: 'claude', label: 'wrote a trap' });
    const r1 = a.store.dispatch(
      { type: 'insert.add', track: t.id, insert: { device: src.id }, ref: 'f' },
      { by: 'claude', label: 'tried it' },
    );
    const def = a.devices.getDevice(src.id);
    const o = a.plugin.open({ track: t.id, slot: r1.created.f });
    await new Promise((r) => setTimeout(r, 400));
    const out = {
      ok: r0.ok && r1.ok && o.ok,
      source: def?.source,
      named: def?.editor,
      rule: a.plugin.editorFor(def),
      editor: document.querySelector('.pw')?.dataset.editor,
      trap: !!window.__trap,
    };
    // a device that came through someone else's link (core/share.js: by the agent, via the guest who sent it; a link
    // names its guests, as addAuthor does here)
    a.store.addAuthor('guest:Jo-x1', { kind: 'human', name: 'Jo' });
    a.store.dispatch(
      {
        type: 'device.define',
        device: { ...src, id: 'claude.pk-via', name: 'Via Box', by: 'claude', via: 'guest:Jo-x1' },
      },
      { by: 'claude', label: 'via' },
    );
    const r2 = a.store.dispatch(
      { type: 'insert.add', track: t.id, insert: { device: 'claude.pk-via' }, ref: 'v' },
      { by: 'claude', label: 'via on' },
    );
    a.plugin.open({ track: t.id, slot: r2.created.v });
    const who = document.querySelector('.pw .pw-who');
    out.via = { text: who?.textContent, bys: [...(who?.querySelectorAll('.by') || [])].map((b) => b.className) };
    a.store.undo();
    a.store.undo();
    // the registry itself, a project device that names one: the same
    a.devices.defineDevice({ ...src, id: 'claude.pk-trap2', name: 'Trap Two', source: 'project' }, { replace: true });
    out.rule2 = a.plugin.editorFor(a.devices.getDevice('claude.pk-trap2'));
    a.plugin.close();
    a.devices.removeDevice('claude.pk-trap2');
    a.store.undo();
    a.store.undo();
    return out;
  });
  ok(
    trap.ok && trap.source === 'project' && trap.named === 'pk-trap',
    `a song's device (an agent's) can carry editor: "pk-trap" (${trap.source}, ${trap.named})`,
  );
  ok(
    /made by Claude, via Jo’s link/.test(trap.via?.text || '') &&
      trap.via.bys.length === 2 &&
      /by-agent/.test(trap.via.bys[0]) &&
      /by-human/.test(trap.via.bys[1]),
    `a device that came through someone's link says whose ("${trap.via?.text}")`,
  );
  ok(
    trap.rule === null && trap.rule2 === null && trap.editor === 'generic' && !trap.trap && hits['pk-trap'] === 0,
    `…and gets the generic editor: its module is never fetched (${hits['pk-trap']} requests, editor ${trap.editor})`,
  );

  /* -------- the custom-editor contract, with a tiny editor served to this page alone */
  const ce = await E(async () => {
    const a = window.overdub;
    const base = a.devices.getDevice('core.pluck');
    a.devices.defineDevice({ ...base, id: 'overdub.pk-test', name: 'Test Bench', editor: 'pk-test', presets: [] });
    a.devices.defineDevice({
      ...base,
      id: 'overdub.pk-broken',
      name: 'Broken Bench',
      editor: 'pk-broken',
      presets: [],
    });
    const t = a.store.get().tracks.find((x) => x.kind === 'instrument');
    a.store.dispatch(
      { type: 'instrument.set', track: t.id, device: 'overdub.pk-test' },
      { by: 'you', label: 'test bench' },
    );
    a.plugin.open({ track: t.id, slot: 'instrument' });
    for (let i = 0; i < 40 && document.querySelector('.pw')?.dataset.editor !== 'pk-test'; i++)
      await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));
    const log = window.__pk || {};
    const out = {
      editor: document.querySelector('.pw')?.dataset.editor,
      rule: a.plugin.editorFor(a.devices.getDevice('overdub.pk-test')),
      mounted: log.mounted,
      keys: log.keys,
      keyboard: log.keyboard,
      meter: log.meter,
      addr: log.addr,
      frames: log.frames,
      knob: !!document.getElementById('pk-test-knob'),
      ctl: document.getElementById('pk-test-ctl')?.dataset.key,
    };
    const h0 = a.store.history.length;
    out.dragOk = window.__pkDrag();
    out.dragSteps = a.store.history.length - h0;
    out.dragTone = a.store.track(t.id).instrument.params.tone;
    out.dragBy = a.store.history[a.store.history.length - 1].by;
    out.knobFollows = +document.querySelector('#pk-test-knob .pk-dial').getAttribute('aria-valuenow');
    const u0 = log.updated;
    a.store.dispatch(
      { type: 'instrument.set', track: t.id, params: { decay: 2.5 } },
      { by: 'claude', label: 'longer' },
    );
    out.agentSeen = log.updates.some((x) => x.by === 'claude' && x.keys.includes('decay'));
    out.updateCalled = log.updated > u0;
    out.ctlFlash = document.getElementById('pk-test-ctl')?.classList.contains('pk-flash');
    a.store.undo();
    out.undoSeen = log.updates.some((x) => x.kind === 'undo');
    // a lane playing: on() hears it move, as kind 'lane'
    a.store.dispatch(
      { type: 'auto.write', track: t.id, insert: 'instrument', param: 'tone', points: '0:0.05 2:0.95' },
      { by: 'you', label: 'tone lane' },
    );
    await a.engine.start?.();
    a.engine.play(0);
    await new Promise((r) => setTimeout(r, 700));
    a.engine.stop();
    out.laneSeen = log.updates.some((x) => x.kind === 'lane' && x.keys.includes('tone'));
    a.store.undo();
    a.plugin.close();
    out.unmounted = log.unmounted;
    // an editor that throws falls back to the generic one
    a.store.dispatch(
      { type: 'instrument.set', track: t.id, device: 'overdub.pk-broken' },
      { by: 'you', label: 'broken bench' },
    );
    a.plugin.open({ track: t.id, slot: 'instrument' });
    for (let i = 0; i < 40 && document.querySelector('.pw')?.dataset.editor === 'loading'; i++)
      await new Promise((r) => setTimeout(r, 50));
    out.broken = document.querySelector('.pw')?.dataset.editor;
    out.brokenControls = document.querySelectorAll('.pw .pk-ctl[data-key]').length;
    a.plugin.close();
    a.store.undo();
    a.store.undo();
    a.store.undo();
    return out;
  });
  ok(
    ce.rule === 'pk-test' && ce.editor === 'pk-test' && hits['pk-test'] === 1 && ce.mounted,
    `a built-in that names an editor loads ui/editors/<name>.js and mounts it (${ce.editor}, ${hits['pk-test']} fetch)`,
  );
  const need = ['addr', 'app', 'def', 'kit', 'keyboard', 'meter', 'on', 'params', 'set', 'control'];
  ok(
    need.every((k) => (ce.keys || []).includes(k)),
    `ctx has ${need.join(', ')} (${(ce.keys || []).join(', ')})`,
  );
  ok(
    ce.keyboard === true && ce.meter === true && ce.addr?.slot === 'instrument' && ce.knob && ce.ctl === 'decay',
    "an instrument's editor gets the keyboard, the meter, its address, kit widgets and bound controls",
  );
  ok(ce.frames > 3, `frame(now) runs while it's open (${ce.frames} frames)`);
  ok(
    ce.dragOk && ce.dragSteps === 1 && ce.dragBy === 'you' && ce.dragTone === 0.41,
    `set() with a gesture: three moves are one undo step, signed you (${ce.dragSteps} step, tone ${ce.dragTone})`,
  );
  ok(ce.knobFollows === 0.41, 'on() tells the editor about its own change, and its knob follows');
  ok(
    ce.agentSeen && ce.updateCalled && ce.ctlFlash,
    `on() and update() hear an agent's change, and a bound control flashes (${ce.agentSeen}, ${ce.updateCalled}, ${ce.ctlFlash})`,
  );
  ok(ce.undoSeen, 'on() hears an undo');
  ok(ce.laneSeen, 'on() hears a lane move the param while the song plays (kind "lane")');
  ok(ce.unmounted, 'unmount() runs when the window closes');
  ok(
    ce.broken === 'generic' && ce.brokenControls > 0,
    `an editor that throws falls back to the generic one (${ce.broken}, ${ce.brokenControls} controls)`,
  );

  /* -------- the kit's widgets from the keyboard, labelled */
  const kit = await E(async () => {
    const k = await import('/app/src/ui/plugin-kit.js');
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;left:10px;top:10px;z-index:3000;background:#141210;padding:10px;display:flex;flex-wrap:wrap;gap:12px;width:900px';
    document.body.append(box);
    const got = {};
    const spec = { key: 'cut', label: 'CUTOFF', min: 40, max: 18000, def: 2400, curve: 'log', unit: 'Hz' };
    const knob = k.knob(spec, {
      value: 1000,
      name: 'Kit',
      onInput: (v, o) => {
        got.knob = [v, o.commit];
      },
    });
    const sl = k.slider(
      { key: 'mix', label: 'MIX', min: 0, max: 100, def: 50, unit: '%' },
      {
        value: 50,
        onInput: (v) => {
          got.slider = v;
        },
      },
    );
    const tg = k.toggle({
      label: 'Sync',
      onChange: (on) => {
        got.toggle = on;
      },
    });
    const sg = k.segmented(
      { key: 'w', label: 'WAVE', opts: ['SAW', 'SQR', 'TRI'], def: 0 },
      {
        value: 0,
        onChange: (i) => {
          got.seg = i;
        },
      },
    );
    const se = k.select(
      { key: 'd', label: 'DIV', opts: ['1/4', '1/8', '1/16', '1/32', '1/2', '1/1'], def: 0 },
      {
        value: 0,
        onChange: (i) => {
          got.sel = i;
        },
      },
    );
    const xy = k.xy({
      x: { key: 'x', label: 'X', min: 0, max: 1, def: 0.5 },
      y: { key: 'y', label: 'Y', min: 0, max: 1, def: 0.5 },
      onInput: (v) => {
        got.xy = v;
      },
    });
    const env = k.envelope({
      attack: { key: 'a', label: 'A', min: 0.001, max: 4, def: 0.01, curve: 'log', unit: 's' },
      decay: { key: 'd', label: 'D', min: 0.01, max: 4, def: 0.3, curve: 'log', unit: 's' },
      sustain: { key: 's', label: 'S', min: 0, max: 1, def: 0.7 },
      release: { key: 'r', label: 'R', min: 0.01, max: 8, def: 0.4, curve: 'log', unit: 's' },
      curves: { attack: { key: 'ac', label: 'AC', min: -1, max: 1, def: 0 } },
      onInput: (p) => {
        got.env = p;
      },
    });
    const lfo = k.lfo({ shape: 'tri', rate: () => 2 });
    const meter = k.meter({ read: () => ({ peak: -6, rms: -12 }) });
    const keys = k.keys({
      lo: 60,
      hi: 72,
      onNote: (p, v, on) => {
        (got.keys ||= []).push([p, on]);
      },
    });
    knob.setMod(0.25);
    box.append(knob.el, sl.el, tg.el, sg.el, se.el, xy.el, env.el, lfo.el, meter.el, keys.el);
    const key = (el, code) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: code, bubbles: true, cancelable: true }));
    key(knob.dial, 'ArrowUp');
    key(sl.dial, 'ArrowRight');
    tg.el.click();
    key(sg.row.querySelector('[aria-checked="true"]'), 'ArrowRight');
    se.el.querySelector('select').value = '2';
    se.el.querySelector('select').dispatchEvent(new Event('change'));
    key(xy.puck, 'ArrowRight');
    key(xy.puck, 'ArrowUp');
    const hs = env.el.querySelectorAll('.pk-env-h');
    key(hs[0], 'ArrowRight');
    const kk = keys.el.querySelector('[data-p="64"]');
    kk.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    kk.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const named = (el) =>
      !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent.trim());
    const out = {
      knob: got.knob,
      knobRole: knob.dial.getAttribute('role'),
      knobText: knob.dial.getAttribute('aria-valuetext'),
      mod: !!knob.el.querySelector('.pk-mod').getAttribute('d'),
      slider: got.slider,
      sliderRole: sl.dial.getAttribute('role') + ':' + sl.dial.getAttribute('aria-orientation'),
      toggle: got.toggle,
      togPressed: tg.el.getAttribute('aria-pressed'),
      seg: got.seg,
      segRole: sg.row.getAttribute('role'),
      sel: got.sel,
      xy: got.xy,
      xyText: xy.puck.getAttribute('aria-valuetext'),
      env: got.env,
      envHandles: hs.length,
      envRoles: [...hs].every((x) => x.getAttribute('role') === 'slider' && named(x)),
      lfo: !!lfo.el.querySelector('canvas'),
      meterRole: meter.el.getAttribute('role'),
      keys: got.keys,
      keyNames: [...keys.el.querySelectorAll('.pk-key')].every(named),
      allNamed: [...box.querySelectorAll('[role=slider], [role=radio], button, select')].every(named),
    };
    await new Promise((r) => setTimeout(r, 200));
    out.drawn = (() => {
      const c = lfo.el.querySelector('canvas');
      return c.width > 0;
    })();
    box.remove();
    return out;
  });
  ok(
    kit.knob && kit.knob[0] > 1000 && kit.knob[1] === true && kit.knobRole === 'slider' && /Hz/.test(kit.knobText),
    `kit knob: a slider for a screen reader, the arrow keys turn it on its log travel (${kit.knob?.[0]}, "${kit.knobText}")`,
  );
  ok(kit.mod, 'kit knob: a modulation ring around it');
  ok(kit.slider > 50 && kit.sliderRole === 'slider:horizontal', `kit slider (${kit.slider}, ${kit.sliderRole})`);
  ok(kit.toggle === true && kit.togPressed === 'true', 'kit toggle: a lamp with aria-pressed');
  ok(kit.seg === 1 && kit.segRole === 'radiogroup', 'kit segmented: a radio group the arrows walk');
  ok(kit.sel === 2, 'kit select');
  ok(
    Array.isArray(kit.xy) && kit.xy[0] > 0.5 && kit.xy[1] > 0.5 && /X .+, Y .+/.test(kit.xyText),
    `kit XY pad: arrows move both axes ("${kit.xyText}")`,
  );
  ok(
    kit.env && Object.keys(kit.env).includes('a') && kit.envHandles === 4 && kit.envRoles,
    `kit envelope: four handles (three points and a curve), each a labelled slider, the arrows move them (${JSON.stringify(kit.env)})`,
  );
  ok(kit.lfo && kit.drawn, "kit LFO view draws on its canvas from the window's frame");
  ok(kit.meterRole === 'meter', 'kit meter: role meter');
  ok(
    JSON.stringify(kit.keys) ===
      JSON.stringify([
        [64, true],
        [64, false],
      ]) && kit.keyNames,
    `kit keys: Enter plays the focused key, every key named (${JSON.stringify(kit.keys)})`,
  );
  ok(kit.allNamed, 'every kit control has a name');

  /* -------- the tool */
  const tool = await E(async () => {
    const a = window.overdub,
      p = a.store.get();
    const t = p.tracks.find((x) => x.kind === 'instrument'),
      audio = p.tracks.find((x) => x.kind === 'audio');
    document.querySelector('.ew-toggles button')?.focus();
    const was = document.activeElement;
    const r = await a.tools.run('show_device', { track: t.name }, { by: 'claude' });
    const shown = { r, cur: a.plugin.current, kept: document.activeElement === was };
    const nope = await a.tools.run('show_device', { track: 'No Such Track' }, { by: 'claude' });
    const noInst = audio
      ? await a.tools.run('show_device', { track: audio.id, slot: 'instrument' }, { by: 'claude' })
      : { error: 'skipped', hint: 'no audio track' };
    const fx = audio?.inserts[0]
      ? await a.tools.run('show_device', { track: audio.name, slot: audio.inserts[0].id }, { by: 'claude' })
      : null;
    const fxCur = a.plugin.current;
    const closed = await a.tools.run('show_device', { close: true }, { by: 'claude' });
    const again = await a.tools.run('show_device', { close: true }, { by: 'claude' });
    return { shown, nope, noInst, fx, fxCur, closed, again, open: !!a.plugin.current };
  });
  ok(
    tool.shown.r.ok &&
      tool.shown.cur?.track &&
      /on /.test(tool.shown.r.showing) &&
      Array.isArray(tool.shown.r.sections) &&
      tool.shown.r.sections.length >= 1,
    `show_device opens a device's window for the person and says what it shows ("${tool.shown.r.showing}", ${tool.shown.r.sections?.length} section(s))`,
  );
  ok(tool.shown.kept, "it leaves the person's focus where it was");
  ok(
    tool.nope.error && /no track/.test(tool.nope.error) && /tracks:/.test(tool.nope.hint),
    `an unknown track: an error with the tracks as a hint ("${tool.nope.error}")`,
  );
  ok(
    tool.noInst.error && tool.noInst.hint,
    `an audio track's instrument: an error that names its effects ("${tool.noInst.error}"; ${tool.noInst.hint})`,
  );
  ok(
    !tool.fx || (tool.fx.ok && tool.fxCur?.slot && tool.fxCur.slot !== 'instrument'),
    `an effect by its insert id (${tool.fx?.showing || 'no audio track'})`,
  );
  ok(
    tool.closed.ok &&
      tool.closed.closed &&
      !tool.open &&
      tool.again.closed === null &&
      /No device window/.test(tool.again.note),
    `close: true closes it, and says when there was none ("${tool.again.note}")`,
  );

  /* -------- presence: an agent pointing at the device */
  const pres = await E(() => {
    const a = window.overdub,
      t = a.store.get().tracks.find((x) => x.kind === 'instrument');
    a.plugin.open({ track: t.id, slot: 'instrument' });
    const list = [
      { id: 'p1', by: 'claude', track: t.id, instrument: true, note: 'warming it up', until: Date.now() + 5000 },
    ];
    a.ui.state.presence = list;
    a.ui.emit('presence', list);
    const text = document.querySelector('.pw .pw-pres')?.textContent;
    a.ui.state.presence = [];
    a.ui.emit('presence', []);
    return { text, gone: !document.querySelector('.pw .pw-pres') };
  });
  ok(
    pres.text === 'Claude: warming it up' && pres.gone,
    `an agent pointing at the device: crop marks and its line ("${pres.text}")`,
  );
  await E(() => window.overdub.plugin.close());

  /* -------- liner notes: no stripe, no pill, no glow gradient, no glass in its CSS; authorship is a byline */
  const cssCheck = await E(() => {
    const own = [...document.querySelectorAll('style[data-css]')]
      .filter((s) => /^plugin/.test(s.dataset.css))
      .map((s) => s.textContent)
      .join('\n');
    return {
      n: own.length,
      stripes: (own.match(/inset\s+-?\d+(\.\d+)?px\s+0\s+0|border-(left|right|top)\s*:\s*[2-9]px solid/g) || []).length,
      pills: (own.match(/border-radius:\s*(99|999|9999)px/g) || []).length,
      glass: (own.match(/backdrop-filter/g) || []).length,
      glow: (own.match(/radial-gradient/g) || []).length,
    };
  });
  ok(
    cssCheck.n > 1000 && !cssCheck.stripes && !cssCheck.pills && !cssCheck.glass && !cssCheck.glow,
    `its CSS has no coloured edge, no pill, no glass, no glow gradient (${JSON.stringify(cssCheck)})`,
  );
  const credit = await E(() => {
    const a = window.overdub,
      fx = a.store
        .get()
        .tracks.flatMap((t) => t.inserts.map((x) => [t.id, x]))
        .find(([, x]) => a.devices.getDevice(x.device)?.by === 'claude');
    if (!fx) return null;
    a.plugin.open({ track: fx[0], slot: fx[1].id });
    const who = document.querySelector('.pw .pw-who');
    const out = {
      text: who?.textContent,
      by: who?.querySelector('.by')?.className,
      color: who?.querySelector('.by') ? getComputedStyle(who.querySelector('.by')).color : null,
    };
    a.plugin.close();
    return out;
  });
  ok(
    !credit ||
      (/made by Claude/.test(credit.text) && /by-agent/.test(credit.by) && credit.color === 'rgb(76, 195, 255)'),
    `who made it is a byline in its ink ("${credit?.text}")`,
  );

  ok(
    !ours(errors).length,
    `desktop: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`,
  );
} catch (e) {
  ok(false, 'desktop run threw: ' + ((e && e.stack) || e));
}
await s.close();

/* ======================================================================== a phone: a full-height sheet */
{
  const p = await open('/app/', { query: 'demo', width: 390, height: 844 });
  const { page, errors, shot } = p;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(400);
    const E = (fn, arg) => page.evaluate(fn, arg);
    await E(() => {
      const a = window.overdub,
        t = a.store.get().tracks.find((x) => x.kind === 'instrument');
      a.store.dispatch({ type: 'instrument.set', track: t.id, device: 'core.poly' }, { by: 'you' });
      a.plugin.open({ track: t.id, slot: 'instrument' });
    });
    await sleep(500);
    const m = await E(() => {
      const el = document.querySelector('.pw'),
        r = el.getBoundingClientRect();
      const texts = [...el.querySelectorAll('*')].filter(
        (x) => x.getClientRects().length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
      );
      const small = texts
        .map((x) => [x.className, parseFloat(getComputedStyle(x).fontSize), x.textContent.trim().slice(0, 16)])
        .filter((x) => x[1] < 12);
      const box = (q) =>
        [...el.querySelectorAll(q)]
          .filter((x) => x.getClientRects().length)
          .map((x) => {
            const b = x.getBoundingClientRect();
            return [Math.round(b.width), Math.round(b.height)];
          });
      // a target can be bigger than what's drawn (a ::before): measure what a finger at its edge reaches
      el.querySelector('.pk-env')?.scrollIntoView({ block: 'center' });
      const reach = (q) =>
        [...el.querySelectorAll(q)]
          .filter((x) => x.getClientRects().length)
          .map((x) => {
            const b = x.getBoundingClientRect(),
              cx = b.left + b.width / 2,
              cy = b.top + b.height / 2;
            const at = (dx, dy) => {
              const t = document.elementFromPoint(cx + dx, cy + dy);
              return !!t && (t === x || x.contains(t));
            };
            return at(-20, 0) && at(20, 0) && at(0, -20) && at(0, 20);
          });
      return {
        r: r.toJSON(),
        vw: innerWidth,
        vh: innerHeight,
        small,
        close: box('.pw-x'),
        keys: box('.pw-bar .pw-key'),
        btns: box('.pw-bar .btn, .pw-bar .tog'),
        dials: box('.pk-dial'),
        seg: box('.pk-seg-b'),
        whites: box('.pk-key-w'),
        blacks: box('.pk-key-b'),
        play: box('.pw-play'),
        envReach: reach('.pk-env-h'),
      };
    });
    await shot('plugin-phone');
    T.ok(
      m.r.left === 0 && m.r.top === 0 && Math.round(m.r.width) === m.vw && Math.round(m.r.height) === m.vh,
      `phone: the window is a full-height sheet (${Math.round(m.r.width)}×${Math.round(m.r.height)} of ${m.vw}×${m.vh})`,
    );
    T.ok(
      !m.small.length,
      `phone: no text under 12 px${
        m.small.length
          ? ' (' +
            m.small
              .slice(0, 4)
              .map((x) => `${x[0]} ${x[1]}px "${x[2]}"`)
              .join('; ') +
            ')'
          : ''
      }`,
    );
    const all44 = (xs) => xs.length > 0 && xs.every(([w, hh]) => w >= 44 && hh >= 44);
    T.ok(
      all44(m.close) && all44(m.play) && all44(m.keys) && all44(m.btns) && all44(m.seg),
      `phone: close, play, the preset and A/B keys, the buttons and the switches are 44 px (${[m.close, m.play, m.keys, m.btns, m.seg].map((xs) => (xs.length ? Math.min(...xs.map(([w, hh]) => Math.min(w, hh))) : 0)).join(', ')})`,
    );
    T.ok(
      m.dials.length && m.dials.every(([w]) => w >= 60),
      `phone: knobs are 60 px (${Math.min(...m.dials.map(([w]) => w))})`,
    );
    T.ok(
      m.whites.length >= 8 && m.whites.every(([w, hh]) => w >= 44 && hh >= 44) && m.blacks.every(([, hh]) => hh >= 44),
      `phone: the keyboard's keys are 44 px wide and tall (white ${Math.min(...m.whites.map(([w]) => w))} px, black ${Math.min(...m.blacks.map(([, hh]) => hh))} px tall)`,
    );
    T.ok(m.envReach.length && m.envReach.every(Boolean), 'phone: an envelope point is a 44 px target under a finger');
    // a toast while the sheet is up is a line of its bar, its action a 44 px key: nothing floats over the controls (a
    // toast covered Gaffer Tape's Depth, Input and Output for over 3 s)
    const tb = await E(async () => {
      window.overdub.ui.toast('Probe: Take 2 is in.', { action: { label: 'Undo', run() {} } });
      await new Promise((r) => setTimeout(r, 400));
      const t = [...document.querySelectorAll('.ew-toast')].find((x) => /Probe: Take 2/.test(x.textContent)),
        b = document.querySelector('.pw-body').getBoundingClientRect(),
        r = t.getBoundingClientRect(),
        act = t.querySelector('.ew-toast-act').getBoundingClientRect();
      const out = {
        inBar: !!t.closest('.pw .pw-bar'),
        overBody: r.bottom > b.top + 1 && r.top < b.bottom - 1,
        act: [Math.round(act.width), Math.round(act.height)],
      };
      t.remove();
      return out;
    });
    T.ok(
      tb.inBar && !tb.overBody && tb.act[1] >= 44,
      `phone: a toast while the window is up is a line of its bar, not over the controls (its Undo ${tb.act.join('x')})`,
    );
    await E(() => {
      document.querySelector('.pw-body').scrollTop = 600;
    });
    await sleep(150);
    await shot('plugin-phone-scrolled');
    await page.click('.pw .pw-x');
    await sleep(200);
    T.ok(await E(() => !window.overdub.plugin.current), 'phone: × closes the sheet');
    T.ok(
      !ours(errors).length,
      `phone: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`,
    );
  } catch (e) {
    T.ok(false, 'phone run threw: ' + ((e && e.stack) || e));
  }
  await p.close();
}
T.done();
