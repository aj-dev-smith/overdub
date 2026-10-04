// Share links with no server: the song rides in the URL's hash (#s=…), deflated (CompressionStream 'deflate-raw') and
// base64url-encoded. The part after the # never reaches a server, so a shared song is between you and whoever you
// send the link to. Notes, devices (the kernels written in the song too), the mix and the sections travel; audio
// clips and their recordings don't (they live in this browser's IndexedDB), and a link says so.
//
//   shareable(project)                  -> { song, dropped: { audioClips, assets, reference } }   (a copy; the song is
//                                          untouched; the reference track never travels)
//   await encodeShare(project, { from, max }) -> { ok, hash, chars, bytes, dropped } | { ok: false, error, chars, max }
//   await decodeShare(hashOrUrl)        -> { ok, song, from, at, dropped } | { ok: false, error } (refused too: a
//                                          song nested past MAX_DEPTH, or past the studio's limits, core/project.js)
//   readHash(hashOrUrl)                 -> the payload after '#s=' (or null)
//   listenCopy(payload, { own, id })    -> the song as the listener hears it: the sender's own parts ('you' in their
//                                          studio, and any part not signed by an agent, an earlier guest or the
//                                          house) are signed by a guest author, so they aren't confused with yours;
//                                          agents', earlier guests' and the house's keep their authors exactly. The
//                                          sender's devices are the guest's; an agent's (claude, claude.ai, mcp:*)
//                                          keep the agent's name, per the sender (via: the guest), under a guest.*
//                                          id; an earlier guest's keeps that guest's name, per the sender (via: the
//                                          guest: "made by Sam, via Jo's link"); any other claim (the house's) is the
//                                          guest's, kept as claimedBy. All pass guardDevices
//   guardDevices(song, { prefix })      -> { renamed, dropped }: a song's devices can add to the studio, never take
//                                          over a built-in's or the house shelf's id (those move to <prefix>.<slug>)
//   forkSong(song, { at })              -> the same song with meta.forkedFrom { title, authors, at, id, from }
//   authorsOf(song, authorFn)           -> [{ id, kind, name, notes }] everyone with a part in it, most notes first
//   creditsOf(song, authorFn)           -> the same, each with share: a whole-number % of the notes (sums to 100)
//   await openShared(hashOrUrl)         -> decodeShare + listenCopy for this browser: { ok, song, from, at, guest, own }
//   browserId()                         -> this browser's random secret (localStorage 'overdub:me'). It never leaves
//                                          the browser: a link carries linkMark(secret, at, song), so your own
//                                          links open as yours and nobody can forge one that does
//
// Payload (JSON, then deflate-raw, then base64url): { f: 'overdub-share/0', at, from: { name?, mark? }, dropped, song }.
// (Links made before the mark carried from.me, the raw id; they open as a guest's.)
// Works in the browser and in Node 18+ (both have CompressionStream, crypto.subtle, btoa and atob).

import { newId, HOUSE, cleanProject, songSize, sizeError, namedAuthor } from './project.js';
import { getDevice } from '../devices/registry.js';

export const SHARE_FORMAT = 'overdub-share/0';
export const HASH_KEY = 's';
// The longest link we'll make, in characters of payload (64 KB). The hash never goes to a server, so this is about
// the places links get pasted (chats, mail), not about HTTP: about 7x the demo song.
export const MAX_CHARS = 64 * 1024;
// The most a link may inflate to (a guard against a deliberately huge payload).
const MAX_INFLATED = 8 * 1024 * 1024;
// The deepest a link's JSON may nest. A real song goes about ten deep (a point in a lane on an insert:
// payload.song.tracks[i].inserts[j].auto[k].points[n]); one far deeper is refused before anything walks it (the copy
// below, cleanProject), so none of them can run out of stack.
export const MAX_DEPTH = 64;
export const GUEST_NAME = 'Guest';
const ME_KEY = 'overdub:me';

const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------------------------------------------------------------- what travels */
export function shareable(project) {
  const song = clone(project);
  let audioClips = 0;
  for (const t of song.tracks || []) {
    const keep = [];
    for (const c of t.clips || []) { if (c.kind === 'audio') audioClips++; else keep.push(c); }
    t.clips = keep;
  }
  const assets = Object.keys(song.assets || {}).length;
  song.assets = {};
  // the reference track (ui/reference.js) is never part of the song, and its audio can't travel: it stays here
  const reference = song.reference ? 1 : 0;
  delete song.reference;
  return { song, dropped: { audioClips, assets, reference } };
}

/* ---------------------------------------------------------------- bytes */
async function pipe(bytes, stream, limit = Infinity) {
  const rs = new Blob([bytes]).stream().pipeThrough(stream);
  const reader = rs.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) { try { await reader.cancel(); } catch (e) { /* ok */ } throw new Error('the link inflates to more than a song can be'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
export const inflate = (bytes, limit = MAX_INFLATED) => pipe(bytes, new DecompressionStream('deflate-raw'), limit);

export function toBase64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64url(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ---------------------------------------------------------------- encode / decode */
// The mark that makes a link yours: a hash of this browser's secret, the moment and the song itself, so it can't be
// lifted onto another song, and the secret can't be read back out of it.
export async function linkMark(secret, at, songJson) {
  const bytes = new TextEncoder().encode(`overdub-share-mark/0\n${secret}\n${at}\n${songJson}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let s = '';
  for (let i = 0; i < 8; i++) s += h[i].toString(16).padStart(2, '0');
  return s;
}

// `from.me` is this browser's secret: it becomes from.mark and never goes in the link itself
export async function encodeShare(project, { from = null, max = MAX_CHARS, at = new Date().toISOString() } = {}) {
  const { song, dropped } = shareable(project);
  const { me, ...sender } = from || {};
  if (me) sender.mark = await linkMark(me, at, JSON.stringify(song));
  const payload = { f: SHARE_FORMAT, at, from: sender, dropped, song };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await deflate(json);
  const data = toBase64url(packed);
  const chars = data.length;
  if (chars > max) {
    return { ok: false, error: `“${song.title || 'Untitled'}” is too big for a link: ${kb(chars)} of song, and a link holds ${kb(max)}. Save the project file instead (Song menu, Save) and send that.`, chars, max, dropped };
  }
  return { ok: true, hash: `#${HASH_KEY}=${data}`, data, chars, bytes: json.length, dropped };
}

export function readHash(hashOrUrl) {
  const s = String(hashOrUrl || '');
  const i = s.indexOf('#');
  const frag = i >= 0 ? s.slice(i + 1) : s;
  const m = new RegExp(`(?:^|&)${HASH_KEY}=([A-Za-z0-9_-]+)`).exec(frag);
  return m ? m[1] : null;
}

// Does a value nest past `max` arrays and objects? Counted with a list, not by recursing, so the count itself can't run
// out of stack.
function nestsPast(value, max) {
  const todo = [[value, 1]];
  while (todo.length) {
    const [v, depth] = todo.pop();
    if (depth > max) return true;
    for (const x of Array.isArray(v) ? v : Object.values(v)) if (x && typeof x === 'object') todo.push([x, depth + 1]);
  }
  return false;
}

export async function decodeShare(hashOrUrl) {
  const data = readHash(hashOrUrl);
  if (!data) return { ok: false, error: 'There’s no song in this link (it has no #s= part).' };
  let payload;
  try {
    const json = await inflate(fromBase64url(data));
    payload = JSON.parse(new TextDecoder().decode(json));
  } catch (e) {
    return { ok: false, error: 'This link’s song didn’t come through whole (it was probably cut off when it was pasted). Ask for the link again, or for the project file.' };
  }
  if (!payload || payload.f !== SHARE_FORMAT || !payload.song || !Array.isArray(payload.song.tracks)) {
    return { ok: false, error: 'This link holds something that isn’t an Overdub song.' };
  }
  if (nestsPast(payload, MAX_DEPTH)) return { ok: false, error: `This link holds something nested deeper than any song: more than ${MAX_DEPTH} levels, where a song needs about 10.` };
  // A link is held to the studio's limits (core/project.js LIMITS) as it comes in: a few hundred KB of one can carry
  // more notes than the tab keeps up with. A song file past one still opens (it just can't grow).
  const over = sizeError(songSize(cleanProject(payload.song)), null, { loaded: true });
  if (over) return { ok: false, error: `In this link, ${over}. Ask for the project file instead.` };
  const from = payload.from && typeof payload.from === 'object' && !Array.isArray(payload.from) ? payload.from : {};
  return { ok: true, song: payload.song, from, at: payload.at || null, dropped: payload.dropped || { audioClips: 0, assets: 0 } };
}

/* ---------------------------------------------------------------- devices that arrive in a song */
// A song's own devices (project.devices) are code from whoever wrote the song. They can add devices to the studio,
// never take one over: an id in a built-in namespace (core., pedal., amp., cab., overdub.) or one the studio already
// ships (the house shelf's claude.*) comes in under a new id, <prefix>.<slug>, and every track and insert that named
// it moves along with it. A device that isn't one (no kernel source, a bad id) or whose source is past
// MAX_KERNEL_CHARS is left out. Used for share links (prefix 'guest') and opened song files (prefix 'you').
export const HOUSE_NS = /^(core|pedal|amp|cab|overdub)\./;
export const MAX_KERNEL_CHARS = 256 * 1024;
const DEVICE_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const shipped = (id) => { const d = getDevice(id); return !!d && d.source !== 'project'; };
export const isHouseId = (id, taken = shipped) => HOUSE_NS.test(String(id)) || !!taken(String(id));
const slugOf = (id) => (String(id).split('.').slice(1).join('-') || String(id)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'device';

export function guardDevices(song, { prefix = 'guest', taken = shipped } = {}) {
  const renamed = {}, dropped = [];
  const src = song.devices && typeof song.devices === 'object' && !Array.isArray(song.devices) ? song.devices : {};
  const out = {};
  const used = (id) => Object.hasOwn(out, id) || Object.hasOwn(src, id) || isHouseId(id, taken);
  for (const [key, d] of Object.entries(src)) {
    if (!DEVICE_ID.test(key) || !d || typeof d !== 'object' || typeof d.kernel !== 'string' || d.kernel.length > MAX_KERNEL_CHARS) { dropped.push(key); continue; }
    let id = key;
    if (isHouseId(key, taken)) {
      const base = `${prefix}.${slugOf(key)}`;
      id = base;
      for (let n = 2; used(id); n++) id = `${base}-${n}`;
      renamed[key] = id;
    }
    // the key is the id: a def can't name one id and register as another; and a song's device is data, so no build or
    // worklets (code only the studio's own devices carry: devices/registry.js defineDevice)
    const { build, worklets, ...data } = d;
    out[id] = { ...data, id };
  }
  song.devices = out;
  if (Object.keys(renamed).length) {
    const move = (x) => { if (x && typeof x === 'object' && Object.hasOwn(renamed, x.device)) x.device = renamed[x.device]; };
    for (const t of Array.isArray(song.tracks) ? song.tracks : []) {
      move(t?.instrument);
      for (const fx of Array.isArray(t?.inserts) ? t.inserts : []) move(fx);
    }
    for (const fx of Array.isArray(song.master?.inserts) ? song.master.inserts : []) move(fx);
  }
  return { renamed, dropped };
}

/* ---------------------------------------------------------------- authors */
// The agents a link may name as a device's author: the in-app agent, the remote connector and local MCP clients.
export const isAgentId = (by) => typeof by === 'string' && by.length <= 64 && (by === 'claude' || by === 'claude.ai' || /^mcp:[a-z0-9][a-z0-9._-]*$/i.test(by));

// The sender's own parts are 'you' in their studio. In yours they're a guest's: same notes, a different signature.
export function guestId(from = {}) {
  const slug = String(from.name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const tag = String(from.mark || from.me || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase();
  return 'guest:' + ([slug, tag].filter(Boolean).join('-') || 'someone');
}
// A person from an earlier link, as guestId names them.
export const isGuestId = (by) => typeof by === 'string' && by.length <= 64 && /^guest:[a-z0-9][a-z0-9-]*$/.test(by);
// The signatures someone else's link keeps: an agent's, an earlier guest's and the house's. (Whether an agent's should
// travel on a person's word is a product call; for now they do, and a device an agent wrote says whose link vouched.)
const keepsBy = (by) => isAgentId(by) || isGuestId(by) || by === HOUSE;

// Sign the sender's parts as the guest. Any signature keepsBy doesn't know is the sender's own work ('you' in their
// studio, or anything else a link says), and so is a track, clip, insert or lane with none at all, which the studio
// would read as 'you'. A note or a point without one goes with its clip or lane. (The song's shape, not a walk over
// every object: a device param that happens to be called "by" stays a param.)
function signGuest(song, guest) {
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
  const sign = (x) => { if (!keepsBy(x.by)) x.by = guest; };
  const signIfSigned = (x) => { if ('by' in x) sign(x); };
  const lanes = (auto) => { if (isObj(auto)) for (const lane of Object.values(auto)) if (isObj(lane)) { sign(lane); list(lane.points).forEach(signIfSigned); } };
  const inserts = (v) => { for (const fx of list(v)) { sign(fx); lanes(fx.auto); } };
  for (const t of list(song.tracks)) {
    sign(t);
    lanes(t.auto);
    if (isObj(t.instrument)) lanes(t.instrument.auto);
    inserts(t.inserts);
    for (const c of list(t.clips)) { sign(c); list(c.notes).forEach(signIfSigned); }
  }
  if (isObj(song.master)) { inserts(song.master.inserts); lanes(song.master.auto); }
}

// The song as the listener gets it. `own` is true only for a link this browser made (openShared checks its mark): it
// opens with your parts still yours. `id` (optional) is the id this copy gets in this studio. `taken` (optional) says
// which device ids the studio already ships (the registry's, by default).
export function listenCopy({ song, from = {} }, { own = false, id = null, taken = undefined } = {}) {
  const out = clone(song);
  out.meta = { ...(out.meta || {}), authors: { ...(out.meta?.authors || {}) } };
  // someone else's link: a device an agent wrote keeps its author, but comes in under the guest's namespace
  // (guest.<slug>), so it can never stand in for a device of the same name in this studio
  const agentWrote = new Set();
  if (!own && out.devices && typeof out.devices === 'object' && !Array.isArray(out.devices)) {
    for (const [key, d] of Object.entries(out.devices)) if (d && typeof d === 'object' && isAgentId(d.by) && !key.startsWith('guest.')) agentWrote.add(key);
  }
  const base = taken || shipped;
  const devices = guardDevices(out, { prefix: 'guest', taken: agentWrote.size ? (x) => agentWrote.has(x) || base(x) : base });
  let guest = null;
  // (a link never carries the reference track: shareable leaves it out)
  delete out.reference;
  if (!own) {
    guest = guestId(from);
    signGuest(out, guest);
    // a device in someone else's link is their code. The sender's own ('you') is the guest's; one an agent wrote
    // (claude, claude.ai, mcp:*) or an earlier guest made (a device that came to the sender in someone else's link:
    // Sam's, sent back by Jo) keeps its author, per the sender (d.via says whose link it came through), as an earlier
    // guest's parts do; anything else, the house's name above all, can't be claimed from outside: it is the guest's,
    // and what it claimed is kept beside it
    for (const d of Object.values(out.devices)) {
      if (isAgentId(d.by) || (isGuestId(d.by) && d.by !== guest)) { d.by = String(d.by).slice(0, 64); d.via = guest; continue; }
      if (d.by && d.by !== 'you' && d.by !== guest) d.claimedBy = String(d.by).slice(0, 64);
      d.by = guest;
      delete d.via;
    }
    delete out.meta.authors.you;
    // (a sender who signs as someone the studio already knows by name, You or Claude, is named "Guest")
    out.meta.authors[guest] = { kind: 'human', name: namedAuthor(guest, { name: String(from.name ?? '').slice(0, 40) }).name };
  }
  out.meta.sharedFrom = { id: song.id || null, at: new Date().toISOString() };
  if (id) out.id = id;
  return { song: out, guest, own, devices };
}

// Everyone with a part in the song (notes, clips, tracks, effects, devices), most notes first.
export function authorsOf(song, author = null) {
  const m = new Map();
  const bump = (by, notes = 0) => { if (!by) return; const a = m.get(by) || { id: by, notes: 0, parts: 0 }; a.notes += notes; a.parts++; m.set(by, a); };
  for (const t of song.tracks || []) {
    bump(t.by);
    for (const fx of t.inserts || []) bump(fx.by);
    for (const c of t.clips || []) { bump(c.by); for (const n of c.notes || []) bump(n.by || c.by, 1); }
  }
  for (const fx of song.master?.inserts || []) bump(fx.by);
  for (const d of Object.values(song.devices || {})) bump(d.by);
  const known = song.meta?.authors || {};
  // (who someone is comes from the store when there is one, else from the song, by the same rules: core/project.js
  // namedAuthor. What a song says can't change an id's kind or take a name someone else goes by.)
  const out = [...m.values()].map((a) => {
    const info = (author && author(a.id)) || namedAuthor(a.id, Object.hasOwn(known, a.id) ? known[a.id] : null);
    return { id: a.id, kind: info.kind || 'human', name: info.name || String(a.id), notes: a.notes };
  });
  const rank = { human: 0, agent: 1, house: 2 };
  return out.sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3) || b.notes - a.notes);
}

// Who wrote the song, in proportion: everyone with notes in it, most notes first, each with a whole-number share
// that sums to 100 (the house included, so a demo the house mostly wrote doesn't read as the guest's). Authors with
// no notes (a device, a mix move) come after, with share null. -> [{ id, kind, name, notes, share }]
export function creditsOf(song, author = null) {
  const list = authorsOf(song, author);
  const total = list.reduce((n, a) => n + a.notes, 0);
  const noted = list.filter((a) => a.notes > 0).sort((a, b) => b.notes - a.notes);
  const rest = list.filter((a) => a.notes === 0).map((a) => ({ ...a, share: null }));
  if (!total) return rest;
  // largest remainder, so the shares add up to 100 exactly
  const raw = noted.map((a) => (100 * a.notes) / total);
  const share = raw.map(Math.floor);
  let left = 100 - share.reduce((x, y) => x + y, 0);
  for (const i of raw.map((r, i) => i).sort((a, b) => (raw[b] - share[b]) - (raw[a] - share[a]))) { if (left <= 0) break; share[i]++; left--; }
  return [...noted.map((a, i) => ({ ...a, share: share[i] })), ...rest];
}
// "Overdub 82%, Sam 12% and Claude 6%"
export const shareText = (a) => (a.share == null ? a.name : `${a.name} ${a.share ? a.share : '<1'}%`);

// "Guest, Claude and Overdub"
export function namesLine(list) {
  const names = [...new Set(list.map((a) => a.name))];
  if (names.length <= 1) return names[0] || 'nobody yet';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

export function browserId() {
  try {
    let me = localStorage.getItem(ME_KEY);
    if (!me) { me = newId('me').slice(3) + newId('me').slice(3); localStorage.setItem(ME_KEY, me); }
    return me;
  } catch (e) { return null; }
}

// Is this a link this browser made? Only if its mark is this browser's mark for exactly this song.
export async function isOwnLink({ song, from = {}, at = null }, me = browserId()) {
  if (!me || !from.mark || typeof from.mark !== 'string') return false;
  try { return from.mark === await linkMark(me, at, JSON.stringify(song)); } catch (e) { return false; }
}

export async function openShared(hashOrUrl, { me = browserId(), taken = undefined } = {}) {
  const r = await decodeShare(hashOrUrl);
  if (!r.ok) return r;
  const own = await isOwnLink(r, me);
  const l = listenCopy(r, { own, id: newId('p'), taken });
  return { ok: true, song: l.song, from: r.from, at: r.at, dropped: r.dropped, guest: l.guest, own: l.own, devices: l.devices, original: { id: r.song.id || null, title: r.song.title || 'Untitled' } };
}

/* ---------------------------------------------------------------- fork */
export function forkSong(song, { at = new Date().toISOString(), author = null } = {}) {
  const out = clone(song);
  const authors = authorsOf(song, author).map(({ id, kind, name }) => ({ id, kind, name }));
  out.meta = { ...(out.meta || {}), authors: { ...(out.meta?.authors || {}) } };
  for (const a of authors) if (!out.meta.authors[a.id]) out.meta.authors[a.id] = { kind: a.kind, name: a.name };
  out.meta.forkedFrom = { title: song.title || 'Untitled', authors, at, id: song.meta?.sharedFrom?.id || song.id || null };
  delete out.meta.sharedFrom;
  return out;
}

export const kb = (chars) => (chars < 1024 ? `${chars} B` : `${(chars / 1024).toFixed(chars < 10240 ? 1 : 0)} KB`);
