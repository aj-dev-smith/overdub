// A sampled sound's samples, as the sound pickers see them (the suggested-sounds card, Find, the browser): fetched as
// soon as the sound is shown or pointed at, so the first try isn't silent, and a small loading line wherever the
// sound is named until they're in. kernel/data.js does the fetching (one download per kit, however many ask); this
// only asks early and says how far along it is.
//
//   kitHashes(def)        the kit hashes a device names ([] for a synthesized one)
//   kitState(def)         'ready' | 'loading' | 'missing' | null: null when it names none, or none has been asked for
//   prefetchKit(def)      start fetching every kit it names (nothing for one already here); a Promise of all ready
//   whenKitReady(def, ms) a Promise of true once they're in (at once if they are), false if missing or after ms
//   kitLine(def, opts)    a small status line, "Loading samples, 2.4 of 6.9 MB", with a hairline that fills; it
//                         redraws itself as bytes arrive and hides once the samples are in. opts: { short } drops the
//                         numbers on a narrow row; { bare } is the hairline alone (its words in its label and title),
//                         for a track's header
//   kitAmount(def)        how far along, "2.4 of 6.9 MB" ('' before the first bytes)
//   kitSays(def)          the same words as a string ('' once ready), for a status line or an aria label
//   instReady(engine, track, ms)  a Promise of true once the track's live instrument has its samples (at once if it
//                         names none, or has them), false after ms: what a trial waits on before it plays
import { h, css } from './dom.js';
import { loadData, dataState, dataProgress, onData, peekData } from '../kernel/data.js';

export const kitHashes = (def) => (def && def.data ? Object.values(def.data).filter((x) => typeof x === 'string' && x.startsWith('sha256-')) : []);

export function kitState(def) {
  const hs = kitHashes(def);
  if (!hs.length) return null;
  const st = hs.map((x) => (peekData(x) ? 'ready' : dataState(x) || null));
  if (st.includes('missing')) return 'missing';
  if (st.includes('loading')) return 'loading';
  if (st.every((x) => x === 'ready')) return 'ready';
  return null;
}

export function prefetchKit(def) {
  const hs = kitHashes(def);
  if (!hs.length) return Promise.resolve(true);
  return Promise.all(hs.map((x) => loadData(x))).then((bs) => bs.every(Boolean));
}

export function whenKitReady(def, ms = 60000) {
  const hs = kitHashes(def);
  if (!hs.length || kitState(def) === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    prefetchKit(def).then((ok) => { clearTimeout(t); resolve(ok); });
  });
}

export function instReady(engine, track, ms = 60000) {
  let inst = null;
  try { inst = engine?.instance?.(track, 'instrument') || null; } catch { inst = null; }
  if (!inst || !inst.data || inst.data.state !== 'loading' || typeof inst.on !== 'function') return Promise.resolve(!inst?.data || inst.data.state === 'ready');
  return new Promise((resolve) => {
    let off = null;
    const t = setTimeout(() => { if (off) off(); resolve(false); }, ms);
    off = inst.on('data', (d) => { off(); clearTimeout(t); resolve(!!d && d.state === 'ready'); });
  });
}

const mb = (b) => (b / 1e6).toFixed(1);
function progressOf(def) {
  let got = 0, total = 0, known = true;
  for (const x of kitHashes(def)) {
    if (peekData(x)) continue;
    const p = dataProgress(x);
    if (!p) { known = false; continue; }
    got += p.got;
    if (p.total) total += p.total; else known = false;
  }
  return { got, total: known && total ? total : null };
}

// how far along: "2.4 of 6.9 MB", "2.4 MB in" (the size not known yet), or '' (nothing in yet)
export function kitAmount(def) {
  const { got, total } = progressOf(def);
  if (!got) return '';
  return total ? `${mb(got)} of ${mb(total)} MB` : `${mb(got)} MB in`;
}
export function kitSays(def, { short = false } = {}) {
  const s = kitState(def);
  // (a device whose data isn't samples says its own words: def.dataSays, as the rack's line does)
  const own = def && def.dataSays && def.dataSays[s];
  if (own) return own[0];
  if (s === 'missing') return 'No samples here';
  if (s !== 'loading') return '';
  const n = short ? '' : kitAmount(def);
  return n ? `Loading samples, ${n}` : 'Loading samples…';
}

const lines = new Set();
function draw(el) {
  const def = el._kitDef, s = kitState(def);
  const t = kitSays(def, { short: el._short });
  el.hidden = !t;
  el.classList.toggle('kl-missing', s === 'missing');
  el.querySelector('.kl-t').textContent = t;
  const { got, total } = progressOf(def);
  const f = s === 'loading' && total ? Math.max(0.02, Math.min(1, got / total)) : null;
  const bar = el.querySelector('.kl-bar > i');
  bar.style.width = f == null ? '' : (100 * f).toFixed(1) + '%';
  el.classList.toggle('kl-unknown', s === 'loading' && f == null);
  const n = s === 'loading' ? kitAmount(def) : '';
  const own = def && def.dataSays && def.dataSays[s];
  const long = own ? own[1] : s === 'loading' ? `Loading its samples${n ? `, ${n}` : ''}: it plays once they’re in` : s === 'missing' ? 'Its samples aren’t on this server, so it plays nothing' : '';
  el.setAttribute('aria-label', long);
  el.title = long;
}
export function kitLine(def, { short = false, bare = false } = {}) {
  css('ew-kitload', KITLOAD_CSS);
  const el = h('span.kitload' + (bare ? '.kl-bare' : ''), { role: 'status', hidden: true }, h('span.kl-t'), h('i.kl-bar', { 'aria-hidden': 'true' }, h('i')));
  el._kitDef = def; el._short = short; el._t = Date.now();
  el.dataset.hashes = kitHashes(def).join(' ');
  draw(el);
  lines.add(el);
  return el;
}
onData(({ hash }) => {
  for (const el of lines) {
    // (a line leaves with its row: once it has been on the page and isn't, or never got there within 10 s)
    if (!el.isConnected && (el._seen || Date.now() - el._t > 10000)) { lines.delete(el); continue; }
    if (el.isConnected) el._seen = true;
    if (el.dataset.hashes.includes(hash)) draw(el);
  }
});

const KITLOAD_CSS = `
.kitload { display: inline-grid; grid-template-columns: auto; gap: 2px; color: var(--text-3); font-size: 11px; line-height: 1.2; white-space: nowrap; vertical-align: middle; }
.kitload[hidden] { display: none; }
.kitload .kl-bar { display: block; position: relative; height: 1px; background: var(--line-2); overflow: hidden; }
.kitload .kl-bar > i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--text-2); transition: width .16s var(--ease, ease); }
.kitload.kl-unknown .kl-bar > i { width: 30%; animation: kl-run 1.4s linear infinite; }
.kitload.kl-missing .kl-bar { display: none; }
.kitload.kl-bare { width: 36px; gap: 0; }
.kitload.kl-bare .kl-t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.kitload.kl-bare.kl-missing { width: auto; }
.kitload.kl-bare.kl-missing .kl-t { position: static; width: auto; height: auto; clip: auto; }
@keyframes kl-run { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
@media (prefers-reduced-motion: reduce) { .kitload.kl-unknown .kl-bar > i { animation: none; width: 100%; opacity: .5; } }
`;
