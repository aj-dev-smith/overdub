// Keyboard, touch and assistive-tech checks for the studio [ui]: Space and Enter press the focused button (not the
// transport), tabs and menus take arrow keys, popovers take focus and give it back, the "?" sheet keeps Tab inside,
// clips and notes can be reached from the keyboard, a touch hold opens the clip and track menus (iOS sends no
// contextmenu), the inspector deletes and duplicates without a gesture, reduced motion holds still, toasts with an
// action wait, single-letter keys can be switched off, labels name their track, and the "Take one" coach keeps focus,
// announces each step and fits a phone. Also: the panels' modules are fetched together, not one after another. And the
// studio's Find anything: every control on its first screen has a name, its note is a status line, and Find opens
// from the keyboard with focus inside, a combobox over a named listbox, and gives focus back on Esc, on a desktop and a
// phone.
//   node tools/a11y-test.js      (screenshots: tools/.out/a11y-*.png)
import path from 'node:path';
import { open, tally, OUTDIR } from './pw.js';

const T = tally('a11y');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) =>
  /Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext|getUserMedia|NotAllowedError|NotFoundError/.test(e);

/* ======================================================================== desktop: keyboard */
{
  const s = await open('/app/', { query: 'demo' });
  const { page, errors } = s;
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(400);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const playing = () => E(() => !!overdub.engine.playing);
  const stopAll = () =>
    E(() => {
      if (overdub.engine.playing) overdub.engine.stop();
      overdub.engine.seek(0);
    });
  await E(() => document.querySelector('.ar-welcome-x')?.click());

  /* -------- boot: the panels' graphs are fetched together */
  const boot = await E(() => {
    const rs = performance.getEntriesByType('resource');
    const at = (re) => rs.find((r) => re.test(r.name));
    const a = at(/\/src\/ui\/transport\.js$/),
      b = at(/\/src\/ui\/onboard\.js$/),
      c = at(/\/src\/analytics\.js$/),
      arr = at(/\/src\/ui\/arranger\.js$/);
    return {
      a: a?.startTime,
      b: b?.startTime,
      c: c?.startTime,
      arrEnd: arr?.responseEnd,
      loading: document.querySelectorAll('.ew-loading').length,
    };
  });
  T.ok(
    boot.a != null && boot.c != null && boot.c < boot.arrEnd + 5,
    `the last module (analytics.js) is requested before the second (arranger.js) has arrived: all at once (${Math.round(boot.c - boot.a)} ms after transport.js; arranger.js done at +${Math.round(boot.arrEnd - boot.a)} ms)`,
  );
  T.ok(boot.loading === 0, 'the "Setting up the room…" placeholders are gone once the studio is ready');
  T.ok(
    await E(
      () =>
        overdub.ui.keys.list().findIndex((k) => k.key === 'KeyZ' && k.mod === 'mod') <
        overdub.ui.keys.list().findIndex((k) => k.key === 'Space'),
    ),
    '⌘Z is registered before the panels load',
  );

  /* -------- Enter and Space press the focused button, never the transport (issue: the key handler took them first) */
  await stopAll();
  const toggle = async (key) => {
    await E(() => document.querySelector('.ew-toggles button[aria-label="Agent (A)"]').focus());
    const before = await E(() => overdub.ui.isOpen('right'));
    await page.keyboard.press(key);
    await sleep(120);
    return { flipped: (await E(() => overdub.ui.isOpen('right'))) !== before, playing: await playing() };
  };
  let r = await toggle('Enter');
  T.ok(r.flipped && !r.playing, `Enter on the focused "Agent (A)" toggle presses it (${JSON.stringify(r)})`);
  r = await toggle('Space');
  T.ok(r.flipped && !r.playing, `Space on it presses it too, and the song doesn't start (${JSON.stringify(r)})`);
  const beat0 = await E(() => {
    overdub.engine.seek(4);
    return overdub.engine.beat;
  });
  await E(() => {
    const t = [...document.querySelectorAll('.ew-region-bottom > .ew-tabs [role=tab]')].find(
      (x) => x.getAttribute('aria-selected') !== 'true',
    );
    t.dataset.probe = '1';
    t.focus();
  });
  await page.keyboard.press('Enter');
  await sleep(120);
  const tab = await E(() => ({
    sel: document.querySelector('[data-probe="1"]').getAttribute('aria-selected'),
    beat: overdub.engine.beat,
  }));
  T.ok(
    tab.sel === 'true' && Math.abs(tab.beat - beat0) < 1e-6,
    `Enter on a tab selects it and doesn't send the playhead home (${JSON.stringify(tab)})`,
  );
  // arrows walk the tabs
  const tabs0 = await E(() =>
    [...document.querySelectorAll('.ew-region-bottom > .ew-tabs [role=tab]')].map((t) => t.textContent),
  );
  await page.keyboard.press('ArrowRight');
  await sleep(80);
  const walked = await E(() => ({
    dbg: [...document.querySelectorAll('.ew-region-bottom > .ew-tabs [role=tab]')]
      .map((t) => t.textContent + ':' + t.tabIndex + ':' + t.getAttribute('aria-selected'))
      .join(' '),
    on:
      document.activeElement.getAttribute('role') === 'tab' &&
      document.activeElement.getAttribute('aria-selected') === 'true',
    name: document.activeElement.textContent,
    tabbable: [...document.querySelectorAll('.ew-region-bottom > .ew-tabs [role=tab]')].filter((t) => t.tabIndex === 0)
      .length,
  }));
  T.ok(
    walked.on && walked.tabbable === 1,
    `→ on a tab moves to the next one and shows it; one tab stop per strip (${walked.name} of ${tabs0.length}${walked.on && walked.tabbable === 1 ? '' : '; ' + walked.dbg})`,
  );
  await E(() => {
    document.querySelector('[data-probe="1"]')?.removeAttribute('data-probe');
  });
  // a toast's action, by keyboard
  await E(() => {
    window.__acted = 0;
    overdub.ui.toast('Probe', {
      action: {
        label: 'Do it',
        run: () => {
          window.__acted++;
        },
      },
    });
  });
  await E(() => [...document.querySelectorAll('.ew-toast button')].at(-1).focus());
  await page.keyboard.press('Enter');
  await sleep(80);
  T.ok((await E(() => window.__acted)) === 1 && !(await playing()), "Enter on a toast's action runs it");
  // Space with nothing focused still plays (the transport keeps its key)
  await E(() => document.activeElement?.blur?.());
  await page.mouse.click(700, 500);
  await E(() => {
    overdub.engine.seek(0);
    document.activeElement?.blur?.();
  });
  await page.keyboard.press('Space');
  await sleep(300);
  T.ok(await playing(), 'Space with no control focused still plays');
  await page.keyboard.press('Space');
  await sleep(150);
  await stopAll();

  /* -------- keyboard focus arms a panel's keys, and the lanes have a clip cursor */
  await E(() => {
    overdub.ui.state.focus = 'mixer';
    document.querySelector('.ar-scroll').focus();
  });
  T.ok(
    (await E(() => overdub.ui.state.focus)) === 'arranger',
    'keyboard focus moving into the arranger makes it the focused panel (focusin, not only a click)',
  );
  const vis = await E(() => {
    const el = document.querySelector('.ar-scroll');
    return { fv: el.matches(':focus-visible'), o: getComputedStyle(el).outlineStyle };
  });
  T.ok(
    !vis.fv || vis.o === 'solid',
    `the lanes show a focus ring when focused from the keyboard (${JSON.stringify(vis)})`,
  );
  await E(() => overdub.ui.select({ track: null, clip: null, notes: [], range: null }));
  await page.keyboard.press('ArrowRight');
  await sleep(120);
  const c1 = await E(() => ({
    sel: overdub.ui.state.selection.clip,
    said: document.querySelector('.ar .sr-only[aria-live]')?.textContent || '',
  }));
  await sleep(80);
  const said1 = await E(() => document.querySelector('.ar .sr-only[aria-live]')?.textContent || '');
  T.ok(
    !!c1.sel && /Track .+, clip .+, bars? \d/.test(said1),
    `→ in the lanes picks a clip and says which ("${said1}")`,
  );
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  const c2 = await E(() => ({ clip: overdub.ui.state.selection.clip, track: overdub.ui.state.selection.track }));
  const t1 = await E((id) => overdub.store.findClip(id)?.track.id, c1.sel);
  T.ok(c2.track && c2.track !== t1, `↓ moves to the track below (${t1} → ${c2.track})`);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await sleep(80);
  // the menu from the keyboard, and back
  const cur = await E(() => overdub.ui.state.selection.clip);
  if (cur) {
    await page.keyboard.press('Shift+F10');
    await sleep(150);
    const m = await E(() => {
      const p = document.querySelector('.ek-pop[role=menu]');
      return {
        open: !!p,
        label: p?.getAttribute('aria-label'),
        inside: !!p && p.contains(document.activeElement),
        item: document.activeElement?.getAttribute('role'),
        items: p ? [...p.querySelectorAll('[role=menuitem]')].map((b) => b.textContent) : [],
      };
    });
    T.ok(
      m.open && m.inside && m.item === 'menuitem' && m.items.some((x) => /Delete/.test(x)),
      `Shift+F10 opens the clip's menu with focus on its first item (${m.label}: ${m.items.length} items)`,
    );
    const f0 = await E(() => document.activeElement.textContent);
    await page.keyboard.press('ArrowDown');
    const f1 = await E(() => document.activeElement.textContent);
    await page.keyboard.press('End');
    const f2 = await E(() => document.activeElement.textContent);
    T.ok(
      f0 !== f1 && /Delete/.test(f2) && (await E(() => overdub.ui.state.selection.clip)) === cur,
      `↓ and End move through the menu, and don't move the clip cursor (${f0} → ${f1} → ${f2})`,
    );
    await page.keyboard.press('Escape');
    await sleep(80);
    T.ok(
      await E(
        () => !document.querySelector('.ek-pop') && document.activeElement === document.querySelector('.ar-scroll'),
      ),
      'Esc closes it and focus goes back to the lanes',
    );
    await page.keyboard.press('F2');
    await sleep(80);
    T.ok(await E(() => document.activeElement?.classList.contains('ar-clipinput')), 'F2 renames the clip');
    await page.keyboard.press('Escape');
    const n0 = await E(() => overdub.store.get().tracks.reduce((a, t) => a + t.clips.length, 0));
    await E(() => document.querySelector('.ar-scroll').focus());
    await page.keyboard.press('Delete');
    await sleep(80);
    const n1 = await E(() => overdub.store.get().tracks.reduce((a, t) => a + t.clips.length, 0));
    T.ok(n1 === n0 - 1, `Delete removes the clip under the cursor (${n0} → ${n1})`);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyZ' : 'Control+KeyZ');
    await sleep(80);
    await E(() => {
      overdub.ui.select({ clip: null });
      document.querySelector('.ar-scroll').focus();
    });
    await page.keyboard.press('ArrowRight');
    await sleep(50);
    await page.keyboard.press('Enter');
    await sleep(200);
    const ed = await E(() => ({ pr: overdub.ui.active('bottom') }));
    T.ok(/pianoroll|drumgrid/.test(ed.pr), `Enter opens the clip in its editor (${ed.pr})`);
  } else T.ok(false, 'a clip under the cursor');

  /* -------- the piano roll from the keyboard (chromatic: Scale lock off; panes-test checks it on) */
  const pr = await E(() => {
    overdub.input.qwerty.setScaleLock(false);
    const t = overdub.store
      .get()
      .tracks.find(
        (x) =>
          x.clips.some((c) => c.kind === 'notes' && c.notes.length > 2) &&
          !/drum|beat/i.test(x.name + x.instrument?.device),
      );
    const c = t.clips.find((x) => x.kind === 'notes' && x.notes.length > 2);
    overdub.ui.select({ track: t.id, clip: c.id, notes: [] });
    overdub.ui.show('pianoroll');
    return { t: t.id, c: c.id };
  });
  await sleep(200);
  await E(() => document.querySelector('.pr-scroll').focus());
  T.ok(
    (await E(() => overdub.ui.state.focus)) === 'pianoroll',
    'tabbing into the piano roll arms its keys (focus is pianoroll)',
  );
  await page.keyboard.press('Alt+ArrowRight');
  await sleep(80);
  const pick = await E((x) => {
    const ids = [...overdub.ui.state.selection.notes];
    const n = overdub.store.findClip(x.c).clip.notes.find((q) => q.id === ids[0]);
    return { n: ids.length, p: n?.p, id: n?.id };
  }, pr);
  T.ok(pick.n === 1, `Alt+→ picks a note (${pick.n} selected)`);
  await page.keyboard.press('ArrowUp');
  await sleep(80);
  const moved = await E((x) => overdub.store.findClip(x.c).clip.notes.find((q) => q.id === x.id)?.p, {
    ...pr,
    id: pick.id,
  });
  T.ok(moved === pick.p + 1, `↑ then moves it up a semitone (${pick.p} → ${moved})`);
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await sleep(50);
  T.ok((await E(() => overdub.ui.state.selection.notes.size)) === 2, 'Alt+Shift+→ adds the next note');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyZ' : 'Control+KeyZ');

  /* -------- popovers take focus and give it back; the Song menu takes arrows */
  await E(() => document.querySelector('.sm-btn').focus());
  await page.keyboard.press('Enter');
  await sleep(150);
  const sm = await E(() => {
    const p = document.querySelector('.ew-pop');
    return { open: !!p, label: p?.getAttribute('aria-label'), inside: !!p && p.contains(document.activeElement) };
  });
  T.ok(
    sm.open && sm.inside && sm.label === 'Song',
    `Enter on Song opens its menu with focus inside, named (${JSON.stringify(sm)})`,
  );
  const s0 = await E(() => document.activeElement.textContent);
  await page.keyboard.press('ArrowDown');
  T.ok(
    (await E(() => document.activeElement.textContent)) !== s0 && !(await playing()),
    '↓ moves through the Song menu',
  );
  await page.keyboard.press('Escape');
  await sleep(80);
  T.ok(
    await E(() => !document.querySelector('.ew-pop') && document.activeElement === document.querySelector('.sm-btn')),
    'Esc closes it and focus goes back to Song',
  );

  /* -------- "?" keeps Tab inside, and single-letter keys can be switched off */
  await E(() => document.activeElement?.blur?.());
  await page.keyboard.press('Shift+Slash');
  await sleep(250);
  const inside = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    inside.push(await E(() => !!document.activeElement?.closest('.tpk')));
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Shift+Tab');
    inside.push(await E(() => !!document.activeElement?.closest('.tpk')));
  }
  T.ok(
    inside.every(Boolean),
    `Tab and Shift+Tab stay inside the "?" sheet (${inside.map((x) => (x ? 'in' : 'OUT')).join(' ')})`,
  );
  const toggleBox = await E(() => !!document.querySelector('.tpk #tpk-single'));
  T.ok(toggleBox, 'the sheet has a "Single-key shortcuts" switch');
  const l0 = await E(() => overdub.store.get().loop.on);
  await page.keyboard.press('KeyL');
  T.ok((await E(() => overdub.store.get().loop.on)) === l0, 'behind the open sheet, L does nothing');
  await page.keyboard.press('Escape');
  await sleep(250);
  const loop0 = await E(() => overdub.store.get().loop.on);
  await E(() => {
    overdub.ui.keys.single(false);
    document.activeElement?.blur?.();
  });
  await page.keyboard.press('KeyL');
  await sleep(60);
  const off = await E(() => overdub.store.get().loop.on);
  await E(() => overdub.ui.keys.single(true));
  await page.keyboard.press('KeyL');
  await sleep(60);
  const on = await E(() => overdub.store.get().loop.on);
  T.ok(
    off === loop0 && on !== loop0,
    `with single-key shortcuts off, L does nothing; on again, it loops (${loop0} → ${off} → ${on})`,
  );
  T.ok(
    await E(() => {
      try {
        return JSON.parse(localStorage.getItem('overdub:keys')).single === true;
      } catch {
        return false;
      }
    }),
    'the switch is remembered (overdub:keys)',
  );
  if (on !== loop0) await page.keyboard.press('KeyL');

  /* -------- labels that say which track, and a tempo with a value */
  const lab = await E(() => {
    const t = overdub.store.get().tracks[0];
    const row = document.querySelector(`.ar-head[data-track="${t.id}"]`);
    const tp = document.querySelector('.tp-tempo');
    return {
      mute: row.querySelector('.ar-hb-mute').getAttribute('aria-label'),
      name: t.name,
      now: tp.getAttribute('aria-valuenow'),
      text: tp.getAttribute('aria-valuetext'),
      tempo: overdub.store.get().tempo,
    };
  });
  T.ok(lab.mute === `Mute: ${lab.name}`, `track buttons name their track ("${lab.mute}")`);
  T.ok(
    +lab.now === lab.tempo && lab.text === `${lab.tempo} BPM`,
    `the tempo spin button has a value (${lab.now}, "${lab.text}")`,
  );
  await E(() => {
    const t = overdub.store.get().tracks.find((x) => x.inserts.length);
    overdub.ui.select({ track: t.id, clip: null });
    overdub.ui.show('rack');
  });
  await sleep(400);
  const rx = await E(() =>
    [...document.querySelectorAll('[data-panel="rack"] .rk-x')].map((b) => b.getAttribute('aria-label')),
  );
  T.ok(
    rx.length > 0 && rx.every((l) => /^Remove .+/.test(l) && l !== 'Remove (Delete)') && new Set(rx).size === rx.length,
    `each Remove names its device (${rx.slice(0, 3).join(', ')})`,
  );

  /* -------- Sketch's Record view never prints "null" */
  await E(async () => {
    const st = overdub.store;
    const ops = st
      .get()
      .tracks.filter((t) => t.kind === 'audio')
      .map((t) => ({ type: 'track.set', track: t.id, patch: { arm: false } }));
    st.dispatch([...ops, { type: 'track.add', track: { kind: 'audio', name: 'Gtr', arm: true } }], { by: 'you' });
    try {
      await overdub.input.audio.open();
    } catch {
      /* fake device */
    }
    overdub.ui.show('sketch');
    overdub.input.emit('sketch:mode', 'rec');
  });
  await sleep(500);
  const rec = await E(() => document.querySelector('.sk-recside')?.innerText || '');
  T.ok(
    rec && !/\bnull\b/.test(rec),
    `Record view for an armed track with no inserts has no "null" (${rec.replace(/\s+/g, ' ').slice(0, 60)}…)`,
  );

  /* -------- reduced motion: loops stop, pseudo-elements included */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await E(() => {
    const box = document.createElement('div');
    box.id = 'rm-probe';
    box.innerHTML =
      '<span class="ag-chip-live"><span class="ag-chip-i">◌</span></span><span class="sk-live">Rolling</span><button class="tp-btn tp-rec on">r</button>';
    document.body.append(box);
  });
  const frames = await E(
    () =>
      new Promise((res) => {
        const el = document.querySelector('#rm-probe .ag-chip-i'),
          out = [];
        const tick = () => {
          out.push(getComputedStyle(el).transform);
          if (out.length < 12) requestAnimationFrame(tick);
          else res(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  T.ok(
    new Set(frames).size === 1,
    `reduced motion: the working spinner holds still (${new Set(frames).size} distinct transforms in 12 frames)`,
  );
  const pse = await E(() => {
    const cs = getComputedStyle(document.querySelector('#rm-probe .sk-live'), '::before');
    return { d: cs.animationDuration, n: cs.animationIterationCount };
  });
  T.ok(
    pse.n === '1' && parseFloat(pse.d) < 0.01,
    `reduced motion reaches ::before ("Rolling" pulse: ${pse.d} × ${pse.n})`,
  );
  await E(() => document.getElementById('rm-probe').remove());
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  /* -------- a toast with an action waits */
  await E(() => {
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    overdub.ui.toast('Plain');
    overdub.ui.toast('With an action', { action: { label: 'Undo', run: () => {} } });
  });
  await sleep(4200);
  const ts = await E(() => [...document.querySelectorAll('.ew-toast:not(.out)')].map((t) => t.textContent));
  T.ok(
    !ts.some((t) => /Plain/.test(t)) && ts.some((t) => /With an action/.test(t)),
    `after 4 s the plain toast is gone and the one with Undo is still there (${ts.join(' | ')})`,
  );

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `desktop: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
}

/* ======================================================================== desktop: the coach keeps focus and talks */
{
  const s = await open('/app/', { query: 'demo&coach' });
  const { page, errors } = s;
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForSelector('.ob');
  const E = (fn, arg) => page.evaluate(fn, arg);
  const st0 = await E(() => overdub.onboard.step);
  await E(() => document.querySelector('.ob .ob-skip').focus());
  await page.keyboard.press('Enter');
  await sleep(150);
  const a = await E(() => ({
    step: overdub.onboard.step,
    act: document.activeElement?.className,
    tag: document.activeElement?.tagName,
    playing: !!overdub.engine.playing,
  }));
  T.ok(a.step !== st0, `Enter on "Skip this step" moves the tour on (${st0} → ${a.step})`);
  T.ok(a.act === 'ob-t' && !a.playing, `focus lands on the new step's title, not <body> (${a.tag}.${a.act})`);
  await sleep(150);
  const said = await E(() => document.querySelector('.ob .ob-live')?.textContent || '');
  const title = await E(() => document.querySelector('.ob .ob-t')?.textContent || '');
  T.ok(
    said.startsWith(title) && said.length > title.length,
    `the step is announced in a live region that lasts ("${said.slice(0, 70)}…")`,
  );
  T.ok(
    await E(() => document.querySelectorAll('.ob [aria-live]').length === 1),
    'one live region in the card, not one per paint',
  );
  await E(() => document.querySelector('.ob .ob-skip').focus());
  await page.keyboard.press('Space');
  await sleep(150);
  const b = await E(() => ({
    step: overdub.onboard.step,
    act: document.activeElement?.className,
    playing: !!overdub.engine.playing,
  }));
  T.ok(
    b.step !== a.step && b.act === 'ob-t' && !b.playing,
    `Space on Skip works the same, and doesn't start the song (${a.step} → ${b.step})`,
  );
  // the shortcut to the card
  await E(() => document.querySelector('.ar-scroll').focus());
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+KeyT' : 'Control+Alt+KeyT');
  T.ok(await E(() => document.activeElement?.classList.contains('ob-t')), '⌘⌥T takes focus to the tour card');

  // holding a variation card is a preview, not a kept take: the tour waits on 'pick'
  await E(() => overdub.onboard.start({ force: true, restart: true }));
  await E(() => {
    const st = overdub.store;
    const t = st.get().tracks.find((x) => x.kind === 'instrument');
    st.dispatch(
      {
        type: 'clip.add',
        track: t.id,
        clip: {
          kind: 'notes',
          start: 64,
          length: 4,
          notes: [
            { p: 60, t: 0, d: 1, v: 0.8 },
            { p: 64, t: 1, d: 1, v: 0.8 },
          ],
        },
      },
      { by: 'you', label: 'probe take' },
    );
  });
  await sleep(100);
  const ask = await E(() => overdub.onboard.step);
  const req = await E(async () => {
    const t = overdub.store.get().tracks.find((x) => x.kind === 'instrument');
    return overdub.tools.run(
      'propose_variations',
      {
        variations: [
          {
            label: 'up',
            ops: [
              {
                type: 'clip.add',
                track: t.id,
                clip: { kind: 'notes', start: 72, length: 4, notes: [{ p: 67, t: 0, d: 1, v: 0.8 }] },
              },
            ],
          },
          {
            label: 'down',
            ops: [
              {
                type: 'clip.add',
                track: t.id,
                clip: { kind: 'notes', start: 72, length: 4, notes: [{ p: 55, t: 0, d: 1, v: 0.8 }] },
              },
            ],
          },
        ],
        wait_seconds: 0,
      },
      { by: 'mcp:probe' },
    );
  });
  await sleep(150);
  const pickStep = await E(() => overdub.onboard.step);
  await E((id) => overdub.tools.audition(id, 0, true), req.id);
  await sleep(150);
  const held = await E(() => overdub.onboard.step);
  await E((id) => overdub.tools.audition(id, 0, false), req.id);
  T.ok(
    ask === 'ask' && pickStep === 'pick' && held === 'pick',
    `holding a card doesn't finish the tour (${ask} → ${pickStep} → held: ${held})`,
  );

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `coach: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
}

/* ======================================================================== desktop: the coach's path by keyboard */
// Play the keys → Show me → Enter on Keep → Enter on the menu → the agent's take → Enter on Keep: the strip never
// covers Keep, and focus never falls to <body>
{
  const s = await open('/app/', { query: 'demo&coach', width: 1440, height: 900 });
  const { page, errors } = s;
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForSelector('.ob');
  const E = (fn, arg) => page.evaluate(fn, arg);
  const btnIn = (label) =>
    E((l) => {
      const b = [...document.querySelectorAll('.ob button')].find((x) => x.textContent.trim() === l);
      b?.focus();
      return !!b;
    }, label);
  await E(() => {
    overdub.onboard.start({ force: true, restart: true });
    if (overdub.onboard.step === 'listen') overdub.onboard.skip();
  });
  await btnIn('Play the keys');
  await page.keyboard.press('Enter');
  await sleep(200);
  for (const k of ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG']) {
    await page.keyboard.down(k);
    await sleep(90);
    await page.keyboard.up(k);
    await sleep(40);
  }
  await page.waitForFunction(() => overdub.onboard.step === 'keep', null, { timeout: 8000 }).catch(() => {});
  const k0 = await E(() => ({ step: overdub.onboard.step, typing: overdub.input.qwerty.on }));
  await btnIn('Show me');
  await page.keyboard.press('Enter');
  await sleep(700);
  const k1 = await E(() => {
    const a = document.activeElement,
      r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      keep: a.classList.contains('sk-keep'),
      clear: !!hit && a.contains(hit),
      inView: r.bottom <= innerHeight && r.top >= 0,
      typing: overdub.input.qwerty.on,
      note: document.querySelector('.ob .ob-note')?.textContent || '',
    };
  });
  T.ok(
    k0.step === 'keep' && k0.typing && k1.keep && k1.clear && k1.inView,
    `coach: Show me lands on Keep, in view and not under the musical-typing strip (typing ${k1.typing ? 'on' : 'off'}${k1.note ? `: "${k1.note}"` : ''})`,
  );
  await page.keyboard.press('Enter');
  await sleep(150);
  const inMenu = await E(() => document.activeElement?.getAttribute('role') === 'menuitem');
  await page.keyboard.press('Enter');
  await sleep(300);
  const k2 = await E(() => ({
    step: overdub.onboard.step,
    tag: document.activeElement?.tagName,
    cls: document.activeElement?.className,
  }));
  T.ok(
    inMenu && k2.step === 'ask' && k2.tag !== 'BODY',
    `coach: keeping from the menu by keyboard keeps focus (${k2.step}: ${k2.tag}.${k2.cls})`,
  );
  // the next Tab stop after Keep is Sketch's "Hand it to the agent" (Agent on the take's card): with no key, mid-tour,
  // it does what the tour's "Ask the demo agent" does, not open the key card
  const handoff = await E(() => {
    const a = document.activeElement;
    const b =
      a?.closest?.('.sk-idea')?.querySelector('.ew-btn-agent') ||
      [...document.querySelectorAll('[data-panel="sketch"] .ew-btn-agent')].find((x) => x.getClientRects().length);
    b?.focus();
    return {
      found: document.activeElement === b,
      provider: overdub.agent?.provider || null,
      tour: [...document.querySelectorAll('.ob button')].some((x) => x.textContent.trim() === 'Ask the demo agent'),
    };
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => overdub.onboard.step === 'pick', null, { timeout: 20000 }).catch(() => {});
  const ho = await E(() => ({
    step: overdub.onboard.step,
    provider: overdub.agent?.provider,
    keyCard: !!document.querySelector('.ag-kc, .ag-key:not([hidden])'),
  }));
  T.ok(
    handoff.found && handoff.tour && !handoff.provider && ho.step === 'pick' && ho.provider === 'mock',
    `coach: with no key, Sketch's "Hand it to the agent" on "Now the overdub" asks the demo agent, as the tour does (${JSON.stringify({ ...handoff, ...ho })})`,
  );
  const keepBtn = await E(() => {
    const b = [...document.querySelectorAll('.ag-vars .ag-keep')].find((x) => x.textContent === 'Keep');
    b?.focus();
    return document.activeElement === b;
  });
  const title = await E(() => document.querySelector('.ag-vars .ag-card-t')?.textContent || '');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => overdub.onboard.step === 'done', null, { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const k3 = await E(() => ({
    step: overdub.onboard.step,
    tag: document.activeElement?.tagName,
    cls: document.activeElement?.className,
  }));
  T.ok(
    keepBtn && k3.step === 'done' && k3.tag !== 'BODY',
    `coach: Keep on the agent's take keeps focus (${k3.step}: ${k3.tag}.${k3.cls})`,
  );
  T.ok(!/bars (\d+)–\1\b/.test(title), `the agent's card names its range plainly ("${title}")`);
  await page.waitForFunction(() => !overdub.agent.busy, null, { timeout: 20000 }).catch(() => {});

  // a tapped beat is hits, all the way through
  await E(() => {
    overdub.onboard.start({ force: true, restart: true });
    if (overdub.onboard.step === 'listen') overdub.onboard.skip();
    overdub.input.capture.add({
      src: 'tap',
      kind: 'drums',
      notes: [0, 1, 2, 3, 4, 5].map((i) => ({ p: 36, t: i * 0.5, d: 0.25, v: 0.9 })),
      tempo: 120,
    });
  });
  await sleep(150);
  const h1 = await E(() => document.querySelector('.ob')?.textContent || '');
  await E(() => {
    const c = overdub.input.capture;
    c.keep(c.latest().id, { newTrack: { device: 'core.drums' } });
  });
  await sleep(150);
  const h2 = await E(() => document.querySelector('.ob')?.textContent || '');
  T.ok(
    /6 hits, tapped/.test(h1) && /Your 6 hits are on a track/.test(h2) && !/6 notes/.test(h2),
    `coach: a tapped beat is "hits" in every step ("${(/Your[^.]*\./.exec(h2) || [''])[0]}")`,
  );

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `coach by keyboard: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
}

/* ======================================================================== the band picker: focus in, arrows, focus back */
{
  const s = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const { page, errors } = s;
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const E = (fn, arg) => page.evaluate(fn, arg);
  await E(() => {
    const t = overdub.store
      .get()
      .tracks.find(
        (x) =>
          x.kind === 'instrument' && x.clips.some((c) => c.notes?.length) && !/drum/.test(x.instrument?.device || ''),
      );
    const c = t.clips.find((x) => x.notes?.length);
    overdub.ui.select({ track: t.id, clip: c.id, notes: [] });
    document.querySelector('.ar-scroll').focus();
  });
  await page.keyboard.press('Shift+KeyB');
  await sleep(200);
  const b0 = await E(() => ({
    open: !!document.querySelector('.band-pop'),
    on: document.activeElement?.dataset?.style,
    tabs: [...document.querySelectorAll('.band-pop [role=radio]')].filter((x) => x.tabIndex === 0).length,
  }));
  await page.keyboard.press('ArrowRight');
  await sleep(80);
  const b1 = await E(() => ({
    on: document.querySelector('.band-pop [role=radio][aria-checked=true]')?.dataset.style,
    focus: document.activeElement?.dataset?.style,
  }));
  await page.keyboard.press('Escape');
  await sleep(120);
  const b2 = await E(() => ({
    open: !!document.querySelector('.band-pop'),
    back: document.activeElement?.classList.contains('ar-scroll'),
  }));
  T.ok(
    b0.open && b0.on && b0.tabs === 1,
    `band picker: opens with focus on the chosen style, one tab stop for the styles (${b0.on})`,
  );
  T.ok(
    b1.on && b1.on !== b0.on && b1.focus === b1.on,
    `band picker: → picks and focuses the next style (${b0.on} → ${b1.on})`,
  );
  T.ok(!b2.open && b2.back, 'band picker: Escape closes it and focus goes back to the arranger');
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `band picker: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
}

/* ======================================================================== phone: touch */
{
  const s = await open('/app/', { query: 'demo', width: 390, height: 844 });
  const ctx = await s.browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.stack) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const count = () => E(() => overdub.store.get().tracks.reduce((a, t) => a + t.clips.length, 0));
  // a touch held still, sent as pointer events only (no contextmenu: what iOS Safari does)
  const hold = (sel, x, y) =>
    E(
      ({ sel, x, y }) =>
        new Promise((res) => {
          const el = document.querySelector(sel);
          let ctx = 0;
          const cm = () => {
            ctx++;
          };
          window.addEventListener('contextmenu', cm, true);
          const o = {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 1,
          };
          el.dispatchEvent(new PointerEvent('pointerdown', o));
          setTimeout(() => {
            const p = document.querySelector('.ek-pop[role=menu]');
            const items = p ? [...p.querySelectorAll('[role=menuitem]')].map((b) => b.textContent) : [];
            const kbd = p ? [...p.querySelectorAll('.ek-kbd')].map((k) => k.textContent) : [];
            el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
            window.removeEventListener('contextmenu', cm, true);
            res({ open: !!p, items, kbd, ctx });
          }, 650);
        }),
      { sel, x, y },
    );

  await page.goto(s.base + '/app/?demo', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(400);
  await E(() => document.querySelector('.ar-welcome-x')?.click());
  // a clip on screen
  const at = await E(() => {
    const sc = document.querySelector('.ar-scroll'),
      r = sc.getBoundingClientRect(),
      z = overdub.ui.state.zoom;
    const p = overdub.store.get();
    for (let i = 0; i < p.tracks.length; i++)
      for (const c of p.tracks[i].clips) {
        const x = r.left + c.start * z.pxPerBeat - sc.scrollLeft + Math.min(30, (c.length * z.pxPerBeat) / 2),
          y = r.top + (i + 0.6) * z.trackH - sc.scrollTop;
        if (x > r.left + 4 && x < r.right - 4 && y > r.top + 4 && y < r.bottom - 4)
          return { x, y, clip: c.id, track: p.tracks[i].id };
      }
    return null;
  });
  if (at) {
    const m = await hold('.ar-scroll', at.x, at.y);
    T.ok(
      m.open && m.items.some((x) => /Delete/.test(x)) && m.items.some((x) => /Duplicate/.test(x)) && m.ctx === 0,
      `phone: a touch held on a clip opens its menu with no contextmenu event (${m.items.join(', ')})`,
    );
    T.ok(
      m.open && !m.kbd.length && m.items.some((x) => /^Duplicate after.*right after it/.test(x)),
      `phone: the clip menu shows no keyboard shortcuts on a touch screen, its sub-lines instead (${m.kbd.join(' ') || 'no keys'})`,
    );
    const n0 = await count();
    await E(() =>
      [...document.querySelectorAll('.ek-pop [role=menuitem]')].find((b) => /Delete/.test(b.textContent)).click(),
    );
    await sleep(100);
    T.ok((await count()) === n0 - 1, `phone: and Delete in it removes the clip (${n0} → ${await count()})`);
    await E(() => overdub.store.undo());
  } else T.ok(false, 'phone: a clip on screen to hold');
  const hrow = await E(() => {
    const r = document.querySelector('.ar-head .ar-hname').getBoundingClientRect();
    return { x: r.left + 6, y: r.top + r.height / 2 };
  });
  const hm = await hold('.ar-head .ar-hname', hrow.x, hrow.y);
  T.ok(
    hm.open && hm.items.some((x) => /Delete track/.test(x)) && hm.items.some((x) => /Duplicate track/.test(x)),
    `phone: a touch held on a track's header opens the track menu (${hm.items.join(', ')})`,
  );
  await page.keyboard.press('Escape');
  T.ok(!(await page.$('.ek-pop')), 'phone: Esc closes it');
  // a short tap is still a tap
  if (at) {
    const tap = await E(
      ({ x, y }) =>
        new Promise((res) => {
          const el = document.querySelector('.ar-scroll');
          const o = {
            bubbles: true,
            cancelable: true,
            pointerId: 8,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 1,
          };
          el.dispatchEvent(new PointerEvent('pointerdown', o));
          setTimeout(() => el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })), 120);
          setTimeout(() => res({ menu: !!document.querySelector('.ek-pop[role=menu]') }), 800);
        }),
      at,
    );
    T.ok(!tap.menu, 'phone: a quick tap opens no menu');
  }
  // without any gesture: the inspector's buttons
  if (at) {
    await E((a) => {
      overdub.ui.select({ track: a.track, clip: a.clip, notes: [] });
      overdub.ui.show('inspector');
    }, at);
    await sleep(300);
    const btns = await E(() =>
      [...document.querySelectorAll('[data-panel="inspector"] [data-act]')].map((b) => b.dataset.act),
    );
    T.ok(
      ['clip-dup', 'clip-del'].every((x) => btns.includes(x)),
      `the inspector has Duplicate and Delete for the clip (${btns.join(', ')})`,
    );
    const n0 = await count();
    await E(() => document.querySelector('[data-panel="inspector"] [data-act="clip-dup"]').click());
    await sleep(100);
    const n1 = await count();
    await E(() => document.querySelector('[data-panel="inspector"] [data-act="clip-del"]').click());
    await sleep(100);
    const n2 = await count();
    T.ok(n1 === n0 + 1 && n2 === n0, `inspector: Duplicate adds a clip, Delete takes one away (${n0} → ${n1} → ${n2})`);
    const tr0 = await E(() => overdub.store.get().tracks.length);
    await E((a) => overdub.ui.select({ track: a.track, clip: null, notes: [] }), at);
    await sleep(200);
    await E(() => document.querySelector('[data-panel="inspector"] [data-act="track-del"]').click());
    await sleep(100);
    const tr1 = await E(() => overdub.store.get().tracks.length);
    T.ok(
      tr1 === tr0 - 1 &&
        (await E(() =>
          [...document.querySelectorAll('.ew-toast')].some(
            (t) => /Deleted/.test(t.textContent) && t.querySelector('button'),
          ),
        )),
      `inspector: Delete track removes it, with Undo in the toast (${tr0} → ${tr1})`,
    );
    await E(() => overdub.store.undo());
  }

  /* -------- the agent and browser sheets are dialogs on a phone */
  // focus goes in, the studio under it is inert, Esc closes it, and focus comes back to the toggle
  await E(() => {
    overdub.ui.setOpen('right', false);
    overdub.ui.setOpen('left', false);
    document.querySelector('.ew-t-panelRight').focus();
  });
  await page.keyboard.press('Enter');
  await sleep(250);
  const sh1 = await E(() => {
    const b = document.querySelector('.ew-region-right'),
      a = document.activeElement;
    return {
      open: overdub.ui.isOpen('right'),
      role: b.getAttribute('role'),
      modal: b.getAttribute('aria-modal'),
      label: b.getAttribute('aria-label'),
      inside: b.contains(a),
      focus: a?.id || a?.className,
      inert:
        document.querySelector('.ew-top').inert &&
        document.querySelector('.ew-main').inert &&
        document.querySelector('.ew-region-left').inert,
      expanded: document.querySelector('.ew-t-panelRight').getAttribute('aria-expanded'),
    };
  });
  T.ok(
    sh1.open &&
      sh1.role === 'dialog' &&
      sh1.modal === 'true' &&
      sh1.label === 'Agent' &&
      sh1.inert &&
      sh1.expanded === 'true',
    `phone: the agent sheet is a named modal dialog over an inert studio (${JSON.stringify(sh1)})`,
  );
  T.ok(sh1.inside, `phone: opening it moves focus into the sheet (${sh1.focus})`);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
  const sh2 = await E(() => {
    const a = document.activeElement;
    return { behind: !!a?.closest?.('.ew-top, .ew-main'), what: a?.className || a?.tagName };
  });
  T.ok(!sh2.behind, `phone: Shift+Tab doesn't reach the hidden controls behind it (${sh2.what})`);
  await E(() => document.querySelector('.ew-region-right [role=tab][aria-selected=true]')?.focus());
  await page.keyboard.press('Escape');
  await sleep(200);
  const sh3 = await E(() => ({
    open: overdub.ui.isOpen('right'),
    back: document.activeElement === document.querySelector('.ew-t-panelRight'),
    role: document.querySelector('.ew-region-right').getAttribute('role'),
    inert: document.querySelector('.ew-main').inert,
    expanded: document.querySelector('.ew-t-panelRight').getAttribute('aria-expanded'),
  }));
  T.ok(
    !sh3.open && sh3.back && !sh3.role && !sh3.inert && sh3.expanded === 'false',
    `phone: Esc closes it, the studio comes back and focus returns to the Agent toggle (${JSON.stringify(sh3)})`,
  );
  await E(() => document.querySelector('.ew-t-panelLeft').focus());
  await page.keyboard.press('Enter');
  await sleep(200);
  await E(() => document.querySelector('.ew-region-left .ew-sheet-x').focus());
  await page.keyboard.press('Enter');
  await sleep(200);
  const sh4 = await E(() => ({
    open: overdub.ui.isOpen('left'),
    focus: document.activeElement?.className || document.activeElement?.tagName,
  }));
  T.ok(
    !sh4.open && /ew-t-panelLeft/.test(sh4.focus),
    `phone: the browser sheet's ✕ closes it and focus goes back to the Browser toggle, not <body> (${sh4.focus})`,
  );

  /* -------- Sketch's Tap panel on a touch screen: the pads, no key hints */
  await E(() => {
    overdub.ui.show('sketch');
    overdub.input.emit('sketch:mode', 'tap');
    overdub.input.setMode?.('tap');
  });
  await sleep(250);
  const tp = await E(() => {
    const v = document.querySelector('[data-panel="sketch"]');
    return {
      chip: [...v.querySelectorAll('.sk-chip')].some((c) => /F J K L/.test(c.textContent)),
      kbd: v.querySelectorAll('.sk-pad kbd').length,
      pads: v.querySelectorAll('.sk-pad').length,
      status: v.querySelector('.sk-status')?.textContent || '',
    };
  });
  T.ok(
    tp.pads === 4 && !tp.chip && !tp.kbd && !/\bF \(kick\)/.test(tp.status),
    `phone: Sketch's Tap panel shows the pads with no F J K L hints ("${tp.status}")`,
  );
  await E(() => overdub.input.setMode?.(null));

  /* -------- the coach on a phone */
  await page.goto(s.base + '/app/?demo&coach', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForSelector('.ob');
  const c1 = await E(() => ({
    step: overdub.onboard.step,
    text: document.querySelector('.ob').textContent,
    kbd: document.querySelectorAll('.ob kbd').length,
  }));
  T.ok(
    /Tap ▶/.test(c1.text) && !/Space/.test(c1.text) && c1.kbd === 0,
    `phone coach: step 1 says "Tap ▶", not Space (${c1.text.slice(0, 80)}…)`,
  );
  await E(() => overdub.onboard.skip());
  await sleep(100);
  const c2 = await E(() => ({ step: overdub.onboard.step, kbd: document.querySelectorAll('.ob kbd').length }));
  T.ok(c2.step === 'take' && c2.kbd === 0, `phone coach: the take step lists no keyboard keys (${c2.kbd} kbd)`);
  // a tapped take, then "Show me"
  await E(async () => {
    overdub.ui.show('sketch');
    overdub.input.emit('sketch:mode', 'tap');
    overdub.input.setMode?.('tap');
  });
  await sleep(200);
  await E(async () => {
    const tp = overdub.input.tap;
    for (let i = 0; i < 4; i++) {
      tp.hit(i % 2 ? 'snare' : 'kick', 0.8);
      await new Promise((r) => setTimeout(r, 120));
    }
    tp.flush();
  });
  await page.waitForFunction(() => overdub.onboard.step === 'keep', null, { timeout: 5000 }).catch(() => {});
  T.ok((await E(() => overdub.onboard.step)) === 'keep', 'phone coach: a tapped take moves it to "keep"');
  await E(() => [...document.querySelectorAll('.ob button')].find((b) => /Show me/.test(b.textContent))?.click());
  await sleep(900);
  const keep = await E(() => {
    const b = document.querySelector('.ob-glow');
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      found: true,
      y: Math.round(r.top),
      inView: r.top >= 0 && r.bottom <= innerHeight,
      hits: !!hit && (hit === b || b.contains(hit)),
      focused: document.activeElement === b,
    };
  });
  T.ok(
    keep.found && keep.inView && keep.hits && keep.focused,
    `phone coach: "Show me" brings the Keep button into view, uncovered and focused (${JSON.stringify(keep)})`,
  );
  await page.screenshot({ path: path.join(OUTDIR, 'a11y-phone-keep.png') }).catch(() => {});
  // the last card isn't under the agent drawer
  await E(() => {
    overdub.ui.setOpen('right', true);
    for (let i = 0; i < 5 && overdub.onboard.step !== 'done'; i++) overdub.onboard.skip();
  });
  await sleep(150);
  const done = await E(() => {
    const c = document.querySelector('.ob'),
      r = c.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return {
      step: overdub.onboard.step,
      drawer: overdub.ui.isOpen('right'),
      seen: !!hit && c.contains(hit),
      focus: document.activeElement?.className,
    };
  });
  T.ok(
    done.step === 'done' && !done.drawer && done.seen,
    `phone coach: "That's an overdub." isn't hidden under the agent drawer (${JSON.stringify(done)})`,
  );
  T.ok(
    done.focus === 'ob-t',
    `phone coach: closing the drawer for the last step puts focus on its title, not the drawer's toggle (${done.focus})`,
  );
  await page.screenshot({ path: path.join(OUTDIR, 'a11y-phone-done.png') }).catch(() => {});

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `phone: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
  await s.close();
}

/* ======================================================================== Find anything: the first screen and Find */
// (each in-page function carries its own accessible name, roughly as the browser computes it: labelledby, aria-label,
// the words, title, an image's alt, a field's label or placeholder)
const unnamed = () => {
  const nameOf = (e) => {
    const lb = e.getAttribute('aria-labelledby');
    if (lb)
      return lb
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .trim();
    return (
      e.getAttribute('aria-label') ||
      e.textContent ||
      e.getAttribute('title') ||
      e.querySelector?.('img[alt]')?.alt ||
      (e.labels && e.labels[0]?.textContent) ||
      e.getAttribute('placeholder') ||
      ''
    ).trim();
  };
  const vis = (e) => {
    if (!e.getClientRects().length || e.closest('[inert]')) return false;
    const r = e.getBoundingClientRect(),
      cs = getComputedStyle(e);
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth &&
      cs.visibility !== 'hidden'
    );
  };
  return [
    ...document.querySelectorAll(
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [role=spinbutton]',
    ),
  ]
    .filter(vis)
    .filter((e) => !nameOf(e))
    .map((e) => e.outerHTML.slice(0, 80));
};
// Find's state: its button (in the top bar, or at the end of the agent pane's tab row), the field, the listbox and the
// option the field points at
const findState = () => {
  const btn = [...document.querySelectorAll('.ws-find-btn')].find((x) => x.getClientRects().length);
  const inp = [...document.querySelectorAll('input[role=combobox]')].find((i) => i.getClientRects().length);
  if (!inp)
    return {
      open: false,
      expanded: btn?.getAttribute('aria-expanded'),
      focusFind: !!btn && document.activeElement === btn,
      keys: btn?.getAttribute('aria-keyshortcuts') || null,
    };
  const dlg = inp.closest('[role=dialog]');
  const list = document.getElementById(inp.getAttribute('aria-controls') || '');
  const act = document.getElementById(inp.getAttribute('aria-activedescendant') || '');
  return {
    open: true,
    dialog: !!dlg && !!dlg.getAttribute('aria-label'),
    focusIn: !!dlg && dlg.contains(document.activeElement),
    inputName: inp.getAttribute('aria-label') || inp.placeholder || '',
    expanded: btn?.getAttribute('aria-expanded'),
    listbox: list?.getAttribute('role') === 'listbox' && !!list.getAttribute('aria-label'),
    options: list ? list.querySelectorAll('[role=option]').length : 0,
    active: act
      ? {
          role: act.getAttribute('role'),
          selected: act.getAttribute('aria-selected'),
          text: act.textContent.trim().slice(0, 40),
        }
      : null,
  };
};
{
  const s = await open('/app/', { width: 1440, height: 900 });
  const { page, errors } = s;
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(500);
  const E = (fn, arg) => page.evaluate(fn, arg);
  T.ok((await E(() => window.overdub.ui.workspace?.view?.())) === 'full', 'find: the studio opens as one full studio');
  const nn = await E(unnamed);
  T.ok(
    !nn.length,
    `find: every control on the first screen has a name${nn.length ? ' (' + nn.slice(0, 4).join(' | ') + ')' : ''}`,
  );
  const st = await E(() => {
    const n = document.querySelector('.ew-ws [role=status]') || document.querySelector('.ew-top [role=status]');
    return { role: n?.getAttribute('role'), live: n?.getAttribute('aria-live') || 'polite' };
  });
  T.ok(
    st.role === 'status' && st.live !== 'off',
    `find: the note slot is a status line the screen reader reads (${JSON.stringify(st)})`,
  );
  // Find from the keyboard
  await E(() => [...document.querySelectorAll('.ws-find-btn')].find((x) => x.getClientRects().length)?.focus());
  const m0 = await E(findState);
  T.ok(/K$/.test(m0.keys || ''), `find: its button names its shortcut (aria-keyshortcuts ${m0.keys})`);
  await page.keyboard.press('Enter');
  await sleep(300);
  const m1 = await E(findState);
  T.ok(
    m0.expanded === 'false' && m1.open && m1.expanded === 'true',
    `find: Enter on Find opens it, and its button says so (aria-expanded ${m0.expanded} → ${m1.expanded})`,
  );
  T.ok(
    m1.open && m1.focusIn && m1.dialog,
    `find: a named dialog, focus inside (${JSON.stringify({ dialog: m1.dialog, focusIn: m1.focusIn })})`,
  );
  T.ok(
    m1.open && /\S/.test(m1.inputName || '') && m1.listbox && m1.options > 0,
    `find: its field has a name and controls a named listbox of ${m1.options} options ("${m1.inputName}")`,
  );
  await page.keyboard.type('mix');
  await sleep(200);
  await page.keyboard.press('ArrowDown');
  await sleep(100);
  const m2 = await E(findState);
  T.ok(
    m2.open && m2.focusIn && m2.active?.role === 'option' && m2.active.selected === 'true',
    `find: the arrows move the active option, which the field points at (${JSON.stringify(m2.active)})`,
  );
  await page.keyboard.press('Escape');
  await sleep(250);
  const m3 = await E(findState);
  T.ok(
    !m3.open && m3.focusFind && m3.expanded === 'false',
    `find: Esc closes it and focus goes back to its button (${JSON.stringify(m3)})`,
  );
  await page.screenshot({ path: path.join(OUTDIR, 'a11y-find.png') }).catch(() => {});
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `find: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);

  // on a phone: the Find sheet takes focus and gives it back
  const ctx = await s.browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    permissions: ['microphone'],
  });
  const pg = await ctx.newPage();
  const perr = [];
  pg.on('pageerror', (e) => perr.push('pageerror: ' + ((e && e.stack) || e)));
  await pg.goto(s.base + '/app/', { waitUntil: 'load' });
  await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(500);
  const pnn = await pg.evaluate(unnamed);
  T.ok(
    !pnn.length,
    `find phone: every control on the first screen has a name${pnn.length ? ' (' + pnn.slice(0, 4).join(' | ') + ')' : ''}`,
  );
  // (a phone's top bar has no room for Find: it is the Song menu's row, and the end of the agent sheet's tab row)
  const centre = (sel, words) =>
    pg.evaluate(
      ([sel, words]) => {
        const b = [...document.querySelectorAll(sel)].find(
          (x) => x.getClientRects().length && (!words || x.textContent.includes(words)),
        );
        if (!b) return null;
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      },
      [sel, words],
    );
  const sb = await centre('.ew-region-top .sm-btn');
  if (sb) {
    await pg.touchscreen.tap(sb[0], sb[1]);
    await sleep(400);
  }
  const fr = await centre('.sm-i', 'Find anything');
  if (fr) {
    await pg.touchscreen.tap(fr[0], fr[1]);
    await sleep(400);
  }
  const p1 = await pg.evaluate(findState);
  T.ok(
    !!fr && p1.open && p1.focusIn,
    `find phone: Song, then Find anything, opens its sheet with focus inside (${JSON.stringify({ row: !!fr, open: p1.open, focusIn: p1.focusIn })})`,
  );
  await pg.keyboard.press('Escape');
  await sleep(250);
  const p2 = await pg.evaluate(() => ({
    open: !![...document.querySelectorAll('input[role=combobox]')].find((i) => i.getClientRects().length),
    focus: document.activeElement?.className || '',
    visible: !!document.activeElement?.getClientRects().length,
  }));
  T.ok(
    !p2.open && p2.visible && /sm-btn|ws-find-btn/.test(p2.focus),
    `find phone: Esc closes the sheet and focus goes back to the Song button (${JSON.stringify(p2)})`,
  );
  await pg.screenshot({ path: path.join(OUTDIR, 'a11y-find-phone.png') }).catch(() => {});
  T.ok(!perr.length, `find phone: no page errors${perr.length ? ': ' + perr.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
  await s.close();
}

T.done();
