// The Song menu (the right end of the top bar): new, open, save, and every way out of Overdub. A mix as a 24-bit WAV,
// stems (one WAV per track, in a zip), MIDI (a Standard MIDI File, type 1), the project file (.overdub.json), and
// the attribution log: who did what, when, and why (the provenance record). Nothing is lost: replacing the song (New
// song, a demo, a file) asks first in the menu, keeps the old one in Recent songs (the menu's own list, the newest six,
// localStorage overdub:recent; a song opened from it leaves it, and a demo as the shelf has it gives up its place first),
// and the toast can put it back. A take still recording goes into the song before it is replaced.
//
//   encodeWav(buffer | { sampleRate, channels: Float32Array[] }, { bits: 16 | 24 }) -> Uint8Array
//   encodeMidi(project, { ppq = 480 }) -> Uint8Array        (Standard MIDI File, format 1)
//   zipStore([{ name, data: Uint8Array | string }]) -> Uint8Array   (a plain zip, stored)
//   provenance(app) -> the attribution log (an object)
//
// app.exporter = { encodeWav, encodeMidi, zipStore, provenance, newSong(), openDemo(), openFile(), loadText(text, name),
//                  saveProject(), exportMix(), exportStems(), exportMidi(), exportLog(), exportDawproject(), openReport(), busy,
//                  recent() -> [{ id, title, at, tracks }], openRecent(i), putAside(song, msg) (a song main.js replaced on the way in),
//                  openMenu(anchor?) (the menu, under anchor: More's Song row on a phone) }
// The simple view (ui/workspace.js) puts the file rows away (data-feature="files": open a file, the imports, stems, MIDI,
// DAWproject and the reports) and keeps New song, the demos, Save, Share a link, Export mix and Take one; on a phone the
// Song key itself is More's first row, not the top bar's.
// The printable provenance report is ui/provenance.js; the DAWproject writer is core/dawproject.js.

import { h, css, icon, byline } from './dom.js';
import { authorKind, authorName, popover, closePopovers } from './rack.js';
import { menuKeys } from './arrange-kit.js';
import { isProjectFormat, stableIds, cleanProject } from '../core/project.js';
import { guardDevices } from '../core/share.js';
import { DEMOS, demoById } from '../core/demo.js';
import { dawprojectFiles } from '../core/dawproject.js';
import { installProvenance, openProvenanceReport } from './provenance.js';

/* ================================================================ WAV */
export function encodeWav(buf, { bits = 24 } = {}) {
  const chans = buf.channels || Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const sr = buf.sampleRate, nch = chans.length, len = chans[0]?.length || 0;
  const bps = bits / 8, block = nch * bps, dataLen = len * block;
  const out = new Uint8Array(44 + dataLen);
  const dv = new DataView(out.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * block, true); dv.setUint16(32, block, true); dv.setUint16(34, bits, true);
  str(36, 'data'); dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      let x = chans[c][i];
      x = x > 1 ? 1 : x < -1 ? -1 : x || 0;
      if (bits === 16) { dv.setInt16(o, Math.round(x < 0 ? x * 32768 : x * 32767), true); o += 2; }
      else {
        let v = Math.round(x < 0 ? x * 8388608 : x * 8388607);
        if (v < 0) v += 0x1000000;
        out[o] = v & 255; out[o + 1] = (v >> 8) & 255; out[o + 2] = (v >> 16) & 255; o += 3;
      }
    }
  }
  return out;
}

/* ================================================================ MIDI (SMF type 1) */
const FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
const PCS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function vlq(n) { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; }
const txt = (s) => [...new TextEncoder().encode(String(s || ''))];
function chunk(type, bytes) { return [...txt(type), (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255, ...bytes]; }
function meta(type, data) { return [0xff, type, ...vlq(data.length), ...data]; }

export function encodeMidi(p, { ppq = 480, isDrums = null } = {}) {
  const tempo = Math.round(60000000 / (+p.tempo || 120));
  const [num, den] = Array.isArray(p.meter) ? p.meter : [4, 4];
  // the tempo track: name, tempo, time signature, key signature, section markers
  const evs = [[0, meta(0x03, txt(p.title || 'Untitled'))], [0, meta(0x51, [(tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255])], [0, meta(0x58, [num, Math.round(Math.log2(den)), 24, 8])]];
  if (p.key && (p.key.scale === 'major' || p.key.scale === 'minor') && p.key.root in PCS) {
    const minor = p.key.scale === 'minor';
    let sf = FIFTHS[(PCS[p.key.root] + (minor ? 3 : 0)) % 12];
    if (sf === 6 && /b/.test(p.key.root)) sf = -6;
    evs.push([0, meta(0x59, [sf & 255, minor ? 1 : 0])]);
  }
  for (const sec of p.sections || []) evs.push([Math.round(sec.start * ppq), meta(0x06, txt(sec.name))]);
  evs.sort((a, b) => a[0] - b[0]);
  const t0 = [];
  let at0 = 0;
  for (const [at, bytes] of evs) { t0.push(...vlq(at - at0), ...bytes); at0 = at; }
  t0.push(0, ...meta(0x2f, []));
  const tracks = [chunk('MTrk', t0)];
  let ch = 0;
  for (const t of p.tracks || []) {
    const clips = (t.clips || []).filter((c) => c.kind === 'notes' && c.notes?.length);
    if (t.kind !== 'instrument' || !clips.length) continue;
    const drums = isDrums ? isDrums(t) : /drum/i.test(t.instrument?.device || '');
    const chan = drums ? 9 : ch;
    if (!drums) { ch++; if (ch === 9) ch++; if (ch > 15) ch = 0; }
    const evs = [];
    for (const c of clips) {
      for (const n of c.notes) {
        if (!(n.t < c.length) || !(n.d > 0)) continue;
        const on = Math.round((c.start + n.t) * ppq);
        const off = Math.max(on + 1, Math.round((c.start + Math.min(n.t + n.d, c.length)) * ppq));
        const p2 = Math.max(0, Math.min(127, Math.round(n.p)));
        const v = Math.max(1, Math.min(127, Math.round((n.v ?? 0.8) * 127)));
        evs.push([on, 1, p2, v], [off, 0, p2, 64]);
      }
    }
    evs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const bytes = [0, ...meta(0x03, txt(t.name))];
    let last = 0;
    for (const [at, kind, pitch, vel] of evs) { bytes.push(...vlq(at - last), (kind ? 0x90 : 0x80) | chan, pitch, vel); last = at; }
    bytes.push(0, ...meta(0x2f, []));
    tracks.push(chunk('MTrk', bytes));
  }
  const hdr = chunk('MThd', [0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (ppq >> 8) & 255, ppq & 255]);
  return new Uint8Array([...hdr, ...tracks.flat()]);
}

/* ================================================================ zip (stored) */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(files) {
  const enc = new TextEncoder();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of all) { out.set(x, o); o += x.length; }
  return out;
}

/* ================================================================ provenance */
export function provenance(app) {
  const { store } = app;
  const p = store.get();
  const byAuthor = {}, byKind = { human: 0, agent: 0, house: 0 };
  const clipsBy = {}, tracksBy = {}, fxBy = {};
  for (const t of p.tracks) {
    tracksBy[t.by] = (tracksBy[t.by] || 0) + 1;
    for (const fx of t.inserts) fxBy[fx.by] = (fxBy[fx.by] || 0) + 1;
    for (const c of t.clips) {
      clipsBy[c.by] = (clipsBy[c.by] || 0) + 1;
      for (const n of c.notes || []) { byAuthor[n.by] = (byAuthor[n.by] || 0) + 1; byKind[authorKind(app, n.by)]++; }
    }
  }
  for (const fx of p.master.inserts) fxBy[fx.by] = (fxBy[fx.by] || 0) + 1;
  const txBy = {};
  for (const t of store.history) txBy[t.by] = (txBy[t.by] || 0) + 1;
  const ids = new Set([...Object.keys(byAuthor), ...Object.keys(clipsBy), ...Object.keys(tracksBy), ...Object.keys(fxBy), ...Object.keys(txBy), ...Object.keys(p.meta?.authors || {}), ...Object.values(p.devices || {}).map((d) => d.by)]);
  const authors = {};
  for (const id of ids) if (id && id !== 'undefined') { const a = store.author(id); authors[id] = { kind: a.kind, name: a.name }; }
  const total = Object.values(byKind).reduce((a, b) => a + b, 0) || 1;
  return {
    format: 'overdub-provenance/0',
    about: 'Who made what in this song, and when. Every note, clip, track, effect and device carries its author; the history is every change made in this session, in order, with its author and reason. Evidence of human and agent contributions, not legal advice.',
    exported: new Date().toISOString(),
    song: { id: p.id, title: p.title, tempo: p.tempo, meter: p.meter, key: p.key, created: p.meta?.created, modified: p.meta?.modified, ...(p.meta?.forkedFrom ? { forkedFrom: p.meta.forkedFrom } : {}) },
    ...(p.meta?.forkedFrom ? { origin: `Forked from “${p.meta.forkedFrom.title}” (${(p.meta.forkedFrom.authors || []).map((a) => `${a.name}, ${a.kind}`).join('; ') || 'no authors named'}) on ${p.meta.forkedFrom.at}. Parts from the original keep their authors; the history below starts at the fork.` } : {}),
    authors,
    summary: {
      notes: { total: Object.values(byAuthor).reduce((a, b) => a + b, 0), byAuthor, byKind, share: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, Math.round((v / total) * 1000) / 10])) },
      clips: clipsBy, tracks: tracksBy, effects: fxBy,
      // held: the song brought it and this browser hasn't let its code run (main.js), so nothing here checked or played it
      devicesWritten: Object.values(p.devices || {}).map((d) => ({ id: d.id, name: d.name, kind: d.kind, by: d.by, version: d.version || 1, created: d.created, modified: d.modified, ...(app.devices?.heldDevice?.(d.id) ? { held: true } : {}) })),
      changes: txBy,
    },
    history: store.history.map((t) => ({ id: t.id, at: new Date(t.at).toISOString(), by: t.by, author: authors[t.by] || store.author(t.by), label: t.label, ops: t.ops })),
  };
}

/* ================================================================ the menu */
const safeName = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export default function (app) {
  const { store, ui } = app;
  css('ew-export', EXPORT_CSS);
  installProvenance(app);
  let busy = null; // { label, done, total }
  let btn = null, prog = null;
  const PREV = 'overdub:previous', SAVED = 'overdub:project', BEFORE_FORK = 'overdub:before-fork', RECENT = 'overdub:recent';
  const RECENT_MAX = 6, RECENT_BYTES = 1500000;

  // Recent songs: every song the studio replaced, newest first, so it is one click away in the Song menu. The same song
  // saved again replaces its older copy; the one on screen isn't listed, and one opened from the list leaves it (it
  // comes back, as it is then, when something replaces it). When the list is full, a demo as the shelf has it (it can
  // always be opened again) or an empty untitled song goes before any song of yours, and the toast names a song of
  // yours that falls off the end.
  const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(v) ? v.filter((e) => e && e.song && Array.isArray(e.song.tracks)) : []; } catch { return []; } };
  const stamp = (song) => `${song.id || ''}|${song.meta?.modified || ''}|${song.title || ''}`;
  const writeRecent = (list) => {
    // too big for storage: the oldest go first
    while (list.length) {
      const text = JSON.stringify(list);
      if (text.length <= RECENT_BYTES || list.length === 1) { try { localStorage.setItem(RECENT, text); return list; } catch { if (list.length === 1) return []; } }
      list.pop();
    }
    try { localStorage.setItem(RECENT, '[]'); } catch { /* storage blocked */ }
    return list;
  };
  // a song the studio can make again exactly: a demo untouched since the shelf made it, or a blank untitled one
  let demoIds = null;
  const sameBody = (a, b) => JSON.stringify(a, (k, v) => (k === 'meta' || k === 'created' || k === 'modified' ? undefined : v)) === JSON.stringify(b, (k, v) => (k === 'meta' || k === 'created' || k === 'modified' ? undefined : v));
  // (untitled with nothing in it: no track, or only empty ones, as Make your own leaves it before a take)
  const blank = (song) => (!song.title || song.title === 'Untitled') && song.tracks.every((t) => !(t.clips || []).length);
  function spare(song) {
    if (blank(song)) return true;
    if (!demoIds) demoIds = new Map(DEMOS.map((d) => [stableIds({ tracks: [] }, d.id).id, d.id]));
    const d = demoIds.get(song.id);
    if (!d) return false;
    try { return sameBody(cleanProject(demoById(d)), song); } catch { return false; }
  }
  // -> the titles of songs of yours that fell off the end to make room
  function addRecent(song) {
    if (!song || !Array.isArray(song.tracks)) return [];
    const list = [{ id: song.id, title: song.title || 'Untitled', at: Date.now(), tracks: song.tracks.length, ...(spare(song) ? { spare: true } : {}), song }, ...readRecent().filter((e) => stamp(e.song) !== stamp(song))];
    const lost = [];
    while (list.length > RECENT_MAX) {
      let k = -1;
      for (let i = list.length - 1; i > 0 && k < 0; i--) if (list[i].spare) k = i;
      if (k < 0) { k = list.length - 1; lost.push(list[k].title); }
      list.splice(k, 1);
    }
    const kept = writeRecent(list);
    for (const e of list.slice(kept.length)) if (!e.spare) lost.push(e.title);
    return lost;
  }
  // the entry for a song that is on screen again: it leaves the list
  function dropRecent(song) {
    const list = readRecent(), keep = list.filter((e) => stamp(e.song) !== stamp(song));
    if (keep.length !== list.length) writeRecent(keep);
  }
  const recent = () => { const cur = stamp(store.get()); return readRecent().filter((e) => stamp(e.song) !== cur); };
  function openRecent(i) {
    const e = recent()[i];
    if (!e) return false;
    replaceSong(e.song, `Back to “${e.title}”. “${store.get().title}” is in Recent songs, and Undo brings it back.`, { from: e.song });
    return true;
  }

  const setBusy = (b) => {
    busy = b;
    if (!btn) return;
    btn.classList.toggle('busy', !!b);
    btn.disabled = false;
    prog.textContent = b ? `${b.label}${b.total > 1 ? ` ${b.done}/${b.total}` : ''}…` : '';
  };

  // -> { prev, lost }: the song on screen (to put back), and the titles of songs of yours Recent had to let go
  function keepPrevious() {
    const prev = JSON.parse(JSON.stringify(store.get()));
    let keep = JSON.stringify(prev), lost = [];
    // while listening to a link the song on screen is theirs; yours is the saved one (ui/share.js), so keep that
    if (app.share?.listening) { try { keep = localStorage.getItem(SAVED) || keep; } catch { /* storage blocked */ } }
    try { lost = addRecent(JSON.parse(keep)); } catch { /* not a song */ }
    try {
      localStorage.setItem(PREV, keep);
      // the song from before Make it yours is now in PREV too, and newer: the Song menu's way back to it can go
      const bf = localStorage.getItem(BEFORE_FORK);
      if (bf && JSON.parse(bf).id === JSON.parse(keep).id) localStorage.removeItem(BEFORE_FORK);
    } catch { /* too big for storage: kept in memory */ }
    return { prev, lost };
  }
  // the song Make it yours put aside (ui/share.js): the Song menu offers it back while it isn't the song on screen
  function beforeFork() {
    try { const q = JSON.parse(localStorage.getItem(BEFORE_FORK) || 'null'); return q && Array.isArray(q.tracks) && q.id !== store.get().id ? q : null; } catch { return null; }
  }
  // from: the Recent songs entry being opened (it leaves the list: it's on screen). A take still recording goes into the
  // song first, so the copy in Recent songs and Undo have it (a count-in, with nothing recorded yet, is called off).
  function replaceSong(next, msg, { from = null } = {}) {
    const rec = app.input?.recorder;
    if (rec && rec.state === 'rec') return Promise.resolve(rec.stop({ why: 'stop' })).catch(() => null).then(() => replaceSong(next, msg, { from }));
    if (rec && rec.state === 'count') { try { rec.cancel(); } catch { /* ok */ } }
    // the entry being opened leaves the list first: a full list then has its place for the song on screen, and nothing
    // of yours falls off to make room for a song that is leaving it anyway
    if (from) dropRecent(from);
    const { prev, lost } = keepPrevious();
    // another song starts from the top, stopped: not at wherever the last one's playhead was left
    try { if (app.engine?.playing) app.engine.stop(); app.engine?.seek?.(0); } catch { /* no audio yet */ }
    store.load(next, { by: 'you' });
    // the old song's toasts with an Undo go with it (the take just put in, a delete): their Undo would land on this one
    try { for (const t of document.querySelectorAll('.ew-toast')) if (t.querySelector('.ew-toast-act')) t.remove(); } catch { /* no DOM */ }
    ui.select({ track: null, clip: null, notes: [], insert: null, range: null });
    undoToast(prev, msg, lost);
    return Promise.resolve(true);
  }
  const offList = (lost) => (lost.length ? ` ${lost.map((t) => `“${t}”`).join(' and ')} ${lost.length > 1 ? 'were' : 'was'} the oldest in Recent songs and ${lost.length > 1 ? 'are' : 'is'} off the list now.` : '');
  // The toast after a song is replaced. Undo: the song that was replaced comes back (and leaves the list first); the one
  // it replaced goes to Recent songs unless there's nothing in it, and the toast names a song of yours that falls off
  function undoToast(prev, msg, lost = []) {
    ui.toast(msg + offList(lost), { kind: 'ok', ms: 7000, action: { label: 'Undo', run: () => {
      const cur = JSON.parse(JSON.stringify(store.get()));
      dropRecent(prev);
      const gone = blank(cur) ? [] : addRecent(cur);
      store.load(prev, { by: 'you' });
      ui.toast(`Back to “${prev.title || 'Untitled'}”.${offList(gone)}`);
    } } });
  }
  // A song the studio replaced on the way in (a landing page's ?demo= or ?new link, main.js): it goes to Recent songs
  // like any other, and the toast's Undo brings it back. -> the titles of songs of yours that fell off
  function putAside(prev, msg) {
    if (!prev || !Array.isArray(prev.tracks)) return [];
    const lost = addRecent(prev);
    undoToast(JSON.parse(JSON.stringify(prev)), msg, lost);
    return lost;
  }
  async function newSong() {
    const { createProject } = await import('../core/project.js');
    await replaceSong(createProject(), `New song. “${store.get().title}” is in Recent songs, and Undo brings it back.`);
  }
  // openDemo(id?): a song from the demo shelf (core/demos/); no id is Night Shift
  async function openDemo(id) {
    const d = DEMOS.find((x) => x.id === id) || DEMOS[0];
    await replaceSong(demoById(d.id), `Opened the demo, “${d.title}”. “${store.get().title}” is in Recent songs, and Undo brings it back.`);
  }
  function loadText(text, name = 'the file') {
    let p;
    try { p = JSON.parse(text); } catch { ui.toast(`${name} isn’t a project file (not JSON)`, { kind: 'bad' }); return false; }
    if (p && p.format === 'overdub-device/0' && app.devicesIO) { app.devicesIO.importText(text, name); return true; }
    if (p && p.format === 'overdub-provenance/0') { ui.toast('That’s an attribution log, not a song. Open the .overdub.json project file.', { kind: 'bad' }); return false; }
    if (!p || typeof p !== 'object' || !Array.isArray(p.tracks) || (p.format && !isProjectFormat(p.format))) { ui.toast(`${name} isn’t an Overdub project`, { kind: 'bad' }); return false; }
    // a song file's devices are code from whoever wrote the file: they can't take over a built-in's or the shelf's id,
    // and the ones this browser hasn't trusted are held until the person says (main.js; the ask is ui/share.js's)
    const { renamed } = guardDevices(p, { prefix: 'you' });
    const moved = Object.entries(renamed).map(([a, b]) => `${a} is ${b}`);
    replaceSong(p, `Opened “${p.title || name}”.${moved.length ? ` Its own ${moved.length === 1 ? 'device uses an id' : 'devices use ids'} the studio ships, so here ${moved.join(', ')}.` : ''}`)
      .then(() => ui.emit('song:opened', { from: 'file', name }));
    return true;
  }
  function openFile() {
    const inp = h('input', { type: 'file', accept: '.json,.overdub.json,application/json', style: { display: 'none' } });
    inp.addEventListener('change', async () => { const f = inp.files?.[0]; inp.remove(); if (f) loadText(await f.text(), f.name); });
    document.body.append(inp);
    inp.click();
  }
  function saveProject() {
    const p = store.get();
    download(`${safeName(p.title)}.overdub.json`, JSON.stringify(p, null, 2), 'application/json');
    const n = Object.keys(p.assets || {}).length;
    ui.toast(`Saved ${safeName(p.title)}.overdub.json${n ? ` (its ${n} recording${n > 1 ? 's stay' : ' stays'} in this browser)` : ''}`, { kind: 'ok' });
  }
  async function render(opts) {
    if (app.engine.silent) throw new Error('the audio engine isn’t loaded yet');
    return app.engine.render({ sr: 48000, tail: 2, ...opts });
  }
  // the song's devices kept off on this computer (main.js holds them: their code hasn't been allowed here): a render
  // has a held instrument silent and a held effect bypassed, and the export says what it left out
  function leftOut(trackIds = null) {
    const held = (app.devices?.heldDevices?.() || []).filter((d) => (d.uses || []).some((u) => !trackIds || trackIds.includes(u.trackId) || u.trackId === 'master'));
    if (!held.length) return '';
    const names = held.map((d) => d.name);
    return ` Left out: ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}, kept off on this computer.`;
  }
  async function exportMix() {
    if (busy) return ui.toast('Already exporting…');
    const p = store.get();
    setBusy({ label: 'Rendering the mix', done: 0, total: 1 });
    try {
      const buf = await render({});
      const wav = encodeWav(buf, { bits: 24 });
      download(`${safeName(p.title)}.wav`, wav, 'audio/wav');
      const out = leftOut();
      ui.toast(`Exported ${safeName(p.title)}.wav · 24-bit, ${buf.sampleRate / 1000} kHz, ${dur(buf.duration)}${out ? `.${out}` : ''}`, { kind: out ? 'info' : 'ok', ms: out ? 7000 : 3200 });
      return wav;
    } catch (e) { console.error(e); ui.toast('Could not export the mix: ' + e.message, { kind: 'bad' }); return null; } finally { setBusy(null); }
  }
  async function exportStems() {
    if (busy) return ui.toast('Already exporting…');
    const p = store.get();
    const tracks = p.tracks.filter((t) => t.clips.length);
    if (!tracks.length) return ui.toast('There’s nothing to export yet: no clips on any track');
    const files = [];
    try {
      // every stem is held back to the latest track of the whole set (and the mix), as it is in the mix: lined up at
      // zero in another DAW, the stems land on the same samples and sum to the mix
      setBusy({ label: 'Rendering stems', done: 0, total: tracks.length });
      const align = app.engine.probeLatency && !app.engine.silent ? await app.engine.probeLatency({ tracks: tracks.map((t) => t.id), withMix: true, sr: 48000 }) : null;
      for (let i = 0; i < tracks.length; i++) {
        setBusy({ label: 'Rendering stems', done: i + 1, total: tracks.length });
        const buf = await render({ tracks: [tracks[i].id], latencyMax: align ? align.max : 0 });
        files.push({ name: `${String(i + 1).padStart(2, '0')} ${safeName(tracks[i].name)}.wav`, data: encodeWav(buf, { bits: 24 }) });
      }
      const zip = zipStore(files);
      download(`${safeName(p.title)} stems.zip`, zip, 'application/zip');
      const out = leftOut(tracks.map((t) => t.id));
      ui.toast(`Exported ${files.length} stems (24-bit WAV) in “${safeName(p.title)} stems.zip”${out ? `.${out}` : ''}`, { kind: out ? 'info' : 'ok', ms: out ? 7000 : 3200 });
      return zip;
    } catch (e) { console.error(e); ui.toast('Could not export the stems: ' + e.message, { kind: 'bad' }); return null; } finally { setBusy(null); }
  }
  function exportMidi() {
    const p = store.get();
    const isDrums = (t) => app.devices.getDevice(t.instrument?.device)?.cat === 'drums' || /drum/i.test(t.instrument?.device || '');
    const mid = encodeMidi(p, { isDrums });
    const n = p.tracks.filter((t) => t.clips.some((c) => c.notes?.length)).length;
    download(`${safeName(p.title)}.mid`, mid, 'audio/midi');
    ui.toast(`Exported ${safeName(p.title)}.mid · ${n} track${n === 1 ? '' : 's'}, ${p.tempo} bpm`, { kind: 'ok' });
    return mid;
  }
  function exportLog() {
    const p = store.get();
    const log = provenance(app);
    download(`${safeName(p.title)} attribution.json`, JSON.stringify(log, null, 2), 'application/json');
    ui.toast(`Exported the attribution log · ${log.history.length} change${log.history.length === 1 ? '' : 's'} by ${Object.keys(log.summary.changes).length || 0} author${Object.keys(log.summary.changes).length === 1 ? '' : 's'}`, { kind: 'ok' });
    return log;
  }

  // DAWproject (.dawproject): the song for another DAW, its recordings embedded; Overdub's devices go as named placeholders
  async function exportDawproject() {
    if (busy) return ui.toast('Already exporting…');
    const p = store.get();
    const ids = [...new Set(p.tracks.flatMap((t) => t.clips.filter((c) => c.kind === 'audio' && c.asset).map((c) => c.asset)))];
    const audio = {};
    try {
      for (let i = 0; i < ids.length; i++) {
        setBusy({ label: 'Packing recordings', done: i + 1, total: ids.length });
        try { const buf = await app.engine.assets?.get(ids[i]); if (buf) audio[ids[i]] = encodeWav(buf, { bits: 24 }); } catch (e) { console.warn('dawproject asset', ids[i], e); }
      }
      const { files, warnings, counts } = dawprojectFiles(p, { getDevice: (id) => app.devices.getDevice(id), audio, app: { name: 'Overdub', version: app.version } });
      const zip = zipStore(files);
      download(`${safeName(p.title)}.dawproject`, zip, 'application/zip');
      ui.toast(`Exported ${safeName(p.title)}.dawproject · ${counts.tracks} track${counts.tracks === 1 ? '' : 's'}, ${counts.notes} note${counts.notes === 1 ? '' : 's'}${counts.audio ? `, ${counts.audio} recording${counts.audio === 1 ? '' : 's'}` : ''}, ${p.tempo} bpm. The devices arrive as named placeholders: put your own instruments on in the other DAW.${warnings.length ? ` ${warnings.length} left out: ${warnings[0]}${warnings.length > 1 ? '…' : ''}` : ''}`, { kind: warnings.length ? 'info' : 'ok', ms: 9000 });
      return { zip, warnings, counts };
    } catch (e) { console.error(e); ui.toast('Could not export the DAWproject: ' + e.message, { kind: 'bad' }); return null; } finally { setBusy(null); }
  }
  const openReport = () => openProvenanceReport(app);

  app.exporter = { encodeWav, encodeMidi, zipStore, crc32, provenance: () => provenance(app), newSong, openDemo, putAside, openFile, loadText, saveProject, exportMix, exportStems, exportMidi, exportLog, exportDawproject, openReport, get busy() { return busy; },
    recent: () => recent().map(({ id, title, at, tracks }) => ({ id, title, at, tracks })), openRecent, openMenu: (anchor) => openMenu(anchor) };

  /* ---------------------------------------------------- the menu */
  // the width under which app.css hides the transport's loop and metronome group
  const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 460px)').matches;
  function openMenu(anchor) {
    if (busy) return;
    const at = anchor?.isConnected ? anchor : btn;
    if (!at) return;
    const p = store.get(), bf = beforeFork();
    // a row of the menu is words (design/LINER-NOTES-KIT.md): what it does, what it makes in pencil, and its key
    // (feature: the workspace feature the row belongs to; the simple view puts its rows away, ui/workspace.js)
    const item = (ic, label, sub, kb, run, cls = '', feature = null) => h('button.sm-i' + cls, { dataset: feature ? { feature } : {}, onclick: () => { pop.close(); run(); } }, h('span', h('b', label), sub ? h('small', sub) : null), kb ? h('kbd', kb) : null);
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
    // Anything that replaces the song asks first, the same way: one confirm under the row that was pressed (New song,
    // a demo), saying where the song on screen goes
    const confirmText = h('span'), confirmGo = h('button.ew-btn.ew-btn-small.ew-btn-primary'), confirmBox = h('div.sm-confirm', { hidden: true, role: 'group', 'aria-label': 'Replace the song?' },
      confirmText, h('div', confirmGo, h('button.ew-btn.ew-btn-small', { onclick: () => { confirmBox.hidden = true; asked?.focus(); asked = null; } }, 'Keep working')));
    let asked = null;
    function ask(row, question, go, run) {
      if (!confirmBox.hidden && asked === row) { confirmBox.hidden = true; asked = null; return; }
      asked = row;
      confirmText.textContent = `${question} “${p.title}” goes to Recent songs, and Undo brings it back.`;
      confirmGo.textContent = go;
      confirmGo.onclick = () => { pop.close(); run(); };
      row.after(confirmBox);
      confirmBox.hidden = false;
      confirmGo.focus();
    }
    const demoList = h('div.sm-demos', { hidden: true }, DEMOS.map((d) => h('button.sm-i', { onclick: (e) => ask(e.currentTarget, `Open the demo, “${d.title}”?`, `Open ${d.title}`, () => openDemo(d.id)) },
      h('span', h('b', d.title), h('small', `${d.genre}, ${d.tempo} bpm, ${d.key}`)))));
    // Recent songs: the ones replaced here, newest first, a click away (the one on screen isn't listed)
    const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
    // every song the list keeps can be opened: the newest four, then the rest (up to six) under one more row, as the
    // demos are (a song kept but out of reach was as good as lost)
    const rec = recent();
    const recRow = (e, i) => h('button.sm-i.sm-recent', { onclick: () => { pop.close(); openRecent(i); } },
      h('span', h('b', (e.title || 'Untitled').slice(0, 40)), h('small', `${e.tracks} track${e.tracks === 1 ? '' : 's'}, put aside ${ago(e.at)}`)));
    const olderList = rec.length > 4 ? h('div.sm-demos.sm-older', { hidden: true }, rec.slice(4).map((e, i) => recRow(e, i + 4))) : null;
    const recentRows = rec.length ? [h('div.sm-sep', 'Recent songs'), ...rec.slice(0, 4).map(recRow),
      olderList ? h('button.sm-i.sm-more.sm-older-t', { 'aria-expanded': 'false', onclick: (e) => { olderList.hidden = !olderList.hidden; e.currentTarget.setAttribute('aria-expanded', String(!olderList.hidden)); } },
        h('span', h('b', 'Older'), h('small', `${rec.length - 4} more: ${rec.slice(4).map((e) => `“${(e.title || 'Untitled').slice(0, 20)}”`).join(', ')}`)), icon('chevron', { size: 14 })) : null,
      olderList] : [];
    const share = provenance(app).summary;
    const kinds = share.notes.byKind;
    const tot = share.notes.total || 0;
    const body = h('div.sm',
      h('div.sm-head', h('b', p.title), h('small', `${p.tempo} bpm, ${p.tracks.length} track${p.tracks.length === 1 ? '' : 's'}`)),
      h('button.sm-i.sm-new', { onclick: (e) => ask(e.currentTarget, 'Start a new song?', 'New song', newSong) }, h('span', h('b', 'New song'), h('small', 'a blank reel'))),
      // a new song with the first minute on it (Take one's beat, then a tune over it): the welcome's main action
      app.onboard?.ownSong ? h('button.sm-i.sm-own', { onclick: (e) => ask(e.currentTarget, 'Make a song of your own?', 'Make your own', () => app.onboard.ownSong()) }, h('span', h('b', 'Make your own'), h('small', 'a new song: a beat and a tune in two minutes'))) : null,
      bf ? item('history', `Back to “${(bf.title || 'Untitled').slice(0, 32)}”`, 'your song from before Make it yours', null, () => replaceSong(bf, `Back to “${bf.title || 'Untitled'}”. “${p.title}” is kept: Undo brings it back.`), '.sm-before-fork') : null,
      // on a narrow phone the transport's loop and metronome buttons don't fit the bar (the ruler's loop strip still
      // toggles the loop): the click lives here, so you can record along to it
      narrow() && app.engine ? item('metronome', `Metronome: ${app.engine.metronome ? 'on' : 'off'}`, app.engine.metronome ? 'turn the click off' : 'a click to play along to', null, () => {
        app.engine.metronome = !app.engine.metronome; ui.emit('transport-ui');
        ui.toast(app.engine.metronome ? 'The click is on.' : 'The click is off.');
      }, '.sm-met', 'song-settings') : null,
      // ... and so does the killswitch (Shift+Esc and the transport's button elsewhere)
      narrow() && app.transport?.silence ? item('stop', 'All off', 'stop, and cut every note, tail and preview', '⇧Esc', () => app.transport.silence(), '.sm-kill', 'meters') : null,
      h('button.sm-i.sm-demo', { onclick: (e) => ask(e.currentTarget, `Open the demo, “${DEMOS[0].title}”?`, `Open ${DEMOS[0].title}`, () => openDemo()) }, h('span', h('b', 'Open the demo'), h('small', `“${DEMOS[0].title}”`))),
      h('button.sm-i.sm-more', { 'aria-expanded': 'false', onclick: (e) => { demoList.hidden = !demoList.hidden; e.currentTarget.setAttribute('aria-expanded', String(!demoList.hidden)); } },
        h('span', h('b', 'Demos'), h('small', `${DEMOS.length} songs: ${DEMOS.slice(1, 4).map((d) => d.genre.toLowerCase()).join(', ')}${DEMOS.length > 4 ? ' and more' : ''}`)), icon('chevron', { size: 14 })),
      demoList,
      item('down', 'Open a project file…', '.overdub.json', `${mod}O`, openFile, '', 'files'),
      app.importers ? item('keys', 'Import MIDI…', 'a .mid file: a track per part, one undo step', null, () => app.importers.pickMidi(), '', 'files') : null,
      // the way in for audio that doesn't need a drag (keyboard, a screen reader, a phone): onto the selected audio
      // track, or a new one under the selected track, from the playhead's bar
      app.importers?.pickAudio ? item('wave', 'Import audio…', 'WAV, MP3, M4A or OGG, from the playhead’s bar', null, () => app.importers.pickAudio({ track: ui.state.selection?.track || null }), '', 'files') : null,
      app.devicesIO ? item('knob', 'Import a device…', 'checked before it’s added', `${mod}⇧I`, () => app.devicesIO.pick(), '', 'files') : null,
      item('check', 'Save the project file', 'the song, every note and device', `${mod}S`, saveProject),
      app.share?.copy ? item('send', 'Share a link', 'copies it: the song, but not its audio clips', null, () => app.share.copy({ anchor: at.isConnected ? at : btn })) : null,
      app.find?.open ? item('search', 'Find anything', 'a panel, an action, a sound or help', `${mod}K`, () => app.find.open()) : null,
      app.onboard?.start ? item('play', 'Take one', 'the two-minute tour, on this song', null, () => app.onboard.start({ force: true, restart: true })) : null,
      ...recentRows,
      h('div.sm-sep', 'Export'),
      item('wave', 'Mix', 'WAV, 24-bit, 48 kHz', `${mod}⇧E`, exportMix),
      item('panelBottom', 'Stems', 'one WAV per track, zipped', null, exportStems, '', 'files'),
      item('keys', 'MIDI', 'Standard MIDI File, one track per part', null, exportMidi, '', 'files'),
      item('copy', 'DAWproject', '.dawproject: tracks, notes and audio for another DAW', null, exportDawproject, '', 'files'),
      item('person', 'Provenance report', 'who played what, printable as a PDF', null, openReport, '', 'files'),
      item('history', 'Attribution log', 'who did what, when (provenance)', null, exportLog, '', 'files'),
      tot ? h('div.sm-prov', h('div.sm-bar', { 'aria-hidden': 'true' }, ['human', 'agent', 'house'].filter((k) => kinds[k]).map((k) => h('i', { style: { flex: String(kinds[k]), background: k === 'agent' ? 'var(--agent)' : k === 'human' ? 'var(--human)' : 'var(--text-3)' } }))),
        h('small', 'Who wrote the notes: ', ...Object.entries(share.notes.byAuthor).sort((a, b) => b[1] - a[1]).flatMap(([by, n], i) => {
          const pc = `${Math.round((n / tot) * 100)}%`;
          const who = authorKind(app, by) === 'house' ? h('span.sm-house', authorName(app, by)) : byline(by, { app });
          return [i ? ', ' : '', who, ' ', h('span.mono', pc)];
        }))) : null);
    const pop = popover(at, body, { align: 'end', label: 'Song' });
    menuKeys(pop.el, '.sm-i, .sm-confirm button');
  }

  ui.panel({
    id: 'song', region: 'top', title: 'Song',
    mount(el) {
      prog = h('span.sm-prog');
      btn = h('button.sm-btn.btn', { title: 'The song: new, open, save, export', 'aria-haspopup': 'dialog', onclick: () => openMenu() }, h('span.sm-l', 'Song'), prog);
      el.append(btn);
      return { unmount() { btn = null; } };
    },
  });

  ui.keys.add({ key: 'KeyS', mod: 'mod', run: saveProject, label: 'Save the project file', group: 'Song', global: true });
  ui.keys.add({ key: 'KeyO', mod: 'mod', run: openFile, label: 'Open a project file', group: 'Song', global: true });
  ui.keys.add({ key: 'KeyE', mod: 'mod+shift', run: exportMix, label: 'Export the mix (WAV)', group: 'Song' });
  void closePopovers;
}

const EXPORT_CSS = `
.ew-region-top:has(> [data-panel="song"]) { flex-direction: row; } /* (the shell's .ew-region is a column; the top bar holds a row of panels) */
.ew-region-top > .ew-panel[data-panel="song"] { flex: none; order: 9; }
@media (min-width: 901px) { .ew-region-top > .ew-panel[data-panel="song"] { margin-left: 4px; padding-left: 10px; border-left: var(--rule); height: 40px; display: flex; align-items: center; } }
/* the Song key: a word on a rule edge (.btn); exporting, it says what it is doing in mono */
.sm-btn { height: 30px; padding: 0 12px; }
.sm-btn.busy { border-color: var(--accent-2); }
.sm-btn.busy .sm-l { display: none; }
.sm-prog { font: 11.5px var(--font-mono); color: var(--accent-2); }
.sm-prog:empty { display: none; }
/* the menu: a ledger of words, one hairline between sections, no icons */
.sm { display: grid; gap: 0; width: 312px; }
.sm-head { display: grid; gap: 3px; padding: 6px 10px 10px; border-bottom: var(--rule-heavy); margin-bottom: 4px; }
.sm-head b { font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 125%; font-variation-settings: var(--font-display-vars); font-size: 19px; line-height: 1.05; letter-spacing: -.012em; }
.sm-head small { color: var(--text-3); font: 11.5px var(--font-mono); }
.sm-i { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; padding: 6px 10px; border: 0; border-radius: 0; background: none; color: var(--text-2); cursor: pointer; text-align: left; }
.sm-i:hover, .sm-i:focus-visible { background: var(--bg-3); color: var(--text); outline: none; }
.sm-i:focus-visible { box-shadow: inset 0 0 0 2px var(--accent-2); }
.sm-i > span { display: grid; gap: 1px; }
.sm-i b { font-size: 13px; color: var(--text); font-weight: 600; }
.sm-i small { font-size: 11.5px; color: var(--text-3); }
.sm-i kbd { color: var(--text-3); }
.sm-sep { margin-top: 6px; padding: 10px 10px 4px; border-top: var(--rule); font-size: 13px; font-weight: 600; color: var(--text-3); }
.sm-confirm { display: grid; gap: 8px; margin: 2px 10px 8px; padding: 10px 0 2px; border-top: var(--rule); font-size: 12.5px; color: var(--text-2); line-height: 1.45; }
.sm-confirm[hidden] { display: none; }
.sm-more .ico { color: var(--text-3); transition: transform .12s var(--ease, ease); }
.sm-more[aria-expanded="true"] .ico { transform: rotate(90deg); }
.sm-demos { display: grid; gap: 0; margin: 0 0 4px 10px; border-left: var(--rule); }
.sm-demos[hidden] { display: none; }
.sm-demos .sm-i { padding: 5px 10px; }
.sm-confirm div { display: flex; gap: 8px; }
.sm-prov { display: grid; gap: 6px; margin-top: 6px; padding: 10px 10px 4px; border-top: var(--rule); }
.sm-prov small { font-size: 11.5px; color: var(--text-3); line-height: 1.5; }
.sm-prov .by { font-size: inherit; }
.sm-house { color: var(--text-2); }
.sm-bar { display: flex; gap: 0; height: 4px; border-radius: 0; overflow: hidden; }
@media (max-width: 900px) { .sm-btn { padding: 0 10px; } }
/* a phone in the simple view: the Song key is More's first row (ui/workspace.js), not the top bar's */
@media (max-width: 640px) { .ws-simple .ew-shell .sm-btn:not(.busy) { display: none; } }   /* (exporting, it says so) */
@media (prefers-reduced-motion: reduce) { .sm-more .ico { transition: none; } }
`;
