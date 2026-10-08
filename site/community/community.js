// The community shelf, on the site (docs/COMMUNITY-SHELF.md, section 4). Reads the same index the studio's Browser
// reads (community-index.json, v1), through the same reader, and draws each entry as the library page does: the face on
// its shelf, the paperwork under a hairline. It runs no device code. A face is drawn from the reader's checked `look`
// and `params` (data only: the knobs do nothing, there's no code to turn); a clip is a recording, fetched as a blob and
// played gently; the device file itself is never fetched here. "Open in the studio" hands the entry to the studio,
// where Try asks first.
//
//   /site/community/                                  the studio's own copy (/app/community/community-index.json)
//   /site/community/?community=<url>                  another index: a path on this site, or http://localhost:* while
//                                                     this page is on localhost (the studio's rule)
//   ?kind=instrument|effect  ?cat=<cat>  ?q=<words>   the filters, kept in the address so a view can be linked
//
// Shipped with the site (deploy/deploy.sh), but no page links here yet.
// On any host but localhost / 127.0.0.1 the page reads nothing (COMMUNITY_LIVE below, as the studio's is).
import { renderFace } from '/app/src/ui/faces.js';
import { DEVICE_CATS } from '/app/src/devices/registry.js';
import { readIndex, resolveUrl, filterEntries as sharedFilter, ASKED_MAX } from '/app/src/devices/community.js';

// Keep in step with COMMUNITY_LIVE in app/src/ui/community.js (tools/pages-test.js checks they agree once it exists).
// The page doesn't import that module: it's the studio's UI, and this page wants only its switch.
export const COMMUNITY_LIVE = false;

export const DEFAULT_INDEX = '/app/community/community-index.json';
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_CLIP_BYTES = 2 * 1024 * 1024;
const CLIP_TYPES = ['audio/mpeg', 'audio/wav'];

/* ------------------------------------------------------------------------------------------------ the reader */
// The one reader, the studio's (app/src/devices/community.js): the same allow-list, type checks and URL policy as the
// Browser section and the agent tool, so all three skip the same things. This page only adds category names.
const CAT_NAME = Object.fromEntries(DEVICE_CATS);
export const catName = (c) => CAT_NAME[c] || c;
export { readIndex, resolveUrl };

// kind, cat and words, through the reader's own ranking (the agent field is never searched)
export function filterEntries(entries, { kind = 'all', cat = 'all', q = '', tier = null } = {}) {
  return sharedFilter(entries, { kind: kind === 'all' ? null : kind, cat: cat === 'all' ? null : cat, q, tier });
}

/* ------------------------------------------------------------------------------------------------ where the index is */
export const localPage = (host = location.hostname) => host === 'localhost' || host === '127.0.0.1';
export const shelfOn = () => COMMUNITY_LIVE || localPage();

// -> { url, bundled } or { error }. A path on this site, or http://localhost:* / 127.0.0.1:* while this page is local.
export function indexSource(param = new URLSearchParams(location.search).get('community')) {
  if (!param) return { url: new URL(DEFAULT_INDEX, location.href).href, bundled: true };
  let u;
  try {
    u = new URL(param, location.href);
  } catch {
    return { error: 'bad' };
  }
  const local = /^http:$/.test(u.protocol) && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  const ok = u.origin === location.origin ? /^https?:$/.test(u.protocol) : !COMMUNITY_LIVE && localPage() && local;
  if (!ok || u.username || u.password) return { error: 'host' };
  return { url: u.href, bundled: u.origin === location.origin && u.pathname === DEFAULT_INDEX };
}

// Read a response's body, stopping past `cap` bytes (null when it ran over)
async function capped(res, cap) {
  const len = Number(res.headers.get('content-length'));
  if (len > cap) {
    try {
      await res.body?.cancel();
    } catch {
      /* gone */
    }
    return null;
  }
  if (!res.body?.getReader) {
    const b = await res.arrayBuffer();
    return b.byteLength > cap ? null : new Uint8Array(b);
  }
  const rd = res.body.getReader(),
    parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      try {
        await rd.cancel();
      } catch {
        /* gone */
      }
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

export async function loadIndex(src) {
  let res;
  try {
    res = await fetch(src.url, { credentials: 'omit', cache: 'no-cache', redirect: 'error' });
  } catch {
    return { missing: true };
  }
  if (!res.ok) return { missing: true };
  const bytes = await capped(res, MAX_INDEX_BYTES);
  if (!bytes) return { tooBig: true };
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { unreadable: true };
  }
  return readIndex(json, { base: src.url, bundled: src.bundled });
}

/* ------------------------------------------------------------------------------------------------ previews */
// One plays at a time, looped until Stop. Fetched as a blob only when ▶ is pressed: the content type must say audio,
// reading stops past 2 MB. Played at half volume, faded in, since any index but the studio's own can hold anything.
const blobs = new Map(); // clip url -> blob: url
const pick = (clips) => {
  const a = document.createElement('audio');
  return clips.find((c) => a.canPlayType(c.type)) || null;
};
// `clips`: the reader's list for one sound (the same sound in more than one encoding, best first)
export async function clipBlob(clips, indexUrl) {
  const c = Array.isArray(clips) && pick(clips);
  if (!c) throw new Error('no clip this browser plays');
  const src = resolveUrl(c.src, indexUrl, { under: 'clips' });
  if (!src) throw new Error('the clip is outside the shelf');
  if (blobs.has(src)) return blobs.get(src);
  const res = await fetch(src, { credentials: 'omit', redirect: 'error' });
  if (!res.ok) throw new Error(`the clip answered ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!CLIP_TYPES.includes(type)) throw new Error('the clip isn’t audio');
  const bytes = await capped(res, MAX_CLIP_BYTES);
  if (!bytes) throw new Error('the clip is over 2 MB');
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  blobs.set(src, url);
  return url;
}

const player = { audio: null, entry: null, el: null, dry: false, raf: 0 };
function fadeIn(a) {
  cancelAnimationFrame(player.raf);
  const t0 = performance.now();
  a.volume = 0;
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 200);
    a.volume = 0.5 * k;
    if (k < 1 && player.audio === a) player.raf = requestAnimationFrame(step);
  };
  step();
}
export function stopPreview() {
  if (!player.audio) return;
  cancelAnimationFrame(player.raf);
  player.audio.pause();
  player.audio.removeAttribute('src');
  const el = player.el;
  player.audio = null;
  player.entry = null;
  player.el = null;
  if (el) {
    el.dataset.state = 'idle';
    el.querySelector('.cs-play b').textContent = playLabel(el.entry);
  }
}
async function startPreview(el, { dry = el.dry } = {}) {
  const e = el.entry,
    idx = el.indexUrl;
  const was = player.el === el && player.audio ? player.audio.currentTime : 0;
  if (player.el !== el) stopPreview();
  el.dataset.state = 'loading';
  let url;
  try {
    url = await clipBlob(dry ? e.preview.dry : e.preview.wet, idx);
  } catch (err) {
    el.dataset.state = 'idle';
    el.querySelector('.cs-hint').textContent = `Couldn’t play it: ${err.message}.`;
    return;
  }
  const a = player.audio && player.el === el ? player.audio : new Audio();
  a.loop = true;
  a.src = url;
  try {
    a.currentTime = was;
  } catch {
    /* not seekable yet: from the top */
  }
  player.audio = a;
  player.entry = e;
  player.el = el;
  fadeIn(a);
  try {
    await a.play();
  } catch {
    if (player.audio === a) {
      el.dataset.state = 'idle';
      el.querySelector('.cs-hint').textContent = 'The browser didn’t let it play. Press ▶ again.';
      player.audio = null;
      player.el = null;
    }
    return;
  }
  if (player.audio !== a) return;
  if (was && Math.abs(a.currentTime - was) > 0.05 && a.duration) {
    try {
      a.currentTime = was % a.duration;
    } catch {
      /* close enough */
    }
  }
  el.dataset.state = 'playing';
  el.querySelector('.cs-play b').textContent = 'Stop';
  el.querySelector('.cs-hint').textContent = '';
}

/* ------------------------------------------------------------------------------------------------ words */
const neg = (x) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(1);
const sgn = (x) => (x > 0.05 ? '+' : x < -0.05 ? '−' : '±') + Math.abs(x).toFixed(1);
const INPUT_WORDS = { strum: 'On a strum', drums: 'On drums', bass: 'On a bass', phrase: 'Hear it' };
function playLabel(e) {
  return e.kind === 'instrument' ? 'Hear it' : INPUT_WORDS[e.preview.input] || 'Hear it';
}
export function plainWords(e) {
  const m = e.measured,
    out = [];
  if (e.kind === 'effect' && m.deltaLU != null)
    out.push(
      Math.abs(m.deltaLU) <= 1
        ? 'Same level as what goes in.'
        : m.deltaLU > 0
          ? `${m.deltaLU.toFixed(1)} LU louder than what goes in.`
          : `${Math.abs(m.deltaLU).toFixed(1)} LU quieter than what goes in.`,
    );
  if (e.kind === 'instrument' && m.lufs != null) out.push(`Plays at ${neg(m.lufs)} LUFS on the test phrase.`);
  if (m.tail != null) out.push(m.tail < 0.25 ? 'Stops when the sound does.' : `Rings on ${m.tail.toFixed(1)} s.`);
  if (m.cpu != null)
    out.push(
      m.cpu < 2 ? 'Light on the computer.' : m.cpu < 8 ? 'Some work for the computer.' : 'Heavy on the computer.',
    );
  return out.join(' ');
}
const ledger = (e) => {
  const m = e.measured,
    rows = [];
  if (e.kind === 'effect' && m.deltaLU != null) rows.push(['Level', `${sgn(m.deltaLU)} LU`]);
  if (e.kind === 'instrument' && m.lufs != null) rows.push(['Loudness', `${neg(m.lufs)} LUFS`]);
  if (m.truePeak != null) rows.push(['Peak', `${neg(m.truePeak)} dBTP`]);
  if (m.tail != null) rows.push(['Tail', `${m.tail.toFixed(1)} s`]);
  if (m.cpu != null) rows.push(['CPU', `${m.cpu.toFixed(1)}%`]);
  return rows;
};
// Where Open in the studio lands it: Night Shift's track that fits its category (docs/COMMUNITY-SHELF.md, "Open from a link")
export function landsOn(e) {
  if (e.kind === 'instrument') return e.cat === 'bass' ? 'Bass' : e.cat === 'drums' ? 'Drums' : 'Keys';
  if (['time', 'space', 'ambient', 'mod'].includes(e.cat)) return 'Hook';
  if (['drive', 'fuzz', 'amp'].includes(e.cat)) return 'Guitar';
  if (['dynamics', 'glitch'].includes(e.cat)) return 'Drums';
  if (e.cat === 'bass') return 'Bass';
  return 'Keys';
}
export function studioLink(e, src) {
  if (e.tier === 'house') return `/app/?new&device=${encodeURIComponent(e.id)}`;
  const def = new URL(DEFAULT_INDEX, location.href).href;
  return `/app/?new&community-device=${encodeURIComponent(e.id)}${src.url !== def ? `&community=${encodeURIComponent(src.url)}` : ''}`;
}
const shortDate = (s) => {
  const d = new Date(s);
  return Number.isNaN(+d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ------------------------------------------------------------------------------------------------ the page */
// h('tag.class', { attrs }, ...children): text children are text nodes, so nothing an index says becomes markup
function h(sel, attrs = {}, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat())
    if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const by = (kind, name, title) => h(`span.by.by-${kind}`, { title }, name);
function credit(e) {
  const who = e.author.alias || e.author.handle;
  const title = e.author.alias ? `${e.author.alias} (was ${e.author.handle}; the id keeps the old name)` : null;
  const agent = e.agent ? e.agent.replace(/\s*\([^)]*\)\s*$/, '') : null;
  return h('p.cs-credit', {}, 'by ', by('human', who, title), agent ? [' with ', by('agent', agent, e.agent)] : null);
}
const PLAY_SVG = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 14 14');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML =
    '<path class="ic-play" d="M3 1.5v11l9-5.5z"/><rect class="ic-stop" x="2.5" y="2.5" width="9" height="9" rx="1"/>';
  return s;
};

function entryEl(e, ctx) {
  const vouched = e.origin === 'bundled';
  const id = `d-${e.id}`;
  const el = h('article.cs-entry', {
    id,
    dataset: { id: e.id, kind: e.kind, cat: e.cat, tier: e.tier, state: 'idle' },
  });
  el.entry = e;
  el.indexUrl = ctx.src.url;
  el.dry = false;

  // the face, from the reader's checked look and params only, and inert: no code behind it
  const stage = h('div.cs-stage', {}, h('span.cs-cat', {}, catName(e.cat)));
  const faceBox = h('div.cs-face', { inert: true, 'aria-hidden': 'true' });
  try {
    const def = {
      id: e.id,
      name: e.name,
      kind: e.kind,
      cat: e.cat,
      blurb: e.blurb,
      nod: e.nod,
      look: e.look,
      params: e.params,
    };
    const face = renderFace(def, {}, { on: true, size: 'full' });
    faceBox.append(face.el);
  } catch {
    faceBox.append(h('p.cs-noface', {}, 'No face to draw.'));
  }
  stage.append(faceBox);

  const body = h('div.cs-body');
  body.append(h('div.cs-name', {}, h('h3', {}, h('a.h-link', { href: `#${id}` }, e.name)), h('code', {}, e.id)));
  body.append(h('p.cs-blurb', {}, e.blurb));
  if (e.tier !== 'house') body.append(credit(e));

  // hear it
  if (e.preview.wet.length) {
    const row = h('div.cs-hear');
    const play = h(
      'button.cs-btn.cs-play',
      { type: 'button', 'aria-label': `${playLabel(e)}: a clip of ${e.name}` },
      PLAY_SVG(),
      h('b', {}, playLabel(e)),
    );
    play.addEventListener('click', () => {
      if (player.el === el && player.audio) stopPreview();
      else startPreview(el);
    });
    row.append(play);
    if (e.preview.dry) {
      const dry = h(
        'button.cs-tog',
        { type: 'button', 'aria-pressed': 'false', title: 'The same input with nothing on it, at the same level' },
        'Dry',
      );
      dry.addEventListener('click', () => {
        el.dry = !el.dry;
        dry.setAttribute('aria-pressed', String(el.dry));
        if (player.el === el && player.audio) startPreview(el, { dry: el.dry });
      });
      row.append(dry);
    }
    body.append(row);
  }
  body.append(h('p.cs-hint', { 'aria-live': 'polite' }));

  if (e.request) body.append(h('blockquote.cs-req', {}, h('small', {}, 'Asked for'), h('q', {}, e.request)));
  if (e.requester && e.requester.length <= ASKED_MAX) body.append(h('p.cs-small', {}, `Asked for by ${e.requester}`));

  // the numbers: plain words first, then the ledger
  const words = plainWords(e),
    rows = ledger(e);
  if (words || rows.length) {
    body.append(h('p.cs-words', {}, vouched ? null : h('span.cs-says', {}, 'The shelf says: '), words));
    if (rows.length)
      body.append(
        h(
          'ul.cs-stats',
          {},
          rows.map(([k, v]) => h('li', {}, h('small', {}, k), h('span', {}, v))),
        ),
      );
  }
  if (vouched && e.tier === 'community' && e.measured.ok === true)
    body.append(h('p.cs-small', {}, 'A person read it before it went on the shelf. It passed the studio check.'));
  if (vouched && e.tier === 'house')
    body.append(
      h(
        'p.cs-small',
        {},
        e.measured.houseLevels ? 'Ships in the studio, at the house’s levels.' : 'Ships in the studio.',
      ),
    );

  // paperwork: licence and where the code lives
  const path_ = e.source.path ? `${e.source.path}${e.source.commit ? ` at ${e.source.commit}` : ''}` : null;
  body.append(
    h(
      'p.cs-paper',
      {},
      h('span', {}, e.license),
      path_
        ? [
            ', ',
            e.source.url ? h('a', { href: e.source.url, rel: 'noopener noreferrer' }, path_) : h('span', {}, path_),
          ]
        : null,
    ),
  );

  // into the studio
  const lands =
    e.tier === 'house'
      ? `Opens a new song with ${e.name} on a track.`
      : `Opens Night Shift with ${e.name} ready to try on the ${landsOn(e)}.`;
  body.append(
    h(
      'div.cs-actions',
      {},
      h('a.cs-btn.cs-open', { href: studioLink(e, ctx.src) }, 'Open in the studio'),
      h('span.cs-lands', {}, lands),
    ),
  );

  el.append(stage, body);
  el.face = faceBox;
  return el;
}

function fit(el) {
  const box = el.querySelector('.cs-face'),
    stage = el.querySelector('.cs-stage');
  if (!box || !stage) return;
  box.style.zoom = 1;
  const w = box.scrollWidth,
    avail = stage.clientWidth - 24;
  box.style.zoom = w > avail && w > 0 ? String(Math.max(0.4, avail / w)) : 1;
}

export async function boot(root = document) {
  const $ = (s) => root.querySelector(s);
  const main = $('#shelf'),
    lede = $('#lede'),
    line = $('#shelf-line');
  const P = new URLSearchParams(location.search);
  const state = { kind: P.get('kind') || 'all', cat: P.get('cat') || 'all', q: P.get('q') || '' };
  const done = (o = {}) => {
    window.__community = { ...(window.__community || {}), ...o, ready: true };
    document.documentElement.dataset.ready = '1';
  };
  const empty = (msg, sub) => {
    main.replaceChildren(
      h(
        'div.cs-empty',
        {},
        h('p', {}, msg),
        sub ? h('p.cs-small', {}, sub) : null,
        h('a.cs-btn', { href: '/app/' }, 'Open the studio'),
      ),
    );
    $('#filters').hidden = true;
  };

  if (!shelfOn()) {
    empty('The community shelf isn’t on here yet.');
    return done({ off: true });
  }
  const src = indexSource();
  if (src.error) {
    empty('This page can read a shelf from this site or from localhost only.');
    return done({ refused: true });
  }
  const idx = await loadIndex(src);
  const where = src.bundled
    ? null
    : new URL(src.url).host === location.host
      ? new URL(src.url).pathname
      : new URL(src.url).host;
  if (idx.missing || idx.unreadable || idx.tooBig) {
    empty(
      src.bundled ? 'No shelf here.' : `No shelf at ${where}.`,
      src.bundled
        ? 'Build one with node tools/index.js --out ../overdub/app/community in overdub-devices.'
        : idx.tooBig
          ? 'Its index is over 2 MB.'
          : null,
    );
    return done({ missing: true });
  }
  if (idx.newer) {
    empty('This shelf was built for a newer studio.');
    return done({ newer: true });
  }

  const all = idx.entries,
    community = all.filter((e) => e.tier === 'community'),
    house = src.bundled ? all.filter((e) => e.tier === 'house') : [];
  const ctx = { src };
  if (src.bundled) {
    lede.textContent =
      'Instruments and effects people asked their agents for, each checked by the studio and read by a person before it went on.';
  } else {
    lede.textContent = `Instruments and effects people asked their agents for, as the shelf at ${where} lists them. What it says about each one is that shelf’s word, not the studio’s.`;
  }
  // the licence explainer links to the repo's LICENSING.md once the repo has a public URL (https on an allowed host)
  // biome-ignore lint/correctness/noUndeclaredVariables: BUG, linkable is defined nowhere: a shelf index with a repo throws here
  const lic = idx.repo && linkable(idx.repo.replace(/\/+$/, '') + '/blob/HEAD/LICENSING.md', idx.repo);
  if (lic)
    $('#licence-note')?.append(
      ' ',
      h('a', { href: lic, rel: 'noopener noreferrer' }, 'Who owns what, in plain English.'),
    );
  const built = idx.built?.at ? `, built ${shortDate(idx.built.at)}` : '';
  const left = [
    idx.skipped ? `${idx.skipped} more need a newer studio.` : '',
    idx.refused ? `${idx.refused} more were left out.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  line.textContent = `${src.bundled ? 'The copy that came with this studio' : `From ${where}`}: ${plural(community.length, 'device')}${built}.${left ? ' ' + left : ''}`;

  // two sections: the community's, and the house's (the shelf that ships in the studio, never called community work)
  const sections = [];
  const section = (key, title, note, list) => {
    const s = h(
      'section.cs-sec',
      { 'aria-labelledby': `sec-${key}`, dataset: { tier: key } },
      h('div.cs-sec-h', {}, h('h2', { id: `sec-${key}` }, h('a.h-link', { href: `#sec-${key}` }, title)), h('small')),
      note ? h('p.cs-sec-note', {}, note) : null,
      h('div.cs-grid'),
    );
    const els = list.map((e) => entryEl(e, ctx));
    s.querySelector('.cs-grid').append(...els);
    sections.push({ s, list, els, key });
    return s;
  };
  main.replaceChildren(
    section('community', 'From the community', null, community),
    ...(house.length
      ? [
          section(
            'house',
            'House shelf',
            'What ships in the studio already: the house’s own, listed so you can hear them beside the community’s. They aren’t community work.',
            house,
          ),
        ]
      : []),
    h('p.cs-none', { id: 'none', hidden: true }, 'Nothing on the shelf matches.'),
  );
  if (!community.length)
    sections[0].s
      .querySelector('.cs-grid')
      .replaceWith(h('p.cs-none', {}, 'Nothing from the community on this shelf yet.'));

  // filters: underlined words with counts read from the index, then the search box
  const shown = [...community, ...house];
  const kindEl = $('#kind'),
    catEl = $('#cat'),
    qEl = $('#q');
  const seg = (el, key, opts) => {
    el.replaceChildren(
      ...opts.map(([v, label, n]) => {
        const b = h('button', { type: 'button', dataset: { v } }, label, h('i', {}, String(n)));
        b.addEventListener('click', () => {
          state[key] = state[key] === v && key === 'cat' ? 'all' : v;
          apply();
        });
        return b;
      }),
    );
  };
  const kinds = new Set(shown.map((e) => e.kind));
  if (kinds.size > 1)
    seg(kindEl, 'kind', [
      ['all', 'All', shown.length],
      ['instrument', 'Instruments', shown.filter((e) => e.kind === 'instrument').length],
      ['effect', 'Effects', shown.filter((e) => e.kind === 'effect').length],
    ]);
  else {
    kindEl.hidden = true;
    state.kind = 'all';
  }
  const cats = DEVICE_CATS.map(([k, n]) => [k, n, shown.filter((e) => e.cat === k).length]).filter(([, , n]) => n);
  seg(catEl, 'cat', cats);
  if (cats.length < 2) catEl.hidden = true;
  qEl.value = state.q;
  qEl.addEventListener('input', () => {
    state.q = qEl.value;
    apply();
  });

  function apply() {
    for (const b of kindEl.children) b.setAttribute('aria-pressed', String(b.dataset.v === state.kind));
    for (const b of catEl.children) b.setAttribute('aria-pressed', String(b.dataset.v === state.cat));
    let n = 0;
    for (const { s, list, els } of sections) {
      const keep = new Set(filterEntries(list, { kind: state.kind, cat: state.cat, q: state.q }).map((e) => e.id));
      let k = 0;
      els.forEach((el) => {
        const vis = keep.has(el.entry.id);
        el.hidden = !vis;
        k += vis;
      });
      s.hidden = !k && (state.q || state.kind !== 'all' || state.cat !== 'all');
      s.querySelector('.cs-sec-h small').textContent = plural(k, 'device');
      n += k;
    }
    $('#none').hidden = n > 0 || !shown.length;
    if (player.el?.hidden) stopPreview();
    const u = new URL(location.href);
    for (const k of ['kind', 'cat', 'q']) {
      if (!state[k] || state[k] === 'all') u.searchParams.delete(k);
      else u.searchParams.set(k, state[k]);
    }
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    for (const { els } of sections)
      els.forEach((el) => {
        if (!el.hidden) fit(el);
      });
  }
  apply();

  const ro = new ResizeObserver((es) => {
    for (const x of es) fit(x.target.closest('.cs-entry'));
  });
  for (const { els } of sections) els.forEach((el) => ro.observe(el.querySelector('.cs-stage')));
  document.fonts?.ready.then(() => sections.forEach(({ els }) => els.forEach(fit)));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') stopPreview();
  });
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();

  done({
    index: idx,
    src,
    entries: shown,
    player,
    stop: stopPreview,
    play: (id) => {
      const el = document.querySelector(`.cs-entry[data-id="${CSS.escape(id)}"]`);
      return el ? startPreview(el) : null;
    },
    reader: 'shared',
  });
}

if (typeof document !== 'undefined' && document.getElementById('shelf')) boot();
