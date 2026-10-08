// Bringing outside material in [imports]:
//   1. input/importers.js in Node: Standard MIDI Files built by hand, byte by byte: type 0 (split by channel) and
//      type 1, the first tempo of a tempo map, time and key signatures, track names, markers, drums on channel 10,
//      running status, note-on at velocity 0 as a note-off, program changes choosing an instrument; the exporter's
//      own MIDI parses back; an import plan is one undo step that undoes to nothing, and into a song that already
//      has parts it keeps that song's tempo and says so.
//   2. ui/reference.js in Node: the comparison's words point the right way on known deltas.
//   3. In the page: a .mid dropped on the arranger makes a track per part (one undo step by you, a toast saying what
//      came in); Song menu → Import MIDI… is there; a WAV dropped on the lanes becomes an audio clip where it was
//      dropped (a new audio track, then the existing one) that renders; the Reference tab takes a dropped file,
//      measures it once, stays out of the song's render, shows its profile beside the mix's, and A/B matches its
//      loudness; compare_to_reference's deltas point the right way on a darker copy and a quieter copy of the song.
//   node tools/imports-test.js      (screenshots: tools/.out/imports-*.png)
import { open, tally } from './pw.js';
import { createStore } from '../app/src/core/store.js';
import { createProject } from '../app/src/core/project.js';
import { demoProject } from '../app/src/core/demo.js';
import { parseSmf, planMidiImport, midiSummary, deviceFor, keyFromSignature, MAX_IMPORT_NOTES } from '../app/src/input/importers.js';
import { Worker } from 'node:worker_threads';
import { compareProfiles, matchGainDb, abMatch } from '../app/src/ui/reference.js';
import { encodeMidi } from '../app/src/ui/export.js';

const T = tally('imports');
const ok = T.ok;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ours = (errors) => errors.filter((e) => !/Failed to load resource/.test(e));

/* ------------------------------------------------------------------ SMF by hand */
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const txt = (s) => [...Buffer.from(s, 'utf8')];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, bytes) => [...txt(type), ...u32(bytes.length), ...bytes];
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
const tempoBytes = (bpm) => { const us = Math.round(60e6 / bpm); return [(us >> 16) & 255, (us >> 8) & 255, us & 255]; };
const smfFile = (format, ppq, tracks) => new Uint8Array([...chunk('MThd', [0, format, 0, tracks.length, (ppq >> 8) & 255, ppq & 255]), ...tracks.flatMap((t) => chunk('MTrk', t))]);
// a track from [delta, ...bytes] events (bytes written as given, so running status is literal)
const trk = (events) => [...events.flatMap(([dt, ...bytes]) => [...vlq(dt), ...bytes]), 0, ...meta(0x2f, [])];

// type 0, ppq 96: 90 bpm, 3/4, C minor (3 flats, minor); a bass on channel 1 (program 33) using running status and a
// note-on at velocity 0 to end a note; drums on channel 10 with running status and velocity-0 note-offs
const type0 = smfFile(0, 96, [trk([
  [0, ...meta(0x03, txt('Groove'))],
  [0, ...meta(0x51, tempoBytes(90))],
  [0, ...meta(0x58, [3, 2, 24, 8])],
  [0, ...meta(0x59, [0xfd, 1])],
  [0, 0xc0, 33],
  [0, 0x90, 36, 100],      // C2 on
  [48, 36, 0],             // running status: velocity 0 = off (half a beat)
  [0, 43, 80],             // running status: G2 on
  [96, 0x80, 43, 64],      // explicit off (one beat)
  [0, 0x99, 36, 127],      // kick on ch 10 at beat 1.5
  [24, 36, 0],             // running status off
  [24, 38, 90],            // snare at beat 2
  [24, 0x89, 38, 0],       // explicit off
  [0, 0x90, 48, 64],       // C3 on ch 1 at beat 2.25, never released: ends with the track
  [96],                    // (a delta with nothing after it: the end-of-track meta follows)
].slice(0, -1).concat([[96, ...meta(0x01, txt('end'))]]))]);

let s0;
try { s0 = parseSmf(type0); } catch (e) { s0 = { error: e.message }; }
ok(!s0.error && s0.format === 0 && s0.ppq === 96, `type 0 parses (format ${s0.format}, ppq ${s0.ppq})${s0.error ? ': ' + s0.error : ''}`);
ok(near(s0.tempo, 90, 0.01) && s0.meter?.join('/') === '3/4' && s0.key?.root === 'C' && s0.key?.scale === 'minor', `tempo ${s0.tempo}, meter ${s0.meter}, key ${s0.key?.root} ${s0.key?.scale}`);
const bass0 = s0.parts?.find((p) => p.channel === 1), drums0 = s0.parts?.find((p) => p.channel === 10);
ok(s0.parts?.length === 2 && bass0 && drums0 && drums0.drums && !bass0.drums, `type 0 splits by channel: ${s0.parts?.map((p) => 'ch' + p.channel).join(', ')}`);
ok(bass0 && bass0.notes.length === 3 && near(bass0.notes[0].d, 0.5) && bass0.notes[0].p === 36 && near(bass0.notes[0].v, 100 / 127, 0.002), `running status + velocity-0 note-off: C2 lasts half a beat (${bass0?.notes[0]?.d})`);
ok(bass0 && bass0.notes[1].p === 43 && near(bass0.notes[1].t, 0.5) && near(bass0.notes[1].d, 1), `the next note via running status: G2 at 0.5 for 1 beat (${bass0?.notes[1]?.t}, ${bass0?.notes[1]?.d})`);
ok(bass0 && bass0.notes[2].p === 48 && near(bass0.notes[2].t, 2.25) && bass0.notes[2].d > 0 && s0.warnings.some((w) => /no note-off/.test(w)), `a held note ends with the track, and that is warned (${s0.warnings.join('; ')})`);
ok(drums0 && drums0.notes.map((n) => `${n.p}@${n.t}:${n.d}`).join(' ') === '36@1.5:0.25 38@2:0.25', `drums on channel 10: ${drums0?.notes.map((n) => `${n.p}@${n.t}:${n.d}`).join(' ')}`);
ok(deviceFor(bass0).device === 'core.bass' && deviceFor(drums0).device === 'core.drums', `program 33 → ${deviceFor(bass0).device}; channel 10 → ${deviceFor(drums0).device}`);
ok(keyFromSignature(0, 0)?.root === 'C' && keyFromSignature(1, 0)?.root === 'G' && keyFromSignature(0xff, 0)?.root === 'F' && keyFromSignature(2, 1)?.root === 'B' && keyFromSignature(0xfe, 0)?.root === 'Bb' && keyFromSignature(3, 1)?.root === 'F#', 'key signatures: C, G, F, B minor, Bb, F# minor');

// type 1, ppq 480: a tempo map (100 then 140 bpm), 4/4, markers; Keys (program 0), Beat (channel 10, no program),
// Lead (no program, high notes), Sub Bass (no program: named)
const Q = 480;
const type1 = smfFile(1, Q, [
  trk([[0, ...meta(0x03, txt('Song Title'))], [0, ...meta(0x51, tempoBytes(100))], [0, ...meta(0x58, [4, 2, 24, 8])], [0, ...meta(0x06, txt('Verse'))], [4 * Q, ...meta(0x51, tempoBytes(140))], [4 * Q, ...meta(0x06, txt('Chorus'))]]),
  trk([[0, ...meta(0x03, txt('Keys'))], [0, 0xc0, 0], [0, 0x90, 60, 90], [0, 64, 90], [0, 67, 90], [2 * Q, 0x80, 60, 0], [0, 64, 0], [0, 67, 0], [6 * Q, 0x90, 62, 70], [Q, 62, 0]]),
  trk([[0, ...meta(0x03, txt('Beat'))], [0, 0x99, 36, 120], [Q / 4, 0x89, 36, 0], [Q * 3 / 4, 0x99, 38, 100], [Q / 4, 38, 0]]),
  trk([[0, ...meta(0x03, txt('Lead'))], [8 * Q, 0x92, 76, 100], [Q / 2, 0x82, 76, 0], [0, 0x92, 79, 100], [Q / 2, 79, 0]]),
  trk([[0, ...meta(0x03, txt('Sub Bass'))], [0, 0x93, 33, 110], [4 * Q, 0x83, 33, 0]]),
]);
let s1;
try { s1 = parseSmf(type1); } catch (e) { s1 = { error: e.message }; }
ok(!s1.error && s1.format === 1 && s1.tracks === 5 && s1.parts?.length === 4, `type 1 parses: ${s1.tracks} tracks, ${s1.parts?.length} parts${s1.error ? ': ' + s1.error : ''}`);
ok(near(s1.tempo, 100, 0.01) && s1.tempoChanges === 1 && s1.tempos?.[1] && near(s1.tempos[1].beat, 4) && near(s1.tempos[1].bpm, 140, 0.01), `the first tempo is kept (${s1.tempo}); the change to 140 at beat 4 is counted`);
ok(s1.markers?.map((m) => `${m.name}@${m.beat}`).join(' ') === 'Verse@0 Chorus@8', `markers: ${s1.markers?.map((m) => `${m.name}@${m.beat}`).join(' ')}`);
const byName = Object.fromEntries((s1.parts || []).map((p) => [p.name, p]));
ok(byName.Keys && byName.Keys.notes.length === 4 && byName.Keys.notes.slice(0, 3).every((n) => n.t === 0 && n.d === 2) && near(byName.Keys.notes[3].t, 8) && byName.Keys.notes[3].d === 1, 'Keys: a two-beat chord (running status for the chord and its offs), then D4 at beat 8 (after a tempo change, still on its beat)');
ok(deviceFor(byName.Keys).device === 'core.keys' && deviceFor(byName.Beat).device === 'core.drums' && deviceFor(byName.Lead).device === 'core.poly' && deviceFor(byName['Sub Bass']).device === 'core.bass',
  `instruments: Keys ${deviceFor(byName.Keys).device}, Beat ${deviceFor(byName.Beat).device}, Lead ${deviceFor(byName.Lead).device}, Sub Bass ${deviceFor(byName['Sub Bass']).device}`);
let bad = ''; try { parseSmf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])); } catch (e) { bad = e.message; }
ok(/not a Standard MIDI File/.test(bad), 'a file that isn’t MIDI is refused with a reason: ' + bad);

// corrupt and hostile files: a time signature of 4/2^40 (a bar 1e-11 beats long froze the ruler) is ignored with a
// warning, and no plan or op takes it; a .rmi whose chunk length reads as -8 is refused, not looped on forever;
// a file with more notes than a call can take arguments still parses and plans (no Math.max(...spread))
const noteOn = (dt, p) => [[dt, 0x90, p, 100], [1, 0x80, p, 0]];
for (const exp of [6, 31, 40]) {
  const f = smfFile(0, 96, [trk([[0, ...meta(0x58, [4, exp, 24, 8])], ...noteOn(0, 60)])]);
  const sm = parseSmf(f);
  const pl = planMidiImport(sm, createProject(), { name: 'bad.mid' });
  ok(sm.meter === null && sm.warnings.some((w) => /time signature of 4\/2\^\d+ is out of range; ignored/.test(w)) && !pl.ops.some((x) => x.type === 'project.set' && x.patch.meter), `a time signature of 4/2^${exp} is ignored: ${sm.warnings.join('; ')}`);
}
{
  const f = smfFile(0, 96, [trk([[0, ...meta(0x58, [7, 3, 24, 8])], ...noteOn(0, 60)])]);
  const pl = planMidiImport(parseSmf(f), createProject(), { name: 'odd.mid' });
  ok(pl.ops[0]?.patch?.meter?.join('/') === '7/8', 'a real 7/8 still comes in');
  ok(!planMidiImport({ ...parseSmf(f), meter: [4, 2 ** 31] }, createProject()).ops.some((x) => x.patch?.meter), 'planMidiImport refuses a meter of 4/2^31 handed to it directly');
}
{
  // SMPTE timing (division 0xE2xx: 30 fps) counts ticks per frame; 0 of them gives every note a time of 0/0. Refused
  // with a reason, not stacked on beat 1. A real one (96 ticks per frame) still reads.
  const two = trk([...noteOn(0, 60), [95, 0x90, 64, 100], [96, 0x80, 64, 0]]);
  let err = '', sm = null;
  try { sm = parseSmf(smfFile(0, 0xe200, [two])); } catch (e) { err = e.message; }
  ok(!sm && /ticks per frame/.test(err), `a SMPTE file with 0 ticks per frame is refused: ${err || 'parsed to ' + JSON.stringify(sm?.parts?.[0]?.notes)}`);
  const good = parseSmf(smfFile(0, 0xe260, [two])).parts[0].notes;
  ok(good.length === 2 && good.every((n) => Number.isFinite(n.t) && Number.isFinite(n.d) && n.d > 0) && good[1].t > good[0].t, `30 fps × 96 ticks per frame still reads (${good.map((n) => `${n.p}@${n.t}`).join(', ')})`);
}
{
  const rmi = new Uint8Array([...txt('RIFF'), 0, 0, 0, 0, ...txt('RMID'), ...txt('LIST'), 0xf8, 0xff, 0xff, 0xff, 0, 0, 0, 0]);
  const src = `import { parseSmf } from ${JSON.stringify(new URL('../app/src/input/importers.js', import.meta.url).href)};
    import { parentPort, workerData } from 'node:worker_threads';
    try { parseSmf(workerData); parentPort.postMessage('parsed'); } catch (e) { parentPort.postMessage('threw: ' + e.message); }`;
  const w = new Worker(new URL('data:text/javascript,' + encodeURIComponent(src)), { workerData: rmi });
  const said = await new Promise((res) => { const tm = setTimeout(() => res('still parsing after 3 s'), 3000); w.on('message', (m) => { clearTimeout(tm); res(m); }); w.on('error', (e) => { clearTimeout(tm); res('error: ' + e.message); }); });
  await w.terminate();
  ok(/^threw: not a Standard MIDI File/.test(said), `a .rmi with a chunk length of 0xFFFFFFF8 is refused, not looped on: ${said}`);
}
{
  const N = 150000, ev = [];
  for (let i = 0; i < N; i++) ev.push([i ? 1 : 0, 0x90, 36 + (i % 48), 90], [1, 0x80, 36 + (i % 48), 0]);
  let sm = null, err = '';
  try { sm = parseSmf(smfFile(0, 96, [trk(ev)])); } catch (e) { err = e.message; }
  let pl = null;
  try { if (sm) pl = planMidiImport(sm, createProject(), { name: 'long.mid' }); } catch (e) { err = e.message; }
  ok(sm && pl && sm.parts[0].notes.length === N && pl.summary.notes === N && sm.end > 0, `a ${N.toLocaleString('en-US')}-note file parses and plans${err ? ': ' + err : ''}`);
  ok(MAX_IMPORT_NOTES === 50000, 'one import takes up to the song limit, 50,000 notes (core/project.js LIMITS)');
}

// the exporter's own MIDI (Song menu → MIDI) parses back: tempo, and every note it wrote
const demo = demoProject();
const sx = parseSmf(encodeMidi(demo));
const written = demo.tracks.filter((t) => t.kind === 'instrument').reduce((a, t) => a + t.clips.filter((c) => c.kind === 'notes').reduce((b, c) => b + c.notes.filter((n) => n.t < c.length && n.d > 0).length, 0), 0);
const read = sx.parts.reduce((a, p) => a + p.notes.length, 0);
ok(near(sx.tempo, demo.tempo, 0.01) && read === written && sx.parts.some((p) => p.drums), `the exporter's MIDI parses back: ${read}/${written} notes, ${sx.tempo} bpm, drums on channel 10`);

// a plan is one undo step; into an empty song it takes the file's tempo, meter, key and name
const st = createStore(createProject());
const plan = planMidiImport(s1, st.get(), { name: 'Night Drive.mid' });
const r = st.dispatch(plan.ops, { by: 'you', label: 'import Night Drive.mid' });
const p1 = st.get();
ok(r.ok && p1.tracks.length === 4 && st.history.length === 1 && p1.tracks.every((t) => t.by === 'you' && t.clips.length === 1 && t.clips[0].by === 'you'), `one undo step by you: ${p1.tracks.length} tracks, one clip each${r.ok ? '' : ': ' + r.error}`);
ok(p1.tempo === 100 && p1.meter.join('/') === '4/4' && p1.title === 'Night Drive' && p1.sections.map((x) => x.name).join(',') === 'Verse,Chorus', `took the file's tempo (${p1.tempo}), meter, title (${p1.title}) and sections (${p1.sections.map((x) => x.name)})`);
const lead = p1.tracks.find((t) => t.name === 'Lead');
ok(lead && lead.clips[0].start === 8 && lead.clips[0].notes[0].t === 0 && lead.clips[0].length === 4, `a part that comes in late starts its clip at its bar (Lead at beat ${lead?.clips[0]?.start})`);
const drumsT = p1.tracks.find((t) => t.name === 'Beat');
ok(drumsT && drumsT.instrument.device === 'core.drums', 'channel 10 became Gobo Kit (core.drums)');
const text1 = midiSummary(plan, 'Night Drive.mid');
ok(/^Imported Night Drive\.mid: 4 tracks, 9 notes \(Keys, Beat, Lead, Sub Bass\)\. 100 bpm\./.test(text1) && /changes tempo 1 time/.test(text1), 'the toast says what came in: ' + text1);
st.undo();
ok(st.get().tracks.length === 0 && st.get().tempo === 120 && st.get().title === 'Untitled' && !st.get().sections.length, 'undo takes the whole import back');
// into a song with parts: its tempo stays, and the toast says so
const sd = createStore(demoProject());
const plan2 = planMidiImport(s0, sd.get(), { name: 'groove.mid', at: 16 });
const r2 = sd.dispatch(plan2.ops, { by: 'you' });
ok(r2.ok && sd.get().tempo === demo.tempo && sd.get().tracks.length === demo.tracks.length + 2 && /Kept your/.test(midiSummary(plan2, 'groove.mid')), `into a song with parts: kept ${sd.get().tempo} bpm (${midiSummary(plan2, 'groove.mid')})`);
ok(sd.get().tracks.slice(-2).every((t) => t.clips[0].start >= 16), 'the parts land at the drop point (beat 16)');

/* ------------------------------------------------------------------ comparison words (pure) */
const base = { lufs: -9, truePeak: -0.5, crest: 8, lra: 5, correlation: 0.7, onsetsPerSec: 3, centroid: 2400, bands: { sub: -14, low: -6, lowmid: -9, mid: -6, highmid: -12, presence: -15, air: -20 } };
const darker = { ...base, lufs: -18, centroid: 1500, crest: 12, bands: { ...base.bands, presence: -20, air: -27, highmid: -14 } };
const c1 = compareProfiles(base, darker, { name: 'Ref' });
ok(c1.deltas.lufs < 0 && c1.deltas.centroidPct < 0 && c1.deltas.bands.air < 0, 'deltas are song minus reference');
ok(/9 LU quieter/.test(c1.summary) && /darker/.test(c1.summary) && /more dynamic/.test(c1.summary), 'summary: ' + c1.summary);
ok(c1.differences.some((x) => /^air −?-?7(\.0)? dB vs the reference/.test(x.replace('−', '-'))) && c1.notes.some((x) => /mastered/.test(x)), 'differences reuse the render_and_measure glosses: ' + c1.differences.join(' | '));
ok(matchGainDb(-18, -9) === -9 && matchGainDb(-12, -14) === 2 && matchGainDb(-120, -9) === 0, 'A/B match gain: the reference turned to the song’s loudness');
// a quiet, dynamic reference against a loud mix: the match would put its peaks over 0 dBFS, straight to the speakers
const lim = abMatch(-8, { lufs: -20, truePeak: -2 }), free = abMatch(-12, { lufs: -14, truePeak: -6 });
ok(lim.limited && lim.db === 1 && !free.limited && free.db === 2 && abMatch(-8, { lufs: -20 }).db === 12, `A/B match is held to −1 dBTP on the reference's peaks (wanted +12, plays ${lim.db > 0 ? '+' : ''}${lim.db} dB)`);

/* ------------------------------------------------------------------ in the page */
const o = await open('/app/', { query: 'new', width: 1440, height: 900 });
const { page } = o;
await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.overdub?.importers && window.overdub?.reference && window.overdub?.arranger, null, { timeout: 30000 });
await page.evaluate(() => window.overdub.engine.start());

// bytes: an array, or the name of a window variable holding a Uint8Array (big files stay in the page)
const dropAt = (selector, bytes, name, type, where = 'center') => page.evaluate(async ({ selector, bytes, name, type, where }) => {
  const el = document.querySelector(selector);
  if (!el) return { error: 'no ' + selector };
  const r = el.getBoundingClientRect();
  const pt = typeof where === 'object' ? { x: r.left + where.x, y: r.top + where.y } : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const target = document.elementFromPoint(pt.x, pt.y) || el;
  const inside = !!target.closest?.(selector), hit = String(target.className || target.tagName);
  const dt = new DataTransfer();
  dt.items.add(new File([typeof bytes === 'string' ? window[bytes] : new Uint8Array(bytes)], name, { type }));
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y }));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y }));
  return { x: pt.x, y: pt.y, hit, inside, locate: window.overdub.arranger.locate(pt.x, pt.y) };
}, { selector, bytes: typeof bytes === 'string' ? bytes : [...bytes], name, type, where });
const lastToast = () => page.evaluate(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).pop() || '');
const waitFor = (fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

// MIDI dropped on the arranger
await dropAt('.ar-lanewrap', type1, 'Night Drive.mid', 'audio/midi');
await waitFor(() => window.overdub.store.get().tracks.length === 4);
const m1 = await page.evaluate(() => { const s = window.overdub.store; return { tracks: s.get().tracks.map((t) => [t.name, t.instrument?.device, t.clips.length, t.by, t.clips[0]?.start]), hist: s.history.map((h) => [h.by, h.label]), tempo: s.get().tempo, sections: s.get().sections.map((x) => x.start) }; });
ok(m1.tracks.length === 4 && m1.tracks.every(([, , n, by]) => n === 1 && by === 'you'), `a dropped .mid makes a track per part, one clip each: ${m1.tracks.map((t) => `${t[0]} (${t[1]})`).join(', ')}`);
ok(m1.tracks.map((t) => t[4]).join(',') === '0,0,8,0' && m1.sections.join(',') === '0,8', `into an empty song it starts at bar 1 wherever it was dropped (clips at ${m1.tracks.map((t) => t[4])}, sections at ${m1.sections})`);
ok(m1.hist.length === 1 && m1.hist[0][0] === 'you' && /import Night Drive\.mid/.test(m1.hist[0][1]) && m1.tempo === 100, `one undo step by you: ${JSON.stringify(m1.hist)}`);
const t1 = await lastToast();
ok(/Imported Night Drive\.mid: 4 tracks, 9 notes/.test(t1), 'the toast says what came in: ' + t1);
await o.shot('imports-midi');
const menu = await page.evaluate(async () => { document.querySelector('.sm-btn')?.click(); await new Promise((r) => setTimeout(r, 200)); const t = [...document.querySelectorAll('.sm-i')].map((b) => b.textContent); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return t; });
ok(menu.some((t) => /Import MIDI…/.test(t)) && menu.some((t) => /Import audio…/.test(t)), 'Song menu → Import MIDI… and Import audio… are there');
// a flat key from a MIDI file's key signature (Bb major): the Inspector's Key shows it, not "None"
{
  const k = await page.evaluate(async () => {
    const app = window.overdub;
    app.store.dispatch({ type: 'project.set', patch: { key: { root: 'Bb', scale: 'major' } } }, { by: 'you' });
    app.ui.select({ track: null, clip: null, notes: [] });
    app.ui.show('inspector');
    await new Promise((r) => setTimeout(r, 300));
    const sel = document.querySelector('select[aria-label="Key root"]');
    const r = sel && { value: sel.value, text: sel.selectedOptions[0]?.textContent };
    app.store.undo();
    return r;
  });
  ok(k && k.value === 'A#' && k.text === 'Bb', `a flat root shows in the Inspector's Key (${JSON.stringify(k)})`);
}
// in the page: a file with a 4/2^40 time signature comes in without its meter and the studio keeps drawing; a file
// with more notes than one import takes is refused with the count, and the song is left alone
{
  const hostile = smfFile(0, 96, [trk([[0, ...meta(0x58, [4, 40, 24, 8])], [0, 0x90, 60, 100], [96, 0x80, 60, 0]])]);
  const hm = await page.evaluate(async (bytes) => {
    const app = window.overdub, h = app.store.history.length, meter = app.store.get().meter.join('/');
    const r = await app.importers.importMidi(new Uint8Array(bytes), { name: 'hostile.mid', adopt: true, quiet: true });
    const after = app.store.get().meter.join('/');
    const framed = await Promise.race([new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(true)))), new Promise((res) => setTimeout(() => res(false), 3000))]);
    if (r.ok) app.store.undo();
    return { ok: r.ok, meter, after, framed, back: app.store.history.length === h };
  }, [...hostile]);
  ok(hm.ok && hm.after === hm.meter && hm.framed && hm.back, `a 4/2^40 time signature is left out and the studio keeps drawing: meter ${hm.meter} → ${hm.after}, frames ${hm.framed}`);
  const big = await page.evaluate(async () => {
    const app = window.overdub, N = 210000, h = app.store.history.length;
    const ev = [];
    for (let i = 0; i < N; i++) ev.push(0, 0x90, 60, 90, 1, 0x80, 60, 0);
    ev.push(0, 0xff, 0x2f, 0);
    const len = ev.length, head = [77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255];
    const r = await app.importers.importMidi(new Uint8Array([...head, ...ev]), { name: 'dense.mid', quiet: true });
    return { ok: r.ok, error: r.error, same: app.store.history.length === h };
  });
  ok(!big.ok && /dense\.mid has 210,000 notes; Overdub imports up to 50,000 at a time\./.test(big.error) && big.same, `a 210,000-note file is refused with the count: ${big.error}`);
}
await page.evaluate(() => { document.querySelectorAll('.ew-popover, .pop').forEach(() => {}); document.body.click(); });

// a WAV dropped on the lanes below the tracks: a new audio track with the clip where it was dropped; it renders
const wav = await page.evaluate(() => {
  const sr = 48000, n = sr, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const e = Math.min(1, i / 480, (n - i) / 480); L[i] = R[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / sr) * e; }
  return [...window.overdub.exporter.encodeWav({ sampleRate: sr, channels: [L, R] }, { bits: 16 })];
});
const th = await page.evaluate(() => window.overdub.ui.state.zoom.trackH);
const ppb = await page.evaluate(() => window.overdub.ui.state.zoom.pxPerBeat);
await page.evaluate(() => { window.overdub.ui.state.snap = 1; });
const d1 = await dropAt('.ar-lanewrap', new Uint8Array(wav), 'sine take.wav', 'audio/wav', { x: Math.round(8.2 * ppb), y: Math.round(4.5 * th) });
const okAudio = await waitFor(() => window.overdub.store.get().tracks.some((t) => t.kind === 'audio' && t.clips.length));
const a1 = await page.evaluate(() => { const p = window.overdub.store.get(); const t = p.tracks.find((x) => x.kind === 'audio'); return t && { name: t.name, index: p.tracks.indexOf(t), clips: t.clips.map((c) => ({ start: c.start, length: c.length, asset: c.asset, kind: c.kind })), asset: p.assets[t.clips[0]?.asset], hist: window.overdub.store.history.length, by: t.by }; });
ok(okAudio && a1 && a1.clips.length === 1 && a1.clips[0].kind === 'audio' && a1.name === 'sine take' && a1.by === 'you', `a dropped WAV becomes an audio clip on a new audio track (${JSON.stringify(a1?.clips)}; drop at ${JSON.stringify(d1.locate)})`);
const tempo = 100;
ok(a1 && a1.clips[0].start === 8 && near(a1.clips[0].length, 1 * tempo / 60, 1e-3) && a1.asset && near(a1.asset.duration, 1, 1e-3) && a1.hist === 2, `…at the drop point (beat ${a1?.clips[0]?.start}, snapped to the beat), ${a1?.clips[0]?.length} beats long, the asset in the song, one more undo step`);
const ren = await page.evaluate(async () => {
  const e = window.overdub.engine, p = window.overdub.store.get(), t = p.tracks.find((x) => x.kind === 'audio');
  const M = await import('/app/src/audio/measure.js');
  const b = await e.render({ from: 8, to: 9, tracks: [t.id], tail: 0 });
  const quiet = await e.render({ from: 12, to: 13, tracks: [t.id], tail: 0 });
  return { lufs: M.measure(b).lufs, quiet: M.measure(quiet).lufs };
});
ok(ren.lufs > -30 && ren.quiet <= -100, `the clip renders where it was dropped (${ren.lufs} LUFS in its beat, ${ren.quiet} after it)`);
const t2 = await lastToast();
ok(/sine take\.wav is in: 1\.0 s on sine take, from bar 3/.test(t2), 'the toast says where: ' + t2);
// a second drop on that audio track's lane lands on it
const row = a1.index;
await dropAt('.ar-lanewrap', new Uint8Array(wav), 'second.wav', 'audio/wav', { x: Math.round(16.1 * ppb), y: Math.round((row + 0.5) * th) });
await waitFor((n) => window.overdub.store.get().tracks.filter((t) => t.kind === 'audio').reduce((a, t) => a + t.clips.length, 0) === n, 2);
const a2 = await page.evaluate(() => window.overdub.store.get().tracks.filter((t) => t.kind === 'audio').map((t) => t.clips.map((c) => c.start)));
ok(a2.length === 1 && a2[0].join(',') === '8,16', `a drop on an audio track's lane lands on that track (${JSON.stringify(a2)})`);
await page.evaluate(() => window.overdub.store.undo());
// Song menu → Import audio…, from the keyboard (no drag: a phone, a screen reader): a file chooser, then a clip on a
// new audio track at the playhead's bar; with an audio track selected, on that track
{
  const pickByKeys = async (fileName) => {
    // Under a full run's load a press now and then brings no file chooser at all (the old code did it too: 3 runs in
    // 11), while the studio opens the picker in the click itself and the same keys work alone. So a press that brings
    // none is tried again, from the menu, up to three times; a keyboard path that is really broken fails all three.
    for (let attempt = 1; ; attempt++) {
      await page.evaluate(() => { document.querySelectorAll('.ew-toast').forEach((t) => t.remove()); if (!document.querySelector('.sm-i')) document.querySelector('.sm-btn')?.click(); });
      // wait for the item itself, not just the menu: under load its first items can be drawn before Import audio… is,
      // and focusing a missing item made Enter do nothing (the file chooser then timed out)
      await page.waitForFunction(() => [...document.querySelectorAll('.sm-i')].some((x) => /Import audio…/.test(x.textContent)), null, { timeout: 20000 });
      const focused = await page.evaluate(() => { const b = [...document.querySelectorAll('.sm-i')].find((x) => /Import audio…/.test(x.textContent)); b?.focus(); return document.activeElement === b; });
      try {
        const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.keyboard.press('Enter')]);
        await fc.setFiles({ name: fileName, mimeType: 'audio/wav', buffer: Buffer.from(wav) });
        if (attempt > 1) console.log(`  (the file chooser came on press ${attempt})`);
        return focused;
      } catch (e) {
        if (attempt >= 3 || e.name !== 'TimeoutError') throw e;
      }
    }
  };
  await page.evaluate(() => { window.overdub.ui.select({ track: null, clip: null, notes: [] }); window.overdub.engine.seek(25); });
  const n0 = await page.evaluate(() => window.overdub.store.get().tracks.length);
  const focused = await pickByKeys('menu take.wav');
  const got = await waitFor((n) => window.overdub.store.get().tracks.length === n + 1, n0);
  const pa = await page.evaluate(() => { const p = window.overdub.store.get(); const t = p.tracks[p.tracks.length - 1]; return { name: t.name, kind: t.kind, starts: t.clips.map((c) => c.start), by: t.clips[0]?.by, id: t.id }; });
  ok(focused && got && pa.kind === 'audio' && pa.name === 'menu take' && pa.starts.join(',') === '24' && pa.by === 'you', `Song menu → Import audio… works from the keyboard: a new audio track, the clip at the playhead's bar (${JSON.stringify(pa)})`);
  await page.evaluate((id) => { window.overdub.ui.select({ track: id, clip: null, notes: [] }); window.overdub.engine.seek(33); }, pa.id);
  await pickByKeys('second menu take.wav');
  await waitFor((id) => window.overdub.store.get().tracks.find((t) => t.id === id)?.clips.length === 2, pa.id);
  const pb = await page.evaluate((id) => ({ tracks: window.overdub.store.get().tracks.length, starts: window.overdub.store.get().tracks.find((t) => t.id === id)?.clips.map((c) => c.start) }), pa.id);
  ok(pb.tracks === n0 + 1 && pb.starts?.join(',') === '24,32', `…and onto the selected audio track (${JSON.stringify(pb)})`);
  await page.evaluate(() => { const s = window.overdub.store; s.undo(); s.undo(); window.overdub.engine.seek(0); });
}
await o.shot('imports-audio');

/* ---------------- the reference */
await page.evaluate(() => window.overdub.exporter.openDemo());
await waitFor(() => window.overdub.store.get().tracks.length > 3);
await page.evaluate(() => window.overdub.ui.show('reference'));
const none = await page.evaluate(() => window.overdub.tools.run('compare_to_reference', {}, { by: 'claude' }));
ok(none.error && /no reference/.test(none.error) && /Reference tab/.test(none.hint || ''), 'compare_to_reference with no reference says so: ' + (none.error || JSON.stringify(none).slice(0, 80)));
const listed = await page.evaluate(() => window.overdub.tools.list().includes('compare_to_reference'));
ok(listed, 'compare_to_reference is in the tool catalog');
// a reference without a measured profile (an agent's op, a hand-made file or link): refused or dropped, and if one
// is ever in the song anyway the tab still draws, with Remove in reach
{
  const bad = await page.evaluate(() => window.overdub.tools.run('apply_ops', { ops: [{ type: 'reference.set', reference: { name: 'x' } }], label: 'p' }, { by: 'claude' }));
  const loaded = await page.evaluate(() => { const s = window.overdub.store; const p = JSON.parse(JSON.stringify(s.get())); s.load({ ...p, reference: { name: 'x.mp3', asset: 'a_zzzzzz' } }, { by: 'you' }); return 'reference' in s.get(); });
  ok(!!bad.error && !loaded, `apply_ops reference.set without a profile is refused (${(bad.error || '').slice(0, 60)}), and a loaded song drops one`);
  const tab = await page.evaluate(async () => {
    const app = window.overdub;
    app.store.get().reference = { name: 'x.mp3', asset: 'a_zzzzzz' };   // test only: as if one slipped past the checks
    app.ui.show('reference');
    await new Promise((r) => setTimeout(r, 200));
    const el = document.querySelector('.rf');
    const text = el?.closest('[role=tabpanel], .ew-panel, section')?.textContent || el?.textContent || '';
    const rm = document.querySelector('.rf .rf-remove');
    rm?.click();
    await new Promise((r) => setTimeout(r, 200));
    return { drawn: !!el, failed: /failed to load/i.test(document.body.textContent), said: /came without its measurement/.test(text), remove: !!rm, gone: !app.store.get().reference, empty: !!document.querySelector('.rf .rf-empty') };
  });
  ok(tab.drawn && !tab.failed && tab.said && tab.remove && tab.gone && tab.empty, `a reference with no profile: the tab says so and Remove clears it (${JSON.stringify(tab)})`);
}

// the song (bars 1-8, as the tool renders them) and a darker copy of it, as a WAV file
const prep = await page.evaluate(async () => {
  const e = window.overdub.engine;
  const b = await e.render({ from: 0, to: 32, tail: 1 });
  const M = await import('/app/src/audio/measure.js');
  const fc = 1200, a = 1 - Math.exp(-2 * Math.PI * fc / b.sampleRate);
  const ch = [];
  for (let c = 0; c < b.numberOfChannels; c++) {
    const x = b.getChannelData(c), y = new Float32Array(x.length);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { s1 += a * (x[i] - s1); s2 += a * (s1 - s2); y[i] = s2; }
    ch.push(y);
  }
  window.__dark = { sampleRate: b.sampleRate, channels: ch };
  window.__songBuf = b;
  window.__darkWav = window.overdub.exporter.encodeWav({ sampleRate: b.sampleRate, channels: ch }, { bits: 24 });
  return { song: M.measure(b).lufs, assets: Object.keys(window.overdub.store.get().assets).length };
});
const beforeRender = await page.evaluate(async () => { const M = await import('/app/src/audio/measure.js'); return M.measure(await window.overdub.engine.render({ from: 0, to: 32, tail: 1 })).lufs; });
await page.evaluate(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
const dr = await dropAt('.rf', '__darkWav', 'darker copy.wav', 'audio/wav', { x: 60, y: 40 });
ok(dr.inside, `the drop lands on the Reference tab (${dr.hit})`);
await waitFor(() => !!window.overdub.store.get().reference, null, 30000);
const ref1 = await page.evaluate(() => { const s = window.overdub.store; const r = s.get().reference; return r && { name: r.name, by: r.by, lufs: r.profile?.lufs, bands: r.profile?.bands, centroid: r.profile?.centroid, tracks: s.get().tracks.length, assets: Object.keys(s.get().assets).length, last: s.history[s.history.length - 1]?.label }; });
ok(ref1 && ref1.name === 'darker copy.wav' && ref1.by === 'you' && Number.isFinite(ref1.lufs) && ref1.lufs > -60 && ref1.bands && ref1.centroid > 0, `a file dropped on the Reference tab is measured once and kept (${ref1?.lufs} LUFS, centre ${ref1?.centroid} Hz)`);
ok(ref1 && /reference: darker copy\.wav/.test(ref1.last) && ref1.assets === prep.assets, 'one undo step by you, and it is not an audio clip or a track asset');
const afterRender = await page.evaluate(async () => { const M = await import('/app/src/audio/measure.js'); return M.measure(await window.overdub.engine.render({ from: 0, to: 32, tail: 1 })).lufs; });
ok(near(beforeRender, afterRender, 0.05), `the reference is not in the song's render (${beforeRender} → ${afterRender} LUFS)`);
const cmp1 = await page.evaluate(() => window.overdub.tools.run('compare_to_reference', { bars: [1, 8] }, { by: 'claude' }));
ok(!cmp1.error && cmp1.deltas.centroidPct > 8 && cmp1.deltas.bands.presence > 1.5 && cmp1.deltas.bands.air > 1.5, `against a darker copy the song reads brighter (centre ${cmp1.deltas?.centroidPct}%, presence ${cmp1.deltas?.bands?.presence} dB, air ${cmp1.deltas?.bands?.air} dB)${cmp1.error ? ': ' + cmp1.error : ''}`);
ok(/brighter/.test(cmp1.summary || '') && (cmp1.differences || []).some((x) => /vs the reference: (more present|airier)/.test(x)), 'in words: ' + cmp1.summary + ' | ' + (cmp1.differences || []).slice(0, 3).join(' | '));
await waitFor(() => !!window.overdub.reference.mix, null, 30000);
await page.evaluate(() => window.overdub.ui.show('reference'));
await new Promise((r) => setTimeout(r, 300));
const panel = await page.evaluate(() => ({ rows: document.querySelectorAll('.rf-row').length, mixBars: document.querySelectorAll('.rf-b-mix').length, sum: document.querySelector('.rf-sum')?.textContent || '', head: document.querySelector('.rf-id')?.textContent || '' }));
ok(panel.rows === 7 && panel.mixBars === 7 && /darker copy\.wav/.test(panel.head) && /Against/.test(panel.sum), `the tab shows the reference's profile beside the mix's (${panel.rows} bands; "${panel.sum.slice(0, 80)}")`);
await o.shot('imports-reference');

// a quieter copy (−6 dB), set directly: louder by ~6 LU, the same tone; A/B turns it up to match
const ref2 = await page.evaluate(async () => {
  const b = window.__songBuf, ch = [];
  for (let c = 0; c < b.numberOfChannels; c++) ch.push(b.getChannelData(c).map((v) => v * 0.5));
  const buf = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  ch.forEach((x, i) => buf.copyToChannel(x, i));
  return window.overdub.reference.set({ name: 'quieter copy', buffer: buf }, { quiet: true });
});
const cmp2 = await page.evaluate(() => window.overdub.tools.run('compare_to_reference', { bars: [1, 8] }, { by: 'claude' }));
ok(ref2.ok && near(cmp2.deltas?.lufs, 6.02, 0.1) && /6 LU louder/.test(cmp2.summary) && /close in tone/.test(cmp2.summary), `against a −6 dB copy: ${cmp2.deltas?.lufs} LU, "${cmp2.summary}"`);
// A/B: the match gain is the song's loudness minus the reference's, measured over the whole song
await page.evaluate(() => window.overdub.reference.measureMix());
const ab = await page.evaluate(async () => {
  const R = window.overdub.reference;
  const r = await R.ab.start('B');
  const s1 = R.ab.state;
  R.ab.side('A');
  const s2 = R.ab.state;
  const want = R.abMatch(R.mix.profile.lufs, window.overdub.store.get().reference.profile).db;
  const btn = document.querySelector('.rf-ab-b.on')?.textContent;
  R.ab.stop();
  window.overdub.engine.stop();
  return { r, s1, s2, want, btn, after: R.ab.state, playing: window.overdub.engine.playing };
});
ok(ab.r.ok && ab.s1?.side === 'B' && ab.s2?.side === 'A' && near(ab.s1.gainDb, ab.want, 0.01) && ab.want > 0 && ab.after === null, `A/B plays the reference loudness-matched (${ab.s1?.gainDb} dB), switches sides and stops (${JSON.stringify(ab.r)})`);
// undo puts the first reference back; and once more, no reference at all
const undone = await page.evaluate(() => { const s = window.overdub.store; s.undo(); const a = s.get().reference?.name; s.undo(); return [a, s.get().reference?.name || null]; });
ok(undone[0] === 'darker copy.wav' && undone[1] === null, `undo walks the reference back: ${JSON.stringify(undone)}`);

const errs = ours(o.errors);
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await o.close();
T.done();
