// The personal lexicon (agent/lexicon-personal.js): words people disagree on (warm, fat, tight) are asked once with two
// audible readings as A/B cards, the pick is kept as this person's meaning and used from then on without asking (and
// said), the Agent settings list it (change it, forget it), and outside agents read it through get_guide "lexicon",
// over MCP too. docs/UX-RESEARCH.md §7 (P1). Screenshots land in tools/.out/lexicon-*.png.
//
//   node tools/lexicon-test.js
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, tally } from './pw.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const t = tally('lexicon');
const realErrors = (errs) => errs.filter((e) => !/Failed to load resource|favicon|fonts\.g|EventSource|bridge/.test(e));
const ready = (page) => page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
const KEY = 'overdub:lexicon-personal';

/* ------------------------------------------------------------------ 0. the data and the module, in Node */
{
  const L = await import('../app/src/agent/lexicon.js');
  const P = await import('../app/src/agent/lexicon-personal.js');
  const w = L.resolveWord('warmer'),
    c = L.resolveWord('colder'),
    lw = L.resolveWord('less warm'),
    ax = L.resolveWord('warmth'),
    tt = L.resolveWord('tighter'),
    br = L.resolveWord('brighter');
  t.ok(
    w.ask &&
      w.root === 'warm' &&
      w.rootDir === 1 &&
      c.root === 'warm' &&
      c.rootDir === -1 &&
      lw.rootDir === -1 &&
      ax.root === 'warm' &&
      tt.root === 'tight',
    'warmer / colder / less warm / warmth / tighter resolve to their root word and direction',
  );
  t.ok(!br.ask && !L.readingsFor(br.root), 'a word people agree on (brighter) has no readings: it is never asked');
  const ids = Object.values(L.READINGS)
    .flat()
    .map((r) => r.id);
  const okReadings = Object.entries(L.READINGS).every(
    ([, rs]) =>
      rs.length === 2 && rs.every((r) => L.AXES[r.axis] && (r.dir === 1 || r.dir === -1) && r.label && r.opposite),
  );
  t.ok(
    okReadings && new Set(ids).size === ids.length,
    `every asked word has two readings on real axes (${Object.keys(L.READINGS).join(', ')})`,
  );
  t.ok(
    Object.entries(L.WORDS)
      .filter(([, e]) => e[2]?.ask)
      .every(([, e]) => L.READINGS[e[2].root]),
    'every word marked ask in the table has readings to offer',
  );
  t.ok(
    L.READINGS.warm.map((r) => r.label).join(' | ') === 'Darker top | Fuller low-mid',
    'warm: "Darker top" vs "Fuller low-mid"',
  );

  P.clear();
  t.ok(P.meaning('warm') === null && P.list().length === 0, 'node: nothing learned to begin with');
  P.learn('warm', 'darker_top');
  P.noteUse('warm');
  P.noteUse('warm');
  let m = P.meaning('warm');
  t.ok(
    m.reading === 'darker_top' && m.picks === 1 && m.uses === 2 && m.axis === 'brightness' && m.dir === -1,
    'node: a pick is kept with its counts',
  );
  t.ok(
    P.learn('warm', 'nope') === null &&
      P.learn('groovy', 'darker_top') === null &&
      P.meaning('warm').reading === 'darker_top',
    'node: unknown words and readings are refused',
  );
  P.setMeaning('warm', 'fuller_lowmid');
  m = P.meaning('warm');
  t.ok(
    m.reading === 'fuller_lowmid' && m.edited && m.picks === 1,
    'node: changed by hand: the new meaning, marked as set by hand',
  );
  const fa = P.forAgents();
  t.ok(
    fa.words.warm?.means === 'fuller low-mid' &&
      fa.words.warm.adjust.axis === 'body' &&
      fa.asks.includes('tight') &&
      !fa.asks.includes('warm'),
    'node: forAgents says what "warm" means and which words are still asked',
  );
  let fired = 0;
  const off = P.onChange(() => fired++);
  t.ok(
    P.forget('warm') && P.meaning('warm') === null && fired === 1 && !P.forget('warm'),
    'node: forget removes it (and tells listeners)',
  );
  off();
}

/* ------------------------------------------------------------------ 1. adjust through the tool boundary, in Node */
{
  const { createStore } = await import('../app/src/core/store.js');
  const tools = await import('../app/src/agent/tools.js');
  const P = await import('../app/src/agent/lexicon-personal.js');
  P.clear();
  const DEVS = {
    'core.keys': {
      id: 'core.keys',
      name: 'Keys',
      kind: 'instrument',
      cat: 'keys',
      params: [
        { key: 'bright', label: 'BRIGHT', role: 'tone', min: 0, max: 1, def: 0.5 },
        { key: 'body', label: 'BODY', role: 'level', min: 0, max: 1, def: 0.4 },
        { key: 'release', label: 'RELEASE', role: 'release', unit: 's', min: 0.01, max: 4, def: 0.5 },
      ],
    },
  };
  const getDevice = (id) => DEVS[id] || null;
  const store = createStore(null, { getDevice });
  store.dispatch(
    [
      {
        type: 'track.add',
        ref: 'k',
        track: { name: 'Keys', instrument: { device: 'core.keys', params: { bright: 0.6 } } },
      },
      { type: 'clip.add', track: '$k', clip: { start: 0, length: 4, notes: 'C4@0.03:1 E4@1.02:1 G4@2:1' } },
    ],
    { by: 'you' },
  );
  const events = [];
  const app = { store, devices: { getDevice }, ui: { emit: (n, x) => events.push([n, x]), toast() {} } };
  tools.installTools(app);
  const keys = () => store.get().tracks[0].instrument.params;

  // first "warmer": two cards, nothing changed until the pick
  const first = app.tools.run(
    'adjust',
    { axis: 'warmer', target: { track: 'Keys' }, wait_seconds: 5 },
    { by: 'claude' },
  );
  await new Promise((r) => setTimeout(r, 30));
  const req = [...app.tools.requests.values()].find((x) => x.lexicon && x.status === 'pending');
  const labels = req
    ? req.cards
        .filter((c) => !c.original)
        .map((c) => c.label)
        .sort()
    : [];
  t.ok(
    req && labels.join(' | ') === 'Darker top | Fuller low-mid' && req.cards.some((c) => c.original),
    `node: the first "warmer" asks with two readings (${labels.join(' vs ')}), "Original" alongside`,
  );
  t.ok(keys().bright === 0.6 && keys().body === undefined, 'node: nothing changes while it asks');
  const darker = req.cards.find((c) => c.label === 'Darker top');
  app.tools.answer(req.id, darker.index);
  const r1 = await first;
  t.ok(
    r1.ok && r1.asked && r1.picked === 'Darker top' && /darker top/.test(r1.learned || '') && keys().bright < 0.6,
    `node: the pick is applied (bright ${keys().bright}) and learned: ${r1.learned}`,
  );
  t.ok(
    store.history.at(-1).label.startsWith('warmer (darker top)') && store.history.at(-1).by === 'claude',
    `node: one undo step, signed by the agent: "${store.history.at(-1).label}"`,
  );
  t.ok(
    P.meaning('warm')?.reading === 'darker_top' && P.meaning('warm').picks === 1,
    'node: stored as their meaning of "warm"',
  );

  // second "warmer": no question, their meaning, said
  const n0 = app.tools.requests.size,
    b0 = keys().bright;
  const r2 = await app.tools.run('adjust', { axis: 'warmer', target: { track: 'Keys' } }, { by: 'claude' });
  const chip = events
    .filter(([n, x]) => n === 'agent:tool' && x.phase === 'end' && x.name === 'adjust')
    .at(-1)?.[1].chip;
  t.ok(
    r2.ok &&
      !r2.asked &&
      app.tools.requests.size === n0 &&
      r2.personal === 'using your "warm": darker top' &&
      keys().bright < b0,
    `node: the second "warmer" uses it without asking: ${r2.personal}`,
  );
  t.ok(/using your "warm": darker top/.test(chip?.text || ''), 'node: and the activity chip says so: ' + chip?.text);
  const r3 = await app.tools.run('adjust', { axis: 'colder', target: { track: 'Keys' } }, { by: 'claude' });
  t.ok(
    r3.ok && r3.personal === 'using your "warm" the other way: brighter top' && r3.direction === 'more',
    `node: "colder" is their warm the other way: ${r3.personal}`,
  );
  t.ok(P.meaning('warm').uses === 2, 'node: each use is counted');

  // picking "Original" learns nothing; a reading named for one call doesn't either
  P.forget('warm');
  const asked = app.tools.run('adjust', { axis: 'warm', target: { track: 'Keys' }, wait_seconds: 5 }, { by: 'claude' });
  await new Promise((r) => setTimeout(r, 30));
  const req2 = [...app.tools.requests.values()].find((x) => x.lexicon && x.status === 'pending');
  app.tools.answer(req2.id, -1);
  const r4 = await asked;
  t.ok(
    r4.ok && r4.picked === 'original' && P.meaning('warm') === null,
    'node: keeping the original changes nothing and learns nothing',
  );
  const r5 = await app.tools.run(
    'adjust',
    { axis: 'warmer', reading: 'fuller_lowmid', target: { track: 'Keys' } },
    { by: 'claude' },
  );
  t.ok(
    r5.ok && !r5.asked && r5.reading === 'fuller_lowmid' && !r5.personal && P.meaning('warm') === null,
    'node: reading: names it for one call, without learning',
  );
  const r6 = await app.tools.run(
    'adjust',
    { axis: 'warmer', reading: 'shiny', target: { track: 'Keys' } },
    { by: 'claude' },
  );
  t.ok(r6.error && /darker_top/.test(r6.hint), 'node: an unknown reading is an error that lists the real ones');
  const pend = await app.tools.run(
    'adjust',
    { axis: 'tighter', target: { track: 'Keys' }, wait_seconds: 0 },
    { by: 'mcp:probe' },
  );
  t.ok(
    pend.status === 'pending' && pend.asked && pend.readings.length === 2,
    `node: wait_seconds 0: pending with the readings on screen (${pend.readings?.join(' vs ')})`,
  );
  const req3 = app.tools.requests.get(pend.id);
  app.tools.answer(pend.id, req3.cards.find((c) => c.label === 'Shorter tails').index);
  const late = await app.tools.run('get_variation_result', { id: pend.id }, { by: 'mcp:probe' });
  t.ok(
    late.picked === 'Shorter tails' && P.meaning('tight')?.reading === 'shorter_tails',
    'node: a pick made after the call returned is still applied and learned',
  );
  P.clear();
}

/* ------------------------------------------------------------------ 2. the studio: cards, hold-to-hear, settings, MCP */
{
  const { page, base, errors, close, shot } = await open('/app/', { query: 'demo' });
  await ready(page);
  await page.evaluate((k) => {
    localStorage.removeItem(k);
    window.overdub.ui.show('agent');
  }, KEY);
  await page.waitForTimeout(400);
  const run = (name, input, by = 'claude') =>
    page.evaluate(([n, i, b]) => window.overdub.tools.run(n, i, { by: b }), [name, input, by]);

  // 1. the first "warmer" asks with two cards
  await page.evaluate(() => {
    window.__first = window.overdub.tools.run(
      'adjust',
      { axis: 'warmer', target: { track: 'Keys' }, wait_seconds: 60 },
      { by: 'claude' },
    );
  });
  await page.waitForSelector('.ag-vars', { timeout: 30000 });
  const card = await page.evaluate(() => {
    const c = document.querySelector('.ag-vars');
    return {
      head: c.querySelector('.ag-card-h').textContent,
      takes: [...c.querySelectorAll('.ag-take')].map((x) => x.querySelector('.ag-take-h b').textContent),
      hist: window.overdub.store.history.length,
      bright: window.overdub.store.get().tracks.find((x) => x.name === 'Keys').instrument.params.bright,
    };
  });
  const readings = card.takes.filter((x) => x !== 'Original').sort();
  t.ok(
    /asks which you mean/.test(card.head) && /“warmer” on the Keys/.test(card.head),
    'the first "warmer" asks: ' + card.head.replace(/\s+/g, ' ').trim(),
  );
  t.ok(
    readings.join(' | ') === 'Darker top | Fuller low-mid' && card.takes.includes('Original'),
    `two readings as A/B cards: ${readings.join(' vs ')} (and Original)`,
  );

  // hold-to-hear the darker one: a preview, not History
  const hold = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.ag-vars .ag-take')]
      .find((x) => /Darker top/.test(x.textContent))
      .querySelector('.ag-hold'),
  );
  const box = await hold.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const held = await page.evaluate(() => ({
    bright: window.overdub.store.get().tracks.find((x) => x.name === 'Keys').instrument.params.bright,
    hist: window.overdub.store.history.length,
  }));
  await shot('lexicon-ask');
  await page.mouse.up();
  await page.waitForTimeout(150);
  const released = await page.evaluate(
    () => window.overdub.store.get().tracks.find((x) => x.name === 'Keys').instrument.params.bright,
  );
  t.ok(
    held.bright < card.bright && held.hist === card.hist && released === card.bright,
    `hold to hear: bright ${card.bright} → ${held.bright} while held, back to ${released} on let-go, no History entry`,
  );

  // 2. picking one stores it
  await page.evaluate(() =>
    [...document.querySelectorAll('.ag-vars .ag-take')]
      .find((x) => /Darker top/.test(x.textContent))
      .querySelector('.ag-keep')
      .click(),
  );
  const r1 = await page.evaluate(() => window.__first);
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
  t.ok(
    r1.ok && r1.asked && r1.picked === 'Darker top' && r1.learned,
    `picking "Darker top" applies it: ${(r1.changed || []).join('; ')}${typeof r1.measured === 'object' ? ' → ' + (r1.measured.glosses || []).join('; ') : ''}`,
  );
  t.ok(
    stored?.words?.warm?.reading === 'darker_top' && stored.words.warm.picks.darker_top === 1,
    `stored in localStorage '${KEY}' with counts: ${JSON.stringify(stored?.words?.warm)}`,
  );
  await page.waitForTimeout(200);
  const done = await page.evaluate(
    () =>
      document.querySelector('.ag-card-done:last-of-type')?.textContent ||
      [...document.querySelectorAll('.ag-card-done')].map((x) => x.textContent).join(' / '),
  );
  t.ok(/Kept as your “warm”/.test(done), 'the closed card says it was kept: ' + done.replace(/\s+/g, ' ').trim());

  // 3. the second "warmer": no question, and it says whose meaning it used
  const nReq = await page.evaluate(() => window.overdub.tools.requests.size);
  const r2 = await run('adjust', { axis: 'warmer', target: { track: 'Keys' } });
  await page.waitForTimeout(250);
  const chips = await page.evaluate(() => [...document.querySelectorAll('.ag-chip')].map((x) => x.textContent));
  const nReq2 = await page.evaluate(() => window.overdub.tools.requests.size);
  t.ok(
    r2.ok && !r2.asked && nReq2 === nReq && r2.personal === 'using your "warm": darker top',
    `the second "warmer" uses it without asking: ${r2.personal}`,
  );
  t.ok(
    chips.some((c) => /using your "warm": darker top/.test(c)),
    'the Agent panel shows it: ' + (chips.find((c) => /using your/.test(c)) || chips.slice(-2).join(' | ')),
  );
  const hist = await page.evaluate(() => window.overdub.store.history.at(-1));
  t.ok(
    /^warmer \(darker top\)/.test(hist.label) && /using your "warm"/.test(hist.reason || ''),
    `History: "${hist.label}" because ${hist.reason}`,
  );

  // an outside agent gets the same meaning: adjust over the tool boundary as mcp:…, and get_guide "lexicon"
  const rm = await run('adjust', { axis: 'warm', direction: 'less', target: { track: 'Keys' } }, 'mcp:probe');
  t.ok(
    rm.ok && rm.personal === 'using your "warm" the other way: brighter top',
    'an MCP agent\'s "less warm" follows it too: ' + rm.personal,
  );

  // the settings list: shown, editable, forgettable
  await page.evaluate(() => document.querySelector('.ag-hbtns button[aria-label="Agent settings"]').click());
  await page.waitForSelector('.ag-w[data-word="warm"]');
  const row = await page.evaluate(() => {
    const r = document.querySelector('.ag-w[data-word="warm"]');
    return { text: r.textContent, sel: r.querySelector('select').value };
  });
  t.ok(
    row.sel === 'darker_top' && /2 uses|used 2×/.test(row.text) && /1 pick/.test(row.text),
    'settings › Your words lists it: ' + row.text.replace(/\s+/g, ' '),
  );
  await page.evaluate(() => document.querySelector('.ag-words').scrollIntoView());
  await shot('lexicon-settings');
  await page.selectOption('.ag-w[data-word="warm"] select', 'fuller_lowmid');
  await page.waitForTimeout(100);
  const edited = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).words.warm, KEY);
  const rE = await run('adjust', { axis: 'warmer', target: { track: 'Keys' } });
  t.ok(
    edited.reading === 'fuller_lowmid' && edited.edited && rE.personal === 'using your "warm": fuller low-mid',
    'changing it in settings changes what "warmer" does: ' + rE.personal,
  );
  await page.selectOption('.ag-w[data-word="warm"] select', 'darker_top');

  // 4. the MCP-visible lexicon includes it (over stdio, the way Claude Code reads it)
  await page.waitForFunction(() => window.overdub.bridge?.state === 'on', null, { timeout: 10000 }).catch(() => {});
  const g = await run('get_guide', { topic: 'lexicon' }, 'mcp:probe');
  t.ok(
    g.personal?.words?.warm?.means === 'darker top' && /"warm" = darker top/.test(g.guide),
    'get_guide "lexicon" includes their "warm" (tool boundary)',
  );
  const mcp = spawn(process.execPath, [path.join(HERE, '../server/mcp.js')], {
    env: { ...process.env, OVERDUB_URL: base, OVERDUB_NO_OPEN: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '',
    stderr = '';
  const waiting = new Map();
  mcp.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
    }
  });
  mcp.stderr.on('data', (d) => (stderr += d));
  let nid = 0;
  const rpc = (method, params, ms = 30000) =>
    new Promise((resolve, reject) => {
      const id = ++nid;
      const timer = setTimeout(() => reject(new Error(`${method} timed out; stderr: ${stderr}`)), ms);
      waiting.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: '9.9' },
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const gl = await rpc('tools/call', { name: 'get_guide', arguments: { topic: 'lexicon' } });
    const text = gl.result?.content?.map((c) => c.text || '').join('\n') || '';
    t.ok(
      !gl.result?.isError && /\\?"warm\\?" = darker top/.test(text) && /"means":\s*"darker top"/.test(text),
      'over MCP, get_guide "lexicon" includes their "warm" = darker top',
    );
    const ad = await rpc(
      'tools/call',
      { name: 'adjust', arguments: { axis: 'warmer', target: { track: 'Keys' } } },
      60000,
    );
    const at = ad.result?.content?.[0]?.text || '';
    t.ok(
      !ad.result?.isError && /using your \\?"warm\\?": darker top/.test(at),
      'over MCP, adjust "warmer" uses it without asking',
    );
  } catch (e) {
    t.ok(false, 'MCP: ' + e.message);
  }
  mcp.stdin.end();
  await new Promise((r) => {
    mcp.on('close', r);
    setTimeout(r, 3000);
  });

  // 5. forgetting it asks again
  await page.evaluate(() => {
    const b = document.querySelector('.ag-w[data-word="warm"] .ag-w-x');
    b.click();
  });
  await page.waitForTimeout(150);
  const after = await page.evaluate(
    (k) => ({
      row: !!document.querySelector('.ag-w[data-word="warm"]'),
      stored: JSON.parse(localStorage.getItem(k) || '{}').words?.warm || null,
      empty: document.querySelector('.ag-words')?.textContent || '',
    }),
    KEY,
  );
  t.ok(
    !after.row && !after.stored && /mean different things/.test(after.empty),
    'forget: gone from the list and from storage',
  );
  const again = await run('adjust', { axis: 'warmer', target: { track: 'Keys' }, wait_seconds: 0 });
  t.ok(
    again.status === 'pending' && again.asked && again.readings.length === 2,
    'after forgetting, "warmer" asks again',
  );
  const g2 = await run('get_guide', { topic: 'lexicon' }, 'mcp:probe');
  t.ok(!g2.personal.words.warm && g2.personal.asks.includes('warm'), 'and the lexicon agents read no longer has it');
  await page.evaluate((id) => {
    const b = document.querySelector(`.ag-vars[data-id="${id}"] .ag-card-foot .ag-link`);
    b?.click();
  }, again.id);

  // and it survives a reload (it's the person's, not the song's)
  await page.evaluate(
    (k) =>
      localStorage.setItem(
        k,
        JSON.stringify({
          v: 1,
          words: {
            tight: { reading: 'on_the_grid', picks: { on_the_grid: 3 }, uses: 1, at: 1 },
            groovy: { reading: 'x' },
          },
        }),
      ),
    KEY,
  );
  await page.reload();
  await ready(page);
  const rl = await run('get_guide', { topic: 'lexicon' });
  t.ok(
    rl.personal.words.tight?.means === 'on the grid' &&
      rl.personal.words.tight.picked === 3 &&
      !rl.personal.words.groovy,
    'stored words survive a reload; unknown ones are dropped on read',
  );
  await page.evaluate((k) => localStorage.removeItem(k), KEY);

  const errs = realErrors(errors);
  t.ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await close();
}

t.done();
process.exit(process.exitCode || 0);
