// Build the public docs: renders seven Markdown files into site/docs/*.html, in the brand, with no runtime renderer.
//
//   node tools/docs-build.js            write site/docs/index.html (the hub) and one page per doc
//   node tools/docs-build.js --check    write nothing; exit 1 if any page is missing or out of date
//
// Re-run it after editing any of the sources below (tools/pages-test.js runs --check, so a stale page fails the
// checks). The output is deterministic: same Markdown in, same bytes out, so re-running with no edits changes nothing.
// The pages are served at /site/docs/ (locally by server/serve.js, and by the deploy, which ships site/ as it is).
//
// Sources, in reading order: docs/GUIDE.md, docs/AGENTS.md, integrations/README.md, docs/DEVICES.md, docs/BENCH.md,
// docs/REMOTE-MCP.md, docs/ARCHITECTURE.md. The Markdown renderer is the small subset these files use (headings, paragraphs, nested
// lists, GFM tables, fenced code, block quotes, rules; code spans, links, autolinks, bold, italics, backslash
// escapes). Links between the seven become links between the pages; site-absolute links (/app/...) stay as they are; links to the other shipped docs
// (UX-RESEARCH, VISION, BRAND) go to their raw Markdown at /docs/*.md; links to repo files that aren't served are
// kept as plain text. Every heading gets a GitHub-style id and links to itself. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site/docs');
const CHECK = process.argv.includes('--check');

// The pages. `raw` is where the deploy publishes the Markdown itself (deploy/deploy.sh ships these docs/*.md).
export const DOCS = [
  { slug: 'guide', src: 'docs/GUIDE.md', raw: '/docs/GUIDE.md', label: 'Guide',
    blurb: 'Your first overdub in five minutes, then the rest: bring your own Claude or Claude Code, build a device, share and fork a song, take it to another DAW, and the keys.' },
  { slug: 'agents', src: 'docs/AGENTS.md', raw: '/docs/AGENTS.md', label: 'For agents',
    blurb: 'How an agent connects (Claude Code over MCP to a local copy of the studio, the in-app agent and its free demo, and the claude.ai connector through the Connect tab), the rules of the room, every tool, the ops and the notes format.' },
  { slug: 'integrations', src: 'integrations/README.md', raw: null, label: 'Connect an agent',
    blurb: 'Step by step for Claude Code (the plugin or the MCP server alone), Claude Desktop, Cursor, VS Code and Codex, what has actually been tried, and what to do when it won’t connect.' },
  { slug: 'devices', src: 'docs/DEVICES.md', raw: '/docs/DEVICES.md', label: 'Writing devices',
    blurb: 'Instruments and effects as code: the kernel format, the dsp library, the device check a new device passes before it plays, the house library, and two complete examples.' },
  { slug: 'bench', src: 'docs/BENCH.md', raw: '/docs/BENCH.md', label: 'OverdubBench',
    blurb: 'Fifteen jobs a musician would ask an agent for (mix, write, edit, build a device), each scored 0 to 1 by measurement with the canonical renderer, never by a judge: the tasks, the scoring and how to run an agent.' },
  { slug: 'remote-mcp', src: 'docs/REMOTE-MCP.md', raw: '/docs/REMOTE-MCP.md', label: 'Remote MCP',
    blurb: 'The relay that lets claude.ai drive a studio tab: pairing by URL, the protocol edges, limits, hosting, cost and the known gap.',
    note: 'The relay is live: open the studio’s Connect tab, turn it on, and add the URL to claude.ai as a custom connector.' },
  { slug: 'architecture', src: 'docs/ARCHITECTURE.md', raw: '/docs/ARCHITECTURE.md', label: 'Architecture',
    blurb: 'The contract every module is built against: the song document, ops and the store, devices and kernels, the engine, the measurements, the UI and the agent layer.' },
];
// Other docs the deploy publishes as raw Markdown (deploy/deploy.sh).
const SHIPPED_MD = new Set(['UX-RESEARCH', 'VISION', 'BRAND', 'AGENTS', 'ARCHITECTURE', 'DEVICES', 'REMOTE-MCP', 'GUIDE', 'BENCH']);

// ---------------------------------------------------------------- inline Markdown

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PUNCT = /[!-/:-@[-`{-~]/;

function inline(src, ctx) {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  // Pass 1, left to right: backslash escapes and code spans (nothing inside a code span is Markdown).
  let s = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) { s += hold(esc(src[i + 1])); i += 2; continue; }
    if (c === '`') {
      let n = 0; while (src[i + n] === '`') n++;
      let j = i + n, close = -1;
      while (j < src.length) {
        const k = src.indexOf('`', j); if (k === -1) break;
        let m = 0; while (src[k + m] === '`') m++;
        if (m === n) { close = k; break; }
        j = k + m;
      }
      if (close === -1) { s += hold('`'.repeat(n)); i += n; continue; }
      let code = src.slice(i + n, close).replace(/\n/g, ' ');
      if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim()) code = code.slice(1, -1);
      s += hold(`<code>${esc(code)}</code>`); i = close + n; continue;
    }
    s += c; i++;
  }
  // Pass 2: autolinks, images and links (the label stays in the text, so it gets emphasis like anything else).
  s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, (_, url) => hold(`<a href="${esc(url)}">${esc(url)}</a>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, href) => hold(`<img src="${esc(ctx.href(href) || href)}" alt="${esc(alt)}">`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => {
    const to = ctx.href(href);
    if (!to) return label;   // a repo file that isn't served: keep the words, drop the link
    const ext = /^https?:/.test(to) && !to.startsWith('https://overdubstudio.com');
    return hold(`<a href="${esc(to)}"${ext ? ' rel="noopener"' : ''}>`) + label + hold('</a>');
  });
  // Pass 3: escape what's left, then emphasis.
  s = esc(s);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>');
  // Restore what was held (held HTML never contains placeholders, so one pass is enough).
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => held[n]);
}

// ---------------------------------------------------------------- block Markdown

const RE = {
  fence: /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/,
  heading: /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/,
  quote: /^ {0,3}>\s?/,
  list: /^( {0,3})([-*+]|\d{1,9}[.)])( +)(.*)$/,
  tableSep: /^ {0,3}\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};
const indentOf = (l) => l.match(/^ */)[0].length;
const blank = (l) => !l || !l.trim();
const isTableStart = (lines, i) => /^\s*\|/.test(lines[i]) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]);
const startsBlock = (lines, i) => {
  const l = lines[i];
  if (RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || isTableStart(lines, i)) return true;
  const m = l.match(RE.list);
  return !!(m && (!/\d/.test(m[2]) || parseInt(m[2], 10) === 1));   // an ordered list interrupts a paragraph only at 1
};

export function slugify(text) {
  return text.toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim().replace(/\s/g, '-');
}
const plain = (md) => md.replace(/`([^`]*)`/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1').replace(/\\(.)/g, '$1');

function highlight(code, lang) {
  let h = esc(code);
  // Comments, dimmed: // in JS-ish code, # in shell-ish code. Only at a line start or after whitespace (never in a URL).
  if (/^(js|javascript|json|ts)$/.test(lang)) h = h.replace(/(^|\s)(\/\/[^\n]*)/g, '$1<span class="c">$2</span>');
  if (/^(sh|bash|shell|toml|text)$/.test(lang)) h = h.replace(/(^|\s)(#[^\n]*)/g, (m, a, b) => /^#!/.test(b) ? m : `${a}<span class="c">${b}</span>`);
  return h;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function blocks(lines, ctx, tight = false) {
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    let m;
    if ((m = line.match(RE.fence))) {
      const fence = m[1], lang = m[2].toLowerCase(), ind = indentOf(line);
      const body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[0].repeat(fence.length)) && /^[`~]+\s*$/.test(lines[i].trim()))) {
        body.push(lines[i].slice(Math.min(ind, indentOf(lines[i]))));
        i++;
      }
      i++;
      out += `<div class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><pre><code>${highlight(body.join('\n'), lang)}</code></pre></div>\n`;
      continue;
    }
    if ((m = line.match(RE.heading))) {
      const level = m[1].length, text = m[2];
      const id = ctx.id(plain(text));
      const html = inline(text, ctx).replace(/<\/?a\b[^>]*>/g, '');
      if (level >= 2) ctx.toc.push({ level, id, text: plain(text) });
      out += `<h${level} id="${id}"><a class="h-link" href="#${id}">${html}</a></h${level}>\n`;
      i++; continue;
    }
    if (RE.hr.test(line)) { out += '<hr>\n'; i++; continue; }
    if (RE.quote.test(line)) {
      const body = [];
      while (i < lines.length && !blank(lines[i]) && (RE.quote.test(lines[i]) || !startsBlock(lines, i))) { body.push(lines[i].replace(RE.quote, '')); i++; }
      out += `<blockquote>\n${blocks(body, ctx)}</blockquote>\n`;
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c, ctx)}</${tag}>`;
      const empty = head.every((h) => !h);
      out += '<div class="table-wrap"><table>\n'
        + (empty ? '' : `<thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>\n`)
        + `<tbody>\n${rows.map((r) => `<tr>${head.map((_, k) => cell(empty && k === 0 ? 'th' : 'td', r[k] || '', k)).join('')}</tr>`).join('\n')}\n</tbody></table></div>\n`;
      continue;
    }
    if ((m = line.match(RE.list))) {
      const [html, next] = list(lines, i, ctx);
      out += html; i = next; continue;
    }
    // a paragraph
    const para = [line.trim()];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines, i)) { para.push(lines[i].trim()); i++; }
    const html = inline(para.join('\n'), ctx);
    out += tight ? html + '\n' : `<p>${html}</p>\n`;
  }
  return out;
}

function list(lines, i, ctx) {
  const first = lines[i].match(RE.list);
  const ordered = /\d/.test(first[2]);
  const base = first[1].length;
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let loose = false;
  while (i < lines.length) {
    const m = lines[i].match(RE.list);
    if (!m || Math.abs(m[1].length - base) > 1 || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = m[1].length + m[2].length + Math.min(m[3].length, 4);
    const body = [m[4]];
    let gap = false;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (blank(l)) {
        let j = i; while (j < lines.length && blank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= contentIndent) { for (; i < j; i++) body.push(''); gap = true; continue; }
        const n = j < lines.length && lines[j].match(RE.list);
        if (n && Math.abs(n[1].length - base) <= 1 && /\d/.test(n[2]) === ordered) { loose = true; i = j; }
        else i = j;   // the list ends here
        break;
      }
      const ind = indentOf(l);
      if (ind >= contentIndent) { body.push(l.slice(contentIndent)); i++; continue; }
      const n = l.match(RE.list);
      if (n && n[1].length <= base + 1) break;            // the next item (or a new list)
      if (startsBlock(lines, i) && !n) break;              // a heading, a fence... ends the list
      body.push(l.trim()); i++;                            // a lazy continuation line
    }
    items.push({ body, gap });
  }
  const tag = ordered ? 'ol' : 'ul';
  const lis = items.map((it) => `<li>${blocks(it.body, ctx, !loose && !it.gap).trim()}</li>`).join('\n');
  return [`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>\n${lis}\n</${tag}>\n`, i];
}

export function render(md, { hrefFor } = {}) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const seen = new Map();
  const ctx = {
    toc: [],
    href: hrefFor || ((h) => h),
    id(text) {
      const base = slugify(text) || 'section';
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      return n ? `${base}-${n}` : base;
    },
  };
  // The first H1 is the page title, not part of the body.
  let title = '';
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 !== -1) { title = lines[h1].slice(2).trim(); lines.splice(h1, 1); seen.set(slugify(plain(title)), 1); }
  const html = blocks(lines, ctx);
  return { title, html, toc: ctx.toc };
}

// ---------------------------------------------------------------- links

function hrefFor(doc) {
  const dir = path.posix.dirname(doc.src);
  return (href) => {
    if (/^(https?:|mailto:)/.test(href)) return href;
    if (href.startsWith('#')) return href;
    if (href.startsWith('/')) return href;   // the site's own pages (/app/, /app/library.html)
    const [p, hash = ''] = href.split('#');
    const frag = hash ? '#' + hash : '';
    const target = path.posix.normalize(path.posix.join(dir, p));
    const other = DOCS.find((d) => d.src === target);
    if (other) return `${other.slug}.html${frag}`;
    const md = target.match(/^docs\/([A-Z-]+)\.md$/);
    if (md && SHIPPED_MD.has(md[1])) return `/docs/${md[1]}.md`;
    // Served files (site/, app/) keep a link; anything else in the repo isn't public.
    if (/^(site|app)\//.test(target) && fs.existsSync(path.join(ROOT, target))) return '/' + target + frag;
    return null;
  };
}

// ---------------------------------------------------------------- pages

const HEAD = (title, description) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#141210">
<link rel="icon" href="/site/assets/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Overdub Studio">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="/site/assets/og.png">
<link rel="stylesheet" href="/app/style/tokens.css">
<link rel="stylesheet" href="/site/assets/site.css">
<link rel="stylesheet" href="/site/docs/docs.css">
</head>`;

const TOP = (current) => `<header class="top">
  <a class="brand" href="/" aria-label="Overdub home"><img class="brand-mark" src="/site/assets/logo.svg" alt="" width="40" height="40"><img class="brand-word" src="/site/assets/wordmark.svg" alt="overdub" width="150" height="24"></a>
  <nav class="top-nav" aria-label="Site">
    <a class="top-more" href="/site/docs/guide.html"${current === 'guide' ? ' aria-current="page"' : ''}>Guide</a>
    <a href="/site/docs/"${current === 'docs' ? ' aria-current="page"' : ''}>Docs</a>
    <a href="/site/press/">Press</a>
    <a class="top-cta" href="/app/">Open the studio</a>
  </nav>
</header>`;

const FOOT = `<footer class="foot">
  <div class="wrap foot-inner">
    <img src="/site/assets/wordmark.svg" alt="overdub" width="120" height="19">
    <p>An early prototype by AJ Smith.</p>
    <p class="foot-links"><a href="/">Home</a> <a href="/site/docs/">Docs</a> <a href="/site/press/">Press</a> <a href="/llms.txt">llms.txt</a></p>
  </div>
</footer>`;

// a page's title: display italic, linking to itself (the overprint is the landing page's hero and the tape box's alone)
const over = (tag, id, text, cls = '') => `<${tag} id="${id}"${cls ? ` class="${cls}"` : ''}><a class="h-link" href="#${id}">${text}</a></${tag}>`;

// Small and optional: scrollable code and tables become keyboard-focusable; code blocks get a Copy button;
// "On this page" is open on wide screens.
const SCRIPT = `<script>
(function () {
  var toc = document.querySelector('.toc');
  if (toc && window.matchMedia('(min-width: 961px)').matches) toc.open = true;
  // mark the section you're reading in "On this page"
  var links = {}, hs = [];
  document.querySelectorAll('.toc a[href^="#"]').forEach(function (a) { links[a.hash.slice(1)] = a; });
  document.querySelectorAll('.prose h2[id], .prose h3[id]').forEach(function (h) { if (links[h.id]) hs.push(h); });
  var here = null;
  function spy() {
    var cur = null;
    for (var i = 0; i < hs.length && hs[i].getBoundingClientRect().top < 120; i++) cur = hs[i];
    var a = cur && links[cur.id];
    if (a !== here) { if (here) here.classList.remove('is-here'); if (a) a.classList.add('is-here'); here = a; }
  }
  if (hs.length) { addEventListener('scroll', function () { requestAnimationFrame(spy); }, { passive: true }); spy(); }
  document.querySelectorAll('.code pre, .table-wrap').forEach(function (el) {
    if (el.scrollWidth > el.clientWidth + 1) { el.tabIndex = 0; el.setAttribute('role', 'region'); el.setAttribute('aria-label', el.tagName === 'PRE' ? 'Code (scrolls sideways)' : 'Table (scrolls sideways)'); }
  });
  if (!navigator.clipboard) return;
  document.querySelectorAll('.code').forEach(function (box) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'code-copy'; b.textContent = 'Copy';
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(box.querySelector('code').innerText).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Select and copy'; });
      setTimeout(function () { b.textContent = 'Copy'; }, 1800);
    });
    box.appendChild(b);
  });
})();
</script>`;

const words = (s) => s.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

function docPage(doc, r, k) {
  const toc = [];
  for (const h of r.toc) {
    if (h.level === 2) toc.push({ ...h, kids: [] });
    else if (h.level === 3 && toc.length) toc[toc.length - 1].kids.push(h);
  }
  const tocHtml = toc.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a>${h.kids.length ? `<ol>${h.kids.map((c) => `<li><a href="#${c.id}">${esc(c.text)}</a></li>`).join('')}</ol>` : ''}</li>`).join('\n');
  const prev = DOCS[k - 1], next = DOCS[k + 1];
  const mins = Math.max(1, Math.round(words(r.html) / 230));
  return `${HEAD(`${r.title} · Overdub docs`, doc.blurb)}
<body class="docs-page">
<a class="skip" href="#doc">Skip to the text</a>
${TOP(doc.slug === 'guide' ? 'guide' : 'docs')}
<div class="docs-layout">
  <aside class="docs-side">
    <nav class="docs-nav" aria-label="Docs">
      <p class="side-head"><a href="/site/docs/">Docs</a></p>
      <ol>
${DOCS.map((d, j) => `        <li><a href="${d.slug}.html"${d === doc ? ' aria-current="page"' : ''}>${esc(d.label)}</a></li>`).join('\n')}
      </ol>
    </nav>
    <details class="toc">
      <summary>On this page</summary>
      <nav aria-label="On this page"><ol>
${tocHtml}
      </ol></nav>
    </details>
  </aside>
  <main id="doc" class="doc">
    ${over('h1', 'top', esc(r.title), 'doc-title')}
    <p class="doc-meta">From <code>${esc(doc.src)}</code>${doc.raw ? ` (<a href="${doc.raw}">the Markdown</a>)` : ''}, about ${mins} min to read</p>
${doc.note ? `    <p class="doc-note">Status: ${esc(doc.note)}</p>\n` : ''}    <article class="prose">
${r.html}    </article>
    <nav class="pager" aria-label="Next and previous">
      ${prev ? `<a class="pager-prev" href="${prev.slug}.html"><small>Previous</small>${esc(prev.label)}</a>` : '<span></span>'}
      ${next ? `<a class="pager-next" href="${next.slug}.html"><small>Next</small>${esc(next.label)}</a>` : '<a class="pager-next" href="/site/docs/"><small>Back to</small>All docs</a>'}
    </nav>
  </main>
</div>
${FOOT}
${SCRIPT}
</body>
</html>
`;
}

function hubPage(rendered) {
  const cards = DOCS.map((d, k) => {
    const r = rendered[k];
    const sections = r.toc.filter((h) => h.level === 2).length;
    const mins = Math.max(1, Math.round(words(r.html) / 230));
    return `      <li class="doc-card">
        <h2 id="${d.slug}"><a href="${d.slug}.html">${esc(r.title)}</a></h2>
        <p>${esc(d.blurb)}</p>
${d.note ? `        <p class="card-note">${esc(d.note)}</p>\n` : ''}        <p class="card-meta">${sections} sections, about ${mins} min, ${esc(d.src)}</p>
      </li>`;
  }).join('\n');
  return `${HEAD('Docs · Overdub Studio', 'How Overdub works, written down: a guide to your first session, connecting an agent, the rules of the room and its tools, writing instruments and effects as code, the benchmark, the remote MCP relay, and the architecture.')}
<body class="docs-hub">
<a class="skip" href="#main">Skip to the docs</a>
${TOP('docs')}
<main id="main">
  <section class="hub-head" aria-labelledby="docs-title">
    <div class="wrap">
      ${over('h1', 'docs-title', 'The manuals.')}
      <p class="section-lede">Seven documents. A guide to your first session, then the ones the agents read: how an agent plugs in and how it behaves in the room, how to write an instrument or effect, how agents are scored by measurement, how claude.ai reaches a studio tab, and the contract every part of the studio is built against.</p>
    </div>
  </section>
  <section class="hub-list" aria-label="The documents">
    <div class="wrap">
      <ol class="doc-cards">
${cards}
      </ol>
      <div class="hub-raw">
        <h2 id="for-agents-reading-this"><a class="h-link" href="#for-agents-reading-this">For agents reading this</a></h2>
        <p>The plain versions: <a href="/llms.txt">llms.txt</a>, and the Markdown itself at ${DOCS.filter((d) => d.raw).map((d) => `<a href="${d.raw}">${esc(d.raw)}</a>`).join(', ')}.</p>
      </div>
    </div>
  </section>
</main>
${FOOT}
</body>
</html>
`;
}

// ---------------------------------------------------------------- build

function build() {
  const rendered = DOCS.map((d) => render(fs.readFileSync(path.join(ROOT, d.src), 'utf8'), { hrefFor: hrefFor(d) }));
  const files = { 'index.html': hubPage(rendered) };
  DOCS.forEach((d, k) => { files[`${d.slug}.html`] = docPage(d, rendered[k], k); });
  return files;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = build();
  let stale = 0;
  for (const [name, html] of Object.entries(files)) {
    const f = path.join(OUT, name);
    const now = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    if (now === html) { if (!CHECK) console.log(`  same  site/docs/${name}`); continue; }
    if (CHECK) { stale++; console.log(`  stale site/docs/${name}${now === null ? ' (missing)' : ''}`); continue; }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(f, html);
    console.log(`  wrote site/docs/${name} (${(html.length / 1024).toFixed(1)} KB)`);
  }
  if (CHECK) {
    console.log(stale ? `docs-build: ${stale} page(s) out of date: run node tools/docs-build.js` : 'docs-build: all pages up to date');
    if (stale) process.exitCode = 1;
  }
}
