// vendored verbatim from clawd-o-matic/web/amps.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ================================================================ Claw'd-o-Matic: the plug-in amps */
// Concatenated in the app's scope before pedals.js and plugin.js. Each amp is a voicing of one Web Audio circuit
// (plugAmp): hp -> tight/bright/push -> stage 1 -> inter-stage filters -> stage 2 -> tone stack (bass, mid, treble) ->
// power stage -> presence -> cab -> level. Settings: { amp, gain, bass, mid, treble, presence, level } (knobs 0-10;
// a missing presence is 5: it's a high shelf at the amp's pres Hz after the power stage, ±1.6 dB a step, flat at 5).
// Levels are measured with tools/plug-level.js: every amp at its default knobs comes out
// about -14 LUFS with the tool's DI strum.
//
// Per amp (dB unless noted):
//   name, blurb, style: for the UI (style is a hint for its look: american, british, boutique, modern, tiny, solid, weird)
//   hp: Hz, the input high-pass. tight: [Hz, dB] a low shelf before the drive (keeps palm mutes from farting out).
//   bright: a 2.2 kHz shelf before the drive (a bright cap). push: [Hz, dB] a mid boost before the drive.
//   d1: [dB at gain 0, dB per Gain step] into stage 1. s1, s2: the stages' curves [hardness k, bias, knee] (knee 0 is
//   tanh, else an algebraic clip that gets harder as it rises; bias gives even harmonics, like a tube).
//   lp1, hp1: Hz, between the stages. d2: into stage 2 (at -12 or below it's run near-linear and made up after).
//   eq: [[bass Hz, dB at noon], [mid Hz, Q, dB at noon], [treble Hz, dB at noon], dB per knob step]: the tone stack.
//   pw: into the power stage (soft; made up after, so it only rounds off peaks: sag and squash). pres: presence Hz.
//   cab: [hp Hz, [low Hz, Q, dB], [cut Hz, Q, dB], [bite Hz, Q, dB], [lp Hz, Q], lp2 Hz]: the speaker and box.
//   trim: makeup so every amp comes out about as loud.
//   nod: what it tips its hat to (for the UI: "in the spirit of ..."; no names). tone: the wall's filter (clean,
//   crunch, high, weird, bass).
// Optional, for amps that need more than the circuit above (the classic eight use none of them, and their path is
// untouched: these sit on a side route after stage 2 that's silent unless an amp asks for it):
//   s1/s2's 4th value: crossover (a dead zone around zero, like a starved class-B output: the broken radio).
//   crush: bits, a quantiser after stage 2 (no oversampling, on purpose: the grit is the point).
//   wow: [ms, Hz], a wobbling delay after stage 2: tape wow (the delay adds ms*1.5 of latency to that amp only).
//   sub: [dB, lp Hz, lp Q], an octave down (PLUG_WORKLETS' divider) into stage 2 (Abyss; built only for an amp with one).
const PLUG_AMPS = {
  clean: {
    name: 'Sea Glass', blurb: 'Big glassy clean with headroom for days', style: 'american', nod: 'a 1960s blackface American 2x12 combo with reverb', tone: 'clean',
    hp: 60, tight: [200, 0], bright: 1, push: [800, 0], d1: [-26, 1.8], s1: [2.5, 0.03, 0], lp1: 9000, hp1: 60, d2: -30, s2: [2.5, 0.02, 0],
    eq: [[100, 2.5], [500, 0.7, -4], [2600, 1.5], 2.4], pw: -2, pres: 4000,
    cab: [70, [110, 1, 2], [480, 0.9, -1.5], [2600, 1.1, 2], [5500, 0.7], 8500], trim: 4.9,
  },
  jangle: {
    name: 'Coral Chime', blurb: 'Chimey top-boost sparkle; dig in and it growls', style: 'british', nod: 'a 1960s British top-boost 2x12, the chime of the Invasion', tone: 'clean',
    hp: 80, tight: [200, -1], bright: 4, push: [1200, 1], d1: [-18, 1.8], s1: [3, 0.18, 0], lp1: 8000, hp1: 90, d2: -12, s2: [3, 0.12, 0],
    eq: [[120, -1], [900, 0.8, -1.5], [3200, 2], 2.4], pw: 2, pres: 4200,
    cab: [90, [130, 1, 1], [520, 1, -2], [2900, 1.2, 4], [6000, 0.9], 7500], trim: -3.7,
  },
  crunch: {
    name: 'Crab Shack', blurb: 'Edge-of-breakup crunch for rock rhythm', style: 'american', nod: 'a late-50s tweed 1x12 combo, turned all the way up', tone: 'crunch',
    hp: 70, tight: [220, 0], bright: 1, push: [1000, 3], d1: [-10, 1.8], s1: [3, 0.07, 0], lp1: 7000, hp1: 100, d2: -12, s2: [3, 0.05, 0],
    eq: [[110, 0], [800, 0.8, 1], [2600, 0], 2.4], pw: 3, pres: 3800,
    cab: [80, [110, 1, 1.5], [400, 1, -2], [2000, 1.1, 2], [5500, 0.9], 8000], trim: -9.7,
  },
  plexi: {
    name: 'Shell Shock', blurb: "Cranked British roar, fat mids, '77 punk", style: 'british', nod: 'a late-60s British 100-watt plexi on a 4x12', tone: 'crunch',
    hp: 70, tight: [220, -1], bright: 2, push: [650, 4], d1: [-6, 1.8], s1: [3, 0.1, 0], lp1: 6500, hp1: 100, d2: -8, s2: [3, 0.06, 0],
    eq: [[100, 0], [700, 0.6, 4], [2800, 0], 2.4], pw: 8, pres: 3600,
    cab: [75, [100, 1.2, 3], [400, 1, -2], [2200, 1.1, 3.5], [5000, 1], 7000], trim: -10.6,
  },
  punk: {
    name: 'Pinch Punk', blurb: 'Tight pop-punk rhythm: the go-to', style: 'modern', nod: 'a 1980s British master-volume head, tightened for pop punk', tone: 'high',
    hp: 70, tight: [220, -7], bright: 0, push: [800, 4], d1: [-4, 2.4], s1: [3, 0.08, 0], lp1: 6500, hp1: 110, d2: -4, s2: [3, 0.04, 0],
    eq: [[110, 0], [700, 0.8, 0], [2800, 0], 2.4], pw: -10, pres: 3800,
    cab: [80, [120, 1.1, 3], [420, 1, -2.5], [2300, 1.2, 3], [5200, 0.9], 7200], trim: -20.4,
  },
  lead: {
    name: 'Siren Song', blurb: 'Singing, saturated lead with endless sustain', style: 'boutique', nod: 'a hot-rodded boutique lead head with a purple glow', tone: 'high',
    hp: 80, tight: [220, -5], bright: 0, push: [900, 7], d1: [0, 2.4], s1: [3, 0.1, 0], lp1: 5000, hp1: 120, d2: 0, s2: [3, 0.05, 0],
    eq: [[110, 0], [1000, 0.7, 2], [2800, -1], 2.4], pw: -6, pres: 3500,
    cab: [80, [110, 1.1, 2], [420, 1, -2], [1600, 1, 2.5], [4800, 0.9], 6500], trim: -22.1,
  },
  recto: {
    name: 'Kraken', blurb: 'Huge, scooped, super-tight modern high gain', style: 'modern', nod: 'a 1990s Californian high-gain stack, three channels deep', tone: 'high',
    hp: 100, tight: [300, -10], bright: 0, push: [1200, 3], d1: [4, 2.6], s1: [4, 0.06, 0], lp1: 5500, hp1: 120, d2: 2, s2: [4, 0.03, 0],
    eq: [[120, 7], [600, 0.6, -7], [3000, 1], 2.4], pw: -8, pres: 4000,
    cab: [90, [115, 1.3, 6], [400, 1, -3], [2500, 1.2, 3], [5000, 1.1], 6000], trim: -24.8,
  },
  tiny: {
    name: 'Hermit', blurb: 'Fizzy little 1x8 practice box, charmingly trashy', style: 'tiny', nod: 'a battery practice amp from the back of a catalogue', tone: 'weird',
    hp: 120, tight: [250, -3], bright: 2, push: [1000, 3], d1: [-6, 2.2], s1: [5, 0.25, 4], lp1: 7000, hp1: 150, d2: -6, s2: [5, 0.2, 4],
    eq: [[150, 0], [1000, 0.8, 2], [2500, 0], 2.4], pw: 8, pres: 3000,
    cab: [180, [400, 1.2, 2], [700, 1, 0], [1100, 1.2, 5], [3800, 1.4], 4500], trim: -5.5,
  },
  // ---- round two: the rest of the classic backline, and a few odd ones
  jc: {
    name: 'Jellyfish', blurb: 'Flat, glassy solid-state clean; no sag, all sparkle', style: 'solid', nod: 'a 1980s Japanese solid-state 2x12 with a built-in stereo chorus', tone: 'clean',
    hp: 50, tight: [200, 0], bright: 3, push: [800, 0], d1: [-30, 1.6], s1: [1.5, 0, 6], lp1: 14000, hp1: 40, d2: -30, s2: [1.5, 0, 6],
    eq: [[90, 1], [600, 0.6, -2], [3500, 3], 2.4], pw: -24, pres: 5000,
    cab: [60, [120, 0.9, 1], [500, 1, -1], [3200, 1, 2.5], [8000, 0.7], 12000], trim: 11.1,
  },
  hiwatt: {
    name: 'Lighthouse', blurb: 'Huge, loud British clean with firm mids and headroom', style: 'british', nod: 'a 1970s hand-wired British 100-watt with endless clean headroom', tone: 'clean',
    hp: 60, tight: [200, 0], bright: 1, push: [700, 2], d1: [-22, 1.8], s1: [2.5, 0.05, 0], lp1: 8000, hp1: 70, d2: -16, s2: [2.5, 0.03, 0],
    eq: [[100, 1], [900, 0.8, 2.5], [2800, 1], 2.4], pw: 4, pres: 3500,
    cab: [70, [100, 1.1, 2.5], [450, 1, -1], [2200, 1, 2.5], [5500, 0.8], 8000], trim: 0.8,
  },
  bassman: {
    name: 'Driftwood', blurb: 'Fat tweed 4x10 on the edge; sags and blooms', style: 'american', nod: 'a 1959 tweed 4x10 bass amp that guitarists stole', tone: 'crunch',
    hp: 55, tight: [180, 1], bright: 2, push: [650, 1], d1: [-14, 1.8], s1: [2.5, 0.14, 0], lp1: 7500, hp1: 60, d2: -10, s2: [2.5, 0.12, 0],
    eq: [[90, 2], [600, 0.7, -1], [2400, 1], 2.4], pw: 10, pres: 3200,
    cab: [65, [100, 1, 2.5], [500, 1, -1], [1800, 1, 3], [5000, 0.8], 7500], trim: 0.4,
  },
  dumble: {
    name: 'Pearl Diver', blurb: 'Smooth, vocal overdrive that sings; Texas blues', style: 'boutique', nod: 'a hand-built Californian overdrive amp (the holy grail)', tone: 'crunch',
    hp: 70, tight: [220, -2], bright: 2, push: [700, 5], d1: [-6, 2], s1: [2.2, 0.15, 0], lp1: 5500, hp1: 90, d2: -6, s2: [2.2, 0.1, 0],
    eq: [[100, 1], [750, 0.7, 3], [2600, -1], 2.4], pw: 6, pres: 3200,
    cab: [75, [110, 1, 2], [400, 1, -1.5], [1800, 1, 2], [5000, 0.8], 7000], trim: -9.2,
  },
  brown: {
    name: 'Brown Tide', blurb: 'Cranked, loose, singing hot-rod plexi: eruption', style: 'british', nod: 'a late-70s plexi on a variac: the brown sound', tone: 'high',
    hp: 70, tight: [200, 0], bright: 4, push: [900, 5], d1: [-2, 2], s1: [3, 0.12, 0], lp1: 6000, hp1: 100, d2: -2, s2: [3, 0.08, 0],
    eq: [[110, 0], [800, 0.7, 2], [3000, 1], 2.4], pw: 4, pres: 4000,
    cab: [80, [110, 1.1, 2], [400, 1, -2], [2600, 1, 3.5], [6000, 1], 8500], trim: -17.1,
  },
  slo: {
    name: 'Barracuda', blurb: 'Smooth, fat, mid-forward high gain that sustains', style: 'boutique', nod: 'a 1980s hand-built high-gain lead head', tone: 'high',
    hp: 90, tight: [250, -6], bright: 1, push: [1000, 5], d1: [4, 2.4], s1: [3.5, 0.08, 0], lp1: 6500, hp1: 120, d2: 2, s2: [3.5, 0.05, 0],
    eq: [[110, 0], [800, 0.7, 2], [2800, 1], 2.4], pw: -6, pres: 4200,
    cab: [85, [115, 1.2, 3], [420, 1, -2], [2400, 1.1, 3.5], [5500, 1], 7000], trim: -24.9,
  },
  friedman: {
    name: 'Rogue Wave', blurb: 'Modern British high gain: tight, hairy, huge mids', style: 'british', nod: 'a modern hot-rodded British 100-watt, a plexi with all the mods', tone: 'high',
    hp: 80, tight: [240, -5], bright: 2, push: [750, 6], d1: [2, 2.3], s1: [3.2, 0.1, 0], lp1: 5000, hp1: 110, d2: 0, s2: [3.2, 0.06, 0],
    eq: [[110, 1], [650, 0.7, 3], [2800, 1], 2.4], pw: 2, pres: 3800,
    cab: [80, [110, 1.2, 3], [400, 1, -2], [2300, 1.2, 3], [4800, 1], 6500], trim: -18.7,
  },
  metal: {
    name: 'Megalodon', blurb: 'Brutal, tight, aggressive modern metal', style: 'modern', nod: 'a 1990s signature high-gain head built for a guitar hero', tone: 'high',
    hp: 110, tight: [350, -10], bright: 1, push: [1400, 6], d1: [5, 2.6], s1: [4.2, 0.05, 0], lp1: 4800, hp1: 150, d2: 4, s2: [4.2, 0.03, 0],
    eq: [[120, 3], [500, 0.7, -3], [2500, 3.5], 2.4], pw: -8, pres: 4500,
    cab: [90, [110, 1.4, 4], [350, 1, -3], [2800, 1.3, 5], [6000, 1.1], 7500], trim: -27.8,
  },
  orange: {
    name: 'Clownfish', blurb: 'Thick, fuzzy British roar for stoner and doom', style: 'british', nod: 'a loud orange British head: all fuzz and low mids', tone: 'high',
    hp: 55, tight: [200, 2], bright: 0, push: [500, 5], d1: [2, 2.2], s1: [2.5, 0.2, 0], lp1: 4000, hp1: 70, d2: 0, s2: [2.8, 0.15, 0],
    eq: [[100, 3], [500, 0.7, 4], [2500, -2], 2.4], pw: 6, pres: 3000,
    cab: [70, [100, 1.2, 4], [250, 1, 1], [1800, 1, 2], [4000, 0.9], 5500], trim: -13.1,
  },
  radio: {
    name: 'Flotsam', blurb: 'A broken transistor radio washed up on the beach', style: 'weird', nod: 'a 1960s pocket transistor radio with a torn speaker', tone: 'weird',
    hp: 150, tight: [500, 0], bright: 0, push: [1500, 6], d1: [-8, 2], s1: [2, 0, 0, 0.025], lp1: 5000, hp1: 150, d2: -4, s2: [6, 0.1, 3],
    eq: [[300, 0], [1500, 1, 4], [3000, -3], 2.4], pw: 8, pres: 2500,
    cab: [150, [600, 1.5, 3], [1000, 1, 0], [2000, 2, 6], [3200, 1.8], 3800], trim: -13.4,
  },
  bit: {
    name: '8-Bit Crab', blurb: 'Square-wave fuzz, bitcrushed like a game console', style: 'weird', nod: 'a handheld game console, its speaker turned up to 11', tone: 'weird',
    hp: 250, tight: [200, 0], bright: 0, push: [1000, 2], d1: [6, 2], s1: [8, 0, 8], lp1: 9000, hp1: 80, d2: -30, s2: [1, 0, 0], crush: 4,
    eq: [[110, 0], [800, 0.8, 0], [3000, 0], 2.4], pw: -20, pres: 4000,
    cab: [250, [400, 1, 0], [600, 1, 0], [3000, 1, 3], [9000, 0.7], 12000], trim: -26.3,
  },
  tape: {
    name: 'Beach Tape', blurb: 'A four-track cassette in the red: warm and warbly', style: 'weird', nod: 'a 1980s four-track cassette recorder pushed into the red', tone: 'weird',
    hp: 40, tight: [120, 3], bright: -2, push: [800, 0], d1: [-8, 1.5], s1: [1.8, 0.02, 0], lp1: 9000, hp1: 30, d2: -6, s2: [1.8, 0.02, 0], wow: [0.6, 0.7],
    eq: [[90, 3], [800, 0.7, 0], [3000, -2], 2.4], pw: 6, pres: 3000,
    cab: [45, [90, 0.9, 3], [500, 1, 0], [2500, 1, 0], [7000, 0.7], 9000], trim: -2.6,
  },
  // ---- round three: from the deep
  abyss: {
    name: 'Abyss', blurb: 'An octave down, fuzzed and filtered: synth-bass guitar', style: 'weird', nod: 'an analog octave pedal into a fuzz and a 1x15 bass cab', tone: 'weird',
    hp: 50, tight: [150, 2], bright: 0, push: [600, 2], d1: [-8, 2], s1: [3, 0.1, 0], lp1: 3000, hp1: 40, d2: -4, s2: [4, 0.05, 0], sub: [6, 700, 6],
    eq: [[90, 4], [700, 0.7, -2], [2500, -2], 2.4], pw: 4, pres: 2500,
    cab: [40, [80, 1, 4], [400, 1, -2], [1500, 1, 1], [3500, 0.9], 5000], trim: -11.1,
  },
  // ---- for keys and synths (web/presets/90-keys.js): not an amp at all, a clean line in. Both stages run far below
  // where they bend (GAIN is a clean input trim), the tone stack is a gentle desk EQ that's flat at noon, and the "cab"
  // is wide open (40 Hz to 20 kHz), so a keyboard comes out as it went in, level-matched to the amps. (The cab's
  // high-pass stays at 40, and stage 2 at −12 (its makeup at −30 would be 24x): either way, changing amps live from one
  // that leaves something behind in the stages (Abyss's octave) comes in with a burst. Both measured: tools/plug-level.js.)
  di: {
    name: 'Straight In', blurb: 'No amp, no cab: a clean line in for keys and synths', style: 'solid', nod: 'a studio DI box into a mixing desk channel', tone: 'clean',
    hp: 20, tight: [200, 0], bright: 0, push: [800, 0], d1: [-24, 0.6], s1: [1, 0, 0], lp1: 20000, hp1: 20, d2: -12, s2: [1, 0, 0],
    eq: [[120, 0], [900, 0.7, 0], [4000, 0], 1.6], pw: -24, pres: 5000,
    cab: [40, [100, 1, 0], [500, 1, 0], [3000, 1, 0], [20000, 0.7], 20000], trim: 20.2,
  },
  // ---- for a bass on the input (tone 'bass'; web/presets/95-bass.js; INSTRUMENT: Bass). Voiced with a bass DI (E1 is
  // 41 Hz: tools/plug-meter.js bassLine) where the guitar amps were voiced with a guitar's: the input high-pass and the
  // coupling between the stages sit at 28-40 Hz, the cab's at 32-50 (the 8x10 is the punchy one), so the low E comes
  // through whole (60-70% of each one's energy is under 100 Hz, as the DI's is; a guitar amp keeps 2-20%); the tone
  // stack's BASS works around 60-80 Hz, the mids around 400-800 (where a bass cuts through a band), and the cabs roll off
  // by 4-5 kHz (a bass speaker's top end is its growl, not fizz), except the hi-fi one's tweeter. Levels, lows (<100 Hz
  // share) and voices: tools/plug-level.js BASS=1. Each is its own thing:
  //   Blue Whale: the growl. Two tube stages biased for even harmonics, a mid push into them, a sagging power stage, eight
  //     10s. Walrus: warm and round; barely breaks up, the 15 in a closed box thumps. Narwhal: the modern one: blend: the
  //     clean lows kept beside a hard solid-state drive on the mids and top (the drive never touches the fundamental).
  //   Sandbar: a tweed bass amp as a bassist hears it (Driftwood is that circuit as guitarists stole it: bright, 4x10):
  //     dark, round, farting out a little as it's pushed, a 1x15 open back. Sea Urchin: a fuzz with an octave under it
  //     (Abyss's divider) and a resonant synth-y mid peak.
  // Optional here too: blend: [Hz, dB], a clean path from the input high-pass, low-passed twice at Hz, into the tone
  // stack beside the driven one (built only for an amp that has it: the rest never see it).
  whale: {
    name: 'Blue Whale', blurb: 'All-tube 300 watts into eight 10s: the growl', style: 'american', nod: 'a 1970s all-tube 300-watt bass head on an eight-10 fridge', tone: 'bass',
    hp: 35, tight: [150, -1], bright: 2, push: [550, 5], d1: [-10, 1.9], s1: [2.4, 0.14, 0], lp1: 6000, hp1: 40, d2: -8, s2: [2.6, 0.12, 0],
    eq: [[60, 0], [550, 0.7, 2], [2500, 1.5], 2.4], pw: 8, pres: 3000,
    cab: [50, [80, 1, 1], [320, 1, -1], [1600, 1.2, 3], [4500, 0.8], 6000], trim: -2.1,
  },
  walrus: {
    name: 'Walrus', blurb: 'Round, warm studio thump; barely breaks up', style: 'american', nod: 'a 1960s flip-top studio bass combo with one 15 in a closed box', tone: 'bass',
    hp: 32, tight: [150, 0], bright: 0, push: [400, 1], d1: [-22, 1.6], s1: [2, 0.06, 0], lp1: 5000, hp1: 30, d2: -20, s2: [2, 0.05, 0],
    eq: [[70, 1], [800, 0.7, 0], [2500, -1], 2.4], pw: 2, pres: 2500,
    cab: [38, [60, 1.2, 1.5], [400, 1, -0.5], [1200, 1, 1.5], [3200, 0.7], 4800], trim: 5.1,
  },
  narwhal: {
    name: 'Narwhal', blurb: 'Modern hi-fi bass: clean lows, a snarling drive on top', style: 'modern', nod: 'a modern class-D bass head with a growl blended over its clean lows', tone: 'bass',
    hp: 28, tight: [250, -14], bright: 1, push: [900, 4], d1: [-10, 2.2], s1: [3.5, 0.02, 3], lp1: 5000, hp1: 160, d2: -8, s2: [3, 0.02, 0], blend: [220, 6],
    eq: [[80, 1], [500, 0.8, -1], [3000, 1], 2.4], pw: -12, pres: 3500,
    cab: [40, [80, 1.1, 1.5], [400, 1, -1.5], [3000, 1, 2], [7000, 0.7], 10000], trim: -10.9,
  },
  sandbar: {
    name: 'Sandbar', blurb: 'Dark tweed bass on one 15: round, and it farts out', style: 'american', nod: 'a 1952 tweed 1x15 bass combo, before the guitarists found it', tone: 'bass',
    hp: 35, tight: [180, 1], bright: 0, push: [600, 4], d1: [-12, 1.8], s1: [2.5, 0.18, 0], lp1: 4000, hp1: 40, d2: -8, s2: [2.5, 0.15, 0],
    eq: [[80, 0], [600, 0.7, 1], [2200, -1], 2.4], pw: 10, pres: 2600,
    cab: [40, [75, 1, 1.5], [500, 1, -1], [1400, 1, 2], [3500, 0.8], 5000], trim: 0.9,
  },
  urchin: {
    name: 'Sea Urchin', blurb: 'Octave-down fuzz bass with a synth-y bite', style: 'weird', nod: 'a 1970s octave-down bass fuzz into a resonant synth filter', tone: 'bass',
    hp: 30, tight: [150, 0], bright: 0, push: [700, 4], d1: [2, 2.2], s1: [5, 0.05, 5], lp1: 5000, hp1: 30, d2: -4, s2: [4, 0.08, 0], sub: [9, 300, 2],
    eq: [[70, 0], [900, 3, 5], [2500, -2], 2.4], pw: 4, pres: 2200,
    cab: [35, [70, 1, 1.5], [350, 1, -2], [1400, 1, 1], [4500, 0.9], 6000], trim: -9.3,
  },
};
// The amps' AudioWorklets, loaded with the gate's (plugGate in plugin.js), so they're there whenever the gate is.
// clawd-octave: an analog octave divider (Abyss, sub: [dB, lp Hz, Q]). The guitar, low-passed so the fundamental rules
// its zero crossings, flips a flip-flop on each rising crossing (with hysteresis): a square an octave down, as loud as
// the note (an envelope follower), its edges rounded off. It goes into the amp's second stage, so it fuzzes with you.
const PLUG_WORKLETS = `class ClawdOctave extends AudioWorkletProcessor {
  constructor() { super(); this.env = 0; this.hi = false; this.flip = 1; this.y = 0; }
  process(ins, outs) {
    const o = outs[0][0], i = ins[0] && ins[0][0];
    if (!o) return true;
    if (!i) { o.fill(0); return true; }
    const att = 1 - Math.exp(-1 / (0.002 * sampleRate)), rel = 1 - Math.exp(-1 / (0.15 * sampleRate)), sm = 1 - Math.exp(-2 * Math.PI * 2500 / sampleRate);
    for (let n = 0; n < o.length; n++) {
      const x = i[n], a = Math.abs(x);
      this.env += (a - this.env) * (a > this.env ? att : rel);
      const th = 0.45 * this.env + 1e-5; // (well clear of the wiggles the harmonics leave)
      if (!this.hi && x > th) { this.hi = true; this.flip = -this.flip; }
      else if (this.hi && x < -th) this.hi = false;
      const g = this.env > 3e-4 ? this.env : (this.env * this.env) / 3e-4;
      this.y += (this.flip * g - this.y) * sm;
      o[n] = this.y;
    }
    return true;
  }
}
registerProcessor('clawd-octave', ClawdOctave);`;

/* ---- cabs and mics. Every amp's voicing above has its own cab baked in (A.cab: the speaker, the box and a 57-style
   dynamic mic on the cap edge, an inch back). That stays the default, bit for bit: an amp at its own cab with the
   default mic goes straight from A.cab to the level, as it always has. Pick another cab, or move the mic, and the
   signal goes through the mic network instead:
     A.cab's six filters (with the new cab's values) -> [per mic: its placement and type as seven filters, plus the
     room: a floor bounce, a far wall, an open back's rear wave, a stadium's slap, as delay taps beside the direct
     sound] -> blend (a second mic, maybe flipped, delayed by the difference in distance) -> trim -> the level
   The trim level-matches: it's worked out from the responses (plugCabNet below) against the amp's own cab, weighted
   like a distorted guitar heard through K-weighting, plus a measured nudge per cab (lv). tools/cab-check.js checks it.
   The mic filters are all flat at the default mic, so moving it off and back never jumps.
   Settings, on the amp's P (none of them written when they're the default):
     P.cab: a PLUG_CABS id ('own', or missing: the amp's own)
     P.mic: { type, x, y, dist, ang, s }: a PLUG_MICS id; where it points on the cone (x, y in cone radii from the
       dustcap's centre: the cap's edge is 0.3, the cone's edge 1); inches from the grille (0.5-24); degrees off axis
       (0-60); which speaker it's on (s: for the picture only; every cone in a cab sounds the same)
     P.mic2: the same for a second mic, plus blend (0-10: 0 all the first mic, 10 all this one) and flip (its phase) */
// A cab: name, blurb; n cones of size inches; back: open, closed or odd (for the rear wave and the picture); cab: the
// six filters (as an amp's); lv: a measured nudge (dB) on top of the worked-out trim; slap: [ms, gain] a far echo.
const PLUG_CABS = {
  own: { name: 'Its own', blurb: 'The cab the amp was voiced with' },
  p8: { name: '1x8 Practice', blurb: 'A little open-back 8: boxy, fizzy, no bottom', n: 1, size: 8, back: 'open',
    cab: [160, [380, 1.2, 2], [700, 1, 0], [1400, 1.2, 4], [4200, 1.4], 5200], lv: 0 },
  a12: { name: '1x12 Open American', blurb: 'Open-back 12: scooped, sparkly, airy lows', n: 1, size: 12, back: 'open',
    cab: [75, [110, 1, 1.5], [480, 0.9, -1.5], [2500, 1.1, 2.5], [5500, 0.8], 8500], lv: 0 },
  b212: { name: '2x12 Blue Alnico', blurb: 'Open-back British 2x12: chime and a glassy top', n: 2, size: 12, back: 'open',
    cab: [85, [125, 1, 1], [520, 1, -2], [3000, 1.3, 4.5], [6200, 0.9], 7800], lv: 0 },
  t210: { name: '2x10 Tweed', blurb: 'Open-back tweed 10s: quick, woody, mid-forward', n: 2, size: 10, back: 'open',
    cab: [90, [140, 1, 1], [450, 1, -1], [1900, 1.1, 3], [5200, 0.9], 7000], lv: 0 },
  b410: { name: '4x10 Tweed Bass', blurb: 'Four open-back 10s: fat, punchy, a bit loose', n: 4, size: 10, back: 'open',
    cab: [65, [100, 1, 2.5], [500, 1, -1], [1800, 1, 3], [5000, 0.8], 7500], lv: 0 },
  g412: { name: '4x12 British Vintage', blurb: 'Closed British 4x12: warm, woody mids, soft top', n: 4, size: 12, back: 'closed',
    cab: [75, [100, 1.2, 3], [400, 1, -2], [2200, 1.1, 3.5], [5000, 1], 7000], lv: 0 },
  v412: { name: '4x12 Modern', blurb: 'Oversized closed 4x12: tight thump, aggressive upper mids', n: 4, size: 12, back: 'closed',
    cab: [85, [90, 1.4, 5], [420, 1, -3], [2600, 1.3, 4], [5200, 1.1], 6800], lv: 0 },
  j15: { name: '1x15 Jazz', blurb: 'One big 15: round, dark, deep', n: 1, size: 15, back: 'open',
    cab: [55, [80, 1, 3], [600, 1, -1], [1500, 1, -1], [3800, 0.7], 6000], lv: 0 },
  fridge: { name: 'The Fridge', blurb: 'A speaker in an old fridge: boomy, clanky, cold', n: 1, size: 8, back: 'closed', odd: 'fridge',
    cab: [110, [170, 5, 7], [500, 1, -4], [1250, 7, 7], [3800, 1.5], 4500], lv: 0 },
  box: { name: 'Cardboard Box', blurb: 'A 6-inch in a moving box: honky and papery', n: 1, size: 6, back: 'odd', odd: 'box',
    cab: [220, [300, 2, 3], [800, 1.4, 5], [2000, 1, -2], [4500, 1], 5500], lv: 0 },
  phone: { name: 'Telephone', blurb: 'Down the line: all middle, nothing else', n: 1, size: 2, back: 'odd', odd: 'phone',
    cab: [320, [500, 1, 0], [1000, 1.5, 2], [2200, 2, 6], [3100, 2.5], 3600], lv: 0 },
  horn: { name: 'Stadium Horn', blurb: 'A PA horn up in the rafters, and the echo off the far stand', n: 1, size: 12, back: 'odd', odd: 'horn', slap: [110, 0.3],
    cab: [480, [900, 1.5, 3], [1600, 1, 0], [2800, 2, 5], [7500, 1], 9000], lv: 0 },
  // bass cabs: closed and ported, down to 38-50 Hz (the guitar cabs above give up by 55-90; the 10s' fridge is the
  // punchy one, not the deep one). The fridge, the 15 and the modern 2x12 are Blue Whale's, Walrus's and Narwhal's own.
  b810: { name: '8x10 Fridge', blurb: 'Eight 10s in a closed fridge of a cab: huge, punchy mids', n: 8, size: 10, back: 'closed',
    cab: [50, [80, 1, 1], [320, 1, -1], [1600, 1.2, 3], [4500, 0.8], 6000], lv: 0 },
  c410: { name: '4x10 Bass', blurb: 'Closed, ported 4x10: tight, punchy, quick', n: 4, size: 10, back: 'closed',
    cab: [45, [90, 1.1, 1.5], [380, 1, -1], [2000, 1.1, 2], [4800, 0.8], 6500], lv: 0 },
  b115: { name: '1x15 Bass', blurb: 'One 15 in a big ported box: deep, round, slow', n: 1, size: 15, back: 'closed',
    cab: [38, [60, 1.2, 1.5], [400, 1, -0.5], [1200, 1, 1.5], [3200, 0.7], 4800], lv: 0 },
  m212: { name: '2x12 Modern Bass', blurb: 'Light neo 12s and a tweeter: deep, and hi-fi on top', n: 2, size: 12, back: 'closed',
    cab: [40, [80, 1.1, 1.5], [400, 1, -1.5], [3000, 1, 2], [7000, 0.7], 10000], lv: 0 },
};
// The cab each amp was voiced with (for the picture, and where the mic's sweet spots are): [cones, size, back]
const PLUG_AMP_BOX = { clean: [2, 12, 'open'], jangle: [2, 12, 'open'], crunch: [1, 12, 'open'], plexi: [4, 12, 'closed'], punk: [2, 12, 'closed'],
  lead: [2, 12, 'closed'], recto: [4, 12, 'closed'], tiny: [1, 8, 'open'], jc: [2, 12, 'open'], hiwatt: [4, 12, 'closed'], bassman: [4, 10, 'open'],
  dumble: [2, 12, 'open'], brown: [4, 12, 'closed'], slo: [4, 12, 'closed'], friedman: [4, 12, 'closed'], metal: [4, 12, 'closed'],
  orange: [4, 12, 'closed'], radio: [1, 4, 'odd'], bit: [1, 2, 'odd'], tape: [2, 4, 'odd'], abyss: [1, 15, 'closed'], di: [1, 12, 'closed'],
  whale: [8, 10, 'closed'], walrus: [1, 15, 'closed'], narwhal: [2, 12, 'closed'], sandbar: [1, 15, 'open'], urchin: [4, 10, 'closed'] };
// A mic: name, blurb; what it does against the 57 the amps were voiced with: lo (a 200 Hz shelf), body and pres
// ([Hz, Q, dB] peaks), air (a 9 kHz shelf), hp and lp ([Hz, Q in dB]; 0 is none); prox: how much proximity effect
// (bass up close) against the 57; room: how much of the room it hears.
const PLUG_MICS = {
  dyn: { name: 'Dynamic', blurb: 'The dynamic mic on every amp on earth: mids that cut', lo: 0, body: [400, 0.9, 0], pres: [4500, 1.2, 0], air: 0, hp: 0, lp: 0, prox: 1, room: 1 },
  ribbon: { name: 'Ribbon', blurb: 'A ribbon: dark, smooth, big low end; hears the room behind it too', lo: 1.5, body: [350, 0.8, 1.5], pres: [4500, 1, -3.5], air: -3, hp: 0, lp: [8500, -3], prox: 1.5, room: 1.6 },
  cond: { name: 'Condenser', blurb: 'A large-diaphragm condenser: open and airy; hears every corner', lo: 0.5, body: [400, 0.9, -0.5], pres: [4500, 1.2, -2], air: 4, hp: [30, -3], lp: 0, prox: 0.8, room: 1.4 },
  crystal: { name: 'Crystal', blurb: 'A cheap old crystal mic: thin, honky, lo-fi', lo: -3, body: [900, 0.9, 4], pres: [2600, 2.5, 7], air: -6, hp: [300, 0], lp: [4200, 3], prox: 0.2, room: 1.2 },
  kick: { name: 'Kick', blurb: 'A big kick-drum dynamic, the bass cab’s mic: deep, scooped, punchy', lo: 2.5, body: [400, 0.8, -3], pres: [3500, 1.2, 2], air: -2, hp: [30, -3], lp: 0, prox: 1.2, room: 0.8 },
};
const PLUG_MIC_DEFAULT = { type: 'dyn', x: 0.3, y: 0, dist: 1, ang: 0, s: 0 };
const PLUG_MIC2_DEFAULT = { type: 'ribbon', x: 0.62, y: 0, dist: 1, ang: 0, s: 0, blend: 5, flip: false };
// P's cab and mics, cleaned (anything off becomes the default; a default isn't kept): { cab?, mic?, mic2? }
function plugCabClean(p) {
  const out = {}, num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
  if (p && typeof p.cab === 'string' && PLUG_CABS[p.cab] && p.cab !== 'own') out.cab = p.cab;
  const mic = (m, D, two) => {
    if (!m || typeof m !== 'object') return null;
    const r = { type: PLUG_MICS[m.type] ? m.type : D.type, x: num(m.x, -1.35, 1.35, D.x), y: num(m.y, -1.35, 1.35, D.y), dist: num(m.dist, 0.5, 24, D.dist),
      ang: num(m.ang, 0, 60, D.ang), s: Math.round(num(m.s, 0, 7, 0)) };
    if (Math.hypot(r.x, r.y) > 1.35) { const k = 1.35 / Math.hypot(r.x, r.y); r.x *= k; r.y *= k; }
    for (const k of ['x', 'y', 'dist', 'ang']) r[k] = Math.round(r[k] * 1000) / 1000;
    if (two) { r.blend = num(m.blend, 0, 10, D.blend); r.flip = !!m.flip; }
    return r;
  };
  const m1 = mic(p && p.mic, PLUG_MIC_DEFAULT), m2 = mic(p && p.mic2, PLUG_MIC2_DEFAULT, true);
  if (m1 && Object.keys(PLUG_MIC_DEFAULT).some((k) => m1[k] !== PLUG_MIC_DEFAULT[k])) out.mic = m1;
  if (m2) out.mic2 = m2;
  return out;
}
// Set P's cab fields to those of S (a cleaned set), removing what S doesn't have.
function plugCabPut(P, S) { for (const k of ['cab', 'mic', 'mic2']) { if (S && S[k] != null) P[k] = S[k]; else delete P[k]; } }
// The cab and mics as filters: for amp id with settings p at sample rate sr.
//   { custom: false } when it's the amp's own cab and the default mic (the straight wire), else { custom: true, box, cab
//   (six filter values), mics: [{ f: seven filters [type, Hz, Q, dB], taps: [[s, gain], ...], delay (s), gain }], trim (dB) }
function plugCabNet(id, p, sr) {
  const A = PLUG_AMPS[id] || PLUG_AMPS.punk, S = plugCabClean(p);
  if (!S.cab && !S.mic && !S.mic2) return { custom: false };
  const C = PLUG_CABS[S.cab], own = PLUG_AMP_BOX[id] || [1, 12, 'closed'];
  const box = C ? { n: C.n, size: C.size, back: C.back, slap: C.slap, lv: C.lv || 0 } : { n: own[0], size: own[1], back: own[2], lv: 0 };
  const cab = C ? C.cab : A.cab;
  const one = (m) => {
    const M = PLUG_MICS[m.type] || PLUG_MICS.dyn, r = Math.min(1.35, Math.hypot(m.x, m.y)), a = Math.min(60, m.ang) / 45;
    // on the cone: brightest on the dustcap, darker and fuller toward the edge (off the cone: dark and thin)
    let shelf = r < 0.3 ? (5 * (0.3 - r)) / 0.3 : -(r - 0.3) * 8, pres = r < 0.3 ? (3 * (0.3 - r)) / 0.3 : -(r - 0.3) * 3.5;
    let body = Math.max(0, Math.min(1, r) - 0.3) * 3.5, lo = r > 1 ? -(r - 1) * 6 : 0;
    // off axis: darker; far back: the speaker's beam narrows onto the axis less (a little darker), and less proximity
    shelf -= a * 3.5; pres -= a * 1.5; let air = -a * 4;
    const d = m.dist, prox = (x) => 11 / (1 + x / 1.2);
    lo += M.prox * (prox(d) - prox(1));
    if (d > 1) { shelf -= (1.2 * Math.log2(d)) / Math.log2(24); lo -= (4.5 * Math.log2(d)) / Math.log2(24); } // (far back: out of the near field)
    const fs = 2500 * Math.sqrt(12 / box.size); // (a smaller cone breaks up higher)
    const f = [['lowshelf', 200, 0, lo + M.lo], ['peaking', M.body[0], M.body[1], body + M.body[2]], ['peaking', M.pres[0], M.pres[1], pres + M.pres[2]],
      ['highshelf', fs, 0, shelf], ['highshelf', 9000, 0, air + M.air], ['highpass', M.hp ? M.hp[0] : 0, M.hp ? M.hp[1] : 0, 0], ['lowpass', M.lp ? M.lp[0] : sr / 2, M.lp ? M.lp[1] : 0, 0]];
    // the room: the floor bounce (the mic about 0.4 m up), a far wall 2.6 m off, an open back's rear wave off the wall
    // behind it (upside down), a stadium's slap; each as loud as its path is short against the direct sound's
    const D = d * 0.0254 + 0.01, taps = [], path = (x) => Math.sqrt(D * D + x * x);
    taps.push([(path(0.8) - D) / 343, (0.3 * M.room * D) / path(0.8)]);
    taps.push([(path(2.6) - D) / 343, (0.3 * M.room * D) / path(2.6)]);
    taps.push([box.back === 'open' ? 1.3 / 343 : 0, box.back === 'open' ? (-0.5 * M.room * D) / (D + 1.3) : 0]);
    taps.push(box.slap ? [box.slap[0] / 1000, box.slap[1]] : [0, 0]);
    return { f, taps, D };
  };
  const m1 = one(S.mic || PLUG_MIC_DEFAULT), mics = [m1];
  if (S.mic2) {
    const m2 = one(S.mic2), b = S.mic2.blend / 10, lag = (m2.D - m1.D) / 343; // (the farther mic hears it later)
    m1.gain = 1 - b; m2.gain = (S.mic2.flip ? -1 : 1) * b;
    m1.delay = Math.max(0, -lag); m2.delay = Math.max(0, lag);
    mics.push(m2);
  } else { m1.gain = 1; m1.delay = 0; }
  // the trim: the amp's own cab against this, weighted by what the amp puts into it (PLUG_AMP_SPEC) through K-weighting
  const W = plugCabNet.weights(id, sr), H = plugCabNet.resp;
  let e0 = 0, e1 = 0;
  for (let i = 0; i < W.f.length; i++) {
    const f = W.f[i], ho = H.cab(A.cab, f, sr), hc = H.cab(cab, f, sr);
    let re = 0, im = 0;
    for (const m of mics) {
      let [mr, mi] = H.chain(m.f, f, sr);
      // + the taps
      let tr = 1, ti = 0;
      for (const [t, g] of m.taps) if (g) { tr += g * Math.cos(-2 * Math.PI * f * t); ti += g * Math.sin(-2 * Math.PI * f * t); }
      [mr, mi] = [mr * tr - mi * ti, mr * ti + mi * tr];
      const dr = Math.cos(-2 * Math.PI * f * m.delay), di = Math.sin(-2 * Math.PI * f * m.delay);
      re += m.gain * (mr * dr - mi * di); im += m.gain * (mr * di + mi * dr);
    }
    e0 += W.w[i] * ho; e1 += W.w[i] * hc * (re * re + im * im);
  }
  const trim = Math.max(-12, Math.min(12, 10 * Math.log10(e0 / Math.max(e1, 1e-12)) + box.lv));
  return { custom: true, box, cab, mics, trim };
}
// Each amp's spectrum before its cab, at its default knobs with tools/plug-level.js's DI strum: half-octave bands from
// 40 Hz to 14.5 kHz, dB, the loudest 0 (measured: SPEC=1 node tools/cab-check.js prints this table; run it again after
// changing an amp's voicing). It's what the trims weigh a cab by: a bright amp's fizz counts, a dark one's doesn't.
const PLUG_AMP_SPEC = {
  clean: [-43.2, -34.9, -17.3, -15.5, -18.9, -16.9, -17.8, -17.6, -14.8, -11.2, -9, -7.2, -4.4, -1.7, 0, -0.7, -8.1, -26.9],
  jangle: [-56, -50.1, -24.8, -20.7, -21.7, -19, -18.4, -17.4, -15.3, -12.9, -11, -9.2, -5.9, -2.5, 0, -1, -9.9, -29.3],
  crunch: [-40.2, -41.5, -19.7, -15.3, -16.2, -13.6, -12.8, -11, -7.6, -4.2, -3.7, -4.1, -2.7, -1.1, 0, -2.7, -13, -26.3],
  plexi: [-29.7, -31.4, -21.5, -16.8, -16.5, -13.1, -10.7, -7.2, -3.4, -2.3, -3.4, -3.9, -2.3, -0.8, 0, -3.4, -10.8, -21.2],
  punk: [-37.5, -39.5, -27.5, -21.7, -19.9, -15.7, -12.4, -9.8, -5.9, -3.2, -3.4, -3.8, -2.4, -0.8, 0, -3.5, -14, -31.4],
  lead: [-30.2, -30.9, -28.7, -21.6, -18.9, -15.1, -11.8, -9.4, -4.5, 0, -0.8, -2.6, -2.4, -1.9, -3, -7.5, -15.3, -31.8],
  recto: [-23.7, -24.5, -25.4, -20.8, -21.1, -19.1, -18.5, -16.8, -14.2, -9.4, -6.4, -4.7, -2.7, -0.6, 0, -3, -10.7, -29.3],
  tiny: [-30.4, -33.4, -29.1, -25.5, -19.2, -16.1, -14.1, -12.7, -9.5, -5.2, -4.4, -4.9, -3.2, -1.3, 0, -2.1, -11.6, -34.8],
  jc: [-39.4, -36.4, -21.1, -18.8, -21.2, -18.5, -18.3, -17.5, -15.2, -12.5, -10.7, -8.9, -5.8, -2.5, 0, -0.2, -4.8, -15.5],
  hiwatt: [-46.7, -37.5, -17.9, -15.3, -17.8, -14.9, -13.8, -11.3, -7.4, -4.9, -5, -5.2, -3.7, -1.5, 0, -1.4, -10.4, -30],
  bassman: [-40.1, -35, -17.8, -15.7, -18.6, -16.2, -15.9, -14.6, -12.1, -9.8, -8.4, -6.9, -4, -1.5, 0, -1.9, -11.7, -30.4],
  dumble: [-33.5, -35, -20, -16, -16.6, -13.3, -10.8, -7.2, -2.5, -0.9, -2.2, -2.9, -1.5, 0, -0.1, -5.4, -14.8, -27.1],
  brown: [-29.2, -30.1, -22.1, -17.9, -17.5, -14.7, -13.2, -11, -7.3, -3.6, -3.9, -4.3, -2.3, -0.5, 0, -3.6, -9.2, -14.1],
  slo: [-29.3, -30.2, -28.8, -22.5, -19.7, -15.6, -12.4, -9.9, -6.1, -1.8, -1.8, -2.8, -1.8, -0.6, 0, -2.5, -9.6, -21],
  friedman: [-26.7, -27.5, -24.5, -19.7, -17.7, -13.4, -10.6, -7.5, -2.8, -0.9, -2.2, -2.6, -1.1, 0, -0.7, -4.3, -8.4, -20],
  metal: [-28, -28.6, -29.1, -25, -23.6, -19.9, -18.8, -16.2, -12.8, -7.7, -4.2, -2.8, -1.7, 0, -0.4, -3.4, -10.8, -20.1],
  orange: [-24.1, -23.3, -12, -9.6, -10.5, -7.4, -4.1, -1.1, -0.2, -0.7, -1.4, -1.3, 0, -0.1, -2.6, -6.5, -11.6, -30.8],
  radio: [-27.4, -28.3, -26.6, -19.9, -16.8, -14.3, -13.4, -12, -10, -5.1, -0.4, 0, -2.4, -3.7, -5.6, -9.9, -22.5, -46],
  bit: [-39.9, -36.4, -27.5, -21.5, -18.8, -13.9, -9.5, -8.7, -6.6, -3.9, -3.5, -3.4, -2.1, -0.9, 0, -1.3, -8.7, -24.5],
  tape: [-23.5, -24.2, -9.9, -8.3, -11.6, -9.2, -8.5, -7.2, -4.8, -2.6, -1.8, -1.7, -1.3, -0.7, 0, -1.3, -9.4, -26],
  abyss: [-6.4, -9.1, -10.5, -8.6, -11.2, -9.6, -8.7, -7.7, -5.8, -3.6, -2.5, -1.1, 0, -2, -7.2, -13.7, -23.6, -49.8],
  di: [-31.2, -33.2, -16.9, -13.8, -15.1, -11.9, -10.9, -9.4, -6.9, -4.7, -3.7, -3.2, -2.2, -1, 0, -1, -6.3, -16.3],
  // the bass amps, with the bass DI (BASS=1 SPEC=1 node tools/cab-check.js)
  whale: [0, -5, -3.4, -6.3, -7.4, -12.6, -12.9, -13.6, -15.7, -16.5, -18.6, -16.8, -15.7, -13.1, -13.1, -18.5, -30.8, -52.7],
  walrus: [0, -5, -4, -6.6, -8.2, -11.2, -13.5, -16.4, -19.9, -23, -23.9, -21.5, -20.9, -19.4, -21, -28.6, -45.4, -60],
  narwhal: [0, -4.9, -2.4, -4.2, -3.9, -9, -8.4, -8.9, -9.4, -10.9, -11.4, -9.8, -9.1, -6.9, -8.1, -15.5, -30.4, -51.9],
  sandbar: [0, -4.4, -3, -6, -7.8, -13.6, -14, -15.6, -17.3, -18.3, -20.6, -19.3, -19.1, -18.6, -22.8, -32, -46.7, -60],
  urchin: [-0.2, -3.6, 0, -3.1, -4.7, -10.8, -11.6, -13.1, -13.8, -13.2, -15.1, -15.4, -14.1, -14.6, -15.8, -19.2, -24.4, -40.7],
};
// The weighting: 480 points log-spaced from 40 Hz to 16 kHz, the amp's spectrum (per point, so per equal slice of log
// frequency) through K-weighting (a 4 dB shelf over 1.5 kHz, a cut under 60 Hz)
plugCabNet.weights = (id, sr) => {
  const K = plugCabNet._w || (plugCabNet._w = {}), sp = PLUG_AMP_SPEC[id] || PLUG_AMP_SPEC.punk, key = (PLUG_AMP_SPEC[id] ? id : 'punk') + sr;
  if (K[key]) return K[key];
  const N = 480, f = new Float64Array(N), w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const x = 40 * Math.pow(400, i / (N - 1)), b = Math.max(0, Math.min(sp.length - 1, 2 * Math.log2(x / 40))), j = Math.min(sp.length - 2, Math.floor(b));
    f[i] = x;
    const g = Math.pow(10, (sp[j] + (sp[j + 1] - sp[j]) * (b - j)) / 10), k = (1 + 1.5 / (1 + Math.pow(1500 / x, 2))) / (1 + Math.pow(60 / x, 4));
    w[i] = g * k;
  }
  return (K[key] = { f, w });
};
// Biquads' responses as the Web Audio spec has them (lowpass and highpass Q in dB; shelves with S = 1)
plugCabNet.resp = (() => {
  const one = (type, f0, Q, G, f, sr) => {
    if ((type === 'lowpass' && f0 >= sr / 2) || (type === 'highpass' && f0 <= 0) || ((type === 'peaking' || type.endsWith('shelf')) && !G)) return [1, 0];
    const w0 = (2 * Math.PI * Math.min(f0, sr / 2)) / sr, cs = Math.cos(w0), sn = Math.sin(w0), A = Math.pow(10, G / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass' || type === 'highpass') {
      const al = sn / (2 * Math.pow(10, Q / 20)), s = type === 'lowpass' ? 1 - cs : 1 + cs;
      b0 = s / 2; b1 = type === 'lowpass' ? s : -s; b2 = s / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else if (type === 'peaking') {
      const al = sn / (2 * Q);
      b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
    } else {
      const al = (sn / 2) * Math.SQRT2, q = 2 * Math.sqrt(A) * al;
      if (type === 'lowshelf') { b0 = A * (A + 1 - (A - 1) * cs + q); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - q); a0 = A + 1 + (A - 1) * cs + q; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - q; }
      else { b0 = A * (A + 1 + (A - 1) * cs + q); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - q); a0 = A + 1 - (A - 1) * cs + q; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - q; }
    }
    const w = (2 * Math.PI * f) / sr, c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = b1 * s1 + b2 * s2, dr = a0 + a1 * c1 + a2 * c2, di = a1 * s1 + a2 * s2, dd = dr * dr + di * di;
    return [(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd];
  };
  const chain = (list, f, sr) => { let r = 1, i = 0; for (const [t, f0, Q, G] of list) { const [a, b] = one(t, f0, Q, G, f, sr); [r, i] = [r * a - i * b, r * b + i * a]; } return [r, i]; };
  // a cab's six filters as plugAmp sets them: |H|²
  const cab = (cb, f, sr) => { const [r, i] = chain([['highpass', cb[0], 0.7, 0], ['peaking', cb[1][0], cb[1][1], cb[1][2]], ['peaking', cb[2][0], cb[2][1], cb[2][2]], ['peaking', cb[3][0], cb[3][1], cb[3][2]], ['lowpass', cb[4][0], cb[4][1], 0], ['lowpass', cb[5], 0.6, 0]], f, sr); return r * r + i * i; };
  return { one, chain, cab };
})();

// An amp on any context (the live one, or an offline one for measuring).
function plugAmp(c) {
  const dB = (d) => Math.pow(10, d / 20);
  const G = (v) => { const n = c.createGain(); n.gain.value = v; return n; };
  const F = (type, f, q, g) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; if (g != null) n.gain.value = g; return n; };
  const shaper = (os) => { const n = c.createWaveShaper(); n.oversample = os; return n; };
  // a stage's curve and its slope at 0: DC removed and scaled so f(±1) reaches about ±1
  const curves = {};
  const curve = ([k, b, knee, xo]) => {
    const key = k + ',' + b + ',' + knee + (xo ? ',' + xo : '');
    if (curves[key]) return curves[key];
    const sat0 = knee ? (u) => u / Math.pow(1 + Math.pow(Math.abs(u), knee), 1 / knee) : Math.tanh;
    // crossover: the input sags through a soft dead zone xo wide before it's clipped (a tenth of it still leaks
    // through, so the slope at 0 isn't 0). Without it, the arithmetic is exactly what it always was.
    const sat = xo ? (u) => sat0(u - 0.9 * xo * k * Math.tanh(u / (xo * k))) : sat0;
    const t0 = sat(k * b), norm = Math.max(sat(k * (1 + b)) - t0, t0 - sat(k * (-1 + b)));
    const N = 4096, out = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; out[i] = (sat(k * (x + b)) - t0) / norm; }
    const h = 1e-4, slope = (sat(k * (h + b)) - sat(k * (b - h))) / (2 * h) / norm;
    return (curves[key] = { out, slope });
  };
  // a quantiser's curve: 2^bits steps over ±1
  const crushes = {};
  const crushCurve = (bits) => {
    if (crushes[bits]) return crushes[bits];
    const L = Math.pow(2, bits - 1), N = 8192, out = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; out[i] = Math.max(-1, Math.min(1, Math.round(x * L) / L)); }
    return (crushes[bits] = out);
  };
  const PW = curve([1.5, 0.04, 0]);
  const input = G(1), hp = F('highpass', 70, 0.7), tight = F('lowshelf', 220, 0.7, 0), bright = F('highshelf', 2200, 0.7, 0), push = F('peaking', 800, 0.9, 0);
  const pre1 = G(1), s1 = shaper('2x'), lp1 = F('lowpass', 6500, 0.6), hp1 = F('highpass', 110, 0.6);
  const pre2 = G(1), s2 = shaper('2x'), post2 = G(1);
  const bass = F('lowshelf', 110, 0.7, 0), mid = F('peaking', 700, 0.8, 0), treble = F('highshelf', 2800, 0.7, 0);
  // the power stage: soft and fed band-limited, so no oversampling (and no more latency); its makeup keeps the level
  const pl = F('lowpass', 8000, 0.6), pre3 = G(1), s3 = shaper('none'), post3 = G(1); // (pl: what it makes stays under Nyquist)
  s3.curve = PW.out;
  const presence = F('highshelf', 3800, 0.7, 0);
  const cab = [F('highpass', 80, 0.7), F('peaking', 120, 1.1, 3), F('peaking', 420, 1, -2.5), F('peaking', 2300, 1.2, 3), F('lowpass', 5200, 0.9), F('lowpass', 7200, 0.6)];
  const level = G(1), mute = G(1), output = G(1), hush = G(1); // (mute, hush: the output and the input, for changing amps)
  const chain = [input, hush, hp, tight, bright, push, pre1, s1, lp1, hp1, pre2, s2, post2, bass, mid, treble, pl, pre3, s3, post3, presence, ...cab, level, mute, output];
  for (let i = 0; i + 1 < chain.length; i++) chain[i].connect(chain[i + 1]);
  // the side route for the odd ones (crush, wow): post2 -> quantiser -> wobbling delay -> side -> the tone stack, beside
  // the straight wire. An amp that uses it turns the wire (via) off and the side on; the rest keep side at exactly 0, so
  // what they sum into the tone stack is their own signal plus zero, bit for bit.
  const via = G(1), qz = shaper('none'), wow = c.createDelay(0.05), wowLfo = c.createOscillator(), wowDepth = G(0), side = G(0);
  post2.disconnect(bass); post2.connect(via); via.connect(bass);
  post2.connect(qz); qz.connect(wow); wow.connect(side); side.connect(bass);
  wow.delayTime.value = 0; wowLfo.connect(wowDepth); wowDepth.connect(wow.delayTime); wowLfo.start();
  // Abyss's octave (PLUG_WORKLETS): hp -> two low-passes -> the divider -> a resonant low-pass -> its level -> stage 2.
  // Made the first time an amp asks for it, when the worklet's there (an amp on a context without the gate's module:
  // no octave, the rest as ever); it's never made for the others, so their path is untouched.
  let sub = null;
  const subOn = () => {
    if (sub || !c.__clawdAmpWorklets) return sub;
    try {
      const l1 = F('lowpass', 180, -3), l2 = F('lowpass', 180, -3), f = F('lowpass', 700, 6), g = G(0);
      const w = new AudioWorkletNode(c, 'clawd-octave', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
      hp.connect(l1); l1.connect(l2); l2.connect(w); w.connect(f); f.connect(g); g.connect(s2);
      sub = { f, g, w };
    } catch (e) { sub = null; }
    return sub;
  };
  // A bass amp's clean blend (blend: [Hz, dB]): hp -> two low-passes -> its level -> the tone stack, beside stage 2's
  // way out. Made the first time an amp asks for it and at 0 for the others after, so theirs is untouched.
  let cln = null;
  const blendOn = () => {
    if (cln) return cln;
    const a = F('lowpass', 220, -3), b = F('lowpass', 220, -3), g = G(0);
    hp.connect(a); a.connect(b); b.connect(g); g.connect(bass);
    return (cln = { a, b, g });
  };
  // the cab's other way out (plugCabNet): the straight wire (the amp's own cab, the default mic: exactly as ever) or two
  // mics, each seven filters and four room taps, blended and trimmed. The wire and micOut crossfade; the unused one sits
  // at exactly 0, and the wire's 1 changes nothing.
  const wire = G(1), micOut = G(0), mics = [];
  cab[5].disconnect(level); cab[5].connect(wire); wire.connect(level); micOut.connect(level);
  for (let m = 0; m < 2; m++) {
    const align = c.createDelay(0.01), f = [F('lowshelf', 200, 0, 0), F('peaking', 400, 0.9, 0), F('peaking', 4500, 1.2, 0), F('highshelf', 2500, 0, 0), F('highshelf', 9000, 0, 0), F('highpass', 0, 0), F('lowpass', c.sampleRate / 2, 0)];
    const sum = G(1), mix = G(0), taps = [];
    align.connect(f[0]); // (fed from the cab only while it's used: feed, below)
    for (let i = 0; i + 1 < f.length; i++) f[i].connect(f[i + 1]);
    f[6].connect(sum);
    for (let i = 0; i < 4; i++) { const d = c.createDelay(0.2), g = G(0); f[6].connect(d); d.connect(g); g.connect(sum); taps.push([d, g]); }
    sum.connect(mix); mix.connect(micOut);
    mics.push({ align, f, taps, mix, fed: false });
  }
  // a mic network runs only while it's used (a live one keeps going a moment after, while its level fades)
  const feed = (M, on) => {
    clearTimeout(M.off);
    if (on && !M.fed) { cab[5].connect(M.align); M.fed = true; }
    else if (!on && M.fed) M.off = setTimeout(() => { if (M.fed && !M.want) { cab[5].disconnect(M.align); M.fed = false; } }, realtime ? 400 : 0);
    M.want = on;
  };
  // A new amp (live): duck the input and the output, and once it's quiet change the curves and jump every setting, then
  // fade back in (knob moves in the meantime just update what it will jump to). Knob moves on the same amp glide.
  let cur = null, curCab = null, last = null, pending = false;
  const realtime = typeof OfflineAudioContext === 'undefined' || !(c instanceof OfflineAudioContext);
  // at (optional): the audio time the change lands at, a little ahead (pedalRig's set: scenes.js puts it on a bar line)
  function set(p, at) {
    last = p;
    const id = PLUG_AMPS[p.amp] ? p.amp : 'punk', cb = PLUG_CABS[p.cab] ? p.cab : 'own';
    if (pending) return;
    if (cur != null && (id !== cur || cb !== curCab) && realtime) { // (a new cab ducks too: its filters jump)
      const t = Math.max(c.currentTime, at || 0);
      pending = true;
      for (const m of [mute, hush]) { m.gain.cancelScheduledValues(t); m.gain.setValueAtTime(m.gain.value, t); m.gain.linearRampToValueAtTime(0, t + 0.008); }
      // the curves jump once the duck is down by the audio clock (a starved audio thread, or a duck scheduled ahead,
      // mustn't have them jump under a live signal); back in from 30 ms after it began (or as soon as it can). A
      // scheduled one waits 40 ms, so the main thread has room to be late and it still comes back on time.
      const go = () => {
        if (c.currentTime < t + 0.012 && c.state === 'running') { setTimeout(go, 4); return; }
        pending = false; apply(last, true);
        const u = Math.max(c.currentTime, t + (at ? 0.04 : 0.03)); // (the stages' filters have drained by now: the new amp starts from silence)
        for (const m of [mute, hush]) { m.gain.cancelScheduledValues(c.currentTime); m.gain.setValueAtTime(0, u + 0.005); m.gain.linearRampToValueAtTime(1, u + 0.035); }
      };
      setTimeout(go, Math.max(30, (t - c.currentTime) * 1000 + 14));
      return;
    }
    apply(p, cur == null || id !== cur || cb !== curCab, at);
  }
  function apply(p, jump, at) {
    const id = PLUG_AMPS[p.amp] ? p.amp : 'punk', A = PLUG_AMPS[id], t = jump ? c.currentTime : Math.max(c.currentTime, at || 0);
    const to = (param, v) => {
      if (!Number.isFinite(v)) return;
      if (jump) { param.cancelScheduledValues(t); param.setValueAtTime(v, t); } else param.setTargetAtTime(v, t, 0.02);
    };
    if (id !== cur) {
      s1.curve = curve(A.s1).out; s2.curve = curve(A.s2).out; cur = id;
      qz.curve = A.crush ? crushCurve(A.crush) : null;
    }
    const odd = !!(A.crush || A.wow), w = A.wow || [0, 1];
    to(via.gain, odd ? 0 : 1); to(side.gain, odd ? 1 : 0);
    to(wow.delayTime, (w[0] * 1.5) / 1000); to(wowDepth.gain, w[0] / 1000); to(wowLfo.frequency, w[1]);
    const k = (v, d) => (Number.isFinite(+v) ? Math.max(0, Math.min(10, +v)) : d) - 5;
    const g = k(p.gain, 6) + 5, e = A.eq[3];
    to(hp.frequency, A.hp); to(tight.frequency, A.tight[0]); to(tight.gain, A.tight[1]); to(bright.gain, A.bright);
    to(push.frequency, A.push[0]); to(push.gain, A.push[1]);
    to(pre1.gain, dB(A.d1[0] + A.d1[1] * g));
    to(lp1.frequency, A.lp1); to(hp1.frequency, A.hp1);
    const pr2 = dB(A.d2);
    to(pre2.gain, pr2); to(post2.gain, A.d2 <= -12 ? 1 / (curve(A.s2).slope * pr2) : 1);
    to(bass.frequency, A.eq[0][0]); to(bass.gain, A.eq[0][1] + k(p.bass, 5) * e);
    to(mid.frequency, A.eq[1][0]); to(mid.Q, A.eq[1][1]); to(mid.gain, A.eq[1][2] + k(p.mid, 5) * e);
    to(treble.frequency, A.eq[2][0]); to(treble.gain, A.eq[2][1] + k(p.treble, 5) * e);
    to(pre3.gain, dB(A.pw)); to(post3.gain, 1 / (PW.slope * dB(A.pw)));
    if (A.sub && subOn()) { to(sub.g.gain, dB(A.sub[0])); to(sub.f.frequency, A.sub[1]); to(sub.f.Q, A.sub[2]); } else if (sub) to(sub.g.gain, 0);
    if (A.blend) { blendOn(); to(cln.g.gain, dB(A.blend[1])); to(cln.a.frequency, A.blend[0]); to(cln.b.frequency, A.blend[0]); } else if (cln) to(cln.g.gain, 0);
    to(presence.frequency, A.pres); to(presence.gain, k(p.presence, 5) * 1.6);
    const N = plugCabNet(id, p, c.sampleRate), cb = N.custom ? N.cab : A.cab;
    curCab = PLUG_CABS[p.cab] ? p.cab : 'own';
    to(wire.gain, N.custom ? 0 : 1); to(micOut.gain, N.custom ? dB(N.trim) : 0);
    mics.forEach((M, m) => feed(M, !!(N.custom && N.mics[m])));
    if (N.custom) {
      mics.forEach((M, m) => {
        const X = N.mics[m];
        to(M.mix.gain, X ? X.gain : 0);
        if (!X) return;
        to(M.align.delayTime, X.delay);
        X.f.forEach(([, hz, q, g], i) => { to(M.f[i].frequency, hz); to(M.f[i].Q, q); to(M.f[i].gain, g); });
        X.taps.forEach(([t, g], i) => { to(M.taps[i][0].delayTime, t); to(M.taps[i][1].gain, g); });
      });
    }
    to(cab[0].frequency, cb[0]);
    for (let i = 1; i <= 3; i++) { to(cab[i].frequency, cb[i][0]); to(cab[i].Q, cb[i][1]); to(cab[i].gain, cb[i][2]); }
    to(cab[4].frequency, cb[4][0]); to(cab[4].Q, cb[4][1]); to(cab[5].frequency, cb[5]);
    to(level.gain, dB(A.trim + k(p.level, 6) * 3 - 3));
  }
  // latency: what the two oversampled stages add (s), measured: 128 samples each at 2x (4x would be 192 each, and
  // measures the same through the cab: tools/plug-level.js)
  // unplugged: the octave's worklet stops being processed (pedals.js pfxEnd)
  const dispose = () => { if (sub && sub.w && typeof pfxEnd === 'function') pfxEnd(sub.w); };
  return { input, output, set, dispose, latency: 256 / c.sampleRate, net: () => plugCabNet(last && PLUG_AMPS[last.amp] ? last.amp : 'punk', last || {}, c.sampleRate) };
}
plugAmp.amps = PLUG_AMPS; // (tools/plug-level.js)
