// Analytics checks: counting, not tracking (app/src/analytics.js, site/assets/analytics.js).
//   1. the pieces: host and opt-out rules, the referrer host, the fixed event list, the GIFs
//   2. off production (localhost) nothing fires, whatever you do
//   3. on a faked production host (https://overdubstudio.com routed to the local server) exactly the right URLs
//      fire for the right actions, with no referrer and no cookie, and nothing else
//   4. Do Not Track, Global Privacy Control and automation (navigator.webdriver) send nothing
//   5. the preview site (next.overdubstudio.com): deploy/next/setup.sh and deploy/deploy.sh --next plan the right
//      things with DRY_RUN=1 (a stub aws on PATH, no credentials), the config the deploy writes puts up the Preview
//      ribbon there (desktop and phone), and nothing is counted there; the committed config, and so the live site, has
//      no ribbon
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, tally, OUTDIR } from './pw.js';
import { allowed, optedOut, referrerHost, beaconUrl, exportKind, EVENTS, HOST } from '../app/src/analytics.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = tally('analytics');
const PROD = 'https://' + HOST;
const GIF = fs.readFileSync(path.join(ROOT, 'app/e.gif'));

/* ---------------------------------------------------------------- 1. the pieces */
{
  for (const f of ['app/e.gif', 'site/e.gif']) {
    const b = fs.readFileSync(path.join(ROOT, f));
    t.ok(
      b.length === 43 && b.subarray(0, 6).toString() === 'GIF89a' && b[b.length - 1] === 0x3b,
      `${f} is a 43-byte GIF`,
    );
  }
  const loc = (hostname, protocol = 'https:') => ({ hostname, protocol });
  t.ok(allowed(loc(HOST), {}, {}), 'allowed on https://overdubstudio.com');
  t.ok(!allowed(loc('localhost', 'http:'), {}, {}) && !allowed(loc('127.0.0.1', 'http:'), {}, {}), 'not on localhost');
  t.ok(
    !allowed(loc(HOST, 'http:'), {}, {}) &&
      !allowed(loc('overdubstudio.com.evil.test'), {}, {}) &&
      !allowed(loc('overdub.ajsmithhq.com'), {}, {}),
    'not over http, nor on look-alike hosts',
  );
  t.ok(
    !allowed(loc(HOST), { doNotTrack: '1' }, {}) &&
      !allowed(loc(HOST), {}, { doNotTrack: '1' }) &&
      !allowed(loc(HOST), { msDoNotTrack: '1' }, {}),
    'Do Not Track: nothing',
  );
  t.ok(!allowed(loc(HOST), { globalPrivacyControl: true }, {}), 'Global Privacy Control: nothing');
  t.ok(!allowed(loc(HOST), { webdriver: true }, {}), 'automation: nothing');
  t.ok(!optedOut({ doNotTrack: '0' }, {}) && !optedOut({ doNotTrack: null }, {}), 'DNT 0 or unset is not an opt-out');
  t.ok(
    referrerHost('https://www.google.com/search?q=my+secret+song') === 'google.com',
    'referrer: host only, no www, no query',
  );
  t.ok(
    referrerHost('https://news.ycombinator.com:8443/item?id=1') === 'news.ycombinator.com',
    'referrer: no port, no path',
  );
  t.ok(
    referrerHost('') === '' && referrerHost('not a url') === '' && referrerHost('file:///Users/aj/song.html') === '',
    'referrer: nothing when none or odd',
  );
  t.ok(beaconUrl('play') === '/app/e.gif?e=play', 'beacon: /app/e.gif?e=play');
  t.ok(beaconUrl('agent', 'claude.ai') === '/app/e.gif?e=agent&p=claude.ai', 'beacon: an enumerated field');
  t.ok(
    beaconUrl('agent', 'my-key-sk-ant') === null && beaconUrl('agent') === null,
    'beacon: a field off the list is refused',
  );
  t.ok(
    beaconUrl('title', 'x') === null && beaconUrl('toString') === null && beaconUrl('constructor') === null,
    'beacon: an event off the list is refused',
  );
  t.ok(beaconUrl('hum', 'loud') === '/app/e.gif?e=hum', 'beacon: an event without fields drops any field');
  t.ok(beaconUrl('device', 'you', { r: 'google.com' }) === '/app/e.gif?e=device&p=you', 'beacon: r only on opens');
  t.ok(
    beaconUrl('open', 'demo', { r: 'x.com/path?q' }) === '/app/e.gif?e=open&p=demo',
    'beacon: a malformed r is dropped',
  );
  t.ok(
    Object.keys(EVENTS).join() === 'open,play,agent,device,export,share,hum,keep',
    'the event list is short and fixed',
  );
  t.ok(
    Object.values(EVENTS).every((v) => !v || (v.length <= 8 && v.every((s) => /^[a-z.]{1,10}$/.test(s)))),
    'every field is a short word from a list',
  );
  t.ok(
    [
      'Night Shift.wav',
      'Night Shift stems.zip',
      'Night Shift.mid',
      'Night Shift.overdub.json',
      'Night Shift attribution.json',
      'velvet.overdub-device.json',
      'a.webm',
      'a.txt',
    ]
      .map(exportKind)
      .join() === 'wav,stems,midi,song,log,device,video,other',
    'exports: the file type, never the name',
  );
}

/* ---------------------------------------------------------------- 1b. what the copy says about it */
// The counts exist, so nothing public (or about to be) may say there are none, and the privacy answers name every
// event the studio can send.
{
  // The deck and the launch drafts live in a private repo beside this one; they're checked when it's there.
  const PRIV = process.env.OVERDUB_PRIVATE || path.resolve(ROOT, '..', 'overdub-private');
  const HAS_PRIV = fs.existsSync(path.join(PRIV, 'docs/launch'));
  const at = (f) => (fs.existsSync(path.join(ROOT, f)) ? path.join(ROOT, f) : path.join(PRIV, f));
  const read = (f) => fs.readFileSync(at(f), 'utf8');
  const COPY = [
    'site/index.html',
    'site/press/index.html',
    'README.md',
    'docs/AGENTS.md',
    ...(HAS_PRIV
      ? [
          'deck/index.html',
          ...fs
            .readdirSync(path.join(PRIV, 'docs/launch'))
            .filter((f) => f.endsWith('.md'))
            .map((f) => 'docs/launch/' + f),
        ]
      : []),
  ];
  const denials = COPY.flatMap((f) =>
    (read(f).match(/[^.\n]*\b(no analytics|there(?:'|’)s no analytics|none in the studio)\b[^.\n]*/gi) || []).map(
      (m) => `${f}: "${m.trim()}"`,
    ),
  );
  t.ok(
    !denials.length,
    `no copy says the studio has no analytics${denials.length ? ':\n       ' + denials.join('\n       ') : ''}`,
  );
  const word = {
    open: 'opens',
    play: 'plays',
    agent: 'agent messages',
    device: 'devices',
    export: 'exports',
    share: 'shares',
    hum: 'hums',
    keep: 'keeps',
  };
  const faq6 = HAS_PRIV && (read('docs/launch/faq.md').match(/\*\*6\.[\s\S]*?(?=\n\*\*7\.)/) || [''])[0];
  const pressMd = HAS_PRIV && (read('docs/launch/press-kit.md').match(/\| \*\*Privacy\*\* \|[^\n]*/) || [''])[0];
  const pressHtml = (read('site/press/index.html').match(/<dt>Privacy<\/dt><dd>[\s\S]*?<\/dd>/) || [''])[0];
  for (const [name, text] of [
    ...(HAS_PRIV
      ? [
          ['faq.md 6', faq6],
          ['press-kit.md privacy row', pressMd],
        ]
      : []),
    ['press page privacy row', pressHtml],
  ]) {
    const missing = Object.keys(EVENTS).filter((e) => !(word[e] && text.includes(word[e])));
    t.ok(
      text && !missing.length && /Do Not Track|DNT/.test(text),
      `${name} names every counted event and the opt-out${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`,
    );
  }
}

/* ---------------------------------------------------------------- helpers */
const BEACON = /\/e\.gif(\?|$)/;
// Route the production origin to the local server; record (and answer) every count.
async function fakeProd(context, base, { webdriver = false, dnt = false, gpc = false } = {}) {
  const beacons = [];
  await context.addInitScript(
    ({ webdriver, dnt, gpc }) => {
      if (!webdriver) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
      if (dnt) Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1', configurable: true });
      if (gpc)
        Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
    },
    { webdriver, dnt, gpc },
  );
  await context.route(
    (u) => u.origin === PROD,
    async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (BEACON.test(u.pathname)) {
        const h = await req.allHeaders();
        beacons.push({
          url: u.pathname + u.search,
          referer: h.referer || '',
          cookie: h.cookie || '',
          method: req.method(),
        });
        return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
      }
      return passThrough(route, base + u.pathname + u.search);
    },
  );
  return beacons;
}
// Answer a routed request from the local server. A failed fetch (ECONNRESET under load, or the page already gone) is
// retried, then the request is aborted: an error thrown in a route handler escapes every try/catch and kills the run.
async function passThrough(route, url) {
  for (let i = 0; i < 3; i++) {
    try {
      return await route.fulfill({ response: await route.fetch({ url }) });
    } catch {
      /* retry */
    }
  }
  return route.abort().catch(() => {});
}
const settle = (page, ms = 400) => page.waitForTimeout(ms);
const ready = (page) => page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });

// Everything a person (and their agents) might do in one sitting. Returns what each step should count.
async function doThings(page) {
  return page.evaluate(async () => {
    const app = window.overdub;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const steps = [];
    const step = async (name, fn) => {
      await fn();
      await wait(250);
      steps.push(name);
    };
    await step('play', async () => {
      await app.engine.start();
      app.engine.play(0);
      await wait(200);
      app.engine.stop();
      app.engine.play(0);
      await wait(100);
      app.engine.stop();
    });
    await step('agent:demo', async () => {
      app.agent.useMock(true);
      app.agent.send('hello');
      await wait(30);
      app.agent.stop();
    });
    await step('agent:mcp', async () => {
      await app.tools.run('get_project', {}, { by: 'mcp:test' });
      await app.tools.run('get_selection', {}, { by: 'mcp:test' });
      await app.tools.run('get_project', {}, { by: 'mcp:other' });
    });
    await step('agent:claude.ai', async () => {
      await app.tools.run('get_project', {}, { by: 'claude.ai' });
      await app.tools.run('get_project', {}, { by: 'claude' });
    });
    const KERNEL =
      '({ create({ sr, dsp }) { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] *= p.level; R[i] *= p.level; } } }; } })';
    const dev = (id) => ({
      id,
      name: 'Quiet ' + id.slice(-1),
      kind: 'effect',
      cat: 'utility',
      blurb: 'a level',
      params: [{ key: 'level', label: 'LEVEL', min: 0, max: 1, def: 0.8, role: 'level' }],
      kernel: KERNEL,
    });
    await step('device:you', async () => {
      app.store.dispatch(
        { type: 'device.define', device: { ...dev('you.quiet-a'), by: 'you', version: 1, created: Date.now() } },
        { by: 'you', label: 'a device' },
      );
    });
    // (the device.define an agent's define_device dispatches: under the faked production host below, the device check
    // can't load the kernel worklet, whose module fetch a Playwright route never sees, so the op is dispatched as the
    // tool would; the count is what this suite checks)
    await step('device:agent', async () => {
      app.store.dispatch(
        { type: 'device.define', device: { ...dev('test.quiet-b'), by: 'mcp:test', version: 1, created: Date.now() } },
        { by: 'mcp:test', label: 'a device' },
      );
    });
    await step('undo+redo', async () => {
      app.store.undo();
      app.store.redo();
      app.store.load(JSON.parse(JSON.stringify(app.store.get())), { by: 'you' });
    });
    await step('export', async () => {
      app.exporter.exportMidi();
      app.exporter.saveProject();
      app.exporter.exportLog();
    });
    let link = null;
    await step('share', async () => {
      const r = app.share?.copy ? await app.share.copy({ anchor: null }) : null; // the Song menu's Share
      link = r && r.url;
      await app.tools.run('share_link', {}, { by: 'mcp:test' }); // an agent makes one
      app.ui.emit('share', { kind: 'embed' });
      app.ui.emit('share', { kind: 'a song called <secret>' });
    });
    let hum = null;
    await step('hum', async () => {
      hum = app.input.capture.add({
        src: 'hum',
        kind: 'notes',
        notes: [
          { p: 60, t: 0, d: 1, v: 0.8 },
          { p: 64, t: 1, d: 1, v: 0.8 },
        ],
        tempo: 120,
      });
      app.input.capture.add({ src: 'tap', kind: 'drums', notes: [{ p: 36, t: 0, d: 0.25, v: 0.8 }], tempo: 120 });
    });
    await step('keep:idea', async () => {
      const r = app.input.capture.keep(hum.id, { newTrack: { name: 'Hum' } });
      if (!r.ok) throw new Error('keep: ' + r.error);
    });
    await step('keep:take', async () => {
      const vars = (n) => [
        { label: 'slower', ops: [{ type: 'project.set', patch: { tempo: 90 + n } }] },
        { label: 'faster', ops: [{ type: 'project.set', patch: { tempo: 130 + n } }] },
      ];
      const a = await app.tools.run('propose_variations', { variations: vars(0), wait_seconds: 0 }, { by: 'mcp:test' });
      const ra = app.tools.requests.get(a.id);
      app.tools.answer(a.id, ra.cards.find((c) => !c.original).index);
      const b = await app.tools.run('propose_variations', { variations: vars(1), wait_seconds: 0 }, { by: 'mcp:test' });
      const rb = app.tools.requests.get(b.id);
      app.tools.answer(b.id, rb.cards.find((c) => c.original).index); // "as it was": not a keep
    });
    window.__link = link;
    return steps;
  });
}
const EXPECTED = [
  '/app/e.gif?e=play',
  '/app/e.gif?e=agent&p=demo',
  '/app/e.gif?e=agent&p=mcp',
  '/app/e.gif?e=agent&p=claude.ai',
  '/app/e.gif?e=device&p=you',
  '/app/e.gif?e=device&p=agent',
  '/app/e.gif?e=export&p=midi',
  '/app/e.gif?e=export&p=song',
  '/app/e.gif?e=export&p=log',
  '/app/e.gif?e=share&p=link',
  '/app/e.gif?e=share&p=agent',
  '/app/e.gif?e=share&p=embed',
  '/app/e.gif?e=share&p=other',
  '/app/e.gif?e=hum',
  '/app/e.gif?e=keep&p=idea',
  '/app/e.gif?e=keep&p=take',
];

let session;
try {
  /* ---------------------------------------------------------------- 2. off production */
  session = await open('/app/', { query: 'demo' });
  {
    const { page, context, errors } = session;
    const seen = [];
    context.on('request', (r) => {
      if (BEACON.test(new URL(r.url()).pathname)) seen.push(r.url());
    });
    await ready(page);
    t.ok(
      await page.evaluate(() => window.overdub.analytics && window.overdub.analytics.enabled === false),
      'localhost: analytics installed, switched off',
    );
    const steps = await doThings(page);
    await settle(page);
    t.ok(
      steps.length === 12,
      `localhost: did ${steps.length} things (play, agents, devices, exports, a share, a hum, keeps)`,
    );
    t.ok(
      seen.length === 0 && (await page.evaluate(() => window.overdub.analytics.sent.length)) === 0,
      `localhost: nothing fired (${seen.length})`,
    );
    await page.goto(session.base + '/', { waitUntil: 'load' });
    await settle(page);
    t.ok(seen.length === 0, 'localhost landing page: nothing fired');
    t.ok(!errors.length, 'localhost: no page errors ' + errors.slice(0, 3).join(' | '));
  }

  /* ---------------------------------------------------------------- 3. faked production */
  {
    const { browser, base } = session;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
    const beacons = await fakeProd(context, base);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.stack) || e)));

    await page.goto(PROD + '/', { waitUntil: 'load', referer: 'https://www.google.com/search?q=my+song+title' });
    await settle(page, 800);
    t.ok(
      beacons.length === 1 && beacons[0].url === '/site/e.gif?e=view&r=google.com',
      'landing: one view, with the referring host only: ' + beacons.map((b) => b.url).join(' '),
    );
    t.ok(/Counted, not tracked/.test(await page.textContent('footer')), 'landing footer says what is counted');

    beacons.length = 0;
    await page.goto(PROD + '/app/?demo', { waitUntil: 'load' });
    await ready(page);
    await settle(page);
    t.ok(
      beacons.map((b) => b.url).join(' ') === '/app/e.gif?e=open&p=demo',
      'studio: one open (p=demo, no referrer): ' + beacons.map((b) => b.url).join(' '),
    );
    t.ok(await page.evaluate(() => window.overdub.analytics.enabled === true), 'studio: analytics on');
    t.ok(
      await page.evaluate(async () => {
        const s = await window.overdub.site.ready;
        return (
          s.env === 'production' &&
          !s.preview &&
          !document.querySelector('.preview-slip') &&
          !document.title.startsWith('Preview')
        );
      }),
      'production: the committed site config, and no Preview ribbon',
    );

    beacons.length = 0;
    await doThings(page);
    await settle(page, 600);
    const got = beacons.map((b) => b.url);
    t.ok(got.join(' ') === EXPECTED.join(' '), `studio: exactly the expected ${EXPECTED.length} counts, in order`);
    if (got.join(' ') !== EXPECTED.join(' ')) t.note('got: ' + got.join(' '));
    t.ok(
      beacons.every((b) => b.method === 'GET' && !b.referer && !b.cookie),
      'every count is a GET with no referrer and no cookie',
    );
    t.ok(
      beacons.every((b) => [...new URL(b.url, PROD).searchParams.keys()].every((k) => k === 'e' || k === 'p')),
      'only e and p after the open',
    );
    t.ok(
      !got.some((u) => /secret|night|quiet|slower|faster/i.test(decodeURIComponent(u))),
      'no song content, names or text in any count',
    );

    // a share link: opening it, then making it yours
    const link = await page.evaluate(() => window.__link);
    t.ok(
      typeof link === 'string' && link.startsWith(PROD + '/app/#'),
      'the share link points at production (its song rides in the hash)',
    );
    beacons.length = 0;
    await page.goto('about:blank');
    await page.goto(link, { waitUntil: 'load', referer: 'https://app.slack.com/client/T0/C0' });
    await ready(page);
    await settle(page);
    await page.evaluate(() => window.overdub.share.fork());
    await settle(page);
    t.ok(
      beacons.map((b) => b.url).join(' ') === '/app/e.gif?e=open&p=link&r=app.slack.com /app/e.gif?e=share&p=fork',
      'a share link: open p=link, then share p=fork: ' + beacons.map((b) => b.url).join(' '),
    );
    t.ok(
      beacons.every((b) => !b.referer && !/#|s=/.test(b.url)),
      "the link's song never reaches a count",
    );

    // a saved song, opened from a link elsewhere; then ?new
    beacons.length = 0;
    await page.waitForTimeout(700); // autosave
    await page.goto(PROD + '/app/', { waitUntil: 'load', referer: 'https://news.ycombinator.com/item?id=4242' });
    await ready(page);
    await settle(page);
    t.ok(
      beacons.map((b) => b.url).join(' ') === '/app/e.gif?e=open&p=saved&r=news.ycombinator.com',
      'reopened: p=saved with the referring host: ' + beacons.map((b) => b.url).join(' '),
    );
    beacons.length = 0;
    await page.goto(PROD + '/app/?new', { waitUntil: 'load' });
    await ready(page);
    await settle(page);
    t.ok(beacons.map((b) => b.url).join(' ') === '/app/e.gif?e=open&p=new', '?new: p=new');
    t.ok(!errors.length, 'production: no page errors ' + errors.slice(0, 3).join(' | '));
    await context.close();
  }

  /* ---------------------------------------------------------------- 4. DNT, GPC, automation */
  for (const [label, opts] of [
    ['Do Not Track', { dnt: true }],
    ['Global Privacy Control', { gpc: true }],
    ['automation (navigator.webdriver)', { webdriver: true }],
  ]) {
    const { browser, base } = session;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
    const beacons = await fakeProd(context, base, opts);
    const page = await context.newPage();
    await page.goto(PROD + '/', { waitUntil: 'load', referer: 'https://www.google.com/' });
    await page.goto(PROD + '/app/?demo', { waitUntil: 'load' });
    await ready(page);
    const off = await page.evaluate(() => window.overdub.analytics.enabled === false);
    await doThings(page);
    await settle(page);
    t.ok(off && beacons.length === 0, `${label}: nothing sent (${beacons.length})`);
    await context.close();
  }

  /* ---------------------------------------------------------------- 5. the preview site */
  {
    // the scripts, dry: a stub aws comes first on PATH and there are no credentials, so nothing here reaches AWS
    const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'next-dry-'));
    fs.writeFileSync(path.join(stub, 'aws'), '#!/bin/sh\necho "aws was called: $*" >&2\nexit 97\n', { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${stub}${path.delimiter}${process.env.PATH}`,
      DRY_RUN: '1',
      AWS_CONFIG_FILE: '/dev/null',
      AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
      DEPLOY_ENV: '/dev/null',
      SITE_CONFIG: '/dev/null',
    };
    // DEPLOY_ENV=/dev/null: setup.sh would otherwise read deploy/.env, which on a working checkout holds the real ids;
    // SITE_CONFIG=/dev/null: deploy.sh would otherwise start the site config from deploy/site-config.json
    for (const k of [
      'AWS_PROFILE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'NEXT_ZONE',
      'NEXT_OAC',
      'NEXT_CERT',
      'OAC',
      'ZONE',
      'CERT',
      'REF',
    ])
      delete env[k];
    const run = (script, ...args) => {
      const extra = typeof args[0] === 'object' ? args.shift() : {};
      const r = spawnSync('bash', [path.join(ROOT, script), ...args], {
        cwd: ROOT,
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout: 120000,
      });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
    };
    const clean = (r) => r.status === 0 && !/aws was called/.test(r.out);

    const setup = run('deploy/next/setup.sh');
    const plan = setup.out;
    t.ok(
      clean(setup),
      `deploy/next/setup.sh with DRY_RUN=1 runs without calling AWS (exit ${setup.status})${clean(setup) ? '' : ': ' + plan.slice(-300)}`,
    );
    t.ok(
      /\+ aws s3api create-bucket --bucket next\.overdubstudio\.com /.test(plan) &&
        /BlockPublicPolicy=true/.test(plan) &&
        /"AWS:SourceArn": "arn:aws:cloudfront::\d+:distribution\/EDRYRUN"/.test(plan),
      'setup: a private bucket only its own distribution may read',
    );
    t.ok(
      /\+ aws acm request-certificate --region us-east-1 --domain-name next\.overdubstudio\.com --validation-method DNS/.test(
        plan,
      ) &&
        /"Type": "CNAME"/.test(plan) &&
        /aws acm wait certificate-validated/.test(plan),
      'setup: its own certificate, validated by a CNAME in the zone',
    );
    t.ok(
      /"Aliases": \{ "Quantity": 1, "Items": \["next\.overdubstudio\.com"\] \}/.test(plan) &&
        /"OriginAccessControlId": "EOACDRYRUN"/.test(plan) &&
        /"EventType": "viewer-request"/.test(plan) &&
        /var HOME = 'next\.overdubstudio\.com';/.test(plan) &&
        !/var HOME = 'overdubstudio\.com';/.test(plan),
      'setup: CloudFront with OAC and the path-rewrite function, its home set to next.overdubstudio.com',
    );
    t.ok(
      /"Header": "X-Robots-Tag", "Value": "noindex, nofollow"/.test(plan) &&
        /"ResponseHeadersPolicyId": "RHPDRYRUN"/.test(plan),
      'setup: every response says X-Robots-Tag: noindex, nofollow',
    );
    t.ok(
      /"Name": "next\.overdubstudio\.com", "Type": "A", "AliasTarget"/.test(plan) && /"Type": "AAAA"/.test(plan),
      'setup: A and AAAA alias records for next.overdubstudio.com',
    );
    // and a filled-in env file is read: its ids are used and nothing is made in their place
    const envFile = path.join(stub, 'env');
    fs.writeFileSync(
      envFile,
      'OAC=EOACFROMENV\nNEXT_ZONE=ZZONEFROMENV\nNEXT_CERT=arn:aws:acm:us-east-1:000000000000:certificate/from-env\n',
    );
    const withEnv = run('deploy/next/setup.sh', { DEPLOY_ENV: envFile });
    t.ok(
      clean(withEnv) &&
        /"OriginAccessControlId": "EOACFROMENV"/.test(withEnv.out) &&
        !/create-origin-access-control/.test(withEnv.out) &&
        /"ACMCertificateArn": "arn:aws:acm:us-east-1:000000000000:certificate\/from-env"/.test(withEnv.out) &&
        !/request-certificate/.test(withEnv.out) &&
        /--hosted-zone-id ZZONEFROMENV/.test(withEnv.out) &&
        !/EOACDRYRUN|ZDRYRUN/.test(withEnv.out),
      'setup: reads the ids in DEPLOY_ENV (else deploy/.env) and makes nothing it was given',
    );
    const setupSrc = fs.readFileSync(path.join(ROOT, 'deploy/next/setup.sh'), 'utf8');
    t.ok(
      !/\b\d{12}\b/.test(setupSrc.replace(/000000000000/g, '')) &&
        !/Z[0-9A-Z]{12,}/.test(setupSrc.replace(/Z2FDTNDATAQYW2/g, '')) &&
        !/arn:aws:acm:[^:]*:\d/.test(setupSrc),
      "setup: no account, zone or certificate id is written in it (only AWS's own constants)",
    );

    const ref = spawnSync('git', ['rev-parse', '--short', 'HEAD~1'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    const next = run('deploy/deploy.sh', '--skip-tests', '--next', 'HEAD~1');
    const live = run('deploy/deploy.sh', '--skip-tests');
    t.ok(
      clean(next) && clean(live),
      `deploy/deploy.sh with DRY_RUN=1, live and --next HEAD~1, runs without calling AWS (exit ${live.status}, ${next.status})`,
    );
    t.ok(
      new RegExp(`^next: ${ref} \\(HEAD~1\\)`, 'm').test(next.out) &&
        /\+ aws s3 sync \S+ s3:\/\/next\.overdubstudio\.com --only-show-errors --delete/.test(next.out) &&
        /\+ aws cloudfront create-invalidation --distribution-id \S+ --paths \/\*/.test(next.out) &&
        !/s3:\/\/overdub\.ajsmithhq\.com/.test(next.out),
      `deploy --next ships the named ref (${ref}) to the preview bucket only, and invalidates`,
    );
    t.ok(
      /\+ aws s3 sync \S+ s3:\/\/overdub\.ajsmithhq\.com --only-show-errors --delete/.test(live.out) &&
        !/next\.overdubstudio\.com/.test(live.out),
      'deploy without --next still ships to the live bucket only',
    );
    const cfgOf = (out) => {
      try {
        return JSON.parse((/^app\/site-config\.json: (.*)$/m.exec(out) || [])[1]);
      } catch {
        return null;
      }
    };
    const nextCfg = cfgOf(next.out),
      liveCfg = cfgOf(live.out);
    const tracked = spawnSync('git', ['ls-files', 'app/site-config.json', 'deploy/site-config.json'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).stdout.trim();
    const ignored =
      spawnSync('git', ['check-ignore', 'app/site-config.json', 'deploy/site-config.json'], {
        cwd: ROOT,
        encoding: 'utf8',
      })
        .stdout.trim()
        .split('\n').length === 2;
    t.ok(
      !tracked && ignored,
      `the site config is never committed: deploy.sh writes it (${tracked || 'untracked'}, ${ignored ? 'ignored' : 'not ignored'})`,
    );
    t.ok(
      liveCfg && JSON.stringify(liveCfg) === '{}',
      `with no base the live deploy ships {}, which is the live site (${JSON.stringify(liveCfg)})`,
    );
    t.ok(
      nextCfg && nextCfg.preview === true && nextCfg.env === 'preview' && nextCfg.ref === ref,
      `the preview deploy adds its own keys (${JSON.stringify(nextCfg)})`,
    );
    // one base for both sites: a switch in deploy/site-config.json reaches both, and the preview keeps it
    const base = path.join(stub, 'site-config.json');
    fs.writeFileSync(base, JSON.stringify({ other: { api: 'https://switch.example' } }));
    const nextB = cfgOf(run('deploy/deploy.sh', { SITE_CONFIG: base }, '--skip-tests', '--next', 'HEAD~1').out);
    const liveB = cfgOf(run('deploy/deploy.sh', { SITE_CONFIG: base }, '--skip-tests').out);
    t.ok(
      liveB &&
        JSON.stringify(liveB) === JSON.stringify({ other: { api: 'https://switch.example' } }) &&
        !('preview' in liveB) &&
        nextB &&
        nextB.other &&
        nextB.other.api === 'https://switch.example' &&
        nextB.preview === true &&
        nextB.ref === ref,
      `the base config reaches both sites; the preview adds to it and drops nothing (${JSON.stringify(liveB)}, ${JSON.stringify(nextB)})`,
    );
    t.ok(
      !allowed({ hostname: 'next.overdubstudio.com', protocol: 'https:' }, {}, {}),
      'analytics: not on next.overdubstudio.com',
    );
    fs.rmSync(stub, { recursive: true, force: true });

    // the studio on the preview host, served the config the deploy wrote
    const NEXT = 'https://next.overdubstudio.com';
    for (const [label, vp] of [
      ['desktop', { width: 1440, height: 900 }],
      ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ]) {
      const { browser, base } = session;
      const { width, height, ...more } = vp;
      const context = await browser.newContext({ viewport: { width, height }, ...more, permissions: ['microphone'] });
      await context.addInitScript(() =>
        Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }),
      );
      const counted = [];
      await context.route(
        (u) => u.origin === NEXT,
        async (route) => {
          const u = new URL(route.request().url());
          if (BEACON.test(u.pathname)) {
            counted.push(u.pathname + u.search);
            return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
          }
          if (u.pathname === '/app/site-config.json')
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nextCfg || {}) });
          return passThrough(route, base + u.pathname + u.search);
        },
      );
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.stack) || e)));
      await page.goto(NEXT + '/app/?demo', { waitUntil: 'load' });
      await ready(page);
      await page.waitForSelector('.preview-slip', { timeout: 10000 }).catch(() => null);
      const slip = await page.evaluate(() => {
        const el = document.querySelector('.preview-slip');
        if (!el) return null;
        const r = el.getBoundingClientRect(),
          cs = getComputedStyle(el);
        return {
          text: el.textContent,
          shown: el.innerText.replace(/\s+/g, ' ').trim().toLowerCase(),
          label: el.getAttribute('aria-label'),
          title: document.title,
          pe: cs.pointerEvents,
          left: r.left,
          right: r.right,
          top: r.top,
          h: r.height,
          vw: innerWidth,
          site: { ...window.overdub.site, ready: undefined },
        };
      });
      t.ok(
        slip &&
          slip.text === `Preview · ${ref}` &&
          slip.title.startsWith('Preview · ') &&
          /stay on this site/.test(slip.label) &&
          slip.site.preview === true,
        `${label}: the preview wears the ribbon ("${slip && slip.text}") and its tab says Preview`,
      );
      const shows = label === 'phone' ? 'preview' : `preview · ${ref}`.toLowerCase();
      t.ok(slip && slip.shown === shows, `${label}: the slip shows "${shows}" on screen ("${slip && slip.shown}")`);
      t.ok(
        slip &&
          slip.pe === 'none' &&
          slip.top === 0 &&
          slip.left >= 0 &&
          slip.right <= slip.vw &&
          slip.h <= 16 &&
          slip.left === 0,
        `${label}: the ribbon sits in the top-left corner, inside the screen, and takes no clicks (${slip ? `${Math.round(slip.left)}-${Math.round(slip.right)} of ${slip.vw}, ${Math.round(slip.h)} px` : 'none'})`,
      );
      await page.screenshot({ path: path.join(OUTDIR, `preview-${label}.png`) });
      await doThings(page);
      await settle(page);
      t.ok(
        !counted.length && (await page.evaluate(() => window.overdub.analytics.enabled === false)),
        `${label}: nothing counted on the preview (${counted.length})`,
      );
      t.ok(!errors.length, `${label}: no page errors on the preview ` + errors.slice(0, 3).join(' | '));
      await context.close();
    }
  }
} catch (e) {
  t.ok(false, 'analytics test crashed: ' + ((e && e.stack) || e));
} finally {
  if (session) await session.close();
}
t.done();
