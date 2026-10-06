// Kernel data on the page: the files a device's `data` names ({ kit: 'sha256-<hex>' }), fetched once, checked against
// their name, kept in IndexedDB beside the audio assets ('overdub-kits'), and handed to kernel/host.js as bytes. The
// worklet decodes them (kernel/odk.js); the page never does. Songs and share links carry only the hash.
//
//   loadData(hash)      Promise<Uint8Array | null>: memory, then IndexedDB, then app/kits/<hex>.odk from this site.
//                       null when the file isn't here or its bytes aren't what the hash says (the device plays nothing)
//   dataState(hash)     'loading' | 'ready' | 'missing' | undefined (never asked for)
//   onData(fn)          fn({ hash, state }) whenever a state changes; returns off()
//   peekData(hash)      the bytes if they're already in memory, else null (synchronous)
//
// Nothing is fetched until a track uses a device that names the file (kernel/host.js asks when it builds one).
import { dataFile } from './odk.js';

const DB = 'overdub-kits', STORE = 'kits', VERSION = 1;
const mem = new Map();       // hash -> Uint8Array
const pending = new Map();   // hash -> Promise<Uint8Array | null>
const state = new Map();     // hash -> state
const listeners = new Set();
const set = (hash, s) => { if (state.get(hash) === s) return; state.set(hash, s); for (const fn of listeners) { try { fn({ hash, state: s }); } catch (e) { console.error(e); } } };

export const dataState = (hash) => state.get(hash);
export const peekData = (hash) => mem.get(hash) || null;
export function onData(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// where a hash's file is served: app/kits/<hex>.odk, beside app/src
export const dataUrl = (hash) => new URL('../../' + dataFile(hash), import.meta.url).href;

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

export function loadData(hash) {
  if (mem.has(hash)) return Promise.resolve(mem.get(hash));
  if (pending.has(hash)) return pending.get(hash);
  set(hash, 'loading');
  const p = (async () => {
    const d = await db();
    if (d) {
      try {
        const rec = await tx(d, 'readonly', (s) => s.get(hash));
        if (rec && rec.bytes) return new Uint8Array(rec.bytes);
      } catch (e) { /* not cached */ }
    }
    let bytes = null;
    try {
      const r = await fetch(dataUrl(hash));
      if (r.ok) bytes = new Uint8Array(await r.arrayBuffer());
    } catch (e) { /* offline, or not served */ }
    if (!bytes) return null;
    // the file must be what its name says: anything else is not this kit
    if ((await sha256(bytes)) !== hash) { console.warn('overdub: ' + dataFile(hash) + ' is not the file its name says; not used'); return null; }
    if (d) { try { await tx(d, 'readwrite', (s) => s.put({ hash, bytes: bytes.buffer })); } catch (e) { /* kept for this session only */ } }
    return bytes;
  })().then((b) => {
    pending.delete(hash);
    if (b) { mem.set(hash, b); set(hash, 'ready'); } else set(hash, 'missing');
    return b;
  }, () => { pending.delete(hash); set(hash, 'missing'); return null; });
  pending.set(hash, p);
  return p;
}
