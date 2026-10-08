// Start a song (app/src/ui/start.js): the blank song's door and the stage, in the studio. Taps go through
// app.start.tap(row, perfMs) with times from tools/sloppy.js (a person a little off, drifting), so Playwright's own
// timing isn't what's measured. Quiet browsers (tools/pw.js).
//
//   node tools/start-test.js
import { open, tally, OUTDIR } from './pw.js';
import { perform } from './sloppy.js';
import path from 'node:path';

const t = tally('start');
const K = 36,
  S = 38,
  H = 42;
const ROW = { [K]: 'kick', [S]: 'snare', [H]: 'hat' };
const ROCK = [[0, K], [2, K], [2.5, K], [1, S], [3, S], ...Array.from({ length: 8 }, (_, i) => [i / 2, H])];
const real = (errs) =>
  errs.filter(
    (e) => !/status of 404 .*kits|Failed to load resource: the server responded with a status of 404/.test(e),
  );

async function blank({ width = 1440, height = 900 } = {}) {
  const o = await open('/app/', { query: 'new', width, height });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await o.page.waitForTimeout(500);
  return o;
}
const E = (page, f, a) => page.evaluate(f, a);
const song = (page) =>
  E(page, () => {
    const o = window.overdub,
      p = o.store.get();
    return {
      tempo: p.tempo,
      loop: p.loop,
      hist: o.store.history.map((x) => ({ label: x.label, by: x.by })),
      tracks: p.tracks.map((tr) => ({
        id: tr.id,
        name: tr.name,
        device: tr.instrument?.device,
        by: tr.by,
        clips: tr.clips.map((c) => ({
          id: c.id,
          by: c.by,
          length: c.length,
          notes: c.notes.map((n) => ({ p: n.p, t: n.t, by: n.by })),
        })),
      })),
    };
  });
// a person playing the rock beat three times round at bpm, as app.start.tap calls (ms on the page's clock)
async function playRock(page, { bpm = 96, rounds = 3, jitter = 0.03, drift = 0.04, seed = 3 } = {}) {
  const hits = perform(ROCK, { bpm, bars: rounds, jitter, drift, seed, start: 0 });
  const t0 = await E(page, () => performance.now() + 40);
  await E(
    page,
    ([hs]) => {
      for (const x of hs) window.overdub.start.tap(x.row, x.ms);
    },
    [hits.map((x) => ({ row: ROW[x.p], ms: t0 + x.t * 1000 }))],
  );
  return hits.length;
}

/* ================================================================ the door */
{
  console.log('\nthe door');
  const o = await blank();
  const { page } = o;
  try {
    const d = await E(page, () => {
      const door = document.querySelector('.st-door'),
        o = window.overdub;
      const go = [...door.querySelectorAll('.btn-go')].map((b) => b.textContent.trim());
      return {
        shown: !!door?.getClientRects().length,
        title: door.querySelector('.ar-empty-title')?.textContent,
        ways: [...door.querySelectorAll('.st-way-b')].map((b) => b.textContent.trim()),
        go,
        notime: [...door.querySelectorAll('.st-notime button')].map((b) => b.textContent.trim()),
        foot: door.querySelector('.ar-empty-foot')?.textContent.replace(/\s+/g, ' ').trim(),
        playing: o.engine.playing,
        stage: !!document.querySelector('.st-stage'),
        welcome: !!document.querySelector('.ar-welcome')?.getClientRects().length,
      };
    });
    t.ok(
      d.shown && d.title === 'Take 1 is yours.' && d.ways.join() === 'Tap a beat,Hum a tune,Play the keys',
      `a blank song's empty space is the door: "${d.title}", ${d.ways.join(' · ')}`,
    );
    t.ok(d.go.join() === 'Tap a beat', `Tap a beat is the door's one primary (${d.go.join(', ')})`);
    t.ok(
      d.notime.join() === 'Draw a beat,Pick a groove,Ask your agent' &&
        /hear a finished one: Night Shift\./.test(d.foot),
      `no playing in time: ${d.notime.join(' · ')}; "${d.foot}"`,
    );
    t.ok(
      !d.playing && !d.stage && !d.welcome,
      `nothing sounds and nothing pops up until a key or a click (playing ${d.playing}, stage ${d.stage}, welcome ${d.welcome})`,
    );
    await page.focus('.st-way-b[data-way="Tap a beat"]');
    await page.keyboard.press('ArrowDown');
    const f1 = await E(page, () => document.activeElement?.textContent.trim());
    t.ok(f1 === 'Hum a tune', `↓ walks the ways (${f1})`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-door.png') });
    // every blank song has it: a song with a track doesn't
    await E(page, () =>
      window.overdub.store.dispatch(
        { type: 'track.add', track: { name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys' } } },
        { by: 'you' },
      ),
    );
    await page.waitForTimeout(200);
    const gone = await E(page, () => !document.querySelector('.st-door')?.getClientRects().length);
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(200);
    const back = await E(page, () => !!document.querySelector('.st-door')?.getClientRects().length);
    t.ok(
      gone && back,
      `nothing over a song with tracks, and the door is back when it's blank again (${gone}, ${back})`,
    );
    t.ok(
      !real(o.errors).length,
      `door: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`,
    );
  } catch (e) {
    t.ok(false, 'door threw: ' + (e.stack || e));
  } finally {
    await o.close();
  }
}

/* ================================================================ tap a beat, free time */
{
  console.log('\ntap a beat');
  const o = await blank();
  const { page } = o;
  try {
    // press 1: Tap a beat
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(400);
    const st = await E(page, () => {
      const o = window.overdub,
        stage = document.querySelector('.st-stage');
      return {
        step: o.start.step,
        busy: o.start.busy,
        region: stage?.getAttribute('role'),
        label: stage?.getAttribute('aria-label'),
        inert: [...document.querySelector('.ew-main').children].filter((c) => c !== stage).every((c) => c.inert),
        tracks: o.store.get().tracks.length,
        hist: o.store.history.length,
        empty: document.querySelector('.st-empty')?.textContent,
        pads: [...document.querySelectorAll('.st-pad')].map((p) => p.textContent.trim()),
      };
    });
    t.ok(
      st.step === 'play' && st.region === 'region' && st.label === 'Start a song' && st.inert,
      `Tap a beat opens the stage over the centre column, the studio inert under it (${JSON.stringify({ step: st.step, inert: st.inert })})`,
    );
    t.ok(
      st.tracks === 1 &&
        st.hist === 0 &&
        st.empty === 'Your first hit starts the clock.' &&
        st.pads.join() === 'KickF,SnareJ,HatK,OpenL',
      `the pads play on a previewed Drums track, nothing in History (${st.tracks} track, ${st.hist} changes); "${st.empty}"`,
    );
    // the keys stay on the stage: Space with nothing played doesn't start the transport, and nothing lands
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const sp = await E(page, () => ({
      playing: window.overdub.engine.playing,
      step: window.overdub.start.step,
      hist: window.overdub.store.history.length,
      line: document.querySelector('.st-status')?.textContent,
    }));
    t.ok(
      !sp.playing && sp.step === 'play' && sp.hist === 0 && sp.line === 'Your first hit starts the clock.',
      `Space never reaches the studio while the stage is open: it's Done, and there's nothing yet (playing ${sp.playing}; "${sp.line}")`,
    );
    // the first hit sounds at once on the preview track
    await page.keyboard.press('KeyF');
    const v = await E(page, async () => {
      const o = window.overdub,
        id = o.store.get().tracks[0].id;
      await new Promise((r) => setTimeout(r, 40));
      const vs = await o.engine.voices();
      return { voices: vs[id]?.voices ?? null, hits: o.start.take()?.hits ?? (o.start.step && 1) };
    });
    t.ok(v.voices > 0, `the first hit sounds on the blank song at once (${v.voices} voice on the preview Drums)`);
    await E(page, () => window.overdub.start.again());
    // a few hits: no BPM yet
    const t0 = await E(page, () => performance.now());
    await E(
      page,
      (t0) => {
        for (let i = 0; i < 5; i++) window.overdub.start.tap(i % 2 ? 'snare' : 'kick', t0 + i * 600);
      },
      t0,
    );
    const few = await E(page, () => ({
      bpm: document.querySelector('.st-bpm')?.textContent,
      done: document.querySelector('.st-done')?.textContent.trim(),
      go: document.querySelector('.st-done')?.classList.contains('btn-go'),
    }));
    t.ok(
      few.bpm === '~' && /^Done/.test(few.done) && few.go,
      `five hits: the tempo isn't said yet ("${few.bpm}"), and Done is ready from the 4th (${few.done})`,
    );
    await E(page, () => window.overdub.start.again());
    // three times round, a sloppy drifting player
    const n = await playRock(page);
    await page.waitForTimeout(200);
    const live = await E(page, () => ({
      bpm: document.querySelector('.st-bpm')?.textContent,
      rounds: document.querySelector('.st-rounds')?.textContent,
      line: document.querySelector('.st-status')?.textContent,
      take: window.overdub.start.take(),
    }));
    t.ok(
      Math.abs(+live.bpm - 98) <= 4 &&
        /round/.test(live.rounds) &&
        /hits\. \d+ BPM, 1 bar round, 3 times round\./.test(live.line),
      `${n} hits: the BPM, the loop and the rounds come from the playing (${live.bpm} BPM; "${live.line}")`,
    );
    await page.screenshot({ path: path.join(OUTDIR, 'start-play.png') });
    // press 2: Done
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    const a = await song(page);
    const tr = a.tracks[0];
    t.ok(
      a.hist.length === 1 &&
        a.hist[0].by === 'you' &&
        /^your beat, 1 bar at \d+ BPM$/.test(a.hist[0].label) &&
        a.tracks.length === 1 &&
        tr.name === 'Drums' &&
        tr.device === 'core.drums' &&
        tr.clips.length === 1 &&
        a.loop.on &&
        a.loop.end === 4,
      `two presses (Tap a beat, Done): one History entry by you, "${a.hist[0]?.label}", with the tempo (${a.tempo}), Drums, its clip and the loop`,
    );
    t.ok(
      tr.by === 'you' &&
        tr.clips[0].by === 'you' &&
        tr.clips[0].notes.every((x) => x.by === 'you') &&
        tr.clips[0].notes.length === 13,
      `signed you: the track, the clip and its ${tr.clips[0].notes.length} hits (the rock beat's 13)`,
    );
    const inn = await E(page, () => ({
      step: window.overdub.start.step,
      busy: window.overdub.start.busy,
      playing: window.overdub.engine.playing,
      head: document.querySelector('.st-title')?.textContent,
      sub: document.querySelector('.st-sub')?.textContent,
      by: !!document.querySelector('.st-sub .by-human'),
      level: document.querySelector('.st-level')?.textContent,
      go: [...document.querySelectorAll('.st-stage .btn-go')].map((b) => b.textContent.trim()),
    }));
    t.ok(
      inn.step === 'in' &&
        !inn.busy &&
        inn.playing &&
        inn.head === 'Your beat is in the song.' &&
        inn.by &&
        /You played it 3 times round; kept the 13 hits you played most\./.test(inn.sub),
      `it's in, and it loops while you decide: "${inn.sub}"`,
    );
    t.ok(
      /^Tight moved \d+ hits, \d+ ms on average\.$/.test(inn.level) && inn.go.join() === 'Hum over it',
      `Timing says what Tight moved ("${inn.level}"); the one primary is the next part (${inn.go.join(', ')})`,
    );
    await page.screenshot({ path: path.join(OUTDIR, 'start-in.png') });
    // Timing steps join the landing: still one undo step
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const loose = await song(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const played = await song(page);
    const lvl = await E(page, () => document.querySelector('.st-level')?.textContent);
    const ts = (s) => s.tracks[0].clips[0].notes.map((x) => x.t).join();
    t.ok(
      loose.hist.length === 1 &&
        played.hist.length === 1 &&
        ts(loose) !== ts(a) &&
        ts(played) !== ts(loose) &&
        /^Your timing, evened out to \d+ BPM\.$/.test(lvl),
      `→ Loose, → As played: the notes move, still one undo step (${played.hist.length}); "${lvl}"`,
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    // Not quite? lists the other readings; picking one plays it at once, joined; Esc puts back what was there
    const nq = await E(page, () => !!document.querySelector('.st-notquite'));
    if (nq) {
      await page.click('.st-notquite');
      await page.waitForTimeout(200);
      const rd = await E(page, () => ({
        step: window.overdub.start.step,
        rows: [...document.querySelectorAll('.st-reading')].map((r) => r.textContent),
        sel: document.activeElement?.classList.contains('st-reading'),
      }));
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      const after = await song(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const backed = await song(page);
      t.ok(
        rd.step === 'readings' &&
          rd.rows.length >= 2 &&
          rd.sel &&
          after.hist.length === 1 &&
          (after.tempo !== a.tempo || ts(after) !== ts(a)) &&
          backed.tempo === a.tempo &&
          ts(backed) === ts(a),
        `Not quite?: ${rd.rows.length} readings by ear (${rd.rows.join(' | ')}); ↓ plays the next at once, joined; Esc puts back what was there`,
      );
    } else t.ok(false, 'Not quite? is offered on a take with more than one reading');
    await page.screenshot({ path: path.join(OUTDIR, 'start-readings.png') });
    // ⌘Z once and the song is blank: the door is back
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(300);
    const u = await E(page, () => {
      const o = window.overdub,
        p = o.store.get();
      return {
        tracks: p.tracks.length,
        tempo: p.tempo,
        loop: p.loop.on,
        step: o.start.step,
        door: !!document.querySelector('.st-door')?.getClientRects().length,
      };
    });
    t.ok(
      u.tracks === 0 && u.tempo === 120 && !u.loop && !u.step && u.door,
      `one undo takes out the tempo, the track, the clip and the loop; the door is back (${JSON.stringify(u)})`,
    );
    t.ok(
      !real(o.errors).length,
      `tap a beat: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`,
    );
  } catch (e) {
    t.ok(false, 'tap a beat threw: ' + (e.stack || e));
  } finally {
    await o.close();
  }
}

/* ================================================================ leaving, the agent, Hum over it */
{
  console.log('\nleaving, the agent, the next part');
  const o = await blank();
  const { page } = o;
  try {
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const shut = await E(page, () => ({
      step: window.overdub.start.step,
      tracks: window.overdub.store.get().tracks.length,
      door: !!document.querySelector('.st-door')?.getClientRects().length,
    }));
    t.ok(
      !shut.step && shut.tracks === 0 && shut.door,
      `Esc before a hit closes the stage and leaves nothing behind (${JSON.stringify(shut)})`,
    );
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page, { rounds: 2 });
    // the agent waits while a take is played on the stage
    const ag = await E(page, () =>
      window.overdub.tools.run(
        'apply_ops',
        { label: 'x', ops: [{ type: 'project.set', patch: { tempo: 90 } }] },
        { by: 'claude' },
      ),
    );
    const ro = await E(page, () => window.overdub.tools.run('get_project', {}, { by: 'claude' }));
    t.ok(
      ag?.error === 'recording' && !ro?.error,
      `while you play on the stage an agent's change waits ("${ag?.error}"), and reading the song doesn't (${ro?.error || 'ok'})`,
    );
    const caps0 = await E(page, () => window.overdub.input.capture.list({ all: true }).length);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const ask = await E(page, () => ({
      step: window.overdub.start.step,
      line: document.querySelector('.st-status')?.textContent,
    }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const left = await E(page, () => ({
      step: window.overdub.start.step,
      tracks: window.overdub.store.get().tracks.length,
      hist: window.overdub.store.history.length,
      caps: window.overdub.input.capture.list({ all: true }).length,
    }));
    t.ok(
      ask.step === 'play' &&
        /^Leave without keeping this take\? It stays in Takes\./.test(ask.line) &&
        !left.step &&
        left.tracks === 0 &&
        left.hist === 0 &&
        left.caps === caps0 + 1,
      `Esc after hits asks once ("${ask.line}"); leaving keeps nothing in the song, the take in Takes (${caps0} → ${left.caps})`,
    );
    // Hum over it: Sketch's Hum over the beat, looping
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const next = await E(page, () => {
      const o = window.overdub;
      return {
        step: o.start.step,
        playing: o.engine.playing,
        sketch: o.ui.visible?.('sketch'),
        mode: document.querySelector('.sk-hum') ? 'hum' : null,
        hist: o.store.history.map((x) => x.label),
      };
    });
    t.ok(
      !next.step && next.playing && next.sketch && next.mode === 'hum',
      `Hum over it (Enter): the stage folds away, the beat keeps looping and Sketch is on Hum (${JSON.stringify(next)})`,
    );
    t.ok(
      !real(o.errors).length,
      `leaving and the next part: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`,
    );
  } catch (e) {
    t.ok(false, 'leaving threw: ' + (e.stack || e));
  } finally {
    await o.close();
  }
}

/* ================================================================ hum a tune, over a beat */
{
  console.log('\nhum a tune');
  const o = await blank();
  const { page } = o;
  try {
    await page.click('.st-way-b[data-way="Hum a tune"]');
    await page.waitForTimeout(600);
    const g = await E(page, () => {
      const o = window.overdub,
        p = o.store.get();
      return {
        step: o.start.step,
        playing: o.engine.playing,
        tempo: p.tempo,
        tracks: p.tracks.map((tr) => tr.name),
        clips: p.tracks.map((tr) => tr.clips.length),
        hist: o.store.history.length,
        speed: document.querySelector('.st-word[aria-checked="true"]')?.textContent,
        go: [...document.querySelectorAll('.st-stage .btn-go')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
      };
    });
    t.ok(
      g.step === 'hum' &&
        g.playing &&
        g.tempo === 100 &&
        g.tracks.join() === 'Drums' &&
        g.clips[0] === 1 &&
        g.hist === 0,
      `Hum a tune: a simple beat already looping at Easy 100, heard and not in History (${JSON.stringify(g)})`,
    );
    t.ok(g.go.length === 1 && /^Hum H$/.test(g.go[0]), `one primary: Hum (${g.go.join(', ')})`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-hum.png') });
    await page.click('.st-word:has-text("Upbeat 120")');
    await page.waitForTimeout(200);
    const up = await E(page, () => ({
      tempo: window.overdub.store.get().tempo,
      hist: window.overdub.store.history.length,
    }));
    t.ok(up.tempo === 120 && up.hist === 0, `Speed is a preview too (${up.tempo} BPM, ${up.hist} changes)`);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(1200);
    const h = await E(page, () => {
      const o = window.overdub,
        p = o.store.get();
      return {
        step: o.start.step,
        rec: o.input.recorder.state,
        humming: o.input.recorder.humming?.(),
        tempo: p.tempo,
        hist: o.store.history.map((x) => `${x.label} (${x.by})`),
        drums: p.tracks.filter((tr) => tr.name === 'Drums').length,
      };
    });
    t.ok(
      !h.step &&
        h.tempo === 120 &&
        h.drums === 1 &&
        /^a beat to hum over, 4 bars at 120 BPM \(you\)$/.test(h.hist[0]) &&
        (h.rec === 'count' || h.rec === 'rec') &&
        h.humming,
      `H: the beat goes in, signed you, and the hum records over it with a bar to come in on (${h.rec}, humming ${h.humming}; ${h.hist.join(' / ')})`,
    );
    await E(page, () => window.overdub.input.recorder.cancel?.());
    t.ok(
      !real(o.errors).length,
      `hum a tune: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`,
    );
  } catch (e) {
    t.ok(false, 'hum threw: ' + (e.stack || e));
  } finally {
    await o.close();
  }
}

/* ================================================================ the liner notes, and a phone */
{
  console.log('\nliner notes and a phone');
  const o = await blank({ width: 390, height: 844 });
  const { page } = o;
  try {
    const wide = async () => E(page, () => document.documentElement.scrollWidth);
    const kit = async () =>
      E(page, () => {
        const els = [...document.querySelectorAll('.st-stage, .st-stage *, .st-door, .st-door *')];
        const round = els
          .filter((el) => {
            const r = getComputedStyle(el).borderTopLeftRadius;
            return /%/.test(r) || parseFloat(r) >= 8;
          })
          .map((el) => el.className);
        const stripe = els
          .filter((el) => {
            const s = getComputedStyle(el);
            return parseFloat(s.borderLeftWidth) >= 2 && s.borderLeftColor !== s.borderTopColor;
          })
          .map((el) => el.className);
        const inset = els
          .filter((el) => /inset \d+px 0 0/.test(getComputedStyle(el).boxShadow))
          .map((el) => el.className);
        return { round, stripe, inset };
      });
    const w0 = await wide();
    const k0 = await kit();
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(400);
    const p1 = await E(page, () => ({
      sw: document.documentElement.scrollWidth,
      pads: [...document.querySelectorAll('.st-pad')].map((p) => Math.round(p.getBoundingClientRect().height)),
      done: document.querySelector('.st-done').getBoundingClientRect(),
      vh: innerHeight,
      vw: innerWidth,
      full: document.querySelector('.st-stage').getBoundingClientRect().width,
    }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-phone-play.png') });
    const k1 = await kit();
    // a tap on a pad fires on pointerdown
    await page.dispatchEvent('.st-pad[data-row="kick"]', 'pointerdown');
    const tapped = await E(
      page,
      () => window.overdub.start.step === 'play' && document.querySelector('.st-status')?.textContent,
    );
    await E(page, () => window.overdub.start.again());
    await playRock(page);
    await page.click('.st-done');
    await page.waitForTimeout(500);
    const p2 = await E(page, () => ({
      sw: document.documentElement.scrollWidth,
      next: document.querySelector('.st-next')?.getBoundingClientRect(),
      vh: innerHeight,
      go: [...document.querySelectorAll('.st-stage .btn-go')].length,
    }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-phone-in.png') });
    const k2 = await kit();
    t.ok(
      w0 <= 390 && p1.sw <= 390 && p2.sw <= 390,
      `390 px: no sideways scroll on the door, the pads or the take (${w0}, ${p1.sw}, ${p2.sw})`,
    );
    t.ok(
      p1.pads.length === 4 && p1.pads.every((x) => x >= 120) && Math.round(p1.full) === p1.vw,
      `the stage is the whole phone; four pads, each ${p1.pads.join('/')} px tall`,
    );
    t.ok(
      p1.done.bottom <= p1.vh &&
        p1.done.height >= 44 &&
        p2.next &&
        p2.next.bottom <= p2.vh &&
        p2.next.height >= 44 &&
        p2.go === 1,
      `Done and the next part are inside the screen, ${Math.round(p1.done.height)} and ${Math.round(p2.next?.height)} px tall, one primary`,
    );
    t.ok(/^1 hit\.$/.test(tapped || ''), `a pad fires on pointerdown ("${tapped}")`);
    const bad = [k0, k1, k2].flatMap((k) => [...k.round, ...k.stripe, ...k.inset]);
    t.ok(
      !bad.length,
      `liner notes: no pills, no coloured side rules, no inset stripes on the door or the stage${bad.length ? ' (' + [...new Set(bad)].join(', ') + ')' : ''}`,
    );
    t.ok(
      !real(o.errors).length,
      `phone: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`,
    );
  } catch (e) {
    t.ok(false, 'phone threw: ' + (e.stack || e));
  } finally {
    await o.close();
  }
}

t.done();
