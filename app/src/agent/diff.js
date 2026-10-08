// Compact, readable diffs between two versions of a song: what an agent gets back from apply_ops, what a variation
// card says it changes, and what the History tab shows. Pure (Node and the browser).
//
//   diffProjects(before, after, { getDevice, ids, words }) -> ['Bass: +16 notes in "Walk" (A1–E3)', 'Keys › Verb: mix 0.25 → 0.4', ...]
//                            words (the default with ids: false, a card's lines, which the person reads to decide): a
//                            param by its label in its unit ("Keys: + Snapper, threshold -80 dB"), not its key and value
//   opsSummary(ops, project, { getDevice }?) -> '+16 notes · Bass'      (one short line for chips and history rows, in
//                            words: device names, "tempo 120", "new section Chorus"; agents read it too, so it stays short)
//   targetsOf(ops, project, created?, inverse?) -> { tracks: [ids], clips: [ids] }   (what to highlight; an
//                            arrangement op names what it moved only through its txn's inverse, so pass that too)
//   laneLine(op, project, { getDevice }) -> 'wrote Keyhole cutoff on Keys, bars 9–12: 600 Hz → 4.5 kHz'   (an auto.* op
//                            in words; docs/research/AUTOMATION.md 3.10)
//   lanesIn(project) -> [{ track, name, insert, device, param, lane }]   (every automation lane, with its address)

import { noteName, beatsPerBar } from '../core/music.js';
import { ARRANGEMENT_OPS, spanLabel, whereLabel } from '../core/arrangement.js';
import { lanesOf, parsePoints } from '../core/automation.js';

const r = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);
const fmt = (v) => (typeof v === 'number' ? String(r(v)) : JSON.stringify(v));

function range(notes) {
  if (!notes.length) return '';
  let lo = 127,
    hi = 0;
  for (const n of notes) {
    lo = Math.min(lo, n.p);
    hi = Math.max(hi, n.p);
  }
  return lo === hi ? noteName(lo) : `${noteName(lo)}–${noteName(hi)}`;
}

// def: the device (getDevice), so a param left at its default reads as its value: "thump 4 (default) → 1 dB".
// words: the param by its label, each value in its unit ("threshold -62 dB → -80 dB"), the way a card says it to the
// person (agents get the keys, which is what they write back).
function paramDiff(a = {}, b = {}, def = null, { words = false } = {}) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    const p = def?.params?.find((q) => q.key === k);
    if (words) {
      const w = (x) => paramValue(p, x === undefined || x === null ? p?.def : x);
      out.push(`${paramWord(p, k)} ${w(a[k])} → ${w(b[k])}`);
      continue;
    }
    const v = (x) =>
      x === undefined || x === null ? (p && p.def !== undefined ? `${fmt(p.def)} (default)` : 'default') : fmt(x);
    const unit = p?.unit && p.unit !== '%' ? ' ' + p.unit : p?.unit === '%' ? '%' : '';
    out.push(`${k} ${v(a[k])} → ${v(b[k])}${unit}`);
  }
  return out;
}
// A param as the person reads it: its label ("THRESHOLD" on the panel reads "threshold"), else its key.
const capsWord = (s) => (/^[A-Z0-9 .,/&+()#'-]+$/.test(s) ? s.toLowerCase() : s);
export function paramWord(p, key = '') {
  return p?.label ? capsWord(String(p.label)) : key || p?.key || '';
}
// A param's value in its unit ("-80 dB", "2.4 kHz", a switch's own word); a number the device doesn't describe as it is.
export function paramValue(p, v) {
  if (v === undefined || v === null) return 'its default';
  if (typeof v !== 'number') return fmt(v);
  if (p?.opts && p.opts[Math.round(v)] != null) return capsWord(String(p.opts[Math.round(v)]));
  return p?.unit === 'x' ? String(r(v)) : laneValue(v, p?.unit || '', null); // (a ratio or a Q reads as its number)
}

// ids: false leaves new tracks', clips' and inserts' ids out (a variation card's diff is made on a scratch copy, whose
// new ids never exist in the song). words (on with ids: false): params by label and unit, devices by name, times in bars.
export function diffProjects(A, B, { getDevice = () => null, max = 24, ids = true, words = !ids } = {}) {
  const idp = (id) => (ids ? `${id} ` : '');
  const out = [];
  const dn = (id) => getDevice(id)?.name || id;
  const pd0 = (a, b, def) => paramDiff(a, b, def, { words });
  const bpb = beatsPerBar(B.meter || [4, 4]);
  const bar = (beat) => Math.floor((+beat || 0) / bpb + 1e-9) + 1;
  const span = (from, to) => {
    const x = bar(from),
      y = Math.max(x, Math.ceil((+to || 0) / bpb - 1e-9));
    return y > x ? `bars ${x}–${y}` : `bar ${x}`;
  };
  for (const k of ['title', 'tempo']) if (A[k] !== B[k]) out.push(`${k} ${fmt(A[k])} → ${fmt(B[k])}`);
  if (JSON.stringify(A.key) !== JSON.stringify(B.key))
    out.push(
      `key ${A.key ? A.key.root + ' ' + A.key.scale : 'none'} → ${B.key ? B.key.root + ' ' + B.key.scale : 'none'}`,
    );
  if (JSON.stringify(A.meter) !== JSON.stringify(B.meter))
    out.push(`meter ${A.meter.join('/')} → ${B.meter.join('/')}`);
  if (JSON.stringify(A.loop) !== JSON.stringify(B.loop))
    out.push(
      `loop ${B.loop.on ? (words ? `on, ${span(B.loop.start, B.loop.end)}` : `on, beats ${B.loop.start}–${B.loop.end}`) : 'off'}`,
    );
  const ta = new Map(A.tracks.map((t) => [t.id, t])),
    tb = new Map(B.tracks.map((t) => [t.id, t]));
  for (const t of B.tracks)
    if (!ta.has(t.id)) {
      const notes = t.clips.reduce((s, c) => s + (c.notes?.length || 0), 0);
      out.push(
        `new track ${idp(t.id)}"${t.name}"${t.instrument ? ` (${dn(t.instrument.device)})` : ''}${t.clips.length ? `, ${t.clips.length} clip${t.clips.length > 1 ? 's' : ''}, ${notes} notes` : ''}${t.inserts.length ? `, inserts ${t.inserts.map((x) => dn(x.device)).join(' → ')}` : ''}`,
      );
    }
  for (const t of A.tracks) if (!tb.has(t.id)) out.push(`removed track "${t.name}"`);
  // a track's own controls, in words: "level 0 → -3 dB", "muted"
  const flagWord = { mute: ['muted', 'unmuted'], solo: ['soloed', 'unsoloed'] };
  const trackLine = (k, x, y) =>
    !words
      ? `${k} ${fmt(x)} → ${fmt(y)}${k === 'gain' ? ' dB' : ''}`
      : flagWord[k]
        ? flagWord[k][y ? 0 : 1]
        : k === 'gain'
          ? `level ${fmt(x ?? 0)} → ${fmt(y ?? 0)} dB`
          : k === 'name'
            ? `renamed from "${x}"`
            : k === 'color'
              ? 'new colour'
              : `${k} ${fmt(x)} → ${fmt(y)}`;
  for (const b of B.tracks) {
    const a = ta.get(b.id);
    if (!a) continue;
    const name = b.name;
    for (const k of ['name', 'gain', 'pan', 'mute', 'solo', 'color'])
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${name}: ${trackLine(k, a[k], b[k])}`);
    if (a.instrument && b.instrument) {
      if (a.instrument.device !== b.instrument.device)
        out.push(`${name}: instrument ${dn(a.instrument.device)} → ${dn(b.instrument.device)}`);
      else {
        const pd = pd0(a.instrument.params, b.instrument.params, getDevice(b.instrument.device));
        if (pd.length) out.push(`${name} › ${dn(b.instrument.device)}: ${pd.join(', ')}`);
      }
    }
    const ia = new Map(a.inserts.map((x) => [x.id, x]));
    const ib = new Map(b.inserts.map((x) => [x.id, x]));
    for (const fx of b.inserts) {
      const old = ia.get(fx.id);
      if (!old) {
        // (in words, a new effect says what it's set to, not what it moved from)
        const def = getDevice(fx.device),
          keys = Object.keys(fx.params || {});
        const set = words
          ? keys.map((k) => {
              const p = def?.params?.find((q) => q.key === k);
              return `${paramWord(p, k)} ${paramValue(p, fx.params[k])}`;
            })
          : keys.length
            ? [paramDiff({}, fx.params, def).join(', ')]
            : [];
        out.push(
          words
            ? `${name}: + ${dn(fx.device)}${set.length ? `, ${set.join(', ')}` : ''}${fx.on === false ? ' (bypassed)' : ''}`
            : `${name}: + ${dn(fx.device)} insert${ids ? ` (${fx.id})` : ''}${set.length ? ' ' + set[0] : ''}`,
        );
        continue;
      }
      const pd = pd0(old.params, fx.params, getDevice(fx.device));
      if (old.on !== fx.on) pd.unshift(fx.on ? 'on' : 'bypassed');
      if (pd.length) out.push(`${name} › ${dn(fx.device)}: ${pd.join(', ')}`);
    }
    for (const fx of a.inserts) if (!ib.has(fx.id)) out.push(`${name}: removed ${dn(fx.device)}`);
    if (
      a.inserts
        .map((x) => x.id)
        .filter((id) => ib.has(id))
        .join() !==
      b.inserts
        .map((x) => x.id)
        .filter((id) => ia.has(id))
        .join()
    )
      out.push(`${name}: inserts reordered`);
    const ca = new Map(a.clips.map((c) => [c.id, c]));
    const cb = new Map(b.clips.map((c) => [c.id, c]));
    for (const c of b.clips) {
      const old = ca.get(c.id);
      const cn = c.name ? `"${c.name}"` : words ? 'a clip' : c.id;
      if (!old) {
        out.push(
          `${name}: new clip${ids ? ' ' + c.id : ''}${c.name ? ` "${c.name}"` : ''} ${words ? span(c.start, c.start + c.length) : `beats ${r(c.start)}–${r(c.start + c.length)}`}${c.notes ? `, ${c.notes.length} notes ${range(c.notes)}` : ''}`,
        );
        continue;
      }
      const moved = [];
      for (const k of ['start', 'length', 'name', 'offset', 'gain']) {
        if (JSON.stringify(old[k]) === JSON.stringify(c[k])) continue;
        moved.push(
          !words
            ? `${k} ${fmt(old[k])} → ${fmt(c[k])}`
            : k === 'start'
              ? `moved to bar ${bar(c.start)}`
              : k === 'length'
                ? `now ${span(c.start, c.start + c.length)}`
                : k === 'name'
                  ? `renamed from "${old.name || ''}"`
                  : k === 'gain'
                    ? `level ${fmt(old.gain ?? 0)} → ${fmt(c.gain ?? 0)} dB`
                    : `${k} ${fmt(old[k])} → ${fmt(c[k])}`,
        );
      }
      if (!!old.mute !== !!c.mute && words) moved.push(c.mute ? 'muted' : 'unmuted');
      if (moved.length) out.push(`${name} ${cn}: ${moved.join(', ')}`);
      if (c.notes && old.notes) {
        const na = new Map(old.notes.map((n) => [n.id, n]));
        const nb = new Map(c.notes.map((n) => [n.id, n]));
        const added = c.notes.filter((n) => !na.has(n.id));
        const removed = old.notes.filter((n) => !nb.has(n.id));
        const changed = c.notes.filter((n) => {
          const o = na.get(n.id);
          return o && (o.p !== n.p || o.t !== n.t || o.d !== n.d || o.v !== n.v);
        });
        const bits = [];
        if (added.length) bits.push(`+${added.length} note${added.length > 1 ? 's' : ''} (${range(added)})`);
        if (removed.length) bits.push(`−${removed.length} note${removed.length > 1 ? 's' : ''}`);
        if (changed.length) {
          const kinds = new Set();
          for (const n of changed) {
            const o = na.get(n.id);
            if (o.p !== n.p) kinds.add('pitch');
            if (o.t !== n.t) kinds.add('timing');
            if (o.d !== n.d) kinds.add('length');
            if (o.v !== n.v) kinds.add('velocity');
          }
          bits.push(`${changed.length} note${changed.length > 1 ? 's' : ''} changed (${[...kinds].join(', ')})`);
        }
        if (bits.length) out.push(`${name} ${cn}: ${bits.join(', ')}`);
      }
    }
    for (const c of a.clips)
      if (!cb.has(c.id))
        out.push(
          `${name}: removed clip ${c.name ? `"${c.name}"` : words ? `in ${span(c.start, c.start + c.length)}` : c.id}`,
        );
  }
  if (
    A.tracks
      .filter((t) => tb.has(t.id))
      .map((t) => t.id)
      .join() !==
    B.tracks
      .filter((t) => ta.has(t.id))
      .map((t) => t.id)
      .join()
  )
    out.push('tracks reordered');
  out.push(...laneDiff(A, B, getDevice));
  const ma = new Map(A.master.inserts.map((x) => [x.id, x]));
  for (const fx of B.master.inserts) {
    const old = ma.get(fx.id);
    if (!old) out.push(`master: + ${dn(fx.device)}`);
    else {
      const pd = pd0(old.params, fx.params, getDevice(fx.device));
      if (old.on !== fx.on) pd.unshift(fx.on ? 'on' : 'bypassed');
      if (pd.length) out.push(`master › ${dn(fx.device)}: ${pd.join(', ')}`);
    }
  }
  for (const fx of A.master.inserts)
    if (words && !B.master.inserts.some((x) => x.id === fx.id)) out.push(`master: removed ${dn(fx.device)}`);
  if (A.master.gain !== B.master.gain)
    out.push(`master ${words ? 'level' : 'gain'} ${fmt(A.master.gain)} → ${fmt(B.master.gain)} dB`);
  const secA = JSON.stringify(A.sections),
    secB = JSON.stringify(B.sections);
  if (secA !== secB)
    out.push(
      `sections: ${B.sections.map((s) => (words ? `${s.name} (${span(s.start, s.start + s.length)})` : `${s.name} [${s.start}–${s.start + s.length}]`)).join(', ') || 'none'}`,
    );
  for (const [id, d] of Object.entries(B.devices || {})) {
    const o = A.devices?.[id];
    if (!o)
      out.push(
        words
          ? `new device "${d.name || id}" (an ${d.kind === 'effect' ? 'effect' : 'instrument'})`
          : `new device ${id} "${d.name}" (${d.kind})`,
      );
    else if (o.version !== d.version)
      out.push(words ? `${d.name || id}: version ${d.version}` : `device ${id} → v${d.version}`);
  }
  for (const id of Object.keys(A.devices || {}))
    if (!B.devices?.[id]) out.push(words ? `removed device "${A.devices[id]?.name || id}"` : `removed device ${id}`);
  if (out.length > max) return [...out.slice(0, max), `… and ${out.length - max} more changes`];
  return out;
}

// One short line for an op list: "+16 notes · Bass", "+Scribble Strip · Bass", "tempo 120, new section Chorus". In words
// (FRESH-EYES-6 agent builder #9: "+core.shaper", "project.set, section.add ×2"): devices by name, a song's settings by
// what they are, a repeat of a clip made in the same call counted in its copies ("4 new clips, +128 notes", as the diff
// says). The Agent tab's chips, History's rows and what agents get back (apply_ops, get_history) all read it.
export function opsSummary(ops = [], project = null, { getDevice = null } = {}) {
  const name = (id) => {
    if (!project || !id) return id || '';
    if (id === 'master') return 'Master';
    const t = project.tracks.find((x) => x.id === id || x.name === id);
    return t ? t.name : String(id).startsWith('$') ? 'new track' : id;
  };
  const dn = (id) => (id && getDevice?.(id)?.name) || id || '';
  // an insert the op names, on its track (or the master), in the song it was summed against
  const fxOf = (track, insert) => {
    const t = track === 'master' ? project?.master : project?.tracks?.find((x) => x.id === track || x.name === track);
    return (t?.inserts || []).find((x) => x.id === insert) || null;
  };
  const instOf = (track) =>
    project?.tracks?.find((x) => x.id === track || x.name === track)?.instrument?.device || null;
  const parts = new Map();
  const add = (k, n = 1) => {
    if (k) parts.set(k, (parts.get(k) || 0) + n);
  };
  const tracks = new Set();
  const made = new Map(); // a clip made in this call, by its ref -> its notes (a repeat of it counts its copies)
  for (const o of ops) {
    if (!o || typeof o !== 'object') continue;
    if (typeof o.track === 'string' && o.track !== 'master' && !o.track.startsWith('$')) tracks.add(name(o.track));
    if (o.track === 'master') tracks.add('Master');
    switch (o.type) {
      case 'notes.add':
      case 'notes.replace': {
        const n =
          typeof o.notes === 'string'
            ? o.notes
                .trim()
                .split(/[\s,;]+/)
                .filter((x) => x && !x.startsWith('#')).length
            : Array.isArray(o.notes)
              ? o.notes.length
              : Array.isArray(o._restore)
                ? o._restore.length
                : o.grid
                  ? Object.values(o.grid.rows || {})
                      .join('')
                      .replace(/[.\s|]/g, '').length
                  : 0;
        add(o.type === 'notes.add' ? '+notes' : 'rewrote notes', n);
        break;
      }
      case 'notes.set':
        add('edited notes', o.notes?.length || 0);
        break;
      case 'notes.remove':
        add('−notes', o.ids?.length || 0);
        break;
      case 'notes.restore':
        add('+notes', o.notes?.length || 0);
        break;
      case 'clip.add': {
        const n = countNotes(o.clip);
        add('new clip');
        if (n) add('+notes', n);
        if (o.ref) made.set(o.ref, n);
        break;
      }
      case 'clip.remove':
        add('removed a clip');
        break;
      case 'clip.move':
        add('moved a clip');
        break;
      case 'clip.set':
        add(clipSetWords(o.patch));
        break;
      case 'track.add': {
        add('new track');
        if (o.track?.name) tracks.add(o.track.name);
        for (const c of Array.isArray(o.track?.clips) ? o.track.clips : []) {
          add('new clip');
          const n = countNotes(c);
          if (n) add('+notes', n);
        }
        break;
      }
      case 'track.remove':
        add('removed the track');
        break;
      case 'track.move':
        add('moved the track');
        break;
      case 'track.set':
        add(trackSetWords(o.patch));
        break;
      case 'insert.add':
        add('+' + (dn(o.insert?.device) || 'an effect'));
        break;
      case 'insert.remove':
        add('−' + (dn(fxOf(o.track, o.insert)?.device) || 'an effect'));
        break;
      case 'insert.move':
        add(`moved ${dn(fxOf(o.track, o.insert)?.device) || 'an effect'}`);
        break;
      case 'insert.set': {
        const fx = fxOf(o.track, o.insert),
          def = fx && getDevice?.(fx.device);
        const keys = Object.keys(o.patch?.params || {});
        const what =
          keys.length === 1
            ? paramWord(
                def?.params?.find((q) => q.key === keys[0]),
                keys[0],
              )
            : keys.length
              ? `${keys.length} settings`
              : '';
        let on = o.patch && 'on' in o.patch ? (o.patch.on ? 'on' : 'bypassed') : '';
        if (o.patch && 'key' in o.patch) {
          const kt =
            o.patch.key &&
            (project?.tracks || []).find((t) => t.id === o.patch.key.track || t.name === o.patch.key.track);
          on = (on ? on + ', ' : '') + (o.patch.key ? `keyed by ${kt ? kt.name : o.patch.key.track}` : 'key off');
        }
        add(`${dn(fx?.device) || 'an effect'}${what ? ` ${what}` : ''}${on ? `${what ? ',' : ''} ${on}` : ''}`);
        break;
      }
      case 'instrument.set': {
        if (o.device) {
          add(`instrument → ${dn(o.device)}`);
          break;
        }
        const keys = Object.keys(o.params || {}),
          def = getDevice?.(instOf(o.track));
        add(
          `${dn(instOf(o.track)) || 'instrument'} ${
            keys.length === 1
              ? paramWord(
                  def?.params?.find((q) => q.key === keys[0]),
                  keys[0],
                )
              : 'settings'
          }`,
        );
        break;
      }
      case 'project.set':
        for (const w of projectSetWords(o.patch, project)) add(w);
        break;
      case 'master.set':
        add(
          o.patch && 'gain' in o.patch
            ? `master level ${fmt(o.patch.gain)} dB`
            : o.patch && o.patch.clip
              ? `master ceiling ${o.patch.clip === 'clean' ? 'clean' : 'soft'}`
              : 'master',
        );
        break;
      case 'section.add':
        add(`new section ${o.section?.name || ''}`.trim());
        break;
      case 'section.set': {
        const keys = Object.keys(o.patch || {}),
          s = sectionName(project, o.section);
        add(
          keys.includes('name')
            ? `renamed ${s === 'a section' ? 'a section' : s} to ${o.patch.name}`
            : `${keys.some((k) => k === 'start') ? 'moved' : keys.some((k) => k === 'length') ? 'resized' : 'changed'} ${s === 'a section' ? 'a section' : `section ${s}`}`,
        );
        break;
      }
      case 'section.remove':
        add(
          `removed ${sectionName(project, o.section) === 'a section' ? 'a section' : `section ${sectionName(project, o.section)}`}`,
        );
        break;
      case 'device.define':
        add('device ' + (o.device?.name || o.device?.id || ''));
        break;
      case 'device.remove':
        add(`removed device ${project?.devices?.[o.id]?.name || o.id || ''}`.trim());
        break;
      case 'asset.add':
        add('a recording');
        break;
      case 'asset.remove':
        add('removed a recording');
        break;
      case 'reference.set':
        add(o.reference ? 'a reference track' : 'removed the reference track');
        break;
      // arrangement ops (core/arrangement.js) say what they did, not their type
      case 'time.insert':
        add(`inserted ${spanLabel(project || {}, +o.length || 0)} at ${whereLabel(project || {}, +o.at || 0)}`);
        break;
      case 'time.remove':
        add(`deleted ${spanLabel(project || {}, +o.length || 0)} from ${whereLabel(project || {}, +o.at || 0)}`);
        break;
      case 'section.duplicate':
        add(`copied ${sectionName(project, o.section)}`);
        break;
      case 'clip.repeat': {
        // a clip made in this call, repeated: its copies are new clips with its notes, counted with it
        const times = Number(o.times ?? 2) || 2,
          ref = typeof o.clip === 'string' && o.clip.startsWith('$') ? o.clip.slice(1) : null;
        if (ref && made.has(ref)) {
          if (o.mode !== 'loop') add('new clip', times - 1);
          if (made.get(ref)) add('+notes', made.get(ref) * (times - 1));
          break;
        }
        add(`${o.mode === 'loop' ? 'looped' : 'repeated'} ${clipName(project, o.clip)} ×${times}`);
        break;
      }
      case 'clip.split':
        add(`split ${clipName(project, o.clip)} at ${whereLabel(project || {}, +o.at || 0)}`);
        break;
      // automation, in words: "wrote Keyhole cutoff, bars 9–12: 600 Hz → 4.5 kHz", "held level"
      case 'auto.write':
      case 'auto.clear':
      case 'auto.set':
        add(laneLine(o, project, { getDevice, where: false }));
        break;
      default:
        add(String(o.type || 'a change').replace(/[._]/g, ' '));
    }
  }
  const notes = (n) => `${n} note${n === 1 ? '' : 's'}`;
  const bits = [...parts].map(([k, n]) =>
    k === '+notes'
      ? `+${notes(n)}`
      : k === '−notes'
        ? `−${notes(n)}`
        : k === 'edited notes'
          ? `${notes(n)} edited`
          : k === 'rewrote notes'
            ? `rewrote ${notes(n)}`
            : k === 'new clip' && n > 1
              ? `${n} new clips`
              : n > 1
                ? `${k} ×${n}`
                : k,
  );
  const where = [...tracks].filter(Boolean).slice(0, 3).join(', ');
  return bits.slice(0, 3).join(', ') + (where ? ` · ${where}` : '');
}
// a clip's notes, however they were given (notes text, a list, a drum grid)
function countNotes(c = {}) {
  if (!c || typeof c !== 'object') return 0;
  return typeof c.notes === 'string'
    ? c.notes
        .trim()
        .split(/[\s,;]+/)
        .filter(Boolean).length
    : Array.isArray(c.notes)
      ? c.notes.length
      : c.grid
        ? Object.values(c.grid.rows || {})
            .join('')
            .replace(/[.\s|]/g, '').length
        : 0;
}
// a track's controls, as a mixer reads them: "level -3 dB", "muted", "renamed"
function trackSetWords(patch = {}) {
  const w = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'gain') w.push(`level ${fmt(v)} dB`);
    else if (k === 'pan') w.push(`pan ${laneValue(+v, 'pan')}`);
    else if (k === 'mute') w.push(v ? 'muted' : 'unmuted');
    else if (k === 'solo') w.push(v ? 'soloed' : 'unsoloed');
    else if (k === 'arm') w.push(v ? 'armed' : 'disarmed');
    else if (k === 'name') w.push('renamed');
    else if (k === 'color') w.push('new colour');
    else if (k === 'input') w.push('its input');
    else w.push(k);
  }
  return w.join(' and ');
}
// a clip's settings: "muted a clip", "moved a clip", "renamed a clip"
function clipSetWords(patch = {}) {
  const k = Object.keys(patch || {});
  if (k.includes('mute')) return patch.mute ? 'muted a clip' : 'unmuted a clip';
  if (k.includes('start')) return 'moved a clip';
  if (k.includes('length')) return 'resized a clip';
  if (k.includes('name')) return 'renamed a clip';
  if (k.includes('take')) return patch.take ? 'a clip into a take' : 'a clip out of its take';
  if (k.includes('tuning') || k.includes('capo')) return `a clip's ${k.includes('tuning') ? 'tuning' : 'capo'}`;
  return k.length ? `a clip's ${k.join(' and ')}` : 'a clip';
}
// the song's settings: "tempo 120", "key A minor", "meter 6/8", "loop bars 1–8", "title “Night Shift”"
function projectSetWords(patch = {}, project = null) {
  const out = [];
  const bpb = beatsPerBar(patch?.meter || project?.meter || [4, 4]);
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'tempo') out.push(`tempo ${fmt(v)}`);
    else if (k === 'key')
      out.push(
        v && v.root
          ? `key ${v.root} ${String(v.scale || '')
              .replace(/([a-z])([A-Z])/g, '$1 $2')
              .toLowerCase()}`.trim()
          : 'no key',
      );
    else if (k === 'meter') out.push(Array.isArray(v) ? `meter ${v.join('/')}` : 'meter');
    else if (k === 'loop') {
      if (v && v.on === false) out.push('loop off');
      else if (v && Number.isFinite(+v.start) && Number.isFinite(+v.end) && +v.end > +v.start) {
        const a = Math.floor(+v.start / bpb + 1e-9) + 1,
          z = Math.max(a, Math.ceil(+v.end / bpb - 1e-9));
        out.push(`loop ${z > a ? `bars ${a}–${z}` : `bar ${a}`}`);
      } else out.push('loop on');
    } else if (k === 'title') out.push(`title “${String(v ?? '').slice(0, 40)}”`);
    else out.push(k);
  }
  return out;
}

const sectionName = (p, ref) => {
  const id = typeof ref === 'object' && ref ? ref.id : ref;
  const s =
    p?.sections?.find((x) => x.id === id) ||
    p?.sections?.find((x) => x.name.toLowerCase() === String(id).toLowerCase());
  return s ? s.name : 'a section';
};
const clipName = (p, id) => {
  for (const t of p?.tracks || []) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c.name || 'a clip';
  }
  return 'a clip';
};
export const isArrangementOp = (o) => !!o && typeof o.type === 'string' && Object.hasOwn(ARRANGEMENT_OPS, o.type);

// Tracks and clips an op list touches (ids resolved where possible), for highlights. An arrangement op (time.insert,
// clip.split, …) plans its change from the song when it's applied, so the op alone doesn't say what moved: pass the
// transaction's inverse and its primitives (clip.set, clip.remove, …) name every clip it moved, cut or made.
export function targetsOf(ops = [], project = null, created = {}, inverse = null) {
  const tracks = new Set(),
    clips = new Set();
  const res = (v) => (typeof v === 'string' && v.startsWith('$') ? created?.[v.slice(1)] : v);
  const all = inverse && ops.some(isArrangementOp) ? [...ops, ...inverse] : ops;
  for (const o of all) {
    let t = res(o.track);
    if (typeof t === 'string' && project && t !== 'master') {
      const tr = project.tracks.find((x) => x.id === t || x.name === t);
      if (tr) t = tr.id;
    }
    if (t && typeof t === 'string') tracks.add(t);
    const c = res(o.clip);
    if (c && typeof c === 'string') clips.add(c);
  }
  for (const v of Object.values(created || {}))
    for (const x of Array.isArray(v) ? v : [v])
      if (typeof x === 'string') {
        if (x.startsWith('t_')) tracks.add(x);
        if (x.startsWith('c_')) clips.add(x);
      }
  return { tracks: [...tracks], clips: [...clips] };
}

/* ------------------------------------------------------------------------------------------------ lanes */
// Every automation lane (core/automation.js lanesOf) with its track's name and the device it moves ('mixer' for gain
// and pan). -> [{ track, name, insert, device, param, lane, key }]
export function lanesIn(p) {
  if (!p) return [];
  const tname = (id) => (id === 'master' ? 'Master' : p.tracks.find((t) => t.id === id)?.name || id);
  return lanesOf(p).map((l) => ({ ...l, name: tname(l.track), device: l.device || 'mixer' }));
}
// An op's points as a list (the text form read by core's parsePoints; [] when it can't be read: this only describes).
export function pointsOf(points) {
  try {
    return parsePoints(points).filter((x) => x && Number.isFinite(+x.t) && Number.isFinite(+x.v));
  } catch (e) {
    return [];
  }
}

// The param a lane moves, in words ("Keyhole cutoff", "level", "pan"), with its unit.
export function laneParam(device, param, getDevice) {
  if (device === 'mixer')
    return { name: param === 'gain' ? 'level' : param, unit: param === 'gain' ? 'dB' : param === 'pan' ? 'pan' : '' };
  const def = getDevice?.(device);
  const p = def?.params?.find((q) => q.key === param);
  const label = p?.label && !/^[A-Z0-9 ]+$/.test(p.label) ? p.label.toLowerCase() : param; // a CUTOFF-style label reads as its key
  return { name: `${def?.name || device} ${label}`, unit: p?.unit || '', opts: p?.opts };
}
export function laneValue(v, unit, opts) {
  if (!Number.isFinite(v)) return String(v);
  if (opts && opts[Math.round(v)] != null) return String(opts[Math.round(v)]);
  if (unit === 'Hz') return v >= 1000 ? `${Math.round(v / 100) / 10} kHz` : `${Math.round(v)} Hz`;
  if (unit === 'dB') return `${Math.round(v * 10) / 10} dB`;
  if (unit === 'pan')
    return Math.abs(v) < 0.005 ? 'centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`;
  if (unit === '%') return `${Math.round(v * 10) / 10}%`;
  return `${r(v)}${unit ? ' ' + unit : ''}`;
}
function barsOf(p, from, to) {
  const b = beatsPerBar(p?.meter || [4, 4]),
    a = Math.floor(from / b) + 1,
    z = Math.max(a, Math.ceil(to / b));
  return z > a ? `bars ${a}–${z}` : `bar ${a}`;
}
// The device an op's lane is on: the mixer, the instrument, an insert on the track (or the master), or one made in the
// same call.
function opDevice(op, p) {
  if (op.insert == null) return 'mixer';
  const t = op.track === 'master' ? p?.master : p?.tracks?.find((x) => x.id === op.track || x.name === op.track);
  if (op.insert === 'instrument') return t?.instrument?.device || 'instrument';
  const fx = (t?.inserts || []).find((x) => x.id === op.insert);
  return fx ? fx.device : String(op.insert).startsWith('$') ? 'the new insert' : op.insert;
}
// One auto.* op in words. where: false leaves "on <track>" out (opsSummary names the tracks itself).
export function laneLine(op, project, { getDevice = null, where = true } = {}) {
  const t =
    op.track === 'master'
      ? 'Master'
      : project?.tracks?.find((x) => x.id === op.track || x.name === op.track)?.name ||
        (String(op.track || '').startsWith('$') ? 'a new track' : op.track);
  const { name, unit, opts } = laneParam(opDevice(op, project), op.param, getDevice);
  const on = where ? ` on ${t}` : '';
  const v = (x) => laneValue(x, unit, opts);
  if (op.type === 'auto.set') return op.patch?.off ? `held ${name}${on}` : `gave ${name}${on} back to its lane`;
  if (op.type === 'auto.clear')
    return op.from == null && op.to == null
      ? `removed the ${name} lane${on}`
      : `cleared ${name}${on}, ${barsOf(project, +op.from || 0, +(op.to ?? op.from) || 0)}`;
  const pts = pointsOf(op.points).sort((a, b) => a.t - b.t);
  if (!pts.length) return `wrote ${name}${on}`;
  const from = op.from ?? pts[0].t,
    to = op.to ?? pts[pts.length - 1].t;
  const vs = pts.map((x) => x.v),
    a = vs[0],
    z = vs[vs.length - 1],
    far = vs.reduce((m, x) => (Math.abs(x - a) > Math.abs(m - a) ? x : m), a);
  const shape = a !== z ? `${v(a)} → ${v(z)}` : far !== a ? `${v(a)} → ${v(far)} and back` : v(a);
  return `wrote ${name}${on}, ${barsOf(project, from, Math.max(from, to))}: ${shape}`;
}

// Lanes that appeared, went, were held or rewritten between two versions, where what they move is in both (a removed
// insert already says "removed Keyhole"; its lanes went with it).
function laneDiff(A, B, getDevice) {
  const out = [];
  const la = new Map(lanesIn(A).map((l) => [l.key, l])),
    lb = new Map(lanesIn(B).map((l) => [l.key, l]));
  const owner = (p, l) => {
    const t = l.track === 'master' ? p.master : p.tracks.find((x) => x.id === l.track);
    if (!t) return null;
    if (l.insert === 'instrument') return t.instrument ? t.instrument.device : null;
    return l.insert ? (t.inserts || []).find((x) => x.id === l.insert)?.device || null : 'mixer';
  };
  const both = (l) => {
    const a = owner(A, l);
    return !!a && a === owner(B, l);
  };
  const span = (pts) => (pts.length ? [Math.min(...pts.map((x) => x.t)), Math.max(...pts.map((x) => x.t))] : null);
  const print = (x) => JSON.stringify([x.t, x.v, x.c ?? null]);
  for (const [k, l] of lb) {
    if (!both(l)) continue;
    const old = la.get(k);
    const { name, unit, opts } = laneParam(l.device, l.param, getDevice);
    const who = `${l.name} › ${name}`,
      v = (x) => laneValue(x, unit, opts),
      pts = l.lane.points;
    if (!old) {
      const s = span(pts);
      out.push(
        `${who}: new lane${s ? `, ${barsOf(B, s[0], s[1])}, ${pts.length} point${pts.length === 1 ? '' : 's'}, ${v(pts[0].v)} → ${v(pts[pts.length - 1].v)}` : ''}${l.lane.off ? ' (held)' : ''}`,
      );
      continue;
    }
    if (!!old.lane.off !== !!l.lane.off)
      out.push(`${who}: ${l.lane.off ? "lane held (the knob's own value plays)" : 'back to its lane'}`);
    const sa = new Set(old.lane.points.map(print)),
      sb = new Set(pts.map(print));
    const s = span([...old.lane.points.filter((x) => !sb.has(print(x))), ...pts.filter((x) => !sa.has(print(x)))]);
    if (s) {
      const inB = pts.filter((x) => x.t >= s[0] && x.t <= s[1]);
      out.push(
        `${who}: lane rewritten, ${barsOf(B, s[0], s[1])}${inB.length ? ` (${v(inB[0].v)} → ${v(inB[inB.length - 1].v)}, ${inB.length} point${inB.length === 1 ? '' : 's'})` : ' (cleared)'}`,
      );
    }
  }
  for (const [k, l] of la)
    if (!lb.has(k) && both(l)) out.push(`${l.name} › ${laneParam(l.device, l.param, getDevice).name}: lane removed`);
  return out;
}
