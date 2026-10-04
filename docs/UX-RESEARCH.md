# Overdub UX research: how people get musical ideas out, and how an agent should help

*2026-09-30. A synthesis of three research sweeps (expression interfaces, human-AI co-creation, translator and agent experience). It builds on the landscape report ("AI web DAW landscape", 24 September 2026, private research notes) and does not repeat it. It is written against the contracts in [ARCHITECTURE.md](./ARCHITECTURE.md).*

**How to read the evidence.** Each claim is tagged by how much weight it can bear:

- **[strong]**: a controlled study, a large-n study or survey, or a shipped product behaviour we confirmed.
- **[moderate]**: a small study (n of 5 to 26), a formative evaluation, or a reputable review.
- **[weak]**: a vendor blog, a forum post, a search snippet, or a figure we could not confirm.
- **[inference]**: our own reasoning or practitioner convention.

Nobody on the research side tested any product hands-on. Several papers were read only as abstracts or summaries. Those cases are flagged where they occur.

---

## 1. The short version

- **Capture first, structure later.** The tools that best protect ideas never ask you to press record. Live's Capture MIDI and Ableton Note's ghost notes record what you just played, after the fact. Overdub should be listening all the time and should never throw a take away.
- **The human's material is the seed, and the agent works on a selected span.** The studies that report ownership and control all scope the AI: one voice, one bar range, one selection. That holds for Cococo, Hooktheory Aria and Rhapsody Refiner. Whole-song generation is what most producers reject: 82% of non-users object on artistic grounds, and only 3% of AI users generate whole songs.
- **Language is the weakest input channel.** Both the CHI 2025 prompt study and an independent text-to-music study find that words cannot carry chord progressions, timing or arrangement. Hum, tap, play, selection and reference tracks carry more. Words are best used to steer something that already exists.
- **The agent's output is notes and parameters, never opaque audio.** Editable output is what users value. It is also what the US Copyright Office treats as human control over expression.
- **For an agent, picking the operator is easy and choosing the parameters is hard.** In RIME, edit similarity fell 39% (GPT-4o mini) and 52% (Gemma 3n) as mixing instructions got more abstract, while operator choice held up. The fix is perceptual-unit macros backed by a lexicon, plus a render, measure and correct loop. A better prompt does not fix it.
- **Musical words are personal.** In SocialEQ, "warm" was the most-taught word but ranked only 10th for agreement between people. Overdub should treat the lexicon as a prior, learn each user's meaning by A/B, and always show the exact parameter change it made.
- **Measurement only helps when it is relative and phrased like a musician.** Libretto's loop lifted pass rate from 62% to 94% with feedback such as "reduce harmonic instability", judged against corpus-calibrated budgets. Overdub's measurements should be stated against a reference ("4 dB more low-mid than your reference") and not as raw numbers.
- **Show, don't just do.** Every edit should carry its author, a reason and its colour. The agent should point at what it changed (as FL Studio's Gopher highlights UI) and be undoable at three grains: one op, one batch, one whole agent session. A majority of creators expect AI use to be disclosed, and only 6% would hide it.
- **Offer a few strong alternatives, not a slot machine.** Two to four diverse takes with a visible diff work. Endless re-rolls cause idea fixation and decision fatigue, and they remove ownership.
- **Do the chores first.** Producers accept AI for stem separation, tuning, levelling and file management (60% see value). Generative replacement is where they push back. Chores are the trust-building on-ramp.

---

## 2. Design principles

**1. Never lose an idea: capture is always on, retroactive and durable.**
Live's [Capture MIDI](https://help.ableton.com/hc/en-us/articles/360000776450-Capture-MIDI) listens to armed tracks all the time. After you play, it makes a clip and infers tempo and loop length, so the decision to record is never made up front **[strong: shipped]**. [Ableton Note](https://www.soundonsound.com/reviews/ableton-note) does the same and shows what you played as uncommitted "ghost notes" until you keep them. Live's buffer clears after about 30 seconds of silence followed by new playing, which means ideas can still be lost **[weak: search summary; page 403]**.
*In Overdub:* a ring buffer on every input (MIDI, mic, qwerty) that writes to a durable, attributed capture log ("you, hummed, 19:42"). It never silently expires. `get_capture` gives the agent the same view.

**2. The human brings the seed; the agent develops it.**
In Rhapsody Refiner's four-week diary study, musicians tied their strong sense of ownership to the tool *requiring* their input: "You have to create and be creative for it to work" ([arXiv 2509.25834](https://arxiv.org/html/2509.25834v1)) **[moderate: n = 8]**. The main objection producers raise is ownership, not quality: 82.2% of non-users say "I want my art to be my own" ([MBW, Tracklib n = 1,107](https://www.musicbusinessworldwide.com/25-of-music-producers-are-now-using-ai-survey-says-but-a-majority-shows-strong-resistance/)) **[strong]**. More than a third fear "musical sameness" ([Sound On Sound](https://www.soundonsound.com/music-business/ai-music-tech-2026)) **[strong]**.
*In Overdub:* no "make me a song" button on the first screen. The empty state invites a hum, a tap or a played riff, and the agent's first moves build on that.

**3. Scope every AI action: select a span, then ask.**
In Cococo, voice lanes, sliders and multiple alternatives raised control, ownership and sense of collaboration. Users composed "bit by bit" because they could not evaluate large outputs ([Magenta](https://magenta.tensorflow.org/people-first-hci-ml-collaborations)) **[moderate: CHI 2020; n not recovered]**. Hooktheory's Aria infills only the selected region and has served 318k suggestions, of which about 74k (23%) were accepted ([ISMIR 2024 LBD](https://ismir2024program.ismir.net/lbd_489.html)) **[moderate]**. ElevenLabs and Udio have both converged on section inpainting ([ElevenLabs docs](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/inpainting)) **[strong: shipped]**.
*In Overdub:* `ui.state.selection` is the default scope of every agent request. A request with no selection ("make it warmer") resolves to the visible track and bars, and the agent says which scope it used.

**4. AI output is a typed musical object you can edit.**
Amuse turns images, text or audio into *chord progressions*. Participants felt "more guided and aligned with their creative goals" than with Aria alone, and it won Best Paper at CHI 2025 ([arXiv 2412.18940](https://arxiv.org/abs/2412.18940)) **[moderate]**. The [USCO Part 2 report](https://copyrightalliance.org/ai-report-part-2-copyrightability/) holds that prompting alone is not authorship, while human selection, arrangement and modification can be **[strong: primary policy]**. MIDI recovered from generated audio is a lossy transcription (landscape report).
*In Overdub:* agents write notes in the `pitch@start:dur*vel` format, drum grids, device params and kernels. Generated audio is only ever a *reference* or a texture bed, never the source of truth.

**5. Words steer; they don't specify.**
A CHI 2025 comparison of prompt, preset and motif modes found that language alone struggles to convey temporal or musical nuance ([GIST record](https://scholar.gist.ac.kr/handle/local/31492)) **[moderate: n = 17; snippet only]**. [Ronchini et al.](https://arxiv.org/pdf/2509.23364) found text-to-music good at early ideation and poor at refinement. Users wanted part-level editing, and regeneration produced "unpredictable variation rather than targeted refinement" **[moderate]**. "Play Me Something Icy" names the semantic gap as an open problem ([arXiv 2408.07224](https://www.arxiv.org/abs/2408.07224)).
*In Overdub:* the agent panel accepts words *plus* attachments: the current selection, a capture, or a reference clip. A word-only request about melody or harmony triggers "hum it or tap it?" rather than a guess.

**6. Musical context is a shared signal that parts follow.**
Logic's Session Players follow the Chord Track and the Arrangement track, and editing a chord re-performs the part ([Apple](https://support.apple.com/en-lamr/guide/logicpro/lgcp70dd5af3/mac), [CDM on Logic 12](https://cdm.link/logic-pro-12-hands-on/)) **[strong: shipped]**. Bitwig 6 Note FX can "Use Global Key" ([listing](https://www.pluginboutique.com/products/16950-Bitwig-Studio-6)), and Live 12's MIDI tools quantise to the clip or global scale ([Attack](https://www.attackmagazine.com/reviews/gear-software/live-12s-midi-tools-midi-revolution/)) **[strong: shipped]**. The AI Song Contest teams asked for section-aware generation ([paper](https://ar5iv.labs.arxiv.org/html/2010.05388)). The pitfall: Logic's players silently ignore the chord track when one checkbox is set wrong.
*In Overdub:* project `key`, a chord track and `sections` are first-class signals. Devices and agents subscribe to them, and the device face *shows* what it is following.

**7. Agents can't hear, so the studio measures, and speaks musician.**
Libretto's generate, fingerprint and feedback loop lifted pass rate from 62% to 94% ([arXiv 2606.22708](https://arxiv.org/html/2606.22708)) **[moderate]**. Two details matter most. Feedback was phrased in musical terms, and budgets were calibrated per genre against a corpus. The Expressive Communication study judged tools by whether the composer's *intent reached listeners* (26 composers, 1,000+ judgements; [arXiv 2111.14951](https://arxiv.org/abs/2111.14951)) **[moderate]**.
*In Overdub:* `render_and_measure` returns numbers *and* a short sentence relative to a baseline (the previous take, a reference, or a genre norm). The human can see the same readout.

**8. Operators are easy, parameters are hard: give agents perceptual units and a correction loop.**
In [RIME/POEMS](https://arxiv.org/html/2607.19605), models chose the right mixing operator more reliably than they set its parameters; edit similarity fell 39% for GPT-4o mini and 52% for Gemma 3n from the most concrete to the most abstract instructions (Gemini 3 Flash dropped less, about 18%) **[moderate]**. [LLM2Fx](https://arxiv.org/html/2505.20770v2) worked best when the LLM saw the effect's *code*, measured DSP features and few-shot examples together **[moderate]**. [Text2FX](https://arxiv.org/html/2409.18847v2) succeeded 67 to 74% of the time by optimising EQ and reverb toward a text direction, with 167 listeners **[moderate]**.
*In Overdub:* an `adjust` tool takes a perceptual axis and an amount ("brightness, a bit"). It resolves through the lexicon, renders, measures and nudges until the measured change lands. The agent can read kernel source and metadata, which Overdub already exposes.

**9. Words are personal: learn the user's dictionary.**
SocialEQ collected 324 words over 731 sessions. "Warm" was taught most (57 times) but ranked only 10th for agreement: it agrees *within* groups and not *between* them ([ISMIR 2013](https://archives.ismir.net/ismir2013/paper/000173.pdf)) **[strong for the dataset]**. The same word also depends on the source: a mid boost brightens a bass-heavy sound but makes a broadband one "tinny" (Sabin & Pardo) **[moderate]**. Audealize's word-map beat traditional EQ and reverb interfaces for nonexperts (n = 432; [MSR](https://www.microsoft.com/en-us/research/?p=214990)) **[moderate]**.
*In Overdub:* the first time AJ says "warm", the agent offers two audible versions and stores the pick as a personal lexicon entry. The parameter change for each word is always shown.

**10. Show, don't just do: attribution and pointing are default.**
FL Studio 2026's Gopher changes the mixer, plugins and piano roll, and it can *highlight the UI area* it is talking about ([MusicRadar](https://www.musicradar.com/music-tech/you-can-now-control-fl-studio-with-an-ai-chatbot-from-inside-the-daw)) **[strong: shipped]**. In the Sonarworks/SoS survey (n = 1,100+), 58% see AI's role as supportive with humans in control, a majority favour disclosure and only 6% would conceal AI use ([SoS](https://www.soundonsound.com/music-business/ai-music-tech-2026)) **[strong]**.
*In Overdub:* `--human` (warm) and `--agent` (cool) colouring on notes, clips and params. A History tab that shows *who did what and why*. The agent calls `highlight` before or with every change it describes.

**11. Undo at every grain, including "undo the agent".**
Shneiderman's creativity-support guidelines put easy backtracking, what-if exploration and session replay at the top ([workshop summary](https://ghostweather.com/blog/archive/20060209-creativity-support-tools/)) **[moderate: expert consensus]**. Cursor users complained loudly when per-change accept/reject became session-level only ([forum](https://forum.cursor.com/t/per-change-keep-undo-buttons-missing-after-agent-edits-only-undo-all-available/158983)) **[weak but pointed]**.
*In Overdub:* undo works at three grains: one op, one agent transaction, and the whole agent session ("undo everything Claude did since 19:30"), with `store.undo({ by })` already in the contract. Human edits made in between survive.

**12. A few diverse alternatives beat endless re-rolls.**
Cococo's Multiple Alternatives raised ownership **[moderate]**. One AI Song Contest team generated 450+ melodies to hand-pick a few, which is curation as a workaround for missing steerability **[moderate]**. A novice production case study found *idea fixation* on early outputs and *decision fatigue* from too many options ([arXiv 2501.15276](https://arxiv.org/html/2501.15276v2)) **[moderate]**.
*In Overdub:* `propose_variations` returns 2 to 4 takes, each labelled by *what differs* ("busier hats", "half-time feel"). There is never an unlimited regenerate button.

**13. Protect flow: no brake pedal.**
Koala's stated design goal was "no brake-pedal, no way to stumble down a rabbit-hole of micro-editing" ([Sonic State](https://sonicstate.com/news/2019/03/04/koala-sampler-for-ios/)). The EP-133 puts sampling, sequencing and hold-to-apply punch-in FX on one surface ([SOS](https://www.soundonsound.com/reviews/teenage-engineering-ep-133-ko-ii)) **[strong: shipped and well reviewed]**. Wessel and Wright require "minimal and low variance latency" for expressive instruments ([NIME 2001](https://nime.org/proc/nime2001_wessel/)) **[strong: canonical]**.
*In Overdub:* the agent never blocks the transport, never steals focus mid-take, and queues questions until playback stops. Agent work streams into a proposal lane while the loop keeps playing.

**14. Low floor, high ceiling, wide walls.**
Wessel and Wright pair "initial ease of use" with "long term potential for virtuosity". Resnick adds wide walls: many routes to many outcomes ([MIT](https://www.media.mit.edu/articles/lifelong-kindergarten-how-to-learn-like-a-kid-by-the-co-creator-of-scratch/)). Note ships a few good sounds with 8 macros each rather than full synth UIs **[strong: shipped]**. Simple tools that feel like toys lose users.
*In Overdub:* every built-in device opens on 4 to 8 macros, and the same face expands to every param. One more click reaches the kernel source. Mini-notation, a grid and the faceplates are three equal views of one song.

**15. One op surface for humans and agents, AI optional.**
The AI Song Contest found "model-wrangling" (per-model formats and glue) ate creative time ([paper](https://ar5iv.labs.arxiv.org/html/2010.05388)) **[moderate]**. Producer Pal's design, an MCP server plus a REST API "where the AI is optional", aims "to help people make music, not to make music instead of them" ([GitHub](https://github.com/adamjmurray/producer-pal)) **[strong: shipped design]**.
*In Overdub:* already the contract. Keep it honest: no agent-only ops, and every agent capability should be reachable by a human through the UI or console.

**16. Trust comes from portability and disclosure.**
Endlesss, a much-loved jam-as-chat app, shut down on 31 May 2024 and gave no public reason ([CDM](https://cdm.link/endlesss-discontinued/)). 67% of creators rate ethical sourcing "very important" ([SoS](https://www.soundonsound.com/music-business/ai-music-tech-2026)) **[strong]**.
*In Overdub:* export stems, MIDI, the project JSON and the attribution log from day one. The attribution log is a feature ("provenance report"), not a debug view.

---

## 3. Input modalities

The quality bars below are **[inference]** targets for us, not published standards.

### Hum and sing
- **Prior art.** Dubler 2 makes good drum triggers but weak pitch-to-MIDI. Its reviewer says almost all output needs editing, and singers who are not in control of their pitch get frustrating results ([MusicTech](https://musictech.com/reviews/software-instruments/vochlea-dubler-2-review/)) **[moderate]**. Logic 12 Chord ID takes a voice memo and produces a chord track ([CDM](https://cdm.link/logic-pro-12-hands-on/)). A crowd of 2026 hum-to-instrument apps exists (Voice2MIDI, HumTrack, Veena). The only useful claim in [Veena's own roundup](https://www.veena.studio/blog/best-ai-voice-to-instrument-tools) is that editable MIDI is what separates the good tools **[weak: vendor]**. Voice-as-sketch is established research: [Sketch2Sound](https://arxiv.org/pdf/2412.08550), [Sketching With Your Voice](https://arxiv.org/html/2409.13507v1).
- **What to build.** Record, then transcribe (not real-time). Detect key and tempo from the take. Snap to key and grid, with the snap strength adjustable. Show low-confidence notes dimmed as ghost notes. Give one-tap "keep" and a "make this a bassline / lead / chords" handoff to the agent.
- **Quality bar.** Notes appear within about 2 s of stopping. For a reasonably in-tune hummer, at least 80% of notes are kept without correction. The hummed audio is always kept alongside the notes so the user can A/B against what they meant.
- **Pitfalls.** Promising transcription. Hiding the snap (the user must see "I moved 3 notes into C minor"). Treating vibrato and scoops as extra notes.

### Beatbox and tap
- **Prior art.** Dubler trains each sound with up to 12 repetitions, and three sounds take about 15 s to train. Accuracy drops beyond about 3 triggers, and double-triggers are the main annoyance (same review) **[moderate]**.
- **What to build.** A "tap it" mode for rhythm: tap any key or pad, or beatbox into the mic. Classify into at most 3 to 5 user-trained classes (kick, snare, hat to begin with) and quantise. Output a drum grid in the `x..o` format, which both the human and the agent can read.
- **Quality bar.** Train in under 30 s. Debounce double-triggers. Offline (post-take) classification ships first. Real-time triggering waits until browser input latency is measured and under control. Keep the latency compensation visible.
- **Pitfalls.** Too many classes. Assuming browser mic latency is low (it varies by device, so measure it and compensate after the fact).

### Play (MIDI, guitar, qwerty)
- **Prior art.** Live and Note capture (above). Suno Studio 2.0 has "musical typing" with an arpeggiator and chord mode ([Suno](https://blog.suno.com/blog/studio-2)). MPE controllers (Osmose, Seaboard, LinnStrument) now cost under $1,500 ([KVR thread](https://www.kvraudio.com/forum/viewtopic.php?p=7580713)) **[weak: forum aggregate]**. Our own guitar studio, amp and pedal sims are the strongest asset here.
- **What to build.**
  - Retroactive capture on all inputs.
  - A qwerty keyboard with scale lock (from the project key).
  - Guitar in through `getUserMedia` with echo cancellation, noise suppression and AGC off, then into ported amp and pedal rigs.
  - A per-note expression field in the note model (bend, pressure, slide), so MPE and Pointer Events pressure have somewhere to go later.
- **Quality bar.** The input-to-sound path is measured and shown (round-trip latency in ms). Jitter matters as much as average latency (Wessel and Wright).
- **Pitfalls.** Monitoring latency that nobody tells you about. Scale lock that the user cannot turn off.

### Draw
- **Prior art.** Suno Studio's drawn automation, the piano roll, and Loopy Pro's user-arranged canvas of pads, sliders and XY controls ([App Store](https://apps.apple.com/us/app/-/id1492670451)) **[moderate]**. Pointer Events expose pressure and tilt **[inference: standard API]**.
- **What to build.**
  - Draw a melodic contour across bars and snap it to scale and rhythm (a "shape" generator, like Live 12's Shape).
  - Draw automation.
  - Draw a performance surface: the agent builds a custom XY or pad face from device metadata on request ("give me one knob that goes from clean to destroyed").
- **Quality bar.** A drawn contour becomes audible notes in one gesture. Undo works per stroke.
- **Pitfalls.** Freehand drawing that produces unmusical rhythm. Default to coarse rhythmic snapping.

### Describe (words)
- **Prior art.** Descript's Underlord runs chained instructions and shows edits for approval ([help](https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript)). FL Gopher. Suno's chat bar can make instruments and plugins. ProducerAI "Spaces" make instruments and effects from language ([TestingCatalog](https://www.testingcatalog.com/google-adds-producerai-for-music-creation-to-its-labs-platform/)) **[weak: no usage data]**.
- **What to build.** Words resolve through the translator (section 4) into scoped ops or proposals. Words are the *right* channel for timbre, space, feel and for making devices ("a fuzz that gates hard and sputters"). Words are the *wrong* channel for melody and harmony, so redirect those to hum, tap or play.
- **Quality bar.** Every word-driven change shows the parameter change and a before/after audition.
- **Pitfalls.** Chat as the main UI. Long clarifying dialogues.

### Reference ("make it sound like this")
- **Prior art.** 90% of mix engineers use references. They extract *feel* (balance, space, frequency profile, dynamics), not exact sound, and 78% confirm engineer-picked references with the client ([arXiv 2309.03404](https://arxiv.org/html/2309.03404v3)) **[strong: survey]**. Logic Chord ID pulls a chord track from any audio.
- **What to build.** Drop a clip in. Overdub runs `measure()` on it: LUFS, bands, centroid, width, onsets per second and key. It becomes a *target profile*, and later measurements are phrased relative to it. Optionally extract chords and tempo as editable context.
- **Quality bar.** The comparison is legible as a band-by-band "yours vs reference" bar, and every number has a one-line musician gloss.
- **Pitfalls.** Implying we copy the sound. Copy-risk on melodies (Libretto checks this).

---

## 4. The agent as translator

AJ's job for years was to hear "make it warmer", a hum and a reference, and turn them into moves in a DAW. The agent's job is the same, and the research says how good translators do it.

**The loop.** This is studio practice **[inference]**, formalised by SocialEQ, Audealize and Sabin & Pardo's preference learning, which converges in about 25 trials **[weak: snippet]**.
1. **Anchor.** Get something concrete: the selection, a reference, a capture. If there is nothing, ask for one (hum or tap).
2. **Classify the word.** Is it timbre (luminance, texture, mass), space, dynamics, time feel or performance? Timbre words collapse to roughly three axes, *luminance, texture, mass*, across languages ([Zacharakis et al.](https://sonicfield.org/library/an-interlanguage-study-of-musical-timbre-semantic-dimensions-and-their-acoustic-); [Saitis & Weinzierl](https://depositonce.tu-berlin.de/items/b605438e-8a1b-4c32-970b-05b33ee6b7bf)) **[strong]**. Performance words follow Juslin's cue profiles (below).
3. **First pass from the lexicon prior,** conditioned on the source. Check the user's personal lexicon first, then a verified preset or macro library (constrained retrieval beat pure semantic matching in [TimberAgent](https://arxiv.org/pdf/2603.09332)), and only then raw parameters.
4. **Measure and correct.** Render, confirm the measured change went the intended direction by a perceptible amount, and fix overshoot.
5. **Offer a binary when the word is ambiguous** ("more like A or B?"), then take relative follow-ups ("a bit more").
6. **Name and store.** Label the result ("warm: tape + low shelf") and save the user's choice to their lexicon.

**When to ask instead of act.** This is an **[inference]** rule; there is no controlled study of clarifying questions in audio. Ask, with one question and 2 to 3 *audible* options, when any of the following holds:
- The word has low inter-person agreement ("warm", "tight", "fat").
- It has two meanings ("tight" can mean performance timing or mix control).
- The move would replace human-authored notes.
- The audition would be longer than about 8 bars.

Otherwise act directly, show the diff, and keep it one undo away.

**Performance words are a separate lexicon.** Juslin's cue profiles: anger is loud, sharp timbre, fast, staccato, abrupt attack. Sadness is slow, soft, legato, slow attack. Tenderness is slow, soft, legato, soft timbre ([summary](https://labs.sonicfield.org/library/perceived-emotional-expression-in-synthesized-performances-of-a-short-melody-cap)) **[strong: well replicated]**. Swing ratio *falls* as tempo rises, and "laid-back" means onsets sit behind the beat while the pulse stays steady ([Friberg & Sundström](https://acoustics.org/pressroom/httpdocs/137th/friberg.html)) **[strong]**. So Overdub's groove model must make swing tempo-dependent.

### Translator lexicon

This ships as editable data (`lexicon.json`) with per-user overrides. Most moves are **practitioner convention** and are a *prior* to be checked by measurement and not by trust. Frequency bands follow common cheat sheets ([mastering.com](https://mastering.com/wp-content/uploads/2017/07/EQ-CHEAT-SHEET.pdf), [iZotope glossary](https://www.izotope.com/en/learn/a-glossary-of-common-and-confusing-mixing-terms)). Compressor timing follows [mastering.com](https://mastering.com/compression-explained-attack-release/) and [Mastering The Mix](https://www.masteringthemix.com/blogs/learn/the-secret-to-compressor-attack-and-release-time).

| Word | Usually means | Parameter moves | Source / caveat |
|---|---|---|---|
| **warm** | less top, more low-mid body, gentle harmonics (mass up, luminance down) | Low shelf +1–3 dB at 100–250 Hz; high shelf −1–3 dB above 6 kHz; light tape/tube saturation (2nd harmonic); slower comp attack | [SocialEQ](https://archives.ismir.net/ismir2013/paper/000173.pdf): most taught, only 10th for agreement. **Always A/B and learn.** |
| **bright** | more upper partials (luminance up) | High shelf +2–4 dB from 4–8 kHz; presence +1–2 dB at 2–5 kHz; exciter or drive | Source-dependent: thin material turns "tinny" (Sabin & Pardo) |
| **dark** | luminance down | High shelf or low-pass, −2–6 dB above 3–6 kHz; slower filter envelope | Separate from "dull" with "but still clear" |
| **airy / air** | top-octave sheen | High shelf +2–4 dB at 10–12 kHz; gentle exciter; reverb pre-delay | Watch sibilance and noise floor |
| **muddy** | low-mid build-up or smear | Broad cut −3–6 dB at 200–400 Hz; high-pass non-bass at 80–150 Hz; shorter reverb, faster release | Also means "smeared in time" |
| **boomy** | excess low end, often resonant | Cut 80–150 Hz, narrow-to-medium Q; high-pass; check resonant peaks | Kick vs bass vs room need different cuts |
| **thin** | not enough body (mass down) | +2–3 dB at 100–250 Hz; parallel saturation; less low-end width | Do not boost into the mud band |
| **full / fat** | mass up, or layered | Low-mid body up at 100–300 Hz; parallel compression; saturation; double or detune 5–15 cents | "Fat" can mean "layered", so ask |
| **boxy** | cardboard resonance | −3–5 dB at 250–500 Hz, Q about 1.5 | Drums, acoustic guitar |
| **honky / nasal** | mid resonance | −2–4 dB at 400–1000 Hz (often near 500 Hz), Q about 2 | Vocals, snare |
| **harsh** | painful upper mids | −2–4 dB at 2–4 kHz (dynamic EQ preferred); soften saturation; slower attack | [SocialFX word](https://arxiv.org/html/2505.20770v2). Not the same as "aggressive", which is wanted |
| **tinny** | thin plus edgy | −2–4 dB at 2–5 kHz and +2 dB at 100–300 Hz | SocialEQ: **highest agreement**. Synonyms hollow, crisp, shrill |
| **sibilant / spitty** | hard "s" sounds | De-ess at 4–10 kHz | Vocals |
| **crunchy** | odd-harmonic grit, mid-forward | Moderate drive (hard clip or tube); mid-forward 1–3 kHz | Not "fuzzy" |
| **fuzzy** | saturated, compressed, woolly | Heavy fuzz clipping; lower mids; squashed dynamics | Strongly source-dependent; our pedal sims fit here |
| **gritty / dirty** | textured noise and saturation | Light bit-reduction or tape noise; mid saturation | Add a low-pass and it reads as lo-fi |
| **smooth** | no edges | Tame 2–5 kHz; slow attack and release compression; less distortion; slower envelopes | SocialEQ top-10 word |
| **punchy** | strong transient, then body | Comp attack 10–30 ms, release about 50–150 ms; transient shaper attack up; kick body 60–100 Hz, click 2–5 kHz | Too-fast attack *kills* punch |
| **snappy** | short and bright transient | Faster decay; transient up; +2–3 dB at 3–5 kHz | |
| **tight** | (a) timing or (b) control | (a) Quantise strength 60–100%, shorter notes. (b) Shorter release and decay, gate, shorter reverb, high-pass | **Two meanings: ask which** |
| **loose** | human, relaxed timing | Microtiming ±10–25 ms; lower quantise strength; longer decays | |
| **glue / glued** | parts feel like one mix | Bus comp 2:1–4:1, attack 10–30 ms, auto or medium release, 1–3 dB gain reduction | |
| **squashed / pumping** | heavy compression or ducking | Ratio 8:1+, fast release; sidechain duck 4–8 dB | Often a complaint, sometimes a request |
| **lush** | big, soft, wide space | Plate or hall 2–3.5 s, pre-delay 20–40 ms, damped highs; stereo chorus or ensemble | Pads |
| **spacious / wide** | room and width | Reverb size and decay up; mid/side or Haas width (10–25 ms); keep lows mono | Check mono compatibility |
| **distant** | far from the listener | More wet, less direct; shorter pre-delay; high shelf −2–4 dB; lower level | SocialReverb word |
| **intimate / dry / close** | near, little room | Wet under 10%, decay under 0.8 s; slight proximity boost near 150 Hz | "Dry" has high agreement (SocialEQ) |
| **laid-back / lazy** | behind the beat, pulse steady | Backbeat 10–30 ms late; swing up a little; legato; less velocity variation | [Friberg & Sundström](https://acoustics.org/pressroom/httpdocs/137th/friberg.html) |
| **swing / shuffle** | delayed offbeats | Offbeat ratio 1.5:1 to 2:1, **lower at faster tempos**; name the subdivision | Friberg & Sundström |
| **aggressive** | angry performance | Velocity +15–25, staccato, fast attacks, 5–15 ms ahead of the beat, more drive, brighter | Juslin's anger profile |
| **gentle / tender** | soft performance | Lower velocity, legato, slow attacks, darker timbre | Juslin's tenderness profile |
| **bouncy** | lilting articulation | Short-long pairs; accented offbeats; slight swing; staccato | Inference |
| **ethereal** | floating, otherworldly | Long reverb plus shimmer; high-passed echoes; slow pad attack; chorus | Imagery word: Text2FX-style search does best here |

**Worked example [inference].** "Make the chorus warmer and lazier."
1. Scope: the chorus section, so `highlight` it.
2. "Warmer" has low agreement and there is no personal entry yet, so offer two audible warm versions: tape plus low shelf, or a darker high shelf.
3. "Lazier" is time feel: shift snare and backbeat 15 ms late and add a little tempo-scaled swing. Do this directly, because it is small and reversible.
4. `render_and_measure` before and after, then report: "low-mid +2.1 dB, air −1.8 dB, snare 15 ms behind the beat".
5. Save AJ's pick of "warm".

---

## 5. Collaboration mechanics

**Proposals vs direct edits.** Use a gradient, not a mode switch.
- **Direct edits:** small, reversible and non-destructive. Param nudges, mix moves, adding a new track or clip, quantise.
- **Proposals:** anything that replaces or rewrites human-authored notes, changes song structure, or takes more than a few seconds to audition.

This is grounded in the ownership findings (Cococo, Rhapsody) and in coding agents' accept/reject loop ([Descript](https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript), [AgentClick](https://arxiv.org/pdf/2604.16520)). The thresholds are **[inference]**. AgentClick adds a caution: how an agent frames and orders options can silently steer the human **[weak: snippet]**. So shuffle the order of A/B cards and never label one "recommended" by default.

**Variations and A/B.** `propose_variations` produces 2 to 4 cards.
- Each card has a one-line *difference* label and a measured delta.
- Each card has instant audition: hold to hear it, release to go back, like punch-in FX.
- The original is always card "A, as it was".
- "Keep" commits the take as one transaction. "Mix" lets the human take bars 1 to 4 from B and 5 to 8 from C.

**Infill and partial regeneration.** These are named operations rather than prompts, after Aria's three modes: *continue*, *fill the gap*, *chords from melody / melody from chords*. Each runs on a selection, keeps the context around it fixed, and honours key and chord track. Ableton's verbs make good transform ops too: strum, ornament, ramp, connect.

**Attribution colouring.** `--human` (warm) and `--agent` (cool) apply at the note, clip, param and device level.
- An edited agent note becomes "co-authored" and shows both, so authorship is not erased by touching it.
- The History tab is a readable story: who, what, why, and when.
- A per-song **provenance summary** gives the share of notes, params and arrangement by author. It is useful evidence under [USCO's](https://copyrightalliance.org/ai-report-part-2-copyrightability/) selection, arrangement and modification test. It is evidence and not legal advice.

**Undo the agent.** Undo works at three grains.
- One op.
- One agent transaction.
- "Revert agent session". This un-applies only that author's transactions and keeps interleaved human edits. It is the most important trust feature after attribution.

There is also a **Stop** button that always works, mid-tool-call included.

**Presence.** We found no source on agent presence in a DAW; Figma-style cursors are the nearest pattern. Our proposal **[inference]**:
- The agent is a named participant with an avatar in the agent hue.
- It has a visible region highlight ("working on bars 9 to 16, Bass").
- A live one-line status ("rendering chorus, 3/4").
- Its pending proposals sit in a lane above the arranger.
- The human's selection is never moved by the agent.

**Asking questions.** One question at a time, at a natural pause (transport stopped or loop boundary), with buttons that *play* the options. Bundle questions rather than interrupting a take.

**Keeping flow.**
- The agent works asynchronously.
- Proposals arrive at loop boundaries.
- Nothing modal appears while recording.
- Performance controls (hold-to-apply FX, macros, the capture key) are always one key away.
- Wessel and Wright's low-jitter requirement applies to the agent too: never make audio glitch while the agent renders. Offline renders should run off the main audio path.

---

## 6. AX: what our agents need

Overdub's tool catalog (ARCHITECTURE.md) is already close to right. These principles sharpen it.

1. **Few, task-shaped tools (about 15 to 25), plus one atomic op batch.** Anthropic's guidance is to consolidate around tasks, offer `response_format: concise | detailed`, paginate and truncate with hints, and use unambiguous names ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)) **[strong: practitioner guidance with evals]**. openDAW's third-party MCP, with 500+ tools in full mode, is the counter-example; even it now offers a 39-tool lite mode ([PyPI](https://pypi.org/project/opendaw-mcp/), checked 1 Oct 2026). Add `response_format` to `get_project`.
2. **Readback equals writeback.** Whatever an agent writes, it can read back in the same compact notation: notes text, drum grids, param objects. Libretto chose absolute onsets and explicit durations so that a local edit never shifts later notes ([arXiv 2606.22708](https://arxiv.org/html/2606.22708)). That is exactly our `C4@0:0.5` format. Keep it.
3. **Every op carries author *and* reason.** `dispatch(ops, { by, label })` already exists. Make `label` required for agents and show it in History.
4. **Render and measure in one call, with a baseline.** Return numbers, a musician-language gloss and the delta versus a named baseline (previous, reference or genre). Add an optional labelled spectrogram or loudness image. VLMs read spectrograms only moderately (GPT-4o reached 59% on ESC-10; [arXiv 2411.12058](https://arxiv.org/pdf/2411.12058)) **[moderate]**, so images supplement the numbers and never replace them.
5. **Perceptual-unit tools on top of raw params.** Add `adjust({ target, axis: 'brightness'|'warmth'|'punch'|'space'|'width'|'swing'|..., amount: 'a_touch'|'a_bit'|'a_lot' })`. It resolves through the lexicon (personal entries first), applies, measures, corrects, and returns the exact param diff. This follows RIME's finding that operator choice is easy and parameters are hard.
6. **Give the agent the device's own source and measured behaviour.** LLM2Fx did best with code, features and examples combined. `list_devices` should return param roles, units and ranges. `define_device` should return a check report: does it compile, does it make sound, is it free of NaNs, plus a measured response to test signals.
7. **Errors that teach.** Say what was invalid, the valid range, and a corrected example (`"pan 1.4 out of range -1..1; did you mean 1?"`), never an opaque code.
8. **Idempotent, previewable, reversible.** Ops are safe to retry. An agent can `preview` an op set (audition without commit) and can `undo` its own work at any grain.
9. **Context tools.** `get_selection` (what the human is looking at), `get_capture` (what they just played), and something like `get_history({ since, by })` so the agent knows what the human changed after its last move and does not fight it.
10. **`ask_human` as a tool.** It takes a question plus 2 to 3 op-set options rendered as audible buttons. The answer comes back as a tool result. This makes clarifying questions structured and auditable.
11. **Reference profiles as data.** `set_reference(clip)` stores a measured target. `render_and_measure` then reports against it by default.
12. **Evaluate AX with real briefs.** Build a benchmark of multi-step briefs ("make the chorus feel lazier and warmer", "build a fuzz that gates hard", "turn this hum into a bassline"). Score by tool calls, errors, tokens and the measured outcome, and read the transcripts. As Anthropic notes, "small refinements to tool descriptions can yield dramatic improvements".

---

## 7. Feature recommendations

| Priority | Feature | Why (principle) |
|---|---|---|
| **P0** | Always-on retroactive capture (MIDI and qwerty) to a durable capture log; "keep" turns ghost notes into a clip | P1 never lose an idea |
| **P0** | Hum to notes: record, detect key and tempo, snap with visible repair and dimmed low-confidence notes | P2, P5: human seed, multimodal |
| **P0** | Tap to rhythm (keys or pads) into a drum grid; beatbox classification can follow | P5, P13 |
| **P0** | Selection-scoped agent requests; agent says what scope it used and `highlight`s it | P3, P10 |
| **P0** | Human/agent colouring on notes, clips and params; History tab with author and reason | P10, P16 |
| **P0** | Three-grain undo, including revert-agent-session; an always-working Stop | P11 |
| **P0** | `propose_variations` as 2 to 4 A/B cards with difference labels, hold-to-audition, "A, as it was" | P12 |
| **P0** | `render_and_measure` with baseline deltas and musician-language glosses | P7 |
| **P0** | Lexicon v1 as data plus an `adjust` macro tool with a measure-and-correct loop | P8, P9 |
| **P0** | Macro-first device faces generated from metadata; the guitar rig (amps, pedals) ported as headline devices | P14 |
| **P0** | Agent-built kernels via `define_device`, with a check report and auto-generated face | P15, luthier |
| **P0** | Export: WAV stems, MIDI, project JSON | P16 |
| **P1** | Personal lexicon learned by A/B ("which is your warm?") | P9 |
| **P1** | Project key, chord track and sections as signals that devices follow; follow-state shown on faces | P6 |
| **P1** | Named infill ops: continue, fill the gap, chords from melody, melody from chords | P3, P4 |
| **P1** | Reference track drop-in, measured as a target profile, plus chord and tempo extraction | P5, P7 |
| **P1** | Presence: agent region highlight, status line, proposal lane | P10, P13 |
| **P1** | `ask_human` with audible options, deferred to natural pauses | P13 |
| **P1** | Hold-to-apply punch-in FX recorded as performance | P13 |
| **P1** | Provenance report export (authorship share and edit story) | P16 |
| **P1** | Live-12-style transforms (strum, ornament, ramp, humanise, tempo-aware swing) as ops | P4, P6 |
| **P2** | Mini-notation text view as an equal editor (Strudel-style) | P14, P15 |
| **P2** | Per-step parameter locks in the grid | P14 |
| **P2** | User- or agent-built performance surfaces (XY pads, pad grids) from metadata | P14 |
| **P2** | Real-time beatbox triggers with trained classes | P13 |
| **P2** | Per-note expression (MPE, pointer pressure) | P14 |
| **P2** | Real-time generative texture beds (Magenta RealTime-style) as a "jam partner" track | P4 (texture, not source) |
| **P2** | Multiplayer human and agent sessions; sharable, forkable devices | P15, P16 |

---

## 8. Anti-patterns to avoid

1. **Slot-machine regeneration.** Unlimited whole-thing re-rolls cause fixation, fatigue and lost ownership (Cococo, the 450-melody curation, the [novice study](https://arxiv.org/html/2501.15276v2)).
2. **Chat as the main interface.** The research consistently finds language is the weakest musical channel ([Ronchini](https://arxiv.org/pdf/2509.23364), CHI 2025).
3. **"Make me a song" on the first screen.** It fights the 82% who object on ownership grounds and gives the weakest authorship footing ([USCO](https://copyrightalliance.org/ai-report-part-2-copyrightability/)).
4. **Opaque audio as the source of truth.** Transcribed MIDI is lossy and cannot be edited at the level the musician cares about.
5. **Silent agent edits.** No diff, no colour and no reason erodes trust immediately.
6. **Session-only undo.** Per-change control is a real need ([Cursor forum](https://forum.cursor.com/t/per-change-keep-undo-buttons-missing-after-agent-edits-only-undo-all-available/158983)).
7. **One fixed meaning per word.** "Warm" means different things to different people, and the same word means different things on different sources ([SocialEQ](https://archives.ismir.net/ismir2013/paper/000173.pdf)).
8. **Raw numbers without a reference.** "−14.2 LUFS, centroid 2.3 kHz" does not tell anyone what to do. Libretto's gains came from calibrated, musical feedback.
9. **Hidden dependencies.** Logic players that silently ignore the chord track. Overdub should show what each part follows.
10. **Promising transcription.** Untrained voices transcribe badly (Dubler review). Promise *repair and confirm*.
11. **Too many simultaneous prompt knobs.** Live Music Models users reported "takeover" and unpredictability as prompts were added ([arXiv 2508.04651](https://arxiv.org/html/2508.04651v3)).
12. **Interrupting a take.** Questions, modals and toasts during recording break flow (Koala's "no brake pedal").
13. **A tool zoo for agents.** Hundreds of thin endpoints (openDAW's third-party MCP lists 500+ in full mode) instead of task-shaped tools.
14. **Lock-in.** Endlesss was loved and still closed. No export means no trust.
15. **Steering by framing.** An agent that always lists its favourite option first, or labels it "best", quietly takes authorship away.

---

## 9. Open questions for AJ

1. **Who is the first user?** The musician friend who hums and says "warmer", or you, the translator? The empty state, the default devices and the level of agent initiative all differ between them.
2. **How proactive should the agent be?** Should it only act when asked, or should it notice things ("your bass and kick clash at 80 Hz, want me to fix it?")? The research supports chores first, but unprompted suggestions risk breaking flow.
3. **Proposal thresholds.** Is "never rewrite human notes without a proposal" right for you, or too slow when you are driving and just want it done? Should there be a per-session "trust level"?
4. **What should "warm" mean for you?** Can we seed your personal lexicon by A/B-ing 10 words with you, with the result becoming the demo of the feature?
5. **Generated audio, ever?** Is a texture bed from a real-time model (Lyria / Magenta RealTime) in scope, or is Overdub strictly notes, params and kernels? That choice decides the brand ("we never make the song for you").
6. **Real-time mic features.** How much do you want live beatbox and hum triggering versus record-then-convert, given browser input latency?
7. **Provenance as a product feature.** Should the authorship report be a headline (for artists who need to show human authorship) or a quiet tab?
8. **A study.** Would you run a Rhapsody-style diary study with 5 to 8 musician friends for a few weeks? Our attribution log would produce the data, and no published study exists yet of agentic DAW control from a human-factors angle.

---

## 10. Sources

**Products and docs**
- Ableton Capture MIDI: https://help.ableton.com/hc/en-us/articles/360000776450-Capture-MIDI
- Ableton Note review (SOS): https://www.soundonsound.com/reviews/ableton-note
- Ableton Note announcement (Attack): https://www.attackmagazine.com/news/ableton-has-announced-note-a-playable-ios-music-app/
- Note jamming anecdote (Loopy Pro forum): https://forum.loopypro.com/discussion/comment/1280702/
- Live 12 MIDI tools (Attack): https://www.attackmagazine.com/reviews/gear-software/live-12s-midi-tools-midi-revolution/
- Live 12 FAQ: https://help.ableton.com/hc/en-us/articles/11535349458588
- Logic Pro 12 hands-on (CDM): https://cdm.link/logic-pro-12-hands-on/
- Logic release notes: https://support.apple.com/HT203718
- Logic Session Players: https://support.apple.com/en-lamr/guide/logicpro/lgcp70dd5af3/mac
- Bitwig Studio 6: https://www.pluginboutique.com/products/16950-Bitwig-Studio-6
- Koala Sampler (SOS): https://www.soundonsound.com/reviews/elf-audio-koala-sampler
- Koala Sampler (Sonic State): https://sonicstate.com/news/2019/03/04/koala-sampler-for-ios/
- Koala mix update (RouteNote): https://create.routenote.com/blog/koala-sampler-gains-new-mix-powers/
- EP-133 K.O. II (SOS): https://www.soundonsound.com/reviews/teenage-engineering-ep-133-ko-ii
- Endlesss shutdown: https://cdm.link/endlesss-discontinued/ and https://musictech.com/news/gear/tim-exile-endlesss-app-shut-down
- Dubler 2 review (MusicTech): https://musictech.com/reviews/software-instruments/vochlea-dubler-2-review/
- Veena roundup (vendor): https://www.veena.studio/blog/best-ai-voice-to-instrument-tools
- HumTrack: https://play.google.com/store/apps/details?id=com.humtrack.app&hl=en
- Hooktheory Aria: https://www.hooktheory.com/blog/generative-ai-songwriting/
- Scaler 3: https://musictech.com/reviews/plug-ins/scaler-3-review/ and https://scalermusic.com/products/scaler-3/
- MPE market thread (KVR): https://www.kvraudio.com/forum/viewtopic.php?p=7580713
- Loopy Pro: https://apps.apple.com/us/app/-/id1492670451
- Polyend Tracker and p-locks: https://www.perfectcircuit.com/signal/what-is-a-tracker-polyend-tracker-mini
- Digitakt review (RA): https://de.ra.co/reviews/21197
- Strudel: https://strudel.cc/learn/getting-started
- Suno Studio: https://suno.com/blog/suno-studio, https://blog.suno.com/blog/studio-2, https://blog.suno.com/release-notes/studio-2
- Suno Studio deep dive (Making a Scene): https://www.makingascene.org/suno-studio-a-deep-dive-into-the-first-true-generative-audio-workstation/
- Udio review roundup (secondary): https://beginnersinai.org/?p=3016
- ElevenLabs Music v2: https://blog.dubspot.com/elevenlabs-music-v2-2026 and https://elevenlabs.io/docs/eleven-api/guides/how-to/music/inpainting
- Google ProducerAI: https://www.testingcatalog.com/google-adds-producerai-for-music-creation-to-its-labs-platform/
- MusicFX DJ / Lyria RealTime: https://deepmind.google/blog/new-generative-ai-tools-open-the-doors-of-music-creation/ and https://techcrunch.com/2025/05/20/google-brings-a-music-generating-ai-model-to-its-api-with-lyria-realtime
- FL Studio 2026 Gopher: https://www.musicradar.com/music-tech/you-can-now-control-fl-studio-with-an-ai-chatbot-from-inside-the-daw and https://rekkerd.org/image-line-launches-fl-studio-2026-redesigned-flex-secure-cloud-project-backup-smart-assistance-more/
- Claude connectors tested (secondary): https://godberrystudios.com/posts/claude-for-creative-work-9-connectors-tested-2026/
- Producer Pal: https://github.com/adamjmurray/producer-pal
- Descript Underlord: https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript
- Figma write-to-canvas: https://developers.figma.com/docs/figma-mcp-server/write-to-canvas
- Cursor per-change undo thread: https://forum.cursor.com/t/per-change-keep-undo-buttons-missing-after-agent-edits-only-undo-all-available/158983
- SAFE plugins: https://www.semanticaudio.ac.uk/?p=1886
- Anthropic, Writing tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Tool design principles (secondary): https://jiangren.com.au/en/learn/ai-engineer/tool-design-principles

**Research**
- Wessel & Wright, NIME 2001: https://nime.org/proc/nime2001_wessel/
- Resnick, Lifelong Kindergarten: https://www.media.mit.edu/articles/lifelong-kindergarten-how-to-learn-like-a-kid-by-the-co-creator-of-scratch/
- Shneiderman creativity support tools workshop: https://ghostweather.com/blog/archive/20060209-creativity-support-tools/
- Cococo and Magenta HCI: https://magenta.tensorflow.org/people-first-hci-ml-collaborations
- Cococo talk summary (secondary): https://speakerdeck.com/sappho192/hci-on-music-ai
- AI Song Contest: https://ar5iv.labs.arxiv.org/html/2010.05388 and https://research.google/pubs/ai-song-contest-human-ai-co-creation-in-songwriting/
- Expressive Communication: https://arxiv.org/abs/2111.14951
- Rhapsody Refiner: https://arxiv.org/html/2509.25834v1
- Amuse (CHI 2025): https://arxiv.org/abs/2412.18940 and https://nmsl.kaist.ac.kr/projects/amuse
- Loop Copilot: https://arxiv.org/html/2310.12404v2
- Hooktheory Aria (ISMIR 2024 LBD): https://ismir2024program.ismir.net/lbd_489.html
- Prompt-based music GenAI (CHI 2025): https://scholar.gist.ac.kr/handle/local/31492
- Text-to-music in production (Ronchini et al.): https://arxiv.org/pdf/2509.23364
- Play Me Something Icy: https://www.arxiv.org/abs/2408.07224
- Novice music production case study: https://arxiv.org/html/2501.15276v2
- Live Music Models (Magenta/Lyria RealTime): https://arxiv.org/html/2508.04651v3
- Strudel (ICLC 2023): https://iclc.toplap.org/2023/catalogue/paper/strudel-live-coding-patterns-on-the-web.html
- Strudel teaching study (Chalmers): https://research.chalmers.se/publication/541425
- Sonic Pi EDM teaching (Napier): https://napier-repository.worktribe.com/output/2792807/teaching-live-coding-of-electronic-dance-music-a-case-study
- Timbre semantics, interlanguage (Zacharakis et al.): https://sonicfield.org/library/an-interlanguage-study-of-musical-timbre-semantic-dimensions-and-their-acoustic-
- Timbre semantics review (Saitis & Weinzierl): https://depositonce.tu-berlin.de/items/b605438e-8a1b-4c32-970b-05b33ee6b7bf
- SocialEQ (ISMIR 2013): https://archives.ismir.net/ismir2013/paper/000173.pdf
- Sabin & Pardo (patent text): https://www.google.com.au/patents/US20140272883
- Audealize: https://www.microsoft.com/en-us/research/?p=214990
- Text2FX: https://arxiv.org/html/2409.18847v2
- LLM2Fx: https://arxiv.org/html/2505.20770v2
- RIME/POEMS: https://arxiv.org/html/2607.19605
- TimberAgent: https://arxiv.org/pdf/2603.09332
- MixAssist: https://arxiv.org/abs/2507.06329
- LLM4FM / ICML 2026: https://icml.cc/virtual/2026/77367
- Sketch2Sound: https://arxiv.org/pdf/2412.08550
- Sketching With Your Voice: https://arxiv.org/html/2409.13507v1
- Mix engineers and references: https://arxiv.org/html/2309.03404v3
- Artist and engineer communication (Waves write-up): https://waves.com/keep-artists-producer-on-the-same-page-in-a-mix
- Juslin, emotional expression in performance: https://labs.sonicfield.org/library/perceived-emotional-expression-in-synthesized-performances-of-a-short-melody-cap
- Friberg & Sundström, swing and timing: https://acoustics.org/pressroom/httpdocs/137th/friberg.html
- Libretto: https://arxiv.org/html/2606.22708
- MIDI-LLaMA: https://arxiv.org/html/2601.21740v1
- VLMs on spectrograms: https://arxiv.org/pdf/2411.12058
- Agentic artifact creation: https://arxiv.org/pdf/2608.28122
- AgentClick: https://arxiv.org/pdf/2604.16520

**Surveys, policy and mixing references**
- Tracklib survey (MBW): https://www.musicbusinessworldwide.com/25-of-music-producers-are-now-using-ai-survey-says-but-a-majority-shows-strong-resistance/
- MusicTech producers survey (figures unconfirmed): https://musictech.com/news/industry/music-producers-are-rejecting-ai-study-reveals-over-80-of-producers-are-against-ai-generated-songs
- Sonarworks / SoS survey: https://www.soundonsound.com/music-business/ai-music-tech-2026 and https://www.hypebot.com/the-future-of-music-production-is-human-1-100-producers-weigh-in-on-ai
- USCO Part 2: https://copyrightalliance.org/ai-report-part-2-copyrightability/ and https://www.dreyfus.fr/en/2025/02/10/ai-and-copyright-understanding-the-u-s-copyright-offices-second-report-on-copyrightability/
- EQ cheat sheet: https://mastering.com/wp-content/uploads/2017/07/EQ-CHEAT-SHEET.pdf
- iZotope mixing glossary: https://www.izotope.com/en/learn/a-glossary-of-common-and-confusing-mixing-terms
- Compressor attack and release: https://mastering.com/compression-explained-attack-release/ and https://www.masteringthemix.com/blogs/learn/the-secret-to-compressor-attack-and-release-time

*Not used, because they could not be confirmed: MusicTech's "93% prefer control, 43% want labelling, 39% want undo and compare" figures, and the claim that Udio disabled downloads after the UMG deal. Check both before citing externally.*
