// Songs travel: share links with no server (core/share.js puts the song in the URL's hash), the listening banner, and
// "Make it yours" (the fork). Audio clips don't travel, and the UI says so wherever a link is made or opened.
//
// Opening /app/#s=… (main.js decodes it before the store exists) plays that song without touching yours: nothing is
// autosaved while you listen. The banner says whose it is: "Listening to Night Shift — by Sam and Claude", with a key
// that plays and stops it. [Make it yours] keeps it in your studio with meta.forkedFrom { title, authors, at, id },
// every part still signed by whoever played it (the sender's own parts by a guest author, an agent's still cool, a
// device keeps whoever made it, per whose link it came through), and what you do next by you.
//
// Asking before a song's code runs. A song that opens with devices whose code this browser doesn't trust (main.js holds
// them: devices/trust.js) asks under the banner, or in the same strip for a song that isn't a link (a file opened from
// disk, the saved song, Recent songs): "This song brings 2 devices Sam wrote: Tin Whistle and Half Measure. They're off
// now: Tin Whistle is silent and Half Measure lets the sound through untouched. Each is a small program that runs on
// this computer. Play them if you trust Sam: that code then runs from now on, in this browser, in any song."
// [Play them] [Keep them off], Play them the strip's primary while it's open. Play them trusts their code here
// (app.trust.play) and starts them, no reload; Keep them off leaves them held (the lanes say "kept off"), and the song
// asks again the next time it opens. Make it yours keeps whatever was decided. On a phone the strip is the question
// alone while it's open, and one line once it's answered, so the lanes stay in view.
//
// Sharing: the first Share in a browser asks whose name the link carries before anything is copied; after that it
// copies at once, signed with the name kept (overdub:share-name), and the sheet's Copy link copies the link signed
// with whatever its field says.
//
// app.share = {
//   incoming, listening,                         set by main.js when the page opened on a link
//   link({ name? }) -> { ok, url, chars, dropped } | { ok: false, error }   make a link for the song as it is now
//   copy({ anchor?, name?, into? })              the Song menu's Share: copy the link (Web Share on phones), show it;
//                                                the first time, the sheet asks for the name first ({ ok: false, asked })
//   open(hashOrUrl) -> { ok } | { ok: false, error }   listen to a link in this tab (also on hashchange)
//   fork()                                       Make it yours
//   leave()                                      back to your own song
//   playStop() -> { playing }                    the banner's play key: plays from the marker, or stops
//   lastLink, name                               the latest link made; the name you sign links with
//   asking -> { from: 'link' | 'file' | 'song', held: [Held], answered: null | 'off' } | null   the ask, as it stands
//   play() / keepOff()                           the ask's two buttons
// }
// ui event 'song:opened' { from: 'file' } (ui/export.js) says the song just opened came from a file.
// Agent tool: share_link { name? } -> { url, size, dropped }.

import { h, css, icon, byline } from './dom.js';
import { popover } from './rack.js';
import { encodeShare, openShared, forkSong, creditsOf, namesLine, browserId, kb, MAX_CHARS, isGuestId, isAgentId, shareable } from '../core/share.js';
import { cleanProject } from '../core/project.js';
import { SHARE_SCHEMA } from '../agent/extra-schemas.js';

const SAVE_KEY = 'overdub:project', PREV_KEY = 'overdub:previous', NAME_KEY = 'overdub:share-name';
// the song Make it yours replaced: kept apart from PREV_KEY (which every New song or Open overwrites) until it's back on
// screen; the Song menu offers it (ui/export.js)
const BEFORE_FORK_KEY = 'overdub:before-fork';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
};

export default function (app) {
  const { store, ui } = app;
  css('share', CSS);
  const share = app.share = Object.assign(app.share || { incoming: null, listening: false }, { lastLink: null });
  let banner = null, edited = false, from = null, dropped = null;
  // the ask about the song's held devices: { from, answered } for the song on screen (a new one each time a song opens;
  // Make it yours keeps it)
  let ask = null, keepAsk = false;
  const root = document.getElementById('studio');

  /* ---------------------------------------------------------------- authors the song knows by name */
  // A guest (the person who sent a link) or an outside agent is named in the song (meta.authors); teach the store, so
  // History, the badges and the edges show the right name and colour.
  function learnAuthors() {
    for (const [id, a] of Object.entries(store.get().meta?.authors || {})) {
      if (!id || store.authors[id] || id.startsWith('mcp:')) continue;
      if (a && (a.kind === 'human' || a.kind === 'agent' || a.kind === 'house')) store.addAuthor(id, { kind: a.kind, name: a.name || id });
    }
  }
  learnAuthors();
  store.on('change', (e) => {
    if (e.kind === 'load') {
      learnAuthors();
      // another song was opened while listening (New song, Open a file…): that one is yours, so stop listening
      if (share.listening && store.get().id !== share.incoming?.song?.id) { share.listening = false; edited = false; clearHash(); }
      // a song opened: it asks about its own held devices (Make it yours is the same song: what was decided stands)
      if (!keepAsk) ask = heldNow().length ? { from: share.listening ? 'link' : 'song', answered: null } : null;
      keepAsk = false;
      paintBanner();
      return;
    }
    if (share.listening && e.kind !== 'preview' && !e.txn?.audition && !edited) { edited = true; paintBanner(); }
  });
  // the held set changed (Play them, Play it in the Devices tab, another tab, a device the song lost): say so
  app.devices.onDevices?.((e) => { if (e.type === 'held') paintBanner(); });
  // the community shelf read its index after the strip was drawn: its line on a held device (heldLines) draws now
  ui.on('community:ready', () => { if (heldNow().length) paintBanner(); });
  // a song opened from a file says so (ui/export.js), so the ask can say "This file"
  ui.on('song:opened', (d) => { if (ask && d?.from) { ask.from = d.from; paintBanner(); } });

  /* ---------------------------------------------------------------- making a link */
  Object.defineProperty(share, 'name', { get: () => ls.get(NAME_KEY) || '', set: (v) => ls.set(NAME_KEY, String(v || '').trim().slice(0, 40)), configurable: true });
  async function link({ name = share.name } = {}) {
    const p = store.get();
    const r = await encodeShare(p, { from: { name: name || undefined, me: browserId() || undefined }, max: MAX_CHARS });
    if (!r.ok) return r;
    const url = location.origin + location.pathname + r.hash;
    share.lastLink = { url, chars: r.chars, dropped: r.dropped, title: p.title };
    return { ok: true, url, chars: r.chars, dropped: r.dropped, title: p.title };
  }
  const droppedLine = (d) => {
    const n = d?.audioClips || 0;
    const clips = n ? `Audio clips don’t travel in a link: ${n} recording${n === 1 ? '' : 's'} stay${n === 1 ? 's' : ''} in this browser (send the project file and the WAV stems for those).` : 'Audio clips don’t travel in a link; this song has none.';
    return d?.reference ? `${clips} The reference track stays here too.` : clips;
  };
  async function writeClipboard(text, field) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    try { if (field) { field.focus(); field.select(); } return document.execCommand('copy'); } catch (e) { return false; }
  }
  const phone = () => { try { return matchMedia('(pointer: coarse)').matches && !!navigator.share; } catch (e) { return false; } };
  // has this browser been asked whose name its links carry? (an empty answer counts: those links are signed "Guest")
  const nameKept = () => ls.get(NAME_KEY) != null;
  const signedAs = (name) => String(name || '').trim().slice(0, 40) || 'Guest';

  // The Song menu's Share: make the link, copy it (or hand it to the phone's share sheet) and show what went in it. The
  // first time in this browser (no name kept) it asks first: the sheet opens on "Sign it as" with Copy link, and nothing
  // is copied until then, so a link doesn't go out signed "Guest" before you could type a name. After that it copies at
  // once, signed with the name kept. The sheet's Copy link comes back here with what its field says (name) and the
  // sheet (into), so what is copied is always the link signed with the name on screen.
  async function copy({ anchor = document.querySelector('.sm-btn'), name = null, into = null } = {}) {
    if (name != null) share.name = name;
    if (name == null && !into && anchor && !nameKept()) { sheet(anchor, null); return { ok: false, asked: true }; }
    const r = await link({ name: share.name });
    if (!r.ok) {
      ui.toast(r.error, { kind: 'bad', ms: 7000, action: app.exporter ? { label: 'Save the file', run: () => app.exporter.saveProject() } : null });
      if (into) into.done(r, 'failed'); else if (anchor) sheet(anchor, r);
      return r;
    }
    let how = 'copied';
    if (phone() && !into) {
      try { await navigator.share({ title: r.title, text: `“${r.title}” in Overdub`, url: r.url }); how = 'shared'; } catch (e) { how = (await writeClipboard(r.url)) ? 'copied' : 'shown'; }
    } else how = (await writeClipboard(r.url, into?.field)) ? 'copied' : 'shown';
    if (how !== 'shared') ui.toast(how === 'copied' ? `Link copied: “${r.title}”, ${kb(r.chars)}, signed as ${signedAs(share.name)}. Whoever opens it can listen, then make it theirs.` : 'Here’s the link: copy it from the box.', { kind: 'ok', ms: 5000 });
    if (into) into.done(r, how); else if (anchor) sheet(anchor, r);
    return { ...r, how };
  }

  // The share sheet: the link and Copy link, the name it's signed with, what travels. r: the link just made (copied),
  // or null when it asks for the name first. Copy link always makes the link anew from the name in the field.
  function sheet(anchor, r) {
    const p = store.get();
    const asked = !r;
    const field = h('input.sh-url', { type: 'text', readOnly: true, value: r?.ok ? r.url : '', placeholder: 'the link, once it’s signed', 'aria-label': 'The share link', onfocus: (e) => e.target.select() });
    const sizeLine = (x) => `${kb(x.chars)} of ${kb(MAX_CHARS)}, signed as ${signedAs(share.name)}: the song rides in the link, so no server keeps a copy`;
    const status = h('small.sh-status', { 'aria-live': 'polite' }, asked ? 'Sign it first: whoever opens the link sees this name on your parts.' : r.ok ? sizeLine(r) : r.error);
    const into = {
      field,
      done(x, how) {
        if (!x.ok) { status.textContent = x.error; return; }
        field.value = x.url;
        status.textContent = how === 'copied' ? `Copied, signed as ${signedAs(share.name)}. ${kb(x.chars)} of ${kb(MAX_CHARS)}.` : 'Select the link and copy it.';
      },
    };
    // (the analytics count wraps share.copy: the sheet's copy goes through it too)
    const copyNow = () => share.copy({ anchor: null, name: nameIn.value, into });
    const copyBtn = h('button.ew-btn.ew-btn-primary.ew-btn-small.sh-copy', { type: 'button', onclick: () => copyNow() }, icon('copy', { size: 13 }), 'Copy link');
    const nameIn = h('input.sh-name', { type: 'text', placeholder: 'Guest', value: share.name, maxLength: 40, 'aria-label': 'Sign it as', autocomplete: 'nickname',
      // (kept as it's typed, so a link made any other way carries it too; the link in the box is made anew on Copy link)
      oninput: () => { share.name = nameIn.value; if (field.value) status.textContent = `Copy link signs it as ${signedAs(nameIn.value)}.`; },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); copyNow(); } },
      onchange: async () => { share.name = nameIn.value; if (!field.value) return; const n = await link({ name: share.name }); if (n.ok) { field.value = n.url; status.textContent = `Signed as ${signedAs(share.name)}. Copy link copies this one.`; } } });
    const devs = Object.keys(p.devices || {}).length;
    const ok = asked || r.ok;
    const body = h('div.sh-sheet',
      h('div.sh-h', h('b', 'Share “', p.title, '”'), h('small', `${p.tracks.length} track${p.tracks.length === 1 ? '' : 's'}${devs ? `, ${devs} device${devs === 1 ? '' : 's'} written in it` : ''}`)),
      ok ? h('label.sh-sign', h('span', 'Sign it as'), nameIn) : null,
      ok ? h('div.sh-row', field, copyBtn) : (app.exporter ? h('div.sh-row', h('button.ew-btn.ew-btn-small', { onclick: () => app.exporter.saveProject() }, 'Save the project file')) : null),
      status,
      ok ? h('small.sh-note', 'Notes, devices, the mix and the sections travel, each part signed by whoever played it. ', droppedLine(r?.dropped || shareable(p).dropped)) : null,
      ok && navigator.share ? h('button.ew-btn.ew-btn-small.sh-native', { onclick: async () => { share.name = nameIn.value; const n = await link({ name: share.name }); if (!n.ok) return; field.value = n.url; navigator.share({ title: p.title, text: `“${p.title}” in Overdub`, url: n.url }).catch(() => {}); } }, icon('send', { size: 13 }), 'Share…') : null);
    const pop = popover(anchor, body, { align: 'end', className: 'sh-pop' });
    // asked first: the name field has focus (Enter copies); else the link is selected, ready to copy by hand
    setTimeout(() => { try { if (asked) { nameIn.focus(); nameIn.select(); } else if (r.ok) field.select(); } catch (e) { /* ok */ } }, 0);
    return pop;
  }

  /* ---------------------------------------------------------------- listening */
  function enter(res) {
    from = res.from || {};
    dropped = res.dropped || null;
    edited = false;
    share.incoming = res;
    share.listening = true;
    paintBanner();
  }
  async function open(hashOrUrl) {
    const res = await openShared(hashOrUrl);
    if (!res.ok) { ui.toast(res.error, { kind: 'bad', ms: 7000 }); return res; }
    if (!share.listening) ls.set(SAVE_KEY, JSON.stringify(store.get()));   // your song, as it is this second
    app.trust?.ownLink?.(res);   // (a link this browser made before its trusted set began opens as yours: main.js)
    share.incoming = res;
    share.listening = true;   // before the load, so autosave skips it
    store.load(res.song, { by: 'you' });
    ui.select({ track: null, clip: null, notes: [], insert: null, range: null });
    enter(res);
    return { ok: true };
  }

  function fork() {
    if (!share.listening) return { ok: false, error: 'not listening to a link' };
    const prev = ls.get(SAVE_KEY);
    if (prev) { ls.set(PREV_KEY, prev); ls.set(BEFORE_FORK_KEY, prev); }
    const before = store.get();
    const f = forkSong(before, { author: (id) => store.author(id) });
    share.listening = false;
    // the same song, now yours: what was decided about its devices stands (kept off stays off, and an open ask stays)
    keepAsk = true;
    if (ask) ask.from = 'song';
    store.load(f, { by: 'you', keepHistory: true });
    const saved = ls.set(SAVE_KEY, JSON.stringify(store.get()));
    clearHash();
    paintBanner();
    const names = namesLine(f.meta.forkedFrom.authors.filter((a) => a.kind !== 'house').length ? f.meta.forkedFrom.authors.filter((a) => a.kind !== 'house') : f.meta.forkedFrom.authors);
    let prevTitle = null;
    try { prevTitle = prev ? JSON.parse(prev).title : null; } catch (e) { /* ok */ }
    ui.toast(`“${f.title}” is yours${saved ? ', saved in this browser' : ''}${prev ? `; “${prevTitle || 'your song'}” stays in the Song menu` : ''}. Every part stays signed by whoever played it (${names}); what you change now is signed by you.`, {
      kind: 'ok', ms: 8000,
      action: prev ? { label: `Back to “${(prevTitle || 'my song').slice(0, 24)}”`, run: () => { store.load(cleanProject(JSON.parse(prev)), { by: 'you' }); ui.toast(`Back to “${prevTitle || 'your song'}”. The link still opens “${f.title}”.`); } } : null,
    });
    ui.emit('share:fork', { title: f.title, forkedFrom: f.meta.forkedFrom });
    return { ok: true, forkedFrom: f.meta.forkedFrom };
  }

  function leave() {
    share.listening = false;
    let p = null;
    try { const s = ls.get(SAVE_KEY); if (s) p = cleanProject(JSON.parse(s)); } catch (e) { p = null; }
    clearHash();
    hideBanner();
    if (p) { store.load(p, { by: 'you' }); ui.toast(`Back to “${p.title}”.`); return { ok: true }; }
    return import('../core/demo.js').then(({ demoProject }) => { store.load(demoProject(), { by: 'you' }); return { ok: true }; });
  }

  function clearHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ok */ } }

  /* ---------------------------------------------------------------- held devices: the ask */
  const heldNow = () => app.devices?.heldDevices?.() || [];
  const listWords = (xs) => (xs.length <= 1 ? xs.slice() : [...xs.slice(0, -1).flatMap((x, i) => (i ? [', ', x] : [x])), ' and ', xs[xs.length - 1]]);
  const named = (d) => h('span.sh-held-name', d.name);
  // who wrote one, in bylines: a guest from a link ("Sam"), one that came through someone else's link ("Sam, via Jo's
  // link"), an agent a link vouched for ("Claude for Sam"); anyone else a file or an old song merely claims, so the
  // ask doesn't repeat it
  const signer = (d) => {
    if (isGuestId(d.by) && isGuestId(d.via) && d.via !== d.by) return { key: `${d.by}|${d.via}`, words: [byline(d.by, { app })], via: [', via ', byline(d.via, { app }), '’s link'] };
    if (isGuestId(d.by)) return { key: d.by, words: [byline(d.by, { app })] };
    if (isAgentId(d.by) && d.via) return { key: `${d.by}|${d.via}`, words: [byline(d.by, { app }), ' for ', byline(d.via, { app })] };
    return null;
  };
  function noun(list) {
    const i = list.filter((d) => d.kind === 'instrument').length, e = list.length - i;
    if (!e) return i === 1 ? 'an instrument' : `${i} instruments`;
    if (!i) return e === 1 ? 'an effect' : `${e} effects`;
    return `${list.length} devices`;
  }
  // what kept off means, now: "They're off now: Tin Whistle is silent and Half Measure lets the sound through untouched."
  // (a listener can press Play before answering, so the ask says what they're hearing without)
  function offNowWords(list) {
    const inst = list.filter((d) => d.kind === 'instrument'), fx = list.filter((d) => d.kind !== 'instrument'), one = list.length === 1;
    if (!fx.length) return [one ? 'It’s off now, so it’s silent.' : 'They’re off now, so they’re silent.'];
    if (!inst.length) return [one ? 'It’s off now, so the sound passes through it untouched.' : 'They’re off now, so the sound passes through them untouched.'];
    if (list.length > 4) return ['They’re off now: the instruments are silent and the effects let the sound through untouched.'];
    return ['They’re off now: ', ...listWords(inst.map(named)), inst.length === 1 ? ' is silent and ' : ' are silent and ', ...listWords(fx.map(named)), fx.length === 1 ? ' lets the sound through untouched.' : ' let the sound through untouched.'];
  }
  // whom Play them asks you to trust: whoever sent the link; for a file, whoever gave it to you; for a song kept here,
  // its one writer when the song names one
  function trustWords(from, signs, one) {
    const sender = share.incoming?.guest;
    if (from === 'link' && isGuestId(sender)) return [byline(sender, { app })];
    if (from === 'file') return ['whoever gave you the file'];
    const keys = new Set(signs.map((s) => (s ? s.key : '')));
    if (keys.size === 1 && signs[0] && !signs[0].via && isGuestId(signs[0].key)) return [byline(signs[0].key, { app })];
    return [one ? 'whoever wrote it' : 'whoever wrote them'];
  }
  // "This song brings 2 devices Sam wrote: Tin Whistle and Half Measure. They're off now: ... Each is a small program
  // that runs on this computer. Play them if you trust Sam: that code then runs from now on, in this browser, in any
  // song." (what it brings, what you hear now, what Play them does, before the click)
  function askWords(list, from) {
    const what = from === 'file' ? 'This file brings ' : 'This song brings ';
    const signs = list.map(signer), one = list.length === 1;
    const keys = new Set(signs.map((s) => (s ? s.key : '')));
    let head;
    if (keys.size === 1 && signs[0]) head = [what, noun(list), ' ', ...signs[0].words, ' wrote', ...(signs[0].via || []), ': ', ...listWords(list.map(named)), '.'];
    else if (signs.every((s) => !s)) head = [what, noun(list), ': ', ...listWords(list.map(named)), '.'];
    else head = [what, noun(list), ': ', ...listWords(list.map((d, i) => h('span', named(d), ...(signs[i] ? [' by ', ...signs[i].words, ...(signs[i].via || [])] : [])))), '.'];
    return [h('span.sh-q-what', ...head), ' ', h('span.sh-q-now', ...offNowWords(list)), ' ',
      h('span.sh-q-code', one ? 'It’s a small program that runs on this computer. Play it if you trust ' : 'Each is a small program that runs on this computer. Play them if you trust ',
        ...trustWords(from, signs, one), ': that code then runs from now on, in this browser, in any song.')];
  }
  function play() {
    const list = heldNow();
    if (!list.length || !app.trust?.play) return { ok: false };
    const r = app.trust.play();
    if (ask) ask.answered = 'play';
    paintBanner();
    const names = r.played.map((d) => d.name);
    ui.toast([...listWords(names), names.length === 1 ? ' is on.' : ' are on.', ' This browser runs that code from now on, in any song.'], { kind: 'ok', ms: 6000 });
    return { ok: true, played: names };
  }
  function keepOff() {
    if (!ask) ask = { from: share.listening ? 'link' : 'song', answered: null };
    ask.answered = 'off';
    paintBanner();
    const n = heldNow().length;
    ui.announce(`Kept off. The track says so, and the Devices tab can play ${n === 1 ? 'it' : 'them'} later.`);
    return { ok: true };
  }
  // the ask's row, or (while listening, once kept off) one line saying what's off (a phone drops it: the banner is one
  // line once the question is answered, and the lanes say "kept off" themselves)
  function heldRow() {
    const list = heldNow();
    if (!list.length || !ask) return null;
    const one = list.length === 1;
    if (!ask.answered) {
      // Play them is the region's one primary while the question is open (Make it yours steps back until it's answered)
      return h('div.sh-held', { role: 'group', 'aria-label': 'Code in this song' },
        h('p.sh-held-text', askWords(list, ask.from)),
        // what the studio's own copy of the community shelf says of this code, by its hash (ui/community.js): never
        // from the song or another shelf, so neither can borrow a shelf author's name
        ...(app.community?.heldLines?.(list) || []).map((t) => h('p.sh-held-text.sh-held-shelf', t)),
        h('div.sh-held-acts',
          h('button.ew-btn.ew-btn-primary.ew-btn-small.sh-play', { onclick: () => play(), title: 'Trust this code in this browser, from now on, and play it' }, one ? 'Play it' : 'Play them'),
          h('button.ew-btn.ew-btn-small.sh-off', { onclick: () => keepOff(), title: 'Leave it off: the song plays without it, and asks again next time' }, one ? 'Keep it off' : 'Keep them off')));
    }
    if (ask.answered === 'off' && share.listening) return h('div.sh-held.sh-held-off', h('p.sh-held-text', 'Kept off: ', ...listWords(list.map(named)), `. The Devices tab can play ${one ? 'it' : 'them'}.`));
    return null;
  }
  const asking = () => !!ask && !ask.answered && heldNow().length > 0;

  /* ---------------------------------------------------------------- the banner */
  function hideBanner() {
    if (!banner) return;
    banner.remove(); banner = null;
    root?.classList.remove('sh-listening', 'sh-asking');
    root?.style.removeProperty('--sh-h');
    ui.emit('resize');
  }
  // The key beside "Listening to …": plays the song from the marker, as Space does, and stops it (its glyph follows the
  // transport)
  const playing = () => !!(app.engine?.playing || app.engine?.starting);
  let playKey = null;
  async function playStop() {
    const en = app.engine;
    if (!en) return { playing: false };
    try {
      if (!playing()) await en.start?.();
      if (app.transport?.playStop) await app.transport.playStop();
      else if (playing()) en.stop(); else await en.play(app.transport?.marker?.beat || 0);
    } catch (e) { ui.toast('Could not play: ' + e.message, { kind: 'bad' }); }
    syncPlayKey();
    return { playing: playing() };
  }
  function syncPlayKey() {
    if (!playKey) return;
    const on = playing(), title = store.get().title || 'Untitled';
    if (playKey._on === on && playKey.firstChild) return;
    playKey._on = on;
    playKey.replaceChildren(icon(on ? 'stop' : 'play', { size: 12 }));
    playKey.setAttribute('aria-label', on ? `Stop “${title}”` : `Play “${title}”`);
    playKey.title = on ? 'Stop' : 'Play it from the marker (Space)';
  }
  app.engine?.on?.('transport', () => syncPlayKey());

  // One strip under the top bar: while listening to a link, whose song it is and Make it yours, then (if the song brings
  // code this browser hasn't allowed) the ask under a hairline; for any other song, the ask alone. While the question
  // is open, Play them is the strip's one primary; once it's answered, Make it yours is. On a phone the strip is the
  // question alone while it's open, then the listening part in one line (the play key, the title, Make it yours, Back),
  // so the lanes stay in view.
  function paintBanner() {
    const held = heldRow();
    if (!share.listening && !held) return hideBanner();
    const fresh = !banner;
    if (fresh) {
      banner = h('div.sh-banner');
      const top = root?.querySelector(':scope > .ew-top');
      if (top) top.after(banner); else root?.prepend(banner);
    }
    const before = fresh ? -1 : banner.offsetHeight;
    const parts = [];
    const q = asking();
    if (share.listening) {
      const p = store.get();
      // in proportion: who wrote how much of the notes, the house included (a demo the house mostly wrote says so)
      const shown = creditsOf(p, (id) => store.author(id));
      const who = [];
      shown.slice(0, 4).forEach((a, i) => {
        if (i) who.push(i === Math.min(shown.length, 4) - 1 ? ' and ' : ', ');
        who.push(h(`span.sh-who.k-${a.kind}`, { title: a.kind === 'agent' ? 'an agent' : a.kind === 'human' ? 'a person' : 'the house: Overdub’s demo songs and tools' }, a.name));
        if (a.share != null) who.push(` ${a.share || '<1'}%`);
      });
      if (shown.length > 4) who.push(` and ${shown.length - 4} more`);
      const n = dropped?.audioClips || 0;
      const fine = edited ? 'Not saved: make it yours to keep your changes.' : n ? `${n} audio clip${n === 1 ? '' : 's'} stayed with the sender: links carry notes, devices and the mix, not recordings.` : 'Nothing here is saved until you make it yours. Your own song is untouched; if you do, it stays in the Song menu.';
      playKey = h('button.sh-b-play', { type: 'button', onclick: () => playStop() });
      syncPlayKey();
      parts.push(h('div.sh-b-main',
        playKey,
        h('div.sh-b-text', h('span.sh-b-line', 'Listening to ', h('b.sh-title', p.title || 'Untitled'), who.length ? [' — by ', ...who] : null), h('small.sh-b-fine' + (edited ? '.warn' : ''), fine)),
        h('div.sh-b-acts',
          h('button.ew-btn.ew-btn-small.sh-fork' + (q ? '' : '.ew-btn-primary'), { onclick: () => fork(), title: 'Keep this song in your studio, every part still signed by whoever played it' }, icon('check', { size: 13 }), 'Make it yours'),
          h('button.ew-btn.ew-btn-small.sh-leave', { onclick: () => leave(), title: 'Close this song and go back to yours', 'aria-label': 'Back to my song' }, h('span.sh-long', 'Back to my song'), h('span.sh-short', 'Back')))));
    }
    if (held) parts.push(held);
    banner.className = 'sh-banner' + (share.listening ? '' : ' sh-ask') + (q ? ' sh-q' : '') + (share.listening && edited ? ' edited' : '');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', share.listening ? 'A shared song' : 'Devices in this song');
    root?.classList.toggle('sh-listening', !!share.listening);
    root?.classList.toggle('sh-asking', !share.listening);
    banner.replaceChildren(...parts);
    // (a screen reader hears the ask once, as it appears)
    if (held && ask && !ask.answered && !ask.said) { ask.said = true; ui.announce(held.querySelector('.sh-held-text')?.textContent || ''); }
    const now = banner.offsetHeight;
    root?.style.setProperty('--sh-h', now + 'px');   // (a phone's welcome card sits under it: app.css)
    if (fresh || now !== before) ui.emit('resize');
  }

  window.addEventListener('hashchange', () => { if (/[#&]s=/.test(location.hash)) open(location.hash); });
  window.addEventListener('beforeunload', (e) => { if (share.listening && edited) { e.preventDefault(); e.returnValue = ''; } });

  Object.assign(share, { link, copy, open, fork, leave, sheet, play, keepOff, playStop });
  Object.defineProperty(share, 'edited', { get: () => edited, configurable: true });
  Object.defineProperty(share, 'asking', { get: () => (ask && heldNow().length ? { from: ask.from, answered: ask.answered === 'off' ? 'off' : null, held: heldNow() } : null), configurable: true });

  // the song the studio opened with asks about its held devices too (a link's, the saved song's)
  ask = heldNow().length ? { from: share.incoming?.ok ? 'link' : 'song', answered: null } : null;
  if (share.incoming) {
    if (share.incoming.ok) enter(share.incoming);
    else { share.listening = false; ui.toast(share.incoming.error, { kind: 'bad', ms: 8000 }); clearHash(); }
  }
  if (!share.listening) paintBanner();

  /* ---------------------------------------------------------------- the agent's tool */
  app.tools?.register?.({
    ...SHARE_SCHEMA,   // name, description, input_schema (agent/extra-schemas.js: Node lists it with no tab open)
    async run(input = {}) {
      const r = await link({ name: input.name || share.name });
      if (!r.ok) return { error: r.error, size: kb(r.chars), limit: kb(MAX_CHARS), hint: 'save the project file instead (the Song menu)' };
      return { url: r.url, size: kb(r.chars), limit: kb(MAX_CHARS), dropped: r.dropped, note: [r.dropped.audioClips ? `${r.dropped.audioClips} audio clip(s) are not in the link` : '', r.dropped.reference ? 'the reference track stays in this browser' : ''].filter(Boolean).join('; ') || 'everything in the song is in the link' };
    },
  });
}

const CSS = `
.ew-shell.sh-listening, .ew-shell.sh-asking { grid-template-rows: 52px auto 1fr; }
.sh-banner { display: grid; background: var(--bg-2); border-bottom: 1px solid var(--line); min-width: 0; animation: ew-in .2s var(--ease, ease) both; }
.sh-b-main { display: flex; align-items: center; gap: 10px; padding: 7px 12px; min-width: 0; }
/* the ask: a sentence and two words to press, under a hairline (no box of its own) */
.sh-held { display: flex; align-items: center; gap: 14px; padding: 7px 12px 8px 44px; min-width: 0; }
.sh-b-main + .sh-held { border-top: var(--rule); }
.sh-ask .sh-held { padding-left: 12px; }
.sh-held-text { margin: 0; flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.sh-held-text .by { font-size: inherit; }
.sh-held-name { color: var(--text); font-weight: 600; }
.sh-held-acts { display: flex; gap: 6px; flex: none; }
.sh-held-off { padding-top: 4px; padding-bottom: 6px; }
.sh-held-off .sh-held-text { font-size: 11px; color: var(--text-3); }
.sh-held-off .sh-held-name { color: var(--text-2); font-weight: 400; }
/* the play key: a transport glyph on a pressed key (2 px corners, a rule edge), like the top bar's */
.sh-b-play { display: inline-grid; place-items: center; width: 24px; height: 24px; flex: none; padding: 0; border: var(--rule-2); border-radius: var(--r-press); background: none; color: var(--text-2); cursor: pointer; }
.sh-b-play:hover { color: var(--text); border-color: var(--text-3); }
.sh-b-play:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.sh-short { display: none; }
.sh-b-text { display: grid; gap: 1px; min-width: 0; flex: 1; }
.sh-b-line { font-size: 13px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sh-title { color: var(--text); font-family: var(--font-display); font-variation-settings: var(--font-display-vars, normal); font-weight: 800; }
.sh-who { font-weight: 700; } .sh-who.k-human { color: var(--human); } .sh-who.k-agent { color: var(--agent); } .sh-who.k-house { color: var(--text-2); }
.sh-b-fine { font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sh-b-fine.warn { color: var(--warn); }
.sh-b-acts { display: flex; gap: 6px; flex: none; }
.sh-banner.edited .sh-fork { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-2) 45%, transparent); }
/* a phone's top bar takes two rows (its height is its own): the banner goes under both, and the welcome card under the
   banner (--sh-h, set as it paints) */
@media (max-width: 900px) { .ew-shell.sh-listening, .ew-shell.sh-asking { grid-template-rows: auto auto minmax(0, 1fr); } .ew-shell .sh-b-play { width: 40px; height: 40px; } }
/* a phone: while the question is open the strip is the question alone (the top bar names the song, the ask names who
   sent it); answered, the listening part is one line (the play key, the title cut short, Make it yours, Back), the
   small print goes (but "Not saved"), and so does the kept-off line: the lanes say "kept off" themselves. The lanes
   stay in view either way. */
@media (max-width: 700px) {
  .sh-q .sh-b-main { display: none; }
  .sh-b-main { flex-wrap: nowrap; gap: 8px; padding: 4px 8px 4px 10px; }
  .sh-b-text { flex: 1 1 auto; }
  .sh-b-fine { display: none; }
  .sh-banner.edited .sh-b-fine { display: block; white-space: normal; }
  .sh-long { display: none; } .sh-short { display: inline; }
  .sh-b-acts { gap: 6px; } .ew-shell .sh-b-acts .ew-btn { padding: 0 10px; }
  .sh-b-acts .ico { display: none; }
  .sh-held-off { display: none; }
  .sh-held, .sh-ask .sh-held { flex-wrap: wrap; gap: 6px; padding: 5px 10px 7px; }
  .sh-held-text { flex-basis: 100%; font-size: 12px; line-height: 1.4; }
  .sh-held-acts { width: 100%; } .sh-held-acts .ew-btn { flex: 1; justify-content: center; }
}
.sh-sheet { display: grid; gap: 8px; width: 340px; max-width: 100%; padding: 6px 6px 4px; }
.sh-h { display: grid; gap: 1px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.sh-h b { font-family: var(--font-display); font-variation-settings: var(--font-display-vars, normal); font-size: 16px; }
.sh-h small, .sh-status, .sh-note { font-size: 11px; color: var(--text-3); line-height: 1.45; }
.sh-row { display: flex; gap: 6px; align-items: center; }
.sh-url, .sh-name { flex: 1; min-width: 0; height: 26px; padding: 0 8px; border-radius: var(--r-1); border: 1px solid var(--line-2); background: var(--bg); color: var(--text-2); font: 11px var(--font-mono); }
.sh-name { font-family: var(--font-ui); font-size: 12px; color: var(--text); }
.sh-url:focus, .sh-name:focus { outline: 2px solid var(--accent-2); outline-offset: 0; }
.sh-sign { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--text-2); }
.sh-sign span { flex: none; }
.sh-native { justify-self: start; }
`;
