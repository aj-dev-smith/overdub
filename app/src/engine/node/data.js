// Kernel data in Node: the same files the studio fetches (app/kits/<hex>.odk, named by their SHA-256), read from disk
// once, checked against their name and decoded with the same code the worklet runs (kernel/odk.js), so the canonical
// render and the device check hand a kernel exactly what the studio does. docs/DEVICES.md, "Kernel data".
//
//   dataFor(files)   { [name]: decoded | null } for a def's `data` ({ kit: 'sha256-<hex>' }); null when it names none
//   dataPath(hash)   where that file lives on disk
//   KITS             app/kits
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeOdk, dataFile, normData } from '../../kernel/odk.js';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const KITS = path.join(APP, 'kits');
export const dataPath = (hash) => path.join(APP, dataFile(hash));

const cache = new Map(); // hash -> decoded | null
function load(hash) {
  if (cache.has(hash)) return cache.get(hash);
  let out = null;
  try {
    const b = fs.readFileSync(dataPath(hash));
    if ('sha256-' + crypto.createHash('sha256').update(b).digest('hex') === hash) out = decodeOdk(new Uint8Array(b.buffer, b.byteOffset, b.length));
  } catch (e) { /* not here: null */ }
  cache.set(hash, out);
  return out;
}

export function dataFor(data) {
  const files = normData(data);
  if (!files) return null;
  const out = {};
  for (const [k, hash] of Object.entries(files)) out[k] = load(hash);
  return out;
}
