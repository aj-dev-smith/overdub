// @ts-check
// Kernel data: the .odk container a sampled device's samples travel in (docs/DEVICES.md, "Kernel data"). Integer PCM
// in a container of our own, so decoding is the same integers on every engine: the AudioWorklet, Node and every
// browser read the same bytes into the same Int16Arrays (no decodeAudioData, which resamples by each browser's own
// method). A kernel turns them into floats itself (x / 32768 is exact anywhere). The file is named by the SHA-256 of
// its bytes; the server compresses it for transfer (gzip), never the format.
//
//   encodeOdk({ name, sr, bits, channels, meta, samples: [{ id, ..., ch: [Int16Array | Int32Array, ...] }] }) -> Uint8Array
//   decodeOdk(bytes) -> { format, name, sr, bits, channels, meta, samples: [{ id, ..., frames, ch: [Int16Array | Int32Array] }] }
//                       (throws on anything malformed; 24-bit samples come back as Int32Array, sign-extended; on a
//                       little-endian machine 16-bit ones are views onto `bytes`, so keep the bytes unchanged)
//
// Layout (little-endian throughout):
//   'ODK1'                         4 bytes
//   header length H                uint32
//   header                         H bytes of JSON, ASCII only, padded with spaces so the PCM starts on a 4-byte boundary:
//                                  { format: 'overdub-kit/1', name, sr, bits (16 | 24), channels, meta,
//                                    samples: [{ id, ...fields, frames, at }] }   (at: the sample's byte offset in the PCM)
//   PCM                            per sample, channel after channel (planar), each `frames` integers of bits/8 bytes;
//                                  each sample starts on a 4-byte boundary (zero padding between)
//
// This module runs in the worklet's scope too (kernel/worklet.js imports it), so it uses nothing but the language.

export const ODK_FORMAT = 'overdub-kit/1';
const MAGIC = [0x4f, 0x44, 0x4b, 0x31]; // 'ODK1'
const pad4 = (n) => (n + 3) & ~3;
// (this machine's byte order: on a little-endian one, 16-bit samples are views onto the bytes, no copy)
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// ASCII only, so the header decodes the same with or without a TextDecoder (the worklet's scope may not have one)
function ascii(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7e) throw new Error('odk: the header must be ASCII');
    out[i] = c;
  }
  return out;
}

export function encodeOdk({ name, sr, bits = 16, channels = 2, meta = {}, samples }) {
  if (bits !== 16 && bits !== 24) throw new Error('odk: bits must be 16 or 24');
  const bw = bits / 8;
  let at = 0;
  const entries = samples.map((s) => {
    if (!s.ch || s.ch.length !== channels) throw new Error(`odk: sample ${s.id} needs ${channels} channels`);
    const frames = s.ch[0].length;
    const { ch, ...rest } = s;
    const e = { ...rest, frames, at };
    at = pad4(at + frames * bw * channels);
    return e;
  });
  const head = { format: ODK_FORMAT, name, sr, bits, channels, meta, samples: entries };
  let json = JSON.stringify(head);
  json += ' '.repeat(pad4(8 + json.length) - 8 - json.length);
  const H = json.length,
    out = new Uint8Array(8 + H + at);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, H, true);
  out.set(ascii(json), 8);
  const dv = new DataView(out.buffer, 8 + H);
  const lo = bits === 16 ? -32768 : -8388608,
    hi = -lo - 1;
  samples.forEach((s, k) => {
    let o = entries[k].at;
    for (const c of s.ch) {
      for (let i = 0; i < c.length; i++) {
        const v = c[i];
        if (!(v >= lo && v <= hi) || v !== Math.floor(v))
          throw new Error(`odk: sample ${s.id} holds ${v}, not a ${bits}-bit integer`);
        if (bits === 16) {
          dv.setInt16(o, v, true);
          o += 2;
        } else {
          dv.setUint8(o, v & 0xff);
          dv.setUint8(o + 1, (v >> 8) & 0xff);
          dv.setInt8(o + 2, v >> 16);
          o += 3;
        }
      }
    }
  });
  return out;
}

export function decodeOdk(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length < 8 || u[0] !== MAGIC[0] || u[1] !== MAGIC[1] || u[2] !== MAGIC[2] || u[3] !== MAGIC[3])
    throw new Error('odk: not an Overdub kit file');
  const H = new DataView(u.buffer, u.byteOffset, 8).getUint32(4, true);
  if (8 + H > u.length) throw new Error('odk: the header runs past the end');
  let json = '';
  for (let i = 0; i < H; i += 4096)
    json += String.fromCharCode.apply(null, u.subarray(8 + i, 8 + Math.min(H, i + 4096)));
  let head;
  try {
    head = JSON.parse(json);
  } catch (e) {
    throw new Error('odk: the header is not JSON');
  }
  if (!head || head.format !== ODK_FORMAT) throw new Error('odk: unknown format ' + (head && head.format));
  const { bits, channels } = head;
  if ((bits !== 16 && bits !== 24) || !(channels >= 1 && channels <= 8) || !Array.isArray(head.samples))
    throw new Error('odk: a bad header');
  const base = 8 + H,
    bw = bits / 8,
    dv = new DataView(u.buffer, u.byteOffset + base, u.length - base);
  const samples = head.samples.map((e) => {
    const frames = e.frames | 0;
    if (frames < 0 || e.at < 0 || e.at + frames * bw * channels > dv.byteLength)
      throw new Error(`odk: sample ${e.id} runs past the end`);
    let o = e.at;
    const ch = [];
    for (let c = 0; c < channels; c++) {
      const off = u.byteOffset + base + o;
      if (bits === 16 && LE && off % 2 === 0) {
        ch.push(new Int16Array(u.buffer, off, frames));
        o += frames * 2;
        continue;
      }
      const a = bits === 16 ? new Int16Array(frames) : new Int32Array(frames);
      if (bits === 16) for (let i = 0; i < frames; i++, o += 2) a[i] = dv.getInt16(o, true);
      else
        for (let i = 0; i < frames; i++, o += 3)
          a[i] = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16);
      ch.push(a);
    }
    return { ...e, frames, ch };
  });
  return { format: head.format, name: head.name, sr: head.sr, bits, channels, meta: head.meta || {}, samples };
}

// What a device's `data` field may name: { [name]: 'sha256-<64 hex>' }, up to 4 entries. Anything else is dropped.
export const DATA_RE = /^sha256-[0-9a-f]{64}$/;
export function normData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (n >= 4) break;
    if (/^[a-z][a-z0-9_]{0,23}$/.test(k) && typeof v === 'string' && DATA_RE.test(v)) {
      out[k] = v;
      n++;
    }
  }
  return n ? out : null;
}
// the file a hash names, relative to app/: kits/<64 hex>.odk
export const dataFile = (hash) => 'kits/' + String(hash).slice(7) + '.odk';
