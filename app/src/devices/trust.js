// Which song devices this browser runs. A song's devices are kernels: code from whoever made the song, which runs in the
// AudioWorklet on this computer as soon as it plays. A song device runs here only when its kernel is trusted; one that
// isn't is held: not registered, an instrument plays silence and an effect lets the sound through untouched
// (engine/strip.js), and nothing compiles, checks or renders its code until the person lets it play (ui/share.js:
// Play them). docs/ARCHITECTURE.md ("Who runs a song's code") is the contract.
//
// Trust is per browser, and by code: the SHA-256 of a kernel's source (its UTF-8 bytes), so the same code is trusted
// whatever id, name or song it comes under, and a changed byte is new code. Trusted without asking:
//   - the studio's own kernels (the built-ins and the house shelf: `shipped`), and every device in a song it ships
//     (Night Shift's three, and any demo song's): those hashes are worked out here, never stored;
//   - kernels this browser wrote or took in: what the person's own agents define (define_device, in the page or over
//     MCP), a device file the person imports, and any device.define this page dispatches (main.js);
//   - once, on the first run of this version, every device in the songs this browser had kept (they were already
//     running): `migrate`; and, for the same reason, the devices of a link this browser made before then (main.js
//     trustOwnLink, by `since`).
// Everything else that arrives in a song (a share link, a song file) is held until the person allows it, and Play them
// trusts those hashes here for good: reopening the song doesn't ask again.
//
//   sha256(text | bytes) -> hex           SHA-256, synchronous and in plain JS (node:crypto gives the same digest)
//   kernelHash(source) -> hex | null      the hash a kernel is trusted by (memoised)
//   createTrust({ storage, shipped }) -> trust
//     trust.has(hash) / trust.trusts(source)   is it trusted here?
//     trust.allow(sources | hashes) -> n       trust them from now on (stored); n: how many were new
//     trust.migrate(songs) -> { ran, added }   the one-time migration: the first time (the key isn't there yet) every
//                                              kernel in these songs is trusted and the key is written; after that,
//                                              nothing
//     trust.allowForNow(sources | hashes) -> n  trust them for this page load only (never stored: a reload holds them
//                                              again); the community shelf's Try, unticked
//     trust.forNow(hash)                       is it trusted for this page load only (not stored, not shipped)?
//     trust.forget(sources | hashes) -> n      trust them no more (stored and this page load's); n: how many were
//                                              stored. A shipped kernel can't be forgotten
//     trust.reload()                           read the stored set again (another tab changed it)
//     trust.size, trust.stored                 how many are stored; whether the store is there (storage can be blocked)
//     trust.since                              when this browser's set began (ms; the migration's moment), or null: a
//                                              link this browser made before then was made while every device ran here
//   heldIn(song, isTrusted) -> [Held]      the song's devices whose kernels aren't trusted, with where they play
//     Held = { id, name, kind, cat, blurb, by, via?, claimedBy?, hash, version, params, look, uses: [{ track, trackId, slot }] }
//
// Storage: localStorage 'overdub:trusted-kernels' = { "sha256": ["<64 hex>", ...], "since": <ms> }, hashes oldest
// first, at most TRUST_MAX (the oldest go first past that); since: when the set began. A new field can carry another
// algorithm one day; older readers skip it.

export const TRUST_KEY = 'overdub:trusted-kernels';
export const TRUST_MAX = 2000;

/* ---------------------------------------------------------------- SHA-256 */
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Int32Array(64);

export function sha256(input) {
  const msg = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const n = msg.length;
  const total = (((n + 8) >> 6) + 1) << 6;   // the message, 0x80, zeros, then its length in bits (64-bit, big-endian)
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(n / 0x20000000));
  dv.setUint32(total - 4, (n * 8) >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85 | 0, h2 = 0x3c6ef372, h3 = 0xa54ff53a | 0, h4 = 0x510e527f, h5 = 0x9b05688c | 0, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

// The same few kernels are asked about on every change that touches devices: keep the last ones' hashes. (A kernel can
// be 256 KB, so the memo is small.)
const MEMO = new Map();
const MEMO_MAX = 64;
export function kernelHash(source) {
  if (typeof source !== 'string') return null;
  let h = MEMO.get(source);
  if (h) return h;
  h = sha256(source);
  MEMO.set(source, h);
  if (MEMO.size > MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
  return h;
}
const HEX64 = /^[0-9a-f]{64}$/;
const asHash = (x) => (typeof x === 'string' && HEX64.test(x) ? x : kernelHash(x));

/* ---------------------------------------------------------------- the trusted set */
function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

// shipped: () => iterable of kernel sources the studio itself ships (asked once, the first time a hash isn't stored)
export function createTrust({ storage = defaultStorage(), shipped = () => [], now = () => Date.now() } = {}) {
  let list = null;            // the stored hashes, oldest first
  let set = null;
  let present = false;        // the key was there when last read (the migration has run)
  let since = null;           // when the set began
  let ship = null;            // the studio's own: worked out once, never stored
  const now1 = new Set();     // trusted for this page load only (allowForNow): never stored
  const read = () => {
    list = []; present = false; since = null;
    try {
      const raw = storage ? storage.getItem(TRUST_KEY) : null;
      if (raw != null) {
        present = true;
        const v = JSON.parse(raw);
        if (v && Array.isArray(v.sha256)) list = v.sha256.filter((x) => typeof x === 'string' && HEX64.test(x));
        if (v && Number.isFinite(v.since)) since = v.since;
      }
    } catch (e) { /* blocked, or not ours: start empty */ }
    set = new Set(list);
  };
  const write = () => {
    if (list.length > TRUST_MAX) { list = list.slice(list.length - TRUST_MAX); set = new Set(list); }
    try {
      if (!storage) return false;
      // (another tab may have added some since: keep theirs too)
      let theirs = [];
      try { const v = JSON.parse(storage.getItem(TRUST_KEY) || 'null'); if (v && Array.isArray(v.sha256)) theirs = v.sha256.filter((x) => typeof x === 'string' && HEX64.test(x) && !set.has(x)); } catch (e) { /* ours win */ }
      if (theirs.length) { list = [...theirs, ...list].slice(-TRUST_MAX); set = new Set(list); }
      if (since == null) since = now();
      storage.setItem(TRUST_KEY, JSON.stringify({ sha256: list, since }));
      present = true;
      return true;
    } catch (e) { return false; }   // full or blocked: trusted for this session only
  };
  const shippedSet = () => {
    if (!ship) {
      ship = new Set();
      try { for (const src of shipped() || []) { const h = kernelHash(src); if (h) ship.add(h); } } catch (e) { console.warn('overdub: the shipped kernels could not be listed', e); }
    }
    return ship;
  };
  read();
  const trust = {
    key: TRUST_KEY,
    has(hash) {
      if (!hash) return false;
      if (set.has(hash) || now1.has(hash)) return true;
      return shippedSet().has(hash);
    },
    trusts(source) { return trust.has(kernelHash(source)); },
    shipped(hash) { return shippedSet().has(hash); },
    allow(items) {
      let added = 0;
      for (const x of Array.isArray(items) ? items : [items]) {
        const h = asHash(x);
        if (!h || set.has(h) || shippedSet().has(h)) continue;
        set.add(h); list.push(h); added++;
      }
      if (added) write();
      return added;
    },
    allowForNow(items) {
      let added = 0;
      for (const x of Array.isArray(items) ? items : [items]) {
        const h = asHash(x);
        if (!h || set.has(h) || now1.has(h) || shippedSet().has(h)) continue;
        now1.add(h); added++;
      }
      return added;
    },
    forNow: (hash) => !!hash && now1.has(hash) && !set.has(hash),
    forget(items) {
      const gone = new Set();
      for (const x of Array.isArray(items) ? items : [items]) { const h = asHash(x); if (h) { now1.delete(h); if (set.has(h)) gone.add(h); } }
      if (!gone.size) return 0;
      // (re-read first, so another tab's additions since aren't lost when this writes)
      read();
      list = list.filter((h) => !gone.has(h)); set = new Set(list);
      try { if (storage) storage.setItem(TRUST_KEY, JSON.stringify({ sha256: list, since: since ?? now() })); } catch (e) { /* blocked: this session only */ }
      return gone.size;
    },
    migrate(songs) {
      if (present) return { ran: false, added: 0 };
      const all = [];
      for (const s of songs || []) {
        const devs = s && s.devices && typeof s.devices === 'object' && !Array.isArray(s.devices) ? s.devices : {};
        for (const d of Object.values(devs)) if (d && typeof d.kernel === 'string') all.push(d.kernel);
      }
      let added = 0;
      for (const src of all) { const h = kernelHash(src); if (h && !set.has(h) && !shippedSet().has(h)) { set.add(h); list.push(h); added++; } }
      write();   // the key itself says the migration ran (an empty set too)
      return { ran: true, added };
    },
    reload() { read(); },
    get size() { return list.length; },
    get stored() { return present; },
    get since() { return since; },
    list: () => list.slice(),
  };
  return trust;
}

/* ---------------------------------------------------------------- what a song holds */
// Where a device plays in a song: [{ track, trackId, slot: 'instrument' | <insert id> }] (the master as 'Master')
export function usesOf(song, id) {
  const out = [];
  for (const t of Array.isArray(song?.tracks) ? song.tracks : []) {
    if (!t) continue;
    if (t.instrument && t.instrument.device === id) out.push({ track: t.name, trackId: t.id, slot: 'instrument' });
    for (const fx of Array.isArray(t.inserts) ? t.inserts : []) if (fx && fx.device === id) out.push({ track: t.name, trackId: t.id, slot: fx.id });
  }
  for (const fx of Array.isArray(song?.master?.inserts) ? song.master.inserts : []) if (fx && fx.device === id) out.push({ track: 'Master', trackId: 'master', slot: fx.id });
  return out;
}

export function heldIn(song, isTrusted) {
  const devs = song && song.devices && typeof song.devices === 'object' && !Array.isArray(song.devices) ? song.devices : {};
  const out = [];
  for (const [key, d] of Object.entries(devs)) {
    if (!d || typeof d !== 'object' || typeof d.kernel !== 'string') continue;
    const hash = kernelHash(d.kernel);
    if (isTrusted(hash)) continue;
    const id = String(d.id || key);
    const text = (v) => (typeof v === 'string' ? v : '');
    const h = { id, name: text(d.name) || id, kind: d.kind === 'instrument' ? 'instrument' : 'effect', cat: text(d.cat), blurb: text(d.blurb), by: text(d.by) || null, hash, version: d.version || 1,
      params: Array.isArray(d.params) ? d.params : [], look: d.look && typeof d.look === 'object' ? d.look : {}, uses: usesOf(song, id) };
    if (text(d.via)) h.via = d.via;
    if (text(d.claimedBy)) h.claimedBy = d.claimedBy;
    out.push(h);
  }
  return out;
}
