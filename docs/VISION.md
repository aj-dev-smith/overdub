# Overdub: the pitch

**Play over each other.** An overdub is a new take laid over an old one. In Overdub the second player is an agent:
you lay down a take, it plays over you, you play over it, and every take is signed.

*For AJ. The story to tell when someone asks "what is it?" Facts about competitors come from the landscape report
(our AI web DAW landscape report, 24 September 2026) and the research synthesis
([UX-RESEARCH.md](UX-RESEARCH.md)); counts about the Guitar Studio were taken from Claw'd-o-Matic's source.*

## The problem: the translation gap

Musicians describe music in pictures. "Make it warmer." "The bit that goes da-da-DUM." "Like a heartbeat, but sad."
DAWs want numbers: a cutoff in hertz, an attack in milliseconds, a note on a grid, a plugin out of hundreds.

Between the two there has always been a person. AJ has been that person for years, as a musician and a computer
scientist: the friend who hears an idea and turns it into notes, knob positions and plugin chains. It is slow, it is
hard, and the idea fades while it's being translated. Most people with an idea don't have that friend, so the idea
never becomes a take.

The tools have not closed the gap. Desktop DAWs are built for people who already speak their language. The new AI
music products skip the gap by skipping the musician: type a prompt, get a song. That produces audio, but not *your*
song, and the people who make music mostly don't want it. In a survey of 1,107 producers, 82% of those not using AI
said they object on artistic grounds ("I want my art to be my own"), and only 3% of AI users generate whole songs
(UX-RESEARCH.md, principle 2).

## The insight

**Put an agent in the translator's chair, and keep the musician in the room.** The musician lays down take one;
the agent overdubs; the musician plays over that. Neither takes the tape away from the other.

The translator's job is exactly what language models have become good at: understanding loose, metaphorical
language and mapping it to structured, technical changes. What they cannot do is hear. So the studio has to hear for
them: render what the human hears and measure it, so the agent can check its own work before asking for anyone's
ears. And because the human owns the song, every change the agent makes has to be visible, signed and undoable.

## The product

Overdub (Overdub Studio, where the name needs a qualifier) is a music studio in the browser, built from the ground
up for a musician and their agents.

- **Hum it, tap it, play it, say it.** The studio captures first and structures later: a hum becomes notes on a
  pitch spiral, desk-drumming becomes a groove on the grid, a guitar goes through real pedals and amps, words steer
  what's already there. Nothing you play is lost.
- **The agent plays over you.** "Darker" becomes a lowpass move; "half-time in the bridge" becomes a new drum grid;
  a hummed riff becomes a bassline in key. The agent says what it recorded, what changed and the number ("Take 2 is
  in: Claude doubled your keys an octave up. Keep it?"), and always shows the exact change.
- **Build anything.** Ask for an instrument or effect that doesn't exist ("a pedal that makes my guitar sound
  underwater in a cathedral"). The agent writes it as a small DSP kernel; the studio compiles it, renders test signals
  through it and measures it (it refuses a kernel that won't compile, outputs NaN, runs away at the ends of its knobs
  or leaves a note stuck, and reports its loudness against the input, its tail and whether it renders the same twice);
  then a face with real knobs appears, and you play it.
- **Agents can't hear, so the studio measures.** Loudness (LUFS), true peak, spectrum, key, onsets: from an offline
  render through the same graph the human hears, phrased the way a musician would ("3 LU quieter than the verse").
- **Every edit is signed.** The song is one JSON document changed only through typed ops. Each op records who made it
  (you, the in-app agent, or an outside agent) and can be undone on its own: "undo Claude's last change" leaves yours.
  Warm is you, cool is your agent, everywhere.
- **Open all the way down.** Outside agents connect over MCP (Claude Code, Claude Desktop, anything that speaks it)
  and use the same tools as the in-app agent. Devices are code. The document is the song.

## Why now

1. **Agents got good at translation and tool use** in the last year, and MCP made them portable: one tool catalog
   serves the in-app agent and every outside agent.
2. **The evidence says verification is what agents lack.** A generate, measure and revise loop raised a frontier
   model's full-piece pass rate from 62% to 94% (Libretto); in RIME, edit similarity fell 39% (GPT-4o mini) and 52%
   (Gemma 3n) as mixing instructions got more abstract, while operator choice held up. In a widely read write-up on
   driving Ableton over MCP, the author's main limit was that "the model couldn't hear what it was doing". Our
   landscape review found three problems underneath: the agent cannot hear, the project is opaque, renders don't
   repeat. Those are properties of the host, and a new host can fix them.
3. **The browser can do it now.** AudioWorklet runs custom DSP in real time, off the main thread; OfflineAudioContext renders the same
   graph faster than real time for measurement; Web MIDI and getUserMedia bring the instruments in. Claw'd-o-Matic
   proved the whole rig runs in a tab.
4. **The authorship question has an answer.** Purely AI-generated works can't be copyrighted, while human selection
   and editing can (*Thaler*; the US Copyright Office's Part 2 report). A song made of notes and parameters, with an op
   log that records who authored each note, is on the right side of that line. Generated audio sits under active
   litigation (UMG and Sony v. Suno, September 2026).

## How it differs

| | What it is | Where Overdub differs |
|---|---|---|
| **Suno Studio 2.0** | "Type a prompt, get a song", now with a timeline, MIDI and chat-made plugins; $24 a month; holds the consumer "AI + DAW" spot. | Suno's truth is audio; its MIDI is a transcription. Overdub's truth is the document: notes, parameters and code that you made, with an agent that builds what you ask for. You make the song. |
| **Audiotool 3.0 / NEXUS** | Free, multiplayer browser DAW; the whole project is a typed protobuf model with an MCP-enabled SDK shared by the app and third parties. | The closest on architecture. No documented offline render, loudness measurement or deterministic output, and nothing models authorship. Overdub's loop is render, measure, sign. |
| **openDAW** | Open-source browser DAW (AGPL), Rust/WASM engine, scriptable devices; 1.0 on 3 October 2026. A third-party MCP drives it through headless Chromium with 500+ tools in full mode (a 39-tool lite mode exists; [PyPI](https://pypi.org/project/opendaw-mcp/), checked 1 Oct 2026). | The agent loop is bolted on from outside. Overdub is built for agents from the first line: a small task-shaped tool set (40 tools), measurement in the product, attribution in every op. |
| **FL Studio Gopher** | An agentic assistant inside FL Studio 2026: sets levels, routes the mixer, writes Piano Roll content. | Closed: no MCP, no outside agents, desktop only. Overdub is open to any agent and runs in a browser tab. |

The defensible combination, which the landscape report found no one shipping: **a typed song document, edits signed
by human or agent, a render-and-measure loop built in, and devices that are seeded, deterministic code anyone (or any
agent) can write.**

## The agent-experience story

Overdub treats the agent as a first-class user with its own UX (AX), designed as carefully as the human's:

- **Few, task-shaped tools**: `get_project`, `get_selection`, `apply_ops`, `list_devices`, `define_device`,
  `render_and_measure`, `play`, `highlight`, `propose_variations`, `get_capture`, `undo`: 25 in all. Not hundreds.
- **Readback equals writeback.** The agent reads notes in the same compact text it writes (`C4@0:0.5`), drum grids as
  strings, params with units and roles (`cutoff: Hz, tone`).
- **Measurement with a baseline**, in numbers plus a musician's gloss, with a spectrogram image when it helps.
- **Errors that teach**: what was wrong, the valid range, a corrected example.
- **Scope from the human**: the selection is the default scope of every request, and the agent says what it used and
  points at it (`highlight`).
- **Options, not slot machines**: two to four variations as A/B cards with labelled differences.
- **Undo its own work**, at the grain of one op, one transaction or one session, without touching the human's.

The result for the human: an agent that doesn't guess, doesn't hide, and doesn't take over. It plays over you; it
never plays instead of you.

## The heritage

Overdub grows out of the Guitar Studio in Claw'd-o-Matic, AJ's browser punk-song maker: 101 pedals (each a small
device definition with a face drawn from metadata), 27 amps, 16 cabinets and 5 movable mics, a looper, a recorder,
YIN pitch tracking and latency calibration, all synthesized in the browser, and 156 presets in 11 banks, each
leveled by measurement (−14 LUFS within a decibel, leads a touch hotter, true peak at or below −1 dBFS). The device
def format, the faces, the measured-levels discipline and the seeded-randomness rule all come from there. The
pedalboard is Overdub's first instrument library, and its proof that "devices are small definitions" works at scale.

## Roadmap

**1. The proof of concept (now).** The studio: arranger, piano roll, drum grid, mixer, device rack with generated
faces, the Guitar Studio's pedals and amps, hum and tap capture, the in-app agent (bring your own Claude), the MCP bridge,
kernels with a device check, render and measure, signed history with per-author undo. The landing page and brand.

**2. The device marketplace.** Devices are already portable data (a kernel, params, a look). Next: versioned,
content-hashed device ids so a song always renders with the exact build it was made with; publishing a device from the
studio; a library to browse, play and fork, with the device check as the gate. Paid devices later (render free, edit
licensed), on the precedent of VCV Rack's library. Faust and Cmajor can compile to the same kernel format (and, with WASM kernels, a real sandbox), which brings
authors with them.

**3. Multiplayer.** The op log becomes the unit of sync (a CRDT stores ops, not states), so people and agents edit
the same song live: a friend on bass from another city, your agent tidying the drums, an outside agent mastering,
each in their own colour. Remix is a fork of the document with authorship carried along.

Along the way: a personal lexicon (what "warm" means to you, learned by A/B), reference tracks as measured targets,
export to stems, MIDI and DAWproject, and an AX benchmark of real briefs ("make the chorus feel lazier", "build a fuzz
that gates hard") scored by measured outcome.

## Open questions for AJ

- **Who is the first user?** The musician friend who hums and says "warmer", or the translator (you)? It changes the
  empty state, the defaults and how much the agent does unprompted.
- **Generated audio, ever?** If Overdub stays notes, parameters and code, the line "It doesn't make your song. It
  helps you make yours." can be a promise. A texture-bed model would break it.
- **Name check.** "Overdub" is studio jargon: weak to trademark and hard to find in search, so the brand uses the
  qualifier "Overdub Studio" where it needs to be found. There are neighbours: *Overdub: AI Music Generator*
  (Overdub, Inc.), an iOS prompt-to-song and voice-cloning app with the opposite pitch, and Descript's former
  "Overdub" voice-cloning feature. Trademark and domain availability have not been checked.
