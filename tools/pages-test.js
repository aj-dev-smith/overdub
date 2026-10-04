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
const PROD = 'https://overdub.ajsmithhq.com';
// The deck, the strategy memo and the launch drafts live in a private repo beside this one (OVERDUB_PRIVATE to point
// elsewhere). The claims checks read them when they're there and skip them in a public clone.
const PRIV = process.env.OVERDUB_PRIVATE || path.resolve(ROOT, '..', 'overdub-private');
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
  let fence = false, n = 0;
  for (const l of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
    if (/^ {0,3}(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (!fence && /^ {0,3}#{2,6}\s/.test(l)) n++;
  }
  return n;
}

const status = new Map();      // url -> HTTP status (HEAD)
const htmlOf = new Map();      // url -> body, for #fragment checks on other pages
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
  page.on('request', (r) => { try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== new URL(base).host) offsite.push(u.host); } catch (e) { /* data: */ } });
  console.log(`\n${width} px`);
  for (const route of PAGES) {
    const before = errors.length;
    offsite = [];
    await page.goto(base + route, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);   // let the press kit's size lookups land
    const name = route.replace(/^\/site\//, '').replace(/\/$/, '/index').replace(/\.html$/, '').replace(/\//g, '-');
    if (route === '/site/press/' || route === '/site/docs/' || route.endsWith('agents.html')) await page.screenshot({ path: path.join(OUTDIR, `pages-${name}-${width}.png`) });

    const errs = errors.slice(before);
    t.ok(errs.length === 0, `${route} @${width}: no console or page errors${errs.length ? '\n       ' + errs.join('\n       ') : ''}`);

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
        if ((r.right > W + 1 || r.left < -1) && !inScroller(el)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
      return { W, sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), bad: bad.slice(0, 6) };
    });
    t.ok(ov.sw <= ov.W && ov.bad.length === 0, `${route} @${width}: no horizontal scroll (page ${ov.sw} px in ${ov.W} px)${ov.bad.length ? '; past the edge: ' + ov.bad.join(', ') : ''}`);

    if (width !== 1440) continue;   // the rest doesn't depend on the width

    t.ok(!offsite.length, `${route}: asks no host but the site for anything, its fonts included${offsite.length ? ' (asked ' + [...new Set(offsite)].join(', ') + ')' : ''}`);

    // ---- headings: an id, and a link to themselves (the hub's cards link to their doc)
    const hs = await page.evaluate(() => [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')].map((h) => ({
      text: h.textContent.trim().replace(/\s+/g, ' ').slice(0, 50),
      id: h.id,
      self: !!h.id && !!h.querySelector(`a[href="#${CSS.escape(h.id)}"]`),
      card: !!h.closest('.doc-card') && /\.html$/.test(h.querySelector('a')?.getAttribute('href') || ''),
    })));
    const noAnchor = hs.filter((h) => !h.id || !(h.self || h.card));
    t.ok(hs.length > 0 && noAnchor.length === 0, `${route}: all ${hs.length} headings have an id and an anchor${noAnchor.length ? ': missing on ' + noAnchor.map((h) => `"${h.text}"`).join(', ') : ''}`);
    const dupes = await page.evaluate(() => { const seen = {}, d = []; document.querySelectorAll('[id]').forEach((e) => { if (seen[e.id]) d.push(e.id); seen[e.id] = 1; }); return d; });
    t.ok(dupes.length === 0, `${route}: ids are unique${dupes.length ? ': ' + dupes.join(', ') : ''}`);

    // ---- every link and asset resolves
    const urls = await page.evaluate(() => {
      const out = new Set();
      const add = (u) => { if (u && !u.startsWith('data:') && !u.startsWith('mailto:')) out.add(new URL(u, location.href).href); };
      document.querySelectorAll('a[href]').forEach((a) => add(a.getAttribute('href')));
      document.querySelectorAll('img[src], source[src], script[src], video[src]').forEach((e) => add(e.getAttribute('src')));
      document.querySelectorAll('img[srcset], source[srcset]').forEach((e) => e.getAttribute('srcset').split(',').forEach((p) => add(p.trim().split(/\s+/)[0])));
      document.querySelectorAll('video[poster]').forEach((v) => add(v.getAttribute('poster')));
      document.querySelectorAll('link[href]').forEach((l) => add(l.getAttribute('href')));
      return [...out];
    });
    const broken = [];
    let local = 0, external = 0, frags = 0;
    for (const u0 of urls) {
      let u = u0;
      if (u.startsWith(PROD)) u = base + u.slice(PROD.length);   // links to the live site are checked against this tree
      if (!u.startsWith(base)) { external++; continue; }
      const [file, frag] = u.split('#');
      local++;
      const st = await head(file);
      if (st !== 200) { broken.push(`${file.slice(base.length)} → ${st}`); continue; }
      if (frag) {
        frags++;
        const here = file === page.url().split('#')[0];
        const found = here
          ? await page.evaluate((id) => !!document.getElementById(decodeURIComponent(id)), frag)
          : new RegExp(`id="${frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(await idsIn(file));
        if (!found) broken.push(`${u.slice(base.length)} → no such id`);
      }
    }
    t.ok(broken.length === 0, `${route}: ${local} local links and assets resolve (${frags} #fragments land; ${external} external not fetched)${broken.length ? ':\n       ' + broken.join('\n       ') : ''}`);

    // ---- per page
    if (route.endsWith('.html')) {
      const doc = DOCS.find((d) => route.endsWith(`/${d.slug}.html`));
      const n = await page.evaluate(() => document.querySelectorAll('.prose h2, .prose h3, .prose h4, .prose h5, .prose h6').length);
      const want = mdHeadings(doc.src);
      t.ok(n === want, `${route}: renders all ${want} headings of ${doc.src} (${n})`);
      const mono = await page.evaluate(() => [...document.querySelectorAll('.code pre')].every((p) => /Atkinson Hyperlegible Mono/.test(getComputedStyle(p).fontFamily)));
      t.ok(mono, `${route}: code blocks are set in the mono`);
    }
    if (route === '/site/press/') {
      const counts = await page.evaluate(() => [...document.querySelectorAll('[data-words]')].map((s) => {
        const text = s.closest('.bp-item').querySelector('.bp-text').textContent;
        return { said: parseInt(s.textContent, 10), real: text.trim().split(/\s+/).filter(Boolean).length };
      }));
      t.ok(counts.length === 3 && counts.every((c) => c.said === c.real), `press: boilerplate word counts are true (${counts.map((c) => `${c.said}/${c.real}`).join(', ')})`);
      const dims = await page.evaluate(async () => {
        const out = [];
        for (const s of document.querySelectorAll('[data-dims]')) {
          const src = s.dataset.dims, said = s.textContent.match(/(\d+)\s*×\s*(\d+)/);
          const real = await new Promise((res) => {
            if (/\.mp4$/.test(src)) {
              const v = document.createElement('video');
              v.preload = 'metadata'; v.muted = true;
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
      t.ok(dims.length >= 8 && wrong.length === 0, `press: the ${dims.length} stated pixel sizes match the files${wrong.length ? ': ' + wrong.map((d) => `${d.src} says ${d.said} is ${d.real && d.real.slice(0, 2)}`).join('; ') : ''}`);
      const film = dims.find((d) => /\.mp4$/.test(d.src));
      t.ok(film && film.real && Math.abs(film.real[2] - 30) < 1, `press: the film is about 30 s (${film && film.real && film.real[2].toFixed(1)} s)`);
      const sizes = await page.evaluate(() => [...document.querySelectorAll('[data-size-of]')].map((s) => s.textContent));
      t.ok(sizes.length > 0 && sizes.every((s) => /\d+(\.\d)? (KB|MB)$/.test(s)), `press: every download shows its size (${sizes.join(', ')})`);
      const ph = await page.evaluate(() => document.querySelectorAll('.placeholder').length);
      const mail = await page.evaluate(() => !!document.querySelector('#contact ~ p a[href^="mailto:"]'));
      t.ok(ph === 0 && mail, `press: no placeholders left, and the contact is an address (${ph} placeholders)`);
      const greens = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => !e.closest('.swatches') && getComputedStyle(e).backgroundColor === 'rgb(217, 243, 106)').length);
      t.ok(greens === 0, 'press: no leader green in the page body outside its swatch (nothing here is the one primary action)');
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
  t.ok(links.press && links.docs && links.guide, `landing page footer links to the Guide, Docs and Press (guide ${links.guide}, press ${links.press}, docs ${links.docs})`);
  await o.close();
}

// ---- words for any device: the hum's privacy line says "this device" (it may be a phone), and the landing pedal's
// hint starts with a drag before the keys
{
  const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sk = rd('app/src/ui/sketch.js'), pedal = rd('site/assets/pedal.js');
  t.ok(/nothing leaves this device/.test(sk) && !/leaves this computer/.test(sk + rd('site/index.html')), 'the hum says nothing leaves this device (not "this computer")');
  t.ok(/Drag the knobs, or tab to one and use the arrow keys/.test(pedal), 'the landing pedal\'s hint reads on a phone too ("Drag the knobs, or tab to one…")');
}

// ---- the landing page under a finger: every pedal footswitch and footer link reaches 40 px tall to the touch at
// 390 (a tap 19 px above and below its middle still lands on it); at 1440 with a mouse the links are as drawn
{
  const reach = () => {
    const at = (el) => { el.scrollIntoView({ block: 'center', behavior: 'instant' }); const q = el.getBoundingClientRect(), y = q.top + q.height / 2, x = q.left + q.width / 2; return [y - 19, y + 19].every((yy) => { const hit = document.elementFromPoint(x, yy); return hit === el || el.contains(hit); }); };
    const foots = [...document.querySelectorAll('.face-foot')].filter((e) => e.getClientRects().length), links = [...document.querySelectorAll('.foot p a')];
    return { foots: foots.length, footMiss: foots.filter((e) => !at(e)).length, links: links.length, linkMiss: links.filter((e) => !at(e)).map((e) => e.textContent), linkH: Math.round(links[0]?.getBoundingClientRect().height || 0) };
  };
  const o = await open('/', { width: 390, height: 844 });
  const r = await o.page.evaluate(reach);
  t.ok(r.foots >= 4 && !r.footMiss && r.links >= 4 && !r.linkMiss.length, `at 390 the landing's ${r.foots} footswitches and ${r.links} footer links are 40 px tall to the touch (${r.footMiss} switches short${r.linkMiss.length ? '; short links: ' + r.linkMiss.join(', ') : ''})`);
  await o.close();
  const d = await open('/', { width: 1440 });
  const dr = await d.page.evaluate(() => Math.round(document.querySelector('.foot p a').getBoundingClientRect().height));
  t.ok(dr < 30, `at 1440 with a mouse the footer links are as drawn (${dr} px)`);
  await d.close();
}

// ---- claims: what the public copy, the deck and the launch drafts say is still true of the product
{
  console.log('\nclaims');
  const at = (f) => (fs.existsSync(path.join(ROOT, f)) ? path.join(ROOT, f) : path.join(PRIV, f));
  const read = (f) => fs.readFileSync(at(f), 'utf8');
  const md = (dir) => fs.readdirSync(at(dir)).filter((f) => f.endsWith('.md')).map((f) => `${dir}/${f}`);
  const PRIVATE = HAS_PRIV ? ['deck/index.html', 'docs/STRATEGY.md', ...md('docs/launch')] : [];
  if (!HAS_PRIV) console.log('  (no overdub-private beside this repo: the deck and launch drafts are not checked)');
  // Everything that speaks for Overdub.
  const COPY = ['site/index.html', 'site/press/index.html', 'site/llms.txt', ...DOCS.map((d) => `site/docs/${d.slug}.html`),
    'site/docs/index.html', 'README.md', 'app/index.html', 'integrations/README.md',
    // (dated records keep the numbers that were true when they were written: the fresh-eyes reports)
    ...md('docs').filter((f) => !/FRESH-EYES/.test(f)), ...PRIVATE.filter((f) => f !== 'docs/STRATEGY.md')];
  const text = Object.fromEntries(COPY.map((f) => [f, read(f)]));
  const plain = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ');
  const hits = (re, files = COPY) => files.flatMap((f) => [...text[f].matchAll(re)].map((m) => `${f}: "${m[0].replace(/\s+/g, ' ').trim().slice(0, 90)}"`));
  const say = (list) => (list.length ? ':\n       ' + list.join('\n       ') : '');

  // Browsers: Safari, Firefox and phones pass tools/compat-test.js, so nothing says Chrome only.
  const chrome = hits(/Chrome (only|is the target)|runs in Chrome(?![,\s]+(Safari|Edge))|\bUse Chrome\b|in Chrome(, for now| for now|,? nothing to install)|Chrome on a (desktop|laptop|computer)|\(and Chrome, for now\)|studio in Chrome|Yes to both, in Chrome|Free, in Chrome/g);
  t.ok(!chrome.length, `no copy says Overdub is Chrome-only (compat-test covers WebKit, Firefox and a phone)${say(chrome)}`);
  // ... nor do the notes that steer the work (CLAUDE.md), nor the studio's own errors (Firefox has Web MIDI; a missing
  // getUserMedia is usually a page served over plain http, not the browser)
  const appSrc = fs.readdirSync(path.join(ROOT, 'app/src'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => [`app/src/${f}`, read(path.join('app/src', f))]);
  const steer = [['CLAUDE.md', read('CLAUDE.md')], ...appSrc].flatMap(([f, s]) => [...s.matchAll(/Chrome (only|is the target)|\bTry Chrome\b|use Chrome or Edge(?!,? or Firefox)/g)].map((m) => `${f}: "${m[0]}"`));
  t.ok(!steer.length, `CLAUDE.md and the studio's messages don't steer to Chrome alone${say(steer)}`);

  // Kernels: the worklet scope is a rule for determinism, not a security boundary, and share links carry strangers'
  // kernels. "Sandbox" may only appear about the future (WASM, iframes) or to say it is not one.
  const sandbox = COPY.flatMap((f) => {
    const s = plain(text[f]);
    return [...s.matchAll(/sandbox(ed|ing)?/gi)].map((m) => {
      const a = Math.max(s.lastIndexOf('.', m.index), s.lastIndexOf('\n\n', m.index)) + 1;
      const b = s.indexOf('.', m.index + 1);
      return { f, sentence: s.slice(a, b < 0 ? undefined : b).replace(/\s+/g, ' ').trim() };
    }).filter((x) => !/WASM|iframe|not a (security )?(sandbox|boundary)/i.test(x.sentence)).map((x) => `${x.f}: "${x.sentence.slice(0, 110)}"`);
  });
  const security = hits(/gives security|security and determinism/gi);
  t.ok(!sandbox.length && !security.length, `no copy calls kernels sandboxed or secure (only WASM, later, would be)${say([...sandbox, ...security])}`);

  // MCP: a visitor's tab on the live site can't be driven over MCP (the bridge is localhost-only and the relay is off),
  // so wherever the landing page mentions MCP, the same paragraph says it needs a local copy.
  const landing = text['site/index.html'];
  const mcpParas = [...landing.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => plain(m[2])).filter((p) => /\bMCP\b/.test(p));
  const uncaveated = mcpParas.filter((p) => !/own computer|locally|local copy|isn(’|')t public/.test(p));
  t.ok(mcpParas.length > 0 && !uncaveated.length, `the landing page's MCP copy says it needs a local copy (${mcpParas.length} paragraph(s))${say(uncaveated.map((p) => `"${p.replace(/\s+/g, ' ').trim().slice(0, 100)}"`))}`);

  // Retired claims, each wrong for a reason the product or the source makes plain.
  const RETIRED = [
    [/learns what it means to you/gi, 'no personal lexicon yet: the agent asks which one you mean'],
    [/Drum on the desk or the space bar/gi, 'Space plays and stops; tapping is F J K L, the pads or the mic'],
    [/stay out of the red|never go silent|as loud as what went in|is it (about )?as loud as its input/gi, 'the device check refuses compile errors, NaN, runaways and stuck notes; loudness and silence are warnings'],
    [/refiled 18 Sept/gi, 'UMG and Sony filed a second suit; nothing was refiled'],
    [/absolutely terrible[”"]? for creative work|for three reasons: the agent can(’|')t hear/gi, 'the write-up never said it; a commenter did, about mixing commands'],
    [/most-discussed write-up/gi, 'a Show HN for an Ableton MCP had more points: say widely read'],
    [/Practitioners report the same three problems/gi, 'the three problems are our landscape review, not a practitioner report'],
    [/edit accuracy (lost|fell|falls)|lose 39 to 52%/gi, 'RIME measured edit similarity, for two small models'],
    [/object model has no render/gi, 'the Extensions SDK beta can bounce a track to WAV'],
    [/the README already says MIT/gi, 'the licence is undecided'],
    [/not there yet: Safari|sharing songs or devices by link/gi, 'Safari, Firefox and share links shipped'],
    [/The mark \(spiral\)/g, 'the mark is the Weave'],
    [/\b515\b[^.\n|]{0,30}tools|openDAW(’|')s 515/gi, 'opendaw-mcp lists 543 tools in full mode (and has a 39-tool lite mode): say 500+'],
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
    const bad = [['site/index.html share note', shareNote], ['docs/GUIDE.md Share and fork', guideShare]].filter(([, x]) => !/\bcode\b/.test(x) || !/trust/.test(x) || !/Overdub(’|')s servers/.test(x)).map(([f]) => f);
    t.ok(!bad.length, `the share copy says links carry code, to open them from people you trust, and that only Overdub's servers never see them${bad.length ? ' (not in: ' + bad.join(', ') + ')' : ''}`);
  }
  for (const [re, why] of RETIRED) {
    const h = hits(re);
    t.ok(!h.length, `retired claim gone (${why})${say(h)}`);
  }

  // The tap lane names the keys input/tap.js actually listens to.
  const { ROWS } = await import('../app/src/input/tap.js');
  const lane = (landing.match(/<h3>Tap it<\/h3><p>([^<]*)<\/p>/) || [])[1] || '';
  const keys = ROWS.map((r) => r.hint);
  t.ok(keys.every((k) => new RegExp(`\\b${k}\\b`).test(lane)) && !/space bar/i.test(lane), `the Tap lane names the tap keys (${keys.join(' ')}): "${lane}"`);

  // Tool counts: every number stated next to "tools" matches the studio as it loads, and the agents doc lists them all.
  const o = await open('/app/', { width: 1280 });
  await o.page.waitForFunction(() => window.overdub?.tools?.list?.().includes('share_link') && window.overdub.tools.list().includes('provenance_report'), null, { timeout: 15000 }).catch(() => {});
  const live = await o.page.evaluate(() => window.overdub.tools.list());
  await o.close();
  const stated = COPY.flatMap((f) => [
    ...[...text[f].matchAll(/\b(\d+)(?:\s|&nbsp;)+(?:(?:agent|task-shaped|MCP)\s+)?tools\b/g)].map((m) => [f, +m[1]]),
    ...[...text[f].matchAll(/data-tool-count[^>]*>(\d+)</g)].map((m) => [f, +m[1]]),
  ]).filter(([, n]) => n !== 543);   // openDAW's third-party MCP, in full mode
  // and in words ("Twenty-three agent tools", "about twenty tools"), which the digits above miss
  const UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const word = (w) => { const [tens, unit = ''] = w.toLowerCase().split('-'); return (tens === 'thirty' ? 30 : 20) + UNITS.indexOf(unit); };
  for (const f of COPY) for (const m of plain(text[f]).matchAll(/\b(?:about\s+)?((?:twenty|thirty)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?)\s+(?:(?:agent|task-shaped|MCP)\s+)?tools\b/gi)) stated.push([f, word(m[1])]);
  const off = stated.filter(([, n]) => n !== live.length);
  t.ok(live.length >= 20 && stated.length >= 5 && !off.length, `every stated tool count is the studio's ${live.length} (${stated.length} places)${say(off.map(([f, n]) => `${f} says ${n}`))}`);
  const table = (read('docs/AGENTS.md').match(/## The tools[\s\S]*?\n## /) || [''])[0];
  const unlisted = live.filter((n) => !table.includes('`' + n + '`'));
  t.ok(!unlisted.length, `docs/AGENTS.md's tool table lists all ${live.length} tools${unlisted.length ? ' (missing: ' + unlisted.join(', ') + ')' : ''}`);

  // The bench slide's device check is Tidal Cathedral's real report: the one the device library shows (reports.js,
  // kernel/check.js in full mode), not a separate render. A warning on the slide only if the check gave one.
  if (HAS_PRIV) {
    const { REPORTS } = await import('../app/src/devices/library/reports.js');
    const rep = REPORTS['claude.tidal-cathedral'];
    const dl = (text['deck/index.html'].match(/<dl class="check">([\s\S]*?)<\/dl>/) || [])[1] || '';
    const dd = Object.fromEntries([...dl.matchAll(/<dt>([^<]+)<\/dt><dd class="(\w+)">([^<]+)<\/dd>/g)].map((m) => [m[1], { cls: m[2], v: m[3].replace(/−/g, '-') }]));
    const num = (k, i = 0) => +((dd[k]?.v.match(/-?\d+(?:\.\d+)?/g) || [])[i]);
    const wet = num('Level vs dry'), dry = num('Level vs dry', 1), tp = num('True peak'), tail = num('Tail');
    const warns = Object.values(dd).filter((x) => x.cls === 'warn').length;
    const near = (x, y) => Math.abs(x - y) < 0.051;
    t.ok(rep && near(wet, rep.lufs) && near(dry, rep.lufs - rep.deltaLU) && near(tp, rep.truePeak) && near(tail, rep.tail) && warns === rep.warnings,
      `the deck's Tidal Cathedral check is the library's report (deck ${wet}/${dry} LUFS, ${tp} dBTP, tail ${tail} s, ${warns} warning(s); report ${rep?.lufs}/${rep && +(rep.lufs - rep.deltaLU).toFixed(1)}, ${rep?.truePeak}, ${rep?.tail} s, ${rep?.warnings})`);
  }

  // Test counts: wherever a number of suites or checks is stated, they agree, and no more suites are claimed than exist.
  const COUNTED = PRIVATE;
  for (const f of COUNTED) text[f] ??= read(f);
  const nums = (re) => COUNTED.flatMap((f) => [...text[f].matchAll(re)].map((m) => [f, +m[1].replace(/,/g, '')]));
  const suites = nums(/\b(\d+)\s*(?:<\/?[a-z][^>]*>\s*)*(?:automated\s+)?(?:test\s+)?suites\b/g);
  const checks = nums(/\b(\d{1,3}(?:,\d{3})+|\d{3,})\s*(?:<\/?[a-z][^>]*>\s*)*checks\b/g);
  const files = fs.readdirSync(HERE).filter((f) => /-test\.js$/.test(f)).length;
  const one = (xs) => new Set(xs.map(([, n]) => n)).size === 1;
  if (COUNTED.length) t.ok(suites.length >= 3 && one(suites) && suites[0][1] === files, `stated suite counts agree and are today's (${[...new Set(suites.map(([, n]) => n))].join(' / ')} stated; ${files} suites exist)${one(suites) ? '' : say(suites.map(([f, n]) => `${f}: ${n}`))}`);
  if (COUNTED.length) t.ok(checks.length >= 3 && one(checks), `stated check counts agree (${[...new Set(checks.map(([, n]) => n))].join(' / ')})${one(checks) ? '' : say(checks.map(([f, n]) => `${f}: ${n}`))}`);
  // ... and are close to the last full run's (node tools/run-all.js leaves its totals in tools/.out/run-all.json): never
  // more checks than ran, and recounted once the suite has grown by a tenth. "Some checks failed" caveats go once it passed.
  let last = null;
  try { last = JSON.parse(fs.readFileSync(path.join(HERE, '.out', 'run-all.json'), 'utf8')); } catch (e) { /* no full run here yet */ }
  if (last && checks.length) {
    const q = checks[0][1];
    t.ok(q <= last.checks && q >= 0.9 * last.checks, `the stated ${q.toLocaleString('en')} checks match the last full run (${last.checks} in ${last.suites} suites, ${last.at.slice(0, 10)}): recount if not`);
  } else console.log('  (no tools/.out/run-all.json: run node tools/run-all.js to hold the check count to a real run)');
  const caveat = hits(/some checks failed|some checks fail|re-?run [^.]*before quoting a pass rate/gi, COUNTED);
  t.ok(!(last && last.fails === 0 && last.passed === last.suites) || !caveat.length, `no stale "some checks failed" caveat after a clean full run${say(caveat)}`);
}

// ---- the guide: first in the docs, and what it tells a newcomer to press is really there
{
  console.log('\nguide');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const guide = read('docs/GUIDE.md');
  const src = fs.readdirSync(path.join(ROOT, 'app/src'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => read(path.join('app/src', f))).join('\n');
  t.ok(DOCS[0].slug === 'guide' && DOCS[0].src === 'docs/GUIDE.md', `the Guide is the first doc in the hub (${DOCS[0].slug})`);
  const deploy = read('deploy/deploy.sh');
  const unshipped = DOCS.filter((d) => d.raw && !new RegExp(`for f in [^;]*\\b${path.basename(d.src, '.md')}\\b`).test(deploy));
  t.ok(!unshipped.length, `the deploy ships every doc's Markdown that the docs link to${unshipped.length ? ' (missing ' + unshipped.map((d) => d.src).join(', ') + ')' : ''}`);
  // labels the guide names, as the studio spells them
  const LABELS = ['Try the demo agent (no key)', 'Hold to hear', 'Keep as a clip', 'Make it yours', 'Share a link', 'Export device', 'Import a device…',
    'Provenance report', 'Attribution log', 'DAWproject', 'Stems', 'Save the project file', 'Takes', "Revert all ${store.author(by).name}'s changes (keep mine)",
    'Import MIDI…', 'Import audio…', 'Measure the mix', 'Your words'];
  const missing = LABELS.filter((l) => !src.includes(`'${l}'`) && !src.includes(`\`${l}\``) && !src.includes(`"${l}"`))
    .concat(LABELS.filter((l) => !guide.includes(l.replace('${store.author(by).name}', 'Claude'))).map((l) => 'not in the guide: ' + l));
  t.ok(!missing.length, `the ${LABELS.length} buttons and menus the guide names exist, spelled the same${missing.length ? ': ' + missing.join('; ') : ''}`);
  // the models it lists are the Agent tab's
  const models = [...read('app/src/agent/claude.js').matchAll(/name: '((?:Opus|Sonnet|Haiku) [\d.]+)'/g)].map((m) => m[1]);
  t.ok(models.length >= 2 && models.every((m) => guide.includes(m)), `the guide names the Agent tab's models (${models.join(', ')})`);
  // the keys table: each key is one the studio declares
  // (M, S and K are the layout of Logic and GarageBand: M mutes and S solos the selected track, K is the click; ⌘E,
  // Live's key, splits; ⇧M is bound to nothing now)
  const KEYS = { '`Space`': "key: 'Space'", '`R`': "key: 'KeyR'", '`L`': "key: 'KeyL'", '`M`': "key: 'KeyM', run", '`S`': "key: 'KeyS', run", '`K`': "key: 'KeyK', run", '`H`': "key: 'KeyH'", '`T`': "key: 'KeyT'", '`` ` ``': "key: 'Backquote'",
    '`/`': "key: 'Slash'", '`⌘/`': "key: 'Slash', mod: 'mod'", '`A`': "key: 'KeyA'", '`B`': "key: 'KeyB'", '`D`': "key: 'KeyD'", '`⌘Z`': "key: 'KeyZ', mod: 'mod'", '`⇧⌘Z`': "key: 'KeyZ', mod: 'mod+shift'", '`⇧B`': "key: 'KeyB', mod: 'shift'", '`Esc`': "key: 'Escape'", '`?`': "key: 'Slash', mod: 'shift'",
    '`⇧Esc`': "key: 'Escape', mod: 'shift'", '`0`': "key: 'Digit0'", '`E`': "key: 'KeyE', when",
    '`⇧Space`': "key: 'Space', mod: 'shift'", '`Home`': "key: 'Home'", '`⇧K`': "key: 'KeyK', mod: 'shift'", '`⌘E`': "key: 'KeyE', mod: 'mod', when", '`⇧R`': "key: 'KeyR', mod: 'shift'",
    '`⌘↑`': "key: 'ArrowUp', mod: 'mod'", '`⌘↓`': "key: 'ArrowDown', mod: 'mod'" };
  const table = (guide.match(/## Keys[\s\S]*$/) || [''])[0];
  const rows = [...table.matchAll(/^\| (`[^|]+?) \|/gm)].flatMap((m) => m[1].split(' · ').map((k) => k.trim()));
  const unknown = rows.filter((k) => !KEYS[k] || !src.includes(KEYS[k]));
  t.ok(rows.length >= 12 && !unknown.length, `the guide's ${rows.length} keys are all declared in the studio${unknown.length ? ' (not found: ' + unknown.join(' ') + ')' : ''}`);
  // the keys that moved: the table has M, S, K, ⇧K and ⌘E, and nothing in the guide or the landing page still names ⇧M
  // or the old split and click keys
  const moved = ['`M`', '`S`', '`K`', '`⇧K`', '`⌘E`'].filter((k) => !rows.includes(k));
  const stale = [['docs/GUIDE.md', guide], ['site/index.html', read('site/index.html')], ['README.md', read('README.md')]].flatMap(([f, x]) => [...x.matchAll(/⇧M|Shift\+M\b|`M` turns the click|`S` splits|\bM metronome|\(`S`\)/g)].map((m) => `${f}: "${m[0]}"`));
  t.ok(!moved.length && !stale.length, `the guide's key table has M, S, K, ⇧K and ⌘E, and no page names the old click, count-in or split keys${moved.length || stale.length ? ' (' + [...moved.map((k) => 'missing ' + k), ...stale].join('; ') + ')' : ''}`);
  // its numbers are the library's
  const [{ BUILTINS }, { SHOWCASE }, { LIBRARY_DEFS }] = await Promise.all([import('../app/src/devices/builtin/index.js'), import('../app/src/devices/showcase.js'), import('../app/src/devices/library/index.js')]);
  const all = [...BUILTINS, ...SHOWCASE, ...LIBRARY_DEFS], byAgent = all.filter((d) => d.by === 'claude').length;
  const m = guide.match(/has (\d+) devices: the (\d+) built-in instruments and effects, and (\d+) Claude\s+wrote/);
  t.ok(m && +m[1] === all.length && +m[2] === BUILTINS.length && +m[3] === byAgent, `the guide's device counts are the library's (${m ? m.slice(1).join('/') : 'not found'}; real ${all.length}/${BUILTINS.length}/${byAgent})`);
  // the landing page's Library card says the same, and that the Guitar Studio's pedals and amps aren't on that shelf
  const card = (read('site/index.html').match(/<p class="rn-tag">Library<\/p>([\s\S]*?)<\/li>/) || ['', ''])[1].replace(/<[^>]+>/g, '');
  const lm = card.match(/The (\d+) built-in instruments and effects, and (\d+) an agent wrote/);
  t.ok(lm && +lm[1] === BUILTINS.length && +lm[2] === byAgent && /pedals and amps/.test(card), `the landing page's Library card splits the shelf into built-ins and agent-written, and says where the pedals and amps are (${lm ? lm[1] + '/' + lm[2] : 'not found'})`);
  // the guide covers bringing material in, not just taking it out
  t.ok(/## Bring material in[\s\S]*Import MIDI…[\s\S]*Reference/.test(guide), 'the guide has a Bring material in section (MIDI, audio, the Reference tab)');
}

// ---- liner notes on the site (design/LINER-NOTES-KIT.md): no coloured edge on a box, no pills, no numbered slates or
// eyebrows, no decorative middle dots or arrows; authorship is a byline; the overprint is the hero's and the tape box's
{
  console.log('\nliner notes');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const styleOf = (f) => (/\.css$/.test(f) ? read(f) : [...read(f).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'));
  const CSS = ['site/assets/site.css', 'site/docs/docs.css', 'site/press/press.css', 'app/library.html', 'app/gallery.html'];
  const hitsIn = (re) => CSS.flatMap((f) => styleOf(f).split('\n').filter((l) => re.test(l)).map((l) => `${f}: ${l.trim().slice(0, 100)}`));
  const stripes = hitsIn(/inset\s+-?\d+(\.\d+)?px\s+0\s+0|border-(left|right|top)(-color)?\s*:\s*[^;]*var\(--(human|agent|accent|accent-2|lane|bc)\)|border-(left|top):\s*[3-9]px solid/);
  t.ok(!stripes.length, `no coloured edge on a box in the site's or the library's CSS${stripes.length ? ':\n       ' + stripes.join('\n       ') : ''}`);
  const pills = hitsIn(/border-radius:\s*(99|999|9999)px/);
  t.ok(!pills.length, `no pill radii in the site's or the library's CSS${pills.length ? ':\n       ' + pills.join('\n       ') : ''}`);
  const PAGES_ = ['site/index.html', 'site/press/index.html', ...fs.readdirSync(path.join(ROOT, 'site/docs')).filter((f) => f.endsWith('.html')).map((f) => `site/docs/${f}`)];
  // the pages' own words and chrome (a doc's Markdown body is its author's: the docs' text has its own rules)
  const body = (f) => read(f).replace(/<head>[\s\S]*?<\/head>/, '').replace(/<article class="prose">[\s\S]*?<\/article>/, '').replace(/<details class="toc">[\s\S]*?<\/details>/, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code[\s\S]*?<\/code>/g, '');
  const slates = PAGES_.filter((f) => /class="slate/.test(read(f)));
  t.ok(!slates.length, `no numbered slates or eyebrows above the heads (the tape box keeps its label)${slates.length ? ': ' + slates.join(', ') : ''}`);
  const dots = PAGES_.flatMap((f) => [...body(f).replace(/<[^>]+>/g, ' ').matchAll(/[^\n]{0,30}(?: · | → )[^\n]{0,30}/g)].map((m) => `${f}: "${m[0].trim()}"`));
  t.ok(!dots.length, `no decorative middle dots or arrows in the site's text${dots.length ? ':\n       ' + dots.slice(0, 8).join('\n       ') : ''}`);
  const landing = read('site/index.html');
  const overs = [...landing.matchAll(/<(h[12])[^>]*class="[^"]*\bover\b[^"]*"/g)].length;
  t.ok(overs === 2 && /id="hero-title" class="hero-title over"/.test(landing) && /id="last-title" class="over over--ink"/.test(landing), `the overprint is the hero's and the tape box's alone (${overs} overprinted heads)`);
  const lede = (landing.match(/<p class="lede">([\s\S]*?)<\/p>/) || ['', ''])[1];
  t.ok(lede && !/<b>|<strong>/.test(lede), 'the hero lede has no bold lead-in');
  const twoBeat = (landing.match(/<h2[^>]*>[^<]*<\/h2>/g) || []).map((h) => h.replace(/<[^>]+>/g, '')).filter((h) => /\.\s+\S/.test(h.trim().replace(/\.$/, '')));
  t.ok(!twoBeat.length, `no two-beat "X. Y." section heads${twoBeat.length ? ': ' + twoBeat.join(' | ') : ''}`);
  // in the page: the lanes, the session log, the track sheet and the song ledger draw no edge, and they're signed
  const o = await open('/', { width: 1440, height: 900 });
  await o.page.waitForSelector('.h-row', { timeout: 10000 }).catch(() => {});
  const r = await o.page.evaluate(() => {
    const edge = (el) => { const s = getComputedStyle(el); return Math.max(parseFloat(s.borderLeftWidth), parseFloat(s.borderTopWidth) > 2 ? parseFloat(s.borderTopWidth) : 0, /inset/.test(s.boxShadow) ? 9 : 0); };
    const sel = ['.lane', '.lane-clip', '.msg', '.h-row', '.rn', '.rn-song', '.open-item'];
    const edged = sel.flatMap((q) => [...document.querySelectorAll(q)].filter((e) => edge(e) > 1).map(() => q));
    const by = (q) => [...document.querySelectorAll(q)].map((e) => ({ t: e.textContent.trim(), c: getComputedStyle(e).color }));
    return { edged: [...new Set(edged)], agents: by('.by.by-agent'), humans: by('.by.by-human'), rows: document.querySelectorAll('.h-row .by').length, songs: document.querySelectorAll('.rn-song .by-agent').length, cards: document.querySelectorAll('.rn-song').length };
  });
  await o.close();
  t.ok(!r.edged.length, `landing: lanes, the session log, the track sheet, the credits and the song ledger draw no coloured edge${r.edged.length ? ' (' + r.edged.join(', ') + ')' : ''}`);
  const cool = r.agents.every((a) => a.c === 'rgb(76, 195, 255)'), warm = r.humans.every((a) => a.c === 'rgb(255, 160, 67)');
  t.ok(r.agents.length >= 8 && r.humans.length >= 4 && cool && warm && r.rows === 3 && r.cards >= 6 && r.songs === r.cards, `landing: names are bylines, people warm and agents cool (${r.humans.length} warm, ${r.agents.length} cool; ${r.rows} track-sheet rows and ${r.songs} of ${r.cards} song cards signed)`);
}

t.done();
