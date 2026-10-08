// Overdub's marks, generated (docs/BRAND.md, "The mark: the Weave"): node tools/brand-marks.js  -> app/assets/ and site/assets/
//   logo.svg       the Weave: two strands, two crossings (warm over at the first, cool over at the second)
//   favicon.svg    the Weave, fatter and on the control-room square
//   wordmark.svg / wordmark-ink.svg   "overdub" in Archivo Expanded ExtraBold Italic, as outlines. The outlines are the
//                  source of truth (they were set once from the font); this script only recolours them, so running it
//                  never needs the font and never changes the letters.
// Output is byte-identical to the files in docs/brand-options/overdub/, so running it is always safe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const f = (n) => +n.toFixed(2);
// The mark's inks are the riso pair (deeper than --human/--agent, so the mark holds on cream paper and on the room).
const WARM = '#f07612',
  COOL = '#1b95dc',
  CREAM = '#f4ead6',
  INK = '#16130f',
  ROOM = '#141210';

// Two takes, woven. The warm strand (you) is hand-played: its swing breathes a little. The cool strand (the agent)
// is exact. They cross on the centre line; at each crossing one passes over the other, taking turns.
function strands({ x0, x1, cx, cy = 50, A, lambda, wobble = 0.1, steps = 160 }) {
  const warm = [],
    cool = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const s = Math.sin((2 * Math.PI * (x - cx)) / lambda);
    const aw = A * (1 + wobble * Math.sin((2 * Math.PI * (x - x0)) / ((x1 - x0) * 1.3) + 0.6));
    warm.push([x, cy - aw * s]);
    cool.push([x, cy + A * s]);
  }
  const d = (p) => 'M' + p.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L');
  return { warm: d(warm), cool: d(cool) };
}

// The over/under is a mask on the strand underneath: a black band along the strand on top, wider than it by `gap`
// each side, so the gap is real transparency and the mark sits on any background.
// crossings: [x, over] where over = 'warm' | 'cool'
function weave({ id, x0, x1, cx, cy = 50, A, lambda, sw, gap, crossings, wobble }) {
  const s = strands({ x0, x1, cx, cy, A, lambda, wobble });
  const win = lambda * 0.22; // how much of the over strand cuts the under strand
  const cut = (over) =>
    crossings
      .filter((c) => c[1] === over)
      .map(([x]) => {
        const seg = strands({ x0: x - win, x1: x + win, cx, cy, A, lambda, wobble, steps: 30 });
        return `<path d="${over === 'warm' ? seg.warm : seg.cool}" stroke="#000" stroke-width="${f(sw + 2 * gap)}" fill="none" stroke-linecap="butt"/>`;
      })
      .join('');
  const defs =
    `<mask id="${id}c" maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140"><rect x="-20" y="-20" width="140" height="140" fill="#fff"/>${cut('warm')}</mask>` +
    `<mask id="${id}w" maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140"><rect x="-20" y="-20" width="140" height="140" fill="#fff"/>${cut('cool')}</mask>`;
  const body =
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="${sw}">` +
    `<path d="${s.cool}" stroke="${COOL}" mask="url(#${id}c)"/>` +
    `<path d="${s.warm}" stroke="${WARM}" mask="url(#${id}w)"/></g>`;
  return { defs, body };
}

// The mark: one wavelength, two crossings. Warm over at the first (take one is yours), cool over at the second.
// Slanted 10 degrees, like the italic wordmark.
function logo() {
  const m = weave({
    id: 'm',
    x0: 17,
    x1: 83,
    cx: 33.5,
    A: 25,
    lambda: 66,
    sw: 12,
    gap: 3.4,
    wobble: 0.08,
    crossings: [
      [33.5, 'warm'],
      [66.5, 'cool'],
    ],
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 92 92" width="512" height="512" role="img" aria-label="Overdub">
<title>Overdub</title>
<defs>${m.defs}</defs>
<g transform="translate(9 0) skewX(-10)">${m.body}</g>
</svg>
`;
}

// The favicon: fatter strands, no wobble (it is 16 px), on the control-room square.
function favicon() {
  const fv = weave({
    id: 'f',
    x0: 13,
    x1: 87,
    cx: 31.5,
    A: 21,
    lambda: 74,
    sw: 14,
    gap: 4,
    wobble: 0,
    crossings: [
      [31.5, 'warm'],
      [68.5, 'cool'],
    ],
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="64" height="64" role="img" aria-label="Overdub">
<title>Overdub</title>
<defs>${fv.defs}</defs>
<rect width="100" height="100" rx="24" fill="${ROOM}"/>
<g transform="translate(9 0) skewX(-10)">${fv.body}</g>
</svg>
`;
}

// The wordmark, recoloured from the stored outlines.
function wordmarks() {
  const src = fs.readFileSync(path.join(ROOT, 'app/assets/wordmark.svg'), 'utf8');
  const head = src.match(/^<svg [^>]*>/)[0],
    d = src.match(/ d="([^"]+)"/)[1];
  const one = (color) => `${head}
<title>overdub</title>
<path fill="${color}" d="${d}"/>
</svg>
`;
  return { 'wordmark.svg': one(CREAM), 'wordmark-ink.svg': one(INK) };
}

const files = { 'logo.svg': logo(), 'favicon.svg': favicon(), ...wordmarks() };
const outs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(ROOT, 'app/assets'), path.join(ROOT, 'site/assets')];
for (const dir of outs) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), svg);
}
console.log('wrote', Object.keys(files).join(', '), 'to', outs.map((o) => path.relative(ROOT, o) || '.').join(', '));
