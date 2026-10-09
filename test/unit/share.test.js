// core/share.js: share links (encode/decode), what travels, who a link's parts belong to, devices that arrive, forks.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_FORMAT,
  MAX_DEPTH,
  shareable,
  deflate,
  inflate,
  toBase64url,
  fromBase64url,
  encodeShare,
  decodeShare,
  readHash,
  guardDevices,
  guestId,
  isAgentId,
  isGuestId,
  listenCopy,
  authorsOf,
  creditsOf,
  namesLine,
  isOwnLink,
  openShared,
  forkSong,
  kb,
} from '../../app/src/core/share.js';
import { createProject, normTrack, idNotes, HOUSE, LIMITS } from '../../app/src/core/project.js';

const AT = '2026-01-01T00:00:00.000Z';
const nobody = () => false; // no device ids are already shipped

function song() {
  const p = createProject({ id: 'p_song01', title: 'Link me', tempo: 100 });
  p.tracks = [
    normTrack(
      {
        id: 't_keys01',
        name: 'Keys',
        by: 'you',
        clips: [
          {
            id: 'c_keys01',
            start: 0,
            length: 4,
            by: 'you',
            notes: [
              { p: 60, t: 0, d: 1, v: 0.8 },
              { p: 64, t: 1, d: 1, v: 0.8 },
              { p: 67, t: 2, d: 1, v: 0.8, by: 'claude' },
            ],
          },
        ],
      },
      0,
    ),
    normTrack(
      {
        id: 't_vox001',
        kind: 'audio',
        name: 'Vox',
        clips: [{ id: 'c_vox001', kind: 'audio', start: 0, length: 4, asset: 'a_vox001' }],
      },
      1,
    ),
    normTrack(
      {
        id: 't_drums1',
        name: 'Drums',
        by: HOUSE,
        clips: [{ id: 'c_drums1', start: 0, length: 4, by: HOUSE, notes: [{ p: 36, t: 0, d: 0.5, v: 1 }] }],
      },
      2,
    ),
  ];
  for (const t of p.tracks) for (const c of t.clips) if (c.notes) idNotes(c);
  p.assets = { a_vox001: { kind: 'audio', name: 'vox', sr: 48000, channels: 1, duration: 2 } };
  p.reference = { asset: 'a_ref', name: 'Ref', profile: { lufs: -9 } };
  p.devices = { 'claude.wobble': { id: 'claude.wobble', name: 'Wobble', kernel: 'return x', by: 'claude' } };
  return p;
}

describe('bytes', () => {
  test('base64url round trips every byte value, with no padding or unsafe characters', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const s = toBase64url(bytes);
    assert.match(s, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(fromBase64url(s), bytes);
    assert.deepEqual(fromBase64url(toBase64url(new Uint8Array(0))), new Uint8Array(0));
  });
  test('deflate and inflate round trip', async () => {
    const bytes = new TextEncoder().encode('la '.repeat(1000));
    const packed = await deflate(bytes);
    assert.ok(packed.length < bytes.length / 10);
    assert.deepEqual(await inflate(packed), bytes);
  });
  test('inflate stops at its limit', async () => {
    const packed = await deflate(new Uint8Array(100000));
    await assert.rejects(inflate(packed, 1000), /inflates to more/);
  });
});

describe('shareable', () => {
  test('audio clips, assets and the reference stay behind; the song itself is untouched', () => {
    const p = song();
    const before = JSON.stringify(p);
    const { song: s, dropped } = shareable(p);
    assert.deepEqual(dropped, { audioClips: 1, assets: 1, reference: 1 });
    assert.deepEqual(s.tracks[1].clips, []);
    assert.deepEqual(s.assets, {});
    assert.ok(!('reference' in s));
    assert.equal(JSON.stringify(p), before);
  });
});

describe('encode and decode', () => {
  test('a song round trips through a link (less what cannot travel)', async () => {
    const p = song();
    const enc = await encodeShare(p, { from: { name: 'Jo' }, at: AT });
    assert.equal(enc.ok, true);
    assert.match(enc.hash, /^#s=[A-Za-z0-9_-]+$/);
    assert.equal(enc.chars, enc.data.length);
    const dec = await decodeShare('https://overdubstudio.com/app/' + enc.hash);
    assert.equal(dec.ok, true);
    assert.deepEqual(dec.song, shareable(p).song);
    assert.deepEqual(dec.from, { name: 'Jo' });
    assert.equal(dec.at, AT);
    assert.deepEqual(dec.dropped, { audioClips: 1, assets: 1, reference: 1 });
  });
  test('the secret never goes in the link; a mark does', async () => {
    const enc = await encodeShare(song(), { from: { name: 'Jo', me: 'my-secret-123' }, at: AT });
    const dec = await decodeShare(enc.hash);
    assert.ok(!JSON.stringify(dec).includes('my-secret-123'));
    assert.match(dec.from.mark, /^[0-9a-f]{16}$/);
    assert.ok(!('me' in dec.from));
  });
  test('a song bigger than the link allows is refused with its size', async () => {
    const r = await encodeShare(song(), { max: 10, at: AT });
    assert.equal(r.ok, false);
    assert.match(r.error, /too big for a link/);
    assert.ok(r.chars > 10);
  });
  test('readHash finds the payload in a hash, a URL or among other params', () => {
    assert.equal(readHash('#s=abc'), 'abc');
    assert.equal(readHash('https://x/app/#foo=1&s=a-b_c'), 'a-b_c');
    assert.equal(readHash('s=xyz'), 'xyz');
    assert.equal(readHash('#t=abc'), null);
    assert.equal(readHash(null), null);
  });
  test('no payload, garbage, a cut-off link and a non-song are refused', async () => {
    assert.match((await decodeShare('https://x/app/')).error, /no song in this link/);
    assert.match((await decodeShare('#s=!!!')).error, /no song/);
    assert.match((await decodeShare('#s=AAAAgarbage')).error, /didn’t come through whole/);
    const enc = await encodeShare(song(), { at: AT });
    assert.match((await decodeShare(enc.hash.slice(0, enc.hash.length / 2))).error, /didn’t come through whole/);
    const pack = async (obj) => '#s=' + toBase64url(await deflate(new TextEncoder().encode(JSON.stringify(obj))));
    assert.match(
      (await decodeShare(await pack({ f: 'other/0', song: { tracks: [] } }))).error,
      /isn’t an Overdub song/,
    );
    assert.match(
      (await decodeShare(await pack({ f: SHARE_FORMAT, song: { tracks: 'x' } }))).error,
      /isn’t an Overdub song/,
    );
  });
  test('a link nested past MAX_DEPTH is refused before anything walks it', async () => {
    let deep = {};
    for (let i = 0; i < MAX_DEPTH + 5; i++) deep = { x: deep };
    const payload = { f: SHARE_FORMAT, song: { tracks: [], deep } };
    const hash = '#s=' + toBase64url(await deflate(new TextEncoder().encode(JSON.stringify(payload))));
    assert.match((await decodeShare(hash)).error, /nested deeper/);
  });
  test('a link past the studio limits is refused as it comes in', async () => {
    const notes = Array.from({ length: LIMITS.clipNotes + 1 }, (_, i) => ({ p: 60, t: i % 64, d: 0.1 }));
    const payload = { f: SHARE_FORMAT, song: { tracks: [{ clips: [{ start: 0, length: 64, notes }] }] } };
    const hash = '#s=' + toBase64url(await deflate(new TextEncoder().encode(JSON.stringify(payload))));
    const r = await decodeShare(hash);
    assert.equal(r.ok, false);
    assert.match(r.error, /a clip holds 20,001 notes/);
  });
});

describe('authors in a link', () => {
  test('guestId is a slug of the name and the mark', () => {
    assert.equal(guestId({ name: 'Jo Smith!', mark: 'ABCDEF123' }), 'guest:jo-smith-abcdef');
    assert.equal(guestId({}), 'guest:someone');
    assert.ok(isGuestId(guestId({ name: 'Ünïcode Ñame' })));
  });
  test('isAgentId and isGuestId', () => {
    for (const a of ['claude', 'claude.ai', 'mcp:cursor', 'mcp:a.b-c_d']) assert.ok(isAgentId(a), a);
    for (const a of ['you', 'mcp:', 'mcp:-x', 'guest:x', 'mcp:' + 'x'.repeat(70), 5])
      assert.ok(!isAgentId(a), String(a));
    assert.ok(isGuestId('guest:jo-ab12'));
    assert.ok(!isGuestId('guest:Jo'));
    assert.ok(!isGuestId('guest:'));
  });
  test("someone else's link: the sender's parts are the guest's; agents' and the house's keep their authors", async () => {
    const enc = await encodeShare(song(), { from: { name: 'Jo', me: 'jo-secret' }, at: AT });
    const dec = await decodeShare(enc.hash);
    const { song: s, guest, own } = listenCopy(dec, { taken: nobody });
    assert.equal(own, false);
    assert.equal(guest, guestId(dec.from));
    assert.equal(s.tracks[0].by, guest);
    assert.equal(s.tracks[0].clips[0].by, guest);
    assert.equal(s.tracks[0].clips[0].notes.find((n) => n.p === 67).by, 'claude');
    assert.ok(!('by' in s.tracks[0].clips[0].notes[0])); // unsigned notes go with their clip
    assert.equal(s.tracks[2].by, HOUSE);
    assert.equal(s.tracks[2].clips[0].by, HOUSE);
    assert.deepEqual(s.meta.authors[guest], { kind: 'human', name: 'Jo' });
    assert.ok(!('you' in s.meta.authors));
    assert.equal(s.meta.sharedFrom.id, 'p_song01');
  });
  test("an agent's device keeps its author, under a guest id, via the sender", () => {
    const {
      song: s,
      guest,
      devices,
    } = listenCopy({ song: shareable(song()).song, from: { name: 'Jo' } }, { taken: nobody });
    assert.deepEqual(devices.renamed, { 'claude.wobble': 'guest.wobble' });
    const d = s.devices['guest.wobble'];
    assert.equal(d.by, 'claude');
    assert.equal(d.via, guest);
  });
  test("a device claiming the house is the guest's, the claim kept beside it", () => {
    const p = shareable(song()).song;
    p.devices = { 'jo.amp': { kernel: 'k', by: HOUSE } };
    const { song: s, guest } = listenCopy({ song: p, from: { name: 'Jo' } }, { taken: nobody });
    assert.equal(s.devices['jo.amp'].by, guest);
    assert.equal(s.devices['jo.amp'].claimedBy, HOUSE);
  });
  test('a sender who signs as Claude is named Guest', () => {
    const { song: s, guest } = listenCopy(
      { song: shareable(song()).song, from: { name: 'Claude' } },
      { taken: nobody },
    );
    assert.equal(s.meta.authors[guest].name, 'Guest');
    assert.equal(s.meta.authors[guest].kind, 'human');
  });
  test('your own link opens as yours; a mark lifted onto another song does not', async () => {
    const enc = await encodeShare(song(), { from: { name: 'Jo', me: 'jo-secret' }, at: AT });
    const dec = await decodeShare(enc.hash);
    assert.equal(await isOwnLink(dec, 'jo-secret'), true);
    assert.equal(await isOwnLink(dec, 'someone-else'), false);
    assert.equal(await isOwnLink(dec, null), false);
    assert.equal(await isOwnLink({ ...dec, song: { ...dec.song, title: 'Other' } }, 'jo-secret'), false);
    const mine = await openShared(enc.hash, { me: 'jo-secret', taken: nobody });
    assert.equal(mine.own, true);
    assert.equal(mine.song.tracks[0].by, 'you');
    assert.notEqual(mine.song.id, 'p_song01');
    assert.deepEqual(mine.original, { id: 'p_song01', title: 'Link me' });
    const theirs = await openShared(enc.hash, { me: 'other', taken: nobody });
    assert.equal(theirs.own, false);
    assert.equal(theirs.song.tracks[0].by, theirs.guest);
  });
});

describe('guardDevices', () => {
  test('a device in a built-in namespace moves to the prefix, and what named it follows', () => {
    const s = {
      devices: { 'core.poly': { kernel: 'k' }, 'guest.poly': { kernel: 'k2' } },
      tracks: [{ instrument: { device: 'core.poly' }, inserts: [{ device: 'core.poly' }] }],
      master: { inserts: [{ device: 'core.poly' }] },
    };
    const r = guardDevices(s, { taken: nobody });
    assert.deepEqual(r.renamed, { 'core.poly': 'guest.poly-2' });
    assert.equal(s.devices['guest.poly-2'].id, 'guest.poly-2');
    assert.equal(s.tracks[0].instrument.device, 'guest.poly-2');
    assert.equal(s.tracks[0].inserts[0].device, 'guest.poly-2');
    assert.equal(s.master.inserts[0].device, 'guest.poly-2');
  });
  test('non-devices, bad ids and oversized kernels are dropped; build and worklets never pass', () => {
    const s = {
      devices: {
        'a.ok': { kernel: 'k', build: 'x', worklets: ['y'] },
        'BAD ID': { kernel: 'k' },
        'a.nokernel': {},
        'a.big': { kernel: 'x'.repeat(256 * 1024 + 1) },
      },
      tracks: [],
    };
    const r = guardDevices(s, { prefix: 'you', taken: nobody });
    assert.deepEqual(r.dropped.sort(), ['BAD ID', 'a.big', 'a.nokernel']);
    assert.deepEqual(s.devices, { 'a.ok': { kernel: 'k', id: 'a.ok' } });
  });
  test('a device whose key and id disagree registers under its key', () => {
    const s = { devices: { 'a.x': { id: 'core.poly', kernel: 'k' } }, tracks: [] };
    guardDevices(s, { taken: nobody });
    assert.equal(s.devices['a.x'].id, 'a.x');
  });
});

describe('credits and forks', () => {
  test('authorsOf ranks people, then agents, then the house, most notes first', () => {
    const list = authorsOf(song());
    assert.deepEqual(
      list.map((a) => [a.id, a.kind, a.notes]),
      [
        ['you', 'human', 2],
        ['claude', 'agent', 1],
        [HOUSE, 'house', 1],
      ],
    );
  });
  test('creditsOf shares add up to exactly 100', () => {
    const c = creditsOf(song());
    assert.equal(
      c.reduce((n, a) => n + (a.share || 0), 0),
      100,
    );
    assert.deepEqual(
      c.map((a) => a.share),
      [50, 25, 25],
    );
    // thirds: largest remainder still sums to 100
    const p = song();
    p.tracks[0].clips[0].notes.pop();
    p.tracks[0].clips[0].notes.pop();
    p.tracks[0].clips[0].notes[0].by = 'claude';
    p.tracks[0].clips[0].notes.push({ id: 'nz', p: 70, t: 3, d: 1, v: 0.8, by: 'you' });
    assert.equal(
      creditsOf(p).reduce((n, a) => n + (a.share || 0), 0),
      100,
    );
    assert.deepEqual(creditsOf({ tracks: [] }), []);
  });
  test('namesLine and kb', () => {
    assert.equal(namesLine([]), 'nobody yet');
    assert.equal(namesLine([{ name: 'A' }, { name: 'A' }]), 'A');
    assert.equal(namesLine([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'A, B and C');
    assert.equal(kb(500), '500 B');
    assert.equal(kb(2048), '2.0 KB');
    assert.equal(kb(20480), '20 KB');
  });
  test('forkSong records where it came from and who made it, and leaves the original alone', () => {
    const p = song();
    p.meta.sharedFrom = { id: 'p_orig01', at: AT };
    const before = JSON.stringify(p);
    const f = forkSong(p, { at: AT });
    assert.equal(JSON.stringify(p), before);
    assert.equal(f.meta.forkedFrom.title, 'Link me');
    assert.equal(f.meta.forkedFrom.id, 'p_orig01');
    assert.equal(f.meta.forkedFrom.at, AT);
    assert.deepEqual(
      f.meta.forkedFrom.authors.map((a) => a.id),
      ['you', 'claude', HOUSE],
    );
    assert.ok(!('sharedFrom' in f.meta));
    assert.equal(f.meta.authors.claude.kind, 'agent');
    assert.deepEqual(f.tracks, p.tracks);
  });
});
