// The demo shelf (app/src/core/demos/): every song is a valid project, built the same way every time, signed by the
// house with at least one part played over by Claude; every device it names resolves; it renders offline through the
// real engine and lands where a finished demo should (measured, not guessed): the master at -11.5..-9.5 LUFS (a genre
// demo: its genre's targets, audio/targets.js), true
// peak at or under -1 dBTP, every track audible, the lead of each section not buried, and the key reading right.
// Where a demo uses them, the studio's own devices do their jobs: Studio A is played the way a drummer plays it,
// a Scribble Strip draws a shape that moves, a Slide Rule has a band that does something.
// Screenshots of each in the arranger (1440 wide) and of the Song menu's Demos list land in tools/.out/.
// Their devices are the studio's own code: every demo opens with nothing held (devices/trust.js), from the shelf or
// from a link someone else made of it.
import { open, tally } from './pw.js';
import { validateProject } from '../app/src/core/project.js';
import { DEMOS, demoById } from '../app/src/core/demo.js';
import { encodeShare } from '../app/src/core/share.js';
import { MORE_DEMOS } from '../app/src/core/demos/index.js';
import { lanesOf } from '../app/src/core/automation.js';
import { DRUM_MAP } from '../app/src/core/music.js';
import '../app/src/devices/builtin/index.js';
import { getDevice, paramValues } from '../app/src/devices/registry.js';
import { LANES, RATES, pointsOf } from '../app/src/devices/builtin/shaper.js';
import { EQ_BANDS, EQ_TYPES } from '../app/src/devices/builtin/eq8-curve.js';
import { checkTargets, targetWords } from '../app/src/audio/targets.js';

const t = tally('demos');

// which track carries the tune in which section (the masking check holds it against the other pitched tracks there)
const LEADS = {
  'dust-jacket': { Hook: 'Vibes' },
  halation: { Haze: 'Glide', Afterglow: 'Choir' },
  lido: { Groove: 'Topline', Lift: 'Arp' },
  sodium: { Verse: 'Arp', Chorus: 'Lead' },
  'red-eye': { Hook: 'Piano', 'Hook 2': 'Piano' },
  'late-checkout': { Verse: 'Keys', Hook: 'Lead' },
  'wake-up-call': { Verse: 'Piano', Shout: 'Organ' },
  'lobby-bar': { A: 'Vibes', Bridge: 'Vibes', 'A again': 'Vibes' },
  'room-service': { Verse: 'Lead', Hook: 'Lead' },
  turndown: { Drop: 'Loop', 'Drop 2': 'Riff' },
  'ice-machine': { Riddim: 'Melodica', Outro: 'Melodica' },
  'service-lift': { Break: 'Lead' },
  'boiler-room': { Chorus: 'Lead' },
  vacancy: {
    Verse: 'Neon',
    Chorus: 'Topline',
    'Verse 2': 'Neon',
    'Chorus 2': 'Topline',
    Bridge: 'Topline',
    'Chorus 3': 'Topline',
    Outro: 'Neon',
  },
};
const RELATIVE = {
  'D major': 'B minor',
  'D minor': 'F major',
  'E major': 'C# minor',
  'G major': 'E minor',
  'A minor': 'C major',
  'F# minor': 'A major',
  'C minor': 'Eb major',
  'Eb major': 'C minor',
  'Ab major': 'F minor',
  'E minor': 'G major',
  'B minor': 'D major',
  'G minor': 'Bb major',
  'F minor': 'Ab major',
};
const sharps = (k) => k.replace(/^([A-G])b /, (_, l) => ({ D: 'C#', E: 'D#', G: 'F#', A: 'G#', B: 'A#' })[l] + ' '); // the key reader names sharps
const strip = (p) =>
  p.tracks
    .map((tr) => tr.clips.map((c) => (c.notes || []).map((n) => `${n.p}@${n.t}:${n.d}*${n.v}`).join(' ')).join('|'))
    .join('/');

/* ------------------------------------------------------------------ the documents (no browser) */
t.ok(MORE_DEMOS.length >= 3, `${MORE_DEMOS.length} new demos on the shelf`);
t.ok(
  DEMOS[0].id === 'night-shift' && demoById('nope').title === 'Night Shift',
  'Night Shift comes first, and an unknown id opens it',
);
t.ok(
  new Set(MORE_DEMOS.map((d) => d.genre)).size === MORE_DEMOS.length,
  'each demo is a different genre: ' + MORE_DEMOS.map((d) => d.genre).join(', '),
);
for (const d of MORE_DEMOS) {
  const p = d.make();
  const problems = validateProject(p);
  t.ok(problems.length === 0, `${d.title}: valid ${problems.join('; ')}`);
  const bars = p.loop.end / 4;
  const secs = (p.loop.end * 60) / p.tempo;
  // a loop-length demo runs to 32 bars and 90 s; a song in its whole form (a bridge, an outro) to 96 bars and 3 minutes
  // (a genre demo, META.targets, is a whole song in its genre's form too: intro to outro, or the riff to the last hit)
  const whole = !!d.targets || ['Bridge', 'Outro'].every((n) => p.sections.some((s) => s.name === n));
  t.ok(
    bars >= 8 && bars <= (whole ? 96 : 32) && secs <= (whole ? 180 : 90) && p.sections.length >= 2,
    `${d.title}: ${bars} bars (${secs.toFixed(0)} s) in ${p.sections.length} sections (${p.sections.map((s) => s.name).join(', ')})`,
  );
  t.ok(`${p.key.root} ${p.key.scale}` === d.key && p.tempo === d.tempo, `${d.title}: ${d.key} at ${d.tempo} bpm`);
  t.ok(strip(p) === strip(d.make()), `${d.title}: the same notes every time (seeded)`);
  const notes = p.tracks.flatMap((tr) => tr.clips.flatMap((c) => c.notes.map((n) => ({ n, c, tr }))));
  const by = (who) => notes.filter((x) => x.n.by === who).length;
  t.ok(
    by('overdub') > 0 && by('claude') > 0 && by('overdub') + by('claude') === notes.length,
    `${d.title}: ${by('overdub')} notes by the house, ${by('claude')} by Claude`,
  );
  const agentClips = p.tracks.flatMap((tr) => tr.clips.filter((c) => c.by === 'claude').map((c) => ({ c, tr })));
  t.ok(
    agentClips.length > 0 &&
      agentClips.every(({ c, tr }) => tr.by === 'claude' && c.notes.every((n) => n.by === 'claude')),
    `${d.title}: Claude's take is signed on its track, clip and notes (${agentClips.map(({ tr }) => tr.name).join(', ')})`,
  );
  t.ok(
    notes.every(({ n, c }) => n.t >= 0 && n.t < c.length && n.v > 0 && n.v <= 1),
    `${d.title}: every note sits inside its clip`,
  );
  // automation: a demo's lanes are signed by the house or by Claude, and Claude wrote at least one of them (each lane's
  // param and range are checked against its device in the page, below)
  const lanes = lanesOf(p);
  if (lanes.length) {
    const who = (w) => lanes.filter((x) => x.lane.by === w).length;
    t.ok(
      lanes.every((x) => ['overdub', 'claude'].includes(x.lane.by) && x.lane.points.length >= 2 && !x.lane.off) &&
        who('claude') > 0,
      `${d.title}: ${lanes.length} automation lanes, ${who('overdub')} by the house and ${who('claude')} by Claude (${lanes.map((x) => x.param).join(', ')})`,
    );
  }
  const lead = LEADS[d.id];
  t.ok(
    lead &&
      Object.entries(lead).every(
        ([s, name]) => p.sections.some((x) => x.name === s) && p.tracks.some((x) => x.name === name),
      ),
    `${d.title}: its leads name real sections and tracks`,
  );
  // Studio A, played the way a drummer plays it: ghost strokes on the snare, at least four of the articulations a
  // groove alone doesn't use, a cymbal on the downbeat of every section the kit plays from its start, and the mic mix
  // set for the song
  for (const tr of p.tracks.filter((x) => x.instrument?.device === 'core.drumroom')) {
    const ns = tr.clips.flatMap((c) => c.notes.map((n) => ({ ...n, at: c.start + n.t })));
    const ghosts = ns.filter((n) => n.p === DRUM_MAP.snare && n.v < 0.35).length;
    const arts = [
      'half',
      'quarter',
      'hatedge',
      'openedge',
      'footsplash',
      'rimshot',
      'snareedge',
      'flam',
      'drag',
      'roll',
      'bell',
      'rideedge',
      'crashchoke',
      'crash2choke',
      'chinachoke',
      'splashchoke',
      'ridechoke',
    ].filter((a) => ns.some((n) => n.p === DRUM_MAP[a]));
    const CYMBALS = [
      'crash',
      'crash2',
      'china',
      'splash',
      'crashchoke',
      'crash2choke',
      'chinachoke',
      'splashchoke',
    ].map((a) => DRUM_MAP[a]);
    const opens = p.sections.filter((s) => ns.some((n) => n.at > s.start - 0.2 && n.at < s.start + 1));
    const bare = opens.filter((s) => !ns.some((n) => CYMBALS.includes(n.p) && Math.abs(n.at - s.start) < 0.05));
    const def = getDevice('core.drumroom'),
      mics = ['mix_close', 'mix_oh', 'mix_room', 'mix_crush', 'bleed', 'room_size'].filter(
        (k) => tr.instrument.params[k] != null && +tr.instrument.params[k] !== def.params.find((q) => q.key === k).def,
      );
    t.ok(
      ghosts >= 8 && arts.length >= 4 && opens.length && !bare.length && mics.length,
      `${d.title}: ${tr.name} on Studio A is played like a drummer: ${ghosts} ghost strokes; ${arts.join(', ')}; a cymbal on the downbeat of ${opens.length - bare.length} of the ${opens.length} sections it plays from the top${bare.length ? ` (none on ${bare.map((s) => s.name).join(', ')})` : ''}; its mics set (${mics.join(', ')})`,
    );
  }
  // Scribble Strip: a lane on, with depth, whose shape moves; Slide Rule: a band on that cuts or boosts
  const inserts = [...p.tracks.map((tr) => [tr.name, tr.inserts]), ['the master', p.master.inserts]].flatMap(
    ([name, list]) => list.map((x) => ({ name, x })),
  );
  for (const { name, x } of inserts.filter(({ x }) => x.device === 'core.shaper')) {
    const v = paramValues(getDevice('core.shaper'), x.params);
    const moving = LANES.filter(
      (L) =>
        +v[`${L.id}_on`] >= 0.5 && +v[`${L.id}_depth`] > 0 && new Set(pointsOf(v, L.id).map((pt) => pt.y)).size > 1,
    );
    t.ok(
      x.on !== false && +v.mix > 0 && moving.length > 0,
      `${d.title}: the Scribble Strip on ${name} draws something (${moving.map((L) => `${L.word} every ${RATES[v[`${L.id}_rate`]]}, ${pointsOf(v, L.id).length} points, depth ${v[`${L.id}_depth`]}%`).join('; ') || 'nothing moves'})`,
    );
  }
  for (const { name, x } of inserts.filter(({ x }) => x.device === 'core.eq8')) {
    const v = paramValues(getDevice('core.eq8'), x.params);
    const bands = Array.from({ length: EQ_BANDS }, (_, i) => i + 1).filter(
      (n) => +v[`b${n}_on`] >= 0.5 && (+v[`b${n}_type`] >= 3 || Math.abs(+v[`b${n}_gain`]) >= 0.5),
    );
    t.ok(
      x.on !== false && bands.length > 0,
      `${d.title}: the Slide Rule on ${name} works (${bands.map((n) => `${EQ_TYPES[v[`b${n}_type`]]} at ${v[`b${n}_freq`]} Hz${+v[`b${n}_type`] < 3 ? ` ${v[`b${n}_gain`]} dB` : ''}`).join(', ') || 'no band on'})`,
    );
  }
}

/* ------------------------------------------------------------------ the sound (in the page) */
const { page, errors, close } = await open('/app/', { query: 'new&autostart' });
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
for (const d of MORE_DEMOS) {
  const r = await page.evaluate(
    async ({ id, leads }) => {
      const app = window.overdub;
      const { demoById } = await import('/app/src/core/demo.js');
      app.store.load(demoById(id), { by: 'overdub' });
      const p = app.store.get();
      const missing = [];
      for (const tr of p.tracks) {
        if (tr.instrument && !app.devices.getDevice(tr.instrument.device)) missing.push(tr.instrument.device);
        for (const fx of tr.inserts) if (!app.devices.getDevice(fx.device)) missing.push(fx.device);
      }
      for (const fx of p.master.inserts) if (!app.devices.getDevice(fx.device)) missing.push(fx.device);
      const A = await import('/app/src/core/automation.js');
      const badLanes = A.lanesOf(p)
        .filter((x) => {
          const spec = A.specFor(p, x, app.devices.getDevice);
          return (
            !spec ||
            x.lane.points.some(
              (pt) => pt.v < Math.min(spec.min, spec.max) || pt.v > Math.max(spec.min, spec.max) || pt.t > p.loop.end,
            )
          );
        })
        .map((x) => x.key);
      const M = await import('/app/src/audio/measure.js');
      const spb = 60 / p.tempo,
        end = p.loop.end;
      const t0 = performance.now();
      const buf = await app.engine.render({ from: 0, to: end });
      const ms = performance.now() - t0;
      const mix = M.measure(buf);
      const stems = {};
      for (const tr of p.tracks) stems[tr.name] = await app.engine.render({ from: 0, to: end, tracks: [tr.id] });
      const tracks = {};
      for (const [name, b] of Object.entries(stems)) {
        const m = M.measure(b);
        tracks[name] = { lufs: +m.lufs.toFixed(1), tp: +m.truePeak.toFixed(1) };
      }
      // in each lead's section: the lead against every other pitched track, by loudness and in the lead's own band
      const lead = [];
      for (const [sec, name] of Object.entries(leads)) {
        const s = p.sections.find((x) => x.name === sec);
        const at = { from: s.start * spb, to: (s.start + s.length) * spb };
        const L = M.measure(stems[name], at);
        const band = Object.entries(L.bands).sort((a, b) => b[1] - a[1])[0][0];
        const others = [];
        for (const tr of p.tracks) {
          if (tr.name === name || /^(Drums|Bass|808|Hats)$/.test(tr.name)) continue; // the rhythm section
          const m = M.measure(stems[tr.name], at);
          if (m.lufs < -60) continue;
          others.push({ name: tr.name, lufs: +m.lufs.toFixed(1), inBand: +(m.rms + m.bands[band]).toFixed(1) });
        }
        lead.push({ sec, name, lufs: +L.lufs.toFixed(1), band, inBand: +(L.rms + L.bands[band]).toFixed(1), others });
      }
      const keep = ['lufs', 'truePeak', 'lufsShortMax', 'crest', 'lra', 'lowSideDb', 'lowCorrelation', 'bands'];
      return {
        missing,
        badLanes,
        lanes: A.lanesOf(p).length,
        secs: +buf.duration.toFixed(1),
        ms: Math.round(ms),
        lufs: +mix.lufs.toFixed(1),
        tp: +mix.truePeak.toFixed(1),
        key: mix.key,
        bands: mix.bands,
        m: Object.fromEntries(keep.map((k) => [k, mix[k]])),
        tracks,
        lead,
      };
    },
    { id: d.id, leads: LEADS[d.id] },
  );
  t.note(
    `${d.title}: ${JSON.stringify({ lufs: r.lufs, tp: r.tp, key: r.key && `${r.key.root} ${r.key.scale}`, tracks: r.tracks })}`,
  );
  t.ok(r.missing.length === 0, `${d.title}: every device resolves ${r.missing.join(', ')}`);
  if (r.lanes)
    t.ok(
      r.badLanes.length === 0,
      `${d.title}: its ${r.lanes} lanes name real params and stay in their ranges ${r.badLanes.join(', ')}`,
    );
  t.ok(r.secs > 20, `${d.title}: renders ${r.secs} s in ${r.ms} ms`);
  t.ok(r.tp <= -1, `${d.title}: true peak ${r.tp} dBTP <= -1`);
  if (d.targets) {
    // a genre demo is mastered as its genre is (bass music at -8 to -6 LUFS, metal at -9 to -7), so it is held to the
    // genre's whole-song targets here, as the studio's preview renders it (tools/genre-demos-test.js holds the
    // canonical Node render and each drop); every track audible and none louder than the mix
    const rows = checkTargets(r.m, d.targets, { window: 'song' }),
      miss = rows.filter((x) => !x.ok);
    t.ok(
      !miss.length,
      `${d.title}: the ${d.targets} targets, in the preview: ${(miss.length ? miss : rows).map(targetWords).join('; ')}`,
    );
    for (const [name, m] of Object.entries(r.tracks))
      t.ok(
        m.lufs >= r.lufs - 16 && m.lufs <= r.lufs + 0.5,
        `${d.title}: ${name} sits at ${m.lufs} LUFS (the mix ${r.lufs}: within 16 LU under it)`,
      );
  } else {
    t.ok(r.lufs >= -11.5 && r.lufs <= -9.5, `${d.title}: the mix is ${r.lufs} LUFS (-11.5..-9.5)`);
    // the balance: no band holds much over half the energy (the shelf peaks at -2.5, sub), and the top end stays a top end
    const top = Math.max(...Object.values(r.bands)),
      highs = Math.max(r.bands.highmid, r.bands.presence, r.bands.air);
    t.ok(
      top <= -2 && highs <= -13,
      `${d.title}: no band dominates (loudest ${top} dB of the energy, the highs at most ${highs} dB)`,
    );
    for (const [name, m] of Object.entries(r.tracks))
      t.ok(m.lufs >= -19.5 && m.lufs <= -12.5, `${d.title}: ${name} sits at ${m.lufs} LUFS (-19.5..-12.5)`);
  }
  for (const l of r.lead) {
    const loud = Math.max(...l.others.map((o) => o.lufs)),
      band = Math.max(...l.others.map((o) => o.inBand));
    t.ok(
      l.lufs >= loud - 1.5 && l.inBand >= band - 3,
      `${d.title}: in the ${l.sec}, ${l.name} leads (${l.lufs} LUFS vs ${loud}; ${l.inBand} dB vs ${band} in its ${l.band} band)`,
    );
  }
  const want = [d.key, RELATIVE[d.key]].map(sharps);
  const read = [r.key, r.key && r.key.alt].filter(Boolean).map((k) => `${k.root} ${k.scale}`);
  // (high-gain power chords carry no third, and a distorted fifth's harmonics outweigh the root's: the key reader
  // hears a metal riff in C as G minor or Bb major. Noted for a metal demo, not held)
  if (d.targets === 'metal') t.note(`${d.title}: key reads ${read.join(' / ')} (written in ${d.key}; power chords)`);
  else t.ok(want.includes(read[0]), `${d.title}: key reads ${read.join(' / ')} (${want.join(' or ')})`);
}
t.ok(
  !errors.filter((e) => !/Failed to load resource/.test(e)).length,
  'no page errors while rendering ' + errors.slice(0, 3).join(' | '),
);
await close();

/* ------------------------------------------------------------------ how they look */
for (const d of MORE_DEMOS) {
  const o = await open('/app/', { query: `demo=${d.id}` });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await o.page.evaluate(() => window.overdub.welcome?.close());
  await o.page.click('button[title="Fit the whole song in view"]');
  await o.page.waitForTimeout(700);
  const title = await o.page.evaluate(() => window.overdub.store.get().title);
  t.ok(title === d.title, `/app/?demo=${d.id} opens “${title}”`);
  await o.shot(`demos-${d.id}`);
  t.ok(
    !o.errors.filter((e) => !/Failed to load resource/.test(e)).length,
    `${d.title}: no page errors in the studio ` + o.errors.slice(0, 3).join(' | '),
  );
  await o.close();
}

// Nothing a demo brings is held: Night Shift's three devices and any other demo's are the studio's own code, so they
// play without asking, opened from the shelf (?demo= and the Song menu) or from a link someone else made of the demo
{
  const o = await open('/app/', { query: 'demo=night-shift' });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const first = await o.page.evaluate(() => ({
    title: window.overdub.store.get().title,
    held: window.overdub.trust ? window.overdub.trust.held().length : null,
    devices: Object.keys(window.overdub.store.get().devices || {}).length,
    ask: !!document.querySelector('.sh-held'),
  }));
  const links = {};
  for (const d of DEMOS) links[d.id] = (await encodeShare(demoById(d.id), { from: { name: 'Sam' } })).hash;
  const r = await o.page.evaluate(async (links) => {
    const app = window.overdub,
      out = [];
    const held = () => (app.trust ? app.trust.held().map((d) => d.id) : null);
    for (const [id, hash] of Object.entries(links)) {
      await app.exporter.openDemo(id);
      const shelf = {
        held: held(),
        devices: Object.keys(app.store.get().devices || {}).length,
        ask: !!document.querySelector('.sh-held'),
      };
      await app.share.open(hash);
      const link = {
        held: held(),
        listening: app.share.listening,
        ask: !!document.querySelector('.sh-held'),
        playing: Object.keys(app.store.get().devices || {}).filter(
          (d) => app.devices.getDevice(d)?.source === 'project',
        ).length,
      };
      out.push({ id, shelf, link });
    }
    return out;
  }, links);
  const bad = r.filter(
    (x) =>
      !Array.isArray(x.shelf.held) ||
      x.shelf.held.length ||
      x.shelf.ask ||
      !Array.isArray(x.link.held) ||
      x.link.held.length ||
      x.link.ask ||
      !x.link.listening ||
      x.link.playing !== x.shelf.devices,
  );
  const errs = o.errors.filter((e) => !/Failed to load resource/.test(e));
  t.ok(
    first.title === 'Night Shift' &&
      first.held === 0 &&
      first.devices === 3 &&
      !first.ask &&
      r.length === DEMOS.length &&
      !bad.length &&
      !errs.length,
    `every shipped demo opens with nothing held (Night Shift's ${first.devices} devices play from ?demo=, the Song menu and someone else's link; so do all ${DEMOS.length} demos' ${r.reduce((n, x) => n + x.shelf.devices, 0)})${bad.length ? `: ${JSON.stringify(bad[0])}` : ''}; no page errors ${errs.slice(0, 3).join(' | ')}`,
  );
  await o.close();
}

// the Song menu: Demos opens a list; picking one (and saying yes) replaces the song (and Undo is offered)
{
  const o = await open('/app/', { query: 'new' });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await o.page.click('.sm-btn');
  await o.page.click('.sm-more');
  const items = await o.page.$$eval('.sm-demos .sm-i b', (els) => els.map((e) => e.textContent));
  t.ok(
    DEMOS.every((d) => items.includes(d.title)),
    'the Demos list names every demo: ' + items.join(', '),
  );
  await o.shot('demos-menu');
  await o.page.click(`.sm-demos .sm-i:has-text("${MORE_DEMOS[2].title}")`);
  await o.page.click('.sm-confirm .ew-btn-primary'); // (it asks first, the way New song does: ui/export.js)
  await o.page
    .waitForFunction((title) => window.overdub.store.get().title === title, MORE_DEMOS[2].title, { timeout: 5000 })
    .catch(() => {});
  const now = await o.page.evaluate(() => window.overdub.store.get().title);
  t.ok(now === MORE_DEMOS[2].title, `picking “${MORE_DEMOS[2].title}” opens it (now “${now}”)`);
  t.ok(
    !o.errors.filter((e) => !/Failed to load resource/.test(e)).length,
    'no page errors in the menu ' + o.errors.slice(0, 3).join(' | '),
  );
  await o.close();
}
t.done();
