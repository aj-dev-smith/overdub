// Presence: agents as visible participants. docs/ARCHITECTURE.md (Addenda: Presence).
//
//   app.presence.highlight(target, note, by = 'claude', ms = 4000) -> id
//       target: { track?, clip?, notes?: [ids], range?: { from, to } (beats), bars?: [a, b] (1-based, inclusive),
//                 insert?, section? }   (tracks may be named by id or name; sections by id or name)
//   app.presence.clear(idOrBy?)        clear one highlight, all of an author's, or all
//   app.presence.status(text, by)      a live one-line status ("rendering the chorus, 3/4"); '' clears it
//   app.presence.waiting(by?)          true while an A/B card or a question waits on the human (the pills say so)
//   app.presence.agents()              [{ by, name, kind, status, active, source }] who is around (in-app + MCP)
//   app.presence.join(by, { name, source }) / leave(by)   (the bridge calls these for outside agents)
//   app.presence.on(fn) -> off          fn({ type: 'highlight' | 'status' | 'agents', ... })
//
// It keeps ui.state.presence = [{ id, by, track?, clip?, notes?, range?, insert?, section?, note, until }] and emits
// ui.emit('presence', list) so the arranger, piano roll, rack and mixer can draw the targets. Also: a small floating
// pill that names the active agent when the agent pane is closed (click it to open the pane).

import { h, css } from '../ui/dom.js';
import { beatsPerBar } from '../core/music.js';

let seq = 0;

export function installPresence(app) {
  if (app.presence) return app.presence;
  const { ui, store } = app;
  ui.state.presence = ui.state.presence || [];
  const timers = new Map();
  const statuses = new Map();       // by -> { text, at }
  const roster = new Map();         // by -> { name, source, since, last }
  const fns = new Set();
  const fire = (e) => { for (const fn of fns) { try { fn(e); } catch (err) { console.error('presence listener', err); } } };
  const publish = () => ui.emit('presence', ui.state.presence);

  function resolveTarget(t = {}) {
    const p = store.get();
    const out = {};
    if (t.track) {
      const tr = t.track === 'master' ? null : p.tracks.find((x) => x.id === t.track) || p.tracks.find((x) => x.name.toLowerCase() === String(t.track).toLowerCase());
      if (tr) out.track = tr.id; else if (t.track === 'master') out.track = 'master';
    }
    if (t.clip) {
      const f = store.findClip?.(t.clip);
      if (f) { out.clip = f.clip.id; out.track = out.track || f.track.id; }
    }
    if (Array.isArray(t.notes) && t.notes.length) out.notes = t.notes.slice(0, 512);
    if (t.insert) out.insert = t.insert;
    const bpb = beatsPerBar(p.meter);
    if (Array.isArray(t.bars) && t.bars.length) {
      const a = Math.max(1, Number(t.bars[0]) || 1), b = Math.max(a, Number(t.bars[1] ?? t.bars[0]) || a);
      out.range = { from: (a - 1) * bpb, to: b * bpb };
    } else if (t.range && Number.isFinite(t.range.from)) out.range = { from: Math.max(0, t.range.from), to: Math.max(t.range.from, Number(t.range.to) || t.range.from + bpb) };
    if (t.section) {
      const s = p.sections.find((x) => x.id === t.section || x.name.toLowerCase() === String(t.section).toLowerCase());
      if (s) { out.section = s.id; out.range = out.range || { from: s.start, to: s.start + s.length }; }
    }
    if (out.clip && !out.range) {
      const f = store.findClip?.(out.clip);
      if (f) out.range = { from: f.clip.start, to: f.clip.start + f.clip.length };
    }
    return out;
  }

  // A human-readable name for a target: "Bass › Walk · bars 1–4"
  function describe(t) {
    const p = store.get();
    const parts = [];
    const tr = t.track === 'master' ? { name: 'Master' } : p.tracks.find((x) => x.id === t.track);
    if (tr) parts.push(tr.name);
    if (t.clip) { const f = store.findClip?.(t.clip); if (f) parts.push(f.clip.name || 'clip'); }
    if (t.insert && tr && tr.inserts) { const fx = tr.inserts.find((x) => x.id === t.insert); if (fx) parts.push(app.devices.getDevice(fx.device)?.name || fx.device); }
    let s = parts.join(' › ');
    if (t.notes?.length) s += ` · ${t.notes.length} note${t.notes.length > 1 ? 's' : ''}`;
    if (t.range) {
      const bpb = beatsPerBar(p.meter);
      const a = Math.floor(t.range.from / bpb) + 1, b = Math.max(a, Math.ceil(t.range.to / bpb));
      s += `${s ? ' · ' : ''}bar${b > a ? 's' : ''} ${a}${b > a ? '–' + b : ''}`;
    }
    return s || 'the song';
  }

  const presence = {
    resolve: resolveTarget,
    describe,
    highlight(target, note = '', by = 'claude', ms = 4000) {
      const t = resolveTarget(target);
      if (!Object.keys(t).length) return null;
      const id = 'pr' + (++seq);
      const until = Date.now() + Math.max(400, Math.min(60000, ms || 4000));
      const entry = { id, by, ...t, note: String(note || '').slice(0, 80), until, label: describe(t) };
      // one live highlight per author and target kind: a new one replaces the old (an agent has one "cursor")
      const list = ui.state.presence.filter((x) => !(x.by === by && x.sticky !== true && sameKind(x, entry)));
      for (const x of ui.state.presence) if (!list.includes(x)) { clearTimeout(timers.get(x.id)); timers.delete(x.id); }
      list.push(entry);
      ui.state.presence = list;
      timers.set(id, setTimeout(() => presence.clear(id), until - Date.now()));
      touch(by);
      publish();
      fire({ type: 'highlight', entry });
      return id;
    },
    clear(idOrBy) {
      const before = ui.state.presence.length;
      ui.state.presence = ui.state.presence.filter((x) => {
        const hit = idOrBy == null || x.id === idOrBy || x.by === idOrBy;
        if (hit) { clearTimeout(timers.get(x.id)); timers.delete(x.id); }
        return !hit;
      });
      if (ui.state.presence.length !== before) { publish(); fire({ type: 'highlight', cleared: idOrBy ?? 'all' }); }
    },
    status(text, by = 'claude') {
      if (text) statuses.set(by, { text: String(text).slice(0, 120), at: Date.now() }); else statuses.delete(by);
      if (text) touch(by);
      fire({ type: 'status', by, text: text || '' });
      ui.emit('presence:status', { by, text: text || '' });
      renderPill();
    },
    statusOf: (by) => statuses.get(by)?.text || '',
    // is an agent waiting on the human (an A/B card or a question on screen, or a status that says so)? With no `by`:
    // any agent. The pills say "waiting for you" then, not "working".
    waiting(by) {
      const reqs = app._agentTools?.requests;
      if (reqs) for (const r of reqs.values()) if (r.status === 'pending' && (by == null || r.by === by)) return true;
      const st = (b) => /^waiting for your/i.test(statuses.get(b)?.text || '');
      return by == null ? [...statuses.keys()].some(st) : st(by);
    },
    join(by, { name, source = 'mcp' } = {}) {
      if (name && store.addAuthor && !store.authors[by]) store.addAuthor(by, { kind: 'agent', name });
      const had = roster.has(by);
      roster.set(by, { ...(roster.get(by) || {}), name: name || store.author(by).name, source, since: roster.get(by)?.since || Date.now(), last: Date.now(), gone: false });
      if (!had) { fire({ type: 'agents' }); ui.emit('presence:agents', presence.agents()); }
    },
    leave(by) {
      const r = roster.get(by);
      if (!r) return;
      r.gone = true; r.last = Date.now();
      statuses.delete(by);
      presence.clear(by);
      fire({ type: 'agents' }); ui.emit('presence:agents', presence.agents());
      renderPill();
    },
    agents() {
      const out = [];
      for (const [by, r] of roster) out.push({ by, name: r.name, source: r.source, status: statuses.get(by)?.text || '', active: !r.gone && (statuses.has(by) || Date.now() - r.last < 8000), connected: !r.gone, since: r.since });
      return out;
    },
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
  };

  function touch(by) {
    if (!by || !store.isAgent(by)) return;
    const r = roster.get(by);
    if (r) { r.last = Date.now(); r.gone = false; } else roster.set(by, { name: store.author(by).name, source: by.startsWith('mcp:') ? 'mcp' : 'in-app', since: Date.now(), last: Date.now() });
  }
  function sameKind(a, b) { return !!a.notes === !!b.notes && !!a.insert === !!b.insert; }

  // every agent edit leaves a short labelled presence on what it touched (panels also flash on the change event)
  store.on('change', (e) => {
    if (e.kind !== 'do' || !store.isAgent(e.by)) return;
    const tracks = new Set();
    for (const op of e.ops || []) {
      const t = op.track && typeof op.track === 'string' && !op.track.startsWith('$') ? op.track : null;
      if (t) tracks.add(t);
    }
    if (e.created) for (const v of Object.values(e.created)) if (typeof v === 'string' && v.startsWith('t_')) tracks.add(v);
    const label = e.txn?.label || '';
    for (const t of [...tracks].slice(0, 4)) presence.highlight({ track: t }, label, e.by, 2200);
  });

  /* ---------------------------------------------------------------- spoken (agent tab out of sight) */
  // The Agent tab's feed is the live log of what agents do; when it isn't on screen (History is the active tab, the
  // right pane is closed, a narrow window), agent edits and messages are read out through ui.announce instead, one
  // coalesced line per burst ("Claude: pad bed; tweak effect"), never twice.
  const spoken = new Map();         // by -> [lines]
  let speakT = 0;
  const agentTabShown = () => (ui.visible ? ui.visible('agent') : false);
  function speak(by, line) {
    if (!ui.announce || agentTabShown() || !line) return;
    if (!spoken.has(by)) spoken.set(by, []);
    spoken.get(by).push(String(line).slice(0, 200));
    clearTimeout(speakT);
    speakT = setTimeout(flushSpoken, 450);
  }
  function flushSpoken() {
    const out = [];
    for (const [by, lines] of spoken) out.push(`${store.author(by).name}: ${lines.slice(0, 3).join('; ')}${lines.length > 3 ? `, and ${lines.length - 3} more` : ''}.`);
    spoken.clear();
    if (out.length && !agentTabShown()) ui.announce(out.join(' '));
  }
  store.on('change', (e) => {
    if (!e.by || !store.isAgent(e.by) || e.txn?.audition) return;
    if (e.kind === 'do' || e.kind === 'redo') speak(e.by, e.txn?.label);
    else if (e.kind === 'undo') speak(e.by, e.reverted ? `reverted ${e.reverted.length} change${e.reverted.length === 1 ? '' : 's'}` : `undid ${e.txn?.label || 'a change'}`);
  });
  ui.on?.('agent:say', ({ by, text } = {}) => { if (by && text && !(by === 'claude' && app.agent?.busy)) speak(by, `says “${String(text).replace(/\s+/g, ' ').trim()}”`); });

  /* ---------------------------------------------------------------- the floating pill (agent pane closed) */
  css('presence', PRESENCE_CSS);
  const pill = h('button.ew-presence-pill', { type: 'button', hidden: true, title: 'Open the agent pane (A)', onclick: () => { ui.setOpen?.('right', true); ui.show?.('agent'); } });
  document.body.append(pill);
  function renderPill() {
    const open = ui.isOpen ? ui.isOpen('right') : true;
    const live = [...statuses.entries()].filter(([, s]) => Date.now() - s.at < 60000);
    if (open || !live.length) { pill.hidden = true; return; }
    const [by, s] = live[live.length - 1];
    pill.hidden = false;
    pill.replaceChildren(h('span.ew-presence-dot'), h('b', store.author(by).name), h('span', presence.waiting(by) ? 'waiting for you' : s.text));
  }
  ui.on('resize', renderPill);

  app.presence = presence;
  return presence;
}

const PRESENCE_CSS = `
.ew-presence-pill { position: fixed; right: 14px; bottom: 14px; z-index: 60; display: flex; align-items: center; gap: 8px; max-width: min(420px, calc(100vw - 28px));
  padding: 7px 12px 7px 10px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--agent) 50%, transparent); background: color-mix(in srgb, var(--bg-3) 92%, var(--agent));
  color: var(--text-2); font: 12px var(--font-ui); box-shadow: var(--shadow-2); cursor: pointer; animation: ew-in .3s var(--ease) both; }
.ew-presence-pill[hidden] { display: none; }
.ew-presence-pill b { color: var(--agent); font-weight: 700; }
.ew-presence-pill span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ew-presence-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--agent); box-shadow: 0 0 0 0 var(--agent); animation: ew-breathe 1.6s ease-in-out infinite; flex: none; }
@keyframes ew-breathe { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--agent) 0%, transparent); opacity: .7; } }
`;

export default function (app) { installPresence(app); }
