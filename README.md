# Overdub

**Play over each other.** Overdub is a music studio in the browser for you and your agents. An overdub is a new take
laid over an old one; here the second player is an agent. You lay down a take: hum it, tap it, play it or say it. The
agent plays over it, in notes, sounds and settings you can see and undo, and you play over that. Every take is
signed, warm for you and cool for it. Take one is always yours, and between you, you build whatever the song needs,
including instruments and effects that didn't exist until you described them.

Live at **[overdubstudio.com](https://overdubstudio.com)** (the studio is at
[/app/](https://overdubstudio.com/app/); the docs at [/site/docs/](https://overdubstudio.com/site/docs/)).
To run your own copy:

```sh
git clone https://github.com/overdubstudio/overdub.git && cd overdub
node server/serve.js      # then open http://localhost:3279/ (the pitch) or http://localhost:3279/app/ (the studio)
```

No install, no build, no dependencies (Node 22 or later). Chrome is the reference browser; Safari, Firefox and phones
work too (`tools/compat-test.js` and `tools/phone-test.js` check them).

## What's in the studio

- **A real DAW.** Tracks, clips, an arranger with sections and loops, a piano roll, a step grid for drums, a mixer and
  device racks. Everything is synthesized in the page. Sections duplicate with their clips, bars go in and out across
  the whole song, and clips repeat and split. Twelve demo songs come with it: Night Shift (lo-fi), Dust Jacket
  (boom bap), Halation (shoegaze), Lido (house), Sodium (synthwave), Red Eye (trap), Late Checkout (neo-soul),
  Wake-Up Call (gospel), Lobby Bar (bossa nova), Room Service (boogie), Turndown (French house) and Ice Machine (dub).
- **Capture first.** The Sketch tab turns humming into notes and tapping or beatboxing into drums, and it shows its
  repairs. It also keeps everything you played on MIDI or the computer keyboard, so "keep that" works after the fact.
  **Band** (or ⇧B) builds chords, bass and drums around a kept take in one of five styles, on new tracks, with your
  notes untouched.
- **The Guitar Studio, inside a DAW.** Plug a guitar into an audio interface and play it through the pedals, amps and
  cabs ported from [Claw'd-o-Matic](https://clawd.ajsmithhq.com): 101 pedals, 27 amps and 156 rigs, on any track. They
  also work on synths and drums. Overdub adds 37 built-in instruments and effects of its own, named after things in a
  studio: Patch Bay, Capstan, Lamp Tines, Pinch Roller, Gobo Kit, Room Tone, Baby Grand, Rotor Cabinet, Music Stands,
  Flatwound, Suitcase, Mallet Bag, DI Box, Step Ladder, Brass Rail, Risers, Studio A, Light Table, Virtuosity Kit,
  Parlour Upright, Rusty Brushes, Hand Crate, Full Stick and Rosin;
  Top Shelf, Squeeze Box, Stairwell, Echo Reel, Double Track, Keyhole, Hot Print, Chewed Tape, Gatefold, Red Line,
  Slide Rule, Scribble Strip and Gaffer Tape. All are synthesized but six, which play samples: Virtuosity Kit, a real
  jazz-club kit, Parlour Upright, a real upright piano, Rusty Brushes, a real kit played with brushes and mallets,
  Hand Crate, real hand percussion, Full Stick, a real concert grand, and Rosin, a real string section. (Light Table's AKWF tables are recorded
  too: 108 single cycles, nine to a table.)
- **A second player.** The agent works on what you've selected. It proposes alternatives as A/B cards you
  audition and pick from, and it writes devices: describe a pedal and it writes the DSP, the studio checks it
  (level, peaks, tails, CPU, determinism), and a face appears that you can play. The
  [device library](https://overdubstudio.com/app/library.html) has 13 devices Claude wrote, each with the request
  behind it, next to the 37 built-ins.
- **Words that mean what you mean.** "Warmer" goes through a lexicon to real knob moves. For words people disagree on
  (warm, fat, tight), the first time you hear two readings and pick one, and the studio remembers it. Sixteen note
  transforms (humanize, strum, arpeggiate, chords from a melody, continue a phrase, fill a gap…) are in the piano
  roll's Transform menu and in the agent's hands alike.
- **Agents can't hear, so the studio measures.** Any range or track can be rendered offline through the same graph
  you hear and measured (LUFS, true peak, spectrum, onsets, key). Results are reported as changes from before, in
  musician's words. Drop a finished song on the Reference tab and the mix is measured against it.
- **Every take is signed.** Warm marks you, cool marks an agent, on notes, clips, knobs and in the history. Undo the
  last thing, the agent's last thing, or everything the agent did while keeping what you did. The provenance report
  puts who played what in numbers.
- **In and out.** MIDI and audio files drop in. A share link carries the whole song (not its recordings) in the URL,
  and whoever opens it can **Make it yours**, with every part still signed. Export the mix, stems, MIDI, a
  DAWproject for other DAWs, the project file and the attribution log.

## Bring your agent

- **Claude Code (MCP):** `claude mcp add overdub -- node <repo>/server/mcp.js` (or the plugin: see
  [integrations/README.md](integrations/README.md)), open the studio, and ask. The agent's edits appear live, signed
  with its name. MCP drives a studio served from your own copy, not the public site.
- **Claude Code in the studio:** run your own copy with Claude Code installed and signed in, and the Agent tab offers
  **Use Claude Code here**: the studio's own chat box, on your Claude plan.
- **In the studio:** a scripted demo agent, free, on the real tools. The studio keeps no API key; self-hosting with
  one, set `OVERDUB_ANTHROPIC_KEY` on your local server and the page never sees it
  ([GUIDE.md](docs/GUIDE.md#your-own-api-key-on-your-own-server)).
- **claude.ai:** open the studio's **Connect** tab, turn it on and add the URL to claude.ai as a custom connector;
  Claude plays in that tab through a hosted relay, on your Claude plan ([docs/REMOTE-MCP.md](docs/REMOTE-MCP.md)).

[`docs/AGENTS.md`](docs/AGENTS.md) covers all 40 tools, the op format and the etiquette.

## Keys

Space play/stop · R record · L loop · K click · M mute · S solo · ⌘E split · H hum · T tap · \` musical typing ·
⇧B band · / search devices · ⌘/ ask the agent · ⌘Z / ⇧⌘Z undo/redo · ⌘S save the song file · ? every key

M and S (the selected track) and K are Logic's and GarageBand's keys; ⌘E is Ableton Live's split, since a browser
keeps ⌘T for a new tab.

## Docs

- [`docs/GUIDE.md`](docs/GUIDE.md): your first overdub in five minutes, then everything else in the studio.
- [`docs/AGENTS.md`](docs/AGENTS.md): how an agent connects, the rules of the room, every tool and op.
- [`docs/DEVICES.md`](docs/DEVICES.md): writing an instrument or effect, and the device check.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how it's built; the contract between the modules.
- [`docs/BENCH.md`](docs/BENCH.md): OverdubBench, agent music tasks scored by measurement.
- [`docs/REMOTE-MCP.md`](docs/REMOTE-MCP.md): the relay for claude.ai.
- [`docs/VISION.md`](docs/VISION.md) is the pitch, [`docs/UX-RESEARCH.md`](docs/UX-RESEARCH.md) the research behind
  it, [`docs/BRAND.md`](docs/BRAND.md) the brand (the Weave, the Overprint, and the voice of the engineer behind the
  glass).

The same guides are built into the docs hub at `site/docs/` by `node tools/docs-build.js`.

## Commands

```sh
node server/serve.js                 # the site and the studio on http://localhost:3279
node server/mcp.js                   # the MCP stdio server (MCP clients start it themselves)
node tools/run-all.js                # every check (PAR=3 at a time); each tools/*-test.js also runs on its own
node tools/render.js song.json --hash   # the canonical render (Node), and its hash
node tools/fetch-kits.js             # fetch and build the sampled kits into app/kits/ (not in git)
node tools/bench/run.js              # OverdubBench
```

## Layout

```
site/          the landing page, the press page, the docs hub (site/docs/, built from docs/)
app/           the studio: index.html, library.html, style/, src/{core,engine,audio,devices,kernel,input,ui,agent}
app/kits/      the sampled kits' samples (gitignored: node tools/fetch-kits.js builds them; deploy uploads them)
app/vendor/    verbatim sources from Claw'd-o-Matic (pedals, amps, presets); tools/vendor-clawd.js re-syncs them
server/        serve.js (static + agent bridge), mcp.js (MCP stdio server), relay.js (the claude.ai relay)
tools/         checks (node tools/run-all.js), the Node renderer, OverdubBench, screenshot and film scripts
integrations/  the Claude Code plugin and skill, configs for other MCP clients
deploy/        the static site's setup and deploy scripts, and the relay and analytics infrastructure
docs/          guide, agents, devices, architecture, bench, remote MCP, vision, research, brand
```

## Credits

The pedals, amps, cabs and presets are AJ's Guitar Studio from Claw'd-o-Matic. The synthesis techniques come from
AJ's earlier synthesis experiments (Karplus-Strong strings, modal drums, tube amp models). Virtuosity Kit plays
[Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) by Versilian Studios, played by Austin McMahon
on the house kit at Virtuosity Musical Instruments, Boston (CC0 1.0; the samples at commit `9f04cf9`, listed in
`tools/kits/virtuosity.js`). Parlour Upright plays FreePats'
[Upright Piano KW](https://github.com/freepats/upright-piano-KW), a Kawai upright recorded by Gonzalo and Roberto
(CC0 1.0; at commit `570f6c6`, listed in `tools/kits/upright-kw.js`). Rusty Brushes plays Karoryfer Samples'
[Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums), a kit Zygmunt Szpaderski made in
Poland (CC0 1.0; at commit `f07ce00`, listed in `tools/kits/big-rusty.js`). Hand Crate plays the hand percussion of
[VCSL](https://github.com/sgossner/VCSL), the Versilian Community Sample Library, by Versilian Studios (CC0 1.0; at
commit `c1ea7bc`, listed in `tools/kits/vcsl-hand.js`). Full Stick plays
[Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano) by Alexander Holm, a Yamaha C5
(public domain since 2022, released before that as CC-BY 3.0; at commit `3382bf9`, listed in
`tools/kits/salamander.js`). Rosin plays the string sections of
[VS Chamber Orchestra 2: Community Edition](https://vis.versilstudios.com/vsco-community.html) by Versilian Studios
(Sam Gossner) and Ivy Audio (Simon Dalzell) (CC0 1.0; at commit `4403009`, listed in `tools/kits/vsco-strings.js`).
[`docs/SOUNDS.md`](docs/SOUNDS.md) is the record of every sound set: source, pin,
licence, author and what the build changed.

Light Table's AKWF tables play 108 single cycles from [AKWF](https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE)
(Adventure Kid Waveforms) by Kristoffer Ekstrand (CC0 1.0; the files at commit `8de90bf`, each listed with its
SHA-256 in `tools/kits/akwf.js`).

## Licence

MIT: see [LICENSE](LICENSE). The MIT licence covers the code; each sound set carries its own licence
([`docs/SOUNDS.md`](docs/SOUNDS.md)). The fonts in `app/style/fonts/` are under the SIL Open Font License, each with
its `OFL.txt`. The samples `tools/fetch-kits.js` fetches aren't in this repository; both sets are CC0 1.0 (public
domain dedication), and the tool checks the upstream LICENSE before it builds them. The AKWF single cycles in
`app/src/devices/builtin/akwf.js` are in it, also CC0 1.0; `tools/akwf-bank.js` checks the upstream LICENSE.md and
every file's SHA-256 when it rebuilds them.

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
