// The circle [ui, a prototype]: the simple view with the song drawn as a loop you sit around. Reached only with
// ?view=round (ui/workspace-view.js decideView: the simple view, for that load, never written down). It registers a
// center panel, Circle, beside Arrange; Arrange is one tab (or "Timeline view") away, same song, same undo.
//
//   - One part of the song at a time: a section, or four bars when the song has none, and the loop while it is on.
//     The row above the circle names them all; while the song plays, the circle follows the playhead (from section to
//     section when you're on a section, round the loop when you're on the loop).
//   - A ring per track (8 at most; the rest are in the timeline), outermost first, each named in its own colour along
//     its arc just before the seam at 12 o'clock, where the loop comes round. The leader-green hand is the playhead.
//     Ring widths never move: a ring with nothing in this part is a thin dashed one, every other ring is the same width,
//     and selecting one brightens it (a cream frame, the others dimmed) instead of widening it. Two tracks whose colours
//     are too close to tell apart get a different one from the track palette here (the song keeps its own).
//   - Pitch is the distance from the centre inside a ring (low inside, high outside); the selected ring draws its top
//     line as a contour through its notes. Drums are dots on three lanes: kick inside, snare and toms, hats and cymbals
//     outside. The selected ring is unrolled beside the circle (under it, on a phone) onto a straight strip with its
//     note or kit names.
//   - While it plays, what the hand is over lights: notes brighten and glow, drum dots swell, on the circle and the strip.
//   - Notes keep their track's colour; a note by someone other than its clip's author has a warm or cool outline, as
//     in the arranger. Who made each part is a byline in the list beside the circle. Nothing is tinted by author.
//   - Tap a ring (or its row) to select that track, and its clip under the tap: the agent's scope follows the selection
//     as everywhere else, and follows the page too (turning to the Chorus selects the track's clip there).
//   - The middle: a blank song has the studio's doors there (Tap a beat, Hum it, Play the keys). A song with parts has
//     the page's name, where the hand is and Play/Stop there; the doors move to a quieter "Add a part" row by the list,
//     and say what they did to the loop when they changed it.
//   - Asking: on a desktop the Agent panel beside the circle is the one Ask (it follows the selection). On a phone,
//     where the agent is behind a button, an Ask line under the list, with chips that fit the selected track.
//
// No song ops of its own: viewing, paging and selecting never touch the store. Drawn only in frame(now).
//
// app.round = { page(), pages(), rings(), geom(), select(trackId), hit(x, y), setPage(key), back(), colors() }

import { h, css, canvas, byline, icon, clamp } from './dom.js';
import { palette, resolveColor, rgba, rgbOf, shade, authorKind, isDrumTrack } from './arrange-kit.js';
import { beatsPerBar, spellNote, kitNotes, drumName } from '../core/music.js';
import { TRACK_COLORS } from '../core/project.js';

const TAU = Math.PI * 2;
const SEAM = 0.15; // radians left open at 12 o'clock: where the loop comes round
const MAX_RINGS = 8;
const PHONE = () => {
  try {
    return matchMedia('(max-width: 640px)').matches;
  } catch (e) {
    return false;
  }
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// a kit's three lanes: 0 kick, 1 snare / clap / toms, 2 hats, cymbals and the rest (General MIDI numbers)
const laneOf = (p) =>
  p === 35 || p === 36 ? 0 : (p >= 37 && p <= 41) || p === 43 || p === 45 || p === 47 || p === 48 || p === 50 ? 1 : 2;
const LANE_NAMES = ['kick', 'snare', 'hats'];
const SOUNDING_HIT = 0.32; // beats a drum hit stays lit after the hand passes it

export default function installRound(app) {
  const wanted =
    app.round === true ||
    (() => {
      try {
        return new URLSearchParams(location.search).get('view') === 'round';
      } catch (e) {
        return false;
      }
    })();
  if (!wanted) return;
  const { ui, store, engine } = app;
  css('round', ROUND_CSS);
  let api = null;
  ui.panel({ id: 'round', region: 'center', title: 'Circle', order: -10, mount: (el) => (api = mount(el)) });
  ui.show('round', { save: false });
  app.round = {
    page: () => api?.page() || null,
    pages: () => api?.pages() || [],
    rings: () => api?.rings() || [],
    geom: () => api?.geom() || null,
    select: (id) => api?.select(id),
    hit: (x, y) => api?.hit(x, y) || null,
    setPage: (k) => api?.setPage(k),
    back: () => back(),
    colors: () => api?.colors() || {},
  };

  // back to the timeline: Arrange, and ?view=round off the address so a reload opens the view you're in
  function back() {
    ui.show('arranger');
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('view') === 'round') {
        u.searchParams.delete('view');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      }
    } catch (e) {
      /* fine */
    }
  }

  function mount(el) {
    const bpbOf = () => beatsPerBar(store.get().meter);
    let pageKey = null; // which part of the song is the circle (null: the first, or the loop)
    let dirty = true;
    let geo = null; // the last drawing's geometry: { cx, cy, rIn, rOut, rings: [{ id, r0, r1 }] }
    let said = ''; // what a door last did to the loop, said once under the doors
    let lastPos = '',
      lastPlaying = null;

    /* ------------------------------------------------ the parts of the song a circle can be */
    function songEnd(p) {
      let end = 0;
      for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
      return end;
    }
    const barsOf = (a, b, bpb = bpbOf()) =>
      b - a <= bpb ? `Bar ${Math.round(a / bpb) + 1}` : `Bars ${Math.round(a / bpb) + 1}–${Math.round(b / bpb)}`;
    function pages() {
      const p = store.get(),
        bpb = bpbOf(),
        out = [];
      const bars = (a, b) => barsOf(a, b, bpb);
      if (p.loop?.on && p.loop.end > p.loop.start)
        out.push({
          key: 'loop',
          name: 'The loop',
          sub: bars(p.loop.start, p.loop.end),
          start: p.loop.start,
          len: p.loop.end - p.loop.start,
        });
      if (p.sections?.length) {
        for (const s of p.sections)
          out.push({
            key: 's:' + s.id,
            name: s.name,
            sub: bars(s.start, s.start + s.length),
            start: s.start,
            len: s.length,
          });
      } else {
        const chunk = 4 * bpb,
          end = Math.max(songEnd(p), chunk);
        for (let a = 0; a < end - 1e-6; a += chunk)
          out.push({ key: 'b:' + a, name: bars(a, a + chunk), sub: '', start: a, len: chunk });
      }
      // the loop again under another name (a section that is the loop) is one circle, not two
      if (out[0]?.key === 'loop') {
        const dup = out.findIndex(
          (x, i) => i > 0 && Math.abs(x.start - out[0].start) < 1e-6 && Math.abs(x.len - out[0].len) < 1e-6,
        );
        if (dup > 0) out.splice(0, 1);
      }
      return out;
    }
    function page() {
      const list = pages();
      return list.find((x) => x.key === pageKey) || list[0];
    }
    const within = (b, pg) => !!pg && b >= pg.start - 1e-9 && b < pg.start + pg.len;
    function setPage(key, { seek = false } = {}) {
      const pg = pages().find((x) => x.key === key);
      if (!pg) return false;
      if (pageKey !== key) {
        pageKey = key;
        dirty = true;
        // the agent's scope follows the page: the selected track's clip in this part, when the one selected isn't in it
        const sel = selTrack(),
          cid = ui.state.selection.clip,
          c = cid && store.findClip?.(cid);
        const clip = c && (c.clip || c);
        if (sel && !(clip && clip.start < pg.start + pg.len && clip.start + clip.length > pg.start))
          pick(store.track(sel), pg.start);
        renderHead();
        renderSide();
      }
      if (seek && engine.playing && !within(engine.beat, pg)) engine.seek?.(pg.start);
      return true;
    }
    // while the song plays the circle follows the playhead: round the loop while you're on the loop, from section to
    // section while you're on a section (the Chorus doesn't snap back to the loop because the loop contains it)
    function follow() {
      const b = engine.beat,
        cur = page();
      if (!cur || within(b, cur)) return;
      const all = pages(),
        same = all.filter((x) => (x.key === 'loop') === (cur.key === 'loop'));
      const next = same.find((x) => within(b, x)) || all.find((x) => within(b, x));
      if (next) setPage(next.key);
    }

    /* ------------------------------------------------ the rings */
    const selTrack = () => {
      const id = ui.state.selection.track;
      return id && store.track(id) ? id : null;
    };
    function rings() {
      const p = store.get(),
        sel = selTrack();
      let list = p.tracks.slice(0, MAX_RINGS);
      // the selected track always has a ring (it takes the last place when it's further down)
      if (sel && !list.some((t) => t.id === sel)) list = [...list.slice(0, MAX_RINGS - 1), store.track(sel)];
      return list;
    }
    const folded = () => Math.max(0, store.get().tracks.length - MAX_RINGS);
    // the ring colours: each track's own, unless it's too close to one already on the circle (Bass and Keys both
    // lavender): then the free colour of the track palette furthest from the others. A view of the song, not an edit.
    const dist = (a, b) => {
      const x = rgbOf(a),
        y = rgbOf(b);
      return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    };
    function ringColors(rs = rings()) {
      const out = new Map(),
        used = [],
        pool = TRACK_COLORS.map((c) => resolveColor(c)),
        own = rs.map((t) => resolveColor(t.color));
      const near = (c) => used.some((u) => dist(u, c) < 40);
      const minD = (c) => Math.min(...used.map((u) => dist(u, c)));
      rs.forEach((t, i) => {
        let c = own[i];
        if (near(c)) {
          // (a colour no later ring has of its own first, so one change doesn't push the next ring off its colour)
          const free = pool.filter((x) => !near(x)),
            spare = free.filter((x) => !own.slice(i + 1).some((o) => dist(o, x) < 40));
          const pickFrom = (spare.length ? spare : free).sort((m, n) => minD(n) - minD(m));
          if (pickFrom.length) c = pickFrom[0];
        }
        used.push(c);
        out.set(t.id, c);
      });
      return out;
    }
    // what a track plays in this page: [{ clip, notes: [{ p, t (song beats), d, v, by }] }]
    function inPage(t, pg) {
      const out = [];
      const a = pg.start,
        b = pg.start + pg.len;
      for (const c of t.clips) {
        if (c.start >= b || c.start + c.length <= a) continue;
        if (c.mute && c.take) continue; // a take that isn't playing
        const notes = [];
        if (c.kind === 'notes')
          for (const n of c.notes) {
            const s = c.start + n.t;
            if (n.t >= c.length || s >= b || s + n.d <= a) continue;
            notes.push({ p: n.p, t: s, d: Math.min(n.d, c.length - n.t), v: n.v ?? 0.8, by: n.by || c.by });
          }
        out.push({ clip: c, notes });
      }
      return out;
    }
    const emptyIn = (t, pg) => !inPage(t, pg).some((x) => x.notes.length || x.clip.kind === 'audio');
    function rangeOf(list, drums) {
      let lo = Infinity,
        hi = -Infinity;
      for (const x of list)
        for (const n of x.notes) {
          lo = Math.min(lo, n.p);
          hi = Math.max(hi, n.p);
        }
      if (!isFinite(lo)) {
        lo = 48;
        hi = 72;
      }
      const span = drums ? 4 : 10;
      if (hi - lo < span) {
        const m = (lo + hi) / 2;
        lo = Math.floor(m - span / 2);
        hi = lo + span;
      }
      return { lo: lo - 0.5, hi: hi + 0.5 };
    }
    function signers(list, t) {
      const by = [];
      const add = (x) => {
        if (x && !by.includes(x) && authorKind(app, x) !== 'house') by.push(x);
      };
      for (const x of list) {
        add(x.clip.by);
        for (const n of x.notes) add(n.by);
      }
      if (!list.length) add(t.by);
      return by;
    }
    // a note is sounding when the hand is over it (a hit: for a moment after the hand passes it)
    const sounding = (n, drums, b) =>
      engine.playing && b >= n.t && b < n.t + (drums ? SOUNDING_HIT : Math.max(n.d, 0.12));

    /* ------------------------------------------------ the DOM */
    const pagesEl = h('div.rd-pages', { role: 'group', 'aria-label': 'Which part of the song the circle shows' });
    const backBtn = h(
      'button.btn.btn-txt.rd-back',
      { type: 'button', title: 'The same song as a timeline (Arrange)', onclick: () => back() },
      'Timeline view',
    );
    const head = h('div.rd-head', pagesEl, backBtn);
    const C = canvas('rd-cv');
    C.cv.setAttribute('role', 'img');
    // the middle of a song with parts: the page, where the hand is, and Play
    const hubName = h('span.rd-hub-name');
    const hubPos = h('span.rd-hub-pos.mono');
    const playBtn = h('button.btn.rd-play', { type: 'button', onclick: () => playPage() });
    const hub = h('div.rd-hub', hubName, hubPos, playBtn);
    const dial = h('div.rd-dial', C.cv, hub);
    // the doors: in the middle of a blank song; on a song with parts, the quieter "Add a part" row by the list
    const door = (label, title, run, cls = '') =>
      h('button.btn.rd-door' + cls, { type: 'button', title, onclick: () => useDoor(run) }, label);
    const tapDoor = door('Tap a beat', 'A drum track, a 2-bar loop and the click: R records, F J K L tap', () =>
      app.onboard?.firstMinute ? app.onboard.firstMinute('tap') : ui.show('sketch'),
    );
    const doors = h(
      'div.rd-doors',
      { role: 'group', 'aria-label': 'Make a part' },
      tapDoor,
      door('Hum it', 'Sing or hum the idea; it comes back as notes (H)', () => app.input?.toggleHum?.()),
      door('Play the keys', 'A keys track and musical typing over the loop', () =>
        app.onboard?.keysOver ? app.onboard.keysOver() : ui.show('sketch'),
      ),
    );
    const stage = h('div.rd-stage', dial);
    const listHead = h('div.rd-lh');
    const list = h('ul.ledger.rd-list', { 'aria-label': 'Parts on the circle' });
    const addHead = h('div.rd-add-h', h('span.head', 'Add a part'));
    const addSaid = h('p.rd-said.t3', { role: 'status' });
    const add = h('div.rd-add', addHead, addSaid);
    const S = canvas('rd-strip-cv');
    S.cv.setAttribute('aria-hidden', 'true');
    const stripHead = h('div.rd-sh');
    const stripNote = h('p.rd-strip-note.t3');
    const strip = h('div.rd-strip', stripHead, h('div.rd-strip-box', S.cv), stripNote);
    const side = h('div.rd-side', listHead, list, add);
    const body = h('div.rd-body', stage, strip, side);
    const askIn = h('input.rd-ask-in', {
      type: 'text',
      'aria-label': 'Ask your agent',
      autocomplete: 'off',
      enterkeyhint: 'send',
    });
    const askBtn = h('button.btn.ew-btn-agent.rd-ask-go', { type: 'submit' }, icon('agent', { size: 14 }), 'Ask');
    const chips = h('div.rd-chips');
    const ask = h(
      'form.rd-ask',
      {
        onsubmit: (e) => {
          e.preventDefault();
          send(askIn.value);
        },
      },
      h('div.rd-ask-row', askIn, askBtn),
      chips,
    );
    const root = h('div.rd', head, body, ask);
    el.append(root);

    function send(text) {
      text = String(text || '').trim();
      if (!text) {
        askIn.focus();
        return;
      }
      const ag = app.agent;
      if (ag && !ag.provider) ag.useMock?.(true); // the demo agent when nothing else is connected (as Take one does)
      ui.emit('agent:compose', { text, send: true });
      askIn.value = '';
    }

    // a door on a song with parts: it may loop two bars to record over; say so rather than leave the circle to shrink
    async function useDoor(run) {
      const p0 = store.get(),
        had = p0.tracks.length > 0,
        was = p0.loop ? { ...p0.loop } : null;
      said = '';
      addSaid.textContent = '';
      await run();
      if (!had) return;
      const lp = store.get().loop;
      if (lp?.on && (!was?.on || Math.abs(lp.start - was.start) > 1e-6 || Math.abs(lp.end - was.end) > 1e-6)) {
        said =
          `The loop is now ${barsOf(lp.start, lp.end).toLowerCase()}, to record over` +
          (was?.on ? ` (it was ${barsOf(was.start, was.end).toLowerCase()}).` : '.');
        addSaid.textContent = said;
        setPage('loop'); // (the circle shows what you're recording over)
      }
    }

    async function playPage() {
      if (engine.playing) {
        engine.stop();
        dirty = true;
        return;
      }
      const pg = page();
      const from = pg && !within(engine.beat, pg) ? pg.start : engine.beat;
      try {
        await engine.start?.();
        await engine.play(from);
      } catch (e) {
        ui.toast?.('Could not play: ' + e.message, { kind: 'bad' });
      }
      dirty = true;
    }

    function renderHead() {
      const pg = page();
      pagesEl.replaceChildren(
        ...pages().map((x) =>
          h(
            'button.btn.btn-txt.rd-page' + (pg && x.key === pg.key ? '.sel-print' : ''),
            {
              type: 'button',
              'aria-pressed': String(!!pg && x.key === pg.key),
              title: x.sub ? `${x.name}, ${x.sub.toLowerCase()}` : x.name,
              onclick: () => setPage(x.key, { seek: true }),
            },
            x.name,
          ),
        ),
      );
    }

    function renderSide() {
      const p = store.get(),
        pg = page(),
        sel = selTrack(),
        rs = rings(),
        cols = ringColors(rs);
      if (!pg) return;
      const has = p.tracks.length > 0;
      listHead.replaceChildren(h('span.head', pg.name), pg.sub ? h('span.t3', ' ', pg.sub.toLowerCase()) : null);
      // the doors: the middle of a blank song, or the "Add a part" row, quieter
      root.classList.toggle('is-blank', !has);
      if (!has) {
        if (doors.parentNode !== stage) stage.append(doors);
        tapDoor.classList.add('btn-go');
      } else {
        if (doors.parentNode !== add) add.insertBefore(doors, addSaid);
        tapDoor.classList.remove('btn-go');
      }
      hub.hidden = !has;
      hubName.textContent = pg.name;
      if (!has) {
        list.replaceChildren(
          h('li.rd-empty.t3', 'Nothing on the circle yet. Tap a beat, hum it or play the keys, and it turns.'),
        );
      } else {
        list.replaceChildren(
          ...rs.map((t, i) => {
            const parts = inPage(t, pg),
              drums = isDrumTrack(app, t);
            const n = parts.reduce((s, x) => s + x.notes.length, 0);
            const audio = parts.some((x) => x.clip.kind === 'audio');
            const by = signers(parts, t);
            const sign = by.length ? by.flatMap((b, j) => [j ? ', ' : '', byline(b, { app })]) : [];
            const count = audio && !n ? 'audio' : n ? plural(n, drums ? 'hit' : 'note') : 'nothing here';
            const row = h(
              'button.ledger-row.rd-row' + (t.id === sel ? '.sel' : '') + (t.mute ? '.is-muted' : ''),
              {
                type: 'button',
                'aria-pressed': String(t.id === sel),
                dataset: { track: t.id },
                onclick: () => {
                  select(t.id);
                  reveal();
                },
              },
              h('span.num.rd-n', String(i + 1).padStart(2, '0')),
              h('span.rd-name', h('i.rd-sw', { style: { background: cols.get(t.id) } }), h('span.name', t.name)),
              h('span.rd-by', ...sign),
              h('span.mono.t3.rd-count', t.mute ? 'muted' : count),
            );
            return h('li', row);
          }),
          ...(folded() ? [h('li.rd-more.t3', `${plural(folded(), 'more track')} in the timeline view.`)] : []),
        );
      }
      // what the circle says, for a screen reader (the list rows are the way to select with keys)
      const st = sel && store.track(sel);
      C.cv.setAttribute(
        'aria-label',
        !has
          ? `The circle: ${pg.name}, empty`
          : `The circle: ${pg.name}${pg.sub ? ', ' + pg.sub.toLowerCase() : ''}. ${plural(rs.length, 'ring')}, outermost first: ${rs.map((t) => t.name).join(', ')}.${st ? ` ${st.name} is selected.` : ''}`,
      );
      renderStripHead();
      renderAsk();
    }

    function renderStripHead() {
      const sel = selTrack(),
        t = sel && store.track(sel);
      strip.classList.toggle('is-idle', !t);
      if (!t) {
        stripHead.replaceChildren(h('span.head', 'On a line'));
        stripNote.textContent = store.get().tracks.length
          ? 'Tap a ring (or a row) to read its notes on a line, left to right, with their names.'
          : '';
        return;
      }
      stripHead.replaceChildren(
        h('span.head', t.name, ', on a line'),
        h(
          'button.btn.btn-txt.rd-edit',
          {
            type: 'button',
            title: 'Open the Notes editor on this part',
            onclick: () => ui.show(isDrumTrack(app, t) ? 'drumgrid' : 'pianoroll'),
          },
          'Edit the notes',
        ),
      );
      stripNote.textContent = PHONE()
        ? `The ${t.name} ring above, unrolled: time left to right, low notes at the bottom.`
        : `The ${t.name} ring, unrolled: time left to right, low notes at the bottom.`;
    }

    // the Ask chips fit the selected track: what you'd ask of a bassline isn't what you'd ask of a beat
    function chipsFor(t, pg) {
      if (!t) return ['Play a take over my part', 'What would you change?'];
      const p = store.get(),
        drums = isDrumTrack(app, t),
        what = `${t.name} ${t.instrument?.device || ''}`;
      if (emptyIn(t, pg))
        return [`Write a ${t.name.toLowerCase()} part here`, 'What would fit here?', 'What would you change?'];
      if (drums) return ['Make the beat busier', 'Add a fill at the end', 'What would you change?'];
      if (/bass/i.test(what)) return ['Make it walk', 'Double it an octave up', 'What would you change?'];
      if (/key|piano|rhodes|organ|chord|pad/i.test(what))
        return ['Voice the chords wider', 'Answer it with a melody', 'What would you change?'];
      const hasDrums = p.tracks.some((x) => isDrumTrack(app, x) && !emptyIn(x, pg));
      return [
        'Answer it with a counter-melody',
        hasDrums ? 'Double it an octave up' : 'Put drums under it',
        'What would you change?',
      ];
    }
    function renderAsk() {
      const p = store.get(),
        sel = selTrack(),
        t = sel && store.track(sel);
      const has = p.tracks.length > 0;
      askIn.disabled = !has;
      askBtn.disabled = !has;
      askIn.placeholder = !has
        ? 'Your agent answers once there’s something to answer.'
        : t
          ? `Ask your agent about ${t.name}…`
          : 'Ask your agent…';
      const say = (q) =>
        h('button.btn.btn-txt.rd-chip', { type: 'button', onclick: () => send(q) }, icon('agent', { size: 12 }), q);
      if (!has) {
        chips.replaceChildren();
        return;
      }
      chips.replaceChildren(...chipsFor(t, page()).map(say));
    }

    /* ------------------------------------------------ selection */
    function select(id) {
      const t = id && store.track(id);
      if (!t) return false;
      const pg = page(),
        b = engine.playing && within(engine.beat, pg) ? engine.beat : (pg?.start ?? 0);
      return pick(t, b);
    }
    // select a track and its clip at beat b (or its first clip in this page): the agent's scope reads the selection
    function pick(t, b) {
      if (!t) return false;
      const pg = page();
      const live = t.clips.filter((c) => !(c.mute && c.take));
      const at =
        live.find((c) => b >= c.start && b < c.start + c.length) ||
        (pg && live.find((c) => c.start < pg.start + pg.len && c.start + c.length > pg.start)) ||
        null;
      ui.select({ track: t.id, clip: at ? at.id : null, notes: [] });
      return true;
    }
    // on a phone the strip sits under the circle: after a tap, bring it into view so the tap visibly did something
    function reveal() {
      if (!PHONE()) return;
      requestAnimationFrame(() => {
        try {
          strip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (e) {
          /* fine */
        }
      });
    }
    // the ring under a point: the band it's in, or (a finger is wider than a ring) the nearest band within reach
    function hit(x, y) {
      if (!geo || !geo.rings.length) return null;
      const dx = x - geo.cx,
        dy = y - geo.cy,
        r = Math.hypot(dx, dy);
      if (r < geo.rIn - 4 || r > geo.rOut + 8) return null;
      const reach = PHONE() ? 8 : 4;
      let best = null,
        bd = Infinity;
      for (const g of geo.rings) {
        const d = r < g.r0 ? g.r0 - r : r > g.r1 ? r - g.r1 : 0;
        if (d < bd) {
          bd = d;
          best = g;
        }
      }
      if (!best || bd > reach) return null;
      let a = Math.atan2(dy, dx) + Math.PI / 2 - SEAM / 2;
      a = ((a % TAU) + TAU) % TAU;
      const pg = page();
      const frac = a / (TAU - SEAM);
      return { track: best.id, beat: frac <= 1 ? pg.start + frac * pg.len : null };
    }
    C.cv.addEventListener('click', (e) => {
      const r = C.cv.getBoundingClientRect();
      const got = hit(e.clientX - r.left, e.clientY - r.top);
      if (!got) return; // the space between rings, and the middle, do nothing: a tap here never records
      const t = store.track(got.track);
      if (t) {
        pick(t, got.beat ?? page().start);
        reveal();
      }
    });
    C.cv.addEventListener('pointermove', (e) => {
      const r = C.cv.getBoundingClientRect();
      C.cv.style.cursor = hit(e.clientX - r.left, e.clientY - r.top) ? 'pointer' : '';
    });

    const offs = [
      ui.on('select', () => {
        dirty = true;
        renderSide();
      }),
      ui.on('resize', () => {
        dirty = true;
      }),
    ];

    /* ------------------------------------------------ drawing */
    // text along an arc, clockwise, ending at angle `end`: a ring's name, reading into the seam
    function arcText(g, text, cx, cy, r, end, fill, halo) {
      const ws = [...text].map((ch) => g.measureText(ch).width);
      let a = end - ws.reduce((s, w) => s + w, 0) / r;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      [...text].forEach((ch, i) => {
        const mid = a + ws[i] / 2 / r;
        g.save();
        g.translate(cx + Math.cos(mid) * r, cy + Math.sin(mid) * r);
        g.rotate(mid + Math.PI / 2);
        g.strokeStyle = halo;
        g.lineWidth = 3.5;
        g.strokeText(ch, 0, 0);
        g.fillStyle = fill;
        g.fillText(ch, 0, 0);
        g.restore();
        a += ws[i] / r;
      });
    }

    function draw() {
      const pal = palette(),
        g = C.g,
        W = C.w,
        H = C.h,
        pg = page();
      g.clearRect(0, 0, W, H);
      if (!pg) return;
      const phone = PHONE();
      const cx = W / 2,
        cy = H / 2;
      const rOut = Math.max(40, Math.min(W, H) / 2 - (phone ? 18 : 26));
      const rIn = phone ? Math.max(40, rOut * 0.3) : Math.max(rOut * 0.36, Math.min(112, rOut * 0.6));
      const ang = (b) => -Math.PI / 2 + SEAM / 2 + ((b - pg.start) / pg.len) * (TAU - SEAM);
      const a0p = ang(pg.start),
        a1p = ang(pg.start + pg.len);
      const bpb = bpbOf();
      const rs = rings(),
        sel = selTrack(),
        cols = ringColors(rs);
      const rec = app.input?.recorder,
        lv = rec && rec.state !== 'idle' ? rec.live?.() : null;
      const b = engine.beat,
        playing = engine.playing;

      // the ring sizes never move with the selection: every ring with something in this part the same width, a ring
      // with nothing in it a thin one
      const gap = rs.length > 5 ? 3 : 5;
      const weight = (t) => (emptyIn(t, pg) ? 0.35 : 1);
      const total = rs.reduce((s, t) => s + weight(t), 0) || 1;
      const room = rOut - rIn - gap * Math.max(0, rs.length - 1);
      geo = { cx, cy, rIn, rOut, rings: [] };
      let r = rOut;
      for (const t of rs) {
        const w = (room * weight(t)) / total;
        geo.rings.push({ id: t.id, r0: r - w, r1: r });
        r -= w + gap;
      }

      // the bars and the beats: hairline spokes at each bar, dots on the rim at each beat, bar numbers outside
      g.lineWidth = 1;
      for (let bt = pg.start; bt < pg.start + pg.len - 1e-6; bt += 1) {
        const a = ang(bt),
          bar = Math.abs(bt / bpb - Math.round(bt / bpb)) < 1e-6;
        if (bar) {
          g.strokeStyle = pal.line;
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
          g.lineTo(cx + Math.cos(a) * (rOut + 4), cy + Math.sin(a) * (rOut + 4));
          g.stroke();
          g.fillStyle = pal.text3;
          g.font = `500 ${phone ? 11 : 10.5}px ${pal.mono}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const rr = rOut + (phone ? 11 : 14);
          g.fillText(
            String(Math.round(bt / bpb) + 1),
            cx + Math.cos(a) * rr + (bt === pg.start ? 4 : 0),
            cy + Math.sin(a) * rr,
          );
        } else {
          g.fillStyle = pal.line2;
          g.beginPath();
          g.arc(cx + Math.cos(a) * (rOut + 4), cy + Math.sin(a) * (rOut + 4), 1.3, 0, TAU);
          g.fill();
        }
      }

      if (!rs.length) {
        // a blank circle, still: one hairline where the first part will go
        g.strokeStyle = pal.line;
        g.beginPath();
        g.arc(cx, cy, (rIn + rOut) / 2, a0p, a1p);
        g.stroke();
      }

      rs.forEach((t, i) => {
        const gr = geo.rings[i],
          col = cols.get(t.id),
          drums = isDrumTrack(app, t);
        const parts = inPage(t, pg),
          { lo, hi } = rangeOf(parts, drums);
        const empty = !parts.some((x) => x.notes.length || x.clip.kind === 'audio');
        const pad = Math.min(4, (gr.r1 - gr.r0) * 0.15);
        const ra = gr.r0 + pad,
          rb = gr.r1 - pad;
        const rOf = (pp) => ra + ((pp - lo) / (hi - lo)) * (rb - ra);
        const thick = clamp((rb - ra) / (hi - lo), 1.5, t.id === sel ? 4.5 : 3.5);
        const isSel = t.id === sel,
          dim = sel && !isSel ? 0.55 : 1;
        let lit = false;
        // an empty ring: a thin dashed hairline, nothing more
        if (empty) {
          g.strokeStyle = isSel ? pal.text2 : pal.line2;
          g.lineWidth = 1;
          g.setLineDash([2, 4]);
          g.beginPath();
          g.arc(cx, cy, (gr.r0 + gr.r1) / 2, a0p, a1p);
          g.stroke();
          g.setLineDash([]);
        } else {
          g.strokeStyle = pal.line;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(cx, cy, (gr.r0 + gr.r1) / 2, a0p, a1p);
          g.stroke();
        }
        // the selected ring's Cs: a hairline at each, so a tune has something to be read against
        if (isSel && !drums && !empty) {
          for (let c = Math.ceil(lo / 12) * 12; c <= hi; c += 12) {
            g.strokeStyle = pal.line2;
            g.setLineDash([2, 3]);
            g.beginPath();
            g.arc(cx, cy, rOf(c), a0p, a1p);
            g.stroke();
            g.setLineDash([]);
          }
        }
        // a kit's lanes (kick inside, hats outside) and a tick at every beat, so the groove can be counted
        const laneR = (ln) => ra + ((ln + 0.5) / 3) * (rb - ra);
        if (drums && !empty) {
          g.strokeStyle = pal.line;
          g.lineWidth = 1;
          g.setLineDash([1, 3]);
          for (let ln = 0; ln < 3; ln++) {
            g.beginPath();
            g.arc(cx, cy, laneR(ln), a0p, a1p);
            g.stroke();
          }
          g.setLineDash([]);
          for (let bt = pg.start; bt < pg.start + pg.len - 1e-6; bt += 1) {
            const a = ang(bt);
            g.strokeStyle = pal.line2;
            g.beginPath();
            g.moveTo(cx + Math.cos(a) * ra, cy + Math.sin(a) * ra);
            g.lineTo(cx + Math.cos(a) * (ra + 3), cy + Math.sin(a) * (ra + 3));
            g.stroke();
          }
        }
        // clips: the track's colour at 13% (brighter selected, or while it sounds) with a 42% hairline (dashed and empty
        // when muted), as in the arranger
        for (const x of parts) {
          const c = x.clip,
            ca0 = ang(Math.max(pg.start, c.start)),
            ca1 = ang(Math.min(pg.start + pg.len, c.start + c.length));
          const muted = c.mute || t.mute;
          const on = !muted && x.notes.some((n) => sounding(n, drums, b));
          if (on) lit = true;
          g.beginPath();
          g.arc(cx, cy, gr.r1, ca0, ca1);
          g.arc(cx, cy, gr.r0, ca1, ca0, true);
          g.closePath();
          if (!muted) {
            g.fillStyle = rgba(col, (isSel ? 0.2 : 0.13 * dim) + (on ? 0.07 : 0));
            g.fill();
          }
          g.strokeStyle = muted ? pal.line2 : rgba(col, 0.42 * dim);
          g.lineWidth = 1;
          if (muted) g.setLineDash([3, 3]);
          g.stroke();
          g.setLineDash([]);
          const mixed = !muted && x.notes.some((n) => n.by && n.by !== c.by);
          for (const n of x.notes) {
            const hot = !muted && sounding(n, drums, b);
            if (drums) {
              // a hit: a dot on its lane, bigger for a kick, swelling while the hand is on it
              const ln = laneOf(n.p),
                a = ang(Math.max(n.t, pg.start)),
                rr = laneR(ln);
              const base = Math.min((rb - ra) / 6.5, 3.4) * [1.05, 0.85, 0.6][ln] * (0.75 + 0.25 * n.v);
              const rad = Math.max(1, hot ? base * 1.7 : base);
              if (hot) {
                g.shadowColor = col;
                g.shadowBlur = 10;
              }
              g.fillStyle = muted ? pal.text3 : hot ? shade(col, 0.35) : col;
              g.globalAlpha = muted ? 0.6 : hot ? 1 : (0.55 + 0.45 * n.v) * dim;
              g.beginPath();
              g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, rad, 0, TAU);
              g.fill();
              g.globalAlpha = 1;
              g.shadowBlur = 0;
              continue;
            }
            // a note: an arc as long as the note, at its pitch's distance
            const s0 = Math.max(n.t, pg.start),
              s1 = Math.min(n.t + n.d, pg.start + pg.len);
            const na0 = ang(s0),
              na1 = Math.max(ang(s1) - 0.004, na0 + 0.012);
            const rr = rOf(n.p);
            g.lineWidth = hot ? thick + 1.5 : thick;
            g.lineCap = 'butt';
            if (muted) {
              g.strokeStyle = pal.text3;
              g.globalAlpha = 0.6;
            } else if (hot) {
              g.strokeStyle = shade(col, 0.4);
              g.shadowColor = col;
              g.shadowBlur = 12;
            } else {
              g.strokeStyle = col;
              g.globalAlpha = (0.55 + 0.45 * n.v) * dim;
            }
            g.beginPath();
            g.arc(cx, cy, rr, na0, na1);
            g.stroke();
            g.globalAlpha = 1;
            g.shadowBlur = 0;
            const k = mixed && n.by !== c.by ? authorKind(app, n.by) : 'house';
            if (k !== 'house') {
              // the author's outline: warm for a person, cool for an agent, around the note (never a fill)
              g.strokeStyle = k === 'agent' ? pal.agent : pal.human;
              g.lineWidth = 1;
              g.beginPath();
              g.arc(cx, cy, rr + thick / 2 + 0.75, na0 - 0.003, na1 + 0.003);
              g.arc(cx, cy, rr - thick / 2 - 0.75, na1 + 0.003, na0 - 0.003, true);
              g.closePath();
              g.stroke();
            }
          }
        }
        // the selected tune's contour: its top line, note to note, so its shape reads on the circle itself
        if (isSel && !drums && !empty) {
          const top = new Map();
          for (const x of parts)
            if (!(x.clip.mute || t.mute))
              for (const n of x.notes) {
                const k = Math.round(n.t * 8);
                if (!top.has(k) || top.get(k).p < n.p) top.set(k, n);
              }
          const line = [...top.values()].sort((m, n) => m.t - n.t);
          if (line.length > 1) {
            g.strokeStyle = rgba(shade(col, 0.45), 0.85);
            g.lineWidth = 1.25;
            g.lineJoin = 'round';
            g.beginPath();
            line.forEach((n, j) => {
              const a = ang(Math.max(n.t, pg.start) + Math.min(n.d, 1) / 2),
                rr = rOf(n.p);
              const px = cx + Math.cos(a) * rr,
                py = cy + Math.sin(a) * rr;
              j ? g.lineTo(px, py) : g.moveTo(px, py);
            });
            g.stroke();
          }
        }
        // a take being recorded onto this track: record ink round the ring, and what's played so far
        if (lv && (lv.track === t.id || (lv.tracks || []).includes?.(t.id))) {
          g.strokeStyle = pal.rec;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(cx, cy, gr.r1 + 1.5, 0, TAU);
          g.stroke();
          g.beginPath();
          g.arc(cx, cy, Math.max(1, gr.r0 - 1.5), 0, TAU);
          g.stroke();
          for (const ps of lv.passes || []) {
            if (ps.track !== t.id) continue;
            for (const n of ps.notes) {
              if (n.t < pg.start || n.t >= pg.start + pg.len) continue;
              const na0 = ang(n.t),
                na1 = Math.max(ang(Math.min(n.t + (drums ? 0.12 : n.d), pg.start + pg.len)), na0 + 0.02);
              g.strokeStyle = pal.human;
              g.lineWidth = thick;
              g.beginPath();
              g.arc(cx, cy, clamp(drums ? laneR(laneOf(n.p)) : rOf(n.p), ra, rb), na0, na1);
              g.stroke();
            }
          }
        }
        // selected: a cream frame on both edges (reverse print's canvas form)
        if (isSel) {
          g.strokeStyle = pal.text;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(cx, cy, gr.r1 + 1, a0p, a1p);
          g.stroke();
          g.beginPath();
          g.arc(cx, cy, Math.max(1, gr.r0 - 1), a0p, a1p);
          g.stroke();
        } else if (lit) {
          // a ring that is sounding: a breath of its colour round its outer edge
          g.strokeStyle = rgba(col, 0.55);
          g.lineWidth = 1;
          g.beginPath();
          g.arc(cx, cy, gr.r1 + 1, a0p, a1p);
          g.stroke();
        }
        // its name, in its colour, along the ring just before the seam (clear of the hand at bar 1)
        const mid = (gr.r0 + gr.r1) / 2,
          fs = clamp(gr.r1 - gr.r0 - 1, 8.5, 11);
        g.font = `${isSel ? 700 : 600} ${fs}px ${pal.ui}`;
        const nm = t.name.length > 16 ? t.name.slice(0, 15) + '…' : t.name;
        arcText(g, nm, cx, cy, mid, a1p - 0.03, isSel ? pal.text : empty ? pal.text3 : shade(col, 0.15), pal.bg);
      });

      // the playhead: the hand, in leader green, while it is in this part of the song
      if (within(b, pg)) {
        const a = ang(b);
        g.globalAlpha = playing ? 1 : 0.5;
        g.strokeStyle = pal.accent;
        g.lineWidth = 2;
        g.lineCap = 'butt';
        if (playing) {
          g.shadowColor = pal.accent;
          g.shadowBlur = 8;
        }
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * (rIn - 6), cy + Math.sin(a) * (rIn - 6));
        g.lineTo(cx + Math.cos(a) * (rOut + 7), cy + Math.sin(a) * (rOut + 7));
        g.stroke();
        g.globalAlpha = 1;
        g.shadowBlur = 0;
      }
    }

    // the selected ring, unrolled: a straight strip, time left to right, pitch up, note names on the left
    function drawStrip() {
      const pal = palette(),
        g = S.g,
        W = S.w,
        H = S.h,
        pg = page();
      g.clearRect(0, 0, W, H);
      const sel = selTrack(),
        t = sel && store.track(sel);
      if (!pg || !t) return;
      const drums = isDrumTrack(app, t),
        col = ringColors().get(t.id) || resolveColor(t.color);
      const parts = inPage(t, pg);
      const L = drums ? 58 : 40,
        R = 4,
        T = 4,
        B = 14,
        iw = Math.max(10, W - L - R),
        ih = Math.max(10, H - T - B);
      const xOf = (bt) => L + ((bt - pg.start) / pg.len) * iw;
      const bpb = bpbOf(),
        key = store.get().key,
        b = engine.beat;
      // rows: every pitch in the range for a tune; only the ones played for drums (each a named row)
      let rows;
      if (drums) {
        const ps = [...new Set(parts.flatMap((x) => x.notes.map((n) => n.p)))].sort((a, c) => a - c);
        rows = ps.length ? ps : [36, 38, 42];
      } else {
        const { lo, hi } = rangeOf(parts, false);
        rows = [];
        for (let p = Math.ceil(lo); p <= Math.floor(hi); p++) rows.push(p);
      }
      const rh = ih / rows.length,
        yOf = (p) => T + ih - (rows.indexOf(p) + 1) * rh;
      // grid: bars and beats; row hairlines at each C (a tune) or each row (drums)
      g.lineWidth = 1;
      for (let bt = pg.start; bt <= pg.start + pg.len + 1e-6; bt += 1) {
        const bar = Math.abs(bt / bpb - Math.round(bt / bpb)) < 1e-6;
        g.strokeStyle = bar ? pal.line2 : pal.line;
        g.beginPath();
        g.moveTo(Math.round(xOf(bt)) + 0.5, T);
        g.lineTo(Math.round(xOf(bt)) + 0.5, T + ih);
        g.stroke();
        if (bar && bt < pg.start + pg.len - 1e-6) {
          g.fillStyle = pal.text3;
          g.font = `500 10px ${pal.mono}`;
          g.textAlign = 'left';
          g.textBaseline = 'top';
          g.fillText(String(Math.round(bt / bpb) + 1), xOf(bt) + 3, T + ih + 2);
        }
      }
      const names = drums ? kitNotes(app.devices.getDevice(t.instrument?.device)) : null;
      g.font = `500 10px ${pal.mono}`;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      // names: every row of a kit; for a tune each C (with a hairline under it), and its lowest and highest notes
      const played = parts.flatMap((x) => x.notes.map((n) => n.p));
      const pLo = Math.min(...played),
        pHi = Math.max(...played);
      let lastY = Infinity;
      rows.forEach((p) => {
        const y = yOf(p),
          edge = p === pLo || p === pHi;
        if (drums || p % 12 === 0) {
          g.strokeStyle = pal.line;
          g.beginPath();
          g.moveTo(L, Math.round(y + rh) + 0.5);
          g.lineTo(L + iw, Math.round(y + rh) + 0.5);
          g.stroke();
        }
        if (!(drums || p % 12 === 0 || edge || rows.length <= 8)) return;
        if (lastY - (y + rh / 2) < 10) return; // (no two names on top of each other)
        lastY = y + rh / 2;
        g.fillStyle = p % 12 === 0 ? pal.text2 : pal.text3;
        const nm = drums ? drumName(p, names) || String(p) : spellNote(p, key);
        g.fillText(nm.length > 9 ? nm.slice(0, 8) + '.' : nm, L - 5, y + rh / 2);
      });
      for (const x of parts) {
        const muted = x.clip.mute || t.mute;
        for (const n of x.notes) {
          const nx = xOf(n.t),
            nw = Math.max(2, ((drums ? Math.min(n.d, 0.2) : n.d) / pg.len) * iw - 1);
          const ny = yOf(n.p) + 1,
            nh = Math.max(2, rh - 2);
          if (muted) {
            g.strokeStyle = pal.text3;
            g.strokeRect(nx + 0.5, ny + 0.5, nw - 1, nh - 1);
            continue;
          }
          const hot = sounding(n, drums, b);
          if (hot) {
            g.shadowColor = col;
            g.shadowBlur = 10;
            g.fillStyle = shade(col, 0.4);
          } else {
            g.globalAlpha = 0.55 + 0.45 * (n.v ?? 0.8);
            g.fillStyle = col;
          }
          g.fillRect(nx, ny, nw, nh);
          g.globalAlpha = 1;
          g.shadowBlur = 0;
          if (n.by && n.by !== x.clip.by) {
            const k = authorKind(app, n.by);
            if (k !== 'house') {
              g.strokeStyle = k === 'agent' ? pal.agent : pal.human;
              g.strokeRect(Math.round(nx) - 0.5, Math.round(ny) - 0.5, Math.round(nw) + 1, Math.round(nh) + 1);
            }
          }
        }
      }
      if (within(b, pg)) {
        g.globalAlpha = engine.playing ? 1 : 0.5;
        g.strokeStyle = pal.accent;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(xOf(b), T);
        g.lineTo(xOf(b), T + ih);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    // the middle's readout: where the hand is, and Play or Stop
    function renderHub() {
      const b = Math.max(0, engine.beat || 0),
        bpb = bpbOf();
      const pos = `Bar ${Math.floor(b / bpb + 1e-9) + 1} · beat ${Math.floor((b % bpb) + 1e-9) + 1}`;
      if (pos !== lastPos) {
        hubPos.textContent = pos;
        lastPos = pos;
      }
      if (engine.playing !== lastPlaying) {
        lastPlaying = engine.playing;
        playBtn.replaceChildren(icon(engine.playing ? 'stop' : 'play', { size: 14 }), engine.playing ? 'Stop' : 'Play');
        playBtn.setAttribute('aria-label', engine.playing ? 'Stop' : 'Play this part');
        playBtn.classList.toggle('btn-go', !engine.playing);
      }
    }

    renderHead();
    renderSide();
    renderHub();
    return {
      page,
      pages,
      rings: () => rings().map((t, i) => ({ id: t.id, name: t.name, ...(geo?.rings[i] || {}) })),
      geom: () => geo && { ...geo, rings: geo.rings.map((x) => ({ ...x })) },
      colors: () => Object.fromEntries(ringColors()),
      select,
      hit,
      setPage,
      update() {
        dirty = true;
        renderHead();
        renderSide();
      },
      refresh() {
        dirty = true;
        renderHead();
        renderSide();
      },
      frame() {
        const moved = C.fit() | S.fit();
        const live = engine.playing || (app.input?.recorder && app.input.recorder.state !== 'idle');
        if (engine.playing) follow();
        renderHub();
        // the Take one card sits bottom left while the circle is open, off the list and the Add a part row
        const region = el.closest('.ew-region-center'),
          on = ui.active('center') === 'round';
        if (region && region.classList.contains('rd-on') !== on) region.classList.toggle('rd-on', on);
        if (!(dirty || moved || live || lastPlaying !== engine.playing)) return;
        dirty = false;
        draw();
        drawStrip();
      },
      unmount() {
        for (const o of offs) o();
      },
    };
  }
}

const ROUND_CSS = `
.rd { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; background: var(--bg); color: var(--text); }
.rd-head { display: flex; align-items: center; gap: 4px 16px; flex-wrap: wrap; min-height: 38px; padding: 0 18px; border-bottom: var(--rule); flex: none; background: var(--bg); }
.ew-shell .ew-region-center:not(.ew-single) [data-panel="round"] .rd-head { padding-left: calc(var(--jm-tabs-w, 150px) + 14px); }
.rd-pages { display: flex; flex-wrap: wrap; gap: 2px 8px; flex: 1; min-width: 0; }
.rd-page { padding: 0 5px; }
.rd-page.sel-print { text-decoration: none; color: var(--bg); }
.rd-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 330px); grid-template-rows: auto 1fr; grid-template-areas: "stage side" "stage strip"; gap: 0 28px; padding: 14px 20px 14px; }
.rd-stage { grid-area: stage; position: relative; min-height: 260px; min-width: 0; }
.rd-side { grid-area: side; }
.rd-strip { grid-area: strip; align-self: start; }
.rd-dial { position: absolute; inset: 0; }
.rd-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; }
.rd-hub { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 6px; width: 150px; text-align: center; pointer-events: none; }
.rd-hub[hidden] { display: none; }
.rd-hub > * { pointer-events: auto; }
.rd-hub-name { font: 400 22px/1 var(--font-display); letter-spacing: -0.01em; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rd-hub-pos { font-size: 11px; color: var(--text-3); }
.rd-play { gap: 6px; min-width: 92px; justify-content: center; margin-top: 4px; }
.rd-doors { display: flex; gap: 6px; }
.rd.is-blank .rd-doors { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); flex-direction: column; width: 140px; }
.rd-door { justify-content: center; }
.rd.is-blank .rd-door { width: 100%; }
.rd-add .rd-door { flex: 1; min-width: 0; padding: 0 6px; font-size: 12.5px; }
.rd-side { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-top: 4px; }
.rd-lh, .rd-add-h { display: flex; align-items: baseline; gap: 6px; padding-bottom: 4px; border-bottom: var(--rule); }
.rd-lh .t3 { font-size: 12px; }
.rd-add { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.rd.is-blank .rd-add { display: none; }
.rd-said { margin: 0; font-size: 12px; line-height: 1.4; }
.rd-said:empty { display: none; }
.rd-list { --ledger-cols: 22px minmax(0, 1fr) auto; }
.rd-list > li { display: block; padding: 0; border: 0; }
.rd-row { width: 100%; padding: 7px 6px; margin: 0; border: 0; border-bottom: var(--rule); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; grid-template-columns: var(--ledger-cols); grid-template-areas: "n name count" "n by by"; row-gap: 1px; }
.rd-n { grid-area: n; font-size: 13px; color: var(--text-3); }
.rd-row.sel .rd-n { color: var(--bg); }
.rd-name { grid-area: name; display: flex; align-items: center; gap: 7px; min-width: 0; font-weight: 600; font-size: 13px; }
.rd-name .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rd-sw { flex: none; width: 8px; height: 8px; display: inline-block; }
.rd-by { grid-area: by; font-size: 12px; min-height: 0; }
.rd-count { grid-area: count; font-size: 11px; }
.rd-row.sel .rd-count { color: var(--bg); }
@media (hover: none) { .rd-row:not(.sel):hover { background: none; } }
.rd-empty, .rd-more { padding: 9px 0; font-size: 12.5px; line-height: 1.45; }
.rd-strip { display: flex; flex-direction: column; gap: 4px; margin-top: 16px; min-width: 0; }
.rd-sh { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.rd-strip-box { position: relative; height: 132px; border-top: var(--rule); border-bottom: var(--rule); }
.rd-strip.is-idle .rd-strip-box { display: none; }
.rd-strip-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.rd-strip-note { margin: 0; font-size: 11.5px; line-height: 1.4; }
.rd-ask { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 10px 20px 14px; border-top: var(--rule); }
.rd-ask-row { display: flex; gap: 8px; max-width: 760px; }
.rd-ask-in { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: var(--rule-2); border-radius: var(--r-press); background: transparent; color: var(--text); font: 13.5px var(--font-ui); }
.rd-ask-in:disabled { color: var(--text-3); }
.rd-ask-in::placeholder { color: var(--text-3); }
.rd-ask-go { height: 32px; gap: 6px; }
.rd-chips { display: flex; flex-wrap: wrap; gap: 0 14px; }
.rd-chip { gap: 5px; font-size: 12.5px; }
@media (min-width: 701px) { .rd-on .ob { left: 16px; right: auto; } }
/* a desktop has the Agent panel beside the circle: one Ask, there */
@media (min-width: 641px) { .rd-ask { display: none; } }
@media (max-width: 900px) {
  .rd-body { grid-template-columns: minmax(0, 1fr) minmax(220px, 280px); gap: 0 18px; padding: 12px 14px 8px; }
}
@media (max-width: 640px) {
  .rd-head { position: sticky; top: 0; z-index: 2; padding: 0 12px; gap: 2px 10px; }
  .ew-shell .ew-region-center:not(.ew-single) [data-panel="round"] .rd-head { padding: 37px 12px 0; }
  .rd-body { flex: none; display: flex; flex-direction: column; padding: 8px 12px; gap: 10px; }
  .rd-stage { flex: none; min-height: 0; display: flex; flex-direction: column; gap: 10px; order: 0; }
  .rd-strip { order: 1; margin-top: 0; }
  .rd-side { order: 2; }
  .rd-dial { position: relative; inset: auto; width: 100%; aspect-ratio: 1; max-width: 420px; align-self: center; }
  .rd-hub { width: 96px; gap: 3px; }
  .rd-hub-name { font-size: 14px; }
  .rd-hub-pos { display: none; }
  .rd-play { min-width: 0; min-height: 40px; padding: 0 12px; margin-top: 2px; }
  .rd.is-blank .rd-doors { position: static; transform: none; width: auto; flex-direction: row; }
  .rd-doors { flex-direction: row; }
  .rd-door { flex: 1; min-width: 0; padding: 0 6px; min-height: 40px; }
  .rd-row { min-height: 44px; }
  .rd-strip-box { height: 112px; }
  .rd-ask { padding: 8px 12px 12px; }
  .rd-chip { font-size: 12px; min-height: 32px; }
}
`;
