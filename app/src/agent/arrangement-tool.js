// The `arrange_song` agent tool: the arranger's structural moves (core/arrangement.js) for agents. Duplicate a section
// with its clips, insert or delete bars across the song, repeat a clip, split a clip. One call = one undo step signed
// by the agent, with a one-line summary of what moved. The human has the same moves in the section and clip menus.
//
//   app.tools.run('arrange_song', { op: 'duplicate_section', section: 'Chorus' }, { by })
//   -> { ok, txn, label, summary, moved, created, targets } | { error, hint }

import { installTools } from './tools.js';
import { ARRANGE_SONG_SCHEMA } from './extra-schemas.js';
import { planSectionDuplicate, planTimeInsert, planTimeRemove, planClipRepeat, planClipSplit, spanLabel, whereLabel } from '../core/arrangement.js';
import { beatsPerBar } from '../core/music.js';
import { targetsOf } from './diff.js';

const err = (error, hint, extra) => ({ error, ...(hint ? { hint } : {}), ...(extra || {}) });
const num = (v) => (v == null || v === '' ? null : Number(v));

export const ARRANGE_SONG_TOOL = {
  ...ARRANGE_SONG_SCHEMA,   // name, description, input_schema (extra-schemas.js: Node lists it with no tab open)
  run(input, ctx) { return runTool(ctx.app, ctx.by, input || {}); },
};

// A position from bar (1-based) or beat; a length from bars or beats.
function position(input, bpb, what) {
  const bar = num(input.bar), beat = num(input.beat);
  if (beat != null) { if (!(Number.isFinite(beat) && beat >= 0)) throw new Error(`beat must be a song beat >= 0 (${what})`); return beat; }
  if (bar != null) { if (!(Number.isFinite(bar) && bar >= 1)) throw new Error(`bar is 1-based: 1 or more (${what})`); return (bar - 1) * bpb; }
  return null;
}
function span(input, bpb) {
  const bars = num(input.bars), beats = num(input.beats);
  const n = beats != null ? beats : (bars != null ? bars : 1) * bpb;
  if (!(Number.isFinite(n) && n > 0)) throw new Error('bars (or beats) must be more than 0');
  return n;
}

// The plan for this call -> { plan, label, target, op } (throws with what would work). op: the same move as one
// arrangement op (core/ops.js), which the store's guard reads on a song from a link (agent/keep.js: bars taken out wait
// for the person's Keep; a split, a copy or bars put in take nothing).
function planFor(app, input) {
  const p = app.store.get(), bpb = beatsPerBar(p.meter);
  const sel = app.ui?.state?.selection || {};
  const sectionList = () => p.sections.map((s) => `"${s.name}" (${s.id}, ${whereLabel(p, s.start)}, ${spanLabel(p, s.length)})`).join(', ') || 'none';
  const clipArgs = () => {
    const clip = input.clip || sel.clip;
    if (!clip) throw new Error('which clip? pass clip (and track), or ask the human to select one');
    return { track: input.clip ? input.track : null, clip };
  };
  switch (input.op) {
    case 'duplicate_section': {
      if (!input.section) throw new Error(`which section? pass section (sections: ${sectionList()})`);
      const toBar = num(input.to_bar);
      if (toBar != null && !(Number.isFinite(toBar) && toBar >= 1)) throw new Error('to_bar is 1-based: 1 or more');
      const args = { section: input.section, to: toBar != null ? (toBar - 1) * bpb : null, push: input.push !== false };
      const plan = planSectionDuplicate(p, args);
      return { plan, label: `duplicate ${plan.source}`, target: { range: { from: plan.to, to: plan.to + plan.length } }, op: { type: 'section.duplicate', ...args } };
    }
    case 'insert_bars': {
      const at = position(input, bpb, 'where the new bars go in');
      if (at == null) throw new Error('where? pass bar (the new bars go in before it) or beat');
      const plan = planTimeInsert(p, { at, length: span(input, bpb) });
      return { plan, label: `insert ${spanLabel(p, plan.length)} at ${whereLabel(p, at)}`, target: { range: { from: at, to: at + plan.length } }, op: { type: 'time.insert', at, length: plan.length } };
    }
    case 'remove_bars': {
      let at = position(input, bpb, 'the first bar to delete'), length;
      if (input.section && at == null) {
        const s = p.sections.find((x) => x.id === input.section) || p.sections.find((x) => x.name.toLowerCase() === String(input.section).toLowerCase());
        if (!s) throw new Error(`no section "${input.section}" (sections: ${sectionList()})`);
        at = s.start; length = s.length;
      } else {
        if (at == null) throw new Error('which bars? pass bar and bars (or a section)');
        length = span(input, bpb);
      }
      const plan = planTimeRemove(p, { at, length });
      return { plan, label: `delete ${spanLabel(p, length)} from ${whereLabel(p, at)}`, target: { range: { from: at, to: at + bpb } }, op: { type: 'time.remove', at, length } };
    }
    case 'repeat_clip': {
      const args = { ...clipArgs(), times: num(input.times) ?? 2, mode: input.mode || 'copies' };
      const plan = planClipRepeat(p, args);
      const f = app.store.findClip(plan.clip);
      return { plan, label: `${plan.clips.length ? 'repeat' : 'loop'} ${f?.clip.name || f?.track.name || 'clip'} ×${num(input.times) ?? 2}`, target: { track: plan.track, clip: plan.clip }, op: { type: 'clip.repeat', ...args, track: plan.track, clip: plan.clip } };
    }
    case 'split_clip': {
      const ca = clipArgs();
      let at = position(input, bpb, 'where to cut');
      if (at == null) {
        const f = app.store.findClip(ca.clip), beat = app.engine?.beat ?? 0;
        if (f && beat > f.clip.start && beat < f.clip.start + f.clip.length) at = beat;
        else throw new Error(`where? pass bar or beat (the playhead, beat ${Math.round(beat * 100) / 100}, isn't over that clip${f ? `: it covers beats ${f.clip.start}–${f.clip.start + f.clip.length}` : ''})`);
      }
      const plan = planClipSplit(p, { ...ca, at });
      const f = app.store.findClip(ca.clip);
      return { plan, label: `split ${f?.clip.name || f?.track.name || 'a clip'} at ${whereLabel(p, at)}`, target: { track: plan.track, clip: plan.clip }, op: { type: 'clip.split', track: f?.track.id ?? ca.track, clip: ca.clip, at } };
    }
    default:
      throw new Error(`op must be one of duplicate_section, insert_bars, remove_bars, repeat_clip, split_clip (got ${JSON.stringify(input.op)})`);
  }
}

// What moved, compactly, for the agent.
function movedOf(op, pl) {
  switch (op) {
    case 'duplicate_section': return { section: pl.name, from_beat: pl.from, to_beat: pl.to, beats: pl.length, clips_copied: pl.clips.length, notes_copied: pl.notes, pushed: pl.pushed, ...(pl.insert ? { clips_moved_right: pl.insert.moved, clips_split: pl.insert.split, sections_moved: pl.insert.sections.moved, loop_moved: pl.insert.loop } : {}) };
    case 'insert_bars': return { at_beat: pl.at, beats: pl.length, clips_moved_right: pl.moved, clips_split: pl.split, sections_moved: pl.sections.moved, sections_grown: pl.sections.grown, loop_moved: pl.loop };
    case 'remove_bars': return { at_beat: pl.at, beats: pl.length, clips_removed: pl.removed, clips_trimmed: pl.trimmed, clips_moved_left: pl.moved, notes_cut: pl.notesCut, sections_removed: pl.sections.removed, sections_shortened: pl.sections.shortened, sections_moved: pl.sections.moved, loop: pl.loop || 'unchanged' };
    case 'repeat_clip': return { clip: pl.clip, new_clips: pl.clips, until_beat: pl.until, overlaps: pl.overlaps };
    case 'split_clip': return { new_clip: pl.clip, notes_before: pl.left, notes_after: pl.right, notes_cut: pl.cut };
    default: return {};
  }
}

function runTool(app, by, input) {
  let r;
  try { r = planFor(app, input); } catch (e) {
    const m = String(e.message || e);
    return err(m, /(holds|runs) up to/.test(m) ? 'nothing changed; a smaller step fits (fewer times, fewer bars, a shorter part)' : /section/.test(m) ? 'get_project lists the sections with their bars' : /clip/.test(m) ? 'get_project lists the clips (ids, beats); get_selection gives the selected one' : 'bars are 1-based; beats are song beats from 0');
  }
  const { plan } = r;
  if (!plan.ops.length) return { ok: true, txn: null, summary: plan.summary, moved: movedOf(input.op, plan), note: 'nothing needed to change' };
  const label = String(input.label || r.label).slice(0, 80);
  const res = app.store.dispatch(plan.ops, { by, label, as: r.op ? [r.op] : null });
  if (!res.ok) return err(res.error, 'the song changed under it; read it again and retry');
  if (res.txn) { res.txn.reason = input.reason ? String(input.reason).slice(0, 300) : plan.summary; app.ui?.emit?.('history:annotate', { txn: res.txn }); }
  try { app.presence?.highlight?.(r.target, label, by, 4000); } catch (e) { /* presence is a nicety */ }
  const created = {};
  if (plan.section && input.op === 'duplicate_section') { created.section = plan.section; created.clips = plan.clips.map((c) => c.clip); }
  if (input.op === 'repeat_clip' && plan.clips.length) created.clips = plan.clips;
  if (input.op === 'split_clip') created.clip = plan.clip;
  const targets = targetsOf(plan.ops, app.store.get(), res.created);   // what the chip points at: the clips it moved, cut or made
  return { ok: true, txn: res.txn?.id, label, summary: plan.summary, moved: movedOf(input.op, plan), ...(Object.keys(created).length ? { created } : {}), targets, undo: 'undo (your latest) or revert_my_changes' };
}

export default function (app) {
  installTools(app).register(ARRANGE_SONG_TOOL);
}
