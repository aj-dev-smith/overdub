// The community shelf's index, read (docs/COMMUNITY-SHELF.md, section 1). One reader for everyone who reads an index:
// the studio's Browser section (ui/community.js), the agent tool (agent/community-tool.js) and the site gallery. The
// index is someone else's data, read on the origin that holds the API key, so nothing in it is passed on as it came:
// every value the reader knows is copied into an object of its own, checked for type and range, cleaned and capped;
// every field it doesn't know is left behind. An index never carries kernel source, and the reader never fetches.
// Pure: no DOM, no fetch, so Node reads an index the same way.
//
//   readIndex(json, { base, bundled }) -> { format, built, repo, inputs, entries, revoked, skipped, refused, newer, error }
//       json: the index's text or parsed object; base: the index's own URL (absolute); bundled: the copy that came with
//       this studio (only it may list House entries, use claude., and revoke)
//   filterEntries(entries, { kind, cat, q, tier }) -> entries (q ranked: name and blurb above nod, request and author)
//   entryById(entries, id) -> entry | null
//   resolveUrl(x, indexUrl, { under }) -> absolute URL | null     the URL policy for clips and device files
//   indexUrlAllowed(url, { page, live }) -> absolute URL | null   where a studio may read a shelf from
//   isLocalHost(hostname), plainNumbers(measured, kind) -> words
//
// An entry: { id, name, kind, cat, blurb, nod, tier, author: { handle, alias }, agent, requester, request, license,
// sha256, parent, challenge, added, pick, look, params, presets, measured, preview, device, source, origin }.
// preview: { input, seconds, lufs, wet: [{ src, type, bytes }], dry: [{ src, type, bytes }] | null }; device: the
// device file's absolute URL; source: { path, commit, url (a link only when https on an allowed host), text };
// origin: 'bundled', or the index's URL.
//
// Ids are forever: the format string, the field names and BUNDLED_INDEX are named once and never renamed.

import { DEVICE_CATS, normParam } from './registry.js';
import { HOUSE_NS } from '../core/share.js';

export const INDEX_FORMAT = 'overdub-community-index/1';
export const BUNDLED_INDEX = '/app/community/community-index.json';
// a requester is drawn (the studio's detail, the gallery) only when it's a name or a short line; a longer one is a note
// about how the request came about, which the agent tool still returns under untrusted_text
export const ASKED_MAX = 60;
export const LIMITS = {
  jsonBytes: 2 * 1024 * 1024,
  entries: 2000,
  clipBytes: 2 * 1024 * 1024,
  deviceBytes: 300 * 1024,
};
const CAPS = {
  name: 60,
  blurb: 60,
  nod: 120,
  request: 500,
  requester: 300,
  warning: 200,
  reason: 200,
  agent: 80,
  opt: 40,
  desc: 120,
  label: 24,
  preset: 40,
  path: 200,
  summary: 160,
};
const KINDS = ['instrument', 'effect'];
const TIERS = ['community', 'house'];
const LICENSES = ['MIT-0', 'MIT', 'CC0-1.0'];
const CLIP_TYPES = ['audio/mpeg', 'audio/wav'];
const INPUTS = ['strum', 'drums', 'bass'];
const CATS = DEVICE_CATS.map(([k]) => k);
// the shapes, finishes, knobs and labels a face can draw (ui/faces.js FACE_LOOKS, the vendored PEDAL_LOOKS); listed
// here so the reader stays free of the DOM. A value outside them is dropped and the face draws its default.
export const LOOK_VALUES = {
  shape: ['box', 'wide', 'mini', 'round', 'wah', 'rack'],
  finish: ['flat', 'sparkle', 'brushed', 'hammer', 'stripe', 'check'],
  knob: ['black', 'chicken', 'cream', 'chrome', 'small'],
  label: ['script', 'block', 'plate', 'stencil'],
};
// names nobody on the shelf can take: the studio's own namespaces, and the names the studio signs with
const RESERVED_NS = /^(claude|core|pedal|amp|cab|overdub|you|guest|mcp|house)\./;
const RESERVED_HANDLES = new Set([
  'you',
  'overdub',
  'claude',
  'claude-ai',
  'anthropic',
  'house',
  'guest',
  'mcp',
  'author',
  'agent',
  'studio',
  'community',
  'shelf',
]);
const HANDLE = /^[a-z0-9][a-z0-9-]{0,38}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX = /^#[0-9a-f]{3,8}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT = /^[0-9a-f]{7,40}(\+dirty)?$/;

/* ---------------------------------------------------------------- small checks */
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
// author text: one line, control and direction characters out, capped. null when there's nothing left
export function cleanText(x, cap) {
  if (typeof x !== 'string') return null;
  let s = x
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (s.length > cap) s = s.slice(0, cap - 1).trimEnd() + '…';
  return s;
}
export const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/* ---------------------------------------------------------------- URLs */
// A clip or device file named by an index: resolved against the index, on the index's own origin, inside the index's
// own folder under `under` ('clips' or 'devices'). Anything else (../, another host, blob:, data:, javascript:) is null.
export function resolveUrl(x, indexUrl, { under } = {}) {
  if (typeof x !== 'string' || !x || x.length > 500) return null;
  if (/^\s*(blob|data|javascript|file|about|vbscript):/i.test(x) || /\\/.test(x) || /%2e|%2f|%5c/i.test(x)) return null;
  let base, u;
  try {
    base = new URL(indexUrl);
    u = new URL(x, base);
  } catch {
    return null;
  }
  if (u.origin !== base.origin || !/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const dir = base.pathname.replace(/[^/]*$/, '');
  const root = under ? `${dir}${under}/` : dir;
  if (!u.pathname.startsWith(root) || u.pathname.length <= root.length) return null;
  u.hash = '';
  return u.href;
}
// Where a studio may read a shelf from: a path on its own origin; or, while the shelf isn't live, http on localhost or
// 127.0.0.1, and only when the page itself is on a local host. -> absolute URL | null (refused before any fetch)
export function indexUrlAllowed(url, { page, live = false } = {}) {
  if (typeof url !== 'string' || !url || url.length > 1000) return null;
  if (/^\s*(blob|data|javascript|file|about|vbscript):/i.test(url)) return null;
  let p, u;
  try {
    p = new URL(page);
    u = new URL(url, p);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.origin === p.origin) return u.href;
  if (live || !isLocalHost(p.hostname)) return null;
  return u.protocol === 'http:' && isLocalHost(u.hostname) ? u.href : null;
}
// source.url becomes a link only when it's https on github.com or the repo's own host
function sourceLink(x, repo) {
  if (typeof x !== 'string') return null;
  let u;
  try {
    u = new URL(x);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  let repoHost = null;
  try {
    repoHost = repo ? new URL(repo).hostname : null;
  } catch {
    repoHost = null;
  }
  return u.hostname === 'github.com' || (repoHost && u.hostname === repoHost) ? u.href : null;
}

/* ---------------------------------------------------------------- parts of an entry */
function readClips(list, indexUrl) {
  const out = [];
  for (const c of Array.isArray(list) ? list.slice(0, 4) : []) {
    if (!isObj(c) || !CLIP_TYPES.includes(c.type)) continue;
    const src = resolveUrl(c.src, indexUrl, { under: 'clips' });
    const bytes = num(c.bytes);
    if (!src || (bytes != null && (bytes < 0 || bytes > LIMITS.clipBytes))) continue;
    out.push({ src, type: c.type, bytes: bytes == null ? null : Math.round(bytes) });
  }
  return out;
}
function readLook(L) {
  const out = {};
  if (!isObj(L)) return out;
  for (const k of ['color', 'ink', 'led']) if (typeof L[k] === 'string' && HEX.test(L[k])) out[k] = L[k];
  for (const k of Object.keys(LOOK_VALUES)) if (LOOK_VALUES[k].includes(L[k])) out[k] = L[k];
  return out;
}
function readParams(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list.slice(0, 120) : []) {
    if (!isObj(p) || typeof p.key !== 'string' || !/^[A-Za-z_][\w]{0,31}$/.test(p.key)) continue;
    const q = { key: p.key, label: cleanText(p.label, CAPS.label) || p.key.toUpperCase() };
    if (Array.isArray(p.opts)) {
      const opts = p.opts
        .slice(0, 32)
        .map((o) => cleanText(String(typeof o === 'number' ? o : (o ?? '')), CAPS.opt))
        .filter((o) => o != null);
      if (opts.length !== p.opts.length || !opts.length) continue;
      q.opts = opts;
      if (p.def != null) {
        if (num(p.def) == null) continue;
        q.def = p.def;
      }
    } else {
      for (const k of ['min', 'max', 'def', 'step'])
        if (p[k] != null) {
          if (num(p[k]) == null) {
            q.bad = true;
            break;
          }
          q[k] = p[k];
        }
      if (q.bad) continue;
      if (q.min != null && q.max != null && !(q.max > q.min)) continue;
      if (p.curve === 'log') q.curve = 'log';
      const unit = cleanText(p.unit, 8);
      if (unit) q.unit = unit;
    }
    const desc = cleanText(p.desc, CAPS.desc);
    if (desc) q.desc = desc;
    let n;
    try {
      n = normParam(q);
    } catch {
      continue;
    }
    if (![n.min, n.max, n.def].every(Number.isFinite)) continue;
    out.push({
      key: n.key,
      label: n.label,
      min: n.min,
      max: n.max,
      def: n.def,
      step: n.step,
      curve: n.curve,
      ...(n.unit ? { unit: n.unit } : {}),
      ...(n.opts ? { opts: n.opts } : {}),
      ...(n.desc ? { desc: n.desc } : {}),
    });
  }
  return out;
}
function readMeasured(m) {
  const out = {
    ok: false,
    summary: null,
    lufs: null,
    deltaLU: null,
    drumsDeltaLU: null,
    truePeak: null,
    tail: null,
    cpu: null,
    latencyMs: null,
    deterministic: null,
    warnings: [],
    houseLevels: null,
  };
  if (!isObj(m)) return null;
  if (typeof m.ok !== 'boolean') return null;
  out.ok = m.ok;
  out.summary = cleanText(m.summary, CAPS.summary);
  const range = (x, lo, hi) => {
    const v = num(x);
    return v != null && v >= lo && v <= hi ? v : null;
  };
  out.lufs = range(m.lufs, -120, 30);
  out.deltaLU = range(m.deltaLU, -120, 60);
  out.drumsDeltaLU = range(m.drumsDeltaLU, -120, 60);
  out.truePeak = range(m.truePeak, -200, 60);
  out.tail = range(m.tail, 0, 600);
  out.cpu = range(m.cpu, 0, 10000);
  out.latencyMs = range(m.latencyMs, 0, 10000);
  out.deterministic = typeof m.deterministic === 'boolean' ? m.deterministic : null;
  out.warnings = (Array.isArray(m.warnings) ? m.warnings.slice(0, 8) : [])
    .map((w) => cleanText(w, CAPS.warning))
    .filter(Boolean);
  out.houseLevels = typeof m.houseLevels === 'boolean' ? m.houseLevels : null;
  return out;
}

// One entry, or the reason it's skipped: 'newer' (a value this studio doesn't know) or 'refused' (policy).
function readEntry(e, { indexUrl, bundled, repo, inputs }) {
  if (!isObj(e)) return { skip: 'newer' };
  const id = typeof e.id === 'string' ? e.id : '';
  const [handle0, ...rest] = id.split('.');
  const slug = rest.join('.');
  if (!KINDS.includes(e.kind) || !TIERS.includes(e.tier) || !CATS.includes(e.cat)) return { skip: 'newer' };
  if (!LICENSES.includes(e.license)) return { skip: 'newer' };
  const name = cleanText(e.name, CAPS.name),
    blurb = cleanText(e.blurb, CAPS.blurb);
  if (
    !name ||
    !blurb ||
    typeof e.sha256 !== 'string' ||
    !HEX64.test(e.sha256) ||
    typeof e.added !== 'string' ||
    !DATE.test(e.added)
  )
    return { skip: 'newer' };
  if (!isObj(e.author) || typeof e.author.handle !== 'string' || !isObj(e.preview) || !isObj(e.source))
    return { skip: 'newer' };
  const measured = readMeasured(e.measured);
  if (!measured) return { skip: 'newer' };
  // names: the House tier only from the bundled copy (and only it may use claude.); otherwise <handle>.<slug>, the
  // handle the author's, neither of them reserved
  const house = e.tier === 'house';
  if (house && !bundled) return { skip: 'refused' };
  const handle = e.author.handle;
  if (!(house && bundled && /^claude\.[a-z0-9][a-z0-9-]{0,47}$/.test(id))) {
    if (!HANDLE.test(handle0) || !SLUG.test(slug) || handle0 !== handle) return { skip: 'refused' };
    if (RESERVED_HANDLES.has(handle) || RESERVED_NS.test(id) || HOUSE_NS.test(id)) return { skip: 'refused' };
  }
  const device = resolveUrl(e.device, indexUrl, { under: 'devices' });
  if (!device) return { skip: 'refused' };
  const p = e.preview;
  const input = e.kind === 'instrument' ? 'phrase' : INPUTS.includes(p.input) ? p.input : null;
  const wet = readClips(isObj(p.wet) ? p.wet.clips : null, indexUrl);
  const dry = e.kind === 'effect' && input && inputs[input] ? inputs[input].clips : null;
  const alias =
    typeof e.author.alias === 'string' && HANDLE.test(e.author.alias) && !RESERVED_HANDLES.has(e.author.alias)
      ? e.author.alias
      : null;
  const s = e.source;
  const path = cleanText(s.path, CAPS.path);
  return {
    entry: {
      id,
      name,
      kind: e.kind,
      cat: e.cat,
      blurb,
      nod: cleanText(e.nod, CAPS.nod),
      tier: e.tier,
      author: { handle, alias },
      agent: cleanText(e.agent, CAPS.agent),
      requester: cleanText(e.requester, CAPS.requester),
      request: cleanText(e.request, CAPS.request),
      license: e.license,
      sha256: e.sha256,
      parent: typeof e.parent === 'string' && HEX64.test(e.parent) ? e.parent : null,
      challenge: typeof e.challenge === 'string' && /^\d{1,4}$/.test(e.challenge) ? e.challenge : null,
      added: e.added,
      pick: Number.isInteger(e.pick) && e.pick > 0 && e.pick < 10000 ? e.pick : null,
      look: readLook(e.look),
      params: readParams(e.params),
      presets: (Array.isArray(e.presets) ? e.presets.slice(0, 24) : [])
        .map((x) => cleanText(x, CAPS.preset))
        .filter(Boolean),
      measured,
      preview: {
        input,
        seconds: num(p.seconds) != null && p.seconds > 0 && p.seconds <= 30 ? p.seconds : null,
        lufs: num(p.lufs),
        wet,
        dry: dry && dry.length ? dry : null,
      },
      device,
      source: {
        path,
        commit: typeof s.commit === 'string' && COMMIT.test(s.commit) ? s.commit : null,
        url: sourceLink(s.url, repo),
        text: path ? `${path}${typeof s.commit === 'string' && COMMIT.test(s.commit) ? ` at ${s.commit}` : ''}` : null,
      },
      origin: bundled ? 'bundled' : indexUrl,
    },
  };
}

/* ---------------------------------------------------------------- the index */
export function readIndex(json, { base, bundled = false } = {}) {
  const out = {
    format: null,
    built: null,
    repo: null,
    inputs: {},
    entries: [],
    revoked: [],
    skipped: 0,
    refused: 0,
    newer: false,
    error: null,
    origin: bundled ? 'bundled' : base || null,
  };
  let o = json;
  if (typeof json === 'string') {
    if (json.length > LIMITS.jsonBytes) {
      out.error = 'too large';
      return out;
    }
    try {
      o = JSON.parse(json);
    } catch {
      out.error = 'not JSON';
      return out;
    }
  }
  if (!isObj(o) || typeof o.format !== 'string') {
    out.error = 'not a shelf index';
    return out;
  }
  const m = /^overdub-community-index\/(\d{1,4})$/.exec(o.format);
  if (!m) {
    out.error = 'not a shelf index';
    return out;
  }
  if (Number(m[1]) !== 1) {
    out.newer = true;
    out.format = o.format;
    return out;
  }
  out.format = INDEX_FORMAT;
  let indexUrl;
  try {
    indexUrl = new URL(base || BUNDLED_INDEX, 'http://localhost/').href;
  } catch {
    out.error = 'no base';
    return out;
  }
  if (isObj(o.built)) {
    const b = {};
    for (const k of ['from', 'at', 'studio', 'node', 'checker', 'checks', 'encoder']) b[k] = cleanText(o.built[k], 80);
    out.built = b;
  }
  out.repo = typeof o.repo === 'string' && /^https:\/\//.test(o.repo) ? cleanText(o.repo, 200) : null;
  if (isObj(o.inputs))
    for (const k of INPUTS) {
      const x = o.inputs[k];
      if (!isObj(x)) continue;
      const clips = readClips(x.clips, indexUrl);
      if (clips.length) out.inputs[k] = { seconds: num(x.seconds), lufs: num(x.lufs), clips };
    }
  // a deny list is acted on only from the studio's own copy: another origin's could revoke anything
  if (bundled && Array.isArray(o.revoked)) {
    for (const r of o.revoked.slice(0, LIMITS.entries))
      if (isObj(r) && typeof r.sha256 === 'string' && HEX64.test(r.sha256))
        out.revoked.push({
          sha256: r.sha256,
          reason: cleanText(r.reason, CAPS.reason) || 'no reason given',
          at: cleanText(r.at, 40),
        });
  }
  const gone = new Set(out.revoked.map((r) => r.sha256));
  const list = Array.isArray(o.devices) ? o.devices : [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    if (i >= LIMITS.entries) {
      out.skipped += list.length - i;
      break;
    }
    const r = readEntry(list[i], { indexUrl, bundled, repo: out.repo, inputs: out.inputs });
    if (r.skip === 'newer') {
      out.skipped++;
      continue;
    }
    if (r.skip) {
      out.refused++;
      continue;
    }
    if (seen.has(r.entry.id) || gone.has(r.entry.sha256)) {
      out.refused++;
      continue;
    }
    seen.add(r.entry.id);
    out.entries.push(r.entry);
  }
  return out;
}

/* ---------------------------------------------------------------- finding */
// words people search with that name a category ("spacey" finds the reverbs, "dirty" the drives)
export const CAT_WORDS = {
  synth: ['synth', 'synths', 'lead', 'pad'],
  keys: ['keys', 'piano', 'organ', 'ep', 'rhodes'],
  drums: ['drums', 'drum', 'kit', 'beat', 'percussion'],
  bass: ['bass', 'low', 'sub'],
  pluck: ['pluck', 'plucked', 'harp', 'guitar'],
  sampler: ['sampler', 'samples'],
  dynamics: ['dynamics', 'compressor', 'comp', 'squash', 'punch', 'limiter', 'gate'],
  eq: ['eq', 'tone', 'equaliser', 'equalizer'],
  filter: ['filter', 'wah', 'sweep'],
  pitch: ['pitch', 'octave', 'shift', 'harmony'],
  drive: ['drive', 'dirty', 'dirt', 'grit', 'gritty', 'crunch', 'overdrive', 'distortion', 'saturation', 'warm'],
  fuzz: ['fuzz', 'fuzzy', 'dirty', 'buzz'],
  amp: ['amp', 'amplifier', 'cab'],
  mod: ['mod', 'modulation', 'chorus', 'flanger', 'phaser', 'tremolo', 'vibrato', 'wobble', 'wobbly', 'shimmer'],
  time: ['delay', 'echo', 'echoes', 'repeat', 'tape', 'time'],
  ambient: ['reverb', 'verb', 'space', 'spacey', 'spacious', 'ambient', 'room', 'hall', 'wash', 'big'],
  glitch: ['glitch', 'stutter', 'broken', 'chop'],
  utility: ['utility', 'tool', 'meter'],
  other: ['other'],
};
const catLabel = (c) => (DEVICE_CATS.find(([k]) => k === c) || [c, c])[1];
// lower is better; null: no match
function score(e, words) {
  const name = e.name.toLowerCase(),
    top = `${name} ${e.blurb.toLowerCase()}`;
  const cat = [e.cat, catLabel(e.cat).toLowerCase(), ...(CAT_WORDS[e.cat] || [])].join(' ');
  const low = [e.nod || '', e.request || '', e.author.handle, e.author.alias || '', e.id].join(' ').toLowerCase();
  const has = (hay, w) => hay.split(/[^a-z0-9]+/).some((x) => x.startsWith(w));
  let s = 0;
  for (const w of words) {
    if (name.startsWith(w)) s += 0;
    else if (has(name, w)) s += 1;
    else if (has(top, w)) s += 2;
    else if (has(cat, w)) s += 3;
    else if (has(low, w)) s += 4;
    else return null;
  }
  return s;
}
// The agent field is never searched: "claude" would find every device.
export function filterEntries(entries, { kind = null, cat = null, q = '', tier = null } = {}) {
  let list = (entries || []).filter(
    (e) => (!kind || e.kind === kind) && (!cat || e.cat === cat) && (!tier || e.tier === tier),
  );
  const words = String(q || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return list;
  list = list
    .map((e, i) => [score(e, words), i, e])
    .filter((x) => x[0] != null)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((x) => x[2]);
  return list;
}
export const entryById = (entries, id) => (entries || []).find((e) => e.id === id) || null;

/* ---------------------------------------------------------------- in words */
const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '+') + Math.abs(x).toFixed(1);
// What a musician needs first, the way the demo agent says it: level against the input (or loudness), how long it
// rings, how heavy it is. -> { words, figures }
export function plainNumbers(m, kind) {
  if (!m) return { words: '', figures: '' };
  const w = [];
  if (kind === 'effect' && m.deltaLU != null)
    w.push(
      Math.abs(m.deltaLU) < 0.5
        ? 'Same level as what goes in.'
        : m.deltaLU > 0
          ? `${Math.abs(m.deltaLU).toFixed(1)} LU louder than what goes in.`
          : `${Math.abs(m.deltaLU).toFixed(1)} LU quieter than what goes in.`,
    );
  if (kind === 'instrument' && m.lufs != null)
    w.push(
      m.lufs > -12
        ? 'Loud on the test phrase.'
        : m.lufs < -22
          ? 'Quiet on the test phrase.'
          : 'A usual level on the test phrase.',
    );
  if (m.tail != null) w.push(m.tail < 0.15 ? 'Stops when the sound stops.' : `Rings on ${m.tail.toFixed(1)} s.`);
  if (m.cpu != null)
    w.push(m.cpu < 2 ? 'Light on the computer.' : m.cpu < 8 ? 'Easy on the computer.' : 'Heavy on the computer.');
  const f = [];
  if (kind === 'effect' && m.deltaLU != null) f.push(`Level ${sign(m.deltaLU)} LU`);
  if (kind === 'instrument' && m.lufs != null) f.push(`${m.lufs.toFixed(1)} LUFS`);
  if (m.truePeak != null) f.push(`Peak ${m.truePeak.toFixed(1)} dBTP`);
  if (m.tail != null) f.push(`Tail ${m.tail.toFixed(1)} s`);
  if (m.cpu != null) f.push(`CPU ${m.cpu}%`);
  return { words: w.join(' '), figures: f.join(' · ') };
}
