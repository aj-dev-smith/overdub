// @ts-check
// Start a song's landing (ui/start.js): the take into the song as ordinary ops (core/ops.js), for one store.dispatch
// signed by whoever played it, so one undo takes all of it out. Pure (Node and the browser).
//
//   planStart(project, { notes, bpm, length, kind = 'drums', name?, device?, by = 'you' })
//     -> { ops, label, track: { name, device } }
//   On a song with no clips: the tempo (the reading's BPM, rounded: the notes were placed on the unrounded pulse, so
//   rounding moves nothing) and the loop over the take. Always: a new track named for the part (core/sounds.js
//   newPartFor: Drums, Drums 2...) and one clip from bar 1 holding the notes.
//   planStart(...).ops refer to the new track as '$t' and the clip as ref 'c' (store.dispatch's result.created.c).

import { newPartFor } from './sounds.js';

const r4 = (x) => Math.round(x * 10000) / 10000;

export function planStart(
  project,
  { notes = [], bpm = null, length = 8, kind = 'drums', name = null, device = null, by = 'you' } = {},
) {
  const part = newPartFor(kind, project);
  const trackName = name || part.name;
  const dev = device || part.device;
  const blank = !(project.tracks || []).some((t) => (t.clips || []).length);
  const tempo = Number.isFinite(bpm) ? Math.max(20, Math.min(400, Math.round(bpm))) : null;
  const ops = [];
  if (blank)
    ops.push({
      type: 'project.set',
      patch: { ...(tempo ? { tempo } : {}), loop: { on: true, start: 0, end: length } },
    });
  ops.push({
    type: 'track.add',
    ref: 't',
    track: { name: trackName, kind: 'instrument', instrument: { device: dev, params: {} } },
  });
  ops.push({
    type: 'clip.add',
    ref: 'c',
    track: '$t',
    clip: {
      kind: 'notes',
      start: 0,
      length,
      name: kind === 'drums' ? 'Beat' : trackName,
      notes: notes.map((n) => ({ p: n.p, t: r4(Math.max(0, n.t)), d: n.d || 0.25, v: n.v ?? 0.8 })),
    },
  });
  const bars = Math.max(1, Math.round(length / beatsOf(project)));
  const what = kind === 'drums' ? 'your beat' : 'your part';
  return {
    ops,
    label: `${what}, ${bars} bar${bars === 1 ? '' : 's'}${blank && tempo ? ` at ${tempo} BPM` : ''}`,
    track: { name: trackName, device: dev },
    by,
  };
}

function beatsOf(project) {
  const m = project.meter || [4, 4];
  return (m[0] * 4) / m[1];
}
