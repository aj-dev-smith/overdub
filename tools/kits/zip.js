// A pinned-zip source for tools/fetch-kits.js: sound files that come in a zip on their author's own site rather than
// in a git repository (Jester's cab IR packs, tools/kits/jester-cabs.js). Node built-ins only.
//
//   const z = await openZip({ url, sha256 }, { cache, offline })   the zip, downloaded once into `cache` (by SHA-256)
//                                                                    and refused unless it is that SHA-256
//   z.names                                                          every member's name
//   z.read(name, sha256)                                             one member, inflated (node:zlib.inflateRawSync, or
//                                                                    stored), refused unless it is that SHA-256
//
// Only what the packs need is read: the central directory (no zip64, no encryption, no multi-disk), stored (0) or
// deflated (8) members. The local header is read for its own name and extra lengths, as the spec says to.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

export async function openZip({ url, sha256: want }, { cache, offline = false } = {}) {
  const file = cache ? path.join(cache, want + '.zip') : null;
  let b = null;
  if (file && fs.existsSync(file)) { const c = fs.readFileSync(file); if (sha256(c) === want) b = c; }
  if (!b) {
    if (offline) throw Object.assign(new Error(`${url} isn't in the download cache`), { code: 'NOCACHE' });
    let err = null;
    for (let attempt = 0; attempt < 3 && !b; attempt++) {
      try {
        const r = await fetch(url, { headers: { 'user-agent': 'overdub fetch-kits' } });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        b = Buffer.from(await r.arrayBuffer());
      } catch (e) { err = e; }
    }
    if (!b) throw new Error(`could not download ${url}: ${err && err.message}`);
    const got = sha256(b);
    if (got !== want) throw new Error(`${url}: SHA-256 ${got}, pinned ${want} (the file changed upstream, or the download is bad)`);
    if (file) { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(file, b); }
  }
  return readZip(b);
}

// the members of a zip held in memory: { names, read(name, sha256) }
export function readZip(b) {
  // the end of central directory record: the last 'PK\x05\x06' within the final 64 KB + 22 bytes
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = b.readUInt16LE(eocd + 10), size = b.readUInt32LE(eocd + 12), start = b.readUInt32LE(eocd + 16);
  if (start + size > b.length) throw new Error('zip: the central directory runs past the end');
  const members = new Map();
  let o = start;
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(o) !== 0x02014b50) throw new Error('zip: a bad central directory entry');
    const flags = b.readUInt16LE(o + 8), method = b.readUInt16LE(o + 10), csize = b.readUInt32LE(o + 20), usize = b.readUInt32LE(o + 24);
    const nlen = b.readUInt16LE(o + 28), xlen = b.readUInt16LE(o + 30), clen = b.readUInt16LE(o + 32), local = b.readUInt32LE(o + 42);
    const name = b.toString(flags & 0x800 ? 'utf8' : 'latin1', o + 46, o + 46 + nlen);
    members.set(name, { method, csize, usize, local, flags });
    o += 46 + nlen + xlen + clen;
  }
  return {
    names: [...members.keys()],
    read(name, want) {
      const m = members.get(name);
      if (!m) throw new Error(`zip: no member ${name}`);
      if (m.flags & 1) throw new Error(`zip: ${name} is encrypted`);
      if (b.readUInt32LE(m.local) !== 0x04034b50) throw new Error(`zip: ${name}'s local header is missing`);
      const at = m.local + 30 + b.readUInt16LE(m.local + 26) + b.readUInt16LE(m.local + 28);
      const raw = b.subarray(at, at + m.csize);
      let out;
      if (m.method === 0) out = Buffer.from(raw);
      else if (m.method === 8) out = zlib.inflateRawSync(raw);
      else throw new Error(`zip: ${name} uses method ${m.method}`);
      if (out.length !== m.usize) throw new Error(`zip: ${name} inflated to ${out.length} bytes, the directory says ${m.usize}`);
      if (want) { const got = sha256(out); if (got !== want) throw new Error(`${name}: SHA-256 ${got}, pinned ${want}`); }
      return out;
    },
  };
}
