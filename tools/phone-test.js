// The studio on a phone [phone]: the demo song at 390x844 and 430x932 in Chromium with touch (isMobile, hasTouch),
// and in WebKit with the iPhone 13 and iPhone 14 Pro Max descriptors (Safari's visible viewport: 390x664, 430x740).
// What it holds, at each size:
//   - no sideways page scroll, ever (after every pane and sheet opens)
//   - the top bar fits: title, song menu, stop, play, record and the pane toggles all on screen, none clipped,
//     every one a 40 px target
//   - the arranger reads: track headers at most 120 px wide, lanes at least 64 px tall
//   - the detail pane is a bottom sheet: a handle you can drag (taller, then tucked down to its tabs) and tap,
//     tabs at least 44 px tall and all on screen, each pane opening from a tap on its tab
//   - the agent and the browser open as full-height sheets with a close button you can hit, and close again
//   - no text under 12 px where you'd read it (device faces are drawn gear and keep their printed sizes)
//   - the first-run path keeps the floor: the tour card's close, skip and buttons, an agent's take card (Hold to hear,
//     Keep, none of these) and the agent's header buttons are 40 px targets; the track M/S and the section + too;
//     a clip or section rename field is 16 px text (Safari zooms into less) and tall enough to tap
//   - the metronome is in the song menu where the transport bar has no room for it (460 px and under)
//   - a tap on play plays the song, another stops it; no console errors
//   - under a finger the small keys are 44 px (what the fifth round of first-time testers found): a clip's menu items,
//     the Devices track picker's rows, a device's i and ⌄, the mixer's M, S, ● and pan knob, the Follow lamp and the
//     welcome card's links (by reach); a swipe up a fader says how to pick it up; Notes and the browser say tap
// Then a phone turned on its side (844x390 in Chromium, the iPhone 13's 750x342 in WebKit), from upright: the song
// keeps a band in view however the sheet is dragged, the top bar is one row with the title and 40 px keys, the track
// headers' M S R are 40 px, no mouse hint, and Devices keeps 40 px knobs and scrolls down to what's under them.
// Then the simple view (?view=simple, a blank song) upright, in Chromium at 390x844 and WebKit as an iPhone 13: 18 or
// fewer controls on screen, the top row's title, stop, play, record, agent and Find on screen as 40 px keys, the Song
// menu, Tempo and Key off the bar, and Find as a bottom sheet inside the viewport and no taller than 70% of it, Full
// studio, the Song menu, Tempo and Key first, 40 px rows, a 16 px search field, no text under 12 px, closing again.
// Screenshots: tools/.out/phone-<engine>-<width>-<pane>.png
//
//   node tools/phone-test.js                     all six
//   node tools/phone-test.js chromium            just Chromium (390, 430, on its side and simple); also webkit
//   node tools/phone-test.js simple              just the simple view passes (simple chromium: one of them)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { startServer, ready } from '../server/serve.js';
import { OUTDIR, tally, QUIET, TEXT } from './pw.js';

const require = createRequire(import.meta.url);
const T = tally('phone');
const HEADED = !!process.env.HEADED;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2);
const RUNS = [
  { engine: 'chromium', w: 390, h: 844 },
  { engine: 'chromium', w: 430, h: 932 },
  { engine: 'chromium', w: 390, h: 844, turn: [844, 390] },
  { engine: 'webkit', device: 'iPhone 13' },
  { engine: 'webkit', device: 'iPhone 14 Pro Max' },
  { engine: 'webkit', device: 'iPhone 13', turn: [750, 342] },
  { engine: 'chromium', w: 390, h: 844, simple: true },
  { engine: 'webkit', device: 'iPhone 13', simple: true },
].filter(
  (r) =>
    !only.length ||
    (only.includes('simple') ? r.simple && (only.length === 1 || only.includes(r.engine)) : only.includes(r.engine)),
);
const ignorable = (e) =>
  /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);

function findPlaywright() {
  const tries = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core',
    path.join(os.homedir(), 'Code/xenobotany/node_modules/playwright-core'),
  ].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      /* next */
    }
  }
  throw new Error('playwright-core not found: set PLAYWRIGHT_CORE or `npm i --no-save playwright-core`');
}
function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const cands = [];
  if (fs.existsSync(base))
    for (const d of fs.readdirSync(base)) {
      if (d.startsWith('chromium_headless_shell'))
        cands.push(path.join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'));
      if (d.startsWith('chromium-'))
        cands.push(
          path.join(base, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
          path.join(base, d, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'),
        );
    }
  return cands.find((p) => fs.existsSync(p));
}

// ------------------------------------------------------------------------------------------------ measuring, in the page
// Text a person would read under 12 px, inside `scope` (a selector) and on screen. Device faces (.ewf) are drawn
// gear with printed labels; canvases draw their own text and aren't DOM.
const smallText = (scope) => {
  const root = document.querySelector(scope) || document.body;
  const out = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode()); ) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('.ewf, .sr-only, .ew-announce, [hidden], [aria-hidden="true"], svg')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight)
      continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    // something drawn over it (a sheet) means it isn't what you're reading
    const x = Math.min(Math.max(r.left + Math.min(r.width, 20) / 2, 1), innerWidth - 1),
      y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    if (top && !el.contains(top) && !top.contains(el) && !root.contains(top)) continue;
    const fs = parseFloat(cs.fontSize);
    if (fs < 11.95) {
      const key = `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''} ${fs}px`;
      if (!out.has(key)) out.set(key, n.textContent.trim().slice(0, 18));
    }
  }
  return [...out].map(([k, v]) => `${k} "${v}"`);
};
// The size of each control matched by a selector list (first visible match of each), and whether it's on screen.
const boxes = (sels) =>
  sels.map((sel) => {
    const el = [...document.querySelectorAll(sel)].find(
      (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden',
    );
    if (!el) return { sel, miss: true };
    const r = el.getBoundingClientRect();
    return {
      sel,
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.left),
      y: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      on: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5,
    };
  });
const pageWide = () => ({
  doc: document.documentElement.scrollWidth,
  body: document.body.scrollWidth,
  vw: innerWidth,
  sx: scrollX,
});
// Each visible match of `sel`: its drawn size, and whether a finger 21 px over and under its middle still lands on it
// (a 44 px target, drawn or by reach)
const reach44 = (sel) =>
  [...document.querySelectorAll(sel)]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => {
      const r = e.getBoundingClientRect(),
        x = r.left + Math.min(r.width / 2, 20),
        y = r.top + r.height / 2;
      const hit = (yy) => {
        const t = document.elementFromPoint(x, yy);
        return !!t && (t === e || e.contains(t));
      };
      return {
        text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24),
        h: Math.round(r.height),
        w: Math.round(r.width),
        ok: hit(y - 21) && hit(y + 21),
      };
    });

// ------------------------------------------------------------------------------------------------ one phone
async function phone(pw, srvUrl, run) {
  const tag = `${run.engine}-${run.device ? pw.devices[run.device].viewport.width : run.w}`;
  const label = run.device ? `${run.engine} ${run.device}` : `${run.engine} ${run.w}x${run.h}`;
  let browser;
  try {
    browser =
      run.engine === 'webkit'
        ? await pw.webkit.launch({ headless: !HEADED })
        : await pw.chromium.launch({
            headless: !HEADED,
            executablePath: HEADED ? undefined : findChromium(),
            args: ['--autoplay-policy=no-user-gesture-required', ...QUIET, ...TEXT],
          });
  } catch (e) {
    const msg = String((e && e.message) || e).split('\n')[0];
    if (process.env.REQUIRE_ALL) T.ok(false, `${label}: launches (${msg})`);
    else T.note(`${label}: not available here, skipped (${msg})`);
    return;
  }
  const opts = run.device
    ? { ...pw.devices[run.device] }
    : { viewport: { width: run.w, height: run.h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && (e.stack || e.message)) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) errors.push('console: ' + m.text());
  });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: path.join(OUTDIR, `phone-${tag}-${n}.png`) });
  const tap = async (sel) => {
    const r = await page.locator(sel).first().boundingBox();
    if (!r) return false;
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    await sleep(120);
    return true;
  };
  const noSideways = async (where) => {
    const s = await E(pageWide);
    T.ok(
      s.doc <= s.vw && s.body <= s.vw && s.sx === 0,
      `${label}: no sideways page scroll ${where} (${s.doc} px in ${s.vw})`,
    );
  };
  const readable = async (scope, where) => {
    const s = await E(smallText, scope);
    T.ok(!s.length, `${label}: no text under 12 px ${where}${s.length ? ': ' + s.slice(0, 6).join(', ') : ''}`);
  };
  const big = (b, min, minW = min) => !b.miss && b.h >= min - 0.5 && b.w >= minW - 0.5 && b.on;
  const fmt = (bs) =>
    bs.map((b) => (b.miss ? `${b.sel} missing` : `${b.sel} ${b.w}x${b.h}${b.on ? '' : ' off screen'}`)).join(', ');

  try {
    await page.goto(srvUrl + '/app/?demo', { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await sleep(700);
    const vp = await E(() => ({ w: innerWidth, h: innerHeight }));
    // first focus isn't parked on a top-bar toggle (it used to land on Browser, ringing the wrong button), and the two
    // side-sheet toggles say what they open in words: "Agent" is the headline feature
    const first = await E(() => {
      const a = document.activeElement;
      return { on: a?.className || a?.tagName || '', label: a?.getAttribute?.('aria-label') || '' };
    });
    T.ok(
      !/ew-t-panel/.test(first.on),
      `${label}: first focus isn't on a top-bar toggle (${first.on || 'body'}${first.label ? ' "' + first.label + '"' : ''})`,
    );
    const tl = await E(() =>
      ['.ew-t-panelLeft', '.ew-t-panelRight'].map((sel) => {
        const b = document.querySelector(sel);
        return b ? b.innerText.trim() : null;
      }),
    );
    T.ok(
      tl[0] === 'Browser' && tl[1] === 'Agent',
      `${label}: the top bar's toggles read "Browser" and "Agent" (${tl.map((x) => JSON.stringify(x)).join(', ')})`,
    );
    // the welcome card closes with a tap (the first gesture wakes the audio)
    const card = await E(() => {
      const el = document.querySelector('.ar-welcome');
      if (!el) return null;
      const r = el.getBoundingClientRect(),
        x = el.querySelector('.ar-welcome-x').getBoundingClientRect();
      return {
        t: Math.round(r.top),
        b: Math.round(r.bottom),
        l: Math.round(r.left),
        r: Math.round(r.right),
        x: [Math.round(x.width), Math.round(x.height)],
        xOn: x.top >= 0 && x.bottom <= innerHeight,
      };
    });
    if (card) {
      T.ok(
        card.t >= 0 && card.b <= vp.h && card.l >= 0 && card.r <= vp.w && card.xOn && card.x[0] >= 40,
        `${label}: the welcome card is whole on screen with a 40 px close (${card.l},${card.t}..${card.r},${card.b}, close ${card.x.join('x')})`,
      );
      // ... under the Arrange | Jam row (it covered it, so the Jam room's tab wasn't there to see), and it points a
      // guitarist at the room
      const tabs = await E(() => {
        const t = document.querySelector('#ew-tab-jam'),
          b = document.querySelector('[data-panel="arranger"] .ar-bar'),
          c = document.querySelector('.ar-welcome').getBoundingClientRect();
        if (!t) return null;
        const r = t.getBoundingClientRect(),
          hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          seen: !!hit && (hit === t || t.contains(hit)),
          bar: Math.round(b.getBoundingClientRect().bottom),
          top: Math.round(c.top),
          jam: document.querySelector('.ar-welcome .ar-welcome-jam')?.textContent || '',
        };
      });
      T.ok(
        tabs && tabs.seen && tabs.top >= tabs.bar && /Play guitar\? The Jam room/.test(tabs.jam),
        `${label}: the welcome card sits under the Arrange | Jam row, the Jam tab in view (card from ${tabs?.top} px, the row ends at ${tabs?.bar}; "${tabs?.jam}")`,
      );
      // its links (Tap to play it, the tour, ask the agent, Sketch) are 44 px to a finger: a tap 21 px over or under
      // the middle of each still lands on it (they were 17 px tall)
      const wl = await E(reach44, '.ar-welcome .ar-link');
      T.ok(
        wl.length >= 3 && wl.every((l) => l.ok),
        `${label}: the welcome card's links are 44 px to the touch (${wl.map((l) => `${l.text} ${l.h} px${l.ok ? '' : ' short'}`).join(', ')})`,
      );
      await shot('welcome');
      await tap('.ar-welcome-x');
      await sleep(400);
      T.ok(!(await page.isVisible('.ar-welcome')), `${label}: a tap on its close puts the welcome card away`);
    }
    await noSideways('when it opens');

    // ---- the top bar
    const topSels = [
      '.tp-title',
      '.sm-btn',
      '.tp-g-play .tp-btn:first-child',
      '.tp-play',
      '.tp-rec',
      '.ew-t-panelLeft',
      '.ew-t-panelRight',
    ];
    const tb = await E(boxes, topSels);
    T.ok(
      tb.every((b) => !b.miss && b.on),
      `${label}: the top bar fits: title, song menu, stop, play, record, browser, agent all on screen (${fmt(tb.filter((b) => b.miss || !b.on)) || 'all there'})`,
    );
    T.ok(
      tb.slice(1).every((b) => big(b, 40)),
      `${label}: top bar controls are 40 px targets (${fmt(tb.slice(1))})`,
    );
    // the transport's back and record keys and the logo are 44 px under a finger (app.css, the coarse-pointer block)
    const k44 = await E(boxes, ['.tp-g-play .tp-btn:first-child', '.tp-rec', '.ew-brand']);
    T.ok(
      k44.every((b) => big(b, 44)),
      `${label}: back, record and the logo are 44 px targets (${fmt(k44)})`,
    );
    const title = await E(() => {
      const t = document.querySelector('.tp-title');
      return {
        text: t.textContent,
        clipped: t.scrollWidth > t.clientWidth + 1,
        fs: parseFloat(getComputedStyle(t).fontSize),
      };
    });
    T.ok(!title.clipped && title.fs >= 15, `${label}: the song title reads whole ("${title.text}", ${title.fs} px)`);
    await readable('.ew-top', 'in the top bar');
    // the song menu opens from the bar and fits on the screen
    await tap('.sm-btn');
    await sleep(350);
    const menu = await E(() => {
      const el = document.querySelector('.ew-pop');
      if (!el) return null;
      const r = el.getBoundingClientRect(),
        items = [...el.querySelectorAll('.sm-i')]
          .filter((i) => i.getClientRects().length)
          .map((i) => Math.round(i.getBoundingClientRect().height));
      return {
        l: Math.round(r.left),
        r: Math.round(r.right),
        t: Math.round(r.top),
        b: Math.round(r.bottom),
        n: items.length,
        minH: Math.min(...items),
      };
    });
    T.ok(
      menu && menu.l >= 0 && menu.r <= vp.w && menu.t >= 0 && menu.b <= vp.h && menu.n >= 4 && menu.minH >= 44,
      `${label}: the song menu opens on screen with ${menu?.n} items, each a 44 px target (${menu ? `${menu.l}..${menu.r} x ${menu.t}..${menu.b}, smallest ${menu.minH} px` : 'no menu'})`,
    );
    await readable('.ew-pop', 'in the song menu');
    // the metronome: on the transport bar, or (460 px and under, no room there) in the song menu
    const met = await E(() => ({
      bar: !!document.querySelector('.tp-g-mode')?.getClientRects().length,
      item: !!document.querySelector('.ew-pop .sm-met'),
      on: !!window.overdub.engine.metronome,
    }));
    T.ok(
      met.bar || met.item,
      `${label}: the metronome is within reach (${met.bar ? 'on the bar' : met.item ? 'in the song menu' : 'nowhere'})`,
    );
    await shot('song-menu');
    if (met.item) {
      await tap('.ew-pop .sm-met');
      await sleep(200);
      const on = await E(() => !!window.overdub.engine.metronome);
      T.ok(on !== met.on, `${label}: a tap on Metronome in the song menu turns the click ${on ? 'on' : 'off'}`);
      await E(() => {
        window.overdub.engine.metronome = false;
        window.overdub.ui.emit('transport-ui');
      });
    }
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(200);
    if (await page.isVisible('.ew-pop')) await page.touchscreen.tap(vp.w / 2, vp.h / 2 - 60);
    await sleep(200);

    // ---- the arranger
    const ar = await E(() => {
      const head = document.querySelector('.ar-head'),
        hr = head?.getBoundingClientRect();
      const mute = document.querySelector('.ar-head .ar-hb-mute')?.getBoundingClientRect();
      return {
        headW: hr && Math.round(hr.width),
        headH: hr && Math.round(hr.height),
        trackH: window.overdub.ui.state.zoom.trackH,
        mute: mute && [Math.round(mute.width), Math.round(mute.height)],
      };
    });
    T.ok(
      ar.headW && ar.headW <= 120 && ar.trackH >= 64 && ar.headH >= 64,
      `${label}: the arranger reads: track headers ${ar.headW} px wide, lanes ${ar.trackH} px tall`,
    );
    T.ok(
      ar.mute && ar.mute[0] >= 40 && ar.mute[1] >= 40,
      `${label}: a track's mute is a 40 px target (${ar.mute?.join('x')})`,
    );
    const hb = await E(() => {
      const b = document.querySelector('.ar-head .ar-hbtns'),
        h = b.closest('.ar-head');
      return b.getBoundingClientRect().right <= h.getBoundingClientRect().right + 0.5;
    });
    T.ok(hb, `${label}: M and S fit inside the track header`);
    // the Follow lamp, and a clip's menu (a long press opens the right-click's menu): 44 px under a finger, each item
    // (they were 26 and 30 px)
    const fol = (await E(boxes, ['.ar-tool.ar-follow']))[0];
    T.ok(big(fol, 44), `${label}: the Follow lamp is a 44 px target (${fmt([fol])})`);
    const cm = await E(async () => {
      const o = window.overdub,
        t = o.store.get().tracks.find((x) => x.clips.length),
        c = t.clips[0];
      o.arranger.reveal(c.start);
      await new Promise((r) => setTimeout(r, 120));
      const sc = document.querySelector('.ar-scroll'),
        r = sc.getBoundingClientRect(),
        z = o.ui.state.zoom,
        row = o.store.get().tracks.indexOf(t);
      const x = r.left + c.start * z.pxPerBeat - sc.scrollLeft + 12,
        y = r.top + row * z.trackH + z.trackH / 2 - sc.scrollTop;
      sc.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      await new Promise((res) => setTimeout(res, 200));
      return [...document.querySelectorAll('.ek-pop .ek-item')]
        .filter((i) => i.getClientRects().length)
        .map((i) => Math.round(i.getBoundingClientRect().height));
    });
    T.ok(
      cm.length >= 6 && Math.min(...cm) >= 44,
      `${label}: a clip's menu items are 44 px targets (${cm.length} items, ${cm.length ? Math.min(...cm) : 0} px at the smallest)`,
    );
    await shot('clip-menu');
    await page.keyboard.press('Escape').catch(() => {});
    await E(() => document.querySelectorAll('.ek-pop').forEach((p) => p.remove()));
    // the section +: it sits in a 20 px row, so its target (what a tap there lands on) reaches down and to the left:
    // every point of the 40 x 40 square that ends at its right edge is the button
    const sa = await E(() => {
      const r = document.querySelector('.ar-secadd').getBoundingClientRect();
      const hit = (x, y) => !!document.elementFromPoint(x, y)?.closest('.ar-secadd');
      let miss = 0;
      for (let dx = 1; dx < 40; dx += 6) for (let dy = 1; dy < 40; dy += 6) if (!hit(r.right - dx, r.top + dy)) miss++;
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        miss,
        inside: r.right <= document.querySelector('.ar-corner').getBoundingClientRect().right,
      };
    });
    T.ok(
      !sa.miss && sa.inside,
      `${label}: the Sections + is a 40 x 40 target inside the corner (button ${sa.w}x${sa.h}, ${sa.miss} misses in the 40 px square)`,
    );
    // rename a clip and a section: 16 px fields a finger can land in
    const field = async (sel) => {
      await page.waitForTimeout(150);
      const f = await E((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          fs: parseFloat(getComputedStyle(el).fontSize),
          h: Math.round(r.height),
          focused: document.activeElement === el,
        };
      }, sel);
      await page.keyboard.press('Escape');
      return f;
    };
    await E(() => {
      const o = window.overdub,
        t = o.store.get().tracks.find((x) => x.clips.length),
        c = t.clips[0];
      o.ui.select({ track: t.id, clip: c.id, notes: [] });
      o.arranger.selectClips([c.id]);
      o.arranger.reveal(c.start);
      document.querySelector('.ar-scroll').focus();
    });
    await page.keyboard.press('F2');
    const cf = await field('.ar-clipinput');
    await E(() => {
      document.querySelector('.ar-rulerwrap').focus();
    });
    await page.keyboard.press('Home');
    await page.keyboard.press('F2');
    const sf = await field('.ar-secinput');
    T.ok(
      cf && cf.focused && cf.fs >= 16 && cf.h >= 32 && sf && sf.focused && sf.fs >= 16 && sf.h >= 32,
      `${label}: renaming a clip or a section opens a 16 px field, 32 px tall (clip ${cf ? `${cf.fs} px, ${cf.h} tall` : 'none'}; section ${sf ? `${sf.fs} px, ${sf.h} tall` : 'none'})`,
    );
    await E(() => {
      window.overdub.arranger.selectClips([]);
      window.overdub.ui.select({ clip: null, range: null });
      document.activeElement?.blur?.();
    });
    await readable('.ew-region-center', 'in the arranger');
    await shot('arrange');

    // ---- play by tap
    await tap('.tp-play');
    await page.waitForFunction(() => window.overdub.engine.playing, null, { timeout: 8000 }).catch(() => {});
    await sleep(1000);
    const p1 = await E(() => ({
      playing: window.overdub.engine.playing,
      beat: window.overdub.engine.beat,
      state: window.overdub.engine.ctx?.state,
    }));
    await tap('.tp-play');
    await sleep(300);
    const p2 = await E(() => window.overdub.engine.playing);
    T.ok(
      p1.playing && p1.beat > 0.3 && !p2,
      `${label}: a tap on play plays the song (beat ${(p1.beat || 0).toFixed(2)}, audio ${p1.state}); another stops it`,
    );

    // ---- the bottom sheet
    const sheet = () =>
      E(() => {
        const reg = document.querySelector('.ew-region-bottom').getBoundingClientRect(),
          grip = document.querySelector('.ew-grip').getBoundingClientRect();
        const content = document.querySelector('.ew-region-bottom > .ew-content').getBoundingClientRect();
        // the handle's target reaches above its line: the point 14 px over it is still the handle
        const above = document.elementFromPoint(innerWidth / 2, grip.top - 14);
        return {
          open: window.overdub.ui.isOpen('bottom'),
          top: Math.round(grip.top),
          h: Math.round(content.height),
          regBottom: Math.round(reg.bottom),
          gripH: Math.round(grip.height),
          reach: !!above?.closest('.ew-grip'),
          vh: innerHeight,
        };
      });
    const s0 = await sheet();
    T.ok(
      s0.open && s0.h > 150 && s0.reach && s0.gripH >= 18,
      `${label}: the detail pane is a bottom sheet with a handle (sheet ${s0.h} px, handle ${s0.gripH} px + reach above it ${s0.reach ? 'yes' : 'no'})`,
    );
    const tabs = await E(() =>
      [...document.querySelectorAll('.ew-region-bottom .ew-tab')].map((t) => {
        const r = t.getBoundingClientRect();
        return {
          id: t.id.replace('ew-tab-', ''),
          name: t.textContent.trim(),
          w: Math.round(r.width),
          h: Math.round(r.height),
          on: r.left >= -0.5 && r.right <= innerWidth + 0.5,
        };
      }),
    );
    T.ok(
      tabs.length >= 5 && tabs.every((t) => t.h >= 44 && t.w >= 44 && t.on),
      `${label}: the sheet's tabs are all on screen and 44 px targets (${tabs.map((t) => `${t.name} ${t.w}x${t.h}${t.on ? '' : ' off'}`).join(', ')})`,
    );
    for (const t of tabs) {
      await tap(`#ew-tab-${t.id}`);
      await sleep(450);
      const vis = await E((id) => {
        const el = document.querySelector(`[data-panel="${id}"]`);
        if (!el || el.hidden) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }, t.id);
      T.ok(
        vis && vis.w >= vp.w - 2 && vis.h > 100,
        `${label}: a tap on ${t.name} opens it in the sheet (${vis ? vis.w + 'x' + vis.h : 'hidden'})`,
      );
      // Notes with no clip picked says what a finger does: tap, double-tap (it said click and double-click)
      if (t.id === 'pianoroll') {
        const say = await E(() => document.querySelector('.pr-empty-card p')?.textContent || '');
        T.ok(
          /Tap one in the arranger, or double-tap an empty lane/.test(say) && !/click/i.test(say),
          `${label}: Notes, empty, says tap and double-tap ("${say}")`,
        );
      }
      await noSideways(`with ${t.name} open`);
      await readable('.ew-region-bottom', `in ${t.name}`);
      await shot('sheet-' + t.id);
    }
    // drag the handle up: the sheet grows; drag it down: it tucks away to its tabs; tap the handle: it comes back
    const g0 = await sheet();
    const cx = Math.round(vp.w / 2);
    await dragTouch(page, run.engine, cx, g0.top + 10, cx, Math.max(140, g0.top - 260));
    const g1 = await sheet();
    T.ok(
      g1.open && g1.h > g0.h + 150,
      `${label}: dragging the handle up makes the sheet taller (${g0.h} → ${g1.h} px)`,
    );
    await shot('sheet-tall');
    await dragTouch(page, run.engine, cx, g1.top + 10, cx, vp.h - 20);
    const g2 = await sheet();
    const tabsLeft = await E(() => {
      const r = document.querySelector('.ew-region-bottom .ew-tab').getBoundingClientRect();
      return r.height >= 44 && r.bottom <= innerHeight + 0.5;
    });
    T.ok(
      !g2.open && tabsLeft,
      `${label}: dragging it down tucks the sheet away and leaves its tabs (${g2.open ? 'still open' : 'tucked'}, handle at ${g2.top} of ${g2.vh})`,
    );
    await shot('sheet-tucked');
    await tap('.ew-grip');
    await sleep(250);
    const g3 = await sheet();
    T.ok(g3.open && g3.h > 150, `${label}: a tap on the handle brings it back (${g3.h} px)`);
    await tap('.ew-grip');
    await sleep(200);
    await tap('#ew-tab-mixer');
    await sleep(300);
    T.ok((await sheet()).open, `${label}: a tap on a tab opens the tucked sheet on that pane`);
    await noSideways('after the sheet moves');

    // ---- the first-run path: the tour card, then an agent's take card
    await E(() => {
      const ob = window.overdub.onboard;
      ob.start({ force: true, restart: true });
      if (ob.step === 'listen') ob.skip();
    });
    await sleep(300);
    let sheetBack = null;
    // on a phone the tour is a strip, one line right above the sheet: the song (and the lanes) stay in sight at every
    // step; a tap on its line opens the whole card (docs/FRESH-EYES-4.md, the beginner's problem 2)
    const stripAt = () =>
      E(() => {
        const c = document.querySelector('.ob:not(.out)'),
          r = c.getBoundingClientRect(),
          t = c.querySelector('.ob-t'),
          sheet = document.querySelector('.ew-region-bottom').getBoundingClientRect(),
          lanes = document.querySelector('.ar-lanewrap')?.getBoundingClientRect();
        return {
          strip: c.classList.contains('ob-strip'),
          h: Math.round(r.height),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          sheet: Math.round(sheet.top),
          lanes: lanes ? Math.round(r.top - Math.max(lanes.top, 0)) : 0,
          oneLine: !!t && t.getBoundingClientRect().height <= 24,
          text: c.textContent,
          toasts: [...document.querySelectorAll('.ew-toasts .ew-toast')].filter((x) => x.getClientRects().length)
            .length,
        };
      });
    {
      // (the sheet at its first height, a little under half the screen: the runs above left it taller)
      const gr = await E(() => {
        const g = document.querySelector('.ew-grip').getBoundingClientRect();
        return { x: innerWidth / 2, y: g.top + g.height / 2, to: Math.round(innerHeight * 0.55) };
      });
      if (Math.abs(gr.y - gr.to) > 20) await dragTouch(page, run.engine, gr.x, gr.y, gr.x, gr.to, 10);
      await sleep(250);
      sheetBack = gr;
    }
    const st1 = await stripAt();
    T.ok(
      st1.strip && st1.h <= 60 && st1.oneLine && st1.bottom <= st1.sheet + 1 && st1.lanes >= 80,
      `${label}: the tour is a one-line strip (${st1.h} px) right above the sheet, ${st1.lanes} px of lanes in sight over it ("${st1.text.slice(0, 60)}")`,
    );
    const tour = await E(boxes, ['.ob .ob-x', '.ob .ob-mini-row > .ew-btn']);
    T.ok(
      tour.every((b) => big(b, 40, 40)),
      `${label}: the strip's Close and its button are 40 px targets (${fmt(tour)})`,
    );
    await shot('tour-strip');
    // a toast while it is up: none floats over the song; the strip says it, with its button, then goes back
    await E(() =>
      window.overdub.ui.toast('Probe: Take 1 is in.', {
        ms: 700,
        action: {
          label: 'Undo',
          run() {
            window.__probeUndo = true;
          },
        },
      }),
    );
    await sleep(120);
    const st2 = await stripAt();
    const said = await E(() => ({
      line: document.querySelector('.ob .ob-said')?.textContent || '',
      btn: document.querySelector('.ob .ob-said-act')?.textContent || '',
    }));
    T.ok(
      !st2.toasts && /Probe: Take 1 is in/.test(said.line) && said.btn === 'Undo' && st2.h <= 120,
      `${label}: with the tour up no toast covers the song: the strip says it ("${said.line}" · ${said.btn}; ${st2.toasts} toasts on screen)`,
    );
    await tap('.ob .ob-said-act');
    const st3 = await stripAt();
    T.ok(
      (await E(() => !!window.__probeUndo)) && !/Probe/.test(st3.text),
      `${label}: the strip's Undo runs the toast's, and the step's line comes back ("${st3.text.slice(0, 50)}")`,
    );
    await tap('.ob .ob-t');
    await sleep(200);
    const whole = await E(boxes, ['.ob .ob-x', '.ob .ob-skip', '.ob .ob-acts .ew-btn', '.ob .ob-fold']);
    T.ok(
      whole.every((b) => big(b, 40, 40)) && !(await stripAt()).strip,
      `${label}: a tap on the strip's line opens the whole card; its Fold, Close, skip and buttons are 40 px targets (${fmt(whole)})`,
    );
    await readable('.ob', 'on the tour card');
    await shot('tour');
    await tap('.ob .ob-fold');
    T.ok((await stripAt()).strip, `${label}: Fold puts it back to one line`);
    await E(() => window.overdub.onboard.stop());
    // (the sheet back as the runs above left it)
    if (sheetBack && Math.abs(sheetBack.y - sheetBack.to) > 20) {
      await dragTouch(page, run.engine, sheetBack.x, sheetBack.to, sheetBack.x, sheetBack.y, 10);
      await sleep(250);
    }
    const req = await E(async () => {
      const o = window.overdub,
        t = o.store.get().tracks.find((x) => x.kind === 'instrument');
      return o.tools.run(
        'propose_variations',
        {
          variations: [
            {
              label: 'up',
              ops: [
                {
                  type: 'clip.add',
                  track: t.id,
                  clip: { kind: 'notes', start: 64, length: 4, notes: [{ p: 67, t: 0, d: 1, v: 0.8 }] },
                },
              ],
            },
            {
              label: 'down',
              ops: [
                {
                  type: 'clip.add',
                  track: t.id,
                  clip: { kind: 'notes', start: 64, length: 4, notes: [{ p: 55, t: 0, d: 1, v: 0.8 }] },
                },
              ],
            },
          ],
          wait_seconds: 0,
        },
        { by: 'mcp:probe' },
      );
    });
    await E(() => {
      window.overdub.ui.show('agent');
    });
    await sleep(450);
    const takes = await E(boxes, ['.ag-vars .ag-hold', '.ag-vars .ag-keep', '.ag-card-foot .ag-link', '.ag-hbtn']);
    T.ok(
      takes.every((b) => big(b, 40, 40)),
      `${label}: an agent's take card and the agent's header buttons are 40 px targets (${fmt(takes)})`,
    );
    await readable('.ew-region-right', 'on a take card');
    await shot('take-card');
    void req;
    await E(() => document.querySelector('.ag-card-foot .ag-link')?.click());
    await E(() => window.overdub.ui.setOpen('right', false));
    await sleep(200);

    // ---- the agent and the browser: full-height sheets with a close
    for (const [name, region, toggle] of [
      ['agent', 'right', '.ew-t-panelRight'],
      ['browser', 'left', '.ew-t-panelLeft'],
    ]) {
      await tap(toggle);
      await sleep(450);
      const sh = await E((region) => {
        const el = document.querySelector(`.ew-region-${region}`),
          r = el.getBoundingClientRect(),
          x = el.querySelector('.ew-sheet-x');
        const xr = x?.getBoundingClientRect();
        const hit = xr && document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2);
        const lr = document.querySelector('.ar-lanewrap')?.getBoundingClientRect();
        return {
          lanes: lr ? Math.round(Math.min(lr.bottom, r.top) - Math.max(lr.top, 0)) : 0,
          open: window.overdub.ui.isOpen(region),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          left: Math.round(r.left),
          w: Math.round(r.width),
          vh: innerHeight,
          vw: innerWidth,
          x: xr && [Math.round(xr.width), Math.round(xr.height)],
          xHit: !!hit?.closest('.ew-sheet-x'),
          name: x?.getAttribute('aria-label'),
        };
      }, region);
      // the agent opens at about 70% of the height, the song in view above it; the browser at the whole height
      if (name === 'agent')
        T.ok(
          sh.open &&
            sh.top >= sh.vh * 0.2 &&
            sh.top <= sh.vh * 0.42 &&
            sh.bottom >= sh.vh &&
            sh.w >= sh.vw - 1 &&
            sh.lanes > 40,
          `${label}: the agent opens as a sheet at about 70% of the height, the timeline in view above it (${sh.left},${sh.top} ${sh.w}x${sh.bottom - sh.top} in ${sh.vw}x${sh.vh}; ${sh.lanes} px of lanes above)`,
        );
      else
        T.ok(
          sh.open && sh.top <= 0 && sh.bottom >= sh.vh && sh.w >= sh.vw - 1,
          `${label}: the ${name} opens as a full-height sheet (${sh.left},${sh.top} ${sh.w}x${sh.bottom - sh.top} in ${sh.vw}x${sh.vh})`,
        );
      T.ok(
        sh.x && sh.x[0] >= 44 && sh.x[1] >= 44 && sh.xHit,
        `${label}: the ${name} sheet has a close button you can hit ("${sh.name}", ${sh.x?.join('x')})`,
      );
      // the browser says what a finger does with a row: a tap tries it on the track, or puts it on (no drag and drop out
      // of a sheet over the studio)
      if (name === 'browser') {
        const tg = await E(() => document.querySelector('.br-target')?.textContent || '');
        T.ok(
          /^Tap (tries|puts) it on|^Tap tries a kit on/.test(tg) && !/drag|click/i.test(tg),
          `${label}: the browser says where a tap puts a device ("${tg}")`,
        );
      }
      await noSideways(`with the ${name} open`);
      await readable(`.ew-region-${region}`, `in the ${name} sheet`);
      await shot('sheet-' + name);
      // its other tabs too (History; Inspector)
      const more = await E(
        (region) => [...document.querySelectorAll(`.ew-region-${region} .ew-tab`)].slice(1).map((t) => t.id),
        region,
      );
      for (const id of more) {
        await tap('#' + id);
        await sleep(350);
        await readable(`.ew-region-${region}`, `in the ${name} sheet's ${id.replace('ew-tab-', '')} tab`);
        await noSideways(`on ${id.replace('ew-tab-', '')}`);
        await shot('sheet-' + id.replace('ew-tab-', ''));
      }
      const tabH = await E(
        (region) =>
          Math.min(
            ...[...document.querySelectorAll(`.ew-region-${region} .ew-tab`)].map(
              (t) => t.getBoundingClientRect().height,
            ),
          ),
        region,
      );
      T.ok(tabH >= 44, `${label}: the ${name} sheet's tabs are 44 px targets (${Math.round(tabH)} px)`);
      if (more.length) {
        await tap(`.ew-region-${region} .ew-tab`);
        await sleep(200);
      }
      await tap(`.ew-region-${region} .ew-sheet-x`);
      await sleep(300);
      const shut = await E(
        (region) => ({
          open: window.overdub.ui.isOpen(region),
          shown: !!document.querySelector(`.ew-region-${region}`).getClientRects().length,
        }),
        region,
      );
      T.ok(!shut.open && !shut.shown, `${label}: its close button closes the ${name} sheet`);
    }
    // ---- Devices on a phone: one device per page at the sheet's width, knobs 44 px, printed labels and readouts 12 px
    // and apart, at the top of the board (no band of empty wood), ‹ › paging to the next device whole; a finger's knob
    // drag is half as quick as a mouse's (48 px moves a third of the range by mouse, a sixth by touch)
    await tap('#ew-tab-rack');
    await sleep(300);
    const added = await E(() => {
      const a = window.overdub,
        t = a.store.get().tracks[0];
      const r = a.store.dispatch(
        [
          { type: 'insert.add', track: t.id, insert: { device: 'core.crush' } },
          { type: 'insert.add', track: t.id, insert: { device: 'core.drive' } },
        ],
        { by: 'you', label: 'phone test' },
      );
      window.overdub.ui.select({ track: t.id });
      return !!r.ok;
    });
    await sleep(500);
    const devPage = () =>
      E(() => {
        const board = document.querySelector('[data-panel="rack"] .rk-board'),
          br = board.getBoundingClientRect();
        const card = [...board.querySelectorAll('.rk-card')].find((c) => {
          const r = c.getBoundingClientRect();
          return r.right > br.left + 2 && r.left < br.right - 2;
        });
        if (!card) return { none: true, scroll: Math.round(board.scrollLeft), bw: Math.round(br.width) };
        const f = card.querySelector('.rk-face'),
          fr = f.getBoundingClientRect(),
          z = parseFloat(getComputedStyle(f).zoom) || 1;
        const px = (sel) =>
          [...card.querySelectorAll(sel)]
            .filter((e) => e.getClientRects().length)
            .map((e) => parseFloat(getComputedStyle(e).fontSize) * z);
        const vs = [...card.querySelectorAll('.kn-v')].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
        let touching = 0;
        for (let i = 0; i < vs.length; i++)
          for (let j = i + 1; j < vs.length; j++) {
            const a = vs[i],
              b = vs[j];
            if (Math.abs(a.top - b.top) < 4 && a.right > b.left - 3 && b.right > a.left - 3) touching++;
          }
        // (the empty wood over the face: above the card's caption, and between the caption and the face; the caption holds
        // the device's 44 px keys)
        const cr = card.querySelector('.rk-cap').getBoundingClientRect();
        return {
          name: card.querySelector('.rk-name')?.textContent,
          whole: fr.left >= br.left - 0.5 && fr.right <= br.right + 0.5,
          fw: Math.round(fr.width),
          bw: Math.round(br.width),
          gapTop: Math.round(cr.top - br.top + (fr.top - cr.bottom)),
          knob: Math.round(
            Math.min(...[...card.querySelectorAll('.kn-dial')].map((d) => d.getBoundingClientRect().width)),
          ),
          lbl: Math.min(...px('.kn-l')),
          val: Math.min(...px('.kn-v')),
          touching,
          scroll: Math.round(board.scrollLeft),
        };
      });
    const pages = [];
    for (let i = 0; i < 3; i++) {
      const d = await devPage();
      pages.push(d);
      if (i < 2) {
        await tap('[data-panel="rack"] .rk-more-rb svg');
        await sleep(700);
      }
    }
    T.ok(
      added && pages.every((d) => !d.none && d.whole && d.fw >= d.bw * 0.6),
      `${label}: Devices shows one device at a time, whole and at the sheet's width, paging with › (${pages.map((d) => (d.none ? 'none at ' + d.scroll : `${d.name} ${d.fw}/${d.bw}${d.whole ? '' : ' cut'}`)).join(', ')})`,
    );
    T.ok(
      pages.every((d) => !d.none && d.knob >= 44 && d.lbl >= 12 && d.val >= 12 && !d.touching),
      `${label}: device knobs are 44 px, labels and readouts 12 px and apart (${pages.map((d) => `${d.name}: knob ${d.knob}, label ${d.lbl?.toFixed?.(1)}, value ${d.val?.toFixed?.(1)}${d.touching ? `, ${d.touching} touching` : ''}`).join('; ')})`,
    );
    T.ok(
      pages.every((d) => !d.none && d.gapTop <= 24),
      `${label}: each device sits at the top of the board, no band of empty wood (${pages.map((d) => d.gapTop).join(', ')} px of it over the face)`,
    );
    await shot('devices');
    // a device's keys (i, the instrument's ⌄, an effect's ×) and the track picker's rows are 44 px under a finger
    // (36 and 31 px before)
    const ibs = await E(() =>
      [...document.querySelectorAll('[data-panel="rack"] .rk-card .rk-ib')].map((b) => {
        const r = b.getBoundingClientRect();
        return { l: b.getAttribute('aria-label').split(' ')[0], w: Math.round(r.width), h: Math.round(r.height) };
      }),
    );
    T.ok(
      ibs.length >= 3 && ibs.every((b) => b.w >= 44 && b.h >= 44),
      `${label}: a device's i, swap and remove keys are 44 px (${ibs
        .slice(0, 4)
        .map((b) => `${b.l} ${b.w}x${b.h}`)
        .join(', ')})`,
    );
    await tap('[data-panel="rack"] .rk-track');
    await sleep(300);
    const rows = await E(() =>
      [...document.querySelectorAll('.ew-pop .rk-mi')].map((r) => Math.round(r.getBoundingClientRect().height)),
    );
    T.ok(
      rows.length >= 3 && Math.min(...rows) >= 44,
      `${label}: the Devices track picker's rows are 44 px (${rows.length} rows, ${rows.length ? Math.min(...rows) : 0} px at the smallest)`,
    );
    await shot('devices-picker');
    await page.keyboard.press('Escape').catch(() => {});
    await E(() => {
      for (const p of document.querySelectorAll('.ew-pop')) p.remove();
    });
    const dial = await E(() => {
      const board = document.querySelector('[data-panel="rack"] .rk-board'),
        br = board.getBoundingClientRect();
      const d = [...board.querySelectorAll('.kn-dial')].find((k) => {
        const r = k.getBoundingClientRect();
        return (
          r.left >= br.left &&
          r.right <= br.right &&
          r.top >= br.top &&
          r.bottom <= Math.min(br.bottom, innerHeight) - 60 &&
          k.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
        );
      });
      if (!d) return null;
      d.closest('.kn').dataset.probe = 'kn';
      const r = d.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, key: 'kn' };
    });
    if (dial) {
      const kv = (key) =>
        E(
          (key) =>
            parseFloat(
              document.querySelector(`[data-panel="rack"] .kn[data-probe="${key}"]`).style.getPropertyValue('--kv'),
            ),
          key,
        );
      const at = (key) =>
        E((key) => {
          const r = document
            .querySelector(`[data-panel="rack"] .kn[data-probe="${key}"] .kn-dial`)
            .getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, key);
      const k0 = await kv(dial.key);
      const dir = k0 > 0.5 ? 1 : -1; // drag toward the room it has
      // a finger that drags at once scrolls whatever the knob sits in and turns nothing (ui/touch.js: a thumb that
      // scrolls never turns a knob); held still a moment first, the same drag turns it
      const h0 = await E(() => window.overdub.store.history.length);
      await dragTouch(page, run.engine, dial.x, dial.y, dial.x, dial.y + dir * 48);
      const kNo = await kv(dial.key),
        hNo = await E(() => window.overdub.store.history.length);
      T.ok(
        kNo === k0 && hNo === h0,
        `${label}: a finger dragged 48 px from a device knob at once turns nothing (${(k0 * 100).toFixed(0)}% → ${(kNo * 100).toFixed(0)}%, ${hNo - h0} steps)`,
      );
      const d2 = await at(dial.key);
      await dragTouch(page, run.engine, d2.x, d2.y, d2.x, d2.y + dir * 48, 12, 450);
      const k1 = await kv(dial.key);
      // the same 48 px by mouse (synthetic pointer events) still moves it twice as far, as before
      const mouse = await E(
        ([key, dir]) =>
          new Promise((done) => {
            const kn = document.querySelector(`[data-panel="rack"] .kn[data-probe="${key}"]`),
              el = kn.querySelector('.kn-dial'),
              r = el.getBoundingClientRect(),
              x = r.left + r.width / 2,
              y = r.top + r.height / 2;
            const cap = Element.prototype.setPointerCapture;
            Element.prototype.setPointerCapture = function () {};
            const ev = (type, yy) =>
              el.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 9,
                  pointerType: 'mouse',
                  isPrimary: true,
                  clientX: x,
                  clientY: yy,
                  button: 0,
                  buttons: type === 'pointerup' ? 0 : 1,
                }),
              );
            const a = parseFloat(kn.style.getPropertyValue('--kv'));
            ev('pointerdown', y);
            ev('pointermove', y + dir * 24);
            ev('pointermove', y + dir * 48);
            ev('pointerup', y + dir * 48);
            Element.prototype.setPointerCapture = cap;
            setTimeout(() => done(Math.abs(parseFloat(kn.style.getPropertyValue('--kv')) - a)), 100);
          }),
        [dial.key, dir],
      );
      const moved = Math.abs(k1 - k0);
      T.ok(
        moved > 0.08 && moved < 0.25 && mouse > 0.28 && mouse < 0.36,
        `${label}: held still a moment, a 48 px knob drag by finger moves ${(moved * 100).toFixed(0)}% of the range (by mouse, ${(mouse * 100).toFixed(0)}%)`,
      );
    } else T.ok(false, `${label}: a device knob is on screen to drag`);
    // the mixer under a finger: M, S, ● and the pan knob are 44 px (they were 20 x 32 and 28), the strip widened to hold
    // them in a row
    await tap('#ew-tab-mixer');
    await sleep(350);
    const mxb = await E(boxes, [
      '.mx-strip:not(.mx-master) .mx-mute',
      '.mx-strip:not(.mx-master) .mx-solo',
      '.mx-strip:not(.mx-master) .mx-arm',
      '.mx-strip:not(.mx-master) .mx-pan .mk',
    ]);
    T.ok(
      mxb.every((b) => big(b, 44, 44)),
      `${label}: the mixer's M, S, ● and pan knob are 44 px targets (${fmt(mxb)})`,
    );
    // the sticky master sits over no strip's S or ● (the strips fit whole beside it), and a phone with room for one
    // strip only (360 px) shows the next one's edge, not one strip stretched across the screen
    const mxFit = () =>
      E(() => {
        const m = document.querySelector('.mx-master').getBoundingClientRect();
        const ws = [...document.querySelectorAll('.mx-strip:not(.mx-master)')].map((e) =>
          Math.round(e.getBoundingClientRect().width),
        );
        const cut = [...document.querySelectorAll('.mx-strip:not(.mx-master) :is(.mx-solo, .mx-arm)')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.left < m.left - 0.5 && r.right > m.left + 0.5;
        }).length;
        return { w: ws[0], n: ws.length, cut, room: Math.round(m.left), vw: innerWidth };
      });
    const f1 = await mxFit();
    T.ok(
      f1.n && !f1.cut,
      `${label}: the master covers no strip's S or ● (${f1.cut} cut; strips ${f1.w} px in ${f1.room} px beside it)`,
    );
    if (!run.device && !run.turn) {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: 360, height: 640 });
      await sleep(400);
      const f2 = await mxFit();
      T.ok(
        f2.n > 1 && !f2.cut && f2.w < f2.room - 40,
        `${label} at 360x640: one strip and the next one's edge, the master over neither's S or ● (strip ${f2.w} px in ${f2.room}, ${f2.cut} cut)`,
      );
      await page.setViewportSize(vp);
      await sleep(400);
    }
    await shot('mixer-keys');
    await tap('#ew-tab-rack');
    await sleep(300);
    // ---- small chips under a finger: History's Undo this and filter chips, the agent's context ✕, the Band picker's
    // style chips and Cancel, Sketch's Snap and grid chips each reach 40 px tall to the touch (a tap 19 px above and
    // below the middle still lands on it), however small the pill is drawn
    {
      const reach = (sels) =>
        sels
          .map((sel) => {
            const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length);
            if (!el) return `${sel} missing`;
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            const r = el.getBoundingClientRect(),
              x = r.left + r.width / 2,
              y = r.top + r.height / 2;
            const miss = [y - 19, y + 19]
              .map((yy) => document.elementFromPoint(x, yy))
              .filter((hit) => !hit || !(hit === el || el.contains(hit)));
            return miss.length
              ? `${sel} drawn ${Math.round(r.height)} px at y ${Math.round(y)}, short to the touch (lands on ${miss.map((m) => (m ? m.tagName.toLowerCase() + '.' + String(m.className).split(' ')[0] : 'nothing')).join(', ')})`
              : null;
          })
          .filter(Boolean);
      await E(() => {
        const o = window.overdub;
        o.store.dispatch(
          { type: 'project.set', patch: { tempo: o.store.get().tempo + 1 } },
          { by: 'you', label: 'tempo' },
        );
        o.ui.show('history');
      });
      await sleep(450);
      const hist = await E(reach, ['.hi-row .hi-undo', '.hi-filters .hi-filter']);
      await E(() => {
        const o = window.overdub,
          t = o.store.get().tracks.find((x) => x.kind === 'instrument' && x.clips.some((c) => c.kind === 'notes')),
          c = t.clips.find((c) => c.kind === 'notes');
        o.ui.select({ track: t.id, clip: c.id, notes: [] });
        o.arranger.selectClips([c.id]);
        o.ui.show('agent');
      });
      await sleep(450);
      await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove())); // a passing toast isn't the target
      const ctx = await E(reach, ['.ag-ctx-x']);
      await E(() => {
        const o = window.overdub,
          t = o.store.get().tracks.find((x) => x.kind === 'instrument' && x.clips.some((c) => c.kind === 'notes')),
          c = t.clips.find((c) => c.kind === 'notes');
        o.ui.setOpen('right', false);
        o.band.open({ track: t.id, clip: c.id });
      });
      await sleep(350);
      const band = await E(reach, ['.band-pop .band-chip', '.band-pop .band-foot .ew-btn-small']);
      await shot('band-picker');
      await E(() => {
        window.overdub.band.close();
        window.overdub.ui.show('sketch');
      });
      await sleep(350);
      // Sketch's option row as a take draws it (a Snap chip and the 1/16 · 1/8 grid), in the Sketch pane
      const sk = await E((reachSrc) => {
        const pane = document.querySelector('[data-panel="sketch"]'),
          row = document.createElement('div');
        row.className = 'sk-opts sk-probe';
        row.innerHTML =
          '<button class="sk-chip">Snap: C minor</button><span class="sk-seg"><button class="on">1/16</button><button>1/8</button></span>';
        pane.prepend(row);
        // biome-ignore lint/security/noGlobalEval: runs the test's own source in the page
        const out = (0, eval)(reachSrc)(['.sk-probe .sk-chip', '.sk-probe .sk-seg button']);
        row.remove();
        return out;
      }, `(${reach})`);
      const short = [...hist, ...ctx, ...band, ...sk];
      T.ok(
        !short.length,
        `${label}: History's Undo this and filters, the context ✕, the Band picker's chips and Cancel, and Sketch's Snap and grid chips are 40 px tall to the touch${short.length ? ' (' + short.join('; ') + ')' : ''}`,
      );
      await E(() => {
        window.overdub.arranger.selectClips([]);
        window.overdub.ui.select({ clip: null });
      });
    }
    // ---- the agent sheet's handle: drag up for the whole height, drag down to close; reopened, it's at 70% again
    {
      const ag = () =>
        E(() => {
          const el = document.querySelector('.ew-region-right'),
            r = el.getBoundingClientRect(),
            g = el.querySelector('.ew-agent-grip')?.getBoundingClientRect();
          return {
            open: window.overdub.ui.isOpen('right') && !!el.getClientRects().length,
            top: Math.round(r.top),
            gy: g ? Math.round(g.top + g.height / 2) : null,
            gx: g ? Math.round(g.left + g.width / 2) : null,
            gh: g ? Math.round(g.height) : 0,
          };
        });
      await tap('.ew-t-panelRight');
      await sleep(450);
      const a0 = await ag();
      await dragTouch(page, run.engine, a0.gx, a0.gy, a0.gx, Math.max(4, a0.gy - 300));
      await sleep(200);
      const a1 = await ag();
      T.ok(
        a0.gy != null && a1.open && a1.top <= 2,
        `${label}: dragging the agent sheet's handle up takes it to the whole height (${a0.top} → ${a1.top})`,
      );
      await shot('agent-full');
      await dragTouch(page, run.engine, a1.gx, a1.gy, a1.gx, vp.h - 10);
      // a swipe that fast flings in Chromium on Linux, and a tap while the fling runs only stops it (no click): wait it out
      await sleep(2000);
      const a2 = await ag();
      T.ok(
        !a2.open,
        `${label}: dragging it down closes the agent sheet (${a2.open ? 'still open at ' + a2.top : 'closed'})`,
      );
      await tap('.ew-t-panelRight');
      await sleep(450);
      const a3 = await ag();
      T.ok(
        a3.open && Math.abs(a3.top - a0.top) <= 4,
        `${label}: opened again, the agent sheet is back at about 70% (${a3.top} px from the top)`,
      );
      await tap('.ew-region-right .ew-sheet-x');
      await sleep(300);
      T.ok(!(await ag()).open, `${label}: the close button still closes it`);
    }
    // ---- Keep and Build the band on a phone: the new clips scroll into view and flash; the band plays the take back
    {
      // (the detail sheet was left at full height above, which leaves the lanes no room: tuck it to its tabs)
      await E(() => {
        const o = window.overdub;
        o.ui.setOpen('bottom', false);
        o.engine.playing && o.engine.stop();
        const sc = document.querySelector('.ar-scroll');
        sc.scrollLeft = sc.scrollWidth;
        sc.scrollTop = sc.scrollHeight;
      });
      await sleep(150);
      const k = await E(() => {
        const o = window.overdub,
          p = o.input.capture.add({
            src: 'tap',
            kind: 'drums',
            notes: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ p: i % 2 ? 38 : 36, t: i * 0.5, d: 0.25, v: 0.9 })),
            tempo: o.store.get().tempo,
          });
        return o.input.capture.keep(p.id, {});
      });
      await sleep(200);
      const seen = (ids) =>
        E((ids) => {
          const o = window.overdub,
            sc = document.querySelector('.ar-scroll'),
            z = o.ui.state.zoom,
            rows = o.store.get().tracks.map((t) => t.id);
          return ids.map((id) => {
            const f = o.store.findClip(id),
              x = f.clip.start * z.pxPerBeat,
              y = rows.indexOf(f.track.id) * z.trackH;
            const ok =
              x >= sc.scrollLeft - 1 &&
              x <= sc.scrollLeft + sc.clientWidth - 20 &&
              y + z.trackH > sc.scrollTop &&
              y < sc.scrollTop + sc.clientHeight &&
              !!o.arranger.flashing(id);
            return (
              ok ||
              `x ${Math.round(x)} in ${Math.round(sc.scrollLeft)}+${sc.clientWidth}, y ${y} in ${Math.round(sc.scrollTop)}+${sc.clientHeight}, flash ${o.arranger.flashing(id)}`
            );
          });
        }, ids);
      const ks = k.ok ? (await seen([k.clip]))[0] : k.error;
      T.ok(
        ks === true,
        `${label}: a kept take scrolls into view in the timeline and flashes${ks === true ? '' : ' (' + ks + ')'}`,
      );
      const before = await E(() => window.overdub.store.get().tracks.flatMap((t) => t.clips.map((c) => c.id)));
      await E(
        (t) => {
          document.querySelector('.ar-scroll').scrollLeft = 1e6;
          window.overdub.band.open(t);
        },
        { track: k.track, clip: k.clip },
      );
      await sleep(200);
      await tap('.band-go');
      await page
        .waitForFunction(
          () => [...document.querySelectorAll('.ew-toast')].some((t) => /Band in/.test(t.textContent)),
          null,
          { timeout: 30000 },
        )
        .catch(() => {});
      await sleep(250);
      const b = await E((before) => {
        const o = window.overdub;
        return {
          ids: o.store
            .get()
            .tracks.flatMap((t) => t.clips.map((c) => c.id))
            .filter((id) => !before.includes(id)),
          playing: o.engine.playing,
        };
      }, before);
      const bs = b.ids.length ? await seen(b.ids) : [];
      T.ok(
        b.playing && bs.some((x) => x === true),
        `${label}: Build the band shows a new part in the timeline, flashing, and plays the take back (playing ${b.playing}; in view ${bs.filter((x) => x === true).length} of ${bs.length}${bs.every((x) => x === true) ? '' : ': ' + bs.find((x) => x !== true)})`,
      );
      await shot('band-built');
      await E(() => {
        const o = window.overdub;
        o.engine.stop();
        o.store.undo();
        o.store.undo();
      });
    }
    // ---- "Hold to hear" by finger: a tap plays two seconds of the take and lets go by itself, and the card says to
    // hold to keep listening; a hold plays until you let go, as before
    {
      await E(() => {
        const o = window.overdub;
        o.engine.stop();
        const t = o.store.get().tracks.find((x) => x.kind === 'instrument');
        o.tools.run(
          'propose_variations',
          {
            variations: [
              {
                label: 'up',
                ops: [
                  {
                    type: 'clip.add',
                    track: t.id,
                    clip: { kind: 'notes', start: 64, length: 4, notes: [{ p: 67, t: 0, d: 1, v: 0.8 }] },
                  },
                ],
              },
              {
                label: 'down',
                ops: [
                  {
                    type: 'clip.add',
                    track: t.id,
                    clip: { kind: 'notes', start: 64, length: 4, notes: [{ p: 55, t: 0, d: 1, v: 0.8 }] },
                  },
                ],
              },
            ],
            wait_seconds: 0,
          },
          { by: 'mcp:probe' },
        );
        o.ui.show('agent');
      });
      await sleep(450);
      const sel = '.ag-vars:last-of-type .ag-take:not(.ag-take-orig) .ag-hold';
      const on = () => E(() => !!document.querySelector('.ag-take.on'));
      await E((s) => document.querySelectorAll(s)[0]?.scrollIntoView({ block: 'center', behavior: 'instant' }), sel);
      const under = await E((s) => {
        const el = document.querySelector(s),
          r = el.getBoundingClientRect(),
          at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (el.contains(at)) return 'the button';
        if (!at) return 'nothing';
        const path = [];
        for (let n = at; n && n !== document.body && path.length < 5; n = n.parentElement)
          path.push(
            n.tagName.toLowerCase() +
              (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''),
          );
        return path.join(' < ') + ' "' + (at.textContent || '').trim().slice(0, 40) + '"';
      }, sel);
      await tap(sel);
      const at1 = await on();
      const tip = await E(
        () => [...document.querySelectorAll('.ag-take-tip')].map((e) => e.textContent).find(Boolean) || '',
      );
      await sleep(2300);
      const at2 = await on();
      const pass = await E(() => {
        const t = window.overdub.ui.toast('probe', { action: { label: 'Undo', run() {} } }),
          r = {
            text: getComputedStyle(t).pointerEvents,
            button: getComputedStyle(t.querySelector('button')).pointerEvents,
          };
        t.remove();
        return r;
      });
      T.ok(
        pass.text === 'none' && pass.button === 'auto',
        `${label}: a toast lets a tap through to what's under it, except on its own button (${pass.text} / ${pass.button})`,
      );
      T.ok(
        at1 && !at2 && /hold to keep listening/i.test(tip),
        `${label}: a tap on Hold to hear plays a two-second listen, then lets go (${at1 ? 'playing' : 'silent'} at once, ${at2 ? 'still playing' : 'let go'} after 2.3 s; "${tip}"; under the finger: ${under})`,
      );
      // a held finger (touch pointer events) plays until it lets go
      const held = await E(
        (s) =>
          new Promise((done) => {
            const el = document.querySelector(s),
              r = el.getBoundingClientRect(),
              x = r.left + r.width / 2,
              y = r.top + r.height / 2;
            const cap = Element.prototype.setPointerCapture;
            Element.prototype.setPointerCapture = function () {};
            const ev = (type) =>
              el.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  pointerId: 11,
                  pointerType: 'touch',
                  isPrimary: true,
                  clientX: x,
                  clientY: y,
                  button: 0,
                  buttons: type === 'pointerup' ? 0 : 1,
                }),
              );
            ev('pointerdown');
            setTimeout(() => {
              const mid = !!document.querySelector('.ag-take.on');
              ev('pointerup');
              Element.prototype.setPointerCapture = cap;
              setTimeout(() => done({ mid, after: !!document.querySelector('.ag-take.on') }), 150);
            }, 700);
          }),
        sel,
      );
      T.ok(
        held.mid && !held.after,
        `${label}: holding Hold to hear plays the take until the finger lets go (${held.mid ? 'playing' : 'silent'} while held, ${held.after ? 'still playing' : 'let go'} after)`,
      );
      await E(() => {
        document.querySelectorAll('.ag-vars:last-of-type .ag-card-foot .ag-link').forEach((b) => b.click());
        window.overdub.engine.stop();
        window.overdub.ui.setOpen('right', false);
      });
      await sleep(200);
    }
    // ---- what the sixth round of testers found on a phone (docs/FRESH-EYES-6.md) that a finger meets anywhere
    await phoneSix(page, E, label, shot, tap);
    // ---- under a finger, a drag scrolls and a hold edits (docs/FRESH-EYES-4.md, the phone's problems 1 and 8): in the
    // Beat grid a swipe scrolls the rows (32 px squares) and paints nothing, a tap adds one hit, a hold then a drag
    // paints along the row (one undo step, and the first hold says so); in the Mixer a swipe on a fader or a pan knob
    // moves nothing, and a hold then a drag moves the fader. Real touch points (CDP) in Chromium.
    if (run.engine === 'chromium') await fingerEdits(page, E, label, shot);
    // a thumb that scrolls turns no knob and moves no fader (docs/FRESH-EYES-6.md, the phone's broken 2): from a Jam
    // room pedal's knob and from Studio A's ROOM strip a swipe scrolls; held still first, the same drag moves them
    if (run.engine === 'chromium') await thumbScrolls(page, E, label, shot);
    // the play button still answers with the sheets gone
    T.ok(
      big((await E(boxes, ['.tp-play']))[0], 40),
      `${label}: play is still on screen and reachable after the sheets`,
    );
    const errs = errors.slice(0, 4);
    T.ok(
      !errs.length,
      `${label}: no console or page errors${errs.length ? ': ' + errs.join(' | ').slice(0, 500) : ''}`,
    );
  } catch (e) {
    T.ok(
      false,
      `${label}: the run finished (${String((e && e.stack) || e)
        .split('\n')
        .slice(0, 3)
        .join(' ')})`,
    );
  }
  await browser.close().catch(() => {});
}

// ------------------------------------------------------------------------------------------------ the simple view
// The controls a person sees (the inventory probe's rule: visible button, a, input, select, textarea and button-like
// roles, in the viewport)
const controls = () =>
  [
    ...document.querySelectorAll(
      'button, a[href], a[role], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [role=spinbutton]',
    ),
  ]
    .filter((e) => {
      if (!e.getClientRects().length || e.closest('[inert]')) return false;
      const r = e.getBoundingClientRect(),
        cs = getComputedStyle(e);
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < innerHeight &&
        r.left < innerWidth &&
        cs.visibility !== 'hidden' &&
        Number(cs.opacity) > 0
      );
    })
    .map((e) =>
      (e.getAttribute('aria-label') || e.textContent || e.className || e.tagName)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 20),
    );
// The Find sheet: the box around its search field, marked [data-test-more] so the text check can scope to it
const moreSheet = () => {
  const inp = [...document.querySelectorAll('input')].find(
    (i) => /^Find anything/.test(i.placeholder || '') && i.getClientRects().length,
  );
  if (!inp) return null;
  let b = inp.parentElement;
  while (
    b &&
    b !== document.body &&
    !(b.getAttribute('role') === 'dialog' || ['fixed', 'absolute'].includes(getComputedStyle(b).position))
  )
    b = b.parentElement;
  b.setAttribute('data-test-more', '');
  const r = b.getBoundingClientRect(),
    t = b.innerText;
  const adds = [...b.querySelectorAll('.ws-row')]
    .filter((x) => x.getClientRects().length)
    .map((x) => x.getBoundingClientRect())
    .filter((q) => q.top >= r.top && q.bottom <= Math.min(r.bottom, innerHeight));
  const at = (re) => {
    const m = re.exec(t);
    return m ? m.index : -1;
  };
  return {
    l: Math.round(r.left),
    t: Math.round(r.top),
    r: Math.round(r.right),
    b: Math.round(r.bottom),
    h: Math.round(r.height),
    vh: innerHeight,
    vw: innerWidth,
    full: at(/Full studio/),
    song: at(/\bSong\b/),
    tempo: at(/Tempo/),
    key: at(/\bKey\b/),
    make: at(/(^|\n)Make(\n|$)/),
    adds: adds.map((q) => Math.round(q.height)),
    searchPx: parseFloat(getComputedStyle(inp).fontSize),
  };
};
async function simplePhone(pw, srvUrl, run) {
  const tag = `${run.engine}-${run.device ? pw.devices[run.device].viewport.width : run.w}-simple`;
  const label = (run.device ? `${run.engine} ${run.device}` : `${run.engine} ${run.w}x${run.h}`) + ', simple';
  let browser;
  try {
    browser =
      run.engine === 'webkit'
        ? await pw.webkit.launch({ headless: !HEADED })
        : await pw.chromium.launch({
            headless: !HEADED,
            executablePath: HEADED ? undefined : findChromium(),
            args: ['--autoplay-policy=no-user-gesture-required', ...QUIET, ...TEXT],
          });
  } catch (e) {
    const msg = String((e && e.message) || e).split('\n')[0];
    if (process.env.REQUIRE_ALL) T.ok(false, `${label}: launches (${msg})`);
    else T.note(`${label}: not available here, skipped (${msg})`);
    return;
  }
  const opts = run.device
    ? { ...pw.devices[run.device] }
    : { viewport: { width: run.w, height: run.h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && (e.stack || e.message)) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) errors.push('console: ' + m.text());
  });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: path.join(OUTDIR, `phone-${tag}-${n}.png`) });
  const noSideways = async (where) => {
    const s = await E(pageWide);
    T.ok(
      s.doc <= s.vw && s.body <= s.vw && s.sx === 0,
      `${label}: no sideways page scroll ${where} (${s.doc} px in ${s.vw})`,
    );
  };
  const readable = async (scope, where) => {
    const s = await E(smallText, scope);
    T.ok(!s.length, `${label}: no text under 12 px ${where}${s.length ? ': ' + s.slice(0, 6).join(', ') : ''}`);
  };
  const fmt = (bs) =>
    bs.map((b) => (b.miss ? `${b.sel} missing` : `${b.sel} ${b.w}x${b.h}${b.on ? '' : ' off screen'}`)).join(', ');
  const moreBtn = () =>
    E(() => {
      const bar = document.querySelector('.ew-ws') || document.querySelector('.ew-top');
      const b = [...bar.querySelectorAll('button')].find(
        (x) => x.getClientRects().length && x.classList.contains('ws-find-btn'),
      );
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: Math.round(r.width),
        h: Math.round(r.height),
        on: r.left >= 0 && r.right <= innerWidth && r.top >= 0,
      };
    });
  try {
    await page.goto(srvUrl + '/app/?view=simple', { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await sleep(700);
    const view = await E(() => window.overdub.ui.workspace?.view?.() || null);
    T.ok(view === 'simple', `${label}: ?view=simple opens the simple view (${view})`);
    const c = await E(controls);
    T.ok(c.length <= 18, `${label}: 18 or fewer controls on the first screen (${c.length}: ${c.join(' | ')})`);
    await noSideways('on the first screen');
    // the top row: mark, title, agent, stop, play, record, undo, Find; the Song menu, Tempo and Key are in Find
    const tb = await E(boxes, [
      '.tp-title',
      '.tp-g-play .tp-btn:first-child',
      '.tp-play',
      '.tp-rec',
      '.ew-t-panelRight',
    ]);
    const mb = await moreBtn();
    T.ok(
      tb.every((b) => !b.miss && b.on) && mb && mb.on,
      `${label}: the top row fits: title, stop, play, record, agent and Find on screen (${fmt(tb.filter((b) => b.miss || !b.on)) || 'all there'}${mb ? '' : ', Find missing'})`,
    );
    T.ok(
      tb.slice(1).every((b) => !b.miss && b.h >= 39.5 && b.w >= 39.5) && mb && mb.h >= 39.5 && mb.w >= 39.5,
      `${label}: its keys are 40 px targets (${fmt(tb.slice(1))}, Find ${mb ? mb.w + 'x' + mb.h : 'missing'})`,
    );
    const off = await E(() => {
      const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const labs = [...document.querySelectorAll('[data-panel="transport"] .tp-lab')]
        .filter(vis)
        .map((x) => x.textContent.trim());
      return { song: [...document.querySelectorAll('.ew-top .sm-btn')].some(vis), labs };
    });
    T.ok(
      !off.song && !off.labs.some((l) => /^(Tempo|Key)$/.test(l)),
      `${label}: the Song menu, Tempo and Key are off the top row (Song ${off.song ? 'on the bar' : 'in Find'}; labels: ${off.labs.join(', ') || 'none'})`,
    );
    await shot('first');
    // Find: a bottom sheet, inside the viewport, at most 70% of its height
    if (mb) {
      await page.touchscreen.tap(mb.x, mb.y);
      await sleep(400);
    }
    const sh = await E(moreSheet);
    T.ok(!!sh, `${label}: a tap on Find opens its sheet`);
    if (sh) {
      T.ok(
        sh.l >= 0 && sh.r <= sh.vw && sh.t >= 0 && sh.b <= sh.vh + 0.5 && sh.vh - sh.b <= 2,
        `${label}: the Find sheet sits at the bottom, inside the viewport (${sh.l},${sh.t}..${sh.r},${sh.b} in ${sh.vw}x${sh.vh})`,
      );
      T.ok(sh.h <= sh.vh * 0.7 + 1, `${label}: ... no taller than 70% of it (${sh.h} of ${sh.vh} px)`);
      T.ok(
        sh.full >= 0 &&
          sh.song >= 0 &&
          sh.tempo >= 0 &&
          sh.key >= 0 &&
          (sh.make < 0 || Math.max(sh.full, sh.song, sh.tempo, sh.key) < sh.make),
        `${label}: its first rows are Full studio, the Song menu, Tempo and Key, before the features (at ${sh.full}, ${sh.song}, ${sh.tempo}, ${sh.key}; Make at ${sh.make})`,
      );
      T.ok(
        sh.adds.length > 0 && sh.adds.every((hh) => hh >= 39.5),
        `${label}: its rows are 40 px targets (${sh.adds.join(', ')} px)`,
      );
      T.ok(
        sh.searchPx >= 16,
        `${label}: its search field is 16 px text, so Safari doesn't zoom into it (${sh.searchPx} px)`,
      );
      await readable('[data-test-more]', 'in the Find sheet');
      await noSideways('with Find open');
      await shot('more');
      await page.keyboard.press('Escape');
      await sleep(300);
      const closed = await E(
        () =>
          ![...document.querySelectorAll('input')].some(
            (i) => /^Find anything/.test(i.placeholder || '') && i.getClientRects().length,
          ),
      );
      T.ok(closed, `${label}: and it closes again`);
    }
    const errs = errors.slice(0, 4);
    T.ok(
      !errs.length,
      `${label}: no console or page errors${errs.length ? ': ' + errs.join(' | ').slice(0, 500) : ''}`,
    );
  } catch (e) {
    T.ok(
      false,
      `${label}: the run finished (${String((e && e.stack) || e)
        .split('\n')
        .slice(0, 3)
        .join(' ')})`,
    );
  }
  await browser.close().catch(() => {});
}

// ------------------------------------------------------------------------------------------------ on its side
// Upright first, then turned (setViewportSize, as a phone rotating): the sheet was sized for a tall screen and used to
// take the whole height (the timeline 0 px), the title went, the transport keys shrank to 30 x 34, Browser and Agent
// lost their words, M S R were 19 px, device knobs 23 px, the agent's "Describe a sound" key was cut off, and the
// arranger's hint said double-click.
async function sideways(pw, srvUrl, run) {
  const [W, H] = run.turn;
  const label = `${run.engine} ${run.device || run.w + 'x' + run.h} on its side (${W}x${H})`;
  const tag = `${run.engine}-${W}`;
  let browser;
  try {
    browser =
      run.engine === 'webkit'
        ? await pw.webkit.launch({ headless: !HEADED })
        : await pw.chromium.launch({
            headless: !HEADED,
            executablePath: HEADED ? undefined : findChromium(),
            args: ['--autoplay-policy=no-user-gesture-required', ...QUIET, ...TEXT],
          });
  } catch (e) {
    const msg = String((e && e.message) || e).split('\n')[0];
    if (process.env.REQUIRE_ALL) T.ok(false, `${label}: launches (${msg})`);
    else T.note(`${label}: not available here, skipped (${msg})`);
    return;
  }
  const opts = run.device
    ? { ...pw.devices[run.device] }
    : { viewport: { width: run.w, height: run.h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && (e.stack || e.message)) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) errors.push('console: ' + m.text());
  });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: path.join(OUTDIR, `phone-${tag}-side-${n}.png`) });
  const tap = async (sel) => {
    const r = await page.locator(sel).first().boundingBox();
    if (!r) return false;
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    await sleep(150);
    return true;
  };
  const big = (b, min, minW = min) => !b.miss && b.h >= min - 0.5 && b.w >= minW - 0.5 && b.on;
  const fmt = (bs) =>
    bs.map((b) => (b.miss ? `${b.sel} missing` : `${b.sel} ${b.w}x${b.h}${b.on ? '' : ' off screen'}`)).join(', ');
  try {
    await page.goto(srvUrl + '/app/?demo', { waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await sleep(600);
    if (await page.isVisible('.ar-welcome')) {
      await tap('.ar-welcome-x');
      await sleep(300);
    }
    await page.setViewportSize({ width: W, height: H });
    await sleep(900);
    const vp = await E(() => ({ w: innerWidth, h: innerHeight }));
    // the song keeps a band in view above the sheet: the ruler and the top of the lanes
    const band = () =>
      E(() => {
        const c = document.querySelector('.ew-region-center').getBoundingClientRect(),
          lw = document.querySelector('.ar-lanewrap').getBoundingClientRect(),
          s = document.querySelector('.ew-split-v').getBoundingClientRect();
        return {
          center: Math.round(Math.min(c.bottom, s.top) - c.top),
          lanes: Math.round(Math.min(lw.bottom, s.top) - lw.top),
          sheet: Math.round(s.top),
        };
      });
    const b0 = await band();
    T.ok(
      b0.center >= 100 && b0.lanes >= 24,
      `${label}: the song stays in view above the sheet (${b0.center} px of the arranger, ${b0.lanes} px of its lanes)`,
    );
    await shot('turned');
    // the first drag on the sheet's handle after the turn moves it. (The sheet kept its upright height, drawn clamped to
    // the room, and a drag started from that height: the first one moved nothing.) Down 80 px tucks it away here
    const g0 = await E(() => {
      const g = document.querySelector('.ew-grip').getBoundingClientRect();
      return {
        x: Math.round(innerWidth / 2),
        y: Math.round(g.top + g.height / 2),
        open: window.overdub.ui.isOpen('bottom'),
      };
    });
    await dragTouch(page, run.engine, g0.x, g0.y, g0.x, g0.y + 80);
    await sleep(300);
    const g1 = await E(() => {
      const g = document.querySelector('.ew-grip').getBoundingClientRect();
      return { y: Math.round(g.top + g.height / 2), open: window.overdub.ui.isOpen('bottom') };
    });
    T.ok(
      g0.open && g1.y - g0.y >= 40,
      `${label}: the first drag after the turn moves the sheet (its handle dragged down 80 px moved ${g1.y - g0.y} px${g1.open ? '' : ', tucked away'})`,
    );
    await E(() => window.overdub.ui.setOpen('bottom', true)); // (back as the turn left it, for what follows)
    await sleep(400);
    // the top bar: one row, the title whole, and every key a thumb's size, the panes in words
    const tb = await E(boxes, [
      '.tp-title',
      '.tp-g-play .tp-btn:first-child',
      '.tp-play',
      '.tp-rec',
      '.tp-kill',
      '.sm-btn',
      '.ew-t-panelLeft',
      '.ew-t-panelRight',
    ]);
    T.ok(
      tb.every((b) => !b.miss && b.on),
      `${label}: the top bar holds the title, stop, play, record, All off, the song menu, the browser and the agent (${fmt(tb.filter((b) => b.miss || !b.on)) || 'all there'})`,
    );
    T.ok(
      tb.slice(1).every((b) => big(b, 40)),
      `${label}: each key on it is a 40 px target (${fmt(tb.slice(1))})`,
    );
    const over = await E(() => {
      const seen = (el) =>
        el.getClientRects().length > 0 &&
        getComputedStyle(el).display !== 'none' &&
        getComputedStyle(el).visibility !== 'hidden';
      const items = [
        ...document.querySelectorAll(
          '.ew-brand, .tp-row > .tp-group, .ew-region-top > [data-panel="song"], .ew-toggles > button',
        ),
      ]
        .filter(seen)
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { n: el.className.split(' ').slice(-1)[0], l: b.left, r: b.right };
        });
      return items.flatMap((a, i) =>
        items
          .slice(i + 1)
          .filter((b) => a.l < b.r - 1 && b.l < a.r - 1)
          .map((b) => `${a.n}/${b.n}`),
      );
    });
    T.ok(!over.length, `${label}: nothing on the top bar sits over anything else (${over.join(', ') || 'none'})`);
    const title = await E(() => {
      const t = document.querySelector('.tp-title');
      return {
        text: t?.textContent,
        shown: !!t?.getClientRects().length,
        clipped: !!t && t.scrollWidth > t.clientWidth + 1,
        fs: t ? parseFloat(getComputedStyle(t).fontSize) : 0,
      };
    });
    // (a narrow bar steps the title's type down to fit, 13 px at the least, as it does on a desktop)
    T.ok(
      title.shown && !title.clipped && title.fs >= 13,
      `${label}: the song title reads whole ("${title.text}", ${title.fs} px)`,
    );
    const words = await E(() =>
      ['.ew-t-panelLeft', '.ew-t-panelRight'].map((s) => document.querySelector(s)?.innerText.trim()),
    );
    T.ok(
      words[0] === 'Browser' && words[1] === 'Agent',
      `${label}: the browser and the agent are in words (${words.map((w) => JSON.stringify(w)).join(', ')})`,
    );
    const top = await E(() => Math.round(document.querySelector('.ew-top').getBoundingClientRect().height));
    T.ok(top <= 60, `${label}: the top bar is one row (${top} px tall)`);
    // the arranger: M S R and the Follow lamp are 40 px; the hint for a mouse isn't there
    const hb = await E(boxes, [
      '.ar-head .ar-hb-mute',
      '.ar-head .ar-hb-solo',
      '.ar-head .ar-hb-arm',
      '.ar-tool.ar-follow',
    ]);
    T.ok(
      hb.every((b) => !b.miss && b.w >= 39.5 && b.h >= 39.5),
      `${label}: the track headers' M, S and R and the Follow lamp are 40 px (${fmt(hb)})`,
    );
    const hint = await E(() => {
      const el = document.querySelector('.ar-hint');
      return el && el.getClientRects().length && getComputedStyle(el).display !== 'none' ? el.textContent : '';
    });
    T.ok(!/click/i.test(hint), `${label}: the arranger doesn't tell a finger to click or double-click ("${hint}")`);
    await readable('.ew-top', label, 'in the top bar', E);
    // Devices, the sheet as the turn left it: the knobs stay 40 px, and a finger can bring what's under them into view
    // (the agent's key included): only the scrollers a finger can scroll are scrolled
    await E(() => {
      const o = window.overdub,
        t = o.store.get().tracks.find((x) => x.kind === 'instrument' && !x.inserts.length) || o.store.get().tracks[0];
      o.ui.select({ track: t.id, insert: null });
    });
    await tap('#ew-tab-rack');
    await sleep(700);
    const rk = await E(() => {
      const board = document.querySelector('[data-panel="rack"] .rk-board'),
        dials = [...board.querySelectorAll('.kn-dial')]
          .filter((d) => d.getClientRects().length)
          .map((d) => d.getBoundingClientRect().width);
      const ask = board.querySelector('.rk-ask');
      if (!ask) return { knob: 0, n: dials.length, ask: false, askH: 0, shown: 0 };
      for (let p = ask.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p),
          r = ask.getBoundingClientRect(),
          pr = p.getBoundingClientRect();
        if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) {
          if (r.bottom > pr.bottom) p.scrollTop += r.bottom - pr.bottom + 2;
          else if (r.top < pr.top) p.scrollTop -= pr.top - r.top + 2;
        }
        if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) {
          if (r.right > pr.right) p.scrollLeft += r.right - pr.right + 2;
          else if (r.left < pr.left) p.scrollLeft -= pr.left - r.left + 2;
        }
      }
      // how much of it shows: inside the window and every box that clips it
      const r = ask.getBoundingClientRect();
      let top = Math.max(r.top, 0),
        bottom = Math.min(r.bottom, innerHeight),
        left = Math.max(r.left, 0),
        right = Math.min(r.right, innerWidth);
      for (let p = ask.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const pr = p.getBoundingClientRect();
        top = Math.max(top, pr.top);
        bottom = Math.min(bottom, pr.bottom);
        left = Math.max(left, pr.left);
        right = Math.min(right, pr.right);
      }
      const shown = Math.max(0, bottom - top),
        wide = Math.max(0, right - left);
      return {
        knob: dials.length ? Math.round(Math.min(...dials)) : 0,
        n: dials.length,
        ask: shown >= r.height - 1 && wide >= r.width - 1,
        askH: Math.round(r.height),
        shown: Math.round(shown),
      };
    });
    T.ok(
      rk.n && rk.knob >= 40,
      `${label}: device knobs are 40 px or more (${rk.n} knobs, ${rk.knob} px at the smallest)`,
    );
    T.ok(
      rk.ask,
      `${label}: a finger can bring "Describe a sound and the agent can build it" into view whole (${rk.shown} of its ${rk.askH} px)`,
    );
    await shot('devices');
    // a device window on its side: the head is one row (the name, the preset, A and B, close) and the device gets the
    // rest (Studio A's kit had 133 of 390 px under a head and bar of 257); who made it and the scope give way
    {
      const id = await E(() => {
        const o = window.overdub,
          r = o.store.dispatch(
            {
              type: 'track.add',
              ref: 'sa',
              track: { name: 'Studio A', kind: 'instrument', instrument: { device: 'core.drumroom', params: {} } },
            },
            { by: 'you', label: 'phone test: Studio A' },
          );
        o.plugin.open({ track: r.created.sa, slot: 'instrument' });
        return r.created.sa;
      });
      await page
        .waitForFunction(() => document.querySelector('.pw')?.dataset.editor === 'drumroom', null, { timeout: 8000 })
        .catch(() => {});
      await sleep(400);
      const w = await E(() => {
        const pw = document.querySelector('.pw'),
          head = pw.querySelector('.pw-head').getBoundingClientRect(),
          bar = pw.querySelector('.pw-bar'),
          body = pw.querySelector('.pw-body').getBoundingClientRect();
        const seen = (sel) => {
          const el = pw.querySelector(sel);
          return !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
        };
        const inHead = (sel) => {
          const el = pw.querySelector(sel),
            r = el?.getBoundingClientRect();
          return !!r && r.width > 0 && r.top >= head.top - 0.5 && r.bottom <= head.bottom + 0.5;
        };
        return {
          head: Math.round(head.height),
          bar: bar.getClientRects().length ? Math.round(bar.getBoundingClientRect().height) : 0,
          body: Math.round(body.height),
          vh: innerHeight,
          row: inHead('.pw-name') && inHead('.pw-pre-n') && inHead('.pw-ab-b') && inHead('.pw-x'),
          credit: seen('.pw-credit'),
          scope: seen('.pw-live'),
          keys: [...pw.querySelectorAll('.pw-head .pw-key, .pw-head .pw-ib, .pw-head .pw-pre-n')]
            .filter((b) => b.getClientRects().length)
            .map((b) => Math.round(b.getBoundingClientRect().height)),
        };
      });
      T.ok(
        w.row && w.head + w.bar <= 72 && w.body >= Math.round(w.vh * 0.55) && !w.credit && !w.scope,
        `${label}: a device window's head is one row (the name, the preset, A and B, close: ${w.head} px, the bar ${w.bar}), the device gets ${w.body} of ${w.vh} px, who made it and the scope give way`,
      );
      T.ok(
        w.keys.length >= 4 && Math.min(...w.keys) >= 40,
        `${label}: the head's keys are still 40 px (${w.keys.join(', ')})`,
      );
      await shot('window-sideways');
      await E((id) => {
        const o = window.overdub;
        o.plugin.close();
        o.store.dispatch({ type: 'track.remove', track: id }, { by: 'you', label: 'phone test done' });
      }, id);
      await sleep(200);
    }
    // dragged all the way up, the sheet stops short of the song
    const b2 = await band();
    await dragTouch(page, run.engine, Math.round(vp.w / 2), b2.sheet + 11, Math.round(vp.w / 2), 2);
    await sleep(250);
    const b1 = await band();
    T.ok(
      b1.center >= 100 && b1.lanes >= 24,
      `${label}: dragged all the way up, the sheet stops short of the song (${b1.center} px of the arranger, ${b1.lanes} px of lanes)`,
    );
    const s = await E(pageWide);
    T.ok(s.doc <= s.vw && s.body <= s.vw && s.sx === 0, `${label}: no sideways page scroll (${s.doc} px in ${s.vw})`);
    const errs = errors.slice(0, 4);
    T.ok(
      !errs.length,
      `${label}: no console or page errors${errs.length ? ': ' + errs.join(' | ').slice(0, 500) : ''}`,
    );
  } catch (e) {
    T.ok(
      false,
      `${label}: the run finished (${String((e && e.stack) || e)
        .split('\n')
        .slice(0, 3)
        .join(' ')})`,
    );
  }
  await browser.close().catch(() => {});
}
async function readable(scope, label, where, E) {
  const s = await E(smallText, scope);
  T.ok(!s.length, `${label}: no text under 12 px ${where}${s.length ? ': ' + s.slice(0, 6).join(', ') : ''}`);
}

// One finger by CDP: down at the first point, held `hold` ms, then along the rest (16 ms apart), and up.
async function finger(page, pts, hold = 30) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, p) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: p[0], y: p[1], radiusX: 4, radiusY: 4, force: 1, id: 1 }] : [],
    });
  await send('touchStart', pts[0]);
  await sleep(hold);
  for (const p of pts.slice(1)) {
    await send('touchMove', p);
    await sleep(16);
  }
  await send('touchEnd');
  await sleep(250);
  await cdp.detach().catch(() => {});
}
const line = (x0, y0, x1, y1, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

// The sixth round's phone findings that hold in every engine (docs/FRESH-EYES-6.md): Add an effect's search left
// unfocused (no keyboard over its list, 16 px if tapped); Studio A's KIT menu and VIEW lever, Hum it's chips and the
// line over the touch keys reach 44 px; a tap on an instrument in the browser never swaps the selected track's
// instrument out (it did): on a drum track a melodic one asks, a new track first; on a pitched track it's tried, with
// Keep and Back (docs/INSTRUMENTS-UX.md 2.4); at most two toasts, the same one counted.
async function phoneSix(page, E, label, shot, tap) {
  const reach = (sel) =>
    E(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
          .map((e) => {
            e.scrollIntoView({ block: 'center', behavior: 'instant' });
            const r = e.getBoundingClientRect(),
              x = r.left + Math.min(r.width / 2, 20),
              y = r.top + r.height / 2;
            const hit = (yy) => {
              const t = document.elementFromPoint(x, yy);
              return !!t && (t === e || e.contains(t));
            };
            return {
              text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24),
              h: Math.round(r.height),
              w: Math.round(r.width),
              ok: hit(y - 21) && hit(y + 21),
            };
          }),
      sel,
    );
  const say = (xs) => xs.map((x) => `${x.text || '?'} ${x.w}x${x.h}${x.ok ? '' : ' short'}`).join(', ');
  // Add an effect: its search isn't focused under a finger, so no keyboard comes up over the list; it's 16 px
  await E(() => {
    const o = window.overdub,
      t = o.store.get().tracks.find((x) => x.kind === 'instrument');
    o.ui.setOpen('bottom', true);
    o.ui.select({ track: t.id, insert: null });
    o.ui.show('rack');
  });
  await sleep(500);
  await tap('[data-panel="rack"] .rk-head .rk-hb:not(.btn-txt):not(.ew-btn-agent)');
  await sleep(350);
  const fx = await E(() => {
    const q = document.querySelector('.rk-picker .rk-q');
    return q
      ? {
          open: true,
          focused: document.activeElement === q,
          fs: parseFloat(getComputedStyle(q).fontSize),
          inPop: !!document.activeElement?.closest('.ew-pop'),
        }
      : { open: false };
  });
  T.ok(
    fx.open && !fx.focused && fx.inPop && fx.fs >= 16,
    `${label}: Add an effect opens with its search unfocused (no keyboard over the list), focus in the picker, the field ${fx.fs} px`,
  );
  await page.keyboard.press('Escape').catch(() => {});
  await E(() => {
    for (const p of document.querySelectorAll('.ew-pop')) p.remove();
  });
  // Studio A's face in Devices: its KIT menu and its VIEW lever are 44 px to a finger (42 x 14 and 15 x 15)
  const sa = await E(() => {
    const o = window.overdub;
    const r = o.store.dispatch(
      {
        type: 'track.add',
        ref: 'sa',
        track: { name: 'Studio A', kind: 'instrument', instrument: { device: 'core.drumroom', params: {} } },
      },
      { by: 'you', label: 'phone test: Studio A' },
    );
    o.ui.select({ track: r.created.sa, insert: null });
    return r.created.sa;
  });
  await sleep(700);
  const kit = await reach('[data-panel="rack"] .rk-inst .rk-face .ewf-menu select');
  const lever = await reach('[data-panel="rack"] .rk-inst .rk-face .ms-b');
  T.ok(
    kit.length >= 1 && kit.every((x) => x.ok) && lever.length >= 1 && lever.every((x) => x.ok),
    `${label}: Studio A's face in Devices has a 44 px KIT menu and VIEW lever under a finger (${say(kit)}; ${say(lever)})`,
  );
  await shot('studioa-face');
  // the browser: a tap on a melodic instrument while a drum track is selected asks, a new track with it first, and
  // changes nothing until you pick; the line over the list says what a tap does
  await E((id) => {
    const o = window.overdub;
    o.ui.select({ track: id, insert: null });
    o.ui.setOpen('left', true);
    o.ui.show('browser');
  }, sa);
  await sleep(450);
  const tg = await E(() => document.querySelector('.br-target')?.textContent || '');
  T.ok(
    /^Tap tries a kit on Studio A\./.test(tg) &&
      /Another instrument asks first: a track of its own, or on Studio A anyway\./.test(tg) &&
      !/drag|click/i.test(tg),
    `${label}: the browser says what a tap does, and that another instrument asks first ("${tg}")`,
  );
  const before = await E(() => ({
    n: window.overdub.store.history.length,
    tracks: window.overdub.store.get().tracks.length,
  }));
  const row = '.br-row[data-device="core.wavetable"]';
  await E((row) => document.querySelector(row)?.scrollIntoView({ block: 'center', behavior: 'instant' }), row);
  await tap(row);
  await sleep(300);
  const ask = await E(() => ({
    items: [...document.querySelectorAll('.ek-pop .ek-item')].map((b) => b.textContent),
    n: window.overdub.store.history.length,
    dev: window.overdub.store.get().tracks.find((t) => t.name === 'Studio A')?.instrument?.device,
  }));
  T.ok(
    ask.items.length === 2 &&
      /^New track with Light Table/.test(ask.items[0]) &&
      /^On Studio A anyway/.test(ask.items[1]) &&
      ask.n === before.n &&
      ask.dev === 'core.drumroom',
    `${label}: a tap on Light Table on a drum track asks, a new track first, and swaps nothing (${ask.items.join(' / ')}; ${ask.n - before.n} changes)`,
  );
  await shot('browser-ask');
  if (ask.items.length) await tap('.ek-pop .ek-item');
  await sleep(300);
  const after = await E(() => ({
    n: window.overdub.store.history.length,
    tracks: window.overdub.store.get().tracks.length,
    last: window.overdub.store.get().tracks.at(-1)?.instrument?.device,
    dev: window.overdub.store.get().tracks.find((t) => t.name === 'Studio A')?.instrument?.device,
  }));
  T.ok(
    after.tracks === before.tracks + 1 && after.last === 'core.wavetable' && after.dev === 'core.drumroom',
    `${label}: "New track with Light Table" puts it on a track of its own (${after.tracks - before.tracks} track added, Studio A still plays ${after.dev})`,
  );
  // a tap on another melodic instrument with that new (pitched) track selected tries it: no menu, nothing in History,
  // Keep and Back in the line; Back puts Light Table back
  const lt = await E(() => {
    const o = window.overdub,
      t = o.store.get().tracks.at(-1);
    o.ui.select({ track: t.id, insert: null });
    return { id: t.id, n: o.store.history.length };
  });
  await sleep(200);
  const row2 = '.br-row[data-device="core.keys"]';
  await E((row) => document.querySelector(row)?.scrollIntoView({ block: 'center', behavior: 'instant' }), row2);
  await tap(row2);
  await sleep(300);
  const tri = await E((lt) => {
    const o = window.overdub;
    return {
      menu: document.querySelectorAll('.ek-pop .ek-item').length,
      dev: o.store.track(lt.id)?.instrument?.device,
      n: o.store.history.length,
      line: document.querySelector('.br-target')?.textContent || '',
      keep: document.querySelector('.br-target .br-keep')?.getBoundingClientRect().height || 0,
    };
  }, lt);
  T.ok(
    !tri.menu &&
      tri.dev === 'core.keys' &&
      tri.n === lt.n &&
      /^Trying Lamp Tines on Light Table\./.test(tri.line) &&
      tri.keep >= 40,
    `${label}: a tap on Lamp Tines on a pitched track tries it, no menu, nothing in History ("${tri.line}", Keep ${Math.round(tri.keep)} px tall)`,
  );
  await shot('browser-trial');
  await tap('.br-target .br-back');
  await sleep(250);
  const bk = await E(
    (lt) => ({ dev: window.overdub.store.track(lt.id)?.instrument?.device, n: window.overdub.store.history.length }),
    lt,
  );
  T.ok(bk.dev === 'core.wavetable' && bk.n === lt.n, `${label}: Back puts Light Table back, nothing in History`);
  await E((n) => {
    const o = window.overdub;
    while (o.store.history.length > n && o.store.canUndo()) o.store.undo();
    for (const p of document.querySelectorAll('.ek-pop')) p.remove();
    o.ui.setOpen('left', false);
  }, before.n);
  await sleep(300);
  // Sketch: Hum it's Snap and grid chips, and the line over the touch keys, reach 44 px
  await E(() => {
    const o = window.overdub;
    o.ui.setOpen('bottom', true);
    o.ui.show('sketch');
    o.input.emit('sketch:mode', 'hum');
  });
  await sleep(450);
  const hum = await reach('[data-panel="sketch"] .sk-head .sk-opts :is(.sk-chip, .sk-seg button)');
  await E(() => window.overdub.input.emit('sketch:mode', 'play'));
  await sleep(450);
  const keys = await reach('[data-panel="sketch"] .sk-tk-bar .ew-snap-p');
  T.ok(
    hum.length >= 3 && hum.every((x) => x.ok) && keys.length >= 1 && keys.every((x) => x.ok),
    `${label}: Hum it's chips and the line over the touch keys are 44 px to a finger (${say(hum)}; ${say(keys)})`,
  );
  await E(() => window.overdub.input.emit('sketch:mode', 'hum'));
  // toasts: the same one again counts (×2) instead of stacking, and a phone shows two at most
  const ts = await E(async () => {
    const o = window.overdub;
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    o.ui.toast('Probe: the same words');
    o.ui.toast('Probe: the same words');
    const same = [...document.querySelectorAll('.ew-toast')].filter((t) => /Probe: the same/.test(t.textContent));
    const n = same[0]?.querySelector('.ew-toast-n')?.textContent || '';
    o.ui.toast('Probe: one');
    o.ui.toast('Probe: two');
    o.ui.toast('Probe: three');
    await new Promise((r) => setTimeout(r, 400));
    const up = [...document.querySelectorAll('.ew-toast')]
      .filter((t) => !t.classList.contains('out'))
      .map((t) => t.textContent);
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    return { same: same.length, n, up };
  });
  T.ok(
    ts.same === 1 && ts.n === '×2' && ts.up.length <= 2 && /three/.test(ts.up.join(' ')),
    `${label}: the same toast twice is one, counted (${ts.same} on screen, "${ts.n}"), and a phone shows two at most (${ts.up.length}: ${ts.up.join(' | ')})`,
  );
  await E((id) => {
    const o = window.overdub,
      t = o.store.track(id);
    if (t) o.store.dispatch({ type: 'track.remove', track: id }, { by: 'you', label: 'phone test done' });
  }, sa);
}

// From a knob on the Jam room's rig (its amp, on the Rig tab) and from Studio A's ROOM strip, a swipe scrolls and
// changes nothing; held still first, the same drag moves them (one step). Real touch points (CDP), Chromium only.
async function thumbScrolls(page, E, label, shot) {
  await E(() => {
    const o = window.overdub;
    o.engine.stop();
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    try {
      localStorage.removeItem('overdub:touch-hold-hint');
    } catch {
      /* ok */
    }
    o.ui.setOpen('bottom', false);
    o.ui.show('jam');
    o.jam.setView('rig');
  });
  await sleep(900);
  // the scroller a probe sits in (the Rig tab: the amp's knobs, then the pedals'), and where the probe is: the knob's value is its --kv (0..1 of its travel)
  const jam = () =>
    E(() => {
      const kn = document.querySelector('[data-panel="jam"] .kn[data-probe="jam"]'),
        d = kn.querySelector('.kn-dial'),
        r = d.getBoundingClientRect();
      let sc = d.parentElement;
      while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 1))
        sc = sc.parentElement;
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        kv: parseFloat(kn.style.getPropertyValue('--kv')),
        st: Math.round(sc?.scrollTop ?? -1),
        room: sc ? sc.scrollHeight - sc.clientHeight : 0,
        hist: window.overdub.store.history.length,
        toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '),
      };
    });
  const found = await E(() => {
    const d = [...document.querySelectorAll('[data-panel="jam"] .kn .kn-dial')].find((x) => x.getClientRects().length);
    if (!d) return false;
    d.closest('.kn').dataset.probe = 'jam';
    d.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  });
  if (!found) {
    T.ok(false, `${label}: the Jam room's Rig tab shows its amp and pedals, a knob to swipe from`);
    return;
  }
  await sleep(250);
  const j0 = await jam();
  // a swipe that starts on the knob and runs 200 px (up, or down when the room is at its foot)
  const up = j0.st < j0.room - 60;
  await finger(page, line(j0.x, j0.y, j0.x, j0.y + (up ? -200 : 200), 16));
  const j1 = await jam();
  T.ok(
    j1.kv === j0.kv && j1.hist === j0.hist && Math.abs(j1.st - j0.st) >= 60,
    `${label}: a 200 px swipe from a knob on the Jam room's rig (its amp's) scrolls the room (${j0.st} → ${j1.st} px) and turns nothing (${(j0.kv * 100).toFixed(0)}% → ${(j1.kv * 100).toFixed(0)}%, ${j1.hist - j0.hist} steps)`,
  );
  await finger(page, line(j1.x, j1.y, j1.x, j1.y + (j1.kv > 0.5 ? 40 : -40), 8), 450);
  const j2 = await jam();
  T.ok(
    j2.kv !== j1.kv && j2.hist === j1.hist + 1 && /Holding a knob picks it up/.test(j2.toast),
    `${label}: held still first, the same knob turns (${(j1.kv * 100).toFixed(0)}% → ${(j2.kv * 100).toFixed(0)}%, one step), and the first hold says how ("${j2.toast.slice(0, 60)}")`,
  );
  await shot('jam-thumb');
  await E(() => {
    const o = window.overdub;
    o.store.undo();
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    o.jam.setView('neck');
  });
  // Studio A's window: the mic strips are sliders across the window; a swipe from ROOM scrolls the window
  const sa = await E(() => {
    const o = window.overdub;
    o.ui.show('arranger');
    const r = o.store.dispatch(
      {
        type: 'track.add',
        ref: 'sa',
        track: { name: 'Studio A', kind: 'instrument', instrument: { device: 'core.drumroom', params: {} } },
      },
      { by: 'you', label: 'phone test: Studio A' },
    );
    o.plugin.open({ track: r.created.sa, slot: 'instrument' });
    return r.created.sa;
  });
  await page
    .waitForFunction(
      () =>
        document.querySelector('.pw')?.dataset.editor === 'drumroom' &&
        !!document.querySelector('.pw .pk-ctl[data-key="mix_room"] .pk-sl'),
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await sleep(300);
  const room = () =>
    E((id) => {
      const sl = document.querySelector('.pw .pk-ctl[data-key="mix_room"] .pk-sl'),
        body = document.querySelector('.pw .pw-body'),
        r = sl.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        h: r.height,
        st: Math.round(body.scrollTop),
        room: body.scrollHeight - body.clientHeight,
        v: window.overdub.store.track(id)?.instrument?.params?.mix_room ?? null,
        hist: window.overdub.store.history.length,
      };
    }, sa);
  await E(() =>
    document
      .querySelector('.pw .pk-ctl[data-key="mix_room"] .pk-sl')
      ?.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await sleep(200);
  const r0 = await room();
  const down = r0.st > 80; // (a finger moving down scrolls the window up, when it has room above)
  await finger(page, line(r0.x, r0.y - (down ? r0.h * 0.3 : -r0.h * 0.3), r0.x, r0.y + (down ? 150 : -150), 14));
  const r1 = await room();
  T.ok(
    r1.v === r0.v && r1.hist === r0.hist && Math.abs(r1.st - r0.st) >= 50,
    `${label}: a swipe from Studio A's ROOM strip scrolls its window (${r0.st} → ${r1.st} px) and moves nothing (ROOM ${r0.v ?? 'its default'} → ${r1.v ?? 'its default'}, ${r1.hist - r0.hist} steps)`,
  );
  await E(() =>
    document
      .querySelector('.pw .pk-ctl[data-key="mix_room"] .pk-sl')
      ?.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await sleep(200);
  const r1b = await room();
  await finger(page, line(r1b.x, r1b.y, r1b.x, r1b.y - 30, 8), 450);
  const r2 = await room();
  T.ok(
    r2.v != null && r2.v !== r1.v && r2.hist === r1.hist + 1,
    `${label}: held still first, a drag moves ROOM from where it is (${r1.v ?? 'its default'} → ${r2.v} dB, one step)`,
  );
  await shot('studioa-thumb');
  await E((id) => {
    const o = window.overdub;
    o.plugin.close();
    o.store.undo();
    const t = o.store.track(id);
    if (t) o.store.dispatch({ type: 'track.remove', track: id }, { by: 'you', label: 'phone test done' });
    document.querySelectorAll('.ew-toast').forEach((x) => x.remove());
  }, sa);
}

async function fingerEdits(page, E, label, shot) {
  await E(() => {
    const o = window.overdub;
    o.engine.stop();
    try {
      localStorage.removeItem('overdub:beat-hold-hint');
      localStorage.removeItem('overdub:mixer-hold-hint');
    } catch {
      /* ok */
    }
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    o.ui.setOpen('bottom', true);
    o.beat.draw();
  });
  await sleep(500);
  // the sheet at its first height, a little under half the screen (the runs above left it taller)
  const gr = await E(() => {
    const g = document.querySelector('.ew-grip').getBoundingClientRect();
    return { x: innerWidth / 2, y: g.top + g.height / 2, to: Math.round(innerHeight * 0.55) };
  });
  if (Math.abs(gr.y - gr.to) > 20) await finger(page, line(gr.x, gr.y, gr.x, gr.to, 10));
  await sleep(300);
  // Sketch's pinned row (Beatbox or Hum, Record) covers nothing: each pad and the hum dial whole on screen, on top
  // (docs/FRESH-EYES-4.md, the phone's problem 2: the row hid the pads' bottom 20 px and most of the dial)
  for (const m of ['tap', 'hum']) {
    await E((m) => {
      const o = window.overdub;
      o.ui.show('sketch');
      o.input.emit('sketch:mode', m);
    }, m);
    await sleep(450);
    const cov = await E((m) => {
      const els = [
        ...document.querySelectorAll(
          m === 'tap' ? '[data-panel="sketch"] .sk-pad' : '[data-panel="sketch"] .sk-spiral',
        ),
      ].filter((x) => x.getClientRects().length);
      const foot = document.querySelector('[data-panel="sketch"] .sk-foot').getBoundingClientRect();
      const bad = els.filter((x) => {
        const r = x.getBoundingClientRect();
        return [
          [r.left + r.width / 2, r.top + 3],
          [r.left + r.width / 2, r.bottom - 3],
          [r.left + 4, r.bottom - 3],
        ].some(([px, py]) => {
          const hit = document.elementFromPoint(px, py);
          return py > innerHeight || !hit || !x.contains(hit);
        });
      });
      const last = els.at(-1)?.getBoundingClientRect();
      return {
        n: els.length,
        bad: bad.length,
        bottom: last ? Math.round(last.bottom) : null,
        foot: Math.round(foot.top),
        footH: Math.round(foot.height),
      };
    }, m);
    T.ok(
      cov.n && !cov.bad && cov.bottom <= cov.foot + 0.5,
      `${label}: in ${m === 'tap' ? 'Tap it every pad' : 'Hum it the dial'} is whole on screen above the pinned row (${cov.n} ${m === 'tap' ? 'pads' : 'dial'}, ${cov.bad} covered; bottom ${cov.bottom}, the row from ${cov.foot}, ${cov.footH} px tall)`,
    );
    if (m === 'tap') {
      // ... and over the pads, in view too: the ways in, the line that says what to tap (and, while you tap, how many
      // hits), and the grid the beat is drawn on (the line once sat under the pads, under the pinned row)
      const v = await E(() => {
        const sk = document.querySelector('[data-panel="sketch"]'),
          sc = sk.querySelector('.sk-scroll')?.getBoundingClientRect(),
          foot = sk.querySelector('.sk-foot').getBoundingClientRect();
        const top = sc ? sc.top : 0,
          it = (sel) => {
            const e = [...sk.querySelectorAll(sel)].find((x) => x.getClientRects().length);
            if (!e) return null;
            const r = e.getBoundingClientRect();
            return r.top >= top - 0.5 && r.bottom <= foot.top + 0.5
              ? 'in view'
              : `${Math.round(r.top)}..${Math.round(r.bottom)}`;
          };
        const st = [...sk.querySelectorAll('.sk-status')].find((x) => x.getClientRects().length);
        return {
          modes: it('.sk-mode[data-mode="tap"]'),
          status: it('.sk-status'),
          grid: it('.sk-body > .sk-rollwrap'),
          text: st ? st.textContent.trim().slice(0, 50) : '',
          top: Math.round(top),
          foot: Math.round(foot.top),
        };
      });
      T.ok(
        v.modes === 'in view' && v.status === 'in view' && v.grid === 'in view' && !!v.text,
        `${label}: Tap it's ways in, its line ("${v.text}") and its grid are in view between ${v.top} and the pinned row at ${v.foot} (ways in ${v.modes}, line ${v.status}, grid ${v.grid})`,
      );
    }
    await shot('sketch-' + m + '-clear');
  }
  await E(() => {
    window.overdub.input.emit('sketch:mode', 'tap');
    window.overdub.input.setMode?.(null);
    window.overdub.beat.draw();
  });
  await sleep(400);
  const grid = () =>
    E(() => {
      const o = window.overdub,
        sel = o.ui.state.selection,
        f = o.store.findClip(sel.clip),
        wrap = document.querySelector('.dg-cellwrap'),
        r = wrap.getBoundingClientRect(),
        sc = o.drumgrid.scroller();
      const vis = sc.getBoundingClientRect();
      return {
        notes: f ? f.clip.notes.length : -1,
        hist: o.store.history.length,
        rh: o.drumgrid.rowH(),
        st: Math.round(sc.scrollTop),
        room: sc.scrollHeight - sc.clientHeight,
        x: r.left,
        y: r.top,
        w: r.width,
        vt: vis.top,
        vb: Math.min(vis.bottom, innerHeight),
        toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '),
      };
    });
  const g0 = await grid();
  T.ok(
    g0.notes >= 0 && g0.rh >= 32 && g0.room > 0,
    `${label}: the Beat grid's squares are ${g0.rh} px tall under a finger, and its rows scroll (${g0.room} px more)`,
  );
  // a swipe up from the middle of the grid: it scrolls, and adds no hits
  const cx = g0.x + g0.w * 0.55,
    cy = Math.round((g0.vt + g0.vb) / 2);
  await finger(page, line(cx, cy + 50, cx, cy - 60));
  const g1 = await grid();
  T.ok(
    g1.notes === g0.notes && g1.hist === g0.hist && g1.st > g0.st,
    `${label}: a swipe up on the Beat grid scrolls it (${g0.st} → ${g1.st} px) and paints nothing (${g0.notes} → ${g1.notes} hits)`,
  );
  // a tap: one hit (on the square under the finger), one undo step
  const at = await E(
    ([x, y]) => {
      const r = document.querySelector('.dg-cellwrap').getBoundingClientRect();
      return { x, y: Math.max(y, r.top + 30) };
    },
    [Math.round(g0.x + 6), cy],
  );
  await finger(page, [[at.x, at.y]]);
  const g2 = await grid();
  T.ok(
    Math.abs(g2.notes - g1.notes) === 1 && g2.hist === g1.hist + 1,
    `${label}: a tap on a square toggles one hit (${g1.notes} → ${g2.notes})`,
  );
  await E(() => window.overdub.store.undo());
  // a hold, then a drag along the row: it paints, in one step, and the first hold says what holding does
  const cw = g0.w / 16;
  const y = at.y;
  await finger(page, line(at.x, y, at.x + cw * 5, y, 10), 520);
  const g3 = await grid();
  const painted = Math.abs(g3.notes - g1.notes);
  T.ok(
    painted >= 3 && g3.hist === g1.hist + 1 && /Holding a square/.test(g3.toast),
    `${label}: a hold, then a drag along the row paints ${painted} hits in one step, and says so the first time ("${g3.toast.slice(0, 70)}")`,
  );
  await shot('beat-painted');
  await E(() => {
    window.overdub.store.undo();
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
  });

  // the mixer
  await E(() => window.overdub.ui.show('mixer'));
  await sleep(450);
  const mix = () =>
    E(() => {
      const o = window.overdub,
        t = o.store.get().tracks.find((x) => {
          const s = document.querySelector(`.mx-strip[data-track="${x.id}"]`);
          if (!s) return false;
          const r = s.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth;
        });
      const s = document.querySelector(`.mx-strip[data-track="${t.id}"]`),
        tr = s.querySelector('.mx-track').getBoundingClientRect(),
        pk = s.querySelector('.mx-pan .mk').getBoundingClientRect(),
        mx = document.querySelector('.mx');
      return {
        id: t.id,
        gain: t.gain ?? 0,
        pan: t.pan ?? 0,
        hist: o.store.history.length,
        sl: Math.round(mx.scrollLeft),
        room: mx.scrollWidth - mx.clientWidth,
        tx: tr.left + tr.width / 2,
        ty: tr.top + tr.height / 2,
        th: tr.height,
        px: pk.left + pk.width / 2,
        py: pk.top + pk.height / 2,
        toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '),
      };
    });
  const m0 = await mix();
  await finger(page, line(m0.tx, m0.ty + m0.th * 0.3, m0.tx, m0.ty - m0.th * 0.3));
  await finger(page, line(m0.px, m0.py + 30, m0.px, m0.py - 30));
  const m1 = await E((id) => {
    const t = window.overdub.store.track(id);
    return { gain: t.gain ?? 0, pan: t.pan ?? 0, hist: window.overdub.store.history.length };
  }, m0.id);
  T.ok(
    m1.gain === m0.gain && m1.pan === m0.pan && m1.hist === m0.hist,
    `${label}: a swipe up on a fader or a pan knob moves neither (level ${m0.gain} → ${m1.gain} dB, pan ${m0.pan} → ${m1.pan})`,
  );
  // ... and says how to pick the fader up (it moved nothing and said nothing; the strips only scroll sideways)
  const told = await E(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '));
  T.ok(
    /Hold the fader still for a moment to pick it up, then drag/.test(told),
    `${label}: that swipe says how to pick a fader up ("${told.slice(0, 80)}")`,
  );
  await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  if (m0.room > 20) {
    await finger(page, line(m0.tx, m0.ty, m0.tx - 120, m0.ty));
    const m2 = await mix();
    T.ok(
      m2.sl > m0.sl && m2.hist === m0.hist,
      `${label}: a sideways swipe on a fader scrolls the strips (${m0.sl} → ${m2.sl} px) and moves nothing`,
    );
    await E(() => {
      document.querySelector('.mx').scrollLeft = 0;
    });
  }
  const m3a = await mix();
  await finger(page, line(m3a.tx, m3a.ty, m3a.tx, m3a.ty - 40, 8), 450);
  const m3 = await E(
    (id) => ({
      gain: window.overdub.store.track(id).gain ?? 0,
      hist: window.overdub.store.history.length,
      toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '),
    }),
    m3a.id,
  );
  T.ok(
    m3.gain > m3a.gain && m3.hist === m3a.hist + 1 && /Holding a fader/.test(m3.toast),
    `${label}: a hold, then a drag up moves the fader (${m3a.gain} → ${m3.gain} dB, one step) and the first hold says so ("${m3.toast.slice(0, 60)}")`,
  );
  await shot('mixer-held');
  await E(() => {
    window.overdub.store.undo();
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
  });
}

// A finger drag: real touch points in Chromium (CDP), touch-type pointer events elsewhere; hold: ms still first.
async function dragTouch(page, engine, x0, y0, x1, y1, steps = 12, hold = 30) {
  if (engine === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, pts) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map(([x, y]) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 })),
      });
    await send('touchStart', [[x0, y0]]);
    await sleep(hold);
    for (let i = 1; i <= steps; i++) {
      await send('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]);
      await sleep(16);
    }
    await send('touchEnd', []);
    await sleep(250);
    await cdp.detach().catch(() => {});
    return;
  }
  await page.evaluate(
    ([x0, y0, x1, y1, steps, hold]) =>
      new Promise((done) => {
        const el = document.elementFromPoint(x0, y0);
        // a synthetic pointer isn't one the browser tracks: let capturing it pass
        const cap = Element.prototype.setPointerCapture,
          rel = Element.prototype.releasePointerCapture;
        Element.prototype.setPointerCapture = function (id) {
          if (id !== 7) return cap.call(this, id);
        };
        Element.prototype.releasePointerCapture = function (id) {
          if (id !== 7) return rel.call(this, id);
        };
        const ev = (type, x, y) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 7,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY: y,
              button: type === 'pointermove' ? -1 : 0,
              buttons: type === 'pointerup' ? 0 : 1,
            }),
          );
        ev('pointerdown', x0, y0);
        let i = 0;
        const step = () => {
          i++;
          ev('pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
          if (i < steps) return setTimeout(step, 16);
          ev('pointerup', x1, y1);
          Element.prototype.setPointerCapture = cap;
          Element.prototype.releasePointerCapture = rel;
          setTimeout(done, 250);
        };
        setTimeout(step, Math.max(16, hold));
      }),
    [x0, y0, x1, y1, steps, hold],
  );
}

// ------------------------------------------------------------------------------------------------ run
await ready;
const srv = await startServer({ port: 0, quiet: true });
const pw = findPlaywright();
try {
  for (const run of RUNS) {
    const t0 = Date.now();
    console.log(
      `\n${run.engine} ${run.device || run.w + 'x' + run.h}${run.turn ? ' on its side' : ''}${run.simple ? ', the simple view' : ''}`,
    );
    await (run.turn ? sideways : run.simple ? simplePhone : phone)(pw, srv.url, run);
    T.note(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await srv.close();
}
T.done();
