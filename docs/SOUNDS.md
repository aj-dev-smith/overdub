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

## Salamander Grand Piano V3: Full Stick (`core.grand`)

| | |
|---|---|
| Source | https://github.com/sfzinstruments/SalamanderGrandPiano (the sfzinstruments FLAC edition; the author's page: https://rytmenpinne.wordpress.com/sounds-and-such/salamander-grandpiano/) |
| Pinned | commit `3382bf9496bba2486f5ab0de55a264d1dfc38404`; LICENSE sha256 `e6bc9e9c474700b708f568bac9e5a8a9bcb2b1dad53442f5ba449fcb848b8e76`, README.md, Data/region.txt, Data/tune_ret.txt and Data/hammer.txt by sha256; 120 FLAC files, each by sha256, in [`tools/kits/salamander.js`](../tools/kits/salamander.js) |
| Licence | Public domain. The author dedicated all his sampled instruments to the public domain on 2022-03-04 (https://rytmenpinne.wordpress.com/2022/03/04/good-news-everyone/: "I've decided to public domain all my sampled instruments! yay! They are all yours now and you may do whatever you wish!"; the product page: "As of 4.3.2022, this is now public domain!"). The repository's LICENSE is still the [CC-BY-3.0](https://creativecommons.org/licenses/by/3.0/) it was released under before, which would cover us too: he is credited either way. |
| Author | Alexander Holm: a Yamaha C5 grand, recorded at 48 kHz/24-bit with two AKG C414s in AB about 12 cm above the strings. Mapped to SFZ by kinwie; the Retuned set by Markus Fiedler. |
| Modifications | A subset: velocity layers 4, 10 and 16 of 16 at all 30 notes (a minor third apart), and the dampers' release noise at the same 30 keys (A4's is clipped at the source, so that zone uses A#4's). 24-bit to 16-bit by rounding, kept at 48 kHz. Each note cut where its 100 ms RMS falls 50 dB under its attack, or at 4.6 s (to F#2), 3.7 s (to F#4), 3 s (to F#5) or 2.6 s (above) from its onset, whichever is sooner, with a squared fade over its last 1.5 s: the files run 3 to 25 s, and whole they would be about 45 MB. Each sample's start set 2 ms before its attack, and each layer's lined up with the next layer up. A gain per sample, so every sample sits on one smooth curve across the keys; the dynamics come from a velocity curve measured from all 16 layers and the source's own velocity tracking. Tuned by the source's Retuned table (cents per note). |
| Kit | `sha256-15cab44d14055d312f55e04bee8f54ca1cc99d6bc8e78ba9f1c1cb34a73eb58e` |
| Verified | 2026-10-07 |

## VS Chamber Orchestra 2: Community Edition: Rosin (`core.ensemble`)

| | |
|---|---|
| Source | https://github.com/sgossner/VSCO-2-CE (Versilian Studios: https://vis.versilstudios.com/vsco-community.html) |
| Pinned | commit `440300901dfe9275fd84e0b7763af1f8443ae62e`; LICENSE sha256 `36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673`, Readme.txt by sha256; 30 WAV files, each by sha256, in [`tools/kits/vsco-strings.js`](../tools/kits/vsco-strings.js) |
| Licence | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the repository's LICENSE is the full CC0 1.0 Universal text). Its Readme.txt: "You are permitted to use these samples for ANY purpose. We ask that you do not sell the samples directly ... Please provide credit to Versilian Studios/Sam Gossner, and/or Ivy Audio/Simon Dalzell where applicable, and link to the VSCO: CE homepage." We don't sell them, and credit them here, in the README and on the device. |
| Author | Versilian Studios: recorded by Sam Gossner and Simon Dalzell (Ivy Audio); sample cutting by Elan Hickler (Soundemote). |
| Modifications | A subset: the sustained, vibrato articulation of the solo contrabass (one note), the cello section (five), the viola section (three) and the violin section (six), one section per register; VSCO's softest and loudest dynamic for each. 16-bit by rounding (the 24-bit files), kept at 44.1 kHz. Each note looped where it has settled (a loop of 1.5 to 1.9 s ending by 2.8 s, or 4.3 s for the soft notes, which swell), its 0.4 s crossfade baked into the samples, and the sample cut at the loop's end. Each start 2 ms before the note first comes within 40 dB of its peak. A gain per sample, so every note plays at one level (VSCO recorded the sections at different gains); the dynamics come from a velocity curve set from the two layers' recorded distance. |
| Kit | `sha256-2eb3cfbd8fd7aca225201abc1b20eeb0d830029037d92ac5318941d05472a39b` |
| Verified | 2026-10-07 |

## VCSL Vibraphone: Damper Bar (`core.vibes`)

| | |
|---|---|
| Source | https://github.com/sgossner/VCSL (Versilian Studios: https://versilian-studios.com/vcsl/) |
| Pinned | commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`; LICENSE sha256 `a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499`, README.md by sha256; 44 WAV files, each by sha256, in [`tools/kits/vcsl-vibes.js`](../tools/kits/vcsl-vibes.js) |
| Licence | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the repository's LICENSE is the full CC0 1.0 Universal text; the README: "you can do whatever you want with these sounds (even make commercial software), no royalties, no credit, no special terms") |
| Author | Versilian Studios (the Versilian Community Sample Library). |
| Modifications | A subset: all 11 bars VCSL recorded (F3 to E6), soft mallets at two dynamics and hard mallets at two. Kept at 44.1 kHz, 16-bit, stereo. Each note cut where its 100 ms RMS falls 50 dB under its attack, or at 6 s, with a squared fade over its last 1.5 s. Each start 2 ms before its attack, each layer lined up with the next layer up. A gain per sample, so every note plays at one level; the dynamics come from a velocity curve set from the layers' recorded levels. Chosen over VCSL's marimba and concert harp by the QA rubric (the harp fails its noise floor and tails, the marimba its phase). |
| Kit | `sha256-e41ad6c162933d1dcc259cd6b3a6e3ca5c7567dd2a38cc96fd60cc1d0207f751` |
| Verified | 2026-10-07 |

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
