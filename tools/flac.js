// A FLAC decoder in plain JS, for tools/fetch-kits.js (zero dependencies: the kit's upstream files are FLAC). FLAC is
// lossless and integer, so this gives back exactly the samples that were encoded; every file's decode is held to the
// MD5 its STREAMINFO carries, so a decoder bug can't slip a wrong sample into a kit.
//
//   import { decodeFlac } from './flac.js';
//   const { sr, bits, channels: [Int32Array, ...], frames } = decodeFlac(buffer)   (throws on anything malformed)
//
// It covers what the format allows a stream to hold: fixed and LPC predictors, Rice partitions (4- and 5-bit
// parameters, escapes), wasted bits, and the independent, left/side, right/side and mid/side channel layouts. It skips
// metadata other than STREAMINFO. Arithmetic stays in doubles, exact for 24-bit audio (an LPC sum stays under 2^53).
import crypto from 'node:crypto';

class Bits {
  constructor(u8, pos = 0) { this.u = u8; this.p = pos; this.b = 0; } // p: byte, b: bits already read of it
  bit() { const v = (this.u[this.p] >> (7 - this.b)) & 1; if (++this.b === 8) { this.b = 0; this.p++; } return v; }
  // n bits, unsigned (n up to 53)
  read(n) {
    let v = 0;
    while (n > 0) {
      if (this.p >= this.u.length) throw new Error('flac: ran off the end of the data');
      const left = 8 - this.b, take = n < left ? n : left;
      const x = (this.u[this.p] >> (left - take)) & ((1 << take) - 1);
      v = v * (1 << take) + x;
      n -= take; this.b += take;
      if (this.b === 8) { this.b = 0; this.p++; }
    }
    return v;
  }
  signed(n) { if (n === 0) return 0; const v = this.read(n), half = 2 ** (n - 1); return v >= half ? v - 2 * half : v; }
  unary() { let n = 0; while (this.bit() === 0) n++; return n; }
  align() { if (this.b) { this.b = 0; this.p++; } }
}

const BLOCK = (c, br) => {
  if (c === 1) return 192;
  if (c >= 2 && c <= 5) return 576 << (c - 2);
  if (c === 6) return br.read(8) + 1;
  if (c === 7) return br.read(16) + 1;
  if (c >= 8) return 256 << (c - 8);
  throw new Error('flac: reserved block size');
};
const FIXED = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]];

function residual(br, out, n, order) {
  const method = br.read(2);
  if (method > 1) throw new Error('flac: reserved residual coding');
  const pbits = method ? 5 : 4, esc = method ? 31 : 15;
  const po = br.read(4), parts = 1 << po;
  let i = order;
  for (let k = 0; k < parts; k++) {
    const cnt = (n >> po) - (k === 0 ? order : 0);
    const param = br.read(pbits);
    if (param === esc) {
      const nb = br.read(5);
      for (let j = 0; j < cnt; j++) out[i++] = br.signed(nb);
    } else {
      for (let j = 0; j < cnt; j++) {
        const q = br.unary();
        const u = q * (2 ** param) + (param ? br.read(param) : 0);
        out[i++] = u % 2 ? -(u + 1) / 2 : u / 2;
      }
    }
  }
}

function subframe(br, n, bps) {
  if (br.bit()) throw new Error('flac: subframe padding bit set');
  const type = br.read(6);
  let wasted = 0;
  if (br.bit()) wasted = br.unary() + 1;
  bps -= wasted;
  const s = new Float64Array(n);
  if (type === 0) { const v = br.signed(bps); s.fill(v); }
  else if (type === 1) { for (let i = 0; i < n; i++) s[i] = br.signed(bps); }
  else if (type >= 8 && type <= 12) {
    const order = type - 8, c = FIXED[order];
    for (let i = 0; i < order; i++) s[i] = br.signed(bps);
    residual(br, s, n, order);
    for (let i = order; i < n; i++) { let p = 0; for (let j = 0; j < order; j++) p += c[j] * s[i - 1 - j]; s[i] += p; }
  } else if (type >= 32) {
    const order = (type & 31) + 1;
    for (let i = 0; i < order; i++) s[i] = br.signed(bps);
    const prec = br.read(4) + 1;
    if (prec === 16) throw new Error('flac: bad LPC precision');
    const shift = br.signed(5);
    if (shift < 0) throw new Error('flac: negative LPC shift');
    const c = [];
    for (let j = 0; j < order; j++) c.push(br.signed(prec));
    residual(br, s, n, order);
    const div = 2 ** shift;
    for (let i = order; i < n; i++) {
      let p = 0;
      for (let j = 0; j < order; j++) p += c[j] * s[i - 1 - j];
      s[i] += Math.floor(p / div); // an arithmetic shift right
    }
  } else throw new Error('flac: reserved subframe type ' + type);
  if (wasted) { const m = 2 ** wasted; for (let i = 0; i < n; i++) s[i] *= m; }
  return s;
}

export function decodeFlac(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (String.fromCharCode(u[0], u[1], u[2], u[3]) !== 'fLaC') throw new Error('flac: not a FLAC file');
  let p = 4, info = null;
  for (;;) {
    const last = u[p] & 0x80, type = u[p] & 0x7f, len = (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3];
    if (type === 0) {
      const br = new Bits(u, p + 4);
      const minB = br.read(16), maxB = br.read(16); br.read(24); br.read(24);
      const sr = br.read(20), ch = br.read(3) + 1, bits = br.read(5) + 1, total = br.read(36);
      const md5 = Buffer.from(u.subarray(p + 4 + 18, p + 4 + 34)).toString('hex');
      info = { minB, maxB, sr, ch, bits, total, md5 };
    }
    p += 4 + len;
    if (last) break;
  }
  if (!info) throw new Error('flac: no STREAMINFO');
  if (!info.total) throw new Error('flac: unknown length');
  const { ch, bits, total } = info;
  const outs = Array.from({ length: ch }, () => new Int32Array(total));
  let at = 0;
  const br = new Bits(u, p);
  while (at < total) {
    br.align();
    if (br.read(14) !== 0x3ffe) throw new Error('flac: lost frame sync at byte ' + br.p);
    br.read(1); br.read(1);
    const bsCode = br.read(4), srCode = br.read(4), chan = br.read(4), ssCode = br.read(3); br.read(1);
    // the frame or sample number, UTF-8 coded
    let x = br.read(8), more = 0;
    if (x >= 0xc0) { more = x >= 0xfe ? 6 : x >= 0xfc ? 5 : x >= 0xf8 ? 4 : x >= 0xf0 ? 3 : x >= 0xe0 ? 2 : 1; }
    for (let i = 0; i < more; i++) br.read(8);
    const n = BLOCK(bsCode, br);
    if (srCode === 12) br.read(8); else if (srCode === 13 || srCode === 14) br.read(16);
    br.read(8); // CRC-8 of the header
    const fbits = ssCode === 0 ? bits : [0, 8, 12, 0, 16, 20, 24, 0][ssCode];
    if (!fbits) throw new Error('flac: reserved sample size');
    const nch = chan < 8 ? chan + 1 : 2;
    if (nch !== ch) throw new Error('flac: a frame with a different channel count');
    const sub = [];
    for (let c = 0; c < nch; c++) {
      const side = (chan === 8 && c === 1) || (chan === 9 && c === 0) || (chan === 10 && c === 1);
      sub.push(subframe(br, n, fbits + (side ? 1 : 0)));
    }
    if (chan === 8) for (let i = 0; i < n; i++) sub[1][i] = sub[0][i] - sub[1][i];
    else if (chan === 9) for (let i = 0; i < n; i++) sub[0][i] = sub[1][i] + sub[0][i];
    else if (chan === 10) {
      for (let i = 0; i < n; i++) {
        let m = sub[0][i] * 2; const s = sub[1][i];
        if (s % 2) m += 1; // (the side's odd bit restores the mid's lost one)
        sub[0][i] = (m + s) / 2; sub[1][i] = (m - s) / 2;
      }
    }
    const m = Math.min(n, total - at);
    for (let c = 0; c < nch; c++) outs[c].set(sub[c].subarray(0, m), at);
    at += m;
    br.align();
    br.read(16); // CRC-16 of the frame
  }
  // the MD5 of the samples as the encoder saw them: interleaved, little-endian, in whole bytes
  if (info.md5 !== '0'.repeat(32)) {
    const bw = Math.ceil(bits / 8), raw = Buffer.alloc(total * ch * bw);
    let o = 0;
    for (let i = 0; i < total; i++) for (let c = 0; c < ch; c++) { raw.writeIntLE(outs[c][i], o, bw); o += bw; }
    const got = crypto.createHash('md5').update(raw).digest('hex');
    if (got !== info.md5) throw new Error(`flac: decoded samples fail the stream's MD5 (${got} != ${info.md5})`);
  }
  return { sr: info.sr, bits, frames: total, channels: outs };
}
