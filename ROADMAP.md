# Roadmap

What's in the studio, what's being built, and where a hand would help. No dates: things ship when the checks pass and
someone has listened to them.

## Live

At [overdubstudio.com](https://overdubstudio.com/app/), and in every clone of this repo:

- **A DAW in the page.** Tracks, clips, an arranger with sections, a piano roll, a step grid, a mixer and device
  racks, all synthesized or sampled in the browser. No install, no build, no dependencies.
- **Capture first.** Hum it, tap it, beatbox it or play it on MIDI or the computer keyboard; the Sketch tab keeps it,
  and Band builds chords, bass and drums around a kept take.
- **The Guitar Studio.** The pedals, amps and cabs from Claw'd-o-Matic, on any track.
- **Sampled instruments.** Real pianos, kits, strings, winds and brass, a bass, a guitar and more, every one from a
  set that is CC0 or public domain ([docs/SOUNDS.md](docs/SOUNDS.md) says where each came from).
- **A second player.** An agent works on what you've selected, proposes A/B takes, and writes devices: describe a
  pedal, it writes the DSP, the device check measures it, and a face appears.
- **Measured, not guessed.** Offline renders through the same graph you hear, measured for loudness, peaks, spectrum,
  onsets and key. Renders are deterministic, and the canonical one runs in Node.
- **Signed takes.** Every note, clip and knob move says who made it. Undo the agent's work and keep yours.
- **Ways in for agents.** MCP for Claude Code and other clients, Claude Code inside the studio, and a claude.ai
  connector ([docs/AGENTS.md](docs/AGENTS.md), [docs/REMOTE-MCP.md](docs/REMOTE-MCP.md)).

## Being built

- **Start a song.** The first slice is live: tap a beat, then hum over it. Still to come: a coach strip that says
  what to do next, the sound card on the stage, folding rounds over a click, and more than one reading of a hum to
  choose from.
- **The community shelf.** A gallery of devices people and their agents wrote, and a way to try one from the
  studio. It's built and switched off away from localhost ([docs/COMMUNITY-SHELF.md](docs/COMMUNITY-SHELF.md)). Before
  it goes on: the audio thread's built-ins frozen before any shelf kernel runs, frame headers, a pinned and
  hash-checked index, and a way to take a device down that reaches every studio on its next load.
- **Real Rooms.** A reverb that plays the start of a measured impulse response from a real space (a church, a hall,
  a small room) and hands off to a fitted tail, with a zero-dependency convolver that renders the same in the worklet
  and in Node.
- **More sampled instruments.** More sets under the same rule: CC0 or public domain, pinned by hash, checked by the
  same QA rubric (`tools/kits/qa.js`), and old songs never change.

## Next

- Plate and spring reverbs, synthesized here and released CC0, and rooms we record ourselves.
- Asking before an imported device file runs, the way a shared song already asks.
- More of the code under the static checks: `// @ts-check` a file at a time, the formatter a directory at a time
  ([CONTRIBUTING.md](CONTRIBUTING.md), "Static checks").
- More OverdubBench tasks ([docs/BENCH.md](docs/BENCH.md)).

## Where help is wanted

- **Devices.** A kernel is a few dozen lines of DSP with a check that tells you what's wrong
  ([docs/DEVICES.md](docs/DEVICES.md)). Issues labelled `good first device` are small, well-understood effects and
  instruments.
- **Tests.** The core (`app/src/core/`) is pure and runs in Node. Fast unit tests in `test/unit/` for the parts only a
  browser suite covers today are welcome.
- **Types.** Turning on `// @ts-check` for one file, with the JSDoc it needs, is a good first pull request.
- **Sounds.** CC0 sample sets we've missed, and impulse responses of rooms you can get into, recorded and released
  CC0 ([docs/SOUNDS.md](docs/SOUNDS.md), "Adding a set").
- **Browsers and phones.** Safari, Firefox and phones are held to Chrome by `tools/compat-test.js` and
  `tools/phone-test.js`. A bug report from a real device is worth a lot.
- **Docs.** If something in a guide was wrong or missing when you tried it, that's an issue.

Start with [CONTRIBUTING.md](CONTRIBUTING.md), "Where to start".
