// The genre demos (app/src/core/demos/, META.targets): each rendered by the canonical Node renderer and held to its
// genre's targets (app/src/audio/targets.js), every number printed against its range.
//   - Service Lift (bass music): the whole song (-8 to -6 LUFS integrated, -1 dBTP, PLR) and each drop (short-term
//     loudness at its loudest, crest, the low end mono, the bands).
//   - Boiler Room (metal): the whole master (loudness, short-term, PLR, crest, loudness range, the low end mono, the
//     bands); the rhythm guitars' stems summed over the heavy section, before the master (89% of the energy in
//     100 Hz-5 kHz, -20 dB or less under 80 Hz, -30 dB or less over 8 kHz, 2-4 kHz within 6 dB of 500 Hz-2 kHz); the
//     guitars are two performances (their notes differ), panned hard left and right.
// Each demo is built only of ops through the store (lib.js built), renders the same twice, and is a song the store
// takes back whole. The kits must be fetched (node tools/fetch-kits.js): a demo whose kernel data is missing is
// skipped, and said so.
//   node tools/genre-demos-test.js
import fs from 'node:fs';
import { tally } from './pw.js';
import '../app/src/devices/builtin/index.js';
import { getDevice } from '../app/src/devices/registry.js';
import { MORE_DEMOS } from '../app/src/core/demos/index.js';
import { demoById } from '../app/src/core/demo.js';
import { validateProject } from '../app/src/core/project.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { dataPath } from '../app/src/engine/node/data.js';
import { measure } from '../app/src/audio/measure.js';
import { checkTargets, targetWords, TARGETS } from '../app/src/audio/targets.js';
import { guitarBands } from './amp-scenes.js';

const T = tally('genre-demos');
const ok = T.ok;
const GENRE = MORE_DEMOS.filter((d) => d.targets);
ok(GENRE.length >= 2 && GENRE.every((d) => TARGETS[d.targets]) && new Set(GENRE.map((d) => d.targets)).size >= 2, `${GENRE.length} genre demos, each naming its targets (${GENRE.map((d) => `${d.title}: ${d.targets}`).join(', ')})`);

const devicesOf = (p) => [...p.tracks.flatMap((t) => [t.instrument?.device, ...t.inserts.map((x) => x.device)]), ...p.master.inserts.map((x) => x.device)].filter(Boolean);
const missingData = (p) => [...new Set(devicesOf(p))].flatMap((id) => Object.values(getDevice(id)?.data || {})).filter((h) => !fs.existsSync(dataPath(h)));
const r2 = (x) => Math.round(x * 100) / 100;

for (const d of GENRE) {
  console.log(`${d.title} (${d.genre}, ${d.targets})`);
  const mod = await import(`../app/src/core/demos/${d.id}.js`);
  const p = demoById(d.id);
  const miss = missingData(p);
  if (miss.length) { T.note(`${d.title}: skipped, its kernel data isn't fetched (${miss.map((h) => h.slice(7, 19)).join(', ')}): node tools/fetch-kits.js`); continue; }
  ok(validateProject(p).length === 0, `${d.title}: a valid song, ${p.tracks.length} tracks, ${p.sections.length} sections (${p.sections.map((s) => s.name).join(', ')})`);
  const devs = new Set(devicesOf(p));
  const by = (w) => p.tracks.flatMap((t) => t.clips.flatMap((c) => c.notes)).filter((n) => n.by === w).length;
  ok(by('overdub') > 0 && by('claude') > 0, `${d.title}: ${by('overdub')} notes by the house, ${by('claude')} by Claude`);
  const sec = (60 / p.tempo) * 4;
  const out = renderSong(p, { from: 0, to: p.loop.end, tail: 2 });
  ok(!out.warnings.length, `${d.title}: renders ${(out.length / out.sr).toFixed(1)} s with no warnings${out.warnings.length ? ' ' + JSON.stringify(out.warnings.slice(0, 2)) : ''}`);
  const h = sha256(out);
  ok(sha256(renderSong(p, { from: 0, to: p.loop.end, tail: 2 })) === h, `${d.title}: a second render is bit-identical (${h.slice(0, 16)})`);
  const m = measure(out);
  const song = checkTargets(m, d.targets, { window: 'song' });
  for (const r of song) ok(r.ok, `${d.title}, the song: ${targetWords(r)}`);
  for (const [name, s, l] of mod.DROPS) {
    const dm = measure(out, { from: s * sec, to: (s + l) * sec });
    for (const r of checkTargets(dm, d.targets, { window: 'drop' })) ok(r.ok, `${d.title}, ${name} (bars ${s + 1}-${s + l}): ${targetWords(r)}`);
  }
  // each section, for the record: loudness, short-term at its loudest, crest
  T.note(`${d.title} by section: ${mod.FORM.map(([name, s, l]) => { const x = measure(out, { from: s * sec, to: (s + l) * sec }); return `${name} ${x.lufs} LUFS (st ${x.lufsShortMax}, crest ${x.crest})`; }).join('; ')}`);

  if (d.targets === 'bass-music') {
    ok(['core.clubkit', 'core.ducker', 'core.clipper', 'core.multiband', 'core.width', 'core.wavetable', 'core.limiter'].every((id) => devs.has(id)) && p.master.clip === 'clean',
      `${d.title}: on the guide's devices (Sandbag, Dim Switch, Clip Lamp, Gaffer Tape, Gatefold, Light Table, Red Line) with a clean master`);
    const keyed = p.tracks.flatMap((t) => t.inserts.filter((x) => x.key).map((x) => `${t.name} <- ${p.tracks.find((u) => u.id === x.key.track)?.name}`));
    ok(keyed.length >= 3 && keyed.every((k) => !k.endsWith('undefined')), `${d.title}: the basses duck under the drums by key (${keyed.join(', ')})`);
  }
  if (d.targets === 'metal') {
    ok(['core.metalkit', 'core.drumbus', 'core.stack', 'core.bassrig', 'core.clipper', 'core.limiter'].every((id) => devs.has(id)) && p.master.clip === 'clean',
      `${d.title}: on the new devices (Rusty Sticks, Drum Riser, Half Stack, Y Cable) and Clip Lamp into Red Line, a clean master`);
    const L = p.tracks.find((t) => t.name === 'Guitar L'), R = p.tracks.find((t) => t.name === 'Guitar R');
    const notes = (t) => t.clips.flatMap((c) => c.notes.map((n) => `${n.p}@${(c.start + n.t).toFixed(4)}*${n.v.toFixed(3)}`));
    const a = new Set(notes(L)), same = notes(R).filter((x) => a.has(x)).length;
    ok(L.pan === -1 && R.pan === 1 && same / a.size < 0.05, `${d.title}: two rhythm performances, hard left and right (${same} of ${a.size} notes the same in time and touch)`);
    // the guitar stems, summed, before the master, over the heavy section
    const q = JSON.parse(JSON.stringify(p));
    q.master.inserts = []; delete q.master.clip;
    for (const t of q.tracks) t.mute = t.id !== L.id && t.id !== R.id;
    const [name, s, l] = mod.DROPS[0];
    const g = renderSong(q, { from: s * 4, to: (s + l) * 4, tail: 0 });
    const mono = new Float32Array(g.length); for (let i = 0; i < g.length; i++) mono[i] = 0.5 * (g.channels[0][i] + g.channels[1][i]);
    const b = guitarBands(mono), P = TARGETS.metal.parts.guitars;
    const row = (k, v, [lo, hi], unit) => ok(v >= lo && v <= hi, `${d.title}, the rhythm guitars in the ${name}: ${k} ${r2(v)}${unit} (want ${lo === -Infinity ? `${hi} or under` : hi === Infinity ? `${lo} or over` : `${lo} to ${hi}`})`);
    row('share of energy in 100 Hz-5 kHz', b.in, P.inBand, '');
    row('under 80 Hz', b.under80, P.under80, ' dB');
    row('over 8 kHz', b.over8k, P.over8k, ' dB');
    row('2-4 kHz against 500 Hz-2 kHz', b.hm - b.mid, P.highmidVsMid, ' dB');
  }
}
T.done();
