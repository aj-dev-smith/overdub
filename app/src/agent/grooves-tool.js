// The groove library's agent tools [agent layer]: find_grooves (read), use_groove (one groove at some bars) and
// drum_track (the song creator). The library and every plan are core/grooves.js; the schemas are in extra-schemas.js
// (so Node lists them with no tab open). ui/grooves.js, the Grooves tab, calls installGrooveTools(app) at boot and uses
// the same placing functions, so a person and an agent put a groove in the song the same way.
//
//   installGrooveTools(app)                         registers the three tools; app.tools.run('use_groove', ...)
//   targetTrack(app) / playheadBar(app) / studioA(app) / deviceOf(app) / isDrum(app, t)   the defaults both sides use
//   putGroove(app, { groove, track, bar, bars, seed, by, under, label, reason, dryRun }) -> result (one dispatch)
//   buildDrums(app, { style, parts, ending, crashes, seed, by, label, reason, dryRun }) -> result (one dispatch)

import { installTools, isRecording } from './tools.js';
import { FIND_GROOVES_SCHEMA, USE_GROOVE_SCHEMA, DRUM_TRACK_SCHEMA } from './extra-schemas.js';
import * as G from '../core/grooves.js';
import { planDropTrim } from '../core/arrangement.js';
import { beatsPerBar, parseGrid, formatNotes } from '../core/music.js';
import { targetsOf } from './diff.js';

const err = (error, hint, extra) => ({ error, ...(hint ? { hint } : {}), ...(extra || {}) });
const TOOL_NAMES = new Set(['find_grooves', 'use_groove', 'drum_track']);
const r2 = (x) => Math.round(x * 100) / 100;

/* ------------------------------------------------------------------------------------------------ the defaults */
export function isDrum(app, t) {
  if (!t || t.kind !== 'instrument' || !t.instrument) return false;
  if (t.instrument.device === 'core.drums' || t.instrument.device === G.STUDIO_A) return true;
  return app.devices?.getDevice?.(t.instrument.device)?.cat === 'drums';
}
// Studio A's definition when the studio has it (its presets set a style's kit), else null: Gobo Kit plays instead
export const studioA = (app) => app.devices?.getDevice?.(G.STUDIO_A) || null;
// a device's definition by id, or null: a style written for a kit of its own (G.KIT_DEVICES) plays on it when it's here
export const deviceOf = (app) => (id) => app.devices?.getDevice?.(id) || null;
// The drum track a groove goes onto when nobody says: the selected one, else the first; null means a new one.
export function targetTrack(app) {
  const p = app.store.get(),
    sel = app.ui?.state?.selection?.track;
  const t = p.tracks.find((x) => x.id === sel);
  if (isDrum(app, t)) return t;
  return p.tracks.find((x) => isDrum(app, x) && !x.mute) || p.tracks.find((x) => isDrum(app, x)) || null;
}
// The playhead's bar (1-based): where the song plays, or the start marker it plays from.
export function playheadBar(app) {
  const p = app.store.get(),
    bpb = beatsPerBar(p.meter);
  const e = app.engine;
  const beat = e?.playing ? e.beat : (app.transport?.marker?.beat ?? e?.beat ?? 0);
  return Math.max(1, Math.floor(Math.max(0, Number(beat) || 0) / bpb + 1e-6) + 1);
}

/* ------------------------------------------------------------------------------------------------ placing */
// One groove into the song, one dispatch. track: left out, the selected or first drum track (targetTrack); null or
// "new", a new Drums track. under: 'cut' (the person's Put: what's under it on the track is cut away, as a drop in the
// arranger cuts) or 'refuse' (the agents' tool: bars that hold a clip are refused).
export function putGroove(
  app,
  {
    groove,
    track = undefined,
    bar = null,
    bars = null,
    seed = null,
    by = 'you',
    under = 'cut',
    label = null,
    reason = null,
    dryRun = false,
  } = {},
) {
  const g = G.getGroove(groove);
  if (!g) return err(`no groove "${groove}"`, 'find_grooves lists them; ids look like "rock/straight-eighths"');
  const t = track === undefined ? targetTrack(app) : track;
  const plan = G.planPut(app.store.get(), {
    groove: g,
    track: t ? (typeof t === 'object' ? t.id : t) : null,
    bar: bar ?? playheadBar(app),
    bars: bars ?? G.defaultBars(g),
    seed,
    studioA: studioA(app),
    device: deviceOf(app),
    under,
    planDrop: planDropTrim,
    isDrum: (x) => isDrum(app, x),
  });
  if (plan.error) return err(plan.error, plan.hint, plan.occupied ? { occupied: plan.occupied } : null);
  const out = {
    summary: plan.summary,
    groove: g.id,
    track: plan.track ? { id: plan.track, name: plan.trackName } : { new: true, name: plan.trackName },
    bars: plan.bars,
    notes: plan.notes,
    seed: plan.seed,
  };
  // a dry run hands back its ops (the notes as text), ready to offer as a take with propose_variations
  if (dryRun)
    return {
      ok: true,
      dry_run: true,
      ...out,
      ops: plan.ops.map((o) =>
        o.type === 'clip.add' ? { ...o, clip: { ...o.clip, notes: formatNotes(o.clip.notes, { names: false }) } } : o,
      ),
      note: 'nothing changed',
    };
  const res = app.store.dispatch(plan.ops, { by, label: String(label || plan.label).slice(0, 80) });
  if (!res.ok) return err(res.error, 'the song changed under it; try again');
  if (res.txn) res.txn.reason = reason ? String(reason).slice(0, 300) : plan.summary;
  const trackId = plan.track || res.created.drums,
    clip = res.created.groove;
  const result = {
    ok: true,
    txn: res.txn?.id,
    ...out,
    track: { id: trackId, name: plan.trackName, ...(plan.newTrack ? { new: true } : {}) },
    clip,
    targets: targetsOf(plan.ops, app.store.get(), res.created),
  };
  app.ui?.emit?.('grooves:placed', { by, groove: g.id, track: trackId, clip, bars: plan.bars, summary: plan.summary });
  return result;
}

// The song creator, one dispatch. ending: true, false, or null for the default (none when the loop goes round the
// drums' end); crashes: false leaves out the crash on each section's downbeat.
export function buildDrums(
  app,
  {
    style = null,
    parts = null,
    ending = null,
    crashes = true,
    seed = 1,
    by = 'you',
    label = null,
    reason = null,
    dryRun = false,
  } = {},
) {
  const plan = G.planDrumTrack(app.store.get(), {
    style,
    parts,
    ending,
    crashes,
    seed: Number.isFinite(+seed) ? +seed : 1,
    studioA: studioA(app),
    device: deviceOf(app),
    isDrum: (x) => isDrum(app, x),
  });
  if (plan.error) return err(plan.error, plan.hint);
  const out = {
    summary: plan.summary,
    style: plan.style,
    plan: plan.plan,
    kit:
      plan.kit.device === G.STUDIO_A
        ? `Studio A${plan.kit.preset ? ` (${plan.kit.preset})` : ''}`
        : plan.kit.device !== 'core.drums'
          ? app.devices?.getDevice?.(plan.kit.device)?.name || plan.kit.device
          : `Gobo Kit (${['FIELD', 'MACHINE', 'DUST', '808', '909', 'ACOUSTIC+'][plan.kit.params.kit] || 'ACOUSTIC+'})`,
    ...(plan.styleWhy ? { style_why: plan.styleWhy } : {}),
  };
  if (dryRun) return { ok: true, dry_run: true, ...out, note: 'nothing changed' };
  const res = app.store.dispatch(plan.ops, { by, label: String(label || plan.label).slice(0, 80) });
  if (!res.ok) return err(res.error, 'the song changed under it; try again');
  if (res.txn) res.txn.reason = reason ? String(reason).slice(0, 300) : plan.summary;
  const trackId = res.created.drums;
  const clips = plan.plan.sections.map((s, i) => ({
    clip: res.created[`sec${i}`],
    section: s.name,
    plays: s.plays,
    bars: s.bars,
  }));
  app.ui?.emit?.('grooves:built', { by, track: trackId, style: plan.style, summary: plan.summary });
  return {
    ok: true,
    txn: res.txn?.id,
    ...out,
    track: { id: trackId, name: plan.trackName },
    clips,
    targets: targetsOf(plan.ops, app.store.get(), res.created),
  };
}

/* ------------------------------------------------------------------------------------------------ the tools */
const view = (g, extra = {}) => ({
  id: g.id,
  name: g.name,
  style: g.styleName,
  part: g.part,
  feel: g.feel,
  length: G.lengthLabel(g),
  tempo: g.tempo,
  grid: G.gridText(g),
  about: G.describe(g),
  ...extra,
});
// A rhythm an agent gives: onsets (seconds), beats, or a drum grid -> taps [{ t, voice }] and a tempo when it's fixed
function tapsOf(r, song) {
  if (!r || typeof r !== 'object') return null;
  const voices = Array.isArray(r.voices) ? r.voices : [];
  if (Array.isArray(r.onsets) && r.onsets.length)
    return { taps: r.onsets.map((t, i) => ({ t: Number(t), voice: voices[i] || null })), tempo: null };
  if (Array.isArray(r.beats) && r.beats.length)
    return { taps: r.beats.map((b, i) => ({ t: (Number(b) * 60) / 120, voice: voices[i] || null })), tempo: 120 };
  const grid = r.rows ? r : r.grid && r.grid.rows ? r.grid : null;
  if (grid) {
    const notes = parseGrid(grid);
    const fam = (p) => (G.familyOf(p) === 'kick' ? 'kick' : G.familyOf(p) === 'snare' ? 'snare' : 'hat');
    return { taps: notes.map((n) => ({ t: (n.t * 60) / 120, voice: fam(n.p) })), tempo: 120 };
  }
  return null;
}
function findTool(app, input = {}) {
  const limit = Math.max(1, Math.min(24, Math.round(Number(input.limit) || (input.rhythm ? 5 : 8))));
  const style = input.style ? G.getStyle(input.style) : null;
  if (input.style && !style)
    return err(
      `no style "${input.style}"`,
      `styles: ${G.library()
        .styles.map((s) => s.id)
        .join(', ')}`,
    );
  const part = input.part ? G.partWord(input.part) : null;
  if (input.part && !part) return err(`no part "${input.part}"`, `parts: ${G.PARTS.join(', ')}`);
  const styles = style
    ? undefined
    : G.library().styles.map((s) => ({
        id: s.id,
        name: s.name,
        blurb: s.blurb,
        tempo: s.tempo,
        grooves: s.grooves.length,
      }));
  if (input.rhythm) {
    let parsed;
    try {
      parsed = tapsOf(input.rhythm, app.store.get());
    } catch (e) {
      return err(
        `could not read the rhythm: ${e.message}`,
        'rhythm is { onsets: [seconds] }, { beats: [...] } or a grid { steps, step, rows: { kick: "x...", snare: "....x..." } }',
      );
    }
    if (!parsed || parsed.taps.length < 3)
      return err(
        'a rhythm needs at least three onsets',
        'rhythm: { onsets: [0, 0.3, 0.6, 0.9], voices?: ["kick", "hat", "snare", "hat"] }',
      );
    const m = G.matchTaps(parsed.taps, {
      limit,
      parts: part ? [part] : G.MAIN_PARTS,
      styles: style ? [style.id] : null,
      tempo: parsed.tempo,
    });
    if (!m)
      return err(
        'those onsets are too close together to read a tempo from',
        'two bars or so of a rhythm, at least three onsets',
      );
    const songTempo = app.store.get().tempo;
    return {
      rhythm: { onsets: m.taps, voiced: m.voiced, ...(parsed.tempo ? {} : { tapped_bpm: m.bpm }), song_bpm: songTempo },
      grooves: m.results.map((r) =>
        view(r.groove, {
          score: r.score,
          matched: `${r.matched} of ${r.of} onsets on its hits`,
          ...(parsed.tempo ? {} : { read_at_bpm: r.bpm }),
        }),
      ),
      ...(styles ? { styles } : {}),
      note: `closest first; each plays at the song's ${songTempo} BPM when used (use_groove)`,
    };
  }
  const list = G.findGrooves({
    style: style?.id,
    part,
    feel: input.feel,
    tempo: Number(input.tempo) || null,
    query: input.query,
    limit,
  });
  if (!list.length)
    return { grooves: [], ...(styles ? { styles } : {}), note: 'nothing matched all of that; fewer filters find more' };
  return { grooves: list.map((g) => view(g)), ...(styles ? { styles } : {}) };
}
function recordingError(app) {
  if (!isRecording(app)) return null;
  return err(
    'recording',
    'The human is recording. Try again when the take stops (get_recording with wait_seconds waits for it).',
  );
}
function useTool(app, by, input = {}) {
  const busy = recordingError(app);
  if (busy) return busy;
  const g = G.getGroove(input.groove);
  if (!g) return err(`no groove "${input.groove}"`, 'find_grooves lists them; ids look like "funk/ghost-notes"');
  let track;
  if (G.isNewTrack(input.track))
    track = null; // "new": a new Drums track, never the default one again
  else if (input.track != null && input.track !== '') {
    const p = app.store.get();
    track =
      p.tracks.find((x) => x.id === input.track) ||
      p.tracks.find((x) => x.name.toLowerCase() === String(input.track).toLowerCase()) ||
      String(input.track);
  }
  const bars = input.bars == null ? null : Number(input.bars);
  if (bars != null && !(bars >= 1 && bars <= 64)) return err('bars is how many bars it plays: 1 to 64');
  const bar = input.bar == null ? null : Number(input.bar);
  if (bar != null && !(bar >= 1 && Number.isFinite(bar))) return err('bar is 1-based: 1 or more');
  const r = putGroove(app, {
    groove: g,
    track,
    bar,
    bars,
    seed: input.seed == null ? null : Number(input.seed),
    by,
    under: 'refuse',
    label: input.label,
    reason: input.reason,
    dryRun: !!input.dry_run,
  });
  if (r.ok && !r.dry_run) {
    try {
      app.presence?.highlight?.({ track: r.track.id, clip: r.clip }, `${g.styleName}, ${g.name}`, by, 4000);
    } catch (e) {
      /* presence is a nicety */
    }
  }
  return r.ok ? { ...r, undo: r.dry_run ? undefined : 'undo (your latest) or revert_my_changes' } : r;
}
function drumTool(app, by, input = {}) {
  const busy = recordingError(app);
  if (busy) return busy;
  if (input.style && !G.getStyle(input.style))
    return err(
      `no style "${input.style}"`,
      `styles: ${G.library()
        .styles.map((s) => s.id)
        .join(', ')}`,
    );
  for (const k of ['ending', 'crashes'])
    if (input[k] != null && typeof input[k] !== 'boolean')
      return err(
        `${k} is true or false`,
        k === 'ending'
          ? "leave it out for the default: no ending when the loop goes round the song's end, else the style's ending"
          : "leave it out for a crash on each section's downbeat",
      );
  const r = buildDrums(app, {
    style: input.style || null,
    parts: input.parts && typeof input.parts === 'object' ? input.parts : null,
    ending: input.ending ?? null,
    crashes: input.crashes !== false,
    seed: input.seed ?? 1,
    by,
    label: input.label,
    reason: input.reason,
    dryRun: !!input.dry_run,
  });
  if (r.ok && !r.dry_run) {
    try {
      app.presence?.highlight?.(
        { track: r.track.id },
        `drums for the song, ${G.getStyle(r.style)?.name || r.style}`,
        by,
        4000,
      );
    } catch (e) {
      /* presence is a nicety */
    }
  }
  return r.ok ? { ...r, undo: r.dry_run ? undefined : 'undo (your latest) or revert_my_changes' } : r;
}

// The Agent tab's line for each call ("put Funk, Ghost notes at bars 5–8"), set on the event before the panel reads it
// (this module loads before agent/panel.js, so its listener runs first; tools.js's chipFor only knows its own tools).
function chipOf({ name, input = {}, result = {} }) {
  if (result.error) return null;
  if (name === 'find_grooves') {
    const top = result.grooves?.[0];
    if (result.rhythm)
      return { icon: '•', text: top ? `matched a rhythm: closest ${top.style}, ${top.name}` : 'matched a rhythm' };
    return {
      icon: '•',
      text: `looked up ${result.grooves?.length || 0} groove${result.grooves?.length === 1 ? '' : 's'}${input.style ? ` in ${G.getStyle(input.style)?.name || input.style}` : ''}`,
    };
  }
  const g = name === 'use_groove' ? G.getGroove(input.groove) : null;
  const bars = (b) => (b && b[1] > b[0] ? `bars ${b[0]}–${b[1]}` : b ? `bar ${b[0]}` : '');
  if (name === 'use_groove')
    return {
      icon: '✎',
      text: `${result.dry_run ? 'planned' : 'put'} ${g ? `${g.styleName}, ${g.name}` : 'a groove'} at ${bars(result.bars)} on ${result.track?.name || 'Drums'}`,
      target: result.targets,
    };
  if (name === 'drum_track')
    return {
      icon: '✎',
      text: `${result.dry_run ? 'planned' : 'wrote'} drums for the song (${G.getStyle(result.style)?.name || result.style})`,
      target: result.targets,
    };
  return null;
}

const installed = new WeakSet();
export function installGrooveTools(app) {
  if (installed.has(app)) return;
  installed.add(app);
  const tools = installTools(app);
  tools.register({ ...FIND_GROOVES_SCHEMA, run: (input, ctx) => findTool(ctx.app, input || {}) });
  tools.register({ ...USE_GROOVE_SCHEMA, run: (input, ctx) => useTool(ctx.app, ctx.by, input || {}) });
  tools.register({ ...DRUM_TRACK_SCHEMA, run: (input, ctx) => drumTool(ctx.app, ctx.by, input || {}) });
  app.ui?.on?.('agent:tool', (e) => {
    if (e?.phase !== 'end' || !TOOL_NAMES.has(e.name)) return;
    const c = chipOf(e);
    if (c) e.chip = c;
  });
}
export const _test = { tapsOf, chipOf, r2 };
