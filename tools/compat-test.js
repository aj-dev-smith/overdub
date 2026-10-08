// Overdub outside Chrome [compat]: the studio and the landing page in WebKit (Safari) and Firefox, and the core loop on
// a phone (Chromium at 390x844 with touch). Per browser: it boots without errors, every device instantiates and
// renders, the demo renders offline and plays live, kernels compile, the guitar track and the faces work, the agent
// panel and Sketch work (Web MIDI and fake mics differ: they degrade, never throw), a take records from the fake input,
// the CSS the studio leans on is there, the FFT and the convolver compute Node's doubles, and the landing page's film plays (Range requests). The studio, the library,
// the gallery and the community shelf's gallery (a clip from a blob: URL) run under their content security policies with no violation; every AudioWorklet module is a file on the
// studio's origin; and markup can't run script there: an injected inline script and an <iframe srcdoc> with a data:
// script don't run, and a worklet module from a data: or blob: URL is refused. And the simple view (?view=simple, clean
// storage) boots in each with no errors, on a blank song, and its Find opens and closes.
//
//   node tools/compat-test.js                        all four: chromium, webkit, firefox, chromium-phone
//   node tools/compat-test.js webkit firefox         some of them (also BROWSERS=webkit,firefox)
//   node tools/compat-test.js webkit-phone           an extra: the phone loop in WebKit (iPhone's engine)
//
// WebKit and Firefox come from Playwright's cache (~/Library/Caches/ms-playwright/webkit-*, firefox-*). Missing one?
//   node <playwright-core>/cli.js install webkit firefox      (the playwright-core tools/pw.js resolves)
// A browser that isn't installed is reported and skipped, not failed, unless REQUIRE_ALL=1.
// Screenshots: tools/.out/compat-<browser>-*.png
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { startServer, ready, byteRange, addRoute } from '../server/serve.js';
import { OUTDIR, tally, QUIET, TEXT } from './pw.js';
import { FIXED_TWIDDLES_SHA, FIXED_CONVOLUTION_SHA } from './fixtures/convolve-fixed.js';

const require = createRequire(import.meta.url);
const T = tally('compat');
const ALL = ['chromium', 'webkit', 'firefox', 'chromium-phone'];
const want = (process.argv.slice(2).length ? process.argv.slice(2) : (process.env.BROWSERS || ALL.join(',')).split(','))
  .map((s) => s.trim())
  .filter(Boolean);
const HEADED = !!process.env.HEADED;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) =>
  /Failed to load resource|favicon|net::ERR|fonts\.g|NS_BINDING_ABORTED|the server responded with a status of 404/.test(
    e,
  );

// ------------------------------------------------------------------------------------------------ the browsers
// Same resolution as tools/pw.js (PLAYWRIGHT_CORE, then a local install, then the copy already on this machine).
function findPlaywright() {
  const tries = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core',
    path.join(os.homedir(), 'Code/xenobotany/node_modules/playwright-core'),
  ].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch (e) {
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

// Launch one engine with the flags each needs for audio without a gesture and a fake microphone:
//   chromium: --autoplay-policy=no-user-gesture-required, --use-fake-ui-for-media-stream, --use-fake-device-for-media-stream
//   webkit:   Playwright's WebKit has mock capture devices; granting 'microphone' answers getUserMedia with
//             "Mock audio device 1". Autoplay has no switch: an AudioContext made without a gesture is "interrupted"
//             (Safari's own state) until the first click, so the checks click once, like a person would.
//   firefox:  prefs: media.navigator.streams.fake (a fake mic), media.navigator.permission.disabled (no prompt),
//             media.autoplay.default=0 + media.autoplay.block-webaudio=false (sound without a gesture).
//             On Linux it plays through PulseAudio, and with no sound server its AudioContext never starts (the demo
//             silent, the take empty). FIREFOX_PULSE_SERVER names one for Firefox alone (CI starts one with a null
//             sink): Chromium's checks are timed against its own fake output and fail through PulseAudio.
async function launch(kind) {
  const pw = findPlaywright();
  const phone = kind.endsWith('-phone');
  const engine = kind.replace(/-phone$/, '');
  const ctxOpts = phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: engine !== 'firefox' }
    : { viewport: { width: 1440, height: 900 } };
  let browser;
  if (engine === 'chromium') {
    const args = [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      ...QUIET,
      ...TEXT,
    ];
    browser = await pw.chromium.launch({
      headless: !HEADED,
      executablePath: HEADED ? undefined : findChromium(),
      args,
    });
    ctxOpts.permissions = ['microphone'];
  } else if (engine === 'webkit') {
    browser = await pw.webkit.launch({ headless: !HEADED });
    ctxOpts.permissions = ['microphone'];
  } else if (engine === 'firefox') {
    browser = await pw.firefox.launch({
      headless: !HEADED,
      ...(process.env.FIREFOX_PULSE_SERVER && {
        env: { ...process.env, PULSE_SERVER: process.env.FIREFOX_PULSE_SERVER },
      }),
      firefoxUserPrefs: {
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
        'media.autoplay.default': 0,
        'media.autoplay.blocking_policy': 0,
        'media.autoplay.block-webaudio': false,
        'dom.webmidi.enabled': true,
        'midi.testing': false,
      },
    });
  } else throw new Error('unknown browser ' + kind);
  const context = await browser.newContext(ctxOpts);
  return { browser, context, phone, engine, ctxOpts };
}

async function openPage(b, base, route) {
  const page = await b.context.newPage();
  const errors = [],
    warns = [];
  // every request the page makes to a host other than the site's: none (fonts included: they're the site's own)
  const offsite = [];
  page.on('request', (r) => {
    try {
      const u = new URL(r.url());
      if (/^https?:$/.test(u.protocol) && u.host !== new URL(base).host) offsite.push(u.host + u.pathname.slice(0, 40));
    } catch (e) {
      /* data:, blob: */
    }
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && (e.stack || e.message)) || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push('console: ' + t);
    else if (m.type() === 'warning' && /^overdub:/.test(t)) warns.push(t);
  });
  page.setDefaultTimeout(60000);
  // every content security policy violation, from the first byte (the pages' policies: app/index.html says why), and
  // every worklet module the page loads (Chromium raises no violation for a refused one: addModule just rejects)
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push(
        `${e.effectiveDirective} ${String(e.blockedURI).slice(0, 80)} (${String(e.sourceFile || '').replace(/^.*\/app\//, 'app/')}:${e.lineNumber})`,
      ),
    );
    window.__worklets = [];
    if (window.AudioWorklet) {
      const add = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = function (url, o) {
        window.__worklets.push(String(url));
        return add.call(this, url, o);
      };
    }
  });
  await page.goto(base + route, { waitUntil: 'load' });
  return { page, errors, warns, offsite };
}
const hostsOf = (offsite) => [...new Set(offsite.map((x) => x.split('/')[0]))].join(', ');
const real = (errs) => errs.filter((e) => !ignorable(e));
const list = (a, n = 3) => (a.length ? ': ' + a.slice(0, n).join(' | ').slice(0, 600) : '');

// The page's policy, after the session the checks above ran: the violations it raised (none, or a browser refused
// something the studio does), then whether it is in force at all: a script added inline, as an injection would add
// one, must not run. Then what markup alone could run if it got into the page (no script of its own): an
// <iframe srcdoc> whose script is a data: URL runs on this origin, the API key's, wherever script-src allows data:
// (srcdoc), and worklet modules made from strings (wdata, wblob). (Last thing on a page: each refusal is a console
// error of its own.)
async function policy(page) {
  return page.evaluate(async () => {
    const seen = window.__csp.slice();
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true';
    document.head.append(s);
    await new Promise((r) => setTimeout(r, 100));
    const refused = window.__csp.length > seen.length;
    window.__srcdocRan = false;
    const box = document.createElement('div');
    box.innerHTML = `<iframe srcdoc="<script src='data:text/javascript,top.__srcdocRan = true'></script>"></iframe>`;
    const frame = box.firstElementChild;
    const loaded = new Promise((r) => {
      frame.addEventListener('load', () => r(true), { once: true });
      setTimeout(() => r(false), 5000);
    });
    document.body.append(box);
    const srcdocLoaded = await loaded;
    await new Promise((r) => setTimeout(r, 200));
    box.remove();
    const c = new OfflineAudioContext(1, 128, 44100);
    const add = (u) =>
      c.audioWorklet.addModule(u).then(
        () => true,
        () => false,
      );
    const proc = (n) =>
      `registerProcessor('${n}', class extends AudioWorkletProcessor { process() { return false; } })`;
    const wdata = await add('data:text/javascript;charset=utf-8,' + encodeURIComponent(proc('policy-a')));
    const wblob = await add(URL.createObjectURL(new Blob([proc('policy-b')], { type: 'text/javascript' })));
    return {
      seen,
      first: !!meta && document.head.firstElementChild === meta,
      ran: !!window.__inlineRan,
      refused,
      srcdoc: !!window.__srcdocRan,
      srcdocLoaded,
      wdata,
      wblob,
    };
  });
}
// what the srcdoc and string-worklet probes found, for a check's message
const probes = (pol) =>
  `an <iframe srcdoc> with a data: script ${pol.srcdoc ? 'RAN' : pol.srcdocLoaded ? 'loaded and did not run' : 'did not run (it never loaded)'}; a worklet module from a data: URL ${pol.wdata ? 'loaded' : 'refused'}, from a blob: URL ${pol.wblob ? 'loaded' : 'refused'}`;

// ------------------------------------------------------------------------------------------------ the studio, desktop
async function studio(b, base, tag) {
  const { page, errors, warns, offsite } = await openPage(b, base, '/app/?demo&autostart&agent=mock&fast');
  const shot = (n) => page.screenshot({ path: path.join(OUTDIR, `compat-${tag}-${n}.png`) });
  const E = (fn, arg) => page.evaluate(fn, arg);
  let booted = true;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  } catch (e) {
    booted = false;
  }
  T.ok(booted, `${tag}: the studio boots (/app/?demo&autostart)`);
  if (!booted) {
    T.ok(false, `${tag}: boot errors${list(real(errors))}`);
    await page.close();
    return;
  }
  await page.waitForTimeout(600);
  T.ok(!warns.length, `${tag}: every studio module loaded and started${list(warns)}`);

  // the first gesture (WebKit leaves a context made without one "interrupted"): close the welcome card
  if (await page.isVisible('.ar-welcome')) await page.click('.ar-welcome button', { timeout: 5000 }).catch(() => {});
  else await page.mouse.click(700, 880);
  await page
    .waitForFunction(() => window.overdub.engine.ctx && window.overdub.engine.ctx.state === 'running', null, {
      timeout: 15000,
    })
    .catch(() => {});
  const st = await E(() => ({
    state: window.overdub.engine.ctx?.state,
    sr: window.overdub.engine.ctx?.sampleRate,
    worklet: !!window.overdub.engine.ctx?.audioWorklet,
  }));
  T.ok(
    st.state === 'running' && st.worklet,
    `${tag}: audio runs after the first gesture (${st.state}, ${st.sr} Hz, AudioWorklet ${st.worklet ? 'yes' : 'no'})`,
  );

  const css = await E(() => ({
    has: CSS.supports('selector(:has(a))'),
    container: CSS.supports('container-type: inline-size'),
    mix: CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'),
    nesting: (() => {
      try {
        const s = new CSSStyleSheet();
        s.replaceSync('.a { .b { color: red } }');
        return s.cssRules[0].cssRules?.length === 1;
      } catch (e) {
        return false;
      }
    })(),
    sketchQuery: (() => {
      const el = document.querySelector('[data-panel="sketch"]');
      return el ? getComputedStyle(el).containerType : 'none';
    })(),
  }));
  T.ok(
    css.has && css.container && css.mix,
    `${tag}: the CSS the studio uses is supported (:has() ${css.has}, container queries ${css.container}, color-mix() ${css.mix}, nesting ${css.nesting})`,
  );
  const clipCols = await E(async () => {
    const k = await import('/app/src/ui/arrange-kit.js');
    return window.overdub.store.get().tracks.map((t) => k.resolveColor(t.color));
  });
  T.ok(
    new Set(clipCols).size >= 4 && !clipCols.includes('#b190f2'),
    `${tag}: track colours come from the tokens, not the fallback (${[...new Set(clipCols)].join(' ')})`,
  );
  await shot('studio');

  // dsp.fft and dsp.convolver: the same doubles in this engine as in Node (the pinned hashes, tools/convolver-test.js)
  const conv = await E(async () => {
    const c = await import('/app/src/kernel/convolve.js'),
      f = await import('/tools/fixtures/convolve-fixed.js');
    const hex = async (a) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', a.buffer))]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
    return { tw: await hex(f.fixedTwiddles(c.fft)), cv: await hex(f.fixedConvolution(c.convolver)) };
  });
  T.ok(
    conv.tw === FIXED_TWIDDLES_SHA && conv.cv === FIXED_CONVOLUTION_SHA,
    `${tag}: the FFT's twiddles and a fixed convolution hash as they do in Node (${conv.tw.slice(0, 12)}, ${conv.cv.slice(0, 12)})`,
  );

  // every device instantiates on an OfflineAudioContext (its worklet modules load there too) and renders finite audio
  const devs = await E(async () => {
    const R = await import('/app/src/devices/registry.js');
    const all = R.listDevices();
    const bad = [],
      silent = [],
      kinds = { instrument: 0, effect: 0 };
    const SR = 44100,
      N = Math.round(SR * 0.6);
    let i = 0;
    async function one(d) {
      const c = new OfflineAudioContext(2, N, SR);
      const inst = await R.instantiate(c, d.id, { uid: 'compat-' + i++, params: {} });
      await inst.ready;
      if (d.kind === 'instrument') {
        inst.noteOn(57, 0.8, 0.02);
        inst.noteOn(64, 0.8, 0.02);
        inst.noteOff?.(57, 0.4);
        inst.noteOff?.(64, 0.4);
        inst.output.connect(c.destination);
      } else {
        const o = c.createOscillator(),
          g = c.createGain();
        o.type = 'sawtooth';
        o.frequency.value = 110;
        g.gain.value = 0.25;
        o.connect(g);
        g.connect(inst.input);
        inst.output.connect(c.destination);
        o.start(0);
        o.stop(0.35);
      }
      const r = await c.startRendering();
      let pk = 0,
        nan = 0;
      for (let ch = 0; ch < 2; ch++) {
        const x = r.getChannelData(ch);
        for (let k = 0; k < x.length; k++) {
          const v = x[k];
          if (!Number.isFinite(v)) nan++;
          else if (Math.abs(v) > pk) pk = Math.abs(v);
        }
      }
      try {
        inst.dispose();
      } catch (e) {
        /* fine */
      }
      return { nan, pk };
    }
    const queue = all.slice();
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const d = queue.shift();
          try {
            const r = await Promise.race([
              one(d),
              new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 20000)),
            ]);
            kinds[d.kind]++;
            if (r.nan) bad.push(d.id + ' NaN×' + r.nan);
            else if (r.pk < 1e-5) silent.push(d.id);
          } catch (e) {
            bad.push(d.id + ' ' + ((e && e.message) || e));
          }
        }
      }),
    );
    return {
      n: all.length,
      kinds,
      bad,
      silent,
      pedals: all.filter((d) => d.id.startsWith('pedal.')).length,
      amps: all.filter((d) => d.id.startsWith('amp.')).length,
      kernels: all.filter((d) => !d.build).length,
    };
  });
  T.ok(
    devs.n > 150 && !devs.bad.length,
    `${tag}: all ${devs.n} devices instantiate and render finite audio (${devs.kinds.instrument} instruments, ${devs.kinds.effect} effects; ${devs.pedals} pedals, ${devs.amps} amps, ${devs.kernels} kernels)${list(devs.bad, 6)}`,
  );
  if (devs.silent.length)
    T.note(
      `${tag}: silent on a 110 Hz saw (by design for gates and the like?): ${devs.silent.slice(0, 12).join(' ')}${devs.silent.length > 12 ? ' …' : ''}`,
    );

  // the demo renders offline (engine.render) through the same graph, guitar track and all
  const rend = await E(async () => {
    const M = await import('/app/src/audio/measure.js');
    const app = window.overdub,
      t0 = performance.now();
    const buf = await app.engine.render({ from: 0, to: 16, tail: 1 });
    const m = M.measure(buf);
    // the guitar track (live input through gate, chorus, an amp and an agent-built reverb): the DI strum through its rig
    const g = app.store.get().tracks.find((t) => t.name === 'Guitar');
    let gm = null;
    if (g) {
      const R = await import('/app/src/devices/registry.js'),
        TS = await import('/app/src/audio/testsignals.js');
      const SR = 48000,
        x = TS.diStrum(4, SR),
        c = new OfflineAudioContext(2, x.length, SR),
        src = c.createBufferSource(),
        b = c.createBuffer(1, x.length, SR);
      b.copyToChannel(x, 0);
      src.buffer = b;
      let at = src;
      for (const s of g.inserts) {
        const inst = await R.instantiate(c, s.device, {
          uid: 'gt-' + s.id,
          params: s.params || {},
          on: s.on !== false,
        });
        await inst.ready;
        at.connect(inst.input);
        at = inst.output;
      }
      at.connect(c.destination);
      src.start(0);
      gm = M.measure(await c.startRendering());
    }
    return {
      lufs: m.lufs,
      tp: m.truePeak,
      secs: buf.duration,
      ms: performance.now() - t0,
      guitar: gm && gm.lufs,
      gdev: g ? g.inserts.map((x) => x.device).join(' → ') : null,
    };
  });
  T.ok(
    Number.isFinite(rend.lufs) && rend.lufs > -30 && rend.lufs < -6 && rend.tp < 1,
    `${tag}: the demo renders offline: 16 beats, ${rend.lufs.toFixed(1)} LUFS, ${rend.tp.toFixed(1)} dBTP (${Math.round(rend.ms)} ms)`,
  );
  T.ok(
    rend.gdev == null || (Number.isFinite(rend.guitar) && rend.guitar > -60),
    `${tag}: the guitar track's rig plays the DI strum (${rend.gdev}): ${rend.guitar?.toFixed?.(1)} LUFS`,
  );

  // and plays live: the transport moves and the master meter moves
  await E(() => window.overdub.engine.play(0));
  await page.waitForTimeout(2200);
  const live = await E(() => ({
    playing: window.overdub.engine.playing,
    beat: window.overdub.engine.beat,
    peak: window.overdub.engine.meters.master.peak,
  }));
  await E(() => window.overdub.engine.stop());
  T.ok(
    live.playing && live.beat > 1 && live.peak > -50,
    `${tag}: the demo plays live (beat ${live.beat.toFixed(2)} after 2.2 s, master peak ${live.peak.toFixed(1)} dBFS)`,
  );
  const insts = await E(() => {
    const app = window.overdub,
      out = [];
    for (const t of app.store.get().tracks) {
      if (t.instrument && !app.engine.instance(t.id, 'instrument')) out.push(t.name + ':instrument');
      for (const x of t.inserts) if (!app.engine.instance(t.id, x.id)) out.push(t.name + ':' + x.device);
    }
    return out;
  });
  T.ok(!insts.length, `${tag}: every instrument and insert in the song has a live instance${list(insts)}`);

  // kernels compile: the device check on a built-in and on a fresh kernel through define_device
  const kern = await E(async () => {
    const { checkDevice } = await import('/app/src/kernel/check.js');
    const R = await import('/app/src/devices/registry.js');
    const r1 = await checkDevice(R.getDevice('core.verb'), { quick: true });
    const src = {
      id: 'claude.compat-tilt',
      name: 'Compat Tilt',
      kind: 'effect',
      cat: 'eq',
      blurb: 'a one-pole tilt, for the compat check',
      params: [{ key: 'tilt', label: 'TILT', min: -1, max: 1, def: 0.3 }],
      kernel:
        '({ create({ sr, dsp }) { let zl = 0, zr = 0; return { process(L, R, n, p) { const a = 0.2; for (let i = 0; i < n; i++) { zl += a * (L[i] - zl); zr += a * (R[i] - zr); L[i] = L[i] + p.tilt * (L[i] - zl); R[i] = R[i] + p.tilt * (R[i] - zr); } } }; } })',
    };
    const r2 = await window.overdub.tools.run('define_device', { device: src }, { by: 'claude' });
    return {
      ok1: r1.ok,
      e1: (r1.errors || []).join('; '),
      ok2: !r2.error && r2.ok !== false,
      e2: r2.error || (r2.report?.errors || r2.errors || []).join?.('; ') || '',
    };
  });
  T.ok(kern.ok1, `${tag}: core.verb passes the device check${kern.e1 ? ': ' + kern.e1 : ''}`);
  T.ok(kern.ok2, `${tag}: a new kernel compiles through define_device${kern.e2 ? ': ' + kern.e2 : ''}`);

  // the faces: the guitar track's rig in the Devices tab
  await E(() => {
    const app = window.overdub,
      g = app.store.get().tracks.find((t) => t.inserts.length > 1) || app.store.get().tracks[0];
    app.ui.select({ track: g.id });
    app.ui.show('rack');
  });
  await page.waitForTimeout(700);
  const faces = await E(() => {
    const el = document.querySelector('[data-panel="rack"]');
    const cards = [...el.querySelectorAll('.rk-card')];
    const drawn = cards.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 40 && r.height > 40;
    });
    const svgs = el.querySelectorAll('svg, canvas').length;
    return { cards: cards.length, drawn: drawn.length, svgs };
  });
  T.ok(
    faces.cards >= 2 && faces.drawn === faces.cards && faces.svgs > 0,
    `${tag}: device faces render in the Devices tab (${faces.drawn}/${faces.cards} cards)`,
  );
  await shot('devices');

  // the agent panel: the demo agent, end to end
  await E(() => {
    window.overdub.ui.setOpen('right', true);
    window.overdub.ui.show('agent');
    const p = window.overdub.store.get();
    const b = p.tracks.find((x) => x.name === 'Bass');
    window.overdub.ui.select({ track: b.id, clip: b.clips[0].id, notes: [] });
  });
  await page.waitForTimeout(300);
  let agentOk = false;
  try {
    await page.click('.ag-input');
    await page.keyboard.type('Make this groove more');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ag-vars .ag-take', { timeout: 20000 });
    await page.click('.ag-take[data-index="0"] .ag-keep');
    await page.waitForFunction(() => !window.overdub.agent.busy, null, { timeout: 30000 });
    agentOk = await E(() => window.overdub.store.history.some((x) => x.by === 'claude'));
  } catch (e) {
    T.note(`${tag}: agent: ${e.message.split('\n')[0]}`);
  }
  T.ok(
    agentOk,
    `${tag}: the agent panel works (the demo agent offers takes; keeping one lands in the song as Claude's)`,
  );
  await shot('agent');

  // Sketch: hum with the fake mic, then the MIDI mode (absent in Safari: says so, never throws)
  await E(() => window.overdub.ui.show('sketch'));
  await page.waitForTimeout(300);
  const hum = await E(async () => {
    const inp = window.overdub.input,
      out = { hum: null, err: null };
    try {
      if (inp?.hum?.start) {
        await Promise.race([inp.hum.start(), new Promise((r) => setTimeout(r, 4000))]);
        await new Promise((r) => setTimeout(r, 700));
        out.hum = 'started';
        await inp.hum.stop?.();
        out.hum = 'stopped';
      } else out.hum = 'no hum api';
    } catch (e) {
      out.err = (e && e.message) || String(e);
    }
    out.midi = {
      supported: !!navigator.requestMIDIAccess,
      state: inp?.midi?.state ? JSON.stringify(inp.midi.state).slice(0, 120) : String(inp?.midi?.supported),
    };
    return out;
  });
  T.ok(
    !hum.err || /mic|microphone|allow|input|permission/i.test(hum.err),
    `${tag}: Sketch: humming with the fake mic ${hum.hum}${hum.err ? ' (says: ' + hum.err + ')' : ''}`,
  );
  const modes = await E(() => [...document.querySelectorAll('.sk-mode')].map((b) => b.textContent.trim()));
  let midiText = '';
  for (const m of modes) {
    await page.click(`.sk-mode:has-text("${m}")`).catch(() => {});
    await page.waitForTimeout(250);
    if (/Play/.test(m)) midiText = await E(() => document.querySelector('[data-panel="sketch"]')?.innerText || '');
  }
  T.ok(
    modes.length >= 3 && (hum.midi.supported || /computer keys|musical typing/i.test(midiText)),
    `${tag}: Sketch's modes all open (${modes.join(', ')}); Web MIDI ${hum.midi.supported ? 'present' : 'absent'}${!hum.midi.supported ? ' and the Play mode ' + (/computer keys|musical typing/i.test(midiText) ? 'offers the computer keys' : 'says nothing about it') : ''}`,
  );
  await shot('sketch');

  // a take from the fake input, through the input recorder (its worklet, src/input/cap-worklet.js, captures it)
  const take = await E(async () => {
    const app = window.overdub,
      out = {};
    try {
      app.engine.stop();
      await Promise.race([app.input.audio.open(), new Promise((r) => setTimeout(r, 5000))]);
      const t = app.store.get().tracks.find((x) => x.kind === 'audio');
      out.track = t ? t.name : 'a new audio track';
      await app.input.audio.record({ track: t ? t.id : null, countIn: 0 });
      await new Promise((r) => setTimeout(r, 2500));
      const res = await app.input.audio.stopRecord();
      app.engine.stop();
      if (res) {
        const buf = await app.engine.assets.get(res.asset);
        let pk = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
        }
        out.secs = buf.duration;
        out.peak = pk > 0 ? 20 * Math.log10(pk) : -Infinity;
      }
      out.ok = !!res;
      out.said = app.input.audio.state.error || '';
    } catch (e) {
      out.err = (e && e.message) || String(e);
    }
    return out;
  });
  T.ok(
    take.ok && take.secs > 1.5 && take.peak > -60,
    `${tag}: records from the fake input: a ${take.secs ? take.secs.toFixed(1) + ' s' : 'no'} take on ${take.track} (peak ${Number.isFinite(take.peak) ? take.peak.toFixed(1) + ' dBFS' : 'silent'})${take.err || take.said ? ' (says: ' + (take.err || take.said) + ')' : ''}`,
  );

  // every worklet module the session loaded (the kernels' processor, the pedals' and amps' processors behind the kit's
  // END, the input recorder's) is a file on the studio's own origin, none made from a string
  const mods = await E(() => {
    const all = [...new Set(window.__worklets)];
    const here = (u) => {
      try {
        const x = new URL(u, location.href);
        return x.origin === location.origin && x.pathname.startsWith('/app/');
      } catch (e) {
        return false;
      }
    };
    const path = (u) => new URL(u, location.href).pathname.replace(/^\/app\//, '');
    return {
      n: all.length,
      off: all.filter((u) => !here(u)).map((u) => u.slice(0, 60)),
      paths: all.filter(here).map(path),
    };
  });
  const has = (p) => mods.paths.includes(p);
  const pedalMods = mods.paths.filter((p) => p.startsWith('vendor/clawd/worklets/')).length;
  const own = ['src/kernel/processor.js', 'src/devices/worklets/end.js', 'src/input/cap-worklet.js'];
  T.ok(
    !mods.off.length && own.every(has) && pedalMods >= 40,
    `${tag}: every worklet module loaded is a file on the studio's origin: ${mods.n - mods.off.length} of ${mods.n} (${own.filter(has).join(', ') || "none of the studio's own"}${own.some((p) => !has(p)) ? '; not ' + own.filter((p) => !has(p)).join(', ') : ''}; ${pedalMods} from vendor/clawd/worklets/)${list(mods.off, 4)}`,
  );

  const errs = real(errors);
  T.ok(!errs.length, `${tag}: no console or page errors in the studio${list(errs, 5)}`);
  const pol = await policy(page);
  T.ok(
    !pol.seen.length,
    `${tag}: booting, playing live, every device, a render, a new kernel, the faces, the agent, Sketch and a take raise no content security policy violation${list(pol.seen, 5)}`,
  );
  T.ok(
    pol.first && !pol.ran && pol.refused,
    `${tag}: the studio's policy is in force, first in its head: a script injected inline is refused (${pol.ran ? 'it ran' : pol.refused ? 'refused' : 'not run, no violation'})`,
  );
  T.ok(
    pol.srcdocLoaded && !pol.srcdoc && !pol.wdata && !pol.wblob,
    `${tag}: markup in the studio can't run script through its policy: ${probes(pol)}`,
  );
  T.ok(
    !offsite.length,
    `${tag}: the whole session asked no host but the site for anything, its fonts included${offsite.length ? ' (asked ' + hostsOf(offsite) + ')' : ''}`,
  );
  await page.close();
}

// ------------------------------------------------------------------------------------------------ library and gallery
// The other two pages on the studio's origin (its localStorage, the API key in it) carry the policy too, their one
// inline script allowed by its hash: each runs, a kernel device plays in the library, and nothing is refused.
async function pages(b, base, tag) {
  {
    const { page, offsite } = await openPage(b, base, '/app/library.html');
    const ok = await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 }).then(
      () => true,
      () => false,
    );
    if (ok) await page.click('.lb-hero h1').catch(() => {}); // a first gesture, for WebKit's audio
    const demo = ok
      ? await page.evaluate(async () => {
          const L = window.__library;
          await L.play('claude.night-bus');
          const c = L.cards.find((x) => x.dataset.id === 'claude.night-bus');
          L.stop();
          return { lufs: Number(c.dataset.lufs), hint: c.querySelector('.lb-hint').textContent };
        })
      : null;
    const pol = await policy(page);
    T.ok(
      ok && Number.isFinite(demo?.lufs) && demo.lufs > -40 && !pol.seen.length && pol.first && !pol.ran && pol.refused,
      `${tag}: library.html runs under its policy (its script by hash), renders a kernel device's demo (${demo ? demo.lufs + ' LUFS' : 'never ready'}) and refuses an injected inline script; no violation${list(pol.seen, 5)}`,
    );
    T.ok(
      pol.srcdocLoaded && !pol.srcdoc && !pol.wdata && !pol.wblob,
      `${tag}: markup in library.html can't run script through its policy: ${probes(pol)}`,
    );
    T.ok(
      !offsite.length,
      `${tag}: library.html asked no host but the site for anything, the faces' fonts included${offsite.length ? ' (asked ' + hostsOf(offsite) + ')' : ''}`,
    );
    await page.close();
  }
  {
    const { page, offsite } = await openPage(b, base, '/app/gallery.html?size=both');
    const ok = await page
      .waitForFunction(() => window.__gallery?.ready, null, { timeout: 30000 })
      .then(
        () => true,
        () => false,
      );
    const faces = await page.evaluate(() => window.__faces?.length || 0);
    const pol = await policy(page);
    T.ok(
      ok && faces > 100 && !pol.seen.length && pol.first && !pol.ran && pol.refused && pol.srcdocLoaded && !pol.srcdoc,
      `${tag}: gallery.html runs under its policy (its script by hash), draws ${faces} faces and refuses an injected inline script and a srcdoc's data: script; no violation${list(pol.seen, 5)}`,
    );
    T.ok(
      !offsite.length,
      `${tag}: gallery.html asked no host but the site for anything${offsite.length ? ' (asked ' + hostsOf(offsite) + ')' : ''}`,
    );
    await page.close();
  }
}

// ------------------------------------------------------------------------------------------------ the community shelf's gallery
// site/community/ is another page on the key's origin (docs/COMMUNITY-SHELF.md section 4): its policy is in force, its
// faces draw from an index, and a clip plays from a blob: URL in each browser. The index is a one-entry fixture served
// from memory as the studio's own copy (/app/community/), so nothing real is committed.
const SHELF_FIX = (() => {
  const sr = 8000,
    n = sr,
    wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n * 2, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sr, 24);
  wav.writeUInt32LE(sr * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 330 * i) / sr)), 44 + i * 2);
  const index = JSON.stringify({
    format: 'overdub-community-index/1',
    built: { from: 'overdub-devices@test', at: '2026-10-05T00:00:00Z' },
    repo: null,
    inputs: { strum: { seconds: 1, lufs: -18, clips: [{ src: 'clips/strum.wav', type: 'audio/wav' }] } },
    revoked: [],
    devices: [
      {
        id: 'test-person.slow-echo',
        name: 'Slow Echo',
        kind: 'effect',
        cat: 'time',
        blurb: 'Echoes for the test',
        tier: 'community',
        author: { handle: 'test-person', alias: null },
        agent: 'Claude',
        license: 'MIT-0',
        sha256: 'a'.repeat(64),
        added: '2026-10-05',
        look: { color: '#2f3b46', shape: 'box' },
        params: [{ key: 'mix', label: 'MIX', min: 0, max: 100, def: 30, unit: '%' }],
        presets: [],
        measured: { ok: true, deltaLU: 0, truePeak: -6, tail: 1, cpu: 1 },
        preview: {
          input: 'strum',
          seconds: 1,
          lufs: -18,
          wet: { clips: [{ src: 'clips/slow-echo.wav', type: 'audio/wav' }] },
          dry: 'strum',
        },
        device: 'devices/test-person.slow-echo.overdub-device.json',
        source: { path: 'devices/test-person/slow-echo', commit: '249eac3', url: null },
      },
    ],
  });
  return {
    'community-index.json': ['application/json', index],
    'clips/strum.wav': ['audio/wav', wav],
    'clips/slow-echo.wav': ['audio/wav', wav],
  };
})();
addRoute('/app/community/', (req, res, url) => {
  const f = SHELF_FIX[url.pathname.slice('/app/community/'.length)];
  if (!f) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('no');
    return true;
  }
  res.writeHead(200, { 'content-type': f[0], 'content-length': String(Buffer.byteLength(f[1])) });
  res.end(req.method === 'HEAD' ? undefined : f[1]);
  return true;
});
async function shelf(b, base, tag) {
  const { page, errors, offsite } = await openPage(b, base, '/site/community/');
  const ok = await page
    .waitForFunction(() => window.__community?.ready, null, { timeout: 30000 })
    .then(
      () => true,
      () => false,
    );
  const faces = await page.evaluate(() => document.querySelectorAll('.cs-face [data-face]').length);
  let played = null;
  if (ok) {
    await page.click('.cs-entry[data-id="test-person.slow-echo"] .cs-play').catch(() => {});
    played = await page
      .waitForFunction(
        () => {
          const a = window.__community.player.audio;
          return a && a.currentTime > 0.05 && { blob: a.src.startsWith('blob:'), t: a.currentTime };
        },
        null,
        { timeout: 10000 },
      )
      .then(
        (h) => h.jsonValue(),
        () => null,
      );
    await page.evaluate(() => window.__community.stop());
  }
  // (the page probes for the shared reader, app/src/devices/community.js, until Work package 1 lands: Firefox reports
  // the missing module as a disallowed MIME type)
  const readerThere = fs.existsSync(new URL('../app/src/devices/community.js', import.meta.url));
  const errs = real(errors).filter((e) => readerThere || !/devices\/community\.js[^]*MIME type/.test(e));
  await page.screenshot({ path: path.join(OUTDIR, `compat-${tag}-community.png`) });
  const pol = await policy(page);
  T.ok(
    ok &&
      faces === 1 &&
      played?.blob &&
      !errs.length &&
      !pol.seen.length &&
      pol.first &&
      !pol.ran &&
      pol.refused &&
      pol.srcdocLoaded &&
      !pol.srcdoc &&
      !pol.wdata &&
      !pol.wblob,
    `${tag}: the community gallery runs under its policy, draws its face, plays a clip from a blob: URL (${played ? played.t.toFixed(2) + ' s' : 'no'}) and refuses injected script; no violation or error${list([...pol.seen, ...errs], 5)}`,
  );
  T.ok(
    !offsite.length,
    `${tag}: the community gallery asked no host but the site for anything${offsite.length ? ' (asked ' + hostsOf(offsite) + ')' : ''}`,
  );
  await page.close();
}

// ------------------------------------------------------------------------------------------------ the landing page
async function landing(b, base, tag) {
  const { page, errors, offsite } = await openPage(b, base, '/');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const v = document.querySelector('video.demo-film');
    const w = document.querySelector('canvas');
    const out = {
      video: !!v,
      canPlay: v ? v.canPlayType('video/mp4; codecs="avc1.42E01E"') : '',
      title: document.title,
      h1: !!document.querySelector('h1'),
      canvas: !!w,
      sw: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
    if (v) {
      v.scrollIntoView();
      v.muted = true;
      try {
        await Promise.race([v.play(), new Promise((r) => setTimeout(r, 5000))]);
      } catch (e) {
        out.playErr = e.name;
      }
      await new Promise((r) => setTimeout(r, 1500));
      out.ready = v.readyState;
      out.t = v.currentTime;
      out.err = v.error && v.error.code;
    }
    return out;
  });
  T.ok(
    r.h1 && r.canvas && r.sw <= r.vw + 1,
    `${tag}: the landing page draws (${r.title}; the Weave canvas; no sideways scroll)`,
  );
  if (!r.video) T.ok(false, `${tag}: the landing page has its film`);
  else if (!r.canPlay)
    T.note(`${tag}: this build can't decode H.264 (Playwright's ${b.engine}); the film shows its poster`);
  else
    T.ok(
      r.ready >= 2 && !r.err && r.t > 0.2,
      `${tag}: the film plays (readyState ${r.ready}, ${r.t.toFixed(2)} s in${r.playErr ? ', play(): ' + r.playErr : ''}${r.err ? ', error ' + r.err : ''})`,
    );
  await page.screenshot({ path: path.join(OUTDIR, `compat-${tag}-landing.png`) });
  const errs = real(errors);
  T.ok(!errs.length, `${tag}: no console or page errors on the landing page${list(errs)}`);
  T.ok(
    !offsite.length,
    `${tag}: the landing page asked no host but the site for anything, its fonts included${offsite.length ? ' (asked ' + hostsOf(offsite) + ')' : ''}`,
  );
  await page.close();
}

// ------------------------------------------------------------------------------------------------ the phone loop
// Touch input: Chromium gets real touch points over CDP (Input.dispatchTouchEvent → touch + pointer events with
// pointerType "touch"); elsewhere synthetic PointerEvents with pointerType "touch".
async function toucher(page, engine) {
  if (engine === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, pts) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map(([x, y]) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 })),
      });
    return {
      async tap(x, y) {
        await send('touchStart', [[x, y]]);
        await sleep(40);
        await send('touchEnd', []);
        await sleep(60);
      },
      async drag(x0, y0, x1, y1, steps = 10) {
        await send('touchStart', [[x0, y0]]);
        await sleep(30);
        for (let i = 1; i <= steps; i++) {
          await send('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]);
          await sleep(16);
        }
        await send('touchEnd', []);
        await sleep(80);
      },
    };
  }
  // a synthetic pointer isn't one the browser tracks, so capturing it would throw: let capture of that id pass
  await page.evaluate(() => {
    for (const k of ['setPointerCapture', 'releasePointerCapture']) {
      const real = Element.prototype[k];
      Element.prototype[k] = function (id) {
        if (id === 7) return;
        return real.call(this, id);
      };
    }
  });
  const fire = (type, x, y) =>
    page.evaluate(
      ([type, x, y]) => {
        const el =
          window.__touchTarget && type !== 'pointerdown' ? window.__touchTarget : document.elementFromPoint(x, y);
        if (type === 'pointerdown') window.__touchTarget = el;
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
        if (type === 'pointerup') {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
          window.__touchTarget = null;
        }
      },
      [type, x, y],
    );
  return {
    async tap(x, y) {
      await page.touchscreen.tap(x, y);
      await sleep(60);
    },
    async drag(x0, y0, x1, y1, steps = 10) {
      await fire('pointerdown', x0, y0);
      for (let i = 1; i <= steps; i++) {
        await fire('pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        await sleep(16);
      }
      await fire('pointerup', x1, y1);
      await sleep(80);
    },
  };
}

async function phoneLoop(b, base, tag) {
  const { page, errors, warns, offsite } = await openPage(b, base, '/app/?demo');
  const shot = (n) => page.screenshot({ path: path.join(OUTDIR, `compat-${tag}-${n}.png`) });
  const E = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await page.waitForTimeout(600);
  T.ok(!warns.length, `${tag}: every studio module loaded${list(warns)}`);
  const touch = await toucher(page, b.engine);
  const box = async (sel) => {
    const r = await page.locator(sel).first().boundingBox();
    return r;
  };
  const center = (r) => [r.x + r.width / 2, r.y + r.height / 2];

  // the welcome card closes with a tap (the first gesture wakes the audio)
  if (await page.isVisible('.ar-welcome')) {
    const r = await box('.ar-welcome button');
    if (r) await touch.tap(...center(r));
  }
  await page.waitForTimeout(300);
  T.ok(!(await page.isVisible('.ar-welcome')), `${tag}: a tap closes the welcome card`);
  const wide = await E(() => document.documentElement.scrollWidth);
  T.ok(wide <= 392, `${tag}: no sideways page scroll (${wide} px)`);
  await shot('open');

  // play and stop from the transport
  const pb = await box('.tp-play');
  await touch.tap(...center(pb));
  await page.waitForFunction(() => window.overdub.engine.playing, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const p1 = await E(() => ({
    playing: window.overdub.engine.playing,
    beat: window.overdub.engine.beat,
    state: window.overdub.engine.ctx?.state,
  }));
  await touch.tap(...center(await box('.tp-play')));
  await page.waitForTimeout(300);
  const p2 = await E(() => window.overdub.engine.playing);
  T.ok(
    p1.playing && p1.beat > 0.5 && !p2,
    `${tag}: tap play, the song plays (beat ${p1.beat.toFixed(2)}, audio ${p1.state}); tap again, it stops`,
  );

  // select a clip with a tap, then open its notes with a double tap
  const target = await E(() => {
    const app = window.overdub,
      p = app.store.get(),
      t = p.tracks.find((x) => x.name === 'Bass'),
      c = t.clips[0];
    const sc = document.querySelector('.ar-scroll'),
      r = sc.getBoundingClientRect();
    const zoom = app.ui.state.zoom,
      i = p.tracks.indexOf(t);
    const x = r.left + (c.start + Math.min(c.length, 4) / 2) * zoom.pxPerBeat - sc.scrollLeft,
      y = r.top + i * zoom.trackH + zoom.trackH * 0.6 - sc.scrollTop;
    return { track: t.id, clip: c.id, x: Math.min(x, r.right - 20), y, visible: y > r.top && y < r.bottom };
  });
  if (!target.visible)
    await E(() => {
      document.querySelector('.ar-scroll').scrollTop = 0;
    });
  await touch.tap(target.x, target.y);
  await page.waitForTimeout(250);
  const sel1 = await E(() => window.overdub.ui.state.selection);
  T.ok(sel1.clip === target.clip, `${tag}: a tap on the Bass clip selects it`);
  await touch.tap(target.x, target.y);
  await sleep(30);
  await touch.tap(target.x, target.y);
  await page.waitForTimeout(500);
  let rollOpen = await E(() => !document.querySelector('[data-panel="pianoroll"]').hidden);
  T.ok(rollOpen, `${tag}: a double tap opens its notes in the Notes tab`);
  if (!rollOpen) {
    await E(() => {
      window.overdub.ui.select({ track: window.overdub.store.get().tracks.find((x) => x.name === 'Bass').id });
      window.overdub.ui.show('pianoroll');
    });
    await page.waitForTimeout(400);
  }
  await shot('notes');

  // draw a note with a tap on an empty spot, then move it with a drag
  const spot = await E(({ track, clip }) => {
    const app = window.overdub,
      c = app.store.clip(track, clip),
      p0 = app.store.get();
    const sc = document.querySelector('[data-panel="pianoroll"] .pr-scroll'),
      r = sc.getBoundingClientRect(),
      sp = sc.firstElementChild;
    // the roll's geometry (ui/pianoroll.js): 128 rows of rowH, 127 at the top; the spacer spans whole bars past the clip
    const bpb = (p0.meter[0] * 4) / p0.meter[1],
      beats = Math.ceil((c.length + bpb * 2) / bpb) * bpb;
    const rowH = sp.offsetHeight / 128,
      ppb = sp.offsetWidth / beats;
    const used = new Set(c.notes.filter((n) => n.t < 1.5).map((n) => n.p));
    const pTop = 127 - Math.floor(sc.scrollTop / rowH),
      pBot = 127 - Math.floor((sc.scrollTop + sc.clientHeight) / rowH);
    let p = Math.round((pTop + pBot) / 2);
    while ((used.has(p) || used.has(p + 1) || used.has(p - 1)) && p > pBot + 2) p--;
    const y = r.top + (127 - p) * rowH + rowH / 2 - sc.scrollTop;
    return {
      p,
      y,
      x0: r.left,
      rowH,
      ppb,
      count: c.notes.length,
      ids: c.notes.map((n) => n.id),
      w: sc.clientWidth,
      h: sc.clientHeight,
      top: r.top,
      sl: sc.scrollLeft,
    };
  }, target);
  const tx = spot.x0 + 0.5 * spot.ppb + 3 - spot.sl; // half a beat in
  await touch.tap(tx, spot.y);
  await page.waitForTimeout(300);
  const drawn = await E(
    ({ track, clip, before }) => {
      const c = window.overdub.store.clip(track, clip);
      return {
        n: c.notes.length,
        last: c.notes.find((x) => !before.includes(x.id)),
        hist: window.overdub.store.history.at(-1)?.label,
      };
    },
    { ...target, before: spot.ids },
  );
  T.ok(
    drawn.n === spot.count + 1 && drawn.last?.by === 'you' && Math.abs(drawn.last.p - spot.p) <= 1,
    `${tag}: a tap on an empty spot draws a note (${drawn.hist}; pitch ${drawn.last?.p}, wanted ${spot.p})`,
  );
  if (drawn.n === spot.count + 1) {
    const n = drawn.last;
    const nx = spot.x0 + (n.t + Math.min(n.d, 0.5) / 2) * spot.ppb - spot.sl,
      ny = spot.y;
    await touch.drag(nx, ny, nx + spot.ppb * 1, ny - spot.rowH * 2, 12);
    await page.waitForTimeout(300);
    const moved = await E(
      ({ track, clip, id }) => window.overdub.store.clip(track, clip).notes.find((x) => x.id === id),
      { ...target, id: n.id },
    );
    T.ok(
      moved && (moved.t !== n.t || moved.p !== n.p),
      `${tag}: dragging the note moves it (t ${n.t} → ${moved?.t}, pitch ${n.p} → ${moved?.p})`,
    );
  } else T.ok(false, `${tag}: dragging the note moves it (no note to drag)`);

  // a finger drag on empty grid scrolls the roll (it doesn't draw)
  const pan0 = await E(() => {
    const sc = document.querySelector('[data-panel="pianoroll"] .pr-scroll');
    return { l: sc.scrollLeft, t: sc.scrollTop };
  });
  const nNotes = await E((t) => window.overdub.store.clip(t.track, t.clip).notes.length, target);
  const gx = spot.x0 + spot.w * 0.7,
    gy = spot.top + spot.h * 0.3;
  await touch.drag(gx, gy, gx - 120, gy + 90, 12);
  await page.waitForTimeout(250);
  const pan1 = await E(() => {
    const sc = document.querySelector('[data-panel="pianoroll"] .pr-scroll');
    return { l: sc.scrollLeft, t: sc.scrollTop };
  });
  const nNotes2 = await E((t) => window.overdub.store.clip(t.track, t.clip).notes.length, target);
  T.ok(
    (pan1.l !== pan0.l || pan1.t !== pan0.t) && nNotes2 === nNotes,
    `${tag}: a finger drag on empty grid scrolls the roll (left ${Math.round(pan0.l)} → ${Math.round(pan1.l)}, top ${Math.round(pan0.t)} → ${Math.round(pan1.t)}) and draws nothing`,
  );
  await shot('notes-edited');

  // the arranger pans with a finger too
  const ar0 = await E(() => {
    const sc = document.querySelector('.ar-scroll');
    return { l: sc.scrollLeft, t: sc.scrollTop, r: sc.getBoundingClientRect().toJSON() };
  });
  const emptyY = await E(() => {
    const app = window.overdub,
      sc = document.querySelector('.ar-scroll'),
      r = sc.getBoundingClientRect(),
      p = app.store.get();
    const i = p.tracks.findIndex((t) => !t.clips.some((c) => c.start < 2));
    return i < 0 ? null : r.top + (i + 0.5) * app.ui.state.zoom.trackH - sc.scrollTop;
  });
  if (emptyY != null && emptyY < ar0.r.y + ar0.r.height - 10) {
    await touch.drag(ar0.r.x + 60, emptyY, ar0.r.x + 60 - 150, emptyY, 10);
    await page.waitForTimeout(250);
    const ar1 = await E(() => {
      const sc = document.querySelector('.ar-scroll');
      return { l: sc.scrollLeft, sel: window.overdub.ui.state.selection.range };
    });
    T.ok(
      ar1.l > ar0.l && !ar1.sel,
      `${tag}: a finger drag on an empty lane scrolls the arrangement (left ${Math.round(ar0.l)} → ${Math.round(ar1.l)})`,
    );
  } else T.note(`${tag}: no empty lane on screen to pan from`);

  // Sketch and Devices open from their tabs
  for (const [name, id] of [
    ['Sketch', 'sketch'],
    ['Devices', 'rack'],
  ]) {
    const tab = page.locator('.ew-tab', { hasText: name }).first();
    await tab.scrollIntoViewIfNeeded().catch(() => {});
    const r = await tab.boundingBox();
    if (r) await touch.tap(...center(r));
    await page.waitForTimeout(400);
    const vis = await E((id) => {
      const el = document.querySelector(`[data-panel="${id}"]`);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, over: el.scrollWidth - el.clientWidth };
    }, id);
    T.ok(
      vis && vis.w > 300 && vis.h > 100,
      `${tag}: a tap on ${name} opens it (${vis ? Math.round(vis.w) + '×' + Math.round(vis.h) : 'hidden'})`,
    );
    await shot(id);
  }
  // Sketch at 390: the Takes column sits below the stage, never over "Hum it."
  await E(() => window.overdub.ui.show('sketch'));
  await page.waitForTimeout(250);
  const cover = await E(() => {
    const hd = [
      ...document.querySelectorAll(
        '[data-panel="sketch"] h1, [data-panel="sketch"] h2, [data-panel="sketch"] h3, [data-panel="sketch"] .sk-title',
      ),
    ].find((x) => /Hum it|Tap it|Play it|Record/.test(x.textContent));
    const ideas = document.querySelector('[data-panel="sketch"] .sk-ideas');
    if (!hd || !ideas) return { miss: !hd ? 'heading' : 'takes' };
    const a = hd.getBoundingClientRect(),
      b = ideas.getBoundingClientRect();
    const ov =
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return {
      ov,
      head: hd.textContent.trim(),
      a: [a.left, a.top, a.right, a.bottom].map(Math.round),
      b: [b.left, b.top, b.right, b.bottom].map(Math.round),
    };
  });
  T.ok(
    !cover.miss && cover.ov === 0,
    `${tag}: Sketch's Takes column doesn't cover the "${cover.head || cover.miss}" heading${cover.ov ? ` (heading ${cover.a}, takes ${cover.b})` : ''}`,
  );
  const errs = real(errors);
  T.ok(!errs.length, `${tag}: no console or page errors on the phone${list(errs, 5)}`);
  const pol = await policy(page);
  T.ok(
    !pol.seen.length && pol.first && !pol.ran && pol.refused,
    `${tag}: on the phone too the policy is in force (an injected inline script is refused) and the loop above raised no violation${list(pol.seen, 5)}`,
  );
  T.ok(
    pol.srcdocLoaded && !pol.srcdoc && !pol.wdata && !pol.wblob,
    `${tag}: and markup can't run script through it: ${probes(pol)}`,
  );
  T.ok(
    !offsite.length,
    `${tag}: on the phone too, no host but the site was asked for anything${offsite.length ? ' (asked ' + hostsOf(offsite) + ')' : ''}`,
  );
  await page.close();
}

// ------------------------------------------------------------------------------------------------ the simple view
// A clean context (the passes above left a song and a layout in theirs), ?view=simple: it boots with no errors on a
// blank song, Find opens and closes, and the page never scrolls sideways.
async function simple(b, base, tag) {
  const context = await b.browser.newContext(b.ctxOpts);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [],
    warns = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && (e.stack || e.message)) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
    else if (m.type() === 'warning' && /^overdub:/.test(m.text())) warns.push(m.text());
  });
  const E = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.goto(base + '/app/?view=simple', { waitUntil: 'load' });
    let booted = true;
    try {
      await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    } catch (e) {
      booted = false;
    }
    T.ok(
      booted && !warns.length,
      `${tag}: the simple view boots, every module started (/app/?view=simple)${list(warns)}`,
    );
    if (!booted) return;
    await page.waitForTimeout(500);
    const st = await E(() => ({
      view: window.overdub.ui.workspace?.view?.() || null,
      tracks: window.overdub.store.get().tracks.length,
      wide: document.documentElement.scrollWidth,
      vw: innerWidth,
    }));
    T.ok(
      st.view === 'simple' && st.tracks === 0 && st.wide <= st.vw,
      `${tag}: it opens simple, on a blank song, no sideways scroll (${st.view}, ${st.tracks} tracks, ${st.wide} px in ${st.vw})`,
    );
    const more = page.locator('.ew-ws button.ws-find-btn').first();
    const can = await more.isVisible().catch(() => false);
    if (can) await more.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const opened = await E(() =>
      [...document.querySelectorAll('input')].some(
        (i) => /^Find anything/.test(i.placeholder || '') && i.getClientRects().length,
      ),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed = await E(
      () =>
        ![...document.querySelectorAll('input')].some(
          (i) => /^Find anything/.test(i.placeholder || '') && i.getClientRects().length,
        ),
    );
    T.ok(can && opened && closed, `${tag}: Find opens and closes (button ${can}, opened ${opened}, closed ${closed})`);
    await page.screenshot({ path: path.join(OUTDIR, `compat-${tag}-simple.png`) }).catch(() => {});
    T.ok(!real(errors).length, `${tag}: the simple view raises no errors${list(real(errors))}`);
  } finally {
    await context.close().catch(() => {});
  }
}

// ------------------------------------------------------------------------------------------------ the server
{
  T.ok(
    JSON.stringify(byteRange('bytes=0-99', 1000)) === '[0,99]' &&
      JSON.stringify(byteRange('bytes=900-', 1000)) === '[900,999]' &&
      JSON.stringify(byteRange('bytes=-100', 1000)) === '[900,999]' &&
      byteRange('bytes=1000-', 1000) === false &&
      byteRange(undefined, 10) === null &&
      JSON.stringify(byteRange('bytes=10-5000', 1000)) === '[10,999]' &&
      byteRange('bytes=0-1,5-6', 1000) === null,
    'serve.js parses byte ranges (a-b, a-, -n; past the end is 416; several ranges get the whole file)',
  );
  await ready;
  const srv = await startServer({ port: 0, quiet: true });
  const film = '/site/assets/overdub-demo.mp4';
  const full = await fetch(srv.url + film);
  const size = Number(full.headers.get('content-length'));
  await full.arrayBuffer();
  const part = await fetch(srv.url + film, { headers: { range: 'bytes=0-1' } });
  const pb = new Uint8Array(await part.arrayBuffer());
  const tail = await fetch(srv.url + film, { headers: { range: `bytes=${size - 10}-` } });
  const tb = await tail.arrayBuffer();
  const bad = await fetch(srv.url + film, { headers: { range: `bytes=${size + 5}-` } });
  await bad.arrayBuffer();
  const head = await fetch(srv.url + '/app/', { method: 'HEAD' });
  T.ok(
    full.status === 200 && full.headers.get('accept-ranges') === 'bytes' && size > 1000,
    `the server says it takes ranges (200, accept-ranges: bytes, ${size} bytes)`,
  );
  T.ok(
    part.status === 206 && part.headers.get('content-range') === `bytes 0-1/${size}` && pb.length === 2,
    `a Range request gets 206 and just those bytes (${part.headers.get('content-range')})`,
  );
  T.ok(
    tail.status === 206 &&
      tb.byteLength === 10 &&
      bad.status === 416 &&
      bad.headers.get('content-range') === `bytes */${size}`,
    'an open-ended range gets the rest; one past the end gets 416',
  );
  T.ok(
    head.status === 200 && Number(head.headers.get('content-length')) > 100,
    'HEAD answers with the length and no body',
  );
  await srv.close();
}

// ------------------------------------------------------------------------------------------------ the inline scripts
// library.html and gallery.html allow their one inline script by its sha256, so an edit to the script needs the new
// hash in the page's policy (or the page stops running): this says which.
{
  const crypto = await import('node:crypto');
  for (const f of ['library.html', 'gallery.html']) {
    const html = fs.readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const want = inline.map((s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`);
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] || '';
    const ok = inline.length === 1 && want.every((x) => csp.includes(x));
    T.ok(
      ok,
      `app/${f}: its policy allows its inline script by hash${ok ? '' : ` (the script's hash is ${want.join(' ')}: put it in script-src at the top of the page)`}`,
    );
  }
}

// ------------------------------------------------------------------------------------------------ fonts and styles: the site's
// The pages' policies name no font or stylesheet host: fonts and styles are files on the site (app/style/fonts.css), so
// font-src is 'self' and style-src names no host; the provenance report, a blob page, takes its fonts inline (data:).
// And no page's head links or preconnects to another host.
{
  const cspOf = (text) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(text)?.[1] || '';
  const dir = (csp, d) => (new RegExp(`(?:^|;)\\s*${d} ([^;]*)`).exec(csp)?.[1] || '').trim();
  const pages = ['index.html', 'library.html', 'gallery.html'].map((f) => [
    `app/${f}`,
    cspOf(fs.readFileSync(new URL('../app/' + f, import.meta.url), 'utf8')),
  ]);
  const bad = pages
    .filter(
      ([, c]) =>
        !c ||
        /googleapis|gstatic|https?:\/\/fonts/.test(c) ||
        dir(c, 'font-src') !== "'self'" ||
        dir(c, 'style-src') !== "'self' 'unsafe-inline'",
    )
    .map(([f, c]) => `${f}: font-src ${dir(c, 'font-src') || '(none)'}; style-src ${dir(c, 'style-src') || '(none)'}`);
  T.ok(
    !bad.length,
    `the studio's, the library's and the gallery's policies: font-src 'self', style-src 'self' 'unsafe-inline', no font host${bad.length ? ' (' + bad.join(' | ') + ')' : ''}`,
  );
  // the provenance report (a page the studio writes): its fonts by URL from the studio's origin, in its tab, or inline
  const { createStore } = await import('../app/src/core/store.js');
  const { provenanceModel, provenanceHtml } = await import('../app/src/ui/provenance.js');
  const model = provenanceModel(createStore(null).get(), {});
  const report = cspOf(provenanceHtml(model)),
    tabbed = cspOf(provenanceHtml(model, { fonts: '', fontSrc: 'https://overdubstudio.com' }));
  T.ok(
    dir(report, 'default-src') === "'none'" &&
      dir(report, 'style-src') === "'unsafe-inline'" &&
      dir(report, 'font-src') === 'data:' &&
      dir(tabbed, 'font-src') === 'https://overdubstudio.com' &&
      ![report, tabbed].some((c) => /googleapis|gstatic/.test(c)),
    `the provenance report's policy: default-src 'none', no font host; its fonts inline (${dir(report, 'font-src')}) or the studio's own (${dir(tabbed, 'font-src')})`,
  );
  const heads = [
    'site/index.html',
    'site/press/index.html',
    ...fs
      .readdirSync(new URL('../site/docs/', import.meta.url))
      .filter((f) => f.endsWith('.html'))
      .map((f) => `site/docs/${f}`),
    'app/index.html',
    'app/library.html',
    'app/gallery.html',
  ]
    .map((f) => [
      f,
      (/<head>([\s\S]*?)<\/head>/.exec(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')) || ['', ''])[1],
    ])
    .filter(([, h]) => /<link[^>]+href="(https?:)?\/\/|@import url\(['"]?https?:/.test(h))
    .map(([f]) => f);
  const tokens = fs.readFileSync(new URL('../app/style/tokens.css', import.meta.url), 'utf8');
  T.ok(
    !heads.length && !/@import url\(['"]?https?:/.test(tokens),
    `no page's head links, preconnects or imports another host, and tokens.css imports only the site's fonts.css${heads.length ? ' (' + heads.join(', ') + ')' : ''}`,
  );
}

// ------------------------------------------------------------------------------------------------ run
await ready;
const srv = await startServer({ port: 0, quiet: true });
try {
  for (const kind of want) {
    console.log(`\n${kind}`);
    let b;
    try {
      b = await launch(kind);
    } catch (e) {
      const msg = String((e && e.message) || e).split('\n')[0];
      if (process.env.REQUIRE_ALL) T.ok(false, `${kind}: launches (${msg})`);
      else
        T.note(
          `${kind}: not available here, skipped (${msg}). Install: node <playwright-core>/cli.js install ${kind.replace(/-phone$/, '')}`,
        );
      continue;
    }
    const t0 = Date.now();
    try {
      if (b.phone) await phoneLoop(b, srv.url, kind);
      else {
        await studio(b, srv.url, kind);
        await landing(b, srv.url, kind);
        await pages(b, srv.url, kind);
        await shelf(b, srv.url, kind);
      }
    } catch (e) {
      T.ok(
        false,
        `${kind}: the run finished (${String((e && e.stack) || e)
          .split('\n')
          .slice(0, 3)
          .join(' ')})`,
      );
    }
    try {
      await simple(b, srv.url, kind);
    } catch (e) {
      T.ok(
        false,
        `${kind}: the simple view's run finished (${String((e && e.stack) || e)
          .split('\n')
          .slice(0, 3)
          .join(' ')})`,
      );
    }
    T.note(`${kind}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await b.browser.close().catch(() => {});
  }
} finally {
  await srv.close();
}
T.done();
