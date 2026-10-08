// Keys (sidechains) and Dim Switch (core.ducker: app/src/devices/builtin/ducker.js).
//
// The ops: insert.add and insert.set take key ({ track }, by id, name or $ref; null removes it), each with an exact
// inverse; a missing track, the insert's own track, a master insert and a loop are refused with nothing changed; a
// key whose track is removed stays, heard as silence, and undoing the removal brings it back; get_project says who
// keys what; an older reader's normInsert keeps a valid key and drops a bad one.
// The sound, on the canonical Node renderer: Dim Switch at its defaults with no key is bypass, bit for bit; keyed by
// a kick it reaches its depth within ATTACK + 1 ms of the kick and is within 1 dB of the way back at RELEASE +-10%; a
// muted kick still keys it, and so does one left out of a stem render; the key track's fader doesn't move the duck;
// a key to a missing track, and a loop in a hand-written song, are silence (the loop is reported); a key source after
// the keyed track in track order is still heard on the same block; NO KEY fires on the song's grid; FOLLOW follows
// the key's level; renders repeat bit for bit.
// In Chromium (QUIET, through tools/pw.js): the device check passes on the defaults and every preset, and renders a
// keyed effect keyed by its drum loop (keyed: deltaLU, grMaxDb; a key: true effect that ignores it is warned); the window's Key
// menu sets the key (one undo step, signed you), the mixer says "keyed by Kick", the live engine wires it (the key
// input on, and off again when the key track is removed), and the master's menu sets the clean ceiling. The browser's
// render agreeing with Node on a keyed scene is tools/golden-test.js's (scenes sidechain and master-clean).
//   node tools/sidechain-test.js
import { open, tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { createProject, normInsert, summarize } from '../app/src/core/project.js';
import { createStore } from '../app/src/core/store.js';
import { getDevice, presetParams, paramValues } from '../app/src/devices/registry.js';
import { kernelCore, kernelCompiler } from '../app/src/kernel/worklet.js';
import { kernelSpecs } from '../app/src/kernel/host.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { keyPlan } from '../app/src/engine/strip.js';
import { scenes } from './golden-scenes.js';
import '../app/src/devices/builtin/index.js';

const T = tally('sidechain');
const ok = T.ok;
const SR = 48000;
const STAMP = '2026-10-07T00:00:00.000Z';

/* ======================================================================== the ops */
console.log('ops');
const base = () => ({ ...createProject(), id: 'p_sc', title: 'sc', tempo: 120, key: null, meta: { created: STAMP, modified: STAMP, authors: {} },
  tracks: ['Kick', 'Bass', 'Pad'].map((name) => ({ id: 't_' + name.toLowerCase(), name, kind: 'instrument', instrument: { device: name === 'Kick' ? 'core.drums' : 'core.bass', params: {} }, inserts: [], clips: [], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'you' })) });
{
  const store = createStore(base(), { getDevice });
  const ins = (t, id) => store.get().tracks.find((x) => x.id === t).inserts.find((x) => x.id === id);
  let r = store.dispatch({ type: 'insert.add', track: 'Bass', insert: { device: 'core.ducker', key: { track: 'Kick' } }, ref: 'd' }, { by: 'claude', label: 'duck' });
  const d = r.ok && r.created.d;
  ok(r.ok && ins('t_bass', d).key && ins('t_bass', d).key.track === 't_kick', `insert.add takes a key by the track's name, stored by its id (${JSON.stringify(r.ok && ins('t_bass', d).key)})`);
  r = store.dispatch({ type: 'insert.set', track: 't_bass', insert: d, patch: { key: { track: 't_pad' } } }, { by: 'you', label: 'rekey' });
  ok(r.ok && ins('t_bass', d).key.track === 't_pad', 'insert.set moves the key to another track');
  store.undo();
  ok(ins('t_bass', d).key.track === 't_kick', 'and its undo puts the old key back exactly');
  r = store.dispatch({ type: 'insert.set', track: 't_bass', insert: d, patch: { key: null } }, { by: 'you', label: 'unkey' });
  ok(r.ok && !('key' in ins('t_bass', d)), 'key: null removes it (no field left behind)');
  store.undo();
  ok(ins('t_bass', d).key.track === 't_kick', '...and undo brings it back');
  const before = JSON.stringify(store.get());
  const refused = (op, re) => { const x = store.dispatch(op, { by: 'claude', label: 'bad' }); return !x.ok && re.test(x.error) && JSON.stringify(store.get()) === before ? x.error : false; };
  let e = refused({ type: 'insert.set', track: 't_bass', insert: d, patch: { key: { track: 'Nope' } } }, /no track "Nope"/);
  ok(e, `a key naming no track is refused, nothing changed ("${e}")`);
  e = refused({ type: 'insert.set', track: 't_bass', insert: d, patch: { key: { track: 't_bass' } } }, /can't key itself/);
  ok(e, `a track keying itself is refused ("${e}")`);
  e = refused({ type: 'insert.add', track: 'master', insert: { device: 'core.ducker', key: { track: 't_kick' } } }, /master insert can't take a key/);
  ok(e, `a key on a master insert is refused ("${e}")`);
  e = refused({ type: 'insert.add', track: 't_kick', insert: { device: 'core.ducker', key: { track: 't_bass' } } }, /would make a loop/);
  ok(e, `a key that closes a loop (Bass keyed by Kick, Kick keyed by Bass) is refused ("${e}")`);
  e = refused({ type: 'insert.add', track: 't_pad', insert: { device: 'core.clipper', key: { track: 't_kick' } } }, /has no key input/);
  ok(e, `a key on a device that hears none (Clip Lamp) is refused, so nothing says "keyed by" when nothing is ("${e}")`);
  // a longer loop: Pad keyed by Bass, then Kick keyed by Pad
  r = store.dispatch({ type: 'insert.add', track: 't_pad', insert: { device: 'core.ducker', key: { track: 't_bass' } }, ref: 'p' }, { by: 'claude', label: 'pad duck' });
  const b2 = JSON.stringify(store.get());
  const x = store.dispatch({ type: 'insert.add', track: 't_kick', insert: { device: 'core.ducker', key: { track: 't_pad' } } }, { by: 'claude', label: 'bad' });
  ok(r.ok && !x.ok && /loop/.test(x.error) && JSON.stringify(store.get()) === b2, 'a loop through three tracks (Kick -> Bass -> Pad -> Kick) is refused too');
  ok(!store.dispatch({ type: 'insert.set', track: 't_bass', insert: d, patch: { key: 'Kick' } }, { by: 'claude' }).ok, 'a key that is not { track } is refused');
  // a key and a $ref in one call
  r = store.dispatch([{ type: 'track.add', ref: 'g', track: { name: 'Ghost', instrument: { device: 'core.drums' } } }, { type: 'insert.add', track: 't_pad', insert: { device: 'core.ducker', key: { track: '$g' } }, ref: 'q' }], { by: 'claude', label: 'ghost' });
  ok(r.ok && ins('t_pad', r.created.q).key.track === r.created.g, 'a key can name a track made earlier in the same call ($ref)');
  store.undo();
  // the key track removed: the key stays, says so, and undo brings the track back under it
  r = store.dispatch({ type: 'track.remove', track: 't_kick' }, { by: 'you', label: 'rm kick' });
  const text = summarize(store.get());
  ok(r.ok && ins('t_bass', d).key.track === 't_kick' && /key track missing: t_kick/.test(text), 'removing the key track leaves the key in the song; get_project says "key track missing"');
  ok(keyPlan(store.get()).keyOf.get(d) === null, '...and the renderers hear it as silence (keyPlan: no source)');
  store.undo();
  ok(store.get().tracks.some((t) => t.id === 't_kick') && /keyed by t_kick "Kick"/.test(summarize(store.get())), 'undoing the removal brings the key track back; get_project: keyed by t_kick "Kick"');
  // older readers and bad files
  ok(!('key' in normInsert({ id: 'fx_a', device: 'core.ducker', key: 'Kick' })) && !('key' in normInsert({ id: 'fx_a', device: 'core.ducker', key: { track: 5 } })), 'normInsert drops a key that is not { track: "<id>" }');
  ok(JSON.stringify(normInsert({ id: 'fx_a', device: 'core.eq', on: true, params: {}, by: 'you' })) === '{"id":"fx_a","device":"core.eq","on":true,"params":{},"by":"you"}', 'an insert without a key is exactly as before (no new field)');
  // master.clip
  r = store.dispatch({ type: 'master.set', patch: { clip: 'clean' } }, { by: 'claude', label: 'clean' });
  ok(r.ok && store.get().master.clip === 'clean', 'master.set { clip: "clean" }');
  store.undo();
  ok(!('clip' in store.get().master), '...and its undo puts the master back to the soft clip (no field: what every older song has)');
  ok(!store.dispatch({ type: 'master.set', patch: { clip: 'loud' } }, { by: 'claude' }).ok, 'a master clip that is neither "soft" nor "clean" is refused');
}

/* ======================================================================== Dim Switch, rendered */
console.log('Dim Switch');
const def = getDevice('core.ducker');
ok(def && def.kind === 'effect' && def.key === true && def.name === 'Dim Switch' && def.cat === 'dynamics', `core.ducker is registered: ${def?.name}, a keyed effect (key: true)`);
ok(['mode', 'depth', 'attack', 'hold', 'release', 'curve', 'thresh', 'key_lo', 'key_hi', 'nokey', 'mix'].join() === def.params.map((p) => p.key).join() && def.params.every((p) => p.desc), 'its params, in order, each with a meaning');
ok(['Kick duck', 'Kick and snare duck', 'Gentle pump', 'Hard pump (riddim)', 'Bus breathe'].every((n) => def.presets.some((p) => p.name === n)) && def.presets.every((p) => p.tags && p.tags.includes('bass-music')), `its presets, tagged bass-music (${def.presets.map((p) => p.name).join(', ')})`);
// the defaults are bypass: the golden scene's render is the dry strum's
{
  const s = scenes().find((x) => x.name === 'fx:core.ducker');
  const wet = sha256(renderSong(s.project, { ...s.opts, assets: s.assets }));
  const dry = JSON.parse(JSON.stringify(s.project)); dry.tracks[0].inserts = [];
  ok(wet === sha256(renderSong(dry, { ...s.opts, assets: s.assets })), 'at its defaults with no key it is bypass, bit for bit (fx:core.ducker renders the dry strum)');
}

// a song: a steady level (a DC "tone" of 0.25, an audio clip, so the output over it is the gain, sample for sample)
// through Dim Switch keyed by a kick track playing every beat
const TONE = new Float32Array(5 * SR).fill(0.25);
const minOf = (a) => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; };
const maxOf = (a) => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
function song(params, { key = { track: 't_kick' }, kickMute = false, kickGain = 0, tempo = 120, on = true, order = 'kick-first', kicks = null, kickVel = 1 } = {}) {
  const k = { id: 't_kick', name: 'Kick', kind: 'instrument', instrument: { device: 'core.drums', params: {} }, inserts: [],
    clips: [{ id: 'c_k', kind: 'notes', start: 0, length: 8, notes: (kicks || [0, 1, 2, 3, 4, 5, 6, 7]).map((t, i) => ({ id: 'n' + i, p: 36, t, d: 0.25, v: kickVel, by: 'you' })), by: 'you' }],
    gain: kickGain, pan: 0, mute: kickMute, solo: false, arm: false, by: 'you' };
  const b = { id: 't_tone', name: 'Tone', kind: 'audio', instrument: null, inserts: [{ id: 'fx_d', device: 'core.ducker', on, params, ...(key ? { key } : {}), by: 'you' }],
    clips: [{ id: 'c_t', kind: 'audio', start: 0, length: 8, asset: 'a_t', offset: 0, gain: 0, by: 'you' }], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'you' };
  return { ...createProject(), id: 'p_d', tempo, key: null, meta: { created: STAMP, modified: STAMP, authors: {} },
    assets: { a_t: { kind: 'audio', name: 'tone', sr: SR, channels: 1, duration: 5 } }, tracks: order === 'kick-first' ? [k, b] : [b, k] };
}
const ASSETS = { a_t: { sr: SR, channels: [TONE] } };
const render = (p, o = {}) => renderSong(p, { from: 0, to: 8, tail: 0, assets: ASSETS, ...o });
// the tone's gain a sample (dB), from a stem of it alone
function gainCurve(r) {
  const x = r.channels[0], out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = 20 * Math.log10(Math.abs(x[i]) / 0.25 + 1e-12);
  return out;
}
{
  // (the key heard whole, KEY LOW 20 Hz to KEY HIGH 20 kHz, for the timing: a narrower band adds its filters' delay)
  const P = { ...presetParams(def, 'Kick duck'), key_lo: 20, key_hi: 20000 };
  const r = render(song(P), { tracks: ['Tone'] });
  const g = gainCurve(r);
  // the kick at beat 2 (1.000 s): its onset is where the kick track first crosses THRESH there (what sets it off)
  const kr = render(song(P), { tracks: ['Kick'] }).channels[0];
  const at = 1.0 * SR, thr = Math.pow(10, P.thresh / 20);
  let onset = at; while (onset < at + 0.05 * SR && Math.abs(kr[onset]) < thr) onset++;
  let reach = onset; while (reach < onset + 0.1 * SR && g[reach] > -(P.depth - 0.5)) reach++;
  const reachMs = (reach - onset) / SR * 1000;
  ok(reachMs <= P.attack + 1, `keyed by a kick it reaches its depth (${P.depth} dB) ${reachMs.toFixed(2)} ms after the kick's onset (ATTACK ${P.attack} ms + 1)`);
  const minG = minOf(g.subarray(onset, onset + 0.05 * SR));
  ok(Math.abs(minG + P.depth) < 0.3, `it dips by DEPTH: ${minG.toFixed(2)} dB`);
  // back: the release starts after ATTACK + HOLD; within 1 dB of the way back at RELEASE +- 10% (CURVE 0)
  const P0 = { ...P, curve: 0 };
  const g0 = gainCurve(render(song(P0), { tracks: ['Tone'] }));
  const relStart = onset + Math.round((P0.attack + P0.hold) * SR / 1000);
  let back = relStart; while (back < relStart + SR && g0[back] < -1) back++;
  const backMs = (back - relStart) / SR * 1000;
  ok(backMs >= 0.9 * P0.release && backMs <= 1.1 * P0.release, `it is within 1 dB of the way back ${backMs.toFixed(1)} ms into its release (RELEASE ${P0.release} ms +- 10%)`);
  ok(maxOf(g0.subarray(relStart + Math.round(P0.release * SR / 1000) + 300, relStart + Math.round(P0.release * SR / 1000) + 2000)) > -0.05, 'and all the way back by RELEASE');
  // a muted kick still keys it; so does one left out of the render (a stem); the kick's fader doesn't move the duck
  const h = sha256(r);
  ok(sha256(render(song(P, { kickMute: true }), { tracks: ['Tone'] })) === h, 'a muted kick still keys it: the same samples as an unmuted one');
  const mix = render(song(P, { kickMute: true }));
  ok(sha256(mix) === h, 'the whole mix with the kick muted is the tone alone, ducked: the key source is rendered, not heard');
  ok(sha256(render(song(P, { kickGain: -20 }), { tracks: ['Tone'] })) === h, 'the kick\'s fader (-20 dB) doesn\'t change the duck: the key is before the fader');
  ok(sha256(render(song(P, { order: 'tone-first' }), { tracks: ['Tone'] })) === h, 'a key source after the keyed track in track order is heard on the same block (rendered first)');
  ok(sha256(render(song(P))) === sha256(render(song(P))), 'renders repeat bit for bit');
  // no key: silence, no duck
  const nk = render(song(P, { key: { track: 't_gone' } }), { tracks: ['Tone'] });
  ok(minOf(gainCurve(nk).subarray(2000, 3.9 * SR)) > -0.05 && !nk.warnings.length, 'a key to a track that is not in the song hears silence: no duck, no warning');
  const off = render(song(P, { on: false }), { tracks: ['Tone'] });
  ok(minOf(gainCurve(off).subarray(2000, 3.9 * SR)) > -0.05, 'bypassed, it passes the tone untouched');
  // a loop written into a file by hand: cut, reported, silence
  const loop = song(P);
  loop.tracks[0].inserts = [{ id: 'fx_k', device: 'core.ducker', on: true, params: P, key: { track: 't_tone' }, by: 'you' }];
  const lr = render(loop);
  ok(lr.warnings.some((w) => w.kind === 'key' && /loop/.test(w.message)), `a loop in a hand-written song is cut and reported ("${(lr.warnings.find((w) => w.kind === 'key') || {}).message}")`);
  // NO KEY: on the song's grid
  const grid = gainCurve(render(song({ ...P, nokey: 1 }, { key: null, tempo: 120 }), { tracks: ['Tone'] }));
  const dipAt = (sec) => minOf(grid.subarray(Math.round(sec * SR), Math.round((sec + 0.02) * SR)));
  ok([1, 1.5, 2, 2.5].every((s) => dipAt(s) < -9) && dipAt(1.3) > -6, `NO KEY 1/4: it dips on every beat of the song (at 120 bpm: ${[1, 1.5, 2].map((s) => dipAt(s).toFixed(1)).join(', ')} dB), not between`);
  ok(minOf(gainCurve(render(song({ ...P, nokey: 0 }, { key: null }), { tracks: ['Tone'] })).subarray(2000, 3.9 * SR)) > -0.05, 'NO KEY OFF with no key: no duck');
  // FOLLOW: louder key, deeper duck (dB for dB over THRESH, at most DEPTH)
  const FP = { ...P, mode: 1, depth: 30, thresh: -40, attack: 1, release: 50 };
  const fol = (vel) => minOf(gainCurve(render(song(FP, { kickVel: vel }), { tracks: ['Tone'] })).subarray(Math.round(1 * SR), Math.round(1.1 * SR)));
  const loud = fol(1), soft = fol(0.25);
  ok(loud < -10 && loud < soft - 1, `FOLLOW follows the key's level: ${loud.toFixed(1)} dB under a full kick, ${soft.toFixed(1)} dB under a quieter one`);
  // MIX 0: dry
  ok(minOf(gainCurve(render(song({ ...P, mix: 0 }), { tracks: ['Tone'] })).subarray(2000, 3.9 * SR)) > -0.05, 'MIX 0% is the dry sound');
}

/* ======================================================================== keyPlan */
{
  const p = { tracks: [{ id: 'a', inserts: [{ id: 'x1', device: 'core.ducker', key: { track: 'c' } }] }, { id: 'b', inserts: [] }, { id: 'c', inserts: [{ id: 'x2', device: 'core.ducker', key: { track: 'b' } }] }] };
  const plan = keyPlan(p);
  ok(plan.order.join() === 'b,c,a', `keyPlan orders key sources first, otherwise in track order (${plan.order.join(', ')})`);
  const q = { tracks: [{ id: 'a', inserts: [{ id: 'x1', device: 'core.eq', key: { track: 'b' } }] }, { id: 'b', inserts: [] }] };
  ok(keyPlan(q).order.join() === 'a,b' && !keyPlan(q).keyOf.has('x1'), 'a key on a device that takes none is ignored (track order kept)');
  const heard = { a: true, b: false, c: false };
  ok([...keyPlan(p, { heard }).needed].sort().join() === 'a,b,c', 'a heard track needs its key sources, and theirs');
}

{
  // live, a kernel with nothing coming in dozes (worklet.js idle); a keyed one counts its key as coming in, so a duck
  // that a kick set off while the bass rested is where a render has it when the bass comes back in
  const def = getDevice('core.ducker'), K = kernelCore(SR, makeDsp(SR), kernelCompiler);
  const mk = (idle) => new K({ source: def.kernel, kind: 'effect', params: kernelSpecs(def), values: paramValues(def, { ...presetParams(def, 'Kick duck'), release: 1500 }), seed: 7,
    transport: { bpm: 120, playing: true, beat: 0, time: 0 }, key: true, keyOn: true, idle, tail: def.tail }, () => {});
  const live = mk(true), ren = mk(false);
  const n = 128, iL = new Float32Array(n), iR = new Float32Array(n), kL = new Float32Array(n), a = [new Float32Array(n), new Float32Array(n)], b = [new Float32Array(n), new Float32Array(n)];
  let worst = 0, dozed = false;
  for (let blk = 0; blk < 600; blk++) {
    const f0 = blk * n;
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      // the bass rests for 1.3 s; a kick every half second all along (a decaying 55 Hz burst)
      iL[i] = iR[i] = f > 1.3 * SR ? 0.3 * Math.sin(2 * Math.PI * 41 * f / SR) : 0;
      const k = f % (SR / 2); kL[i] = k < 0.15 * SR ? 0.9 * Math.sin(2 * Math.PI * 55 * k / SR) * Math.exp(-k / (0.04 * SR)) : 0;
    }
    live.block(iL, iR, a[0], a[1], f0, kL, kL); ren.block(iL, iR, b[0], b[1], f0, kL, kL);
    dozed = dozed || live.dozing;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(a[0][i] - b[0][i]));
  }
  ok(worst === 0 && !dozed, `live, a keyed Dim Switch stays awake while its key plays through the bass's rests: the same samples as a render when the bass comes back (worst difference ${worst})`);
}

/* ======================================================================== the studio (Chromium, QUIET) */
console.log('the studio');
const { page, close, errors } = await open('/app/', { query: 'new' });
try {
  await page.waitForFunction(() => window.overdub && window.overdub.store && window.overdub.plugin, null, { timeout: 30000 });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const chk = await E(async () => {
    const { checkDevice } = await import('/app/src/kernel/check.js');
    const reg = await import('/app/src/devices/registry.js');
    const d = reg.getDevice('core.ducker');
    const r0 = await checkDevice(d, { quick: true });
    const pre = [];
    for (const pr of d.presets) {
      const pd = { ...d, id: 'core.ducker-preset', params: d.params.map((p) => ({ ...p, def: pr.params[p.key] ?? p.def })) };
      const r = await checkDevice(pd, { quick: true });
      pre.push({ name: pr.name, ok: r.ok, errors: r.errors, tp: r.truePeak });
    }
    // (R5) an effect whose def says key: true and never reads it is warned about
    const deaf = await checkDevice({ id: 'you.deaf', name: 'Deaf', kind: 'effect', key: true, params: [], kernel: '({ create() { return { process(L, R, n) {} }; } })' }, { quick: true });
    return { ok: r0.ok, errors: r0.errors, dLU: r0.level?.deltaLU, keyed: r0.keyed, pre, deaf: { keyed: deaf.keyed, warned: deaf.warnings.some((x) => /^key:/.test(x)) } };
  });
  ok(chk.keyed && chk.keyed.grMaxDb >= 10 && chk.keyed.deltaLU < -0.5, `the device check renders a keyed effect keyed too (the DI strum keyed by the drum loop): Dim Switch dips ${chk.keyed && chk.keyed.grMaxDb} dB at most, ${chk.keyed && chk.keyed.deltaLU} LU overall`);
  ok(chk.deaf.keyed && chk.deaf.keyed.grMaxDb === 0 && chk.deaf.warned, `...and warns about a key: true effect that ignores its key (${JSON.stringify(chk.deaf.keyed)})`);
  ok(chk.ok && Math.abs(chk.dLU) <= 0.1, `the device check passes at the defaults, at bypass level (${chk.dLU} LU)${chk.errors?.length ? ': ' + chk.errors.join(' | ') : ''}`);
  ok(chk.pre.every((x) => x.ok), `...and on every preset (${chk.pre.length})${chk.pre.filter((x) => !x.ok).map((x) => ` ${x.name}: ${x.errors.join(' | ')}`).join(';')}`);
  // a song with a kick and a bass; the window's Key menu
  const ids = await E(async () => {
    const a = window.overdub;
    const r = a.store.dispatch([{ type: 'track.add', ref: 'k', track: { name: 'Kick', instrument: { device: 'core.drums' } } }, { type: 'track.add', ref: 'b', track: { name: 'Sub', instrument: { device: 'core.bass' } } }, { type: 'insert.add', track: '$b', insert: { device: 'core.ducker', preset: 'Kick duck' }, ref: 'd' }], { by: 'you', label: 'setup' });
    a.plugin.open({ track: r.created.b, slot: r.created.d });
    for (let i = 0; i < 80 && !document.querySelector('.pw .pw-keypick'); i++) await new Promise((res) => setTimeout(res, 25));
    return { k: r.created.k, b: r.created.b, d: r.created.d, opts: [...document.querySelectorAll('.pw .pw-keypick option')].map((o) => o.textContent) };
  });
  ok(ids.opts.join('|') === 'No key|Kick', `Dim Switch's window has a Key menu listing the song's other tracks (${ids.opts.join(', ')})`);
  await page.selectOption('.pw .pw-keypick', ids.k);
  await new Promise((res) => setTimeout(res, 400));
  const after = await E(({ b, d }) => { const a = window.overdub; const h = a.store.history[a.store.history.length - 1]; const x = a.store.get().tracks.find((t) => t.id === b).inserts.find((i) => i.id === d); return { key: x.key, by: h.by, label: h.label }; }, ids);
  ok(after.key && after.key.track === ids.k && after.by === 'you', `picking Kick sets the key, one step signed you ("${after.label}")`);
  await E(() => window.overdub.ui.show('mixer'));
  await new Promise((res) => setTimeout(res, 400));
  const line = await E(() => [...document.querySelectorAll('.mx-keyed')].map((x) => x.textContent));
  ok(line.includes('keyed by Kick'), `the mixer says it, in plain text: "${line.join(', ')}"`);
  // the live engine wires it
  await E(() => window.overdub.engine.start && window.overdub.engine.start());
  const wired = async () => E(async ({ b, d }) => { const a = window.overdub; for (let i = 0; i < 60; i++) { const inst = a.engine.instance(b, d); if (inst && inst.keyInput) return { on: inst.keyOn }; await new Promise((r) => setTimeout(r, 50)); } return null; }, ids);
  let w = await wired();
  ok(w && w.on === true, `the live engine wires the key to the Kick's sound (key on: ${w && w.on})`);
  await E(({ k }) => window.overdub.store.dispatch({ type: 'track.remove', track: k }, { by: 'you', label: 'rm' }), ids);
  await new Promise((res) => setTimeout(res, 500));
  w = await wired();
  ok(w && w.on === false, 'removing the Kick leaves Dim Switch unkeyed (silence)');
  await E(() => window.overdub.store.undo());
  await new Promise((res) => setTimeout(res, 800));
  w = await wired();
  ok(w && w.on === true, '...and undoing it wires the key again');
  // the master's clean ceiling
  const mc = await E(async () => { const a = window.overdub; a.store.dispatch({ type: 'master.set', patch: { clip: 'clean' } }, { by: 'you', label: 'clean' }); await new Promise((r) => setTimeout(r, 300)); return a.store.get().master.clip; });
  ok(mc === 'clean', 'master.set clip clean from the studio');
  ok(!errors.filter((e) => !/Failed to load resource|favicon|net::ERR|AudioContext/.test(e)).length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally {
  await close();
}
T.done();
