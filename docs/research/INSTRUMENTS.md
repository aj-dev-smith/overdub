# Instruments: the roadmap

Research for the day run (wave 9), 2026-10-01. AJ asked for "more high quality instruments". This file lists what we
have and how it measures, which instruments a newcomer reaches for, how to build each one without samples and how to
check it without ears, then the order to build them in. It changes no product code. Every number here was measured by
the scripts beside this file, or comes from a source linked in [Sources](#sources).

- `node docs/research/instrument-audit.mjs [name]` plays single notes at three velocities across each instrument's
  range through the canonical Node renderer. It prints peak level, attack time, T60 (the slope fitted between −6 and
  −36 dB below the peak while the key is held), release time to −40 dB, spectral centroid at the onset, at 300 ms and
  at 1 s, and, for struck and plucked strings, the inharmonicity B with the partial levels. It also runs `measure()` on
  the test phrase and times 16 held notes.
- `node docs/research/drum-audit.mjs` does the same for every core.drums piece in all three kits.
- `node docs/research/synth-bench.mjs` measures the CPU of each candidate method at 16 voices.

CPU is given as a percentage of real time on one core, in Node on Apple Silicon. The AudioWorklet runs the same code,
so treat these as relative costs. Phones are 2–4× slower. The timings are wall-clock, so they move by up to about 50%
when the machine is busy: a later run under load gave Lamp Tines 8.4% against the 5.6% in the table. Compare
instruments within one run.

## In short

**What newcomers hear today:** most instruments change only their **level** with velocity, not their **colour**.
Several are close to a sine with an envelope: the marimba and kalimba (Biscuit Tin), the Lamp Tines electric piano at
soft and medium velocities, and the GRAND's bass notes. Several also get much quieter as they go up the keyboard: Biscuit
Tin loses 20 dB between C4 and C6, and Firefly loses 12 dB per two octaves.

**Batch 1, being built right now:** four instruments are in flight in `app/src/devices/builtin/`, not yet in `index.js`:
- `core.piano` Baby Grand (acoustic grand);
- `core.organ` Rotor Cabinet (tonewheel organ and rotating speaker);
- `core.strings` Music Stands (string section);
- `core.bassguitar` Flatwound (electric bass).

They measure well on character (§1). Their open problem is **CPU**: 21%, 13% and 14% of a core at 16 held voices for
the piano, organ and strings, against 2–6% for everything else. Four of them in one song would use half a core in
Node, and a phone is 2–4× slower.

**The ranked list** (value to a newcomer and to the demo songs, per unit of build risk):

| # | instrument | method | state |
|---|---|---|---|
| 1 | Acoustic grand | additive strings, B by register, unisons, hammer, lid and room | **batch 1**: `core.piano` Baby Grand |
| 2 | Electric pianos: tine and reed | modal tine/reed + pickup nonlinearity, suitcase trem; FM as a third voice | **batch 2**: new id, Lamp Tines stays |
| 3 | Tonewheel organ + rotary speaker | drawbar registrations, single-trigger percussion, click, Leslie with inertia | **batch 1**: `core.organ` Rotor Cabinet |
| 4 | Guitar from the keys ("DI Box") | Flatwound's waveguide string + per-pitch loss filter, pick/pickup combs, palm mute, strum; into the Guitar Studio amps | **batch 2** |
| 5 | String section | per-player saws with their own vibrato and drift, violin-family body, bow noise | **batch 1**: `core.strings` Music Stands |
| 6 | Electric bass | waveguide string, finger/pick/muted, pickup comb, valve DI | **batch 1**: `core.bassguitar` Flatwound |
| 7 | Drum machines: true 808 and 909 voices; acoustic kit gets velocity colour | circuit-informed voices (Werner et al.), appended `kit` options | **batch 2**: extend core.drums |
| 8 | Mallets: vibes, marimba, xylophone, glock, celesta | modal bars with tuned ratios, mallet tied to bar period, vibes motor | **batch 2**: new, plus the Biscuit Tin fix |
| 9 | Brass and sax section | loudness-tracking brightness (Risset), pitch scoop, ensemble | later |
| 10 | Polysynth upgrade: ladder filter, supersaw, velocity → cutoff | ZDF ladder (Huovilainen/Zavalishin), Szabo detune curve | later (Patch Bay v2, new id) |
| 11 | Choir upgrade: register-correct formants, per-singer jitter, consonant onsets | formant bank per register (Csound tables) | later |
| 12 | Woodwinds; upright and reese basses | noise-excited waveguide; DI Box family; detuned saws with phase drift | later |

**The two batches**

- **Batch 1 (wave 9, now):** Baby Grand, Rotor Cabinet, Music Stands and Flatwound, as built. Before they ship, four
  follow-ups from the measurements, each small:
  1. Bring each to the CPU budget (piano ≤ 10%, the others ≤ 6% at 16 voices; how, in §3).
  2. Give Flatwound velocity colour: its centroid is identical at velocity 0.3 and 1.0.
  3. Check Music Stands' 6–9 dB level swing on held notes.
  4. Check Baby Grand's top-octave decay, which may be about 2× short.

  Ship `tools/timbre-test.js` (§4) with them, so every instrument is held to its family's numbers from now on.
- **Batch 2 (wave 10):**
  - the electric pianos (`core.ep`);
  - DI Box guitar (`core.guitar`, built on Flatwound's string);
  - the 808/909 machine voices and velocity colour as new `core.drums` kit options;
  - mallets (`core.mallets`) with the Biscuit Tin mallet fix.

  Platform work alongside: a `presets` field on device defs, and expression (bend, mod, sustain) reaching the kernels
  (§5).

None of this moves a golden hash: every new sound is a new id or an appended switch option.

---

## 1. What exists, measured

### The instruments

| device | method | phrase LUFS / dBTP | 16 voices CPU |
|---|---|---|---|
| `core.keys` Lamp Tines, TINES | 2-op FM (1:1) + a 1:13.9 bell partial, two-stage decay, suitcase trem | −16.0 / −3.5 | 5.6% |
| `core.keys` Lamp Tines, GRAND | ≤14 stretched partials + 2 unison twins, hammer noise | −17.1 / −2.1 | 3.4% |
| `core.poly` Patch Bay | 2 polyBLEP oscs + sub + unison, 12 dB SVF | −16.4 / −3.8 | 4.8% |
| `core.bass` Capstan | mono saw/square + sub, 24 dB SVF, 2× drive, legato | −17.9 / −7.0 | 1.2% |
| `core.pluck` Pinch Roller | extended Karplus-Strong + 4-mode body | −17.5 / −1.5 | 1.9% |
| `core.pad` Room Tone | 3 saws + sub tri, breathing LP, chorus, FDN | −17.1 / −4.0 | 5.7% |
| `core.drums` Gobo Kit | per-hit synthesis: membrane modes, metal banks, 808-style machine | (drum phrase) | — |
| `claude.choir-loft` Choir Loft | 3 saws per note → 4 alto formants on the sum → room | −15.8 / −2.1 | 5.2% |
| `claude.dust-sheet` Dust Sheet | 8'+4' saws → 3-tap BBD ensemble | −16.7 / −2.9 | 1.7% |
| `claude.biscuit-tin` Biscuit Tin | 3-mode bar (1 : 3.93 : 9.2) or tine (1 : 6.27 : 17.55), raised-cosine mallet | −15.4 / −2.0 | 0.6% |
| `claude.sub-basement` Sub Basement | pitch-dropping sine, 2× tanh, LP | −16.0 / −3.5 | 1.8% |
| `claude.firefly` Firefly (showcase) | 6 inharmonic glass partials + flicker | −17.1 / −2.0 | 1.2% |
| `core.piano` Baby Grand (**batch 1, in flight**) | up to 56 partials, B by register, 1–3 strings, hammer, lid + room | −16.3 / −1.4 | **21.3%** |
| `core.organ` Rotor Cabinet (**batch 1, in flight**) | 9 footages per key, contact click, single-trigger perc, preamp, 2-rotor cabinet | −16.3 / −3.6 | **13.3%** |
| `core.strings` Music Stands (**batch 1, in flight**) | 3 players per note: saws with own vibrato, drift and bow; body; seating; hall | −15.9 / −3.8 | **14.3%** |
| `core.bassguitar` Flatwound (**batch 1, in flight**) | waveguide string, finger/pick/muted, pickup comb, valve DI | −15.7 / −5.3 | 3.6% |

Every instrument passes its house levels (−14 to −18 LUFS, true peak ≤ −1 dBTP). The problems below are about
character, not level. The batch-1 files were measured at about 08:10 while still being written; rerun the audit
before trusting a number.

### What a musician would hear, and what the numbers show

Velocities are 0.3 / 0.6 / 1.0. "c0" is the spectral centroid of the first 85 ms.

**Lamp Tines, GRAND (the piano a newcomer finds today).**
- *Heard:* the bass is a hum, not a piano: no wood, no growl. Every note sounds the same at every velocity, only louder
  or quieter. High notes ring too long, like a celesta.
- *Measured:* there are at most 14 partials, so E1 (41 Hz) stops at 580 Hz. The centroid at E1 is 49–76 Hz, which is
  just the fundamental; the in-flight Baby Grand measures 289–489 Hz there. The level swing across velocity is 8 dB
  (Baby Grand: 21 dB). E6 rings with T60 ≈ 7.7 s. B is 6.7e-5 at E1 and 2.7e-4 at E6, against about 2e-4 and 3e-3 on a
  real grand ([Cheng et al. 2015], fig. 2b): ten times too harmonic at the top.
- *Verdict:* superseded by Baby Grand. Keep it, since Lido and the golden scenes use it.

**Lamp Tines, TINES (the electric piano).**
- *Heard:* soft and medium notes are close to a sine with a little ping. The bark only arrives at full velocity, and
  even then it is FM brightness, not the pickup growl of a real tine piano.
- *Measured:* at C4, c0 is 277 / 338 / 570 Hz against a 262 Hz fundamental, so the second harmonic and above only show
  up at velocity 1. C2 held at velocity 1 fits a T60 of over 1000 s: the slow stage barely decays. C4 fits 18–21 s.
- *Cause:* the harmonic richness of a tine piano comes from the electromagnetic pickup, whose overtones depend on the
  tine's position relative to it, the adjustment technicians call "voicing" ([Rhodes piano]; [Pfeifle 2017], which
  models the pickup separately from the tine). It does not come from FM.

**Pinch Roller (plucked strings).**
- *Heard:* low strings are good. High strings go dull and short, like a muted koto.
- *Measured:* at E5, the partials above the 5th are at −58 to −126 dB. T60 is 4.6 s at E2 and 1.9 s at E5. Velocity
  barely moves the colour at E5 (c0 828 → 874 Hz).
- *Cause:* the classic Karplus-Strong flaw. The one-zero loss filter runs once per period, so a high string passes
  through it four times as often as one two octaves down and loses its highs four times as fast. The fix is a loss
  filter designed per pitch, for a target decay at each frequency ([Jaffe & Smith 1983]; [Bank & Välimäki 2003]).

**Biscuit Tin (marimba / kalimba). This is a bug, not just a taste issue.**
- *Heard:* a sine with an envelope. High notes vanish.
- *Measured:* the centroid equals the fundamental at every register and velocity (C4: 262 Hz exactly). The upper modes
  sit at −28 dB at C3, −57 dB at C4 and −70 dB at C5. At velocity 1, peak level falls from −9.8 dBFS at C4 to
  −29.2 dBFS at C6.
- *Cause:* the mallet is a raised-cosine pulse with a fixed length (0.4–3.5 ms). Its spectrum has its first null at
  2/T, which is about 1.25 kHz at the default 1.6 ms, right where C6's fundamental sits. It also low-passes every upper
  mode away.
- *Fix:* tie the mallet's contact time to the bar's period (contact time is a fraction of the period, shorter for
  harder mallets), and normalise the level by register.

**Firefly (glass bells).** High notes lose 12 dB per two octaves (C5 −15.5, C7 −27.5 dBFS at velocity 1), and
velocity changes level only. Same family of fix as Biscuit Tin.

**Patch Bay (poly).** Velocity moves level by 8.7 dB but barely touches colour (C2 c0 127 → 135 Hz), because the
velocity term only scales the envelope amount. Newcomers expect harder to mean brighter. The filter is a 12 dB SVF; the
"analogue poly" sound people know is the 24 dB ladder.

**Capstan (bass).** Velocity covers only 2.5 dB and the colour hardly moves. That is fine for a synth bass, but it
means typed or tapped bass lines with natural velocity spread all sound the same.

**Room Tone, Dust Sheet, Choir Loft (pads).** They behave as pads should: slow attacks of 0.1–0.7 s, and velocity
changes level only. Choir Loft uses one alto formant table for every register. A choir singing C3 with alto formants
sounds like a choir through a telephone at that pitch. Real formants shift with voice type ([Csound formant table]).

**Sub Basement.** Clean, as intended. Velocity covers 5 dB and the drive does not change with it.

**Gobo Kit (drums).** The level swing across velocity is healthy (7–16 dB between 0.4 and 1.0) and the snare's
colour follows velocity (c0 799 → 2731 Hz). But:
- FIELD kick c0 is 60 → 61 Hz and the toms are identical at both velocities: a harder hit is only louder. On a real
  drum the beater or stick click grows with force.
- MACHINE's clap and rim are the FIELD ones.
- MACHINE is one 808-flavoured machine. There is no 909: no kick click, no noise-and-triangle snare, no 909 clap. The
  hats are 808-style six squares in every kit, FIELD included.

**Guitar Studio (101 pedals, 27 amps, 16 cabinets).** These are effects, and good ones. No instrument feeds them except
Pinch Roller, which is how Halation gets its guitars. A DI-guitar instrument would turn this whole shelf into an
instrument family (roadmap #4). One catch: graph devices are bypassed in the Node renderer, so the canonical render of
an amped guitar is the dry DI.

**The batch-1 four, as measured mid-build.**
- **Baby Grand** measures like a piano (the §2.1 table): stretched partials, bass centroid 289–496 Hz, a 21 dB velocity
  swing, T60 from 15 s at E1 down to 1.5 s at E6, and the centroid falling through every note. Its CPU rose from
  13.1% to 21.3% between two measurements twenty minutes apart, as features went in. It needs the culling in §3 before it
  ships.
- **Rotor Cabinet** has a steady tone, a 465 ms release at C2 and a centroid that follows the register. Velocity moves
  the level 3 dB, on purpose: harder means more click, not louder, as on the real thing. At equal velocity it is 8 dB
  quieter at C5 than at C2. That is partly the real organ's taper, but it is worth a look. The two cabinet mics, summed
  to mono, dip up to 6 dB against either side at C5. That is the Doppler, real on a Leslie, and fine for a stereo mix.
  Its CPU (13.3%) is nine oscillators per key. The shared 91-wheel bank measured 1.45% for 16 keys (§2.3).
- **Music Stands** attacks in 195–725 ms (faster when harder, slower in the bass) and gets brighter with velocity
  (c0 ×1.3). Held notes swing 6–9 dB in level about once a second (G4: −20, −26, −17, −26 dB in 250 ms windows),
  probably the three players' detune beating. A real section sounds steadier. A working target: under 3 dB of swing
  in 250 ms windows at default ENSEMBLE.
- **Flatwound** has a correct pickup comb (partials 5–7 notched around −40 dB at E1), a 50–165 ms mute on key-up,
  and T60 from 13.7 s at E1 to 4.1 s at E3. But velocity changes **level only**: the E1 centroid is 78 / 78 / 77 Hz
  at velocity 0.3 / 0.6 / 1.0. A harder pluck should be brighter. Also check the E1 decay against a flatwound
  recording: flats are known for short sustain, and 13.7 s may be long.

**Platform limits that every instrument inherits.**
- A kernel sees note-on, note-off and all-off, nothing else. There is no pitch bend, mod wheel, aftertouch or sustain
  CC: `input/midi.js` makes the sustain pedal by holding notes longer. That is fine for decaying instruments, but it
  means a piano kernel cannot know the pedal is down (no sympathetic resonance, no half-pedal), and pedalled arpeggios
  use up voices.
- There are no presets. A kernel def has `demo.params` for the library page, and nothing a newcomer can pick from a
  list ("Gospel B3", "Wurli", "Ballad Rhodes").
- Musical typing and tap produce narrow velocity ranges, so velocity colour matters most for MIDI players and for
  parts the agents write. The agents write velocity on every note.

---

## 2. The research, family by family

Each family gives the method, sources, and the **signatures**: numbers we can measure in a render and hold an
instrument to. "Target" values are what a test should assert. Where a value is a working estimate rather than a
published measurement, it says so.

### 2.1 Acoustic piano

**Method.** The proven sample-free approaches are the modal (additive) model, which runs each string partial as a
decaying sinusoid or 2-pole resonator ([Bank et al. 2010]), and the digital waveguide with dispersion allpasses and a
nonlinear hammer ([Bank 2000 thesis]; [Smith PASP], "Piano synthesis"). Pianoteq shows the modal family is good enough
to sell. For us, modal wins: it is per-partial deterministic, it is trivially stable, inharmonicity is exact (no
dispersion-filter design), and the decay can be set per partial. The ingredients, in the order they matter to the ear:

1. **Enough partials.** Down to a ceiling of about 8–10 kHz or 60–90 partials, whichever comes first. Bass notes get
   their identity from partials 3–15; the fundamental of A0–E1 is barely radiated.
2. **Inharmonicity** `f_k = k·f0·√(1 + B·k²)` ([Fletcher 1964]). B dips to about 1e-4 around MIDI 35–55, then rises
   to about 3e-4 at C4, 1e-3 at C6 and 1e-2 around C8. The wound bass sits at about 2–3e-4 ([Cheng et al. 2015], fig.
   2b). Stretch tuning on a big grand runs from about −22 cents at A0 to +46 at C8 ([Modartt forum, Steinway D
   measurements], a user measurement).
3. **Decay by register and by partial frequency.** Partial decay rates fall with frequency. Under about 1 kHz they are
   −3 to −10 dB/s (T60 6–20 s); around 2.6 kHz −20 to −40 dB/s; above 4 kHz −60 to −100 dB/s. Dynamics do not
   noticeably change the decay rates ([Cheng et al. 2015], figs. 8–9).
4. **Two-stage decay and beats.** Two or three strings per note, a fraction of a cent apart. The prompt sound falls
   about 8 dB/s, then the aftersound falls at under a quarter of that rate ([Weinreich]).
5. **Hammer.** Contact time shortens with velocity, so more high partials ring. The partial at the strike point
   (about 1/8 of the string) is notched. The felt thump and the soundboard knock come with the strike.
6. **Soundboard and body.** Weak low fundamentals, a few early lid reflections, a small room. A full soundboard model
   (FDN with shaping filters, [Bank 2000]) is later polish.

**Signatures and targets** (single notes, velocity 0.6 unless noted):

| measure | target | today's GRAND | Baby Grand (WIP) |
|---|---|---|---|
| B at E1 / E3 / E4 / E6 | 2–4e-4 / 1–2e-4 / 3–4e-4 / 2–4e-3 | 6.8e-5 / 1.1e-4 / 1.3e-4 / 2.7e-4 | 3.3e-4 / 2.2e-4 / 3.4e-4 / (partial tracker lost it) |
| tuning of E1, cents | −5 to −20 (stretch) | −1.7 | −10.5 |
| centroid at onset, E1 | ≥ 250 Hz (wood and overtones, not sub) | 56 | 365 |
| level swing, vel 0.3 → 1.0 | 18–30 dB | 8 dB | 21 dB |
| centroid ratio, vel 1.0 / 0.3, C4–E4 | ≥ 1.4 | 1.5 | 1.5 |
| T60 at E2 / E4 / E6 | 10–25 s / 5–12 s / 2–6 s | 25 / 14 / 7.7 | 12 / 4.4 / 1.6 |
| centroid falls over the note (c1s < c0) | yes, at every register | barely | yes |
| release to −40 dB after key-up, mid | 0.2–0.6 s; more in the bass; none above ~G6 | 0.3 s | 0.6 s |

Baby Grand is right, or near, everywhere. Two things to check: the top octave's T60 may be about 2× short, and its CPU
(21.3% at 16 voices, still rising as it is built) is the highest of any instrument (see the [CPU notes](#3-the-roadmap)).

### 2.2 Electric pianos: tine (Rhodes-type) and reed (Wurlitzer-type)

**Method.**
- **Tine piano:** a struck cantilever tine (near-sinusoid: a fundamental, plus a weak inharmonic tine partial around
  7× that dies within about 100 ms, the "ping"), then a **static pickup nonlinearity**. The pickup sees the tine tip
  move through a non-uniform field: `y = g(x + offset)`, with g a soft, asymmetric curve. The offset ("voicing") sets
  the ratio of even to odd harmonics, and velocity drives the tine further into the curve, which is the bark
  ([Rhodes piano]; [Pfeifle 2017]; background in [Shear 2011]).
- **Suitcase:** stereo tremolo at 3–6 Hz, a small preamp drive and a speaker roll-off around 5–6 kHz.
- **Reed piano:** a struck steel reed with an electrostatic pickup. Its asymmetric nonlinearity gives the nasal,
  odd-rich bark that grows sharply with velocity, and the Wurli's tremolo is amplitude-only and mono.
- **FM alternative:** the DX7 E.PIANO 1 (algorithm 5: three carrier/modulator pairs, the 1:14 pair making the tine
  tinkle; [Chowning 1973]; [Yamaha, Discovering digital FM]). Lamp Tines already follows this, and it is the "80s
  ballad" voice. It is worth a switch position, not the core.

**Signatures and targets:**
- c0 / f0 at C4: velocity 0.3 ≈ 1.3–1.8; velocity 1.0 ≥ 3. The bark is the harmonic content in the first 50–150 ms.
- Second-harmonic level against the fundamental moves with VOICING from −30 dB (centred, round) to −6 dB (offset,
  barky).
- Two-stage decay. The prompt stage loses about 10–15 dB in the first second at C4 (working estimate). Total T60 at C4
  of about 6–12 s is a working estimate: check it against recordings before asserting it.
- Tremolo modulation depth in dB at the set rate. Measure it by envelope FFT: a peak at RATE ± 0.1 Hz.

**CPU:** about 4 partials plus a waveshaper per voice. Under 2% at 16 voices.

### 2.3 Tonewheel organ and rotary speaker

**Method.** A tonewheel organ is the cheapest high-value instrument in this list because the oscillators are
**shared**:
- **Wheels:** 91 sine-ish tonewheels run all the time. A key just connects nine of them, the drawbar footages 16', 5⅓',
  8', 4', 2⅔', 2', 1⅗', 1⅓' and 1' (harmonics 1/2, 3/2, 1, 2, 3, 4, 5, 6, 8, with the top octave folding back).
  Measured: shared wheels plus 16 keys × 9 drawbars is **1.45%** of a core.
- **Percussion:** the 2nd or 3rd harmonic, single-triggered (only when no other key is held), decaying in about
  1.0 s (fast) or 4.0 s (slow).
- **Key click:** contact bounce, a noise burst of about 0.6–3 ms. Also wheel crosstalk and leakage at about −40 dB.
- **Scanner vibrato/chorus:** about 7 Hz, at three depths.

The defaults above are from [setBfree]'s configuration (an open-source B3 emulation).

**Rotary speaker (Leslie):** a horn and a drum, each a Doppler delay modulation plus amplitude modulation through a
directional filter ([Smith, Serafin, Abel, Berners 2002]).

| | slow | fast | spin-up | spin-down |
|---|---|---|---|---|
| horn | 40 rpm (0.67 Hz) | 423 rpm (7.06 Hz) | 0.16 s | 0.32 s |
| drum | 36 rpm (0.6 Hz) | 357 rpm (5.96 Hz) | 4.1 s | 1.4 s |

The spin-up is where the magic is: the horn arrives seconds before the drum ([setBfree]; the 147 measurements quoted
by [Yamaha, Rotary speaker effect]). Add an overdrive before the speaker.

**Signatures and targets:**
- Harmonic levels match the registration within ±1 dB. For example, 888000000 gives three equal partials at 0.5, 1.5
  and 1 × f0.
- The steady tone does not decay.
- Percussion: the 2nd/3rd harmonic is +6 to +10 dB at onset and falls to −60 dB in 1.0 s (fast) or 4.0 s (slow).
  It is absent on legato notes.
- Click: a broadband burst of 1–5 ms at onset, above 2 kHz.
- Rotary: the envelope modulation spectrum peaks at about 0.67 / 0.6 Hz (slow) and 7.06 / 5.96 Hz (fast). After a
  slow → fast switch the horn reaches 90% of its speed in under 0.5 s and the drum takes more than 3 s.

### 2.4 Strings: section, solo and pizzicato

**Method.**
- **Bowed waveguide:** the expressive solo model ([Smith PASP], "bowed strings": a nonlinear bow-string friction
  junction between two delay lines). It is hard to make sound good across the range without a skilled player
  controlling bow speed and pressure, so it is the wrong first build for a studio whose notes come from taps and typing.
- **Section (the recommended build):** several players per note. Each player is a band-limited saw, or a saw/pulse
  blend, with its own
  - vibrato at 4.5–6.5 Hz and ±10–30 cents per player (soloists use about 5.5–6.6 Hz at 20–35 cents; a section spreads
    them, [Vibrato]),
  - slow pitch drift of a few cents, and
  - onset scoop.

  Then the shared **violin-family body**: a fixed resonance bank. The working values are A0 air near 280 Hz, the main
  wood resonances near 450–550 Hz, and a bridge hill around 2–3 kHz with a dip near 1.5 kHz. These are working values;
  tune them by measuring centroid against recordings. Add bow noise at the onset (band-passed and envelope-shaped) and
  velocity mapped to bow pressure (brightness) and attack time.
- **Pizzicato:** the DI Box string engine with a short decay and a body, as a switch position.

**Signatures and targets:**
- Attack 10–90% in 80–400 ms at velocity 0.3 and 30–120 ms at velocity 1.0.
- The pitch-track modulation spectrum has a peak at 4.5–6.5 Hz, with vibrato extent 10–30 cents (measurable by
  autocorrelation pitch tracking).
- Centroid rises with velocity (≥ 1.3×).
- The steady state has no decay while held.
- Stereo correlation 0.3–0.7 for a section, above 0.9 for a solo.

**CPU:** with 4 players × 1 saw per note plus a shared body, under 2% at 16 voices.

### 2.5 Plucked strings and guitars ("DI Box")

**Method.**
- **String:** extended Karplus-Strong ([Jaffe & Smith 1983]): pick-position comb, a dynamics low-pass, an allpass for
  fractional tuning. Then
  - a **loss filter designed per pitch** for frequency-dependent decay ([Bank & Välimäki 2003]), which fixes Pinch
    Roller's dull high strings, and
  - 2–4 dispersion allpasses for steel and wound strings ([Karjalainen, Välimäki & Tolonen 1998]).
- **Electric:** a magnetic pickup at a position (a second comb) with a mild nonlinearity. The solid body adds almost no
  resonance, and decay depends on neck coupling more than on the pickup ([Paté, Le Carrou & Fabre 2014]).
- **Acoustic:** commuted synthesis: the body's impulse response is folded into the excitation ([Smith PASP],
  "commuted synthesis").
- **Playing:** palm mute (shorter loop gain plus a low-pass) and strum (the notes of a chord offset by 5–25 ms,
  alternate direction).
- **Bass guitar:** the same engine. Finger, pick or slap is excitation shape and pickup position.

Then route it into the Guitar Studio's amps (browser) or a built-in kernel amp (so the Node render isn't dry).

**Signatures and targets:**
- Tuning within ±2 cents at every pitch.
- The partials still reach the 10th above −40 dB at E5 at velocity 0.6 (Pinch Roller: −58 dB at the 6th).
- T60 falls with pitch but by under 2.5× per two octaves. That is a working estimate; set it from recordings.
- Pick-position notch: with PICK at 1/n, partial n sits ≥ 15 dB under its neighbours.
- Palm mute: T60 under 0.3 s.

**CPU:** a waveguide string is the cheapest voice we have. 16 strings with dispersion measured **1.0%**.

### 2.6 Mallets

**Method.** Modal bars, 3–5 modes each, excited by a mallet whose contact time is a fraction of the bar's period
(harder mallet = shorter = brighter) ([Rings/Elements]: open source, MIT licence for the STM32 code). The tuned bar
ratios ([CCRMA percussion notes]):
- **marimba and vibes:** 1 : 4 : ≈10 (the first overtone tuned two octaves up);
- **xylophone:** 1 : 3 : ≈6;
- **glockenspiel and celesta:** the free bar's 1 : 2.76 : 5.40 : 8.93.

Add a resonator tube that reinforces the fundamental (marimba, vibes) and the vibes motor (amplitude tremolo at 2–8 Hz,
deep on the fundamental). Upper modes decay faster (×0.3 and ×0.1 of T60).

**Signatures and targets:**
- The partial ratios measured within ±1%.
- Peak level within ±4 dB across the range at equal velocity (Biscuit Tin: 20 dB).
- Centroid ratio at velocity 1.0 / 0.3 ≥ 1.5.
- c300 < c0 (upper modes die first).
- Vibes motor peak in the envelope spectrum at the set rate.

**CPU:** 0.6% at 16 voices.

### 2.7 Brass and saxophone

**Method.** The defining property of brass, found by analysis-by-synthesis, is that **brightness tracks loudness**:
the spectrum widens roughly in proportion to intensity, and in the attack the low harmonics arrive first ([Risset &
Mathews 1969]). FM brass uses an index that follows the amplitude envelope ([Chowning 1973]). We recommend the
subtractive equivalent because it stays alias-free and has fewer knobs:
- a band-limited saw (trumpet, trombone) or pulse (sax) source;
- a low-pass whose cutoff follows the amplitude envelope (cutoff ∝ envelope^k);
- an onset pitch scoop of −20 to −60 cents over 30–80 ms and a breath-noise burst;
- an ensemble of 2–3 detuned players for a section, and a growl (sub-audio AM) for sax.

**Signatures and targets:**
- Centroid correlates with the RMS envelope over the note (Pearson r ≥ 0.8).
- Attack 10–90% in 20–80 ms.
- The onset pitch starts flat and settles within 100 ms.
- Centroid ratio at velocity 1.0 / 0.3 ≥ 1.8.

**CPU:** under 1.5% at 16 voices.

### 2.8 Choirs and vocal pads

**Method.** Formant synthesis: a glottal-ish source (saw or band-limited pulse plus aspiration noise) through 4–5
resonances per vowel. The values differ by voice type: soprano "a" is 800 / 1150 / 2900 / 3900 / 4950 Hz at 0 / −6 /
−32 / −20 / −50 dB; bass "a" is 600 / 1040 / 2250 / 2450 / 2750 Hz at 0 / −7 / −9 / −9 / −20 dB ([Csound formant
table]). Pick the table by register: bass below about C3, tenor below about G3, alto below about C5, soprano above.
Morph between vowels by interpolating formant frequencies. Add per-singer jitter (±3 cents drift, ±4% formant spread),
vibrato arriving after 300–700 ms, and an optional consonant onset ("d", "m": 20–60 ms noise or nasal burst).

**Signatures and targets:**
- Spectral-envelope peaks (peak-picking on a 40 ms window, or LPC order 12) within ±10% of the table's F1 and F2 for
  the selected vowel and register.
- Vibrato as in strings.
- No timbre change with velocity beyond ±10% centroid (choirs swell, they don't bark).

### 2.9 Drum machines and acoustic kits

**Machines.** Circuit-informed models of the 808 bass drum, cymbal and cowbell ([Werner, Abel & Smith 2014], three
papers) are the reference.
- **808 kick:** a bridged-T resonator pinged by a pulse, with a slight upward then downward pitch transient, and a
  "tone" low-pass.
- **909 kick:** a VCO sweep, a waveshaped triangle-to-sine, and a separate click.
- **909 snare:** two triangle oscillators about 1.6× apart plus filtered noise with its own envelope, mixed by SNAPPY.
- **909 clap:** 3–4 noise bursts about 10 ms apart, then a reverb tail.
- **Hats:** six detuned square oscillators (the 808 cymbal: 205–800 Hz), through two band-passes, with separate
  decays. The 909's were samples, so ours are an honest synthesis "in the manner of".

**Acoustic kit.** Velocity must move the beater and stick click as well as level: a hard kick's click band (2–5 kHz)
rises 6–12 dB against the body. Add seeded round-robin variation per hit (±1.5% pitch, ±1 dB, a different noise seed),
which core.drums already has. Use modal hats with noise, rather than 808 squares, for FIELD.

**Signatures and targets:**
- Kick: fundamental 45–60 Hz after 50 ms. The 909 has a click above 3 kHz within the first 5 ms; the 808 has no click
  energy above −30 dB relative.
- FIELD kick centroid at velocity 1.0 / 0.4 ≥ 1.5 (today 1.02).
- Tom centroid ratio ≥ 1.3 (today 1.0).
- Clap: three or more envelope peaks in the first 40 ms.
- Closed hat to −40 dB in 150–250 ms; the open hat is choked by the closed hat within 15 ms.

### 2.10 Basses

- **Sub (808) bass:** Sub Basement covers it.
- **Synth bass:** Capstan covers it. Add a velocity → filter-envelope amount so typed lines breathe.
- **Reese:** two or three saws detuned 5–20 cents with slowly drifting relative phase, through a low-pass, plus
  optional mid-band phasing. Signature: the beating rate in the 100–400 Hz band equals the detune in Hz, ±10%.
- **Plucked and upright bass:** the DI Box engine (finger excitation, neck pickup), or for the upright, a waveguide
  with a long-decay body and a "thump" (low-passed excitation). Upright T60 at E1 is about 1.5–3 s (working estimate).

### 2.11 Analogue polysynths

**Method.**
- **Oscillators:** polyBLEP (have it). Add the supersaw: 7 saws on Szabo's non-linear detune curve, with the
  centre/side mix compensated ([Szabo 2010]). Measured: 16 voices × 7 saws through an SVF is 1.1% of a core.
- **Filter:** the 4-pole ladder with per-stage saturation and resonance compensation. Use a zero-delay-feedback form
  ([Zavalishin 2018]) or Huovilainen's 2× oversampled model ([Huovilainen 2004]).
- **Velocity:** velocity → cutoff by default. Add poly-mod (filter env → osc 2 pitch) for brass and sync sounds.

**Signatures and targets:**
- Resonance self-oscillates at the cutoff ±5% when maxed.
- Passband loss at high resonance is ≤ 6 dB (compensated).
- Alias floor: render C7 sawtooths at every detune and check that energy between harmonics is ≤ −60 dB relative to
  the fundamental.
- Centroid ratio at velocity 1.0 / 0.3 ≥ 1.3 at defaults (today 1.06).

---

## 3. The roadmap

Rules for every new instrument, from [CLAUDE.md](../../CLAUDE.md) and the day run:
- **New ids, never rebuilt old ones.** Ids are forever, and golden hashes never move by accident. A better electric
  piano is a new device; Lamp Tines stays as it is. Appending an option to an existing switch (core.drums `kit`) keeps
  every old song's sound, because the default doesn't change.
- **Eight params or fewer, with musical names.** Presets carry the rest.
- **Names are studio objects** ([BRAND.md](../BRAND.md)). The names for batch 2 are suggestions; builders can change
  display names, not ids.
- **CPU budget:** ≤ 6% of a core at 16 held voices in Node (most built-ins are under 6%; the waveguides are under 4%).
  A piano may use ≤ 10%. A busy song is 8–12 tracks, and a phone is 2–4× slower than this machine.

### How to make the batch-1 four fit the budget

The same techniques apply to anything additive:
1. **Cull** partials and players that have fallen 80 dB under the note's peak. A decaying piano voice is mostly
   quiet partials after its first second.
2. **Cap** partials at min(N, ceiling / f0) with a ceiling of about 9 kHz for the piano and 7 kHz for strings.
3. **Control rate:** update envelopes, decays and vibrato every 8–16 samples, as Patch Bay and Room Tone do, and
   interpolate.
4. **Share:**
   - an organ's wheels are a shared bank, not per-key oscillators (1.45% for 16 keys, §2.3);
   - a string section's body and hall are one per instrument, not one per note;
   - the piano's unison twins only for partials 1–8.
5. **Measure at full polyphony** in the check (§5.3), not only on the phrase.

### 1. Acoustic grand: `core.piano` Baby Grand (batch 1, built)

- **Method:** §2.1. Additive partials as phasors, B by register, stretch, 1–3 strings with unison detune, hammer
  contact by velocity, strike-point notch, per-partial decay, dampers (none at the top), lid early reflections and a
  room.
- **Params (8):** TONE, TOUCH, DECAY, DAMPER, HAMMER, UNISON, WIDTH, ROOM.
- **Presets:** Concert (defaults), Felt (TONE 0.15, HAMMER 0.7, ROOM 0.4), Upright honky-tonk (UNISON 0.8, TONE 0.65,
  ROOM 0.1), Ballad (TONE 0.35, DECAY 1.4, ROOM 0.5), House stab (TONE 0.8, DECAY 0.6, DAMPER 0.06).
- **CPU:** measured at 21.3% at 16 held low notes. Target ≤ 10%, using culling, the cap, control-rate amplitudes and
  twins only on low partials.
- **Tests:** the §2.1 table. No stuck voices with poly 16 and sustain-extended arpeggios; the steal fade (already
  in `check.js`).
- **Risks:** CPU on phones. A top octave that may be about 2× short (T60 1.5 s at E6 against 2–6 s). The B tracker
  needs a search window widened by the expected B above about C5 (the audit's tracker loses E5 and E6).

### 2. Electric pianos: `core.ep` "Suitcase" (batch 2)

- **Method:** §2.2.
  - **TINE:** a modal tine (fundamental, plus an inharmonic ping at about 7× with a decay under 0.1 s), a tone-bar
    beat, and a pickup curve `g(x) = tanh(a(x+o)) − tanh(a·o)` with velocity-scaled excursion, run at 2×.
  - **REED:** a reed partial set (1, 2, 3, 4 with fast-decaying highs) through an asymmetric electrostatic curve.
  - **FM:** Lamp Tines' algorithm, as the 80s ballad voice.

  Then a preamp drive, a speaker roll-off, and a stereo (TINE) or mono (REED) tremolo.
- **Params (8):** VOICE (TINE / REED / FM), VOICING (round ↔ barky), BRIGHT, DECAY, DRIVE, TREM, RATE, RELEASE.
- **Presets:** Stage (TINE, VOICING 0.4, TREM 0), Suitcase (TINE, TREM 0.5, RATE 4.5), Wurli (REED, DRIVE 0.5, TREM
  0.3, RATE 5.5), Dusty loop (TINE, BRIGHT 0.3, VOICING 0.2: Dust Jacket's sound), Ballad FM (FM).
- **CPU:** under 2% (about 4 partials and a waveshaper per voice).
- **Tests:** §2.2. c0/f0 at C4 by velocity (≥ 3 at velocity 1.0), 2nd-harmonic level rising monotonically with
  VOICING, the tremolo peak at RATE, register balance within ±4 dB.
- **Risks:** "barky" without aliasing: the curve makes harmonics, so oversample it. Without recordings, the decay
  targets are estimates.

### 3. Tonewheel organ: `core.organ` Rotor Cabinet (batch 1, built)

- **As built:** §2.3, nearly to the letter.
  - REGISTER: five drawbar settings (FLUTE, BALLAD, JAZZ, GOSPEL, FULL).
  - PERC: OFF, 2ND or 3RD, single-trigger.
  - Also CLICK, DRIVE, ROTOR (SLOW / FAST / BRAKE, ramped), CABINET and TONE.
- **Follow-ups:**
  - CPU 13.3% → a shared wheel bank. It is also more authentic: on the real organ, every key taps the same 91 wheels,
    so two keys sharing a footage are phase-locked.
  - Consider three more registrations within the 8-param limit: ROCK 886000000, BLUES 888800000, and a percussive
    JIMMY 800000888. A PERC FAST / SLOW choice (1.0 s / 4.0 s, setBfree's defaults) could ride on PERC as opts
    2ND, 2ND SLOW, 3RD, 3RD SLOW.
  - Keep the 8 dB C2 → C5 drop only if a recording backs it.
- **Presets:** Gospel, Rock (DRIVE 0.6, ROTOR FAST), Jazz (PERC 3RD), Ballad, Reggae bubble (PERC 2ND, DRIVE 0).
- **Tests:** §2.3. Registration harmonics ±1 dB on a straight-out (CABINET 0) render; percussion present on a
  detached note and absent on a legato one; the click band above 2 kHz in the first 5 ms; rotor rates from the
  envelope spectrum; and the spin-up asymmetry (the horn at 90% in under 1 s, the drum taking more than 3 s).

### 4. Guitar from the keys: `core.guitar` "DI Box" (batch 2)

- **Method:** §2.5, built on **Flatwound's string** (one waveguide engine for both, so fixes land twice).
  - Add the per-pitch loss filter (which also fixes Pinch Roller's dull top, if Pinch Roller ever gets a v2) and 2–4
    dispersion allpasses for wound strings.
  - Chords that start within 30 ms are strummed, each note offset by STRUM ms, alternating down and up per chord.
  - With MUTE on, notes under velocity 0.35 are palm-muted.
- **Params (7):** BODY (ELECTRIC / NYLON / STEEL), PICK (bridge ↔ neck), PICKUP (bridge ↔ neck), TONE, DECAY, STRUM
  (0–40 ms), MUTE (off / by velocity / always).
- **Presets:** Clean single-coil (into `amp.jangle`), Crunch rhythm (into a drive rig), Nylon, Dreadnought, Funk
  muted.
- **CPU:** about 1% at 16 strings.
- **Tests:** §2.5. Tuning ±2 cents; partials reaching the 10th above −40 dB at E5; the pick notch; palm-mute
  T60 < 0.3 s; strum offsets equal to STRUM within one sample.
- **Risks:**
  - The Node canonical render can't run the graph amps, so an amped guitar's canonical render is the DI. Either give
    DI Box a small kernel amp (switchable), or state it in the song notes. A kernel amp is the better answer and
    benefits Halation too.
  - Strumming needs onsets offset inside the kernel. That is fine, because the voice knows its own start.

### 5. String section: `core.strings` Music Stands (batch 1, built)

- **As built:** §2.4. Three players per note with their own vibrato (4.6–6.2 Hz, arriving after the note settles),
  drift and bow; brightness follows the bow's level (the Risset rule, borrowed rightly from brass); a body with the
  280 Hz / 500 Hz / 2.8 kHz shape; orchestral seating; a hall. Params: ATTACK, RELEASE, BRIGHT, VIBRATO, ENSEMBLE,
  WIDTH, HALL.
- **Follow-ups:**
  - CPU 14.3% → one body and one hall per instrument (not per voice, if they are per voice), control-rate vibrato,
    and culling of released players.
  - Tame the 6–9 dB level swing on held notes. The beating of three detuned saws is periodic; give each player a
    slowly wandering detune and the swing will smear.
  - An ARTICULATION switch (LEGATO / STACCATO / PIZZ) is the eighth param worth having. PIZZ is the DI Box string with
    a short decay and a body.
- **Presets:** Warm section, Swell (ATTACK 1.5), Solo-ish (ENSEMBLE 0), Stabs (ATTACK 0.01, RELEASE 0.1, BRIGHT 0.8).
- **Tests:** §2.4. The attack range; the vibrato peak at 4.5–6.5 Hz from the pitch track; correlation 0.3–0.7;
  centroid ratio ≥ 1.3; the level-swing target.

### 6. Electric bass: `core.bassguitar` Flatwound (batch 1, built)

- **As built:** §2.5 and §2.10. A waveguide string with cubic-interpolated delay and one-zero loss, a pluck that
  starts a few cents sharp, FINGER, PICK and MUTED styles, a pickup comb, a valve DI. Params: STYLE, TONE, PICKUP,
  SUSTAIN, MUTE, DRIVE.
- **Follow-ups:**
  - Velocity colour. Shorten the excitation low-pass and raise the pluck's amplitude with velocity. Target: c0 ratio
    ≥ 1.25 at velocity 1.0 / 0.3 for FINGER and ≥ 1.4 for PICK.
  - Check the E1 T60 (13.7 s) against flatwound recordings.
  - It is cheap (3.6%) and correct otherwise.
- **Presets:** Motown (FINGER, TONE 0.3, PICKUP 0.2), Punk pick (PICK, DRIVE 0.5), Muted 60s (MUTED), Funk (PICK,
  PICKUP 0.8).

### 7. Drum machines and kit colour: new `core.drums` kit options (batch 2)

- **Method:** §2.9. Append NINE-OH-NINE and EIGHT-OH-EIGHT (true circuit-informed voices) to `kit`; MACHINE stays as
  it is. Add an ACOUSTIC+ option where velocity moves the kick and tom click and the hats are modal.
- **Params:** unchanged (7). New voices read TUNE, DECAY and TONE in their own way: 909 kick TONE = click level, 808
  kick DECAY = the bridged-T resonance.
- **Presets:** Four on the floor (909), Trap (808, DECAY 1.8), Boom bap (DUST), Live room (ACOUSTIC+, ROOM 0.6).
- **CPU:** per hit and short-lived; under 1.5% for dense patterns.
- **Tests:** §2.9. Kick fundamental, click presence and absence, clap peaks, hat choke, velocity colour ratios.
- **Risks:** a six-option switch on a phone face; check it fits.

### 8. Mallets: `core.mallets` "Mallet Bag" (batch 2), and the Biscuit Tin fix

- **Method:** §2.6. Modal bars (4 modes) with tuned ratio tables, a mallet whose contact time is a fraction of the
  bar's period, a resonator tube, the vibes motor, and register-normalised level.
- **Params (6):** BAR (MARIMBA / VIBES / XYLO / GLOCK / CELESTA), MALLET, DECAY, DAMP, MOTOR, WIDTH.
- **Biscuit Tin:** Dust Jacket and Lido use it, so fixing it in place would move their sound and their `demos-test`
  levels. Either ship the fix as `claude.biscuit-tin-2` and move the demos over on purpose, or leave Biscuit Tin as the
  "lo-fi kalimba" and point newcomers at Mallet Bag.
- **CPU:** 0.6%.
- **Tests:** §2.6. Ratios ±1%, register balance ±4 dB, centroid with velocity, c300 < c0.

### 9–12. Later

- **Brass and sax** (`core.brass`, §2.7): HORN, BITE, SCOOP, BREATH, PLAYERS, ATTACK, RELEASE. The family where
  synthesis sounds most synthetic: aim for a convincing section in a mix.
- **Patch Bay v2** (`core.poly2`, §2.11): ladder FILTER option, supersaw WAVE, velocity → cutoff.
- **Choir v2** (§2.8): register-correct formant tables, per-singer jitter, consonant onsets.
- **Woodwinds, upright and reese** (§2.10).

## 4. Testing without ears: `tools/timbre-test.js`

Nobody building this can listen, so each instrument gets a **signature**: a few lines in its def (or a test table)
that state its targets. A new suite renders single notes through the canonical renderer and asserts them. The audit
script beside this file is the prototype.

| check | how | applies to |
|---|---|---|
| register balance | peak at equal velocity across the playable range, max − min ≤ 6 dB | everything melodic |
| velocity level | level swing at vel 0.3 → 1.0 inside the instrument's band (piano 18–30 dB, pads 4–10 dB) | everything |
| velocity colour | centroid(c0) ratio at vel 1.0 / 0.3 ≥ target (struck 1.4, brass 1.8, pads ≈ 1) | everything |
| decay | T60 per register inside its band (fitted −6 to −36 dB while held) | struck, plucked |
| spectral fall | c300 < c0 and c1s ≤ c300 | struck, plucked |
| inharmonicity | B fitted from tracked partials (search window widened by the expected B) inside ±50% of the target curve | piano, guitar, mallets (ratios) |
| tuning | f1 within ±2 cents (or the stretch curve) | everything pitched |
| release | time to −40 dB after key-up inside its band | everything |
| modulation | the envelope-spectrum or pitch-track peak at the set rate ±0.1 Hz | trem, vibrato, Leslie, vibes |
| formants | spectral-envelope peaks within ±10% of the vowel's F1 and F2 | choirs |
| aliasing | at C7 and C8 at max brightness, energy between expected partials ≤ −60 dB | oscillators, waveshapers |
| CPU | 16 held voices ≤ budget | everything |

`check.js` already covers level, peaks, NaN, stuck notes, determinism and extremes. This adds **character**, and it
would have caught the Biscuit Tin null and the GRAND's sine bass on day one.

## 5. Platform asks that make every instrument better

1. **Presets.** `def.presets = [{ name, params }]` is a new field, so older readers skip it. The face shows a preset
   menu, `set_params` takes `preset: 'Gospel'`, and the library page plays each one. This is the single biggest
   newcomer win: people pick a sound by name, not by knob.
2. **Expression into kernels.** The transport `t` gains `bend` (semitones), `mod` (0..1) and `sustain` (bool), posted
   like the transport. A piano can then hold dampers up (sympathetic ring, no voice spent per held key), an organ can
   switch the rotor from the mod wheel, and strings can vibrato on mod. Older kernels ignore the fields.
3. **Voice budget per device.** Allow `poly` up to 64 (already allowed). Have the check report CPU at full polyphony,
   not 4 s of the phrase.
4. **`dsp` additions** for agent-written instruments: `tonewheels()`, `rotary()`, `formants(table)`,
   `waveguide({ dispersion, loss })` with the per-pitch loss design, and `mallet(contact)`. Each is lifted from the
   built-ins once they settle, so agents reach the same quality.

---

## Folded in: the parallel build

Between 07:52 and 08:10, four instrument files appeared in `app/src/devices/builtin/`, none of them in `index.js` yet:
- `piano.js`: `core.piano`, Baby Grand;
- `organ.js`: `core.organ`, Rotor Cabinet;
- `strings.js`: `core.strings`, Music Stands;
- `bassguitar.js`: `core.bassguitar`, Flatwound.

They are batch 1. `instrument-audit.mjs` imports them directly and has a case for each, and the results are in §1
(the batch-1 notes) and in the roadmap entries 1, 3, 5 and 6. They were measured mid-build, so rerun the audit when
the builder says they're done.

In one line each:
- **Baby Grand:** a piano by every measure; fix the CPU (21%).
- **Rotor Cabinet:** right in kind; move to a shared wheel bank (13% → about 2%).
- **Music Stands:** right in kind; tame the level swing and the CPU (14%).
- **Flatwound:** right and cheap; add velocity colour.

## Sources

- [Bank 2000 thesis]: B. Bank, *Physics-Based Sound Synthesis of the Piano*, MSc thesis, BME / Helsinki UT.
  https://home.mit.bme.hu/~bank/thesis/thesabs.html
- [Bank et al. 2010]: B. Bank, S. Zambon, F. Fontana, "A Modal-Based Real-Time Piano Synthesizer", IEEE TASLP 18(4),
  2010. Sound examples and paper: https://home.mit.bme.hu/~bank/publist/taslp-piano/index.html
- [Bank & Välimäki 2003]: B. Bank, V. Välimäki, "Robust loss filter design for digital waveguide synthesis of string
  tones", IEEE Signal Processing Letters 10(1), 2003. (cited via
  https://ccrma.stanford.edu/realsimple/phys_mod_overview/Bibliography.html)
- [Cheng et al. 2015]: T. Cheng, S. Dixon, M. Mauch, "Modelling the decay of piano sounds", ICASSP 2015.
  https://webspace.eecs.qmul.ac.uk/s.e.dixon/pub/2015/ChengDixonMauch-ICASSP2015-Decay.pdf
- [Fletcher 1964]: H. Fletcher, "Normal vibration frequencies of a stiff piano string", JASA 36, 1964 (formula as
  summarised in https://concept.lib.ed.ac.uk/esjs/article/view/9815)
- [Modartt forum, Steinway D measurements]: stretch of the Steinway D, about −22 to +46 cents (user measurement).
  https://forum.modartt.com/viewtopic.php?id=12942
- [Weinreich]: G. Weinreich, "The coupled motions of piano strings", KTH lecture notes (prompt sound and aftersound).
  https://www.speech.kth.se/music/5_lectures/weinreic/motion.html
- [Smith PASP]: J. O. Smith III, *Physical Audio Signal Processing* (online book: Karplus-Strong, commuted synthesis,
  piano, bowed strings). https://www.dsprelated.com/freebooks/pasp/Karplus_Strong_Algorithms.html
- [Jaffe & Smith 1983]: D. Jaffe, J. O. Smith, "Extensions of the Karplus-Strong plucked-string algorithm", Computer
  Music Journal 7(2), 1983. https://en.wikipedia.org/wiki/Karplus%E2%80%93Strong_string_synthesis
- [Karjalainen, Välimäki & Tolonen 1998]: "Plucked-string models: from the Karplus-Strong algorithm to digital
  waveguides and beyond", Computer Music Journal 22(3), 1998. (cited via the CCRMA bibliography above)
- [Paté, Le Carrou & Fabre 2014]: "Predicting the decay time of solid body electric guitar tones", JASA 135(5), 2014.
  https://www.lam.jussieu.fr/Membres/LeCarrou/Articles/A8_Pate_PredictingDecayTime.pdf
- [Rhodes piano]: the pickup and voicing. https://en.wikipedia.org/wiki/Rhodes_piano
- [Shear 2011]: G. Shear, *The Electromagnetically Sustained Rhodes Piano*, MS thesis, UCSB Media Arts & Technology, 2011.
  https://www.mat.ucsb.edu/Masters/GregShearMasters2011_12_5.pdf
- [Pfeifle 2017]: F. Pfeifle, "Real-time physical model of a Wurlitzer and Rhodes electronic piano", DAFx-17.
  https://dafx.de/paper-archive/details/W0D0fMDJBUxiacAi_398wg
- [Chowning 1973]: J. Chowning, "The synthesis of complex audio spectra by means of frequency modulation", JAES 21(7),
  1973. https://web.eecs.umich.edu/~fessler/course/100/misc/chowning-73-tso.pdf
- [Yamaha, Discovering digital FM]: on the DX7 and E.PIANO 1 (algorithm 5).
  https://hub.yamaha.com/discovering-digital-fm-john-chowning-remembers/ and the DX7 analysis at
  https://www.muzines.co.uk/articles/understanding-the-dx7/7900
- [setBfree]: an open-source tonewheel organ and Leslie emulation; defaults in `cfg/default.cfg` (percussion 1.0 / 4.0
  s, click, scanner 7 Hz, horn 40.32 / 423.36 rpm with 0.161 / 0.321 s, drum 36 / 357.3 rpm with 4.127 / 1.371 s).
  https://github.com/pantherb/setBfree
- [Smith, Serafin, Abel, Berners 2002]: "Doppler simulation and the Leslie", DAFx-02.
  https://ccrma.stanford.edu/~jos/doppler/dafx02.pdf
- [Yamaha, Rotary speaker effect]: Leslie 147 speeds. https://yamahasynth.com/learn/2010s/rotary-speaker-effect-xf/
- [Risset & Mathews 1969]: J.-C. Risset, M. Mathews, "Analysis of musical-instrument tones", Physics Today 22(2), 1969.
  https://aip.brightspotcdn.com/PTO.v22.i2.23_1.online.pdf
- [Vibrato]: rates and extents for string players and singers. https://en.wikipedia.org/wiki/Vibrato
- [Csound formant table]: Csound manual, fof2 example and the Formant Values appendix.
  https://csound.com/manual/opcodes/fof2/
- [CCRMA percussion notes]: bar overtone ratios (marimba 1:4, xylophone 1:3, free bar 1 : 2.76 : 5.40 : 8.93).
  https://ccrma.stanford.edu/courses/150-spring-2003/percussion.html
- [Rings/Elements]: Mutable Instruments' modal and string resonators, open source (STM32 code MIT).
  https://pichenettes.github.io/mutable-instruments-documentation/ and https://github.com/pichenettes/eurorack
- [Werner, Abel & Smith 2014]: "A physically-informed, circuit-bendable, digital model of the Roland TR-808 bass drum
  circuit", DAFx-14 (https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf); "The
  TR-808 cymbal" (ICMC-SMC 2014, https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1453.pdf); "More cowbell" (AES
  137, https://ccrma.stanford.edu/papers/more-cowbell-physically-informed-circuit-bendable-digital-model-of-tr-808-cowbell)
- [Szabo 2010]: A. Szabo, *How to Emulate the Super Saw*, KTH, 2010.
  https://www.nada.kth.se/utbildning/grukth/exjobb/rapportlistor/2010/rapporter10/szabo_adam_10131.pdf
- [Huovilainen 2004]: A. Huovilainen, "Non-linear digital implementation of the Moog ladder filter", DAFx-04.
- [Zavalishin 2018]: V. Zavalishin, *The Art of VA Filter Design*, rev. 2.1, Native Instruments, 2018.
