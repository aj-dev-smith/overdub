// Karoryfer x bigcat cello (CC0), the melodic kit Endpin (core.cello) plays: what tools/fetch-kits.js downloads and
// how tools/kits/build.js lays it out. Pinned to one commit of the sfzinstruments repository, every file by SHA-256: a
// solo cello played by Kamila Borowiak, bowed sustains (the "bowed (velocity layer)" program's sustain map), from C2
// (the open C string) to A5, a zone every third semitone (as it was sampled), two of its four dynamics (mp and f).
//
// Why this cello, and these: of Karoryfer's CC0 solo instruments with character it measured second to Bear Sax (DC
// under -88 dBFS, every note within 13 cents, its loops 0.94 or better), and VSCO 2 CE, the studio's other bowed
// source, has no solo cello. Its four dynamics fit 8 MB only two at a time: mp and f climb on every note kept (p is
// 7 to 21 dB under mp and reads 11 to 20 cents off on A2 and C6), and the top zone (C6) is left out, its f quieter than
// its mp. The recordings are straight, without vibrato: Karoryfer's own programs add it with an LFO, which this kernel
// doesn't, so Endpin plays the bow as recorded.
//
// The licence: the repository's LICENSE is the full CC0 1.0 Universal text; its readme: "This sample library is
// royalty-free for all commercial and non-commercial use. The samples and sfz files are also open-source." Credited
// anyway.
//
// Karoryfer names these files an octave under where they sound (its C1 is the open C string, C2, 65 Hz, measured;
// its map plays it from key 24); every sample here sits at the key it sounds.
//
// The loops are Karoryfer's own: each file carries one in its smpl chunk, from about 1 s to the file's end (2.3 to 5.3
// s long). The build takes them as they are (nothing searched or baked) and the rubric's check 14 reads them. 32 mono
// samples at 44.1 kHz, about 149 s. Loudness: every sample at one level (its loop's), the dynamics from a velocity curve
// set from the two layers' measured distance (f 7.1 dB over mp on average, at the attack). A note read 5 to 25 cents
// off is tuned back by a tune field.
const NOTES = [
  // [Karoryfer's name, the key it sounds, lokey, hikey]
  ["C1",36,0,37],
  ["Eb1",39,38,40],
  ["Gb1",42,41,43],
  ["A1",45,44,46],
  ["C2",48,47,49],
  ["Eb2",51,50,52],
  ["Gb2",54,53,55],
  ["A2",57,56,58],
  ["C3",60,59,61],
  ["Eb3",63,62,64],
  ["Gb3",66,65,67],
  ["A3",69,68,70],
  ["C4",72,71,73],
  ["Eb4",75,74,76],
  ["Gb4",78,77,79],
  ["A4",81,80,127],
];
const regions = [];
for (const [n, key, lo, hi] of NOTES) {
  regions.push({ file: `Samples/sus/${n}_mp_d.wav`, key, lo, hi, vlo: 0, vhi: 80, layer: 0 });
  regions.push({ file: `Samples/sus/${n}_f_d.wav`, key, lo, hi, vlo: 81, vhi: 127, layer: 1 });
}

export const RECIPE = {
  name: 'Karoryfer x bigcat cello',
  repo: 'sfzinstruments/karoryfer-bigcat.cello',
  commit: '6fd75fbfc1dbb3109bf26220ba1adea46188a18b',
  source: 'https://github.com/sfzinstruments/karoryfer-bigcat.cello',
  home: 'https://www.karoryfer.com/karoryfer-samples/wydawnictwa/karoryfer-x-bigcat-cello',
  licence: 'CC0-1.0',
  licenceFile: { path: 'LICENSE', sha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499', must: /CC0 1\.0 Universal/ },
  docs: [
    { path: 'readme.txt', sha256: 'b16bba9b900a0d69f665c0e9ef0010f5f039e27a883aebe4f0b245335a93683c', must: /royalty-free for all commercial and non-commercial use/ },
    { path: 'Programs/01- Bowed (velocity layer).sfz', sha256: 'e3eba9a133e4afeafdc5ad5d891ded46ad5a79b21423a71e61ae14c6e8dc4dd3', must: /vc_arco_sus_map\.sfz/ },
    { path: 'Programs/vc_arco_sus_map.sfz', sha256: '180d50009a3d35104158e3720df085d142dab26705c71121b3bc0093cd9808ff', must: /C1_mp_d\.wav\s+lokey=24/ },
  ],
  credit: 'Karoryfer x bigcat cello by Karoryfer Samples and bigcat instruments, played by Kamila Borowiak: bowed sustains (CC0 1.0).',
  qaName: 'karoryfer-bigcat-cello',
  sr: 44100,
  channels: 1,
  regions,
  head: -30,
  loop: { file: true },
  tune: 'measure',
  level: { mode: 'flat', measure: 'loop', across: 'even' },
  align: false,
  meta: { velcurve: [[1, -22], [40, -7.1], [100, -1], [127, 0]], env: { a: 0.02, r: 0.3 } },
  build: 'the bowed program\'s sustains, a zone every third semitone from C2 to A5, mp and f; mono as recorded, 24-bit to 16-bit by rounding, kept at 44.1 kHz, each sample at the key it sounds (the files are named an octave down); each start 2 ms before the note first comes within 30 dB of its peak; each sample loops on the loop its file carries (Karoryfer\'s own, unchanged); a tune field for a note read 5 to 25 cents off; every sample at one level (its loop\'s), the dynamics from the velocity curve',
  waive: [],
  files: {
    "Samples/sus/C1_mp_d.wav": "14e83283c83be511550e2971ef329f9a8095df76f0f3b1a4a3f96dfb62e57b04",
    "Samples/sus/C1_f_d.wav": "c040f0afa33b3b0e306fb4fc587d3230c1d0edd5e037ecba7a771e8d4a94fa71",
    "Samples/sus/Eb1_mp_d.wav": "f414c8c0726f6519b9089431ef362e0c52fa0cc3946edd02c4010e09dcdf47e8",
    "Samples/sus/Eb1_f_d.wav": "b7271381fda448568dba7d984bcf80bbee8a059fad2f044dbe9dc84fdb3328e8",
    "Samples/sus/Gb1_mp_d.wav": "67f96fe3e1588cbbb69e59609cc82dfab9919cf383a70181b111e0d24b874d78",
    "Samples/sus/Gb1_f_d.wav": "a35df8cddbc4e7184fa4489e961d810e65df22e8d083bf4377be026857b0864c",
    "Samples/sus/A1_mp_d.wav": "c1d9ded05620fb226153be709d83805f789119588019cdff827ac09d2cd6cf7d",
    "Samples/sus/A1_f_d.wav": "9c150416897e1cc4e4b09d99d282edc6cab6220baac1b216de6b9f2e63c7c35d",
    "Samples/sus/C2_mp_d.wav": "ead656a360c21f14480c57072216e0ecd9a85fc59b92646ce7e6bc3baeca96ec",
    "Samples/sus/C2_f_d.wav": "4f66e5c4ff25db201ab54bb6798cd9f087fbe18f7f552ee44a9ac948a2e18480",
    "Samples/sus/Eb2_mp_d.wav": "17ee99a5d4f8211f0829d8dca0cefdda9d2a98206ae7912c1e768c7818e9d969",
    "Samples/sus/Eb2_f_d.wav": "3399ebcc266066739f8aa0dc259a111b704d8785d2adc4ec6af63bc624ef4318",
    "Samples/sus/Gb2_mp_d.wav": "677439c2c36a0e7e12347acd769d7657828fd16bab2f3701b6d9bd4dcad38412",
    "Samples/sus/Gb2_f_d.wav": "8169b0718ada9f746c0b965dbdfec948b78b2b336d78b66a9768baa5acbb50db",
    "Samples/sus/A2_mp_d.wav": "9f63b3c8b6d54ad1a17425d45fb2e6c0ebd8c6803f5b84132470f3a6861ecca1",
    "Samples/sus/A2_f_d.wav": "723a64efc2005e8404ad547710258a825adb020fae3c677a0094b7b4a92cdf2c",
    "Samples/sus/C3_mp_d.wav": "89b45a0b7ecef5558406d4244fc4ce16626b21a7e1af29ed847e12772e5c8e77",
    "Samples/sus/C3_f_d.wav": "9a16c626ec87e63718481932d0a940ee066c4fdbac234e96f5d1959ca70b5051",
    "Samples/sus/Eb3_mp_d.wav": "fbe9e2780d99c48884484d384e7d7113905a770dfaa758deb27c40ac23e777f6",
    "Samples/sus/Eb3_f_d.wav": "323aec951c67c784236e00b41b5f1daaa8d08c7ea2a8714e1e13cb50f2558c1d",
    "Samples/sus/Gb3_mp_d.wav": "242ae0ef622e6790e45d5d0a721eb4d8fe405b7bceba68a226b6a2267813ffe4",
    "Samples/sus/Gb3_f_d.wav": "ea9cb894bcb32f7be2fadadeae57d41a1272bf9e28694839839fe6667aae2d79",
    "Samples/sus/A3_mp_d.wav": "caa7f43c69297c7a967c30277eb6a479f939168c1f6e6938f0bd1024a514ec57",
    "Samples/sus/A3_f_d.wav": "56b949a6c5b7c755ba22d01d2d985843b65653a523ccfddeabbe261b6038eb5f",
    "Samples/sus/C4_mp_d.wav": "6139c159497862a5f79d3a6a491c51540112850aec191e6bbf21780eb03765db",
    "Samples/sus/C4_f_d.wav": "a8c6866e98eded0e497d5192109ce0baeb189566e46c5015e845a845e4b7d5b8",
    "Samples/sus/Eb4_mp_d.wav": "f00251d223ea734dfe264e455e78b56e34e36a2237c6cd04cab2d7f3513cdca3",
    "Samples/sus/Eb4_f_d.wav": "c6e7b87304933cc7c647c95722f9fc0ff503c46c1de911082e9b0d7967e5dac4",
    "Samples/sus/Gb4_mp_d.wav": "12698c08e27b8780e715fc4399e624261086256c95db11a0a295b310f6fcb22f",
    "Samples/sus/Gb4_f_d.wav": "eb65449ea92128d0d1aa8adebe4468c6a900b663327676edaf9446336824f580",
    "Samples/sus/A4_mp_d.wav": "7785946313133cb2b45984eed547877ad2b66c69d292c00ac4d4826d2702c2a2",
    "Samples/sus/A4_f_d.wav": "6a53e4c82739e46f3ab4170090a58b6bc2747b45e180f23e0453543867d59504"
  },
};
