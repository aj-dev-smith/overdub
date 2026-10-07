// Start a song: a blank song's way in, and a stage to play the first idea on at any speed. The studio keeps time for
// you: tap a beat in free time (no click), go round as many times as you like, and the tempo, the loop and the 1 are
// read from what you played (input/rounds.js); what you played most often is kept. Done puts it in the song at once,
// one undo step signed you (core/start.js planStart), and the stage loops it while you choose the timing (Tight,
// Loose, As played) or another reading ("Not quite?"). Then the next part: Hum over it.
//
// The door is the blank song's empty state (arranger.js syncEmpty draws doorOf here), on every blank song: Tap a beat
// (the primary), Hum a tune (over a simple beat), Play the keys, and with no playing in time Draw a beat, Pick a
// groove or Ask your agent. Nothing pops up over a song with tracks.
//
// The stage covers the centre column (the arranger and the bottom pane, inert under it); the top bar and the agent
// stay. On a phone it is the whole screen. Steps:
//   'play'      Tap your beat: four pads (F J K L, or the pads on screen, on pointerdown), heard at once on a previewed
//               Drums track (store.preview: nothing in History). Your first hit starts the clock; after six hits over
//               three seconds the BPM shows, after two bars' worth the bar lines fade in under your hits, and once a
//               repeat is found the rounds are counted. Done (Space, Enter) lands it; Start again (Backspace) clears
//               it (the hits stay in Takes); "Play to a click instead" is the first minute (app.onboard.firstMinute:
//               a Drums track, a 2-bar loop with the click, R records).
//   'hum'       Hum over this beat: a simple beat loops at Easy 100 (Speed Slow 80 / Easy 100 / Upbeat 120, Beat
//               Simple / Rock / Lo-fi, all previews). Hum (H) puts the beat in the song (one undo step) and records the
//               hum over it from the next bar line (input/recorder.js, a bar to come in on); Space stops and keeps it
//               on a new Melody track. "No beat; I'll hum freely" is Sketch's Hum, in your own time.
//   'in'        Your beat is in the song: what was kept and left out, counted; Timing (Tight / Loose / As played, ← →),
//               each a change joined to the landing's undo step; Hum over it (Enter, the primary); Not quite?; Back to
//               the song (Esc).
//   'readings'  Which one nods along with you? The other place the 1 could be and the tempo halved or doubled; picking
//               one plays it at once (joined to the landing); Use this one, or Esc puts back what was there.
// Esc before any hit closes the stage; after hits it asks once ("Leave without keeping this take? It stays in Takes.").
// "Skip to the studio" is always at the top right. While the stage is open the agent's song-changing tools wait
// (app.start.busy, read by agent/tools.js's recording check) and the studio's keys stay under it.
//
// app.start = { open({ kind = 'tap' | 'hum' }), close(), step, kind, busy, tap(row, perfMs), done(), again(),
//   setLevel(level), readings(), useReading(i), landed(), take(), on('step' | 'land' | 'close', fn) }

import { h, css, canvas, tok, byline } from './dom.js';
import { ROWS } from '../input/tap.js';
import { takeOf, atLevel, moved } from '../input/rounds.js';
import { LEVELS } from '../input/timing.js';
import { planStart } from '../core/start.js';
import { putGroove } from '../agent/grooves-tool.js';

const LEVEL_WORD = { tight: 'Tight', loose: 'Loose', played: 'As played' };
const SPEEDS = [['Slow', 80], ['Easy', 100], ['Upbeat', 120]];
const BEATS = [['Simple', 'pop/eighths'], ['Rock', 'rock/straight-eighths'], ['Lo-fi', 'lofi/dusty']];
const PAD_ROWS = ['kick', 'snare', 'hat', 'open'];
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const agentName = (app) => app.agent?.name || app.agent?.provider?.name || null;

// The door: the blank song's ways in. ctx: { addTrackMenu(anchor), showAgent(), openDemo() } from the arranger.
export function doorOf(app, ctx = {}) {
  const go = (fn) => (e) => { e?.preventDefault?.(); fn(); };
  const st = () => app.start;
  const tap = () => (st() ? st().open({ kind: 'tap' }) : app.onboard?.firstMinute?.('tap'));
  const hum = () => (st() ? st().open({ kind: 'hum' }) : app.ui.show('sketch'));
  const keys = () => (app.onboard?.keysOver ? app.onboard.keysOver() : app.ui.show('sketch'));
  const row = (label, why, run, primary = false, key = null) => h('li.st-way', { onclick: (e) => { if (!e.target.closest('button')) run(); } },
    h(primary ? 'button.btn.btn-go.st-way-b' : 'button.btn.st-way-b', { type: 'button', onclick: go(run), dataset: { way: label }, 'aria-describedby': null }, label),
    h('span.st-way-why', why, key ? [' ', h('kbd', key)] : null),
    h('span.st-way-arrow', { 'aria-hidden': 'true' }, '→'));
  const ledger = h('ul.ledger.st-ways.ar-empty-actions', { 'aria-label': 'Ways into the song' },
    row('Tap a beat', 'F J K L on your keys, or the pads on screen. Any speed.', tap, true),
    row('Hum a tune', 'Over a simple beat, or on its own. Nothing records until you press Hum.', hum),
    row('Play the keys', 'Your computer keys or a MIDI keyboard. Any speed.', keys));
  // ↑ ↓ walk the three ways
  ledger.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const bs = [...ledger.querySelectorAll('.st-way-b')], i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
  });
  const name = agentName(app);
  return h('div.ar-empty-card.st-door',
    h('h2.ar-empty-title.disp', 'Take 1 is yours.'),
    h('p.ar-empty-text', 'Bring one idea. Play it at any speed; the studio sets the tempo from you.'),
    ledger,
    h('p.st-notime', h('span.t3', 'No playing in time: '),
      h('button.btn.btn-txt', { type: 'button', title: 'Click squares in the Beat tab: nothing to play in time', onclick: () => (app.beat?.draw ? app.beat.draw() : app.ui.show('drumgrid')) }, 'Draw a beat'), ' ',
      h('button.btn.btn-txt', { type: 'button', onclick: () => app.ui.show('grooves') }, 'Pick a groove'), ' ',
      h('button.btn.btn-txt.ar-empty-agent', { type: 'button', onclick: () => { ctx.showAgent?.(); app.ui.emit('agent:compose', { text: 'I have an idea. Help me get it down.' }); } }, name ? `Ask ${name}` : 'Ask your agent')),
    h('p.ar-empty-foot', 'Or ', h('span', { dataset: { feature: 'tracks' } }, h('button.ar-link', { type: 'button', onclick: (e) => ctx.addTrackMenu?.(e.currentTarget) }, 'add a track'), ' yourself, or '), 'hear a finished one: ', h('button.ar-link.ar-empty-demo', { type: 'button', onclick: () => ctx.openDemo?.() }, 'Night Shift'), '.'));
}

export default function (app) {
  const { store, ui, engine } = app;
  css('start', CSS);
  const fns = new Map();
  const emit = (t, d) => { for (const fn of fns.get(t) || []) { try { fn(d); } catch (e) { console.error('start listener', e); } } };

  // the session's state (never the song's): what is open, what has been played, what landed
  const S = { step: null, kind: null, hits: [], read: null, pads: null, guide: null, speed: 100, beat: BEATS[0][1], landed: null, level: 'tight', reading: 0, before: null, asking: false, gridAt: 0, flash: new Map() };
  let stage = null, body = null, statusEl = null, opener = null;
  const mainEl = () => document.querySelector('.ew-main');
  const under = () => { const m = mainEl(); return m ? [...m.children].filter((c) => c !== stage) : []; };
  const bpbOf = () => { const m = store.get().meter || [4, 4]; return (m[0] * 4) / m[1]; };

  /* ---------------------------------------------------------------- previews: heard, never in History */
  function release() {
    for (const k of ['pads', 'guide']) { const p = S[k]; S[k] = null; if (p) { try { p.release(); } catch (e) { console.error('start: preview release', e); } } }
  }
  // (a page going away gives the previews back first, before the autosave's flush: capture runs ahead of it)
  window.addEventListener('pagehide', () => { if (S.pads || S.guide) { try { engine.stop?.(); } catch (e) { /* ok */ } release(); } }, true);
  function padsTrack() {
    if (S.pads && store.track(S.pads.created?.pads)) return S.pads.created.pads;
    const r = store.preview({ type: 'track.add', ref: 'pads', track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} } } }, { by: 'you' });
    if (!r.ok) return null;
    S.pads = r;
    return r.created.pads;
  }
  // the guide beat: a groove on a previewed Drums track, the loop over it, at the chosen speed
  function guideOn() {
    if (S.guide) { try { S.guide.release(); } catch (e) { /* ok */ } S.guide = null; }
    const plan = putGroove(app, { groove: S.beat, track: null, bar: 0, bars: 4, dryRun: true });
    if (!plan.ok) { say(plan.error || 'The beat could not load.'); return false; }
    const ops = [{ type: 'project.set', patch: { tempo: S.speed, loop: { on: true, start: 0, end: 4 * bpbOf() } } }, ...plan.ops];
    const r = store.preview(ops, { by: 'you' });
    if (!r.ok) { say(r.error); return false; }
    S.guide = r;
    S.guidePlan = { ops: plan.ops, summary: plan.summary };
    try { if (!engine.playing) engine.play(0); } catch (e) { /* silent engine */ }
    return true;
  }

  /* ---------------------------------------------------------------- the stage */
  function mount() {
    if (stage) return;
    const m = mainEl();
    if (!m) return;
    opener = document.activeElement;
    statusEl = h('p.st-status', { role: 'status', 'aria-live': 'polite' });
    body = h('div.st-body');
    stage = h('section.st-stage', { role: 'region', 'aria-label': 'Start a song', tabindex: -1 },
      h('header.st-top', h('span.st-run.disp-s', 'Start a song'), h('span.st-stepname', ''), h('span.st-gap'), h('span.st-alt'),
        h('button.btn.btn-txt.st-skip', { type: 'button', onclick: () => close({ to: 'studio' }) }, 'Skip to the studio')),
      body);
    m.classList.add('st-on');
    m.append(stage);
    for (const c of under()) c.inert = true;
    document.documentElement.classList.add('st-open');
  }
  function unmount() {
    if (!stage) return;
    for (const c of under()) c.inert = false;
    mainEl()?.classList.remove('st-on');
    stage.remove();
    stage = null; body = null;
    document.documentElement.classList.remove('st-open');
    try { if (opener?.isConnected) opener.focus(); } catch (e) { /* ok */ }
    opener = null;
  }
  const say = (text) => { if (statusEl) statusEl.textContent = text || ''; };
  function setStep(step) {
    S.step = step;
    S.asking = false;
    if (stage) {
      stage.querySelector('.st-stepname').textContent = { play: 'Play it', hum: 'Play it', in: 'It’s in', readings: 'It’s in' }[step] || '';
      stage.dataset.step = step;
    }
    draw();
    // (the step's controls were redrawn: focus that was on one goes to the step's first control, not the page)
    if (stage && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) { const f = stage.querySelector('.st-first') || stage; try { f.focus({ preventScroll: true }); } catch (e) { /* ok */ } }
    emit('step', step);
  }

  function open({ kind = 'tap' } = {}) {
    if (S.step) close({ quiet: true });
    if (store.get().tracks.some((t) => t.clips.length)) { ui.toast('Start a song is for a blank song: Song ▸ New song gives you one.'); return false; }
    try { app.input?.qwerty?.on && app.input.qwerty.toggle(false); } catch (e) { /* ok */ }
    try { if (engine.playing) engine.stop(); } catch (e) { /* ok */ }
    Object.assign(S, { kind, hits: [], read: null, landed: null, level: 'tight', reading: 0, before: null, gridAt: 0 });
    mount();
    if (kind === 'hum') { setStep('hum'); guideOn(); }
    else { setStep('play'); padsTrack(); }
    requestAnimationFrame(() => { const b = stage?.querySelector('.st-first') || stage; try { b?.focus({ preventScroll: true }); } catch (e) { /* ok */ } });
    return true;
  }
  function close({ to = 'studio', quiet = false } = {}) {
    if (!S.step) return;
    // (a take played and not kept stays in Takes)
    if (S.step === 'play' && S.hits.length) keepInTakes();
    const playing = S.step === 'in' || S.step === 'readings';
    if (!playing || to !== 'song') { try { if (engine.playing && (S.guide || S.step === 'play')) engine.stop(); } catch (e) { /* ok */ } }
    release();
    const was = S.step;
    S.step = null; S.kind = null; S.asking = false;
    unmount();
    if (!quiet) emit('close', { from: was, to });
  }
  function keepInTakes() {
    const cap = app.input?.capture;
    const r = S.read || takeOf(S.hits.map(hitOf), { bpb: bpbOf() });
    if (!cap || !r) return;
    try { cap.add({ src: 'tap', kind: 'drums', notes: r.notes.map(({ p, t, d, v }) => ({ p, t, d, v })), tempo: r.bpm, beat: null, track: null, free: { bpm: r.bpm, fit: r.fit.fit, drift: r.fit.drift } }); } catch (e) { console.error('start: capture', e); }
  }

  /* ---------------------------------------------------------------- playing */
  const hitOf = (x) => ({ t: x.t, p: x.p, v: x.v });
  function tap(row, perfMs = performance.now(), v = 0.85) {
    if (S.step !== 'play') return false;
    const r = ROWS.find((x) => x.id === row);
    if (!r) return false;
    const tid = padsTrack();
    if (tid) { try { engine.liveNoteOn(tid, r.p, v); setTimeout(() => { try { engine.liveNoteOff(tid, r.p); } catch (e) { /* ok */ } }, 160); } catch (e) { /* silent engine */ } }
    S.hits.push({ t: perfMs / 1000, p: r.p, v, row });
    S.flash.set(row, performance.now());
    if (S.asking) { S.asking = false; }
    S.read = S.hits.length >= 3 ? takeOf(S.hits.map(hitOf), { bpb: bpbOf() }) : null;
    syncPlay();
    return true;
  }
  function again() {
    if (S.step !== 'play') return;
    if (S.hits.length) keepInTakes();
    S.hits = []; S.read = null; S.gridAt = 0;
    say('Cleared. That take is in Takes if you want it back.');
    syncPlay();
  }
  const span = () => (S.hits.length ? S.hits[S.hits.length - 1].t - S.hits[0].t : 0);
  const showBpm = () => !!S.read && S.hits.length >= 6 && span() >= 3;
  function done() {
    if (S.step === 'play') return land();
    if (S.step === 'in') return next();
    if (S.step === 'readings') return useReading(S.reading, { back: true });
    return false;
  }
  function land() {
    const r = S.hits.length >= 4 ? (S.read || takeOf(S.hits.map(hitOf), { bpb: bpbOf() })) : null;
    if (!r) { say(S.hits.length ? 'A few more hits, and the studio can find the beat.' : 'Your first hit starts the clock.'); return false; }
    release();
    const notes = atLevel(r.notes, 'tight', { length: r.length });
    const plan = planStart(store.get(), { notes, bpm: r.bpm, length: r.length, kind: 'drums' });
    const res = store.dispatch(plan.ops, { by: 'you', label: plan.label });
    if (!res.ok) { say(`That didn't go in: ${res.error}`); padsTrack(); return false; }
    const track = store.get().tracks.find((t) => t.clips.some((c) => c.id === res.created.c));
    S.landed = { txn: res.txn.id, track: track?.id || null, clip: res.created.c };
    S.take = r; S.level = 'tight'; S.reading = 0;
    try { ui.select({ track: S.landed.track, clip: S.landed.clip, notes: [] }); } catch (e) { /* ok */ }
    try { engine.play(0); } catch (e) { /* silent engine */ }
    setStep('in');
    emit('land', { ...S.landed });
    return true;
  }
  // the take's notes as the song has them now, for a level and a reading
  function planned(reading = S.reading, level = S.level) {
    const rd = S.take.readings[reading] || S.take.readings[0];
    return { rd, notes: atLevel(rd.notes, level, { length: rd.length }) };
  }
  function replan(ops, label) {
    const res = store.dispatch(ops, { by: 'you', label, join: S.landed.txn });
    if (!res.ok) { say(`That didn't change: ${res.error}`); return res; }
    if (res.txn && res.txn.id !== S.landed.txn) S.landed.txn = res.txn.id;   // (something else came between: its own step)
    return res;
  }
  function setLevel(level) {
    if (!LEVELS.includes(level) || !S.landed || !store.findClip(S.landed.clip)) return false;
    const { notes } = planned(S.reading, level);
    const res = replan([{ type: 'notes.replace', track: S.landed.track, clip: S.landed.clip, notes: notes.map(({ p, t, d, v }) => ({ p, t, d, v })) }], `timing: ${LEVEL_WORD[level].toLowerCase()}`);
    if (!res.ok) return false;
    S.level = level;
    draw();
    return true;
  }
  function useReading(i, { back = false, hear = false } = {}) {
    if (!S.landed || !S.take) return false;
    i = Math.max(0, Math.min(S.take.readings.length - 1, i));
    if (i !== S.reading || hear) {
      const { rd, notes } = planned(i, S.level);
      const blank = store.get().tracks.every((t) => t.id === S.landed.track || !t.clips.length);
      const ops = [
        ...(blank ? [{ type: 'project.set', patch: { tempo: Math.round(rd.bpm), loop: { on: true, start: 0, end: rd.length } } }] : []),
        { type: 'clip.set', track: S.landed.track, clip: S.landed.clip, patch: { length: rd.length } },
        { type: 'notes.replace', track: S.landed.track, clip: S.landed.clip, notes: notes.map(({ p, t, d, v }) => ({ p, t, d, v })) },
      ];
      const res = replan(ops, `another reading: ${Math.round(rd.bpm)} BPM`);
      if (!res.ok) return false;
      S.reading = i;
    }
    if (back) setStep('in'); else draw();
    return true;
  }
  function next() {
    // the next part: hum over it (Sketch's Hum, the beat looping, a bar to come in on)
    close({ to: 'song' });
    try { if (!engine.playing) engine.play(0); } catch (e) { /* ok */ }
    app.onboard?.humOver?.();
    return true;
  }
  // Hum over the guide beat: the beat goes in (one undo step), then the hum records over it from the next bar line
  async function humNow() {
    if (S.step !== 'hum' || !S.guidePlan) return false;
    const ops = [{ type: 'project.set', patch: { tempo: S.speed, loop: { on: true, start: 0, end: 4 * bpbOf() } } }, ...S.guidePlan.ops];
    const g = S.guide; S.guide = null;
    try { g?.release(); } catch (e) { /* ok */ }
    const res = store.dispatch(ops, { by: 'you', label: `a beat to hum over, 4 bars at ${S.speed} BPM` });
    if (!res.ok) { say(`The beat didn't go in: ${res.error}`); guideOn(); return false; }
    S.landed = { txn: res.txn.id, track: res.created.drums || null, clip: res.created.groove || null };
    emit('land', { ...S.landed });
    close({ to: 'song' });
    try { if (!engine.playing) engine.play(0); } catch (e) { /* ok */ }
    app.onboard?.humOver?.();
    try { await app.input?.recorder?.record?.(); } catch (e) { console.error('start: hum take', e); }
    return true;
  }
  function humFree() {
    close({ to: 'studio' });
    ui.show('sketch');
    if (!ui.isOpen?.('bottom')) ui.setOpen?.('bottom', true);
    app.input?.emit?.('sketch:mode', 'hum');
  }
  function leave() {
    if (S.step === 'play' && S.hits.length && !S.asking) {
      S.asking = true;
      statusEl.replaceChildren('Leave without keeping this take? It stays in Takes. ',
        h('button.btn.btn-txt', { type: 'button', onclick: () => close({ to: 'studio' }) }, 'Leave'), ' ',
        h('button.btn.btn-txt', { type: 'button', onclick: () => { S.asking = false; say(''); } }, 'Stay'));
      return;
    }
    if (S.step === 'readings') { useReading(S.before ?? S.reading, { back: true }); return; }
    close({ to: S.step === 'in' ? 'song' : 'studio' });
  }

  /* ---------------------------------------------------------------- drawing */
  let win = null, grid = null;
  function draw() {
    if (!body) return;
    win = null; grid = null;
    const alt = stage.querySelector('.st-alt');
    alt.replaceChildren();
    if (S.step === 'play') {
      alt.append(h('button.btn.btn-txt', { type: 'button', onclick: () => { close({ to: 'studio' }); app.onboard?.firstMinute?.('tap'); } }, 'Play to a click instead'));
      win = canvas('st-win');
      const pads = h('div.st-pads', PAD_ROWS.map((id, i) => {
        const r = ROWS.find((x) => x.id === id);
        // (a pad fires on pointerdown, never on click; from the keyboard F J K L play it wherever the focus is, and
        // Enter on a focused pad plays it too: Space stays Done)
        return h('button.st-pad', { type: 'button', dataset: { row: id }, 'aria-label': `${r.short || r.label} (${r.hint})`,
          onpointerdown: (e) => { e.preventDefault(); tap(id, e.timeStamp || performance.now()); },
          onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tap(id, e.timeStamp || performance.now()); } else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); done(); } } },
        h('span.st-pad-l', r.short || r.label), h('kbd', r.hint));
      }));
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Tap your beat.'), h('p.st-sub', 'Any speed. Keep going round; the studio finds the tempo and the bar from you.')),
          h('div.st-read', { 'aria-hidden': 'true' }, h('span.num.st-bpm', ''), h('span.st-unit', ''), h('span.st-rounds', ''))),
        h('div.st-winwrap', win.cv, h('p.st-empty.t3', 'Your first hit starts the clock.')),
        pads,
        h('footer.st-foot', statusEl,
          h('button.btn.btn-txt.st-again', { type: 'button', onclick: () => again() }, 'Start again'),
          h('button.btn.st-done.st-first', { type: 'button', onclick: () => done() }, 'Done ', h('kbd', 'Space'))));
      syncPlay();
    } else if (S.step === 'hum') {
      alt.append(h('button.btn.btn-txt', { type: 'button', onclick: humFree }, 'No beat; I’ll hum freely'));
      const choice = (label, items, cur, set) => h('div.st-choice', { role: 'radiogroup', 'aria-label': label }, h('span.st-choice-l.t3', label),
        items.map(([word, val]) => h('button.st-word', { type: 'button', role: 'radio', 'aria-checked': String(val === cur), onclick: () => { set(val); guideOn(); draw(); } }, typeof val === 'number' ? `${word} ${val}` : word)));
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Hum over this beat.'), h('p.st-sub', 'Press Hum and the beat counts you in for a bar. Hum anything, as many times round as you like. Space stops.'))),
        choice('Speed', SPEEDS, S.speed, (v) => { S.speed = v; }),
        choice('Beat', BEATS, S.beat, (v) => { S.beat = v; }),
        h('div.st-humwrap', h('button.btn.btn-go.st-hum.st-first', { type: 'button', onclick: () => humNow() }, h('span.st-dot', { 'aria-hidden': 'true' }), 'Hum ', h('kbd', 'H'))),
        h('footer.st-foot', statusEl, h('span.t3.st-phones', 'Headphones keep the beat out of your hum.')));
    } else if (S.step === 'in') {
      const r = S.take, rd = r.readings[S.reading] || r.readings[0], bars = Math.max(1, Math.round(rd.length / bpbOf()));
      const t = S.landed && store.track(S.landed.track);
      const k = r.fold.notes.length, left = r.fold.strays.length, rounds = r.fold.rounds;
      const foldLine = !r.loop.bars ? `Kept all ${plural(k, 'hit')} as you played them.`
        : rounds === 1 ? `One time round: kept all ${plural(k, 'hit')}.`
          : rounds === 2 ? `You played it twice; kept the ${plural(k, 'hit')} you played both times${left ? `, left out ${left}` : ''}.`
            : `You played it ${rounds} times round; kept the ${plural(k, 'hit')} you played most${left ? `, left out ${left}` : ''}.`;
      grid = canvas('st-grid');
      const mv = moved(rd.notes, S.level, { bpm: rd.bpm });
      const levelLine = S.level === 'played' ? `Your timing, evened out to ${Math.round(rd.bpm)} BPM.` : `${LEVEL_WORD[S.level]} moved ${plural(mv.n, 'hit')}${mv.n ? `, ${mv.ms} ms on average` : ''}.`;
      const unsure = !r.downbeat.sure && r.readings.length > 1;
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Your beat is in the song.'),
          h('p.st-sub', `${t?.name || 'Drums'}, ${bars === 1 ? 'bar 1' : `bars 1–${bars}`} at ${Math.round(rd.bpm)} BPM, played by `, byline('you', { app }), '. ', foldLine, ' ', h('span.t3', 'Undo takes it out.')))),
        h('div.st-gridwrap', grid.cv),
        h('div.st-timing', h('span.st-choice-l.t3', 'Timing'),
          h('div.st-choice', { role: 'radiogroup', 'aria-label': 'Timing' }, LEVELS.map((lv) => h('button.st-word', { type: 'button', role: 'radio', 'aria-checked': String(lv === S.level), onclick: () => setLevel(lv) }, LEVEL_WORD[lv]))),
          h('span.st-level.t2', { role: 'status' }, levelLine)),
        h('footer.st-foot', statusEl,
          h(unsure ? 'p.st-unsure' : 'span', unsure ? 'The studio isn’t sure where the 1 is. ' : null,
            r.readings.length > 1 ? h('button.btn.btn-txt.st-notquite', { type: 'button', onclick: () => { S.before = S.reading; setStep('readings'); } }, unsure ? 'Hear the other ways it could go.' : 'Not quite? Hear the other ways it could go.') : null),
          h('button.btn.btn-txt.st-back', { type: 'button', onclick: () => close({ to: 'song' }) }, 'Back to the song'),
          h('button.btn.btn-go.st-next.st-first', { type: 'button', onclick: () => next() }, 'Hum over it')));
      say('');
      drawGrid();
    } else if (S.step === 'readings') {
      const r = S.take;
      const why = { kick: 'bar 1 starts on your first kick', snare: 'bar 1 starts on your first snare', first: 'bar 1 starts on your first hit', slower: 'slower: one bar is what was two', faster: 'quicker: one bar is what was half' };
      // (two readings that both start on a kick: the second says where its bar 1 is, counted from the first's)
      const words = (rd, i) => {
        const first = r.readings[0];
        if (i > 0 && rd.why === first.why && rd.bpm === first.bpm) {
          const d = ((rd.shift - first.shift) % rd.length + rd.length) % rd.length;
          return `bar 1 starts ${d === 1 ? 'a beat' : `${d} beats`} later, on another ${rd.why === 'first' ? 'hit' : rd.why}`;
        }
        return why[rd.why] || why.first;
      };
      const list = h('ul.ledger.st-readings', { role: 'listbox', 'aria-label': 'Readings' }, r.readings.map((rd, i) => h('li.ledger-row.st-reading' + (i === S.reading ? '.sel' : ''), { role: 'option', tabindex: i === S.reading ? 0 : -1, 'aria-selected': String(i === S.reading), onclick: () => useReading(i) },
        h('span.num.st-rbpm', `${Math.round(rd.bpm)} BPM`), h('span.what', words(rd, i)), h('span.t3', i === S.reading ? 'hearing' : ''))));
      list.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); useReading((S.reading + (e.key === 'ArrowDown' ? 1 : r.readings.length - 1)) % r.readings.length); body.querySelector('.st-reading.sel')?.focus(); }
      });
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Which one nods along with you?'), h('p.st-sub', 'Each plays your beat. Pick the one that feels right; it plays as soon as you pick it.'))),
        list,
        h('footer.st-foot', statusEl,
          h('button.btn.btn-txt', { type: 'button', onclick: () => { close({ to: 'studio' }); app.onboard?.firstMinute?.('tap'); } }, 'Or play it again over a click.'),
          h('button.btn.btn-txt', { type: 'button', onclick: () => leave() }, 'Back'),
          h('button.btn.btn-go.st-use', { type: 'button', onclick: () => useReading(S.reading, { back: true }) }, 'Use this one')));
      requestAnimationFrame(() => body?.querySelector('.st-reading.sel')?.focus());
    }
  }
  function syncPlay() {
    if (S.step !== 'play' || !body) return;
    const n = S.hits.length, r = S.read;
    const bpm = body.querySelector('.st-bpm'), unit = body.querySelector('.st-unit'), rounds = body.querySelector('.st-rounds');
    const shown = showBpm();
    bpm.textContent = shown ? String(Math.round(r.bpm)) : n ? '~' : '';
    unit.textContent = shown || n ? 'BPM' : '';
    const loopOk = shown && r.loop.bars;
    rounds.textContent = loopOk ? `${plural(r.loop.bars, 'bar')} round · round ${r.fold.rounds}` : '';
    body.querySelector('.st-empty').hidden = n > 0;
    const doneB = body.querySelector('.st-done');
    const ready = n >= 4;
    doneB.classList.toggle('btn-go', ready);
    doneB.firstChild.textContent = ready ? 'Done ' : 'A few more ';
    doneB.setAttribute('aria-disabled', String(!ready));
    if (!S.asking) say(!n ? '' : shown ? `${plural(n, 'hit')}. ${Math.round(r.bpm)} BPM${loopOk ? `, ${plural(r.loop.bars, 'bar')} round, ${plural(r.fold.rounds, 'time')} round` : ''}.` : `${plural(n, 'hit')}.`);
  }
  // the hits, scrolling left as you play, and (once the beat is found) the bar lines fading in under them
  const ROW_ORDER = ['hat', 'open', 'snare', 'kick'];
  function drawWin(now) {
    if (!win || S.step !== 'play') return;
    win.fit();
    const g = win.g, W = win.w, H = win.h;
    g.clearRect(0, 0, W, H);
    const lineC = tok('--line'), line2 = tok('--line-2'), text = tok('--text'), text3 = tok('--text-3');
    const nowS = performance.now() / 1000, SPAN = 6;
    const t1 = Math.max(nowS, S.hits.length ? S.hits[S.hits.length - 1].t + 0.5 : nowS), t0 = t1 - SPAN;
    const lab = 54, x = (t) => lab + ((t - t0) / SPAN) * (W - lab - 8);
    const rowH = H / ROW_ORDER.length;
    g.font = `600 11px ${tok('--font-ui') || 'sans-serif'}`;
    g.textBaseline = 'middle';
    ROW_ORDER.forEach((id, i) => {
      g.fillStyle = text3;
      g.fillText(ROWS.find((r) => r.id === id).short || ROWS.find((r) => r.id === id).label, 0, rowH * (i + 0.5));
      g.fillStyle = lineC; g.fillRect(lab, Math.round(rowH * (i + 1)) - 1, W - lab, 1);
    });
    // the grid arrives under your hits: two bars' worth played, and a pulse found
    const r = S.read;
    if (r && showBpm() && r.fit && (span() * r.bpm) / 60 >= 2 * bpbOf()) {
      if (!S.gridAt) S.gridAt = now;
      const a = Math.min(1, (now - S.gridAt) / 120);
      const first = S.hits[0].t, spb = 60 / r.bpm, bpb = bpbOf();
      g.globalAlpha = a;
      for (let b = Math.floor((t0 - first) / spb); first + b * spb <= t1; b++) {
        const xx = Math.round(x(first + b * spb)) + 0.5;
        if (xx < lab) continue;
        g.fillStyle = b % bpb === 0 ? line2 : lineC;
        g.fillRect(xx, 0, b % bpb === 0 ? 2 : 1, H);
      }
      g.globalAlpha = 1;
    }
    for (const hit of S.hits) {
      if (hit.t < t0) continue;
      const i = ROW_ORDER.indexOf(hit.row);
      const xx = x(hit.t);
      g.fillStyle = text;
      g.fillRect(Math.round(xx) - 1, rowH * i + rowH * 0.2, 3, rowH * 0.6);
    }
    // a pad that just sounded lights for a moment (reverse print), so a tap is seen as well as heard
    for (const [row, at] of S.flash) {
      const el = body?.querySelector(`.st-pad[data-row="${row}"]`);
      const lit = now - at < 110;
      if (el && el.classList.contains('on') !== lit) el.classList.toggle('on', lit);
      if (!lit) S.flash.delete(row);
    }
  }
  function drawGrid(now = performance.now()) {
    if (!grid || !S.take) return;
    grid.fit();
    const g = grid.g, W = grid.w, H = grid.h;
    g.clearRect(0, 0, W, H);
    const { rd, notes } = planned();
    const rowsP = [...new Set(rd.notes.map((n) => n.p))].sort((a, b) => b - a);
    const lab = 54, L = rd.length, bx = (b) => lab + (b / L) * (W - lab - 4), rowH = H / Math.max(3, rowsP.length);
    const lineC = tok('--line'), line2 = tok('--line-2'), text = tok('--text'), text3 = tok('--text-3'), accent = tok('--accent');
    const bpb = bpbOf();
    for (let b = 0; b <= L; b += 0.5) { g.fillStyle = b % bpb === 0 ? line2 : lineC; if (b % 1 === 0) g.fillRect(Math.round(bx(b)), 0, 1, H); }
    g.font = `600 11px ${tok('--font-ui') || 'sans-serif'}`; g.textBaseline = 'middle';
    const name = (p) => ({ 35: 'Kick', 36: 'Kick', 38: 'Snare', 40: 'Snare', 42: 'Hat', 46: 'Open', 49: 'Crash' }[p] || `Note ${p}`);
    rowsP.forEach((p, i) => { g.fillStyle = text3; g.fillText(name(p), 0, rowH * (i + 0.5)); });
    const cw = Math.max(4, (W - lab) / (L * 4) - 3);
    for (const n of notes) {
      const i = rowsP.indexOf(n.p);
      g.fillStyle = text; g.fillRect(Math.round(bx(n.t)) + 1, rowH * i + rowH * 0.25, cw, rowH * 0.5);
      // where you hit it, in pencil
      const raw = rd.notes.find((x) => x.p === n.p && x.t === n.t)?.raw;
      if (raw != null && Math.abs(raw - n.t) > 0.01) { g.fillStyle = text3; g.fillRect(Math.round(bx(Math.max(0, Math.min(L, raw)))), rowH * i + rowH * 0.15, 1, rowH * 0.7); }
    }
    // the playhead, leader green
    if (engine.playing && Number.isFinite(engine.beat)) { const b = ((engine.beat % L) + L) % L; g.fillStyle = accent; g.fillRect(Math.round(bx(b)), 0, 2, H); }
  }

  /* ---------------------------------------------------------------- the loop and the keys */
  ui.panel({ id: 'start', region: 'top', title: 'Start a song', mount: (el) => { el.hidden = true; el.style.display = 'none'; return { frame(now) { if (!S.step) return; if (S.step === 'play') drawWin(now); else if (S.step === 'in' && grid) drawGrid(now); } }; } });
  const isOpen = () => !!S.step;
  const on = (step) => () => S.step === step;
  // (first: ahead of the keys a mode declares, Tap's F J K L among them; Space needn't be, as no other Space with a
  // when() can be live while the stage has the keys, and the transport's own Space has none)
  const K = (key, when, run, label, extra = {}) => ui.keys.add({ key, when, run, label, group: 'Start a song', first: key !== 'Space', ...extra });
  // the studio's own keys wait under the stage (Space is the stage's on every step, below; added first: ui.keys tries the last-added `first` key first, so the
  // stage's own keys below win over these) (R, M, S, the panes, Tap, the keys' octave...)
  for (const key of ['KeyR', 'KeyM', 'KeyS', 'KeyB', 'KeyD', 'KeyA', 'KeyT', 'KeyH', 'KeyC', 'KeyE', 'KeyN', 'KeyZ', 'KeyX', 'KeyG', 'KeyQ', 'KeyW', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyY', 'KeyV', 'Digit0', 'Delete', 'Backspace', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Comma', 'Period', 'Slash']) {
    K(key, isOpen, () => {}, 'Held while Start a song is open', { hidden: true });
  }

  for (const id of PAD_ROWS) { const r = ROWS.find((x) => x.id === id); K(r.key, on('play'), (e) => tap(id, e?.timeStamp || performance.now()), `Tap the ${(r.short || r.label).toLowerCase()} (Start a song)`, { hidden: true }); }
  K('Space', () => S.step === 'play' || S.step === 'in' || S.step === 'readings', () => done(), 'Done (Start a song)', { hidden: true });
  K('Enter', () => S.step === 'play' && !document.activeElement?.closest?.('button'), () => done(), 'Done (Start a song)', { hidden: true });
  K('Backspace', on('play'), () => again(), 'Start again (Start a song)', { hidden: true });
  K('Enter', on('in'), () => next(), 'The next part: Hum over it (Start a song)', { hidden: true });
  K('KeyH', on('hum'), () => humNow(), 'Hum over the beat (Start a song)', { hidden: true });
  K('Space', on('hum'), () => humNow(), 'Hum over the beat (Start a song)', { hidden: true });
  K('ArrowRight', on('in'), () => setLevel(LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(S.level) + 1)]), 'Looser timing (Start a song)', { hidden: true });
  K('ArrowLeft', on('in'), () => setLevel(LEVELS[Math.max(0, LEVELS.indexOf(S.level) - 1)]), 'Tighter timing (Start a song)', { hidden: true });
  K('Escape', isOpen, () => leave(), 'Leave Start a song', { hidden: true, global: true });
  // a blank song from elsewhere (a demo, a link) closes the stage; an undo of the landing goes back to the door
  store.on('change', (e) => {
    if (!S.step) return;
    if (e.kind === 'load') { close({ quiet: true }); return; }
    if ((S.step === 'in' || S.step === 'readings') && S.landed && !store.findClip(S.landed.clip)) { close({ to: 'studio' }); }
  });
  // while a take is played on the stage, the agent's song-changing tools wait (agent/tools.js reads app.start.busy)
  const api = app.start = {
    open, close: (o) => close(o), tap, done, again, setLevel, useReading: (i) => useReading(i), humNow, humFree, leave,
    readings: () => (S.take ? S.take.readings.map((r) => ({ bpm: r.bpm, why: r.why, length: r.length })) : []),
    landed: () => (S.landed ? { ...S.landed } : null),
    take: () => (S.read || S.take ? { hits: S.hits.length, bpm: (S.take || S.read).bpm, length: (S.take || S.read).length, loop: (S.take || S.read).loop.bars, rounds: (S.take || S.read).fold.rounds, kept: (S.take || S.read).fold.notes.length, strays: (S.take || S.read).fold.strays.length, sure: (S.take || S.read).downbeat.sure, level: S.level, reading: S.reading } : null),
    get step() { return S.step; }, get kind() { return S.kind; },
    get busy() { return S.step === 'play' || S.step === 'hum'; },
    on(t, fn) { if (!fns.has(t)) fns.set(t, new Set()); fns.get(t).add(fn); return () => fns.get(t).delete(fn); },
  };
  return api;
}

const CSS = `
.ew-main.st-on { position: relative; }
.st-stage { position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column; overflow: auto; background: var(--bg); padding: 14px clamp(16px, 4vw, 48px) 18px; outline: none; animation: st-in .16s var(--ease, ease) both; }
@keyframes st-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.st-top { display: flex; align-items: baseline; gap: 12px; padding-bottom: 10px; border-bottom: var(--rule); }
.st-run { font-size: 15px; color: var(--text); }
.st-stepname { font-size: 12.5px; color: var(--text-3); }
.st-gap { flex: 1; }
.st-alt { display: inline-flex; gap: 12px; }
.st-body { display: flex; flex-direction: column; gap: 18px; flex: 1; min-height: 0; max-width: 1080px; width: 100%; margin: 0 auto; padding-top: 22px; }
.st-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.st-title { margin: 0; padding-bottom: 8px; border-bottom: var(--rule-heavy); font-size: clamp(28px, 4vw, 40px); color: var(--text); display: inline-block; }
.st-sub { margin: 10px 0 0; max-width: 62ch; color: var(--text-2); font-size: 13.5px; line-height: 1.5; }
.st-read { display: grid; justify-items: end; gap: 2px; min-width: 120px; }
.st-bpm { font-size: 44px; line-height: 1; color: var(--text); min-height: 44px; }
.st-unit { font-size: 11px; letter-spacing: .08em; color: var(--text-3); text-transform: uppercase; }
.st-rounds { font-size: 12px; color: var(--text-2); }
.st-winwrap, .st-gridwrap { position: relative; border-top: var(--rule); border-bottom: var(--rule); }
.st-win { display: block; width: 100%; height: clamp(120px, 22vh, 190px); }
.st-grid { display: block; width: 100%; height: clamp(110px, 20vh, 170px); }
.st-empty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; font-size: 13px; pointer-events: none; }
.st-empty[hidden] { display: none; }
.st-pads { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.st-pad { display: flex; align-items: flex-end; justify-content: space-between; height: clamp(76px, 13vh, 112px); padding: 10px 12px; border: var(--rule-2); border-radius: var(--r-press); background: none; color: var(--text); font: 600 14px/1 var(--font-ui); cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.st-pad:hover { border-color: var(--text-3); }
.st-pad.on { background: var(--text); border-color: var(--text); color: var(--bg); }
.st-pad.on kbd { color: var(--bg); border-color: var(--bg); }
.st-pad:focus-visible, .st-word:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.st-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin-top: auto; padding-top: 12px; border-top: var(--rule); }
.st-status { flex: 1 1 260px; margin: 0; color: var(--text-2); font-size: 13px; min-height: 18px; }
.st-done, .st-next, .st-use, .st-hum { height: 40px; padding: 0 18px; font-size: 14px; }
.st-done[aria-disabled="true"] { color: var(--text-3); }
.st-choice { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 4px 14px; }
.st-choice-l { min-width: 56px; font-size: 12px; }
.st-word { padding: 2px 4px; border: 0; border-radius: var(--r-press); background: none; color: var(--text-2); font: 600 13.5px/1.4 var(--font-ui); text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 4px; cursor: pointer; }
.st-word:hover { color: var(--text); }
.st-word[aria-checked="true"] { background: var(--text); color: var(--bg); text-decoration: none; }
.st-timing { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 18px; padding: 10px 0; border-bottom: var(--rule); }
.st-level { font-size: 13px; }
.st-unsure { margin: 0; color: var(--accent-2); font-size: 13px; }
.st-humwrap { display: flex; justify-content: center; padding: 18px 0; border-top: var(--rule); border-bottom: var(--rule); }
.st-hum { height: 64px; padding: 0 34px; font-size: 18px; gap: 10px; }
.btn-go kbd { color: var(--bg); border-color: color-mix(in srgb, var(--bg) 45%, transparent); }
.st-dot { width: 10px; height: 10px; background: var(--rec); }
.st-phones { font-size: 12px; }
.st-readings .ledger-row { --ledger-cols: 96px 1fr auto; cursor: pointer; padding: 12px 8px; }
.st-rbpm { font-size: 18px; }
/* the door: a ledger of ways in, each row the full width */
.st-door { max-width: 760px; width: 100%; }
.st-ways { margin: 4px 0 12px; border-top: var(--rule); }
.ledger.st-ways > li.st-way { display: grid; grid-template-columns: 150px 1fr 20px; align-items: center; gap: 12px; min-height: 56px; padding: 0 6px 0 0; border-bottom: var(--rule); cursor: pointer; }
.st-way:hover { background: var(--bg-3); }
.st-way-b { justify-self: start; height: 34px; padding: 0 14px; font-size: 13.5px; }
.st-way-why { color: var(--text-2); font-size: 13px; line-height: 1.4; }
.st-way-arrow { color: var(--text-3); justify-self: end; }
.st-notime { margin: 6px 0 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 13px; }
.ar-empty .ar-empty-agent { color: var(--text-2); }
@media (max-width: 900px) {
  .st-stage { position: fixed; inset: 0; z-index: 200; padding: 10px 16px calc(12px + env(safe-area-inset-bottom)); }
  .st-body { gap: 12px; padding-top: 12px; }
  .st-head { flex-direction: column; align-items: stretch; gap: 8px; }
  .st-read { justify-items: start; grid-auto-flow: column; align-items: baseline; gap: 8px; }
  .st-bpm { font-size: 30px; min-height: 30px; }
  .st-pads { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .st-pad { height: 120px; font-size: 16px; }
  .st-pad kbd { display: none; }
  .st-win { height: 120px; }
  .st-foot { position: sticky; bottom: 0; background: var(--bg); }
  .st-stage .st-done, .st-stage .st-next, .st-stage .st-use, .st-stage .st-hum { height: 48px; flex: 1 1 100%; }
  .st-stage .st-hum { height: 40vh; max-height: 260px; width: 100%; font-size: 22px; }
  .st-alt .btn-txt, .st-skip { font-size: 12.5px; }
  .ledger.st-ways > li.st-way { grid-template-columns: 1fr 20px; padding: 8px 0; }
  .st-way-b { grid-column: 1; height: 44px; }
  .st-way-why { grid-column: 1; font-size: 12.5px; }
  .st-way-arrow { grid-row: 1; grid-column: 2; }
  .st-top { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .st-stage { animation: none; } }
`;
