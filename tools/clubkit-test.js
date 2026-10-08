// Sandbag (core.clubkit: app/src/devices/builtin/clubkit.js), the synthesized club kit, on the canonical Node renderer.
//
// Registered as the spec says (a drums instrument, the GM map with the riser and the impact under it, KIT DUBSTEP,
// RIDDIM, DNB and MELODIC, KICK NOTE C1-B1); each kit against the part targets (the spec's table, from the drum audit's
// real hits): the kick peaks within 5 ms, its crest over the first 100 ms is 10 dB or more, and its tail sits within 25
// cents of KICK NOTE after 60 ms; the snare peaks within 5 ms, its crest is 12 dB or more, what it has over 2.5 kHz
// rings 0.5 s at most (T60) and its body is at 150-300 Hz; the hats have energy from 150 Hz to 2.5 kHz no more than 30
// dB under their loudest band, their 12-20 kHz within 6 dB of their 150-600 Hz, and the two mics correlate 0.5 at most; every voice ends when it has fallen quiet (the
// last 50 ms before the sound stops are 60 dB under its peak: nothing is cut off); a closed hat chokes an open one;
// KICK NOTE moves the kick's tail and nothing else moves with it; the kit plays the drum phrase near -18 LUFS with true
// peaks at or under -1 dBTP; renders repeat bit for bit. Every number printed is the measured one.
//   node tools/clubkit-test.js
import { tally } from './pw.js';
import { renderInst, mono, hitStats, decayT60, fundamental, bandDb, centroidTrack } from './bass-metrics.js';
import { measure } from '../app/src/audio/measure.js';
import { drumPhrase, DRUM_PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { getDevice } from '../app/src/devices/registry.js';
import { KITS, NOTES } from '../app/src/devices/builtin/clubkit.js';
import '../app/src/devices/builtin/index.js';

const T = tally('clubkit');
const ok = T.ok;
const SR = 48000;
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const def = getDevice('core.clubkit');

console.log('the device');
ok(
  def && def.kind === 'instrument' && def.cat === 'drums' && def.name === 'Sandbag' && def.source === 'builtin',
  `core.clubkit is registered: ${def?.name}, a drums instrument`,
);
ok(
  ['kit', 'kick_note', 'tune', 'decay', 'click', 'clap', 'room', 'drive', 'width', 'clip', 'level'].join() ===
    def.params.map((p) => p.key).join() && def.params.every((p) => p.desc),
  'its params, in order, each with a meaning',
);
ok(
  KITS.join() === 'DUBSTEP,RIDDIM,DNB,MELODIC' &&
    def.params.find((p) => p.key === 'kick_note').opts.length === 12 &&
    def.params.find((p) => p.key === 'kick_note').def === 5,
  'KIT: DUBSTEP, RIDDIM, DNB, MELODIC; KICK NOTE C1 to B1, F1 by default',
);
ok(
  NOTES[36] === 'Kick' &&
    NOTES[38] === 'Snare' &&
    NOTES[46] === 'Open hat' &&
    NOTES[34] === 'Riser' &&
    NOTES[33] === 'Impact' &&
    def.notes === NOTES,
  'the GM map, with the riser on 34 and the impact on 33, named for get_device',
);
ok(
  def.presets.length === 4 && def.presets.every((p) => p.tags.includes('bass-music') && p.tags.includes('drums')),
  `presets ${def.presets.map((p) => p.name).join(', ')}, tagged bass-music and drums`,
);
ok(!/™|®|Serum|Vengeance|Splice|Kilohearts|Xfer/i.test(def.nod + def.blurb), `its nod is plain words ("${def.nod}")`);

// one hit at full velocity, alone, with 3 s to ring
const hit = (P, p, v = 1, tail = 3) =>
  mono(renderInst('core.clubkit', P, [{ p, t: 0, d: 0.1, v }], { bpm: 60, beats: 1, tail }).channels);
// the last 50 ms before the sound stops (the last sample over -120 dB of its peak), against the peak
function ending(x) {
  let pk = 0;
  for (const v of x) {
    const a = Math.abs(v);
    if (a > pk) pk = a;
  }
  let last = x.length - 1;
  while (last > 0 && Math.abs(x[last]) < pk * 1e-6) last--;
  let m = 0;
  for (let i = Math.max(0, last - Math.round(0.05 * SR)); i <= last; i++) m = Math.max(m, Math.abs(x[i]));
  return { db: 20 * Math.log10(m / pk + 1e-12), ms: (last / SR) * 1000, ends: last < x.length - Math.round(0.1 * SR) };
}

for (const [kit, name] of KITS.entries()) {
  console.log(`KIT ${name}`);
  const P = { kit };
  const k = hit(P, 36),
    ks = hitStats(k, SR, 0),
    kf = fundamental(k, SR, { from: 0.06, to: 0.06 + 8192 / SR, lo: 25, hi: 120 }),
    cents = 1200 * Math.log2(kf / 43.654);
  ok(
    ks.peakMs <= 5 && ks.crest100 >= 10 && Math.abs(cents) <= 25,
    `kick: peaks ${f(ks.peakMs)} ms in, crest ${f(ks.crest100)} dB over 100 ms (real: 11.2), its tail ${f(kf, 2)} Hz after 60 ms (${f(cents, 0)} cents from F1)`,
  );
  const s = hit(P, 38),
    ss = hitStats(s, SR, 0),
    t60 = decayT60(s, SR, 0.01, { lo: 2500 }),
    body = fundamental(s, SR, { from: 0.005, to: 0.2, lo: 120, hi: 400 });
  ok(
    ss.peakMs <= 5 && ss.crest100 >= 12 && t60 <= 0.5 && body >= 150 && body <= 300,
    `snare: peaks ${f(ss.peakMs)} ms in, crest ${f(ss.crest100)} dB (real: 13-17), over 2.5 kHz T60 ${f(t60, 2)} s (real: 0.2-0.5), body at ${f(body, 0)} Hz`,
  );
  const hr = renderInst('core.clubkit', P, [{ p: 42, t: 0, d: 0.1, v: 1 }], { bpm: 60, beats: 1, tail: 1 }),
    h = mono(hr.channels);
  const lo = bandDb(h, SR, 150, 2500),
    top = Math.max(bandDb(h, SR, 2500, 8000), bandDb(h, SR, 8000, 20000), lo),
    corr = measure(hr).correlation;
  ok(
    lo - top >= -30 && corr <= 0.5,
    `hats: 150 Hz-2.5 kHz at ${f(lo - top)} dB to their loudest band (Gobo's were 42-58 under), the mics correlate ${f(corr, 2)}`,
  );
  // ...and their top: a real closed hat's 12-20 kHz is within a few dB of its 150-600 Hz (OSD -0.7, VCSL +6.1), its
  // centroid 5-8.5 kHz over the first 30 ms; a hat that fixes the body by losing the top is dull
  let on = 0;
  while (on < h.length && Math.abs(h[on]) < 1e-4) on++;
  const ct = centroidTrack(h, SR, { from: on / SR, to: on / SR + 0.03, hop: 48, win: 1024, lo: 20, hi: 22000 }),
    hc = ct.c.reduce((a, b) => a + b, 0) / ct.c.length;
  const air = bandDb(h, SR, 12000, 20000) - bandDb(h, SR, 150, 600);
  ok(
    air >= -6 && hc >= 4800,
    `hats: their top as strong as their body (12-20 kHz ${f(air)} dB against 150-600 Hz; real -0.7 to +6.1), centroid ${f(hc, 0)} Hz over the first 30 ms (real 5-8.5 kHz)`,
  );
  const ends = [36, 38, 39, 37, 42, 46, 45, 49, 51, 33].map((p) => [
    p,
    ending(hit(P, p, 1, [46, 49, 51, 33].includes(p) ? 12 : 3)),
  ]);
  const cut = ends.filter(([, e]) => !(e.db <= -60 && e.ends));
  ok(
    !cut.length,
    `every piece ends quietly: the last 50 ms before it stops are ${f(Math.max(...ends.map(([, e]) => e.db)), 0)} dB under its peak at most (${ends.map(([p, e]) => `${NOTES[p]} ${f(e.ms, 0)} ms`).join(', ')})${cut.length ? ': not ' + cut.map(([p, e]) => `${NOTES[p]} ${f(e.db, 0)} dB`).join(', ') : ''}`,
  );
  const ph = renderInst('core.clubkit', P, drumPhrase(), { bpm: 120, beats: DRUM_PHRASE_BEATS, tail: 2 }),
    m = measure(ph);
  ok(
    m.lufs >= -20.5 && m.lufs <= -15.5 && m.truePeak <= -1,
    `the drum phrase: ${m.lufs} LUFS (drums: about -18), ${m.truePeak} dBTP`,
  );
}

console.log('the kit as a whole');
{
  // a closed hat chokes an open one: the open hat's ring 300 ms on, with and without a closed hat at 100 ms
  const open = mono(
    renderInst('core.clubkit', { kit: 0 }, [{ p: 46, t: 0, d: 0.1, v: 1 }], { bpm: 60, beats: 1, tail: 1 }).channels,
  );
  const choked = mono(
    renderInst(
      'core.clubkit',
      { kit: 0 },
      [
        { p: 46, t: 0, d: 0.1, v: 1 },
        { p: 42, t: 0.1, d: 0.1, v: 0.6 },
      ],
      { bpm: 60, beats: 1, tail: 1 },
    ).channels,
  );
  const at = (x) => bandDb(x, SR, 2000, 20000, { from: 0.4, to: 0.6 });
  ok(at(choked) < at(open) - 15, `a closed hat chokes an open one: 300 ms after it, ${f(at(choked) - at(open))} dB`);
  // KICK NOTE: the tail moves, by the note
  const kA = hit({ kit: 0, kick_note: 9 }, 36),
    fA = fundamental(kA, SR, { from: 0.06, to: 0.06 + 8192 / SR, lo: 25, hi: 120 });
  ok(Math.abs(1200 * Math.log2(fA / 55)) <= 25, `KICK NOTE A1: the tail rings at ${f(fA, 2)} Hz (A1 is 55)`);
  // TUNE leaves the kick alone and moves the snare
  const kT = hit({ kit: 0, tune: 5 }, 36),
    sT = hit({ kit: 0, tune: 5 }, 38);
  ok(
    sha256({ channels: [kT, kT] }) === sha256({ channels: [hit({ kit: 0 }, 36), hit({ kit: 0 }, 36)] }) &&
      fundamental(sT, SR, { from: 0.005, to: 0.2, lo: 120, hi: 400 }) > 240,
    'TUNE moves the snare (up 5 semitones) and leaves the kick on its KICK NOTE',
  );
  // CLIP off: the kit unclipped (peakier, the same in time)
  const on = measure(
      renderInst('core.clubkit', { kit: 1 }, drumPhrase(), { bpm: 120, beats: DRUM_PHRASE_BEATS, tail: 1 }),
    ),
    off = measure(
      renderInst('core.clubkit', { kit: 1, clip: 0 }, drumPhrase(), { bpm: 120, beats: DRUM_PHRASE_BEATS, tail: 1 }),
    );
  ok(off.crest > on.crest, `CLIP takes the peaks' first milliseconds: crest ${off.crest} dB off, ${on.crest} dB on`);
  // the riser rises: louder and brighter over four bars
  const rr = mono(
    renderInst('core.clubkit', { kit: 0 }, [{ p: 34, t: 0, d: 16, v: 1 }], { bpm: 140, beats: 16, tail: 1 }).channels,
  );
  const early = measure({ sr: SR, channels: [rr.subarray(SR, 2 * SR)] }),
    late = measure({ sr: SR, channels: [rr.subarray(5 * SR, 6 * SR)] });
  ok(
    late.centroid > early.centroid * 2 && late.rms > early.rms,
    `the riser (34) climbs over four bars: centroid ${early.centroid} -> ${late.centroid} Hz, ${early.rms} -> ${late.rms} dBFS`,
  );
  // deterministic
  const a = renderInst('core.clubkit', { kit: 2 }, drumPhrase(), { bpm: 120, beats: DRUM_PHRASE_BEATS, tail: 1 }),
    b = renderInst('core.clubkit', { kit: 2 }, drumPhrase(), { bpm: 120, beats: DRUM_PHRASE_BEATS, tail: 1 });
  ok(sha256(a) === sha256(b), 'renders repeat bit for bit');
}
T.done();
