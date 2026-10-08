// Bear Sax (Karoryfer Samples, CC0), the melodic kit Bell Up (core.barisax) plays: what tools/fetch-kits.js downloads
// and how tools/kits/build.js lays it out. Pinned to one commit of the sfzinstruments repository, every file by
// SHA-256: a 1926 Conn baritone saxophone's sustained notes (the solo poly program's "looped" pair, soft and loud),
// from Db2 to G4, every third semitone.
//
// Why this sax: of Karoryfer's three CC0 solo instruments with character (the bigcat cello, Bear Sax, Weresax), Bear
// Sax measured cleanest on the rubric: DC offset under -97 dBFS on every file (Weresax's alto sits at -38 to -56 dBFS
// on every one: check 3 rejects it), every note within 3 cents (both windows), and its soft and loud takes of a note
// recorded to be crossfaded, so they line up in time. The cello is the other one shipped (tools/kits/karoryfer-cello.js).
//
// The licence: the repository's LICENSE is the full CC0 1.0 Universal text; its readme: "This instrument is open
// source, and you can do whatever you want with it ... Royalty-free for all commercial and non-commercial use."
// Credited anyway.
//
// Karoryfer names these files an octave under where they sound (its d1 is D2, MIDI 38, as its map plays it); every
// sample here sits at the key it sounds, measured.
//
// The loops are Karoryfer's own: each file carries one in its smpl chunk, 2.2 to 7.7 s long, ending at the file's
// end, the same frames in the soft and the loud take. The build takes them as they are (nothing searched or baked)
// and the rubric's check 14 reads them. 22 mono samples at 44.1 kHz, about 141 s: every third semitone is what
// fits 8 MB with loops this long (every other one built to 8.8 MB). Loudness: every sample at one level
// (its loop's), the dynamics from a velocity curve set from the two takes' measured distance (the loud 5.7 dB over
// the soft on average, at the attack) and crossfaded wide (the takes were made for it).
const NOTES = [
  // [Karoryfer's name, the key it sounds, lokey, hikey]
  ['db1', 37, 0, 38],
  ['e1', 40, 39, 41],
  ['g1', 43, 42, 44],
  ['bb1', 46, 45, 47],
  ['db2', 49, 48, 50],
  ['e2', 52, 51, 53],
  ['g2', 55, 54, 56],
  ['bb2', 58, 57, 59],
  ['db3', 61, 60, 62],
  ['e3', 64, 63, 65],
  ['g3', 67, 66, 127],
];
const regions = [];
for (const [n, key, lo, hi] of NOTES) {
  regions.push({ file: `Samples/${n}_looped_p.wav`, key, lo, hi, vlo: 0, vhi: 63, layer: 0 });
  regions.push({ file: `Samples/${n}_looped_f.wav`, key, lo, hi, vlo: 64, vhi: 127, layer: 1 });
}

export const RECIPE = {
  name: 'Bear Sax',
  repo: 'sfzinstruments/karoryfer.bear-sax',
  commit: '7abb3c652525a15dfac80e1b5dfbba9964ee568f',
  source: 'https://github.com/sfzinstruments/karoryfer.bear-sax',
  home: 'https://www.karoryfer.com/karoryfer-samples/wydawnictwa/bear-sax',
  licence: 'CC0-1.0',
  licenceFile: {
    path: 'LICENSE',
    sha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499',
    must: /CC0 1\.0 Universal/,
  },
  docs: [
    {
      path: 'readme.txt',
      sha256: 'd3b565a0153c1bbf000ab0c3fdf3db5ea2d4c58931624b3d52a8eb11a3011cf9',
      must: /Royalty-free for all commercial and non-commercial use/,
    },
    {
      path: 'Programs/2-solo-poly.sfz',
      sha256: '2e7737fda263944fb8b41a334dd12b85489105636f71d07bf8dc6dabdd972fc4',
      must: /poly\/dynfade_map\.sfz/,
    },
    {
      path: 'Programs/poly/dynfade_map.sfz',
      sha256: 'a6a2282ca5045d83377c6f3687e580975bc0051d05bea871e461b41e31062410',
      must: /d1_looped_p\.wav\s+lokey=36\s+hikey=36\s+pitch_keycenter=38/,
    },
  ],
  credit: 'Bear Sax by Karoryfer Samples: a 1926 Conn baritone saxophone, sustained (CC0 1.0).',
  qaName: 'karoryfer-bear-sax',
  sr: 44100,
  channels: 1,
  regions,
  loop: { file: true },
  level: { mode: 'flat', measure: 'loop', across: 'even' },
  align: true,
  meta: {
    velcurve: [
      [1, -20],
      [32, -8],
      [63, -5.7],
      [96, -1.5],
      [127, 0],
    ],
    env: { a: 0.004, r: 0.18 },
  },
  build:
    "the solo poly program's sustained notes, soft and loud, every third semitone from Db2 to G4; mono as recorded, 24-bit to 16-bit by rounding, kept at 44.1 kHz, each sample at the key it sounds (the files are named an octave down); each sample loops on the loop its file carries (Karoryfer's own, unchanged); every sample at one level (its loop's), the dynamics from the velocity curve; the soft take lined up with the loud one",
  waive: [],
  files: {
    'Samples/db1_looped_p.wav': 'a7d9e4a36ee454a9d573f91b39da66022f99dc967ed15db5c026faf51804e274',
    'Samples/db1_looped_f.wav': '98dcf5f101759b6374a3eb022c6878d36936a730e63eb3923fa75577b1eacb5a',
    'Samples/e1_looped_p.wav': '5048f01f24b98207b9a85055c1a3839bdbcbd6aaa540c42f5e5a71d6ef2707d7',
    'Samples/e1_looped_f.wav': 'bd51e1dde2a9690c9095111d643c6d5452ac0329075296bcb5b8e3a945153d49',
    'Samples/g1_looped_p.wav': '06df95078a68090ab154e3d1c17b114c23ef91c552900fa23e82a35dd5083a84',
    'Samples/g1_looped_f.wav': '10de33a6f9ef9673abac48090a48d71bed469eb2ea3ab89c0e6e9edbbf26e1b1',
    'Samples/bb1_looped_p.wav': '3fe4a4187e5d5cfb430e4d6390510670ee3f87c8bf6346bc95152d71bb7cce3f',
    'Samples/bb1_looped_f.wav': 'bb64b23ea5df64d2713ebbf7ebeb174f3b3191adea58f63da0d9df9b06360597',
    'Samples/db2_looped_p.wav': 'e9515f8c1fba481e659b38f519521b470fc66abd5c958ee7276b24d0f958469a',
    'Samples/db2_looped_f.wav': '580182852cb6882821ce08433424294688a0dad6e2f4ce009354144ff1d67089',
    'Samples/e2_looped_p.wav': '6d78dd036d49b64beb35cb4bda1014fdafcc69a8d81241cb3228d87588745317',
    'Samples/e2_looped_f.wav': '4ecf2b92064f13a8e43883e4cc259e0b30450fd07fb890d48f966931912090b9',
    'Samples/g2_looped_p.wav': 'f2f52f2d934a4e74fc1cda9194f30bd5904d9a05e447dde8a350347f8e4ca2e5',
    'Samples/g2_looped_f.wav': 'e0c745a81fd3722e8e2780cdef4630c0c1da91c93a8f5dd4228e5042480cbdcf',
    'Samples/bb2_looped_p.wav': '0f1fc621b23b5e433f350eb4e35aa930e484a44f871196f4347e7bf78ed96bf6',
    'Samples/bb2_looped_f.wav': 'c660d588731302248269ead3db1b5f3fe0e3d4aacc5e0afadc274dba6eb1652c',
    'Samples/db3_looped_p.wav': '0f79fe2e0e9ffbd6d4e6c5eae6cb5835c7865dd945e489ff8a3d41a19df7e8bf',
    'Samples/db3_looped_f.wav': '22d86788704c97ce1b6739462e7ef4882d2416996aac2c936750ca95114c02bc',
    'Samples/e3_looped_p.wav': '736e0539d289fc45870d847d53a4808189991533ccc0171f9e7b73d7d6b376a5',
    'Samples/e3_looped_f.wav': '3f9f9aafdd7187aa61e181fabf8f6f7650fb0d515a7c79fd8b656a9a109a8e04',
    'Samples/g3_looped_p.wav': '13509de11bbb272b4de2712240f1022bb75772169117cac3e5fe4722f0037042',
    'Samples/g3_looped_f.wav': '032838c2ee05839510a5b22de9e79500fe6494e9bbffc5e1ed4ecd54e04e6bee',
  },
};
