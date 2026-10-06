// The studio's chrome in the Liner notes look (design/LINER-NOTES-KIT.md): the top bar (the position as a numeral,
// spec-sheet labels, the click's lamps, All off, the output meter, the credit line), toasts as ruled notes, tabs as words,
// the Song menu as a ledger of words and the Take one coach on paper. Desktop (1440) and a phone (390). Then what the
// testers found (docs/FRESH-EYES-2.md): All off going back after a press, the title read whole, a demo asking before it
// replaces the song and Recent songs bringing it back, the Agent column opening on the demo agent with no key, and the
// demo agent working on the take that plays (and saying so when what it measures is silent).
import { open, tally } from './pw.js';

const T = tally('shell');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) => /favicon|ERR_CONNECTION|net::|AudioContext was not allowed/i.test(e);

/* ================================================================ desktop */
{
  const s = await open('/app/', { query: 'demo' });
  const { page, errors } = s;
  const E = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(500);

  // no stripes, no pills in the chrome's own CSS
  const smell = await E(() => ['shell', 'transport', 'onboard', 'ew-export'].map((id) => {
    const t = document.querySelector(`style[data-css="${id}"]`)?.textContent || '';
    return { id, found: !!t, stripe: (t.match(/inset\s+-?\d+(\.\d+)?px\s+0\s+0/g) || []).length, pill: (t.match(/border-radius:\s*(99|50%|\d{2,}px)/g) || []).length };
  }));
  T.ok(smell.every((x) => x.found && !x.stripe && !x.pill), `the shell, transport, coach and Song menu CSS draw no stripe and no pill (${smell.map((x) => `${x.id}: ${x.found ? `${x.stripe} stripes, ${x.pill} pills` : 'missing'}`).join('; ')})`);

  // the top bar: the position is a display numeral, the song facts are labels over values
  const top = await E(() => {
    const pb = document.querySelector('.tp-pos-bar'), cs = getComputedStyle(pb);
    const labs = [...document.querySelectorAll('[data-panel="transport"] .tp-lab')].filter((x) => x.getClientRects().length).map((x) => x.textContent);
    const bar = document.querySelector('.ew-top').getBoundingClientRect();
    return { num: pb.classList.contains('num'), fs: parseFloat(cs.fontSize), italic: cs.fontStyle, text: pb.textContent, labs, h: Math.round(bar.height), boxed: [...document.querySelectorAll('.tp-group')].filter((g) => parseFloat(getComputedStyle(g).borderTopWidth) > 0).length };
  });
  T.ok(top.num && top.fs >= 28 && top.italic === 'italic' && /^\d+\.\d+\.\d+$/.test(top.text), `the position is a big display numeral (${top.text}, ${top.fs} px ${top.italic})`);
  T.ok(['Tempo', 'Meter', 'Key'].every((l) => top.labs.includes(l)), `Tempo, Meter and Key are labels over their values (${top.labs.join(', ')})`);
  T.ok(!top.boxed && top.h >= 60, `the bar's regions are split by hairlines, not boxed (${top.h} px tall, ${top.boxed} boxed groups)`);

  // the credit line signs the people and agents on the song; the house is unsigned
  const cr = await E(() => { const c = document.querySelector('.tp-credits'); return { text: c?.textContent || '', agents: [...(c?.querySelectorAll('.by.by-agent') || [])].map((x) => x.textContent) }; });
  T.ok(/^featuring /.test(cr.text) && cr.agents.includes('Claude') && !/house/.test(cr.text), `the demo's credit line features who played over the house, not "played by" ("${cr.text}")`);

  // All off: a red-edged key with its words, the same killswitch as Shift+Esc
  const ko = await E(async () => {
    const b = document.querySelector('.tp-kill'), cs = getComputedStyle(b);
    const { engine } = window.overdub;
    let n = 0; const off = engine.on('silence', () => n++);
    await engine.play(0);
    await new Promise((r) => setTimeout(r, 250));
    b.click();
    await new Promise((r) => setTimeout(r, 100));
    off();
    return { text: b.textContent.trim(), name: b.getAttribute('aria-label'), edge: cs.borderTopColor, radius: cs.borderTopLeftRadius, n, playing: engine.playing };
  });
  T.ok(ko.text === 'All off' && /^All off/.test(ko.name) && /silence everything/i.test(ko.name), `All off reads "All off" and its name starts with what it says ("${ko.name}")`);
  T.ok(ko.n === 1 && !ko.playing && ko.radius === '2px', `a click on All off silences everything (silence ${ko.n}, playing ${ko.playing}, corners ${ko.radius})`);
  // it answers the press and goes back: never left filled red (the testers saw it stay lit for the rest of the session)
  const ko2 = await E(async () => {
    const b = document.querySelector('.tp-kill');
    const lit = b.classList.contains('hit');
    await new Promise((r) => setTimeout(r, 900));
    return { lit, hit: b.classList.contains('hit'), bg: getComputedStyle(b).backgroundColor };
  });
  T.ok(ko2.lit && !ko2.hit && /rgba\(0, 0, 0, 0\)|transparent/.test(ko2.bg), `All off lights for the press, then goes back (hit ${ko2.lit} → ${ko2.hit}, ground ${ko2.bg})`);

  // the click: a lamp toggle, a square per beat, the sounding beat lit while the song plays
  const cl = await E(async () => {
    const o = window.overdub, m = document.querySelector('.tp-met');
    const before = m.getAttribute('aria-pressed');
    m.click();
    const after = m.getAttribute('aria-pressed');
    m.click();
    const n4 = document.querySelectorAll('.tp-beats i').length;
    o.store.dispatch({ type: 'project.set', patch: { meter: [3, 4] } }, { by: 'you', label: 'meter' });
    await new Promise((r) => setTimeout(r, 50));
    const n3 = document.querySelectorAll('.tp-beats i').length;
    o.store.undo();
    await o.engine.play(0);
    await new Promise((r) => setTimeout(r, 500));
    const lit = document.querySelectorAll('.tp-beats i.now').length;
    o.engine.stop();
    await new Promise((r) => setTimeout(r, 100));
    const still = document.querySelectorAll('.tp-beats i.now').length;
    return { tog: m.classList.contains('tog'), before, after, n4, n3, lit, still, wide: document.querySelector('.tp-beats i.one')?.getBoundingClientRect().width };
  });
  T.ok(cl.tog && cl.before !== cl.after, `Click is a lamp toggle (aria-pressed ${cl.before} → ${cl.after})`);
  T.ok(cl.n4 === 4 && cl.n3 === 3 && cl.wide > 9, `the click's lamps are a square per beat, bar 1 wider (4/4: ${cl.n4}, 3/4: ${cl.n3}, first ${cl.wide} px)`);
  T.ok(cl.lit === 1 && cl.still === 0, `playing, one lamp is lit; stopped, none (${cl.lit}, then ${cl.still})`);

  // count-in: a word over its value, stepping none, 1 bar, 2 bars
  const ci = await E(() => {
    const r = window.overdub.input?.recorder, b = document.querySelector('.tp-count');
    if (!r?.setCountIn || !b) return null;
    const was = r.countIn, seen = [];
    for (let i = 0; i < 3; i++) { b.click(); seen.push(`${r.countIn}:${b.querySelector('.tp-val').textContent}`); }
    r.setCountIn(was);
    return seen;
  });
  if (ci) T.ok(new Set(ci.map((x) => x.split(':')[0])).size === 3 && ci.every((x) => /:(none|\d bars?)$/.test(x)), `Count-in steps through none, 1 bar and 2 bars (${ci.join(', ')})`);
  else T.note('no recorder in this build: the count-in key is hidden');

  // the output meter: its bars, and the held peak in mono where the bar has room for it (at 1440 its words give way
  // to the Loop key and the title)
  const mt = await E(() => { const b = document.querySelector('.tp-meterbox'), d = document.querySelector('.tp-db'); return { w: Math.round(b.getBoundingClientRect().width), db: d?.textContent || '', mono: d?.classList.contains('mono'), loop: Math.round(document.querySelector('.tp-loop').getBoundingClientRect().width) }; });
  T.ok(mt.w > 40 && mt.mono && /dB$/.test(mt.db) && mt.loop > 30, `the output meter shows its bars, and the Loop key is on the bar (${mt.w} px, "${mt.db}", Loop ${mt.loop} px)`);
  await page.setViewportSize({ width: 1920, height: 900 });
  await sleep(250);
  const mtw = await E(() => { const d = document.querySelector('.tp-db'); return { w: Math.round(d.getBoundingClientRect().width), db: d.textContent }; });
  T.ok(mtw.w > 30 && /dB$/.test(mtw.db), `wider, the held peak shows in dB ("${mtw.db}")`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(250);

  // the title reads whole at 1440 ("Night S…" was cut); a long one steps its type down before it is cut
  const tt = await E(async () => {
    const t = document.querySelector('.tp-title'), o = window.overdub;
    const one = { text: t.textContent, clip: t.scrollWidth - t.clientWidth, fs: parseFloat(getComputedStyle(t).fontSize) };
    o.store.dispatch({ type: 'project.set', patch: { title: 'Night Shift, the long version' } }, { by: 'you', label: 'rename' });
    await new Promise((r) => setTimeout(r, 120));
    const two = { text: t.textContent, clip: t.scrollWidth - t.clientWidth, fs: parseFloat(getComputedStyle(t).fontSize) };
    o.store.undo();
    await new Promise((r) => setTimeout(r, 120));
    return { one, two };
  });
  T.ok(tt.one.clip <= 1 && tt.one.fs >= 15, `at 1440 the title reads whole ("${tt.one.text}", ${tt.one.fs} px)`);
  T.ok(tt.two.fs < tt.one.fs && tt.two.fs >= 13, `a longer title steps its type down to fit (${tt.two.fs} px, ${tt.two.clip > 1 ? 'then an ellipsis' : 'whole'})`);

  // toasts: a plain ruled note, a key drawn as a key, a hairline, then the action as an underlined word
  const ts = await E(() => {
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    let ran = 0;
    const t = window.overdub.ui.toast('Hook muted. Press `0` to hear it again.', { action: { label: 'Undo', run: () => { ran++; } } });
    const cs = getComputedStyle(t), b = t.querySelector('button');
    const out = { kbd: t.querySelector('kbd')?.textContent, sep: !!t.querySelector('.ew-toast-sep'), btn: b?.className || '', radius: cs.borderTopLeftRadius, text: t.textContent };
    b.click();
    out.ran = ran; out.gone = !t.isConnected;
    return out;
  });
  T.ok(ts.kbd === '0' && ts.sep && /btn-txt/.test(ts.btn) && ts.radius === '0px', `a toast is a square ruled note: the key as a key, a hairline, Undo as a word ("${ts.text}", corners ${ts.radius})`);
  T.ok(ts.ran === 1 && ts.gone, 'its action runs and the toast goes');
  // the same words again while they're up don't stack (a guitar input changing songs put up 16 to 22 of one toast): the
  // note there counts them, "×3", and takes the newest's action and clock
  const same = await E(async () => {
    document.querySelectorAll('.ew-toast').forEach((t) => t.remove());
    const u = window.overdub.ui, ran = [];
    u.toast('Add an audio track to monitor through.', { action: { label: 'Undo', run: () => ran.push(1) } });
    u.toast('Add an audio track to monitor through.', { action: { label: 'Undo', run: () => ran.push(2) } });
    const t = u.toast('Add an audio track to monitor through.', { action: { label: 'Undo', run: () => ran.push(3) } });
    const up = [...document.querySelectorAll('.ew-toast')].filter((x) => /monitor through/.test(x.textContent));
    const out = { n: up.length, count: t.querySelector('.ew-toast-n')?.textContent, label: t.querySelector('.ew-toast-n')?.getAttribute('aria-label'), other: u.toast('Something else.') !== t };
    t.querySelector('.ew-toast-act').click();
    out.ran = ran.join();
    document.querySelectorAll('.ew-toast').forEach((x) => x.remove());
    return out;
  });
  T.ok(same.n === 1 && same.count === '×3' && same.label === '3 times' && same.ran === '3' && same.other, `the same toast three times is one note, counted ("${same.count}", ${same.n} on screen), its action the newest's (${same.ran}); other words get their own`);

  // keys other DAWs use for something this studio does with another key (⌘L, ⌘C and ⌘V on a clip): a press says what
  // does it here; ⌘E with no clip selected says what it splits; text selected or a field focused, the key is the
  // browser's alone
  {
    const MODKEY = process.platform === 'darwin' ? 'Meta' : 'Control';
    const said = async (key, setup) => {
      await E((setup) => {
        const o = window.overdub, t = o.store.get().tracks.find((x) => x.clips.length);
        document.querySelectorAll('.ew-toast').forEach((x) => x.remove());
        document.activeElement?.blur?.();
        window.getSelection()?.removeAllRanges();
        o.ui.state.focus = 'arranger';
        o.ui.select({ track: t.id, clip: setup.clip ? t.clips[0].id : null, notes: [], range: setup.range ? { from: 0, to: 8 } : null });
        if (setup.text) { const r = document.createRange(); r.selectNodeContents(document.querySelector('.tp-title')); window.getSelection().addRange(r); }
        if (setup.field) document.querySelector('.br-q')?.focus();
      }, setup);
      await page.keyboard.press(`${MODKEY}+${key}`);
      await sleep(120);
      return E(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '));
    };
    const copy = /To copy a clip, (⌥|Alt)-drag it, or (⌘|Ctrl\+)D puts a copy right after it\./;
    const k = {
      l: await said('KeyL', { range: true }),
      c: await said('KeyC', { clip: true }),
      v: await said('KeyV', { clip: true }),
      e: await said('KeyE', {}),
      cText: await said('KeyC', { clip: true, text: true }),
      lField: await said('KeyL', { field: true }),
    };
    T.ok(/Here it’s L on its own: it loops the selected bars\./.test(k.l) && copy.test(k.c) && copy.test(k.v),
      `⌘L, ⌘C and ⌘V on a clip say what does that here ("${k.l}"; "${k.c}")`);
    T.ok(/^Select a clip, then (⌘|Ctrl\+)E splits it at the playhead\.$/.test(k.e), `⌘E with no clip selected says it splits one, not that S does ("${k.e}")`);
    T.ok(!k.cText && !k.lField, `with text selected ⌘C copies it and says nothing, and in a field ⌘L is the browser's (${JSON.stringify([k.cText, k.lField])})`);
    await E(() => { document.querySelectorAll('.ew-toast').forEach((x) => x.remove()); window.getSelection()?.removeAllRanges(); document.activeElement?.blur?.(); window.overdub.ui.select({ clip: null, range: null }); });
  }

  // The keys musicians already know (Logic's and GarageBand's): M mutes and S solos the selected track (or the selected
  // clip's) from any panel, signed by you and named in History, and with nothing selected they say so and do nothing;
  // K is the click and ⇧K the count-in; ⌘E splits the selected clip at the playhead; 0 still mutes the selected clips;
  // ⇧M does nothing. The first press of each moved key in a browser says the key moved, once, and not after a reload.
  {
    const MODKEY = process.platform === 'darwin' ? 'Meta' : 'Control';
    const ids = await E(() => { const p = window.overdub.store.get(), t = (n) => p.tracks.find((x) => x.name === n); return { bass: t('Bass').id, keys: t('Keys').id, keysClip: t('Keys').clips[0].id, bassClip: t('Bass').clips[0].id, drums: t('Drums').id }; });
    // one press: what History gained (its label, author and ops), the toasts it left, the click and the count-in
    const press = async (key, setup = null) => {
      await E(([setup, ids]) => {
        const o = window.overdub;
        document.querySelectorAll('.ew-toast').forEach((x) => x.remove());
        document.activeElement?.blur?.();
        if (setup) {
          if ('focus' in setup) o.ui.state.focus = setup.focus;
          if (setup.sel) o.ui.select({ track: setup.sel.track ? ids[setup.sel.track] || setup.sel.track : null, clip: setup.sel.clip ? ids[setup.sel.clip] : null, notes: [], range: null });
          if (setup.clips) o.arranger.selectClips(setup.clips.map((c) => ids[c]));
          if (setup.at != null) o.engine.seek(o.store.findClip(ids.bassClip).clip.start + setup.at);
        }
        window.__h0 = o.store.history.length;
      }, [setup, ids]);
      await page.keyboard.press(key);
      await sleep(160);
      return E(() => {
        const o = window.overdub, hs = o.store.history, t = hs.length > window.__h0 ? hs.at(-1) : null;
        return { n: hs.length - window.__h0, label: t?.label || '', by: t?.by || '', ops: t ? t.ops.map((x) => `${x.type}${x.patch ? JSON.stringify(x.patch) : ''}`).join(',') : '',
          toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '), click: !!o.engine.metronome, countIn: o.input?.recorder?.countIn ?? null };
      });
    };
    await E(() => { try { localStorage.removeItem('overdub:keys-moved'); } catch (e) { /* ok */ } });
    // M and S, from the arranger, the mixer and Notes; the first of each says the key moved
    const m1 = await press('KeyM', { focus: 'arranger', sel: { track: 'bass' } });
    const m2 = await press('KeyM', { focus: 'arranger' });
    T.ok(m1.n === 1 && m1.label === 'mute Bass' && m1.by === 'you' && m1.ops === 'track.set{"mute":true}' && !m1.click, `M mutes the selected track: "${m1.label}" by ${m1.by} (${m1.ops}), the click left alone`);
    T.ok(/^Muted Bass\. M mutes now, as in Logic and GarageBand; the click is K\.$/.test(m1.toast), `the first M says the key moved ("${m1.toast}")`);
    T.ok(m2.n === 1 && m2.label === 'unmute Bass' && m2.ops === 'track.set{"mute":false}' && !m2.toast, `M again unmutes it ("${m2.label}"), and says nothing more (${JSON.stringify(m2.toast)})`);
    const s1 = await press('KeyS', { focus: 'mixer' });
    const s2 = await press('KeyS', { focus: 'pianoroll' });
    T.ok(s1.n === 1 && s1.label === 'solo Bass' && s1.by === 'you' && s1.ops === 'track.set{"solo":true}' && s2.n === 1 && s2.label === 'unsolo Bass' && s2.ops === 'track.set{"solo":false}', `S solos the selected track from the mixer and unsolos it from Notes ("${s1.label}", "${s2.label}"), by ${s1.by}`);
    T.ok(/^Soloed Bass\. S solos now, as in Logic and GarageBand; (⌘|Ctrl\+)E splits\.$/.test(s1.toast) && !s2.toast, `the first S says the key moved, once ("${s1.toast}")`);
    // with only a clip selected, its track
    const c1 = await press('KeyM', { focus: 'arranger', sel: { clip: 'keysClip' } });
    const c2 = await press('KeyM', { focus: 'arranger' });
    T.ok(c1.n === 1 && c1.label === 'mute Keys' && c2.label === 'unmute Keys', `with a clip selected, M mutes its track ("${c1.label}", then "${c2.label}")`);
    // nothing selected (or the master): a short toast, and nothing changes
    const n1 = await press('KeyM', { focus: 'arranger', sel: {} });
    const n2 = await press('KeyS', { focus: 'arranger', sel: {} });
    const n3 = await press('KeyM', { focus: 'mixer', sel: { track: 'master' } });
    T.ok(n1.n === 0 && n1.toast === 'Select a track to mute it.' && n2.n === 0 && n2.toast === 'Select a track to solo it.' && n3.n === 0 && n3.toast === 'The master has no mute. Select a track to mute it.',
      `with nothing selected M and S say so and do nothing ("${n1.toast}"; "${n2.toast}"; the master: "${n3.toast}")`);
    // K and ⇧K: the click and the count-in, the first of each saying so; ⇧M does nothing
    const ci0 = await E(() => window.overdub.input.recorder.countIn);
    const k1 = await press('KeyK', { focus: 'arranger', sel: { track: 'bass' } });
    const k2 = await press('KeyK');
    T.ok(k1.click && !k2.click && k1.n === 0 && /^Click on\. K is the click now, as in Logic and GarageBand; M mutes\.$/.test(k1.toast) && !k2.toast, `K turns the click on and off; the first says the key moved ("${k1.toast}")`);
    const q1 = await press('Shift+KeyK');
    const q2 = await press('Shift+KeyK');
    const q3 = await press('Shift+KeyK');
    T.ok(ci0 === 1 && q1.countIn === 2 && q2.countIn === 0 && q3.countIn === 1 && /^Count-in: 2 bars\. ⇧K steps it now, beside the click on K\.$/.test(q1.toast) && !q2.toast && !q3.toast, `⇧K steps the count-in (1 → ${q1.countIn} → ${q2.countIn} → ${q3.countIn}); the first says so ("${q1.toast}")`);
    const sm = await press('Shift+KeyM');
    T.ok(sm.n === 0 && sm.countIn === 1 && !sm.click && !sm.toast && !(await E(() => window.overdub.ui.keys.list().some((k) => k.key === 'KeyM' && k.mod === 'shift'))), `⇧M is bound to nothing: no count-in step, no click, nothing said (${JSON.stringify({ n: sm.n, countIn: sm.countIn, toast: sm.toast })})`);
    // ⌘E: the selected clip, at the playhead, on the grid; from the mixer too (S solos there now)
    const e1 = await press(`${MODKEY}+KeyE`, { focus: 'arranger', sel: { track: 'bass', clip: 'bassClip' }, clips: ['bassClip'], at: 2 });
    await E(() => window.overdub.store.undo());
    const e2 = await press(`${MODKEY}+KeyE`, { focus: 'mixer', sel: { track: 'bass', clip: 'bassClip' }, clips: ['bassClip'], at: 2 });
    await E(() => window.overdub.store.undo());
    T.ok(e1.n === 1 && /^split /.test(e1.label) && e1.by === 'you' && /clip\./.test(e1.ops) && e2.n === 1 && /^split /.test(e2.label), `⌘E splits the selected clip at the playhead, from the arranger and from the mixer ("${e1.label}" by ${e1.by})`);
    T.ok(/^Split .* at bar \d+.*(⌘|Ctrl\+)E splits now, as in Ableton Live; S solos\.$/.test(e1.toast) && !/splits now/.test(e2.toast) && /^Split /.test(e2.toast), `the first ⌘E says the key moved, once ("${e1.toast}")`);
    // 0 still mutes the selected clips
    const z1 = await press('Digit0', { focus: 'arranger', sel: { track: 'bass', clip: 'bassClip' }, clips: ['bassClip'] });
    const z2 = await press('Digit0');
    T.ok(z1.n === 1 && /^mute clip /.test(z1.label) && z1.by === 'you' && z1.ops === 'clip.set{"mute":true}' && z2.n === 1 && /^unmute clip /.test(z2.label), `0 still mutes and unmutes the selected clips ("${z1.label}", "${z2.label}")`);
    // remembered: a new page in this browser (the song kept here, not a demo link, so Recent songs is left alone) says
    // none of it again
    const said = await E(() => { try { return Object.keys(JSON.parse(localStorage.getItem('overdub:keys-moved') || '{}')).sort().join(' '); } catch (e) { return ''; } });
    await sleep(900);   // (the song is kept here: a beat after the last edit)
    const p2 = await s.context.newPage();
    await p2.goto(s.base + '/app/', { waitUntil: 'load' });
    await p2.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await p2.evaluate(() => { const o = window.overdub, t = o.store.get().tracks.find((x) => x.name === 'Bass'); o.ui.state.focus = 'arranger'; o.ui.select({ track: t.id, clip: null, notes: [] }); document.querySelectorAll('.ew-toast').forEach((x) => x.remove()); document.activeElement?.blur?.(); });
    for (const k of ['KeyM', 'KeyM', 'KeyS', 'KeyS', 'KeyK', 'KeyK']) { await p2.keyboard.press(k); await sleep(60); }
    const again = await p2.evaluate(() => ({ toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '), labels: window.overdub.store.history.slice(-4).map((t) => t.label) }));
    await p2.close();
    T.ok(said === 'KeyK KeyM KeyS mod+KeyE shift+KeyK' && !again.toast && again.labels.join() === 'mute Bass,unmute Bass,solo Bass,unsolo Bass', `each moved key said so once in this browser (overdub:keys-moved: ${said}); after a reload M, S and K work without a word (${again.labels.join(', ')}; toasts ${JSON.stringify(again.toast)})`);
    // the "?" sheet lists the new keys, M and S under Track, and no ⇧M
    await E(() => { document.querySelectorAll('.ew-toast').forEach((x) => x.remove()); document.activeElement?.blur?.(); });
    await page.keyboard.press('Shift+Slash');
    await sleep(250);
    const sheet = await E(() => {
      const rows = [];
      for (const sec of document.querySelectorAll('.tpk-g')) {
        const g = sec.querySelector('h3')?.textContent;
        for (const dt of sec.querySelectorAll('dt')) rows.push({ g, keys: [...dt.querySelectorAll('kbd')].map((k) => k.textContent).join('+'), label: dt.nextElementSibling?.textContent || '' });
      }
      return rows;
    });
    await page.keyboard.press('Escape');
    await sleep(200);
    const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl';
    const want = [['M', /^Mute or unmute the selected track$/, 'Track'], ['S', /^Solo or unsolo the selected track$/, 'Track'], ['K', /^The click \(metronome\) on\/off$/, 'Transport'], ['⇧+K', /^Count-in: 1 bar, 2 bars, off$/, 'Transport'], [`${mod}+E`, /^Split the selected clips at the playhead/, 'Arrange'], ['0', /^Mute \/ unmute the selected clips$/, 'Arrange']];
    const miss = want.filter(([k, re, g]) => !sheet.some((r) => r.keys === k && r.g === g && re.test(r.label))).map(([k, , g]) => `${k} in ${g}: ${JSON.stringify(sheet.filter((r) => r.keys === k))}`);
    const stale = sheet.filter((r) => r.keys === '⇧+M' || (r.keys === 'M' && /click/i.test(r.label)) || (r.keys === 'S' && /split/i.test(r.label)));
    T.ok(sheet.length > 20 && !miss.length && !stale.length, `the "?" sheet lists M and S under Track, K and ⇧K under Transport, ${mod}E and 0 under Arrange, and no ⇧M${miss.length || stale.length ? ` (missing: ${miss.join('; ')}; stale: ${JSON.stringify(stale)})` : ''}`);
  }

  // where toasts go (docs/FRESH-EYES-3.md: they covered the Takes list's Hear / Keep / Agent after every take): over the
  // arrangement's foot, above the detail pane; clear of the tour card floating there; at the window's foot when the
  // detail pane is closed
  const rect = (sel) => E((q) => { const el = document.querySelector(q); if (!el || !el.getClientRects().length) return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; }, sel);
  const hit = (a, b) => !!a && !!b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  await E(() => { document.querySelectorAll('.ew-toast').forEach((t) => t.remove()); const u = window.overdub.ui; u.setOpen('bottom', true); u.show('sketch'); u.toast('A take is in. Undo takes it back.', { action: { label: 'Undo', run() {} } }); });
  await sleep(250);
  const tp1 = { toast: await rect('.ew-toast'), bottom: await rect('.ew-region-bottom'), center: await rect('.ew-region-center') };
  T.ok(tp1.toast && !hit(tp1.toast, tp1.bottom) && tp1.toast.bottom <= tp1.center.bottom && tp1.toast.right <= tp1.center.right, `a toast sits over the arrangement's foot, off the detail pane (toast ${Math.round(tp1.toast?.top)}–${Math.round(tp1.toast?.bottom)}, the pane from ${Math.round(tp1.bottom?.top)})`);
  await E(() => { window.overdub.onboard.start({ force: true, restart: true }); window.overdub.ui.toast('Another one.'); });
  await sleep(350);
  const tp2 = { toasts: await E(() => [...document.querySelectorAll('.ew-toast')].map((t) => { const b = t.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; })), ob: await rect('.ob'), bottom: await rect('.ew-region-bottom') };
  T.ok(tp2.ob && tp2.toasts.length === 2 && tp2.toasts.every((t) => !hit(t, tp2.ob) && !hit(t, tp2.bottom)), `with the tour card in the corner, the toasts stack clear of it (and of the pane: ${tp2.toasts.length} toasts)`);
  await E(() => { window.overdub.onboard.stop(); window.overdub.ui.setOpen('bottom', false); });
  await sleep(350);
  const tp3 = { toast: await rect('.ew-toast:last-child'), h: await E(() => innerHeight) };
  T.ok(tp3.toast && tp3.h - tp3.toast.bottom < 40, `with the detail pane closed, the foot of the window (${Math.round(tp3.h - tp3.toast?.bottom)} px up)`);
  await E(() => { document.querySelectorAll('.ew-toast').forEach((t) => t.remove()); window.overdub.ui.setOpen('bottom', true); });

  // the top bar's items don't push each other off (docs/FRESH-EYES-3.md: "1 held" took the output meter's dB): a held
  // lane on the bar, at 1440 and 1280, and the dB, the toggles and the Song key are all on the bar, none over another
  await E(() => { const o = window.overdub, t = o.store.get().tracks[1]; o.store.dispatch([{ type: 'auto.write', track: t.id, param: 'gain', points: [{ t: 0, v: -6 }, { t: 8, v: 0 }] }, { type: 'auto.set', track: t.id, param: 'gain', patch: { off: true } }], { by: 'you', label: 'a held lane' }); });
  for (const w of [1440, 1280, 1100]) {
    await page.setViewportSize({ width: w, height: 900 });
    await sleep(500);
    const tb = await E(() => {
      const bar = document.querySelector('.ew-top').getBoundingClientRect();
      const seen = (el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
      const items = [...document.querySelectorAll('.ew-brand, .tp-row > .tp-group, .ew-region-top > [data-panel="song"], .ew-toggles')].filter(seen).map((el) => { const b = el.getBoundingClientRect(); return { n: el.className.split(' ').slice(-1)[0], left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
      const db = document.querySelector('.tp-db');
      return { w: innerWidth, bar: { left: bar.left, right: bar.right }, items, held: seen(document.querySelector('.tp-g-held')), db: !!db && seen(db), dbText: db?.textContent, word: seen(document.querySelector('.ew-word')) };
    });
    const out = tb.items.filter((i) => i.left < tb.bar.left - 1 || i.right > tb.bar.right + 1).map((i) => i.n);
    const over = tb.items.flatMap((a, i) => tb.items.slice(i + 1).filter((b) => a.left < b.right - 1 && b.left < a.right - 1).map((b) => `${a.n}/${b.n}`));
    T.ok(tb.held && !out.length && !over.length, `at ${w}: with "held" on the bar, nothing is pushed off it or over another item (off: ${out.join(', ') || 'none'}; overlapping: ${over.join(', ') || 'none'}; wordmark ${tb.word ? 'shown' : 'given up for room'})`);
    // (at 1366 and under, a mark on the bar takes the number's room first: Loop, Undo and Redo and where R records
    // matter more there, and the meter's bars stay; without a mark the number is on the bar at 1280 too, below)
    if (w >= 1440) T.ok(tb.db, `at ${w}: the output meter keeps its dB readout beside "held" (${tb.dbText}; at 1366 and under the mark takes the number's room first, the bars stay)`);
  }
  await E(() => window.overdub.store.undo());
  await page.setViewportSize({ width: 1280, height: 900 });
  await sleep(1300);
  const m1280 = await E(() => { const seen = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none'; const b = document.querySelector('.tp-meterbox').getBoundingClientRect(); return { db: seen(document.querySelector('.tp-db')), text: document.querySelector('.tp-db')?.textContent, w: Math.round(b.width), loop: seen(document.querySelector('.tp-loop')), undo: seen(document.querySelector('.tp-undo')), onto: seen(document.querySelector('.tp-recto')) }; });
  T.ok(m1280.db && m1280.w > 80 && m1280.loop && m1280.undo && m1280.onto, `at 1280 with nothing held, the output meter keeps its number (${m1280.text}, ${m1280.w} px) beside Loop, Undo and where R records`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(1300);
  T.ok(await E(() => getComputedStyle(document.querySelector('.ew-word')).display !== 'none'), 'with nothing held, the wordmark is back');

  // tabs are words: no icon, the open one underlined in cream
  const tb = await E(() => {
    const tabs = [...document.querySelectorAll('.ew-tab')];
    const on = document.querySelector('.ew-region-bottom .ew-tab.on'), cs = on && getComputedStyle(on);
    const cream = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    const probe = document.createElement('i'); probe.style.color = cream; document.body.append(probe); const creamRgb = getComputedStyle(probe).color; probe.remove();
    return { n: tabs.length, icons: tabs.filter((t) => t.querySelector('svg')).length, under: cs && cs.borderBottomWidth, color: cs && cs.borderBottomColor, cream: creamRgb, bg: cs && cs.backgroundColor };
  });
  T.ok(tb.n >= 6 && tb.icons === 0, `tabs are words (${tb.n} tabs, ${tb.icons} with an icon)`);
  T.ok(tb.under === '2px' && tb.color === tb.cream && /rgba\(0, 0, 0, 0\)|transparent/.test(tb.bg), `the open tab is underlined in cream, not boxed (${tb.under} ${tb.color}, ground ${tb.bg})`);

  // the Song menu: a ledger of words; the share of the notes is signed
  await page.click('.sm-btn');
  await sleep(300);
  const sm = await E(() => {
    const items = [...document.querySelectorAll('.ew-pop .sm-i')];
    return { n: items.length, icons: items.filter((i) => !i.classList.contains('sm-more') && i.querySelector('svg')).length, signed: [...document.querySelectorAll('.ew-pop .sm-prov .by')].map((b) => b.textContent), sep: document.querySelector('.ew-pop .sm-sep')?.textContent, caps: getComputedStyle(document.querySelector('.ew-pop .sm-sep')).textTransform };
  });
  T.ok(sm.n >= 10 && sm.icons === 0, `the Song menu is words, no icons (${sm.n} items, ${sm.icons} with an icon)`);
  T.ok(sm.signed.includes('Claude') && sm.caps === 'none', `who wrote the notes is signed (${sm.signed.join(', ')}); section heads aren't tracked capitals ("${sm.sep}", ${sm.caps})`);

  // a demo replaces the song only after asking, the way New song does; the song it replaced is in Recent songs
  await page.click('.ew-pop .sm-more');
  await sleep(150);
  await E(() => [...document.querySelectorAll('.ew-pop .sm-demos .sm-i')].find((b) => /Halation/.test(b.textContent))?.click());
  await sleep(200);
  const dq = await E(() => { const c = document.querySelector('.ew-pop .sm-confirm'); return { shown: !!c && !c.hidden, text: c?.textContent || '', title: window.overdub.store.get().title, focus: document.activeElement?.textContent }; });
  T.ok(dq.shown && dq.title === 'Night Shift' && /Open the demo, “Halation”\?/.test(dq.text) && /Recent songs/.test(dq.text) && dq.focus === 'Open Halation', `a demo asks first, like New song ("${dq.text.slice(0, 110)}"), the song untouched`);
  await E(() => [...document.querySelectorAll('.ew-pop .sm-confirm button')].find((b) => b.textContent === 'Keep working')?.click());
  await sleep(100);
  T.ok(await E(() => document.querySelector('.ew-pop .sm-confirm')?.hidden !== false && window.overdub.store.get().title === 'Night Shift'), 'Keep working keeps it');
  await E(() => [...document.querySelectorAll('.ew-pop .sm-demos .sm-i')].find((b) => /Halation/.test(b.textContent))?.click());
  await sleep(100);
  await E(() => document.querySelector('.ew-pop .sm-confirm .ew-btn-primary')?.click());
  await sleep(500);
  const ho = await E(() => ({ title: window.overdub.store.get().title, recent: window.overdub.exporter.recent().map((r) => r.title) }));
  T.ok(ho.title === 'Halation' && ho.recent[0] === 'Night Shift', `then it opens, and Night Shift is first in Recent songs (${JSON.stringify(ho)})`);
  await page.click('.sm-btn');
  await sleep(300);
  const rl = await E(() => ({ head: [...document.querySelectorAll('.ew-pop .sm-sep')].map((x) => x.textContent), rows: [...document.querySelectorAll('.ew-pop .sm-recent')].map((x) => x.textContent) }));
  T.ok(rl.head.includes('Recent songs') && /^Night Shift/.test(rl.rows[0] || '') && !rl.rows.some((r) => /^Halation/.test(r)), `the Song menu lists it under Recent songs, not the song on screen (${rl.rows.join(' | ')})`);
  await E(() => document.querySelector('.ew-pop .sm-recent')?.click());
  await sleep(500);
  const back = await E(() => ({ title: window.overdub.store.get().title, recent: window.overdub.exporter.recent().map((r) => r.title) }));
  T.ok(back.title === 'Night Shift' && back.recent[0] === 'Halation', `one click brings it back, and Halation takes its place in the list (${JSON.stringify(back)})`);
  await page.click('.sm-btn');
  await sleep(300);
  await E(() => document.querySelector('.ew-pop .sm-demo')?.click());
  await sleep(150);
  const nd = await E(() => ({ shown: document.querySelector('.ew-pop .sm-confirm')?.hidden === false, title: window.overdub.store.get().title }));
  T.ok(nd.shown && nd.title === 'Night Shift', 'Open the demo asks first too');
  await page.keyboard.press('Escape');
  await sleep(150);

  // Recent songs keeps a song whose only copy is there: a song opened from the list leaves it (no stale copies of the
  // song on screen), and a demo as the shelf has it gives up its place first. Six trips out to a demo and back, each
  // after an edit, used to push "B" off the list for good.
  const rc = await E(async () => {
    const o = window.overdub, ex = o.exporter, raw = () => JSON.parse(localStorage.getItem('overdub:recent') || '[]');
    const { DEMOS } = await import('/app/src/core/demo.js');
    const idx = (t) => ex.recent().findIndex((r) => r.title === t);
    localStorage.removeItem('overdub:recent');
    o.store.dispatch({ type: 'project.set', patch: { title: 'Mine' } }, { by: 'you', label: 'title' });
    await ex.newSong();
    o.store.dispatch({ type: 'project.set', patch: { title: 'B (my other song)' } }, { by: 'you', label: 'title' });
    await ex.openRecent(idx('Mine'));
    const rounds = [];
    for (let i = 1; i <= 7; i++) {
      o.store.dispatch({ type: 'project.set', patch: { tempo: 90 + i } }, { by: 'you', label: 'tempo' });
      await ex.openDemo(DEMOS[i % DEMOS.length].id);
      await ex.openRecent(idx('Mine'));
      rounds.push(raw().map((e) => e.title).join(' / '));
    }
    const r = raw();
    return { title: o.store.get().title, tempo: o.store.get().tempo, rounds, recent: ex.recent().map((x) => x.title), mine: r.filter((e) => e.title === 'Mine').length, n: r.length };
  });
  T.ok(rc.title === 'Mine' && rc.tempo === 97 && rc.recent.includes('B (my other song)') && rc.mine === 0 && rc.n <= 6, `seven trips out to a demo and back keep “B” in Recent songs, with no stale copy of the song on screen (${rc.rounds[rc.rounds.length - 1]})`);
  // and Undo on the toast puts the song back without leaving a stale copy of it in the list
  const ru = await E(async () => {
    const o = window.overdub, ex = o.exporter;
    o.store.dispatch({ type: 'project.set', patch: { tempo: 101 } }, { by: 'you', label: 'tempo' });
    await ex.openDemo('lido');
    [...document.querySelectorAll('.ew-toast button')].reverse().find((b) => b.textContent === 'Undo')?.click();
    await new Promise((r) => setTimeout(r, 100));
    o.store.dispatch({ type: 'project.set', patch: { tempo: 102 } }, { by: 'you', label: 'tempo' });
    return { title: o.store.get().title, mine: JSON.parse(localStorage.getItem('overdub:recent') || '[]').filter((e) => e.title === 'Mine').length };
  });
  T.ok(ru.title === 'Mine' && ru.mine === 0, `Undo on the toast brings the song back and its copy leaves Recent songs (${JSON.stringify(ru)})`);

  // a full list (six songs of yours, a seventh on screen): opening one of them loses none (it leaves the list before
  // the song on screen goes in); every song the list keeps is in the Song menu; Make your own, then Undo, leaves no
  // empty "Untitled" in the list and pushes nothing of yours off it unsaid
  const full = await E(async () => {
    const o = window.overdub, ex = o.exporter, raw = () => JSON.parse(localStorage.getItem('overdub:recent') || '[]').map((e) => e.title);
    const toasts = () => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ');
    localStorage.removeItem('overdub:recent');
    for (let i = 1; i <= 7; i++) { o.store.dispatch({ type: 'project.set', patch: { title: `S${i}` } }, { by: 'you', label: 'title' }); if (i < 7) await ex.newSong(); }
    const six = raw();
    for (const t of document.querySelectorAll('.ew-toast')) t.remove();
    await ex.openRecent(ex.recent().findIndex((e) => e.title === 'S6'));
    return { six, opened: raw(), title: o.store.get().title, toast: toasts() };
  });
  T.ok(full.six.join() === 'S6,S5,S4,S3,S2,S1' && full.title === 'S6' && full.opened.join() === 'S7,S5,S4,S3,S2,S1' && !/off the list/.test(full.toast), `opening a song from a full Recent songs loses none: ${full.six.join(', ')} → ${full.opened.join(', ')} ("${full.toast.slice(0, 100)}")`);
  await page.click('.sm-btn');
  await sleep(200);
  const menu = await E(() => {
    const seen = () => [...document.querySelectorAll('.ew-pop .sm-recent')].filter((b) => b.checkVisibility()).map((b) => b.querySelector('b').textContent);
    const before = seen();
    document.querySelector('.ew-pop .sm-older-t')?.click();
    return { before, after: seen(), n: window.overdub.exporter.recent().length };
  });
  T.ok(menu.n === 6 && menu.before.length === 4 && menu.after.join() === 'S7,S5,S4,S3,S2,S1', `the Song menu reaches all ${menu.n} songs Recent songs keeps: four, then "Older" for the rest (${menu.before.join(', ')} → ${menu.after.join(', ')})`);
  await page.keyboard.press('Escape');
  await sleep(150);
  const ownUndo = await E(async () => {
    const o = window.overdub, raw = () => JSON.parse(localStorage.getItem('overdub:recent') || '[]').map((e) => e.title);
    const toasts = () => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ');
    for (const t of document.querySelectorAll('.ew-toast')) t.remove();
    await o.onboard.ownSong();
    await new Promise((r) => setTimeout(r, 300));
    const own = { tracks: o.store.get().tracks.map((t) => t.name), list: raw(), toast: toasts() };
    [...document.querySelectorAll('.ew-toast button')].find((b) => b.textContent === 'Undo')?.click();
    await new Promise((r) => setTimeout(r, 200));
    const r = { own, title: o.store.get().title, list: raw(), toast: toasts() };
    o.onboard.stop(); o.engine.stop?.();
    return r;
  });
  T.ok(ownUndo.title === 'S6' && /“S1” was the oldest/.test(ownUndo.own.toast) && ownUndo.list.join() === 'S7,S5,S4,S3,S2' && !ownUndo.list.includes('Untitled'),
    `Make your own on a full list says “S1” went; Undo brings S6 back with no empty "Untitled" in the list, so S2 stays (${ownUndo.own.list.join(', ')} → ${ownUndo.list.join(', ')})`);

  // the empty arrangement's foot line in the full studio ("Or add a track yourself, or hear a finished one: Night
  // Shift."): its Night Shift replaces the song as the Song menu does: the song goes to Recent songs, and the toast's
  // Undo brings it back
  const emptyDemo = await E(async () => {
    const o = window.overdub, ex = o.exporter;
    await ex.newSong();
    o.store.dispatch({ type: 'project.set', patch: { title: 'Mine, empty' } }, { by: 'you', label: 'title' });
    o.store.dispatch({ type: 'track.add', ref: 't', track: { name: 'Keys', instrument: { device: 'core.keys' } } }, { by: 'you', label: 'add' });
    o.store.dispatch({ type: 'track.remove', track: o.store.get().tracks[0].id }, { by: 'you', label: 'remove' });
    for (const t of document.querySelectorAll('.ew-toast')) t.remove();
    await new Promise((r) => setTimeout(r, 300));
    const foot = document.querySelector('.ar-empty-foot')?.textContent.trim().replace(/\s+/g, ' ');
    const link = [...document.querySelectorAll('.ar-empty .ar-link')].find((b) => b.textContent === 'Night Shift');
    link?.click();
    await new Promise((r) => setTimeout(r, 500));
    return { foot, link: !!link, title: o.store.get().title, recent: ex.recent().map((e) => e.title), undo: [...document.querySelectorAll('.ew-toast')].some((t) => /Mine, empty/.test(t.textContent) && t.querySelector('.ew-toast-act')) };
  });
  T.ok(emptyDemo.foot === 'Or add a track yourself, or hear a finished one: Night Shift.', `the empty arrangement's foot line in the full studio: "${emptyDemo.foot}"`);
  T.ok(emptyDemo.link && emptyDemo.title === 'Night Shift' && emptyDemo.recent[0] === 'Mine, empty' && emptyDemo.undo, `the empty arrangement's "Night Shift" puts the song in Recent songs, with an Undo (${JSON.stringify(emptyDemo)})`);

  // replacing the song while a take records: the take goes into the song first, so Recent songs and Undo keep it
  const tk0 = await E(async () => {
    const o = window.overdub;
    await o.exporter.openDemo('night-shift');
    await o.engine.start?.();
    o.store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you', label: 'loop off' });
    o.input.recorder.setCountIn(0);
    const k = o.store.get().tracks.find((t) => t.name === 'Keys');
    o.ui.select({ track: k.id, clip: null, notes: [], range: null });
    o.ui.state.focus = 'arranger';
    document.activeElement?.blur?.();
    return { id: k.id, clips: k.clips.length };
  });
  await page.keyboard.press('Backquote');
  await sleep(100);
  await page.keyboard.press('KeyR');
  for (let i = 0; i < 40 && (await E(() => window.overdub.input.recorder.state)) !== 'rec'; i++) await sleep(100);
  await sleep(300);
  for (const k of ['KeyA', 'KeyS', 'KeyD']) { await page.keyboard.down(k); await sleep(120); await page.keyboard.up(k); await sleep(80); }
  const tk1 = await E(async (id) => {
    const o = window.overdub, st = o.input.recorder.state;
    await o.exporter.newSong();
    const r = JSON.parse(localStorage.getItem('overdub:recent') || '[]')[0];
    const toasts = [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ');
    const undos = [...document.querySelectorAll('.ew-toast')].filter((x) => x.querySelector('.ew-toast-act')).map((x) => x.textContent);
    return { undos, st, now: o.store.get().title, rec: o.input.recorder.state, last: o.input.recorder.last, recentTitle: r?.title, recentClips: r?.song.tracks.find((t) => t.id === id)?.clips.length, toasts };
  }, tk0.id);
  T.ok(tk1.st === 'rec' && tk1.now === 'Untitled' && tk1.rec === 'idle' && tk1.last?.ok && !tk1.last?.empty && tk1.recentTitle === 'Night Shift' && tk1.recentClips > tk0.clips && !/Nothing played in that take/.test(tk1.toasts) && tk1.undos.length === 1 && /^New song/.test(tk1.undos[0]), `New song during a take: the take goes into Night Shift first (Keys ${tk0.clips} → ${tk1.recentClips} clips in its Recent songs copy), not “Nothing played”; the take's own Undo toast goes with the old song, so the one Undo left is New song's (${tk1.undos.join(' | ').slice(0, 120)})`);
  await page.keyboard.press('Backquote');
  await E(async () => { const o = window.overdub; o.engine.stop?.(); await o.exporter.openDemo('night-shift'); });
  await sleep(200);

  // the Take one coach is printed on paper, its buttons words (the agent's carries its stroke)
  const ob = await E(() => {
    const o = window.overdub;
    o.onboard.start({ force: true, restart: true });
    const c = document.querySelector('.ob');
    const out = { paper: c?.classList.contains('paper'), bg: c && getComputedStyle(c).backgroundColor, paperBg: (() => { const p = document.createElement('i'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(); document.body.append(p); const v = getComputedStyle(p).color; p.remove(); return v; })(), slate: c?.querySelector('.ob-slate')?.textContent, caps: c && getComputedStyle(c.querySelector('.ob-slate')).textTransform, close: c?.querySelector('.ob-x')?.textContent };
    o.onboard.skip();
    out.iconBtns = [...document.querySelectorAll('.ob .ob-acts button')].filter((b) => b.querySelector('svg')).length;
    out.btns = [...document.querySelectorAll('.ob .ob-acts button')].map((b) => b.textContent);
    o.onboard.stop();
    return out;
  });
  T.ok(ob.paper && ob.bg === ob.paperBg && ob.slate === 'Take one' && ob.caps === 'none' && ob.close === 'Close', `the coach is a printed card: paper ground, "Take one" in sentence case, Close as a word (${ob.bg}, "${ob.slate}")`);
  T.ok(ob.iconBtns === 0 && ob.btns.length === 3, `its buttons are words (${ob.btns.join(', ')})`);

  // the landing page's song links (?demo=lido, ?new) open over the song saved here: that song goes to Recent songs (not
  // only to a key nothing on screen reads), and the link leaves the address, so a reload opens your edits, not the demo
  await E(() => localStorage.clear());
  await page.goto(s.base + '/app/?new', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await E(() => { const o = window.overdub; o.store.dispatch([{ type: 'project.set', patch: { title: 'My Precious' } }, { type: 'track.add', track: { name: 'Keys', instrument: { device: 'core.keys' } } }], { by: 'you', label: 'mine' }); });
  await sleep(900);
  await page.goto(s.base + '/app/?demo=lido', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(300);
  const land = await E(() => ({ search: location.search, title: window.overdub.store.get().title, recent: window.overdub.exporter.recent().map((e) => e.title), toast: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | ') }));
  T.ok(land.title === 'Lido' && land.recent.includes('My Precious') && /“My Precious” is in Recent songs/.test(land.toast) && !/demo=/.test(land.search), `a landing page's demo link puts the song saved here in Recent songs, and leaves the address (${JSON.stringify(land)})`);
  await E(() => window.overdub.store.dispatch({ type: 'project.set', patch: { title: 'Lido, my mix' } }, { by: 'you', label: 'title' }));
  await sleep(900);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(300);
  const rel = await E(() => ({ title: window.overdub.store.get().title, recent: window.overdub.exporter.recent().map((e) => e.title) }));
  T.ok(rel.title === 'Lido, my mix' && rel.recent.includes('My Precious'), `a reload after it opens your edits, not the demo again, and “My Precious” is still in Recent songs (${JSON.stringify(rel)})`);

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `desktop: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
}

/* ================================================================ a phone */
{
  const s = await open('/app/', { query: 'demo', width: 390, height: 844 });
  const { page, errors } = s;
  const E = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(500);
  const ph = await E(() => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right) }; };
    return { kill: box('.tp-kill'), play: box('.tp-play'), pos: box('.tp-pos-bar'), title: box('.tp-title'), song: box('.sm-btn'), vw: innerWidth };
  });
  T.ok(ph.kill && ph.kill.h >= 40 && ph.kill.r <= ph.vw && ph.kill.y > ph.title.y, `phone: All off is on the bar's second row, a 40 px key (${ph.kill ? `${ph.kill.w}x${ph.kill.h} at y ${ph.kill.y}` : 'missing'})`);
  T.ok(ph.pos && ph.play && Math.abs(ph.pos.y + ph.pos.h / 2 - (ph.play.y + ph.play.h / 2)) < 12 && ph.song && ph.song.y < ph.play.y, `phone: the song and its menu on the first row; play, the position numeral and All off on the second`);
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `phone: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
}

/* ================================================================ the agent's first look, and the demo agent on a part you can't hear */
{
  const s = await open('/app/', { query: 'demo' });
  const { page, errors } = s;
  const E = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await sleep(600);
  // no agent yet: the Agent column opens on "Try the demo agent", the rest folded behind a link
  const fl = await E(() => {
    const k = document.querySelector('.ag-keycard'), demo = k?.querySelector('.ag-demo'), keyIn = k?.querySelector('.ag-kc-ownbtn');
    const first = k ? [...k.querySelectorAll('button, input')][0] : null;
    const r = demo?.getBoundingClientRect();
    return { first: !!k?.classList.contains('ag-kc-firstlook'), order: !!(demo && (!keyIn || (demo.compareDocumentPosition(keyIn) & Node.DOCUMENT_POSITION_FOLLOWING))),   // (your own Claude folded away behind a link under it)
 firstCtl: first?.textContent || first?.id, go: demo?.classList.contains('btn-go'), saveGo: !!k?.querySelector('input'), onScreen: !!r && r.top >= 0 && r.bottom <= innerHeight && r.width > 0, head: k?.querySelector('.sheet-head')?.textContent };
  });
  T.ok(fl.first && fl.order && /Try the demo agent/.test(fl.firstCtl || '') && fl.go && !fl.saveGo && fl.onScreen, `no agent yet: the Agent column opens on "Try the demo agent" (the one primary, on screen), your own Claude folded under it, no key field (${JSON.stringify(fl)})`);
  // asking for settings opens the whole setup: no key field anywhere (the studio keeps no API key)
  await E(() => document.querySelector('.ag-hbtns .ag-hbtn:last-child')?.click());
  await sleep(150);
  const st = await E(() => ({ first: !!document.querySelector('.ag-kc-firstlook'), head: document.querySelector('.ag-keycard .sheet-head')?.textContent, save: !!document.querySelector('.ag-keycard input'), says: /keeps no API key/.test(document.querySelector('.ag-keycard')?.textContent || '') }));
  T.ok(!st.first && st.head === 'Bring your own Claude' && !st.save && st.says, `Settings opens the whole setup, which keeps no key (${JSON.stringify(st)})`);

  // the demo agent works on what plays: a muted part is said to be muted, not played over
  const said = (prompt) => E(async (prompt) => {
    const o = window.overdub;
    const n0 = o.tools.requests.size;
    let text = '';
    const off = o.agent.on('text', (e) => { text += e?.delta || ''; });
    await o.agent.send(prompt);
    off?.();
    return { text, requests: o.tools.requests.size - n0 };
  }, prompt);
  const setup = await E(() => {
    const o = window.overdub, p = o.store.get();
    o.agent.useMock(true);
    const bass = p.tracks.find((t) => /bass/i.test(t.name));
    const ops = bass.clips.filter((c) => c.notes?.length).map((c) => ({ type: 'clip.set', track: bass.id, clip: c.id, patch: { mute: true } }));
    o.store.dispatch(ops, { by: 'you', label: 'mute the bass' });
    o.ui.select({ track: bass.id, clip: bass.clips[0].id, notes: [] });
    return { bass: bass.name, n: ops.length };
  });
  const m1 = await said('Show me what you would do with this song');
  T.ok(/muted/.test(m1.text) && !/LUFS|fuller|boomier/.test(m1.text) && m1.requests === 0, `on a muted clip the demo agent says so and offers no takes ("${m1.text.trim().slice(0, 150)}")`);
  // a muted take with the playing take over the same bars: it works on the playing one
  const tk = await E(() => {
    const o = window.overdub;
    o.store.undo();
    const bass = o.store.get().tracks.find((t) => /bass/i.test(t.name)), c = bass.clips.find((x) => x.notes?.length);
    const r = o.store.dispatch([{ type: 'clip.add', track: bass.id, clip: { start: c.start, length: c.length, name: 'Take 2', notes: c.notes.map(({ p, t, d, v }) => ({ p, t, d, v })) } }], { by: 'you', label: 'a take' });
    const nc = o.store.get().tracks.find((t) => t.id === bass.id).clips.find((x) => x.name === 'Take 2');
    o.store.dispatch({ type: 'clip.set', track: bass.id, clip: c.id, patch: { mute: true } }, { by: 'you', label: 'mute the old take' });
    o.ui.select({ track: bass.id, clip: c.id, notes: [] });
    return { ok: r.ok, muted: c.id, playing: nc?.id };
  });
  const m2 = await E(async () => {
    const o = window.overdub;
    const p = o.agent.send('Show me what you would do with this song');
    let req = null;
    for (let i = 0; i < 200 && !req; i++) { await new Promise((r) => setTimeout(r, 50)); req = [...o.tools.requests.values()].find((r) => r.status === 'pending' && r.kind !== 'question'); }
    const target = req?.cards?.find((c) => !c.original)?.ops?.[0]?.clip || null;
    if (req) o.tools.answer?.(req.id, -1);
    await p;
    return { target };
  });
  T.ok(tk.ok && m2.target === tk.playing && m2.target !== tk.muted, `with a muted take selected, it plays over the take that plays (${m2.target === tk.playing ? 'the playing take' : m2.target})`);
  // near silence measured: said plainly, no tone words about it
  await E(() => { const o = window.overdub; while (o.store.canUndo()) o.store.undo(); const bass = o.store.get().tracks.find((t) => /bass/i.test(t.name)); o.store.dispatch({ type: 'track.set', track: bass.id, patch: { gain: -55 } }, { by: 'you', label: 'bass down' }); o.ui.select({ track: bass.id, clip: null, notes: [] }); });
  const m3 = await said('Show me what you would do with this song');
  T.ok(/near silence/.test(m3.text) && !/fuller|boomier|Take kept/.test(m3.text) && m3.requests === 0, `measured near silence, it says so instead of describing it ("${m3.text.trim().slice(0, 160)}")`);
  void setup;
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `agent: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
}

/* ================================================================ the output meter when the mix goes over */
// docs/FRESH-EYES-6.md, the producer's Broken 2: a mix summing to +2.4 dBFS read "−0.7" in white, because the meter read
// the master after its safety soft clip, which never passes about −0.5 dBFS. It reads before the clip now: a new song
// (no limiter on its master) whose one track peaks at −1.0 dBFS reads −1.0, in no red; at +3.5 dBFS the bars go red and
// "Clipping 3.5 dB" takes the number's place, in the top bar and on the mixer's master strip, with nothing on the bar
// moving; a press pulls the master down 4 dB in one undo step (a master level lane moves down with it).
{
  const s = await open('/app/', { width: 1440, height: 900 });
  const { page, errors, shot } = s;
  const E = (fn, arg) => page.evaluate(fn, arg);
  await E(() => localStorage.setItem('overdub:welcomed', '1'));
  await page.goto(s.base + '/app/?new', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  // a 220 Hz sine at −6.0 dBFS on an audio track, looped: its fader sets where the mix peaks
  const made = await E(async () => {
    const o = window.overdub, sr = 48000, n = sr * 4, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / sr);
    await o.engine.start();
    await o.engine.assets.put('a_sine220', { sr, channels: [x, x] });
    const r = o.store.dispatch([
      { type: 'project.set', patch: { tempo: 120, loop: { on: true, start: 0, end: 8 } } },
      { type: 'track.add', ref: 'a', track: { name: 'Sine', kind: 'audio', gain: 5 } },
      { type: 'clip.add', track: '$a', clip: { kind: 'audio', asset: 'a_sine220', start: 0, length: 8 } },
    ], { by: 'you', label: 'a sine' });
    o.ui.show('mixer');
    await o.engine.play(0);
    return r.ok ? o.store.get().tracks[0].id : r.error;
  });
  const look = () => E(() => {
    const seen = (el) => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
    const db = document.querySelector('.tp-db'), ov = document.querySelector('.tp-over'), lab = document.querySelector('.mx-master .mx-loud span');
    const cv = document.querySelector('.tp-meter'), px = cv.getContext('2d').getImageData(cv.width - 2, 1, 1, 1).data;   // the held peak's tick, at the peak bar's far end
    const box = (el) => { const b = el.getBoundingClientRect(); return `${Math.round(b.left)}+${Math.round(b.width)}`; };
    const rgb = (el) => (el ? (getComputedStyle(el).color.match(/\d+/g) || []).map(Number) : []);
    return {
      db: seen(db) ? db.textContent : null, dbRed: db.classList.contains('clip'), over: seen(ov) ? ov.textContent : null, overInk: seen(ov) ? rgb(ov.querySelector('.tp-val')) : [],
      bar: [px[0], px[1], px[2]], mixer: lab?.textContent, mixerInk: rgb(lab), title: document.querySelector('.tp-meterbox').title,
      layout: ['.tp-g-edit', '.tp-g-kill', '.tp-g-meter', '.ew-toggles'].map((x) => box(document.querySelector(x))).join(' ') + ` readout ${box(seen(ov) ? ov : db)}`,
      peak: window.overdub.engine.meters.master.peak, gain: window.overdub.store.get().master.gain,
    };
  });
  const red = (c) => c.length >= 3 && c[0] > 200 && c[1] < 150 && c[2] < 150;
  // (a press on the words, where they are; a build without them has nothing to press)
  const press = async () => { const b = await page.$('.tp-over'); if (b && await b.isVisible()) await b.click(); };
  const hist = () => E(() => window.overdub.store.history.length);
  const since = (h0) => E((h0) => {
    const o = window.overdub, m = o.store.get().master;
    const t = [...document.querySelectorAll('.ew-toast')].at(-1);
    return { n: o.store.history.length - h0, label: o.store.history.at(-1)?.label, gain: m.gain, pts: (m.auto?.gain?.points || []).map((x) => `${x.t}:${x.v}`).join(' '), toast: t?.querySelector('.ew-toast-text')?.textContent || '', act: t?.querySelector('.ew-toast-act')?.textContent || '' };
  }, h0);
  await sleep(2000);
  const q = await look();
  T.ok(typeof made === 'string' && /^t_/.test(made) && q.db === '−1.0 dB' && !q.dbRed && !q.over && !red(q.bar), `a mix peaking at −1.0 dBFS reads ${q.db} (before the safety clip, whose knee makes −1.3 of it), in no red, with no "Clipping" (${JSON.stringify({ made, over: q.over, bar: q.bar })})`);
  T.ok(q.mixer === 'Loudness' && !red(q.mixerInk), `the mixer's master strip says Loudness over its number ("${q.mixer}")`);
  await E((id) => window.overdub.store.dispatch({ type: 'track.set', track: id, patch: { gain: 9.5 } }, { by: 'you', label: 'hot' }), made);
  await sleep(1500);
  const c = await look();
  await shot('shell-meter-clipping');
  T.ok(c.over === 'Clipping 3.5 dB' && !c.db && red(c.overInk) && red(c.bar), `a mix peaking at +3.5 dBFS says "${c.over}" in red where the number was, its bars red (ink ${c.overInk.join(',')}, tick ${c.bar.join(',')}; the meter reads ${c.peak} dBFS; the number: ${c.db})`);
  T.ok(!!c.over && c.layout === q.layout, `nothing on the bar moves when it clips: Undo, All off, the meter and its readout keep their places (${c.layout})`);
  T.ok(c.mixer === 'Clipping 3.5 dB' && red(c.mixerInk), `the mixer's master strip says "${c.mixer}" in red (${c.mixerInk.join(',')})`);
  T.ok(/before the master’s safety clip/.test(c.title) && /Red is clipping: the mix went over 0 dBFS by the amount shown/.test(c.title), `the meter's title says what it reads and what red means ("${c.title}")`);
  // the next step: one press, the master down 4 dB (3.5 rounded up with half a dB to spare), one undo step
  let h0 = await hist();
  await press();
  await sleep(700);
  const p = await look(), pd = await since(h0);
  T.ok(pd.gain === -4 && pd.n === 1 && pd.label === 'master down 4 dB' && pd.toast === 'The mix went 3.5 dB over. Master down 4 dB, to −4.0 dB.' && pd.act === 'Undo', `a press on it pulls the master down 4 dB, one undo step ("${pd.label}"; "${pd.toast}" ${pd.act})`);
  T.ok(p.gain === -4 && !p.over && p.db === '−0.5 dB' && !p.dbRed, `and the meter reads the mix under 0 dBFS at once, 4 dB down (${p.db}, ${p.over ? `"${p.over}"` : 'no "Clipping"'}; master ${p.gain} dB)`);
  await E(() => window.overdub.store.undo());
  // a master level lane that plays is what's heard: it moves down with the fader, its shape kept
  await E(() => window.overdub.store.dispatch({ type: 'auto.write', track: 'master', param: 'gain', points: [{ t: 0, v: 0 }, { t: 4, v: -0.5 }, { t: 8, v: 0 }] }, { by: 'you', label: 'a master lane' }));
  await sleep(1500);
  const l0 = await look();
  h0 = await hist();
  await press();
  await sleep(300);
  const ln = await since(h0);
  T.ok(/^Clipping 3\.[0-5] dB$/.test(l0.over || '') && ln.n === 1 && ln.gain === -4 && ln.pts === '0:-4 4:-4.5 8:-4' && /, its lane with it\.$/.test(ln.toast), `with a master level lane playing, the press moves the lane down 4 dB too, its shape kept (${ln.pts}; master ${ln.gain} dB; "${ln.toast}")`);
  await E(() => { const o = window.overdub; o.store.undo(); o.store.undo(); o.engine.stop(); });
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `meter: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.close();
}

T.done();
