// Studio A's window (ui/editors/drumroom.js) and the names a drum kit gives its notes (core/music.js kitNotes):
//   the source  the drawing's layout is the kernel's (devices/builtin/drumroom.js LAYOUT is what the mics are built
//               from), the drawn cymbals are the kernel's sizes, Studio A names every note it plays, a song's device
//               names are read as text, and drumName answers per kit (Studio A, Gobo Kit, a kit that names none)
//   the window  it opens with the drawn kit and no keyboard strip; a click on each piece plays its note, where you hit
//               picks the stroke (the snare's middle, edge and rim, the hats' tip and edge, the ride's bell, bow and
//               edge), Alt the other one (side stick, chokes), and lower is louder; a drag up opens the hats and
//               letting go closes them; a choke cuts the light; the song lights what it plays and nothing else;
//               selecting a piece shows its controls and a knob drag is one undo step by you; the six mic faders and
//               the view set their params; the kit picker changes the kit and says what it is; an agent's change
//               flashes the piece and the knob; the keyboard plays and walks the pieces; the kick's foot (the floor
//               from its pedal across to floor tom 1) and the word "Kick" play the kick, and every piece's name plays
//               that piece
//   names       a Gobo Kit track's Beat rows say what Gobo plays and a Studio A track's say what Studio A plays; the
//               inspector agrees; More rows offers Studio A's articulations and adds one; get_device has the map
//   1280×800    the whole window fits, every mic fader in view, with the whole kit or any piece selected
//   a phone     a full sheet: the kit across the width, 44 px pieces, the selected piece under the kit, the mixer
//               scrolling sideways, 12 px text at the least, a tap plays; a cymbal held down is choked (a tap only
//               hits it), and the words are a touch's (hold a cymbal to choke it; nothing on the sheet says Alt)
//   no page errors anywhere.
//   node tools/drumroom-ui-test.js      screenshots: tools/.out/drumroom-*.png
import { open, tally, OUTDIR } from './pw.js';
import path from 'node:path';
import kitDef, { LAYOUT, PIECES, NOTE_MAP } from '../app/src/devices/builtin/drumroom.js';
import { kitNotes, drumName, KIT_NOTES } from '../app/src/core/music.js';

const T = tally('drumroom-ui');
const ok = T.ok;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ours = (errors) =>
  errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext|getUserMedia/.test(e));

/* ======================================================================== the source */
{
  const src = kitDef.kernel;
  const grab = (name) => {
    const m = new RegExp(`const ${name} = (\\[(?:\\[[^\\]]*\\],?)*\\]|\\[[^\\]]*\\])`).exec(src);
    return m ? JSON.parse(m[1]) : null;
  };
  const pos = grab('POS'),
    ohl = grab('OHL'),
    crm = grab('CRM');
  ok(
    JSON.stringify(pos) === JSON.stringify(PIECES.map((k) => LAYOUT.pieces[k])),
    `the kernel's piece positions are LAYOUT's, piece for piece (${pos?.length} pieces)`,
  );
  ok(
    JSON.stringify(ohl) === JSON.stringify(LAYOUT.overheads[0]) &&
      JSON.stringify(crm) === JSON.stringify(LAYOUT.crush) &&
      src.includes(`OHR = ${JSON.stringify(LAYOUT.overheads[1])}`) &&
      src.includes(`RML = ${JSON.stringify(LAYOUT.room[0])}`) &&
      src.includes(`RMR = ${JSON.stringify(LAYOUT.room[1])}`),
    'and so are its overheads, room pair and crush mic',
  );
  ok(!/__[A-Z]+__/.test(src), 'nothing in the kernel is left unfilled');
  const ed = await import('../app/src/ui/editors/drumroom.js');
  const kernelCym = [
    ...src.matchAll(/cym: \[\[(\d+),[^\]]*\], \[(\d+),[^\]]*\], \[(\d+),[^\]]*\], \[(\d+),[^\]]*\], \[(\d+),/g),
  ].map((m) => m.slice(1, 6).map(Number));
  ok(
    kernelCym.length === 5 && kernelCym.every((c, k) => JSON.stringify(c) === JSON.stringify(ed.KIT_LOOKS[k].cym)),
    `the drawn cymbals are the kernel's sizes, kit by kit (${kernelCym.map((c) => c.join('/')).join(', ')})`,
  );
  ok(
    kitDef.editor === 'drumroom' && typeof ed.mount === 'function',
    'Studio A names its editor, and the editor keeps the contract (mount)',
  );
  const notes = kitNotes(kitDef);
  const unnamed = NOTE_MAP.filter(([p]) => !notes[p]).map(([p]) => p);
  ok(
    !unnamed.length && notes.other === 'Side stick',
    `Studio A names every note it plays, and what any other note plays (${Object.keys(notes).length - 1} notes${unnamed.length ? '; not ' + unnamed.join(', ') : ''})`,
  );
  ok(
    notes[40] === 'Rimshot' &&
      notes[31] === 'Flam' &&
      notes[24] === 'Hat 1/2 open' &&
      notes[53] === 'Ride bell' &&
      notes[59] === 'Ride edge',
    'its names are its articulations: 40 Rimshot, 31 Flam, 24 Hat 1/2 open, 53 Ride bell, 59 Ride edge',
  );
  const odd = kitNotes({
    id: 'x.kit',
    notes: {
      36: 'Kick',
      37: { toString: 'x' },
      38: '  Snare\u0007 ',
      200: 'Nope',
      abc: 'no',
      other: 'Rim',
      39: 'x'.repeat(90),
    },
  });
  ok(
    odd &&
      odd[36] === 'Kick' &&
      odd[37] === undefined &&
      odd[38] === 'Snare' &&
      odd[200] === undefined &&
      odd.abc === undefined &&
      odd.other === 'Rim' &&
      odd[39].length === 40,
    `a song's device names are read as text: strings only, MIDI notes only, trimmed and capped (${JSON.stringify(odd)})`,
  );
  const gobo = { id: 'core.drums' };
  ok(
    drumName(40, notes) === 'Rimshot' &&
      drumName(40, kitNotes(gobo)) === 'Snare (40)' &&
      drumName(40, null) === 'Snare 2',
    `40 is Rimshot on Studio A, Snare (40) on Gobo Kit, GM's Snare 2 on a kit that names none`,
  );
  ok(
    drumName(52, notes) === 'China' &&
      drumName(52, kitNotes(gobo)) === 'Crash (52)' &&
      drumName(60, notes) === 'Side stick (60)' &&
      drumName(60, kitNotes(gobo)) === 'Rim (60)' &&
      drumName(60, null) === 'Hi bongo',
    "and 52 is a China or Gobo's crash; an unnamed 60 is what the kit plays there (or GM's bongo)",
  );
  ok(
    !!KIT_NOTES['core.drums'] && Object.values(KIT_NOTES['core.drums']).every((x) => typeof x === 'string'),
    "Gobo Kit's names are there for what it plays",
  );
}

/* ======================================================================== the window, on a desktop */
const s = await open('/app/', { query: 'demo' });
const { page, errors, shot } = s;
page.setDefaultTimeout(15000);
let kitTrack = null;
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await sleep(400);
  const E = (fn, arg) => page.evaluate(fn, arg);
  await E(() => document.querySelector('.ar-welcome-x')?.click());
  // a Studio A track with a beat (kick, hat, snare, crash: no china), and a Gobo Kit track with the same two odd notes
  const made = await E(() => {
    const a = window.overdub;
    const beat = [
      [36, 0],
      [42, 0.5],
      [38, 1],
      [42, 1.5],
      [36, 2],
      [49, 2.5],
      [38, 3],
      [40, 3.5],
    ].map(([p, t]) => ({ p, t, d: 0.25, v: 0.9 }));
    const r = a.store.dispatch(
      [
        {
          type: 'track.add',
          ref: 'k',
          track: { name: 'Kit A', kind: 'instrument', instrument: { device: 'core.drumroom', params: {} } },
        },
        { type: 'clip.add', track: '$k', ref: 'kc', clip: { start: 0, length: 4, name: 'Groove', notes: beat } },
        {
          type: 'track.add',
          ref: 'g',
          track: { name: 'Gobo', kind: 'instrument', instrument: { device: 'core.drums', params: {} } },
        },
        {
          type: 'clip.add',
          track: '$g',
          ref: 'gc',
          clip: {
            start: 0,
            length: 4,
            name: 'Odd',
            notes: [
              { p: 40, t: 0, d: 0.25, v: 0.8 },
              { p: 52, t: 1, d: 0.25, v: 0.8 },
            ],
          },
        },
      ],
      { by: 'you', label: 'drumroom test' },
    );
    return { kit: r.created.k, clip: r.created.kc, gobo: r.created.g, goboClip: r.created.gc };
  });
  kitTrack = made.kit;
  await E(() => {
    const a = window.overdub;
    window.__notes = [];
    const on = a.engine.liveNoteOn,
      off = a.engine.liveNoteOff;
    a.engine.liveNoteOn = (t, p, v) => {
      window.__notes.push(['on', t, p, +(+v).toFixed(3)]);
      return on.call(a.engine, t, p, v);
    };
    a.engine.liveNoteOff = (t, p) => {
      window.__notes.push(['off', t, p]);
      return off.call(a.engine, t, p);
    };
  });
  const notes = () => E(() => window.__notes.splice(0));

  /* -------- it opens with the drawn kit */
  await E((t) => window.overdub.plugin.open({ track: t, slot: 'instrument' }), kitTrack);
  for (let i = 0; i < 60 && (await E(() => document.querySelector('.pw')?.dataset.editor)) !== 'drumroom'; i++)
    await sleep(100);
  await sleep(400);
  const opened = await E(() => {
    const w = document.querySelector('.pw'),
      cv = w?.querySelector('.dr-stage canvas'),
      r = cv?.getBoundingClientRect();
    return {
      editor: w?.dataset.editor,
      rule: window.overdub.plugin.editorFor(window.overdub.devices.getDevice('core.drumroom')),
      cv: r ? [Math.round(r.width), Math.round(r.height)] : null,
      px: cv ? cv.width : 0,
      pieces: [...w.querySelectorAll('.dr-pc')].map((b) => b.dataset.piece),
      labels: [...w.querySelectorAll('.dr-pc')].every((b) => (b.getAttribute('aria-label') || '').length > 10),
      keys: !w.querySelector('.pw-keys:not([hidden])'),
      api: !!window.overdub.drumroom,
      every: window.overdub.devices
        .getDevice('core.drumroom')
        .params.every((p) => w.querySelector(`.pw-body .pk-ctl[data-key="${p.key}"]`)),
      overflow: w.querySelector('.pw-body').scrollWidth - w.querySelector('.pw-body').clientWidth,
      onScreen: (() => {
        const b = w.getBoundingClientRect();
        return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
      })(),
    };
  });
  ok(
    opened.editor === 'drumroom' && opened.rule === 'drumroom',
    `Studio A opens in its own window (editor ${opened.editor})`,
  );
  ok(
    opened.cv && opened.cv[0] >= 480 && opened.cv[1] >= 300 && opened.px > 0,
    `the kit is drawn (${opened.cv?.join('×')} px)`,
  );
  ok(
    opened.pieces.length === 16 && opened.labels,
    `each of the 16 pieces is a named button over the drawing (${opened.pieces.join(' ')})`,
  );
  ok(opened.keys, 'no keyboard strip: the drawn kit is the instrument');
  ok(
    opened.every && opened.overflow <= 1 && opened.onScreen,
    `every param has its control, nothing runs out sideways, the window is on screen (overflow ${opened.overflow})`,
  );
  await shot('drumroom-desktop');

  /* -------- a click plays the piece where you hit it */
  const clickAt = async (piece, o = {}, mods = []) => {
    const pt = await E(([p, z]) => window.overdub.drumroom.point(p, z), [piece, o]);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.click(pt.x, pt.y);
    for (const m of mods) await page.keyboard.up(m);
    await sleep(40);
    return notes();
  };
  await notes();
  const MAIN = {
    kick: 36,
    snare: 38,
    hat: 42,
    tom1: 50,
    tom2: 47,
    tom3: 45,
    tom4: 43,
    crash1: 49,
    crash2: 57,
    ride: 51,
    china: 52,
    splash: 55,
    tamb: 54,
    cowbell: 56,
    shaker: 70,
    clap: 39,
  };
  const wrong = [];
  for (const [piece, want] of Object.entries(MAIN)) {
    const got = await clickAt(piece, piece === 'ride' ? { zone: 'bow' } : {});
    const on = got.find((n) => n[0] === 'on');
    if (!on || on[1] !== kitTrack || on[2] !== want || !got.some((n) => n[0] === 'off' && n[2] === want))
      wrong.push(`${piece}: ${JSON.stringify(got)}`);
  }
  ok(
    !wrong.length,
    `a click on each piece plays its note on the track, and lets it go (${Object.keys(MAIN).length} pieces${wrong.length ? '; wrong: ' + wrong.join(' | ') : ''})`,
  );

  /* -------- the kick: the toms cover most of its shell, so its foot and its name are what you hit (FRESH-EYES-6) */
  // the floor before the batter head, from the pedal across to floor tom 1, at the height the name was drawn at
  const foot = await E(() => {
    const d = window.overdub.drumroom,
      pd = d.point('kick', { zone: 'pedal', at: 0.6 });
    let x = pd.x;
    while (x < pd.x + 400 && d.hit(x, pd.y)?.piece !== 'tom3') x++;
    return {
      px: x - pd.x,
      at: [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => {
        const h = d.hit(pd.x + (x - pd.x) * f, pd.y);
        return h ? `${h.piece} ${h.note}` : 'nothing';
      }),
    };
  });
  ok(
    foot.at.every((x) => x === 'kick 36'),
    `the floor before the kick, from its pedal across to floor tom 1 (${foot.px} px), plays the kick: ${foot.at.join(', ')}`,
  );
  const kickName = await E(() => window.overdub.drumroom.name?.('kick') || null);
  const onName = [];
  if (kickName)
    for (const x of [kickName.x, kickName.x - kickName.w / 2 + 3, kickName.x + kickName.w / 2 - 3]) {
      await page.mouse.click(x, kickName.y);
      await sleep(40);
      onName.push((await notes()).find((n) => n[0] === 'on')?.[2] ?? 'nothing');
    }
  ok(
    onName.length === 3 && onName.every((p) => p === 36),
    `a click on the word "Kick" plays the kick, 36: its middle and both ends (${kickName ? onName.join(', ') : 'the window does not say where it drew the name'})`,
  );
  const names = await E(() => {
    const d = window.overdub.drumroom,
      out = {};
    for (const p of [
      'kick',
      'snare',
      'hat',
      'tom1',
      'tom2',
      'tom3',
      'tom4',
      'crash1',
      'crash2',
      'ride',
      'china',
      'splash',
      'tamb',
      'cowbell',
      'shaker',
      'clap',
    ]) {
      const n = d.name?.(p);
      if (!n) {
        out[p] = 'no name';
        continue;
      }
      const at = (x) => d.hit(x, n.y, { touch: false })?.piece || 'nothing';
      out[p] = [at(n.x), at(n.x - n.w / 2 + 2), at(n.x + n.w / 2 - 2)];
    }
    return out;
  });
  const misnamed = Object.entries(names).filter(([p, at]) => !Array.isArray(at) || at.some((x) => x !== p));
  ok(
    !misnamed.length,
    `every piece's name, where it is drawn, plays that piece (16 names, middle and ends${misnamed.length ? '; not: ' + misnamed.map(([p, at]) => `${p} -> ${at}`).join(' | ') : ''})`,
  );
  const z = async (piece, zone, mods = []) => (await clickAt(piece, { zone }, mods)).find((n) => n[0] === 'on')?.[2];
  const zones = {
    snareCenter: await z('snare', 'center'),
    snareEdge: await z('snare', 'edge'),
    snareRim: await z('snare', 'rim'),
    side: await z('snare', 'center', ['Alt']),
    hatTip: await z('hat', 'tip'),
    hatEdge: await z('hat', 'edge'),
    pedal: await z('hat', 'pedal'),
    splashFoot: await z('hat', 'pedal', ['Alt']),
    bell: await z('ride', 'bell'),
    bow: await z('ride', 'bow'),
    rideEdge: await z('ride', 'edge'),
  };
  ok(
    zones.snareCenter === 38 && zones.snareEdge === 34 && zones.snareRim === 40 && zones.side === 37,
    `the snare: the middle 38, near the edge 34, the rim a rimshot 40, Alt the side stick 37 (${zones.snareCenter} ${zones.snareEdge} ${zones.snareRim} ${zones.side})`,
  );
  ok(
    zones.hatTip === 42 && zones.hatEdge === 22 && zones.pedal === 44 && zones.splashFoot === 21,
    `the hats: the tip 42, the edge 22, the pedal 44, Alt on the pedal the foot splash 21 (${zones.hatTip} ${zones.hatEdge} ${zones.pedal} ${zones.splashFoot})`,
  );
  ok(
    zones.bell === 53 && zones.bow === 51 && zones.rideEdge === 59,
    `the ride: the bell 53, the bow 51, the edge 59 (${zones.bell} ${zones.bow} ${zones.rideEdge})`,
  );
  const vAt = async (piece, zone, at) => (await clickAt(piece, { zone, at })).find((n) => n[0] === 'on')?.[3];
  const vel = {
    top: await vAt('snare', 'center', 0.05),
    mid: await vAt('snare', 'center', 0.5),
    low: await vAt('snare', 'center', 0.95),
    kickTop: await vAt('kick', 'pedal', 0.05),
    kickLow: await vAt('kick', 'pedal', 0.95),
  };
  ok(
    vel.top < vel.mid && vel.mid < vel.low && vel.top <= 0.3 && Math.abs(vel.mid - 0.6) < 0.05 && vel.low >= 0.9,
    `lower on a piece is louder: the snare's middle near its top ${vel.top} (a ghost), halfway ${vel.mid}, near its bottom ${vel.low}`,
  );
  ok(vel.kickTop < vel.kickLow, `and on the kick's pedal (${vel.kickTop} to ${vel.kickLow})`);
  const cap = await E(() => {
    const pt = window.overdub.drumroom.point('snare', { zone: 'rim' });
    return pt;
  });
  await page.mouse.move(cap.x, cap.y);
  await sleep(120);
  const hoverCap = await E(() => document.querySelector('.dr-cap').textContent);
  ok(
    /^Snare, rimshot: note 40, velocity \d+\. Plays 38 center, 34 edge, 40 rimshot, 37 side stick, 31 flam, 32 drag, 33 roll\.$/.test(
      hoverCap,
    ),
    `hovering says what a click there plays, and every note that plays the piece ("${hoverCap}")`,
  );
  await page.mouse.move(5, 5);

  /* -------- the hats open on a drag and close when you let go */
  await notes();
  const hp = await E(() => window.overdub.drumroom.point('hat', { zone: 'tip', at: 0.6 }));
  await page.mouse.move(hp.x, hp.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(hp.x, hp.y - i * 6);
    await sleep(16);
  }
  await sleep(120);
  const mid = { open: await E(() => window.overdub.drumroom.hat()), notes: await notes() };
  await page.mouse.up();
  await sleep(60);
  const after = { notes: await notes(), open: await E(() => window.overdub.drumroom.hat()) };
  const ons = mid.notes.filter((n) => n[0] === 'on').map((n) => n[2]);
  ok(
    ons[0] === 42 && ons.includes(46) && mid.open === 1,
    `a drag up on the hats: the stroke, then they open (${ons.join(', ')}; open ${mid.open})`,
  );
  ok(
    after.notes.some((n) => n[0] === 'on' && n[2] === 44) && after.open === 0,
    `letting go closes them with the foot (${after.notes
      .filter((n) => n[0] === 'on')
      .map((n) => n[2])
      .join(', ')}; open ${after.open})`,
  );

  /* -------- a cymbal choke: Alt-click, and its light is cut */
  const choke = await z('crash1', null, ['Alt']);
  await sleep(450);
  const chokeLit = await E(() => window.overdub.drumroom.lit('crash1'));
  await z('crash1');
  await sleep(450);
  const hitLit = await E(() => window.overdub.drumroom.lit('crash1'));
  const chokes = {
    crash2: await z('crash2', null, ['Alt']),
    ride: await z('ride', 'bow', ['Alt']),
    china: await z('china', null, ['Alt']),
    splash: await z('splash', null, ['Alt']),
  };
  ok(
    choke === 27 && chokes.crash2 === 28 && chokes.ride === 25 && chokes.china === 29 && chokes.splash === 30,
    `Alt-click chokes a cymbal: crash 27, crash 2 28, ride 25, china 29, splash 30 (${choke} ${chokes.crash2} ${chokes.ride} ${chokes.china} ${chokes.splash})`,
  );
  ok(
    chokeLit < 0.05 && hitLit > 0.2,
    `a choked crash goes dark at once, a crash left to ring stays lit (${chokeLit.toFixed(3)} vs ${hitLit.toFixed(3)} after 0.45 s)`,
  );

  /* -------- the song lights what it plays */
  const lit = await E(async () => {
    const a = window.overdub,
      d = a.drumroom;
    await new Promise((r) => setTimeout(r, 3500)); // (everything played by hand has gone dark)
    const before = Object.fromEntries(['kick', 'snare', 'hat', 'crash1', 'china'].map((k) => [k, d.lit(k)]));
    await a.engine.start?.();
    a.engine.seek?.(0);
    a.engine.play(0);
    const max = {};
    const t0 = performance.now();
    while (performance.now() - t0 < 2300) {
      for (const k of ['kick', 'snare', 'hat', 'crash1', 'china', 'tom1']) max[k] = Math.max(max[k] || 0, d.lit(k));
      await new Promise((r) => setTimeout(r, 25));
    }
    a.engine.stop();
    return { before, max, beat: a.engine.beat };
  });
  ok(
    lit.max.kick > 0.5 && lit.max.snare > 0.5 && lit.max.hat > 0.5 && lit.max.crash1 > 0.5,
    `while the song plays, what it plays lights up (kick ${lit.max.kick.toFixed(2)}, snare ${lit.max.snare.toFixed(2)}, hat ${lit.max.hat.toFixed(2)}, crash ${lit.max.crash1.toFixed(2)})`,
  );
  ok(
    lit.max.china === 0 && lit.max.tom1 === 0,
    `and nothing else does (china ${lit.max.china}, rack tom 1 ${lit.max.tom1})`,
  );
  await sleep(200);
  const fades = await E(async () => {
    const d = window.overdub.drumroom;
    const k0 = d.lit('kick'),
      c0 = d.lit('crash1');
    await new Promise((r) => setTimeout(r, 700));
    return { k0, c0, k1: d.lit('kick'), c1: d.lit('crash1') };
  });
  ok(
    fades.k1 < 0.02 && fades.c1 > 0.05,
    `each light fades with its piece's ring: the kick's is gone in under a second, the crash's still glows (kick ${fades.k1.toFixed(3)}, crash ${fades.c1.toFixed(3)})`,
  );

  /* -------- selecting a piece shows its controls; a knob drag is one undo step by you */
  await clickAt('snare');
  const sel = await E(() => ({
    selected: window.overdub.drumroom.selected,
    shown: [...document.querySelectorAll('.dr-sel:not([hidden]) .pk-ctl[data-key]')].map((x) => x.dataset.key),
    head: document.querySelector('.dr-sel:not([hidden]) h3')?.textContent,
    arts: [...document.querySelectorAll('.dr-sel:not([hidden]) .dr-art')].map((b) => b.dataset.note).join(' '),
  }));
  ok(
    sel.selected === 'snare' &&
      sel.head === 'Snare' &&
      ['snare_tune', 'snare_decay', 'snare_level', 'snare_wires'].every((k) => sel.shown.includes(k)) &&
      sel.shown.length === 4,
    `a click selects the piece: its tune, decay, level and wires beside the kit (${sel.shown.join(', ')})`,
  );
  ok(sel.arts === '38 34 40 37 31 32 33', `and a key for every way to play it (${sel.arts})`);
  const kd = await E(() => {
    const d = document.querySelector('.dr-sel:not([hidden]) .pk-ctl[data-key="snare_tune"] [role=slider]');
    d.scrollIntoView({ block: 'nearest' });
    const r = d.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h0: window.overdub.store.history.length };
  });
  await page.mouse.move(kd.x, kd.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(kd.x, kd.y - i * 6);
  await page.mouse.up();
  await sleep(120);
  const drag = await E(
    ({ h0, t }) => {
      const a = window.overdub,
        last = a.store.history[a.store.history.length - 1];
      return {
        steps: a.store.history.length - h0,
        by: last.by,
        type: last.ops[0].type,
        v: a.store.track(t).instrument.params.snare_tune,
      };
    },
    { h0: kd.h0, t: kitTrack },
  );
  ok(
    drag.steps === 1 && drag.by === 'you' && drag.type === 'instrument.set' && drag.v > 0,
    `a drag on the snare's tune is one undo step, an instrument.set by you (${drag.steps} step, +${drag.v} st)`,
  );
  await E(() => window.overdub.store.undo());
  ok(
    await E((t) => !(window.overdub.store.track(t).instrument.params.snare_tune > 0), kitTrack),
    'one undo takes it back',
  );
  const hold = await E(async () => {
    const b = document.querySelector('.dr-sel:not([hidden]) .dr-art[data-note="33"]');
    window.__notes.length = 0;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7 }));
    await new Promise((r) => setTimeout(r, 120));
    const during = window.__notes.slice(),
      held = b.classList.contains('on');
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 7 }));
    return { during, held, after: window.__notes.slice() };
  });
  ok(
    hold.during.length === 1 &&
      hold.during[0][2] === 33 &&
      hold.held &&
      hold.after.some((n) => n[0] === 'off' && n[2] === 33),
    'holding the Roll key holds the roll: the note goes on, and off when you let go',
  );
  await notes();

  /* -------- the mic mixer */
  const mixer = await E(async () => {
    const a = window.overdub,
      t = a.plugin.current.track,
      out = {};
    for (const k of ['mix_close', 'mix_oh', 'mix_room', 'mix_crush', 'bleed', 'room_size']) {
      const d = document.querySelector(`.dr-strip .pk-ctl[data-key="${k}"] [role=slider]`);
      if (!d) {
        out[k] = 'missing';
        continue;
      }
      const v0 =
        a.store.track(t).instrument.params[k] ??
        a.devices.getDevice('core.drumroom').params.find((p) => p.key === k).def;
      d.focus();
      for (let i = 0; i < 3; i++)
        d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 30));
      const v1 = a.store.track(t).instrument.params[k];
      out[k] = { v0, v1, up: v1 > v0, vert: d.getAttribute('aria-orientation') };
    }
    return out;
  });
  const bad = Object.entries(mixer).filter(([, x]) => !x.up || x.vert !== 'vertical');
  ok(
    !bad.length,
    `the six channel strips are faders that set their params: ${Object.entries(mixer)
      .map(([k, x]) => `${k} ${x.v0}→${x.v1}`)
      .join(', ')}`,
  );
  const fd = await E(() => {
    const d = document.querySelector('.dr-strip .pk-ctl[data-key="mix_room"] [role=slider]');
    const r = d.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.5, h0: window.overdub.store.history.length };
  });
  await page.mouse.move(fd.x, fd.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(fd.x, fd.y - i * 8);
  await page.mouse.up();
  await sleep(80);
  const fdrag = await E(
    ({ h0, t }) => {
      const a = window.overdub;
      return {
        steps: a.store.history.length - h0,
        v: a.store.track(t).instrument.params.mix_room,
        by: a.store.history.at(-1).by,
      };
    },
    { h0: fd.h0, t: kitTrack },
  );
  ok(fdrag.steps === 1 && fdrag.by === 'you', `a drag on the ROOM fader is one step by you (room ${fdrag.v} dB)`);
  await E(() => window.overdub.store.undo());
  await page.click('.dr-view .pk-seg-b:nth-child(2)');
  await sleep(400);
  const turned = await E(
    (t) => ({ view: window.overdub.store.track(t).instrument.params.view, drawn: window.overdub.drumroom.view }),
    kitTrack,
  );
  ok(
    turned.view === 1 && turned.drawn === 'audience',
    `VIEW AUDIENCE turns the stereo picture and the drawing round (${turned.view}, ${turned.drawn})`,
  );
  const turnedHat = await z('hat', 'tip');
  ok(turnedHat === 42, 'and the turned kit still plays where you click (the hats, now on the right)');
  await shot('drumroom-audience');
  await page.click('.dr-view .pk-seg-b:nth-child(1)');
  await sleep(300);
  await notes();

  /* -------- the kit picker */
  const k0 = await E(() => {
    window.overdub.drumroom.select('snare');
    return document.querySelector('.dr-kitline').textContent;
  });
  await page.click('.dr-kit .pk-seg-b:nth-child(2)');
  await sleep(150);
  const picked = await E(
    (t) => ({
      kit: window.overdub.store.track(t).instrument.params.kit,
      line: document.querySelector('.dr-kitline').textContent,
      look: window.overdub.drumroom.look.kit,
      meta: document.querySelector('.dr-sel:not([hidden]) .dr-sel-m')?.textContent,
      last: window.overdub.store.history.at(-1).by,
    }),
    kitTrack,
  );
  ok(
    /maple, deep and round/i.test(k0) &&
      picked.kit === 1 &&
      /birch/i.test(picked.line) &&
      picked.look === 'BIRCH' &&
      /birch/.test(picked.meta || '') &&
      picked.last === 'you',
    `the kit picker says what each kit is and picks it: "${picked.line}" (the drawing is the ${picked.look} kit; ${picked.meta})`,
  );
  const hovered = await E(() => {
    const b = document.querySelectorAll('.dr-kit .pk-seg-b')[2];
    b.dispatchEvent(new PointerEvent('pointerenter'));
    const t = document.querySelector('.dr-kitline').textContent;
    b.dispatchEvent(new PointerEvent('pointerleave'));
    return t;
  });
  ok(/small kit tuned up/.test(hovered), `pointing at a kit says what it is before you pick it ("${hovered}")`);
  await shot('drumroom-birch');

  /* -------- an agent's change flashes the piece and its knob */
  const ag = await E((t) => {
    const a = window.overdub;
    a.store.dispatch(
      { type: 'instrument.set', track: t, params: { snare_tune: 3, mix_oh: -6 } },
      { by: 'claude', label: 'a higher snare' },
    );
    return {
      snare: a.drumroom.flashing('snare'),
      oh: a.drumroom.flashing('oh'),
      knob: document.querySelector('.pk-ctl[data-key="snare_tune"]').classList.contains('pk-flash'),
      fader: document.querySelector('.pk-ctl[data-key="mix_oh"]').classList.contains('pk-flash'),
      status: document.querySelector('.pw .pw-status').textContent,
    };
  }, kitTrack);
  ok(
    ag.snare && ag.knob,
    `an agent's change flashes the snare in the drawing and its tune knob (${ag.snare}, ${ag.knob})`,
  );
  ok(
    ag.oh && ag.fader && /^Claude moved 2 controls/.test(ag.status),
    `and the overheads it moved, with the bar saying so ("${ag.status}")`,
  );
  await sleep(1900);
  ok(
    await E(() => !window.overdub.drumroom.flashing('snare') && !document.querySelector('.pw .pk-flash')),
    'and the flash fades',
  );

  /* -------- the keyboard: a piece is a button; Enter or Space plays; the arrows walk the kit */
  await notes();
  const kb = await E(async () => {
    const b = document.querySelector('.dr-pc[data-piece="snare"]');
    b.focus();
    const tabStops = [...document.querySelectorAll('.dr-pc')].filter((x) => x.tabIndex === 0).length;
    return {
      focused: document.activeElement === b,
      tabStops,
      sel: window.overdub.drumroom.selected,
      cap: document.querySelector('.dr-cap').textContent,
    };
  });
  await page.keyboard.down('Enter');
  await sleep(30);
  await page.keyboard.up('Enter');
  await page.keyboard.down('Space');
  await sleep(30);
  await page.keyboard.up('Space');
  await sleep(40);
  const played = await notes();
  const playing = await E(() => !!window.overdub.engine.playing);
  ok(
    kb.focused && kb.tabStops === 1 && kb.sel === 'snare' && /Enter plays it/.test(kb.cap),
    `a piece takes focus (one Tab stop for the kit) and says how to play it ("${kb.cap.slice(0, 60)}…")`,
  );
  ok(
    played.filter((n) => n[0] === 'on' && n[2] === 38).length === 2 &&
      played.filter((n) => n[0] === 'off' && n[2] === 38).length === 2 &&
      !playing,
    `Enter and Space play the focused piece (and Space doesn't start the song): ${JSON.stringify(played.map((n) => n[0] + n[2]))}`,
  );
  await page.keyboard.press('ArrowRight');
  const moved = await E(() => ({
    piece: document.activeElement?.dataset.piece,
    sel: window.overdub.drumroom.selected,
  }));
  ok(
    moved.piece && moved.piece !== 'snare' && moved.sel === moved.piece,
    `the arrow keys move to the next piece and select it (${moved.piece})`,
  );
  await E(() => document.querySelector('.dr-pc[data-piece="crash1"]').focus());
  await page.keyboard.down('Alt');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await page.keyboard.up('Alt');
  await sleep(30);
  ok(
    (await notes()).some((n) => n[0] === 'on' && n[2] === 27),
    'Alt+Enter on a cymbal chokes it',
  );
  await E(() => {
    document.activeElement?.blur();
    window.overdub.plugin.close();
  });

  /* -------- names that belong to the device: the Beat tab, the inspector, More rows */
  const rowsOf = async (track, clip) => {
    await E(
      ({ track, clip }) => {
        const a = window.overdub;
        a.ui.select({ track, clip, notes: [] });
        a.ui.show('drumgrid');
      },
      { track, clip },
    );
    await sleep(250);
    return E(() => ({
      rows: window.overdub.drumgrid.rows(),
      labels: [...document.querySelectorAll('[data-panel="drumgrid"] .dg-row')].map((b) => [
        +b.dataset.p,
        b.querySelector('.dg-rowname').textContent,
      ]),
    }));
  };
  const g = await rowsOf(made.gobo, made.goboClip),
    k = await rowsOf(made.kit, made.clip);
  const nameIn = (x, p) => x.labels.find((r) => r[0] === p)?.[1];
  ok(
    nameIn(g, 40) === 'Snare (40)' && nameIn(g, 52) === 'Crash (52)' && nameIn(g, 36) === 'Kick',
    `a Gobo Kit clip's Beat rows say what Gobo plays: 40 "${nameIn(g, 40)}", 52 "${nameIn(g, 52)}"`,
  );
  ok(
    nameIn(k, 40) === 'Rimshot' &&
      nameIn(k, 50) === 'Rack tom 1' &&
      nameIn(k, 43) === undefined &&
      nameIn(k, 45) === 'Floor tom 1',
    `a Studio A clip's say what Studio A plays: 40 "${nameIn(k, 40)}", 50 "${nameIn(k, 50)}", 45 "${nameIn(k, 45)}"`,
  );
  const insp = await E(
    ({ track, clip }) => {
      const a = window.overdub,
        c = a.store.findClip(clip).clip;
      a.ui.select({ track, clip, notes: c.notes.map((n) => n.id) });
      a.ui.show('inspector');
      return new Promise((r) =>
        setTimeout(
          () =>
            r(
              [...document.querySelectorAll('.in-facts .in-fact, .in-facts > *')].map((x) => x.textContent).join(' | '),
            ),
          200,
        ),
      );
    },
    { track: made.gobo, clip: made.goboClip },
  );
  ok(
    /Snare \(40\)/.test(insp) && /Crash \(52\)/.test(insp),
    `the inspector names a Gobo clip's hits the same way ("${insp.slice(0, 80)}")`,
  );
  await rowsOf(made.kit, made.clip);
  await page.click('[data-panel="drumgrid"] .dg-more');
  await page.waitForSelector('.ek-pop[role=menu]');
  const more = await E(() => [...document.querySelectorAll('.ek-pop[role=menu] .ek-item')].map((b) => b.textContent));
  const want = ['Hat 1/2 open', 'Ride bell', 'Ride edge', 'Flam', 'Hat edge', 'Crash choke'];
  ok(
    want.every((w) => more.some((m) => m.startsWith(w))) && !more.some((m) => m.startsWith('Rimshot')),
    `More rows on a Studio A clip offers its articulations (${more.length}: ${more.slice(0, 8).join(', ')}…), not the rows already there (Rimshot)`,
  );
  await page.click('.ek-pop[role=menu] .ek-item:has-text("Flam")');
  await sleep(150);
  const withFlam = await E(() => window.overdub.drumgrid.rows());
  ok(
    withFlam.some((r) => r.p === 31 && r.name === 'Flam'),
    `picking one adds its row (${withFlam.map((r) => r.name).join(', ')})`,
  );
  await shot('drumroom-beat-rows');
  const many = await E(async () => {
    const a = window.overdub;
    for (const p of [22, 23, 24, 26, 21, 44, 53, 59, 25, 27, 52, 55, 57, 32, 33, 34]) a.drumgrid.addRow(p);
    await new Promise((r) => setTimeout(r, 250));
    const main = a.drumgrid.scroller(),
      rows = a.drumgrid.rows();
    main.scrollTop = main.scrollHeight;
    await new Promise((r) => setTimeout(r, 120));
    const last = [...document.querySelectorAll('[data-panel="drumgrid"] .dg-row')].pop().getBoundingClientRect(),
      box = main.getBoundingClientRect();
    return {
      n: rows.length,
      scroll: main.scrollHeight > main.clientHeight + 4,
      cls: document.querySelector('.dg').classList.contains('dg-scroll'),
      rowH: a.drumgrid.rowH(),
      reach: last.bottom <= box.bottom + 1 && last.top >= box.top,
    };
  });
  ok(
    many.scroll && many.cls && many.rowH >= 16 && many.reach,
    `with more rows than fit, the grid scrolls up and down and keeps 16 px rows (${many.n} rows at ${many.rowH} px; the last one in reach)`,
  );
  await E(async () => {
    const a = window.overdub;
    await new Promise((r) => setTimeout(r, 0));
    a.ui.state.beatRows = {};
    a.drumgrid.scroller().scrollTop = 0;
  });
  await rowsOf(made.gobo, made.goboClip);
  await page.click('[data-panel="drumgrid"] .dg-more');
  await page.waitForSelector('.ek-pop[role=menu]');
  const goboMore = await E(() =>
    [...document.querySelectorAll('.ek-pop[role=menu] .ek-item')].map((b) => b.textContent),
  );
  await page.keyboard.press('Escape');
  ok(
    !goboMore.some((m) => /Flam|Hat 1\/2/.test(m)) && goboMore.some((m) => /Low floor tom/.test(m)),
    `on Gobo Kit it offers Gobo's (${goboMore.slice(0, 5).join(', ')}…)`,
  );

  /* -------- agents: get_device has the note map */
  const gd = await E(async () => {
    const a = window.overdub;
    const sa = await a.tools.run('get_device', { id: 'core.drumroom' }, { by: 'claude' });
    const gk = await a.tools.run('get_device', { id: 'core.drums' }, { by: 'claude' });
    const bass = await a.tools.run('get_device', { id: 'core.bass' }, { by: 'claude' });
    return { sa: sa.notes, hint: sa.notes_hint, gk: gk.notes, bass: 'notes' in bass };
  });
  ok(
    gd.sa &&
      gd.sa[40] === 'Rimshot' &&
      gd.sa[31] === 'Flam' &&
      gd.sa[33] === 'Roll' &&
      gd.sa.other === 'Side stick' &&
      /MIDI note/.test(gd.hint || ''),
    `get_device on Studio A has its note map (${Object.keys(gd.sa || {}).length} entries: 40 ${gd.sa?.[40]}, 31 ${gd.sa?.[31]}, other: ${gd.sa?.other})`,
  );
  ok(
    gd.gk && gd.gk[40] === 'Snare (40)' && gd.gk.other === 'Rim' && !gd.bass,
    'and on Gobo Kit its own; a bass has none',
  );
  const prompt = await E(async () => (await import('/app/src/agent/prompt.js')).NOTES_FORMAT);
  ok(
    /Studio A \(core\.drumroom\) also plays rows rimshot/.test(prompt) &&
      /get_device on a drum kit gives its own names/.test(prompt),
    "the agent's guide names Studio A's rows and the note map",
  );

  ok(
    !ours(errors).length,
    `desktop: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`,
  );
} catch (e) {
  ok(false, 'desktop run threw: ' + ((e && e.stack) || e));
}

/* ======================================================================== 1280 by 800: the whole window, no scrolling */
// (FRESH-EYES-6: the mic faders sat 97 px below the fold there)
{
  const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p3 = await ctx.newPage();
  const errs = [];
  p3.on('pageerror', (e) => errs.push('pageerror: ' + ((e && e.stack) || e)));
  try {
    await p3.goto(s.base + '/app/?demo', { waitUntil: 'load' });
    await p3.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await p3.evaluate(() => document.querySelector('.ar-welcome-x')?.click());
    await p3.evaluate(() => {
      const a = window.overdub;
      const r = a.store.dispatch(
        {
          type: 'track.add',
          ref: 'k',
          track: { name: 'Kit A', kind: 'instrument', instrument: { device: 'core.drumroom', params: {} } },
        },
        { by: 'you', label: 'kit' },
      );
      a.plugin.open({ track: r.created.k, slot: 'instrument' });
    });
    for (
      let i = 0;
      i < 60 && (await p3.evaluate(() => document.querySelector('.pw')?.dataset.editor)) !== 'drumroom';
      i++
    )
      await sleep(100);
    await sleep(500);
    const fit = await p3.evaluate(async () => {
      const out = [];
      for (const piece of [
        null,
        'kick',
        'snare',
        'hat',
        'tom1',
        'tom2',
        'tom3',
        'tom4',
        'crash1',
        'crash2',
        'ride',
        'china',
        'splash',
        'tamb',
      ]) {
        window.overdub.drumroom.select(piece);
        await new Promise((r) => setTimeout(r, 60));
        const w = document.querySelector('.pw'),
          body = w.querySelector('.pw-body'),
          b = body.getBoundingClientRect(),
          wr = w.getBoundingClientRect();
        const strips = [...w.querySelectorAll('.dr-strip')].map((x) => x.getBoundingClientRect());
        out.push({
          piece: piece || 'the whole kit',
          scroll: body.scrollHeight - body.clientHeight,
          below: Math.max(0, ...strips.map((r) => Math.ceil(r.bottom - Math.min(b.bottom, innerHeight)))),
          onScreen: wr.top >= 0 && wr.left >= 0 && wr.bottom <= innerHeight && wr.right <= innerWidth,
        });
      }
      return out;
    });
    const bad = fit.filter((x) => x.scroll > 0 || x.below > 0 || !x.onScreen);
    T.ok(
      !bad.length,
      `1280×800: Studio A's window fits whole, every mic fader in view, with the whole kit or any piece selected (${bad.length ? bad.map((x) => `${x.piece}: scrolls ${x.scroll} px, faders ${x.below} px below`).join('; ') : fit.length + ' views'})`,
    );
    await p3.screenshot({ path: path.join(OUTDIR, 'drumroom-1280.png') });
    T.ok(
      !ours(errs).length,
      `1280×800: no page errors${ours(errs).length ? ': ' + ours(errs).slice(0, 3).join(' | ') : ''}`,
    );
  } catch (e) {
    T.ok(false, '1280×800 run threw: ' + ((e && e.stack) || e));
  }
  await ctx.close();
}

/* ======================================================================== a phone: a full sheet, the kit across it */
{
  const ctx = await s.browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page2 = await ctx.newPage();
  const errs = [];
  page2.on('pageerror', (e) => errs.push('pageerror: ' + ((e && e.stack) || e)));
  page2.on('console', (m) => {
    if (m.type() === 'error') errs.push('console: ' + m.text());
  });
  try {
    await page2.goto(s.base + '/app/?demo', { waitUntil: 'load' });
    await page2.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(500);
    const E = (fn, arg) => page2.evaluate(fn, arg);
    const t = await E(() => {
      const a = window.overdub;
      const r = a.store.dispatch(
        {
          type: 'track.add',
          ref: 'k',
          track: { name: 'Kit A', kind: 'instrument', instrument: { device: 'core.drumroom', params: {} } },
        },
        { by: 'you', label: 'kit' },
      );
      a.plugin.open({ track: r.created.k, slot: 'instrument' });
      return r.created.k;
    });
    for (let i = 0; i < 60 && (await E(() => document.querySelector('.pw')?.dataset.editor)) !== 'drumroom'; i++)
      await sleep(100);
    await sleep(500);
    await E(() => {
      window.__notes = [];
      const a = window.overdub,
        on = a.engine.liveNoteOn;
      a.engine.liveNoteOn = (tr, p, v) => {
        window.__notes.push([tr, p, v]);
        return on.call(a.engine, tr, p, v);
      };
    });
    const capBefore = await E(() => document.querySelector('.pw .dr-cap').textContent); // (what it says before a tap)
    const pt = await E(() => window.overdub.drumroom.point('snare', { zone: 'center' }));
    await page2.touchscreen.tap(pt.x, pt.y);
    await sleep(150);
    const m = await E(() => {
      const w = document.querySelector('.pw'),
        r = w.getBoundingClientRect(),
        st = w.querySelector('.dr-stage').getBoundingClientRect();
      const box = (q) =>
        [...w.querySelectorAll(q)]
          .filter((x) => x.getClientRects().length)
          .map((x) => {
            const b = x.getBoundingClientRect();
            return [Math.round(b.width), Math.round(b.height)];
          });
      const texts = [...w.querySelectorAll('.pw-body *')].filter(
        (x) => x.getClientRects().length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
      );
      const small = texts
        .map((x) => [x.className, parseFloat(getComputedStyle(x).fontSize), x.textContent.trim().slice(0, 16)])
        .filter((x) => x[1] < 12);
      const sel = w.querySelector('.dr-sel:not([hidden])').getBoundingClientRect(),
        strips = w.querySelector('.dr-strips');
      return {
        sheet: r.left === 0 && r.top === 0 && Math.round(r.width) === innerWidth,
        stage: [Math.round(st.left), Math.round(st.width)],
        vw: innerWidth,
        pieces: box('.dr-pc'),
        arts: box('.dr-sel:not([hidden]) .dr-art'),
        small,
        selBelow: sel.top >= st.bottom,
        selName: w.querySelector('.dr-sel:not([hidden]) h3')?.textContent,
        scrolls: strips.scrollWidth > strips.clientWidth && getComputedStyle(strips).overflowX === 'auto',
        sideways: document.scrollingElement.scrollWidth - innerWidth,
        notes: window.__notes.slice(),
        cap: w.querySelector('.dr-cap').textContent,
      };
    });
    await page2.screenshot({ path: path.join(OUTDIR, 'drumroom-phone.png') });
    T.ok(
      m.sheet && m.stage[0] >= 12 && m.stage[0] <= 20 && Math.abs(m.stage[1] - (m.vw - 2 * m.stage[0])) <= 2,
      `phone: a full sheet, the kit across its width (${m.stage[1]} px of ${m.vw}, a ${m.stage[0]} px gutter)`,
    );
    T.ok(
      m.pieces.length === 16 && m.pieces.every(([w, h]) => w >= 44 && h >= 44),
      `phone: every piece is a 44 px target (smallest ${Math.min(...m.pieces.map(([w, h]) => Math.min(w, h)))} px)`,
    );
    T.ok(
      m.notes.some((n) => n[0] === t && n[1] === 38) && /^Snare/.test(m.cap),
      `phone: a tap on the snare plays it, and the caption says what it played ("${m.cap.slice(0, 50)}")`,
    );
    T.ok(
      m.selBelow && m.selName === 'Snare' && m.arts.length && m.arts.every(([, h]) => h >= 44),
      `phone: the tapped piece's controls sit under the kit, its keys 44 px tall (${m.selName})`,
    );
    T.ok(m.scrolls && m.sideways <= 0, `phone: the mixer scrolls sideways, the page doesn't (${m.sideways})`);
    T.ok(
      !m.small.length,
      `phone: no text under 12 px${
        m.small.length
          ? ' (' +
            m.small
              .slice(0, 4)
              .map((x) => `${x[0]} ${x[1]}px "${x[2]}"`)
              .join('; ') +
            ')'
          : ''
      }`,
    );
    // a touch has no Alt: a cymbal held down is a hand closing on it, its choke (FRESH-EYES-6), and the sheet says so
    const cdp = await ctx.newCDPSession(page2);
    const touch = async (piece, ms) => {
      const p = await E(
        (x) => window.overdub.drumroom.point(x, { zone: x === 'ride' ? 'bow' : null, touch: true }),
        piece,
      );
      await E(() => {
        window.__notes.length = 0;
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await sleep(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(80);
      return E(() => window.__notes.map((n) => n[1]).join(' then '));
    };
    const held = await touch('crash1', 700),
      tapped = await touch('crash1', 60),
      rideHeld = await touch('ride', 700);
    T.ok(
      held === '49 then 27' && rideHeld === '51 then 25' && tapped === '49',
      `phone: a cymbal held down is choked (crash 1: ${held || 'nothing'}; ride: ${rideHeld || 'nothing'}), a tap only hits it (${tapped || 'nothing'})`,
    );
    const said = await E(() => {
      const w = document.querySelector('.pw'),
        shown = (x) => x.getClientRects().length > 0;
      const alt = [...w.querySelectorAll('.pw-body *')]
        .filter((x) => shown(x) && [...x.childNodes].some((n) => n.nodeType === 3 && /\bAlt\b/.test(n.textContent)))
        .map((x) => x.textContent.trim().slice(0, 40));
      return {
        alt,
        choke: [...w.querySelectorAll('.dr-sel:not([hidden]) .dr-art[data-note="25"] .dr-art-h')]
          .filter(shown)
          .map((x) => x.textContent)
          .join(', '),
      };
    });
    T.ok(
      /hold a cymbal to choke it/i.test(capBefore) &&
        !/\bAlt\b/.test(capBefore) &&
        said.choke === 'hold it' &&
        !said.alt.length,
      `phone: the words are a touch's: "${capBefore.replace(/^.*?louder\. /, '')}"; the ride's choke key says "${said.choke}"; nothing on the sheet says Alt${said.alt.length ? ' (but: ' + said.alt.join(' | ') + ')' : ''}`,
    );
    T.ok(
      !ours(errs).length,
      `phone: no page errors${ours(errs).length ? ': ' + ours(errs).slice(0, 3).join(' | ') : ''}`,
    );
  } catch (e) {
    T.ok(false, 'phone run threw: ' + ((e && e.stack) || e));
  }
  await ctx.close();
}
await s.close();
T.done();
