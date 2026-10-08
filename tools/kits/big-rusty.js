// Big Rusty Drums, the brushes-and-mallets subset Rusty Brushes (core.brushkit) plays: what tools/fetch-kits.js downloads
// and how it lays the samples out. Pinned to one upstream commit, every file by SHA-256. The overhead pair only (one
// stereo mix), at the source's own 44.1 kHz and 16 bits. Brushes on the snare (taps, digs, a stir that rings while its
// note is held, the brush lifting off), on the hi-hat and the ride; mallets on the toms and the crash; the kick's felt
// beater. `vel` is the top of the layer (MIDI 0-127); upstream, each layer has four strokes, of which two are taken.
//
// Per piece: `trim` (dBFS, default -70) is where its tail is cut; `max` (seconds) cuts a long ring there with a
// `fadeMs` linear fade; `loop` (seconds) is a sustained stir's loop, its last `xfade` crossfaded into its start.
// `waive` is the QA rubric's waivers (tools/kits/qa.js), each with its reason.
export const RECIPE = {
  name: 'Rusty Brushes',
  repo: 'sfzinstruments/karoryfer.big-rusty-drums',
  commit: 'f07ce00df34a46b6b08375be56fe116cf15782bc',
  source: 'https://github.com/sfzinstruments/karoryfer.big-rusty-drums',
  licence: 'CC0-1.0',
  // LICENSE at that commit: the full CC0 1.0 Universal text (SHA-256 below), checked when the kit is built
  licenceFile: { path: 'LICENSE', sha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499' },
  credit:
    'Big Rusty Drums by Karoryfer Samples: a kit Zygmunt Szpaderski made in Poland, probably in the early 1980s (CC0 1.0, via sfzinstruments).',
  kind: 'drums',
  sr: 44100,
  qa: true,
  trimNote:
    'after the last 960-frame window at or above -70 dBFS RMS (-64 on the open hat and the crash), then a 480-frame linear fade; the open hat cut at 4 s, the ride at 4 s and the crash at 6 s with a fade; the stirs looped (a 3 s loop from 0.5 s, its last 0.3 s crossfaded at equal power into its start); kept at 44.1 kHz and 16 bits',
  waive: [
    {
      check: '4 noise floor and SNR',
      why: "every file's floor is the same room, -90.7 to -93.2 dBFS; the low ratios are soft brush strokes, the lift-off and the softest ride kept at their recorded levels (the velocity curve plays them that quiet), not added noise",
    },
    {
      check: '8 tail',
      why: 'each file runs on into that same floor, so what is left at its end is the room at -91 dBFS; the build cuts at -70 dBFS (-64 on the open hat and the crash) with a fade',
    },
    {
      check: '12 phase coherence',
      why: 'a spaced pair over brushed hats and cymbals: their noise is uncorrelated between the mics (|r| 0.15 at most, about -3 dB summed to mono, as any two independent signals), not a mic out of phase; the drums correlate 0.1 to 0.65',
    },
  ],
  pieces: [
    {
      id: 'kick',
      layers: [
        { vel: 42, files: ['Samples/kick_24/kick/oh/k_vl4_rr1.flac', 'Samples/kick_24/kick/oh/k_vl4_rr2.flac'] },
        { vel: 85, files: ['Samples/kick_24/kick/oh/k_vl9_rr1.flac', 'Samples/kick_24/kick/oh/k_vl9_rr2.flac'] },
        { vel: 127, files: ['Samples/kick_24/kick/oh/k_vl14_rr1.flac', 'Samples/kick_24/kick/oh/k_vl14_rr2.flac'] },
      ],
    },
    {
      id: 'snare',
      layers: [
        {
          vel: 31,
          files: ['Samples/snare_14/brush/oh/sn_b_vl2_rr1.flac', 'Samples/snare_14/brush/oh/sn_b_vl2_rr2.flac'],
        },
        {
          vel: 63,
          files: ['Samples/snare_14/brush/oh/sn_b_vl4_rr1.flac', 'Samples/snare_14/brush/oh/sn_b_vl4_rr2.flac'],
        },
        {
          vel: 95,
          files: ['Samples/snare_14/brush/oh/sn_b_vl6_rr1.flac', 'Samples/snare_14/brush/oh/sn_b_vl6_rr2.flac'],
        },
        {
          vel: 127,
          files: ['Samples/snare_14/brush/oh/sn_b_vl8_rr1.flac', 'Samples/snare_14/brush/oh/sn_b_vl8_rr2.flac'],
        },
      ],
    },
    {
      id: 'dig',
      layers: [
        {
          vel: 42,
          files: ['Samples/snare_14/bdig/oh/sn_bdig_vl3_rr1.flac', 'Samples/snare_14/bdig/oh/sn_bdig_vl3_rr2.flac'],
        },
        {
          vel: 85,
          files: ['Samples/snare_14/bdig/oh/sn_bdig_vl4_rr1.flac', 'Samples/snare_14/bdig/oh/sn_bdig_vl4_rr2.flac'],
        },
        {
          vel: 127,
          files: ['Samples/snare_14/bdig/oh/sn_bdig_vl5_rr1.flac', 'Samples/snare_14/bdig/oh/sn_bdig_vl5_rr2.flac'],
        },
      ],
    },
    {
      id: 'swirl',
      loop: { at: 0.5, len: 3, xfade: 0.3 },
      layers: [
        {
          vel: 63,
          files: ['Samples/snare_14/bstir/oh/sn_stir_dl1_rr1.wav', 'Samples/snare_14/bstir/oh/sn_stir_dl1_rr2.wav'],
        },
        {
          vel: 127,
          files: ['Samples/snare_14/bstir/oh/sn_stir_dl3_rr1.wav', 'Samples/snare_14/bstir/oh/sn_stir_dl3_rr2.wav'],
        },
      ],
    },
    {
      id: 'sweep',
      layers: [
        {
          vel: 127,
          files: [
            'Samples/snare_14/brelease/oh/sn_release_rr1.flac',
            'Samples/snare_14/brelease/oh/sn_release_rr2.flac',
          ],
        },
      ],
    },
    {
      id: 'hat',
      layers: [
        {
          vel: 42,
          files: [
            'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl1_rr1.flac',
            'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl1_rr2.flac',
          ],
        },
        {
          vel: 85,
          files: [
            'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl3_rr1.flac',
            'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl3_rr2.flac',
          ],
        },
        {
          vel: 127,
          files: [
            'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl5_rr1.flac',
            'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl5_rr2.flac',
          ],
        },
      ],
    },
    {
      id: 'hathalf',
      layers: [
        {
          vel: 42,
          files: [
            'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl1_rr1.flac',
            'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl1_rr2.flac',
          ],
        },
        {
          vel: 85,
          files: [
            'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl3_rr1.flac',
            'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl3_rr2.flac',
          ],
        },
        {
          vel: 127,
          files: [
            'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl4_rr1.flac',
            'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl4_rr2.flac',
          ],
        },
      ],
    },
    {
      id: 'hatopen',
      trim: -64,
      max: 4,
      fadeMs: 200,
      layers: [
        {
          vel: 63,
          files: [
            'Samples/hihat_14/open_brush/oh/ht_open_b_vl1_rr1.flac',
            'Samples/hihat_14/open_brush/oh/ht_open_b_vl1_rr2.flac',
          ],
        },
        {
          vel: 127,
          files: [
            'Samples/hihat_14/open_brush/oh/ht_open_b_vl4_rr1.flac',
            'Samples/hihat_14/open_brush/oh/ht_open_b_vl4_rr2.flac',
          ],
        },
      ],
    },
    {
      id: 'hatpedal',
      layers: [
        {
          vel: 63,
          files: ['Samples/hihat_14/chik/oh/ht_chik_vl1_rr1.flac', 'Samples/hihat_14/chik/oh/ht_chik_vl1_rr2.flac'],
        },
        {
          vel: 127,
          files: ['Samples/hihat_14/chik/oh/ht_chik_vl5_rr1.flac', 'Samples/hihat_14/chik/oh/ht_chik_vl5_rr2.flac'],
        },
      ],
    },
    {
      id: 'ride',
      max: 4,
      fadeMs: 300,
      layers: [
        {
          vel: 42,
          files: ['Samples/ride_22/brush/oh/rd_b_vl1_rr1.flac', 'Samples/ride_22/brush/oh/rd_b_vl1_rr2.flac'],
        },
        {
          vel: 85,
          files: ['Samples/ride_22/brush/oh/rd_b_vl3_rr1.flac', 'Samples/ride_22/brush/oh/rd_b_vl3_rr2.flac'],
        },
        {
          vel: 127,
          files: ['Samples/ride_22/brush/oh/rd_b_vl4_rr1.flac', 'Samples/ride_22/brush/oh/rd_b_vl4_rr2.flac'],
        },
      ],
    },
    {
      id: 'crash',
      trim: -64,
      max: 6,
      fadeMs: 400,
      layers: [
        {
          vel: 63,
          files: ['Samples/crash_17/mallet/oh/cr_m_vl1_rr1.flac', 'Samples/crash_17/mallet/oh/cr_m_vl1_rr2.flac'],
        },
        {
          vel: 127,
          files: ['Samples/crash_17/mallet/oh/cr_m_vl4_rr1.flac', 'Samples/crash_17/mallet/oh/cr_m_vl4_rr2.flac'],
        },
      ],
    },
    {
      id: 'tomhi',
      layers: [
        {
          vel: 42,
          files: ['Samples/tom_14/mallet/oh/t14_m_vl2_rr1.flac', 'Samples/tom_14/mallet/oh/t14_m_vl2_rr2.flac'],
        },
        {
          vel: 85,
          files: ['Samples/tom_14/mallet/oh/t14_m_vl4_rr1.flac', 'Samples/tom_14/mallet/oh/t14_m_vl4_rr2.flac'],
        },
        {
          vel: 127,
          files: ['Samples/tom_14/mallet/oh/t14_m_vl7_rr1.flac', 'Samples/tom_14/mallet/oh/t14_m_vl7_rr2.flac'],
        },
      ],
    },
    {
      id: 'tomlo',
      layers: [
        {
          vel: 42,
          files: ['Samples/tom_18/mallet/oh/t18_m_vl2_rr1.flac', 'Samples/tom_18/mallet/oh/t18_m_vl2_rr2.flac'],
        },
        {
          vel: 85,
          files: ['Samples/tom_18/mallet/oh/t18_m_vl4_rr1.flac', 'Samples/tom_18/mallet/oh/t18_m_vl4_rr2.flac'],
        },
        {
          vel: 127,
          files: ['Samples/tom_18/mallet/oh/t18_m_vl7_rr1.flac', 'Samples/tom_18/mallet/oh/t18_m_vl7_rr2.flac'],
        },
      ],
    },
  ],
  files: {
    'Samples/crash_17/mallet/oh/cr_m_vl1_rr1.flac': 'cbca5096153df29c603b2502317f188cacfb519cb734bec25457e6a7e4aa2cb5',
    'Samples/crash_17/mallet/oh/cr_m_vl1_rr2.flac': '2c6f05bfc235f164365c1d02fc47c414266150aac5c5cbdb2f67f35c433699e7',
    'Samples/crash_17/mallet/oh/cr_m_vl4_rr1.flac': '6d19d15adadf10b4c01d7a2ab68b83119f82cf784b2afeedf36e80a593ed50d8',
    'Samples/crash_17/mallet/oh/cr_m_vl4_rr2.flac': 'a3377d73f216e8b44616671d54dfdbae9184a5956e923da4d383dfc35675c8c8',
    'Samples/hihat_14/chik/oh/ht_chik_vl1_rr1.flac': '0c290035a9e2843dbd8c8e1daabd4bbc55978ad2cb72f1e8ccd61b5cb44dadb3',
    'Samples/hihat_14/chik/oh/ht_chik_vl1_rr2.flac': '28f8bebeff67e05294383d8f6cb9ccf00fbd428c8cafb56e1db80331249b68cf',
    'Samples/hihat_14/chik/oh/ht_chik_vl5_rr1.flac': '2948bdd436c396780c955aae7340516b1be73a28942d0ccf72cff28f9085a139',
    'Samples/hihat_14/chik/oh/ht_chik_vl5_rr2.flac': '739bc1ec853587001593a8718ab600501879c71efdeeb3545408ee7e86fd6a83',
    'Samples/hihat_14/open_brush/oh/ht_open_b_vl1_rr1.flac':
      '6156da454a6b24b653fae52d646e28ff591cfa4d3bf90e24d6cbf253ac0b906c',
    'Samples/hihat_14/open_brush/oh/ht_open_b_vl1_rr2.flac':
      '3b3b55c990165019acf9b03f248aeb03fe59d99f370220f3f567277f63aab9d5',
    'Samples/hihat_14/open_brush/oh/ht_open_b_vl4_rr1.flac':
      '81fe6001377d31b20ed43f6ab5910ec843f8ab104cc203c370ae5e4c69f56aec',
    'Samples/hihat_14/open_brush/oh/ht_open_b_vl4_rr2.flac':
      '198d1b6c4cd8ed2ef12305693e68de7118657c6a30fe83b34dd725ba14a56b7a',
    'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl1_rr1.flac':
      'f80076113c6a8336d33698e5b51b5e0e605c720a8b019989cb67f415ad04ecd5',
    'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl1_rr2.flac':
      'caec063e97ad6ece30f4abd5be3b080ea2a6189aea440266e87607b2ef9340c5',
    'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl3_rr1.flac':
      'd3788875900e495e1b93c4ef83a887df5654d0b2c62a39971d4a7ecb4567e929',
    'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl3_rr2.flac':
      '69eb8ecb940d45c4d82a0846785911a87c165bb1e20639b14509be106661c3b3',
    'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl4_rr1.flac':
      '3915752c8eda46bc353403191c48cc22f5f956dbadbcb5cb20afe13144f5900e',
    'Samples/hihat_14/qo_brush/oh/ht_qo_b_vl4_rr2.flac':
      '10dfe3536bc21bcd649c52dd760d848b00eac5b67365f2c983f90134c8195744',
    'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl1_rr1.flac':
      '5e63cd817ad6730a2df0061a3d12815c38294cc18ba66343e595535d1b9c32f3',
    'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl1_rr2.flac':
      '44ff8ab15f84947fc5ae72a092e6d6cfb37915216f1056bf554b38908fe58a23',
    'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl3_rr1.flac':
      'f15d7886065fa37ba0cf27bd80b5ec58eed9de63d024ac251fdcbf785475be49',
    'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl3_rr2.flac':
      '005f3c8b4053eb4d2c6f89f2898be4ed4d14676bd68b09e08467e97f49aec9c8',
    'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl5_rr1.flac':
      '75281d7b94c917ecbbdab2e3ed091669a74b542afd6ede689cf188bbb66942f9',
    'Samples/hihat_14/tc_brush/oh/ht_tc_b_vl5_rr2.flac':
      'ae0443f9ef4993b2f4fe45cc943177309363ff78373f9636933d95d75211fdd8',
    'Samples/kick_24/kick/oh/k_vl14_rr1.flac': 'b0bf6e73594b9fab70c744fc12d5195b1850ae0fb8d3b6458dba550dd23dafdd',
    'Samples/kick_24/kick/oh/k_vl14_rr2.flac': '30b27e53cce02829def0c915c7fc5122699ca33b2f7546f1c4443a7bab00f471',
    'Samples/kick_24/kick/oh/k_vl4_rr1.flac': 'd2698d15fdcf7d3704efa97aa1971120b46d4e79bffcb0a13a9f863a61c78fc5',
    'Samples/kick_24/kick/oh/k_vl4_rr2.flac': '8e4f3e443fa1370f153659b661422c34bc49d7dc8eac290617eb22edd72a50d2',
    'Samples/kick_24/kick/oh/k_vl9_rr1.flac': '0ff171c04d2211b61c3afdb7ecc6732a8bf3608a154f427df5c25eaacee26a98',
    'Samples/kick_24/kick/oh/k_vl9_rr2.flac': 'b1ddc05ce0cefec144044ff670080fba6e49ca4cf1b5e5e3ed5f4f346a64e4f4',
    'Samples/ride_22/brush/oh/rd_b_vl1_rr1.flac': '40003c98b2935c73ec262e876f41c416c62de62c3161fafd5f2565c354ca6cbd',
    'Samples/ride_22/brush/oh/rd_b_vl1_rr2.flac': '97cfea46e123a7045e723460329f211fb6fd93888a9a7ffb4cbc0fd8024ced58',
    'Samples/ride_22/brush/oh/rd_b_vl3_rr1.flac': 'e3ef5594c5ddadeb45144d6e720692a7a86159e142dad0022a3a92ffe09f87dd',
    'Samples/ride_22/brush/oh/rd_b_vl3_rr2.flac': 'cc17db8c8e4564c2b722a13f88e76784c5917ad949d367aae54dfc6a3342667d',
    'Samples/ride_22/brush/oh/rd_b_vl4_rr1.flac': '6e4e46016d9b25d83e9ba1b3d56d96dd5f80fa3a7676bcac6283d7d0faac46d4',
    'Samples/ride_22/brush/oh/rd_b_vl4_rr2.flac': '48cfd8a4b058331c35b19655e6b3410acfa0f2ab2f8d34d0f18266d90cca00ce',
    'Samples/snare_14/bdig/oh/sn_bdig_vl3_rr1.flac': '0173c4ba2555ec003daf321bfde14f51e643be3da213049a886d107f23a1716e',
    'Samples/snare_14/bdig/oh/sn_bdig_vl3_rr2.flac': 'a8dcb226363230ee4cf38b2489012261ae3885cbfaa22d78dfe16ac390d0ec26',
    'Samples/snare_14/bdig/oh/sn_bdig_vl4_rr1.flac': '4104bfda94c352df2e84164a0c1934b614caae2b5d0f615ba0303f82048db304',
    'Samples/snare_14/bdig/oh/sn_bdig_vl4_rr2.flac': '18f8f414f359a02c69221f810d7ac341d51738df0fbcd32e6883908082b488d0',
    'Samples/snare_14/bdig/oh/sn_bdig_vl5_rr1.flac': 'c828828988be0b46a697bb5d5603e81240d04b400b7556d1d7bbed108356eaa2',
    'Samples/snare_14/bdig/oh/sn_bdig_vl5_rr2.flac': '829d62d7b972448927461dbca072f6c0786be22f879f11e999201c544a85c79c',
    'Samples/snare_14/brelease/oh/sn_release_rr1.flac':
      'cd5e1adcbe1a9ad0af8b492deb408bcad920b607eeff55cc27438992ae36a969',
    'Samples/snare_14/brelease/oh/sn_release_rr2.flac':
      'a4d47f08bf185c3242fc5bbd73c18527ab7d4cc77a0a3fe10e9b6f998b5aed3f',
    'Samples/snare_14/brush/oh/sn_b_vl2_rr1.flac': '4bf0921cef2dedcb248ec62f74c3f5a150b443c5079f40a8887c7233c0bf7107',
    'Samples/snare_14/brush/oh/sn_b_vl2_rr2.flac': '2b4fd57d6cbefe76ac448de13c288118974b507cd381f8b45ea2ed2ba97abc51',
    'Samples/snare_14/brush/oh/sn_b_vl4_rr1.flac': '9eed8cb5884003eede26b99e91d9b9a63e4094c0aab139f72cde34f67c7a3ff3',
    'Samples/snare_14/brush/oh/sn_b_vl4_rr2.flac': 'dd8e0143bbb592ad0134f832ebcc81bef375d43b2f80079ee2290aed74e00538',
    'Samples/snare_14/brush/oh/sn_b_vl6_rr1.flac': '976937edf7a58b2d9681355f1e95f461b0e69a2f7a78ad9256c9de9c3ea83e42',
    'Samples/snare_14/brush/oh/sn_b_vl6_rr2.flac': '164b36550f980813bf673f2ebed7b309745000ce586da808ee07d7ad8c947d32',
    'Samples/snare_14/brush/oh/sn_b_vl8_rr1.flac': '08badcffcda2f80327d332f274c7dd9f3f922d7681fce670bd4c2a77aa99328c',
    'Samples/snare_14/brush/oh/sn_b_vl8_rr2.flac': '683c7dae7c563e6adaa8e5d29a6f4be97e81f4a8735019696ae1a18584a08096',
    'Samples/snare_14/bstir/oh/sn_stir_dl1_rr1.wav': '4637da8a4a9ac3eea003e061a9b55cf1511c0aaa43c598ac15e45e0518110d61',
    'Samples/snare_14/bstir/oh/sn_stir_dl1_rr2.wav': '520bb3e346bdbc4d01ce0f242ecaafbd6710d6fd5e8444e09050b7bb62a35a28',
    'Samples/snare_14/bstir/oh/sn_stir_dl3_rr1.wav': '345e1d108c025d11202127fd79278a7220ba9ff52c6ff6cf1abc879a697ad511',
    'Samples/snare_14/bstir/oh/sn_stir_dl3_rr2.wav': '97b419730b720604df56be7b730056a467b41d06687ff12850147c7afc1ea0a8',
    'Samples/tom_14/mallet/oh/t14_m_vl2_rr1.flac': '23c11249505d0751653279cb9a233deddcc43ff45796e8dc4bb6da5b17d7b228',
    'Samples/tom_14/mallet/oh/t14_m_vl2_rr2.flac': '28663f4b6c0c3dee0c95fd51576b3043db53a99ca939f41a0f8a635f043e37c8',
    'Samples/tom_14/mallet/oh/t14_m_vl4_rr1.flac': '2e4f46897b29cd4b1e8874bcbc789b9e7e299e1ce52171ee54986ad2a65b05ec',
    'Samples/tom_14/mallet/oh/t14_m_vl4_rr2.flac': 'd3b9fa43c818bd962ac600275d6c7fc71357e63807f4a48e611827e0b39ce215',
    'Samples/tom_14/mallet/oh/t14_m_vl7_rr1.flac': 'c392e50c1f715af3ebb2837da6814624f28b959ad3a1ea940030991655614592',
    'Samples/tom_14/mallet/oh/t14_m_vl7_rr2.flac': '1fed66ded4683a0cb44b91b98646ee5b1386852817dec94fe951ab470091cbfa',
    'Samples/tom_18/mallet/oh/t18_m_vl2_rr1.flac': '90029f6418fa682cf9dc770217cdb3e29eada6466c2ab5a364f5dbc8bc367376',
    'Samples/tom_18/mallet/oh/t18_m_vl2_rr2.flac': '4954bc341ff5ac7be63e3d0ba0d2fa9cbd7f64b0710aa35abe96082dcfb3285b',
    'Samples/tom_18/mallet/oh/t18_m_vl4_rr1.flac': 'cc3bfd4c111c978657e19f30f745f52d5ba733ec0d2a25e2c70e32aa574e54c6',
    'Samples/tom_18/mallet/oh/t18_m_vl4_rr2.flac': '44d5f0cd0f62f4651d3955a9687d7a944fbf52f962de4f7db911ee2c070d29bd',
    'Samples/tom_18/mallet/oh/t18_m_vl7_rr1.flac': '66b51fbd82548ec332e33c21e7bd18f156a9a3b4c95ec325a689f02ec49ec009',
    'Samples/tom_18/mallet/oh/t18_m_vl7_rr2.flac': '855573c6d0d9b5b79492cc23d9dfba8ad96c1716d9caaf8bd8f836cba0594e19',
  },
};
