// Node-side files for the canonical renderer: songs in, WAVs out, and the hash that pins a render.
//
//   readSong(path)                 the project JSON (a saved song, or { project } / { song } wrapping one)
//   readWav(path) / decodeWav(buf) { sr, channels: [Float32Array] } (PCM 16/24/32-bit, float 32-bit)
//   encodeWav({ sr, channels }, { bits = 24, float = false }) / writeWav(path, render, opts)   (float: 32-bit float)
//   sha256(render)                 hex SHA-256 of the float samples: each channel's Float32 samples, little-endian,
//                                  channel 0 then channel 1 (planar). The definition golden.json pins.
//   readAssets(dir, project)       { [assetId]: { sr, channels } } from <dir>/<assetId>.wav for the song's audio clips
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function readSong(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const p = j && Array.isArray(j.tracks) ? j : j && (j.project || j.song);
  if (!p || !Array.isArray(p.tracks)) throw new Error(`${file}: not a song (no tracks)`);
  return p;
}

export function sha256({ channels }) {
  const h = createHash('sha256');
  for (const ch of channels) {
    const f = ch instanceof Float32Array ? ch : Float32Array.from(ch);
    const b = Buffer.from(f.buffer, f.byteOffset, f.byteLength);
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1)
      throw new Error('sha256: big-endian hosts are not supported');
    h.update(b);
  }
  return h.digest('hex');
}

export function encodeWav({ sr, channels }, { bits = 24, float = false } = {}) {
  if (float) bits = 32;
  const nc = channels.length,
    n = channels[0].length,
    bps = bits / 8;
  const buf = Buffer.alloc(44 + n * nc * bps);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * nc * bps, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(float ? 3 : 1, 20);
  buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * nc * bps, 28);
  buf.writeUInt16LE(nc * bps, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * nc * bps, 40);
  const max = 2 ** (bits - 1) - 1;
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      let v = channels[c][i];
      if (float) {
        buf.writeFloatLE(v, o);
        o += 4;
        continue;
      }
      v = v !== v ? 0 : v < -1 ? -1 : v > 1 ? 1 : v;
      const q = Math.round(v * max);
      if (bits === 24) buf.writeIntLE(q, o, 3);
      else if (bits === 16) buf.writeInt16LE(q, o);
      else buf.writeInt32LE(q, o);
      o += bps;
    }
  }
  return buf;
}
export function writeWav(file, render, opts) {
  fs.writeFileSync(file, encodeWav(render, opts));
}

export function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a WAV file');
  let o = 12,
    fmt = null,
    data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4),
      size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ')
      fmt = {
        tag: buf.readUInt16LE(o + 8),
        nc: buf.readUInt16LE(o + 10),
        sr: buf.readUInt32LE(o + 12),
        bits: buf.readUInt16LE(o + 22),
      };
    if (id === 'data') data = buf.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV: no fmt or data chunk');
  const tag = fmt.tag === 0xfffe ? (fmt.bits === 32 && data.length ? 3 : 1) : fmt.tag;
  const bps = fmt.bits / 8,
    n = Math.floor(data.length / (bps * fmt.nc));
  const ch = Array.from({ length: fmt.nc }, () => new Float32Array(n));
  for (let i = 0, p = 0; i < n; i++) {
    for (let c = 0; c < fmt.nc; c++, p += bps) {
      let v;
      if (tag === 3) v = bps === 8 ? data.readDoubleLE(p) : data.readFloatLE(p);
      else if (fmt.bits === 16) v = data.readInt16LE(p) / 32768;
      else if (fmt.bits === 24) v = data.readIntLE(p, 3) / 8388608;
      else if (fmt.bits === 32) v = data.readInt32LE(p) / 2147483648;
      else if (fmt.bits === 8) v = (data[p] - 128) / 128;
      else throw new Error(`WAV: ${fmt.bits}-bit samples are not supported`);
      ch[c][i] = v;
    }
  }
  return { sr: fmt.sr, channels: ch };
}
export function readWav(file) {
  return decodeWav(fs.readFileSync(file));
}

export function readAssets(dir, project) {
  const out = {};
  const ids = new Set();
  for (const t of project.tracks || [])
    for (const c of t.clips || []) if (c.kind === 'audio' && c.asset) ids.add(c.asset);
  for (const id of ids) {
    const f = path.join(dir, id + '.wav');
    if (fs.existsSync(f)) out[id] = readWav(f);
  }
  return out;
}
