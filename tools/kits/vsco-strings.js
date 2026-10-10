// VS Chamber Orchestra 2: Community Edition (Versilian Studios), the melodic kit Rosin (core.ensemble) plays: what
// tools/fetch-kits.js downloads and how tools/kits/build.js lays it out. Pinned to one commit of the VSCO-2-CE
// repository, every file by SHA-256: the sustained, vibrato articulation of four string sections, one section per
// register, as an ensemble patch splits them: the solo contrabass up to A1, the cello section A#1 to E3, the viola
// section F3 to E4, the violin section F4 up. 15 zones, two dynamics each (VSCO's v1 and its loudest, v2 or v3).
//
// The licence: the repository's LICENSE is the full CC0 1.0 Universal text; its Readme.txt: "You are permitted to use
// these samples for ANY purpose. We ask that you do not sell the samples directly ... Please provide credit to
// Versilian Studios/Sam Gossner, and/or Ivy Audio/Simon Dalzell where applicable, and link to the VSCO: CE homepage."
// (a request, which the device and docs/SOUNDS.md honour). VCSL, the other CC0 Versilian set, has no bowed section
// strings, so VSCO is the source.
//
// VSCO names its files with C3 as middle C: susvib_C1 is C2 (MIDI 36). Each key below is the measured one (every file's
// pitch was read: all within 5 cents of the name plus an octave).
//
// The sustains are looped, which is what fits 4-8 MB: the build searches each note, once it has settled, for the loop
// of 1.5 to 1.9 s whose ends match best and whose level steps least at the seam, bakes a 0.4 s crossfade into it
// (constant power for the ends' correlation) and cuts the sample at the loop's end, about 2.8 s for a loud note and
// 4.3 s for a soft one (VSCO's soft notes swell for two or three seconds). The device's RELEASE is the bow leaving the
// string. Loudness: every sample at one level (its loop's), whatever its section (VSCO recorded the violins some 10 dB
// under the cellos), the dynamics from a velocity curve set from the two layers' recorded distance: 11.5 dB on average
// between their loops.
const ZONES = [
  // [soft file, loud file, key, lokey, hikey]
  ["Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_F#0_v1_rr1.wav","Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_F#0_v3_rr1.wav",30,0,33],
  ["Strings/Cello Section/susvib/susvib_C1_v1_1.wav","Strings/Cello Section/susvib/susvib_C1_v3_1.wav",36,34,38],
  ["Strings/Cello Section/susvib/susvib_E1_v1_1.wav","Strings/Cello Section/susvib/susvib_E1_v3_1.wav",40,39,41],
  ["Strings/Cello Section/susvib/susvib_G1_v1_1.wav","Strings/Cello Section/susvib/susvib_G1_v3_1.wav",43,42,45],
  ["Strings/Cello Section/susvib/susvib_B1_v1_1.wav","Strings/Cello Section/susvib/susvib_B1_v3_1.wav",47,46,48],
  ["Strings/Cello Section/susvib/susvib_D2_v1_1.wav","Strings/Cello Section/susvib/susvib_D2_v3_1.wav",50,49,52],
  ["Strings/Viola Section/susvib/ViolaEns_susvib_G2_v1_1.wav","Strings/Viola Section/susvib/ViolaEns_susvib_G2_v2_1.wav",55,53,57],
  ["Strings/Viola Section/susvib/ViolaEns_susvib_B2_v1_1.wav","Strings/Viola Section/susvib/ViolaEns_susvib_B2_v2_1.wav",59,58,60],
  ["Strings/Viola Section/susvib/ViolaEns_susvib_D3_v1_1.wav","Strings/Viola Section/susvib/ViolaEns_susvib_D3_v2_1.wav",62,61,64],
  ["Strings/Violin Section/susVib/VlnEns_susVib_F#3_v1.wav","Strings/Violin Section/susVib/VlnEns_susVib_F#3_v2.wav",66,65,67],
  ["Strings/Violin Section/susVib/VlnEns_susVib_A3_v1.wav","Strings/Violin Section/susVib/VlnEns_susVib_A3_v2.wav",69,68,70],
  ["Strings/Violin Section/susVib/VlnEns_susVib_C4_v1.wav","Strings/Violin Section/susVib/VlnEns_susVib_C4_v2.wav",72,71,74],
  ["Strings/Violin Section/susVib/VlnEns_susVib_E4_v1.wav","Strings/Violin Section/susVib/VlnEns_susVib_E4_v2.wav",76,75,77],
  ["Strings/Violin Section/susVib/VlnEns_susVib_G4_v1.wav","Strings/Violin Section/susVib/VlnEns_susVib_G4_v2.wav",79,78,81],
  ["Strings/Violin Section/susVib/VlnEns_susVib_B4_v1.wav","Strings/Violin Section/susVib/VlnEns_susVib_B4_v2.wav",83,82,127],
];
const regions = [];
for (const [soft, loud, key, lo, hi] of ZONES) {
  // (VSCO's soft notes swell for two or three seconds, its loud ones are steady within one: each loops where it has
  // settled)
  regions.push({ file: soft, key, lo, hi, vlo: 0, vhi: 72, layer: 0, loop: { from: 2.2, by: 4.3 } });
  regions.push({ file: loud, key, lo, hi, vlo: 73, vhi: 127, layer: 1 });
}
export const RECIPE = {
  name: 'VSCO 2 CE Strings',
  repo: 'sgossner/VSCO-2-CE',
  commit: '440300901dfe9275fd84e0b7763af1f8443ae62e',
  source: 'https://github.com/sgossner/VSCO-2-CE',
  home: 'https://versilian-studios.com/vsco-community/',
  licence: 'CC0-1.0',
  licenceFile: { path: 'LICENSE', sha256: '36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673', must: /CC0 1\.0 Universal/ },
  docs: [{ path: 'Readme.txt', sha256: '101ddb88eb013900cc911834ecbdfbd49497bcd913bf09417160b9677952bb38', must: /You\s+are\s+permitted\s+to\s+use\s+these\s+samples\s+for\s+ANY\s+purpose/ }],
  credit: 'VS Chamber Orchestra 2: Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon Dalzell), https://vis.versilstudios.com/vsco-community.html: the contrabass, cello, viola and violin sections, sustained with vibrato (CC0 1.0).',
  qaName: 'vsco2ce-strings',
  sr: 44100,
  channels: 2,
  regions,
  head: -40,
  loop: { from: 0.7, min: 1.5, max: 1.9, by: 2.8, xfade: 0.4 },
  level: { mode: 'flat', measure: 'loop', across: 'even' },
  align: false,
  meta: { velcurve: [[1, -22], [36, -13], [100, -1.5], [127, 0]], env: { r: 0.4 } },
  build: "the contrabass, cello, viola and violin sections' sustains with vibrato, one section per register, two dynamics each; 16-bit by rounding (the 24-bit ones), kept at 44.1 kHz; each start 2 ms before the note first comes within 40 dB of its peak; a sustain loop of 1.5 to 1.9 s ending by 2.8 s (loud) or 4.3 s (soft), its 0.4 s crossfade baked in, the sample cut at its end; every sample at one level (its loop's), the dynamics from the velocity curve",
  waive: [
    { check: '12 phase coherence', why: 'the violin section is recorded wide: its L/R correlation over the first 300 ms is -0.4 to 0 on 6 of the 30 notes (F#4, E5, G5, B5), 3 to 5 dB lost if summed to mono. That is the spread of a section, kept as recorded and named for the listening room' },
    { check: '14 loop quality', why: 'a section bowing with vibrato never repeats closely: the 100 ms before a loop\'s two ends correlate 0.32 to 0.98 here (most 0.55 to 0.8), so the rubric\'s 0.9 (set on an organ pipe) is out of reach for any loop of 1.5 s. Each loop is picked for the best match of its ends and an even level (a step under 4.3 dB at every seam, most under 2), and crossfaded over 0.4 s at constant power for that correlation; sampler-test holds a note held 8 s within 3 dB on every register. For the room: the seams on C2 (both layers) and F#1 loud, the largest steps' },
  ],
  files: {
    "Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_F#0_v1_rr1.wav": "b965551477a816f38305f65b4cfa4595ca5c0d38e92c8b6128f070eb768671b5",
    "Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_F#0_v3_rr1.wav": "bc9070ac281edf964d9feac92b153325fec22e6a88b53a73acf2aa7850d1b9c3",
    "Strings/Cello Section/susvib/susvib_C1_v1_1.wav": "abdcea431f384e135c469b0f3e4ac2a437f282f521dc5bcbe22abc221536e8de",
    "Strings/Cello Section/susvib/susvib_C1_v3_1.wav": "19195ab85ab71626bd11e7100febdaeeba1c237ff5887b934fd0ffd8dfad82cb",
    "Strings/Cello Section/susvib/susvib_E1_v1_1.wav": "de31a61b02d4e1d5a79b8bc432b0f35fe2e434290ad34402cc0f2dd7dc278cde",
    "Strings/Cello Section/susvib/susvib_E1_v3_1.wav": "ee190b95be4f2416b9f41d248d255a4d7067b722f9b21482b30bc9872a9bb0d1",
    "Strings/Cello Section/susvib/susvib_G1_v1_1.wav": "9e5d24e8e28d6c7f650f9bb2b33d43c13e341a8bd33124c64e23881378b181ba",
    "Strings/Cello Section/susvib/susvib_G1_v3_1.wav": "e4c61d4ab855ec20ddb69ff608a1c066ff8a779ddd08d1dfe1d534d3a4563ad0",
    "Strings/Cello Section/susvib/susvib_B1_v1_1.wav": "4f95c087c4b8d87ee591e9d39c3c9caf085c6f1b9125eac3ca9e4e637da628ee",
    "Strings/Cello Section/susvib/susvib_B1_v3_1.wav": "8331a0e13f41243efab111f9b5e9185524c27ee48631269acecafc954ab7eaa8",
    "Strings/Cello Section/susvib/susvib_D2_v1_1.wav": "e8640dec9febc6e39fcf06b19d2c95a85d5ff8c38f13c9879e69f551eaf38ab8",
    "Strings/Cello Section/susvib/susvib_D2_v3_1.wav": "fc946615cd6550570c8f05d61c0d59b9079bf9daba8bf25be7943487fea5a7ae",
    "Strings/Viola Section/susvib/ViolaEns_susvib_G2_v1_1.wav": "557c2e033951015c30765bf18266bce0dd0412e3ca646dd1a225c32422c60662",
    "Strings/Viola Section/susvib/ViolaEns_susvib_G2_v2_1.wav": "e3552ebd2d1ac5d089cd2424d31ea88be8d887643311cb23abf5b416838ce2ba",
    "Strings/Viola Section/susvib/ViolaEns_susvib_B2_v1_1.wav": "ad96d747c5125adec8f069c49091ee3ba937efd4a5b909d3c4938f17e3c8513d",
    "Strings/Viola Section/susvib/ViolaEns_susvib_B2_v2_1.wav": "edc77038a83f47cf49296c0009fdac23cb5ade3133a2beabd0d2d1f591ccf3cb",
    "Strings/Viola Section/susvib/ViolaEns_susvib_D3_v1_1.wav": "61ab4cfc0ea90c683433a7c50b3bb4fa86a81c9d4854589562707d54ed028349",
    "Strings/Viola Section/susvib/ViolaEns_susvib_D3_v2_1.wav": "f941028c5d5e854b4391669056f0f639799f80ac7c8da3939c7788b1a394d16c",
    "Strings/Violin Section/susVib/VlnEns_susVib_F#3_v1.wav": "8dc13d197373f0d1fe1b0744de57796800bde372906d3667398c55d473a383ea",
    "Strings/Violin Section/susVib/VlnEns_susVib_F#3_v2.wav": "d7bc6b4c259b9543de4fe66228ee107205b8f539c8d7c1de71f5781d45a14fc7",
    "Strings/Violin Section/susVib/VlnEns_susVib_A3_v1.wav": "72817a53dfd2eb61eca94658c14e1cab6017629ca2f27bab8e394c6675bfaad7",
    "Strings/Violin Section/susVib/VlnEns_susVib_A3_v2.wav": "3fc4a9e22037643fce11e755da72c61c664893f83e637c24a7b5c2d3824ab986",
    "Strings/Violin Section/susVib/VlnEns_susVib_C4_v1.wav": "c07edd5b2119fa1da2207aba996961b50dd616f69bbcf2300ab271bc6c16239f",
    "Strings/Violin Section/susVib/VlnEns_susVib_C4_v2.wav": "5857387b40c412f756ef281c1171247664432a4e5078c98142d595d15cd92ef9",
    "Strings/Violin Section/susVib/VlnEns_susVib_E4_v1.wav": "787fb4bcfb47d5c88ee1573c8db15f32d345386301be4a8eea6a825847413ae2",
    "Strings/Violin Section/susVib/VlnEns_susVib_E4_v2.wav": "030c09a631ebbc7304fc0b47bb5c346cd646e7451d9fdc531870f2534c60d9e9",
    "Strings/Violin Section/susVib/VlnEns_susVib_G4_v1.wav": "ed2a89cf254432d2af073699fa43ebfa16cfbc5552c7fc964a184fc434eaaa39",
    "Strings/Violin Section/susVib/VlnEns_susVib_G4_v2.wav": "a1d6d5a0397541692e2f88a0cd9820eabe90407784ee631aa3bfa74772637a65",
    "Strings/Violin Section/susVib/VlnEns_susVib_B4_v1.wav": "ec4cea41ac77f251bf5f4158fe9cbeeae13755e3785106e505808de18fdddc0d",
    "Strings/Violin Section/susVib/VlnEns_susVib_B4_v2.wav": "bdb85532f47e4ebd681f9617a415116e7e5aeb786dce2eeab5ab9b93c1b31644"
  },
};
