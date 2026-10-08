// Musical typing: the computer's keys as a keyboard, as a MODE (` toggles it; Esc leaves). While it's on, the home row
// plays: A S D F G H J K L ; ' are the white keys from C, W E T Y U O P the black ones, Z X shift an octave, C V make it
// softer or harder; a strip at the bottom of the screen shows the keys, the octave, the velocity and which track you're
// playing. Scale lock (from the song's key) turns the home row into the scale's notes, so nothing is out of key: it is
// on until you turn it off (a newcomer's keys fit the song), and the keys out of the key are dimmed when it's off. The
// notes are spelled for the song's key, as the piano roll spells them (C minor: Eb Ab Bb, not D# G# A#).
// On the grid (q.quantize, on until you turn it off): what the keys play lands on the Sketch grid (input.options.grid),
// in a take recorded with R (input/recorder.js) and in a phrase kept from capture (its `snap`), your own timing kept
// alongside. Esc leaves the mode unless a menu, a popover, a hum or a busy agent has it. Notes play live on the selected
// (or armed) instrument track and go to capture like any MIDI.
//
// The line (docs/FRESH-EYES-5.md: notes moved and nothing on screen said they would): the strip's head says what the two
// helpers do to what you play, "Snapping to 1/16, in C minor", the grid named as the arranger names it (1/16, 1/8, 1/8T)
// and the key shown while Scale lock is on (with no key in the song, what it uses: C major, the white notes). Each part
// is a click that turns its helper off, and then says what's on instead ("Your timing", "every note"); again turns it
// back on. The choice is kept in this browser and announced. A touch screen's keys (ui/sketch.js) carry the same line.
//
// The strip floats at the bottom of the screen, or docks in a host (Sketch's Play it: qwerty.dock(el), dock(null) to
// float again), where it covers nothing. A touch-only screen has no keys to type: the strip only shows docked there.
//
//   qwerty.on (bool) ; qwerty.toggle(on?) ; qwerty.octave ; qwerty.velocity ; qwerty.scaleLock ; qwerty.pitchOf(code)
//   qwerty.setScaleLock(on) ; qwerty.quantize ; qwerty.setQuantize(on) ; qwerty.dock(el | null)
//   qwerty.snapLine({ touch }) -> { el, paint() }   the line, for another host (the touch keys)
//   events (app.input.on): 'qwerty' (state), 'note'
// Pure: snapWords({ quantize, scaleLock, grid, key, touch }) -> { grid, key }: each part's { on, text, title, say }
// (the key's `aside` too: "no key set").

import { h, css } from '../ui/dom.js';
import { songColor, snapLabel } from '../ui/arrange-kit.js';
import { spellNote, scalePcs, parsePc, inScale, keyLabel } from '../core/music.js';

export const TYPE_MAP = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};
const WHITE = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
const LABEL = { Semicolon: ';', Quote: "'" };
const SAVE = 'overdub:qwerty';
// what Scale lock plays with no key in the song: the white keys (the touch keys' octave too)
const NO_KEY = { root: 'C', scale: 'major' };

// A grid as the arranger's Snap names it (1/16, 1/8, 1/8T, 1/32), a triplet the same way (1/16T), else "the beat",
// "the bar"
export function gridName(g) {
  const s = +g > 0 ? +g : 0.25,
    l = snapLabel(s);
  if (l === 'Beat' || l === 'Bar') return `the ${l.toLowerCase()}`;
  if (/^1\//.test(l)) return l;
  const n = 4 / s;
  if (Math.abs(n - Math.round(n)) < 1e-6)
    return Math.round(n) % 3 ? `1/${Math.round(n)}` : `1/${(Math.round(n) * 2) / 3}T`;
  return `${Math.round(s * 1000) / 1000} beats`;
}
// The line's words: the grid part and the key part, on (the helper at work) or off (what's on instead), with a title
// saying what a click does and the words the announcer says when it changes
export function snapWords({ quantize = true, scaleLock = true, grid = 0.25, key = null, touch = false } = {}) {
  const verb = touch ? 'Tap' : 'Click',
    g = gridName(grid),
    kl = keyLabel(key || NO_KEY);
  const gridPart = quantize
    ? {
        on: true,
        text: `Snapping to ${g}`,
        title: `On the grid: what you play lands on ${g === 'the beat' || g === 'the bar' ? g : `the ${g} grid`}. ${verb} to keep your own timing.`,
        say: `Snapping to ${g}: the keys land on the grid`,
      }
    : {
        on: false,
        text: 'Your timing',
        title: `Your timing: what you play stays where you played it. ${verb} to snap it to ${g === 'the beat' || g === 'the bar' ? g : `the ${g} grid`}.`,
        say: 'Your timing: nothing snaps to the grid',
      };
  const keyPart = scaleLock
    ? key
      ? {
          on: true,
          text: `in ${kl}`,
          aside: '',
          title: `Scale lock: the keys play only ${kl}, so no note sounds wrong. ${verb} to play every note.`,
          say: `In ${kl}: Scale lock on`,
        }
      : {
          on: true,
          text: `in ${kl}`,
          aside: 'no key set',
          title: `Scale lock: the song has no key, so the keys play ${kl}, the white notes. ${verb} to play every note.`,
          say: `In ${kl}: Scale lock on, and the song has no key`,
        }
    : {
        on: false,
        text: 'every note',
        aside: '',
        title: `Every note: the keys play all twelve${key ? `, the ones outside ${kl} dimmed` : ''}. ${verb} to play only ${kl}.`,
        say: 'Every note: Scale lock off',
      };
  return { grid: gridPart, key: keyPart };
}

export function createQwerty(app, input) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SAVE) || '{}') || {};
  } catch {
    saved = {};
  }
  const down = new Map(); // code -> pitch it is holding (an octave change mid-note lets the right one go)
  const q = {
    on: false,
    octave: Number.isFinite(saved.octave) ? saved.octave : 4,
    velocity: Number.isFinite(saved.velocity) ? saved.velocity : 0.8,
    // (a saved choice counts only once you made one: older saves wrote scaleLock: false with every octave change)
    scaleLock: saved.lockSet ? !!saved.scaleLock : true,
    quantize: saved.quantize !== false,
    map: TYPE_MAP,
    pitchOf(code) {
      if (!(code in TYPE_MAP)) return null;
      const base = (q.octave + 1) * 12;
      if (!q.scaleLock) return base + TYPE_MAP[code];
      const key = app.store.get().key;
      const wi = WHITE.indexOf(code);
      if (wi < 0 || !key) return wi < 0 ? null : base + TYPE_MAP[code];
      const pcs = scalePcs(key),
        root = parsePc(key.root),
        n = pcs.length;
      const deg = pcs.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b);
      return base + root + deg[wi % n] + 12 * Math.floor(wi / n);
    },
    toggle(on = !q.on) {
      if (on && input.mode === 'tap') input.setMode(null);
      const was = q.on;
      q.on = !!on;
      if (!q.on) release();
      input.mode = q.on ? 'qwerty' : input.mode === 'qwerty' ? null : input.mode;
      if (q.on !== was) {
        const tr = input.target();
        said = tr?.id || null;
        say(
          q.on
            ? tr
              ? `Musical typing on, playing ${tr.name}`
              : 'Musical typing on: no instrument track to play'
            : 'Musical typing off',
        );
      }
      paint();
      save();
      input.emit('qwerty', q);
      input.emit('mode', input.mode);
      return q.on;
    },
    // (each change is said in the line's own words: "Every note: Scale lock off", "Snapping to 1/16: ...")
    setScaleLock(v) {
      const was = q.scaleLock;
      q.scaleLock = !!v;
      lockSet = true;
      release();
      if (was !== q.scaleLock) say(words().key.say);
      paint();
      save();
      input.emit('qwerty', q);
    },
    setQuantize(v) {
      const was = q.quantize;
      q.quantize = !!v;
      if (was !== q.quantize) say(words().grid.say);
      paint();
      save();
      input.emit('qwerty', q);
    },
    press(code) {
      if (down.has(code)) return;
      const p = q.pitchOf(code);
      if (p == null || p < 0 || p > 127) return;
      down.set(code, p);
      input.noteOn('qwerty', p, q.velocity, 'qwerty');
      lit(code, true);
    },
    release(code) {
      if (!down.has(code)) return;
      const p = down.get(code);
      down.delete(code);
      input.noteOff('qwerty', p, 'qwerty');
      lit(code, false);
    },
    held: () => [...down.values()],
  };
  function release() {
    for (const code of [...down.keys()]) q.release(code);
  }
  // Screen readers hear real changes only (on/off, the track, octave, velocity, the grid, scale lock) through the shell's
  // one-line announcer; the strip itself is a picture of the keys and stays quiet while you play.
  let said = null; // the track last announced
  const say = (text) => {
    try {
      app.ui.announce?.(text);
    } catch {
      /* no shell */
    }
  };
  const words = (touch = false) =>
    snapWords({
      quantize: q.quantize,
      scaleLock: q.scaleLock,
      grid: input.options?.grid || 0.25,
      key: app.store.get().key,
      touch,
    });
  // The line: "Snapping to 1/16, in C minor", each part a button that turns its helper off and on. Its buttons stay the
  // same nodes as it repaints (a keyboard's focus stays on the one pressed)
  q.snapLine = ({ touch = false } = {}) => {
    const part = (cls, run) => h(`button.ew-snap-p.${cls}`, { type: 'button', onclick: run });
    const gridB = part('ew-snap-grid', () => q.setQuantize(!q.quantize));
    const keyB = part('ew-snap-key', () => q.setScaleLock(!q.scaleLock));
    // (a narrow line wraps between its parts, each comma kept with the word before it)
    const keyTail = document.createTextNode('');
    const aside = h('span.ew-snap-aside');
    const el = h(
      'span.ew-snap',
      { role: 'group', 'aria-label': 'Grid and key' },
      h('span.ew-snap-w', gridB, ', '),
      h('span.ew-snap-w', keyB, keyTail),
      aside,
    );
    const paint = () => {
      const w = words(touch);
      for (const [b, x] of [
        [gridB, w.grid],
        [keyB, w.key],
      ]) {
        if (b.textContent !== x.text) b.textContent = x.text;
        b.title = x.title;
        b.dataset.on = String(x.on);
      }
      keyTail.data = w.key.aside ? ', ' : '';
      aside.textContent = w.key.aside || '';
      aside.hidden = !w.key.aside;
      el.dataset.grid = String(w.grid.on);
      el.dataset.key = String(w.key.on);
    };
    paint();
    return { el, paint };
  };
  // a key going down or up lights its cell; the rest of the strip stays as it is
  function lit(code, on) {
    for (const c of strip.querySelectorAll('.ew-qw-k')) if (c.dataset.code === code) c.classList.toggle('on', on);
  }
  let lockSet = !!saved.lockSet;
  function save() {
    try {
      localStorage.setItem(
        SAVE,
        JSON.stringify({
          octave: q.octave,
          velocity: q.velocity,
          scaleLock: q.scaleLock,
          lockSet,
          quantize: q.quantize,
        }),
      );
    } catch {
      /* ok */
    }
  }
  // what the keys play lands on the grid: a phrase from musical typing or the touch keys carries the grid it snaps to
  // (capture.phraseNotes uses it; a pass recorded with R is snapped as it records)
  input.capture?.on?.((e) => {
    const ph = e && e.what === 'add' ? e.phrase : null;
    if (ph && !ph.rec && ph.snap == null && (ph.src === 'qwerty' || ph.src === 'touch') && q.quantize)
      input.capture.update(ph.id, { snap: input.options?.grid || 0.25 });
  });

  const keys = app.ui.keys,
    when = () => q.on;
  keys.add({ key: 'Backquote', run: () => q.toggle(), label: 'Musical typing on/off', group: 'Play' });
  // Esc leaves musical typing before it clears a selection (first: the mode is what the keys are doing), unless something
  // that Esc closes is open: a menu or popover, a dialog or a phone's sheet, a hum, an agent at work
  const escFree = () =>
    !document.querySelector('.ek-pop, .ew-pop, .sk-menu, [role=menu], [aria-modal=true]') &&
    !input.hum?.active &&
    !app.agent?.busy;
  keys.add({
    key: 'Escape',
    first: true,
    when: () => q.on && escFree(),
    run: () => q.toggle(false),
    label: 'Leave musical typing',
    group: 'Play',
  });
  for (const code of Object.keys(TYPE_MAP))
    keys.add({
      key: code,
      when,
      run: (e) => {
        if (!e.repeat) q.press(code);
      },
      label: 'Play a note (musical typing)',
      group: 'Play',
    });
  keys.add({
    key: 'KeyZ',
    when,
    run: (e) => {
      if (e.repeat) return;
      release();
      q.octave = Math.max(0, q.octave - 1);
      say(`Octave ${q.octave}`);
      paint();
      save();
      input.emit('qwerty', q);
    },
    label: 'Octave down (musical typing)',
    group: 'Play',
  });
  keys.add({
    key: 'KeyX',
    when,
    run: (e) => {
      if (e.repeat) return;
      release();
      q.octave = Math.min(8, q.octave + 1);
      say(`Octave ${q.octave}`);
      paint();
      save();
      input.emit('qwerty', q);
    },
    label: 'Octave up (musical typing)',
    group: 'Play',
  });
  keys.add({
    key: 'KeyC',
    when,
    run: () => {
      q.velocity = Math.max(0.2, Math.round((q.velocity - 0.1) * 10) / 10);
      say(`Velocity ${Math.round(q.velocity * 100)}`);
      paint();
      save();
      input.emit('qwerty', q);
    },
    label: 'Softer (musical typing)',
    group: 'Play',
  });
  keys.add({
    key: 'KeyV',
    when,
    run: () => {
      q.velocity = Math.min(1, Math.round((q.velocity + 0.1) * 10) / 10);
      say(`Velocity ${Math.round(q.velocity * 100)}`);
      paint();
      save();
      input.emit('qwerty', q);
    },
    label: 'Harder (musical typing)',
    group: 'Play',
  });
  // note-offs: the shell's handler is keydown only
  // Every way a key-up can go missing lets go of everything: the window losing focus (a dialog, another app), the
  // page hidden, and Cmd let go (macOS sends no keyup for a key released while Cmd is down).
  window.addEventListener(
    'keyup',
    (e) => {
      if (down.has(e.code)) q.release(e.code);
      else if (down.size && (e.key === 'Meta' || /^(Meta|OS)(Left|Right)$/.test(e.code))) release();
    },
    true,
  );
  window.addEventListener('blur', release);
  window.addEventListener('pagehide', release);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
  });

  /* ---- the strip: which key plays what, while the mode is on */
  css('qwerty', QCSS);
  const strip = h('div.ew-qw', { role: 'group', 'aria-label': 'Musical typing', hidden: true });
  document.body.append(strip);
  let dockHost = null;
  q.dock = (host) => {
    dockHost = host || null;
    if (strip.parentNode !== (dockHost || document.body)) (dockHost || document.body).append(strip);
    strip.classList.toggle('docked', !!dockHost);
    paint();
  };
  const touchOnly = () =>
    typeof matchMedia === 'function' &&
    matchMedia('(pointer: coarse)').matches &&
    !matchMedia('(any-pointer: fine)').matches;
  // the line in the strip's head, floating or docked, recording or not: what the grid and the key do to what you play
  const snap = q.snapLine();
  function paint() {
    strip.hidden = !q.on || (!dockHost && touchOnly());
    if (strip.hidden) return;
    snap.paint();
    const tr = input.target(),
      heldSet = new Set(down.keys());
    if ((tr?.id || null) !== said) {
      said = tr?.id || null;
      say(tr ? `Musical typing plays ${tr.name}` : 'Musical typing: no instrument track to play');
    }
    // (each note spelled for the song's key: C minor's are Eb, Ab and Bb, as the piano roll writes them, never D# G# A#)
    const cell = (code, black) => {
      const p = q.pitchOf(code),
        off = p == null,
        key = app.store.get().key;
      // scale lock off: the keys out of the song's key are dimmed (on, every key that plays is in it)
      const out = !off && !q.scaleLock && !!key && !inScale(p, key);
      return h(
        `div.ew-qw-k${black ? '.blk' : ''}${heldSet.has(code) ? '.on' : ''}${off ? '.off' : ''}${out ? '.out' : ''}`,
        { dataset: { code }, title: out ? `${spellNote(p, key)} is outside ${key.root} ${key.scale}` : null },
        h('kbd', LABEL[code] || code.replace('Key', '')),
        h('small', off ? '' : spellNote(p, key)),
      );
    };
    const blacks = ['KeyW', 'KeyE', null, 'KeyT', 'KeyY', 'KeyU', null, 'KeyO', 'KeyP', null];
    // (the line's buttons move into the new head: one that had the focus keeps it)
    const focused = snap.el.contains(document.activeElement) ? document.activeElement : null;
    strip.replaceChildren(
      h(
        'div.ew-qw-head',
        h('b', 'Musical typing'),
        h(
          'span.ew-qw-to',
          tr ? ['→ ', h('i', { style: { background: songColor(tr.color) } }), tr.name] : 'no instrument track',
        ),
        snap.el,
        h(
          'span.ew-qw-meta',
          h('kbd', 'Z'),
          h('kbd', 'X'),
          ` octave ${q.octave}`,
          h('span.sep'),
          h('kbd', 'C'),
          h('kbd', 'V'),
          ` velocity ${Math.round(q.velocity * 100)}`,
        ),
        h(
          'button.ew-qw-x',
          { title: 'Leave musical typing (` or Esc)', onclick: () => q.toggle(false) },
          h('kbd', '`'),
          ' off',
        ),
      ),
      h(
        'div.ew-qw-row.blk-row',
        { 'aria-hidden': 'true' },
        blacks.map((c) => (c ? cell(c, true) : h('div.ew-qw-gap'))),
      ),
      h(
        'div.ew-qw-row',
        { 'aria-hidden': 'true' },
        WHITE.map((c) => cell(c, false)),
      ),
    );
    if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
  q.paint = paint;
  app.store.on('change', () => {
    if (q.on) paint();
  });
  app.ui.on('select', () => {
    if (q.on) paint();
  });
  return q;
}

const QCSS = `
.ew-qw { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 900; padding: 10px 12px 12px; border-radius: var(--r-3);
  background: color-mix(in srgb, var(--bg-2) 92%, transparent); border: 1px solid var(--line-2); box-shadow: var(--shadow-2), 0 0 0 1px var(--human-wash) inset;
  backdrop-filter: blur(10px); max-width: calc(100vw - 16px); animation: ew-qw-in .22s var(--ease) both; font-family: var(--font-ui); }
.ew-qw[hidden] { display: none; }
.ew-qw.docked { position: static; left: auto; bottom: auto; transform: none; z-index: auto; max-width: 100%; animation: none; backdrop-filter: none; box-shadow: 0 0 0 1px var(--human-wash) inset; padding: 8px 10px 10px; background: var(--bg-2); }
.ew-qw.docked .ew-qw-head { margin-bottom: 5px; gap: 10px; }
/* docked, the pane around it already names the track and has the off switch: the strip keeps the line (what the grid
   and the key do to what you play), the octave and the velocity */
.ew-qw.docked .ew-qw-head > b, .ew-qw.docked .ew-qw-to, .ew-qw.docked .ew-qw-x { display: none; }
.ew-qw.docked .ew-qw-meta, .ew-qw.docked .ew-snap { display: inline-flex; }
.ew-qw.docked .ew-qw-k, .ew-qw.docked .ew-qw-gap { flex: 0 1 40px; min-width: 18px; }
.ew-qw.docked .ew-qw-k { height: 42px; }
.ew-qw.docked .ew-qw-k.blk { height: 36px; }
@keyframes ew-qw-in { from { opacity: 0; transform: translate(-50%, 10px); } }
.ew-qw-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; font-size: 12px; color: var(--text-2); flex-wrap: wrap; }
.ew-qw-head b { color: var(--human); font-weight: 700; letter-spacing: .02em; }
.ew-qw-to { display: inline-flex; align-items: center; gap: 6px; color: var(--text); }
.ew-qw-to i { width: 8px; height: 8px; border-radius: 3px; display: inline-block; }
.ew-qw-meta { display: inline-flex; align-items: center; gap: 3px; color: var(--text-3); }
.ew-qw-meta .sep { width: 10px; }
.ew-qw-x { height: 24px; margin-left: auto; padding: 0 8px; border-radius: var(--r-1); border: 1px solid var(--line-2); background: var(--bg-3); color: var(--text-2); cursor: pointer; font-size: 11px; font-weight: 600; }
/* the line: one sentence, its two parts the switches ("Snapping to 1/16, in C minor"). A helper at work is cream, one
   turned off reads in the secondary ink; a dotted underline says a part takes a click, a solid one under the pointer */
.ew-snap { display: inline-flex; align-items: baseline; flex-wrap: wrap; column-gap: .3em; min-width: 0; font: 400 12px/1.35 var(--font-ui); color: var(--text-3); }
.ew-snap-w, .ew-snap-aside { white-space: nowrap; }
.ew-snap-aside[hidden] { display: none; }
.ew-snap-p { margin: 0; padding: 3px 0; border: 0; border-radius: 0; background: none; font: inherit; font-weight: 600; color: var(--text); cursor: pointer; white-space: nowrap;
  text-decoration: underline dotted var(--text-3); text-decoration-thickness: 1px; text-underline-offset: 3px; }
.ew-snap-p[data-on="false"] { font-weight: 400; color: var(--text-2); }
.ew-snap-p:hover { text-decoration-style: solid; text-decoration-color: currentColor; }
.ew-snap-p:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.ew-qw-row { display: flex; gap: 4px; }
.ew-qw-row.blk-row { padding-left: 22px; margin-bottom: 4px; }
.ew-qw-gap { width: 40px; flex: none; }
.ew-qw-k { width: 40px; height: 46px; flex: none; border-radius: 7px; background: #efe8dc; color: #2a2238; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 5px 0 4px;
  box-shadow: 0 2px 0 #b9ad9a, 0 3px 8px rgba(0,0,0,.35); transition: transform .06s, background .06s, box-shadow .06s; }
.ew-qw-k kbd { background: none; border: 0; padding: 0; color: inherit; font-weight: 700; font-size: 12px; }
.ew-qw-k small { font-family: var(--font-mono); font-size: 9.5px; opacity: .7; }
.ew-qw-k.blk { background: #2b2440; color: var(--text-2); height: 40px; box-shadow: 0 2px 0 #120f20, 0 3px 8px rgba(0,0,0,.4); }
.ew-qw-k.on { background: var(--human); color: #2a1a08; transform: translateY(2px); box-shadow: 0 0 0 #000, 0 0 18px color-mix(in srgb, var(--human) 70%, transparent); }
.ew-qw-k.off { opacity: .25; }
.ew-qw-k.out:not(.on) { background: #b8ae9e; box-shadow: 0 2px 0 #8d8474, 0 3px 8px rgba(0,0,0,.35); }
.ew-qw-k.blk.out:not(.on) { background: #1d1830; color: var(--text-3); }
@media (max-width: 600px) { .ew-qw-k, .ew-qw-gap { width: 26px; } .ew-qw-k small { display: none; } .ew-qw-row.blk-row { padding-left: 14px; } .ew-qw-meta { display: none; } }
`;
