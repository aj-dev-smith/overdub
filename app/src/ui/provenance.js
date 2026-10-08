// The provenance report: the song's authorship story, as a printable page. Song menu → Provenance report opens it in a
// new tab (a blob, so nothing leaves the browser); ⌘P → Save as PDF keeps a copy. It says, plainly and with numbers:
// who wrote what share of the notes (by count and by how long they sound, per author and per track), who recorded
// what, which devices an agent wrote and the requests behind them (with their device-check reports), this session's
// edit timeline from store.history (author, label, reason; consecutive edits by one author collapsed into a run),
// where the song was forked from (meta.forkedFrom), and what the report is and isn't: a record of who did what in this
// file, not a legal opinion. The machine-readable twin is the attribution log (ui/export.js, provenance()).
//
// A device this browser holds (the song brought it and its code hasn't been allowed to run here: devices/trust.js) is
// listed with held: true and never checked for the report: nothing here compiles or runs it, and the page says so.
//
// Pure halves (no DOM; tools/provenance-test.js runs them in Node):
//   provenanceModel(project, { history, author, getDevice, held, checks, session, now }) -> the numbers (an object)
//   provenanceHtml(model, { logo?, wordmark?, fonts?, fontSrc? }) -> a whole HTML document (strict CSP: no scripts,
//                                     images as data: URLs, fonts as data: URLs or from fontSrc, the studio's origin)
//   normCheck(report, source, at?) -> a check report from kernel/check.js, a define_device result or the house
//                                     summaries (devices/library/reports.js), in one shape
// In the page:
//   installProvenance(app)   remembers this session's define_device check reports and the requests behind them;
//                            registers the `provenance_report` agent tool; sets app.provenance
//   app.provenance = { model(), html(), open(), session }
//   openProvenanceReport(app) -> Promise<{ ok, url?, downloaded?, model }>   call it from the click (it opens the tab
//                            first, so popup blockers let it through), then fills it in

import { PROVENANCE_SCHEMA, capText } from '../agent/extra-schemas.js';

const HISTORY_MAX = 500; // core/store.js keeps the last 500 transactions

/* ================================================================ the numbers */
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

export function defaultAuthor(id, project) {
  const named = project?.meta?.authors?.[id];
  if (named && named.name) return { kind: named.kind || 'human', name: named.name };
  if (id === 'you') return { kind: 'human', name: 'You' };
  if (id === 'claude') return { kind: 'agent', name: 'Claude' };
  if (id === 'overdub') return { kind: 'house', name: 'Overdub' };
  if (id === 'claude.ai') return { kind: 'agent', name: 'Claude (claude.ai)' };
  if (String(id).startsWith('mcp:')) return { kind: 'agent', name: String(id).slice(4) || 'Agent' };
  return { kind: 'human', name: String(id) };
}

// One shape for a device check, whichever way it arrived.
export function normCheck(c, source, at = null) {
  if (!c) return null;
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
  const warnings = Array.isArray(c.warnings) ? c.warnings.map(String) : [];
  return {
    source, // 'built' (this session, by the agent's own call) | 'rerun' (for this report) | 'house' (the library's)
    at,
    ok: c.ok !== false,
    checked: c.checked !== false,
    kind: c.kind || null,
    lufs: num(c.level ? c.level.lufs : c.lufs),
    deltaLU: num(c.level ? c.level.deltaLU : c.deltaLU),
    truePeak: num(c.truePeak),
    tail: num(c.tail && typeof c.tail === 'object' ? c.tail.seconds : c.tail),
    cpu: num(c.cpu && typeof c.cpu === 'object' ? c.cpu.pct : c.cpu),
    deterministic: typeof c.deterministic === 'boolean' ? c.deterministic : null,
    nan: !!c.nan,
    warnings,
    warningCount: warnings.length || (Number.isFinite(c.warnings) ? c.warnings : 0),
    errors: Array.isArray(c.errors) ? c.errors.map(String) : [],
  };
}

// Every device a song uses: where it sits and who put it there.
function placements(p) {
  const out = new Map(); // id -> [{ track, slot, by }]
  const add = (id, track, slot, by) => {
    if (!id) return;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ track, slot, by });
  };
  for (const t of p.tracks || []) {
    if (t.instrument?.device) add(t.instrument.device, t.name, 'instrument', t.by);
    for (const fx of t.inserts || []) add(fx.device, t.name, 'effect', fx.by);
  }
  for (const fx of p.master?.inserts || []) add(fx.device, 'Master', 'effect', fx.by);
  return out;
}

export function provenanceModel(
  p,
  {
    history = [],
    author = null,
    getDevice = () => null,
    held = () => null,
    checks = {},
    session = {},
    now = Date.now(),
  } = {},
) {
  const who = (id) => {
    const a = (author ? author(id) : defaultAuthor(id, p)) || defaultAuthor(id, p);
    return { kind: a.kind || 'human', name: a.name || String(id) };
  };
  const tempo = Number(p.tempo) || 120;
  const authors = new Map();
  const A = (id) => {
    const key = id || 'unsigned';
    if (!authors.has(key)) {
      const a = id ? who(id) : { kind: 'unsigned', name: 'Unsigned' };
      authors.set(key, {
        id: key,
        name: a.name,
        kind: a.kind,
        notes: 0,
        beats: 0,
        clips: 0,
        tracks: 0,
        audioClips: 0,
        audioBeats: 0,
        audioSecs: 0,
        effects: 0,
        devices: 0,
        edits: 0,
        notesPct: 0,
        beatsPct: 0,
      });
    }
    return authors.get(key);
  };
  let totalNotes = 0,
    totalBeats = 0,
    totalAudioSecs = 0;
  const tracks = [];
  for (const t of p.tracks || []) {
    if (t.by) A(t.by).tracks++;
    const per = new Map();
    const P = (id) => {
      const k = id || 'unsigned';
      if (!per.has(k)) per.set(k, { id: k, notes: 0, beats: 0, clips: 0, audioSecs: 0 });
      return per.get(k);
    };
    let tn = 0,
      tb = 0,
      ta = 0;
    for (const c of t.clips || []) {
      const len = Math.max(0, Number(c.length) || 0);
      A(c.by).clips++;
      P(c.by).clips++;
      if (c.kind === 'audio') {
        const secs = (len * 60) / tempo;
        const a = A(c.by);
        a.audioClips++;
        a.audioBeats += len;
        a.audioSecs += secs;
        P(c.by).audioSecs += secs;
        ta += secs;
        totalAudioSecs += secs;
        continue;
      }
      for (const n of c.notes || []) {
        const sounds = n.t >= 0 && n.t < len ? Math.max(0, Math.min(Number(n.d) || 0, len - n.t)) : 0; // how long it plays
        const a = A(n.by);
        a.notes++;
        a.beats += sounds;
        const q = P(n.by);
        q.notes++;
        q.beats += sounds;
        tn++;
        tb += sounds;
      }
    }
    for (const fx of t.inserts || []) if (fx.by) A(fx.by).effects++;
    totalNotes += tn;
    totalBeats += tb;
    const shares = [...per.values()]
      .map((s) => ({
        ...s,
        name: A(s.id).name,
        kind: A(s.id).kind,
        beats: r2(s.beats),
        audioSecs: r1(s.audioSecs),
        notesPct: tn ? r1((s.notes / tn) * 100) : 0,
        beatsPct: tb ? r1((s.beats / tb) * 100) : 0,
      }))
      .sort((a, b) => b.notes - a.notes || b.audioSecs - a.audioSecs);
    const dev = (ref) =>
      ref && ref.device
        ? {
            id: ref.device,
            name: getDevice(ref.device)?.name || p.devices?.[ref.device]?.name || ref.device,
            by: ref.by || null,
            placedBy: ref.by ? who(ref.by).name : null,
            on: ref.on !== false,
            writtenBy: devAuthor(ref.device),
            ...(held(ref.device) ? { held: true } : {}),
          }
        : null;
    tracks.push({
      id: t.id,
      name: t.name,
      color: t.color,
      kind: t.kind,
      by: t.by || null,
      byName: t.by ? who(t.by).name : null,
      instrument: t.instrument ? dev({ ...t.instrument, by: t.by }) : null,
      inserts: (t.inserts || []).map(dev),
      notes: tn,
      beats: r2(tb),
      audioSecs: r1(ta),
      shares,
    });
  }
  for (const fx of p.master?.inserts || []) if (fx.by) A(fx.by).effects++;
  function devAuthor(id) {
    // only devices someone wrote in a song or for the house shelf; the built-ins and the vendored pedals are the studio's
    const src = p.devices?.[id];
    const def = src ? null : getDevice(id);
    const by = src?.by || (def && (def.source === 'library' || def.source === 'project') ? def.by : null) || null;
    if (!by || by === 'overdub') return null;
    const w = who(by);
    return { id: by, ...w, name: src?.via ? `${w.name}, per the sender` : w.name }; // via: a share link vouched for it
  }

  /* ---- devices written in the song, and the house shelf's agent-written ones it uses */
  const used = placements(p);
  const defineTxns = new Map(); // device id -> the latest transaction that wrote it
  for (const t of history)
    for (const op of t.ops || [])
      if (op.type === 'device.define' && op.device?.id) defineTxns.set(String(op.device.id).toLowerCase(), t);
  const devices = [];
  const seen = new Set();
  const deviceEntry = (id, src, origin) => {
    const by = src.by || 'unsigned';
    const a = who(by);
    const txn = defineTxns.get(id) || null;
    const ses = session[id] || null;
    const kept = origin === 'song' && !!held(id); // held: kept off here, never checked for the report
    const check = kept ? null : checks[id] || (ses?.check ? normCheck(ses.check, 'built', ses.at) : null);
    return {
      ...(kept ? { held: true } : {}),
      id,
      name: src.name || id,
      kind: src.kind || null,
      cat: src.cat || null,
      blurb: src.blurb || null,
      origin, // 'song' | 'library'
      by,
      author: src.via ? `${a.name}, per the sender` : a.name,
      via: src.via || null,
      authorKind: a.kind,
      version: src.version || 1,
      created: src.created || null,
      modified: src.modified || null,
      request: src.request || ses?.request || null,
      requestBy: src.request ? null : ses?.requestBy || null,
      reason: txn?.reason || null,
      label: txn?.label || null,
      at: txn?.at || null,
      usedOn: (used.get(id) || []).map((u) => ({ ...u, placedBy: u.by ? who(u.by).name : null })),
      check,
    };
  };
  for (const [id, src] of Object.entries(p.devices || {})) {
    seen.add(id);
    devices.push(deviceEntry(id, src, 'song'));
    if (src.by) A(src.by).devices++;
  }
  for (const id of used.keys()) {
    if (seen.has(id)) continue;
    const def = getDevice(id);
    if (!def || !def.by || def.by === 'overdub' || who(def.by).kind !== 'agent') continue;
    devices.push(deviceEntry(id, def, def.source === 'library' ? 'library' : 'song'));
  }
  devices.sort(
    (a, b) =>
      (a.authorKind === 'agent' ? 0 : 1) - (b.authorKind === 'agent' ? 0 : 1) ||
      String(a.name).localeCompare(String(b.name)),
  );

  /* ---- the timeline: this session's history, collapsed into runs */
  const auditions = history.filter((t) => t.audition).length;
  const runs = [];
  for (const t of history) {
    if (t.audition) continue;
    A(t.by).edits++;
    let run = runs[runs.length - 1];
    if (!run || run.by !== t.by) {
      const a = who(t.by);
      run = { by: t.by, name: a.name, kind: a.kind, from: t.at, to: t.at, count: 0, items: [] };
      runs.push(run);
    }
    run.count++;
    run.to = t.at;
    const label = t.label || 'change',
      reason = t.reason || '';
    const last = run.items[run.items.length - 1];
    if (last && last.label === label && last.reason === reason) {
      last.n++;
      last.to = t.at;
    } else run.items.push({ label, reason, n: 1, at: t.at, to: t.at, id: t.id });
  }

  /* ---- totals and shares */
  const list = [...authors.values()].filter((a) => a.notes || a.clips || a.tracks || a.effects || a.devices || a.edits);
  for (const a of list) {
    a.beats = r2(a.beats);
    a.audioBeats = r2(a.audioBeats);
    a.audioSecs = r1(a.audioSecs);
    a.notesPct = totalNotes ? r1((a.notes / totalNotes) * 100) : 0;
    a.beatsPct = totalBeats ? r1((a.beats / totalBeats) * 100) : 0;
    a.audioPct = totalAudioSecs ? r1((a.audioSecs / totalAudioSecs) * 100) : 0;
  }
  list.sort((a, b) => b.notes - a.notes || b.audioSecs - a.audioSecs || b.edits - a.edits);
  const byKind = {};
  for (const a of list) {
    const k = byKind[a.kind] || (byKind[a.kind] = { notes: 0, beats: 0, audioSecs: 0 });
    k.notes += a.notes;
    k.beats += a.beats;
    k.audioSecs += a.audioSecs;
  }
  for (const k of Object.values(byKind)) {
    k.notesPct = totalNotes ? r1((k.notes / totalNotes) * 100) : 0;
    k.beatsPct = totalBeats ? r1((k.beats / totalBeats) * 100) : 0;
    k.beats = r2(k.beats);
    k.audioSecs = r1(k.audioSecs);
  }

  return {
    format: 'overdub-provenance-report/0',
    made: new Date(now).toISOString(),
    song: {
      id: p.id,
      title: p.title || 'Untitled',
      tempo,
      meter: Array.isArray(p.meter) ? p.meter : [4, 4],
      key: p.key || null,
      created: p.meta?.created || null,
      modified: p.meta?.modified || null,
      tracks: (p.tracks || []).length,
    },
    forkedFrom: p.meta?.forkedFrom || null,
    totals: {
      notes: totalNotes,
      beats: r2(totalBeats),
      audioSecs: r1(totalAudioSecs),
      edits: runs.reduce((s, r) => s + r.count, 0),
      auditions,
    },
    authors: list,
    byKind,
    tracks,
    devices,
    timeline: {
      runs,
      truncated: history.length >= HISTORY_MAX,
      first: history[0]?.at || null,
      last: history[history.length - 1]?.at || null,
    },
  };
}

/* ================================================================ the page */
export const escHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const E = escHtml;
const MINUS = (x) => String(x).replace(/^-/, '−');
const pct = (x) => (x > 0 && x < 0.1 ? '<0.1%' : `${r1(x)}%`);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fmtBeats = (b) => `${r2(b)} ${b === 1 ? 'beat' : 'beats'}`;
const fmtSecs = (s) =>
  s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${r1(s)} s`;
function fmtDate(x, { time = true } = {}) {
  if (!x) return '';
  const d = new Date(x);
  if (Number.isNaN(+d)) return '';
  try {
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  } catch (e) {
    return d.toISOString();
  }
}
function fmtTime(x) {
  const d = new Date(x);
  if (Number.isNaN(+d)) return '';
  try {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    return d.toISOString().slice(11, 19);
  }
}
const INKS = {
  'c-1': '#e98a6c',
  'c-2': '#dcb45e',
  'c-3': '#a8c470',
  'c-4': '#95c6a8',
  'c-5': '#a2a6c6',
  'c-6': '#b69cd8',
  'c-7': '#e68ba8',
  'c-8': '#d9c8a4',
};
const ink = (c) => {
  const m = /^var\(--(c-\d)\)$/.exec(String(c || ''));
  if (m) return INKS[m[1]] || '#d9c8a4';
  return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#d9c8a4';
};
// 'overdub' signs both the demo songs and what the studio's own tools write when someone asks (Band's chords, bass and
// drums), so the house is named for both: never "the demo" in a song that started from nothing. The house is unsigned:
// its name prints in plain ink, never as a byline.
const kindWord = {
  human: 'person',
  agent: 'agent',
  house: 'Overdub’s demo songs and its own tools, like Band',
  unsigned: 'no signature',
};

// a share bar: a strip of tape, one segment per author laid end to end, warm for people, cool for agents, pencil for
// the house
function bar(parts, key, total) {
  if (!total) return '<div class="bar bar-empty"></div>';
  const seen = { human: 0, agent: 0 };
  return (
    `<div class="bar" role="img" aria-label="${E(
      parts
        .filter((p) => p[key] > 0)
        .map((p) => `${p.name} ${pct((p[key] / total) * 100)}`)
        .join(', '),
    )}">` +
    parts
      .filter((p) => p[key] > 0)
      .map((p) => {
        const shade = p.kind === 'human' || p.kind === 'agent' ? seen[p.kind]++ % 3 : 0;
        return `<i class="k-${E(p.kind)} s${shade}" style="flex:${p[key]}" title="${E(p.name)}: ${E(pct((p[key] / total) * 100))}"></i>`;
      })
      .join('') +
    '</div>'
  );
}
// a byline: the name in its ink (warm for a person, cool for an agent), at the size of the text it signs; the house
// and the unsigned print plain
const chip = (name, kind) => `<span class="by k-${E(kind)}">${E(name)}</span>`;
const head = (title, aside = '') =>
  `<header class="sh"><h2>${E(title)}</h2>${aside ? `<span class="aside">${aside}</span>` : ''}</header>`;

function checkLine(c, kind, held = false) {
  if (held)
    return '<p class="check none"><span class="lab">Kept off</span> Its code came with the song and hasn’t been allowed to run on this computer, so it wasn’t checked for this report, and nothing here played it.</p>';
  if (!c)
    return '<p class="check none">No check report for it in this report: open the song in Overdub with audio on and make the report again, or ask the agent to run its check.</p>';
  if (!c.checked)
    return `<p class="check none">Only its syntax was checked when it was built (the device check wasn’t available in that build).</p>`;
  const src =
    c.source === 'built'
      ? `Checked when it was built${c.at ? `, ${E(fmtDate(c.at))}` : ''}`
      : c.source === 'house'
        ? `The house check${c.at ? `, measured ${E(fmtDate(c.at, { time: false }))}` : ''}`
        : 'Checked again for this report (quick check)';
  const bits = [];
  bits.push(c.ok ? '<b class="pass">passes</b>' : '<b class="fail">fails</b>');
  if (c.lufs != null) bits.push(`${MINUS(r1(c.lufs))} LUFS${kind === 'instrument' ? ' on the test phrase' : ''}`);
  if (kind !== 'instrument' && c.deltaLU != null)
    bits.push(`${c.deltaLU > 0 ? '+' : ''}${MINUS(r1(c.deltaLU))} LU against the dry signal`);
  if (c.truePeak != null) bits.push(`true peak ${MINUS(r1(c.truePeak))} dBTP`);
  if (c.tail != null) bits.push(`tail ${r1(c.tail)} s`);
  if (c.cpu != null) bits.push(`CPU ${r1(c.cpu)}% of real time`);
  if (c.deterministic != null)
    bits.push(c.deterministic ? 'bit-exact on two renders' : '<b class="fail">two renders differ</b>');
  if (c.nan) bits.push('<b class="fail">made NaN</b>');
  const w = c.warnings.length
    ? `<ul class="warns">${c.warnings
        .slice(0, 4)
        .map((x) => `<li>${E(x)}</li>`)
        .join('')}${c.warnings.length > 4 ? `<li>and ${c.warnings.length - 4} more</li>` : ''}</ul>`
    : c.warningCount
      ? `<span class="muted">, ${plural(c.warningCount, 'warning')}</span>`
      : '';
  return `<p class="check"><span class="lab">Device check</span> ${src}: ${bits.join(', ')}.${w}</p>`;
}

export function provenanceHtml(m, { logo = null, wordmark = null, fonts = '', fontSrc = 'data:' } = {}) {
  const s = m.song;
  const meta = [
    `${r1(s.tempo)} bpm`,
    `${s.meter[0]}/${s.meter[1]}`,
    s.key?.root ? `${s.key.root} ${s.key.scale || ''}`.trim() : null,
    plural(s.tracks, 'track'),
  ]
    .filter(Boolean)
    .join(', ');
  const people = m.authors.filter((a) => a.kind === 'human'),
    agents = m.authors.filter((a) => a.kind === 'agent');
  const T = m.totals;

  // the lede: what was played, then by whom, then the numbers
  const lead = [];
  if (T.notes) {
    const k = m.byKind;
    const parts = [];
    if (k.human?.notes)
      parts.push(
        `${people.length > 1 ? 'people' : E(people[0]?.name === 'You' ? 'you' : people[0]?.name || 'people')} ${pct(k.human.notesPct)}`,
      );
    if (k.agent?.notes)
      parts.push(`${agents.length > 1 ? 'agents' : E(agents[0]?.name || 'agents')} ${pct(k.agent.notesPct)}`);
    if (k.house?.notes) parts.push(`Overdub ${pct(k.house.notesPct)}`);
    if (k.unsigned?.notes) parts.push(`unsigned ${pct(k.unsigned.notesPct)}`);
    lead.push(
      `${plural(T.notes, 'note')} in the song, sounding for ${fmtBeats(T.beats)} in all. By count: ${parts.join(', ')}.`,
    );
    const bl = [];
    if (k.human?.notes)
      bl.push(
        `${people.length > 1 ? 'people' : E(people[0]?.name === 'You' ? 'you' : people[0]?.name)} ${pct(k.human.beatsPct)}`,
      );
    if (k.agent?.notes) bl.push(`${agents.length > 1 ? 'agents' : E(agents[0]?.name)} ${pct(k.agent.beatsPct)}`);
    if (k.house?.notes) bl.push(`Overdub ${pct(k.house.beatsPct)}`);
    if (k.unsigned?.notes) bl.push(`unsigned ${pct(k.unsigned.beatsPct)}`);
    lead.push(`By how long they sound: ${bl.join(', ')}.`);
    if (k.house?.notes)
      lead.push(
        'Overdub’s parts are its demo songs’ or ones its own tools wrote when asked (Band’s chords, bass and drums).',
      );
  } else lead.push('No notes in the song yet.');
  if (T.audioSecs) lead.push(`${fmtSecs(T.audioSecs)} of recorded audio on the tracks.`);
  const agentDevs = m.devices.filter((d) => d.authorKind === 'agent');
  if (agentDevs.length) lead.push(`${plural(agentDevs.length, 'device')} written by an agent.`);

  // the credits: who played on it, as a sleeve lists them (the part, a dotted leader, the name)
  const credits = m.authors
    .filter((a) => a.notes || a.audioSecs || a.devices)
    .map((a) => {
      const what = [
        a.notes ? plural(a.notes, 'note') : '',
        a.audioSecs ? `${fmtSecs(a.audioSecs)} recorded` : '',
        a.devices ? plural(a.devices, 'device') : '',
      ]
        .filter(Boolean)
        .join(', ');
      return `<li><span>${what}</span><i class="lead"></i>${chip(a.name, a.kind)}</li>`;
    })
    .join('');

  const authorRows = m.authors
    .map(
      (a) => `<tr>
      <th scope="row">${chip(a.name, a.kind)}<small>${E(kindWord[a.kind] || a.kind)}</small></th>
      <td class="n">${a.notes}</td><td class="n">${pct(a.notesPct)}</td>
      <td class="n">${r2(a.beats)}</td><td class="n">${pct(a.beatsPct)}</td>
      <td class="n">${a.audioSecs ? fmtSecs(a.audioSecs) : '–'}</td>
      <td class="n">${a.clips}</td><td class="n">${a.edits}</td></tr>`,
    )
    .join('');

  const writtenBy = (w) => (w ? `, written by ${chip(w.name, w.kind)}` : '');
  const trackCards = m.tracks
    .map((t) => {
      const keptOff = (d) => (d.held ? ' <span class="muted">(kept off)</span>' : '');
      const fx = t.inserts
        .filter(Boolean)
        .map(
          (d) => `${E(d.name)}${writtenBy(d.writtenBy)}${d.on ? '' : ' <span class="muted">(off)</span>'}${keptOff(d)}`,
        )
        .join('; ');
      const inst = t.instrument
        ? `${E(t.instrument.name)}${writtenBy(t.instrument.writtenBy)}${keptOff(t.instrument)}`
        : t.kind === 'audio'
          ? 'audio track'
          : '–';
      const rows = t.shares
        .map(
          (sh) =>
            `<tr><th scope="row">${chip(sh.name, sh.kind)}</th>${t.notes ? `<td class="n">${sh.notes}</td><td class="n">${pct(sh.notesPct)}</td><td class="n">${r2(sh.beats)}</td><td class="n">${pct(sh.beatsPct)}</td>` : ''}${t.audioSecs ? `<td class="n">${sh.audioSecs ? fmtSecs(sh.audioSecs) : '–'}</td>` : ''}</tr>`,
        )
        .join('');
      const thead = `<tr><th></th>${t.notes ? '<th class="n">Notes</th><th class="n">Share</th><th class="n">Beats</th><th class="n">Share</th>' : ''}${t.audioSecs ? '<th class="n">Recorded</th>' : ''}</tr>`;
      return `<article class="track" style="--tc:${E(ink(t.color))}">
      <header><i class="sw"></i><h3>${E(t.name)}</h3><span class="muted">${inst}${t.byName && t.by !== 'overdub' ? `, arranged by ${chip(t.byName, m.authors.find((a) => a.id === t.by)?.kind || 'human')}` : ''}</span></header>
      ${t.notes || t.audioSecs ? `${t.notes ? `<div class="bars"><span>Count</span>${bar(t.shares, 'notes', t.notes)}<span>Length</span>${bar(t.shares, 'beats', t.beats)}</div>` : ''}<div class="wrap"><table class="mini">${thead}${rows}</table></div>` : '<p class="muted">Nothing on this track yet.</p>'}
      ${fx ? `<p class="fx"><span class="lab">Effects</span> ${fx}</p>` : ''}
    </article>`;
    })
    .join('');

  const devCard = (d) => `<article class="device k-${E(d.authorKind)}">
      <header><h3>${E(d.name)}</h3><code>${E(d.id)}</code>${d.version > 1 ? `<span class="muted">, version ${d.version}</span>` : ''}</header>
      <p class="by-line">${d.kind ? `${E(d.kind === 'effect' ? 'An effect' : 'An instrument')}` : 'A device'} written by ${chip(d.author, d.authorKind)}${d.origin === 'library' ? ', from the house shelf that ships with Overdub' : ' in this song'}${d.at ? `, ${E(fmtDate(d.at))}` : d.created ? `, ${E(fmtDate(d.created))}` : ''}.${d.blurb ? ` ${E(d.blurb)}.` : ''}</p>
      ${d.request ? `<blockquote><p>“${E(d.request)}”</p><cite>${d.requestBy ? `asked for by ${chip(d.requestBy, 'human')}, built by ${chip(d.author, d.authorKind)}` : `built by ${chip(d.author, d.authorKind)} from this request`}</cite></blockquote>` : '<p class="muted">The request behind it wasn’t kept with the song.</p>'}
      ${d.reason && d.reason !== d.request && d.reason !== d.blurb ? `<p><span class="lab">${E(d.author)}’s note</span> ${E(d.reason)}</p>` : ''}
      ${checkLine(d.check, d.kind, d.held)}
      <p class="used"><span class="lab">Used on</span> ${d.usedOn.length ? d.usedOn.map((u) => `${E(u.track)} (${E(u.slot)}${u.placedBy && u.placedBy !== 'Overdub' ? `, placed by ${E(u.placedBy)}` : ''})`).join(', ') : 'nothing right now'}</p>
    </article>`;
  const agentCards = agentDevs.map(devCard).join('');
  const otherDevs = m.devices.filter((d) => d.authorKind !== 'agent');
  const otherCards = otherDevs.map(devCard).join('');
  const heldDevs = m.devices.filter((d) => d.held),
    heldN = heldDevs.length;
  const heldNames = heldDevs
    .map((d) => d.name)
    .reduce((s, n, i, a) => s + (i ? (i === a.length - 1 ? ' and ' : ', ') : '') + n, '');

  // the timeline is a ledger: the time in the margin, the name where you'd sign it, what changed and why
  const runs = m.timeline.runs;
  const runRows = runs
    .slice()
    .reverse()
    .map(
      (r) => `<li class="run k-${E(r.kind)}">
      <span class="when">${E(fmtTime(r.from))}${r.to !== r.from ? `<br>${E(fmtTime(r.to))}` : ''}</span>
      <span class="who">${chip(r.name, r.kind)}<small>${plural(r.count, 'change')}</small></span>
      <ul>${r.items
        .slice()
        .reverse()
        .map(
          (it) =>
            `<li><span class="lbl">${E(it.label)}</span>${it.n > 1 ? ` <span class="x">×${it.n}</span>` : ''}${it.reason ? `<span class="why">${E(it.reason)}</span>` : ''}</li>`,
        )
        .join('')}</ul>
    </li>`,
    )
    .join('');

  const f = m.forkedFrom;
  const fork = f
    ? `<p>Forked from <b>“${E(f.title || 'Untitled')}”</b>${f.at ? ` on ${E(fmtDate(f.at))}` : ''}${f.id ? ` <code>${E(f.id)}</code>` : ''}, by way of a share link. ${(f.authors || []).length ? `Its authors were ${(f.authors || []).map((a) => `${chip(a.name, a.kind)}`).join(', ')}.` : 'The link named no authors.'} Parts that came from it keep their original signatures; the sender’s own parts are signed to them as a guest. The timeline below starts at the fork.</p>`
    : `<p>Not forked: this song didn’t arrive by a share link${s.created ? `. It was started on ${E(fmtDate(s.created))}` : ''}.</p>`;

  const lockup =
    logo || wordmark
      ? `<div class="lockup">${logo ? `<img src="${E(logo)}" alt="" width="40" height="40">` : ''}${wordmark ? `<img src="${E(wordmark)}" alt="overdub" height="22">` : '<span class="wm">overdub</span>'}</div>`
      : '<div class="lockup"><span class="wm">overdub</span></div>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src ${/^(data:|https?:\/\/[a-z0-9.:[\]-]+)$/i.test(fontSrc) ? fontSrc : 'data:'}">
<title>${E(s.title)}, provenance report</title>
<style>${String(fonts || '').replace(/<\/style/gi, '')}${REPORT_CSS}</style>
</head>
<body>
<p class="hint">To keep a copy, press <kbd>⌘P</kbd> (<kbd>Ctrl P</kbd> on Windows and Linux) and choose Save as PDF. This page lives only in this tab.</p>
<main>
  <header class="top">
    <div class="topline">${lockup}<p class="made">Provenance report<br>${E(fmtDate(m.made))}</p></div>
    <h1 class="over"><span class="over-a">${E(s.title)}</span><span class="over-b" aria-hidden="true">${E(s.title)}</span></h1>
    <p class="meta">${E(meta)}, <code>${E(s.id || '')}</code></p>
    <div class="cover">
      <p class="lede">${lead.join(' ')}</p>
      ${credits ? `<ul class="credits" aria-label="Who played on it">${credits}</ul>` : ''}
    </div>
  </header>

  <section class="about">
    ${head('What this is')}
    <div class="cols">
      <div>
        <h3>A record of who did what in this file</h3>
        <p>Overdub signs everything in a song with whoever last wrote it: every note, clip, track, effect and device carries an author, a person (warm ink) or an agent (cool ink). This report counts those signatures in the song as it is now, lists the devices agents wrote and what was asked of them, and lays out this session’s changes in order, with the reasons agents gave.</p>
      </div>
      <div>
        <h3>What it isn’t</h3>
        <p>It is not a legal opinion, and it is not proof of whose idea anything was. A signature says who wrote a thing into the file: ask an agent for a bassline and its notes are signed by the agent; move one of them yourself and that note is signed by you. Deleted notes don’t count. The timeline covers this session only (since the song was opened in this tab), though everything older still carries its signature. Anyone with the song file could edit it outside Overdub.</p>
      </div>
    </div>
  </section>

  <section>
    ${head('Who played what', T.notes ? plural(T.notes, 'note') : '')}
    ${T.notes ? `<div class="bars big"><span>By count</span>${bar(m.authors, 'notes', T.notes)}<span>By length</span>${bar(m.authors, 'beats', T.beats)}</div>` : ''}
    <div class="wrap"><table class="authors">
      <thead><tr><th></th><th class="n">Notes</th><th class="n">Share</th><th class="n">Beats</th><th class="n">Share</th><th class="n">Recorded</th><th class="n">Clips</th><th class="n">Changes</th></tr></thead>
      <tbody>${authorRows || '<tr><td colspan="8" class="muted">Nobody has signed anything yet.</td></tr>'}</tbody>
    </table></div>
    <p class="note">Notes: how many each author wrote. Beats: how long those notes sound (cut at the clip’s end, as you hear them). Recorded: the length of the audio clips each author laid down. Changes: this session’s edits.</p>
  </section>

  <section>
    ${head('Track by track', plural(m.tracks.length, 'track'))}
    <div class="tracks">${trackCards || '<p class="muted">No tracks yet.</p>'}</div>
  </section>

  <section>
    ${head('Devices an agent wrote', agentDevs.length ? plural(agentDevs.length, 'device') : '')}
    ${heldN ? `<p class="note">${heldN === 1 ? 'One device in this song is' : `${heldN} devices in this song are`} kept off on this computer: ${E(heldNames)}. The song brought ${heldN === 1 ? 'its code' : 'their code'}, and it hasn’t been allowed to run here, so this report didn’t check ${heldN === 1 ? 'it' : 'them'} and nothing here played ${heldN === 1 ? 'it' : 'them'}.</p>` : ''}
    ${agentCards ? `<p class="note">An agent writes a device as code (a kernel), from a request in plain words. Overdub runs a device check on it before it can be used: it renders test signals through it and measures what comes out, because the agent can’t listen.</p><div class="devices">${agentCards}</div>` : '<p class="muted">None: every instrument and effect in this song was built by a person or ships with Overdub.</p>'}
    ${otherCards ? `<h3 class="sub">Devices a person wrote</h3><div class="devices">${otherCards}</div>` : ''}
  </section>

  <section>
    ${head('The edit timeline', runs.length ? plural(T.edits, 'change') : '')}
    ${
      runs.length
        ? `<p class="note">${plural(T.edits, 'change')} this session, newest first${m.timeline.first ? `, from ${E(fmtDate(m.timeline.first))}` : ''}. Changes in a row by the same author are gathered into one run; repeats of the same change are counted (×). ${m.timeline.truncated ? 'Overdub keeps the last 500 changes, so the oldest have rolled off. ' : ''}${T.auditions ? `${plural(T.auditions, 'audition')} (takes heard and not kept) are left out.` : ''}</p><ol class="timeline">${runRows}</ol>`
        : '<p class="muted">No changes in this session yet. The signatures above still stand: they travel with the song.</p>'
    }
  </section>

  <section>
    ${head('Where it came from')}
    ${fork}
  </section>

  <footer>
    <p>Made by Overdub from “${E(s.title)}” on ${E(fmtDate(m.made))}. A record of who did what in this file, not a legal opinion.</p>
    <p class="muted">Names in warm ink are people; names in cool ink are agents; Overdub’s own parts print plain. The machine-readable version is the attribution log (Song menu, Attribution log).</p>
  </footer>
</main>
</body>
</html>
`;
}

// The print is a record sleeve (design/LINER-NOTES-KIT.md): ink on cream, hairline rules instead of boxes, display
// italic heads on a heavy rule, and every name a byline in the deep paper inks. No stripes, no cards, no tinted boxes.
const REPORT_CSS = `
:root { --paper: #f4ead6; --paper-2: #ece0c8; --ink: #16130f; --ink-2: #4c4336; --ink-3: #6e6352; --rule: #cbbfa8;
  --ink-human: #9a4400; --ink-agent: #085f92;
  --warm: #f07612; --warm-2: #f59a4f; --warm-3: #f9bd88; --cool: #1b95dc; --cool-2: #5cb4e8; --cool-3: #9bd0f1; --house: #b3a68c;
  --riso-warm: #ff7a1a; --riso-cool: #1d9be6;
  --display: 'Archivo', 'Arial Black', system-ui, sans-serif; --ui: 'Atkinson Hyperlegible Next', system-ui, sans-serif; --mono: 'Atkinson Hyperlegible Mono', ui-monospace, monospace;
  color-scheme: light; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
* { box-sizing: border-box; }
html { background: var(--paper); overflow-x: clip; } /* the overprint's offset and the italic's overhang may poke a pixel past the edge */
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.55 var(--ui); }
main { max-width: 920px; margin: 0 auto; padding: 40px 32px 56px; }
code { font: 12px var(--mono); color: var(--ink-2); }
h1, h2, h3 { margin: 0; }
h3 { font: 600 15px/1.3 var(--ui); }
p { margin: 0 0 10px; }
.muted { color: var(--ink-3); }
kbd { display: inline-block; font: 11px/16px var(--mono); padding: 0 4px; border: 1px solid currentColor; border-radius: 2px; }
.hint { margin: 0; padding: 10px 16px; text-align: center; background: var(--ink); color: var(--paper); font-size: 13px; }
.topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
.lockup { display: flex; align-items: center; gap: 9px; }
.lockup .wm { font: italic 800 22px var(--display); font-stretch: 125%; }
.made { margin: 0; text-align: right; font-size: 12px; line-height: 1.45; color: var(--ink-3); }
.over { position: relative; display: grid; font: italic 800 clamp(36px, 7vw, 68px)/.98 var(--display); font-stretch: 125%; letter-spacing: -.01em; margin: 4px 0 12px; padding-right: .05em; overflow-wrap: anywhere; }
.over span { grid-area: 1 / 1; }
.over-a { color: var(--riso-cool); transform: translate(.028em, .024em); }
.over-b { color: var(--riso-warm); mix-blend-mode: multiply; }
.meta { font: 13px var(--mono); color: var(--ink-2); }
.cover { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 36px; align-items: start; margin-top: 18px; }
.lede { font-size: 18px; line-height: 1.5; max-width: 62ch; margin: 0; }
/* the credits: the part, a dotted leader, the byline */
.credits { list-style: none; margin: 4px 0 0; padding: 0; font-size: 14px; }
.credits li { display: flex; align-items: baseline; gap: 6px; padding: 5px 0; }
.credits .lead { flex: 1; min-width: 16px; border-bottom: 1.5px dotted var(--ink-3); transform: translateY(-4px); }
/* bylines: the name in its ink, nothing around it; the house and the unsigned print plain */
.by { font-weight: 600; white-space: nowrap; }
.by.k-human { color: var(--ink-human); }
.by.k-agent { color: var(--ink-agent); }
.by.k-house { color: var(--ink-2); font-weight: 400; }
.by.k-unsigned { color: var(--ink-3); font-weight: 400; font-style: italic; }
/* a section opens with a display-italic head on a heavy rule */
section { margin-top: 48px; break-inside: auto; }
.sh { display: flex; align-items: baseline; gap: 12px; padding-bottom: 8px; margin-bottom: 14px; border-bottom: 2px solid var(--ink); }
.sh h2 { font: italic 800 23px/1.1 var(--display); font-stretch: 125%; letter-spacing: -.012em; }
.sh .aside { margin-left: auto; font: 12px var(--mono); color: var(--ink-3); }
h3.sub { margin: 30px 0 4px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.about h3 { margin-bottom: 6px; }
.about p { color: var(--ink-2); }
.note { font-size: 13px; color: var(--ink-2); max-width: 70ch; }
.lab { display: inline-block; margin-right: 6px; font: 600 12px var(--ui); color: var(--ink-3); }
.bars { display: grid; grid-template-columns: 64px 1fr; gap: 5px 10px; align-items: center; margin: 10px 0 12px; font-size: 11.5px; color: var(--ink-3); }
.bars.big .bar { height: 12px; }
.bar { display: flex; gap: 1px; height: 7px; background: var(--paper); }
.bar-empty { background: var(--paper-2); }
.bar i { display: block; min-width: 2px; background: var(--house); }
.bar i.k-human.s0 { background: var(--warm); } .bar i.k-human.s1 { background: var(--warm-2); } .bar i.k-human.s2 { background: var(--warm-3); }
.bar i.k-agent.s0 { background: var(--cool); } .bar i.k-agent.s1 { background: var(--cool-2); } .bar i.k-agent.s2 { background: var(--cool-3); }
.bar i.k-unsigned { background: repeating-linear-gradient(45deg, var(--house) 0 3px, transparent 3px 6px); }
.wrap { max-width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--rule); vertical-align: baseline; }
th:first-child, td:first-child { padding-left: 0; } th:last-child, td:last-child { padding-right: 0; }
thead th, .mini tr:first-child th { font: 400 11.5px var(--ui); color: var(--ink-3); border-bottom-color: var(--ink-3); }
th small { display: block; margin-top: 1px; font: 11.5px var(--ui); color: var(--ink-3); }
.n { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; }
.authors th[scope=row] { font-weight: 400; }
.authors { margin-top: 6px; }
/* tracks: two columns of credits, a hairline over each, the track colour's square swatch the one mark of colour */
.tracks { display: grid; grid-template-columns: 1fr 1fr; gap: 26px 32px; }
.track { padding-top: 12px; border-top: 1px solid var(--ink); break-inside: avoid; }
.track header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin-bottom: 4px; }
.track header .sw { width: 8px; height: 8px; background: var(--tc, var(--house)); align-self: center; box-shadow: inset 0 0 0 1px rgba(22,19,15,.25); }
.track header h3 { font: italic 800 17px/1.2 var(--display); font-stretch: 112%; }
.track header .muted { font-size: 13.5px; }
.track .mini { font-size: 12.5px; }
.track .mini th, .track .mini td { padding: 4px 6px; }
.track .mini th:first-child, .track .mini td:first-child { padding-left: 0; }
.fx { margin: 8px 0 2px; font-size: 12.5px; color: var(--ink-2); }
/* devices: one entry per device under a hairline; the request is set as a quotation */
.devices { display: grid; }
.device { padding: 18px 0 8px; border-top: 1px solid var(--rule); break-inside: avoid; }
.device:first-child { border-top-color: var(--ink); }
.device header { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; margin-bottom: 6px; }
.device header h3 { font: italic 800 22px/1.15 var(--display); font-stretch: 112%; }
.by-line { font-size: 14px; }
blockquote { margin: 12px 0 14px; padding: 0; max-width: 60ch; }
blockquote p { margin: 0; font: italic 700 19px/1.35 var(--display); font-stretch: 100%; color: var(--ink); }
cite { display: block; margin-top: 6px; font: 13px var(--ui); font-style: normal; color: var(--ink-3); }
.check { font-size: 13px; color: var(--ink-2); }
.check.none { color: var(--ink-3); }
.pass { color: #1f6b35; } .fail { color: #a3201a; }
.warns { margin: 4px 0 0; padding-left: 18px; font-size: 12.5px; }
.used { font-size: 13px; color: var(--ink-2); }
/* the timeline: a ledger of signed runs */
.timeline { list-style: none; margin: 10px 0 0; padding: 0; border-top: 1px solid var(--ink-3); }
.run { display: grid; grid-template-columns: 76px 110px minmax(0, 1fr); gap: 0 14px; padding: 9px 0; border-bottom: 1px solid var(--rule); break-inside: avoid; font-size: 13.5px; }
.run .when { font: 12px/1.55 var(--mono); color: var(--ink-3); }
.run .who small { display: block; font: 11.5px var(--mono); color: var(--ink-3); }
.run ul { margin: 0; padding: 0; list-style: none; }
.run li li { padding: 0 0 4px; }
.lbl { font-size: 13.5px; }
.x { font: 600 11.5px var(--mono); color: var(--ink-3); }
.why { display: block; margin: 1px 0 2px; color: var(--ink-2); font-size: 12.5px; font-style: italic; }
footer { margin-top: 52px; padding-top: 14px; border-top: 1px solid var(--rule); font-size: 13px; }
@media (max-width: 720px) {
  main { padding: 28px 16px 40px; } .cols, .tracks, .cover { grid-template-columns: 1fr; } .cover { gap: 18px; }
  .authors th:nth-child(n+7), .authors td:nth-child(n+7) { display: none; } th, td { padding: 6px 5px; }
  .run { grid-template-columns: 64px minmax(0, 1fr); } .run ul { grid-column: 2; margin-top: 4px; } .run .who small { display: inline; margin-left: 6px; }
  .sh h2 { font-size: 20px; }
}
@media print {
  .hint { display: none; }
  @page { margin: 14mm 14mm 16mm; }
  body { font-size: 12.5px; background: var(--paper); }
  main { max-width: none; padding: 0; }
  section { margin-top: 28px; break-inside: auto; }
  .over { font-size: 46px; }
  .lede { font-size: 15px; }
  .track, .device, .run { break-inside: avoid; }
  .sh, .bars, .note { break-after: avoid; }
}
`;

/* ================================================================ in the page */
async function svgDataUrl(path) {
  try {
    const r = await fetch(new URL(path, document.baseURI));
    if (!r.ok) return null;
    const t = await r.text();
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t);
  } catch (e) {
    return null;
  }
}

// The report's type: the brand's three families, from style/fonts.css (the studio's own copies), never another host.
// In its tab the report is a blob made here, so it is on the studio's origin and under the studio's policy as well as
// its own (font-src 'self'): it takes the same files by URL, already in the browser's cache. Saved as a file (when the
// tab was blocked) it opens on its own later, so each file goes inside it as a data: URL. -> { css, src } (src: the
// report's font-src); { css: '' } (the system faces) if fonts.css can't be read. Made once a session, per way.
const REPORT_FAMILIES = /font-family:\s*'(Archivo|Atkinson Hyperlegible Next|Atkinson Hyperlegible Mono)'/;
const reportFonts = {};
function reportFontCss(inline = false) {
  const way = inline ? 'inline' : 'url';
  if (!reportFonts[way]) {
    reportFonts[way] = (async () => {
      const sheet = new URL('../../style/fonts.css', import.meta.url);
      const r = await fetch(sheet);
      if (!r.ok) throw new Error('fonts.css: ' + r.status);
      const rules = [...(await r.text()).matchAll(/@font-face\s*\{[^}]*\}/g)]
        .map((x) => x[0])
        .filter((x) => REPORT_FAMILIES.test(x));
      const fileOf = (rule) =>
        new URL(String(/url\(([^)]+)\)/.exec(rule)?.[1] || '').replace(/^['"]|['"]$/g, ''), sheet);
      if (!inline)
        return {
          css: rules.map((rule) => rule.replace(/url\([^)]+\)/, `url(${fileOf(rule).href})`)).join('\n'),
          src: sheet.origin,
        };
      const data = async (rule) => {
        const f = await fetch(fileOf(rule));
        if (!f.ok) throw new Error('font: ' + f.status);
        const blob = new Blob([await f.arrayBuffer()], { type: 'font/woff2' });
        return rule.replace(
          /url\([^)]+\)/,
          `url(${await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result));
            fr.onerror = () => rej(fr.error);
            fr.readAsDataURL(blob);
          })})`,
        );
      };
      return { css: (await Promise.all(rules.map(data))).join('\n'), src: 'data:' };
    })().catch(() => {
      delete reportFonts[way];
      return { css: '', src: 'data:' };
    });
  }
  return reportFonts[way];
}

// Check reports for the report: the agent's own (this session), the house shelf's (when the kernel still matches),
// or a quick check run now. Each rerun is bounded, so a stuck one never holds the report up.
async function gatherChecks(app, model) {
  const out = {};
  const ses = app.provenance?.session || {};
  let REPORTS = null,
    MEASURED = null;
  try {
    const m = await import('../devices/library/reports.js');
    REPORTS = m.REPORTS;
    MEASURED = m.MEASURED;
  } catch (e) {
    /* none */
  }
  let checkDevice = null;
  for (const d of model.devices) {
    // a held device's code is never run for the report (it isn't registered either: nothing here could check it)
    if (d.held || app.devices?.heldDevice?.(d.id)) continue;
    if (ses[d.id]?.check) {
      out[d.id] = normCheck(ses[d.id].check, 'built', ses[d.id].at);
      continue;
    }
    const def = app.devices?.getDevice?.(d.id);
    const house = REPORTS?.[d.id];
    if (house && def && (!house.hash || house.hash === def.hash)) {
      out[d.id] = normCheck(house, 'house', house.measured || MEASURED);
      continue;
    }
    if (!def || !def.kernel) continue;
    if (!checkDevice) {
      try {
        checkDevice = (await import('../kernel/check.js')).checkDevice;
      } catch (e) {
        break;
      }
    }
    try {
      const rep = await Promise.race([
        checkDevice({ ...def }, { quick: true }),
        new Promise((res) => setTimeout(() => res(null), 12000)),
      ]);
      if (rep) out[d.id] = normCheck(rep, 'rerun', Date.now());
    } catch (e) {
      /* leave it unchecked: the page says so */
    }
  }
  return out;
}

function modelFor(app, checks = {}) {
  const { store } = app;
  return provenanceModel(store.get(), {
    history: store.history,
    author: (id) => store.author(id),
    getDevice: (id) => app.devices?.getDevice?.(id) || null,
    held: (id) => app.devices?.heldDevice?.(id) || null,
    checks,
    session: app.provenance?.session || {},
  });
}

export async function openProvenanceReport(app) {
  // open the tab now, inside the click, so the popup blocker lets it through; fill it in when the report is ready
  let w = null;
  try {
    w = window.open('', '_blank');
  } catch (e) {
    w = null;
  }
  try {
    if (w) {
      w.document.title = 'Provenance report';
      w.document.body.style.cssText = 'margin:0;padding:32px;background:#f4ead6;color:#16130f;font:15px system-ui';
      w.document.body.textContent = 'Writing the provenance report…';
    }
  } catch (e) {
    /* cross-origin or closed */
  }
  const pre = modelFor(app);
  const checks = await gatherChecks(app, pre);
  const model = modelFor(app, checks);
  const [logo, wordmark] = await Promise.all([svgDataUrl('assets/logo.svg'), svgDataUrl('assets/wordmark-ink.svg')]);
  // the page as the tab shows it (fonts by URL, from the site) or as a file keeps it (fonts inside it)
  const page = async (inline) => {
    const fonts = await reportFontCss(inline);
    const url = URL.createObjectURL(
      new Blob([provenanceHtml(model, { logo, wordmark, fonts: fonts.css, fontSrc: fonts.src })], {
        type: 'text/html',
      }),
    );
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
    return url;
  };
  const title =
    String(model.song.title || 'Untitled')
      .replace(/[\\/:*?"<>|]+/g, '')
      .trim()
      .slice(0, 80) || 'Untitled';
  if (w && !w.closed) {
    const url = await page(false);
    w.location.href = url;
    app.ui?.toast?.(
      `The provenance report is open in a new tab: ${plural(model.totals.notes, 'note')}, ${plural(model.authors.length, 'author')}. ⌘P saves it as a PDF.`,
      { kind: 'ok' },
    );
    return { ok: true, url, model };
  }
  // the tab was blocked: hand over the page as a file instead
  const url = await page(true);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title} provenance.html`;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  app.ui?.toast?.(
    `The browser blocked the new tab, so the report was saved as “${title} provenance.html”. Open it, then ⌘P to save a PDF.`,
    { kind: 'ok', ms: 8000 },
  );
  return { ok: true, url, downloaded: true, model };
}

const TOOL = {
  ...PROVENANCE_SCHEMA, // name, description, input_schema (agent/extra-schemas.js: Node lists it with no tab open)
  run(input = {}, ctx = {}) {
    const app = ctx.app || globalThis.window?.overdub;
    const m = modelFor(app);
    // names, requests and reasons can come from someone else's file: trimmed, and each request says where it came from
    const N = (x) => capText(x, 80),
      T = (x) => capText(x, 300);
    const short = (a) => ({
      id: a.id,
      name: N(a.name),
      kind: a.kind,
      notes: a.notes,
      notes_pct: a.notesPct,
      beats: a.beats,
      beats_pct: a.beatsPct,
      recorded_s: a.audioSecs,
      clips: a.clips,
      edits: a.edits,
    });
    return {
      song: N(m.song.title),
      made: m.made,
      totals: m.totals,
      authors: m.authors.map(short),
      tracks: m.tracks.map((t) => ({
        name: N(t.name),
        notes: t.notes,
        beats: t.beats,
        recorded_s: t.audioSecs,
        shares: t.shares.map((s) => ({
          name: N(s.name),
          kind: s.kind,
          notes: s.notes,
          notes_pct: s.notesPct,
          beats_pct: s.beatsPct,
          recorded_s: s.audioSecs,
        })),
      })),
      devices_by_agents: m.devices
        .filter((d) => d.authorKind === 'agent')
        .map((d) => ({
          id: d.id,
          name: N(d.name),
          by: N(d.author),
          origin: d.origin,
          ...(d.held ? { held: true } : {}),
          request: T(d.request),
          request_from: d.request ? (d.requestBy ? 'this_session' : 'from_file') : undefined,
          reason: T(d.reason),
          used_on: d.usedOn.map((u) => N(u.track)),
          check: d.check
            ? { source: d.check.source, ok: d.check.ok, lufs: d.check.lufs, truePeak: d.check.truePeak }
            : null,
        })),
      // the song's devices kept off here: never checked or played for the report
      ...(m.devices.some((d) => d.held)
        ? {
            held: m.devices
              .filter((d) => d.held)
              .map((d) => ({ id: d.id, name: N(d.name), kind: d.kind, by: N(d.author) })),
            held_note:
              "These devices came with the song and are kept off on this computer: their code hasn't been allowed to run here, so they weren't checked. Only the person can let them play.",
          }
        : {}),
      ...(input.timeline === false
        ? {}
        : {
            timeline: m.timeline.runs.map((r) => ({
              by: N(r.name),
              kind: r.kind,
              changes: r.count,
              from: new Date(r.from).toISOString(),
              items: r.items.map((i) => ({ label: N(i.label), n: i.n, reason: T(i.reason) || undefined })),
            })),
          }),
      forked_from: m.forkedFrom ? { title: N(m.forkedFrom.title), at: m.forkedFrom.at } : null,
      note: "A record of who did what in this file (signatures on notes, clips, tracks, devices; this session's history), not a legal opinion. The human can open it as a printable page: Song menu → Provenance report.",
    };
  },
};

export function installProvenance(app) {
  if (app.provenance) return app.provenance;
  const session = {}; // device id -> { check, at, by, request, requestBy }
  let lastAsk = null; // the latest thing the person asked the in-app agent
  app.provenance = {
    session,
    model: () => modelFor(app),
    html: () => provenanceHtml(modelFor(app)),
    open: () => openProvenanceReport(app),
    TOOL,
  };
  const hookAgent = () => {
    try {
      app.agent?.on?.('user', (e) => {
        if (e && e.text) lastAsk = { text: String(e.text).slice(0, 600), at: Date.now() };
      });
    } catch (e) {
      /* no in-app agent */
    }
  };
  app.ui?.on?.('agent:tool', (e) => {
    if (!e || e.phase !== 'end' || e.name !== 'define_device' || !e.result || !e.result.ok || !e.result.id) return;
    const fromChat = e.by === 'claude' && lastAsk && Date.now() - lastAsk.at < 30 * 60 * 1000;
    session[e.result.id] = {
      check: e.result.check || null,
      at: Date.now(),
      by: e.by,
      request: fromChat ? lastAsk.text : null,
      requestBy: fromChat ? app.store.author('you')?.name || 'You' : null,
    };
  });
  if (app.agent) hookAgent();
  else app.ui?.on?.('ready', hookAgent);
  // the agent tool (tools.js is the agent layer's; load it lazily so this module stays importable anywhere)
  import('../agent/tools.js')
    .then((m) => m.installTools(app).register(TOOL))
    .catch((e) => console.warn('provenance_report tool', e.message));
  return app.provenance;
}
