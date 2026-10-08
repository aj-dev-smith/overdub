// The `transform` agent tool: the same musical transforms and infill the piano roll's Transform menu runs for the
// human (core/transforms.js), for agents. One call = one undo step signed by the agent, or, when it would rewrite
// notes a person wrote, a ready-made proposal for propose_variations (the room's rules, docs/AGENTS.md).
//
//   app.tools.run('transform', { name: 'strum', target: { track: 'Keys', clip: 'c_…' }, params: { direction: 'down' } }, { by })
//   -> { ok, txn, label, summary, added, changed, removed, notes } | { proposal: true, variations: [...], hint } | { error, hint }

import { installTools } from './tools.js';
import { TRANSFORMS, findTransform, planTransform, labelFor, readParams, isDrumDevice } from '../core/transforms.js';
import { TRANSFORM_SCHEMA } from './extra-schemas.js';
import { formatNotes, beatsPerBar } from '../core/music.js';

const err = (error, hint, extra) => ({ error, ...(hint ? { hint } : {}), ...(extra || {}) });

export const TRANSFORM_TOOL = {
  ...TRANSFORM_SCHEMA, // name, description, input_schema (extra-schemas.js: Node lists it with no tab open)
  run(input, ctx) {
    return runTool(ctx.app, ctx.by, input);
  },
};

function findTrack(app, ref) {
  if (!ref) return null;
  const p = app.store.get();
  return (
    p.tracks.find((t) => t.id === ref) ||
    p.tracks.find((t) => t.name.toLowerCase() === String(ref).toLowerCase()) ||
    null
  );
}
const parse = (v) => {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
};

// Which clip and notes: the target, else the human's selection.
function resolveTarget(app, target) {
  const store = app.store,
    sel = app.ui?.state?.selection || {};
  const t = target || {};
  let track = t.track ? findTrack(app, t.track) : null;
  if (t.track && !track)
    return {
      error: err(
        `no track "${t.track}"`,
        `tracks: ${store
          .get()
          .tracks.map((x) => `${x.id} "${x.name}"`)
          .join(', ')}`,
      ),
    };
  let f = null;
  if (t.clip) {
    f = store.findClip(t.clip);
    if (!f)
      return {
        error: err(
          `no clip "${t.clip}"`,
          track
            ? `${track.name}'s clips: ${track.clips.map((c) => `${c.id} "${c.name || ''}" @${c.start}`).join(', ') || 'none'}`
            : 'get_project lists the clips',
        ),
      };
    if (track && f.track.id !== track.id)
      return { error: err(`clip ${t.clip} is on ${f.track.name}, not ${track.name}`) };
  } else if (track) {
    if (sel.clip) {
      const s = store.findClip(sel.clip);
      if (s && s.track.id === track.id) f = s;
    }
    if (!f && track.clips.filter((c) => c.kind === 'notes').length === 1)
      f = { track, clip: track.clips.find((c) => c.kind === 'notes') };
    if (!f)
      return {
        error: err(
          `which clip on ${track.name}?`,
          `pass target.clip: ${track.clips.map((c) => `${c.id} "${c.name || ''}" @${c.start}`).join(', ') || 'it has none'}`,
        ),
      };
  } else if (sel.clip) f = store.findClip(sel.clip);
  if (!f) return { error: err('no clip to transform', 'pass target: { track, clip } or ask the human to select one') };
  if (f.clip.kind !== 'notes')
    return { error: err(`${f.clip.name || f.clip.id} is an audio clip`, 'transforms work on notes clips') };
  track = f.track;
  let ids = null,
    scope = `${track.name} › ${f.clip.name || 'clip'}`;
  if (Array.isArray(t.notes) && t.notes.length) {
    const have = new Set(f.clip.notes.map((n) => n.id));
    ids = t.notes.filter((id) => have.has(id));
    if (!ids.length)
      return {
        error: err(
          'none of those note ids are in that clip',
          'get_selection or get_project detail "full" gives note ids',
        ),
      };
    scope += `, ${ids.length} notes`;
  } else if (Array.isArray(t.bars) && t.bars.length) {
    const bpb = beatsPerBar(app.store.get().meter);
    const a = (Math.max(1, Number(t.bars[0]) || 1) - 1) * bpb,
      b = Math.max(1, Number(t.bars[1] ?? t.bars[0]) || 1) * bpb;
    ids = f.clip.notes.filter((n) => f.clip.start + n.t >= a - 1e-6 && f.clip.start + n.t < b - 1e-6).map((n) => n.id);
    if (!ids.length)
      return {
        error: err(
          `no notes in bars ${t.bars.join('–')} of that clip`,
          `bars are the song's, 1-based: the clip covers bars ${Math.floor(f.clip.start / bpb) + 1}–${Math.ceil((f.clip.start + f.clip.length) / bpb)} (beats ${f.clip.start}–${f.clip.start + f.clip.length})`,
        ),
      };
    scope += `, bars ${t.bars[0]}–${t.bars[1] ?? t.bars[0]}`;
  } else if (!target && sel.clip === f.clip.id && sel.notes?.size) {
    ids = [...sel.notes].filter((id) => f.clip.notes.some((n) => n.id === id));
    if (ids.length) scope += `, ${ids.length} selected notes`;
    else ids = null;
  }
  return { track, clip: f.clip, ids, scope };
}

function plan(app, tr, name, params) {
  const p = app.store.get();
  return planTransform(name, tr.clip.notes, {
    ids: tr.ids,
    params,
    key: p.key,
    meter: p.meter,
    tempo: p.tempo,
    start: tr.clip.start,
    length: tr.clip.length,
    drums: isDrumDevice(tr.track.instrument?.device),
    track: tr.track.id,
    clip: tr.clip.id,
  });
}

// Notes a person wrote that the plan would move, change or remove.
function humanTouched(app, tr, pl) {
  const ids = new Set([...pl.changedIds, ...pl.removedIds]);
  return tr.clip.notes.filter((n) => ids.has(n.id) && app.store.author(n.by || tr.clip.by)?.kind === 'human').length;
}

// Additive results into a new clip on another track.
function intoTrack(app, tr, pl, ref, label) {
  const dest = findTrack(app, ref);
  if (!dest)
    return {
      error: err(
        `no track "${ref}"`,
        `tracks: ${app.store
          .get()
          .tracks.map((x) => `"${x.name}"`)
          .join(', ')}`,
      ),
    };
  if (dest.kind !== 'instrument')
    return { error: err(`${dest.name} is an audio track`, 'into_track needs an instrument track') };
  if (pl.changed || pl.removed)
    return {
      error: err(
        `${pl.label.toLowerCase()} edits existing notes, so it can't go to another track`,
        'into_track works for transforms that only add notes',
      ),
    };
  const add = pl.ops.find((o) => o.type === 'notes.add');
  if (!add) return { error: err('nothing new to place') };
  return {
    ops: [
      {
        type: 'clip.add',
        track: dest.id,
        ref: 'tx',
        clip: {
          kind: 'notes',
          start: tr.clip.start,
          length: pl.length || tr.clip.length,
          name: label.slice(0, 40),
          notes: add.notes,
        },
      },
    ],
    dest,
  };
}

// The second take for a proposal: the first preset that differs from what was asked (or another seed).
function altParams(t, p) {
  const cur = readParams(t, p);
  for (const pr of t.presets) {
    const q = readParams(t, { ...p, ...pr });
    if (Object.keys(pr).some((k) => String(q[k]) !== String(cur[k]))) return q;
  }
  return 'seed' in t.params ? { ...cur, seed: (Number(cur.seed) || 1) + 1 } : null;
}

// What a transform takes, for an error: each param with its options or range and its default.
const paramsHint = (t) =>
  `${t.name} takes ${Object.entries(t.params)
    .map(
      ([k, s]) =>
        (s.opts
          ? `${k}: ${s.opts.join(' | ')}`
          : typeof s.def === 'boolean'
            ? `${k}: true | false`
            : k === 'seed'
              ? 'seed: any number'
              : `${k}: a number${s.min != null ? ` ${+s.min.toFixed(5)} to ${+s.max.toFixed(5)}` : ''}`) +
        (s.def != null ? ` (default ${s.def})` : ''),
    )
    .join('; ')}`;

// readParams quietly falls back to the default for a value it can't read (the piano roll's menu never sends one);
// an agent's "octave: 'down'" would then double an octave UP and report success, so a bad one is refused here.
function badParam(t, params) {
  for (const [k, v] of Object.entries(params)) {
    const s = t.params[k];
    if (!s) return `${t.name} has no param "${k}"`;
    if (v === undefined || v === null || v === '') continue;
    if (s.opts && !s.opts.includes(String(v))) return `${k} "${v}" isn't one of ${t.name}'s options`;
    if (!s.opts && typeof s.def === 'boolean' && ![true, false, 'true', 'false', 0, 1].includes(v))
      return `${k} must be true or false`;
    if (!s.opts && typeof s.def !== 'boolean' && k !== 'seed' && !Number.isFinite(Number(v)))
      return `${k} must be a number, not "${v}"`;
  }
  return null;
}

function runTool(app, by, input) {
  const t = findTransform(input.name);
  if (!t) return err(`no transform "${input.name}"`, `transforms: ${TRANSFORMS.map((x) => x.name).join(', ')}`);
  const params = parse(input.params) || {};
  if (typeof params !== 'object' || Array.isArray(params))
    return err('params must be an object', `e.g. ${JSON.stringify(t.presets[0])}`);
  const bad = badParam(t, params);
  if (bad) return err(bad, `${paramsHint(t)}. Nothing changed.`);
  const target = parse(input.target);
  const tr = resolveTarget(app, target && typeof target === 'object' ? target : null);
  if (tr.error) return tr.error;
  const pl = plan(app, tr, t.name, params);
  if (pl.error) return err(pl.error, pl.hint);
  const mode = input.mode || 'auto';
  const where = tr.track.name;
  const label = String(input.label || labelFor(t.name, pl.params, where)).slice(0, 80);
  let ops = pl.ops,
    dest = null;
  if (input.into_track) {
    const r = intoTrack(app, tr, pl, input.into_track, label);
    if (r.error) return r.error;
    ops = r.ops;
    dest = r.dest;
  }
  const human = dest ? 0 : humanTouched(app, tr, pl);
  if (mode === 'propose' || (mode === 'auto' && human)) {
    const alt = altParams(t, pl.params);
    const variations = [
      { label: `${t.label.toLowerCase()} ${t.describe(pl.params)}`.slice(0, 48), ops, why: pl.summary },
    ];
    if (alt) {
      const pl2 = plan(app, tr, t.name, alt);
      let ops2 = pl2.ops;
      if (!pl2.error && input.into_track) {
        const r2 = intoTrack(app, tr, pl2, input.into_track, label);
        ops2 = r2.error ? null : r2.ops;
      }
      if (!pl2.error && ops2)
        variations.push({
          label:
            `${t.label.toLowerCase()} ${t.describe(pl2.params)}${String(alt.seed) !== String(pl.params.seed) && t.describe(pl2.params) === t.describe(pl.params) ? ' (take 2)' : ''}`.slice(
              0,
              48,
            ),
          ops: ops2,
          why: pl2.summary,
        });
    }
    return {
      proposal: true,
      applied: false,
      scope: tr.scope,
      summary: pl.summary,
      rewrites_human_notes: human || undefined,
      title: `${t.label} · ${tr.scope}`.slice(0, 80),
      target: { track: tr.track.id, clip: tr.clip.id, ...(tr.ids ? { notes: tr.ids } : {}) },
      variations,
      hint: human
        ? `This would rewrite ${human} note${human === 1 ? '' : 's'} the human wrote, so nothing changed. Offer it: propose_variations({ title, target, variations }) with these${variations.length < 2 ? ' plus a take of your own (2-4 needed)' : ''}; or mode "apply" if they asked for exactly this.`
        : `Nothing changed. propose_variations({ title, target, variations }) offers these as takes${variations.length < 2 ? ' (add one more: 2-4 needed)' : ''}.`,
    };
  }
  const res = app.store.dispatch(ops, { by, label });
  if (!res.ok) return err(res.error, 'the song changed under it; read it again and retry');
  if (res.txn) {
    res.txn.reason = input.reason ? String(input.reason).slice(0, 300) : pl.summary;
    app.ui?.emit?.('history:annotate', { txn: res.txn });
  }
  try {
    if (app.presence?.highlight)
      app.presence.highlight(
        dest ? { track: dest.id, clip: res.created?.tx } : { track: tr.track.id, clip: tr.clip.id },
        `${t.label.toLowerCase()}`,
        by,
        4000,
      );
  } catch {
    /* presence is a nicety */
  }
  const after = dest ? null : app.store.findClip(tr.clip.id)?.clip;
  const keep = new Set([...(tr.ids || []), ...(res.created?.notes || [])]);
  const shown = after ? (tr.ids ? after.notes.filter((n) => keep.has(n.id)) : after.notes) : null;
  return {
    ok: true,
    txn: res.txn?.id,
    label,
    scope: tr.scope,
    summary: pl.summary,
    added: pl.added,
    changed: pl.changed,
    removed: pl.removed,
    clip_length: pl.length || undefined,
    into: dest ? { track: dest.name, clip: res.created?.tx } : undefined,
    notes: shown ? (shown.length > 160 ? formatNotes(shown.slice(0, 160)) + ' …' : formatNotes(shown)) : undefined,
    created_notes: res.created?.notes,
    targets: { tracks: [dest ? dest.id : tr.track.id], clips: [dest ? res.created?.tx : tr.clip.id] },
    undo: 'undo (your latest) takes it back',
  };
}

export default function (app) {
  installTools(app).register(TRANSFORM_TOOL);
}
