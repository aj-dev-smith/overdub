# Starter issues (drafts)

Drafts for a maintainer to post. Each is small, has a way to check it, and names the files to start from. The labels
are GitHub's `good first issue` and `help wanted`, and a new one, `good first device`, for a device someone can write
from [docs/DEVICES.md](../DEVICES.md) alone (create that label before posting).

Once an issue is posted, delete its draft here, so this file only ever holds what isn't posted yet.

---

## 1. Unit tests for the play-along judge (`core/playalong.js`)

**Labels:** `good first issue`

The play-along judge decides whether you hit a note, early or late, and writes the line after a pass ("11 of 14, the
bend in bar 10 is late."). It's pure: no DOM, no clock, every time a song beat. Today it's only exercised by
`tools/tabs-test.js`, a browser suite that takes a while and needs Chromium. The fast unit tests in `test/unit/`
don't touch it.

Write `test/unit/playalong.test.js` with `node:test`, covering at least:

- `groupsOf`: notes within 0.03 beats are one chord; a chord's `p` is its lowest pitch; `bar` and `beat` are 1-based
  (beat 1.5 is the and of 1); `start` shifts every group.
- `windowsOf`: never tighter than 35 ms, never looser than 75 ms (hit) and 200 ms (late), and tighter in a fast run.
- `describeGroup`: "the bend in bar N", "the chord on beat 1 of bar N", a single note named in the key when one is
  given.
- `passLine`: all hit ("…, all in time."), nothing heard, a steady lean early or late, one wrong note, one missed note.

Start from:

- `app/src/core/playalong.js` (the header comment lists every function and what it returns)
- `test/unit/rng.test.js` or `test/unit/timing.test.js` for the shape of a unit test here
- `tools/tabs-test.js`, section 4, for cases the browser suite already relies on

Check:

```sh
node --test test/unit/playalong.test.js
node --test "test/unit/*.test.js"     # what CI runs
npx @biomejs/biome@2.5.15 ci test/unit       # a test-only change needs only Biome, not all of `npm run check`
```

---

## 2. Unit tests for `genreOf` (`core/sounds.js`)

**Labels:** `good first issue`

`genreOf(text)` reads a request ("make some dubstep") and returns the genre whose sound rows the studio should offer
first, or `null`. Nothing tests it. Pin what it does today with a table of inputs, including the spellings people
type for drum and bass ("Drum & Bass", "drum n bass", "drum'n'bass", "DnB", "d&b"), whole words only ("growling" is
`null`, "growl" isn't), and empty or `null` input.

While you're in there, `GENRE_ROWS` names devices and presets by id: a test that every row's device id is a built-in
(`app/src/devices/builtin/index.js` registers them on import) would catch a typo before a person does.

Start from:

- `app/src/core/sounds.js` (`GENRE_WORDS`, `genreOf`, `GENRE_ROWS`)
- `tools/pick-sound-test.js`, checks 1 to 3, which cover the rest of the module in Node; lines 101 to 111 already walk
  `SOUND_SETS` against the device registry, the pattern to copy for `GENRE_ROWS`

Check:

```sh
node --test test/unit/sounds.test.js
node --test "test/unit/*.test.js"
npx @biomejs/biome@2.5.15 ci test/unit
```

---

## 3. Type-check `core/playalong.js` and `core/sounds.js`

**Labels:** `good first issue`

Type checking is a ratchet here: a file opts in with `// @ts-check` as its first line and never opts out
(CONTRIBUTING.md, "Static checks"). These two are close. With the line added, `tsc` reports two errors in
`playalong.js` (a group's `bar` and `beat` are added after the object is made) and three in `sounds.js` (a regex
in `GENRE_WORDS` typed as `string | RegExp`, `soundsFor`'s `getDevice` option, whose `null` default leaves it typed
as a function of no arguments, and a `family` field added after the object is made). Fix them with JSDoc (`/** @typedef … */`, `/** @type … */`), not by changing what the
code does.

Start from:

- `app/src/core/playalong.js`, `app/src/core/sounds.js`
- `app/src/core/ops.js` or `app/src/core/store.js` for how the checked files write their JSDoc
- `jsconfig.json` (what `tsc` checks) and `mise.toml` (the pinned TypeScript; `mise install` fetches it)

Check:

```sh
npm run typecheck                     # tsc -p jsconfig.json: no errors
node --test "test/unit/*.test.js"
node tools/tabs-test.js               # the browser suite that uses playalong.js
node tools/pick-sound-test.js         # the suite that uses sounds.js
```

---

## 4. The README's credits and licence note have fallen behind `docs/SOUNDS.md`

**Labels:** `good first issue`, `documentation`

`docs/SOUNDS.md` is the record of every recorded sound the studio plays. The README's "Credits" and "Licence"
sections summarise it, and they've drifted:

- Rusty Sticks (`core.metalkit`, Big Rusty Drums, `tools/kits/big-rusty-sticks.js`) isn't credited in the README,
  though Rusty Brushes, from the same set, is.
- The cabinet impulse responses that Half Stack, Iso Cab and Y Cable play (Jester Dyne Productions' Brutal and
  Emerald packs, CC0, `tools/kits/jester-cabs.js`) aren't credited.
- "Licence" says "both sets are CC0 1.0" about the fetched samples. There are many sets now, and one (Salamander) is
  public domain rather than CC0.

Bring the README in line with SOUNDS.md, in the README's own voice: short, the source, the licence, the recipe file.
Don't add counts; the ones the README has are checked by `tools/pages-test.js`.

Start from:

- `README.md` ("Credits", "Licence")
- `docs/SOUNDS.md` (one section per set)

Check:

```sh
node tools/pages-test.js              # the claims checks read README.md
```

and read each credit against its SOUNDS.md section.

---

## 5. `tools/check-device.js`: run the device check on a device file from the command line

**Labels:** `help wanted`

Writing a device today means either asking an agent (`define_device`) or importing a file into the studio to see the
check's report. A command that checks a `.overdub-device.json` in Node would make the loop
write → check → fix much shorter, and give device pull requests something to paste.

`checkDeviceNode(def)` already exists and runs the kernel in a child process; `summarize(report)` turns the report
into one line. This works today, run from the repo root:

```sh
node --input-type=module -e "
import fs from 'node:fs';
import { checkDeviceNode } from './app/src/engine/node/check.js';
import { summarize } from './app/src/kernel/check.js';
const file = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const r = await checkDeviceNode(file.device ?? file);
console.log(summarize(r));
for (const m of [...r.errors, ...r.warnings]) console.log(' ', m);
process.exit(r.ok ? 0 : 1);
" my-device.overdub-device.json
```

Turn it into `tools/check-device.js`: one or more files, `--quick`, `--json` for the full report, exit 1 if any file
fails. Refuse a file that isn't `overdub-device/0` (or a bare definition) with a plain message. Add a line to
`docs/DEVICES.md` ("The loop") and run `node tools/docs-build.js`, since DEVICES.md is built into the docs hub.

Start from:

- `app/src/engine/node/check.js` (`checkDeviceNode`), `app/src/kernel/check.js` (`summarize`)
- `app/src/ui/devices-io.js`, where the studio reads a device file
- `tools/kernel-test.js`, which already calls `checkDeviceNode`
- `app/src/kernel/examples.js` (`TESTFILTER`, `TESTSYNTH`): definitions that pass, to test against. To make a file of one:

  ```sh
  node --input-type=module -e "import { TESTFILTER } from './app/src/kernel/examples.js'; console.log(JSON.stringify({ format: 'overdub-device/0', device: TESTFILTER }))" > testfilter.overdub-device.json
  ```

Check:

```sh
node tools/check-device.js <a passing file>; echo $?    # 0
node tools/check-device.js <a failing file>; echo $?    # 1, with the error
node tools/kernel-test.js
node tools/pages-test.js                                # the docs hub matches DEVICES.md
```

---

## 6. A device: tremolo and auto-pan

**Labels:** `good first device`

There's tremolo inside Lamp Tines and Suitcase, but no tremolo you can put on any track. Write one as a kernel effect:
RATE (Hz, or synced to the tempo with `lfo.sync`), DEPTH, a SHAPE switch (sine, triangle, square) and a MODE switch
(tremolo, where both sides move together, or pan, where they move opposite). Make up the level so it lands within
3 LU of bypass at its defaults, and keep the square shape from clicking (a short `dsp.slew` on the gain does it).

Start from:

- `docs/DEVICES.md`, from "For agents" down: the definition, the kernel, the rules and the `dsp` library
- `app/src/kernel/examples.js` (`TESTFILTER`): an effect kernel that passes the check
- `app/src/devices/builtin/keys.js`: the suitcase tremolo, for reference

Use your own handle in the id (`<you>.tremolo`). A device file keeps the kernel as one JSON string, which is no fun to
write by hand, so write the definition as a `.js` module with a default export and the kernel in a template literal,
the way `app/src/devices/library/*.js` do, and wrap it into a device file:

```sh
node --input-type=module -e "import { pathToFileURL } from 'node:url'; const d = (await import(pathToFileURL(process.argv[1]).href)).default; console.log(JSON.stringify({ format: 'overdub-device/0', device: d }, null, 2))" my-tremolo.js > my-tremolo.overdub-device.json
```

Or import the file into the studio (⇧⌘I) and export it from the rack (⌥⌘E).

Check: the device check passes with no warnings. Run the snippet in issue 5 (or `tools/check-device.js`, once it
exists) on your file, then put it on a track in a demo song and listen. Post the file and the check's line here.
Where it lands (a built-in, or the community shelf once it opens) is the maintainers' call.

---

## 7. A device: ring modulator

**Labels:** `good first device`

Multiply the input by a sine and you get the metallic, bell-like sidebands of a ring modulator: robot voices, clangy
guitars, drums that ring. Write one as a kernel effect: FREQ (log, about 20 Hz to 4 kHz), a little LFO on the
frequency (RATE, DEPTH) and MIX. With a high FREQ and bright input the sum frequencies pass half the sample rate and fold back down; keep
FREQ's range where that doesn't matter, or run the multiply through `dsp.oversample2x()`.

Start from the same places as issue 6, and write it as a `.js` module the same way. `dsp.osc('sine')` and `dsp.lfo()`
do the work.

Check: the device check passes with no warnings (the snippet in issue 5), and the `extremes` cases show no runaway
at FREQ and DEPTH maxed. Post the file and the check's line here.

---

## 8. Record a room, and release it CC0

**Labels:** `help wanted`

A reverb we're building (not in the public code yet) plays the start of a measured impulse response from a real space
and hands off to a fitted tail. The rooms it can ship are limited by licences: most impulse-response libraries don't
allow redistribution. A room you can get into (a stairwell, a church, a tiled bathroom, a car park) recorded with a
sine sweep and released CC0 would be one anybody can ship.

What helps most:

- a sine sweep played from a speaker and recorded with the mic placement written down (distance, height, mic,
  speaker), at 48 kHz, 24-bit, mono or a stereo pair;
- the deconvolved impulse response, or the sweep and the recording so it can be deconvolved here;
- a photo or a sentence about the space, and a plain statement that you release the recordings under CC0 1.0 and
  have the right to (your space, or permission to record in it).

Start from:

- `docs/SOUNDS.md` ("What a set has to be", and "Adding a set")
- `CONTRIBUTING.md` ("Sounds": contributed audio must be CC0)
- `tools/kits/qa.js` and `tools/kits/jester-cabs.js`: how recorded impulse responses are pinned and checked today

Check: the files and the CC0 statement are on the issue, with their SHA-256 (`shasum -a 256 *.wav`), so they can be
pinned in a recipe exactly as uploaded.
