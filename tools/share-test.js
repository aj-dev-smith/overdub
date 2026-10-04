// Songs travel, and a first visit becomes a first take [share]:
//   1. core/share.js in Node: encode -> link -> decode -> listen -> fork keeps notes, authors and the kernels written
//      in the song exactly (the sender's own parts re-signed to a guest, everything else untouched); audio clips are
//      left out and counted; a song too big for a link is refused with a clear message; a cut-off link fails cleanly.
//   2. In the page: Share in the Song menu, the link opened in a fresh browser (the banner, nothing autosaved while
//      listening), Make it yours (meta.forkedFrom, History and the attribution log name the origin, an agent's part
//      stays cool, your next edit is yours), a too-big song refused, your own link opening as yours.
//   3. Code in a song is asked about before it runs (devices/trust.js): a link's or a file's devices this browser
//      doesn't trust are held (not registered, silent or bypassed, none of their code on the audio thread) and the
//      banner asks; Keep them off keeps them held (and the song asks again next time), Make it yours keeps what was
//      decided, Play them plays them with no reload and the same link doesn't ask again; the first run of this version
//      trusts the songs this browser kept, once, and the links it made before then.
//   4. "Take one", the coach: off under webdriver unless forced; each step advances on the real action (the
//      transport, the capture log, Keep, the demo agent's cards, a pick), skip and close remembered.
//   node tools/share-test.js      (screenshots: tools/.out/share-*.png)
import crypto from 'node:crypto';
import { open, tally } from './pw.js';
import * as S from '../app/src/core/share.js';
import '../app/src/devices/builtin/index.js';
import '../app/src/devices/library/index.js';
import { getDevice } from '../app/src/devices/registry.js';
import { createStore } from '../app/src/core/store.js';
import { demoProject } from '../app/src/core/demo.js';

const T = tally('share');
const realErrors = (errs) => errs.filter((e) => !/Failed to load resource|favicon|fonts\.g|net::ERR|AudioContext/.test(e));
const ready = (page) => page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let sentBack = null;   // Sam's song, made Jo's and sent back (section 1 makes it; the ask reads it in a browser, section 3)

// A song with every kind of author, a kernel written in it, and an audio clip that can't travel.
const KERNEL = `({ create({ sr, seed, dsp }) { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] *= 0.5; R[i] *= 0.5; } } }; } })`;
function richSong() {
  const p = demoProject();
  p.title = 'Shared Reel';
  const bass = p.tracks.find((t) => /bass/i.test(t.name));
  bass.clips[0].notes.slice(0, 4).forEach((n) => { n.by = 'you'; });
  bass.clips[0].notes.slice(4, 6).forEach((n) => { n.by = 'mcp:cursor'; });
  p.tracks.push({ id: 't_mine01', name: 'My hum', color: 'var(--c-3)', kind: 'instrument', instrument: { device: 'core.keys', params: {} }, inserts: [], clips: [
    { id: 'c_mine01', kind: 'notes', start: 0, length: 4, by: 'you', notes: [{ id: 'n1', p: 69, t: 0, d: 1, v: 0.8, by: 'you' }, { id: 'n2', p: 72, t: 1, d: 1, v: 0.8, by: 'you' }, { id: 'n3', p: 76, t: 2, d: 1, v: 0.7, by: 'claude' }] }],
    gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'you' });
  p.tracks.push({ id: 't_audio1', name: 'Guitar DI', color: 'var(--c-5)', kind: 'audio', instrument: null, inserts: [{ id: 'fx_half01', device: 'you.half', on: true, params: {}, by: 'you' }], clips: [
    { id: 'c_aud001', kind: 'audio', start: 0, length: 8, asset: 'a_take01', offset: 0, gain: 0, by: 'you' }], gain: -3, pan: 0.2, mute: false, solo: false, arm: true, input: { device: 'default', channel: 1 }, by: 'you' });
  p.assets = { a_take01: { kind: 'audio', name: 'Take 1', sr: 48000, channels: 1, duration: 10 } };
  p.devices['you.half'] = { id: 'you.half', name: 'Half Measure', kind: 'effect', cat: 'utility', blurb: 'half the level', params: [], look: { color: '#334455' }, kernel: KERNEL, by: 'you', version: 2, created: '2026-09-01T00:00:00.000Z' };
  p.meta.authors = { you: { kind: 'human', name: 'You' }, claude: { kind: 'agent', name: 'Claude' }, 'mcp:cursor': { kind: 'agent', name: 'cursor' } };
  return p;
}
// every authored thing: path -> by
function signatures(p) {
  const out = {};
  for (const t of p.tracks) {
    out[`track ${t.id}`] = t.by;
    for (const fx of t.inserts) out[`fx ${fx.id}`] = fx.by;
    for (const c of t.clips) { out[`clip ${c.id}`] = c.by; for (const n of c.notes || []) out[`note ${c.id}/${n.id}`] = n.by; }
  }
  for (const fx of p.master.inserts) out[`fx ${fx.id}`] = fx.by;
  for (const d of Object.values(p.devices)) out[`device ${d.id}`] = d.by;
  return out;
}
const stripBy = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'by' ? undefined : v)));

/* ================================================================ 1. the format, in Node */
console.log('core/share.js');
{
  const song = richSong();
  const before = JSON.stringify(song);
  const enc = await S.encodeShare(song, { from: { name: 'Sam Rivers', me: 'sender01' } });
  T.ok(enc.ok && enc.hash.startsWith('#s=') && /^[A-Za-z0-9_-]+$/.test(enc.data), `encodes to a #s= link: ${S.kb(enc.chars)} for a ${S.kb(enc.bytes)} song (${Math.round((100 * enc.chars) / enc.bytes)}%)`);
  T.ok(JSON.stringify(song) === before, 'encoding leaves the song untouched');
  T.ok(enc.dropped.audioClips === 1 && enc.dropped.assets === 1, 'the audio clip and its recording are left out, and counted');
  {
    const withRef = { ...richSong(), reference: { asset: 'a_ref001', name: 'Someone Else’s Single.mp3', duration: 200, profile: { lufs: -9 }, by: 'you' } };
    const sh = S.shareable(withRef);
    T.ok(!('reference' in sh.song) && sh.dropped.reference === 1 && withRef.reference.name && S.shareable(richSong()).dropped.reference === 0, 'the reference track (its name, profile and asset) stays out of a link, and is counted');
  }

  const dec = await S.decodeShare('https://overdub.ajsmithhq.com/app/' + enc.hash);
  const expect = S.shareable(song).song;
  T.ok(dec.ok && same(dec.song, expect), 'decode gives back exactly what was shared (every note, param, section, the mix)');
  T.ok(dec.song.tracks.find((t) => t.id === 't_audio1').clips.length === 0 && Object.keys(dec.song.assets).length === 0, 'no audio clip or asset in the link');
  T.ok(same(dec.song.devices, song.devices), 'the kernels written in the song travel exactly (source, version, author)');
  T.ok(dec.from.name === 'Sam Rivers' && dec.dropped.audioClips === 1, 'the sender\'s name and what was left out travel with it');

  // the listener's copy: the sender's own parts are a guest's; agents and the house are untouched (in the notes and
  // the mix; the devices, code in the link, are all the sender's)
  const l = S.listenCopy(dec, {});
  const notDevice = (k) => !k.startsWith('device ');
  const a = signatures(dec.song), b = signatures(l.song);
  const changed = Object.keys(a).filter((k) => notDevice(k) && a[k] !== b[k]);
  T.ok(/^guest:sam-rivers-[0-9a-f]{6}$/.test(l.guest) && changed.length > 0 && changed.every((k) => a[k] === 'you' && b[k] === l.guest), `in someone else's studio the sender's ${changed.length} parts are signed ${l.guest}, and nothing else moved`);
  T.ok(Object.keys(a).filter((k) => notDevice(k) && a[k] !== 'you').every((k) => a[k] === b[k]), 'every agent\'s and the house\'s signature is exactly as it was (claude, mcp:cursor, overdub)');
  // devices: the sender's own are the guest's; an agent's keep the agent's name (per the sender), under a guest.* id
  const ren = l.devices.renamed;
  const back = Object.fromEntries(Object.entries(ren).map(([k, v]) => [v, k]));
  const devs = Object.values(l.song.devices);
  const was = (d) => dec.song.devices[back[d.id] || d.id];
  const agentDevs = devs.filter((d) => was(d).by === 'claude'), mineDevs = devs.filter((d) => was(d).by === 'you');
  T.ok(agentDevs.length >= 3 && agentDevs.every((d) => d.by === 'claude' && d.via === l.guest && !d.claimedBy && /^guest\./.test(d.id) && ren[back[d.id]] === d.id), `the link's ${agentDevs.length} devices Claude wrote stay Claude's, per the sender, under guest ids (${agentDevs.map((d) => `${back[d.id]} -> ${d.id}`).join(', ')})`);
  T.ok(mineDevs.length === 1 && mineDevs.every((d) => d.by === l.guest && !d.claimedBy && !d.via && d.id === 'you.half'), 'the sender\'s own device is the guest\'s, under its own id');
  T.ok(Object.values(l.song.devices).every((d) => !S.isHouseId(d.id) && !/^claude\./.test(d.id)), 'no device in the listener\'s copy has a house or claude.* id');
  const noClaim = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'claimedBy' || k === 'via' ? undefined : v)));
  // put the renamed ids back, and the copy is the link, note for note and kernel for kernel
  const unmove = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'device' && typeof v === 'string' && back[v] ? back[v] : k === 'id' && typeof v === 'string' && back[v] ? back[v] : v)));
  const devsBack = Object.fromEntries(Object.entries(unmove(l.song.devices)).map(([k, v]) => [back[k] || k, v]));
  T.ok(same(stripBy(unmove(l.song.tracks)), stripBy(dec.song.tracks)) && same(noClaim(stripBy(devsBack)), stripBy(dec.song.devices)) && same(stripBy(unmove(l.song.master)), stripBy(dec.song.master)), 'the notes and devices themselves are identical (the renamed ids put back)');
  // the banner's line: in proportion, the house included
  {
    const cr = S.creditsOf(l.song);
    const total = cr.reduce((n, a) => n + (a.share || 0), 0);
    const house = cr.find((a) => a.id === 'overdub');
    T.ok(total === 100 && cr[0].id === 'overdub' && house.share > 50 && cr.some((a) => a.id === l.guest) && cr.every((a, i) => !i || a.share == null || cr[i - 1].share >= a.share), `credits are in proportion and add to 100: ${cr.map(S.shareText).join(', ')}`);
  }
  {
    // the attribution log keeps Claude on Claude's devices, and says a link vouched for it
    const { provenanceModel } = await import('../app/src/ui/provenance.js');
    const m = provenanceModel(l.song, { getDevice });
    const nb = (m.devices || []).filter((d) => /^guest\.(night-bus|firefly|tidal-cathedral)$/.test(d.id));
    const mine = (m.devices || []).find((d) => d.id === 'you.half');
    T.ok(nb.length === 3 && nb.every((d) => d.author === 'Claude, per the sender' && d.authorKind === 'agent' && d.via === l.guest) && mine && mine.authorKind === 'human' && !mine.via, `provenance: ${nb.map((d) => `${d.name} by ${d.author}`).join('; ')}; ${mine?.name} by ${mine?.author}`);
  }
  // a link where the house wrote most of it, the agents some and the sender a little: the house leads the line
  {
    const demo = demoProject();
    const t0 = demo.tracks.find((t) => t.clips.some((c) => c.notes?.length));
    t0.clips.find((c) => c.notes?.length).notes.slice(0, 2).forEach((n) => { n.by = 'you'; });
    const o = S.listenCopy({ song: S.shareable(demo).song, from: { name: 'Sam', mark: 'abcdef' } }, {});
    const cr = S.creditsOf(o.song);
    const names = cr.map((a) => a.id);
    T.ok(names[0] === 'overdub' && names.includes('claude') && names.includes(o.guest) && cr[0].share > cr.find((a) => a.id === o.guest).share, `a demo the house mostly wrote reads that way: ${cr.map(S.shareText).join(', ')}`);
    const nb = Object.values(o.song.devices).filter((d) => d.by === 'claude');
    T.ok(nb.length === 3 && nb.every((d) => d.via === o.guest && d.id.startsWith('guest.')), `Night Shift's ${nb.length} devices arrive signed by Claude (${nb.map((d) => d.name).join(', ')}), per the sender`);
  }
  T.ok(l.song.meta.authors[l.guest]?.kind === 'human' && l.song.meta.authors[l.guest]?.name === 'Sam Rivers' && !l.song.meta.authors.you, 'the guest is a named person in the song\'s authors');
  const own = S.listenCopy(dec, { own: await S.isOwnLink(dec, 'sender01') });
  T.ok(own.own && same(signatures(own.song), a), 'your own link opens with your parts still yours');

  // the link never carries the browser's id: a mark made from it, the moment and the song, that can't be moved
  T.ok(!JSON.stringify(dec.from).includes('sender01') && !('me' in dec.from) && /^[0-9a-f]{16}$/.test(dec.from.mark || ''), `the link carries a mark, not the browser's id (from: ${JSON.stringify(dec.from)})`);
  T.ok(!(await S.isOwnLink(dec, 'listener9')) && !(await S.isOwnLink(dec, null)), 'in another browser it is not yours');
  {
    // someone who got that link forges one: their song, signed 'you', with the mark (or the old raw id) lifted onto it
    const forged = S.shareable(richSong()).song;
    forged.tracks[0].clips[0].notes.forEach((n) => { n.by = 'you'; });
    forged.title = 'Not Yours';
    const mk = async (from) => S.toBase64url(await S.deflate(new TextEncoder().encode(JSON.stringify({ f: S.SHARE_FORMAT, at: dec.at, from, dropped: {}, song: forged }))));
    const lifted = await S.openShared('#s=' + await mk({ name: 'Sam Rivers', mark: dec.from.mark }), { me: 'sender01' });
    const legacy = await S.openShared('#s=' + await mk({ name: 'Sam Rivers', me: 'sender01' }), { me: 'sender01' });
    const yours = (o) => o.song.tracks[0].clips[0].notes.some((n) => n.by === 'you');
    T.ok(lifted.ok && !lifted.own && !yours(lifted) && legacy.ok && !legacy.own && !yours(legacy), 'a forged link (the mark lifted onto another song, or an old-style raw id) opens as a guest\'s, none of it signed you');
  }

  // a link's devices add to the studio and never take one over: a built-in's id or the house shelf's comes in as the
  // guest's, and every track and insert that named it moves with it
  {
    const evil = demoProject();
    const HOSTILE = `({ create() { return { process(L, R, n) { for (let i = 0; i < n; i++) { L[i] = 0.5; R[i] = 0.5; } } }; } })`;
    const keys = evil.tracks.find((t) => t.instrument?.device === 'core.keys');
    keys.inserts.push({ id: 'fx_evil01', device: 'claude.skylight', on: true, params: {} });
    evil.master.inserts.push({ id: 'fx_evil02', device: 'claude.skylight', on: true, params: {} });
    evil.devices['core.keys'] = { id: 'core.keys', name: 'Keys', kind: 'instrument', params: [], kernel: HOSTILE, by: 'overdub' };
    evil.devices['claude.skylight'] = { id: 'claude.skylight', name: 'Skylight', kind: 'effect', params: [], kernel: HOSTILE, by: 'claude' };
    evil.devices['sam.innocent'] = { id: 'core.drums', name: 'Innocent', kind: 'effect', params: [], kernel: HOSTILE, by: 'you' };
    evil.devices['sam.huge'] = { id: 'sam.huge', name: 'Huge', kind: 'effect', params: [], kernel: '/*' + 'x'.repeat(S.MAX_KERNEL_CHARS) + '*/({})', by: 'you' };
    const enc2 = await S.encodeShare(evil, { from: { name: 'Mallory' } });
    const o = await S.openShared(enc2.hash, { me: 'listener9' });
    const ids = Object.keys(o.song.devices);
    const k2 = o.song.tracks.find((t) => t.name === 'Keys');
    const rn = o.devices.renamed;
    T.ok(o.ok && rn['core.keys'] === 'guest.keys' && rn['claude.skylight'] === 'guest.skylight' && Object.entries(rn).every(([k, v]) => v.startsWith('guest.') && (S.isHouseId(k) || evil.devices[k].by === 'claude')) && ids.every((id) => !S.isHouseId(id) && o.song.devices[id].id === id), `core.keys and the shelf's claude.skylight come in as guest.keys and guest.skylight (and Claude's own as ${Object.entries(rn).filter(([k]) => !S.isHouseId(k)).map(([, v]) => v).join(', ')}); no device in the song has a house id (${ids.join(', ')})`);
    T.ok(k2.instrument.device === 'guest.keys' && k2.inserts.find((x) => x.id === 'fx_evil01').device === 'guest.skylight' && o.song.master.inserts.find((x) => x.id === 'fx_evil02').device === 'guest.skylight', 'the Keys track, its insert and the master insert follow them to the new ids');
    T.ok(o.song.devices['sam.innocent']?.id === 'sam.innocent' && o.devices.dropped.includes('sam.huge') && !o.song.devices['sam.huge'], 'a device can\'t register under another id than its own, and one past 256 KB of source is left out');
    T.ok(o.song.devices['guest.keys'].by === o.guest && o.song.devices['guest.keys'].claimedBy === 'overdub', 'a device in a link that claims to be the house\'s is signed by the guest');
    T.ok(o.song.devices['guest.skylight'].by === 'claude' && o.song.devices['guest.skylight'].via === o.guest && !o.song.devices['claude.skylight'], 'one that says Claude wrote it keeps that name, per the sender (via the guest), and never under the shelf\'s id');
    T.ok(getDevice('core.keys').source === 'builtin' && getDevice('claude.skylight').source === 'library', 'the built-in and the shelf device are untouched');
    // and a song can't do it through an op either (apply_ops, a relay, a replayed log)
    const st = createStore(o.song, { getDevice });
    const def = (id) => st.dispatch({ type: 'device.define', device: { id, name: 'X', kind: 'effect', params: [], kernel: HOSTILE } }, { by: 'claude' });
    const r1 = def('core.keys'), r2 = def('claude.skylight'), r3 = def('claude.mine'), r4 = def('__proto__');
    T.ok(!r1.ok && !r2.ok && /ships/.test(r1.error) && /ships/.test(r2.error) && r3.ok && !r4.ok, `device.define refuses a built-in's or the shelf's id ("${r1.error}"), and takes a new one`);
  }

  // fork
  const f = S.forkSong(l.song, { at: '2026-09-30T12:00:00.000Z' });
  T.ok(f.meta.forkedFrom && f.meta.forkedFrom.title === 'Shared Reel' && f.meta.forkedFrom.at === '2026-09-30T12:00:00.000Z', 'a fork records where it came from (title, when)');
  const fa = f.meta.forkedFrom.authors;
  T.ok(fa.some((x) => x.id === l.guest && x.kind === 'human' && x.name === 'Sam Rivers') && fa.some((x) => x.id === 'claude' && x.kind === 'agent') && fa.some((x) => x.id === 'mcp:cursor' && x.kind === 'agent'), `and who played on it: ${S.namesLine(fa)}`);
  T.ok(same(signatures(f), signatures(l.song)) && same(f.tracks, l.song.tracks) && same(f.devices, l.song.devices), 'the fork keeps every note, device and signature exactly');

  // a song sent back (FRESH-EYES round 5): Sam's link, made Jo's, sent back. Sam's own instrument read "Tape Organ, by
  // Jo" in Sam's browser, even after Make it yours: every device not an agent's was signed by whoever sent the link.
  // An earlier guest's device keeps its maker, as an earlier guest's parts do, and says whose link it came through
  {
    const song = demoProject();
    song.title = 'Spin Cycle';
    const kt = song.tracks.find((t) => t.name === 'Keys');
    kt.instrument = { device: 'sam.tape-organ', params: {} };
    for (const c of kt.clips) { c.by = 'you'; for (const n of c.notes) n.by = 'you'; }
    song.devices['sam.tape-organ'] = { id: 'sam.tape-organ', name: 'Tape Organ', kind: 'instrument', cat: 'keys', params: [], kernel: KERNEL, by: 'you', version: 1 };
    const atJo = await S.openShared((await S.encodeShare(song, { from: { name: 'Sam', me: 'samSecret01' } })).hash, { me: 'joSecret001' });
    const jos = S.forkSong(atJo.song, { at: '2026-10-02T21:30:00.000Z' });
    jos.tracks.find((t) => t.name === 'Bass').clips[0].notes.slice(0, 2).forEach((n) => { n.by = 'you'; });   // (Jo plays a little)
    sentBack = (await S.encodeShare(jos, { from: { name: 'Jo', me: 'joSecret001' } })).hash;   // (for the ask, in a browser below)
    const back = await S.openShared(sentBack, { me: 'samSecret01' });
    const sam = atJo.guest, jo = back.guest, dev = back.song.devices['sam.tape-organ'];
    const keyBy = [...new Set(back.song.tracks.find((t) => t.name === 'Keys').clips.flatMap((c) => [c.by, ...c.notes.map((n) => n.by || c.by)]))];
    T.ok(!back.own && /^guest:sam-/.test(sam) && /^guest:jo-/.test(jo) && dev.by === sam && dev.via === jo && !dev.claimedBy && same(keyBy, [sam]) && back.song.meta.authors[sam]?.name === 'Sam',
      `sent back by Jo, Sam's Tape Organ is still made by Sam (${dev.by}), via Jo's link (${dev.via}), as Sam's Keys parts are (${keyBy.join(', ')}); it was signed ${dev.by === jo ? 'Jo' : 'right'}`);
    const kept = S.forkSong(back.song, { at: '2026-10-02T21:40:00.000Z' }).devices['sam.tape-organ'];
    T.ok(kept.by === sam && kept.via === jo, 'and still after Make it yours');
    const { provenanceModel } = await import('../app/src/ui/provenance.js');
    const pd = (provenanceModel(back.song, { getDevice }).devices || []).find((d) => d.id === 'sam.tape-organ');
    T.ok(pd && pd.author === 'Sam, per the sender' && pd.authorKind === 'human' && pd.via === jo, `the provenance report names its maker, per the sender ("${pd?.author}")`);
    // the sender's own device is still the sender's, and one claiming to be the house's is the sender's too
    jos.devices['you.jo-fizz'] = { id: 'you.jo-fizz', name: 'Fizz', kind: 'effect', params: [], kernel: KERNEL, by: 'you', version: 1 };
    jos.devices['you.claimed'] = { id: 'you.claimed', name: 'Claimed', kind: 'effect', params: [], kernel: KERNEL, by: 'overdub', version: 1 };
    const back2 = await S.openShared((await S.encodeShare(jos, { from: { name: 'Jo', me: 'joSecret001' } })).hash, { me: 'samSecret01' });
    const fz = back2.song.devices['you.jo-fizz'], cl = back2.song.devices['you.claimed'];
    T.ok(fz.by === back2.guest && !fz.via && cl.by === back2.guest && cl.claimedBy === 'overdub' && !cl.via, 'the sender\'s own device is the sender\'s, and a house claim is still the sender\'s, kept as claimedBy');
  }

  // too big
  const huge = demoProject();
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const notes = Array.from({ length: 9000 }, (_, i) => ({ id: 'n' + i.toString(36), p: 30 + Math.floor(rnd() * 60), t: Math.round(rnd() * 5000) / 100, d: Math.round(rnd() * 400) / 100 + 0.01, v: Math.round(rnd() * 100) / 100, by: 'you' }));
  huge.tracks[0].clips[0].notes = notes;
  const big = await S.encodeShare(huge);
  T.ok(!big.ok && big.chars > S.MAX_CHARS && /too big for a link/.test(big.error) && /project file/.test(big.error) && !big.hash, `a song too big for a link is refused: "${big.error}"`);

  // broken links fail cleanly
  const cut = await S.decodeShare(enc.hash.slice(0, Math.floor(enc.hash.length / 2)));
  T.ok(!cut.ok && /cut off/.test(cut.error), 'a link cut in half fails with a clear message');
  const none = await S.decodeShare('https://example.com/app/#x=1');
  T.ok(!none.ok && /no #s=/.test(none.error), 'a link with no song says so');
  const other = await S.decodeShare('#s=' + S.toBase64url(await S.deflate(new TextEncoder().encode(JSON.stringify({ f: 'something/1', song: {} })))));
  T.ok(!other.ok && /isn’t an Overdub song/.test(other.error), 'a link holding something else is refused');
  const bomb = await S.decodeShare('#s=' + S.toBase64url(await S.deflate(new Uint8Array(12 * 1024 * 1024).fill(32))));
  T.ok(!bomb.ok, 'a link that inflates past any real song is refused');
}
// A link or song file is anyone's JSON. Its shapes and its text are checked where it comes in (cleanProject,
// guardDevices, defineDevice): a wrong shape opens instead of throwing, and a field that should be text is text.
const linkOf = async (song) => '#s=' + S.toBase64url(await S.deflate(new TextEncoder().encode(JSON.stringify({ f: S.SHARE_FORMAT, at: '2026-10-01T00:00:00.000Z', from: {}, song }))));
const EVIL = { html: '<img src=x onerror="window.__pwned=(window.__pwned||0)+1">' };
const WRONG_SHAPES = {
  'tracks:[null]': { tracks: [null] }, 'tracks:[5,"x",[]]': { tracks: [5, 'x', []] }, 'clips:[null]': { tracks: [{ clips: [null, 3] }] },
  'clips:{}': { tracks: [{ clips: {} }] }, 'sections:[null]': { tracks: [], sections: [null, 'x'] }, 'sections:{}': { tracks: [], sections: {} },
  'notes:"x"': { tracks: [{ clips: [{ notes: 'x' }] }] }, 'notes:{}': { tracks: [{ clips: [{ notes: {} }] }] }, 'notes:[null]': { tracks: [{ clips: [{ notes: [null, 7] }] }] },
  'inserts:5': { tracks: [{ inserts: 5 }] }, 'inserts:[null]': { tracks: [{ inserts: [null] }] }, 'instrument:"x"': { tracks: [{ instrument: 'x' }] },
  'instrument.params:5': { tracks: [{ instrument: { device: 'core.poly', params: 5 } }] },
  'master:{inserts:{}}': { tracks: [], master: { inserts: {} } }, 'master:5': { tracks: [], master: 5 }, 'devices:[]': { tracks: [], devices: [1] },
  'devices:{x:null}': { tracks: [], devices: { 'sam.x': null } }, 'meta:"x"': { tracks: [], meta: 'x' }, 'meta.authors:[null]': { tracks: [], meta: { authors: [null] } },
  'meta.forkedFrom:5': { tracks: [], meta: { forkedFrom: 5 } }, 'meta.forkedFrom.authors:{}': { tracks: [], meta: { forkedFrom: { title: 'x', authors: {} } } },
  'loop:5': { tracks: [], loop: 5 }, 'key:{root:1}': { tracks: [], key: { root: 1, scale: {} } }, 'auto:5': { tracks: [{ auto: 5 }], master: { auto: 5 } },
  'tracks:{} (a file)': { tracks: {} }, 'title:[]': { tracks: [], title: [] },
};
{
  const { cleanProject, validateProject, summarize } = await import('../app/src/core/project.js');
  const { keyLabel } = await import('../app/src/core/music.js');
  const threw = [];
  for (const [name, song] of Object.entries(WRONG_SHAPES)) {
    try {
      const p = cleanProject(JSON.parse(JSON.stringify(song)));
      const bad = validateProject(p);
      if (bad.length) throw new Error(bad.join('; '));
      if (!p.tracks.every((t) => t && Array.isArray(t.clips) && Array.isArray(t.inserts) && t.clips.every((c) => c.kind === 'audio' || Array.isArray(c.notes)))) throw new Error('a track or clip is still the wrong shape');
      summarize(p); keyLabel(p.key);
      createStore(JSON.parse(JSON.stringify(song))).dispatch({ type: 'project.set', patch: { tempo: 99 } }, { by: 'you' });
    } catch (e) { threw.push(`${name}: ${e.message}`); }
  }
  T.ok(!threw.length, `a wrong-shaped song (${Object.keys(WRONG_SHAPES).length} shapes, from a crafted link or file) opens instead of throwing${threw.length ? ': ' + threw.join(' | ') : ''}`);
  const linkThrew = [];
  for (const [name, song] of Object.entries(WRONG_SHAPES)) {
    if (!Array.isArray(song.tracks)) continue;
    try { const o = await S.openShared(await linkOf(song), { me: 'listener9' }); if (!o.ok) throw new Error(o.error); createStore(o.song); } catch (e) { linkThrew.push(`${name}: ${e.message}`); }
  }
  T.ok(!linkThrew.length, `and through a link (openShared, then the store) too${linkThrew.length ? ': ' + linkThrew.join(' | ') : ''}`);

  // text fields that aren't text: a name, title or blurb that is an object reaches the page as text, never as an object
  const p = cleanProject({ title: EVIL, tracks: [{ name: EVIL, by: EVIL, color: EVIL, instrument: { device: 'core.poly', params: {}, by: EVIL },
    clips: [{ name: EVIL, by: EVIL, color: EVIL, notes: [{ p: 60, t: 0, d: 1, v: 0.8, by: EVIL }] }], inserts: [{ device: 'core.eq', by: EVIL }] }],
    sections: [{ name: EVIL, color: EVIL }], master: { inserts: [{ device: 'core.eq', by: EVIL }] },
    devices: { 'sam.x': { id: 'sam.x', kind: 'effect', name: EVIL, blurb: EVIL, nod: EVIL, by: EVIL, cat: EVIL, kindLabel: EVIL, claimedBy: EVIL, via: EVIL, kernel: KERNEL } },
    meta: { authors: { x: { kind: EVIL, name: EVIL } }, forkedFrom: { title: EVIL, at: EVIL, id: EVIL, authors: [{ id: EVIL, name: EVIL, kind: EVIL }, null] } } });
  const leaks = [];
  JSON.stringify(p, function (k, v) { if (v && typeof v === 'object' && 'html' in v) leaks.push(k); return v; });
  T.ok(!leaks.length && typeof p.title === 'string' && typeof p.tracks[0].name === 'string' && typeof (p.devices['sam.x'].blurb ?? '') === 'string' && typeof p.meta.forkedFrom.title === 'string',
    `cleanProject: every title, name, blurb, author and colour that isn't text becomes text${leaks.length ? ` (still objects: ${leaks.join(', ')})` : ''}`);
  const { defineDevice, removeDevice } = await import('../app/src/devices/registry.js');
  const d = defineDevice({ id: 'sam.evil', kind: 'effect', kernel: KERNEL, source: 'project', name: EVIL, blurb: EVIL, nod: EVIL, by: EVIL, cat: EVIL, kindLabel: EVIL }, { replace: true });
  const dt = ['name', 'blurb', 'by', 'cat'].every((k) => typeof d[k] === 'string') && ['nod', 'kindLabel'].every((k) => d[k] == null || typeof d[k] === 'string');
  removeDevice('sam.evil');
  T.ok(dt, `defineDevice: a device's name, blurb, nod and author are text (got name ${JSON.stringify(d.name)}, blurb ${JSON.stringify(d.blurb)})`);

  // a song's device is a kernel and its params: build and worklets (module source the graph path would load into the
  // audio thread, past the kernel's rules and the device check) are dropped by a song file, a link and the registry
  const MOD = { 'pfx-env': 'registerProcessor("pfx-env", class extends AudioWorkletProcessor { process() { return true; } })' };
  const modSong = () => ({ tracks: [], devices: { 'sam.mod': { id: 'sam.mod', kind: 'effect', kernel: KERNEL, build: 1, worklets: MOD } } });
  const viaFile = cleanProject(modSong()).devices['sam.mod'];
  const viaLink = await S.openShared(await linkOf(modSong()), { me: 'listener9' });
  const linkDev = viaLink.ok ? Object.values(viaLink.song.devices || {})[0] : null;
  const reg = defineDevice({ ...modSong().devices['sam.mod'], source: 'project' }, { replace: true });
  let noKernel = null;
  try { defineDevice({ id: 'sam.mod2', kind: 'effect', build: 1, worklets: MOD, source: 'project' }); } catch (e) { noKernel = e.message; }
  removeDevice('sam.mod');
  const bare = (x) => !!x && !('build' in x) && !('worklets' in x);
  T.ok(bare(viaFile) && bare(linkDev) && bare(reg) && reg.flavour === 'kernel' && !!noKernel,
    `a song's device brings no code but its kernel: build and worklets are gone from a song file (${bare(viaFile)}), a link (${bare(linkDev)}) and the registry (a ${reg.flavour} device); one with no kernel is refused${noKernel ? '' : ' (it was registered)'}`);
}

// A link at the door (core/share.js decodeShare and listenCopy, core/project.js cleanProject, core/store.js author):
// whom it credits, how big and how deep it can be, and what its colours and names can hold.
console.log('a link at the door');
{
  const { cleanProject, NAME_MAX, TRACK_COLORS } = await import('../app/src/core/project.js');
  const keys = { device: 'core.keys', params: {} };
  const linkFrom = async (song, from) => '#s=' + S.toBase64url(await S.deflate(new TextEncoder().encode(JSON.stringify({ f: S.SHARE_FORMAT, at: '2026-10-01T00:00:00.000Z', from, song }))));

  // whom it credits. The studio reads a part signed by nobody as 'you', so a link's unsigned parts (and blank, odd or
  // lookalike signatures) arrived as the listener's own. Every part not signed by an agent, an earlier guest or the
  // house is the sender's: the guest's.
  {
    const song = { title: 'Unsigned', tracks: [
      { id: 't_nob0001', name: 'Unsigned', instrument: keys, inserts: [{ id: 'fx_nob0001', device: 'core.verb', params: {} }], auto: { gain: { points: [{ t: 0, v: -6 }, { t: 4, v: 0, by: 'You' }] } },
        clips: [{ id: 'c_nob0001', kind: 'notes', start: 0, length: 4, notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8 }, { id: 'n2', p: 64, t: 1, d: 1, v: 0.8, by: null }, { id: 'n3', p: 67, t: 2, d: 1, v: 0.8, by: {} }] }] },
      { id: 't_odd0001', name: 'Odd', by: false, instrument: keys, clips: [{ id: 'c_odd0001', kind: 'notes', start: 4, length: 4, by: '', notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8, by: 'You' }] }] },
      { id: 't_kept001', name: 'Kept', by: 'overdub', instrument: keys, clips: [{ id: 'c_kept001', kind: 'notes', start: 8, length: 4, by: 'claude.ai', notes: [
        { id: 'n1', p: 60, t: 0, d: 1, v: 0.8, by: 'claude' }, { id: 'n2', p: 62, t: 1, d: 1, v: 0.8, by: 'mcp:claude-code' }, { id: 'n3', p: 64, t: 2, d: 1, v: 0.8, by: 'guest:sam-ab12cd' }, { id: 'n4', p: 65, t: 3, d: 1, v: 0.8 }] }] },
    ], master: { gain: 0, inserts: [{ id: 'fx_mast001', device: 'core.limiter', params: {} }] } };
    const o = await S.openShared(await linkOf(song), { me: 'listener9' });
    const st = createStore(o.song);
    const p = st.get();
    const sig = {};   // part -> whom the listener's studio credits
    for (const t of p.tracks) {
      sig[t.id] = t.by;
      for (const fx of t.inserts) sig[fx.id] = fx.by;
      for (const [k, lane] of Object.entries(t.auto || {})) lane.points.forEach((pt, i) => { sig[`${t.id} ${k} ${i}`] = pt.by || lane.by; });
      for (const c of t.clips) { sig[c.id] = c.by; for (const n of c.notes) sig[`${c.id}/${n.id}`] = n.by || c.by; }
    }
    for (const fx of p.master.inserts) sig[fx.id] = fx.by;
    const kept = { t_kept001: 'overdub', c_kept001: 'claude.ai', 'c_kept001/n1': 'claude', 'c_kept001/n2': 'mcp:claude-code', 'c_kept001/n3': 'guest:sam-ab12cd', 'c_kept001/n4': 'claude.ai' };
    const theirs = Object.keys(sig).filter((k) => !(k in kept)), yours = Object.keys(sig).filter((k) => sig[k] === 'you');
    T.ok(o.ok && !yours.length && theirs.every((k) => sig[k] === o.guest) && Object.entries(kept).every(([k, by]) => sig[k] === by) && !S.creditsOf(p, (id) => st.author(id)).some((a) => a.id === 'you'),
      `a link's unsigned, blank, odd and lookalike parts are the guest's (${theirs.length} of them, ${o.guest}), never the listener's; an agent's, an earlier guest's and the house's travel as they were${yours.length ? ` (credited to you: ${yours.join(', ')})` : ''}`);
  }

  // whom it names. A link names its authors (meta.authors), and the studio teaches its session those names
  // (ui/share.js): claude.ai as a person called You, a guest as the agent Claude. An id's kind is its form, and a name
  // the studio's own go by (or an agent's that joined this session) is no one else's, however it's spaced or wrapped.
  {
    const song = { title: 'Relabel', tracks: [{ id: 't_rel0001', name: 'R', instrument: keys, by: 'guest:sam-ab12cd', clips: [{ id: 'c_rel0001', kind: 'notes', start: 0, length: 4, by: 'claude.ai', notes: [
      { id: 'n1', p: 60, t: 0, d: 1, v: 0.8, by: 'mcp:cursor' }, { id: 'n2', p: 62, t: 1, d: 1, v: 0.8, by: 'mcp:evil' }, { id: 'n3', p: 64, t: 2, d: 1, v: 0.8, by: 'guest:ann-ff0011' }] }] }],
      meta: { authors: { 'claude.ai': { kind: 'human', name: 'You' }, 'mcp:cursor': { kind: 'house', name: 'C L A U D E' }, 'guest:sam-ab12cd': { kind: 'agent', name: '\u2067Claude\u2069' },
        'mcp:evil': { kind: 'agent', name: 'claude code' }, 'guest:ann-ff0011': { kind: 'human', name: 'Ann' } } } };
    const o = await S.openShared(await linkFrom(song, { name: 'Ｃｌａｕｄｅ' }), { me: 'listener9' });
    const st = createStore(o.song);
    st.addAuthor('mcp:claude-code', { kind: 'agent', name: 'Claude Code' });   // (agent/bridge.js, as Claude Code connects)
    for (const [id, a] of Object.entries(st.get().meta.authors)) if (!st.authors[id] && !id.startsWith('mcp:')) st.addAuthor(id, a);   // (ui/share.js learnAuthors)
    const who = (id) => { const a = st.author(id); return `${a.kind} ${a.name}`; };
    const want = { 'claude.ai': 'agent claude.ai', 'mcp:cursor': 'agent cursor', 'guest:sam-ab12cd': 'human Guest', 'mcp:evil': 'agent evil', [o.guest]: 'human Guest', 'guest:ann-ff0011': 'human Ann', 'mcp:claude-code': 'agent Claude Code' };
    const got = Object.fromEntries(Object.keys(want).map((id) => [id, who(id)]));
    const banner = S.creditsOf(st.get(), (id) => st.author(id)).map((a) => `${a.kind} ${a.name}`);
    T.ok(same(got, want) && same(banner.sort(), ['agent claude.ai', 'agent cursor', 'agent evil', 'human Ann', 'human Guest']),
      `a link can't relabel an author: ${Object.entries(got).map(([k, v]) => `${k} is ${v}`).join(', ')}; the banner: ${banner.join(', ')}`);
  }

  // how big. LIMITS held only a song that grows: a few hundred KB of link opened 120,000 notes or a clip a million beats
  // long. A link past one is refused as it comes in; the same song as a file still opens (it just can't grow)
  {
    const notes = (n) => Array.from({ length: n }, (_, i) => ({ id: 'n' + i.toString(36), p: 60 + (i % 12), t: i / 8, d: 0.1, v: 0.8 }));
    const many = { title: 'Many', tracks: [0, 1, 2].map((k) => ({ id: `t_many00${k}`, name: 'M' + k, instrument: keys, clips: [{ id: `c_many00${k}`, kind: 'notes', start: 0, length: 2200, notes: notes(17000) }] })) };
    const long = { title: 'Long', tracks: [{ id: 't_long001', name: 'L', instrument: keys, clips: [{ id: 'c_long001', kind: 'notes', start: 0, length: 999999, notes: notes(4) }] }] };
    const a = await S.openShared(await linkOf(many), { me: 'listener9' }), b = await S.openShared(await linkOf(long), { me: 'listener9' });
    const files = [many, long].map((s) => createStore(JSON.parse(JSON.stringify(s))).get());
    T.ok(!a.ok && /51,000 notes/.test(a.error) && /up to 50,000/.test(a.error) && !b.ok && /beat 999,999/.test(b.error) && /8,192/.test(b.error) && files[0].tracks.length === 3 && files[1].tracks[0].clips[0].length === 999999,
      `a link past the limits is refused as it comes in ("${a.error}" / "${b.error}"); the same songs as files still open`);
  }

  // how deep. A link nested 20,000 levels ran a recursive walk out of stack (a RangeError, caught only by main.js);
  // now it is refused before anything walks it
  {
    let deep = '0';
    for (let i = 0; i < 20000; i++) deep = `{"a":${deep}}`;
    const text = `{"f":"${S.SHARE_FORMAT}","at":"2026-10-01T00:00:00.000Z","from":{},"song":{"title":"Deep","tracks":[{"name":"D","by":"you","deep":${deep},"clips":[]}]}}`;
    let r = null, threw = null;
    try { r = await S.openShared('#s=' + S.toBase64url(await S.deflate(new TextEncoder().encode(text))), { me: 'listener9' }); } catch (e) { threw = e; }
    T.ok(!threw && r && !r.ok && /nested deeper than any song/.test(r.error), `a link nested 20,000 deep is refused with a plain message (${threw ? `it threw ${threw.constructor.name}` : `"${r?.error}"`})`);
  }

  // what its colours can be. A colour was any string, and the page draws one as CSS, where url(...) fetches an address
  // as soon as the song draws. A track, clip or section colour is a palette token or hex, else the default
  {
    const good = ['var(--c-3)', '#abc', '#abcd', '#a1b2c3', '#A1B2C3D4'];
    const bad = ['url("https://example.com/beacon.gif")', 'red', 'rgb(1, 2, 3)', 'var(--c-1, url(x))', 'var(--accent)', '#12', '#abcdefg', 'image-set("x.png" 1x)', 42, { html: 'x' }];
    const song = { title: 'Colours', tracks: [...good, ...bad].map((color, i) => ({ id: `t_col${String(i).padStart(4, '0')}`, name: 'C' + i, color, instrument: keys, clips: [{ id: `c_col${String(i).padStart(4, '0')}`, kind: 'notes', start: 0, length: 4, color, notes: [] }] })),
      sections: [...good, ...bad].map((color, i) => ({ id: `s_col${String(i).padStart(4, '0')}`, name: 'S' + i, start: i * 4, length: 4, color })) };
    const o = await S.openShared(await linkOf(song), { me: 'listener9' });
    const viaLink = createStore(o.song).get(), viaFile = cleanProject(JSON.parse(JSON.stringify(song)));
    const right = (p) => p.tracks.every((t, i) => (i < good.length ? t.color === good[i] && t.clips[0].color === good[i] : TRACK_COLORS.includes(t.color) && !('color' in t.clips[0])))
      && p.sections.every((s, i) => (i < good.length ? s.color === good[i] : !('color' in s)));
    T.ok(o.ok && right(viaLink) && right(viaFile), `a colour comes in only as a palette token or hex (${good.join(', ')}); url(...), named, rgb() and the rest give the default, through a link and a file`);
  }

  // what its names can hold. Any length and any character: a name of a few MB, control characters, bidi overrides that
  // turn text round. A name is cut at NAME_MAX and a title at 200, without control or bidi characters; the rest of
  // Unicode stays
  {
    const other = 'Café ☕ Ünïcødé — 東京 🎹';
    const song = { title: '\u202eTitle\u0000' + 't'.repeat(300), tracks: [
      { id: 't_nam0001', name: 'x'.repeat(5000), instrument: keys, clips: [{ id: 'c_nam0001', kind: 'notes', start: 0, length: 4, name: 'Bass\u0000\u0007\u001b[31m\u007f\u0085', notes: [] }] },
      { id: 't_nam0002', name: '\u202eevil\u202c \u2066Keys\u2069', instrument: keys, clips: [{ id: 'c_nam0002', kind: 'notes', start: 4, length: 4, name: other, notes: [] }] },
      { id: 't_nam0003', name: 'a'.repeat(NAME_MAX - 1) + '🎹', instrument: keys, clips: [] },
    ], sections: [{ id: 's_nam0001', name: '\u2067Verse\u2069' + 'v'.repeat(300), start: 0, length: 4 }],
    devices: { 'sam.named': { id: 'sam.named', kind: 'effect', kernel: KERNEL, name: '\u202eDev' + 'y'.repeat(300), presets: [{ name: '\u0007Bright', params: {} }] } } };
    const o = await S.openShared(await linkOf(song), { me: 'listener9' });
    const p = createStore(o.song).get();
    const [t1, t2, t3] = p.tracks, dev = Object.values(p.devices)[0];
    const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
    const names = [p.title, ...p.tracks.map((t) => t.name), ...p.tracks.flatMap((t) => t.clips.map((c) => c.name)), ...p.sections.map((s) => s.name), dev.name, dev.presets[0].name];
    T.ok(o.ok && t1.name.length === NAME_MAX && t1.clips[0].name === 'Bass[31m' && t2.name === 'evil Keys' && t2.clips[0].name === other && t3.name === 'a'.repeat(NAME_MAX - 1)
      && p.title.startsWith('Title') && p.title.length === 200 && p.sections[0].name.startsWith('Verse') && p.sections[0].name.length === NAME_MAX && dev.name.startsWith('Dev') && dev.name.length === NAME_MAX && dev.presets[0].name === 'Bright' && !names.some((x) => UNSEEN.test(x)),
      `names come in plain and at most ${NAME_MAX} characters (a 5,000-character track name: ${t1.name.length}; "${t2.name}", "${t1.clips[0].name}"; an emoji at the edge isn't cut in two), the title at 200; other Unicode stays ("${t2.clips[0].name}")`);
  }
}

/* ================================================================ 2. share, listen, make it yours (in the page) */
console.log('share links in the studio');
let link = null, sent = null;
{
  const { page, errors, close, shot } = await open('/app/', { query: 'demo' });
  await ready(page);
  await page.waitForTimeout(300);
  T.ok(!(await page.$('.ob')) && (await page.evaluate(() => window.overdub.onboard && !window.overdub.onboard.active)), 'under webdriver the coach stays out of the way');
  // put the rich song in this studio (the sender), as if it was theirs
  await page.evaluate((song) => window.overdub.store.load(song, { by: 'you' }), richSong());
  sent = await page.evaluate(() => JSON.parse(JSON.stringify(window.overdub.store.get())));
  // the Song menu has Share
  await page.click('.sm-btn');
  const items = await page.$$eval('.sm-i b', (els) => els.map((e) => e.textContent));
  T.ok(items.includes('Share a link'), 'the Song menu has "Share a link"');
  const sub = await page.$$eval('.sm-i', (els) => els.map((e) => e.textContent).find((t) => /Share a link/.test(t)) || '');
  T.ok(/not its audio clips/.test(sub), 'and says audio clips don\'t travel');
  await page.evaluate(() => { window.__copied = null; window.__copies = []; try { navigator.clipboard.writeText = async (t) => { window.__copied = t; window.__copies.push(t); }; } catch (e) { /* ok */ } });
  await page.$$eval('.sm-i', (els) => els.find((e) => /Share a link/.test(e.textContent)).click());
  await page.waitForSelector('.sh-sheet', { timeout: 5000 });
  await page.waitForTimeout(200);
  // the first Share in a browser asks whose name the link carries before anything is copied (a link went out signed
  // "Guest" before the name could be typed: FRESH-EYES round 5)
  const asked = await page.evaluate(() => ({ url: document.querySelector('.sh-url')?.value, copied: window.__copied, focus: document.activeElement?.className || '', text: document.querySelector('.sh-sheet')?.textContent || '' }));
  T.ok(!asked.copied && !asked.url && /sh-name/.test(asked.focus) && /Sign it first/.test(asked.text), `the first Share asks for the name first: nothing copied yet, the name field has focus ("${(asked.text.match(/Sign it first[^.]*\./) || [''])[0]}"; copied: ${asked.copied ? 'a link signed ' + JSON.stringify((await S.decodeShare(asked.copied)).from?.name ?? null) : 'nothing'})`);
  // typed (no change event: the field is read when Copy link is pressed), then Copy link
  await page.fill('.sh-name', 'Sam');
  await page.click('.sh-copy').catch(() => {});
  await page.waitForTimeout(400);
  const sheet = await page.evaluate(() => ({ url: document.querySelector('.sh-url')?.value, text: document.querySelector('.sh-sheet')?.textContent, copied: window.__copied, toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | ') }));
  link = sheet.url;
  const signedSam = link ? (await S.decodeShare(link)).from?.name : null;
  T.ok(link && /\/app\/#s=[A-Za-z0-9_-]+$/.test(link) && sheet.copied === link && signedSam === 'Sam', `Copy link copies the link signed with the name typed (${(link || '').length} chars, signed ${JSON.stringify(signedSam)})`);
  T.ok(/Link copied/.test(sheet.toast) && /signed as Sam/.test(sheet.toast) && /1 recording stays in this browser/.test(sheet.text) && /Sign it as/.test(sheet.text), 'it says it\'s copied and signed as Sam, that the recording stays here, and the name stays in the sheet');
  await shot('share-sheet');
  // the next Share copies at once, signed with the name kept; and the sheet's Copy link copies the link signed with
  // whatever the field says now, typed or not (it copied the old link before)
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__copied = null; });
  await page.click('.sm-btn');
  await page.$$eval('.sm-i', (els) => els.find((e) => /Share a link/.test(e.textContent)).click());
  await page.waitForSelector('.sh-sheet', { timeout: 5000 });
  await page.waitForTimeout(300);
  const again = await page.evaluate(() => window.__copied);
  await page.fill('.sh-name', 'Sam Rivers');
  await page.click('.sh-copy').catch(() => {});
  await page.waitForTimeout(400);
  const retyped = await page.evaluate(() => ({ copied: window.__copied, field: document.querySelector('.sh-url')?.value }));
  const names = [again ? (await S.decodeShare(again)).from?.name : null, retyped.copied ? (await S.decodeShare(retyped.copied)).from?.name : null];
  T.ok(names[0] === 'Sam' && names[1] === 'Sam Rivers' && retyped.copied === retyped.field, `the next Share copies at once, signed with the name kept (${JSON.stringify(names[0])}); the name changed in the field and Copy link: signed ${JSON.stringify(names[1])}`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.overdub.share.name = 'Sam'; });
  const tool = await page.evaluate(() => window.overdub.tools.run('share_link', {}, { by: 'claude' }));
  T.ok(tool && tool.url && /#s=/.test(tool.url) && /audio clip/.test(tool.note), `the agent can make one too: share_link -> ${tool?.size}, "${tool?.note}"`);

  // your own link, opened here: your parts stay yours
  const ownOpen = await page.evaluate(async (u) => { const app = window.overdub; await app.share.open(u); const t = app.store.get().tracks.find((x) => x.id === 't_mine01'); const r = { listening: app.share.listening, by: t?.clips[0].notes.map((n) => n.by), banner: !!document.querySelector('.sh-banner') }; app.share.leave(); return r; }, link);
  T.ok(ownOpen.listening && ownOpen.banner && same(ownOpen.by, ['you', 'you', 'claude']), 'your own link opens as yours (same browser)');

  // a link that carries devices['core.keys'] (signed as the house): it plays as the guest's own device, never as the
  // built-in, and after leaving the link the built-in is the built-in for every song
  {
    const evil = demoProject();
    evil.title = 'Hijack';
    evil.devices['core.keys'] = { id: 'core.keys', name: 'Keys', kind: 'instrument', params: [], kernel: '({ create() { return { process() {} }; } })', by: 'overdub' };
    const e = await S.encodeShare(evil, { from: { name: 'Mallory' } });
    const hj = await page.evaluate(async (h) => {
      const app = window.overdub;
      await app.share.open(h);
      // (Mallory's kernel is held until the listener plays it: played, it registers as the guest's, never as core.keys)
      const held = app.devices.heldDevice?.('guest.keys') || null;
      app.trust?.play?.(['guest.keys']);
      const during = { core: app.devices.getDevice('core.keys')?.source, guest: app.devices.getDevice('guest.keys')?.source, by: app.devices.getDevice('guest.keys')?.by, keys: app.store.get().tracks.find((t) => t.name === 'Keys')?.instrument.device, held: held && held.by };
      app.share.leave();
      await new Promise((r) => setTimeout(r, 150));
      return { during, core: app.devices.getDevice('core.keys')?.source, guest: app.devices.getDevice('guest.keys')?.source || null, title: app.store.get().title };
    }, e.hash);
    T.ok(hj.during.core === 'builtin' && /^guest:mallory/.test(hj.during.held || '') && hj.during.guest === 'project' && /^guest:mallory/.test(hj.during.by || '') && hj.during.keys === 'guest.keys', `a link's core.keys comes in held as ${hj.during.keys}, signed ${hj.during.held}, and plays as that once played; core.keys stays the built-in`);
    T.ok(hj.title === 'Shared Reel' && hj.core === 'builtin' && hj.guest === null, 'after Back to my song, core.keys is the built-in and the link\'s device is gone');
  }

  // a link with a meter of 4/2^40 (a bar 1e-11 beats long froze the ruler): it opens in 4/4 and the studio keeps drawing
  {
    const odd = demoProject();
    odd.meter = [4, 2 ** 40];
    odd.tempo = 0.0001;
    const e = await S.encodeShare(odd, { from: { name: 'Mallory' } });
    const mt = await Promise.race([
      page.evaluate(async (h) => {
        const app = window.overdub;
        await app.share.open(h);
        const p = app.store.get();
        const r = { meter: p.meter.join('/'), tempo: p.tempo, framed: await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(true)))) };
        app.share.leave();
        return r;
      }, e.hash),
      new Promise((res) => setTimeout(() => res({ hung: true }), 8000)),
    ]);
    T.ok(!mt.hung && mt.meter === '4/4' && mt.tempo === 20 && mt.framed, `a link with a 4/2^40 meter opens in ${mt.meter} at ${mt.tempo} bpm, and the page keeps drawing${mt.hung ? ' (it hung)' : ''}`);
  }

  // a song too big for a link
  const tooBig = await page.evaluate(async () => {
    const app = window.overdub;
    let s = 3;
    const notes = Array.from({ length: 9000 }, (_, i) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return `${30 + (s % 60)}@${(s % 5000) / 100}:${((s >>> 8) % 400) / 100 + 0.01}*${((s >>> 16) % 100) / 100}`; }).join(' ');
    app.store.dispatch([{ type: 'track.add', ref: 'b', track: { name: 'Huge' } }, { type: 'clip.add', track: '$b', clip: { start: 0, length: 64, notes } }], { by: 'you' });
    const r = await app.share.copy();
    await new Promise((res) => setTimeout(res, 100));
    const out = { ok: r.ok, error: r.error, toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '), sheet: document.querySelector('.sh-sheet')?.textContent || '' };
    app.store.undo();
    return out;
  });
  T.ok(!tooBig.ok && /too big for a link/.test(tooBig.toast) && /Save the file/.test(tooBig.toast) && /Save the project file/.test(tooBig.sheet), `a too-big song is refused, with the way out: "${tooBig.error}"`);
  T.ok(realErrors(errors).length === 0, 'no page errors (sender)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}
{
  // a different browser (its own server, so its own storage): open the link
  const hash = link.slice(link.indexOf('#'));
  const { page, errors, close, shot } = await open('/app/' + hash);
  await ready(page);
  await page.waitForSelector('.sh-banner', { timeout: 5000 });
  const st = await page.evaluate(() => {
    const app = window.overdub, p = app.store.get();
    const b = document.querySelector('.sh-banner');
    return { listening: app.share.listening, title: p.title, banner: b?.textContent, who: [...b.querySelectorAll('.sh-who')].map((e) => [e.textContent, e.className]), saved: localStorage.getItem('overdub:project'), song: JSON.parse(JSON.stringify(p)), hash: location.hash.slice(0, 3), renamed: app.share.incoming?.devices?.renamed || {} };
  });
  T.ok(st.listening && st.title === 'Shared Reel' && /Listening to Shared Reel — by /.test(st.banner) && /Make it yours/.test(st.banner), `the banner: "${(st.banner || '').replace(/\s+/g, ' ').slice(0, 120)}"`);
  T.ok(st.who.some(([n, c]) => n === 'Sam' && /k-human/.test(c)) && st.who.some(([n, c]) => n === 'Claude' && /k-agent/.test(c)) && st.who.some(([n, c]) => n === 'cursor' && /k-agent/.test(c)), 'it names who played: Sam warm, Claude and cursor cool');
  T.ok(/1 audio clip stayed with the sender/.test(st.banner), 'and says the audio clip stayed behind');
  // the welcome (a first visit) names whoever sent the song, not only Claude and you
  const wel = await page.evaluate(() => { const el = document.querySelector('.ar-welcome'); return el ? { h: el.querySelector('.ar-welcome-h')?.textContent || '', rows: [...el.querySelectorAll('.ar-credits li')].map((li) => [li.querySelector('.ar-cr-what')?.textContent || li.textContent, li.querySelector('.by')?.textContent || null, li.querySelector('.by')?.className || '']) } : null; });
  T.ok(wel && /This is Shared Reel/.test(wel.h) && wel.rows.some(([, by, c]) => by === 'Sam' && /by-human/.test(c)), `the welcome card names the sender: ${wel ? wel.rows.map(([w, by]) => `${w.trim()} … ${by || '(the house)'}`).join('; ') : 'no card'}`);
  // the key beside "Listening to …" plays the song and stops it (it was a round ▶ that did nothing)
  const key = async () => { await page.click('.sh-b-play').catch(() => {}); await page.waitForTimeout(500); return page.evaluate(() => ({ playing: !!window.overdub.engine.playing, label: document.querySelector('.sh-b-play')?.getAttribute('aria-label') || '' })); };
  const k1 = await key(), k2 = await key();
  T.ok(k1.playing && /^Stop/.test(k1.label) && !k2.playing && /^Play/.test(k2.label), `the play key beside "Listening to" plays the song (${k1.playing}, "${k1.label}") and stops it (${k2.playing}, "${k2.label}")`);
  const ex = S.shareable(sent).song;
  // Claude's devices came in under guest ids: put those back to compare
  const back = Object.fromEntries(Object.entries(st.renamed).map(([k, v]) => [v, k]));
  const unmove = (x) => JSON.parse(JSON.stringify(x, (k, v) => ((k === 'device' || k === 'id') && typeof v === 'string' && back[v] ? back[v] : v)));
  const got = { ...unmove(st.song), devices: Object.fromEntries(Object.entries(unmove(st.song.devices)).map(([k, v]) => [back[k] || k, v])) };
  const sa = signatures(ex), sb = signatures(got);
  const noClaim = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'claimedBy' || k === 'via' ? undefined : v)));
  T.ok(Object.keys(st.renamed).length >= 3 && Object.values(st.renamed).every((v) => v.startsWith('guest.')), `Claude's devices in the link come in under guest ids (${Object.values(st.renamed).join(', ')})`);
  T.ok(same(stripBy(got.tracks), stripBy(ex.tracks)) && same(noClaim(stripBy(got.devices)), stripBy(ex.devices)) && same(st.song.sections, ex.sections) && same(stripBy(got.master), stripBy(ex.master)), 'every note, device (kernel source included), section and the mix arrived exactly');
  T.ok(Object.keys(sa).every((k) => (sa[k] === 'you' ? /^guest:sam-/.test(sb[k]) : sa[k] === sb[k])), 'every signature arrived: agents\' (devices included) and the house\'s exactly, the sender\'s as their guest id');
  T.ok(/Overdub \d+%/.test(st.banner) && /Sam \d+%/.test(st.banner) && /Claude \d+%/.test(st.banner), `the banner names who played in proportion: "${(st.banner || '').match(/— by [^\n]*?%(?=[^%]*Make it yours)/)?.[0] || st.banner}"`);
  T.ok(st.saved == null, 'nothing is saved while listening');
  // the kernel Sam wrote in the song is held here (asked about under the banner); Claude's three are Night Shift's own
  // code, so they play. Played, Sam's registers like any project device
  const half = await page.evaluate(async () => {
    const app = window.overdub;
    const before = { held: (app.trust?.held?.() || []).map((d) => d.id), reg: app.devices.getDevice('you.half')?.source || null, claude: ['guest.night-bus', 'guest.firefly', 'guest.tidal-cathedral'].map((id) => app.devices.getDevice(id)?.source || null) };
    document.querySelector('.sh-play')?.click();
    await new Promise((r) => setTimeout(r, 200));
    return { before, after: app.devices.getDevice('you.half')?.source || null };
  });
  T.ok(same(half.before.held, ['you.half']) && half.before.reg === null && half.before.claude.every((s) => s === 'project') && half.after === 'project',
    `the song's own device waits for the listener (held: ${half.before.held.join(', ') || 'none'}), Claude's three (Night Shift's own code) play, and Play it registers Sam's here (${half.after})`);
  // the agent's notes are cool here too
  const cool = await page.evaluate(() => { const app = window.overdub, t = app.store.track('t_mine01'); return t.clips[0].notes.map((n) => [n.by, app.store.author(n.by).kind]); });
  T.ok(cool[2][0] === 'claude' && cool[2][1] === 'agent' && cool[0][1] === 'human' && /^guest:/.test(cool[0][0]), `authors resolve in this studio: ${cool.map((c) => c.join('=')).join(', ')}`);
  await shot('share-banner');

  // an edit while listening: still not saved, and the banner says so
  await page.evaluate(() => window.overdub.store.dispatch({ type: 'project.set', patch: { tempo: 101 } }, { by: 'you' }));
  await page.waitForTimeout(800);
  const mid = await page.evaluate(() => ({ saved: localStorage.getItem('overdub:project'), fine: document.querySelector('.sh-b-fine')?.textContent }));
  T.ok(mid.saved == null && /Not saved/.test(mid.fine || ''), `an edit while listening isn't saved, and the banner says so ("${mid.fine}")`);

  // Make it yours
  await page.click('.sh-fork');
  await page.waitForTimeout(700);
  const fk = await page.evaluate(() => {
    const app = window.overdub, p = app.store.get();
    const saved = JSON.parse(localStorage.getItem('overdub:project') || 'null');
    return { listening: app.share.listening, banner: !!document.querySelector('.sh-banner'), hash: location.hash, ff: p.meta.forkedFrom, savedFF: saved?.meta?.forkedFrom, tempo: p.tempo, toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '), prov: app.exporter.provenance() };
  });
  T.ok(!fk.listening && !fk.banner && fk.hash === '' && fk.tempo === 101, 'Make it yours: the banner goes, the link leaves the address bar, your edit stays');
  T.ok(fk.ff && fk.ff.title === 'Shared Reel' && fk.ff.at && fk.ff.authors.some((a) => a.name === 'Sam' && a.kind === 'human') && fk.ff.authors.some((a) => a.id === 'claude' && a.kind === 'agent') && same(fk.ff, fk.savedFF), `meta.forkedFrom is in the saved song: ${S.namesLine(fk.ff?.authors || [])}`);
  T.ok(/is yours/.test(fk.toast) && /signed by you/.test(fk.toast), `it says what happened: "${fk.toast.split(' | ').find((t) => /is yours/.test(t))}"`);
  T.ok(fk.prov.song.forkedFrom?.title === 'Shared Reel' && /Forked from “Shared Reel”/.test(fk.prov.origin || ''), 'the attribution log names the fork\'s origin');
  // History says so too
  await page.evaluate(() => window.overdub.ui.show('history'));
  await page.waitForTimeout(300);
  const hist = await page.evaluate(() => document.querySelector('.hi-fork')?.textContent || '');
  T.ok(/Forked from “Shared Reel” by Sam/.test(hist), `the History tab: "${hist}"`);
  await shot('share-history');
  // after the fork: the agent's part is still the agent's; your next edit is yours
  const after = await page.evaluate(() => {
    const app = window.overdub;
    const r = app.store.dispatch({ type: 'notes.add', track: 't_mine01', clip: 'c_mine01', notes: 'E5@3:1' });
    const c = app.store.clip('t_mine01', 'c_mine01');
    return { ok: r.ok, by: c.notes.map((n) => n.by), agent: app.store.isAgent('claude'), device: app.store.get().devices['you.half'].by };
  });
  T.ok(after.ok && after.by.includes('claude') && after.agent && after.by[after.by.length - 1] === 'you' && /^guest:/.test(after.device), `after the fork: ${after.by.join(', ')} (the agent's note stays cool, the new one is yours)`);
  // reload: the fork is the song now
  await page.reload();
  await ready(page);
  const re = await page.evaluate(() => ({ title: window.overdub.store.get().title, ff: !!window.overdub.store.get().meta.forkedFrom, listening: !!window.overdub.share?.listening, guest: window.overdub.store.author(window.overdub.store.get().tracks.find((t) => t.id === 't_mine01').clips[0].notes[0].by) }));
  T.ok(re.title === 'Shared Reel' && re.ff && !re.listening && re.guest.name === 'Sam' && re.guest.kind === 'human', 'after a reload the fork is your song, and the guest still has their name');
  T.ok(realErrors(errors).length === 0, 'no page errors (listener)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}
{
  // a phone: the banner wraps, nothing scrolls sideways
  const hash = link.slice(link.indexOf('#'));
  const { page, errors, close, shot } = await open('/app/' + hash, { width: 390, height: 844 });
  await ready(page);
  await page.waitForSelector('.sh-banner', { timeout: 5000 });
  // (the link brings Sam's device: the ask sits under the banner until it's answered)
  const m = await page.evaluate(() => {
    const f = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { right: r.right, h: r.height, w: r.width, top: r.top, bottom: r.bottom } : null; };
    return { w: document.documentElement.scrollWidth, banner: f('.sh-banner'), fork: f('.sh-fork'), play: f('.sh-play'), off: f('.sh-off'), top: f('.ew-top'), welcome: f('.ar-welcome:not(.out)') };
  });
  T.ok(m.w <= 390 && m.fork?.right <= 390 && m.play && m.off && m.off.right <= 390 && m.play.h >= 30 && m.banner.h < 300, `390 px: the banner and the ask fit (${Math.round(m.banner?.h)} px tall with the ask, no sideways scroll, Play it and Keep it off ${Math.round(m.play?.h || 0)} px tall)`);
  T.ok(m.banner.top >= m.top.bottom - 1 && (!m.welcome || m.welcome.top >= m.banner.bottom - 1), `390 px: the banner sits under the whole top bar (${Math.round(m.top.bottom)} px) and the welcome card under the banner (${m.welcome ? Math.round(m.welcome.top) + ' px' : 'none'}), so neither covers the ask`);
  await shot('share-banner-390-ask');
  await page.click('.sh-off').catch(() => {});
  await page.waitForTimeout(200);
  const m2 = await page.evaluate(() => { const b = document.querySelector('.sh-banner').getBoundingClientRect(), f = document.querySelector('.sh-fork').getBoundingClientRect(); return { w: document.documentElement.scrollWidth, bw: b.width, fr: f.right, h: b.height }; });
  T.ok(m2.w <= 390 && m2.fr <= 390 && m2.h < 160, `390 px: kept off, the banner fits (${Math.round(m2.h)} px tall, no sideways scroll)`);
  await shot('share-banner-390');
  // opening another song while listening (the Song menu's demo): that one is yours, so the banner goes
  const sw = await page.evaluate(async () => { await window.overdub.exporter.openDemo(); await new Promise((r) => setTimeout(r, 700)); return { listening: window.overdub.share.listening, banner: !!document.querySelector('.sh-banner'), saved: JSON.parse(localStorage.getItem('overdub:project') || 'null')?.title }; });
  T.ok(!sw.listening && !sw.banner && sw.saved === 'Night Shift', 'opening another song while listening ends the listening (and that song saves as usual)');
  // a broken link: the studio opens your song and says why
  await page.evaluate(() => { location.hash = '#s=AAAA'; });
  await page.waitForTimeout(600);
  const bad = await page.evaluate(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '));
  T.ok(/didn’t come through whole/.test(bad), 'a broken link pasted into the tab: a clear message, and the song you had stays');
  T.ok(realErrors(errors).length === 0, 'no page errors (phone)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}
{
  // a crafted link: a title, track name and device name and blurb that are objects ({ html: '<img onerror>' }) are
  // drawn as text, and run nothing: not in the banner, the device list, the device's info, or a link opened later
  const song = richSong();
  song.title = EVIL; song.tracks[0].name = EVIL; song.devices['you.half'].name = EVIL; song.devices['you.half'].blurb = EVIL;
  const hash = await linkOf(S.shareable(song).song);
  const { page, errors, close } = await open('/app/' + hash);
  await ready(page);
  await page.waitForSelector('.sh-banner', { timeout: 5000 });
  await page.evaluate(() => { window.overdub.ui.show('browser'); window.overdub.browser.search('you.half'); });
  await page.waitForTimeout(400);
  await page.evaluate(async (h) => { location.hash = ''; await window.overdub.share.open(h); }, hash);
  await page.waitForTimeout(400);
  const x = await page.evaluate(() => ({ pwned: window.__pwned || 0, imgs: document.querySelectorAll('img[onerror]').length, title: document.querySelector('.sh-title')?.textContent, rows: document.querySelectorAll('.br-row[data-device="you.half"]').length }));
  T.ok(!x.pwned && !x.imgs && x.title === 'Untitled' && x.rows === 1, `a link whose title, track and device text are objects draws them as text and runs nothing (title "${x.title}", the device listed ${x.rows}×, ${x.pwned} payloads ran, ${x.imgs} img[onerror])`);
  // h() itself: data that lands in its attrs position can't write markup or an inline handler
  const hx = await page.evaluate(async () => {
    const { h, rawHtml } = await import('/app/src/ui/dom.js');
    const a = h('b', { html: '<img src=x onerror="window.__pwned=1">' }), b = h('span', { onmouseover: 'window.__pwned=1' });
    const c = h('p', { innerHTML: ['<img src=x onerror="window.__pwned=1">'] }), d = h('a', { href: ' java\tscript:window.__pwned=1' }), e = h('i', { html: rawHtml('<u>ok</u>') });
    return [a.innerHTML, b.getAttribute('onmouseover'), c.innerHTML, d.getAttribute('href'), e.innerHTML];
  });
  T.ok(hx[0] === '' && hx[1] == null && hx[2] === '' && hx[3] == null && hx[4] === '<u>ok</u>', `h(): markup only from rawHtml(), never a plain { html } object; no inline handler, innerHTML or javascript: URL from attrs (${JSON.stringify(hx)})`);
  T.ok(realErrors(errors).length === 0, 'no page errors (crafted text)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}
{
  // a crafted link whose colours are url(...): the studio drew them as CSS and fetched the address as the song opened,
  // so the sender learned it had (here the address is this test's own server; nothing leaves the machine). A colour
  // is a palette token or hex now, and nothing is fetched
  const { page, base, errors, close } = await open('/app/');
  await ready(page);
  const fetched = [];
  page.on('request', (r) => { if (/\/beacon-/.test(r.url())) fetched.push(r.url()); });
  const song = richSong();
  song.tracks.forEach((t, i) => { t.color = `url("${base}/beacon-track-${i}.gif")`; for (const c of t.clips) c.color = `url("${base}/beacon-${c.id}.gif")`; });
  song.sections.forEach((s, i) => { s.color = `url("${base}/beacon-section-${i}.gif")`; });
  await page.goto(base + '/app/?beacon' + await linkOf(S.shareable(song).song), { waitUntil: 'load' });
  await ready(page);
  await page.waitForFunction(() => window.overdub?.share?.listening, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { const app = window.overdub; for (const tab of ['mixer', 'arranger']) { try { app.ui.show(tab); } catch (e) { /* ok */ } } try { app.ui.select({ track: app.store.get().tracks[0].id }); } catch (e) { /* ok */ } });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({ listening: !!window.overdub.share.listening, colors: window.overdub.store.get().tracks.map((t) => t.color) }));
  T.ok(st.listening && !fetched.length && st.colors.every((c) => /^var\(--c-\d\)$/.test(c)), `a link whose colours are url(...) opens and fetches nothing as it draws (${fetched.length} requests${fetched.length ? ': ' + fetched.slice(0, 2).join(', ') : ''}; its tracks get palette colours)`);
  T.ok(realErrors(errors).length === 0, 'no page errors (url colours)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}
{
  // a well-formed link holding a wrong-shaped song (tracks: [null]): the studio starts, and opens it as far as it goes
  const { page, errors, close } = await open('/app/' + await linkOf({ title: 'Odd', tracks: [null, { clips: [null], inserts: 5 }], sections: {} }));
  const st = await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 }).then(() => page.evaluate(() => ({ listening: !!window.overdub?.share?.listening, tracks: window.overdub.store.get().tracks.length, title: window.overdub.store.get().title })), () => page.evaluate(() => ({ body: document.body.textContent.slice(0, 160) })));
  T.ok(st.listening && st.tracks === 1 && st.title === 'Odd', `a link with tracks: [null] opens instead of stopping the studio (${JSON.stringify(st)})`);
  T.ok(realErrors(errors).length === 0, 'no page errors (wrong-shaped link)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}

{
  // your own saved song survives a link: New song while listening keeps yours (not theirs) as the previous song, and
  // after Make it yours a New song and a demo later, the Song menu still brings it back
  const hash = link.slice(link.indexOf('#'));
  const { page, errors, close } = await open('/app/', { query: 'new' });
  await ready(page);
  const store = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null')?.title ?? null, k);
  await page.evaluate(() => window.overdub.store.dispatch({ type: 'project.set', patch: { title: 'MY OWN SONG' } }, { by: 'you' }));
  await page.waitForTimeout(800);
  await page.evaluate((h) => window.overdub.share.open(h), hash);
  const listening = await page.evaluate(() => [window.overdub.share.listening, window.overdub.store.get().title]);
  await page.evaluate(() => window.overdub.exporter.newSong());
  await page.waitForTimeout(900);
  const a = { listening, project: await store('overdub:project'), previous: await store('overdub:previous') };
  T.ok(a.listening[0] && a.listening[1] === 'Shared Reel' && a.project === 'Untitled' && a.previous === 'MY OWN SONG', `New song while listening keeps your song, not theirs: previous "${a.previous}", saved "${a.project}"`);
  // back to it, then Make it yours, then New song and a demo
  await page.evaluate(() => window.overdub.store.load(JSON.parse(localStorage.getItem('overdub:previous')), { by: 'you' }));
  await page.waitForTimeout(800);
  await page.evaluate((h) => window.overdub.share.open(h), hash);
  const forkToast = await page.evaluate(() => { window.overdub.share.fork(); return [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).find((t) => /is yours/.test(t)) || ''; });
  await page.evaluate(async () => { await window.overdub.exporter.newSong(); await window.overdub.exporter.openDemo('lido'); });
  await page.waitForTimeout(900);
  const b = { project: await store('overdub:project'), previous: await store('overdub:previous'), kept: await store('overdub:before-fork') };
  T.ok(/“MY OWN SONG” stays in the Song menu/.test(forkToast) && b.project === 'Lido' && b.previous === 'Untitled' && b.kept === 'MY OWN SONG', `Make it yours keeps your song apart: after New song and a demo, previous "${b.previous}", before the fork "${b.kept}" (${forkToast.slice(0, 90)}…)`);
  const menu = async () => { const t = await page.evaluate(async () => { document.querySelector('.sm-btn')?.click(); await new Promise((r) => setTimeout(r, 200)); return document.querySelector('.sm-before-fork')?.textContent || ''; }); return t; };
  const item = await menu();
  await page.evaluate(() => document.querySelector('.sm-before-fork')?.click());
  await page.waitForTimeout(900);
  const c = { title: await page.evaluate(() => window.overdub.store.get().title), project: await store('overdub:project'), previous: await store('overdub:previous') };
  const again = await menu();
  await page.keyboard.press('Escape');
  T.ok(/Back to “MY OWN SONG”/.test(item) && c.title === 'MY OWN SONG' && c.project === 'MY OWN SONG' && c.previous === 'Lido' && !again, `the Song menu brings it back ("${item}"), keeps the demo as the previous song, and the entry goes`);
  // the landing page's demo links (/app/?demo=lido) open over your saved song: it's kept (in Recent songs too), and the
  // toast's Undo brings it back
  const base = page.url().replace(/\/app\/.*$/, '');
  await page.goto(base + '/app/?demo=lido', { waitUntil: 'load' });
  await ready(page);
  const d = await page.evaluate(async () => {
    const app = window.overdub, toast = [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).find((t) => /is in Recent songs/.test(t)) || '';
    const tr = app.store.get().tracks[0];
    app.store.dispatch({ type: 'track.set', track: tr.id, patch: { gain: tr.gain - 3 } }, { by: 'you' });
    await new Promise((r) => setTimeout(r, 900));
    const ls = (k) => JSON.parse(localStorage.getItem(k) || 'null')?.title ?? null;
    return { title: app.store.get().title, toast, project: ls('overdub:project'), previous: ls('overdub:previous') };
  });
  await page.evaluate(() => [...document.querySelectorAll('.ew-toast')].find((t) => /is in Recent songs/.test(t.textContent))?.querySelector('button')?.click());
  await page.waitForTimeout(900);
  const u = await page.evaluate(() => ({ title: window.overdub.store.get().title, project: JSON.parse(localStorage.getItem('overdub:project') || 'null')?.title }));
  T.ok(d.title === 'Lido' && /^Opened the demo, “Lido”\. “MY OWN SONG” is in Recent songs, and Undo brings it back\./.test(d.toast) && d.project === 'Lido' && d.previous === 'MY OWN SONG' && u.title === 'MY OWN SONG' && u.project === 'MY OWN SONG',
    `/app/?demo=lido over a saved song keeps it ("${d.toast.replace(/Undo$/, '')}"; after a fader move, previous "${d.previous}"), and Undo brings it back ("${u.title}")`);
  T.ok(realErrors(errors).length === 0, 'no page errors (your song)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}

/* ================================================================ 3. code in a song: asked before it runs */
// A song's devices are kernels: code from whoever made the song. One this browser doesn't trust is held (not registered,
// an instrument silent and an effect bypassed, never compiled, checked or rendered) until the person presses Play them;
// Keep them off leaves it held and the song asks again the next time it opens; Play them trusts that code here
// (localStorage overdub:trusted-kernels, by SHA-256) and starts it with no reload. Each kernel below carries a mark,
// and a script in the page writes down every mark that reaches the audio thread (an AudioWorkletNode's options, a
// message to one, a worklet module), so a check can say none of their code ran.
console.log('code in a song: asked before it runs');
const MARK_INST = `/*MARK-INST*/({ poly: 4, create({ sr }) { return { voice() { let ph = 0, f = 0, g = 0, on = false; return { start(p, v) { f = 440 * Math.pow(2, (p - 69) / 12) / sr; g = 0.25 * v; on = true; }, release() { on = false; }, render(L, R, n) { if (!on) return false; for (let i = 0; i < n; i++) { ph += f; const y = Math.sin(2 * Math.PI * ph) * g; L[i] += y; R[i] += y; } return true; } }; } }; } })`;
const MARK_FX = `/*MARK-FX*/({ create() { return { process(L, R, n) { for (let i = 0; i < n; i++) { L[i] *= 0.5; R[i] *= 0.5; } } }; } })`;
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
// Night Shift (its own three devices are the studio's code) with two devices Sam wrote: an instrument on the Keys and
// an effect that halves the level, alone on the Hook (no master chain, and the Hook well under the soft clip, so the
// effect measures as exactly what it does)
function heldSong() {
  const p = demoProject();
  p.title = 'Late Bus';
  p.master.inserts = [];
  const keys = p.tracks.find((t) => t.name === 'Keys');
  keys.instrument = { device: 'sam.tin-whistle', params: {} };
  keys.inserts = [];   // (Night Bus hisses like the cassette it is: the Keys' meter is the instrument alone)
  const hook = p.tracks.find((t) => t.name === 'Hook');
  hook.gain = -6;
  hook.inserts = [{ id: 'fx_half01', device: 'sam.half-measure', on: true, params: {}, by: 'you' }];
  p.devices['sam.tin-whistle'] = { id: 'sam.tin-whistle', name: 'Tin Whistle', kind: 'instrument', cat: 'synth', blurb: 'a sine on a bus', params: [], kernel: MARK_INST, by: 'you', version: 1 };
  p.devices['sam.half-measure'] = { id: 'sam.half-measure', name: 'Half Measure', kind: 'effect', cat: 'utility', blurb: 'half the level', params: [], kernel: MARK_FX, by: 'you', version: 1 };
  return p;
}
const WATCH = () => {
  const seen = window.__kernels = [];
  const note = (x) => { try { const s = typeof x === 'string' ? x : JSON.stringify(x); const m = s && s.match(/MARK-[A-Z]+/g); if (m) seen.push(...m); } catch (e) { /* not a kernel */ } };
  const AWN = window.AudioWorkletNode;
  if (AWN) window.AudioWorkletNode = class extends AWN { constructor(c, name, o) { note(o && o.processorOptions); super(c, name, o); } };
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) { note(m); return post.call(this, m, ...rest); };
  if (window.Worklet) { const add = Worklet.prototype.addModule; Worklet.prototype.addModule = function (url, ...rest) { note(String(url)); return add.call(this, url, ...rest); }; }
};
// what the studio does with the song on screen: what's held, what's registered, the Keys' meter on a live note, and the
// Hook rendered with its effect against the same song with no effect on it at all (a scratch copy)
const probe = (page) => page.evaluate(async () => {
  const app = window.overdub, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const M = await import('/app/src/audio/measure.js'), { renderProject } = await import('/app/src/engine/render.js');
  const p = app.store.get(), keys = p.tracks.find((t) => t.name === 'Keys').id, hook = p.tracks.find((t) => t.name === 'Hook').id;
  await app.engine.start(); await app.engine.settled();
  app.engine.liveNoteOn(keys, 64, 0.9);
  let peak = -200;
  for (let i = 0; i < 12; i++) { await sleep(50); peak = Math.max(peak, app.engine.meters.tracks[keys]?.peak ?? -200); }
  app.engine.liveNoteOff(keys, 64);
  const inst = app.engine.instance(keys, 'instrument');
  const fx = app.engine.instance(hook, 'fx_half01');
  const lufs = async (o) => M.measure(await app.engine.render({ tail: 0.5, ...o })).lufs;
  const dryP = JSON.parse(JSON.stringify(p)); dryP.tracks.find((t) => t.id === hook).inserts = [];
  const dry = M.measure(await renderProject(dryP, { from: 16, to: 24, tracks: [hook], tail: 0.5, assets: app.engine.assets })).lufs;
  return {
    held: (app.trust?.held?.() || []).map((d) => d.id).sort(), reg: ['sam.tin-whistle', 'sam.half-measure'].map((id) => app.devices.getDevice(id)?.source || null),
    inst: inst ? (inst.held || (inst.fallback ? 'fallback' : 'kernel')) : null, fx: fx ? (fx.held || (fx.fallback ? 'fallback' : 'kernel')) : null,
    peak, keys: await lufs({ from: 16, to: 24, tracks: [keys] }), hook: await lufs({ from: 16, to: 24, tracks: [hook] }), dry,
    sent: [...new Set(window.__kernels || [])].sort(), ask: document.querySelector('.sh-held')?.textContent || '', off: document.querySelector('.sh-held-off')?.textContent || '',
  };
});
const tap = async (page, sel) => { const el = await page.$(sel); if (!el) return false; await el.click(); await page.waitForTimeout(250); return true; };
const LINK_HASH = (await S.encodeShare(heldSong(), { from: { name: 'Sam' } })).hash;
{
  // the trusted set in Node: SHA-256 as node:crypto has it, a migration that runs once, the studio's own code trusted
  // without being stored, and what a song holds
  const tr = await import('../app/src/devices/trust.js').catch(() => null);
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
  if (!tr) T.ok(false, 'devices/trust.js is there');
  else {
    const texts = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(119), 'Café ☕ 東京 🎹', MARK_INST, 'x'.repeat(256 * 1024)];
    T.ok(texts.every((s) => tr.sha256(s) === sha(s)), `sha256 is SHA-256 of the UTF-8 text, as node:crypto has it (${texts.length} texts, 0 to 256 KB)`);
    const st = mem();
    const t1 = tr.createTrust({ storage: st, shipped: () => ['SHIPPED'] });
    const m1 = t1.migrate([{ devices: { a: { kernel: 'KERNEL-1' } } }, null, { devices: [] }]);
    const t2 = tr.createTrust({ storage: st, shipped: () => ['SHIPPED'] });
    const m2 = t2.migrate([{ devices: { b: { kernel: 'KERNEL-2' } } }]);
    const kept = JSON.parse(st.getItem(tr.TRUST_KEY)).sha256;
    T.ok(m1.ran && m1.added === 1 && !m2.ran && t2.trusts('KERNEL-1') && !t2.trusts('KERNEL-2') && t2.trusts('SHIPPED') && same(kept, [sha('KERNEL-1')]),
      `the migration runs once (then ${m2.ran ? 'again' : 'never again'}); the studio's own code is trusted without being stored; stored: { sha256: [${kept.length}] }`);
    t2.allow(['KERNEL-2', sha('KERNEL-3')]);
    const song = { tracks: [{ id: 't_a', name: 'A', instrument: { device: 'x.inst' }, inserts: [{ id: 'fx_1', device: 'x.fx' }] }], master: { inserts: [{ id: 'fx_2', device: 'x.fx' }] },
      devices: { 'x.inst': { id: 'x.inst', name: 'Inst', kind: 'instrument', kernel: 'KERNEL-2', by: 'guest:sam' }, 'x.fx': { id: 'x.fx', name: 'Fx', kind: 'effect', kernel: 'KERNEL-4', by: 'claude', via: 'guest:sam' } } };
    const held = tr.heldIn(song, (h) => tr.createTrust({ storage: st }).has(h));
    T.ok(held.length === 1 && held[0].id === 'x.fx' && held[0].hash === sha('KERNEL-4') && held[0].via === 'guest:sam' && same(held[0].uses.map((u) => u.track), ['A', 'Master']) && tr.createTrust({ storage: st }).trusts('KERNEL-3'),
      'allow stores a kernel or a hash; heldIn lists what a song brings that isn\'t trusted, with where it plays');
  }
}
{
  const { page, base, errors, close, shot } = await open('/app/', { query: 'new' });
  await ready(page);
  await page.addInitScript(WATCH);
  // (a fresh document, so the watch is in place before anything loads: from /app/ the link alone would be a hash change)
  await page.goto('about:blank');
  await page.goto(base + '/app/' + LINK_HASH, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(400);
  // 1. a link with two devices the sender wrote: both held, and the banner asks, naming them and who wrote them
  const a = await probe(page);
  a.watching = await page.evaluate(() => Array.isArray(window.__kernels));
  const banner = await page.evaluate(() => ({ text: document.querySelector('.sh-held .sh-held-text')?.textContent || '', who: [...document.querySelectorAll('.sh-held .by')].map((e) => [e.textContent, e.className]), play: document.querySelector('.sh-play')?.textContent, off: document.querySelector('.sh-off')?.textContent }));
  T.ok(a.watching && same(a.held, ['sam.half-measure', 'sam.tin-whistle']) && same(a.reg, [null, null]) && a.inst === 'sam.tin-whistle' && a.fx === 'sam.half-measure' && !a.sent.includes('MARK-INST') && !a.sent.includes('MARK-FX'),
    `a link with two devices Sam wrote opens with both held: not registered, played by stand-ins (${a.inst}, ${a.fx}), and no code of theirs reached the audio thread (marks seen: ${a.sent.join(', ') || 'none'})`);
  T.ok(a.peak < -90 && a.keys < -70 && Math.abs(a.hook - a.dry) < 0.05,
    `held, the instrument is silent (a live note: ${a.peak.toFixed(0)} dBFS on the meter; ${a.keys.toFixed(0)} LUFS rendered) and the effect lets the sound through untouched (the Hook ${a.hook.toFixed(2)} LUFS, with no effect at all ${a.dry.toFixed(2)})`);
  T.ok(/^This song brings 2 devices Sam wrote: Tin Whistle and Half Measure\. /.test(banner.text) && banner.who.length >= 1 && banner.who.every(([n, c]) => n === 'Sam' && c === 'by by-human') && banner.play === 'Play them' && banner.off === 'Keep them off',
    `the banner names them and who wrote them (Sam, in warm ink): "${banner.text}" [${banner.play}] [${banner.off}]`);
  // an honest first listen (FRESH-EYES round 5): the ask says they're off now and what that means, what letting code
  // run means, and that Play them is for good, in any song, before the click; Play them is the strip's one primary
  T.ok(/ They’re off now: Tin Whistle is silent and Half Measure lets the sound through untouched\. /.test(banner.text) && / Each is a small program that runs on this computer\. Play them if you trust Sam: that code then runs from now on, in this browser, in any song\.$/.test(banner.text),
    `the ask says they're off now, what a device is, and what Play them does before the click ("…${banner.text.slice(banner.text.indexOf('They’re off'))}")`);
  const keys = await page.evaluate(() => {
    const t = window.overdub.store.get().tracks.find((x) => x.name === 'Keys'), b = (s) => document.querySelector(s);
    return { id: t.id, clips: t.clips.map((c) => c.id), play: b('.sh-play')?.className || '', fork: b('.sh-fork')?.className || '', primaries: [...document.querySelectorAll('.sh-banner .ew-btn-primary')].map((x) => x.textContent.trim()) };
  });
  T.ok(/ew-btn-primary/.test(keys.play) && !/ew-btn-primary/.test(keys.fork) && same(keys.primaries, ['Play them']), `while the question is open Play them is the strip's one primary (primaries: ${JSON.stringify(keys.primaries)})`);
  // the silent track says so on its lane, not only in its header: each clip on the Keys (Tin Whistle, kept off) prints
  // "kept off" where its byline goes, and reads so aloud
  await page.evaluate(() => { const ar = window.overdub.arranger; ar.reveal?.(0); });
  await page.waitForTimeout(250);
  const labels = await page.evaluate((k) => {
    const app = window.overdub;
    app.ui.select({ track: k.id, clip: null, notes: [], range: null });
    document.querySelector('.ar-scroll').focus();
    return k.clips.map((id) => app.arranger.clipLabel?.(id));
  }, keys);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const lane = { labels, said: await page.evaluate(() => document.querySelector('.ar p.sr-only[aria-live]')?.textContent || '') };
  const drawn = lane.labels.filter((x) => x !== undefined);   // (undefined: off screen, never drawn)
  T.ok(drawn.length && drawn.every((x) => x === 'kept off') && /kept off: its instrument is silent until you play it/.test(lane.said), `the Keys' clips say "kept off" on the lane itself (${JSON.stringify(lane.labels)}), and aloud ("${lane.said}")`);
  await shot('share-held-ask');
  // 2. Keep them off: still held, still silent, and the banner says what's off; the same link opened again asks again
  await tap(page, '.sh-off');
  const b = await probe(page);
  T.ok(same(b.held, ['sam.half-measure', 'sam.tin-whistle']) && same(b.reg, [null, null]) && b.peak < -90 && Math.abs(b.hook - b.dry) < 0.05 && !b.sent.includes('MARK-INST') && !b.sent.includes('MARK-FX') && !b.ask.includes('Play them') && /^Kept off: Tin Whistle and Half Measure\. The Devices tab can play them\.$/.test(b.off),
    `Keep them off keeps them held and silent ("${b.off}")`);
  const answered = await page.evaluate(() => [...document.querySelectorAll('.sh-banner .ew-btn-primary')].map((x) => x.textContent.trim()));
  T.ok(same(answered, ['Make it yours']), `answered, Make it yours is the strip's primary again (${JSON.stringify(answered)})`);
  await page.reload();
  await ready(page);
  await page.waitForTimeout(300);
  const again = await page.evaluate(() => ({ ask: !!document.querySelector('.sh-play'), held: (window.overdub.trust?.held?.() || []).length }));
  T.ok(again.ask && again.held === 2, 'and the next time the song opens (the same link, reloaded), it asks again');
  // Make it yours keeps what was decided: kept off, they stay off (no ask), and the song is yours with them in it
  await tap(page, '.sh-off');
  await tap(page, '.sh-fork');
  await page.waitForTimeout(600);
  const k = await page.evaluate(() => ({ listening: window.overdub.share.listening, banner: !!document.querySelector('.sh-banner'), held: (window.overdub.trust?.held?.() || []).map((d) => d.id).sort(), saved: Object.keys(JSON.parse(localStorage.getItem('overdub:project') || '{}').devices || {}) }));
  T.ok(!k.listening && !k.banner && same(k.held, ['sam.half-measure', 'sam.tin-whistle']) && k.saved.includes('sam.tin-whistle'), `Make it yours keeps what was decided: kept off, still held (${k.held.join(', ')}) and nothing asks; the song is saved with them`);
  // reopened (now the saved song): it asks, in the banner's place
  await page.reload();
  await ready(page);
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => ({ strip: document.querySelector('.sh-banner.sh-ask .sh-held-text')?.textContent || '', listening: window.overdub.share.listening }));
  T.ok(!c.listening && /^This song brings 2 devices Sam wrote: Tin Whistle and Half Measure\./.test(c.strip), `the saved song asks again when it opens: "${c.strip.slice(0, 80)}…"`);
  await shot('share-held-saved');
  // 3. Play them: they play, with no reload, and the code is trusted here from now on
  await page.evaluate(() => { window.__same = 1; });
  const pressed = await tap(page, '.sh-play');
  // the track header names the device it plays now, not its id (it printed "tin-whistle" until something redrew)
  const named = await page.evaluate(() => { const t = window.overdub.store.get().tracks.find((x) => x.name === 'Keys'); return document.querySelector(`.ar-head[data-track="${t.id}"] .ar-hdev`)?.textContent || ''; });
  T.ok(named === 'Tin Whistle', `after Play them the Keys header names its device at once ("${named}")`);
  const d = await probe(page);
  const stay = await page.evaluate(() => ({ same: window.__same === 1, ask: !!document.querySelector('.sh-held'), toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).find((t) => /are on/.test(t)) || '' }));
  T.ok(pressed && stay.same && d.held.length === 0 && same(d.reg, ['project', 'project']) && d.inst === 'kernel' && d.peak > -60 && d.hook < d.dry - 5.5 && d.hook > d.dry - 6.5 && d.sent.includes('MARK-INST') && d.sent.includes('MARK-FX') && !stay.ask
    && /^Tin Whistle and Half Measure are on\. This browser runs that code from now on, in any song\.$/.test(stay.toast),
    `Play them${pressed ? '' : ' (not there to press)'} makes them play without a reload: a live note on the Keys meters ${d.peak.toFixed(0)} dBFS, the Hook is ${(d.hook - d.dry).toFixed(2)} dB under no effect at all, and their code is on the audio thread now (${d.sent.join(', ')}) ("${stay.toast}")`);
  // the same link again (a fresh load): nothing asks, and they play
  await page.goto('about:blank');
  await page.goto(base + '/app/' + LINK_HASH, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(400);
  const e = await probe(page);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('overdub:trusted-kernels') || '{}').sha256 || []);
  T.ok(e.held.length === 0 && same(e.reg, ['project', 'project']) && !e.ask && e.peak > -60 && stored.includes(sha(MARK_INST)) && stored.includes(sha(MARK_FX)) && realErrors(errors).length === 0,
    `reopening the same link doesn't ask again: nothing held, the Keys meter ${e.peak.toFixed(0)} dBFS, and both kernels' SHA-256 are in overdub:trusted-kernels (${stored.length} stored); no page errors${realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''}`);
  await close();
}
{
  // a song sent back: the ask names who made the device and whose link it came through ("Sam wrote, via Jo's link"),
  // and Play it is for trusting the one who sent it (Jo)
  const { page, errors, close } = await open('/app/' + sentBack);
  await ready(page);
  await page.waitForSelector('.sh-held', { timeout: 5000 }).catch(() => {});
  const ask = await page.evaluate(() => ({ text: document.querySelector('.sh-held .sh-held-text')?.textContent || '', by: [...document.querySelectorAll('.sh-held .by')].map((b) => b.textContent) }));
  T.ok(/^This song brings an instrument Sam wrote, via Jo’s link: Tape Organ\. /.test(ask.text) && /Play it if you trust Jo: /.test(ask.text) && same(ask.by, ['Sam', 'Jo', 'Jo']),
    `a device that came through someone else's link says so: "${ask.text.slice(0, 120)}…" (bylines ${ask.by.join(', ')})`);
  // kept off, Devices' note on the Keys says whose link brought it, and so does the browser's row
  await page.evaluate(() => { const o = window.overdub, t = o.store.get().tracks.find((x) => x.name === 'Keys'); o.ui.select({ track: t.id, insert: null }); o.ui.show('rack'); });
  await page.waitForTimeout(400);
  const kept = await page.evaluate(() => { const n = document.querySelector('[data-panel="rack"] .rk-held'), r = document.querySelector('.br-row.br-held[data-device="sam.tape-organ"]'); return { note: n?.textContent || '', by: [...(n?.querySelectorAll('.by') || [])].map((b) => b.textContent), row: r?.title || '' }; });
  T.ok(/Sam wrote it; it came via Jo’s link\. It’s code/.test(kept.note) && same(kept.by, ['Sam', 'Jo']) && /^Tape Organ: kept off\. It came with the song, by Sam via Jo, /.test(kept.row),
    `kept off, Devices says "${kept.note.replace(/^Kept off/, '').split(' It’s')[0]}" (bylines ${kept.by.join(', ')}) and the browser's row "${kept.row}"`);
  // played, its track says who made it and whose link it came through
  await page.click('.sh-play').catch(() => {});
  await page.waitForTimeout(300);
  const head = await page.evaluate(() => { const t = window.overdub.store.get().tracks.find((x) => x.name === 'Keys'), r = document.querySelector(`.ar-head[data-track="${t.id}"]`); return { sub: r?.querySelector('.ar-hsub')?.textContent || '', title: r?.querySelector('.ar-hdev')?.title || '' }; });
  T.ok(/^Tape Organ, by Sam via Jo$/.test(head.sub) && /^Tape Organ, made by Sam, via Jo’s link\. /.test(head.title) && !realErrors(errors).length, `and its track header credits it the same way ("${head.sub}"; "${head.title}")`);
  // ... as do the browser's row (Written in this song) and the device's About card in Devices ("Made by Sam via Jo")
  await page.waitForTimeout(300);
  const row = await page.evaluate(() => { const r = document.querySelector('.br-row[data-device="sam.tape-organ"]:not(.br-held)'), c = r?.querySelector('.br-by'); return { text: c?.textContent || '', by: [...(c?.querySelectorAll('.by') || [])].map((b) => b.textContent), title: c?.title || '' }; });
  await page.click('[data-panel="rack"] button.rk-ib[aria-label="About Tape Organ"]').catch(() => {});
  await page.waitForTimeout(250);
  const info = await page.evaluate(() => { const dt = [...document.querySelectorAll('.rk-info dt')].find((x) => x.textContent === 'Made by'), dd = dt?.nextElementSibling; return { text: dd?.textContent || '', by: [...(dd?.querySelectorAll('.by') || [])].map((b) => b.textContent), title: dd?.title || '' }; });
  await page.keyboard.press('Escape');
  T.ok(row.text === 'Sam via Jo' && same(row.by, ['Sam', 'Jo']) && /^Written by Sam, via Jo’s link$/.test(row.title), `the browser's row reads "${row.text}" ("${row.title}")`);
  T.ok(info.text === 'Sam via Jo' && same(info.by, ['Sam', 'Jo']) && /^Made by Sam, via Jo’s link$/.test(info.title), `the device's About card: Made by "${info.text}" ("${info.title}")`);
  await close();
}
{
  // a phone (FRESH-EYES round 5): the banner, the ask and a resumed tour left no timeline at all. With the question
  // open the timeline is still in view; answered, the banner is one line; at 390 x 844 and 390 x 664
  for (const [w, hgt] of [[390, 844], [390, 664]]) {
    const { page, base, errors, close, shot } = await open('/app/', { width: w, height: hgt });
    await ready(page);
    // (the welcome card was seen before: this checks the strip and the lanes)
    await page.evaluate(() => { localStorage.setItem('overdub:welcomed', '1'); });
    await page.goto('about:blank');
    await page.goto(base + '/app/' + LINK_HASH, { waitUntil: 'load' });
    await ready(page);
    await page.waitForTimeout(500);
    const room = () => page.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect() || null;
      const banner = r('.sh-banner'), lanes = r('.ar-lanewrap'), sheet = r('.ew-region-bottom'), line = r('.sh-b-line');
      // the lanes on screen: under the banner and the ruler, over the bottom sheet
      const top = Math.max(lanes?.top ?? 0, banner?.bottom ?? 0), bottom = Math.min(lanes?.bottom ?? 0, sheet?.top ?? innerHeight, innerHeight);
      const ob = document.querySelector('.ob:not(.out)');
      return { banner: Math.round(banner?.height || 0), line: Math.round(line?.height || 0), lanes: Math.max(0, Math.round(bottom - top)), track: window.overdub.ui.state.zoom.trackH, wide: document.documentElement.scrollWidth, tour: !!ob, play: !!document.querySelector('.sh-play'), fork: !!document.querySelector('.sh-fork')?.getClientRects().length, back: !!document.querySelector('.sh-leave')?.getClientRects().length };
    });
    const q = await room();
    await shot(`share-phone-ask-${w}x${hgt}`);
    T.ok(q.play && q.lanes >= 40 && q.wide <= w && !q.tour, `${w}x${hgt}, the question open: the ask and the timeline both in view (${q.lanes} px of lanes under a ${q.banner} px strip: the question alone)`);
    await page.click('.sh-off').catch(() => {});
    await page.waitForTimeout(300);
    const a = await room();
    await shot(`share-phone-answered-${w}x${hgt}`);
    T.ok(a.banner <= 56 && a.line <= 24 && a.fork && a.back && a.lanes >= a.track && a.wide <= w && !realErrors(errors).length, `${w}x${hgt}, answered: the banner is one line (${a.banner} px: the play key, the title, Make it yours, Back) and the lanes show ${a.lanes} px, a whole track (${a.track} px) or more`);
    await close();
  }
}
{
  // 4. a song file opened from disk asks the same way: Open (the Song menu's file picker), and a file dropped on the
  // studio. A file's signatures are only its own word, so the ask names no author for them
  const text = JSON.stringify(heldSong());
  const { page, base, errors, close, shot } = await open('/app/', { query: 'new' });
  await ready(page);
  await page.addInitScript(WATCH);
  await page.goto('about:blank');
  await page.goto(base + '/app/', { waitUntil: 'load' });
  await ready(page);
  const picked = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.evaluate(() => window.overdub.exporter.openFile())]).then(([fc]) => fc).catch(() => null);
  if (picked) await picked.setFiles({ name: 'late-bus.overdub.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.waitForFunction(() => window.overdub.store.get().title === 'Late Bus', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const f = await probe(page);
  const strip = await page.evaluate(() => ({ text: document.querySelector('.sh-banner.sh-ask .sh-held-text')?.textContent || '', play: document.querySelector('.sh-ask .sh-play')?.textContent, off: document.querySelector('.sh-ask .sh-off')?.textContent, label: document.querySelector('.sh-banner')?.getAttribute('aria-label'), watching: Array.isArray(window.__kernels) }));
  T.ok(strip.watching && f.held.length === 2 && same(f.reg, [null, null]) && f.peak < -90 && Math.abs(f.hook - f.dry) < 0.05 && !f.sent.includes('MARK-INST') && !f.sent.includes('MARK-FX')
    && /^This file brings 2 devices: Tin Whistle and Half Measure\. They’re off now: Tin Whistle is silent and Half Measure lets the sound through untouched\. Each is a small program that runs on this computer\. Play them if you trust whoever gave you the file: that code then runs from now on, in this browser, in any song\.$/.test(strip.text) && strip.play === 'Play them' && strip.off === 'Keep them off',
    `a song file opened from disk holds them and asks in the banner's place: "${strip.text}" [${strip.play}] [${strip.off}]`);
  await shot('share-held-file');
  // kept off, then the same file dropped on the studio: it asks again
  await tap(page, '.sh-off');
  const gone = await page.evaluate(() => !document.querySelector('.sh-banner'));
  await page.evaluate(async () => { await window.overdub.exporter.newSong(); });
  await page.waitForTimeout(300);
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.items.add(new File([t], 'late-bus.overdub.json', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, text);
  await page.waitForFunction(() => window.overdub.store.get().title === 'Late Bus', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const g = await page.evaluate(() => ({ text: document.querySelector('.sh-banner.sh-ask .sh-held-text')?.textContent || '', held: (window.overdub.trust?.held?.() || []).length, sent: [...new Set(window.__kernels || [])] }));
  T.ok(gone && g.held === 2 && /^This file brings 2 devices/.test(g.text) && !g.sent.includes('MARK-INST') && !g.sent.includes('MARK-FX') && realErrors(errors).length === 0,
    `Keep them off takes the ask away; the same file dropped on the studio asks again ("${g.text.slice(0, 60)}…"); no page errors${realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''}`);
  await close();
}
{
  // 5. the first run of this version: the songs this browser kept were already running, so their devices are trusted,
  // once. A song saved after that with a device it never allowed is held when it opens
  const mig = (id, mark) => {
    const p = demoProject();
    p.title = `Mine ${id}`; p.id = `p_mig${id}`;
    p.tracks.find((t) => t.name === 'Hook').inserts = [{ id: 'fx_mig01', device: `you.${id}`, on: true, params: {}, by: 'you' }];
    p.devices[`you.${id}`] = { id: `you.${id}`, name: `Old ${id}`, kind: 'effect', params: [], kernel: `/*MARK-${mark}*/` + MARK_FX.slice('/*MARK-FX*/'.length), by: 'you', version: 1 };
    return p;
  };
  const { page, base, errors, close } = await open('/app/', { query: 'new' });
  await ready(page);
  await page.evaluate(([saved, recent]) => {
    localStorage.removeItem('overdub:trusted-kernels');   // (as before this version: no trusted set yet)
    localStorage.setItem('overdub:project', JSON.stringify(saved));
    localStorage.setItem('overdub:recent', JSON.stringify([{ id: recent.id, title: recent.title, at: Date.now(), tracks: recent.tracks.length, song: recent }]));
    localStorage.setItem('overdub:me', 'meTEST0001');      // this browser's secret: the links it made carry its mark
  }, [mig('mig', 'MIG'), mig('rec', 'REC')]);
  await page.goto(base + '/app/', { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(300);
  const m1 = await page.evaluate(() => ({ title: window.overdub.store.get().title, held: (window.overdub.trust?.held?.() || []).map((d) => d.id), reg: window.overdub.devices.getDevice('you.mig')?.source || null, ask: !!document.querySelector('.sh-held'), stored: JSON.parse(localStorage.getItem('overdub:trusted-kernels') || '{}').sha256 || null }));
  T.ok(m1.title === 'Mine mig' && !m1.held.length && m1.reg === 'project' && !m1.ask && Array.isArray(m1.stored) && m1.stored.includes(sha(mig('mig', 'MIG').devices['you.mig'].kernel)) && m1.stored.includes(sha(mig('rec', 'REC').devices['you.rec'].kernel)),
    `the one-time migration trusts the devices of the song saved before this version (and of Recent songs): ${m1.reg ? 'it plays' : 'held'}, nothing asks, ${m1.stored ? m1.stored.length : 'no'} kernels stored`);
  // a song saved later, with a device this browser never allowed: held (the migration doesn't run twice)
  await page.evaluate((s) => localStorage.setItem('overdub:project', JSON.stringify(s)), mig('new', 'NEW'));
  await page.goto(base + '/app/', { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(() => ({ title: window.overdub.store.get().title, held: (window.overdub.trust?.held?.() || []).map((d) => d.id), reg: window.overdub.devices.getDevice('you.new')?.source || null, ask: document.querySelector('.sh-held-text')?.textContent || '' }));
  T.ok(m2.title === 'Mine new' && same(m2.held, ['you.new']) && m2.reg === null && /^This song brings an effect: Old new\. It’s off now, so the sound passes through it untouched\. It’s a small program that runs on this computer\. Play it if you trust whoever wrote it: that code then runs from now on, in this browser, in any song\.$/.test(m2.ask),
    `it runs once: a song saved after it, with a device never allowed here, is held and asks ("${m2.ask}")`);
  // a link this browser made itself opens as yours: one made before the trusted set began (its moment is in its mark)
  // was made while every device ran here, so its devices play; one made since gets no pass (sharing a song to yourself
  // can't let held code play)
  const before = (await S.encodeShare(mig('olk', 'OLDLINK'), { from: { name: 'Me', me: 'meTEST0001' }, at: '2026-09-01T00:00:00.000Z' })).hash;
  const after = (await S.encodeShare(mig('nlk', 'NEWLINK'), { from: { name: 'Me', me: 'meTEST0001' }, at: new Date(Date.now() + 3600e3).toISOString() })).hash;
  await page.goto('about:blank');
  await page.goto(base + '/app/' + before, { waitUntil: 'load' });
  await ready(page);
  await page.waitForTimeout(300);
  const o1 = await page.evaluate(() => ({ own: !!window.overdub.share?.incoming?.own, held: (window.overdub.trust?.held?.() || []).map((d) => d.id), reg: window.overdub.devices.getDevice('you.olk')?.source || null, ask: !!document.querySelector('.sh-held') }));
  const o2 = await page.evaluate(async (h) => { await window.overdub.share.open(h); return { own: !!window.overdub.share.incoming?.own, held: (window.overdub.trust?.held?.() || []).map((d) => d.id), ask: document.querySelector('.sh-held-text')?.textContent || '' }; }, after);
  T.ok(o1.own && !o1.held.length && o1.reg === 'project' && !o1.ask && o2.own && same(o2.held, ['you.nlk']) && /^This song brings an effect: Old nlk\./.test(o2.ask) && realErrors(errors).length === 0,
    `a link this browser made before its trusted set began opens as yours, its device playing (${o1.reg}); one it made since holds a device it never allowed (${o2.held.join(', ') || 'none'}); no page errors${realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''}`);
  await close();
}

/* ================================================================ 4. Take one (the coach) */
console.log('Take one');
{
  const { page, errors, close, shot } = await open('/app/', { query: 'demo&fast' });
  await ready(page);
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => ({ webdriver: navigator.webdriver, active: window.overdub.onboard.active, started: window.overdub.onboard.start(), card: !!document.querySelector('.ob') }));
  T.ok(off.webdriver && !off.active && off.started === false && !off.card, 'under webdriver it never starts on its own, even when asked without force');
  const s0 = await page.evaluate(() => { window.overdub.onboard.start({ force: true, restart: true }); return { step: window.overdub.onboard.step, text: document.querySelector('.ob')?.textContent, welcome: !!document.querySelector('.ar-welcome:not(.out)') }; });
  T.ok(s0.step === 'listen' && /Hear it first/.test(s0.text) && /Space/.test(s0.text) && !s0.welcome, 'forced: step 1, "Hear it first", Space (and the arranger\'s welcome steps aside)');
  await shot('share-coach-1');
  // it never blocks: the arranger still takes clicks around it
  const blocks = await page.evaluate(() => { const ob = document.querySelector('.ob').getBoundingClientRect(), c = document.querySelector('.ew-region-center').getBoundingClientRect(); return (ob.width * ob.height) / (c.width * c.height); });
  T.ok(blocks < 0.25, `the card covers ${Math.round(blocks * 100)}% of the arranger`);

  // 1. hear it: the real transport
  await page.evaluate(async () => { const e = window.overdub.engine; try { await e.start(); } catch (x) { /* ok */ } e.play(0); });
  await page.waitForFunction(() => window.overdub.onboard.step === 'take', null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.overdub.engine.stop());
  const s1 = await page.evaluate(() => ({ step: window.overdub.onboard.step, text: document.querySelector('.ob')?.textContent }));
  T.ok(s1.step === 'take' && /Take one is yours/.test(s1.text) && /Hum it/.test(s1.text) && /Tap a beat/.test(s1.text) && /Play the keys/.test(s1.text), 'playing the song moves it on: "Take one is yours" (hum, tap or keys)');
  // the step listens for the real thing: Skip isn't needed; a tap of Space doesn't skip anything
  // 2. take one: a hum lands in the capture log
  await page.evaluate(() => window.overdub.input.capture.add({ src: 'hum', kind: 'notes', notes: [{ p: 69, t: 0, d: 1, v: 0.8 }, { p: 72, t: 1, d: 1, v: 0.8 }, { p: 76, t: 2, d: 0.5, v: 0.8 }, { p: 74, t: 2.5, d: 1.5, v: 0.8 }], tempo: 92 }));
  await page.waitForTimeout(100);
  const s2 = await page.evaluate(() => ({ step: window.overdub.onboard.step, text: document.querySelector('.ob')?.textContent }));
  T.ok(s2.step === 'keep' && /Take one is in: 4 notes, hummed/.test(s2.text), `a hum moves it on: "${(s2.text || '').match(/Take one is in[^.]*\./)?.[0]}"`);
  await shot('share-coach-3');
  // 3. keep it: Keep in Sketch (capture.keep is what the button calls)
  await page.evaluate(() => { const c = window.overdub.input.capture; window.overdub.input.capture.keep(c.latest().id, { newTrack: { device: 'core.keys' } }); });
  await page.waitForTimeout(100);
  const s3 = await page.evaluate(() => ({ step: window.overdub.onboard.step, text: document.querySelector('.ob')?.textContent, take: window.overdub.onboard.take, sel: window.overdub.ui.state.selection.clip }));
  T.ok(s3.step === 'ask' && /Your part is in the song/.test(s3.text) && /4 notes/.test(s3.text) && s3.take.clip && s3.sel === s3.take.clip, 'keeping it moves it on: "Your part is in the song", with take one selected for the agent');
  T.ok(/demo agent/.test(s3.text), 'no key here: it offers the demo agent');
  // 4. ask: the card's button sends the ask to the (demo) agent
  await page.click('.ob .ew-btn-agent');
  await page.waitForFunction(() => window.overdub.onboard.step === 'pick', null, { timeout: 20000 }).catch(() => {});
  const s4 = await page.evaluate(() => ({ step: window.overdub.onboard.step, text: document.querySelector('.ob')?.textContent, provider: window.overdub.agent.provider, reqs: [...window.overdub.tools.requests.values()].filter((r) => r.status === 'pending').map((r) => ({ id: r.id, cards: r.cards.map((c) => ({ i: c.index, o: !!c.original })) })) }));
  T.ok(s4.provider === 'mock' && s4.step === 'pick' && /Pick the one you like/.test(s4.text) && s4.reqs.length === 1, 'asking the demo agent moves it on when its takes are on screen: "Pick the one you like"');
  // FRESH-EYES-4 beginner #6: the card counts the takes it points at (it said "A and B" next to three)
  const nTakes = s4.reqs[0]?.cards.filter((c) => !c.o).length;
  T.ok(nTakes === 3 && /played three versions, A, B and C, over yours/.test(s4.text), `the pick card counts the takes on screen (${nTakes}): "${(s4.text || '').match(/The agent played[^.]*\./)?.[0]}"`);
  await shot('share-coach-5');
  // 5. keep one of its takes
  const pick = s4.reqs[0]?.cards.find((c) => !c.o);
  await page.evaluate(([id, i]) => window.overdub.tools.answer(id, i), [s4.reqs[0]?.id, pick?.i]);
  await page.waitForFunction(() => window.overdub.onboard.step === 'done', null, { timeout: 5000 }).catch(() => {});
  const s5 = await page.evaluate(() => ({ step: window.overdub.onboard.step, text: document.querySelector('.ob')?.textContent, state: window.overdub.onboard.state?.state, notes: (() => { const t = window.overdub.onboard.take; const c = window.overdub.store.clip(t.track, t.clip); return [...new Set(c.notes.map((n) => n.by))]; })() }));
  T.ok(s5.step === 'done' && /Claude played over you\./.test(s5.text) && /your 4 notes/.test(s5.text) && /Claude’s/.test(s5.text) && s5.state === 'done', `keeping a take: "${(s5.text || '').replace(/^.*?Claude played/, 'Claude played').slice(0, 140)}"`);
  T.ok(s5.notes.includes('you') && s5.notes.includes('claude'), `take one is warm, take two cool, on one clip (${s5.notes.join(', ')})`);
  await shot('share-coach-done');
  await page.click('.ob .ew-btn-primary');
  await page.waitForTimeout(300);
  T.ok(!(await page.$('.ob')) && !(await page.evaluate(() => window.overdub.onboard.active)), 'Done closes it, and it\'s remembered as done');
  // let the demo agent finish its turn before closing
  await page.waitForFunction(() => !window.overdub.agent.busy, null, { timeout: 20000 }).catch(() => {});
  T.ok(realErrors(errors).length === 0, 'no page errors (coach)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}
{
  // ?coach forces it; Skip moves on; the old cue cards come back where you left off; closing is remembered
  const { page, errors, close, shot } = await open('/app/', { query: 'demo&coach', width: 390, height: 844 });
  await ready(page);
  await page.waitForSelector('.ob', { timeout: 5000 });
  const a = await page.evaluate(() => ({ step: window.overdub.onboard.step, w: document.documentElement.scrollWidth, r: document.querySelector('.ob').getBoundingClientRect().right }));
  T.ok(a.step === 'listen' && a.w <= 390 && a.r <= 390, '?coach starts it under webdriver; at 390 px it fits');
  await shot('share-coach-390');
  await page.click('.ob-skip');
  const b = await page.evaluate(() => ({ step: window.overdub.onboard.step, saved: window.overdub.onboard.state }));
  T.ok(b.step === 'take' && b.saved.state === 'on' && b.saved.step === 'take', 'Skip moves to the next step, and where you are is remembered');
  await page.evaluate(() => { const o = window.overdub.onboard; o.stop(); });
  const c = await page.evaluate(() => ({ active: window.overdub.onboard.active, state: window.overdub.onboard.state.state, again: window.overdub.onboard.start() }));
  T.ok(!c.active && c.state === 'dismissed' && c.again === false, 'closing it is remembered: it won\'t start again on its own');
  await page.evaluate(() => localStorage.setItem('overdub:onboard', JSON.stringify({ state: 'on', step: 'keep' })));
  const d = await page.evaluate(() => { window.overdub.onboard.start({ force: true }); return window.overdub.onboard.step; });
  await page.evaluate(() => { window.overdub.onboard.stop(); localStorage.setItem('overdub:onboard', JSON.stringify({ state: 'on', step: 'ask' })); window.overdub.onboard.start({ force: true }); });
  const d2 = await page.evaluate(() => window.overdub.onboard.step);
  T.ok(d === 'keep' && d2 === 'take', `a tour left half-way resumes where it was (${d}); at "ask" with no take of yours in the song, it goes back to take one (${d2})`);
  // the Song menu can start it again
  await page.evaluate(() => window.overdub.onboard.stop());
  await page.click('.sm-btn');
  const has = await page.$$eval('.sm-i b', (els) => els.map((e) => e.textContent).includes('Take one'));
  T.ok(has, 'the Song menu has "Take one" to run it again');
  T.ok(realErrors(errors).length === 0, 'no page errors (coach, phone)' + (realErrors(errors).length ? ': ' + realErrors(errors).join(' | ') : ''));
  await close();
}

T.done();
process.exit(process.exitCode || 0);
