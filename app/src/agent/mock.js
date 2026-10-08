// The demo agent: a scripted, realistic session played against the REAL tools (so everything it does is real: ops in
// the store, attributed to 'claude', in History, undoable; real renders and measurements; real A/B cards). Used by
// ?agent=mock, by "Try the demo agent" when no other agent is on, and by tools/agent-test.js.
//
//   await runMock(app, text, { signal, emit, setStatus, context, fast })
//
// It reads what you asked and picks a scene. The Jam room's questions come first (its chips, or typed: FRESH-EYES-6
// guitarist #2): "what scale works over the chorus" (the room's reading, get_jam, and the scale lit on the neck,
// show_on_fretboard), "show me a lick into the D7" (the room's lick writer's lick, on the neck and as tab), "what tone
// would suit this song" (rigs that match the song's style, set_tone's search, offered on a card; one loads only when
// picked) and "make me a slow blues in E" (make_jam_track, which replaces the song: said first, asked on a card). A
// guitar question is never a take tour. Then: the first-meeting tour (listen, point, three takes, then OFFER an effect),
// "build me a pedal…", "give me a riff for the chorus" (the house riff writer's riffs as tab, said to be the house
// writer's), "find me a delay someone made" (the community shelf's best match, offered on a card with
// find_community_device put_on: only the person's Try lets its code run), perceptual words (warmer, brighter, lazier…), automation ("fade it in", "open the bass filter
// over the chorus and fade the keys out over the last bar": one lane move per clause, on the track each clause names),
// "hum me an idea", "undo", and the nearest things it has to a new part, offered as takes on their own track: a line
// over a part (built from its notes), Band's bass (or chords, drums) around a part, a part doubled an octave up.
// Anything else (route() finds no scene: a new part, a question, a clause it can't do) gets an honest answer FIRST:
// it's the scripted demo, the closest thing it can do (chips the panel shows) on what the ask named (its track, by name
// or by what it is, "the bass line"; its bars or section) before what happens to be selected, and a key or Claude Code
// gets you a live model. It never builds or adds what nobody asked for, and never moves the person's panels or
// selection. A card it waits on (takes, a question) never blocks the person's next ask: moveOn(app) lets go of the wait.
//
// How it talks (docs/FRESH-EYES-3.md): each reply leads with what changed in words a non-engineer reads ("the keys
// are fuller and a little louder"); the numbers (LUFS, LU, dBTP, bands, lanes' values) follow as a quieter second
// line (emit 'fine', drawn small by the panel). Take names lead with a plain word ("bouncier"), the theory under it.

import { runTool, coherentSelection, cancelRequest } from './tools.js';
import { songEnd } from '../core/project.js';
import { statusFor } from './claude.js';
import { noteName, parsePc, spellNote, formatNotes } from '../core/music.js';
import { transform } from '../core/transforms.js';
import { styleIn, findGrooves, planPut, defaultBars } from '../core/grooves.js';
import { playheadBar, studioA } from './grooves-tool.js';
import { findRiffStyle, RIFF_STYLES } from '../core/riff.js';
import { chordTimeline, makeLick, findJamStyle, JAM_STYLES } from '../core/jam.js';
import { stringNumber } from '../core/fretboard.js';
import { DEMOS } from '../core/demo.js';
import { CAT_WORDS } from '../devices/community.js';

const stopped = () => Object.assign(new Error('stopped'), { name: 'AbortError' });
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(stopped()); }, { once: true });
});

const sessions = new WeakMap();
// The card the demo waits on, per app: its let-go. The panel calls moveOn(app) when the person asks something else while
// the demo waits for their pick (FRESH-EYES-6 phone #3: the scale chip's takes sat on "Waiting for your pick…" and the
// next chip couldn't be sent). -> true when there was a wait to let go of.
const waits = new WeakMap();
export function moveOn(app) { const go = waits.get(app); if (!go) return false; go(); return true; }

export async function runMock(app, text, { signal, emit, setStatus, fast = false } = {}) {
  _app = app;
  const turn = { id: Date.now(), mock: true };
  const pace = fast ? 0.15 : 1;
  const st = sessions.get(app) || { met: false, offered: false };
  sessions.set(app, st);
  emit('start', { turn });

  const say = async (s) => {
    setStatus('Claude is writing…');
    const words = s.split(/(\s+)/);
    for (const w of words) { emit('text', { turn, delta: w }); if (w.trim()) await sleep((14 + Math.min(40, w.length * 4)) * pace, signal); }
  };
  // the numbers behind what was just said: one quieter line, all at once
  const fine = (s) => { if (s && s.trim()) emit('fine', { turn, text: s.trim() }); };
  const think = async (s, ms = 500) => { setStatus(s); emit('update', { turn, delta: s }); await sleep(ms * pace, signal); emit('update', { turn, done: true }); };
  // wait: a signal of its own for a call that waits on the person (pick), so their next ask lets go of the wait without
  // stopping the turn
  const tool = async (name, input, { wait = null, status = null } = {}) => {
    if (signal?.aborted) throw stopped();
    setStatus(status || statusFor(name, input));
    emit('toolstream', { turn, name });
    await sleep(160 * pace, signal);
    // (let go of already: don't wait at all; the call hooks its wait up as it starts, so nothing falls between)
    const r = await runTool(name, wait?.aborted ? { ...input, wait_seconds: 0 } : input, { by: 'claude', app, signal: wait || signal });
    if (signal?.aborted) throw stopped();
    return r;
  };
  // The person's pick on a card it put up (takes, a question): it waits up to two minutes. When they ask something else
  // first (moveOn), it lets go: takes stay on screen to keep (Keep still lands them), and a question it asked is set
  // aside, as it is when the wait runs out, since nothing would act on its answer.
  //   -> the pick, or { status: 'pending', movedOn? }
  const pick = async (id, { question = false } = {}) => {
    const ac = new AbortController(), off = () => ac.abort();
    signal?.addEventListener('abort', off, { once: true });
    let moved = false;
    waits.set(app, () => { moved = true; ac.abort(); });
    try {
      const r = await tool('get_variation_result', { id, wait_seconds: 120 }, { wait: ac.signal, status: question ? 'Waiting for your answer…' : null });
      if (r.status !== 'pending') return r;
      if (question) cancelRequest(app, id, moved ? 'set aside' : 'left');
      return moved ? { ...r, movedOn: true } : r;
    } finally { waits.delete(app); signal?.removeEventListener('abort', off); }
  };
  // takes on a card, and the pick; a question on a card, and the answer
  // the track the takes are for stays lit while they're on the card, so the takes connect to the song
  const offer = async (input) => {
    const r = await tool('propose_variations', { ...input, wait_seconds: 0 });
    if (!r.error && input.target?.track) { try { app.presence?.highlight?.({ track: input.target.track }, 'the takes are for this track', 'claude', 15000); } catch (e) { /* a nicety */ } }
    return r.error || r.status !== 'pending' ? r : pick(r.id);
  };
  const ask = async (input) => { const r = await tool('ask_human', { ...input, wait_seconds: 0 }, { status: 'Waiting for your answer…' }); return r.error || r.status !== 'pending' ? r : pick(r.id, { question: true }); };

  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  // the studio's own asks first ("where is the mixer", "show me everything"): they're about the screen, not the song
  const studio = studioAsk(app, t);
  if (studio) { await sceneStudio(app, { say, tool, emit, turn }, studio); setStatus(''); emit('end', { turn }); return; }
  // a track's sound ("what should this sound like", "make it a Choir Loft"): the sound card, or the instrument named
  const sounds = soundsAsk(app, t);
  if (sounds) { await sceneSounds(app, { say, tool }, sounds); setStatus(''); emit('end', { turn }); return; }
  const { scene, rest, clauses } = route(t);
  const ctx = { say, fine, tool, think, st, t, emit, turn, clauses, offer, ask, pick };
  // a prompt that asked for more than the script knows: say so first, with the closest thing it can do, then the part
  // it can do (never run the script and only then admit the rest was past it)
  if (scene && rest.length) await offScriptNote(app, ctx, rest);
  if (scene === 'scale') await sceneScale(app, ctx);
  else if (scene === 'lick') await sceneLick(app, ctx);
  else if (scene === 'tone') await sceneTone(app, ctx);
  else if (scene === 'jamtrack') await sceneJamTrack(app, ctx);
  else if (scene === 'riff') await sceneRiff(app, ctx);
  else if (scene === 'groove') await sceneGroove(app, ctx);
  else if (scene === 'undo') await sceneUndo(app, ctx);
  else if (scene === 'line') await sceneLine(app, ctx);
  else if (scene === 'band') await sceneBand(app, ctx);
  else if (scene === 'double') await sceneDouble(app, ctx);
  else if (scene === 'capture') await sceneCapture(app, ctx);
  else if (scene === 'auto') await sceneAuto(app, ctx);
  else if (scene === 'shelf') await sceneShelf(app, ctx);
  else if (scene === 'device') await sceneDevice(app, ctx);
  else if (scene === 'word') await sceneWord(app, ctx);
  else if (scene === 'tour') { st.met = true; await sceneTour(app, ctx); }
  else if (scene === 'chat') await sceneChat(app, ctx);
  else await sceneOffScript(app, ctx, text.trim());

  setStatus('');
  emit('end', { turn });
}

/* ------------------------------------------------------------------ the studio's own asks */
// "Where is the mixer?", "show me the piano roll", "open notes", "add the loop": the feature by its title or one of
// its search words (app.ui.workspace's registry; never imported here), shown as Find's Go to shows it and said where
// it is in one line. "Show me everything" / "full studio" and "simple view" / "less on screen" are answered in words:
// there's one studio, and ?view=simple is a URL only. "What can you do?": what the demo does, and the first door lit.
// The thing named has to be the whole rest of the ask, so "show me a lick into the D7 at bar 2" or "open the bass
// filter" never reads as a feature. "add" takes a title or a screen word only: "add drums" is a part, not the Beat grid.
const STUDIO_VERB = /^(?:(?:hey|ok|okay|so|please|claude|can you|could you|would you)[\s,]+)*(where(?:'s| is| are| do i find| can i find)|show me|open|open up|add|bring (?:in|back|up)|put in)\s+(.+)$/;
const STUDIO_TAIL = /(?:\s+(?:please|for me|too|again|here|now|panel|tab|window|view|button|control|controls|thing|gone|went|hiding))+$/;
const NOT_A_SCREEN = new Set(['drums', 'melody', 'midi', 'loops', 'patterns', 'tab', 'guitar', 'amp', 'jam', 'effects', 'reverb', 'delay', 'synth', 'rigs', 'fretboard', 'steps', 'genre', 'sections', 'colour', 'beat', 'bar', 'meter', 'click', 'metronome', 'arm', 'layer', 'timing', 'count-in', 'mix', 'levels', 'volume', 'pan', 'loudness', 'changes', 'log', 'export', 'import', 'stems', 'loop', 'cycle', 'repeat', 'panic', 'loud', 'knobs', 'preset', 'devices', 'rack', 'sound', 'model', 'connect', 'match', 'reference']);
const EVERYTHING = /^(?:(?:please|can you|could you)\s+)?(?:show me everything|show (?:me )?(?:the )?full studio|(?:the |go to (?:the )?|open (?:the )?|switch to (?:the )?)?full studio|everything on screen|show (?:me )?all (?:the )?(?:panels|controls|tools))[\s?.!]*$/;
const SIMPLER = /^(?:(?:please|can you|could you)\s+)?(?:(?:go back to |switch to |back to )?(?:the )?simple view|(?:make (?:it|this|the studio|the screen) )?simpler (?:view|studio|screen)|less on (?:the )?screen|(?:fewer|less) (?:buttons|controls|panels|clutter)|hide (?:the )?(?:extra )?(?:stuff|panels|controls))[\s?.!]*$/;
const WHAT_IS = /^(?:so\s+)?(?:what can you do|what do you do|what is this|what's this|what does this do)[\s?.!]*$/;
// -> { kind: 'feature', id, verb } | { kind: 'view', view } | { kind: 'intro' } | null
export function studioAsk(app, t) {
  const ws = app?.ui?.workspace;
  if (!ws) return null;
  t = String(t).toLowerCase().replace(/[‘’]/g, "'").trim();
  if (EVERYTHING.test(t)) return { kind: 'view', view: 'full' };
  if (SIMPLER.test(t)) return { kind: 'view', view: 'simple' };
  if (WHAT_IS.test(t) && ws.view() === 'simple') return { kind: 'intro' };
  const m = STUDIO_VERB.exec(t.replace(/[\s?.!]+$/, ''));
  if (!m) return null;
  const verb = m[1].startsWith('where') ? 'where' : m[1] === 'add' || /^(bring|put)/.test(m[1]) ? 'add' : 'open';
  const x = m[2].replace(STUDIO_TAIL, '').replace(/^(?:the|a|an|my|your|me|to|some)\s+/, '').replace(/^(?:the|a|an|my|your)\s+/, '').trim();
  if (!x) return null;
  for (const f of ws.FEATURES) {
    const title = f.title.toLowerCase();
    if (x === title || x === f.id) return { kind: 'feature', id: f.id, verb };
  }
  for (const f of ws.FEATURES) {
    if (f.aliases.some((a) => a.toLowerCase() === x) && !(verb === 'add' && NOT_A_SCREEN.has(x))) return { kind: 'feature', id: f.id, verb };
  }
  return null;
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ a track's sound (docs/INSTRUMENTS-UX.md 2.6) */
// "What should this sound like?", "other sounds", "try some sounds", "a different instrument": suggest_sounds on the
// selected track (else the newest track a take made) with the next four from core/sounds.js's sets that aren't on the
// card already, each with its blurb as the why. "Make it a Choir Loft" / "use Light Table", where the words are an
// instrument's name: instrument.set, said with what it was. Words that name no instrument ("make it warmer") aren't
// this, and fall through to the script.
const SOUNDS_ASK = /\b(?:what (?:should|could|would|does|might) (?:this|it|that|the \w+(?: \w+)?|[a-z]+) sound like|(?:some |any |a few )?other sounds|(?:try|hear|suggest|find) (?:some|other|a few|more|new|different) sounds|(?:a |another )?different instrument|another instrument|other instruments)\b/;
const SOUND_NAMED = /^(?:(?:hey|ok|okay|so|please|claude|can you|could you)[\s,]+)*(?:make (?:it|this|that|the \w+)|use|switch (?:it |this )?to|turn (?:it|this) into|put it on|play it on|change (?:it|this) to)\s+(?:a |an |the )?(.+?)(?:\s+instead)?[\s?.!]*$/;
// -> { kind: 'suggest' } | { kind: 'set', device } | null
export function soundsAsk(app, t) {
  t = String(t).toLowerCase().replace(/[‘’]/g, "'").trim();
  if (SOUNDS_ASK.test(t)) return { kind: 'suggest' };
  const m = SOUND_NAMED.exec(t);
  if (!m) return null;
  const want = m[1].trim();
  const list = app?.devices?.listDevices?.({ kind: 'instrument' }) || [];
  const hit = list.find((d) => d.name.toLowerCase() === want) || list.find((d) => d.id.toLowerCase() === want);
  return hit ? { kind: 'set', device: hit.id } : null;
}
// the sets the card draws from, as the spec's table has them, when core/sounds.js isn't here to say
const SETS_TABLE = {
  hum: ['core.keys', 'core.wavetable', 'core.strings', 'claude.choir-loft', 'core.mallets', 'core.ensemble', 'core.choir', 'core.pluck', 'core.barisax', 'core.cello'],
  played: ['core.keys', 'core.upright', 'core.wavetable', 'core.mallets', 'core.grand', 'core.vibes', 'core.brass', 'core.piano', 'core.pluck', 'core.eguitar'],
  chords: ['core.keys', 'core.upright', 'core.pad', 'core.strings', 'core.grand', 'core.ensemble', 'core.ep', 'core.piano', 'core.organ', 'core.poly2'],
  bass: ['core.bassguitar', 'core.bass', 'claude.sub-basement', { device: 'core.wavetable', preset: 'Low Key' }, 'core.ebass', { device: 'core.poly2', preset: 'Ladder bass' }],
  drums: [{ device: 'core.drums', preset: 'Studio kit' }, 'core.drumkit', 'core.drumroom', { device: 'core.drums', preset: 'Boom bap' }, 'core.brushkit', 'core.handkit', { device: 'core.drums', preset: 'Trap' }, { device: 'core.drums', preset: 'Live room' }],
};
const rowOf = (r) => (typeof r === 'string' ? { device: r, preset: null } : r && (r.device || r.id) ? { device: r.device || r.id, preset: r.preset || null } : null);
async function setsOrder(app, track) {
  let S = null, kindOf = null;
  try { const m = await import('../core/sounds.js'); S = m.SOUND_SETS || null; kindOf = m.kindOfTake || null; } catch (e) { /* the table above */ }
  const rows = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(rowOf).filter(Boolean);
    return [...(v.rows || v.sounds || v.list || []), ...(v.fallbacks || v.fallback || [])].map(rowOf).filter(Boolean);
  };
  const sets = S && typeof S === 'object' && Object.keys(S).length ? Object.fromEntries(Object.entries(S).map(([k, v]) => [k, rows(v)])) : Object.fromEntries(Object.entries(SETS_TABLE).map(([k, v]) => [k, rows(v)]));
  const def = app.devices.getDevice(track.instrument?.device);
  const drums = def?.cat === 'drums';
  let first = drums ? 'drums' : 'played';
  if (!drums) {
    const notes = track.clips.flatMap((c) => (c.kind === 'notes' ? c.notes : []));
    const hummed = (app.input?.recorder?.last?.take?.src === 'hum') || /^melody\b/i.test(track.name);
    try { first = kindOf ? kindOf({ kind: 'notes', src: hummed ? 'hum' : 'keys', notes }) : hummed ? 'hum' : 'played'; } catch (e) { first = hummed ? 'hum' : 'played'; }
    if (!sets[first] || first === 'drums') first = hummed ? 'hum' : 'played';
  }
  const order = [first, ...Object.keys(sets).filter((k) => k !== first && (k === 'drums') === drums)];
  const out = order.flatMap((k) => sets[k] || []);
  // then the rest of the studio's instruments of the same kind, in the browser's order
  for (const d of app.devices.listDevices({ kind: 'instrument' })) if ((d.cat === 'drums') === drums) out.push({ device: d.id, preset: null });
  return out;
}
const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four'];
const listed = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
async function sceneSounds(app, { say, tool }, ask) {
  const p = app.store.get();
  const selId = coherentSelection(app).track;
  let track = selId ? p.tracks.find((x) => x.id === selId) : null;
  if (!track) { try { track = (await import('./sounds-tool.js')).newestNewTrack(app); } catch (e) { /* none */ } }
  if (!track) { await say('Which track? Click its name, then ask again.'); return; }
  if (track.kind === 'audio') { await say(`${track.name} is an audio track: sounds are for instrument tracks. Its effects are in the Devices tab.`); return; }
  const was = app.devices.getDevice(track.instrument?.device);
  if (ask.kind === 'set') {
    const def = app.devices.getDevice(ask.device);
    if (track.instrument?.device === ask.device) { await say(`${track.name} plays ${def.name} already.`); return; }
    const r = await tool('apply_ops', { label: `${track.name}: ${def.name}`, reason: `they asked for ${def.name}`, ops: [{ type: 'instrument.set', track: track.id, device: ask.device }] });
    if (r.error) { await say(r.error === 'recording' || /recording/.test(r.error) ? `After the take: ${track.name} is recording.` : `I couldn't change it: ${r.error}.`); return; }
    await say(`${track.name} plays ${def.name} now (was ${was?.name || 'nothing'}). Undo takes it back.`);
    return;
  }
  // the next four that aren't on the card (or, with no card on this track, the house's four the card would show)
  const now = { device: track.instrument?.device, preset: app.devices.presetOf?.(was, track.instrument?.params)?.name || null };
  const key = (r) => `${r.device}|${String(r.preset || '').toLowerCase()}`;
  const order = await setsOrder(app, track);
  const seen = new Set([key(now), `${now.device}|`]);
  const cur = app.sounds?.current;
  // (what the card shows on this track, and the house's rows it would show: both are on screen or about to be)
  let house = null;
  try { house = app.sounds?.setsFor?.(track.id) || null; } catch (e) { house = null; }
  const onCard = [...(cur && cur.track === track.id && Array.isArray(cur.rows) ? cur.rows : []), ...(Array.isArray(house) ? house : [])];
  for (const r of onCard) { const x = rowOf(r); if (x) seen.add(key(x)); }
  // (no card to ask: the house's four from the sets, as the card would show them)
  if (!Array.isArray(house)) { let n = 0; for (const r of order) { if (n >= 4) break; if (!app.devices.getDevice(r.device) || seen.has(key(r))) continue; seen.add(key(r)); n++; } }
  const pick = [];
  for (const r of order) {
    if (pick.length >= 4) break;
    const def = app.devices.getDevice(r.device);
    if (!def || def.kind !== 'instrument' || seen.has(key(r))) continue;
    if (r.preset && !(def.presets || []).some((x) => x.name.toLowerCase() === String(r.preset).toLowerCase())) continue;
    seen.add(key(r));
    const why = String(def.blurb || def.kindLabel || def.name).replace(/\s+/g, ' ').trim();
    pick.push({ device: r.device, ...(r.preset ? { preset: r.preset } : {}), why: why.length > 60 ? why.slice(0, 59).replace(/[\s,;:]+\S*$/, '') + '…' : why });
  }
  if (!pick.length) { await say(`That's every sound I know for ${track.name}. More sounds on the card opens the browser.`); return; }
  const r = await tool('suggest_sounds', { track: track.id, sounds: pick, reason: 'they asked for other sounds' });
  if (r.error) {
    if (r.error === 'the person is recording') { await say('After the take: the card holds still while you record.'); return; }
    await say(`I couldn't put them on the card (${r.error}). Try ${listed(pick.map((x) => app.devices.getDevice(x.device).name))} from the browser.`);
    return;
  }
  const names = (r.sounds || []).map((x) => x.name);
  const tapOrClick = globalThis.matchMedia?.('(max-width: 899px)')?.matches ? 'Tap' : 'Click';
  await say(`${COUNT_WORDS[names.length] || names.length} more for ${r.track?.name || track.name}: ${listed(names)}. ${tapOrClick} one to hear it.`);
}
async function sceneStudio(app, { say }, ask) {
  const ws = app.ui.workspace;
  // one studio: everything is on screen, and Find (⌘K) reaches anything (ui/workspace.js); ?view=simple is a URL only
  if (ask.kind === 'view') {
    await say(ws.view() === 'simple' ? 'This is the simple view, for this visit. Full studio, top right, shows everything; Find (⌘K) reaches anything.' : 'There’s one studio now: everything is on screen, and Find (⌘K) gets you anywhere in it.');
    return;
  }
  if (ask.kind === 'intro') {
    await say('Hum, tap or play an idea and I’ll play over it. Ask me for a bassline, or where anything is.');
    pointAt(app, (b) => /^tap a beat$/i.test(b.textContent.trim()));
    return;
  }
  const f = ws.FEATURES.find((x) => x.id === ask.id);
  const name = `${f.the ? 'the ' : ''}${f.title}`;
  if (app.input?.recorder?.state && app.input.recorder.state !== 'idle') { await say(`${cap1(name)} can wait until the take is in: the screen holds still while you record.`); return; }
  // (layout, never the song: the panel is shown and the control pointed at, as Find's Go to does, signed by the agent)
  try { ws.go?.(f.id, { by: 'claude' }); } catch (e) { /* saying where is the answer */ }
  const where = ws.where?.(f.id);
  await say(where ? `${cap1(where)}: it’s showing now.` : `${cap1(name)} is on screen.`);
}
// a finger on something that isn't in the song (the blank sheet's first door): an outline in agent ink for a few
// seconds, never focus (the person's cursor stays where it is). match(button) picks it.
function pointAt(app, match, ms = 6000) {
  try {
    const doc = globalThis.document;
    if (!doc) return;
    const b = [...doc.querySelectorAll('.ar-empty button, .ew-region-center button')].find((x) => x.getClientRects().length && match(x));
    if (!b) return;
    b.classList.add('ag-pointed');
    setTimeout(() => b.classList.remove('ag-pointed'), ms);
  } catch (e) { /* a nicety */ }
}

/* ------------------------------------------------------------------ what the script knows */
// The demo is a script: these are the only things it can do. Anything else gets an honest answer and its real moves.
const WORDS = /\b(warm|bright|dark|mud|space|punch|air|wide|lazy|lazier|laid|swing|tight|lush|thin(?!g)|full|harsh|smooth|gritt|dirt|dry|distant|louder|quieter)/;
const AUTO = /\b(fade[sd]?|fading|automat\w*|sweep\w*|swells?|open (up )?the filter|filter sweep|over (the )?(chorus|verse|intro|outro|bridge|bars? \d+|last bar|first bar))\b|\b(filter|cutoff)\b[^,;.]*\b(up|down|open|close)\b|\bopen\b[^,;.]*\b(filter|cutoff)\b/;
// a beat in a style the groove library has ("give me a funk beat", "a bossa groove"): takes from the library
const GROOVE_ASK = { test: (s) => /\b(beat|beats|groove|grooves|drums?|drum part|drum track|rhythm|pattern)\b/.test(s) && !/\b(around|under|over|behind)\b/.test(s) && !!styleIn(s) };
// a riff ("give me a riff for the chorus", "a guitar riff over the verse", "tab for bars 5-8"): the house riff writer's
const RIFF_ASK = /\briffs?\b|\bguitar (part|line|tabs?)\b|\btabs? (for|over)\b/;
// a device someone else made ("find me a delay someone made", "one from the community", "an echo off the shelf"): the
// community shelf's, offered on a card (find_community_device put_on), never a new one built from words
const SHELF_ASK = /\b(community|(the|a|off the|from the|on the) shelf|some ?one else'?s|somebody else'?s|other people'?s|(some ?one|somebody|other people|people) (has |have )?(made|built|wrote|shared)|one that exists|already exists)\b/;
const SCENES = [
  ['shelf', SHELF_ASK],
  ['riff', RIFF_ASK],
  ['groove', GROOVE_ASK],
  ['undo', /\b(undo|revert|take (it|that) back|go back)\b/],
  // the nearest things it has to a new part, as an off-script answer's chips say them ("Play a line over the bass in
  // the chorus", "Build a bass around the drums", "Double it an octave up")
  ['line', /\ba (counter[- ]?)?line over\b/],
  ['band', /\bbuild (me )?((a|some) )?(bass ?(line)?|chords|drums|beat|pad)\b(?! ?(pedal|effect|fuzz|drive|distortion|overdrive|amp|reverb|delay|device|plugin)s?\b)/],
  ['double', /\bdouble\b(?![- ]time)|\ban octave (up|down|higher|lower)\b/],
  ['auto', AUTO],
  ['capture', /\b(hum|hummed|humming|sang|sing|whistle|whistled|captured?|tapped|beatboxed|i played|i recorded|my (idea|take|hum|beat|tap|phrase)|an idea)\b/],
  ['device', /\b(pedal|effect|device|fuzz|distortion|overdrive|delay|reverb|luthier|instrument|plugin|saturation)s?\b|\bbuild (me )?(a|an|one)\b/],
  ['word', WORDS],
  ['tour', /\b(groove|variations?|busier|play over|over (it|this|that|my|the)|takes?|show me|what would you|what you would)\b/],
  ['chat', /^(hi|hello|hey|yo|help|what can you do|who are you)\b/],
];
// a new part ("add a bassline", "write a melody", "a counter-melody that answers the bass"): the script plays over parts
// you have, it doesn't write new ones from words (FRESH-EYES-5: a counter-melody replayed the takes over the drums)
const NEWPART = /\b(add|write|give me|compose|create)\s+(me\s+)?((a|an|some|the|another|new|a new)\s+)?([\w'-]+\s+)?(bass ?lines?|(counter[- ]?)?melod(y|ies)|counter[- ]?lines?|tunes?|chords?|chord progression|harmon(y|ies)|songs?|lyrics|vocals?|verse|chorus|intro|outro|bridge)\b/;
// a question ("what is this pedal doing?", "which track is loudest?"): the script has moves, not answers, so it never
// takes one for a move. (The Jam room's questions are tried before this: they have their answers.)
const QUESTION = /^(what|which|how (does|do|is|are|can|could|should|would|did|much|many)|why|explain|tell me (about|what|why|how)|is (it|this|that|the|there)|are (they|these|those|the|there)|does|can you (tell|explain|say))\b/;
const NOT_A_QUESTION = /\bwhat (would|could|can) you\b|\bwhat you would\b|^what (if|about)\b/;
const FILLER = /^(i'?ll|i will|i'?d|thanks|thank you|please|ok|okay|cool|nice|great|so|now|it|that|this|for me|if you can|you know|like a (build|riser|swell)|as a (build|riser)|slowly|gently|smoothly)\b/;

/* ------------------------------------------------------------------ the Jam room's asks */
// The Jam room's chips (ui/jam.js: "What scale works over the chorus?", "Show me a lick into the D7 at bar 17", "What
// tone would suit this song?", "Make me a slow blues in E") and the same asks typed. They're tried before every other
// scene: the take tour took "over the" and "show me", so the room's own questions got three takes over the bass
// (FRESH-EYES-6 guitarist #2, phone #3).
const LICK_ASK = /\blicks?\b/;
const COMPARATIVE = /\b(more|less|too|warmer|brighter|darker|fuller|thinner|wider|narrower|drier|wetter|louder|quieter|softer|harder|smoother|grittier|dirtier|cleaner|punchier|tighter|crunchier|heavier|lighter)\b/;
// choosing a tone ("what tone would suit this song?", "a funk tone", "load the blues rig"), not moving one ("make the
// tone warmer" is a measured move; "the tone knob" a knob)
const TONE_ASK = { test: (s) => /\b(tones?|rigs?|amp sounds?|guitar sounds?)\b/.test(s) && /\b(what|which|a|an|some|another|new|different|other|good|right|best|suits?|suited|fits?|recommend\w*|find|load|pick|choose|try|swap|change|like|for (this|the|my) (song|jam|track))\b/.test(s) && !/\b(knobs?|dials?|controls?)\b/.test(s) && !COMPARATIVE.test(s) };
// a backing track to play over ("make me a slow blues in E", "a funk jam in E minor", "a backing track"), not a beat
// (the groove library's), a riff, a tone or a part
const JAM_WORDS = /\b(blues|shuffle|twelve[- ]bar|12[- ]bar|funk|funky|indie|ballad|neo[- ]?soul|soul|r&b|rnb|metal|djent|reggae|dub|ska|bossa( nova)?|jazz|latin|lo-?fi|lo fi|chill|hip[- ]?hop|rock|pop)\b/;
const JAMTRACK_ASK = { test: (s) => (/\b(jam|backing) tracks?\b|\bsomething to (jam|play|solo|practi[sc]e) (over|along|to|with)\b/.test(s) || (/\b(make|give|build|start|open|create|play|put on|set up)\s+(me\s+|us\s+)?(a|an|some)\b/.test(s) && JAM_WORDS.test(s))) && !/\b(beats?|grooves?|drums?|fills?|patterns?|riffs?|licks?|tones?|rigs?|amps?|pedals?|effects?|bass ?lines?|melod\w*|chords?|pads?|counter\w*)\b/.test(s) };
// the notes to play: a scale, a key, what to solo with, the chords ("what scale works over the chorus?", "which scale
// fits?", "what should I play over this?", "what key is it in?", "what are the chords?")
const SCALE_ASK = /\b(what|which)\b(?! if\b| about\b)[^.?!]*\b(scales?|modes?|pentatonics?|key)\b|\bwhat notes (can|could|should|do|would|to|work|fit|go|sound)\b|\bnotes (to play|that (fit|work))\b|\b(what|how) (should|can|could|do) i (solo|improvi[sz]e|play|jam)\b|\b(solo|improvi[sz]e|noodle) (over|on|in|with)\b|\bshow me (the |a )?(scale|box|pentatonic)\b|\bwhat (are|'re) the (chords|changes)\b|\b(what|which) chords (are|is|does|do|in)\b|\bwhat'?s the (chord )?progression\b/;
// tried first, in this order (a lick before a scale: "what lick should I play over this?")
const JAM_SCENES = [['lick', LICK_ASK], ['tone', TONE_ASK], ['jamtrack', JAMTRACK_ASK], ['scale', SCALE_ASK]];
// a guitarist's words: an ask with these that no Jam scene took is past the script, never a take tour
const GUITARISH = /\b(scales?|modes?|pentatonics?|arpeggios?|frets?|fretboard|neck|licks?|solos?|soloing|improvi[sz]\w*|strum\w*|capo|tunings?|tuner|chord shapes?|voicings?|tones?|rigs?|amps?|jam tracks?|backing tracks?)\b/;
// what the room's chips ask, as the demo's own moves (an off-script answer in the Jam room offers these)
const JAM_MOVES = ['What scale works over this song?', 'Show me a lick I can play over this', 'What tone would suit this song?', 'Give me a riff for this section'];
const JAMTRACK_MOVES = ['Make me a slow blues in E', 'Make me a funk jam in E minor', 'Make me an indie jam in G'];
const inJam = (app) => { try { return !!app.ui?.visible?.('jam'); } catch (e) { return false; } };

function sceneOf(s) {
  // the Jam room's asks come first: a guitarist's question has its answer there, never a take tour
  for (const [name, re] of JAM_SCENES) if (re.test(s)) return name;
  if (NEWPART.test(s) || /\bcounter[- ]?melod/.test(s) || (QUESTION.test(s) && !NOT_A_QUESTION.test(s))) return null;
  // (a range alone, "over the chorus", is no automation move: it needs one, a fade or a sweep)
  for (const [name, re] of SCENES) {
    if (!re.test(s) || (name === 'auto' && !ACTION.test(s))) continue;
    return name === 'tour' && GUITARISH.test(s) ? null : name;
  }
  return null;
}
const CLAUSE = /\s*(?:[,;.!?]|\band\b|\bthen\b|\balso\b|\bplus\b|—|–)\s*/;
// -> { scene, rest, clauses }: the scene for the ask, the clauses of it the script can't do, and every clause (the
// automation scene does one move per clause)
export function route(t) {
  t = String(t).toLowerCase().replace(/[‘’]/g, "'");
  const clauses = t.split(CLAUSE).map((c) => c.trim()).filter(Boolean);
  // the scene comes from the ask with the new-part clauses taken out (so "add a bassline" never runs the take tour)
  const kept = clauses.filter((c) => !NEWPART.test(c)).join(' ');
  const scene = NEWPART.test(t) && !kept ? null : sceneOf(kept || t);
  const rest = scene ? clauses.filter((c) => (NEWPART.test(c) || (c.split(/\s+/).length >= 2 && !FILLER.test(c) && !sceneOf(c)))) : [];
  return { scene, rest, clauses };
}
// The closest thing the script can do to what was asked, as words and as a move chip (none: nothing close). A new tune
// (a melody, a counter-melody, a harmony) is a line over the part the ask names, on its own track; a new bass, chords,
// drums or pad is Band's, around the part it names; each over the bars or section it names. The chip says the track and
// the bars, so what runs is what was named, not whatever is selected by then.
const CLOSEST = [
  // a guitarist's ask past the Jam scenes: the room's own moves
  [/\b(scales?|modes?|pentatonics?|solos?|soloing|improvi[sz]\w*|arpeggios?|frets?|fretboard|neck|chord shapes?|voicings?)\b/, 'show the scale that fits on the neck, with the notes that change with the chords', 'What scale works over this song?'],
  [/\blicks?\b|\bphrases?\b/, 'show a two-bar lick into the next chord, on the neck', 'Show me a lick I can play over this'],
  [/\b(tones?|rigs?|amps?|sound like)\b/, 'find tones that match the song’s style among the Guitar Studio’s rigs, and load the one you pick', 'What tone would suit this song?'],
  [/\b(jam tracks?|backing tracks?|jam along|play along)\b/, 'make a jam track to play over, in a style and a key', 'Make me a slow blues in E'],
  [/happ|cheer|upbeat|uplift|joy|sunn|positive/, 'make it brighter (a measured move on its tone)', 'Make it brighter'],
  [/sad|moody|melanchol|gloom|sombre|somber/, 'make it darker (a measured move on its tone)', 'Make it darker'],
  [/melod|counter|harmon|tune|riff|\bhook\b|(?<!bass )\bline\b|answer/, (app, text) => lineMove(app, text)],
  [/bass ?line|\bbass\b|\bchords?\b|\bdrums?\b|\bbeat\b|\bpad\b/, (app, text) => bandMove(app, text)],
  [/\bfill\b|four on the floor|kick on every/, 'play takes over your beat (one lifts into each bar, one is four on the floor)', 'Play over this beat'],
  [/bass ?line|melod|tune|chord|harmon|counter|part\b|notes?\b/, 'play a few takes over a part you already have, built from its notes', 'Play over this part'],
  [/drum|beat|rhythm|groove/, 'play takes over a beat you already have', 'Play over this beat'],
  [/loud|quiet|volume|level|mix/, 'fade a part in or out, as a lane on its fader', 'Fade it in over 4 bars'],
  [/fx|effect|pedal|sound|tone|texture/, 'build a small effect and measure it', 'Build me a warm effect'],
];
const GUITAR_CLOSEST = 4;   // the first entries above are the Jam room's: when one fits, the others don't ("chord shapes" is no Band part)
function closestTo(app, text) {
  const out = [];
  for (const [i, [re, words, move]] of CLOSEST.entries()) {
    if (!re.test(text)) continue;
    if (i >= GUITAR_CLOSEST && out.some((y) => y.guitar)) break;
    const x = typeof words === 'function' ? words(app, text) : { words, move };
    if (x && !out.some((y) => y.move === x.move)) out.push({ ...x, guitar: i < GUITAR_CLOSEST });
  }
  return out.slice(0, 2);
}
// The script's real moves, as chips that send them (they all route to a scene above); the closest ones first. In the
// Jam room, the room's own questions.
function movesFor(app, first = []) {
  if (inJam(app)) return [...new Set([...first, ...JAM_MOVES])].slice(0, 4);
  const t = pickTrack(app);
  const drums = t && /drum/.test(t.instrument?.device || '');
  const moves = drums ? ['Play over this beat', 'Make it lazier', 'Build me a fuzz pedal', 'Fade it in over 4 bars'] : ['Play over this part', 'Make it darker', 'Fade it in over 4 bars', 'Build me a fuzz pedal'];
  try { if (app.input?.capture?.latest?.()) moves.unshift('Place my take'); } catch (e) { /* no captures */ }
  return [...new Set([...first, ...moves])].slice(0, 4);
}
// how to get a live model, in plain words first; the how (Claude Code, in the panel or over MCP) on the quieter line
const LIVE = 'Want me to do anything you type? Use your own Claude (Use a live agent, below): then a live model reads every word.';
const LIVE_FINE = 'A live agent: Claude Code on your computer, on your Claude plan, in this panel or connected over MCP (Use a live agent says how).';
const quote = (c, n = 50) => `“${c.length > n ? c.slice(0, n - 3).trimEnd() + '…' : c}”`;
const CAN_DO = 'What I can do here, on the real tools: play takes over a part, play a line over one on its own track, turn a word like darker or more space into a measured move, build a small effect, or place a take you hummed or tapped.';
const CAN_DO_JAM = 'What I can do in the Jam room, on the real tools: show the scale that fits on the neck, a lick into the next chord, tones that match the song’s style, riffs for a section, or a jam track to play over.';
async function sceneOffScript(app, { say, fine, emit, turn }, text) {
  const near = closestTo(app, text.toLowerCase().replace(/[‘’]/g, "'"));
  await say(`I can't do that one: I'm the scripted demo, not a live model, so ${quote(text, 70)} is past me. ${near.length ? `The closest I can do: ${near.map((x) => x.words).join(', or ')}.` : inJam(app) ? CAN_DO_JAM : CAN_DO}`);
  emit('moves', { turn, moves: movesFor(app, near.map((x) => x.move)), live: true });
  await say(`\n\n${LIVE}`);
  fine(LIVE_FINE);
}
async function offScriptNote(app, { say, fine, emit, turn }, rest) {
  const list = rest.map((c) => quote(c)).join(' and ');
  const near = closestTo(app, rest.join(' '));
  await say(`I can't do ${list}: I'm the scripted demo, not a live model. ${near.length ? `The closest I can do is ${near.map((x) => x.words).join(', or ')}. ` : ''}${LIVE}`);
  fine(LIVE_FINE);
  emit('moves', { turn, moves: movesFor(app, near.map((x) => x.move)), live: true });
  await say('\n\nHere is the part I can do. ');
}

/* ------------------------------------------------------------------ plain words */
// "the keys are", "the bass is"
const plural = (name) => /s$/i.test(name) && !/(bass|ss)$/i.test(name);
const the = (t) => `the ${t.name.toLowerCase()}`;
const isAre = (t) => (plural(t.name) ? 'are' : 'is');
const verbS = (t, v) => (plural(t.name) ? v : v.replace(/(s|sh|ch|x)$/, '$1e') + 's');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
// A move that came back offered (a song from a link that isn't the person's yet: agent/keep.js): it's on a card, and
// nothing changed until they keep it. Said plainly, never as done.
const offeredLine = (r) => `That would ${r.what || 'change the song'}. This song came from a link and isn't yours yet, so it's on a card: Keep it, or keep it as it was. Nothing changes until you choose.`;
// What a measured change sounds like, in words anyone reads ("fuller and a little louder"); null when it's too small to
// hear. d is a deltas object (render_and_measure / adjust).
export function plainChange(d) {
  if (!d) return null;
  const bits = [];
  const lowShare = ['low', 'lowmid'].map((k) => d.bands?.[k]).filter(Number.isFinite);
  const low = lowShare.length ? lowShare.reduce((a, b) => a + b, 0) / lowShare.length : 0;
  if (Number.isFinite(d.centroidPct) && d.centroidPct >= 6) bits.push('brighter');
  else if (Number.isFinite(d.centroidPct) && d.centroidPct <= -6) bits.push('darker and softer on top');
  if (low >= 1.2) bits.push('fuller');
  else if (low <= -1.2) bits.push('thinner');
  if (Number.isFinite(d.crest) && d.crest <= -1.5) bits.push('denser');
  if (Number.isFinite(d.lufs) && Math.abs(d.lufs) >= 0.7) bits.push(`${Math.abs(d.lufs) < 2.5 ? 'a little ' : ''}${d.lufs > 0 ? 'louder' : 'quieter'}`);
  if (!bits.length) return null;
  return bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
}
// what a part sounds like on its own, from one measurement's band shares
const BAND_PLAIN = { sub: 'a deep, rumbling sound', low: 'a warm, low-heavy sound', lowmid: 'a warm, round sound', mid: 'a solid sound, mostly in the middle', highmid: 'a forward, bright sound', presence: 'a bright sound, up front', air: 'an airy, light sound' };
function plainCharacter(m) {
  const top = Object.entries(m?.bands || {}).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1])[0];
  return top ? BAND_PLAIN[top[0]] || null : null;
}

/* ------------------------------------------------------------------ scenes */
// It works on what plays: the playing take (a muted clip stays in the song and plays nowhere), on a track that is
// heard. A track named in the ask comes first, then what you selected; when that is muted, the take playing over the
// same bars, and when nothing there plays, it says so instead of working on silence.
const playing = (c) => !c.mute && !!c.notes?.length;
const SILENT = -50;   // LUFS: a part this quiet on its own is near silence, not a sound to describe
// a finger, not a mouse: what to press becomes what to tap
const touch = () => { try { return !!globalThis.matchMedia?.('(pointer: coarse)').matches; } catch (e) { return false; } };
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
// Why a track can't be heard, said once, and the remedy for that reason (null: it can be heard). FRESH-EYES-6 phone
// #10: a soloed track was "silent, so there's nothing of it to hear. Unmute it (select the clip and press 0)": the
// wrong remedy, "so" twice, and a key a phone doesn't have.
//   -> { said: 'Drums is soloed, so the bass is silent.', fix: 'Unsolo it (the S on its header)' }
function unheard(app, t) {
  const p = app.store.get();
  if (!t) return null;
  const n = t.name.toLowerCase(), tap = touch();
  if (t.mute) return { said: `The ${n} track is muted, so there's nothing of it to hear.`, fix: `Unmute it (${tap ? 'tap the M' : 'the M'} on its header)` };
  const solos = p.tracks.filter((x) => x.solo && x !== t);
  if (!t.solo && solos.length) {
    const one = solos.length === 1, who = andList(solos.map((x) => x.name));
    return { said: `${who} ${one ? 'is' : 'are'} soloed, so the ${n} is silent.`, fix: `Unsolo ${one ? 'it' : 'them'} (${tap ? 'tap the S' : 'the S'} on ${one ? 'its header' : 'their headers'})` };
  }
  if (Number.isFinite(t.gain) && t.gain <= -60) return { said: `The ${n} fader is all the way down, so there's nothing of it to hear.`, fix: 'Bring its fader up in the Mixer' };
  return null;
}
function pickTrack(app, prefer = /bass/i) {
  const p = app.store.get();
  const sel = coherentSelection(app);
  const has = (t) => t.kind === 'instrument' && t.clips.some((c) => c.notes?.length);
  const live = (t) => t.kind === 'instrument' && t.clips.some(playing) && !unheard(app, t);
  const selT = sel.track && p.tracks.find((x) => x.id === sel.track);
  if (selT && has(selT)) return selT;
  if (sel.clip) { const f = app.store.findClip(sel.clip); if (f && f.track.kind === 'instrument') return f.track; }
  return p.tracks.find((x) => prefer.test(x.name) && live(x)) || p.tracks.find(live) || p.tracks.find((x) => prefer.test(x.name) && has(x)) || p.tracks.find(has) || null;
}
// The tracks an ask names ("the bass filter", "fade the keys out"), in the order it names them. A named track beats the
// selection (the scope chip): "open the bass filter" with Keys selected is the bass.
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function namedTracks(app, text) {
  const p = app.store.get(), found = [];
  for (const tr of p.tracks) {
    if (tr.kind !== 'instrument') continue;
    const n = tr.name.toLowerCase().trim();
    const forms = [...new Set([n, n.replace(/s$/, ''), n.replace(/\s*\d+$/, '')])].filter((x) => x.length >= 3);
    let at = -1;
    for (const f of forms) { const m = new RegExp(`\\b${reEsc(f)}(s|es)?\\b`).exec(text); if (m && (at < 0 || m.index < at)) at = m.index; }
    if (at >= 0) found.push({ tr, at, len: n.length });
  }
  // "verse 2" over "verse"; then the order they're named in
  return found.sort((a, b) => a.at - b.at || b.len - a.len).map((x) => x.tr).filter((tr, i, all) => all.indexOf(tr) === i);
}
function pickClip(app, t) {
  const sel = coherentSelection(app);
  const s = t.clips.find((c) => c.id === sel.clip && c.notes?.length);
  if (s && !s.mute) return s;
  if (s) return t.clips.find((c) => c !== s && playing(c) && c.start < s.start + s.length - 1e-9 && s.start < c.start + c.length - 1e-9) || s;
  return t.clips.find(playing) || t.clips.find((c) => c.notes?.length) || null;
}

/* ------------------------------------------------------------------ what an ask names */
// A track by what it is, not only by its name: "the bass line" is the track with a bass on it, whatever it's called
// (FRESH-EYES-5 producer: Flatwound); "my beat" the drums. Only after a word that points at a part ("the", "my",
// "over"…), so "add a bassline" names no track.
const isDrumTrack = (app, t) => /drum/.test(t.instrument?.device || '') || app.devices?.getDevice?.(t.instrument?.device)?.cat === 'drums';
const hasNotes = (t) => t.kind === 'instrument' && t.clips.some((c) => c.notes?.length);
const ROLES = [
  ['bass', /\b(the|my|your|this|that|over|under|on|with|around) bass( ?lines?)?\b/, (app, t) => app.devices?.getDevice?.(t.instrument?.device)?.cat === 'bass' || /bass/i.test(`${t.name} ${t.instrument?.device || ''}`)],
  ['drums', /\b(the|my|your|this|that|over|under|on|with|around) (drums?|beat|kit)\b/, (app, t) => isDrumTrack(app, t)],
  ['keys', /\b(the|my|your|this|that|over|under|on|with|around) (keys|piano|organ)\b/, (app, t) => app.devices?.getDevice?.(t.instrument?.device)?.cat === 'keys' || /keys|piano|organ/i.test(t.name)],
];
// the track an ask names (by name first, then by what it is), with notes; pitched: not drums. null: none named
export function partNamed(app, text, { pitched = false } = {}) {
  const ok = (t) => hasNotes(t) && (!pitched || !isDrumTrack(app, t));
  const byName = namedTracks(app, text).find(ok);
  if (byName) return byName;
  const p = app.store.get();
  for (const [, re, is] of ROLES) if (re.test(text)) { const t = p.tracks.find((x) => ok(x) && is(app, x)); if (t) return t; }
  return null;
}
// the selected part (its track, or its clip's), with notes; pitched: not drums
function selectedPart(app, { pitched = false } = {}) {
  const sel = coherentSelection(app), p = app.store.get();
  const t = (sel.track && p.tracks.find((x) => x.id === sel.track)) || (sel.clip && app.store.findClip(sel.clip)?.track) || null;
  return t && hasNotes(t) && (!pitched || !isDrumTrack(app, t)) ? t : null;
}
// a part that plays (heard first), with notes; pitched: not drums; not: a test it must fail
function anyPart(app, { pitched = false, not = null } = {}) {
  const ok = (t) => hasNotes(t) && (!pitched || !isDrumTrack(app, t)) && !(not && not(t));
  const ts = app.store.get().tracks.filter(ok);
  return ts.find((t) => t.clips.some(playing) && !unheard(app, t)) || ts[0] || null;
}
// how a reply names a part: "the bass" for a track called Bass, else its own name ("Flatwound")
const partWords = (t) => (/^(bass|drums|keys|piano|organ|guitar|pad|lead|hook|strings|melody|chords)( \d+)?$/i.test(t.name.trim()) ? `the ${t.name.toLowerCase()}` : t.name);
const theirIts = (t) => (plural(t.name) ? 'their' : 'its');
// The bars an ask names: a section ("the chorus"), bars ("bars 5-8", "bar 5"). -> { a, b (beats), words } | null
export function namedRange(app, text) {
  const p = app.store.get(), bpb = bpbOf(app);
  for (const s of (p.sections || []).slice().sort((x, y) => y.name.length - x.name.length)) {
    if (new RegExp(`\\b(the|over|in|during|through|across|for) ${reEsc(s.name.toLowerCase())}\\b`).test(text)) return { a: s.start, b: s.start + s.length, words: `in the ${s.name.toLowerCase()}` };
  }
  let m = /\bbars? (\d+)\s*(?:-|–|to|through|and)\s*(\d+)\b/.exec(text);
  if (m && +m[2] >= +m[1] && +m[1] >= 1) return { a: (m[1] - 1) * bpb, b: m[2] * bpb, words: `in bars ${m[1]}–${m[2]}` };
  m = /\bbar (\d+)\b/.exec(text);
  if (m && +m[1] >= 1) return { a: (m[1] - 1) * bpb, b: m[1] * bpb, words: `in bar ${m[1]}` };
  return null;
}
// a part's own bars when the ask names none: its selected clip, else the first that plays
function clipRange(app, t) {
  const c = pickClip(app, t);
  if (!c) return null;
  const [x, y] = clipBars(app, c), bpb = bpbOf(app);
  return { a: (x - 1) * bpb, b: y * bpb, words: y > x ? `in bars ${x}–${y}` : `in bar ${x}` };
}
// the notes a part plays over [a, b) (its clips that play), from a, in beats
function notesOver(t, a, b) {
  const out = [];
  for (const c of t.clips) {
    if (c.mute || c.kind === 'audio' || !c.notes?.length) continue;
    for (const n of c.notes) {
      const at = c.start + n.t;
      if (n.t < c.length && at >= a - 1e-9 && at < b - 1e-9) out.push({ p: n.p, t: Math.round((at - a) * 1e4) / 1e4, d: Math.max(1 / 32, Math.min(n.d, b - at)), v: n.v ?? 0.8 });
    }
  }
  return out.sort((x, y) => x.t - y.t || x.p - y.p);
}
// "Play a line over the bass in the chorus": the nearest the script gets to a melody, a counter-melody or a harmony
function lineMove(app, text) {
  const src = partNamed(app, text, { pitched: true }) || selectedPart(app, { pitched: true }) || anyPart(app, { pitched: true });
  const rg = src && (namedRange(app, text) || clipRange(app, src));
  if (!rg) return null;
  return { words: `play a line over ${partWords(src)} ${rg.words}, on its own track, built from ${theirIts(src)} notes`, move: `Play a line over ${partWords(src)} ${rg.words}` };
}
// "Build a bass around the drums": Band's part, on its own track. The part is what the ask wants made (before "around",
// "with"…), the seed the part it names after that, else the selected one, else one that plays
const BAND_PART = { bass: 'a bass', chords: 'chords', drums: 'drums', pad: 'a pad' };
function bandPart(text) {
  const head = String(text).split(/\b(?:around|under|with|for|to|over|behind|that goes)\b/)[0];
  return /chord/.test(head) ? 'chords' : /\bpad\b/.test(head) ? 'pad' : /\bbass/.test(head) ? 'bass' : /\b(drums?|beat)\b/.test(head) ? 'drums' : 'bass';
}
function bandSeed(app, text, part) {
  const isPart = (t) => (part === 'drums' ? isDrumTrack(app, t) : part === 'bass' ? ROLES[0][2](app, t) : false);
  const tail = (/\b(?:around|under|with|for|to|over|behind) (.+)$/.exec(text) || [])[1] || '';
  const t = [tail && partNamed(app, tail), selectedPart(app)].find((x) => x && !isPart(x)) || anyPart(app, { not: isPart });
  const c = t && pickClip(app, t);
  return c ? { track: t, clip: c } : null;
}
function bandMove(app, text) {
  // (only for an ask that wants one of Band's parts made: "answers the bass line" wants a tune, not a bass)
  if (!/chord|\bpad\b|\bbass|\b(drums?|beat)\b/.test(String(text).split(/\b(?:around|under|with|for|to|over|behind|that goes)\b/)[0])) return null;
  const part = bandPart(text), seed = bandSeed(app, text, part);
  if (!seed) return null;
  const what = BAND_PART[part];
  return { words: `build ${what} around ${partWords(seed.track)} with Band, on ${part === 'chords' || part === 'drums' ? 'their' : 'its'} own track`, move: `Build ${what} around ${partWords(seed.track)}` };
}
// What is in the way of hearing this clip on this track, said once with its remedy, as one sentence the scene can say
// (null: nothing). before: words for between the two ("I'd be building it blind.").
function quietWhy(app, t, c, before = '') {
  let q = unheard(app, t);
  if (!q && c && c.mute) {
    const [b0, b1] = bars(app, c), tap = touch();
    q = { said: `The ${t.name.toLowerCase()} clip in ${b1 > b0 ? `bars ${b0}–${b1}` : `bar ${b0}`} is muted (it stays in the song and plays nowhere), so there's nothing of it to hear.`, fix: `Unmute it (${tap ? 'hold the clip and pick Unmute' : 'select the clip and press 0'})` };
  }
  return q ? `${q.said}${before ? ` ${before}` : ''} ${q.fix}, or ${pickWord()} a part that plays, and ask me again.` : null;
}
const pickWord = () => (touch() ? 'tap' : 'select');
// near silence, nothing muted: another part, then (never "unmute it", when nothing is muted)
const ASK_ANOTHER = () => ` ${cap(pickWord())} a part that plays, and ask me again.`;
const quietLevel = (m) => !!m && !m.error && Number.isFinite(m.lufs) && m.lufs < SILENT;
const bpbOf = (app) => (app.store.get().meter?.[0]) || 4;
const bars = (app, c) => { const b = bpbOf(app); const a = Math.floor(c.start / b) + 1; return [a, Math.min(a + 3, Math.ceil((c.start + c.length) / b))]; };
// a clip's whole span in bars
const clipBars = (app, c) => { const b = bpbOf(app); const a = Math.floor(c.start / b) + 1; return [a, Math.max(a, Math.ceil((c.start + c.length) / b))]; };
// the clip's last (up to) n bars: where a fade out goes, so it ends where the part does instead of holding it at
// -60 dB for the rest of it
const lastBars = (app, c, n = 4) => { const [a, z] = clipBars(app, c); return [Math.max(a, z - n + 1), z]; };
const firstBars = (app, c, n = 4) => { const [a, z] = clipBars(app, c); return [a, Math.min(z, a + n - 1)]; };
const barsWord = (b0, b1) => (b1 > b0 ? `bars ${b0}–${b1}` : `bar ${b0}`);

async function sceneTour(app, { say, fine, tool, think, st, emit, turn, offer, t: text = '' }) {
  await think('Reading the song and what you have selected…', 400);
  await tool('get_project', { detail: 'summary' });
  await tool('get_selection', {});
  // what the ask names comes first ("play over the bass in the chorus"), then the selection
  const t = partNamed(app, text) || pickTrack(app);
  if (!t) { await say("Nothing's been recorded yet. Take 1 is yours: hum it (H) or tap it (T), and I'll play over it."); return; }
  const rg = namedRange(app, text);
  const c = (rg && t.clips.find((x) => playing(x) && x.start <= rg.a + 1e-9 && rg.a < x.start + x.length - 1e-9)) || pickClip(app, t);
  const isDrums = /drum/.test(t.instrument?.device || '');
  const [b0, b1] = bars(app, c);
  const why = quietWhy(app, t, c);
  if (why) { await tool('highlight', { target: { track: t.id, clip: c.id }, note: 'nothing plays here', seconds: 6 }); await say(why); return; }
  await say(`Listening to ${the(t)} first. `);
  await tool('highlight', { target: { track: t.id, clip: c.id }, note: 'listening to this', seconds: 6 });
  const m = await tool('render_and_measure', { tracks: [t.id], bars: [b0, b1] });
  const p = app.store.get();
  if (quietLevel(m)) { await say(`It's near silence over ${barsWord(b0, b1)}, so there's nothing there for me to describe or play over.${ASK_ANOTHER()}`); fine(`${lufs(m.lufs)} LUFS on its own.`); return; }
  if (m && !m.error) {
    const ch = plainCharacter(m);
    await say(ch ? `It's ${ch}. ` : '');
    const g = (m.glosses || []).find((x) => /band/.test(x)) || (m.glosses || [])[0] || '';
    fine(`${lufs(m.lufs)} LUFS on its own${g ? `; ${g.replace(/^most energy in/, 'most of its energy in')}` : ''}.`);
  } else await say(`(I can't render audio in this tab yet, so I'm going by the notes.) `);
  // three takes, built from the human's own notes
  const vars = isDrums ? drumTakes(c) : bassTakes(c, p);
  await say(`Here are three takes over your ${isDrums ? 'beat' : 'part'}, all built from your own notes. Hold a card to hear one; keep it, or keep the original.`);
  const res = await offer({ title: `${t.name} › ${c.name || 'clip'} · ${barsWord(b0, b1)}`, reason: 'three takes over your part, built from your notes', target: { track: t.id, clip: c.id }, variations: vars });
  if (res.status === 'pending') { await say("\n\nThey're on screen. I won't touch the part until you pick."); return; }
  if (res.picked === 'original' || res.index === -1) { await say('\n\nOriginal kept. It already grooves.'); return; }
  await say(`\n\nKept: ${res.picked}. It's in the song, signed with my name; one undo takes it out.`);
  // the next move is offered, never made: nobody asked for an effect, and the person's panels stay where they left them
  if (!st.offered) {
    st.offered = true;
    await say(`\n\nWant it warmer? I can build a small tape-style effect for ${the(t)} and measure it before and after.`);
    emit('moves', { turn, moves: ['Build me a warm effect'], live: false });
  }
}

// Take names lead with a plain word; the theory sits under it (the card's second line).
function bassTakes(c, p) {
  const notes = c.notes.slice().sort((a, b) => a.t - b.t);
  const starts = new Set(notes.map((n) => Math.round(n.t * 4)));
  const pops = [];
  for (const n of notes) {
    const at = n.t + 0.5;
    if (n.d >= 0.75 && !starts.has(Math.round(at * 4)) && at < c.length && pops.length < 8) pops.push(`${noteName(n.p + 12)}@${at}:0.25*0.62`);
  }
  if (!pops.length) for (const n of notes.slice(0, 6)) if (n.t + 0.25 < c.length) pops.push(`${noteName(n.p + 12)}@${n.t + 0.25}:0.25*0.55`);
  const ghosts = [];
  for (const n of notes) {
    if (n.t >= 1 && Math.abs(n.t % 4) < 1e-6 && ghosts.length < 6) ghosts.push(`${noteName(n.p - 1)}@${n.t - 0.25}:0.25*0.42`);
  }
  if (!ghosts.length) for (const n of notes.slice(1, 5)) ghosts.push(`${noteName(n.p - 1)}@${Math.max(0, n.t - 0.25)}:0.25*0.4`);
  const fifths = [];
  for (const n of notes) {
    const at = n.t + 1;
    if (n.d >= 1.5 && at < c.length && !starts.has(Math.round(at * 4)) && fifths.length < 6) fifths.push(`${noteName(n.p + 7)}@${at}:0.5*0.58`);
  }
  if (!fifths.length) for (const n of notes.slice(0, 4)) if (n.t + 0.5 < c.length) fifths.push(`${noteName(n.p + 7)}@${n.t + 0.5}:0.25*0.5`);
  void p;
  return [
    { label: 'walks a little', why: 'a higher note answers each held one, the bottom stays solid (fifths answering the roots)', ops: [{ type: 'notes.add', clip: c.id, notes: fifths.join(' ') }] },
    { label: 'bouncier', why: 'each long note answered higher up, between the beats (octave pops)', ops: [{ type: 'notes.add', track: c._track || undefined, clip: c.id, notes: pops.join(' ') }] },
    { label: 'leans into each bar', why: 'a quiet note just under each bar\'s first note leads into it (chromatic pickups)', ops: [{ type: 'notes.add', clip: c.id, notes: ghosts.join(' ') }] },
  ].map((v) => ({ ...v, ops: v.ops.map((o) => ({ ...o, track: trackOf(c) })) }));
}
function drumTakes(c) {
  const hats = [], kicks = [];
  for (let b = 0; b < Math.min(c.length, 16); b += 1) { hats.push(`42@${b + 0.25}:0.25*0.4`, `42@${b + 0.75}:0.25*0.45`); }
  for (let b = 0; b < Math.min(c.length, 16); b += 1) if (!c.notes.some((n) => n.p === 36 && Math.abs(n.t - b) < 0.01)) kicks.push(`36@${b}:0.25*0.85`);
  return [
    { label: 'busier hats', why: 'quiet extra hi-hats in between the ones you have (ghost 16ths)', ops: [{ type: 'notes.add', track: trackOf(c), clip: c.id, notes: hats.join(' ') }] },
    { label: 'more drive', why: 'a kick on every beat (four on the floor)', ops: [{ type: 'notes.add', track: trackOf(c), clip: c.id, notes: kicks.join(' ') || '36@0:0.25' }] },
    { label: 'lifts into each bar', why: 'an open hi-hat just before each new bar (the "and" of 4)', ops: [{ type: 'notes.add', track: trackOf(c), clip: c.id, notes: Array.from({ length: Math.max(1, Math.floor(Math.min(c.length, 16) / 4)) }, (_, i) => `46@${i * 4 + 3.5}:0.5*0.6`).join(' ') }] },
  ];
}
// find a clip's track id (the mock builds ops from clips)
let _app = null;
function trackOf(c) { const f = _app?.store.findClip(c.id); return f ? f.track.id : undefined; }

/* ------------------------------------------------------------------ the nearest things to a new part */
// A line over a part, on its own track over the bars named (else the part's clip's): the nearest the script gets to a
// melody, a counter-melody or a harmony. Three takes built from that part's notes by the piano roll's own transforms
// (Melody from chords, Transpose in key), offered as cards: nothing changes until one is kept.
async function sceneLine(app, { say, fine, tool, think, offer, t: text }) {
  _app = app;
  await think('Reading the part…', 300);
  await tool('get_project', { detail: 'summary' });
  const src = partNamed(app, text, { pitched: true }) || selectedPart(app, { pitched: true }) || anyPart(app, { pitched: true });
  if (!src) { await say("There's no part with a tune to play a line over yet. Hum or play one (H, or ` for the keys), then ask me again."); return; }
  const why = quietWhy(app, src, null, 'A line over it would answer nothing you can hear.');
  if (why) { await say(why); return; }
  const rg = namedRange(app, text) || clipRange(app, src);
  const notes = rg ? notesOver(src, rg.a, rg.b) : [];
  const who = partWords(src);
  if (!notes.length) { await say(`${cap(who)} ${plural(src.name) ? 'have' : 'has'} no notes ${rg ? rg.words : 'that play'} to build a line over. Name bars where ${plural(src.name) ? 'they play' : 'it plays'}, or select one of ${theirIts(src)} clips.`); return; }
  const bpb = bpbOf(app), b0 = Math.floor(rg.a / bpb + 1e-9) + 1, b1 = Math.max(b0, Math.ceil(rg.b / bpb - 1e-9));
  await tool('highlight', { target: { track: src.id, bars: [b0, b1] }, note: 'a line over this', seconds: 6 });
  const vars = lineTakes(app, src, notes, rg);
  if (vars.length < 2) { await say(`${cap(who)} ${plural(src.name) ? 'play' : 'plays'} too few notes ${rg.words} for me to build lines from.`); return; }
  await say(`Here are ${vars.length === 3 ? 'three' : 'two'} lines over ${who} ${rg.words}, each on its own track, all built from ${theirIts(src)} notes. Hold a card to hear one; keep one, or none.`);
  fine(`Built from ${notes.length} notes of ${src.name}, ${barsWord(b0, b1)}, with Melody from chords and Transpose in key (the piano roll's Transform menu).`);
  const res = await offer({ title: `A line over ${src.name} · ${barsWord(b0, b1)}`, reason: `a line over ${who} ${rg.words}, built from ${theirIts(src)} notes`, target: { track: src.id, bars: [b0, b1] }, variations: vars });
  if (res.status === 'pending') { await say("\n\nThey're on screen. Nothing changes until you pick."); return; }
  if (res.picked === 'original' || res.index === -1) { await say('\n\nNone kept: the song is as it was.'); return; }
  await say(`\n\nKept: ${res.picked}. It's on its own track over ${barsWord(b0, b1)}, signed with my name; one undo takes it out.`);
}
function lineTakes(app, src, notes, rg) {
  const p = app.store.get();
  const ctx = { key: p.key || undefined, meter: p.meter, tempo: p.tempo, start: rg.a };
  const ids = notes.map((n, i) => ({ ...n, id: 'n' + i }));
  const made = (name, params) => { try { return transform(name, ids, params, ctx).notes.filter((n) => !n.id); } catch (e) { return []; } };
  const moved = (name, params) => { try { return transform(name, ids, params, ctx).notes; } catch (e) { return []; } };
  // a line that answers: a little softer than what it answers
  const soft = (ns) => ns.map((n) => ({ ...n, v: Math.round(Math.min(1, Math.max(0.3, (n.v ?? 0.8) * 0.85)) * 100) / 100 }));
  // a harmony moved by octaves to sing over the part (its middle note near A4)
  const lift = (ns) => { if (!ns.length) return ns; const mid = ns.map((n) => n.p).sort((x, y) => x - y)[ns.length >> 1]; const k = Math.round((69 - mid) / 12) * 12; return ns.map((n) => ({ ...n, p: Math.max(0, Math.min(127, n.p + k)) })); };
  const len = rg.b - rg.a, who = partWords(src), its = theirIts(src);
  const inst = /pluck/.test(src.instrument?.device || '') ? 'core.keys' : 'core.pluck';
  const take = (label, why, name, ns) => {
    const keep = ns.filter((n) => n.t < len - 1e-9);
    return keep.length >= 2 ? { label, why, ops: [
      { type: 'track.add', ref: 'line', track: { name, instrument: { device: inst } } },
      { type: 'clip.add', track: '$line', clip: { start: rg.a, length: len, name, notes: formatNotes(keep) } },
    ] } : null;
  };
  return [
    take('moves around it', `a line in eighths on ${who}'s notes: chord tones on the beats, steps between (Melody from chords)`, 'Counter-line', soft(made('melody_from_chords', { rate: 0.5, seed: 1 }))),
    take('calmer', `longer notes with room between them, on the same notes (Melody from chords, in quarters)`, 'Counter-line', soft(made('melody_from_chords', { rate: 1, rests: 0.3, seed: 2 }))),
    take('sings along', `${its} own notes a third up in the key, an octave or two higher (a harmony)`, 'Harmony', soft(lift(moved('transpose', { steps: 2 })))),
  ].filter(Boolean);
}

// Band's bass (or chords, drums, a pad) around a part, on its own track: the nearest the script gets to "add a
// bassline". Two styles as cards (arrange_around's own proposal); nothing changes until one is kept.
// "Give me a funk beat": three of that style's grooves from the library (core/grooves.js), each as a take on a new
// Drums track from the playhead's bar, so nothing the person has is touched. It matched a word to a style, and says
// that much and no more: the person hears the cards and picks.
async function sceneGroove(app, { say, fine, tool, think, offer, t: text }) {
  _app = app;
  const style = styleIn(text);
  const part = /\bchorus\b/.test(text) ? 'chorus' : /\bhalf[- ]?time\b/.test(text) ? 'half' : /\bbridge\b/.test(text) ? 'bridge' : null;
  await think('Looking through the grooves…', 300);
  const found = await tool('find_grooves', { style: style.id, ...(part ? { part } : {}), limit: 8 });
  if (found.error) { await say(`I couldn't look through the grooves: ${found.error}.`); return; }
  const pool = findGrooves({ style: style.id, part: part || ['verse', 'chorus', 'half'], limit: 8 });
  const picks = pool.slice(0, 3);
  if (picks.length < 2) { await say(`The library has fewer than two ${style.name} grooves for that, so there's nothing to choose between.`); return; }
  const p = app.store.get(), bar = playheadBar(app);
  const vars = [];
  for (const g of picks) {
    const plan = planPut(p, { groove: g, track: null, bar, bars: defaultBars(g), studioA: studioA(app) });
    if (plan.error) { await say(`I can't put a groove in this song: ${plan.error}.${plan.hint ? ` ${plan.hint[0].toUpperCase()}${plan.hint.slice(1)}.` : ''}`); return; }
    vars.push({ label: g.name.toLowerCase(), ops: plan.ops, why: `${style.name} ${g.part === 'half' ? 'half-time' : g.part}, ${g.feel}` });
  }
  const b1 = bar + defaultBars(picks[0]) - 1;
  await say(`I matched "${style.name.toLowerCase()}" to the library's ${style.name} grooves. Here are ${vars.length} of them, at the song's ${p.tempo} BPM from bar ${bar}, each on a new Drums track, so your own drums stay as they are. Hold a card to hear one over the song; keep one, or none.`);
  fine(`${style.name}: ${style.blurb}. ${picks.map((g) => `${g.name} (${g.part === 'half' ? 'half-time' : g.part}, ${g.tempo[0]}–${g.tempo[1]} BPM)`).join('; ')}.`);
  const res = await offer({ title: `${style.name} grooves · ${barsWord(bar, b1)}`, reason: `${style.name} grooves from the library, as asked`, target: { bars: [bar, b1] }, variations: vars });
  if (res.error) { await say(`\n\nThose takes didn't come together: ${res.error}.`); return; }
  if (res.status === 'pending') { await say("\n\nThey're on screen. Nothing changes until you pick."); return; }
  if (res.picked === 'original' || res.index === -1) { await say('\n\nNone kept: the song is as it was.'); return; }
  await say(`\n\nKept: ${res.picked}. It's on its own Drums track at ${barsWord(bar, b1)}, signed with my name; one undo takes it out. The Grooves tab has the rest of the ${style.name} family, and fills.`);
}

// "Give me a riff for the chorus": the house riff writer's riffs (core/riff.js through suggest_riff), three of them as
// takes on the Guitar track, tab and all. The script didn't write them and says so: the house writer did.
async function sceneRiff(app, ctx) {
  const { say, fine, tool, think, pick, t: text } = ctx;
  _app = app;
  await think('Reading the chords…', 300);
  const jam = await tool('get_jam', { tips: false });
  if (jam.error) { await say(`I couldn't read the chords: ${jam.error}.`); return; }
  if (!jam.chords?.length) { await noChords(app, ctx, 'a riff to follow'); return; }
  const p = app.store.get();
  const sec = (p.sections || []).slice().sort((a, b) => b.name.length - a.name.length).find((x) => new RegExp(`\\b${reEsc(x.name.toLowerCase())}\\b`).test(text));
  const bm = /\bbars? (\d+)\s*(?:-|–|to|through)\s*(\d+)\b/.exec(text);
  const style = text.split(/[^a-z0-9-]+/).map((w) => (w.length > 2 ? findRiffStyle(w) : null)).find(Boolean) || null;
  const difficulty = /\b(easy|easier|simple|beginner)\b/.test(text) ? 'easy' : /\b(hard|harder|tricky|advanced|shred)\b/.test(text) ? 'hard' : null;
  const r = await tool('suggest_riff', { ...(sec ? { section: sec.name } : bm ? { bars: [+bm[1], +bm[2]] } : {}), ...(style ? { style } : {}), ...(difficulty ? { difficulty } : {}), takes: 3, reason: 'riffs for the section, as asked' });
  if (r.error) { await say(`I couldn't get riffs for that: ${r.error}.${r.hint ? ` ${r.hint[0].toUpperCase()}${r.hint.slice(1)}.` : ''}`); return; }
  const where = r.section ? `the ${String(r.section).toLowerCase()}` : barsWord(r.bars[0], r.bars[1]);
  await say(`Here are ${r.takes.length === 3 ? 'three' : r.takes.length} riffs for ${where} (${barsWord(r.bars[0], r.bars[1])}), ${RIFF_STYLES[r.style]?.label.toLowerCase() || r.style}, from the house riff writer: a seeded program in the studio, not me. I'm the scripted demo, so I picked the section and the style and it wrote them. Each is tab on the Guitar track, and the Jam tab shows it under the chords as you play. Hold a card to hear one; keep one, or none.`);
  fine(`${r.chords?.join(' ') || ''}${r.chords?.length ? ', ' : ''}${r.difficulty}: ${r.takes.map((x) => x.label).join('; ')}.`);
  const res = await pick(r.id);
  if (res.status === 'pending') { await say("\n\nThey're on screen. Nothing changes until you pick."); return; }
  if (res.picked === 'original' || res.index === -1) { await say('\n\nNone kept: the song is as it was.'); return; }
  await say(`\n\nKept: ${res.picked}. It's on the Guitar track over ${barsWord(r.bars[0], r.bars[1])}, signed with my name, and the Jam tab shows it as tab with Learn it and Loop. One undo takes it out.`);
}

/* ------------------------------------------------------------------ the Jam room */
// A guitarist's questions, answered with the room's own tools: its reading of the song (get_jam), its neck
// (show_on_fretboard), its rigs (set_tone) and its jam tracks (make_jam_track). What it says comes from the room (its
// tips, its lick writer, the rigs' own descriptions), never from a guess at how the song sounds: it can't hear it.

// the section an ask names ("over the chorus 1"), longest name first
function sectionIn(app, text) {
  const secs = (app.store.get().sections || []).slice().sort((a, b) => b.name.length - a.name.length);
  return secs.find((s) => new RegExp(`(^|[^a-z0-9])${reEsc(s.name.toLowerCase())}($|[^a-z0-9])`).test(text)) || null;
}
// the chords the room read over [a, b) beats, each once in a row ("A7 D7 A7 E7")
function chordRun(jam, a = -Infinity, b = Infinity) {
  const out = [];
  for (const c of jam.chords || []) if (c.beats[0] >= a - 1e-9 && c.beats[0] < b - 1e-9 && out[out.length - 1] !== c.chord) out.push(c.chord);
  return out;
}
const firstBar = (c) => parseInt(String(c.bars), 10);     // get_jam's "17-18" -> 17
const fretOf = (s) => parseInt(String(s || ''), 10);      // "5th fret" -> 5
// a chord the ask names that the song has ("into the D7"), longest name first; a short name without a number ("A",
// "Am") only after the, into, over or to, so the a in "a lick" is no chord
function chordIn(text, jam) {
  const names = [...new Set((jam.chords || []).map((c) => c.chord))].sort((a, b) => b.length - a.length);
  for (const n of names) {
    const w = reEsc(n.toLowerCase());
    const re = n.length <= 2 && !/\d/.test(n) ? new RegExp(`\\b(the|into|over|to) ${w}(?![a-z0-9#])`) : new RegExp(`(^|[^a-z0-9#])${w}(?![a-z0-9#])`);
    if (re.test(text)) return n;
  }
  return null;
}
// No chords to read (no parts with notes yet, or only drums and recorded audio): it says so, and offers a jam track.
async function noChords(app, { say, emit, turn }, what) {
  await say(`There are no chords here for ${what}: the room reads them from the parts with notes, and this song has none yet (recorded audio isn't read). I can make a jam track to play over instead, in a style and a key.`);
  emit('moves', { turn, moves: JAMTRACK_MOVES, live: false });
}

// "What scale works over the chorus?": the room's reading (get_jam: the key, the pentatonic that fits and the fret its
// box starts at, the chords), the scale lit on the neck in its box (show_on_fretboard), and two lines from the room's
// tips: the scale and where your hand goes, then what changes with the chords (a section in another key, the notes
// that step outside the scale, or the note to land on at the next change).
async function sceneScale(app, ctx) {
  const { say, fine, tool, think, t: text } = ctx;
  await think('Reading the chords…', 300);
  const jam = await tool('get_jam', {});
  if (jam.error) { await say(`I couldn't read the chords: ${jam.error}.`); return; }
  if (!jam.chords?.length || !jam.scale) { await noChords(app, ctx, 'a scale to fit'); return; }
  const tip = (k) => (jam.tips || []).find((x) => x.kind === k)?.text || '';
  const sc = jam.scale, at = fretOf(sc.box);
  const frets = Number.isFinite(at) ? [Math.max(0, at - 1), at + 4] : null;
  const shown = await tool('show_on_fretboard', { scale: sc.fits, ...(frets ? { frets } : {}), label: `${sc.fits}, ${sc.box}` });
  const sec = sectionIn(app, text), bpb = bpbOf(app);
  const run = sec ? chordRun(jam, sec.start, sec.start + sec.length) : chordRun(jam);
  const s0 = sec ? Math.floor(sec.start / bpb + 1e-9) + 1 : 0, secBars = sec ? barsWord(s0, Math.max(s0, Math.ceil((sec.start + sec.length) / bpb - 1e-9))) : '';
  const said = jam.song?.key_from === 'guessed' ? 'going by its notes' : 'the song says so';
  const lead = [
    /\b(chords|changes|progression)\b/.test(text) ? `${sec ? sec.name : 'The song'} plays ${run.slice(0, 12).join(' ')}${run.length > 12 ? ' …' : ''}.` : '',
    /\bkey\b/.test(text) ? `It's in ${jam.song.key} (${said}).` : '',
  ].filter(Boolean).join(' ');
  const where = shown.error ? '' : shown.visible ? ' It’s on the neck now.' : ' It’s on the neck in Jam, beside Arrange.';
  await say(`${lead ? `${lead} ` : ''}${tip('scale') || `${sc.fits} fits: ${sc.notes}.`}${where}`);
  // the second line: a section in another key (the one asked about, or any when none was), else the notes that step
  // outside the scale, else the note that says the next change
  const shift = tip('shift');
  const second = (shift && (!sec || shift.toLowerCase().startsWith(sec.name.toLowerCase())) ? shift : '') || tip('outside') || tip('target');
  if (second) await say(`\n\n${second}`);
  fine(`From the room's reading of the song's notes${sec ? `, ${sec.name} (${secBars})` : ''}: ${run.slice(0, 12).join(' ')}${run.length > 12 ? ' …' : ''}; key ${jam.song.key} (${jam.song.key_from === 'song' ? 'set in the song' : 'guessed from the notes'}).${frets && !shown.error ? ` On the neck: its box, frets ${frets[0]}–${frets[1]}.` : ''}`);
}

// "Show me a lick into the D7 at bar 17": a two-bar lick from the room's lick writer (core/jam.js, the one its Ideas
// use) into the bar the ask names, else the change it names, else the next change from the playhead; lit on the neck in
// the order you play it (show_on_fretboard), and as tab. It sounds only when asked ("play me a lick"): sounding it can
// add a guitar to the song, and the room's own Show me plays it in its rhythm.
async function sceneLick(app, ctx) {
  const { say, fine, tool, think, t: text, emit, turn } = ctx;
  await think('Reading the chords…', 300);
  const jam = await tool('get_jam', {});
  if (jam.error) { await say(`I couldn't read the chords: ${jam.error}.`); return; }
  if (!jam.chords?.length) { await noChords(app, ctx, 'a lick to play over'); return; }
  const p = app.store.get(), tl = chordTimeline(p);
  const named = chordIn(text, jam), bm = /\bbar (\d+)\b/.exec(text), now = jam.now?.bar || 1;
  let land = bm ? Number(bm[1]) : null;
  if (!land && named) { const cs = jam.chords.filter((c) => c.chord === named); land = firstBar(cs.find((c) => firstBar(c) > now) || cs[0]); }
  if (!land) land = jam.now?.next?.bar || now + 1;
  const lick = makeLick(tl, { key: tl.key, bar: Math.max(1, land - 1), tuning: jam.fretboard?.tuning_id || 'standard', meter: p.meter });
  if (!lick || lick.error) { await say(`I couldn't make a lick there: ${lick?.error || 'no chords'}.${lick?.hint ? ` ${cap(lick.hint)}.` : ''}`); return; }
  const hear = /\b(play|sound) (me|it|that|this|one)\b|\blet me hear\b|\bhear (it|that|one|a|the)\b|\blisten\b/.test(text);
  const had = new Set(p.tracks.map((x) => x.id));
  const shown = await tool('show_on_fretboard', { notes: lick.notes.map((n) => `${stringNumber(n.s)}:${n.f}`).join(' '), frets: [Math.max(0, lick.box - 1), lick.box + 4], label: lick.label, ...(hear ? { play: true } : {}) });
  if (shown.error) { await say(`I couldn't put it on the neck: ${shown.error}.`); return; }
  await say(`${lick.text} ${shown.visible ? 'It’s on the neck, numbered in the order you play it.' : 'It’s on the neck in Jam (beside Arrange), numbered in the order you play it.'}`);
  await say(`\n\n\`\`\`\n${lick.tab}\n\`\`\``);
  // to hear it: the room's Show me plays this very lick when it's the one in Ideas; else it's a move to ask for
  const same = (jam.tips || []).some((x) => x.kind === 'lick' && x.text === lick.text);
  const into = lick.over.split(' to ').pop();
  if (hear) {
    const added = app.store.get().tracks.filter((x) => !had.has(x.id)).map((x) => x.name);
    await say(`\n\nI played it note by note${added.length ? ` on ${andList(added)}, a DI Box track that's new, to play it on (Undo takes it out)` : ''}.${same ? ' Show me, beside the lick in Ideas, plays it in its rhythm.' : ''}`);
  } else if (same) await say('\n\nShow me, beside the lick in Ideas, plays it.');
  else emit('moves', { turn, moves: [`Play me the lick into the ${into} at bar ${land}`], live: false });
  fine(`The room's lick writer made it, the same one its Ideas use: a seeded program in the studio, not me. I picked the bars (${barsWord(lick.bars[0], lick.bars[1])}).`);
}

// "What tone would suit this song?": it can't hear what suits it, and says so. It goes by words instead, the ask's own
// ("a funk tone"), else the song's style (a jam track's, a demo's genre on the shelf), searches the Guitar Studio's rigs
// for them (set_tone's search reads their names and descriptions) and offers up to three on a card. Nothing loads until
// the person picks one there; then set_tone loads it, one undo step.
//   [what an ask or a style says, the word it's said back as, the search the rigs answer]
const TONE_WORDS = [
  [/\b(neo[- ]?soul|soul|gospel|motown|r&b|rnb)\b/, 'soul', 'soul jazz'],
  [/\b(blues|shuffle|twelve[- ]bar|12[- ]bar)\b/, 'blues', 'blues'],
  [/\b(funk|funky|disco|boogie|house)\b/, 'funk', 'funk disco'],
  [/\b(jazz|bossa|latin)\b/, 'jazz', 'jazz soul'],
  [/\b(reggae|dub|ska|skank|one drop)\b/, 'reggae', 'skank offbeat dub'],
  [/\b(metal|djent|chug)\b/, 'metal', 'metal'],
  [/\b(shoegaze|dream|ambient)\b/, 'shoegaze', 'shoegaze fuzz reverb'],
  [/\b(indie|jangle)\b/, 'indie', 'indie'],
  [/\b(lo-?fi|lo fi|chill|boom bap|hip[- ]?hop|tape)\b/, 'lo-fi', 'lo-fi lofi'],
  [/\bpunk\b/, 'punk', 'punk'],
  [/\b(grunge|garage)\b/, 'grunge', 'grunge garage'],
  [/\bsurf\b/, 'surf', 'surf'],
  [/\b(country|twang|chicken)\b/, 'country', 'country twang slapback'],
  [/\bballad\b/, 'ballad', 'ballad'],
  [/\bsynth\w*\b/, 'synth', 'synth'],
  [/\brock\b/, 'rock', 'rock crunch'],
  [/\bpop\b/, 'pop', 'pop'],
  [/\bclean\b/, 'clean', 'clean'],
  [/\bcrunch\w*\b/, 'crunch', 'crunch'],
  [/\b(lead|solo)\b/, 'lead', 'lead'],
  [/\b(heavy|distorted|fuzzy?)\b/, 'heavy', 'heavy'],
];
const toneWordsIn = (s) => { for (const [re, word, search] of TONE_WORDS) if (re.test(s)) return { word, search }; return null; };
// the song's own style, where it says one: a jam track's recipe, else a song from the demo shelf, by its genre
function songStyle(app) {
  const p = app.store.get(), js = p.meta?.jam?.style && JAM_STYLES[p.meta.jam.style];
  if (js) { const w = toneWordsIn(`${js.label} ${p.meta.jam.style}`.toLowerCase()); if (w) return { ...w, from: `this jam track's style (${js.label.toLowerCase()})` }; }
  const demo = DEMOS.find((d) => d.title === p.title);
  if (demo?.genre) { const w = toneWordsIn(demo.genre.toLowerCase()); if (w) return { ...w, from: `its genre on the demo shelf (${demo.genre.toLowerCase()})` }; }
  return null;
}
async function sceneTone(app, ctx) {
  const { say, fine, tool, think, ask, t: text, emit, turn } = ctx;
  await think('Reading the rig…', 300);
  const jam = await tool('get_jam', { tips: false });
  if (jam.error) { await say(`I couldn't read the rig: ${jam.error}.`); return; }
  const asked = toneWordsIn(text), by = asked || songStyle(app);
  if (!by) {
    await say("I can't hear what suits it: I'm the scripted demo, not a live model, and nothing in this song says its style, so I've nothing to search the rigs for. Name a style and I'll find tones for it.");
    emit('moves', { turn, moves: ['A blues tone', 'A clean funk tone', 'A heavy tone'], live: false });
    return;
  }
  const found = await tool('set_tone', { search: by.search });
  if (found.error) { await say(`I couldn't look through the rigs: ${found.error}.${found.hint ? ` ${cap(found.hint)}.` : ''}`); return; }
  // guitar rigs (the bass and keys banks are for those), not the one it's on already
  const gt = jam.rig?.guitar_track || null, cur = jam.rig?.tone || null;
  const picks = (found.matches || []).filter((r) => !/\b(low end|keys)\b/i.test(r.bank || '') && r.id !== cur).slice(0, 3);
  const whence = asked ? `your word, ${by.word}` : by.from;
  if (!picks.length) { await say(`I can't hear what suits it: I'm the scripted demo, not a live model. I went by ${whence}, and none of the Guitar Studio's rigs come up for “${by.search}”. Name another style and I'll look again.`); return; }
  const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
  const on = gt ? gt.name : 'a new Guitar track';
  const n = (jam.rig?.chain || []).length;
  await say(`I can't hear what suits it: I'm the scripted demo, not a live model. I went by ${whence} and searched the Guitar Studio's rigs for “${by.search}”: ${andList(picks.map((r) => `${r.name} (${lower(r.for)})`))}. Pick one on the card and I'll load it on ${on}; nothing changes until you do.`);
  fine(`set_tone's search, guitar rigs only${cur ? `, not ${jam.rig.tone_name || cur}, which ${on} has now` : ''}: ${picks.map((r) => `${r.name}, ${r.bank}`).join('; ')}.`);
  const q = await ask({
    question: gt ? `Load which tone on ${gt.name}?${n ? ` It takes the place of its ${n} effect${n === 1 ? '' : 's'}; Undo puts them back.` : ''}` : 'Load which tone? There’s no Guitar track yet, so it makes one (DI Box, played from the keys).',
    options: picks.length > 1 ? picks.map((r) => r.name) : [picks[0].name, 'Not now'],
  });
  if (q.movedOn) return;
  if (q.error) { await say(`\n\nThe card didn't come up: ${q.error}.`); return; }
  const chosen = Number.isInteger(q.index) && q.index >= 0 ? picks[q.index] : null;
  if (!chosen) { await say(`\n\nNothing loaded: ${gt ? `${gt.name} keeps its tone` : 'no Guitar track made'}.`); return; }
  const r = await tool('set_tone', { rig: chosen.id, reason: `picked on the card, going by ${by.word}` });
  if (r.offered) { await say(`\n\n${offeredLine(r)}`); return; }
  if (r.error) { await say(`\n\nI couldn't load it: ${r.error}.${r.hint ? ` ${cap(r.hint)}.` : ''}`); return; }
  const tap = touch(), audio = (gt?.kind || 'instrument') === 'audio' && gt?.id === r.track.id;
  const hear = audio ? 'You hear it through your guitar: open the input in Jam and turn Monitor on.' : tap ? 'Tap the neck to hear it.' : 'Play the keys or tap the neck to hear it.';
  await say(`\n\n${r.tone.name} is on ${r.track.name} now: ${lower(r.tone.for)}.${r.replaced ? ` It took the place of ${r.replaced} effect${r.replaced === 1 ? '' : 's'}; Undo puts ${r.replaced === 1 ? 'it' : 'them'} back.` : ''} ${hear} In Jam, ${tap ? 'the arrows beside its name' : '[ and ]'} flip through the rest.`);
  fine(`${r.tone.name} (${r.tone.bank}): ${(r.chain || []).join(' → ')}.`);
}

// "Find me a delay someone made": the community shelf, searched by the ask's own sound word, and the best match put on a
// card for the selected track (find_community_device put_on). The card is the person's: ▶ plays its clip, Try asks them
// before any of its code runs here. The demo never presses it.
async function sceneShelf(app, { say, fine, tool, t: text }) {
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const query = words.find((w) => w.length > 2 && Object.values(CAT_WORDS).some((ws) => ws.includes(w))) || '';
  const kind = /\b(instruments?|synths?|keys|piano|organ|drum ?kits?|plucks?)\b/.test(text) ? 'instrument' : /\b(effects?|pedals?|delays?|echo(es)?|reverbs?|drives?|fuzz|chorus|compressors?)\b/.test(text) ? 'effect' : null;
  let found = await tool('find_community_device', { ...(query ? { query } : {}), ...(kind ? { kind } : {}), limit: 5 });
  if (found.error) { await say(`${found.error} Ask me to build one instead and I'll write it for this song.`); return; }
  if (!found.results?.length && query) found = await tool('find_community_device', { ...(kind ? { kind } : {}), limit: 5 });
  const best = found.results?.[0];
  if (!best) { await say('The community shelf has nothing like that yet. Ask me to build one and I\'ll write it for this song.'); return; }
  const r = await tool('find_community_device', { put_on: { id: best.id } });
  if (r.error) { await say(`I found ${best.name} on the community shelf, but couldn't put it on a card: ${r.error}.`); return; }
  await say(`From the community shelf: ${best.name}, by ${best.author}. ${best.blurb ? `${cap(best.blurb)}. ` : ''}It's on a card for ${r.on}: ▶ plays what it sounded like when it was rendered for the shelf, and Try asks you before any of its code runs here. Nothing has changed yet.`);
  fine(`${found.results.length} on the shelf${query ? ` for “${query}”` : ''}${best.measured?.in_words ? `; ${best.name}: ${best.measured.in_words}` : ''}`);
}

// "Make me a slow blues in E": the house band's jam track (make_jam_track) in the style, key and tempo the ask names (a
// slow one at about seven tenths of the style's tempo: a slow blues at 66). It replaces the song on screen, which goes
// to Recent songs, so it says what it would make and asks first, on a card; and it says everything before it's made,
// because this conversation is the song's and closes with it.
function jamAsk(text) {
  const words = text.split(/[^a-z0-9&'#-]+/).filter(Boolean);
  let style = null;
  for (let i = 0; i + 1 < words.length && !style; i++) style = findJamStyle(`${words[i]} ${words[i + 1]}`) || findJamStyle(`${words[i]}-${words[i + 1]}`);
  // (a word alone: "slow" here is a tempo, not the ballad)
  for (const w of words) { if (style) break; if (w !== 'slow' && w !== 'jam') style = findJamStyle(w); }
  const km = /\bin ([a-g])([#b♯♭])?(?:\s*(major|minor|maj|min|m)\b)?(?![a-z0-9#])/.exec(text);
  const key = km ? `${km[1].toUpperCase()}${km[2] === '#' || km[2] === '♯' ? '#' : km[2] ? 'b' : ''}${/^(minor|min|m)$/.test(km[3] || '') ? ' minor' : km[3] ? ' major' : ''}` : null;
  const tm = /\b(\d{2,3})\s*bpm\b|\bat (\d{2,3})\b/.exec(text);
  const S = style ? JAM_STYLES[style] : null;
  const slow = /\bslow(er)?\b/.test(text), fast = /\b(fast|faster|uptempo|up-tempo|quick)\b/.test(text);
  const bpm = tm ? Number(tm[1] || tm[2]) : S && slow ? Math.round(S.tempo * 0.72) : S && fast ? Math.min(240, Math.round(S.tempo * 1.2)) : S ? S.tempo : null;
  return { style, S, key, tempo: bpm && bpm >= 40 && bpm <= 240 ? bpm : S?.tempo || null, slow, fast };
}
async function sceneJamTrack(app, ctx) {
  const { say, fine, tool, ask, t: text, emit, turn } = ctx;
  const p = app.store.get(), title = p.title || 'Untitled';
  // a song from a link isn't the person's yet: an agent doesn't put it away (make_jam_track refuses it too)
  if (app.share?.listening) { await say("This song came from a link and isn't yours yet, so I won't put it away for a jam track. Jam tracks, in the Jam tab, opens one for you; or press Make it yours first, then ask me again."); return; }
  const j = jamAsk(text);
  if (!j.S) {
    await say(`Which style? The house band plays ${andList(Object.values(JAM_STYLES).map((s) => s.label.toLowerCase()))}, in any key and tempo.`);
    emit('moves', { turn, moves: JAMTRACK_MOVES, live: false });
    return;
  }
  const keyWords = j.key || `${j.S.key.root}${/minor/i.test(j.S.key.scale) && !/blues/i.test(j.S.key.scale) ? ' minor' : ''}`;
  const what = `${j.slow ? 'slow ' : j.fast ? 'fast ' : ''}${j.S.label.toLowerCase()} in ${keyWords}`;
  await say(`That's the house band's ${j.S.label.toLowerCase()} (${j.S.blurb}), in ${keyWords} at ${j.tempo} BPM, looping, with a Guitar track for you to play on. It opens as the song, so “${title}” goes to Recent songs: Song, then Recent songs, brings it back.`);
  fine(`make_jam_track: ${j.style}, key ${keyWords}, ${j.tempo} BPM${j.slow && !/\bbpm\b|\bat \d/.test(text) ? ` (slow: the style plays at ${j.S.tempo})` : ''}.`);
  const q = await ask({ question: `Make the ${what} now? “${title.slice(0, 60)}” goes to Recent songs.`, options: ['Make it', 'Not now'] });
  if (q.movedOn) return;
  if (q.error) { await say(`\n\nThe card didn't come up: ${q.error}.`); return; }
  if (q.index !== 0) { await say(`\n\nNothing made: “${title}” stays as it is.`); return; }
  // (said first: when the jam track opens, this conversation goes with the song it's on)
  await say('\n\nMaking it now.');
  const r = await tool('make_jam_track', { style: j.style, ...(j.key ? { key: j.key } : {}), tempo: j.tempo, reason: `you asked for a ${what}` });
  if (r.error) await say(`\n\nIt didn't open: ${r.error}.${r.hint ? ` ${cap(r.hint)}.` : ''}`);
}

async function sceneBand(app, { say, fine, tool, think, offer, t: text }) {
  _app = app;
  const part = bandPart(text), what = BAND_PART[part], noun = part === 'bass' ? 'bass' : part === 'pad' ? 'pad' : part;
  await think('Reading the part…', 300);
  const seed = bandSeed(app, text, part);
  if (!seed) { await say(`There's nothing to build ${what} around yet. Lay down a part first (hum it, tap it, play it), then ask me again.`); return; }
  const why = quietWhy(app, seed.track, seed.clip);
  if (why) { await say(why); return; }
  const who = partWords(seed.track), [b0, b1] = clipBars(app, seed.clip);
  await tool('highlight', { target: { track: seed.track.id, clip: seed.clip.id }, note: `building ${what} around this`, seconds: 6 });
  const r = await tool('arrange_around', { target: { track: seed.track.id, clip: seed.clip.id }, parts: [part], mode: 'propose', reason: `${what} around ${who}` });
  if (r.error || !(r.variations?.length >= 2)) { await say(`I couldn't build ${what} around ${who}: ${r.error || 'nothing came back'}.${r.hint ? ` ${r.hint}` : ''}`); return; }
  const vars = r.variations.map((v) => ({ ...v, label: v.label.replace(/ band$/, ` ${noun}`) }));
  await say(`Here ${part === 'chords' || part === 'drums' ? 'are two sets of' : 'are two'} ${part === 'bass' ? 'basslines' : part === 'pad' ? 'pads' : noun} around ${who}, ${barsWord(b0, b1)}, each on ${part === 'chords' || part === 'drums' ? 'their' : 'its'} own track: Band's, in two styles, built from ${theirIts(seed.track)} ${isDrumTrack(app, seed.track) ? 'hits' : 'notes'}. Hold a card to hear one; keep one, or neither.`);
  if (r.summary) fine(r.summary);
  const res = await offer({ title: `${cap(what)} around ${seed.track.name} · ${barsWord(b0, b1)}`, reason: `${what} around ${who}, from Band`, target: r.target, variations: vars });
  if (res.status === 'pending') { await say("\n\nThey're on screen. Nothing changes until you pick."); return; }
  if (res.picked === 'original' || res.index === -1) { await say('\n\nNone kept: the song is as it was.'); return; }
  await say(`\n\nKept: ${res.picked}. It's on its own track, signed with my name; your ${isDrumTrack(app, seed.track) ? 'beat is' : 'notes are'} untouched, and one undo takes it out.`);
}

// "Double it an octave up": the part's notes again an octave up (or down), as takes (the Double transform)
async function sceneDouble(app, { say, tool, think, offer, t: text }) {
  _app = app;
  await think('Reading the part…', 300);
  const named = partNamed(app, text), sel = selectedPart(app);
  const t = named || sel || anyPart(app, { pitched: true });
  if (!t) { await say("There's no part with notes to double yet. Hum or play one (H, or ` for the keys), then ask me again."); return; }
  if (isDrumTrack(app, t)) { await say(`${cap(partWords(t))} ${plural(t.name) ? 'have' : 'has'} no tune to double an octave up. Select a part with one, or name it ("double the keys").`); return; }
  const c = pickClip(app, t), why = quietWhy(app, t, c);
  if (why) { await say(why); return; }
  const down = /\b(down|lower|below)\b/.test(text);
  const r = await tool('transform', { name: 'double', target: { track: t.id, clip: c.id }, params: { octave: down ? -1 : 1 }, mode: 'propose' });
  if (r.error || !(r.variations?.length >= 2)) { await say(`I couldn't double ${partWords(t)}: ${r.error || 'nothing came back'}.${r.hint ? ` ${r.hint}` : ''}`); return; }
  const [b0, b1] = bars(app, c);
  await tool('highlight', { target: { track: t.id, clip: c.id }, note: 'doubling this', seconds: 6 });
  await say(`Here ${plural(t.name) ? 'are' : 'is'} ${partWords(t)} doubled ${down ? 'an octave down' : 'an octave up'}, ${barsWord(b0, b1)}, and the other way to compare. Hold a card to hear one; keep one, or neither.`);
  const res = await offer({ title: `${t.name} › ${c.name || 'clip'} · ${barsWord(b0, b1)}`, reason: `${partWords(t)} doubled, as asked`, target: r.target, variations: r.variations });
  if (res.status === 'pending') { await say("\n\nThey're on screen. Nothing changes until you pick."); return; }
  if (res.picked === 'original' || res.index === -1) { await say('\n\nOriginal kept.'); return; }
  await say(`\n\nKept: ${res.picked}. The added notes are signed with my name; one undo takes them out.`);
}

async function sceneDevice(app, { say, fine, tool, think, st, t: text }) {
  _app = app;
  await think('Sketching the circuit…', 500);
  const t = namedTracks(app, text)[0] || partNamed(app, text) || pickTrack(app, /hook|keys|lead|bass/i);
  if (!t) { await say('Give me a track with something playing on it and I\'ll put it there.'); return; }
  const c = pickClip(app, t);
  const [b0, b1] = c ? bars(app, c) : [1, 4];
  const fuzz = /fuzz|gate|sputter|dirt|distort/.test(text);
  const dev = fuzz ? SPUTTER : VELVET;
  const why = quietWhy(app, t, c, `I'd be building ${dev.name} blind.`);
  if (why) { await say(why); return; }
  await say(`Building ${dev.name}: ${dev.blurb.toLowerCase()}. Trying it on ${the(t)}.`);
  await tool('highlight', { target: { track: t.id }, note: `building ${dev.name} here`, seconds: 6 });
  const before = await tool('render_and_measure', { tracks: [t.id], bars: [b0, b1] });
  if (quietLevel(before)) { await say(`\n\n${cap(the(t))} ${isAre(t)} near silence over ${barsWord(b0, b1)}, so I'm not putting an effect on it; I couldn't measure what it does.${ASK_ANOTHER()}`); return; }
  const d = await tool('define_device', { device: dev, use_on: { track: t.id }, label: `built ${dev.name}`, reason: dev.blurb });
  if (d.offered) { await say(`\n\n${dev.name} is new code, and this song came from a link and isn't yours yet, so it's on a card: keep it and the device check runs, then it goes on ${the(t)}. Nothing changes until you choose.`); return; }
  if (d.error) { await say(`\n\nThe device check refused it: ${d.reason || d.error}. Let me know if you want me to try a gentler version.`); return; }
  const after = await tool('render_and_measure', { tracks: [t.id], bars: [b0, b1] });
  st.offered = true;
  const heard = plainChange(after?.deltas);
  // (the panels stay where the person left them: its face is in the Devices tab when they want it)
  await say(`\n\n${dev.name} is on ${the(t)}${heard ? `: ${heard}` : ', a subtle change'}. Its knobs are in the Devices tab; ask me to change how it behaves and I'll rewrite it.`);
  fine(`Device check passed${checkWords(d.check)}. ${levelWords(d, before, after, t, b0, b1)}${toneWords(after)}`);
}

async function sceneWord(app, { say, fine, tool, think, ask, t: text }) {
  _app = app;
  const t = namedTracks(app, text)[0] || partNamed(app, text) || pickTrack(app, /keys|bass|hook/i);
  if (!t) { await say('Select a track and tell me again: I work on what you have selected.'); return; }
  const why = quietWhy(app, t, pickClip(app, t), 'Whatever I changed, nobody could hear it.');
  if (why) { await say(why); return; }
  let axis = (/\b(warm|bright|dark|mud|space|punch|air|wide|lazy|lazier|laid|swing|tight|lush|thin(?!g)|full|harsh|smooth|gritt|dirt|dry|distant|louder|quieter)\w*/.exec(text) || [])[0] || 'warm';
  let direction = /less|not so|too /.test(text) ? 'less' : 'more';
  if (/^warm/.test(axis)) {
    const q = await ask({ question: `"Warmer" means different things to different ears. On ${the(t)}, which way?`, options: ['Darker top (less sparkle)', 'More body (fuller low-mids)'] });
    if (q.movedOn) return;
    if (q.status === 'pending' || q.answer == null) { await say('I’ll leave it as it is: ask me again when you know which way.'); return; }
    axis = q.index === 0 ? 'dark' : 'full';
    direction = 'more';
    await say(`${q.index === 0 ? 'Darker top' : 'More body'} it is. `);
  }
  if (/^lazi|^lazy|^laid/.test(axis)) axis = 'laid_back';
  if (/^tight/.test(axis)) axis = 'tight_timing';
  await think(`Translating "${axis}" into moves on the ${t.name}…`, 400);
  const r = await tool('adjust', { axis, direction, amount: 'a_bit', target: { track: t.id }, reason: `you asked for ${text.slice(0, 60)}` });
  if (r.offered) { await say(offeredLine(r)); return; }
  if (r.error) { await say(`I couldn't do that on ${the(t)}: ${r.error}. ${r.hint || ''}`); return; }
  const moved = (r.changed || []).slice(0, 3).join('; ');
  const m = typeof r.measured === 'object' ? r.measured : null;
  const heard = plainChange(m?.deltas);
  const notes = !m && /moves? notes|timing|laid|swing/i.test(`${r.axis} ${moved}`);
  // the words: what the measurement heard; else the axis it moved, when it measured as moved; else that it's small
  const asked = AXIS_WORD[String(r.axis).toLowerCase()]?.[r.direction === 'less' ? 1 : 0] || `${r.direction === 'less' ? 'less' : 'more'} ${r.axis}`;
  const movedOk = /moved as asked|moved, less than asked/.test(m?.result || '');
  await say(heard ? `${cap(the(t))} ${isAre(t)} ${heard} now. One undo takes it back.`
    : notes || !m || movedOk ? `${cap(the(t))} ${isAre(t)} ${movedOk && !/moved as asked/.test(m.result) ? 'a little ' : ''}${asked} now. One undo takes it back.`
    : `${cap(the(t))} changed only a little: it may be hard to hear. One undo takes it back.`);
  fine(`${r.direction === 'less' ? 'Less' : 'More'} ${r.axis}: ${moved}.${m?.glosses?.length ? ` Measured: ${m.glosses.slice(0, 2).join('; ')}.` : ''}${r.corrected ? ` (${r.corrected}.)` : ''}`);
}

// an axis, said as how it sounds: [more, less]
const AXIS_WORD = { brightness: ['brighter', 'darker'], warmth: ['warmer', 'cooler'], air: ['airier', 'duller'], 'mud (low-mid build-up)': ['muddier', 'clearer'], 'boom (low end)': ['boomier', 'tighter at the bottom'], 'body / fullness': ['fuller', 'thinner'], harshness: ['harsher', 'smoother'], 'honk (mid resonance)': ['honkier', 'smoother in the middle'], 'grit / drive': ['grittier', 'cleaner'], punch: ['punchier', 'softer'], 'compression (squash)': ['denser', 'more open'], 'space (reverb)': ['roomier', 'drier'], distance: ['further back', 'closer'], 'stereo width': ['wider', 'narrower'], level: ['louder', 'quieter'], swing: ['swingier', 'straighter'], 'laid-back (behind the beat)': ['more laid-back', 'more on top of the beat'], 'tight timing (quantise)': ['tighter in time', 'looser in time'], 'velocity / intensity': ['played harder', 'played softer'] };

/* ------------------------------------------------------------------ automation */
// One lane move per clause of the ask: a fade on a fader, or (asked for a sweep, the filter, opening up) brightness
// ramped over the bars, written by adjust { over, shape } and measured bar by bar. Each clause works on the track it
// names (else the one the ask names, else the selection), over the range it names (a section, bars n–m, the last bar,
// over N bars), and the reply names every lane it wrote. When a lane's measurement contradicts it (a fade that measured
// silent), it says so and takes that move back.
const NUM = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const num = (s) => (s == null ? null : NUM[s] ?? (Number(s) || null));
const ACTION = /\b(fade[sd]?|fading|sweep\w*|swells?|open\w*|close\w*|filter|cutoff|automat\w*|ramp\w*|bright\w*)\b/;
// the song's bars, 1 to its last (the end of its last clip or section)
const songBars = (app) => Math.max(1, Math.ceil(songEnd(app.store.get()) / bpbOf(app)));
function rangeIn(app, clause, { out, c }) {
  const p = app.store.get();
  const secs = (p.sections || []).slice().sort((a, b) => b.name.length - a.name.length);
  for (const s of secs) if (new RegExp(`\\b(the |over |in |during |through |across )${reEsc(s.name.toLowerCase())}\\b`).test(clause)) return { over: { section: s.name }, label: `the ${s.name.toLowerCase()}` };
  let m = /\bbars? (\d+)\s*(?:-|–|to|through|and)\s*(\d+)\b/.exec(clause);
  if (m) return { over: { bars: [Number(m[1]), Number(m[2])] } };
  m = /\bbar (\d+)\b/.exec(clause);
  if (m) return { over: { bars: [Number(m[1]), Number(m[1])] } };
  const overN = num((/\bover (\d+|one|two|three|four|five|six|seven|eight) bars?\b/.exec(clause) || [])[1]);
  // "the last bar", "the last two bars", "the end", "the first bar": the song's, never the selected clip's, a stale
  // selection's or the marker's (FRESH-EYES-4 producer #1: "the last bar" faded bar 4, the marker's, not bar 8)
  m = /\b(last|final|first|opening) (?:(\d+|one|two|three|four|five|six|seven|eight) )?bars?\b/.exec(clause);
  const end = !m && /\b(the (very )?end|the ending)\b/.test(clause);
  if (m || end) {
    const z = songBars(app), n = (m ? num(m[2]) : overN) || 1;
    if (end || /last|final/.test(m[1])) { const a = Math.max(1, z - n + 1); return { over: { bars: [a, z] }, label: end ? 'the end' : n > 1 ? `the last ${n} bars` : 'the last bar', songEnd: true }; }
    return { over: { bars: [1, Math.min(z, n)] }, label: n > 1 ? `the first ${n} bars` : 'the first bar' };
  }
  if (!c) return { over: { bars: [1, overN || 4] } };
  const [b0, b1] = out ? lastBars(app, c, overN || 4) : overN ? firstBars(app, c, overN) : bars(app, c);
  return { over: { bars: [b0, b1] } };
}
function movesOf(app, clauses, text) {
  const moves = [];
  const all = namedTracks(app, text);
  for (const cl of clauses) {
    if (!ACTION.test(cl) || NEWPART.test(cl)) {
      // "…, over the chorus": a range on its own belongs to the move before it
      if (moves.length && /\b(over|bars?|last|first|chorus|verse|intro|outro|bridge)\b/.test(cl) && !moves[moves.length - 1].rangeText) moves[moves.length - 1].rangeText = cl;
      continue;
    }
    const sweep = /filter|cutoff|sweep|open|close|bright|swell/.test(cl) && !/fade/.test(cl);
    const out = /fade[sd]? (\w+ )?(\w+ )?out|fade-out|fading out|fade away|fade to (silence|nothing)/.test(cl);
    const down = /\b(close|closing|down|darker|duller)\b/.test(cl);
    const named = namedTracks(app, cl)[0] || (all.length === 1 ? all[0] : null) || partNamed(app, cl);
    // a build (a riser, a sweep up, "start it lower") starts well under where it plays now; "open the filter up" ramps
    // from where it is
    const build = sweep && !down && /\b(build\w*|riser|rise|sweep\w*|lower)\b/.test(cl);
    moves.push({ clause: cl, sweep, out, down, build, lower: /\blower\b/.test(cl), named, param: /\b(filter|cutoff)\b/.test(cl) ? 'filter' : null, word: (/\b(filter|cutoff)\b/.exec(cl) || [])[1] || null });
  }
  return moves;
}
// a param on the track's instrument that a word names ("the filter": a cutoff), else its tone param; null: none
function namedParam(app, t, word) {
  const def = t.instrument && app.devices?.getDevice?.(t.instrument.device);
  const ps = def?.params || [];
  const hit = word === 'filter' ? ps.find((q) => /cutoff|filter/i.test(`${q.key} ${q.label || ''}`)) : null;
  return hit ? { exact: true, q: hit, def } : ps.find((q) => q.role === 'tone') ? { exact: false, q: ps.find((q) => q.role === 'tone'), def } : null;
}
const laneName = (s) => { const n = String(s).replace(/^wrote /, '').split(/,\s*bars? |\s+on\s+/)[0]; return n === 'level' ? 'its fader (level)' : n === 'pan' ? 'its pan' : n; };
async function sceneAuto(app, { say, fine, tool, think, t: text, clauses, emit, turn }) {
  _app = app;
  const moves = movesOf(app, clauses && clauses.length ? clauses : [text], text);
  if (!moves.length) moves.push({ clause: text, sweep: /filter|sweep|open|bright/.test(text) && !/fade/.test(text), out: /fade[sd]? (\w+ )?(\w+ )?out|fade-out|fading out/.test(text), down: false, named: namedTracks(app, text)[0] || null, param: null });
  let wrote = 0, first = true;
  for (const mv of moves) {
    const t = mv.named || pickTrack(app, /pad|keys|chord|hook|lead/i);
    const lead = first ? '' : '\n\n';
    first = false;
    if (!t) { await say(`${lead}Give me a track with something playing on it, and I'll write the lane there.`); continue; }
    const c = pickClip(app, t);
    const why = quietWhy(app, t, c);
    if (why) { await say(`${lead}${why}`); continue; }
    // a fade out with no clip of this track selected goes over the end of the part: its last clip that plays (the bass's
    // Walk 2), not the first one (Walk, which would leave Walk 2 after the fade)
    const picked = t.clips.some((x) => x.id === coherentSelection(app).clip);
    const endClip = !picked && mv.out && !mv.sweep ? t.clips.filter(playing).reduce((a, x) => (!a || x.start + x.length > a.start + a.length ? x : a), null) : null;
    const rg = rangeIn(app, `${mv.clause} ${mv.rangeText || ''}`, { out: mv.out && !mv.sweep, t, c: endClip || c });
    const what = mv.sweep ? (mv.down ? 'closing down' : 'opening up') : `fading ${mv.out ? 'out' : 'in'}`;
    await think(`Writing a lane on the ${t.name}…`, 400);
    const highlightBars = rg.over.bars || null;
    await tool('highlight', { target: { track: t.id, ...(highlightBars ? { bars: highlightBars } : {}) }, note: `${what} here`, seconds: 6 });
    const reason = `you asked: ${mv.clause.slice(0, 60)}`;
    let param = null, r;
    if (mv.sweep) {
      param = namedParam(app, t, mv.param);
      const base = { axis: 'brightness', amount: 'a_lot', target: { track: t.id }, over: rg.over, shape: mv.down ? 'ramp_down' : mv.build ? 'build' : 'ramp', ...(mv.build && mv.lower ? { drop: 0.6 } : {}), reason };
      // a filter the ask names: that knob only (the instrument's), not every device on the track that moves brightness
      r = param && mv.param ? await tool('adjust', { ...base, target: { track: t.id, insert: 'instrument' } }) : null;
      if (!r || r.error) r = await tool('adjust', base);
    } else r = await tool('adjust', { axis: 'level', target: { track: t.id }, over: rg.over, shape: mv.out ? 'fade_out' : 'fade_in', reason });
    if (r.offered) { await say(`${lead}${offeredLine(r)}`); continue; }
    if (r.error) { await say(`${lead}I couldn't write that lane on ${the(t)}: ${r.error}. ${r.hint || ''}`); continue; }
    const m = typeof r.measured === 'object' ? r.measured : null;
    const where = rg.label ? `${rg.label} (${r.over})` : r.over;
    // the measurement against what it was meant to do: say so, and take it back
    if (r.contradiction) {
      const u = await tool('undo', {});
      await say(`${lead}That one didn't work: ${r.contradiction}. ${u.ok ? `I took it back, so ${the(t)} ${verbS(t, 'play')} as before.` : 'Undo it (⌘Z) to put it back as it was.'}`);
      if (m) fine(`Measured, ${m.series.replace(/ after:/, ':')}.`);
      continue;
    }
    wrote += (r.lanes || []).length;
    const names = (r.lanes || []).map(laneName);
    const lanesSaid = names.length ? ` I wrote ${names.length === 1 ? 'one lane' : `${names.length} lanes`} on ${the(t)}: ${names.join(', ')}.` : '';
    const noFilter = mv.param && param && !param.exact ? ` ${cap(the(t))} ${plural(t.name) ? 'have' : 'has'} no filter, so I used ${param.def?.name ? `${param.def.name}'s` : 'its'} ${String(param.q.label || param.q.key).toLowerCase()}.` : '';
    // the person's points the lane took out, said in the reply (never deleted quietly)
    const rep = r.replaced || [];
    const repBars = [...new Set(rep.map((x) => (/ at (bar \d+(?:, beat [\d.]+)?)/.exec(x) || [])[1]).filter(Boolean))];
    const replacedSaid = rep.length ? ` It replaced ${rep.length === 1 ? 'a point you drew' : `${rep.length} points you drew`}${repBars.length ? ` (${repBars.join(', ')})` : ''}; one undo puts ${rep.length === 1 ? 'it' : 'them'} back.` : '';
    const repFine = rep.length ? ` Replaced: ${rep.join('; ')}.` : '';
    // what the bars measured against what the sentence would claim: a sweep that doesn't rise (or fall) across the range
    // is said to have barely changed, with the offer to start lower, never "darker at the start, brighter by the end"
    const trendGot = (/, (rising|falling|steady|up and back|down and back|uneven)$/.exec(m?.series || '') || [])[1] || null;
    const trendWant = mv.down ? 'falling' : 'rising';
    if (mv.sweep && (r.trend_mismatch || (trendGot && trendGot !== trendWant))) {
      const rangeWord = rg.label || barsWord(...(rg.over.bars || [1, 1]));
      wrote -= (r.lanes || []).length;
      await say(`${lead}This barely changed ${the(t)}: I swept ${names.join(' and ') || 'it'} over ${where}, but ${plural(t.name) ? 'they don\'t' : 'it doesn\'t'} come out ${mv.down ? 'darker' : 'brighter'} by the end.${noFilter}${replacedSaid} One undo takes it out. ${mv.down ? 'Want me to start it higher?' : 'Want me to start it lower?'}`);
      if (!mv.down) emit('moves', { turn, moves: [`Sweep the ${t.name.toLowerCase()} ${mv.word || 'filter'} up from lower over ${rangeWord}`], live: false });
      fine(`${(r.lanes || []).map((x) => x.replace(/^wrote /, '')).join('; ')}.${m ? ` Measured, ${m.series.replace(/ after:/, ':')}.` : ''}${repFine}`);
      continue;
    }
    const weak = mv.sweep && /barely moved/.test(m?.axis_result || '') ? ' It measured as a small change, so you may barely hear it.' : '';
    // a fade out that ends before the song does comes back where it ends; one at the song's end stays down
    const p1 = app.store.get(), tr1 = p1.tracks.find((x) => x.id === t.id), sec1 = rg.over.section && p1.sections.find((x) => x.name === rg.over.section);
    const toBeat = rg.over.bars ? rg.over.bars[1] * bpbOf(app) : sec1 ? sec1.start + sec1.length : null;
    const lane1 = tr1?.auto?.gain?.points || [];
    const endAt = Number.isFinite(toBeat) ? toBeat : Math.max(...lane1.filter((x) => x.v <= -59.9).map((x) => x.t), 0);
    const atEnd = lane1.filter((x) => Math.abs(x.t - endAt) < 1e-9);
    const comesBack = mv.out && atEnd.length > 1 && atEnd[atEnd.length - 1].v > -59;
    const songOver = endAt >= songEnd(p1) - 1e-9;
    const theyre = plural(t.name) ? 'they were' : 'it was';
    const plain = mv.sweep
      ? `${cap(the(t))} now ${verbS(t, mv.down ? 'close' : 'open')} ${mv.down ? 'down' : 'up'} over ${where}: ${mv.down ? 'brighter at the start, darker by the end' : mv.build ? 'it starts dark and builds, brighter by the end' : 'darker at the start, brighter by the end'}.`
      : mv.out
        ? `${cap(the(t))} now ${verbS(t, 'fade')} out over ${where}, from where ${theyre} playing down to silence${songOver ? ', and the song ends there' : comesBack ? `, then come${plural(t.name) ? '' : 's'} back in at bar ${Math.round(endAt / bpbOf(app)) + 1} where ${theyre}` : ''}.`
        : `${cap(the(t))} now ${verbS(t, 'fade')} in over ${where}, from silence up to ${plural(t.name) ? 'their' : 'its'} usual level.`;
    await say(`${lead}${plain}${noFilter}${lanesSaid}${replacedSaid}${weak}`);
    fine(`${(r.lanes || []).map((x) => x.replace(/^wrote /, '')).join('; ')}.${m ? ` Measured, ${m.series.replace(/ after:/, ':')}.` : ''}${repFine}${r.corrected ? ` (${r.corrected}.)` : ''}`);
  }
  if (wrote) await say(`\n\n${wrote === 1 ? 'It plays' : 'They play'} every time the song passes there; one undo takes out each move.`);
}

async function sceneCapture(app, { say, tool, think, offer }) {
  _app = app;
  await think('Checking what you played…', 300);
  const cap = await tool('get_capture', { which: 'latest' });
  if (cap.error) { await say("Nothing's on tape yet. Press H and hum it (or T and tap it); every take is kept. Then ask me again."); return; }
  const p = app.store.get();
  const notes = cap.notes;
  const bpb = p.meter?.[0] || 4;
  const len = Math.max(bpb, Math.ceil((cap.beats || bpb) / bpb) * bpb);
  const nBars = Math.max(1, Math.ceil((cap.beats || bpb) / bpb));
  const start = Math.ceil(((p.loop?.on ? p.loop.start : 0)));
  const hits = /tapped|beatbox/.test(cap.kind || '');
  let variations;
  if (hits) {
    // tapped hits are a rhythm, not a tune: a drum track as you tapped it, or a bassline on the key's root that keeps
    // your rhythm. Never "a lead"
    const rootPc = p.key?.root ? parsePc(p.key.root) : 0;
    const root = spellNote(36 + (Number.isNaN(rootPc) ? 0 : rootPc), p.key);
    const onRoot = notes.split(/\s+/).filter(Boolean).map((tok) => tok.replace(/^[A-G][#b]*-?\d+|^\d+/, root).replace(/:[\d.]+/, ':0.25')).join(' ');
    await say(`Your ${cap.kind === 'beatbox' ? 'beatboxed' : 'tapped'} beat is in: ${cap.count} hits, ${nBars} bar${nBars === 1 ? '' : 's'}. It's a rhythm, not a tune, so here are two places it could go:`);
    variations = [
      { label: `on a drum track, as you ${cap.kind === 'beatbox' ? 'beatboxed' : 'tapped'} it`, ops: [{ type: 'track.add', ref: 'idea', track: { name: 'Your beat', instrument: { device: 'core.drums' } } }, { type: 'clip.add', track: '$idea', clip: { start, length: len, name: 'Your beat', notes } }] },
      { label: `a bassline on your rhythm (${root}, the root)`, ops: [{ type: 'track.add', ref: 'idea', track: { name: 'Idea bass', instrument: { device: 'core.bass' } } }, { type: 'clip.add', track: '$idea', clip: { start, length: len, name: 'Your rhythm', notes: onRoot } }] },
    ];
  } else {
    const verb = { hum: 'hummed', 'played phrase': 'played', 'typed phrase': 'played', recording: 'recorded' }[cap.kind];
    const bass = notes.split(/\s+/).map((tok) => tok.replace(/^([A-G][#b]?)(-?\d+)/, (m, n, o) => `${n}${Math.max(0, Number(o) - 2)}`)).join(' ');
    await say(`Your ${cap.kind} is in: ${cap.count} notes${cap.range ? `, ${cap.range}` : ''}. Two places it could go:`);
    variations = [
      { label: verb ? `as a lead (as you ${verb} it)` : 'as a lead, as it is', ops: [{ type: 'track.add', ref: 'idea', track: { name: 'Idea', instrument: { device: 'core.pluck' } } }, { type: 'clip.add', track: '$idea', clip: { start, length: len, name: 'Your idea', notes } }] },
      { label: 'as a bassline (two octaves down)', ops: [{ type: 'track.add', ref: 'idea', track: { name: 'Idea bass', instrument: { device: 'core.bass' } } }, { type: 'clip.add', track: '$idea', clip: { start, length: len, name: 'Your idea', notes: bass } }] },
    ];
  }
  const r = await offer({ title: hits ? 'your beat' : 'your idea', reason: hits ? 'your rhythm, placed two ways' : 'your phrase, placed two ways', variations });
  if (r.status === 'pending') await say("\n\nThey're waiting on screen.");
  else if (r.index === -1) await say('\n\nLeft it out for now; it stays in your captures.');
  else await say(`\n\nPlaced it ${r.picked}. The ${hits ? 'rhythm is' : 'notes are'} still yours (warm); I only moved ${hits ? 'it' : 'them'}.`);
}

// "undo that" / "take that back" is one step: my latest change (the undo tool). Only an ask for all of it ("undo
// everything", "revert all your changes") takes out every change of mine, takes the human picked included.
async function sceneUndo(app, { say, tool, t: text = '' }) {
  if (/\b(all|everything|every)\b|\brevert (all |your |my )?changes\b/.test(text)) {
    const picked = app.store.history.filter((x) => x.by === 'claude' && x.pickedBy).length;
    const r = await tool('revert_my_changes', {});
    await say(r.reverted ? `Took out ${r.reverted} of my changes${picked ? `, ${picked === 1 ? 'the take you picked' : `the ${picked} takes you picked`} included` : ''}; your own edits are untouched.${r.skipped?.length ? ` ${r.skipped.length} couldn't be undone because later edits build on them.` : ''}` : "I haven't changed anything in this song yet.");
    return;
  }
  const r = await tool('undo', {});
  if (r.error) { await say(/nothing/.test(r.error) ? "I haven't changed anything in this song yet." : `I couldn't take my last change back: ${r.error}. ${r.hint || ''}`); return; }
  await say(`Took back my last change ("${r.undid}"). The rest stays, yours and mine; ask again to go back another step.`);
}

async function sceneChat(app, { say, tool, emit, turn }) {
  const scope = (await tool('get_selection', {})).scope;
  await say(inJam(app)
    ? 'I\'m the scripted demo. In the Jam room I can show the scale that fits on the neck, a lick into the next chord, tones that match the song\'s style, riffs for a section, or make a jam track to play over. Pick one:'
    : `I'm the scripted demo, working on ${scope || 'the whole song'}. I can play takes over a part, play a line over one on its own track, build a bass around a beat, turn a word ("lazier", "darker", "more space") into a measured move, build a small effect, or place a take you hummed or tapped. Pick one:`);
  emit('moves', { turn, moves: movesFor(app), live: true });
}

// the device check, in a musician's words
function checkWords(c) {
  if (!c) return '';
  // the check's level is on its test signals, not on your part: the one level we report is levelWords' (in context)
  const bits = [];
  if (c.truePeak != null && typeof c.truePeak === 'number') bits.push(`peaks at ${c.truePeak.toFixed ? c.truePeak.toFixed(1) : c.truePeak} dBTP`);
  if (c.nan === false || c.nan === 0) bits.push('no glitches');
  return bits.length ? ` (${bits.join(', ')})` : '';
}

// One number per change: the level on the part itself, with the device on against bypassed (define_device's
// on_target, the same number as its chip), naming what was measured. Without it, the before/after renders.
const lu = (x) => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(1);
const lufs = (x) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(1);
export function levelWords(d, before, after, t, b0, b1) {
  const where = `the ${t.name.toLowerCase()}, ${b1 > b0 ? `bars ${b0}–${b1}` : `bar ${b0}`}`;
  const say = (from, to, dl, how) => `Measured on ${where}, ${how}: ${lufs(from)} → ${lufs(to)} LUFS (${lu(dl)} LU${Math.abs(dl) < 0.5 ? ', the same loudness' : ''}).`;
  const ot = d?.on_target;
  if (ot && Number.isFinite(ot.lufs_on) && Number.isFinite(ot.lufs_bypassed)) return say(ot.lufs_bypassed, ot.lufs_on, ot.deltaLU, 'bypassed then on');
  if (Number.isFinite(before?.lufs) && Number.isFinite(after?.lufs)) return say(before.lufs, after.lufs, Math.round((after.lufs - before.lufs) * 10) / 10, 'before and after');
  return '';
}
// what else moved (the tone), never a second loudness number
function toneWords(after) {
  if (quietLevel(after)) return ` It measures ${lufs(after.lufs)} LUFS there, near silence, so there's no tone to speak of.`;
  const gl = (after?.delta_glosses || []).filter((g) => !/\bLU\b|LUFS|loudness|no perceptible/i.test(g)).slice(0, 2);
  return gl.length ? ` The tone moved too: ${gl.join('; ')}.` : '';
}

/* ------------------------------------------------------------------ the demo devices (real kernels) */
export const VELVET = {
  id: 'claude.velvet-hush', name: 'Velvet Hush', kind: 'effect', cat: 'drive',
  blurb: 'Tape-ish warmth: soft saturation, a gentler top',
  params: [
    { key: 'drive', label: 'DRIVE', min: 0, max: 1, def: 0.35, role: 'drive', desc: 'how hard it leans into the tape' },
    { key: 'tone', label: 'TONE', min: 800, max: 16000, def: 2400, curve: 'log', unit: 'Hz', role: 'tone', desc: 'where the top rolls off' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 0.8, role: 'mix', desc: 'dry to fully hushed' },
  ],
  look: { color: '#2d4a55', ink: '#eef4f2', shape: 'box', finish: 'matte', knob: 'soft', label: 'plate', led: '#4cc3ff' },
  kernel: `({
  create({ sr, seed, dsp }) {
    let zl = 0, zr = 0;
    const sat = (x) => (x <= -3 ? -1 : x >= 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x));
    return {
      process(L, R, n, p) {
        const a = Math.exp(-2 * Math.PI * p.tone / sr), g = 1 + p.drive * 5, comp = 1.35 / g;
        for (let i = 0; i < n; i++) {
          const l = sat(L[i] * g) * comp, r = sat(R[i] * g) * comp;
          zl = l + (zl - l) * a; zr = r + (zr - r) * a;
          L[i] = L[i] + (zl - L[i]) * p.mix; R[i] = R[i] + (zr - R[i]) * p.mix;
        }
      },
    };
  },
})`,
};
export const SPUTTER = {
  id: 'claude.sputter-fuzz', name: 'Sputter Fuzz', kind: 'effect', cat: 'fuzz',
  blurb: 'A fuzz that gates hard and sputters as notes die',
  params: [
    { key: 'fuzz', label: 'FUZZ', min: 0, max: 1, def: 0.6, role: 'drive', desc: 'from crunch to a wall' },
    { key: 'gate', label: 'GATE', min: 0, max: 1, def: 0.5, role: 'gate', desc: 'how early the tail chokes and sputters' },
    { key: 'tone', label: 'TONE', min: 400, max: 9000, def: 2600, curve: 'log', unit: 'Hz', role: 'tone', desc: 'dark and woolly to cutting' },
    { key: 'level', label: 'LEVEL', min: -24, max: 6, def: -6, unit: 'dB', role: 'level', desc: 'output' },
  ],
  look: { color: '#c4532f', ink: '#fff3e8', shape: 'wedge', finish: 'sparkle', knob: 'chicken', label: 'plate', led: '#ffd27a' },
  kernel: `({
  create({ sr, seed, dsp }) {
    let env = 0, zl = 0, zr = 0;
    return {
      process(L, R, n, p) {
        const g = 2 + p.fuzz * 60, thr = 0.002 + p.gate * 0.06, a = Math.exp(-2 * Math.PI * p.tone / sr), out = Math.pow(10, p.level / 20) * 0.6;
        const att = Math.exp(-1 / (0.002 * sr)), rel = Math.exp(-1 / (0.06 * sr));
        for (let i = 0; i < n; i++) {
          const x = (L[i] + R[i]) * 0.5, ax = Math.abs(x);
          env = ax > env ? ax + (env - ax) * att : ax + (env - ax) * rel;
          const open = env > thr ? 1 : Math.pow(env / thr, 3);
          const y = Math.tanh(x * g) * open;
          zl = y + (zl - y) * a; zr = zl;
          L[i] = zl * out; R[i] = zr * out;
        }
      },
    };
  },
})`,
};
