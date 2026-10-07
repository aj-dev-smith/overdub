# Sounds: what the studio plays that it didn't synthesize

Overdub's code is MIT ([LICENSE](../LICENSE)). The MIT licence covers the code and nothing else. Each set of
recorded sounds the studio plays carries its own licence, recorded here. Every built-in device not listed below is
synthesized from notes, parameters and code, so it has no sound files at all.

The sampled kits' recordings aren't in this repository (Light Table's AKWF single cycles are the one exception: 108
short cycles, embedded in `app/src/devices/builtin/akwf.js`, below). `node tools/fetch-kits.js` downloads each set from its source at a pinned
commit, checks every file against its SHA-256, checks the upstream licence before building anything, and builds the
kit file the device names (`app/kits/<sha256>.odk`, and its packed twin `.odkz`). The same files always build the
same bytes, so the hash a device pins is also the record of exactly what was shipped. The recipes in `tools/kits/`
list every file with its hash.

What a set has to be, to ship by default: CC0, verified public domain, or a permissive licence that allows
redistribution and claims nothing of the songs made with it. Contributed sounds must be CC0
([CONTRIBUTING](../CONTRIBUTING.md)).

## Virtuosity Drums: Virtuosity Kit (`core.drumkit`)

| | |
|---|---|
| Source | https://github.com/sfzinstruments/virtuosity_drums |
| Pinned | commit `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`; LICENSE sha256 `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`; 66 FLAC files, each by sha256, in [`tools/kits/virtuosity.js`](../tools/kits/virtuosity.js) |
| Licence | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the repository's LICENSE is the full CC0 1.0 Universal text) |
| Author | Versilian Studios; played by Austin McMahon on the house kit at Virtuosity Musical Instruments, Boston. Brought to SFZ by sfzinstruments. |
| Modifications | A subset: the overhead pair only, 11 articulations, 3 velocity layers of 2 strokes each. 24-bit to 16-bit by rounding. Each tail cut after the last 20 ms window at or above -70 dBFS RMS, then a 10 ms linear fade. Each stroke's start set 2 ms before its attack. |
| Kit | `sha256-e590dc685420513ebec06fc8ddaa233d8f2db7535f9c5245c38468dd18ef8eac` |
| Verified | 2026-10-06 |

## Big Rusty Drums: Rusty Brushes (`core.brushkit`)

| | |
|---|---|
| Source | https://github.com/sfzinstruments/karoryfer.big-rusty-drums |
| Pinned | commit `f07ce00df34a46b6b08375be56fe116cf15782bc`; LICENSE sha256 `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`; 64 FLAC and 4 WAV files, each by sha256, in [`tools/kits/big-rusty.js`](../tools/kits/big-rusty.js) |
| Licence | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the repository's LICENSE is the full CC0 1.0 Universal text, and GitHub reads it as CC0-1.0) |
| Author | Karoryfer Samples: a kit Zygmunt Szpaderski made in Poland, probably in the early 1980s. Brought to SFZ by sfzinstruments. |
| Modifications | A subset: the overhead pair only, the brush and mallet articulations (and the kick), 13 in all, 2 to 4 velocity layers of 2 strokes each. Kept at 44.1 kHz and 16 bits. Each tail cut after the last 960-frame window at or above -70 dBFS RMS (-64 on the open hat and the crash), then a 480-frame linear fade; the open hat and the ride cut at 4 s and the crash at 6 s with a fade. The stirs looped: 3 s from 0.5 s in, the loop's last 0.3 s crossfaded at equal power into its start. Each stroke's start set 2 ms before its attack. |
| Kit | `sha256-653ce5fbd513951101d8c0b81d2a11e9177b89e8588ca403074003b1eb917ba3` |
| Verified | 2026-10-07 |

## Upright Piano KW: Parlour Upright (`core.upright`)

| | |
|---|---|
| Source | https://github.com/freepats/upright-piano-KW (FreePats: http://freepats.zenvoid.org/Piano/acoustic-grand-piano.html#UprightKW) |
| Pinned | commit `570f6c60ed2eff67accad3b85d5b452e57a3ad28`; LICENSE sha256 `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`, README sha256 `6cd95a20c43ebe8c9abb899137afd72bfc17120c07f073890a3692eaf99def3f`, SFZ sha256 `c820c9442e9c1852e5a4f265b52085eddf311b31b5c4ddfe3a84ba9d8929217e`; 66 FLAC files, each by sha256, in [`tools/kits/upright-kw.js`](../tools/kits/upright-kw.js) |
| Licence | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the repository's LICENSE is the full CC0 1.0 Universal text; the README: "Published under the terms of Creative Commons CC0 public domain dedication") |
| Author | FreePats: a Kawai upright in Inma Martínez de Miguel's living room, recorded by Gonzalo and Roberto in January 2017 with a Zoom H1 at the player's head; edited by Roberto. |
| Modifications | The full build (both velocity layers), mapped as its SFZ maps it, loops and low-pass filters included. 24-bit to 16-bit by rounding, kept at 44.1 kHz. Each tail cut after the last 20 ms window at or above -70 dBFS RMS, then a 10 ms linear fade; a looped sample kept to its loop's end. Each sample's start set 2 ms before its attack, and each soft sample's moved to line up with its key's hard one. A gain per sample (within ±4 dB), so that every sample sits on one smooth curve across the keys: the files are peak-normalized. |
| Kit | `sha256-cc1e7ab496aafa7f73b44b45fa0f9bdb96015c6b3ca2ff1fe29d6565a17ece86` |
| Verified | 2026-10-06 |

## AKWF: Light Table's recorded tables (`core.wavetable`)

| | |
|---|---|
| Source | https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE |
| Pinned | commit `8de90bf94376670947369e69de0af6b9fbd19286`; LICENSE.md sha256 `36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673`; 108 WAV files, each by sha256, in [`tools/kits/akwf.js`](../tools/kits/akwf.js) |
| Licence | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the repository's LICENSE.md is the full CC0 1.0 Universal text) |
| Author | Kristoffer Ekstrand (Adventure Kid Waveforms) |
| Modifications | A subset: nine single cycles from each of 12 families, picked by measure (`node tools/akwf-bank.js --pick`). Packed losslessly into `app/src/devices/builtin/akwf.js`, which is in this repository and carried in the kernel's source; each cycle's spectrum turned to sine phase, RMS-scaled and band-limited per octave when the tables are built. `node tools/akwf-bank.js` rebuilds the module from the pinned files (`--verify` offline). |
| Verified | 2026-10-06 |

## Adding a set

1. Check the licence at its primary source, and pin it: the commit, and the LICENSE file's sha256.
2. Write a recipe in `tools/kits/` that pins every file, and add it to `tools/fetch-kits.js`.
3. Run the QA rubric (`tools/kits/qa.js`, which `fetch-kits.js` runs on a melodic kit) and write any waiver into the
   recipe with its reason.
4. Add a row here, with the modifications and the date you verified it.
