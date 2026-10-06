// The `workspace` agent tool: what's on the person's screen. In the simple view most of the studio's features are put
// away until someone adds them (ui/workspace.js, app.ui.workspace); this lets an agent see which, bring one in when the
// person asks where something is or needs a hidden control to see or take over its change, and put back what it added.
// Layout is never a song op: nothing here touches the store, so it is in NEVER_BLOCKED (tools.js) and does its own
// recording check, stricter than the song's: no layout change at all while a take records.
//
//   app.tools.run('workspace', { action: 'list' })                                -> { view, features: [...] }
//   app.tools.run('workspace', { action: 'add', features: ['mixer'] }, { by })    -> { view, added, already, where }
//   app.tools.run('workspace', { action: 'open', feature: 'notes' }, { by })      -> { view, added, already, where }
//   app.tools.run('workspace', { action: 'put_away', features: ['mixer'] })       -> { put_away }
//   app.tools.run('workspace', { action: 'view', view: 'full', asked: true })     -> { view }
//
// Every add is signed by the caller (ctx.by): the note in the top bar and More say who. An agent puts away only what it
// added itself, or what the person asked it to (asked: true); it switches the view only when asked. In the full studio
// everything is on screen already, so add, open and put_away change nothing.
//
// The schema (WORKSPACE_SCHEMA) is in extra-schemas.js, so Node lists the tool with no tab open. This module never
// imports ui/workspace.js: it talks to app.ui.workspace, so the studio works with or without either.

import { installTools, isRecording } from './tools.js';
import { WORKSPACE_SCHEMA } from './extra-schemas.js';

const err = (error, hint, extra) => ({ error, ...(hint ? { hint } : {}), ...(extra || {}) });
const NOT_THEIRS = 'only when they ask; offer it in one line';

const idsOf = (v) => {
  if (typeof v === 'string') { try { const x = JSON.parse(v); if (Array.isArray(x)) return x.map(String); } catch (e) { /* a plain id */ } return v.split(/[\s,]+/).filter(Boolean); }
  return Array.isArray(v) ? v.map(String) : [];
};

// where each feature is on screen, in a line an agent can say ("the Mixer tab, under the song")
function whereOf(ws, ids) {
  const lines = ids.map((id) => ws.where?.(id)).filter(Boolean);
  if (!lines.length) return '';
  if (ids.length === 1) return lines[0];
  return ids.map((id) => `${ws.FEATURES.find((f) => f.id === id)?.title || id}: ${ws.where?.(id) || 'on screen'}`).join('; ');
}

export function runWorkspace(app, input = {}, { by = 'claude' } = {}) {
  const ws = app.ui?.workspace;
  if (!ws) return err('no workspace in this studio', 'everything is on screen');
  const known = new Set(ws.FEATURES.map((f) => f.id));
  const action = String(input.action || '');
  const unknown = (ids) => { const bad = ids.find((id) => !known.has(id)); return bad != null ? err(`no feature "${bad}"`, `features: ${[...known].join(', ')}`) : null; };

  if (action === 'list') {
    return {
      view: ws.view(),
      features: ws.list().map((f) => ({ id: f.id, title: f.title, purpose: f.purpose, group: f.group, shown: f.shown, added_by: f.addedBy ?? null })),
    };
  }
  if (!['add', 'open', 'put_away', 'view'].includes(action)) return err(`no action "${action}"`, 'action: list, add, open, put_away or view');
  // never while they record: the screen holds still under a take
  if (isRecording(app)) return err('the person is recording', 'wait until they stop (get_recording with wait_seconds)');

  if (action === 'view') {
    const v = String(input.view || '');
    if (v !== 'simple' && v !== 'full') return err(`no view "${v}"`, 'view: simple or full');
    if (input.asked !== true) return err('that\'s their choice', NOT_THEIRS);
    ws.setView(v, { by });
    return { view: ws.view() };
  }

  const ids = action === 'open' ? idsOf(input.feature ?? input.features).slice(0, 1) : idsOf(input.features ?? input.feature);
  if (!ids.length) return err(action === 'open' ? 'missing "feature"' : 'missing "features"', `features: ${[...known].join(', ')}`);
  const bad = unknown(ids);
  if (bad) return bad;
  if (ws.view() === 'full') return { view: 'full', note: 'everything is already on screen', ...(action !== 'put_away' ? { where: whereOf(ws, ids) } : {}) };

  if (action === 'put_away') {
    // only what this caller added, unless the person asked; a feature nobody added is put away already
    for (const id of ids) {
      const who = ws.addedBy?.(id) ?? null;
      if (who == null || who === by || input.asked === true) continue;
      return err(who === 'you' ? 'they added that' : `${app.store?.author?.(who)?.name || who} added that`, NOT_THEIRS, { feature: id });
    }
    const r = ws.putAway(ids, { by });
    return { put_away: r.put || [] };
  }

  // add, or open: add if hidden, then show its panel (or scroll its part into view)
  const r = ws.add(ids, { by });
  if (action === 'open') {
    const f = ws.FEATURES.find((x) => x.id === ids[0]);
    const panel = f?.panels?.find((p) => app.ui.panels?.has?.(p)) || f?.panels?.[0];
    try {
      if (panel) app.ui.show?.(panel, { by });
      else globalThis.document?.querySelector?.(`[data-feature~="${ids[0]}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } catch (e) { /* the add stands; showing it is a nicety */ }
  }
  return { view: ws.view(), added: r.added || [], already: r.already || [], where: whereOf(ws, ids) };
}

export const WORKSPACE_TOOL = {
  ...WORKSPACE_SCHEMA,   // name, annotations, description, input_schema (extra-schemas.js: Node lists it with no tab open)
  run(input, ctx) { return runWorkspace(ctx.app, input, { by: ctx.by }); },
};

export default function (app) {
  installTools(app).register(WORKSPACE_TOOL);
}
