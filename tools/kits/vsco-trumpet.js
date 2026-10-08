// VS Chamber Orchestra 2: Community Edition (Versilian Studios), the melodic kit Spit Valve (core.trumpet) plays: what
// tools/fetch-kits.js downloads and how tools/kits/build.js lays it out. Pinned to one commit of the VSCO-2-CE
// repository (the one Rosin pins), every file by SHA-256: the solo trumpet's straight sustained notes, every one it
// recorded, F3 to C6, about a minor third apart, its softest and loudest dynamics (v1 and v3).
//
// The licence: the repository's LICENSE is the full CC0 1.0 Universal text; its Readme.txt asks for credit to
// Versilian Studios/Sam Gossner and Ivy Audio/Simon Dalzell and not to sell the samples directly (both honoured).
//
// Why the trumpet: VSCO's brass are solo players (no sections). Its French horn sustains leave a gap of fourteen
// semitones (C4 to D5) with no note, carry one to four dynamics note by note, and the windows disagree on its tuning on
// four notes; the trumpet's straight sustains cover its range every three or four semitones, two dynamics on every
// note, SNR 69 to 106 dB, every note within 8 cents. Its sustains with vibrato are shorter and noisier (SNR 44 to 58,
// cut 36 to 56 dB under their peak), so the straight ones.
//
// VSCO names its files with C3 as middle C: Sum_SHTrumpet_sus_C3 is C4 (MIDI 60). Every file's pitch was measured.
//
// The sustains are looped, as Rosin's are: the build searches each note, once it has settled (loud from 1 s after
// its onset, soft from 1.6 s: the soft notes swell longer), for the loop of 1.6 to 2.4 s whose ends match best and
// whose level steps least at the seam, bakes a 0.4 s crossfade into it (constant power for the ends' correlation) and
// cuts the sample at the loop's end. Stereo, as recorded. Loudness: every sample at one level (its loop's), the
// dynamics from a velocity curve set from the two layers' measured distance (11 dB at the attack).
const ZONES = [
  // [the note in VSCO's naming, key, lokey, hikey]
  ['F2', 53, 0, 54],
  ['A2', 57, 55, 58],
  ['C3', 60, 59, 61],
  ['D#3', 63, 62, 65],
  ['G3', 67, 66, 68],
  ['A#3', 70, 69, 72],
  ['D4', 74, 73, 75],
  ['F4', 77, 76, 79],
  ['A4', 81, 80, 82],
  ['C5', 84, 83, 127],
];
const regions = [];
for (const [n, key, lo, hi] of ZONES) {
  regions.push({
    file: `Brass/Trumpet/sus/Sum_SHTrumpet_sus_${n}_v1_rr1.wav`,
    key,
    lo,
    hi,
    vlo: 0,
    vhi: 72,
    layer: 0,
    loop: { from: 1.6, by: 4.4 },
  });
  regions.push({
    file: `Brass/Trumpet/sus/Sum_SHTrumpet_sus_${n}_v3_rr1.wav`,
    key,
    lo,
    hi,
    vlo: 73,
    vhi: 127,
    layer: 1,
  });
}

export const RECIPE = {
  name: 'VSCO 2 CE Trumpet',
  repo: 'sgossner/VSCO-2-CE',
  commit: '440300901dfe9275fd84e0b7763af1f8443ae62e',
  source: 'https://github.com/sgossner/VSCO-2-CE',
  home: 'https://vis.versilstudios.com/vsco-community.html',
  licence: 'CC0-1.0',
  licenceFile: {
    path: 'LICENSE',
    sha256: '36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673',
    must: /CC0 1\.0 Universal/,
  },
  docs: [
    {
      path: 'Readme.txt',
      sha256: '101ddb88eb013900cc911834ecbdfbd49497bcd913bf09417160b9677952bb38',
      must: /You\s+are\s+permitted\s+to\s+use\s+these\s+samples\s+for\s+ANY\s+purpose/,
    },
  ],
  credit:
    'VS Chamber Orchestra 2: Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon Dalzell), https://vis.versilstudios.com/vsco-community.html: the trumpet, sustained (CC0 1.0).',
  qaName: 'vsco2ce-trumpet',
  sr: 44100,
  channels: 2,
  regions,
  head: -40,
  loop: { from: 1, min: 1.6, max: 2.4, by: 3.6, xfade: 0.4 },
  tune: 'measure',
  level: { mode: 'flat', measure: 'loop', across: 'even' },
  align: false,
  meta: {
    velcurve: [
      [1, -24],
      [36, -11],
      [100, -1.5],
      [127, 0],
    ],
    env: { a: 0.006, r: 0.2 },
  },
  build:
    "the trumpet's straight sustains, every note it recorded, its softest and loudest dynamics; 16-bit as recorded, kept at 44.1 kHz, stereo; each start 2 ms before the note first comes within 40 dB of its peak; a sustain loop of 1.6 to 2.4 s from 1 s (loud) or 1.6 s (soft) after the onset, ending by 3.6 or 4.4 s, its 0.4 s crossfade baked in, the sample cut at its end; a tune field for a note read 5 to 25 cents off; every sample at one level (its loop's), the dynamics from the velocity curve",
  waive: [],
  files: {
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_F2_v1_rr1.wav':
      'abda84b86c7eb12a236e976230bbde9898c709f39ba992424b5426bf612c915b',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_F2_v3_rr1.wav':
      '31992fbdf596d77e9464dc57166718389f13870f8b9b1f1e83380f5ec2217c87',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_A2_v1_rr1.wav':
      '151613515233cb0ac29daba9c9c0db443e2e19465285d50967c66824b5ccdba9',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_A2_v3_rr1.wav':
      '6c331fb59ab6668e4f77ce59c19445fc52d1082f376df853c9282ed518205a5f',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_C3_v1_rr1.wav':
      'fc49adedf0922c42583145eedd7ba4707cf97a92fb446b73bf160003190efebe',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_C3_v3_rr1.wav':
      '4a55ab4d867cfa3499fbcf1c5d8d530f757621a9979aee5b46d3fd69a2931c99',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_D#3_v1_rr1.wav':
      '360a5b80fcb79e0ebe95b993eaaf031a47c1a5fbf9a235eb2c359ceb9796765d',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_D#3_v3_rr1.wav':
      '8cf8ffb7948c8d787fa9dd2469ff7fc60ad26f079721ed038c9d6a9d6b402318',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v1_rr1.wav':
      '949446498df4e1402f00023c91bd45c3b9a793ce8076a871b800e76ce144d4fa',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v3_rr1.wav':
      'e916631d4ef5c7d2afa356b76cb0d3a18ba2702d1229535edf4fb6d73c2e521c',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_A#3_v1_rr1.wav':
      '0a432ceeddcecea962e2e0ebb5c3e80be3d3f251d38c5d4ddc0df4089e97351b',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_A#3_v3_rr1.wav':
      'c931621fae92e22cc73ee43924c0d30ee629764bb37c30cc427b59411198461d',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v1_rr1.wav':
      'fa4a3f77ead22cb58afdaa1732b9b6c8ec6033708ae339df6446a56c1b7cc8e9',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v3_rr1.wav':
      '71d77fc5c3c43b9453f17293c6039bf8554dec6581ca15c14c45893f8bc57566',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_F4_v1_rr1.wav':
      '81954b71f23a9ebe3ea02c7c9c6cfb68a3904a965bc916bc27f061e643604992',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_F4_v3_rr1.wav':
      '4138d1dc994d485f8b7deecbe7811c2152006d5e8cde8d4c1256c72be7179af3',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v1_rr1.wav':
      'f720df13ae0eef9889692283a4ea9033ef4d4826ded3f47dbe81a0dd2585a3cf',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v3_rr1.wav':
      '0cd9d6d4dedadc6bfb9625045e632f84f6cd7b2a005f72b7efd198e5b0571172',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_C5_v1_rr1.wav':
      '8112b044343d65e2c368ef740fd36935ceaa1865dcbcceb9ee409544ef805bd8',
    'Brass/Trumpet/sus/Sum_SHTrumpet_sus_C5_v3_rr1.wav':
      'ba7dc7050f277c5bba6c59a6dd330c2d50e29dc1d97bd19fb6bcbba4a8cad4d5',
  },
};
