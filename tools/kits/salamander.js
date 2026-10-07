// Salamander Grand Piano V3 (Alexander Holm), the melodic kit Full Stick (core.grand) plays: what tools/fetch-kits.js
// downloads and how tools/kits/build.js lays it out. Pinned to one commit of the sfzinstruments FLAC edition, every file
// by SHA-256: 3 of its 16 velocity layers (v4, v10, v16) at all 30 of its notes (a minor third apart, A0 to C8), and
// the dampers' release noise at the same 30 keys. A Yamaha C5, recorded at 48 kHz/24-bit by two AKG C414s in AB about
// 12 cm above the strings.
//
// The licence. Alexander Holm put all his sampled instruments in the public domain on 2022-03-04
// (https://rytmenpinne.wordpress.com/2022/03/04/good-news-everyone/: "I've decided to public domain all my sampled
// instruments! yay! They are all yours now and you may do whatever you wish!"; the product page,
// https://rytmenpinne.wordpress.com/sounds-and-such/salamander-grandpiano/: "As of 4.3.2022, this is now public
// domain!"). The repository still carries the CC-BY 3.0 it was released under before that (its LICENSE, pinned
// here), which would cover us as well: either way he is credited, on the device and in docs/SOUNDS.md.
//
// The mapping is the source's own (Data/region.txt: each note's keys; the velocity bounds between the layers kept are
// halfway between the source's own bounds for them: v4 37-43, v10 73-80, v16 121-127). The SFZ leans on ARIA
// extensions, so the regions are written out here. The loudness comes from the velocity curve below, measured from the
// source's 16 layers; the three kept give the timbre, lined up so they crossfade without cancelling.
//
// The budget is 15 MB packed, and it decides the cut. The notes run 3 to 25 s in the files: four layers at full length
// would be about 1,560 s of audio, roughly 45 MB, and even four layers cut short came to 17 MB. So three layers, the
// soft, the middle and the hardest, each note ending where it falls 50 dB under its attack or at a length by register
// (4.6 s to F#2, 3.7 s to F#4, 3 s to F#5, 2.6 s above), whichever is sooner, with a squared fade over its last 1.5 s,
// so a held note dies a little early rather than stops. 14.8 MB.
const NOTES = [
  // [name, lokey, hikey, pitch_keycenter]: Data/region.txt
  ['A0', 21, 22, 21], ['C1', 23, 25, 24], ['D#1', 26, 28, 27], ['F#1', 29, 31, 30], ['A1', 32, 34, 33], ['C2', 35, 37, 36],
  ['D#2', 38, 40, 39], ['F#2', 41, 43, 42], ['A2', 44, 46, 45], ['C3', 47, 49, 48], ['D#3', 50, 52, 51], ['F#3', 53, 55, 54],
  ['A3', 56, 58, 57], ['C4', 59, 61, 60], ['D#4', 62, 64, 63], ['F#4', 65, 67, 66], ['A4', 68, 70, 69], ['C5', 71, 73, 72],
  ['D#5', 74, 76, 75], ['F#5', 77, 79, 78], ['A5', 80, 82, 81], ['C6', 83, 85, 84], ['D#6', 86, 88, 87], ['F#6', 89, 91, 90],
  ['A6', 92, 94, 93], ['C7', 95, 97, 96], ['D#7', 98, 100, 99], ['F#7', 101, 103, 102], ['A7', 104, 106, 105], ['C8', 107, 108, 108],
];
// the source's Retuned set (Data/tune_ret.txt, by Markus Fiedler), cents per note: as recorded the C5 is stretch-tuned
// from about 30 cents flat in the low bass to 40 sharp at the top, which sits badly against anything in equal temperament
const TUNE = [10, 13, 11, -3, -9, -9, -11, -7, -4, 0, -6, -3, -3, -6, -3, 0, -4, -8, -8, -5, -7, -8, -12, -13, -12, -17, -17, -27, -38, -38];
// [source layer, lovel, hivel]
const LAYERS = [[4, 1, 58], [10, 59, 100], [16, 101, 127]];
const regions = [];
NOTES.forEach(([n, lo, hi, key], z) => {
  // the outer zones reach the ends of the keyboard
  const L = z === 0 ? 0 : lo, H = z === NOTES.length - 1 ? 127 : hi;
  LAYERS.forEach(([v, vlo, vhi], layer) => regions.push({ file: `Samples/${n}v${v}.flac`, key, lo: L, hi: H, vlo, vhi, layer, tune: TUNE[z] }));
  // the damper's release noise (Data/hammer.txt: rel<k - 20> is key k's; volume -37 dB, rt_decay 2 dB per second
  // held), the zone's own key's, but A4's is clipped at the source (a flat top), so that zone takes A#4's
  const rk = key === 69 ? 70 : key;
  regions.push({ file: `Samples/rel${rk - 20}.flac`, key: rk, lo: L, hi: H, vlo: 0, vhi: 127, layer: 0, trig: 'release', gain: -37 });
});
// The velocity curve: how loud the source plays each velocity with all 16 layers. Each layer's level under v16's (the
// attack's RMS over 150 ms, the mean of all 30 notes; measured from these files) at the middle of its velocity range,
// plus the source's amp_veltrack of 73% there (20 log10(0.27 + 0.73 (vel / 127)^2)). The build sets every sample to
// one level (each key on one curve across the keyboard), so the three layers kept give the timbre and this curve the
// loudness: from velocity 1 to 127 it spans about 33 dB, as the source does, without a step at a layer seam.
const LAYER_DB = [-22.06, -17.49, -14.97, -13.10, -11.84, -10.83, -9.79, -8.95, -8.05, -7.19, -6.25, -5.29, -4.08, -2.88, -1.44, 0];
const LAYER_MID = [13.5, 30.5, 35.5, 40, 45, 48.5, 53.5, 60.5, 68.5, 76.5, 84.5, 92.5, 100.5, 108.5, 116.5, 124];
const vt = (v) => 20 * Math.log10(0.27 + 0.73 * (v / 127) ** 2);
const velcurve = [[1, LAYER_DB[0] + vt(1)], ...LAYER_MID.map((v, i) => [v, LAYER_DB[i] + vt(v)]), [127, 0]].map(([v, d]) => [v, Math.round(100 * d) / 100]);

export const RECIPE = {
  name: 'Salamander Grand Piano V3',
  repo: 'sfzinstruments/SalamanderGrandPiano',
  commit: '3382bf9496bba2486f5ab0de55a264d1dfc38404',
  source: 'https://github.com/sfzinstruments/SalamanderGrandPiano',
  home: 'https://rytmenpinne.wordpress.com/sounds-and-such/salamander-grandpiano/',
  licence: 'public domain (dedicated by the author on 2022-03-04; released before that as CC-BY-3.0)',
  // LICENSE at that commit: the CC BY 3.0 Unported legal code; the README names the author
  licenceFile: { path: 'LICENSE', sha256: 'e6bc9e9c474700b708f568bac9e5a8a9bcb2b1dad53442f5ba449fcb848b8e76', must: /Attribution 3\.0 Unported/ },
  docs: [
    { path: 'README.md', sha256: 'be275b843d10a22e614e5f52bd414fe2cbdcbfd6165894b1dcca738e8cbf391a', must: /Author: Alexander Holm/ },
    { path: 'Data/region.txt', sha256: 'f6341fe2e2a5417f4e7f3499a7dfdf0a4327a58bd6f12201d63d63ed7d557193', must: /lokey=21 hikey=22 pitch_keycenter=21 sample=A0\$VEL/ },
    { path: 'Data/tune_ret.txt', sha256: 'e19f23ad8e94dee71a4deda6b1f8aef85e8f79720a9dbcd165b189cbae8b9d50', must: /TUNE29 -38/ },
    { path: 'Data/hammer.txt', sha256: '8258e15e6058f88a3a3b1ef9a587411dd327c01b11486183caad3b8f1fe96297', must: /volume=-37/ },
  ],
  credit: 'Salamander Grand Piano V3 by Alexander Holm: a Yamaha C5, recorded at 48 kHz/24-bit with two AKG C414s in AB; public domain since 2022-03-04 (sfzinstruments edition, mapped by kinwie).',
  sr: 48000,
  channels: 2,
  regions,
  cut: { rel: -50, cap: [[42, 4.6], [66, 3.7], [78, 3], [127, 2.6]], fade: 1.5 },
  level: { mode: 'flat', measure: 'attack' },
  align: true,
  meta: { velcurve, env: { r: 0.5 }, rt: { decay: 2 } },
  build: "v4, v10 and v16 at all 30 notes, and the release noise at the same keys; 24-bit to 16-bit by rounding, kept at 48 kHz; each note cut where its 100 ms RMS falls 50 dB under its attack, or at 4.6 / 3.7 / 3 / 2.6 s from its onset by register, whichever is sooner, with a squared fade over its last 1.5 s; every sample set onto one smooth curve across the keyboard (the velocity curve, measured from all 16 layers, makes the dynamics); each layer's start lined up with the next layer up's",
  qaName: 'salamander-grand-v3',
  // the QA rubric's checks this source doesn't pass as written, and why it ships anyway (fetch-kits prints them all;
  // the numbers are in tools/.out/library/salamander-grand-v3/qa.json)
  waive: [
    { check: '12 phase coherence', why: 'a spaced pair (AB, about 12 cm above the strings) gives a wide image that is anti-correlated on about a third of the notes in their first 300 ms (F#3, A3, A4 to D#5, D#6, A6, D#7 the most): summed to mono those notes lose 4 to 8.5 dB at the attack (C5 the most). The correlation moves through each note (C5: -0.84 in its first 300 ms, -0.24 a second later; A4 the other way), so it is the soundboard and the room between two mics, not a mic wired backwards: kept as recorded, and named for the listening room' },
  ],
  files: {
    "Samples/A0v4.flac": "b0b54771be38214c553edb113d4586a17f634513e2db06bd3997caed428b4f8f",
    "Samples/A0v10.flac": "7c3435ed202c64eec040070286b1cfc298e2f701ad4d54c0556e00c1c4ee53b0",
    "Samples/A0v16.flac": "aa6b97204fec347ba3776ae3659fc8ac5b02d20f11d0383c22158b3c9c6eabc5",
    "Samples/C1v4.flac": "bfd3b62c6944faec44f35b2a225d5cf0f0c668d5198812beb1d1cc73c5cd2c5e",
    "Samples/C1v10.flac": "e9bdda4a74f28a47f135cd5f0f7aaae7d78390b82a4642e5201423ae2dabbc21",
    "Samples/C1v16.flac": "e61f7b9c9994d350b5ad1654b9d49ed8a8b9ba9ba280c07a39e656cc85146847",
    "Samples/D#1v4.flac": "db590cef46d071ef8b0258d3f06b785260cb5b078f2ff7d8d7e8c8574851c152",
    "Samples/D#1v10.flac": "30fe7f9277dcd7da565400dbc4e1fc60556d282d41b58f16f9b6fa400d58112e",
    "Samples/D#1v16.flac": "8a4a159fbc61e4bbe2267b75a23b0f9ff43dfffbb1f3ef3c73b0a67779f2d3f6",
    "Samples/F#1v4.flac": "86ed38cc5c5d6bf0e7878a852eecedd0a36d258b9fc25825261abede438a1e8d",
    "Samples/F#1v10.flac": "0a841936d69a25eb65104163f0b8a9056d8892db32c5a2aca39acb18ae6899d0",
    "Samples/F#1v16.flac": "16b058e9a2419566ad8597127db568347d8c9dd7e262f277bfe1253c9c48cc3f",
    "Samples/A1v4.flac": "a1f2cabbc5fbfce7825b465dc3230578d70a935b756254250473eb984cf9b2ae",
    "Samples/A1v10.flac": "e545108a593d3c8a54b83383e27b12033f6c036e9f9c15de92a1df3cf2a73eb2",
    "Samples/A1v16.flac": "f8d9cc466983e8ae112b03b4d90c3d3f33badf432d5d8b47489209f9c985a7db",
    "Samples/C2v4.flac": "25d2ac48536df4b2241c54d4c180432c8a838143e876182801f5a5f92b4f898f",
    "Samples/C2v10.flac": "0e55ec6b4046552b7f00b19fb38fbe8aaf02d50f7f4badf9e7eb008ad0843e18",
    "Samples/C2v16.flac": "dc9ee5e32ae23753fd565af1f181e79edf043ebbb93d9f5c28637248c98f629b",
    "Samples/D#2v4.flac": "1e05e5b875256fe71006b3c3e61440196f85a85c44aba9ecb7b1461ff3a10a02",
    "Samples/D#2v10.flac": "7847ef2ab4bab2ae111e34390b843dc9f5875e1fb26a0d0df30ff916aa550152",
    "Samples/D#2v16.flac": "9b644fa0b7cb6f4987c153d3139c7ccdcd77b8117cce4eb7f01920924e351adf",
    "Samples/F#2v4.flac": "bc9d3a3e4ff5b2219d220e984eea3ab8e84d7222f89b5cfc4069cedb8af718e5",
    "Samples/F#2v10.flac": "db7c995bf388612d88de97c98183e71860a8c13fb46b02b8b3770fa1f0349ca9",
    "Samples/F#2v16.flac": "4a97516c9c86d640dd0c41f21080105bdd562ca27374a61829b9b7d5ef18df33",
    "Samples/A2v4.flac": "43563ad2ee61ba19560b969b79286b98edbd5ac6867b08bd956dac75bb376d27",
    "Samples/A2v10.flac": "206bccac2ad09b26a46198876692a892dad8d56021dcf2f6e348aa038db7028c",
    "Samples/A2v16.flac": "8378285981e3c1c2d194ad09fbec8ceea3c02f1ea80635d6d5c37fc90b969770",
    "Samples/C3v4.flac": "172b7e9fe81980ddb64334477459ea91e039b3c083f76a022682182be3482660",
    "Samples/C3v10.flac": "eb3ddb8e7df54f63d1f91c7fcc04c921623941d325df3ebeed291e1a6d82318c",
    "Samples/C3v16.flac": "d1ff6d03ff0bed873d3b5ab2ad9f7ff31117779cbf64671b267206e140116045",
    "Samples/D#3v4.flac": "cc750a11b5cd63da9367fbe152ae51f18a6cb248364a24e1e76ee6b17d3d4b96",
    "Samples/D#3v10.flac": "6d932b081ecf89a9dd4bf84a74aab0945992c70b1ecff1880806b28829fbfd74",
    "Samples/D#3v16.flac": "7d3b691deb5ef72f3e5bcaa9f8e38e92226d25781c14b275407e606104262691",
    "Samples/F#3v4.flac": "1d338855b9447cb85efd063d331b97471836967fefbb8eef2b964718b38f26cd",
    "Samples/F#3v10.flac": "fb05b33c7e8bf85f2cac42f8c75ab1530754dc771f00f15f57a9d86c05cbd13f",
    "Samples/F#3v16.flac": "fd43eb16b6cfbfe2ca8440c85109aba2a591572d5bcd5992719a87e99f6aa4df",
    "Samples/A3v4.flac": "7cfc9b2a18f8728431dfc236ca5c97793d3bdb413fd713eb13198c673982618f",
    "Samples/A3v10.flac": "78669b41c7fabb11aa073cc8f834197cb36689653d6671f441bb82b41fdb51ff",
    "Samples/A3v16.flac": "d584ac0c3fc47e6ac35773ea71fb73d8ebee373c06130a47357ef5a3e9b2ef53",
    "Samples/C4v4.flac": "c68ab13a20f4e84361843417a17521d0cf7bd9587a43fbb36c04db56045990ed",
    "Samples/C4v10.flac": "0e9d6e945df79113cd8bd9e841aed5d4537989704e993bfbed7fa8839724244a",
    "Samples/C4v16.flac": "e2944a0d1b31ea0ff8eb82b20ae2108027f111d96fb680c6e36d01f40582c252",
    "Samples/D#4v4.flac": "dfd69f142177241a5219427e0c7012a19002b6bc98e11bafe287d7190f847b79",
    "Samples/D#4v10.flac": "a00e4a1e6e2658e686e2eab60dff701fd539e75072ab3811cb3038d01192dc72",
    "Samples/D#4v16.flac": "e16a8fe9c9f78a6a269054957458566ceca8603845dd5bf62e2ecc9e5f1e849d",
    "Samples/F#4v4.flac": "e024309f6f410365a9dea891a96d6df920e93d0c401a161f642c6e5e33de6ae3",
    "Samples/F#4v10.flac": "a9912cc7b9cc3c6f4fae20eeb0d9570f21c164f9a69475dfdcd6f7290b159317",
    "Samples/F#4v16.flac": "76a4f0d7faaf8577f13c405f38b04f37cbd318064bf1c029e86e87ae9f3910dd",
    "Samples/A4v4.flac": "4c6cc00539fef67b2f9540d789f099fb3dd04d779f4d4d385224a4d815918583",
    "Samples/A4v10.flac": "9e2aa68c1495c007ee16e8ce5c97cb07ac7249fd4cc77ba759551971d9c01be0",
    "Samples/A4v16.flac": "5bea0aeb7d5b8a3e332ea52c2c5cb195bfd2ebdf73689adddac13fbd24ff85b0",
    "Samples/C5v4.flac": "0d7c117cdb01b261cb3a303c4a7c9f56ef42015078e3c69ab3aa19dd39287a6c",
    "Samples/C5v10.flac": "89924ca36674fc1b3f7b99bf503be9f1644f093efa28cbbcedbc885866ec050e",
    "Samples/C5v16.flac": "6ae603ecdcf54ec2a55b5e727b7a67668475a4cfcb48a12a4677cb6402683073",
    "Samples/D#5v4.flac": "c7f25db21896025a0b71832e3e6b859a5e88f270b8230555b9ac4772913bf821",
    "Samples/D#5v10.flac": "f9b7d545e732b6601b0a0181440cb70bd14eadf37518d9063432b5ef2a9a10fe",
    "Samples/D#5v16.flac": "ad16c4ac6eb1f359ab615eaa646747d91f12b27580c85d6567d1ec669bc105f6",
    "Samples/F#5v4.flac": "2a7a898c7e1b1287cc6b79844b24bd7cd39f232573e380f2264e1694a38845c1",
    "Samples/F#5v10.flac": "fc02895d148b1c591ac927248e0363c085a46a1ca79524ca67cbbcaab29462e3",
    "Samples/F#5v16.flac": "79594c2edcd522a812c5728c111fc5a076e4885969d9fd3aec7f3fff8e3cf6dc",
    "Samples/A5v4.flac": "36bfb6bd47e8412e842334856c0c7f19005462f69f7cc9e1829bd7bfe0e3fe72",
    "Samples/A5v10.flac": "b0a77c5be8aeff9d0e9f02d544833a78612527a8662dea839a3c4514840a0160",
    "Samples/A5v16.flac": "04e48cc80f16484d0d8fbe3d421534f2a6ae68119bf3369ae8bc8bb5ac8dda92",
    "Samples/C6v4.flac": "1f3f32e401bbd2a87a9c5b094aa6f748213fe762f3026554eb60305c02399ef7",
    "Samples/C6v10.flac": "d675a759d036e83eb6727b0630ef99767a008d192952449772874d0756e61a96",
    "Samples/C6v16.flac": "e7cffec5a543fe98423606d82a13e3d79200b90fd0a30a27e9da67ccb091d166",
    "Samples/D#6v4.flac": "bdc6b8a89901d8b5f753ba8fdbd18cc743bdeb15f47502f4b0fbe85e1335760f",
    "Samples/D#6v10.flac": "7a85145668f950ae6fe256d91de5beb0761af49beae874a09de1b4af3ef1b97c",
    "Samples/D#6v16.flac": "5548903a1b14cd41fcfd74bf0b245a7377140375906b38eb26a15b424f84c5a0",
    "Samples/F#6v4.flac": "dc69c0e742459d41b91e1c2ccba30160fe27bc70bd41483454c23a41321db0a5",
    "Samples/F#6v10.flac": "074eafc5b071e9cb32779d2ab710deac0b63851dc3455f7c4eb8452e0f2f6afd",
    "Samples/F#6v16.flac": "5e0776b53ab7d286e1cc9cd4361dbd4d4e938cd0f6f397e162dc63ef2c78855a",
    "Samples/A6v4.flac": "7d27a6ae1f006a1feeeb230afaa269ff67932ac8fac06ecd91261064cca3ef2b",
    "Samples/A6v10.flac": "1cb95f5eed403218ed93e44f3167d681d58c7d31e879dc82c157c7ded42eb020",
    "Samples/A6v16.flac": "258f9e90418c3efdf2dcb319990e82e5c5dbbb3567cb1586eb8d84746d1d33c4",
    "Samples/C7v4.flac": "02f3af88370ddd201d280da57680df0c6b372557340f7aabfe399ce7ca882353",
    "Samples/C7v10.flac": "1e2d3cc638f35982e895fb4c4f679c03d73533d1cba3cf33439cbf0b38250f11",
    "Samples/C7v16.flac": "50f029c5bb2fc7fce3fc778c87b7f044f9020e4d695d8b2fc5f8dd026c8d2fa4",
    "Samples/D#7v4.flac": "a8f34f346e4510c3b6d979da6d9bf2d8fe13ec81e4b4225a525725e01df1ccdc",
    "Samples/D#7v10.flac": "0f4d971f44a6008a6de39e2d13ebe64a948df05869a67acf17df3276e855bee1",
    "Samples/D#7v16.flac": "a35e589f4f4b6f17a7fe2afe970919a7f59aac6f5a39a847b918d9783d6ed00a",
    "Samples/F#7v4.flac": "c42b84fca6700ab05a00b34c15bc120c5fdc2387abfa671c4ff8f5cc04dbffac",
    "Samples/F#7v10.flac": "ecd0bf9110491bfdd2ae7a1a101890b51d626f05898ea9780468c145d7f8be45",
    "Samples/F#7v16.flac": "6712bba1bf4ede7684986170330d3121f0a081d49fc732b5f90696f0bc0a2912",
    "Samples/A7v4.flac": "c07538c0f0bec38b06ae01be359029b831c3ef0bd90256800bb9630c96dc791b",
    "Samples/A7v10.flac": "4dbf1e500f9c0ea6e88992cdf475b901462adb27e3ed37299d89f128b8b52194",
    "Samples/A7v16.flac": "b87f7cf8844c9f6e96d594318df2b3a3af2c2468673dac9b1a54844a3c273098",
    "Samples/C8v4.flac": "1f8ff28ffd159a073361814600b7b71d36aff470637390c0d1224ba135015e47",
    "Samples/C8v10.flac": "3907415dcf4efdbcc0c7b2ce1215a90a84dac9cd4b717f9b0f02609811a7c6e9",
    "Samples/C8v16.flac": "c4d4e9937fc5b3ea71ad7ae6f01d8d543f527e113a5adbbfe5ff7e37397e1595",
    "Samples/rel1.flac": "327ce163e169dd9881806716a804772e0e9b156788714a43240242448d96c787",
    "Samples/rel4.flac": "a94471ec71e75567d756ab3eb26759c2b5b77590d76f51d5ded86eff4c3937e5",
    "Samples/rel7.flac": "5fa3b0e4e271bc884b27769115c082b7c8d0ccdeb0d1f270e065cb3eecc7e2d3",
    "Samples/rel10.flac": "d027697c3d4a5279e74618e075fc0fa85f6bafb2b8e37308244a71004bb586e2",
    "Samples/rel13.flac": "86e0dd8e7874d1fb5d7b872370f6d4ae9461c251df4a14cfc9529c35db43527d",
    "Samples/rel16.flac": "9f71349d0e5667572c5a341ca68f07d680017d0194c3ec4a062846f03ffb9e44",
    "Samples/rel19.flac": "7c2685f58af89bb08ed8ee0df6134fb642371ef1e3b349ba3e2c1f640d978042",
    "Samples/rel22.flac": "6162f569d57f8b82f1739455d14cf6a4a011cb435b7dbf72b3f1e76e1434dba6",
    "Samples/rel25.flac": "e974dab8f3e7cc51a96363c8f156fea0d9e639cc92bc2ed9f5e863b3b582af4f",
    "Samples/rel28.flac": "b1a84429a7c54f63714dceb60a8559561c683790febc10155dd1f56380635dbe",
    "Samples/rel31.flac": "54906dc8fe01b54d93bb405c6b74b06285cc37eec1739791eb9f1570e0895101",
    "Samples/rel34.flac": "c96370dc17983c314ab56f89207f59a376b762a123ecdaa2267b256b94802635",
    "Samples/rel37.flac": "d89d309bd22630bea58d97cc8981c2705792f7d4bedbc6f92a9f661763de5ac1",
    "Samples/rel40.flac": "d0a86cfa6578475e97a66d6a717ded7a2f24877e7c9fdc67e71181c9272332bd",
    "Samples/rel43.flac": "276f5083f2f48d3d74a1e28d8d8588835ece85a1cbd1138203ea631a9c25cfcb",
    "Samples/rel46.flac": "a0b141be68d003a2772dcf9176362002f547effe2b35205e3945a66fb271d351",
    "Samples/rel50.flac": "78b7be6d969c7ee451c5c37b81108e05a743647df4f8d2c88b79ef6d2e6b63a2",
    "Samples/rel52.flac": "312842c281c46849841af3b7f1a6c627810b8c747b483b85185018445ac16ba5",
    "Samples/rel55.flac": "bd4dcf0b7b73c74c388a4dffbaa5339d4d5cbc30728302b909e38c4cd78a3338",
    "Samples/rel58.flac": "08f83069b2529fd94657a41d0c1b5c65a86ff12cb80915bc9ba49f6187c43839",
    "Samples/rel61.flac": "5be63f9d53ecb71b6eb137061198e82b5e6c2bdede3a06afa4462cc951847f4f",
    "Samples/rel64.flac": "c6708f58139d039739b48809d06cc24a37cfeade8250d7a034445928945a6dfa",
    "Samples/rel67.flac": "02de648c2c60a0b679aa3cee1b8f4335656581a783977102fb1da6c667226332",
    "Samples/rel70.flac": "591fe364fd2869c618452a5fe765cb67a2ba31b61e7feacf957eb6afb03d21c3",
    "Samples/rel73.flac": "c0ab77b84339baf3fe1e722f4e06ae08849cc1a3a1eb3efbe2e92713df4f1f72",
    "Samples/rel76.flac": "5bd1ec2313209d92f9ec7b9252d9f7fef3e6257371c7173fcbc5b38916ea6760",
    "Samples/rel79.flac": "148becf4c929a4750d7fcf232337a5e39cd5ab91af8d534ce3f61a1776cffc77",
    "Samples/rel82.flac": "c050215667ef216c7df8831d845776f7636b61a9af2fc7a64decac0f4867664d",
    "Samples/rel85.flac": "4b7a5bb72ceeb55b0816cad8e4a05c64a705dec6e811b356dd88d10c3ede85c4",
    "Samples/rel88.flac": "ee4f483f5e2da6fa405642054897eb4b93878e2db8ec7c193b4225d765cf32df",
  },
};
