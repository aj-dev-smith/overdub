// vendored verbatim from clawd-o-matic/web/presets/90-keys.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ---- preset bank: Keys & Synths. A keyboard, digital piano or synth on the interface (its line out into input 1, or
   a stereo one into 1 and 2 with the input rack's INSTRUMENT set to Keys): the rig works for anything at line level.
   Straight Wire (amps.js) is the clean way in; the rest are the classic keyboard rigs: a tweed with hair on it, the
   spinning organ cabinet, a suitcase piano's pan, a clavinet through an envelope filter, a pad into a shimmer, and a
   worn tape. No gates: a piano's tail is the point. Levels measured with tools/plug-level.js KEYS=1 (a piano part in
   place of the guitar): −14 LUFS ±1, true peak ≤ −1 dBFS. */
presetBank({ id: 'keys', name: 'Keys & Synths', blurb: 'For a keyboard on the interface: pianos, organs, pads', color: '#a970ff' }, [
  { id: 'ky-wire', name: 'Straight Wire', blurb: 'Your keyboard as it is, with a touch of plate', tags: ['clean'], hot: 'Keys start here',
    nod: 'a DI box into a desk channel: the sound you dialled in on the keyboard, in the room with the band', amp: 'di',
    knobs: { gain: 5, bass: 5, mid: 5, treble: 5, presence: 5, level: 6.6 },
    board: ['amp', { id: 'lobsterplate', decay: 3, tone: 6, pre: 20, mix: 1.5 }] },
  { id: 'ky-tweed', name: 'Keyboard Amp', blurb: 'Electric piano into a tweed 4x10: warm, with hair', tags: ['rhythm'],
    nod: 'a 1970s electric piano through a cranked tweed bass amp, the bark on the hard notes', amp: 'bassman',
    knobs: { gain: 5, bass: 4, mid: 5.5, treble: 5.5, presence: 5, level: 8.2 },
    board: ['amp', { id: 'lobsterplate', decay: 2.5, tone: 5, pre: 15, mix: 1.5 }] },
  { id: 'ky-leslie', name: 'Spin Cycle', blurb: 'Organ through the spinning speaker: stomp for fast', tags: ['rhythm'],
    nod: 'a tonewheel organ into its two-rotor speaker cabinet, the valve amp in it just breaking up', amp: 'di',
    knobs: { gain: 5, bass: 5, mid: 5.5, treble: 5, presence: 5, level: 5.8 },
    board: ['amp', { id: 'spinlobster', speed: 0, ramp: 5, drive: 4, bal: 5, width: 8 }] },
  { id: 'ky-grinder', name: 'Organ Grinder', blurb: 'Dirty rock organ: a cranked stack, the rotor flat out', tags: ['heavy'],
    nod: 'a late-60s hard-rock organ played through a British stack, fast rotor and all', amp: 'plexi',
    knobs: { gain: 4, bass: 5, mid: 6, treble: 5, presence: 5, level: 7.2 },
    board: ['amp', { id: 'spinlobster', speed: 1, ramp: 6, drive: 3, bal: 5, width: 8 }] },
  { id: 'ky-suitcase', name: 'Suitcase Tines', blurb: 'Electric piano, panning left to right, a little chorus', tags: ['clean'],
    nod: 'the 1970s suitcase electric piano, its stereo vibrato walking the room', amp: 'di',
    knobs: { gain: 5, bass: 5, mid: 5, treble: 5.5, presence: 5, level: 6.7 },
    board: ['amp', { id: 'sidestep', rate: 3, width: 7, shape: 0 }, { id: 'chorus', rate: 2, depth: 3, mix: 3 }, { id: 'lobsterplate', decay: 3, tone: 5, pre: 20, mix: 1.5 }] },
  { id: 'ky-wurli', name: 'Wurli Wobble', blurb: 'Reedy electric piano with the amp’s tremolo on', tags: ['clean'],
    nod: 'a reed electric piano in a school classroom, its built-in tremolo pulsing in eighths', amp: 'jangle',
    knobs: { gain: 5.5, bass: 4.5, mid: 5.5, treble: 5, presence: 5, level: 9.7 },
    board: ['amp', { id: 'jellypulse', rate: 3, depth: 5, shape: 0 }] },
  { id: 'ky-clav', name: 'Clavinet Quack', blurb: 'Funky clav through an envelope filter: dig in', tags: ['rhythm'],
    nod: 'a 1970s clavinet into an envelope filter: every hard note squelches', amp: 'di',
    knobs: { gain: 5, bass: 4, mid: 5.5, treble: 6, presence: 5.5, level: 6.1 },
    board: [{ id: 'quack', sens: 6, peak: 6, decay: 3, mode: 0, dir: 0, range: 1 }, 'amp'] },
  { id: 'ky-stage', name: 'Stage Synth', blurb: '80s poly synth on stage: wide, glassy, bright', tags: ['clean'],
    nod: 'an 80s polysynth through a rack dimension chorus into the PA', amp: 'di',
    knobs: { gain: 5, bass: 5, mid: 5, treble: 5.5, presence: 5, level: 6.5 },
    board: ['amp', { id: 'mantis', mode: 3, mix: 7 }, { id: 'lobsterplate', decay: 4, tone: 6, pre: 25, mix: 2 }] },
  { id: 'ky-pad', name: 'Synth Sea', blurb: 'Hold a chord: it blooms into a shimmering pad', tags: ['ambient'],
    nod: 'the endless shimmer pads of ambient records: a held chord climbing an octave as it rings', amp: 'di',
    knobs: { gain: 5, bass: 4.5, mid: 5, treble: 5, presence: 5, level: 5.6 },
    board: ['amp', { id: 'halojelly', decay: 7, shim: 5, tone: 5, mix: 4.5, intv: 0 }, { id: 'krakenhall', size: 7, tone: 4, pre: 40, mix: 3, space: 0 }] },
  { id: 'ky-tape', name: 'Beach Tape Keys', blurb: 'Lo-fi piano off a worn cassette: warm, warbly, dusty', tags: ['clean'],
    nod: 'bedroom lo-fi: an upright piano bounced to a tired four-track and a dusty record', amp: 'tape',
    knobs: { gain: 4, bass: 5, mid: 5, treble: 4.5, presence: 5, level: 7.7 },
    board: ['amp', { id: 'shellac', wow: 3, dust: 3, age: 4, slow: 0 }] },
]);
