// The cab bank Half Stack, Iso Cab and Y Cable play (core.stack, core.cab, core.bassrig; data: { cabs }): six
// speaker-cabinet impulse responses from Jester Dyne Productions' Brutal Pack and Emerald Pack, built by
// node tools/fetch-kits.js into one 24-bit mono .odk (a few tens of KB; its .odkz carries the same PCM verbatim).
//
// Where they come from (verified 2026-10-07 at the author's own site): each pack is a zip linked from its page,
// https://www.jester-dyne-productions.com/brutal-ir-pack/ and /emerald-ir-pack/. The licence is the handbook inside
// each zip, page 2: "LICENSED 2022 UNDER: CC0 (aka CC Zero) ... CC0 allows reusers to distribute, remix, adapt, and
// build upon the material in any medium or format, with no conditions." Both handbooks are pinned below by SHA-256 and
// checked before anything is built, so a changed grant stops the build. The pages themselves say "completely free to
// use in your private and commercial Projects". Credit: Jester Dyne Productions (asked for nowhere, given anyway).
//
// What they are, from the handbooks: Brutal is a modified, oversized 4x12 (upper speakers only) loaded with a Celestion
// Vintage 30, a Celestion G12F-60 (Rockdriver Junior) and an Eminence DV-77, close-miked with a Shure SM57, a
// Sennheiser e606 and others, in a semi-live room (its IRs run 1.1-1.3 s, the room 27-33 dB under the cab after 4096
// taps). Emerald is a 1998 Marshall 1960AX 4x12 with Celestion G12M-25 Greenbacks, an SM57 and an e606, in a dry room
// (183-199 ms). All 48 kHz, 24-bit mono WAV. The studio names each by what it is ("Modern 4x12, close dynamic"), never
// by the packs' patch names or the brands.
//
// How each is built, integer and series arithmetic only, so the bytes are the same anywhere:
//   cut         to the shortest of 2048 or 4096 taps whose third-octave magnitude response, 80 Hz to 10 kHz, stays
//               within 1.0 dB of the whole IR's (a 5 ms half-Hann fade ends the cut); every one of the six passes at
//               2048 (worst 0.26 dB; the table is in tools/cab-test.js, measured on the fly)
//   level       each set to the same energy between 1 and 3 kHz (unity, the mean power gain over those bins of an
//               8192-point FFT), so switching cabs changes the colour, not the level; the gain is in each sample's
//               header (`gain`), the integers peak-normalised to 24 bits
//   kept        nothing else: no minimum-phase conversion, no resampling, no EQ
export const RECIPE = {
  name: 'Iso Cab bank',
  kind: 'cabs',
  source: 'Jester Dyne Productions: Jester\'s Brutal Pack 1.0 and Emerald Pack 1.0',
  repo: 'jester-dyne-productions.com',
  licence: 'CC0 1.0 (each pack\'s handbook: "LICENSED 2022 UNDER: CC0")',
  credit: 'Cab impulse responses: Jester\'s Brutal Pack and Emerald Pack by Jester Dyne Productions (CC0).',
  sr: 48000,
  channels: 1,
  verified: '2026-10-07',
  zips: {
    brutal: {
      page: 'https://www.jester-dyne-productions.com/brutal-ir-pack/',
      url: 'https://www.jester-dyne-productions.com/content/files/2023/04/JestersBrutalPack_1.0.zip',
      sha256: '299dc053f01ebd1e980459adc48f9c6b8a8c7af91917b4f946512eefdbb311ea',
      handbook: { path: 'Jesters_Brutal_Pack_1.0/Jesters Brutal IR Pack Handbook.pdf', sha256: '265e887fc747a154916bf56408e9c4a371c9d9036aaf1b22997ad4d161cd079e' },
      // every 48 kHz IR in the pack, by SHA-256 (the record; the bank uses the picks below)
      files: {
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/1_Cookie_Monster.wav': '48b4e8dc8bde8595f8b8153128e99debd981c30b2b7a427e8bf8f3db0a84f49f',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/2_Darth_Genocider.wav': '92e702fa7cf3d9f5f8bddb9e27c5f7cbdf770c60334b1db9681dfdb1af27bdc9',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/3_Kitten_Slayer.wav': '267d5e2e0b3fce34e00f31ddf48e7b2002462a1af2336d46dfe764976fc18070',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/4_Kaiju_Tamer.wav': 'aaf1052a508280ffe624d1760a84dbac80792b802d30d2402530d1d8344ad168',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/5_Iceburn_Suicide.wav': 'c2ad1bc7eba3d56f1b60c0e03b11fdb9cbcf4266804cb5f23a15b4a6ceb13db0',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/6_Vertical_Lip_Stabber.wav': 'e6ee5508852cc8eecccf86802b1b9057f892a5aba8b97faf2e168dd76b2d2b1d',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/7_Manslaughter_Joe.wav': '280e0528e37de8ca0c256926e20d7af8b627b4c01dc2739a9c8c4a2d348941de',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/8_Big_Bubba.wav': 'c345b2e58ae6b003fe25a4fe46bd2593568c33fd97e844cd1087eae111f33e59',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/9_Devils_Cunnilingus.wav': 'e15d16bbc727a0a3a5033f1498a23f796ec712cd163ebc70f86bfc0960fe1146',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/10_October_32th.wav': '30ccff673ce5601d75048d89f3f5233d544edc41b2a0f2848f63ceb00cbb2044',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/11_Wumbo.wav': 'a4cf39c9e7ab6d3ce10d01726419f7d410410970301034983a7c8cd0a2717860',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/12_World_Collider.wav': '6b05c813831d967c983be2632021ddeca38209625b4083c4709c3636c627008e',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/13_Cannibal_Choir.wav': 'db4e2f6493ee231922e5910848f4c76565fe88d8d305392516b83231152da77f',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/14_Cathode_Ray_Fleshburn.wav': '420280d44a6cb969d0599aa88f7bc733e13d39cdd051acf8b0eda1d82286ba5f',
        'Jesters_Brutal_Pack_1.0/Impulses/48kHz/15_Impaler_Jim.wav': '3418d5b627803b56b118bb7c86b1827f74a13547437cac21beddff5820d69ae7',
      },
    },
    emerald: {
      page: 'https://www.jester-dyne-productions.com/emerald-ir-pack/',
      url: 'https://www.jester-dyne-productions.com/content/files/2023/04/Emerald-Pack-1.0.zip',
      sha256: 'a5b3eeea4816bf94d85182341877b42876dfa0cd6c2c570cf6761933b0c79d70',
      handbook: { path: 'Emerald Pack 1.0/Jesters Emerald Pack Handbook.pdf', sha256: '906d36291d900907ddafa245920587578654589d6fceb964cd1ebbaa3995c6eb' },
      files: {
        'Emerald Pack 1.0/Impulses/48kHz/1_Nacho_Guacamole_48.wav': 'c1d0a337732ae6407b30055305e3ae579a9231b0a515b27795fb206946ef19fb',
        'Emerald Pack 1.0/Impulses/48kHz/2_Pickle_Punisher_48.wav': 'd16f282086b8f076a4b9e5dbefe0417b276b17eb52c5c6e5c394039554e07d89',
        'Emerald Pack 1.0/Impulses/48kHz/3_Wasabi_Warrior_48.wav': '26724625ecfd357991daa5deec96a965a8f75678757315f0f63b2e329a40971e',
        'Emerald Pack 1.0/Impulses/48kHz/4_Pesto_Paladin_48.wav': 'e94f11ed97831f440fc5d6b867b424c9c33daabf89fd93a0ccd00b0aa6b1e465',
        'Emerald Pack 1.0/Impulses/48kHz/5_Don_Spinacio_48.wav': 'adfd528a923df9825a1294bd17437aaf99a3d7f1f5e5ef1ed2b5dd43a2c74cd0',
        'Emerald Pack 1.0/Impulses/48kHz/6_Kill_Dill_48.wav': 'b21acae52a66b04ded8592672345d184120d0d669e12fc8f89559803e6b391b7',
      },
    },
  },
  // the six the studio offers, in the CAB switch's order. `facts` is the handbook's patch list, for the
  // record (SOUNDS.md); the studio shows `name` only.
  cabs: [
    { id: 'modern-close', name: 'Modern 4x12, close dynamic', zip: 'brutal', file: 'Jesters_Brutal_Pack_1.0/Impulses/48kHz/1_Cookie_Monster.wav', facts: 'Brutal #1: Celestion Vintage 30, Shure SM57' },
    { id: 'modern-bright', name: 'Modern 4x12, bright dynamic', zip: 'brutal', file: 'Jesters_Brutal_Pack_1.0/Impulses/48kHz/2_Darth_Genocider.wav', facts: 'Brutal #2: Eminence DV-77, Shure SM57' },
    { id: 'modern-side', name: 'Modern 4x12, side-address', zip: 'brutal', file: 'Jesters_Brutal_Pack_1.0/Impulses/48kHz/3_Kitten_Slayer.wav', facts: 'Brutal #3: Celestion G12F-60 (Rockdriver Jr.), Sennheiser e606' },
    { id: 'modern-two', name: 'Modern 4x12, two mics', zip: 'brutal', file: 'Jesters_Brutal_Pack_1.0/Impulses/48kHz/8_Big_Bubba.wav', facts: 'Brutal #8: Celestion G12F-60 and Vintage 30, Sennheiser e606 and Shure SM57' },
    { id: 'british-dynamic', name: 'British 4x12, dynamic', zip: 'emerald', file: 'Emerald Pack 1.0/Impulses/48kHz/1_Nacho_Guacamole_48.wav', facts: 'Emerald #1: Celestion G12M-25 Greenback (upper left), Shure SM57' },
    { id: 'british-side', name: 'British 4x12, side-address', zip: 'emerald', file: 'Emerald Pack 1.0/Impulses/48kHz/4_Pesto_Paladin_48.wav', facts: 'Emerald #4: Celestion G12M-25 Greenback (upper left), Sennheiser e606' },
  ],
  lengths: [2048, 4096],
  bound: 1.0,       // dB: the third-octave error a cut may make, 80 Hz to 10 kHz
  fadeMs: 5,
};

import { readZip, openZip } from './zip.js';
import { fft as exactFft, dcos } from '../../app/src/kernel/convolve.js';
import { encodeOdk } from '../../app/src/kernel/odk.js';

// a 24-bit mono WAV -> Float64Array (x / 8388608, exact)
export function wav24(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = b.subarray(o + 8, o + 8 + n);
    else if (id === 'data') data = b.subarray(o + 8, Math.min(b.length, o + 8 + n));
    o += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error('a WAV without fmt or data');
  const tag = fmt.readUInt16LE(0), ch = fmt.readUInt16LE(2), sr = fmt.readUInt32LE(4), bits = fmt.readUInt16LE(14);
  if (tag !== 1 || ch !== 1 || bits !== 24) throw new Error(`a WAV the cab build doesn't read (format ${tag}, ${ch} channels, ${bits}-bit)`);
  const n = Math.floor(data.length / 3), x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = data.readIntLE(3 * i, 3) / 8388608;
  return { sr, x };
}

// the IR cut to L taps, the last fadeMs a half-Hann fade (the series cosine: the same doubles anywhere)
export function cutIr(h, L, sr = 48000, fadeMs = 5) {
  const F = Math.round(fadeMs * sr / 1000), y = new Float64Array(L);
  for (let i = 0; i < L && i < h.length; i++) {
    let g = 1;
    if (i >= L - F) g = 0.5 * (1 + dcos((Math.PI * (i - (L - F))) / F));
    y[i] = h[i] * g;
  }
  return y;
}

// a power-of-two complex FFT for measuring (any length; Math.cos is fine here: these numbers choose, never ship)
function fftBig(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, h = len >> 1;
    for (let k = 0; k < h; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k);
      for (let i = k; i < n; i += len) { const q = i + h, xr = re[q] * wr - im[q] * wi, xi = re[q] * wi + im[q] * wr; re[q] = re[i] - xr; im[q] = im[i] - xi; re[i] += xr; im[i] += xi; }
    }
  }
}
// the third-octave bands from 80 Hz to 10 kHz (centres 1 kHz * 2^(k/3))
export const THIRDS = (() => { const c = []; for (let k = -11; k <= 10; k++) { const f = 1000 * Math.pow(2, k / 3); if (f >= 79 && f <= 10100) c.push(f); } return c; })();
// an IR's level in each third-octave band (dB, the mean power over the band's bins of a 128k-point FFT)
export function thirdOctaves(h, sr = 48000, NF = 131072) {
  const re = new Float64Array(NF), im = new Float64Array(NF);
  re.set(h.length > NF ? h.subarray(0, NF) : h);
  fftBig(re, im);
  return THIRDS.map((fc) => {
    const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6);
    let s = 0, n = 0;
    for (let k = Math.ceil(lo * NF / sr); k <= hi * NF / sr; k++) { s += re[k] * re[k] + im[k] * im[k]; n++; }
    return 10 * Math.log10(s / n);
  });
}
// the mean power gain between 1 and 3 kHz, from an 8192-point FFT of the (cut) IR: the series FFT, exact anywhere
export function midPower(h, sr = 48000) {
  const N = 8192, F = exactFft(N), x = new Float64Array(N), Xr = new Float64Array(N / 2 + 1), Xi = new Float64Array(N / 2 + 1);
  for (let i = 0; i < Math.min(N, h.length); i++) x[i] = h[i];
  F.forward(x, Xr, Xi);
  let s = 0, n = 0;
  for (let k = Math.ceil(1000 * N / sr); k <= Math.floor(3000 * N / sr); k++) { s += Xr[k] * Xr[k] + Xi[k] * Xi[k]; n++; }
  return s / n;
}

// build the bank. getZip(key) -> a readZip()-like { read(name, sha256) }. Returns { bytes, count, rows }.
export async function buildCabs(recipe, getZip) {
  const zips = {};
  for (const [key, z] of Object.entries(recipe.zips)) {
    zips[key] = await getZip(key, z);
    zips[key].read(z.handbook.path, z.handbook.sha256);   // the licence first: the handbook must be the one pinned
  }
  const samples = [], rows = [];
  for (const c of recipe.cabs) {
    const z = recipe.zips[c.zip];
    const { sr, x } = wav24(zips[c.zip].read(c.file, z.files[c.file]));
    if (sr !== recipe.sr) throw new Error(`${c.file}: ${sr} Hz, the bank is ${recipe.sr} Hz`);
    const full = thirdOctaves(x, sr);
    let pick = null, errs = [];
    for (const L of recipe.lengths) {
      const t = thirdOctaves(cutIr(x, L, sr, recipe.fadeMs), sr);
      const e = Math.max(...t.map((v, i) => Math.abs(v - full[i])));
      errs.push(Math.round(e * 100) / 100);
      if (pick == null && e <= recipe.bound) pick = L;
    }
    if (pick == null) throw new Error(`${c.file}: no cut within ${recipe.bound} dB (${errs.join(', ')}): leave it out of the picks`);
    const h = cutIr(x, pick, sr, recipe.fadeMs);
    const g = 1 / Math.sqrt(midPower(h, sr));
    let pk = 0;
    for (let i = 0; i < h.length; i++) { const a = Math.abs(h[i] * g); if (a > pk) pk = a; }
    // the header's gain, six significant figures and rounded up, so the integers stay inside 24 bits
    const gain = Number((pk * 1.00001).toPrecision(6));
    const ints = new Int32Array(h.length);
    for (let i = 0; i < h.length; i++) { const v = Math.round((h[i] * g / gain) * 8388608); ints[i] = v > 8388607 ? 8388607 : v < -8388608 ? -8388608 : v; }
    samples.push({ id: c.id, name: c.name, taps: pick, gain, src: c.file, ch: [ints] });
    rows.push({ id: c.id, name: c.name, frames: x.length, taps: pick, errs, gain });
  }
  const meta = { kind: 'cabs', source: recipe.source, licence: recipe.licence, credit: recipe.credit, verified: recipe.verified,
    cut: `the shortest of ${recipe.lengths.join(' or ')} taps within ${recipe.bound} dB of the whole IR in every third octave, 80 Hz to 10 kHz, then a ${recipe.fadeMs} ms half-Hann fade`,
    level: 'each at unity mean power gain between 1 and 3 kHz: taps = x / 8388608 * gain' };
  const bytes = encodeOdk({ name: recipe.name, sr: recipe.sr, bits: 24, channels: 1, meta, samples });
  return { bytes, count: samples.length, rows };
}

// fetch-kits' builder: the zips from the site (or the download cache)
export function cabBuilder({ cache, offline }) {
  return (recipe) => buildCabs(recipe, async (key, z) => openZip(z, { cache, offline: offline() }));
}
export { readZip };
