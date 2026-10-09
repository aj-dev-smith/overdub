// Bringing outside material in: Standard MIDI Files and audio files, dropped anywhere in the studio (or from the
// Song menu's "Import MIDI…" and "Import audio…"). Every import is one undo step by 'you' and says what came in.
//
//   parseSmf(bytes) -> { format, ppq, smpte, tempo, tempos, meter, key, markers, parts, end, warnings }
//       SMF types 0, 1 (and 2, read as 1). Running status, note-on at velocity 0 as a note-off, FIFO note pairing,
//       the tempo map (the first tempo is kept: Overdub has one tempo), time and key signatures, track names,
//       markers, program changes. Parts are one per (track, channel): type 0 files split by channel.
//       Times are in beats (quarter notes): ticks / ppq, so tempo changes never move a note off its beat.
//   deviceFor(part) -> a built-in instrument id: channel 10 -> core.drums, else the GM program's family, else the name.
//   planMidiImport(smf, project, { at, adopt, name }) -> { ops, summary, adopted }   (pure: Node and the page)
//   midiSummary(plan, fileName) -> the toast text
//
// In the page (export default): app.importers = { parseSmf, planMidiImport, importMidi(bytes | File, { name, at }),
//   importAudio([File | { name, buffer }], { track, beat }), decodeAudio(arrayBuffer), pickMidi(), pickAudio({ track, beat }) }.
// A file dropped on the arranger lands where it was dropped (app.arranger.locate); MIDI dropped elsewhere starts at
// bar 1, audio dropped elsewhere goes on a new audio track at the playhead's bar. ui/reference.js takes its own drops.

import { newId, songEnd, LIMITS } from '../core/project.js';
import { beatsPerBar, validMeter } from '../core/music.js';
import { css } from '../ui/dom.js';

/* ================================================================ SMF */
const PITCH_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCH_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// sf: -7..7 (flats negative), mi: 0 major, 1 minor -> { root, scale }
export function keyFromSignature(sf, mi) {
  if (sf > 127) sf -= 256;                       // a signed byte
  if (!(sf >= -7 && sf <= 7)) return null;
  const major = ((sf * 7) % 12 + 12) % 12;       // C=0, G=7, D=2 … F=5, Bb=10
  const pc = mi ? (major + 9) % 12 : major;
  const names = sf < 0 ? PITCH_NAMES_FLAT : PITCH_NAMES_SHARP;
  return { root: names[pc], scale: mi ? 'minor' : 'major' };
}

function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/, '').trim(); } catch { /* latin-1 */ }
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return s.replace(/\0+$/, '').trim();
}

export function parseSmf(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input && input.buffer ? input.buffer : input);
  const str = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  const u32 = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const u16 = (o) => (b[o] << 8) | b[o + 1];
  // a RIFF-wrapped MIDI file (.rmi) holds the SMF in its 'data' chunk
  let base = 0;
  if (b.length >= 20 && str(0, 4) === 'RIFF' && str(8, 4) === 'RMID') {
    let o = 12;
    while (o + 8 <= b.length) {
      // the length is unsigned, and every step must move forward: a corrupt length ends the walk, not the tab
      const id = str(o, 4), len = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
      if (id === 'data') { base = o + 8; break; }
      const next = o + 8 + len + (len & 1);
      if (!(next > o) || next > b.length) break;
      o = next;
    }
  }
  if (b.length < base + 14 || str(base, 4) !== 'MThd') throw new Error('not a Standard MIDI File (no MThd header)');
  const hlen = u32(base + 4);
  const format = u16(base + 8), ntrks = u16(base + 10), division = u16(base + 12);
  const warnings = [];
  let ppq = 480, smpte = null;
  if (division & 0x8000) {
    const fps = 256 - (division >> 8), tpf = division & 0xff;
    // every time is ticks / (fps × tpf): with 0 ticks per frame no note has one (they'd all stack on beat 1)
    if (!tpf) throw new Error(`the file counts SMPTE time at ${fps} fps with 0 ticks per frame, so none of its notes has a time`);
    smpte = { fps: fps === 29 ? 29.97 : fps, tpf };
  } else ppq = division || 480;
  if (format > 2) warnings.push(`format ${format} is not a standard one; read as type 1`);
  if (format === 2) warnings.push('a type 2 file (separate patterns): its tracks are laid side by side from bar 1');

  const tempos = [], timesigs = [], keysigs = [], markers = [];
  const raw = [];        // per track: { name, instrument, notes: [{ ch, p, on, off, vel }], programs: [{ tick, ch, program }], end }
  let o = base + 8 + hlen, trk = 0;
  while (o + 8 <= b.length && trk < Math.max(ntrks, 1) + 64) {
    const id = str(o, 4), len = u32(o + 4);
    const start = o + 8, end = Math.min(b.length, start + len);
    o = start + len;
    if (id !== 'MTrk') continue;       // alien chunks are skipped, as the spec asks
    if (start + len > b.length) warnings.push(`track ${trk + 1} is cut short; read what is there`);
    const t = { index: trk++, name: '', instrument: '', notes: [], programs: [], end: 0 };
    raw.push(t);
    const open = new Map();            // ch*128+p -> [{ on, vel }] (first in, first out)
    let p = start, tick = 0, running = 0;
    const vlq = () => { let v = 0, c, n = 0; do { c = b[p++]; v = v * 128 + (c & 0x7f); n++; } while (c & 0x80 && p < end && n < 4); return v; };
    while (p < end) {
      tick += vlq();
      if (p >= end) break;
      let status = b[p];
      if (status < 0x80) {             // running status: the byte is data; reuse the last channel status
        if (!running) { warnings.push(`track ${t.index + 1}: data with no status at byte ${p}; the rest of the track is skipped`); break; }
        status = running;
      } else { p++; }
      if (status === 0xff) {
        const type = b[p++], l = vlq(), data = b.subarray(p, Math.min(end, p + l));
        p += l;
        if (type === 0x2f) break;
        if (type === 0x03 && !t.name) t.name = decodeText(data);
        else if (type === 0x04 && !t.instrument) t.instrument = decodeText(data);
        else if (type === 0x51 && data.length >= 3) tempos.push({ tick, bpm: 60e6 / ((data[0] << 16) | (data[1] << 8) | data[2] || 500000) });
        else if (type === 0x58 && data.length >= 2) {
          // denominators past 2^5 (a 32nd) are corrupt, not music: a meter of 4/2^40 makes a bar 1e-11 beats long
          const meter = [data[0] || 4, data[1] <= 5 ? 2 ** data[1] : 0];
          if (validMeter(meter)) timesigs.push({ tick, meter });
          else warnings.push(`track ${t.index + 1}: a time signature of ${data[0]}/2^${data[1]} is out of range; ignored`);
        }
        else if (type === 0x59 && data.length >= 2) keysigs.push({ tick, key: keyFromSignature(data[0], data[1]) });
        else if (type === 0x06) markers.push({ tick, name: decodeText(data) });
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { const l = vlq(); p += l; continue; }   // sysex: skipped
      if (status >= 0xf0) { warnings.push(`track ${t.index + 1}: a system message (0x${status.toString(16)}) in a file; the rest of the track is skipped`); break; }
      running = status;
      const kind = status & 0xf0, ch = status & 0x0f;
      const d1 = b[p++] & 0x7f;
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : b[p++] & 0x7f;
      if (kind === 0x90 && d2 > 0) {
        const k = ch * 128 + d1;
        if (!open.has(k)) open.set(k, []);
        open.get(k).push({ on: tick, vel: d2 });
      } else if (kind === 0x80 || kind === 0x90) {
        const q = open.get(ch * 128 + d1);
        const n = q && q.shift();
        if (n) t.notes.push({ ch, p: d1, on: n.on, off: tick, vel: n.vel });
      } else if (kind === 0xc0) t.programs.push({ tick, ch, program: d1 });
    }
    t.end = tick;
    // notes still held at the end of the track end there
    for (const [k, q] of open) for (const n of q) t.notes.push({ ch: k >> 7, p: k & 127, on: n.on, off: Math.max(n.on + 1, tick), vel: n.vel });
    if ([...open.values()].some((q) => q.length)) warnings.push(`track ${t.index + 1}: notes with no note-off end with the track`);
  }
  if (!raw.length) throw new Error('the MIDI file has no tracks');

  const byTick = (a, c) => a.tick - c.tick;
  tempos.sort(byTick); timesigs.sort(byTick); keysigs.sort(byTick); markers.sort(byTick);
  const tempo = tempos.length ? tempos[0].bpm : null;
  // ticks -> beats. SMPTE files count time, not beats: use the first tempo (or 120) to put them on a grid
  const bpmForSmpte = tempo || 120;
  const toBeats = smpte ? (tk) => (tk / (smpte.fps * smpte.tpf)) * (bpmForSmpte / 60) : (tk) => tk / ppq;
  const r4 = (x) => Math.round(x * 10000) / 10000;

  // global program per channel (a program change on any track sets the channel), for parts with none of their own
  const firstProgram = new Map();
  for (const t of raw) for (const pc of t.programs) { const f = firstProgram.get(pc.ch); if (!f || pc.tick < f.tick) firstProgram.set(pc.ch, pc); }

  const parts = [];
  let typeOffset = 0;
  for (const t of raw) {
    const chans = [...new Set(t.notes.map((n) => n.ch))].sort((a, c) => a - c);
    for (const ch of chans) {
      const ns = t.notes.filter((n) => n.ch === ch).sort((a, c) => a.on - c.on || a.p - c.p);
      const first = ns[0].on;
      const own = t.programs.filter((x) => x.ch === ch && x.tick <= first).pop() || t.programs.find((x) => x.ch === ch) || null;
      const program = own ? own.program : firstProgram.get(ch)?.program ?? null;
      const off = format === 2 ? typeOffset : 0;
      parts.push({
        track: t.index, channel: ch + 1, name: t.name || t.instrument || '', trackName: t.name || '', instrument: t.instrument || '',
        multi: chans.length > 1, program, drums: ch === 9,
        notes: ns.map((n) => ({ p: n.p, t: r4(toBeats(n.on) + off), d: Math.max(1 / 64, r4(toBeats(n.off) - toBeats(n.on))), v: Math.max(0.01, Math.min(1, Math.round((n.vel / 127) * 1000) / 1000)) })),
      });
    }
    if (format === 2) typeOffset += Math.ceil(toBeats(t.end) / 4) * 4;
  }
  // loops, not Math.max(...spread): a long file has more notes than a call can take arguments
  let end = 0;
  for (const pt of parts) for (const n of pt.notes) if (n.t + n.d > end) end = n.t + n.d;
  const distinctTempos = new Set(tempos.map((x) => Math.round(x.bpm * 100)));
  return {
    format, ppq, smpte, tracks: raw.length,
    tempo: tempo ? Math.round(tempo * 100) / 100 : null,
    tempos: tempos.map((x) => ({ beat: r4(toBeats(x.tick)), bpm: Math.round(x.bpm * 100) / 100 })),
    tempoChanges: Math.max(0, distinctTempos.size - 1),
    meter: timesigs.length ? timesigs[0].meter : null,
    key: keysigs.find((k) => k.key)?.key || null,
    markers: markers.filter((m) => m.name).map((m) => ({ beat: r4(toBeats(m.tick)), name: m.name })),
    parts, end: r4(end), warnings,
  };
}

/* ================================================================ which instrument plays a part */
// General MIDI families (program 0-127, in eights) -> the built-in instruments.
const FAMILY = [
  ['core.keys', 'Piano'], ['core.pluck', 'Mallets'], ['core.poly', 'Organ'], ['core.pluck', 'Guitar'],
  ['core.bass', 'Bass'], ['core.pad', 'Strings'], ['core.pad', 'Ensemble'], ['core.poly', 'Brass'],
  ['core.poly', 'Reed'], ['core.poly', 'Pipe'], ['core.poly', 'Lead'], ['core.pad', 'Pad'],
  ['core.pad', 'Synth FX'], ['core.pluck', 'Plucked'], ['core.pluck', 'Percussion'], ['core.poly', 'FX'],
];
const PLUCKED_STRINGS = new Set([45, 46]);   // pizzicato, harp
const NAME_HINTS = [
  [/drum|kit|beat|perc|kick|snare|hat/i, 'core.drums'], [/bass/i, 'core.bass'],
  [/pad|string|choir|ensemble|warm|atmos/i, 'core.pad'], [/piano|keys|rhodes|wurli|ep\b|e\.?\s?piano|clav/i, 'core.keys'],
  [/guitar|gtr|pluck|harp|marimba|bell|mallet|vib|kalimba/i, 'core.pluck'], [/lead|synth|arp|organ|brass|sax|flute|horn/i, 'core.poly'],
];
export function deviceFor(part) {
  if (part.drums) return { device: 'core.drums', family: 'Drums' };
  if (Number.isInteger(part.program)) {
    const [device, family] = FAMILY[part.program >> 3];
    return { device: PLUCKED_STRINGS.has(part.program) ? 'core.pluck' : device, family };
  }
  const label = `${part.trackName || ''} ${part.instrument || ''}`;
  for (const [re, device] of NAME_HINTS) if (re.test(label)) return { device, family: null };
  // no program, no telling name: low parts are basslines
  const ps = part.notes.map((n) => n.p).sort((a, c) => a - c);
  const median = ps[ps.length >> 1] ?? 60;
  return median < 48 ? { device: 'core.bass', family: 'Bass' } : { device: 'core.poly', family: null };
}

/* ================================================================ the plan: ops for one undo step */
const fmtBpm = (x) => (Math.round(x * 10) / 10).toString();
// adopt: take the file's tempo, meter and key (default: only when the song has no clips yet). at: beat offset.
export function planMidiImport(smf, project, { at = 0, adopt = null, name = 'the file' } = {}) {
  const p = project;
  const empty = !p.tracks.some((t) => t.clips.length);
  const take = adopt == null ? empty : !!adopt;
  const ops = [];
  const adopted = {};
  if (take) {
    const patch = {};
    if (smf.tempo && smf.tempo >= 20 && smf.tempo <= 400 && Math.abs(smf.tempo - p.tempo) > 0.01) patch.tempo = Math.round(smf.tempo * 100) / 100;
    if (validMeter(smf.meter) && (smf.meter[0] !== p.meter[0] || smf.meter[1] !== p.meter[1])) patch.meter = smf.meter.slice();
    if (smf.key && (!p.key || p.key.root !== smf.key.root || p.key.scale !== smf.key.scale)) patch.key = { ...smf.key };
    if (empty && (!p.title || /^untitled/i.test(p.title))) { const ttl = String(name).replace(/\.(midi?|kar|rmi|smf)$/i, '').trim(); if (ttl) patch.title = ttl.slice(0, 80); }
    if (Object.keys(patch).length) { ops.push({ type: 'project.set', patch }); Object.assign(adopted, patch); }
  }
  const meter = adopted.meter || p.meter;
  const bpb = beatsPerBar(meter);
  const usedNames = new Set(p.tracks.map((t) => t.name.toLowerCase()));
  const uniq = (n) => { let s = n, k = 2; while (usedNames.has(s.toLowerCase())) s = `${n} ${k++}`; usedNames.add(s.toLowerCase()); return s; };
  const tracks = [];
  let notes = 0;
  smf.parts.forEach((part, i) => {
    if (!part.notes.length) return;
    const { device, family } = deviceFor(part);
    const base = part.name ? (part.multi ? `${part.name} (ch ${part.channel})` : part.name) : part.drums ? 'Drums' : family || `Part ${i + 1}`;
    const tname = uniq(base.slice(0, 40));
    let first = Infinity, last = -Infinity;
    for (const n of part.notes) { if (n.t < first) first = n.t; if (n.t + n.d > last) last = n.t + n.d; }
    const cStart = Math.floor(first / bpb) * bpb;
    const length = Math.max(bpb, Math.ceil((last - cStart) / bpb - 1e-9) * bpb);
    const ref = 'mid' + i;
    ops.push({ type: 'track.add', ref, track: { name: tname, kind: 'instrument', instrument: { device, params: {} } } });
    ops.push({ type: 'clip.add', track: '$' + ref, clip: { start: at + cStart, length, name: tname, notes: part.notes.map((n) => ({ p: n.p, t: Math.round((n.t - cStart) * 10000) / 10000, d: n.d, v: n.v })) } });
    tracks.push({ name: tname, device, notes: part.notes.length, drums: part.drums });
    notes += part.notes.length;
  });
  // markers become sections when the song has none (and the file's grid is the song's)
  let sections = 0;
  if (take && !p.sections.length && smf.markers.length && tracks.length) {
    let end = smf.end;
    for (const m of smf.markers) end = Math.max(end, m.beat + bpb);
    const ms = smf.markers.filter((m, i, a) => i === 0 || m.beat > a[i - 1].beat);
    ms.forEach((m, i) => {
      const s = Math.round(m.beat / bpb) * bpb, e = i + 1 < ms.length ? Math.round(ms[i + 1].beat / bpb) * bpb : Math.ceil(end / bpb) * bpb;
      if (e > s) { ops.push({ type: 'section.add', section: { name: m.name.slice(0, 32), start: at + s, length: e - s } }); sections++; }
    });
  }
  const summary = {
    tracks, notes, sections, tempo: smf.tempo, tempoChanges: smf.tempoChanges, meter: smf.meter, key: smf.key,
    keptTempo: !take && smf.tempo && Math.abs(smf.tempo - p.tempo) > 0.01 ? p.tempo : null, format: smf.format, warnings: smf.warnings,
  };
  return { ops, summary, adopted };
}

// "Imported groove.mid: 4 tracks, 812 notes (Drums, Bass, Keys, Lead). 96 bpm, 4/4, A minor."
export function midiSummary(plan, fileName = 'the file') {
  const s = plan.summary, a = plan.adopted;
  if (!s.tracks.length) return `${fileName} has no notes in it.`;
  const names = s.tracks.map((t) => t.name);
  const list = names.length > 5 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ');
  let out = `Imported ${fileName}: ${s.tracks.length} track${s.tracks.length === 1 ? '' : 's'}, ${s.notes.toLocaleString('en-US')} note${s.notes === 1 ? '' : 's'} (${list}).`;
  const bits = [];
  if (a.tempo) bits.push(`${fmtBpm(a.tempo)} bpm`);
  if (a.meter) bits.push(a.meter.join('/'));
  if (a.key) bits.push(`${a.key.root} ${a.key.scale}`);
  if (bits.length) out += ` ${bits.join(', ')}.`;
  if (s.keptTempo && s.tempo) out += ` Kept your ${fmtBpm(s.keptTempo)} bpm; the file says ${fmtBpm(s.tempo)}.`;
  if (s.tempoChanges) out += ` The file changes tempo ${s.tempoChanges} time${s.tempoChanges === 1 ? '' : 's'}; Overdub keeps one, so notes stay on their beats.`;
  if (s.sections) out += ` ${s.sections} section${s.sections === 1 ? '' : 's'} from its markers.`;
  return out;
}

/* ================================================================ the page */
export const MAX_IMPORT_NOTES = LIMITS.songNotes;   // the song's own limit (core/project.js LIMITS), so the import says so before the store refuses it
const MIDI_RE = /\.(midi?|kar|rmi|smf)$/i;
const AUDIO_RE = /\.(wav|wave|mp3|m4a|mp4|aac|ogg|oga|opus|flac|aif|aiff|webm|caf)$/i;
export const isMidiFile = (f) => MIDI_RE.test(f.name || '') || /midi/.test(f.type || '');
export const isAudioFile = (f) => !isMidiFile(f) && (AUDIO_RE.test(f.name || '') || /^audio\//.test(f.type || ''));

export default function (app) {
  const { store, ui } = app;
  const toast = (text, kind = 'info', extra = {}) => ui?.toast?.(text, { kind, ...extra });
  const undoAction = { label: 'Undo', run: () => store.undo() };
  const P = () => store.get();

  async function bytesOf(src) {
    if (src instanceof Uint8Array) return src;
    if (src instanceof ArrayBuffer) return new Uint8Array(src);
    if (src && typeof src.arrayBuffer === 'function') return new Uint8Array(await src.arrayBuffer());
    throw new Error('expected a File, an ArrayBuffer or bytes');
  }

  // importMidi(file | bytes, { name, at, adopt }) -> { ok, txn, tracks, summary, text } | { ok: false, error }
  async function importMidi(src, { name = src?.name || 'the MIDI file', at = 0, adopt = null, quiet = false } = {}) {
    let smf;
    try { smf = parseSmf(await bytesOf(src)); } catch (e) {
      const error = `${name} isn’t a MIDI file Overdub can read (${e.message}).`;
      if (!quiet) toast(error, 'bad');
      return { ok: false, error };
    }
    const total = smf.parts.reduce((a, pt) => a + pt.notes.length, 0);
    if (total > MAX_IMPORT_NOTES) {
      const error = `${name} has ${total.toLocaleString('en-US')} notes; Overdub imports up to ${MAX_IMPORT_NOTES.toLocaleString('en-US')} at a time.`;
      if (!quiet) toast(error, 'bad');
      return { ok: false, error, smf };
    }
    let plan;
    try { plan = planMidiImport(smf, P(), { at, adopt, name }); } catch (e) {
      const error = `Couldn’t import ${name}: ${e.message}`;
      if (!quiet) toast(error, 'bad');
      return { ok: false, error, smf };
    }
    if (!plan.summary.tracks.length) { const error = `${name} has no notes in it.`; if (!quiet) toast(error, 'bad'); return { ok: false, error, smf }; }
    const r = store.dispatch(plan.ops, { by: 'you', label: `import ${name}` });
    if (!r.ok) { if (!quiet) toast(`Couldn’t import ${name}: ${r.error}`, 'bad'); return { ok: false, error: r.error }; }
    const ids = Object.entries(r.created || {}).filter(([k]) => /^mid\d+$/.test(k) && P().tracks.some((t) => t.id === r.created[k])).map(([, v]) => v);
    const text = midiSummary(plan, name);
    if (!quiet) toast(text, 'ok', { ms: 7000, action: undoAction });
    if (ids[0]) ui?.select?.({ track: ids[0], clip: null, notes: [] });
    ui?.emit?.('import', { kind: 'midi', name, tracks: ids });
    return { ok: true, txn: r.txn, tracks: ids, summary: plan.summary, adopted: plan.adopted, text };
  }

  // decodeAudio(arrayBuffer) -> AudioBuffer, at the studio's rate (decodeAudioData needs no running context)
  async function decodeAudio(ab) {
    const sr = app.engine?.ctx?.sampleRate || 48000;
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    const c = OAC ? new OAC({ numberOfChannels: 2, length: 1, sampleRate: sr }) : app.engine?.ctx;
    if (!c) throw new Error('this browser has no Web Audio');
    return await c.decodeAudioData(ab instanceof ArrayBuffer ? ab : ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength));
  }
  const toBufferLike = (x) => (x && typeof x.getChannelData === 'function') ? x : null;

  // importAudio(items, { track, beat }) -> { ok, txn, clips, tracks, text }. items: File | { name, buffer: AudioBuffer }.
  // The first lands on `track` if it is an audio track (else on a new audio track under it); the rest on new tracks.
  async function importAudio(items, { track = null, beat = null, quiet = false } = {}) {
    items = (Array.isArray(items) ? items : [items]).filter(Boolean);
    const decoded = [], failed = [];
    for (const it of items) {
      const nm = it.name || 'audio';
      try {
        const buf = toBufferLike(it.buffer) || toBufferLike(it) || await decodeAudio(await it.arrayBuffer());
        if (!buf || !buf.length) throw new Error('no audio in it');
        decoded.push({ name: nm, buf });
      } catch { failed.push(nm); }
    }
    if (failed.length && !quiet) toast(`Couldn’t read ${failed.join(', ')}: this browser can’t decode ${failed.length === 1 ? 'it' : 'them'}. WAV, MP3, M4A and OGG work.`, 'bad');
    if (!decoded.length) return { ok: false, error: `could not decode ${failed.join(', ') || 'the file'}` };
    const p = P();
    const bpb = beatsPerBar(p.meter);
    const at = Math.max(0, beat == null ? Math.floor((app.engine?.beat || 0) / bpb) * bpb : beat);
    const target = track ? p.tracks.find((t) => t.id === track) || null : null;
    const ops = [];
    const assets = [];
    let index = target ? p.tracks.indexOf(target) + 1 : p.tracks.length;
    decoded.forEach((d, i) => {
      const id = newId('a');
      assets.push({ id, buf: d.buf });
      const base = d.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Audio';
      ops.push({ type: 'asset.add', asset: { id, kind: 'audio', name: d.name, sr: d.buf.sampleRate, channels: d.buf.numberOfChannels, duration: d.buf.duration } });
      let tref;
      if (i === 0 && target && target.kind === 'audio') tref = target.id;
      else { ops.push({ type: 'track.add', ref: 'au' + i, index: index++, track: { name: base, kind: 'audio', instrument: null } }); tref = '$au' + i; }
      const length = Math.max(1 / 16, Math.round(d.buf.duration * (p.tempo / 60) * 10000) / 10000);
      ops.push({ type: 'clip.add', track: tref, ref: 'ac' + i, clip: { kind: 'audio', start: at, length, asset: id, offset: 0, gain: 0, name: base } });
    });
    // the samples first (IndexedDB), then the document: a clip never names an asset that isn't there
    const store_ = app.engine?.assets;
    if (!store_ || typeof store_.put !== 'function') { if (!quiet) toast('Audio can’t be imported yet: the audio engine is still loading.', 'bad'); return { ok: false, error: 'no asset store' }; }
    for (const a of assets) await store_.put(a.id, a.buf);
    const label = decoded.length === 1 ? `import ${decoded[0].name}` : `import ${decoded.length} audio files`;
    const r = store.dispatch(ops, { by: 'you', label });
    if (!r.ok) { for (const a of assets) store_.remove?.(a.id); if (!quiet) toast(`Couldn’t import: ${r.error}`, 'bad'); return { ok: false, error: r.error }; }
    const clips = decoded.map((_, i) => r.created['ac' + i]);
    const trackIds = decoded.map((_, i) => r.created['au' + i] || target?.id);
    const bar = Math.floor(at / bpb) + 1;
    const secs = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);
    const where = (i) => { const t = P().tracks.find((x) => x.id === trackIds[i]); return t ? t.name : 'a new track'; };
    const text = decoded.length === 1
      ? `${decoded[0].name} is in: ${secs(decoded[0].buf.duration)} on ${where(0)}, from bar ${bar}.`
      : `${decoded.length} audio files are in, from bar ${bar}: ${decoded.map((d, i) => `${d.name} on ${where(i)}`).join(', ')}.`;
    if (!quiet) toast(text, 'ok', { ms: 6000, action: undoAction });
    if (trackIds[0]) ui?.select?.({ track: trackIds[0], clip: clips[0] || null, notes: [] });
    ui?.emit?.('import', { kind: 'audio', clips, tracks: trackIds });
    return { ok: true, txn: r.txn, clips, tracks: trackIds, assets: assets.map((a) => a.id), text };
  }

  function pick(accept, run) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = true; inp.style.display = 'none';
    inp.addEventListener('change', () => { const fs = [...(inp.files || [])]; inp.remove(); if (fs.length) run(fs); });
    document.body.append(inp);
    inp.click();
  }
  const pickMidi = () => pick('.mid,.midi,.kar,.rmi,audio/midi,audio/x-midi', async (fs) => { for (const f of fs) await importMidi(f); });
  const pickAudio = ({ track = null, beat = null } = {}) => pick('audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aif,.aiff', (fs) => importAudio(fs, { track, beat }));

  /* ---------------------------------------------------------------- drops */
  // where a drop lands: the arranger's lanes give a track and a beat (snapped to the grid); its headers a track
  function placeOf(e) {
    const loc = app.arranger?.locate?.(e.clientX, e.clientY);
    if (loc) {
      const g = loc.grid || 0;
      return { arranger: true, track: loc.track, beat: g ? Math.max(0, Math.round(loc.beat / g) * g) : Math.max(0, loc.beat) };
    }
    const head = e.target?.closest?.('.ar-heads [data-track]');
    if (head) return { arranger: true, track: head.dataset.track, beat: null };
    if (e.target?.closest?.('.ar-heads, .ar-lanewrap')) return { arranger: true, track: null, beat: null };
    return { arranger: false, track: null, beat: null };
  }
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const kindsOf = (e) => {
    const types = [...(e.dataTransfer?.items || [])].filter((i) => i.kind === 'file').map((i) => i.type || '');
    return { audio: types.some((t) => /^audio\//.test(t) && !/midi/.test(t)), midi: types.some((t) => /midi/.test(t)) };
  };

  let hint = null;
  const showHint = (e, text) => {
    if (!hint) { hint = document.createElement('div'); hint.className = 'imp-hint'; hint.setAttribute('aria-hidden', 'true'); document.body.append(hint); }
    hint.textContent = text;
    hint.style.transform = `translate(${Math.round(e.clientX + 14)}px, ${Math.round(e.clientY + 16)}px)`;
    hint.hidden = false;
  };
  const hideHint = () => { if (hint) hint.hidden = true; };
  css('importers', `.imp-hint{position:fixed;left:0;top:0;z-index:60;pointer-events:none;padding:4px 9px;border-radius:var(--r-1);background:var(--bg-3);color:var(--text);border:1px solid var(--line-2);box-shadow:var(--shadow-1);font:12px/1.3 var(--font-ui);white-space:nowrap}`);

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) { hideHint(); return; }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const k = kindsOf(e), at = placeOf(e);
    if (!at.arranger || (!k.audio && !k.midi)) { hideHint(); return; }
    const t = at.track ? P().tracks.find((x) => x.id === at.track) : null;
    const bar = at.beat != null ? ` · bar ${Math.floor(at.beat / beatsPerBar(P().meter)) + 1}` : '';
    const empty = !P().tracks.some((x) => x.clips.length);
    if (k.midi) showHint(e, `Import MIDI${bar && !empty ? ' from' + bar.replace(' ·', '') : ''}: a track per part`);
    else showHint(e, (t && t.kind === 'audio' ? `Audio clip on ${t.name}` : 'Audio clip on a new track') + bar);
  });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hideHint(); });
  window.addEventListener('drop', async (e) => {
    hideHint();
    if (!hasFiles(e) || e.defaultPrevented) return;
    const files = [...(e.dataTransfer.files || [])];
    const midi = files.filter(isMidiFile), audio = files.filter(isAudioFile);
    if (!midi.length && !audio.length) return;
    e.preventDefault();
    const at = placeOf(e);
    const bpb = beatsPerBar(P().meter);
    // MIDI lands at the bar it was dropped on; into a song with no clips yet it starts at bar 1, where its markers are
    const empty = !P().tracks.some((t) => t.clips.length);
    for (const f of midi) await importMidi(f, { at: !empty && at.arranger && at.beat != null ? Math.floor(at.beat / bpb) * bpb : 0 });
    if (audio.length) await importAudio(audio, { track: at.track, beat: at.beat });
  });
  window.addEventListener('dragend', hideHint);

  app.importers = { parseSmf, planMidiImport, midiSummary, deviceFor, importMidi, importAudio, decodeAudio, pickMidi, pickAudio, isMidiFile, isAudioFile, songEnd: () => songEnd(P()) };
  return app.importers;
}
