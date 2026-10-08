// The frames the Node device check (engine/node/check.js) and its render process (check-render.js) send each other
// over a pipe: an 8-byte head (the JSON header's length, the payload's length, both uint32 big-endian), the header
// (UTF-8 JSON), then the payload (Float32Arrays end to end, in this machine's byte order).
//
//   frame(header, [Float32Array...]) -> Buffer
//   reader({ allow(header) -> payload bytes expected (throw to refuse), onFrame(header, payload: Buffer),
//            onError(message), maxHeader = 1 MB }) -> { push(chunk) }
// The reader asks allow() before it buffers a payload, so a side that sends more than was asked for is refused
// before its bytes are kept.

export function frame(header, chans = []) {
  const h = Buffer.from(JSON.stringify(header), 'utf8');
  const bytes = chans.reduce((s, a) => s + a.byteLength, 0);
  const out = Buffer.allocUnsafe(8 + h.length + bytes);
  out.writeUInt32BE(h.length, 0);
  out.writeUInt32BE(bytes, 4);
  h.copy(out, 8);
  let at = 8 + h.length;
  for (const a of chans) {
    Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(out, at);
    at += a.byteLength;
  }
  return out;
}

export function reader({ allow, onFrame, onError, maxHeader = 1 << 20 }) {
  let buf = Buffer.alloc(0),
    need = null,
    broken = false; // need: { header, bytes } once a header is in
  const fail = (m) => {
    broken = true;
    buf = Buffer.alloc(0);
    onError(m);
  };
  return {
    push(chunk) {
      if (broken) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (!need) {
          if (buf.length < 8) return;
          const hl = buf.readUInt32BE(0),
            pl = buf.readUInt32BE(4);
          if (hl > maxHeader) return fail(`a header of ${hl} bytes`);
          if (buf.length < 8 + hl) return;
          let header;
          try {
            header = JSON.parse(buf.subarray(8, 8 + hl).toString('utf8'));
          } catch {
            return fail('a header that is not JSON');
          }
          let want;
          try {
            want = allow(header);
          } catch (e) {
            return fail(e.message);
          }
          if (want !== pl) return fail(`${pl} bytes where ${want} were expected`);
          need = { header, bytes: pl };
          buf = buf.subarray(8 + hl);
        }
        if (buf.length < need.bytes) return;
        const payload = Buffer.from(buf.subarray(0, need.bytes)); // (a copy: the rest of buf is the next frame)
        const header = need.header;
        buf = buf.subarray(need.bytes);
        need = null;
        onFrame(header, payload);
        if (broken) return;
      }
    },
  };
}
