// The sound card: "What should this sound like?" (docs/INSTRUMENTS-UX.md, 1.3, 2.2 and 3.2). A track's sound is picked
// by ear: the card lists its take on a few fitting instruments, a row tried is heard at once, and nothing is kept until
// the person says so. It has no panel of its own; it alone decides when the card opens (Sketch only says where).
//
//   app.sounds = {
//     setHost(fn)            Sketch registers fn({ track, take }) -> an element to hold the card (its stage, its phone
//                            sheet) or null. Asked when a take offers the card; null puts it under the track's header.
//     offer({ track, from: 'take' | 'header' | 'window' | 'browser' | 'find' | 'agent', anchor?, take?, focus? }) -> { ok }
//                            open the card. take: { kind: 'notes' | 'drums', src?: 'hum' | ..., notes?, start, end,
//                            committed?, tune?: { on, set(on) } }; a take not committed (Sketch before Keep) with no
//                            track tries sounds on the track the Keep would make (tryNew).
//     try(track, { device, preset? }, { play = true, from, suggestedBy } = {}) -> { ok, error?, now? }
//                            a preview (store.preview): applied, never in History; replaces the last trial
//     tryNew(take, { device, preset? }) -> { ok, track? }   an uncommitted take's preview track (a track.add preview)
//     takeNew() -> { name, device, preset, params } | null   Sketch's Keep: the previewed new track let go of, and what
//                            the Keep should make in its own transaction (track, clip and sound in one undo step)
//     keep({ reason?, why? } = {}) -> dispatch result | null  the trial as one instrument.set by you (no audition flag)
//     back({ why?, quiet? } = {}) -> boolean                  the track plays what it played before; nothing in History
//     keepIfTrying(track, { why }) -> boolean                  recording, a control of the tried device touched
//     trying() -> { track, device, preset, name, was, newTrack, from } | null
//     pending(track) -> boolean   a new track whose card hasn't been opened yet (the header's Sounds, shown pending)
//     toastLine(made) -> node | null   the recorder's take toast asks for its second line
//     suggest(track, sounds, { by, reason }) -> { ok, id, track, sounds } | { error, hint }   suggest_sounds' path
//     result(id) -> { status: 'pending' } | { picked, kept } | null ; wait(id, ms) -> Promise of the same
//     newPart(kind) -> { name, device }   what a take of this kind makes (core/sounds.js newPartFor)
//     close() ; current -> { track, rows, from } | null ; setsFor(track, take?) -> rows
//   }
//   ui events: 'sounds' { trying, pending } after any change (the arranger's headers, the browser's trial bar redraw)
//
// What ends a trial, and what it says (1.3): Back and Esc ("Back to Lamp Tines."); Keep and Enter; recording onto the
// track (kept first, said as it happens); a control of the tried device touched (kept first); an undo or redo that
// touches the track (Back first, so the release can't overwrite what the undo put back); an agent tool that reads or
// changes the song (Back first, the card says why); anything else (another track selected, the browser's pane closed
// on a browser trial, the page hidden: Back with a toast and Keep it; the track removed or another song: Back, no Keep
// it). A click outside the card never ends a trial. While a trial is applied, overdub:sound-trying names the track's
// real instrument (or the previewed new track), so a tab that closed mid-trial is healed on the next boot.
//
// The store is wrapped here (dispatch, undo, redo, revertAuthor, load) only to end a trial first, in the right order:
// nothing else about a change is touched.

import { h, css, icon, byline } from './dom.js';
import { swatchOf, presetNow } from './rack.js';
import { isDrumTrack } from './arrange-kit.js';
import { presetParams } from '../devices/registry.js';
import { beatsPerBar } from '../core/music.js';

export const TRYING_KEY = 'overdub:sound-trying';
const REST_MS = 150;          // an arrow key rests this long on a row before it is tried
// the agent tools that don't read the song: they leave a trial on (as propose_variations' rule)
const QUIET_TOOLS = new Set(['suggest_sounds', 'get_variation_result', 'say', 'ask_human', 'get_recording', 'highlight']);
const CAT_OF = { hum: 'keys', played: 'keys', chords: 'keys', bass: 'bass', drums: 'drums' };
const ASIDE = { hum: 'Your hum', played: 'What you played', chords: 'Your chords', bass: 'Your bass line', drums: 'Your beat' };
const HEARD = { hum: 'your hum', played: 'what you played', chords: 'your chords', bass: 'your bass line', drums: 'your beat' };

export default async function (app) {
  // core/sounds.js (the sets, kindOfTake, soundsFor, familyOf, newPartFor) is WP1's; until it is in the tree the same
  // rules from the spec stand in (FALLBACK, below)
  let S = null;
  try { S = await import('../core/sounds.js'); if (typeof S?.soundsFor !== 'function') S = null; } catch (e) { S = null; }
  installSounds(app, S || FALLBACK);
}

function installSounds(app, S) {
  const { store, ui } = app;
  const engine = () => app.engine;
  css('ew-sounds', SOUNDS_CSS);
  const PHONE = window.matchMedia('(max-width: 900px)');
  const phone = () => PHONE.matches;
  const view = () => ui.workspace?.view?.() || 'full';
  // (a phone has no Space bar to name)
  const stops = () => (phone() || (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) ? 'Tap ■ (top) to stop.' : 'Space stops.');
  const P = () => store.get();
  const dev = (id) => { try { return app.devices.getDevice(id) || null; } catch (e) { return null; } };
  const has = (id) => dev(id)?.kind === 'instrument';
  const agentName = (by = 'claude') => { try { return store.author?.(by)?.name || 'Claude'; } catch (e) { return 'Claude'; } };
  const bpb = () => beatsPerBar(P().meter);
  const trackOf = (id) => (id ? P().tracks.find((t) => t.id === id) || null : null);
  const nameOf = (device, preset) => { const d = dev(device); const n = d?.name || String(device || '').replace(/^[a-z]+\./, ''); return preset ? `${n}, ${preset}` : n; };
  const same = (a, b) => !!a && !!b && a.device === b.device && (a.preset || null) === (b.preset || null);

  let hostFn = null;
  let trial = null;     // { track, device, preset, name, was: { device, preset, name, inst }, handle, from, suggestedBy, sid, newTrack, take, at }
  let newH = null;      // the previewed new track (track.add) while an uncommitted take's card is up: { handle, track, take }
  let loopH = null;     // the loop held round the take while the card plays it
  let card = null;      // the card on screen
  const pendingSet = new Set();
  const opened = new Set();
  const sugg = new Map();       // track id ('new' for an uncommitted take) -> [{ device, preset, why, by, sid }]
  const requests = new Map();   // suggest_sounds id -> { status, track, rows, picked, kept, waiters }
  let seq = 0, mine = 0, skipOffer = 0, wasHum = false;
  let picking = 0, follow = false;   // follow: a trial from outside the card (the browser, the agent, app.sounds.try) moves its focus there

  const emit = () => ui.emit('sounds', { trying: api.trying(), pending: [...pendingSet] });

  /* ---------------------------------------------------------------- the track's sound, now */
  function realOf(t) {
    const pn = presetNow(app, t.id, 'instrument');
    const device = t.instrument?.device || null;
    const preset = pn && pn.name && !pn.edited ? pn.name : null;
    return { device, preset, name: nameOf(device), inst: JSON.parse(JSON.stringify(t.instrument || null)) };
  }
  // what a take is, for the sets (core/sounds.js kindOfTake): from Sketch's take, or the track's own notes
  function takeOf(track, take) {
    if (take) { const k = kindOfTakeKind(take); return { kind: k === 'pads' ? 'drums' : 'notes', src: take.src || (k === 'hum' ? 'hum' : null), notes: Array.isArray(take.notes) ? take.notes : take.capture ? (app.input?.capture?.phraseNotes?.(take.capture)?.notes || []) : [] }; }
    const t = trackOf(track);
    if (!t) return { kind: 'notes', src: null, notes: [] };
    const notes = [];
    for (const c of t.clips) if (c.kind === 'notes' && !c.mute) for (const n of c.notes) { notes.push({ p: n.p, t: c.start + n.t, d: n.d }); if (notes.length > 400) break; }
    return { kind: isDrumTrack(app, t) ? 'drums' : 'notes', src: null, notes };
  }
  function kindOf(track, take) { try { return S.kindOfTake(takeOf(track, take)) || 'played'; } catch (e) { return 'played'; } }
  function familyOf(row, def) { try { return S.familyOf(row, def) || ''; } catch (e) { return ''; } }
  // a device's family word from any set's rows ("core.wavetable" -> "Synth"), for a sound named off its own set
  function famOfDevice(device) {
    const sets = S.SOUND_SETS || {};
    for (const k of Object.keys(sets)) for (const r of [...(sets[k].rows || []), ...(sets[k].fallbacks || [])]) if (r.device === device && !r.preset && r.family) return r.family;
    for (const k of Object.keys(sets)) for (const r of [...(sets[k].rows || []), ...(sets[k].fallbacks || [])]) if (r.device === device && r.family) return r.family;
    return '';
  }
  // the rows: what it plays now first, then the house's (from the set) with the agent's suggestions replacing them from
  // the bottom; four besides "now" at the most, none twice (device and preset)
  function setsFor(track, take = null) {
    const t = trackOf(track);
    // (during a trial the song plays the trial: "now" is what it played before)
    const cur = trial && !trial.newTrack && trial.track === track ? trial.was : t ? realOf(t) : newPart(kindOfTakeKind(take));
    const now = { device: cur.device, preset: cur.preset || null, now: true };
    let list = [];
    try { list = S.soundsFor(takeOf(track, take), { has, current: now.device, currentPreset: now.preset }) || []; } catch (e) { list = []; }
    // ("now" is named for its family the way the set's rows are, "Electric piano", even off the set or on a preset)
    now.family = famOfDevice(now.device) || list.find((r) => r.now)?.family || '';
    // (a house row with no preset is the device as it comes: the same sound as "now" on that device, so not listed twice)
    const dup = (r) => same(r, now) || (r.device === now.device && !r.preset && !r.by);
    const ag = (sugg.get(track || 'new') || []).filter((r) => has(r.device) && !same(r, now)).slice(-4);
    // (a sound the agent suggested is its row, signed, even when the house would have listed it)
    const house = list.map((r) => ({ device: r.device, preset: r.preset || null, family: r.family || null, set: r.set || null })).filter((r) => has(r.device) && !dup(r) && !ag.some((x) => same(x, r)));
    const out = [now];
    for (const r of [...house.slice(0, Math.max(0, Math.min(house.length, 4 - ag.length))), ...ag]) if (!out.some((x) => same(x, r))) out.push(r);
    // a sound on trial from elsewhere (the browser, the agent) is on the card too, after "now"
    const tr = trial && (track ? !trial.newTrack && trial.track === track : trial.newTrack);
    if (tr && !out.some((x) => same(x, trial))) { out.splice(1, 0, { device: trial.device, preset: trial.preset || null }); if (out.length > 5) out.pop(); }
    const rows = out.slice(0, 5).map((r) => {
      const d = dev(r.device);
      return { ...r, name: nameOf(r.device, r.preset), def: d, family: r.family || famOfDevice(r.device) || familyOf(r, d) };
    });
    return rows;
  }
  // (Sketch names a take by its aim, 'hum' | 'pads' | 'keys'; the recorder's commit by what it holds, 'drums' | 'notes')
  const DRUM_SRC = new Set(['tap', 'pads', 'beatbox']);
  function kindOfTakeKind(take) { return take?.kind === 'drums' || take?.kind === 'pads' || DRUM_SRC.has(take?.src) ? 'pads' : take?.src === 'hum' || take?.kind === 'hum' ? 'hum' : 'keys'; }
  function newPart(kind) {
    try { const r = S.newPartFor(kind, P()); if (r?.device) return { name: r.name, device: r.device, preset: null }; } catch (e) { /* below */ }
    return kind === 'pads' ? { name: 'Drums', device: 'core.drums', preset: null } : { name: kind === 'hum' ? 'Melody' : 'Keys', device: 'core.keys', preset: null };
  }

  /* ---------------------------------------------------------------- the leftover a closed tab can leave */
  // (a page going away lets its trial go as it hides, after the last autosave may have run: the key stays a moment
  // longer, so a tab that closes then is still healed; one that stays open forgets it)
  let forgetT = 0;
  const saveTrying = ({ defer = false } = {}) => {
    clearTimeout(forgetT);
    try {
      if (trial && !trial.newTrack) localStorage.setItem(TRYING_KEY, JSON.stringify({ song: P().id, track: trial.track, instrument: trial.was.inst, at: Date.now() }));
      else if (newH) localStorage.setItem(TRYING_KEY, JSON.stringify({ song: P().id, track: newH.track, newTrack: true, at: Date.now() }));
      else if (defer) forgetT = setTimeout(() => { if (!trial && !newH) { try { localStorage.removeItem(TRYING_KEY); } catch (e) { /* blocked */ } } }, 1500);
      else localStorage.removeItem(TRYING_KEY);
    } catch (e) { /* storage blocked: a closed tab can't leave a leftover either */ }
  };
  // On the next boot: the track's real instrument back, or the previewed new track out, with nothing in History (the
  // song never had them), as Grooves heals its "Hearing" track.
  function heal() {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(TRYING_KEY) || 'null'); } catch (e) { rec = null; }
    if (!rec) return;
    try { localStorage.removeItem(TRYING_KEY); } catch (e) { /* blocked */ }
    if (!rec || rec.song !== P().id) return;
    const t = trackOf(rec.track);
    if (!t) return;
    let ops = null;
    if (rec.newTrack) { if (!t.clips.length) ops = [{ type: 'track.remove', track: t.id }]; }
    else if (rec.instrument && t.kind === 'instrument' && JSON.stringify(t.instrument) !== JSON.stringify(rec.instrument)) ops = [{ type: 'instrument.set', track: t.id, _restore: rec.instrument }];
    if (!ops) return;
    const r = store.preview(ops, { by: 'overdub' });
    if (!r.ok) console.warn('overdub: a sound left on trial could not be put back', r.error);
  }
  if (document.documentElement.dataset.ready === '1') heal();
  else { const off = ui.on('ready', () => { off(); heal(); }); }

  /* ---------------------------------------------------------------- trials */
  function releaseHandle() {
    if (!trial?.handle) return;
    const hd = trial.handle;
    trial.handle = null;
    try { hd.release(); } catch (e) { console.error('sounds: release', e); }
  }
  function releaseLoop() { if (!loopH) return; const l = loopH; loopH = null; try { l.release(); } catch (e) { /* gone */ } }
  function releaseNew() {
    if (!newH) return;
    const n = newH; newH = null;
    try { n.handle.release(); } catch (e) { /* gone */ }
  }

  function tryOn(track, { device, preset = null } = {}, { play = true, from = null, suggestedBy = null, sid = null } = {}) {
    const t = trackOf(track);
    if (!t) return { ok: false, error: `no track "${track}"` };
    if (t.kind !== 'instrument') return { ok: false, error: `${t.name} is an audio track` };
    if (recording()) return { ok: false, error: 'the person is recording' };
    const def = dev(device);
    if (!def || def.kind !== 'instrument') return { ok: false, error: `no instrument "${device}"` };
    if (preset && !presetParams(def, preset)) return { ok: false, error: `no preset "${preset}" on ${def.name}` };
    if (trial && (trial.newTrack || trial.track !== track)) endTrial('switch', { quiet: true });
    // (a sound an agent suggested for this track is theirs however it is tried: the row, the browser, app.sounds.try)
    if (!suggestedBy) { const sg = (sugg.get(track) || []).find((x) => same(x, { device, preset })); if (sg) { suggestedBy = sg.by || null; sid = sid || sg.sid || null; } }
    const real = trial ? trial.was : realOf(t);
    if (same({ device, preset }, real)) { if (trial) endTrial('now', { quiet: true }); render(); emit(); return { ok: true, now: true }; }
    releaseHandle();
    const params = preset ? presetParams(def, preset) : null;
    const op = { type: 'instrument.set', track, device, ...(params ? { params } : {}) };
    const hd = store.preview(op, { by: 'you' });
    if (!hd.ok) { if (trial) { trial = null; saveTrying(); } render(); emit(); return { ok: false, error: hd.error }; }
    trial = { track, device, preset, name: nameOf(device, preset), was: real, handle: hd, from: from || card?.from || 'card', suggestedBy, sid, newTrack: false, at: Date.now() };
    if (!picking) follow = true;
    if (sid && requests.has(sid)) requests.get(sid).picked = { device, ...(preset ? { preset } : {}), name: trial.name };
    saveTrying();
    say(`Hearing ${heardWhat()} on ${trial.name}${barsText()}. ${stops()}`);
    render(); emit();
    if (play) playTake();
    return { ok: true };
  }

  // an uncommitted take: the track its Keep would make, previewed, with the sound on trial on it
  function tryNew(take, { device, preset = null } = {}, { play = true, suggestedBy = null, sid = null } = {}) {
    const def = dev(device);
    if (!def || def.kind !== 'instrument') return { ok: false, error: `no instrument "${device}"` };
    if (trial && !trial.newTrack) endTrial('switch', { quiet: true });
    const part = newPart(kindOfTakeKind(take));
    const params = preset ? presetParams(def, preset) || {} : {};
    if (newH && !trackOf(newH.track)) newH = null;
    if (!newH) {
      const n = P().tracks.length;
      const hd = store.preview({ type: 'track.add', ref: 'snd', track: { name: part.name, kind: 'instrument', color: `var(--c-${(n % 8) + 1})`, instrument: { device, params } } }, { by: 'you' });
      if (!hd.ok) return { ok: false, error: hd.error };
      newH = { handle: hd, track: hd.created?.snd || P().tracks[P().tracks.length - 1]?.id, take };
    } else {
      // (the same previewed track, its instrument changed under it: one track id for the whole card)
      releaseHandle();
    }
    const base = { device: part.device, preset: null, name: nameOf(part.device), inst: { device: part.device, params: {} } };
    let hd = null;
    const cur = trackOf(newH.track)?.instrument;
    if (cur && (cur.device !== device || preset)) {
      hd = store.preview({ type: 'instrument.set', track: newH.track, device, ...(preset ? { params } : {}) }, { by: 'you' });
      if (!hd.ok) hd = null;
    }
    trial = same({ device, preset }, base) && !hd ? null : { track: newH.track, device, preset, name: nameOf(device, preset), was: base, handle: hd, from: 'take', suggestedBy, sid, newTrack: true, take, at: Date.now() };
    if (!picking) follow = true;
    if (trial && sid && requests.has(sid)) requests.get(sid).picked = { device, ...(preset ? { preset } : {}), name: trial.name };
    saveTrying();
    if (trial) say(`Hearing ${heardWhat()} on ${trial.name}${barsText()}. ${stops()}`);
    render(); emit();
    if (play) playTake();
    return { ok: true, track: newH.track };
  }

  // Sketch's Keep of an uncommitted take: the previewed track goes, and the Keep makes the real one with this sound
  function takeNew() {
    if (!newH) return null;
    const tr = trial && trial.newTrack ? trial : null;
    const part = newPart(kindOfTakeKind(newH.take));
    const device = tr ? tr.device : part.device, preset = tr ? tr.preset : null;
    const def = dev(device);
    const out = { name: trackOf(newH.track)?.name || part.name, device, preset, params: preset && def ? presetParams(def, preset) || {} : {}, suggestedBy: tr?.suggestedBy || null };
    if (tr?.sid && requests.has(tr.sid)) settle(tr.sid, { device, ...(preset ? { preset } : {}), name: tr.name }, true);
    trial = null;
    releaseNew();
    saveTrying();
    skipOffer = Date.now();   // (the Keep's own commit is the first take onto that track: the card has done its job)
    closeCard({ done: true });
    emit();
    return out;
  }

  function keep({ reason = null, why = 'keep' } = {}) {
    if (!trial || trial.newTrack) return null;
    const tr = trial, t = trackOf(tr.track);
    if (!t) { endTrial('gone'); return null; }
    const tn = t.name;
    const def = dev(tr.device);
    const params = tr.preset && def ? presetParams(def, tr.preset) : null;
    const ops = [{ type: 'instrument.set', track: tr.track, device: tr.device, ...(params ? { params } : {}) }];
    // a track still named after its old instrument takes the new one's name in the same step; a name typed is kept
    const rename = t.name === tr.was.name && def && def.name !== t.name;
    if (rename) ops.push({ type: 'track.set', track: tr.track, patch: { name: def.name } });
    const why2 = reason || (tr.suggestedBy ? `suggested by ${agentName(tr.suggestedBy)}` : '');
    // the preview let go and the keep dispatched in one task: the engine's reconcile runs once, on what is kept
    trial = null;
    const hd = tr.handle; tr.handle = null;
    try { hd?.release(); } catch (e) { /* gone */ }
    if (!card || why === 'keep') releaseLoop();
    mine++;
    let r;
    try { r = store.dispatch(ops, { by: 'you', label: `${t.name}: ${tr.name} (was ${tr.was.name})`, ...(why2 ? { reason: why2 } : {}) }); } finally { mine--; }
    saveTrying();
    if (tr.sid) settle(tr.sid, { device: tr.device, ...(tr.preset ? { preset: tr.preset } : {}), name: tr.name }, !!r?.ok);
    if (!r?.ok) { ui.toast(r?.error || 'That sound could not be kept', { kind: 'bad' }); render(); emit(); return r; }
    const undo = { label: 'Undo', run: () => store.undo({ id: r.txn?.id }) };
    if (why === 'record') ui.toast(`Kept ${tr.name} on ${tn}: you recorded with it.`, { kind: 'ok', action: undo });
    else if (why === 'control') { ui.toast(`Kept ${tr.name} on ${tn}, to change it.`, { kind: 'ok', action: undo }); say(`Kept ${tr.name} on ${tn}, to change it.`); }
    else ui.toast(`${tn} plays ${tr.name} now (was ${tr.was.name}).`, { kind: 'ok', action: undo });
    if (why === 'keep') closeCard({ done: true });
    else render();
    emit();
    return r;
  }

  // Back: what it played before. why: 'back' (the card, Esc), 'agent', 'undo', 'select', 'hidden', 'browser', 'gone',
  // 'load', 'switch', 'now'. quiet: no line, no toast (a trial replaced by another, or by what it played)
  function endTrial(why = 'back', { quiet = false, by = 'claude' } = {}) {
    if (!trial) return false;
    const tr = trial;
    trial = null;
    if (why !== 'load') { try { tr.handle?.release(); } catch (e) { /* gone */ } }
    tr.handle = null;
    // (the loop held round the take goes with the trial, unless another sound takes its place on the same card)
    if (why !== 'switch' && why !== 'now' && (!card || why !== 'back')) releaseLoop();
    saveTrying({ defer: why === 'hidden' });
    if (!quiet) {
      const t = trackOf(tr.track), tn = t?.name || 'the track';
      if (why === 'agent') {
        const line = `Back to ${tr.was.name} while ${agentName(by)} works. ${tr.name} wasn't kept.`;
        if (card) say(line); else ui.toast(line, { action: keepAgain(tr) });
      } else if (why === 'back' || why === 'undo') say(`Back to ${tr.was.name}.`);
      else if (why === 'gone' || why === 'load') ui.toast(`Back to ${tr.was.name}${t ? ` on ${tn}` : ''}; ${tr.name} wasn't kept.`);
      else if (why !== 'switch' && why !== 'now') ui.toast(`Back to ${tr.was.name} on ${tn}; ${tr.name} wasn't kept.`, { action: tr.newTrack ? null : keepAgain(tr) });
    }
    render(); emit();
    return true;
  }
  // a toast's Keep it: the Keep the trial would have made, if the track still plays what it did then
  function keepAgain(tr) {
    if (tr.newTrack) return null;
    return { label: 'Keep it', run: () => {
      const t = trackOf(tr.track);
      if (!t || t.instrument?.device !== tr.was.device) { ui.toast(`${t ? t.name : 'That track'} has changed since; nothing was kept.`); return; }
      const r = tryOn(tr.track, { device: tr.device, preset: tr.preset }, { play: false, from: tr.from, suggestedBy: tr.suggestedBy, sid: tr.sid });
      if (r.ok && !r.now) keep();
    } };
  }
  function back({ why = 'back', quiet = false } = {}) {
    if (!trial) return false;
    return endTrial(why, { quiet });
  }
  function keepIfTrying(track, { why = 'control' } = {}) {
    if (!trial || trial.newTrack || (track != null && trial.track !== track)) return false;
    return !!keep({ why })?.ok;
  }
  const recording = () => { const s = app.input?.recorder?.state; return !!s && s !== 'idle'; };

  /* ---------------------------------------------------------------- hearing it */
  // the bars the take (or the track's clips) covers
  function spanOf() {
    const take = card?.take || trial?.take || null;
    if (take && Number.isFinite(take.start) && Number.isFinite(take.end) && take.end > take.start) return { start: take.start, end: take.end };
    const t = trackOf(card?.track || trial?.track);
    const cs = (t?.clips || []).filter((c) => !c.mute);
    if (!cs.length) return null;
    return { start: Math.min(...cs.map((c) => c.start)), end: Math.max(...cs.map((c) => c.start + c.length)) };
  }
  function barsText() {
    const sp = spanOf();
    if (!sp) return '';
    const b = bpb(), a = Math.floor(sp.start / b + 1e-9) + 1, z = Math.max(a, Math.ceil(sp.end / b - 1e-9));
    return a === z ? `, bar ${a}` : `, bars ${a}–${z}`;
  }
  function heardWhat() {
    const k = card ? card.kind : 'played';
    if (card && card.from !== 'take' && card.track) return trackOf(card.track)?.name || 'the track';
    return HEARD[k] || 'the take';
  }
  // Play the take from its first bar (a stopped transport only: a playing one keeps playing), looping round its bars
  // when the song was looping somewhere else
  async function playTake() {
    const E = engine();
    if (!E || E.playing || E.starting || recording()) return;
    // a take not kept yet isn't in the song: Sketch plays it (hear) on the track its Keep would make, previewed here
    // with the sound now (the ghost lane) when nothing is on trial yet
    const tk = card?.take || trial?.take || null;
    if ((card ? card.key === 'new' : trial?.newTrack) && tk && !tk.committed && tk.capture && typeof app.sketch?.hearTake === 'function') {
      if (!newH) { picking++; try { const part = newPart(kindOfTakeKind(tk)); tryNew(tk, { device: part.device }, { play: false }); } finally { picking--; } }
      app.sketch.hearTake(tk.capture);
      return;
    }
    const sp = spanOf();
    if (!sp) return;
    const lp = P().loop || {};
    // (the browser's trial plays the track from its first bar and leaves the song's loop alone: a producer's loop is
    // theirs. The card's take is looped round while the card is up, and let go with it)
    const fromBrowser = (trial?.from || card?.from) === 'browser';
    if (!loopH && !fromBrowser && lp.on && !(lp.start <= sp.start + 1e-6 && lp.end >= sp.end - 1e-6)) {
      const b = bpb(), start = Math.floor(sp.start / b + 1e-9) * b, end = Math.max(start + b, Math.ceil(sp.end / b - 1e-9) * b);
      const hd = store.preview({ type: 'project.set', patch: { loop: { on: true, start, end } } }, { by: 'you' });
      if (hd.ok) loopH = hd;
    }
    try { await E.settled?.(); } catch (e) { /* plays anyway */ }
    if (E.playing || recording()) return;
    try { await E.play(sp.start); } catch (e) { /* no audio yet */ }
  }

  /* ---------------------------------------------------------------- the card */
  function say(text) {
    if (!card) return;
    card.statusText = text;
    if (card.status) { card.status.textContent = ''; card.status.textContent = text; }
  }
  function offer({ track = null, from = 'header', anchor = null, take = null, focus = true, asked = false } = {}) {
    // a take offers the card; it opens by itself only in the simple view (the full studio has Sounds on the take line,
    // the header and the toast: INSTRUMENTS-UX 2.2)
    if (from === 'take' && !asked && view() !== 'simple') {
      if (track && trackOf(track) && !opened.has(track)) { pendingSet.add(track); emit(); }
      return { ok: true, opened: false };
    }
    let key = track;
    if (!track && take && !take.committed) key = 'new';
    else {
      const t = trackOf(track);
      if (!t) return { ok: false, error: track == null ? 'which track?' : `no track "${track}"` };
      if (t.kind !== 'instrument') return { ok: false, error: `${t.name} is an audio track` };
    }
    if (card && card.key === key && (!anchor || anchor === card.anchor)) { focusRow(card.focusI ?? 0); return { ok: true, same: true }; }
    // another track's card: its trial ends first (Back, quietly), this one's is kept going
    if (trial && (trial.newTrack ? key !== 'new' : trial.track !== track)) endTrial('switch', { quiet: true });
    closeCard({ keepTrial: true });
    if (track) {
      pendingSet.delete(track); opened.add(track);
      if (ui.state.selection.track !== track) ui.select({ track });
    }
    const kind = kindOf(track, take);
    card = { key, track, take, from, anchor, kind, rows: [], focusI: 0, status: null, statusText: '', mode: 'pop', host: null };
    let host = null;
    if (from === 'take' && hostFn) { try { host = hostFn({ track, take }) || null; } catch (e) { host = null; } }
    if (host) { card.mode = 'host'; card.host = host; }
    else if (phone()) card.mode = 'sheet';
    if (!card.anchor && card.mode === 'pop') card.anchor = (track && document.querySelector(`.ar-head[data-track="${globalThis.CSS?.escape ? globalThis.CSS.escape(track) : track}"]`)) || null;
    build();
    if (focus) focusRow(0);
    emit();
    // a take offers the card with the take playing, on what it plays now ("now" focused: ↓ tries the next)
    if (from === 'take') {
      const t = trackOf(track);
      say(`Hearing ${heardWhat()} on ${t ? realOf(t).name : nameOf(newPart(kindOfTakeKind(take)).device)}${barsText()}. ${stops()}`);
      playTake();
    }
    return { ok: true };
  }

  function build() {
    const c = card;
    const el = h('section.snd-card' + (c.mode === 'sheet' ? '.snd-sheet' : c.mode === 'pop' ? '.snd-pop' : '.snd-in'), { role: 'dialog', 'aria-label': c.track ? `Sounds for ${trackOf(c.track)?.name || 'the track'}` : 'Sounds for the new track', tabindex: -1, dataset: { track: c.track || '', from: c.from } });
    c.el = el;
    c.status = h('p.snd-status', { role: 'status', 'aria-live': 'polite' });
    if (c.mode === 'host') c.host.append(el);
    else (document.querySelector('.ew-shell') || document.body).append(el);
    render();
    place();
  }
  function place() {
    const c = card;
    if (!c || c.mode !== 'pop') return;
    // (the anchor is looked up each time: the arranger redraws its headers, and a take's new track is the ghost lane's)
    const esc = (x) => (globalThis.CSS?.escape ? globalThis.CSS.escape(x) : x);
    const anchor = c.anchor && c.anchor.isConnected ? c.anchor
      : (c.track && document.querySelector(`.ar-head[data-track="${esc(c.track)}"]`)) || (c.key === 'new' && document.querySelector('.ar-ghost')) || null;
    const el = c.el, a = anchor && anchor.getClientRects().length ? anchor.getBoundingClientRect() : null;
    const w = el.offsetWidth || 360, hh = el.offsetHeight || 300, vw = window.innerWidth, vh = window.innerHeight;
    let x = a ? a.left : (vw - w) / 2, y = a ? a.bottom + 6 : 90;
    x = Math.max(8, Math.min(x, vw - w - 8));
    if (y + hh > vh - 8) y = a ? Math.max(8, a.top - hh - 6) : Math.max(8, vh - hh - 8);
    el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
  }
  window.addEventListener('resize', () => place());

  function render() {
    const c = card;
    if (!c || !c.el) return;
    const hadFocus = c.el.contains(document.activeElement);
    const t = trackOf(c.track);
    const rows = c.rows = setsFor(c.track, c.take);
    const tr = trial && (c.key === 'new' ? trial.newTrack : trial.track === c.track) ? trial : null;
    // (what you hear is where Enter keeps: a sound tried from outside the card brings its focus to that row)
    if (follow && tr) { const k = rows.findIndex((r) => same(r, tr)); if (k >= 0) c.focusI = k; }
    follow = false;
    const n = rows.length;
    const isNew = c.key === 'new';
    const tn = t?.name || 'the new track';
    // the head and its aside
    const head = h('div.snd-top', h('h3.head.snd-h', 'What should this sound like?'),
      h('button.snd-x', { type: 'button', 'aria-label': tr ? `Close, back to ${tr.was.name}` : 'Close the sounds', title: tr ? `Close, back to ${tr.was.name} (Esc)` : 'Close (Esc)', onclick: () => { if (trial) back(); closeCard({ done: true }); } }, icon('x', { size: 16 })));
    const tail = phone() ? ' Tap one to hear it.' : c.from === 'take' ? ' ↓ tries the next.' : ' Click one to hear it.';
    const asideText = c.from === 'take' || isNew
      ? `${ASIDE[c.kind] || 'Your take'}, on ${n} ${c.kind === 'drums' ? 'kits' : 'sounds'}.${tail}`
      : `${tn}, on ${n} ${c.kind === 'drums' ? 'kits' : 'sounds'}.${tail}`;
    const aside = h('p.snd-aside', asideText);
    // the rows: a ledger, reverse print on the one being heard
    const list = h('div.ledger.snd-rows', { role: 'listbox', 'aria-label': `Sounds for ${tn}` });
    rows.forEach((r, i) => {
      const hearing = tr ? same(r, tr) : false;
      const isNow = r.now && !tr;
      const sw = swatchOf(r.def || {});
      const maker = r.def?.by && r.def.by !== 'overdub' ? byline(r.def.by, { app }) : null;
      const blurb = blurbOf(r);
      const ag = !r.now && r.by ? r : null;
      const state = hearing ? h('span.snd-st', h('i.snd-lamp', { 'aria-hidden': 'true' }), 'hearing')
        : ag ? h('span.snd-st', 'suggested by ', byline(ag.by, { app }))
        : h('span.snd-st', r.now ? 'now' : '');
      const row = h('div.ledger-row.snd-row' + (hearing ? '.sel' : ''), {
        role: 'option', tabindex: i === (c.focusI ?? 0) ? 0 : -1, 'aria-selected': String(hearing || (isNow && !tr)),
        title: [r.name, r.def?.blurb].filter(Boolean).join('. '),
        dataset: { device: r.device, preset: r.preset || '', now: r.now ? '1' : '' },
        onclick: () => { c.focusI = i; pick(i, { play: true }); },
      },
      h('i.snd-sw', { style: { background: sw.color } }),
      h('span.snd-w',
        h('span.snd-n', h('b', r.name), maker ? h('span.snd-by', ', by ', maker) : null),
        h('span.snd-f', r.family ? (phone() || !blurb ? r.family : `${r.family}: ${blurb}`) : blurb || ''),
        ag?.why ? h('span.why', ag.why) : null),
      state);
      row.addEventListener('focus', () => { c.focusI = i; for (const x of list.children) x.tabIndex = x === row ? 0 : -1; });
      list.append(row);
    });
    // In tune: a hum take not kept yet (Sketch's Snap, given with the take)
    // (the take may carry its own { on, set }; else Sketch's lamp, app.sketch.inTune / setInTune, one state with Snap)
    const tn0 = c.take && !c.take.committed && c.take.src === 'hum'
      ? c.take.tune || (typeof app.sketch?.inTune === 'function' && app.sketch.inTune() != null ? { get on() { return !!app.sketch.inTune(); }, set on(v) { /* Sketch holds it */ }, set: (on) => app.sketch.setInTune(on) } : null)
      : null;
    const tune = tn0
      ? h('div.snd-line', h('button.tog.snd-tune', { type: 'button', 'aria-pressed': String(!!tn0.on), title: 'On: your notes moved into the key you hummed in. Off: as sung', onclick: (e) => { const on = !tn0.on; try { tn0.set?.(on); } catch (er) { console.error(er); } tn0.on = on; e.currentTarget.setAttribute('aria-pressed', String(on)); } }, 'In tune'))
      : null;
    c.status.textContent = c.statusText || '';
    // the decision: Keep (the region's one primary, unless the take's own Keep is there) and Back; Done outside a trial
    const otherGo = c.mode === 'host' && [...(c.host.closest('[data-panel]') || c.host).querySelectorAll('.btn-go')].some((b) => !c.el.contains(b) && b.getClientRects().length);
    const b1 = h('div.snd-b1');
    // a take not kept yet, on a floating card (Sketch's own Keep is out of reach of it): its Keep keeps the take, onto
    // a new track playing what is heard (app.sketch.keepTake, the take line's Keep)
    const takeKeep = isNew && c.mode !== 'host' && typeof app.sketch?.keepTake === 'function';
    const hearName = tr ? tr.name : rows[0]?.name || '';
    if (takeKeep) b1.append(h('button.btn.btn-go.snd-keep.snd-keeptake', { type: 'button', 'aria-label': `Keep the take, on ${hearName}`, onclick: () => { try { app.sketch.keepTake(); } catch (e) { console.error(e); } } }, phone() ? 'Keep' : `Keep it, on ${hearName}`));
    if (tr) {
      // (a phone's Keep is one word, wide: the name is in the status line over it)
      if (!isNew) b1.append(h(otherGo ? 'button.btn.snd-keep' : 'button.btn.btn-go.snd-keep', { type: 'button', 'aria-label': `Keep ${tr.name}`, onclick: () => keep() }, phone() ? 'Keep' : `Keep ${tr.name}`));
      b1.append(h('button.btn.btn-txt.snd-back', { type: 'button', onclick: () => { back(); if (!isNew) closeCard({ done: true }); } }, `Back to ${tr.was.name}`));
    } else if (!takeKeep) b1.append(h('button.btn.snd-done', { type: 'button', onclick: () => closeCard({ done: true }) }, 'Done'));
    // open it big, beside the decision (it was the last thing on the card, under the fold on a phone); then the
    // quieter line: the browser, the agent
    const open = tr ? tr.name : rows[0]?.name;
    if (!isNew && open) b1.append(h('button.btn.btn-txt.snd-open', { type: 'button', title: `${open}'s own window: its controls and a keyboard`, onclick: () => openBig() }, icon('open', { size: 12 }), `Open ${open}`));
    const b2 = h('div.snd-b2',
      h('button.btn.btn-txt.snd-more', { type: 'button', onclick: () => moreSounds() }, 'More sounds'),
      h('button.btn.btn-txt.snd-ask', { type: 'button', onclick: () => askAgent() }, icon('agent', { size: 13 }), `Ask ${agentName()} for others`));
    const grip = c.mode === 'sheet' ? h('button.snd-grip', { type: 'button', 'aria-label': 'Close the sounds', onclick: () => { if (!trial) closeCard({ done: true }); } }) : null;
    // (the phone's sheet pins the decision at its foot)
    c.el.replaceChildren(...[grip, head, aside, list, tune, c.status, ...(c.mode === 'sheet' ? [b2, b1] : [b1, b2])].filter(Boolean));
    c.el.setAttribute('aria-label', `Sounds for ${tn}`);
    if (hadFocus) focusRow(c.focusI ?? 0, { quiet: true });
    place();
  }
  // a row's words after its family: the blurb, without the family it starts with ("Electric piano with bark…" ->
  // "bark and shimmer, or a grand"; "A string section: slow bows…" -> "slow bows…")
  function blurbOf(r) {
    let b = String(r.def?.blurb || '').trim();
    if (!b) return '';
    const i = b.indexOf(':');
    if (i > 0 && i < 40) b = b.slice(i + 1).trim();
    else if (r.family && b.toLowerCase().startsWith(r.family.toLowerCase())) b = b.slice(r.family.length).replace(/^[\s,:-]*(with\s+)?/i, '');
    return b ? b[0].toLowerCase() + b.slice(1) : '';
  }
  function focusRow(i, { quiet = false } = {}) {
    if (!card) return;
    const rows = [...card.el.querySelectorAll('.snd-row')];
    if (!rows.length) { card.el.focus({ preventScroll: true }); return; }
    i = Math.max(0, Math.min(rows.length - 1, i));
    card.focusI = i;
    rows.forEach((r, k) => { r.tabIndex = k === i ? 0 : -1; });
    rows[i].focus({ preventScroll: quiet });
  }
  // a row picked (a click, Enter, an arrow at rest): the "now" row is Back, any other is tried
  function pick(i, { play = true } = {}) {
    const c = card;
    if (!c) return null;
    const r = c.rows[i];
    if (!r) return null;
    if (r.now) { if (trial) back(); return { ok: true, now: true }; }
    if (trial && same(r, trial) && (c.key === 'new') === !!trial.newTrack) { if (play) playTake(); return { ok: true, same: true }; }
    const opts = { play, from: c.from, suggestedBy: r.by || null, sid: r.sid || null };
    picking++;
    let res;
    try { res = c.key === 'new' ? tryNew(c.take, r, opts) : tryOn(c.track, r, opts); } finally { picking--; }
    if (!res.ok) say(res.error);
    // (a tap on a row with the transport stopped plays from the take's first bar: tryOn and tryNew do)
    return res;
  }
  function openBig() {
    const c = card;
    if (!c || !c.track) return;
    const track = c.track;
    if (trial && trial.track === track) keep({ why: 'open' });
    closeCard({ done: true });
    const r = app.plugin?.open?.({ track, slot: 'instrument' });
    if (r && !r.ok) { if (r.held) { ui.select({ track }); ui.show('rack'); } else ui.toast(r.error, { kind: 'bad' }); }
  }
  function moreSounds() {
    const cat = CAT_OF[card?.kind] || 'keys';
    if (typeof app.browser?.find === 'function') app.browser.find(cat);
    else { ui.show('browser'); ui.emit('browser:find', { query: cat }); }
  }
  function askAgent() {
    const tn = trackOf(card?.track)?.name || 'the new track';
    ui.emit('agent:compose', { text: `Other sounds for ${tn}?`, send: true, attach: { track: card?.track || null } });
  }
  function closeCard({ keepTrial = false, done = false } = {}) {
    const c = card;
    if (!c) return;
    clearTimeout(restT);
    card = null;
    const had = c.el?.contains(document.activeElement);
    c.el?.remove();
    if (!keepTrial) releaseLoop();
    // an uncommitted take's card gone without its Keep: the previewed track goes too
    if (!keepTrial && c.key === 'new' && newH) { if (trial?.newTrack) { trial = null; } releaseNew(); saveTrying(); }
    if (done) for (const [id, q] of requests) if (q.status === 'pending' && (q.track || 'new') === (c.track || 'new')) settle(id, q.picked || null, false);
    if (had) { const back = c.anchor && c.anchor.isConnected ? c.anchor : null; back?.focus?.({ preventScroll: true }); }
    emit();
  }

  /* ---------------------------------------------------------------- keys: the card focused */
  const cardFocused = () => !!card && card.el.contains(document.activeElement);
  let restT = 0;
  const step = (d) => {
    if (!card) return;
    const n = card.rows.length;
    const i = Math.max(0, Math.min(n - 1, (card.focusI ?? 0) + d));
    focusRow(i);
    // the arrow rests on a row before it is tried, so a held key doesn't stack previews
    clearTimeout(restT);
    restT = setTimeout(() => { if (card && card.focusI === i) pick(i, { play: true }); }, REST_MS);
  };
  ui.keys.add({ key: 'ArrowDown', global: true, when: cardFocused, run: () => step(1), label: 'Try the next sound', group: 'Sounds' });
  ui.keys.add({ key: 'ArrowUp', global: true, when: cardFocused, run: () => step(-1), label: 'Try the sound before', group: 'Sounds' });
  ui.keys.add({ key: 'Enter', global: true, when: cardFocused, run: (e) => {
    if (e.target?.closest?.('button') && !e.target.closest('.snd-row')) { e.target.click(); return; }
    clearTimeout(restT);
    const r = card.rows[card.focusI ?? 0];
    if (r && !r.now && !(trial && same(r, trial))) { const res = pick(card.focusI ?? 0, { play: false }); if (!res?.ok) return; }
    if (trial && !trial.newTrack) keep();
    else if (!trial) closeCard({ done: true });
  }, label: 'Keep the sound', group: 'Sounds' });
  ui.keys.add({ key: 'Escape', first: true, global: true, when: () => cardFocused() || (!!card && !!trial && card.mode !== 'host' && !document.querySelector('.ew-pop, .ek-pop, [role=menu]')), run: () => { clearTimeout(restT); if (trial) back(); else closeCard({ done: true }); }, label: 'Back, then close the sounds', group: 'Sounds' });
  // (a row has focus, and Space on a focused option is the option's: here it is still the transport's)
  ui.keys.add({ key: 'Space', global: true, when: () => cardFocused() && !document.activeElement?.matches?.('button'), run: () => { try { app.transport?.playStop?.(); } catch (e) { /* none */ } }, label: 'Play or stop', group: 'Sounds', hidden: true });

  // A click outside: never ends a trial (you can press Play in the arranger and keep listening); with nothing on
  // trial it closes a floating card (a popover or the phone's sheet; Sketch's own place is Sketch's)
  window.addEventListener('pointerdown', (e) => {
    if (!card || card.mode === 'host' || trial) return;
    if (card.el.contains(e.target) || (card.anchor && card.anchor.contains(e.target))) return;
    if (e.target.closest?.('.ew-toast, .ew-pop, [role=menu]')) return;
    closeCard({ done: true });
  }, true);

  /* ---------------------------------------------------------------- what ends a trial */
  ui.on('select', (s) => {
    if (!trial || trial.newTrack) return;
    if (s.track && s.track !== trial.track && trackOf(s.track)) endTrial('select');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && trial) endTrial('hidden'); });
  ui.on('agent:tool', (e) => {
    if (e?.phase !== 'start' || QUIET_TOOLS.has(e.name)) return;
    // (a previewed new track with no sound on trial stays: it is Sketch's take, heard on its first sound)
    if (trial) endTrial('agent', { by: e.by });
  });
  // recording starts: the loop let go before the count; Keep first (said as the take starts), or Back
  const hookRecorder = () => {
    const rec = app.input?.recorder;
    if (!rec?.on || hookRecorder.done) return;
    hookRecorder.done = true;
    rec.on('state', (e) => {
      if (e?.state === 'count') { releaseLoop(); try { wasHum = !!rec.humming?.(); } catch (er) { wasHum = false; } }
      if (e?.state !== 'rec') return;
      try { wasHum = wasHum || !!rec.humming?.(); } catch (er) { /* ok */ }
      if (!trial) return;
      if (trial.newTrack) { endTrial('switch', { quiet: true }); return; }
      const lands = (() => { try { return rec.lands?.()?.id || null; } catch (er) { return null; } })();
      if (!lands || lands === trial.track) keep({ why: 'record' });
      else endTrial('record');
    });
    rec.on('aim', () => emit());
  };
  hookRecorder();
  ui.on('ready', hookRecorder);
  // Sketch's Snap chip and the card's In tune lamp are one state
  ui.on('sketch:intune', () => { if (card && card.take && !card.take.committed) render(); });

  // The first take onto a track that had no clips (R's commit, a take kept from Sketch, Shift+R): the track's Sounds is
  // pending until the card is opened on it; the simple view opens the card by itself, with the take playing.
  let counts = new Map(P().tracks.map((t) => [t.id, t.clips.length]));
  store.on('change', (evt) => {
    const before = counts;
    counts = new Map(P().tracks.map((t) => [t.id, t.clips.length]));
    if (mine) return;
    if (evt.kind === 'load') {
      if (trial) { trial = null; saveTrying(); }
      newH = null; loopH = null;
      pendingSet.clear(); opened.clear(); sugg.clear();
      closeCard({ keepTrial: true });
      emit();
      return;
    }
    // a trial's track gone under it (an undo past it, a remove that didn't come through dispatch)
    if (trial && !trial.newTrack && !trackOf(trial.track)) { const tr = trial; trial = null; saveTrying(); ui.toast(`${tr.name} wasn't kept: its track is gone.`); render(); emit(); }
    if (newH && !trackOf(newH.track)) { newH = null; if (trial?.newTrack) trial = null; saveTrying(); emit(); }
    for (const id of [...pendingSet]) if (!trackOf(id)) pendingSet.delete(id);
    // a track you made (a take, the keys, the browser's new track, a dispatch): its Sounds is pending too, since it is new
    if (evt.kind === 'do' && evt.by === 'you') {
      let n = 0;
      for (const t of P().tracks) if (t.kind === 'instrument' && !before.has(t.id) && !opened.has(t.id) && !(newH && t.id === newH.track) && !pendingSet.has(t.id)) { pendingSet.add(t.id); n++; }
      if (n) emit();
    }
    if (evt.kind !== 'do' || evt.by !== 'you' || !evt.txn || !/^(record|keep)\b/i.test(evt.txn.label || '')) { if (card) render(); return; }
    const firsts = [];
    for (const t of P().tracks) {
      if (t.kind !== 'instrument' || !t.clips.length || (before.get(t.id) || 0) > 0) continue;
      if (newH && t.id === newH.track) continue;
      firsts.push(t);
    }
    if (!firsts.length) { if (card) render(); return; }
    const t = firsts[firsts.length - 1];
    for (const x of firsts) if (!opened.has(x.id)) pendingSet.add(x.id);
    emit();
    if (Date.now() - skipOffer < 3000) { skipOffer = 0; pendingSet.delete(t.id); opened.add(t.id); emit(); return; }
    if (view() !== 'simple' || opened.has(t.id)) return;
    const drums = isDrumTrack(app, t);
    // (the first minute's beat: the coach has its own next step, Hum over it; Sounds waits on the header)
    if (drums && app.onboard?.minute) return;
    const cs = t.clips.filter((c) => !c.mute);
    const take = { kind: drums ? 'drums' : 'notes', src: wasHum ? 'hum' : null, committed: true,
      notes: cs.flatMap((c) => (c.notes || []).map((n) => ({ p: n.p, t: c.start + n.t, d: n.d }))),
      start: Math.min(...cs.map((c) => c.start)), end: Math.max(...cs.map((c) => c.start + c.length)) };
    wasHum = false;
    // (after the arranger has drawn the new header: the card goes under it when Sketch isn't showing)
    requestAnimationFrame(() => requestAnimationFrame(() => { if (trackOf(t.id) && !opened.has(t.id) && !recording()) offer({ track: t.id, from: 'take', take }); }));
  });

  // The store's own entry points, wrapped only to end a trial first. A hand on the tried track's instrument (a rack
  // knob, a preset) keeps it first, so the knob turns the sound you hear; an agent's change to it, or the track's
  // removal, goes Back first; an undo or redo that touches the track goes Back first; another song: Back.
  const touches = (ops, id) => (ops || []).some((o) => o && o.track === id);
  const base = { dispatch: store.dispatch, undo: store.undo, redo: store.redo, revertAuthor: store.revertAuthor, load: store.load };
  store.dispatch = function (ops, opts = {}) {
    if (trial && !mine) {
      const list = Array.isArray(ops) ? ops : [ops];
      const id = trial.track;
      if (trial.newTrack) { if (touches(list, id)) endTrial('switch', { quiet: true }); }
      else if (list.some((o) => o && o.track === id && o.type === 'track.remove')) endTrial('gone');
      else if (list.some((o) => o && o.track === id && o.type === 'instrument.set')) {
        if ((opts?.by || 'you') === 'you') keep({ why: 'control' }); else endTrial('agent', { by: opts.by });
      }
    }
    return base.dispatch.call(store, ops, opts);
  };
  store.undo = function (o = {}) {
    if (trial && !trial.newTrack) {
      const done = store.history;
      let i = done.length - 1;
      if (o?.id) i = done.findIndex((t) => t.id === o.id);
      else if (o?.by) while (i >= 0 && done[i].by !== o.by) i--;
      const tx = i >= 0 ? done[i] : null;
      if (tx && (touches(tx.ops, trial.track) || touches(tx.inverse, trial.track))) endTrial('undo');
    }
    return base.undo.call(store, o);
  };
  store.redo = function (...a) {
    const tx = store.redoable?.[store.redoable.length - 1];
    if (trial && !trial.newTrack && tx && (touches(tx.ops, trial.track) || touches(tx.forward, trial.track) || (tx.revert || []).some((x) => touches(x.ops, trial.track)))) endTrial('undo');
    return base.redo.apply(store, a);
  };
  store.revertAuthor = function (...a) { if (trial && !trial.newTrack) endTrial('undo'); return base.revertAuthor.apply(store, a); };
  store.load = function (...a) {
    if (trial) endTrial(trial.newTrack ? 'switch' : 'gone', { quiet: !!trial.newTrack });
    if (newH) releaseNew();
    releaseLoop();
    return base.load.apply(store, a);
  };

  // A browser trial ends when the browser's pane closes (a frame check: one boolean a frame, from the shell's loop)
  ui.panel({
    id: 'sounds', region: 'top', title: 'Sounds',
    mount(el) {
      el.hidden = true; el.setAttribute('aria-hidden', 'true');
      return { frame() { if (trial && trial.from === 'browser' && !(ui.isOpen?.('left') && ui.visible?.('browser'))) endTrial('browser'); } };
    },
  });

  /* ---------------------------------------------------------------- the agent's suggestions (suggest_sounds) */
  function settle(id, picked, kept) {
    const q = requests.get(id);
    if (!q || q.status !== 'pending') return;
    q.status = 'done'; q.picked = picked || null; q.kept = !!kept;
    for (const fn of q.waiters.splice(0)) { try { fn(api.result(id)); } catch (e) { /* ok */ } }
  }
  function suggest(track, sounds, { by = 'claude', reason = null } = {}) {
    if (recording()) return { error: 'the person is recording', hint: 'wait until they stop (get_recording with wait_seconds)' };
    const t = trackOf(track);
    if (!t) return { error: 'no track to suggest sounds for', hint: 'name one with track' };
    if (t.kind !== 'instrument') return { error: `${t.name} is an audio track`, hint: 'sounds are for instrument tracks' };
    const list = (Array.isArray(sounds) ? sounds : []).slice(0, 4);
    if (!list.length) return { error: 'no sounds given', hint: 'sounds: 1 to 4 of { device, preset?, why }' };
    for (const s of list) {
      const d = dev(s?.device);
      if (!d || d.kind !== 'instrument') return { error: `no instrument "${String(s?.device || '').slice(0, 60)}"`, hint: 'list_devices kind "instrument" lists them' };
      if (s.preset && !presetParams(d, s.preset)) return { error: `no preset "${String(s.preset).slice(0, 60)}" on ${d.name}`, hint: 'get_device lists its presets' };
    }
    const sid = 'snd' + (++seq);
    const rows = list.map((s) => ({ device: s.device, preset: s.preset || null, why: String(s.why || '').slice(0, 60), by, sid }));
    sugg.set(t.id, rows);
    requests.set(sid, { status: 'pending', track: t.id, rows, picked: null, kept: false, waiters: [] });
    if (card && card.track === t.id) render(); else offer({ track: t.id, from: 'agent', focus: false });
    say(`${agentName(by)} suggested ${rows.length} sound${rows.length === 1 ? '' : 's'} for ${t.name}.`);
    emit();
    return { ok: true, offered: true, id: sid, track: t.id, sounds: rows.map((r) => ({ device: r.device, ...(r.preset ? { preset: r.preset } : {}), name: nameOf(r.device, r.preset) })), ...(reason ? { reason } : {}) };
  }

  /* ---------------------------------------------------------------- the take toast's second line */
  // the full studio (the card doesn't open by itself there), or the simple view when it didn't: "What should it sound
  // like? Sounds" for a take that made a track's first clips
  function toastLine(made) {
    const parts = Array.isArray(made) ? made : made?.parts || [];
    const first = parts.map((x) => trackOf(x.track)).find((t) => t && t.kind === 'instrument' && t.clips.every((c) => (parts.find((x) => x.track === t.id)?.clips || []).includes(c.id)));
    if (!first) return null;
    if (view() === 'simple' && card?.track === first.id) return null;
    // (the first minute's beat: the tour's next step is Hum over it, and two next steps at once is one too many)
    if (isDrumTrack(app, first) && app.onboard?.minute) return null;
    const el = h('span.snd-tl', 'What should it sound like? ', h('button.btn.btn-txt.snd-tl-b', { type: 'button', onclick: () => offer({ track: first.id, from: 'header' }) }, 'Sounds'));
    // (asked and answered: once the card has been opened on that track, or a sound kept on it, the line goes)
    const id = first.id;
    const off = ui.on('sounds', () => { if (!pendingSet.has(id) || !trackOf(id)) { off(); el._gone = true; el.remove(); } });
    return el;
  }

  const api = {
    setHost(fn) { hostFn = typeof fn === 'function' ? fn : null; },
    offer,
    try: (track, sound, o) => tryOn(track, sound || {}, o || {}),
    tryNew: (take, sound, o) => tryNew(take, sound || {}, o || {}),
    takeNew,
    keep: (o) => keep(o || {}),
    back: (o) => back(o || {}),
    keepIfTrying: (track, o) => keepIfTrying(track, o || {}),
    trying: () => (trial ? { track: trial.track, device: trial.device, preset: trial.preset || null, name: trial.name, was: trial.was.name, newTrack: !!trial.newTrack, from: trial.from } : newH ? { track: newH.track, device: trackOf(newH.track)?.instrument?.device || null, preset: null, name: nameOf(trackOf(newH.track)?.instrument?.device), was: null, newTrack: true, from: 'take' } : null),
    pending: (track) => pendingSet.has(track),
    toastLine,
    suggest,
    result(id) { const q = requests.get(id); if (!q) return null; return q.status === 'pending' ? { status: 'pending' } : { picked: q.picked, kept: q.kept }; },
    wait(id, ms = 0) {
      const q = requests.get(id);
      if (!q || q.status !== 'pending' || !(ms > 0)) return Promise.resolve(api.result(id));
      return new Promise((res) => { const fn = (r) => { clearTimeout(tm); res(r); }; const tm = setTimeout(() => { q.waiters.splice(q.waiters.indexOf(fn), 1); res(api.result(id)); }, Math.min(ms, 120000)); q.waiters.push(fn); });
    },
    newPart: (kind) => newPart(kind),
    close: () => { if (trial) back({ quiet: true }); closeCard({ done: true }); },
    get current() { return card ? { track: card.track, rows: card.rows.map((r) => ({ device: r.device, preset: r.preset || null, name: r.name, family: r.family, now: !!r.now, by: r.by || null, why: r.why || null })), from: card.from, mode: card.mode } : null; },
    get el() { return card?.el || null; },
    setsFor: (track, take = null) => setsFor(track, take).map((r) => ({ device: r.device, preset: r.preset || null, name: r.name, family: r.family, now: !!r.now })),
  };
  app.sounds = api;
  emit();   // (the headers drawn before this loaded get their Sounds)
}

/* ================================================================ the sets, until core/sounds.js is in the tree */
// The spec's section 3.1, word for word; WP1's core/sounds.js replaces this when it lands (the import above).
export const FALLBACK = (() => {
  const SOUND_SETS = {
    hum: { cat: 'keys', sounds: [['core.keys', null, 'Electric piano'], ['core.wavetable', null, 'Synth'], ['core.strings', null, 'Strings'], ['claude.choir-loft', null, 'Choir']], fallbacks: [['core.mallets', null, 'Mallets'], ['core.ensemble', null, 'Strings'], ['core.choir', null, 'Choir'], ['core.pluck', null, 'Pluck']] },
    played: { cat: 'keys', sounds: [['core.keys', null, 'Electric piano'], ['core.upright', null, 'Upright piano'], ['core.wavetable', null, 'Synth'], ['core.mallets', null, 'Mallets']], fallbacks: [['core.grand', null, 'Piano'], ['core.vibes', null, 'Vibraphone'], ['core.brass', null, 'Brass'], ['core.piano', null, 'Piano'], ['core.pluck', null, 'Pluck']] },
    chords: { cat: 'keys', sounds: [['core.keys', null, 'Electric piano'], ['core.upright', null, 'Upright piano'], ['core.pad', null, 'Pad'], ['core.strings', null, 'Strings']], fallbacks: [['core.grand', null, 'Piano'], ['core.ensemble', null, 'Strings'], ['core.ep', null, 'Electric piano'], ['core.piano', null, 'Piano'], ['core.organ', null, 'Organ'], ['core.poly2', null, 'Synth']] },
    bass: { cat: 'bass', sounds: [['core.bassguitar', null, 'Bass guitar'], ['core.bass', null, 'Synth bass'], ['claude.sub-basement', null, 'Sub bass'], ['core.wavetable', 'Low Key', 'Synth bass']], fallbacks: [['core.ebass', null, 'Bass guitar'], ['core.poly2', 'Ladder bass', 'Synth bass']] },
    drums: { cat: 'drums', sounds: [['core.drums', 'Studio kit', 'Drum kit'], ['core.drumkit', null, 'Jazz kit'], ['core.drumroom', null, 'Acoustic kit'], ['core.drums', 'Boom bap', 'Drum kit']], fallbacks: [['core.brushkit', null, 'Brushes'], ['core.handkit', null, 'Hand percussion'], ['core.drums', 'Trap', 'Drum kit'], ['core.drums', 'Live room', 'Drum kit']] },
  };
  const FAMILY = new Map();
  for (const s of Object.values(SOUND_SETS)) for (const [d, p, f] of [...s.sounds, ...s.fallbacks]) FAMILY.set(`${d}|${p || ''}`, f);
  function kindOfTake({ kind, src, notes } = {}) {
    if (kind === 'drums') return 'drums';
    if (src === 'hum') return 'hum';
    const ns = (notes || []).filter((n) => Number.isFinite(n?.p));
    if (!ns.length) return 'played';
    const ps = ns.map((n) => n.p).sort((a, b) => a - b);
    if (ps[Math.floor(ps.length / 2)] < 48) return 'bass';
    let over = 0;
    for (const n of ns) { const k = ns.filter((m) => m !== n && m.t < n.t + (n.d || 0) - 1e-6 && n.t < m.t + (m.d || 0) - 1e-6).length; if (k >= 2) over++; }
    return over * 3 >= ns.length ? 'chords' : 'played';
  }
  function familyOf(row, def) {
    if (row?.family) return row.family;
    const f = FAMILY.get(`${row?.device}|${row?.preset || ''}`) || FAMILY.get(`${row?.device}|`);
    if (f) return f;
    const b = String(def?.blurb || '');
    const i = b.indexOf(':');
    return i > 0 && i < 30 ? b.slice(0, i) : def?.kindLabel || (def?.cat ? def.cat[0].toUpperCase() + def.cat.slice(1) : '');
  }
  function soundsFor(take, { has = () => true, current = null, currentPreset = null } = {}) {
    const set = kindOfTake(take || {});
    const S = SOUND_SETS[set];
    const out = [];
    const sameRow = (a, b) => a.device === b.device && (a.preset || null) === (b.preset || null);
    if (current) out.push({ device: current, ...(currentPreset ? { preset: currentPreset } : {}), set, family: familyOf({ device: current, preset: currentPreset }, null) });
    for (const [device, preset, family] of [...S.sounds, ...S.fallbacks]) {
      if (out.length >= 4) break;
      const r = { device, ...(preset ? { preset } : {}), set, family };
      if (!has(device) || out.some((x) => sameRow(x, r))) continue;
      out.push(r);
    }
    return out;
  }
  function newPartFor(kind, project) {
    const base = kind === 'pads' || kind === 'beatbox' ? { name: 'Drums', device: 'core.drums' } : kind === 'hum' ? { name: 'Melody', device: 'core.keys' } : { name: 'Keys', device: 'core.keys' };
    const names = new Set((project?.tracks || []).map((t) => t.name));
    let name = base.name;
    for (let n = 2; names.has(name); n++) name = `${base.name} ${n}`;
    return { name, device: base.device };
  }
  return { SOUND_SETS, kindOfTake, soundsFor, familyOf, newPartFor };
})();

/* ================================================================ styles */
// Liner notes (design/LINER-NOTES-KIT.md): a plain head, a ledger of rows under a rule, reverse print on the one heard
// with its lamp the only glow, bylines for who made a device or suggested a row; square, and a shadow only when it
// floats. No stripes, no pills.
const SOUNDS_CSS = `
.snd-card { display: flex; flex-direction: column; gap: 0; min-width: 0; color: var(--text); background: var(--panel); outline: none; }
.snd-card.snd-pop { position: fixed; z-index: 910; width: 380px; max-width: calc(100vw - 16px); max-height: min(78vh, 620px); overflow: auto; padding: 12px 14px 12px; border: var(--rule-2); border-radius: 0; box-shadow: var(--shadow-2); animation: snd-in .16s var(--ease) both; }
.snd-card.snd-in { width: 100%; max-width: 420px; padding: 10px 0 4px; border-top: var(--rule); }
@keyframes snd-in { from { opacity: 0; transform: translateY(-4px); } }
.snd-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.snd-h { flex: 1; min-width: 0; }
.snd-x { display: inline-grid; place-items: center; flex: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--r-press); background: none; color: var(--text-3); cursor: pointer; }
.snd-x:hover { background: var(--bg-3); color: var(--text); }
.snd-x:focus-visible, .snd-grip:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.snd-aside { margin: 2px 0 8px; font-size: 12.5px; color: var(--text-2); }
.snd-rows { border-top: var(--rule); }
.snd-row { --ledger-cols: 12px minmax(0, 1fr) auto; align-items: center; min-height: 40px; padding: 7px 6px 7px 0; cursor: pointer; outline: none; }
.snd-row:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.snd-sw { display: block; width: 8px; height: 8px; margin-left: 2px; }
.snd-w { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.snd-n { min-width: 0; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snd-n b { font-weight: 600; }
.snd-by { color: var(--text-3); }
.snd-f { min-width: 0; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snd-row .why { margin-top: 0; }
.snd-st { display: inline-flex; align-items: center; gap: 6px; padding-left: 8px; font-size: 12px; color: var(--text-3); white-space: nowrap; }
.snd-lamp { display: inline-block; width: 6px; height: 6px; background: var(--accent-2); box-shadow: 0 0 6px color-mix(in srgb, var(--accent-2) 50%, transparent); }
/* the row heard: reverse print, every word on it in the room's ink */
.snd-row.sel, .snd-row.sel:hover { background: var(--text); color: var(--bg); }
.snd-row.sel .snd-f, .snd-row.sel .snd-st, .snd-row.sel .snd-by, .snd-row.sel .by, .snd-row.sel .why { color: var(--bg); }
.snd-row.sel .snd-lamp { background: var(--bg); box-shadow: none; }
.snd-line { padding: 8px 0 0; }
.snd-status { margin: 8px 0 0; min-height: 1.4em; font-size: 12.5px; line-height: 1.4; color: var(--text-2); }
.snd-b1, .snd-b2 { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding-top: 8px; }
.snd-b2 .btn-txt { font-size: 12px; }
.snd-b2 .snd-ask .ico, .snd-open .ico { margin-right: 4px; }
.snd-tl { display: inline; }
.snd-tl-b { min-height: 0; }
/* a phone: a bottom sheet at 70% of the height at most, the decision pinned at its foot */
.snd-card.snd-sheet { position: fixed; z-index: 910; left: 0; right: 0; bottom: 0; max-height: 70vh; max-height: 70dvh; overflow: auto; padding: 0 max(14px, env(safe-area-inset-right)) env(safe-area-inset-bottom) max(14px, env(safe-area-inset-left)); border-top: var(--rule-heavy); box-shadow: 0 -12px 30px -12px #000; animation: snd-up .22s var(--ease) both; }
@keyframes snd-up { from { opacity: 0; transform: translateY(24px); } }
.snd-grip { display: block; width: 100%; height: 22px; margin: 0; padding: 0; border: 0; background: none; cursor: pointer; }
.snd-grip::before { content: ''; display: block; width: 40px; height: 3px; margin: 9px auto 0; background: var(--line-2); }
.snd-sheet .snd-b1 { position: sticky; bottom: 0; z-index: 1; margin-top: 8px; padding: 8px 0; background: var(--panel); border-top: var(--rule); }
@media (max-width: 900px) {
  .snd-row { min-height: 48px; }
  .snd-n { font-size: 14px; }
  .snd-aside, .snd-status { font-size: 12.5px; }
  .snd-card .btn { min-height: 40px; }
  .snd-b1 .snd-keep { flex: 1; }
  .snd-x { width: 44px; height: 44px; }
}
@media (prefers-reduced-motion: reduce) { .snd-card { animation: none; } }
`;
