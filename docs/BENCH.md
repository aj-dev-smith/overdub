# OverdubBench

An open benchmark for agents that make music with a person: fifteen jobs a musician would actually ask for, each
scored 0 to 1 by **measurement**, not by a judge. The bench renders the agent's song with the canonical Node renderer
(`app/src/engine/node/render.js`), listens with the studio's own ears (`app/src/audio/measure.js`: LUFS, true peak,
band energy, stereo, key) and reads the notes (key, clashes, range, timing). A number is held against a target range.
Nothing in a score is an opinion, and nothing in it changes between runs.

Why it exists: agents can't hear, so the studio measures; publishing the
measurements as a benchmark sets the terms for what "an agent that can mix" means.

```sh
node tools/bench/run.js                                    # every task: its oracle and the do-nothing baseline
node tools/bench/run.js --list                             # the tasks and their instructions
node tools/bench/run.js mix-chorus-lift ops.json           # score an agent's ops on one task
node tools/bench/run.js mix-chorus-lift --song final.json  # score a song exported from the studio
node tools/bench/run.js mix-chorus-lift --start --out start.json   # the song the agent is handed
node tools/bench-test.js                                   # oracles >= 0.9, baselines < 0.5, scores repeat
```

`--json` prints one JSON result per line. No install, no network, no LLM: the bench never calls a model.

**A submission is code.** Scoring renders the agent's song, and its devices (`define_device`, the song's own kernels)
run in Node, not in a browser's audio worklet. So `run.js` scores an ops log or a song from outside the checkout
under Node's permission model (`tools/node-permissions.js`): it runs itself again in a process that can read the checkout and
that one file, write nothing and start no other program. Node 24's model doesn't cover the network, so a kernel could
still send what it can read. Score submissions you'd run as code. `OVERDUB_TRUST_KERNELS=1` scores in-process instead;
`node tools/render.js song.json` works the same way.

## The tasks

| task | family | the instruction (short) | what is measured |
|---|---|---|---|
| `mix-bass-under-kick` | mix | bass about 3 dB under the kick below 250 Hz, kick untouched | Bass minus Kick, sub+low band energy, verse |
| `mix-chorus-lift` | mix | chorus 1.5-3 LU louder than the verse and wider | LUFS and side/mid, chorus minus verse |
| `mix-darken-keys` | mix | keys 3-6 dB down in presence (4-8 kHz), loudness within 1 LU | Keys presence and LUFS vs before |
| `mix-master-loudness` | mix | -11 LUFS, true peak at most -1 dBTP, crest down 6 dB at most | integrated LUFS, true peak, crest vs before |
| `mix-mono-low-end` | mix | side under 120 Hz at least 30 dB under mid, highs as wide as before | band-limited side/mid of the mix |
| `mix-hook-in-front` | mix | hook 2 LU over every other track in the chorus, chorus up 1 LU at most | per-track LUFS, chorus |
| `write-counter-melody` | writing | 8+ notes in key on a new track, no semitone clashes on beats 1 and 3, within 18 semitones, its own line | the notes, plus the new track's loudness |
| `write-bassline` | writing | roots of Am F C G on every downbeat, 12+ notes, in key, E1 to C3 | the notes, plus the bass's loudness |
| `write-drum-groove` | writing | kick 1 and 3, snare 2 and 4, eighth hats, a different bar 4 | hits on the grid, plus the kit's loudness |
| `write-harmonize-hook` | writing | a held chord per chorus bar, 3+ notes, in key, containing the hook's downbeat note | chords under the melody |
| `device-dotted-echo` | device | write an echo: dotted eighth, tempo-locked, repeats at least 6 dB under the dry | a click through it at 100 and 130 bpm |
| `device-decaying-instrument` | device | write an instrument whose notes fall under -60 dBFS within 1.5 s, held or not | three probe notes, one held 2 s |
| `device-rumble-filter` | device | write an effect: 100 Hz down 18 dB, 50 Hz down 24, 1 and 3 kHz within 1 dB | test tones through it vs bypass |
| `edit-quantize-swing` | editing | quantize the loose drums to 1/16, swing kept within 10% | distance from the swung grid, swing ratio |
| `edit-chorus-up-a-step` | editing | chorus bass, keys and hook up two semitones; drums and verse untouched | the notes, and the key measure() hears (B minor or D major) |

The full instruction is the task's `instruction` field, written the way a musician says it. That sentence, and the
song, is everything an agent is given.

## Files

| path | what |
|---|---|
| `tools/bench/tasks/<id>.json` | a task: `id`, `family`, `title`, `instruction`, `song` (a file in `songs/`), `setup` (ops the house applies first), `checks` |
| `tools/bench/songs/*.json` | the starting songs, with fixed ids (ids seed devices, so they are part of the sound). `make-songs.js` wrote them from `app/src/core/demo.js` and a few hand-built parts; rerun it only to change a song on purpose |
| `tools/bench/score.js` | the scorer: `loadTask`, `startSong`, `applyOps`, `scoreTask`, `report`, `transactionsOf` |
| `tools/bench/probes.js` | the bench's test sources (`bench.click`, `bench.sine`) for device probes |
| `tools/bench/run.js` | the command line |
| `tools/bench/oracles/<id>.json` | a hand-made solution for every task: `{ task, why, ops }` |
| `tools/bench/oracles/near-misses/*.json` | plausible wrong answers that must score under 0.5 |
| `tools/bench-test.js` | the bench's own checks (run by `tools/run-all.js`) |

## Scoring

A task is a list of checks. Each check measures one number and holds it against a target `[lo, hi]` (`null` is
open-ended). Inside the range it scores 1; outside, it falls off linearly to 0 over `soft` (no `soft`: pass or fail).

```
score = (sum of weight x check score over the goals / sum of weights) x (product of the gates' scores)
```

**Goals** are what the instruction asks for ("1.5-3 LU louder"). **Gates** are what it says must not happen ("don't
touch the verse", "a device written for the job", "the hook as it was"); a gate multiplies, so breaking the song to
hit a number scores nothing. Every task also gets the house gate `clean`: everything the scorer rendered came out
without NaN and without a device that failed to build or faulted. The result lists every check with its value, unit,
target and score, plus any render warnings, so a score explains itself:

```
mix-chorus-lift  1.000  (Make the chorus lift)
  1.00 w3  Chorus loudness minus verse loudness: 2.12 LU (want [1.5, 3] ±1.5)
  1.00 w2  Chorus side/mid minus verse side/mid: 7.13 dB (want [1, …] ±1)
  1.00 gate  Verse loudness vs before: 0 LU (want [-0.5, 0.5] ±1.5)
  1.00 gate  True peak of the mix: -0.61 dBTP (want […, -0.5] ±1.5)
  1.00 gate  renders clean (no NaN, no failed or faulting device): 0 problems (want [0, 0])
```

### Check kinds

| kind | measures |
|---|---|
| `measure` | a `metric` of `measure()` over a `scope` (`tracks`: names, `"new"` or the mix; `from`/`to` in beats or a `section`). Metrics: `lufs`, `truePeak`, `peak`, `rms`, `crest`, `lra`, `centroid`, `correlation`, `sideDb`, `onsetsPerSec`, `band.<name>` (absolute energy in a band, dB; `band.sub+low` sums bands), `bandRel.<name>` (relative to the whole spectrum), `side.<lo>-<hi>` (side against mid between two frequencies, dB). `minus` subtracts another scope (`each: true` takes the loudest of several tracks); `relative: true` subtracts the same number on the starting song |
| `key` | the key `measure()` hears in a scope is `expect` (or its relative major/minor) |
| `count`, `inKey`, `span`, `within` | notes in a selection (`tracks`, `from`, `to`, `pitches`): how many, the share in the song's key, highest minus lowest, the share inside `lo`..`hi` |
| `clashes` | strong beats (1 and 3) where the selection sounds a semitone, major 7th or minor 9th against another |
| `doubling` | the share of notes that start with the same pitch class as another part (a copy is not a counter-melody) |
| `unchanged`, `transposed` | the share of the starting song's notes still exactly there, or exactly `semitones` away |
| `roots`, `pattern`, `differs`, `chordsUnder` | chord roots on downbeats; hits at given positions in each bar; one bar differs from another; held in-key chords containing the melody's note |
| `jitter`, `swing` | RMS distance from the 1/16 grid swung as the starting groove swings; how much the swing moved |
| `defined` | the track's instrument, or one of its inserts, is a kernel written in this song since the start |
| `echoTime`, `echoLevel`, `dryKept` | a click (`bench.click`) through the track's inserts at each tempo: the first repeat's delay and level against the dry hit; the dry hit against no inserts |
| `decayTime`, `decayPeak` | probe notes on the track's instrument alone: time to fall under a threshold after the strike; peaks |
| `toneGain` | sine tones (`bench.sine`) through the track's inserts, against the same tones with nothing in the way |

Device probes measure the device, not the mix: the scorer builds a one-track song with the track's inserts (or its
instrument), a test source and no master inserts, and renders that.

### What makes it repeatable

- **One renderer.** Scores come from the canonical Node render, never the browser preview. It runs kernels only:
  graph devices (the pedals and amps) are bypassed there, so every task needs kernel devices only (`bench-test`
  checks the starting songs). An agent that reaches for a pedal is scored as if the pedal weren't there, and the
  result says so in `warnings`.
- **Stable ids.** The studio gives new tracks, clips and inserts random ids, and ids seed devices. Before rendering,
  the scorer renames every id the starting song didn't have by position (`t_nw0000`, `fx_nw0000`, ...), so the same
  ops score the same however many times they are applied.
- **Checked.** `tools/bench-test.js` scores every oracle twice, the second time with fresh renders and fresh random
  ids, and requires every check's value to match exactly.

## Oracles, baselines and near misses

Every task has a hand-made solution in `oracles/`, written as ops the way an agent sends them (`apply_ops`), with a
one-line `why`. The device oracles are short kernels (`bench.dotted-echo`, `bench.struck-bar`, `bench.rumble-cut`)
written against the public `dsp` stdlib. Today every oracle scores 1.000.

The **do-nothing baseline** is the starting song, unchanged: mean 0.040, and at most 0.295 (`mix-mono-low-end`,
where the smeared low end sits partway to the target). The **near misses** are the answers a careless agent gives:
a plain 1/16 quantize that kills the swing, transposing only the hook, burying the bass to get it under the kick,
darkening the keys by turning them down, the house echo at a straight eighth. Each scores 0.000. Together they show
the scorers discriminate: the right move scores high, doing nothing scores low, and the plausible wrong move scores
low too.

`node tools/bench/run.js` prints the table.

## Running an agent

The bench scores a song; how the agent got there is up to the harness. With Overdub's MCP server (no LLM is called
by the bench itself):

1. **Hand over the song.** `node tools/bench/run.js <task> --start --out start.overdub.json` writes the starting
   song. Open the studio (`node server/serve.js`, then <http://localhost:3279/app/?new>) and open the file (Song menu,
   ⌘O, or drop it on the page). A scripted harness can do the same through `tools/pw.js`:
   `page.evaluate((s) => overdub.store.load(s), song)`.
2. **Connect the agent.** `claude mcp add overdub -- node <repo>/server/mcp.js` (or the claude.ai
   connector, [REMOTE-MCP.md](REMOTE-MCP.md)). Give it the task's `instruction`, verbatim, and nothing else from the
   task file. A typical run: `get_guide` → `get_project` (`detail: "full"`) → `render_and_measure` → `apply_ops` /
   `define_device` → `render_and_measure` again to check its own work → done. Its own measurements come from the
   browser preview, which agrees with the canonical render within -90 dBFS for kernels.
3. **Export the song.** Song menu → Save project (`.overdub.json`), or from a harness
   `JSON.stringify(overdub.store.get())`. Alternatively, log the agent's MCP tool calls as
   `{ "calls": [{ "tool", "input" }] }`: `run.js` replays `apply_ops` and `define_device` (with `use_on`) through the
   same store and ignores the rest.
4. **Score it.** `node tools/bench/run.js <task> --song final.overdub.json` (or `<task> calls.json`).

A fair run: a fresh starting song per task, the instruction and the studio's tools only (no task files, oracles or
scorer), every task attempted, the per-task scores and checks published with the mean, plus the model, the date, the
number of runs, and the bench version (`overdub-bench/0`, in every result). Don't tune a prompt on the tasks.

## Adding a task

Write `tasks/<id>.json` (copy a neighbour), point it at a song in `songs/` (or add one through `make-songs.js`),
add `oracles/<id>.json`, and run `node tools/bench/run.js <id> --oracle` and `node tools/bench/run.js <id>` until the
oracle scores at least 0.9 and doing nothing scores under 0.5. If there is a plausible wrong answer, put it in
`oracles/near-misses/<id>.<what>.json`. Never change a published task's targets or song: add a new task id instead
(task ids are forever, like device ids), so scores from different dates stay comparable.

## What the bench has found so far

- **Gatefold's MONO BASS (`core.width` `monobass`) widens the lows it should narrow.** On the `mix-mono-low-end`
  starting song, the Bass track's side/mid under 120 Hz reads -15.5 dB with Gatefold at its default; with MONO BASS
  at 120 Hz it reads -13.2 dB (wider), at 250 Hz -13.9, and only at 500 Hz -17.7. The side's lows are taken out as
  `s - lp(lp(s))` with two 2nd-order low-passes, which is not a complement: below the cutoff the phase shift makes the
  difference larger than the input. The oracle uses Gatefold's WIDTH at 0 on the bass instead.
- **Partial credit is real credit.** Turning the master up 10 dB alone puts `mix-master-loudness` at -10.96 LUFS
  with true peaks at -0.51 dBTP, half a dB over the spec: it scores 0.673 (the true-peak gate at 0.67). The oracle's
  limiter, pushing 2.5 dB into a -1.5 dB ceiling, lands at -10.98 LUFS and -1.6 dBTP and scores 1.
