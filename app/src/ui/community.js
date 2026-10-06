// The community shelf in the studio (docs/COMMUNITY-SHELF.md, section 3): a **From the community** section in the
// Browser that reads a shelf's index, plays each device's preview clip, and brings a device into the song you have
// open only when you ask, after you've said yes to running code someone else wrote. Also the agent's
// find_community_device (agent/community-tool.js) and the card it raises, ?community-device=<id> from the site, the
// deny list (taken off the shelf) and the shelf's line on a held strip (ui/share.js asks heldLines).
//
// There is no marketplace: nothing here is sold, priced, rated or counted. It's a shelf.
//
// Off on the live site. COMMUNITY_LIVE is false until AJ turns it on (not before the API key is out of origin storage);
// while it is, everything here needs the page to be on localhost or 127.0.0.1: elsewhere ?community=,
// ?community-device= and a stored overdub:community are ignored, the section isn't drawn, Find's shelf words aren't
// added and the tool answers "isn't on".
//
// What runs when:
//   - Browsing reads the index (JSON: never code). ▶ fetches a clip under the URL policy (devices/community.js), checks
//     its type and size, and plays it from a blob: URL at half volume: a recording, no device code, no AudioContext.
//   - Read the code fetches the device file and shows its kernel as text. Nothing is parsed past the JSON.
//   - Try: fetch the file (300 KB at most), check its kernel's SHA-256, its id and its kind against the index, refuse an
//     id the studio ships or a song device with other code under that id, ask (unless this browser already trusts that
//     code), run the studio's device check, and only then trust it (for this page load, or from now on if the box is
//     ticked) and put it on the track as one dispatch. A failed check stores nothing and changes nothing. What lands in
//     the song is the file's code under the index's words: name, blurb, nod, request and look come from the entry the
//     person saw, never from the file. A new track gets a two-bar part to hear it on (an empty track plays silence), and
//     an effect already on the track isn't stacked a second time.
//   - Try is also held behind TRY_ON until the worklet's built-in prototypes are frozen (the spec's section 6). On a
//     local host, localStorage 'overdub:community-try' = '1' lets a developer use it before then.
//
//   app.community = { on(), ready(), state(), section(opts), reach(id?, by), offer(entry, opts), targetFor(entry, track),
//                     tryEntry(entry, opts), matchKernel(source), heldLines(held), stop(), nowPlaying() }
//
// Storage: 'overdub:community' = { "url": "<index url>" } (Change, in the full studio; Back to the studio's copy clears
// it), 'overdub:community-try' (above). Ids are forever.

import { h, css, icon, byline } from './dom.js';
import { DEVICE_CATS } from '../devices/registry.js';
import { readIndex, filterEntries, entryById, indexUrlAllowed, isLocalHost, plainNumbers, BUNDLED_INDEX, LIMITS, ASKED_MAX } from '../devices/community.js';
import { kernelHash } from '../devices/trust.js';
import { parseDeviceFile } from './devices-io.js';
import { currentTrack } from './rack.js';
import { touchFirst } from './arrange-kit.js';
import { installTools } from '../agent/tools.js';
import { kernelPrint } from '../agent/keep.js';
import { communityTool } from '../agent/community-tool.js';
import { demoProject } from '../core/demo.js';
import { parseNotes } from '../core/music.js';

export const COMMUNITY_LIVE = false;
// Try waits for the worklet freeze (docs/COMMUNITY-SHELF.md, section 6; docs/SECURITY.md item 3)
export const TRY_ON = false;
const STORE_KEY = 'overdub:community', TRY_KEY = 'overdub:community-try';
const catName = (c) => (DEVICE_CATS.find(([k]) => k === c) || [c, c])[1];
const say = {
  refusedSource: 'The studio can read a shelf from this site or from localhost only.',
  none: 'No shelf here. Build one with node tools/index.js --out ../overdub/app/community in overdub-devices.',
  newer: 'This shelf was built for a newer studio.',
  // (the Browser's line at the top says what a click or a tap on the studio's own devices does; a shelf row adds nothing)
  target: 'A row here adds nothing: ▶ plays a recording, and Try asks before any code runs.',
  vouched: 'A person read it before it went on the shelf. It passed the studio check.',
  heldBack: 'Trying shelf devices in the studio isn’t open yet. You can hear each one and read its code.',
  clipRefused: 'That clip wasn’t played: it isn’t audio the studio takes, or it’s over 2 MB.',
};
// the shelf's words in Find: a query that finds the Browser by one of them opens it on the shelf
const SHELF_WORDS = ['community', 'shelf', 'other people', 'new sounds'];
const shelfQuery = (q) => { const w = String(q || '').trim().toLowerCase(); return w.length >= 3 && SHELF_WORDS.some((a) => a.includes(w) || a.split(' ').some((x) => x.startsWith(w)) || w.includes(a)); };
// the part a new track gets so a Try can be heard: two bars, by input (an effect) or by category (an instrument)
function tryPart(e) {
  const input = e.kind === 'effect' ? e.preview.input : e.cat === 'drums' ? 'drums' : e.cat === 'bass' ? 'bass' : 'phrase';
  if (input === 'drums') {
    const notes = [];
    const row = { 36: 'x.....x...x.....', 38: '....x.......x...', 42: 'x.x.x.x.x.x.x.x.' };
    for (let bar = 0; bar < 2; bar++) for (const [p, cells] of Object.entries(row)) for (let i = 0; i < 16; i++) if (cells[i] === 'x') notes.push({ p: +p, t: bar * 4 + i * 0.25, d: 0.25, v: p === '42' ? 0.55 : 0.9 });
    return { device: 'core.drums', name: 'Beat', notes };
  }
  if (input === 'bass') return { device: 'core.bass', name: 'Bass line', notes: 'C2@0:1 C2@1.5:0.5 G2@2:1 A#1@3:1 A1@4:1 A1@5.5:0.5 E2@6:1 G1@7:1' };
  // a strum: four chords, a bar between each pair; an instrument plays it too
  return { device: 'core.keys', name: input === 'strum' ? 'Strum' : 'Phrase', notes: 'C4@0:1.9 E4@0:1.9 G4@0:1.9 A3@2:1.9 C4@2:1.9 E4@2:1.9 F3@4:1.9 A3@4:1.9 C4@4:1.9 G3@6:1.9 B3@6:1.9 D4@6:1.9' };
}
const hostOf = (url) => { try { return new URL(url).host; } catch (e) { return String(url); } };
const dayOf = (iso) => { const d = new Date(iso || ''); return isNaN(d) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

// Read at most `cap` bytes; refuse past it, or a type not in `types`. Same origin rules as the URL policy decided.
async function fetchCapped(url, cap, types = null) {
  const r = await fetch(url, { credentials: 'omit', cache: 'no-cache', redirect: 'error' });
  if (!r.ok) throw new Error(`it answered ${r.status}`);
  const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (types && !types.includes(type)) throw Object.assign(new Error(`it’s ${type || 'an unknown type'}`), { refused: true });
  const len = Number(r.headers.get('content-length'));
  if (len > cap) throw Object.assign(new Error('it’s too large'), { refused: true });
  const reader = r.body.getReader(), parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { try { await reader.cancel(); } catch (e) { /* gone */ } throw Object.assign(new Error('it’s too large'), { refused: true }); }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return { bytes, type };
}

export default async function (app) {
  const { store, ui, devices } = app;
  const params = new URLSearchParams(location.search);
  const on = COMMUNITY_LIVE || isLocalHost(location.hostname);
  const tools = installTools(app);
  const tool = communityTool(app);
  const S = { status: 'off', url: null, bundled: false, how: 'bundled', all: [], entries: [], built: null, skipped: 0, refused: 0, newer: false, inputs: {}, revoked: new Map(), bundledEntries: [], kind: 'all', open: null, code: new Map(), reached: false, busy: new Set() };
  let loading = null;
  let refusedSource = false;

  // the address keeps nothing the shelf can't use: off, its parameters go
  const strip = (...keys) => { try { const u = new URL(location.href); let n = 0; for (const k of keys) if (u.searchParams.has(k)) { u.searchParams.delete(k); n++; } if (n) history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* fine */ } };

  app.community = {
    on: () => on,
    ready: () => loading || Promise.resolve(),
    state: () => ({ entries: S.entries, bundled: S.bundled, source: S.bundled ? 'bundled' : S.url, built: S.built, newer: S.newer, status: S.status }),
    section, reach, offer, targetFor, tryEntry, matchKernel, heldLines, stop: () => player.stop(),
  };
  tools.register(tool);
  if (!on) { strip('community', 'community-device'); return; }

  css('ew-community', SHELF_CSS);
  const tryOn = () => TRY_ON || (() => { try { return localStorage.getItem(TRY_KEY) === '1'; } catch (e) { return false; } })();

  /* ---------------------------------------------------------------- the index */
  const bundledUrl = new URL(BUNDLED_INDEX, location.href).href;
  function chosenSource() {
    const q = params.get('community');
    if (q != null) {
      const u = indexUrlAllowed(q, { page: location.href, live: COMMUNITY_LIVE });
      if (u) return { url: u, how: 'link' };
      refusedSource = true;
    }
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && typeof s.url === 'string') { const u = indexUrlAllowed(s.url, { page: location.href, live: COMMUNITY_LIVE }); if (u) return { url: u, how: 'stored' }; }
    } catch (e) { /* none */ }
    return { url: bundledUrl, how: 'bundled' };
  }
  async function readFrom(url, bundled) {
    try {
      const { bytes } = await fetchCapped(url, LIMITS.jsonBytes);
      return readIndex(new TextDecoder().decode(bytes), { base: url, bundled });
    } catch (e) { return { entries: [], error: e.message, revoked: [], skipped: 0, refused: 0, newer: false, inputs: {} }; }
  }
  function load() {
    loading = (async () => {
      S.status = 'loading';
      const src = chosenSource();
      S.url = src.url; S.how = src.how; S.bundled = src.url === bundledUrl;
      // the studio's own copy is read every load, whatever the section shows: its deny list, and what the held strip
      // and the prompt may say as fact
      const own = await readFrom(bundledUrl, true);
      S.bundledEntries = own.entries || [];
      S.revoked = new Map((own.revoked || []).map((r) => [r.sha256, r]));
      if (S.revoked.size) { try { app.trust?.forget?.([...S.revoked.keys()]); } catch (e) { console.warn('overdub: the shelf could not take a hash back', e); } }
      const r = S.bundled ? own : await readFrom(S.url, false);
      S.all = r.entries || [];
      S.entries = S.all.filter((e) => e.tier === 'community' && !S.revoked.has(e.sha256));
      S.built = r.built || null; S.skipped = r.skipped || 0; S.refused = r.refused || 0; S.newer = !!r.newer; S.inputs = r.inputs || {};
      S.status = r.newer ? 'newer' : r.error && !S.all.length ? 'none' : 'ready';
      prints = null;
      // Find finds the Browser by the shelf's words while it's on, and says the shelf is in there
      try {
        const f = ui.workspace?.FEATURES?.find((x) => x.id === 'browser');
        if (f) {
          for (const w of SHELF_WORDS) if (!f.aliases.includes(w)) f.aliases.push(w);
          // (a line of its own under the purpose, which stays the spec's word for word)
          f.note = S.entries.length ? 'And the community shelf: devices other people asked their agents for.' : null;
        }
      } catch (e) { /* no workspace */ }
      app.browser?.render?.();
      // what was drawn before the shelf was read (the held strip's lines) draws again
      ui.emit('community:ready', { status: S.status });
    })();
    return loading;
  }
  load();
  if (refusedSource) ui.on('ready', () => ui.toast(say.refusedSource, { kind: 'bad', ms: 6000 }));

  // the studio's own copy's hashes, worked out as kernel prints (keep.js) the first time an agent defines a device while
  // the shelf has entries: define_device refuses a shelf device's code, as it is or with its names or spacing changed.
  // The device files are fetched then, never while browsing.
  let prints = null;
  async function matchKernel(source) {
    if (typeof source !== 'string') return null;
    await app.community.ready();
    const list = [...S.all, ...S.bundledEntries];
    if (!list.length) return null;
    const hash = kernelHash(source);
    const exact = list.find((e) => e.sha256 === hash);
    if (exact) return { id: exact.id, name: exact.name };
    if (!prints) {
      prints = (async () => {
        const out = [];
        for (const e of list.slice(0, 200)) {
          try { const { bytes } = await fetchCapped(e.device, LIMITS.deviceBytes); const def = parseDeviceFile(new TextDecoder().decode(bytes)); if (kernelHash(def.kernel) === e.sha256) out.push({ id: e.id, name: e.name, print: kernelPrint(def.kernel) }); } catch (err) { /* unreadable: nothing to match */ }
        }
        return out;
      })();
    }
    const mine = kernelPrint(source);
    const hit = (await prints).find((p) => p.print === mine);
    return hit ? { id: hit.id, name: hit.name } : null;
  }

  /* ---------------------------------------------------------------- hearing it */
  // One preview at a time, looped until Stop, at half volume and faded in: a clip from any shelf can be loud.
  const player = (() => {
    const audio = new Audio();
    audio.loop = true; audio.preload = 'none';
    let cur = null, fade = 0, blobUrl = null;
    const listeners = new Set();
    const tell = () => { for (const fn of listeners) fn(cur); };
    function stop() {
      clearInterval(fade);
      try { audio.pause(); } catch (e) { /* fine */ }
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
      audio.removeAttribute('src');
      cur = null; tell();
    }
    async function clipBlob(clips) {
      for (const c of clips || []) {
        if (!audio.canPlayType(c.type)) continue;
        const { bytes, type } = await fetchCapped(c.src, LIMITS.clipBytes, ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave']);
        return new Blob([bytes], { type: type === 'audio/mpeg' ? 'audio/mpeg' : 'audio/wav' });
      }
      throw Object.assign(new Error('no clip this browser plays'), { refused: true });
    }
    async function play(entry, { dry = false } = {}) {
      const clips = dry ? entry.preview.dry : entry.preview.wet;
      const at = cur && cur.id === entry.id ? audio.currentTime : 0;
      let blob;
      try { blob = await clipBlob(clips); } catch (e) { stop(); ui.toast(e.refused ? say.clipRefused : `Couldn’t fetch the clip: ${e.message}.`, { kind: 'bad' }); return false; }
      // the song and a preview don't play over each other
      if (app.engine?.playing) { try { app.engine.stop(); } catch (e) { /* fine */ } }
      clearInterval(fade);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(blob);
      audio.src = blobUrl;
      audio.volume = 0;
      cur = { id: entry.id, dry };
      tell();
      try { audio.currentTime = at; } catch (e) { /* not seekable yet */ }
      try { await audio.play(); } catch (e) { stop(); ui.toast(`The clip wouldn’t play: ${e.message}`, { kind: 'bad' }); return false; }
      if (at) { try { audio.currentTime = Math.min(at, (audio.duration || at) - 0.01); } catch (e) { /* fine */ } }
      const t0 = performance.now();
      fade = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / 200); audio.volume = 0.5 * k; if (k >= 1) clearInterval(fade); }, 20);
      return true;
    }
    return { audio, play, stop, now: () => cur, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  })();
  // what's playing, for the checks: { id, dry, src, time, paused, volume } | null
  app.community.nowPlaying = () => { const c = player.now(); return c ? { ...c, src: player.audio.src, time: player.audio.currentTime, paused: player.audio.paused, volume: player.audio.volume } : null; };
  app.engine?.on?.('transport', (e) => { if (e?.playing && player.now()) player.stop(); });
  player.on(() => refreshButtons());
  // every ▶ for an entry says Stop, with the stop glyph, while its clip plays: the ones on screen when the player
  // changes, and a button drawn later (the Browser draws again when a row opens) from the moment it's made
  function paintPlay(b, cur = player.now()) {
    const anyOn = !!cur && cur.id === b.dataset.csPlay;
    if (b.dataset.csDry === '1') { b.setAttribute('aria-pressed', String(anyOn && !!cur.dry)); return; }
    if (b.classList.contains('on') !== anyOn || !b.dataset.csDrawn) {
      b.classList.toggle('on', anyOn);
      b.dataset.csDrawn = '1';
      const ico = b.querySelector('.ico'); if (ico) ico.replaceWith(icon(anyOn ? 'stop' : 'play', { size: 11 }));
    }
    b.setAttribute('aria-label', anyOn ? `Stop ${b.dataset.csName}` : b.dataset.csLabel);
    const w = b.querySelector('.cs-w'); if (w) w.textContent = anyOn ? 'Stop' : b.dataset.csWords || '';
  }
  function refreshButtons() {
    const cur = player.now();
    for (const b of document.querySelectorAll('[data-cs-play]')) paintPlay(b, cur);
  }
  function playButton(e, { words = true, big = false } = {}) {
    const label = e.kind === 'instrument' ? 'Hear it' : { strum: 'On a strum', drums: 'On drums', bass: 'On a bass' }[e.preview.input] || 'Hear it';
    const b = h(`button.btn.cs-play${big ? '.cs-play-big' : ''}${words ? '' : '.cs-play-row'}`, { type: 'button', dataset: { csPlay: e.id, csName: e.name, csLabel: `${label}: ${e.name}`, csWords: words ? label : '' }, 'aria-label': `${label}: ${e.name}`, title: words ? null : `${label}: what it played when it was rendered for the shelf`, disabled: !e.preview.wet.length },
      icon('play', { size: 11 }), words ? h('span.cs-w', label) : null);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); const cur = player.now(); if (cur && cur.id === e.id) player.stop(); else player.play(e); });
    paintPlay(b);
    return b;
  }
  function dryButton(e) {
    if (e.kind !== 'effect' || !e.preview.dry) return null;
    const b = h('button.tog.cs-dry', { type: 'button', 'aria-pressed': 'false', dataset: { csPlay: e.id, csDry: '1' }, title: 'The same input with nothing on it, at the same place in the loop' }, 'Dry');
    paintPlay(b);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); const cur = player.now(); player.play(e, { dry: !(cur && cur.id === e.id && cur.dry) }); });
    return b;
  }

  /* ---------------------------------------------------------------- where it goes */
  // -> { track: <id> | 'master' | 'new', name: 'Vocals' | 'the master' | 'a new track', replaces?: 'Piano', already? }
  // already: it's on that track now (an effect in its chain, or its instrument): a Try there would stack a second copy
  function findTrack(ref) {
    const p = store.get();
    return p.tracks.find((t) => t.id === ref) || p.tracks.find((t) => String(t.name).toLowerCase() === String(ref).toLowerCase()) || null;
  }
  function targetFor(e, ref = null) {
    const p = store.get();
    let tid = ref == null || ref === '' ? currentTrack(app) : ref;
    if (tid === 'new') return { track: 'new', name: 'a new track' };
    if (tid === 'master') return e.kind === 'effect' ? { track: 'master', name: 'the master', already: (p.master?.inserts || []).some((i) => i.device === e.id) } : { track: 'new', name: 'a new track' };
    const t = tid ? findTrack(tid) : null;
    if (ref && !t) return { error: `no track "${String(ref).slice(0, 60)}"`, hint: `tracks: ${p.tracks.map((x) => x.name).join(', ') || 'none'}; or "master", or "new"` };
    if (!t) return { track: 'new', name: 'a new track' };
    if (e.kind === 'effect') return { track: t.id, name: t.name, already: (t.inserts || []).some((i) => i.device === e.id) };
    if (t.kind !== 'instrument') return { track: 'new', name: 'a new track' };
    const was = t.instrument?.device ? (devices.getDevice(t.instrument.device)?.name || devices.heldDevice?.(t.instrument.device)?.name || t.instrument.device) : null;
    return { track: t.id, name: t.name, replaces: was && t.instrument.device !== e.id ? was : null, already: t.instrument?.device === e.id };
  }
  // A new track comes with a two-bar part (tryPart) so Play has something to put through it; one dispatch, one Undo.
  function placeOps(e, target) {
    if (target.track === 'new') {
      const part = tryPart(e);
      const clips = [{ kind: 'notes', start: 0, length: 8, name: part.name, notes: typeof part.notes === 'string' ? parseNotes(part.notes) : part.notes }];
      const instrument = e.kind === 'effect' ? { device: part.device, params: {} } : { device: e.id, params: {} };
      return [{ type: 'track.add', ref: 'n', track: { name: e.name, kind: 'instrument', instrument, inserts: e.kind === 'effect' ? [{ device: e.id }] : [], clips } }];
    }
    if (e.kind === 'effect') return [{ type: 'insert.add', track: target.track, insert: { device: e.id } }];
    return [{ type: 'instrument.set', track: target.track, device: e.id }];
  }
  const tryWords = (target) => (target.already ? `On ${target.name} already` : target.track === 'new' ? 'Try on a new track' : `Try on ${target.name}`);
  // the detail's Try: its words, and pressable only when there's somewhere new for it to go
  function paintTry(b, e) {
    const t = targetFor(e);
    b.textContent = tryWords(t);
    if (t.already) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    b.title = t.already ? `It’s on ${t.name}. Select another track to try it there.` : '';
  }

  /* ---------------------------------------------------------------- the trust prompt */
  // The same prompt whether the person pressed Try or an agent's card: it never shows an agent's words. Focus starts on
  // Not now; Play it is held for 600 ms (a double-click or a held key never lands on it); Esc is Not now.
  // -> Promise<{ go, remember, newTrack }>
  let promptOpen = null;
  function askTrust(e, def, { anchor = null, target }) {
    promptOpen?.close?.(false);
    return new Promise((resolve) => {
      const keyHere = (() => { try { return Object.keys(localStorage).some((k) => /anthropic|api-key|apikey/i.test(k) && localStorage.getItem(k)); } catch (e2) { return false; } })();
      const own = e.origin === 'bundled';
      const who = e.author.alias || e.author.handle;
      const fp = (e.sha256 || '').slice(0, 12);
      const box = h('input', { type: 'checkbox', id: 'cs-remember' });
      const inPlace = e.kind === 'instrument' && target.replaces;
      const go = h('button.btn.btn-go.cs-go', { type: 'button', disabled: true }, inPlace ? `Play it on ${target.name}, in place of ${target.replaces}` : `Play it on ${target.track === 'new' ? 'a new track' : target.name}`);
      const alt = inPlace ? h('button.btn.btn-txt.cs-alt', { type: 'button', disabled: true }, 'Play it on a new track') : null;
      const no = h('button.btn.cs-no', { type: 'button' }, 'Not now');
      const codeBox = h('pre.cs-code', { hidden: true });
      const read = h('button.btn.btn-txt.cs-read', { type: 'button', onclick: () => { codeBox.hidden = !codeBox.hidden; codeBox.textContent = def.kernel; } }, 'Read the code');
      const credit = own
        ? [h('b', e.name), ' is code. ', byline(`author:${who}`, { app }), ' asked for it', e.agent ? [', ', byline(`agent:${e.agent}`, { app }), ' wrote it'] : '', '. A person read it before it went on the shelf.']
        : [h('b', e.name), ` is code. The shelf at ${hostOf(e.origin)} says ${who} asked for this. The studio can’t confirm that.`];
      const el = h('div.cs-prompt', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Run ${e.name}?` },
        h('p.cs-p1', ...credit),
        h('p.cs-p2', `It runs on the studio’s audio thread, in ${keyHere ? 'the same browser tab as your API key' : 'this browser tab'}. It can’t reach the network or your files from there, but it can change how other devices sound. The check catches mistakes, not malice. The clip is a recording, not a promise.`),
        h('p.cs-fp', 'Fingerprint ', h('code', fp), ' · ', read),
        codeBox,
        h('label.cs-remember', box, ' Run it in any song from now on'),
        h('div.cs-acts', go, alt, no));
      const close = (result) => {
        if (promptOpen !== api) return;
        promptOpen = null;
        el.remove(); window.removeEventListener('keydown', onKey, true);
        try { (anchor && anchor.isConnected ? anchor : null)?.focus?.(); } catch (e3) { /* fine */ }
        resolve(result);
      };
      const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close({ go: false }); } else if (el.contains(document.activeElement)) ev.stopPropagation(); };
      go.onclick = () => close({ go: true, remember: box.checked, newTrack: false });
      if (alt) alt.onclick = () => close({ go: true, remember: box.checked, newTrack: true });
      no.onclick = () => close({ go: false });
      const api = { close: (x) => close({ go: !!x }) };
      promptOpen = api;
      document.body.append(el);
      // anchored under the row on a wide screen; a bottom sheet on a phone
      if (window.innerWidth > 640 && anchor && anchor.isConnected) {
        const r = anchor.getBoundingClientRect(), w = Math.min(420, window.innerWidth - 24);
        el.style.width = w + 'px';
        el.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left)) + 'px';
        const below = r.bottom + 6, hgt = el.offsetHeight;
        el.style.top = (below + hgt < window.innerHeight - 12 ? below : Math.max(12, r.top - hgt - 6)) + 'px';
      } else el.classList.add('cs-sheet');
      window.addEventListener('keydown', onKey, true);
      no.focus();
      setTimeout(() => { go.disabled = false; if (alt) alt.disabled = false; }, 600);
    });
  }

  /* ---------------------------------------------------------------- Try */
  // opts: { by ('you', or the agent whose card it is), track (a target), anchor, keepOnly (Add to this song without
  // placing it), req (the agent's card) } -> { ok, ... }
  async function tryEntry(e, { by = 'you', track = null, anchor = null, keepOnly = false, req = null } = {}) {
    const no = (text, extra = {}) => { ui.toast(text, { kind: 'bad', ms: 8000 }); return { ok: false, error: text, ...extra }; };
    if (!tryOn()) return no(say.heldBack, { held: true });
    if (S.busy.has(e.id)) return { ok: false, busy: true };
    if (S.revoked.has(e.sha256)) return no(`${e.name} was taken off the shelf: ${S.revoked.get(e.sha256).reason}`);
    // a second Try on the same track would put a second copy in series: a different sound from the one previewed
    if (!keepOnly) {
      const t0 = track ? targetFor(e, track) : targetFor(e);
      if (t0.already) { ui.toast(`${e.name} is on ${t0.name} already. Select another track to try it there.`, { ms: 6000 }); return { ok: false, already: true, on: t0.name }; }
    }
    S.busy.add(e.id);
    try {
      let def;
      try {
        const { bytes } = await fetchCapped(e.device, LIMITS.deviceBytes);
        def = parseDeviceFile(new TextDecoder().decode(bytes));
      } catch (err) { return no(`Couldn’t read ${e.name}’s file: ${err.message}.`); }
      if (kernelHash(def.kernel) !== e.sha256 || def.id !== e.id || def.kind !== e.kind) return no(`Refused ${e.name}: the file doesn’t match the shelf’s fingerprint for it.`);
      const shipped = devices.getDevice(def.id);
      if (shipped && shipped.source !== 'project') return no(`${e.name} uses an id the studio ships. Nothing changed.`);
      const have = store.get().devices?.[def.id];
      if (have && have.kernel !== def.kernel) return no(`This song has its own ${e.name}, with different code. Nothing changed.`);
      let target = track ? targetFor(e, track) : targetFor(e);
      let n = 0, remembered;
      if (target.error) return no(target.error);
      // the person decides, unless this browser already runs this code
      if (!app.trust?.trusts?.(def.kernel)) {
        const a = await askTrust(e, def, { anchor, target });
        if (!a.go) return { ok: false, declined: true };
        if (a.newTrack) target = { track: 'new', name: 'a new track' };
        // the device check, before anything is stored: it runs the kernel offline whether or not it's trusted
        const report = await check(def);
        if (!report.ok) return no(`${e.name} ran in the check and failed it: ${report.errors?.[0] || 'the device check failed'}. It isn’t on the song.`, { refused: true, report });
        n = a.remember ? app.trust.allow([def.kernel]) : app.trust.allowForNow([def.kernel]);
        remembered = a.remember;
      }
      const credit = { author: e.author.handle, alias: e.author.alias, agent: e.agent, license: e.license, sha256: e.sha256, source: e.source.url || e.source.path };
      // the file's code (its hash is the entry's) under the entry's words: the name, blurb and request the person was
      // shown, not whatever else the file says. A field the entry doesn't have is left out, never taken from the file.
      const words = { name: e.name, blurb: e.blurb, nod: e.nod || undefined, request: e.request || undefined, look: Object.keys(e.look || {}).length ? { ...e.look } : undefined };
      const device = { ...def, ...words, by: 'you', credit };
      for (const k of Object.keys(words)) if (device[k] === undefined) delete device[k];
      const define = have ? [] : [{ type: 'device.define', device }];
      if (keepOnly) {
        if (!define.length) { ui.toast(`${e.name} is already in this song.`); return { ok: true, already: true }; }
        const r = store.dispatch(define, { by: 'you', label: `kept ${e.name} from the community shelf` });
        if (!r.ok) { if (n === 1) app.trust.forget([def.kernel]); return no(`Couldn’t add ${e.name}: ${r.error}`); }
        ui.toast(`${e.name} is in this song. It’s under “Written in this song”.`, { kind: 'ok', ms: 6000 });
        return { ok: true, kept: true };
      }
      const ops = [...define, ...placeOps(e, target)];
      const agent = by !== 'you';
      // the preview stops: what plays next is the song, through the device
      player.stop();
      const r = store.dispatch(ops, { by, label: agent ? `put ${e.name} from the community shelf on ${target.name}` : `tried ${e.name} from the community shelf`, ...(agent ? { kept: true } : {}) });
      if (!r.ok) { if (n === 1) app.trust.forget([def.kernel]); return no(`Couldn’t put ${e.name} on: ${r.error}`); }
      if (r.txn && agent) { r.txn.keptBy = 'you'; ui.emit('history:annotate', { txn: r.txn }); }
      const tid = target.track === 'new' ? r.created?.n : target.track;
      try { if (tid) ui.select({ track: tid, clip: null, insert: r.created?.insert || null }); } catch (err) { /* fine */ }
      // on a phone, the song comes back into view
      if (window.innerWidth <= 640) { try { ui.setOpen('left', false); } catch (err) { /* fine */ } }
      const onName = target.track === 'new' ? 'a new track' : target.name;
      const part = target.track === 'new' ? ` It has a two-bar ${tryPart(e).name.toLowerCase()} ${e.kind === 'effect' ? 'going through it' : 'to play'}.` : '';
      const slot = e.kind === 'instrument' ? 'instrument' : r.created?.insert;
      const acts = [
        app.engine && !app.engine.playing ? h('button.btn.btn-txt.cs-t-play', { type: 'button', onclick: () => { player.stop(); try { app.transport?.playOn ? app.transport.playOn() : app.engine.play(); } catch (err) { /* fine */ } } }, 'Play') : null,
        app.plugin && tid && slot ? h('button.btn.btn-txt.cs-t-open', { type: 'button', onclick: () => app.plugin.open({ track: tid, slot }) }, 'Open') : null,
      ].filter(Boolean);
      ui.toast([`${e.name} is on ${onName}.${part}${remembered === undefined ? '' : remembered ? ' This browser runs its code from now on.' : ' Its code runs here until you reload.'} `, ...acts], { kind: 'ok', ms: 9000, action: { label: 'Undo', run: () => store.undo({ id: r.txn?.id }) } });
      if (req) settle(req, { kept: true, txn: r.txn?.id, on: onName, note: 'the person pressed Try, allowed the code and it passed the check; it is on the track, signed by you and kept by them' });
      return { ok: true, txn: r.txn?.id, track: tid };
    } finally { S.busy.delete(e.id); }
  }
  async function check(def) {
    try {
      const { checkDevice } = await import('../kernel/check.js');
      return await checkDevice({ ...def });
    } catch (err) { return { ok: false, errors: [String(err && err.message || err)] }; }
  }

  /* ---------------------------------------------------------------- the section */
  let reachedBy = null;
  // The Browser open on the shelf: on an entry's detail (id), or with the section's head at the top (no id). The shelf
  // sits under the studio's own instruments and effects, a screen or two down, so it's always scrolled to.
  function reach(id = null, by = 'you') {
    reachedBy = by;
    try { ui.workspace?.reach?.('browser', by); } catch (e) { /* no workspace */ }
    try { ui.show('browser'); if (!ui.isOpen?.('left')) ui.setOpen('left', true); } catch (e) { /* fine */ }
    S.reached = true;
    if (id) S.open = id;
    app.community.ready().then(() => {
      app.browser?.render?.();
      requestAnimationFrame(() => {
        const el = id ? document.querySelector(`.cs-detail[data-community="${CSS.escape(id)}"]`) : document.querySelector('.cs-group');
        el?.scrollIntoView({ block: id ? 'nearest' : 'start' });
      });
    });
  }
  // Find: Go to Instruments and effects, found by one of the shelf's words, opens the Browser on the shelf
  ui.on('workspace:go', (d) => { if (d?.id === 'browser' && shelfQuery(d.query)) reach(null, d.by || 'you'); });
  function credit(e, cls = 'cs-credit') {
    const who = e.author.alias || e.author.handle;
    const a = byline(`author:${who}`, { app, title: e.author.alias ? `${e.author.alias} (was ${e.author.handle})` : null });
    return h(`span.${cls}`, a, e.agent ? [' with ', byline(`agent:${e.agent.replace(/ \(.*\)$/, '')}`, { app, title: e.agent })] : null);
  }
  function section({ q = '', searching = false, prefs, savePrefs, render }) {
    if (!on) return null;
    const noShelf = S.status === 'none' || S.status === 'loading';
    // with no shelf here (and nobody pointing at one), the Browser stays as it was
    if (noShelf && S.how === 'bundled' && !S.reached) return null;
    const list = S.status === 'ready' ? filterEntries(S.entries, { q, kind: S.kind === 'all' ? null : S.kind }) : [];
    if (searching && !list.length) return null;
    const rows = [];
    const closed = searching || S.reached ? false : prefs?.closed?.community === true;
    const toggle = () => { if (prefs) { prefs.closed.community = !closed; savePrefs?.(); } S.reached = false; render?.(); };
    const head = h('button.br-sec.cs-sec', { 'aria-expanded': String(!closed), onclick: toggle }, icon('chevron', { size: 13 }), h('span', 'From the community'), h('em', String(S.status === 'ready' ? S.entries.length : 0)));
    if (closed) return { el: h('div.br-group.closed.cs-group', head), rows };
    const kids = [];
    if (S.status === 'loading') kids.push(h('div.br-none', 'Reading the shelf…'));
    else if (S.status === 'newer') kids.push(h('div.br-none', say.newer));
    else if (S.status === 'none') kids.push(h('div.br-none.cs-none', h('span', say.none), h('button.btn.cs-again', { type: 'button', onclick: () => load() }, 'Look again')));
    else {
      kids.push(shelfLine());
      kids.push(h('div.cs-target', say.target));
      // kind words, only when the shelf holds both
      const nI = S.entries.filter((x) => x.kind === 'instrument').length, nE = S.entries.length - nI;
      if (nI && nE && !searching) {
        const word = (k, label, n) => h('button.cs-kind', { type: 'button', 'aria-pressed': String(S.kind === k), onclick: () => { S.kind = k; render?.(); } }, label, h('small', String(n)));
        kids.push(h('div.cs-kinds', { role: 'group', 'aria-label': 'Show' }, word('all', 'All', S.entries.length), word('instrument', 'Instruments', nI), word('effect', 'Effects', nE)));
      }
      const more = [S.skipped ? `${S.skipped} more need a newer studio.` : '', S.refused ? `${S.refused} more were left out.` : ''].filter(Boolean).join(' ');
      if (list.length >= 20 && !searching) {
        const by = new Map();
        for (const e of list) { if (!by.has(e.cat)) by.set(e.cat, []); by.get(e.cat).push(e); }
        for (const [c] of DEVICE_CATS) {
          const g = by.get(c); if (!g) continue;
          kids.push(h('div.br-sub', h('div.br-subh.cs-subh', catName(c), h('em', String(g.length))), g.map((e) => item(e, rows))));
        }
      } else for (const e of list) kids.push(item(e, rows));
      if (!list.length) kids.push(h('div.br-none', S.kind === 'all' ? 'Nothing on this shelf yet.' : 'None of those on this shelf.'));
      if (more) kids.push(h('div.cs-more', more));
    }
    return { el: h('div.br-group.cs-group', { dataset: { shelf: S.bundled ? 'bundled' : 'other' } }, head, h('div.br-rows', kids)), rows };
  }
  function shelfLine() {
    const full = ui.workspace?.view?.() !== 'simple' && !document.documentElement.classList.contains('ws-simple');
    const n = S.entries.length, when = dayOf(S.built?.at);
    const what = `${n} device${n === 1 ? '' : 's'}${when ? `, built ${when}` : ''}.`;
    if (S.bundled) {
      if (!full) return null;
      return h('div.cs-line', h('span', `The copy that came with this studio: ${what}`), h('button.btn.btn-txt.cs-change', { type: 'button', onclick: change }, 'Change'));
    }
    return h('div.cs-line', h('span', `From ${hostOf(S.url)}: ${what}`), h('button.btn.btn-txt.cs-back', { type: 'button', onclick: back }, 'Back to the studio’s copy'), full ? h('button.btn.btn-txt.cs-change', { type: 'button', onclick: change }, 'Change') : null);
  }
  function change() {
    const v = window.prompt('Read a shelf from (a path on this site, or http://localhost:…/community-index.json):', S.bundled ? '' : S.url);
    if (v == null) return;
    const u = indexUrlAllowed(v.trim(), { page: location.href, live: COMMUNITY_LIVE });
    if (!u) { ui.toast(say.refusedSource, { kind: 'bad' }); return; }
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ url: u })); } catch (e) { /* this load only */ }
    params.delete('community');
    load();
  }
  function back() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* fine */ }
    params.delete('community');
    strip('community');
    load();
  }
  function item(e, rows) {
    const open = S.open === e.id;
    const sw = h('i.br-sw', { style: { background: e.look.color || '#4f4940' } });
    const opt = h('div.br-row.cs-row', { role: 'option', tabindex: -1, 'aria-selected': 'false', 'aria-expanded': String(open), dataset: { community: e.id, kind: e.kind }, title: `${e.name}: ${e.blurb}` },
      sw, h('span.br-n', e.name), h('span.br-blurb.cs-blurb', e.blurb), credit(e, 'cs-credit.cs-row-credit'));
    const toggle = () => { S.open = open ? null : e.id; app.browser?.render?.(); };
    opt.addEventListener('click', toggle);
    rows.push({ el: opt, kind: 'community', item: e, enter: () => { if (S.open !== e.id) { S.open = e.id; app.browser?.render?.(); } } });
    const wrap = h('div.cs-item' + (open ? '.cs-open' : ''), opt, playButton(e, { words: false }));
    return open ? [wrap, detail(e)] : wrap;
  }
  function detail(e) {
    const own = e.origin === 'bundled';
    const target = targetFor(e);
    const nums = plainNumbers(e.measured, e.kind);
    // held back (TRY_ON), there's no Try and no Keep to press: a line says so, and hearing and reading stay
    const held = !tryOn();
    const tryBtn = held ? null : h('button.btn.btn-go.cs-try', { type: 'button' }, tryWords(target));
    if (tryBtn) { paintTry(tryBtn, e); tryBtn.addEventListener('click', () => tryEntry(e, { anchor: tryBtn }).then(() => app.browser?.render?.())); }
    const codeBox = h('pre.cs-code', { hidden: true });
    const read = h('button.btn.btn-txt.cs-read', { type: 'button' }, 'Read the code');
    read.addEventListener('click', async () => {
      if (!codeBox.hidden) { codeBox.hidden = true; return; }
      try { const { bytes } = await fetchCapped(e.device, LIMITS.deviceBytes); const def = parseDeviceFile(new TextDecoder().decode(bytes)); codeBox.textContent = `// fingerprint ${e.sha256.slice(0, 12)}${kernelHash(def.kernel) === e.sha256 ? '' : ' (this file doesn’t match it)'}\n${def.kernel}`; codeBox.hidden = false; }
      catch (err) { ui.toast(`Couldn’t read ${e.name}’s file: ${err.message}.`, { kind: 'bad' }); }
    });
    const keep = held ? null : h('button.btn.btn-txt.cs-keep', { type: 'button', title: 'It goes in the song’s own list, under “Written in this song”, on no track until you put it on one', onclick: () => tryEntry(e, { keepOnly: true, anchor: keep }) }, 'Keep it in this song, on no track');
    return h('div.cs-detail', { dataset: { community: e.id } },
      h('p.cs-d-head', h('b', e.name), ' — ', e.blurb),
      h('div.cs-d-hear', playButton(e), dryButton(e)),
      held ? h('p.cs-held', say.heldBack) : h('div.cs-d-try', tryBtn),
      e.request ? h('blockquote.cs-request', `“${e.request}”`) : null,
      h('p.cs-by', 'by ', credit(e, 'cs-credit'), e.requester && e.requester.length <= ASKED_MAX ? h('small.cs-asked', `Asked for by ${e.requester}`) : null),
      own ? null : h('p.cs-says', 'The shelf says:'),
      nums.words ? h('p.cs-words', nums.words) : null,
      nums.figures ? h('p.cs-figures', nums.figures) : null,
      own && e.measured.ok ? h('p.cs-vouched', say.vouched) : null,
      h('p.cs-paper', e.license, e.source.text ? [' · ', e.source.url ? h('a', { href: e.source.url, target: '_blank', rel: 'noopener noreferrer' }, e.source.text) : e.source.text] : null, ' · ', read, keep ? [' · ', keep] : null),
      codeBox);
  }
  const repaintTry = () => { for (const b of document.querySelectorAll('.cs-detail .cs-try')) { const e = entryById(S.entries, b.closest('.cs-detail')?.dataset.community); if (e) paintTry(b, e); } };
  ui.on('select', repaintTry);
  store.on('change', repaintTry);

  /* ---------------------------------------------------------------- an agent's card */
  // One pending card per song; it never vouches, and no words of the agent's are on it. Try runs the Try path above, so
  // the trust prompt that follows is the same one.
  let cards = 0;
  function offer(e, { by, track, onDecline }) {
    const reqs = app.tools.requests;
    for (const r of reqs.values()) if (r.kind === 'shelf' && r.status === 'pending') settle(r, { kept: false, note: 'another suggestion took this card’s place; nothing changed' }, 'replaced');
    const id = 'c' + (++cards).toString(36) + Date.now().toString(36).slice(-4);
    const req = { id, kind: 'shelf', by, entry: e, track, status: 'pending', result: null, waiters: new Set(), at: Date.now(), song: store.get().id, onDecline };
    req.render = ({ speaker }) => card(req, speaker);
    req.summarize = (r) => summary(r);
    reqs.set(id, req);
    ui.emit('agent:request', { id, req });
    return req;
  }
  function settle(req, result, why = null) {
    if (req.status !== 'pending') return;
    req.status = 'done';
    req.result = result;
    req.why = why;
    for (const w of [...req.waiters]) w();
    ui.emit('agent:request', { id: req.id, req });
  }
  function summary(req) {
    const r = req.result || {}, e = req.entry;
    if (r.kept) return `You tried ${e.name} on ${r.on}.`;
    if (req.why === 'declined') return `No thanks to ${e.name}.`;
    if (req.why === 'replaced') return `${e.name}: another suggestion took its place.`;
    if (req.why === 'closed') return `${e.name}: the song closed before you chose.`;
    return `${e.name}: nothing changed.`;
  }
  function card(req, speaker) {
    const e = req.entry;
    const target = targetFor(e, req.track);
    const name = target.error ? 'the track' : target.track === 'new' ? 'a new track' : target.name;
    const trusted = app.trust?.has?.(e.sha256);
    const tryIt = h('button.btn.btn-go.cs-card-try', { type: 'button' }, target.track === 'new' ? 'Try it on a new track' : `Try it on ${name}`);
    tryIt.addEventListener('click', async () => {
      const r = await tryEntry(e, { by: req.by, track: target.track || null, anchor: tryIt, req });
      if (r && r.refused) settle(req, { kept: false, refused: true, reason: r.error, note: 'they pressed Try and the device check refused it, so nothing changed' }, 'refused');
    });
    const noThanks = h('button.btn.btn-txt.cs-card-no', { type: 'button', onclick: () => { req.onDecline?.(); settle(req, { kept: false, note: 'they said no thanks; nothing changed' }, 'declined'); } }, 'No thanks');
    return h('section.ag-card.cs-card', { dataset: { k: 'request', id: req.id }, 'aria-label': `${e.name}, suggested from the community shelf` },
      speaker ? speaker(req.by, req.at) : h('div.ag-spk'),
      h('div.ag-body',
        h('p.cs-card-line', byline(req.by, { app, cap: true }), ' suggests ', h('b', e.name), ', by ', credit(e, 'cs-credit'), `, on ${name}.`),
        h('p.cs-card-blurb', e.blurb),
        h('div.cs-d-hear', playButton(e), dryButton(e)),
        trusted ? h('p.cs-card-fine', 'Already allowed here.') : null,
        h('div.ag-take-btns', tryIt, noThanks)));
  }
  // a song that closed takes its card with it
  store.on('change', (ev) => {
    if (ev.kind !== 'load') return;
    for (const r of app.tools.requests.values()) if (r.kind === 'shelf' && r.status === 'pending' && r.song !== store.get().id) settle(r, { kept: false, note: 'the song was closed before they chose; nothing changed' }, 'closed');
  });

  /* ---------------------------------------------------------------- held devices */
  // A held kernel the studio's own copy lists: one line from the index, by hash (never the song's own claims)
  function heldLines(list) {
    const out = [];
    for (const d of list || []) {
      const gone = S.revoked.get(d.hash);
      if (gone) { out.push(`${d.name} was taken off the shelf: ${gone.reason}`); continue; }
      const e = S.bundledEntries.find((x) => x.sha256 === d.hash && x.tier === 'community');
      if (e) out.push(`${e.name} is on the community shelf, by ${e.author.alias || e.author.handle}${e.agent ? ` with ${e.agent.replace(/ \(.*\)$/, '')}` : ''}.`);
    }
    return out;
  }

  /* ---------------------------------------------------------------- from a link */
  // /app/?new&community-device=<id>: Night Shift (an empty song plays silence), the Browser open on the entry, and where
  // it would go named on Try. No prompt: the person presses Try. Nothing is fetched until ▶ or Try.
  const wanted = params.get('community-device');
  if (wanted != null) {
    const fresh = params.has('new');
    ui.on('ready', async () => {
      strip('community-device');
      await app.community.ready();
      const e = entryById(S.entries, wanted);
      if (!e) { ui.toast(`The shelf has no device “${String(wanted).slice(0, 60)}”.`, { kind: 'bad', ms: 6000 }); return; }
      if (fresh) {
        try { store.load(demoProject(), { by: 'you' }); } catch (err) { console.warn('overdub: Night Shift did not open', err); }
        const name = e.kind === 'instrument' ? ({ bass: 'Bass', drums: 'Drums' }[e.cat] || 'Keys')
          : ({ time: 'Hook', ambient: 'Hook', mod: 'Hook', drive: 'Guitar', amp: 'Guitar', fuzz: 'Guitar', dynamics: 'Drums', glitch: 'Drums', bass: 'Bass' }[e.cat] || 'Keys');
        const t = findTrack(name);
        if (t) ui.select({ track: t.id, clip: null, insert: null });
      }
      reach(e.id, 'you');
    });
  }
}

const SHELF_CSS = `
.cs-group .br-rows { padding-bottom: 6px; }
.cs-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 8px 14px 2px 20px; font-size: 11.5px; color: var(--text-3); }
.cs-target { padding: 2px 14px 6px 20px; font-size: 11.5px; color: var(--text-3); }
.cs-kinds { display: flex; gap: 14px; padding: 2px 14px 6px 20px; }
.cs-kind { border: 0; background: none; padding: 2px 0; color: var(--text-3); font: 600 12px var(--font-ui); cursor: pointer; text-decoration: none; }
.cs-kind small { margin-left: 4px; font: 500 11px var(--font-mono); color: var(--text-3); }
.cs-kind[aria-pressed="true"] { color: var(--text); text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 4px; }
.cs-item { display: grid; grid-template-columns: 1fr 40px; align-items: stretch; }
.cs-item > .cs-row { grid-template-columns: 12px 1fr; padding-right: 4px; }
.cs-row .br-blurb.cs-blurb { display: block; }
.cs-row .cs-row-credit { grid-column: 2 / -1; font-size: 11.5px; color: var(--text-3); }
.cs-row .by { font-size: 11.5px; }
@media (max-width: 640px) { .cs-row .cs-row-credit { display: none; } }
.cs-play { min-width: 40px; }
.cs-try[aria-disabled="true"] { background: none; border-color: var(--line); color: var(--text-3); cursor: default; }
.cs-line .btn-txt { min-height: 0; font-size: 11.5px; }
.cs-play-row { width: 40px; height: auto; min-height: 40px; padding: 0; border: 0; border-left: var(--rule); border-radius: 0; color: var(--text-2); }
.cs-play-row:hover { background: var(--bg-3); }
.cs-play.on { color: var(--text); }
.cs-detail { display: grid; gap: 7px; padding: 10px 14px 14px 20px; border-top: var(--rule); border-bottom: var(--rule); font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.cs-detail p { margin: 0; }
.cs-d-head b { color: var(--text); }
.cs-d-hear, .cs-d-try { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.cs-held { color: var(--text-3); font-size: 11.5px; }
.cs-request { margin: 0; padding: 0; font-style: italic; color: var(--text-2); }
.cs-by { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; }
.cs-asked { color: var(--text-3); font-size: 11.5px; }
.cs-says { color: var(--text-3); font-size: 11.5px; }
.cs-figures { font: 500 11px var(--font-mono); color: var(--text-3); }
.cs-vouched { color: var(--text-3); font-size: 11.5px; }
.cs-paper { font-size: 11.5px; color: var(--text-3); }
.cs-paper .btn-txt { min-height: 0; font-size: 11.5px; }
.cs-code { max-height: 260px; overflow: auto; margin: 0; padding: 8px 0; border-top: var(--rule); font: 11px/1.45 var(--font-mono); color: var(--text-2); white-space: pre; }
.cs-more { padding: 6px 14px 0 20px; font-size: 11.5px; color: var(--text-3); }
.cs-none { align-items: start; }
.cs-prompt { position: fixed; z-index: 60; display: grid; gap: 9px; padding: 14px 16px; background: var(--bg-2, var(--bg)); color: var(--text-2); border: var(--rule-2); font-size: 12.5px; line-height: 1.45; }
.cs-prompt p { margin: 0; }
.cs-prompt .cs-p1 b { color: var(--text); }
.cs-prompt.cs-sheet { left: 0; right: 0; bottom: 0; max-height: 92vh; overflow: auto; border-width: 1px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); }
.cs-fp code { font: 500 11px var(--font-mono); color: var(--text); }
.cs-remember { display: flex; align-items: center; gap: 8px; color: var(--text); min-height: 32px; }
.cs-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.cs-acts .btn { min-height: 40px; }
.cs-card-line b { color: var(--text); }
.cs-card-blurb, .cs-card-fine { color: var(--text-3); font-size: 12px; margin: 0; }
.cs-card .cs-d-hear { margin: 6px 0; }
`;
