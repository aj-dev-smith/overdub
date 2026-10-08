// VS Chamber Orchestra 2: Community Edition (Versilian Studios), the melodic kit Head Joint (core.flute) plays: what
// tools/fetch-kits.js downloads and how tools/kits/build.js lays it out. Pinned to one commit of the VSCO-2-CE
// repository (the one Rosin pins), every file by SHA-256: the solo flute's sustained notes with vibrato, every one it
// recorded (the first take of each), C4 to C7, a major or minor third apart.
//
// The licence: the repository's LICENSE is the full CC0 1.0 Universal text; its Readme.txt asks for credit to
// Versilian Studios/Sam Gossner and Ivy Audio/Simon Dalzell and not to sell the samples directly (both honoured).
//
// Why these: VSCO's flute has two sustains. The one without vibrato has two dynamics, but its stereo pair is out of
// phase on four of its nine notes (L/R correlation -0.54 to -0.9: check 12 rejects it, and summed to mono it
// cancels); the one with vibrato has one dynamic and a coherent pair (correlation 0.07 to 0.83). A flute is played
// with vibrato, so this one: the dynamics come from the velocity curve and the tone (a soft flute is a darker one: the
// device's presets lean on TONE for that).
//
// VSCO names its files with C3 as middle C: LDFlute_susvib_C3 is C4 (MIDI 60). Every file's pitch was measured.
//
// The sustains are looped, as Rosin's are: the build searches each note, once it has settled (from 1 s after its
// onset), for the loop of 2.4 to 3.4 s whose ends match best and whose level steps least at the seam, ending by 5 s,
// bakes a 0.4 s crossfade into it (constant power for the ends' correlation) and cuts the sample at the loop's end.
// Stereo, as recorded (the room is in it). Every sample at one level (its loop's).
const ZONES = [
  // [file, key, lokey, hikey]
  ['Woodwinds/Flute/susvib/LDFlute_susvib_C3_v1_1.wav', 60, 0, 61],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_E3_v1_1.wav', 64, 62, 66],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_A3_v1_1.wav', 69, 67, 70],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_C4_v1_1.wav', 72, 71, 73],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_E4_v1_1.wav', 76, 74, 78],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_A4_v1_1.wav', 81, 79, 82],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_C5_v1_1.wav', 84, 83, 85],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_E5_v1_1.wav', 88, 86, 90],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_A5_v1_1.wav', 93, 91, 94],
  ['Woodwinds/Flute/susvib/LDFlute_susvib_C6_v1_1.wav', 96, 95, 127],
];
const regions = ZONES.map(([file, key, lo, hi]) => ({ file, key, lo, hi, vlo: 0, vhi: 127, layer: 0 }));

export const RECIPE = {
  name: 'VSCO 2 CE Flute',
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
    'VS Chamber Orchestra 2: Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon Dalzell), https://vis.versilstudios.com/vsco-community.html: the flute, sustained with vibrato (CC0 1.0).',
  qaName: 'vsco2ce-flute',
  sr: 44100,
  channels: 2,
  regions,
  head: -40,
  loop: { from: 1, min: 2.4, max: 3.4, by: 5, xfade: 0.4 },
  tune: 'measure',
  level: { mode: 'flat', measure: 'loop', across: 'even' },
  align: false,
  meta: {
    velcurve: [
      [1, -24],
      [40, -10],
      [100, -1.5],
      [127, 0],
    ],
    env: { a: 0.01, r: 0.25 },
  },
  build:
    "the flute's sustains with vibrato, the first take of each of its ten notes; 16-bit by rounding (the 24-bit files), kept at 44.1 kHz, stereo; each start 2 ms before the note first comes within 40 dB of its peak; a sustain loop of 2.4 to 3.4 s from 1 s after the onset, ending by 5 s, its 0.4 s crossfade baked in, the sample cut at its end; a tune field for a note read 5 to 25 cents off; every sample at one level (its loop's), the dynamics from the velocity curve",
  waive: [],
  files: {
    'Woodwinds/Flute/susvib/LDFlute_susvib_C3_v1_1.wav':
      '073631c8442b275d803e608e840c2ce6cad3b08320018e08510cf3cb57373154',
    'Woodwinds/Flute/susvib/LDFlute_susvib_E3_v1_1.wav':
      '831386b21a704a5fccf204b18a536d638ea191f1b56662200192241215e21abd',
    'Woodwinds/Flute/susvib/LDFlute_susvib_A3_v1_1.wav':
      '4ea04a7a2ba152752e1b475798619a62f2546f54972caa6ddcd88f29a2046c81',
    'Woodwinds/Flute/susvib/LDFlute_susvib_C4_v1_1.wav':
      'e88a0ff35e6b8c29fd88bc778a4c817d955b2c3a2934def97a7d093b72e2ae97',
    'Woodwinds/Flute/susvib/LDFlute_susvib_E4_v1_1.wav':
      '83d4eed0c54ebfe25fe9dfb0475fb90a88a43d11777bc2afac879b8b695e494c',
    'Woodwinds/Flute/susvib/LDFlute_susvib_A4_v1_1.wav':
      'cf3c1c30943b8b8ef8b5b9ced89430c014987a037204098d002f86e424391ba9',
    'Woodwinds/Flute/susvib/LDFlute_susvib_C5_v1_1.wav':
      'ecb78c59069866ea7c3327594851827cd2f50c5d411aad422269a88e53614fbe',
    'Woodwinds/Flute/susvib/LDFlute_susvib_E5_v1_1.wav':
      '6eab0a4827c43b49415cb0c846affd40e9555c884c74683422554923faf17681',
    'Woodwinds/Flute/susvib/LDFlute_susvib_A5_v1_1.wav':
      '067a42df19ec1864389c28235a6794033471c0ffa3d7e16637396a505ca7d7fd',
    'Woodwinds/Flute/susvib/LDFlute_susvib_C6_v1_1.wav':
      '0ead172a529daad09ecbab66027027b92189afe79f50f71dc20ee58ca66c9135',
  },
};
