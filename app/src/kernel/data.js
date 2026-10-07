// Kernel data on the page: the files a device's `data` names ({ kit: 'sha256-<hex>' }), fetched once, checked against
// their name, kept in IndexedDB beside the audio assets ('overdub-kits'), and handed to kernel/host.js as bytes. The
// worklet decodes them (kernel/odk.js); the page never does. Songs and share links carry only the hash.
//
//   loadData(hash)      Promise<Uint8Array | null>: memory, then IndexedDB, then app/kits/<hex>.odkz from this site (the
//                       packed transfer, kernel/odkz.js: unpacked here), else app/kits/<hex>.odk. Either way the .odk's
//                       bytes are checked against the hash. null when neither is here or the bytes aren't what the hash
//                       says (the device plays nothing, and the console says which file was wrong)
//   dataState(hash)     'loading' | 'ready' | 'missing' | undefined (never asked for)
//   onData(fn)          fn({ hash, state }) whenever a state changes; returns off()
//   peekData(hash)      the bytes if they're already in memory, else null (synchronous)
//
// Nothing is fetched until a track uses a device that names the file (kernel/host.js asks when it builds one).
import { dataFile } from './odk.js';
import { isPacked, unpackOdk } from './odkz.js';

const DB = 'overdub-kits', STORE = 'kits', VERSION = 1;
const mem = new Map();       // hash -> Uint8Array
const pending = new Map();   // hash -> Promise<Uint8Array | null>
const state = new Map();     // hash -> state
const listeners = new Set();
const set = (hash, s) => { if (state.get(hash) === s) return; state.set(hash, s); for (const fn of listeners) { try { fn({ hash, state: s }); } catch (e) { console.error(e); } } };

export const dataState = (hash) => state.get(hash);
export const peekData = (hash) => mem.get(hash) || null;
export function onData(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// where a hash's file is served: app/kits/<hex>.odk, beside app/src (and its packed twin, <hex>.odkz)
export const dataUrl = (hash) => new URL('../../' + dataFile(hash), import.meta.url).href;
export const packedUrl = (hash) => dataUrl(hash) + 'z';

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const rq = indexedDB.open(DB, VERSION);
      rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'hash' }); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbp;
}
function tx(d, mode, fn) {
  return new Promise((resolve, reject) => {
    try {
      const t = d.transaction(STORE, mode), rq = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(rq ? rq.result : undefined);
      t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    } catch (e) { reject(e); }
  });
}

async function sha256(bytes) {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) return null;
  const h = new Uint8Array(await s.digest('SHA-256', bytes));
  let x = 'sha256-';
  for (const b of h) x += b.toString(16).padStart(2, '0');
  return x;
}

// the .odk a fetched or cached record holds: packed ones are unpacked; null when it isn't the file the hash names
async function odkOf(hash, bytes, what) {
  let odk = bytes;
  if (isPacked(bytes)) {
    try { odk = unpackOdk(bytes); } catch (e) { console.warn(`overdub: ${what} for ${hash.slice(0, 19)}... can't be unpacked (${e.message}); not used`); return null; }
  }
  if ((await sha256(odk)) !== hash) { console.warn(`overdub: ${what} is not the file its name says (its SHA-256 isn't ${hash.slice(0, 19)}...); not used`); return null; }
  return odk;
}

async function fetchBytes(url) {
  try {
    const r = await fetch(url);
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
  } catch (e) { /* offline, or not served */ }
  return null;
}

export function loadData(hash) {
  if (mem.has(hash)) return Promise.resolve(mem.get(hash));
  if (pending.has(hash)) return pending.get(hash);
  set(hash, 'loading');
  const p = (async () => {
    const d = await db();
    if (d) {
      try {
        const rec = await tx(d, 'readonly', (s) => s.get(hash));
        // (a packed record is unpacked and checked again; a plain one, as every earlier visit kept it, is used as is)
        if (rec && rec.bytes) {
          const b = new Uint8Array(rec.bytes);
          const odk = isPacked(b) ? await odkOf(hash, b, 'the cached copy') : b;
          if (odk) return odk;
        }
      } catch (e) { /* not cached */ }
    }
    // the packed file first (about two thirds of the transfer), then the plain one; each must rebuild to the hash
    const file = dataFile(hash);
    let keep = null, odk = null;
    const packed = await fetchBytes(packedUrl(hash));
    if (packed) { odk = await odkOf(hash, packed, file + 'z'); if (odk) keep = packed; }
    if (!odk) {
      const plain = await fetchBytes(dataUrl(hash));
      if (plain) { odk = await odkOf(hash, plain, file); if (odk) keep = plain; }
    }
    if (!odk) return null;
    // IndexedDB keeps what came over the wire: the packed bytes are about 3.4 times smaller (Safari's quota)
    if (d) { try { await tx(d, 'readwrite', (s) => s.put({ hash, bytes: keep.buffer.slice(keep.byteOffset, keep.byteOffset + keep.byteLength) })); } catch (e) { /* kept for this session only */ } }
    return odk;
  })().then((b) => {
    pending.delete(hash);
    if (b) { mem.set(hash, b); set(hash, 'ready'); } else set(hash, 'missing');
    return b;
  }, () => { pending.delete(hash); set(hash, 'missing'); return null; });
  pending.set(hash, p);
  return p;
}
