// @ts-check
// Kernel data on the wire: `.odkz`, a lossless, reversible packing of a 16-bit `.odk` (kernel/odk.js) that gzips to
// about two thirds of the size the plain file does (docs/DEVICES.md, "Kernel data"). It exists for the transfer only:
// the page unpacks it back to the exact `.odk` bytes and checks those against the hash the device pins, so the worklet,
// the Node renderer, the device check and the golden hashes never see it. The pinned hash is always the `.odk`'s.
//
//   packOdk(odkBytes)      -> Uint8Array   ('ODKZ'; throws unless the input is a 16-bit .odk that unpacks to itself;
//                                           a 24-bit .odk, the cab bank, is carried verbatim after its header)
//   unpackOdk(odkzBytes)   -> Uint8Array   (the .odk's bytes; throws on anything malformed or truncated)
//   isPacked(bytes)        -> boolean      (starts 'ODKZ')
//
// The transform, per sample and channel (16-bit PCM, x[-1] = x[-2] = 0): the second-order residual
// r = x[i] - 2 x[i-1] + x[i-2], wrapped to 16 bits (arithmetic mod 2^16 is exact both ways, so no escape is needed when
// a residual overflows), zigzagged (0, -1, 1, -2, ... -> 0, 1, 2, 3, ...), then split into a plane of high bytes and a
// plane of low bytes. Audio residuals are small, so the high plane is nearly all zeros and gzip packs both far better
// than it packs raw PCM (measured on Virtuosity Kit: 11.02 MB gzipped as .odk, 7.02 MB as .odkz).
//
// Layout (little-endian):
//   'ODKZ'                         4 bytes
//   the .odk's length              uint32
//   header length H                uint32   \  the .odk's own header, byte for byte
//   header                         H bytes  /  (the samples' `frames` and `at` say where each one's PCM goes)
//   high bytes                     one per PCM value, every sample's channels in header order
//   low bytes                      the same count
// The .odk's padding between samples is zeros (encodeOdk writes zeros; packOdk refuses a file it can't rebuild).
//
// Plain language only (no imports), so a Worker, the page and Node can all run it.

const MAGIC = [0x4f, 0x44, 0x4b, 0x5a]; // 'ODKZ'
const ODK1 = [0x4f, 0x44, 0x4b, 0x31];

export const isPacked = (b) => !!b && b.length >= 4 && b[0] === MAGIC[0] && b[1] === MAGIC[1] && b[2] === MAGIC[2] && b[3] === MAGIC[3];

// the header of an .odk laid out at `off` in `u` (uint32 H, then H bytes of JSON): { H, head }
function readHeader(u, off, what) {
  if (u.length < off + 4) throw new Error(`${what}: too short`);
  const H = new DataView(u.buffer, u.byteOffset + off, 4).getUint32(0, true);
  if (off + 4 + H > u.length) throw new Error(`${what}: the header runs past the end`);
  let json = '';
  for (let i = 0; i < H; i += 4096) json += String.fromCharCode.apply(null, u.subarray(off + 4 + i, off + 4 + Math.min(H, i + 4096)));
  let head;
  try { head = JSON.parse(json); } catch { throw new Error(`${what}: the header is not JSON`); }
  if (!head || (head.bits !== 16 && head.bits !== 24) || !(head.channels >= 1 && head.channels <= 8) || !Array.isArray(head.samples)) throw new Error(`${what}: not a 16- or 24-bit kit header`);
  return { H, head };
}

export function packOdk(odk) {
  const u = odk instanceof Uint8Array ? odk : new Uint8Array(odk);
  if (u.length < 8 || u[0] !== ODK1[0] || u[1] !== ODK1[1] || u[2] !== ODK1[2] || u[3] !== ODK1[3]) throw new Error('odkz: not an Overdub kit file');
  const { H, head } = readHeader(u, 4, 'odkz');
  const base = 8 + H, C = head.channels;
  // a 24-bit kit (the cab bank: tens of KB) travels as it is: the header, then its PCM bytes verbatim
  if (head.bits === 24) {
    const out = new Uint8Array(12 + H + (u.length - base));
    out.set(MAGIC, 0); new DataView(out.buffer).setUint32(4, u.length, true);
    out.set(u.subarray(4, base), 8); out.set(u.subarray(base), 12 + H);
    return out;
  }
  let total = 0;
  for (const e of head.samples) {
    const frames = e.frames | 0;
    if (frames < 0 || e.at < 0 || base + e.at + frames * 2 * C > u.length) throw new Error(`odkz: sample ${e.id} runs past the end`);
    total += frames * C;
  }
  const out = new Uint8Array(8 + 4 + H + 2 * total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, u.length, true);
  out.set(u.subarray(4, base), 8);
  const dv = new DataView(u.buffer, u.byteOffset, u.length);
  let hi = 12 + H, lo = hi + total;
  for (const e of head.samples) {
    const frames = e.frames | 0;
    for (let c = 0; c < C; c++) {
      let o = base + e.at + c * frames * 2, x1 = 0, x2 = 0;
      for (let i = 0; i < frames; i++, o += 2) {
        const x = dv.getInt16(o, true);
        const r = ((x - 2 * x1 + x2) << 16) >> 16;
        const z = ((r << 1) ^ (r >> 15)) & 0xffff;
        out[hi++] = z >> 8; out[lo++] = z & 0xff;
        x2 = x1; x1 = x;
      }
    }
  }
  // lossless or nothing: the packed file must give back these exact bytes (padding included)
  const back = unpackOdk(out);
  if (back.length !== u.length) throw new Error('odkz: the packed file does not rebuild the kit');
  for (let i = 0; i < u.length; i++) if (back[i] !== u[i]) throw new Error('odkz: the packed file does not rebuild the kit (byte ' + i + ')');
  return out;
}

export function unpackOdk(packed) {
  const u = packed instanceof Uint8Array ? packed : new Uint8Array(packed);
  if (!isPacked(u)) throw new Error('odkz: not a packed kit file');
  if (u.length < 12) throw new Error('odkz: too short');
  const len = new DataView(u.buffer, u.byteOffset, 8).getUint32(4, true);
  const { H, head } = readHeader(u, 8, 'odkz');
  const base = 8 + H, C = head.channels;
  if (len < base || len > 0x7fffffff) throw new Error('odkz: a bad length');
  if (head.bits === 24) {
    if (u.length !== 12 + H + (len - base)) throw new Error(`odkz: ${u.length} bytes, the header says ${12 + H + (len - base)} (truncated or padded)`);
    for (const e of head.samples) if ((e.frames | 0) < 0 || !(e.at >= 0) || base + e.at + (e.frames | 0) * 3 * C > len) throw new Error(`odkz: sample ${e.id} runs past the end`);
    const out = new Uint8Array(len);
    out.set(ODK1, 0); out.set(u.subarray(8, 12 + H), 4); out.set(u.subarray(12 + H), base);
    return out;
  }
  let total = 0;
  for (const e of head.samples) {
    const frames = e.frames | 0;
    if (frames < 0 || !(e.at >= 0) || e.at % 2 || base + e.at + frames * 2 * C > len) throw new Error(`odkz: sample ${e.id} runs past the end`);
    total += frames * C;
  }
  if (u.length !== 12 + H + 2 * total) throw new Error(`odkz: ${u.length} bytes, the header says ${12 + H + 2 * total} (truncated or padded)`);
  const out = new Uint8Array(len);
  out.set(ODK1, 0);
  out.set(u.subarray(8, 12 + H), 4);
  let hi = 12 + H, lo = hi + total;
  for (const e of head.samples) {
    const frames = e.frames | 0;
    for (let c = 0; c < C; c++) {
      let o = base + e.at + c * frames * 2, x1 = 0, x2 = 0;
      for (let i = 0; i < frames; i++, o += 2) {
        const z = (u[hi++] << 8) | u[lo++];
        const r = (z >>> 1) ^ -(z & 1);
        const x = ((r + 2 * x1 - x2) << 16) >> 16;
        out[o] = x & 0xff; out[o + 1] = (x >> 8) & 0xff;
        x2 = x1; x1 = x;
      }
    }
  }
  return out;
}
