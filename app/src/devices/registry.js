// The device registry: every instrument and effect Overdub can put on a track, built in or written by you and your
// agent. docs/ARCHITECTURE.md ("Devices") is the contract; docs/DEVICES.md is the authoring guide.
//
//   defineDevice(def)            register (or, for project devices, re-register a new version of) a device
//   getDevice(id)                the normalised def, or null
//   listDevices({ kind, cat, q }) defs, in registration order
//   instantiate(c, id, opts)     a live Instance on AudioContext/OfflineAudioContext `c` (see Instance below)
//   onDevices(fn)                called with { type: 'define' | 'remove', def } whenever the registry changes
//   removeDevice(id)             a project device left the song: put back the def it shadowed (a library or built-in
//                                device of the same id), or drop the id. Only project devices (source 'project') go.
//   shadowedDevice(id)           the def a project device is standing in front of, or null
//   holdDevices([Held])          the song's devices this browser holds (devices/trust.js heldIn; main.js keeps it in
//                                step with the song): their code came with the song and hasn't been allowed to run
//                                here. A held device is never registered; listeners get { type: 'held' } when the set
//                                changes
//   heldDevice(id) / heldDevices()   one held device's info ({ id, name, kind, by, via?, hash, uses, ... }) or null / all
//   presetParams(def, name)      a preset's full params by name (any case), or null: what instrument.set (or
//                                insert.set) takes as `params` to apply it
//   presetOf(def, stored)        the preset { name, params } these stored params are exactly, or null
//   normPresets(id, presets, params)   the presets field checked and filled in (defineDevice does this)
//
// Presets: def.presets = [{ name, params: { key: value }, blurb?, tags? }] (an optional field: older readers skip it).
// A preset names a sound ("Felt", "Gospel"); its params are filled in from the defaults, clamped to their ranges and
// snapped to their steps, and a switch may be given by its label ('NYLON') as well as its index. Up to 24 per device
// (64 for a built-in), names unique. tags: words from PRESET_TAGS ('bass-music', 'growl', ...), what a genre filter and
// list_devices({ tag }) find it by.
// Keys: def.key = true marks an effect that hears a key input beside its own (a sidechain: t.key in its kernel).
//
//   presetsTagged(tag)           [{ def, preset }] for every preset tagged `tag`, in registration order
//
// Two flavours share one Instance interface:
//   graph devices  (def.build)  trusted, built in: a Web Audio node graph (the ported pedals and amps). devices/graph.js
//   kernel devices (def.kernel) a source string of pure DSP that runs inside an AudioWorklet: no DOM, no network, no
//                               clock, seeded randomness only. This is what agents and players write. kernel/host.js
//
// Ids are forever: songs name them. Built-ins are namespaced ('core.poly', 'pedal.clamwah', 'amp.punk'); project
// devices (written in a session, stored in project.devices) are '<author>.<slug>' ('claude.tidal-verb').

import { normData } from '../kernel/odk.js';

const DEFS = new Map();
const LIST = [];
const listeners = new Set();
// id -> the def a project device replaced (a song can define a device under a library or built-in id). Kept until the
// project device leaves the song, then put back, so a song's kernel never outlives the song (main.js syncs this).
const SHADOWED = new Map();

export const DEVICE_KINDS = ['instrument', 'effect'];
// Library categories, in browser order. Instruments first, then effects roughly in signal-chain order.
export const DEVICE_CATS = [
  ['synth', 'Synths'], ['keys', 'Keys'], ['drums', 'Drums'], ['bass', 'Bass'], ['pluck', 'Plucked'], ['sampler', 'Samplers'],
  ['dynamics', 'Dynamics'], ['eq', 'EQ'], ['filter', 'Filter & wah'], ['pitch', 'Pitch'], ['drive', 'Drive'], ['fuzz', 'Fuzz'],
  ['amp', 'Amps'], ['mod', 'Modulation'], ['time', 'Delay'], ['ambient', 'Reverb & ambient'], ['glitch', 'Glitch'],
  ['utility', 'Utility'], ['other', 'Other'],
];

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
// A song's or an agent's device keeps up to PRESETS_MAX presets; a built-in (the studio's own, by 'overdub') up to
// PRESETS_MAX_BUILTIN, so one synth can carry a genre's worth of sounds.
export const PRESETS_MAX = 24;
export const PRESETS_MAX_BUILTIN = 64;
// The words a preset may be tagged with (preset.tags), so the browser and an agent can find sounds by genre and role.
// Only these: a list that grows when a genre needs a word, never a free-for-all.
export const PRESET_TAGS = Object.freeze(['bass-music', 'dubstep', 'riddim', 'dnb', 'melodic', 'sub', 'growl', 'reese', 'wobble', 'stab', 'lead', 'chords', 'fx', 'drums', 'bus', 'master', 'pump']);

// The presets field, checked and normalised against the device's (normalised) params. Throws with a message an
// agent can act on; returns [] when there are none. max: how many it may hold (PRESETS_MAX unless a built-in's).
export function normPresets(id, presets, params, max = PRESETS_MAX) {
  if (presets == null) return [];
  if (!Array.isArray(presets)) throw new Error(`defineDevice ${id}: presets must be an array of { name, params }`);
  if (presets.length > max) throw new Error(`defineDevice ${id}: ${presets.length} presets; a device keeps up to ${max}`);
  const byKey = new Map(params.map((p) => [p.key, p]));
  const seen = new Set();
  return presets.map((pr, i) => {
    const name = pr && typeof pr.name === 'string' ? pr.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 40) throw new Error(`defineDevice ${id}: preset ${i + 1} needs a name of 1-40 characters`);
    if (seen.has(name.toLowerCase())) throw new Error(`defineDevice ${id}: two presets are called "${name}"`);
    seen.add(name.toLowerCase());
    const given = (pr.params && typeof pr.params === 'object') ? pr.params : {};
    const out = {};
    for (const p of params) out[p.key] = p.def;
    for (const [k, raw] of Object.entries(given)) {
      const p = byKey.get(k);
      if (!p) throw new Error(`defineDevice ${id}: preset "${name}" sets "${k}", which is not a param (${params.map((x) => x.key).join(', ') || 'none'})`);
      let v = raw;
      if (typeof v === 'string' && p.opts) { const j = p.opts.findIndex((o) => String(o).toLowerCase() === v.toLowerCase()); v = j; }
      v = Number(v);
      if (!Number.isFinite(v) || (p.opts && v < 0)) throw new Error(`defineDevice ${id}: preset "${name}" gives ${k} ${JSON.stringify(raw)}${p.opts ? ` (one of ${p.opts.join(', ')}, or its index)` : ` (a number, ${p.min}..${p.max})`}`);
      const lo = Math.min(p.min, p.max), hi = Math.max(p.min, p.max);
      v = v < lo ? lo : v > hi ? hi : v;
      if (p.step > 0) v = p.min + Math.round((v - p.min) / p.step) * p.step;
      out[k] = v;
    }
    const o = { name, params: out };
    if (typeof pr.blurb === 'string' && pr.blurb) o.blurb = pr.blurb.slice(0, 80);
    if (pr.tags != null) {
      if (!Array.isArray(pr.tags)) throw new Error(`defineDevice ${id}: preset "${name}" tags must be a list of words (${PRESET_TAGS.join(', ')})`);
      const bad = pr.tags.filter((x) => !PRESET_TAGS.includes(x));
      if (bad.length) throw new Error(`defineDevice ${id}: preset "${name}" is tagged ${bad.map((x) => JSON.stringify(x)).join(', ')}; tags are ${PRESET_TAGS.join(', ')}`);
      if (pr.tags.length) o.tags = [...new Set(pr.tags)];
    }
    return o;
  });
}

// A param spec, normalised. Pedal-style arrays ([key, LABEL, min, max, def, step?, fmt?]) and switch objects
// ({ key, label, opts, def }) are accepted too, so the clawd-o-matic packs port without edits.
export function normParam(p) {
  if (Array.isArray(p)) { const [key, label, min, max, def, step, fmt] = p; p = { key, label, min, max, def, step, fmt }; }
  const q = { ...p };
  q.label = String(q.label || q.key).toUpperCase();
  if (q.opts) { q.min = 0; q.max = q.opts.length - 1; q.step = 1; q.def = q.def ?? 0; }
  q.min = Number(q.min ?? 0); q.max = Number(q.max ?? 1);
  q.def = Number(q.def ?? q.min);
  if (q.step == null) q.step = 0; // 0: continuous
  q.curve = q.curve || 'lin';     // 'lin' | 'log' (knob travel is logarithmic: Hz, ms)
  return q;
}

function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// Register a device. Returns the normalised def, or throws with a message an agent can act on.
export function defineDevice(def, { replace = false } = {}) {
  if (!def || typeof def !== 'object') throw new Error('defineDevice: def must be an object');
  // A song's device (a share link, a song file, define_device) is a kernel and its params: nothing else in it runs.
  // Only the studio's own code builds graph devices, so a song's build and worklets never come with it (worklets is
  // module source the graph path loads into the audio thread, past the kernel's rules and the device check).
  if (def.source === 'project' && ('build' in def || 'worklets' in def)) { def = { ...def }; delete def.build; delete def.worklets; }
  const id = String(def.id || '');
  if (!ID_RE.test(id)) throw new Error(`defineDevice: bad id "${id}" (2-64 of a-z 0-9 . _ -, starting with a letter or digit)`);
  if (!DEVICE_KINDS.includes(def.kind)) throw new Error(`defineDevice ${id}: kind must be "instrument" or "effect"`);
  if (!def.build && typeof def.kernel !== 'string') throw new Error(`defineDevice ${id}: needs build(c, kit) (graph) or kernel: "source" (kernel)`);
  const prev = DEFS.get(id);
  if (prev && !replace) {
    console.error(`defineDevice: id "${id}" is taken; the first keeps it`);
    return prev;
  }
  const params = (def.params || def.knobs || []).map(normParam);
  const keys = new Set();
  for (const p of params) {
    if (!p.key || ['id', 'on', 'uid'].includes(p.key)) throw new Error(`defineDevice ${id}: bad param key "${p.key}"`);
    if (keys.has(p.key)) throw new Error(`defineDevice ${id}: duplicate param "${p.key}"`);
    keys.add(p.key);
    if (!(p.def >= Math.min(p.min, p.max) && p.def <= Math.max(p.min, p.max))) throw new Error(`defineDevice ${id}: param ${p.key} default ${p.def} is outside ${p.min}..${p.max}`);
  }
  if ('key' in def && typeof def.key !== 'boolean') throw new Error(`defineDevice ${id}: key is true (the effect hears a key input: t.key) or left out`);
  if (def.key === true && def.kind !== 'effect') throw new Error(`defineDevice ${id}: only an effect can take a key (key: true)`);
  const builtin = (def.source || 'builtin') === 'builtin' && (def.by == null || def.by === 'overdub');
  const presets = normPresets(id, def.presets, params, builtin ? PRESETS_MAX_BUILTIN : PRESETS_MAX);
  // what the studio draws as text is text: a device file or a song is anyone's JSON, and an object where a name or a
  // blurb goes would reach the page as one (ui/dom.js h() reads a plain object as attributes)
  const text = (v, fallback) => (typeof v === 'string' && v ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback);
  const norm = {
    ...def,
    id,
    presets,
    name: text(def.name, id),
    cat: text(def.cat, def.kind === 'instrument' ? 'synth' : 'other'),
    blurb: text(def.blurb, ''),
    by: text(def.by, 'overdub'),
    params,
    look: def.look || {},
    version: prev ? (prev.version || 1) + 1 : (def.version || 1),
    // (a device with kernel data plays its files too: their hashes are in its own, so a new kit is a new device hash and
    // its stored check summary stops counting)
    hash: def.kernel ? hashStr(def.kernel + (normData(def.data) ? '\n' + JSON.stringify(normData(def.data)) : '')) : (def.hash || null),
    flavour: def.build ? 'graph' : 'kernel',
    source: def.source || 'builtin',
  };
  // kernel data (docs/DEVICES.md "Kernel data"): only { name: 'sha256-<hex>' } survives; a song carries the hash, never the file
  const data = normData(def.data);
  if (data) norm.data = data; else delete norm.data;
  for (const k of ['nod', 'kindLabel', 'claimedBy', 'via']) if (k in norm) { if (text(norm[k], '')) norm[k] = text(norm[k], ''); else delete norm[k]; }
  if (prev && prev.source !== 'project' && norm.source === 'project' && !SHADOWED.has(id)) SHADOWED.set(id, prev);
  if (!prev) LIST.push(norm); else LIST[LIST.indexOf(prev)] = norm;
  DEFS.set(id, norm);
  for (const fn of listeners) { try { fn({ type: 'define', def: norm, prev }); } catch (e) { console.error(e); } }
  return norm;
}

export function shadowedDevice(id) { return SHADOWED.get(id) || null; }

// Held: a song's devices whose code this browser hasn't allowed (devices/trust.js). They aren't in DEFS, so nothing can
// instantiate, check or render them; the engine plays a held instrument as silence and a held effect as a pass-through
// (engine/strip.js), and the studio says they're kept off. Set before the registry drops a def that became held, so the
// engine's reconcile builds the stand-in, not the fallback synth.
const HELD = new Map();
export function holdDevices(list = []) {
  const next = new Map();
  for (const d of list || []) if (d && d.id) next.set(String(d.id), d);
  const changed = next.size !== HELD.size || [...next].some(([id, d]) => HELD.get(id)?.hash !== d.hash);
  HELD.clear();
  for (const [id, d] of next) HELD.set(id, d);
  if (changed) for (const fn of listeners) { try { fn({ type: 'held', held: [...HELD.values()] }); } catch (e) { console.error(e); } }
  return changed;
}
export function heldDevice(id) { return HELD.get(String(id)) || null; }
export function heldDevices() { return [...HELD.values()]; }

// A project device is gone from the song (undo, another song loaded): restore what it shadowed, or forget the id.
// -> 'restored' | 'removed' | null (not a project device: built-ins and the library stay)
export function removeDevice(id) {
  const cur = DEFS.get(id);
  if (!cur || cur.source !== 'project') return null;
  const orig = SHADOWED.get(id);
  SHADOWED.delete(id);
  if (orig) {
    // a fresh version number, so anything keyed on id@version (the engine's strips) rebuilds with the original
    const back = { ...orig, version: (cur.version || 1) + 1 };
    LIST[LIST.indexOf(cur)] = back;
    DEFS.set(id, back);
    for (const fn of listeners) { try { fn({ type: 'define', def: back, prev: cur }); } catch (e) { console.error(e); } }
    return 'restored';
  }
  LIST.splice(LIST.indexOf(cur), 1);
  DEFS.delete(id);
  for (const fn of listeners) { try { fn({ type: 'remove', def: cur, prev: cur }); } catch (e) { console.error(e); } }
  return 'removed';
}

export function getDevice(id) { return DEFS.get(id) || null; }

export function presetParams(def, name) {
  const d = typeof def === 'string' ? getDevice(def) : def;
  if (!d || !Array.isArray(d.presets) || name == null) return null;
  const want = String(name).trim().toLowerCase();
  const pr = d.presets.find((x) => x.name.toLowerCase() === want);
  return pr ? { ...pr.params } : null;
}

// The preset a device's stored params are, or null: every param (a missing one at its default) equal to the
// preset's, to a hair of its range. What the rack names on a face and get_project tells an agent, so they agree.
export function presetOf(def, stored = {}) {
  const d = typeof def === 'string' ? getDevice(def) : def;
  if (!d || !Array.isArray(d.presets) || !d.presets.length) return null;
  const s = stored || {};
  // a switch may be stored by its label ('NYLON') as well as its index
  const num = (p, v) => (typeof v === 'string' && p.opts ? p.opts.findIndex((o) => String(o).toLowerCase() === v.toLowerCase()) : Number(v));
  return d.presets.find((pr) => d.params.every((p) => {
    const a = num(p, s[p.key] ?? p.def), b = num(p, pr.params[p.key] ?? p.def);
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(p.max - p.min));
  })) || null;
}

export function listDevices({ kind, cat, q, tag } = {}) {
  const s = q ? String(q).toLowerCase() : '';
  return LIST.filter((d) => (!kind || d.kind === kind) && (!cat || d.cat === cat) &&
    (!tag || (d.presets || []).some((pr) => pr.tags && pr.tags.includes(tag))) &&
    (!s || (d.id + ' ' + d.name + ' ' + d.blurb + ' ' + (d.nod || '') + ' ' + (d.kindLabel || '')).toLowerCase().includes(s)));
}
export function presetsTagged(tag) {
  const out = [];
  for (const d of LIST) for (const pr of d.presets || []) if (pr.tags && pr.tags.includes(tag)) out.push({ def: d, preset: pr });
  return out;
}

export function onDevices(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Defaults for a device's params, merged with what a track stores.
export function paramValues(def, stored = {}) {
  const v = {};
  for (const p of def.params) v[p.key] = stored[p.key] ?? p.def;
  return v;
}

// A live instance. opts: { uid, seed, clock, params, on } (see docs/ARCHITECTURE.md, "Instance").
export async function instantiate(c, id, opts = {}) {
  const def = typeof id === 'string' ? getDevice(id) : id;
  if (!def) throw new Error(`instantiate: no device "${id}"`);
  if (def.build) {
    const { graphInstance } = await import('./graph.js');
    return graphInstance(c, def, opts);
  }
  const { kernelInstance } = await import('../kernel/host.js');
  return kernelInstance(c, def, opts);
}

// A seed from a uid: stable across reloads, different for a second copy of the same device.
export function seedOf(uid) { return parseInt(hashStr(String(uid)), 36) >>> 0; }
