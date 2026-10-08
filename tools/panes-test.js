// The panes in Liner notes (design/LINER-NOTES-KIT.md): Sketch, the browser, the rack, the mixer, Notes, Beat, the
// inspector and Reference. Static: no sparkle, no stripe, no pill in their own CSS. In the studio: Sketch's ways in are
// words (the open one in display italic), its takes are numbered rows signed "tapped by you", Keep is the one primary,
// the tap grid draws your raw taps as ticks; bylines replace the badges; selection is reverse print; the agent pointing
// is crop marks; empty states are a sentence and a button.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, tally, OUTDIR } from './pw.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = tally('panes');
const FILES = ['sketch', 'browser', 'rack', 'mixer', 'pianoroll', 'drumgrid', 'inspector', 'reference'];

/* ---------------------------------------------------------------- static */
for (const f of FILES) {
  const src = fs.readFileSync(path.join(HERE, '../app/src/ui', f + '.js'), 'utf8');
  const cssStart = src.lastIndexOf('= `');
  const cssSrc = cssStart > 0 ? src.slice(cssStart) : '';
  T.ok(!/icon\('sparkle'/.test(src), `${f}.js calls no sparkle icon`);
  T.ok(
    !/inset\s+-?\d+(\.\d+)?px\s+0\s+0\s/.test(cssSrc) && !/inset 0 -\d+px 0 var\(--ae\)/.test(cssSrc),
    `${f}.js's CSS draws no inset stripe`,
  );
  T.ok(!/border-radius:\s*99px/.test(cssSrc), `${f}.js's CSS has no 99px pill`);
  T.ok(
    !/span\.badge-(agent|human)'?\s*,\s*authorName|h\(`span\.badge-/.test(src),
    `${f}.js signs with byline(), not a badge span`,
  );
}
const sk = fs.readFileSync(path.join(HERE, '../app/src/ui/sketch.js'), 'utf8');
T.ok(
  !/fillStyle = cs\.human; g\.fillRect\(x, y, 2\.5, hh\)/.test(sk),
  "Sketch's rolls draw no warm left edge on notes (a warm outline instead)",
);
T.ok(!/animation: sk-pulse/.test(sk) && !/@keyframes sk-pulse/.test(sk), 'Sketch has no pulsing dot');

/* ---------------------------------------------------------------- studio */
const errs = [];
{
  const s = await open('/app/', { width: 1440, height: 900, query: 'demo' });
  const { page } = s;
  const E = (fn, a) => page.evaluate(fn, a);
  await E(() => {
    localStorage.setItem('overdub:welcomed', '1');
    localStorage.setItem(
      'overdub:layout',
      JSON.stringify({
        leftW: 260,
        rightW: 380,
        bottomH: 380,
        open: { left: true, right: false, bottom: true },
        tabs: {},
      }),
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await E(() => window.overdub.ui.show('sketch'));
  await page.waitForTimeout(300);

  // the ways in
  await page.click('.sk-mode[data-mode="tap"]');
  await page.waitForTimeout(200);
  const rail = await E(() => {
    const ms = [...document.querySelectorAll('.sk-rail .sk-mode')],
      on = document.querySelector('.sk-mode.on .sk-mode-l');
    const cs = on && getComputedStyle(on);
    return {
      words: ms.map((m) => m.textContent.trim()),
      icons: ms.reduce((n, m) => n + m.querySelectorAll('svg').length, 0),
      on: on?.textContent,
      italic: cs?.fontStyle,
      size: parseFloat(cs?.fontSize || 0),
      title: !!document.querySelector('.sk-mode.on .sk-title'),
      off: getComputedStyle(ms.find((m) => !m.classList.contains('on')).firstChild).fontStyle,
    };
  });
  T.ok(
    rail.words.join() === 'Hum it,Tap it,Play it,Record' && rail.icons === 0,
    `Sketch's ways in are four words, no icons (${rail.words.join(', ')})`,
  );
  T.ok(
    rail.on === 'Tap it' && rail.italic === 'italic' && rail.size >= 20 && rail.title && rail.off === 'normal',
    `the open one is set in display italic (${rail.size}px ${rail.italic}); the rest are plain`,
  );

  // the Jam room open: it has its own Record (R there) and its own input, so Sketch steps back (docs/FRESH-EYES-6.md:
  // under the room Sketch kept offering Hum it and a Record aimed elsewhere): its Hum it and Record ways in and its record
  // strip go, a line says where recording is, Play it (the keys) and Tap it stay; back in Arrange it is as it was
  {
    const jamOk = await E(() => window.overdub.ui.panels.has('jam'));
    const state = () =>
      E(() => {
        const root = document.querySelector('[data-panel="sketch"] .sk'),
          shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
        return {
          ways: [...root.querySelectorAll('.sk-rail .sk-mode')]
            .filter((b) => !b.hidden)
            .map((b) => b.textContent.trim()),
          mode: root.dataset.mode,
          strip: shown(root.querySelector('.sk-strip')),
          note: root.querySelector('.sk-jamnote')?.textContent || '',
        };
      });
    await E(() => window.overdub.input.emit('sketch:mode', 'hum'));
    await page.waitForTimeout(200);
    await E(() => window.overdub.ui.show('jam'));
    await page.waitForTimeout(300);
    const inJam = await state();
    await E(() => window.overdub.ui.show('arranger'));
    await page.waitForTimeout(300);
    const back = await state();
    T.ok(
      jamOk &&
        inJam.ways.join() === 'Tap it,Play it' &&
        inJam.mode === 'play' &&
        !inJam.strip &&
        /The Jam room records what you play onto the Guitar track/.test(inJam.note),
      `with the Jam room open Sketch steps back: ${inJam.ways.join(', ')} left, its Record strip gone, on ${inJam.mode} ("${inJam.note}")`,
    );
    T.ok(
      back.ways.join() === 'Hum it,Tap it,Play it,Record' && back.mode === 'hum' && back.strip && !back.note,
      `back in Arrange, Sketch is as it was (${back.ways.join(', ')}, on ${back.mode})`,
    );
    await E(() => window.overdub.input.emit('sketch:mode', 'tap'));
    await page.waitForTimeout(200);
  }

  // two tapped takes: the second played a little off the grid
  await E(async () => {
    const t = window.overdub.input.tap,
      wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const r of ['kick', 'hat', 'snare', 'hat']) {
      t.hit(r, 0.8);
      await wait(170);
    }
    t.flush();
    await wait(100);
    for (const [r, ms] of [
      ['kick', 200],
      ['snare', 180],
      ['kick', 230],
      ['snare', 0],
    ]) {
      t.hit(r, 0.8);
      await wait(ms);
    }
    t.flush();
  });
  await page.waitForTimeout(400);
  const takes = await E(() => {
    const rows = [...document.querySelectorAll('.sk-ideas-list .sk-idea')];
    const head = document.querySelector('.sk-ideas-head');
    return {
      head: head?.classList.contains('sheet-head') && head.querySelector('h3')?.textContent,
      n: rows.map((r) => r.querySelector('.sk-idea-n')?.textContent),
      big: rows.map((r) => parseFloat(getComputedStyle(r.querySelector('.sk-idea-n')).fontSize)),
      who: rows.map((r) => r.querySelector('.sk-idea-who')?.textContent),
      ink: rows.every((r) => r.querySelector('.sk-idea-who .by.by-human')),
      card: rows.map((r) => {
        const c = getComputedStyle(r);
        return [c.backgroundColor, c.borderRadius, c.boxShadow].join('|');
      }),
      meta: rows[0]?.querySelector('.sk-idea-meta')?.textContent || '',
      keep: (() => {
        const b = document.querySelector('.sk-stage .sk-acts .ew-btn-primary');
        return b && b.classList.contains('btn-go') && getComputedStyle(b).backgroundColor;
      })(),
      gos: [...document.querySelectorAll('[data-panel="sketch"] .btn-go')].filter((b) => b.getClientRects().length)
        .length,
      status: document.querySelector('.sk-status')?.textContent || '',
    };
  });
  T.ok(takes.head === 'Takes', 'Takes opens under a sheet head');
  T.ok(
    takes.n.join() === '2,1' && takes.big[0] >= 40 && takes.big[1] < takes.big[0],
    `takes are numbered, the newest set big (${takes.n.join(', ')} at ${takes.big.join(', ')} px)`,
  );
  T.ok(
    takes.who.every((w) => w === 'tapped by you') && takes.ink,
    `each take is signed in warm ink: "${takes.who[0]}"`,
  );
  T.ok(
    takes.card.every((c) => /rgba\(0, 0, 0, 0\)\|0px\|none/.test(c)),
    `a take is a ruled row, not a card (${takes.card[0]})`,
  );
  T.ok(
    /^4 hits, 1 bar/.test(takes.meta) && !/·/.test(takes.meta),
    `a take's meta is a phrase with commas ("${takes.meta}")`,
  );
  T.ok(!!takes.keep && takes.gos === 1, `Keep is the one primary in Sketch (${takes.gos} go button, ${takes.keep})`);
  T.ok(
    /The ticks are your taps; the cells are where they went in/.test(takes.status),
    `the tap grid says what the ticks are ("${takes.status}")`,
  );
  // the ticks: cream columns drawn over the grid where each raw tap fell
  const ticks = await E(() => {
    const cv = document.querySelector('.sk-grid'),
      g = cv.getContext('2d'),
      w = cv.width,
      hgt = cv.height,
      gm = window.overdub.sketch.geom();
    const d = g.getImageData(0, 0, w, hgt).data,
      row = Math.round((gm.T + gm.rh * 0.5) * (hgt / gm.h)); // through the kick row
    let n = 0,
      run = 0;
    for (let x = 0; x < w; x++) {
      const i = (row * w + x) * 4,
        cream = d[i] > 225 && d[i + 1] > 215 && d[i + 2] > 190;
      if (cream) run++;
      else {
        if (run >= 1 && run <= 8) n++;
        run = 0;
      }
    }
    return n;
  });
  T.ok(ticks >= 2, `the kick row carries a tick for each of its 2 taps (${ticks} found)`);
  await page.screenshot({
    path: path.join(OUTDIR, 'panes-sketch.png'),
    clip: await E(() => {
      const r = document.querySelector('.ew-region-bottom').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  });

  // the browser: bylines, reverse print
  const br = await E(() => {
    const rows = [...document.querySelectorAll('.br-row')],
      signed = rows.find((r) => r.querySelector('.by.by-agent'));
    const q = document.querySelector('.br-q');
    q.focus();
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    return {
      signed: signed?.querySelector('.by')?.textContent,
      pill: signed && getComputedStyle(signed.querySelector('.by')).borderRadius,
      sec: getComputedStyle(document.querySelector('.br-sec')).textTransform,
    };
  });
  await page.waitForTimeout(100);
  const brOn = await E(() => {
    const r = document.querySelector('.br-row.on');
    return (
      r && [
        getComputedStyle(r).backgroundColor,
        getComputedStyle(r).boxShadow,
        getComputedStyle(document.body).getPropertyValue('--text'),
      ]
    );
  });
  T.ok(
    br.signed === 'Claude' && br.pill === '0px',
    `a device the agent wrote is signed "${br.signed}" in cool ink, no pill`,
  );
  T.ok(br.sec === 'none', "the browser's section heads are sentence case, not tracked capitals");
  T.ok(
    brOn && brOn[1] === 'none' && /rgb\(24[0-9], 2[23][0-9], 2[01][0-9]\)/.test(brOn[0]),
    `the row the keys are on is reverse print, no stripe (${brOn && brOn[0]})`,
  );

  // the mixer: strips between hairlines, the agent's track signed
  await E(() => window.overdub.ui.show('mixer'));
  await page.waitForTimeout(300);
  const mx = await E(() => {
    const ss = [...document.querySelectorAll('.mx-strip:not(.mx-master)')];
    return {
      shadows: ss.map((s) => getComputedStyle(s).boxShadow).filter((x) => x !== 'none'),
      radius: ss.map((s) => getComputedStyle(s).borderRadius).filter((x) => x !== '0px'),
      by: ss.map((s) => s.querySelector('.mx-name .by')?.textContent).filter(Boolean),
      chip: getComputedStyle(ss[0].querySelector('.mx-chip')).width,
    };
  });
  T.ok(
    !mx.shadows.length && !mx.radius.length,
    `mixer strips are columns, no author stripe and no card (${mx.shadows[0] || 'none'})`,
  );
  T.ok(
    mx.by.includes('Claude') && mx.chip === '8px',
    `a strip carries its author's byline (${mx.by.join(', ')}) and an 8 px swatch`,
  );
  // presence: crop marks, not a glowing pill
  await E(() => {
    const o = window.overdub,
      t = o.store.get().tracks[1];
    o.ui.state.presence = [{ by: 'claude', track: t.id, note: 'listening' }];
    o.ui.emit('presence', o.ui.state.presence);
  });
  await page.waitForTimeout(150);
  const mp = await E(() => {
    const p = document.querySelector('.mx-pres');
    return (
      p && {
        crop: p.classList.contains('crop'),
        marks: p.querySelectorAll(':scope > i').length,
        bg: getComputedStyle(p).backgroundColor,
      }
    );
  });
  T.ok(
    mp && mp.crop && mp.marks === 4 && /rgba\(0, 0, 0, 0\)/.test(mp.bg),
    'the agent pointing at a strip is crop marks',
  );
  await E(() => {
    const o = window.overdub;
    o.ui.state.presence = [];
    o.ui.emit('presence', []);
  });

  // the rack: the agent's device signed with a byline, the empty chain a sentence and a button
  await E(() => {
    const o = window.overdub,
      p = o.store.get();
    const t =
      p.tracks.find((x) => x.inserts.some((i) => /^claude\./.test(i.device))) ||
      p.tracks.find((x) => !x.inserts.length);
    o.ui.select({ track: t.id });
    o.ui.show('rack');
  });
  await page.waitForTimeout(400);
  const rk = await E(() => ({
    by: [...document.querySelectorAll('.rk-cap .by')].map((b) => b.className),
    stripe: [...document.querySelectorAll('.rk-cap')]
      .map((c) => getComputedStyle(c).borderTopWidth)
      .filter((x) => x !== '0px'),
    sparkle: document.querySelectorAll('.rk-head svg').length,
  }));
  T.ok(!rk.stripe.length, `a device's caption has no author edge (${rk.stripe.join(', ') || 'none'})`);
  T.ok(
    rk.sparkle <= 2,
    `the rack's head carries words: the track menu's chevron and the agent's stroke at most (${rk.sparkle} icons)`,
  );
  await E(() => {
    const o = window.overdub,
      t = o.store.get().tracks.find((x) => !x.inserts.length);
    if (t) {
      o.ui.select({ track: t.id });
    }
  });
  await page.waitForTimeout(300);
  const hint = await E(() => {
    const x = document.querySelector('.rk-hint');
    return (
      x && {
        empty: x.classList.contains('empty'),
        icon: x.querySelectorAll('svg').length,
        bg: getComputedStyle(x).backgroundColor,
        btns: x.querySelectorAll('button').length,
      }
    );
  });
  T.ok(
    !hint || (hint.empty && hint.bg === 'rgba(0, 0, 0, 0)' && hint.icon <= 1),
    `an empty chain is a sentence and a button, not a card (${JSON.stringify(hint)})`,
  );

  // Notes and Beat with nothing picked: a sentence and a button, no icon tile
  await E(() => {
    window.overdub.ui.select({ track: null, clip: null, notes: [] });
    window.overdub.ui.show('pianoroll');
  });
  await page.waitForTimeout(300);
  const pe = await E(() => {
    const c = document.querySelector('.pr-empty-card');
    return (
      c && {
        empty: c.classList.contains('empty'),
        icon: c.querySelectorAll('svg').length,
        p: c.querySelector('p')?.textContent,
        btn: c.querySelectorAll('button.btn').length,
      }
    );
  });
  T.ok(
    pe && pe.empty && pe.icon === 0 && pe.btn >= 1 && /Pick a clip/.test(pe.p),
    `Notes, empty: "${pe && pe.p}" and a button`,
  );
  await E(() => window.overdub.ui.show('drumgrid'));
  await page.waitForTimeout(300);
  const de = await E(() => {
    const c = document.querySelector('.dg-empty-card');
    return (
      c && {
        empty: c.classList.contains('empty'),
        icon: c.querySelectorAll('svg').length,
        solid: c.querySelectorAll('button.btn:not(.btn-txt)').length,
      }
    );
  });
  T.ok(
    de && de.empty && de.icon === 0 && de.solid === 1,
    `Beat, empty: a sentence, one button, the rest underlined words (${JSON.stringify(de)})`,
  );

  // the jargon, each said in one plain line where it is: Layer, New take, Scale lock, Ghosts, Rigs
  // (Scale lock is the key part of the line over musical typing's keys: "in C minor", its title the plain line)
  await E(() => {
    const o = window.overdub,
      k = o.store.get().tracks.find((t) => t.name === 'Keys');
    o.ui.select({ track: k.id, clip: k.clips[0].id });
    o.ui.show('sketch');
    o.input.emit('sketch:mode', 'play');
    o.input.qwerty.toggle(true);
  });
  await page.waitForTimeout(250);
  const tipsA = await E(() => ({
    layer: [...document.querySelectorAll('.sk-each button')].find((b) => b.textContent === 'Layer')?.title,
    take: [...document.querySelectorAll('.sk-each button')].find((b) => b.textContent === 'New take')?.title,
    lock: document.querySelector('.ew-qw .ew-snap-key')?.title,
  }));
  await E(() => window.overdub.input.qwerty.toggle(false));
  await E(() => window.overdub.ui.show('pianoroll'));
  await page.waitForTimeout(250);
  const tipsB = await E(() => ({ ghosts: document.querySelector('.pr-ghost')?.title }));
  await E(() => window.overdub.ui.show('rack'));
  await page.waitForTimeout(300);
  const tipsC = await E(() => ({
    rigs: [...document.querySelectorAll('.rk-hb')].find((b) => b.textContent.trim() === 'Rigs')?.title,
  }));
  const tips = { ...tipsA, ...tipsB, ...tipsC };
  const plain = (x, word, what) =>
    typeof x === 'string' && x.startsWith(word + ':') && what.test(x) && !/\n/.test(x) && x.length <= 120;
  T.ok(
    plain(tips.layer, 'Layer', /added to what’s there/) &&
      plain(tips.take, 'New take', /take of its own/) &&
      plain(tips.lock, 'Scale lock', /only .+, so no note sounds wrong/) &&
      plain(tips.ghosts, 'Ghosts', /other tracks’ notes/) &&
      plain(tips.rigs, 'Rigs', /pedals and an amp/),
    `the jargon has a plain one-line tooltip each (${Object.entries(tips)
      .map(([k, v]) => `${k}: "${v}"`)
      .join('; ')})`,
  );

  // Draw a beat: a blank song's Beat tab says it in a sentence and a button; the button makes a beat to click squares in
  await E(async () => {
    const o = window.overdub;
    await o.exporter.newSong();
    for (const x of document.querySelectorAll('.ew-toast')) x.remove();
    o.ui.show('drumgrid');
  });
  await page.waitForTimeout(400);
  const blank = await E(() => {
    const c = document.querySelector('.dg-empty-card');
    return (
      c && {
        p: c.querySelector('p')?.textContent,
        solid: [...c.querySelectorAll('button.btn:not(.btn-txt)')].map((b) => b.textContent),
        card: [...document.querySelectorAll('.ar-empty-card button')].map((b) => b.textContent.trim()),
      }
    );
  });
  T.ok(
    blank?.card.includes('Tap a beat') && blank.card.includes('Draw a beat'),
    `the blank song's card offers Draw a beat beside Tap a beat (${blank?.card.join(', ')})`,
  );
  T.ok(
    blank &&
      /clicking squares/.test(blank.p) &&
      /Nothing to play in time/.test(blank.p) &&
      blank.solid.join() === 'Draw a beat',
    `a blank song's Beat tab: "${blank?.p}" and ${blank?.solid.join()}`,
  );
  await page.click('.dg-empty-card button.btn:not(.btn-txt)');
  await page.waitForTimeout(400);
  const drawn = await E(() => {
    const o = window.overdub,
      t = o.store.get().tracks,
      c = t[0]?.clips[0],
      hint = document.querySelector('.dg-hint');
    return {
      tracks: t.map((x) => x.name),
      dev: t[0]?.instrument?.device,
      clip: c && { len: c.length, start: c.start, sel: o.ui.state.selection.clip === c.id },
      by: o.store.history.slice(-1)[0]?.by,
      hint: !!hint && !hint.hidden && hint.textContent,
      empty: document.querySelector('.dg')?.classList.contains('dg-isempty'),
    };
  });
  T.ok(
    drawn.tracks.join() === 'Drums' &&
      drawn.dev === 'core.drums' &&
      drawn.clip?.len === 8 &&
      drawn.clip.start === 0 &&
      drawn.clip.sel &&
      drawn.by === 'you' &&
      !drawn.empty &&
      /Click a square/.test(drawn.hint),
    `Draw a beat makes Drums and a two-bar beat, open in the grid, by you, and says what to do ("${drawn.hint}")`,
  );
  const cell = await E(() => {
    const r = document.querySelector('.dg-cellwrap').getBoundingClientRect(),
      rh = parseFloat(getComputedStyle(document.querySelector('.dg-labels')).getPropertyValue('--rh')),
      hd = parseFloat(getComputedStyle(document.querySelector('.dg-labels')).getPropertyValue('--head'));
    return { x: r.left + 6, y: r.top + hd + rh / 2 };
  });
  await page.mouse.click(cell.x, cell.y);
  await page.waitForTimeout(250);
  const hit = await E(() => {
    const c = window.overdub.store.get().tracks[0].clips[0];
    return { notes: c.notes.map((n) => `${n.p}@${n.t}`), hint: document.querySelector('.dg-hint')?.hidden };
  });
  T.ok(
    hit.notes.join() === '36@0' && hit.hint,
    `a click on the first square is a kick on beat 1, and the hint goes (${hit.notes.join()})`,
  );
  // a beat further into the song is numbered as the song numbers it, the way its grid is: a two-bar clip at bar 3 is
  // "Bars 3–4" (the header said "Bars 1–2 of 2" over a grid marked 3 and 4), its bar actions say bar 3, and one longer
  // than a page says its whole span ("Bars 3–4 of 3–10")
  const later = async (bars) =>
    E(async (bars) => {
      const o = window.overdub,
        t = o.store.get().tracks[0],
        wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const r = o.store.dispatch(
        {
          type: 'clip.add',
          track: t.id,
          ref: 'c',
          clip: { kind: 'notes', start: 8, length: bars * 4, name: 'Later', notes: [{ p: 36, t: 0, d: 0.25, v: 0.9 }] },
        },
        { by: 'you' },
      );
      o.ui.select({ track: t.id, clip: r.created.c, notes: [] });
      o.ui.show('drumgrid');
      await wait(250);
      document.querySelectorAll('.ew-toast').forEach((x) => x.remove());
      o.drumgrid.copyBar();
      const out = {
        head: document.querySelector('.dg-page')?.textContent,
        copied: document.querySelector('.ew-toast')?.textContent || '',
        per: o.drumgrid.perPage(),
      };
      o.store.undo();
      return out;
    }, bars);
  const b2 = await later(2),
    b8 = await later(8);
  T.ok(
    b2.head === 'Bars 3–4' &&
      /^Copied bar 3 \(1 hit\)/.test(b2.copied) &&
      b8.per < 8 &&
      b8.head === `Bars 3–${2 + b8.per} of 3–10`,
    `the Beat tab numbers bars as the song does ("${b2.head}", "${b2.copied}"; a longer clip: "${b8.head}")`,
  );
  // and from Sketch: the ways in end with Draw a beat, which opens that beat
  await E(() => {
    window.overdub.ui.select({ track: null, clip: null, notes: [] });
    window.overdub.ui.show('sketch');
  });
  await page.waitForTimeout(250);
  await page.click('.sk-modes .sk-draw');
  await page.waitForTimeout(300);
  const viaSketch = await E(() => {
    const o = window.overdub;
    return {
      shown: o.ui.visible('drumgrid'),
      sel: o.ui.state.selection.clip === o.store.get().tracks[0].clips[0].id,
      clips: o.store.get().tracks[0].clips.length,
    };
  });
  T.ok(
    viaSketch.shown && viaSketch.sel && viaSketch.clips === 1,
    `Sketch's Draw a beat opens the song's beat in the Beat tab (${JSON.stringify(viaSketch)})`,
  );

  // Notes keeps drawn notes in key, as the keys do (docs/FRESH-EYES-4.md, beginner 3): a new song in C minor, a piano
  // track, its first clip from Notes's own button, a rising line clicked up the rows
  await E(async () => {
    const o = window.overdub;
    await o.exporter.newSong();
    for (const x of document.querySelectorAll('.ew-toast')) x.remove();
    const r = o.store.dispatch(
      {
        type: 'track.add',
        ref: 't',
        track: { name: 'Baby Grand', kind: 'instrument', instrument: { device: 'core.keys' } },
      },
      { by: 'you' },
    );
    o.ui.select({ track: r.created.t, clip: null, notes: [] });
    o.ui.show('pianoroll');
  });
  await page.waitForTimeout(300);
  await page.click('.pr-empty-card button.btn:not(.btn-txt)');
  await page.waitForTimeout(400);
  const roll = () =>
    E(() => {
      const o = window.overdub,
        sc = document.querySelector('.pr-scroll'),
        r = sc.getBoundingClientRect(),
        lock = document.querySelector('.pr-lock');
      const c = o.store.findClip(o.ui.state.selection.clip)?.clip;
      return {
        x: r.left,
        y: r.top,
        w: sc.clientWidth,
        h: sc.clientHeight,
        rowH: document.querySelector('.pr-spacer').offsetHeight / 128,
        key: o.store.get().key,
        sketch: o.input.qwerty.scaleLock,
        lock: lock && { on: lock.getAttribute('aria-pressed'), text: lock.textContent, title: lock.title },
        rows: o.pianoroll.rows(),
        notes: (c?.notes || [])
          .slice()
          .sort((a, b) => a.t - b.t)
          .map((n) => n.p),
      };
    });
  let pr = await roll();
  T.ok(
    pr.key?.root === 'C' &&
      pr.key.scale === 'minor' &&
      pr.sketch === true &&
      pr.lock?.on === 'true' &&
      pr.lock.text === 'Scale lock',
    `a new song's Notes has Scale lock on, the same switch as Sketch's (${JSON.stringify(pr.lock)}, Sketch ${pr.sketch})`,
  );
  T.ok(pr.rowH >= 16, `the rows are at least 16 px at the default zoom (${pr.rowH} px)`);
  // the rows: every C named, the root marked, the key's notes named and spelled for it, the rest shaded and unnamed
  const rowsOk = (rows, rootPc, inKeyName) =>
    rows.every(
      (r) =>
        (r.p % 12 === 0 ? /^C-?\d$/.test(r.label) : true) &&
        r.root === (r.p % 12 === rootPc) &&
        (r.root ? !!r.label : true) &&
        (r.inKey ? !!r.label : !r.label || r.c) &&
        r.shaded === !r.inKey,
    ) && rows.some((r) => r.label === inKeyName);
  T.ok(
    pr.rows.some((r) => r.c) && rowsOk(pr.rows, 0, 'Eb4'),
    `every C is named, C is marked as the root, the key's notes are named in it (Eb, not D#): ${pr.rows.map((r) => (r.label || '·') + (r.root ? '*' : '')).join(' ')}`,
  );
  // out-of-key rows are shaded darker than the key's own, on screen
  const shade = await E(() => {
    const cv = document.querySelector('.pr-grid'),
      g = cv.getContext('2d'),
      k = cv.width / cv.clientWidth,
      rows = window.overdub.pianoroll.rows();
    const lum = (r) => {
      const y = Math.round((r.y + r.h / 2) * k),
        v = [];
      for (let i = 1; i <= 9; i++) {
        const d = g.getImageData(Math.round(cv.clientWidth * (0.07 * i + 0.03) * k), y, 1, 1).data;
        v.push(d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11);
      }
      return v.sort((a, b) => a - b)[4];
    };
    const vis = rows.filter((r) => r.y >= 0 && r.y + r.h <= cv.clientHeight && !r.root);
    return {
      inKey: Math.min(...vis.filter((r) => r.inKey).map(lum)),
      out: Math.max(...vis.filter((r) => !r.inKey).map(lum)),
    };
  });
  T.ok(
    shade.out + 6 < shade.inKey,
    `rows outside the key are shaded (${shade.out.toFixed(1)} against ${shade.inKey.toFixed(1)} in key)`,
  );
  // the beginner's rising line: a click on each row from the lowest whole one up, every row (in the key or not)
  const line = pr.rows
    .filter((r) => r.y >= 0 && r.y + r.h <= pr.h)
    .reverse()
    .slice(0, 8);
  for (let i = 0; i < line.length; i++) {
    await page.mouse.click(pr.x + 12 + i * 50, pr.y + line[i].y + line[i].h / 2);
    await page.waitForTimeout(40);
  }
  pr = await roll();
  const names = pr.notes.map((p) => ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][p % 12]);
  const cMinor = new Set([0, 2, 3, 5, 7, 8, 10]);
  T.ok(
    pr.notes.length === line.length &&
      pr.notes.every((p) => cMinor.has(p % 12)) &&
      pr.notes.every((p, i) => !i || p >= pr.notes[i - 1]) &&
      line.some((r) => !r.inKey),
    `a rising line clicked across ${line.length} rows lands in C minor, still rising (${names.join(' ')})`,
  );
  // ↑ under the lock moves to the next note of the key (C to D, no C#)
  const cId = await E(() => {
    const o = window.overdub,
      c = o.store.findClip(o.ui.state.selection.clip).clip,
      n = c.notes.find((x) => x.p % 12 === 0);
    if (n) o.ui.select({ notes: [n.id] });
    return n && { id: n.id, p: n.p };
  });
  if (cId) {
    await page.mouse.move(pr.x + pr.w - 30, pr.y + 10);
    await E(() => document.querySelector('.pr-scroll').focus());
    await page.keyboard.press('ArrowUp');
  }
  const up =
    cId &&
    (await E((id) => {
      const o = window.overdub;
      return o.store.findClip(o.ui.state.selection.clip).clip.notes.find((x) => x.id === id)?.p;
    }, cId.id));
  T.ok(cId && up === cId.p + 2, `↑ moves a note to the next one in the key (${cId?.p} → ${up})`);
  // the header keeps its byline whole with a note selected (it was clipped to "by yo")
  const head = await E(() => {
    const c = document.querySelector('.pr-clip').getBoundingClientRect(),
      b = document.querySelector('.pr-by');
    const r = b?.getBoundingClientRect();
    return (
      b && {
        inside: r.right <= c.right + 0.5 && r.width >= b.scrollWidth - 0.5,
        text: b.textContent,
        chord: document.querySelector('.pr-chord')?.textContent,
      }
    );
  });
  T.ok(
    head?.inside && /by you/.test(head.text) && !!head.chord,
    `with a note selected the header still reads "${head?.text?.trim()}" in full beside "${head?.chord}"`,
  );
  const eb = await E(async () => {
    const o = window.overdub,
      c = o.store.findClip(o.ui.state.selection.clip).clip,
      n = c.notes.find((x) => x.p % 12 === 3);
    if (!n) return null;
    o.ui.select({ notes: [n.id] });
    await new Promise((r) => setTimeout(r, 50));
    return document.querySelector('.pr-chord')?.textContent;
  });
  T.ok(/^Eb\d$/.test(eb || ''), `a note is named for the key in the header: "${eb}", not D#`);
  // one switch: off in Notes is off in Sketch, and a click on an out-of-key row then lands on it
  await page.click('.pr-lock');
  await page.waitForTimeout(150);
  pr = await roll();
  const outRow = pr.rows.find((r) => !r.inKey && r.y >= 0 && r.y + r.h <= pr.h);
  const before = pr.notes.length;
  await page.mouse.click(pr.x + pr.w - 40, pr.y + outRow.y + outRow.h / 2);
  await page.waitForTimeout(150);
  const free = await E(() => {
    const o = window.overdub,
      c = o.store.findClip(o.ui.state.selection.clip).clip;
    const id = [...o.ui.state.selection.notes][0];
    return c.notes.find((n) => n.id === id)?.p;
  });
  T.ok(
    pr.sketch === false && pr.lock.on === 'false' && (await roll()).notes.length === before + 1 && free === outRow.p,
    `Scale lock off in Notes is off in Sketch too (${pr.sketch}), and a click lands on the row clicked (${free}, wanted ${outRow.p})`,
  );
  await E(() => window.overdub.input.qwerty.setScaleLock(true));
  await page.waitForTimeout(100);
  T.ok((await roll()).lock.on === 'true', 'turning it back on in Sketch lights it in Notes');
  // another key: its root is marked and named, the Cs still named
  await E(() =>
    window.overdub.store.dispatch(
      { type: 'project.set', patch: { key: { root: 'E', scale: 'minor' } } },
      { by: 'you' },
    ),
  );
  await E(() => {
    const sc = document.querySelector('.pr-scroll');
    sc.scrollTop = (127 - 66) * (sc.firstElementChild.offsetHeight / 128);
  });
  await page.waitForTimeout(150);
  pr = await roll();
  T.ok(
    pr.rows.some((r) => r.root && /^E\d$/.test(r.label)) &&
      pr.rows.some((r) => r.c && /^C\d$/.test(r.label)) &&
      rowsOk(pr.rows, 4, 'F#4') &&
      /only in E minor, so no note sounds wrong/.test(pr.lock.title),
    `in E minor the root E is marked and named, C still named (${pr.rows.map((r) => (r.label || '·') + (r.root ? '*' : '')).join(' ')})`,
  );
  // the words in Notes, each said in one plain line: VEL, Transform, Ghosts, Scale lock
  const prTips = await E(() => ({
    vel: document.querySelector('.pr-velcorner')?.title,
    tx: [...document.querySelectorAll('.pr-tool')].find((b) => b.textContent === 'Transform')?.title,
    ghosts: document.querySelector('.pr-ghost')?.title,
    lock: document.querySelector('.pr-lock')?.title,
  }));
  T.ok(
    plain(prTips.vel, 'Velocity', /how hard each note is played/) &&
      plain(prTips.tx, 'Transform', /selected notes, or the whole clip/) &&
      plain(prTips.ghosts, 'Ghosts', /other tracks’ notes/) &&
      plain(prTips.lock, 'Scale lock', /only .+, so no note sounds wrong/),
    `Notes's words have a plain one-line tooltip each (${Object.entries(prTips)
      .map(([k, v]) => `${k}: "${v}"`)
      .join('; ')})`,
  );
  await page.screenshot({
    path: path.join(OUTDIR, 'panes-notes-in-key.png'),
    clip: await E(() => {
      const r = document.querySelector('.ew-region-bottom').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  });
  // a drum clip's rows are drums: the lock leaves them alone
  await E(() => {
    const o = window.overdub,
      b = o.store.get().tracks.find((t) => t.instrument?.device === 'core.drums') || null;
    const r = b
      ? null
      : o.store.dispatch(
          [
            {
              type: 'track.add',
              ref: 'd',
              track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums' } },
            },
            { type: 'clip.add', track: '$d', ref: 'c', clip: { kind: 'notes', start: 0, length: 4, notes: [] } },
          ],
          { by: 'you' },
        );
    const t = b || o.store.track(r.created.d);
    o.ui.select({ track: t.id, clip: t.clips[0].id, notes: [] });
    o.ui.show('pianoroll');
  });
  await page.waitForTimeout(200);
  const drums = await E(() => ({
    locked: window.overdub.pianoroll.locked(),
    title: document.querySelector('.pr-lock')?.title,
    shaded: window.overdub.pianoroll.rows().some((r) => r.shaded),
  }));
  T.ok(
    drums.locked === false && !drums.shaded && /drum/.test(drums.title),
    `a drum clip in Notes ignores the lock and shades no rows ("${drums.title}")`,
  );

  errs.push(...s.errors);
  await s.close();
}
T.ok(!errs.length, `no page errors from these panes${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
T.done();
