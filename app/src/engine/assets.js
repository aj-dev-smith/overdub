// Audio assets: the samples behind audio clips (recordings, imports, renders). The project document only names them
// (project.assets[id] = { kind: 'audio', name, sr, channels, duration }); the samples live here, in IndexedDB
// ('overdub-assets'), so a song's JSON stays small. When IndexedDB is refused (private windows, file://, tests) they
// live in memory for the session.
//
//   const assets = createAssets();
//   await assets.put(id, audioBuffer | { sr, channels: [Float32Array, ...] })  -> { id, sr, channels, duration, length }
//   await assets.get(id)       -> AudioBuffer (or null if there is no such asset)
//   assets.peek(id)            -> the AudioBuffer if it is already loaded, else null (synchronous; the scheduler uses it)
//   await assets.has(id) / assets.remove(id) / assets.list() -> [{ id, sr, channels, duration }]
//
// AudioBuffers are not tied to a context (a source on a 48 kHz context plays a 44.1 kHz buffer, resampled), so one
// decoded copy serves the live context and every offline render.

const DB = 'overdub-assets',
  STORE = 'assets',
  VERSION = 1;

function openDB() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const rq = indexedDB.open(DB, VERSION);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(STORE, mode),
        s = t.objectStore(STORE);
      const rq = fn(s);
      t.oncomplete = () => resolve(rq ? rq.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (e) {
      reject(e);
    }
  });
}

function toBuffer(rec) {
  const len = rec.channels[0] ? rec.channels[0].length : 0;
  const b = new AudioBuffer({
    length: Math.max(1, len),
    numberOfChannels: Math.max(1, rec.channels.length),
    sampleRate: rec.sr,
  });
  rec.channels.forEach((ch, i) => b.copyToChannel(ch instanceof Float32Array ? ch : Float32Array.from(ch), i));
  return b;
}

function toRecord(id, data) {
  if (typeof AudioBuffer !== 'undefined' && data instanceof AudioBuffer) {
    const channels = [];
    for (let i = 0; i < data.numberOfChannels; i++) channels.push(Float32Array.from(data.getChannelData(i)));
    return { id, sr: data.sampleRate, channels };
  }
  if (!data || !Array.isArray(data.channels) || !data.channels.length)
    throw new Error('assets.put: give an AudioBuffer or { sr, channels: [Float32Array] }');
  const sr = Number(data.sr || data.sampleRate);
  if (!(sr >= 3000 && sr <= 768000)) throw new Error('assets.put: bad sample rate ' + sr);
  const n = data.channels[0].length;
  return {
    id,
    sr,
    channels: data.channels.map((c) => {
      const f = c instanceof Float32Array ? Float32Array.from(c) : Float32Array.from(c);
      if (f.length !== n) throw new Error('assets.put: channels differ in length');
      return f;
    }),
  };
}

export function createAssets() {
  const mem = new Map(); // id -> AudioBuffer (decoded, ready)
  const loading = new Map(); // id -> Promise<AudioBuffer|null>
  let dbp = null;
  const db = () => dbp || (dbp = openDB());

  const info = (id, b) => ({
    id,
    sr: b.sampleRate,
    channels: b.numberOfChannels,
    duration: b.duration,
    length: b.length,
  });

  const api = {
    get persistent() {
      return dbp ? dbp.then((d) => !!d) : Promise.resolve(false);
    },

    async put(id, data) {
      if (!id || typeof id !== 'string') throw new Error('assets.put: id must be a string');
      const rec = toRecord(id, data);
      const buf = toBuffer(rec);
      mem.set(id, buf);
      loading.delete(id);
      const d = await db();
      if (d) {
        try {
          await tx(d, 'readwrite', (s) => s.put(rec));
        } catch (e) {
          console.warn('overdub assets: could not store', id, e && e.message);
        }
      }
      return info(id, buf);
    },

    peek(id) {
      return mem.get(id) || null;
    },

    get(id) {
      if (mem.has(id)) return Promise.resolve(mem.get(id));
      if (loading.has(id)) return loading.get(id);
      const p = (async () => {
        const d = await db();
        if (!d) return null;
        try {
          const rec = await tx(d, 'readonly', (s) => s.get(id));
          if (!rec) return null;
          const b = toBuffer(rec);
          mem.set(id, b);
          return b;
        } catch (e) {
          console.warn('overdub assets: could not read', id, e && e.message);
          return null;
        }
      })();
      loading.set(id, p);
      p.then((b) => {
        if (!b) loading.delete(id);
      });
      return p;
    },

    async has(id) {
      return !!(await api.get(id));
    },

    async remove(id) {
      mem.delete(id);
      loading.delete(id);
      const d = await db();
      if (d) {
        try {
          await tx(d, 'readwrite', (s) => s.delete(id));
        } catch (e) {
          /* gone */
        }
      }
    },

    async list() {
      const out = new Map();
      for (const [id, b] of mem) out.set(id, info(id, b));
      const d = await db();
      if (d) {
        try {
          const recs = await tx(d, 'readonly', (s) => s.getAll());
          for (const r of recs || [])
            if (!out.has(r.id))
              out.set(r.id, {
                id: r.id,
                sr: r.sr,
                channels: r.channels.length,
                duration: (r.channels[0] ? r.channels[0].length : 0) / r.sr,
                length: r.channels[0] ? r.channels[0].length : 0,
              });
        } catch (e) {
          /* memory only */
        }
      }
      return [...out.values()];
    },

    // Load every asset a project names, so the scheduler can start them without waiting.
    prefetch(project) {
      const ids = new Set();
      for (const t of (project && project.tracks) || [])
        for (const c of t.clips || []) if (c.kind === 'audio' && c.asset) ids.add(c.asset);
      return Promise.all([...ids].map((id) => api.get(id)));
    },
  };
  return api;
}

// The page's one asset store (the engine's `engine.assets`; recorders and importers may import it directly).
export const assets = createAssets();
