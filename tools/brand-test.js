// Brand and landing-page checks. node tools/brand-test.js
//   tokens: every contract name present; text colours clear WCAG AA on every surface
//   the rule (Liner notes): CLAUDE.md and BRAND.md say authorship is a byline; the new tokens are there (rules, the
//           press radius, the paper inks at AA on cream), corners are 2 px or square, nothing sitting in the page casts
//           a shadow, slate can't read as the agent's cool; app.css draws no stripe and no pill; dom.js has byline()
//           and no sparkle; in the studio a byline is a name in warm or cool ink, the house is unsigned, and the old
//           class names (.badge-agent, .by-human on a card) draw no pill and no stripe
//   assets: the marks are the Weave (app/assets and site/assets match; tools/brand-marks.js regenerates them exactly),
//           og.png is 1200x630
//   copy: the old theme (worm, "stuck in your head", the spiral as the logo) is gone from the page
//   type: app/style/fonts.css declares the five families (only the weights the pages use), every file a woff2 on the
//         site beside its OFL licence; the studio, the landing page, a docs page and the device faces load each family
//         they draw in from /app/style/fonts/, and ask no other host for anything
//   landing page at 1440x900 and 390x844: no errors, no horizontal scroll, the Weave animates and its strands cross
//           taking turns, the headline is overprinted, social meta, the film; at 390 under a 4x CPU throttle a frame
//           of the Weave costs well under a 60 fps budget
//   reduced motion: the Weave holds still and still tells the story
//   hum: a fake mic (a hummed A3 C4 E4 file) lights the right notes, and the cool strand answers
//   session notes: its counts (devices, agent-built ones, transforms, bench tasks) and demo cards match the source;
//           its links resolve, and a ?demo= link opens that song
//   Cathedral Below: plays, meters, and its LEVELS hold when rendered offline and measured (BS.1770 LUFS, true peak)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open, tally, OUTDIR } from './pw.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = tally('brand');

// ---- tokens
const CONTRACT = ['--bg', '--bg-2', '--bg-3', '--panel', '--line', '--line-2', '--text', '--text-2', '--text-3', '--accent', '--accent-2', '--human', '--agent', '--ok', '--warn', '--bad', '--rec', '--font-ui', '--font-display', '--font-mono', '--r-1', '--r-2', '--r-3', '--shadow-1', '--shadow-2', '--c-1', '--c-2', '--c-3', '--c-4', '--c-5', '--c-6', '--c-7', '--c-8'];
const tokensSrc = fs.readFileSync(path.join(ROOT, 'app/style/tokens.css'), 'utf8');
const tok = {};
for (const m of tokensSrc.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tok[m[1]] = m[2].trim();
const missing = CONTRACT.filter((n) => !(n in tok));
T.ok(!missing.length, `tokens.css has every contract name${missing.length ? ' (missing ' + missing.join(' ') + ')' : ''}`);
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const surfaces = ['--bg', '--bg-2', '--bg-3', '--panel'];
for (const t of ['--text', '--text-2', '--text-3', '--human', '--agent', '--accent', '--ok', '--warn', '--bad']) {
  const worst = Math.min(...surfaces.map((s) => ratio(tok[t], tok[s])));
  T.ok(worst >= 4.5, `${t} ${tok[t]} is AA on every surface (worst ${worst.toFixed(2)}:1)`);
}
const trackWorst = Math.min(...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ratio(tok['--c-' + i], tok['--bg'])));
T.ok(trackWorst >= 6, `track colours read as text on --bg (worst ${trackWorst.toFixed(2)}:1)`);
T.ok(ratio(tok['--bg'], tok['--accent']) >= 4.5, `--bg text on an --accent button is AA (${ratio(tok['--bg'], tok['--accent']).toFixed(2)}:1)`);

// the tape box (site.css): ink on leader-tape cream
const siteCss = fs.readFileSync(path.join(ROOT, 'site/assets/site.css'), 'utf8');
const stok = {};
for (const m of siteCss.matchAll(/(--(?:paper|ink|ink-2))\s*:\s*(#[0-9a-f]{6})/g)) stok[m[1]] = m[2];
for (const t of ['--ink', '--ink-2']) T.ok(stok[t] && ratio(stok[t], stok['--paper']) >= 4.5, `tape box: ${t} ${stok[t]} on --paper ${stok['--paper']} is AA (${stok[t] ? ratio(stok[t], stok['--paper']).toFixed(2) : '?'}:1)`);
T.ok(ratio(stok['--ink'], tok['--accent']) >= 4.5, `tape box: ink on a leader-green button is AA (${ratio(stok['--ink'], tok['--accent']).toFixed(2)}:1)`);
{
  // the faces come from the site: tokens.css imports fonts.css, which declares Archivo over its width axis to 125
  let fontsSrc = '';
  try { fontsSrc = fs.readFileSync(path.join(ROOT, 'app/style/fonts.css'), 'utf8'); } catch (e) { /* none: the check fails */ }
  T.ok(/@import url\('fonts\.css'\)/.test(tokensSrc) && /font-family: 'Archivo';[^}]*font-stretch: 62% 125%/.test(fontsSrc) && /font-family: 'Atkinson Hyperlegible Next'/.test(fontsSrc) && /font-family: 'Atkinson Hyperlegible Mono'/.test(fontsSrc),
    'tokens.css loads Archivo (with the wdth axis to 125), Atkinson Hyperlegible Next and Mono, from the site (fonts.css)');
}
T.ok(/'wdth'\s*125/.test(tok['--font-display-vars'] || ''), `--font-display-vars sets Archivo's width (${tok['--font-display-vars']})`);

// ---- the rule: authorship is a byline (design/DECISION.md, design/LINER-NOTES-KIT.md)
{
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const brand = fs.readFileSync(path.join(ROOT, 'docs/BRAND.md'), 'utf8');
  const sect = (md, head) => (md.split(/\n## /).find((x) => x.startsWith(head)) || '');
  T.ok(/Authorship is a \*\*byline\*\*/.test(claude) && /no container is striped, tinted or filled by who made it/.test(claude) && /the house is unsigned/.test(claude)
    && !/edge or a badge/.test(claude), 'CLAUDE.md: authorship is a byline; no container striped, tinted or filled; the house unsigned');
  const colour = sect(brand, 'Colour'), studio = sect(brand, 'In the studio'), illus = sect(brand, 'Illustration');
  T.ok(/byline/.test(colour) && !/edge or a badge|corner tab/.test(colour), 'BRAND.md, Colour: authorship is a byline (no edge, badge or corner tab)');
  T.ok(/track sheet\s+of signed lines/.test(studio) && !/column of warm and cool\s+edges/.test(studio), 'BRAND.md, In the studio: History is a track sheet of signed lines');
  T.ok(/tape box/.test(illus) && !/above each section \(`01/.test(illus), 'BRAND.md, Illustration: the numbered slate only on the tape box');
  T.ok(fs.existsSync(path.join(ROOT, 'design/LINER-NOTES-KIT.md')), 'design/LINER-NOTES-KIT.md is there for the surfaces');

  const NEW = ['--rule', '--rule-2', '--rule-heavy', '--r-press', '--paper', '--ink', '--ink-2', '--ink-human', '--ink-agent'];
  const gone = NEW.filter((n) => !(n in tok));
  T.ok(!gone.length, `tokens.css has the Liner notes names${gone.length ? ' (missing ' + gone.join(' ') + ')' : ` (${NEW.join(' ')})`}`);
  const px = (v) => (/^0(px)?$/.test(v) ? 0 : parseFloat(v));
  T.ok(['--r-1', '--r-2', '--r-press'].every((n) => px(tok[n]) <= 2) && px(tok['--r-3']) === 0, `one radius, 2 px, for things you press; panels square (r-1 ${tok['--r-1']}, r-2 ${tok['--r-2']}, r-3 ${tok['--r-3']}, press ${tok['--r-press']})`);
  T.ok(tok['--shadow-1'] === 'none' && /\d/.test(tok['--shadow-2']), `nothing in the page casts a shadow (--shadow-1 ${tok['--shadow-1']}); floating things keep --shadow-2`);
  T.ok(/2px solid var\(--text\)/.test(tok['--rule-heavy']) && /1px solid var\(--line\)/.test(tok['--rule']), `the rules: hairline ${tok['--rule']}, heavy ${tok['--rule-heavy']}`);
  for (const t of ['--ink', '--ink-2', '--ink-3', '--ink-human', '--ink-agent']) {
    const r = ratio(tok[t], tok['--paper']);
    T.ok(r >= 4.5, `paper: ${t} ${tok[t]} on --paper ${tok['--paper']} is AA (${r.toFixed(2)}:1)`);
  }
  T.ok(ratio('#f07612', tok['--paper']) < 4.5 && ratio('#1b95dc', tok['--paper']) < 4.5, `the riso pair stays off paper text (warm ${ratio('#f07612', tok['--paper']).toFixed(1)}:1, cool ${ratio('#1b95dc', tok['--paper']).toFixed(1)}:1): bylines on paper use --ink-human / --ink-agent`);
  // no track colour may read as the agent: within 30 degrees of its hue AND saturated (slate was #8fa8d4, 18 degrees off at 45%)
  const hsl = (hx) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0;
    if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh = (hh * 60 + 360) % 360; const l = (mx + mn) / 2; return { h: hh, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0 }; };
  const ag = hsl(tok['--agent']);
  const cool = [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => { const c = hsl(tok['--c-' + i]); const dh = Math.min(Math.abs(c.h - ag.h), 360 - Math.abs(c.h - ag.h)); return dh < 30 && c.s > 0.3; });
  const s5 = hsl(tok['--c-5']);
  T.ok(!cool.length, `no track colour reads as the agent's cool (slate ${tok['--c-5']}: hue ${s5.h.toFixed(0)}°, ${(s5.s * 100).toFixed(0)}% vs agent ${ag.h.toFixed(0)}°${cool.length ? '; too close: ' + cool.map((i) => '--c-' + i).join(' ') : ''})`);
  for (const f of ['app/src/ui/provenance.js', 'app/src/core/dawproject.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = /'c-5':\s*'(#[0-9a-f]{6})'/.exec(src);
    T.ok(m && m[1] === tok['--c-5'], `${f} prints slate as tokens.css does (${m && m[1]})`);
  }

  const appCss = fs.readFileSync(path.join(ROOT, 'app/style/app.css'), 'utf8');
  const stripes = appCss.match(/inset\s+-?\d+(\.\d+)?px\s+0\s+0[^;]*var\(--(human|agent|accent-2|text-3)\)|border-(left|right|inline-start)\s*:\s*\d+px\s+solid/g) || [];
  T.ok(!stripes.length, `app.css draws no side stripe${stripes.length ? ' (' + stripes.join('; ') + ')' : ''}`);
  const pills = appCss.match(/border-radius:\s*(99|999|9999)px|border-radius:\s*50%/g) || [];
  T.ok(!pills.length, `app.css has no pill radii (${pills.length})`);
  T.ok(!/\.by-(human|agent)\s*\{[^}]*box-shadow/.test(appCss) && !/\.badge-(agent|human)\s*\{[^}]*(99px|background:\s*var\(--(agent|human)-wash)/.test(appCss), 'the old .by-* stripe and .badge-* pill rules are gone (the names stay as bylines)');
  for (const c of ['.btn', '.btn-go', '.btn-txt', '.tog', '.ledger', '.sheet-head', '.num', '.disp', '.disp-s', '.crop', '.paper', '.empty']) {
    T.ok(new RegExp('(^|[\\s,}])' + c.replace('.', '\\.') + '[\\s,{:.]').test(appCss), `app.css has the shared ${c}`);
  }
  const domSrc = fs.readFileSync(path.join(ROOT, 'app/src/ui/dom.js'), 'utf8');
  const path_ = (n) => ((new RegExp(`\\n\\s*${n}: '([^']*)'`).exec(domSrc) || [])[1] || '');
  T.ok(/export function byline\(/.test(domSrc) && /export function authorOf\(/.test(domSrc), 'dom.js exports byline() and authorOf()');
  T.ok(!/<circle/.test(path_('agent')) && /--agent/.test(path_('agent')) && /--agent/.test(path_('sparkle')) && !/z"/.test(path_('sparkle')),
    `icon('agent') and icon('sparkle') are a plain cool stroke (no face, no star): ${path_('agent')}`);
}

// ---- assets: the Weave
for (const f of ['logo.svg', 'wordmark.svg', 'wordmark-ink.svg', 'favicon.svg']) {
  const a = path.join(ROOT, 'app/assets', f), s = path.join(ROOT, 'site/assets', f);
  T.ok(fs.existsSync(a) && fs.existsSync(s) && fs.readFileSync(a).equals(fs.readFileSync(s)), `${f} in app/assets and site/assets, identical`);
}
{
  const logo = fs.readFileSync(path.join(ROOT, 'app/assets/logo.svg'), 'utf8');
  const strands = (logo.match(/<path d="M[^"]+" stroke="#[0-9a-f]{6}" mask=/g) || []).length;
  T.ok(strands === 2 && logo.includes('#f07612') && logo.includes('#1b95dc') && !/radialGradient|spiral/i.test(logo), `logo.svg is the Weave: two masked strands, warm and cool (${strands})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overdub-marks-'));
  execFileSync(process.execPath, [path.join(ROOT, 'tools/brand-marks.js'), tmp]);
  const same = ['logo.svg', 'favicon.svg', 'wordmark.svg', 'wordmark-ink.svg'].filter((f) => fs.readFileSync(path.join(tmp, f)).equals(fs.readFileSync(path.join(ROOT, 'app/assets', f))));
  T.ok(same.length === 4, `tools/brand-marks.js regenerates the installed marks exactly (${same.join(' ')})`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- copy: the old theme is gone (the Sketch tab's pitch spiral is real music theory and may be named once, in a screenshot's alt)
{
  const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8') + fs.readFileSync(path.join(ROOT, 'site/llms.txt'), 'utf8') + fs.readFileSync(path.join(ROOT, 'site/assets/og-card.html'), 'utf8');
  const bad = (html.match(/\bworms?\b|earworm|stuck in your head|out of your head|fraunces|soil|burrow/gi) || []);
  T.ok(!bad.length, `no worm, soil or "stuck in your head" copy on the page${bad.length ? ' (' + [...new Set(bad)].join(', ') + ')' : ''}`);
  const spirals = (html.match(/spiral/gi) || []).length;
  T.ok(spirals <= 1, `the spiral is no longer the brand (${spirals} mention, the Sketch screenshot)`);
}
// ---- session notes (section 08): every number and every demo link is the studio's, counted from the source
{
  const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  const sec = (html.match(/<section class="reel"[\s\S]*?<\/section>/) || [''])[0];
  T.ok(/<h2[^>]*>(?:<[^>]+>)*Since the last session\.</.test(sec), 'session notes: the section is there, under its head');
  const [{ BUILTINS }, { SHOWCASE }, { LIBRARY_DEFS }, { DEMOS }, { TRANSFORMS }] = await Promise.all([
    import('../app/src/devices/builtin/index.js'), import('../app/src/devices/showcase.js'), import('../app/src/devices/library/index.js'),
    import('../app/src/core/demo.js'), import('../app/src/core/transforms.js')]);
  const all = [...BUILTINS, ...SHOWCASE, ...LIBRARY_DEFS];
  const tasks = fs.readdirSync(path.join(ROOT, 'tools/bench/tasks')).filter((f) => f.endsWith('.json')).length;
  const real = { devices: all.length, 'agent-devices': all.filter((d) => d.by === 'claude').length, transforms: TRANSFORMS.length, 'bench-tasks': tasks };
  const said = Object.fromEntries([...sec.matchAll(/data-count="([a-z-]+)">(\d+)</g)].map((m) => [m[1], +m[2]]));
  const wrong = Object.keys(real).filter((k) => said[k] !== real[k]);
  T.ok(!wrong.length, `session notes: the counts are real (${Object.entries(real).map(([k, v]) => `${k} ${said[k]}/${v}`).join(', ')})`);
  const more = DEMOS.slice(1);
  const words = { 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16 };
  const n = words[((sec.match(/(\w+) more songs/i) || [])[1] || '').toLowerCase()];
  T.ok(n === more.length, `session notes: "${(sec.match(/\w+ more songs/i) || ['?'])[0]}" (${more.length} besides ${DEMOS[0].title})`);
  const cards = [...sec.matchAll(/href="\/app\/\?demo=([a-z-]+)"[^>]*><b>([^<]+)<\/b><span>([^<]+)<\/span><span>(\d+) bpm(?: ·|,) ([^<]+)<\/span>/g)].map((m) => ({ id: m[1], title: m[2], genre: m[3], tempo: +m[4], key: m[5] }));
  const off = more.filter((d) => !cards.some((c) => c.id === d.id && c.title === d.title && c.genre === d.genre && c.tempo === d.tempo && c.key === d.key));
  T.ok(cards.length === more.length && !off.length, `session notes: a link per demo song, with its real title, genre, tempo and key${off.length ? ' (wrong: ' + off.map((d) => d.id).join(', ') + ')' : ` (${cards.map((c) => c.id).join(', ')})`}`);
  // "vibes by Claude": the part named on each card is one Claude played in that song
  const bys = [...sec.matchAll(/\?demo=([a-z-]+)"[\s\S]*?class="rn-by">([^<]+) by (?:<span class="by by-agent">)?Claude</g)].map((m) => ({ id: m[1], part: m[2].replace(/^an? /, '') }));
  const unbacked = bys.filter((b) => { const d = more.find((x) => x.id === b.id); return !d || !new RegExp(`${b.part}[^,]* by Claude`, 'i').test(d.line); });
  T.ok(bys.length === more.length && !unbacked.length, `session notes: each card's Claude part is in the song's own line${unbacked.length ? ' (' + unbacked.map((b) => b.id).join(', ') + ')' : ''}`);
}

const og = path.join(ROOT, 'site/assets/og.png');
if (T.ok(fs.existsSync(og), 'og.png exists')) {
  const b = fs.readFileSync(og);
  T.ok(b.readUInt32BE(16) === 1200 && b.readUInt32BE(20) === 630, `og.png is 1200x630 (${b.readUInt32BE(16)}x${b.readUInt32BE(20)}), ${(b.length / 1024).toFixed(0)} KB`);
}

for (const f of ['studio.webp', 'studio-960.webp', 'rack.webp', 'sketch.webp', 'history.webp']) {
  const fp = path.join(ROOT, 'site/assets', f);
  T.ok(fs.existsSync(fp) && fs.statSync(fp).size <= 400 * 1024, `${f}: a real studio screenshot (node tools/shots.js), under 400 KB${fs.existsSync(fp) ? ' (' + (fs.statSync(fp).size / 1024).toFixed(0) + ' KB)' : ''}`);
}

const canvasShot = (page) => page.locator('#weave').screenshot();

// ---- desktop
{
  const { page, errors, close } = await open('/', { width: 1440, height: 900 });
  await page.waitForFunction(() => window.__overdub_site && window.__overdub_site.ready, null, { timeout: 10000 });
  await page.waitForTimeout(900);
  const a = await canvasShot(page);
  await page.waitForTimeout(700);
  const b = await canvasShot(page);
  T.ok(!a.equals(b), 'desktop: the Weave animates (two frames differ)');
  const f0 = await page.evaluate(() => window.__overdub_site.frames);
  await page.waitForTimeout(1000);
  const f1 = await page.evaluate(() => window.__overdub_site.frames);
  T.ok(f1 - f0 >= 30, `desktop: the loop runs (${f1 - f0} frames in 1 s; headless)`);
  const cross = await page.evaluate(() => window.__overdub_site.weave.state.crossings);
  T.ok(cross >= 3, `desktop: the strands cross on screen, taking turns on top (${cross} crossings)`);
  const h1 = await page.evaluate(() => { const h = document.querySelector('h1'); const b = h.querySelector('.over-b'); return { text: h.querySelector('.over-a').textContent.replace(/\s+/g, ' '), hidden: b && b.getAttribute('aria-hidden'), blend: b && getComputedStyle(b).mixBlendMode, font: getComputedStyle(h).fontFamily, style: getComputedStyle(h).fontStyle }; });
  T.ok(h1.text === 'Play over each other.' && h1.hidden === 'true' && h1.blend === 'screen', `desktop: the headline is "Play over each other.", overprinted (${JSON.stringify(h1)})`);
  T.ok(/Archivo/.test(h1.font) && h1.style === 'italic', `desktop: display type is Archivo, italic (${h1.font.split(',')[0]} ${h1.style})`);
  const fontsOk = await page.evaluate(() => document.fonts.ready.then(() => document.fonts.check('italic 800 40px Archivo')));
  T.ok(fontsOk, 'desktop: Archivo ExtraBold Italic loaded (from the site: no network beyond it needed)');
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  T.ok(sw[0] <= sw[1], `desktop: no horizontal scroll (${sw[0]} <= ${sw[1]})`);
  const ctas = await page.$$eval('a[href="/app/"]', (as) => as.map((x) => x.textContent.trim()));
  T.ok(ctas.filter((t) => t === 'Open the studio').length >= 4, `"Open the studio" links to /app/ (${ctas.length})`);
  const lazy = await page.$$eval('.studio img', (im) => im.map((x) => x.loading));
  T.ok(lazy.length === 4 && lazy.every((l) => l === 'lazy'), `studio: four real screenshots, lazy-loaded (${lazy.join(' ')})`);
  await page.locator('.studio-cta').scrollIntoViewIfNeeded();
  // (the main shot is the reduced-motion fallback for the film: hidden, so never loaded, unless motion is reduced)
  const shown = '.studio img:not(.demo-still img)';
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].every((x) => x.complete && x.naturalWidth > 0), shown, { timeout: 8000 }).catch(() => {});
  const loaded = await page.$$eval(shown, (im) => im.filter((x) => x.complete && x.naturalWidth > 0).length);
  T.ok(loaded === 3, `studio: the screenshots load when scrolled to (${loaded}/3)`);
  await page.locator('.demo-film').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForFunction(() => { const v = document.querySelector('.demo-film'); return v && v.readyState >= 2 && !v.paused; }, null, { timeout: 8000 }).catch(() => {});
  const film = await page.evaluate(() => { const v = document.querySelector('.demo-film'); return v ? { muted: v.muted, playing: !v.paused, ready: v.readyState } : null; });
  T.ok(film && film.muted && film.playing, `studio: the demo film autoplays muted (${JSON.stringify(film)})`);
  // WCAG 2.2.2: a looping film needs a way to stop it, and it stays stopped when scrolled away and back
  {
    const pz = page.locator('.film-pause');
    const seen = await pz.isVisible().catch(() => false);
    await pz.click().catch(() => {});
    await page.waitForTimeout(150);
    const held = await page.evaluate(() => { const v = document.querySelector('.demo-film'), b = document.querySelector('.film-pause'); return { paused: v.paused, pressed: b.getAttribute('aria-pressed'), name: b.getAttribute('aria-label') }; });
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
    await page.locator('.demo-film').scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
    const still = await page.evaluate(() => document.querySelector('.demo-film').paused);
    await pz.click().catch(() => {});
    await page.waitForFunction(() => !document.querySelector('.demo-film').paused, null, { timeout: 4000 }).catch(() => {});
    const again = await page.evaluate(() => ({ playing: !document.querySelector('.demo-film').paused, pressed: document.querySelector('.film-pause').getAttribute('aria-pressed') }));
    T.ok(seen && held.paused && held.pressed === 'true' && /play/i.test(held.name) && still && again.playing && again.pressed === 'false',
      `studio: the film has a Pause button that holds across scrolling and plays again (${JSON.stringify({ seen, held, still, again })})`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const meta = await page.evaluate(() => ({ all: ['og:image', 'og:title', 'og:description', 'og:image:alt'].map((p) => !!document.querySelector(`meta[property="${p}"]`)).every(Boolean) && !!document.querySelector('meta[name="twitter:card"]'), title: document.querySelector('meta[property="og:title"]').content, theme: document.querySelector('meta[name="theme-color"]').content }));
  T.ok(meta.all && /play over each other/i.test(meta.title), `social card meta tags present (${meta.title})`);
  T.ok(meta.theme.toLowerCase() === tok['--bg'].toLowerCase(), `theme-color is the room (${meta.theme})`);
  // the signed demo: undo the agent's change, yours stay
  const undo = await page.evaluate(() => { document.querySelector('[data-undo]').click(); const gone = document.querySelector('[data-agent]').classList.contains('is-gone'); const humans = document.querySelectorAll('.n-human').length; const undone = document.querySelectorAll('.h-row.is-undone').length; document.querySelector('[data-undo]').click(); return { gone, humans, undone, back: !document.querySelector('[data-agent]').classList.contains('is-gone') }; });
  T.ok(undo.gone && undo.humans === 7 && undo.undone === 1 && undo.back, "signed: undoing the agent's change keeps yours, and redo brings it back");
  // a knob from the keyboard
  await page.locator('.knob-cap').first().focus();
  const v0 = await page.locator('.knob-cap').first().getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowUp');
  const v1 = await page.locator('.knob-cap').first().getAttribute('aria-valuenow');
  T.ok(Number(v1) > Number(v0), `pedal: a knob turns from the keyboard (${v0} -> ${v1})`);
  await page.keyboard.press('ArrowDown');
  // play the pedal and watch the ears
  await page.click('[data-play]');
  await page.waitForTimeout(1600);
  const m = await page.evaluate(() => window.__overdub_site.meter);
  T.ok(m && isFinite(m.lufs) && m.lufs > -40, `pedal: the meter hears it (momentary ${m && m.lufs.toFixed(1)} LUFS, peak ${m && m.peak.toFixed(1)} dBFS)`);
  T.ok(m && m.peak <= -1, 'pedal: live peak stays at or below -1 dBFS');
  await page.click('[data-play]');
  await page.screenshot({ path: path.join(OUTDIR, 'landing-1440.png'), fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUTDIR, 'landing-1440-fold.png') });
  T.ok(!errors.length, `desktop: no console or page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await close();
}

// ---- the type, from the site: app/style/fonts.css (tokens.css imports it) declares the five families, each file a
// woff2 beside its licence, and every page draws in them with nothing fetched from another host
{
  const FONTS = path.join(ROOT, 'app/style/fonts');
  const readOr = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
  const css = readOr(path.join(ROOT, 'app/style/fonts.css'));
  const tokens = readOr(path.join(ROOT, 'app/style/tokens.css'));
  const rules = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => ({
    family: /font-family:\s*'([^']+)'/.exec(m[1])?.[1], style: /font-style:\s*([^;]+);/.exec(m[1])?.[1], weight: /font-weight:\s*([^;]+);/.exec(m[1])?.[1], url: /src:\s*url\(([^)]+)\)/.exec(m[1])?.[1] }));
  const missing = rules.filter((r) => !r.url || !fs.existsSync(path.join(ROOT, 'app/style', r.url))).map((r) => r.url);
  const families = [...new Set(rules.map((r) => r.family))].sort();
  const dirs = fs.existsSync(FONTS) ? fs.readdirSync(FONTS).filter((d) => fs.statSync(path.join(FONTS, d)).isDirectory()) : [];
  const unlicensed = dirs.filter((d) => !/SIL Open Font License, Version 1\.1/.test(fs.existsSync(path.join(FONTS, d, 'OFL.txt')) ? fs.readFileSync(path.join(FONTS, d, 'OFL.txt'), 'utf8') : ''));
  const strays = dirs.flatMap((d) => fs.readdirSync(path.join(FONTS, d)).filter((f) => !/\.woff2$/.test(f) && f !== 'OFL.txt').map((f) => `${d}/${f}`));
  const weights = (fam) => [...new Set(rules.filter((r) => r.family === fam).map((r) => `${r.style} ${r.weight}`))].sort().join(', ');
  T.ok(/^@import url\('fonts\.css'\);$/m.test(tokens) && !/https?:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')) && !/googleapis|gstatic/.test(tokens),
    'tokens.css imports app/style/fonts.css, and neither names another host');
  T.ok(rules.length >= 5 && !missing.length && JSON.stringify(families) === JSON.stringify(['Archivo', 'Atkinson Hyperlegible Mono', 'Atkinson Hyperlegible Next', 'Rubik Dirt', 'Silkscreen']),
    `fonts.css: ${rules.length} faces in ${families.length} families (${families.join(', ')}), every file on the site${missing.length ? '; missing: ' + missing.join(', ') : ''}`);
  T.ok(dirs.length === 5 && !unlicensed.length && !strays.length, `each family's folder in app/style/fonts holds its woff2 files and its licence, the OFL 1.1 (${dirs.join(', ')})${unlicensed.length ? '; no licence: ' + unlicensed.join(', ') : ''}${strays.length ? '; other files: ' + strays.join(', ') : ''}`);
  T.ok(weights('Archivo') === 'italic 400 900, normal 400 900' && weights('Atkinson Hyperlegible Next') === 'normal 400, normal 600, normal 700' && weights('Atkinson Hyperlegible Mono') === 'normal 400, normal 600' && weights('Rubik Dirt') === 'normal 400' && weights('Silkscreen') === 'normal 400',
    `only the weights and styles the pages use, as they were declared before: Archivo ${weights('Archivo')}; Next ${weights('Atkinson Hyperlegible Next')}; Mono ${weights('Atkinson Hyperlegible Mono')}; Rubik Dirt ${weights('Rubik Dirt')}; Silkscreen ${weights('Silkscreen')}`);

  // in the page: every family a page draws in is loaded, and every font file it fetched came from /app/style/fonts/
  const { page, base, errors, close } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const BRAND = ['Archivo', 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible Mono'];
  const PAGES = [['the studio', '/app/?demo', BRAND, 'html[data-ready="1"]'], ['the landing page', '/', BRAND, null], ['a docs page', '/site/docs/guide.html', BRAND, null],
    ['the device faces (gallery)', '/app/gallery.html?only=pedal.quack,amp.punk,core.keys', ['Rubik Dirt', 'Silkscreen', 'Atkinson Hyperlegible Next'], null]];
  const off = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== new URL(base).host) off.push(u.host); });
  for (const [what, route, want, ready] of PAGES) {
    await page.goto(base + route, { waitUntil: 'load' });
    if (ready) await page.waitForSelector(ready, { timeout: 30000 }).catch(() => {});
    if (/gallery/.test(route)) await page.waitForFunction(() => window.__gallery?.ready, null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const f = await page.evaluate(async (want) => {
      await document.fonts.ready;
      const name = (x) => String(x.family).replace(/^["']|["']$/g, '');
      const loaded = [...new Set([...document.fonts].filter((x) => x.status === 'loaded').map(name))];
      const files = performance.getEntriesByType('resource').filter((e) => /\.woff2(\?|$)/.test(e.name)).map((e) => e.name);
      return { missing: want.filter((w) => !loaded.includes(w)), loaded, files, foreign: files.filter((u) => !u.startsWith(location.origin + '/app/style/fonts/')) };
    }, want);
    T.ok(!f.missing.length && f.files.length && !f.foreign.length, `${what}: ${want.join(', ')} loaded, from ${f.files.length - f.foreign.length} font files in /app/style/fonts/${f.missing.length ? '; not loaded: ' + f.missing.join(', ') : ''}${f.foreign.length ? `; ${f.foreign.length} from elsewhere: ${f.foreign.slice(0, 2).join(', ')}` : ''}`);
    if (route.startsWith('/app/?demo')) {
      // the top bar's title fits itself once the bar settles, however early the fonts arrive (this is the page's second
      // load, so they're quick: with the faces in before the bar settled, "Night Shift" used to stay cut at 18 px)
      await page.waitForTimeout(400);
      const tt = await page.evaluate(() => { const t = document.querySelector('.tp-title'); return { text: t.textContent, size: getComputedStyle(t).fontSize, cut: t.scrollWidth > t.clientWidth + 1 }; });
      T.ok(!tt.cut, `the studio's top bar: the song title fits once the bar settles ("${tt.text}" at ${tt.size}${tt.cut ? ', cut with an ellipsis' : ''})`);
    }
  }
  T.ok(!off.length && !errors.length, `and none of those pages asked another host for anything${off.length ? ' (' + [...new Set(off)].join(', ') + ')' : ''}${errors.length ? '; errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
  await close();
}

// ---- session notes in the page: every link resolves, and a demo link opens that song in the studio
{
  const { page, base, errors, close } = await open('/', { width: 1440, height: 900 });
  const links = await page.$$eval('.reel a[href], .studio-cta a[href], footer a[href]', (as) => as.map((a) => a.getAttribute('href')));
  const bad = [];
  for (const href of links) { const r = await fetch(new URL(href, base)).catch(() => null); if (!r || r.status !== 200) bad.push(`${href} ${r ? r.status : 'no answer'}`); }
  T.ok(links.length >= 8 && !bad.length, `session notes: ${links.length} links in it, the studio CTA and the footer resolve${bad.length ? ' (' + bad.join(', ') + ')' : ''}`);
  const guide = await page.$$eval('a[href="/site/docs/guide.html"]', (as) => as.length);
  T.ok(guide >= 2, `the page points newcomers at the guide (${guide} links)`);
  const href = await page.getAttribute('.reel a[href*="?demo="]', 'href');
  await page.goto(new URL(href, base).href, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 }).catch(() => {});
  const title = await page.evaluate(() => window.overdub?.store?.get().title);
  const want = await page.evaluate(async (id) => (await import('/app/src/core/demo.js')).DEMOS.find((d) => d.id === id)?.title, href.split('=')[1]);
  T.ok(title && title === want, `session notes: ${href} opens “${title}” in the studio (want “${want}”)`);
  T.ok(!errors.length, `session notes: no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await close();
}

// ---- phone
{
  const { page, errors, close } = await open('/', { width: 390, height: 844 });
  await page.waitForFunction(() => window.__overdub_site && window.__overdub_site.ready, null, { timeout: 10000 });
  await page.waitForTimeout(1200);
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  T.ok(sw[0] <= 390, `390: no horizontal scroll (${sw[0]})`);
  const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > 391 || r.left < -1); }).map((e) => e.tagName + '.' + e.className).slice(0, 5));
  T.ok(!wide.length, `390: nothing sticks out sideways${wide.length ? ' (' + wide.join(', ') + ')' : ''}`);
  const fold = await page.evaluate(() => { const l = document.querySelector('.legend').getBoundingClientRect(), c = document.querySelector('.hero .btn--primary').getBoundingClientRect(); return { legend: l.bottom, cta: c.bottom }; });
  T.ok(fold.legend <= 844, `390: the title, the Weave and its legend fit the first screen (legend ends at ${Math.round(fold.legend)} px)`);
  T.ok(fold.cta <= 844, `390: "Open the studio" is on the first screen (ends at ${Math.round(fold.cta)} px)`);
  const a = await canvasShot(page); await page.waitForTimeout(600); const b = await canvasShot(page);
  T.ok(!a.equals(b), '390: the Weave animates');
  // a phone-class CPU: 4x slower. One frame of the Weave has to fit well inside 16.7 ms.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const cost = await page.evaluate(() => new Promise((res) => {
    const w = window.__overdub_site.weave, f = w.frame, ts = [];
    w.frame = (now) => { const t0 = performance.now(); f(now); ts.push(performance.now() - t0); };
    setTimeout(() => { w.frame = f; ts.sort((x, y) => x - y); res({ n: ts.length, median: ts[ts.length >> 1], p95: ts[Math.floor(ts.length * 0.95)] }); }, 1500);
  }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  T.ok(cost.n > 20 && cost.p95 < 8, `390, CPU 4x slower: a Weave frame costs ${cost.median.toFixed(2)} ms median, ${cost.p95.toFixed(2)} ms p95 (budget 8 of 16.7 ms; ${cost.n} frames)`);
  const tiny = await page.evaluate(() => [...document.querySelectorAll('.btn, .knob-cap, .face-foot, .top-cta')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.height < 24 || r.width < 24); }).map((e) => e.className + ' ' + Math.round(e.getBoundingClientRect().width)));
  T.ok(!tiny.length, `390: touch targets are at least 24 px${tiny.length ? ' (' + tiny.join(', ') + ')' : ''}`);
  await page.screenshot({ path: path.join(OUTDIR, 'landing-390.png'), fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUTDIR, 'landing-390-fold.png') });
  T.ok(!errors.length, `390: no console or page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await close();
}

// ---- reduced motion
{
  const { page, errors, close } = await open('/', { width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__overdub_site && window.__overdub_site.ready, null, { timeout: 10000 });
  await page.waitForTimeout(800);
  const f0 = await page.evaluate(() => window.__overdub_site.frames);
  const a = await canvasShot(page); await page.waitForTimeout(900); const b = await canvasShot(page);
  const f1 = await page.evaluate(() => window.__overdub_site.frames);
  T.ok(a.equals(b) && f1 === f0, `reduced motion: the Weave holds still (${f1 - f0} frames in 0.9 s)`);
  const n = await page.evaluate(() => window.__overdub_site.weave.state.crossings);
  T.ok(n >= 3, `reduced motion: the still frame tells the whole story (${n} crossings, taking turns)`);
  const film = await page.evaluate(() => { const v = document.querySelector('.demo-film'); return { video: getComputedStyle(v).display, still: getComputedStyle(document.querySelector('.demo-still')).display, paused: v.paused }; });
  T.ok(film.video === 'none' && film.still !== 'none' && film.paused, `reduced motion: the film gives way to the still screenshot (${JSON.stringify(film)})`);
  await page.screenshot({ path: path.join(OUTDIR, 'landing-reduced-fold.png') });
  T.ok(!errors.length, `reduced motion: no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await close();
}

// ---- hum into it, with a fake mic humming A3, C4, E4
{
  const sr = 48000, seq = [[57, 0.9], [null, 0.35], [60, 0.9], [null, 0.35], [64, 0.9], [null, 0.6]];
  const total = seq.reduce((s, x) => s + x[1], 0), n = Math.round(sr * total);
  const pcm = new Int16Array(n); let i = 0, ph = 0;
  for (const [m, d] of seq) {
    const len = Math.round(sr * d), f = m ? 440 * 2 ** ((m - 69) / 12) : 0;
    for (let k = 0; k < len && i < n; k++, i++) {
      const env = Math.min(1, k / 800, (len - k) / 800);
      const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * k / sr);
      ph += 2 * Math.PI * f * vib / sr;
      pcm[i] = m ? Math.round(9000 * env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph)) / 1.5) : 0;
    }
  }
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(n * 2, 40); Buffer.from(pcm.buffer).copy(wav, 44);
  const wavPath = path.join(OUTDIR, 'brand-hum.wav'); fs.writeFileSync(wavPath, wav);
  const { page, errors, close } = await open('/', { width: 1440, height: 900, fakeAudio: wavPath });
  await page.waitForFunction(() => window.__overdub_site && window.__overdub_site.ready, null, { timeout: 10000 });
  await page.click('#hum');
  await page.waitForFunction(() => window.__overdub_site.mode === 'live', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(Math.ceil(total * 1000 * 2) + 400);
  const res = await page.evaluate(() => ({ mode: window.__overdub_site.mode, names: window.__overdub_site.weave.state.notes.map((x) => x.name), answers: window.__overdub_site.weave.state.answers, pressed: document.querySelector('#hum').getAttribute('aria-pressed') }));
  T.ok(res.mode === 'live' && res.pressed === 'true', 'hum: the button turns the mic on after a click');
  const got = new Set(res.names);
  T.ok(['A3', 'C4', 'E4'].every((x) => got.has(x)), `hum: hummed A3 C4 E4 light up as notes (${res.names.join(' ')})`);
  const stray = res.names.filter((x) => !['A3', 'C4', 'E4'].includes(x));
  T.ok(stray.length <= 1, `hum: no stray notes (${stray.join(' ') || 'none'})`);
  T.ok(res.answers >= 2, `hum: the cool strand answers each move (${res.answers} answers)`);
  await page.screenshot({ path: path.join(OUTDIR, 'landing-hum.png') });
  await page.click('#hum');
  const off = await page.evaluate(() => window.__overdub_site.mode);
  T.ok(off === 'demo', 'hum: pressing again stops listening and the demo resumes');
  T.ok(!errors.length, `hum: no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await close();
}

// ---- Cathedral Below, measured offline (BS.1770-4 integrated loudness with gating; true peak, 4x oversampled)
{
  const { page, errors, close } = await open('/', { width: 800, height: 600 });
  const r = await page.evaluate(async () => {
    const { buildCathedral, renderStrum, LEVELS } = await import('/site/assets/pedal.js');
    const SR = 48000;
    // K-weighting at 48 kHz (BS.1770-4 table 1 and 2)
    function kfilter(x) {
      const y = new Float64Array(x.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      const b = [1.53512485958697, -2.69169618940638, 1.19839281085285], a = [-1.69065929318241, 0.73248077421585];
      for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
      const z = new Float64Array(x.length); x1 = x2 = y1 = y2 = 0;
      const a2 = [-1.99004745483398, 0.99007225036621];
      for (let i = 0; i < x.length; i++) { const v = y[i] - 2 * x1 + x2 - a2[0] * y1 - a2[1] * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; z[i] = v; }
      return z;
    }
    function lufs(chs) {
      const k = chs.map(kfilter), N = k[0].length, blk = Math.round(0.4 * SR), hop = Math.round(0.1 * SR), z = [];
      for (let s = 0; s + blk <= N; s += hop) { let e = 0; for (const c of k) { let q = 0; for (let i = s; i < s + blk; i++) q += c[i] * c[i]; e += q / blk; } z.push(e); }
      const L = (e) => -0.691 + 10 * Math.log10(e);
      const abs = z.filter((e) => L(e) > -70);
      if (!abs.length) return -Infinity;
      const rel = L(abs.reduce((s, e) => s + e, 0) / abs.length) - 10;
      const g = abs.filter((e) => L(e) > rel);
      return L(g.reduce((s, e) => s + e, 0) / g.length);
    }
    function truePeak(chs) {
      const taps = 12, h = [];
      for (let p = 0; p < 4; p++) { const row = []; for (let k = -taps; k <= taps; k++) { const t = k - p / 4; const w = 0.5 + 0.5 * Math.cos(Math.PI * t / (taps + 1)); row.push(t === 0 ? 1 : (Math.sin(Math.PI * t) / (Math.PI * t)) * w); } h.push(row); }
      let pk = 0;
      for (const x of chs) for (let n = taps; n < x.length - taps; n++) { for (let p = 0; p < 4; p++) { let s = 0; const row = h[p]; for (let k = 0; k < row.length; k++) s += row[k] * x[n + k - taps]; const a = Math.abs(s); if (a > pk) pk = a; } }
      return 20 * Math.log10(pk + 1e-12);
    }
    const strum = renderStrum(SR);
    async function render(params, on = true) {
      const len = strum.L.length + SR * 3;
      const c = new OfflineAudioContext(2, len, SR);
      const buf = c.createBuffer(2, strum.L.length, SR); buf.copyToChannel(strum.L, 0); buf.copyToChannel(strum.R, 1);
      const src = c.createBufferSource(); src.buffer = buf;
      const rig = buildCathedral(c, params); rig.setOn(on, 0);
      src.connect(rig.input); rig.output.connect(c.destination); src.start(0);
      const out = await c.startRendering();
      const chs = [out.getChannelData(0), out.getChannelData(1)];
      let nan = false, h = 0; for (const x of chs) for (let i = 0; i < x.length; i++) { if (!isFinite(x[i])) nan = true; h = (Math.imul(h, 31) + Math.round(x[i] * 1e6)) | 0; }
      return { lufs: lufs(chs), tp: truePeak(chs), nan, hash: h, x: chs[0] };
    }
    const cases = {
      dry: [{ mix: 0 }], bypass: [{}, false], defaults: [{}], wet: [{ mix: 10 }],
      'wet murk 0': [{ mix: 10, murk: 0 }], 'wet murk 10': [{ mix: 10, murk: 10 }], 'wet nave 0': [{ mix: 10, nave: 0 }], 'wet nave 10': [{ mix: 10, nave: 10 }],
      'wet depth 10': [{ mix: 10, depth: 10 }], 'all max': [{ mix: 10, murk: 10, nave: 10, depth: 10 }], 'all min': [{ mix: 10, murk: 0, nave: 0, depth: 0 }],
    };
    const out = { LEVELS };
    for (const [k, [p, on]] of Object.entries(cases)) out[k] = await render(p, on);
    out.again = await render({});
    let d = 0; for (let i = 0; i < out.again.x.length; i++) d = Math.max(d, Math.abs(out.again.x[i] - out.defaults.x[i]));
    out.diffDb = 20 * Math.log10(d + 1e-12);
    for (const v of Object.values(out)) if (v && v.x) delete v.x;
    return out;
  });
  T.note('Cathedral Below, offline at 48 kHz (integrated LUFS / true peak dBTP):');
  for (const [k, v] of Object.entries(r)) if (v && typeof v === 'object' && 'lufs' in v) T.note(`  ${k.padEnd(13)} ${v.lufs.toFixed(2).padStart(7)} LUFS  ${v.tp.toFixed(2).padStart(6)} dBTP${v.nan ? '  NaN!' : ''}`);
  const dry = r.dry.lufs;
  T.ok(Math.abs(dry + 18) <= 1, `pedal: the dry strum sits near -18 LUFS (${dry.toFixed(2)})`);
  T.ok(Math.abs(r.bypass.lufs - dry) <= 0.1, `pedal: bypass is the dry guitar (${(r.bypass.lufs - dry).toFixed(2)} LU)`);
  T.ok(Math.abs(r.defaults.lufs - dry) <= 1, `pedal: at its defaults it matches the dry guitar within 1 LU (${(r.defaults.lufs - dry).toFixed(2)} LU)`);
  T.ok(Math.abs(r.wet.lufs - dry) <= 1, `pedal: fully wet within 1 LU of dry (${(r.wet.lufs - dry).toFixed(2)} LU)`);
  const spread = Object.entries(r).filter(([k, v]) => v && typeof v === 'object' && 'lufs' in v && k.startsWith('wet') || k.startsWith('all')).map(([k, v]) => [k, v.lufs - dry]);
  const worst = spread.reduce((w, x) => (Math.abs(x[1]) > Math.abs(w[1]) ? x : w), ['', 0]);
  T.ok(Math.abs(worst[1]) <= 2, `pedal: every extreme within 2 LU of dry (worst ${worst[0]}: ${worst[1].toFixed(2)} LU)`);
  const tpMax = Math.max(...Object.values(r).filter((v) => v && typeof v === 'object' && 'tp' in v).map((v) => v.tp));
  T.ok(tpMax <= -1, `pedal: true peak at or below -1 dBTP everywhere (max ${tpMax.toFixed(2)})`);
  T.ok(!Object.values(r).some((v) => v && v.nan), 'pedal: no NaN');
  // Seeded rooms and a seeded strum; the native nodes (Chrome's convolver) may differ far below hearing between renders.
  T.ok(r.diffDb < -90, `pedal: renders the same every time (largest difference between two renders ${r.diffDb.toFixed(0)} dBFS)`);
  T.ok(!errors.length, `pedal render: no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await close();
}

// ---- bylines in the studio: byline() and the old class names, as the browser draws them
{
  const { page, errors, close } = await open('/app/', { query: 'demo', width: 1280, height: 800 });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const { byline, h } = await import('/app/src/ui/dom.js');
    const app = window.overdub;
    const box = h('div', { style: { position: 'fixed', left: '0', top: '0', fontSize: '13px' } });
    const paper = h('div.paper');
    const card = h('div.sk-idea.by-human', 'a card that used to wear a stripe');
    const pill = h('span.badge-agent', 'Claude');
    const mk = (by, o) => byline(by, o);
    const bys = { you: mk('you'), cap: mk('you', { cap: true }), claude: mk('claude', { app }), mcp: mk('mcp:cursor'), house: mk('overdub', { app }), none: mk(null) };
    const onPaper = byline('claude'), onPaperH = byline('you');
    paper.append(onPaper, onPaperH);
    box.append(bys.you, bys.cap, bys.claude, bys.mcp, paper, card, pill);
    document.body.append(box);
    const cs = (el) => getComputedStyle(el);
    const tokv = (n) => { const d = h('span', { style: { color: `var(${n})` } }); document.body.append(d); const c = cs(d).color; d.remove(); return c; };
    const out = {
      you: [bys.you.textContent, bys.you.className, cs(bys.you).color === tokv('--human'), cs(bys.you).fontSize],
      cap: bys.cap.textContent,
      claude: [bys.claude.textContent, bys.claude.className, cs(bys.claude).color === tokv('--agent')],
      mcp: [bys.mcp.textContent, bys.mcp.className],
      house: bys.house === null && bys.none === null,
      paper: [cs(onPaper).color === tokv('--ink-agent'), cs(onPaperH).color === tokv('--ink-human')],
      card: [cs(card).boxShadow, cs(card).color === tokv('--text') || cs(card).color === cs(document.body).color],
      pill: [cs(pill).borderRadius, cs(pill).backgroundColor, cs(pill).color === tokv('--agent'), cs(pill).borderTopWidth],
    };
    const { icon } = await import('/app/src/ui/dom.js');
    const ic = icon('sparkle'), ia = icon('agent');
    box.append(ic, ia);
    out.icon = [ic.querySelectorAll('path').length, cs(ic.querySelector('path')).stroke === tokv('--agent'), ia.querySelectorAll('circle').length];
    box.remove();
    return out;
  });
  T.ok(r.you[0] === 'you' && /\bby\b/.test(r.you[1]) && /by-human/.test(r.you[1]) && r.you[2] && r.you[3] === '13px', `byline('you'): "you" in warm ink at the size of the text it signs (${JSON.stringify(r.you)})`);
  T.ok(r.cap === 'You', `byline('you', { cap: true }) starts a sentence ("${r.cap}")`);
  T.ok(r.claude[0] === 'Claude' && /by-agent/.test(r.claude[1]) && r.claude[2], `byline('claude'): "Claude" in cool ink (${JSON.stringify(r.claude)})`);
  T.ok(r.mcp[0] === 'cursor' && /by-agent/.test(r.mcp[1]), `an MCP client signs with its name, in cool ink (${JSON.stringify(r.mcp)})`);
  T.ok(r.house, 'the house is unsigned: byline(\'overdub\') and byline(null) draw nothing');
  T.ok(r.paper.every(Boolean), `on paper the bylines take the deeper paper inks (${JSON.stringify(r.paper)})`);
  T.ok(r.card[0] === 'none' && r.card[1], `a card still classed .by-human draws no stripe and no tint (box-shadow ${r.card[0]})`);
  T.ok(r.pill[0] === '0px' && /rgba\(0, 0, 0, 0\)|transparent/.test(r.pill[1]) && r.pill[2] && r.pill[3] === '0px', `.badge-agent is a byline now, not a pill (${JSON.stringify(r.pill)})`);
  T.ok(r.icon[0] === 1 && r.icon[1] && r.icon[2] === 0, `icon('sparkle') and icon('agent') draw one cool stroke (${JSON.stringify(r.icon)})`);
  T.ok(!errors.length, `studio bylines: no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await close();
}

T.done();
