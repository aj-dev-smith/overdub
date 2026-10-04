// DAWproject: the way out to other DAWs. DAWproject (github.com/bitwig/dawproject, v1.0) is an open exchange format: a
// zip holding project.xml (the song: transport, tracks and their mixer channels, the arrangement), metadata.xml (title,
// comment) and the media it uses. Bitwig Studio, Studio One, Cubase and others read it.
//
// What travels: the tempo and time signature; every track with its name, colour, volume, pan, mute and solo; note clips
// with their notes (in beats); audio clips, with their recordings embedded as WAV files under audio/; the sections as
// arrangement markers; the master channel. What can't travel is the sound of Overdub's own devices: there is no
// standard way to carry a kernel or a pedal to another host, so each instrument and effect is written as a placeholder
// device (BuiltinDevice, loaded="false") with its name, its Overdub id, its parameter values and a comment saying so.
// Put an instrument of your own on each track in the other DAW; the notes are all there.
//
// Automation lanes go out as <Points> on the track's arrangement lane, each with a <Target> naming the Volume, Pan or
// placeholder parameter it moves, in that parameter's unit (Volume linear, Pan normalized, ms as seconds). DAWproject
// knows only straight and held segments, so any segment that isn't straight in the exported unit (a bent one, a fader
// move, a log knob) is sampled every 1/16 beat. A held lane is left out (its knob's value is what plays) with a
// warning, and so is a lane on a param its device doesn't have.
//
// Pure (no DOM): the caller fetches the recordings and zips the files (ui/export.js has the zip writer).
//
//   dawprojectXml(project, { getDevice, audio, app }) -> { project: xml, metadata: xml, media: [{ asset, path }], warnings }
//   dawprojectFiles(project, { getDevice, audio, app }) -> { files: [{ name, data }], warnings, counts }
//     audio: { [assetId]: Uint8Array (a WAV) }: recordings that aren't given are left out (their clips with them),
//            and each one left out is a warning.

import { lanesOf, laneKey, paramSpec, MIXER, valueAt, toPos } from './automation.js';

export const DAWPROJECT_VERSION = '1.0';

// the eight track inks (docs/BRAND.md), so `var(--c-3)` leaves as a colour another program can read
const INKS = { 'c-1': '#e98a6c', 'c-2': '#dcb45e', 'c-3': '#a8c470', 'c-4': '#95c6a8', 'c-5': '#a2a6c6', 'c-6': '#b69cd8', 'c-7': '#e68ba8', 'c-8': '#d9c8a4' };
export function inkOf(color) {
  const s = String(color || '').trim();
  const v = /^var\(--(c-\d)\)$/.exec(s);
  if (v) return INKS[v[1]] || null;
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('').toLowerCase();
  return null;
}

export const xmlEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // characters XML 1.0 can't hold at all
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const num = (x, k = 6) => { const v = Number(x); if (!Number.isFinite(v)) return '0'; const r = Math.round(v * 10 ** k) / 10 ** k; return String(Object.is(r, -0) ? 0 : r); };
const dbToLin = (db) => Math.pow(10, (Number(db) || 0) / 20);
const fileSafe = (s) => String(s || 'audio').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'audio';
const UNITS = { Hz: 'hertz', dB: 'decibel', st: 'semitones', '%': 'percent', s: 'seconds' };

function attrs(o) {
  let s = '';
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') s += ` ${k}="${xmlEscape(v)}"`;
  return s;
}

function authorNames(p) {
  const named = p.meta?.authors || {};
  const nameOf = (id) => named[id]?.name || (id === 'you' ? 'You' : id === 'claude' ? 'Claude' : String(id || '').replace(/^mcp:/, ''));
  return { nameOf };
}

export function dawprojectXml(p, { getDevice = () => null, audio = {}, app = {} } = {}) {
  let seq = 0;
  const id = () => 'id' + seq++;
  const warnings = [];
  const media = [];
  const { nameOf } = authorNames(p);
  const tempo = Number(p.tempo) || 120;
  const [num_, den] = Array.isArray(p.meter) ? p.meter : [4, 4];

  // a device as a placeholder: its name, its Overdub id, its knob values, and a comment that says what it is
  // laneKey -> { id, unit, conv, spec }: the parameter elements a lane's <Points> can target
  const targets = new Map();
  function device(ref, role, { on = true, by, key = null } = {}) {
    if (!ref || !ref.device) return '';
    const def = getDevice(ref.device) || null;
    const name = def?.name || p.devices?.[ref.device]?.name || ref.device;
    const specs = (def?.params || p.devices?.[ref.device]?.params || []).map((q) => (Array.isArray(q) ? { key: q[0], label: q[1], min: q[2], max: q[3], def: q[4] } : q));
    const vals = { ...Object.fromEntries(specs.map((q) => [q.key, q.def])), ...(ref.params || {}) };
    const params = [];
    for (const q of specs) {
      let v = vals[q.key];
      if (!Number.isFinite(Number(v))) continue;
      v = Number(v);
      const opts = Array.isArray(q.opts) ? q.opts : null;
      let unit = opts ? 'linear' : UNITS[q.unit] || 'linear', min = q.min, max = q.max;
      if (q.unit === 'ms') { unit = 'seconds'; v /= 1000; min = Number.isFinite(min) ? min / 1000 : min; max = Number.isFinite(max) ? max / 1000 : max; }
      if (opts) { min = 0; max = Math.max(0, opts.length - 1); }
      const pid = id();
      if (key) targets.set(`${key}/${q.key}`, { id: pid, unit, conv: q.unit === 'ms' ? (x) => x / 1000 : (x) => x, spec: paramSpec(q) });
      params.push(`<RealParameter${attrs({ id: pid, name: (q.label || q.key) + (opts && opts[v] != null ? ` (${opts[v]})` : ''), parameterID: q.key, unit, min: Number.isFinite(Number(min)) ? num(min) : undefined, max: Number.isFinite(Number(max)) ? num(max) : undefined, value: num(v) })}/>`);
    }
    const who = by && by !== 'overdub' ? ` Placed by ${nameOf(by)}.` : '';
    const writer = p.devices?.[ref.device]?.by || (def && (def.source === 'library' || def.source === 'project') ? def.by : null);
    const madeBy = writer && writer !== 'overdub' ? ` Written by ${nameOf(writer)}.` : '';
    const comment = `An Overdub device (${ref.device}): its sound stays in Overdub, so this is a placeholder with its settings.${madeBy}${who}`;
    return `<BuiltinDevice${attrs({ id: id(), name, comment, deviceID: `overdub:${ref.device}`, deviceName: name, deviceRole: role, deviceVendor: 'Overdub', loaded: 'false' })}>`
      + (params.length ? `<Parameters>${params.join('')}</Parameters>` : '<Parameters/>')
      + `<Enabled${attrs({ id: id(), name: 'On/Off', value: on ? 'true' : 'false' })}/>`
      + '</BuiltinDevice>';
  }
  function channel(t, { role = 'regular', dest, chId, gain = 0, pan = 0, mute = false, solo = false, devices = '', key = null, maxDb = gain }) {
    const vol = dbToLin(gain);
    const muteEl = `<Mute${attrs({ id: id(), name: 'Mute', value: mute ? 'true' : 'false' })}/>`;
    const panId = id();
    const panEl = `<Pan${attrs({ id: panId, name: 'Pan', unit: 'normalized', min: '0.0', max: '1.0', value: num((Math.max(-1, Math.min(1, Number(pan) || 0)) + 1) / 2) })}/>`;
    const volId = id();
    if (key) {
      targets.set(`${key}/gain`, { id: volId, unit: 'linear', conv: dbToLin, spec: MIXER.gain });
      if (role !== 'master') targets.set(`${key}/pan`, { id: panId, unit: 'normalized', conv: (x) => (Math.max(-1, Math.min(1, x)) + 1) / 2, spec: MIXER.pan });
    }
    return `<Channel${attrs({ id: chId, audioChannels: 2, destination: dest, role, solo: solo ? 'true' : 'false' })}>`
      + (devices ? `<Devices>${devices}</Devices>` : '')
      + muteEl + panEl
      + `<Volume${attrs({ id: volId, name: 'Volume', unit: 'linear', min: '0.0', max: num(Math.max(2, vol, dbToLin(maxDb))), value: num(vol) })}/>`
      + '</Channel>';
  }

  /* ---- structure: the tracks, then the master */
  const masterTrackId = id(), masterChId = id();
  const trackIds = new Map();
  const structure = [];
  for (const t of p.tracks || []) {
    const tid = id(), cid = id();
    trackIds.set(t.id, tid);
    const kinds = new Set((t.clips || []).map((c) => (c.kind === 'audio' ? 'audio' : 'notes')));
    if (!kinds.size) kinds.add(t.kind === 'audio' ? 'audio' : 'notes');
    const devs = (t.instrument ? device(t.instrument, 'instrument', { by: t.by, key: `${t.id}/instrument` }) : '') + (t.inserts || []).map((fx) => device(fx, 'audioFX', { on: fx.on !== false, by: fx.by, key: `${t.id}/${fx.id}` })).join('');
    structure.push(`<Track${attrs({ id: tid, name: t.name || 'Track', color: inkOf(t.color), contentType: [...kinds].join(' '), loaded: 'true', comment: t.by && t.by !== 'overdub' ? `In Overdub: ${t.kind} track, last arranged by ${nameOf(t.by)}.` : undefined })}>`
      + channel(t, { chId: cid, dest: masterChId, gain: t.gain, pan: t.pan, mute: t.mute, solo: t.solo, devices: devs, key: t.id, maxDb: laneMax(t.auto?.gain, t.gain) })
      + '</Track>');
  }
  const masterDevs = (p.master?.inserts || []).map((fx) => device(fx, 'audioFX', { on: fx.on !== false, by: fx.by, key: `master/${fx.id}` })).join('');
  structure.push(`<Track${attrs({ id: masterTrackId, name: 'Master', contentType: 'audio notes', loaded: 'true' })}>`
    + channel(null, { chId: masterChId, role: 'master', gain: p.master?.gain || 0, devices: masterDevs, key: 'master', maxDb: laneMax(p.master?.auto?.gain, p.master?.gain || 0) })
    + '</Track>');

  /* ---- automation: each lane as <Points> targeting its parameter */
  const allLanes = lanesOf(p);
  let laneCount = 0;
  function pointsFor(trackId, trackName) {
    let out = '';
    for (const l of allLanes) {
      if (l.track !== trackId) continue;
      const what = `“${trackName}”: the ${l.insert == null ? (l.param === 'gain' ? 'level' : l.param) : l.param} lane`;
      const tg = targets.get(laneKey(l));
      if (!tg) { warnings.push(`${what} moves a param its device doesn’t have here, so it was left out`); continue; }
      if (l.lane.off) { warnings.push(`${what} is held (its knob’s value plays), so it was left out`); continue; }
      out += `<Points${attrs({ id: id(), unit: tg.unit })}><Target${attrs({ parameter: tg.id })}/>${realPoints(l.lane.points, tg).join('')}</Points>`;
      laneCount++;
    }
    return out;
  }
  // straight in the exported unit: a linear knob (ms as seconds is still linear) or pan; the fader and log knobs aren't
  const straightIn = (tg) => tg.spec && tg.spec.curve !== 'fader' && !(tg.spec.curve === 'log' && tg.spec.min > 0 && tg.spec.max > tg.spec.min);
  function realPoints(pts, tg) {
    const out = [];
    const step = tg.spec && (tg.spec.step > 0 || tg.spec.opts);
    const rp = (t, v, interp) => out.push(`<RealPoint${attrs({ time: num(t), value: num(tg.conv(v)), interpolation: interp })}/>`);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const held = step || a.c === 'step';
      rp(a.t, a.v, held ? 'hold' : 'linear');
      if (!b || held || !(b.t > a.t)) continue;
      if (!a.c && (straightIn(tg) || toPos(tg.spec, a.v) === toPos(tg.spec, b.v))) continue;
      const n = Math.min(512, Math.max(1, Math.ceil((b.t - a.t) * 16)));
      for (let k = 1; k < n; k++) { const t = a.t + ((b.t - a.t) * k) / n; rp(t, valueAt(pts, t, tg.spec), 'linear'); }
    }
    return out;
  }

  /* ---- the arrangement: one lane per track, in beats */
  const lanes = [];
  const assetPaths = new Map();
  const secPerBeat = 60 / tempo;
  for (const t of p.tracks || []) {
    const clips = [];
    for (const c of [...(t.clips || [])].sort((a, b) => a.start - b.start)) {
      const length = Math.max(0, Number(c.length) || 0);
      const head = { time: num(c.start), duration: num(length), playStart: '0.0', name: c.name, color: inkOf(c.color), enable: c.mute ? 'false' : undefined };   // (a muted clip: DAWproject's disabled clip)
      if (c.kind === 'audio') {
        const a = p.assets?.[c.asset];
        if (!audio[c.asset]) { warnings.push(`“${t.name}”: the recording ${a?.name ? `“${a.name}” ` : ''}isn’t in this browser, so its clip at beat ${num(c.start, 2)} was left out`); continue; }
        let path = assetPaths.get(c.asset);
        if (!path) {
          path = `audio/${fileSafe(a?.name || c.asset)} (${c.asset}).wav`;
          assetPaths.set(c.asset, path);
          media.push({ asset: c.asset, path });
        }
        const offset = Math.max(0, Number(c.offset) || 0);
        const secs = length * secPerBeat;
        const wav = wavInfo(audio[c.asset]);
        const sr = wav?.sr || a?.sr || 48000, chans = wav?.channels || a?.channels || 2, dur = wav?.duration ?? a?.duration ?? (offset + secs);
        const gainNote = Number(c.gain) ? `Clip gain in Overdub: ${num(c.gain, 1)} dB.` : undefined;
        clips.push(`<Clip${attrs({ ...head, fadeTimeUnit: 'beats', fadeInTime: '0.0', fadeOutTime: '0.0', comment: gainNote })}>`
          + `<Clips${attrs({ id: id() })}>`
          + `<Clip${attrs({ time: '0.0', duration: num(length), contentTimeUnit: 'beats', playStart: '0.0', fadeTimeUnit: 'beats', fadeInTime: '0.0', fadeOutTime: '0.0' })}>`
          + `<Warps${attrs({ id: id(), contentTimeUnit: 'seconds', timeUnit: 'beats' })}>`
          + `<Audio${attrs({ id: id(), name: a?.name, algorithm: 'stretch', channels: chans, duration: num(dur), sampleRate: sr })}><File${attrs({ path })}/></Audio>`
          + `<Warp${attrs({ time: '0.0', contentTime: num(offset) })}/><Warp${attrs({ time: num(length), contentTime: num(offset + secs) })}/>`
          + '</Warps></Clip></Clips></Clip>');
      } else {
        const notes = [];
        for (const n of [...(c.notes || [])].sort((a, b) => a.t - b.t || a.p - b.p)) {
          if (!(n.t < length) || !(n.d > 0) || n.t < 0) continue;      // what Overdub doesn't play doesn't leave
          const d = Math.min(n.d, length - n.t);
          const v = Math.max(0, Math.min(1, n.v ?? 0.8));
          notes.push(`<Note${attrs({ time: num(n.t), duration: num(d), channel: 0, key: Math.max(0, Math.min(127, Math.round(n.p))), vel: num(v), rel: num(v) })}/>`);
        }
        clips.push(`<Clip${attrs(head)}><Notes${attrs({ id: id() })}>${notes.join('')}</Notes></Clip>`);
      }
    }
    lanes.push(`<Lanes${attrs({ id: id(), track: trackIds.get(t.id) })}>${clips.length ? `<Clips${attrs({ id: id() })}>${clips.join('')}</Clips>` : `<Clips${attrs({ id: id() })}/>`}${pointsFor(t.id, t.name)}</Lanes>`);
  }
  lanes.push(`<Lanes${attrs({ id: id(), track: masterTrackId })}><Clips${attrs({ id: id() })}/>${pointsFor('master', 'Master')}</Lanes>`);
  const secs = (p.sections || []).filter((s) => Number.isFinite(Number(s.start)));
  const markers = secs.length ? `<Markers${attrs({ id: id() })}>${secs.map((s) => `<Marker${attrs({ time: num(s.start), name: s.name, color: inkOf(s.color) })}/>`).join('')}</Markers>` : '';

  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<Project version="${DAWPROJECT_VERSION}">`
    + `<Application${attrs({ name: app.name || 'Overdub', version: app.version || '0.1.0' })}/>`
    + '<Transport>'
    + `<Tempo${attrs({ id: id(), name: 'Tempo', unit: 'bpm', min: '20.0', max: '666.0', value: num(tempo) })}/>`
    + `<TimeSignature${attrs({ id: id(), numerator: (num_ | 0) || 4, denominator: (den | 0) || 4 })}/>`
    + '</Transport>'
    + `<Structure>${structure.join('')}</Structure>`
    + `<Arrangement${attrs({ id: id() })}><Lanes${attrs({ id: id(), timeUnit: 'beats' })}>${lanes.join('')}</Lanes>${markers}</Arrangement>`
    + '<Scenes/>'
    + '</Project>';
  const project = indentXml(xml) + '\n';

  /* ---- metadata: the title, and a plain comment (key, who played, where it came from) */
  const keyText = p.key?.root ? `${p.key.root} ${p.key.scale || ''}`.trim() : null;
  const counts = {};
  let total = 0;
  for (const t of p.tracks || []) for (const c of t.clips || []) for (const n of c.notes || []) { counts[n.by] = (counts[n.by] || 0) + 1; total++; }
  const share = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([by, n]) => `${nameOf(by)} ${Math.round((n / total) * 100)}%`).join(', ');
  const comment = [
    'Made in Overdub Studio (overdubstudio.com).',
    keyText ? `Key: ${keyText}.` : null,
    total ? `Notes by author: ${share}.` : null,
    p.meta?.forkedFrom?.title ? `Forked from “${p.meta.forkedFrom.title}”.` : null,
    'The instruments and effects are Overdub devices and come across as placeholders: the notes, clips, recordings and mix settings are all here.',
  ].filter(Boolean).join(' ');
  const metadata = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + `<MetaData><Title>${xmlEscape(p.title || 'Untitled')}</Title><Comment>${xmlEscape(comment)}</Comment></MetaData>\n`;

  return { project, metadata, media, warnings, lanes: laneCount };
}

// the loudest a gain lane goes (so the Volume's max covers it)
function laneMax(lane, db) {
  let m = Number(db) || 0;
  for (const x of lane?.points || []) if (x.v > m) m = x.v;
  return m;
}

// One element per line, two spaces per level. project.xml holds no text content (everything is an attribute, and
// attribute values are escaped, so '><' only ever sits between two tags).
function indentXml(xml) {
  const parts = xml.split('><');
  let depth = 0;
  return parts.map((part, i) => {
    const tag = (i ? '<' : '') + part + (i < parts.length - 1 ? '>' : '');
    if (/^<\//.test(tag)) depth--;
    const line = '  '.repeat(Math.max(0, depth)) + tag;
    if (/^<[^?/!]/.test(tag) && !/\/>$/.test(tag) && !/<\/[^>]+>$/.test(tag)) depth++;
    return line;
  }).join('\n');
}

// sample rate, channels and length of a PCM WAV (from its fmt and data chunks), or null
export function wavInfo(bytes) {
  if (!bytes || bytes.length < 44) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12, sr = 0, channels = 0, block = 0, dataLen = 0;
  while (o + 8 <= bytes.length) {
    const id = tag(o), len = dv.getUint32(o + 4, true);
    if (id === 'fmt ') { channels = dv.getUint16(o + 10, true); sr = dv.getUint32(o + 12, true); block = dv.getUint16(o + 20, true); }
    if (id === 'data') { dataLen = len; break; }
    o += 8 + len + (len & 1);
  }
  if (!sr || !block) return null;
  return { sr, channels, duration: dataLen / block / sr };
}

export function dawprojectFiles(p, opts = {}) {
  const x = dawprojectXml(p, opts);
  const files = [{ name: 'project.xml', data: x.project }, { name: 'metadata.xml', data: x.metadata }];
  for (const m of x.media) files.push({ name: m.path, data: opts.audio[m.asset] });
  let notes = 0, clips = 0;
  for (const t of p.tracks || []) for (const c of t.clips || []) { clips++; notes += (c.notes || []).length; }
  return { files, warnings: x.warnings, counts: { tracks: (p.tracks || []).length, clips, notes, audio: x.media.length, lanes: x.lanes } };
}
