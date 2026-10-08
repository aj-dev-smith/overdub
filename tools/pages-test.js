// Checks for the press kit (/site/press/) and the docs (/site/docs/ and one page per doc).
//   node tools/pages-test.js
// At 1440 and 390 px wide, every page: loads without console or page errors; doesn't scroll sideways (nothing pokes
// past the viewport unless it sits inside its own scroller, like a code block or a wide table); every link and asset
// on it resolves (HEAD 200 on the local server, and #fragments land on a real id); every heading has an id and a
// link to itself (the hub's cards link to their doc instead); ids are unique. Also: the docs pages match their
// Markdown (tools/docs-build.js --check), the press kit's boilerplate word counts and stated image and film sizes are
// true, and the landing page's footer links to both pages. Claims: the copy (site, docs, deck, launch drafts) says
// nothing retired (Chrome-only, sandboxed kernels, MCP without a local copy, misquoted sources...), every stated
// tool count is the studio's, and stated test counts agree. The guide (docs/GUIDE.md) is first in the hub, and the
// buttons, models, keys and counts it gives a newcomer are the studio's. Screenshots land in tools/.out/pages-*.png.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, tally, OUTDIR } from './pw.js';
import { DOCS } from './docs-build.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const t = tally('pages');
const PROD = 'https://overdubstudio.com';
// The deck, the strategy memo and the launch drafts live in a private repo beside this one (OVERDUB_PRIVATE to point
// elsewhere). The claims checks read them when they're there and skip them in a public clone.
// From a worktree (.claude/worktrees/<name>), "beside this one" means beside the checkout the worktree belongs to.
const CHECKOUT = ROOT.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/, '');
const PRIV = process.env.OVERDUB_PRIVATE || path.resolve(CHECKOUT, '..', 'overdub-private');
const HAS_PRIV = fs.existsSync(path.join(PRIV, 'deck/index.html'));

// ---- the docs are built from the current Markdown
try {
  execFileSync(process.execPath, [path.join(HERE, 'docs-build.js'), '--check'], { stdio: 'pipe' });
  t.ok(true, 'site/docs/*.html match their Markdown (docs-build --check)');
} catch (e) {
  t.ok(false, 'site/docs/*.html are out of date: run node tools/docs-build.js\n' + String(e.stdout || e));
}

const PAGES = ['/site/press/', '/site/docs/', ...DOCS.map((d) => `/site/docs/${d.slug}.html`)];

// Headings in a Markdown file (outside code fences), minus the title.
function mdHeadings(file) {
  let fence = false,
    n = 0;
  for (const l of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
    if (/^ {0,3}(```|~~~)/.test(l)) {
      fence = !fence;
      continue;
    }
    if (!fence && /^ {0,3}#{2,6}\s/.test(l)) n++;
  }
  return n;
}

const status = new Map(); // url -> HTTP status (HEAD)
const htmlOf = new Map(); // url -> body, for #fragment checks on other pages
async function head(url) {
  if (!status.has(url)) {
    const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
    status.set(url, r ? r.status : 0);
  }
  return status.get(url);
}
async function idsIn(url) {
  if (!htmlOf.has(url)) htmlOf.set(url, await (await fetch(url)).text());
  return htmlOf.get(url);
}

for (const width of [1440, 390]) {
  const o = await open('/site/press/', { width, height: width < 600 ? 844 : 900 });
  const { page, base, errors } = o;
  // what each page asks of a host other than the site (nothing: its fonts are the site's, app/style/fonts.css)
  let offsite = [];
  page.on('request', (r) => {
    try {
      const u = new URL(r.url());
      if (/^https?:$/.test(u.protocol) && u.host !== new URL(base).host) offsite.push(u.host);
    } catch {
      /* data: */
    }
  });
  console.log(`\n${width} px`);
  for (const route of PAGES) {
    const before = errors.length;
    offsite = [];
    await page.goto(base + route, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250); // let the press kit's size lookups land
    const name = route
      .replace(/^\/site\//, '')
      .replace(/\/$/, '/index')
      .replace(/\.html$/, '')
      .replace(/\//g, '-');
    if (route === '/site/press/' || route === '/site/docs/' || route.endsWith('agents.html'))
      await page.screenshot({ path: path.join(OUTDIR, `pages-${name}-${width}.png`) });

    const errs = errors.slice(before);
    t.ok(
      errs.length === 0,
      `${route} @${width}: no console or page errors${errs.length ? '\n       ' + errs.join('\n       ') : ''}`,
    );

    // ---- no sideways scroll
    const ov = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const inScroller = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true;
        }
        return false;
      };
      const bad = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if ((r.right > W + 1 || r.left < -1) && !inScroller(el))
          bad.push(
            `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`,
          );
      }
      return { W, sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), bad: bad.slice(0, 6) };
    });
    t.ok(
      ov.sw <= ov.W && ov.bad.length === 0,
      `${route} @${width}: no horizontal scroll (page ${ov.sw} px in ${ov.W} px)${ov.bad.length ? '; past the edge: ' + ov.bad.join(', ') : ''}`,
    );

    if (width !== 1440) continue; // the rest doesn't depend on the width

    t.ok(
      !offsite.length,
      `${route}: asks no host but the site for anything, its fonts included${offsite.length ? ' (asked ' + [...new Set(offsite)].join(', ') + ')' : ''}`,
    );

    // ---- headings: an id, and a link to themselves (the hub's cards link to their doc)
    const hs = await page.evaluate(() =>
      [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')].map((h) => ({
        text: h.textContent.trim().replace(/\s+/g, ' ').slice(0, 50),
        id: h.id,
        self: !!h.id && !!h.querySelector(`a[href="#${CSS.escape(h.id)}"]`),
        card: !!h.closest('.doc-card') && /\.html$/.test(h.querySelector('a')?.getAttribute('href') || ''),
      })),
    );
    const noAnchor = hs.filter((h) => !h.id || !(h.self || h.card));
    t.ok(
      hs.length > 0 && noAnchor.length === 0,
      `${route}: all ${hs.length} headings have an id and an anchor${noAnchor.length ? ': missing on ' + noAnchor.map((h) => `"${h.text}"`).join(', ') : ''}`,
    );
    const dupes = await page.evaluate(() => {
      const seen = {},
        d = [];
      document.querySelectorAll('[id]').forEach((e) => {
        if (seen[e.id]) d.push(e.id);
        seen[e.id] = 1;
      });
      return d;
    });
    t.ok(dupes.length === 0, `${route}: ids are unique${dupes.length ? ': ' + dupes.join(', ') : ''}`);

    // ---- every link and asset resolves
    const urls = await page.evaluate(() => {
      const out = new Set();
      const add = (u) => {
        if (u && !u.startsWith('data:') && !u.startsWith('mailto:')) out.add(new URL(u, location.href).href);
      };
      document.querySelectorAll('a[href]').forEach((a) => add(a.getAttribute('href')));
      document
        .querySelectorAll('img[src], source[src], script[src], video[src]')
        .forEach((e) => add(e.getAttribute('src')));
      document.querySelectorAll('img[srcset], source[srcset]').forEach((e) =>
        e
          .getAttribute('srcset')
          .split(',')
          .forEach((p) => add(p.trim().split(/\s+/)[0])),
      );
      document.querySelectorAll('video[poster]').forEach((v) => add(v.getAttribute('poster')));
      document.querySelectorAll('link[href]').forEach((l) => add(l.getAttribute('href')));
      return [...out];
    });
    const broken = [];
    let local = 0,
      external = 0,
      frags = 0;
    for (const u0 of urls) {
      let u = u0;
      if (u.startsWith(PROD)) u = base + u.slice(PROD.length); // links to the live site are checked against this tree
      if (!u.startsWith(base)) {
        external++;
        continue;
      }
      const [file, frag] = u.split('#');
      local++;
      const st = await head(file);
      if (st !== 200) {
        broken.push(`${file.slice(base.length)} → ${st}`);
        continue;
      }
      if (frag) {
        frags++;
        const here = file === page.url().split('#')[0];
        const found = here
          ? await page.evaluate((id) => !!document.getElementById(decodeURIComponent(id)), frag)
          : new RegExp(`id="${frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(await idsIn(file));
        if (!found) broken.push(`${u.slice(base.length)} → no such id`);
      }
    }
    t.ok(
      broken.length === 0,
      `${route}: ${local} local links and assets resolve (${frags} #fragments land; ${external} external not fetched)${broken.length ? ':\n       ' + broken.join('\n       ') : ''}`,
    );

    // ---- per page
    if (route.endsWith('.html')) {
      const doc = DOCS.find((d) => route.endsWith(`/${d.slug}.html`));
      const n = await page.evaluate(
        () => document.querySelectorAll('.prose h2, .prose h3, .prose h4, .prose h5, .prose h6').length,
      );
      const want = mdHeadings(doc.src);
      t.ok(n === want, `${route}: renders all ${want} headings of ${doc.src} (${n})`);
      const mono = await page.evaluate(() =>
        [...document.querySelectorAll('.code pre')].every((p) =>
          /Atkinson Hyperlegible Mono/.test(getComputedStyle(p).fontFamily),
        ),
      );
      t.ok(mono, `${route}: code blocks are set in the mono`);
    }
    if (route === '/site/press/') {
      const counts = await page.evaluate(() =>
        [...document.querySelectorAll('[data-words]')].map((s) => {
          const text = s.closest('.bp-item').querySelector('.bp-text').textContent;
          return { said: parseInt(s.textContent, 10), real: text.trim().split(/\s+/).filter(Boolean).length };
        }),
      );
      t.ok(
        counts.length === 3 && counts.every((c) => c.said === c.real),
        `press: boilerplate word counts are true (${counts.map((c) => `${c.said}/${c.real}`).join(', ')})`,
      );
      const dims = await page.evaluate(async () => {
        const out = [];
        for (const s of document.querySelectorAll('[data-dims]')) {
          const src = s.dataset.dims,
            said = s.textContent.match(/(\d+)\s*×\s*(\d+)/);
          const real = await new Promise((res) => {
            if (/\.mp4$/.test(src)) {
              const v = document.createElement('video');
              v.preload = 'metadata';
              v.muted = true;
              v.onloadedmetadata = () => res([v.videoWidth, v.videoHeight, v.duration]);
              v.onerror = () => res(null);
              v.src = src;
            } else {
              const im = new Image();
              im.onload = () => res([im.naturalWidth, im.naturalHeight]);
              im.onerror = () => res(null);
              im.src = src;
            }
          });
          out.push({ src, said: said && [+said[1], +said[2]], real });
        }
        return out;
      });
      const wrong = dims.filter((d) => !d.real || !d.said || d.said[0] !== d.real[0] || d.said[1] !== d.real[1]);
      t.ok(
        dims.length >= 8 && wrong.length === 0,
        `press: the ${dims.length} stated pixel sizes match the files${wrong.length ? ': ' + wrong.map((d) => `${d.src} says ${d.said} is ${d.real && d.real.slice(0, 2)}`).join('; ') : ''}`,
      );
      const film = dims.find((d) => /\.mp4$/.test(d.src));
      t.ok(
        film && film.real && Math.abs(film.real[2] - 30) < 1,
        `press: the film is about 30 s (${film && film.real && film.real[2].toFixed(1)} s)`,
      );
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll('[data-size-of]')].map((s) => s.textContent),
      );
      t.ok(
        sizes.length > 0 && sizes.every((s) => /\d+(\.\d)? (KB|MB)$/.test(s)),
        `press: every download shows its size (${sizes.join(', ')})`,
      );
      const ph = await page.evaluate(() => document.querySelectorAll('.placeholder').length);
      const mail = await page.evaluate(() => !!document.querySelector('#contact ~ p a[href^="mailto:"]'));
      t.ok(ph === 0 && mail, `press: no placeholders left, and the contact is an address (${ph} placeholders)`);
      const greens = await page.evaluate(
        () =>
          [...document.querySelectorAll('main *')].filter(
            (e) => !e.closest('.swatches') && getComputedStyle(e).backgroundColor === 'rgb(217, 243, 106)',
          ).length,
      );
      t.ok(
        greens === 0,
        'press: no leader green in the page body outside its swatch (nothing here is the one primary action)',
      );
    }
  }
  await o.close();
}

// ---- the landing page links to both
{
  const o = await open('/', { width: 1440 });
  const links = await o.page.evaluate(() => ({
    press: !!document.querySelector('footer a[href="/site/press/"]'),
    docs: !!document.querySelector('footer a[href="/site/docs/"]'),
    guide: !!document.querySelector('footer a[href="/site/docs/guide.html"]'),
  }));
  t.ok(
    links.press && links.docs && links.guide,
    `landing page footer links to the Guide, Docs and Press (guide ${links.guide}, press ${links.press}, docs ${links.docs})`,
  );
  await o.close();
}

// ---- words for any device: the hum's privacy line says "this device" (it may be a phone), and the landing pedal's
// hint starts with a drag before the keys
{
  const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sk = rd('app/src/ui/sketch.js'),
    pedal = rd('site/assets/pedal.js');
  t.ok(
    /The sound stays on this device; an agent you’ve connected can read the notes/.test(sk) &&
      !/nothing leaves this device/.test(sk) &&
      !/leaves this computer/.test(sk + rd('site/index.html')),
    'the hum says the sound stays on this device and a connected agent can read the notes (never "nothing leaves": get_capture reads them)',
  );
  t.ok(
    /Drag the knobs, or tab to one and use the arrow keys/.test(pedal),
    'the landing pedal\'s hint reads on a phone too ("Drag the knobs, or tab to one…")',
  );
}

// ---- the landing page under a finger: every pedal footswitch and footer link reaches 40 px tall to the touch at
// 390 (a tap 19 px above and below its middle still lands on it); at 1440 with a mouse the links are as drawn
{
  const reach = () => {
    const at = (el) => {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const q = el.getBoundingClientRect(),
        y = q.top + q.height / 2,
        x = q.left + q.width / 2;
      return [y - 19, y + 19].every((yy) => {
        const hit = document.elementFromPoint(x, yy);
        return hit === el || el.contains(hit);
      });
    };
    const foots = [...document.querySelectorAll('.face-foot')].filter((e) => e.getClientRects().length),
      links = [...document.querySelectorAll('.foot p a')];
    return {
      foots: foots.length,
      footMiss: foots.filter((e) => !at(e)).length,
      links: links.length,
      linkMiss: links.filter((e) => !at(e)).map((e) => e.textContent),
      linkH: Math.round(links[0]?.getBoundingClientRect().height || 0),
    };
  };
  const o = await open('/', { width: 390, height: 844 });
  const r = await o.page.evaluate(reach);
  t.ok(
    r.foots >= 4 && !r.footMiss && r.links >= 4 && !r.linkMiss.length,
    `at 390 the landing's ${r.foots} footswitches and ${r.links} footer links are 40 px tall to the touch (${r.footMiss} switches short${r.linkMiss.length ? '; short links: ' + r.linkMiss.join(', ') : ''})`,
  );
  await o.close();
  const d = await open('/', { width: 1440 });
  const dr = await d.page.evaluate(() =>
    Math.round(document.querySelector('.foot p a').getBoundingClientRect().height),
  );
  t.ok(dr < 30, `at 1440 with a mouse the footer links are as drawn (${dr} px)`);
  await d.close();
}

// ---- the community shelf's gallery (site/community/, docs/COMMUNITY-SHELF.md section 4): it reads the index through
// the reader's rules, draws faces from checked values only, plays a clip as a blob, fetches no device file, links into
// the studio, says less about a shelf that isn't the studio's own, reads nothing off a local host, and ships
// unlinked (deploy.sh carries it; no page links to it yet). The index is a fixture made here and served from memory, hostile
// entries included, so nothing real is committed and the bundled path (/app/community/) can be played too.
{
  console.log('\ncommunity shelf (site gallery)');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const { addRoute } = await import('../server/serve.js');
  const wav = (seconds, hz, sr = 8000) => {
    const n = Math.round(seconds * sr),
      b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + n * 2, 4);
    b.write('WAVE', 8);
    b.write('fmt ', 12);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(sr, 24);
    b.writeUInt32LE(sr * 2, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36);
    b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(4000 * Math.sin((2 * Math.PI * hz * i) / sr)), 44 + i * 2);
    return b;
  };
  const H = (c) => c.repeat(64);
  const clip = (name) => ({ clips: [{ src: `clips/${name}.wav`, type: 'audio/wav', bytes: 8044 }], pcm: H('0') });
  const meas = {
    ok: true,
    summary: 'ok',
    lufs: -20.9,
    deltaLU: 0,
    drumsDeltaLU: 0.1,
    truePeak: -5.7,
    tail: 1.48,
    cpu: 0.8,
    latencyMs: 0,
    deterministic: true,
    warnings: [],
    houseLevels: null,
  };
  const look = {
    color: '#2f3b46',
    ink: '#e8f1f7',
    shape: 'box',
    finish: 'brushed',
    knob: 'chrome',
    label: 'plate',
    led: '#7fd1ff',
  };
  const entry = (o) => ({
    id: 'test-person.slow-echo',
    name: 'Slow Echo',
    kind: 'effect',
    cat: 'time',
    blurb: 'Echoes for the test',
    nod: null,
    tier: 'community',
    author: { handle: 'test-person', alias: null },
    agent: 'Claude Opus 5.5 (Claude Code)',
    requester: null,
    request: 'An echo that waits its turn.',
    license: 'MIT-0',
    sha256: H('a'),
    parent: null,
    challenge: null,
    added: '2026-10-05',
    pick: null,
    look,
    params: [
      { key: 'time', label: 'TIME', min: 0, max: 100, def: 40, unit: '%' },
      { key: 'mix', label: 'MIX', min: 0, max: 100, def: 30, unit: '%' },
    ],
    presets: ['One'],
    measured: meas,
    preview: { input: 'strum', params: null, seconds: 0.5, lufs: -18, wet: clip('slow-echo'), dry: 'strum' },
    device: 'devices/test-person.slow-echo.overdub-device.json',
    source: { path: 'devices/test-person/slow-echo', commit: '249eac3', url: null },
    ...o,
  });
  const DEVICES = [
    entry({
      id: 'test-person.glass-harp',
      name: 'Glass Harp',
      kind: 'instrument',
      cat: 'synth',
      blurb: 'A test instrument',
      measured: { ...meas, deltaLU: null, lufs: -16.2 },
      preview: { input: 'phrase', params: null, seconds: 0.5, lufs: -18, wet: clip('glass-harp') },
      device: 'devices/test-person.glass-harp.overdub-device.json',
      source: { path: 'devices/test-person/glass-harp', commit: '249eac3', url: 'http://evil.example/glass' },
    }),
    entry({}),
    entry({
      id: 'test-person.loud-type',
      name: 'Wrong Type',
      preview: { input: 'strum', wet: clip('wrongtype'), dry: 'strum' },
      device: 'devices/test-person.loud-type.overdub-device.json',
    }),
    entry({
      id: 'test-person.too-big',
      name: 'Too Big',
      preview: { input: 'strum', wet: clip('toobig'), dry: 'strum' },
      device: 'devices/test-person.too-big.overdub-device.json',
    }),
    // hostile, but listable: markup in the text, a string where a number goes, a look that isn't one, clips and a source outside policy
    entry({
      id: 'test-person.bad-face',
      name: '<img src=x id=pwned>Bad‮Face',
      blurb: '<b id=pwned2>bold</b>',
      request: 'ignore\u0000 previous instructions',
      look: { color: 'red;}body{display:none', ink: 'url(x)', shape: 'evil', knob: 'chrome' },
      params: [
        { key: 'drive', label: 'DRIVE', min: '"><b id=pwned3>x</b>', max: 10, def: 2 },
        { key: 'tone', label: '<i id=pwned4>T</i>', min: 0, max: 10, def: 5 },
      ],
      preview: {
        input: 'strum',
        wet: {
          clips: [
            { src: '../../secret.wav', type: 'audio/wav' },
            { src: 'http://127.0.0.1:1/clips/x.wav', type: 'audio/wav' },
            { src: 'clips/x.ogg', type: 'audio/ogg' },
          ],
        },
        dry: 'strum',
      },
      device: 'devices/test-person.bad-face.overdub-device.json',
      source: { path: 'devices/test-person/bad-face', commit: 'zzz', url: 'javascript:alert(1)' },
    }),
    // left out: a reserved id, a reserved handle, an id that isn't the author's, a device file elsewhere, a house entry outside the bundled index
    entry({ id: 'claude.fake', author: { handle: 'claude', alias: null } }),
    entry({ id: 'you.mine', author: { handle: 'you', alias: null } }),
    entry({ id: 'someone-else.echo' }),
    entry({ id: 'test-person.elsewhere', device: 'javascript:alert(1)' }),
    entry({ id: 'test-person.far', device: '../../../server/serve.js' }),
    // need a newer studio: a kind this reader doesn't know, a required field missing
    entry({ id: 'test-person.midi-thing', kind: 'midi' }),
    entry({ id: 'test-person.no-sha', sha256: undefined }),
    { id: 'test-person.nothing' },
  ];
  const HOUSE = entry({
    id: 'claude.test-room',
    name: 'Test Room',
    cat: 'ambient',
    tier: 'house',
    author: { handle: 'claude', alias: null },
    agent: 'Claude',
    measured: { ...meas, houseLevels: true },
    preview: { input: 'strum', wet: clip('test-room'), dry: 'strum' },
    device: 'devices/claude.test-room.overdub-device.json',
    source: { path: 'devices/house/test-room', commit: '249eac3', url: null },
  });
  const index = (devices, extra = {}) =>
    JSON.stringify(
      {
        format: 'overdub-community-index/1',
        built: {
          from: 'overdub-devices@3db8843',
          at: '2026-10-05T16:21:09Z',
          studio: 'overdub@test',
          node: 'v24',
          checker: 'checkDeviceNode',
          checks: null,
          encoder: 'none',
        },
        repo: null,
        inputs: { strum: { seconds: 0.5, lufs: -18, ...clip('strum') }, zither: { seconds: 1, ...clip('strum') } },
        revoked: [],
        devices,
        unknownTop: { x: 1 },
        ...extra,
      },
      null,
      2,
    );
  const FIX = {
    'community-index.json': ['application/json', index([...DEVICES, HOUSE])],
    'newer.json': ['application/json', JSON.stringify({ format: 'overdub-community-index/2', devices: [] })],
    'clips/strum.wav': ['audio/wav', wav(0.5, 220)],
    'clips/slow-echo.wav': ['audio/wav', wav(0.5, 330)],
    'clips/glass-harp.wav': ['audio/wav', wav(0.5, 440)],
    'clips/test-room.wav': ['audio/wav', wav(0.5, 550)],
    'clips/wrongtype.wav': ['text/html', wav(0.5, 660)],
    'clips/toobig.wav': ['audio/wav', wav(140, 220)],
  };
  let served = true;
  const hits = [];
  const serveFix = (prefix) => (req, res, url) => {
    if (!served) return false;
    const rel = url.pathname.slice(prefix.length);
    hits.push(url.pathname);
    const f = FIX[rel];
    if (!f) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no');
      return true;
    }
    res.writeHead(200, {
      'content-type': f[0],
      'content-length': String(Buffer.byteLength(f[1])),
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : f[1]);
    return true;
  };
  addRoute('/app/community/', serveFix('/app/community/')); // the studio's own copy (bundled)
  addRoute('/fixture-shelf/', serveFix('/fixture-shelf/')); // another index on this site
  const real = (errs) => errs;
  const SHELF = '/site/community/';
  const look_ = async (page) =>
    page.evaluate(() => {
      const W = window.__community || {};
      const ent = [...document.querySelectorAll('.cs-entry')];
      return {
        ready: !!W.ready,
        reader: W.reader,
        off: !!W.off,
        refused: !!W.refused,
        newer: !!W.newer,
        ids: ent.map((e) => e.dataset.id),
        tiers: ent.map((e) => e.dataset.tier),
        house: !!document.querySelector('.cs-sec[data-tier="house"]'),
        lede: document.getElementById('lede').textContent,
        line: document.getElementById('shelf-line').textContent,
        empty: document.querySelector('.cs-empty')?.textContent || '',
        says: document.querySelectorAll('.cs-says').length,
        vouch: [...document.querySelectorAll('.cs-small')].filter((p) => /A person read it/.test(p.textContent)).length,
        links: Object.fromEntries(ent.map((e) => [e.dataset.id, e.querySelector('.cs-open')?.getAttribute('href')])),
        lands: Object.fromEntries(ent.map((e) => [e.dataset.id, e.querySelector('.cs-lands')?.textContent])),
        plays: Object.fromEntries(ent.map((e) => [e.dataset.id, e.querySelector('.cs-play b')?.textContent || null])),
        warm: [...document.querySelectorAll('.cs-credit .by-human')].map((b) => getComputedStyle(b).color),
        cool: [...document.querySelectorAll('.cs-credit .by-agent')].map((b) => getComputedStyle(b).color),
        pwned: ['pwned', 'pwned2', 'pwned3', 'pwned4'].filter((id) => document.getElementById(id)),
        bad: (() => {
          const e = document.querySelector('.cs-entry[data-id="test-person.bad-face"]');
          if (!e) return null;
          const dials = [...e.querySelectorAll('.cs-face [aria-valuemin]')].map((d) => [
            d.getAttribute('aria-valuemin'),
            d.getAttribute('aria-valuemax'),
          ]);
          return {
            name: e.querySelector('h3').textContent,
            dials,
            numbers: dials.every(([a, b]) => Number.isFinite(+a) && Number.isFinite(+b)),
            src: e.querySelector('.cs-paper a') ? 'link' : 'text',
            play: !!e.querySelector('.cs-play'),
            inert: e.querySelector('.cs-face').inert,
          };
        })(),
        evil: (() => {
          const e = document.querySelector('.cs-entry[data-id="test-person.glass-harp"]');
          return e ? { link: !!e.querySelector('.cs-paper a') } : null;
        })(),
        faces:
          document.querySelectorAll('.cs-face .ewf').length + document.querySelectorAll('.cs-face [data-face]').length,
      };
    });

  // the studio's own copy, at 1440 and 390
  for (const width of [1440, 390]) {
    hits.length = 0;
    const o = await open(SHELF, { width, height: width < 600 ? 844 : 900 });
    const requests = [];
    o.page.on('request', (r) => requests.push(r.url()));
    await o.page.waitForFunction(() => window.__community?.ready, null, { timeout: 15000 }).catch(() => {});
    await o.page.evaluate(() => document.fonts.ready);
    const s = await look_(o.page);
    await o.page.screenshot({ path: path.join(OUTDIR, `pages-community-${width}.png`), fullPage: width < 600 });
    const ov = await o.page.evaluate(() => ({
      W: document.documentElement.clientWidth,
      sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    }));
    t.ok(ov.sw <= ov.W, `${SHELF} @${width}: no horizontal scroll (page ${ov.sw} px in ${ov.W} px)`);
    if (width === 1440) {
      const comm = [
        'test-person.glass-harp',
        'test-person.slow-echo',
        'test-person.loud-type',
        'test-person.too-big',
        'test-person.bad-face',
      ];
      t.ok(
        s.ready &&
          comm.every((id) => s.ids.includes(id)) &&
          s.ids.includes('claude.test-room') &&
          s.ids.length === comm.length + 1,
        `the gallery lists the bundled index's ${comm.length} community entries and its House one, and nothing the reader leaves out (${s.ids.length}: ${s.ids.join(', ')})`,
      );
      t.ok(
        s.reader === 'shared',
        `the gallery reads through the studio's one reader, app/src/devices/community.js (${s.reader})`,
      );
      t.ok(
        /The copy that came with this studio: 5 devices, built 5 Oct\./.test(s.line) &&
          /3 more need a newer studio\./.test(s.line) &&
          /5 more were left out\./.test(s.line),
        `the shelf line says where the index came from, its count read from the index, and what was skipped ("${s.line}")`,
      );
      t.ok(
        s.house && /read by a person/.test(s.lede) && s.vouch >= 1 && !s.says,
        `the bundled index is taken at its word: a House section, the "checked and read" lede and the reviewed line (${s.vouch}), no "The shelf says"`,
      );
      t.ok(
        s.warm.length >= 4 &&
          s.warm.every((c) => c === 'rgb(255, 160, 67)') &&
          s.cool.length >= 4 &&
          s.cool.every((c) => c === 'rgb(76, 195, 255)'),
        `credits are bylines: the author warm, the agent cool (${s.warm.length} warm, ${s.cool.length} cool)`,
      );
      t.ok(
        s.links['test-person.slow-echo'] === '/app/?new&community-device=test-person.slow-echo' &&
          s.links['claude.test-room'] === '/app/?new&device=claude.test-room' &&
          /Opens Night Shift with Slow Echo ready to try on the Hook\./.test(s.lands['test-person.slow-echo']) &&
          /ready to try on the Keys\./.test(s.lands['test-person.glass-harp']),
        `Open in the studio links to /app/?new&community-device=<id> (House: ?new&device=) and says where it lands ("${s.lands['test-person.slow-echo']}")`,
      );
      t.ok(
        s.plays['test-person.slow-echo'] === 'On a strum' && s.plays['test-person.glass-harp'] === 'Hear it',
        `▶ names the input (${s.plays['test-person.slow-echo']}, ${s.plays['test-person.glass-harp']})`,
      );
      t.ok(
        s.bad &&
          !s.pwned.length &&
          s.bad.numbers &&
          s.bad.dials.length === 1 &&
          /<img/.test(s.bad.name) &&
          !/‮/.test(s.bad.name) &&
          s.bad.inert &&
          !s.bad.play &&
          s.bad.src === 'text' &&
          s.evil &&
          !s.evil.link,
        `the hostile entry renders numbers or nothing in its face (dials ${JSON.stringify(s.bad?.dials)}), its markup as text, no clip outside policy, and no link that isn't https on an allowed host (${s.pwned.length} injected elements)`,
      );
      t.ok(s.faces >= 6, `every entry draws its face from the reader's output (${s.faces})`);

      // a clip: fetched as a blob only on ▶, looped, at half volume; Dry swaps to the input; no device file is fetched
      await o.page.click('.cs-entry[data-id="test-person.slow-echo"] .cs-play');
      await o.page
        .waitForFunction(
          () => window.__community.player.audio && window.__community.player.audio.currentTime > 0.05,
          null,
          { timeout: 8000 },
        )
        .catch(() => {});
      const p1 = await o.page.evaluate(() => {
        const a = window.__community.player.audio;
        return (
          a && {
            blob: a.src.startsWith('blob:'),
            t: a.currentTime,
            loop: a.loop,
            vol: a.volume,
            state: document.querySelector('.cs-entry[data-id="test-person.slow-echo"]').dataset.state,
          }
        );
      });
      await o.page.click('.cs-entry[data-id="test-person.slow-echo"] .cs-tog');
      await o.page.waitForTimeout(400);
      const p2 = await o.page.evaluate(() => {
        const a = window.__community.player.audio;
        return a && { blob: a.src.startsWith('blob:'), playing: !a.paused };
      });
      const strum = hits.filter((x) => /clips\/strum\.wav$/.test(x)).length;
      t.ok(
        p1 && p1.blob && p1.t > 0.05 && p1.loop && p1.vol <= 0.5 && p1.state === 'playing' && p2?.playing && strum >= 1,
        `▶ plays the clip from a blob: URL, looped, at half volume or less (${p1 ? p1.vol.toFixed(2) : 'no audio'}); Dry swaps to the input clip and keeps playing`,
      );
      await o.page.click('.cs-entry[data-id="test-person.slow-echo"] .cs-play');
      for (const id of ['test-person.loud-type', 'test-person.too-big'])
        await o.page.click(`.cs-entry[data-id="${id}"] .cs-play`);
      await o.page.waitForTimeout(600);
      const refusedClips = await o.page.evaluate(() =>
        ['test-person.loud-type', 'test-person.too-big'].map((id) => {
          const e = document.querySelector(`.cs-entry[data-id="${id}"]`);
          return [e.dataset.state, e.querySelector('.cs-hint').textContent];
        }),
      );
      t.ok(
        refusedClips.every(([st, hint]) => st !== 'playing' && /Couldn’t play it/.test(hint)),
        `a clip served as something other than audio, or over 2 MB, isn't played (${refusedClips.map(([, h]) => h).join(' / ')})`,
      );
      const deviceFiles = requests.filter(
        (u) => /\/(app\/community|fixture-shelf)\/devices\//.test(u) || /overdub-device\.json/.test(u),
      );
      t.ok(!deviceFiles.length, `the gallery fetches no device file, before or after ▶ (${deviceFiles.length})`);
      // search: words in the name, blurb or category
      await o.page.fill('#q', 'delay');
      const q = await o.page.evaluate(() =>
        [...document.querySelectorAll('.cs-entry')].filter((e) => !e.hidden).map((e) => e.dataset.id),
      );
      await o.page.fill('#q', '');
      await o.page.click('#kind button[data-v="instrument"]');
      const k = await o.page.evaluate(() =>
        [...document.querySelectorAll('.cs-entry')].filter((e) => !e.hidden).map((e) => e.dataset.id),
      );
      t.ok(
        q.length >= 4 &&
          !q.includes('test-person.glass-harp') &&
          k.length === 1 &&
          k[0] === 'test-person.glass-harp' &&
          /[?&]kind=instrument/.test(o.page.url()),
        `search matches a category's name ("delay": ${q.length}), and the kind words filter (${k.join(', ')})`,
      );
    }
    const errs = real(o.errors);
    t.ok(
      !errs.length,
      `${SHELF} @${width}: no console or page errors${errs.length ? '\n       ' + errs.join('\n       ') : ''}`,
    );
    await o.close();
  }

  // another index (a path on this site): no House, no vouching, the source named, the link carries it
  {
    const o = await open(SHELF + '?community=/fixture-shelf/community-index.json', { width: 1440 });
    await o.page.waitForFunction(() => window.__community?.ready, null, { timeout: 15000 }).catch(() => {});
    const s = await look_(o.page);
    t.ok(
      s.ready &&
        !s.house &&
        !s.tiers.includes('house') &&
        !/read by a person|checked by the studio/.test(s.lede) &&
        /that shelf’s word/.test(s.lede) &&
        s.says >= 4 &&
        !s.vouch &&
        /^From \/fixture-shelf\/community-index\.json: 5 devices/.test(s.line),
      `an index that isn't the studio's own: no House section, the lede names it and drops "checked and read", numbers under "The shelf says" ("${s.line}")`,
    );
    t.ok(
      s.links['test-person.slow-echo'] ===
        `/app/?new&community-device=test-person.slow-echo&community=${encodeURIComponent(o.base + '/fixture-shelf/community-index.json')}`,
      `Open in the studio carries &community= for another index (${s.links['test-person.slow-echo']})`,
    );
    t.ok(
      !real(o.errors).length,
      `?community=: no console or page errors${real(o.errors).length ? '\n       ' + real(o.errors).join('\n       ') : ''}`,
    );
    await o.close();
  }
  // a newer major, another site, and a page that isn't on localhost
  {
    const o = await open(SHELF + '?community=/fixture-shelf/newer.json', { width: 1440 });
    await o.page.waitForFunction(() => window.__community?.ready, null, { timeout: 15000 }).catch(() => {});
    const s = await look_(o.page);
    await o.close();
    const p = await open(SHELF + '?community=' + encodeURIComponent('https://example.com/community-index.json'), {
      width: 1440,
    });
    const asked = [];
    p.page.on('request', (r) => {
      if (/example\.com/.test(r.url())) asked.push(r.url());
    });
    await p.page.waitForFunction(() => window.__community?.ready, null, { timeout: 15000 }).catch(() => {});
    const r = await look_(p.page);
    // the same page as a visitor on another host would see it (proxied to this server): the shelf is off there
    const port = new URL(p.base).port;
    const ctx = await p.browser.newContext({ viewport: { width: 1440, height: 900 } });
    const askedOff = [];
    await ctx.route('http://shelf.test/**', async (route) => {
      const u = new URL(route.request().url());
      if (/community|fixture-shelf/.test(u.pathname) && /\.json$/.test(u.pathname)) askedOff.push(u.pathname);
      const res = await fetch(`http://localhost:${port}${u.pathname}${u.search}`);
      route.fulfill({
        status: res.status,
        headers: Object.fromEntries(res.headers),
        body: Buffer.from(await res.arrayBuffer()),
      });
    });
    const pg = await ctx.newPage();
    await pg.goto('http://shelf.test' + SHELF + '?community=/fixture-shelf/community-index.json', {
      waitUntil: 'load',
    });
    await pg.waitForFunction(() => window.__community?.ready, null, { timeout: 15000 }).catch(() => {});
    const off = await look_(pg);
    await p.close();
    t.ok(
      s.newer && /built for a newer studio/.test(s.empty) && !s.ids.length,
      `a major-2 index lists nothing and says it was built for a newer studio`,
    );
    t.ok(
      r.refused && !asked.length && /from this site or from localhost only/.test(r.empty),
      `?community= on another site is refused before any fetch (${asked.length} requests)`,
    );
    t.ok(
      off.off && !off.ids.length && !askedOff.length && /isn’t on here/.test(off.empty),
      `on a host that isn't localhost the shelf is off: no index read, whatever ?community= says (${askedOff.length} index requests)`,
    );
  }
  served = false;

  // shipped but quiet: the deploy carries the page (AJ, 2026-10-06), nothing links to it yet, the studio's snapshot is
  // never committed, and the page's switch is the studio's (off: away from localhost it reads nothing)
  const sitePages = fs
    .readdirSync(path.join(ROOT, 'site'), { recursive: true })
    .filter((f) => /\.(html|txt|js|md)$/.test(f) && !f.startsWith('community'))
    .map((f) => `site/${f}`);
  const linking = [...sitePages, 'README.md', 'app/index.html', 'app/library.html'].filter((f) =>
    /site\/community|\/community\/["'#?]/.test(read(f)),
  );
  t.ok(!linking.length, `no page links to the gallery yet${linking.length ? ' (' + linking.join(', ') + ')' : ''}`);
  const deploy = read('deploy/deploy.sh');
  const held = (deploy.match(/^HELD_BACK=\(([^)]*)\)/m) || [])[1] || '';
  t.ok(
    /^HELD_BACK=\(/m.test(deploy) && !/\bsite\/community\b/.test(held),
    `deploy.sh ships site/community: it isn't in HELD_BACK (${held.trim() || 'empty'})`,
  );
  t.ok(
    /^\/?app\/community\/?$/m.test(read('.gitignore')),
    "app/community/ (the studio's built snapshot) is in .gitignore",
  );
  const ui = path.join(ROOT, 'app/src/ui/community.js');
  const pageLive = /export const COMMUNITY_LIVE = (true|false)/.exec(read('site/community/community.js'))?.[1];
  const studioLive = fs.existsSync(ui)
    ? /COMMUNITY_LIVE\s*=\s*(true|false)/.exec(fs.readFileSync(ui, 'utf8'))?.[1]
    : null;
  t.ok(
    pageLive === 'false' && (studioLive == null || studioLive === pageLive),
    `the gallery's COMMUNITY_LIVE is off${studioLive ? ` and matches the studio's (${studioLive})` : " (the studio's switch isn't in this tree yet)"}`,
  );
  // its words: nothing sold, nothing called safe
  const copy =
    read('site/community/index.html') +
    [...read('site/community/community.js').matchAll(/(['`])((?:(?!\1).){12,})\1/g)].map((m) => m[2]).join('\n');
  const banned = [
    ...copy.matchAll(/\b(safe|secure|sandboxed|verified|marketplace|buy|price[sd]?|free trial|checkout|rating)\b/gi),
  ].map((m) => m[0]);
  t.ok(
    !banned.length,
    `the gallery's copy says nothing about safety, verification or selling${banned.length ? ' (' + [...new Set(banned)].join(', ') + ')' : ''}`,
  );
}

// ---- claims: what the public copy, the deck and the launch drafts say is still true of the product
{
  console.log('\nclaims');
  const at = (f) => (fs.existsSync(path.join(ROOT, f)) ? path.join(ROOT, f) : path.join(PRIV, f));
  const read = (f) => fs.readFileSync(at(f), 'utf8');
  const md = (dir) =>
    fs
      .readdirSync(at(dir))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `${dir}/${f}`);
  const PRIVATE = HAS_PRIV ? ['deck/index.html', 'docs/STRATEGY.md', ...md('docs/launch')] : [];
  if (!HAS_PRIV) console.log('  (no overdub-private beside this repo: the deck and launch drafts are not checked)');
  // Everything that speaks for Overdub.
  const COPY = [
    'site/index.html',
    'site/press/index.html',
    'site/llms.txt',
    ...DOCS.map((d) => `site/docs/${d.slug}.html`),
    'site/docs/index.html',
    'README.md',
    'app/index.html',
    'integrations/README.md',
    // (dated records keep the numbers that were true when they were written: the fresh-eyes reports)
    ...md('docs').filter((f) => !/FRESH-EYES/.test(f)),
    ...PRIVATE.filter((f) => f !== 'docs/STRATEGY.md'),
  ];
  const text = Object.fromEntries(COPY.map((f) => [f, read(f)]));
  const plain = (s) =>
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/g, ' ');
  const hits = (re, files = COPY) =>
    files.flatMap((f) =>
      [...text[f].matchAll(re)].map((m) => `${f}: "${m[0].replace(/\s+/g, ' ').trim().slice(0, 90)}"`),
    );
  const say = (list) => (list.length ? ':\n       ' + list.join('\n       ') : '');

  // Browsers: Safari, Firefox and phones pass tools/compat-test.js, so nothing says Chrome only.
  const chrome = hits(
    /Chrome (only|is the target)|runs in Chrome(?![,\s]+(Safari|Edge))|\bUse Chrome\b|in Chrome(, for now| for now|,? nothing to install)|Chrome on a (desktop|laptop|computer)|\(and Chrome, for now\)|studio in Chrome|Yes to both, in Chrome|Free, in Chrome/g,
  );
  t.ok(
    !chrome.length,
    `no copy says Overdub is Chrome-only (compat-test covers WebKit, Firefox and a phone)${say(chrome)}`,
  );
  // ... nor do the notes that steer the work (CLAUDE.md), nor the studio's own errors (Firefox has Web MIDI; a missing
  // getUserMedia is usually a page served over plain http, not the browser)
  const appSrc = fs
    .readdirSync(path.join(ROOT, 'app/src'), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => [`app/src/${f}`, read(path.join('app/src', f))]);
  const steer = [['CLAUDE.md', read('CLAUDE.md')], ...appSrc].flatMap(([f, s]) =>
    [...s.matchAll(/Chrome (only|is the target)|\bTry Chrome\b|use Chrome or Edge(?!,? or Firefox)/g)].map(
      (m) => `${f}: "${m[0]}"`,
    ),
  );
  t.ok(!steer.length, `CLAUDE.md and the studio's messages don't steer to Chrome alone${say(steer)}`);

  // Kernels: the worklet scope is a rule for determinism, not a security boundary, and share links carry strangers'
  // kernels. "Sandbox" may only appear about the future (WASM, iframes) or to say it is not one.
  const sandbox = COPY.flatMap((f) => {
    const s = plain(text[f]);
    return [...s.matchAll(/sandbox(ed|ing)?/gi)]
      .map((m) => {
        const a = Math.max(s.lastIndexOf('.', m.index), s.lastIndexOf('\n\n', m.index)) + 1;
        const b = s.indexOf('.', m.index + 1);
        return {
          f,
          sentence: s
            .slice(a, b < 0 ? undefined : b)
            .replace(/\s+/g, ' ')
            .trim(),
        };
      })
      .filter((x) => !/WASM|iframe|not a (security )?(sandbox|boundary)/i.test(x.sentence))
      .map((x) => `${x.f}: "${x.sentence.slice(0, 110)}"`);
  });
  const security = hits(/gives security|security and determinism/gi);
  t.ok(
    !sandbox.length && !security.length,
    `no copy calls kernels sandboxed or secure (only WASM, later, would be)${say([...sandbox, ...security])}`,
  );

  // MCP: a visitor's tab on the live site can't be driven over MCP (the bridge is localhost-only and the relay is off),
  // so wherever the landing page mentions MCP, the same paragraph says it needs a local copy.
  const landing = text['site/index.html'];
  const mcpParas = [...landing.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => plain(m[2]))
    .filter((p) => /\bMCP\b/.test(p));
  const uncaveated = mcpParas.filter((p) => !/own computer|locally|local copy|isn(’|')t public/.test(p));
  t.ok(
    mcpParas.length > 0 && !uncaveated.length,
    `the landing page's MCP copy says it needs a local copy (${mcpParas.length} paragraph(s))${say(uncaveated.map((p) => `"${p.replace(/\s+/g, ' ').trim().slice(0, 100)}"`))}`,
  );

  // Retired claims, each wrong for a reason the product or the source makes plain.
  const RETIRED = [
    [/learns what it means to you/gi, 'no personal lexicon yet: the agent asks which one you mean'],
    [/Drum on the desk or the space bar/gi, 'Space plays and stops; tapping is F J K L, the pads or the mic'],
    [
      /stay out of the red|never go silent|as loud as what went in|is it (about )?as loud as its input/gi,
      'the device check refuses compile errors, NaN, runaways and stuck notes; loudness and silence are warnings',
    ],
    [/refiled 18 Sept/gi, 'UMG and Sony filed a second suit; nothing was refiled'],
    [
      /absolutely terrible[”"]? for creative work|for three reasons: the agent can(’|')t hear/gi,
      'the write-up never said it; a commenter did, about mixing commands',
    ],
    [/most-discussed write-up/gi, 'a Show HN for an Ableton MCP had more points: say widely read'],
    [
      /Practitioners report the same three problems/gi,
      'the three problems are our landscape review, not a practitioner report',
    ],
    [/edit accuracy (lost|fell|falls)|lose 39 to 52%/gi, 'RIME measured edit similarity, for two small models'],
    [/object model has no render/gi, 'the Extensions SDK beta can bounce a track to WAV'],
    [/the README already says MIT/gi, 'the licence is undecided'],
    [/not there yet: Safari|sharing songs or devices by link/gi, 'Safari, Firefox and share links shipped'],
    [/The mark \(spiral\)/g, 'the mark is the Weave'],
    [
      /\b515\b[^.\n|]{0,30}tools|openDAW(’|')s 515/gi,
      'opendaw-mcp lists 543 tools in full mode (and has a 39-tool lite mode): say 500+',
    ],
    [/the song it ships with|(3|three) in the demo song/gi, 'four demo songs ship: Night Shift is the first'],
    [/rings past 4 s|true peak −10\.8/gi, "Tidal Cathedral's device check: no warnings, true peak −6 dBTP"],
    [/Claude played a part over it/gi, 'the demo songs are staged: a build script wrote and signed every part'],
    [/no server (ever )?sees it/gi, "only Overdub's servers never see a link; whatever carries it does"],
  ];

  // Share links carry kernels, which are code: wherever a newcomer reads about sharing (the landing page's share note,
  // the guide's Share and fork), the same passage says so.
  {
    const shareNote = plain((landing.match(/<p class="rn-tag">Share<\/p>([\s\S]*?)<\/li>/) || ['', ''])[1]);
    const guideShare = (read('docs/GUIDE.md').match(/## Share and fork([\s\S]*?)\n## /) || ['', ''])[1];
    const bad = [
      ['site/index.html share note', shareNote],
      ['docs/GUIDE.md Share and fork', guideShare],
    ]
      .filter(([, x]) => !/\bcode\b/.test(x) || !/trust/.test(x) || !/Overdub(’|')s servers/.test(x))
      .map(([f]) => f);
    t.ok(
      !bad.length,
      `the share copy says links carry code, to open them from people you trust, and that only Overdub's servers never see them${bad.length ? ' (not in: ' + bad.join(', ') + ')' : ''}`,
    );
  }
  for (const [re, why] of RETIRED) {
    const h = hits(re);
    t.ok(!h.length, `retired claim gone (${why})${say(h)}`);
  }
  // The in-browser API key is gone (agent/claude.js): no public copy offers to keep one in the browser. (The private
  // launch drafts change with the release that ships this.)
  {
    const pub = COPY.filter((f) => !PRIVATE.includes(f));
    const byok = hits(
      /paste (an |your )?(Anthropic )?API key|bring[- ]your[- ]own[- ]key|\bBYOK\b|own (Claude|Anthropic) (API )?key|key (stays|is kept|kept) in (this|that|your) browser|keyless demo/gi,
      pub,
    );
    t.ok(
      !byok.length,
      `no public copy offers an API key kept in the browser (the studio keeps none; a self-hoster's stays on their server)${say(byok)}`,
    );
  }

  // The tap lane names the keys input/tap.js actually listens to.
  const { ROWS } = await import('../app/src/input/tap.js');
  const lane = (landing.match(/<h3>Tap it<\/h3><p>([^<]*)<\/p>/) || [])[1] || '';
  const keys = ROWS.map((r) => r.hint);
  t.ok(
    keys.every((k) => new RegExp(`\\b${k}\\b`).test(lane)) && !/space bar/i.test(lane),
    `the Tap lane names the tap keys (${keys.join(' ')}): "${lane}"`,
  );

  // Tool counts: every number stated next to "tools" matches the studio as it loads, and the agents doc lists them all.
  const o = await open('/app/', { width: 1280 });
  await o.page
    .waitForFunction(
      () =>
        window.overdub?.tools?.list?.().includes('share_link') &&
        window.overdub.tools.list().includes('provenance_report'),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
  const live = await o.page.evaluate(() => window.overdub.tools.list());
  await o.close();
  const stated = COPY.flatMap((f) => [
    ...[...text[f].matchAll(/\b(\d+)(?:\s|&nbsp;)+(?:(?:agent|task-shaped|MCP)\s+)?tools\b/g)].map((m) => [f, +m[1]]),
    ...[...text[f].matchAll(/data-tool-count[^>]*>(\d+)</g)].map((m) => [f, +m[1]]),
  ]).filter(([, n]) => n !== 543); // openDAW's third-party MCP, in full mode
  // and in words ("Twenty-three agent tools", "about twenty tools"), which the digits above miss
  const UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = (w) => {
    const [tens, unit = ''] = w.toLowerCase().split('-');
    return (tens === 'thirty' ? 30 : 20) + UNITS.indexOf(unit);
  };
  for (const f of COPY)
    for (const m of plain(text[f]).matchAll(
      /\b(?:about\s+)?((?:twenty|thirty)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?)\s+(?:(?:agent|task-shaped|MCP)\s+)?tools\b/gi,
    ))
      stated.push([f, word(m[1])]);
  const off = stated.filter(([, n]) => n !== live.length);
  t.ok(
    live.length >= 20 && stated.length >= 5 && !off.length,
    `every stated tool count is the studio's ${live.length} (${stated.length} places)${say(off.map(([f, n]) => `${f} says ${n}`))}`,
  );
  const table = (read('docs/AGENTS.md').match(/## The tools[\s\S]*?\n## /) || [''])[0];
  const unlisted = live.filter((n) => !table.includes('`' + n + '`'));
  t.ok(
    !unlisted.length,
    `docs/AGENTS.md's tool table lists all ${live.length} tools${unlisted.length ? ' (missing: ' + unlisted.join(', ') + ')' : ''}`,
  );

  // Built-in device counts: every number stated for the built-ins ("32 built-in instruments and effects", "32
  // built-ins", the press kit's counts, "19 instruments and 13 effects") is the shelf's. The launch drafts are noted.
  {
    const B = await import('../app/src/devices/builtin/index.js');
    const want = { all: B.BUILTINS.length, inst: B.INSTRUMENTS.length + B.SAMPLED.length, fx: B.EFFECTS.length };
    const said = (f) => {
      const x = text[f],
        out = [];
      for (const m of x.matchAll(/\b(\d+)(?:\s|&nbsp;)+built-in(?:s\b|\s+(?:instruments and effects|devices))/g))
        out.push([+m[1], want.all, m[0]]);
      for (const m of x.matchAll(/<dt>Built-in (?:devices|instruments and effects)<\/dt><dd>(\d+)/g))
        out.push([+m[1], want.all, m[0]]);
      for (const m of x.matchAll(/\b(\d+) instruments and (\d+) effects/g))
        out.push([+m[1] + '+' + m[2], want.inst + '+' + want.fx, m[0]]);
      return out.filter(([n, w]) => n !== w).map(([, , m]) => `${f}: "${m.replace(/\s+/g, ' ')}"`);
    };
    const pub = COPY.filter((f) => !PRIVATE.includes(f)),
      priv = COPY.filter((f) => PRIVATE.includes(f));
    const n = pub.reduce((k, f) => k + [...text[f].matchAll(/built-in/gi)].length, 0);
    const bad = pub.flatMap(said);
    t.ok(
      n >= 5 && !bad.length,
      `every stated count of built-in devices is the shelf's ${want.all} (${want.inst} instruments, ${want.fx} effects)${say(bad)}`,
    );
    const stale = priv.flatMap(said);
    if (stale.length)
      t.note(`launch drafts with another built-in count (overdub-private):\n       ${stale.join('\n       ')}`);
  }

  // The bench slide's device check is Tidal Cathedral's real report: the one the device library shows (reports.js,
  // kernel/check.js in full mode), not a separate render. A warning on the slide only if the check gave one.
  if (HAS_PRIV) {
    const { REPORTS } = await import('../app/src/devices/library/reports.js');
    const rep = REPORTS['claude.tidal-cathedral'];
    const dl = (text['deck/index.html'].match(/<dl class="check">([\s\S]*?)<\/dl>/) || [])[1] || '';
    const dd = Object.fromEntries(
      [...dl.matchAll(/<dt>([^<]+)<\/dt><dd class="(\w+)">([^<]+)<\/dd>/g)].map((m) => [
        m[1],
        { cls: m[2], v: m[3].replace(/−/g, '-') },
      ]),
    );
    const num = (k, i = 0) => +(dd[k]?.v.match(/-?\d+(?:\.\d+)?/g) || [])[i];
    const wet = num('Level vs dry'),
      dry = num('Level vs dry', 1),
      tp = num('True peak'),
      tail = num('Tail');
    const warns = Object.values(dd).filter((x) => x.cls === 'warn').length;
    const near = (x, y) => Math.abs(x - y) < 0.051;
    t.ok(
      rep &&
        near(wet, rep.lufs) &&
        near(dry, rep.lufs - rep.deltaLU) &&
        near(tp, rep.truePeak) &&
        near(tail, rep.tail) &&
        warns === rep.warnings,
      `the deck's Tidal Cathedral check is the library's report (deck ${wet}/${dry} LUFS, ${tp} dBTP, tail ${tail} s, ${warns} warning(s); report ${rep?.lufs}/${rep && +(rep.lufs - rep.deltaLU).toFixed(1)}, ${rep?.truePeak}, ${rep?.tail} s, ${rep?.warnings})`,
    );
  }

  // Test counts: wherever a number of suites or checks is stated, they agree, and no more suites are claimed than exist.
  const COUNTED = PRIVATE;
  for (const f of COUNTED) text[f] ??= read(f);
  const nums = (re) => COUNTED.flatMap((f) => [...text[f].matchAll(re)].map((m) => [f, +m[1].replace(/,/g, '')]));
  const suites = nums(/\b(\d+)\s*(?:<\/?[a-z][^>]*>\s*)*(?:automated\s+)?(?:test\s+)?suites\b/g);
  const checks = nums(/\b(\d{1,3}(?:,\d{3})+|\d{3,})\s*(?:<\/?[a-z][^>]*>\s*)*checks\b/g);
  const files = fs.readdirSync(HERE).filter((f) => /-test\.js$/.test(f)).length;
  const one = (xs) => new Set(xs.map(([, n]) => n)).size === 1;
  if (COUNTED.length)
    t.ok(
      suites.length >= 3 && one(suites) && suites[0][1] === files,
      `stated suite counts agree and are today's (${[...new Set(suites.map(([, n]) => n))].join(' / ')} stated; ${files} suites exist)${one(suites) ? '' : say(suites.map(([f, n]) => `${f}: ${n}`))}`,
    );
  if (COUNTED.length)
    t.ok(
      checks.length >= 3 && one(checks),
      `stated check counts agree (${[...new Set(checks.map(([, n]) => n))].join(' / ')})${one(checks) ? '' : say(checks.map(([f, n]) => `${f}: ${n}`))}`,
    );
  // ... and are close to the last full run's (node tools/run-all.js leaves its totals in tools/.out/run-all.json): never
  // more checks than ran, and recounted once the suite has grown by a tenth. "Some checks failed" caveats go once it passed.
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync(path.join(HERE, '.out', 'run-all.json'), 'utf8'));
  } catch {
    /* no full run here yet */
  }
  if (last && checks.length) {
    const q = checks[0][1];
    t.ok(
      q <= last.checks && q >= 0.9 * last.checks,
      `the stated ${q.toLocaleString('en')} checks match the last full run (${last.checks} in ${last.suites} suites, ${last.at.slice(0, 10)}): recount if not`,
    );
  } else console.log('  (no tools/.out/run-all.json: run node tools/run-all.js to hold the check count to a real run)');
  const caveat = hits(/some checks failed|some checks fail|re-?run [^.]*before quoting a pass rate/gi, COUNTED);
  t.ok(
    !(last && last.fails === 0 && last.passed === last.suites) || !caveat.length,
    `no stale "some checks failed" caveat after a clean full run${say(caveat)}`,
  );
}

// ---- the guide: first in the docs, and what it tells a newcomer to press is really there
{
  console.log('\nguide');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const guide = read('docs/GUIDE.md');
  const src = fs
    .readdirSync(path.join(ROOT, 'app/src'), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => read(path.join('app/src', f)))
    .join('\n');
  t.ok(
    DOCS[0].slug === 'guide' && DOCS[0].src === 'docs/GUIDE.md',
    `the Guide is the first doc in the hub (${DOCS[0].slug})`,
  );
  const deploy = read('deploy/deploy.sh');
  const unshipped = DOCS.filter(
    (d) => d.raw && !new RegExp(`for f in [^;]*\\b${path.basename(d.src, '.md')}\\b`).test(deploy),
  );
  t.ok(
    !unshipped.length,
    `the deploy ships every doc's Markdown that the docs link to${unshipped.length ? ' (missing ' + unshipped.map((d) => d.src).join(', ') + ')' : ''}`,
  );
  // labels the guide names, as the studio spells them
  const LABELS = [
    'Try the demo agent (free)',
    'Hold to hear',
    'Keep as a clip',
    'Make it yours',
    'Share a link',
    'Export device',
    'Import a device…',
    'Provenance report',
    'Attribution log',
    'DAWproject',
    'Stems',
    'Save the project file',
    'Takes',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the label as the source spells it, template and all
    "Revert all ${store.author(by).name}'s changes (keep mine)",
    'Import MIDI…',
    'Import audio…',
    'Measure the mix',
    'Your words',
  ];
  const missing = LABELS.filter(
    (l) => !src.includes(`'${l}'`) && !src.includes(`\`${l}\``) && !src.includes(`"${l}"`),
  ).concat(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the label as the source spells it, template and all
    LABELS.filter((l) => !guide.includes(l.replace('${store.author(by).name}', 'Claude'))).map(
      (l) => 'not in the guide: ' + l,
    ),
  );
  t.ok(
    !missing.length,
    `the ${LABELS.length} buttons and menus the guide names exist, spelled the same${missing.length ? ': ' + missing.join('; ') : ''}`,
  );
  // the models it lists are the Agent tab's
  const models = [...read('app/src/agent/claude.js').matchAll(/name: '((?:Opus|Sonnet|Haiku) [\d.]+)'/g)].map(
    (m) => m[1],
  );
  t.ok(
    models.length >= 2 && models.every((m) => guide.includes(m)),
    `the guide names the Agent tab's models (${models.join(', ')})`,
  );
  // the keys table: each key is one the studio declares
  // (M, S and K are the layout of Logic and GarageBand: M mutes and S solos the selected track, K is the click; ⌘E,
  // Live's key, splits; ⇧M is bound to nothing now)
  const KEYS = {
    '`Space`': "key: 'Space'",
    '`R`': "key: 'KeyR'",
    '`L`': "key: 'KeyL'",
    '`M`': "key: 'KeyM', run",
    '`S`': "key: 'KeyS', run",
    '`K`': "key: 'KeyK', run",
    '`H`': "key: 'KeyH'",
    '`T`': "key: 'KeyT'",
    '`` ` ``': "key: 'Backquote'",
    '`/`': "key: 'Slash'",
    '`⌘/`': "key: 'Slash', mod: 'mod'",
    '`A`': "key: 'KeyA'",
    '`B`': "key: 'KeyB'",
    '`D`': "key: 'KeyD'",
    '`⌘Z`': "key: 'KeyZ', mod: 'mod'",
    '`⇧⌘Z`': "key: 'KeyZ', mod: 'mod+shift'",
    '`⇧B`': "key: 'KeyB', mod: 'shift'",
    '`Esc`': "key: 'Escape'",
    '`?`': "key: 'Slash', mod: 'shift'",
    '`⇧Esc`': "key: 'Escape', mod: 'shift'",
    '`0`': "key: 'Digit0'",
    '`E`': "key: 'KeyE', when",
    '`⇧Space`': "key: 'Space', mod: 'shift'",
    '`Home`': "key: 'Home'",
    '`⇧K`': "key: 'KeyK', mod: 'shift'",
    '`⌘E`': "key: 'KeyE', mod: 'mod', when",
    '`⇧R`': "key: 'KeyR', mod: 'shift'",
    '`⌘↑`': "key: 'ArrowUp', mod: 'mod'",
    '`⌘↓`': "key: 'ArrowDown', mod: 'mod'",
  };
  const table = (guide.match(/## Keys[\s\S]*$/) || [''])[0];
  const rows = [...table.matchAll(/^\| (`[^|]+?) \|/gm)].flatMap((m) => m[1].split(' · ').map((k) => k.trim()));
  const unknown = rows.filter((k) => !KEYS[k] || !src.includes(KEYS[k]));
  t.ok(
    rows.length >= 12 && !unknown.length,
    `the guide's ${rows.length} keys are all declared in the studio${unknown.length ? ' (not found: ' + unknown.join(' ') + ')' : ''}`,
  );
  // the keys that moved: the table has M, S, K, ⇧K and ⌘E, and nothing in the guide or the landing page still names ⇧M
  // or the old split and click keys
  const moved = ['`M`', '`S`', '`K`', '`⇧K`', '`⌘E`'].filter((k) => !rows.includes(k));
  const stale = [
    ['docs/GUIDE.md', guide],
    ['site/index.html', read('site/index.html')],
    ['README.md', read('README.md')],
  ].flatMap(([f, x]) =>
    [...x.matchAll(/⇧M|Shift\+M\b|`M` turns the click|`S` splits|\bM metronome|\(`S`\)/g)].map(
      (m) => `${f}: "${m[0]}"`,
    ),
  );
  t.ok(
    !moved.length && !stale.length,
    `the guide's key table has M, S, K, ⇧K and ⌘E, and no page names the old click, count-in or split keys${moved.length || stale.length ? ' (' + [...moved.map((k) => 'missing ' + k), ...stale].join('; ') + ')' : ''}`,
  );
  // its numbers are the library's
  const [{ BUILTINS }, { SHOWCASE }, { LIBRARY_DEFS }] = await Promise.all([
    import('../app/src/devices/builtin/index.js'),
    import('../app/src/devices/showcase.js'),
    import('../app/src/devices/library/index.js'),
  ]);
  const all = [...BUILTINS, ...SHOWCASE, ...LIBRARY_DEFS],
    byAgent = all.filter((d) => d.by === 'claude').length;
  const m = guide.match(/has (\d+) devices: the (\d+) built-in instruments and effects, and (\d+) Claude\s+wrote/);
  t.ok(
    m && +m[1] === all.length && +m[2] === BUILTINS.length && +m[3] === byAgent,
    `the guide's device counts are the library's (${m ? m.slice(1).join('/') : 'not found'}; real ${all.length}/${BUILTINS.length}/${byAgent})`,
  );
  // the landing page's Library card says the same, and that the Guitar Studio's pedals and amps aren't on that shelf
  const card = (read('site/index.html').match(/<p class="rn-tag">Library<\/p>([\s\S]*?)<\/li>/) || ['', ''])[1].replace(
    /<[^>]+>/g,
    '',
  );
  const lm = card.match(/The (\d+) built-in instruments and effects, and (\d+) an agent wrote/);
  t.ok(
    lm && +lm[1] === BUILTINS.length && +lm[2] === byAgent && /pedals and amps/.test(card),
    `the landing page's Library card splits the shelf into built-ins and agent-written, and says where the pedals and amps are (${lm ? lm[1] + '/' + lm[2] : 'not found'})`,
  );
  // the guide covers bringing material in, not just taking it out
  t.ok(
    /## Bring material in[\s\S]*Import MIDI…[\s\S]*Reference/.test(guide),
    'the guide has a Bring material in section (MIDI, audio, the Reference tab)',
  );
}

// ---- liner notes on the site (design/LINER-NOTES-KIT.md): no coloured edge on a box, no pills, no numbered slates or
// eyebrows, no decorative middle dots or arrows; authorship is a byline; the overprint is the hero's and the tape box's
{
  console.log('\nliner notes');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const styleOf = (f) =>
    /\.css$/.test(f) ? read(f) : [...read(f).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const CSS = [
    'site/assets/site.css',
    'site/docs/docs.css',
    'site/press/press.css',
    'site/community/community.css',
    'app/library.html',
    'app/gallery.html',
  ];
  const hitsIn = (re) =>
    CSS.flatMap((f) =>
      styleOf(f)
        .split('\n')
        .filter((l) => re.test(l))
        .map((l) => `${f}: ${l.trim().slice(0, 100)}`),
    );
  const stripes = hitsIn(
    /inset\s+-?\d+(\.\d+)?px\s+0\s+0|border-(left|right|top)(-color)?\s*:\s*[^;]*var\(--(human|agent|accent|accent-2|lane|bc)\)|border-(left|top):\s*[3-9]px solid/,
  );
  t.ok(
    !stripes.length,
    `no coloured edge on a box in the site's or the library's CSS${stripes.length ? ':\n       ' + stripes.join('\n       ') : ''}`,
  );
  const pills = hitsIn(/border-radius:\s*(99|999|9999)px/);
  t.ok(
    !pills.length,
    `no pill radii in the site's or the library's CSS${pills.length ? ':\n       ' + pills.join('\n       ') : ''}`,
  );
  const PAGES_ = [
    'site/index.html',
    'site/press/index.html',
    'site/community/index.html',
    ...fs
      .readdirSync(path.join(ROOT, 'site/docs'))
      .filter((f) => f.endsWith('.html'))
      .map((f) => `site/docs/${f}`),
  ];
  // the pages' own words and chrome (a doc's Markdown body is its author's: the docs' text has its own rules)
  const body = (f) =>
    read(f)
      .replace(/<head>[\s\S]*?<\/head>/, '')
      .replace(/<article class="prose">[\s\S]*?<\/article>/, '')
      .replace(/<details class="toc">[\s\S]*?<\/details>/, '')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<pre[\s\S]*?<\/pre>/g, '')
      .replace(/<code[\s\S]*?<\/code>/g, '');
  const slates = PAGES_.filter((f) => /class="slate/.test(read(f)));
  t.ok(
    !slates.length,
    `no numbered slates or eyebrows above the heads (the tape box keeps its label)${slates.length ? ': ' + slates.join(', ') : ''}`,
  );
  const dots = PAGES_.flatMap((f) =>
    [
      ...body(f)
        .replace(/<[^>]+>/g, ' ')
        .matchAll(/[^\n]{0,30}(?: · | → )[^\n]{0,30}/g),
    ].map((m) => `${f}: "${m[0].trim()}"`),
  );
  t.ok(
    !dots.length,
    `no decorative middle dots or arrows in the site's text${dots.length ? ':\n       ' + dots.slice(0, 8).join('\n       ') : ''}`,
  );
  const landing = read('site/index.html');
  const overs = [...landing.matchAll(/<(h[12])[^>]*class="[^"]*\bover\b[^"]*"/g)].length;
  t.ok(
    overs === 2 &&
      /id="hero-title" class="hero-title over"/.test(landing) &&
      /id="last-title" class="over over--ink"/.test(landing),
    `the overprint is the hero's and the tape box's alone (${overs} overprinted heads)`,
  );
  const lede = (landing.match(/<p class="lede">([\s\S]*?)<\/p>/) || ['', ''])[1];
  t.ok(lede && !/<b>|<strong>/.test(lede), 'the hero lede has no bold lead-in');
  const twoBeat = (landing.match(/<h2[^>]*>[^<]*<\/h2>/g) || [])
    .map((h) => h.replace(/<[^>]+>/g, ''))
    .filter((h) => /\.\s+\S/.test(h.trim().replace(/\.$/, '')));
  t.ok(!twoBeat.length, `no two-beat "X. Y." section heads${twoBeat.length ? ': ' + twoBeat.join(' | ') : ''}`);
  // in the page: the lanes, the session log, the track sheet and the song ledger draw no edge, and they're signed
  const o = await open('/', { width: 1440, height: 900 });
  await o.page.waitForSelector('.h-row', { timeout: 10000 }).catch(() => {});
  const r = await o.page.evaluate(() => {
    const edge = (el) => {
      const s = getComputedStyle(el);
      return Math.max(
        parseFloat(s.borderLeftWidth),
        parseFloat(s.borderTopWidth) > 2 ? parseFloat(s.borderTopWidth) : 0,
        /inset/.test(s.boxShadow) ? 9 : 0,
      );
    };
    const sel = ['.lane', '.lane-clip', '.msg', '.h-row', '.rn', '.rn-song', '.open-item'];
    const edged = sel.flatMap((q) => [...document.querySelectorAll(q)].filter((e) => edge(e) > 1).map(() => q));
    const by = (q) =>
      [...document.querySelectorAll(q)].map((e) => ({ t: e.textContent.trim(), c: getComputedStyle(e).color }));
    return {
      edged: [...new Set(edged)],
      agents: by('.by.by-agent'),
      humans: by('.by.by-human'),
      rows: document.querySelectorAll('.h-row .by').length,
      songs: document.querySelectorAll('.rn-song .by-agent').length,
      cards: document.querySelectorAll('.rn-song').length,
    };
  });
  await o.close();
  t.ok(
    !r.edged.length,
    `landing: lanes, the session log, the track sheet, the credits and the song ledger draw no coloured edge${r.edged.length ? ' (' + r.edged.join(', ') + ')' : ''}`,
  );
  const cool = r.agents.every((a) => a.c === 'rgb(76, 195, 255)'),
    warm = r.humans.every((a) => a.c === 'rgb(255, 160, 67)');
  t.ok(
    r.agents.length >= 8 && r.humans.length >= 4 && cool && warm && r.rows === 3 && r.cards >= 6 && r.songs === r.cards,
    `landing: names are bylines, people warm and agents cool (${r.humans.length} warm, ${r.agents.length} cool; ${r.rows} track-sheet rows and ${r.songs} of ${r.cards} song cards signed)`,
  );
}

t.done();
