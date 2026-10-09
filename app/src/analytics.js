// Counting, not tracking. On the live site only (overdubstudio.com over https), and only when the browser hasn't
// asked us not to (Do Not Track, Global Privacy Control), the studio sends a few anonymous counts. Each count is one
// GET of /app/e.gif with the event in the query string; CloudFront's access log is the whole pipeline (read with
// Athena: tools/stats.sh; set up by deploy/analytics/setup.sh). No cookies, nothing stored, no ids (not even per
// visit), no third parties, no batching, no retries. Never the song, its names, notes, text, keys or files.
//
// The events, and their one enumerated field `p` (the landing page sends `view`: site/assets/analytics.js):
//   open    the studio opened                     p: demo | new | saved | device | link (a #s= share link)   (+ r, the referrer's host)
//   play    the transport started (first time this page load)
//   agent   you sent the in-app agent a message    p: demo | local   (local: Claude Code or a server's key, on localhost)
//           an outside agent's first tool call     p: mcp | claude.ai   (once per page load each)
//   device  a device was defined (kernel written)  p: you | agent
//   export  a file was downloaded                  p: wav | stems | midi | song | log | device | video | other
//   share   a share link was made for you          p: link   (app.share.copy: the Song menu's Share, the coach's)
//           an agent made one (the share_link tool) p: agent
//           someone made a shared song theirs      p: fork   (ui 'share:fork')
//           any other share: ui.emit('share', { kind })   p: embed | file | post | other
//   hum     a hum became notes
//   keep    an idea kept as a clip, or a take kept p: idea | take
//
//   app.analytics = { enabled, count(e, p), sent }     count() ignores anything not in EVENTS; `sent` lists the URLs
//                                                      this page load sent (empty off production)

export const HOST = 'overdubstudio.com';
export const BEACON = '/app/e.gif';
export const EVENTS = {
  open: ['demo', 'new', 'saved', 'device', 'link'],
  play: null,
  agent: ['demo', 'local', 'mcp', 'claude.ai', 'hosted'],
  device: ['you', 'agent'],
  export: ['wav', 'stems', 'midi', 'song', 'log', 'device', 'video', 'other'],
  share: ['link', 'agent', 'fork', 'embed', 'file', 'post', 'other'],
  hum: null,
  keep: ['idea', 'take'],
};
const ONCE = new Set(['open', 'play']);
const CAP = 60; // per page load, all events together: a runaway loop can't flood the log

// Did this browser ask not to be tracked? (DNT: '1' / 'yes'; GPC: true)
export function optedOut(nav = globalThis.navigator, win = globalThis) {
  try {
    const dnt = nav?.doNotTrack ?? win?.doNotTrack ?? nav?.msDoNotTrack;
    return dnt === '1' || dnt === 'yes' || dnt === 1 || nav?.globalPrivacyControl === true;
  } catch { return true; }
}

// Only the deployed site, over https, in a person's browser (automation sets navigator.webdriver).
export function allowed(loc = globalThis.location, nav = globalThis.navigator, win = globalThis) {
  try {
    if (!loc || loc.hostname !== HOST || loc.protocol !== 'https:') return false;
    if (nav?.webdriver) return false;
    return !optedOut(nav, win);
  } catch { return false; }
}

// The referrer's host, nothing else: no path, no query, no port, no "www.". '' when there is none or it looks odd.
export function referrerHost(ref) {
  if (!ref) return '';
  try {
    const h = new URL(ref).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]{1,64}$/.test(h) ? h : '';
  } catch { return ''; }
}

// The URL for one count, or null if the event or its field isn't on the list.
export function beaconUrl(e, p, { r = '', base = BEACON } = {}) {
  if (!Object.hasOwn(EVENTS, e)) return null;
  const opts = EVENTS[e];
  const q = new URLSearchParams({ e });
  if (opts) { if (!opts.includes(p)) return null; q.set('p', p); }
  if (r && (e === 'open') && /^[a-z0-9.-]{1,64}$/.test(r)) q.set('r', r);
  return base + '?' + q;
}

// One GET, fire and forget. no-store so a repeated count isn't answered from the browser cache (and so never logged);
// no referrer so the page's own URL (a ?device= id, say) never reaches the log; no credentials.
function sendBeacon(url) {
  try {
    if (typeof fetch === 'function') {
      fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {});
    } else {
      const img = new Image(); img.referrerPolicy = 'no-referrer'; img.src = url;
    }
  } catch { /* never let counting break the studio */ }
}

const EXPORTS = [
  [/\.overdub-device\.json$/i, 'device'], [/\.overdub\.json$/i, 'song'], [/ attribution\.json$/i, 'log'],
  [/ stems\.zip$/i, 'stems'], [/\.wav$/i, 'wav'], [/\.midi?$/i, 'midi'], [/\.(webm|mp4|mov)$/i, 'video'],
];
export const exportKind = (name) => { for (const [re, k] of EXPORTS) if (re.test(name || '')) return k; return 'other'; };

export default function (app) {
  const enabled = allowed();
  const sent = [];
  const counts = {};
  let total = 0;
  function count(e, p, extra) {
    if (!enabled || total >= CAP) return false;
    if (ONCE.has(e) && counts[e]) return false;
    const url = beaconUrl(e, p, extra);
    if (!url) return false;
    counts[e] = (counts[e] || 0) + 1; total++;
    sent.push(url);
    sendBeacon(url);
    return true;
  }
  app.analytics = { enabled, count: (e, p) => count(e, p), sent };
  if (!enabled) return;

  const { ui, store, engine } = app;
  const params = new URLSearchParams(location.search);

  // the studio opened: how, and from where (the host only)
  const how = app.share?.incoming?.ok ? 'link' : params.has('device') ? 'device' : EVENTS.open.includes(app.opened) ? app.opened : 'demo';
  count('open', how, { r: referrerHost(document.referrer) });

  // play: the first time the transport starts
  engine?.on?.('transport', (t) => { if (t && t.playing) count('play'); });

  // agents: each message you send the in-app one; an outside agent's first tool call
  // (asks on Claude on Overdub credits count as 'hosted', never as the person's own Claude)
  app.agent?.on?.('user', () => count('agent', app.agent.provider === 'mock' ? 'demo' : app.agent.provider === 'cloud' ? 'hosted' : 'local'));
  const outside = new Set();
  ui?.on?.('agent:tool', (d) => {
    if (!d || d.phase !== 'start' || typeof d.by !== 'string') return;
    const p = d.by === 'claude.ai' ? 'claude.ai' : d.by.startsWith('mcp:') ? 'mcp' : null;
    if (p && !outside.has(p)) { outside.add(p); count('agent', p); }
  });

  // devices written (a new kernel or a new version), by a person or an agent; undo, redo and loading a song don't count
  store?.on?.('change', (c) => {
    if (!c || c.kind !== 'do') return;
    for (const op of c.ops || []) if (op && op.type === 'device.define') count('device', store.isAgent?.(c.by) ? 'agent' : 'you');
  });

  // exports: every file the studio hands you is an <a download> click; only its kind is counted, never its name
  document.addEventListener('click', (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[download]');
    if (a) count('export', exportKind(a.getAttribute('download')));
  }, true);

  // shares: a link made for you (app.share.copy, whoever calls it), one an agent made, a shared song made yours, and
  // anything else that says ui.emit('share', { kind })
  const share = app.share;
  if (share && typeof share.copy === 'function' && !share.copy.counted) {
    const copy = share.copy;
    share.copy = Object.assign(async function (...args) {
      const r = await copy.apply(this, args);
      if (r && r.ok) count('share', 'link');
      return r;
    }, { counted: true });
  }
  ui?.on?.('agent:tool', (d) => { if (d && d.phase === 'end' && d.name === 'share_link' && d.result && d.result.url) count('share', 'agent'); });
  ui?.on?.('share:fork', () => count('share', 'fork'));
  ui?.on?.('share', (d) => { const k = typeof d === 'string' ? d : d && d.kind; count('share', EVENTS.share.includes(k) ? k : 'other'); });

  // hums that became notes, and ideas kept as clips (capture.keep stamps phrase.kept with the time it happened)
  const keptSeen = new Set();
  app.input?.on?.('capture', ({ what, phrase } = {}) => {
    if (!phrase) return;
    if (what === 'add' && phrase.src === 'hum') count('hum');
    const last = Array.isArray(phrase.kept) ? phrase.kept[phrase.kept.length - 1] : null;
    if (what === 'update' && last && typeof last.at === 'number' && Math.abs(Date.now() - last.at) < 5000) {
      const k = phrase.id + ':' + last.at + ':' + phrase.kept.length;
      if (!keptSeen.has(k)) { keptSeen.add(k); count('keep', 'idea'); }
    }
  });

  // takes kept: an agent's variation picked (not "as it was")
  const picked = new Set();
  ui?.on?.('agent:request', ({ id, req } = {}) => {
    if (!req || req.kind !== 'variations' || req.status !== 'done' || picked.has(id)) return;
    picked.add(id);
    if (req.result && req.result.picked !== 'original' && req.result.picked != null && !req.result.error) count('keep', 'take');
  });
}
