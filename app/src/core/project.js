// The project document: the song. docs/ARCHITECTURE.md ("The project document") is the schema.
//
//   newId('t')            -> 't_k3j9x2'
//   createProject(patch)  -> a fresh, valid project
//   normTrack / normClip / normInsert  fill in defaults (ops use them)
//   validateProject(p)    -> list of problems (empty when fine); cleanProject(p) repairs what it can
//   songEnd(p)            -> beats (end of the last clip, or 16)
//   LIMITS, songSize(p), sizeError(after, before?)   how far edits can grow a song
//   summarize(p)          -> the compact text view agents read
// Automation lanes (core/automation.js) ride on what they move: track.auto, instrument.auto, insert.auto, master.auto.
// The normalisers keep them (canonical: sorted, clamped where the range is known, empty lanes dropped), so a load, an
// undo of a removal and cleanProject never drop a lane.

import { formatNotes, keyLabel, beatsPerBar, noteName, validMeter, isPlace } from './music.js';
import { normAuto, lanesOf, formatPoints, specFor } from './automation.js';

export const FORMAT = 'overdub/0';
// The house author: demo and built-in content, drawn neutral (neither warm nor cool).
export const HOUSE = 'overdub';

// Songs saved under the product's first name. tools/rebrand.js rewrites FORMAT and HOUSE above when the product is
// renamed; the legacy name is built from pieces so that script never rewrites it, and files people saved (and the
// song autosaved in their browser) keep opening, with their house-authored parts still drawn neutral.
const LEGACY_NAME = ['ear', 'worm'].join('');
const family = (f) => String(f || '').split('/')[0];
// Is this a project document's format string (this name or the old one, any version)?
export function isProjectFormat(f) {
  return family(f) === family(FORMAT) || family(f) === LEGACY_NAME;
}
// Re-sign everything the old house id authored with the current one (no-op until the product is renamed).
function rehouse(x) {
  if (LEGACY_NAME === HOUSE || !x || typeof x !== 'object') return x;
  if (Array.isArray(x)) { for (const v of x) rehouse(v); return x; }
  if (x.by === LEGACY_NAME) x.by = HOUSE;
  for (const v of Object.values(x)) if (v && typeof v === 'object') rehouse(v);
  return x;
}

const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';
export function newId(prefix) {
  const b = new Uint8Array(6);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => (Math.random() * 256) | 0) }).getRandomValues(b);
  let s = '';
  for (const x of b) s += ALPHA[x % 36];
  return `${prefix}_${s}`;
}

// Re-mint a project's track, clip, insert and section ids (and its own id) from a seed and their position. Ids seed
// the instruments' randomness, so a demo built with stable ids sounds the same for everyone, every time it opens.
// Only for a freshly built project: nothing in a new demo refers to these ids yet. Note ids are per clip already.
export function stableIds(p, seed) {
  const used = new Set();
  let n = 0;
  const mint = (prefix) => {
    for (;;) {
      let h = 0x811c9dc5;
      const key = `${seed}:${n++}`;
      for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      let s = '';
      for (let i = 0; i < 6; i++) { s += ALPHA[h % 36]; h = (Math.floor(h / 36) ^ Math.imul(h, 2654435761)) >>> 0; }
      const id = `${prefix}_${s}`;
      if (!used.has(id)) { used.add(id); return id; }
    }
  };
  p.id = mint('p');
  for (const sec of p.sections || []) sec.id = mint('s');
  const was = new Map();
  for (const t of p.tracks) {
    was.set(t.id, (t.id = mint('t')));
    for (const fx of t.inserts) fx.id = mint('fx');
    for (const c of t.clips) c.id = mint('c');
  }
  for (const fx of p.master?.inserts || []) fx.id = mint('fx');
  // a keyed insert (a sidechain) names its key track by id: it follows the track
  for (const t of p.tracks) for (const fx of t.inserts) if (fx.key && was.has(fx.key.track)) fx.key = { ...fx.key, track: was.get(fx.key.track) };
  return p;
}

export const TRACK_COLORS = ['var(--c-1)', 'var(--c-2)', 'var(--c-3)', 'var(--c-4)', 'var(--c-5)', 'var(--c-6)', 'var(--c-7)', 'var(--c-8)'];

export function createProject(patch = {}) {
  const now = new Date().toISOString();
  return {
    format: FORMAT,
    id: newId('p'),
    title: 'Untitled',
    tempo: 120,
    meter: [4, 4],
    key: { root: 'C', scale: 'minor' },
    loop: { on: false, start: 0, end: 16 },
    tracks: [],
    sections: [],
    devices: {},
    assets: {},
    master: { gain: 0, inserts: [] },
    meta: { created: now, modified: now, authors: {} },
    ...patch,
  };
}

// A name is text: a loaded or sent number reads as its digits, anything else falls back (code lowercases names to
// find things by them).
const textName = (v, fallback) => (typeof v === 'string' && v ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback);
// What a person reads as a name or a title is plain text: no control characters (C0, C1) and no bidi overrides or
// isolates (U+202A-U+202E, U+2066-U+2069), which can turn a name round to read as someone else's or hide what follows
// it. Every other character stays as it was written.
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
export const plainText = (s) => String(s).replace(UNSEEN, '');
// The longest name a track, clip, section, marker, device or preset can have (the longest the studio ships is a
// guitar rig's 24 characters; the importers and the rename fields stop at 32 to 80), and a title (project.set's limit).
export const NAME_MAX = 100;
export const TITLE_MAX = 200;
// (cut to a length without splitting a character in two: an emoji is two UTF-16 units)
const cut = (s, max) => { if (s.length <= max) return s; const out = s.slice(0, max); return /[\ud800-\udbff]$/.test(out) ? out.slice(0, -1) : out; };
// A name as the song keeps it: text, plain, at most `max` characters; the fallback when nothing is left of it.
export const cleanName = (v, fallback, max = NAME_MAX) => cut(plainText(textName(v, '')), max) || fallback;
// A colour a song can hold: a palette token (var(--c-N), app/style/tokens.css) or hex (#rgb, #rgba, #rrggbb,
// #rrggbbaa), the only kinds the studio writes. The page draws a colour as CSS, where a url(...) is a request to
// whoever wrote the song as soon as it draws, so anything else is dropped where a song comes in and the default applies.
const COLOR = /^(?:var\(--c-\d{1,2}\)|#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))$/;
export const isColor = (v) => typeof v === 'string' && COLOR.test(v);
// A number from a loaded song, or 0: JSON's 1e400 reads as Infinity, and a beat or a gain that is Infinity (or NaN)
// would carry on into the song's length and the engine.
const finite = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// A note the studio can place: a finite pitch and start, and a finite length and velocity when it gives them (older
// and hand-written songs leave those out, and the engine has defaults).
const playable = (n) => isNum(n.p) && isNum(n.t) && (n.d === undefined || isNum(n.d)) && (n.v === undefined || isNum(n.v));
// A loaded song is anyone's JSON (a share link, a file). The normalisers take any shape and never throw: a list that
// isn't one is empty, an entry that isn't an object is left out, and what the studio draws as text (titles, names,
// authors, colours) is text. ui/dom.js h() reads a plain object as attributes, so an object where a name goes would
// reach the page as markup.
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const objs = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const author = (v) => textName(v, 'you');

// Authors. An id's form says who it is (docs/ARCHITECTURE.md): 'you' and 'guest:<name>-<browser>' are people; 'claude',
// 'claude.ai' and 'mcp:<name>' are agents; HOUSE is the house -> 'human' | 'agent' | 'house', or null for an id of no
// known form (a hand-written file's), which is whatever its song says.
export function authorClass(id) {
  const s = String(id);
  if (s === HOUSE) return 'house';
  if (s === 'claude' || s === 'claude.ai' || s.startsWith('mcp:')) return 'agent';
  if (s === 'you' || s.startsWith('guest:')) return 'human';
  return null;
}
// The studio's own authors, whose names nobody else can go by. Names are compared loosely (letters and digits, any
// case or width), so "CLAUDE", "C l a u d e" and "Ｙｏｕ" are taken too.
const STUDIO_AUTHORS = { you: { kind: 'human', name: 'You' }, claude: { kind: 'agent', name: 'Claude' }, [HOUSE]: { kind: 'house', name: 'Overdub' }, 'claude.ai': { kind: 'agent', name: 'claude.ai' } };
export const looseName = (s) => plainText(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export const STUDIO_NAMES = new Set(Object.values(STUDIO_AUTHORS).map((a) => looseName(a.name)));
// Who an author is, from what is said about them (a song's meta.authors entry, or the session's) -> { kind, name }.
// The kind is the id's form whatever is said, so a link can't pass a person's part off as an agent's or the other way
// round. A name stands when it is no one else's (`taken`: loose names spoken for, the studio's own by default), else the
// id's own: "Guest" for a guest, the client's name for an MCP agent, the id itself.
export function namedAuthor(id, said = null, taken = STUDIO_NAMES) {
  const key = String(id);
  if (Object.hasOwn(STUDIO_AUTHORS, key)) return STUDIO_AUTHORS[key];
  const kind = authorClass(key) || (said && ['human', 'agent', 'house'].includes(said.kind) ? said.kind : 'human');
  const free = (n) => !!n && !taken.has(looseName(n));
  const name = said && typeof said.name === 'string' ? cleanName(said.name, '').trim() : '';
  if (free(name)) return { kind, name };
  const own = key.startsWith('guest:') ? 'Guest' : key.startsWith('mcp:') ? key.slice(4) || 'Agent' : key;
  return { kind, name: free(own) ? own : key };
}

export function normTrack(t, index = 0) {
  if (!isObj(t)) t = {};
  const kind = t.kind === 'audio' ? 'audio' : 'instrument';
  return withAuto({
    id: t.id || newId('t'),
    name: cleanName(t.name, kind === 'audio' ? 'Audio' : 'Track'),
    color: isColor(t.color) ? t.color : TRACK_COLORS[index % TRACK_COLORS.length],
    kind,
    instrument: kind === 'instrument' ? (isObj(t.instrument) ? withAuto({ device: textName(t.instrument.device, 'core.poly'), params: { ...(isObj(t.instrument.params) ? t.instrument.params : {}) } }, t.instrument.auto) : { device: 'core.poly', params: {} }) : null,
    inserts: objs(t.inserts).map(normInsert),
    clips: objs(t.clips).map((c) => normClip(c)),
    gain: Number.isFinite(t.gain) ? t.gain : 0,
    pan: Number.isFinite(t.pan) ? t.pan : 0,
    mute: !!t.mute,
    solo: !!t.solo,
    arm: !!t.arm,
    ...(kind === 'audio' ? { input: isObj(t.input) ? t.input : { device: 'default', channel: 1 } } : {}),
    by: author(t.by),
  }, t.auto, true);
}

// Put a normalised auto map on an object (last, as the ops add it), or nothing when there are no lanes.
function withAuto(obj, auto, mixer = false) {
  const a = normAuto(auto, { mixer });
  if (a) obj.auto = a;
  return obj;
}

export function normInsert(fx) {
  if (!isObj(fx)) fx = {};
  const key = normKey(fx.key);
  return withAuto({ id: fx.id || newId('fx'), device: String(fx.device), on: fx.on !== false, params: { ...(isObj(fx.params) ? fx.params : {}) }, by: author(fx.by), ...(key ? { key } : {}) }, fx.auto);
}
// An insert's key input (a sidechain: docs/ARCHITECTURE.md "Keys"): { track: '<track id>' }, the track whose sound
// (after its inserts, before its fader) the insert's device hears beside its own input. Anything else is no key. A key
// naming a track that isn't in the song stays (undoing the track's removal brings it back) and is heard as silence.
export function normKey(k) {
  return isObj(k) && typeof k.track === 'string' && k.track && k.track.length <= 64 ? { track: k.track } : null;
}

// A take group: the clips one recording stacked on the same span ('tk_' + base36). The playing take is the unmuted one.
export const isTakeId = (v) => typeof v === 'string' && /^tk_[0-9a-z]{4,16}$/.test(v);

export function normClip(c) {
  if (!isObj(c)) c = {};
  const kind = c.kind === 'audio' ? 'audio' : 'notes';
  const base = {
    id: c.id || newId('c'),
    kind,
    start: Math.max(0, finite(c.start)),
    length: Math.max(0.25, finite(c.length) || 4),
    by: author(c.by),
  };
  if (c.name) base.name = cleanName(c.name, 'Clip');
  if (isColor(c.color)) base.color = c.color;
  if (c.mute === true) base.mute = true;   // a muted clip stays in the song and plays nowhere (older songs: none)
  if (isTakeId(c.take)) base.take = c.take; // the take group a recorded clip belongs to (older songs: none)
  if (kind === 'audio') return { ...base, asset: textName(c.asset, undefined), offset: finite(c.offset), gain: finite(c.gain) };
  // tab (core/fretboard.js): the tuning a guitar part is written for (an id: a newer studio's tuning is kept, and
  // read as standard here) and a capo's fret (older songs: none, and no capo)
  if (isTuningId(c.tuning)) base.tuning = c.tuning;
  if (Number.isInteger(c.capo) && c.capo >= 1 && c.capo <= 12) base.capo = c.capo;
  // (a note's own author, when it has one, is text; one that isn't falls back to the clip's; its place, s and f, is a
  // string and a fret as whole numbers, or it isn't kept)
  return { ...base, notes: objs(c.notes).map((n) => {
    const o = { ...n };
    if ('by' in o && !textName(o.by, '')) delete o.by; else if ('by' in o) o.by = textName(o.by, '');
    if (('s' in o || 'f' in o) && !isPlace(o.s, o.f)) { delete o.s; delete o.f; }
    return o;
  }) };
}
// A clip's tuning: an id like core/fretboard.js's ('standard', 'drop-d', 'dadgad'): lower case, digits and dashes
export const isTuningId = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v);

// Give notes ids ('n' + a counter per clip) and keep them in canonical order (by time, then pitch). Notes are always
// stored sorted, so an undo puts a clip back exactly as it was. Mutates and returns the clip.
// seq (the store's, clip id -> next number): an id is never handed out twice in a clip while there is history to
// undo. Undo finds notes by id, so if deleting the newest note freed its id for the next one, an old undo would land
// on somebody else's note. The counter lives in the store, not the song, so an undo still puts the song back exactly.
export function idNotes(clip, seq = null) {
  let max = 0;
  for (const n of clip.notes) if (n.id) max = Math.max(max, parseInt(String(n.id).slice(1), 36) || 0);
  let next = Math.max(max + 1, (seq && seq.get(clip.id)) || 1);
  for (const n of clip.notes) if (!n.id) n.id = 'n' + (next++).toString(36);
  if (seq) seq.set(clip.id, next);
  return sortNotes(clip);
}
export function sortNotes(clip) {
  clip.notes.sort((a, b) => a.t - b.t || a.p - b.p || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return clip;
}

export function songEnd(p) {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
  for (const s of p.sections || []) end = Math.max(end, s.start + s.length);
  return end || beatsPerBar(p.meter) * 4;
}

// How far edits can grow a song. Arrangement ops multiply what they're given (a loop ×64 three times over is a million
// notes), so the planners (core/arrangement.js), the note ops and, as a backstop, every op the store applies
// (core/store.js) are held to these: room for any real arrangement, small enough that the song still autosaves and
// the tab keeps up. A song that already holds more (an old file) still opens and can be edited; it just can't grow.
// Automation: lanePoints in one lane, songPoints in all of them (a point is ~20 bytes; recordings are thinned).
export const LIMITS = { clipNotes: 20000, songNotes: 50000, clips: 4096, beats: 8192, lanePoints: 10000, songPoints: 50000 };
const count = (n) => Number(n).toLocaleString('en-US');
// What a song holds: { clips, notes, clipNotes (the most in one clip), end (the last beat a clip or section reaches),
// points (automation points in all lanes), lanePoints (the most in one lane) }. Lanes don't extend the end.
export function songSize(p) {
  let clips = 0, notes = 0, clipNotes = 0, end = 0, points = 0, lanePoints = 0;
  for (const { lane } of lanesOf(p)) { points += lane.points.length; if (lane.points.length > lanePoints) lanePoints = lane.points.length; }
  for (const t of p.tracks) for (const c of t.clips) {
    clips++;
    const n = c.notes ? c.notes.length : 0;
    notes += n; if (n > clipNotes) clipNotes = n;
    end = Math.max(end, c.start + c.length);
  }
  for (const s of p.sections || []) end = Math.max(end, s.start + s.length);
  return { clips, notes, clipNotes, end, points, lanePoints };
}
// The first limit `after` (a songSize) is past and grew past, from `before` if given -> a sentence, or null.
// loaded: the song came in already past it (a share link, core/share.js), so it says what the song holds, not what it
// would.
export function sizeError(after, before = null, { loaded = false } = {}) {
  const over = (k, lim) => after[k] > lim + 1e-6 && !(before && after[k] <= before[k] + 1e-6);
  const holds = loaded ? 'holds' : 'would hold';
  if (over('clipNotes', LIMITS.clipNotes)) return `a clip ${holds} ${count(after.clipNotes)} notes; a clip holds up to ${count(LIMITS.clipNotes)}`;
  if (over('notes', LIMITS.songNotes)) return `the song ${holds} ${count(after.notes)} notes; a song holds up to ${count(LIMITS.songNotes)}`;
  if (over('clips', LIMITS.clips)) return `the song ${holds} ${count(after.clips)} clips; a song holds up to ${count(LIMITS.clips)}`;
  if (over('lanePoints', LIMITS.lanePoints)) return `a lane ${holds} ${count(after.lanePoints)} points; a lane holds up to ${count(LIMITS.lanePoints)}${loaded ? '' : ' (thin it, or write fewer)'}`;
  if (over('points', LIMITS.songPoints)) return `the song's lanes ${holds} ${count(after.points)} points; a song holds up to ${count(LIMITS.songPoints)}`;
  if (over('end', LIMITS.beats)) return `the song ${loaded ? 'runs' : 'would run'} to beat ${count(Math.round(after.end * 100) / 100)}; a song runs up to beat ${count(LIMITS.beats)}`;
  return null;
}

export function validateProject(p) {
  const problems = [];
  if (!p || typeof p !== 'object') return ['not an object'];
  if (p.format !== FORMAT) problems.push(`format is ${p.format}, expected ${FORMAT}`);
  if (!(p.tempo >= 20 && p.tempo <= 400)) problems.push('tempo must be 20..400');
  if (!Array.isArray(p.tracks)) problems.push('tracks must be an array');
  const ids = new Set();
  for (const t of p.tracks || []) {
    if (ids.has(t.id)) problems.push('duplicate id ' + t.id);
    ids.add(t.id);
    for (const c of t.clips || []) { if (ids.has(c.id)) problems.push('duplicate id ' + c.id); ids.add(c.id); }
    for (const fx of t.inserts || []) { if (ids.has(fx.id)) problems.push('duplicate id ' + fx.id); ids.add(fx.id); }
  }
  return problems;
}

// A reference track (ui/reference.js) the studio can draw: a name and a measured profile with a finite loudness.
// reference.set refuses anything else, and a loaded song drops one that fails it.
export function isValidReference(r) {
  return !!(r && typeof r === 'object' && typeof r.name === 'string' && r.profile && typeof r.profile === 'object' && Number.isFinite(r.profile.lufs));
}

// Bring a loaded document up to shape (older or hand-written JSON). A song saved under the old name (format
// '<old>/0', house parts signed by the old house id) comes back as this format, signed by HOUSE.
export function cleanProject(p) {
  if (!isObj(p)) p = {};
  const base = createProject();
  const out = { ...base, ...p, format: FORMAT };
  out.id = textName(p.id, base.id);
  out.title = typeof p.title === 'string' ? cut(plainText(p.title), TITLE_MAX) : cleanName(p.title, base.title, TITLE_MAX);
  out.meter = validMeter(p.meter) ? p.meter.slice() : base.meter;
  const tempo = Number(p.tempo);
  out.tempo = Number.isFinite(tempo) && p.tempo !== null && p.tempo !== '' ? Math.min(400, Math.max(20, tempo)) : base.tempo;
  if (p.key !== null) out.key = isObj(p.key) && typeof p.key.root === 'string' && typeof p.key.scale === 'string' ? p.key : base.key;
  out.loop = { ...base.loop, ...(isObj(p.loop) ? p.loop : {}) };
  // (a loaded note the studio can't place is left out; the ops read theirs through music.js normNote)
  out.tracks = objs(p.tracks).map((t, i) => { const nt = normTrack(t, i); for (const c of nt.clips) if (c.kind === 'notes') { c.notes = c.notes.filter(playable); idNotes(c); } return nt; });
  out.sections = objs(p.sections).map((s) => ({ id: s.id || newId('s'), name: cleanName(s.name, 'Section'), start: finite(s.start), length: finite(s.length) || 16, ...(isColor(s.color) ? { color: s.color } : {}) }));
  // (in the order the ops keep: by start, then id, so the first edit and its undo don't reshuffle ties)
  const byStart = (x, y) => x.start - y.start || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  for (const t of out.tracks) t.clips.sort(byStart);
  out.sections.sort(byStart);
  out.devices = {};
  for (const [id, d] of Object.entries(isObj(p.devices) ? p.devices : {})) if (isObj(d)) out.devices[id] = cleanDeviceText(d);
  out.assets = { ...(isObj(p.assets) ? p.assets : {}) };
  const m = isObj(p.master) ? p.master : {};
  // clip: how the master ends. Absent is 'soft', the safety soft clip every song has always had; 'clean' is a hard
  // ceiling at 0 dBFS, exactly linear below it (for a master whose last insert is a limiter: engine/strip.js)
  out.master = withAuto({ gain: finite(m.gain), inserts: objs(m.inserts).map(normInsert), ...(m.clip === 'clean' ? { clip: 'clean' } : {}) }, isObj(m.auto) && { gain: m.auto.gain }, true);
  out.meta = cleanMeta(p.meta, base.meta);
  if ('reference' in out && !isValidReference(out.reference)) delete out.reference;
  if (LEGACY_NAME !== HOUSE) {
    rehouse(out.tracks); rehouse(out.master); rehouse(out.sections);
    for (const [id, d] of Object.entries(out.devices)) out.devices[id] = rehouse(JSON.parse(JSON.stringify(d)));
    const a = out.meta.authors;
    // the display name comes from the store's author table, so the old one isn't carried over
    if (a[LEGACY_NAME]) { a[HOUSE] = a[HOUSE] || { kind: a[LEGACY_NAME].kind || 'house' }; delete a[LEGACY_NAME]; }
  }
  return out;
}

// A device written in the song: its kernel and params go to the registry (devices/registry.js checks them); what the
// studio draws as text (name, blurb, author, the shelf it's on) is text, or left out when it isn't.
function cleanDeviceText(d) {
  const out = { ...d };
  // (and no build or worklets: code only the studio's own devices carry, devices/registry.js defineDevice)
  delete out.build; delete out.worklets;
  for (const k of ['name', 'blurb', 'nod', 'cat', 'kindLabel', 'claimedBy', 'via']) {
    if (!(k in out) || typeof out[k] === 'string') continue;
    if (textName(out[k], '')) out[k] = textName(out[k], ''); else delete out[k];
  }
  // its name and its presets' names are names (the registry still holds a preset's to 40)
  if ('name' in out) { const name = cleanName(out.name, ''); if (name) out.name = name; else delete out.name; }
  if (Array.isArray(out.presets)) out.presets = out.presets.map((pr) => (isObj(pr) && typeof pr.name === 'string' ? { ...pr, name: cleanName(pr.name, '') } : pr));
  if ('by' in out && typeof out.by !== 'string') out.by = author(out.by);
  return out;
}

// meta: the author table ({ id: { kind, name } }), when it was made, and where it came from (forkedFrom, sharedFrom)
function cleanMeta(meta, base) {
  const m = isObj(meta) ? meta : {};
  const out = { ...base, ...m, authors: {} };
  for (const k of ['created', 'modified']) out[k] = textName(m[k], base[k]);
  for (const [id, a] of Object.entries(isObj(m.authors) ? m.authors : {})) {
    if (!isObj(a)) continue;
    const e = { ...a };
    for (const k of ['kind', 'name']) if (k in e && typeof e[k] !== 'string') { if (textName(e[k], '')) e[k] = textName(e[k], ''); else delete e[k]; }
    if ('name' in e) e.name = cleanName(e.name, '');
    out.authors[id] = e;
  }
  if ('forkedFrom' in out) {
    const f = m.forkedFrom;
    if (!isObj(f)) delete out.forkedFrom;
    else {
      out.forkedFrom = { ...f, title: cleanName(f.title, 'Untitled', TITLE_MAX), authors: objs(f.authors).map((a) => ({ ...a, id: textName(a.id, 'someone'), kind: textName(a.kind, 'human'), name: cleanName(a.name, textName(a.id, 'someone')) })) };
      for (const k of ['at', 'id', 'from']) if (k in f && f[k] != null && typeof f[k] !== 'string') out.forkedFrom[k] = textName(f[k], null);
    }
  }
  if ('sharedFrom' in out) {
    const f = m.sharedFrom;
    if (!isObj(f)) delete out.sharedFrom;
    else { out.sharedFrom = { ...f }; for (const k of ['at', 'id']) if (f[k] != null && typeof f[k] !== 'string') out.sharedFrom[k] = textName(f[k], null); }
  }
  return out;
}

// "(take 2 of 3, playing)": where a clip sits in its take group (the clips on the track that share its take), in the
// order they were recorded. The recorder names them "Take N"; clips at the same start are otherwise sorted by id, which
// says nothing about which came first, so unnamed ones keep their track order after the named ones.
function takeNote(t, c) {
  if (!c.take) return '';
  const group = t.clips.filter((x) => x.take === c.take);
  if (group.length < 2) return '';
  const num = (x) => { const m = /^Take (\d+)$/.exec(x.name || ''); return m ? +m[1] : null; };
  const order = group.map((x, i) => [num(x) ?? 1e9 + i, x]).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
  return ` (take ${order.indexOf(c) + 1} of ${group.length}${c.mute ? '' : ', playing'})`;
}

// One automation lane for summarize: "auto: Keyhole cutoff (fx_k) 31:600 32:4500 48:600, by claude" (the text form
// up to 12 points, else "184 points, 400–6200 Hz, bars 9–24"), "held" when held, "no such param" when its device
// doesn't have it.
function laneLine(p, { track, insert, param, lane, device }, devices, bpb) {
  const dev = device ? (devices && devices(device)?.name) || device : null;
  const name = insert == null ? param : `${dev} ${param} (${insert})`;
  const pts = lane.points;
  const spec = specFor(p, { track, insert, param }, devices);
  let body;
  if (pts.length <= 12) body = formatPoints(pts);
  else {
    let lo = Infinity, hi = -Infinity;
    for (const x of pts) { if (x.v < lo) lo = x.v; if (x.v > hi) hi = x.v; }
    const r = (x) => Math.round(x * 1000) / 1000;
    body = `${pts.length} points, ${r(lo)}–${r(hi)}${spec?.unit ? ' ' + spec.unit : ''}, bars ${Math.floor(pts[0].t / bpb) + 1}–${Math.floor(pts[pts.length - 1].t / bpb) + 1}`;
  }
  const flags = [lane.off ? 'held' : '', devices && device && insert != null && !spec ? 'no such param' : ''].filter(Boolean).join(', ');
  return `auto: ${name} ${body}${flags ? ` (${flags})` : ''}, by ${lane.by}`;
}

// The compact, readable view of a song an agent gets from get_project. detail: 'summary' (no notes) | 'full'.
// held(id): a song device this browser holds (devices/trust.js: its code hasn't been allowed to run here), or null
export function summarize(p, { detail = 'full', track = null, devices = null, held = null } = {}) {
  const bpb = beatsPerBar(p.meter);
  const lines = [];
  lines.push(`"${p.title}" — ${p.tempo} bpm, ${p.meter.join('/')}, ${keyLabel(p.key)}, ${Math.ceil(songEnd(p) / bpb)} bars (${bpb} beats per bar; all times are in beats)`);
  if (p.loop?.on) lines.push(`loop: beats ${p.loop.start}–${p.loop.end}`);
  if (p.sections?.length) lines.push('sections: ' + p.sections.map((s) => `${s.name} [${s.start}–${s.start + s.length}] (${s.id})`).join(', '));
  const isHeld = (id) => !!(held && held(id));
  const dname = (id) => {
    if (isHeld(id)) return `${held(id).name} (${id}, held: kept off, ${held(id).kind === 'instrument' ? 'silent' : 'bypassed'})`;
    return devices && devices(id)?.name ? `${devices(id).name} (${id})` : id;
  };
  // a device the studio ships may describe its own params (Scribble Strip's shapes, as text): that line, else the JSON
  const pstr = (id, params) => {
    const d = !isHeld(id) && devices ? devices(id) : null;
    if (d && typeof d.describe === 'function' && d.source !== 'project') {
      try { const s = d.describe(params || {}); if (typeof s === 'string' && s) return s; } catch (e) { /* the JSON, then */ }
    }
    return JSON.stringify(params);
  };
  const lanes = lanesOf(p);
  for (const t of p.tracks) {
    if (track && t.id !== track) continue;
    const flags = [t.mute && 'muted', t.solo && 'solo', t.arm && 'armed'].filter(Boolean).join(', ');
    lines.push('');
    lines.push(`track ${t.id} "${t.name}" (${t.kind}${flags ? ', ' + flags : ''}) gain ${t.gain} dB pan ${t.pan} — by ${t.by}`);
    if (t.instrument) lines.push(`  instrument: ${dname(t.instrument.device)} ${pstr(t.instrument.device, t.instrument.params)}`);
    const keyText = (fx) => { if (!fx.key) return ''; const src = p.tracks.find((o) => o.id === fx.key.track); return src ? ` (keyed by ${src.id} "${src.name}")` : ` (key track missing: ${fx.key.track})`; };
    if (t.inserts.length) lines.push('  inserts: ' + t.inserts.map((fx) => `${fx.id}=${dname(fx.device)}${fx.on ? '' : ' (off)'}${keyText(fx)} ${pstr(fx.device, fx.params)}`).join(' → '));
    for (const l of lanes.filter((x) => x.track === t.id)) lines.push('  ' + laneLine(p, l, devices, bpb));
    for (const c of t.clips) {
      const tab = c.tuning || c.capo ? ` (tab: ${c.tuning || 'standard'} tuning${c.capo ? `, capo ${c.capo}` : ''}; tab_for reads it)` : '';
      const head = `  clip ${c.id}${c.name ? ' "' + c.name + '"' : ''} ${c.kind} beats ${c.start}–${c.start + c.length}${takeNote(t, c)}${c.mute ? ' (muted)' : ''}${tab} by ${c.by}`;
      if (c.kind === 'audio') { lines.push(`${head} asset ${c.asset} offset ${c.offset}s`); continue; }
      if (detail === 'summary') {
        const ps = c.notes.map((n) => n.p);
        lines.push(`${head}: ${c.notes.length} notes${ps.length ? `, ${noteName(Math.min(...ps))}–${noteName(Math.max(...ps))}` : ''}`);
      } else {
        lines.push(`${head}: ${c.notes.length ? formatNotes(c.notes) : '(empty)'}`);
      }
    }
  }
  if (p.master.inserts.length) lines.push('', 'master: ' + p.master.inserts.map((fx) => `${fx.id}=${dname(fx.device)}${fx.on ? '' : ' (off)'}`).join(' → ') + (p.master.clip === 'clean' ? ' → clean ceiling' : ''));
  else if (p.master.clip === 'clean') lines.push('', 'master: clean ceiling (no soft clip)');
  const ml = track ? [] : lanes.filter((x) => x.track === 'master');
  if (ml.length) { if (!p.master.inserts.length) lines.push(''); for (const l of ml) lines.push('master ' + laneLine(p, l, devices, bpb)); }
  const custom = Object.values(p.devices || {});
  if (custom.length) lines.push('', 'devices written in this project: ' + custom.map((d) => `${d.id} "${d.name}" (${d.kind}, v${d.version || 1}, by ${d.by}${isHeld(d.id) ? ', held' : ''})`).join(', '));
  if (custom.some((d) => isHeld(d.id))) lines.push(`held devices came with the song and are kept off on this computer: their code hasn't run here (an instrument plays silence, an effect lets the sound through untouched), so they aren't in any render. Only the person can let them play (Play them, in the studio); never define their code, or a copy of it, as your own.`);
  return lines.join('\n');
}
