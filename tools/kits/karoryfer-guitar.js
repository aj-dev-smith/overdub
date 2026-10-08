// Black And Green Guitars (Karoryfer Samples, CC0), the melodic kit Hollow Body (core.eguitar) plays: what
// tools/fetch-kits.js downloads and how tools/kits/build.js lays it out. Pinned to one commit of the sfzinstruments
// repository, every file by SHA-256: "green", the set's Gretsch Anniversary hollow body, its ordinary picked notes
// ("twang", the green twang program's map), from the open low E (E2) to C#6, a zone every third semitone, all three of
// its dynamics (p, mf, f) and two round robins each.
//
// Why this guitar: Karoryfer's two CC0 electric guitar sets were measured against each other (the rubric, every check,
// on a note every fifth semitone at each dynamic). Black And Green's green Gretsch is the cleaner: SNR 58 to 98 dB
// against Emilyguitar's 51 to 72 (its floor sits at -73 to -86 dBFS and its notes are cut at 4.2 s, 51 to 66 dB under
// their attack), and its dynamics climb on every note, where Emilyguitar's f is quieter than its mf on two of eight
// (A3, A4: check 9 rejects) and its low E's f is clipped flat. The black Hofner in the same set is noisier still (SNR
// 44 to 73). Recorded by Brian Wood: dry, mono, 24-bit.
//
// The licence: the repository's LICENSE is the full CC0 1.0 Universal text; its readme: "Royalty-free for all
// commercial and non-commercial use." Credited anyway.
//
// Karoryfer names the files an octave above where a guitar sounds (guitar parts are written an octave up): its
// twang_e3 is the open low E, E2 (82 Hz), and its map plays it from key 40. Here every sample sits at the key it
// sounds (measured: every file within 11 cents of it).
//
// The budget is 4-8 MB. Each note cut where it falls 50 dB under its attack, or at 3.4 s (to G3), 3 s (to C#5) or 2.4
// s, with a squared fade over its last 1.2 s; mono as recorded. The dynamics keep their timbre and lose their level:
// every sample is set to one level, and the velocity curve makes the dynamics through the layers' measured levels
// (the attack's RMS over 150 ms, the mean of every note: p 20.2 dB under f, mf 8.3). A note read 5 to 25 cents off
// is tuned back by a tune field (the Gretsch's upper frets run flat, by up to 11 cents at A#6).
const NOTES = [
  // [Karoryfer's name, the key it sounds, lokey, hikey]
  ['e3', 40, 0, 41],
  ['g3', 43, 42, 44],
  ['bb3', 46, 45, 47],
  ['db4', 49, 48, 50],
  ['e4', 52, 51, 53],
  ['g4', 55, 54, 56],
  ['bb4', 58, 57, 59],
  ['db5', 61, 60, 62],
  ['e5', 64, 63, 65],
  ['g5', 67, 66, 68],
  ['bb5', 70, 69, 71],
  ['db6', 73, 72, 74],
  ['e6', 76, 75, 77],
  ['g6', 79, 78, 80],
  ['bb6', 82, 81, 83],
  ['db7', 85, 84, 127],
];
const LAYERS = [
  ['p', 0, 42],
  ['mf', 43, 84],
  ['f', 85, 127],
];
const regions = [];
for (const [n, key, lo, hi] of NOTES)
  LAYERS.forEach(([L, vlo, vhi], layer) =>
    [1, 2].forEach((rr) =>
      regions.push({ file: `Samples/green/ord/twang_${n}_${L}_rr${rr}.wav`, key, lo, hi, vlo, vhi, layer, rr: rr - 1 }),
    ),
  );

export const RECIPE = {
  name: 'Black And Green Guitars: green',
  repo: 'sfzinstruments/karoryfer.black-and-green-guitars',
  commit: 'b3b3249d37dc977a1a297bd2dc053e6d9b6b805c',
  source: 'https://github.com/sfzinstruments/karoryfer.black-and-green-guitars',
  home: 'https://www.karoryfer.com/karoryfer-samples/wydawnictwa/black-and-green-guitars',
  licence: 'CC0-1.0',
  licenceFile: {
    path: 'LICENSE',
    sha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499',
    must: /CC0 1\.0 Universal/,
  },
  docs: [
    {
      path: 'readme.txt',
      sha256: 'c5de1216ecef300f0bf3337c04b40f1b7e11e5d0ee172269a1ac344b7819b595',
      must: /Royalty-free for all commercial and non-commercial use/,
    },
    {
      path: 'Programs/04-green_twang.sfz',
      sha256: 'b7dfad94d6521201261ad46ea0360bc63ce9e6ced541355046bebd795777b540',
      must: /maps_green\/ord\.sfz/,
    },
    {
      path: 'Programs/modules/maps_green/ord.sfz',
      sha256: '738d3676ae77f9a12cab3736645b61d39b466306777b608a7108337ad073a1e0',
      must: /twang_e3_p_rr1\.wav\s+lokey=40/,
    },
  ],
  credit:
    'Black And Green Guitars by Karoryfer Samples, recorded by Brian Wood: the green Gretsch Anniversary, picked (CC0 1.0).',
  qaName: 'karoryfer-green',
  sr: 44100,
  channels: 1,
  regions,
  cut: {
    rel: -50,
    cap: [
      [43, 3.4],
      [61, 3],
      [127, 2.4],
    ],
    fade: 1.2,
  },
  tune: 'measure',
  level: { mode: 'flat', measure: 'attack', across: 'even' },
  align: true,
  meta: {
    velcurve: [
      [1, -30],
      [21, -20.2],
      [63, -8.3],
      [106, -0.4],
      [127, 0],
    ],
    env: { r: 0.15 },
  },
  build:
    "the green twang program's ordinary notes, a zone every third semitone from E2 to C#6, p, mf and f, round robins 1 and 2; mono as recorded, 24-bit to 16-bit by rounding, kept at 44.1 kHz, each sample at the key it sounds (the files are named an octave up); each note cut where its 100 ms RMS falls 50 dB under its attack, or at 3.4, 3 or 2.4 s by register, with a squared fade over its last 1.2 s; a tune field for a note read 5 to 25 cents off; every sample at one level, the dynamics from the velocity curve; each layer lined up with the next layer up",
  waive: [],
  files: {
    'Samples/green/ord/twang_e3_p_rr1.wav': '63ba7d12a642325104af0fa227155277c9e2ad9097fe666cedfeb1f009c704a3',
    'Samples/green/ord/twang_e3_p_rr2.wav': 'cf02c103f9e25052a35862c7fec75029e4ca27f79749139ae463a9001372fea1',
    'Samples/green/ord/twang_e3_mf_rr1.wav': 'a839c8a67e29ab9c3c5ac9da52af4ee62f0ce721262c28772720223b8e7eb249',
    'Samples/green/ord/twang_e3_mf_rr2.wav': '8038b324bf1a2b069fbf8117d1f47952fc746d8bcb65e6d6cc1a4094b3d10d84',
    'Samples/green/ord/twang_e3_f_rr1.wav': 'fc1e4da6de242d7197f8efac253cc3b0c49328a7075646f10c0a7a74dabcea7c',
    'Samples/green/ord/twang_e3_f_rr2.wav': '27cf20436bc2334dbc6fbf790d4adbfce1fcac4f423321e1f35a85eedc8118ff',
    'Samples/green/ord/twang_g3_p_rr1.wav': 'e28b227ce2e9c8016eb62ac447b1a168aa4c3492e1be3c51021e84bf217820c0',
    'Samples/green/ord/twang_g3_p_rr2.wav': 'ed0c6541c0ecd422a0552309a810c7571eadce9a14075d1eb1309a419116da0c',
    'Samples/green/ord/twang_g3_mf_rr1.wav': '07155e3d554cc0ddd4e8409f4ba31a601f169479ad5e5685738b1288d6c0d1a9',
    'Samples/green/ord/twang_g3_mf_rr2.wav': 'e1c45396eb397828f081b08c2ce8ca5f9b9d203822fe7ad9b6cdf1027eecd129',
    'Samples/green/ord/twang_g3_f_rr1.wav': 'b47c4558bfafe59cd66575f4623bd8967351c4846c67d0e0cc26e480ce21ee61',
    'Samples/green/ord/twang_g3_f_rr2.wav': '57fd5a93a1654dc21f1a223607b38ecbfbe17c81bbdc488a70eff650e740a690',
    'Samples/green/ord/twang_bb3_p_rr1.wav': '646fb24818dc9ed20009c3d27b3058f15a5d03ee9b3560e570de24a0710529ed',
    'Samples/green/ord/twang_bb3_p_rr2.wav': 'd61e83112110d36c4931358e87802fa7f3012c2a78d9b38595786ba204b67d14',
    'Samples/green/ord/twang_bb3_mf_rr1.wav': '0057324f9ef12fb9007ed1c9218a46fa8ca4a4d428a75ddd22e8afdab52c035b',
    'Samples/green/ord/twang_bb3_mf_rr2.wav': '365c84f4423f9eb46561db8d93be16ff4b5288d7e8f36b0efa40a553676733fe',
    'Samples/green/ord/twang_bb3_f_rr1.wav': 'a3cb4d7d7a754ed3eae8f447e8bc9d38ca40170c1ec42c6ec5db19fc81fdd2f6',
    'Samples/green/ord/twang_bb3_f_rr2.wav': '868e97fd7b5d5a110bb3273212d5fc68cebfe285ebf7268ad010899b66b5b19d',
    'Samples/green/ord/twang_db4_p_rr1.wav': 'ef65dbc1cef3e786b1b4377a7bed5ee64c8aec3b8ac93d996681c6e582fb8a67',
    'Samples/green/ord/twang_db4_p_rr2.wav': '570db08a5664e70e78670c2774be1c52b9259dfa9cb5264cfe81266103cb4e9e',
    'Samples/green/ord/twang_db4_mf_rr1.wav': '19285ce4a7dc794e47cdd1fe98e0d4a22260c62186ef9d0c0df341f0a53edc33',
    'Samples/green/ord/twang_db4_mf_rr2.wav': '233c9d5b3112229c34a777f05ee5d62cd53d6d0e09a1cf4281efab5ec8853390',
    'Samples/green/ord/twang_db4_f_rr1.wav': '1b2268d6820afce0e27df037bb79bdfbcf97cf91431c4222dbf8c64c584ae48a',
    'Samples/green/ord/twang_db4_f_rr2.wav': '5929b502b797122e872a51628ca4b61a0a94f589107b690bd9a2bf5d12b80086',
    'Samples/green/ord/twang_e4_p_rr1.wav': '235bc84a8f35f2e699d3ef8109e7d4b8cafbe59c8dca8527323bae632916ca0d',
    'Samples/green/ord/twang_e4_p_rr2.wav': '6f0c893d7e86a8b66ca88e2dde991d39853ae62584fff666529a1c4ce9615fba',
    'Samples/green/ord/twang_e4_mf_rr1.wav': 'd8dd360dca1a306949b16e1ed0acc4dfdc7533e4d9ae5f56ad9867291638702f',
    'Samples/green/ord/twang_e4_mf_rr2.wav': 'b77859c199584d6e2d2dae36b12532f21af45a98469f1c5c5218c2dc81b74bc4',
    'Samples/green/ord/twang_e4_f_rr1.wav': 'a6ce7bcae9306a040a7d55b636f9f7cd977fc50ccf7525fa758680ed753b1880',
    'Samples/green/ord/twang_e4_f_rr2.wav': '56844878fb8ae2fb53dd7a151c9918c010d2a7c3a8d9b4c402fc644d53e9b3b2',
    'Samples/green/ord/twang_g4_p_rr1.wav': 'cb651e5183f683c4e1d79527c3005f4d16548ac107e5479ce960f02b58172ee7',
    'Samples/green/ord/twang_g4_p_rr2.wav': 'a41e6a5121a7cb67fe645fbcba3ec136c63b6d7002c9f4712165e4669471365b',
    'Samples/green/ord/twang_g4_mf_rr1.wav': '5281bb39ee797565282c4f71d670448c07ca0c430a76b7c6380c0ce524b44f11',
    'Samples/green/ord/twang_g4_mf_rr2.wav': 'fa4c7125a57c145932f280641dc2520aaa3602bc9a8012cc9707a9b060a2df80',
    'Samples/green/ord/twang_g4_f_rr1.wav': '1d337f5715561d201eda56d86a7d41929ee1e6d9fcc57c6b81e81c40c4daff7a',
    'Samples/green/ord/twang_g4_f_rr2.wav': '77f5b5855b69684a496b701dea48a08e9a2728f7a77e890c53e93d29127ae7cf',
    'Samples/green/ord/twang_bb4_p_rr1.wav': 'b3ea98f323221e56aa6b6cadaf62ea729c6cd9b5ff1671ef390062759509b7f2',
    'Samples/green/ord/twang_bb4_p_rr2.wav': '5935fd662557f07e98cdd2b6d5b8ec3f75109f6c71d7d921c9083f5ee9fcbaaa',
    'Samples/green/ord/twang_bb4_mf_rr1.wav': '947e2ed04fabf2ca9ebaf1c31110c8c1ba7039993ef07263221222ffb86e59b6',
    'Samples/green/ord/twang_bb4_mf_rr2.wav': '95d8ad2cb4b19f20ff2677d9b8dbac918410ae8a540e5b7ba6a1f1610835e148',
    'Samples/green/ord/twang_bb4_f_rr1.wav': '79a47338f2c1670f75fcae78595fb5350b865b812279e9d2f6a62e9199bb137a',
    'Samples/green/ord/twang_bb4_f_rr2.wav': '63782746718d008e43ac382e19fb80b2925e64a9e212308c1888d2fce871e845',
    'Samples/green/ord/twang_db5_p_rr1.wav': 'd57bde0c1ed106dd691651ee4f48ac65fc17928ad66ce77592e739fef19b88af',
    'Samples/green/ord/twang_db5_p_rr2.wav': '09f1683e4287c97f6fee03e06ae51b48456e08581726f22e234a684a948c0b95',
    'Samples/green/ord/twang_db5_mf_rr1.wav': 'f9577eaab83568547a6a57050646753fd061b6ded05548287b82fb9e14dffd4c',
    'Samples/green/ord/twang_db5_mf_rr2.wav': '7bdb7b1548d0a4dbc9945403902cf170a11922d277a6165689d977c475710456',
    'Samples/green/ord/twang_db5_f_rr1.wav': '45c4e742d0db08a4bd95ce25360a09e0d9aecdeb5520fb9a297b01dc60546e54',
    'Samples/green/ord/twang_db5_f_rr2.wav': '061cb2f0791258fc1281e1e0a954c7a1dbde092b07efb3d5cbd96b8c89306303',
    'Samples/green/ord/twang_e5_p_rr1.wav': '06fa02d07e522ab04c696f7c46bf7f27d3491c7f3ac83e600556899fd49fb831',
    'Samples/green/ord/twang_e5_p_rr2.wav': '0b3408bea7103c2864edc6c4063431443d9168cda36c09b79a90df0656f3d8ae',
    'Samples/green/ord/twang_e5_mf_rr1.wav': '5be9d64bb782ee361013d5fdc28b1aeacc1c2f3dac70cea74141c57b6eb13dd5',
    'Samples/green/ord/twang_e5_mf_rr2.wav': '07646e3e92fae157e2c2425b9c262e71120176fc36a5935918da42e1b54ab21b',
    'Samples/green/ord/twang_e5_f_rr1.wav': '0b72556525eca921f3c8789e95046a0f8c078638d4686007f65e82f83c273cf0',
    'Samples/green/ord/twang_e5_f_rr2.wav': 'dd09ed1db41336932b8c0728f647eff082c023f8962911329aaaf9dc694def7c',
    'Samples/green/ord/twang_g5_p_rr1.wav': '6e29a399b8e33b59f6fb60b50cf5efa8f570f6b6377a3db440ffd70756524070',
    'Samples/green/ord/twang_g5_p_rr2.wav': '987a398d5020a58e3c26afc49bff39e09c6bf1ad40aeec0b6004aeac55a09a68',
    'Samples/green/ord/twang_g5_mf_rr1.wav': '721315752766e4a3f70b30ba389569db394557e9a892a42a072ddfeb38173797',
    'Samples/green/ord/twang_g5_mf_rr2.wav': '537c7e25427a11bbd60c58dbf541ee3754d782bbf0e3102f84ca2a42150f9810',
    'Samples/green/ord/twang_g5_f_rr1.wav': '48f192cae2dfa586850129fb1b046a7630b4fb341d320050b2a1e3a43467b2f5',
    'Samples/green/ord/twang_g5_f_rr2.wav': 'ec8347ee97a6fe0bd145102c36ebdb96eb985ea85ef013606199963f179c0df3',
    'Samples/green/ord/twang_bb5_p_rr1.wav': 'cf64de1567b3ee605d38de12b444acf24fe1f00978985aecb351c17fa09985f9',
    'Samples/green/ord/twang_bb5_p_rr2.wav': '0b9572fc8b0131dc82a9bb1dce115711b8aa2c8a86522f3c6161862bc30de85a',
    'Samples/green/ord/twang_bb5_mf_rr1.wav': '6f613ceac7f5cbfef2b7b3b9db4fb1d1fd8138548e8765db25902bd6045e3e03',
    'Samples/green/ord/twang_bb5_mf_rr2.wav': '14181c596e3e399dd004a176d36bc875465909136369caa0a16c2dd4d4371002',
    'Samples/green/ord/twang_bb5_f_rr1.wav': '459ed0135b77086b680b70d935130c72b7f88c8b12555b284a4aab44e6579cfb',
    'Samples/green/ord/twang_bb5_f_rr2.wav': 'fb47edab92f59136ae5f98605e0b155f18690e7e5b69c7270f8ffec6c2de362b',
    'Samples/green/ord/twang_db6_p_rr1.wav': 'b12937ecc01d934e0eece883625dd9e3b33199badb9bf3ee0482784ffa6aaa71',
    'Samples/green/ord/twang_db6_p_rr2.wav': '9d74451165eb3d3fa9e6502e101bb289786ab1b3655736ad4b17e8d43f49c770',
    'Samples/green/ord/twang_db6_mf_rr1.wav': '0c1585dfebbfd9ab2e8ba5260382df0b0551be5f8b057134f5b50bacb5b49420',
    'Samples/green/ord/twang_db6_mf_rr2.wav': 'c5daac1922fb4f41dc594ef0b36802670c2fe6f80f2d5ccc56b884f738fcbe00',
    'Samples/green/ord/twang_db6_f_rr1.wav': '64dbcf66cd25b5772c957a017edac4262066a5fd7219472c8c18cb30f86505ff',
    'Samples/green/ord/twang_db6_f_rr2.wav': 'c79d5629fae8b04c89cf395e46743448660f31cf82a4a17d2aeeb66fffd41b1e',
    'Samples/green/ord/twang_e6_p_rr1.wav': 'ad694ab0788d3cd877149999b0b0bda1e1d0f7e700908e7a2c49528bc18363bb',
    'Samples/green/ord/twang_e6_p_rr2.wav': '8b070ae91ae80cbf1d39305bbeeda13aa8bee23b179957523d6c13f4126416d7',
    'Samples/green/ord/twang_e6_mf_rr1.wav': '9e9696255bcb57049a7009406180cbda28dd1bfb8493ab4cec368f5cfec80c7b',
    'Samples/green/ord/twang_e6_mf_rr2.wav': '6daf59ea60db43362f50ec572dcf0789a874bab05184d9adbe230d4a20ba6570',
    'Samples/green/ord/twang_e6_f_rr1.wav': '356fa84a87ff315dc4f8e53c12bc4f576358b52d6c433bc07b8ba38e901693bd',
    'Samples/green/ord/twang_e6_f_rr2.wav': 'd12f2a30667f116a8e2f67aa3e1efb9f0c89a3f4d97a1e94c83f9e5de8c38ff7',
    'Samples/green/ord/twang_g6_p_rr1.wav': '7212a08da39c1309f136c99c897e9836c4e935b0fc3d7aab696ae41bb8b7a45c',
    'Samples/green/ord/twang_g6_p_rr2.wav': '3609125a49829f36f7594cb66322b08dc3d9afe5a4ebc5c93dd1a2876db93b82',
    'Samples/green/ord/twang_g6_mf_rr1.wav': 'd66282234e7872dab1ed003dbfbdf2501a088dfaa902ee8d301d4d5babbc72c2',
    'Samples/green/ord/twang_g6_mf_rr2.wav': '2732df5b0379c8dbb986ffcd82805c026bdd7c22725ee33cc2c40b1241e3b728',
    'Samples/green/ord/twang_g6_f_rr1.wav': 'bd6fb1c564b5adccf1d1a54da5c9f9f315ee3fa58d1f5a4001a758ea94039ebc',
    'Samples/green/ord/twang_g6_f_rr2.wav': 'c876e0fd412bb2768effd350bff7e276dd501531db34d9ad702cdcfe5acd5399',
    'Samples/green/ord/twang_bb6_p_rr1.wav': 'a744386d8990f82779169b982a3d219d9908062c6181c7359bbbca053a1f8ecc',
    'Samples/green/ord/twang_bb6_p_rr2.wav': '1ae830cd7601c99d237711cb1998cabfb00cbd85869a136d3db4fab26a6e77e3',
    'Samples/green/ord/twang_bb6_mf_rr1.wav': 'f68f26031ee8db933bd4f8c98f3c9aa2050846940c736b7440c8c19781005801',
    'Samples/green/ord/twang_bb6_mf_rr2.wav': '6cecc2884d85e454c151579db6d3b07c4f0fc6bc3e5b241e019766fd01d49c59',
    'Samples/green/ord/twang_bb6_f_rr1.wav': 'c6b2941b5fe9831fe6d2c362179ce66ce9602661a35024f7e559407db8cea3fb',
    'Samples/green/ord/twang_bb6_f_rr2.wav': '78b858dcee5dbcff813e2c18c9d8ed7869f1db32cafd936c3ab647343283749d',
    'Samples/green/ord/twang_db7_p_rr1.wav': '9f0afe10f7a2603209107a99eb256816b489cf0f824ffe2647f8fc0ae5cb9f1f',
    'Samples/green/ord/twang_db7_p_rr2.wav': '20ef14df1c460f2faa449f61f526f9b6f4fdaf9b33f86748b1bb635583bc2914',
    'Samples/green/ord/twang_db7_mf_rr1.wav': '62636dfcb7549b196cd4763682d005b1b3c75542927f96267659cbd1b8573a9d',
    'Samples/green/ord/twang_db7_mf_rr2.wav': 'bae592c7e849df52363247c762028b606d25b6ead4332ff67179cddda6763d2d',
    'Samples/green/ord/twang_db7_f_rr1.wav': '8c8d204cabf17019076f72bf7b2e6e5371c15aea097b3ae6ffed265997933a73',
    'Samples/green/ord/twang_db7_f_rr2.wav': 'e4da7e6e5387c61efb35b9b7a90f1485d056a64fd656260646beb2f91d67f3e8',
  },
};
