// VCSL's vibraphone (Versilian Community Sample Library, CC0), the melodic kit Damper Bar (core.vibes) plays: what
// tools/fetch-kits.js downloads and how tools/kits/build.js lays it out. Pinned to one commit of the VCSL repository,
// every file by SHA-256: all 11 notes VCSL recorded (F3 to E6, a third apart), the motor off, struck with soft
// mallets (two dynamics) and hard mallets (two dynamics): four velocity layers, soft mallets below velocity 64 and
// hard ones above, as a player changes mallets for a harder sound.
//
// Why the vibraphone: VCSL's mallets and harps were run through the QA rubric (tools/kits/qa.js) before choosing.
// The concert harp fails the noise floor (12 of 45 under 55 dB SNR) and its tails (13 stop above -55 dB); the marimba
// fails phase coherence (6 of 30 anti-correlated, B4 losing 7.6 dB in mono); the vibraphone passes everything but one
// stroke's stereo image (hard G4 v3, -0.21 over its first 300 ms: a review, 1 of 44).
//
// The licence: the repository's LICENSE is the full CC0 1.0 Universal text; its README: "you can do whatever you want
// with these sounds (even make commercial software), no royalties, no credit, no special terms." Credited anyway.
//
// VCSL names these files with C3 as middle C (Vibes_hard_C3 is C4, MIDI 60); every file's pitch was measured.
//
// The budget is 4-8 MB: stereo, each note cut where it falls 50 dB under its attack or at 6 s, with a squared fade over
// its last 1.5 s. Every sample set onto one level across the keys; the dynamics come from a velocity curve that follows
// the layers' recorded levels where they are in order (the softest stroke 21 dB under the hardest, on average) and runs
// straight through the two middle layers, whose recorded order is the other way round (VCSL's soft mallets at a full
// stroke are 5 dB louder than its hard mallets at half).
const NOTES = [
  // [VCSL name, key, lokey, hikey, [soft v1, soft v2, hard v2, hard v3]]
  [
    'F2',
    53,
    0,
    54,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_F2_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_F2_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F2_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F2_v3_rr1_Main.wav',
    ],
  ],
  [
    'A2',
    57,
    55,
    58,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A2_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A2_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_A2_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_A2_v3_rr1_Main.wav',
    ],
  ],
  [
    'C3',
    60,
    59,
    61,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C3_v1_rr2_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C3_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C3_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C3_v3_rr1_Main.wav',
    ],
  ],
  [
    'E3',
    64,
    62,
    65,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E3_v1_rr2_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E3_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_E3_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_E3_v3_rr1_Main.wav',
    ],
  ],
  [
    'G3',
    67,
    66,
    69,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_G3_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_G3_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_G3_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_G3_v3_rr1_Main.wav',
    ],
  ],
  [
    'B3',
    71,
    70,
    72,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_B3_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_B3_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_B3_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_B3_v3_rr1_Main.wav',
    ],
  ],
  [
    'D4',
    74,
    73,
    75,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_D4_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_D4_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_D4_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_D4_v3_rr1_Main.wav',
    ],
  ],
  [
    'F4',
    77,
    76,
    79,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_F4_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_F4_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F4_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F4_v3_rr1_Main.wav',
    ],
  ],
  [
    'A4',
    81,
    80,
    82,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A4_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A4_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_A4_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_A4_v3_rr1_Main.wav',
    ],
  ],
  [
    'C5',
    84,
    83,
    85,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C5_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C5_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C5_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C5_v3_rr1_Main.wav',
    ],
  ],
  [
    'E5',
    88,
    86,
    127,
    [
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E5_v1_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E5_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_E5_v2_rr1_Main.wav',
      'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_E5_v3_rr1_Main.wav',
    ],
  ],
];
const BOUNDS = [
  [0, 31],
  [32, 63],
  [64, 95],
  [96, 127],
];
const regions = [];
for (const [, key, lo, hi, fs] of NOTES)
  fs.forEach((file, layer) => regions.push({ file, key, lo, hi, vlo: BOUNDS[layer][0], vhi: BOUNDS[layer][1], layer }));

export const RECIPE = {
  name: 'VCSL Vibraphone',
  repo: 'sgossner/VCSL',
  commit: 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e',
  source: 'https://github.com/sgossner/VCSL',
  home: 'https://versilian-studios.com/vcsl/',
  licence: 'CC0-1.0',
  licenceFile: {
    path: 'LICENSE',
    sha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499',
    must: /CC0 1\.0 Universal/,
  },
  docs: [
    {
      path: 'README.md',
      sha256: '6f7214a188f106c917d6503748485413c3e47cf56bce69f82beb9d16aa0894a9',
      must: /you can do whatever you want with these sounds/,
    },
  ],
  credit:
    'Vibraphone from the Versilian Community Sample Library (VCSL) by Versilian Studios, https://versilian-studios.com/vcsl/: soft and hard mallets, the motor off (CC0 1.0).',
  qaName: 'vcsl-vibraphone',
  sr: 44100,
  channels: 2,
  regions,
  cut: { rel: -50, cap: [[127, 6]], fade: 1.5 },
  level: { mode: 'flat', measure: 'attack', across: 'even' },
  align: true,
  meta: {
    velcurve: [
      [1, -27],
      [16, -21],
      [48, -11],
      [80, -5],
      [112, -1],
      [127, 0],
    ],
    env: { r: 0.8 },
  },
  build:
    'all 11 notes, soft mallets v1 and v2 and hard mallets v2 and v3; stereo, 16-bit as recorded, kept at 44.1 kHz; each note cut where its 100 ms RMS falls 50 dB under its attack, or at 6 s, with a squared fade over its last 1.5 s; every sample at one level, the dynamics from the velocity curve; each layer lined up with the next layer up',
  waive: [],
  files: {
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_F2_v1_rr1_Main.wav':
      'df5cfcc72af80fac2191300d09922474c4ac25c5cbc43ff387953d607f7c1320',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_F2_v2_rr1_Main.wav':
      '14c3f7a2492f6a87aecd6463611bbbbfe2094383bfa267a2df67f94766e00df5',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F2_v2_rr1_Main.wav':
      '5b58cb88a7989ec67428943473e5e9053b5f05507881b8ddee107867f557a28d',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F2_v3_rr1_Main.wav':
      '7bbacf51d62db2c76f56f4affd7a424e1184920c585df3726aa33c97ace76127',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A2_v1_rr1_Main.wav':
      'b6e23a94322107d0ab884d7c38e51be538eb45f613c6a24e980c2261151bed75',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A2_v2_rr1_Main.wav':
      '683d2b5a9ece5e5bcf421a9ae62d74e5004b40493e1b5893f125bb96fd52cb64',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_A2_v2_rr1_Main.wav':
      'bb888513871856e89b87d5db9c03be9763c3b524caeb36b6c2010613bec5bf2a',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_A2_v3_rr1_Main.wav':
      '43e689cf8b096d8414fe0d1a7dbf1623ed80b30b26fd5bf5774b0b0db2777729',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C3_v1_rr2_Main.wav':
      '1dda9a4c3205c365345d66dcb68c8e09c0dca76a310b8fe8108e43c7e8c1cd0a',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C3_v2_rr1_Main.wav':
      '83950902ab4323f372bbf81b924fc05c6bd0ea42c9742db44464d562c20414bf',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C3_v2_rr1_Main.wav':
      '26082761ea9b12fbe06d38bd4ea2826143958c29786948e50649e0478041b0fc',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C3_v3_rr1_Main.wav':
      '1e4c472f6630be1b0c4ff1e8a63ad61d2c1dc561bd764fedaf87e8e46bdd706d',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E3_v1_rr2_Main.wav':
      '620a241017d0de0e6cb789c97d439401f25d659d08f753746690632e71de8f0b',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E3_v2_rr1_Main.wav':
      '268f0a703ca5e394533913bce3760e8c06661a5d72841601ade887ea72a00312',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_E3_v2_rr1_Main.wav':
      'c9d68a552bb9b9bc539f2e7b9083433dd5ae76a57cf838d586c2591b0711477e',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_E3_v3_rr1_Main.wav':
      'beb8a14c7e63fa22927c6566562f1eabd9eb42982bf344ea886e38fd50808e1c',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_G3_v1_rr1_Main.wav':
      '9b479e4c84fb1caafba8c1c106a8922cea20bba81c37d65f93afae339626767f',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_G3_v2_rr1_Main.wav':
      'ecd350b0fec96ce465a185c44a9c3b2ee966d6b56784c27c17d42e9b5d887882',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_G3_v2_rr1_Main.wav':
      'b657be5f347c5d86f7daa6b350e039e088ddf958a14eb23f25fd1b64a183f396',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_G3_v3_rr1_Main.wav':
      'c61be2354eb3f2b46de310ccb5c431cb8582436991c99e939ad98e14c3dba2b5',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_B3_v1_rr1_Main.wav':
      '7edfbd70f93781d2cbb17c2fc8befe474de9987c6353db2358af4e13a0269345',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_B3_v2_rr1_Main.wav':
      '9d2466c4d3375f2eb24c57f17e15736052a5492d6c84b876c1d0a4997eea99a0',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_B3_v2_rr1_Main.wav':
      '8ae8f9a67ff3c5942bd796987ef96fbaaafadf4edfe5dc8734b8a1ab4e0ff7b4',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_B3_v3_rr1_Main.wav':
      '357065002fa8e4f1af51a4214ccff71e964393068f1229c7be20647d05e98dcd',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_D4_v1_rr1_Main.wav':
      'daedf613863d4de0a383d66b2db6ab9ffd8dc492d16ff7d735cf3b3107046a26',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_D4_v2_rr1_Main.wav':
      'aa5626038a653de08057e1dae8a7160b12f2ce26c85a525bc545b8d14843ce80',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_D4_v2_rr1_Main.wav':
      'a0ff7c922a24fde71a675c57c69c222d619feaa4c91c25bdf6830e0dc1108a74',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_D4_v3_rr1_Main.wav':
      '147cec54acf3a26fc985dcfb78d9593177369c9bd1a8cb3bc908f796616195e2',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_F4_v1_rr1_Main.wav':
      '95b7d6eeb71d77cce607c0c52b0a6dfd23d0eeedc2eb393fb9a6c5a5768f4aa5',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_F4_v2_rr1_Main.wav':
      '76c2813ea1e87870dfbf3035360af46aee54214eda5e95b03bffb83f64a89b1c',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F4_v2_rr1_Main.wav':
      '24e4a7a9d1e6dd221ab478fa57793e3575e3b5f666dc75a1ad5d58d05ac7f129',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_F4_v3_rr1_Main.wav':
      'b6bc7264f3cd0ed04487d4e9c6f7548d8a23f001f689ec5ec048d45c49e5941a',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A4_v1_rr1_Main.wav':
      '48e942290a982768d7a0038e28a76a99cb666673518b29ebdc55de5e1491025f',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_A4_v2_rr1_Main.wav':
      'fb507c5cb2f2023289fdf1384092f3c5e13f03a2b5b1c39f6792cc57aa77d58d',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_A4_v2_rr1_Main.wav':
      '9fa4d639ba513db9d02ae1d18c1258dc8ce391f37752a8fd096a99d6f8b7bb47',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_A4_v3_rr1_Main.wav':
      '651d8210d3f83596380481c46726bbf82bd07c24c5048a815aa5db218d094ae4',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C5_v1_rr1_Main.wav':
      'be995c1164dcbbcf83688d095864a4abd0feaa68b71d1d2e78c35f62461fc03b',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_C5_v2_rr1_Main.wav':
      '129c5661e386f3c08a4f777c108815f174d96e02f5fb4b4026a9437905327847',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C5_v2_rr1_Main.wav':
      '774705f0da1e9c6299baa0343d1c12f82647f528f954096fdf9a75ba5694a2b1',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_C5_v3_rr1_Main.wav':
      '2aa1bde8ca38dcfccb07641d7d8514f3df6e8f523287055f7fdc4b54d8224bdb',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E5_v1_rr1_Main.wav':
      'd2a9412550115bfdc4e1087cad3cd6e9d8146c1f4a91bf47f60aa7936c5f5dbe',
    'Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_E5_v2_rr1_Main.wav':
      '7e854b01269cd206cd863025c5b61416bba90362fa965597a7b174851d07648e',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_E5_v2_rr1_Main.wav':
      '3d29acd09dc641572c56ceb96a6dfff3ad043a378ae11a096eaa2281676defab',
    'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/Vibes_hard_E5_v3_rr1_Main.wav':
      '4e9f3241020170f570b641410e317c7183bc5a567bfe91351711bbc7a21e79f5',
  },
};
