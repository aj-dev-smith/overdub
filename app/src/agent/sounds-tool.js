// @ts-check
// The `suggest_sounds` agent tool (docs/INSTRUMENTS-UX.md 2.6): an agent's sounds for one track, as rows on the
// person's sound card (ui/sounds.js, app.sounds). It never changes the song by itself: the person hears their take on
// each row and Keeps one, and that Keep is theirs (signed you; History's reason line says who suggested it). So it is in
// NEVER_BLOCKED (tools.js) and does its own recording check: no rows land on a card while a take records.
//
//   app.tools.run('suggest_sounds', { track?, sounds: [{ device, preset?, why }], reason?, wait_seconds? }, { by })
//     -> { offered: true, id, track: { id, name }, sounds: [{ device, preset?, name }] }
//     -> waited (wait_seconds > 0): { id, track, picked: { device, preset?, name } | null, kept } or { status: 'pending', id }
//   get_variation_result { id } -> { status: 'pending', id } | { picked: { device, preset?, name } | null, kept, note? }
//
// The track: `track` (an id or an exact name), else the selected track, else the newest new track: the track the most
// recent take of this session made (newestNewTrack, below). An audio track is refused, and so is a device that isn't an
// instrument this studio has, or a preset it doesn't have, before anything shows.
//
// The card is app.sounds (WP3's ui/sounds.js). The tool calls
//   app.sounds.suggest(track, rows, { by, id, reason, done })     rows: [{ device, preset?, why, name }]
// and the request it answers is settled by whichever comes first:
//   - done({ picked: { device, preset? } | null, kept }) from the card (Keep, Back, ×, the card closing);
//   - ui.emit('sounds:done', { id, picked, kept }) (the same, as an event);
//   - the song: a change by the person that leaves the track playing one of the suggested sounds is that pick, kept;
//     one that leaves it on another instrument is kept: false (they chose another); the track removed or another song
//     loaded is kept: false;
//   - the card no longer showing this track's rows (app.sounds.current) when the request is read: kept: false.
// This module never imports ui/: it talks to app.sounds, so the studio works with or without either.

import { installTools, isRecording } from './tools.js';
import { SUGGEST_SOUNDS_SCHEMA, capText } from './extra-schemas.js';

const err = (error, hint, extra) => ({ error, ...(hint ? { hint } : {}), ...(extra || {}) });
const MAX_WAIT = 120;
let seq = 0;

const P = (app) => app.store.get();
const parse = (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; };
function findTrack(app, ref) {
  if (ref == null || ref === '') return null;
  const p = P(app), s = String(ref);
  return p.tracks.find((t) => t.id === s) || p.tracks.find((t) => t.name === s) || p.tracks.find((t) => t.name.toLowerCase() === s.toLowerCase()) || null;
}
const trackList = (app) => P(app).tracks.map((t) => `${t.id} "${t.name}"`).join(', ') || 'none';
const agentName = (app, by) => app.store.author?.(by)?.name || by;

// The newest new track: the track the most recent take of this session made, still in the song and not an audio
// track. The recorder's own word first (input/recorder.js may keep it: newestTrack()), else the session's History: the
// newest change by the person that added a track and put a clip on it in the same step (R's commit, a take kept from
// Sketch, a Shift+R capture all do; a track added by hand or by the browser has no clip yet, so it isn't one).
export function newestNewTrack(app) {
  const p = P(app);
  const ok = (id) => { const t = id && p.tracks.find((x) => x.id === id); return t && t.kind !== 'audio' ? t : null; };
  try { const id = app.input?.recorder?.newestTrack?.(); if (ok(id)) return ok(id); } catch { /* the History has it */ }
  const hist = app.store.history || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const x = hist[i];
    if (!x || x.by !== 'you') continue;
    const made = (x.inverse || []).filter((o) => o && o.type === 'track.remove').map((o) => o.track);
    if (!made.length) continue;
    const clipped = (x.ops || []).some((o) => o && (o.type === 'clip.add' || (o.type === 'track.add' && (o.track?.clips || []).length)));
    if (!clipped) continue;
    for (const id of made) { const t = ok(id); if (t && t.clips.length) return t; }
  }
  return null;
}

// what the track plays: { device, preset } (preset: the name of the preset its params are, or null)
function soundOf(app, t) {
  const inst = t?.instrument;
  if (!inst) return null;
  const def = app.devices?.getDevice?.(inst.device);
  let preset = null;
  try { preset = def && app.devices?.presetOf ? app.devices.presetOf(def, inst.params)?.name || null : null; } catch { /* no preset */ }
  return { device: inst.device, preset };
}
const nameOf = (app, device, preset) => {
  const n = app.devices?.getDevice?.(device)?.name || device;
  return preset ? `${n}, ${preset}` : n;
};
const sameSound = (a, b) => a && b && a.device === b.device && (!b.preset || String(a.preset || '').toLowerCase() === String(b.preset).toLowerCase());

// the request get_variation_result reads (app.tools.requests): settle it once, wake its waiters
function settle(app, req, result) {
  if (req.status !== 'pending') return;
  req.status = 'done';
  const picked = result?.picked && result.picked.device ? { device: result.picked.device, ...(result.picked.preset ? { preset: result.picked.preset } : {}), name: nameOf(app, result.picked.device, result.picked.preset) } : null;
  req.result = { id: req.id, picked, kept: !!(picked && result.kept), ...(result?.note ? { note: result.note } : {}) };
  for (const off of req.offs.splice(0)) { try { off(); } catch { /* gone */ } }
  for (const w of [...req.waiters]) w();
}

// the song says what they chose, when the card doesn't
function watchSong(app, req) {
  const store = app.store;
  if (!store?.on) return;
  const off = store.on('change', (e) => {
    if (req.status !== 'pending') return;
    if (e?.kind === 'load') return settle(app, req, { picked: null, kept: false, note: 'another song was opened before they chose; nothing changed' });
    const t = P(app).tracks.find((x) => x.id === req.track);
    if (!t) return settle(app, req, { picked: null, kept: false, note: 'the track was removed before they chose' });
    if (e?.by !== 'you' || e?.kind !== 'do') return;
    const touched = (e.ops || []).some((o) => o && o.type === 'instrument.set' && (o.track === t.id || o.track === t.name) && (o.device || o.preset));
    if (!touched) return;
    const now = soundOf(app, t);
    const hit = req.sounds.find((s) => sameSound(now, s));
    if (hit) settle(app, req, { picked: hit, kept: true });
    else settle(app, req, { picked: null, kept: false, note: `they kept ${nameOf(app, now.device, now.preset)}, not one of yours` });
  });
  if (typeof off === 'function') req.offs.push(off);
}

// read when the request is: the card was closed (or moved to another track) with nothing kept
function pollCard(app, req) {
  if (req.status !== 'pending' || !req.shown) return;
  const cur = app.sounds?.current;
  if (cur === undefined) return;   // (a card that doesn't say: the song and done() settle it)
  if (!cur || cur.track !== req.track) settle(app, req, { picked: null, kept: false, note: 'they closed the card without keeping one of yours; nothing changed' });
}

function waitFor(req, seconds, signal) {
  return new Promise((resolve) => {
    if (req.status !== 'pending') return resolve();
    const done = () => { clearTimeout(timer); clearInterval(tick); req.waiters.delete(done); signal?.removeEventListener?.('abort', done); resolve(); };
    const timer = setTimeout(done, Math.max(0, seconds) * 1000);
    const tick = setInterval(() => { req.poll(); if (req.status !== 'pending') done(); }, 250);
    req.waiters.add(done);
    signal?.addEventListener?.('abort', done);
  });
}

export async function runSuggestSounds(app, input = {}, { by = 'claude', signal = null } = {}) {
  // never while they record: the card holds still under a take (and a Keep would change the instrument mid-take)
  if (isRecording(app)) return err('the person is recording', 'wait until they stop (get_recording with wait_seconds)');

  // the track
  let t = null;
  if (input.track != null && input.track !== '') {
    t = findTrack(app, input.track);
    if (!t) return err(`no track "${capText(String(input.track), 80)}"`, `tracks: ${trackList(app)}`);
  } else {
    const sel = app.ui?.state?.selection?.track;
    t = (sel && P(app).tracks.find((x) => x.id === sel)) || newestNewTrack(app);
    if (!t) return err('no track to suggest sounds for', 'name one with track');
  }
  if (t.kind === 'audio') return err(`${capText(t.name, 80)} is an audio track`, 'sounds are for instrument tracks');

  // the sounds: every one checked before anything shows
  const list = parse(input.sounds);
  if (!Array.isArray(list) || !list.length) return err('give 1 to 4 sounds', 'each { device, preset?, why }');
  if (list.length > 4) return err(`${list.length} sounds; the card holds 4`, 'give 1 to 4 sounds');
  const sounds = [];
  for (const raw of list) {
    const s = parse(raw) || {};
    const id = String(s.device || '').trim();
    const def = id ? app.devices?.getDevice?.(id) : null;
    if (!def || def.kind !== 'instrument') return err(`no instrument "${capText(id, 80)}"`, 'list_devices kind "instrument" lists them');
    let preset = null;
    if (s.preset != null && s.preset !== '') {
      const pr = (def.presets || []).find((x) => x.name.toLowerCase() === String(s.preset).trim().toLowerCase());
      if (!pr) return err(`no preset "${capText(String(s.preset), 80)}" on ${def.name}`, 'get_device lists its presets');
      preset = pr.name;
    }
    const why = typeof s.why === 'string' ? s.why.replace(/\s+/g, ' ').trim() : '';
    if (!why) return err(`${def.name} has no why`, 'each sound says why in ≤ 60 chars, e.g. "breathy, sits behind the hum"');
    if (sounds.some((x) => x.device === def.id && x.preset === preset)) continue;   // (the same sound twice is one row)
    sounds.push({ device: def.id, preset, why: capText(why, 60), name: nameOf(app, def.id, preset) });
  }

  const card = app.sounds;
  if (!card || typeof card.suggest !== 'function') return err('no sound card in this studio', 'when they named the instrument, set it with apply_ops instrument.set; otherwise name a few in one line');

  // the request get_variation_result answers
  const reqs = app.tools?.requests;
  const id = 's' + (++seq).toString(36) + Date.now().toString(36).slice(-3);
  const req = {
    id, kind: 'sounds', by, track: t.id, trackRef: { id: t.id, name: t.name }, sounds: sounds.map(({ device, preset }) => ({ device, preset })),
    reason: typeof input.reason === 'string' ? capText(input.reason.trim(), 300) : '', status: 'pending', result: null, waiters: new Set(), offs: [], at: Date.now(), shown: false,
  };
  req.poll = () => pollCard(app, req);
  req.wait = (secs, sig) => waitFor(req, Math.min(MAX_WAIT, Math.max(0, Number(secs) || 0)), sig);   // (get_variation_result waits through it, polling the card)
  const rows = sounds.map((s) => ({ device: s.device, ...(s.preset ? { preset: s.preset } : {}), why: s.why, name: s.name, by, suggestion: id }));
  let r;
  try {
    r = await card.suggest(t.id, rows, { by, id, reason: req.reason, agent: agentName(app, by), done: (res) => settle(app, req, res || {}) });
  } catch (e) {
    return err(`the card couldn't show them: ${String(e?.message || e).slice(0, 120)}`, 'try again, or name a few in one line');
  }
  if (r && (r.error || r.ok === false)) return err(String(r.error || 'the card couldn\'t show them'), r.hint || 'name a few in one line instead');
  req.shown = true;
  reqs?.set?.(id, req);
  if (r && r.id && r.id !== id) reqs?.set?.(String(r.id), req);   // (the card's own id finds it too)
  watchSong(app, req);
  const ev = app.ui?.on?.('sounds:done', (d = {}) => { if (d.id === id || (r && d.id === r.id)) settle(app, req, d); });
  if (typeof ev === 'function') req.offs.push(ev);

  const out = { offered: true, id, track: req.trackRef, sounds: sounds.map((s) => ({ device: s.device, ...(s.preset ? { preset: s.preset } : {}), name: s.name })) };
  const secs = Math.min(MAX_WAIT, Math.max(0, Number(input.wait_seconds) || 0));
  if (!secs) return out;
  await waitFor(req, secs, signal);
  req.poll();
  return req.status === 'pending' ? { status: 'pending', id, track: req.trackRef, note: 'the sounds are on their card; they haven\'t kept one yet. get_variation_result with this id says what they chose.' } : req.result;
}

export const SUGGEST_SOUNDS_TOOL = {
  ...SUGGEST_SOUNDS_SCHEMA,   // name, annotations, description, input_schema (extra-schemas.js: Node lists it with no tab open)
  run(input, ctx) { return runSuggestSounds(ctx.app, input, { by: ctx.by, signal: ctx.signal }); },
};

export default function (app) {
  installTools(app).register(SUGGEST_SOUNDS_TOOL);
}
