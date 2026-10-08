// @ts-check
// The device clock: where bar lines fall in audio time, for devices that lock to the song (synced delays, LFOs,
// gates, loopers). The shape the ported pedals expect (clawd-o-matic's PLUG.clock), as functions:
//
//   clock.playing()            is the song playing on this context
//   clock.bpm()                the tempo
//   clock.beatsPerBar()        quarter-note beats per bar (4 in 4/4, 3 in 6/8)
//   clock.barTime(b)           audio time of (fractional) bar b on the grid
//   clock.barAt(t?)            the (fractional) bar at audio time t (default now)
//   clock.bar()                barAt(now)
//   clock.next(t?)             the first bar line after t: { bar, time, len (that bar in seconds) }
//   clock.phaseAt(t, bars=1)   where t is in a cycle of `bars` bars, 0..1
//   clock.beatAt(t?) / beat()  the song position in beats (loop wraps included) at t (extra, for kernel hosts)
//
// The grid is continuous while the song plays (it does not jump at a loop wrap, so an LFO stays in phase across a
// loop that is a whole number of bars). Stopped, it is a free grid from audio time 0 at the project tempo. Offline it
// is a grid from time 0 at the project tempo, starting at the render's first beat, and playing() is true.
//
// src: { now(), playing(), bpm(), beatsPerBar(), gridAt(t) -> grid beat, timeAtGrid(g) -> audio time, songBeatAt(t) }

export function createClock(src) {
  const bpb = () => {
    const n = +src.beatsPerBar();
    return n > 0 ? n : 4;
  };
  const clock = {
    playing: () => !!src.playing(),
    bpm: () => src.bpm(),
    beatsPerBar: bpb,
    barTime: (b) => src.timeAtGrid(b * bpb()),
    barAt: (t) => src.gridAt(t == null ? src.now() : t) / bpb(),
    bar: () => clock.barAt(src.now()),
    next: (t) => {
      const b = Math.floor(clock.barAt(t == null ? src.now() : t) + 1e-9) + 1;
      const time = clock.barTime(b);
      return { bar: b, time, len: clock.barTime(b + 1) - time };
    },
    phaseAt: (t, bars = 1) => {
      const x = clock.barAt(t) / (bars || 1);
      return x - Math.floor(x);
    },
    beatAt: (t) => src.songBeatAt(t == null ? src.now() : t),
    beat: () => src.songBeatAt(src.now()),
  };
  return clock;
}

// A fixed grid: offline renders (from beat `from`, at `bpm`), and the stopped transport (from time 0).
export function gridClock(c, { bpm, beatsPerBar = 4, from = 0, playing = true }) {
  const spb = 60 / bpm;
  return createClock({
    now: () => c.currentTime,
    playing: () => playing,
    bpm: () => bpm,
    beatsPerBar: () => beatsPerBar,
    gridAt: (t) => from + t / spb,
    timeAtGrid: (g) => (g - from) * spb,
    songBeatAt: (t) => from + t / spb,
  });
}
