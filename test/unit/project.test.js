// core/project.js: the song document, its normalisers, limits and the older formats it still reads.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT,
  HOUSE,
  isProjectFormat,
  newId,
  stableIds,
  createProject,
  plainText,
  cleanName,
  isColor,
  NAME_MAX,
  TITLE_MAX,
  authorClass,
  namedAuthor,
  normTrack,
  normClip,
  normInsert,
  normKey,
  isTakeId,
  idNotes,
  sortNotes,
  songEnd,
  LIMITS,
  songSize,
  sizeError,
  validateProject,
  isValidReference,
  cleanProject,
} from '../../app/src/core/project.js';

// A small but complete song: two tracks, notes, an audio clip, an insert with a lane, a section, a device.
function song() {
  const p = createProject({ title: 'Round trip', tempo: 96, key: { root: 'A', scale: 'minor' } });
  p.tracks = [
    normTrack(
      {
        name: 'Bass',
        by: 'claude',
        clips: [
          {
            start: 0,
            length: 4,
            by: 'claude',
            notes: [
              { p: 40, t: 0, d: 1, v: 0.8 },
              { p: 43, t: 1, d: 1, v: 0.7 },
            ],
          },
        ],
        inserts: [{ device: 'core.eq', params: { low: 2 } }],
      },
      0,
    ),
    normTrack(
      {
        kind: 'audio',
        name: 'Vox',
        clips: [{ kind: 'audio', start: 4, length: 8, asset: 'a_abc123', offset: 0.5, gain: -3 }],
      },
      1,
    ),
  ];
  for (const t of p.tracks) for (const c of t.clips) if (c.kind === 'notes') idNotes(c);
  p.sections = [{ id: 's_aaaaaa', name: 'Verse', start: 0, length: 16 }];
  p.devices = {
    'you.fuzz': { id: 'you.fuzz', name: 'Fuzz', kind: 'effect', kernel: 'return x', params: [], by: 'you' },
  };
  p.assets = { a_abc123: { kind: 'audio', name: 'take', sr: 48000, channels: 1, duration: 4 } };
  p.tracks[0].auto = {
    gain: {
      points: [
        { t: 0, v: -6 },
        { t: 8, v: 0 },
      ],
      by: 'claude',
    },
  };
  return p;
}

describe('ids', () => {
  test('newId is a prefix and six base36 characters', () => {
    for (const pre of ['t', 'c', 'fx', 's', 'a', 'p']) assert.match(newId(pre), new RegExp(`^${pre}_[0-9a-z]{6}$`));
  });
  test('newId rarely repeats', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId('t')));
    assert.ok(ids.size >= 1999);
  });
  test('stableIds is deterministic per seed, distinct per seed, and unique within a song', () => {
    const a = stableIds(song(), 'demo'),
      b = stableIds(song(), 'demo'),
      c = stableIds(song(), 'other');
    const ids = (p) => [
      p.id,
      ...p.sections.map((s) => s.id),
      ...p.tracks.flatMap((t) => [t.id, ...t.inserts.map((f) => f.id), ...t.clips.map((x) => x.id)]),
    ];
    assert.deepEqual(ids(a), ids(b));
    assert.notDeepEqual(ids(a), ids(c));
    assert.equal(new Set(ids(a)).size, ids(a).length);
    assert.match(a.tracks[0].id, /^t_[0-9a-z]{6}$/);
    assert.match(a.tracks[0].clips[0].id, /^c_[0-9a-z]{6}$/);
  });
  test('stableIds moves a sidechain key along with the track it names', () => {
    const p = song();
    p.tracks[1].inserts.push(normInsert({ device: 'core.comp', key: { track: p.tracks[0].id } }));
    stableIds(p, 7);
    assert.equal(p.tracks[1].inserts[0].key.track, p.tracks[0].id);
  });
});

describe('createProject', () => {
  test('a fresh project has the documented defaults and validates', () => {
    const p = createProject();
    assert.equal(p.format, FORMAT);
    assert.equal(p.title, 'Untitled');
    assert.equal(p.tempo, 120);
    assert.deepEqual(p.meter, [4, 4]);
    assert.deepEqual(p.loop, { on: false, start: 0, end: 16 });
    assert.deepEqual(p.tracks, []);
    assert.deepEqual(p.master, { gain: 0, inserts: [] });
    assert.deepEqual(validateProject(p), []);
  });
  test('a patch overrides the defaults', () => {
    assert.equal(createProject({ tempo: 90 }).tempo, 90);
  });
});

describe('text and colours', () => {
  test('plainText drops control characters and bidi overrides, keeps the rest', () => {
    assert.equal(plainText('a\u0000b‮c⁦d\u0085e é 🎸'), 'abcde é 🎸');
  });
  test('cleanName cuts to NAME_MAX without splitting a surrogate pair, and falls back when empty', () => {
    assert.equal(cleanName('x'.repeat(150), 'F').length, NAME_MAX);
    const s = 'a'.repeat(NAME_MAX - 1) + '🎸';
    const out = cleanName(s, 'F');
    assert.equal(out, 'a'.repeat(NAME_MAX - 1));
    assert.equal(cleanName('', 'F'), 'F');
    assert.equal(cleanName('\u0001\u0002', 'F'), 'F');
    assert.equal(cleanName(42, 'F'), '42');
    assert.equal(cleanName({ evil: 1 }, 'F'), 'F');
    assert.equal(cleanName(Infinity, 'F'), 'F');
  });
  test('isColor takes palette tokens and hex only', () => {
    for (const c of ['var(--c-1)', 'var(--c-12)', '#abc', '#abcd', '#a1b2c3', '#A1B2C3FF']) assert.ok(isColor(c), c);
    for (const c of ['red', 'url(http://x)', '#ab', '#abcde', 'var(--x)', 'var(--c-123)', 12, null])
      assert.ok(!isColor(c), String(c));
  });
});

describe('authors', () => {
  test('authorClass reads an id by its form', () => {
    assert.equal(authorClass('you'), 'human');
    assert.equal(authorClass('guest:sam-ab12'), 'human');
    assert.equal(authorClass('claude'), 'agent');
    assert.equal(authorClass('claude.ai'), 'agent');
    assert.equal(authorClass('mcp:cursor'), 'agent');
    assert.equal(authorClass(HOUSE), 'house');
    assert.equal(authorClass('bob'), null);
  });
  test('namedAuthor: the id fixes the kind, and nobody takes a studio name', () => {
    assert.deepEqual(namedAuthor('claude'), { kind: 'agent', name: 'Claude' });
    assert.deepEqual(namedAuthor('guest:x', { kind: 'agent', name: 'Sam' }), { kind: 'human', name: 'Sam' });
    assert.equal(namedAuthor('guest:x', { name: 'C L A U D E' }).name, 'Guest');
    assert.equal(namedAuthor('guest:x', { name: 'Ｙｏｕ' }).name, 'Guest');
    assert.equal(namedAuthor('mcp:cursor').name, 'cursor');
    assert.equal(namedAuthor('mcp:cursor').kind, 'agent');
  });
});

describe('normalisers', () => {
  test('normTrack fills defaults and never throws on junk', () => {
    for (const junk of [null, 5, 'x', [], { tracks: 1 }]) {
      const t = normTrack(junk, 2);
      assert.equal(t.kind, 'instrument');
      assert.equal(t.name, 'Track');
      assert.deepEqual(t.instrument, { device: 'core.poly', params: {} });
      assert.deepEqual(t.inserts, []);
      assert.deepEqual(t.clips, []);
      assert.equal(t.by, 'you');
      assert.equal(t.color, 'var(--c-3)');
    }
  });
  test('normTrack: an audio track gets an input and no instrument; a bad colour falls back', () => {
    const t = normTrack({ kind: 'audio', color: 'url(x)', gain: Infinity, name: { html: 1 } });
    assert.equal(t.instrument, null);
    assert.deepEqual(t.input, { device: 'default', channel: 1 });
    assert.equal(t.color, 'var(--c-1)');
    assert.equal(t.gain, 0);
    assert.equal(t.name, 'Audio');
  });
  test('normClip clamps start and length, keeps flags only when valid', () => {
    const c = normClip({
      start: -3,
      length: 0.01,
      mute: 'yes',
      take: 'tk_abcd',
      tuning: 'drop-d',
      capo: 13,
      notes: [{ p: 60, t: 0, s: 1.5, f: 2 }, 'x'],
    });
    assert.equal(c.start, 0);
    assert.equal(c.length, 0.25);
    assert.ok(!('mute' in c));
    assert.equal(c.take, 'tk_abcd');
    assert.equal(c.tuning, 'drop-d');
    assert.ok(!('capo' in c));
    assert.equal(c.notes.length, 1);
    assert.ok(!('s' in c.notes[0]) && !('f' in c.notes[0]));
    assert.equal(normClip({ start: Infinity, length: NaN }).start, 0);
    assert.equal(normClip({ length: NaN }).length, 4);
  });
  test('normClip: an audio clip keeps asset, offset and gain', () => {
    const c = normClip({ kind: 'audio', asset: 'a_x', offset: 1.5, gain: -2 });
    assert.equal(c.kind, 'audio');
    assert.equal(c.asset, 'a_x');
    assert.equal(c.offset, 1.5);
    assert.equal(c.gain, -2);
    assert.ok(!('notes' in c));
  });
  test('normInsert and normKey', () => {
    const fx = normInsert({ device: 'core.comp', on: 0, key: { track: 't_abc' } });
    assert.equal(fx.on, true);
    assert.deepEqual(fx.key, { track: 't_abc' });
    assert.equal(normInsert({ on: false }).on, false);
    assert.equal(normKey({ track: '' }), null);
    assert.equal(normKey({ track: 'x'.repeat(65) }), null);
    assert.equal(normKey('t_abc'), null);
  });
  test('isTakeId', () => {
    assert.ok(isTakeId('tk_ab12'));
    assert.ok(!isTakeId('tk_ab'));
    assert.ok(!isTakeId('tk_AB12'));
  });
});

describe('notes', () => {
  test('idNotes numbers new notes after the highest id and sorts by time, then pitch', () => {
    const c = {
      id: 'c_1',
      notes: [
        { p: 64, t: 1 },
        { id: 'na', p: 60, t: 1 },
        { p: 50, t: 0 },
      ],
    };
    idNotes(c);
    assert.deepEqual(
      c.notes.map((n) => [n.p, n.t]),
      [
        [50, 0],
        [60, 1],
        [64, 1],
      ],
    );
    assert.deepEqual(c.notes.map((n) => n.id).sort(), ['na', 'nb', 'nc']);
  });
  test('idNotes with a sequence never hands an id out twice in a clip', () => {
    const seq = new Map();
    const c = {
      id: 'c_1',
      notes: [
        { p: 60, t: 0 },
        { p: 62, t: 1 },
      ],
    };
    idNotes(c, seq);
    const freed = c.notes.pop().id;
    c.notes.push({ p: 64, t: 2 });
    idNotes(c, seq);
    assert.notEqual(c.notes[1].id, freed);
  });
  test('sortNotes breaks ties by id', () => {
    const c = {
      notes: [
        { id: 'n2', p: 60, t: 0 },
        { id: 'n1', p: 60, t: 0 },
      ],
    };
    assert.deepEqual(
      sortNotes(c).notes.map((n) => n.id),
      ['n1', 'n2'],
    );
  });
});

describe('size and limits', () => {
  test('songEnd: the last clip or section, else four bars', () => {
    assert.equal(songEnd(createProject()), 16);
    assert.equal(songEnd(createProject({ meter: [3, 4] })), 12);
    assert.equal(songEnd(song()), 16);
  });
  test('songSize counts clips, notes, points and the end', () => {
    assert.deepEqual(songSize(song()), { clips: 2, notes: 2, clipNotes: 2, end: 16, points: 2, lanePoints: 2 });
  });
  test('sizeError: under the limits is fine; past one names it; a song already past can shrink', () => {
    const ok = { clips: 1, notes: 10, clipNotes: 10, end: 16, points: 0, lanePoints: 0 };
    assert.equal(sizeError(ok), null);
    assert.match(
      sizeError({ ...ok, clipNotes: LIMITS.clipNotes + 1, notes: LIMITS.clipNotes + 1 }),
      /a clip would hold 20,001 notes/,
    );
    assert.match(sizeError({ ...ok, notes: LIMITS.songNotes + 1 }), /song would hold/);
    assert.match(sizeError({ ...ok, clips: LIMITS.clips + 1 }), /clips/);
    assert.match(sizeError({ ...ok, end: LIMITS.beats + 1 }), /would run to beat/);
    assert.match(sizeError({ ...ok, lanePoints: LIMITS.lanePoints + 1 }), /a lane would hold/);
    assert.match(sizeError({ ...ok, points: LIMITS.songPoints + 1 }), /lanes would hold/);
    const big = { ...ok, notes: LIMITS.songNotes + 100 };
    assert.equal(sizeError({ ...big, notes: big.notes - 1 }, big), null);
    assert.match(sizeError(big, null, { loaded: true }), /the song holds/);
  });
  test('validateProject names duplicates, bad tempo and format', () => {
    const p = song();
    p.tracks[1].id = p.tracks[0].id;
    p.tempo = 500;
    p.format = 'x/1';
    const probs = validateProject(p).join('\n');
    assert.match(probs, /duplicate id/);
    assert.match(probs, /tempo/);
    assert.match(probs, /format/);
    assert.deepEqual(validateProject(null), ['not an object']);
  });
  test('isValidReference needs a name and a finite loudness', () => {
    assert.ok(isValidReference({ name: 'Ref', profile: { lufs: -9 } }));
    assert.ok(!isValidReference({ name: 'Ref', profile: { lufs: null } }));
    assert.ok(!isValidReference({ profile: { lufs: -9 } }));
  });
});

describe('save and load', () => {
  const save = (p) => JSON.stringify(p);
  const load = (s) => cleanProject(JSON.parse(s));
  test('a saved song loads back exactly', () => {
    const p = song();
    assert.deepEqual(load(save(p)), p);
  });
  test('loading is idempotent', () => {
    const once = cleanProject(JSON.parse(save(song())));
    assert.deepEqual(cleanProject(JSON.parse(save(once))), once);
  });
  test('cleanProject never throws on junk and returns a valid song', () => {
    for (const junk of [null, undefined, 3, 'x', [], { tracks: 'no' }, { tracks: [null, 1, { clips: [null] }] }]) {
      const p = cleanProject(junk);
      assert.equal(p.format, FORMAT);
      assert.deepEqual(validateProject(p), []);
    }
  });
  test('cleanProject clamps tempo, keeps a null key, falls back on a bad meter', () => {
    assert.equal(cleanProject({ tempo: 1000 }).tempo, 400);
    assert.equal(cleanProject({ tempo: 1 }).tempo, 20);
    assert.equal(cleanProject({ tempo: 'fast' }).tempo, 120);
    assert.equal(cleanProject({ tempo: null }).tempo, 120);
    assert.equal(cleanProject({ key: null }).key, null);
    assert.deepEqual(cleanProject({ key: 'C' }).key, { root: 'C', scale: 'minor' });
    assert.deepEqual(cleanProject({ meter: [0, 4] }).meter, [4, 4]);
    assert.deepEqual(cleanProject({ meter: [7, 8] }).meter, [7, 8]);
  });
  test('cleanProject drops notes it cannot place, unsafe text and code-carrying device fields', () => {
    const p = cleanProject({
      title: 'A‮b' + 'x'.repeat(300),
      tracks: [
        {
          name: 'T',
          clips: [
            {
              notes: [
                { p: 60, t: 0 },
                { p: 'C4', t: 0 },
                { p: 62, t: NaN },
                { p: 64, t: 1, d: Infinity },
              ],
            },
          ],
        },
      ],
      sections: [{ name: 'S', start: 0, length: 0, color: 'url(x)' }],
      devices: { 'you.x': { name: 5, kernel: 'k', build: 'evil()', worklets: ['a.js'] }, bad: 'str' },
      reference: { name: 'r' },
      master: { gain: Infinity, clip: 'clean' },
    });
    assert.equal(p.title.length, TITLE_MAX);
    assert.ok(!p.title.includes('‮'));
    assert.equal(p.tracks[0].clips[0].notes.length, 1);
    assert.equal(p.sections[0].length, 16);
    assert.ok(!('color' in p.sections[0]));
    assert.deepEqual(Object.keys(p.devices), ['you.x']);
    assert.ok(!('build' in p.devices['you.x']) && !('worklets' in p.devices['you.x']));
    assert.equal(p.devices['you.x'].name, '5');
    assert.ok(!('reference' in p));
    assert.deepEqual(p.master, { gain: 0, inserts: [], clip: 'clean' });
  });
  test('clips and sections load sorted by start, then id', () => {
    const p = cleanProject({
      tracks: [
        {
          clips: [
            { id: 'c_b', start: 4 },
            { id: 'c_c', start: 0 },
            { id: 'c_a', start: 4 },
          ],
        },
      ],
      sections: [
        { id: 's_2', start: 8 },
        { id: 's_1', start: 0 },
      ],
    });
    assert.deepEqual(
      p.tracks[0].clips.map((c) => c.id),
      ['c_c', 'c_a', 'c_b'],
    );
    assert.deepEqual(
      p.sections.map((s) => s.id),
      ['s_1', 's_2'],
    );
  });
  test('automation lanes survive a load', () => {
    const p = load(save(song()));
    assert.deepEqual(p.tracks[0].auto.gain.points, [
      { t: 0, v: -6 },
      { t: 8, v: 0 },
    ]);
    assert.equal(p.tracks[0].auto.gain.by, 'claude');
  });
});

describe('older formats', () => {
  const OLD = ['ear', 'worm'].join('');
  test('isProjectFormat reads this name and the old one, any version', () => {
    assert.ok(isProjectFormat(FORMAT));
    assert.ok(isProjectFormat('overdub/7'));
    assert.ok(isProjectFormat(`${OLD}/0`));
    assert.ok(!isProjectFormat('ableton/1'));
    assert.ok(!isProjectFormat(undefined));
  });
  test('a song saved under the old name opens as this format, house parts re-signed', () => {
    const p = cleanProject({
      format: `${OLD}/0`,
      title: 'Old',
      tempo: 100,
      tracks: [
        {
          name: 'Drums',
          by: OLD,
          clips: [{ by: OLD, notes: [{ p: 36, t: 0, by: OLD }] }],
          inserts: [{ device: 'core.eq', by: OLD }],
        },
      ],
      sections: [{ name: 'Intro', start: 0, length: 8, by: OLD }],
      devices: { 'x.y': { kernel: 'k', by: OLD } },
      meta: { authors: { [OLD]: { kind: 'house', name: 'Earworm' }, you: { kind: 'human', name: 'Me' } } },
    });
    assert.equal(p.format, FORMAT);
    assert.equal(p.tracks[0].by, HOUSE);
    assert.equal(p.tracks[0].clips[0].by, HOUSE);
    assert.equal(p.tracks[0].clips[0].notes[0].by, HOUSE);
    assert.equal(p.tracks[0].inserts[0].by, HOUSE);
    assert.equal(p.devices['x.y'].by, HOUSE);
    assert.ok(!(OLD in p.meta.authors));
    assert.equal(p.meta.authors[HOUSE].kind, 'house');
    assert.ok(!('name' in p.meta.authors[HOUSE]));
    assert.equal(p.meta.authors.you.name, 'Me');
  });
  test('a minimal hand-written song (no meta, devices, master, sections) opens with every field filled', () => {
    const p = cleanProject({ tracks: [{ name: 'Keys', clips: [{ start: 0, length: 4, notes: [{ p: 60, t: 0 }] }] }] });
    assert.equal(p.tracks[0].clips[0].notes[0].id, 'n1');
    assert.deepEqual(p.devices, {});
    assert.deepEqual(p.assets, {});
    assert.deepEqual(p.sections, []);
    assert.deepEqual(p.master, { gain: 0, inserts: [] });
    assert.deepEqual(p.meta.authors, {});
    assert.equal(typeof p.meta.created, 'string');
  });
  test('meta.forkedFrom and sharedFrom are cleaned, not trusted', () => {
    const p = cleanProject({
      meta: { forkedFrom: { title: { x: 1 }, authors: [{ id: 5 }, 'x'], at: 7 }, sharedFrom: 'nope' },
    });
    assert.equal(p.meta.forkedFrom.title, 'Untitled');
    assert.deepEqual(p.meta.forkedFrom.authors, [{ id: '5', kind: 'human', name: '5' }]);
    assert.equal(p.meta.forkedFrom.at, '7');
    assert.ok(!('sharedFrom' in p.meta));
  });
});
